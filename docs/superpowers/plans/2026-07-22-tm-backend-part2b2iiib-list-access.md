# TM Backend — Part 2b-2-iii-b: List Access (`Head`/`Tail` runtime deref) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task 1 is δ-gadget authoring on a live state machine (like Parts 2b-1/2b-2-ii/2b-2-iii-a): **the simulation test is the contract; author and iterate the δ-states until it passes.** Hand-trace the seek + field-reads cell-by-cell in review — the runtime cell-seek is the hardest gadget in the whole backend. Tasks 2–4 are composition/wiring/oracle with complete code.

**Goal:** Lower `Head`/`Tail` into TM gadgets that **dereference a runtime pointer** over the HEAP tape — read a register's pointer `P`, runtime-seek to the `P`-th cons cell, and read its head/tail field into `rd` — so the multi-tape Turing machine performs **list access**. Delivers `head(cons(7, nil))`, `tail(cons(1, cons(2, nil)))`, `head(tail(…))` agreeing with the reference tree-walker. `head(nil)`/`tail(nil)` and dangling pointers **defensively halt** (totality, not an oracle demo).

**Architecture:** A pointer `P` in a REG field addresses the `P`-th `@`-delimited cons cell (1-based; `nil = 0`). `Head`/`Tail` copy `P` into WORK as a unary counter, walk the HEAP to the origin, then walk right **decrementing the counter once per cell** until it drains — landing on the target cell's `@` — and copy that cell's head (or tail) field into WORK, then into `rd`. A zero counter (`nil`) or a counter that outlives the cells (dangling pointer) routes to an internal **defensive-halt** state (a rule-less non-accept state — the simulator treats "stuck" as halted). No new symbols, no HEAP mutation (access is read-only; the HEAP-top invariant is restored on exit). `decode_tape` is **unchanged** — a `Head` result is a Nat (or a nested pointer) and a `Tail` result is a pointer, both already followed by the existing `decode_word`.

**Tech Stack:** Rust; the merged `tm::{asm, lower_asm, machine, sim, build, encoding, lower_tm, decode}` modules; the Part-2a simulator is the test oracle.

## Global Constraints

Copied from the design spec (`docs/superpowers/specs/2026-07-22-tm-backend-design.md` §3.1, §4.1, §8) and the `tm-backend-plan3` memory. Every task's requirements implicitly include this section.

- **List value model (mirror `asm.rs` exactly).** A `List` in a register is a **pointer** (a unary address); `nil` = pointer `0`; the `P`-th 1-based cell holds `(head-word, tail-pointer)`. `Head(rd, rl)` reads pointer `P` from `rl` and writes `heap[P-1].head` into `rd`; `Tail(rd, rl)` writes `heap[P-1].tail`. `asm.rs` faults on `P == 0` and on `P` past the heap end (`AsmRun::Fault`); the reference tree-walker faults identically (`RuntimeError("head/tail of empty list")` → `RunError::Runtime`).
- **HEAP tape format (unchanged from 2b-2-iii-a):** `@ <head marks> # <tail marks>` cells concatenated, cell `i` (1-based) = the `i`-th `@` = pointer `i`; empty heap = all blank; a zero-count field is adjacent delimiters (so the ONLY blanks are the origin-left boundary and the top). Alphabet stays `1`/`_`/`#`/`@` — **NO new symbol**. Every produced `Machine` passes `Machine::validate()`.
- **Home conventions (all tapes restore on every gadget exit).** REG head on the leading `#`; WORK at its leftmost cell; STACK at its top (untouched here); **HEAP head at the "top" = the leftmost blank after all cells (origin when empty)**. `Head`/`Tail` are read-only: they navigate the HEAP but **restore the head to the top** on the value-producing exit (so a nested `head(tail(x))` composes). On a fault (defensive-halt) exit the tapes may be anywhere — the machine is terminating.
- **`v < FIELD_WIDTH` STRICT (64).** Pointers and head-word Nat values live in REG fixed-width fields, so a list is limited to ~63 cells (pointers `< FIELD_WIDTH`); the demos are tiny (≤ 3 cells). HEAP head/tail fields are variable-width unary.
- **`Rr` is REG slot 0**; a `Head`/`Tail` result (Nat or pointer) leaves its word in slot 0, which `decode_tape` reads (and follows into the HEAP for a pointer).
- **Panic-free & total on ANY `Program`** — no panic/unwrap on program-derived data. The runtime seek MUST be total: for **any** pointer value in the field (`0`, in-range, or past the cell count) it reaches a halt without hanging or over-indexing. The `MAX_SLOTS`/`MAX_FRAME_LOC` guards (2b-2-i/ii) stay intact and untouched.
- **Encoding-generic.** The new deref gadgets are `Encoding` trait methods (`head_op`/`tail_op`, Unary impl), like `cons`/`is_empty_op`; `lower_tm` calls them through `&dyn Encoding`. The HEAP's *structural* navigation (`@`-counting, pointer decrement) is unary-always; the head/tail-word *values* it copies follow the encoding — the same boundary the binary follow-on refines.
- **`decode_tape` is unchanged and still uses `expected` only for its shape.** A `Head`/`Tail` result is decoded by the existing `decode_word` (a Nat, or a pointer followed through the HEAP). Do NOT modify `decode.rs`.

