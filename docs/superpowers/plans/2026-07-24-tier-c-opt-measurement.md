# Optimizer Tier C — Cranelift opt levels, measurement, and regression gates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Codegen::Cranelift` honor `OptLevel` (it silently runs unoptimized today), and make "optimization bought something" a measurable, gate-able claim rather than an assertion.

**Architecture:** Cranelift's `opt_level` ISA flag is wired in both the JIT and AOT paths behind the existing `OptLevel` enum, so one sweep covers both backends. An LLVM object emitter (measurement-only) puts both backends in the same unit — object bytes. A `measure` library module collects compile time, object size, and run time into structured records that two consumers share: an `opt_report` example (human table) and a `size_baseline` test (per-target-triple regression gate). Local and CI gates invoke one script so they cannot drift.

**Tech Stack:** Rust (edition 2024), Cranelift 0.134 (`cranelift`, default feature), inkwell 0.9 / LLVM 22.1.8 (`llvm` feature), Forgejo Actions on a self-hosted runner.

**Design spec:** `docs/superpowers/specs/2026-07-24-tier-c-opt-measurement-design.md` (read for rationale).

## Global Constraints

- **No git attribution.** Never add `Co-Authored-By: Claude`, `Generated with Claude Code`, or any similar trailer to commit messages or PR bodies.
- **`redextape-core` stays WASM-clean** and **`redextape-native-rt` stays Cranelift/LLVM-free.** Do not modify those two crates. inkwell/LLVM enters ONLY through the `llvm` feature on `redextape-native`.
- **The default build stays pure-Rust.** `cargo build` (default = `cranelift`) and `--no-default-features` must NOT require an LLVM toolchain.
- **Four feature configs must compile and pass:** `--no-default-features`, default (`cranelift`), `--features llvm`, `--no-default-features --features llvm`. Note `--features llvm` ≡ `--features "cranelift llvm"` (`llvm` is additive to the default `cranelift`), so those are not distinct builds.
- **Totality (cardinal rule).** Total on any input at every opt level and on every backend: deep recursion → `HitCap` (never a stack-overflow abort), faults → `Fault`, caps → `HitCap`, all codegen/JIT/thread errors → `NativeRun::LowerError`, never a panic. No `.unwrap()`/`.expect()`/`?`-to-panic on runtime-reachable paths; test `.unwrap()`s are fine.
- **Agreement contract.** Every `(backend, OptLevel)` pair must produce the same `NativeRun` outcome (`Ran`/`HitCap`/`Fault`) as the asm interpreter `run_asm` on every `Program`.
- **No wall-clock assertions,** in tests or CI. Timings are printed for humans, never gated.
- **Size comparisons are within-backend only.** A Cranelift `.o` vs an LLVM `.o` conflates codegen with object-format overhead.
- **LLVM toolchain:** any cargo command touching the `llvm` feature needs `LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm` on this machine (inkwell feature `llvm22-1`, LLVM 22.1.8).

---

## File Structure

- `crates/redextape-native/src/lib.rs` — **modify**: `Codegen::Cranelift` gains `{ opt: OptLevel }`; `run_native` defaults to `O3`; `pub mod measure`.
- `crates/redextape-native/src/codegen.rs` — **modify**: add `cranelift_opt_level(OptLevel) -> &'static str`, the single 6→3 mapping site.
- `crates/redextape-native/src/jit.rs` — **modify**: thread `opt` through; build the ISA explicitly so `opt_level` is set; sweep the fat-frame totality tests.
- `crates/redextape-native/src/aot.rs` — **modify**: `emit_object` takes `opt`; set `opt_level` alongside the existing `is_pic`.
- `crates/redextape-native/src/llvm.rs` — **modify**: add `object_bytes` (measurement-only object emit).
- `crates/redextape-native/src/measure.rs` — **create**: the measurement library both consumers share.
- `crates/redextape-native/examples/opt_report.rs` — **create**: the human-readable table.
- `crates/redextape-native/tests/size_baseline.rs` — **create**: the per-triple size gate.
- `crates/redextape-native/baselines/aarch64-apple-darwin.txt` — **create**: this machine's baseline.
- `crates/redextape-native/tests/llvm_oracle.rs`, `examples/llvm_demo.rs` — **modify**: update `Codegen::Cranelift` call sites; sweep Cranelift levels.
- `scripts/check-all.sh` — **create**: the feature-matrix gate, invoked locally and by CI.
- `.forgejo/workflows/ci.yml` — **modify**: extend the `rust` job; add a `rust-llvm` job.
- `README.md` — **modify**: document `scripts/check-all.sh` and baseline regeneration.

## Interfaces produced (referenced across tasks)

- `redextape_native::Codegen::Cranelift { opt: OptLevel }` — was a unit variant.
- `redextape_native::codegen::cranelift_opt_level(opt: OptLevel) -> &'static str` — `pub(crate)`, returns `"none"` / `"speed"` / `"speed_and_size"`.
- `redextape_native::aot::emit_object(prog: &Program, caps: Caps, ty: &Ty, opt: OptLevel) -> Result<Vec<u8>, AotError>` — gained a 4th parameter.
- `redextape_native::llvm::object_bytes(prog: &Program, caps: Caps, opt: OptLevel) -> Result<Vec<u8>, String>` (`#[cfg(feature = "llvm")]`).
- `redextape_native::measure::{Backend, Measurement, CORPUS, measure_all}` — see Task 3 for exact types.

---

### Task 1: Cranelift optimization levels + the totality sweep

Wire Cranelift's `opt_level` in both the JIT and AOT paths, make `Codegen::Cranelift` carry an `OptLevel`, and extend the existing totality and agreement tests to sweep it. **This is the riskiest task in the plan** — the default changes from unoptimized to optimized, so every existing native oracle leg starts validating optimized codegen.

**Files:**
- Modify: `crates/redextape-native/src/codegen.rs`, `src/jit.rs`, `src/aot.rs`, `src/lib.rs`
- Modify: `crates/redextape-native/tests/llvm_oracle.rs`, `examples/llvm_demo.rs`

**Interfaces:**
- Produces: `Codegen::Cranelift { opt: OptLevel }`; `codegen::cranelift_opt_level`; `aot::emit_object(prog, caps, ty, opt)`; `jit::compile_and_run(prog, caps, opt)`.
- Consumes: `OptLevel` (already public in `lib.rs`, six variants `O0 O1 O2 O3 Os Oz`, `#[default] O3`).

