# TM Backend — Part 2b-2-iii-a: List Construction (the HEAP tape) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task 1 is δ-gadget authoring on a live state machine (like Parts 2b-1/2b-2-ii): **the simulation test is the contract; author and iterate the δ-states until it passes.** Hand-trace each gadget cell-by-cell in review. Tasks 2–5 are mostly composition/wiring/decode with complete code.

**Goal:** Lower `Nil`/`Cons`/`IsEmpty` into TM gadgets over a **HEAP tape** of cons cells, and refactor `decode_tape` to follow the heap pointer chain — so the multi-tape Turing machine **constructs lists** and decodes them back to a `Value`. Delivers `[1, 2, 3]`, `is_empty(nil)`, `is_empty(cons(1, nil))` agreeing with the reference tree-walker. (`Head`/`Tail` — runtime pointer dereference — are Part 2b-2-iii-**b**.)

**Architecture:** The HEAP tape holds `@`-delimited cons cells `@ <head> # <tail>` at 1-based unary addresses (pointer `p` = the `p`-th cell; `nil` = pointer `0`). `Cons(rd, rh, rt)` appends a new cell (`head = rh`'s value, `tail = rt`'s value) and writes its pointer (= the cell count) into `rd`. `Nil(rd)` writes `0`. `IsEmpty(rd, rl)` writes `(rl == 0)`. Both reuse merged REG↔WORK primitives; only `Cons` needs new HEAP δ-gadgets. `decode_tape` refactors to parse the HEAP snapshot into `(head, tail)` cells and type-directed-decode the result word — a Nat value *or* a list pointer — mirroring `asm.rs`'s `decode_word` exactly.

**Tech Stack:** Rust; the merged `tm::{asm, lower_asm, machine, sim, build, encoding, lower_tm, decode}` modules; the Part-2a simulator is the test oracle.

## Global Constraints

Copied from the design spec (`docs/superpowers/specs/2026-07-22-tm-backend-design.md` §3.1, §4.1, §8) and the `tm-backend-plan3` memory. Every task's requirements implicitly include this section.

- **List value model (mirror `asm.rs` exactly).** A `List` in a register is a **pointer** (a unary address); `nil` = pointer `0`; `cons` allocates a new heap cell `(head-word, tail-pointer)` and yields its **1-based** pointer (`asm.rs`: `heap.push((h,t)); ptr = heap.len()`). A head-word may itself be a pointer (nested lists) — decode follows it uniformly, guided by the expected shape.
- **HEAP tape format:** `@ <head marks> # <tail marks> @ <head marks> # <tail marks> …`, cells concatenated, each cell `@`-prefixed. Cell `i` (1-based) is the `i`-th `@`-delimited cell = pointer `i`. Empty heap = all blank. **New data symbol `AT = '@'`** (representable: not whitespace, not `* ; [ ]`); the alphabet is now `1`/`_`/`#`/`@`. Every produced `Machine` passes `Machine::validate()`.
- **Home conventions (all tapes restore on every gadget exit).** REG head on the leading `#`; WORK at its leftmost cell; STACK at its top (untouched here); **HEAP head at the "top" = the leftmost blank after all cells (origin when empty)**; every HEAP gadget takes the head at the top and leaves it at the (new) top.
- **`v < FIELD_WIDTH` STRICT (64).** Head-word Nat values and **pointers** live in REG fixed-width fields, so a list is limited to ~63 cells (pointers stay `< FIELD_WIDTH`); the demos are tiny (≤ 3 cells). HEAP head/tail fields are variable-width unary (append-only — no in-place mutation, no shifting).
- **`Rr` is REG slot 0**; a list result leaves its pointer in slot 0, which `decode_tape` follows into the HEAP.
- **Panic-free & total on ANY `Program`** — no panic/unwrap on program-derived data; the `MAX_SLOTS`/`MAX_FRAME_LOC` guards (2b-2-i/ii) stay intact. `Head`/`Tail` remain routed to `halt` (Part 2b-2-iii-b); this slice's tests never feed a `Head`/`Tail`.
- **Encoding-generic.** New gadgets are `Encoding` trait methods (Unary impl), like `push_frame`/`mov`; `lower_tm` calls them through `&dyn Encoding`. The HEAP's *structural* bookkeeping (`@`/`#`/pointers) is unary-always; head-word *values* follow the encoding — a boundary the binary follow-on refines.
- **`decode_tape` uses `expected` only for its shape**, never its contents — a machine that computed the wrong list decodes to a different `Value` (or `None`), still failing the oracle. Same discipline as `decode_asm`.

