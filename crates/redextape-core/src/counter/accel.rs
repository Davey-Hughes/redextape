//! Running a counter program, two ways.
//!
//! * **Literally** — [`run_literal`] executes `Inc`, `Dec` and `Stop` one at a time over `u64` counters.
//!   It is the counter machine itself, and it is only affordable for toys and small programs.
//! * **Accelerated** — [`run_accelerated`] executes each move as arithmetic on the counters' values and
//!   counts its literal steps by `program.rs`'s `move_steps` formula, kept in a deferred shape. **The count is
//!   computed, not taken:** a stage 1 image of `3 - 5` reports about 10^380 literal steps.
//!
//! **THE TWO ARE HELD TO EACH OTHER BY A TRACE.** Both can record `(macro, literal steps so far)` each time
//! a macro is entered. A literal run of a program's expansion and an accelerated run of its macros agree on
//! that pair at every entry, on the counters, and on where they stop, or one of them is wrong.
//!
//! **A COUNTER KEEPS ITS LOWEST DIGITS OUT OF ITS LIMBS.** A head move multiplies one counter by the base
//! and divides another, which over [`Nat`] limbs is a pass over every limb of both — and a stage 1 image's
//! counters run to thousands of bits. So an accelerated run holds a counter as `hi·b^j + lo`, with `lo` a
//! `u64` holding its `j` lowest base-`b` digits, `j` at most the largest `k` for which `b^k` fits a `u64`:
//! 16 for base 15. A push or a pop is then arithmetic on `lo`, and only a full `lo` (flushed into `hi`) or an
//! empty one (refilled from `hi`, dividing by `b^k` through a `Divisor`) passes over the limbs — about once
//! every `k` moves of that counter. Measured on `sum(5)`'s stage 1 image while this was planned, it took the
//! run from 110.2 s, with a limb pass on every move, to 11.9 s (11.861 s at `74906c4`, load 27.8).
//!
//! **THE TALLY IS DEFERRED THE SAME WAY.** The steps of a move are `(b + 3)·(P + ⌊Q/b⌋) + (Q mod b) + s + 4`
//! for `P` the value pushed onto and `⌊Q/b⌋` the value left after the pop — two counter values. A counter's
//! value `hi·b^j + lo` contributes `lo` to a `u128` sum at once, and `b^j` to a per-counter `weight` that
//! multiplies its `hi`; `hi·weight` is added to the tally when `hi` is about to change, when `weight` would
//! overflow, or when a total is read.

use crate::counter::nat::{Divisor, Nat};
use crate::counter::program::{Expansion, Instr, Macro, Program, ProgramError, expand};

/// Why a literal run stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LiteralEnd {
    /// It reached the `Stop` instruction at index `at`.
    Stopped { at: usize },
    /// It took the step budget without stopping.
    StepCap,
    /// An `Inc` would have taken a counter past `u64::MAX`.
    CounterOverflow,
    /// An instruction named an instruction or a counter that does not exist.
    Malformed,
}

/// A finished literal run: why it ended, the counters then, and the steps it took.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiteralRun {
    pub end: LiteralEnd,
    pub counters: Vec<u64>,
    pub steps: u64,
}

/// Run `instrs` literally from instruction `start`, for at most `max_steps` steps. Every `Inc` and every
/// `Dec` is one step; `Stop` is not.
#[must_use]
pub fn run_literal(instrs: &[Instr], counters: Vec<u64>, start: usize, max_steps: u64) -> LiteralRun {
    literal(instrs, counters, start, max_steps, None)
}

/// [`run_literal`] over `e`, also pushing `(macro, steps so far)` onto `trace` at the start and each time
/// the run leaves a macro for the one it enters — the literal side of the agreement trace.
#[must_use]
pub fn run_literal_traced(
    e: &Expansion,
    counters: Vec<u64>,
    start: usize,
    max_steps: u64,
    trace: &mut Vec<(usize, u64)>,
) -> LiteralRun {
    if let Some(&entered) = e.owner.get(start) {
        trace.push((entered, 0));
    }
    literal(&e.instrs, counters, start, max_steps, Some((e, trace)))
}

