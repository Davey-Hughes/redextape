//! What a counter program is made of: the literal instructions, the macros a compiled program is written
//! in, each macro's single literal expansion, and the exact number of literal steps it takes.
//!
//! **A MACRO IS EMITTED, NEVER RECOGNISED.** Acceleration does not look for loops in literal code that
//! happen to transfer or divide. A program is macros from the start, and its literal form is DERIVED from
//! them by [`expand`], so the thing accelerated and the thing it stands for cannot disagree about which
//! instructions a macro means. What they can still disagree about is the step count, and that is what the
//! tests below hold: each macro's [`literal_steps`] against a literal run of its expansion.
//!
//! **ONE MACRO PER HEAD MOVE.** Between halts a compiled Turing machine does nothing but move heads, so
//! [`Macro::Move`] is the whole of its work. Its expansion is the transfer, add and divide loops a head move
//! takes when each is written out. They were three separate macros first; merging them left one macro per
//! move for an accelerated run to execute.

use crate::counter::nat::{Divisor, Nat};
use crate::tm::machine::StateId;

/// One literal instruction. A counter machine in the textbook sense is a list of these and nothing else.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Instr {
    /// Add one to counter `c`, then go to `next`.
    Inc { c: usize, next: usize },
    /// If counter `c` is zero, go to `zero`; otherwise subtract one from it and go to `nonzero`.
    Dec { c: usize, nonzero: usize, zero: usize },
    /// Halt. Halting is not a step.
    Stop,
}

/// One macro.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Macro {
    /// One head move, over base-`b` numbers whose least significant digit is the cell nearest the head,
    /// with `b` the program's [`Program::base`]: make `s` the new least significant digit of counter `push`,
    /// remove the least significant digit of counter `pop`, and go to `exits[the digit removed]`. See
    /// [`move_steps`] for its step count.
    Move { push: usize, pop: usize, s: u64, exits: Vec<usize> },
    /// Halt, recording the Turing machine state the compiled machine halted in and the digit under each
    /// of its heads, which a readback needs and the counters do not hold.
    Stop { state: StateId, head: Vec<usize> },
    /// Run forever: the Turing machine this program was compiled from reached a cycle of rules that never
    /// move a head.
    Spin,
}

/// A counter program: `counters` counters, the base every move uses, the macros, and the macro execution
/// starts at.
///
/// `scratch` names the counter a program uses only inside a macro. [`Macro::Move`] holds a copy there while
/// it runs, so it is zero between macros, and [`Macro::Spin`]'s literal expansion loops on it without
/// changing anything. `accel.rs`'s `run_accelerated` refuses to start a run with it nonzero.
///
/// **ONE BASE PER PROGRAM.** A compiled program's base is its Turing machine's alphabet size, which never
/// changes, so it is stated once: an accelerated run computes its reciprocal once, and a step count folds
/// with one multiplier.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Program {
    pub counters: usize,
    pub scratch: usize,
    pub base: u64,
    pub macros: Vec<Macro>,
    pub start: usize,
}

/// Why a program cannot be run or expanded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProgramError {
    /// `start` or an exit names no macro.
    NoSuchMacro { at: usize, target: usize },
    /// A macro names a counter past `counters`, or `scratch` is past it.
    NoSuchCounter { at: usize, counter: usize },
    /// The base is zero or past [`MAX_BASE`].
    Base,
    /// A move's own parameters make it meaningless: a digit `s` that is not below the base, `push` and `pop`
    /// the same counter or either of them the scratch counter, or an exit count that is not the base.
    Degenerate { at: usize },
    /// The literal expansion would hold more than [`MAX_LITERAL_INSTRS`] instructions.
    TooLarge,
    /// A run was given `got` counters for a program of `expected`.
    CounterCount { expected: usize, got: usize },
    /// A run's scratch counter was not zero at the start. Every macro assumes it is zero between them.
    ScratchNotZero,
}

/// The most literal instructions [`expand`] builds. A literal run is for toys and small programs; a
/// compiled program large enough to reach this is run accelerated.
pub const MAX_LITERAL_INSTRS: usize = 50_000_000;

/// The largest base a program may use. A base is an alphabet size, so this is far past any machine's, and it
/// keeps `b + 3` and `4·b + 4 + s` inside a `u64`.
pub const MAX_BASE: u64 = 1 << 32;