- [ ] **Step 1: Write the failing totality + agreement sweep.**

In `crates/redextape-native/src/jit.rs`, the existing tests at `:609` (`fat_frame_deep_recursion_returns_hitcap_not_abort`) and `:621` (`shallow_but_fat_frame_still_runs_to_a_value`) call the single-level API. Add this constant to that test module and rewrite both tests to sweep it:

```rust
/// Every Cranelift opt level. The frame-size estimate behind `native_depth_cap` was calibrated on
/// UNOPTIMIZED frames, so each level must be checked independently — `speed` changes frame layout.
const OPT_LEVELS: [OptLevel; 6] =
    [OptLevel::O0, OptLevel::O1, OptLevel::O2, OptLevel::O3, OptLevel::Os, OptLevel::Oz];

#[test]
fn a_fat_frame_deep_recursion_returns_hitcap_at_every_opt_level() {
    for opt in OPT_LEVELS {
        let prog = fat_frame_program();
        assert!(
            matches!(compile_and_run(&prog, DEFAULT_CAPS, opt), NativeRun::HitCap),
            "fat-frame deep recursion must trip the depth cap, not abort, at {opt:?}"
        );
    }
}

```

Reuse whatever helper the existing `fat_frame_deep_recursion_returns_hitcap_not_abort` uses to build its program; if that logic is inline, extract it to `fn fat_frame_program() -> Program` and have both tests call it.

Then, in **`crates/redextape-native/src/aot.rs`**'s test module, add the liveness check. It goes here rather than in `jit.rs` because `emit_object` already produces comparable bytes — writing a separate machine-code-sizing helper would duplicate the codegen loop for no gain:

```rust
#[test]
fn the_opt_level_reaches_the_cranelift_isa() {
    // `none` and `speed` must not produce byte-identical objects for a program with obvious
    // optimization headroom. If they do, the flag never reached the ISA builder — which is exactly
    // the bug this task fixes, so without this test the wiring could silently regress.
    let (prog, ty) = compiled("fn twice(x){ x + x } twice(21)");
    let o0 = emit_object(&prog, DEFAULT_CAPS, &ty, OptLevel::O0).expect("O0 object");
    let o3 = emit_object(&prog, DEFAULT_CAPS, &ty, OptLevel::O3).expect("O3 object");
    assert_ne!(o0, o3, "opt_level did not reach the Cranelift ISA (O0 and O3 emitted identical objects)");
}
```

`compiled(src) -> (Program, Ty)` is whatever the existing `aot.rs` tests already use to get a lowered program plus its result type — read that module and reuse its helper under its real name rather than adding a second one.

- [ ] **Step 2: Run the tests, expect failure.**

Run: `cargo test -p redextape-native --lib jit::`
Expected: FAIL to compile — `compile_and_run` takes two arguments, not three, and `OptLevel`/`code_bytes` are not in scope.

- [ ] **Step 3: Add the mapping and thread `opt` through Cranelift.**

In `crates/redextape-native/src/codegen.rs` (the Cranelift-shared module both `jit.rs` and `aot.rs` already import from), add:

```rust
/// The single mapping from this crate's six-level `OptLevel` onto Cranelift's three-level
/// `opt_level` ISA setting. The collapse is deliberate: Cranelift exposes `none`/`speed`/
/// `speed_and_size` only, so `O1..O3` all mean `speed` and both size levels mean `speed_and_size`.
/// LLVM's finer ladder lives in `llvm::opt_level`/`llvm::pass_pipeline`; keeping both mappings
/// single-sourced is what stops the two backends from drifting apart on what a level means.
pub(crate) fn cranelift_opt_level(opt: OptLevel) -> &'static str {
    match opt {
        OptLevel::O0 => "none",
        OptLevel::O1 | OptLevel::O2 | OptLevel::O3 => "speed",
        OptLevel::Os | OptLevel::Oz => "speed_and_size",
    }
}
```

In `crates/redextape-native/src/jit.rs`, `build_and_run` currently calls `JITBuilder::new(default_libcall_names())`, which constructs its own ISA from default flags — that is why `opt_level` has never been set. Replace it with an explicitly-built ISA via `JITBuilder::with_isa`.

**Read the installed `cranelift-jit` source for `JITBuilder::new` before writing this** (`~/.local/share/cargo/registry/src/*/cranelift-jit-0.134*/src/backend.rs`) and reproduce the flags it sets, adding `opt_level`. At the time of writing it sets `use_colocated_libcalls=false` and `is_pic=false`; **verify rather than trust this plan**, because silently dropping a flag `JITBuilder::new` sets would change JIT behavior in a way no test here targets.

```rust
let mut flags = settings::builder();
// Mirror what `JITBuilder::new` sets, then add the opt level it gives no way to reach.
flags.set("use_colocated_libcalls", "false").map_err(internal_error_from)?;
flags.set("is_pic", "false").map_err(internal_error_from)?;
flags.set("opt_level", cranelift_opt_level(opt)).map_err(internal_error_from)?;
let isa = match cranelift_native::builder() {
    Ok(b) => match b.finish(settings::Flags::new(flags)) {
        Ok(isa) => isa,
        Err(e) => return internal_error(e),
    },
    Err(e) => return internal_error(e),
};
let mut jb = JITBuilder::with_isa(isa, default_libcall_names());
```

Every fallible call returns `internal_error(..)` (a `NativeRun::LowerError`) — no `?`-to-panic, no `.unwrap()`, matching the rest of this driver. Thread `opt: OptLevel` through `jit::compile_and_run(prog, caps, opt)` → `build_and_run(prog, subs, caps, opt)`.

Implement the `code_bytes` test helper using the `CompiledCode` the shared codegen already produces — after `module.define_function(id, &mut ctx)`, `ctx.compiled_code()?.code_info().total_size` is the emitted size. Sum it over subroutines.

In `crates/redextape-native/src/aot.rs`, `emit_object` already builds flags at `:99`; add one line beside the existing `is_pic`:

```rust
flags.set("opt_level", codegen::cranelift_opt_level(opt)).map_err(|e| AotError::Object(e.to_string()))?;
```

and change the signature to `pub fn emit_object(prog: &Program, caps: Caps, ty: &Ty, opt: OptLevel) -> Result<Vec<u8>, AotError>`.

- [ ] **Step 4: Update the seam and every call site.**

