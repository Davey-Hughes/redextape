# TM Backend — Part 2b-2-ii: Calls & Recursion (the STACK tape) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 1–5 are δ-gadget authoring on a live state machine (like Part 2b-1): **the simulation test is the contract; author and iterate the δ-states until it passes** — expect iterations, not transcription. Hand-trace each gadget cell-by-cell in review.

**Goal:** Lower asm `Call`/`Ret` into genuine TM state-graph gadgets over a **STACK tape**, so the multi-tape Turing machine executes **function calls and recursion** — `sum(5)`, `count_down(4)` (as a call), `add1(41)`, a `fn` inside a mutation region — agreeing with the reference tree-walker.

**Architecture:** `Call` **saves the entire `Loc` register bank** onto the STACK (one `#`-delimited unary field per local, reusing `WORK` as the copy intermediary and unrolling over the compile-time local count `n_loc`), plus a **unary return-tag** = the call-site ordinal. `Ret` restores the `Loc` bank (popping the frame top→down) and then **walks the return-tag through a finite dispatch chain** to resume at the instruction after the originating `Call`. `Rr` persists across the call (carries the result); `Arg` is volatile (not saved) — exactly mirroring `asm.rs`'s reference interpreter, which the `sum` demo depends on (its `rec` branch reads a local *after* the recursive callee clobbered it). A frame is exactly `n_loc + 1` `#`-delimited fields, so the STACK needs **no new symbol** (`1`/`_`/`#` only) and empty-vs-frame is a blank-vs-`#` check.

**Tech Stack:** Rust; the merged `tm::{asm, lower_asm, machine, sim, build, encoding, lower_tm, decode}` modules; the Part-2a simulator is the test oracle.

## Global Constraints

Copied verbatim from the design spec (`docs/superpowers/specs/2026-07-22-tm-backend-design.md` §3.4, §4.1, §6) and the `tm-backend-plan3` project memory. Every task's requirements implicitly include this section.