fn literal(
    instrs: &[Instr],
    mut counters: Vec<u64>,
    start: usize,
    max_steps: u64,
    mut tracer: Option<(&Expansion, &mut Vec<(usize, u64)>)>,
) -> LiteralRun {
    let mut pc = start;
    let mut steps = 0u64;
    let end = loop {
        let Some(instr) = instrs.get(pc) else { break LiteralEnd::Malformed };
        let from = pc;
        let exit_branch = match *instr {
            Instr::Stop => break LiteralEnd::Stopped { at: pc },
            _ if steps >= max_steps => break LiteralEnd::StepCap,
            Instr::Inc { c, next } => {
                let Some(slot) = counters.get_mut(c) else { break LiteralEnd::Malformed };
                let Some(v) = slot.checked_add(1) else { break LiteralEnd::CounterOverflow };
                *slot = v;
                pc = next;
                true
            }
            Instr::Dec { c, nonzero, zero } => {
                let Some(slot) = counters.get_mut(c) else { break LiteralEnd::Malformed };
                if *slot == 0 {
                    pc = zero;
                    true
                } else {
                    *slot -= 1;
                    pc = nonzero;
                    false
                }
            }
        };
        steps += 1;
        if let Some((e, trace)) = tracer.as_mut()
            && exit_branch
            && e.leaves.get(from) == Some(&true)
        {
            let Some(&entered) = e.owner.get(pc) else { break LiteralEnd::Malformed };
            trace.push((entered, steps));
        }
    };
    LiteralRun { end, counters, steps }
}

/// The budgets of an accelerated run: macros executed, and the bit length a counter may reach.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Caps {
    pub macros: u64,
    pub bits: u64,
}

/// Why an accelerated run stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum End {
    /// It reached the [`Macro::Stop`] at index `at`.
    Stopped { at: usize },
    /// It reached the [`Macro::Spin`] at index `at`, which never ends.
    Spun { at: usize },
    /// It executed [`Caps::macros`] macros without stopping.
    MacroCap,
    /// A counter grew past [`Caps::bits`] bits.
    BitCap,
}

/// A finished accelerated run.
///
/// `steps` is the number of literal steps the run stands for, COMPUTED from each move's formula — the
/// literal machine was not run. `macros` is how many macros were executed.
///
/// `largest_bits` is the bit length of the largest value a counter held at the start, when its lowest digits
/// were flushed into its limbs, and at the end. Between flushes a counter gains at most `k` digits with `b^k`
/// in a `u64`, so this is below the true peak by at most 65 bits; [`End::BitCap`] is checked against it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Run {
    pub end: End,
    pub counters: Vec<Nat>,
    pub steps: Nat,
    pub macros: u64,
    pub largest_bits: u64,
}

/// Run `p` accelerated from its start, on `counters`.
///
/// # Errors
///
/// [`Program::check`]'s, [`ProgramError::CounterCount`] when `counters` does not hold `p.counters` values, or
/// [`ProgramError::ScratchNotZero`] when the scratch counter is not zero.
pub fn run_accelerated(p: &Program, counters: Vec<Nat>, caps: Caps) -> Result<Run, ProgramError> {
    accelerate(p, counters, caps, None)
}

/// [`run_accelerated`], also pushing `(macro, literal steps so far)` onto `trace` on entry to every macro
/// the run reaches — the accelerated side of the agreement trace. The tally is multiplied out at every
/// entry, which a run without a trace never pays.
///
/// # Errors
///
/// As [`run_accelerated`].
pub fn run_accelerated_traced(
    p: &Program,
    counters: Vec<Nat>,
    caps: Caps,
    trace: &mut Vec<(usize, Nat)>,
) -> Result<Run, ProgramError> {
    accelerate(p, counters, caps, Some(trace))
}

