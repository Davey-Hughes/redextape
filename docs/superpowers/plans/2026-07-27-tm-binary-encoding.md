# The binary `Encoding` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second `impl Encoding` in base 2, so one program compiles to two different Turing machines that compute the same answer — `reference == λ == unary-TM == binary-TM` — moving the TM's value ceiling from 64 to 2⁶⁴.

**Architecture:** `Encoding` (`tm/encoding.rs:18`) has been the declared swappable seam since Part 2b-1 with exactly one implementation. This plan splits `encoding.rs` into a module directory, adds three trait methods that remove the last unary assumptions from code outside the impls (`parse_heap_cells`, `field_symbols`, `init_work`), generalizes the two shared navigation primitives over (tape, content-symbol set), and then builds `Binary` gadget family by gadget family. Every binary gadget is a **counted chain over `w`-cell fields** rather than a content-driven loop over marks — the style the BOX tape already uses.

**Tech Stack:** Rust (edition from `rust-toolchain.toml`), `proptest` for generators, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-26-tm-binary-encoding-design.md`

## Global Constraints

- **Totality is the cardinal rule.** No input may crash any process. Every new gadget path either flows to an exit, routes to `Builder::overflow()`, or spins to a cap. No `panic!`, no `unwrap()` on user-derived data, no unbounded allocation.
- **`Unary` behaviour must not change.** Not one step count, not one state name, not one rule. Phase 1 is refactoring only: the step-count goldens are the check, and if a golden number moves in Phase 1 that is a defect in the refactor, not an expected consequence.
- **`Unary::default()` stays the default everywhere.** `Binary` is always selected explicitly. This plan adds a binary *column*, never a replacement.
- **A binary field is exactly `w` cells, every cell a digit, LSB-first** — the leftmost cell is 2⁰. Values satisfy `v < 2^w`. There is no padding blank and no strict-bound requirement; that is a unary artifact.
- **`at_width(w)` means `w` tape cells**, not "values `< w`". `field_width()` returns the cell width.
- **Carry-out routes to `Builder::overflow()` at every width, including 64.** No width-conditional arithmetic semantics.
- **Every rule that writes a non-`#` symbol must read an explicit non-`#` symbol on that tape**, or be shadowed by a preceding first-in-state `#` guard that constrains no other tape. This is what `tests/common/mod.rs::unsafe_rules` checks, and it is why digit writes enumerate both digit reads instead of using a wildcard.
- **Test commands.** Fast tier: `cargo test -p redextape-core`. Full gate: `scripts/check-all.sh --no-llvm`. Slow tier: `scripts/check-slow.sh`.
- **Commit style:** no attribution trailers. Subject in the repo's existing form (`feat(tm):`, `refactor(tm):`, `test(tm):`).

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `crates/redextape-core/src/tm/encoding/unary.rs` | `struct Unary` + `impl Encoding for Unary` + its unary-specific free helpers and unit tests. Moved verbatim in Task 1. |
| `crates/redextape-core/src/tm/encoding/binary.rs` | `struct Binary` + `impl Encoding for Binary` + its digit helpers and unit tests. Built in Tasks 6–13. |
| `crates/redextape-core/tests/tm_binary_gadgets.rs` | Gadget-level integration tests for `Binary`, mirroring `tm_encoding.rs`'s role for `Unary`. |

**Modified:**

| File | Change |
|---|---|
| `crates/redextape-core/src/tm/encoding.rs` | Becomes the module root: the `Encoding` trait, the genuinely shared navigation primitives (`seek_slot`, `rewind_home`, `stack_is_empty`), and `pub mod unary; pub mod binary;`. |
| `crates/redextape-core/src/tm/build.rs` | `ZERO: Symbol = '0'`. |
| `crates/redextape-core/src/tm/decode.rs` | `parse_heap_cells` free fn → `enc.parse_heap_cells(...)`. |
| `crates/redextape-core/src/tm.rs` | `attempt()` initializes WORK; `pub use encoding::{Binary, Encoding, Unary}`. |
| `crates/redextape-core/tests/common/mod.rs` | Three checkers become encoding-generic. |
| The six TM test files + `native_oracle.rs` | Sweep both encodings (Phase 3). |
| `crates/redextape-core/examples/{width_report,step_survey}.rs` | Binary column. |

**Module layout note.** `tm/encoding.rs` coexisting with a `tm/encoding/` directory is the non-`mod.rs` layout, matching `tm.rs` + `tm/` already in this crate. Do not create `tm/encoding/mod.rs`.

---

# Phase 1 — The seam (no new encoding)

Five tasks, all refactoring. At the end of Phase 1 there is still exactly one `Encoding` impl and every existing test passes with identical step counts. The point of Phase 1 is that Phase 2 becomes additive.

---

### Task 1: Split `encoding.rs` into a module directory

**Files:**
- Create: `crates/redextape-core/src/tm/encoding/unary.rs`
- Modify: `crates/redextape-core/src/tm/encoding.rs` (becomes the module root)

**Interfaces:**
- Consumes: nothing.
- Produces: `crate::tm::encoding::unary::Unary`, re-exported as `crate::tm::encoding::Unary` so every existing `use` path outside `tm/encoding/` keeps working unchanged. `pub(crate) fn seek_slot`, `pub(crate) fn rewind_home`, `pub(crate) fn stack_is_empty` become visible to sibling modules.

**Why this is its own task and its own commit:** it moves ~2,300 lines. Reviewing new binary code as a diff against moved code is unreadable. This commit must contain **no behaviour change at all**.

- [ ] **Step 1: Move the file**

```bash
cd /Users/davey/projects/redextape
mkdir -p crates/redextape-core/src/tm/encoding
git mv crates/redextape-core/src/tm/encoding.rs crates/redextape-core/src/tm/encoding/unary.rs
```

- [ ] **Step 2: Create the new module root**

Create `crates/redextape-core/src/tm/encoding.rs` containing, in this order:

1. The module doc comment (moved from the top of what is now `unary.rs`, reworded to describe the module rather than the unary impl).
2. `pub mod unary;` and `pub use unary::Unary;`
3. The `pub trait Encoding` block — **cut** from `unary.rs` lines 11–98, unchanged.
4. `pub(crate) fn seek_slot`, `pub(crate) fn rewind_home`, `pub(crate) fn stack_is_empty` — **cut** from `unary.rs`, unchanged except that `fn` becomes `pub(crate) fn`.

Header of the new `crates/redextape-core/src/tm/encoding.rs`:

```rust
//! The pluggable numeric `Encoding` seam and the primitives every implementation shares.
//!
//! An implementation decides how a value is REPRESENTED inside a fixed-width field and how every
//! gadget that reads or writes one is built. What it does not decide is the bank's SKELETON: a
//! `#`-delimited run of equal-width fields, navigated by counting delimiters. `seek_slot` and
//! `rewind_home` implement that navigation and are shared, parameterized on the tape and on the set
//! of symbols that may appear inside a field.
//!
//! `unary` is the v1 implementation (a value is `v` marks, left-justified, blank-padded).
//! `binary` is the base-2 implementation (a value is exactly `width` digits, LSB-first).

use crate::core::BinOp;
use crate::tm::build::{Builder, Move, RuleSpec, SEP, STACK, Slot};
use crate::tm::machine::{StateId, Symbol};

pub mod unary;
pub use unary::Unary;
```

Then the trait, then the three shared functions.

- [ ] **Step 3: Fix `unary.rs`'s imports**

At the top of `crates/redextape-core/src/tm/encoding/unary.rs`, replace the old `use` block with:

```rust
//! The v1 unary `Encoding`: a value `v` is `v` `MARK`s, left-justified in a `width`-cell field and
//! padded with `BLANK`s. The bound is STRICT (`v < width`) — see `MAX_FIELD_WIDTH` for why the
//! padding blank is load-bearing rather than cosmetic.

use crate::core::BinOp;
use crate::tm::build::{
    AT, BOX, Builder, HEAP, MARK, MAX_FIELD_WIDTH, Move, REG, RuleSpec, SEP, STACK, Slot, WORK,
};
use crate::tm::encoding::{Encoding, rewind_home, seek_slot, stack_is_empty};
use crate::tm::machine::{BLANK, StateId, Symbol};
```

Delete the trait definition and the three moved functions from `unary.rs`.

- [ ] **Step 4: Point the existing re-exports at the new path**

In `crates/redextape-core/src/tm.rs`, `pub use encoding::{Encoding, Unary};` (line 28) needs no change — `Unary` is re-exported from `encoding`. In `crates/redextape-core/src/tm/decode.rs:11`, change:

```rust
use crate::tm::encoding::{Encoding, parse_heap_cells};
```

to:

```rust
use crate::tm::encoding::{Encoding, unary::parse_heap_cells};
```

and make `parse_heap_cells` `pub(crate)` in `unary.rs` (it already is). Task 3 removes this line entirely; it is a two-commit-lifetime wart, and naming it here stops a reviewer flagging it as the final state.

- [ ] **Step 5: Verify nothing moved but text**

```bash
cargo test -p redextape-core 2>&1 | tail -20
```

Expected: every test passes, same count as before the split. Then confirm the goldens specifically:

```bash
cargo test -p redextape-core --test tm_oracle 2>&1 | tail -5
cargo test -p redextape-core golden 2>&1 | tail -10
```

Expected: PASS. **If any step-count golden changed, the move was not verbatim — revert and redo.**

- [ ] **Step 6: Commit**

```bash
git add -A crates/redextape-core/src/tm/
git commit -m "refactor(tm): split encoding.rs into a module directory

A second Encoding impl of comparable size would make this file ~4,500 lines,
and reviewing new binary gadgets as a diff against moved code is unreadable.
Pure move: the trait and the two shared navigation primitives become the
module root, Unary and its unary-specific helpers become encoding/unary.rs.

No behaviour change. Every step-count golden is unchanged, which is the check."
```

---

### Task 2: `ZERO`, `field_symbols()`, and encoding-generic bank checkers

**Files:**
- Modify: `crates/redextape-core/src/tm/build.rs` (add `ZERO`)
- Modify: `crates/redextape-core/src/tm/encoding.rs` (trait method)
- Modify: `crates/redextape-core/src/tm/encoding/unary.rs` (impl)
- Modify: `crates/redextape-core/src/tm.rs` (re-export `ZERO`)
- Modify: `crates/redextape-core/tests/common/mod.rs` (three checkers)
- Modify: `crates/redextape-core/tests/{tm_bank_invariant,tm_exhaustive_bank_safety,tm_heap_stack_shape}.rs` (call sites)

**Interfaces:**
- Consumes: Task 1's module layout.
- Produces:
  - `pub const ZERO: Symbol = '0';` in `tm/build.rs`, re-exported from `tm.rs`.
  - `fn field_symbols(&self) -> &'static [Symbol];` on `Encoding`. `Unary` returns `&[MARK, BLANK]`; `Binary` (Task 6) returns `&[ZERO, MARK]`.
  - `reg_bank_is_well_formed(cells: &[char], enc: &dyn Encoding, slots: usize) -> Result<(), String>`
  - `box_tape_is_well_formed(cells: &[char], enc: &dyn Encoding) -> Result<(), String>`
  - `heap_tape_is_well_formed(cells: &[char], enc: &dyn Encoding) -> Result<(), String>`

  All three now derive the width from `enc.field_width()` rather than taking it separately, so a caller cannot pass a width that disagrees with the encoding that produced the tape.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/tm/encoding/unary.rs`'s `mod tests`:

```rust
/// `field_symbols` names exactly what may appear INSIDE a field, which is what lets the bank-safety
/// checkers stop hardcoding `MARK`/`BLANK`. For unary that is a mark or a padding blank — and
/// crucially NOT `SEP`, since a delimiter inside a field is precisely the corruption those checkers
/// exist to catch.
#[test]
fn unary_field_symbols_are_mark_and_blank() {
    let enc = Unary::default();
    assert_eq!(enc.field_symbols(), &[MARK, BLANK]);
    assert!(!enc.field_symbols().contains(&SEP), "a delimiter is never field content");
}