- **The calling convention (mirror `asm.rs`'s reference interpreter exactly):** `Call L` saves the caller's **entire `Loc` bank** (slots `1..=n_loc`) + a return marker, then jumps to `L`'s entry. `Ret` restores the caller's `Loc` bank and resumes at the instruction **after** the originating `Call`. **`Rr` (slot 0) persists** across the call — it is neither saved nor restored, so it carries the callee's result back. **`Arg` fields are volatile** — not saved (the callee copies them into its own `Loc`s at entry before any nested call). A `Ret` with an **empty stack halts** (defensive; unreachable from real `lower_asm` output, where every `Ret` is inside a called function).
- **Return-tag dispatch stays finite-state (§3.4).** Each `Call` instruction is a *call site* with a unique compile-time **ordinal** `c ∈ 0..K`. `Call` pushes `c` as a unary tag; `Ret` reads it and the finite control dispatches to `pc[site_c + 1]`. Call sites are a finite compile-time set — no computed jumps.
- **STACK frame layout (fixed, compile-time framed):** a frame is `[tag] # [Loc0] # [Loc1] # … # [Loc_{n_loc-1}] #`, pushed with the **tag at the bottom** (pushed first) and `Loc0..Loc_{n_loc-1}` above it. Frames concatenate with no delimiter — a frame is exactly `n_loc + 1` `#`-delimited unary fields (`n_loc` known at compile time), so pop is an unrolled fixed count. **STACK data symbols: `1` (MARK) / `_` (BLANK) / `#` (SEP) only** — no new symbol (the reserved `@` is NOT needed). Every produced `Machine` must pass `Machine::validate()`.
- **Home conventions (all four tapes restore on every gadget exit).** REG head on the leading `#`; WORK head at its leftmost cell (blank when empty). **STACK head at the "top"** = the leftmost blank after all frames (cell 0 when empty); every STACK gadget leaves the head there. HEAP is untouched this slice (defaults to wildcard/unchanged/Stay).
- **`v < FIELD_WIDTH` STRICT (64).** REG `Loc` fields are fixed-width; restore blanks the field window then writes the marks. STACK fields are variable-width unary (append-only at the top — no fixed width, no shifting). All this slice's values stay well under 64.
- **`Rr` is REG slot 0**; the `SlotMap` layout is slot 0 = `Rr`, then `Loc(k) → 1+k`, then `Arg(k) → 1 + n_loc + k`; `n_loc` = the `Loc` count from `SlotMap`. Frame save/restore touches exactly slots `1..=n_loc`.
- **Panic-free & total on ANY `Program`** — no panic/unwrap on program-derived data; the `MAX_SLOTS` guard (from 2b-2-i) still bounds the bank. A `Ret` with no frame halts.
- **Encoding-generic.** The new gadgets are added to the `Encoding` trait (Unary impl), like `mov`/`jz`; `lower_tm` calls them through `&dyn Encoding` and never names `Unary` in non-test code. The STACK's *structural* bookkeeping (`#`/blank/tag) is unary-always; only the saved **field values** follow the encoding — a boundary the binary follow-on refines later.

---

## File Structure

- **Modify** `crates/redextape-core/src/tm/encoding.rs` — add STACK sub-primitives (free fns, alongside the existing REG↔WORK ones; they may use the private `rewind_work` and the erase-back-walk pattern directly) and four `Encoding` trait methods (`push_frame`, `pop_frame_restore`, `stack_is_empty`, `dispatch_tag`) with `Unary` impls; add unit tests. (If `encoding.rs` grows unwieldy, splitting the STACK sub-primitives into a new `tm/stack.rs` is acceptable — but default to `encoding.rs` for authoring cohesion; do not split mid-task.)
- **Modify** `crates/redextape-core/src/tm/lower_tm.rs` — replace the `Call`/`Ret` placeholder arms with real gadget wiring: call-site numbering, per-`Call` `push_frame` + jump, a shared `Ret` handler (`stack_is_empty` → halt / `pop_frame_restore` → `dispatch_tag`), and the per-site continuation-state (`exits`) vector; add module tests over hand-built recursive `Program`s.
- **Modify** `crates/redextape-core/tests/tm_oracle.rs` — extend with the call/recursion demo subset (`reference == TM` + `asm-interp == TM`). The control-flow subset from 2b-2-i stays.

---

## Design reference (read before Task 1)

**The STACK top invariant.** STACK = `[field]#[field]#…#[field]#` with the head on the **blank immediately after the last `#`** (the "top"). Empty stack = head at cell 0, all blank. Every STACK gadget takes the head at the top and leaves it at the (possibly new) top.

**Sub-primitives to author (Task 1), each preserving the top/home invariants:**
- `stack_push_work` — WORK holds contiguous marks at home; append them as a new field at the STACK top: walk WORK right over its marks writing one STACK mark each (both heads advance R), then write a `#` on STACK and land on the new blank top; rewind WORK home (marks left intact). Mirrors `append_field_to_work`'s mark-walk but the destination grows the tape (no fixed window to blank).
- `stack_push_literal(c)` — write `c` marks then a `#` at the STACK top, landing on the new blank top (unrolled `c`, like `write_literal`'s mark loop but append-only). `c = 0` writes just a `#` (an empty field).
- `stack_pop_work` — clear WORK; at the top, step left onto the last `#`, erase it, step left onto the field's marks; walk left erasing each STACK mark while writing a WORK mark (STACK head moves L, WORK head moves R — opposite directions, one rule); stop at the field's left boundary (a `#` of the field below, or the origin blank); step right to the new blank top; rewind WORK home. WORK now holds the popped field's value.
- `stack_is_empty(entry, if_empty, if_nonempty)` — at the top, step left: `#` → non-empty (step back right to the top, go to `if_nonempty`); blank/origin → empty (step back right, go to `if_empty`). No tape mutation.

**Reused merged primitives:** `copy_field_to_work(slot)` (REG field → WORK, clears WORK), `append_work_to_field(rd)` (WORK → REG fixed field), `clear_work`, and the private `rewind_work`. Import what you need.

---

## Task 1: STACK sub-primitives — `stack_push_work`, `stack_push_literal`, `stack_pop_work`, `stack_is_empty`

The WORK↔STACK-top primitives + the empty-check, tested in isolation. This is the foundational δ-authoring task; get the top invariant airtight here.

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (free fns + tests)

**Interfaces produced (free fns in `encoding.rs`, `pub(crate)` or `pub` as needed by later tasks):**
- `stack_push_work(b: &mut Builder, from: StateId, label: &str) -> StateId`
- `stack_push_literal(b: &mut Builder, from: StateId, c: u64, label: &str) -> StateId`
- `stack_pop_work(b: &mut Builder, from: StateId, label: &str) -> StateId`
- `stack_is_empty(b: &mut Builder, from: StateId, if_empty: StateId, if_nonempty: StateId)`

Each (except `stack_is_empty`) returns the state at the new STACK top with WORK home; all take the STACK head at the top on entry.

- [ ] **Step 1: Write the failing tests (the contract)**

Add a STACK test harness + tests to `encoding.rs`'s `#[cfg(test)] mod tests`. Decode a STACK field by reusing `decode_nat` over the STACK snapshot (STACK fields are `#`-framed exactly like REG fields once you prepend a leading `#`… but STACK has no leading `#` — so add a tiny local `decode_stack_field(cells, idx)` helper in the test that splits on `#` and counts marks). Contract:

```rust
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
    let pop1 = stack_pop_work(&mut b, c, "pop1");           // WORK <- 2
    let w1 = append_work_to_field(&mut b, pop1, 0, "w1");   // REG slot0 <- 2
    let pop2 = stack_pop_work(&mut b, w1, "pop2");          // WORK <- 4
    let w2 = append_work_to_field(&mut b, pop2, 1, "w2");   // REG slot1 <- 4
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
    assert!(tapes[STACK].snapshot().0.iter().all(|&c| c == BLANK || c == MARK && false), "STACK must be empty after popping all frames");
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
```

> Fix the `stack_push_then_pop_is_lifo` "STACK empty" assertion to a clean form while implementing — e.g. `assert!(!tapes[STACK].snapshot().0.contains(&MARK), "STACK must hold no marks after popping all frames")`. The intent (no leftover marks) is the contract; write it cleanly.

- [ ] **Step 2: Run to verify the tests fail**

Run: `cargo test -p redextape-core --lib tm::encoding::tests`
Expected: FAIL — the four `stack_*` functions are undefined.

- [ ] **Step 3: Author the δ-states (iterate against the tests)**

Follow the Design reference's sub-primitive descriptions. Author each as a small state chain, reusing the file's existing patterns (`write_literal`'s mark loop for `stack_push_literal`; `append_field_to_work`'s mark-walk for `stack_push_work`; `clear_work`/`dec_work`'s erase-back-walk for `stack_pop_work`; `jz`'s two-exit shape for `stack_is_empty`). Load-bearing details:
- **Top invariant:** entry head on the blank top; exit head on the (new) blank top. `stack_push_*` write marks/`#` rightward and end on the fresh blank. `stack_pop_work` erases leftward then steps right to the new top.
- **`stack_pop_work` boundary:** stop erasing marks when the STACK head reads the field's left boundary — a `#` (a field below) OR a blank (origin, bottom frame). Both stop the walk; then step right to the new top.
- **`stack_is_empty`:** step left from the top; `#` ⇒ non-empty, blank ⇒ empty; either way step back right to restore the top before taking the branch.
- WORK is home+intact after `stack_push_work`, home+holding-the-value after `stack_pop_work`. Use unique state-name labels (`{label}.…`) so names never collide across call sites (`validate()` requires uniqueness).

Iterate until Step 1's tests pass. Hand-trace `stack_push_then_pop_is_lifo` cell-by-cell before declaring done.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core --lib tm::encoding::tests`
Expected: PASS (all encoding tests, old + new).

- [ ] **Step 5: fmt/clippy/commit**

Run: `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings`

```bash
git add crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): STACK tape sub-primitives (push_work/push_literal/pop_work/is_empty)"
```

---

## Task 2: `Encoding::push_frame` — save the Loc bank + return-tag

The `Call`-side gadget: push the return-tag (bottom), then save each `Loc` field, unrolled over `n_loc`.

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (trait method + Unary impl + test)

**Interface produced (added to `pub trait Encoding`):**
- `fn push_frame(&self, b: &mut Builder, entry: StateId, exit: StateId, n_loc: u32, tag: u64)` — from `entry` (REG home, WORK home, STACK at top), push a new frame: `stack_push_literal(tag)` then, for `j` in `1..=n_loc`, `copy_field_to_work(slot j)` + `stack_push_work`. Flows `entry → exit` with all heads home/top. `n_loc = 0` pushes only the tag.

- [ ] **Step 1: Write the failing test**

```rust
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::encoding::tests::push_frame_saves_tag_then_locals_in_order`
Expected: FAIL — `push_frame` not on the trait.

- [ ] **Step 3: Add the trait method + Unary impl (unrolled)**

Signature on `pub trait Encoding` (doc it per the interface contract). Unary impl:
```rust
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core --lib tm::encoding::tests`
Expected: PASS.

- [ ] **Step 5: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): Encoding::push_frame (save Loc bank + return-tag onto STACK)"
```

---

## Task 3: `Encoding::pop_frame_restore` — restore the Loc bank

The first half of the `Ret`-side gadget: pop the `Loc` fields (top→down, reverse of the save) back into REG, leaving the STACK head on the tag field (Task 4 dispatches it).

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (trait method + Unary impl + test)

**Interface produced (added to `pub trait Encoding`):**
- `fn pop_frame_restore(&self, b: &mut Builder, entry: StateId, exit: StateId, n_loc: u32)` — from `entry` (a non-empty STACK at the top, REG/WORK home), pop the top `n_loc` fields (they are `Loc_{n_loc-1}` … `Loc0`, since the save pushed `Loc0..Loc_{n_loc-1}` above the tag) and write each back into its REG `Loc` slot; on exit the STACK head is at the top with the **tag now the top field**, REG/WORK home. `n_loc = 0` is a no-op leaving the tag on top.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn pop_frame_restore_recovers_clobbered_locals() {
    // Save [Loc0=4, Loc1=2] under tag=0; CLOBBER the REG Loc fields; restore; they come back.
    let enc = Unary;
    let mut b = Builder::new();
    let halt = b.accept("halt");
    let s1 = b.state("s1");
    let s2 = b.state("s2");
    enc.write_literal(&mut b, s1, s2, 4, 1);       // Loc0 = 4
    let pf = b.state("pf");
    enc.write_literal(&mut b, s2, pf, 2, 2);       // Loc1 = 2
    let c1 = b.state("c1");
    enc.push_frame(&mut b, pf, c1, 2, 0);          // frame: [tag=0][4][2]
    let c2 = b.state("c2");
    enc.write_literal(&mut b, c1, c2, 9, 1);       // clobber Loc0 <- 9
    let rf = b.state("rf");
    enc.write_literal(&mut b, c2, rf, 9, 2);       // clobber Loc1 <- 9
    enc.pop_frame_restore(&mut b, rf, halt, 2);    // restore Loc0=4, Loc1=2
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::encoding::tests::pop_frame_restore_recovers_clobbered_locals`
Expected: FAIL — `pop_frame_restore` not on the trait.

- [ ] **Step 3: Add the trait method + Unary impl (unrolled, reverse)**

Unary impl:
```rust
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core --lib tm::encoding::tests`
Expected: PASS.

- [ ] **Step 5: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): Encoding::pop_frame_restore (restore Loc bank from STACK)"
```

---

## Task 4: `Encoding::dispatch_tag` — finite-state return dispatch

The second half of `Ret`: with the tag as the top STACK field, walk its marks and route to `exits[c]`, erasing the tag field so the STACK head lands on the new top (the caller's frame, or empty).

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (trait method + Unary impl + test)

**Interface produced (added to `pub trait Encoding`):**
- `fn dispatch_tag(&self, b: &mut Builder, entry: StateId, exits: &[StateId])` — from `entry` (the tag is the top STACK field; REG/WORK home), read+erase the tag field, and route to `exits[c]` where `c` is the tag's mark count. On the chosen exit the STACK head is at the new top (tag field erased). If `c ≥ exits.len()` (cannot happen for well-formed programs), route to `exits.last()` defensively (or a caller-provided halt) — never panic.

Build a chain `e_0..e_{K}` (K = `exits.len()`). From the top, step left onto the tag's `#`, erase it, step left onto the tag marks. `e_j`: MARK → erase, move L, `e_{j+1}`; boundary (`#` of the frame below, or origin blank) → the count was `j` → step right to the new top → `exits[j]`. Clamp `j` at `exits.len()-1`.