---

## File Structure

- **Modify** `crates/redextape-core/src/tm/encoding.rs` — add 3 HEAP sub-primitives (free fns: `heap_seek_cell`, `heap_read_head_to_work`, `heap_read_tail_to_work`) + 2 `Encoding` trait methods (`head_op`, `tail_op`) with `Unary` impls; add unit tests.
- **Modify** `crates/redextape-core/src/tm/lower_tm.rs` — replace the `Head`/`Tail` `halt` placeholders with real arms; add module tests (deref on real lists; nil/dangling totality).
- **Modify** `crates/redextape-core/tests/tm_oracle.rs` — add the list-ACCESS demo subset (`reference == TM` + `asm-interp == TM`). Prior subsets stay.
- **NO change** to `build.rs` (`AT` already exists), `tm.rs` (no new export), or `decode.rs` (already follows pointers). If you find yourself editing `decode.rs`, stop — the result word is a Nat or a pointer the existing `decode_word` already handles.

---

## Design reference (read before Task 1)

**HEAP recap.** `@ head # tail @ head # tail …`, head at the **top** (the blank after the last cell; origin when empty). Cell `i` is the `i`-th `@`. The only two blanks are the **origin-left boundary** (left of cell 1) and the **top** (right of the last cell); no interior blanks (a zero field is adjacent delimiters). This is exactly the two-landmark world `heap_count_cells_to_work` already navigates — reuse its shapes.

**The runtime cell-seek (the hard part).** Given a counter `P ≥ 1` in WORK (home) and the HEAP head at the top, land on the `P`-th cell's `@`:

1. **Walk to the origin.** Step left off the top blank, then walk left over `AT`/`MARK`/`SEP`; stop at the origin-left blank (mirrors `heap_count_cells_to_work` Pass 1's left walk, minus the counting).
2. **Step right onto cell 1.** Step right off the origin-left blank. Read the HEAP head: `AT` → you're on cell 1, enter the decrement loop; `BLANK` → the heap is empty (no cell 1) → **`missing`** (this covers the empty-heap dangling case).
3. **Decrement loop** (HEAP head on a cell's `@`, WORK home over the counter):
   - **Decrement the counter** with `dec_work` (erase WORK's rightmost mark; a WORK-only walk, so the HEAP head stays parked on the `@`).
   - Read WORK at home: **`BLANK`** (counter drained to 0) → this `@` is the `P`-th cell → **`found`**. **`MARK`** (counter still positive) → **advance to the next cell**: step right off this `@`, walk right over `MARK`/`SEP`; on the next `AT` loop back to the decrement, on `BLANK` (hit the top before another cell) → **`missing`** (pointer past the cell count).

   The counter strictly decreases each iteration (dec_work erases one mark) and the HEAP head strictly advances right, over a finite tape — so the loop always reaches `found` or `missing`. Total. (`P ≤ FIELD_WIDTH − 1 = 63` from the strict field bound, but totality does not rely on that — `missing` fires whenever the cells run out first.)

**Reading a cell's field** (HEAP head on the target `@`, WORK **empty** at home — the seek's `found` exit drains the counter to 0, so WORK is empty; REG home):
- **Head:** step right off the `@`, copy each `MARK` into WORK (both heads advance R), stop at the `#` (`SEP`) that ends the head field. WORK now holds the head-word.
- **Tail:** step right off the `@`, walk right over the head `MARK`s to the `#`, step right off the `#`; copy each `MARK` into WORK, stop at the next `AT` (next cell) **or** the top `BLANK` (last cell). WORK now holds the tail-word.
- **Both then restore the HEAP top:** keep walking right over any remaining `MARK`/`SEP`/`AT` to the top `BLANK`, then `rewind_work` (WORK head home, marks intact). On exit WORK holds the field value at home and the HEAP head is back at the top.

**Reused merged primitives:** `copy_field_to_work(slot)`, `append_work_to_field(rd)`, the private `dec_work` and `rewind_work` (all in `encoding.rs` — same module, so the private ones are in scope). Import what you need.

**Defensive halt (the fault path).** `nil` (`P == 0`) is caught in the trait method BEFORE the seek (a WORK-empty branch after `copy_field_to_work`); dangling (`P >` cell count) is the seek's `missing` exit. Both route to an internal **rule-less non-accept state** the gadget creates (`b.state("…fault")` with no rules): the simulator treats a stuck state as `Halted` (sim.rs "stuck == halt"), so the machine terminates without a panic or hang. This is **totality only** — it is NOT wired into the oracle (see the note in Task 4).

---

## Task 1: HEAP deref sub-primitives — `heap_seek_cell`, `heap_read_head_to_work`, `heap_read_tail_to_work`

The runtime-seek + field-readers, tested in isolation against a staged heap. This is the δ-authoring task; get the decrement loop, the `found`/`missing` exits, and the HEAP-top restoration airtight.

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (3 free fns + tests)

**Interfaces produced (free fns in `encoding.rs`, `pub`):**
- `pub fn heap_seek_cell(b: &mut Builder, from: StateId, found: StateId, missing: StateId)` — a two-exit gadget (like `stack_is_empty`). **Precondition:** WORK holds the counter `P ≥ 1` at home; HEAP head at the top; REG home. Navigates to the `P`-th cell. `found`: HEAP head on the `P`-th cell's `@`, WORK **empty** at home, REG home. `missing`: `P` exceeds the cell count (or the heap is empty) — HEAP head position unspecified (the caller halts). Derive state names from `from` (unique per call), like `stack_is_empty`.
- `pub fn heap_read_head_to_work(b: &mut Builder, from: StateId, label: &str) -> StateId` — HEAP head on a cell's `@`, WORK empty at home, REG home. Copies the cell's **head** field into WORK, restores the HEAP head to the top, WORK home. Returns the exit state.
- `pub fn heap_read_tail_to_work(b: &mut Builder, from: StateId, label: &str) -> StateId` — as above for the **tail** field.

- [ ] **Step 1: Write the failing test (the contract)**

Add to `encoding.rs`'s `#[cfg(test)] mod tests`. It stages a fixed heap `[(7,0),(3,1)]` via the merged `cons`, sets WORK to a counter, seeks, and reads the head or tail — asserting the value, and the `missing` sentinel for a dangling pointer.

```rust
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
    let read =
        if read_tail { heap_read_tail_to_work(&mut b, found, "rt") } else { heap_read_head_to_work(&mut b, found, "rh") };
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
```

> If one test is doing too much while you iterate, split the `missing` case into its own `#[test]` (`run_seek_read(3, false) == Some(9)`). Keep the assertions concrete; do not weaken them.

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::encoding::tests::heap_seek_and_read_head_and_tail`
Expected: FAIL — `heap_seek_cell`, `heap_read_head_to_work`, `heap_read_tail_to_work` undefined.

- [ ] **Step 3: Author the three δ-gadgets (iterate against the test)**

Author the three free fns per the Design reference. Load-bearing details:
- **`heap_seek_cell` decrement loop:** `dec_work` is a WORK-only walk, so the HEAP head must stay parked on the current `@` across the decrement — verify no rule you add moves HEAP during the decrement. Re-enter the SAME decrement state on the loop back-edge (one loop state, not one per cell). The initial landing (after stepping right off the origin) needs the `AT` → loop / `BLANK` → `missing` guard (empty heap); the advance-to-next-cell needs the `AT` → loop / `BLANK` → `missing` guard (ran off the top). `found` fires on the WORK-`BLANK` branch after a decrement, with WORK empty at home and the HEAP head on the target `@`.
- **`found` leaves WORK empty:** the seek drains the counter to exactly 0 to detect the target, so the field-readers begin with WORK empty at home — they copy the field starting from empty (do NOT append onto a stale counter). State this as their precondition.
- **HEAP-top restoration:** after copying the field, the readers walk right over ALL remaining `MARK`/`SEP`/`AT` to the top `BLANK` (the "walk right until BLANK" landmark, same as `heap_count_cells_to_work` Pass 2), then `rewind_work`. Confirm the head reader crosses the cell's own `#` + tail marks + later cells, and the tail reader (which may stop on an `AT`) crosses later cells, before resting on the top.
- **Tail of an empty field:** cell 1's tail is 0 marks — the tail reader copies zero marks (stops immediately on the next `@`), yielding WORK = 0. Confirm this decodes to `Some(0)`.
- Branch by disjoint reads; unique `{label}.…` / `se{from}.…` state names (the test asserts `validate()`).

Iterate until Step 1 passes; hand-trace the seek to cell 2 and both field reads cell-by-cell, plus the dangling walk.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core --lib tm::encoding::tests`
Expected: PASS (new + all prior encoding tests).

- [ ] **Step 5: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): HEAP deref sub-primitives (runtime cell-seek + head/tail field reads)"
```

---

## Task 2: `Encoding::head_op` and `Encoding::tail_op`

Compose Task 1's primitives into the two trait methods: copy the pointer into WORK, catch `nil`, seek, read the head (or tail) field, write it to `rd`. Both fault paths route to an internal defensive-halt state.

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (2 trait methods + Unary impls + tests)

**Interfaces produced (added to `pub trait Encoding`):**
- `fn head_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot)` — `rd <- head(field rl)`: read the pointer in `rl`, seek the cell, write its head-word into `rd`. Flows `entry → exit` with all heads home/top on the value exit. A `nil` pointer (`rl == 0`) or a dangling pointer routes to an internal defensive-halt (the machine terminates; `rd` is not written). **PRECONDITION:** `rd` distinct from `rl` (`rd` is written last, after `rl` is fully read — but keep them distinct; `lower_asm` emits fresh operands).
- `fn tail_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot)` — as above for the tail-word.

- [ ] **Step 1: Write the failing test**

```rust
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::encoding::tests::head_op_and_tail_op_read_a_cell`
Expected: FAIL — `head_op`/`tail_op` not on the trait.

- [ ] **Step 3: Add the trait methods + Unary impls**

Add both signatures to `pub trait Encoding` (doc per the contract; note the structural navigation is unary-always while the copied head/tail word follows the encoding, like `cons`). Unary impls — the `nil` branch and the seek's `missing` share ONE internal defensive-halt state:

```rust
    fn head_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot) {
        let base = format!("hd{entry}");
        let cw = copy_field_to_work(b, entry, rl, &format!("{base}.p")); // WORK <- P (pointer)
        // Defensive halt: nil (P == 0) and dangling (seek misses) both terminate here. A rule-less
        // non-accept state -> the simulator halts (stuck == halt). NOT an oracle path (see Task 4).
        let fault = b.state(format!("{base}.fault"));
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
        let seek = b.state(format!("{base}.sk"));
        b.add_rule(cw, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S), fault);
        b.add_rule(cw, RuleSpec::new().on(WORK, Some(MARK), None, Move::S), seek);
        let found = b.state(format!("{base}.fd"));
        heap_seek_cell(b, seek, found, fault);
        let read = heap_read_tail_to_work(b, found, &format!("{base}.rt")); // WORK <- tail-word
        let wr = append_work_to_field(b, read, rd, &format!("{base}.wr"));
        b.add_rule(wr, RuleSpec::new(), exit);
    }
```

> The two methods are near-identical (they differ only in the field-reader). Keep them as two small composes — do NOT over-abstract into a shared closure-parameterized helper; the duplication is four lines and matches the `cons`/`is_empty_op` style. `copy_field_to_work`'s exit state is rule-less, so adding the two disjoint WORK-branch rules to `cw` is sound.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core --lib tm::encoding::tests`
Expected: PASS.

- [ ] **Step 5: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): Encoding::head_op/tail_op (runtime pointer deref)"
```

---

## Task 3: Wire `Head`/`Tail` into `lower_tm` + totality

Replace the `Head`/`Tail` `halt` placeholders in `lower_tm` with `head_op`/`tail_op`; add lower-level tests: deref on real lists (mirrors `asm.rs`'s `head_tail_deref`), and `head(nil)`/`tail(nil)`/dangling **totality** (a defensive halt, no panic/hang).

**Files:**
- Modify: `crates/redextape-core/src/tm/lower_tm.rs` (two arms + tests)

**Interface consumed:** `enc.head_op(entry, exit, rl, rd)`, `enc.tail_op(entry, exit, rl, rd)` (Task 2). Operand order: asm `Instr::Head(rd, rl)` (`.0` = `rd`, `.1` = `rl`) → `head_op(…, slot(rl), slot(rd))`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn head_tail_deref_reads_a_nested_element() {
    // rr = head(tail(cons(1, cons(2, nil)))) == 2. Identical to asm.rs's head_tail_deref.
    let prog = Program {
        code: vec![
            Instr::Nil(Reg::Loc(0)),                            // r0 = nil
            Instr::Li(Reg::Loc(1), 2),
            Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)), // r2 = cons(2, nil)
            Instr::Li(Reg::Loc(3), 1),
            Instr::Cons(Reg::Loc(4), Reg::Loc(3), Reg::Loc(2)), // r4 = cons(1, r2)
            Instr::Tail(Reg::Loc(5), Reg::Loc(4)),              // r5 = tail(r4) -> ptr to (2,nil)
            Instr::Head(Reg::Rr, Reg::Loc(5)),                  // rr = head(r5) = 2
            Instr::Halt,
        ],
        labels: vec![],
    };
    assert_eq!(run_nat(&prog), Some(2));
}

#[test]
fn head_tail_faults_are_total_defensive_halts() {
    // head(nil), tail(nil), and a dangling pointer must be TOTAL: a defensive halt, no panic/hang.
    // NOT an oracle case — the reference faults (RunError::Runtime) while the TM halts; oracle-level
    // fault-equivalence is Part 2b-2-iv. Here we only assert the machine terminates cleanly.
    fn halts(prog: &Program) -> bool {
        let m = lower_tm(prog, &Unary);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let sm = SlotMap::of(prog);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = Unary.init_reg(sm.n_slots());
        matches!(simulate(&m, &init, CAPS).1, Status::Halted)
    }
    // head(nil) / tail(nil): pointer 0.
    assert!(halts(&Program {
        code: vec![Instr::Nil(Reg::Loc(0)), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
        labels: vec![],
    }));
    assert!(halts(&Program {
        code: vec![Instr::Nil(Reg::Loc(0)), Instr::Tail(Reg::Rr, Reg::Loc(0)), Instr::Halt],
        labels: vec![],
    }));
    // Dangling: pointer 5 into an empty heap (mirrors asm.rs's head_of_invalid_pointer_faults).
    assert!(halts(&Program {
        code: vec![Instr::Li(Reg::Loc(0), 5), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
        labels: vec![],
    }));
}
```

> `run_nat` (2b-2-i) decodes REG slot 0 as a Nat — perfect for the nested-deref result (2). The totality test asserts only `Status::Halted`; a defensive halt is a stuck non-accept state, which the simulator reports as `Halted`.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::lower_tm::tests::head_tail_deref_reads_a_nested_element tm::lower_tm::tests::head_tail_faults_are_total_defensive_halts`
Expected: FAIL — `Head`/`Tail` still route to `halt`, so `run_nat` returns the wrong value (the deref test); the totality test may pass vacuously or fail — it becomes meaningful after Step 3.

- [ ] **Step 3: Replace the `Head`/`Tail` arm**

In `lower_tm.rs`, replace:
```rust
            // `Head`/`Tail` are Part 2b-2-iii-b — defensively halt for now (never fed to this slice's tests).
            Instr::Head(..) | Instr::Tail(..) => b.add_rule(pc[i], RuleSpec::new(), halt),
```
with:
```rust
            Instr::Head(rd, rl) => enc.head_op(&mut b, pc[i], fall, sm.slot(*rl), sm.slot(*rd)),
            Instr::Tail(rd, rl) => enc.tail_op(&mut b, pc[i], fall, sm.slot(*rl), sm.slot(*rd)),
```
Update the module doc: `Head`/`Tail` now dereference a pointer over the HEAP (Part 2b-2-iii-b); `nil`/dangling defensively halt. `instr_regs` already counts `Head`/`Tail` operands (`Head(a,b) | Tail(a,b) => vec![*a, *b]`) so the `SlotMap` is sized correctly — no change there. The `MAX_SLOTS`/`MAX_FRAME_LOC` guards are untouched.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core --lib tm::lower_tm`
Expected: PASS (new + all prior lower_tm tests).

- [ ] **Step 5: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/lower_tm.rs
git commit -m "feat(tm): lower Head/Tail via runtime pointer deref (nil/dangling defensively halt)"
```

---

## Task 4: Oracle extension — list access

Extend `tests/tm_oracle.rs` with the list-ACCESS demo subset: `reference == TM` and `asm-interp == TM`. Head/Tail on **real** lists only (faulting programs are excluded — see the note).

**Files:**
- Modify: `crates/redextape-core/tests/tm_oracle.rs`

- [ ] **Step 1: Add the demos + tests**

```rust
/// The list-ACCESS demo subset: head/tail deref on real (non-nil) lists — head -> a Nat, tail -> nil or
/// a sub-list pointer, and a nested head(tail(...)). NO faulting access (head/tail of nil): the reference
/// faults (RunError::Runtime) while the TM defensively halts, which is an oracle mismatch BY DESIGN;
/// oracle-level fault-equivalence is Part 2b-2-iv. Values/lengths « FIELD_WIDTH.
const LIST_ACCESS_DEMOS: &[&str] = &[
    "head(cons(7, nil))",
    "tail(cons(7, nil))",
    "head(cons(1, cons(2, nil)))",
    "tail(cons(1, cons(2, nil)))",
    "head(tail(cons(1, cons(2, nil))))",
    "head([1, 2, 3])",
    "tail([1, 2, 3])",
];

#[test]
fn tm_agrees_with_reference_on_list_access_demos() {
    for src in LIST_ACCESS_DEMOS {
        assert_tm_agrees(src);
    }
}

#[test]
fn asm_interp_matches_tm_on_list_access_demos() {
    for src in LIST_ACCESS_DEMOS {
        assert_asm_interp_matches_tm(src);
    }
}
```

> If a demo hits a cap under `TM_DEFAULT_CAPS`, first confirm via `asm_interp_matches_tm` it is a genuine cap (not a wrong answer), then raise the caps for the TM oracle with an explanatory comment — do NOT drop a demo or weaken an assertion. (Access is a bounded seek over ≤ 3 cells, far lighter than 2b-2-ii recursion, so a raise is very unlikely.)

- [ ] **Step 2: Run**

Run: `cargo test -p redextape-core --test tm_oracle`
Expected: PASS. If `tm_agrees_*` fails on a `src`, localize with `asm_interp_matches_tm_on_list_access_demos` (asm==TM failing too → a deref/lowering bug; asm==TM passing but reference==TM failing → a decode/shape bug — but decode is unchanged, so suspect the seek reading the wrong field).

- [ ] **Step 3: fmt/clippy + full suite**

Run: `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings && cargo test -p redextape-core`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/tests/tm_oracle.rs
git commit -m "test(tm): reference==TM + asm-interp==TM oracle on the list-access demos"
```

---

## Deferred to later sub-parts (do NOT attempt here)

- **Part 2b-2-iv — the finale:** the full three-way oracle (`reference == λ == TM`) over the whole first-order demo suite (`map`/`fold` stay excluded — higher-order, Plan 3b); **oracle-level fault-equivalence** (a reference `RunError::Runtime` on `head(nil)`/`tail(nil)` ≡ the TM outcome — which means deciding whether the TM should *spin to `HitCap`* on a fault rather than defensively halt, so the existing `(Err(Runtime), HitCap)` oracle arm fires); the TM-bounded proptest (bound `Nat` magnitudes `< FIELD_WIDTH`, register indices `< MAX_SLOTS`, AND list lengths `< FIELD_WIDTH`); golden `print_asm` + TM step counts; TM-text round-trip over compiled machines; and folding the deferred Minors (2b-1 sub-primitive visibility; `x*0`/trichotomy sweeps; broaden `asm_oracle` + drop its dead `RunError::Static` arm; `cmp_mnemonic`→`bin_mnemonic`; dedup `SlotMap::of`; the `parse_heap`↔`heap_cells` DRY hoist; a `decode_word` cycle guard consistent with `decode_asm`; consider splitting STACK/HEAP gadgets into `tm/stack.rs`/`tm/heap.rs` if `encoding.rs` is unwieldy).

## Self-Review (completed while writing)

- **Spec coverage (this slice):** `Head`/`Tail` → runtime HEAP pointer deref (spec §3.1 pointer/heap model, §4.1 HEAP tape) ✓; 1-based pointers + `nil = 0` mirroring `asm.rs` ✓; `nil`/dangling faults total (defensive halt) ✓; `reference == TM` + `asm-interp == TM` on the access demos (§12.1, §12.2) ✓. The full three-way oracle, oracle-level fault-equivalence, proptest, goldens, and text round-trip are deferred to iv.
- **Placeholder scan:** the composition/wiring/oracle code (`head_op`/`tail_op`, the `lower_tm` arms, the oracle demos) is complete and concrete; the one iterative task (Task 1's three deref primitives) carries a full design + a complete simulation-test contract in the 2b-1/2b-2-ii/2b-2-iii-a style. No `unimplemented!()`/`b_placeholder()` sketch markers anywhere — the Task 1 and Task 2 harnesses are fully written.
- **Type/interface consistency:** the new `Encoding` methods (`head_op(…, rl, rd)`, `tail_op(…, rl, rd)`) and free fns (`heap_seek_cell(…, found, missing)`, `heap_read_head_to_work`/`heap_read_tail_to_work(…, label) -> StateId`) are used identically across Tasks 1–3; the operand transposition (asm `Head(rd, rl)` → `head_op(…, rl, rd)`) matches `instr_regs`/`asm.rs`; the HEAP cell format is consumed read-only and identical to 2b-2-iii-a's writer; `decode_tape` is deliberately untouched (the result word is a Nat or a pointer the existing `decode_word` already follows). Totality is preserved: the seek is bounded (counter strictly decreases, HEAP head strictly advances, `missing` fires when cells run out) and `nil`/dangling route to a valid rule-less non-accept state (`validate()` permits it; sim halts on stuck).