/// Every cell `init_reg` lays down inside a field must be one the encoding claims as field content.
/// This is the invariant the generic checkers rest on: if `field_symbols` and `init_reg` disagree,
/// the bank looks corrupt from step zero.
#[test]
fn init_reg_only_uses_declared_field_symbols() {
    let enc = Unary::at(8);
    let cells = enc.init_reg(3);
    for (i, c) in cells.iter().enumerate() {
        if i % 9 == 0 {
            assert_eq!(*c, SEP, "cell {i} should be a delimiter");
        } else {
            assert!(enc.field_symbols().contains(c), "cell {i} is `{c}`, not declared field content");
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --lib unary_field_symbols_are_mark_and_blank 2>&1 | tail -10
```

Expected: FAIL — `no method named 'field_symbols' found`.

- [ ] **Step 3: Add `ZERO` and the trait method**

In `crates/redextape-core/src/tm/build.rs`, after `pub const AT: Symbol = '@';`:

```rust
/// The binary zero digit. `MARK` (`'1'`) doubles as the one digit, so base 2 costs exactly one new
/// symbol. The TM text form needs no change: `syntax::parse_sym` accepts any single char.
pub const ZERO: Symbol = '0';
```

In `crates/redextape-core/src/tm.rs`, add `ZERO` to the `pub use build::{...}` list (line 23-25).

In `crates/redextape-core/src/tm/encoding.rs`, add to the trait, after `field_width`:

```rust
    /// The symbols that may legally appear INSIDE a field — never `SEP`, which delimits fields rather
    /// than filling them. Unary fields hold marks and padding blanks; binary fields hold digits.
    ///
    /// This exists for the bank-safety checkers. They verify the bank's SKELETON — right length, `#`
    /// at every boundary, nothing but field content in between — and "field content" is the one part
    /// of that property the encoding gets to define.
    fn field_symbols(&self) -> &'static [Symbol];
```

In `crates/redextape-core/src/tm/encoding/unary.rs`, in `impl Encoding for Unary`:

```rust
    fn field_symbols(&self) -> &'static [Symbol] {
        &[MARK, BLANK]
    }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cargo test -p redextape-core --lib field_symbols 2>&1 | tail -10
cargo test -p redextape-core --lib init_reg_only_uses_declared 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Make the three checkers encoding-generic**

In `crates/redextape-core/tests/common/mod.rs`, replace the import line and the three functions' signatures and bodies. The doc comments stay as they are — every word of them is still true — with the one sentence about "marks or blanks" reworded.

```rust
use redextape_core::tm::{AT, BLANK, Encoding, Machine, SEP};

/// The width every generic checker measures against. A bounded encoding reports its field width;
/// an unbounded one has no fixed skeleton to check, so the checkers refuse rather than guess.
fn width_of(enc: &dyn Encoding) -> usize {
    enc.field_width().expect("bank-shape checkers require a bounded encoding")
}
```

`reg_bank_is_well_formed` — same body, two changes:

```rust
pub fn reg_bank_is_well_formed(cells: &[char], enc: &dyn Encoding, slots: usize) -> Result<(), String> {
    let width = width_of(enc);
    let content = enc.field_symbols();
    let expected = 1 + slots * (width + 1);
    if cells.len() != expected {
        return Err(format!("bank is {} cells, expected {expected}", cells.len()));
    }
    if cells[0] != SEP {
        return Err(format!("bank must start with `{SEP}`, got `{}`", cells[0]));
    }
    for s in 0..slots {
        let base = 1 + s * (width + 1);
        if cells[base + width] != SEP {
            return Err(format!("field {s} is not closed by `{SEP}`, got `{}`", cells[base + width]));
        }
        if let Some(bad) = cells[base..base + width].iter().find(|c| !content.contains(c)) {
            return Err(format!("field {s} holds `{bad}`, which is not field content for this encoding"));
        }
    }
    Ok(())
}
```

`box_tape_is_well_formed` — same body, `width` from `enc`, `!content.contains(&c)` in place of `c != MARK && c != BLANK`:

```rust
pub fn box_tape_is_well_formed(cells: &[char], enc: &dyn Encoding) -> Result<(), String> {
    let width = width_of(enc);
    let content = enc.field_symbols();
    let mut i = 0usize;
    let mut field = 0usize;
    while i < cells.len() && cells[i] == SEP {
        let window = i + 1;
        let end = (window + width).min(cells.len());
        if let Some(off) = cells[window..end].iter().position(|c| !content.contains(c)) {
            return Err(format!("box field {field} cell {off} is `{}`, not field content", cells[window + off]));
        }
        i = window + width;
        field += 1;
    }
    if let Some(bad) = cells[i.min(cells.len())..].iter().position(|&c| c != BLANK) {
        return Err(format!(
            "after {field} field(s) cell {} is `{}`, but the top must be blank",
            i + bad,
            cells[i + bad]
        ));
    }
    Ok(())
}
```

`heap_tape_is_well_formed` — the head/tail *word* is what follows the encoding, so the mark-runs become content-runs. Under `Unary` a word is a variable-length run; under `Binary` it is exactly `width` digits. Both are covered by "a run of field-content symbols", so the loop shape is unchanged:

```rust
pub fn heap_tape_is_well_formed(cells: &[char], enc: &dyn Encoding) -> Result<(), String> {
    let content = enc.field_symbols();
    // Under unary a word is a variable-length run of marks and a zero word is empty; under binary it
    // is exactly `width` digits. "A run of field content" covers both, which is why this stayed one
    // loop. It deliberately does NOT check word LENGTH — that would be a different property, and
    // claiming it here without checking it is the failure mode this suite keeps finding.
    let mut i = 0usize;
    while i < cells.len() && cells[i] == BLANK {
        i += 1;
    }
    let mut cell = 0usize;
    while i < cells.len() && cells[i] == AT {
        i += 1; // the `@`
        while i < cells.len() && content.contains(&cells[i]) && cells[i] != BLANK {
            i += 1; // head word
        }
        if i >= cells.len() || cells[i] != SEP {
            return Err(format!("cons cell {cell} has no `{SEP}` between head and tail (at index {i})"));
        }
        i += 1; // the `#`
        while i < cells.len() && content.contains(&cells[i]) && cells[i] != BLANK {
            i += 1; // tail word
        }
        cell += 1;
    }
    if let Some(off) = cells[i.min(cells.len())..].iter().position(|&c| c != BLANK) {
        return Err(format!(
            "after {cell} cons cell(s), cell {} is `{}` but the heap must be blank to the end",
            i + off,
            cells[i + off]
        ));
    }
    Ok(())
}
```

**The `&& cells[i] != BLANK` is load-bearing and must not be simplified away.** `Unary::field_symbols()` includes `BLANK` (a padded field's tail), but on the HEAP a blank means *the end of the cell region*, not content. Without the exclusion the walk would run off the last cell into the top and report a well-formed heap of unbounded length. Binary does not declare `BLANK` as content, so the clause is a no-op there.

- [ ] **Step 6: Update the three call sites**

`crates/redextape-core/tests/tm_bank_invariant.rs`, `tm_exhaustive_bank_safety.rs`: `reg_bank_is_well_formed(&cells, width, slots)` → `reg_bank_is_well_formed(&cells, enc, slots)`, and `box_tape_is_well_formed(&cells, width)` → `box_tape_is_well_formed(&cells, enc)`. Both files already have the encoding in scope at each call site (they construct `Unary::at(width)` to build the machine).

`crates/redextape-core/tests/tm_heap_stack_shape.rs`: `heap_tape_is_well_formed(&cells)` → `heap_tape_is_well_formed(&cells, &Unary::default())`.

- [ ] **Step 7: Run the tests**

```bash
cargo test -p redextape-core 2>&1 | tail -20
```

Expected: PASS, same test count as Task 1.

- [ ] **Step 8: Sabotage-verify the checkers still bite**

The checkers were just rewritten; a rewrite that always returns `Ok` passes every test. Prove otherwise. Temporarily change `Unary::field_symbols` to `&[MARK, BLANK, SEP]` and run:

```bash
cargo test -p redextape-core --test tm_bank_invariant 2>&1 | tail -10
```

Expected: still PASS — because a well-formed bank has no interior `SEP` regardless. That is not the sabotage. Instead, temporarily change `reg_bank_is_well_formed`'s `expected` to `cells.len()` and run the same command.

Expected: **FAIL is not guaranteed either** — the length check is only one clause. The sabotage that must go red: in `crates/redextape-core/src/tm/encoding/unary.rs`, in `append_work_to_field`, delete the overflow-guard rule (the `b.add_rule(wr, RuleSpec::new().on(REG, Some(SEP), None, Move::S), overflow);` line), then:

```bash
cargo test -p redextape-core --test tm_bank_invariant 2>&1 | tail -20
```

Expected: **FAIL**, reporting a field not closed by `#`. Restore the line and confirm green. Record the observed failure message in the commit body.

- [ ] **Step 9: Commit**

```bash
git add -A crates/redextape-core/src crates/redextape-core/tests
git commit -m "refactor(tm): ZERO, field_symbols(), and encoding-generic bank checkers

The bank-safety ladder verifies a SKELETON — right length, # at every
boundary, nothing but field content in between. Two of those three clauses
are encoding-independent already; the third hardcoded 'a mark or a blank'.
field_symbols() is the encoding's answer to exactly that clause, and it is
what makes the ladder reusable for a second encoding rather than a thing
that verifies only unary.

heap_tape_is_well_formed additionally excludes BLANK from the content walk.
Unary declares BLANK as field content (a padded field's tail), but on the
HEAP a blank ends the cell region; without the exclusion the walk runs off
the last cell into the top and reports a well-formed heap of any length.

Sabotage-verified: deleting append_work_to_field's overflow guard turns
tm_bank_invariant red on 'field N is not closed by #'.

No behaviour change. ZERO is added but unused until the Binary impl."
```

---

### Task 3: `parse_heap_cells` moves onto the trait

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (trait method)
- Modify: `crates/redextape-core/src/tm/encoding/unary.rs` (impl; the free fn becomes a method body)
- Modify: `crates/redextape-core/src/tm/decode.rs:11,19`

**Interfaces:**
- Consumes: Task 1's module layout.
- Produces: `fn parse_heap_cells(&self, cells: &[Symbol]) -> Vec<(u64, u64)>;` on `Encoding`. Returns the heap's cons cells in address order, so `result[p - 1]` is the cell at 1-based pointer `p`.

**Why:** this is the seam's one real leak. `decode_tape` takes `enc: &dyn Encoding` and then calls a free function that hardcodes `@ <head marks> # <tail marks>`. A binary heap decodes to garbage through it, silently, and nothing in the type system says so.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/tm/decode.rs`'s `mod tests`:

```rust
/// `decode_tape` must read the HEAP through the ENCODING, not through a hardcoded unary parser.
/// The regression this pins: `decode_tape` took `enc` and then called the free `parse_heap_cells`,
/// so the heap half of the decode ignored `enc` entirely. A tape built by one encoding and decoded
/// by another must not silently produce a plausible answer.
#[test]
fn decode_reads_the_heap_through_the_encoding() {
    let enc = Unary::default();
    // `@ 1 # 1 1` — one cons cell, head 1, tail 2 — as the unary encoding lays it out.
    let heap: Vec<char> = "@1#11".chars().collect();
    assert_eq!(enc.parse_heap_cells(&heap), vec![(1, 2)]);
    // The empty heap has no cells, at any width.
    assert_eq!(enc.parse_heap_cells(&[]), vec![]);
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --lib decode_reads_the_heap_through_the_encoding 2>&1 | tail -10
```

Expected: FAIL — `no method named 'parse_heap_cells' found for struct 'Unary'`.

- [ ] **Step 3: Add the trait method**

In `crates/redextape-core/src/tm/encoding.rs`, after `field_symbols`:

```rust
    /// Parse a final HEAP tape into its cons cells, in address order: `result[p - 1]` is the cell at
    /// 1-based pointer `p` (`nil` is pointer 0 and has no cell). The cell's DELIMITERS (`@`, `#`) are
    /// structural and identical across encodings; its head and tail WORDS are values, so reading them
    /// is the encoding's job — which is why this is a trait method and not a free function.
    ///
    /// Total: a malformed or truncated tape yields the cells parsed so far, never a panic.
    fn parse_heap_cells(&self, cells: &[Symbol]) -> Vec<(u64, u64)>;
```

- [ ] **Step 4: Turn the free function into the `Unary` impl**

In `crates/redextape-core/src/tm/encoding/unary.rs`, move the body of `pub(crate) fn parse_heap_cells` into `impl Encoding for Unary` as:

```rust
    fn parse_heap_cells(&self, cells: &[Symbol]) -> Vec<(u64, u64)> {
        // body moved verbatim from the free function
    }
```

Delete the free function.

- [ ] **Step 5: Fix `decode.rs`**

`crates/redextape-core/src/tm/decode.rs`, line 11:

```rust
use crate::tm::encoding::Encoding;
```

Line 19:

```rust
    let heap = enc.parse_heap_cells(&tapes.get(HEAP)?.snapshot().0);
```

- [ ] **Step 6: Run the tests**

```bash
cargo test -p redextape-core 2>&1 | tail -20
```

Expected: PASS, same count.

- [ ] **Step 7: Commit**

```bash
git add -A crates/redextape-core/src/tm
git commit -m "refactor(tm): parse_heap_cells moves onto the Encoding trait

The seam's one real leak, and the kind a trait with a single implementation
cannot reveal: decode_tape takes &dyn Encoding and then called the FREE fn
parse_heap_cells, which hardcodes '@ <head marks> # <tail marks>'. The heap
half of the decode ignored enc entirely — correct by coincidence while Unary
was the only impl, and a silent wrong answer the moment it is not.

No behaviour change: Unary's parser is the same code, now reached through
the trait."
```

---

### Task 4: `init_work()` and a WORK-initializing `attempt`

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (trait method)
- Modify: `crates/redextape-core/src/tm/encoding/unary.rs` (impl returning empty)
- Modify: `crates/redextape-core/src/tm.rs:95-104` (`attempt`)

**Interfaces:**
- Consumes: Task 1's module layout.
- Produces: `fn init_work(&self) -> Vec<Symbol>;` on `Encoding`. `Unary` returns `vec![]`. `Binary` (Task 6) returns a three-field bank.

**Why:** `Binary`'s operands are fixed-width digit strings and `mul` needs three of them live at once, so WORK becomes a `#`-delimited bank like REG. Unary's WORK is an unstructured run of marks that gadgets build from empty, so its initializer is empty and **today's behaviour stays bit-identical**.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/tm.rs`'s `mod run_tm_tests`:

```rust
/// `attempt` initializes WORK from the encoding, and for unary that must be EMPTY — the same tape
/// unary gadgets have always started from. This pins the "no behaviour change" half of adding the
/// method: a non-empty unary WORK would shift every step count in the goldens.
#[test]
fn unary_starts_with_an_empty_work_tape() {
    assert_eq!(Unary::default().init_work(), Vec::<Symbol>::new());
    assert_eq!(Unary::at(4).init_work(), Vec::<Symbol>::new());
}
```

Add `use crate::tm::machine::Symbol;` to that test module if not already in scope.

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --lib unary_starts_with_an_empty_work_tape 2>&1 | tail -10
```

Expected: FAIL — `no method named 'init_work'`.

- [ ] **Step 3: Add the trait method and the unary impl**

In `crates/redextape-core/src/tm/encoding.rs`, after `init_reg`:

```rust
    /// The initial WORK (scratch) tape. Unary builds its scratch from an empty tape as it goes, so it
    /// returns nothing; binary needs a `#`-delimited bank of fixed-width fields, because its operands
    /// are fixed-width digit strings and `mul` keeps three live at once.
    ///
    /// An encoding returning a non-empty WORK is declaring WORK to be a fixed-width tape, which is
    /// what `assert_delimiter_safe` keys off when deciding whether to check WORK for delimiter safety.
    fn init_work(&self) -> Vec<Symbol>;
```

In `crates/redextape-core/src/tm/encoding/unary.rs`:

```rust
    fn init_work(&self) -> Vec<Symbol> {
        // Unary scratch is an unstructured run of marks that every gadget clears before use
        // (`clear_work`) and finds the end of by scanning to a blank. There is nothing to lay out.
        Vec::new()
    }
```

- [ ] **Step 4: Wire it into `attempt`**

`crates/redextape-core/src/tm.rs`, in `fn attempt`:

```rust
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots);
    init[WORK] = enc.init_work();
```

Add `WORK` to the `pub use build::{...}` import list at the top of `tm.rs` if it is not already there (it is exported at line 24, so the `use` inside the module body may need it).

- [ ] **Step 5: Run the tests and confirm no golden moved**

```bash
cargo test -p redextape-core 2>&1 | tail -20
cargo test -p redextape-core golden 2>&1 | tail -10
```

Expected: PASS, and **every step-count golden identical**. Unary's initializer is empty, so `init[WORK]` is the same empty vector it was.

- [ ] **Step 6: Commit**

```bash
git add -A crates/redextape-core/src/tm crates/redextape-core/src/tm.rs
git commit -m "feat(tm): Encoding::init_work, and attempt() initializes WORK

Binary needs structured scratch: its operands are fixed-width digit strings
and mul keeps three live at once (accumulator, shifted multiplicand,
multiplier), so WORK becomes a #-delimited bank like REG. Unary builds its
scratch from an empty tape as it goes, so its initializer is empty and every
step count is unchanged — which is the check.

A non-empty init_work is also how assert_delimiter_safe learns that WORK is
a fixed-width tape worth checking for delimiter safety."
```

---

### Task 5: Generalize `seek_slot` and `rewind_home` over (tape, content)

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (both functions)
- Modify: `crates/redextape-core/src/tm/encoding/unary.rs` (every call site)

**Interfaces:**
- Consumes: Task 1's module layout.
- Produces:
  ```rust
  pub(crate) fn seek_slot(
      b: &mut Builder, from: StateId, tape: usize, content: &[Symbol], slot: Slot, label: &str,
  ) -> StateId;

  pub(crate) fn rewind_home(
      b: &mut Builder, from: StateId, tape: usize, content: &[Symbol], slot: Slot, label: &str,
  ) -> StateId;
  ```
  `Unary` calls both with `(REG, &[MARK, BLANK])`. `Binary` calls them with `(REG, &[ZERO, MARK])` and `(WORK, &[ZERO, MARK])`.

**Why:** these two implement the bank's *skeleton* navigation — count `#`s to reach field `k`, count `#`s back to home — which is identical for every encoding laying out a `#`-delimited equal-width bank. They currently hardcode `REG` and enumerate `MARK`/`BLANK` inline. Binary needs the same walk on WORK over digits.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/tm/encoding.rs` a new `mod tests` (the module root has none yet):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::build::{MARK, REG, TAPES, WORK};
    use crate::tm::machine::BLANK;
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
        let _ = (REG, BLANK); // imports shared with other tests in this module
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --lib seek_and_rewind_navigate_any_tape 2>&1 | tail -15
```

Expected: FAIL to compile — `seek_slot` takes 4 arguments, 6 supplied.

- [ ] **Step 3: Generalize both functions**

In `crates/redextape-core/src/tm/encoding.rs`, replace the two moved functions with:

```rust
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
```

**Rule order is preserved.** The originals added `MARK` then `BLANK` then `SEP`; `&[MARK, BLANK]` iterated in order emits exactly that sequence, and the `SEP` rule still comes last. This matters because rule lookup is first-match-wins with no overlap check — a reordering here would be a silent behaviour change, and the step-count goldens are what proves it did not happen.

- [ ] **Step 4: Update every call site in `unary.rs`**

There are 14. Each `seek_slot(b, x, slot, label)` becomes `seek_slot(b, x, REG, &[MARK, BLANK], slot, label)`, and likewise for `rewind_home`. Define a file-local constant at the top of `unary.rs` to keep the call sites readable:

```rust
/// Unary field content, in the rule order the gadgets were built with: marks first, then padding.
const UNARY_CONTENT: &[Symbol] = &[MARK, BLANK];
```

and call `seek_slot(b, from, REG, UNARY_CONTENT, slot, label)`.

```bash
grep -c "seek_slot(\|rewind_home(" crates/redextape-core/src/tm/encoding/unary.rs
```

Expected: 14 or more (the definition lines are gone, so every hit is a call site).

- [ ] **Step 5: Run the tests and confirm no golden moved**

```bash
cargo test -p redextape-core 2>&1 | tail -20
cargo test -p redextape-core golden 2>&1 | tail -10
```

Expected: PASS, and **every step-count golden identical**. If a golden moved, the rule order changed — check that `UNARY_CONTENT` is `[MARK, BLANK]` and not `[BLANK, MARK]`.

- [ ] **Step 6: Commit**

```bash
git add -A crates/redextape-core/src/tm
git commit -m "refactor(tm): seek_slot/rewind_home take a tape and a content alphabet

