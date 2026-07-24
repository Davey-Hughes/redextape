# Native Backend Phase 2 — LLVM (optimizing codegen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second native codegen backend built on LLVM (inkwell) behind a shared `Codegen` seam — real `-O3` optimization, a `cranelift == llvm` cross-check, and a `llvm-O0 == llvm-O3` optimizer-validation differential — JIT-in-process only.

**Architecture:** LLVM reuses the `rt_*` runtime, `analysis::partition`, the frame-size-aware depth cap, `Runtime`, `decode_asm`, `Caps`, and the totality story verbatim (all codegen-agnostic). The only new surface is `src/llvm.rs` — the asm→LLVM-IR walk (inkwell analog of `codegen::translate_subroutine`) + LLVM opt passes + the inkwell `ExecutionEngine` JIT, driven on the same big-stack thread as the Cranelift JIT.

**Tech Stack:** Rust (edition 2024), inkwell 0.9 (LLVM 22.1.8, installed at `/opt/homebrew/opt/llvm`), behind a `llvm` cargo feature; the existing Cranelift stack unchanged.

**Design spec:** `docs/superpowers/specs/2026-07-24-native-llvm-phase2-design.md` (read for rationale).

## Global Constraints

- **No git attribution.** Never add `Co-Authored-By: Claude`, `Generated with Claude Code`, or any similar trailer to commit messages.
- **`redextape-core` stays WASM-clean** and **`redextape-native-rt` stays Cranelift/LLVM-free.** inkwell/LLVM enters ONLY through the `llvm` feature on `redextape-native`.
- **The default build stays pure-Rust.** `cargo build` (default = `cranelift`) and `--no-default-features` must NOT require an LLVM toolchain. Only `--features llvm` pulls inkwell.
- **All three feature configs compile:** `--no-default-features`, default (`cranelift`), and `--features llvm` (and `--features "cranelift llvm"`, which the oracle uses).
- **Totality (cardinal rule).** The LLVM backend is total on any input: deep recursion → `HitCap` (never a stack-overflow abort), faults → `Fault`, caps → `HitCap`, over-cap registers rejected before IR is built, all inkwell/JIT/thread errors → `NativeRun::LowerError`, never a panic.
- **Agreement contract.** `llvm::compile_and_run(prog, caps, opt)` must produce the same `NativeRun` outcome (`Ran`/`HitCap`/`Fault`) as `run_asm` / the Cranelift JIT on every `Program`, at every `OptLevel`.
- **LLVM toolchain env:** build/test the `llvm` feature with `LLVM_SYS_<ver>_PREFIX=/opt/homebrew/opt/llvm` (exact var name + inkwell feature suffix confirmed in Task 1).

---

## File Structure

- `crates/redextape-native/Cargo.toml` — **modify**: add `inkwell` optional dep + `llvm` feature.
- `crates/redextape-native/src/shared.rs` — **create**: the codegen-agnostic prep (`reg_over_cap`, `native_depth_cap`, `param_count`, `n_arg_vars`, `MAX_REGISTERS`, frame constants), gated `#[cfg(any(feature = "cranelift", feature = "llvm"))]`.
- `crates/redextape-native/src/codegen.rs` — **modify**: drop the moved helpers; use `crate::shared::*`.
- `crates/redextape-native/src/jit.rs` — **modify**: import the moved helpers from `crate::shared`.
- `crates/redextape-native/src/lib.rs` — **modify**: `OptLevel`, `Codegen`, `run_native_with` + dispatch; widen `lower_program`'s cfg; `llvm` module declaration.
- `crates/redextape-native/src/llvm.rs` — **create** (`#[cfg(feature = "llvm")]`): the LLVM backend.
- `crates/redextape-native/tests/llvm_oracle.rs` — **create** (`#![cfg(feature = "llvm")]`).
- `crates/redextape-native/examples/llvm_demo.rs` — **create**.

## Interfaces produced (referenced across tasks)

- `redextape_native::OptLevel` = `{ O0, O1, O2, O3 }` (unconditional; `Default` = `O3`).
- `redextape_native::Codegen` = `{ Cranelift, Llvm { opt: OptLevel } }` (unconditional).
- `redextape_native::run_native_with(&Core, Caps, Codegen) -> NativeRun` (unconditional; arms feature-gated internally).
- `redextape_native::shared::{reg_over_cap, native_depth_cap, param_count, MAX_REGISTERS}` (pub(crate), under `any(cranelift, llvm)`).
- `redextape_native::llvm::compile_and_run(&Program, Caps, OptLevel) -> NativeRun` (`#[cfg(feature = "llvm")]`).

---

### Task 1: Toolchain + `llvm` feature + an inkwell JIT smoke test

De-risk the toolchain FIRST — prove inkwell links against the installed LLVM 22 and can JIT-run a trivial function — before writing any real codegen. This resolves the exact inkwell feature suffix and `LLVM_SYS_` env var empirically.

**Files:**
- Modify: `crates/redextape-native/Cargo.toml`
- Create: `crates/redextape-native/src/llvm.rs` (this task: only the smoke test + a stub)
- Modify: `crates/redextape-native/src/lib.rs` (declare the `llvm` module)

