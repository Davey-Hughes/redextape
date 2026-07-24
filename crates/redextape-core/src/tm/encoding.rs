//! The `Encoding` seam: unary δ-gadgets over the `reg`/`work` tapes. A `Nat v` is `v` `MARK`s in a
//! `#`-delimited register field. Gadgets decompose into sub-primitives (seek/clear/copy/append) that
//! each preserve the home convention (REG head on the leading `#`, WORK head at its leftmost (value)
//! cell — blank only when WORK is empty), so they compose freely. Behavior is verified by SIMULATION
//! (build a tiny machine → run → decode).

use crate::core::BinOp;
use crate::tm::build::{AT, BOX, Builder, FIELD_WIDTH, HEAP, MARK, REG, RuleSpec, SEP, STACK, Slot, WORK};
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
    /// The initial REG tape for a `slots`-field bank: `#` then (`FIELD_WIDTH` blanks + `#`)*`slots`.
    /// Head begins at cell 0 (the leading `#` = home). Encoding-specific (a zero field's contents).
    fn init_reg(&self, slots: u32) -> Vec<Symbol>;
    /// `slot rd <- slot rs`. Flows `entry -> exit`; both heads home on entry and exit. Safe when
    /// `rs == rd` (identity). Encoding-specific (copies the value representation).
    fn mov(&self, b: &mut Builder, entry: StateId, exit: StateId, rs: Slot, rd: Slot);
    /// From `entry` (REG at home), seek field `r`: if it is zero (unary: first cell blank) flow to
    /// `if_zero`, else to `if_nonzero`. REG head home on both exits; WORK untouched. Encoding-specific
    /// (what "zero" looks like on the tape).
    fn jz(&self, b: &mut Builder, entry: StateId, if_zero: StateId, if_nonzero: StateId, r: Slot);
    /// The `Call`-side gadget: push a new frame onto STACK. `from` `entry` (REG home, WORK home, STACK
    /// at top): push the return-tag `tag` at the frame's bottom, then save each `Loc` field (slots
    /// `1..=n_loc`) above it, in slot order. Flows `entry -> exit` with all heads home/top on exit.
    /// `n_loc = 0` pushes only the tag. A COPY (not a move): the REG `Loc` fields are left UNCHANGED.
    fn push_frame(&self, b: &mut Builder, entry: StateId, exit: StateId, n_loc: u32, tag: u64);
    /// The first half of the `Ret`-side gadget: pop the `Loc` fields (top->down, reverse of the save)
    /// back into REG, leaving the STACK head on the tag field for `Task 4` to dispatch. `from` `entry`
    /// (a non-empty STACK at the top, REG/WORK home): pop the top `n_loc` fields — they are
    /// `Loc_{n_loc-1}` … `Loc0`, since `push_frame` saved `Loc0..Loc_{n_loc-1}` above the tag — and write
    /// each back into its REG `Loc` slot. Flows `entry -> exit`. On exit the STACK head is at the top
    /// with the tag now the top field, REG/WORK home. `n_loc = 0` is a no-op leaving the tag on top.
    fn pop_frame_restore(&self, b: &mut Builder, entry: StateId, exit: StateId, n_loc: u32);
    /// The second half of the `Ret`-side gadget: with the return-tag as the top STACK field (as left by
    /// `pop_frame_restore`), read+erase the tag and route to `exits[c]` where `c` is the tag's mark
    /// count. `from` `entry` (STACK head at the top — the blank right of the tag's `#`; REG/WORK home).
    /// Erases the whole tag field so on the chosen exit the STACK head is at the NEW top (the caller's
    /// frame, or an empty stack), REG/WORK untouched (still home). Does NOT flow to a single `exit`: it
    /// is a finite-state fan-out to one of `exits`. If `c >= exits.len()` (cannot happen for a
    /// well-formed program) it clamps to `exits.last()` defensively — never panics, never over-indexes.
    /// An empty `exits` is a no-op (leaves `entry` rule-less, so the machine simply halts there).
    fn dispatch_tag(&self, b: &mut Builder, entry: StateId, exits: &[StateId]);
    /// Append a cons cell (head = field `rh`'s value, tail = field `rt`'s value) at the HEAP top, and
    /// write the new cell's 1-based pointer (= the cell count) into field `rd`. Flows `entry -> exit`,
    /// all heads home/top. PRECONDITION: `rd` distinct from `rh` and `rt` (`rd` is written last from the
    /// count while `rh`/`rt` were already read — but keep them distinct; `lower_asm` emits fresh operands).
    fn cons(&self, b: &mut Builder, entry: StateId, exit: StateId, rh: Slot, rt: Slot, rd: Slot);
    /// `slot rd <- (field rl == 0) as 0/1`. Safe when `rl == rd` — `rl` is fully copied to WORK before
    /// `rd` is written.
    fn is_empty_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot);
    /// `rd <- head(field rl)`: read the pointer in `rl`, seek the cell, write its head-word into `rd`.
    /// Flows `entry -> exit` with all heads home/top on the value exit. A `nil` pointer (`rl == 0`) or a
    /// dangling pointer has no value and SPINS to a cap (HitCap), matching λ (Ω) and the reference
    /// (Runtime); `rd` is not written. Like `cons`, the structural navigation (seek) is unary-always;
    /// only the copied head-word follows the encoding. PRECONDITION: `rd` distinct from `rl` (`rd` is
    /// written last, after `rl` is fully read — but keep them distinct; `lower_asm` emits fresh operands).
    fn head_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot);
    /// As `head_op`, but writes the tail-word into `rd`.
    fn tail_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot);
    /// `rd <- box(rv)`: allocate a fresh BOX field holding `rv`'s value and write the new field's
    /// 1-based pointer (= the field count) into `rd`. Flows `entry -> exit`; the BOX head rests on the
    /// leading `#` (origin) on entry and exit. PRECONDITION: `rd` distinct from `rv`.
    fn box_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rv: Slot, rd: Slot);
    /// `rd <- box_get(rb)`: read the value of the BOX field the pointer `rb` addresses into `rd`. A nil
    /// pointer (`rb == 0`) or a dangling pointer has no value and SPINS to a cap (HitCap), matching λ (Ω)
    /// and the reference (Runtime); `rd` is not written. BOX head home (origin) on the value exit.
    /// PRECONDITION: `rd` distinct from `rb`.
    fn box_get_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rb: Slot, rd: Slot);
    /// `*rb <- rv`: overwrite the BOX field the pointer `rb` addresses with `rv`'s value, in place (the
    /// `#` delimiters never move). Evaluates to unit (no destination). A nil/dangling `rb` SPINS to a cap
    /// (as `box_get_op`). BOX head home (origin) on the exit.
    fn box_set_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rb: Slot, rv: Slot);
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
fn clear_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
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
fn copy_field_to_work(b: &mut Builder, from: StateId, slot: Slot, label: &str) -> StateId {
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
fn append_work_to_field(b: &mut Builder, from: StateId, rd: Slot, label: &str) -> StateId {
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
fn append_field_to_work(b: &mut Builder, from: StateId, slot: Slot, label: &str) -> StateId {
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
fn erase_per_field(b: &mut Builder, from: StateId, rb: Slot, label: &str) -> StateId {
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

// ---- STACK tape sub-primitives (free functions; each preserves the STACK "top" invariant) ----
//
// The STACK holds `[field]#[field]#…#[field]#` with the head on the BLANK immediately after the last
// `#` (the "top"); an empty stack has the head at cell 0 over all blanks. Every gadget below takes the
// head at the top on entry and leaves it at the (possibly new) top on exit. STACK data symbols are only
// `MARK`/`BLANK`/`SEP` — no new symbol — so empty-vs-frame is a blank-vs-`#` check one cell left of the
// top. Values are variable-width unary appended at the top (no fixed window, no shifting).

/// Append WORK's marks as a new `#`-terminated field at the STACK top. `from`: WORK at home over
/// contiguous marks (possibly empty), STACK head at the top. Walks WORK right over its marks, writing
/// one STACK mark per WORK mark (both heads advance R); when WORK is exhausted writes the field's
/// trailing `#` and steps STACK onto the new blank top; then rewinds WORK home (marks left INTACT). On
/// exit the STACK head is at the new top and WORK is home over its (unchanged) marks. Mirrors
/// `append_field_to_work`'s copy loop, but the destination grows the tape (no fixed window to blank).
fn stack_push_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    // Copy loop (self-looping on `from`): for each WORK mark write a STACK mark, advancing both heads.
    b.add_rule(from, RuleSpec::new().on(WORK, Some(MARK), None, Move::R).on(STACK, None, Some(MARK), Move::R), from);
    // WORK exhausted (its trailing blank): terminate the field with a `#` and step onto the new top.
    let term = b.state(format!("{label}.term"));
    b.add_rule(from, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S).on(STACK, None, Some(SEP), Move::R), term);
    rewind_work(b, term, label) // WORK head was left on its trailing blank -> back home, marks intact
}

/// Write `c` marks then a `#` as a new field at the STACK top (unrolled, like `write_literal`'s mark
/// loop but append-only, no fixed window). `from`: STACK head at the top. `c = 0` writes just a `#` (an
/// empty field). On exit the STACK head is at the new blank top; WORK/REG are untouched.
fn stack_push_literal(b: &mut Builder, from: StateId, c: u64, label: &str) -> StateId {
    let mut cur = from;
    for i in 0..c {
        let nxt = b.state(format!("{label}.m{i}"));
        b.add_rule(cur, RuleSpec::new().on(STACK, None, Some(MARK), Move::R), nxt); // write a mark, advance
        cur = nxt;
    }
    let top = b.state(format!("{label}.top"));
    b.add_rule(cur, RuleSpec::new().on(STACK, None, Some(SEP), Move::R), top); // terminate + step to new top
    top
}

/// Pop the top STACK field into WORK. `from`: STACK head at the top (STACK non-empty), REG/WORK home.
/// Clears WORK; steps left onto the field's trailing `#` and erases it; walks left erasing each STACK
/// mark while writing a WORK mark (STACK head L, WORK head R — one rule, opposite directions); stops at
/// the field's left boundary (a `#` of the frame below, or the origin blank); steps right to the new
/// top; rewinds WORK home. On exit WORK is home holding the popped field's value (unary count preserved,
/// order irrelevant) and the STACK head is at the new top with the popped field fully erased. Reuses
/// `clear_work` and the erase-back-walk shape from `dec_work`.
fn stack_pop_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let cleared = clear_work(b, from, &format!("{label}.cl")); // WORK empty+home; STACK still at the top
    // Step left off the top blank onto the field's trailing `#`.
    let on_hash = b.state(format!("{label}.oh"));
    b.add_rule(cleared, RuleSpec::new().on(STACK, Some(BLANK), None, Move::L), on_hash);
    // Erase that `#` and step left onto the field's content (a mark — or straight onto the boundary if
    // the popped field is empty).
    let walk = b.state(format!("{label}.wk"));
    b.add_rule(on_hash, RuleSpec::new().on(STACK, Some(SEP), Some(BLANK), Move::L), walk);
    // Walk left erasing each STACK mark, writing one WORK mark per erased mark (heads move opposite ways).
    b.add_rule(
        walk,
        RuleSpec::new().on(STACK, Some(MARK), Some(BLANK), Move::L).on(WORK, None, Some(MARK), Move::R),
        walk,
    );
    // Left boundary: a `#` (the frame below) or the origin blank both end the field -> step right to top.
    let to_top = b.state(format!("{label}.tt"));
    b.add_rule(walk, RuleSpec::new().on(STACK, Some(SEP), None, Move::R), to_top);
    b.add_rule(walk, RuleSpec::new().on(STACK, Some(BLANK), None, Move::R), to_top);
    rewind_work(b, to_top, &format!("{label}.rw")) // WORK head on its trailing blank -> home w/ the value
}

/// Branch on whether the STACK is empty WITHOUT mutating any tape. `from`: STACK head at the top. Steps
/// left: a `#` (a frame below) -> `if_nonempty`; a blank (origin) -> `if_empty`. Either branch steps
/// back right in the same transition, so both exits see the STACK head restored to the top. Mirrors
/// `jz`'s two-exit shape. No `label` param, so derived state names are uniquified from `from`.
pub(crate) fn stack_is_empty(b: &mut Builder, from: StateId, if_empty: StateId, if_nonempty: StateId) {
    let base = format!("se{from}");
    let look = b.state(format!("{base}.look"));
    b.add_rule(from, RuleSpec::new().on(STACK, Some(BLANK), None, Move::L), look); // step off the top blank
    // `#` -> non-empty; blank -> empty. The Move::R restores the head to the top in the same step.
    b.add_rule(look, RuleSpec::new().on(STACK, Some(SEP), None, Move::R), if_nonempty);
    b.add_rule(look, RuleSpec::new().on(STACK, Some(BLANK), None, Move::R), if_empty);
}

// ---- HEAP tape sub-primitives (free functions; each preserves the HEAP "top" invariant) ----
//
// The HEAP holds `@ <head marks> # <tail marks>` cons cells laid left-to-right, the head on the BLANK
// immediately after the last cell (the "top"); an empty heap has the head at cell 0 over all blanks.
// Cells sit at 1-based unary addresses (nil = pointer 0). Symbols are `AT`/`MARK`/`SEP`/`BLANK`; a
// zero-count field is just adjacent delimiters, so no interior blank ever appears inside the cell
// region — the ONLY blanks are the origin-left boundary and the top. A cell is built in two writes:
// `heap_open_cell_with_work` emits `@ <head> #`, then `heap_append_work` emits `<tail>`; both grow the
// tape rightward and end on the fresh blank top (no fixed window, no shifting).

/// Open a new cons cell at the HEAP top, writing `@ <WORK marks> #` (the head field + separator).
/// `from`: WORK at home over contiguous marks (possibly empty), HEAP head at the top. Writes `@`, then
/// one HEAP mark per WORK mark (both heads advance R), then the head/tail separator `#`, stepping HEAP
/// onto the new blank top; then rewinds WORK home (marks left INTACT). On exit the HEAP head is at the
/// new top and WORK is home over its (unchanged) marks. Pair with `heap_append_work` to write the tail.
fn heap_open_cell_with_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    // Write the cell's opening `@` and step onto the head-field region.
    let cp = b.state(format!("{label}.cp"));
    b.add_rule(from, RuleSpec::new().on(HEAP, None, Some(AT), Move::R), cp);
    // Copy loop: for each WORK mark write a HEAP mark, advancing both heads.
    b.add_rule(cp, RuleSpec::new().on(WORK, Some(MARK), None, Move::R).on(HEAP, None, Some(MARK), Move::R), cp);
    // WORK exhausted (its trailing blank): write the head/tail `#` and step onto the new blank top.
    let term = b.state(format!("{label}.term"));
    b.add_rule(cp, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S).on(HEAP, None, Some(SEP), Move::R), term);
    rewind_work(b, term, label) // WORK head was left on its trailing blank -> back home, marks intact
}

