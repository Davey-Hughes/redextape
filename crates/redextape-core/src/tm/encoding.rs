//! The `Encoding` seam: unary δ-gadgets over the `reg`/`work` tapes. A `Nat v` is `v` `MARK`s in a
//! `#`-delimited register field. Gadgets decompose into sub-primitives (seek/clear/copy/append) that
//! each preserve the home convention (REG head on the leading `#`, WORK head at its leftmost (value)
//! cell — blank only when WORK is empty), so they compose freely. Behavior is verified by SIMULATION
//! (build a tiny machine → run → decode).

use crate::core::BinOp;
use crate::tm::build::{Builder, MARK, REG, RuleSpec, SEP, Slot, WORK};
use crate::tm::machine::{BLANK, Move, StateId, Symbol};

/// The pluggable numeric encoding (the swappable seam). `Unary` is the v1 implementation; a `Binary`
/// impl is the committed follow-on. Gadgets build states into `b`, flowing `entry -> exit`, under the
/// home convention (REG head on the leading `#`; WORK head at its leftmost (value) cell — blank only
/// when WORK is empty) on entry and exit.
// `arith`/`compare` carry (b, entry, exit, op, ra, rb, rd) — the register-machine three-address shape;
// the operands are intrinsic to the interface, so allow the arg count on the whole seam.
#[allow(clippy::too_many_arguments)]
pub trait Encoding {
    /// `slot rd <- n` (clear the field, write `n` marks).
    fn write_literal(&self, b: &mut Builder, entry: StateId, exit: StateId, n: u64, rd: Slot);
    /// `slot rd <- (ra `op` rb)` for an arithmetic `BinOp` (Add/Sub/Mul); comparisons go to `compare`.
    /// PRECONDITION: `rd` must be a fresh temporary, distinct from `ra` and `rb` (`Mul` uses `rd` as a
    /// scratch/loop-counter register while `ra`/`rb` are still being read).
    fn arith(&self, b: &mut Builder, entry: StateId, exit: StateId, op: BinOp, ra: Slot, rb: Slot, rd: Slot);
    /// `slot rd <- (ra `op` rb) as 0/1` for a comparison `BinOp` (Eq/Ne/Lt/Le/Gt/Ge).
    /// PRECONDITION: `rd` must be a fresh temporary, distinct from `ra` and `rb` (`Eq`/`Ne` park an
    /// intermediate boolean in `rd` while `ra`/`rb` are still being read).
    fn compare(&self, b: &mut Builder, entry: StateId, exit: StateId, op: BinOp, ra: Slot, rb: Slot, rd: Slot);
    /// Decode field `slot` of a materialized `reg` tape to its unary value (`None` if the field is absent).
    fn decode_nat(&self, reg_cells: &[Symbol], slot: Slot) -> Option<u64>;
}

pub struct Unary;

// ---- shared sub-primitives (free functions; each preserves the home convention) ----

/// Seek the REG head from home to field `slot`'s first cell. Constant-size chain: step off the leading
/// `#`, then for each further slot scan its field (marks AND blank padding) to the next `#` and step
/// off. Ends AT `slot`'s first cell, NOT at home — internal to a gadget, which must return home before
/// `exit`. `from` reads the leading `#`; it must have no conflicting rules. Returns a rule-less state.
fn seek_slot(b: &mut Builder, from: StateId, slot: Slot, label: &str) -> StateId {
    // `from` reads the leading `#` and steps right onto field 0.
    let mut cur = b.state(format!("{label}.sk0"));
    b.add_rule(from, RuleSpec::new().on(REG, Some(SEP), None, Move::R), cur);
    for k in 1..=slot {
        let next = b.state(format!("{label}.sk{k}"));
        // scan field k-1's cells (marks AND blank padding) to its trailing `#`, then step onto field k.
        b.add_rule(cur, RuleSpec::new().on(REG, Some(MARK), None, Move::R), cur);
        b.add_rule(cur, RuleSpec::new().on(REG, Some(BLANK), None, Move::R), cur);
        b.add_rule(cur, RuleSpec::new().on(REG, Some(SEP), None, Move::R), next);
        cur = next;
    }
    cur // rule-less control state sitting on `slot`'s first cell
}

