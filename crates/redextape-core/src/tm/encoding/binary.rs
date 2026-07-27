//! The base-2 `Encoding`: a value is exactly `width` digits, LSB-FIRST — the leftmost cell of a field
//! is 2⁰ — so a `w`-cell field holds `0 ..= 2^w - 1` and a 64-cell field is exactly a `u64`.
//!
//! Two properties distinguish every gadget here from its unary counterpart, and both come from the
//! same fact: a field is FULL of digits rather than marks-then-padding.
//!
//!   * **Counted, not content-driven, by default.** Most gadgets here — `write_literal`, `decode_nat`,
//!     and the shared `seek_slot`/`rewind_home` navigation they build on — walk exactly `width` cells
//!     and stop, instead of scanning to a blank. This is the style the BOX tape already uses,
//!     generalized to every tape. `branch_on_zero` (below) is a deliberate exception: it scans for a
//!     `MARK` and exits as soon as it meets one, because "is any digit set" cannot be decided by
//!     counting cells — see its own doc for why.
//!   * **No strict bound.** `MAX_FIELD_WIDTH`'s "a padding blank must always remain" (and the
//!     `rewind_home` miscount it prevents) is an artifact of content-driven loops over a mark/blank
//!     alphabet. It has no analogue here: every field is the same length and both digits are content.
//!
//! Overflow is still real, and still routes to `Builder::overflow()`: a carry out of the top digit, a
//! 1 shifted out of the top by `mul`, or a literal needing more than `width` digits.

use crate::core::BinOp;
use crate::tm::build::{AT, BOX, Builder, HEAP, MARK, MAX_FIELD_WIDTH, REG, RuleSpec, SEP, STACK, Slot, WORK, ZERO};
use crate::tm::encoding::{Encoding, rewind_home, seek_slot};
use crate::tm::machine::{BLANK, Move, StateId, Symbol};

/// Binary field content, in a fixed rule order: `ZERO` then `MARK`. Passed to every `seek_slot` /
/// `rewind_home` call so the skeleton walk crosses digits and halts only on `#`.
pub(crate) const BITS: &[Symbol] = &[ZERO, MARK];

/// The single WORK scratch field. Every gadget that must move a value between two fields of the same
/// tape bounces it through here, because a tape has one head.
///
/// One field is enough because `mul` shifts the ACCUMULATOR rather than the multiplicand (so there is
/// no multiplier register and no loop counter — the loop is unrolled at build time), and `eq` parks
/// its intermediate in REG `rd`, a fresh temporary, exactly as `Unary::eq_to_work` does.
///
/// `mov` (Task 7) is its first consumer, and later gadgets will follow; `write_literal`/`jz`/
/// `decode_nat` never touch WORK at all.
pub(crate) const W_ACC: Slot = 0;

/// How many fields `init_work` lays out.
const N_WORK_FIELDS: u32 = 1;

/// The base-2 encoding at a given field width. `Default` is `MAX_FIELD_WIDTH` (64 cells = a full
/// `u64`); `run_tm` auto-fits a narrower one per program via `at_width`.
#[derive(Clone, Copy, Debug)]
pub struct Binary {
    width: usize,
}

impl Default for Binary {
    fn default() -> Self {
        Binary { width: MAX_FIELD_WIDTH }
    }
}

impl Binary {
    /// A binary encoding whose fields are `width` cells — i.e. `width` BITS. Values `>= 2^width` are
    /// not representable and route to the overflow guard.
    pub const fn at(width: usize) -> Binary {
        Binary { width }
    }

    /// Whether `n` is representable in `width` digits. The `width >= 64` arm is not an optimization:
    /// `1u64 << 64` overflows, and at 64 cells every `u64` fits by definition.
    const fn fits(&self, n: u64) -> bool {
        self.width >= 64 || n < (1u64 << self.width)
    }

    /// Digit `i` of `n` as a tape symbol. `i >= 64` yields `ZERO`, which is correct: a `u64` has no
    /// set bits above 63, and it keeps the function total for a width the ceiling forbids anyway.
    fn bit(n: u64, i: usize) -> Symbol {
        if i < 64 && (n >> i) & 1 == 1 { MARK } else { ZERO }
    }

    /// Lay out a `#`-delimited all-zero bank of `fields` fields at this width.
    fn zero_bank(&self, fields: u32) -> Vec<Symbol> {
        let mut cells = vec![SEP];
        for _ in 0..fields {
            cells.extend(std::iter::repeat_n(ZERO, self.width));
            cells.push(SEP);
        }
        cells
    }
}

/// One lockstep digit-copy step: read `src`'s digit, write the SAME digit to `dst`, advance both
/// heads one cell.
///
/// Emits one rule per (src digit, dst digit) pair — four rules — so both reads are EXPLICIT. A
/// wildcard read under a non-`#` write is what `tests/common/mod.rs::unsafe_rules` rejects, and it is
/// rejected for a good reason: proving such a rule cannot land on a delimiter needs head-position
/// reasoning, whereas an explicit digit read makes it impossible by construction.
fn copy_digit_step(b: &mut Builder, cur: StateId, next: StateId, src: usize, dst: usize) {
    for &s in BITS {
        for &d in BITS {
            b.add_rule(cur, RuleSpec::new().on(src, Some(s), None, Move::R).on(dst, Some(d), Some(s), Move::R), next);
        }
    }
}

/// Ripple field `rb` of REG into WORK's `W_ACC`, LSB to MSB, with the carry held in the STATE — so
/// this is two states and O(1) rules, not O(width). `from`: REG home, WORK home. On the returned exit
/// both heads are home and `W_ACC` holds the sum. A carry out of the top digit routes to the shared
/// overflow guard.
fn ripple_add(b: &mut Builder, from: StateId, rb: Slot, label: &str) -> StateId {
    let at_reg = seek_slot(b, from, REG, BITS, rb, &format!("{label}.rs"));
    let at_work = seek_slot(b, at_reg, WORK, BITS, W_ACC, &format!("{label}.ws"));
    let c0 = b.state(format!("{label}.c0"));
    let c1 = b.state(format!("{label}.c1"));
    b.add_rule(at_work, RuleSpec::new(), c0);
    for (carry_in, st) in [(0u64, c0), (1, c1)] {
        for &x in BITS {
            for &y in BITS {
                let xv = u64::from(x == MARK);
                let yv = u64::from(y == MARK);
                let s = xv + yv + carry_in;
                let out = if s & 1 == 1 { MARK } else { ZERO };
                let next = if s >= 2 { c1 } else { c0 };
                b.add_rule(
                    st,
                    RuleSpec::new().on(REG, Some(x), None, Move::R).on(WORK, Some(y), Some(out), Move::R),
                    next,
                );
            }
        }
    }
    // Both heads hit their trailing `#` together. No carry -> done; a carry out of the top digit is an
    // overflow, which the caller retries at a wider bank.
    let fin = b.state(format!("{label}.fin"));
    b.add_rule(c0, RuleSpec::new().on(REG, Some(SEP), None, Move::L).on(WORK, Some(SEP), None, Move::L), fin);
    let overflow = b.overflow();
    b.add_rule(c1, RuleSpec::new().on(REG, Some(SEP), None, Move::S), overflow);
    let h1 = rewind_home(b, fin, REG, BITS, rb, &format!("{label}.r1"));
    rewind_home(b, h1, WORK, BITS, W_ACC, &format!("{label}.r2"))
}

/// Ripple-subtract field `rb` of REG from WORK's `W_ACC` with a borrow, LSB to MSB. `from`: REG home,
/// WORK home. On the returned exit both heads are home and `W_ACC` holds `max(0, acc - rb)`.
///
/// A borrow out of the TOP digit means the true result is negative. Monus truncates, so that path
/// zeroes the field rather than leaving the wrapped two's-complement value — the exact defect a ripple
/// that simply dropped the final borrow would ship, and one that produces plausible-looking small
/// numbers rather than obvious garbage.
fn ripple_sub(b: &mut Builder, from: StateId, rb: Slot, label: &str) -> StateId {
    let at_reg = seek_slot(b, from, REG, BITS, rb, &format!("{label}.rs"));
    let at_work = seek_slot(b, at_reg, WORK, BITS, W_ACC, &format!("{label}.ws"));
    let d0 = b.state(format!("{label}.d0")); // no borrow pending
    let d1 = b.state(format!("{label}.d1")); // borrow pending
    b.add_rule(at_work, RuleSpec::new(), d0);
    for (borrow_in, st) in [(0i64, d0), (1, d1)] {
        for &x in BITS {
            for &y in BITS {
                let xv = i64::from(x == MARK);
                let yv = i64::from(y == MARK);
                let s = yv - xv - borrow_in; // acc digit minus rb digit minus borrow
                let out = if s.rem_euclid(2) == 1 { MARK } else { ZERO };
                let next = if s < 0 { d1 } else { d0 };
                b.add_rule(
                    st,
                    RuleSpec::new().on(REG, Some(x), None, Move::R).on(WORK, Some(y), Some(out), Move::R),
                    next,
                );
            }
        }
    }
    let fin = b.state(format!("{label}.fin"));
    b.add_rule(d0, RuleSpec::new().on(REG, Some(SEP), None, Move::L).on(WORK, Some(SEP), None, Move::L), fin);
    // Borrow out of the top: the result is negative, so monus gives 0. Step both heads back inside
    // their fields, then walk `W_ACC` leftward writing ZERO over every digit.
    let neg = b.state(format!("{label}.neg"));
    b.add_rule(d1, RuleSpec::new().on(REG, Some(SEP), None, Move::L).on(WORK, Some(SEP), None, Move::L), neg);
    for &y in BITS {
        b.add_rule(neg, RuleSpec::new().on(WORK, Some(y), Some(ZERO), Move::L), neg);
    }
    // The zeroing walk stops on `W_ACC`'s LEADING `#`; step back onto digit 0 so both exits enter the
    // rewind with the head inside the field.
    b.add_rule(neg, RuleSpec::new().on(WORK, Some(SEP), None, Move::R), fin);
    let h1 = rewind_home(b, fin, REG, BITS, rb, &format!("{label}.r1"));
    rewind_home(b, h1, WORK, BITS, W_ACC, &format!("{label}.r2"))
}

