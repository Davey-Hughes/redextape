#![cfg(all(feature = "llvm", feature = "cranelift"))]
//! The LLVM oracle leg (Task 6, native Phase 2): extends `native_oracle.rs`'s four-way oracle
//! (`reference == λ == TM == native`) with a SECOND native codegen backend behind the same
//! `Codegen`/`run_native_with` seam. Every case here is checked `reference == cranelift == llvm`.
//!
//! Gated on BOTH `llvm` and `cranelift` (not just `llvm`): this file's distinctive job is the DIRECT
//! `cranelift == llvm` comparison, so it inherently needs both backends compiled in. `llvm`-only
//! builds (`--no-default-features --features llvm`) still compile this crate/workspace cleanly (the
//! global constraint) -- this test module just has zero tests in that configuration, rather than
//! spuriously failing every case on `Codegen::Cranelift` reporting `unsupported("cranelift")`.
//!
//! The sharpened claim this file adds (not just each backend separately pinned to the reference,
//! which would let a cranelift-only or llvm-only bug hide behind "both happen to match the
//! interpreter"): a DIRECT `cranelift == llvm` comparison, at every `OptLevel` (`O0`..`O3` plus the
//! size-oriented `Os`/`Oz`). This is the literal cross-backend leg and the headline claim of the LLVM
//! phase -- that `default<O1..O3>`/`default<Os,Oz>` optimization never changes the observable outcome
//! relative to the unoptimized `O0` build OR relative to the independently-implemented Cranelift
//! backend.
//!
//! `llvm.rs`'s own unit tests already sweep `OptLevel` against `run_asm` on hand-built `Program`s
//! (internal, white-box); this file instead drives the PUBLIC surface (`run_native_with`, `Core` ->
//! `Program` lowering included) the way an external caller — or the other oracle files — would.

use proptest::prelude::*;
use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{DEFAULT_CAPS, decode_asm};
use redextape_core::value::Value;
use redextape_core::{RunError, run};
use redextape_native::{Codegen, NativeRun, OptLevel, run_native_with};
use redextape_test_support::arb_expr_over;

/// Every level `OptLevel` offers, the size-oriented ones (`Os`/`Oz`) included, swept rather than
/// spot-checking `O3` and hoping.
const OPT_LEVELS: [OptLevel; 6] = [OptLevel::O0, OptLevel::O1, OptLevel::O2, OptLevel::O3, OptLevel::Os, OptLevel::Oz];

/// Parse + desugar `src` to Core, panicking on a parse error (every demo string here is known-good).
fn core_of(src: &str) -> Core {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for `{src}`: {ds:?}");
    desugar(&prog.unwrap())
}

/// Decode a `NativeRun` that must have produced a value, panicking with `label` for context
/// otherwise -- every call site here expects `Ran`, so a `Fault`/`HitCap`/`LowerError` is itself the
/// bug the oracle exists to catch.
fn ran(run: &NativeRun, expected: &Value, label: &str) -> Value {
    match run {
        NativeRun::Ran(o) => decode_asm(o, expected).unwrap_or_else(|| panic!("{label}: decode failed")),
        other => panic!("{label}: expected Ran, got {other:?}"),
    }
}

