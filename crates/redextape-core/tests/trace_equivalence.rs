//! The cursor must agree with the shipped simulator step for step. If a replayed delta stream and a
//! direct simulation diverge, every consumer silently disagrees with the oracle while both traces
//! still look well-formed — so this is the crux test of the slice, not a nicety.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use redextape_core::desugar::desugar;
use redextape_core::lambda::Status;
use redextape_core::parser::parse;
use redextape_core::tm::{
    BLANK, Encoding, Machine, Move, REG, Rule, State, Symbol, TAPES, TM_DEFAULT_CAPS, TmCaps, TmStatus, Unary, WORK,
    defunc, lower_asm, lower_tm, n_slots_of, parse_tm, simulate_trace,
};
use redextape_core::trace::{LambdaCursor, StepEvent, TmCursor};

const CORPUS: &[&str] = &["1 + 2 * 3", "3 - 5", "if 2 > 1 { 10 } else { 20 }", "[1, 2, 3]"];

fn machine_and_init(src: &str) -> (Machine, Vec<Vec<Symbol>>) {
    let (p, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
    let core = desugar(&p.unwrap());
    let prog = match lower_asm(&core) {
        Ok(p) => p,
        Err(_) => lower_asm(&defunc(&core).expect("defunc")).expect("lower"),
    };
    let enc = Unary::default();
    let m = lower_tm(&prog, &enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots_of(&prog));
    init[WORK] = enc.init_work();
    (m, init)
}

/// A small closed term that reaches a normal form, for tests that need `Status::Normalized` rather
/// than a capped or open-ended run. Same three-step shape `syntax.rs`'s
/// `printed_lowering_of_every_demo_reparses` uses: parse, desugar, `lower`.
fn closed_normalizing_term() -> redextape_core::lambda::LambdaTerm {
    let (program, _) = redextape_core::parser::parse("let x = 1; x + 2");
    let core = redextape_core::desugar::desugar(&program.expect("parses"));
    redextape_core::lambda::lower(&core).expect("a first-order program lowers")
}

/// Collect the cursor's events, insisting every one is a `Delta` (the TM backend emits nothing else).
fn deltas<'m>(m: &'m Machine, init: &[Vec<Symbol>], caps: TmCaps) -> (Vec<(u32, u32)>, TmCursor<&'m Machine>) {
    let mut c = TmCursor::new(m, init, caps);
    let mut out = Vec::new();
    for e in c.by_ref() {
        match e {
            StepEvent::Delta { state, rule } => out.push((state, rule)),
            other => panic!("TM cursor emitted a non-Delta event: {other:?}"),
        }
    }
    (out, c)
}

/// An *independent* model of `sim::Tape`, written from the documented semantics rather than reusing
/// the zipper under test: a flat cell vector plus a head index, growing a lazy blank at either end.
/// This is what makes the replay below an oracle instead of a restatement of the implementation.
#[derive(Clone, PartialEq, Eq, Debug)]
struct FlatTape {
    cells: Vec<Symbol>,
    head: usize,
}

impl FlatTape {
    fn new(init: &[Symbol]) -> FlatTape {
        if init.is_empty() {
            FlatTape { cells: vec![BLANK], head: 0 }
        } else {
            FlatTape { cells: init.to_vec(), head: 0 }
        }
    }

    fn apply(&mut self, write: Option<Symbol>, mv: Move) {
        if let Some(s) = write {
            self.cells[self.head] = s;
        }
        match mv {
            Move::S => {}
            Move::L => {
                if self.head == 0 {
                    self.cells.insert(0, BLANK);
                } else {
                    self.head -= 1;
                }
            }
            Move::R => {
                self.head += 1;
                if self.head == self.cells.len() {
                    self.cells.push(BLANK);
                }
            }
        }
    }
}

/// Resolve a delta stream against the machine and replay it onto fresh tapes. Every write and head
/// move comes from `m.states[state].rules[rule]` — which is the entire premise of the delta being a
/// rule *reference* rather than a copy of its effects. A wrong `rule` index therefore replays wrong.
fn replay(m: &Machine, init: &[Vec<Symbol>], stream: &[(u32, u32)]) -> Vec<(Vec<Symbol>, usize)> {
    let mut tapes: Vec<FlatTape> =
        (0..m.tapes).map(|i| FlatTape::new(init.get(i).map_or(&[][..], Vec::as_slice))).collect();
    for &(state, rule) in stream {
        let st = m.states.get(state as usize).expect("delta names a real state");
        let r = st.rules.get(rule as usize).expect("delta names a real rule of that state");
        for (i, t) in tapes.iter_mut().enumerate() {
            t.apply(r.write[i], r.moves[i]);
        }
    }
    tapes.into_iter().map(|t| (t.cells, t.head)).collect()
}

