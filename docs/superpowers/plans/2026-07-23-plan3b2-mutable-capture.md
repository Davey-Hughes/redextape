# Plan 3b-2 — Mutable-Capture Closures via Boxing (Two-Way) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TM run closures that capture a **mutable** variable *by reference* — `let mut n = 1; fn apply0(g){g(0)} let f = |x| x + n; n = 10; apply0(f)` returns **10** on `reference == TM` (λ still refuses) — by boxing each captured mutable into a shared mutable cell backed by a new fixed-width **BOX tape**.

**Architecture:** A captured mutable is *boxed*. The defunc pass (Core→Core) rewrites a captured `let mut n = init` into an immutable `let $boxh = $box(init)`, every read of `n` into `$box_get($boxh)`, every `n = v` into `$box_set($boxh, v)`, and captures `$boxh` (an immutable box **handle**) in the closure env. `$box`/`$box_get`/`$box_set` are three synthetic Core builtins (like `cons`/`head`/`tail`) that lower to three new asm instructions (`Box`/`BoxGet`/`BoxSet`), which lower to three new δ-gadgets over a new **fixed-width, runtime-indexed BOX tape** (tape #4; `box_set` overwrites in place, mirroring REG's `write_literal` — no shifting). The reference interpreter gains a `Value::Box(Rc<RefCell<Value>>)` and matching builtins so the semantics-preservation contract `reference(P) == reference(defunc(P))` stays checkable. Because λ rejects mutable-in-closure, these programs are two-way `reference == TM` (the `assert_tm_only` bucket).

**Tech Stack:** Rust (edition 2024), single crate `redextape-core`, `cargo test`/`cargo clippy`/`cargo fmt`. No new dependencies.

## Global Constraints

- **Never a silent miscompile.** Everything the transform accepts must be semantically exact (validated by `reference(P) == reference(defunc(P))` and the three-way/two-way oracle) or `LowerError::Unsupported` — never a wrong answer. This is the project's cardinal rule.
- **`defunc` stays TOTAL / panic-free on ANY `Core`.** No new `unwrap`/`expect`/`panic!`/unchecked index/unchecked subtraction in production paths. Every would-be internal-invariant violation degrades to `LowerError::Unsupported` (mirror `defunc.rs:250-255`, `554-559`). Depth is bounded up front by `too_deep_node` (`MAX_DEFUNC_DEPTH = 580`); new rewrite code recurses only over input `Core` sub-trees, so it inherits that bound.
- **Values, tags, pointers, box handles, and box contents stay `< FIELD_WIDTH` (64).** The TM's unary representability bound. A box holds one value `< FIELD_WIDTH`.
- **Synthetic names are `$`-prefixed and uncollidable.** The lexer only accepts `[A-Za-z_][A-Za-z0-9_]*`, so `$box`, `$box_get`, `$box_set`, and box handles `$boxh{k}` can never appear in user source and never collide with user identifiers (same discipline as `$apply{N}`/`$clos`/`$env`).
- **The three-way oracle (`reference == λ == TM`) and every existing test stay green.** New work only *adds* capability; no existing demo regresses. Boxing only touches mutables that a lambda actually captures — purely imperative mutables (loop counters) are never boxed, so `while`/`count_down` programs are byte-for-byte unaffected.
- **Encoding is `Unary` (v1).** The BOX tape is unary fixed-width like REG.
- clippy clean (`cargo clippy` is warn=deny in CI), `cargo fmt` applied, before every commit.

## Design Reference — the box, end to end

**Core (synthetic builtins, no new `Core` enum variant):**
- `$box(init)` — `Apply(Var("$box"), [init])` — allocate a fresh mutable cell holding `init`, evaluate to its **handle** (a pointer).
- `$box_get(h)` — `Apply(Var("$box_get"), [h])` — read the cell `h` points at (faults on a nil/dangling handle).
- `$box_set(h, v)` — `Apply(Var("$box_set"), [h, v])` — overwrite the cell in place; evaluates to **unit** (like `Assign`).

**asm (`tm/asm.rs`), separate box store `boxes: Vec<u64>` on the Vm, 1-based pointers, 0 = null:**
- `Instr::Box(rd, rv)` — `rd <- alloc a box holding rv` (push `rv`; `rd = boxes.len()`).
- `Instr::BoxGet(rd, rb)` — `rd <- boxes[rb-1]` (fault if `rb == 0` or dangling).
- `Instr::BoxSet(rb, rv)` — `boxes[rb-1] <- rv` in place (fault if `rb == 0` or dangling).

**TM — the new BOX tape (`tm/build.rs` `BOX = 4`, `TAPES = 5`):** a fixed-width bank of `#`-delimited FIELD_WIDTH fields, grown dynamically like the HEAP but fixed-width like REG. Layout: `# <field₁> # <field₂> # …`, each `<fieldᵢ>` exactly `FIELD_WIDTH` cells (value marks left-justified, blank-padded); the head rests at the blank "top" after the last field between ops. A box pointer `p` (1-based unary, stored in REG) addresses the `p`-th field. `box_set` seeks field `p` and overwrites its fixed window in place — no shifting, because the field is fixed-width and always has padding.

**Reference interp (`value.rs`/`interp.rs`/`prelude.rs`):** `Value::Box(Rc<RefCell<Value>>)`; `$box`/`$box_get`/`$box_set` are `Builtin` variants reusing the existing `Rc<RefCell<Value>>` slot machinery (the same mechanism that already gives by-reference mutable capture). This keeps `reference(defunc(P))` evaluable so the semantics-preservation contract holds.

**defunc (`tm/defunc.rs`):** `boxed_names = mutable_names ∩ (free vars of every `Lambda` node)`. A mutable that some lambda captures is boxed; every other mutable is untouched. The mutable-capture *rejection* (`defunc.rs:434-448`) is replaced by boxing.

## File Structure

- `crates/redextape-core/src/tm/asm.rs` — **modify.** Add `Box`/`BoxGet`/`BoxSet` to `Instr`; a `boxes: Vec<u64>` store on the interpreter `Vm`; interpreter arms; `instr_str` render arms; `instr_reg_over_cap` arms. (Task 1)
- `crates/redextape-core/src/value.rs` — **modify.** Add `Value::Box(Rc<RefCell<Value>>)` + `Builtin::{Box,BoxGet,BoxSet}`; update `Debug`/`PartialEq`/`Drop` helpers. (Task 2)
- `crates/redextape-core/src/interp.rs` — **modify.** `apply_builtin` arms for the three box builtins. (Task 2)
- `crates/redextape-core/src/prelude.rs` — **modify.** Bind `$box`/`$box_get`/`$box_set` in `runtime_env()`. (Task 2)
- `crates/redextape-core/src/tm/lower_asm.rs` — **modify.** Emit `Box`/`BoxGet`/`BoxSet` from `$box`/`$box_get`/`$box_set` applications in `lower_builtin_apply`. (Task 3)
- `crates/redextape-core/src/tm/build.rs` — **modify.** `TAPES = 5`, `pub const BOX = 4`. (Task 4)
- `crates/redextape-core/src/tm/encoding.rs` — **modify.** Three new `Encoding` trait methods `box_op`/`box_get_op`/`box_set_op` + `Unary` impls + BOX-tape sub-primitives + gadget unit tests. (Task 5)
- `crates/redextape-core/src/tm/lower_tm.rs` — **modify.** Dispatch `Box`/`BoxGet`/`BoxSet` to the gadgets; add `instr_regs` arms. (Task 6)
- `crates/redextape-core/src/tm/defunc.rs` — **modify.** Box captured mutables instead of rejecting. (Task 7)
- `crates/redextape-core/tests/three_way_oracle.rs` — **modify.** Two-way mutable-capture demos in `LAMBDA_LIMITATION_DEMOS`. (Task 8)
- `crates/redextape-core/examples/tm_demo.rs` — **modify.** Add a mutable-capture row to section 3. (Task 8)

## Interfaces (produced across tasks — exact names/types later tasks rely on)

- `tm::asm::Instr::Box(Reg, Reg)` (dst, value), `BoxGet(Reg, Reg)` (dst, box), `BoxSet(Reg, Reg)` (box, value). (Task 1)
- `value::Value::Box(std::rc::Rc<std::cell::RefCell<Value>>)`; `value::Builtin::{Box, BoxGet, BoxSet}`. (Task 2)
- `tm::build::BOX: usize = 4`; `tm::build::TAPES: usize = 5`. (Task 4)
- `Encoding::box_op(&self, b, entry, exit, rv: Slot, rd: Slot)`, `box_get_op(&self, b, entry, exit, rb: Slot, rd: Slot)`, `box_set_op(&self, b, entry, exit, rb: Slot, rv: Slot)`. (Task 5)
- `tm::defunc` emits Core `$box`/`$box_get`/`$box_set` via helper builders `box1`/`box_get1`/`box_set2`. (Task 7)

---

### Task 1: asm IR — `Box`/`BoxGet`/`BoxSet` instructions, interpreter, printer

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs` (`Instr` enum ~`asm.rs:19-48`; `Vm` struct ~`asm.rs:177`; interpreter loop; `instr_str` ~`asm.rs:89-109`; `instr_reg_over_cap` ~`asm.rs:235-244`)
- Test: same file's `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `Instr::Box(Reg, Reg)` (dst, value), `Instr::BoxGet(Reg, Reg)` (dst, box), `Instr::BoxSet(Reg, Reg)` (box, value). A separate `boxes: Vec<u64>` allocation store on `Vm`, 1-based pointers, `0` = null, in-place `BoxSet`.
- Consumes: existing `Reg`, `Vm::read`/`Vm::write`, `AsmRun::{Ran,Fault,HitCap}`, `vm.caps.heap` (reused as the box-store allocation ceiling).

- [ ] **Step 1: Write the failing tests** (append to `mod tests` in `asm.rs`)

```rust
#[test]
fn box_alloc_get_and_set_roundtrip() {
    // b = box(7); r1 = box_get(b) == 7; box_set(b, 9); rr = box_get(b) == 9
    let prog = Program {
        code: vec![
            Instr::Li(Reg::Loc(0), 7),
            Instr::Box(Reg::Loc(1), Reg::Loc(0)),   // r1 = box(7), pointer 1
            Instr::BoxGet(Reg::Loc(2), Reg::Loc(1)), // r2 = box_get(r1) = 7
            Instr::Li(Reg::Loc(3), 9),
            Instr::BoxSet(Reg::Loc(1), Reg::Loc(3)), // *r1 = 9 (in place)
            Instr::BoxGet(Reg::Rr, Reg::Loc(1)),     // rr = box_get(r1) = 9
            Instr::Halt,
        ],
        labels: vec![],
    };
    assert_eq!(ran(prog), 9);
}

#[test]
fn boxes_get_sequential_pointers_and_are_independent() {
    // two boxes are distinct cells; setting one does not touch the other
    let prog = Program {
        code: vec![
            Instr::Li(Reg::Loc(0), 3),
            Instr::Box(Reg::Loc(1), Reg::Loc(0)),   // r1 = box(3) -> ptr 1
            Instr::Li(Reg::Loc(2), 4),
            Instr::Box(Reg::Loc(3), Reg::Loc(2)),   // r3 = box(4) -> ptr 2
            Instr::Li(Reg::Loc(4), 5),
            Instr::BoxSet(Reg::Loc(1), Reg::Loc(4)), // *r1 = 5
            Instr::BoxGet(Reg::Rr, Reg::Loc(3)),     // rr = box_get(r3) = 4 (unchanged)
            Instr::Halt,
        ],
        labels: vec![],
    };
    assert_eq!(ran(prog), 4);
}

#[test]
fn box_get_of_null_handle_faults() {
    let prog = Program {
        code: vec![Instr::Li(Reg::Loc(0), 0), Instr::BoxGet(Reg::Rr, Reg::Loc(0)), Instr::Halt],
        labels: vec![],
    };
    assert!(matches!(run(prog), AsmRun::Fault(_)));
}

#[test]
fn box_set_of_dangling_handle_faults() {
    // pointer 5 into an empty box store: fault, never index out of bounds
    let prog = Program {
        code: vec![
            Instr::Li(Reg::Loc(0), 5),
            Instr::Li(Reg::Loc(1), 1),
            Instr::BoxSet(Reg::Loc(0), Reg::Loc(1)),
            Instr::Halt,
        ],
        labels: vec![],
    };
    assert!(matches!(run(prog), AsmRun::Fault(_)));
}

#[test]
fn box_alloc_respects_the_allocation_cap() {
    let prog = Program {
        code: vec![Instr::Li(Reg::Loc(0), 1), Instr::Box(Reg::Loc(1), Reg::Loc(0)), Instr::Box(Reg::Loc(2), Reg::Loc(0)), Instr::Halt],
        labels: vec![],
    };
    // cap of 1 box allocation: the second Box hits the cap
    assert!(matches!(run_asm(&prog, Caps { heap: 1, ..DEFAULT_CAPS }), AsmRun::HitCap));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p redextape-core --lib tm::asm 2>&1 | tail -20`
Expected: compile error (no `Instr::Box` variant).

- [ ] **Step 3: Add the `Instr` variants** (`asm.rs`, after `Instr::IsEmpty`)

```rust
    /// `rd <- box(rv)` (allocate a fresh mutable box cell holding rv, return its 1-based pointer)
    Box(Reg, Reg),
    /// `rd <- box_get(rb)` (read the box; fault if rb is null/dangling)
    BoxGet(Reg, Reg),
    /// `box_set(rb, rv)` — overwrite the box in place (fault if rb is null/dangling)
    BoxSet(Reg, Reg),
```

- [ ] **Step 4: Add the box store to `Vm` and the interpreter arms**

Add `boxes: Vec<u64>` to the `Vm` struct (init `Vec::new()` alongside `heap`). Add arms to the instruction `match` (mirror the `Cons`/`Head`/`Tail` arms; the box store is 1-based like the heap):

```rust
Instr::Box(rd, rv) => {
    if vm.boxes.len() as u64 >= vm.caps.heap {
        return AsmRun::HitCap;
    }
    let v = vm.read(*rv);
    vm.boxes.push(v);
    let ptr = vm.boxes.len() as u64; // 1-based
    vm.write(*rd, ptr);
    vm.pc += 1;
}
Instr::BoxGet(rd, rb) => {
    let p = vm.read(*rb);
    if p == 0 {
        return AsmRun::Fault("box_get of null handle".to_string());
    }
    let Some(&v) = vm.boxes.get((p - 1) as usize) else {
        return AsmRun::Fault("box_get of invalid handle".to_string());
    };
    vm.write(*rd, v);
    vm.pc += 1;
}
Instr::BoxSet(rb, rv) => {
    let p = vm.read(*rb);
    if p == 0 {
        return AsmRun::Fault("box_set of null handle".to_string());
    }
    let v = vm.read(*rv);
    let Some(slot) = vm.boxes.get_mut((p - 1) as usize) else {
        return AsmRun::Fault("box_set of invalid handle".to_string());
    };
    *slot = v;
    vm.pc += 1;
}
```

- [ ] **Step 5: Add `instr_str` render arms** (`asm.rs:89-109` — no wildcard arm exists, so these are compile-forced)

```rust
Instr::Box(rd, rv) => format!("box {}, {}", reg_str(*rd), reg_str(*rv)),
Instr::BoxGet(rd, rb) => format!("box_get {}, {}", reg_str(*rd), reg_str(*rb)),
Instr::BoxSet(rb, rv) => format!("box_set {}, {}", reg_str(*rb), reg_str(*rv)),
```

- [ ] **Step 6: Add `instr_reg_over_cap` arms** (`asm.rs:235-244` — a new instr MUST be scanned or the safety check silently skips it). All three are 2-register:

```rust
Instr::Box(a, b) | Instr::BoxGet(a, b) | Instr::BoxSet(a, b) => reg_over_cap(*a) || reg_over_cap(*b),
```

(Fold into the existing 2-register arm alongside `Mov`/`Head`/`Tail`/`IsEmpty`.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `cargo test -p redextape-core --lib tm::asm 2>&1 | tail -20`
Expected: PASS (all five box tests + existing asm tests).

- [ ] **Step 8: fmt, clippy, commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets 2>&1 | tail -5
git add -A && git commit -m "feat(tm): add Box/BoxGet/BoxSet asm instructions + interpreter"
```

---

### Task 2: Reference interpreter — `Value::Box` and the three box builtins

**Files:**
- Modify: `crates/redextape-core/src/value.rs` (`Value` enum `value.rs:25-39`; `Builtin` `value.rs:17-23`; `Debug` `55-67`; `PartialEq` `41-53`; `take_owned_value_children` `74-99`)
- Modify: `crates/redextape-core/src/interp.rs` (`apply_builtin` `interp.rs:207-218`)
- Modify: `crates/redextape-core/src/prelude.rs` (`runtime_env()` `prelude.rs:26`)
- Test: `interp.rs` `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `Value::Box(Rc<RefCell<Value>>)`, `Builtin::{Box, BoxGet, BoxSet}`, evaluable `$box`/`$box_get`/`$box_set`. This makes `reference(defunc(P))` runnable (the Task 7 contract).
- Consumes: existing `Rc<RefCell<Value>>` slot machinery, `RuntimeError`, `Value::Unit`.

**Why type schemes are NOT touched:** `$box`/`$box_get`/`$box_set` are `$`-prefixed, so they can never appear in user source (the lexer rejects `$`), and the Task-7 contract test calls `interp::eval(&Core)` **directly** (bypassing `typecheck`). So they need a `runtime_env` binding (eval seeds its env from it) but no `ty`/`typeck` scheme and no new `Box` type in the type system. If a test asserts `runtime_env()` keys equal `BUILTIN_NAMES` or the scheme table, exclude `$`-prefixed names from that assertion (they are internal) rather than inventing a `Box` type.

- [ ] **Step 1: Write the failing tests** (append to `interp.rs` `mod tests`; these build `Core` directly since `$box` is not surface syntax)

```rust
#[test]
fn box_get_reads_what_box_set_wrote() {
    use crate::core::{Core, NodeGen};
    // let h = $box(1) in { $box_set(h, 9); $box_get(h) }  ==> 9
    let mut g = NodeGen::default();
    let apply = |g: &mut NodeGen, name: &str, args: Vec<Core>| {
        Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), name.into())), args)
    };
    let one = Core::Nat(g.fresh(), 1);
    let boxed = apply(&mut g, "$box", vec![one]);
    let hset = apply(&mut g, "$box_set", vec![Core::Var(g.fresh(), "h".into()), Core::Nat(g.fresh(), 9)]);
    let hget = apply(&mut g, "$box_get", vec![Core::Var(g.fresh(), "h".into())]);
    let seq = Core::Seq(g.fresh(), Box::new(hset), Box::new(hget));
    let prog = Core::Let { id: g.fresh(), name: "h".into(), mutable: false, value: Box::new(boxed), body: Box::new(seq) };
    assert_eq!(crate::interp::eval(&prog).unwrap(), Value::Nat(9));
}

#[test]
fn a_shared_box_is_seen_by_reference_through_a_closure() {
    // Mirrors the by-reference contract: two handles to the SAME cell (via a let binding)
    // observe each other's writes.  let h = $box(0) in let g = h in { $box_set(g, 5); $box_get(h) } == 5
    use crate::core::{Core, NodeGen};
    let mut g = NodeGen::default();
    let apply = |g: &mut NodeGen, name: &str, args: Vec<Core>| {
        Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), name.into())), args)
    };
    let boxed = apply(&mut g, "$box", vec![Core::Nat(g.fresh(), 0)]);
    let set = apply(&mut g, "$box_set", vec![Core::Var(g.fresh(), "g2".into()), Core::Nat(g.fresh(), 5)]);
    let get = apply(&mut g, "$box_get", vec![Core::Var(g.fresh(), "h".into())]);
    let seq = Core::Seq(g.fresh(), Box::new(set), Box::new(get));
    let inner = Core::Let { id: g.fresh(), name: "g2".into(), mutable: false, value: Box::new(Core::Var(g.fresh(), "h".into())), body: Box::new(seq) };
    let prog = Core::Let { id: g.fresh(), name: "h".into(), mutable: false, value: Box::new(boxed), body: Box::new(inner) };
    assert_eq!(crate::interp::eval(&prog).unwrap(), Value::Nat(5));
}

#[test]
fn box_get_of_a_non_box_is_a_runtime_error() {
    use crate::core::{Core, NodeGen};
    let mut g = NodeGen::default();
    let get = Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), "$box_get".into())), vec![Core::Nat(g.fresh(), 3)]);
    assert!(crate::interp::eval(&get).is_err());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p redextape-core --lib interp::tests::box 2>&1 | tail -20`
Expected: compile error (no `Builtin::Box`).

- [ ] **Step 3: Add `Value::Box` + `Builtin` variants** (`value.rs`)

Add to `Builtin`: `Box, BoxGet, BoxSet`. Add to `Value`:

```rust
    /// A mutable box cell (Plan 3b-2). Reuses the frame-slot type; shared by Rc so a box handle
    /// captured by a closure sees later writes. Never a decoded/final result — an intermediate only.
    Box(std::rc::Rc<std::cell::RefCell<Value>>),
```

Update the three exhaustive impls:
- `Debug` (`value.rs:55-67`): add `Value::Box(_) => write!(f, "<box>"),`.
- `PartialEq` (`value.rs:41-53`): add `Value::Box(_) => false,` in the same spot the function/closure arms return `false` (a box is never equality-compared as a result; identity would also be defensible but structural-inequality matches the closure convention).
- `take_owned_value_children` (`value.rs:74-99`): add a `Value::Box(cell)` arm that, when the cell is uniquely owned, takes its inner child for the iterative drop worklist, so a box holding a deep list can't stack-overflow on drop. Suggested:

```rust
Value::Box(cell) => {
    if let Ok(inner) = std::rc::Rc::try_unwrap(std::mem::replace(cell, std::rc::Rc::new(std::cell::RefCell::new(Value::Unit)))) {
        out.push(inner.into_inner());
    }
}
```

(Match the exact signature/return convention of the existing `take_owned_value_children`; the key point is: descend into the box's child so Drop stays iterative. If the existing helper's shape makes this awkward, a plainer conservative version that pushes `cell.borrow().clone()`-free child is acceptable as long as it does not recurse.)

- [ ] **Step 4: Add `apply_builtin` arms** (`interp.rs:207-218`, before the wildcard `_ =>` fallthrough)

```rust
(Builtin::Box, [init]) => Ok(Value::Box(Rc::new(RefCell::new(init.clone())))),
(Builtin::BoxGet, [Value::Box(cell)]) => Ok(cell.borrow().clone()),
(Builtin::BoxSet, [Value::Box(cell), v]) => {
    *cell.borrow_mut() = v.clone();
    Ok(Value::Unit)
}
```

(Ensure `use std::cell::RefCell; use std::rc::Rc;` are in scope in `interp.rs`; they already are for the frame machinery.)

- [ ] **Step 5: Bind the names in `runtime_env()`** (`prelude.rs:26`)

```rust
        ("$box".into(), Value::Builtin(Builtin::Box)),
        ("$box_get".into(), Value::Builtin(Builtin::BoxGet)),
        ("$box_set".into(), Value::Builtin(Builtin::BoxSet)),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test -p redextape-core --lib interp 2>&1 | tail -20`
Expected: PASS (three box tests + all existing interp tests).

- [ ] **Step 7: fmt, clippy, commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets 2>&1 | tail -5
git add -A && git commit -m "feat(interp): add Value::Box and $box/$box_get/$box_set builtins"
```

---

### Task 3: `lower_asm` — emit box instructions from `$box`/`$box_get`/`$box_set`

**Files:**
- Modify: `crates/redextape-core/src/tm/lower_asm.rs` (`lower_builtin_apply` `lower_asm.rs:201-226`; import list `lower_asm.rs:6`)
- Test: `lower_asm.rs` `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: `Instr::{Box,BoxGet,BoxSet}` (Task 1); the `ctx.fresh_local()`/`ctx.emit()`/`lower_into` helpers; the `Core::Assign` Unit precedent (`lower_asm.rs:306-313`, `Instr::Li(dst, 0)`).
- Produces: `$box`/`$box_get` produce a value into `dst`; `$box_set` does its effect then yields Unit (`Li(dst, 0)`), matching the reference.

- [ ] **Step 1: Write the failing test** (append to `lower_asm.rs` `mod tests`; builds `Core` directly, runs the asm interpreter, and checks against the reference)

```rust
#[test]
fn box_builtins_lower_and_run_on_the_asm_interpreter() {
    use crate::core::{Core, NodeGen};
    use crate::tm::asm::{run_asm, AsmRun, DEFAULT_CAPS};
    // let h = $box(1) in { $box_set(h, 6); $box_get(h) }  ==> reference 6 == asm-interp 6
    let mut g = NodeGen::default();
    let ap = |g: &mut NodeGen, n: &str, a: Vec<Core>| Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), n.into())), a);
    let boxed = ap(&mut g, "$box", vec![Core::Nat(g.fresh(), 1)]);
    let set = ap(&mut g, "$box_set", vec![Core::Var(g.fresh(), "h".into()), Core::Nat(g.fresh(), 6)]);
    let get = ap(&mut g, "$box_get", vec![Core::Var(g.fresh(), "h".into())]);
    let body = Core::Seq(g.fresh(), Box::new(set), Box::new(get));
    let prog = Core::Let { id: g.fresh(), name: "h".into(), mutable: false, value: Box::new(boxed), body: Box::new(body) };
    let expected = crate::interp::eval(&prog).unwrap();
    assert_eq!(expected, crate::value::Value::Nat(6));
    let asm = lower_asm(&prog).expect("box builtins lower");
    match run_asm(&asm, DEFAULT_CAPS) {
        AsmRun::Ran(out) => assert_eq!(out.result, 6),
        other => panic!("asm did not run: {other:?}"),
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::lower_asm::tests::box_builtins 2>&1 | tail -20`
Expected: FAIL — `lower_asm` rejects `$box` as an unknown function.

- [ ] **Step 3: Extend `lower_builtin_apply`** (`lower_asm.rs:201-226`)

Add to the `expected_arity` match:

```rust
    "$box" | "$box_get" => 1,
    "$box_set" => 2,
```

Add to the emit `match name` (note `$box_set` returns Unit — emit the instr then `Li(dst, 0)`, mirroring `Core::Assign`):

```rust
    "$box" => ctx.emit(Instr::Box(dst, regs[0])),
    "$box_get" => ctx.emit(Instr::BoxGet(dst, regs[0])),
    "$box_set" => {
        ctx.emit(Instr::BoxSet(regs[0], regs[1]));
        ctx.emit(Instr::Li(dst, 0)); // $box_set evaluates to unit
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core --lib tm::lower_asm 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: fmt, clippy, commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets 2>&1 | tail -5
git add -A && git commit -m "feat(tm): lower \$box/\$box_get/\$box_set to Box/BoxGet/BoxSet asm"
```

---

### Task 4: The 5th BOX tape — infrastructure

**Files:**
- Modify: `crates/redextape-core/src/tm/build.rs` (`TAPES` `build.rs:10`; add `BOX`)
- Verify (no code change expected, but confirm generic-over-`TAPES`): `machine.rs` (`validate`), `sim.rs` (`simulate`), `syntax.rs` (`print_tm`/`parse_tm`)
- Test: `build.rs` and the existing suite (regression); `syntax.rs` text round-trip

**Interfaces:**
- Produces: `tm::build::BOX: usize = 4`, `tm::build::TAPES: usize = 5`. All `RuleSpec`/init/simulate machinery becomes 5-tape transparently (untouched tapes default to wildcard-read / no-write / `Move::S`).
- Consumes: nothing new.

**Context:** `TAPES` is the single source of truth (`RuleSpec { read/write/moves: [_; TAPES] }`, `Machine.tapes = TAPES`, `vec![_; TAPES]` inits, `validate` checks `rule.len() == self.tapes`). Bumping it to 5 is mechanical; the risk is any place that assumed exactly 4. The `machine.rs` unit tests that build 1-tape machines set `tapes: 1` explicitly and are unaffected.

- [ ] **Step 1: Add the constant and bump `TAPES`** (`build.rs:9-13`)

```rust
pub const TAPES: usize = 5;
pub const REG: usize = 0;
pub const WORK: usize = 1;
pub const STACK: usize = 2;
pub const HEAP: usize = 3;
pub const BOX: usize = 4;
```

- [ ] **Step 2: Run the whole existing suite — nothing may regress**

Run: `cargo test -p redextape-core 2>&1 | tail -25`
Expected: ALL existing tests pass. The BOX tape is present but unused; every existing gadget's `RuleSpec` now covers 5 tapes with the 5th defaulting to no-op. If a text-form round-trip or golden fails, it is because `print_tm`/`parse_tm` encode a per-tape column count — confirm they read `machine.tapes` (not a literal `4`); if a golden pins the tape count or column layout, re-bless it in this step (a deliberate, documented re-capture) and note it in the commit.

- [ ] **Step 3: Add a BOX-tape smoke test** (`build.rs` `mod tests` — proves the new tape simulates)

```rust
#[test]
fn box_tape_exists_and_is_addressable() {
    // A trivial 5-tape machine that writes a MARK on the BOX tape and halts.
    let mut b = Builder::new();
    let halt = b.accept("halt");
    let s0 = b.state("s0");
    b.add_rule(s0, RuleSpec::new().on(BOX, None, Some(MARK), Move::S), halt);
    let m = b.finish(s0);
    assert_eq!(m.tapes, 5);
    assert!(m.validate().is_empty(), "{:?}", m.validate());
    let (tapes, status) = crate::tm::sim::simulate(&m, &vec![Vec::new(); TAPES], crate::tm::sim::DEFAULT_CAPS);
    assert_eq!(status, crate::tm::sim::Status::Halted);
    assert_eq!(tapes[BOX].snapshot().0.first(), Some(&MARK));
}
```

- [ ] **Step 4: Run it**

Run: `cargo test -p redextape-core --lib tm::build 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: fmt, clippy, commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets 2>&1 | tail -5
git add -A && git commit -m "feat(tm): add the fixed-width BOX tape (TAPES 4 -> 5)"
```

---

### Task 5: The three BOX-tape δ-gadgets (`box_op`, `box_get_op`, `box_set_op`)

> This is the δ-authoring task — the one place the TM δ-layer grows. Use the most capable model. The unit tests below are the exact contract; author the rules to satisfy them, mirroring the existing HEAP/REG gadgets.

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (the `Encoding` trait `encoding.rs:18-79`; the `Unary` impl; BOX-tape sub-primitives near the HEAP sub-primitives `encoding.rs:448-595`)
- Test: `encoding.rs` `#[cfg(test)] mod tests` (add a `run_box` harness mirroring `run_heap` `encoding.rs:1262-1273`)

**Interfaces:**
- Produces: `Encoding::box_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rv: Slot, rd: Slot)`, `box_get_op(&self, b, entry, exit, rb: Slot, rd: Slot)`, `box_set_op(&self, b, entry, exit, rb: Slot, rv: Slot)`.
- Consumes: the `Builder`/`RuleSpec` API, `FIELD_WIDTH`, `BOX`/`REG`/`WORK`, `MARK`/`SEP`/`BLANK`, and the existing idioms `copy_field_to_work`, `append_work_to_field`, `rewind_work`, `rewind_home`, `seek_slot`, `heap_count_cells_to_work`/`heap_seek_cell` (as models — the BOX seek is structurally the HEAP seek over `#`-delimited fields).

**BOX tape layout (the spec to implement):** `# <field₁> # <field₂> # …`, where each `<fieldᵢ>` is exactly `FIELD_WIDTH` cells (value's unary marks left-justified, blank-padded) and each field is preceded by a `#` delimiter. A box pointer `p` (1-based, held in a REG slot) addresses the `p`-th field. Between gadgets the BOX head rests at the blank "top" after the last field (empty tape → head at cell 0 over blanks). Home convention for the other tapes (REG on its leading `#`, WORK at leftmost) is preserved by every gadget on exit, exactly like the HEAP gadgets.

Why fixed-width: `box_set` overwrites field `p`'s window in place (blank the `FIELD_WIDTH` cells, rewrite the new marks) — the `#` delimiters never move, so no shifting and no interaction with the HEAP or list decode. The BOX tape has no decode parser (boxes are never a final result — confirmed: `decode_word` only dereferences the HEAP via `Value::Cons`), so interior padding blanks are free here (unlike the HEAP).

- [ ] **Step 1: Add a `run_box` test harness + the failing gadget tests** (`encoding.rs` `mod tests`)

```rust
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
        Unary.box_op(b, e, mid, 0, 1);       // box(slot0=3) -> slot1
        // reload slot0 = 4, then box again -> slot2
        let after = b.state("after");
        Unary.write_literal(b, mid, after, 4, 0);
        Unary.box_op(b, after, x, 0, 2);     // box(slot0=4) -> slot2
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
        Unary.box_op(b, e, s1, 0, 2);           // slot2 = box(slot0=5)
        let s2 = b.state("s2");
        Unary.box_set_op(b, s1, s2, 2, 1);       // *slot2 = slot1 (9)
        Unary.box_get_op(b, s2, x, 2, 3);        // slot3 = box_get(slot2) = 9
    });
    assert_eq!(Unary.decode_nat(&reg, 3), Some(9));
}

#[test]
fn two_boxes_are_independent_cells() {
    // a = box(3) ; b = box(4) ; box_set(a, 7) ; box_get(b) == 4
    let (_bt, reg) = run_box(6, &[(3, 0), (4, 1), (7, 2)], |b, e, x| {
        let s1 = b.state("s1");
        Unary.box_op(b, e, s1, 0, 3);           // slot3 = box(3) -> ptr 1
        let s2 = b.state("s2");
        Unary.box_op(b, s1, s2, 1, 4);           // slot4 = box(4) -> ptr 2
        let s3 = b.state("s3");
        Unary.box_set_op(b, s2, s3, 3, 2);       // *slot3 = 7
        Unary.box_get_op(b, s3, x, 4, 5);        // slot5 = box_get(slot4) = 4
    });
    assert_eq!(Unary.decode_nat(&reg, 5), Some(4));
}
```

Add end-to-end fault tests in `lower_tm.rs` (Task 6) rather than here, since a null-handle fault surfaces as a spin/HitCap only through the whole-program lowering (mirroring `head_tail_faults_spin_to_a_cap`).

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::encoding::tests::box 2>&1 | tail -20`
Expected: compile error (no `box_op` trait method).

- [ ] **Step 3: Add the three trait methods to `Encoding`** (`encoding.rs:18-79`)

```rust
    fn box_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rv: Slot, rd: Slot);
    fn box_get_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rb: Slot, rd: Slot);
    fn box_set_op(&self, b: &mut Builder, entry: StateId, exit: StateId, rb: Slot, rv: Slot);
```

- [ ] **Step 4: Implement the `Unary` gadgets + BOX sub-primitives**

Author these mirroring the existing gadgets (each composes sub-primitives entry→exit, uniquifying state labels with `entry`):

- **`box_op`** (allocate): (1) `copy_field_to_work(REG rv → WORK)`; (2) a new `box_append_field` sub-primitive: from the BOX top, write `#` then `FIELD_WIDTH` cells (one MARK per WORK mark, then blank-pad to `FIELD_WIDTH`), leaving the head at the new top — this is `heap_open_cell_with_work` crossed with the fixed-width padding loop of `write_literal`; (3) a `box_count_fields_to_work` sub-primitive (walk BOX left-to-right counting `#`, like `heap_count_cells_to_work`) → the 1-based pointer into WORK; (4) `append_work_to_field(WORK → REG rd)`; (5) `rewind_work`.
- **`box_get_op`** (read): (1) `copy_field_to_work(REG rb → WORK)` (the counter); (2) a new `box_seek_field` sub-primitive (walk BOX from origin rightward, decrementing the WORK counter once per `#` until it drains, landing on the target field's first cell — structurally `heap_seek_cell` over fixed-width fields; a counter that drains to a missing field takes a `missing` exit that leads to the same rule-less `fault` spin the HEAP deref uses); (3) a `box_read_field_to_work` sub-primitive (read the `FIELD_WIDTH` window's marks into WORK, stopping at the field's trailing `#`); (4) `append_work_to_field(WORK → REG rd)`; (5) rewind BOX to top + `rewind_work`.
- **`box_set_op`** (in-place overwrite): (1) `copy_field_to_work(REG rb → WORK)` (counter); (2) `box_seek_field` to the target field; (3) reuse the counter slot: after seeking, `clear_work` then `copy_field_to_work(REG rv → WORK)` (the new value); (4) a new `box_overwrite_field` sub-primitive that blanks the `FIELD_WIDTH` window and writes one MARK per WORK mark **in place** (this is `append_work_to_field`'s blank-window-then-write loop, but positioned at the located BOX field instead of a static REG slot, and bounded by the trailing `#` instead of a REG `#`); (5) rewind BOX to top + `rewind_work`.

Reuse the null/dangling `fault` state exactly as `head_op`/`tail_op` do (a rule-less non-accept state that spins → `HitCap` under a cap; the reference faults, λ diverges — the shared "no value" outcome). Route `box_seek_field`'s `missing` exit (counter never drains, or drains onto a blank/top instead of a field) and the `rb == 0` case (counter starts at 0 → immediately "missing") to it.

- [ ] **Step 5: Run the gadget tests**

Run: `cargo test -p redextape-core --lib tm::encoding 2>&1 | tail -25`
Expected: PASS (the box gadget tests + all existing encoding tests). Iterate the rules against the tests until green (the standard gadget-authoring loop; behavioral simulation — not `validate` — is what catches first-match-ordering bugs).

- [ ] **Step 6: fmt, clippy, commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets 2>&1 | tail -5
git add -A && git commit -m "feat(tm): box_op/box_get_op/box_set_op gadgets on the BOX tape"
```

---

### Task 6: `lower_tm` — dispatch box instructions to the gadgets

**Files:**
- Modify: `crates/redextape-core/src/tm/lower_tm.rs` (the instr dispatch `lower_tm.rs:160-195`; `instr_regs` `lower_tm.rs:74-81`)
- Test: `lower_tm.rs` `mod tests` (whole-program box, via `run_tm`) + a fault-spins test

**Interfaces:**
- Consumes: `Encoding::{box_op,box_get_op,box_set_op}` (Task 5); `Instr::{Box,BoxGet,BoxSet}` (Task 1); `sm.slot`, `pc`, `fall`.
- Produces: end-to-end `reference == TM` for box programs; `run_tm` handles box instrs.

- [ ] **Step 1: Write the failing tests** (append to `lower_tm.rs` `mod tests`; and a `run_tm`-level test in `tm.rs`'s `run_tm_tests` module or here — use the `tm_value`-style helper that builds `Core` directly)

```rust
#[test]
fn box_program_runs_end_to_end_on_the_tm() {
    use crate::core::{Core, NodeGen};
    use crate::tm::{run_tm, TmRun, Unary, TM_DEFAULT_CAPS, decode_tape};
    // let h = $box(1) in { $box_set(h, 6); $box_get(h) } ==> 6 on the TM
    let mut g = NodeGen::default();
    let ap = |g: &mut NodeGen, n: &str, a: Vec<Core>| Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), n.into())), a);
    let boxed = ap(&mut g, "$box", vec![Core::Nat(g.fresh(), 1)]);
    let set = ap(&mut g, "$box_set", vec![Core::Var(g.fresh(), "h".into()), Core::Nat(g.fresh(), 6)]);
    let get = ap(&mut g, "$box_get", vec![Core::Var(g.fresh(), "h".into())]);
    let body = Core::Seq(g.fresh(), Box::new(set), Box::new(get));
    let prog = Core::Let { id: g.fresh(), name: "h".into(), mutable: false, value: Box::new(boxed), body: Box::new(body) };
    let expected = crate::interp::eval(&prog).unwrap();
    assert_eq!(expected, crate::value::Value::Nat(6));
    match run_tm(&prog, &Unary, TM_DEFAULT_CAPS) {
        TmRun::Ran { tapes } => assert_eq!(decode_tape(&tapes, &expected, &Unary), Some(expected)),
        other => panic!("box program did not run on TM: {other:?}"),
    }
}