- [ ] **Step 1: Write the failing test**

```rust
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::encoding::tests::dispatch_tag_routes_on_the_tag_count`
Expected: FAIL — `dispatch_tag` not on the trait.

- [ ] **Step 3: Author the dispatch chain (iterate against the test)**

Build the `e_0..e_K` walk described above. Details:
- After erasing the tag's `#` and stepping onto its marks, `e_j` reads the STACK head: MARK → write BLANK (erase), Move L, `e_{j+1}`; a `#` OR a blank → the tag was `j` → step Right to the new top → `exits[min(j, exits.len()-1)]`.
- For `c = 0` (empty tag field): after erasing the `#`, the head is immediately on the boundary → `e_0`'s boundary rule → `exits[0]`. Handle the "erase `#` then land on boundary" path so `c=0` routes to `exits[0]` and the STACK head ends at the new top.
- Every erased mark leaves the STACK clean; assert no leftover marks.

Iterate until Step 1 passes; hand-trace `c=0`, `c=1`, `c=2`.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core --lib tm::encoding::tests`
Expected: PASS.

- [ ] **Step 5: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): Encoding::dispatch_tag (finite-state return dispatch)"
```

---

## Task 5: Wire `Call`/`Ret` into `lower_tm`

Replace the `Call`/`Ret` placeholder arms with real gadgets: number the call sites, build a per-`Call` `push_frame` + jump, and a **single shared `Ret` handler** (`stack_is_empty` → halt / `pop_frame_restore` → `dispatch_tag(exits)`), with `exits[c] = pc[site_c + 1]`.

