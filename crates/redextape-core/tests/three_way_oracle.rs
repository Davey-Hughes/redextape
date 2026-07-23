//! The three-way oracle (spec §12.1): for every first-order demo, the reference tree-walker's value,
//! the decoded λ normal form, and the decoded TM final tape all agree. Runtime faults are the shared
//! "no value" outcome (reference Runtime, λ HitCap, TM HitCap). Higher-order programs (map/fold, a
//! function-valued argument) are three-way too as of Plan 3b-1: `run_tm` defunctionalizes -- rewrites
//! higher-order Core into the first-order subset `lower_asm` already handles -- before lowering, so
//! they run on the TM like everything else. The dual case is the λ-refuses side
//! (`LAMBDA_LIMITATION_DEMOS`/`assert_tm_only`): Plan-2 latent traps that λ v1 REJECTS (`LowerError`)
//! while the reference and the first-order TM both run them to a value. The per-category oracles
//! (tm_oracle.rs's reference==TM / asm-interp==TM, lambda_oracle.rs's reference==λ) stay for
//! localization; this file is the unified capstone.

use proptest::prelude::*;
use redextape_core::desugar::desugar;
use redextape_core::lambda::{LambdaRun, MAX_REDUCTION_STEPS, decode, run_lambda};
use redextape_core::parser::parse;
use redextape_core::tm::{TM_DEFAULT_CAPS, TmCaps, TmRun, Unary, decode_tape, run_tm};
use redextape_core::{RunError, run};

/// reference == λ == TM, guided by the reference value's type. All three must run to a value that
/// decodes equal.
fn assert_three_way(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
    let tm = run_tm(&core, &Unary, TM_DEFAULT_CAPS);
    match (reference, lambda, tm) {
        (Ok(rv), LambdaRun::Reduced(nf), TmRun::Ran { tapes }) => {
            assert_eq!(decode(&nf, &rv), Some(rv.clone()), "reference vs λ disagree for: {src}");
            assert_eq!(decode_tape(&tapes, &rv, &Unary), Some(rv.clone()), "reference vs TM disagree for: {src}");
        }
        (r, l, t) => panic!("three-way oracle mismatch for {src}:\n  reference={r:?}\n  lambda={l:?}\n  tm={t:?}"),
    }
}

/// A runtime-faulting program: the reference faults (Runtime), λ's head/tail of nil is Ω (no normal
/// form), and the TM's deref fault state spins — all the same "no value" outcome. Small caps keep the
/// two divergences fast.
fn assert_three_way_diverges(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let lambda = run_lambda(&core, 20_000);
    let tm = run_tm(&core, &Unary, TmCaps { steps: 20_000, cells: 20_000 });
    match (reference, lambda, tm) {
        (Err(RunError::Runtime(_)), LambdaRun::HitCap, TmRun::HitCap) => {}
        (r, l, t) => panic!("expected all three to diverge on {src}:\n  reference={r:?}\n  lambda={l:?}\n  tm={t:?}"),
    }
}

/// A program the λ backend refuses to lower in v1 (`LowerError`),
/// while the reference and the first-order TM agree on the value.
fn assert_tm_only(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    assert!(
        matches!(run_lambda(&core, MAX_REDUCTION_STEPS), LambdaRun::LowerError(_)),
        "λ should refuse the v1 latent trap: {src}"
    );
    match (reference, run_tm(&core, &Unary, TM_DEFAULT_CAPS)) {
        (Ok(rv), TmRun::Ran { tapes }) => {
            assert_eq!(decode_tape(&tapes, &rv, &Unary), Some(rv.clone()), "reference vs TM disagree for: {src}")
        }
        (r, t) => panic!("reference vs TM mismatch for {src}:\n  reference={r:?}\n  tm={t:?}"),
    }
}

/// The full first-order demo suite — arithmetic, monus, comparison, if, let/let-mut/assign/while/seq,
/// calls & recursion, list construction & access, and (Plan 3b-1) higher-order programs that `run_tm`
/// now defunctionalizes before lowering (a function passed as a value, `map`/`fold`). Every value
/// stays « FIELD_WIDTH (64) and every program runs to a value on ALL THREE backends. (The Plan-2
/// latent traps that λ v1 REJECTS live in LAMBDA_LIMITATION_DEMOS below — they are not three-way.)
const FIRST_ORDER_DEMOS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "if 1 == 2 { 10 } else { 20 }",
    "let x = 40; x + 2",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "let add1 = |x| x + 1; add1(41)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
    "is_empty(nil)",
    "is_empty(cons(1, nil))",
    "[1, 2, 3]",
    "cons(1, cons(2, nil))",
    "head(cons(7, nil))",
    "tail(cons(7, nil))",
    "head(cons(1, cons(2, nil)))",
    "tail(cons(1, cons(2, nil)))",
    "head(tail(cons(1, cons(2, nil))))",
    "head([1, 2, 3])",
    "tail([1, 2, 3])",
    // Higher-order (Plan 3b-1): a function received as a value, defunctionalized before lowering.
    "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    // Higher-order with immutable capture (Plan 3b-1 Task 4): `|x| x + n` captures `n` by value.
    "let n = 5; fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } [1, 2, 3].map(|x| x + n)",
    "\
        fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
        fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
        fn add(a, b) { a + b }\n\
        fn add1(x) { x + 1 }\n\
        fold([3, 1, 2].map(add1), 0, add)",
    // Higher-order currying (Plan 3b-1): a value-lambda whose body is ANOTHER value-lambda
    // (`|y| |z| y + z`). Both nested closures now get guaranteed-unique anon names, so `defunc` no
    // longer panics on the duplicate key and this defuncs three-way to 9.
    "fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)",
];