/// Run `p` accelerated from `counters`, run its expansion literally from the same counters for at most
/// `max_literal_steps` steps, and require the two runs to agree: both stop, in the same macro, with the same
/// literal step count, the same counters and the same `(macro, literal steps so far)` trace. On agreement,
/// the accelerated run and the literal step count.
///
/// This is test support. The unit tests of compiled programs and the oracle's integration test hold the two
/// runs to each other through this one statement of what agreeing means; it is not part of the documented
/// API. It returns an error instead of panicking because the crate's library code may not panic.
///
/// # Errors
///
/// The first thing the two runs disagree on, or why they could not be compared: the accelerated run is
/// refused or ends without stopping, the program has no literal expansion, a counter does not fit a `u64`,
/// or the literal run ends without stopping.
// Test support for compiled programs' unit tests and `tests/counter_oracle.rs`, not part of the module's contract.
#[doc(hidden)]
pub fn check_literal_agreement(
    p: &Program,
    counters: &[Nat],
    caps: Caps,
    max_literal_steps: u64,
) -> Result<(Run, u64), String> {
    let mut fast = Vec::new();
    let run = run_accelerated_traced(p, counters.to_vec(), caps, &mut fast)
        .map_err(|e| format!("the accelerated run was refused: {e:?}"))?;
    let End::Stopped { at } = run.end else {
        return Err(format!("the accelerated run ended with {:?}", run.end));
    };
    let e = expand(p).map_err(|e| format!("the program has no literal expansion: {e:?}"))?;
    let literal: Vec<u64> = counters
        .iter()
        .map(u64::try_from)
        .collect::<Result<_, _>>()
        .map_err(|()| "an initial counter does not fit a u64".to_owned())?;
    let start = *e.first.get(p.start).ok_or("the expansion has no instruction for the start macro")?;
    let mut slow = Vec::new();
    let lit = run_literal_traced(&e, literal, start, max_literal_steps, &mut slow);
    let LiteralEnd::Stopped { at: lit_at } = lit.end else {
        return Err(format!("the literal run ended with {:?}", lit.end));
    };
    let lit_macro = e.owner.get(lit_at).copied();
    if lit_macro != Some(at) {
        return Err(format!("the literal run stopped in macro {lit_macro:?}, the accelerated run in macro {at}"));
    }
    if Nat::from(lit.steps) != run.steps {
        return Err(format!("the literal run took {} steps, the accelerated run computed {:?}", lit.steps, run.steps));
    }
    let lit_counters: Vec<Nat> = lit.counters.into_iter().map(Nat::from).collect();
    if lit_counters != run.counters {
        return Err(format!("the counters differ: literal {lit_counters:?}, accelerated {:?}", run.counters));
    }
    if slow.len() != fast.len() {
        return Err(format!("the literal run entered {} macros, the accelerated run {}", slow.len(), fast.len()));
    }
    if let Some((s, f)) = slow.iter().zip(&fast).find(|((sm, ss), (fm, fs))| sm != fm || Nat::from(*ss) != *fs) {
        return Err(format!("the traces differ: literal entry {s:?}, accelerated entry {f:?}"));
    }
    Ok((run, lit.steps))
}

/// One counter during an accelerated run: the value `hi·b^digits + lo`, with `lo < b^digits`, and `weight`,
/// the sum of `b^digits` over the times its value was counted since it was last folded into the tally.
struct Counter {
    hi: Nat,
    lo: u64,
    digits: usize,
    weight: u64,
}

/// An accelerated run's counters and its deferred tally of `Σ(P + ⌊Q/b⌋)` and `Σ((Q mod b) + s + 4)`.
struct Buffers {
    base: u64,
    /// `powers[j] = base^j` for `j` up to the digits `lo` holds, `powers.len() - 1`.
    powers: Vec<u64>,
    by_block: Divisor,
    counters: Vec<Counter>,
    /// The counted values' `hi·weight` parts already added up.
    folded: Nat,
    /// The counted values' `lo` parts not yet in `folded`.
    lows: u128,
    /// `Σ((Q mod b) + s + 4)`, which is not multiplied by `b + 3`.
    loose: u128,
    spare: Nat,
    largest_bits: u64,
}

impl Buffers {
    fn new(base: u64, values: Vec<Nat>) -> Option<Buffers> {
        let mut powers = vec![1u64];
        while powers.len() <= 64 {
            let Some(next) = powers.last().and_then(|p| p.checked_mul(base)) else { break };
            powers.push(next);
        }
        let by_block = Divisor::new(*powers.last()?)?;
        let largest_bits = values.iter().map(Nat::bits).max().unwrap_or(0);
        let counters = values.into_iter().map(|hi| Counter { hi, lo: 0, digits: 0, weight: 0 }).collect();
        Some(Buffers {
            base,
            powers,
            by_block,
            counters,
            folded: Nat::zero(),
            lows: 0,
            loose: 0,
            spare: Nat::zero(),
            largest_bits,
        })
    }