/// Complete the open cell's tail, writing `<WORK marks>` at the HEAP top (right after the cell's `#`).
/// `from`: WORK at home over contiguous marks (possibly empty), HEAP head at the top. Writes one HEAP
/// mark per WORK mark (both heads advance R); an empty tail writes nothing and stays. On exit the HEAP
/// head is at the (possibly unchanged) new top and WORK is home over its (unchanged) marks. Mirrors
/// `heap_open_cell_with_work`'s copy loop, minus the `@`/`#` delimiters.
fn heap_append_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    // Copy loop (self-looping on `from`): for each WORK mark write a HEAP mark, advancing both heads.
    b.add_rule(from, RuleSpec::new().on(WORK, Some(MARK), None, Move::R).on(HEAP, None, Some(MARK), Move::R), from);
    // WORK exhausted: nothing more to write; the HEAP head already rests on the new top.
    let term = b.state(format!("{label}.term"));
    b.add_rule(from, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S), term);
    rewind_work(b, term, label) // WORK head was left on its trailing blank -> back home, marks intact
}

/// Count the HEAP's cons cells into WORK. `from`: HEAP head at the top, WORK home. Clears WORK,
/// then a two-landmark walk between the top blank and the origin-left blank (no interior blanks exist,
/// so those are the only two boundaries). Pass 1: step left off the top, then walk left writing one
/// WORK mark per `@` (skipping `MARK`/`SEP`) until the origin-left blank; rewind WORK home so WORK holds
/// the cell count. Pass 2: step right off the origin-left blank, walk right over every cell until the
/// top blank. On exit WORK is home holding the count and the HEAP head is back at the top.
fn heap_count_cells_to_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let cleared = clear_work(b, from, &format!("{label}.cl")); // WORK empty+home; HEAP still at the top
    // Pass 1: step left off the top blank, then walk left counting `@`s.
    let scan = b.state(format!("{label}.sl"));
    b.add_rule(cleared, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::L), scan); // off the top blank
    // Each `@` writes one WORK mark (WORK advances R); `MARK`/`SEP` are skipped; the origin-left blank
    // ends the pass. Disjoint HEAP reads, so rule order is immaterial.
    b.add_rule(scan, RuleSpec::new().on(HEAP, Some(AT), None, Move::L).on(WORK, None, Some(MARK), Move::R), scan);
    b.add_rule(scan, RuleSpec::new().on(HEAP, Some(MARK), None, Move::L), scan);
    b.add_rule(scan, RuleSpec::new().on(HEAP, Some(SEP), None, Move::L), scan);
    let counted = b.state(format!("{label}.ct"));
    b.add_rule(scan, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::S), counted); // origin-left -> done
    let home = rewind_work(b, counted, &format!("{label}.w")); // WORK head on its trailing blank -> home w/ count
    // Pass 2: step right off the origin-left blank, then walk right over every cell back to the top.
    let fwd = b.state(format!("{label}.sr"));
    b.add_rule(home, RuleSpec::new().on(HEAP, None, None, Move::R), fwd); // off the origin-left blank
    b.add_rule(fwd, RuleSpec::new().on(HEAP, Some(AT), None, Move::R), fwd);
    b.add_rule(fwd, RuleSpec::new().on(HEAP, Some(MARK), None, Move::R), fwd);
    b.add_rule(fwd, RuleSpec::new().on(HEAP, Some(SEP), None, Move::R), fwd);
    let top = b.state(format!("{label}.top"));
    b.add_rule(fwd, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::S), top); // top blank -> done
    top
}

/// Runtime-seek the `P`-th cons cell, a two-exit gadget (like `stack_is_empty`). PRECONDITION: WORK
/// holds the counter `P >= 1` at home; HEAP head at the top; REG home. Walks left to the origin, steps
/// right onto cell 1, then loops decrementing the counter once per cell — landing on the `P`-th `@` when
/// the counter drains. `found`: HEAP head on the `P`-th cell's `@`, WORK **empty** at home (the counter
/// is drained to 0 to detect the target), REG home. `missing`: `P` exceeds the cell count (or the heap
/// is empty) — HEAP position unspecified (the caller halts). Read-only on REG. Derives unique state
/// names from `from`, like `stack_is_empty`. Totality: the counter strictly decreases each iteration and
/// the HEAP head strictly advances right over a finite tape, so the loop always reaches an exit.
fn heap_seek_cell(b: &mut Builder, from: StateId, found: StateId, missing: StateId) {
    let base = format!("hs{from}");
    // Pass 1: step left off the top blank, then walk left over the cell region (`AT`/`MARK`/`SEP`) to the
    // origin-left blank — the only blank left of the cells (no interior blanks exist). On reaching it,
    // step RIGHT back onto cell 1's first symbol.
    let wl = b.state(format!("{base}.wl"));
    b.add_rule(from, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::L), wl); // off the top blank
    b.add_rule(wl, RuleSpec::new().on(HEAP, Some(AT), None, Move::L), wl);
    b.add_rule(wl, RuleSpec::new().on(HEAP, Some(MARK), None, Move::L), wl);
    b.add_rule(wl, RuleSpec::new().on(HEAP, Some(SEP), None, Move::L), wl);
    let land = b.state(format!("{base}.ld"));
    b.add_rule(wl, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::R), land); // origin-left -> onto cell 1
    // On cell 1's position: `@` -> enter the decrement loop; `BLANK` -> the heap is empty -> `missing`.
    let dloop = b.state(format!("{base}.lp")); // loop head: HEAP on the current `@`, WORK home over counter
    b.add_rule(land, RuleSpec::new().on(HEAP, Some(AT), None, Move::S), dloop);
    b.add_rule(land, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::S), missing); // empty heap
    // Decrement loop. `dec_work` is a WORK-only walk (no HEAP rule), so the HEAP head stays PARKED on the
    // current `@` across the decrement. The loop head `dloop` is re-entered on the advance back-edge (one
    // loop state, not one per cell); it is always entered with the counter still positive.
    let after_dec = dec_work(b, dloop, &format!("{base}.dc"));
    b.add_rule(after_dec, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S), found); // counter drained -> target
    let advance = b.state(format!("{base}.av"));
    b.add_rule(after_dec, RuleSpec::new().on(WORK, Some(MARK), None, Move::S), advance); // still positive -> advance
    // Advance to the next cell: step right off the current `@`, walk right over the head/tail field
    // (`MARK`/`SEP`); the next `@` loops back, the top blank means we ran off the cells -> `missing`.
    let adv = b.state(format!("{base}.aw"));
    b.add_rule(advance, RuleSpec::new().on(HEAP, Some(AT), None, Move::R), adv); // off the current `@`
    b.add_rule(adv, RuleSpec::new().on(HEAP, Some(MARK), None, Move::R), adv);
    b.add_rule(adv, RuleSpec::new().on(HEAP, Some(SEP), None, Move::R), adv);
    b.add_rule(adv, RuleSpec::new().on(HEAP, Some(AT), None, Move::S), dloop); // next cell -> loop back
    b.add_rule(adv, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::S), missing); // ran off the top
}

/// Copy the head field of the cell under the HEAP head into WORK, then restore the HEAP top. `from`:
/// HEAP head on a cell's `@`, WORK **empty** at home (the seek's `found` exit drains the counter to 0),
/// REG home. Steps right off the `@`, copies each head `MARK` into WORK to the head/tail `#`, then walks
/// right over ALL remaining `MARK`/`SEP`/`AT` to the top blank and rewinds WORK home. On exit WORK holds
/// the head-word at home and the HEAP head is back at the top. Returns the exit state.
fn heap_read_head_to_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let copy = b.state(format!("{label}.cp"));
    b.add_rule(from, RuleSpec::new().on(HEAP, Some(AT), None, Move::R), copy); // off the `@` onto the head field
    // Copy each head mark into WORK (both heads advance R); the head/tail `#` ends the field.
    b.add_rule(copy, RuleSpec::new().on(HEAP, Some(MARK), None, Move::R).on(WORK, None, Some(MARK), Move::R), copy);
    let restore = b.state(format!("{label}.rs"));
    b.add_rule(copy, RuleSpec::new().on(HEAP, Some(SEP), None, Move::S), restore); // on the `#` -> done copying
    // Restore the HEAP top: walk right over this cell's `#` + tail marks and any later cells to the top.
    b.add_rule(restore, RuleSpec::new().on(HEAP, Some(MARK), None, Move::R), restore);
    b.add_rule(restore, RuleSpec::new().on(HEAP, Some(SEP), None, Move::R), restore);
    b.add_rule(restore, RuleSpec::new().on(HEAP, Some(AT), None, Move::R), restore);
    let at_top = b.state(format!("{label}.tp"));
    b.add_rule(restore, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::S), at_top); // top blank -> done
    rewind_work(b, at_top, &format!("{label}.rw")) // WORK head on its trailing blank -> home w/ the value
}

