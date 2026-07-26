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
use redextape_core::value::Value;
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
/// calls & recursion, list construction & access, (Plan 3b-1) higher-order programs that `run_tm`
/// now defunctionalizes before lowering (a function passed as a value, `map`/`fold`), and
/// MUTUALLY RECURSIVE / FORWARD-REFERENCING `fn`s (`Core::LetRecGroup`). Every value
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
    // MUTUAL RECURSION (Core::LetRecGroup): a program class that previously reached NO backend —
    // `typeck` rejected the forward reference, and `lower_asm` bound a name only before its own body.
    // Each member is observably DIFFERENT at every level (not merely in its base case), so a backend
    // that permuted the group's members would compute a plausible WRONG value rather than agree.
    // Measured cost (well inside both caps): λ 367 of 5,000,000 steps, TM 99,699 of 5,000,000.
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    // The ODD argument is not a duplicate: its answer comes out of the OTHER member's base case. A
    // backend that COLLAPSED the pair (both names resolving to `is_even`) still answers `true` at
    // every even argument, so the even case alone would agree with the reference under that mutant —
    // measured, not assumed; see `lambda/lower.rs`'s own group test. λ 502 steps, TM 120,899.
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(5)",
    // A FORWARD REFERENCE with no cycle: `a` is a one-member component that must still be emitted
    // INSIDE `b`, so this pins dependency order rather than grouping. λ 25 steps, TM 16,143.
    "fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)",
    // THREE members, not two — an n-ary bug that happens to work at n = 2 is the shape of defect this
    // codebase keeps finding. Each member contributes its own constant at its own level (1/2/4), so
    // the answer 1+2+4+1 = 8 identifies the exact rotation of the cycle; any rotation of the three
    // bodies gives a different number. λ 411 steps, TM 145,819.
    "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
     fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
     fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)",
    // A group that reaches the backends THROUGH `defunc`. Every case above lowers via `lower_asm`
    // directly, so `defunc`'s group handling — peeling a `LetRecGroup` and re-emitting it as one
    // ordered unit, the whole of Task 6 — was asserted only by unit tests stopping at the reference
    // and `run_asm`, never through λ, the TM, or native. `id` is used as a VALUE, which is what routes
    // the program through `defunc`; `ev`/`od` stay a genuine cycle inside it. The answer comes out of
    // whichever member's base case the parity reaches, so a collapsed or rotated group is caught.
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(4, id)",
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(3, id)",
    // A FORWARD reference through `defunc` (no cycle): `f` names `g` before `g` is defined, and `g`
    // is value-used, so the dependency ordering and the dispatcher interact.
    "fn ap(h,x){ h(x) } fn f(n){ ap(g, n) } fn g(n){ n + 1 } f(3)",
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
    // Plan 3b-2: a value-used closure captures a MUTABLE, observed by-reference. λ rejects
    // mutable-in-closure (`unbound` — it never binds the mutable into the closure body); the reference
    // (by-reference) and the boxed TM (defunc boxes the capture) agree at 10.
    "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)",
    // Plan 3b-2: an EFFECTFUL closure body (`c = c + 1`) that mutates its boxed capture on each call,
    // called twice via a higher-order `twice`. λ rejects with `StatefulClosure`; the reference and the
    // boxed TM both land on 2 (0 -> 1 -> 2).
    "let mut c = 0; fn twice(g) { g(0); g(0); } let bump = |x| { c = c + 1; c }; twice(bump); c",
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

// ============================================================================================
// Broadened property-based oracle (correctness hardening, 2026-07-23)
//
// `arb_tm_safe_expr` above randomizes ONLY arithmetic/comparison/if. These generators extend the
// oracle to the features that were previously covered by curated demos alone — the hardest, most
// bug-prone code: mutable capture (boxing, Plan 3b-2), higher-order (defunc, Plan 3b-1), lists +
// access, bounded recursion, and bounded imperative loops. Every operand is `< 8` and every
// generated value AND intermediate is provably `< FIELD_WIDTH` (64) — the only arithmetic is a
// small number of bounded `+`s (worst case ~17) plus monus/comparison, so the TM's fixed-width unary
// fields never overflow.
// Each generator carries a non-vacuity meta-test proving it actually reaches its target oracle bucket.
// ============================================================================================

