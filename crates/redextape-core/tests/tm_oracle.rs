//! Part of the three-way oracle (spec §12.1), control-flow slice: the reference tree-walker and the
//! genuine multi-tape TM agree on straight-line + branching programs (no calls, no heap yet). Also
//! carries the intermediate `asm-interp == TM` oracle (a disagreement localizes to asm->TM lowering)
//! and cap-equivalence. Parts 2b-2-ii/iii/iv extend this to calls, lists, and the full
//! `reference == lambda == TM`.

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{
    AsmRun, DEFAULT_CAPS as ASM_CAPS, TM_DEFAULT_CAPS, TmRun, Unary, decode_asm, decode_tape, lower_asm, run_asm,
    run_tm,
};
use redextape_core::{RunError, run};

/// The reference result and the TM's decoded final tape must agree (guided by the reference value's
/// type). A reference runtime fault/cap corresponds to a TM cap.
fn assert_tm_agrees(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    match (reference, run_tm(&core, &Unary, TM_DEFAULT_CAPS)) {
        (Ok(rv), TmRun::Ran { tapes }) => {
            assert_eq!(decode_tape(&tapes, &rv, &Unary), Some(rv.clone()), "reference vs TM disagree for: {src}");
        }
        (Err(RunError::Runtime(_)), TmRun::HitCap) => {}
        (r, t) => panic!("oracle mismatch for {src}:\n  reference={r:?}\n  tm={t:?}"),
    }
}

/// The intermediate oracle: the asm interpreter and the TM sim decode to the same value. Localizes a
/// disagreement to asm->TM lowering (the reference==asm link is proven in `asm_oracle.rs`).
fn assert_asm_interp_matches_tm(src: &str) {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let reference = run(src).expect("control-flow demos run to a value");
    let program = lower_asm(&core).expect("lowering to asm succeeds");
    let asm = match run_asm(&program, ASM_CAPS) {
        AsmRun::Ran(o) => decode_asm(&o, &reference).expect("asm decode"),
        other => panic!("asm did not run for {src}: {other:?}"),
    };
    let tm = match run_tm(&core, &Unary, TM_DEFAULT_CAPS) {
        TmRun::Ran { tapes } => decode_tape(&tapes, &reference, &Unary).expect("tm decode"),
        other => panic!("tm did not run for {src}: {other:?}"),
    };
    assert_eq!(asm, tm, "asm-interp vs TM disagree for: {src}");
}

/// The control-flow demo subset: arithmetic, monus, comparisons, if, let/let mut, assign, while, seq.
/// No `call`/`ret`, no list/heap ops (those are Parts 2b-2-ii/iii). Values stay well under FIELD_WIDTH.
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
        assert_tm_agrees(src);
    }
}

#[test]
fn asm_interp_matches_tm_on_control_flow_demos() {
    for src in CONTROL_FLOW_DEMOS {
        assert_asm_interp_matches_tm(src);
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
        assert_tm_agrees(src);
    }
}

#[test]
fn asm_interp_matches_tm_on_call_demos() {
    for src in CALL_DEMOS {
        assert_asm_interp_matches_tm(src);
    }
}

#[test]
fn tm_cap_matches_a_reference_nonterminating_program() {
    // An unbounded loop: the reference hits its step budget (Runtime error) and the TM hits its cap.
    // Both are the "same outcome" under cap-equivalence. The assertion holds because the 50_000-step
    // cap fires long before the loop counter `n` grows anywhere near FIELD_WIDTH (64): at roughly
    // 10-20x this cap, `n` would reach FIELD_WIDTH, the unary field would go exactly full,
    // `rewind_home` would miscount (the documented FIELD_WIDTH failure mode), and the machine would
    // get stuck -> Halted, making `run_tm` return `Ran`, not `HitCap`. Do not raise this cap: a much
    // larger one would terminate via that corruption instead of via `HitCap`.
    use redextape_core::tm::TmCaps;
    let src = "let mut n = 1; while n > 0 { n = n + 1; } n";
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let caps = TmCaps { steps: 50_000, cells: 50_000 };
    assert!(matches!(run_tm(&core, &Unary, caps), TmRun::HitCap), "expected the TM to hit a cap");
}
