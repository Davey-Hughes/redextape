# Native Backend v1 (Cranelift) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile the mini-language to real native machine code — `Core → register-asm → Cranelift IR → JIT → run` — as a fourth oracle leg (`reference == λ == TM == native`), reusing `lower_asm`/`defunc`/`decode_asm` unchanged.

**Architecture:** A new `crates/redextape-native` crate (depends on `redextape-core`; the heavy codegen deps are feature-gated so `redextape-core` stays WASM-clean). A **shared runtime** (heap/box arenas + `rt_*` host functions mirroring `run_asm`'s exact semantics) and a **Cranelift codegen** behind a `NativeCodegen` seam. Native's result is `AsmOutcome`-shaped, so it reuses `decode_asm` and `Caps` verbatim. LLVM (phase 2) and AOT (phase 3) are out of scope for this plan.

**Tech Stack:** Rust (edition 2024). New deps (feature `cranelift`, default): `cranelift-jit`, `cranelift-module`, `cranelift-frontend`, `cranelift-codegen` (one recent, mutually-compatible release set). Design spec: `docs/superpowers/specs/2026-07-23-native-backend-design.md`.

## Global Constraints

- **`redextape-core` stays WASM-clean.** No Cranelift/native dependency may be added to `redextape-core`. All codegen lives in `redextape-native`, behind the `cranelift` feature. A task's "does core still build without native" check is part of its gate.
- **Reuse, don't reinvent.** `lower_asm` + `defunc` (Core→first-order `Program`), `decode_asm` (`AsmOutcome`→`Value`), and `Caps` are REUSED from `redextape-core` verbatim. The native runtime's heap/box/fault semantics MUST match `run_asm`'s exactly (1-based pointers, `0`=nil, saturating monus, same fault conditions) so `decode_asm` and the oracle transfer directly.
- **Native must be TOTAL — no crash on any input.** A generated program that loops or recurses forever must yield `HitCap`, never a hang or a native stack overflow. Enforce two caps: a **step cap** (`caps.steps`, checked via `rt_tick` at loop back-edges) and a **recursion-depth cap** (`caps.stack`, checked via `rt_enter` at function entry, BEFORE recursing). Run the JIT'd entry on a dedicated thread with a large stack (≥ 64 MiB) as defense-in-depth. A runtime fault (`head`/`tail`/`box_get`/`box_set` of nil/dangling) yields `Fault`, never UB.
- **Never a silent wrong answer.** The oracle is the gate: `native == asm-interp == reference` (and `== λ == TM` on the bounded suite). Any disagreement is a bug, not a tolerance.
- **The supported set == the TM's.** Native runs exactly the first-order `Program` that `lower_asm`+`defunc` produce; a higher-order program `defunc` rejects → `NativeRun::LowerError`, identically to `run_tm`.
- **Semantics mirror `run_asm` exactly** (the intermediate oracle already validates `reference == asm-interp`): `Bin(Sub,..)` is saturating monus; comparisons yield `0`/`1`; `Reg` reads of an unset register are `0`; `Nil` = `0`; `Cons` pushes a `(head,tail)` cell and returns its 1-based index; `Head`/`Tail`/`BoxGet`/`BoxSet` fault on pointer `0` or past-end.
- clippy clean (`cargo clippy --workspace --all-targets -- -D warnings`), `cargo fmt` applied, before every commit.

## Reference: the exact `redextape-core` contract native consumes

- `tm::asm::Instr` (16 variants): `Li(Reg,u64)`, `Mov(Reg,Reg)`, `Bin(BinOp,Reg,Reg,Reg)`, `Jz(Reg,String)`, `Jmp(String)`, `Call(String)`, `Ret`, `Halt`, `Nil(Reg)`, `Cons(Reg,Reg,Reg)`, `Head(Reg,Reg)`, `Tail(Reg,Reg)`, `IsEmpty(Reg,Reg)`, `Box(Reg,Reg)`, `BoxGet(Reg,Reg)`, `BoxSet(Reg,Reg)`.
- `tm::asm::Reg`: `Loc(u32)` (frame-local), `Arg(u32)` (volatile arg-passing), `Rr` (call/program result).
- `core::BinOp`: `Add`, `Sub` (monus), `Mul`, `Eq`, `Ne`, `Lt`, `Le`, `Gt`, `Ge`.
- `tm::asm::Program { code: Vec<Instr>, labels: Vec<(String, usize)> }`; `label_index(name) -> Option<usize>`. Execution starts at index 0. `lower_asm` lays out `main` (ending `Halt`) then each `fn` as a contiguous subroutine ending `Ret`; `Call`-target labels are subroutine entries.
- `tm::asm::Caps { steps, stack, heap, mem }`; `tm::asm::DEFAULT_CAPS`. Reused as-is (`steps`→step cap, `stack`→recursion-depth cap, `heap`→arena bound).
- `tm::asm::AsmOutcome { result: u64, heap: Vec<(u64,u64)> }`; `tm::asm::decode_asm(&AsmOutcome, &Value) -> Option<Value>` (type-directed; boxes never decoded). REUSED.
- `tm::{lower_asm(&Core) -> Result<Program, LowerError>, defunc(&Core) -> Result<Core, LowerError>, run_asm(&Program, Caps) -> AsmRun}`; `LowerError::{Unsupported, TooDeep}`. `run_tm`'s `lower_program` (try `lower_asm`; on `Unsupported` retry `defunc`+`lower_asm`; `TooDeep` returns immediately) is the template to copy.
- `core::Core`, `value::Value`, `run(&str) -> Result<Value, RunError>`.

## File Structure

- `crates/redextape-native/Cargo.toml` — **create.** Deps: `redextape-core` (path), cranelift crates (feature `cranelift`, default). `llvm` feature declared but empty (phase 2). (Task 1)
- `Cargo.toml` (workspace root) — **modify.** Add `crates/redextape-native` to `members`. (Task 1)
- `crates/redextape-native/src/lib.rs` — **create/grow.** `NativeRun`, `run_native`, the `NativeCodegen` seam, re-exports. (Tasks 1, 5)
- `crates/redextape-native/src/runtime.rs` — **create.** `Runtime` + `rt_*` host functions. (Task 2)
- `crates/redextape-native/src/analysis.rs` — **create.** Subroutine partitioning + arity/label/register analysis. (Task 3)
- `crates/redextape-native/src/cranelift_backend.rs` — **create.** `#[cfg(feature = "cranelift")]` asm→Cranelift IR→JIT codegen. (Task 4)
- `crates/redextape-native/examples/native_demo.rs` — **create.** (Task 5)
- `crates/redextape-native/tests/native_oracle.rs` — **create.** The 4-way oracle + `native == asm-interp` + large-value legs + proptest. (Task 6)

## Interfaces (produced across tasks)

- `redextape_native::NativeRun` = `{ Ran(AsmOutcome), HitCap, Fault(String), LowerError(LowerError) }` (Task 1). Decoding is separate (`decode_asm`), mirroring `run_tm`+`decode_tape`.
- `redextape_native::run_native(&Core, Caps) -> NativeRun` (Task 5).
- `redextape_native::runtime::Runtime` + `extern "C"` host fns `rt_cons`/`rt_head`/`rt_tail`/`rt_is_empty`/`rt_box`/`rt_box_get`/`rt_box_set`/`rt_tick`/`rt_enter` (Task 2).
- `redextape_native::analysis::{Subroutine, partition(&Program) -> Result<Vec<Subroutine>, LowerError>}` where `Subroutine { name, entry, code_range, arity, n_locals, block_labels }` (Task 3).
- `redextape_native::NativeCodegen` seam: `fn compile_and_run(prog: &Program, caps: Caps) -> NativeRun` (Task 4).

---

### Task 1: Crate scaffold — `redextape-native`, workspace, feature flags

**Files:**
- Create: `crates/redextape-native/Cargo.toml`, `crates/redextape-native/src/lib.rs`
- Modify: `Cargo.toml` (workspace `members`)

**Interfaces:**
- Produces: the crate; `NativeRun` enum; `run_native` signature (stub); `cranelift` (default) / `llvm` features.

- [ ] **Step 1: Write the failing test** (`crates/redextape-native/src/lib.rs`, a `#[cfg(test)]` mod)

```rust
#[test]
fn crate_builds_and_exposes_run_native() {
    // A trivial smoke test: the public surface exists and links.
    use redextape_core::tm::DEFAULT_CAPS;
    use redextape_core::desugar::desugar;
    use redextape_core::parser::parse;
    let core = desugar(&parse("1 + 2").0.unwrap());
    // Stub returns LowerError for now (real codegen lands in Task 4/5); just prove it links + runs.
    let _ = crate::run_native(&core, DEFAULT_CAPS);
}
```

- [ ] **Step 2: Write `Cargo.toml`**

```toml
[package]
name = "redextape-native"
version = "0.0.0"
edition = "2024"
license = "GPL-3.0-only"

[features]
default = ["cranelift"]
cranelift = ["dep:cranelift-jit", "dep:cranelift-module", "dep:cranelift-frontend", "dep:cranelift-codegen"]
llvm = [] # phase 2

[dependencies]
redextape-core = { path = "../redextape-core" }
cranelift-jit = { version = "<current>", optional = true }
cranelift-module = { version = "<current>", optional = true }
cranelift-frontend = { version = "<current>", optional = true }
cranelift-codegen = { version = "<current>", optional = true }

[lints]
workspace = true
```

Pin `<current>` to one mutually-compatible recent release set (all four cranelift crates share a version). Verify `cargo build -p redextape-native` resolves them.

- [ ] **Step 3: Write the `lib.rs` skeleton**

```rust
//! The native backend: Core -> register-asm -> machine code (JIT), a fourth oracle leg.
use redextape_core::core::Core;
use redextape_core::tm::{AsmOutcome, Caps, LowerError};

pub mod runtime; // Task 2
#[cfg(feature = "cranelift")]
pub mod cranelift_backend; // Task 4
pub mod analysis; // Task 3

/// The outcome of running a program natively. Decoding to a `Value` is separate (`decode_asm`),
/// mirroring `run_tm` + `decode_tape`.
#[derive(Clone, Debug)]
pub enum NativeRun {
    Ran(AsmOutcome),
    HitCap,
    Fault(String),
    LowerError(LowerError),
}

/// Lower `core` (reusing lower_asm/defunc), JIT-compile, and run. Panic-free, bounded by `caps`.
pub fn run_native(_core: &Core, _caps: Caps) -> NativeRun {
    // Stub until Task 5 wires lower_program + the codegen.
    NativeRun::LowerError(LowerError::Unsupported { node: Default::default(), what: "not yet implemented".into() })
}
```

(Adjust the `LowerError::Unsupported` construction to the real field types — check `lower_asm.rs`; `node` is a `NodeId`. If `NodeId: Default` doesn't hold, use any valid placeholder or return a different stub variant. The point is a linkable stub.)

- [ ] **Step 4: Wire the workspace** — add `"crates/redextape-native"` to root `Cargo.toml` `members`.

- [ ] **Step 5: Run**

Run: `cargo build -p redextape-native && cargo test -p redextape-native --lib && cargo build -p redextape-core` (the last confirms core still builds independently).
Expected: all pass; `redextape-core` has no cranelift in its dependency tree (`cargo tree -p redextape-core | grep -i cranelift` prints nothing).

- [ ] **Step 6: fmt, clippy, commit**

```bash
cargo fmt && cargo clippy -p redextape-native --all-targets 2>&1 | tail -5
git add -A && git commit -m "feat(native): scaffold redextape-native crate (cranelift feature)"
```

---

### Task 2: The runtime — heap/box arenas + `rt_*` host functions

**Files:**
- Create: `crates/redextape-native/src/runtime.rs`
- Test: same file

**Interfaces:**
- Produces: `Runtime { heap: Vec<(u64,u64)>, boxes: Vec<u64>, steps: u64, depth: u64, caps: Caps, fault: Option<String>, hit_cap: bool }` and `extern "C"` host functions taking `*mut Runtime`: `rt_cons(rt, h, t) -> u64`, `rt_head(rt, p) -> u64`, `rt_tail(rt, p) -> u64`, `rt_is_empty(rt, p) -> u64`, `rt_box(rt, v) -> u64`, `rt_box_get(rt, p) -> u64`, `rt_box_set(rt, p, v)`, `rt_tick(rt) -> u64`, `rt_enter(rt) -> u64`, `rt_leave(rt)`.
- Consumes: `redextape_core::tm::Caps`.

**Semantics (mirror `run_asm` EXACTLY):** 1-based pointers, `0` = nil. `rt_cons` checks `heap.len() >= caps.heap` → set `hit_cap`, return 0; else push, return `len` (1-based). `rt_head`/`rt_tail`: `p==0` or `p>heap.len()` → set `fault`, return 0; else return the cell's head/tail. `rt_box` pushes to `boxes`, returns 1-based index (cap-checked). `rt_box_get`/`rt_box_set`: `p==0`/dangling → fault. `rt_tick`: `steps += 1`; if `steps > caps.steps` → set `hit_cap`, return 1 (signal); else 0. `rt_enter`: `depth += 1`; if `depth > caps.stack` → `hit_cap`, return 1; else 0. `rt_leave`: `depth -= 1`. Once `fault`/`hit_cap` is set, faultable ops become no-ops returning 0 (the generated code will branch out).

- [ ] **Step 1: Write the failing tests** (`runtime.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::tm::DEFAULT_CAPS;

    fn rt() -> Runtime { Runtime::new(DEFAULT_CAPS) }

    #[test]
    fn cons_then_head_and_tail() {
        let mut r = rt();
        let p = unsafe { rt_cons(&mut r, 7, 0) }; // cons(7, nil)
        assert_eq!(p, 1);
        assert_eq!(unsafe { rt_head(&mut r, p) }, 7);
        assert_eq!(unsafe { rt_tail(&mut r, p) }, 0);
        assert_eq!(unsafe { rt_is_empty(&mut r, p) }, 0);
        assert_eq!(unsafe { rt_is_empty(&mut r, 0) }, 1);
        assert!(r.fault.is_none() && !r.hit_cap);
    }

    #[test]
    fn box_roundtrip_and_in_place_set() {
        let mut r = rt();
        let b = unsafe { rt_box(&mut r, 5) };
        assert_eq!(unsafe { rt_box_get(&mut r, b) }, 5);
        unsafe { rt_box_set(&mut r, b, 9) };
        assert_eq!(unsafe { rt_box_get(&mut r, b) }, 9);
    }

    #[test]
    fn head_of_nil_and_dangling_fault() {
        let mut r = rt();
        let _ = unsafe { rt_head(&mut r, 0) };
        assert!(r.fault.is_some());
        let mut r2 = rt();
        let _ = unsafe { rt_tail(&mut r2, 99) }; // dangling
        assert!(r2.fault.is_some());
    }

    #[test]
    fn tick_and_enter_hit_their_caps() {
        let mut r = Runtime::new(Caps { steps: 3, stack: 2, ..DEFAULT_CAPS });
        for _ in 0..3 { assert_eq!(unsafe { rt_tick(&mut r) }, 0); }
        assert_eq!(unsafe { rt_tick(&mut r) }, 1); // 4th tick trips steps=3
        assert!(r.hit_cap);
        let mut r2 = Runtime::new(Caps { steps: 999, stack: 2, ..DEFAULT_CAPS });
        assert_eq!(unsafe { rt_enter(&mut r2) }, 0);
        assert_eq!(unsafe { rt_enter(&mut r2) }, 0);
        assert_eq!(unsafe { rt_enter(&mut r2) }, 1); // 3rd enter trips stack=2
    }
}
```

- [ ] **Step 2: Run to verify they fail** — `cargo test -p redextape-native --lib runtime` (compile error / missing items).

- [ ] **Step 3: Implement `Runtime` + the `rt_*` functions** per the semantics above. Each `rt_*` is `pub unsafe extern "C" fn name(rt: *mut Runtime, ...) -> u64` (dereference `rt`, mirror the corresponding `run_asm` arm). Add `Runtime::new(caps) -> Runtime` and `Runtime::into_outcome(self, result) -> AsmOutcome { AsmOutcome { result, heap: self.heap } }`.

- [ ] **Step 4: Run to verify they pass** — `cargo test -p redextape-native --lib runtime`.

- [ ] **Step 5: fmt, clippy, commit** (`feat(native): runtime heap/box arenas + rt_* host functions`).

---

### Task 3: Analysis — subroutine partitioning + arity/register/label scan

**Files:**
- Create: `crates/redextape-native/src/analysis.rs`
- Test: same file

**Interfaces:**
- Produces: `Subroutine { name: String, entry: usize, code_range: Range<usize>, arity: u32, n_locals: u32, internal_labels: Vec<(String, usize)> }` and `partition(prog: &Program) -> Result<Vec<Subroutine>, LowerError>`.
- Consumes: `Program`, `Instr`, `Reg`.

**What it computes:** Entry set = `{0}` (main) ∪ `{label_index(l) for every Call target l}`. Sort entries ascending; each subroutine spans `[entry_i, entry_{i+1})` (main is the first; the last runs to `code.len()`). Assert subroutines are contiguous and each non-main ends in `Ret` (main ends in `Halt`) — if not, return `LowerError::Unsupported` (defensive: the layout assumption failed). For each subroutine: `arity` = `1 + max Arg(i) read` (0 if none); `n_locals` = `1 + max Loc(i) referenced` (0 if none); `internal_labels` = labels whose index is within the range and are NOT Call-target entries (these become basic blocks; Call-target labels are function boundaries). Also validate every `Jz`/`Jmp` target is within the same subroutine (an intra-subroutine jump) — a cross-subroutine jump would be a lowering invariant break → `Unsupported`.

- [ ] **Step 1: Write the failing tests** (build `Program`s by hand — mirror `asm.rs`'s own tests)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::tm::{Instr, Program, Reg};
    use redextape_core::core::BinOp;

    #[test]
    fn partitions_main_and_one_subroutine() {
        // main: call f; halt    |    f: rr = a0 + a0; ret
        let prog = Program {
            code: vec![
                Instr::Call("f".into()), Instr::Halt,                                  // 0,1  main
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Arg(0), Reg::Arg(0)), Instr::Ret, // 2,3  f
            ],
            labels: vec![("f".into(), 2)],
        };
        let subs = partition(&prog).unwrap();
        assert_eq!(subs.len(), 2);
        assert_eq!(subs[0].name, "$main");
        assert_eq!(subs[0].code_range, 0..2);
        assert_eq!(subs[1].name, "f");
        assert_eq!(subs[1].code_range, 2..4);
        assert_eq!(subs[1].arity, 1);   // reads Arg(0)
    }

    #[test]
    fn internal_label_is_a_block_not_a_boundary() {
        // one subroutine (main) with an internal jump target `end`
        let prog = Program {
            code: vec![Instr::Jmp("end".into()), Instr::Li(Reg::Rr, 9), Instr::Halt],
            labels: vec![("end".into(), 2)],
        };
        let subs = partition(&prog).unwrap();
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].internal_labels, vec![("end".to_string(), 2)]);
    }
}
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement `partition`** per the spec above (all analysis is a linear scan of `code` + `labels`; iterative, panic-free — on any invariant violation return `LowerError::Unsupported`, never panic). Use `redextape_core::tm::asm`'s `Instr`/`Reg` pattern matching to find Call targets, Arg/Loc indices, and jump targets.
- [ ] **Step 4: Run to verify they pass.** Also add a test that a genuine `lower_asm` output partitions cleanly: `partition(&lower_asm(&desugar(&parse("fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(3)").0.unwrap())).unwrap())` returns `Ok` with a `sum` subroutine of arity 1.
- [ ] **Step 5: fmt, clippy, commit** (`feat(native): asm subroutine partitioning + arity/label analysis`).