/// `reference == cranelift == llvm` for every `OptLevel`, with an explicit `cranelift == llvm`
/// comparison at each level (not just each transitively agreeing with `reference`).
///
/// BOTH backends are swept: Cranelift's `opt_level` collapses the six levels onto three
/// (`none`/`speed`/`speed_and_size`), so sweeping it is partly redundant compile work — but it is
/// what makes "every `(backend, OptLevel)` pair agrees" a checked claim rather than an inference from
/// how the levels happen to map today.
fn assert_cross_backend_agree(src: &str) {
    let reference = run(src).unwrap_or_else(|e| panic!("reference run failed for `{src}`: {e:?}"));
    let core = core_of(src);

    let mut cl_values = Vec::new();
    for opt in OPT_LEVELS {
        let cl = run_native_with(&core, DEFAULT_CAPS, Codegen::Cranelift { opt });
        let cl_value = ran(&cl, &reference, &format!("cranelift {opt:?} `{src}`"));
        assert_eq!(cl_value, reference, "cranelift {opt:?} vs reference disagree for: {src}");
        cl_values.push(cl_value);
    }

    for (opt, cl_value) in OPT_LEVELS.into_iter().zip(&cl_values) {
        let llvm = run_native_with(&core, DEFAULT_CAPS, Codegen::Llvm { opt });
        let llvm_value = ran(&llvm, &reference, &format!("llvm {opt:?} `{src}`"));
        assert_eq!(llvm_value, reference, "llvm {opt:?} vs reference disagree for: {src}");
        assert_eq!(&llvm_value, cl_value, "llvm {opt:?} vs cranelift {opt:?} disagree for: {src}");
    }
}

/// The demo set: arithmetic, comparison, list construction/access, recursion, and a defunctionalized
/// higher-order program (`map`) -- first-order and higher-order lowering paths both exercised, plus
/// a value beyond the TM's `MAX_FIELD_WIDTH` (native has no such ceiling on either backend).
const CASES: &[&str] = &[
    "1 + 2 * 3",
    "10 > 3",
    "[1, 2, 3]",
    "fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(100)",
    "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} [5,6].map(add1)",
    "head(tail([1, 2, 3]))",
    "100 * 100",
    // A mutually recursive group (`Core::LetRecGroup`): the first program shape in this repo that
    // produces a genuine SCC AMONG SUBROUTINES. Everything above is either self-recursive (`sum`) or
    // a DAG (defunc'd `map` + `$apply1`), and an SCC is exactly what LLVM's bottom-up inliner treats
    // specially -- in the backend where Phase 2 already found IPO-related defects. Three members, so
    // the answer 1+2+4+1 = 8 pins the rotation of the cycle rather than merely its members.
    "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
     fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
     fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)",
];

#[test]
fn reference_cranelift_llvm_agree() {
    for src in CASES {
        assert_cross_backend_agree(src);
    }
}

#[test]
fn llvm_faults_and_caps_match() {
    // `head(nil)`/`tail(nil)`: the reference faults at runtime, and every codegen backend, at every
    // opt level, must report `Fault` -- not a value, not a crash, not a spurious `HitCap`.
    //
    // The message TEXT is compared too, which the plan's literal Agreement Contract (same outcome
    // CLASS) does not require. It costs nothing -- both backends route every fault through the same
    // `rt_*` host functions, so the text is the runtime's, not either codegen's -- and it catches a
    // whole "right class, wrong message" regression class: a backend synthesizing its own fault, or
    // tripping a DIFFERENT fault condition than the other while landing in the same class.
    for src in ["head(nil)", "tail(nil)"] {
        let core = core_of(src);
        assert!(matches!(run(src), Err(RunError::Runtime(_))), "the reference must fault on `{src}`");
        for opt in OPT_LEVELS {
            let cl = run_native_with(&core, DEFAULT_CAPS, Codegen::Cranelift { opt });
            let NativeRun::Fault(cl_msg) = &cl else { panic!("cranelift {opt:?} `{src}`: {cl:?}") };
            let llvm = run_native_with(&core, DEFAULT_CAPS, Codegen::Llvm { opt });
            let NativeRun::Fault(llvm_msg) = &llvm else { panic!("llvm {opt:?} `{src}`: {llvm:?}") };
            assert_eq!(llvm_msg, cl_msg, "llvm {opt:?} vs cranelift {opt:?} fault message for `{src}`");
        }
    }

    // `spin(n) = spin(n)`: infinite recursion must trip the depth cap on every backend/opt level, not
    // overflow the OS stack (an uncatchable process abort) or loop forever.
    let spin = core_of("fn spin(n){ spin(n) } spin(0)");
    for opt in OPT_LEVELS {
        let cl_spin = run_native_with(&spin, DEFAULT_CAPS, Codegen::Cranelift { opt });
        assert!(matches!(cl_spin, NativeRun::HitCap), "cranelift {opt:?} spin: {cl_spin:?}");
        let llvm_spin = run_native_with(&spin, DEFAULT_CAPS, Codegen::Llvm { opt });
        assert!(matches!(llvm_spin, NativeRun::HitCap), "llvm {opt:?} spin: {llvm_spin:?}");
    }
}