---

## File Structure

- **Modify** `crates/redextape-core/src/tm/build.rs` — add `pub const AT: Symbol = '@';` (the HEAP cell delimiter), next to `MARK`/`SEP`.
- **Modify** `crates/redextape-core/src/tm.rs` — re-export `AT` from `build`.
- **Modify** `crates/redextape-core/src/tm/encoding.rs` — add HEAP sub-primitives (free fns) + two `Encoding` trait methods (`cons`, `is_empty_op`) with `Unary` impls; add unit tests.
- **Modify** `crates/redextape-core/src/tm/lower_tm.rs` — replace the `Nil`/`Cons`/`IsEmpty` `halt` placeholders with real arms (`Head`/`Tail` stay `halt`); add module tests over hand-built heap `Program`s.
- **Modify** `crates/redextape-core/src/tm/decode.rs` — refactor `decode_tape` to parse the HEAP and follow the pointer chain (Nil/Cons/Nat/Bool unified via a shared `decode_word`); add unit tests.
- **Modify** `crates/redextape-core/tests/tm_oracle.rs` — add the list-construction demo subset (`reference==TM` + `asm-interp==TM`). Prior subsets stay.

---

## Design reference (read before Task 1)

**HEAP top invariant.** HEAP = `@ head # tail @ head # tail …`, head on the **blank immediately after the last cell** (the "top"; origin when empty). Every HEAP gadget takes the head at the top on entry and leaves it at the (possibly new) top on exit. A zero-value field is simply *empty* (adjacent delimiters), e.g. `cons(1, nil)` = `@ 1 #` (head=1, tail=0) then the top blank; `cons(0, nil)` = `@ #` then top.