**Interfaces:**
- Produces: `crate::llvm` module (feature-gated); a `#[cfg(feature = "llvm")]` inkwell smoke test proving JIT works.

- [ ] **Step 1: Add the dep + feature.** In `crates/redextape-native/Cargo.toml`:

```toml
# under [features]:
llvm = ["dep:inkwell"]
# under [dependencies]:
inkwell = { version = "0.9", optional = true, features = ["llvm22-1"] }
```

- [ ] **Step 2: Resolve the exact feature suffix + env var.** Run:

```bash
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo build -p redextape-native --features llvm 2>&1 | head -30
```

If it errors on the inkwell feature (e.g. "no feature `llvm22-1`"), inkwell's error/feature list names the correct suffix (`llvm22-0` vs `llvm22-1`) — update the `features = [...]`. If it errors on a missing `LLVM_SYS_<NNN>_PREFIX`, the llvm-sys error names the exact var — use that var name (e.g. `LLVM_SYS_220_PREFIX`) pointing at `/opt/homebrew/opt/llvm`. Record the confirmed pair in the task report. (Consult the inkwell 0.9 feature list via context7 / `cargo doc` if the suffix is unclear.)

- [ ] **Step 3: Create `src/llvm.rs` with a smoke test.** Prove inkwell can build + JIT a trivial `i64 add(i64, i64)` and call it:

```rust
//! The LLVM (inkwell) native codegen backend — a second native path behind the `Codegen` seam.
//! Reuses the shared runtime (`rt_*`), `analysis::partition`, the frame-size-aware depth cap, and the
//! `Runtime`/decode/totality machinery; only the asm->LLVM-IR walk is new (mirrors `codegen`).

// (real `compile_and_run` arrives in Task 2's stub, then Tasks 3-5.)

#[cfg(test)]
mod smoke {
    use inkwell::OptimizationLevel;
    use inkwell::context::Context;

    #[test]
    fn inkwell_jits_and_runs_a_trivial_function() {
        let ctx = Context::create();
        let module = ctx.create_module("smoke");
        let builder = ctx.create_builder();
        let i64t = ctx.i64_type();
        let fnty = i64t.fn_type(&[i64t.into(), i64t.into()], false);
        let func = module.add_function("add", fnty, None);
        let entry = ctx.append_basic_block(func, "entry");
        builder.position_at_end(entry);
        let a = func.get_nth_param(0).unwrap().into_int_value();
        let b = func.get_nth_param(1).unwrap().into_int_value();
        let sum = builder.build_int_add(a, b, "sum").unwrap();
        builder.build_return(Some(&sum)).unwrap();

        let ee = module.create_jit_execution_engine(OptimizationLevel::None).unwrap();
        // SAFETY: signature matches the IR we just built.
        let add: inkwell::execution_engine::JitFunction<unsafe extern "C" fn(u64, u64) -> u64> =
            unsafe { ee.get_function("add") }.unwrap();
        assert_eq!(unsafe { add.call(2, 3) }, 5);
    }
}
```

(inkwell 0.9 builder methods return `Result` — note the `.unwrap()`s on `build_*`. Confirm the exact `build_int_add`/`build_return` signatures against the installed inkwell 0.9 docs; adjust if the API differs.)

- [ ] **Step 4: Declare the module** in `crates/redextape-native/src/lib.rs`:

```rust
#[cfg(feature = "llvm")]
pub mod llvm;
```

- [ ] **Step 5: Run the smoke test + confirm the default build is untouched.**

Run:
```bash
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm inkwell_jits_and_runs_a_trivial_function
cargo build --workspace            # default (cranelift) — must NOT need LLVM
cargo build -p redextape-native --no-default-features
```
Expected: the smoke test passes (inkwell JIT works); the default + no-default builds succeed without any LLVM env.

- [ ] **Step 6: Commit.**

```bash
git add crates/redextape-native/Cargo.toml crates/redextape-native/src/llvm.rs crates/redextape-native/src/lib.rs
git commit -m "feat(native): add llvm feature + inkwell JIT smoke test (toolchain de-risk)"
```

---

### Task 2: The `Codegen` seam + extract codegen-agnostic helpers to `shared.rs`

Add the backend selector API and move the codegen-agnostic prep helpers out of the cranelift-gated `codegen.rs` so LLVM can reuse them. The LLVM dispatch arm is a stub returning `LowerError` for now.

**Files:**
- Create: `crates/redextape-native/src/shared.rs`
- Modify: `crates/redextape-native/src/codegen.rs`, `src/jit.rs`, `src/lib.rs`, `src/llvm.rs`

**Interfaces:**
- Produces: `OptLevel`, `Codegen`, `run_native_with`; `crate::shared::{reg_over_cap, native_depth_cap, param_count, n_arg_vars, MAX_REGISTERS}` + the frame constants; `llvm::compile_and_run(&Program, Caps, OptLevel) -> NativeRun` (stub).
- Consumes: `analysis::{Subroutine, partition, for_each_operand}`.

- [ ] **Step 1: Create `src/shared.rs`** by moving, VERBATIM from `codegen.rs`, the codegen-agnostic items: the constants `STACK_MARGIN`, `BYTES_PER_VAR`, `FRAME_BASE`, `FRAME_SLACK_WORDS`, `MAX_REGISTERS`, and the functions `reg_over_cap`, `param_count`, `n_arg_vars`, `native_depth_cap`. These reference only `redextape_core::tm::{Caps, Instr, Program, Reg}`, `redextape_native_rt::RUN_STACK_SIZE`, and `crate::analysis::{Subroutine, for_each_operand}` — no Cranelift types. Gate the module:

```rust
//! Codegen-agnostic preparation shared by the Cranelift and LLVM backends: the register-cap guard,
//! subroutine arity, and the frame-size-aware recursion-depth cap. No codegen-library types here —
//! only `Program`/`Subroutine` analysis — so both backends (and neither-needs-the-other) reuse it.
```

Keep the moved items `pub(crate)`. In `lib.rs`:
```rust
#[cfg(any(feature = "cranelift", feature = "llvm"))]
pub mod shared;
```

- [ ] **Step 2: Update `codegen.rs`** to delete its now-moved copies and import them: `use crate::shared::{MAX_REGISTERS, native_depth_cap, param_count, reg_over_cap};` (plus `n_arg_vars` if referenced there). Leave everything Cranelift-typed (`translate_subroutine`, `emit_bin`, `Decls`, `declare_rt`, `word_signature`, `pointer_type`, `read_reg`/`write_reg`, etc.) in `codegen.rs`.

- [ ] **Step 3: Update `jit.rs`** imports: pull `MAX_REGISTERS, native_depth_cap, param_count, reg_over_cap` from `crate::shared` instead of `crate::codegen` (the `codegen::{CodegenError, Decls, declare_rt, declare_subroutines, translate_subroutine, word_signature}` imports stay).

- [ ] **Step 4: Add the seam to `lib.rs`.** Define the enums (unconditional) and `run_native_with`; widen `lower_program`'s cfg to `any(feature = "cranelift", feature = "llvm")` so LLVM can use it:

```rust
/// LLVM optimization level (drives both the IR pass pipeline and the JIT codegen opt level).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum OptLevel { O0, O1, O2, #[default] O3 }

/// Which native codegen backend to run.
#[derive(Clone, Copy, Debug)]
pub enum Codegen { Cranelift, Llvm { opt: OptLevel } }

/// Lower `core` and run it on the selected native codegen backend. `run_native` == Cranelift.
pub fn run_native_with(core: &Core, caps: Caps, codegen: Codegen) -> NativeRun {
    #[cfg(any(feature = "cranelift", feature = "llvm"))]
    let prog = match lower_program(core) {
        Ok(p) => p,
        Err(e) => return NativeRun::LowerError(e),
    };
    match codegen {
        Codegen::Cranelift => {
            #[cfg(feature = "cranelift")]
            { jit::compile_and_run(&prog, caps) }
            #[cfg(not(feature = "cranelift"))]
            { let _ = caps; unsupported("cranelift") }
        }
        Codegen::Llvm { opt } => {
            #[cfg(feature = "llvm")]
            { llvm::compile_and_run(&prog, caps, opt) }
            #[cfg(not(feature = "llvm"))]
            { let _ = (caps, opt); unsupported("llvm") }
        }
    }
}
```

Add a small `fn unsupported(feature: &str) -> NativeRun` returning `NativeRun::LowerError(LowerError::Unsupported { node: NodeId::default(), what: format!("redextape-native built without the `{feature}` feature") })` (available in all configs). Change `run_native` to `run_native_with(core, caps, Codegen::Cranelift)`. Handle the `#[cfg]` on `lower_program`/imports so the crate builds in ALL configs (including `--no-default-features`, where `run_native_with` returns `unsupported` for both arms — add a `#[cfg(not(any(feature="cranelift", feature="llvm")))]` variant of `run_native_with` that skips `lower_program` and returns `unsupported`).

- [ ] **Step 5: Add the LLVM stub** in `src/llvm.rs`:

```rust
use redextape_core::tm::{Caps, Program};
use crate::{NativeRun, OptLevel};

/// Compile `prog` to LLVM IR at `opt`, JIT it, and run against a fresh `Runtime`. (Real body: Tasks 3-5.)
pub fn compile_and_run(_prog: &Program, _caps: Caps, _opt: OptLevel) -> NativeRun {
    NativeRun::LowerError(redextape_core::tm::LowerError::Unsupported {
        node: redextape_core::core::NodeId::default(),
        what: "llvm backend not yet implemented".into(),
    })
}
```

- [ ] **Step 6: Verify all configs build + the Cranelift suite stays green** (this is a refactor — no behavior change).

