#![cfg(feature = "cranelift")]
//! The four-way oracle (Task 6, native backend v1): for every first-order demo, the reference
//! tree-walker's value, the decoded λ normal form, the decoded TM final tape, AND the decoded native
//! (Cranelift JIT) result all agree — `reference == λ == TM == native`. This extends
//! `redextape-core`'s three-way oracle (`tests/three_way_oracle.rs`) with native as a validated
//! fourth leg.
//!
//! Native's PRIMARY new cross-check is narrower and sharper than the four-way: `native == asm-interp`
//! on the SAME lowered `Program` isolates codegen (`run_native`/Cranelift) from interpretation
//! (`run_asm`) — both share `lower_asm`/`defunc`, so any disagreement is a real codegen bug, not a
//! front-end or lowering difference.
//!
//! Native's DISTINCTIVE capability is having no `MAX_FIELD_WIDTH` (64) ceiling: it compiles to real 64-bit
//! machine registers, unlike the TM's fixed-width unary tape. `native_runs_beyond_field_width` checks
//! `native == reference` on values the TM literally cannot represent — the TM leg is intentionally
//! absent there.
//!
//! CAPS NOTE (Task 4/5 review): native's step accounting is coarse (it only ticks loop back-edges and
//! calls, enough to guarantee termination, not to match `run_asm`'s per-instruction step count). Every
//! program here uses `DEFAULT_CAPS`/`TM_DEFAULT_CAPS` (generous) and terminates well within them, so a
//! tight cap never produces a spurious cross-backend "disagreement".

use proptest::prelude::*;
use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::lambda::{LambdaRun, MAX_REDUCTION_STEPS, decode, run_lambda};
use redextape_core::parser::parse;
use redextape_core::tm::{
    AsmRun, DEFAULT_CAPS, LowerError, Program, TM_DEFAULT_CAPS, TmRun, Unary, decode_asm, decode_tape, defunc,
    lower_asm, run_asm, run_tm,
};
use redextape_core::{RunError, run};
use redextape_native::{NativeRun, run_native};

/// Parse + desugar `src` to Core, panicking on a parse error (every demo string here is known-good).
fn core_of(src: &str) -> Core {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for `{src}`: {ds:?}");
    desugar(&prog.unwrap())
}

/// Mirrors `redextape_core::tm`'s own (private) `lower_program` template exactly: try `lower_asm`
/// first (first-order Core unchanged); only retry through `defunc` when it rejects the program as
/// higher-order (`LowerError::Unsupported`). `run_native` uses this same template internally
/// (it is not exported, so this is a deliberate, documented duplicate) — see this crate's `lib.rs`.
fn lower_program(core: &Core) -> Result<Program, LowerError> {
    match lower_asm(core) {
        Ok(p) => return Ok(p),
        Err(LowerError::Unsupported { .. }) => {}
        Err(e @ LowerError::TooDeep { .. }) => return Err(e),
    }
    let defunced = defunc(core)?;
    lower_asm(&defunced)
}

/// reference == λ == TM == native, guided by the reference value's type. All four must run to a value
/// that decodes equal.
fn assert_four_way(src: &str) {
    let reference = run(src).unwrap_or_else(|e| panic!("reference run failed for `{src}`: {e:?}"));
    let core = core_of(src);
    let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
    let tm = run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS);
    let native = run_native(&core, DEFAULT_CAPS);
    match (lambda, tm, native) {
        (LambdaRun::Reduced(nf), TmRun::Ran { tapes }, NativeRun::Ran(outcome)) => {
            assert_eq!(decode(&nf, &reference), Some(reference.clone()), "reference vs λ disagree for: {src}");
            assert_eq!(
                decode_tape(&tapes, &reference, &Unary::default()),
                Some(reference.clone()),
                "reference vs TM disagree for: {src}"
            );
            assert_eq!(
                decode_asm(&outcome, &reference),
                Some(reference.clone()),
                "reference vs native disagree for: {src}"
            );
        }
        (l, t, n) => {
            panic!(
                "four-way oracle mismatch for {src}:\n  reference={reference:?}\n  lambda={l:?}\n  tm={t:?}\n  native={n:?}"
            )
        }
    }
}