**Sub-primitives to author (Task 1), each preserving the top invariant. Reuse the merged mark-walk / erase-walk shapes (`write_literal`, `append_field_to_work`, `clear_work`, `stack_push_work`):**
- `heap_open_cell_with_work(from) -> StateId` — WORK holds contiguous marks at home; from the HEAP top, write `AT`, then WORK's marks (walk WORK right, write one HEAP mark each), then `SEP`; land on the new blank top; rewind WORK home (marks intact). Opens a cell with `head = WORK`, `#` ready for the tail.
- `heap_append_work(from) -> StateId` — WORK marks at home; from the HEAP top (right after the cell's `#`), write WORK's marks (the tail field); land on the new blank top; rewind WORK home. Completes the cell.
- `heap_count_cells_to_work(from) -> StateId` — clear WORK; from the HEAP top, walk **left** counting `@`s (write one WORK mark per `AT` seen; skip `MARK`/`SEP`), stop at the origin-left blank; rewind WORK home (WORK = cell count); then walk HEAP **right** back to the top (skip all non-blank, stop at the top blank). On exit WORK = the number of cells, HEAP at the top.

**Reused merged primitives:** `copy_field_to_work(slot)`, `append_work_to_field(rd)`, and the private `is_zero_work` (for `is_empty_op`). Import what you need.

---

## Task 1: HEAP sub-primitives — `heap_open_cell_with_work`, `heap_append_work`, `heap_count_cells_to_work`

The HEAP-build primitives + the `AT` symbol, tested in isolation. This is the δ-authoring task; get the top invariant and the count airtight.

**Files:**
- Modify: `crates/redextape-core/src/tm/build.rs` (add `AT`)
- Modify: `crates/redextape-core/src/tm.rs` (re-export `AT`)
- Modify: `crates/redextape-core/src/tm/encoding.rs` (3 free fns + tests)

**Interfaces produced (free fns in `encoding.rs`, `pub`):** the three above.

- [ ] **Step 1: Write the failing tests (the contract)**

Add to `encoding.rs`'s `#[cfg(test)] mod tests` (a HEAP harness + a cell/count reader). `AT` must be added to `build.rs` first (Step 3) for these to compile; write them now, they fail to compile → then fail assertions.

```rust
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

/// Parse `@ head # tail` cells from a HEAP snapshot into 1-based `(head, tail)` mark counts.
fn heap_cells(cells: &[Symbol]) -> Vec<(u64, u64)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < cells.len() {
        if cells[i] == AT {
            let mut j = i + 1;
            let h = { let s = j; while j < cells.len() && cells[j] == MARK { j += 1; } (j - s) as u64 };
            if j < cells.len() && cells[j] == SEP { j += 1; }
            let t = { let s = j; while j < cells.len() && cells[j] == MARK { j += 1; } (j - s) as u64 };
            out.push((h, t));
            i = j;
        } else {
            i += 1;
        }
    }
    out
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
    let a0 = heap_append_work(&mut b, c1, "aw0");        // (empty tail)
    // Build cell2 head=2, tail=1.
    let s2 = b.state("s2");
    enc.write_literal(&mut b, a0, s2, 2, 2);
    let s3 = b.state("s3");
    enc.write_literal(&mut b, s2, s3, 1, 3);
    let c2 = copy_field_to_work(&mut b, s3, 2, "cf2");
    let o1 = heap_open_cell_with_work(&mut b, c2, "oc1"); // @ 2 #
    let c3 = copy_field_to_work(&mut b, o1, 3, "cf3");
    let a1 = heap_append_work(&mut b, c3, "aw1");         // 1
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
    assert_eq!(heap_cells(&tapes[HEAP].snapshot().0), vec![(3, 0), (2, 1)], "two cells built in order");
    assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 4), Some(2), "cell count == 2");
}
```

> If this single test is doing too much, split it: one test that builds ONE cell `(3,0)` and asserts `heap_cells == [(3,0)]` and count `1`, and one that builds two and asserts order + count `2`. Keep the assertions concrete.

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::encoding::tests::heap_build_two_cells_and_count`
Expected: FAIL — `AT`, `heap_open_cell_with_work`, `heap_append_work`, `heap_count_cells_to_work` undefined.

- [ ] **Step 3: Add `AT` and author the three δ-gadgets (iterate against the test)**

- In `build.rs`: `pub const AT: Symbol = '@';` (doc: the HEAP cons-cell delimiter). Re-export in `tm.rs` (`pub use build::{… AT …};`).
- Author the three free fns per the Design reference. Load-bearing details:
  - **Top invariant:** entry head on the blank top; exit head on the (new) blank top. `heap_open_cell_with_work`/`heap_append_work` write rightward and end on the fresh blank.
  - **`heap_count_cells_to_work` two-pass:** walk left counting `@`s (write one WORK mark per `AT`; `MARK`/`SEP` → keep left; `BLANK` → origin reached, stop) → rewind WORK home → walk right over all non-blank to the top blank. The origin-left blank and the top blank are the two landmarks. No interior blanks occur (a zero field is just adjacent delimiters), so "walk right until BLANK" reliably finds the top.
  - Branch by disjoint reads; unique `{label}.…` state names (assert `validate()` in the test).

Iterate until Step 1 passes; hand-trace the two-cell build + count cell-by-cell.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core --lib tm::encoding::tests`
Expected: PASS.

- [ ] **Step 5: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/build.rs crates/redextape-core/src/tm.rs crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): HEAP tape sub-primitives (open_cell/append_work/count_cells) + AT symbol"
```