    fn block(&self) -> usize {
        self.powers.len() - 1
    }

    /// Add counter `c`'s `hi·weight` to the tally and zero its weight — due before `hi` changes, and also
    /// before `weight` would overflow adding another power.
    fn fold(&mut self, c: usize) {
        let Buffers { counters, folded, spare, .. } = self;
        if let Some(counter) = counters.get_mut(c)
            && counter.weight != 0
        {
            spare.set(&counter.hi);
            spare.mul_add(counter.weight, 0);
            folded.add(spare);
            counter.weight = 0;
        }
    }

    /// Count counter `c`'s current value into `Σ(P + ⌊Q/b⌋)`.
    fn count(&mut self, c: usize) {
        let Some((digits, lo)) = self.counters.get(c).map(|k| (k.digits, k.lo)) else { return };
        let power = self.powers.get(digits).copied().unwrap_or(0);
        if self.counters.get(c).is_some_and(|k| k.weight.checked_add(power).is_none()) {
            self.fold(c);
        }
        if let Some(k) = self.counters.get_mut(c) {
            k.weight += power;
        }
        if let Some(sum) = self.lows.checked_add(u128::from(lo)) {
            self.lows = sum;
        } else {
            self.folded.add(&Nat::from(self.lows));
            self.lows = u128::from(lo);
        }
    }

    /// Remove counter `c`'s lowest digit, refilling `lo` from `hi` when it is empty.
    fn pop(&mut self, c: usize) -> u64 {
        if self.counters.get(c).is_some_and(|k| k.digits == 0) {
            self.fold(c);
            let block = self.block();
            if let Some(k) = self.counters.get_mut(c) {
                k.lo = k.hi.div_rem(&self.by_block);
                k.digits = block;
            }
        }
        let Some(k) = self.counters.get_mut(c) else { return 0 };
        let digit = k.lo % self.base;
        k.lo /= self.base;
        k.digits -= 1;
        digit
    }

    /// Make `s` counter `c`'s lowest digit, flushing `lo` into `hi` when it is full.
    fn push(&mut self, c: usize, s: u64) {
        let block = self.block();
        if self.counters.get(c).is_some_and(|k| k.digits == block) {
            self.fold(c);
            let scale = self.powers.get(block).copied().unwrap_or(1);
            if let Some(k) = self.counters.get_mut(c) {
                k.hi.mul_add(scale, k.lo);
                k.lo = 0;
                k.digits = 0;
                self.largest_bits = self.largest_bits.max(k.hi.bits());
            }
        }
        if let Some(k) = self.counters.get_mut(c) {
            k.lo = k.lo * self.base + s;
            k.digits += 1;
        }
    }

    /// The exact literal steps counted so far.
    fn total(&self) -> Nat {
        let mut sum = self.folded.clone();
        for k in &self.counters {
            let mut part = k.hi.clone();
            part.mul_add(k.weight, 0);
            sum.add(&part);
        }
        sum.add(&Nat::from(self.lows));
        sum.mul_add(self.base + 3, 0);
        sum.add(&Nat::from(self.loose));
        sum
    }

    /// Every counter's value.
    fn values(&self) -> Vec<Nat> {
        self.counters
            .iter()
            .map(|k| {
                let mut v = k.hi.clone();
                v.mul_add(self.powers.get(k.digits).copied().unwrap_or(1), k.lo);
                v
            })
            .collect()
    }
}