**Files:**
- Modify: `crates/redextape-core/src/tm/lower_tm.rs`

**Interfaces consumed:** `enc.push_frame`, `enc.pop_frame_restore`, `enc.stack_is_empty`, `enc.dispatch_tag` (Tasks 2–4); `SlotMap` (for `n_loc`); `Program::label_index`.

**Design.** In `lower_tm`, after building the `pc` states:
1. Compute `n_loc` from the `SlotMap` (add a `pub(crate) fn n_loc(&self) -> u32` returning the `Loc` count, or expose the field). `push_frame`/`pop_frame_restore` need it.
2. Enumerate call sites: `let call_sites: Vec<usize> = prog.code.iter().enumerate().filter(|(_, i)| matches!(i, Instr::Call(_))).map(|(idx, _)| idx).collect();`. Site `c` is `call_sites[c]`, at instruction index `call_sites[c]`; its continuation is `succ(call_sites[c] + 1)`.
3. Build the shared `Ret` handler once: `let ret_entry = b.state("ret");` then `stack_is_empty(ret_entry, halt, restore_start)`, `restore_start`→`pop_frame_restore(n_loc)`→`dispatch_start`, `dispatch_tag(dispatch_start, &exits)` where `exits[c] = succ(call_sites[c] + 1)`. Because `dispatch_tag` builds a chain from a single `entry`, wrap: create `restore_start = b.state("ret.restore")`, run `pop_frame_restore(b, restore_start, dispatch_start, n_loc)`, `dispatch_start = b.state("ret.disp")`, `dispatch_tag(b, dispatch_start, &exits)`.
4. Arms:
   - `Instr::Call(l)`: `let c = /* this Call's ordinal — its position in call_sites */; let target = prog.label_index(l).map_or(halt, &succ); let after = b.state(format!("call{i}.j")); enc.push_frame(&mut b, pc[i], after, n_loc, c as u64); b.add_rule(after, RuleSpec::new(), target);`
   - `Instr::Ret`: `b.add_rule(pc[i], RuleSpec::new(), ret_entry);`

