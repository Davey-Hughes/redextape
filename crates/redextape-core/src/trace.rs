//! One step-event vocabulary over both backends (§9), stepped lazily so a renderer never holds the
//! whole run. Materializing is not viable: the pre-existing `sim::Step` copies every tape each step,
//! measured at 3,488 bytes/step and 592.9 MB for `sum(5)` — row 7 of the demo suite.
//!
//! THE TM DELTA IS A RULE REFERENCE, NOT A COPY OF ITS EFFECTS. The machine is immutable for the
//! duration of a run, so `(state, rule)` determines the writes and head moves — they are recoverable
//! as `m.states[state].rules[rule]`. That makes the variant 8 bytes with no allocation, and it carries
//! NO tape-count assumption: `TAPES` is the lowering's convention, but `Machine::tapes` is a runtime
//! field and `parse_tm` accepts a hand-written machine declaring any count, so a fixed-size
//! `[Option<Symbol>; TAPES]` array would silently mis-shape every such machine.
//!
//! The λ variant does allocate a small `Vec` (`Path`, measured maximum length 30). Accepted rather
//! than optimized: `Path` is what the reducer already produces, and an inline-capacity alternative
//! would need a dependency core is not allowed.

use crate::lambda::reduce::{MAX_TERM_DEPTH, depth_exceeds, reduce_step};
use crate::lambda::{LambdaTerm, Path, Status};
use crate::tm::machine::{Machine, StateId, Symbol};
use crate::tm::sim::{Caps as TmCaps, Status as TmStatus, Tape, apply, rule_matches};

mod zipper;

pub use zipper::ZipperCursor;

/// One step of either backend. `Delta`'s `state` is the state BEFORE the transition, matching the
/// convention `sim::Step` and `lambda::reduce::Step` already use.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StepEvent {
    Beta { redex: Path },
    Delta { state: StateId, rule: u32 },
}

/// Lazy β-reduction. Holds one term, never a history — O(1) in the number of steps, where
/// `lambda::reduce_trace` is O(steps) by contract. `reduce_trace` is written over this cursor, so the
/// β-stepping loop exists once in the crate rather than twice.
pub struct LambdaCursor {
    current: LambdaTerm,
    steps: u64,
    cap: u64,
    status: Option<Status>,
}

impl LambdaCursor {
    pub fn new(t: &LambdaTerm, cap: u64) -> LambdaCursor {
        LambdaCursor { current: t.clone(), steps: 0, cap, status: None }
    }

    /// The term as of the last emitted event (the initial term before the first `next`).
    pub fn term(&self) -> &LambdaTerm {
        &self.current
    }

    pub fn steps_taken(&self) -> u64 {
        self.steps
    }

    /// `None` while the run may still advance; `Some` once it has ended, saying why.
    pub fn status(&self) -> Option<Status> {
        self.status
    }
}

impl Iterator for LambdaCursor {
    type Item = StepEvent;

    fn next(&mut self) -> Option<StepEvent> {
        if self.status.is_some() {
            return None;
        }
        if self.steps >= self.cap {
            self.status = Some(Status::HitCap);
            return None;
        }
        // The depth guard is checked BEFORE the step, and the term is left unreduced when it fires.
        // That ordering is the contract `reduce_trace` had before it delegated here: a term deeper
        // than the reducer can safely recurse over yields `HitCap`, not a native stack overflow.
        if depth_exceeds(&self.current, MAX_TERM_DEPTH) {
            self.status = Some(Status::HitCap);
            return None;
        }
        match reduce_step(&self.current) {
            Some((next, redex)) => {
                self.current = next;
                self.steps += 1;
                Some(StepEvent::Beta { redex })
            }
            None => {
                self.status = Some(Status::Normalized);
                None
            }
        }
    }
}

/// Lazy δ-stepping, and THE δ-stepping loop in this crate. `sim::run` — the single implementation behind
/// `simulate`, `simulate_final`, `simulate_watched`, `simulate_trace` and `simulate_counts` — is written
/// over this cursor, so the guard sequence below exists once rather than once per backend. Borrowing the
/// machine and owning only the tapes also makes the cursor O(tape size) rather than O(steps), where
/// `sim::simulate_trace` copies every tape on every step by contract.
///
/// THE GUARD ORDER IS THEREFORE THE SIMULATOR'S SEMANTICS, not a copy of them: a cursor that ended a run
/// one step earlier or later would move all five entry points with it. The sequence is: absurd declared
/// tape count (checked in `new`, before allocating, so an enormous `Machine::tapes` caps instead of
/// attempting that many allocations) → missing state → accepting state → step cap → live-cell cap → no
/// matching rule ("stuck == halt") → malformed rule. Only after all of those does a step get emitted,
/// which is why a malformed rule produces no event — and so no `sim::Step` in a recorded trace, since
/// `run` records exactly the steps this cursor emits.
///
/// NOT EVERY ADJACENT PAIR IN THAT SEQUENCE IS ORDER-CRITICAL, and saying "the order is load-bearing"
/// without saying which pairs actually bear load is how a docstring outlives its guarantee. The
/// accepting-state check MUST precede the step cap: at `caps.steps` set to exactly the number of steps
/// the machine takes, the correct answer is `Halted` (a budget spent exactly is not a budget exceeded),
/// and swapping those two yields `HitCap`. `tests/trace_equivalence.rs`'s
/// `at_the_exact_step_budget_the_cursor_halts_rather_than_capping` is the only test that distinguishes
/// them — every other capped case there trips strictly before the machine would have halted. By
/// contrast the step cap and the live-cell cap are genuinely interchangeable: both return `HitCap` with
/// no side effect on either path, so no test can tell them apart and none should pretend to.
///
/// `rule_matches` and `apply` stay in `sim` because they read `Tape`'s private zipper; this is their only
/// caller.
pub struct TmCursor<'m> {
    machine: &'m Machine,
    tapes: Vec<Tape>,
    cur: StateId,
    steps: u64,
    caps: TmCaps,
    status: Option<TmStatus>,
}

