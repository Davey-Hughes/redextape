//! Iterative, bounded simulator for the multi-tape Turing machine. Deterministic (first matching rule
//! wins). A zipper tape gives O(1) head moves; a step cap + total-cells cap bound every run, so no
//! input hangs or overflows the native stack. Defensive on a malformed `Machine` (halts, never panics).

use crate::tm::machine::{BLANK, Machine, Move, Rule, StateId, Symbol};
use crate::trace::{StepEvent, TmCursor};

/// Why the run stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Halted,
    HitCap,
}

/// Resource caps, mirroring the interpreter/λ budgets.
#[derive(Clone, Copy, Debug)]
pub struct Caps {
    pub steps: u64,
    pub cells: u64,
}

/// Generous defaults: the demo machines halt well within these; runaway machines hit a cap.
pub const DEFAULT_CAPS: Caps = Caps { steps: 5_000_000, cells: 5_000_000 };

/// One tape as a zipper. `left`/`right` are stacks growing away from the head; `left.last()` is the
/// cell immediately left of the head, `right.last()` immediately right. Blanks are lazy at the ends.
#[derive(Clone, Debug)]
pub struct Tape {
    left: Vec<Symbol>,
    head: Symbol,
    right: Vec<Symbol>,
}

impl Tape {
    /// A tape seeded with `init` left-to-right (head at the leftmost cell, or blank if empty).
    #[must_use]
    pub fn new(init: &[Symbol]) -> Tape {
        let mut it = init.iter().copied();
        let head = it.next().unwrap_or(BLANK);
        Tape { left: Vec::new(), head, right: it.rev().collect() }
    }

    fn read(&self) -> Symbol {
        self.head
    }

    fn write(&mut self, s: Symbol) {
        self.head = s;
    }

    fn step(&mut self, m: Move) {
        match m {
            Move::S => {}
            Move::L => {
                self.right.push(self.head);
                self.head = self.left.pop().unwrap_or(BLANK);
            }
            Move::R => {
                self.left.push(self.head);
                self.head = self.right.pop().unwrap_or(BLANK);
            }
        }
    }

    pub(crate) fn cells(&self) -> usize {
        self.left.len() + 1 + self.right.len()
    }

    /// Materialize as `(contents left-to-right, head index)`.
    #[must_use]
    pub fn snapshot(&self) -> (Vec<Symbol>, usize) {
        let mut cells = self.left.clone();
        let head = cells.len();
        cells.push(self.head);
        cells.extend(self.right.iter().rev());
        (cells, head)
    }

    /// The head's index into the tape *as currently materialized* — `left.len()` cells lie to its
    /// left. O(1), unlike `snapshot`, which clones the whole tape before computing the same value; a
    /// per-step caller (`viewmodel::TmState::window`) cannot pay that cost just to learn this index.
    #[must_use]
    pub fn head_index(&self) -> usize {
        self.left.len()
    }

    /// Up to `radius` cells left of the head, the head itself, and up to `radius` cells right of the
    /// head, in display (left-to-right) order — without materializing the rest of the tape. `snapshot`
    /// builds the entire tape before any slice is taken, which is the O(tape) cost this exists to
    /// avoid: `viewmodel::TmState::window` calls this once per tape per step, and `DEFAULT_CAPS.cells`
    /// alone permits 5,000,000 cells TOTAL ACROSS EVERY TAPE — `TmCursor::next` sums `Tape::cells()`
    /// over all of them and compares that one total against the cap, not against each tape
    /// individually — so a single tape can be far larger than that number would suggest.
    ///
    /// `left` is already in natural left-to-right order (built up as the head visits cells moving
    /// right — see `step`'s `Move::R` arm), so its slice needs no reversal; `right` is the mirror
    /// image, so its slice is reversed the same way `snapshot` reverses the whole of `right`.
    ///
    /// Returns `(window, window_start)`, where `window_start` is the index of `window[0]` in the same
    /// materialized-tape coordinates as `head_index` — so `head_index() - window_start` is always the
    /// head's position within the returned window.
    #[must_use]
    pub fn window(&self, radius: usize) -> (Vec<Symbol>, usize) {
        let left_len = self.left.len();
        let left_start = left_len.saturating_sub(radius);
        let right_len = self.right.len();
        let right_take = radius.min(right_len);
        let right_start = right_len.saturating_sub(right_take);

        let mut cells = Vec::with_capacity(left_len - left_start + 1 + right_take);
        cells.extend_from_slice(&self.left[left_start..]);
        cells.push(self.head);
        cells.extend(self.right[right_start..].iter().rev());

        (cells, left_start)
    }