**Determining a `Call`'s ordinal `c`:** since `call_sites` lists call instruction indices in order, the ordinal of the `Call` at index `i` is its position in `call_sites` (`call_sites.iter().position(|&x| x == i).unwrap()`), or build an index→ordinal map before the loop.

- [ ] **Step 1: Write the failing tests**

Add to `lower_tm.rs`'s test module (hand-built recursive programs mirroring `asm.rs`):

```rust
#[test]
fn recursive_sum_through_the_tm() {
    // sum(n) = if n==0 {0} else { n + sum(n-1) };  sum(5) == 15.
    // Identical to asm.rs's recursive_call_preserves_locals_across_the_call.
    let prog = Program {
        code: vec![
            Instr::Li(Reg::Arg(0), 5),
            Instr::Call("sum".to_string()),
            Instr::Halt,
            // sum:
            Instr::Mov(Reg::Loc(0), Reg::Arg(0)),                 // r0 = n
            Instr::Li(Reg::Loc(1), 0),
            Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
            Instr::Jz(Reg::Loc(2), "rec".to_string()),
            Instr::Li(Reg::Rr, 0),
            Instr::Ret,
            // rec:
            Instr::Li(Reg::Loc(3), 1),
            Instr::Bin(BinOp::Sub, Reg::Arg(0), Reg::Loc(0), Reg::Loc(3)), // a0 = n-1
            Instr::Call("sum".to_string()),                                // rr = sum(n-1)
            Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Rr),         // n + sum(n-1)
            Instr::Ret,
        ],
        labels: vec![("sum".to_string(), 3), ("rec".to_string(), 9)],
    };
    assert_eq!(run_nat(&prog), Some(15));
}

#[test]
fn two_distinct_call_sites_dispatch_correctly() {
    // f(x) = x + 1;  result = f(2) + f(10) == 3 + 11 == 14. Two call sites must each resume correctly.
    // r0 staging, a0 arg; the two calls have ordinals 0 and 1 -> tags 0 and 1.
    let prog = Program {
        code: vec![
            Instr::Li(Reg::Arg(0), 2),
            Instr::Call("f".to_string()),      // site 0 -> resume at idx 2
            Instr::Mov(Reg::Loc(0), Reg::Rr),  // r0 = f(2) = 3
            Instr::Li(Reg::Arg(0), 10),
            Instr::Call("f".to_string()),      // site 1 -> resume at idx 5
            Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Rr), // 3 + 11
            Instr::Halt,
            // f:
            Instr::Mov(Reg::Loc(1), Reg::Arg(0)), // note: distinct local from caller's r0
            Instr::Li(Reg::Loc(2), 1),
            Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(1), Reg::Loc(2)),
            Instr::Ret,
        ],
        labels: vec![("f".to_string(), 7)],
    };
    assert_eq!(run_nat(&prog), Some(14));
}
```