In `crates/redextape-native/src/lib.rs`: change the variant to `Cranelift { opt: OptLevel }`, document it, and update both `run_native_with` variants (the `any(cranelift, llvm)` one at `:189` and the `not(any(..))` one at `:223`) plus `run_native` at `:236`:

```rust
pub enum Codegen {
    /// The Cranelift backend. `opt` selects the ISA's `opt_level` — see `codegen::cranelift_opt_level`
    /// for the six-to-three collapse. Cranelift has no IR-pass-pipeline knob equivalent to LLVM's
    /// `default<O_>`; the level reaches instruction selection and register allocation only.
    Cranelift { opt: OptLevel },
    Llvm { opt: OptLevel },
}
```

```rust
// in the any(cranelift, llvm) variant:
Codegen::Cranelift { opt } => {
    #[cfg(feature = "cranelift")]
    {
        jit::compile_and_run(&prog, caps, opt)
    }
    #[cfg(not(feature = "cranelift"))]
    {
        let _ = (&prog, caps, opt);
        unsupported("cranelift")
    }
}
```

```rust
// in the not(any(..)) variant:
Codegen::Cranelift { opt } => {
    let _ = opt;
    unsupported("cranelift")
}
```

```rust
/// Lower `core` (reusing lower_asm/defunc), JIT-compile, and run on the Cranelift backend at the
/// default optimization level. Panic-free, bounded by `caps`.
pub fn run_native(core: &Core, caps: Caps) -> NativeRun {
    run_native_with(core, caps, Codegen::Cranelift { opt: OptLevel::default() })
}
```

Update the five external call sites — `tests/llvm_oracle.rs` lines 60, 105, 117, 155 and `examples/llvm_demo.rs` line 25 — from `Codegen::Cranelift` to `Codegen::Cranelift { opt: OptLevel::O3 }`. Also update any `emit_object(` call sites (`tests/aot_oracle.rs`, `examples/aot_demo.rs`, and `aot.rs`'s own tests) to pass `OptLevel::default()` as the new 4th argument; find them with `grep -rn "emit_object(" crates/`.

- [ ] **Step 5: Extend the oracle to sweep Cranelift's levels.**

In `crates/redextape-native/tests/llvm_oracle.rs`, the existing cross-backend test compares one Cranelift run against the LLVM sweep. Change the Cranelift side to sweep too, so agreement is asserted per level for both backends:

```rust
for opt in OPT_LEVELS {
    let cl = run_native_with(&core, DEFAULT_CAPS, Codegen::Cranelift { opt });
    assert_eq!(ran(&cl, &expected), expected, "cranelift {opt:?} {src}");
}
```

- [ ] **Step 6: Run everything, expect pass.**

```bash
cargo test -p redextape-native --lib jit::
cargo test --workspace
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
```
Expected: all green, including the previously-passing `native_oracle.rs` and `aot_oracle.rs` — which now exercise optimized Cranelift for the first time.

**If the fat-frame totality test fails at any level, STOP and report it.** It means `shared::native_depth_cap`'s `BYTES_PER_VAR = 32` under-charges optimized Cranelift frames — a real stack-overflow risk, violating the cardinal rule. The expected fix is to raise that constant conservatively (measure the actual frame size first, as the LLVM phase did, and record the measurement in the report). **Do not loosen or skip the test**, and if the constant bump does not hold, escalate rather than improvising.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "feat(native): wire Cranelift opt levels in the JIT and AOT paths + sweep them in the totality and agreement tests"
```

---

### Task 2: LLVM object emitter (measurement-only)

Put both backends in the same measurement unit — object bytes. Cranelift already emits objects via `aot::emit_object`; LLVM is JIT-only and needs an equivalent.

**Files:**
- Modify: `crates/redextape-native/src/llvm.rs`

**Interfaces:**
- Produces: `llvm::object_bytes(prog: &Program, caps: Caps, opt: OptLevel) -> Result<Vec<u8>, String>` (`#[cfg(feature = "llvm")]`).
- Consumes: the existing private `build_module`, `host_target_machine(opt)` (`llvm.rs:207`), `set_host_target`, `apply_size_attributes` (`:166`), `optimize(module, machine, opt)` (`:248`).

**This is measurement only.** No linking, no `rt_run`, no CONFIG blob — it is not an AOT path, and must not grow into one in this task. (It does seed the roadmap's AOT-via-LLVM follow-on.)

- [ ] **Step 1: Write the failing test** in `llvm.rs`'s test module:

```rust
#[test]
fn object_bytes_emits_a_real_object_that_shrinks_under_oz() {
    let prog = lowered("fn twice(x){ x + x } twice(21)");
    let o0 = object_bytes(&prog, DEFAULT_CAPS, OptLevel::O0).expect("O0 object");
    let oz = object_bytes(&prog, DEFAULT_CAPS, OptLevel::Oz).expect("Oz object");
    // Mach-O 64-bit magic (0xFEEDFACF, little-endian) or ELF magic, depending on host.
    assert!(o0.len() > 64, "object is implausibly small: {} bytes", o0.len());
    assert!(&o0[..4] == b"\xcf\xfa\xed\xfe" || &o0[..4] == b"\x7fELF", "not a recognizable object file");
    assert_ne!(o0, oz, "O0 and Oz produced byte-identical objects");
}
```

Use whatever helper the existing tests use to get a `Program` from source (the module already has one that retries through `defunc`); if it is named differently from `lowered`, use the real name.

- [ ] **Step 2: Run it, expect failure.**

Run: `LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm --lib llvm::object_bytes`
Expected: FAIL — `object_bytes` not found.

- [ ] **Step 3: Implement it.**

```rust
/// Emit `prog` as a native object file at `opt`, for MEASUREMENT ONLY — this is deliberately not an
/// AOT path: no linking, no `rt_run` driver, no CONFIG blob, and the `rt_*` imports are left
/// unresolved. It exists so the LLVM backend can be sized in the same unit as Cranelift's
/// `aot::emit_object` (object bytes); comparing an LLVM object against a Cranelift one is still not
/// meaningful, because object-format and symbol-table overhead differ — only within-backend
/// comparisons across opt levels are.
#[cfg(feature = "llvm")]
pub fn object_bytes(prog: &Program, caps: Caps, opt: OptLevel) -> Result<Vec<u8>, String> {
    if reg_over_cap(prog) {
        return Err(format!("register index exceeds MAX_REGISTERS ({MAX_REGISTERS})"));
    }
    let subs = partition(prog).map_err(|e| format!("{e:?}"))?;
    let depth_cap = native_depth_cap(prog, &subs, caps);
    let machine = host_target_machine(opt)?;
    let ctx = Context::create();
    let module = build_module(&ctx, prog, &subs, depth_cap, opt, &machine)?;
    optimize(&module, &machine, opt)?;
    machine
        .write_to_memory_buffer(&module, FileType::Object)
        .map(|buf| buf.as_slice().to_vec())
        .map_err(|e| e.to_string())
}
```

Adjust to `build_module`'s real signature (`llvm.rs:862`) — pass exactly what it takes and in its order. Add `use inkwell::targets::FileType;`. `depth_cap` is baked into the emitted code just as it is for the JIT, so the object measures the same program the JIT runs.

- [ ] **Step 4: Run it, expect pass.**

```bash
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm --lib llvm::
cargo test --workspace
```

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-native/src/llvm.rs
git commit -m "feat(native): LLVM object emitter for size measurement (not an AOT path)"
```

---

### Task 3: The `measure` module

The shared measurement library. Two consumers depend on it — the report (Task 4) and the baseline gate (Task 5) — so it lives in the library, not in the example.

**Files:**
- Create: `crates/redextape-native/src/measure.rs`
- Modify: `crates/redextape-native/src/lib.rs` (declare the module)

**Interfaces:**
- Consumes: `aot::emit_object(prog, caps, ty, opt)`, `llvm::object_bytes(prog, caps, opt)`, `run_native_with`, `OptLevel`, `Codegen`.
- Produces: `measure::{Backend, Measurement, CORPUS, measure_all, RUNS}`.

- [ ] **Step 1: Write the failing test** at the bottom of `measure.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measure_all_covers_the_corpus_at_every_level_with_plausible_numbers() {
        let ms = measure_all();
        assert!(!ms.is_empty(), "no measurements produced");
        for m in &ms {
            assert!(m.object_bytes > 0, "{} {:?} {:?}: zero-byte object", m.program, m.backend, m.opt);
            assert!(m.compile.as_nanos() > 0, "{} {:?} {:?}: zero compile time", m.program, m.backend, m.opt);
        }
        // Every corpus program appears for every level of every compiled-in backend.
        let expected = CORPUS.len() * OPT_LEVELS.len() * Backend::available().len();
        assert_eq!(ms.len(), expected, "measurement grid is incomplete");
    }
}
```

- [ ] **Step 2: Run it, expect failure.**

Run: `LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm --lib measure::`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module.**

```rust
//! Measurement for the optimizer's Tier C: what each backend's optimization levels actually cost
//! and buy. Collects three observables per (program, backend, level) — compile time, emitted object
//! bytes, and run time — as structured records shared by the `opt_report` example (which prints
//! them) and the `size_baseline` test (which gates the byte counts).
//!
//! Two deliberate limits. **Size is comparable within a backend only**: an LLVM object and a
//! Cranelift object differ in format and symbol-table overhead, so only the across-level deltas
//! inside one backend mean anything. **Run time is indicative, never asserted** — it is wall-clock
//! on a shared machine, so it belongs in a report a human reads, not in a gate.
//!
//! Ruled out as an observable: `rt_tick` counts. `rt_tick` is an opaque external call, so unrolling
//! duplicates the calls rather than eliminating them and the count is codegen-invariant.

use std::time::{Duration, Instant};

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{DEFAULT_CAPS, Program, Ty};

use crate::{Codegen, NativeRun, OptLevel, run_native_with};

/// Every optimization level, in report order.
pub const OPT_LEVELS: [OptLevel; 6] =
    [OptLevel::O0, OptLevel::O1, OptLevel::O2, OptLevel::O3, OptLevel::Os, OptLevel::Oz];

/// Timed runs per measurement; the reported figure is the median, after one discarded warmup.
pub const RUNS: usize = 5;

/// The measured programs, chosen to span the shapes where optimization behaves differently:
/// a counted loop (unrolling has room), self-recursion (the inliner declines, so the
/// `rt_enter`/`rt_leave` structure dominates), list building (opaque `rt_*` heap calls the
/// optimizer cannot see through), and a defunctionalized higher-order program (dispatch through
/// `$applyN`). Names are the baseline file's keys — changing one invalidates that row.
pub const CORPUS: [(&str, &str); 4] = [
    ("loop100", "let mut i = 0; let mut acc = 0; while i < 100 { acc = acc + i; i = i + 1 }; acc"),
    ("sum100", "fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(100)"),
    ("list", "fn build(n){ if n==0 {nil} else { cons(n, build(n-1)) } } build(50)"),
    ("map", "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} [1,2,3].map(add1)"),
];

/// Which native backend produced a measurement.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    Cranelift,
    Llvm,
}