/// From a state whose REG head sits in field `slot` (on a mark or blank), move the head back to home
/// (the leading `#`). Counts `#`s: walk left over field content, stop only AT a `#`; the leading `#` is
/// the `(slot+1)`-th one, so we cross `slot` inner delimiters then rest on the leftmost. Content-blind
/// to blank padding (only `#`s halt the walk), so a padded field cannot masquerade as the left end.
/// PRECONDITION: the entry head must sit INSIDE field `slot` — on a mark or an interior padding blank —
/// and never on the field's trailing `#`; this holds for every value `< FIELD_WIDTH` (see the
/// `FIELD_WIDTH` doc), which is exactly why that bound is strict. `from` must have no conflicting rules;
/// returns the state now at home (head on the leading `#`).
fn rewind_home(b: &mut Builder, from: StateId, slot: Slot, label: &str) -> StateId {
    // `from` is `scan_slot`. For k = slot..1 cross one `#` per field boundary into the field to the
    // left; `scan_0` then rests on the leading `#`.
    let mut cur = from;
    for k in (1..=slot).rev() {
        b.add_rule(cur, RuleSpec::new().on(REG, Some(MARK), None, Move::L), cur);
        b.add_rule(cur, RuleSpec::new().on(REG, Some(BLANK), None, Move::L), cur);
        let next = b.state(format!("{label}.rw{}", k - 1));
        b.add_rule(cur, RuleSpec::new().on(REG, Some(SEP), None, Move::L), next); // cross `#` k -> field k-1
        cur = next;
    }
    let home = b.state(format!("{label}.home"));
    b.add_rule(cur, RuleSpec::new().on(REG, Some(MARK), None, Move::L), cur);
    b.add_rule(cur, RuleSpec::new().on(REG, Some(BLANK), None, Move::L), cur);
    b.add_rule(cur, RuleSpec::new().on(REG, Some(SEP), None, Move::S), home); // leading `#` -> rest here
    home
}

/// With WORK holding contiguous `MARK`s from home (marks left INTACT) and the head resting just past
/// them (on the trailing blank, or at home if empty), rewind the WORK head to home (its leftmost cell).
/// Steps left once, walks left over the marks, then steps back right off the left-end blank. `from`
/// must have no conflicting rules; returns the state with the WORK head at home.
fn rewind_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let scan = b.state(format!("{label}.wk"));
    b.add_rule(from, RuleSpec::new().on(WORK, None, None, Move::L), scan); // one unconditional step left
    b.add_rule(scan, RuleSpec::new().on(WORK, Some(MARK), None, Move::L), scan);
    let home = b.state(format!("{label}.wkh"));
    b.add_rule(scan, RuleSpec::new().on(WORK, Some(BLANK), None, Move::R), home); // off the left end -> home
    home
}

/// WORK head at home over contiguous `MARK`s (possibly empty): erase every mark and leave the head at
/// home. Walks right to the marks' end, then erases right-to-left back to the left-end blank (so the
/// left end is found by content even after erasure). `from` must have no conflicting rules; returns the
/// state with WORK empty and the head at home. REG is untouched.
pub fn clear_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    // `from` is `fwd`: walk right over marks to the first blank past them.
    b.add_rule(from, RuleSpec::new().on(WORK, Some(MARK), None, Move::R), from);
    let back = b.state(format!("{label}.cwb"));
    b.add_rule(from, RuleSpec::new().on(WORK, Some(BLANK), None, Move::L), back); // step onto the last mark
    b.add_rule(back, RuleSpec::new().on(WORK, Some(MARK), Some(BLANK), Move::L), back); // erase, walk left
    let home = b.state(format!("{label}.cwh"));
    b.add_rule(back, RuleSpec::new().on(WORK, Some(BLANK), None, Move::R), home); // off the left end -> home
    home
}

/// Copy field `slot`'s marks onto WORK scratch. `from`: REG at home (leading `#`), WORK at home.
/// Clears WORK, seeks field `slot`, copies each mark (REG read, WORK write) rightward, then rewinds
/// both heads home. On exit WORK holds `slot`'s value as contiguous marks and both heads are home.
pub fn copy_field_to_work(b: &mut Builder, from: StateId, slot: Slot, label: &str) -> StateId {
    let after_clear = clear_work(b, from, &format!("{label}.c")); // scratch clean, WORK home, REG home
    let at = seek_slot(b, after_clear, slot, &format!("{label}.s")); // REG at field `slot` first cell
    let cp = b.state(format!("{label}.cp"));
    b.add_rule(at, RuleSpec::new(), cp); // enter the copy loop on the field's first cell
    b.add_rule(cp, RuleSpec::new().on(REG, Some(MARK), None, Move::R).on(WORK, None, Some(MARK), Move::R), cp);
    let rin = b.state(format!("{label}.rin"));
    b.add_rule(cp, RuleSpec::new().on(REG, Some(BLANK), None, Move::S), rin); // padding -> done copying
    b.add_rule(cp, RuleSpec::new().on(REG, Some(SEP), None, Move::S), rin); // field boundary -> done copying
    let reg_home = rewind_home(b, rin, slot, &format!("{label}.r"));
    rewind_work(b, reg_home, &format!("{label}.w"))
}