    /// Cells `from..to` in materialized coordinates — the space `head_index` counts in and
    /// `viewmodel::TmState`'s `heads`/`window_start` report. Clamped at both ends and empty for an
    /// inverted range, so no argument value panics.
    ///
    /// THIS EXISTS SO SCROLLING DOES NOT COST A CLONE. `snapshot` materializes the whole tape; a
    /// renderer dragging a scrollbar calls this per frame, and paying O(tape) each time is the cost
    /// `TmState::window` was changed to stop paying.
    ///
    /// THE CLAMP IS OBSERVABLE FROM THE RESULT, which is why `cells` stays `pub(crate)`: a returned
    /// `Vec` shorter than `to - from` is exactly the signal that the range ran off an end, so a caller
    /// can tell "you asked past the end" from "the tape really is that short" without a length
    /// accessor. `slice`'s contract therefore does not need one, and none is added speculatively.
    ///
    /// The three arms below are `window`'s reasoning generalized to an arbitrary range rather than one
    /// centred on the head: `left` is already in natural left-to-right order, the head is the single
    /// cell at index `left.len()`, and `right` is the mirror image and so is reversed — an index `i`
    /// past the head reads `right[right.len() - (i - left.len())]`, which descends as `i` ascends.
    #[must_use]
    pub fn slice(&self, from: usize, to: usize) -> Vec<Symbol> {
        let len = self.cells();
        let (from, to) = (from.min(len), to.min(len));
        if from >= to {
            return Vec::new();
        }

        let left_len = self.left.len();
        let right_len = self.right.len();
        let mut cells = Vec::with_capacity(to - from);

        if from < left_len {
            cells.extend_from_slice(&self.left[from..to.min(left_len)]);
        }
        if from <= left_len && left_len < to {
            cells.push(self.head);
        }
        if to > left_len + 1 {
            // `start` is the first index in this range that lands in `right`; `from < to` guarantees
            // `start < to`, so the mapped range below is non-empty. Both bounds stay within `right`
            // because `to <= len` and `start <= to - 1`.
            let start = from.max(left_len + 1);
            let lo = right_len - (to - 1 - left_len);
            let hi = right_len - (start - left_len) + 1;
            cells.extend(self.right[lo..hi].iter().rev());
        }

        cells
    }
}

/// One recorded step: the state + tape snapshots *before* the rule was applied.
#[derive(Clone, Debug)]
pub struct Step {
    pub state: StateId,
    pub tapes: Vec<(Vec<Symbol>, usize)>,
}

#[derive(Clone, Debug)]
pub struct Trace {
    pub steps: Vec<Step>,
    pub final_state: StateId,
    pub final_tapes: Vec<(Vec<Symbol>, usize)>,
    pub status: Status,
}

/// The rule matcher, kept here beside `Tape` because it reads the zipper's private head. It has two
/// callers — `trace::TmCursor::next` and `viewmodel.rs`'s `TmState::window`, which resolves the rule
/// about to fire for the UI — and since `run` is written over `TmCursor` it is the crate's only
/// δ-matcher; `viewmodel.rs` calling it directly rather than re-deriving it is what keeps that true.
pub(crate) fn rule_matches(read: &[Option<Symbol>], tapes: &[Tape]) -> bool {
    read.len() == tapes.len()
        && read.iter().zip(tapes).all(|(pat, t)| match pat {
            None => true,
            Some(s) => *s == t.read(),
        })
}

/// A rule's writes and head moves, here for the same reason as `rule_matches`. Unlike it, this has a
/// single caller — `trace::TmCursor::next`. Nothing outside the cursor applies a rule, because nothing
/// outside the cursor owns tapes to apply it to.
pub(crate) fn apply(rule: &Rule, tapes: &mut [Tape]) {
    for (i, t) in tapes.iter_mut().enumerate() {
        if let Some(s) = rule.write[i] {
            t.write(s);
        }
        t.step(rule.moves[i]);
    }
}

/// An observer called with the tapes after every applied step; returning `false` stops the run. See
/// `simulate_watched`.
pub type Watcher<'a> = &'a mut dyn FnMut(&[Tape]) -> bool;