impl<'m> TmCursor<'m> {
    pub fn new(m: &'m Machine, init: &[Vec<Symbol>], caps: TmCaps) -> TmCursor<'m> {
        // Before allocating a `Tape` per declared tape: a machine declaring e.g. `tapes 10_000_000_000`
        // must hit the cap, not attempt that many allocations. `run` guards this the same way.
        if m.tapes as u64 > caps.cells {
            return TmCursor {
                machine: m,
                tapes: Vec::new(),
                cur: m.start,
                steps: 0,
                caps,
                status: Some(TmStatus::HitCap),
            };
        }
        let tapes = (0..m.tapes).map(|i| Tape::new(init.get(i).map_or(&[][..], Vec::as_slice))).collect();
        TmCursor { machine: m, tapes, cur: m.start, steps: 0, caps, status: None }
    }

    /// The tapes as of the last emitted event.
    pub fn tapes(&self) -> &[Tape] {
        &self.tapes
    }

    /// The tapes by value, for a caller that has driven the cursor to its end and wants to keep them.
    /// `sim::run` returns owned tapes, so this is what spares it a full copy of the final configuration.
    pub fn into_tapes(self) -> Vec<Tape> {
        self.tapes
    }

    /// The state the machine is in now — before the next transition, and the final state once ended.
    pub fn state(&self) -> StateId {
        self.cur
    }

    pub fn steps_taken(&self) -> u64 {
        self.steps
    }

    /// `None` while the run may still advance; `Some` once it has ended, saying why.
    pub fn status(&self) -> Option<TmStatus> {
        self.status
    }

    /// Record why the run ended and yield nothing further.
    fn end(&mut self, status: TmStatus) -> Option<StepEvent> {
        self.status = Some(status);
        None
    }
}

impl Iterator for TmCursor<'_> {
    type Item = StepEvent;

