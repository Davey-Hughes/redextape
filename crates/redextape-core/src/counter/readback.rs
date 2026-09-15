//! Reading a compiled machine's tapes back out of a stopped program's counters, and a stage 1 image's tape
//! back to the value its program computed.

use crate::counter::compile::{left, right};
use crate::counter::nat::{Divisor, Nat};
use crate::tm::decode::decode_tape_ty;
use crate::tm::encoding::Encoding;
use crate::tm::machine::Symbol;
use crate::tm::sim::Tape;
use crate::tm::single_tape::deinterleave;
use crate::ty::Ty;
use crate::value::Value;

/// Each tape as `(cells, head index)`, from the counters a compiled program stopped with and the digits
/// its `Stop` recorded under the heads — the shape `Tape::snapshot` returns.
///
/// A number has no leading zero digits, so a tape comes back without the `BLANK`s beyond its outermost
/// non-blank cells; compare it with a simulator's tape under `single_tape.rs`'s `normalize`. `None` when a
/// digit names no symbol or a counter is missing.
#[must_use]
pub fn tapes(counters: &[Nat], head: &[usize], symbols: &[Symbol]) -> Option<Vec<(Vec<Symbol>, usize)>> {
    let divisor = Divisor::new(u64::try_from(symbols.len()).ok()?)?;
    let digits = |v: &Nat| -> Option<Vec<Symbol>> {
        let mut v = v.clone();
        let mut out = Vec::new();
        while !v.is_zero() {
            let d = usize::try_from(v.div_rem(&divisor)).ok()?;
            out.push(*symbols.get(d)?);
        }
        Some(out)
    };
    head.iter()
        .enumerate()
        .map(|(i, under)| {
            let mut cells: Vec<Symbol> = digits(counters.get(left(i))?)?.into_iter().rev().collect();
            let at = cells.len();
            cells.push(*symbols.get(*under)?);
            cells.extend(digits(counters.get(right(i))?)?);
            Some((cells, at))
        })
        .collect()
}

/// The value a stage 1 image computed, from its one tape as [`tapes`] read it back: the tape split into the
/// `lowered_tapes` tapes of the machine stage 1 reduced, then decoded as `ty` under `enc`.
///
/// `None` when the tape is not a well-formed block skeleton, or does not decode as `ty`.
#[must_use]
pub fn value(stage_one: &[Symbol], lowered_tapes: usize, ty: &Ty, enc: &dyn Encoding) -> Option<Value> {
    let lowered = deinterleave(&Tape::new(stage_one), lowered_tapes)?;
    let rebuilt: Vec<Tape> = lowered.iter().map(|(cells, _)| Tape::new(cells)).collect();
    decode_tape_ty(&rebuilt, ty, enc)
}