/// The shared driver behind all five entry points below. The δ-stepping itself — the guard sequence,
/// the matcher, the step accounting, the defensiveness on a malformed machine (missing state /
/// out-of-range target / stuck state all halt) — lives in `trace::TmCursor`, so that loop exists once in
/// this crate rather than twice; what remains here is the three optional recorders. `record` optionally
/// collects a step trace; `counts` optionally accumulates a per-state step tally (indexed by state id,
/// charging the state being *left*).
fn run(
    m: &Machine,
    init: &[Vec<Symbol>],
    caps: Caps,
    mut record: Option<&mut Vec<Step>>,
    mut counts: Option<&mut Vec<u64>>,
    mut watch: Option<Watcher<'_>>,
) -> (Vec<Tape>, StateId, Status, u64) {
    let mut cursor = TmCursor::new(m, init, caps);
    loop {
        // The tapes BEFORE this step — `next` applies the rule in place, so they cannot be read
        // afterwards. Taken only when a trace is being recorded, and dropped unused when the cursor ends
        // instead of stepping, which is what keeps a malformed rule (or a cap) from pushing a `Step`.
        let before: Option<Vec<(Vec<Symbol>, usize)>> =
            record.is_some().then(|| cursor.tapes().iter().map(Tape::snapshot).collect());
        // `state` is the state the machine was in when the rule fired, which is the convention `Step`
        // documents. A `TmCursor` emits nothing but `Delta`; stopping on anything else ends the run with
        // a well-formed result rather than panicking on a library path.
        let Some(StepEvent::Delta { state, .. }) = cursor.next() else {
            break;
        };
        // `before` is `Some` exactly when `record` is, so no applied step goes unrecorded.
        if let Some(rec) = record.as_deref_mut()
            && let Some(tapes) = before
        {
            rec.push(Step { state, tapes });
        }
        // The invariant hook (see `simulate_watched`): called on every applied step with the tapes as
        // they are *after* it, and a `false` return stops the run here. Reported as `Halted` — the
        // machine did not hit a cap, an observer chose to stop it — which keeps the hook from being
        // mistaken for a resource outcome. The state reported is the one the rule moved to, which is
        // what the cursor holds now that it has advanced.
        if let Some(w) = watch.as_deref_mut()
            && !w(cursor.tapes())
        {
            let stopped_in = cursor.state();
            let steps = cursor.steps_taken();
            return (cursor.into_tapes(), stopped_in, Status::Halted, steps);
        }
        if let Some(c) = counts.as_deref_mut()
            && let Some(slot) = c.get_mut(state as usize)
        {
            // `state` indexed `m.states` successfully inside the cursor and `simulate_counts` sizes
            // `counts` from that same machine, so this is in bounds on every real call. `get_mut` rather
            // than `[]` makes the "never panics" contract structurally true instead of true by
            // argument — a caller passing a short `counts` loses tallies rather than panicking.
            *slot = slot.saturating_add(1);
        }
    }
    let final_state = cursor.state();
    let steps = cursor.steps_taken();
    // `None` only if the loop broke on an event a `TmCursor` cannot emit; the run is over either way.
    let status = cursor.status().unwrap_or(Status::Halted);
    (cursor.into_tapes(), final_state, status, steps)
}

/// Simulate to a halt or a cap, without retaining the step trace.
#[must_use]
pub fn simulate(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<Tape>, Status) {
    let (tapes, _final, status, _steps) = run(m, init, caps, None, None, None);
    (tapes, status)
}

/// Simulate to a halt or a cap, reporting the final state and the δ-count alongside the tapes. The
/// state is what tells a caller *why* a machine halted — in particular whether it halted in the
/// overflow-guard state that `lower_tm_guarded` hands back. `simulate` is exactly this with the state
/// and the count discarded.
///
/// THE COUNT IS REPORTED HERE RATHER THAN BY A FIFTH WRAPPER, because it is a fact about the run
/// that every caller could use and none could previously reach — `run` has always counted it to
/// enforce the step cap.
#[must_use]
pub fn simulate_final(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<Tape>, StateId, Status, u64) {
    run(m, init, caps, None, None, None)
}

/// Simulate, calling `watch` with the tapes after every applied step; a `false` return stops the run
/// (reported as `Status::Halted`, since nothing hit a cap). The hook exists for invariant checking: it
/// is how a test asserts a property of every intermediate configuration rather than only of the final
/// one, which is what makes the overflow guard's completeness an observation rather than an argument
/// from enumerating write sites.
pub fn simulate_watched(
    m: &Machine,
    init: &[Vec<Symbol>],
    caps: Caps,
    watch: Watcher<'_>,
) -> (Vec<Tape>, StateId, Status) {
    let (tapes, final_state, status, _steps) = run(m, init, caps, None, None, Some(watch));
    (tapes, final_state, status)
}

