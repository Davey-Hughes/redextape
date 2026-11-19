// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
//! The stepper against the JIT at the same caps: over the snapshot corpus and random programs, in both
//! listings, a run ends with the JIT's value and heap, its fault text, or a stop at a cap where it stops.

mod common;

use common::{FRAME_MEMORY_LIST, TIGHT, agrees, corpus, listing_text, section, short, snapshot};
use cranelift_codegen::cursor::{Cursor, FuncCursor};
use cranelift_codegen::ir::types::I64;
use cranelift_codegen::ir::{AbiParam, Function, InstBuilder, Signature, TrapCode, UserFuncName};
use cranelift_codegen::isa::CallConv;
use proptest::prelude::*;
use redextape_clif::{ClifEnd, Stepper};
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{Caps, DEFAULT_CAPS, lower_program};
use redextape_core::trace::RxmCap;
use redextape_native::{Listing, NativeRun, OptLevel, build_listing, jit};
use redextape_test_support::arb_expr_below;

const LISTINGS: [Listing; 2] = [Listing::AsBuilt, Listing::Optimised];

// The programs `TIGHT` stops at each cap, the same in both listings.
const HEAP_CAPPED: [&str; 6] =
    ["example-map-fold", "first-order-24", "first-order-25", "first-order-26", "first-order-37", "measure-box30000"];
const STACK_CAPPED: [&str; 7] = [
    "beyond-field-width-02",
    "example-fact-12",
    "example-is-even",
    "first-order-36",
    "measure-list30000",
    "measure-map30000",
    "measure-sum30000",
];
const STEPS_CAPPED: [&str; 1] = ["measure-loop1000000"];

/// `funcs` stepped to their end under `caps`: the end, and the steps `run` reports.
fn run_to_end(funcs: &[Function], caps: Caps) -> (ClifEnd, u64) {
    let mut stepper = Stepper::new(funcs, caps);
    let steps = stepper.run(u64::MAX);
    assert_eq!(steps, stepper.steps_taken());
    (stepper.status().expect("run(u64::MAX) returns only at an end").clone(), steps)
}

/// What `compare` saw.
struct Tally {
    /// The JIT's ends: how many `Ran`, `Fault` and `HitCap`.
    jit: [usize; 3],
    /// Per listing, the programs the stepper stopped at a cap, with the cap, in key order.
    capped: [Vec<(RxmCap, String)>; 2],
}

impl Tally {
    /// The programs the stepper stopped at `cap` in listing `i`.
    fn capped_at(&self, i: usize, cap: RxmCap) -> Vec<&str> {
        self.capped[i].iter().filter(|(c, _)| *c == cap).map(|(_, key)| key.as_str()).collect()
    }
}

/// Every corpus program `keep` selects, run by the JIT and stepped in both listings under `caps`; fails
/// naming each run that does not end where the JIT's does.
fn compare(caps: Caps, keep: impl Fn(&str) -> bool) -> Tally {
    let mut tally = Tally { jit: [0; 3], capped: [Vec::new(), Vec::new()] };
    let mut disagreeing = Vec::new();
    for (key, prog) in corpus().into_iter().filter(|(key, _)| keep(key)) {
        let jit = jit::compile_and_run(&prog, caps, OptLevel::O0);
        match jit {
            NativeRun::Ran(_) => tally.jit[0] += 1,
            NativeRun::Fault(_) => tally.jit[1] += 1,
            NativeRun::HitCap => tally.jit[2] += 1,
            NativeRun::LowerError(_) => {}
        }
        for (i, listing) in LISTINGS.into_iter().enumerate() {
            let (end, _) = run_to_end(&build_listing(&prog, listing).unwrap(), caps);
            if !agrees(&end, &jit) {
                disagreeing.push(format!("{key} {}: {}; the JIT {}", listing.name(), short(&end), short(&jit)));
            }
            if let ClifEnd::Capped(cap) = end {
                tally.capped[i].push((cap, key.clone()));
            }
        }
    }
    assert!(disagreeing.is_empty(), "{} runs disagree:\n  {}", disagreeing.len(), disagreeing.join("\n  "));
    tally
}

/// The corpus is read from the snapshots' headers, so each program must build the listing its file records.
#[test]
fn the_corpus_is_the_snapshot_corpus() {
    let corpus = corpus();
    assert_eq!(corpus.len(), 72);
    for (key, prog) in &corpus {
        let built = listing_text(&build_listing(prog, Listing::AsBuilt).unwrap());
        assert_eq!(section(&snapshot(key), "built"), Some(built.as_str()), "{key}");
    }
}

#[test]
fn the_stepper_ends_where_the_jit_does_at_tight_caps() {
    let tally = compare(TIGHT, |_| true);
    assert_eq!(tally.jit, [56, 2, 14], "the JIT's Ran, Fault and HitCap");
    for (i, listing) in LISTINGS.into_iter().enumerate() {
        assert_eq!(tally.capped_at(i, RxmCap::Heap), HEAP_CAPPED, "{}", listing.name());
        assert_eq!(tally.capped_at(i, RxmCap::Stack), STACK_CAPPED, "{}", listing.name());
        assert_eq!(tally.capped_at(i, RxmCap::Steps), STEPS_CAPPED, "{}", listing.name());
    }
}