/// Append WORK's marks into field `rd` (overwriting it). `from`: REG at home (leading `#`), WORK at
/// home over contiguous marks. Seeks field `rd`, blanks its window, writes one mark per WORK mark
/// (WORK read, REG write) rightward, then rewinds both heads home. WORK's marks are left INTACT.
pub fn append_work_to_field(b: &mut Builder, from: StateId, rd: Slot, label: &str) -> StateId {
    let at = seek_slot(b, from, rd, &format!("{label}.s")); // REG at field `rd` first cell
    // Blank the fixed-width window (marks and padding) rightward to the trailing `#`, then step back
    // left over the blanks to the field's first cell.
    let blank = b.state(format!("{label}.bl"));
    b.add_rule(at, RuleSpec::new(), blank);
    b.add_rule(blank, RuleSpec::new().on(REG, Some(MARK), Some(BLANK), Move::R), blank);
    b.add_rule(blank, RuleSpec::new().on(REG, Some(BLANK), Some(BLANK), Move::R), blank);
    let bk = b.state(format!("{label}.bk"));
    b.add_rule(blank, RuleSpec::new().on(REG, Some(SEP), None, Move::L), bk); // trailing `#`
    b.add_rule(bk, RuleSpec::new().on(REG, Some(BLANK), None, Move::L), bk);
    let start = b.state(format!("{label}.st"));
    b.add_rule(bk, RuleSpec::new().on(REG, Some(SEP), None, Move::R), start); // leading `#` -> first cell
    // Write one REG mark per WORK mark, advancing both heads; stop at WORK's trailing blank.
    let wr = b.state(format!("{label}.wr"));
    b.add_rule(start, RuleSpec::new(), wr);
    b.add_rule(wr, RuleSpec::new().on(WORK, Some(MARK), None, Move::R).on(REG, None, Some(MARK), Move::R), wr);
    let rin = b.state(format!("{label}.rin"));
    b.add_rule(wr, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S), rin); // WORK exhausted -> done
    let reg_home = rewind_home(b, rin, rd, &format!("{label}.r"));
    rewind_work(b, reg_home, &format!("{label}.w"))
}

/// APPEND field `slot`'s marks after WORK's existing marks (WORK is NOT cleared). `from`: REG at home
/// (leading `#`), WORK at home over contiguous marks (possibly empty). Advances the WORK head past its
/// marks to the first blank, seeks field `slot`, copies each mark there (REG read, WORK write) rightward
/// — so `slot`'s marks land right after WORK's existing ones — then rewinds both heads home. On exit
/// WORK holds `old ++ slot` and both heads are home. Mirrors `copy_field_to_work` minus the clear.
pub fn append_field_to_work(b: &mut Builder, from: StateId, slot: Slot, label: &str) -> StateId {
    // Walk the WORK head right over its existing marks; when it rests on the trailing blank (REG still on
    // the leading `#`), `seek_slot`'s `#`-rule takes over and seeks field `slot`.
    // INSERTION ORDER IS LOAD-BEARING: this WORK self-loop rule must be pushed onto `from` BEFORE
    // `seek_slot` (below) pushes its REG-`#` rule. The two overlap when REG=`#` ∧ WORK=MARK (mid-walk,
    // WORK not yet exhausted), and rule lookup is first-match-wins with no overlap check in `validate()`,
    // so swapping the two `add_rule` calls would silently break this gadget.
    b.add_rule(from, RuleSpec::new().on(WORK, Some(MARK), None, Move::R), from);
    let at = seek_slot(b, from, slot, &format!("{label}.s")); // REG at field `slot` first cell
    let cp = b.state(format!("{label}.cp"));
    b.add_rule(at, RuleSpec::new(), cp); // enter the copy loop on the field's first cell
    b.add_rule(cp, RuleSpec::new().on(REG, Some(MARK), None, Move::R).on(WORK, None, Some(MARK), Move::R), cp);
    let rin = b.state(format!("{label}.rin"));
    b.add_rule(cp, RuleSpec::new().on(REG, Some(BLANK), None, Move::S), rin); // padding -> done copying
    b.add_rule(cp, RuleSpec::new().on(REG, Some(SEP), None, Move::S), rin); // field boundary -> done copying
    let reg_home = rewind_home(b, rin, slot, &format!("{label}.r"));
    rewind_work(b, reg_home, &format!("{label}.w"))
}