/// Native's primary new cross-check: `run_native` and `run_asm` on the SAME lowered `Program` decode
/// to the same `Value`. Since both share `lower_asm`/`defunc`, this isolates codegen (compile) from
/// interpretation.
fn assert_native_matches_asm(src: &str) {
    let reference = run(src).unwrap_or_else(|e| panic!("reference run failed for `{src}`: {e:?}"));
    let core = core_of(src);
    let prog = lower_program(&core).unwrap_or_else(|e| panic!("lowering failed for `{src}`: {e:?}"));
    let asm = run_asm(&prog, DEFAULT_CAPS);
    let native = run_native(&core, DEFAULT_CAPS);
    match (asm, native) {
        (AsmRun::Ran(asm_outcome), NativeRun::Ran(native_outcome)) => {
            let asm_val = decode_asm(&asm_outcome, &reference);
            assert_eq!(asm_val, Some(reference.clone()), "asm-interp vs reference disagree for: {src}");
            let native_val = decode_asm(&native_outcome, &reference);
            assert_eq!(native_val, asm_val, "native vs asm-interp disagree for: {src}");
        }
        (a, n) => panic!("native vs asm-interp mismatch for {src}:\n  asm={a:?}\n  native={n:?}"),
    }
}

/// native == reference only (no TM leg — the TM's fixed-width unary tape cannot represent these
/// values). Native's distinctive capability: real 64-bit registers, no `MAX_FIELD_WIDTH` (64) ceiling.
fn assert_native_matches_reference(src: &str) {
    let reference = run(src).unwrap_or_else(|e| panic!("reference run failed for `{src}`: {e:?}"));
    let core = core_of(src);
    match run_native(&core, DEFAULT_CAPS) {
        NativeRun::Ran(outcome) => {
            assert_eq!(
                decode_asm(&outcome, &reference),
                Some(reference.clone()),
                "native vs reference disagree for: {src}"
            );
        }
        other => panic!("native did not run `{src}`: {other:?}"),
    }
}