#[test]
fn the_stepper_ends_where_the_jit_does_at_default_caps() {
    let tally = compare(DEFAULT_CAPS, |key| !key.starts_with("measure-"));
    assert_eq!(tally.jit, [65, 2, 0], "the JIT's Ran, Fault and HitCap");
}

/// The measure programs end where the JIT's do at default caps, except those the frame-memory list names,
/// which stop at `caps.mem` in both listings.
#[test]
#[ignore = "slow tier: steps tens of millions of CLIF instructions; run via scripts/check-slow.sh"]
fn the_measure_programs_end_where_the_jit_does_at_default_caps() {
    let tally = compare(DEFAULT_CAPS, |key| key.starts_with("measure-") && !FRAME_MEMORY_LIST.contains(&key));
    assert_eq!(tally.jit, [4, 0, 0], "the JIT's Ran, Fault and HitCap");
    let corpus = corpus();
    for key in FRAME_MEMORY_LIST {
        let (_, prog) = corpus.iter().find(|(k, _)| k == key).unwrap();
        for listing in LISTINGS {
            let (end, _) = run_to_end(&build_listing(prog, listing).unwrap(), DEFAULT_CAPS);
            assert_eq!(end, ClifEnd::Capped(RxmCap::Mem), "{key} {}", listing.name());
        }
    }
}

// The native oracle's random programs, filtered as `native_agrees_with_reference_and_rxm_on_random_programs`
// filters them.
proptest! {
    #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]

    #[test]
    fn the_stepper_ends_where_the_jit_does_on_random_programs(src in arb_expr_below(1000)) {
        let (ast, ds) = parse(&src);
        prop_assume!(ds.is_empty());
        let prog = lower_program(&desugar(&ast.unwrap())).unwrap();
        let jit = jit::compile_and_run(&prog, DEFAULT_CAPS, OptLevel::O0);
        for listing in LISTINGS {
            let (end, _) = run_to_end(&build_listing(&prog, listing).unwrap(), DEFAULT_CAPS);
            prop_assert!(agrees(&end, &jit), "{} {}: {}; the JIT {}", src, listing.name(), short(&end), short(&jit));
        }
    }
}

#[test]
fn a_trap_ends_the_run_with_its_name() {
    let mut sig = Signature::new(CallConv::SystemV);
    sig.params.push(AbiParam::new(I64));
    sig.returns.push(AbiParam::new(I64));
    let mut func = Function::with_name_signature(UserFuncName::user(0, 11), sig);
    let block = func.dfg.make_block();
    func.dfg.append_block_param(block, I64);
    let mut cursor = FuncCursor::new(&mut func);
    cursor.insert_block(block);
    cursor.ins().trap(TrapCode::INTEGER_OVERFLOW);
    let funcs = [func];
    let mut stepper = Stepper::new(&funcs, DEFAULT_CAPS);
    assert!(!stepper.step());
    assert_eq!(stepper.status(), Some(&ClifEnd::Trap("user code: int_ovf".to_string())));
    assert_eq!(stepper.steps_taken(), 0);
    assert!(!stepper.step(), "a step after the end");
    assert_eq!(stepper.status(), Some(&ClifEnd::Trap("user code: int_ovf".to_string())));
}

/// `head(nil)` and `tail(nil)` fault at the call lowered from pc 1, and main returns from pc 2.
#[test]
fn a_fault_ends_with_the_pc_of_the_call_that_faulted() {
    let corpus = corpus();
    for (key, why) in [("fault-00", "head of empty list"), ("fault-01", "tail of empty list")] {
        let (_, prog) = corpus.iter().find(|(k, _)| k == key).unwrap();
        for listing in LISTINGS {
            let (end, _) = run_to_end(&build_listing(prog, listing).unwrap(), DEFAULT_CAPS);
            assert_eq!(end, ClifEnd::Fault { pc: Some(1), why: why.to_string() }, "{key} {}", listing.name());
        }
    }
}

#[test]
fn steps_count_every_instruction() {
    let corpus = corpus();
    let cases = [
        ("example-sum-to", DEFAULT_CAPS, [183, 134]),
        ("example-fact", DEFAULT_CAPS, [189, 131]),
        ("measure-loop1000000", TIGHT, [1_205, 985]),
    ];
    for (key, caps, steps) in cases {
        let (_, prog) = corpus.iter().find(|(k, _)| k == key).unwrap();
        for (listing, want) in LISTINGS.into_iter().zip(steps) {
            let funcs = build_listing(prog, listing).unwrap();
            let mut stepper = Stepper::new(&funcs, caps);
            assert_eq!(stepper.run(100), 100, "{key} {}: a budget", listing.name());
            assert_eq!(stepper.status(), None, "{key} {}", listing.name());
            assert_eq!(stepper.run(10_000), want - 100, "{key} {}: the rest", listing.name());
            assert_eq!(stepper.steps_taken(), want, "{key} {}", listing.name());
            let end = stepper.status().unwrap();
            if key.starts_with("measure-") {
                assert_eq!(end, &ClifEnd::Capped(RxmCap::Steps), "{key} {}", listing.name());
            } else {
                assert!(matches!(end, ClifEnd::Ran(_)), "{key} {}: {}", listing.name(), short(end));
            }
            assert!(!stepper.step(), "{key} {}: a step after the end", listing.name());
            assert_eq!(stepper.steps_taken(), want, "{key} {}: after the end", listing.name());
        }
    }
}