#[test]
fn box_get_of_null_handle_spins_to_a_cap() {
    use crate::core::{Core, NodeGen};
    use crate::tm::{run_tm, TmRun, TmCaps, Unary};
    // $box_get(0) — a null handle. Mirrors head_tail_faults_spin_to_a_cap.
    let mut g = NodeGen::default();
    let get = Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), "$box_get".into())), vec![Core::Nat(g.fresh(), 0)]);
    assert!(matches!(run_tm(&get, &Unary, TmCaps { steps: 50_000, cells: 50_000 }), TmRun::HitCap));
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::lower_tm::tests::box 2>&1 | tail -20`
Expected: compile error — the instr `match` and `instr_regs` are non-exhaustive without box arms.

- [ ] **Step 3: Add the dispatch arms** (`lower_tm.rs:160-195`)

```rust
Instr::Box(rd, rv) => enc.box_op(&mut b, pc[i], fall, sm.slot(*rv), sm.slot(*rd)),
Instr::BoxGet(rd, rb) => enc.box_get_op(&mut b, pc[i], fall, sm.slot(*rb), sm.slot(*rd)),
Instr::BoxSet(rb, rv) => enc.box_set_op(&mut b, pc[i], fall, sm.slot(*rb), sm.slot(*rv)),
```

- [ ] **Step 4: Add `instr_regs` arms** (`lower_tm.rs:74-81` — sizes the REG bank; every `Instr` must appear)

```rust
Instr::Box(a, b) | Instr::BoxGet(a, b) | Instr::BoxSet(a, b) => vec![*a, *b],
```

(Fold into the 2-register arm with `Mov`/`Head`/`Tail`/`IsEmpty`.)

- [ ] **Step 5: Run to verify they pass**

Run: `cargo test -p redextape-core --lib tm::lower_tm 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: fmt, clippy, commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets 2>&1 | tail -5
git add -A && git commit -m "feat(tm): dispatch Box/BoxGet/BoxSet to BOX-tape gadgets in lower_tm"
```

---

### Task 7: `defunc` — box captured mutables instead of rejecting

> The transform task. Use the most capable model. Preserve totality (Global Constraints).

**Files:**
- Modify: `crates/redextape-core/src/tm/defunc.rs` (`BUILTIN_FNS` `defunc.rs:50`; the `Rewriter` struct `defunc.rs:350-359`; `rewrite` arms `defunc.rs:362-396`; `rewrite_value_name` `defunc.rs:398-418`; the `Assign` and `Let` arms; `rewrite_lambda_value` `defunc.rs:434-482`; add helper builders near `cons`/`head1` `defunc.rs:793-829`; update the mutable-capture unit tests `defunc.rs:1018-1077`)
- Test: `defunc.rs` `mod tests`

**Interfaces:**
- Consumes: `collect_mutable_names` (`defunc.rs:773-789`), `free_vars` (`defunc.rs:760-765`), `NodeGen`, the capture-env build (`build_env` `defunc.rs:822-829`), the dispatcher arm-unpack (`defunc.rs:560-591`), Task 2's `reference` box builtins, Task 3/5/6's TM box path.
- Produces: `defunc(P)` boxes each captured mutable; output is first-order Core; `reference(P) == reference(defunc(P))`.

**The transform (precise rules):**
1. **Add `$box`/`$box_get`/`$box_set` to `BUILTIN_FNS`** so `is_builtin_fn` keeps them as static direct-call callees (never value-uses).
2. **Compute `boxed_names` once, up front** (iterative, totality-safe): `boxed_names = collect_mutable_names(core) ∩ (⋃ over every `Core::Lambda(_, params, body)` node of `free_vars(body) \ params`)`. A mutable that some lambda captures is boxed; every other mutable is untouched (so purely imperative mutables never change). Assign each boxed name a stable, uncollidable handle name `$boxh{k}` (k a running index; store the map `box_handle: BTreeMap<String, String>`), so all sites for the same mutable resolve to the same handle. Store `boxed_names` + `box_handle` on the `Rewriter`.
3. **`rewrite` `Let { name: n, mutable: true, value, body }` where `n ∈ boxed_names`** → emit `Core::Let { name: box_handle(n), mutable: false, value: $box(rewrite(value)), body: rewrite(body) }`. (The handle is immutable; `n` disappears. `body` is rewritten with `n` still in `boxed_names`, so reads/writes below resolve to box ops.)
4. **`rewrite` `Var(n)` where `n ∈ boxed_names`** → `$box_get(Var(box_handle(n)))`.
5. **`rewrite` `Assign(n, v)` where `n ∈ boxed_names`** → `$box_set(Var(box_handle(n)), rewrite(v))` (which, like `Assign`, evaluates to unit — semantics preserved).
6. **`rewrite_lambda_value` capture**: a captured free var `c ∈ boxed_names` contributes `box_handle(c)` (not `c`) to the closure's `captures` list; `box_handle(c)` is an immutable local in scope at the creation site, so `build_env` (`Var(box_handle(c))`) and the arm-unpack (`let box_handle(c) = head(tail^i($env))`, immutable) both work unchanged. The arm body (rewritten by rule 4/5) reads `c` via `$box_get(box_handle(c))`. **Because a box handle is immutable, no closure captures a mutable — the mutable-capture rejection at `defunc.rs:434-448` is removed.** Keep a defensive guard: if a captured `c ∈ mutable_names` but `c ∉ boxed_names` (an invariant violation — should be impossible since `boxed_names ⊇ captured mutables), degrade to `LowerError::Unsupported`, never miscompile.
7. **Helper builders** near `cons`/`head1` (`defunc.rs:793-829`):