---

## Task 2: `Encoding::cons`

Compose the HEAP primitives: open a cell with `rh`'s value, append `rt`'s value, count the cells → the new pointer into `rd`.

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (trait method + Unary impl + test)

**Interface produced (added to `pub trait Encoding`):**
- `fn cons(&self, b: &mut Builder, entry: StateId, exit: StateId, rh: Slot, rt: Slot, rd: Slot)` — append a cons cell `(head = field rh's value, tail = field rt's value)` at the HEAP top, and write the new cell's 1-based pointer (= the cell count) into field `rd`. Flows `entry → exit`, all heads home/top. **PRECONDITION:** `rd` distinct from `rh` and `rt` (`rd` is written last from the count while `rh`/`rt` were already read — but keep them distinct; `lower_asm` emits fresh operands).

- [ ] **Step 1: Write the failing test**

```rust
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
        (heap_cells(&tapes[HEAP].snapshot().0), enc.decode_nat(&tapes[REG].snapshot().0, 2))
    }
    // cons(7, nil=0): one cell (7,0), pointer 1.
    assert_eq!(run_cons(7, 0), (vec![(7, 0)], Some(1)));
    // cons(1, ptr=1): one cell (1,1), pointer 1 (heap starts empty each run).
    assert_eq!(run_cons(1, 1), (vec![(1, 1)], Some(1)));
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
    enc.cons(&mut b, cn0, after0, 0, 1, 2);      // slot2 = ptr to (3,0) = 1
    let s3 = b.state("s3");
    enc.write_literal(&mut b, after0, s3, 2, 3);
    enc.cons(&mut b, s3, halt, 3, 2, 4);          // slot4 = ptr to (2, slot2) = 2
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(5);
    let m = b.finish(s0);
    assert!(m.validate().is_empty(), "{:?}", m.validate());
    let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
    assert_eq!(status, Status::Halted);
    assert_eq!(heap_cells(&tapes[HEAP].snapshot().0), vec![(3, 0), (2, 1)]);
    assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 2), Some(1));
    assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 4), Some(2));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::encoding::tests::cons_builds_a_cell_and_writes_the_pointer`
Expected: FAIL — `cons` not on the trait.

- [ ] **Step 3: Add the trait method + Unary impl**

Signature on `pub trait Encoding` (doc per the contract). Unary impl (compose Task-1 primitives; count AFTER appending so the pointer includes the new cell):
```rust
    fn cons(&self, b: &mut Builder, entry: StateId, exit: StateId, rh: Slot, rt: Slot, rd: Slot) {
        let base = format!("cons{entry}");
        let cw_h = copy_field_to_work(b, entry, rh, &format!("{base}.h"));   // WORK <- rh (head)
        let open = heap_open_cell_with_work(b, cw_h, &format!("{base}.oc")); // @ head #
        let cw_t = copy_field_to_work(b, open, rt, &format!("{base}.t"));    // WORK <- rt (tail ptr)
        let tail = heap_append_work(b, cw_t, &format!("{base}.aw"));         // ... tail
        let count = heap_count_cells_to_work(b, tail, &format!("{base}.cc"));// WORK <- cell count = ptr
        let wr = append_work_to_field(b, count, rd, &format!("{base}.wr"));  // rd <- ptr
        b.add_rule(wr, RuleSpec::new(), exit);
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core --lib tm::encoding::tests`
Expected: PASS.

