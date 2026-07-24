# Native Backend Phase 2 — LLVM (the optimizing codegen) — Design Spec

> **Status:** approved design (2026-07-24), pending the implementation plan.
> **Context:** The native backend has a working Cranelift path — v1 JIT (`reference == λ == TM == native`,
> `native == asm-interp`) and Phase 3 AOT (a real standalone binary). This spec adds a **second native
> codegen backend built on LLVM**, behind a shared seam, for the deep-optimization payoff and a
> codegen-vs-codegen cross-check. Phase 3 (AOT) was deliberately done first as the smaller, tangible win;
> Phase 2 is the optimization goal the user has flagged from the start.

## Goal

Compile the register-asm `Program` to **LLVM IR**, run it through LLVM's optimization pipeline (default
`-O3`), and JIT-execute it in-process — a second, independent native codegen backend. The point is not
just "another backend": it is (1) **real `-O3` native optimization**, and (2) turning the project's
differential oracle into an **optimizer-validation harness** — the same machinery that proves the
backends agree now also proves LLVM's aggressive optimization preserves program semantics.

### Value proposition (what LLVM uniquely adds)

- **Deep native optimization** (`-O3`) — the full LLVM pipeline (mem2reg, GVN, inlining, LICM, instcombine,
  …), which Cranelift's JIT does not do. This is the "I want the optimizing" payoff.
- **A codegen-vs-codegen cross-check:** `cranelift == llvm` — two fully independent backends compiled from
  the same `Program` must agree. Catches a codegen bug in *either* that a single backend can't reveal.
- **The oracle validates the optimizer itself:** `llvm-O0 == llvm-O3` — the same program compiled at `-O0`
  (no IR passes, allocas in memory) and `-O3` (aggressive passes, allocas promoted to SSA) must produce
  identical observable results. If any `-O3` pass ever miscompiles, a leg breaks and points at it.

Honest scope note: LLVM's optimization operates on LLVM IR and is invisible to the TM step-count goldens
(those measure the Core→Core / asm→asm optimizer tiers, a separate track). LLVM's win here is native code
quality + the two differentials above, not TM-measurable step savings.

## Non-goals (this phase)

- **AOT via LLVM.** JIT-in-process only — exactly what the oracle needs. Emitting an `-O3`-optimized object
  file via LLVM's `TargetMachine` and linking it with the existing `link_executable` is the natural
  follow-on (it plugs into the Phase-3 AOT infrastructure already on `main`), deferred to keep this phase
  bounded.
- **An LLVM-IR / disassembly dump view.** A separate pedagogical follow-on (already recorded in the
  roadmap), not required for the optimizer payoff.
- **Replacing Cranelift.** LLVM is additive; Cranelift stays the default (pure-Rust, no toolchain). The two
  coexist behind the seam.
- **Anything the asm doesn't express.** LLVM runs exactly the first-order `Program` that `lower_asm` +
  `defunc` produce — same supported set as Cranelift and the TM.

## Architecture

### The real cross-codegen seam

Today's "seam" is only Cranelift's `Module` trait (Cranelift-only). Phase 2 lifts it to the level both
backends share — `(&Program, Caps) -> NativeRun` — via a small selector:

```rust
pub enum OptLevel { O0, O1, O2, O3 }         // default O3
pub enum Codegen { Cranelift, Llvm { opt: OptLevel } }

pub fn run_native_with(core: &Core, caps: Caps, codegen: Codegen) -> NativeRun;
pub fn run_native(core: &Core, caps: Caps) -> NativeRun;   // == run_native_with(.., Cranelift)
```

`run_native_with` performs the SHARED `lower_program(core)` (try `lower_asm`, else `defunc` + `lower_asm`;
`TooDeep` immediate — the existing logic) once, then dispatches: `Cranelift → jit::compile_and_run(prog,
caps)`; `Llvm{opt} → llvm::compile_and_run(prog, caps, opt)`. Both return the existing `NativeRun { Ran(
AsmOutcome), HitCap, Fault(String), LowerError }`. The oracle calls `run_native_with` with each `Codegen`
explicitly to compare. `run_native`'s signature/behavior is unchanged (back-compat).

### Massive reuse — the only new surface is the IR walk

LLVM reuses, verbatim, everything except the asm→IR translation:

- **The runtime** (`redextape-native-rt`): LLVM's generated code calls the SAME `rt_*` host functions
  (`rt_cons`/`rt_head`/…/`rt_tick`/`rt_enter`/`rt_leave`/`rt_faulted`) — already `#[unsafe(no_mangle)]`, so
  inkwell's `ExecutionEngine` resolves them from the running process (or via explicit
  `add_global_mapping`). Same heap/box/cap/fault semantics → LLVM drops into the same `decode_asm` and
  oracle buckets.
- **`analysis::partition`** (reachability subroutine partition), **`codegen::native_depth_cap`**
  (frame-size-aware, codegen-agnostic — computed from `Program`+`subs`), **`Runtime`**, **`decode_asm`**,
  **`Caps`**, and the **totality story** (big-stack run thread + the depth cap + `rt_*` cap checks) are all
  reused unchanged.