/// Value three-way: reference == λ == TM, all reduced to a value that decodes equal. Shared by the
/// first-order and higher-order (defunctionalized) value generators. Returns a proptest result.
fn three_way_value(src: &str) -> Result<(), TestCaseError> {
    let reference = run(src);
    let (prog, ds) = parse(src);
    prop_assume!(ds.is_empty()); // skip anything that doesn't parse/type-check
    let core = desugar(&prog.unwrap());
    let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
    let tm = run_tm(&core, &Unary, TM_DEFAULT_CAPS);
    match (reference, lambda, tm) {
        (Ok(rv), LambdaRun::Reduced(nf), TmRun::Ran { tapes }) => {
            prop_assert_eq!(decode(&nf, &rv), Some(rv.clone()), "reference vs λ disagree: {}", src);
            prop_assert_eq!(decode_tape(&tapes, &rv, &Unary), Some(rv), "reference vs TM disagree: {}", src);
            Ok(())
        }
        (r, l, t) => {
            prop_assert!(false, "three-way mismatch for {}:\n ref={:?}\n λ={:?}\n tm={:?}", src, r, l, t);
            Ok(())
        }
    }
}

/// Two-way: the reference and the boxed TM agree on a value; λ REFUSES (mut-in-closure LowerError).
/// Shared by the mutable-capture generator. A defunc `Unsupported` (e.g. an accidental param/fn-name
/// collision) or a TM `HitCap` would trip the catch-all — so this also guards the boxing guard.
fn two_way_tm_only(src: &str) -> Result<(), TestCaseError> {
    let reference = run(src);
    let (prog, ds) = parse(src);
    prop_assume!(ds.is_empty());
    let core = desugar(&prog.unwrap());
    prop_assert!(
        matches!(run_lambda(&core, MAX_REDUCTION_STEPS), LambdaRun::LowerError(_)),
        "λ must refuse mut-in-closure: {}",
        src
    );
    match (reference, run_tm(&core, &Unary, TM_DEFAULT_CAPS)) {
        (Ok(rv), TmRun::Ran { tapes }) => {
            prop_assert_eq!(decode_tape(&tapes, &rv, &Unary), Some(rv), "reference vs TM disagree: {}", src);
            Ok(())
        }
        (r, t) => {
            prop_assert!(false, "two-way (tm-only) mismatch for {}:\n ref={:?}\n tm={:?}", src, r, t);
            Ok(())
        }
    }
}

/// PLAN 3b-2 mutable capture (the highest-ROI generator — the newest code). A value-USED closure
/// captures a MUTABLE `n`, which is reassigned AFTER the closure is built and observed by-reference.
/// λ rejects; reference == boxed TM. Operands `< 8` ⇒ `x + n < 16 < 64`. Three structural variants
/// stress box alloc/get/set over the value space (incl. the box_set grow/shrink quadrants).
fn arb_mutable_capture() -> impl Strategy<Value = String> {
    prop_oneof![
        // capture + reassign-after + read at call time: result = arg + later (by-reference, not init)
        (0u64..8, 0u64..8, 0u64..8).prop_map(|(init, later, arg)| format!(
            "let mut n = {init}; fn ap(g) {{ g({arg}) }} let f = |x| x + n; n = {later}; ap(f)"
        )),
        // closure ignores its arg and returns the captured mutable: result = later
        (0u64..8, 0u64..8, 0u64..8).prop_map(|(init, later, arg)| format!(
            "let mut n = {init}; fn ap(g) {{ g({arg}) }} let f = |x| n; n = {later}; ap(f)"
        )),
        // read-modify-write of the captured mutable through the box before the call
        (0u64..8, 0u64..4, 0u64..8).prop_map(|(init, bump, arg)| format!(
            "let mut n = {init}; fn ap(g) {{ g({arg}) }} let f = |x| x + n; n = n + {bump}; ap(f)"
        )),
    ]
}