impl Program {
    /// Every structural rule [`ProgramError`] names.
    ///
    /// # Errors
    ///
    /// The first rule this program breaks.
    pub fn check(&self) -> Result<(), ProgramError> {
        let n = self.macros.len();
        if self.base == 0 || self.base > MAX_BASE {
            return Err(ProgramError::Base);
        }
        if self.start >= n {
            return Err(ProgramError::NoSuchMacro { at: usize::MAX, target: self.start });
        }
        if self.scratch >= self.counters {
            return Err(ProgramError::NoSuchCounter { at: usize::MAX, counter: self.scratch });
        }
        for (at, m) in self.macros.iter().enumerate() {
            let Macro::Move { push, pop, s, exits } = m else { continue };
            for counter in [*push, *pop] {
                if counter >= self.counters {
                    return Err(ProgramError::NoSuchCounter { at, counter });
                }
            }
            let shape = *s >= self.base
                || push == pop
                || [*push, *pop].contains(&self.scratch)
                || u64::try_from(exits.len()).ok() != Some(self.base);
            if shape {
                return Err(ProgramError::Degenerate { at });
            }
            if let Some(&target) = exits.iter().find(|&&t| t >= n) {
                return Err(ProgramError::NoSuchMacro { at, target });
            }
        }
        Ok(())
    }
}

/// How many literal instructions `m`'s expansion holds over `base`, or `None` when that does not fit a
/// `usize`.
#[must_use]
pub fn literal_len(m: &Macro, base: u64) -> Option<usize> {
    match m {
        Macro::Move { s, .. } => usize::try_from(base.checked_mul(4)?.checked_add(4)?.checked_add(*s)?).ok(),
        Macro::Stop { .. } | Macro::Spin => Some(1),
    }
}

/// The literal steps of one [`Macro::Move`] over `base`, pushing digit `s` onto a counter holding `pushed`,
/// when dividing the popped counter by the base gave `quotient` and `digit`; `None` for a base past
/// [`MAX_BASE`].
///
/// Following [`expand`]'s five loops, with `P = pushed` and `Q = quotient·b + digit` the popped value,
///
/// > `(2·P + 1) + ((b + 1)·P + 1) + s + (Q + ⌊Q/b⌋ + 1) + (2·⌊Q/b⌋ + 1)`
/// > `= (b + 3)·P + s + Q + 3·⌊Q/b⌋ + 4`
/// > `= (b + 3)·(P + ⌊Q/b⌋) + (Q mod b) + s + 4`.
///
/// **THE FORMULA, WRITTEN PLAINLY.** [`literal_steps`] computes through it, and the tests below hold it to a
/// literal run of the expansion. The accelerated run cannot afford to call it — it keeps the same sum in a
/// deferred shape of its own — so `accel.rs`'s tests hold that tally to this function, move by move.
#[must_use]
pub fn move_steps(base: u64, s: u64, pushed: &Nat, quotient: &Nat, digit: u64) -> Option<Nat> {
    if base > MAX_BASE {
        return None;
    }
    let mut steps = pushed.clone();
    steps.add(quotient);
    steps.mul_add(base + 3, 0);
    steps.add(&Nat::from(u128::from(digit) + u128::from(s) + 4));
    Some(steps)
}

/// The literal steps `m`'s expansion takes over `base` when its `push` counter holds `pushed` and its `pop`
/// counter holds `popped`, or `None` for [`Macro::Spin`], which never finishes, and for a base of zero or
/// past [`MAX_BASE`]. A [`Macro::Stop`] takes none: halting is not a step.
#[must_use]
pub fn literal_steps(m: &Macro, base: u64, pushed: &Nat, popped: &Nat) -> Option<Nat> {
    match m {
        Macro::Move { s, .. } => {
            let mut quotient = popped.clone();
            let digit = quotient.div_rem(&Divisor::new(base)?);
            move_steps(base, *s, pushed, &quotient, digit)
        }
        Macro::Stop { .. } => Some(Nat::zero()),
        Macro::Spin => None,
    }
}

/// A program's literal form: the instructions, the first instruction of each macro, the macro each
/// instruction came from, and which instructions leave their macro.
///
/// `leaves[i]` says that instruction `i`'s way out of its macro is taken: an `Inc`'s `next`, or a `Dec`'s
/// `zero` branch. It is how a literal run tells entering a macro from a macro's own loop back to its first
/// instruction, which a move that is its own exit also looks like.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Expansion {
    pub instrs: Vec<Instr>,
    pub first: Vec<usize>,
    pub owner: Vec<usize>,
    pub leaves: Vec<bool>,
}