**New code:** `src/llvm.rs` (feature-gated `#[cfg(feature = "llvm")]`) — `compile_and_run(prog, caps, opt)
-> NativeRun`: build an LLVM `Module`, translate each `Subroutine` to an LLVM function, run the opt
pipeline, JIT via `ExecutionEngine`, and run `$main` on the big-stack thread against a fresh `Runtime`,
classifying `Ran`/`Fault`/`HitCap` exactly as `jit.rs` does.

### The IR walk (mirrors `codegen::translate_subroutine`)

- **Subroutines → LLVM functions.** One `i64 (ptr)`-typed function per `Subroutine` (`ptr` = `*mut
  Runtime`); `$main` (entry 0) is the JIT entry. `Loc(i)`/`Arg(i)`/`Rr` → **`alloca`s** initialised in the
  entry block (params stored into the `Arg` allocas; the rest zero-init). Using allocas + letting LLVM's
  `mem2reg`/`-O` passes promote them to SSA is far simpler and less error-prone than hand-building SSA φ-
  nodes — and it is exactly what makes the `llvm-O0 == llvm-O3` differential meaningful (O0 keeps them in
  memory, O3 promotes them; both must agree).
- **Control flow.** One LLVM basic block per reachable body index (like the Cranelift partition); `Jz` →
  conditional `br`, `Jmp` → unconditional `br`, fall-through → `br` to the next index's block, `Call` →
  `call` the callee function (native stack realises the frame convention), `Ret` → `ret` the `Rr` value.