proptest! {
    // Modest per-run counts: unary TM simulation of calls/loops/recursion is step-heavy (10^4–10^6
    // steps/case), so keep the suite fast; randomization accumulates across CI/repeated runs, and
    // proptest persists any failure to a regression seed. Override locally with PROPTEST_CASES.
    #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]

    /// Random mutable-capture programs: λ refuses, reference == boxed TM. Stresses the BOX tape +
    /// defunc boxing across the value space — the code that just needed three Critical fixes.
    #[test]
    fn mutable_capture_agrees_reference_and_tm(src in arb_mutable_capture()) {
        two_way_tm_only(&src)?;
    }
}

#[test]
fn arb_mutable_capture_is_non_vacuous() {
    // Boundary instantiations of every variant: each must parse clean, λ-reject, and reference==TM.
    // (Proves the generator reaches the two-way bucket, not silently skipped or mis-bucketed.)
    for src in [
        "let mut n = 0; fn ap(g) { g(0) } let f = |x| x + n; n = 7; ap(f)",
        "let mut n = 7; fn ap(g) { g(7) } let f = |x| x + n; n = 0; ap(f)",
        "let mut n = 3; fn ap(g) { g(5) } let f = |x| n; n = 6; ap(f)",
        "let mut n = 2; fn ap(g) { g(4) } let f = |x| x + n; n = n + 3; ap(f)",
    ] {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "non-vacuity: must type-check: {src}");
        let core = desugar(&prog.unwrap());
        assert!(
            matches!(run_lambda(&core, MAX_REDUCTION_STEPS), LambdaRun::LowerError(_)),
            "must be λ-rejected: {src}"
        );
        assert!(matches!(run_tm(&core, &Unary, TM_DEFAULT_CAPS), TmRun::Ran { .. }), "must run on TM (boxed): {src}");
        assert!(run(src).is_ok(), "reference must run: {src}");
    }
}

fn list_lit(elems: &[u64]) -> String {
    format!("[{}]", elems.iter().map(|e| e.to_string()).collect::<Vec<_>>().join(", "))
}

/// PLAN 3b-1 higher-order via `map`/`fold` (defunctionalized, three-way). The step-HEAVIEST generator
/// (list recursion on the unary TM), so tight bounds (≤ 2 elems) + few cases. Elems `< 7` so `add1`
/// stays `< 8`; folds of `≤ 2` elems `< 8` stay `< 16`.
fn arb_map_fold() -> impl Strategy<Value = String> {
    prop_oneof![
        prop::collection::vec(0u64..7, 1..3).prop_map(|elems| format!(
            "fn map(xs, f) {{ if is_empty(xs) {{ nil }} else {{ cons(f(head(xs)), map(tail(xs), f)) }} }} \
             fn add1(x) {{ x + 1 }} {}.map(add1)",
            list_lit(&elems)
        )),
        prop::collection::vec(0u64..8, 1..3).prop_map(|elems| format!(
            "fn fold(xs, acc, f) {{ if is_empty(xs) {{ acc }} else {{ fold(tail(xs), f(acc, head(xs)), f) }} }} \
             fn add(a, b) {{ a + b }} fold({}, 0, add)",
            list_lit(&elems)
        )),
    ]
}

/// PLAN 3b-1 immutable capture: an anonymous closure `|x| x + n` capturing an immutable `n`, passed as
/// a value (three-way via defunc). Cheap — no list recursion. `x + n < 16`.
fn arb_capturing_closure() -> impl Strategy<Value = String> {
    (0u64..8, 0u64..8).prop_map(|(n, arg)| format!("let n = {n}; fn ap(g) {{ g({arg}) }} ap(|x| x + n)"))
}

