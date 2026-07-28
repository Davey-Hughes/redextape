//! Part of the backend oracle (spec §12.1), control-flow slice: the reference tree-walker and the
//! genuine multi-tape TM agree on straight-line + branching programs (no calls, no heap yet). Also
//! carries the intermediate `asm-interp == TM` oracle (a disagreement localizes to asm->TM lowering)
//! and cap-equivalence. Parts 2b-2-ii/iii/iv extend this to calls, lists, and the full
//! `reference == lambda == TM`. As of Task 14 every demo below runs under BOTH `Unary` and `Binary`
//! (`assert_tm_agrees`/`assert_asm_interp_matches_tm` take `enc: &dyn Encoding` and each test calls the
//! body twice), so this file's two legs (reference==TM, asm-interp==TM) both cover the binary TM too.
//!
//! Both helpers use `run_tm_fitted`, not `run_tm`, and decode with `enc.at_width(width)` at the width
//! the fit actually settled on. That was once REQUIRED: `Binary`'s decode used to be width-strict, and
//! decoding a fitted-at-16 tape with a 64-cell `Binary` returned `None` for every demo here, not just
//! the headline `100 * 100` case. Both decoders are structural now (`binary.rs`, "Reading a tape back"),
//! so any instance would do.
//!
//! It stays anyway, and not out of inertia: the fitted width is the one an oracle disagreement would be
//! reported at, and threading it keeps `at_width` on the executed path rather than leaving it to the
//! width-equivalence suite alone.

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{
    AsmRun, Binary, DEFAULT_CAPS as ASM_CAPS, Encoding, TM_DEFAULT_CAPS, TmRun, Unary, decode_asm, decode_tape,
    lower_asm, run_asm, run_tm, run_tm_fitted,
};
use redextape_core::{RunError, run};

/// The reference result and the TM's decoded final tape must agree (guided by the reference value's
/// type). A reference runtime fault/cap corresponds to a TM cap. `enc` selects which encoding drives
/// this run (`Unary` or `Binary`), so this localizer covers both TM legs of the four-way oracle.
fn assert_tm_agrees(src: &str, enc: &dyn Encoding) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let (outcome, width) = run_tm_fitted(&core, enc, TM_DEFAULT_CAPS);
    match (reference, outcome) {
        (Ok(rv), TmRun::Ran { tapes }) => {
            let fitted = enc.at_width(width.unwrap_or(64));
            assert_eq!(decode_tape(&tapes, &rv, &*fitted), Some(rv.clone()), "reference vs TM disagree for: {src}");
        }
        (Err(RunError::Runtime(_)), TmRun::HitCap) => {}
        (r, t) => panic!("oracle mismatch for {src}:\n  reference={r:?}\n  tm={t:?}"),
    }
}

/// The intermediate oracle: the asm interpreter and the TM sim decode to the same value. Localizes a
/// disagreement to asm->TM lowering (the reference==asm link is proven in `asm_oracle.rs`). `enc`
/// selects which encoding drives the TM leg.
fn assert_asm_interp_matches_tm(src: &str, enc: &dyn Encoding) {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let reference = run(src).expect("control-flow demos run to a value");
    let program = lower_asm(&core).expect("lowering to asm succeeds");
    let asm = match run_asm(&program, ASM_CAPS) {
        AsmRun::Ran(o) => decode_asm(&o, &reference).expect("asm decode"),
        other => panic!("asm did not run for {src}: {other:?}"),
    };
    let (outcome, width) = run_tm_fitted(&core, enc, TM_DEFAULT_CAPS);
    let tm = match outcome {
        TmRun::Ran { tapes } => {
            let fitted = enc.at_width(width.unwrap_or(64));
            decode_tape(&tapes, &reference, &*fitted).expect("tm decode")
        }
        other => panic!("tm did not run for {src}: {other:?}"),
    };
    assert_eq!(asm, tm, "asm-interp vs TM disagree for: {src}");
}

/// The control-flow demo subset: arithmetic, monus, comparisons, if, let/let mut, assign, while, seq.
/// No `call`/`ret`, no list/heap ops (those are Parts 2b-2-ii/iii). Values stay well under MAX_FIELD_WIDTH.
const CONTROL_FLOW_DEMOS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "if 1 == 2 { 10 } else { 20 }",
    "let x = 40; x + 2",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    // Latent-trap program (Plan 2 follow-up): an immutable `let` shadowing a mutable variable.
    "let mut x = 1; x = x + 1; let x = x + 10; x",
];

#[test]
fn tm_agrees_with_reference_on_control_flow_demos() {
    for src in CONTROL_FLOW_DEMOS {
        assert_tm_agrees(src, &Unary::default());
        assert_tm_agrees(src, &Binary::default());
    }
}

#[test]
fn asm_interp_matches_tm_on_control_flow_demos() {
    for src in CONTROL_FLOW_DEMOS {
        assert_asm_interp_matches_tm(src, &Unary::default());
        assert_asm_interp_matches_tm(src, &Binary::default());
    }
}