/// Copy the tail field of the cell under the HEAP head into WORK, then restore the HEAP top. `from`:
/// HEAP head on a cell's `@`, WORK **empty** at home, REG home. Steps right off the `@`, skips the head
/// marks to the `#`, steps off the `#`, then copies each tail `MARK` into WORK — stopping at the next
/// `@` (a following cell) or the top blank (the last cell). Then walks right over any later cells to the
/// top and rewinds WORK home. A zero-width tail copies nothing (WORK stays empty -> decodes to 0). On
/// exit WORK holds the tail-word at home and the HEAP head is back at the top. Returns the exit state.
fn heap_read_tail_to_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let skip = b.state(format!("{label}.sk"));
    b.add_rule(from, RuleSpec::new().on(HEAP, Some(AT), None, Move::R), skip); // off the `@` onto the head field
    b.add_rule(skip, RuleSpec::new().on(HEAP, Some(MARK), None, Move::R), skip); // skip head marks
    let copy = b.state(format!("{label}.cp"));
    b.add_rule(skip, RuleSpec::new().on(HEAP, Some(SEP), None, Move::R), copy); // off the `#` onto the tail field
    // Copy each tail mark into WORK (both heads advance R); the next `@` or the top blank ends the field.
    b.add_rule(copy, RuleSpec::new().on(HEAP, Some(MARK), None, Move::R).on(WORK, None, Some(MARK), Move::R), copy);
    let restore = b.state(format!("{label}.rs"));
    let at_top = b.state(format!("{label}.tp"));
    b.add_rule(copy, RuleSpec::new().on(HEAP, Some(AT), None, Move::S), restore); // next cell -> restore the top
    b.add_rule(copy, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::S), at_top); // last cell -> already at top
    // Restore the HEAP top: walk right over any later cells to the top blank.
    b.add_rule(restore, RuleSpec::new().on(HEAP, Some(AT), None, Move::R), restore);
    b.add_rule(restore, RuleSpec::new().on(HEAP, Some(MARK), None, Move::R), restore);
    b.add_rule(restore, RuleSpec::new().on(HEAP, Some(SEP), None, Move::R), restore);
    b.add_rule(restore, RuleSpec::new().on(HEAP, Some(BLANK), None, Move::S), at_top); // top blank -> done
    rewind_work(b, at_top, &format!("{label}.rw")) // WORK head on its trailing blank (or home if empty) -> home
}

/// Parse a HEAP tape snapshot into 1-based cons cells `(head, tail)` mark-counts. Marker-delimited (scan
/// `@`), so it is robust to blanks left of the origin (`Tape::snapshot`'s cell 0 is not necessarily the
/// origin). Shared by production decode (`decode.rs::decode_tape`) and this module's tests.
pub(crate) fn parse_heap_cells(cells: &[Symbol]) -> Vec<(u64, u64)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < cells.len() {
        if cells[i] == AT {
            let mut j = i + 1;
            let h = {
                let s = j;
                while j < cells.len() && cells[j] == MARK {
                    j += 1;
                }
                (j - s) as u64
            };
            if j < cells.len() && cells[j] == SEP {
                j += 1;
            }
            let t = {
                let s = j;
                while j < cells.len() && cells[j] == MARK {
                    j += 1;
                }
                (j - s) as u64
            };
            out.push((h, t));
            i = j;
        } else {
            i += 1;
        }
    }
    out
}

// ---- BOX tape sub-primitives (free functions; blank-padded fixed-width fields; rest at the ORIGIN) ----
//
// The BOX holds `# <field1> # <field2> # …`, each `<fieldi>` EXACTLY `FIELD_WIDTH` cells (the value's
// marks left-justified, blank-padded), each preceded by a `#`. There is NO trailing `#` after the last
// field — the blank "top" follows the last field's `FIELD_WIDTH` cells. A 1-based pointer `p` addresses
// field `p`. BETWEEN box gadgets the BOX head rests on the leading `#` (the ORIGIN); an empty box rests
// at cell 0 over blanks (origin == top).
//
// Why NOT heap-style blank-boundary navigation: a box value may be 0 (a captured counter), so a field can
// be `FIELD_WIDTH` blanks — interior padding blanks are then INDISTINGUISHABLE from the origin-left / top
// blanks by a single read (a naive "walk to the first blank" stops on padding, not the boundary). So BOX
// navigation is CONTENT-BLIND and FIXED-WIDTH: to cross one field the head moves EXACTLY `FIELD_WIDTH + 1`
// cells (over the `#` and the window), landing on the boundary (`#` or the top blank), which IS then
// distinguishable. Rightward walks detect the top by a blank landing; leftward returns are
// COUNTER-BOUNDED by the pointer (cross exactly `p` fields), so no blank-run probing is ever needed.

/// From the BOX head ON a `#` (a field's leading delimiter), move right EXACTLY `FIELD_WIDTH + 1` cells
/// (off the `#`, over the field's `FIELD_WIDTH` window), landing on the boundary immediately after the
/// field — the next `#` or the top blank. Content-blind (wildcard reads), so a zero-valued (all-blank)
/// field is crossed exactly like any other. Returns the boundary state (the caller branches on `#`/blank).
fn box_skip_field_right(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let mut cur = from;
    for k in 0..=FIELD_WIDTH {
        let nxt = b.state(format!("{label}.sr{k}"));
        b.add_rule(cur, RuleSpec::new().on(BOX, None, None, Move::R), nxt);
        cur = nxt;
    }
    cur // on the boundary (`#` or top blank)
}

/// The leftward mirror of `box_skip_field_right`: from the BOX head ON a `#` (or on the top blank), move
/// left EXACTLY `FIELD_WIDTH + 1` cells, landing on the previous field's leading `#` (or, from the top, on
/// the last field's leading `#`). Content-blind. Returns the landing state.
fn box_skip_field_left(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let mut cur = from;
    for k in 0..=FIELD_WIDTH {
        let nxt = b.state(format!("{label}.sl{k}"));
        b.add_rule(cur, RuleSpec::new().on(BOX, None, None, Move::L), nxt);
        cur = nxt;
    }
    cur // on the previous `#`
}

/// Append a new field holding WORK's value at the BOX top. `from`: BOX head at the top (a BLANK — cell 0
/// if the box is empty, else after the last field), WORK at home over the value's marks. Writes the
/// leading `#`, then the `FIELD_WIDTH` window (one MARK per WORK mark, then blank-pad to `FIELD_WIDTH`),
/// leaving the head on the new top blank; then rewinds WORK home (marks INTACT). Mirrors
/// `heap_open_cell_with_work` crossed with `write_literal`'s fixed-width padding.
fn box_append_field(b: &mut Builder, from: StateId, label: &str) -> StateId {
    // Write the field's leading `#` and step onto window cell 0.
    let mut cur = b.state(format!("{label}.w0"));
    b.add_rule(from, RuleSpec::new().on(BOX, None, Some(SEP), Move::R), cur);
    // Fixed-width window: FIELD_WIDTH cells. MARK arm copies a WORK mark (both heads R); once WORK is
    // exhausted the BLANK arm pads (BOX writes a blank, advances; WORK stays on its trailing blank).
    for k in 0..FIELD_WIDTH {
        let nxt = b.state(format!("{label}.w{}", k + 1));
        b.add_rule(cur, RuleSpec::new().on(WORK, Some(MARK), None, Move::R).on(BOX, None, Some(MARK), Move::R), nxt);
        b.add_rule(cur, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S).on(BOX, None, Some(BLANK), Move::R), nxt);
        cur = nxt;
    }
    // `cur` is on the new top blank; WORK head rests on its trailing blank -> home, marks intact.
    rewind_work(b, cur, label)
}

/// Count the BOX's fields into WORK and leave the head at the top. `from`: BOX at the origin (on the
/// leading `#`, or cell 0 over blanks if empty), WORK home. Clears WORK; if empty the count is 0; else
/// walks right field-by-field, writing one WORK mark per `#` (content-blind `FIELD_WIDTH + 1` skips
/// between `#`s), stopping when a skip lands on the top blank. On exit WORK is home holding the field
/// count and the BOX head is at the top. Structurally `heap_count_cells_to_work` over fixed-width fields.
fn box_count_fields_to_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let cleared = clear_work(b, from, &format!("{label}.cl")); // WORK empty+home; BOX at origin
    let done = b.state(format!("{label}.done"));
    let at_hash = b.state(format!("{label}.ah")); // BOX on a `#`, WORK at the accumulator's tail
    // Empty box (origin reads blank) -> count 0; else start counting on the first `#`.
    b.add_rule(cleared, RuleSpec::new().on(BOX, Some(BLANK), None, Move::S), done);
    b.add_rule(cleared, RuleSpec::new().on(BOX, Some(SEP), None, Move::S), at_hash);
    // Count this `#` (write a WORK mark, advance WORK; BOX stays on the `#`), then skip the field right.
    let after = b.state(format!("{label}.am"));
    b.add_rule(at_hash, RuleSpec::new().on(WORK, None, Some(MARK), Move::R), after);
    let boundary = box_skip_field_right(b, after, &format!("{label}.s"));
    b.add_rule(boundary, RuleSpec::new().on(BOX, Some(SEP), None, Move::S), at_hash); // another field
    let top = b.state(format!("{label}.top"));
    b.add_rule(boundary, RuleSpec::new().on(BOX, Some(BLANK), None, Move::S), top); // reached the top
    let homed = rewind_work(b, top, &format!("{label}.rw")); // WORK head on its tail -> home w/ the count
    b.add_rule(homed, RuleSpec::new(), done);
    done // BOX at the top, WORK home = field count
}

/// Runtime-seek the field the counter in WORK addresses, a two-exit gadget (like `heap_seek_cell`).
/// PRECONDITION: BOX at the origin (on the leading `#`, or cell 0 over blanks if empty); WORK home holds
/// the 1-based counter `p`; REG home. Walks right field-by-field, decrementing `p` once per `#`; when it
/// drains, steps right onto the target field's first cell -> `found` (BOX on that cell, WORK empty home).
/// `missing`: `p == 0`, an empty box, or a skip that runs off onto the top blank (`p` exceeds the field
/// count) — the caller routes it to the rule-less `fault` spin. Content-blind skips, so a zero-valued
/// field is sought exactly like any other.
fn box_seek_field(b: &mut Builder, from: StateId, found: StateId, missing: StateId, label: &str) {
    let loop_head = b.state(format!("{label}.lp")); // BOX on a `#`, WORK home = remaining counter (>= 1)
    // Entry routing (disjoint reads, so order is immaterial): empty box, or p == 0, both -> missing.
    b.add_rule(from, RuleSpec::new().on(BOX, Some(BLANK), None, Move::S), missing); // empty box
    b.add_rule(from, RuleSpec::new().on(BOX, Some(SEP), None, Move::S).on(WORK, Some(BLANK), None, Move::S), missing); // p == 0
    b.add_rule(from, RuleSpec::new().on(BOX, Some(SEP), None, Move::S).on(WORK, Some(MARK), None, Move::S), loop_head);
    // Loop head: decrement the counter (WORK-only walk, so BOX stays PARKED on the current `#`).
    let dec = dec_work(b, loop_head, &format!("{label}.dc"));
    // Drained -> this `#`'s field is the target: step BOX right onto its first cell.
    b.add_rule(dec, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S).on(BOX, None, None, Move::R), found);
    let adv = b.state(format!("{label}.av"));
    b.add_rule(dec, RuleSpec::new().on(WORK, Some(MARK), None, Move::S), adv); // still positive -> advance
    let boundary = box_skip_field_right(b, adv, &format!("{label}.s"));
    b.add_rule(boundary, RuleSpec::new().on(BOX, Some(SEP), None, Move::S), loop_head); // next field -> loop
    b.add_rule(boundary, RuleSpec::new().on(BOX, Some(BLANK), None, Move::S), missing); // ran off the top
}