---

### Task 4: The Cranelift codegen — asm → Cranelift IR → JIT

> The hard task. Use the most capable model. The tests (`native codegen == run_asm`) are the exact contract; author the Cranelift IR against them, following the canonical `cranelift-jit-demo` toy-compiler for the current `cranelift-jit`/`cranelift-frontend` API (verify the version's exact calls — do not guess).

**Files:**
- Create: `crates/redextape-native/src/cranelift_backend.rs` (`#[cfg(feature = "cranelift")]`)
- Test: same file (compile + run hand-built `Program`s; compare to `run_asm`)

**Interfaces:**
- Produces: `pub fn compile_and_run(prog: &Program, caps: Caps) -> NativeRun` — JIT-compiles `prog` and runs it against a fresh `Runtime`, returning `NativeRun::{Ran(AsmOutcome), HitCap, Fault, LowerError}`.
- Consumes: `analysis::partition`, `runtime::{Runtime, rt_*}`, the cranelift crates.

**The codegen model (the contract to implement):**
- **One Cranelift function per subroutine** (from `partition`). Signature: `arity` params of type `I64`, one `I64` return (the subroutine's `Rr`). All values are `I64` (a `u64` word — Nat / Bool 0-1 / pointer). Calling convention: default (`system_v`/host).
- **A hidden runtime pointer.** Every function also takes the `*mut Runtime` as its first param (an `I64` holding the pointer), threaded through every call, so `rt_*` host functions can be invoked. (Declare the `rt_*` functions as imported symbols in the `JITModule` via `symbol(...)`/`JITBuilder::symbol`; call them with `module.declare_func_in_func` + `builder.ins().call`.)
- **Registers → Cranelift `Variable`s** within each function: one `Variable` per `Loc(i)` (init 0) and per `Arg(i)` (init from the function's params); a `Variable` for `Rr`. `read(Reg)` → `builder.use_var`; `write(Reg)` → `builder.def_var`. The native call stack gives the asm frame convention for free (each function's `Loc`/`Arg` Variables are its own — `Loc` preserved across calls, `Arg` volatile).
- **Blocks:** the entry block per function, plus one Cranelift block per `internal_label`. `Jz(r, l)` → `builder.ins().brif(use_var(r)==0, block_l, fallthrough)`; `Jmp(l)` → `jump block_l`; fall-through between consecutive non-terminator instrs → an implicit `jump` to the next block (or straight-line within a block). `Ret`/`Halt` → set up the return path.
- **Instruction translation:**
  - `Li(rd, n)` → `def_var(rd, iconst n)`.
  - `Mov(rd, rs)` → `def_var(rd, use_var(rs))`.
  - `Bin(op, rd, ra, rb)` → `iadd`/saturating-`isub`(monus: `a - min(a,b)`, i.e. `usub` then select, or `icmp`+select)/`imul`; comparisons → `icmp` + `bint` to 0/1 matching `run_asm`.
  - `Nil(rd)` → `def_var(rd, iconst 0)`.
  - `Cons`/`Head`/`Tail`/`IsEmpty`/`Box`/`BoxGet`/`BoxSet` → `call rt_*(rt_ptr, args...)`; after each faultable op (`Head`/`Tail`/`BoxGet`/`BoxSet`/`Cons` cap), emit a check of the runtime's `fault`/`hit_cap` flag (via an `rt_faulted(rt)->u64` helper, or read the flag through a pointer) and `brif` to a shared fault-exit block that returns a sentinel and stops.
  - `Call(l)` → `call rt_enter(rt)`; brif hit_cap → cap-exit; else gather `Arg(0..callee.arity)` Variables + the rt pointer, `call fn_l(...)`, `def_var(Rr, result)`, `call rt_leave(rt)`.
  - `Ret` → `return use_var(Rr)`. `Halt` → in `main`, `return use_var(Rr)`.
  - Loop safety: before a **backward** `Jz`/`Jmp` (target index ≤ current), emit `call rt_tick(rt)` + brif hit_cap → cap-exit.
- **Driver `compile_and_run`:** `partition(prog)` (→ `LowerError` on failure); build a `JITModule` with the `rt_*` symbols registered; declare all subroutine functions; define each (translate its instrs); `module.finalize_definitions()`; get `$main`'s function pointer; allocate a `Runtime::new(caps)`; **run `main(rt_ptr)` on a dedicated ≥64 MiB-stack thread**; after it returns, inspect the `Runtime`: if `hit_cap` → `HitCap`; if `fault` → `Fault(msg)`; else `Ran(runtime.into_outcome(returned_word))`.

- [ ] **Step 1: Write the failing tests** — the contract is "native agrees with `run_asm` on hand-built Programs":

```rust
#[cfg(all(test, feature = "cranelift"))]
mod tests {
    use super::*;
    use redextape_core::tm::{run_asm, AsmRun, DEFAULT_CAPS, Instr, Program, Reg};
    use redextape_core::core::BinOp;

    /// native `compile_and_run` must agree with `run_asm` (Ran outcome, same result + heap).
    fn agree(prog: Program) {
        let native = compile_and_run(&prog, DEFAULT_CAPS);
        match (run_asm(&prog, DEFAULT_CAPS), native) {
            (AsmRun::Ran(a), NativeRun::Ran(n)) => assert_eq!(a, n, "outcome mismatch"),
            (AsmRun::Fault(_), NativeRun::Fault(_)) => {}
            (AsmRun::HitCap, NativeRun::HitCap) => {}
            (a, n) => panic!("native vs asm-interp mismatch:\n asm={a:?}\n native={n:?}"),
        }
    }

    #[test] fn arithmetic() {
        agree(Program { code: vec![
            Instr::Li(Reg::Loc(0), 2), Instr::Li(Reg::Loc(1), 3),
            Instr::Bin(BinOp::Mul, Reg::Rr, Reg::Loc(0), Reg::Loc(1)), Instr::Halt,
        ], labels: vec![] }); // 6
    }
    #[test] fn monus_saturates() {
        agree(Program { code: vec![
            Instr::Li(Reg::Loc(0), 3), Instr::Li(Reg::Loc(1), 5),
            Instr::Bin(BinOp::Sub, Reg::Rr, Reg::Loc(0), Reg::Loc(1)), Instr::Halt,
        ], labels: vec![] }); // 0
    }
    #[test] fn branch_and_compare() { /* Jz over a block; == yields 0/1 */ /* build like asm.rs tests */ }
    #[test] fn builds_and_reads_a_list() {
        // rr = head(tail(cons(1, cons(2, nil)))) == 2  (copy asm.rs's `builds_and_reads_a_list`)
        agree(/* the same Program */ Program { code: vec![], labels: vec![] });
    }
    #[test] fn recursion_sum() {
        // the sum(n) recursion Program from asm.rs's tests — verifies Call/Ret + frames + Arg passing
    }
    #[test] fn head_of_nil_faults() { /* agree() with a head(nil) Program → both Fault */ }
    #[test] fn infinite_loop_hits_cap() {
        // Program { Jmp("loop") @0, label loop@0 } with a small steps cap → both HitCap
        let prog = Program { code: vec![Instr::Jmp("loop".into())], labels: vec![("loop".into(), 0)] };
        assert!(matches!(compile_and_run(&prog, Caps { steps: 1000, ..DEFAULT_CAPS }), NativeRun::HitCap));
    }
    #[test] fn infinite_recursion_hits_cap_without_stack_overflow() {
        // f: call f; ret   — must HitCap (recursion-depth cap), NOT crash.
        let prog = Program { code: vec![Instr::Call("f".into())], labels: vec![("f".into(), 0)] };
        assert!(matches!(compile_and_run(&prog, Caps { stack: 5000, ..DEFAULT_CAPS }), NativeRun::HitCap));
    }
}
```

(Fill the `/* ... */` Programs by copying the corresponding hand-built Programs from `redextape-core/src/tm/asm.rs`'s own `mod tests` — they already exercise arithmetic, branches, lists, `is_empty`, faults, and the `sum` recursion. `agree()` cross-checks each against `run_asm`.)

- [ ] **Step 2: Run to verify they fail** (no `compile_and_run` yet).
- [ ] **Step 3: Implement `compile_and_run`** per the model above, authoring the Cranelift IR against the tests. Start with the straight-line subset (Li/Mov/Bin/Halt), then branches (Jz/Jmp/blocks), then heap ops (rt_* calls + fault checks), then Call/Ret (functions + rt_enter/tick/leave). Iterate against `agree()` until every test passes. Follow `cranelift-jit-demo` for the exact `JITBuilder`/`JITModule`/`FunctionBuilder`/`InstBuilder`/`Variable`/`declare_func_in_func` API of the pinned version.
- [ ] **Step 4: Run to verify they pass** — `cargo test -p redextape-native --lib cranelift_backend`.
- [ ] **Step 5: fmt, clippy, commit** (`feat(native): Cranelift JIT codegen (asm -> machine code)`).

---

### Task 5: `run_native` wiring + caps/faults + demo

**Files:**
- Modify: `crates/redextape-native/src/lib.rs` (`run_native`)
- Create: `crates/redextape-native/examples/native_demo.rs`
- Test: `lib.rs` tests

**Interfaces:**
- Consumes: `lower_asm`/`defunc` (the `lower_program` template), `compile_and_run` (Task 4), `decode_asm`.
- Produces: `run_native(&Core, Caps) -> NativeRun`; end-to-end Core→native.

- [ ] **Step 1: Write the failing tests** (`lib.rs`)

```rust
#[cfg(all(test, feature = "cranelift"))]
mod run_native_tests {
    use super::*;
    use redextape_core::tm::{decode_asm, DEFAULT_CAPS};
    use redextape_core::{run, desugar::desugar, parser::parse, value::Value};

    fn native_value(src: &str) -> Value {
        let core = desugar(&parse(src).0.unwrap());
        let expected = run(src).unwrap();
        match run_native(&core, DEFAULT_CAPS) {
            NativeRun::Ran(o) => decode_asm(&o, &expected).expect("decode"),
            other => panic!("native did not run {src}: {other:?}"),
        }
    }

    #[test] fn end_to_end_values() {
        assert_eq!(native_value("1 + 2 * 3"), Value::Nat(7));
        assert_eq!(native_value("3 - 5"), Value::Nat(0));
        assert_eq!(native_value("if 2 > 1 { 10 } else { 20 }"), Value::Nat(10));
        assert_eq!(native_value("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"), Value::Nat(15));
        assert_eq!(native_value("head(tail([1, 2, 3]))"), Value::Nat(2));
        // Escapes FIELD_WIDTH: a value the TM can't represent (> 64).
        assert_eq!(native_value("100 * 100"), Value::Nat(10_000));
    }

    #[test] fn higher_order_defuncs_and_runs() {
        assert_eq!(native_value("fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} head([5,6].map(add1))"), Value::Nat(6));
    }

    #[test] fn faults_and_caps() {
        let core = desugar(&parse("head(nil)").0.unwrap());
        assert!(matches!(run_native(&core, DEFAULT_CAPS), NativeRun::Fault(_)));
        let spin = desugar(&parse("fn spin(n){ spin(n) } spin(0)").0.unwrap());
        assert!(matches!(run_native(&spin, DEFAULT_CAPS), NativeRun::HitCap));
    }
}
```

- [ ] **Step 2: Run to verify they fail** (stub still returns LowerError).
- [ ] **Step 3: Implement `run_native`** = copy `run_tm`'s `lower_program` (try `lower_asm(core)`; on `Unsupported` retry `defunc(core)`+`lower_asm`; `TooDeep` → `NativeRun::LowerError` immediately) → `cranelift_backend::compile_and_run(&prog, caps)`. (When `cranelift` is disabled, `run_native` returns `LowerError`/an unsupported outcome — keep it compiling without the feature.)
- [ ] **Step 4: Write `examples/native_demo.rs`** — mirror `tm_demo`: run a handful of programs through `run_native`, decode, print `program → native result`, and show a `> 64` value the TM can't do (the native headline). Run it.
- [ ] **Step 5: Run to verify they pass** — `cargo test -p redextape-native && cargo run --example native_demo -p redextape-native`.
- [ ] **Step 6: fmt, clippy, commit** (`feat(native): run_native wiring + native_demo`).

---

### Task 6: The four-way oracle

**Files:**
- Create: `crates/redextape-native/tests/native_oracle.rs`
- Test: itself

**Interfaces:**
- Consumes: `run`, `run_lambda`, `run_tm`, `run_asm`, `run_native`, `decode`/`decode_tape`/`decode_asm`.

- [ ] **Step 1: Write the oracle tests.**
  - `assert_four_way(src)`: `reference == λ == TM == native` on a value (extend the three-way demo list — reuse a subset of `redextape-core`'s `FIRST_ORDER_DEMOS`).
  - `assert_native_matches_asm(src)`: the primary new cross-check — `run_native` decodes to the same `Value` as `run_asm` for any first-order program (they share the `Program`; compile vs interpret must agree).
  - `native_runs_beyond_field_width`: programs with values `> 64` (`100 * 100`, `let n = 200; n + n`, a 100-element list) — `native == reference`, where the TM would be out of representable range. This is native's distinctive leg.
  - `faults_diverge`: `head(nil)`/`tail(nil)` → `NativeRun::Fault` and reference `Runtime`.
  - A `proptest` reusing the bounded arithmetic/list generator shape (values need NOT stay `< 64` for native — use a wider range, e.g. `0..10_000`) asserting `native == reference` (and `native == asm-interp`).

- [ ] **Step 2: Run** — `cargo test -p redextape-native --test native_oracle`. Expected: all pass (native is a validated 4th leg). If any disagreement surfaces, it's a real codegen bug — fix in Task 4, do not weaken the oracle.
- [ ] **Step 3: fmt, clippy, commit** (`test(native): four-way oracle + native==asm-interp + beyond-FIELD_WIDTH`).

---

## Final Whole-Branch Review

Dispatch the broad review (most capable model). Branch-specific focus:
- **Totality:** can any Program crash native (native stack overflow on deep recursion despite the depth cap; a fault/cap flag not checked after a faultable op leading to a wrong answer or UB; the JIT'd `main` panicking)? Probe deep recursion at exactly the `caps.stack` boundary, a fault mid-list-build, and a `Cons` at the heap cap.
- **Semantics parity with `run_asm`:** monus, comparison 0/1, unset-register-reads-0, 1-based/nil pointer discipline — any drift makes `native != asm-interp`.
- **The calling convention:** `Arg` volatility + `Loc` preservation across `Call` — probe mutual/deep recursion and a program that relies on `Loc` surviving a call.
- **WASM-cleanliness:** `redextape-core`'s dependency tree still has no cranelift.
- **No weakened oracle:** the four-way / `native==asm-interp` / beyond-64 assertions genuinely compare decoded values.

## Self-Review (completed)

- **Spec coverage:** crate+features (T1), runtime (T2), analysis (T3), codegen (T4), wiring+demo (T5), oracle (T6) — every element of the design spec's Phase 1 is covered. LLVM/AOT explicitly deferred (spec phases 2/3).
- **Type consistency:** `NativeRun` (T1) carries `AsmOutcome` (reused) decoded by `decode_asm` (reused); `Caps` reused; `partition`→`Subroutine` (T3) consumed by `compile_and_run` (T4); `run_native` (T5) uses the `lower_program` template + `compile_and_run` + `decode_asm`. `rt_*` signatures (T2) match the codegen's declared imports (T4).
- **Placeholder scan:** the Cranelift-specific IR calls (T4) are specified as a model + contract + tests + the `cranelift-jit-demo` reference — the honest maximum for an external, version-drifting API (authored-against-tests, like the TM gadgets). The Cargo version `<current>` is a deliberate "pin at implementation time" instruction, not a gap.