Run:
```bash
cargo test --workspace                                   # default: cranelift suite green
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
cargo build -p redextape-native --no-default-features
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo build -p redextape-native --features "cranelift llvm"
```
Expected: `native_oracle.rs` + `aot_oracle.rs` still green (Cranelift path unchanged by the helper move); all feature configs compile.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "feat(native): Codegen seam (run_native_with) + shared codegen-agnostic prep module"
```

---

### Task 3: The LLVM IR walk — arithmetic, control flow, calls, and the driver

Implement `llvm::compile_and_run` for the non-heap instruction set + the big-stack-thread driver + `Runtime` classification + cap guards. This is the core LLVM codegen. Mirror `codegen::translate_subroutine` (`codegen.rs:367`) structurally.

**Files:**
- Modify: `crates/redextape-native/src/llvm.rs`

**Interfaces:**
- Consumes: `crate::shared::{reg_over_cap, native_depth_cap, param_count, MAX_REGISTERS}`, `crate::analysis::{Subroutine, partition, for_each_operand}`, `redextape_core::tm::{Instr, Reg, BinOp, Program, Caps}`, `redextape_native_rt::{Runtime, RUN_STACK_SIZE}`.
- Produces: a working `llvm::compile_and_run` for programs with no heap ops.

**The driver (mirror `jit.rs::compile_and_run` + `build_and_run`):**

- [ ] **Step 1: Write a failing arithmetic/control-flow test** in `llvm.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::tm::{DEFAULT_CAPS, decode_asm, lower_asm};
    use redextape_core::{desugar::desugar, parser::parse, run, value::Value};

    fn llvm_value(src: &str) -> Value {
        let core = desugar(&parse(src).0.unwrap());
        let prog = lower_asm(&core).unwrap();
        let expected = run(src).unwrap();
        match compile_and_run(&prog, DEFAULT_CAPS, OptLevel::O0) {
            NativeRun::Ran(o) => decode_asm(&o, &expected).expect("decode"),
            other => panic!("llvm did not run {src}: {other:?}"),
        }
    }

    #[test]
    fn arithmetic_and_control_flow() {
        assert_eq!(llvm_value("1 + 2 * 3"), Value::Nat(7));
        assert_eq!(llvm_value("3 - 5"), Value::Nat(0)); // monus saturates
        assert_eq!(llvm_value("if 2 > 1 { 10 } else { 20 }"), Value::Nat(10));
        assert_eq!(llvm_value("fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(5)"), Value::Nat(15));
        assert_eq!(llvm_value("100 * 100"), Value::Nat(10_000)); // beyond FIELD_WIDTH
    }

    #[test]
    fn faults_are_cap_only_here() {
        // A spin trips the depth cap → HitCap (totality), no heap needed.
        let core = desugar(&parse("fn spin(n){ spin(n) } spin(0)").0.unwrap());
        let prog = lower_asm(&core).unwrap();
        assert!(matches!(compile_and_run(&prog, DEFAULT_CAPS, OptLevel::O0), NativeRun::HitCap));
    }
}
```

- [ ] **Step 2: Run it, expect failure** (stub returns `LowerError`).

Run: `LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm arithmetic_and_control_flow`
Expected: FAIL (stub / not implemented).

- [ ] **Step 3: Implement the driver.** Structure (all on the big-stack thread, since inkwell's `Context`/`ExecutionEngine` are not `Send`, exactly like `jit.rs`):

```rust
use inkwell::OptimizationLevel;
use inkwell::context::Context;
use inkwell::module::Linkage;
use inkwell::values::{FunctionValue, IntValue, PointerValue};
use inkwell::{AddressSpace, IntPredicate};
use std::collections::HashMap;

use redextape_core::core::{BinOp, NodeId};
use redextape_core::tm::{Caps, Instr, LowerError, Program, Reg};
use redextape_native_rt::{RUN_STACK_SIZE, Runtime};
use crate::analysis::{Subroutine, partition};
use crate::shared::{MAX_REGISTERS, native_depth_cap, param_count, reg_over_cap};
use crate::{NativeRun, OptLevel};

fn internal_error(msg: impl std::fmt::Display) -> NativeRun {
    NativeRun::LowerError(LowerError::Unsupported { node: NodeId::default(), what: format!("llvm codegen: {msg}") })
}