/// Erase one WORK mark for each mark in field `rb` (monus). `from`: REG at home (leading `#`), WORK at
/// home over contiguous marks. Seeks `rb`, then loops: for each `rb` mark advance REG and erase WORK's
/// RIGHTMOST mark (a no-op once WORK is empty, so the result truncates at 0); the padding blank / field
/// `#` ends the loop. Rewinds REG home (WORK is already home each iteration). On exit WORK holds
/// `max(0, old - rb)` as contiguous marks and both heads are home.
pub fn erase_per_field(b: &mut Builder, from: StateId, rb: Slot, label: &str) -> StateId {
    let at = seek_slot(b, from, rb, &format!("{label}.s")); // REG at field `rb` first cell
    let head = b.state(format!("{label}.lp")); // loop head: WORK home, REG on the current `rb` cell
    b.add_rule(at, RuleSpec::new(), head);
    // Consume one `rb` mark (advance REG) and drop into the erase-one-work-mark sub-walk.
    let ef = b.state(format!("{label}.ef"));
    b.add_rule(head, RuleSpec::new().on(REG, Some(MARK), None, Move::R), ef);
    let rexit = b.state(format!("{label}.rx"));
    b.add_rule(head, RuleSpec::new().on(REG, Some(BLANK), None, Move::S), rexit); // padding -> `rb` exhausted
    b.add_rule(head, RuleSpec::new().on(REG, Some(SEP), None, Move::S), rexit); // field `#` -> `rb` exhausted
    // Erase the rightmost WORK mark, WORK head at home on entry, returning to `head` at home.
    let bk = b.state(format!("{label}.bk"));
    b.add_rule(ef, RuleSpec::new().on(WORK, Some(MARK), None, Move::R), ef); // walk right over marks
    b.add_rule(ef, RuleSpec::new().on(WORK, Some(BLANK), None, Move::L), bk); // step left onto the last mark
    let hw = b.state(format!("{label}.hw"));
    b.add_rule(bk, RuleSpec::new().on(WORK, Some(MARK), Some(BLANK), Move::L), hw); // erase last mark, walk left
    b.add_rule(bk, RuleSpec::new().on(WORK, Some(BLANK), None, Move::R), head); // WORK was empty: back home
    b.add_rule(hw, RuleSpec::new().on(WORK, Some(MARK), None, Move::L), hw); // walk left over the rest
    b.add_rule(hw, RuleSpec::new().on(WORK, Some(BLANK), None, Move::R), head); // off the left end -> home
    rewind_home(b, rexit, rb, &format!("{label}.r")) // WORK already home; just rewind REG
}

/// Append field `ra`'s marks onto WORK once per mark in the COUNTER field `cnt`, CONSUMING `cnt` down to
/// empty. `from`: REG at home (leading `#`), WORK at home over the accumulator's contiguous marks
/// (possibly empty). Each pass: if `cnt` still has a mark, erase its RIGHTMOST one (decrement) and
/// `append_field_to_work(ra)` (WORK grows by `ra`); when `cnt` is empty the loop ends. On exit WORK
/// holds `old ++ ra * (initial cnt)` and both heads are home; `cnt` is left empty. The counter cannot be
/// `ra`'s own operand register — a register-machine `mul` copies `rb` into a scratch (`rd`) first, so
/// `rb` stays read-only. Mirrors `erase_per_field`'s "do X once per field mark" shape, but the per-mark
/// body seeks `ra` (so it cannot ride on `cnt`'s head like `erase_per_field`'s WORK-only body — hence a
/// consumable counter instead of a parked head).
fn append_field_per_counter(b: &mut Builder, from: StateId, ra: Slot, cnt: Slot, label: &str) -> StateId {
    // Loop head = `from`: REG at home reads the leading `#` and seeks `cnt`. Re-entered every iteration
    // via the back-edge below, so `from` must carry ONLY this seek rule (which `seek_slot` adds to it).
    let at = seek_slot(b, from, cnt, &format!("{label}.s")); // REG at `cnt`'s first cell
    // Branch on `cnt`'s value: a leading MARK means iterate; a leading BLANK (empty field) means done.
    // Disjoint reads, so this pair is order-independent.
    let dec = b.state(format!("{label}.df"));
    b.add_rule(at, RuleSpec::new().on(REG, Some(MARK), None, Move::S), dec);
    let done = b.state(format!("{label}.done"));
    b.add_rule(at, RuleSpec::new().on(REG, Some(BLANK), None, Move::S), done);
    // Decrement: advance over `cnt`'s marks to the padding blank / trailing `#`, step back onto the last
    // mark, erase it. (`cnt`'s value is small here, so the `#` arm — an exactly-full field — never fires,
    // but is kept so the decrement is total.)
    b.add_rule(dec, RuleSpec::new().on(REG, Some(MARK), None, Move::R), dec);
    let bk = b.state(format!("{label}.db"));
    b.add_rule(dec, RuleSpec::new().on(REG, Some(BLANK), None, Move::L), bk); // padding -> onto last mark
    b.add_rule(dec, RuleSpec::new().on(REG, Some(SEP), None, Move::L), bk); // exactly-full field -> last mark
    let erased = b.state(format!("{label}.de"));
    b.add_rule(bk, RuleSpec::new().on(REG, Some(MARK), Some(BLANK), Move::S), erased); // erase the last mark
    let reg_home = rewind_home(b, erased, cnt, &format!("{label}.r")); // REG home again (WORK untouched)
    // Add `ra` to the accumulator, then loop back to re-check `cnt`.
    let after_add = append_field_to_work(b, reg_home, ra, &format!("{label}.a"));
    b.add_rule(after_add, RuleSpec::new(), from); // back-edge: re-enter the seek at the loop head
    // Loop exit: `cnt` empty, REG resting on its (blank) first cell -> rewind REG home.
    rewind_home(b, done, cnt, &format!("{label}.x"))
}

// ---- comparison helpers (the `le` primitive decomposes into these; each preserves the home convention) ----

