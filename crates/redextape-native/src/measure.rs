//! Measurement for the optimizer's Tier C: what each backend's optimization levels actually cost
//! and buy. Collects three observables per (program, backend, level) — compile time, emitted object
//! bytes, and one end-to-end compile-and-run time — as structured records shared by the
//! `opt_report` example (which prints them) and the `size_baseline` test (which gates the byte
//! counts).
//!
//! Three deliberate limits. **Size is comparable within a backend only**: an LLVM object and a
//! Cranelift object differ in format and symbol-table overhead, so only the across-level deltas
//! inside one backend mean anything. **`compile_and_run` is not isolated execution time, and is NOT
//! orthogonal to `compile`**: `run_native_with` lowers, JIT-compiles, AND executes in one call, and
//! this crate has no API that builds once and then loops just the call (adding one is out of scope
//! here) — so every `compile_and_run` sample necessarily re-pays codegen. `CORPUS` is sized (see its
//! doc) so execution is a meaningful share of that time rather than being lost entirely in codegen
//! noise, but the column must never be read as steady-state execution time, and a level that makes
//! codegen slower (e.g. `-O3`'s extra inlining/unrolling work) can make `compile_and_run` look worse
//! even when the generated code itself runs faster. **Run time is indicative, never asserted** — it
//! is wall-clock on a shared machine, so it belongs in a report a human reads, not in a gate.
//!
//! Ruled out as an observable: `rt_tick` counts. `rt_tick` is an opaque external call, so unrolling
//! duplicates the calls rather than eliminating them and the count is codegen-invariant.

// Developer tooling, not a runtime path: this module compiles a FIXED in-repo corpus and times it.
// A corpus program that no longer parses, lowers, or codegens is a bug in the repo to surface at
// once, and there is no caller here with a diagnostic channel to surface it through. Stated once for
// the module rather than at each site, since every `expect` below is that same corpus contract.
#![allow(clippy::expect_used)]

use std::time::{Duration, Instant};

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{DEFAULT_CAPS, Program};
use redextape_core::ty::Ty;
use redextape_core::typeck::result_type;

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
/// `$applyN`).
///
/// Sized, not just shaped: native ticks the step counter only on backward edges and calls, not per
/// instruction, so a loop's cost scales with its iteration count and a recursive program's with its
/// call depth — NOT with how much arithmetic each iteration/call does. At the brief's original sizes
/// (100/100/50/a 3-element list) every program ran in low single-digit microseconds against a JIT
/// compile of tens of microseconds to several milliseconds (worse at `-O3`/LLVM), so execution was
/// under 1% of `compile_and_run` (measured directly with a temporary split timer around just the
/// call into JIT-compiled code, then discarded — not part of this file): the old `run` field was
/// really a second compile-time column wearing a misleading label. Scaled up here so each program's
/// own execution is a meaningful share of `compile_and_run` (double digits of percent, sometimes the
/// majority) while staying comfortably inside `redextape_core::tm::DEFAULT_CAPS`
/// (`steps: 5_000_000, stack: 100_000, heap: 5_000_000`, checked directly, not assumed): the loop's
/// 1,000,000 backward edges are 20% of the step cap; the three recursive programs' call depth of
/// 30,000 is 30% of the 100,000 stack (recursion-depth) cap, with steps and heap far under their
/// caps too. Every `time_runs` call asserts `NativeRun::Ran(_)`, so headroom here is not optional —
/// a program that trips a cap panics the whole grid instead of silently reporting a fault as a time.
///
/// Names are the baseline file's keys AND must describe the source below — a size change without a
/// matching rename would silently mislabel that row (e.g. a `loop100` that actually runs a million
/// iterations).
pub const CORPUS: [(&str, &str); 4] = [
    // The brief's `loop100` source was missing the `;` after `i = i + 1` (a while-loop body's last
    // statement needs one — see e.g. `count_down` throughout redextape-core's own tests); fixed here,
    // then scaled from 100 to 1,000,000 iterations for the reason given above.
    ("loop1000000", "let mut i = 0; let mut acc = 0; while i < 1000000 { acc = acc + i; i = i + 1; } acc"),
    ("sum30000", "fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(30000)"),
    ("list30000", "fn build(n){ if n==0 {nil} else { cons(n, build(n-1)) } } build(30000)"),
    // Builds its own 30,000-element list (rather than the brief's 3-element literal) so `map`'s
    // recursion is deep enough to matter; `build`'s and `map`'s recursions run one after the other
    // (the argument is fully evaluated before `map` is called), so peak call depth is ~30,000, not
    // ~60,000.
    (
        "map30000",
        "fn build(n){ if n==0 {nil} else { cons(n, build(n-1)) } } fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} map(build(30000),add1)",
    ),
];