pub fn compile_and_run(prog: &Program, caps: Caps, opt: OptLevel) -> NativeRun {
    if reg_over_cap(prog) {
        return internal_error(format!("register index exceeds MAX_REGISTERS ({MAX_REGISTERS})"));
    }
    let subs = match partition(prog) { Ok(s) => s, Err(e) => return NativeRun::LowerError(e) };
    let depth_cap = native_depth_cap(prog, &subs, caps);
    std::thread::scope(|scope| {
        let handle = match std::thread::Builder::new()
            .stack_size(RUN_STACK_SIZE)
            .spawn_scoped(scope, || build_and_run(prog, &subs, caps, depth_cap, opt))
        {
            Ok(h) => h,
            Err(e) => return internal_error(format!("spawn LLVM thread: {e}")),
        };
        match handle.join() { Ok(r) => r, Err(_) => internal_error("LLVM thread panicked") }
    })
}
```

`build_and_run(prog, subs, caps, depth_cap, opt)`:
1. `let ctx = Context::create(); let module = ctx.create_module("redextape"); let builder = ctx.create_builder();`
2. Declare the 11 `rt_*` functions as `External` linkage (i64 return except `rt_box_set`/`rt_leave` = void; params per their C signatures — `rt` is a `ptr`). Keep their `FunctionValue`s in a struct (the inkwell analog of `RtRefs`).
3. Declare every subroutine up front: `module.add_function(&sub.name, i64_type.fn_type(&[ptr_type.into()], false), None)` → a `HashMap<usize, FunctionValue>` (mirrors `declare_subroutines`).
4. Define each subroutine (`translate_subroutine_llvm` below).
5. Apply optimization (Task 5 wires `opt`; for now create the engine with `OptimizationLevel::None`).
6. Create the JIT engine — no `?` (this fn returns `NativeRun`, not `Result`): `let ee = match module.create_jit_execution_engine(OptimizationLevel::None) { Ok(ee) => ee, Err(e) => return internal_error(e) };`.
7. Resolve the entry function — the subroutine with `entry == 0` (its `name` is `"$main"`). Stay total: `let entry_name = match subs.iter().find(|s| s.entry == 0) { Some(s) => &s.name, None => return internal_error("no entry subroutine") };` then `let main: JitFunction<unsafe extern "C" fn(*mut Runtime) -> u64> = match unsafe { ee.get_function(entry_name) } { Ok(f) => f, Err(e) => return internal_error(e) };`.
8. `let mut rt = Runtime::with_depth_cap(caps, depth_cap); let result = unsafe { main.call(&mut rt) };`
9. Classify EXACTLY as `jit.rs`: `if rt.hit_cap { NativeRun::HitCap } else { match rt.fault.take() { Some(m) => NativeRun::Fault(m), None => NativeRun::Ran(rt.into_outcome(result)) } }`.

- [ ] **Step 4: Implement `translate_subroutine_llvm`** — the inkwell analog of `codegen::translate_subroutine` (read `codegen.rs:367` as the authoritative structural model). Per subroutine:
  - Entry block: `alloca` one `i64` per `Loc(i)` (0..n_locals), per `Arg(i)` (0..param_count, initialised from the function's single... — NOTE: subroutines take `*mut Runtime` as their only LLVM param; `Arg` values are passed by the CALLER writing them before the call in `run_asm`'s model. In the Cranelift codegen, `Arg`s are function params. **Match the Cranelift model:** give each subroutine `param_count(sub)` extra `i64` params after the `rt` ptr, and a caller `Call` passes the arg values. Re-check `codegen::word_signature`/`translate_subroutine` for exactly how `Arg` params and `Call` argument passing work, and mirror it: `fn_type(&[ptr, i64, i64, ...], false)` with `param_count` i64s, `Arg(i)` alloca initialised from `func.get_nth_param(i+1)`.) `Rr` = one alloca, zero-init.
  - One `BasicBlock` per reachable body index (`sub.body`), plus the entry and a single shared **exit block** that loads `Rr` and `ret`s it.
  - Translate each body instruction into its block (see the mapping table below); end each block with a terminator (`br`/`ret`/branch to next-index block).

**Instruction → LLVM IR mapping** (each mirrors the corresponding `codegen.rs` arm):

| `Instr` | LLVM |
|---|---|
| `Li(r, n)` | `build_store(alloca(r), i64.const(n))` |
| `Mov(d, s)` | store(load(s)) |
| `Bin(d, op, a, b)` | `build_int_*`; **`Add`/`Mul` saturate via intrinsics** `llvm.uadd.sat.i64`/`llvm.umul.sat.i64`; `Sub` = `llvm.usub.sat.i64` (monus); `Eq/Ne/Lt/Le/Gt/Ge` = `build_int_compare(IntPredicate::{EQ,NE,ULT,ULE,UGT,UGE})` then `build_int_z_extend` to i64 |
| `Jz(r, tgt)` | `build_conditional_branch(icmp_eq(load(r), 0), block[tgt], block[next])` |
| `Jmp(tgt)` | `build_unconditional_branch(block[tgt])` |
| `Call(d, callee_entry, args)` | before the call, `rt_enter` guard (below); `build_call(callee_fn, &[rt_ptr, arg0, ...])`; store result into `alloca(d)` |
| `Ret(r)` | store `load(r)` into `Rr` alloca; `build_unconditional_branch(exit_block)` |
| `Halt` | `build_unconditional_branch(exit_block)` (only `$main` Halts — `partition` guarantees it) |
| fall-through | `build_unconditional_branch(block[next_index])` |

- Get the saturating intrinsic via inkwell's `Intrinsic::find("llvm.uadd.sat").unwrap().get_declaration(&module, &[i64_type.into()])` (confirm the exact inkwell 0.9 `Intrinsic` API against installed docs; if unavailable, declare the intrinsic function by name `@llvm.uadd.sat.i64` manually).

- [ ] **Step 5: Implement the cap guards** (mirror `codegen::emit_guard`, `codegen.rs:358`). Before a back-edge (`Jz`/`Jmp` whose target index ≤ current — a loop) call `rt_tick`; at each `Call` call `rt_enter`; after each faultable op (Task 4) call `rt_faulted`. Each returns i64; branch to the exit block when nonzero:

```
let sig = build_call(rt_tick_fn, &[rt_ptr], "tick").try_as_basic_value().left().unwrap().into_int_value();
let trip = build_int_compare(IntPredicate::NE, sig, i64.const_zero(), "trip");
let cont = ctx.append_basic_block(func, "cont");
build_conditional_branch(trip, exit_block, cont);
position_at_end(cont); // keep translating here
```

- [ ] **Step 6: Run the tests, expect pass.**

Run: `LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm --lib llvm::`
Expected: `arithmetic_and_control_flow` + `faults_are_cap_only_here` PASS. Then confirm the default build is still green: `cargo test --workspace`.

- [ ] **Step 7: Commit.**

```bash
git add crates/redextape-native/src/llvm.rs
git commit -m "feat(native): LLVM IR walk — arithmetic, control flow, calls, cap guards + driver"
```

---

### Task 4: Heap/box ops in the LLVM walk

Add the `rt_*` heap/box calls + fault checks so lists and defunc'd higher-order programs run.

**Files:**
- Modify: `crates/redextape-native/src/llvm.rs`

**Interfaces:**
- Consumes: the Task-3 driver + `translate_subroutine_llvm`.
- Produces: full first-order `Program` support (lists, boxes) on the LLVM backend.

- [ ] **Step 1: Write a failing heap test:**

```rust
#[test]
fn heap_and_higher_order() {
    assert_eq!(llvm_value("head(tail([1, 2, 3]))"), Value::Nat(2));
    assert_eq!(llvm_value("[1,2,3]"), Value::list_of_nats(&[1, 2, 3]));
    assert_eq!(
        llvm_value("fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} head([5,6].map(add1))"),
        Value::Nat(6)
    );
}