- **Arithmetic/compare** (`Bin`/`Li`/`Mov`) → LLVM integer ops on `i64`. `Add`/`Mul` **SATURATE via the
  native intrinsics `@llvm.uadd.sat.i64` / `@llvm.umul.sat.i64`** (cleaner than Cranelift's overflow+select);
  `Sub` is monus (`@llvm.usub.sat.i64`, or `umax(x,y)`-style); comparisons are **unsigned `icmp` + `zext`
  to i64** (matching `run_asm`'s `0`/`1`).
- **Heap/box ops** (`Nil`/`Cons`/`Head`/`Tail`/`IsEmpty`/`Box`/`BoxGet`/`BoxSet`) → `call` to the declared-
  external `rt_*` functions, followed by a fault-flag check.
- **Cap guards.** `rt_tick` before every back-edge and `rt_enter` at every `Call` (and the post-op
  `rt_faulted` check) → their nonzero signal drives a conditional `br` to a single shared **exit block**
  that returns `Rr` — the same pattern `codegen::emit_guard` uses, so infinite loops trip the step cap and
  deep recursion trips the frame-size-aware depth cap **before** the native stack overflows.

### Optimization levels

`OptLevel` drives **both** LLVM opt knobs:

- **IR passes:** run the new-pass-manager pipeline `default<O0|O1|O2|O3>` via `Module::run_passes(...)`
  before JIT (LLVM 22 uses the new PassBuilder; inkwell 0.9 exposes `run_passes`). `O0` runs no IR passes.
- **Backend codegen:** create the `ExecutionEngine` with the matching `OptimizationLevel` (`None` for O0 …
  `Aggressive` for O3).

`O3` = full IR pipeline + aggressive codegen (mem2reg promotes the allocas, then GVN/inline/LICM/etc.);
`O0` = no IR passes + no codegen opt (allocas stay in memory). Both must be observationally identical — the
differential.

### Totality (unchanged discipline)

LLVM is total on any input for the same reasons the Cranelift JIT is: (a) the frame-size-aware
`native_depth_cap` + the big-stack run thread guarantee deep recursion → `HitCap`, never a stack-overflow
abort; (b) `rt_tick`/`rt_enter` cap-trip → `HitCap`; (c) faults latch → `Fault`; (d) an over-cap register
bank is rejected (`reg_over_cap`) before any IR is built; (e) all inkwell/JIT/thread errors map to
`LowerError`/an internal error, never a panic. The `caps.mem` note (no native analog) carries over.

## Oracle integration

`crates/redextape-native/tests/llvm_oracle.rs` (`#![cfg(feature = "llvm")]`):

- **The cross-check leg:** `reference == cranelift == llvm` (at `-O3`) on the shared demo suite and the
  broadened generators (the same programs `native_oracle.rs` already exercises for Cranelift). Faults →
  `Fault`, caps → `HitCap`, on both backends.
- **The optimizer-validation differential (the headline):** for each program, `run_native_with(.., Llvm{O0})
  == run_native_with(.., Llvm{O3})` — identical decoded result (or identical fault/cap outcome) at both opt
  levels. Run over the demos + the generators, so `-O3`'s passes are exercised on real control flow, lists,
  recursion, and defunc'd higher-order programs.
- Beyond-`FIELD_WIDTH` values (real `u64`, like the Cranelift native leg) confirm LLVM matches the reference
  past the TM's bound.

Because the `llvm` feature requires the LLVM toolchain, the whole test file is feature-gated;
`--no-default-features` and the default (Cranelift-only) build skip it cleanly, and `native_oracle.rs` is
untouched.

## Demo

`cargo run --example llvm_demo -p redextape-native --features llvm`: compile a program to LLVM IR, run it
at `-O3`, print the result, and note the opt level — and (optionally) print that `-O0` agrees. Falls back
to a "build with `--features llvm`" notice when the feature is off (like `native_demo`/`aot_demo`).

## Toolchain & feature-gating

- **Dependency:** `inkwell = { version = "0.9", optional = true, features = ["llvm22-1"] }` behind
  `llvm = ["dep:inkwell"]`. inkwell 0.9 supports LLVM 11–22; this box has Homebrew LLVM **22.1.8** at
  `/opt/homebrew/opt/llvm`. (The exact feature suffix — `llvm22-1` vs `llvm22-0` — and the `llvm-sys` env
  var name — `LLVM_SYS_<ver>_PREFIX`, e.g. `LLVM_SYS_221_PREFIX` — are confirmed empirically in Task 1;
  `cargo build --features llvm` errors clearly if either is off. Build/test with
  `LLVM_SYS_<ver>_PREFIX=/opt/homebrew/opt/llvm`.)
- **`redextape-core` stays WASM-clean** and **the default build stays pure-Rust** — inkwell/LLVM enters
  ONLY through the `llvm` feature on `redextape-native`. `redextape-native-rt` is untouched (its `rt_*` are
  the shared runtime both backends call).
- **Both feature configs build:** `--no-default-features`, default (`cranelift`), and `--features llvm` all
  compile; `run_native_with(.., Llvm{..})` without the `llvm` feature returns `LowerError` (a stub, like the
  existing no-`cranelift` stubs).

## Phased scope within Phase 2 (task-decomposition seed)

1. **Toolchain + feature + seam skeleton** — add the `inkwell` dep + `llvm` feature (confirm the exact
   feature suffix / `LLVM_SYS_` var, get a trivial inkwell "hello module" JIT compiling); add `OptLevel`,
   `Codegen`, `run_native_with`, and the dispatch (LLVM arm a stub first). Default build unaffected.
2. **The IR walk — arithmetic + control flow** — `llvm::compile_and_run` for straight-line + `if`/`while`
   + `Call`/`Ret` (no heap yet): subroutine functions, allocas, blocks, saturating intrinsics, cap guards,
   the big-stack thread, `Runtime` classification. Oracle: `reference == cranelift == llvm` on the
   arithmetic/recursion subset.
3. **Heap/box ops** — `rt_*` external declarations + calls + fault checks for
   `Cons`/`Head`/`Tail`/`IsEmpty`/`Box`/`BoxGet`/`BoxSet`. Oracle extends to lists + defunc'd higher-order.
4. **Optimization levels** — wire `OptLevel` to the IR pass pipeline (`run_passes("default<O_>")`) + the
   `ExecutionEngine` opt level. The `llvm-O0 == llvm-O3` differential test.
5. **Full oracle leg + demo** — `llvm_oracle.rs` (`reference == cranelift == llvm` + `O0 == O3` over the
   generators, beyond-FIELD_WIDTH) + `llvm_demo`.

## Key interfaces (produced)

- `redextape_native::{OptLevel, Codegen}`; `run_native_with(&Core, Caps, Codegen) -> NativeRun`.
- `redextape_native::llvm::compile_and_run(&Program, Caps, OptLevel) -> NativeRun` (feature-gated).
- The `llvm_oracle.rs` harness; `llvm_demo`.
- No change to `redextape-core`, `redextape-native-rt`, `run_native`, `run_tm`, `run_lambda`, or the
  existing Cranelift JIT/AOT paths.

## Open implementation questions (for the plan)

- **Exact inkwell feature suffix + `LLVM_SYS_` env var** for LLVM 22.1.8 — resolve empirically in Task 1
  (cargo's error names the expected env var; inkwell 0.9's feature list names the suffix).
- **Pass-manager API surface** in inkwell 0.9 / LLVM 22 — `Module::run_passes(passes, &TargetMachine,
  PassBuilderOptions)` with a `"default<O3>"` string (new PM). Confirm the exact signature; that string form
  is stable across recent LLVM.
- **Symbol resolution for `rt_*`** — rely on the `ExecutionEngine` resolving process symbols (the
  `#[unsafe(no_mangle)]` runtime is linked into the test/bin) vs. explicit `add_global_mapping` per `rt_*`.
  Lean: try process resolution first; fall back to `add_global_mapping` if the platform's JIT doesn't
  auto-resolve. The plan picks and verifies.
- **`alloca` placement** — all allocas in the function entry block (LLVM canonical form so `mem2reg` fires),
  even for later-index locals. Confirm the builder positions them in the entry block, not inline.
- **Big-stack thread + non-`Send` inkwell context** — like the Cranelift `JITModule`, inkwell's `Context`/
  `ExecutionEngine` are not `Send`; build + run on the one spawned big-stack thread (scoped), exactly as
  `jit.rs::compile_and_run` already does.
