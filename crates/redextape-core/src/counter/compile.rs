//! Compiling a Turing machine to a counter program.
//!
//! **A TAPE IS TWO NUMBERS.** Over an alphabet of `b` symbols with `BLANK` as digit 0, the cells left of
//! a head are a base-`b` number with the nearest cell least significant, and so are the cells right of it.
//! Tape `i` keeps its left number in counter [`left`]`(i)` and its right number in [`right`]`(i)`; the
//! digit under the head is not in any counter but in which macro runs next, so reading it costs nothing.
//! One more counter, [`scratch`]`(k)`, is empty between macros. A stage 1 image has one tape, so it
//! compiles to three counters.
//!
//! **A HEAD MOVE IS ONE MACRO.** Moving tape `i` right is a [`Macro::Move`] that pushes the digit under the
//! head onto the left number and pops the right number's least digit, whose value picks one of `b` exits.
//! Moving left is the same with the two numbers swapped. A rule that moves no head emits nothing: its writes
//! and its next state only change which macro comes next, and a cycle of such rules becomes
//! [`Macro::Spin`].

use std::collections::{HashMap, HashSet};

use crate::counter::nat::Nat;
use crate::counter::program::{Macro, Program, ProgramError};
use crate::tm::machine::{Machine, Move, StateId, Symbol};
use crate::tm::two_symbol::Code;

/// The counter holding tape `i`'s cells left of its head.
#[must_use]
pub fn left(i: usize) -> usize {
    2 * i
}

/// The counter holding tape `i`'s cells right of its head.
#[must_use]
pub fn right(i: usize) -> usize {
    2 * i + 1
}

/// The scratch counter of a program compiled from a `k`-tape machine.
#[must_use]
pub fn scratch(k: usize) -> usize {
    2 * k
}

/// The most macros [`compile`] emits before refusing a machine.
pub const MAX_MACROS: usize = 20_000_000;

/// A compiled machine: the program, the symbol each digit stands for, and the counters it starts on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Compiled {
    pub program: Program,
    /// Digit `d` is `symbols[d]`, and `BLANK` is digit 0 — the order of `two_symbol.rs`'s `Code`.
    pub symbols: Vec<Symbol>,
    pub counters: Vec<Nat>,
}

/// Why a machine cannot be compiled.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CompileError {
    /// `Machine::validate` found problems, or there are more initial tapes than the machine has.
    InvalidMachine,
    /// The program would hold more than [`MAX_MACROS`] macros.
    TooLarge,
    /// The emitted program failed its own check — a defect in this compiler, reported rather than run.
    Program(ProgramError),
}

/// A move's exit still to fill: exit `exit` of the move at `at` goes wherever [`Emitter::step`] sends the
/// rest of the rule.
struct Pending {
    at: usize,
    exit: usize,
    state: StateId,
    rule: usize,
    tape: usize,
    digits: Vec<usize>,
}

struct Emitter<'a> {
    m: &'a Machine,
    b: u64,
    digit: HashMap<Symbol, usize>,
    macros: Vec<Macro>,
    dispatched: HashMap<(StateId, Vec<usize>), usize>,
    stepped: HashMap<(StateId, usize, usize, Vec<usize>), usize>,
    pending: Vec<Pending>,
}