#[test]
fn the_cursor_visits_the_same_states_as_simulate_trace() {
    for src in CORPUS {
        let (m, init) = machine_and_init(src);
        let expected: Vec<u32> = simulate_trace(&m, &init, TM_DEFAULT_CAPS).steps.iter().map(|s| s.state).collect();
        let (stream, _c) = deltas(&m, &init, TM_DEFAULT_CAPS);
        let got: Vec<u32> = stream.iter().map(|&(state, _)| state).collect();
        assert!(!got.is_empty(), "{src:?} produced no steps, so this compares nothing");
        assert_eq!(got, expected, "state sequence differs for {src:?}");
    }
}

/// THE CRUX. Resolving `(state, rule)` through the machine and replaying it must land on the tapes the
/// shipped simulator produced. Draining the cursor and reading `c.tapes()` would NOT test this — the
/// cursor applies the rule it selected regardless of the index it reported, so a delta stream naming
/// the wrong rule would still leave correct tapes behind. Only an independent replay catches that.
#[test]
fn replaying_the_delta_stream_reproduces_the_final_tapes() {
    for src in CORPUS {
        let (m, init) = machine_and_init(src);
        let oracle = simulate_trace(&m, &init, TM_DEFAULT_CAPS);
        let (stream, c) = deltas(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(replay(&m, &init, &stream), oracle.final_tapes, "replayed delta stream differs for {src:?}");
        // The cursor's own tapes must agree too, and it must stop where and why the simulator stopped.
        let direct: Vec<(Vec<Symbol>, usize)> = c.tapes().iter().map(redextape_core::tm::Tape::snapshot).collect();
        assert_eq!(direct, oracle.final_tapes, "cursor tapes differ for {src:?}");
        assert_eq!(c.state(), oracle.final_state, "final state differs for {src:?}");
        assert_eq!(c.status(), Some(oracle.status), "final status differs for {src:?}");
    }
}

/// The rules a delta names are the ones that actually fired: for each step, the referenced rule's read
/// pattern must match the tapes at that point in the replay. This pins the index to the *first*
/// matching rule (determinism), which a stream naming any other matching rule would break.
#[test]
fn each_delta_names_the_first_rule_that_matched_at_that_step() {
    for src in CORPUS {
        let (m, init) = machine_and_init(src);
        let (stream, _c) = deltas(&m, &init, TM_DEFAULT_CAPS);
        let mut tapes: Vec<FlatTape> =
            (0..m.tapes).map(|i| FlatTape::new(init.get(i).map_or(&[][..], Vec::as_slice))).collect();
        for (i, &(state, rule)) in stream.iter().enumerate() {
            let st = &m.states[state as usize];
            let matches = |r: &Rule| {
                r.read.len() == tapes.len()
                    && r.read.iter().zip(&tapes).all(|(p, t)| p.is_none_or(|s| s == t.cells[t.head]))
            };
            let first = st.rules.iter().position(matches).expect("some rule matched, or the run would have halted");
            assert_eq!(rule as usize, first, "{src:?} step {i}: delta names rule {rule}, first match is {first}");
            let r = &st.rules[rule as usize];
            for (j, t) in tapes.iter_mut().enumerate() {
                t.apply(r.write[j], r.moves[j]);
            }
        }
    }
}

/// A machine whose tape count is NOT `TAPES`. Nothing else in the suite exercises this, because every
/// machine the lowering builds has five tapes — so a design that quietly assumed five would pass
/// everything else. This is the regression guard for that class of bug.
#[test]
fn a_machine_with_a_non_default_tape_count_traces_end_to_end() {
    let src = "tapes 2\nstart s0\n\nstate halt: accept\nstate s0:\n  [a *] -> write [b *], move [R S], goto halt\n";
    let (m, ds) = parse_tm(src);
    assert!(ds.is_empty(), "TM text did not parse: {ds:?}");
    let m = m.expect("machine parses");
    assert_eq!(m.tapes, 2, "the fixture must not have five tapes, or it guards nothing");
    assert_ne!(m.tapes, TAPES, "the fixture must differ from the lowering's tape count");
    let init = vec![vec!['a', 'b'], vec!['_', '_']];
    let oracle = simulate_trace(&m, &init, TM_DEFAULT_CAPS);
    let (stream, c) = deltas(&m, &init, TM_DEFAULT_CAPS);
    let got: Vec<u32> = stream.iter().map(|&(state, _)| state).collect();
    let expected: Vec<u32> = oracle.steps.iter().map(|s| s.state).collect();
    assert!(!got.is_empty(), "the two-tape fixture took no steps, so it guards nothing");
    assert_eq!(got, expected, "a two-tape machine must trace like any other");
    assert_eq!(replay(&m, &init, &stream), oracle.final_tapes, "two-tape replay differs");
    assert_eq!(c.tapes().len(), 2, "the cursor must allocate the machine's tape count, not TAPES");
    assert_eq!(c.status(), Some(oracle.status));
}

/// THE BOUNDARY WHERE HALTING AND STEP-EXHAUSTION COINCIDE: `caps.steps` set to exactly the number of
/// steps the machine takes. `run` checks the accepting state BEFORE the step cap, so the correct answer
/// is `Halted` — the machine reached its accept state on the very step that exhausted the budget, and a
/// budget spent exactly is not a budget exceeded.
///
/// This case is what distinguishes an order-CRITICAL guard pair from a merely-ordered one. Swapping the
/// accept-state and step-cap checks in `TmCursor::next` leaves the rest of this file green, because
/// every other cap here trips strictly before the machine would have halted; only at `steps == full` do
/// the two guards disagree, and then the mutant reports `HitCap` where the oracle reports `Halted`.
#[test]
fn at_the_exact_step_budget_the_cursor_halts_rather_than_capping() {
    let (m, init) = machine_and_init("1 + 2 * 3");
    let full = simulate_trace(&m, &init, TM_DEFAULT_CAPS).steps.len() as u64;
    assert!(full > 10, "need a multi-step program, got {full}");
    let caps = TmCaps { steps: full, ..TM_DEFAULT_CAPS };
    let oracle = simulate_trace(&m, &init, caps);
    assert_eq!(oracle.status, TmStatus::Halted, "spending the budget exactly must halt, not cap");
    let (stream, c) = deltas(&m, &init, caps);
    assert_eq!(stream.len() as u64, full, "the cursor must take every step the simulator did");
    assert_eq!(c.status(), Some(TmStatus::Halted), "the cursor must agree it halted, not capped");
    assert_eq!(c.state(), oracle.final_state, "final state differs at the exact budget");
    assert_eq!(replay(&m, &init, &stream), oracle.final_tapes, "replay differs at the exact budget");
}

/// The guards that end a run are order-sensitive, and only the halting corpus above exercises the
/// halt path. Squeezing each cap in turn makes the cursor and the simulator agree on the *capped*
/// outcomes too: same number of steps, same final state, same status, same tapes.
///
/// Every cap below trips strictly BEFORE the machine would have halted, which is why none of them can
/// tell an order-critical guard pair from an order-independent one — see
/// `at_the_exact_step_budget_the_cursor_halts_rather_than_capping` for the case that can.
#[test]
fn the_cursor_hits_each_cap_exactly_where_the_simulator_does() {
    let (m, init) = machine_and_init("1 + 2 * 3");
    let full = simulate_trace(&m, &init, TM_DEFAULT_CAPS).steps.len() as u64;
    assert!(full > 10, "need a multi-step program, got {full}");
    for caps in [
        TmCaps { steps: full - 1, ..TM_DEFAULT_CAPS },
        TmCaps { steps: full / 2, ..TM_DEFAULT_CAPS },
        TmCaps { steps: 0, ..TM_DEFAULT_CAPS },
        TmCaps { steps: u64::MAX, cells: 40 },
    ] {
        let oracle = simulate_trace(&m, &init, caps);
        assert_eq!(oracle.status, TmStatus::HitCap, "this cap must actually trip: {caps:?}");
        let (stream, c) = deltas(&m, &init, caps);
        let got: Vec<u32> = stream.iter().map(|&(state, _)| state).collect();
        let expected: Vec<u32> = oracle.steps.iter().map(|s| s.state).collect();
        assert_eq!(got, expected, "capped state sequence differs for {caps:?}");
        assert_eq!(replay(&m, &init, &stream), oracle.final_tapes, "capped replay differs for {caps:?}");
        assert_eq!(c.state(), oracle.final_state, "capped final state differs for {caps:?}");
        assert_eq!(c.status(), Some(TmStatus::HitCap), "capped status differs for {caps:?}");
        // Exhausted means exhausted: a cursor that reported a status but kept stepping would break
        // every consumer that drains it twice.
        let mut c = c;
        assert_eq!(c.next(), None, "an ended cursor must stay ended");
    }
}

/// `run` guards an absurd declared tape count *before* allocating a `Tape` per tape. The cursor must
/// do the same, or `TmCursor::new` OOMs on a machine `simulate` merely caps.
#[test]
fn an_absurd_tape_count_hits_the_cap_without_allocating() {
    let m = Machine {
        tapes: 10_000_000,
        start: 0,
        states: vec![State { name: "halt".into(), accept: true, rules: vec![] }],
    };
    let oracle = simulate_trace(&m, &[], TM_DEFAULT_CAPS);
    assert_eq!(oracle.status, TmStatus::HitCap);
    let mut c = TmCursor::new(&m, &[], TM_DEFAULT_CAPS);
    assert_eq!(c.next(), None);
    assert_eq!(c.status(), Some(TmStatus::HitCap));
    assert!(c.tapes().is_empty(), "must not have allocated any tapes");
    assert_eq!(c.state(), oracle.final_state);
}

/// `raise_cap` must NOT clear the constructor's absurd-tape-count refusal: `TmCursor::new` never
/// allocated tapes on this path (`init` was not retained either), so there is nothing to continue
/// FROM. Before the guard, clearing `HitCap` here let `next` run with zero allocated tapes against a
/// machine declaring `tapes > 0` — `rule_matches` requires `read.len() == tapes.len()`, so no rule
/// ever matches and the "stuck == halt" path reported a terminal, WRONG `Halted` for a machine that
/// never took a single step.
#[test]
fn raise_cap_does_not_resurrect_the_absurd_tape_count_refusal() {
    // Non-accepting, with a rule that reads as many symbols as the machine declares tapes: this is
    // what makes the "stuck == halt" path below actually run through `rule_matches`, rather than
    // returning `Halted` from the accepting-state check before rule search is ever reached.
    let m = Machine {
        tapes: 2,
        start: 0,
        states: vec![State {
            name: "s".into(),
            accept: false,
            rules: vec![Rule {
                read: vec![None, None],
                write: vec![None, None],
                moves: vec![Move::S, Move::S],
                next: 0,
            }],
        }],
    };
    // `cells: 1` makes the constructor's refusal trip on `tapes: 2` (`machine.tapes as u64 > caps.cells`).
    let caps = TmCaps { cells: 1, ..TM_DEFAULT_CAPS };
    let mut c = TmCursor::new(&m, &[], caps);
    assert_eq!(c.next(), None);
    assert_eq!(c.status(), Some(TmStatus::HitCap));

    c.raise_cap(1000, u64::MAX);
    assert_eq!(
        c.status(),
        Some(TmStatus::HitCap),
        "the constructor's refusal must stay latched, not resurrect into a false answer"
    );
    assert!(c.tapes().is_empty(), "still must not have allocated any tapes");
    assert_eq!(c.next(), None, "an ended cursor must stay ended");
    assert_eq!(c.status(), Some(TmStatus::HitCap), "must not silently become Halted");
}

/// The ownership parameter must not change semantics. A cursor that borrows the machine and one that
/// owns it through an `Rc` are the same machine stepped the same way; if they ever diverge, the
/// generic introduced a behavioural difference where it was supposed to introduce only a type one.
/// Same device as `zipper_equivalence.rs` uses to hold the two β-loops equal.
#[test]
fn borrowed_and_owned_cursors_emit_identical_event_sequences() {
    use std::rc::Rc;
    for src in CORPUS {
        let (machine, init) = machine_and_init(src);
        let borrowed: Vec<StepEvent> = TmCursor::new(&machine, &init, TM_DEFAULT_CAPS).collect();
        let owned: Vec<StepEvent> = TmCursor::new(Rc::new(machine), &init, TM_DEFAULT_CAPS).collect();
        assert_eq!(borrowed, owned, "{src:?}: borrowed and owned cursors diverged");
    }
}

/// A rule whose `goto` is out of range must halt defensively — and must do so *without* emitting the
/// step, exactly as `run` skips its `record.push` on that path.
#[test]
fn a_malformed_rule_halts_the_cursor_without_emitting_a_step() {
    let m = Machine {
        tapes: 1,
        start: 0,
        states: vec![State {
            name: "s".into(),
            accept: false,
            rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![Move::S], next: 99 }],
        }],
    };
    let oracle = simulate_trace(&m, &[], TM_DEFAULT_CAPS);
    assert_eq!(oracle.status, TmStatus::Halted);
    assert!(oracle.steps.is_empty(), "the simulator must not record the malformed step");
    let (stream, c) = deltas(&m, &[], TM_DEFAULT_CAPS);
    assert!(stream.is_empty(), "the cursor must not emit the malformed step");
    assert_eq!(c.status(), Some(TmStatus::Halted));
    assert_eq!(c.state(), oracle.final_state);
}