/// Copy the marks of the field under the BOX head into WORK, then restore the head to the field's first
/// cell. `from`: BOX on the field's first cell, WORK empty at home. Copies leading `MARK`s to WORK,
/// stopping at the first padding blank; then walks left over the field's content to the field's leading
/// `#` and steps right back onto the first cell; then rewinds WORK home. On exit WORK is home holding the
/// value and the BOX head is back on the field's first cell.
fn box_read_field_to_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let cp = b.state(format!("{label}.cp"));
    b.add_rule(from, RuleSpec::new(), cp);
    b.add_rule(cp, RuleSpec::new().on(BOX, Some(MARK), None, Move::R).on(WORK, None, Some(MARK), Move::R), cp);
    let back = b.state(format!("{label}.bk"));
    b.add_rule(cp, RuleSpec::new().on(BOX, Some(BLANK), None, Move::L), back); // first padding blank -> step left
    b.add_rule(back, RuleSpec::new().on(BOX, Some(MARK), None, Move::L), back); // walk left over the marks
    let first = b.state(format!("{label}.fc"));
    b.add_rule(back, RuleSpec::new().on(BOX, Some(SEP), None, Move::R), first); // leading `#` -> onto first cell
    rewind_work(b, first, label) // WORK head on its tail (or home if the value was 0) -> home w/ the value
}

/// Overwrite the field under the BOX head with WORK's marks, IN PLACE (the `#` delimiters never move).
/// `from`: BOX on the field's first cell, WORK home over the new value's marks. Writes one MARK per WORK
/// mark (both heads R), then blanks any leftover old marks (BOX `MARK -> BLANK`, R) up to the first blank;
/// then walks left over the field's content to the leading `#` and steps right onto the first cell; then
/// rewinds WORK home. Bounded by the field's own content (value `< FIELD_WIDTH` guarantees a padding
/// blank), so it never needs a trailing delimiter and never spills into the next field.
fn box_overwrite_field(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let wr = b.state(format!("{label}.wr"));
    b.add_rule(from, RuleSpec::new(), wr);
    b.add_rule(wr, RuleSpec::new().on(WORK, Some(MARK), None, Move::R).on(BOX, None, Some(MARK), Move::R), wr);
    let blank = b.state(format!("{label}.bl"));
    b.add_rule(wr, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S), blank); // WORK done -> blank the leftovers
    b.add_rule(blank, RuleSpec::new().on(BOX, Some(MARK), Some(BLANK), Move::R), blank); // erase a leftover old mark
    let restore = b.state(format!("{label}.rs"));
    b.add_rule(blank, RuleSpec::new().on(BOX, Some(BLANK), None, Move::S), restore); // first padding blank -> done
    // Restore to the field's first cell: walk left over the content (marks and blanks) to the leading `#`.
    b.add_rule(restore, RuleSpec::new().on(BOX, Some(MARK), None, Move::L), restore);
    b.add_rule(restore, RuleSpec::new().on(BOX, Some(BLANK), None, Move::L), restore);
    let first = b.state(format!("{label}.fc"));
    b.add_rule(restore, RuleSpec::new().on(BOX, Some(SEP), None, Move::R), first); // leading `#` -> onto first cell
    rewind_work(b, first, label) // WORK head on its tail -> home, marks intact
}

/// Return the BOX head from a field's leading `#` to the origin, CONSUMING the counter in WORK. `from`:
/// BOX on a `#` (field `p`'s leading `#`), WORK home over the counter `= p`, REG home. Decrements the
/// counter and, while it stays positive, skips one field left per decrement — so exactly `p - 1` leftward
/// field-skips land the head on the leading `#` (the origin). Counter-bounded, so it never has to detect
/// the origin-left blank. On exit the BOX head is on the leading `#` and WORK is empty at home.
fn box_return_to_origin(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let dec = dec_work(b, from, &format!("{label}.dc")); // WORK <- counter - 1, WORK home
    let done = b.state(format!("{label}.done"));
    b.add_rule(dec, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S), done); // drained -> on the origin `#`
    let more = b.state(format!("{label}.more"));
    b.add_rule(dec, RuleSpec::new().on(WORK, Some(MARK), None, Move::S), more); // still positive -> skip left
    let prev = box_skip_field_left(b, more, &format!("{label}.s"));
    b.add_rule(prev, RuleSpec::new(), from); // back-edge: loop with the BOX head on the previous `#`
    done
}