impl Backend {
    /// The backends compiled into this build, in report order.
    pub fn available() -> Vec<Backend> {
        let mut v = Vec::new();
        if cfg!(feature = "cranelift") {
            v.push(Backend::Cranelift);
        }
        if cfg!(feature = "llvm") {
            v.push(Backend::Llvm);
        }
        v
    }

    /// The lowercase name used in the report table and the baseline file.
    pub fn name(self) -> &'static str {
        match self {
            Backend::Cranelift => "cranelift",
            Backend::Llvm => "llvm",
        }
    }
}

/// One (program, backend, opt level) data point.
#[derive(Clone, Debug)]
pub struct Measurement {
    pub program: &'static str,
    pub backend: Backend,
    pub opt: OptLevel,
    /// Time to compile the program to an object, excluding parse/lower.
    pub compile: Duration,
    /// Emitted object size in bytes. Comparable across levels WITHIN a backend only.
    pub object_bytes: usize,
    /// Median of `RUNS` timed executions after a warmup. Indicative; never asserted.
    pub run: Duration,
}

/// Measure the whole grid: every corpus program × every available backend × every opt level.
/// Panics on a lowering or codegen failure — this is a developer tool, not a runtime path, and a
/// corpus program that fails to compile or faults is a bug to surface loudly rather than to time.
pub fn measure_all() -> Vec<Measurement> {
    let mut out = Vec::new();
    for (name, src) in CORPUS {
        let core = desugar(&parse(src).0.unwrap());
        // Reuse the runtime path's lowering so the `defunc` retry matches exactly — the `map`
        // corpus entry is higher-order and only lowers after defunctionalization.
        let prog = crate::lower_program(&core).expect("corpus program lowers");
        let ty = result_ty(&core);
        for backend in Backend::available() {
            for opt in OPT_LEVELS {
                let (compile, object_bytes) = compile_once(backend, &prog, &ty, opt);
                let run = time_runs(&core, backend, opt);
                out.push(Measurement { program: name, backend, opt, compile, object_bytes, run });
            }
        }
    }
    out
}