- [ ] **Step 5: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): Encoding::cons (append a heap cell + write its pointer)"
```

---

## Task 3: `Encoding::is_empty_op` + wire `Nil`/`Cons`/`IsEmpty` into `lower_tm`

`IsEmpty` composes merged primitives; then replace the `Nil`/`Cons`/`IsEmpty` `halt` placeholders in `lower_tm` (keep `Head`/`Tail` at `halt` — Part 2b-2-iii-b).

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (`is_empty_op` trait method + Unary impl + test)
- Modify: `crates/redextape-core/src/tm/lower_tm.rs` (three arms + tests)

**Interfaces:**
- `fn is_empty_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot)` — `rd <- (field rl == 0) as 0/1`. Unary impl: `copy_field_to_work(rl)` → `is_zero_work` → `append_work_to_field(rd)`.
- `lower_tm` arms: `Nil(rd)` → `enc.write_literal(pc[i], fall, 0, slot(rd))`; `Cons(rd, rh, rt)` → `enc.cons(pc[i], fall, slot(rh), slot(rt), slot(rd))`; `IsEmpty(rd, rl)` → `enc.is_empty_op(pc[i], fall, slot(rl), slot(rd))`. `Head`/`Tail` stay `→ halt`.

- [ ] **Step 1: Write the failing tests**

`is_empty_op` unit test (encoding.rs):
```rust
#[test]
fn is_empty_op_maps_zero_to_true() {
    // slot0 = v; is_empty_op(rd=1, rl=0); decode slot1.
    fn run_ie(v: u64) -> Option<u64> {
        let enc = Unary;
        let mut b = Builder::new();
        let halt = b.accept("halt");
        let s = b.state("s");
        enc.write_literal(&mut b, s, /*to*/ b_placeholder(), v, 0); // see note
        // (write the literal into a state that flows into is_empty_op; structure like the other tests)
        unimplemented!()
    }
    // Replace the sketch above with the concrete `run_gadget`/manual harness pattern used by the other
    // encoding tests: init slot0 <- v, is_empty_op(1, 0), decode slot1. Expect v==0 -> 1, v>0 -> 0.
    assert_eq!(run_ie(0), Some(1));
    assert_eq!(run_ie(3), Some(0));
}
```
> Write `run_ie` concretely using the same manual-builder pattern as `cons_builds_a_cell_and_writes_the_pointer` (allocate `s0`, `write_literal(v, 0)` flowing into an `is_empty_op(.., 0, 1)` entry, then `halt`; `init_reg(2)`; decode slot 1). Do NOT leave `unimplemented!()`/`b_placeholder()` — those are sketch markers.

`lower_tm` heap-construction tests (lower_tm.rs, hand-built asm mirroring `asm.rs`):
```rust
#[test]
fn is_empty_of_nil_and_of_cons() {
    // is_empty(nil) == 1 ; and is_empty(cons(1,nil)) == 0.
    let nil_prog = Program {
        code: vec![Instr::Nil(Reg::Loc(0)), Instr::IsEmpty(Reg::Rr, Reg::Loc(0)), Instr::Halt],
        labels: vec![],
    };
    assert_eq!(run_nat(&nil_prog), Some(1));

    let cons_prog = Program {
        code: vec![
            Instr::Nil(Reg::Loc(0)),
            Instr::Li(Reg::Loc(1), 1),
            Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)), // cons(1, nil)
            Instr::IsEmpty(Reg::Rr, Reg::Loc(2)),
            Instr::Halt,
        ],
        labels: vec![],
    };
    assert_eq!(run_nat(&cons_prog), Some(0));
}
```
> `run_nat` (from 2b-2-i's lower_tm tests) decodes REG slot 0 as a Nat — a Bool 0/1 decodes as Nat 1/0 here, which is exactly what these assert.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::encoding::tests::is_empty_op_maps_zero_to_true tm::lower_tm::tests::is_empty_of_nil_and_of_cons`
Expected: FAIL — `is_empty_op` undefined; `Cons`/`Nil`/`IsEmpty` route to `halt` so `run_nat` returns the wrong value.

- [ ] **Step 3: Implement**