#[test]
fn nil_access_faults() {
    let core = desugar(&parse("head(nil)").0.unwrap());
    // head(nil) is higher-order-free but needs defunc? No — direct. Lower directly:
    let prog = lower_asm(&core).unwrap();
    assert!(matches!(compile_and_run(&prog, DEFAULT_CAPS, OptLevel::O0), NativeRun::Fault(_)));
}
```

(For the `map` case, `lower_asm` will reject it as higher-order — the test helper `llvm_value` must retry through `defunc`, mirroring `lower_program`. Update the test helper to `lower_asm(&core).or_else(|e| if matches!(e, LowerError::Unsupported{..}) { defunc(&core).and_then(|d| lower_asm(&d)) } else { Err(e) }).unwrap()`.)

- [ ] **Step 2: Run it, expect failure** (heap ops unimplemented → wrong result or an error).

Run: `LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm heap_and_higher_order`
Expected: FAIL.

- [ ] **Step 3: Implement the heap/box arms** in `translate_subroutine_llvm` (each = a `build_call` to the declared `rt_*` + a `rt_faulted` guard where the op can fault). Mirror `codegen.rs`'s heap arms:

| `Instr` | LLVM |
|---|---|
| `Nil(d)` | `store(alloca(d), i64.const_zero())` |
| `Cons(d, h, t)` | `d = call rt_cons(rt, load(h), load(t))`; then `rt_faulted` guard (heap-cap trip) |
| `Head(d, l)` | `d = call rt_head(rt, load(l))`; `rt_faulted` guard (nil/dangling fault) |
| `Tail(d, l)` | `d = call rt_tail(rt, load(l))`; `rt_faulted` guard |
| `IsEmpty(d, l)` | `d = call rt_is_empty(rt, load(l))` (never faults; no guard) |
| `Box(d, v)` | `d = call rt_box(rt, load(v))`; `rt_faulted` guard (heap-cap) |
| `BoxGet(d, b)` | `d = call rt_box_get(rt, load(b))`; `rt_faulted` guard |
| `BoxSet(b, v)` | `call rt_box_set(rt, load(b), load(v))`; `rt_faulted` guard |

The `rt_faulted` guard is the same brif-to-exit pattern as Step 3.5 (Task 3): call `rt_faulted(rt)`, branch to the exit block if nonzero, else continue in a fresh block. This makes a latched fault short-circuit to the driver's `Fault` classification (matching `run_asm`/the Cranelift path exactly).

- [ ] **Step 4: Run the tests, expect pass; confirm the whole default suite too.**

Run:
```bash
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm --lib llvm::
cargo test --workspace
```
Expected: heap + fault tests PASS; default suite green.

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-native/src/llvm.rs
git commit -m "feat(native): LLVM heap/box ops (rt_* calls + fault guards)"
```

---

### Task 5: Optimization levels + the `llvm-O0 == llvm-O3` differential

Wire `OptLevel` to LLVM's IR pass pipeline and JIT codegen level, and add the optimizer-validation differential.

**Files:**
- Modify: `crates/redextape-native/src/llvm.rs`

**Interfaces:**
- Consumes: the Task-3/4 `build_and_run`.
- Produces: `-O0..-O3` optimization; a passing `llvm-O0 == llvm-O3` test.

- [ ] **Step 1: Write a failing O0==O3 differential test:**

```rust
#[test]
fn o0_equals_o3() {
    let progs = [
        "1 + 2 * 3", "if 2 > 1 { 10 } else { 20 }",
        "fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(20)",
        "head(tail([1, 2, 3]))", "100 * 100",
        "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} head([5,6].map(add1))",
    ];
    for src in progs {
        let core = desugar(&parse(src).0.unwrap());
        let prog = lower_asm(&core).or_else(|e| if matches!(e, LowerError::Unsupported{..}) { defunc(&core).and_then(|d| lower_asm(&d)) } else { Err(e) }).unwrap();
        let o0 = compile_and_run(&prog, DEFAULT_CAPS, OptLevel::O0);
        let o3 = compile_and_run(&prog, DEFAULT_CAPS, OptLevel::O3);
        let expected = run(src).unwrap();
        // Both opt levels must decode to the same (correct) value.
        let (NativeRun::Ran(a), NativeRun::Ran(b)) = (&o0, &o3) else { panic!("{src}: {o0:?} / {o3:?}") };
        assert_eq!(decode_asm(a, &expected).unwrap(), decode_asm(b, &expected).unwrap(), "O0 != O3 for {src}");
        assert_eq!(decode_asm(a, &expected).unwrap(), expected, "O0 wrong for {src}");
    }
}
```