/// Which native backend produced a measurement.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    Cranelift,
    Llvm,
}

impl Backend {
    /// The backends compiled into this build, in report order.
    #[must_use]
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
    #[must_use]
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
    /// Median of `RUNS` timed object emissions (after one discarded warmup), excluding
    /// parse/lower. Same warmup-then-median methodology as `compile_and_run`, so the two timing
    /// columns are comparable: a single cold measurement would overcharge whichever opt level
    /// happens to run first for lazy initialization, allocator growth, and cold caches.
    pub compile: Duration,
    /// Emitted object size in bytes. Comparable across levels WITHIN a backend only.
    pub object_bytes: usize,
    /// Median of `RUNS` end-to-end `run_native_with` calls (after one discarded warmup): lowering,
    /// JIT codegen, AND execution, every time — there is no API that compiles once and then loops
    /// just the call. NOT isolated execution time, and NOT orthogonal to `compile`: a slower `compile`
    /// (e.g. `-O3`'s extra optimization work) directly inflates this column too, even when the
    /// generated code itself runs faster. See the module doc for the full caveat. Indicative; never
    /// asserted.
    pub compile_and_run: Duration,
}

/// Measure the whole grid: every corpus program × every available backend × every opt level.
/// Panics on a lowering or codegen failure — this is a developer tool, not a runtime path, and a
/// corpus program that fails to compile or faults is a bug to surface loudly rather than to time.
///
/// # Panics
/// If any `CORPUS` entry fails to parse, typecheck, lower, or codegen (via `.expect()`, allowed in
/// this module — see the `#![allow(clippy::expect_used)]` at the top of this file and its comment).
/// This is intentional, not an oversight: `measure_all` drives the `opt_report` example and the
/// `size_baseline` test, both developer tooling with no caller-facing diagnostic channel, over a
/// FIXED in-repo corpus. A corpus entry that stops compiling is a bug in this repository to fail
/// loudly on, not a runtime condition for a library caller to recover from — so this is documented
/// as a panic rather than converted to a typed error.
#[must_use]
pub fn measure_all() -> Vec<Measurement> {
    let mut out = Vec::new();
    for (name, src) in CORPUS {
        let ast = parse(src).0.expect("corpus program parses");
        let ty = result_type(&ast).expect("corpus program typechecks");
        let core = desugar(&ast);
        // Reuse the runtime path's lowering so the `defunc` retry matches exactly — the `map`
        // corpus entry is higher-order and only lowers after defunctionalization.
        let prog = crate::lower_program(&core).expect("corpus program lowers");
        for backend in Backend::available() {
            for opt in OPT_LEVELS {
                let (compile, object_bytes) = compile_runs(backend, &prog, &ty, opt);
                let compile_and_run = time_runs(&core, backend, opt);
                out.push(Measurement { program: name, backend, opt, compile, object_bytes, compile_and_run });
            }
        }
    }
    out
}