These two implement the bank SKELETON's navigation — count #s out to field
k, count #s back to home — which is identical for any encoding laying out a
#-delimited equal-width bank. They hardcoded REG and enumerated MARK/BLANK
inline. Binary needs the same walk on WORK over digits.

Rule insertion order is preserved exactly (content first in the given order,
SEP last). Lookup is first-match-wins with no overlap check in validate(),
so a reordering here would be a silent behaviour change; every step-count
golden is unchanged, which is the check.

The new test runs the pair on WORK over the binary digit set — a combination
no unary gadget produces, and the case the generalization exists for."
```

---

# Phase 2 — The binary gadget library

Eight tasks building `crates/redextape-core/src/tm/encoding/binary.rs`. `Binary` is not reachable from `run_tm` until Phase 3, so every task here is verified by its own unit tests running gadgets directly on a `Builder` — the same way `Unary`'s gadget tests work.

## MANDATORY for every test in Tasks 8–13: use the existing harness, never a bare `simulate`

**Added after the Task 7 review, which found this the hard way. This overrides any test code below that calls `simulate` directly — several snippets in Tasks 11–13 do, and those snippets are wrong.**

`sim::simulate` returns `Status::Halted` for **two different outcomes**, with nothing in the value to tell them apart: the machine reached its accept state, and the machine got **stuck** with no matching rule. A test asserting `status == Halted` therefore **scores a stuck machine as a pass**, and can only fail if some downstream value assertion happens to notice.

That is not hypothetical. The Task 7 review ran the mutation empirically: with `copy_field`'s loop changed from `0..width` to `0..width + 1`, *all four* assertions of `mov_leaves_the_work_bank_skeleton_intact` passed — including the three the test is NAMED for. A walks-too-far bug in this design can never reach a delimiter, because the phantom extra step needs a digit read that `#` cannot satisfy, so the machine gets stuck one transition *before* corrupting anything, with the tape already correct.

`crates/redextape-core/tests/tm_binary_gadgets.rs` now provides a harness that draws the line, built on `simulate_final` (which reports the ending STATE, the same tool `tm.rs::attempt` uses to tell a real halt from the overflow guard):

| helper | use it for | contract |
|---|---|---|
| `run_gadget(width, slots, body) -> Option<Vec<char>>` | the common case; returns the final REG tape | `None` only if the run hit a cap; **panics** if it halted anywhere but the accept state |
| `run_gadget_tapes(width, slots, body) -> Option<Vec<Vec<char>>>` | tests needing STACK / HEAP / BOX / WORK — index by `REG`/`WORK`/`STACK`/`HEAP`/`BOX` | same accept-state contract |
| `run_gadget_expect_stuck(width, slots, body) -> Vec<char>` | a test that DELIBERATELY wants a non-accept halt, e.g. landing in the rule-less overflow guard | asserts the run halted somewhere other than accept |
| `run_gadget_raw` / `require_accepted` | building a new helper | the primitives the three above are made of |

**Do not write `run_stack`, `run_heap`, or `run_box`.** Use `run_gadget_tapes`. Any snippet below that builds a `Builder` by hand and calls `simulate` is superseded by this table; port it. A fault test that expects `TmStatus::HitCap` (a nil dereference spinning) is still correct to write directly, because a cap is not a halt — but say so in the test's doc comment.

## A refinement of the spec, discovered while planning

**The spec says WORK gets three scratch fields (accumulator, shifted multiplicand, multiplier). It needs one.** Two design choices collapse it:

1. **`mul` processes the multiplier MSB-first and shifts the ACCUMULATOR, not the multiplicand.** `acc = 0; for i in (0..w).rev() { acc <<= 1; if bit_i(rb) { acc += ra } }`. The multiplicand `ra` stays a read-only REG field, and `bit_i(rb)` is read directly out of REG at build-time-known offset `i`, so there is no multiplier register and no loop counter. The loop is unrolled at build time — `w` iterations of O(1) states each.
2. **`eq` needs no parking field.** `eq(ra, rb) = is_zero(monus(ra, rb) + monus(rb, ra))`, and that sum can never overflow because **one of the two monus terms is always zero** — the sum is exactly `|ra - rb| ≤ max(ra, rb) < 2^w`. The intermediate parks in REG `rd`, which is a fresh temporary, exactly as `Unary::eq_to_work` already does.

The cost of (1) is state count, and **this plan originally stated that cost wrongly — the Task 9 review measured it.** The claim was O(`w`) states, "several hundred at `w = 64`". Both the magnitude and the asymptotic class were wrong. `shift_left_acc` allocates one state per digit in its counted walk to the MSB, so a single call is O(`w`) states, not O(1); and `mul` calls it — plus `bit_is_one` — once per each of its `w` unrolled iterations, so `mul` is **O(`w`²)**. Counting every `b.state()` across `zero_field`/`shift_left_acc`/`bit_is_one`/`ripple_add`/`copy_field` for the gadget tests' three-slot layout gives the closed form **`1.5w² + 26.5w + 13`** for the states `mul` ITSELF allocates: measured **143** at `w = 4`, **821** at `w = 16`, **7,853** at `w = 64` — not several hundred, a ~16-20x understatement on top of the wrong exponent. **State which quantity you mean when quoting this.** A first pass at the formula said `+ 15` (145 / 823 / 7,855); that is the same measurement counting the enclosing machine's `start` and `halt` states as well, which the gadget does not create. Both are right about different things, and the difference is exactly 2 at every width. Still recorded as a known trade rather than optimized, but Task 17's measurement should report it, since a program with several `mul`s at a wide bank is where it shows up.

**Update the spec's §3.3 table to one field when Task 6 lands.**

---

### Task 6: `Binary` — layout, decode, `write_literal`, `jz`

**Files:**
- Create: `crates/redextape-core/src/tm/encoding/binary.rs`
- Create: `crates/redextape-core/tests/tm_binary_gadgets.rs`
- Modify: `crates/redextape-core/src/tm/encoding.rs` (`pub mod binary; pub use binary::Binary;`)
- Modify: `crates/redextape-core/src/tm.rs` (`pub use encoding::{Binary, Encoding, Unary};`)

**Interfaces:**
- Consumes: Tasks 1–5 — `seek_slot`/`rewind_home` with `(tape, content)`, `ZERO`, `field_symbols`, `init_work`, `parse_heap_cells`.
- Produces:
  ```rust
  pub struct Binary;                         // Copy + Clone + Debug + Default
  impl Binary {
      pub const fn at(width: usize) -> Binary;
      const fn fits(&self, n: u64) -> bool;   // n < 2^width, guarding the shift at width == 64
      fn bit(n: u64, i: usize) -> Symbol;     // ZERO or MARK
  }
  pub(crate) const BITS: &[Symbol];           // &[ZERO, MARK]
  pub(crate) const W_ACC: Slot = 0;           // the single WORK scratch field
  ```
  Trait methods implemented in this task: `field_width`, `at_width`, `field_symbols`, `init_reg`, `init_work`, `decode_nat`, `write_literal`, `jz`. Every other trait method gets a stub routing `entry` to a fresh **rule-less non-accept state**, with a `// Task N` comment naming its replacement.

**Note on the stubs.** Two things a stub must NOT be. Not `unimplemented!()` — totality is the cardinal rule and these are live code for the length of Phase 2. And not `b.overflow()` — overflow has a specific meaning (*this bank is too narrow, retry wider*) that `run_tm_fitted` acts on, so a stub routed there would be misclassified as an `Overflow` outcome rather than as "not built yet". A rule-less state halts, which is total, and is not confusable with either.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-core/tests/tm_binary_gadgets.rs`:

```rust
//! Gadget-level tests for the binary `Encoding`, mirroring `tm_encoding.rs`'s role for `Unary`.
//!
//! Each test builds a tiny machine that runs ONE gadget on a freshly laid-out bank, simulates it, and
//! reads the result back with `decode_nat`. Nothing here goes through `lower_tm` or `run_tm` — those
//! arrive in Phase 3 — so a failure here localizes to a single gadget.

use redextape_core::tm::{
    Binary, Builder, Encoding, MARK, Move, REG, RuleSpec, SEP, TAPES, TM_DEFAULT_CAPS, TmStatus, WORK, ZERO,
    simulate,
};

/// Build a one-gadget machine over a `slots`-field bank at `width`, run it, and return the final REG
/// tape — or `None` if the machine did not halt (the overflow guard is rule-less, so a guarded run
/// halts and is distinguished by the caller reading the tape).
fn run_gadget(
    width: usize,
    slots: u32,
    body: impl FnOnce(&Binary, &mut Builder, redextape_core::tm::StateId, redextape_core::tm::StateId),
) -> Option<Vec<char>> {
    let enc = Binary::at(width);
    let mut b = Builder::new();
    let start = b.state("start");
    let halt = b.accept("halt");
    body(&enc, &mut b, start, halt);
    let m = b.finish(start);
    assert!(m.validate().is_empty(), "{:?}", m.validate());
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(slots);
    init[WORK] = enc.init_work();
    let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
    (status == TmStatus::Halted).then(|| tapes[REG].snapshot().0)
}

/// A `w`-cell field is `w` digits LSB-FIRST, with no padding: value 5 at width 4 is `1010`, not
/// `0101` and not `101_`. The digit ORDER is the one thing every later gadget depends on, so it is
/// asserted against the literal tape rather than only round-tripped through `decode_nat`.
#[test]
fn a_literal_is_written_lsb_first_with_no_padding() {
    let cells = run_gadget(4, 1, |enc, b, start, halt| enc.write_literal(b, start, halt, 5, 0)).unwrap();
    assert_eq!(cells, vec![SEP, MARK, ZERO, MARK, ZERO, SEP], "5 at width 4 is 1010 LSB-first");
}

/// `decode_nat` is the inverse of `write_literal` over the whole representable range, and a `w`-cell
/// field holds `2^w` values — not `w` of them. Width 4 reaching 15 is the capability the whole slice
/// exists for: unary's 4-cell field stops at 3.
#[test]
fn write_then_decode_roundtrips_the_full_range() {
    let enc = Binary::at(4);
    for n in 0..16u64 {
        let cells = run_gadget(4, 1, |e, b, start, halt| e.write_literal(b, start, halt, n, 0)).unwrap();
        assert_eq!(enc.decode_nat(&cells, 0), Some(n), "n = {n}");
    }
}

/// A literal that does not fit is a COMPILE-TIME fact, so it emits a bare route to the shared guard
/// and no write chain at all — mirroring `Unary`'s static-guard arm. The machine halts in the
/// rule-less guard state, so the bank is left pristine.
#[test]
fn an_oversized_literal_routes_to_the_guard() {
    let cells = run_gadget(4, 1, |enc, b, start, halt| enc.write_literal(b, start, halt, 16, 0)).unwrap();
    assert_eq!(cells, vec![SEP, ZERO, ZERO, ZERO, ZERO, SEP], "the guard must not have written anything");
}

/// `write_literal` must leave the head at home and the bank's OTHER fields untouched — the home
/// convention every gadget composes on.
#[test]
fn write_literal_leaves_neighbouring_fields_alone() {
    let cells = run_gadget(4, 3, |enc, b, start, halt| enc.write_literal(b, start, halt, 15, 1)).unwrap();
    let enc = Binary::at(4);
    assert_eq!(enc.decode_nat(&cells, 0), Some(0));
    assert_eq!(enc.decode_nat(&cells, 1), Some(15));
    assert_eq!(enc.decode_nat(&cells, 2), Some(0));
}