/// Copy field `src` of `src_tape` into field `dst` of `dst_tape`, digit for digit. `from`: both heads
/// at their tape's home (leading `#`). On exit both heads are home again and `dst` holds `src`'s
/// value; `src` is unchanged.
///
/// Both banks are laid out at the same width by `init_reg`/`init_work`, so the two counted walks stay
/// in step and both heads reach their field's trailing `#` on the same transition.
#[allow(clippy::too_many_arguments)] // a (tape, slot) pair per side, plus label, mirrors seek_slot's shape doubled.
fn copy_field(
    b: &mut Builder,
    from: StateId,
    width: usize,
    src_tape: usize,
    src: Slot,
    dst_tape: usize,
    dst: Slot,
    label: &str,
) -> StateId {
    let at_src = seek_slot(b, from, src_tape, BITS, src, &format!("{label}.ss"));
    let at_dst = seek_slot(b, at_src, dst_tape, BITS, dst, &format!("{label}.ds"));
    let mut cur = at_dst;
    for i in 0..width {
        let nxt = b.state(format!("{label}.c{i}"));
        copy_digit_step(b, cur, nxt, src_tape, dst_tape);
        cur = nxt;
    }
    // Both heads rest on their field's trailing `#`; step both back inside so `rewind_home`'s
    // precondition holds on each.
    let back = b.state(format!("{label}.bk"));
    b.add_rule(
        cur,
        RuleSpec::new().on(src_tape, Some(SEP), None, Move::L).on(dst_tape, Some(SEP), None, Move::L),
        back,
    );
    let h1 = rewind_home(b, back, src_tape, BITS, src, &format!("{label}.r1"));
    rewind_home(b, h1, dst_tape, BITS, dst, &format!("{label}.r2"))
}

/// Write all-zero over field `slot` of `tape`. `from`/exit: `tape` head home.
fn zero_field(b: &mut Builder, from: StateId, width: usize, tape: usize, slot: Slot, label: &str) -> StateId {
    let at = seek_slot(b, from, tape, BITS, slot, &format!("{label}.s"));
    let mut cur = at;
    for i in 0..width {
        let nxt = b.state(format!("{label}.z{i}"));
        for &d in BITS {
            b.add_rule(cur, RuleSpec::new().on(tape, Some(d), Some(ZERO), Move::R), nxt);
        }
        cur = nxt;
    }
    let back = b.state(format!("{label}.bk"));
    b.add_rule(cur, RuleSpec::new().on(tape, Some(SEP), None, Move::L), back);
    rewind_home(b, back, tape, BITS, slot, &format!("{label}.r"))
}