/// A small first-order expression generator (arithmetic/comparison/if only; shape supplied by
/// `redextape-test-support`'s `arb_expr_over`, shared with `native_oracle.rs`'s generators rather than
/// copied from them) for a randomized cross-backend differential. Kept deliberately SMALL: each
/// generated program here compiles SEVEN times (Cranelift once, plus LLVM at all six opt levels),
/// unlike the single-backend suite whose generator this one shares.
fn arb_first_order_expr() -> impl Strategy<Value = String> {
    arb_expr_over((0u64..1000).prop_map(|n| n.to_string()))
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 12, ..ProptestConfig::default() })]

    /// The literal cross-backend leg on randomized first-order programs: `cranelift == llvm` at
    /// every opt level, AND both against `reference`. Bounded to 12 cases (rather than the 64 the
    /// single-backend generator in `native_oracle.rs` uses) because each case here JIT-compiles
    /// thirteen times: one Cranelift pivot run (which establishes the reference/native outcome
    /// pairing the match below is built on), then BOTH backends at all six opt levels.
    #[test]
    fn cranelift_and_llvm_agree_on_random_first_order_programs(src in arb_first_order_expr()) {
        let (prog, ds) = parse(&src);
        prop_assume!(ds.is_empty()); // skip anything that does not parse/type-check
        let core = desugar(&prog.unwrap());
        let reference = run(&src);
        let cl = run_native_with(&core, DEFAULT_CAPS, Codegen::Cranelift { opt: OptLevel::default() });
        match (reference, cl) {
            (Ok(rv), NativeRun::Ran(cl_outcome)) => {
                let cl_value = decode_asm(&cl_outcome, &rv).expect("decode cranelift");
                prop_assert_eq!(&cl_value, &rv, "cranelift vs reference disagree: {}", src);
                for opt in OPT_LEVELS {
                    match run_native_with(&core, DEFAULT_CAPS, Codegen::Cranelift { opt }) {
                        NativeRun::Ran(o) => {
                            let cl_at = decode_asm(&o, &rv).expect("decode cranelift");
                            prop_assert_eq!(&cl_at, &rv, "cranelift {:?} vs reference disagree: {}", opt, src);
                        }
                        other => prop_assert!(false, "cranelift {:?} did not run {}: {:?}", opt, src, other),
                    }
                    match run_native_with(&core, DEFAULT_CAPS, Codegen::Llvm { opt }) {
                        NativeRun::Ran(o) => {
                            let llvm_value = decode_asm(&o, &rv).expect("decode llvm");
                            prop_assert_eq!(&llvm_value, &rv, "llvm {:?} vs reference disagree: {}", opt, src);
                            prop_assert_eq!(&llvm_value, &cl_value, "llvm {:?} vs cranelift disagree: {}", opt, src);
                        }
                        other => prop_assert!(false, "llvm {:?} did not run {}: {:?}", opt, src, other),
                    }
                }
            }
            // Unreachable with THIS generator, and deliberately strict about it: `arb_first_order_expr`
            // emits only `+`, monus `-`, comparisons and `if` over `0..1000` literals, none of which
            // can error in the reference or fault/cap natively, so `(Ok, Ran)` is the only legitimate
            // pairing. If the generator ever gains a PARTIAL operation (`head`/`tail`, division, a
            // recursive `fn`), a "reference errors AND the backend faults" pairing becomes a legitimate
            // agreement and this arm must grow a case for it rather than staying a blanket failure.
            (r, n) => prop_assert!(false, "mismatch for {}:\n  reference={:?}\n  cranelift={:?}", src, r, n),
        }
    }
}