/// The first-order demo suite (a subset of `redextape-core`'s `three_way_oracle.rs`
/// `FIRST_ORDER_DEMOS`) — arithmetic, monus, comparison, if, let/let-mut/assign/while, calls &
/// recursion, list construction & access, higher-order programs (`defunc`), and mutually recursive /
/// forward-referencing `fn`s (`Core::LetRecGroup`) — every value stays « MAX_FIELD_WIDTH (64) so the TM
/// leg can participate too.
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
    // Higher-order: a function received as a value, defunctionalized before lowering.
    "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    // Higher-order with immutable capture: `|x| x + n` captures `n` by value.
    "let n = 5; fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } [1, 2, 3].map(|x| x + n)",
    "\
        fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
        fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
        fn add(a, b) { a + b }\n\
        fn add1(x) { x + 1 }\n\
        fold([3, 1, 2].map(add1), 0, add)",
    // Higher-order currying: a value-lambda whose body is ANOTHER value-lambda.
    "fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)",
    // MUTUAL RECURSION (`Core::LetRecGroup`) — the same three programs `redextape-core`'s
    // `three_way_oracle.rs` adds, carried here so the design spec's `reference == λ == TM == native`
    // claim is ASSERTED on this class rather than assumed from the three-way leg. Each member is
    // observably different at every level, so a permuted group computes a wrong value, not a crash.
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    // The ODD argument is not a duplicate: its answer comes out of the OTHER member's base case, so a
    // backend that collapsed the pair onto `is_even` (which still answers `true` at every even
    // argument) is caught here and not by the even case.
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(5)",
    // A forward reference with no cycle: `a` is a one-member component still emitted INSIDE `b`.
    "fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)",
    // Three members, not two: 1+2+4+1 = 8 identifies the exact rotation of the cycle.
    "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
     fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
     fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)",
    // A group reaching the backends THROUGH `defunc` (`id` is used as a value), and a forward
    // reference doing the same — the paths every case above skips, since they lower via `lower_asm`
    // directly. See the matching comment in `three_way_oracle.rs`.
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(4, id)",
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(3, id)",
    "fn ap(h,x){ h(x) } fn f(n){ ap(g, n) } fn g(n){ n + 1 } f(3)",
    // A fn both CALLED BY NAME and USED AS A VALUE. Previously `Unsupported` on TM and native while
    // the reference and λ accepted it — an oracle asymmetry this class now closes.
    // Non-commutative at arity 2, so a forwarder with swapped arguments cannot pass: 5 + 7 = 12.
    "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)",
    // RECURSIVE and value-used — the case the restriction actually blocked, and the reason the class
    // is large: `analyze` counts a self-call as `name_called`, so every recursive fn used as a value
    // was BOTH. 10 + 3 = 13.
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } fn ap(g, x) { g(x) } ap(sum, 4) + sum(2)",
    // `map` itself passed as a value while ALSO being called by name. Its body dispatches at arity 1
    // and it is value-used at arity 2, so the two dispatchers are distinct. `map` calls itself by
    // name, so the plain call graph has a cycle through `map` -- the interesting claim is about the
    // DISPATCHER graph instead: `$apply2 -> map -> $apply1 -> add1` has no cycle through dispatchers.
    // 2 + 6 = 8.
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
     fn add1(x) { x + 1 }\n\
     fn ap2(g, a, b) { g(a, b) }\n\
     head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))",
    // A forwarding arm (BOTH: `b`, called by name AND used as a value) SHARING one dispatcher with a
    // normal arm (value-only: `v`), at BOTH possible tag positions. Every BOTH demo above has its
    // forwarder as the SOLE arm of its `$applyN`, so a per-arm parameter-binding defect -- the
    // forwarder must bind NO params so `$a_i` reaches the call directly, while a normal arm must bind
    // its own -- would compile and pass unnoticed. Tags are assigned in declaration order per arity:
    // in the first program below `v` is tag 0 (normal arm) and `b` is tag 1 (forwarder); in the
    // second, the two `fn`s are declared in the opposite order, so `b` is tag 0 (forwarder) and `v`
    // is tag 1 (normal arm) -- confirmed by dumping the lowered asm, not assumed. `v` (x*10) and `b`
    // (x+1) are value-distinguishable, so a tag mix-up or a mis-bound param changes the answer rather
    // than staying silent: 10 + 2 + 6 = 18.
    "fn v(x) { x * 10 } fn b(x) { x + 1 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)",
    "fn b(x) { x + 1 } fn v(x) { x * 10 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)",
    // A user `fn` shadowing a list builtin. `defunc` synthesizes `$head($clos)` for its dispatcher
    // tag test, and `lower_asm` resolves a bound function BEFORE the builtin table — so with the
    // bare name this silently miscompiled (measured at 3246742: reference 5, λ 5, TM 3). The `$`
    // form is unforgeable in user source, so scaffolding is uncapturable. 2 + 3 = 5.
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } head(1) + ap(add1, 2)",
    // The same shadowing where the shadowing function is ALSO the value being dispatched. 2 + 3 = 5.
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } head(1) + ap(head, 2)",
    // A user `fn tail` shadowing the builtin — but unlike the `head` pair above, a `tail`-shaped
    // twin of THAT demo (`fn tail(x){x+1} fn ap(g,x){g(x)} tail(1)+ap(tail,2)`) is VACUOUS: `$head`
    // is called unconditionally by every dispatcher (the tag test), but `$tail` is only called by
    // `tail1()` to unpack a dispatcher arm's CAPTURED env, and that program's closures capture
    // nothing, so `tail1()` is never invoked and the demo could not detect a reverted `$tail`->`tail`
    // regression (found when this class was surveyed for Task 2). Here `tail` is BOTH called by name
    // (`tail(3)`) and used as a value (`ap(tail, 2)`), so it is KEPT — a real top-level `tail` binder
    // exists for scaffolding to collide with — and the sibling value-lambda `|y| y + n` at the SAME
    // arity captures `n`, forcing its dispatcher arm to call `tail1()` to unpack `$env`. Confirmed
    // non-vacuous by sabotage (reverting `tail1`'s emitted name to the bare `"tail"`): the TM diverges
    // (`HitCap`) while reference and λ still agree. 4 + 3 + 12 = 19.
    "let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n, 5)",
    // `nil` is the FOURTH synthesized scaffolding name (the closed-function-value closure's env, the
    // dispatcher's fault sentinel, the env-list terminator), and `rewrite_value_name`'s bare-`"nil"`
    // check used to short-circuit BEFORE its `tags` check — so a user `fn nil`, itself USED AS A
    // VALUE, compiled to the empty list instead of `cons(tag, $nil)`, and the dispatcher's
    // `$head($clos)` tag test then faulted on it. `nil` is not a keyword in this language (see
    // `prelude.rs`'s module doc), so a user `fn nil` SHADOWS the empty list exactly as the reference
    // interpreter's frame lookup does — confirmed against the reference, which evaluates this to 5.
    // Confirmed non-vacuous by sabotage (restoring the old check order): the TM diverges (`HitCap`)
    // and native/asm fault — see `three_way_oracle.rs`'s matching comment for the measured failure
    // this reorder closes.
    "fn nil(x) { x + 5 } fn ap(g, x) { g(x) } ap(nil, 0)",
    // A user `fn nil` called by name ONLY (never itself used as a value) sharing a program with an
    // unrelated CLOSED function-value (`add1`, passed to `ap`). Before the `$nil` alias, `add1`'s
    // closed closure was built as `cons(tag, nil)` — a bare `nil` that `lower_asm`'s
    // `reject_fn_value` then flagged as a value-use of the user's KEPT `fn nil`, rejecting the whole
    // program on every lowering backend even though `nil` itself is never value-used anywhere.
    // Confirmed non-vacuous by sabotage (reverting `$nil` at that one synthesis site): all three
    // lowering backends `Unsupported { "\`nil\` used as a value" }`, while reference and λ still
    // agree at 5. 2 + 3 = 5.
    "fn nil(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } nil(1) + ap(add1, 2)",
    // A user `fn cons` shadowing the list builtin — the `cons`-shaped twin of the `head`/`tail` pair
    // above, closing the one member a review found missing (reverting the `cons` helper to its bare
    // name left both oracle suites green). `defunc` builds every closure as `$cons(tag, env)`, so a
    // bare `cons` here would let this user function capture the closure representation itself —
    // `add1`'s closed closure would become `(tag + env)` (the user's `cons` computes `a + b`, not a
    // pair), and the dispatcher's `$head($clos)` tag test then reads that number as a list. Confirmed
    // non-vacuous by sabotage (reverting the `cons` helper's `"$cons"` to the bare `"cons"`):
    // reference/λ still agree at 10, the TM diverges (`HitCap`), and native faults
    // (`Fault("head of empty list")`). 3 + 7 = 10.
    "fn cons(a, b) { a + b } fn ap2(g, a, b) { g(a, b) } cons(1, 2) + ap2(cons, 3, 4)",
];

