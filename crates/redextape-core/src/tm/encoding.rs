//! The pluggable numeric `Encoding` seam and the primitives every implementation shares.
//!
//! An implementation decides how a value is REPRESENTED inside a fixed-width field and how every
//! gadget that reads or writes one is built. What it does not decide is the bank's SKELETON: a
//! `#`-delimited run of equal-width fields, navigated by counting delimiters. `seek_slot` and
//! `rewind_home` implement that navigation and are shared, parameterized on the tape and on the set
//! of symbols that may appear inside a field. A third shared primitive, `stack_is_empty`, is
//! unrelated to bank navigation — it branches on STACK-tape emptiness — but lives here too because it
//! is likewise a control-flow gadget every encoding shares rather than reimplements.
//!
//! `unary` is the v1 implementation (a value is `v` marks, left-justified, blank-padded).
//! `binary` is the base-2 implementation (a value is exactly `width` digits, LSB-first).

use crate::core::BinOp;
use crate::tm::build::{Builder, RuleSpec, SEP, STACK, Slot};
use crate::tm::machine::{BLANK, Move, StateId, Symbol};

pub mod binary;
pub mod unary;
pub use binary::Binary;
pub use unary::Unary;

/// The pluggable numeric encoding (the swappable seam). `Unary` is the v1 implementation; a `Binary`
/// impl is the committed follow-on. Gadgets build states into `b`, flowing `entry -> exit`, under the
/// home convention (REG head on the leading `#`; WORK head at its leftmost (value) cell — blank only
/// when WORK is empty) on entry and exit.
// `arith`/`compare` carry (b, entry, exit, op, ra, rb, rd) — the register-machine three-address shape;
// the operands are intrinsic to the interface, so allow the arg count on the whole seam.
#[allow(clippy::too_many_arguments)]
pub trait Encoding {
    /// `slot rd <- n` (clear the field, write `n` in this encoding's representation).
    fn write_literal(&self, b: &mut Builder, entry: StateId, exit: StateId, n: u64, rd: Slot);
    /// `slot rd <- (ra `op` rb)` for an arithmetic `BinOp` (Add/Sub/Mul); comparisons go to `compare`.
    /// PRECONDITION: `rd` must be a fresh temporary, distinct from `ra` and `rb`, for every
    /// implementation (`Unary::arith`'s `Mul` uses `rd` as a scratch/loop-counter register while
    /// `ra`/`rb` are still being read, so it depends on this; `Binary::arith`'s `Mul` never touches
    /// `rd` until a single final copy at the end, but the precondition is trait-wide and callers must
    /// not assume any implementation is exempt from it).
    fn arith(&self, b: &mut Builder, entry: StateId, exit: StateId, op: BinOp, ra: Slot, rb: Slot, rd: Slot);
    /// `slot rd <- (ra `op` rb) as 0/1` for a comparison `BinOp` (Eq/Ne/Lt/Le/Gt/Ge).
    /// PRECONDITION: `rd` must be a fresh temporary, distinct from `ra` and `rb` (`Eq`/`Ne` park an
    /// intermediate boolean in `rd` while `ra`/`rb` are still being read).
    fn compare(&self, b: &mut Builder, entry: StateId, exit: StateId, op: BinOp, ra: Slot, rb: Slot, rd: Slot);
    /// Decode field `slot` of a materialized `reg` tape to the number it holds — the reading is the
    /// encoding's own (`Unary` counts marks, `Binary` folds digits). `None` if the field is absent or
    /// malformed for this encoding.
    fn decode_nat(&self, reg_cells: &[Symbol], slot: Slot) -> Option<u64>;
    /// This instance's field width, in TAPE CELLS — not directly a value bound, since what a `width`-cell
    /// field can hold is encoding-specific: `v < width` for `Unary`, `v < 2^width` for `Binary`. Both
    /// implementations are bounded today (always `Some`). `None` means an unbounded encoding — no
    /// fixed cell count, hence no value ceiling — which is how `run_tm_fitted`'s auto-fit would know not
    /// to search at all; no such implementation exists in the tree yet.
    fn field_width(&self) -> Option<usize>;
    /// The symbols that may legally appear INSIDE a field — never `SEP`, which delimits fields rather
    /// than filling them. Unary fields hold marks and padding blanks; binary fields hold digits.
    ///
    /// This exists for the bank-safety checkers. They verify the bank's SKELETON — right length, `#`
    /// at every boundary, nothing but field content in between — and "field content" is the one part
    /// of that property the encoding gets to define.
    fn field_symbols(&self) -> &'static [Symbol];
    /// Parse a final HEAP tape into its cons cells, in address order: `result[p - 1]` is the cell at
    /// 1-based pointer `p` (`nil` is pointer 0 and has no cell). The cell's DELIMITERS (`@`, `#`) are
    /// structural and identical across encodings; its head and tail WORDS are values, so reading them
    /// is the encoding's job — which is why this is a trait method and not a free function.
    ///
    /// Total: a malformed or truncated tape yields the cells parsed so far, never a panic.
    ///
    /// REQUIREMENT on implementations: locate cells by scanning for the `@` marker, not by indexing
    /// from cell 0 — `Tape::snapshot`'s cell 0 is not necessarily the origin, so a marker-delimited scan
    /// is what makes parsing robust to blanks left of the origin.
    fn parse_heap_cells(&self, cells: &[Symbol]) -> Vec<(u64, u64)>;
    /// The exact length, in tape cells, of a HEAP cons-cell WORD — or `None` when this encoding does not
    /// fix one.
    ///
    /// A sibling of `field_symbols`, and it exists for the same reason: the bank-safety checkers verify
    /// the heap's skeleton, and how long a word is happens to be a fact only the encoding knows.
    ///
    /// It is deliberately NOT `field_width`. A heap word is not a register field. `Unary` pads a REG
    /// field out to `width` with blanks, but writes a heap word as a bare mark run whose length IS the
    /// value — so unary fields are fixed-width while unary heap words are not, and answering
    /// `field_width` here would make the checker reject every non-maximal unary value. `Binary` writes
    /// both as exactly `width` digits, so for it the two coincide.
    ///
    /// Only ever applied to a FINAL (halted) tape. A mid-append word is legitimately shorter than this,
    /// and no per-step invariant may use it.
    fn heap_word_len(&self) -> Option<usize>;
    /// Re-instantiate this encoding at `width`. An unbounded encoding returns an equivalent of itself.
    fn at_width(&self, width: usize) -> Box<dyn Encoding>;
    /// The initial REG tape for a `slots`-field bank: `#` then (`width` blanks + `#`)*`slots`.
    /// Head begins at cell 0 (the leading `#` = home). Encoding-specific (a zero field's contents).
    fn init_reg(&self, slots: u32) -> Vec<Symbol>;
    /// The initial WORK (scratch) tape. Unary builds its scratch from an empty tape as it goes, so it
    /// returns nothing; binary needs a `#`-delimited bank of fixed-width fields, because its operands
    /// are fixed-width digit strings — but only ONE field (see `binary::W_ACC`), because `mul` shifts
    /// the accumulator rather than the multiplicand, so there is no multiplier register or loop
    /// counter to keep alongside it.
    ///
    /// An encoding returning a non-empty WORK is declaring WORK to be a fixed-width tape, which is
    /// what `assert_delimiter_safe` keys off when deciding whether to check WORK for delimiter safety.
    fn init_work(&self) -> Vec<Symbol>;
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
    /// `pop_frame_restore`), read+erase the tag and route to `exits[c]` where `c` is the tag's VALUE as
    /// this encoding reads it (`Unary` counts marks; `Binary` folds digits and fans out by a linear
    /// chain of equality tests, since a depth-`width` decision trie would have `2^width` leaves).
    /// `from` `entry` (STACK head at the top — the blank right of the tag's `#`; REG/WORK home).
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
    /// (Runtime); `rd` is not written. BOTH the head-word and the structural navigation follow the
    /// encoding: `Unary` walks the cell chain by counting marks, `Binary` skips whole fixed-width cells
    /// with a counted chain driven by a binary counter. (This doc previously said the navigation was
    /// "unary-always"; the binary impl makes that false, and a trait doc asserting an implementation
    /// property its second implementation violates is worse than saying nothing.) PRECONDITION: `rd` distinct from `rl` (`rd` is
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

// ---- shared bank-skeleton navigation (free functions; each preserves the home convention) ----
//
// `seek_slot`/`rewind_home` count `#`s to find field `slot` and to get back home. `stack_is_empty`,
// below them, is a different kind of shared primitive: a STACK-tape emptiness branch, not a bank seek.

/// Seek the `tape` head from home to field `slot`'s first cell. Constant-size chain: step off the
/// leading `#`, then for each further slot scan its field (every symbol in `content`) to the next `#`
/// and step off. Ends AT `slot`'s first cell, NOT at home — internal to a gadget, which must return
/// home before `exit`. `from` reads the leading `#`; it must have no conflicting rules. Returns a
/// rule-less control state.
///
/// `content` is the encoding's `field_symbols()`: the scan must cross every symbol a field can hold
/// and stop only on `#`, so an encoding whose fields hold a symbol missing from `content` would stall
/// mid-bank. That is why this takes the set rather than assuming one.
pub(crate) fn seek_slot(
    b: &mut Builder,
    from: StateId,
    tape: usize,
    content: &[Symbol],
    slot: Slot,
    label: &str,
) -> StateId {
    let mut cur = b.state(format!("{label}.sk0"));
    b.add_rule(from, RuleSpec::new().on(tape, Some(SEP), None, Move::R), cur);
    for k in 1..=slot {
        let next = b.state(format!("{label}.sk{k}"));
        for &c in content {
            b.add_rule(cur, RuleSpec::new().on(tape, Some(c), None, Move::R), cur);
        }
        b.add_rule(cur, RuleSpec::new().on(tape, Some(SEP), None, Move::R), next);
        cur = next;
    }
    cur
}

/// From a state whose `tape` head sits in field `slot`, move the head back to home (the leading `#`).
/// Counts `#`s: walk left over field content, stop only AT a `#`; the leading `#` is the
/// `(slot+1)`-th one, so we cross `slot` inner delimiters then rest on the leftmost. Content-blind
/// within `content` (only `#`s halt the walk), so a padded or all-zero field cannot masquerade as the
/// left end.
///
/// PRECONDITION: the entry head must sit INSIDE field `slot` and never on the field's trailing `#`.
/// For unary that is what makes `MAX_FIELD_WIDTH`'s bound strict (see its doc). For binary every
/// field is exactly `width` digits and the precondition holds for every value, which is why base 2
/// has no strict-bound requirement.
///
/// As with `seek_slot`, `content` must be the field's COMPLETE alphabet: the backward walk crosses
/// only symbols it has a rule for, so one missing from `content` stalls the head mid-bank.
pub(crate) fn rewind_home(
    b: &mut Builder,
    from: StateId,
    tape: usize,
    content: &[Symbol],
    slot: Slot,
    label: &str,
) -> StateId {
    let mut cur = from;
    for k in (1..=slot).rev() {
        for &c in content {
            b.add_rule(cur, RuleSpec::new().on(tape, Some(c), None, Move::L), cur);
        }
        let next = b.state(format!("{label}.rw{}", k - 1));
        b.add_rule(cur, RuleSpec::new().on(tape, Some(SEP), None, Move::L), next);
        cur = next;
    }
    let home = b.state(format!("{label}.home"));
    for &c in content {
        b.add_rule(cur, RuleSpec::new().on(tape, Some(c), None, Move::L), cur);
    }
    b.add_rule(cur, RuleSpec::new().on(tape, Some(SEP), None, Move::S), home);
    home
}

// ---- shared STACK emptiness branch (free function) ----

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::build::{TAPES, WORK};
    use crate::tm::sim::{DEFAULT_CAPS, Status, simulate};