/// One discarded warmup, then `RUNS` timed object emissions; returns the median time alongside the
/// byte count. Same warmup-then-median shape as `time_runs`, so the `compile` and `compile+run`
/// columns are methodologically comparable — a single cold, unrepeated measurement would pay for
/// lazy initialization, allocator growth, and cold caches on whichever opt level happens to run
/// first (in report order, `O0`), inverting the column instead of reporting it. Emission is
/// deterministic given the same inputs, so the byte count is read once (off the warmup call) rather
/// than re-derived per timed run. The clock covers codegen only — parsing and lowering happen once
/// per program above, so they are not charged to any single opt level.
fn compile_runs(backend: Backend, prog: &Program, ty: &Ty, opt: OptLevel) -> (Duration, usize) {
    // `ty` is only read by the Cranelift arm below; without that feature (llvm-only build) this
    // keeps the parameter from warning as unused, matching the `let _ = (...)` pattern `lib.rs`
    // uses for the same reason on its own feature-gated arms.
    let _ = ty;
    let emit = || -> usize {
        match backend {
            #[cfg(feature = "cranelift")]
            Backend::Cranelift => crate::aot::emit_object(prog, DEFAULT_CAPS, ty, opt).expect("cranelift object").len(),
            #[cfg(feature = "llvm")]
            Backend::Llvm => crate::llvm::object_bytes(prog, DEFAULT_CAPS, opt).expect("llvm object").len(),
            #[allow(unreachable_patterns)]
            _ => unreachable!("Backend::available() only yields compiled-in backends"),
        }
    };
    let object_bytes = emit();
    let mut times = Vec::with_capacity(RUNS);
    for _ in 0..RUNS {
        let start = Instant::now();
        emit();
        times.push(start.elapsed());
    }
    times.sort_unstable();
    (times[RUNS / 2], object_bytes)
}

/// One discarded warmup, then `RUNS` timed end-to-end `run_native_with` calls (lower + JIT-compile +
/// execute — see `Measurement::compile_and_run`'s doc for why this crate has no cheaper way to time
/// execution alone); returns the median. Wall-clock, indicative.
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

#[cfg(test)]
mod tests {
    use super::*;

    /// What this actually guards: every corpus program still COMPILES and RUNS, on every
    /// compiled-in backend, at every level. `measure_all` panics on a parse/typecheck/lowering or
    /// codegen failure and `time_runs` asserts `Ran(_)` on each call, so a corpus program that stops
    /// working — or a level a backend stops accepting — fails here loudly. That is the whole value.
    ///
    /// The assertions in the body are cheap structural cross-checks, NOT plausibility checks:
    /// `object_bytes` and the two durations cannot realistically be zero, and the grid-size check is
    /// tautological (`measure_all` pushes exactly one record per iteration of the very three loops it
    /// counts, so it cannot fail short of restructuring them). This test used to be named
    /// `..._with_plausible_numbers`, which promised a judgement the body does not make. Object sizes
    /// are gated for real in `tests/size_baseline.rs`; timings are wall-clock and deliberately never
    /// asserted (see the module doc).
    #[cfg(any(feature = "cranelift", feature = "llvm"))]
    #[test]
    fn every_corpus_program_compiles_and_runs_at_every_level() {
        let ms = measure_all();
        assert!(!ms.is_empty(), "no measurements produced");
        for m in &ms {
            assert!(m.object_bytes > 0, "{} {:?} {:?}: zero-byte object", m.program, m.backend, m.opt);
            assert!(m.compile.as_nanos() > 0, "{} {:?} {:?}: zero compile time", m.program, m.backend, m.opt);
            assert!(
                m.compile_and_run.as_nanos() > 0,
                "{} {:?} {:?}: zero compile_and_run time",
                m.program,
                m.backend,
                m.opt
            );
        }
        // Every corpus program appears for every level of every compiled-in backend.
        let expected = CORPUS.len() * OPT_LEVELS.len() * Backend::available().len();
        assert_eq!(ms.len(), expected, "measurement grid is incomplete");
    }
}