/// Raising the cap on a capped run continues it — same tapes, same state, no restart. Rebuilding a
/// cursor cannot do this: `TmCursor::new` starts at `m.start` by construction.
#[test]
fn raising_the_tm_cap_continues_rather_than_restarts() {
    let (machine, init) = machine_and_init("1 + 2 * 3");
    let stingy = TmCaps { steps: 3, cells: 5_000_000 };
    let mut c = TmCursor::new(&machine, &init, stingy);
    let first: Vec<StepEvent> = c.by_ref().collect();
    assert_eq!(first.len(), 3, "precondition: the cap should bite at 3 steps");
    assert_eq!(c.status(), Some(TmStatus::HitCap));

    let state_at_cap = c.state();
    c.raise_cap(1_000_000, 0);
    assert_eq!(c.status(), None, "raise_cap must clear a latched HitCap");
    assert_eq!(c.state(), state_at_cap, "continuing must not rewind to m.start");

    let rest: Vec<StepEvent> = c.by_ref().collect();
    assert!(!rest.is_empty(), "the run should have continued");

    // The continued run must equal an uncapped run of the same machine, spliced.
    let whole: Vec<StepEvent> = TmCursor::new(&machine, &init, TM_DEFAULT_CAPS).collect();
    let spliced: Vec<StepEvent> = first.into_iter().chain(rest).collect();
    assert_eq!(spliced, whole, "capped-then-raised must reconstruct the uncapped run exactly");
}

