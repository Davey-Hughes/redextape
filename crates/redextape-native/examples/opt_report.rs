//! `cargo run --release --example opt_report -p redextape-native` (add `--features llvm`, with
//! `LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm` set, to include the LLVM backend too). Run
//! `--release` — a debug build of a compiler dominates every number here with unoptimized rustc
//! output.
//!
//! What the optimizer's Tier C actually buys: compile time, emitted object size, and one end-to-end
//! compile-and-run time, for every corpus program (`measure::CORPUS`) across every available native
//! backend and all six optimization levels (`measure::OPT_LEVELS`). See the `measure` module docs for
//! the full measurement contract. Five things to know before reading the table:
//!
//! 1. **`compile` and `compile+run` are NOT independent columns — `compile+run` CONTAINS `compile`.**
//!    `compile+run` times one `run_native_with` call, which lowers, JIT-compiles, AND executes the
//!    program every single time; this crate has no API that compiles once and then loops just the
//!    call. So a level whose codegen pass itself gets slower (e.g. `-O3`'s extra inlining/unrolling
//!    work) can make `compile+run` look worse even when the code it emits runs faster. Reading the
//!    two columns as orthogonal would blame the wrong thing for that — `compile+run` going up is not
//!    evidence that `-O3` produced a slower program.
//! 2. **Object bytes are comparable DOWN a backend's rows, never ACROSS backends.** A Cranelift
//!    object and an LLVM object differ in container format and symbol-table overhead, so comparing
//!    byte counts between the two backends measures the container, not the codegen.
//! 3. **On Cranelift, `Os`/`Oz` measure byte-identical to `O1`/`O2`/`O3`.** Cranelift's ISA-level
//!    optimizer exposes only three settings (`none`/`speed`/`speed_and_size`), so the six-level grid
//!    collapses to three distinct rows per program on that backend. The duplicate rows below are the
//!    correct result of that deliberate collapse, not a measurement error.
//! 4. **`compile+run` is wall-clock on a shared machine — indicative, never asserted**, the median of
//!    `RUNS` timed calls after one discarded warmup. Execution is only a fraction of it: a separate,
//!    out-of-band experiment (a temporary split timer wrapped around just the call into JIT-compiled
//!    code, used to size `measure::CORPUS` and then discarded — see that constant's doc) put
//!    execution at roughly 15-30% of `compile+run` for the recursion-bound programs
//!    (`sum30000`/`list30000`/`map30000`), with codegen making up the rest, and near 100% for the
//!    counted loop (`loop1000000`). Those figures come from that instrumented run, NOT from anything
//!    derivable from the two columns printed below — see caveat 5. That split is a documented
//!    property of this harness — compile-and-run is not separable with this API — not a claim about
//!    the language's steady-state speed.
//! 5. **Never subtract `compile` from `compile+run` to estimate execution time — they are different
//!    code paths, not the same work measured twice.** `compile` times AOT object emission
//!    (`aot::emit_object`, which builds a Cranelift `ObjectModule`; `llvm::object_bytes`, which asks
//!    a `TargetMachine` for `write_to_memory_buffer`). The codegen inside `compile+run` is the JIT
//!    path instead (`jit`'s `JITModule`; `llvm`'s `create_jit_execution_engine`/`ExecutionEngine`).
//!    The two pipelines carry different setup, relocation, and finalization overhead, so their
//!    difference is not "execution time" — it is an AOT object-emission timer subtracted from an
//!    embedded JIT-compile timer plus execution, which conflates two unrelated quantities. The
//!    columns sit next to each other because both are worth reporting, not because they subtract.

#[cfg(any(feature = "cranelift", feature = "llvm"))]
fn main() {
    use redextape_native::measure::{Backend, CORPUS, OPT_LEVELS, RUNS, measure_all};

    // The header line below derives its row count from the corpus/level/backend lists rather than a
    // hardcoded "48", so it stays correct if any of them changes. There is deliberately no
    // `assert_eq!(ms.len(), CORPUS.len() * OPT_LEVELS.len() * backends)` anywhere here: `measure_all`
    // pushes exactly one record per iteration of those same three loops, so it could not fail.
    let available = Backend::available();
    let backends = available.len();
    let write_baseline = std::env::args().any(|a| a == "--write-baseline");

    // Both backends or nothing — checked BEFORE measuring, so a wrong invocation costs no time.
    // Written from a cranelift-only build, the baseline would be truncated to the 24 Cranelift rows
    // while its header still recorded an LLVM version (`build.rs` reads the lockfile regardless of
    // which features are enabled) — a file that lies about what produced it. The next gated run does
    // fail on the missing rows, so this is not a silent-green hazard; refusing simply stops the bad
    // file from being written at all.
    if write_baseline && backends != 2 {
        let have = available.iter().map(|b| b.name()).collect::<Vec<_>>().join(", ");
        eprintln!("error: --write-baseline needs BOTH backends; this build has only: {have}");
        eprintln!(
            "       rerun with: LLVM_SYS_221_PREFIX=<llvm-22-prefix> cargo run --release --example opt_report -p redextape-native --features llvm -- --write-baseline"
        );
        std::process::exit(2);
    }

    let ms = measure_all();

    if write_baseline {
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

    println!(
        "Tier C optimization report: {} program(s) x {} backend(s) x {} level(s) = {} rows\n",
        CORPUS.len(),
        backends,
        OPT_LEVELS.len(),
        ms.len()
    );

    println!(
        "{:<11} {:<9} {:<3} {:>12} {:>10} {:>14}",
        "program", "backend", "opt", "compile", "object", "compile+run"
    );
    println!("{}", "-".repeat(64));

    let mut last = ("", "");
    for m in &ms {
        // Blank line whenever program or backend changes, so one backend's six levels for one
        // program read as an unbroken block and the size trend down that block is easy to see.
        let key = (m.program, m.backend.name());
        if last != ("", "") && last != key {
            println!();
        }
        last = key;
        println!(
            "{:<11} {:<9} {:<3} {:>12.2?} {:>8} B {:>14.2?}",
            m.program,
            m.backend.name(),
            format!("{:?}", m.opt),
            m.compile,
            m.object_bytes,
            m.compile_and_run,
        );
    }

    println!();
    println!("compile+run CONTAINS compile (one run_native_with call lowers, JIT-compiles, AND executes);");
    println!("the two columns are not orthogonal, so a slower compile can make compile+run look worse even");
    println!("when the emitted code itself runs faster.");
    println!("object bytes: comparable DOWN a backend's rows only, never ACROSS backends.");
    println!(
        "compile+run: median of {RUNS} timed calls after a discarded warmup — wall-clock, indicative, never asserted."
    );
    println!();
    println!("DO NOT subtract compile from compile+run to estimate execution time: compile times AOT");
    println!("object emission (emit_object / write_to_memory_buffer) while the codegen inside compile+run");
    println!("is the JIT path (JITModule / ExecutionEngine) — different code paths, not the same work");
    println!("measured twice, so the difference is not execution time.");
}

#[cfg(not(any(feature = "cranelift", feature = "llvm")))]
fn main() {
    println!("build with `--features llvm` (or the default `cranelift`) to run the optimization report");
}