/// Programs that only TM/native can run three-way with the reference — the λ backend v1 REJECTS them
/// (`LowerError`) since they involve mutable-in-closure capture or a `fn` inside a mutation region.
/// Since native shares `lower_asm`/`defunc` with the TM, these still exercise `native == asm-interp`
/// (the boxing/mutable-capture codegen path), just without the λ leg.
const LAMBDA_LIMITATION_DEMOS: &[&str] = &[
    "let mut x = 1; x = x + 1; let x = x + 10; x",
    "let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc",
    "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)",
    "let mut c = 0; fn twice(g) { g(0); g(0); } let bump = |x| { c = c + 1; c }; twice(bump); c",
];

/// Values that exceed `MAX_FIELD_WIDTH` (64) — the TM's unary tape cannot represent them. Native compiles
/// to real 64-bit registers, so it has no such ceiling; this is native's distinctive leg.
const BEYOND_FIELD_WIDTH_DEMOS: &[&str] = &[
    "100 * 100",
    "let n = 500; n + n",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(100)",
    "[100, 200, 300]",
];

/// Runtime-faulting programs: the reference faults (`RunError::Runtime`) and native reports a
/// `NativeRun::Fault` — the shared "no value, but not a crash and not a cap" outcome.
const FAULT_DEMOS: &[&str] = &["head(nil)", "tail(nil)"];