/// Only HitCap is a budget outcome. Normalized/Halted/Rejected are facts about the computation, and a
/// finished run must not be resurrectable by handing it more budget.
#[test]
fn raising_the_cap_does_not_resurrect_a_finished_run() {
    let t = closed_normalizing_term();
    let mut c = LambdaCursor::new(&t, 1_000_000);
    let before: Vec<StepEvent> = c.by_ref().collect();
    assert_eq!(c.status(), Some(Status::Normalized), "precondition: this term normalizes");

    c.raise_cap(1_000_000);
    assert_eq!(c.status(), Some(Status::Normalized), "Normalized is terminal, not a budget outcome");
    assert_eq!(c.next(), None);
    assert_eq!(c.steps_taken() as usize, before.len(), "no further steps may be taken");
}

/// Additive, and saturating so there is no overflow path.
#[test]
fn raise_cap_is_additive_and_saturates() {
    let t = closed_normalizing_term();
    let mut c = LambdaCursor::new(&t, 1);
    c.by_ref().count();
    assert_eq!(c.status(), Some(Status::HitCap));
    c.raise_cap(u64::MAX);
    c.raise_cap(u64::MAX); // must not overflow
    assert_eq!(c.status(), None);
}

/// `HitCap` has two producers, and only the step cap is a budget outcome. Before the fix, `raise_cap`
/// cleared `HitCap` unconditionally, so calling it on a depth-refused term cleared the status, `next`
/// re-ran the same depth guard against the same (unreduced) term, and re-latched `HitCap` immediately
/// — a "continue" control that provably could never advance, however many times it was called.
#[test]
fn raise_cap_does_not_resurrect_a_depth_refused_run() {
    let deep =
        redextape_core::lambda::encode::church(u64::from(redextape_core::lambda::reduce::MAX_TERM_DEPTH) + 5_000);
    let mut c = LambdaCursor::new(&deep, u64::MAX);
    assert_eq!(c.next(), None);
    assert_eq!(c.status(), Some(Status::HitCap), "precondition: the depth guard must fire");
    assert_eq!(c.steps_taken(), 0);

    c.raise_cap(u64::MAX);
    assert_eq!(
        c.status(),
        Some(Status::HitCap),
        "a depth refusal must stay latched, not resurrect into a false continue"
    );
    assert_eq!(c.next(), None, "an ended cursor must stay ended");
    assert_eq!(c.steps_taken(), 0, "no step can ever be taken: the term's depth cannot change");
}