/// Bounded lists + safe access (three-way). A non-empty literal, `drops` tails kept in-bounds, then a
/// terminal `head`/`is_empty`/`tail` — no nil-access fault. Every value is an element `< 8`, a bool, or
/// a sublist.
fn arb_list() -> impl Strategy<Value = String> {
    (prop::collection::vec(0u64..8, 1..4), 0usize..3, 0u8..3).prop_map(|(elems, drops, op)| {
        let drops = drops.min(elems.len() - 1); // in-bounds: still non-empty after `drops` tails
        let mut xs = list_lit(&elems);
        for _ in 0..drops {
            xs = format!("tail({xs})");
        }
        match op {
            0 => format!("head({xs})"),
            1 => format!("is_empty({xs})"),
            _ => format!("tail({xs})"),
        }
    })
}

/// Bounded recursion (three-way). Only bounded-RESULT recursions: `cd` returns its arg (a counted
/// loop), `f` returns a constant regardless of depth, `g` sums 1 exactly `n` times. All `< 8`.
fn arb_recursion() -> impl Strategy<Value = String> {
    prop_oneof![
        (0u64..6).prop_map(|k| format!(
            "fn cd(n) {{ let mut acc = 0; while n > 0 {{ acc = acc + 1; n = n - 1; }} acc }} cd({k})"
        )),
        (0u64..6, 0u64..8).prop_map(|(k, c)| format!("fn f(n) {{ if n == 0 {{ {c} }} else {{ f(n - 1) }} }} f({k})")),
        (0u64..6).prop_map(|k| format!("fn g(n) {{ if n == 0 {{ 0 }} else {{ g(n - 1) + 1 }} }} g({k})")),
    ]
}

/// Bounded imperative programs (three-way): single-use `let`, a `let mut` reassignment chain, and a
/// counted `while` loop. Provably bounded: max value `< 15` across all three templates.
fn arb_imperative() -> impl Strategy<Value = String> {
    prop_oneof![
        (0u64..8, 0u64..8, 0u64..8)
            .prop_map(|(a, b, c)| format!("let x = {a} + {b}; if x > {c} {{ x }} else {{ {c} }}")),
        (0u64..8, 0u64..8, 0u64..8)
            .prop_map(|(a, b, c)| format!("let mut m = {a}; m = m + {b}; m = if m > {c} {{ m }} else {{ {c} }}; m")),
        (1u64..6, 0u64..2).prop_map(|(k, incr)| format!(
            "let mut acc = 0; let mut n = {k}; while n > 0 {{ acc = acc + {incr}; n = n - 1; }} acc"
        )),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 8, ..ProptestConfig::default() })]

    /// map/fold (defunctionalized, three-way) — the HEAVIEST generator (list recursion on the unary
    /// TM is ~10^5–10^6 steps/case), so the fewest cases. Crank via PROPTEST_CASES for deep runs.
    #[test]
    fn map_fold_agrees_three_ways(src in arb_map_fold()) {
        three_way_value(&src)?;
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]

    /// Immutable-capturing closure (defunc, three-way) — cheap (no list recursion).
    #[test]
    fn capturing_closure_agrees_three_ways(src in arb_capturing_closure()) {
        three_way_value(&src)?;
    }

    /// Lists + safe access — cheap (a few thousand TM steps).
    #[test]
    fn lists_agree_three_ways(src in arb_list()) {
        three_way_value(&src)?;
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 12, ..ProptestConfig::default() })]

    /// Bounded recursion — step-heavy (nested STACK frames / counted loops on the unary TM).
    #[test]
    fn bounded_recursion_agrees_three_ways(src in arb_recursion()) {
        three_way_value(&src)?;
    }

    /// Bounded imperative (let / let-mut / counted while) — moderate step cost.
    #[test]
    fn bounded_imperative_agrees_three_ways(src in arb_imperative()) {
        three_way_value(&src)?;
    }
}