/// WORK <- `max(0, x - y)` (monus). `from`: REG at home (leading `#`), WORK at home. Copies field `x`
/// onto WORK, then erases one WORK mark per field-`y` mark. On exit WORK holds `monus(x, y)` as
/// contiguous marks and both heads are home. The `le` primitive is `is_zero(monus(ra, rb))`.
fn monus_to_work(b: &mut Builder, from: StateId, x: Slot, y: Slot, label: &str) -> StateId {
    let after_copy = copy_field_to_work(b, from, x, &format!("{label}.c")); // WORK <- x
    erase_per_field(b, after_copy, y, &format!("{label}.e")) // WORK <- max(0, x - y)
}

/// Map WORK's mark-count to the boolean `is_zero`: empty WORK -> one MARK (`1`); non-empty WORK -> empty
/// (`0`). `from`: WORK head at home over contiguous marks (possibly empty); REG untouched. On exit WORK
/// holds `0`/`1` and the head is home. Reads are exclusive (BLANK vs MARK), so rule order is immaterial.
fn is_zero_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let done = b.state(format!("{label}.done"));
    b.add_rule(from, RuleSpec::new().on(WORK, Some(BLANK), Some(MARK), Move::S), done); // was empty -> `1`
    let clr = b.state(format!("{label}.clr"));
    b.add_rule(from, RuleSpec::new().on(WORK, Some(MARK), None, Move::S), clr); // was non-empty -> clear to `0`
    let after = clear_work(b, clr, &format!("{label}.c"));
    b.add_rule(after, RuleSpec::new(), done);
    done
}

/// Map WORK's mark-count to the boolean `is_nonzero` (the complement of `is_zero_work`): non-empty WORK
/// -> one MARK (`1`); empty WORK -> empty (`0`). `from`: WORK head at home over contiguous marks
/// (possibly empty); REG untouched. On exit WORK holds `0`/`1` and the head is home. Reads exclusive.
fn is_nonzero_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let done = b.state(format!("{label}.done"));
    b.add_rule(from, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S), done); // was empty -> stays `0`
    let clr = b.state(format!("{label}.clr"));
    b.add_rule(from, RuleSpec::new().on(WORK, Some(MARK), None, Move::S), clr); // was non-empty -> clear, then `1`
    let after = clear_work(b, clr, &format!("{label}.c"));
    b.add_rule(after, RuleSpec::new().on(WORK, None, Some(MARK), Move::S), done); // write the single mark
    done
}

/// Erase WORK's RIGHTMOST mark (monus 1); a no-op when WORK is already empty. `from`: WORK head at home
/// over contiguous marks (possibly empty); REG untouched. On exit WORK holds `max(0, old - 1)` and the
/// head is home. Mirrors the erase-one sub-walk inside `erase_per_field`. Reads exclusive at each state.
fn dec_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    b.add_rule(from, RuleSpec::new().on(WORK, Some(MARK), None, Move::R), from); // walk right over marks
    let bk = b.state(format!("{label}.bk"));
    b.add_rule(from, RuleSpec::new().on(WORK, Some(BLANK), None, Move::L), bk); // step left onto the last mark
    let hw = b.state(format!("{label}.hw"));
    b.add_rule(bk, RuleSpec::new().on(WORK, Some(MARK), Some(BLANK), Move::L), hw); // erase last mark, walk left
    let home = b.state(format!("{label}.home"));
    b.add_rule(bk, RuleSpec::new().on(WORK, Some(BLANK), None, Move::R), home); // WORK was empty: back home
    b.add_rule(hw, RuleSpec::new().on(WORK, Some(MARK), None, Move::L), hw); // walk left over the rest
    b.add_rule(hw, RuleSpec::new().on(WORK, Some(BLANK), None, Move::R), home); // off the left end -> home
    home
}

/// WORK <- `eq(ra, rb) = le(ra, rb) && le(rb, ra)`, encoded `0`/`1`. `from`/exit: both heads home.
/// `and(u, v) = monus(u + v, 1)` for booleans `u, v` in `{0, 1}`. Uses `rd` to park `le(ra, rb)` across
/// the second `le` computation — SOUND only because `rd ∉ {ra, rb}` (a comparison's destination is a
/// fresh temp), so parking there cannot clobber an operand that `le(rb, ra)` re-reads.
fn eq_to_work(b: &mut Builder, from: StateId, ra: Slot, rb: Slot, rd: Slot, label: &str) -> StateId {
    let m1 = monus_to_work(b, from, ra, rb, &format!("{label}.m1"));
    let u = is_zero_work(b, m1, &format!("{label}.z1")); // WORK <- le(ra, rb)
    let park = append_work_to_field(b, u, rd, &format!("{label}.pk")); // rd <- le(ra, rb) (scratch park)
    let m2 = monus_to_work(b, park, rb, ra, &format!("{label}.m2"));
    let v = is_zero_work(b, m2, &format!("{label}.z2")); // WORK <- le(rb, ra)
    let sum = append_field_to_work(b, v, rd, &format!("{label}.sm")); // WORK <- le(ra, rb) + le(rb, ra)
    dec_work(b, sum, &format!("{label}.dc")) // WORK <- monus(sum, 1) = eq(ra, rb)
}