/// The call/recursion demo subset: named-fn calls, recursion, a directly-applied lambda, and a `fn`
/// inside a mutation region (Plan-2 latent trap). Still NO list/heap ops (Part 2b-2-iii). Values « 64.
///
/// Unary recursion is step-heavy (`Call`/`Ret` save/restore a whole frame per level, and each frame op
/// is many TM steps), so these were checked against `TM_DEFAULT_CAPS` (5,000,000 steps/cells) before
/// being added: even the heaviest, `sum(5)`, halts in ~178k steps (~3.6% of the cap, no `HitCap`), so
/// `assert_tm_agrees`/`assert_asm_interp_matches_tm` are used unmodified — no raised-cap variant needed.
const CALL_DEMOS: &[&str] = &[
    "let add1 = |x| x + 1; add1(41)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
    // Plan-2 latent-trap program: a `fn` defined inside a mutation region.
    "let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc",
];

#[test]
fn tm_agrees_with_reference_on_call_demos() {
    for src in CALL_DEMOS {
        assert_tm_agrees(src, &Unary::default());
        assert_tm_agrees(src, &Binary::default());
    }
}

#[test]
fn asm_interp_matches_tm_on_call_demos() {
    for src in CALL_DEMOS {
        assert_asm_interp_matches_tm(src, &Unary::default());
        assert_asm_interp_matches_tm(src, &Binary::default());
    }
}

/// The list-CONSTRUCTION demo subset: nil, cons, is_empty, and a list literal (desugars to a cons
/// spine). NO head/tail (those dereference a pointer — Part 2b-2-iii-b). Values/lengths « MAX_FIELD_WIDTH.
const LIST_BUILD_DEMOS: &[&str] = &["is_empty(nil)", "is_empty(cons(1, nil))", "[1, 2, 3]", "cons(1, cons(2, nil))"];

#[test]
fn tm_agrees_with_reference_on_list_build_demos() {
    for src in LIST_BUILD_DEMOS {
        assert_tm_agrees(src, &Unary::default());
        assert_tm_agrees(src, &Binary::default());
    }
}

#[test]
fn asm_interp_matches_tm_on_list_build_demos() {
    for src in LIST_BUILD_DEMOS {
        assert_asm_interp_matches_tm(src, &Unary::default());
        assert_asm_interp_matches_tm(src, &Binary::default());
    }
}

/// The list-ACCESS demo subset: head/tail deref on real (non-nil) lists — head -> a Nat, tail -> nil or
/// a sub-list pointer, and a nested head(tail(...)). NO faulting access (head/tail of nil): the reference
/// faults (RunError::Runtime) while the TM defensively halts, which is an oracle mismatch BY DESIGN;
/// oracle-level fault-equivalence is Part 2b-2-iv. Values/lengths « MAX_FIELD_WIDTH.
const LIST_ACCESS_DEMOS: &[&str] = &[
    "head(cons(7, nil))",
    "tail(cons(7, nil))",
    "head(cons(1, cons(2, nil)))",
    "tail(cons(1, cons(2, nil)))",
    "head(tail(cons(1, cons(2, nil))))",
    "head([1, 2, 3])",
    "tail([1, 2, 3])",
];

#[test]
fn tm_agrees_with_reference_on_list_access_demos() {
    for src in LIST_ACCESS_DEMOS {
        assert_tm_agrees(src, &Unary::default());
        assert_tm_agrees(src, &Binary::default());
    }
}

#[test]
fn asm_interp_matches_tm_on_list_access_demos() {
    for src in LIST_ACCESS_DEMOS {
        assert_asm_interp_matches_tm(src, &Unary::default());
        assert_asm_interp_matches_tm(src, &Binary::default());
    }
}

#[test]
fn tm_cap_matches_a_reference_nonterminating_program() {
    // An unbounded loop: the reference hits its step budget (Runtime error) and the TM hits its cap.
    // Both are the "same outcome" under cap-equivalence. The assertion holds because the 50_000-step
    // cap fires long before the loop counter `n` grows anywhere near MAX_FIELD_WIDTH (64): at roughly
    // 10-20x this cap, `n` would reach MAX_FIELD_WIDTH, the unary field would go exactly full,
    // `rewind_home` would miscount (the documented MAX_FIELD_WIDTH failure mode), and the machine would
    // get stuck -> Halted, making `run_tm` return `Ran`, not `HitCap`. Do not raise this cap: a much
    // larger one would terminate via that corruption instead of via `HitCap`.
    //
    // UNARY ONLY, deliberately: the failure mode this test pins is a strict-bound artifact of a
    // content-driven (mark/blank) field, which `Binary`'s module doc states plainly has no analogue --
    // every binary field is the same length and both digits are content, so there is no "padding blank
    // must remain" invariant to corrupt. A binary leg here would not be testing the same thing.
    use redextape_core::tm::TmCaps;
    let src = "let mut n = 1; while n > 0 { n = n + 1; } n";
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let caps = TmCaps { steps: 50_000, cells: 50_000 };
    assert!(matches!(run_tm(&core, &Unary::default(), caps), TmRun::HitCap), "expected the TM to hit a cap");
}