/// Emit an object once, timed. The clock covers codegen only — parsing and lowering happen once per
/// program above, so they are not charged to any single opt level.
fn compile_once(backend: Backend, prog: &Program, ty: &Ty, opt: OptLevel) -> (Duration, usize) {
    let start = Instant::now();
    let bytes = match backend {
        #[cfg(feature = "cranelift")]
        Backend::Cranelift => crate::aot::emit_object(prog, DEFAULT_CAPS, ty, opt).expect("cranelift object").len(),
        #[cfg(feature = "llvm")]
        Backend::Llvm => crate::llvm::object_bytes(prog, DEFAULT_CAPS, opt).expect("llvm object").len(),
        #[allow(unreachable_patterns)]
        _ => unreachable!("Backend::available() only yields compiled-in backends"),
    };
    (start.elapsed(), bytes)
}

/// One discarded warmup, then `RUNS` timed executions; returns the median. Wall-clock, indicative.
fn time_runs(core: &Core, backend: Backend, opt: OptLevel) -> Duration {
    let cg = match backend {
        Backend::Cranelift => Codegen::Cranelift { opt },
        Backend::Llvm => Codegen::Llvm { opt },
    };
    let warm = run_native_with(core, DEFAULT_CAPS, cg);
    assert!(matches!(warm, NativeRun::Ran(_)), "corpus program did not run on {backend:?} at {opt:?}: {warm:?}");
    let mut times = Vec::with_capacity(RUNS);
    for _ in 0..RUNS {
        let start = Instant::now();
        let outcome = run_native_with(core, DEFAULT_CAPS, cg);
        times.push(start.elapsed());
        assert!(matches!(outcome, NativeRun::Ran(_)), "corpus program stopped running mid-measurement");
    }
    times.sort_unstable();
    times[RUNS / 2]
}

/// The program's result type, which `aot::emit_object` needs to describe its output.
fn result_ty(core: &Core) -> Ty {
    redextape_core::typeck::result_type_of_core(core).expect("corpus program typechecks")
}
```

**Resolve `result_ty` against the real API before writing it.** `typeck::result_type` was added in the AOT phase and takes whatever the AOT path hands it — read `crates/redextape-native/examples/aot_demo.rs` and `tests/aot_oracle.rs` to see exactly how they obtain the `Ty` they pass to `emit_object`, and mirror that call verbatim (the name `result_type_of_core` above is a stand-in for whatever those call sites actually use). Do not invent a new typeck entry point.

Gate the per-backend match arms with `#[cfg(feature = "...")]` as shown so the module compiles in all four feature configs. With neither backend compiled in, `Backend::available()` returns empty and `measure_all` returns an empty grid — so gate the Step-1 test itself on `#[cfg(any(feature = "cranelift", feature = "llvm"))]`, since its `!ms.is_empty()` assertion is meaningless there.

In `crates/redextape-native/src/lib.rs`, next to the existing module declarations:

```rust
#[cfg(any(feature = "cranelift", feature = "llvm"))]
pub mod measure;
```

- [ ] **Step 4: Run it, expect pass.**

```bash
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm --lib measure::
cargo test -p redextape-native --lib measure::
cargo build -p redextape-native --no-default-features
```

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-native/src/measure.rs crates/redextape-native/src/lib.rs
git commit -m "feat(native): measure module — compile time, object bytes, and run time per backend and opt level"
```

---

### Task 4: The `opt_report` example

**Files:**
- Create: `crates/redextape-native/examples/opt_report.rs`

**Interfaces:**
- Consumes: `measure::{Backend, Measurement, CORPUS, OPT_LEVELS, RUNS, measure_all}`.

- [ ] **Step 1: Write the example.**

```rust
//! `cargo run --release --example opt_report -p redextape-native --features llvm`
//!
//! What the optimizer's Tier C actually buys: compile time, emitted object size, and run time for
//! every corpus program across both native backends and all six optimization levels.
//!
//! Read the table with two caveats. **Object bytes are comparable DOWN a backend's rows, not
//! ACROSS backends** — a Cranelift object and an LLVM object differ in format and symbol-table
//! overhead, so a cross-backend byte comparison measures the container, not the codegen. And **run
//! times are indicative only**: wall-clock on a shared machine, reported for a human, never gated.

#[cfg(any(feature = "cranelift", feature = "llvm"))]
fn main() {
    use redextape_native::measure::{RUNS, measure_all};

    let ms = measure_all();
    println!("{:<9} {:<10} {:<4} {:>11} {:>9} {:>11}", "program", "backend", "opt", "compile", "object", "run (med)");
    println!("{}", "-".repeat(60));
    let mut last = ("", "");
    for m in &ms {
        // Blank line between backend groups so the within-backend size trend reads vertically.
        let key = (m.program, m.backend.name());
        if last != ("", "") && last != key {
            println!();
        }
        last = key;
        println!(
            "{:<9} {:<10} {:<4} {:>9.2?} {:>7} B {:>11.2?}",
            m.program,
            m.backend.name(),
            format!("{:?}", m.opt),
            m.compile,
            m.object_bytes,
            m.run
        );
    }
    println!();
    println!("object bytes: comparable within a backend across levels, NOT across backends");
    println!("run: median of {RUNS} timed runs after a warmup — indicative, never asserted");
}

