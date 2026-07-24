# Native Backend Phase 3 — AOT (a real runnable binary) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit a real linkable `.o` from a mini-language program and (best-effort) link it into a standalone native executable that runs the program and prints its result, as an additive path alongside the existing JIT.

**Architecture:** Reuse the JIT's asm→CLIF codegen verbatim by making it generic over `cranelift_module::Module` (both `JITModule` and `ObjectModule` implement it). Split the runtime into a new no-Cranelift crate (`redextape-native-rt`) usable both as an rlib (JIT host symbols) and a staticlib (linked into the AOT binary). The emitted `main` just calls a reused Rust driver `rt_run`, which repackages the existing JIT run-tail plus decode + print + exit code.

**Tech Stack:** Rust (edition 2024), Cranelift 0.134 (`cranelift-jit`, `cranelift-module`, `cranelift-frontend`, `cranelift-codegen`, and newly `cranelift-object`, `cranelift-native`), the `object` crate (re-exported by `cranelift-object`), `cc` as the link driver.

**Design spec:** `docs/superpowers/specs/2026-07-23-native-aot-phase3-design.md` (read it for rationale).

## Global Constraints

- **No git attribution.** Never add `Co-Authored-By: Claude`, `Generated with Claude Code`, or any similar trailer to commit messages.
- **`redextape-core` stays WASM-clean.** No Cranelift/`cc`/native-codegen dependency may enter `redextape-core`'s dependency tree. New core code (Task 1) is pure Rust.
- **`redextape-native-rt` carries no Cranelift dependency.** It depends only on `redextape-core`. It must be linkable into a standalone binary.
- **Totality (cardinal rule).** No input may crash any process. The AOT binary reuses the JIT's frame-size-aware depth cap + big-stack thread so deep recursion → `HitCap` exit, never a stack-overflow abort; faults → a `fault:` message + nonzero exit; all emit/link paths return `Result`, never panic.
- **Cranelift version lockstep.** All `cranelift-*` deps stay at `0.134` (the version the workspace already pins). `cranelift-object` and `cranelift-native` join at `0.134`.
- **JIT behavior is preserved.** The refactor tasks (2, 3) must not change any observable JIT behavior; the full pre-existing test suite stays green after each.
- **Feature gating.** AOT codegen lives behind the existing `cranelift` feature (it needs Cranelift). Without `cranelift`, `emit_object`/`link_executable` compile to a `LowerError`/`AotError::Unsupported` stub, exactly as `run_native` already does.
- **Exit-code taxonomy** (the AOT binary → shell/oracle): `0` = value printed, `2` = fault, `3` = cap hit, `4` = internal/decode failure.

---

## File Structure

- `crates/redextape-core/src/typeck.rs` — **modify**: add `pub fn result_type`.
- `crates/redextape-core/src/tm/asm.rs` — **modify**: add `pub fn decode_asm_ty`.
- `crates/redextape-core/src/value.rs` — **modify**: add `pub fn format_value`.
- `crates/redextape-native-rt/` — **create**: the linkable runtime crate (`Runtime` + `rt_*` moved here with `#[unsafe(no_mangle)]`, plus `rt_run`, `rt_print_result`, CONFIG (de)serialization).
- `crates/redextape-native/src/runtime.rs` — **delete** (moved to the rt crate); `redextape-native` re-imports from `redextape_native_rt`.
- `crates/redextape-native/src/cranelift_backend.rs` — **split** into `codegen.rs` (Module-generic shared codegen) + `jit.rs` (the JIT driver).
- `crates/redextape-native/src/aot.rs` — **create**: `emit_object`, `link_executable`, `LinkOptions`, `AotError`, CONFIG emission.
- `crates/redextape-native/src/lib.rs` — **modify**: wire up modules + AOT public API + no-`cranelift` stubs.
- `crates/redextape-native/examples/aot_demo.rs` — **create**.
- `crates/redextape-native/tests/aot_oracle.rs` — **create**: the bounded end-to-end AOT leg (B1).
- `Cargo.toml` (workspace) — **modify**: add `crates/redextape-native-rt` to members.

---

### Task 1: Core additions — `result_type`, `decode_asm_ty`, `format_value`

Pure, WASM-clean, unit-tested. These give the standalone binary its type-directed decode + printing without a reference run.

**Files:**
- Modify: `crates/redextape-core/src/typeck.rs`
- Modify: `crates/redextape-core/src/tm/asm.rs`
- Modify: `crates/redextape-core/src/value.rs`

**Interfaces:**
- Produces:
  - `redextape_core::typeck::result_type(program: &ast::Program) -> Result<Ty, Vec<Diagnostic>>`
  - `redextape_core::tm::decode_asm_ty(outcome: &AsmOutcome, ty: &Ty) -> Option<Value>` (re-exported from `tm::asm`)
  - `redextape_core::value::format_value(v: &Value) -> String`
- Consumes: existing `Ty` (`crate::ty::Ty`), `Value` (`crate::value::Value`), `AsmOutcome` (`crate::tm::asm::AsmOutcome`), the private `Infer` in `typeck.rs`.