`is_empty_op` Unary impl:
```rust
    fn is_empty_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rl: Slot, rd: Slot) {
        let base = format!("ie{entry}");
        let cw = copy_field_to_work(b, entry, rl, &format!("{base}.c")); // WORK <- rl
        let z = is_zero_work(b, cw, &format!("{base}.z"));               // WORK <- (rl == 0)
        let wr = append_work_to_field(b, z, rd, &format!("{base}.wr"));  // rd <- bool
        b.add_rule(wr, RuleSpec::new(), exit);
    }
```
`lower_tm` arms: replace the placeholder `Instr::Nil(_) | Instr::Cons(..) | Instr::IsEmpty(..)` branch (currently → `halt`) with the three real arms above; keep `Instr::Head(..) | Instr::Tail(..) => b.add_rule(pc[i], RuleSpec::new(), halt)` (Part 2b-2-iii-b).

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core --lib tm::encoding tm::lower_tm`
Expected: PASS (new + all prior tests).

- [ ] **Step 5: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/encoding.rs crates/redextape-core/src/tm/lower_tm.rs
git commit -m "feat(tm): Encoding::is_empty_op + lower nil/cons/is_empty"
```

---

## Task 4: `decode_tape` — follow the HEAP pointer chain (Nil/Cons)

Refactor `decode_tape` to parse the HEAP snapshot into `(head, tail)` cells and type-directed-decode the result word (a Nat value *or* a list pointer), mirroring `asm.rs`'s `decode_word`.

**Files:**
- Modify: `crates/redextape-core/src/tm/decode.rs`

- [ ] **Step 1: Write the failing tests**

Add heap-decoding tests to `decode.rs`'s test module (build a list via `lower_tm` and decode it end-to-end):
```rust
#[test]
fn decodes_a_constructed_list() {
    use crate::tm::asm::{Instr, Program, Reg};
    // Build [1, 2] on the TM: nil; cons(2, nil)->p1; cons(1, p1)->rr. Decode guided by a list shape.
    let prog = Program {
        code: vec![
            Instr::Nil(Reg::Loc(0)),
            Instr::Li(Reg::Loc(1), 2),
            Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)), // cons(2, nil)
            Instr::Li(Reg::Loc(3), 1),
            Instr::Cons(Reg::Rr, Reg::Loc(3), Reg::Loc(2)),     // cons(1, p1) -> rr
            Instr::Halt,
        ],
        labels: vec![],
    };
    let tapes = run_to_tapes(&prog);
    assert_eq!(decode_tape(&tapes, &Value::list_of_nats(&[1, 2]), &Unary), Some(Value::list_of_nats(&[1, 2])));
}

#[test]
fn decodes_nil_result() {
    use crate::tm::asm::{Instr, Program, Reg};
    let prog = Program { code: vec![Instr::Nil(Reg::Rr), Instr::Halt], labels: vec![] };
    let tapes = run_to_tapes(&prog);
    assert_eq!(decode_tape(&tapes, &Value::Nil, &Unary), Some(Value::Nil));
    // A Cons witness over a nil result decodes to None (pointer 0 is not a cons).
    assert_eq!(decode_tape(&tapes, &Value::list_of_nats(&[1]), &Unary), None);
}
```
Keep the existing Nat/Bool/Unit decode tests. Update `non_first_class_and_heap_shapes_decode_to_none`: `Value::Nil` over a program that halts with slot 0 == 0 now decodes to `Some(Nil)` (not `None`) — move that assertion into `decodes_nil_result` and leave only `Value::Unit → None` in the non-first-class test.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::decode`
Expected: FAIL — `decode_tape` still returns `None` for Nil/Cons.

- [ ] **Step 3: Refactor `decode_tape`**

Replace the body with a heap-parsing + shared-`decode_word` version (mirrors `asm.rs::decode_word`):
```rust
use std::rc::Rc;
use crate::tm::build::{AT, HEAP, MARK, REG, SEP};
use crate::tm::encoding::Encoding;
use crate::tm::machine::Symbol;
use crate::tm::sim::Tape;
use crate::value::Value;