    fn next(&mut self) -> Option<StepEvent> {
        if self.status.is_some() {
            return None;
        }
        let Some(state) = self.machine.states.get(self.cur as usize) else {
            return self.end(TmStatus::Halted);
        };
        if state.accept {
            return self.end(TmStatus::Halted);
        }
        if self.steps >= self.caps.steps {
            return self.end(TmStatus::HitCap);
        }
        let total: usize = self.tapes.iter().map(Tape::cells).sum();
        if total as u64 > self.caps.cells {
            return self.end(TmStatus::HitCap);
        }
        let Some(rule_index) = state.rules.iter().position(|r| rule_matches(&r.read, &self.tapes)) else {
            return self.end(TmStatus::Halted); // stuck == halt
        };
        let rule = &state.rules[rule_index];
        if (rule.next as usize) >= self.machine.states.len()
            || rule.write.len() != self.machine.tapes
            || rule.moves.len() != self.machine.tapes
        {
            return self.end(TmStatus::Halted); // defensive: malformed rule
        }
        // Built before `apply`, so the event names the state the machine was in when the rule fired —
        // the same "before the transition" convention `sim::Step` and `LambdaCursor` use.
        let event = StepEvent::Delta { state: self.cur, rule: rule_index as u32 };
        apply(rule, &mut self.tapes);
        self.cur = rule.next;
        self.steps += 1;
        Some(event)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lambda::{MAX_REDUCTION_STEPS, lower, reduce_trace};

    fn term_of(src: &str) -> crate::lambda::LambdaTerm {
        let (p, ds) = crate::parser::parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        lower(&crate::desugar::desugar(&p.unwrap())).expect("lowers")
    }

    #[test]
    fn lambda_cursor_emits_the_same_redex_paths_as_reduce_trace() {
        for src in ["1 + 2 * 3", "3 - 5", "let x = 1; let y = x + x; y * 3"] {
            let t = term_of(src);
            let expected: Vec<_> =
                reduce_trace(&t, MAX_REDUCTION_STEPS).steps.iter().map(|s| s.redex.clone()).collect();
            let got: Vec<_> = LambdaCursor::new(&t, MAX_REDUCTION_STEPS)
                .map(|e| match e {
                    StepEvent::Beta { redex } => redex,
                    other => panic!("lambda cursor emitted a non-Beta event: {other:?}"),
                })
                .collect();
            assert_eq!(got, expected, "redex paths differ for {src:?}");
        }
    }

    #[test]
    fn lambda_cursor_ends_on_the_same_normal_form() {
        let t = term_of("1 + 2 * 3");
        let expected = reduce_trace(&t, MAX_REDUCTION_STEPS).normal_form;
        let mut c = LambdaCursor::new(&t, MAX_REDUCTION_STEPS);
        while c.next().is_some() {}
        assert_eq!(*c.term(), expected);
    }

    /// `Step::term` is documented as the term *before* the step, and the cursor advances before it
    /// returns — so `reduce_trace` must snapshot ahead of each `next`. Walking the two in lockstep
    /// fails if that clone is taken after the step instead.
    #[test]
    fn reduce_trace_records_the_term_before_each_step() {
        let t = term_of("let x = 1; let y = x + x; y * 3");
        let tr = reduce_trace(&t, MAX_REDUCTION_STEPS);
        assert!(tr.steps.len() > 2, "need a multi-step term");
        let mut c = LambdaCursor::new(&t, MAX_REDUCTION_STEPS);
        for (i, step) in tr.steps.iter().enumerate() {
            assert_eq!(step.term, *c.term(), "step {i} did not record the term before the step");
            assert!(c.next().is_some(), "the cursor ran out at step {i}");
        }
        assert_eq!(c.next(), None);
        assert_eq!(*c.term(), tr.normal_form);
    }

    /// The depth guard runs BEFORE the step and leaves the term unreduced. A church numeral past the
    /// limit is already in normal form, so a cursor that skipped the guard would report `Normalized`.
    #[test]
    fn a_term_past_the_depth_limit_hits_the_cap_before_it_is_stepped() {
        let deep = crate::lambda::encode::church(u64::from(crate::lambda::reduce::MAX_TERM_DEPTH) + 5_000);
        let mut c = LambdaCursor::new(&deep, MAX_REDUCTION_STEPS);
        assert_eq!(c.next(), None);
        assert_eq!(c.status(), Some(Status::HitCap), "the depth guard must fire before reduce_step");
        assert_eq!(*c.term(), deep, "the term must come back unreduced");
        assert_eq!(c.steps_taken(), 0);
        let tr = reduce_trace(&deep, MAX_REDUCTION_STEPS);
        assert_eq!(tr.status, Status::HitCap);
        assert!(tr.steps.is_empty());
    }

    /// Stopping at the step cap is the cursor's decision, and `reduce_trace` inherits it: same step
    /// count, same partly-reduced term, same `HitCap`.
    #[test]
    fn the_cursor_and_reduce_trace_stop_at_the_step_cap_together() {
        let t = term_of("1 + 2 * 3");
        let full = reduce_trace(&t, MAX_REDUCTION_STEPS).steps.len() as u64;
        assert!(full > 2, "need a multi-step term");
        let cap = full - 1;
        let mut c = LambdaCursor::new(&t, cap);
        assert_eq!(c.by_ref().count() as u64, cap);
        assert_eq!(c.status(), Some(Status::HitCap));
        assert_eq!(c.steps_taken(), cap);
        let tr = reduce_trace(&t, cap);
        assert_eq!(tr.status, Status::HitCap);
        assert_eq!(tr.steps.len() as u64, cap);
        assert_eq!(tr.normal_form, *c.term());
    }

    /// ADDING A `StepEvent` VARIANT MUST FAIL TO COMPILE HERE, and that is this test's whole purpose —
    /// it asserts nothing a reader could not predict, and exists for the build error it causes.
    ///
    /// Both consumers of a cursor end their loop on an event they do not recognise: `sim::run` uses a
    /// `let ... else break`, `lambda::reduce_trace` a `Some(_) => break`. Neither may assert the case
    /// away, because the no-panic rule forbids it on a library path. That is correct today, when each
    /// cursor provably emits exactly one variant — and silently wrong the moment a third exists, since
    /// a new variant would truncate every run rather than fail. The wildcard that keeps them total is
    /// the same wildcard that would hide the bug.
    ///
    /// This match has no wildcard, so a new variant breaks the build and forces someone to decide what
    /// each consumer should do with it. Same device as `analysis::class_of`, which is exhaustive over
    /// `TokenKind` so a new token cannot silently classify as punctuation, and `Core::for_each_child`,
    /// which lists all thirteen variants so a new one cannot go unvisited.
    #[test]
    fn every_step_event_variant_has_a_declared_producer() {
        fn producer(e: &StepEvent) -> &'static str {
            match e {
                StepEvent::Beta { .. } => "LambdaCursor",
                StepEvent::Delta { .. } => "TmCursor",
            }
        }
        assert_eq!(producer(&StepEvent::Beta { redex: Vec::new() }), "LambdaCursor");
        assert_eq!(producer(&StepEvent::Delta { state: 0, rule: 0 }), "TmCursor");
    }
}