/// `W_ACC <<= 1` in place: `new[i] = old[i-1]`, `new[0] = 0`. `from`/exit: WORK head home.
///
/// Walks MSB-to-LSB carrying ONE digit in the state — three transitions per cell — so the shift is
/// O(width) steps. The digit shifted OUT of the top is `old[width-1]`; if it is set, the product does
/// not fit and the walk routes to the shared overflow guard before touching anything.
///
/// CORRECTION: earlier text here also claimed O(1) states. That was wrong — the counted walk to the
/// MSB (`for i in 1..width`, below) allocates one fresh state per digit, so a single call is O(width)
/// states, same order as its step count. See the `Mul` arm's comment for the consequence this has for
/// `Mul` as a whole.
fn shift_left_acc(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId {
    let at = seek_slot(b, from, WORK, BITS, W_ACC, &format!("{label}.s")); // on digit 0
    // Counted walk to the MSB, so it cannot depend on content.
    let mut cur = at;
    for i in 1..width {
        let nxt = b.state(format!("{label}.up{i}"));
        for &d in BITS {
            b.add_rule(cur, RuleSpec::new().on(WORK, Some(d), None, Move::R), nxt);
        }
        cur = nxt;
    }
    let overflow = b.overflow();
    b.add_rule(cur, RuleSpec::new().on(WORK, Some(MARK), None, Move::S), overflow); // a 1 would shift out
    let need = b.state(format!("{label}.need"));
    b.add_rule(cur, RuleSpec::new().on(WORK, Some(ZERO), None, Move::L), need);
    // `need` on cell i: read old[i], step R to cell i+1 carrying it in the state; write; step back.
    let wr0 = b.state(format!("{label}.wr0"));
    let wr1 = b.state(format!("{label}.wr1"));
    b.add_rule(need, RuleSpec::new().on(WORK, Some(ZERO), None, Move::R), wr0);
    b.add_rule(need, RuleSpec::new().on(WORK, Some(MARK), None, Move::R), wr1);
    let back = b.state(format!("{label}.back"));
    for (st, d) in [(wr0, ZERO), (wr1, MARK)] {
        for &old in BITS {
            b.add_rule(st, RuleSpec::new().on(WORK, Some(old), Some(d), Move::L), back);
        }
    }
    // Writes nothing, so a wildcard read is safe here — `unsafe_rules` only inspects rules that write.
    b.add_rule(back, RuleSpec::new().on(WORK, None, None, Move::L), need);
    // `need` reached the field's LEADING `#`: step onto digit 0 and write the incoming zero.
    let zlo = b.state(format!("{label}.zlo"));
    b.add_rule(need, RuleSpec::new().on(WORK, Some(SEP), None, Move::R), zlo);
    let done = b.state(format!("{label}.done"));
    for &old in BITS {
        b.add_rule(zlo, RuleSpec::new().on(WORK, Some(old), Some(ZERO), Move::S), done);
    }
    rewind_home(b, done, WORK, BITS, W_ACC, &format!("{label}.r"))
}

/// Branch on digit `i` of field `slot` of `tape`. `entry` and both exits have the `tape` head home,
/// rewound there on BOTH exits, so the two branches are interchangeable with any other gadget's. `i`
/// is a build-time constant, so the walk to it is a counted chain rather than a scan.
#[allow(clippy::too_many_arguments)] // a (tape, slot) pair, the digit index, both branch targets, plus label.
fn bit_is_one(
    b: &mut Builder,
    entry: StateId,
    tape: usize,
    slot: Slot,
    i: usize,
    if_one: StateId,
    if_zero: StateId,
    label: &str,
) {
    let at = seek_slot(b, entry, tape, BITS, slot, &format!("{label}.s"));
    let mut cur = at;
    for k in 0..i {
        let nxt = b.state(format!("{label}.w{k}"));
        for &d in BITS {
            b.add_rule(cur, RuleSpec::new().on(tape, Some(d), None, Move::R), nxt);
        }
        cur = nxt;
    }
    let one = b.state(format!("{label}.one"));
    let zero = b.state(format!("{label}.zro"));
    b.add_rule(cur, RuleSpec::new().on(tape, Some(MARK), None, Move::S), one);
    b.add_rule(cur, RuleSpec::new().on(tape, Some(ZERO), None, Move::S), zero);
    let h1 = rewind_home(b, one, tape, BITS, slot, &format!("{label}.ro"));
    b.add_rule(h1, RuleSpec::new(), if_one);
    let h0 = rewind_home(b, zero, tape, BITS, slot, &format!("{label}.rz"));
    b.add_rule(h0, RuleSpec::new(), if_zero);
}

// ---- STACK tape sub-primitives (free functions; each preserves the STACK "top" invariant) ----
//
// The STACK holds `[field]#[field]#…#[field]#` with the head on the BLANK immediately after the last
// `#` (the "top"). That SKELETON is unchanged from `Unary` (`stack_is_empty`, shared in `encoding.rs`,
// is untouched). What changes is that a field is exactly `width` digits rather than a variable-length
// mark run, so push and pop below are COUNTED walks instead of scans to a blank.

/// Append `W_ACC`'s digits as a new `width`-cell field terminated by `#` at the STACK top. `from`:
/// WORK home, STACK head at the top. On exit the STACK head is at the new top and WORK is home with
/// `W_ACC` unchanged.
///
/// Both reads are explicit: the WORK read is a digit, the STACK read is the fresh tape's `BLANK`.
fn stack_push_acc(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId {
    let at = seek_slot(b, from, WORK, BITS, W_ACC, &format!("{label}.s"));
    let mut cur = at;
    for i in 0..width {
        let nxt = b.state(format!("{label}.p{i}"));
        for &d in BITS {
            b.add_rule(
                cur,
                RuleSpec::new().on(WORK, Some(d), None, Move::R).on(STACK, Some(BLANK), Some(d), Move::R),
                nxt,
            );
        }
        cur = nxt;
    }
    // Terminate the field and step onto the new blank top; step WORK back inside `W_ACC` to rewind.
    let term = b.state(format!("{label}.t"));
    b.add_rule(
        cur,
        RuleSpec::new().on(WORK, Some(SEP), None, Move::L).on(STACK, Some(BLANK), Some(SEP), Move::R),
        term,
    );
    rewind_home(b, term, WORK, BITS, W_ACC, &format!("{label}.r"))
}

/// Append the build-time constant `c` as a new `width`-cell field at the STACK top. `from`: STACK
/// head at the top. On exit the STACK head is at the new top; WORK and REG are untouched.
fn stack_push_literal(b: &mut Builder, from: StateId, c: u64, width: usize, label: &str) -> StateId {
    let mut cur = from;
    for i in 0..width {
        let nxt = b.state(format!("{label}.d{i}"));
        let d = Binary::bit(c, i);
        b.add_rule(cur, RuleSpec::new().on(STACK, Some(BLANK), Some(d), Move::R), nxt);
        cur = nxt;
    }
    let top = b.state(format!("{label}.t"));
    b.add_rule(cur, RuleSpec::new().on(STACK, Some(BLANK), Some(SEP), Move::R), top);
    top
}

/// Pop the top STACK field into `W_ACC`, erasing it. `from`: STACK head at the top over a NON-EMPTY
/// stack, WORK home. On exit `W_ACC` holds the popped value, WORK is home, and the STACK head is at
/// the new top with the field and its `#` blanked.
///
/// The STACK is read MSB-first (walking left from the `#`) while `W_ACC` is written MSB-first
/// (walking left from its top digit), so the two walks stay aligned and the value is not reversed —
/// the defect a naive "read left, write right" pop would ship, and one that is invisible for
/// palindromic values like 0, 9 (`1001`) and 15.
fn stack_pop_acc(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId {
    // Erase the field's terminating `#` and step left onto its top digit.
    let on_top = b.state(format!("{label}.h"));
    b.add_rule(from, RuleSpec::new().on(STACK, Some(BLANK), None, Move::L), on_top);
    let at_msb = b.state(format!("{label}.m"));
    // This rule reads `SEP` and writes `BLANK`, which the REG/BOX safety rule ("a non-`#` write must
    // read an explicit non-`#` symbol") would forbid. It is a DELIBERATE ERASURE, not a clobber risk:
    // popping a frame is exactly the act of removing that delimiter, and `assert_delimiter_safe`
    // excludes STACK/HEAP for this reason — they are variable-width and delimited by DATA, so they
    // have no fixed skeleton to destroy. Do not "fix" this by weakening the read.
    b.add_rule(on_top, RuleSpec::new().on(STACK, Some(SEP), Some(BLANK), Move::L), at_msb);
    // Park the WORK head on `W_ACC`'s TOP digit (counted walk from digit 0).
    let at_w0 = seek_slot(b, at_msb, WORK, BITS, W_ACC, &format!("{label}.s"));
    let mut cur = at_w0;
    for i in 1..width {
        let nxt = b.state(format!("{label}.u{i}"));
        for &d in BITS {
            b.add_rule(cur, RuleSpec::new().on(WORK, Some(d), None, Move::R), nxt);
        }
        cur = nxt;
    }
    // Walk both heads LEFT, copying and erasing, `width` times.
    for i in 0..width {
        let nxt = b.state(format!("{label}.c{i}"));
        for &s in BITS {
            for &w in BITS {
                b.add_rule(
                    cur,
                    RuleSpec::new().on(STACK, Some(s), Some(BLANK), Move::L).on(WORK, Some(w), Some(s), Move::L),
                    nxt,
                );
            }
        }
        cur = nxt;
    }
    // STACK is now on the boundary below the popped field (a `#`, or the origin blank); WORK is on
    // `W_ACC`'s leading `#`. Step both back to their resting positions.
    let fin = b.state(format!("{label}.f"));
    for &boundary in &[SEP, BLANK] {
        b.add_rule(
            cur,
            RuleSpec::new().on(STACK, Some(boundary), None, Move::R).on(WORK, Some(SEP), None, Move::R),
            fin,
        );
    }
    rewind_home(b, fin, WORK, BITS, W_ACC, &format!("{label}.r"))
}

/// Branch on whether field `slot` of `tape` equals the build-time constant `c`. `entry` and both
/// exits have the `tape` head home. A counted digit-by-digit comparison: `width` states, each with a
/// match arm and a mismatch arm, both of which rewind.
#[allow(clippy::too_many_arguments)] // a (tape, slot) pair, the constant, width, both branch targets, plus label.
fn branch_on_equals(
    b: &mut Builder,
    entry: StateId,
    tape: usize,
    slot: Slot,
    c: u64,
    width: usize,
    if_eq: StateId,
    if_ne: StateId,
    label: &str,
) {
    let at = seek_slot(b, entry, tape, BITS, slot, &format!("{label}.s"));
    let mut cur = at;
    // Each digit position gets its own mismatch exit, because the head is at a different offset in
    // each. That is a SIMPLICITY choice, not a necessity: `rewind_home` self-loops over content until
    // it meets `SEP`, so it is offset-independent within a field and one shared mismatch exit would be
    // equally correct — and O(width) states cheaper per call, which `dispatch_tag` pays once per exit.
    // Recorded as a known non-minimality rather than left implying the per-digit exits are required.
    for i in 0..width {
        let nxt = b.state(format!("{label}.e{i}"));
        let ne = b.state(format!("{label}.x{i}"));
        let want = Binary::bit(c, i);
        let other = if want == MARK { ZERO } else { MARK };
        b.add_rule(cur, RuleSpec::new().on(tape, Some(want), None, Move::R), nxt);
        b.add_rule(cur, RuleSpec::new().on(tape, Some(other), None, Move::S), ne);
        let h = rewind_home(b, ne, tape, BITS, slot, &format!("{label}.rx{i}"));
        b.add_rule(h, RuleSpec::new(), if_ne);
        cur = nxt;
    }
    // Every digit matched; the head is on the field's trailing `#`. Step back inside to rewind.
    let back = b.state(format!("{label}.bk"));
    b.add_rule(cur, RuleSpec::new().on(tape, Some(SEP), None, Move::L), back);
    let h = rewind_home(b, back, tape, BITS, slot, &format!("{label}.re"));
    b.add_rule(h, RuleSpec::new(), if_eq);
}

// ---- HEAP tape sub-primitives (free functions; each preserves the HEAP "top" invariant) ----
//
// The HEAP holds `@ <head digits> # <tail digits>` cons cells laid left-to-right, the head on the
// BLANK immediately after the last cell (the "top"); an empty heap has the head at the origin over a
// blank. Cells sit at 1-based addresses (nil = pointer 0). What changes from `Unary`'s HEAP is that a
// cell is FIXED width — `heap_cell_len(width)` cells, always — rather than a variable-length mark run,
// so moving from one cell to the next is a COUNTED skip rather than a content scan. Locating the FIRST
// cell from the top is still a content scan (`heap_rewind_to_first_cell`): the NUMBER of cells is not
// known at build time even though each cell's WIDTH is, so there is no fixed offset back to it.

/// Cell size on the binary HEAP, in cells: `@` + width digits + `#` + width digits.
fn heap_cell_len(width: usize) -> usize {
    2 * width + 2
}

/// Blindly advance `tape`'s head `n` cells in direction `mv`, writing nothing and reading with a
/// wildcard — safe precisely because it never writes, so no "explicit non-`#` read" obligation applies.
/// Shared machinery for the HEAP walkers above and the BOX walkers below: both must cross an
/// already-located, fixed-length cell/field once its start is known, and before this was extracted that
/// "blindly skip N cells" loop was duplicated three times over (once per HEAP walker). There are now
/// ELEVEN call sites — 3 on HEAP and 8 on BOX, the latter in both directions, since BOX's
/// origin-preserving design skips forward to seek/count and backward to return home. (An earlier
/// version of this comment said "four more, five total beyond three"; it undercounted, and the commit
/// message that introduced it repeats the wrong figure.)
/// `from`/exit: `tape` head moved exactly `n` cells.
fn skip_cells(b: &mut Builder, from: StateId, tape: usize, n: usize, mv: Move, label: &str) -> StateId {
    let mut cur = from;
    for k in 0..n {
        let nxt = b.state(format!("{label}.sk{k}"));
        b.add_rule(cur, RuleSpec::new().on(tape, None, None, mv), nxt);
        cur = nxt;
    }
    cur
}

/// `W_ACC += 1`. Walks LSB to MSB flipping 1s to 0s until the first 0, which becomes 1. A carry out
/// of the top digit routes to the shared overflow guard. `from`/exit: WORK head home.
fn inc_acc(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let at = seek_slot(b, from, WORK, BITS, W_ACC, &format!("{label}.s"));
    // Carry pending: a 1 becomes 0 and the carry continues; a 0 becomes 1 and the carry stops.
    let done = b.state(format!("{label}.d"));
    b.add_rule(at, RuleSpec::new().on(WORK, Some(MARK), Some(ZERO), Move::R), at);
    b.add_rule(at, RuleSpec::new().on(WORK, Some(ZERO), Some(MARK), Move::S), done);
    let overflow = b.overflow();
    b.add_rule(at, RuleSpec::new().on(WORK, Some(SEP), None, Move::S), overflow); // carry out of the top
    rewind_home(b, done, WORK, BITS, W_ACC, &format!("{label}.r"))
}

/// `W_ACC -= 1`, truncating at zero (monus). Walks LSB to MSB flipping 0s to 1s until the first 1,
/// which becomes 0. A borrow out of the top means the value was already zero, in which case the walk
/// has flipped every digit to 1 and must zero the field again — which is why the `SEP` arm re-zeroes
/// rather than simply exiting. `from`/exit: WORK head home.
fn dec_acc(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let at = seek_slot(b, from, WORK, BITS, W_ACC, &format!("{label}.s"));
    let done = b.state(format!("{label}.d"));
    b.add_rule(at, RuleSpec::new().on(WORK, Some(ZERO), Some(MARK), Move::R), at);
    b.add_rule(at, RuleSpec::new().on(WORK, Some(MARK), Some(ZERO), Move::S), done);
    // Borrow out of the top: the value was 0. Every digit is now 1; walk back left re-zeroing.
    let neg = b.state(format!("{label}.n"));
    b.add_rule(at, RuleSpec::new().on(WORK, Some(SEP), None, Move::L), neg);
    for &d in BITS {
        b.add_rule(neg, RuleSpec::new().on(WORK, Some(d), Some(ZERO), Move::L), neg);
    }
    b.add_rule(neg, RuleSpec::new().on(WORK, Some(SEP), None, Move::R), done);
    rewind_home(b, done, WORK, BITS, W_ACC, &format!("{label}.r"))
}

/// Open a new HEAP cell: writes `@`, then `width` digits copied from WORK's `W_ACC` field (left
/// INTACT), then `#`, growing the tape at the top. `from`: WORK home over `W_ACC`, HEAP head at the
/// top (a fresh `BLANK`). On exit: HEAP head at the new top (the fresh `BLANK` right after the `#`),
/// WORK home with `W_ACC` unchanged. Pair with `heap_append_bin` to write the tail. Both reads on every
/// HEAP-writing rule are explicit `BLANK` — the write always lands on virgin tape, never a delimiter.
fn heap_open_cell_bin(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId {
    let at_w = seek_slot(b, from, WORK, BITS, W_ACC, &format!("{label}.s"));
    let cp = b.state(format!("{label}.at"));
    b.add_rule(at_w, RuleSpec::new().on(HEAP, Some(BLANK), Some(AT), Move::R), cp);
    let mut cur = cp;
    for i in 0..width {
        let nxt = b.state(format!("{label}.c{i}"));
        for &d in BITS {
            b.add_rule(
                cur,
                RuleSpec::new().on(WORK, Some(d), None, Move::R).on(HEAP, Some(BLANK), Some(d), Move::R),
                nxt,
            );
        }
        cur = nxt;
    }
    // WORK rests on `W_ACC`'s trailing `#`; HEAP rests on the fresh top (right after the last head
    // digit). Write the head/tail `#`, landing HEAP on the new top; step WORK back inside to rewind.
    let term = b.state(format!("{label}.t"));
    b.add_rule(cur, RuleSpec::new().on(WORK, Some(SEP), None, Move::L).on(HEAP, Some(BLANK), Some(SEP), Move::R), term);
    rewind_home(b, term, WORK, BITS, W_ACC, &format!("{label}.r"))
}

/// Append `W_ACC`'s digits as the tail word at the HEAP top — no closing delimiter; the next cell's
/// `@` (or the run's end) closes it implicitly. `from`: WORK home over `W_ACC`, HEAP head at the top.
/// On exit: HEAP head at the new top, WORK home with `W_ACC` unchanged.
fn heap_append_bin(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId {
    let at_w = seek_slot(b, from, WORK, BITS, W_ACC, &format!("{label}.s"));
    let mut cur = at_w;
    for i in 0..width {
        let nxt = b.state(format!("{label}.c{i}"));
        for &d in BITS {
            b.add_rule(
                cur,
                RuleSpec::new().on(WORK, Some(d), None, Move::R).on(HEAP, Some(BLANK), Some(d), Move::R),
                nxt,
            );
        }
        cur = nxt;
    }
    // WORK rests on `W_ACC`'s trailing `#`; HEAP already rests on the new top (no closing delimiter to
    // write there). Step WORK back inside to rewind.
    let back = b.state(format!("{label}.bk"));
    b.add_rule(cur, RuleSpec::new().on(WORK, Some(SEP), None, Move::L), back);
    rewind_home(b, back, WORK, BITS, W_ACC, &format!("{label}.r"))
}

/// Walk the HEAP head from the top back to the origin — a content scan, because the NUMBER of cells
/// is not a build-time constant even though each cell's width is — then step onto cell 1's first
/// symbol, or the top blank if the heap is empty. Shared entry sequence for `heap_count_cells_bin` and
/// `heap_seek_cell_bin`; returns a fresh state with no rules yet, for the caller to branch on.
fn heap_rewind_to_first_cell(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let wl = b.state(format!("{label}.wl"));
    b.add_rule(from, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::L), wl); // off the top blank
    for &c in &[AT, SEP, ZERO, MARK] {
        b.add_rule(wl, RuleSpec::new().on(HEAP, Some(c), None, Move::L), wl);
    }
    let onto = b.state(format!("{label}.on"));
    b.add_rule(wl, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::R), onto); // origin-left -> cell 1 / top
    onto
}

/// Count the HEAP's cons cells into WORK's `W_ACC`. `from`: HEAP head at the top, WORK home with
/// `W_ACC` ALREADY ZERO. Cells are fixed width, so this is a counted skip per cell rather than
/// `Unary::heap_count_cells_to_work`'s content scan: at each `@`, `inc_acc`, then skip
/// `heap_cell_len(width)` cells (content-blind — the shape there is already known) and repeat; a
/// `BLANK` means the top has been reached. On exit WORK is home holding the count and the HEAP head is
/// back at the top.
fn heap_count_cells_bin(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId {
    let check = heap_rewind_to_first_cell(b, from, &format!("{label}.rw"));
    let saw_at = b.state(format!("{label}.at"));
    let done = b.state(format!("{label}.dn"));
    b.add_rule(check, RuleSpec::new().on(HEAP, Some(AT), None, Move::S), saw_at);
    b.add_rule(check, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::S), done);
    let after_inc = inc_acc(b, saw_at, &format!("{label}.in")); // WORK-only; HEAP stays parked on `@`
    let skipped = skip_cells(b, after_inc, HEAP, heap_cell_len(width), Move::R, &format!("{label}.sk"));
    b.add_rule(skipped, RuleSpec::new(), check);
    done
}

/// Runtime-seek the `P`-th cons cell (1-based), a two-exit gadget (like `Unary::heap_seek_cell`).
/// Cells are fixed width, so this is a counted skip chain rather than a content scan. PRECONDITION:
/// WORK's `W_ACC` holds the counter `P >= 1` at home; HEAP head at the top; REG home. `found`: HEAP
/// head on the `P`-th cell's `@`, WORK's `W_ACC` drained to zero (home); REG home. `missing`: `P`
/// exceeds the cell count (or the heap is empty) — HEAP position unspecified (the caller routes to a
/// fault spin, never to the overflow guard: see `deref_op`). Read-only on REG.
fn heap_seek_cell_bin(b: &mut Builder, from: StateId, width: usize, found: StateId, missing: StateId, label: &str) {
    let loop_head = heap_rewind_to_first_cell(b, from, &format!("{label}.rw"));
    let saw_at = b.state(format!("{label}.at"));
    b.add_rule(loop_head, RuleSpec::new().on(HEAP, Some(AT), None, Move::S), saw_at);
    b.add_rule(loop_head, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::S), missing); // ran off the top
    let after_dec = dec_acc(b, saw_at, &format!("{label}.dc")); // WORK-only; HEAP stays parked on `@`
    let zero = b.state(format!("{label}.z"));
    let nonzero = b.state(format!("{label}.n"));
    branch_on_zero(b, after_dec, WORK, W_ACC, zero, nonzero, &format!("{label}.bz"));
    b.add_rule(zero, RuleSpec::new(), found); // drained -> this `@` is the target
    let skipped = skip_cells(b, nonzero, HEAP, heap_cell_len(width), Move::R, &format!("{label}.sk"));
    b.add_rule(skipped, RuleSpec::new(), loop_head);
}

/// Read the `width`-digit word starting `offset` cells right of a cell's `@` into WORK's `W_ACC`,
/// overwriting whatever it currently holds (the seek's drained-to-zero counter). `from`: HEAP head on
/// the cell's `@`, WORK HOME (the leading `#`, as `heap_seek_cell_bin`'s `found` leaves it — same
/// convention as `rewind_home` everywhere else in this file, NOT `W_ACC`'s first digit). On exit WORK
/// is home holding the word; the HEAP head sits on the boundary right after the word (the `#` before
/// the tail, for a head-word read at `offset = 1`; the next cell's `@`, or the true top, for a
/// tail-word read at `offset = width + 2`).
fn heap_read_word_bin(b: &mut Builder, from: StateId, width: usize, offset: usize, label: &str) -> StateId {
    let mut cur = seek_slot(b, from, WORK, BITS, W_ACC, &format!("{label}.s")); // WORK -> `W_ACC`'s first digit
    for k in 0..offset {
        let nxt = b.state(format!("{label}.o{k}"));
        b.add_rule(cur, RuleSpec::new().on(HEAP, None, None, Move::R), nxt);
        cur = nxt;
    }
    for i in 0..width {
        let nxt = b.state(format!("{label}.c{i}"));
        for &h in BITS {
            for &w in BITS {
                b.add_rule(
                    cur,
                    RuleSpec::new().on(HEAP, Some(h), None, Move::R).on(WORK, Some(w), Some(h), Move::R),
                    nxt,
                );
            }
        }
        cur = nxt;
    }
    let back = b.state(format!("{label}.bk"));
    b.add_rule(cur, RuleSpec::new().on(WORK, Some(SEP), None, Move::L), back);
    rewind_home(b, back, WORK, BITS, W_ACC, &format!("{label}.r"))
}

/// From a HEAP position that is the boundary right after some cell — either the next cell's `@`, or
/// already the true top — advance past every remaining cell (content-blind `heap_cell_len`-cell skips)
/// until landing on the true top (a `BLANK`). A no-op if already there. WORK/REG untouched.
fn heap_skip_to_top_bin(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId {
    let check = b.state(format!("{label}.ck"));
    b.add_rule(from, RuleSpec::new(), check);
    let more = b.state(format!("{label}.mr"));
    let top = b.state(format!("{label}.tp"));
    b.add_rule(check, RuleSpec::new().on(HEAP, Some(AT), None, Move::S), more);
    b.add_rule(check, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::S), top);
    let skipped = skip_cells(b, more, HEAP, heap_cell_len(width), Move::R, &format!("{label}.sk"));
    b.add_rule(skipped, RuleSpec::new(), check);
    top
}

/// Shared machinery for `head_op`/`tail_op`: both dereference a runtime pointer identically, differing
/// only in which word of the target cell is read (`tail = false` for `head_op`, `true` for `tail_op`).
///
/// A `nil` pointer (`rl == 0`) or a dangling one (`heap_seek_cell_bin`'s `missing`) has no value and
/// SPINS to a fault state forever, matching λ's Ω-divergence and the reference's `Runtime` error — the
/// same shape `Unary::head_op`'s `{base}.fault` self-loop uses. Deliberately NOT `b.overflow()`:
/// overflow means "retry at a wider bank", and `run_tm_fitted` acts on it, so a nil/dangling deref
/// routed there would burn a full step budget at every width from 4 to 64 and still report the same
/// thing — that is exactly why the guard is a state id rather than a spin.
#[allow(clippy::too_many_arguments)] // a (b, entry, exit, rl, rd) quintet, plus width and the head/tail flag.
fn deref_op(b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot, width: usize, tail: bool) {
    let l = format!("b{}{entry}", if tail { "tl" } else { "hd" });
    let cw = copy_field(b, entry, width, REG, rl, WORK, W_ACC, &format!("{l}.p")); // WORK.W_ACC <- P
    let fault = b.state(format!("{l}.fault"));
    b.add_rule(fault, RuleSpec::new(), fault); // wildcard reads / no writes / all Stay -> spins forever
    let nil = b.state(format!("{l}.nil"));
    let seek = b.state(format!("{l}.sk"));
    branch_on_zero(b, cw, WORK, W_ACC, nil, seek, &format!("{l}.z"));
    b.add_rule(nil, RuleSpec::new(), fault); // P == 0 -> nil fault
    let found = b.state(format!("{l}.fd"));
    let missing = b.state(format!("{l}.ms"));
    heap_seek_cell_bin(b, seek, width, found, missing, &format!("{l}.hs"));
    b.add_rule(missing, RuleSpec::new(), fault); // dangling -> fault
    // At the target `@`: the head word starts 1 cell right of it; the tail word starts `width + 2`
    // cells right of it (past `@` + head digits + `#`).
    let offset = if tail { width + 2 } else { 1 };
    let read = heap_read_word_bin(b, found, width, offset, &format!("{l}.rd"));
    // Restore the HEAP head to the TRUE top. A head-word read stops on the `#` before the tail; cross
    // it and the tail's `width` digits first so both cases enter `heap_skip_to_top_bin` at the same
    // kind of position (the boundary right after the target cell).
    let mut cur = read;
    if !tail {
        for k in 0..=width {
            // the `#` (1) then the tail's `width` digits
            let nxt = b.state(format!("{l}.x{k}"));
            b.add_rule(cur, RuleSpec::new().on(HEAP, None, None, Move::R), nxt);
            cur = nxt;
        }
    }
    let at_top = heap_skip_to_top_bin(b, cur, width, &format!("{l}.tp"));
    let store = copy_field(b, at_top, width, WORK, W_ACC, REG, rd, &format!("{l}.st"));
    b.add_rule(store, RuleSpec::new(), exit);
}

// ---- BOX tape sub-primitives (free functions; each preserves the BOX "origin" resting invariant) ----
//
// The BOX holds `# <field1> # <field2> # … <fieldN>`, each `<fieldi>` EXACTLY `width` digit cells, with
// NO trailing `#` after the last field — the blank "top" follows its last digit directly. A 1-based
// pointer `p` addresses field `p`. The trait's doc contract is that the BOX head rests on the leading
// `#` (the ORIGIN) on entry AND exit of every `box_*` gadget — an empty box has origin == top, both at
// cell 0. This is `Unary`'s BOX convention (see `unary.rs`'s "rest at the ORIGIN" section), NOT `Binary`
// HEAP's "rest at the top" convention: every walk below therefore starts already AT the position it
// needs (the origin), so unlike the HEAP walkers there is no rewind-to-first-cell step. What changes
// from `Unary` is only that a field is FIXED width — `width` digits, always — rather than a
// blank-padded mark run, so crossing one is a COUNTED skip (`box_field_len(width)` cells) instead of a
// content scan, and reading/writing a field's value is a counted digit copy rather than a mark/blank
// walk.

/// Field size on the binary BOX, in cells: `#` + width digits.
fn box_field_len(width: usize) -> usize {
    width + 1
}

/// Count the BOX's fields into WORK's `W_ACC` and leave the head at the top. `from`: BOX at the ORIGIN
/// (the leading `#`, or cell 0 if empty), WORK home with `W_ACC` ALREADY ZERO. At each `#`, `inc_acc`,
/// then skip `box_field_len(width)` cells (content-blind) and repeat; a `BLANK` means the top has been
/// reached. On exit WORK is home holding the count and the BOX head is at the top.
fn box_count_fields_bin(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId {
    let at_hash = b.state(format!("{label}.ah"));
    let done = b.state(format!("{label}.dn"));
    b.add_rule(from, RuleSpec::new().on(BOX, Some(BLANK), None, Move::S), done); // empty box -> count 0
    b.add_rule(from, RuleSpec::new().on(BOX, Some(SEP), None, Move::S), at_hash);
    let after_inc = inc_acc(b, at_hash, &format!("{label}.in")); // WORK-only; BOX stays parked on `#`
    let boundary = skip_cells(b, after_inc, BOX, box_field_len(width), Move::R, &format!("{label}.sk"));
    b.add_rule(boundary, RuleSpec::new().on(BOX, Some(SEP), None, Move::S), at_hash); // another field
    b.add_rule(boundary, RuleSpec::new().on(BOX, Some(BLANK), None, Move::S), done); // reached the top
    done
}

/// Runtime-seek the `P`-th BOX field (1-based), a two-exit gadget mirroring `heap_seek_cell_bin`.
/// PRECONDITION: WORK's `W_ACC` holds the counter `P >= 1` at home (the caller has already routed
/// `P == 0` to its own fault, exactly as `deref_op` does before calling `heap_seek_cell_bin`); BOX head
/// at the ORIGIN; REG home. `found`: BOX head on the `P`-th field's leading `#`, WORK's `W_ACC` drained
/// to zero (home). `missing`: `P` exceeds the field count (or the box is empty) — the caller routes to
/// the fault spin, never to the overflow guard.
fn box_seek_field_bin(b: &mut Builder, from: StateId, width: usize, found: StateId, missing: StateId, label: &str) {
    let loop_head = b.state(format!("{label}.lp"));
    b.add_rule(from, RuleSpec::new().on(BOX, Some(BLANK), None, Move::S), missing); // empty box
    b.add_rule(from, RuleSpec::new().on(BOX, Some(SEP), None, Move::S), loop_head);
    let after_dec = dec_acc(b, loop_head, &format!("{label}.dc")); // WORK-only; BOX stays parked on `#`
    let zero = b.state(format!("{label}.z"));
    let nonzero = b.state(format!("{label}.n"));
    branch_on_zero(b, after_dec, WORK, W_ACC, zero, nonzero, &format!("{label}.bz"));
    b.add_rule(zero, RuleSpec::new(), found); // drained -> this `#`'s field is the target
    let boundary = skip_cells(b, nonzero, BOX, box_field_len(width), Move::R, &format!("{label}.sk"));
    b.add_rule(boundary, RuleSpec::new().on(BOX, Some(SEP), None, Move::S), loop_head); // next field
    b.add_rule(boundary, RuleSpec::new().on(BOX, Some(BLANK), None, Move::S), missing); // ran off the top
}

/// Copy the field under the BOX head into WORK's `W_ACC`, overwriting whatever it currently holds (the
/// seek's drained-to-zero counter), then walk the BOX head back to the field's first cell. `from`: BOX
/// on the field's leading `#` (as `box_seek_field_bin`'s `found` leaves it), WORK home. On exit WORK is
/// home holding the value and the BOX head is back on the field's first cell (NOT its leading `#` —
/// same convention `Unary::box_read_field_to_work` uses, so the caller can re-derive the `#` with a
/// single leftward step when it needs to).
fn box_read_field_bin(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId {
    let step_in = b.state(format!("{label}.in"));
    b.add_rule(from, RuleSpec::new().on(BOX, Some(SEP), None, Move::R), step_in); // `#` -> first digit
    let mut cur = seek_slot(b, step_in, WORK, BITS, W_ACC, &format!("{label}.s"));
    for i in 0..width {
        let nxt = b.state(format!("{label}.c{i}"));
        for &h in BITS {
            for &w in BITS {
                b.add_rule(
                    cur,
                    RuleSpec::new().on(BOX, Some(h), None, Move::R).on(WORK, Some(w), Some(h), Move::R),
                    nxt,
                );
            }
        }
        cur = nxt;
    }
    // BOX rests on the boundary right after the field; WORK rests on `W_ACC`'s trailing `#`.
    let back = b.state(format!("{label}.bk"));
    b.add_rule(cur, RuleSpec::new().on(WORK, Some(SEP), None, Move::L), back);
    let homed = rewind_home(b, back, WORK, BITS, W_ACC, &format!("{label}.r")); // WORK home; BOX untouched
    skip_cells(b, homed, BOX, width, Move::L, &format!("{label}.rw")) // BOX back onto the field's first cell
}

/// Overwrite the field under the BOX head with WORK's `W_ACC`, digit for digit, IN PLACE — the `#`
/// delimiters never move — then walk the BOX head back to the field's first cell. `from`: BOX on the
/// field's leading `#`, WORK home over the new value. A COUNTED chain, not content-driven: the same
/// reason `Unary::box_overwrite_field` is counted — the LAST field has no trailing `#`, so a
/// content-driven overrun would have no delimiter to stop at. On exit: BOX head back on the field's
/// first cell; WORK home with `W_ACC` unchanged. Every BOX read here is an explicit digit, never a
/// wildcard, so no rule here can write over a `#`.
fn box_overwrite_field_bin(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId {
    let step_in = b.state(format!("{label}.in"));
    b.add_rule(from, RuleSpec::new().on(BOX, Some(SEP), None, Move::R), step_in);
    let mut cur = seek_slot(b, step_in, WORK, BITS, W_ACC, &format!("{label}.s"));
    for i in 0..width {
        let nxt = b.state(format!("{label}.c{i}"));
        for &w in BITS {
            for &old in BITS {
                b.add_rule(
                    cur,
                    RuleSpec::new().on(WORK, Some(w), None, Move::R).on(BOX, Some(old), Some(w), Move::R),
                    nxt,
                );
            }
        }
        cur = nxt;
    }
    let back = b.state(format!("{label}.bk"));
    b.add_rule(cur, RuleSpec::new().on(WORK, Some(SEP), None, Move::L), back);
    let homed = rewind_home(b, back, WORK, BITS, W_ACC, &format!("{label}.r"));
    skip_cells(b, homed, BOX, width, Move::L, &format!("{label}.rw")) // BOX back onto the field's first cell
}

/// Append `W_ACC`'s digits as a new `width`-cell field, preceded by `#`, at the BOX top — the BOX
/// analogue of `heap_open_cell_bin` without the `@` marker or a following tail word. `from`: WORK home
/// over `W_ACC`, BOX head at the top (a fresh `BLANK`). On exit: BOX head at the new top (the fresh
/// `BLANK` right after the field), WORK home with `W_ACC` unchanged. Every BOX-writing rule reads an
/// explicit `BLANK` — the write always lands on virgin tape, never a delimiter.
fn box_append_field_bin(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId {
    let at_w = seek_slot(b, from, WORK, BITS, W_ACC, &format!("{label}.s"));
    let cp = b.state(format!("{label}.hd"));
    b.add_rule(at_w, RuleSpec::new().on(BOX, Some(BLANK), Some(SEP), Move::R), cp);
    let mut cur = cp;
    for i in 0..width {
        let nxt = b.state(format!("{label}.c{i}"));
        for &d in BITS {
            b.add_rule(
                cur,
                RuleSpec::new().on(WORK, Some(d), None, Move::R).on(BOX, Some(BLANK), Some(d), Move::R),
                nxt,
            );
        }
        cur = nxt;
    }
    // WORK rests on `W_ACC`'s trailing `#`; BOX rests on the new top. Step WORK back inside to rewind.
    let back = b.state(format!("{label}.bk"));
    b.add_rule(cur, RuleSpec::new().on(WORK, Some(SEP), None, Move::L), back);
    rewind_home(b, back, WORK, BITS, W_ACC, &format!("{label}.r"))
}

/// Return the BOX head from a field's leading `#` to the origin, CONSUMING the counter in WORK's
/// `W_ACC`. `from`: BOX on a `#` (field `p`'s leading `#`), WORK home over the counter `= p`. Decrements
/// the counter and, while it stays positive, skips one field left per decrement (content-blind
/// `box_field_len(width)`-cell skips) — so exactly `p - 1` leftward field-skips land the head on the
/// leading `#` (the origin). Counter-bounded, so it never has to detect the origin-left blank. On exit
/// the BOX head is on the leading `#` (the origin) and WORK's `W_ACC` is drained to zero (home). Mirrors
/// `Unary::box_return_to_origin`.
fn box_return_to_origin_bin(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId {
    let dec = dec_acc(b, from, &format!("{label}.dc")); // WORK-only; BOX stays parked on `#`
    let done = b.state(format!("{label}.dn"));
    let more = b.state(format!("{label}.mr"));
    branch_on_zero(b, dec, WORK, W_ACC, done, more, &format!("{label}.bz"));
    let prev = skip_cells(b, more, BOX, box_field_len(width), Move::L, &format!("{label}.s"));
    b.add_rule(prev, RuleSpec::new(), from); // back-edge: loop with the BOX head on the previous `#`
    done
}

#[allow(clippy::too_many_arguments)] // `arith`/`compare` mirror the trait's three-address signature.
impl Encoding for Binary {
    fn field_width(&self) -> Option<usize> {
        Some(self.width)
    }

    fn at_width(&self, width: usize) -> Box<dyn Encoding> {
        Box::new(Binary::at(width))
    }

    fn field_symbols(&self) -> &'static [Symbol] {
        BITS
    }

    fn init_reg(&self, slots: u32) -> Vec<Symbol> {
        self.zero_bank(slots)
    }

    fn init_work(&self) -> Vec<Symbol> {
        self.zero_bank(N_WORK_FIELDS)
    }

    fn decode_nat(&self, reg_cells: &[Symbol], slot: Slot) -> Option<u64> {
        // Fixed-width bank `# f0 # f1 … #`; field `slot` is the `width` cells after the `slot`-th `#`
        // (leading `#` = #0) and must be closed by another `#`, so a `slot` past the last field is
        // `None`. Digits are LSB-first. A non-digit cell means the field is corrupt -> `None`, which
        // is what makes a decode of a clobbered bank fail loudly instead of returning a plausible
        // number.
        let mut seps = 0u32;
        for (i, &c) in reg_cells.iter().enumerate() {
            if c == SEP {
                if seps == slot {
                    let rest = reg_cells.get(i + 1..)?;
                    if rest.len() < self.width || rest.get(self.width) != Some(&SEP) {
                        return None;
                    }
                    let mut acc = 0u64;
                    for (k, &d) in rest[..self.width].iter().enumerate() {
                        match d {
                            ZERO => {}
                            MARK if k < 64 => acc |= 1u64 << k,
                            // A set bit at 2^64 or above cannot be a `u64`. Unreachable while
                            // MAX_FIELD_WIDTH is 64; total rather than panicking if that changes.
                            MARK => return None,
                            _ => return None,
                        }
                    }
                    return Some(acc);
                }
                seps += 1;
            }
        }
        None
    }

    fn write_literal(&self, b: &mut Builder, entry: StateId, exit: StateId, n: u64, rd: Slot) {
        // OVERFLOW GUARD, STATIC: `n` is a compile-time constant, so an unrepresentable literal needs
        // no runtime check — route the instruction straight to the guard and emit no write chain.
        if !self.fits(n) {
            let overflow = b.overflow();
            b.add_rule(entry, RuleSpec::new(), overflow);
            return;
        }
        let base = format!("bwl{rd}s{entry}"); // `entry` uniquifies across call sites
        let at = seek_slot(b, entry, REG, BITS, rd, &format!("{base}.s"));
        let mut cur = at;
        for i in 0..self.width {
            let nxt = b.state(format!("{base}.b{i}"));
            let d = Self::bit(n, i);
            // BOTH digit reads are enumerated rather than using a wildcard. The field holds an
            // arbitrary prior value so both are reachable, and a non-`#` write under a wildcard read
            // is exactly what `tests/common/mod.rs::unsafe_rules` rejects.
            for &old in BITS {
                b.add_rule(cur, RuleSpec::new().on(REG, Some(old), Some(d), Move::R), nxt);
            }
            cur = nxt;
        }
        // The counted chain ends ON the field's trailing `#`. Step back inside so `rewind_home`'s
        // precondition (head within the field, never on its trailing `#`) holds.
        let back = b.state(format!("{base}.bk"));
        b.add_rule(cur, RuleSpec::new().on(REG, Some(SEP), None, Move::L), back);
        let home = rewind_home(b, back, REG, BITS, rd, &format!("{base}.r"));
        b.add_rule(home, RuleSpec::new(), exit);
    }

    fn jz(&self, b: &mut Builder, entry: StateId, if_zero: StateId, if_nonzero: StateId, r: Slot) {
        branch_on_zero(b, entry, REG, r, if_zero, if_nonzero, &format!("bjz{r}s{entry}"));
    }

    fn mov(&self, b: &mut Builder, entry: StateId, exit: StateId, rs: Slot, rd: Slot) {
        // REG has one head, so a field-to-field copy must bounce through WORK. `rs == rd` round-trips
        // the same value and is therefore the identity, which the trait's contract requires.
        let l = format!("bmv{rd}s{entry}");
        let up = copy_field(b, entry, self.width, REG, rs, WORK, W_ACC, &format!("{l}.u"));
        let down = copy_field(b, up, self.width, WORK, W_ACC, REG, rd, &format!("{l}.d"));
        b.add_rule(down, RuleSpec::new(), exit);
    }

    fn arith(&self, b: &mut Builder, entry: StateId, exit: StateId, op: BinOp, ra: Slot, rb: Slot, rd: Slot) {
        match op {
            BinOp::Add => {
                let l = format!("badd{entry}");
                let load = copy_field(b, entry, self.width, REG, ra, WORK, W_ACC, &format!("{l}.ld"));
                let sum = ripple_add(b, load, rb, &format!("{l}.rp"));
                let store = copy_field(b, sum, self.width, WORK, W_ACC, REG, rd, &format!("{l}.st"));
                b.add_rule(store, RuleSpec::new(), exit);
            }
            BinOp::Sub => {
                let l = format!("bsub{entry}");
                let load = copy_field(b, entry, self.width, REG, ra, WORK, W_ACC, &format!("{l}.ld"));
                let dif = ripple_sub(b, load, rb, &format!("{l}.rp"));
                let store = copy_field(b, dif, self.width, WORK, W_ACC, REG, rd, &format!("{l}.st"));
                b.add_rule(store, RuleSpec::new(), exit);
            }
            BinOp::Mul => {
                // acc = 0; for i in (0..w).rev() { acc <<= 1; if bit_i(rb) { acc += ra } }
                //
                // MSB-first, shifting the ACCUMULATOR rather than the multiplicand. That keeps `ra` a
                // read-only REG field (so `ripple_add` applies unchanged) and removes both the
                // multiplier register and the loop counter — which is why WORK needs one scratch
                // field rather than three.
                //
                // The `w` iterations are UNROLLED at build time, and each one calls both
                // `shift_left_acc` (itself O(width) states, not O(1) — see its doc) and `bit_is_one`
                // (O(i) states for digit `i`, so O(width) summed over one full unrolled loop). So `Mul`
                // as a whole is O(width²) states, NOT O(width).
                //
                // CORRECTION: an earlier version of this comment claimed O(width) states and "several
                // hundred" at width 64. Both the exponent and the magnitude were wrong. Counting every
                // `b.state()` call across `zero_field`/`shift_left_acc`/`bit_is_one`/`ripple_add`/
                // `copy_field`, for this test harness's `ra=0, rb=1, rd=2` slot layout, gives the
                // measured closed form `1.5*w^2 + 26.5*w + 13` (a fit for this specific three-slot
                // shape, not a universal constant): 143 states at width 4, 821 at width 16, and 7,853
                // at width 64 for a single `Mul` instruction — thousands, not "several hundred". A
                // known trade regardless.
                let l = format!("bmul{entry}");
                let mut cur = zero_field(b, entry, self.width, WORK, W_ACC, &format!("{l}.z"));
                for i in (0..self.width).rev() {
                    let shifted = shift_left_acc(b, cur, self.width, &format!("{l}.s{i}"));
                    let add = b.state(format!("{l}.a{i}"));
                    let skip = b.state(format!("{l}.k{i}"));
                    bit_is_one(b, shifted, REG, rb, i, add, skip, &format!("{l}.b{i}"));
                    let after = ripple_add(b, add, ra, &format!("{l}.p{i}"));
                    let join = b.state(format!("{l}.j{i}"));
                    b.add_rule(after, RuleSpec::new(), join);
                    b.add_rule(skip, RuleSpec::new(), join);
                    cur = join;
                }
                let store = copy_field(b, cur, self.width, WORK, W_ACC, REG, rd, &format!("{l}.st"));
                b.add_rule(store, RuleSpec::new(), exit);
            }
            BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                unreachable!("comparison `{op:?}` dispatches to `compare`, not `arith`")
            }
        }
    }

    fn compare(&self, b: &mut Builder, entry: StateId, exit: StateId, op: BinOp, ra: Slot, rb: Slot, rd: Slot) {
        // The primitive is `le(x, y) = is_zero(monus(x, y))`, and every op derives from it — the same
        // decomposition `Unary::compare` uses, which is why supplying binary `monus` (ripple_sub) and
        // binary `is_zero` (branch_on_zero) is all this needs.
        let l = format!("bcmp{entry}");
        // `(x, y, one_when_zero)`: compute `monus(x, y)`, then write 1 on the stated branch.
        let (x, y, one_when_zero) = match op {
            BinOp::Le => (ra, rb, true),
            BinOp::Gt => (ra, rb, false),
            BinOp::Ge => (rb, ra, true),
            BinOp::Lt => (rb, ra, false),
            BinOp::Eq | BinOp::Ne => {
                // eq = is_zero(|ra - rb|) = is_zero(monus(ra, rb) + monus(rb, ra)).
                //
                // That sum CANNOT overflow: one of the two terms is always zero (if ra >= rb then
                // monus(rb, ra) = 0, and vice versa), so it equals |ra - rb| <= max(ra, rb) < 2^w.
                // `ripple_add`'s guard is therefore unreachable on this path — if it is ever reached,
                // that is a defect in this argument, not an overflowing program.
                let m1 = copy_field(b, entry, self.width, REG, ra, WORK, W_ACC, &format!("{l}.l1"));
                let d1 = ripple_sub(b, m1, rb, &format!("{l}.s1"));
                // Park `monus(ra, rb)` in `rd`. Sound because a comparison's destination is a fresh
                // temporary distinct from both operands (the trait's precondition), so the park cannot
                // clobber an operand the second monus re-reads. `Unary::eq_to_work` parks identically.
                let park = copy_field(b, d1, self.width, WORK, W_ACC, REG, rd, &format!("{l}.pk"));
                let m2 = copy_field(b, park, self.width, REG, rb, WORK, W_ACC, &format!("{l}.l2"));
                let d2 = ripple_sub(b, m2, ra, &format!("{l}.s2"));
                let sum = ripple_add(b, d2, rd, &format!("{l}.ad"));
                let zero = b.state(format!("{l}.z"));
                let nonzero = b.state(format!("{l}.n"));
                branch_on_zero(b, sum, WORK, W_ACC, zero, nonzero, &format!("{l}.br"));
                let (t, f) = if matches!(op, BinOp::Eq) { (zero, nonzero) } else { (nonzero, zero) };
                self.write_literal(b, t, exit, 1, rd);
                self.write_literal(b, f, exit, 0, rd);
                return;
            }
            BinOp::Add | BinOp::Sub | BinOp::Mul => {
                unreachable!("arithmetic `{op:?}` dispatches to `arith`, not `compare`")
            }
        };
        let load = copy_field(b, entry, self.width, REG, x, WORK, W_ACC, &format!("{l}.ld"));
        let dif = ripple_sub(b, load, y, &format!("{l}.mo"));
        let zero = b.state(format!("{l}.z"));
        let nonzero = b.state(format!("{l}.n"));
        branch_on_zero(b, dif, WORK, W_ACC, zero, nonzero, &format!("{l}.br"));
        let (t, f) = if one_when_zero { (zero, nonzero) } else { (nonzero, zero) };
        self.write_literal(b, t, exit, 1, rd);
        self.write_literal(b, f, exit, 0, rd);
    }

    fn push_frame(&self, b: &mut Builder, entry: StateId, exit: StateId, n_loc: u32, tag: u64) {
        let l = format!("bpf{entry}");
        let mut cur = stack_push_literal(b, entry, tag, self.width, &format!("{l}.tg"));
        for k in 0..n_loc {
            let slot = k + 1; // `Loc` fields are slots 1..=n_loc
            let loaded = copy_field(b, cur, self.width, REG, slot, WORK, W_ACC, &format!("{l}.l{k}"));
            cur = stack_push_acc(b, loaded, self.width, &format!("{l}.p{k}"));
        }
        b.add_rule(cur, RuleSpec::new(), exit);
    }

    fn pop_frame_restore(&self, b: &mut Builder, entry: StateId, exit: StateId, n_loc: u32) {
        // `push_frame` saved Loc0..Loc_{n_loc-1} above the tag, so popping top-down yields them in
        // reverse. `n_loc = 0` is a no-op leaving the tag on top.
        let l = format!("bpr{entry}");
        let mut cur = entry;
        for k in (0..n_loc).rev() {
            let popped = stack_pop_acc(b, cur, self.width, &format!("{l}.p{k}"));
            cur = copy_field(b, popped, self.width, WORK, W_ACC, REG, k + 1, &format!("{l}.s{k}"));
        }
        b.add_rule(cur, RuleSpec::new(), exit);
    }

    fn dispatch_tag(&self, b: &mut Builder, entry: StateId, exits: &[StateId]) {
        // An empty `exits` leaves `entry` rule-less, so the machine simply halts there — the trait's
        // stated contract, and what makes this total.
        let Some((&last, rest)) = exits.split_last() else { return };
        let l = format!("bdt{entry}");
        let popped = stack_pop_acc(b, entry, self.width, &format!("{l}.pop"));
        // A LINEAR chain of equality tests, not a decision trie: a depth-`width` trie has 2^width
        // leaves (2^64 at the ceiling), while this is O(exits.len() * width) states.
        let mut cur = popped;
        for (i, &e) in rest.iter().enumerate() {
            let next = b.state(format!("{l}.n{i}"));
            branch_on_equals(b, cur, WORK, W_ACC, i as u64, self.width, e, next, &format!("{l}.q{i}"));
            cur = next;
        }
        // The last exit is also the DEFENSIVE CLAMP: a tag beyond the range (impossible for a
        // well-formed program) lands here rather than over-indexing. Matches `Unary::dispatch_tag`.
        b.add_rule(cur, RuleSpec::new(), last);
    }

    fn cons(&self, b: &mut Builder, entry: StateId, exit: StateId, rh: Slot, rt: Slot, rd: Slot) {
        let l = format!("bcons{entry}");
        // 1. WORK <- rh; open the cell: `@` + head digits + `#` at the HEAP top.
        let load_h = copy_field(b, entry, self.width, REG, rh, WORK, W_ACC, &format!("{l}.lh"));
        let opened = heap_open_cell_bin(b, load_h, self.width, &format!("{l}.oc"));
        // 2. WORK <- rt; append the tail digits at the HEAP top (no closing delimiter).
        let load_t = copy_field(b, opened, self.width, REG, rt, WORK, W_ACC, &format!("{l}.lt"));
        let appended = heap_append_bin(b, load_t, self.width, &format!("{l}.at"));
        // 3. Reset the scratch: it is about to become a fresh counter, not the tail value.
        let cleared = zero_field(b, appended, self.width, WORK, W_ACC, &format!("{l}.z"));
        // 4. Count every cell (the new one included) from the origin to the top.
        let counted = heap_count_cells_bin(b, cleared, self.width, &format!("{l}.cc"));
        // 5. rd <- the count = the new cell's 1-based pointer.
        let stored = copy_field(b, counted, self.width, WORK, W_ACC, REG, rd, &format!("{l}.st"));
        b.add_rule(stored, RuleSpec::new(), exit);
    }

    fn is_empty_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot) {
        // Safe when `rl == rd`: `branch_on_zero` only reads `rl` (rewinding home on both exits) and
        // never touches `rd`, so both branches' `write_literal` calls are the first write to `rd`.
        let l = format!("bie{entry}");
        let zero = b.state(format!("{l}.z"));
        let nonzero = b.state(format!("{l}.n"));
        branch_on_zero(b, entry, REG, rl, zero, nonzero, &format!("{l}.br"));
        self.write_literal(b, zero, exit, 1, rd);
        self.write_literal(b, nonzero, exit, 0, rd);
    }

    fn head_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot) {
        deref_op(b, entry, exit, rl, rd, self.width, false);
    }

    fn tail_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot) {
        deref_op(b, entry, exit, rl, rd, self.width, true);
    }

    fn box_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rv: Slot, rd: Slot) {
        let l = format!("bbox{entry}");
        // 1. Count the existing fields (BOX at the origin on entry, per the trait contract); BOX ends
        // at the top. WORK must start zeroed for `box_count_fields_bin`'s precondition.
        let cleared = zero_field(b, entry, self.width, WORK, W_ACC, &format!("{l}.z0"));
        let counted = box_count_fields_bin(b, cleared, self.width, &format!("{l}.ct")); // WORK = N; BOX at top
        // 2. The new pointer is N + 1; store it in `rd` (only touches WORK/REG — BOX stays at the top).
        let ptr = inc_acc(b, counted, &format!("{l}.in")); // WORK = N + 1
        let stored_ptr = copy_field(b, ptr, self.width, WORK, W_ACC, REG, rd, &format!("{l}.wp")); // rd = N+1
        // 3. Load `rv`'s value and append the new field at the top.
        let loaded_v = copy_field(b, stored_ptr, self.width, REG, rv, WORK, W_ACC, &format!("{l}.cv"));
        let appended = box_append_field_bin(b, loaded_v, self.width, &format!("{l}.ap")); // BOX at NEW top
        // 4. Reload the pointer (durably held in `rd`, since WORK now holds `rv`'s value instead) as the
        // return counter, step onto the new field's leading `#`, and walk back to the origin.
        let reloaded = copy_field(b, appended, self.width, REG, rd, WORK, W_ACC, &format!("{l}.cc")); // WORK = N+1
        let on_hash = skip_cells(b, reloaded, BOX, box_field_len(self.width), Move::L, &format!("{l}.oh"));
        let origin = box_return_to_origin_bin(b, on_hash, self.width, &format!("{l}.ro"));
        b.add_rule(origin, RuleSpec::new(), exit);
    }

    fn box_get_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rb: Slot, rd: Slot) {
        let l = format!("bbg{entry}");
        let cw = copy_field(b, entry, self.width, REG, rb, WORK, W_ACC, &format!("{l}.p")); // WORK = p
        let fault = b.state(format!("{l}.fault"));
        // A nil/dangling deref has no value: spin here so the machine hits the step cap (HitCap),
        // matching λ's Ω-divergence and the reference's Runtime error — see `deref_op`'s doc for why
        // this is deliberately NOT `b.overflow()`.
        b.add_rule(fault, RuleSpec::new(), fault);
        let nil = b.state(format!("{l}.nil"));
        let seek = b.state(format!("{l}.sk"));
        branch_on_zero(b, cw, WORK, W_ACC, nil, seek, &format!("{l}.z"));
        b.add_rule(nil, RuleSpec::new(), fault); // p == 0 -> nil fault
        let found = b.state(format!("{l}.fd"));
        let missing = b.state(format!("{l}.ms"));
        box_seek_field_bin(b, seek, self.width, found, missing, &format!("{l}.sf"));
        b.add_rule(missing, RuleSpec::new(), fault); // dangling -> fault
        let read = box_read_field_bin(b, found, self.width, &format!("{l}.rd")); // WORK = value
        let wrote = copy_field(b, read, self.width, WORK, W_ACC, REG, rd, &format!("{l}.st")); // rd = value
        // Reload `rb` (REG never changed it) to re-derive the return counter, step onto the field's
        // leading `#`, and walk back to the origin.
        let cnt = copy_field(b, wrote, self.width, REG, rb, WORK, W_ACC, &format!("{l}.cc")); // WORK = p
        let on_hash = skip_cells(b, cnt, BOX, 1, Move::L, &format!("{l}.oh")); // first cell -> field's `#`
        let origin = box_return_to_origin_bin(b, on_hash, self.width, &format!("{l}.ro"));
        b.add_rule(origin, RuleSpec::new(), exit);
    }

    fn box_set_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rb: Slot, rv: Slot) {
        let l = format!("bbs{entry}");
        let cw = copy_field(b, entry, self.width, REG, rb, WORK, W_ACC, &format!("{l}.p")); // WORK = p
        let fault = b.state(format!("{l}.fault"));
        b.add_rule(fault, RuleSpec::new(), fault); // nil/dangling -> spin -> HitCap (as box_get_op)
        let nil = b.state(format!("{l}.nil"));
        let seek = b.state(format!("{l}.sk"));
        branch_on_zero(b, cw, WORK, W_ACC, nil, seek, &format!("{l}.z"));
        b.add_rule(nil, RuleSpec::new(), fault);
        let found = b.state(format!("{l}.fd"));
        let missing = b.state(format!("{l}.ms"));
        box_seek_field_bin(b, seek, self.width, found, missing, &format!("{l}.sf"));
        b.add_rule(missing, RuleSpec::new(), fault);
        // Load `rv`'s NEW value and overwrite the field in place.
        let load = copy_field(b, found, self.width, REG, rv, WORK, W_ACC, &format!("{l}.lv"));
        let over = box_overwrite_field_bin(b, load, self.width, &format!("{l}.ov"));
        // Reload `rb` to re-derive the return counter, step onto the field's leading `#`, and walk back
        // to the origin.
        let cnt = copy_field(b, over, self.width, REG, rb, WORK, W_ACC, &format!("{l}.cc")); // WORK = p
        let on_hash = skip_cells(b, cnt, BOX, 1, Move::L, &format!("{l}.oh"));
        let origin = box_return_to_origin_bin(b, on_hash, self.width, &format!("{l}.ro"));
        b.add_rule(origin, RuleSpec::new(), exit);
    }

    fn parse_heap_cells(&self, cells: &[Symbol]) -> Vec<(u64, u64)> {
        // `@ <width digits> # <width digits>`, laid left to right from the first `@`. Scanning FOR the
        // marker (not indexing from cell 0) is what the trait requires: `Tape::snapshot`'s cell 0 is not
        // necessarily the origin. Total: a truncated or malformed tape yields the cells parsed so far.
        let mut out = Vec::new();
        let mut i = cells.iter().position(|&c| c == AT).unwrap_or(cells.len());
        let word = |s: &[Symbol]| -> Option<u64> {
            let mut acc = 0u64;
            for (k, &d) in s.iter().enumerate() {
                match d {
                    ZERO => {}
                    MARK if k < 64 => acc |= 1u64 << k,
                    _ => return None,
                }
            }
            Some(acc)
        };
        while cells.get(i) == Some(&AT) {
            let h0 = i + 1;
            let sep = h0 + self.width;
            let t0 = sep + 1;
            let end = t0 + self.width;
            if cells.get(sep) != Some(&SEP) || end > cells.len() {
                break;
            }
            match (word(&cells[h0..sep]), word(&cells[t0..end])) {
                (Some(h), Some(t)) => out.push((h, t)),
                _ => break,
            }
            i = end;
        }
        out
    }
}