#[test]
fn broadened_generators_are_non_vacuous() {
    // Boundary instantiations of every value generator must be genuinely three-way (parse-clean, all
    // three reduce to an equal value). `assert_three_way` panics otherwise — proving these reach the
    // value bucket rather than being skipped or landing in Unsupported/HitCap.
    // NOTE: keep these SMALL. This meta-test runs each program end-to-end on ALL THREE backends at
    // full caps, and large recursive/higher-order/loop programs are expensive to simulate (the unary
    // TM especially). Small instances prove each generator SHAPE is genuinely three-way at low cost;
    // the proptests above (with their tight generator bounds) provide the randomized coverage.
    for src in [
        // higher-order
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [2, 0].map(add1)",
        "fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } } fn add(a, b) { a + b } fold([3, 2], 0, add)",
        "let n = 3; fn ap(g) { g(4) } ap(|x| x + n)",
        // lists
        "head([5, 1, 2])",
        "is_empty(tail([9]))",
        "tail(tail([9, 8]))",
        // recursion
        "fn cd(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } cd(3)",
        "fn g(n) { if n == 0 { 0 } else { g(n - 1) + 1 } } g(3)",
        // imperative
        "let x = 3 + 4; if x > 3 { x } else { 3 }",
        "let mut acc = 0; let mut n = 3; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    ] {
        assert_three_way(src); // panics if not reference == λ == TM on a value
    }
}

// ============================================================================================
// Metamorphic / algebraic laws (correctness hardening #2)
//
// The differential oracle catches BACKEND DISAGREEMENT. It cannot catch a bug in the SHARED front-end
// (`desugar`) or in the reference itself: all three backends would faithfully compute the same WRONG
// value and "agree." These tests assert MATHEMATICAL LAWS any correct implementation must satisfy — two
// structurally-different programs that must compute the same value — checked on the reference AND the
// TM. A law violation is a real bug REGARDLESS of backend agreement, so this is complementary to (not
// subsumed by) the differential oracle above. All operands bounded so every value is `< FIELD_WIDTH`.
// ============================================================================================

/// Run `src` on the TM and decode against its reference value; `None` if the reference faults, the
/// program doesn't lower/halt, or decode fails.
fn tm_val(src: &str) -> Option<Value> {
    let expected = run(src).ok()?;
    let (prog, ds) = parse(src);
    if !ds.is_empty() {
        return None;
    }
    let core = desugar(&prog.unwrap());
    match run_tm(&core, &Unary, TM_DEFAULT_CAPS) {
        TmRun::Ran { tapes } => decode_tape(&tapes, &expected, &Unary),
        _ => None,
    }
}