#[allow(clippy::too_many_arguments)] // `arith`/`compare` mirror the trait's three-address signature.
impl Encoding for Unary {
    fn write_literal(&self, b: &mut Builder, entry: StateId, exit: StateId, n: u64, rd: Slot) {
        // Fixed-width, no shift: seek rd's field; BLANK the whole window rightward to the trailing `#`;
        // step left back to the field's first cell; write `n` MARKs rightward; rewind REG home.
        let base = format!("wl{rd}s{entry}"); // `entry` uniquifies across calls (no state-name clashes)
        let at = seek_slot(b, entry, rd, &format!("{base}.s"));
        let blanking = b.state(format!("{base}.blank"));
        b.add_rule(at, RuleSpec::new(), blanking);
        b.add_rule(blanking, RuleSpec::new().on(REG, Some(MARK), Some(BLANK), Move::R), blanking);
        b.add_rule(blanking, RuleSpec::new().on(REG, Some(BLANK), Some(BLANK), Move::R), blanking);
        let back = b.state(format!("{base}.back"));
        b.add_rule(blanking, RuleSpec::new().on(REG, Some(SEP), None, Move::L), back); // on trailing `#`
        b.add_rule(back, RuleSpec::new().on(REG, Some(BLANK), None, Move::L), back);
        let start = b.state(format!("{base}.start"));
        b.add_rule(back, RuleSpec::new().on(REG, Some(SEP), None, Move::R), start); // leading `#` -> first cell
        let mut cur = start;
        for i in 0..n {
            let nxt = b.state(format!("{base}.m{i}"));
            b.add_rule(cur, RuleSpec::new().on(REG, None, Some(MARK), Move::R), nxt);
            cur = nxt;
        }
        let home = rewind_home(b, cur, rd, &format!("{base}.r"));
        b.add_rule(home, RuleSpec::new(), exit);
    }

    fn decode_nat(&self, reg_cells: &[Symbol], slot: Slot) -> Option<u64> {
        // Fixed-width bank `# f0 # f1 # … #`; field `slot` follows the `slot`-th `#` (leading `#` = #0)
        // as leading `MARK`s then `BLANK` padding then a closing `#`. Find the sep, count marks, and
        // require the field be well-formed (marks, then blanks, then a `#`) — so a `slot` past the last
        // field (only the trailing `#`, no closing `#` after it) is `None`.
        let mut seps = 0u32;
        for (i, &c) in reg_cells.iter().enumerate() {
            if c == SEP {
                if seps == slot {
                    let rest = &reg_cells[i + 1..];
                    let marks = rest.iter().take_while(|&&x| x == MARK).count();
                    let pad = rest[marks..].iter().take_while(|&&x| x == BLANK).count();
                    return (rest.get(marks + pad) == Some(&SEP)).then_some(marks as u64);
                }
                seps += 1;
            }
        }
        None
    }