/// `jz` branches on the WHOLE field being zero, not on its first digit. Value 2 at width 4 is `0100`
/// — a leading ZERO — so a `jz` that only looked at the first cell (the way the unary one legitimately
/// can) would call it zero. That is the defect this test exists to catch.
#[test]
fn jz_branches_on_the_whole_field_not_the_first_digit() {
    for (v, expect_zero) in [(0u64, true), (1, false), (2, false), (8, false), (15, false)] {
        let cells = run_gadget(4, 2, |enc, b, start, halt| {
            let after = b.state("after");
            enc.write_literal(b, start, after, v, 0);
            let zero = b.state("zero");
            let nonzero = b.state("nonzero");
            enc.jz(b, after, zero, nonzero, 0);
            // Record which branch was taken in field 1: 1 = zero-branch, 2 = nonzero-branch.
            enc.write_literal(b, zero, halt, 1, 1);
            enc.write_literal(b, nonzero, halt, 2, 1);
        })
        .unwrap();
        let enc = Binary::at(4);
        let expected = if expect_zero { 1 } else { 2 };
        assert_eq!(enc.decode_nat(&cells, 1), Some(expected), "v = {v}");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --test tm_binary_gadgets 2>&1 | tail -10
```

Expected: FAIL to compile — `unresolved import redextape_core::tm::Binary`.

- [ ] **Step 3: Create `binary.rs` with the layout half**

Create `crates/redextape-core/src/tm/encoding/binary.rs`:

```rust
//! The base-2 `Encoding`: a value is exactly `width` digits, LSB-FIRST — the leftmost cell of a field
//! is 2⁰ — so a `w`-cell field holds `0 ..= 2^w - 1` and a 64-cell field is exactly a `u64`.
//!
//! Two properties distinguish every gadget here from its unary counterpart, and both come from the
//! same fact: a field is FULL of digits rather than marks-then-padding.
//!
//!   * **Counted, not content-driven.** A gadget walks exactly `width` cells and stops, instead of
//!     scanning to a blank. This is the style the BOX tape already uses, generalized to every tape.
//!   * **No strict bound.** `MAX_FIELD_WIDTH`'s "a padding blank must always remain" (and the
//!     `rewind_home` miscount it prevents) is an artifact of content-driven loops over a mark/blank
//!     alphabet. It has no analogue here: every field is the same length and both digits are content.
//!
//! Overflow is still real, and still routes to `Builder::overflow()`: a carry out of the top digit, a
//! 1 shifted out of the top by `mul`, or a literal needing more than `width` digits.

use crate::core::BinOp;
use crate::tm::build::{Builder, MARK, MAX_FIELD_WIDTH, Move, REG, RuleSpec, SEP, Slot, WORK, ZERO};
use crate::tm::encoding::{Encoding, rewind_home, seek_slot};
use crate::tm::machine::{StateId, Symbol};

/// Binary field content, in a fixed rule order: `ZERO` then `MARK`. Passed to every `seek_slot` /
/// `rewind_home` call so the skeleton walk crosses digits and halts only on `#`.
pub(crate) const BITS: &[Symbol] = &[ZERO, MARK];

/// The single WORK scratch field. Every gadget that must move a value between two fields of the same
/// tape bounces it through here, because a tape has one head.
///
/// One field is enough because `mul` shifts the ACCUMULATOR rather than the multiplicand (so there is
/// no multiplier register and no loop counter — the loop is unrolled at build time), and `eq` parks
/// its intermediate in REG `rd`, a fresh temporary, exactly as `Unary::eq_to_work` does.
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
```

- [ ] **Step 4: Implement the eight trait methods, and stub the rest**

Append to `binary.rs`:

```rust
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

    fn mov(&self, b: &mut Builder, entry: StateId, _exit: StateId, _rs: Slot, _rd: Slot) {
        stub(b, entry, 7); // replaced in Task 7
    }
    // ... one such stub per remaining trait method, each naming the task that replaces it.
}

/// A not-yet-implemented gadget: halt in a fresh rule-less, non-accept state.
///
/// Deliberately NOT `b.overflow()`. Overflow means "this bank is too narrow, retry wider" and
/// `run_tm_fitted` acts on it, so a stub routed there would come back as a resource outcome rather
/// than as "not built yet". A rule-less state halts — which keeps the impl total — and is not
/// confusable with either. `Binary` is unreachable from `run_tm` until Phase 3, so no stub survives
/// into a reachable machine.
/// `task` is the plan task number that replaces this stub. State names must stay identifier-shaped so
/// the machine round-trips through the TM text form, hence a number rather than a prose label.
fn stub(b: &mut Builder, entry: StateId, task: u32) {
    let s = b.state(format!("binary.todo{task}.{entry}"));
    b.add_rule(entry, RuleSpec::new(), s);
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
```

- [ ] **Step 5: Export `Binary`**

`crates/redextape-core/src/tm/encoding.rs`: add `pub mod binary;` and `pub use binary::Binary;`.
`crates/redextape-core/src/tm.rs` line 28: `pub use encoding::{Binary, Encoding, Unary};`.
Also confirm `ZERO`, `WORK`, `StateId` are in `tm.rs`'s re-export lists (the new test imports them).

- [ ] **Step 6: Run the tests**

```bash
cargo test -p redextape-core --test tm_binary_gadgets 2>&1 | tail -20
```

Expected: all five PASS.

```bash
cargo test -p redextape-core 2>&1 | tail -5
```

Expected: PASS, and no unary golden moved.

- [ ] **Step 7: Sabotage-verify the digit order**

Change `Binary::bit` to `(n >> (self.width - 1 - i)) & 1` (MSB-first) and run:

```bash
cargo test -p redextape-core --test tm_binary_gadgets a_literal_is_written_lsb_first 2>&1 | tail -10
```

Expected: **FAIL** with `[#, 1, 0, 1, 0, #]` vs `[#, 0, 1, 0, 1, #]`. Restore and confirm green. Then delete `branch_on_zero`'s `ZERO -> R` scan rule so it only inspects the first digit and run `jz_branches_on_the_whole_field`; expected: **FAIL on v = 2**.

- [ ] **Step 8: Commit**

```bash
git add -A crates/redextape-core/src/tm crates/redextape-core/tests/tm_binary_gadgets.rs
git commit -m "feat(tm): Binary — layout, decode, write_literal, jz

The base-2 Encoding's skeleton: a value is exactly `width` digits, LSB-first,
so a w-cell field holds 2^w values and a 64-cell field is a full u64. Width 4
already reaches 15 where unary's 4-cell field stops at 3.

Two things worth pinning, both tested:

- The digit ORDER is asserted against the literal tape, not only round-tripped
  through decode_nat. Every later gadget depends on LSB-first, and a decoder
  that agrees with a wrong writer round-trips perfectly.
- jz scans the WHOLE field. Value 2 at width 4 is 0100 — a leading zero — so a
  jz that inspected only the first cell (as a unary one legitimately may) would
  call every even number zero. Sabotage-verified.

Remaining trait methods are stubs that route to the overflow guard rather than
unimplemented!(): totality is the cardinal rule and these are live code for the
length of Phase 2."
```

---

### Task 7: `mov` and the WORK bridge

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding/binary.rs`
- Modify: `crates/redextape-core/tests/tm_binary_gadgets.rs`

**Interfaces:**
- Consumes: Task 6's `BITS`, `W_ACC`, `branch_on_zero`.
- Produces:
  ```rust
  fn copy_digit_step(b: &mut Builder, cur: StateId, next: StateId, src: usize, dst: usize);
  fn copy_field(
      b: &mut Builder, from: StateId, width: usize,
      src_tape: usize, src: Slot, dst_tape: usize, dst: Slot, label: &str,
  ) -> StateId;
  ```
  `copy_field` is the workhorse every later task uses: `arith` loads its first operand with it, `cons` moves values to the HEAP with it, `push_frame` saves locals with it.

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-core/tests/tm_binary_gadgets.rs`:

```rust
/// `mov` copies a field's value, digit for digit, bouncing through WORK because a tape has one head.
#[test]
fn mov_copies_a_field() {
    let enc = Binary::at(4);
    for v in [0u64, 1, 5, 15] {
        let cells = run_gadget(4, 2, |e, b, start, halt| {
            let after = b.state("after");
            e.write_literal(b, start, after, v, 0);
            e.mov(b, after, halt, 0, 1);
        })
        .unwrap();
        assert_eq!(enc.decode_nat(&cells, 0), Some(v), "source must be preserved");
        assert_eq!(enc.decode_nat(&cells, 1), Some(v), "v = {v}");
    }
}

/// `mov` into itself must be the identity, not a clobber — the value round-trips REG -> WORK -> REG.
#[test]
fn mov_into_self_is_identity() {
    let cells = run_gadget(4, 1, |e, b, start, halt| {
        let after = b.state("after");
        e.write_literal(b, start, after, 9, 0);
        e.mov(b, after, halt, 0, 0);
    })
    .unwrap();
    assert_eq!(Binary::at(4).decode_nat(&cells, 0), Some(9));
}

/// The bounce leaves WORK holding the value, and that is fine — but it must leave WORK's SKELETON
/// intact, because every subsequent gadget navigates it by counting `#`s. A copy that walked one cell
/// too far would eat the delimiter and desynchronize every later seek.
#[test]
fn mov_leaves_the_work_bank_skeleton_intact() {
    let enc = Binary::at(4);
    let mut b = Builder::new();
    let start = b.state("start");
    let halt = b.accept("halt");
    let after = b.state("after");
    enc.write_literal(&mut b, start, after, 11, 0);
    enc.mov(&mut b, after, halt, 0, 0);
    let m = b.finish(start);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(1);
    init[WORK] = enc.init_work();
    let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);
    let work = tapes[WORK].snapshot().0;
    assert_eq!(work.len(), 6, "work bank is `#` + 4 digits + `#`");
    assert_eq!(work[0], SEP);
    assert_eq!(work[5], SEP);
    assert_eq!(enc.decode_nat(&work, 0), Some(11), "the bounce left the value in W_ACC");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --test tm_binary_gadgets mov_ 2>&1 | tail -10
```

Expected: FAIL — `mov`'s stub routes to the guard, so `decode_nat(&cells, 1)` is `Some(0)`.

- [ ] **Step 3: Implement the bridge**

Append to `binary.rs` (free functions, before the `impl Encoding` block):

```rust
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
            b.add_rule(
                cur,
                RuleSpec::new().on(src, Some(s), None, Move::R).on(dst, Some(d), Some(s), Move::R),
                next,
            );
        }
    }
}

/// Copy field `src` of `src_tape` into field `dst` of `dst_tape`, digit for digit. `from`: both heads
/// at their tape's home (leading `#`). On exit both heads are home again and `dst` holds `src`'s
/// value; `src` is unchanged.
///
/// Both banks are laid out at the same width by `init_reg`/`init_work`, so the two counted walks stay
/// in step and both heads reach their field's trailing `#` on the same transition.
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
```

Replace the `mov` stub:

```rust
    fn mov(&self, b: &mut Builder, entry: StateId, exit: StateId, rs: Slot, rd: Slot) {
        // REG has one head, so a field-to-field copy must bounce through WORK. `rs == rd` round-trips
        // the same value and is therefore the identity, which the trait's contract requires.
        let l = format!("bmv{rd}s{entry}");
        let up = copy_field(b, entry, self.width, REG, rs, WORK, W_ACC, &format!("{l}.u"));
        let down = copy_field(b, up, self.width, WORK, W_ACC, REG, rd, &format!("{l}.d"));
        b.add_rule(down, RuleSpec::new(), exit);
    }
```

- [ ] **Step 4: Run the tests**

```bash
cargo test -p redextape-core --test tm_binary_gadgets 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 5: Sabotage-verify the counted walk**

Change `copy_field`'s loop bound from `0..width` to `0..width - 1` and run `mov_leaves_the_work_bank_skeleton_intact`.

Expected: **FAIL** — the value's top digit is dropped and the heads end one cell short of the `#`, so `rewind_home` miscounts. Restore and confirm green.

- [ ] **Step 6: Commit**

```bash
git add -A crates/redextape-core/src/tm crates/redextape-core/tests/tm_binary_gadgets.rs
git commit -m "feat(tm): Binary mov, and the copy_field / copy_digit_step bridge

copy_field is the workhorse every later binary gadget uses — arith loads its
first operand with it, cons moves values to the HEAP, push_frame saves locals.
A tape has one head, so any field-to-field copy on ONE tape bounces through
WORK's single scratch field.

copy_digit_step emits four rules (one per src/dst digit pair) rather than one
wildcard rule. That is not verbosity: a non-# write under a wildcard read is
what unsafe_rules rejects, because proving it cannot land on a delimiter needs
head-position reasoning, while an explicit digit read makes it impossible by
construction."
```

---

### Task 8: `arith` — Add and Sub

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding/binary.rs`
- Modify: `crates/redextape-core/tests/tm_binary_gadgets.rs`

**Interfaces:**
- Consumes: Task 7's `copy_field`.
- Produces:
  ```rust
  /// Ripple `rb` (a REG field) into WORK's `W_ACC`, LSB to MSB, carry in the state.
  /// Returns the exit state; a carry out of the top routes to `Builder::overflow()`.
  fn ripple_add(b: &mut Builder, from: StateId, rb: Slot, label: &str) -> StateId;

  /// Ripple-subtract `rb` from `W_ACC` with a borrow. A borrow out of the top means the true result
  /// is negative, so the field is zeroed — matching `saturating_sub`/monus.
  fn ripple_sub(b: &mut Builder, from: StateId, rb: Slot, label: &str) -> StateId;
  ```

**The shape, and why it is O(1) states.** Position does not need to be in the state — only the carry does — so the ripple is a **self-loop over two states** (`c0`, `c1`), exactly like unary's content-driven loops. Both operand fields are `width` wide, so the REG head reaching `rb`'s trailing `#` and the WORK head reaching `W_ACC`'s trailing `#` happen on the same transition.

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-core/tests/tm_binary_gadgets.rs`:

```rust
/// Run `op(a, b)` at `width` into field 2, returning `None` if the machine halted in the guard.
fn arith(width: usize, op: redextape_core::core::BinOp, a: u64, bv: u64) -> Option<u64> {
    let enc = Binary::at(width);
    let cells = run_gadget(width, 3, |e, b, start, halt| {
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        e.write_literal(b, start, s1, a, 0);
        e.write_literal(b, s1, s2, bv, 1);
        e.arith(b, s2, halt, op, 0, 1, 2);
    })?;
    enc.decode_nat(&cells, 2).filter(|_| cells.len() == 1 + 3 * (width + 1))
}

/// Addition across the full representable range at a small width, including every carry chain: 7 + 8
/// exercises a carry out of digit 0 into an all-zero high half, 15 + 0 the no-carry path.
#[test]
fn add_is_exact_over_the_representable_range() {
    use redextape_core::core::BinOp::Add;
    for a in 0..16u64 {
        for bv in 0..16u64 {
            let got = arith(4, Add, a, bv);
            if a + bv < 16 {
                assert_eq!(got, Some(a + bv), "{a} + {bv}");
            } else {
                assert_eq!(got, Some(0), "{a} + {bv} must hit the guard, leaving field 2 untouched");
            }
        }
    }
}

/// Subtraction is MONUS: truncated at zero, matching `interp.rs`'s `saturating_sub`. A borrow out of
/// the top digit must zero the whole field, not wrap to 2^w - 1 — the defect a ripple that simply
/// dropped the final borrow would have.
#[test]
fn sub_is_monus_not_wrapping() {
    use redextape_core::core::BinOp::Sub;
    for a in 0..16u64 {
        for bv in 0..16u64 {
            assert_eq!(arith(4, Sub, a, bv), Some(a.saturating_sub(bv)), "{a} - {bv}");
        }
    }
}

/// The capability the slice exists for, stated as a test: a 4-cell BINARY field computes 9 + 6 = 15,
/// which a 4-cell unary field cannot represent at all (its strict bound stops at 3).
#[test]
fn a_four_cell_binary_field_beats_a_four_cell_unary_field() {
    use redextape_core::core::BinOp::Add;
    assert_eq!(arith(4, Add, 9, 6), Some(15));
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --test tm_binary_gadgets add_is_exact 2>&1 | tail -10
```

Expected: FAIL — `arith`'s stub routes to the guard.

- [ ] **Step 3: Implement `ripple_add`**

```rust
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
```

- [ ] **Step 4: Implement `ripple_sub`**

```rust
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
```

- [ ] **Step 5: Wire them into `arith`**

Replace the `arith` stub (leaving `Mul` routed to the guard until Task 9):

```rust
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
                let overflow = b.overflow();
                b.add_rule(entry, RuleSpec::new(), overflow); // Task 9
            }
            BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                unreachable!("comparison `{op:?}` dispatches to `compare`, not `arith`")
            }
        }
    }
```

- [ ] **Step 6: Run the tests**

```bash
cargo test -p redextape-core --test tm_binary_gadgets 2>&1 | tail -20
```

Expected: `add_is_exact_over_the_representable_range`, `sub_is_monus_not_wrapping` and `a_four_cell_binary_field_beats_a_four_cell_unary_field` PASS (256 add pairs and 256 sub pairs each).

- [ ] **Step 7: Sabotage-verify both guards**

1. Delete `ripple_add`'s `c1 -> overflow` rule and replace it with a route to `fin`. Run `add_is_exact_over_the_representable_range`; expected **FAIL** on `15 + 1` returning `Some(0)` from a wrapped field rather than the guard.
2. In `ripple_sub`, change the `d1` exit to route to `fin` instead of `neg`. Run `sub_is_monus_not_wrapping`; expected **FAIL** on `0 - 1` returning `Some(15)` — the wrapped value. **This is the important one:** 15 is a plausible number, and without this test a wrapping monus would pass every value-level oracle check whose programs happen not to underflow.

Restore both and confirm green.

- [ ] **Step 8: Commit**

```bash
git add -A crates/redextape-core/src/tm crates/redextape-core/tests/tm_binary_gadgets.rs
git commit -m "feat(tm): Binary Add and Sub — ripple carry and ripple borrow

Position does not need to be in the state, only the carry does, so each ripple
is TWO states and O(1) rules — the same self-loop shape as unary's
content-driven loops, not an O(width) unrolled chain. Both operand fields are
`width` wide, so the REG head reaching rb's trailing # and the WORK head
reaching W_ACC's happen on the same transition, which is what lets one rule
end the loop.

Sub is MONUS. A borrow out of the top digit zeroes the field rather than
leaving the wrapped two's-complement value. Sabotage-verified, and it is the
sabotage worth keeping: 0 - 1 wrapping to 15 is a PLAUSIBLE number, so a
dropped final borrow passes every value-level oracle check whose programs
happen not to underflow.

Exhaustive over all 256 operand pairs at width 4, both ops."
```

---

### Task 9: `arith` — Mul

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding/binary.rs`
- Modify: `crates/redextape-core/tests/tm_binary_gadgets.rs`

**Interfaces:**
- Consumes: Task 8's `ripple_add`, Task 7's `copy_field`.
- Produces:
  ```rust
  fn zero_field(b: &mut Builder, from: StateId, width: usize, tape: usize, slot: Slot, label: &str) -> StateId;
  fn shift_left_acc(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId;
  fn bit_is_one(
      b: &mut Builder, entry: StateId, tape: usize, slot: Slot, i: usize,
      if_one: StateId, if_zero: StateId, label: &str,
  );
  ```
  `zero_field` and `bit_is_one` are both reused by Tasks 11–13.