/// A metamorphic law: `lhs` and `rhs` must compute the SAME value — checked on the reference
/// (`reference(lhs) == reference(rhs)`: the front-end + reference respect the law) AND on the TM (which
/// must agree with the reference on each side, so the law holds through the whole TM pipeline too).
fn assert_equiv(lhs: &str, rhs: &str) -> Result<(), TestCaseError> {
    let (rl, rr) = (run(lhs), run(rhs));
    // Defensive: skip an ill-typed side (the law generators emit only well-typed programs, so this
    // never fires here — it just keeps a future law from silently comparing two Static errors).
    prop_assume!(!matches!(rl, Err(RunError::Static(_))) && !matches!(rr, Err(RunError::Static(_))));
    match (&rl, &rr) {
        (Ok(vl), Ok(vr)) => {
            prop_assert_eq!(vl, vr, "law violated on the reference:\n  {} = {:?}\n  {} = {:?}", lhs, vl, rhs, vr);
            let (tl, tr) = (tm_val(lhs), tm_val(rhs));
            prop_assert_eq!(tl.as_ref(), Some(vl), "TM violates the law (lhs): {}", lhs);
            prop_assert_eq!(tr.as_ref(), Some(vr), "TM violates the law (rhs): {}", rhs);
        }
        // A metamorphic law here is between two VALUE-producing programs; any fault (or a one-sided
        // fault) is a law violation or a generator bug, so fail rather than silently accept it.
        (l, r) => prop_assert!(
            false,
            "law program(s) unexpectedly faulted or disagreed:\n  {} = {:?}\n  {} = {:?}",
            lhs,
            l,
            rhs,
            r
        ),
    }
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, ..ProptestConfig::default() })]

    /// Arithmetic laws — commutativity/associativity/identities/monus. Operands `< 8`; `(a+b)+c < 24`.
    #[test]
    fn arithmetic_laws(a in 0u64..8, b in 0u64..8, c in 0u64..5) {
        assert_equiv(&format!("{a} + {b}"), &format!("{b} + {a}"))?;
        assert_equiv(&format!("{a} * {b}"), &format!("{b} * {a}"))?;
        assert_equiv(&format!("({a} + {b}) + {c}"), &format!("{a} + ({b} + {c})"))?;
        assert_equiv(&format!("{a} + 0"), &format!("{a}"))?;
        assert_equiv(&format!("{a} * 1"), &format!("{a}"))?;
        assert_equiv(&format!("{a} * 0"), "0")?;
        assert_equiv(&format!("{a} - {a}"), "0")?;
        assert_equiv(&format!("{a} - 0"), &format!("{a}"))?;
    }

    /// Distributivity — tighter bound so `a * (b + c) < 64`.
    #[test]
    fn distributivity(a in 0u64..4, b in 0u64..4, c in 0u64..4) {
        assert_equiv(&format!("{a} * ({b} + {c})"), &format!("{a} * {b} + {a} * {c}"))?;
    }

    /// Monus saturation: `a <= b ⟹ a - b == 0`.
    #[test]
    fn monus_saturates(a in 0u64..8, d in 0u64..8) {
        let b = a + d; // b >= a, both < 16
        assert_equiv(&format!("{a} - {b}"), "0")?;
    }

    /// Conditional laws: `a == a` is always true; equal branches collapse.
    #[test]
    fn if_laws(a in 0u64..8, b in 0u64..8, c in 0u64..8) {
        assert_equiv(&format!("if {a} == {a} {{ {b} }} else {{ {c} }}"), &format!("{b}"))?;
        assert_equiv(&format!("if {a} > {b} {{ {c} }} else {{ {c} }}"), &format!("{c}"))?;
    }

    /// List laws: cons/head/tail/is_empty round-trips.
    #[test]
    fn list_laws(a in 0u64..8, b in 0u64..8) {
        assert_equiv(&format!("head(cons({a}, nil))"), &format!("{a}"))?;
        assert_equiv(&format!("head(cons({a}, cons({b}, nil)))"), &format!("{a}"))?;
        assert_equiv(&format!("tail(cons({a}, cons({b}, nil)))"), &format!("cons({b}, nil)"))?;
        assert_equiv(&format!("is_empty(cons({a}, nil))"), "false")?;
        assert_equiv("is_empty(nil)", "true")?;
        assert_equiv(&format!("head([{a}, {b}])"), &format!("{a}"))?;
        assert_equiv(&format!("head(tail([{a}, {b}]))"), &format!("{b}"))?;
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 12, ..ProptestConfig::default() })]

    /// Higher-order law (step-heavy, so few cases): `head(map(add1, [a, b])) == a + 1`. Elem `< 7`.
    #[test]
    fn map_head_law(a in 0u64..7, b in 0u64..7) {
        let mapdef = "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 }";
        assert_equiv(&format!("{mapdef} head([{a}, {b}].map(add1))"), &format!("{a} + 1"))?;
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, ..ProptestConfig::default() })]

    /// Mutation / store laws (imperative): read-after-bind, last-write-wins, accumulation. All `< 16`.
    #[test]
    fn mutation_laws(a in 0u64..8, b in 0u64..8, c in 0u64..8) {
        assert_equiv(&format!("let mut x = {a}; x"), &format!("{a}"))?;
        assert_equiv(&format!("let mut x = {a}; x = {b}; x"), &format!("{b}"))?;
        assert_equiv(&format!("let mut x = {a}; x = {b}; x = {c}; x"), &format!("{c}"))?;
        assert_equiv(&format!("let mut x = {a}; x = x + {b}; x"), &format!("{a} + {b}"))?;
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 16, ..ProptestConfig::default() })]

    /// Closure / β laws (value-used lambdas, defunctionalized on the TM): identity, const, β-reduction,
    /// and immutable capture. `x + n < 16`.
    #[test]
    fn closure_laws(a in 0u64..8, b in 0u64..8) {
        assert_equiv(&format!("fn ap(g) {{ g({a}) }} ap(|x| x)"), &format!("{a}"))?;
        assert_equiv(&format!("fn ap(g) {{ g({a}) }} ap(|x| {b})"), &format!("{b}"))?;
        assert_equiv(&format!("fn ap(g) {{ g({a}) }} ap(|x| x + {b})"), &format!("{a} + {b}"))?;
        assert_equiv(&format!("let n = {b}; fn ap(g) {{ g({a}) }} ap(|x| x + n)"), &format!("{a} + {b}"))?;
    }
}