/// Decode the machine's final `tapes` to a `Value`, guided by `expected`'s SHAPE (never its contents).
/// The result word is REG slot 0 (`Rr`): a Nat/Bool value, or a list pointer into the HEAP.
pub fn decode_tape(tapes: &[Tape], expected: &Value, enc: &dyn Encoding) -> Option<Value> {
    let reg = tapes.get(REG)?.snapshot().0;
    let heap = parse_heap(&tapes.get(HEAP)?.snapshot().0);
    let word = enc.decode_nat(&reg, 0)?;
    decode_word(word, &heap, expected)
}

/// Parse the HEAP tape into 1-based cons cells `(head, tail)` mark-counts. Marker-delimited (scan `@`),
/// so it is robust to blanks left of the origin (`Tape::snapshot`'s cell 0 is not necessarily the origin).
fn parse_heap(cells: &[Symbol]) -> Vec<(u64, u64)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < cells.len() {
        if cells[i] == AT {
            let mut j = i + 1;
            let h = { let s = j; while j < cells.len() && cells[j] == MARK { j += 1; } (j - s) as u64 };
            if j < cells.len() && cells[j] == SEP { j += 1; }
            let t = { let s = j; while j < cells.len() && cells[j] == MARK { j += 1; } (j - s) as u64 };
            out.push((h, t));
            i = j;
        } else {
            i += 1;
        }
    }
    out
}