/// Runtime-faulting programs: the reference faults, both other backends diverge — all "no value".
const FAULT_DEMOS: &[&str] = &["head(nil)", "tail(nil)"];

/// Plan-2 latent-trap programs the λ backend REJECTS in v1 (an immutable `let` shadowing a mutable
/// variable; a `fn` inside a mutation region — λ returns `LowerError` rather than silently miscompile,
/// commit 54aad42), while the reference and the first-order TM both run them to a value. Asserted
/// reference == TM, and λ is `LowerError`.
const LAMBDA_LIMITATION_DEMOS: &[&str] = &[
    "let mut x = 1; x = x + 1; let x = x + 10; x",
    "let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc",
];

#[test]
fn three_way_oracle_on_the_first_order_suite() {
    for src in FIRST_ORDER_DEMOS {
        assert_three_way(src);
    }
}

#[test]
fn three_way_faults_diverge_on_all_backends() {
    for src in FAULT_DEMOS {
        assert_three_way_diverges(src);
    }
}

#[test]
fn latent_traps_agree_reference_and_tm_while_lambda_refuses() {
    for src in LAMBDA_LIMITATION_DEMOS {
        assert_tm_only(src);
    }
}

/// A first-order expression generator whose value — AND every intermediate — stays under FIELD_WIDTH
/// (64) (the `depth=3` recursion cap plus value-non-growing ops keep it there; measured max 27 over 2M
/// samples), so the TM's fixed-width unary fields never overflow. Leaves are `< 8` and the node budget
/// keeps the total leaf-sum small; it emits only value-non-growing ops: `+` (bounded by the leaf-sum),
/// monus `-` (shrinks), comparisons and `if` (yield 0/1 or select one branch). It deliberately OMITS `*`
/// (blows values up) and value-reusing `let` (`let q = v; q + q` doubles) — the curated demos cover
/// `*`/`let`/`while`/calls/lists; this property stresses the arithmetic / comparison / if structure
/// three ways. Every generated program terminates to a value (no loops, no functions, no faults), so
/// the value arm always fires. SAFETY LEVER: it is `depth=3` (`prop_recursive`'s first argument, the
/// recursion-depth cap), not `desired_size` (the second argument), that bounds the worst case — a
/// future editor raising the leaf range (`0u64..8`) must keep the depth cap to preserve this bound.
fn arb_tm_safe_expr() -> impl Strategy<Value = String> {
    let leaf = (0u64..8).prop_map(|n| n.to_string());
    leaf.prop_recursive(3, 8, 3, |inner| {
        prop_oneof![
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} + {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} - {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("if {a} > {b} {{ 1 }} else {{ 0 }}")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("if {a} == {b} {{ 1 }} else {{ 0 }}")),
            (inner.clone(), inner.clone(), inner).prop_map(|(c, a, b)| format!("if {c} > 0 {{ {a} }} else {{ {b} }}")),
        ]
    })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 200, ..ProptestConfig::default() })]

    /// Random TM-safe first-order programs must agree three ways: a value that decodes equal on both
    /// λ and TM. (The generator produces no loops/functions/faults, so a shared cap/fault never arises
    /// here — a `HitCap`/`LowerError` would itself be a bug and trips the catch-all.)
    #[test]
    fn three_way_agrees_on_random_first_order_programs(src in arb_tm_safe_expr()) {
        let reference = run(&src);
        let (prog, ds) = parse(&src);
        prop_assume!(ds.is_empty()); // skip anything that does not parse/type-check
        let core = desugar(&prog.unwrap());
        let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
        let tm = run_tm(&core, &Unary, TM_DEFAULT_CAPS);
        match (reference, lambda, tm) {
            (Ok(rv), LambdaRun::Reduced(nf), TmRun::Ran { tapes }) => {
                prop_assert_eq!(decode(&nf, &rv), Some(rv.clone()));
                prop_assert_eq!(decode_tape(&tapes, &rv, &Unary), Some(rv));
            }
            (r, l, t) => prop_assert!(false, "three-way mismatch for {}:\n ref={:?}\n λ={:?}\n tm={:?}", src, r, l, t),
        }
    }
}