/// Simulate, recording every step (before it is applied) for the scrubbable trace / view models.
pub fn simulate_trace(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> Trace {
    let mut steps = Vec::new();
    let (tapes, final_state, status, _steps) = run(m, init, caps, Some(&mut steps), None, None);
    let final_tapes = tapes.iter().map(Tape::snapshot).collect();
    Trace { steps, final_state, final_tapes, status }
}

/// Simulate `m`, accumulating how many steps were taken *in* each state, indexed by state id.
///
/// The counting analogue of `simulate_trace`, and the reason it exists: a trace records tapes per
/// step, so counting a 178k-step program through it would allocate 178k tape snapshots. This
/// allocates one `u64` per state, once.
#[must_use]
pub fn simulate_counts(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<u64>, Status) {
    let mut counts = vec![0u64; m.states.len()];
    let (_tapes, _final, status, _steps) = run(m, init, caps, None, Some(&mut counts), None);
    (counts, status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::machine::State;

    fn increment() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "scan".into(),
                    accept: false,
                    rules: vec![
                        Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 0 },
                        Rule { read: vec![None], write: vec![Some('1')], moves: vec![Move::S], next: 1 },
                    ],
                },
                State { name: "halt".into(), accept: true, rules: vec![] },
            ],
        }
    }

    /// A 1-tape machine that spends a *different, nonzero* number of steps in each of two non-accept
    /// states, so per-state counts can distinguish `c[state_being_left]` from `c[0]`.
    ///
    /// Phase A sweeps right over the `'1'`s (staying in state 0), then a wildcard rule hands off to
    /// state 1 without moving; phase B sweeps right over the `'2'`s, then a wildcard rule hands off
    /// to the accept state. Both hand-off rules are themselves steps, charged to the state they
    /// leave. On `['1','1','1','2','2','2','2','2']` that is 3+1 = 4 steps leaving state 0 and
    /// 5+1 = 6 steps leaving state 1 -- distinct and nonzero, which is what makes the count vector
    /// pin down the indexing.
    fn two_phase() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "phase_a".into(),
                    accept: false,
                    rules: vec![
                        Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 0 },
                        Rule { read: vec![None], write: vec![None], moves: vec![Move::S], next: 1 },
                    ],
                },
                State {
                    name: "phase_b".into(),
                    accept: false,
                    rules: vec![
                        Rule { read: vec![Some('2')], write: vec![None], moves: vec![Move::R], next: 1 },
                        Rule { read: vec![None], write: vec![None], moves: vec![Move::S], next: 2 },
                    ],
                },
                State { name: "halt".into(), accept: true, rules: vec![] },
            ],
        }
    }

    /// A 1-tape machine that never halts: move right forever.
    fn spin() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![State {
                name: "go".into(),
                accept: false,
                rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![Move::R], next: 0 }],
            }],
        }
    }

    #[test]
    fn increment_appends_a_mark() {
        let (tapes, status) = simulate(&increment(), &[vec!['1', '1', '1']], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        let (cells, _head) = tapes[0].snapshot();
        assert_eq!(cells, vec!['1', '1', '1', '1']);
    }

    #[test]
    fn increment_from_blank_writes_one_mark() {
        let (tapes, status) = simulate(&increment(), &[], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(tapes[0].snapshot().0, vec!['1']);
    }

    #[test]
    fn step_cap_stops_a_spinning_machine() {
        let (_t, status) = simulate(&spin(), &[], Caps { steps: 1000, ..DEFAULT_CAPS });
        assert_eq!(status, Status::HitCap);
    }

    #[test]
    fn cells_cap_stops_unbounded_tape_growth() {
        // spin() moves right forever, touching a new blank cell each step -> the cells cap trips.
        let (_t, status) = simulate(&spin(), &[], Caps { steps: u64::MAX, cells: 500 });
        assert_eq!(status, Status::HitCap);
    }

    #[test]
    fn trace_records_each_step_before_it_is_applied() {
        let trace = simulate_trace(&increment(), &[vec!['1', '1', '1']], DEFAULT_CAPS);
        assert_eq!(trace.status, Status::Halted);
        // 3 rightward moves over the marks + 1 write = 4 steps, then the accept state halts.
        assert_eq!(trace.steps.len(), 4);
        assert_eq!(trace.steps[0].state, 0);
        // The first snapshot is the initial tape.
        assert_eq!(trace.steps[0].tapes[0].0, vec!['1', '1', '1']);
        assert_eq!(trace.final_tapes[0].0, vec!['1', '1', '1', '1']);
    }

    #[test]
    fn a_huge_tape_count_hits_the_cap_instead_of_allocating() {
        // `tapes` is an unbounded `usize` from the machine; a machine declaring far more tapes than
        // the cells cap allows must hit the cap *before* allocating a `Tape` per declared tape, or a
        // machine like `tapes 10_000_000_000` OOMs/aborts the process on a rule-free accept state.
        // `tapes: 10_000_000` vs. `DEFAULT_CAPS.cells == 5_000_000` keeps this instant: the guard must
        // fire before the `collect`, not after touching cells during the loop.
        let m = Machine {
            tapes: 10_000_000,
            start: 0,
            states: vec![State { name: "halt".into(), accept: true, rules: vec![] }],
        };
        let (tapes, status) = simulate(&m, &[], DEFAULT_CAPS);
        assert_eq!(status, Status::HitCap);
        assert!(tapes.is_empty(), "must not have allocated any tapes");
    }

    #[test]
    fn per_state_counts_sum_to_the_total_step_count() {
        // Cross-check counting against tracing on the SAME machine: the trace's step list is the
        // independent ground truth for how many steps ran, and where.
        let m = increment();
        let trace = simulate_trace(&m, &[vec!['1', '1', '1']], DEFAULT_CAPS);
        let (counts, status) = simulate_counts(&m, &[vec!['1', '1', '1']], DEFAULT_CAPS);
        assert_eq!(counts.len(), m.states.len(), "counts must be indexed by state id");
        assert_eq!(counts.iter().sum::<u64>(), trace.steps.len() as u64, "counts must account for every step");
        assert_eq!(status, trace.status, "counting must not change the outcome");
        // Per-state agreement, not just the total: a counter that dumped every step into one bucket
        // would pass a sum-only check.
        for (state, &n) in counts.iter().enumerate() {
            let from_trace = trace.steps.iter().filter(|s| s.state == state as StateId).count() as u64;
            assert_eq!(n, from_trace, "state {state}: counted {n}, trace shows {from_trace}");
        }
    }

    #[test]
    fn counts_are_charged_to_the_state_actually_left_not_all_to_state_zero() {
        // The two fixtures above cannot catch a counter that ignores the current state: `increment()`
        // happens to leave state 0 on all four of its steps, and `spin()` has a single state. So both
        // would still pass if the increment were hardcoded to `c[0] += 1`, and the state-indexing
        // could regress silently -- which matters because these counts get folded through the source
        // map into a per-construct histogram, where "all cost in state 0's bucket" looks plausible
        // rather than obviously broken.
        //
        // `two_phase()` fixes that by spending a DISTINCT, NONZERO number of steps in two different
        // non-accept states. Hand-derived on `['1','1','1','2','2','2','2','2']`:
        //   state 0 (phase_a): 3 rightward moves over the '1's + 1 hand-off to phase_b   = 4
        //   state 1 (phase_b): 5 rightward moves over the '2's + 1 hand-off to halt      = 6
        //   state 2 (halt):    accept, never left                                        = 0
        // Distinct (4 != 6) so a swapped/collapsed index shows up; nonzero so neither is vacuous.
        let m = two_phase();
        let init = [vec!['1', '1', '1', '2', '2', '2', '2', '2']];
        let (counts, status) = simulate_counts(&m, &init, DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(counts, vec![4, 6, 0], "each step must be charged to the state it leaves");
        // Corroborate the hand-derivation against the trace, the same independent ground truth the
        // cross-check test uses.
        let trace = simulate_trace(&m, &init, DEFAULT_CAPS);
        assert_eq!(counts.iter().sum::<u64>(), trace.steps.len() as u64);
        for (state, &n) in counts.iter().enumerate() {
            let from_trace = trace.steps.iter().filter(|s| s.state == state as StateId).count() as u64;
            assert_eq!(n, from_trace, "state {state}: counted {n}, trace shows {from_trace}");
        }
    }

    #[test]
    fn counting_a_capped_run_still_accounts_for_every_step_taken() {
        let m = spin();
        let caps = Caps { steps: 1000, ..DEFAULT_CAPS };
        let (counts, status) = simulate_counts(&m, &[], caps);
        assert_eq!(status, Status::HitCap);
        assert_eq!(counts.iter().sum::<u64>(), 1000, "a capped run must still count exactly the steps it took");
    }

    #[test]
    fn a_malformed_machine_halts_rather_than_panicking() {
        // A rule whose `next` is out of range must halt defensively, not index-panic.
        let m = Machine {
            tapes: 1,
            start: 0,
            states: vec![State {
                name: "s".into(),
                accept: false,
                rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![Move::S], next: 99 }],
            }],
        };
        let (_t, status) = simulate(&m, &[], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
    }
}