```rust
fn box1(g: &mut NodeGen, init: Core) -> Core { let f = var(g, "$box"); apply(g, f, vec![init]) }
fn box_get1(g: &mut NodeGen, h: Core) -> Core { let f = var(g, "$box_get"); apply(g, f, vec![h]) }
fn box_set2(g: &mut NodeGen, h: Core, v: Core) -> Core { let f = var(g, "$box_set"); apply(g, f, vec![h, v]) }
```

- [ ] **Step 1: Write the failing tests** (append to `defunc.rs` `mod tests`)

```rust
/// The headline: a value-used closure captures a mutable; a later assignment is observed
/// (by-reference). `defunc` must preserve the reference's value.
#[test]
fn boxed_mutable_capture_is_semantics_preserving() {
    let src = "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)";
    let (prog, ds) = parse(src);
    assert!(ds.is_empty());
    let core = desugar(&prog.unwrap());
    let reference = crate::interp::eval(&core).unwrap();
    assert_eq!(reference, crate::value::Value::Nat(10)); // by-reference: 0 + 10
    let d = defunc(&core).expect("boxing lowers");
    assert_eq!(crate::interp::eval(&d).unwrap(), reference); // reference(P) == reference(defunc(P))
}

/// The defunc'd program is first-order: no Lambda survives in value position, and no closure
/// captures a mutable (every capture is a $boxh handle, bound immutably).
#[test]
fn boxed_capture_output_is_first_order_and_captures_no_mutable() {
    let src = "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)";
    let core = desugar(&parse(src).0.unwrap());
    let d = defunc(&core).expect("lowers");
    // It lowers first-order (the ultimate structural check) and runs on the TM.
    assert!(crate::tm::lower_asm(&d).is_ok(), "defunc'd boxing program must be first-order");
}

/// A purely imperative mutable (never captured by any lambda) is NOT boxed — no regression.
#[test]
fn uncaptured_mutable_is_not_boxed() {
    let src = "let mut n = 3; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc";
    let core = desugar(&parse(src).0.unwrap());
    // defunc is only invoked on higher-order fallback; here lower_asm already handles it directly,
    // but defunc must still be identity-preserving if called: reference matches.
    let reference = crate::interp::eval(&core).unwrap();
    if let Ok(d) = defunc(&core) {
        assert_eq!(crate::interp::eval(&d).unwrap(), reference);
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::defunc::tests::boxed 2>&1 | tail -20`
Expected: FAIL — the capture is currently rejected `Unsupported`.