> Note for the reviewer: `two_distinct_call_sites_dispatch_correctly` is the discriminating test — it proves the return-tag routes each call site to its OWN continuation (a single-call test would pass even if dispatch always jumped to one fixed site). `recursive_sum` proves the `Loc` bank save/restore across nested activations (the `Bin(Add, Rr, Loc(0), Rr)` reads `Loc(0)=n` after the callee clobbered it).

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::lower_tm`
Expected: FAIL — `recursive_sum`/`two_distinct_call_sites` halt early / wrong (Call/Ret still route to `halt` placeholder).

- [ ] **Step 3: Implement the wiring**

Add `SlotMap::n_loc()`, the call-site enumeration + ordinal map, the shared `Ret` handler, and the two arms as designed above. Replace the `Instr::Call(_) | Instr::Ret | …` placeholder: keep the heap ops (`Nil`/`Cons`/`Head`/`Tail`/`IsEmpty`) routing to `halt` (2b-2-iii), but give `Call`/`Ret` their real arms.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core --lib tm::lower_tm`
Expected: PASS (both new tests + all 2b-2-i tests still green).

- [ ] **Step 5: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/lower_tm.rs
git commit -m "feat(tm): lower call/ret via STACK frames + return-tag dispatch"
```

---

## Task 6: Oracle extension — calls & recursion

Extend `tests/tm_oracle.rs` with the call/recursion demo subset: `reference == TM` and `asm-interp == TM`.

**Files:**
- Modify: `crates/redextape-core/tests/tm_oracle.rs`

- [ ] **Step 1: Add the demos + tests**

Add a `CALL_DEMOS` slice and drive it through the existing `assert_tm_agrees` and `assert_asm_interp_matches_tm` helpers (already in the file from 2b-2-i):

```rust
/// The call/recursion demo subset: named-fn calls, recursion, a directly-applied lambda, and a `fn`
/// inside a mutation region (Plan-2 latent trap). Still NO list/heap ops (Part 2b-2-iii). Values « 64.
const CALL_DEMOS: &[&str] = &[
    "let add1 = |x| x + 1; add1(41)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
    // Plan-2 latent-trap program: a `fn` defined inside a mutation region.
    "let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc",
];

#[test]
fn tm_agrees_with_reference_on_call_demos() {
    for src in CALL_DEMOS {
        assert_tm_agrees(src);
    }
}