#[cfg(not(any(feature = "cranelift", feature = "llvm")))]
fn main() {
    println!("build with `--features llvm` (or the default `cranelift`) to run the optimization report");
}
```

- [ ] **Step 2: Run it.**

```bash
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo run --release --example opt_report -p redextape-native --features llvm
```
Expected: a table with 48 data rows (4 programs × 2 backends × 6 levels), non-zero byte counts, and both caveat lines. Paste the real output into the task report — it is the first evidence of what Tier C bought.

- [ ] **Step 3: Commit.**

```bash
git add crates/redextape-native/examples/opt_report.rs
git commit -m "feat(native): opt_report example — what each optimization level costs and buys"
```

---

### Task 5: The size baseline gate

**Files:**
- Create: `crates/redextape-native/tests/size_baseline.rs`
- Create: `crates/redextape-native/baselines/aarch64-apple-darwin.txt`
- Modify: `crates/redextape-native/examples/opt_report.rs` (add `--write-baseline`)

**Interfaces:**
- Consumes: `measure::{Backend, CORPUS, OPT_LEVELS, measure_all}`.
- Produces: the baseline file format below; `opt_report --write-baseline`.

**Format** — deliberately plain text, hand-parsed, so this adds no dependency (the workspace's core crate has zero deps and that is worth preserving):

```
# redextape native object-size baseline
# target: aarch64-apple-darwin
# cranelift: 0.134.0
# llvm: 22.1.8
# regenerate: cargo run --release --example opt_report -p redextape-native --features llvm -- --write-baseline
# program	backend	opt	bytes
loop100	cranelift	O0	1234
```

- [ ] **Step 1: Write the failing test** in `crates/redextape-native/tests/size_baseline.rs`:

```rust
//! Object-size regression gate. Sizes are deterministic for a given (target triple, toolchain), but
//! NOT across them — so baselines are per target triple and record the toolchain that produced them.
//! A 10% band absorbs unrelated churn while still catching a pass that has stopped firing.
#![cfg(all(feature = "cranelift", feature = "llvm"))]

use redextape_native::measure::measure_all;

/// Fraction a measured size may drift from the baseline before the gate fails.
const TOLERANCE: f64 = 0.10;

#[test]
fn object_sizes_match_the_baseline_for_this_target() {
    let triple = env!("TARGET_TRIPLE");
    let path = format!("{}/baselines/{triple}.txt", env!("CARGO_MANIFEST_DIR"));
    let Ok(text) = std::fs::read_to_string(&path) else {
        // A missing baseline must be VISIBLE, never a silent pass — an absent file would otherwise
        // masquerade as a green gate on any new target.
        println!("NOTE: no size baseline for target `{triple}` ({path}); skipping the size gate.");
        println!("      generate one with: cargo run --release --example opt_report -p redextape-native --features llvm -- --write-baseline");
        return;
    };
    let mut baseline = std::collections::HashMap::new();
    for line in text.lines().filter(|l| !l.starts_with('#') && !l.trim().is_empty()) {
        let mut f = line.split('\t');
        let (Some(p), Some(b), Some(o), Some(n)) = (f.next(), f.next(), f.next(), f.next()) else {
            panic!("malformed baseline line: {line:?}");
        };
        baseline.insert((p.to_string(), b.to_string(), o.to_string()), n.parse::<usize>().expect("byte count"));
    }
    assert!(!baseline.is_empty(), "baseline file {path} has no rows");

    let mut drifted = Vec::new();
    for m in measure_all() {
        let key = (m.program.to_string(), m.backend.name().to_string(), format!("{:?}", m.opt));
        let Some(&want) = baseline.get(&key) else {
            panic!("no baseline row for {key:?} — regenerate the baseline");
        };
        let delta = (m.object_bytes as f64 - want as f64) / want as f64;
        if delta.abs() > TOLERANCE {
            drifted.push(format!("{key:?}: baseline {want} B, measured {} B ({:+.1}%)", m.object_bytes, delta * 100.0));
        }
    }
    assert!(drifted.is_empty(), "object size drifted beyond {:.0}%:\n  {}", TOLERANCE * 100.0, drifted.join("\n  "));
}
```

`env!("TARGET_TRIPLE")` does not exist by default. Add `crates/redextape-native/build.rs`:

```rust
fn main() {
    // Cargo sets TARGET for build scripts but not for the crate itself; re-export it so tests can
    // select the right per-triple baseline.
    println!("cargo:rustc-env=TARGET_TRIPLE={}", std::env::var("TARGET").unwrap());
    println!("cargo:rerun-if-changed=build.rs");
}
```

- [ ] **Step 2: Run it, expect failure.**

Run: `LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm --test size_baseline`
Expected: FAIL to compile (no `build.rs` yet) — then, once `build.rs` exists, PASS-with-NOTE (no baseline file yet). Both are correct intermediate states; the note must be visible in `--nocapture` output.

- [ ] **Step 3: Add `--write-baseline` to the report.**

In `examples/opt_report.rs`'s `main`, before printing the table:

```rust
if std::env::args().any(|a| a == "--write-baseline") {
    let triple = env!("TARGET_TRIPLE");
    let path = format!("{}/baselines/{triple}.txt", env!("CARGO_MANIFEST_DIR"));
    let mut out = String::from("# redextape native object-size baseline\n");
    out.push_str(&format!("# target: {triple}\n"));
    out.push_str(&format!("# cranelift: {}\n", env!("CRANELIFT_VERSION")));
    out.push_str(&format!("# llvm: {}\n", env!("LLVM_VERSION")));
    out.push_str("# regenerate: cargo run --release --example opt_report -p redextape-native --features llvm -- --write-baseline\n");
    out.push_str("# program\tbackend\topt\tbytes\n");
    for m in &ms {
        out.push_str(&format!("{}\t{}\t{:?}\t{}\n", m.program, m.backend.name(), m.opt, m.object_bytes));
    }
    std::fs::create_dir_all(format!("{}/baselines", env!("CARGO_MANIFEST_DIR"))).expect("baselines dir");
    std::fs::write(&path, out).expect("write baseline");
    println!("wrote {path}");
    return;
}
```

Extend `build.rs` so the baseline header can record which toolchain produced it — a size mismatch is then diagnosable instead of mysterious. The versions come from the workspace lockfile, because Cargo exposes no env var for a *dependency's* resolved version (`DEP_*` exists only for crates with a `links` key, which neither Cranelift nor `llvm-sys` uses). The complete `build.rs` after this step:

```rust
fn main() {
    // Cargo sets TARGET for build scripts but not for the crate itself; re-export it so tests can
    // select the right per-triple baseline.
    println!("cargo:rustc-env=TARGET_TRIPLE={}", std::env::var("TARGET").unwrap());

    // Record the codegen toolchain versions the size baseline was produced with. Read from the
    // lockfile: there is no Cargo-provided env var for a dependency's resolved version.
    let lock_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../Cargo.lock");
    let lock = std::fs::read_to_string(lock_path).unwrap_or_default();
    let version_of = |name: &str| -> String {
        let needle = format!("name = \"{name}\"");
        lock.split("[[package]]")
            .find(|block| block.contains(&needle))
            .and_then(|block| block.lines().find(|l| l.trim_start().starts_with("version = ")))
            .map(|l| l.trim().trim_start_matches("version = ").trim_matches('"').to_string())
            .unwrap_or_else(|| "unknown".into())
    };
    println!("cargo:rustc-env=CRANELIFT_VERSION={}", version_of("cranelift-codegen"));
    println!("cargo:rustc-env=LLVM_VERSION={}", version_of("llvm-sys"));

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={lock_path}");
}
```

Note `llvm-sys`'s crate version (e.g. `221.x`) encodes the LLVM major/minor it targets, which is the number that matters for reproducing a baseline — not the exact LLVM patch release.

- [ ] **Step 4: Generate the baseline and verify the gate bites.**

```bash
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo run --release --example opt_report -p redextape-native --features llvm -- --write-baseline
LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm --test size_baseline
```
Expected: the baseline file is written with 48 rows and a populated header; the test then PASSES.

**Verify the gate is not vacuous:** hand-edit one row's byte count by 50%, re-run the test, confirm it FAILS naming that row, then restore the file. Report both outcomes.

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-native/tests/size_baseline.rs crates/redextape-native/baselines crates/redextape-native/build.rs crates/redextape-native/examples/opt_report.rs
git commit -m "feat(native): per-target object-size baseline gate with a 10% band"
```