#[test]
fn metamorphic_laws_are_non_vacuous() {
    // Each law family, instantiated once, must genuinely hold (reference AND TM). A silent regression
    // in any law would panic here even if the proptest happened not to sample the breaking input.
    for (lhs, rhs) in [
        ("3 + 5", "5 + 3"),
        ("2 * 3", "3 * 2"),
        ("7 - 7", "0"),
        ("4 - 6", "0"),
        ("if 3 == 3 { 5 } else { 9 }", "5"),
        ("head(cons(6, nil))", "6"),
        ("tail(cons(6, cons(2, nil)))", "cons(2, nil)"),
        ("is_empty(cons(1, nil))", "false"),
        ("head([4, 2])", "4"),
        ("let mut x = 3; x = 5; x", "5"),
        ("let mut x = 3; x = x + 4; x", "7"),
        ("fn ap(g) { g(6) } ap(|x| x + 2)", "8"),
        ("let n = 4; fn ap(g) { g(6) } ap(|x| x + n)", "10"),
    ] {
        assert_equiv(lhs, rhs).unwrap_or_else(|e| panic!("law must hold: {lhs} == {rhs}: {e:?}"));
    }
}

/// Programs that fault at runtime via nil-access. All three backends reach the shared "no value"
/// outcome: reference `Runtime`, λ head/tail-of-nil is Ω (`HitCap`), TM deref-spins (`HitCap`).
fn arb_faulting() -> impl Strategy<Value = String> {
    (0u64..8, 0u8..5).prop_map(|(a, which)| match which {
        0 => "head(nil)".to_string(),
        1 => "tail(nil)".to_string(),
        2 => format!("head(tail([{a}]))"), // tail of a singleton is nil; head → fault
        3 => format!("tail(tail([{a}]))"), // tail of a singleton is nil; tail → fault
        _ => format!("head(tail(tail([{a}, {a}])))"), // two tails of a 2-list is nil; head → fault
    })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 40, ..ProptestConfig::default() })]

    /// Random nil-access faults must diverge on ALL THREE backends (small caps keep it fast).
    #[test]
    fn random_faults_diverge_three_ways(src in arb_faulting()) {
        let reference = run(&src);
        let (prog, ds) = parse(&src);
        prop_assume!(ds.is_empty());
        let core = desugar(&prog.unwrap());
        let lambda = run_lambda(&core, 20_000);
        let tm = run_tm(&core, &Unary, TmCaps { steps: 20_000, cells: 20_000 });
        match (reference, lambda, tm) {
            (Err(RunError::Runtime(_)), LambdaRun::HitCap, TmRun::HitCap) => {}
            (r, l, t) => prop_assert!(false, "expected all three to diverge on {}:\n ref={:?}\n λ={:?}\n tm={:?}", src, r, l, t),
        }
    }
}