**The algorithm:** `acc = 0; for i in (0..w).rev() { acc <<= 1; if bit_i(rb) { acc += ra } }` — MSB-first, shifting the **accumulator**. `ra` stays a read-only REG field, so `ripple_add` applies unchanged, and there is no multiplier register and no loop counter. The `w` iterations are unrolled at build time.

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-core/tests/tm_binary_gadgets.rs`:

```rust
/// Multiplication is exact over every representable product, and hits the guard on every one that is
/// not. 256 pairs at width 4 — of which 180 overflow, so the guard path is the common case here and
/// gets more coverage than the value path.
#[test]
fn mul_is_exact_and_guards_what_does_not_fit() {
    use redextape_core::core::BinOp::Mul;
    for a in 0..16u64 {
        for bv in 0..16u64 {
            let got = arith(4, Mul, a, bv);
            if a * bv < 16 {
                assert_eq!(got, Some(a * bv), "{a} * {bv}");
            } else {
                assert_eq!(got, Some(0), "{a} * {bv} must hit the guard, leaving field 2 untouched");
            }
        }
    }
}

/// x * 0 and 0 * x are zero for every x — the shift-and-add loop must run its full w iterations and
/// add nothing, rather than short-circuiting into a half-built accumulator.
#[test]
fn mul_by_zero_is_zero_both_ways() {
    use redextape_core::core::BinOp::Mul;
    for x in 0..16u64 {
        assert_eq!(arith(4, Mul, x, 0), Some(0), "{x} * 0");
        assert_eq!(arith(4, Mul, 0, x), Some(0), "0 * {x}");
    }
}

/// A wider bank reaches products no unary field can hold: 200 * 200 = 40,000 needs 16 digits.
/// `100 * 100` is the program the whole slice is measured by, and this is its gadget-level form.
#[test]
fn a_wide_binary_field_computes_products_unary_cannot_represent() {
    use redextape_core::core::BinOp::Mul;
    assert_eq!(arith(16, Mul, 100, 100), Some(10_000));
    assert_eq!(arith(16, Mul, 200, 200), Some(40_000));
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --test tm_binary_gadgets mul_ 2>&1 | tail -10
```

Expected: FAIL — `Mul` still routes to the guard, so `1 * 1` returns `Some(0)`.

- [ ] **Step 3: Implement the three helpers**

```rust
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
/// O(width) steps and O(1) states. The digit shifted OUT of the top is `old[width-1]`; if it is set,
/// the product does not fit and the walk routes to the shared overflow guard before touching anything.
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

/// Branch on digit `i` of field `slot` of `tape`. `entry` and both exits have the `tape` head home.
/// `i` is a build-time constant, so the walk to it is a counted chain rather than a scan.
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
```

- [ ] **Step 4: Replace the `Mul` arm**

```rust
            BinOp::Mul => {
                // acc = 0; for i in (0..w).rev() { acc <<= 1; if bit_i(rb) { acc += ra } }
                //
                // MSB-first, shifting the ACCUMULATOR rather than the multiplicand. That keeps `ra` a
                // read-only REG field (so `ripple_add` applies unchanged) and removes both the
                // multiplier register and the loop counter — which is why WORK needs one scratch
                // field rather than three.
                //
                // The `w` iterations are UNROLLED at build time, so this is the one gadget that is
                // O(width^2) states, not O(1) and not O(width): shift_left_acc is itself O(width)
                // states (its counted walk to the MSB allocates one per digit), and this loop calls it
                // once per iteration. Measured closed form for the gadget tests' 3-slot layout:
                // 1.5w^2 + 26.5w + 15 — 145 states at width 4, 823 at 16, ~7,855 at 64. A known trade.
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
```

- [ ] **Step 5: Run the tests**

```bash
cargo test -p redextape-core --test tm_binary_gadgets 2>&1 | tail -20
```

Expected: all PASS. `a_wide_binary_field_computes_products_unary_cannot_represent` runs at width 16, so it is slower than the rest — a few seconds is normal.

- [ ] **Step 6: Sabotage-verify the shift guard and the loop direction**

1. Delete `shift_left_acc`'s `MARK -> overflow` rule (route it to `need` instead). Run `mul_is_exact_and_guards_what_does_not_fit`; expected **FAIL** on an overflowing product returning a wrapped value.
2. Change the `Mul` loop from `(0..self.width).rev()` to `0..self.width` (LSB-first, which is wrong for an accumulator-shifting algorithm). Run `mul_is_exact...`; expected **FAIL** on `3 * 3` — bit-reversal makes small symmetric products still correct, so check the message names an asymmetric pair.

Restore both and confirm green.

- [ ] **Step 7: Commit**

```bash
git add -A crates/redextape-core/src/tm crates/redextape-core/tests/tm_binary_gadgets.rs
git commit -m "feat(tm): Binary Mul — MSB-first shift-and-add

acc = 0; for i in (0..w).rev() { acc <<= 1; if bit_i(rb) { acc += ra } }

Shifting the ACCUMULATOR rather than the multiplicand is what makes this
cheap: ra stays a read-only REG field so ripple_add applies unchanged, and
there is no multiplier register and no loop counter — which is why WORK needs
ONE scratch field, not the three the spec estimated.

shift_left_acc walks MSB-to-LSB carrying one digit in the state, three
transitions per cell: O(width) steps, O(1) states. The digit shifted out of
the top is the overflow test.

The one cost: the w iterations are unrolled at build time, so Mul is O(width)
STATES where every other gadget is O(1). Tens of states at the widths auto-fit
selects; ~7,855 at 64, and the growth is QUADRATIC in the width, not linear. Recorded, not optimized.

Exhaustive over all 256 pairs at width 4 (180 of which overflow, so the guard
path gets more coverage than the value path), plus 100*100 and 200*200 at 16."
```

---

### Task 10: `compare` — all six

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding/binary.rs`
- Modify: `crates/redextape-core/tests/tm_binary_gadgets.rs`

**Interfaces:**
- Consumes: `copy_field`, `ripple_add`, `ripple_sub`, `branch_on_zero`.
- Produces: `fn compare(...)` complete. No new free functions.

**The decomposition, mirroring `Unary::compare` (`unary.rs`, the `le`/`monus`/`is_zero` derivation):**

| op | expression |
|---|---|
| `Le` | `is_zero(monus(ra, rb))` |
| `Gt` | `is_nonzero(monus(ra, rb))` |
| `Ge` | `is_zero(monus(rb, ra))` |
| `Lt` | `is_nonzero(monus(rb, ra))` |
| `Eq` | `is_zero(monus(ra, rb) + monus(rb, ra))` |
| `Ne` | `is_nonzero(monus(ra, rb) + monus(rb, ra))` |

**Why `Eq`'s sum cannot overflow, which is the one non-obvious step:** one of the two monus terms is always zero (if `ra >= rb` then `monus(rb, ra) = 0`, and vice versa), so the sum is exactly `|ra - rb| <= max(ra, rb) < 2^w`. The `ripple_add` guard is therefore unreachable on this path — stated here because an unreachable guard that is later reached is a defect, and a reader needs the argument to check it.

- [ ] **Step 1: Write the failing test**

```rust
/// Every comparison over every operand pair at width 4 — 256 pairs x 6 ops. A trichotomy sweep
/// rather than a few spot checks, because the six ops are derived from two primitives and a sign
/// error in either would leave four of the six accidentally right.
#[test]
fn comparisons_are_exact_over_every_pair() {
    use redextape_core::core::BinOp::{Eq, Ge, Gt, Le, Lt, Ne};
    let enc = Binary::at(4);
    for a in 0..16u64 {
        for bv in 0..16u64 {
            for (op, want) in [
                (Le, a <= bv),
                (Lt, a < bv),
                (Ge, a >= bv),
                (Gt, a > bv),
                (Eq, a == bv),
                (Ne, a != bv),
            ] {
                let cells = run_gadget(4, 3, |e, b, start, halt| {
                    let s1 = b.state("s1");
                    let s2 = b.state("s2");
                    e.write_literal(b, start, s1, a, 0);
                    e.write_literal(b, s1, s2, bv, 1);
                    e.compare(b, s2, halt, op, 0, 1, 2);
                })
                .expect("compare must not halt in the guard");
                assert_eq!(enc.decode_nat(&cells, 2), Some(u64::from(want)), "{a} {op:?} {bv}");
            }
        }
    }
}

/// A comparison's result is a BOOLEAN — exactly 0 or 1 — so its field must be all-zero but for at
/// most digit 0. A gadget that left a stale high digit would decode as a large number that
/// `decode_word` then rejects as a Bool, turning a comparison bug into a confusing decode failure.
#[test]
fn a_comparison_writes_a_clean_boolean_field() {
    use redextape_core::core::BinOp::Lt;
    let cells = run_gadget(4, 3, |e, b, start, halt| {
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        e.write_literal(b, s1, s2, 3, 1);
        e.write_literal(b, start, s1, 15, 0);
        e.compare(b, s2, halt, Lt, 0, 1, 2);
    })
    .unwrap();
    // Field 2 occupies cells 11..15 (bank = `#` + 3 * (4 + 1)).
    assert_eq!(&cells[11..15], &[ZERO, ZERO, ZERO, ZERO], "15 < 3 is false, so every digit is 0");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --test tm_binary_gadgets comparisons_are_exact 2>&1 | tail -10
```

Expected: FAIL — `compare`'s stub routes to the guard, so `run_gadget` returns a bank of zeros and `Le` on `0 <= 0` reports `Some(0)` where `Some(1)` is wanted.

- [ ] **Step 3: Implement `compare`**

```rust
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
```

- [ ] **Step 4: Run the tests**

```bash
cargo test -p redextape-core --test tm_binary_gadgets 2>&1 | tail -20
```

Expected: all PASS (1,536 comparison cases).

- [ ] **Step 5: Sabotage-verify the derivation table**

Swap `Le`'s and `Ge`'s operand order in the `match` (`BinOp::Le => (rb, ra, true)`). Run `comparisons_are_exact_over_every_pair`.

Expected: **FAIL**, and the message must name a pair with `a != b` — `a == b` cases stay correct under the swap, which is exactly why the sweep is exhaustive rather than a handful of spot checks. Restore and confirm green.

- [ ] **Step 6: Commit**

```bash
git add -A crates/redextape-core/src/tm crates/redextape-core/tests/tm_binary_gadgets.rs
git commit -m "feat(tm): Binary compare — all six, from monus and is_zero

Mirrors Unary::compare's decomposition exactly: le(x,y) = is_zero(monus(x,y))
and every other op derives from it. Supplying binary monus (ripple_sub) and
binary is_zero (branch_on_zero) is the whole implementation — which is the
payoff of mirroring the existing derivation rather than inventing one.

Eq is is_zero(|ra - rb|) = is_zero(monus(ra,rb) + monus(rb,ra)). That sum
cannot overflow, and the argument is recorded next to the code because an
unreachable guard that is later reached is a defect: one of the two monus
terms is ALWAYS zero, so the sum is |ra - rb| <= max(ra, rb) < 2^w.

Exhaustive: 256 operand pairs x 6 ops. Sabotage-verified by swapping Le's and
Ge's operand order — which leaves every a == b case correct, which is why the
sweep is exhaustive rather than spot checks."
```

---

### Task 11: STACK — `push_frame`, `pop_frame_restore`, `dispatch_tag`

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding/binary.rs`
- Modify: `crates/redextape-core/tests/tm_binary_gadgets.rs`

**Interfaces:**
- Consumes: `copy_field`, `bit_is_one`, `zero_field`.
- Produces:
  ```rust
  /// Append `W_ACC`'s digits as a new `width`-cell `#`-terminated field at the STACK top.
  fn stack_push_acc(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId;
  /// Append `c`'s digits as a new field at the STACK top. `c` is a build-time constant.
  fn stack_push_literal(b: &mut Builder, from: StateId, c: u64, width: usize, label: &str) -> StateId;
  /// Pop the top STACK field into `W_ACC`, erasing it. STACK must be non-empty.
  fn stack_pop_acc(b: &mut Builder, from: StateId, width: usize, label: &str) -> StateId;
  /// Branch on whether field `slot` of `tape` equals the build-time constant `c`.
  fn branch_on_equals(
      b: &mut Builder, entry: StateId, tape: usize, slot: Slot, c: u64, width: usize,
      if_eq: StateId, if_ne: StateId, label: &str,
  );
  ```

**What changes versus unary, and what does not.** The STACK's *structure* is unchanged: `[field]#[field]#…#[field]#`, head on the blank after the last `#`, `stack_is_empty` (shared, in `encoding.rs`) unmodified. What changes is that a field is now exactly `width` digits instead of a variable-length mark run — so push and pop become **counted** walks, and `dispatch_tag` reads a `width`-digit number instead of counting marks.

**`dispatch_tag`'s fan-out is a linear chain of equality tests, not a decision trie.** A depth-`width` binary trie has `2^width` leaves — 2⁶⁴ at the ceiling. Testing `W_ACC == 0`, then `== 1`, … `== exits.len() - 1` is `O(exits.len() * width)` states, linear in both. The last exit doubles as the defensive clamp, preserving the trait contract: an out-of-range tag routes to `exits.last()` and never over-indexes, and an empty `exits` leaves `entry` rule-less so the machine halts there.

- [ ] **Step 1: Write the failing test**

```rust
use redextape_core::tm::STACK;

/// Run a STACK-only gadget and return the final STACK tape.
fn run_stack(width: usize, body: impl FnOnce(&Binary, &mut Builder, redextape_core::tm::StateId, redextape_core::tm::StateId)) -> Vec<char> {
    let enc = Binary::at(width);
    let mut b = Builder::new();
    let start = b.state("start");
    let halt = b.accept("halt");
    body(&enc, &mut b, start, halt);
    let m = b.finish(start);
    assert!(m.validate().is_empty(), "{:?}", m.validate());
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(4);
    init[WORK] = enc.init_work();
    let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);
    tapes[STACK].snapshot().0
}

/// A pushed frame is a `width`-digit field plus a `#`, so `push_frame` with a tag and two locals
/// lays down exactly 3 * (width + 1) cells — the tag at the bottom, then the locals in slot order.
#[test]
fn push_frame_lays_tag_then_locals_in_slot_order() {
    let cells = run_stack(4, |e, b, start, halt| {
        let s1 = b.state("s1");
        let s2 = b.state("s2");
        e.write_literal(b, start, s1, 6, 1);
        e.write_literal(b, s1, s2, 9, 2);
        e.push_frame(b, s2, halt, 2, 3);
    });
    let field = |i: usize| -> Vec<char> { cells[i * 5..i * 5 + 4].to_vec() };
    assert_eq!(field(0), vec![MARK, MARK, ZERO, ZERO], "tag 3 at the frame bottom");
    assert_eq!(field(1), vec![ZERO, MARK, MARK, ZERO], "Loc0 = 6");
    assert_eq!(field(2), vec![MARK, ZERO, ZERO, MARK], "Loc1 = 9");
    assert_eq!(cells[4], SEP);
    assert_eq!(cells[14], SEP);
}

/// Push then pop is LIFO and lossless, and the pop must ERASE what it read — a residual frame is
/// what `stack_is_empty` catches at the oracle level, and catching it here localizes the defect.
#[test]
fn push_then_pop_restores_locals_and_empties_the_stack() {
    let enc = Binary::at(4);
    let mut b = Builder::new();
    let start = b.state("start");
    let halt = b.accept("halt");
    let s1 = b.state("s1");
    let s2 = b.state("s2");
    let s3 = b.state("s3");
    let s4 = b.state("s4");
    enc.write_literal(&mut b, start, s1, 6, 1);
    enc.write_literal(&mut b, s1, s2, 9, 2);
    enc.push_frame(&mut b, s2, s3, 2, 3);
    // Clobber both locals, then restore them from the frame.
    let s3b = b.state("s3b");
    enc.write_literal(&mut b, s3, s3b, 0, 1);
    enc.write_literal(&mut b, s3b, s4, 0, 2);
    enc.pop_frame_restore(&mut b, s4, halt, 2);
    let m = b.finish(start);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(4);
    init[WORK] = enc.init_work();
    let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);
    let reg = tapes[REG].snapshot().0;
    assert_eq!(enc.decode_nat(&reg, 1), Some(6), "Loc0 restored");
    assert_eq!(enc.decode_nat(&reg, 2), Some(9), "Loc1 restored");
    let stack = tapes[STACK].snapshot().0;
    // `pop_frame_restore` leaves the TAG on top; only the two local fields are gone.
    assert_eq!(&stack[5..], &vec![redextape_core::tm::BLANK; stack.len() - 5][..], "locals erased");
}

/// `dispatch_tag` fans out on the tag's VALUE, and the value is a binary number: tag 5 must reach
/// exit 5, not exit 1 (its low digit) and not exit 2 (its digit count).
#[test]
fn dispatch_tag_routes_on_the_tag_value() {
    for tag in 0..6u64 {
        let enc = Binary::at(4);
        let mut b = Builder::new();
        let start = b.state("start");
        let halt = b.accept("halt");
        let pushed = b.state("pushed");
        enc.push_frame(&mut b, start, pushed, 0, tag);
        // Six exits, each writing its own index into slot 0.
        let exits: Vec<_> = (0..6).map(|i| b.state(format!("e{i}"))).collect();
        enc.dispatch_tag(&mut b, pushed, &exits);
        for (i, &e) in exits.iter().enumerate() {
            enc.write_literal(&mut b, e, halt, i as u64, 0);
        }
        let m = b.finish(start);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(4);
        init[WORK] = enc.init_work();
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, TmStatus::Halted, "tag {tag}");
        assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 0), Some(tag), "tag {tag} took the wrong exit");
        assert_eq!(tapes[STACK].snapshot().0.iter().find(|&&c| c != redextape_core::tm::BLANK), None, "tag erased");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --test tm_binary_gadgets push_frame 2>&1 | tail -10
```

Expected: FAIL — the stubs route to the guard, so the STACK is empty.

- [ ] **Step 3: Implement the four helpers**

```rust
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
                    RuleSpec::new()
                        .on(STACK, Some(s), Some(BLANK), Move::L)
                        .on(WORK, Some(w), Some(s), Move::L),
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
    // each and `rewind_home`'s walk is content-blind but must start INSIDE the field.
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
```

- [ ] **Step 4: Implement the three trait methods**

```rust
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
```

- [ ] **Step 5: Run the tests**

```bash
cargo test -p redextape-core --test tm_binary_gadgets 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 6: Sabotage-verify the pop's digit order and the clamp**

1. In `stack_pop_acc`, change the WORK head's parking walk to stay on digit 0 and the copy loop's WORK move to `Move::R`. That reverses the value. Run `push_then_pop_restores_locals_and_empties_the_stack`; expected **FAIL** on `Loc0 = 6` (`0110` reversed) — and note that it would have PASSED for 9 (`1001`) and 15, which is why the test uses 6 and 9 rather than round numbers.
2. Delete `dispatch_tag`'s final `b.add_rule(cur, RuleSpec::new(), last);`. Run `dispatch_tag_routes_on_the_tag_value`; expected **FAIL** on `tag = 5` with a non-halting or wrong-exit result.

Restore both and confirm green.

- [ ] **Step 7: Commit**

```bash
git add -A crates/redextape-core/src/tm crates/redextape-core/tests/tm_binary_gadgets.rs
git commit -m "feat(tm): Binary STACK — push_frame, pop_frame_restore, dispatch_tag

The STACK's STRUCTURE is unchanged — [field]#…#[field]#, head on the blank
after the last #, stack_is_empty untouched. What changes is that a field is
exactly `width` digits instead of a variable-length mark run, so push and pop
become counted walks.

Two decisions worth recording:

- stack_pop_acc reads the STACK MSB-first while writing W_ACC MSB-first, so
  the walks stay aligned and the value is not reversed. Sabotage-verified with
  6 and 9 as the test locals precisely because a reversal is INVISIBLE for
  palindromic values like 0, 9 (1001) and 15.
- dispatch_tag fans out via a LINEAR chain of equality tests, not a decision
  trie. A depth-width trie has 2^width leaves — 2^64 at the ceiling — where
  this is O(exits.len() * width) states. The last exit doubles as the
  defensive clamp, preserving the trait contract."
```

---

### Task 12: HEAP — `cons`, `is_empty_op`, `head_op`, `tail_op`, `parse_heap_cells`

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding/binary.rs`
- Modify: `crates/redextape-core/tests/tm_binary_gadgets.rs`

**Interfaces:**
- Consumes: `copy_field`, `branch_on_zero`, `zero_field`.
- Produces:
  ```rust
  /// `W_ACC += 1`. Carry out of the top routes to the shared overflow guard.
  fn inc_acc(b: &mut Builder, from: StateId, label: &str) -> StateId;
  /// `W_ACC -= 1`, truncating at zero. `from`/exit: WORK home.
  fn dec_acc(b: &mut Builder, from: StateId, label: &str) -> StateId;
  /// Cell size on the binary HEAP, in cells: `@` + width digits + `#` + width digits.
  fn heap_cell_len(width: usize) -> usize { 2 * width + 2 }
  ```

**The layout.** A binary cons cell is `@ <width digits> # <width digits>` — **fixed width**, where unary's is variable. `heap_tape_is_well_formed` (Task 2) already accepts both. Fixed width makes `heap_seek_cell` a counted skip: from the origin, skip `p - 1` whole cells (`heap_cell_len` cells each), and the head lands on the target cell's `@`.

**The fault contract is unchanged.** A nil pointer (`rl == 0`) or a dangling one has no value and must **SPIN to a cap** (`HitCap`), matching λ's Ω and the reference's `Runtime`. Do not route it to the overflow guard — overflow means "retry at a wider bank", and a nil deref would then burn the full step budget at every width. Reuse the shared `{base}.fault` self-loop shape `Unary::head_op` uses.

- [ ] **Step 1: Write the failing test**

```rust
use redextape_core::tm::HEAP;

/// A binary cons cell is FIXED width: `@` + w digits + `#` + w digits. Two cells therefore occupy
/// exactly 2 * (2w + 2) cells, and the pointers handed back are 1 and 2 in allocation order.
#[test]
fn cons_builds_fixed_width_cells_with_sequential_pointers() {
    let enc = Binary::at(4);
    let mut b = Builder::new();
    let start = b.state("start");
    let halt = b.accept("halt");
    let (s1, s2, s3) = (b.state("s1"), b.state("s2"), b.state("s3"));
    enc.write_literal(&mut b, start, s1, 7, 0); // head value
    enc.write_literal(&mut b, s1, s2, 0, 1); // nil tail
    enc.cons(&mut b, s2, s3, 0, 1, 2); // p1 = cons(7, nil) -> slot 2
    enc.cons(&mut b, s3, halt, 0, 2, 3); // p2 = cons(7, p1) -> slot 3
    let m = b.finish(start);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(4);
    init[WORK] = enc.init_work();
    let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);
    let reg = tapes[REG].snapshot().0;
    assert_eq!(enc.decode_nat(&reg, 2), Some(1), "first cons gets pointer 1");
    assert_eq!(enc.decode_nat(&reg, 3), Some(2), "second cons gets pointer 2");
    let heap = tapes[HEAP].snapshot().0;
    assert_eq!(enc.parse_heap_cells(&heap), vec![(7, 0), (7, 1)]);
}