---

### Task 6: `scripts/check-all.sh`

The feature-matrix gate, run before a merge and invoked verbatim by CI so the two cannot drift.

**Files:**
- Create: `scripts/check-all.sh`
- Modify: `README.md`

**Interfaces:**
- Produces: `scripts/check-all.sh` — exits non-zero on the first failure; accepts `--no-llvm` to skip the LLVM configs.

**Do NOT add this to `.pre-commit-config.yaml`.** Those hooks stay fast (fmt + clippy); a five-config sweep with LLVM JIT compiles on every commit is how `--no-verify` becomes habit.

- [ ] **Step 1: Write the script.**

```bash
#!/usr/bin/env bash
# The full feature-matrix gate: every config the crate supports, in one command.
#
# CI invokes this same script (.forgejo/workflows/ci.yml), so the local and CI gates cannot drift.
# The pre-commit hooks deliberately do NOT run it — they stay fast (fmt + clippy); this is the
# before-a-merge check.
#
#   scripts/check-all.sh              # everything, including the LLVM configs
#   scripts/check-all.sh --no-llvm    # skip LLVM (no toolchain installed)
set -euo pipefail

run() { echo; echo "==> $*"; "$@"; }

# `--features llvm` is additive to the default `cranelift`, so it is NOT a distinct build from
# `--features "cranelift llvm"`; the genuinely LLVM-only config is --no-default-features --features llvm.
run cargo fmt --all --check
run cargo clippy --workspace --all-targets -- -D warnings
run cargo test --workspace
run cargo build -p redextape-native --no-default-features
run cargo clippy -p redextape-native --no-default-features --all-targets -- -D warnings

if [ "${1:-}" = "--no-llvm" ]; then
  echo; echo "==> skipping the LLVM configs (--no-llvm)"; exit 0
fi

# llvm-sys locates LLVM via a version-specific variable. Honor an existing setting; otherwise probe
# the usual locations. If broadening the supported LLVM range later, derive the variable NAME from
# the selected inkwell feature rather than hardcoding 221.
if [ -z "${LLVM_SYS_221_PREFIX:-}" ]; then
  for p in /opt/homebrew/opt/llvm /usr/lib/llvm-22 /usr/local/opt/llvm; do
    if [ -x "$p/bin/llvm-config" ]; then export LLVM_SYS_221_PREFIX="$p"; break; fi
  done
fi
if [ -z "${LLVM_SYS_221_PREFIX:-}" ]; then
  echo "error: no LLVM 22 found; set LLVM_SYS_221_PREFIX or pass --no-llvm" >&2; exit 1
fi
echo "==> using LLVM at $LLVM_SYS_221_PREFIX"

run cargo clippy -p redextape-native --features llvm --all-targets -- -D warnings
run cargo test -p redextape-native --features llvm
run cargo clippy -p redextape-native --no-default-features --features llvm --all-targets -- -D warnings
run cargo test -p redextape-native --no-default-features --features llvm

echo; echo "all configs green"
```

- [ ] **Step 2: Make it executable and run it.**

```bash
chmod +x scripts/check-all.sh
./scripts/check-all.sh
```
Expected: every section green, ending with `all configs green`. Paste the tail of the real output into the task report.

- [ ] **Step 3: Document it in `README.md`.**