/// Expand every macro of `p` into its literal instructions.
///
/// A `Move { push, pop, s, exits }` over base `b`, with `t` the scratch counter, is five loops in a row:
///
/// 1. `Dec push` (zero: on to 2), `Inc t` back — `t` takes a copy of `push`.
/// 2. `Dec t` (zero: on to 3), then `b` × `Inc push` back — `push` becomes `b` times the copy.
/// 3. `s` × `Inc push` — the digit.
/// 4. `b` × `Dec pop`, the `m`-th finding zero going to 5's `m`-th copy loop, then `Inc t` back — `t`
///    takes `⌊pop / b⌋`, and which `Dec` found zero is the digit removed.
/// 5. For each digit `m`: `Dec t` (zero: leave for `exits[m]`), `Inc pop` back — the quotient returns.
///
/// That is `4·b + 4 + s` instructions. A `Stop` is `Stop`, and a `Spin` is `Dec scratch` going back to
/// itself whether or not the counter is zero, which loops forever regardless — scratch being zero between
/// macros is only why it changes nothing.
///
/// # Errors
///
/// [`Program::check`]'s, or [`ProgramError::TooLarge`] past [`MAX_LITERAL_INSTRS`].
pub fn expand(p: &Program) -> Result<Expansion, ProgramError> {
    p.check()?;
    let mut first = Vec::with_capacity(p.macros.len());
    let mut total = 0usize;
    for m in &p.macros {
        first.push(total);
        total = literal_len(m, p.base).and_then(|len| total.checked_add(len)).ok_or(ProgramError::TooLarge)?;
        if total > MAX_LITERAL_INSTRS {
            return Err(ProgramError::TooLarge);
        }
    }
    let copies = usize::try_from(p.base).map_err(|_| ProgramError::TooLarge)?;
    let mut e = Expansion { instrs: Vec::with_capacity(total), first, owner: Vec::new(), leaves: Vec::new() };
    for (j, m) in p.macros.iter().enumerate() {
        let base = e.instrs.len();
        match m {
            Macro::Move { push, pop, s, exits } => {
                let targets = exits.iter().map(|x| e.first.get(*x).copied()).collect::<Option<Vec<usize>>>();
                let targets = targets.ok_or(ProgramError::NoSuchMacro { at: j, target: usize::MAX })?;
                expand_move(&mut e.instrs, base, (*push, *pop, p.scratch), (copies, *s), &targets)?;
            }
            Macro::Stop { .. } => e.instrs.push(Instr::Stop),
            Macro::Spin => e.instrs.push(Instr::Dec { c: p.scratch, nonzero: base, zero: base }),
        }
        e.leaves.resize(e.instrs.len(), false);
        e.owner.resize(e.instrs.len(), j);
        if matches!(m, Macro::Move { .. }) {
            // Each copy loop in step 5 leaves on its `Dec`, which is every second instruction from the end.
            for k in 0..copies {
                if let Some(leaving) = e.leaves.get_mut(e.instrs.len() - 2 * (copies - k)) {
                    *leaving = true;
                }
            }
        }
    }
    Ok(e)
}