    /// `seek_slot` + `rewind_home` navigate a `#`-delimited equal-width bank on ANY tape, over ANY
    /// content alphabet: seek to field `k`, mark where you landed, walk home, and the head must be
    /// back on cell 0. Run here on WORK over the BINARY digit set — a combination no unary gadget
    /// produces — because that is the case the generalization exists for and the one a REG/mark-only
    /// test would not cover.
    #[test]
    fn seek_and_rewind_navigate_any_tape_and_alphabet() {
        const W: usize = 3;
        const DIGITS: &[Symbol] = &['0', '1'];
        for slot in 0..3u32 {
            let mut b = Builder::new();
            let start = b.state("start");
            let halt = b.accept("halt");
            let at = seek_slot(&mut b, start, WORK, DIGITS, slot, "t");
            // Mark the landing cell so a wrong field is visible in the final tape.
            let marked = b.state("marked");
            b.add_rule(at, RuleSpec::new().on(WORK, Some('0'), Some('1'), Move::S), marked);
            let home = rewind_home(&mut b, marked, WORK, DIGITS, slot, "r");
            b.add_rule(home, RuleSpec::new(), halt);
            let m = b.finish(start);
            assert!(m.validate().is_empty(), "{:?}", m.validate());

            // Bank: `#` then (3 zeros + `#`) * 3.
            let mut bank = vec![SEP];
            for _ in 0..3 {
                bank.extend(['0'; W]);
                bank.push(SEP);
            }
            let mut init = vec![Vec::new(); TAPES];
            init[WORK] = bank;
            let (tapes, status) = simulate(&m, &init, DEFAULT_CAPS);
            assert_eq!(status, Status::Halted, "slot {slot}");
            let (cells, head) = tapes[WORK].snapshot();
            assert_eq!(head, 0, "slot {slot}: rewind_home must land on cell 0, landed on {head}");
            let expected = 1 + slot as usize * (W + 1);
            assert_eq!(cells[expected], '1', "slot {slot}: seek_slot landed in the wrong field");
        }
    }
}