- [ ] **Step 1: Write the failing test for `result_type`** (append to `typeck.rs`'s `#[cfg(test)] mod tests`, or add one):

```rust
#[test]
fn result_type_infers_top_level() {
    use crate::parser::parse;
    let ty = |src: &str| super::result_type(&parse(src).0.unwrap());
    assert_eq!(ty("1 + 2"), Ok(Ty::Nat));
    assert_eq!(ty("2 > 1"), Ok(Ty::Bool));
    assert_eq!(ty("[1, 2, 3]"), Ok(Ty::List(Box::new(Ty::Nat))));
    assert!(ty("head(nil)").is_ok()); // nil-typed head is polymorphic but well-typed
    assert!(ty("1 + true").is_err()); // ill-typed → diagnostics
}
```

- [ ] **Step 2: Run it, expect failure** (`result_type` undefined):

Run: `cargo test -p redextape-core result_type_infers_top_level`
Expected: FAIL to compile — `result_type` not found.

- [ ] **Step 3: Implement `result_type`** in `typeck.rs` (same module → can use the private `Infer`). Mirror `typecheck`'s setup, but keep and resolve the inferred top-level type:

```rust
/// Infer the program's top-level result type (the value `run` would produce), fully resolved.
/// `Err` carries the type errors when the program is ill-typed. Used by the AOT backend to decode
/// and print a standalone binary's result without a reference run.
pub fn result_type(program: &Program) -> Result<Ty, Vec<Diagnostic>> {
    let mut inf = Infer::new();
    let mut env = TyEnv::new();
    for (name, scheme) in type_env() {
        env.insert(name, scheme, false);
    }
    let ty = inf.infer_block(&env, &program.block);
    if inf.diags.iter().any(|d| d.severity == crate::diagnostic::Severity::Error) {
        return Err(inf.diags);
    }
    Ok(inf.resolve(&ty))
}
```

- [ ] **Step 4: Run it, expect pass:**

Run: `cargo test -p redextape-core result_type_infers_top_level`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `decode_asm_ty`** (in `asm.rs` tests):

```rust
#[test]
fn decode_asm_ty_matches_decode_asm() {
    use crate::ty::Ty;
    // Nat, Bool, and a list [1,2] via the heap; agree with the Value-directed decoder.
    let nat = AsmOutcome { result: 5, heap: vec![] };
    assert_eq!(decode_asm_ty(&nat, &Ty::Nat), Some(Value::Nat(5)));
    let b = AsmOutcome { result: 1, heap: vec![] };
    assert_eq!(decode_asm_ty(&b, &Ty::Bool), Some(Value::Bool(true)));
    let bad = AsmOutcome { result: 7, heap: vec![] };
    assert_eq!(decode_asm_ty(&bad, &Ty::Bool), None); // Bool word > 1 invalid
    let list = AsmOutcome { result: 2, heap: vec![(2, 0), (1, 1)] }; // cons(1, cons(2, nil))
    assert_eq!(
        decode_asm_ty(&list, &Ty::List(Box::new(Ty::Nat))),
        Some(Value::list_of_nats(&[1, 2]))
    );
    let nil = AsmOutcome { result: 0, heap: vec![] };
    assert_eq!(decode_asm_ty(&nil, &Ty::List(Box::new(Ty::Nat))), Some(Value::Nil));
}
```

- [ ] **Step 6: Run it, expect failure.**

Run: `cargo test -p redextape-core decode_asm_ty_matches_decode_asm`
Expected: FAIL — `decode_asm_ty` not found.

- [ ] **Step 7: Implement `decode_asm_ty`** in `asm.rs`, a `Ty`-directed sibling of `decode_word`. It follows the heap chain itself (the heap self-describes list length; no expected structure needed):

```rust
use crate::ty::Ty;

/// Type-directed decode of a run's outcome to a `Value` (the AOT sibling of `decode_asm`, which is
/// value-directed). Drives off the static `Ty` instead of a reference `Value`, so the standalone
/// binary can decode without a reference run. Returns `None` on a representation mismatch or a
/// non-value type (`Fun`/`Var`).
pub fn decode_asm_ty(outcome: &AsmOutcome, ty: &Ty) -> Option<Value> {
    decode_word_ty(outcome.result, &outcome.heap, ty)
}

fn decode_word_ty(word: u64, heap: &[(u64, u64)], ty: &Ty) -> Option<Value> {
    match ty {
        Ty::Nat => Some(Value::Nat(word)),
        Ty::Bool => match word {
            0 => Some(Value::Bool(false)),
            1 => Some(Value::Bool(true)),
            _ => None,
        },
        Ty::Unit => Some(Value::Unit),
        Ty::List(elem) => {
            // Follow the 1-based pointer chain: 0 = nil, else cell p-1 = (head, tail-ptr).
            if word == 0 {
                return Some(Value::Nil);
            }
            let &(h, t) = heap.get((word - 1) as usize)?;
            let head = decode_word_ty(h, heap, elem)?;
            let tail = decode_word_ty(t, heap, ty)?; // tail has the same list type
            Some(Value::Cons(Rc::new(head), Rc::new(tail)))
        }
        Ty::Fun(..) | Ty::Var(_) => None,
    }
}
```

Then **re-export it from the `tm` module** so it is reachable as `redextape_core::tm::decode_asm_ty` (matching `decode_asm`): in `crates/redextape-core/src/tm.rs` line 18, add `decode_asm_ty` to the `pub use asm::{..., decode_asm, ...}` list.

(Note: a `Ty::Var` top-level result — e.g. `head(nil)` at `Ty::Var` element — is a well-typed but non-concrete result; `decode_word_ty` returns `None`, and the AOT driver treats `None` as an exit-`4` internal/decode failure. This is fine: such programs are edge cases, and the JIT oracle already covers concrete-typed programs. If a `Ty::List(Var)` arises from an empty list, `word == 0` short-circuits to `Nil` before reaching the `Var`, so `[]`-typed results still decode.)

- [ ] **Step 8: Run it, expect pass.**

Run: `cargo test -p redextape-core decode_asm_ty`
Expected: PASS.

- [ ] **Step 9: Write the failing test for `format_value`** (in `value.rs` tests — add a `#[cfg(test)] mod` if none):

```rust
#[test]
fn format_value_canonical_forms() {
    use super::format_value;
    assert_eq!(format_value(&Value::Nat(5050)), "5050");
    assert_eq!(format_value(&Value::Bool(true)), "true");
    assert_eq!(format_value(&Value::Bool(false)), "false");
    assert_eq!(format_value(&Value::Nil), "[]");
    assert_eq!(format_value(&Value::list_of_nats(&[1, 2, 3])), "[1, 2, 3]");
    assert_eq!(format_value(&Value::Unit), "()");
}
```

- [ ] **Step 10: Run it, expect failure.**

Run: `cargo test -p redextape-core format_value_canonical_forms`
Expected: FAIL — `format_value` not found.

- [ ] **Step 11: Implement `format_value`** in `value.rs`. One canonical textual form, shared by the AOT runtime (to print) and the oracle (to compute the expected string):

```rust
/// Canonical textual form of a decoded value, shared by the AOT runtime (which prints it) and the
/// oracle (which compares it to the binary's stdout). Lists render `[a, b, c]`; `Nat`/`Bool` render
/// plainly; `Unit` renders `()`. Non-value variants (closures/builtins/boxes) never reach here as a
/// top-level result, but render a stable placeholder to keep this total.
pub fn format_value(v: &Value) -> String {
    match v {
        Value::Nat(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Unit => "()".to_string(),
        Value::Nil => "[]".to_string(),
        Value::Cons(_, _) => {
            let mut out = String::from("[");
            let mut cur = v.clone();
            let mut first = true;
            while let Value::Cons(h, t) = cur {
                if !first {
                    out.push_str(", ");
                }
                first = false;
                out.push_str(&format_value(&h));
                cur = (*t).clone();
            }
            out.push(']');
            out
        }
        Value::Closure { .. } | Value::Builtin(_) | Value::Box(_) => "<non-value>".to_string(),
    }
}
```

(The list loop is iterative — a runtime list can be millions of cells deep; recursion would risk a stack overflow, matching the codebase's iterative-`Drop` discipline.)

- [ ] **Step 12: Run it, expect pass; then the whole core suite + clippy/fmt.**

Run: `cargo test -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS, clean.

- [ ] **Step 13: Commit.**

```bash
git add crates/redextape-core/src/typeck.rs crates/redextape-core/src/tm/asm.rs crates/redextape-core/src/value.rs
git commit -m "feat(core): result_type, decode_asm_ty, format_value for the AOT backend"
```

---

### Task 2: Split the runtime into `redextape-native-rt` (rlib + staticlib)

Move `Runtime` + the `rt_*` host functions into a new no-Cranelift crate so they can be **linked** into a standalone binary, and add `#[unsafe(no_mangle)]` so the AOT object's `rt_*` imports resolve. The JIT re-imports them; behavior is unchanged.

**Files:**
- Create: `crates/redextape-native-rt/Cargo.toml`
- Create: `crates/redextape-native-rt/src/lib.rs` (the moved `Runtime` + `rt_*`)
- Delete: `crates/redextape-native/src/runtime.rs`
- Modify: `crates/redextape-native/Cargo.toml` (add the rt dependency)
- Modify: `crates/redextape-native/src/lib.rs` (drop `pub mod runtime;`)
- Modify: `crates/redextape-native/src/cranelift_backend.rs` (import `rt_*` from `redextape_native_rt`)
- Modify: `Cargo.toml` (workspace members)

**Interfaces:**
- Produces: `redextape_native_rt::{Runtime, rt_cons, rt_head, rt_tail, rt_is_empty, rt_box, rt_box_get, rt_box_set, rt_tick, rt_enter, rt_leave, rt_faulted}` with the **same signatures** as today (`unsafe extern "C" fn(*mut Runtime, ...) -> ...`), each now `#[unsafe(no_mangle)]`; `Runtime::{new, with_depth_cap, into_outcome}` unchanged.
- Consumes: `redextape_core::tm::{AsmOutcome, Caps}`.

- [ ] **Step 1: Create the crate manifest** `crates/redextape-native-rt/Cargo.toml`:

```toml
[package]
name = "redextape-native-rt"
version = "0.0.0"
edition = "2024"
license = "GPL-3.0-only"

[lib]
# rlib: the JIT registers these fn pointers in-process. staticlib: the AOT binary links against
# libredextape_native_rt.a to resolve its rt_* imports.
crate-type = ["rlib", "staticlib"]

[dependencies]
redextape-core = { path = "../redextape-core" }

[lints]
workspace = true
```

- [ ] **Step 2: Add the crate to the workspace** in the root `Cargo.toml`:

```toml
members = ["crates/redextape-core", "crates/redextape-native", "crates/redextape-native-rt"]
```

- [ ] **Step 3: Move `runtime.rs` verbatim into `redextape-native-rt/src/lib.rs`**, then add `#[unsafe(no_mangle)]` to **every** `rt_*` function. Change the module doc header to describe the crate. The `#[unsafe(no_mangle)]` attribute is REQUIRED (edition 2024 spelling) so the staticlib exports linker symbols literally named `rt_cons`, `rt_head`, … — without it the symbols are mangled and the AOT object's imports won't resolve at link time. Example for one (apply to all eleven):

```rust
/// # Safety
/// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_cons(rt: *mut Runtime, h: u64, t: u64) -> u64 {
    // ... body unchanged ...
}
```

Keep the `#[cfg(test)] mod tests` block (it moves with the file and still passes). No logic changes.

- [ ] **Step 4: Delete `crates/redextape-native/src/runtime.rs`** and remove `pub mod runtime;` from `crates/redextape-native/src/lib.rs`.

- [ ] **Step 5: Add the dependency** to `crates/redextape-native/Cargo.toml` under `[dependencies]`:

```toml
redextape-native-rt = { path = "../redextape-native-rt" }
```

- [ ] **Step 6: Re-point the JIT's imports.** In `crates/redextape-native/src/cranelift_backend.rs`, change the `use crate::runtime::{...}` to `use redextape_native_rt::{...}` (same symbol list: `Runtime, rt_box, rt_box_get, rt_box_set, rt_cons, rt_enter, rt_faulted, rt_head, rt_is_empty, rt_leave, rt_tail, rt_tick`). `register_symbols` still passes each `rt_x as *const u8` — unchanged except for the import path.

- [ ] **Step 7: Build and run the full workspace suite** — the JIT must behave identically.

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS (the moved `runtime` unit tests + `native_oracle.rs` all green). Confirm `redextape-core` is still WASM-clean and `redextape-native-rt` has no cranelift in its tree:
Run: `cargo tree -p redextape-native-rt -i cranelift-codegen`
Expected: errors/empty (cranelift is not a dependency of the rt crate).

- [ ] **Step 8: Verify the staticlib builds and exports the symbols.**

Run: `cargo build -p redextape-native-rt && nm target/debug/libredextape_native_rt.a 2>/dev/null | grep -E ' T _?rt_cons' | head`
Expected: a defined-text (`T`) symbol for `rt_cons` (leading underscore on macOS). If absent, the `#[unsafe(no_mangle)]` is missing.

- [ ] **Step 9: Commit.**

```bash
git add -A
git commit -m "refactor(native): split runtime into redextape-native-rt (rlib+staticlib), no_mangle rt_* for AOT linking"
```

---

### Task 3: Make the codegen generic over `Module` (split `cranelift_backend.rs`)

Extract the asm→CLIF codegen (which only ever calls `cranelift_module::Module` methods) into `codegen.rs`, taking `&mut dyn Module`, and leave the JIT-specific driver (finalize + run) in `jit.rs`. JIT behavior is unchanged; this unblocks the AOT module target.

**Files:**
- Create: `crates/redextape-native/src/codegen.rs` (the shared, Module-generic codegen)
- Create: `crates/redextape-native/src/jit.rs` (the JIT driver — the current `compile_and_run`/`build_and_run`)
- Delete: `crates/redextape-native/src/cranelift_backend.rs`
- Modify: `crates/redextape-native/src/lib.rs` (module wiring; `run_native` calls `jit::compile_and_run`)

**Interfaces:**
- Produces (crate-internal, `pub(crate)`):
  - `codegen::CodegenError(String)` — a backend-agnostic codegen error.
  - `codegen::reg_over_cap(&Program) -> bool`
  - `codegen::native_depth_cap(&Program, &[Subroutine], Caps) -> u64`
  - `codegen::Decls` (make the struct, **its fields**, and `RtIds` `pub(crate)` — they are private today — so `aot.rs` can construct a `Decls`), `codegen::declare_rt(&mut dyn Module) -> Result<RtIds, CodegenError>`, `codegen::word_signature(&dyn Module, u32) -> Signature`, `codegen::param_count(&Subroutine) -> u32`
  - `codegen::declare_subroutines(&mut dyn Module, &[Subroutine]) -> Result<(HashMap<usize, FuncId>, HashMap<usize, u32>), CodegenError>`
  - `codegen::translate_subroutine(&mut dyn Module, &mut Context, &mut FunctionBuilderContext, &Program, &Subroutine, &Decls) -> Result<(), CodegenError>`
  - `codegen::pointer_type(&dyn Module) -> Type` (host pointer type, i.e. `module.target_config().pointer_type()`)
- Consumes: `redextape_native_rt::{Runtime, rt_*}` (for `register_symbols` in `jit.rs`), `analysis::{Subroutine, partition, for_each_operand}`.

- [ ] **Step 1: Create `codegen.rs`** by moving, from `cranelift_backend.rs`, every function that touches *only* `Module`-trait methods and CLIF building: `reg_over_cap`, the `RtIds`/`RtRefs` structs + `RtRefs::declare`, `Decls`, `declare_rt`, `word_signature`, `param_count`, `native_depth_cap` (+ its constants `JIT_STACK_SIZE`, `STACK_MARGIN`, `BYTES_PER_VAR`, `FRAME_BASE`, `FRAME_SLACK_WORDS`, `MAX_REGISTERS`), `read_reg`, `write_reg`, `emit_cmp`, `emit_bin`, `emit_guard`, `translate_subroutine`, and the rest of the per-block translation helpers. Apply these mechanical changes:
  - Replace every `module: &mut JITModule` parameter with `module: &mut dyn Module`. `declare_func_in_func`, `declare_function`, `make_context`, `clear_context`, `target_config`, `isa` are all `Module`-trait methods, so `&mut dyn Module` resolves them. (`RtRefs::declare` and `translate_subroutine` are the ones to change.)
  - Replace the error type: `translate_subroutine` (and helpers that returned `Result<_, NativeRun>`) now return `Result<_, CodegenError>`. Define `pub(crate) struct CodegenError(pub String);` and a helper `fn codegen_error(msg: impl std::fmt::Display) -> CodegenError`. Any place that built `internal_error(...)` inside these shared fns now builds `CodegenError(format!("native codegen: {msg}"))`.
  - Add `pub(crate) fn declare_subroutines(module: &mut dyn Module, subs: &[Subroutine]) -> Result<(HashMap<usize, FuncId>, HashMap<usize, u32>), CodegenError>` extracted from the "Declare every subroutine up front" loop in the current `build_and_run` (it uses only `word_signature` + `module.declare_function`).
  - Add `pub(crate) fn pointer_type(module: &dyn Module) -> types::Type { module.target_config().pointer_type() }` for the AOT `main`/`func_addr` code (Task 4).
  - Keep `JIT_STACK_SIZE`/`STACK_MARGIN` in `codegen.rs` (they parameterize `native_depth_cap`); `jit.rs` imports `JIT_STACK_SIZE` for its `stack_size(...)` thread.

- [ ] **Step 2: Create `jit.rs`** with the JIT-specific driver — the current `compile_and_run` and `build_and_run`, plus `register_symbols` and `internal_error`:
  - `register_symbols(&mut JITBuilder)` stays here (JIT-only; `JITBuilder::symbol`), importing the `rt_*` from `redextape_native_rt`.
  - `internal_error(msg) -> NativeRun` stays here.
  - `build_and_run` now: build `JITModule`; `let rt = codegen::declare_rt(&mut module).map_err(|CodegenError(m)| internal_error(m))?`; `let (func_ids, arity) = codegen::declare_subroutines(&mut module, subs).map_err(...)?`; build `Decls`; for each sub call `codegen::translate_subroutine(&mut module, &mut ctx, &mut fbctx, prog, sub, &decls).map_err(|CodegenError(m)| internal_error(m))?` then `module.define_function(...)`; then `finalize_definitions` + `get_finalized_function` + run (unchanged tail). `reg_over_cap`/`native_depth_cap`/`partition` are called as `codegen::…` / `crate::analysis::…`.
  - Note: `declare_rt`/`declare_subroutines`/`translate_subroutine` take `&mut dyn Module`; pass `&mut module` where `module: JITModule` — `&mut JITModule` coerces to `&mut dyn Module` automatically.

- [ ] **Step 3: Delete `cranelift_backend.rs`; update `lib.rs`** module declarations:

```rust
#[cfg(feature = "cranelift")]
pub mod codegen;
#[cfg(feature = "cranelift")]
pub mod jit;
```

and change `run_native`'s body from `cranelift_backend::compile_and_run(&prog, caps)` to `jit::compile_and_run(&prog, caps)`.

- [ ] **Step 4: Build + run the whole suite — JIT behavior must be identical.**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS — `native_oracle.rs` (four-way oracle, `native == asm-interp`, beyond-FIELD_WIDTH, proptest) all green, proving the refactor changed nothing observable.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "refactor(native): make codegen generic over Module (codegen.rs) + JIT driver (jit.rs)"
```

---

### Task 4: `emit_object` — ObjectModule + `main` entry + CONFIG blob

Compile a `Program` to a `.o` for the host, using the shared codegen, plus an emitted C `main` and a CONFIG data object. Always-on smoke test (no `cc` needed).

**Files:**
- Create: `crates/redextape-native/src/aot.rs` (this task: `emit_object`, `AotError`, CONFIG serialization; `link_executable`/`LinkOptions` land in Task 6)
- Modify: `crates/redextape-native/Cargo.toml` (add `cranelift-object`, `cranelift-native` behind `cranelift`)
- Modify: `crates/redextape-native/src/lib.rs` (declare `mod aot`, re-export `emit_object`/`AotError`)

**Interfaces:**
- Consumes: `codegen::{translate_subroutine, declare_subroutines, declare_rt, word_signature, param_count, native_depth_cap, reg_over_cap, pointer_type, Decls, CodegenError}`, `analysis::partition`, `redextape_core::tm::{Program, Caps}`, `redextape_core::ty::Ty`.
- Produces:
  - `redextape_native::AotError` (enum: `Unsupported(String)`, `Lower(LowerError)`, `Codegen(String)`, `Object(String)`, `Link(String)`, `NoLinker`, `NoStaticlib`)
  - `redextape_native::emit_object(prog: &Program, caps: Caps, ty: &Ty) -> Result<Vec<u8>, AotError>`
  - `aot::serialize_config(caps: Caps, depth_cap: u64, ty: &Ty) -> Vec<u8>` (private; round-trips with `redextape_native_rt::config` in Task 5)

- [ ] **Step 1: Add deps** to `crates/redextape-native/Cargo.toml` — extend the `cranelift` feature and dep list:

```toml
cranelift = ["dep:cranelift-jit", "dep:cranelift-module", "dep:cranelift-frontend", "dep:cranelift-codegen", "dep:cranelift-object", "dep:cranelift-native"]
# ... under [dependencies]:
cranelift-object = { version = "0.134", optional = true }
cranelift-native = { version = "0.134", optional = true }
```

- [ ] **Step 2: Write the failing smoke test** in `aot.rs` (`#[cfg(all(test, feature = "cranelift"))]`). It emits an object and checks it's a valid host object exporting `main` and importing `rt_run`, using the `object` crate re-exported by `cranelift-object`:

```rust
#[cfg(all(test, feature = "cranelift"))]
mod tests {
    use super::*;
    use cranelift_object::object::{Object, ObjectSymbol};
    use redextape_core::tm::{DEFAULT_CAPS, lower_asm};
    use redextape_core::ty::Ty;
    use redextape_core::{desugar::desugar, parser::parse};

    fn prog(src: &str) -> redextape_core::tm::Program {
        lower_asm(&desugar(&parse(src).0.unwrap())).unwrap()
    }

    #[test]
    fn emits_a_valid_object_with_main_and_rt_run() {
        let bytes = emit_object(&prog("2 + 3"), DEFAULT_CAPS, &Ty::Nat).unwrap();
        let obj = cranelift_object::object::File::parse(&*bytes).expect("valid object");
        let syms: Vec<String> = obj.symbols().filter_map(|s| s.name().ok().map(str::to_string)).collect();
        // `main` is defined/exported; the subroutine names are present (Tier 0 debuggability);
        // rt_run is an undefined import to be linked later.
        assert!(syms.iter().any(|n| n == "main" || n == "_main"), "main symbol present: {syms:?}");
        assert!(syms.iter().any(|n| n.contains("$main")), "subroutine symbols kept: {syms:?}");
        assert!(syms.iter().any(|n| n == "rt_run" || n == "_rt_run"), "rt_run import present: {syms:?}");
    }
}
```

- [ ] **Step 3: Run it, expect failure.**

Run: `cargo test -p redextape-native emits_a_valid_object_with_main_and_rt_run`
Expected: FAIL — `emit_object` not found.

- [ ] **Step 4: Implement CONFIG serialization** (private, in `aot.rs`). Fixed little-endian layout, matched byte-for-byte by `redextape_native_rt::config::deserialize` in Task 5:

```
[0..8)   caps.steps   u64 LE
[8..16)  caps.stack   u64 LE
[16..24) caps.heap    u64 LE
[24..32) depth_cap    u64 LE
[32..)   Ty, tag-encoded: 0=Nat 1=Bool 2=Unit 3=List<elem follows> ; Fun/Var rejected before emit
```

```rust
fn serialize_ty(ty: &Ty, out: &mut Vec<u8>) -> Result<(), AotError> {
    match ty {
        Ty::Nat => out.push(0),
        Ty::Bool => out.push(1),
        Ty::Unit => out.push(2),
        Ty::List(elem) => { out.push(3); serialize_ty(elem, out)?; }
        Ty::Fun(..) | Ty::Var(_) => {
            return Err(AotError::Unsupported(format!("cannot emit a program of non-value type {ty:?}")));
        }
    }
    Ok(())
}

fn serialize_config(caps: Caps, depth_cap: u64, ty: &Ty) -> Result<Vec<u8>, AotError> {
    let mut b = Vec::new();
    for w in [caps.steps, caps.stack, caps.heap, depth_cap] {
        b.extend_from_slice(&w.to_le_bytes());
    }
    serialize_ty(ty, &mut b)?;
    Ok(b)
}
```

- [ ] **Step 5: Implement `emit_object`.** Build the host `ObjectModule`, declare+define subroutines via the shared codegen, then declare+define the CONFIG data and the `main` entry, then `finish().emit()`:

```rust
pub fn emit_object(prog: &Program, caps: Caps, ty: &Ty) -> Result<Vec<u8>, AotError> {
    use cranelift_codegen::ir::{AbiParam, InstBuilder, Signature, UserFuncName, types};
    use cranelift_codegen::settings::{self, Configurable};
    use cranelift_module::{DataDescription, Linkage, Module};
    use cranelift_object::{ObjectBuilder, ObjectModule};

    if codegen::reg_over_cap(prog) {
        return Err(AotError::Unsupported("register index exceeds MAX_REGISTERS".into()));
    }
    let subs = codegen::partition_or(prog).map_err(AotError::Lower)?; // = analysis::partition mapped

    // Host ISA (like JITBuilder does internally, but explicit for the object module).
    let mut flags = settings::builder();
    flags.set("is_pic", "true").ok(); // position-independent: friendliest to the system linker
    let isa_builder = cranelift_native::builder().map_err(|e| AotError::Object(e.to_string()))?;
    let isa = isa_builder
        .finish(settings::Flags::new(flags))
        .map_err(|e| AotError::Object(e.to_string()))?;
    let builder = ObjectBuilder::new(isa, "redextape_aot", cranelift_module::default_libcall_names())
        .map_err(|e| AotError::Object(e.to_string()))?;
    let mut module = ObjectModule::new(builder);

    // Shared codegen (identical to the JIT).
    let rt = codegen::declare_rt(&mut module).map_err(cg)?;
    let (func_ids, arity) = codegen::declare_subroutines(&mut module, &subs).map_err(cg)?;
    let decls = codegen::Decls { rt, func_ids: func_ids.clone(), arity };
    let mut fbctx = cranelift_frontend::FunctionBuilderContext::new();
    for sub in &subs {
        let mut ctx = module.make_context();
        ctx.func.signature = codegen::word_signature(&module, codegen::param_count(sub));
        let fid = decls.func_ids[&sub.entry];
        ctx.func.name = UserFuncName::user(0, fid.as_u32());
        codegen::translate_subroutine(&mut module, &mut ctx, &mut fbctx, prog, sub, &decls).map_err(cg)?;
        module.define_function(fid, &mut ctx).map_err(|e| AotError::Object(e.to_string()))?;
        module.clear_context(&mut ctx);
    }

    // CONFIG data object.
    let depth_cap = codegen::native_depth_cap(prog, &subs, caps);
    let config = serialize_config(caps, depth_cap, ty)?;
    let config_len = config.len() as i64;
    let config_id = module
        .declare_data("redextape_config", Linkage::Local, false, false)
        .map_err(|e| AotError::Object(e.to_string()))?;
    let mut dd = DataDescription::new();
    dd.define(config.into_boxed_slice());
    module.define_data(config_id, &dd).map_err(|e| AotError::Object(e.to_string()))?;

    // `main` entry: int main(int, char**) { return rt_run(&$main, &CONFIG, CONFIG_LEN); }
    let ptr = codegen::pointer_type(&module);
    let mut main_sig = Signature::new(module.isa().default_call_conv());
    main_sig.params.push(AbiParam::new(types::I32)); // argc (ignored)
    main_sig.params.push(AbiParam::new(ptr)); // argv (ignored)
    main_sig.returns.push(AbiParam::new(types::I32));
    let main_id = module
        .declare_function("main", Linkage::Export, &main_sig)
        .map_err(|e| AotError::Object(e.to_string()))?;

    // rt_run(main_fn_ptr, config_ptr, config_len) -> i32
    let mut run_sig = Signature::new(module.isa().default_call_conv());
    run_sig.params.push(AbiParam::new(ptr)); // $main fn address
    run_sig.params.push(AbiParam::new(ptr)); // config address
    run_sig.params.push(AbiParam::new(types::I64)); // config length
    run_sig.returns.push(AbiParam::new(types::I32));
    let rt_run_id = module
        .declare_function("rt_run", Linkage::Import, &run_sig)
        .map_err(|e| AotError::Object(e.to_string()))?;

    let mut ctx = module.make_context();
    ctx.func.signature = main_sig;
    ctx.func.name = UserFuncName::user(0, main_id.as_u32());
    {
        let mut b = cranelift_frontend::FunctionBuilder::new(&mut ctx.func, &mut fbctx);
        let blk = b.create_block();
        b.append_block_params_for_function_params(blk);
        b.switch_to_block(blk);
        b.seal_block(blk);
        let inner_main = module.declare_func_in_func(decls.func_ids[&0], b.func);
        let main_addr = b.ins().func_addr(ptr, inner_main);
        let config_gv = module.declare_data_in_func(config_id, b.func);
        let config_addr = b.ins().global_value(ptr, config_gv);
        let len_val = b.ins().iconst(types::I64, config_len);
        let run_ref = module.declare_func_in_func(rt_run_id, b.func);
        let call = b.ins().call(run_ref, &[main_addr, config_addr, len_val]);
        let code = b.inst_results(call)[0];
        b.ins().return_(&[code]);
        b.finalize();
    }
    module.define_function(main_id, &mut ctx).map_err(|e| AotError::Object(e.to_string()))?;
    module.clear_context(&mut ctx);

    let product = module.finish();
    product.emit().map_err(|e| AotError::Object(e.to_string()))
}

fn cg(e: codegen::CodegenError) -> AotError { AotError::Codegen(e.0) }
```

Add a `codegen::partition_or` thin wrapper (or call `crate::analysis::partition(prog)` directly and `map_err(AotError::Lower)`). Define `AotError` with `#[derive(Debug)]` and a `Display`/`std::error::Error` impl.

- [ ] **Step 6: Wire `lib.rs`.** Add `#[cfg(feature = "cranelift")] pub mod aot;` and re-export: `#[cfg(feature = "cranelift")] pub use aot::{emit_object, AotError, LinkOptions};` (LinkOptions arrives in Task 6 — for now export `emit_object, AotError`). Add a `#[cfg(not(feature = "cranelift"))]` stub `pub fn emit_object(_,_,_) -> Result<Vec<u8>, AotError>` returning `Err(AotError::Unsupported("built without cranelift".into()))`, and a `#[cfg(not(feature = "cranelift"))]` `AotError` so the type exists either way (move `AotError` to `lib.rs` or a always-compiled small module).

- [ ] **Step 7: Run the smoke test + suite.**

Run: `cargo test -p redextape-native emits_a_valid_object_with_main_and_rt_run && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS. (If the `main`/`_main` or `$main` symbol assertions fail, check the platform's leading-underscore convention and that `Linkage::Local` subroutine symbols are retained — they are, by default, in the object.)

- [ ] **Step 8: Commit.**

```bash
git add -A
git commit -m "feat(native): emit_object — AOT .o with a main entry, CONFIG blob, and shared codegen"
```

---

### Task 5: The standalone driver — `rt_run` + `rt_print_result` (in `redextape-native-rt`)

The Rust entry point the emitted `main` calls. Repackages the JIT run-tail (big-stack thread + depth cap + Ran/Fault/HitCap) and adds decode + print + exit code.

**Files:**
- Modify: `crates/redextape-native-rt/src/lib.rs` (add `rt_run`, the `config` submodule, and a testable `print_outcome`)

**Interfaces:**
- Consumes: `redextape_core::tm::{AsmOutcome, Caps, decode_asm_ty}`, `redextape_core::value::format_value`, `redextape_core::ty::Ty`, the local `Runtime`.
- Produces: `#[unsafe(no_mangle)] pub unsafe extern "C" fn rt_run(main_fn: extern "C" fn(*mut Runtime) -> u64, config_ptr: *const u8, config_len: u64) -> i32`; `config::deserialize(&[u8]) -> Option<(Caps, u64, Ty)>` (round-trips with Task 4's `serialize_config`).

- [ ] **Step 1: Write the failing tests** for config round-trip and outcome formatting (in the rt crate's tests):

```rust
#[test]
fn config_roundtrips() {
    // Bytes must match aot::serialize_config exactly. Build them the same way here.
    let caps = Caps { steps: 10, stack: 20, heap: 30, mem: 40 };
    let mut bytes = Vec::new();
    for w in [caps.steps, caps.stack, caps.heap, 7u64] { bytes.extend_from_slice(&w.to_le_bytes()); }
    bytes.push(3); bytes.push(0); // List<Nat>
    let (c, depth, ty) = super::config::deserialize(&bytes).unwrap();
    assert_eq!((c.steps, c.stack, c.heap), (10, 20, 30));
    assert_eq!(depth, 7);
    assert_eq!(ty, redextape_core::ty::Ty::List(Box::new(redextape_core::ty::Ty::Nat)));
}

#[test]
fn print_outcome_formats_and_exit_codes() {
    use redextape_core::ty::Ty;
    // Ran → value + exit 0.
    let mut out = Vec::new();
    let code = super::print_outcome(Some(AsmOutcome { result: 5, heap: vec![] }), false, &Ty::Nat, &mut out);
    assert_eq!((code, String::from_utf8(out).unwrap()), (0, "5\n".to_string()));
    // Cap → exit 3.
    let mut out = Vec::new();
    assert_eq!(super::print_outcome(None, true, &Ty::Nat, &mut out), 3);
    // Fault → exit 2 (fault message provided via the same path; see signature note below).
}
```

(Refactor the classification into a pure, `Write`-generic `print_outcome(outcome: Option<AsmOutcome>, hit_cap: bool, ty: &Ty, w: &mut dyn std::io::Write) -> i32` — plus a fault variant — so it's unit-testable without spawning a thread or capturing real stdout. `rt_run` wires the real `Runtime` + `std::io::stdout()`/`stderr()` into it.)

- [ ] **Step 2: Run, expect failure.**

Run: `cargo test -p redextape-native-rt config_roundtrips print_outcome_formats_and_exit_codes`
Expected: FAIL — `config`/`print_outcome` not found.

- [ ] **Step 3: Implement `config::deserialize`** (mirror Task 4's layout exactly):

```rust
pub(crate) mod config {
    use redextape_core::tm::Caps;
    use redextape_core::ty::Ty;

    fn read_u64(b: &[u8], at: usize) -> Option<u64> {
        b.get(at..at + 8)?.try_into().ok().map(u64::from_le_bytes)
    }
    fn read_ty(b: &[u8], at: &mut usize) -> Option<Ty> {
        let tag = *b.get(*at)?; *at += 1;
        Some(match tag {
            0 => Ty::Nat, 1 => Ty::Bool, 2 => Ty::Unit,
            3 => Ty::List(Box::new(read_ty(b, at)?)),
            _ => return None,
        })
    }
    pub fn deserialize(b: &[u8]) -> Option<(Caps, u64, Ty)> {
        let steps = read_u64(b, 0)?; let stack = read_u64(b, 8)?;
        let heap = read_u64(b, 16)?; let depth = read_u64(b, 24)?;
        let mut at = 32; let ty = read_ty(b, &mut at)?;
        // caps.mem has no native analog (see the JIT driver note); default it.
        Some((Caps { steps, stack, heap, mem: u64::MAX }, depth, ty))
    }
}
```

- [ ] **Step 4: Implement `print_outcome`** (pure, `Write`-generic) and the fault path:

```rust
/// Classify + render a finished run. `outcome` is `Some` iff the run produced a value (not a
/// fault/cap). Returns the process exit code: 0 value, 2 fault, 3 cap, 4 internal/decode failure.
pub(crate) fn print_outcome(
    outcome: Option<AsmOutcome>,
    hit_cap: bool,
    ty: &Ty,
    w: &mut dyn std::io::Write,
) -> i32 {
    if hit_cap {
        let _ = writeln!(w, "hit cap");
        return 3;
    }
    match outcome {
        Some(o) => match redextape_core::tm::decode_asm_ty(&o, ty) {
            Some(v) => { let _ = writeln!(w, "{}", redextape_core::value::format_value(&v)); 0 }
            None => { let _ = writeln!(w, "internal: could not decode result"); 4 }
        },
        None => 4, // handled by the fault path in rt_run; see below
    }
}
```

Wire the fault path directly in `rt_run` (it has the `String` message): on `Some(msg) = runtime.fault.take()`, `writeln!(stderr, "fault: {msg}")` and return `2`. `hit_cap` → `print_outcome(None, true, …)` → `3`. Otherwise `print_outcome(Some(outcome), false, ty, stdout)`.

- [ ] **Step 5: Implement `rt_run`** — the JIT run-tail, repackaged, on the big-stack thread. Reuse the same `JIT_STACK_SIZE`/`STACK_MARGIN` constants (duplicate them as `pub const` here, or move them to the rt crate and have `codegen.rs` import them — pick one and note it; simplest is a small `pub const AOT_STACK_SIZE: usize = 512 << 20;` here, since the depth cap was already baked into CONFIG at emit time):

```rust
/// The AOT binary's entry point (called by the emitted `main`). Deserializes CONFIG, runs `main_fn`
/// on a big reserved stack with the emit-time frame-size-aware `depth_cap`, then decodes + prints the
/// result and returns the process exit code. Total: deep recursion → cap (exit 3), fault → exit 2.
///
/// # Safety
/// `main_fn` must be the finalized `$main` (`extern "C" fn(*mut Runtime) -> u64`); `config_ptr`/
/// `config_len` must describe a CONFIG blob produced by `emit_object`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rt_run(
    main_fn: extern "C" fn(*mut Runtime) -> u64,
    config_ptr: *const u8,
    config_len: u64,
) -> i32 {
    let bytes = unsafe { std::slice::from_raw_parts(config_ptr, config_len as usize) };
    let (caps, depth_cap, ty) = match config::deserialize(bytes) {
        Some(c) => c,
        None => { eprintln!("internal: malformed AOT config"); return 4; }
    };
    // Run on a big reserved stack so the emit-time depth_cap trips before the OS stack overflows.
    let run = std::thread::Builder::new()
        .stack_size(AOT_STACK_SIZE)
        .spawn(move || {
            let mut rt = Runtime::with_depth_cap(caps, depth_cap);
            let word = main_fn(&mut rt);
            (rt.hit_cap, rt.fault.take(), rt.into_outcome(word))
        });
    let (hit_cap, fault, outcome) = match run.and_then(|h| h.join().map_err(|_| std::io::Error::other("panic"))) {
        Ok(t) => t,
        Err(_) => { eprintln!("internal: AOT run thread failed"); return 4; }
    };
    if hit_cap {
        return print_outcome(None, true, &ty, &mut std::io::stderr());
    }
    if let Some(msg) = fault {
        eprintln!("fault: {msg}");
        return 2;
    }
    print_outcome(Some(outcome), false, &ty, &mut std::io::stdout())
}
```

(Note: `main_fn` moves into the thread; `extern "C" fn` pointers are `Send`, so this compiles.)

- [ ] **Step 6: Run tests + suite + clippy/fmt.**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS. Confirm the staticlib still exports `rt_run`: `cargo build -p redextape-native-rt && nm target/debug/libredextape_native_rt.a 2>/dev/null | grep -E ' T _?rt_run'`.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "feat(native-rt): rt_run standalone driver + CONFIG deserialize + print/exit-code taxonomy"
```

---

### Task 6: `link_executable` — staticlib discovery, `cc` driver, platform-aware linker selection, strip

Best-effort link of an emitted `.o` into a runnable executable. Pure policy logic is unit-tested; the actual link is exercised in Task 7 (gated on `cc`).

**Files:**
- Modify: `crates/redextape-native/src/aot.rs` (add `LinkOptions`, `LinkerChoice`, `link_executable`, the linker-selection helpers)
- Modify: `crates/redextape-native/src/lib.rs` (re-export `LinkOptions`, `LinkerChoice`, `link_executable`)

**Interfaces:**
- Produces:
  - `LinkOptions { linker: LinkerChoice, strip: bool }` (`Default`: `linker: Auto, strip: false`)
  - `LinkerChoice { Auto, Default, Named(String) }`
  - `link_executable(obj: &[u8], out: &Path, opts: &LinkOptions) -> Result<(), AotError>`
  - `fn selected_linker(opts: &LinkOptions) -> Option<String>` (private, unit-tested policy)
- Consumes: `AotError`, `std::process::Command`.

- [ ] **Step 1: Write failing unit tests** for the selection policy (no real linking):

```rust
#[test]
fn linker_env_override_wins() {
    // SAFETY: single-threaded test; set + clear.
    unsafe { std::env::set_var("REDEXTAPE_LINKER", "lld") };
    assert_eq!(selected_linker(&LinkOptions::default()), Some("lld".to_string()));
    unsafe { std::env::set_var("REDEXTAPE_LINKER", "default") };
    assert_eq!(selected_linker(&LinkOptions::default()), None); // "default" = no -fuse-ld
    unsafe { std::env::remove_var("REDEXTAPE_LINKER") };
}

#[test]
fn auto_is_none_on_macos_named_is_explicit() {
    // Named always wins regardless of platform.
    let named = LinkOptions { linker: LinkerChoice::Named("mold".into()), strip: false };
    assert_eq!(selected_linker(&named), Some("mold".to_string()));
    // Auto on macOS selects the default (None); on Linux it may probe (covered by the probe test).
    if cfg!(target_os = "macos") {
        assert_eq!(selected_linker(&LinkOptions::default()), None);
    }
}
```

- [ ] **Step 2: Run, expect failure.**

Run: `cargo test -p redextape-native linker_env_override_wins auto_is_none_on_macos`
Expected: FAIL — types/fn not found.

- [ ] **Step 3: Implement the types + selection policy.** `selected_linker` returns `Some(name)` to pass `-fuse-ld=name`, or `None` for the platform default:

```rust
#[derive(Clone, Debug)]
pub enum LinkerChoice { Auto, Default, Named(String) }

#[derive(Clone, Debug)]
pub struct LinkOptions { pub linker: LinkerChoice, pub strip: bool }
impl Default for LinkOptions {
    fn default() -> Self { LinkOptions { linker: LinkerChoice::Auto, strip: false } }
}

/// Which linker to request via `-fuse-ld`, or `None` to use the platform default `cc` linker.
/// Env `REDEXTAPE_LINKER` overrides `LinkOptions.linker`. `Auto` is platform-aware: on macOS the
/// default `ld` (ld-prime) is fastest and the fast linkers don't target Mach-O, so `Auto` = default;
/// on Linux/ELF it prefers mold > wild > lld when present. `"default"` means the platform default.
fn selected_linker(opts: &LinkOptions) -> Option<String> {
    if let Ok(v) = std::env::var("REDEXTAPE_LINKER") {
        return match v.as_str() { "default" | "" => None, other => Some(other.to_string()) };
    }
    match &opts.linker {
        LinkerChoice::Default => None,
        LinkerChoice::Named(n) => Some(n.clone()),
        LinkerChoice::Auto => {
            if cfg!(target_os = "macos") {
                None // ld-prime is fastest; don't override
            } else {
                ["mold", "wild", "lld"].into_iter().find(|n| on_path(n)).map(str::to_string)
            }
        }
    }
}

fn on_path(bin: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|paths| {
        std::env::split_paths(&paths).any(|d| d.join(bin).is_file())
    })
}
```

- [ ] **Step 4: Implement `link_executable`.** Ensure the staticlib exists + locate it, write the `.o` to a temp file, invoke `cc`, apply linker selection + strip, fall back on failure:

```rust
pub fn link_executable(obj: &[u8], out: &std::path::Path, opts: &LinkOptions) -> Result<(), AotError> {
    let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
    if !on_path(&cc) { return Err(AotError::NoLinker); }
    let staticlib = locate_staticlib()?; // builds redextape-native-rt if needed; see below

    // Write the object next to the output.
    let obj_path = out.with_extension("o");
    std::fs::write(&obj_path, obj).map_err(|e| AotError::Link(e.to_string()))?;

    // Try the selected linker, then fall back to the default on failure.
    let mut attempts: Vec<Option<String>> = Vec::new();
    let sel = selected_linker(opts);
    attempts.push(sel.clone());
    if sel.is_some() { attempts.push(None); } // fallback to default linker

    let mut last_err = String::new();
    for linker in attempts {
        let mut cmd = std::process::Command::new(&cc);
        cmd.arg(&obj_path).arg(&staticlib);
        if let Some(name) = &linker { cmd.arg(format!("-fuse-ld={name}")); }
        if opts.strip { cmd.arg("-Wl,-s"); }
        // Rust staticlibs need the C runtime deps; harmless where already implied.
        if cfg!(target_os = "linux") { cmd.args(["-lpthread", "-ldl", "-lm"]); }
        cmd.arg("-o").arg(out);
        match cmd.output() {
            Ok(o) if o.status.success() => return Ok(()),
            Ok(o) => last_err = String::from_utf8_lossy(&o.stderr).into_owned(),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(AotError::Link(last_err))
}
```

`locate_staticlib()`: read `CARGO_TARGET_DIR` (else `{workspace-root}/target`, where workspace-root = `env!("CARGO_MANIFEST_DIR")`/`../..`), pick `debug`/`release` (prefer the one that exists; try `debug` first). If the `.a` is missing, shell out `cargo build -p redextape-native-rt` and re-check; if still missing, `Err(AotError::NoStaticlib)`. (This is the "fiddly bit" the spec flagged; keep it best-effort and total.)

- [ ] **Step 5: Wire `lib.rs` re-exports** (`LinkOptions`, `LinkerChoice`, `link_executable`) under `#[cfg(feature = "cranelift")]`, with `#[cfg(not(feature = "cranelift"))]` stubs returning `Err(AotError::Unsupported(...))`.

- [ ] **Step 6: Run the policy tests + suite.**

Run: `cargo test -p redextape-native linker_env_override_wins auto_is_none_on_macos_named_is_explicit && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --check`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "feat(native): link_executable — staticlib discovery, cc driver, platform-aware linker selection, strip"
```

---

### Task 7: The AOT oracle leg (B1) + `aot_demo`

The bounded end-to-end leg: compile → link → run the binary → compare stdout + exit code to the reference. Gated on `cc`. Plus the demo.

**Files:**
- Create: `crates/redextape-native/tests/aot_oracle.rs`
- Create: `crates/redextape-native/examples/aot_demo.rs`

**Interfaces:**
- Consumes: `redextape_native::{emit_object, link_executable, LinkOptions, AotError}`, `redextape_core::{run, desugar::desugar, parser::parse, value::format_value, typeck::result_type, tm::{DEFAULT_CAPS, lower_asm, defunc}}`.

- [ ] **Step 1: Write the end-to-end test harness** in `aot_oracle.rs` (`#![cfg(feature = "cranelift")]`). Skip-with-notice when `cc` is absent:

```rust
#![cfg(feature = "cranelift")]
use redextape_core::tm::{DEFAULT_CAPS, defunc, lower_asm};
use redextape_core::typeck::result_type;
use redextape_core::value::format_value;
use redextape_core::{desugar::desugar, parser::parse, run};
use redextape_native::{LinkOptions, emit_object, link_executable};

fn cc_available() -> bool {
    std::env::var_os("PATH").is_some_and(|p| {
        std::env::split_paths(&p).any(|d| d.join("cc").is_file())
    })
}

/// Compile `src` to a native binary, run it, return (stdout, exit_code).
fn run_binary(src: &str, name: &str) -> (String, i32) {
    let ast = parse(src).0.unwrap();
    let ty = result_type(&ast).unwrap();
    let core = desugar(&ast);
    // Match run_native's lowering: direct, else defunc.
    let prog = lower_asm(&core).or_else(|_| defunc(&core).and_then(|d| lower_asm(&d))).unwrap();
    let obj = emit_object(&prog, DEFAULT_CAPS, &ty).unwrap();
    let out = std::env::temp_dir().join(format!("redextape_aot_{name}"));
    link_executable(&obj, &out, &LinkOptions::default()).expect("link");
    let output = std::process::Command::new(&out).output().expect("run binary");
    (String::from_utf8_lossy(&output.stdout).trim().to_string(), output.status.code().unwrap_or(-1))
}

#[test]
fn aot_binary_matches_reference() {
    if !cc_available() {
        eprintln!("SKIP aot_binary_matches_reference: no `cc` on PATH (the .o still emits; see the smoke test)");
        return;
    }
    let value_cases = [
        ("nat", "2 + 3 * 4"),
        ("bool", "10 > 3"),
        ("list", "[1, 2, 3]"),
        ("recursion", "fn sum(n){ if n == 0 { 0 } else { n + sum(n - 1) } } sum(100)"),
        ("higher_order", "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} [5,6].map(add1)"),
    ];
    for (name, src) in value_cases {
        let expected = format_value(&run(src).unwrap());
        let (stdout, code) = run_binary(src, name);
        assert_eq!(stdout, expected, "stdout mismatch for {name} ({src})");
        assert_eq!(code, 0, "exit code for a value should be 0 ({name})");
    }
    // Fault → exit 2.
    let (_out, code) = run_binary("head(nil)", "fault");
    assert_eq!(code, 2, "head(nil) should fault with exit 2");
    // Cap → exit 3.
    let (_out, code) = run_binary("fn spin(n){ spin(n) } spin(0)", "cap");
    assert_eq!(code, 3, "infinite recursion should hit the cap with exit 3");
}
```

- [ ] **Step 2: Run it.**

Run: `cargo test -p redextape-native --test aot_oracle`
Expected: PASS where `cc` is present (SKIP notice otherwise). This validates the full emit → link → run → decode/print/exit path end-to-end.

- [ ] **Step 3: Write `aot_demo.rs`.** Emit + (best-effort) link + run a program, showing the standalone binary's stdout; fall back to "emitted N bytes, no linker" when `cc` is absent:

```rust
//! `cargo run --example aot_demo -p redextape-native` — compile a mini-language program to a real
//! standalone native binary, run it, and show its output.
#[cfg(feature = "cranelift")]
fn main() {
    use redextape_core::tm::{DEFAULT_CAPS, lower_asm};
    use redextape_core::typeck::result_type;
    use redextape_core::{desugar::desugar, parser::parse};
    use redextape_native::{LinkOptions, emit_object, link_executable};

    let src = "fn sum(n){ if n == 0 { 0 } else { n + sum(n - 1) } } sum(100)";
    let ast = parse(src).0.unwrap();
    let ty = result_type(&ast).unwrap();
    let prog = lower_asm(&desugar(&ast)).unwrap();
    let obj = emit_object(&prog, DEFAULT_CAPS, &ty).unwrap();
    println!("program : {src}");
    println!("emitted : {} bytes of native object code (type {ty:?})", obj.len());

    let out = std::env::temp_dir().join("redextape_aot_demo");
    match link_executable(&obj, &out, &LinkOptions::default()) {
        Ok(()) => {
            let output = std::process::Command::new(&out).output().expect("run");
            print!("binary  : {}", String::from_utf8_lossy(&output.stdout));
            println!("(exit {}) — a real native binary at {}", output.status.code().unwrap_or(-1), out.display());
        }
        Err(e) => println!("link    : skipped ({e:?}); the .o is valid and was emitted above"),
    }
}

#[cfg(not(feature = "cranelift"))]
fn main() { println!("build with the `cranelift` feature to run the AOT demo"); }
```

- [ ] **Step 4: Run the demo + full suite.**

Run: `cargo run --example aot_demo -p redextape-native && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --check`
Expected: the demo prints `sum(100)` → `5050` from a real binary (or the graceful no-linker fallback); the workspace is green and clean.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "test(native): end-to-end AOT oracle leg (B1) + aot_demo"
```

---

## Notes for the executor

- **Cranelift API drift:** the exact `ObjectBuilder`/`settings`/`isa` construction and a few instruction-builder names (`func_addr`, `global_value`, `declare_data_in_func`) are pinned to 0.134; if a signature differs, consult the installed `cranelift-object`/`cranelift-module` 0.134 docs (via context7 or `cargo doc`) rather than guessing. The *shape* of the plan (shared codegen + a `main` that calls `rt_run`) is stable regardless.
- **`is_pic`:** if the object fails to link as PIE on some Linux setups, the fallback is `cmd.arg("-no-pie")` in `link_executable`; keep `is_pic=true` as the default (friendliest to modern toolchains).
- **Order matters:** Tasks 2 and 3 are refactors that must keep the full suite green — do not proceed past either with a red suite. Tasks 4–7 build the new path.
- **`caps.mem`** has no native analog (documented in the JIT driver); `config::deserialize` defaults it to `u64::MAX`. Do not try to thread it into the native run.