/// Branch on whether field `slot` of `tape` is entirely zero. Seeks the field, scans it for a `MARK`,
/// and rewinds home on BOTH exits, so the two branches are interchangeable with any other gadget's.
///
/// Scanning the WHOLE field is the point: value 2 at width 4 is `0100`, whose FIRST digit is zero. A
/// unary `jz` can legitimately look at the first cell only; a binary one that did would call every
/// even number zero.
pub(crate) fn branch_on_zero(
    b: &mut Builder,
    entry: StateId,
    tape: usize,
    slot: Slot,
    if_zero: StateId,
    if_nonzero: StateId,
    label: &str,
) {
    let at = seek_slot(b, entry, tape, BITS, slot, &format!("{label}.s"));
    let nz = b.state(format!("{label}.nz"));
    b.add_rule(at, RuleSpec::new().on(tape, Some(MARK), None, Move::S), nz); // a set bit -> nonzero
    b.add_rule(at, RuleSpec::new().on(tape, Some(ZERO), None, Move::R), at); // keep scanning
    let z = b.state(format!("{label}.z"));
    // Ran off the field's end without meeting a `MARK`: the value is zero. Step back INSIDE the field
    // so `rewind_home`'s precondition holds on this exit too.
    b.add_rule(at, RuleSpec::new().on(tape, Some(SEP), None, Move::L), z);
    let home_nz = rewind_home(b, nz, tape, BITS, slot, &format!("{label}.rn"));
    b.add_rule(home_nz, RuleSpec::new(), if_nonzero);
    let home_z = rewind_home(b, z, tape, BITS, slot, &format!("{label}.rz"));
    b.add_rule(home_z, RuleSpec::new(), if_zero);
}