impl Emitter<'_> {
    fn push(&mut self, m: Macro) -> Result<usize, CompileError> {
        if self.macros.len() >= MAX_MACROS {
            return Err(CompileError::TooLarge);
        }
        self.macros.push(m);
        Ok(self.macros.len() - 1)
    }

    /// The macro that runs the machine from `state` with `digits` under its heads: the first rule that
    /// moves a head, reached through any rules that move none, or a `Stop` or a `Spin`.
    fn dispatch(&mut self, state: StateId, digits: Vec<usize>) -> Result<usize, CompileError> {
        let key = (state, digits);
        if let Some(&at) = self.dispatched.get(&key) {
            return Ok(at);
        }
        let (mut q, mut h) = key.clone();
        let mut seen = HashSet::new();
        let at = loop {
            if !seen.insert((q, h.clone())) {
                break self.push(Macro::Spin)?;
            }
            let Some(st) = usize::try_from(q).ok().and_then(|i| self.m.states.get(i)) else {
                break self.push(Macro::Stop { state: q, head: h })?;
            };
            let matched = if st.accept {
                None
            } else {
                st.rules.iter().position(|r| {
                    r.read.iter().zip(&h).all(|(want, got)| want.is_none_or(|s| self.digit.get(&s) == Some(got)))
                })
            };
            let Some((ri, rule)) = matched.and_then(|ri| st.rules.get(ri).map(|r| (ri, r))) else {
                break self.push(Macro::Stop { state: q, head: h })?;
            };
            let mut written = h.clone();
            for (slot, w) in written.iter_mut().zip(&rule.write) {
                if let Some(s) = w {
                    *slot = self.digit.get(s).copied().ok_or(CompileError::InvalidMachine)?;
                }
            }
            if rule.moves.iter().all(|mv| *mv == Move::S) {
                (q, h) = (rule.next, written);
                continue;
            }
            break self.step(q, ri, 0, written)?;
        };
        self.dispatched.insert(key, at);
        Ok(at)
    }

    /// The macros that finish rule `rule` of `state` from tape `tape` on, with `digits` under the heads: a
    /// move for the first tape from `tape` on that the rule moves, or, when there is none, the rule's next
    /// state.
    fn step(&mut self, state: StateId, rule: usize, tape: usize, digits: Vec<usize>) -> Result<usize, CompileError> {
        let machine = self.m;
        let applied = usize::try_from(state)
            .ok()
            .and_then(|q| machine.states.get(q))
            .and_then(|st| st.rules.get(rule))
            .ok_or(CompileError::InvalidMachine)?;
        let moving = (tape..machine.tapes).find(|&t| applied.moves.get(t).is_some_and(|mv| *mv != Move::S));
        let Some(moving) = moving else {
            return self.dispatch(applied.next, digits);
        };
        let key = (state, rule, moving, digits);
        if let Some(&at) = self.stepped.get(&key) {
            return Ok(at);
        }
        let (push, pop) = if applied.moves.get(moving) == Some(&Move::R) {
            (left(moving), right(moving))
        } else {
            (right(moving), left(moving))
        };
        let under = key.3.get(moving).copied().ok_or(CompileError::InvalidMachine)?;
        let written = u64::try_from(under).map_err(|_| CompileError::InvalidMachine)?;
        let exit_count = usize::try_from(self.b).map_err(|_| CompileError::TooLarge)?;
        let at = self.push(Macro::Move { push, pop, s: written, exits: vec![usize::MAX; exit_count] })?;
        for popped_digit in 0..exit_count {
            let mut popped = key.3.clone();
            if let Some(slot) = popped.get_mut(moving) {
                *slot = popped_digit;
            }
            self.pending.push(Pending { at, exit: popped_digit, state, rule, tape: moving + 1, digits: popped });
        }
        self.stepped.insert(key, at);
        Ok(at)
    }
}

/// Compile `m`, running on `inits`, to a counter program over `2·m.tapes + 1` counters.
///
/// The symbols are `Code::new(m, inits)`'s, so every symbol a rule or an initial tape names has a digit.
/// Each tape's first initial cell is under its head; the rest are its right number.
///
/// # Errors
///
/// [`CompileError::InvalidMachine`] for a machine `Machine::validate` refuses or more initial tapes than
/// `m.tapes`, [`CompileError::TooLarge`] past [`MAX_MACROS`].
pub fn compile(m: &Machine, inits: &[Vec<Symbol>]) -> Result<Compiled, CompileError> {
    if !m.validate().is_empty() || inits.len() > m.tapes {
        return Err(CompileError::InvalidMachine);
    }
    let symbols = Code::new(m, inits).symbols().to_vec();
    let digit: HashMap<Symbol, usize> = symbols.iter().enumerate().map(|(d, s)| (*s, d)).collect();
    let b = u64::try_from(symbols.len()).map_err(|_| CompileError::TooLarge)?;
    let k = m.tapes;
    let mut counters = vec![Nat::zero(); 2 * k + 1];
    let mut head = vec![0usize; k];
    for (i, cells) in inits.iter().enumerate() {
        let lookup = |s: &Symbol| digit.get(s).copied().ok_or(CompileError::InvalidMachine);
        if let (Some(first), Some(slot)) = (cells.first(), head.get_mut(i)) {
            *slot = lookup(first)?;
        }
        let mut r = Nat::zero();
        for s in cells.iter().skip(1).rev() {
            r.mul_add(b, u64::try_from(lookup(s)?).map_err(|_| CompileError::TooLarge)?);
        }
        if let Some(slot) = counters.get_mut(right(i)) {
            *slot = r;
        }
    }
    let mut e = Emitter {
        m,
        b,
        digit,
        macros: Vec::new(),
        dispatched: HashMap::new(),
        stepped: HashMap::new(),
        pending: Vec::new(),
    };
    let start = e.dispatch(m.start, head)?;
    while let Some(p) = e.pending.pop() {
        let target = e.step(p.state, p.rule, p.tape, p.digits)?;
        if let Some(Macro::Move { exits, .. }) = e.macros.get_mut(p.at)
            && let Some(slot) = exits.get_mut(p.exit)
        {
            *slot = target;
        }
    }
    let program = Program { counters: 2 * k + 1, scratch: scratch(k), base: b, macros: e.macros, start };
    program.check().map_err(CompileError::Program)?;
    Ok(Compiled { program, symbols, counters })
}