/// `head_op`/`tail_op` dereference a RUNTIME pointer — the cell index is a value, not a constant.
#[test]
fn head_and_tail_dereference_a_runtime_pointer() {
    let enc = Binary::at(4);
    for (read_tail, want) in [(false, 7u64), (true, 1u64)] {
        let mut b = Builder::new();
        let start = b.state("start");
        let halt = b.accept("halt");
        let (s1, s2, s3, s4) = (b.state("s1"), b.state("s2"), b.state("s3"), b.state("s4"));
        enc.write_literal(&mut b, start, s1, 7, 0);
        enc.write_literal(&mut b, s1, s2, 0, 1);
        enc.cons(&mut b, s2, s3, 0, 1, 2); // p1 = cons(7, nil)
        enc.cons(&mut b, s3, s4, 0, 2, 3); // p2 = cons(7, p1)
        if read_tail {
            enc.tail_op(&mut b, s4, halt, 3, 1);
        } else {
            enc.head_op(&mut b, s4, halt, 3, 1);
        }
        let m = b.finish(start);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(4);
        init[WORK] = enc.init_work();
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, TmStatus::Halted, "read_tail = {read_tail}");
        assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 1), Some(want));
    }
}

/// A nil dereference SPINS to a cap, matching lambda's Omega and the reference's Runtime error. It
/// must NOT reach the overflow guard: overflow means 'retry at a wider bank', and a nil deref would
/// then burn a full step budget at every width on the way to reporting the same thing.
#[test]
fn a_nil_dereference_spins_to_a_cap() {
    let enc = Binary::at(4);
    let mut b = Builder::new();
    let start = b.state("start");
    let halt = b.accept("halt");
    let s1 = b.state("s1");
    enc.write_literal(&mut b, start, s1, 0, 0); // nil
    enc.head_op(&mut b, s1, halt, 0, 1);
    let m = b.finish(start);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(2);
    init[WORK] = enc.init_work();
    let caps = redextape_core::tm::TmCaps { steps: 5_000, cells: 5_000 };
    assert_eq!(simulate(&m, &init, caps).1, TmStatus::HitCap);
}

/// `is_empty_op` is a pointer test, and it must inspect the WHOLE pointer field: pointer 2 is `0100`
/// at width 4, whose first digit is zero.
#[test]
fn is_empty_op_tests_the_whole_pointer() {
    let enc = Binary::at(4);
    for (p, want) in [(0u64, 1u64), (1, 0), (2, 0), (8, 0)] {
        let cells = run_gadget(4, 2, |e, b, start, halt| {
            let s1 = b.state("s1");
            e.write_literal(b, start, s1, p, 0);
            e.is_empty_op(b, s1, halt, 0, 1);
        })
        .unwrap();
        assert_eq!(enc.decode_nat(&cells, 1), Some(want), "p = {p}");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --test tm_binary_gadgets cons_builds 2>&1 | tail -10
```

Expected: FAIL — the stubs route to the guard.

- [ ] **Step 3: Implement `inc_acc` and `dec_acc`**

```rust
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
```

- [ ] **Step 4: Implement the four trait methods and `parse_heap_cells`**

Structure, in the order each gadget performs its steps. Follow the same `copy_field` / counted-walk idioms as Tasks 7–11:

**`cons(rh, rt, rd)`** — five phases, in this order, because `W_ACC` is the only scratch:
1. `copy_field(REG, rh -> WORK, W_ACC)`, then write `@` + `W_ACC`'s digits + `#` at the HEAP top (a counted lockstep walk, WORK read explicit, HEAP read `BLANK`).
2. `copy_field(REG, rt -> WORK, W_ACC)`, then write `W_ACC`'s digits at the HEAP top.
3. `zero_field(WORK, W_ACC)`.
4. Walk the HEAP from the origin to the top; on every `@`, `inc_acc`. The new cell is included, so the resulting count **is** the new cell's 1-based pointer.
5. `copy_field(WORK, W_ACC -> REG, rd)`, HEAP head back at the top.

**`is_empty_op(rl, rd)`** — `branch_on_zero(REG, rl)`, then `write_literal(1)` / `write_literal(0)` into `rd`.

**`head_op(rl, rd)` / `tail_op(rl, rd)`** — identical but for which word is read:
1. `copy_field(REG, rl -> WORK, W_ACC)`.
2. `branch_on_zero(WORK, W_ACC)` — the zero branch is `nil`, which routes to the **fault self-loop** (`b.state(format!("{base}.fault"))` with a rule to itself), never the overflow guard.
3. Walk the HEAP from the origin. At each `@`: `dec_acc`, then `branch_on_zero(WORK, W_ACC)`. Zero means this is the target cell; nonzero means skip `heap_cell_len(width)` cells (a counted chain) and repeat. A `BLANK` where an `@` was expected is a **dangling** pointer and routes to the same fault self-loop.
4. At the target `@`: step right 1 (head word) or `width + 2` (tail word) cells, then copy `width` digits into `W_ACC`.
5. Return the HEAP head to the top, `copy_field(WORK, W_ACC -> REG, rd)`.

**`parse_heap_cells`** — fixed-width parse:

```rust
    fn parse_heap_cells(&self, cells: &[Symbol]) -> Vec<(u64, u64)> {
        // `@ <width digits> # <width digits>`, laid left to right from the first `@`. Total: a
        // truncated or malformed tape yields the cells parsed so far rather than panicking.
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
```

- [ ] **Step 5: Run the tests**

```bash
cargo test -p redextape-core --test tm_binary_gadgets 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 6: Sabotage-verify the fault route and the pointer count**

1. Change `head_op`'s nil branch to route to `b.overflow()` instead of the fault self-loop. Run `a_nil_dereference_spins_to_a_cap`; expected **FAIL** — `Halted`, not `HitCap`. **This distinction is load-bearing**, not stylistic: `run_tm_fitted` retries on the guard, so a nil deref routed there would burn a full step budget at every width from 4 to 64 and still report the same thing.
2. Move `cons`'s counting phase (4) to before the append phases (1–2), so the count excludes the new cell. Run `cons_builds_fixed_width_cells_with_sequential_pointers`; expected **FAIL** with pointers 0 and 1.

Restore both and confirm green.

- [ ] **Step 7: Commit**

```bash
git add -A crates/redextape-core/src/tm crates/redextape-core/tests/tm_binary_gadgets.rs
git commit -m "feat(tm): Binary HEAP — cons, is_empty_op, head_op, tail_op, parse_heap_cells

A binary cons cell is FIXED width (@ + w digits + # + w digits) where unary's
is variable, so seeking cell p is a counted skip of p-1 whole cells rather
than a content scan. heap_tape_is_well_formed already accepts both shapes.

The fault contract is unchanged and deliberately NOT the overflow guard: a nil
or dangling deref SPINS to a cap, matching lambda's Omega and the reference's
Runtime. Sabotage-verified, and the distinction is load-bearing rather than
stylistic — run_tm_fitted retries on the guard, so a nil deref routed there
would burn a full step budget at every width from 4 to 64 to report the same
thing. That is exactly why Builder::overflow is a state id and not a spin.

cons counts cells AFTER appending, so the count IS the new pointer."
```

---

### Task 13: BOX — `box_op`, `box_get_op`, `box_set_op`

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding/binary.rs`
- Modify: `crates/redextape-core/tests/tm_binary_gadgets.rs`

**Interfaces:**
- Consumes: `copy_field`, `inc_acc`, `dec_acc`, `branch_on_zero`, `zero_field`.
- Produces: the last three trait methods. After this task `binary.rs` has **no stubs left**.

**The layout is the closest to unary's of any tape**, because the BOX tape was already fixed-width and counted: zero or more fields, each `#` + exactly `width` cells, then a blank top, with **no trailing `#`** after the last field. The only change is that the `width` cells are digits and a value is written by a counted digit copy rather than a mark run.

- [ ] **Step 1: Write the failing test**

```rust
use redextape_core::tm::BOX;

/// Allocation hands back sequential 1-based pointers and the fields are independent.
#[test]
fn boxes_get_sequential_pointers_and_stay_independent() {
    let enc = Binary::at(4);
    let mut b = Builder::new();
    let start = b.state("start");
    let halt = b.accept("halt");
    let (s1, s2, s3, s4) = (b.state("s1"), b.state("s2"), b.state("s3"), b.state("s4"));
    enc.write_literal(&mut b, start, s1, 5, 0);
    enc.box_op(&mut b, s1, s2, 0, 1); // p1 = box(5)
    enc.write_literal(&mut b, s2, s3, 12, 0);
    enc.box_op(&mut b, s3, s4, 0, 2); // p2 = box(12)
    let s5 = b.state("s5");
    enc.box_get_op(&mut b, s4, s5, 1, 3); // slot 3 = *p1
    enc.box_get_op(&mut b, s5, halt, 2, 0); // slot 0 = *p2
    let m = b.finish(start);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(4);
    init[WORK] = enc.init_work();
    let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);
    let reg = tapes[REG].snapshot().0;
    assert_eq!(enc.decode_nat(&reg, 1), Some(1), "first box is pointer 1");
    assert_eq!(enc.decode_nat(&reg, 2), Some(2), "second box is pointer 2");
    assert_eq!(enc.decode_nat(&reg, 3), Some(5), "*p1");
    assert_eq!(enc.decode_nat(&reg, 0), Some(12), "*p2");
}

/// `box_set_op` overwrites IN PLACE — the `#` delimiters never move — and must handle both shrinking
/// and growing the digit count, including down to zero and back up.
#[test]
fn box_set_overwrites_in_place_in_both_directions() {
    let enc = Binary::at(4);
    for (first, second) in [(15u64, 0u64), (0, 15), (12, 3), (1, 8)] {
        let mut b = Builder::new();
        let start = b.state("start");
        let halt = b.accept("halt");
        let (s1, s2, s3, s4) = (b.state("s1"), b.state("s2"), b.state("s3"), b.state("s4"));
        enc.write_literal(&mut b, start, s1, first, 0);
        enc.box_op(&mut b, s1, s2, 0, 1);
        enc.write_literal(&mut b, s2, s3, second, 0);
        enc.box_set_op(&mut b, s3, s4, 1, 0);
        enc.box_get_op(&mut b, s4, halt, 1, 2);
        let m = b.finish(start);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(3);
        init[WORK] = enc.init_work();
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, TmStatus::Halted, "{first} -> {second}");
        assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 2), Some(second), "{first} -> {second}");
        // The tape must still be exactly one field: `#` + 4 digits, then blanks.
        let bx = tapes[BOX].snapshot().0;
        assert_eq!(bx[0], SEP);
        assert!(bx[5..].iter().all(|&c| c == redextape_core::tm::BLANK), "the field grew");
    }
}