- [ ] **Step 3: Implement the transform** (rules 1-7 above). Update the existing `capturing_a_mutable_is_unsupported` test (`defunc.rs:1018-1028`): a mutable captured by a **value-used** lambda now boxes and runs, so rewrite that test to assert successful boxing (or narrow it to the case that stays Unsupported — a mutable captured by a **name-called** lambda referencing an outer scope, which still hits the closed-subroutine boundary; see the `unsupported_boundary` cases `defunc.rs:1035-1077` and keep genuinely-Unsupported ones).

- [ ] **Step 4: Run to verify they pass, then the whole defunc + oracle suite**

Run: `cargo test -p redextape-core --lib tm::defunc 2>&1 | tail -20 && cargo test -p redextape-core 2>&1 | tail -15`
Expected: PASS. The full suite stays green (no existing three-way demo regresses).

- [ ] **Step 5: fmt, clippy, commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets 2>&1 | tail -5
git add -A && git commit -m "feat(tm): defunc boxes captured mutables (two-way mutable capture)"
```

---

### Task 8: The two-way oracle demos, the `tm_demo` row, and goldens

**Files:**
- Modify: `crates/redextape-core/tests/three_way_oracle.rs` (`LAMBDA_LIMITATION_DEMOS` `three_way_oracle.rs:125-128`)
- Modify: `crates/redextape-core/examples/tm_demo.rs` (section 3)
- Test: the oracle harness (`assert_tm_only`), the example runs

**Interfaces:**
- Consumes: `assert_tm_only` (`three_way_oracle.rs:55-70`) — requires λ `LowerError` AND `reference == TM`. Mutable-capture-by-value-used-closure fits exactly: λ rejects mutable-in-closure, the reference runs it (by-reference), and the TM runs it (boxed).

- [ ] **Step 1: Add the mutable-capture demos to `LAMBDA_LIMITATION_DEMOS`**

```rust
    // Plan 3b-2: a value-used closure captures a MUTABLE, observed by-reference. λ rejects
    // mutable-in-closure; the reference and the boxed TM agree (assert_tm_only).
    "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)",
    "let mut c = 0; fn twice(g) { g(0); g(0); } let bump = |x| { c = c + 1; c }; twice(bump); c",