- [ ] **Step 2: Run it, expect failure** (opt not wired — O3 currently == None).

Run: `LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm o0_equals_o3`
Expected: FAIL (or trivially pass because O3 does nothing yet — either way, wire opt next so O3 genuinely optimizes).

- [ ] **Step 3: Wire `OptLevel` in `build_and_run`.** Two knobs:
  - **IR passes:** after defining all functions and BEFORE creating the execution engine, run the new-pass-manager pipeline (skip for `O0`):

    ```rust
    if opt != OptLevel::O0 {
        use inkwell::passes::PassBuilderOptions;
        use inkwell::targets::{InitializationConfig, Target, TargetMachine, RelocMode, CodeModel};
        Target::initialize_native(&InitializationConfig::default()).map_err(|e| internal_error(e))?;
        let triple = TargetMachine::get_default_triple();
        let target = Target::from_triple(&triple).map_err(|e| internal_error(e.to_string()))?;
        let tm = match target.create_target_machine(&triple, "generic", "", llvm_opt(opt), RelocMode::Default, CodeModel::Default) {
            Some(tm) => tm, None => return internal_error("no target machine"),
        };
        let passes = match opt { OptLevel::O1 => "default<O1>", OptLevel::O2 => "default<O2>", _ => "default<O3>" };
        if let Err(e) = module.run_passes(passes, &tm, PassBuilderOptions::create()) { return internal_error(e.to_string()); }
    }
    ```
    (Confirm `run_passes`/`PassBuilderOptions`/`create_target_machine` signatures + the `CodeModel` variant against installed inkwell 0.9 docs; the `default<O_>` pipeline string is stable. Keep every fallible call `?`-free — return `internal_error(...)`, since `build_and_run` returns `NativeRun`.)
  - **JIT codegen level:** define once and use for BOTH the target machine (above) and the execution engine — `fn llvm_opt(o: OptLevel) -> inkwell::OptimizationLevel { use inkwell::OptimizationLevel::*; match o { OptLevel::O0 => None, OptLevel::O1 => Less, OptLevel::O2 => Default, OptLevel::O3 => Aggressive } }` — and pass `llvm_opt(opt)` to `create_jit_execution_engine` (replacing the Task-3 `OptimizationLevel::None`).

  Note: `build_and_run` currently returns `NativeRun`, so `?`/`map_err` sites must return a `NativeRun` on error (wrap with `internal_error`). Restructure to `return internal_error(...)` on each fallible LLVM call, consistent with the rest of the driver (no `?` through a `NativeRun` return — use explicit `match`/`if let Err`).

- [ ] **Step 4: Run the differential + all llvm tests, expect pass.**

Run:
```bash
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm --lib llvm::
```
Expected: `o0_equals_o3` + all prior llvm tests PASS (O3 now genuinely optimizes and still agrees).

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-native/src/llvm.rs
git commit -m "feat(native): LLVM optimization levels (O0-O3) + O0==O3 optimizer-validation differential"
```

---

### Task 6: The full LLVM oracle leg + `llvm_demo`

The differential oracle across backends + a runnable demo.

**Files:**
- Create: `crates/redextape-native/tests/llvm_oracle.rs`
- Create: `crates/redextape-native/examples/llvm_demo.rs`

**Interfaces:**
- Consumes: `redextape_native::{run_native_with, Codegen, OptLevel, NativeRun}`, `redextape_core::{run, run_lambda?, run_tm?, desugar, parser, value::{Value, format_value}, tm::{DEFAULT_CAPS, decode_asm}}`.

- [ ] **Step 1: Write the oracle** `tests/llvm_oracle.rs` (`#![cfg(feature = "llvm")]`). Extend the four-way agreement with the LLVM leg and run the O0==O3 differential over a demo set + generators:

```rust
#![cfg(feature = "llvm")]
use redextape_core::tm::{DEFAULT_CAPS, decode_asm};
use redextape_core::{desugar::desugar, parser::parse, run, tm::{defunc, lower_asm, LowerError}, value::Value};
use redextape_native::{Codegen, NativeRun, OptLevel, run_native_with};

fn prog_lower(src: &str) -> redextape_core::tm::Program {
    let core = desugar(&parse(src).0.unwrap());
    lower_asm(&core).or_else(|e| if matches!(e, LowerError::Unsupported{..}) { defunc(&core).and_then(|d| lower_asm(&d)) } else { Err(e) }).unwrap()
}

fn ran(run: &NativeRun, expected: &Value) -> Value {
    match run { NativeRun::Ran(o) => decode_asm(o, expected).expect("decode"), other => panic!("not Ran: {other:?}") }
}

#[test]
fn reference_cranelift_llvm_agree() {
    let cases = ["1 + 2 * 3", "10 > 3", "[1, 2, 3]",
        "fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(100)",
        "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} [5,6].map(add1)",
        "head(tail([1,2,3]))", "100 * 100"];
    for src in cases {
        let core = desugar(&parse(src).0.unwrap());
        let expected = run(src).unwrap();
        let cl = run_native_with(&core, DEFAULT_CAPS, Codegen::Cranelift);
        let llvm = run_native_with(&core, DEFAULT_CAPS, Codegen::Llvm { opt: OptLevel::O3 });
        assert_eq!(ran(&cl, &expected), expected, "cranelift {src}");
        assert_eq!(ran(&llvm, &expected), expected, "llvm {src}");
    }
}

#[test]
fn llvm_faults_and_caps_match() {
    let head_nil = desugar(&parse("head(nil)").0.unwrap());
    assert!(matches!(run_native_with(&head_nil, DEFAULT_CAPS, Codegen::Llvm { opt: OptLevel::O3 }), NativeRun::Fault(_)));
    let spin = desugar(&parse("fn spin(n){ spin(n) } spin(0)").0.unwrap());
    assert!(matches!(run_native_with(&spin, DEFAULT_CAPS, Codegen::Llvm { opt: OptLevel::O3 }), NativeRun::HitCap));
}
```

(If the existing `native_oracle.rs` has reusable broadened generators, mirror a couple here for the O0==O3 differential over randomized programs — bounded to the first-order set. Keep it a curated + small-proptest set, not a huge run, since each case JIT-compiles twice.)

- [ ] **Step 2: Run the oracle.**

Run: `LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm --test llvm_oracle`
Expected: PASS — reference == cranelift == llvm; llvm faults/caps match.

- [ ] **Step 3: Write `examples/llvm_demo.rs`:**

```rust
//! `cargo run --example llvm_demo -p redextape-native --features llvm` — compile a program to LLVM IR,
//! optimize at -O3, JIT-run it, and show the result (and that -O0 agrees).
#[cfg(feature = "llvm")]
fn main() {
    use redextape_core::tm::{DEFAULT_CAPS, decode_asm};
    use redextape_core::{desugar::desugar, parser::parse, run, value::format_value};
    use redextape_native::{Codegen, NativeRun, OptLevel, run_native_with};

    let src = "fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(100)";
    let core = desugar(&parse(src).0.unwrap());
    let expected = run(src).unwrap();
    println!("program : {src}");
    for (label, opt) in [("-O0", OptLevel::O0), ("-O3", OptLevel::O3)] {
        match run_native_with(&core, DEFAULT_CAPS, Codegen::Llvm { opt }) {
            NativeRun::Ran(o) => println!("llvm {label}: {}", format_value(&decode_asm(&o, &expected).unwrap())),
            other => println!("llvm {label}: {other:?}"),
        }
    }
    println!("(both opt levels agree — the oracle validates -O3)");
}
#[cfg(not(feature = "llvm"))]
fn main() { println!("build with `--features llvm` to run the LLVM demo"); }
```

- [ ] **Step 4: Run the demo + the full default suite + clippy/fmt (all configs).**

Run:
```bash
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo run --example llvm_demo -p redextape-native --features llvm
cargo test --workspace
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo clippy -p redextape-native --features "cranelift llvm" --all-targets -- -D warnings
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
```
Expected: the demo prints `sum(100)` = `5050` at both `-O0` and `-O3`; default suite green; clippy clean in both feature configs; fmt clean.

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-native/tests/llvm_oracle.rs crates/redextape-native/examples/llvm_demo.rs
git commit -m "test(native): LLVM oracle leg (reference==cranelift==llvm) + llvm_demo"
```

---

## Notes for the executor

- **The LLVM toolchain env var** (`LLVM_SYS_<ver>_PREFIX=/opt/homebrew/opt/llvm`) must be set for EVERY `cargo` command that touches the `llvm` feature (build/test/clippy/run). The exact var name + inkwell feature suffix are pinned in Task 1 — use the confirmed values in all later tasks.
- **inkwell 0.9 API drift:** the plan's inkwell calls are pinned to 0.9 but a signature may differ (builder methods return `Result` in 0.9; `Intrinsic`, `run_passes`, `create_target_machine`, and `get_function` are the version-sensitive ones). If something doesn't compile, consult the installed inkwell 0.9 docs (`cargo doc -p inkwell --open`, or the context7 MCP tool) rather than guessing. The plan's *structure* (mirror `codegen::translate_subroutine`; drive on a big-stack thread like `jit.rs`; classify via `Runtime`) is correct regardless of API spelling.
- **The authoritative structural model is `crates/redextape-native/src/codegen.rs`** (`translate_subroutine` at :367, `emit_bin` at :331, `emit_guard` at :358, the `Arg`/`Call` convention, `native_depth_cap`). The LLVM walk must match its semantics arm-for-arm — when in doubt about an instruction's behavior, read the Cranelift arm.
- **Totality is non-negotiable:** every fallible inkwell/JIT/thread call maps to `internal_error(...)` (a `NativeRun::LowerError`), never `?`-through-a-panic or `.unwrap()` on a runtime-reachable path. Test `.unwrap()`s are fine.
- Tasks 3–5 are the LLVM codegen core (opus-tier); Task 1 (toolchain) and Task 6 (oracle/demo) are lighter; Task 2 is a refactor + API (keep the Cranelift suite green).
