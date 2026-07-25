//! Iterative, bounded simulator for the multi-tape Turing machine. Deterministic (first matching rule
//! wins). A zipper tape gives O(1) head moves; a step cap + total-cells cap bound every run, so no
//! input hangs or overflows the native stack. Defensive on a malformed `Machine` (halts, never panics).

use crate::tm::machine::{BLANK, Machine, Move, Rule, StateId, Symbol};

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

    fn cells(&self) -> usize {
        self.left.len() + 1 + self.right.len()
    }

    /// Materialize as `(contents left-to-right, head index)`.
    pub fn snapshot(&self) -> (Vec<Symbol>, usize) {
        let mut cells = self.left.clone();
        let head = cells.len();
        cells.push(self.head);
        cells.extend(self.right.iter().rev());
        (cells, head)
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

fn rule_matches(read: &[Option<Symbol>], tapes: &[Tape]) -> bool {
    read.len() == tapes.len()
        && read.iter().zip(tapes).all(|(pat, t)| match pat {
            None => true,
            Some(s) => *s == t.read(),
        })
}

fn apply(rule: &Rule, tapes: &mut [Tape]) {
    for (i, t) in tapes.iter_mut().enumerate() {
        if let Some(s) = rule.write[i] {
            t.write(s);
        }
        t.step(rule.moves[i]);
    }
}

/// The shared iterative loop. `record` optionally collects a step trace; `counts` optionally
/// accumulates a per-state step tally (indexed by state id, charging the state being *left*).
/// Defensive on a malformed machine (missing state / out-of-range target / stuck state all halt).
fn run(
    m: &Machine,
    init: &[Vec<Symbol>],
    caps: Caps,
    mut record: Option<&mut Vec<Step>>,
    mut counts: Option<&mut Vec<u64>>,
) -> (Vec<Tape>, StateId, Status) {
    // `m.tapes` is an unbounded `usize` from the machine (not yet validated here); the initial live
    // cell count is >= the tape count (each tape starts with >= 1 cell), so the cells cap already
    // implies this bound. Guard it *before* allocating a `Tape` per declared tape, so a machine
    // declaring e.g. `tapes 10_000_000_000` hits the cap instead of attempting that many allocations.
    if m.tapes as u64 > caps.cells {
        return (Vec::new(), m.start, Status::HitCap);
    }
    let mut tapes: Vec<Tape> = (0..m.tapes).map(|i| Tape::new(init.get(i).map_or(&[][..], Vec::as_slice))).collect();
    let mut cur = m.start;
    let mut steps = 0u64;
    loop {
        let Some(state) = m.states.get(cur as usize) else {
            return (tapes, cur, Status::Halted);
        };
        if state.accept {
            return (tapes, cur, Status::Halted);
        }
        if steps >= caps.steps {
            return (tapes, cur, Status::HitCap);
        }
        let total: usize = tapes.iter().map(Tape::cells).sum();
        if total as u64 > caps.cells {
            return (tapes, cur, Status::HitCap);
        }
        let Some(rule) = state.rules.iter().find(|r| rule_matches(&r.read, &tapes)) else {
            return (tapes, cur, Status::Halted); // stuck == halt
        };
        if (rule.next as usize) >= m.states.len() || rule.write.len() != m.tapes || rule.moves.len() != m.tapes {
            return (tapes, cur, Status::Halted); // defensive: malformed rule
        }
        if let Some(rec) = record.as_deref_mut() {
            rec.push(Step { state: cur, tapes: tapes.iter().map(Tape::snapshot).collect() });
        }
        apply(rule, &mut tapes);
        if let Some(c) = counts.as_deref_mut()
            && let Some(slot) = c.get_mut(cur as usize)
        {
            // `cur` indexed `m.states` successfully above and `simulate_counts` sizes `counts` from
            // that same machine, so this is in bounds on every real call. `get_mut` rather than `[]`
            // makes the "never panics" contract line above structurally true instead of true by
            // argument — a caller passing a short `counts` loses tallies rather than panicking.
            *slot = slot.saturating_add(1);
        }
        cur = rule.next;
        steps += 1;
    }
}

/// Simulate to a halt or a cap, without retaining the step trace.
pub fn simulate(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<Tape>, Status) {
    let (tapes, _final, status) = run(m, init, caps, None, None);
    (tapes, status)
}

/// Simulate, recording every step (before it is applied) for the scrubbable trace / view models.
pub fn simulate_trace(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> Trace {
    let mut steps = Vec::new();
    let (tapes, final_state, status) = run(m, init, caps, Some(&mut steps), None);
    let final_tapes = tapes.iter().map(Tape::snapshot).collect();
    Trace { steps, final_state, final_tapes, status }
}

/// Simulate `m`, accumulating how many steps were taken *in* each state, indexed by state id.
///
/// The counting analogue of `simulate_trace`, and the reason it exists: a trace records tapes per
/// step, so counting a 178k-step program through it would allocate 178k tape snapshots. This
/// allocates one `u64` per state, once.
pub fn simulate_counts(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<u64>, Status) {
    let mut counts = vec![0u64; m.states.len()];
    let (_tapes, _final, status) = run(m, init, caps, None, Some(&mut counts));
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