```

(For the second demo: confirm the reference value first with a scratch `cargo run`/test; adjust the demo so it's a clean small value `< FIELD_WIDTH`, and only keep it if it lowers on the TM — if a `Seq`/effectful-closure shape is out of scope for the boxing rewrite, drop it and keep the first, airtight demo.)

- [ ] **Step 2: Run the oracle**

Run: `cargo test -p redextape-core --test three_way_oracle 2>&1 | tail -20`
Expected: PASS — `latent_traps_agree_reference_and_tm_while_lambda_refuses` covers the new demos.

- [ ] **Step 3: Add a mutable-capture row to `tm_demo.rs` section 3** (the "reference == TM two-way" table already exists there) — add `"let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)"` to the section-3 loop, so the runnable demo shows boxing working.

- [ ] **Step 4: Run the example + the whole suite**

Run: `cargo run --example tm_demo -p redextape-core 2>&1 | tail -30 && cargo test -p redextape-core 2>&1 | tail -12`
Expected: the new section-3 row shows `✓ agree (λ: refuses to lower)`, result `10`; the full suite is green.

- [ ] **Step 5: fmt, clippy, commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets 2>&1 | tail -5
git add -A && git commit -m "test(tm): two-way mutable-capture demos + tm_demo row"
```

---

