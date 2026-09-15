//! Folding a three-counter literal program into a two-counter one, by Gödel numbering.
//!
//! Counter `A` holds `2^x · 3^y · 5^z` for the three counters `x`, `y` and `z` of the program being folded,
//! and counter `B` is scratch. Incrementing `y` multiplies `A` by 3, through `B`; decrementing it divides
//! `A` by 3, and a nonzero remainder says `y` was already zero, so the division is undone and the zero
//! branch taken.
//!
//! **THIS RUNS LITERALLY, AND ONLY ON TOYS.** Every instruction of the folded program costs steps in
//! proportion to `A`, and `A` is exponential in counters that are themselves exponential in a tape's
//! length. A stage 1 image of `3 - 5` has a counter of 1,253 bits, whose `A` would need about 10^377 bits to
//! store; a unary incrementer on four marks takes 2,974,863 two-counter steps.

use crate::counter::program::{Instr, MAX_LITERAL_INSTRS};

/// The prime each of the three counters is the exponent of, in counter order.
pub const PRIMES: [u64; 3] = [2, 3, 5];

/// The counter holding the Gödel number.
const A: usize = 0;
/// The scratch counter.
const B: usize = 1;

/// A folded program, and the first two-counter instruction of each three-counter instruction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Folded {
    pub instrs: Vec<Instr>,
    pub first: Vec<usize>,
}

/// Why a program cannot be folded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FoldError {
    /// The instruction at `at` names a counter past the three, or an instruction that does not exist.
    Malformed { at: usize },
    /// The folded program would hold more than `MAX_LITERAL_INSTRS` instructions.
    TooLarge,
}

/// The two-counter instructions `instr` folds to.
fn folded_len(instr: &Instr) -> Option<usize> {
    let prime = |c: usize| PRIMES.get(c).and_then(|p| usize::try_from(*p).ok());
    match *instr {
        Instr::Inc { c, .. } => Some(prime(c)? + 3),
        Instr::Dec { c, .. } => Some(3 * prime(c)? + 3),
        Instr::Stop => Some(1),
    }
}

/// Fold `three`, a literal program over counters 0, 1 and 2, into one over `A` and `B`.
///
/// With `p` the counter's prime and `base` the first folded instruction:
///
/// * `Inc` is `p + 3` instructions: move `A` into `B` `p` times over, then move `B` back into `A`.
/// * `Dec` is `3·p + 3`: divide `A` by `p` into `B`, the `Dec` that finds `A` empty naming the remainder
///   `m`. A remainder of zero moves the quotient back into `A` and takes the nonzero branch; any other
///   restores `A` to `p·B + m` and takes the zero branch.
/// * `Stop` is `Stop`.
///
/// # Errors
///
/// [`FoldError::Malformed`] for a counter past 2 or a jump past the program, [`FoldError::TooLarge`] past
/// `MAX_LITERAL_INSTRS`.
pub fn fold(three: &[Instr]) -> Result<Folded, FoldError> {
    let mut first = Vec::with_capacity(three.len());
    let mut total = 0usize;
    for (at, instr) in three.iter().enumerate() {
        first.push(total);
        total = folded_len(instr).ok_or(FoldError::Malformed { at })?.checked_add(total).ok_or(FoldError::TooLarge)?;
        if total > MAX_LITERAL_INSTRS {
            return Err(FoldError::TooLarge);
        }
    }
    let mut out = Vec::with_capacity(total);
    for (at, instr) in three.iter().enumerate() {
        let base = out.len();
        let to = |target: usize| first.get(target).copied().ok_or(FoldError::Malformed { at });
        let prime = |c: usize| PRIMES.get(c).and_then(|p| usize::try_from(*p).ok()).ok_or(FoldError::Malformed { at });
        match *instr {
            Instr::Inc { c, next } => {
                let p = prime(c)?;
                out.push(Instr::Dec { c: A, nonzero: base + 1, zero: base + p + 1 });
                for q in 0..p {
                    out.push(Instr::Inc { c: B, next: if q + 1 < p { base + 2 + q } else { base } });
                }
                out.push(Instr::Dec { c: B, nonzero: base + p + 2, zero: to(next)? });
                out.push(Instr::Inc { c: A, next: base + p + 1 });
            }
            Instr::Dec { c, nonzero, zero } => {
                let p = prime(c)?;
                let restore = |m: usize| if m == 0 { base + p + 1 } else { base + p + 2 + m };
                let undo = base + 2 * p + 2;
                for m in 0..p {
                    out.push(Instr::Dec { c: A, nonzero: base + m + 1, zero: restore(m) });
                }
                out.push(Instr::Inc { c: B, next: base });
                out.push(Instr::Dec { c: B, nonzero: base + p + 2, zero: to(nonzero)? });
                out.push(Instr::Inc { c: A, next: base + p + 1 });
                for m in 1..p {
                    out.push(Instr::Inc { c: A, next: if m == 1 { undo } else { restore(m - 1) } });
                }
                out.push(Instr::Dec { c: B, nonzero: undo + 1, zero: to(zero)? });
                for q in 0..p {
                    out.push(Instr::Inc { c: A, next: if q + 1 < p { undo + 2 + q } else { undo } });
                }
            }
            Instr::Stop => out.push(Instr::Stop),
        }
    }
    Ok(Folded { instrs: out, first })
}