#[test]
fn asm_interp_matches_tm_on_call_demos() {
    for src in CALL_DEMOS {
        assert_asm_interp_matches_tm(src);
    }
}
```

> If a demo hits a cap under `TM_DEFAULT_CAPS` (unary recursion is step-heavy — `sum(5)` saves/restores a frame per level), first confirm it is a genuine cap (not a wrong answer) via `asm_interp_matches_tm`, then raise the caps for the TM oracle to a demo-appropriate bound (e.g. `TmCaps { steps: 20_000_000, cells: 20_000_000 }`) rather than dropping the demo — and note in a comment why. Do NOT weaken to a tautology or silently exclude a demo.

- [ ] **Step 2: Run**

Run: `cargo test -p redextape-core --test tm_oracle`
Expected: PASS. If `tm_agrees_*` fails on a `src`, localize with `asm_interp_matches_tm_on_call_demos` (asm==TM failing too → a call/ret lowering bug; asm==TM passing but reference==TM failing → decode/caps).

- [ ] **Step 3: fmt/clippy + full suite**

Run: `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings && cargo test -p redextape-core`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/tests/tm_oracle.rs
git commit -m "test(tm): reference==TM + asm-interp==TM oracle on the call/recursion demos"
```

---

## Deferred to later sub-parts (do NOT attempt here)

- **Part 2b-2-iii — heap & lists:** `Nil`/`Cons`/`Head`/`Tail`/`IsEmpty` via the HEAP tape (cons cells at unary addresses); extend `decode_tape`'s `Nil`/`Cons` arms to follow the heap pointer from `Rr` (marker-delimited — `Tape::snapshot`'s `cells[0]` is NOT the origin after a left-move). Unblocks `head(cons(7, nil))`, `is_empty`, `[1, 2, 3]`.
- **Part 2b-2-iv — the finale:** the full three-way oracle (`reference == λ == TM`) over the whole first-order demo suite; the TM-bounded proptest (bound BOTH `Nat` magnitudes `< FIELD_WIDTH` *and* register indices `< MAX_SLOTS`, small enough that unary stays tractable); golden `print_asm` + TM step counts; TM-text round-trip over compiled machines; and folding the deferred Minors (2b-1 sub-primitive visibility; `x*0` + comparison-trichotomy sweeps; broaden the `asm_oracle` generator + drop its dead `RunError::Static` arm; `cmp_mnemonic`→`bin_mnemonic`; dedup `SlotMap::of` in `run_tm`; DRY the `run_gadget`/`init_reg` bank layout; consider splitting the STACK gadgets into `tm/stack.rs` if `encoding.rs` is unwieldy).

## Self-Review (completed while writing)

- **Spec coverage (this slice):** `Call`/`Ret` → state-graph gadgets over a STACK tape (spec §3.4, §4.1, §6) ✓; whole-`Loc`-bank save/restore + volatile `Arg` + persistent `Rr` mirroring `asm.rs` ✓; finite-state return-tag dispatch (§3.4, no computed jumps) ✓; empty-stack `Ret` halts defensively ✓; `reference == TM` + intermediate `asm-interp == TM` on the call/recursion demos (§12.1, §12.2) ✓; the `fn`-in-mutation-region latent trap (§12.4) ✓. Heap/lists, the full three-way oracle, proptest, goldens, and text round-trip are explicitly deferred to iii/iv.
- **Placeholder scan:** none — mechanical code (push_frame/pop_frame_restore/lower_tm wiring/tests) is complete; the genuinely-iterative δ-gadgets (Task 1 STACK primitives, Task 4 dispatch chain) carry a full design + a complete simulation-test contract, in the Part-2b-1 style, with the one loose test assertion flagged for a clean rewrite.
- **Type/interface consistency:** the four new `Encoding` methods (`push_frame(…, n_loc, tag)`, `pop_frame_restore(…, n_loc)`, `stack_is_empty(…, if_empty, if_nonempty)`, `dispatch_tag(…, exits)`) and the sub-primitives are used identically across Tasks 1–5; `SlotMap::n_loc()` is added in Task 5 and consumed there; frame layout (tag at bottom, `Loc0..Loc_{n-1}` above; pop reverse) is consistent between `push_frame` (Task 2) and `pop_frame_restore` (Task 3); `Rr = slot 0` untouched by save/restore.