## Final Whole-Branch Review

After Task 8, dispatch the broad whole-branch review (most capable model). Focus areas specific to this branch:
- **The box-set in-place gadget** — the one genuinely new δ-capability. Probe: does a second `box_set` after a `box_get` keep the field fixed-width (no drift of the `#` delimiters)? Does a box holding the max value (`FIELD_WIDTH - 1`) round-trip? Does the BOX seek fault (spin) on `p == 0` and on `p > field count`?
- **The `boxed_names` set** — is it airtight that no captured mutable escapes boxing (which would resurface the old rejection or, worse, a by-value snapshot that diverges from the reference)? Adversarially probe a mutable captured by two different lambdas, and a mutable both captured and used imperatively.
- **Totality** — grep `defunc.rs` for any new `unwrap`/`expect`/`panic`/`[` index/`-` on the box paths.
- **No regression** — the full three-way suite, the goldens (re-blessed step counts if any gadget changed existing ones — the box path should not), and the TM text round-trip over 5-tape machines.

## Self-Review (completed)

- **Spec coverage:** asm ops (T1), reference box (T2), lower_asm (T3), BOX tape (T4), gadgets (T5), lower_tm (T6), defunc boxing (T7), two-way oracle (T8) — every element of the design spec's 3b-2 section is covered; the spec's "one δ-gadget on the HEAP" is refined (per user decision 2026-07-23) to a fixed-width 5th BOX tape with three gadgets, because the HEAP is variable-width and cannot overwrite in place without shifting.
- **Type consistency:** `Instr::{Box,BoxGet,BoxSet}(Reg,Reg)`, `Value::Box(Rc<RefCell<Value>>)`, `Builtin::{Box,BoxGet,BoxSet}`, `BOX=4`/`TAPES=5`, `Encoding::{box_op,box_get_op,box_set_op}` are used identically across tasks; the synthetic Core names `$box`/`$box_get`/`$box_set` and handles `$boxh{k}` match between defunc (emit), lower_asm (consume), and interp/prelude (evaluate).
- **Placeholder scan:** the gadget rule sequences (T5) are specified as sub-primitive compositions with the exact existing gadgets to mirror and an exhaustive unit-test contract — the honest maximum precision for TM δ-authoring (the codebase's own gadgets were built this way), not a placeholder.