/// `2^x · 3^y · 5^z` for `counters = [x, y, z]`, or `None` when it does not fit a `u64`.
#[must_use]
pub fn encode(counters: [u64; 3]) -> Option<u64> {
    PRIMES.iter().zip(counters).try_fold(1u64, |acc, (p, e)| acc.checked_mul(p.checked_pow(u32::try_from(e).ok()?)?))
}

/// The exponents `[x, y, z]` of `a = 2^x · 3^y · 5^z`, or `None` when `a` is zero or has another prime
/// factor.
#[must_use]
pub fn decode(mut a: u64) -> Option<[u64; 3]> {
    if a == 0 {
        return None;
    }
    let mut out = [0u64; 3];
    for (slot, p) in out.iter_mut().zip(PRIMES) {
        while a.is_multiple_of(p) {
            a /= p;
            *slot += 1;
        }
    }
    (a == 1).then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::counter::accel::{LiteralEnd, run_literal};
    use crate::counter::compile::{compile, toys};
    use crate::counter::nat::Nat;
    use crate::counter::program::{Macro, expand};
    use crate::counter::readback;
    use crate::tm::machine::{Machine, Symbol};
    use crate::tm::sim::{Caps as TmCaps, simulate_final};
    use crate::tm::single_tape::normalize;
    use proptest::prelude::*;

    proptest! {
        /// One `Inc` or `Dec` on any of the three counters, folded, does what it did unfolded: the same
        /// branch, and a Gödel number that decodes to the same counters.
        #[test]
        fn one_instruction_folds_to_the_same_effect(x in 0u64..6, y in 0u64..5, z in 0u64..4, c in 0usize..3, inc in any::<bool>()) {
            let three = if inc {
                vec![Instr::Inc { c, next: 1 }, Instr::Stop, Instr::Stop]
            } else {
                vec![Instr::Dec { c, nonzero: 1, zero: 2 }, Instr::Stop, Instr::Stop]
            };
            let unfolded = run_literal(&three, vec![x, y, z], 0, 10);
            let LiteralEnd::Stopped { at } = unfolded.end else { panic!("{:?}", unfolded.end) };
            let f = fold(&three).unwrap();
            let run = run_literal(&f.instrs, vec![encode([x, y, z]).unwrap(), 0], 0, 1 << 30);
            let LiteralEnd::Stopped { at: folded_at } = run.end else { panic!("{:?}", run.end) };
            prop_assert_eq!(f.first.binary_search(&folded_at), Ok(at));
            prop_assert_eq!(run.counters[B], 0);
            let want: [u64; 3] = unfolded.counters.try_into().unwrap();
            prop_assert_eq!(decode(run.counters[A]), Some(want));
        }
    }

    /// `decode` inverts `encode`, and refuses zero and a number with another prime factor.
    #[test]
    fn decode_inverts_encode_and_refuses_other_factors() {
        for counters in [[0, 0, 0], [3, 1, 2], [10, 0, 5]] {
            assert_eq!(decode(encode(counters).unwrap()), Some(counters));
        }
        assert_eq!(decode(0), None);
        assert_eq!(decode(14), None);
        assert_eq!(encode([64, 0, 0]), None);
    }

    /// Compile a toy, expand it, run its three-counter expansion and its two-counter fold literally, and
    /// require the fold to stop at the same instruction with the same counters — and those counters to read
    /// back to the simulator's tapes. Returns the two-counter step count.
    fn folds(what: &str, m: &Machine, inits: &[Vec<Symbol>]) -> u64 {
        let c = compile(m, inits).unwrap();
        let e = expand(&c.program).unwrap();
        let counters: Vec<u64> = c.counters.iter().map(|v| u64::try_from(v).unwrap()).collect();
        let start = e.first[c.program.start];
        let three = run_literal(&e.instrs, counters.clone(), start, 1 << 40);
        let LiteralEnd::Stopped { at } = three.end else { panic!("{what}: {:?}", three.end) };

        let f = fold(&e.instrs).unwrap();
        let gödel = encode(counters.try_into().unwrap()).unwrap();
        let two = run_literal(&f.instrs, vec![gödel, 0], f.first[start], 10_000_000_000);
        let LiteralEnd::Stopped { at: folded_at } = two.end else { panic!("{what}: {:?}", two.end) };
        assert_eq!(f.first.binary_search(&folded_at), Ok(at), "{what}: stopped elsewhere");
        assert_eq!(two.counters[B], 0, "{what}: scratch");
        let decoded = decode(two.counters[A]).unwrap_or_else(|| panic!("{what}: not a Gödel number"));
        assert_eq!(decoded.to_vec(), three.counters, "{what}: counters");

        let Macro::Stop { head, .. } = &c.program.macros[e.owner[at]] else { panic!("{what}: not a Stop") };
        let big: Vec<Nat> = decoded.iter().map(|v| Nat::from(*v)).collect();
        let got = readback::tapes(&big, head, &c.symbols).unwrap();
        let (want, ..) = simulate_final(m, inits, TmCaps { steps: 1_000_000, cells: 1_000_000 });
        let (cells, h) = want[0].snapshot();
        assert_eq!(normalize(&got[0].0, got[0].1), normalize(&cells, h), "{what}: tape");
        two.steps
    }

    /// The two-counter fold of the unary incrementer and of the parity eraser, each on up to four marks, stops
    /// where the three-counter program does, with the same counters and the same tape.
    #[test]
    fn toys_fold_to_two_counters() {
        for n in 0..=4 {
            folds(&format!("increment n={n}"), &toys::increment(), &[vec!['1'; n]]);
            folds(&format!("parity_eraser n={n}"), &toys::parity_eraser(), &[vec!['1'; n]]);
        }
    }

    /// The parity eraser on five marks, which takes over two hundred million two-counter steps.
    #[test]
    #[ignore = "slow tier: over 1 s in a debug build; run via scripts/check-slow.sh"]
    fn the_parity_eraser_on_five_marks_folds_to_two_counters() {
        let steps = folds("parity_eraser n=5", &toys::parity_eraser(), &[vec!['1'; 5]]);
        println!("parity_eraser n=5: {steps} two-counter steps");
    }

    /// The binary incrementer on three ones, which takes over two billion two-counter steps.
    #[test]
    #[ignore = "slow tier: over two billion literal two-counter steps; run via scripts/check-slow.sh"]
    fn the_binary_incrementer_folds_to_two_counters() {
        let steps = folds("binary_increment n=3", &toys::binary_increment(), &[vec!['1'; 3]]);
        println!("binary_increment n=3: {steps} two-counter steps");
    }
}
