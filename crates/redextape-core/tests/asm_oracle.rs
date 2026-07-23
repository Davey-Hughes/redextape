//! Part 1 of the three-way oracle (spec §12.2): the reference tree-walker and the asm interpreter
//! agree on every first-order demo. This is the intermediate oracle that makes Part 2's TM δ-tables
//! debuggable (a disagreement is localized to Core→asm before the TM even exists).

use proptest::prelude::*;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{AsmRun, DEFAULT_CAPS, decode_asm, lower_asm, run_asm};
use redextape_core::{RunError, run};

/// Every program the reference runs to a value, the asm backend must run to an outcome that decodes
/// (guided by that value's type) to the SAME value. Reference faults/caps match asm non-`Ran`.
fn assert_asm_agrees(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let program = lower_asm(&core).unwrap_or_else(|e| panic!("lowering failed for {src}: {e:?}"));
    match (reference, run_asm(&program, DEFAULT_CAPS)) {
        (Ok(rv), AsmRun::Ran(o)) => {
            assert_eq!(decode_asm(&o, &rv), Some(rv.clone()), "reference vs asm disagree for: {src}");
        }
        (Err(RunError::Runtime(_)), AsmRun::HitCap | AsmRun::Fault(_)) => {
            // A reference runtime fault/cap matches an asm cap/fault (e.g. head(nil)).
        }
        (r, a) => panic!("oracle mismatch for {src}:\n  reference={r:?}\n  asm={a:?}"),
    }
}

#[test]
fn asm_oracle_on_the_first_order_demo_suite() {
    let demos = [
        "1 + 2 * 3",
        "3 - 5",
        "if 2 > 1 { 10 } else { 20 }",
        "let add1 = |x| x + 1; add1(41)",
        "head(cons(7, nil))",
        "is_empty(nil)",
        "[1, 2, 3]",
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
        "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    ];
    for src in demos {
        assert_asm_agrees(src);
    }
}

#[test]
fn asm_oracle_on_the_latent_trap_programs() {
    // Plan 2 follow-ups: an immutable `let` shadowing a mutable variable, and a `fn` defined inside a
    // mutation region — both must agree three-way (here: reference == asm).
    assert_asm_agrees("let mut x = 1; x = x + 1; let x = x + 10; x");
    assert_asm_agrees("let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc");
}

#[test]
fn head_of_empty_matches_a_reference_fault() {
    assert_asm_agrees("head(nil)");
}

/// A tiny first-order expression generator that stays within every backend's caps: `Nat` literals
/// are bounded (< 1500, the λ-representability bound), nesting is shallow, and it emits only the
/// first-order constructs Part 1 supports (no function-as-a-value, no closures passed as arguments).
fn arb_expr() -> impl Strategy<Value = String> {
    let leaf = (0u64..1500).prop_map(|n| n.to_string());
    leaf.prop_recursive(4, 32, 3, |inner| {
        prop_oneof![
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} + {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} - {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} * {b})")),
            (inner.clone(), inner.clone(), inner.clone())
                .prop_map(|(c, a, b)| format!("if {c} > 0 {{ {a} }} else {{ {b} }}")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("(if {a} > {b} {{ {a} }} else {{ {b} }})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("(if {a} == {b} {{ 1 }} else {{ 0 }})")),
            (inner.clone(), inner.clone()).prop_map(|(v, body)| format!("let q = {v}; ({body} + q)")),
            (inner.clone(), inner).prop_map(|(v, body)| format!("(let q = {v}; let r = q + q; {body} + r)")),
        ]
    })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 200, ..ProptestConfig::default() })]

    #[test]
    fn asm_agrees_with_reference_on_random_first_order_programs(src in arb_expr()) {
        // Both must reach the same place: a value that decodes equal, or a shared cap/fault.
        let reference = run(&src);
        let (prog, ds) = parse(&src);
        prop_assume!(ds.is_empty()); // skip anything that does not parse/type-check
        let core = desugar(&prog.unwrap());
        let program = match lower_asm(&core) {
            Ok(p) => p,
            Err(_) => return Ok(()), // Unsupported/TooDeep: outside this property's scope
        };
        match (reference, run_asm(&program, DEFAULT_CAPS)) {
            (Ok(rv), AsmRun::Ran(o)) => prop_assert_eq!(decode_asm(&o, &rv), Some(rv)),
            (Err(RunError::Runtime(_)), AsmRun::HitCap | AsmRun::Fault(_)) => {}
            (r, a) => prop_assert!(false, "mismatch for {}:\n ref={:?}\n asm={:?}", src, r, a),
        }
    }
}

#[test]
fn deep_list_literal_lowers_without_overflowing() {
    // A huge list literal desugars to a deep cons-Apply spine. lower_asm must return (Ok or a
    // TooDeep LowerError), never overflow the native stack. Run it on an explicit 8 MiB thread — the
    // production main-thread stack size that MAX_LOWER_DEPTH (580) is tuned against, like the Plan 1
    // guards. On 8 MiB the guard fires at depth 580 (yielding TooDeep) with ~2x margin below the
    // measured ~1175-deep native crash point, while the unguarded 40_000-deep recursion (40_000 »
    // that crash depth) WOULD overflow — so this still genuinely proves the guard prevents the native
    // overflow, not just that the input happens to fit. (A 512 KiB thread would hold only ~90
    // lower_into frames and so overflow before the guard fires; the constant must be dictated by the
    // real production stack.)
    std::thread::Builder::new()
        .stack_size(8 * 1024 * 1024)
        .spawn(|| {
            let src = format!("[{}]", vec!["1"; 40_000].join(", "));
            let (prog, ds) = parse(&src);
            assert!(ds.is_empty(), "parse errors: {ds:?}");
            let core = desugar(&prog.unwrap());
            let _ = lower_asm(&core); // Ok or Err — must not abort the process
        })
        .unwrap()
        .join()
        .unwrap();
}