    // `arith` Add/Sub are Task 3 (below); `Mul` is Task 4; `compare` (Task 5) has its own stub.
    fn arith(&self, b: &mut Builder, entry: StateId, exit: StateId, op: BinOp, ra: Slot, rb: Slot, rd: Slot) {
        // `entry` (a fresh StateId per call site) uniquifies every derived state name across calls.
        match op {
            BinOp::Add => {
                // WORK <- ra; WORK <- WORK ++ rb; rd <- WORK. Result rd = ra + rb.
                let after_ra = copy_field_to_work(b, entry, ra, &format!("add{entry}.a"));
                let after_rb = append_field_to_work(b, after_ra, rb, &format!("add{entry}.b"));
                let after_wr = append_work_to_field(b, after_rb, rd, &format!("add{entry}.d"));
                b.add_rule(after_wr, RuleSpec::new(), exit);
            }
            BinOp::Sub => {
                // WORK <- ra; erase one WORK mark per rb mark; rd <- WORK. Result rd = max(0, ra - rb).
                let after_ra = copy_field_to_work(b, entry, ra, &format!("sub{entry}.a"));
                let after_er = erase_per_field(b, after_ra, rb, &format!("sub{entry}.e"));
                let after_wr = append_work_to_field(b, after_er, rd, &format!("sub{entry}.d"));
                b.add_rule(after_wr, RuleSpec::new(), exit);
            }
            BinOp::Mul => {
                // Repeated addition: rd <- ra * rb. rd doubles as a consumable loop counter (a copy of
                // rb), so `rb` itself is only read. WORK <- rb; rd <- WORK (the counter); WORK <- 0 (the
                // accumulator); append ra once per counter mark (draining rd); rd <- WORK.
                let l = format!("mul{entry}");
                let after_cnt = copy_field_to_work(b, entry, rb, &format!("{l}.cb")); // WORK <- rb
                let after_setd = append_work_to_field(b, after_cnt, rd, &format!("{l}.sd")); // rd <- rb
                let after_clear = clear_work(b, after_setd, &format!("{l}.cl")); // WORK <- 0
                let after_loop = append_field_per_counter(b, after_clear, ra, rd, &format!("{l}.lp")); // WORK <- ra*rb
                let after_wr = append_work_to_field(b, after_loop, rd, &format!("{l}.wr")); // rd <- WORK
                b.add_rule(after_wr, RuleSpec::new(), exit);
            }
            BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                unreachable!("comparison `{op:?}` dispatches to `compare`, not `arith`")
            }
        }
    }
    fn compare(&self, b: &mut Builder, entry: StateId, exit: StateId, op: BinOp, ra: Slot, rb: Slot, rd: Slot) {
        // `entry` (a fresh StateId per call site) uniquifies every derived state name across calls. The
        // primitive is `le(x, y) = is_zero(monus(x, y))`; each op is a derivation of it, mirroring the λ
        // backend: `ge = le(rb, ra)`, `lt = !ge`, `gt = !le`, `eq = le(ra, rb) && le(rb, ra)`, `ne = !eq`.
        // Every arm ends with WORK holding the `0`/`1` result, then writes it to `rd`.
        let l = format!("cmp{entry}");
        // Build the WORK boolean for this op; the trailing `append_work_to_field(rd)` is shared.
        let result = match op {
            BinOp::Le => {
                // le(ra, rb) = is_zero(monus(ra, rb)).
                let m = monus_to_work(b, entry, ra, rb, &format!("{l}.m"));
                is_zero_work(b, m, &format!("{l}.z"))
            }
            BinOp::Gt => {
                // gt = !le(ra, rb) = is_nonzero(monus(ra, rb)).
                let m = monus_to_work(b, entry, ra, rb, &format!("{l}.m"));
                is_nonzero_work(b, m, &format!("{l}.n"))
            }
            BinOp::Ge => {
                // ge = le(rb, ra) = is_zero(monus(rb, ra)).
                let m = monus_to_work(b, entry, rb, ra, &format!("{l}.m"));
                is_zero_work(b, m, &format!("{l}.z"))
            }
            BinOp::Lt => {
                // lt = !ge = is_nonzero(monus(rb, ra)).
                let m = monus_to_work(b, entry, rb, ra, &format!("{l}.m"));
                is_nonzero_work(b, m, &format!("{l}.n"))
            }
            BinOp::Eq => eq_to_work(b, entry, ra, rb, rd, &l),
            BinOp::Ne => {
                // ne = !eq = is_zero(eq), where eq is itself a `0`/`1` boolean.
                let eq = eq_to_work(b, entry, ra, rb, rd, &l);
                is_zero_work(b, eq, &format!("{l}.ne"))
            }
            BinOp::Add | BinOp::Sub | BinOp::Mul => {
                unreachable!("arithmetic `{op:?}` dispatches to `arith`, not `compare`")
            }
        };
        let after_wr = append_work_to_field(b, result, rd, &format!("{l}.wr")); // rd <- the `0`/`1` result
        b.add_rule(after_wr, RuleSpec::new(), exit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::build::{FIELD_WIDTH, TAPES};
    use crate::tm::sim::{DEFAULT_CAPS as TM_DEFAULT_CAPS, Status, simulate};

    /// Build a machine over a `slots`-field register bank: `write_literal` each `(slot, value)`, run
    /// `body(entry, exit)` to wire the gadget under test, and halt. Returns the decoded `result` slot.
    fn run_gadget(
        slots: u32,
        inits: &[(Slot, u64)],
        result: Slot,
        body: impl FnOnce(&mut Builder, StateId, StateId),
    ) -> Option<u64> {
        let enc = Unary;
        let mut b = Builder::new();
        // Chain: setup literals -> body -> halt. Build back-to-front so each `exit` is known.
        let halt = b.accept("halt");
        let gadget_entry = b.state("gadget");
        // The body wires `gadget_entry .. halt`.
        body(&mut b, gadget_entry, halt);
        // Prepend literal-writers, each flowing into the next, ending at `gadget_entry`.
        let mut entry = gadget_entry;
        for &(slot, val) in inits.iter().rev() {
            let w = b.state(format!("lit{slot}"));
            enc.write_literal(&mut b, w, entry, val, slot);
            entry = w;
        }
        // The reg tape starts as an all-zero FIXED-WIDTH bank: `#` then (FIELD_WIDTH blanks + `#`)*slots.
        let mut init_reg: Vec<Symbol> = vec![SEP];
        for _ in 0..slots {
            init_reg.extend(std::iter::repeat_n(BLANK, FIELD_WIDTH));
            init_reg.push(SEP);
        }
        let m = b.finish(entry);
        assert!(m.validate().is_empty(), "invalid machine: {:?}", m.validate());
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = init_reg;
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted, "gadget did not halt");
        enc.decode_nat(&tapes[REG].snapshot().0, result)
    }

    #[test]
    fn write_literal_then_decode() {
        // The body under test writes the literal (no setup inits); decode reads it back.
        assert_eq!(run_gadget(1, &[], 0, |b, e, x| Unary.write_literal(b, e, x, 5, 0)), Some(5));
        assert_eq!(run_gadget(2, &[], 1, |b, e, x| Unary.write_literal(b, e, x, 3, 1)), Some(3));
        assert_eq!(run_gadget(2, &[], 0, |b, e, x| Unary.write_literal(b, e, x, 0, 0)), Some(0));
    }

    #[test]
    fn decode_nat_reads_a_field() {
        // reg = `# 1 1 1 # 1 #` -> slot0=3, slot1=1.
        // Non-padded and padded fields both decode via the trait method.
        let cells = vec![SEP, MARK, MARK, MARK, SEP, MARK, SEP];
        assert_eq!(Unary.decode_nat(&cells, 0), Some(3));
        assert_eq!(Unary.decode_nat(&cells, 1), Some(1));
        assert_eq!(Unary.decode_nat(&cells, 2), None); // no field after the trailing `#`
        // A fixed-width field `# 1 1 _ _ #` (value 2, padded) decodes to 2.
        let padded = vec![SEP, MARK, MARK, BLANK, BLANK, SEP];
        assert_eq!(Unary.decode_nat(&padded, 0), Some(2));
    }

    #[test]
    fn copy_field_to_work_roundtrips() {
        // slot0 <- v; copy slot0 -> work; append work -> slot1; decode slot1 == v. Exercises
        // clear_work + seek_slot + copy_field_to_work + append_work_to_field + both rewinds.
        fn copy_then_append(b: &mut Builder, e: StateId, x: StateId) {
            let after_copy = copy_field_to_work(b, e, 0, "cfw");
            let after_append = append_work_to_field(b, after_copy, 1, "awf");
            b.add_rule(after_append, RuleSpec::new(), x);
        }
        assert_eq!(run_gadget(2, &[(0, 4)], 1, copy_then_append), Some(4));
        assert_eq!(run_gadget(2, &[(0, 1)], 1, copy_then_append), Some(1));
        assert_eq!(run_gadget(2, &[(0, 0)], 1, copy_then_append), Some(0));
    }

    fn arith(op: BinOp, a: u64, b: u64) -> Option<u64> {
        // 3-field bank: slot0=a, slot1=b, slot2=result.
        run_gadget(3, &[(0, a), (1, b)], 2, move |bd, e, x| Unary.arith(bd, e, x, op, 0, 1, 2))
    }

    #[test]
    fn add_gadget() {
        assert_eq!(arith(BinOp::Add, 3, 2), Some(5));
        assert_eq!(arith(BinOp::Add, 0, 4), Some(4));
        assert_eq!(arith(BinOp::Add, 0, 0), Some(0));
    }

    #[test]
    fn monus_gadget_is_truncated() {
        assert_eq!(arith(BinOp::Sub, 5, 3), Some(2));
        assert_eq!(arith(BinOp::Sub, 3, 5), Some(0)); // monus
        assert_eq!(arith(BinOp::Sub, 4, 0), Some(4));
    }

    #[test]
    fn mul_gadget() {
        assert_eq!(arith(BinOp::Mul, 3, 2), Some(6));
        assert_eq!(arith(BinOp::Mul, 0, 5), Some(0));
        assert_eq!(arith(BinOp::Mul, 4, 1), Some(4));
        assert_eq!(arith(BinOp::Mul, 1, 4), Some(4));
    }

    fn cmp(op: BinOp, a: u64, b: u64) -> Option<u64> {
        // 3-field bank: slot0=a, slot1=b, slot2=result. `Eq`/`Ne` use rd (slot2) as scratch — valid
        // since rd ∉ {ra, rb} (a comparison's destination is a fresh temp), so no extra field is needed.
        run_gadget(3, &[(0, a), (1, b)], 2, move |bd, e, x| Unary.compare(bd, e, x, op, 0, 1, 2))
    }

    #[test]
    fn comparison_gadgets() {
        assert_eq!(cmp(BinOp::Eq, 2, 2), Some(1));
        assert_eq!(cmp(BinOp::Eq, 2, 3), Some(0));
        assert_eq!(cmp(BinOp::Ne, 2, 3), Some(1));
        assert_eq!(cmp(BinOp::Lt, 1, 2), Some(1));
        assert_eq!(cmp(BinOp::Lt, 2, 2), Some(0));
        assert_eq!(cmp(BinOp::Le, 2, 2), Some(1));
        assert_eq!(cmp(BinOp::Gt, 3, 1), Some(1));
        assert_eq!(cmp(BinOp::Gt, 1, 3), Some(0));
        assert_eq!(cmp(BinOp::Ge, 3, 3), Some(1));
        assert_eq!(cmp(BinOp::Ge, 1, 3), Some(0));
    }
}
