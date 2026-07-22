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

/// The shared iterative loop. `record` optionally collects a step trace. Defensive on a malformed
/// machine (missing state / out-of-range target / stuck state all halt).
fn run(
    m: &Machine,
    init: &[Vec<Symbol>],
    caps: Caps,
    mut record: Option<&mut Vec<Step>>,
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
        cur = rule.next;
        steps += 1;
    }
}

/// Simulate to a halt or a cap, without retaining the step trace.
pub fn simulate(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<Tape>, Status) {
    let (tapes, _final, status) = run(m, init, caps, None);
    (tapes, status)
}

/// Simulate, recording every step (before it is applied) for the scrubbable trace / view models.
pub fn simulate_trace(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> Trace {
    let mut steps = Vec::new();
    let (tapes, final_state, status) = run(m, init, caps, Some(&mut steps));
    let final_tapes = tapes.iter().map(Tape::snapshot).collect();
    Trace { steps, final_state, final_tapes, status }
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