/// Type-directed decode of a word (Nat/Bool value or list pointer), guided by `expected`'s shape.
/// Mirrors `asm.rs::decode_word`. Terminates because compiled heaps are acyclic (a cons cell's tail
/// points only at an EARLIER cell), exactly as `decode_asm` assumes.
fn decode_word(word: u64, heap: &[(u64, u64)], expected: &Value) -> Option<Value> {
    match expected {
        Value::Nat(_) => Some(Value::Nat(word)),
        Value::Bool(_) => match word {
            0 => Some(Value::Bool(false)),
            1 => Some(Value::Bool(true)),
            _ => None,
        },
        Value::Nil => (word == 0).then_some(Value::Nil),
        Value::Cons(eh, et) => {
            if word == 0 {
                return None;
            }
            let &(h, t) = heap.get((word - 1) as usize)?;
            let head = decode_word(h, heap, eh)?;
            let tail = decode_word(t, heap, et)?;
            Some(Value::Cons(Rc::new(head), Rc::new(tail)))
        }
        Value::Unit | Value::Closure { .. } | Value::Builtin(_) => None,
    }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core --lib tm::decode`
Expected: PASS.

- [ ] **Step 5: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/decode.rs
git commit -m "feat(tm): decode_tape follows the HEAP pointer chain (Nil/Cons)"
```

---

## Task 5: Oracle extension — list construction

Extend `tests/tm_oracle.rs` with the list-construction demo subset: `reference == TM` and `asm-interp == TM`.

**Files:**
- Modify: `crates/redextape-core/tests/tm_oracle.rs`

- [ ] **Step 1: Add the demos + tests**

```rust
/// The list-CONSTRUCTION demo subset: nil, cons, is_empty, and a list literal (desugars to a cons
/// spine). NO head/tail (those dereference a pointer — Part 2b-2-iii-b). Values/lengths « FIELD_WIDTH.
const LIST_BUILD_DEMOS: &[&str] = &[
    "is_empty(nil)",
    "is_empty(cons(1, nil))",
    "[1, 2, 3]",
    "cons(1, cons(2, nil))",
];

#[test]
fn tm_agrees_with_reference_on_list_build_demos() {
    for src in LIST_BUILD_DEMOS {
        assert_tm_agrees(src);
    }
}

#[test]
fn asm_interp_matches_tm_on_list_build_demos() {
    for src in LIST_BUILD_DEMOS {
        assert_asm_interp_matches_tm(src);
    }
}
```

> If a list demo hits a cap under `TM_DEFAULT_CAPS`, first confirm via `asm_interp_matches_tm` it is a genuine cap (not a wrong answer), then raise the caps for the TM oracle with an explanatory comment — do NOT drop a demo or weaken an assertion. (Construction is far lighter than the recursion in 2b-2-ii, so a raise is unlikely.)

- [ ] **Step 2: Run**

Run: `cargo test -p redextape-core --test tm_oracle`
Expected: PASS. If `tm_agrees_*` fails on a `src`, localize with `asm_interp_matches_tm_on_list_build_demos` (asm==TM failing too → a cons/lowering bug; asm==TM passing but reference==TM failing → a decode bug).

- [ ] **Step 3: fmt/clippy + full suite**

Run: `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings && cargo test -p redextape-core`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/tests/tm_oracle.rs
git commit -m "test(tm): reference==TM + asm-interp==TM oracle on the list-construction demos"
```

---

## Deferred to later sub-parts (do NOT attempt here)

- **Part 2b-2-iii-b — list access (`Head`/`Tail`):** runtime pointer dereference — read a register's pointer `P`, **runtime-seek to the `P`-th HEAP cell** (decrement a WORK counter while advancing cell-by-cell), read its head/tail field into `rd`. Plus `head(nil)`/`tail(nil)` fault handling (defensive halt). Unblocks `head(cons(7, nil))`, `head(tail(...))`, nested access.
- **Part 2b-2-iv — the finale:** the full three-way oracle (`reference == λ == TM`) over the whole first-order demo suite (incl. `map`/`fold` are still excluded — higher-order, Plan 3b); the TM-bounded proptest (bound `Nat` magnitudes `< FIELD_WIDTH`, register indices `< MAX_SLOTS`, AND list lengths `< FIELD_WIDTH`); golden `print_asm` + TM step counts; TM-text round-trip over compiled machines; and folding the deferred Minors (2b-1 sub-primitive visibility; the `x*0`/trichotomy sweeps; broaden `asm_oracle` + drop its dead `RunError::Static` arm; `cmp_mnemonic`→`bin_mnemonic`; dedup `SlotMap::of`; a `decode_word` cycle guard consistent with `decode_asm`; consider splitting STACK/HEAP gadgets into `tm/stack.rs`/`tm/heap.rs` if `encoding.rs` is unwieldy).

## Self-Review (completed while writing)

- **Spec coverage (this slice):** `Nil`/`Cons`/`IsEmpty` → HEAP gadgets (spec §3.1 pointer/heap model, §4.1 HEAP tape) ✓; 1-based pointers + `nil = 0` mirroring `asm.rs` ✓; `decode_tape` type-directed pointer-follow (§8), shape-only ✓; `reference == TM` + `asm-interp == TM` on the construction demos (§12.1, §12.2) ✓. `Head`/`Tail` (runtime deref), the full three-way oracle, proptest, goldens, text round-trip deferred to iii-b/iv.
- **Placeholder scan:** the mechanical code (cons/is_empty compositions, lower_tm arms, decode_tape, oracle) is complete; the one genuinely-iterative task (Task 1 HEAP primitives) carries a full design + a complete simulation-test contract, in the 2b-1/2b-2-ii style. The `is_empty_op` test sketch explicitly flags its `unimplemented!()`/`b_placeholder()` markers to be replaced with the concrete manual-builder pattern used by the sibling tests.
- **Type/interface consistency:** the new `Encoding` methods (`cons(…, rh, rt, rd)`, `is_empty_op(…, rl, rd)`) and sub-primitives (`heap_open_cell_with_work`/`heap_append_work`/`heap_count_cells_to_work`) are used identically across Tasks 1–3; `AT` is added in Task 1 and consumed by Task 4's `parse_heap`; the HEAP cell format (`@ head # tail`, 1-based, `nil = 0`) is consistent between the build gadgets (Task 1/2) and `decode_tape` (Task 4); `decode_word` mirrors `asm.rs`'s exactly so the two backends decode identically.