#[test]
fn four_way_oracle_on_the_first_order_suite() {
    for src in FIRST_ORDER_DEMOS {
        assert_four_way(src);
    }
}

#[test]
fn native_matches_asm_interp_on_the_first_order_suite() {
    for src in FIRST_ORDER_DEMOS {
        assert_native_matches_asm(src);
    }
}

#[test]
fn native_matches_asm_interp_on_lambda_limitation_demos() {
    // λ refuses these; native (sharing `lower_asm`/`defunc` with the TM) still runs them and must
    // agree with the asm interpreter — this is the mutable-capture / boxing codegen path.
    for src in LAMBDA_LIMITATION_DEMOS {
        assert_native_matches_asm(src);
    }
}

#[test]
fn native_runs_beyond_field_width() {
    for src in BEYOND_FIELD_WIDTH_DEMOS {
        assert_native_matches_reference(src);
    }
}

/// The TM's half of what `BEYOND_FIELD_WIDTH_DEMOS` claims — which until the overflow guard existed was
/// only a comment, because the TM leg could not be run on these at all: it would have corrupted its
/// register bank and handed back a WRONG answer rather than refusing. Now the ceiling is an outcome the
/// caller can see, so "native has no such ceiling" is a contrast between two measured results instead of
/// a measured result and an assertion in prose.
#[test]
fn the_tm_reports_its_ceiling_on_the_same_demos() {
    for src in BEYOND_FIELD_WIDTH_DEMOS {
        let core = core_of(src);
        assert!(
            matches!(run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS), TmRun::Overflow),
            "the TM must REPORT that it cannot represent this, not miscompile it: {src}"
        );
    }
}

#[test]
fn faults_diverge_on_native() {
    for src in FAULT_DEMOS {
        let reference = run(src);
        let core = core_of(src);
        match (reference, run_native(&core, DEFAULT_CAPS)) {
            (Err(RunError::Runtime(_)), NativeRun::Fault(_)) => {}
            (r, n) => panic!("expected reference Runtime + native Fault for {src}:\n  reference={r:?}\n  native={n:?}"),
        }
    }
}

/// A first-order expression generator whose value stays `< 8`-leaf-rooted arithmetic/comparison/if,
/// reused (shape) from `redextape-core`'s `arb_tm_safe_expr` in `three_way_oracle.rs`. Unlike that
/// generator native has NO `MAX_FIELD_WIDTH` bound, so leaves are widened to `0..1000` — native compiles
/// to real 64-bit registers and never needs to stay under 64.
fn arb_native_safe_expr() -> impl Strategy<Value = String> {
    let leaf = (0u64..1000).prop_map(|n| n.to_string());
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
    #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]

    /// Random wide-range (no `MAX_FIELD_WIDTH` bound) arithmetic/comparison/if programs: `native ==
    /// reference` AND `native == asm-interp`. The generator produces no loops/functions/faults, so a
    /// `HitCap`/`LowerError`/`Fault` would itself be a bug and trips the catch-all.
    #[test]
    fn native_agrees_with_reference_and_asm_on_random_programs(src in arb_native_safe_expr()) {
        let reference = run(&src);
        let (prog, ds) = parse(&src);
        prop_assume!(ds.is_empty()); // skip anything that does not parse/type-check
        let core = desugar(&prog.unwrap());
        let native = run_native(&core, DEFAULT_CAPS);
        match (reference, native) {
            (Ok(rv), NativeRun::Ran(outcome)) => {
                prop_assert_eq!(decode_asm(&outcome, &rv), Some(rv.clone()), "native vs reference disagree: {}", src);
                let lowered = lower_program(&core).expect("first-order arithmetic/if must lower to asm");
                match run_asm(&lowered, DEFAULT_CAPS) {
                    AsmRun::Ran(asm_outcome) => {
                        prop_assert_eq!(decode_asm(&asm_outcome, &rv), Some(rv), "native vs asm-interp disagree: {}", src);
                    }
                    other => prop_assert!(false, "asm-interp did not run {}: {:?}", src, other),
                }
            }
            (r, n) => prop_assert!(false, "native mismatch for {}:\n  reference={:?}\n  native={:?}", src, r, n),
        }
    }
}