/// Small hand-built machines, shared by this module's tests and the 2-counter tests.
#[cfg(test)]
pub(crate) mod toys {
    use crate::tm::machine::{BLANK, Machine, Move, Rule, State, Symbol};

    fn one(read: Symbol, write: Option<Symbol>, mv: Move, next: u32) -> Rule {
        Rule { read: vec![Some(read)], write: vec![write], moves: vec![mv], next }
    }

    fn state(name: &str, accept: bool, rules: Vec<Rule>) -> State {
        State { name: name.into(), accept, rules }
    }

    /// Walk right over a unary string and append one mark.
    pub(crate) fn increment() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                state("scan", false, vec![one('1', None, Move::R, 0), one(BLANK, Some('1'), Move::S, 1)]),
                state("done", true, vec![]),
            ],
        }
    }

    /// Add one to a binary number written most significant digit first, moving left from its end.
    pub(crate) fn binary_increment() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                state(
                    "right",
                    false,
                    vec![one('0', None, Move::R, 0), one('1', None, Move::R, 0), one(BLANK, None, Move::L, 1)],
                ),
                state(
                    "carry",
                    false,
                    vec![
                        one('1', Some('0'), Move::L, 1),
                        one('0', Some('1'), Move::S, 2),
                        one(BLANK, Some('1'), Move::S, 2),
                    ],
                ),
                state("done", true, vec![]),
            ],
        }
    }

    /// Erase a unary string left to right, halting in `even` (an accept) or `odd` (not one).
    pub(crate) fn parity_eraser() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                state("e", false, vec![one('1', Some(BLANK), Move::R, 1), one(BLANK, None, Move::S, 2)]),
                state("o", false, vec![one('1', Some(BLANK), Move::R, 0), one(BLANK, None, Move::S, 3)]),
                state("even", true, vec![]),
                state("odd", false, vec![]),
            ],
        }
    }

    /// Copy a unary string from tape 0 to tape 1, then walk tape 1's head back past where it started.
    pub(crate) fn copy_two_tapes() -> Machine {
        let two = |read: [Option<Symbol>; 2], write: [Option<Symbol>; 2], moves: [Move; 2], next: u32| Rule {
            read: read.to_vec(),
            write: write.to_vec(),
            moves: moves.to_vec(),
            next,
        };
        Machine {
            tapes: 2,
            start: 0,
            states: vec![
                state(
                    "copy",
                    false,
                    vec![
                        two([Some('1'), None], [None, Some('1')], [Move::R, Move::R], 0),
                        two([Some(BLANK), None], [None, None], [Move::S, Move::L], 1),
                    ],
                ),
                state(
                    "back",
                    false,
                    vec![
                        two([None, Some('1')], [None, None], [Move::S, Move::L], 1),
                        two([None, Some(BLANK)], [None, None], [Move::L, Move::S], 2),
                    ],
                ),
                state("done", true, vec![]),
            ],
        }
    }

    /// Two states that pass control back and forth without ever moving the head.
    pub(crate) fn spinner() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                state("ping", false, vec![one('1', None, Move::S, 1)]),
                state("pong", false, vec![one('1', Some('1'), Move::S, 0)]),
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::counter::accel::{Caps, End, check_literal_agreement, run_accelerated};
    use crate::counter::readback;
    use crate::tm::machine::BLANK;
    use crate::tm::sim::{Caps as TmCaps, Status, simulate_final};
    use crate::tm::single_tape::normalize;

    const WIDE: Caps = Caps { macros: 10_000_000, bits: 1 << 20 };
    const TM: TmCaps = TmCaps { steps: 1_000_000, cells: 1_000_000 };

    /// Compile `m` on `inits`, require a literal run of the program's expansion to agree with its accelerated
    /// run as `check_literal_agreement` defines agreeing, and require of that accelerated run what the Turing
    /// machine simulator does: the same halting state, the same tapes, an empty scratch counter.
    fn agrees(what: &str, m: &Machine, inits: &[Vec<Symbol>]) {
        let c = compile(m, inits).unwrap_or_else(|e| panic!("{what}: {e:?}"));
        let (want, want_state, status, _) = simulate_final(m, inits, TM);
        assert_eq!(status, Status::Halted, "{what}: the Turing machine must halt");

        let (run, _) = check_literal_agreement(&c.program, &c.counters, WIDE, 2_000_000_000)
            .unwrap_or_else(|e| panic!("{what}: {e}"));
        let End::Stopped { at } = run.end else { panic!("{what}: {:?}", run.end) };
        let Macro::Stop { state, head } = &c.program.macros[at] else { panic!("{what}: not a Stop") };
        assert_eq!(*state, want_state, "{what}: halting state");
        assert!(run.counters[scratch(m.tapes)].is_zero(), "{what}: scratch must be empty at a Stop");
        let got = readback::tapes(&run.counters, head, &c.symbols).unwrap();
        assert_eq!(got.len(), want.len(), "{what}: tape count");
        for (i, ((cells, h), tape)) in got.iter().zip(&want).enumerate() {
            let (wc, wh) = tape.snapshot();
            assert_eq!(normalize(cells, *h), normalize(&wc, wh), "{what}: tape {i}");
        }
    }

    /// Every toy but `spinner`, on inputs of every length from 0 to 8 (0 to 6 for `binary_increment`), agrees
    /// with the Turing machine simulator and with its own literal expansion — `spinner` has its own test.
    /// `copy_two_tapes` compiles to five counters and walks a head left of where it started, and
    /// `increment`'s scan is a move that is its own exit.
    #[test]
    fn compiled_toys_agree_with_the_simulator_and_their_literal_expansion() {
        for n in 0..=8 {
            let marks = vec![vec!['1'; n]];
            agrees(&format!("increment n={n}"), &toys::increment(), &marks);
            agrees(&format!("parity_eraser n={n}"), &toys::parity_eraser(), &marks);
            agrees(&format!("copy_two_tapes n={n}"), &toys::copy_two_tapes(), &marks);
            let ones = vec![vec!['1'; n.min(6)]];
            agrees(&format!("binary_increment n={}", n.min(6)), &toys::binary_increment(), &ones);
        }
    }

    /// A cycle of rules that move no head compiles to `Spin`, which the accelerated run reports, while the
    /// simulator runs the same machine to its step cap.
    #[test]
    fn a_cycle_of_rules_that_never_move_compiles_to_spin() {
        let m = toys::spinner();
        let inits = vec![vec!['1']];
        let c = compile(&m, &inits).unwrap();
        assert_eq!(c.program.macros[c.program.start], Macro::Spin);
        let run = run_accelerated(&c.program, c.counters, WIDE).unwrap();
        assert!(matches!(run.end, End::Spun { .. }), "{:?}", run.end);
        assert_eq!(simulate_final(&m, &inits, TM).2, Status::HitCap);
    }

    /// More initial tapes than the machine has is refused, not truncated.
    #[test]
    fn more_initial_tapes_than_the_machine_has_is_refused() {
        let got = compile(&toys::increment(), &[vec!['1'], vec![BLANK]]);
        assert_eq!(got, Err(CompileError::InvalidMachine));
    }
}