/// A nil box pointer spins to a cap, exactly as a nil cons deref does.
#[test]
fn a_nil_box_get_spins_to_a_cap() {
    let enc = Binary::at(4);
    let mut b = Builder::new();
    let start = b.state("start");
    let halt = b.accept("halt");
    let s1 = b.state("s1");
    enc.write_literal(&mut b, start, s1, 0, 0);
    enc.box_get_op(&mut b, s1, halt, 0, 1);
    let m = b.finish(start);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(2);
    init[WORK] = enc.init_work();
    let caps = redextape_core::tm::TmCaps { steps: 5_000, cells: 5_000 };
    assert_eq!(simulate(&m, &init, caps).1, TmStatus::HitCap);
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --test tm_binary_gadgets boxes_get_sequential 2>&1 | tail -10
```

Expected: FAIL — the stubs route to the guard.

- [ ] **Step 3: Implement the three methods**

Same phase structure as Task 12's HEAP gadgets, over the BOX layout (`#` + `width` digits per field, no trailing `#`, blank top):

**`box_op(rv, rd)`**
1. `copy_field(REG, rv -> WORK, W_ACC)`; at the BOX top write `#` then `W_ACC`'s digits (counted lockstep; BOX read is `BLANK`).
2. `zero_field(WORK, W_ACC)`; walk the BOX from the origin `inc_acc`-ing on every `#`; the count includes the new field, so it **is** the new pointer.
3. `copy_field(WORK, W_ACC -> REG, rd)`; BOX head back at the origin.

**`box_get_op(rb, rd)`**
1. `copy_field(REG, rb -> WORK, W_ACC)`; `branch_on_zero(WORK, W_ACC)` — zero routes to the **fault self-loop**.
2. Walk the BOX from the origin. At each `#`: `dec_acc`, `branch_on_zero(WORK, W_ACC)`. Zero means the target; nonzero skips `width + 1` cells (counted) and repeats. A `BLANK` where a `#` was expected is dangling and routes to the same fault self-loop.
3. Copy the field's `width` digits into `W_ACC`; return the BOX head to the origin; `copy_field(WORK, W_ACC -> REG, rd)`.

**`box_set_op(rb, rv)`** — as `box_get_op` through step 2, then `copy_field(REG, rv -> WORK, W_ACC)` (the BOX head stays parked on the target field), then a counted digit write of `W_ACC` into the field's `width` cells, then return the BOX head to the origin. Evaluates to unit, so there is no destination.

**Why the write is a counted chain and not content-driven** — the reason `box_overwrite_field` is already counted in `Unary`: the LAST field has no trailing `#`, so a content-driven overrun would have no delimiter to stop at.

- [ ] **Step 4: Remove every remaining stub**

```bash
grep -n "Task [0-9]" crates/redextape-core/src/tm/encoding/binary.rs
```

Expected: **no output**. Every trait method is implemented.

- [ ] **Step 5: Run the tests**

```bash
cargo test -p redextape-core --test tm_binary_gadgets 2>&1 | tail -20
cargo test -p redextape-core 2>&1 | tail -5
```

Expected: all PASS, and no unary golden moved.

- [ ] **Step 6: Sabotage-verify the in-place write**

Change `box_set_op`'s counted write loop from `0..width` to `0..width + 1`. Run `box_set_overwrites_in_place_in_both_directions`; expected **FAIL** on "the field grew" — the write ran one cell past the field into the top. Restore and confirm green.

- [ ] **Step 7: Commit**

```bash
git add -A crates/redextape-core/src/tm crates/redextape-core/tests/tm_binary_gadgets.rs
git commit -m "feat(tm): Binary BOX — box_op, box_get_op, box_set_op

The closest layout to unary's of any tape, because the BOX tape was already
fixed-width and counted: fields of `#` + width cells, no trailing # after the
last one, blank top. Only the cell contents change.

The write stays a COUNTED chain for the reason box_overwrite_field already
was: the last field has no trailing # for a content-driven overrun to stop
at. Sabotage-verified by writing one cell too many, which grows the field
into the top.

binary.rs now has no stubs. Every Encoding method is implemented."
```

---

# Phase 3 — Verification and measurement

`Binary` is complete but unreachable from `run_tm`. These four tasks make it reachable, put it through the whole existing verification apparatus, and produce the artifact that makes the toggle worth having rather than merely correct.

---

### Task 14: The four-way oracle

**Files:**
- Modify: `crates/redextape-core/tests/three_way_oracle.rs`
- Modify: `crates/redextape-core/tests/tm_oracle.rs`

**Interfaces:**
- Consumes: Task 13's complete `Binary`.
- Produces: `assert_three_way` becomes four-way (`reference == λ == unary-TM == binary-TM`); `assert_three_way_diverges` and `assert_tm_only` gain the binary leg.

**The file's name and module doc both become wrong.** Rename the concept in the doc comment to "the backend oracle" and state the four legs; leave the *filename* alone (renaming an integration test file breaks `first_order_demos_stay_synced_across_all_three_copies`'s path-based extraction, which is a separate, avoidable churn). Add a line to the module doc saying exactly that, so the mismatch reads as a decision rather than an oversight.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/tests/three_way_oracle.rs`:

```rust
use redextape_core::tm::Binary;

/// The capability the binary encoding exists for, stated as an executable claim: `100 * 100` is
/// `TmRun::Overflow` under unary at EVERY width up to the 64-cell ceiling, and a value under binary.
///
/// The unary half is not incidental — it is the control. Without it this test would pass just as well
/// if binary were secretly falling back to unary, or if the ceiling had been raised for both.
#[test]
fn binary_computes_what_unary_cannot_represent() {
    let (prog, ds) = parse("100 * 100");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    assert!(
        matches!(run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS), TmRun::Overflow),
        "unary must still report Overflow — otherwise this test proves nothing about binary"
    );
    match run_tm(&core, &Binary::default(), TM_DEFAULT_CAPS) {
        TmRun::Ran { tapes } => {
            assert_eq!(decode_tape(&tapes, &Value::Nat(0), &Binary::default()), Some(Value::Nat(10_000)));
        }
        other => panic!("binary should compute 100 * 100: {other:?}"),
    }
}

/// A tape produced by one encoding must NOT decode through the other. Before `parse_heap_cells` moved
/// onto the trait, `decode_tape` took `enc` and ignored it for the heap half; this pins that the
/// encoding is now load-bearing all the way through the decode.
#[test]
fn a_binary_tape_does_not_decode_as_unary() {
    let (prog, ds) = parse("[1, 2, 3]");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let expected = Value::list_of_nats(&[1, 2, 3]);
    let TmRun::Ran { tapes } = run_tm(&core, &Binary::default(), TM_DEFAULT_CAPS) else {
        panic!("binary should run a list literal")
    };
    assert_eq!(decode_tape(&tapes, &expected, &Binary::default()), Some(expected.clone()));
    assert_ne!(
        decode_tape(&tapes, &expected, &Unary::default()),
        Some(expected),
        "a binary tape read as unary must not produce the right answer"
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --test three_way_oracle binary_computes 2>&1 | tail -10
```

Expected: FAIL — `run_tm` with `Binary` reports `Overflow` at width 4 and never retries wide enough, **or** passes immediately. If it passes immediately, that is the interesting case: check `run_tm_fitted`'s doubling reaches 32 (100·100 = 10,000 needs 14 digits, so the fit is 16).

- [ ] **Step 3: Add the binary leg to the three assert helpers**

```rust
/// reference == λ == unary-TM == binary-TM, guided by the reference value's type. All four must run
/// to a value that decodes equal.
///
/// The two TM legs are DIFFERENT MACHINES compiled from the same Core, not the same machine read two
/// ways — which is what makes this a real fourth leg rather than a restatement of the third.
fn assert_three_way(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
    let tm = run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS);
    let btm = run_tm(&core, &Binary::default(), TM_DEFAULT_CAPS);
    match (reference, lambda, tm, btm) {
        (Ok(rv), LambdaRun::Reduced(nf), TmRun::Ran { tapes }, TmRun::Ran { tapes: btapes }) => {
            assert_eq!(decode(&nf, &rv), Some(rv.clone()), "reference vs λ disagree for: {src}");
            assert_eq!(
                decode_tape(&tapes, &rv, &Unary::default()),
                Some(rv.clone()),
                "reference vs unary-TM disagree for: {src}"
            );
            assert_eq!(
                decode_tape(&btapes, &rv, &Binary::default()),
                Some(rv.clone()),
                "reference vs binary-TM disagree for: {src}"
            );
        }
        (r, l, t, b) => panic!(
            "backend oracle mismatch for {src}:\n  reference={r:?}\n  lambda={l:?}\n  unary-tm={t:?}\n  binary-tm={b:?}"
        ),
    }
}
```

Apply the same shape to `assert_three_way_diverges` (both TM legs must be `TmRun::HitCap`) and `assert_tm_only` (both TM legs must produce the value).

Add the binary leg to the proptest bodies `three_way_value` and `two_way_tm_only` the same way, using `prop_assert_eq!`.

- [ ] **Step 4: Add a binary leg to `tm_oracle.rs`**

Its `tm_value(src)`-style helpers each take `&Unary::default()`. Parameterize the helper over `&dyn Encoding` and call each test body twice — once per encoding — so the reference==TM and asm-interp==TM legs both cover binary.

- [ ] **Step 5: Run the tests**

```bash
cargo test -p redextape-core --test three_way_oracle 2>&1 | tail -20
cargo test -p redextape-core --test tm_oracle 2>&1 | tail -20
```

Expected: PASS. Runtime roughly doubles for these two files; if a specific demo is far slower under binary, note which and why in the commit body rather than adjusting caps silently.

- [ ] **Step 6: Commit**

```bash
git add -A crates/redextape-core/tests
git commit -m "test(tm): the oracle gains a fourth leg — reference == λ == unary-TM == binary-TM

The two TM legs are DIFFERENT MACHINES compiled from the same Core, not the
same machine read two ways, which is what makes this a real fourth leg.

Two tests carry the slice's headline claim:

- binary_computes_what_unary_cannot_represent asserts BOTH halves: 100 * 100
  is still TmRun::Overflow under unary at every width to the ceiling, AND a
  value under binary. The unary half is the control — without it the test
  would pass equally well if binary were secretly falling back to unary.
- a_binary_tape_does_not_decode_as_unary pins that the encoding is load-bearing
  all the way through decode_tape, which it was not before parse_heap_cells
  moved onto the trait.

The file keeps its name: renaming it would break
first_order_demos_stay_synced_across_all_three_copies' path-based extraction
for no gain. The module doc now says so."
```

---

### Task 15: Sweep the bank-safety ladder over both encodings

**Files:**
- Modify: `crates/redextape-core/tests/tm_bank_invariant.rs`
- Modify: `crates/redextape-core/tests/tm_exhaustive_bank_safety.rs`
- Modify: `crates/redextape-core/tests/tm_static_delimiter_safety.rs`
- Modify: `crates/redextape-core/tests/tm_heap_stack_shape.rs`
- Modify: `crates/redextape-core/tests/tm_width_equivalence.rs`
- Modify: `crates/redextape-core/tests/common/mod.rs` (`assert_delimiter_safe`)

**Interfaces:**
- Consumes: Task 2's generic checkers, Task 13's complete `Binary`.
- Produces: every ladder rung parameterized over `[&Unary::at(w), &Binary::at(w)]`.

**`assert_delimiter_safe` must learn about WORK.** It checks REG and BOX. Under `Binary`, WORK is a `#`-delimited fixed-width bank too, and its delimiters are exactly as destructible. Derive it from an existing method rather than adding a fourth:

```rust
/// Assert delimiter safety on every FIXED-WIDTH tape. REG and BOX always; WORK only when the encoding
/// declares it structured by returning a non-empty `init_work`. HEAP and STACK are excluded because
/// they are variable-width and delimited by DATA — `dispatch_tag` deliberately erases a `#` there, so
/// a per-rule check reports correct code as violations (measured: 4-10 on HEAP, up to 52 on STACK).
pub fn assert_delimiter_safe(m: &Machine, enc: &dyn Encoding, what: &str) {
    let mut tapes = vec![(redextape_core::tm::REG, "REG"), (redextape_core::tm::BOX, "BOX")];
    if !enc.init_work().is_empty() {
        tapes.push((redextape_core::tm::WORK, "WORK"));
    }
    for (tape, name) in tapes {
        let bad = unsafe_rules(m, tape);
        assert!(
            bad.is_empty(),
            "{what}: {} rule(s) on {name} could write over a delimiter:\n  {}",
            bad.len(),
            bad.join("\n  ")
        );
    }
}
```

**The exhaustive sweep's widths mean different things per encoding — say so.** `WIDTHS = [2, 3, 4, 5]` was chosen so "a narrow bank makes overflow the COMMON case rather than a rare one, which is the regime the guard exists for". Under unary a 2-cell field holds `{0, 1}`; under binary it holds `{0..3}`, and a 5-cell field holds `{0..31}` where unary holds `{0..4}`. Copying the numbers would silently weaken the sweep's coverage of the very regime it was designed for.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/tests/tm_exhaustive_bank_safety.rs`:

```rust
/// The sweep's widths are chosen for a REGIME — overflow being the common case, not a rare one — and
/// the regime is a property of the VALUE RANGE, not of the cell count. A unary 5-cell field holds
/// {0..4}; a binary one holds {0..31}. Copying unary's numbers to binary would quietly move the sweep
/// out of the regime it was designed for while looking identical in the source.
///
/// This test does not check a machine. It checks that the constants still describe what their comment
/// claims, which is the failure mode this suite keeps finding in itself.
#[test]
fn the_swept_widths_cover_the_overflow_regime_for_each_encoding() {
    for &w in UNARY_WIDTHS {
        assert!(w <= 5, "unary width {w} holds values < {w}, too wide for the overflow regime");
    }
    for &w in BINARY_WIDTHS {
        let max = 1u64 << w;
        assert!(max <= 32, "binary width {w} holds values < {max}, too wide for the overflow regime");
    }
    assert!(!BINARY_WIDTHS.is_empty(), "the binary sweep must not be silently empty");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --test tm_exhaustive_bank_safety the_swept_widths 2>&1 | tail -10
```

Expected: FAIL to compile — `UNARY_WIDTHS`/`BINARY_WIDTHS` do not exist.

- [ ] **Step 3: Split the width constants and parameterize the sweep**

```rust
/// The widths swept for UNARY. Small on purpose: a narrow bank makes overflow the COMMON case rather
/// than a rare one, which is the regime the guard exists for. Width 2 is the narrowest that can hold
/// any value (unary's bound is strict, so a 2-cell field holds only 0 and 1).
const UNARY_WIDTHS: &[usize] = &[2, 3, 4, 5];

/// The widths swept for BINARY, chosen for the same REGIME rather than the same NUMBERS. A binary
/// `w`-cell field holds `2^w` values, so unary's 5 would hold {0..31} — far outside the
/// overflow-is-common regime. Widths 1-3 hold {0..1}, {0..3} and {0..7}, which is the analogue.
const BINARY_WIDTHS: &[usize] = &[1, 2, 3];
```

Replace `WIDTHS` at every use with a loop over both `(encoding, widths)` pairs, and log the per-encoding program count so a silently halved sweep is visible:

```rust
println!("swept {n_programs} programs x {} widths for {enc_name}", widths.len());
```

- [ ] **Step 4: Parameterize the other four ladder files**

- `tm_bank_invariant.rs` — its width ladder (`MIN_FIELD_WIDTH` doubling to `MAX_FIELD_WIDTH`) applies to both; wrap each test body in a loop over `[("unary", enc_u), ("binary", enc_b)]` and include the encoding name in every assertion message.
- `tm_static_delimiter_safety.rs` — **`unsafe_rules` DOES need a change. The plan claimed otherwise and was wrong; the Task 6 review measured it.** Its safety clause (b) — "the rule reads an explicit non-`SEP` symbol on that tape, so it provably never fires with the head on a delimiter" — is implemented at `tests/common/mod.rs:111` as `matches!(rule.read[tape], Some(MARK) | Some(BLANK))`, which hardcodes the UNARY alphabet. Under `Binary` every digit-write rule reads `Some(ZERO)` or `Some(MARK)`; the `ZERO` ones fail clause (b) and get reported as unsafe. That is a FALSE POSITIVE on correct code, and the failure mode is the dangerous direction for this checker — a reviewer seeing spurious violations learns to discount it.

  **Fix:** clause (b) must consult `enc.field_symbols()` instead of naming symbols, so `unsafe_rules` takes the encoding (or the content slice). Then add binary machines to the corpus loop and pass `enc` to `assert_delimiter_safe`.

  **Verify the fix in BOTH directions**, because a clause loosened until the false positives disappear is a clause that no longer rejects anything: (i) a correct binary machine yields zero violations, and (ii) a rule that writes a digit under a WILDCARD read is still reported. Sabotage (ii) explicitly — replace one `for &old in BITS` enumeration in `write_literal` with a single wildcard-read rule and confirm `unsafe_rules` catches it.
- `tm_heap_stack_shape.rs` — pass `enc` to `heap_tape_is_well_formed`; loop the corpus and the proptest over both.
- `tm_width_equivalence.rs` — both properties ("the same program gives the same answer at every width" and "step count is non-decreasing in the field width") should hold for binary. If the second does **not** hold, do not weaken it: report the counterexample, because a step count that *drops* as the bank widens means a gadget's cost depends on content in a way the counted chains were supposed to remove.

- [ ] **Step 5: Run the fast tier, then the slow tier**

```bash
cargo test -p redextape-core 2>&1 | tail -20
scripts/check-slow.sh 2>&1 | tail -30
```

Expected: PASS. The slow tier's runtime roughly doubles — record the before/after in the commit body.

- [ ] **Step 6: Sabotage-verify that the ladder actually covers binary**

In `binary.rs`, change `copy_field`'s final `copy_digit_step` to write `SEP` instead of the digit (i.e. `RuleSpec::new().on(dst_tape, Some(d), Some(SEP), Move::R)`), then run:

```bash
cargo test -p redextape-core --test tm_bank_invariant 2>&1 | tail -20
cargo test -p redextape-core --test tm_static_delimiter_safety 2>&1 | tail -20
```

Expected: **BOTH FAIL** — the per-step one on a corrupt bank, the static one naming the offending rule. If `tm_static_delimiter_safety` stays green, the binary machines were not added to its corpus and the sweep is not covering what it claims. Restore and confirm green.

- [ ] **Step 7: Commit**

```bash
git add -A crates/redextape-core/tests
git commit -m "test(tm): the bank-safety ladder sweeps both encodings

Binary has its own bank with its own write sites, so a ladder that verifies
only unary verifies nothing about the machine this slice adds.

Three things worth recording:

- assert_delimiter_safe now also checks WORK, derived from init_work() being
  non-empty rather than from a new trait method. Under binary WORK is a
  #-delimited fixed-width bank and its delimiters are exactly as destructible.
- The exhaustive sweep's widths are SPLIT per encoding, not shared. They were
  chosen for a REGIME — overflow being the common case — and the regime is a
  property of the value range, not the cell count: unary's 5 holds {0..4}
  while binary's would hold {0..31}. Copying the numbers would have quietly
  moved the sweep out of the regime it was designed for while looking
  identical in the source. A test now asserts the constants still describe
  what their comment claims.
- tm_static_delimiter_safety needed NO checker change: unsafe_rules only
  reasons about writing a non-# while the head is on a #, and never names
  MARK or BLANK. It was encoding-independent all along.

Sabotage-verified: making copy_field write SEP over a digit turns both the
per-step and the static rung red."
```

---

### Task 16: Close roadmap item 4 — the unbounded encoding branch

**Files:**
- Create/Modify: `crates/redextape-core/tests/tm_encoding.rs` (a test-only unbounded `Encoding`)
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**Interfaces:**
- Consumes: the complete trait.
- Produces: `struct Unbounded(Unary)` in the test file — an `Encoding` that delegates everything to `Unary::default()` but reports `field_width() == None`.

**Why this is here and not free.** Roadmap item 4 (line 452) predicted `run_tm_fitted`'s `field_width() == None` branch would become testable "the day `Binary` lands, at which point it is free". **This design falsifies that prediction:** `Binary` is bounded (decision D2), so it does not exercise the branch either. A test-only mock does, and it is cheap — so do it, and correct the roadmap entry so the next reader inherits the fact rather than the prediction.

- [ ] **Step 1: Write the failing test**

```rust
/// An encoding reporting `field_width() == None` declares itself UNBOUNDED, and `run_tm_fitted` must
/// then make exactly ONE attempt with no width search and report `None` as the fitted width.
///
/// That branch has never been executed. Roadmap item 4 predicted the binary encoding would exercise
/// it for free; it does not, because Binary is bounded. This mock is what actually covers it —
/// delegating every gadget to `Unary::default()` so only the width REPORTING differs.
#[derive(Debug)]
struct Unbounded(Unary);

impl Encoding for Unbounded {
    fn field_width(&self) -> Option<usize> {
        None
    }
    fn at_width(&self, _width: usize) -> Box<dyn Encoding> {
        Box::new(Unbounded(self.0))
    }
    // Every other method delegates to `self.0`.
    // ...
}

#[test]
fn an_unbounded_encoding_makes_exactly_one_attempt() {
    let (prog, ds) = parse("1 + 2 * 3");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let (run, width) = run_tm_fitted(&core, &Unbounded(Unary::default()), TM_DEFAULT_CAPS);
    assert_eq!(width, None, "an unbounded encoding reports no fitted width");
    let TmRun::Ran { tapes } = run else { panic!("expected a value: {run:?}") };
    assert_eq!(decode_tape(&tapes, &Value::Nat(0), &Unary::default()), Some(Value::Nat(7)));
}

/// The unbounded branch must NOT retry. A program that overflows the delegate's 64-cell field comes
/// back as `Overflow` from the single attempt, rather than looping — which is the specific behaviour
/// the `is_none()` early return exists to produce.
#[test]
fn an_unbounded_encoding_does_not_search_on_overflow() {
    let (prog, ds) = parse("100 * 100");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let (run, width) = run_tm_fitted(&core, &Unbounded(Unary::default()), TM_DEFAULT_CAPS);
    assert!(matches!(run, TmRun::Overflow), "one attempt, then report: {run:?}");
    assert_eq!(width, None);
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p redextape-core --test tm_encoding an_unbounded 2>&1 | tail -10
```

Expected: FAIL to compile until the delegating impl is written out.

- [ ] **Step 3: Write the delegating impl**

Every method other than `field_width` and `at_width` forwards to `self.0`. Write them out explicitly — a macro here would hide exactly the thing the test is checking.

- [ ] **Step 4: Run the tests**

```bash
cargo test -p redextape-core --test tm_encoding 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Correct the roadmap**

In `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, replace item 4 of the TM bank-safety list (lines 452–454) with:

```markdown
  4. **`Encoding::at_width` on an unbounded encoding — CLOSED (2026-07-27).** This item predicted the
     branch would become testable free "the day `Binary` lands". **That prediction was wrong, and the
     binary slice recorded why:** `Binary` is bounded (a `w`-cell field holds `v < 2^w`), so it does
     not exercise `field_width() == None` either. What covers the branch is a test-only `Unbounded`
     mock in `tests/tm_encoding.rs` that delegates every gadget to `Unary` and differs only in what it
     reports. Cheap, but not free, and not a side effect of anything.
```

- [ ] **Step 6: Commit**

```bash
git add -A crates/redextape-core/tests docs
git commit -m "test(tm): cover run_tm_fitted's unbounded branch, and correct the roadmap

Roadmap item 4 predicted field_width() == None would become testable free 'the
day Binary lands'. The prediction was wrong: Binary is bounded — a w-cell field
holds v < 2^w — so it does not exercise that branch either.

A test-only Unbounded mock does. It delegates every gadget to Unary and differs
only in what it REPORTS, so the two tests isolate exactly the search behaviour:
one attempt, no retry, width None — including on a program that overflows the
delegate, which must come back as Overflow rather than looping.

The roadmap entry now records the fact instead of the prediction."
```

---

### Task 17: The measurement, the goldens, and the docs

**Files:**
- Modify: `crates/redextape-core/examples/width_report.rs`
- Modify: `crates/redextape-core/examples/step_survey.rs`
- Modify: the step-count golden test (wherever `run_tm_at` goldens live)
- Modify: `docs/superpowers/specs/2026-07-26-tm-binary-encoding-design.md`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`
- Modify: `crates/redextape-native/tests/native_oracle.rs`, `examples/native_demo.rs` (stale claims)

**Interfaces:**
- Consumes: everything.
- Produces: a per-program unary-vs-binary comparison of **fitted width, total steps, and final REG tape length**, plus binary step-count goldens.

**This is the deliverable that makes the toggle worth having.** The spec predicts binary banks are shorter and binary step counts are *higher* on this corpus (every value is under 64, the regime where a `k`-cell unary add beats a `w`-cell ripple carry). Confirm or refute — do not assert.

- [ ] **Step 1: Add binary columns to `width_report`**

For every corpus program, print: fitted width, steps, and final REG length under each encoding, plus the ratios. Include a footer stating the corpus size and that `run_tm_fitted` chose each width.

- [ ] **Step 2: Run it and record the numbers**

```bash
cargo run --release --example width_report -p redextape-core 2>&1 | tail -60
```

Paste the table into the commit body and into the spec's "What the measurement is expected to show" section, replacing the predictions with results and **explicitly noting which predictions were wrong**.

- [ ] **Step 3: Add binary step-count goldens**

Golden numbers use `run_tm_at` (no search), so they stay comparable across slices. Add a binary golden per existing unary golden, at the same explicit width.

- [ ] **Step 4: Fix the claims this slice made false**

```bash
grep -rn "MAX_FIELD_WIDTH" crates/redextape-native/tests/native_oracle.rs crates/redextape-native/examples/native_demo.rs
```

`native_oracle.rs:13-14` says native's "DISTINCTIVE capability is having no `MAX_FIELD_WIDTH` (64) ceiling … unlike the TM's fixed-width unary tape". That is now only true of the *unary* tape: the binary TM reaches 2⁶⁴. Reword each site to say "the TM's unary tape" and note that the binary encoding narrows the gap to values ≥ 2⁶⁴. Do **not** delete `native_runs_beyond_field_width` — it still tests a real difference, just a smaller one.

- [ ] **Step 5: Update the spec and roadmap**

In the spec: correct §3.3's WORK table to **one** field (see Phase 2's opening note), and replace the measurement predictions with results.

In the roadmap: add a completed entry for the encoding track's item 3, in the style of the other completed entries — what shipped, what it cost, and the findings a future reader would otherwise rediscover.

- [ ] **Step 6: Full gate**

```bash
scripts/check-all.sh --no-llvm 2>&1 | tail -30
scripts/check-slow.sh 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(tm): the unary-vs-binary measurement, goldens, and the docs it falsifies

width_report and step_survey gain a binary column: fitted width, total steps
and final REG length per program under each encoding.

<paste the headline numbers and say plainly which of the spec's two
predictions held and which did not>

Also corrects two claims this slice made false:

- The spec estimated three WORK scratch fields. One is enough, because mul
  shifts the accumulator rather than the multiplicand and eq parks in REG rd.
- native_oracle.rs and native_demo.rs advertise native's 'distinctive
  capability' as having no MAX_FIELD_WIDTH ceiling 'unlike the TM's
  fixed-width unary tape'. True of the unary tape only: the binary TM reaches
  2^64, so the gap is now values >= 2^64. The test stays — it still tests a
  real difference, just a smaller one."
```

---

## Self-review

Checked against `docs/superpowers/specs/2026-07-26-tm-binary-encoding-design.md`:

**Spec coverage.** Every architecture section maps to a task: §1 Representation → Tasks 6–13; §2 Module layout → Task 1; §3.1 `parse_heap_cells` → Task 3; §3.2 `field_symbols` → Task 2; §3.3 `init_work` → Task 4; §3.4 the `field_width` doc → Task 5's shared-primitive docs and Task 2's trait doc; §4 the gadget library → Tasks 6–13 one family per task; Testing items 1–5 → Tasks 6–13 (item 1), 14 (item 2), 15 (items 3–5); Deliverables 1–5 → Tasks 1, 6–13, 2–4, 15, 17. "What stays open" item 1 → Task 16.

**Two places the plan deviates from the spec, both deliberate and both flagged in the task text:**
1. **WORK gets one scratch field, not three** (Phase 2 opening note; Task 17 updates the spec).
2. **`Encoding` gains `field_symbols` returning `&'static [Symbol]`**, and the three checkers take `&dyn Encoding` rather than a separate width — the spec left the signature open.

**One gap the spec named that this plan does NOT close, stated so it is not mistaken for coverage:** spec "What stays open" item 4 asks for a pass over the native suite's framing. Task 17 Step 4 rewords the two stale claims but does not re-examine `native_runs_beyond_field_width`'s design. That is the right scope — the test still tests a real difference — but it is a reword, not a review.

**Naming consistency.** `BITS`, `W_ACC`, `copy_field`, `copy_digit_step`, `ripple_add`, `ripple_sub`, `zero_field`, `shift_left_acc`, `bit_is_one`, `branch_on_zero`, `branch_on_equals`, `inc_acc`, `dec_acc`, `stack_push_acc`, `stack_push_literal`, `stack_pop_acc`, `heap_cell_len` are each defined in exactly one task and referenced by that name thereafter. `seek_slot`/`rewind_home` carry the same six-parameter signature from Task 5 onward at every call site.