fn accelerate(
    p: &Program,
    counters: Vec<Nat>,
    caps: Caps,
    mut trace: Option<&mut Vec<(usize, Nat)>>,
) -> Result<Run, ProgramError> {
    p.check()?;
    if counters.len() != p.counters {
        return Err(ProgramError::CounterCount { expected: p.counters, got: counters.len() });
    }
    if !counters[p.scratch].is_zero() {
        return Err(ProgramError::ScratchNotZero);
    }
    let mut run = Buffers::new(p.base, counters).ok_or(ProgramError::Base)?;
    let mut pc = p.start;
    let mut executed = 0u64;
    let end = loop {
        if let Some(trace) = trace.as_mut() {
            trace.push((pc, run.total()));
        }
        let m = p.macros.get(pc).ok_or(ProgramError::NoSuchMacro { at: pc, target: pc })?;
        let Macro::Move { push, pop, s, exits } = m else {
            break if matches!(m, Macro::Spin) { End::Spun { at: pc } } else { End::Stopped { at: pc } };
        };
        if executed >= caps.macros {
            break End::MacroCap;
        }
        let digit = run.pop(*pop);
        run.count(*push);
        run.count(*pop);
        run.loose += u128::from(digit) + u128::from(*s) + 4;
        run.push(*push, *s);
        executed += 1;
        pc = *usize::try_from(digit).ok().and_then(|d| exits.get(d)).ok_or(ProgramError::Degenerate { at: pc })?;
        if run.largest_bits > caps.bits {
            break End::BitCap;
        }
    };
    let values = run.values();
    let largest_bits = values.iter().map(Nat::bits).fold(run.largest_bits, u64::max);
    Ok(Run { end, steps: run.total(), counters: values, macros: executed, largest_bits })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::counter::program::{expand, move_steps};
    use proptest::prelude::*;

    const WIDE: Caps = Caps { macros: 1_000_000, bits: 1 << 20 };

    /// Moves in both directions, with and without a digit, one of them its own exit, over base 3. Macro 0
    /// loops on itself while the digit it removes from `c1` is 2, which ends because `c1` shrinks; the rest
    /// only go forward, to one of two `Stop`s. Counter `c2` is scratch.
    fn branching() -> Program {
        let mv = |push: usize, pop: usize, s: u64, exits: Vec<usize>| Macro::Move { push, pop, s, exits };
        Program {
            counters: 3,
            scratch: 2,
            base: 3,
            start: 0,
            macros: vec![
                mv(0, 1, 2, vec![1, 2, 0]),
                mv(1, 0, 0, vec![2, 3, 4]),
                mv(1, 0, 1, vec![3, 4, 3]),
                Macro::Stop { state: 0, head: vec![] },
                Macro::Stop { state: 1, head: vec![] },
            ],
        }
    }

    proptest! {
        /// At every macro entry, a literal run of the expansion and an accelerated run of the macros report
        /// the same macro and the same literal steps so far; they stop at the same `Stop`, with the same
        /// counters, after the same number of literal steps.
        #[test]
        fn accelerated_and_literal_runs_agree_at_every_macro_entry(c0 in 0u64..60, c1 in 0u64..200) {
            let p = branching();
            let mut fast = Vec::new();
            let run = run_accelerated_traced(&p, vec![c0.into(), c1.into(), Nat::zero()], WIDE, &mut fast).unwrap();
            let End::Stopped { at } = run.end else { panic!("did not stop: {:?}", run.end) };

            let e = expand(&p).unwrap();
            let mut slow = Vec::new();
            let lit = run_literal_traced(&e, vec![c0, c1, 0], e.first[p.start], 1 << 40, &mut slow);
            let LiteralEnd::Stopped { at: lit_at } = lit.end else { panic!("did not stop: {:?}", lit.end) };

            prop_assert_eq!(e.owner[lit_at], at);
            prop_assert_eq!(Nat::from(lit.steps), run.steps);
            let counters: Vec<Nat> = lit.counters.into_iter().map(Nat::from).collect();
            prop_assert_eq!(counters, run.counters);
            let slow: Vec<(usize, Nat)> = slow.into_iter().map(|(m, s)| (m, Nat::from(s))).collect();
            prop_assert_eq!(slow, fast);
        }

        /// Many moves between two counters, over bases whose digit buffer holds 1, 4, 16 or 40 digits, so
        /// they flush and refill often: the buffered counters keep the values plain arithmetic on each counter
        /// gives, and the deferred tally equals `move_steps` summed move by move.
        #[test]
        fn buffered_counters_and_their_tally_match_plain_arithmetic(
            start in prop::collection::vec(prop::collection::vec(any::<u64>(), 0..6), 2..3),
            moves in prop::collection::vec((any::<bool>(), any::<u64>()), 0..300),
            base in prop_oneof![Just(1u64 << 32), Just(65_521u64), Just(15u64), Just(3u64)],
        ) {
            let values: Vec<Nat> = start.into_iter().map(Nat::from_limbs).collect();
            let mut plain = values.clone();
            let mut plain_steps = Nat::zero();
            let divisor = Divisor::new(base).unwrap();
            let mut run = Buffers::new(base, values).unwrap();
            for (rightward, s) in moves {
                let (push, pop) = if rightward { (0, 1) } else { (1, 0) };
                let s = s % base;
                let digit = run.pop(pop);
                run.count(push);
                run.count(pop);
                run.loose += u128::from(digit) + u128::from(s) + 4;
                run.push(push, s);

                let want_digit = plain[pop].div_rem(&divisor);
                prop_assert_eq!(digit, want_digit);
                plain_steps.add(&move_steps(base, s, &plain[push], &plain[pop], want_digit).unwrap());
                plain[push].mul_add(base, s);
            }
            prop_assert_eq!(run.values(), plain);
            prop_assert_eq!(run.total(), plain_steps);
        }
    }

    /// The macro budget stops a run before it executes a macro past it, and the bit budget stops one once a
    /// counter grows past it.
    #[test]
    fn each_cap_stops_the_run_that_reaches_it() {
        let run =
            run_accelerated(&branching(), vec![7u64.into(), 1u64.into(), Nat::zero()], Caps { macros: 1, bits: 64 });
        assert_eq!(run.map(|r| (r.end, r.macros)), Ok((End::MacroCap, 1)));

        let growing = Program {
            counters: 3,
            scratch: 2,
            base: 1000,
            start: 0,
            macros: vec![Macro::Move { push: 0, pop: 1, s: 999, exits: vec![0; 1000] }],
        };
        let run =
            run_accelerated(&growing, vec![1u64.into(), Nat::zero(), Nat::zero()], Caps { macros: 100, bits: 40 });
        let run = run.unwrap();
        assert_eq!(run.end, End::BitCap);
        assert!(run.largest_bits > 40, "{}", run.largest_bits);
    }

    /// An accelerated run executes one move, then reaches `Spin`: it reports `End::Spun` at the spin macro,
    /// having executed exactly the one move, with the counters that move leaves behind. Its literal expansion
    /// agrees on the trace up to the spin, then loops on itself until the step cap.
    #[test]
    fn an_accelerated_run_spins_after_a_move() {
        let mv = |push: usize, pop: usize, s: u64, exits: Vec<usize>| Macro::Move { push, pop, s, exits };
        let p =
            Program { counters: 3, scratch: 2, base: 2, start: 0, macros: vec![mv(0, 1, 1, vec![1, 1]), Macro::Spin] };
        let mut fast = Vec::new();
        let run = run_accelerated_traced(&p, vec![Nat::zero(), 5u64.into(), Nat::zero()], WIDE, &mut fast).unwrap();
        assert_eq!(run.end, End::Spun { at: 1 });
        assert_eq!(run.macros, 1);
        assert_eq!(run.counters, vec![Nat::from(1u64), Nat::from(2u64), Nat::zero()]);

        let e = expand(&p).unwrap();
        let mut slow = Vec::new();
        let lit = run_literal_traced(&e, vec![0, 5, 0], e.first[p.start], 1 << 20, &mut slow);
        assert_eq!(lit.end, LiteralEnd::StepCap);
        assert_eq!(lit.counters, vec![1, 2, 0]);
        let slow: Vec<(usize, Nat)> = slow.into_iter().map(|(m, s)| (m, Nat::from(s))).collect();
        assert_eq!(slow, fast);
    }

    /// A nonzero scratch counter is refused: macros hold it at zero between them, and a run that starts
    /// otherwise is not its expansion's.
    #[test]
    fn a_nonzero_scratch_counter_is_refused() {
        let got = run_accelerated(&branching(), vec![Nat::zero(), Nat::zero(), 1u64.into()], WIDE);
        assert_eq!(got, Err(ProgramError::ScratchNotZero));
    }

    /// A counter vector of the wrong length is refused rather than indexed past.
    #[test]
    fn a_counter_vector_of_the_wrong_length_is_refused() {
        let got = run_accelerated(&branching(), vec![Nat::zero(); 2], WIDE);
        assert_eq!(got, Err(ProgramError::CounterCount { expected: 3, got: 2 }));
    }
}
