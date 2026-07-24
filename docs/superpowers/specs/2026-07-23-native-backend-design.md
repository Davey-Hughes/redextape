# Native Backend — Design Spec

> **Status:** approved design (2026-07-23), pending the implementation plan(s).
> **Context:** Plans 1–3 + 3b are complete — `Core → { reference tree-walker, λ-calculus, register-asm → multi-tape TM }`, with the three-way oracle `reference == λ == TM` broadened (randomized generators + metamorphic laws). This spec adds a **fourth execution path**: `Core → register-asm → native machine code`.

## Goal

Compile the mini-language all the way down to **real machine code running on the physical CPU** — the one execution path the project doesn't yet have (it interprets, reduces, and simulates, but never *compiles to hardware*). This completes the Church–Turing picture and yields a genuinely runnable native artifact.

Concretely, the native backend reuses the existing `lower_asm` + `defunc` **unchanged** (it consumes the same first-order `Program` the TM does) and adds only: an asm→native **codegen**, a small **runtime**, and a type-directed **decode**. It slots into the oracle as a fourth leg.

### Honest value proposition (what native does and does NOT uniquely provide)

- **DOES (the headline):** a genuinely *compiled* backend — actual machine code, a real runnable binary (phase 3), and the pedagogical completion "interpret / reduce / simulate / **compile**."
- **DOES:** it is the **prerequisite for the optimizing-compiler track's Tier C** (LLVM `-O3` native optimization) — the deep-opt goal has nowhere to live without a native backend.
- **DOES:** an **independent-codegen cross-check** — `native == asm-interp` (compile vs. interpret are different code paths, so this catches a codegen bug in either).
- **DOES:** **speed** — runs larger/longer programs than the interpreter can practically test.
- **Does NOT uniquely** "escape `FIELD_WIDTH`": the **asm interpreter already runs on `u64`** with no `FIELD_WIDTH` bound (that bound is the TM's alone). So testing large values against the reference is *already* partly covered by the existing asm-interp oracle leg. Native extends the practical reach (native speed) but is not the sole way to exceed 64.

## Non-goals (deferred)

- **Maximal native performance in v1.** v1 (Cranelift) targets CORRECTNESS (a working compiled leg), not `-O3` speed. Deep native optimization is phase 2 (LLVM) and the optimizer track's Tier C.
- **Optimization passes.** Core→Core / asm→asm optimization is a *separate* track (benefits all backends); the native backend only *consumes* asm.
- **AOT binary emission in v1.** v1 JIT-compiles-and-runs in-process (what the oracle needs). Emitting a real `.o`/executable artifact is phase 3.
- **Anything the asm doesn't already express.** Native runs exactly the first-order `Program` that `lower_asm` + `defunc` produce — same supported set as the TM (a higher-order program `defunc` rejects → `LowerError`, identically).

## Architecture

### A separate crate: `crates/redextape-native`

`redextape-core` is destined to compile to WASM (Plan 4). A native JIT/codegen dependency (Cranelift, and later LLVM) **cannot** live in a WASM-bound crate. So the native backend is a **separate crate** that depends on `redextape-core`:

```
crates/redextape-native/
  Cargo.toml         # features: `cranelift` (default), `llvm`
  src/
    lib.rs           # run_native(...) entry point + NativeRun; the NativeCodegen seam
    runtime.rs       # SHARED: the heap arena + host alloc/fault/cap functions
    decode.rs        # SHARED: native representation → Value (mirrors tm/asm decode)
    cranelift.rs     # #[cfg(feature = "cranelift")]  asm → Cranelift IR → JIT
    llvm.rs          # #[cfg(feature = "llvm")]        asm → LLVM IR → JIT/AOT   (phase 2)
  tests/
    native_oracle.rs # reference == λ == TM == native; native == asm-interp; large-value legs
```

`redextape-core` stays dependency-light and WASM-clean. The heavy codegen deps are pulled only via feature flags on `redextape-native`.

### The shared, backend-agnostic layer (written once)

Everything except the codegen itself is shared between Cranelift and LLVM:

- **Runtime (`runtime.rs`).** Holds the mutable execution state a generated program needs: a **heap arena** (`Vec<(u64, u64)>` of cons cells, 1-based pointers, `0` = nil — the exact model `run_asm`/`decode_asm` use), a **box arena** (`Vec<u64>`, 1-based, in-place mutable), an **instruction counter** (for the cap), and a **fault flag**. Exposes host functions the generated code calls: `rt_cons(rt, h, t) -> u64`, `rt_head(rt, p) -> u64`, `rt_tail(rt, p) -> u64`, `rt_is_empty(rt, p) -> u64`, `rt_box(rt, v) -> u64`, `rt_box_get(rt, p) -> u64`, `rt_box_set(rt, p, v)`, and `rt_tick(rt) -> u64` (cap check). A faulting op (`head`/`tail`/`box_get`/`box_set` of `0`/dangling) sets the fault flag and returns a sentinel; the generated code checks the flag and exits to the fault path. This mirrors `run_asm`'s heap/fault semantics EXACTLY, so `decode` and the oracle transfer directly.
- **Decode (`decode.rs`).** Type-directed native-representation → `Value`, mirroring `tm::decode_asm`: a `Nat` is the raw `u64`; `Bool` is `0`/`1`; a list follows heap pointers (`0` = nil, else arena cell `p-1`); a box is never a final result. Reuses the exact 1-based-pointer heap model.
- **Cap & fault outcomes.** An instruction cap (checked via `rt_tick` at loop back-edges and calls — bounding both infinite loops and infinite recursion) yields `NativeRun::HitCap`. A runtime fault yields `NativeRun::Fault`. These make native's outcome taxonomy identical to `run_tm`/`run_asm` (`Ran`/`HitCap`/`Fault`/`LowerError`), so it drops into the oracle's existing outcome buckets.

### The codegen seam

A single trait (or two entry functions behind the feature flags) that both backends implement:

```
trait NativeCodegen {
    /// Compile `prog` and run it against a fresh `Runtime`, returning the raw result word + the
    /// runtime's final heap (for decode), or a fault/cap outcome.
    fn compile_and_run(prog: &Program, caps: Caps) -> RawOutcome;
}
```

`run_native` reuses `run_tm`'s `lower_program` logic verbatim in spirit: try `lower_asm(core)`; on `LowerError::Unsupported`, retry `defunc(core) + lower_asm`; `TooDeep` returns immediately. Then dispatch to the selected codegen, then `decode` against the reference-value shape.

### The codegen model (asm → native)

The asm is a flat `Vec<Instr>` with `labels: Vec<(name, index)>` and a caller-saves-`Loc`-frame calling convention (`Call` saves the caller's `Loc` frame + jumps to the label; `Ret` restores it; `Arg` registers are volatile arg-passing; `Rr` is the result). The v1 codegen maps this to native as:

- **Subroutines → native functions.** `lower_asm` lays out `main` (ending in `Halt`) then each `fn` as a contiguous subroutine (ending in `Ret`); `Call`-target labels are function entries. Partition the code at entry labels; each becomes a native function. `Loc(i)` → function-local slots/SSA; `Arg(i)` → the function's parameters (set by the caller before `Call`); `Rr` → the return value. Internal labels (`Jz`/`Jmp` targets within a function) → native basic blocks; `Jz`/`Jmp` → native conditional/unconditional branches. `Call` → a native call; `Ret` → a native return. (This gives native recursion for recursive programs — bounded by the instruction cap; the plan verifies the contiguous-subroutine layout assumption and picks the exact register realization — SSA vs. a runtime register file — favoring correctness first.)
- **Arithmetic/compare (`Bin`, `Li`, `Mov`)** → native integer ops (real `u64`, saturating subtraction for monus, `0`/`1` for comparisons — matching `run_asm`).
- **Heap ops (`Nil`/`Cons`/`Head`/`Tail`/`IsEmpty`/`Box`/`BoxGet`/`BoxSet`)** → calls to the shared runtime host functions, with a fault-flag check after each faultable op.

The v1 register/heap realization may keep a runtime register file + host heap calls (simplest, faithful to `run_asm`); native still wins by compiling the control flow and using real `u64`. Maximal-speed SSA/inlined-heap codegen is an LLVM/optimizer concern, not v1's bar.

## Entry point & outcome type

```
pub enum NativeRun { Ran(Value), HitCap, Fault, LowerError(LowerError) }
pub fn run_native(core: &Core, caps: Caps) -> NativeRun
```

Mirrors `run_tm`/`run_lambda`: `Ran` carries the decoded `Value` (decode is type-directed, so `run_native` takes the reference value's shape — or the caller decodes, matching how `run_tm` returns tapes and `decode_tape` is separate; the plan picks the cleaner seam, likely returning a `RawOutcome` + a separate `decode`).

## Oracle integration

Native's tests live in `crates/redextape-native/tests/native_oracle.rs` (the crate that can call `run`, `run_lambda`, `run_tm`, `run_asm`, and `run_native`):

- **Four-way agreement** on the bounded suite: `reference == λ == TM == native` (extends the existing three-way demos/generators with the native leg).
- **`native == asm-interp`** on any first-order program — the independent-codegen cross-check (compile vs. interpret). This is native's primary *new* correctness relation.
- **`native == reference` on larger / longer programs** than the TM's `FIELD_WIDTH` bound (and than the asm interpreter can practically reach) — native's speed extends the reachable test space.
- **Fault & cap** taxonomy: nil-access faults diverge on native too (`Fault`); the instruction cap yields `HitCap`.
- **`cranelift == llvm`** (phase 2) — a codegen-vs-codegen differential once both exist.

## Bounds & caps

- **Instruction cap** (`Caps`, reusing the asm/TM cap shape) → `HitCap`, bounding non-termination (loops via back-edge ticks, recursion via call ticks). Native has no `FIELD_WIDTH`, so values are real `u64` (overflow at `2^64` is the only numeric bound — far beyond any test).
- **Recursion**: native calls use the native stack; the instruction cap bounds depth before a stack overflow in practice, but the plan adds a recursion-depth guard if needed (a runtime frame counter) to keep native *total* (no crash on adversarial input) — consistent with the project's totality discipline.

## Phased scope

- **Phase 1 (this spec's plan) — Cranelift.** The whole path: the crate, the shared runtime + decode + cap/fault, the `NativeCodegen` seam, the Cranelift codegen, `run_native`, the oracle legs, and a small demo (`cargo run --example native_demo` printing a program's native result). Pure-Rust, no external toolchain.
- **Phase 2 — LLVM behind the same seam.** The `-O3` native-optimization payoff + the `cranelift == llvm` cross-check. Feature-gated (`--features llvm`); the runtime/decode/oracle are reused unchanged.
- **Phase 3 — AOT.** Emit a real object file / executable artifact (not just JIT-and-run) — a native binary you can run standalone.

## Key interfaces (produced)

- `redextape_native::run_native(&Core, Caps) -> NativeRun` (and/or a `RawOutcome` + `decode`).
- `redextape_native::runtime::Runtime` + the `rt_*` host functions (shared).
- `redextape_native::NativeCodegen` seam; `cranelift`/`llvm` feature-gated impls.
- The four-way oracle harness in `redextape-native/tests`.

## Open implementation questions (for the plan)

- **Register realization:** `Loc`/`Arg` as Cranelift SSA + stack slots vs. a runtime register-file array. Lean: whichever is simplest to get correct first; SSA is faster but the frame-save/restore of `Call`/`Ret` is easier with an explicit register file. The plan picks and justifies.
- **Subroutine partitioning:** verify `lower_asm` lays out subroutines contiguously (entry-label → next-entry-label). If not perfectly contiguous, fall back to a CFG walk from each entry.
- **Fault signaling:** fault-flag-checked-after-each-op vs. a host function that returns a tagged (value, faulted) pair the generated code branches on. Lean: a fault flag in `Runtime` checked after faultable ops.
- **Decode seam:** `run_native` returns a decoded `Value` (type-directed, needs the expected shape) vs. a `RawOutcome` the caller decodes (mirrors `run_tm` + `decode_tape`). Lean: the latter, for symmetry with the TM path.
- **Cranelift version / JIT API surface** (`cranelift-jit`, `cranelift-module`) and calling into host `rt_*` functions (declared as imported symbols).