Add a short section under the existing build/test documentation (match the file's heading style):

```markdown
## Checks

`scripts/check-all.sh` runs the full feature matrix — fmt, clippy, and tests across the default
(`cranelift`), `--no-default-features`, `--features llvm`, and `--no-default-features --features llvm`
configurations. CI runs this same script. Pass `--no-llvm` to skip the LLVM configurations when no
LLVM 22 toolchain is installed.

The pre-commit hooks intentionally run only `cargo fmt` and `cargo clippy` — fast enough for every
commit. Run `scripts/check-all.sh` before merging.

Object-size baselines live in `crates/redextape-native/baselines/<target-triple>.txt` and gate the
`size_baseline` test with a 10% band. Regenerate after an intentional codegen change:

    cargo run --release --example opt_report -p redextape-native --features llvm -- --write-baseline
```

- [ ] **Step 4: Commit.**

```bash
git add scripts/check-all.sh README.md
git commit -m "chore: add scripts/check-all.sh — the feature-matrix gate shared by local runs and CI"
```

---

### Task 7: Forgejo CI

Extend the existing pipeline to cover the feature matrix and the LLVM backend.

**Files:**
- Modify: `.forgejo/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/check-all.sh` (Task 6).

**Context on the existing file:** it is a real self-hosted-runner pipeline with a `detect` job that gates the rest on `Cargo.toml` existing (it now does), a `rust` job (Rust via `rust-toolchain.toml`, cargo cache, fmt, clippy, `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`), a `web` job (skipped — no `web/`), and a `docker` job (skipped — requires `web`). It runs on push to `main` and on PRs, with `paths-ignore` for docs.

- [ ] **Step 1: De-risk the LLVM version FIRST — before writing any job.**

inkwell's `llvm22-1` feature requires LLVM **22.1.x**; `llvm-sys` rejects a mismatched major/minor. Determine what apt.llvm.org actually ships **without installing anything**, by reading the package index (the runner image is Ubuntu; check the codename the runner uses and substitute it for `noble` if different):

```bash
curl -s https://apt.llvm.org/noble/dists/llvm-toolchain-noble-22/main/binary-amd64/Packages.gz \
  | gunzip | grep -A3 '^Package: llvm-22$' | head -8
```

Record the exact version in the task report.
- If it is **22.1.x**, proceed with `llvm.sh` as below.
- If it is **22.0.x**, do NOT proceed and do NOT downgrade the inkwell feature to paper over it: report the finding and stop. The fallback is a prebuilt tarball from the llvm-project GitHub releases, cached as a directory — that is a different job design and deserves its own decision.

- [ ] **Step 2: Extend the `rust` job with the non-LLVM configs.**

After the existing `Clippy` step and before `Test + coverage`, add:

```yaml
      - name: Feature matrix (non-LLVM configs)
        run: ./scripts/check-all.sh --no-llvm
```

Leave `Format`, `Clippy`, and the coverage step as they are. **Do not add `--features llvm` to the coverage command:** `llvm.rs` is `#[cfg(feature = "llvm")]` and thus invisible to the current `--fail-under-lines 80` gate; adding it would inject ~1900 lines at once and destabilize the threshold. That limitation is recorded in the spec as a separate follow-up.

- [ ] **Step 3: Add the `rust-llvm` job.**

Add after the `rust` job, matching the file's existing style (pinned action SHAs from `code.forgejo.org`, the same cache action):

```yaml
  # The LLVM backend, in its own job so a cold or upstream-broken LLVM install never delays the
  # fast default-feature signal from `rust`. Deliberately NOT continue-on-error: a job permitted to
  # fail is not coverage.
  rust-llvm:
    needs: detect
    if: needs.detect.outputs.has_rust == 'true'
    runs-on: docker
    env:
      LLVM_SYS_221_PREFIX: /usr/lib/llvm-22
    steps:
      - uses: https://code.forgejo.org/actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
      - name: Install Rust (respects rust-toolchain.toml)
        run: |
          curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain none
          . "$HOME/.cargo/env"
          echo "$HOME/.cargo/bin" >> "$GITHUB_PATH"
          rustup show
      - name: Cache the LLVM 22 toolchain
        id: llvm-cache
        uses: https://code.forgejo.org/actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0
        with:
          path: /usr/lib/llvm-22
          key: llvm-22-${{ runner.os }}
      - name: Install LLVM 22
        if: steps.llvm-cache.outputs.cache-hit != 'true'
        run: |
          apt-get update && apt-get install -y --no-install-recommends lsb-release wget software-properties-common gnupg
          wget -qO /tmp/llvm.sh https://apt.llvm.org/llvm.sh
          chmod +x /tmp/llvm.sh
          /tmp/llvm.sh 22
          "$LLVM_SYS_221_PREFIX/bin/llvm-config" --version   # fail loudly on a version mismatch
      - uses: https://code.forgejo.org/actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target
          key: cargo-llvm-${{ hashFiles('**/Cargo.lock') }}
          restore-keys: cargo-llvm-
      - name: Feature matrix (all configs, including LLVM)
        run: ./scripts/check-all.sh
      - name: Optimization report (informational, never gating)
        run: cargo run --release --example opt_report -p redextape-native --features llvm
```

The `opt_report` step is deliberately last and non-gating: it leaves a per-push record in the log of what optimization bought on a known machine, without turning wall-clock into a gate.

- [ ] **Step 4: Add `rust-llvm` to the `docker` job's dependencies.**

That job is currently skipped (it requires `has_web`, and there is no `web/`), but the dependency should be right for when a `web/` directory lands. In the `docker` job change `needs: [detect, rust, web]` to `needs: [detect, rust, rust-llvm, web]` and add to its `if:` condition, beside the existing `needs.rust.result == 'success'`:

```yaml
      && needs.rust-llvm.result == 'success'
```

- [ ] **Step 5: Validate the YAML and note the Linux baseline.**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.forgejo/workflows/ci.yml')); print('yaml ok')"
```
Expected: `yaml ok`.

The **Linux size baseline cannot be generated from this machine** (it is a different target triple) and CI must not commit to the repo. The `size_baseline` test will print its skip-notice on `x86_64-unknown-linux-gnu` until a baseline exists. Record in the task report that generating and committing `crates/redextape-native/baselines/x86_64-unknown-linux-gnu.txt` from the first successful `rust-llvm` run is a manual follow-up step.

- [ ] **Step 6: Commit.**

```bash
git add .forgejo/workflows/ci.yml
git commit -m "ci: cover the feature matrix and add a cached-LLVM job for the llvm backend"
```

---

## Notes for the executor

- **`LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm` is required on every cargo command touching the `llvm` feature** on this machine. `llvm-sys` also auto-detects Homebrew, so it may work without it — set it anyway for reproducibility.
- **Task 1 is the risky one.** It changes what every existing native test exercises. If the fat-frame totality test fails at any Cranelift level, that is a genuine stack-overflow risk and the cardinal rule is at stake: measure the real frame size, raise `shared::BYTES_PER_VAR` conservatively, and if that does not hold, escalate. Never loosen or `#[ignore]` that test.
- **The authoritative models to read before writing code:** `crates/redextape-native/src/llvm.rs` for how `OptLevel` is already threaded, single-sourced, and swept (`opt_level` at `:102`, `pass_pipeline` at `:119`, `host_target_machine` at `:207`, `optimize` at `:248`); `src/jit.rs` and `src/aot.rs` for the two Cranelift drivers; `tests/llvm_oracle.rs` for the oracle's shape.
- **Totality is non-negotiable:** every fallible codegen/ISA/JIT call maps to `internal_error(..)` (a `NativeRun::LowerError`) or the task's error type — never `?`-to-panic or `.unwrap()` on a runtime-reachable path. `measure.rs` and the example are developer tools, not runtime paths, so panicking there is correct and deliberate.
- **Cranelift API drift:** this plan pins to Cranelift 0.134. If `JITBuilder::with_isa`, `settings::builder`, or `CompiledCode::code_info` differ from what is written here, read the installed source under `~/.local/share/cargo/registry/src/` rather than guessing — the same approach that resolved `symbol_value`/`finalize` drift in an earlier phase.
- Task ordering is a dependency chain: 1 → 2 → 3 → (4, 5) → 6 → 7. Tasks 4 and 5 both consume Task 3's `measure` module.
