# TM Backend — Part 2b-2-iv-b: Goldens, TM-Text Round-Trip & Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Tasks 1–2 add snapshot/round-trip tests; Tasks 3–4 are cleanup (behavior-preserving refactors + doc fixes) and new coverage. No δ-authoring.

**Goal:** Finish Plan 3 (the TM backend). Add golden snapshots (`print_asm` output + TM step counts) and a TM-text round-trip over *compiled* machines as regression guards, then fold the ~10 accumulated deferred Minors (visibility tightening, DRY hoists, a rename, doc fixes, and coverage-gap tests).

**Architecture:** Two new regression guards — (1) captured goldens: for a small demo, `print_asm(lower_asm(core))` equals a captured string, and `simulate_trace(lower_tm(...)).steps.len()` equals captured step counts (a change to codegen or a gadget's step cost fails the golden, forcing a conscious re-bless); (2) `parse_tm(print_tm(m)) == (Some(m), [])` for `m = lower_tm(...)` on real compiled machines (the text form already round-trips hand-built machines; this exercises it at scale). Then a hygiene pass: privatize now-internal sub-primitives, DRY two duplications, rename a misnamed fn, fix stale docs/test-names, and add the coverage the prior slices flagged.

**Tech Stack:** Rust; the merged `redextape_core::tm::{asm, lower_asm, machine, sim, build, encoding, lower_tm, decode, syntax}`; `proptest` (dev-dep). No new dependencies (goldens are inline strings/numbers — the repo has no snapshot lib).

## Global Constraints

Copied from the `tm-backend-plan3` memory and the accumulated Minor findings. Every task's requirements implicitly include this section.

- **Behavior-preserving cleanup.** Tasks 3's refactors change NO observable behavior — the full `cargo test -p redextape-core` suite (currently **241 passing**) must stay green with no test edits beyond the mandated rename. A refactor that requires changing an assertion is a red flag: stop and report.
- **No new public API surface** beyond what a test genuinely needs. Sub-primitives that are only used inside `encoding.rs` become **private** (`fn`); `stack_is_empty` (used by `lower_tm`) becomes `pub(crate)`. The shared HEAP-cell parser hoisted in Task 3 is `pub(crate)`, not `pub`.
- **Goldens are CAPTURED, not predicted.** Write the golden test, run it once to capture the ACTUAL `print_asm` string / step counts, paste them in as the expected values, and re-run to confirm they're stable. Do NOT fabricate a golden value — a wrong golden that happens to fail-then-get-edited-to-pass is worthless. The plan marks each capture point explicitly.
- **The two SKIPPED Minors** (do NOT implement): (a) the `SlotMap::of`-computed-twice-in-`run_tm` dedup — evaluated and skipped: it is O(instructions), negligible, and deduping needs a `pub(crate)` inner fn or a signature change for no real gain; (b) splitting `encoding.rs` into `tm/stack.rs`/`tm/heap.rs` — deferred: the file is large but cohesively sectioned; a split is a bigger refactor best done when it actually causes friction. Record both as evaluated-and-skipped, don't silently drop them.
- **No attribution in commits** (repo rule): plain single-line messages; never append `Co-Authored-By`/`Generated with`.

---

## File Structure

- **Modify** `crates/redextape-core/src/tm/asm.rs` — Task 1 (a `print_asm` golden unit test); Task 3 (`cmp_mnemonic` → `bin_mnemonic`).
- **Modify** `crates/redextape-core/src/tm/lower_tm.rs` — Task 1 (TM step-count golden unit tests).
- **Modify** `crates/redextape-core/src/tm/syntax.rs` — Task 2 (round-trip over compiled machines).
- **Modify** `crates/redextape-core/src/tm/encoding.rs` — Task 3 (privatize 14 sub-primitives + `stack_is_empty` → `pub(crate)`; add a `pub(crate)` HEAP-cell parser; `run_gadget` uses `init_reg`; doc nits on `cons`/`is_empty_op`/`heap_count`); Task 4 (`x*0` + trichotomy + the two coverage tests).
- **Modify** `crates/redextape-core/src/tm/decode.rs` — Task 3 (use the hoisted parser; reword the `decode_word` termination doc; rename the stale test).
- **Modify** `crates/redextape-core/tests/asm_oracle.rs` — Task 3 (drop the dead `RunError::Static` arm); Task 4 (broaden the generator).
- **Modify** `crates/redextape-core/tests/three_way_oracle.rs` — Task 3 (module-doc mentions the dual; generator-doc wording + the depth=3 note).

---

## Task 1: Goldens — `print_asm` + TM step counts

Snapshot the compiled-asm listing and TM step counts for small demos as regression guards. Both values are CAPTURED on first run.

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs` (a `print_asm` golden in its `#[cfg(test)] mod tests`)
- Modify: `crates/redextape-core/src/tm/lower_tm.rs` (step-count goldens in its `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the `print_asm` golden (asm.rs)**

Add to `asm.rs`'s test module. Compile a small demo from source and snapshot `print_asm`. The test module can `use crate::{parser::parse, desugar::desugar}; use crate::tm::lower_asm::lower_asm;` (add what's missing).

```rust
#[test]
fn print_asm_golden_for_a_small_demo() {
    // A regression guard on lower_asm's codegen + print_asm's format. If either changes, re-capture
    // the expected string below (run the test, copy the `left` from the panic) — a deliberate re-bless.
    let (prog, ds) = parse("let x = 1; let y = x + x; y * 3");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let asm = print_asm(&lower_asm(&core).expect("lowers"));
    let expected = "\
CAPTURE_ME
";
    assert_eq!(asm, expected);
}
```

> CAPTURE STEP: replace `CAPTURE_ME\n` with the ACTUAL `print_asm` output. Run the test, copy the real string from the assertion's `left`, paste it verbatim (mind the trailing newline — `print_asm` ends each line with `\n`), re-run to confirm green. Do NOT invent the listing.

- [ ] **Step 2: Write the step-count goldens (lower_tm.rs)**

Add to `lower_tm.rs`'s test module (it already has `SlotMap`, `simulate`, `Unary`, `REG`, `TAPES`, `DEFAULT_CAPS as CAPS` in scope; add `use crate::tm::sim::simulate_trace;` and `use crate::{parser::parse, desugar::desugar}; use crate::tm::lower_asm::lower_asm;`).

```rust
#[test]
fn tm_step_count_goldens() {
    // The exact number of TM steps a small program takes — a regression guard on gadget step cost and
    // a demonstration of the unary tape's cost. Deterministic (the TM has no nondeterminism). If a
    // gadget's step cost changes, re-capture the numbers below (a deliberate re-bless).
    fn steps(src: &str) -> usize {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let program = lower_asm(&core).expect("lowers");
        let m = lower_tm(&program, &Unary);
        let sm = SlotMap::of(&program);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = Unary.init_reg(sm.n_slots());
        let trace = simulate_trace(&m, &init, CAPS);
        assert_eq!(trace.status, crate::tm::sim::Status::Halted, "demo must halt: {src}");
        trace.steps.len()
    }
    // CAPTURE the actual counts (run once, paste the real numbers). Keep the demos SMALL so the trace
    // stays cheap — avoid step-heavy recursion (sum(5) is ~178k steps).
    assert_eq!(steps("1 + 2 * 3"), 0 /* CAPTURE */);
    assert_eq!(steps("if 2 > 1 { 10 } else { 20 }"), 0 /* CAPTURE */);
    assert_eq!(steps("head(cons(7, nil))"), 0 /* CAPTURE */);
}
```

> CAPTURE STEP: run the test, read the real counts from the assertion failures, replace each `0 /* CAPTURE */` with the actual number, re-run to confirm green + stable (run twice — the counts must be identical). If any demo's trace is surprisingly huge (> ~50k steps), swap it for a smaller one and note why.

- [ ] **Step 3: Run + fmt/clippy/commit**

Run: `cargo test -p redextape-core --lib tm::asm tm::lower_tm` (must pass with the captured values) → `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings`.
```bash
git add crates/redextape-core/src/tm/asm.rs crates/redextape-core/src/tm/lower_tm.rs
git commit -m "test(tm): golden print_asm listing + TM step counts for small demos"
```

---

## Task 2: TM-text round-trip over compiled machines

The text form already round-trips hand-built machines (`syntax.rs`'s `parse_then_print_round_trips`). Prove it on real, large, `lower_tm`-compiled machines.

**Files:**
- Modify: `crates/redextape-core/src/tm/syntax.rs` (a new round-trip test in its `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the test**

Add to `syntax.rs`'s test module (import what it needs: `use crate::tm::lower_tm::lower_tm; use crate::tm::encoding::Unary; use crate::tm::lower_asm::lower_asm; use crate::{parser::parse, desugar::desugar};`).

```rust
#[test]
fn compiled_machines_round_trip_through_the_text_form() {
    // parse_tm(print_tm(m)) == (Some(m), []) for machines produced by the real compiler, not just
    // hand-built ones. lower_tm guarantees validate()-clean machines (state names use only `.` and
    // alphanumerics — no reserved `; * : [ ]`/whitespace), which is exactly what gates the round-trip.
    for src in ["1 + 2 * 3", "if 1 == 2 { 10 } else { 20 }", "head(cons(7, nil))", "cons(1, cons(2, nil))"] {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
        let core = desugar(&prog.unwrap());
        let m = lower_tm(&lower_asm(&core).expect("lowers"), &Unary);
        assert!(m.validate().is_empty(), "compiled machine must be validate()-clean for {src}: {:?}", m.validate());
        assert_eq!(parse_tm(&print_tm(&m)), (Some(m.clone()), vec![]), "round-trip must equal m for {src}");
    }
}
```

> `parse_tm` returns `(Option<Machine>, Vec<Diagnostic>)`; the existing tests use `parse_ok`/direct tuple compares — mirror whichever the module already uses. `Machine`/`State`/`Rule`/`Move` all derive `PartialEq`, so `==` is structural. If a demo's machine is very large and the test is slow, keep the smallest 3–4 demos that still exercise arithmetic/branch/heap.

- [ ] **Step 2: Run + fmt/clippy/commit**

Run: `cargo test -p redextape-core --lib tm::syntax` (must pass) → fmt + clippy clean.
```bash
git add crates/redextape-core/src/tm/syntax.rs
git commit -m "test(tm): TM-text round-trip over compiled machines"
```

---

## Task 3: Refactor & doc cleanup (behavior-preserving)

Fold the hygiene Minors. NO behavior change — the full suite must stay green with no assertion edits (only the one mandated test *rename*).

**Files:** `encoding.rs`, `decode.rs`, `asm.rs`, `tests/asm_oracle.rs`, `tests/three_way_oracle.rs`.

- [ ] **Step 1: Privatize the internal sub-primitives (`encoding.rs`)**

In `encoding.rs`, change `pub fn` → `fn` (private) for the 14 sub-primitives used ONLY within `encoding.rs` (its impls + its own `#[cfg(test)] mod tests`, which reach private parent items via `use super::*`): `clear_work`, `copy_field_to_work`, `append_work_to_field`, `append_field_to_work`, `erase_per_field`, `stack_push_work`, `stack_push_literal`, `stack_pop_work`, `heap_open_cell_with_work`, `heap_append_work`, `heap_count_cells_to_work`, `heap_seek_cell`, `heap_read_head_to_work`, `heap_read_tail_to_work` (and any other `pub` free fn in the file that a crate-wide search shows is unused outside `encoding.rs`). Change `stack_is_empty` from `pub fn` → `pub(crate) fn` (it is imported by `lower_tm.rs`). Verify with `grep -rn '\bNAME\b' src/ tests/` that only `encoding.rs` (and, for `stack_is_empty`, `lower_tm.rs`) reference each before privatizing. `cargo build` + the suite prove none were public API.

- [ ] **Step 2: DRY the HEAP-cell parser (`encoding.rs` + `decode.rs`)**

`decode.rs`'s private `parse_heap` and `encoding.rs`'s test-helper `heap_cells` are the same `@`-scan algorithm. Hoist ONE `pub(crate) fn parse_heap_cells(cells: &[Symbol]) -> Vec<(u64, u64)>` into `encoding.rs` (near the HEAP sub-primitives), delete `decode.rs`'s `parse_heap` (call the hoisted one via `use crate::tm::encoding::parse_heap_cells;`), and delete `encoding.rs`'s test `heap_cells` (its tests call the hoisted one). Keep the algorithm identical; the existing decode + encoding tests prove it.

- [ ] **Step 3: `run_gadget` uses `init_reg` (`encoding.rs`)**

In `encoding.rs`'s test helper `run_gadget`, replace the inline `let mut init_reg = vec![SEP]; for _ in 0..slots { init_reg.extend(repeat_n(BLANK, FIELD_WIDTH)); init_reg.push(SEP); }` with `let init_reg = enc.init_reg(slots);` (it produces the identical bank). Removes the duplication of `init_reg`'s layout.

- [ ] **Step 4: `cmp_mnemonic` → `bin_mnemonic` (`asm.rs`)**

Rename `cmp_mnemonic` to `bin_mnemonic` (both the `fn` and its call site in `instr_str`). It maps ALL `BinOp`s (arithmetic + comparison), so "cmp" was a misnomer. Pure rename, no behavior change.

- [ ] **Step 5: Drop the dead `RunError::Static` arm (`tests/asm_oracle.rs`)**

In the proptest `asm_agrees_with_reference_on_random_first_order_programs`, delete the `(Err(RunError::Static(_)), _) => {}` arm — `prop_assume!(ds.is_empty())` already skips every non-type-checking program, so a `Static` error is unreachable there. Leaving the arm makes the match falsely look like it handles a real case.

- [ ] **Step 6: Fix stale docs + a test name**

- `decode.rs` `decode_word` doc: replace "Terminates because compiled heaps are acyclic (a cons cell's tail points only at an EARLIER cell)" with the correct reason: it terminates by **structural recursion on `expected`** (a finite reference `Value`), so it halts regardless of heap cycles; acyclicity is what makes the *result correct*, not what makes it *halt*.
- `decode.rs` rename the test `non_first_class_and_heap_shapes_decode_to_none` → `non_first_class_shapes_decode_to_none` (the heap-shape case moved to `decodes_nil_result` in 2b-2-iii-a; the name is now stale).
- `encoding.rs` doc nits: (a) `cons`'s doc opening sentence nests backtick spans (`` `(head = field `rh`'s value, …)` ``) — drop the outer backtick pair, keep `rh`/`rt` individually backticked; (b) `is_empty_op`'s doc: add the aliasing-safety note (safe under `rd == rl` — `rl` is fully copied to WORK before `rd` is written), matching `mov`'s style; (c) `heap_count_cells_to_work`'s doc lists "REG/WORK home" as a precondition but the gadget never touches REG — drop REG, only WORK-home matters.
- `tests/three_way_oracle.rs`: (a) the module-doc header now mentions the `LAMBDA_LIMITATION_DEMOS`/`assert_tm_only` dual (the λ-refuses mirror of the higher-order TM-refuses case); (b) the `arb_tm_safe_expr` doc: soften "provably stays under FIELD_WIDTH" to "stays under FIELD_WIDTH (the `depth=3` recursion cap plus value-non-growing ops keep it there; measured max 27 over 2M samples)" and note that **`depth=3` (not `desired_size`) is the true safety lever** — a future editor raising the leaf range must keep the depth cap.

- [ ] **Step 7: Run + fmt/clippy/commit**

Run: `cargo test -p redextape-core` (ALL green — the only test change is the rename; no assertion edits) → `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings`.
```bash
git add crates/redextape-core/src/tm/encoding.rs crates/redextape-core/src/tm/decode.rs crates/redextape-core/src/tm/asm.rs crates/redextape-core/tests/asm_oracle.rs crates/redextape-core/tests/three_way_oracle.rs
git commit -m "refactor(tm): privatize internal sub-primitives, DRY heap-cell parsing, fix stale docs/names"
```

---

## Task 4: New test coverage

Fill the coverage gaps the prior slices flagged: multiply-by-zero, a comparison trichotomy sweep, the two 2b-2-iii-b HEAP-deref paths, and a broader asm-oracle generator.

**Files:** `encoding.rs` (arith/compare + HEAP-deref coverage), `tests/asm_oracle.rs` (generator).

- [ ] **Step 1: `x * 0` and a comparison trichotomy sweep (`encoding.rs` tests)**

Using the existing `run_gadget` helper (init slots, run a gadget, decode a result slot):
```rust
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
    for (a, bb, lt, le, gt, ge, eq, ne) in [(2u64, 5u64, 1, 1, 0, 0, 0, 1), (5, 5, 0, 1, 0, 1, 1, 0), (5, 2, 0, 0, 1, 1, 0, 1)] {
        assert_eq!(cmp(BinOp::Lt, a, bb), Some(lt), "lt {a},{bb}");
        assert_eq!(cmp(BinOp::Le, a, bb), Some(le), "le {a},{bb}");
        assert_eq!(cmp(BinOp::Gt, a, bb), Some(gt), "gt {a},{bb}");
        assert_eq!(cmp(BinOp::Ge, a, bb), Some(ge), "ge {a},{bb}");
        assert_eq!(cmp(BinOp::Eq, a, bb), Some(eq), "eq {a},{bb}");
        assert_eq!(cmp(BinOp::Ne, a, bb), Some(ne), "ne {a},{bb}");
    }
}
```
> `BinOp` is imported in `encoding.rs`; the test module has it via `use super::*`. Confirm `run_gadget`'s signature (`slots`, `inits: &[(Slot, u64)]`, `result: Slot`, `body`) matches — adjust the calls if the real helper differs.

- [ ] **Step 2: The two HEAP-deref coverage paths (`encoding.rs` tests)**

The 2b-2-iii-b final review flagged two untested-but-correct paths. Cover them:
```rust
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
```
> These use the same manual-builder pattern as `head_op_and_tail_op_read_a_cell`. If a slot layout or count is off, adjust — the assertions (tail=1; head-of-new=9) are the contract.

- [ ] **Step 3: Broaden the asm-oracle generator (`tests/asm_oracle.rs`)**

Widen `arb_expr` so the reference==asm proptest covers more first-order shapes (asm has no `FIELD_WIDTH` limit, so values may be large). Add comparison and nested-let arms to the `prop_oneof!`:
```rust
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("(if {a} > {b} {{ {a} }} else {{ {b} }})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("(if {a} == {b} {{ 1 }} else {{ 0 }})")),
            (inner.clone(), inner).prop_map(|(v, body)| format!("(let q = {v}; let r = q + q; {body} + r)")),
```
Keep the leaf bound (`0..1500`, the λ-representability bound — this generator feeds only reference==asm, but staying representable keeps it reusable). Confirm the proptest still passes (200 cases) — a new arm that trips a real disagreement is a finding, not something to hide.

- [ ] **Step 4: Run + fmt/clippy/commit**

Run: `cargo test -p redextape-core` (all green incl. the new tests + 200 broadened proptest cases) → fmt + clippy clean.
```bash
git add crates/redextape-core/src/tm/encoding.rs crates/redextape-core/tests/asm_oracle.rs
git commit -m "test(tm): mul-by-zero, comparison trichotomy, HEAP-deref coverage, broader asm-oracle generator"
```

---

## Plan 3 is complete after this slice

With iv-b merged, the TM backend (Plan 3) is DONE: Core → register-asm → multi-tape TM → simulate → decode, with the full three-way oracle (`reference == λ == TM`), proptest, goldens, and TM-text round-trip. The next directions are the [[future-extensions]] tracks (single-tape TM as an executable reduction; an oracle-guarded optimizing compiler; tree-sitter) and Plan 3b (closures / higher-order via defunctionalization). None is started here.

## Self-Review (completed while writing)

- **Spec coverage (this slice):** golden `print_asm` + TM step counts (§12) ✓; TM-text round-trip over compiled machines (§7.2, the v1 editable pane contract) ✓; the accumulated Minors folded (visibility, DRY, rename, doc fixes, coverage) ✓; two Minors evaluated-and-skipped with rationale (SlotMap dedup; encoding.rs split). The broader asm-oracle generator + trichotomy/mul-zero/HEAP-deref coverage close the flagged gaps.
- **Placeholder scan:** all code is concrete EXCEPT the two deliberate golden-capture points (Task 1), which are the standard captured-golden workflow with explicit CAPTURE STEP instructions — not vague placeholders. Everything else (round-trip, refactors, coverage tests) is complete code.
- **Type/interface consistency:** `print_asm(&Program) -> String`, `lower_asm(&Core) -> Result<Program, LowerError>`, `lower_tm(&Program, &dyn Encoding) -> Machine`, `simulate_trace(&Machine, &[Vec<Symbol>], Caps) -> Trace` (with `.steps: Vec<Step>`, `.status`), `parse_tm(&str) -> (Option<Machine>, Vec<Diagnostic>)`, `print_tm(&Machine) -> String`, `Machine: PartialEq` — all match the merged public surface (`tm.rs` re-exports). The privatization is safe (a crate-wide search confirms the 14 fns are `encoding.rs`-internal and `stack_is_empty` is used only by `lower_tm.rs`); the hoisted `parse_heap_cells` keeps the same algorithm both callers already rely on; `run_gadget`/`init_reg` produce byte-identical banks; `cmp_mnemonic`→`bin_mnemonic` is a pure rename.