/// Increment WORK's mark-count by one (WORK home over marks, possibly empty). Walks right to the marks'
/// trailing blank, writes one mark, then rewinds home. Used to turn a field count into its 1-based pointer.
fn inc_work(b: &mut Builder, from: StateId, label: &str) -> StateId {
    b.add_rule(from, RuleSpec::new().on(WORK, Some(MARK), None, Move::R), from); // walk right over the marks
    let wrote = b.state(format!("{label}.iw"));
    b.add_rule(from, RuleSpec::new().on(WORK, Some(BLANK), Some(MARK), Move::R), wrote); // write the new mark
    rewind_work(b, wrote, label) // WORK head on its trailing blank -> home, marks intact
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

    fn init_reg(&self, slots: u32) -> Vec<Symbol> {
        // Fixed-width all-zero bank: `#` then (FIELD_WIDTH blanks + `#`) per field.
        let mut cells = vec![SEP];
        for _ in 0..slots {
            cells.extend(std::iter::repeat_n(BLANK, FIELD_WIDTH));
            cells.push(SEP);
        }
        cells
    }

    fn mov(&self, b: &mut Builder, entry: StateId, exit: StateId, rs: Slot, rd: Slot) {
        // WORK <- rs (clears WORK, copies its marks); rd <- WORK (blanks rd's window, rewrites). Both
        // sub-primitives restore the home convention, so this composes. `rs == rd` round-trips the
        // same value through WORK -> identity.
        let l = format!("mv{rd}s{entry}"); // `entry` (fresh per call site) uniquifies derived states
        let after_copy = copy_field_to_work(b, entry, rs, &format!("{l}.c"));
        let after_wr = append_work_to_field(b, after_copy, rd, &format!("{l}.d"));
        b.add_rule(after_wr, RuleSpec::new(), exit);
    }

    fn jz(&self, b: &mut Builder, entry: StateId, if_zero: StateId, if_nonzero: StateId, r: Slot) {
        // Seek field r; its first cell is a MARK (nonzero) or a BLANK (zero, all padding). Each branch
        // rewinds REG home to its own exit. rewind_home's precondition (head inside the field, not on
        // its trailing `#`) holds: the first cell is a mark or an interior padding blank.
        let l = format!("jz{r}s{entry}"); // `entry` (fresh per call site) uniquifies derived states
        let at = seek_slot(b, entry, r, &format!("{l}.s")); // REG on field r's first cell
        let nz = b.state(format!("{l}.nz"));
        b.add_rule(at, RuleSpec::new().on(REG, Some(MARK), None, Move::S), nz);
        let z = b.state(format!("{l}.z"));
        b.add_rule(at, RuleSpec::new().on(REG, Some(BLANK), None, Move::S), z);
        let home_nz = rewind_home(b, nz, r, &format!("{l}.rn"));
        b.add_rule(home_nz, RuleSpec::new(), if_nonzero);
        let home_z = rewind_home(b, z, r, &format!("{l}.rz"));
        b.add_rule(home_z, RuleSpec::new(), if_zero);
    }

    fn push_frame(&self, b: &mut Builder, entry: StateId, exit: StateId, n_loc: u32, tag: u64) {
        let base = format!("pf{entry}"); // `entry` uniquifies derived state names across call sites
        // Tag at the frame bottom (pushed first).
        let mut cur = stack_push_literal(b, entry, tag, &format!("{base}.tag"));
        // Then Loc0..Loc_{n_loc-1} (slots 1..=n_loc), in order, above the tag.
        for slot in 1..=n_loc {
            let after_copy = copy_field_to_work(b, cur, slot, &format!("{base}.c{slot}"));
            cur = stack_push_work(b, after_copy, &format!("{base}.s{slot}"));
        }
        b.add_rule(cur, RuleSpec::new(), exit);
    }

    fn pop_frame_restore(&self, b: &mut Builder, entry: StateId, exit: StateId, n_loc: u32) {
        let base = format!("rf{entry}");
        let mut cur = entry;
        // The top field is Loc_{n_loc-1} (slot n_loc); pop down to Loc0 (slot 1).
        for slot in (1..=n_loc).rev() {
            let after_pop = stack_pop_work(b, cur, &format!("{base}.p{slot}")); // WORK <- Loc_{slot-1}
            cur = append_work_to_field(b, after_pop, slot, &format!("{base}.w{slot}")); // REG slot <- WORK
        }
        b.add_rule(cur, RuleSpec::new(), exit);
    }

    fn dispatch_tag(&self, b: &mut Builder, entry: StateId, exits: &[StateId]) {
        // Defensive: nothing to route to. Leave `entry` rule-less so the machine just halts there
        // (well-formed programs always have >= 1 call site, so this arm never fires in practice).
        let k = exits.len();
        if k == 0 {
            return;
        }
        let base = format!("dt{entry}"); // `entry` (fresh per call site) uniquifies derived state names
        // From `entry` (STACK head on the top blank, right of the tag's `#`): step left onto that `#`.
        let on_hash = b.state(format!("{base}.oh"));
        b.add_rule(entry, RuleSpec::new().on(STACK, Some(BLANK), None, Move::L), on_hash);
        // Erase the tag's `#` and step left onto the tag's marks (or straight onto the boundary if c=0),
        // entering the walk chain at `e_0`. The chain is `e_0..=e_K` (K+1 states); the count of marks the
        // walk erases before hitting the boundary is the tag `c`.
        let e: Vec<StateId> = (0..=k).map(|j| b.state(format!("{base}.e{j}"))).collect();
        b.add_rule(on_hash, RuleSpec::new().on(STACK, Some(SEP), Some(BLANK), Move::L), e[0]);
        // `e_j` reads the STACK head; the three arms have DISJOINT reads, so rule order is immaterial.
        // MARK -> erase it, step L, advance to `e_{j+1}` (`e_K` self-loops, clamping counts >= K).
        // A boundary (`#` of the frame below, OR the origin blank) means the tag count was `j`: step R to
        // the new top and fan out to `exits[min(j, K-1)]` (the clamp keeps a `c >= K` tag in range).
        for j in 0..=k {
            let next = e[(j + 1).min(k)];
            b.add_rule(e[j], RuleSpec::new().on(STACK, Some(MARK), Some(BLANK), Move::L), next);
            let exit = exits[j.min(k - 1)];
            b.add_rule(e[j], RuleSpec::new().on(STACK, Some(SEP), None, Move::R), exit); // frame `#` below
            b.add_rule(e[j], RuleSpec::new().on(STACK, Some(BLANK), None, Move::R), exit); // origin blank
        }
    }

    fn cons(&self, b: &mut Builder, entry: StateId, exit: StateId, rh: Slot, rt: Slot, rd: Slot) {
        let base = format!("cons{entry}");
        let cw_h = copy_field_to_work(b, entry, rh, &format!("{base}.h")); // WORK <- rh (head)
        let open = heap_open_cell_with_work(b, cw_h, &format!("{base}.oc")); // @ head #
        let cw_t = copy_field_to_work(b, open, rt, &format!("{base}.t")); // WORK <- rt (tail ptr)
        let tail = heap_append_work(b, cw_t, &format!("{base}.aw")); // ... tail
        let count = heap_count_cells_to_work(b, tail, &format!("{base}.cc")); // WORK <- cell count = ptr
        let wr = append_work_to_field(b, count, rd, &format!("{base}.wr")); // rd <- ptr
        b.add_rule(wr, RuleSpec::new(), exit);
    }

    fn is_empty_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot) {
        let base = format!("ie{entry}");
        let cw = copy_field_to_work(b, entry, rl, &format!("{base}.c")); // WORK <- rl
        let z = is_zero_work(b, cw, &format!("{base}.z")); // WORK <- (rl == 0)
        let wr = append_work_to_field(b, z, rd, &format!("{base}.wr")); // rd <- bool
        b.add_rule(wr, RuleSpec::new(), exit);
    }

    fn head_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot) {
        let base = format!("hd{entry}");
        let cw = copy_field_to_work(b, entry, rl, &format!("{base}.p")); // WORK <- P (pointer)
        let fault = b.state(format!("{base}.fault"));
        // A runtime fault (nil / dangling deref) has NO value: spin here forever so the machine hits the
        // step cap (HitCap), matching λ's Ω-divergence and the reference's Runtime error — the three-way
        // oracle treats all three "no value" outcomes alike. `RuleSpec::new()` reads wildcards / writes
        // nothing / all Stay, so it always matches and never halts (sim has no fixed-point detector).
        b.add_rule(fault, RuleSpec::new(), fault);
        let seek = b.state(format!("{base}.sk"));
        b.add_rule(cw, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S), fault); // P == 0 -> nil fault
        b.add_rule(cw, RuleSpec::new().on(WORK, Some(MARK), None, Move::S), seek); // P >= 1 -> seek
        let found = b.state(format!("{base}.fd"));
        heap_seek_cell(b, seek, found, fault);
        let read = heap_read_head_to_work(b, found, &format!("{base}.rh")); // WORK <- head-word
        let wr = append_work_to_field(b, read, rd, &format!("{base}.wr")); // rd <- head-word
        b.add_rule(wr, RuleSpec::new(), exit);
    }

    fn tail_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot) {
        let base = format!("tl{entry}");
        let cw = copy_field_to_work(b, entry, rl, &format!("{base}.p"));
        let fault = b.state(format!("{base}.fault"));
        // A runtime fault (nil / dangling deref) has NO value: spin here forever so the machine hits the
        // step cap (HitCap), matching λ's Ω-divergence and the reference's Runtime error — the three-way
        // oracle treats all three "no value" outcomes alike. `RuleSpec::new()` reads wildcards / writes
        // nothing / all Stay, so it always matches and never halts (sim has no fixed-point detector).
        b.add_rule(fault, RuleSpec::new(), fault);
        let seek = b.state(format!("{base}.sk"));
        b.add_rule(cw, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S), fault);
        b.add_rule(cw, RuleSpec::new().on(WORK, Some(MARK), None, Move::S), seek);
        let found = b.state(format!("{base}.fd"));
        heap_seek_cell(b, seek, found, fault);
        let read = heap_read_tail_to_work(b, found, &format!("{base}.rt")); // WORK <- tail-word
        let wr = append_work_to_field(b, read, rd, &format!("{base}.wr"));
        b.add_rule(wr, RuleSpec::new(), exit);
    }

    fn box_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rv: Slot, rd: Slot) {
        let base = format!("box{entry}");
        // 1. Count the current fields (BOX -> top, WORK = N); 2. the new pointer is N + 1.
        let counted = box_count_fields_to_work(b, entry, &format!("{base}.ct"));
        let ptr = inc_work(b, counted, &format!("{base}.in")); // WORK = N + 1; BOX at top
        // 3. Write the pointer into `rd` (only touches REG/WORK; BOX stays at the top).
        let wrote = append_work_to_field(b, ptr, rd, &format!("{base}.wp")); // rd = N + 1
        // 4. Load `rv`'s value; 5. append the new field at the top.
        let clr = clear_work(b, wrote, &format!("{base}.c1"));
        let val = copy_field_to_work(b, clr, rv, &format!("{base}.cv")); // WORK = value; BOX at top
        let appended = box_append_field(b, val, &format!("{base}.ap")); // BOX at the NEW top; WORK = value
        // 6. Reload the pointer as the return counter; 7. walk the head back to the origin.
        let clr2 = clear_work(b, appended, &format!("{base}.c2"));
        let cnt = copy_field_to_work(b, clr2, rd, &format!("{base}.cc")); // WORK = N + 1; BOX at new top
        let last_hash = box_skip_field_left(b, cnt, &format!("{base}.tl")); // new top -> last field's `#`
        let origin = box_return_to_origin(b, last_hash, &format!("{base}.ro")); // -> origin, WORK drained
        b.add_rule(origin, RuleSpec::new(), exit);
    }

    fn box_get_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rb: Slot, rd: Slot) {
        let base = format!("bget{entry}");
        let cw = copy_field_to_work(b, entry, rb, &format!("{base}.p")); // WORK = p (the pointer/counter)
        let fault = b.state(format!("{base}.fault"));
        // A nil/dangling deref has NO value: spin here so the machine hits the step cap (HitCap), matching
        // λ's Ω-divergence and the reference's Runtime error — the three-way oracle treats them alike.
        b.add_rule(fault, RuleSpec::new(), fault);
        let found = b.state(format!("{base}.fd"));
        box_seek_field(b, cw, found, fault, &format!("{base}.sk")); // found: BOX on the field's first cell
        let read = box_read_field_to_work(b, found, &format!("{base}.rd")); // WORK = value; BOX on first cell
        let wrote = append_work_to_field(b, read, rd, &format!("{base}.wr")); // rd = value; BOX on first cell
        // Reload the pointer as the return counter, step onto the field's `#`, return to the origin.
        let clr = clear_work(b, wrote, &format!("{base}.cl"));
        let cnt = copy_field_to_work(b, clr, rb, &format!("{base}.cc")); // WORK = p; BOX on first cell
        let on_hash = b.state(format!("{base}.oh"));
        b.add_rule(cnt, RuleSpec::new().on(BOX, None, None, Move::L), on_hash); // first cell -> field's `#`
        let origin = box_return_to_origin(b, on_hash, &format!("{base}.ro"));
        b.add_rule(origin, RuleSpec::new(), exit);
    }

    fn box_set_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rb: Slot, rv: Slot) {
        let base = format!("bset{entry}");
        let cw = copy_field_to_work(b, entry, rb, &format!("{base}.p")); // WORK = p (the pointer/counter)
        let fault = b.state(format!("{base}.fault"));
        b.add_rule(fault, RuleSpec::new(), fault); // nil/dangling -> spin -> HitCap (as box_get_op)
        let found = b.state(format!("{base}.fd"));
        box_seek_field(b, cw, found, fault, &format!("{base}.sk")); // found: BOX on the field's first cell
        // Reuse the counter slot: load `rv`'s NEW value, overwrite the field in place.
        let clr = clear_work(b, found, &format!("{base}.c1"));
        let val = copy_field_to_work(b, clr, rv, &format!("{base}.cv")); // WORK = new value; BOX on first cell
        let over = box_overwrite_field(b, val, &format!("{base}.ov")); // in place; BOX back on first cell
        // Reload the pointer as the return counter, step onto the field's `#`, return to the origin.
        let clr2 = clear_work(b, over, &format!("{base}.c2"));
        let cnt = copy_field_to_work(b, clr2, rb, &format!("{base}.cc")); // WORK = p; BOX on first cell
        let on_hash = b.state(format!("{base}.oh"));
        b.add_rule(cnt, RuleSpec::new().on(BOX, None, None, Move::L), on_hash); // first cell -> field's `#`
        let origin = box_return_to_origin(b, on_hash, &format!("{base}.ro"));
        b.add_rule(origin, RuleSpec::new(), exit);
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
        let init_reg = enc.init_reg(slots);
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

    #[test]
    fn init_reg_lays_out_a_fixed_width_bank() {
        // `#` then (FIELD_WIDTH blanks + `#`) per slot; every field decodes to 0.
        let cells = Unary.init_reg(2);
        assert_eq!(cells.len(), 1 + 2 * (FIELD_WIDTH + 1));
        assert_eq!(cells[0], SEP);
        assert_eq!(Unary.decode_nat(&cells, 0), Some(0));
        assert_eq!(Unary.decode_nat(&cells, 1), Some(0));
        assert_eq!(Unary.decode_nat(&cells, 2), None); // no field past the trailing `#`
    }

    #[test]
    fn mov_copies_a_field() {
        // slot0 <- v; mov slot1 <- slot0; decode slot1 == v (and slot0 is unchanged).
        fn body(b: &mut Builder, e: StateId, x: StateId) {
            Unary.mov(b, e, x, 0, 1);
        }
        assert_eq!(run_gadget(2, &[(0, 5)], 1, body), Some(5));
        assert_eq!(run_gadget(2, &[(0, 0)], 1, body), Some(0));
        // Source is preserved by the copy.
        assert_eq!(run_gadget(2, &[(0, 3)], 0, body), Some(3));
    }

    #[test]
    fn mov_into_self_is_identity() {
        assert_eq!(run_gadget(1, &[(0, 4)], 0, |b, e, x| Unary.mov(b, e, x, 0, 0)), Some(4));
    }

    /// Build a 2-field machine: init slot0 <- `v`; `jz(slot0, zero_exit, nonzero_exit)`; the zero exit
    /// writes 7 into slot1, the nonzero exit writes 9. Decode slot1 to see which branch ran.
    fn run_jz(v: u64) -> Option<u64> {
        let enc = Unary;
        let mut b = Builder::new();
        let halt = b.accept("halt");
        let zero_exit = b.state("zexit");
        let nz_exit = b.state("nzexit");
        enc.write_literal(&mut b, zero_exit, halt, 7, 1);
        enc.write_literal(&mut b, nz_exit, halt, 9, 1);
        let jz_entry = b.state("jz");
        enc.jz(&mut b, jz_entry, zero_exit, nz_exit, 0);
        // Prepend: init slot0 <- v, flowing into the jz entry.
        let start = b.state("start");
        enc.write_literal(&mut b, start, jz_entry, v, 0);
        // Initial 2-field bank.
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(2);
        let m = b.finish(start);
        assert!(m.validate().is_empty(), "invalid machine: {:?}", m.validate());
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted, "jz machine did not halt");
        enc.decode_nat(&tapes[REG].snapshot().0, 1)
    }

    #[test]
    fn jz_branches_on_zero() {
        assert_eq!(run_jz(0), Some(7)); // zero -> zero_exit
        assert_eq!(run_jz(1), Some(9)); // nonzero -> nonzero_exit
        assert_eq!(run_jz(5), Some(9));
    }

    // ---- STACK tape sub-primitives ----

    /// Run a machine that does `body` over the STACK tape (REG/WORK seeded empty unless the body writes
    /// them), then return the STACK snapshot cells for inspection.
    fn run_stack(body: impl FnOnce(&mut Builder, StateId, StateId)) -> Vec<Symbol> {
        let mut b = Builder::new();
        let halt = b.accept("halt");
        let start = b.state("start");
        body(&mut b, start, halt);
        let m = b.finish(start);
        assert!(m.validate().is_empty(), "invalid machine: {:?}", m.validate());
        let init = vec![Vec::new(); TAPES]; // all tapes empty (STACK starts at home/blank)
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted, "stack gadget did not halt");
        tapes[STACK].snapshot().0
    }

    /// Count the marks of the `idx`-th `#`-terminated field in `cells` (STACK layout: `f0 # f1 # …`).
    fn stack_field(cells: &[Symbol], idx: usize) -> Option<u64> {
        let mut fields = cells.split(|&c| c == SEP);
        fields.nth(idx).map(|f| f.iter().filter(|&&c| c == MARK).count() as u64)
    }

    #[test]
    fn stack_push_literal_then_snapshot() {
        // push 3, push 0, push 2  ->  STACK = `1 1 1 # # 1 1 #`
        let cells = run_stack(|b, e, x| {
            let a = stack_push_literal(b, e, 3, "p0");
            let c = stack_push_literal(b, a, 0, "p1");
            let d = stack_push_literal(b, c, 2, "p2");
            b.add_rule(d, RuleSpec::new(), x);
        });
        assert_eq!(stack_field(&cells, 0), Some(3));
        assert_eq!(stack_field(&cells, 1), Some(0));
        assert_eq!(stack_field(&cells, 2), Some(2));
    }

    #[test]
    fn stack_push_then_pop_is_lifo() {
        // push 4 (literal), push 2 (literal); pop -> WORK==2, pop -> WORK==4; STACK empty.
        // Prove pops by writing the popped WORK value into a REG field and decoding it.
        let enc = Unary;
        let mut b = Builder::new();
        let halt = b.accept("halt");
        let p0 = b.state("p0");
        let a = stack_push_literal(&mut b, p0, 4, "a");
        let c = stack_push_literal(&mut b, a, 2, "b");
        let pop1 = stack_pop_work(&mut b, c, "pop1"); // WORK <- 2
        let w1 = append_work_to_field(&mut b, pop1, 0, "w1"); // REG slot0 <- 2
        let pop2 = stack_pop_work(&mut b, w1, "pop2"); // WORK <- 4
        let w2 = append_work_to_field(&mut b, pop2, 1, "w2"); // REG slot1 <- 4
        b.add_rule(w2, RuleSpec::new(), halt);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(2);
        let m = b.finish(p0);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        let reg = tapes[REG].snapshot().0;
        assert_eq!(enc.decode_nat(&reg, 0), Some(2), "first pop must be the last pushed (LIFO)");
        assert_eq!(enc.decode_nat(&reg, 1), Some(4));
        assert!(!tapes[STACK].snapshot().0.contains(&MARK), "STACK must hold no marks after popping all frames");
    }

    #[test]
    fn push_frame_saves_tag_then_locals_in_order() {
        // REG bank slots 0..3 = [Rr, Loc0=4, Loc1=2]; push_frame(n_loc=2, tag=1).
        // Expect STACK fields: [tag=1][Loc0=4][Loc1=2]  (tag at bottom, locals in slot order above it).
        let enc = Unary;
        let mut b = Builder::new();
        let halt = b.accept("halt");
        // Seed the Loc fields: slot1<-4, slot2<-2, then push_frame.
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        enc.write_literal(&mut b, s1, s2, 4, 1);
        let pf = b.state("pf");
        enc.write_literal(&mut b, s2, pf, 2, 2);
        enc.push_frame(&mut b, pf, halt, 2, 1);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(3);
        let m = b.finish(s1);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        let st = tapes[STACK].snapshot().0;
        assert_eq!(stack_field(&st, 0), Some(1), "tag at frame bottom");
        assert_eq!(stack_field(&st, 1), Some(4), "Loc0");
        assert_eq!(stack_field(&st, 2), Some(2), "Loc1");
        // REG Loc fields must be UNCHANGED by the save (copy, not move).
        assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 1), Some(4));
        assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 2), Some(2));
    }

    #[test]
    fn pop_frame_restore_recovers_clobbered_locals() {
        // Save [Loc0=4, Loc1=2] under tag=0; CLOBBER the REG Loc fields; restore; they come back.
        let enc = Unary;
        let mut b = Builder::new();
        let halt = b.accept("halt");
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        enc.write_literal(&mut b, s1, s2, 4, 1); // Loc0 = 4
        let pf = b.state("pf");
        enc.write_literal(&mut b, s2, pf, 2, 2); // Loc1 = 2
        let c1 = b.state("c1");
        enc.push_frame(&mut b, pf, c1, 2, 0); // frame: [tag=0][4][2]
        let c2 = b.state("c2");
        enc.write_literal(&mut b, c1, c2, 9, 1); // clobber Loc0 <- 9
        let rf = b.state("rf");
        enc.write_literal(&mut b, c2, rf, 9, 2); // clobber Loc1 <- 9
        enc.pop_frame_restore(&mut b, rf, halt, 2); // restore Loc0=4, Loc1=2
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(3);
        let m = b.finish(s1);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        let reg = tapes[REG].snapshot().0;
        assert_eq!(enc.decode_nat(&reg, 1), Some(4), "Loc0 restored");
        assert_eq!(enc.decode_nat(&reg, 2), Some(2), "Loc1 restored");
        // The tag field (0 marks) remains as the top STACK field; only the Loc fields were popped.
        assert_eq!(stack_field(&tapes[STACK].snapshot().0, 0), Some(0), "tag remains on top");
    }

    #[test]
    fn stack_is_empty_branches() {
        // Empty stack -> if_empty writes 7 to REG slot0; after a push, non-empty -> if_nonempty writes 9.
        fn check(pushes: u64) -> Option<u64> {
            let enc = Unary;
            let mut b = Builder::new();
            let halt = b.accept("halt");
            let e7 = b.state("e7");
            let e9 = b.state("e9");
            enc.write_literal(&mut b, e7, halt, 7, 0);
            enc.write_literal(&mut b, e9, halt, 9, 0);
            let start = b.state("start");
            // Optionally push one literal, then branch on empty.
            let after_push = if pushes > 0 { stack_push_literal(&mut b, start, 1, "pp") } else { start };
            stack_is_empty(&mut b, after_push, e7, e9);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = enc.init_reg(1);
            let m = b.finish(start);
            assert!(m.validate().is_empty(), "{:?}", m.validate());
            let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
            assert_eq!(status, Status::Halted);
            enc.decode_nat(&tapes[REG].snapshot().0, 0)
        }
        assert_eq!(check(0), Some(7), "empty stack -> if_empty");
        assert_eq!(check(1), Some(9), "non-empty stack -> if_nonempty");
    }

    #[test]
    fn dispatch_tag_routes_on_the_tag_count() {
        // Push a bare tag c (no locals), then dispatch to one of 3 exits, each writing a distinct literal.
        fn dispatch(c: u64) -> Option<u64> {
            let enc = Unary;
            let mut b = Builder::new();
            let halt = b.accept("halt");
            let x0 = b.state("x0");
            let x1 = b.state("x1");
            let x2 = b.state("x2");
            enc.write_literal(&mut b, x0, halt, 10, 0);
            enc.write_literal(&mut b, x1, halt, 11, 0);
            enc.write_literal(&mut b, x2, halt, 12, 0);
            let start = b.state("start");
            let after_push = stack_push_literal(&mut b, start, c, "tag"); // tag is the only/top field
            enc.dispatch_tag(&mut b, after_push, &[x0, x1, x2]);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = enc.init_reg(1);
            let m = b.finish(start);
            assert!(m.validate().is_empty(), "{:?}", m.validate());
            let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
            assert_eq!(status, Status::Halted);
            // The dispatched exit wrote 10/11/12; also assert the tag field was erased (STACK has no marks).
            assert!(!tapes[STACK].snapshot().0.contains(&MARK), "tag field must be erased after dispatch");
            enc.decode_nat(&tapes[REG].snapshot().0, 0)
        }
        assert_eq!(dispatch(0), Some(10)); // tag 0 -> exits[0]
        assert_eq!(dispatch(1), Some(11)); // tag 1 -> exits[1]
        assert_eq!(dispatch(2), Some(12)); // tag 2 -> exits[2]
    }

    // ---- HEAP tape sub-primitives ----

    /// Run a machine that does `body` over the HEAP tape (all tapes start empty), return the HEAP snapshot.
    fn run_heap(body: impl FnOnce(&mut Builder, StateId, StateId)) -> Vec<Symbol> {
        let mut b = Builder::new();
        let halt = b.accept("halt");
        let start = b.state("start");
        body(&mut b, start, halt);
        let m = b.finish(start);
        assert!(m.validate().is_empty(), "invalid machine: {:?}", m.validate());
        let init = vec![Vec::new(); TAPES];
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted, "heap gadget did not halt");
        tapes[HEAP].snapshot().0
    }

    #[test]
    fn heap_open_then_append_builds_one_cell() {
        // Open + append in ISOLATION over an otherwise-empty heap (no REG/count machinery). Stage WORK
        // = 3 by hand (`run_heap` seeds all tapes empty), open `@ 1 1 1 #`, then append an empty tail.
        let cells = run_heap(|b, start, halt| {
            // Write 3 marks onto WORK advancing R, then rewind the WORK head home over them.
            let mut cur = start;
            for i in 0..3 {
                let nxt = b.state(format!("seed.m{i}"));
                b.add_rule(cur, RuleSpec::new().on(WORK, None, Some(MARK), Move::R), nxt);
                cur = nxt;
            }
            let homed = rewind_work(b, cur, "seed");
            let opened = heap_open_cell_with_work(b, homed, "oc"); // @ 1 1 1 #
            let cleared = clear_work(b, opened, "cl"); // tail = 0
            let appended = heap_append_work(b, cleared, "aw"); // (empty tail)
            b.add_rule(appended, RuleSpec::new(), halt);
        });
        assert_eq!(parse_heap_cells(&cells), vec![(3, 0)], "one cell `@ 3 #` built with an empty tail");
    }

    #[test]
    fn heap_build_two_cells_and_count() {
        // Build cell1 = (3, 0), cell2 = (2, 1) by loading WORK via write-then-copy, then count == 2.
        // We stage WORK by writing a REG literal then copy_field_to_work (reusing merged primitives).
        let enc = Unary;
        let mut b = Builder::new();
        let halt = b.accept("halt");
        // reg slots: 0=3, 1=0, 2=2, 3=1 (heads/tails to store), slot 4 = where count lands.
        let mut cur = b.state("start");
        let start = cur;
        // Build cell1 head=3, tail=0.
        let s = b.state("s0");
        enc.write_literal(&mut b, cur, s, 3, 0);
        cur = s;
        let c0 = copy_field_to_work(&mut b, cur, 0, "cf0");
        let o0 = heap_open_cell_with_work(&mut b, c0, "oc0"); // @ 3 #
        // tail = 0
        let c1 = copy_field_to_work(&mut b, o0, 1, "cf1"); // slot1 = 0 (init blank field)
        let a0 = heap_append_work(&mut b, c1, "aw0"); // (empty tail)
        // Build cell2 head=2, tail=1.
        let s2 = b.state("s2");
        enc.write_literal(&mut b, a0, s2, 2, 2);
        let s3 = b.state("s3");
        enc.write_literal(&mut b, s2, s3, 1, 3);
        let c2 = copy_field_to_work(&mut b, s3, 2, "cf2");
        let o1 = heap_open_cell_with_work(&mut b, c2, "oc1"); // @ 2 #
        let c3 = copy_field_to_work(&mut b, o1, 3, "cf3");
        let a1 = heap_append_work(&mut b, c3, "aw1"); // 1
        // Count cells -> WORK -> slot 4.
        let cc = heap_count_cells_to_work(&mut b, a1, "cc");
        let wc = append_work_to_field(&mut b, cc, 4, "wc");
        b.add_rule(wc, RuleSpec::new(), halt);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(5);
        let m = b.finish(start);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(parse_heap_cells(&tapes[HEAP].snapshot().0), vec![(3, 0), (2, 1)], "two cells built in order");
        assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 4), Some(2), "cell count == 2");
    }

    #[test]
    fn cons_builds_a_cell_and_writes_the_pointer() {
        // slots: 0=head, 1=tail-ptr, 2=result-ptr. cons(rd=2, rh=0, rt=1).
        fn run_cons(head: u64, tail: u64) -> (Vec<(u64, u64)>, Option<u64>) {
            let enc = Unary;
            let mut b = Builder::new();
            let halt = b.accept("halt");
            let s0 = b.state("s0");
            let s1 = b.state("s1");
            enc.write_literal(&mut b, s0, s1, head, 0);
            let cn = b.state("cn");
            enc.write_literal(&mut b, s1, cn, tail, 1);
            enc.cons(&mut b, cn, halt, 0, 1, 2);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = enc.init_reg(3);
            let m = b.finish(s0);
            assert!(m.validate().is_empty(), "{:?}", m.validate());
            let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
            assert_eq!(status, Status::Halted);
            (parse_heap_cells(&tapes[HEAP].snapshot().0), enc.decode_nat(&tapes[REG].snapshot().0, 2))
        }
        // cons(7, nil=0): one cell (7,0), pointer 1.
        assert_eq!(run_cons(7, 0), (vec![(7, 0)], Some(1)));
        // cons(1, ptr=1): one cell (1,1), pointer 1 (heap starts empty each run).
        assert_eq!(run_cons(1, 1), (vec![(1, 1)], Some(1)));
    }

    #[test]
    fn is_empty_op_maps_zero_to_true() {
        // slot0 <- v; is_empty_op(rd=1, rl=0); decode slot1. v==0 -> 1, v>0 -> 0.
        fn run_ie(v: u64) -> Option<u64> {
            let enc = Unary;
            let mut b = Builder::new();
            let halt = b.accept("halt");
            let s0 = b.state("s0");
            let ie = b.state("ie");
            enc.write_literal(&mut b, s0, ie, v, 0); // slot0 <- v, flow into is_empty_op
            enc.is_empty_op(&mut b, ie, halt, 0, 1); // slot1 <- (slot0 == 0)
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = enc.init_reg(2);
            let m = b.finish(s0);
            assert!(m.validate().is_empty(), "{:?}", m.validate());
            let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
            assert_eq!(status, Status::Halted);
            enc.decode_nat(&tapes[REG].snapshot().0, 1)
        }
        assert_eq!(run_ie(0), Some(1));
        assert_eq!(run_ie(3), Some(0));
    }

    #[test]
    fn two_conses_get_sequential_pointers() {
        // cons(3, nil) -> ptr 1; then cons(2, ptr1) -> ptr 2. Heap = [(3,0), (2,1)].
        let enc = Unary;
        let mut b = Builder::new();
        let halt = b.accept("halt");
        // slot0=3, slot1=0(nil); cons -> slot2 (ptr1). slot3=2; cons(slot3, slot2) -> slot4 (ptr2).
        let s0 = b.state("s0");
        let s1 = b.state("s1");
        enc.write_literal(&mut b, s0, s1, 3, 0);
        let cn0 = b.state("cn0");
        enc.write_literal(&mut b, s1, cn0, 0, 1);
        let after0 = b.state("after0");
        enc.cons(&mut b, cn0, after0, 0, 1, 2); // slot2 = ptr to (3,0) = 1
        let s3 = b.state("s3");
        enc.write_literal(&mut b, after0, s3, 2, 3);
        enc.cons(&mut b, s3, halt, 3, 2, 4); // slot4 = ptr to (2, slot2) = 2
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(5);
        let m = b.finish(s0);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(parse_heap_cells(&tapes[HEAP].snapshot().0), vec![(3, 0), (2, 1)]);
        assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 2), Some(1));
        assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 4), Some(2));
    }

    /// Stage heap `[(7,0),(3,1)]` via `cons`, set WORK = `counter`, seek to that cell, and read its head
    /// (or tail) into slot 6. `found` -> the field value; `missing` (dangling) -> the sentinel 9. Returns
    /// the decoded slot 6.
    fn run_seek_read(counter: u64, read_tail: bool) -> Option<u64> {
        let enc = Unary;
        let mut b = Builder::new();
        let halt = b.accept("halt");
        // slots: 0=7, 1=0(nil), 2=p1, 3=3, 4=p2, 5=counter, 6=result.
        let s0 = b.state("s0");
        let s1 = b.state("s1");
        enc.write_literal(&mut b, s0, s1, 7, 0); // slot0 = 7
        let s2 = b.state("s2");
        enc.write_literal(&mut b, s1, s2, 0, 1); // slot1 = 0 (nil)
        let s3 = b.state("s3");
        enc.cons(&mut b, s2, s3, 0, 1, 2); // slot2 = cons(7, nil) = ptr 1 -> cell (7,0)
        let s4 = b.state("s4");
        enc.write_literal(&mut b, s3, s4, 3, 3); // slot3 = 3
        let s5 = b.state("s5");
        enc.cons(&mut b, s4, s5, 3, 2, 4); // slot4 = cons(3, ptr1) = ptr 2 -> cell (3,1)
        let s6 = b.state("s6");
        enc.write_literal(&mut b, s5, s6, counter, 5); // slot5 = counter
        let cw = copy_field_to_work(&mut b, s6, 5, "cnt"); // WORK <- counter
        let found = b.state("found");
        let missing = b.state("missing");
        heap_seek_cell(&mut b, cw, found, missing);
        // found -> read head/tail into WORK -> slot 6 -> halt.
        let read = if read_tail {
            heap_read_tail_to_work(&mut b, found, "rt")
        } else {
            heap_read_head_to_work(&mut b, found, "rh")
        };
        let wr = append_work_to_field(&mut b, read, 6, "wr");
        b.add_rule(wr, RuleSpec::new(), halt);
        // missing -> sentinel 9 -> slot 6 -> halt (9 is distinct from every real head/tail here and < FIELD_WIDTH).
        enc.write_literal(&mut b, missing, halt, 9, 6);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(7);
        let m = b.finish(s0);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        enc.decode_nat(&tapes[REG].snapshot().0, 6)
    }

    #[test]
    fn heap_seek_and_read_head_and_tail() {
        // cell 1 = (7, 0), cell 2 = (3, 1).
        assert_eq!(run_seek_read(1, false), Some(7)); // head of cell 1
        assert_eq!(run_seek_read(1, true), Some(0)); // tail of cell 1 (empty tail field -> 0)
        assert_eq!(run_seek_read(2, false), Some(3)); // head of cell 2
        assert_eq!(run_seek_read(2, true), Some(1)); // tail of cell 2
        // dangling: pointer 3 > 2 cells -> the seek misses -> sentinel 9.
        assert_eq!(run_seek_read(3, false), Some(9));
        assert_eq!(run_seek_read(3, true), Some(9));
    }

    #[test]
    fn head_op_and_tail_op_read_a_cell() {
        // Stage heap [(7,0),(3,1)] via cons (as in run_seek_read), then head_op/tail_op on a pointer slot.
        // slots: 0=7, 1=0(nil), 2=p1, 3=3, 4=p2(=2), 5=result.
        fn run_op(read_tail: bool, ptr_slot: Slot) -> Option<u64> {
            let enc = Unary;
            let mut b = Builder::new();
            let halt = b.accept("halt");
            let s0 = b.state("s0");
            let s1 = b.state("s1");
            enc.write_literal(&mut b, s0, s1, 7, 0);
            let s2 = b.state("s2");
            enc.write_literal(&mut b, s1, s2, 0, 1);
            let s3 = b.state("s3");
            enc.cons(&mut b, s2, s3, 0, 1, 2); // slot2 = ptr 1
            let s4 = b.state("s4");
            enc.write_literal(&mut b, s3, s4, 3, 3);
            let op = b.state("op");
            enc.cons(&mut b, s4, op, 3, 2, 4); // slot4 = ptr 2
            if read_tail {
                enc.tail_op(&mut b, op, halt, ptr_slot, 5);
            } else {
                enc.head_op(&mut b, op, halt, ptr_slot, 5);
            }
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = enc.init_reg(6);
            let m = b.finish(s0);
            assert!(m.validate().is_empty(), "{:?}", m.validate());
            let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
            assert_eq!(status, Status::Halted);
            enc.decode_nat(&tapes[REG].snapshot().0, 5)
        }
        // ptr in slot 4 = 2 -> cell 2 = (3, 1).
        assert_eq!(run_op(false, 4), Some(3)); // head(ptr2) = 3
        assert_eq!(run_op(true, 4), Some(1)); // tail(ptr2) = 1
        // ptr in slot 2 = 1 -> cell 1 = (7, 0).
        assert_eq!(run_op(false, 2), Some(7)); // head(ptr1) = 7
        assert_eq!(run_op(true, 2), Some(0)); // tail(ptr1) = 0
    }

    #[test]
    fn mul_by_zero_is_zero() {
        // rd = ra * 0 == 0, and 0 * rb == 0 (the loop-counter drains immediately).
        assert_eq!(run_gadget(3, &[(0, 7), (1, 0)], 2, |b, e, x| Unary.arith(b, e, x, BinOp::Mul, 0, 1, 2)), Some(0));
        assert_eq!(run_gadget(3, &[(0, 0), (1, 7)], 2, |b, e, x| Unary.arith(b, e, x, BinOp::Mul, 0, 1, 2)), Some(0));
    }

    #[test]
    fn comparison_trichotomy_sweep() {
        // For a < b, a == b, a > b, every one of the six comparisons must give the right 0/1.
        fn cmp(op: BinOp, a: u64, bb: u64) -> Option<u64> {
            run_gadget(3, &[(0, a), (1, bb)], 2, move |b, e, x| Unary.compare(b, e, x, op, 0, 1, 2))
        }
        for (a, bb, lt, le, gt, ge, eq, ne) in
            [(2u64, 5u64, 1, 1, 0, 0, 0, 1), (5, 5, 0, 1, 0, 1, 1, 0), (5, 2, 0, 0, 1, 1, 0, 1)]
        {
            assert_eq!(cmp(BinOp::Lt, a, bb), Some(lt), "lt {a},{bb}");
            assert_eq!(cmp(BinOp::Le, a, bb), Some(le), "le {a},{bb}");
            assert_eq!(cmp(BinOp::Gt, a, bb), Some(gt), "gt {a},{bb}");
            assert_eq!(cmp(BinOp::Ge, a, bb), Some(ge), "ge {a},{bb}");
            assert_eq!(cmp(BinOp::Eq, a, bb), Some(eq), "eq {a},{bb}");
            assert_eq!(cmp(BinOp::Ne, a, bb), Some(ne), "ne {a},{bb}");
        }
    }

    #[test]
    fn tail_of_a_non_last_cell_with_a_nonempty_tail() {
        // Build heap [(7,0),(3,1),(9,0)] via cons: cons(7,nil)->p1; cons(3,p1)->p2; cons(9,nil)->p3.
        // tail(p2) reads cell 2's tail (=1, non-empty) and must STOP on cell 3's `@` then restore the top —
        // the "copy marks THEN hit AT" path (cell 2 is NOT the last cell). Expect 1.
        let enc = Unary;
        let mut b = Builder::new();
        let halt = b.accept("halt");
        // slots: 0=7,1=0(nil),2=p1,3=3,4=p2,5=9,6=p3,7=result.
        let s0 = b.state("s0");
        let s1 = b.state("s1");
        enc.write_literal(&mut b, s0, s1, 7, 0);
        let s2 = b.state("s2");
        enc.write_literal(&mut b, s1, s2, 0, 1);
        let s3 = b.state("s3");
        enc.cons(&mut b, s2, s3, 0, 1, 2); // p1 = (7,0)
        let s4 = b.state("s4");
        enc.write_literal(&mut b, s3, s4, 3, 3);
        let s5 = b.state("s5");
        enc.cons(&mut b, s4, s5, 3, 2, 4); // p2 = (3,1)
        let s6 = b.state("s6");
        enc.write_literal(&mut b, s5, s6, 9, 5);
        let s7 = b.state("s7");
        enc.cons(&mut b, s6, s7, 5, 1, 6); // p3 = (9,0)  (tail nil)
        enc.tail_op(&mut b, s7, halt, 4, 7); // tail(p2) -> slot 7
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(8);
        let m = b.finish(s0);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 7), Some(1));
    }

    #[test]
    fn cons_after_a_deref_keeps_the_heap_top() {
        // Build [1,2] (p_outer -> (1, p_inner) -> (2,0)); tail(p_outer) -> p_inner; then cons(9, p_inner).
        // The deref must have restored the HEAP top, so the new cons appends a correct cell. Decode-check
        // via the pointer: the new cell's head is 9 and its tail is p_inner (=1). Expect the new ptr's head=9.
        let enc = Unary;
        let mut b = Builder::new();
        let halt = b.accept("halt");
        // slots: 0=2,1=0,2=p_inner,3=1,4=p_outer,5=t(=p_inner),6=9,7=p_new,8=head-of-p_new.
        let s0 = b.state("s0");
        let s1 = b.state("s1");
        enc.write_literal(&mut b, s0, s1, 2, 0);
        let s2 = b.state("s2");
        enc.write_literal(&mut b, s1, s2, 0, 1);
        let s3 = b.state("s3");
        enc.cons(&mut b, s2, s3, 0, 1, 2); // p_inner = (2,0)
        let s4 = b.state("s4");
        enc.write_literal(&mut b, s3, s4, 1, 3);
        let s5 = b.state("s5");
        enc.cons(&mut b, s4, s5, 3, 2, 4); // p_outer = (1, p_inner)
        let s6 = b.state("s6");
        enc.tail_op(&mut b, s5, s6, 4, 5); // slot5 = tail(p_outer) = p_inner
        let s7 = b.state("s7");
        enc.write_literal(&mut b, s6, s7, 9, 6);
        let s8 = b.state("s8");
        enc.cons(&mut b, s7, s8, 6, 5, 7); // p_new = cons(9, p_inner)
        enc.head_op(&mut b, s8, halt, 7, 8); // slot8 = head(p_new) = 9
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(9);
        let m = b.finish(s0);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 8), Some(9));
    }

    // ---- BOX tape gadgets ----

    /// Build a machine that runs `body` (the gadget under test) between a fresh entry and halt, with the
    /// REG bank pre-seeded to `slots` fields and `inits` written. Returns the BOX + REG snapshots.
    fn run_box(
        slots: u32,
        inits: &[(u64, Slot)],
        body: impl FnOnce(&mut Builder, StateId, StateId),
    ) -> (Vec<Symbol>, Vec<Symbol>) {
        let enc = Unary;
        let mut b = Builder::new();
        let halt = b.accept("halt");
        let mut cur = b.state("s0");
        let start = cur;
        for (n, slot) in inits {
            let nxt = b.state(format!("init{slot}"));
            enc.write_literal(&mut b, cur, nxt, *n, *slot);
            cur = nxt;
        }
        body(&mut b, cur, halt);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(slots);
        let m = b.finish(start);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted, "gadget must halt");
        (tapes[BOX].snapshot().0, tapes[REG].snapshot().0)
    }

    #[test]
    fn box_op_allocates_and_returns_pointer_one() {
        // box(7) into rd=1, with the value 7 pre-loaded in slot 0. Pointer must be 1.
        let (_boxtape, reg) = run_box(2, &[(7, 0)], |b, e, x| Unary.box_op(b, e, x, 0, 1));
        assert_eq!(Unary.decode_nat(&reg, 1), Some(1));
    }

    #[test]
    fn two_box_ops_return_sequential_pointers() {
        // box(3) -> rd=1 ; box(4) -> rd=2 ; pointers 1 then 2
        let (_bt, reg) = run_box(3, &[(3, 0)], |b, e, x| {
            let mid = b.state("mid");
            Unary.box_op(b, e, mid, 0, 1); // box(slot0=3) -> slot1
            // reload slot0 = 4, then box again -> slot2
            let after = b.state("after");
            Unary.write_literal(b, mid, after, 4, 0);
            Unary.box_op(b, after, x, 0, 2); // box(slot0=4) -> slot2
        });
        assert_eq!(Unary.decode_nat(&reg, 1), Some(1));
        assert_eq!(Unary.decode_nat(&reg, 2), Some(2));
    }

    #[test]
    fn box_get_reads_the_allocated_value() {
        // box(5) -> rd=1 ; box_get(rd=1) -> slot2 == 5
        let (_bt, reg) = run_box(3, &[(5, 0)], |b, e, x| {
            let mid = b.state("mid");
            Unary.box_op(b, e, mid, 0, 1);
            Unary.box_get_op(b, mid, x, 1, 2);
        });
        assert_eq!(Unary.decode_nat(&reg, 2), Some(5));
    }

    #[test]
    fn box_set_overwrites_in_place_and_get_sees_it() {
        // h = box(5) ; box_set(h, 9) ; box_get(h) == 9
        let (_bt, reg) = run_box(4, &[(5, 0), (9, 1)], |b, e, x| {
            let s1 = b.state("s1");
            Unary.box_op(b, e, s1, 0, 2); // slot2 = box(slot0=5)
            let s2 = b.state("s2");
            Unary.box_set_op(b, s1, s2, 2, 1); // *slot2 = slot1 (9)
            Unary.box_get_op(b, s2, x, 2, 3); // slot3 = box_get(slot2) = 9
        });
        assert_eq!(Unary.decode_nat(&reg, 3), Some(9));
    }

    #[test]
    fn two_boxes_are_independent_cells() {
        // a = box(3) ; b = box(4) ; box_set(a, 7) ; box_get(b) == 4
        let (_bt, reg) = run_box(6, &[(3, 0), (4, 1), (7, 2)], |b, e, x| {
            let s1 = b.state("s1");
            Unary.box_op(b, e, s1, 0, 3); // slot3 = box(3) -> ptr 1
            let s2 = b.state("s2");
            Unary.box_op(b, s1, s2, 1, 4); // slot4 = box(4) -> ptr 2
            let s3 = b.state("s3");
            Unary.box_set_op(b, s2, s3, 3, 2); // *slot3 = 7
            Unary.box_get_op(b, s3, x, 4, 5); // slot5 = box_get(slot4) = 4
        });
        assert_eq!(Unary.decode_nat(&reg, 5), Some(4));
    }

    // The BOX tape is blank-padded, so a ZERO-valued field is FIELD_WIDTH blanks — indistinguishable
    // from the origin-left / top blanks by a single read. These probe the content-blind fixed-width
    // navigation on exactly that case (never exercised by the six contract tests, whose values are all
    // > 0). A box holds a value 0 <= v < FIELD_WIDTH (a captured counter can start at 0).

    #[test]
    fn box_of_zero_roundtrips() {
        // box(0) -> ptr 1 ; box_get(ptr) == 0. The whole field is blank; seek + read must not be fooled.
        let (_bt, reg) = run_box(3, &[(0, 0)], |b, e, x| {
            let mid = b.state("mid");
            Unary.box_op(b, e, mid, 0, 1);
            Unary.box_get_op(b, mid, x, 1, 2);
        });
        assert_eq!(Unary.decode_nat(&reg, 1), Some(1), "an all-blank field still gets pointer 1");
        assert_eq!(Unary.decode_nat(&reg, 2), Some(0), "box_get of a zero-valued box reads 0");
    }

    #[test]
    fn box_set_can_shrink_to_zero_and_regrow() {
        // box(9) ; set 0 ; get == 0 ; set 4 ; get == 4. Shrinking (blank leftovers) then regrowing.
        let (_bt, reg) = run_box(6, &[(9, 0), (0, 1), (4, 2)], |b, e, x| {
            let s1 = b.state("s1");
            Unary.box_op(b, e, s1, 0, 3); // slot3 = box(9) -> ptr 1
            let s2 = b.state("s2");
            Unary.box_set_op(b, s1, s2, 3, 1); // *ptr = 0
            let s3 = b.state("s3");
            Unary.box_get_op(b, s2, s3, 3, 4); // slot4 = 0
            let s4 = b.state("s4");
            Unary.box_set_op(b, s3, s4, 3, 2); // *ptr = 4
            Unary.box_get_op(b, s4, x, 3, 5); // slot5 = 4
        });
        assert_eq!(Unary.decode_nat(&reg, 4), Some(0), "shrunk to 0");
        assert_eq!(Unary.decode_nat(&reg, 5), Some(4), "regrew to 4");
    }

    #[test]
    fn box_set_shrinks_to_a_shorter_nonzero_value_in_place() {
        // h = box(9) ; box_set(h, 4) ; box_get(h) == 4. Overwrite a LONGER value with a SHORTER NONZERO
        // one: exercises BOTH the mark-writing loop (stamping 4's marks) AND the leftover-erasing loop
        // (blanking 9's five surplus marks) in the SAME set — unlike shrink-to-ZERO (no marks written)
        // or grow (no leftovers to erase).
        let (_bt, reg) = run_box(4, &[(9, 0), (4, 1)], |b, e, x| {
            let s1 = b.state("s1");
            Unary.box_op(b, e, s1, 0, 2); // slot2 = box(slot0=9) -> ptr 1
            let s2 = b.state("s2");
            Unary.box_set_op(b, s1, s2, 2, 1); // *slot2 = slot1 (4)
            Unary.box_get_op(b, s2, x, 2, 3); // slot3 = box_get(slot2) = 4
        });
        assert_eq!(Unary.decode_nat(&reg, 3), Some(4), "shrunk 9 -> 4 in place (marks + leftovers)");
    }

    #[test]
    fn seek_crosses_a_zero_valued_field() {
        // box(0) then box(6): the SECOND box_op must count past a fully-blank first field, and box_get of
        // the second pointer must seek RIGHT across that all-blank field to land on field 2.
        let (_bt, reg) = run_box(5, &[(0, 0), (6, 1)], |b, e, x| {
            let s1 = b.state("s1");
            Unary.box_op(b, e, s1, 0, 2); // slot2 = box(0) -> ptr 1
            let s2 = b.state("s2");
            Unary.box_op(b, s1, s2, 1, 3); // slot3 = box(6) -> ptr 2 (count skipped a zero field)
            Unary.box_get_op(b, s2, x, 3, 4); // slot4 = box_get(ptr 2) = 6 (sought across a zero field)
        });
        assert_eq!(Unary.decode_nat(&reg, 3), Some(2), "second pointer is 2 even past a zero field");
        assert_eq!(Unary.decode_nat(&reg, 4), Some(6), "box_get sought across the zero field to field 2");
    }
}