/// Append one move's expansion at `base`: counters `(push, pop, scratch)`, `(base b, digit s)`, and the
/// first instruction of each exit.
fn expand_move(
    out: &mut Vec<Instr>,
    base: usize,
    (push, pop, t): (usize, usize, usize),
    (b, s): (usize, u64),
    exits: &[usize],
) -> Result<(), ProgramError> {
    let s = usize::try_from(s).map_err(|_| ProgramError::TooLarge)?;
    let scale = base + 2;
    let add = scale + 1 + b;
    let divide = add + s;
    let copy = divide + b + 1;
    out.push(Instr::Dec { c: push, nonzero: base + 1, zero: scale });
    out.push(Instr::Inc { c: t, next: base });
    out.push(Instr::Dec { c: t, nonzero: scale + 1, zero: add });
    for i in 0..b {
        out.push(Instr::Inc { c: push, next: if i + 1 < b { scale + 2 + i } else { scale } });
    }
    for i in 0..s {
        out.push(Instr::Inc { c: push, next: if i + 1 < s { add + 1 + i } else { divide } });
    }
    for m in 0..b {
        out.push(Instr::Dec { c: pop, nonzero: divide + m + 1, zero: copy + 2 * m });
    }
    out.push(Instr::Inc { c: t, next: divide });
    for (m, exit) in exits.iter().enumerate() {
        out.push(Instr::Dec { c: t, nonzero: copy + 2 * m + 1, zero: *exit });
        out.push(Instr::Inc { c: pop, next: copy + 2 * m });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::counter::accel::{LiteralEnd, run_literal};
    use proptest::prelude::*;

    /// A move at macro 0 whose exits are `Stop`s, one per digit, so a literal run's stopping instruction
    /// says which digit it removed. Counters 0 and 1 hold data and counter 2 is scratch.
    fn one_move(push: usize, pop: usize, b: u64, s: u64) -> Program {
        let stops = usize::try_from(b).unwrap();
        let mut macros = vec![Macro::Move { push, pop, s, exits: (1..=stops).collect() }];
        macros.extend((0..stops).map(|i| Macro::Stop { state: u32::try_from(i).unwrap(), head: vec![] }));
        Program { counters: 3, scratch: 2, base: b, macros, start: 0 }
    }

    proptest! {
        /// A move's expansion pushes `s` onto `push`, pops `pop`'s least digit, leaves by that digit's exit,
        /// empties scratch, and takes exactly its formula's steps — in both directions.
        #[test]
        fn a_move_takes_exactly_its_formulas_steps(
            pushed in 0u64..400, popped in 0u64..400, b in 1u64..10, digit in 0u64..10, rightward in any::<bool>()
        ) {
            let s = digit % b;
            let (push, pop) = if rightward { (0, 1) } else { (1, 0) };
            let p = one_move(push, pop, b, s);
            let e = expand(&p).unwrap();
            prop_assert_eq!(e.instrs.len(), usize::try_from(4 * b + 4 + s).unwrap() + usize::try_from(b).unwrap());
            let mut counters = vec![0, 0, 0];
            counters[push] = pushed;
            counters[pop] = popped;
            let run = run_literal(&e.instrs, counters, 0, 1 << 30);
            let LiteralEnd::Stopped { at } = run.end else { panic!("did not stop: {:?}", run.end) };
            prop_assert_eq!(e.owner[at], 1 + usize::try_from(popped % b).unwrap());
            let mut want = vec![0, 0, 0];
            want[push] = pushed * b + s;
            want[pop] = popped / b;
            prop_assert_eq!(run.counters, want);
            let formula = literal_steps(&p.macros[0], b, &Nat::from(pushed), &Nat::from(popped)).unwrap();
            prop_assert_eq!(Nat::from(run.steps), formula);
        }
    }

    /// `Spin`'s expansion runs until the cap and changes no counter — true because scratch starts zero here;
    /// a nonzero scratch would be decremented to zero and then stay there. Its formula says it never ends.
    #[test]
    fn spin_runs_forever_and_changes_nothing() {
        let p = Program { counters: 3, scratch: 2, base: 2, macros: vec![Macro::Spin], start: 0 };
        let e = expand(&p).unwrap();
        let run = run_literal(&e.instrs, vec![4, 5, 0], 0, 1_000);
        assert_eq!(run.end, LiteralEnd::StepCap);
        assert_eq!(run.counters, vec![4, 5, 0]);
        assert_eq!(literal_steps(&Macro::Spin, 2, &Nat::zero(), &Nat::zero()), None);
    }

    /// Each structural rule refuses the program that breaks it, and a move that is its own exit is allowed.
    #[test]
    fn check_refuses_each_broken_rule() {
        let stop = Macro::Stop { state: 0, head: vec![] };
        let mv = |push: usize, pop: usize, s: u64, exits: Vec<usize>| Macro::Move { push, pop, s, exits };
        let p = |base: u64, macros: Vec<Macro>| Program { counters: 3, scratch: 2, base, macros, start: 0 };
        let cases = [
            (p(0, vec![stop.clone()]), ProgramError::Base),
            (p(MAX_BASE + 1, vec![stop.clone()]), ProgramError::Base),
            (
                Program { counters: 3, scratch: 2, base: 2, macros: vec![stop.clone()], start: 5 },
                ProgramError::NoSuchMacro { at: usize::MAX, target: 5 },
            ),
            (
                Program { counters: 3, scratch: 5, base: 2, macros: vec![stop.clone()], start: 0 },
                ProgramError::NoSuchCounter { at: usize::MAX, counter: 5 },
            ),
            (p(2, vec![mv(0, 1, 0, vec![1, 7]), stop.clone()]), ProgramError::NoSuchMacro { at: 0, target: 7 }),
            (p(1, vec![mv(3, 1, 0, vec![1]), stop.clone()]), ProgramError::NoSuchCounter { at: 0, counter: 3 }),
            (p(2, vec![mv(0, 1, 2, vec![1, 1]), stop.clone()]), ProgramError::Degenerate { at: 0 }),
            (p(1, vec![mv(1, 1, 0, vec![1]), stop.clone()]), ProgramError::Degenerate { at: 0 }),
            (p(1, vec![mv(0, 2, 0, vec![1]), stop.clone()]), ProgramError::Degenerate { at: 0 }),
            (p(1, vec![mv(2, 0, 0, vec![1]), stop.clone()]), ProgramError::Degenerate { at: 0 }),
            (p(2, vec![mv(0, 1, 0, vec![1]), stop.clone()]), ProgramError::Degenerate { at: 0 }),
        ];
        for (program, want) in cases {
            assert_eq!(program.check(), Err(want.clone()), "{program:?}");
        }
        assert_eq!(p(2, vec![mv(0, 1, 1, vec![1, 0]), stop]).check(), Ok(()));
    }
}
