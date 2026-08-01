//! The backend oracle (spec §12.1) — FOUR-WAY as of Task 14: for every first-order demo, the reference
//! tree-walker's value, the decoded λ normal form, and the decoded TM final tape — compiled and
//! simulated under BOTH `Unary` and `Binary` — all agree: reference == λ == unary-TM == binary-TM. The
//! two TM legs are DIFFERENT MACHINES compiled from the same Core (a different encoding lowers to a
//! genuinely different bank layout and gadget set), not the same machine read two ways -- which is what
//! makes this a real fourth leg rather than a restatement of the third. Runtime faults are the shared
//! "no value" outcome (reference Runtime, λ HitCap, both TM legs HitCap). Higher-order programs
//! (map/fold, a function-valued argument) are four-way too, as of Plan 3b-1 for the TM legs: `run_tm`
//! defunctionalizes -- rewrites higher-order Core into the first-order subset `lower_asm` already
//! handles -- before lowering, so they run on the TM like everything else, under either encoding. The
//! dual case is the λ-refuses side (`LAMBDA_LIMITATION_DEMOS`/`assert_tm_only`): Plan-2 latent traps
//! that λ v1 REJECTS (`LowerError`) while the reference and both first-order TM legs run them to a
//! value. The per-category oracles (tm_oracle.rs's reference==TM / asm-interp==TM, lambda_oracle.rs's
//! reference==λ) stay for localization; this file is the unified capstone.
//!
//! This file keeps the name `three_way_oracle.rs` even though the oracle it drives is now four-way:
//! renaming it would break `first_order_demos_stay_synced_across_all_five_copies`'s path-based
//! extraction of `FIRST_ORDER_DEMOS` (by `CARGO_MANIFEST_DIR`-relative path, not by module name) for no
//! gain, so the filename/doc mismatch is a deliberate decision, not an oversight.
//!
//! DECODE IS STRUCTURAL AT EVERY WIDTH, UNDER BOTH ENCODINGS. A `Binary` instantiated at any width reads
//! a tape laid out at any other (`binary.rs`, "Reading a tape back"); `tm.rs`'s
//! `a_tape_decodes_the_same_at_every_reader_width` pins exactly that. So `run_tm` paired with a default
//! instance would work here too, and NOTHING below depends on the fitted width for correctness.
//!
//! The binary legs nonetheless run via `run_tm_fitted` and decode with `Binary::at(width)`, for two
//! reasons that are both conveniences: the width the fit settles on is worth naming in a failure
//! message, and it keeps `at_width` on this file's executed path. CONVENTION, NOT REQUIREMENT — do not
//! cite this file as evidence that a fitted decode is necessary.
//!
//! (Historical, stated in the past tense deliberately. Decode WAS once width-strict: `Binary::decode_nat`
//! and `parse_heap_cells` required a field to close exactly `self.width` cells later, where `Unary`'s
//! content-driven decode scanned to the next `#` and so worked at any width; a fitted-at-16 binary tape
//! read with a 64-wide `Binary` returned `None` for every demo, measured directly rather than assumed.
//! That stopped being true when both decoders became structural. This note is subordinate to the
//! statement above, and phrased so it cannot be quoted as current fact, BECAUSE IT REPEATEDLY WAS: the
//! obsolete half of the older wording — which led with "that was once REQUIRED" and put the retraction
//! in a separate paragraph — was copied into other files as a live correctness constraint seven times
//! across two branches before anyone checked it against `binary.rs`. Any sentence anywhere in this tree
//! claiming that binary decode needs the fitted width describes a version of this code that no longer
//! exists.)

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use proptest::prelude::*;
use redextape_core::desugar::desugar;
use redextape_core::lambda::{LambdaRun, MAX_REDUCTION_STEPS, decode, run_lambda};
use redextape_core::parser::parse;
use redextape_core::tm::{
    Binary, Encoding, EncodingKind, MAX_FIELD_WIDTH, TM_DEFAULT_CAPS, TmCaps, TmRun, Unary, decode_tape, run_tm,
    run_tm_fitted,
};
use redextape_core::value::Value;
use redextape_core::{RunError, run};
use redextape_test_support::arb_expr_over;

/// reference == λ == unary-TM == binary-TM, guided by the reference value's type. All four must run
/// to a value that decodes equal.
///
/// The two TM legs are DIFFERENT MACHINES compiled from the same Core, not the same machine read two
/// ways — which is what makes this a real fourth leg rather than a restatement of the third.
fn assert_three_way(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
    let tm = run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS);
    // `run_tm_fitted`, not `run_tm`: reads the tape back at the width the fit settled on. Once forced
    // by a width-strict decode, now kept so a failure names the width (see this file's module doc).
    let (btm, bwidth) = run_tm_fitted(&core, &Binary::default(), TM_DEFAULT_CAPS);
    match (reference, lambda, tm, btm) {
        (Ok(rv), LambdaRun::Reduced(nf), TmRun::Ran { tapes }, TmRun::Ran { tapes: btapes }) => {
            assert_eq!(decode(&nf, &rv), Some(rv.clone()), "reference vs λ disagree for: {src}");
            assert_eq!(
                decode_tape(&tapes, &rv, &Unary::default()),
                Some(rv.clone()),
                "reference vs unary-TM disagree for: {src}"
            );
            let benc = Binary::at(bwidth.expect("Binary::field_width() is always Some"));
            assert_eq!(
                decode_tape(&btapes, &rv, &benc),
                Some(rv.clone()),
                "reference vs binary-TM disagree for: {src}"
            );
        }
        (r, l, t, b) => panic!(
            "backend oracle mismatch for {src}:\n  reference={r:?}\n  lambda={l:?}\n  unary-tm={t:?}\n  binary-tm={b:?}"
        ),
    }
}

/// A runtime-faulting program: the reference faults (Runtime), λ's head/tail of nil is Ω (no normal
/// form), and both TM legs' deref fault state spins — all the same "no value" outcome. Small caps keep
/// the divergences fast.
fn assert_three_way_diverges(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let lambda = run_lambda(&core, 20_000);
    let tm = run_tm(&core, &Unary::default(), TmCaps { steps: 20_000, cells: 20_000 });
    let btm = run_tm(&core, &Binary::default(), TmCaps { steps: 20_000, cells: 20_000 });
    match (reference, lambda, tm, btm) {
        (Err(RunError::Runtime(_)), LambdaRun::HitCap, TmRun::HitCap, TmRun::HitCap) => {}
        (r, l, t, b) => panic!(
            "expected reference/λ/both TM legs to diverge on {src}:\n  reference={r:?}\n  lambda={l:?}\n  unary-tm={t:?}\n  binary-tm={b:?}"
        ),
    }
}

/// A program the λ backend refuses to lower in v1 (`LowerError`),
/// while the reference and both first-order TM legs agree on the value.
fn assert_tm_only(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    assert!(
        matches!(run_lambda(&core, MAX_REDUCTION_STEPS), LambdaRun::LowerError(_)),
        "λ should refuse the v1 latent trap: {src}"
    );
    let tm = run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS);
    let (btm, bwidth) = run_tm_fitted(&core, &Binary::default(), TM_DEFAULT_CAPS);
    match (reference, tm, btm) {
        (Ok(rv), TmRun::Ran { tapes }, TmRun::Ran { tapes: btapes }) => {
            assert_eq!(
                decode_tape(&tapes, &rv, &Unary::default()),
                Some(rv.clone()),
                "reference vs unary-TM disagree for: {src}"
            );
            let benc = Binary::at(bwidth.expect("Binary::field_width() is always Some"));
            assert_eq!(
                decode_tape(&btapes, &rv, &benc),
                Some(rv.clone()),
                "reference vs binary-TM disagree for: {src}"
            );
        }
        (r, t, b) => {
            panic!("reference vs TM mismatch for {src}:\n  reference={r:?}\n  unary-tm={t:?}\n  binary-tm={b:?}")
        }
    }
}

/// The capability the binary encoding exists for, stated as an executable claim: `100 * 100` is
/// `TmRun::Overflow` under unary at EVERY width up to the 64-cell ceiling, and a value under binary.
///
/// The unary half is not incidental — it is the control. Without it this test would pass just as well
/// if binary were secretly falling back to unary, or if the ceiling had been raised for both.
///
/// Uses `run_tm_fitted`, not `run_tm`, and decodes with `Binary::at(width)` at the width the fit
/// settled on. Once required — `Binary::decode_nat` was width-strict, and a fixed `Binary::default()`
/// (64 cells) would have reported `None` even though the machine computed 10,000 correctly — and now
/// kept for the width itself, which is half of what this test claims (see the module doc).
#[test]
fn binary_computes_what_unary_cannot_represent() {
    let (prog, ds) = parse("100 * 100");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    assert!(
        matches!(run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS), TmRun::Overflow),
        "unary must still report Overflow — otherwise this test proves nothing about binary"
    );
    let (btm, bwidth) = run_tm_fitted(&core, &Binary::default(), TM_DEFAULT_CAPS);
    match btm {
        TmRun::Ran { tapes } => {
            let benc = Binary::at(bwidth.expect("Binary::field_width() is always Some"));
            assert_eq!(decode_tape(&tapes, &Value::Nat(0), &benc), Some(Value::Nat(10_000)));
        }
        other => panic!("binary should compute 100 * 100: {other:?}"),
    }
}

/// A tape produced by one encoding must NOT decode through the other. Before `parse_heap_cells` moved
/// onto the trait, `decode_tape` took `enc` and ignored it for the heap half; this pins that the
/// encoding is now load-bearing all the way through the decode.
#[test]
fn a_binary_tape_does_not_decode_as_unary() {
    let (prog, ds) = parse("[1, 2, 3]");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let expected = Value::list_of_nats(&[1, 2, 3]);
    let (btm, bwidth) = run_tm_fitted(&core, &Binary::default(), TM_DEFAULT_CAPS);
    let TmRun::Ran { tapes } = btm else { panic!("binary should run a list literal") };
    let benc = Binary::at(bwidth.expect("Binary::field_width() is always Some"));
    assert_eq!(decode_tape(&tapes, &expected, &benc), Some(expected.clone()));
    assert_ne!(
        decode_tape(&tapes, &expected, &Unary::default()),
        Some(expected),
        "a binary tape read as unary must not produce the right answer"
    );
}

/// The full first-order demo suite — arithmetic, monus, comparison, if, let/let-mut/assign/while/seq,
/// calls & recursion, list construction & access, (Plan 3b-1) higher-order programs that `run_tm`
/// now defunctionalizes before lowering (a function passed as a value, `map`/`fold`), and
/// MUTUALLY RECURSIVE / FORWARD-REFERENCING `fn`s (`Core::LetRecGroup`). Every value
/// stays « MAX_FIELD_WIDTH (64) and every program runs to a value on ALL THREE backends. (The Plan-2
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
    // Confirmed non-vacuous by sabotage (restoring the old check order): TM `HitCap`, matching the
    // reference/λ "no value" outcome being wrongly a value fault instead of true agreement — see
    // `defunc.rs`'s `rewrite_value_name` for the measured failure this reorder closes.
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
    // reference/λ still agree at 10, while the TM diverges (`HitCap`). 3 + 7 = 10.
    "fn cons(a, b) { a + b } fn ap2(g, a, b) { g(a, b) } cons(1, 2) + ap2(cons, 3, 4)",
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

/// Extracts the string literals of a `const {name}: &[&str] = &[ ... ];` array from Rust SOURCE
/// TEXT (not a parsed/compiled value), skipping full-line `//` comments first — several of this
/// file's own demo comments contain literal `"` characters in prose (e.g. the bare `"tail"` this
/// file's own comments quote), which would otherwise be mistaken for string delimiters. Not a
/// general Rust lexer; just enough for this one array shape, used only by the sync check below.
fn extract_str_array(source: &str, const_name: &str) -> Vec<String> {
    let stripped: String =
        source.lines().map(|l| if l.trim_start().starts_with("//") { "" } else { l }).collect::<Vec<_>>().join("\n");
    let needle = format!("const {const_name}: &[&str] = &[");
    let start = stripped.find(&needle).unwrap_or_else(|| panic!("`{const_name}` not found")) + needle.len();
    let chars: Vec<char> = stripped[start..].chars().collect();
    let mut depth = 1i32;
    let mut end = 0usize;
    for (i, &c) in chars.iter().enumerate() {
        match c {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    end = i;
                    break;
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i < end {
        if chars[i] == '"' {
            let mut lit = String::new();
            i += 1;
            while i < end && chars[i] != '"' {
                if chars[i] == '\\' && i + 1 < end {
                    lit.push(chars[i]);
                    lit.push(chars[i + 1]);
                    i += 2;
                } else {
                    lit.push(chars[i]);
                    i += 1;
                }
            }
            out.push(lit);
            i += 1;
        } else {
            i += 1;
        }
    }
    out
}

/// `examples/step_survey.rs`, `redextape-native/tests/native_oracle.rs`,
/// `examples/list_reduction_probe.rs`, `examples/lambda_sharing_probe.rs` and
/// `examples/concurrency_probe.rs` each hand-copy this file's
/// `FIRST_ORDER_DEMOS` — an example is a separate binary crate and cannot `use` an integration test's
/// module, and the native crate's oracle predates a shared fixtures crate — so all five are duplicated
/// by hand rather than referencing this array. That has already drifted twice (documented in
/// `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`'s survey caveat and, within this very
/// branch, in `step_survey.rs` again after the FIRST fix), so a one-off resync is demonstrably not
/// durable on its own. This test reads all six files as TEXT (via `CARGO_MANIFEST_DIR`, so it works
/// under `cargo test` from any directory) and asserts their extracted string literals are byte-for-byte
/// equal, catching the next drift at compile-time cost instead of the next survey run silently
/// describing a stale corpus.
///
/// COPIES WERE ADDED TO THIS TEST AFTER THE FACT, TWICE, AND THE SECOND TIME PROVES THE FIRST FIX'S OWN
/// COUNT WRONG. `list_reduction_probe.rs` was committed with a copy and a comment claiming this test kept
/// it in sync; it did not, because the test covered three, so the test went to four. It should have gone
/// to five: `examples/lambda_sharing_probe.rs` carries a copy too, with its own module doc citing the
/// same drift history, and nothing read it. **The fix's own count of the damage was short** — which is
/// the roadmap's standing lesson about this class stated by a fresh instance of it, and the reason this
/// doc names the enumeration method rather than the number: the check is `grep -rn FIRST_ORDER_DEMOS`
/// over the whole tree, not a list anyone maintains by memory. All five were byte-identical when the
/// fifth was added, so this closed an uncovered copy rather than live drift; that is the window this
/// test exists to shut, and it stayed open through one deliberate attempt to shut it.
///
/// **THE SIXTH (2026-08-01, `examples/concurrency_probe.rs`) IS THE FIRST ADDED *WITH* ITS COPY RATHER
/// THAN AFTER IT**, which is what the paragraph above asks for and had not yet been tested. Two things
/// changed to make that the cheap path rather than the diligent one. The per-copy `read_to_string` +
/// `extract_str_array` + `assert_eq!` triple became one row in a `copies` table, so adding a copy is a
/// one-line edit instead of a three-place one — the shape that made the fifth easy to miss. And the
/// count is now asserted (`copies.len() + 1 == 6`), because a table makes a *deletion* silent in a way
/// three hand-written asserts did not: dropping a row would leave this test green while that file
/// drifted. The assert is deliberately a literal, so bumping it is a conscious act that re-runs the
/// `grep`.
///
/// An example target is not a test target, but that was never what made a copy checkable — the check is
/// textual and path-based, so an untracked-by-CI probe costs one more `read_to_string` and closes the
/// drift window instead of documenting it.
#[test]
fn first_order_demos_stay_synced_across_all_six_copies() {
    let manifest = env!("CARGO_MANIFEST_DIR");
    // Every copy in the tree, as (path relative to this crate, label for the failure message). Adding a
    // row is the whole cost of adding a copy — which is the point, and is why this is a table rather than
    // five hand-written `read_to_string`/`assert_eq!` pairs: the fifth copy was missed because each new
    // one meant editing three places, and the sixth is the first added under this shape.
    let copies: &[(&str, &str)] = &[
        ("examples/step_survey.rs", "examples/step_survey.rs"),
        ("../redextape-native/tests/native_oracle.rs", "redextape-native/tests/native_oracle.rs"),
        ("examples/list_reduction_probe.rs", "examples/list_reduction_probe.rs"),
        ("examples/lambda_sharing_probe.rs", "examples/lambda_sharing_probe.rs"),
        ("examples/concurrency_probe.rs", "examples/concurrency_probe.rs"),
    ];

    let canonical_src =
        std::fs::read_to_string(format!("{manifest}/tests/three_way_oracle.rs")).expect("read this file's own source");
    let canonical = extract_str_array(&canonical_src, "FIRST_ORDER_DEMOS");
    assert_eq!(canonical.len(), FIRST_ORDER_DEMOS.len(), "this file's own extraction lost or gained entries");

    for (path, label) in copies {
        let src = std::fs::read_to_string(format!("{manifest}/{path}")).unwrap_or_else(|e| panic!("read {label}: {e}"));
        let found = extract_str_array(&src, "FIRST_ORDER_DEMOS");
        assert_eq!(found, canonical, "{label}'s FIRST_ORDER_DEMOS has drifted from this file's");
    }

    // The count is asserted, not just the contents: a copy silently DROPPED from `copies` would leave
    // this test green while its file drifted. `grep -rn FIRST_ORDER_DEMOS` over the tree is the
    // enumeration method this doc names, and 6 is what it returns — this file plus `copies`.
    assert_eq!(copies.len() + 1, 6, "a copy was added to or removed from the tree without updating this count");
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

/// A first-order expression generator whose value — AND every intermediate — stays under MAX_FIELD_WIDTH
/// (64), so the TM's fixed-width unary fields never overflow. This function only supplies the LEAF
/// range (`< 8`); the recursion cap and the arm set that make the bound hold both live in
/// `redextape-test-support`'s `arb_expr_over`, which this function calls — see that function's doc for
/// where the safety lever actually is. Summarized here because it is why this generator is safe to use
/// on the TM at all: the `depth=3` recursion cap plus value-non-growing ops keep every value under the
/// bound (measured max 27 over 2M samples); the node budget keeps the total leaf-sum small; and the arm
/// set emits only value-non-growing ops — `+` (bounded by the leaf-sum), monus `-` (shrinks),
/// comparisons and `if` (yield 0/1 or select one branch) — deliberately OMITTING `*` (blows values up)
/// and value-reusing `let` (`let q = v; q + q` doubles); the curated demos cover `*`/`let`/`while`/
/// calls/lists, so this property stresses the arithmetic / comparison / if structure three ways. Every
/// generated program terminates to a value (no loops, no functions, no faults), so the value arm always
/// fires. SAFETY LEVER: it is `depth=3` (`arb_expr_over`'s `prop_recursive` first argument, the
/// recursion-depth cap — NOT set here), not `desired_size` (the second argument), that bounds the worst
/// case — a future editor raising the leaf range below (`0u64..8`) must keep `arb_expr_over`'s depth cap
/// to preserve this bound.
fn arb_tm_safe_expr() -> impl Strategy<Value = String> {
    arb_expr_over((0u64..8).prop_map(|n| n.to_string()))
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
        let tm = run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS);
        match (reference, lambda, tm) {
            (Ok(rv), LambdaRun::Reduced(nf), TmRun::Ran { tapes }) => {
                prop_assert_eq!(decode(&nf, &rv), Some(rv.clone()));
                prop_assert_eq!(decode_tape(&tapes, &rv, &Unary::default()), Some(rv));
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
// generated value AND intermediate is provably `< MAX_FIELD_WIDTH` (64) — the only arithmetic is a
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
    let tm = run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS);
    // Decodes at the width `run_tm_fitted` settled on. No longer required (both decoders are
    // structural), but it names the width in a shrunk counterexample, which a bare `run_tm` would not.
    let (btm, bwidth) = run_tm_fitted(&core, &Binary::default(), TM_DEFAULT_CAPS);
    match (reference, lambda, tm, btm) {
        (Ok(rv), LambdaRun::Reduced(nf), TmRun::Ran { tapes }, TmRun::Ran { tapes: btapes }) => {
            prop_assert_eq!(decode(&nf, &rv), Some(rv.clone()), "reference vs λ disagree: {}", src);
            prop_assert_eq!(
                decode_tape(&tapes, &rv, &Unary::default()),
                Some(rv.clone()),
                "reference vs unary-TM disagree: {}",
                src
            );
            let benc = Binary::at(bwidth.unwrap_or(64));
            prop_assert_eq!(decode_tape(&btapes, &rv, &benc), Some(rv), "reference vs binary-TM disagree: {}", src);
            Ok(())
        }
        (r, l, t, b) => {
            prop_assert!(
                false,
                "four-way mismatch for {}:\n ref={:?}\n λ={:?}\n unary-tm={:?}\n binary-tm={:?}",
                src,
                r,
                l,
                t,
                b
            );
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
    let tm = run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS);
    let (btm, bwidth) = run_tm_fitted(&core, &Binary::default(), TM_DEFAULT_CAPS);
    match (reference, tm, btm) {
        (Ok(rv), TmRun::Ran { tapes }, TmRun::Ran { tapes: btapes }) => {
            prop_assert_eq!(
                decode_tape(&tapes, &rv, &Unary::default()),
                Some(rv.clone()),
                "reference vs unary-TM disagree: {}",
                src
            );
            let benc = Binary::at(bwidth.unwrap_or(64));
            prop_assert_eq!(decode_tape(&btapes, &rv, &benc), Some(rv), "reference vs binary-TM disagree: {}", src);
            Ok(())
        }
        (r, t, b) => {
            prop_assert!(
                false,
                "two-way (tm-only) mismatch for {}:\n ref={:?}\n unary-tm={:?}\n binary-tm={:?}",
                src,
                r,
                t,
                b
            );
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
        assert!(
            matches!(run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS), TmRun::Ran { .. }),
            "must run on TM (boxed): {src}"
        );
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
// subsumed by) the differential oracle above. All operands bounded so every value is `< MAX_FIELD_WIDTH`.
// ============================================================================================

/// Run `src` on the TM under ONE encoding and decode against its reference value; `None` if the
/// reference faults, the program doesn't lower/halt, or decode fails.
///
/// `run_tm_fitted` rather than `run_tm`: once required, because `Binary`'s decode was width-strict and
/// a tape fitted at 16 cells decoded to `None` under `Binary::default()` (see this file's module doc).
/// Both decoders are structural now, so this is no longer load-bearing — but both legs still go through
/// the same path rather than branching on encoding, which is why it reads the same for `Unary` too.
fn tm_val_with(src: &str, enc: &dyn Encoding) -> Option<Value> {
    let expected = run(src).ok()?;
    let (prog, ds) = parse(src);
    if !ds.is_empty() {
        return None;
    }
    let core = desugar(&prog.unwrap());
    let (run_out, width) = run_tm_fitted(&core, enc, TM_DEFAULT_CAPS);
    match run_out {
        TmRun::Ran { tapes } => decode_tape(&tapes, &expected, &*enc.at_width(width?)),
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
            // EVERY encoding. A law is a property of the pipeline, not of one representation, so a
            // law that held under unary and broke under binary would be exactly the kind of defect
            // this file exists to catch — and until now these ~14 law proptests ran unary only.
            // `at(MAX_FIELD_WIDTH)`, not a default: identical to `{Unary,Binary}::default()` today, and
            // stated explicitly so a future encoding whose default differs cannot silently re-width this
            // test.
            let encs: Vec<(&'static str, Box<dyn Encoding>)> =
                EncodingKind::ALL.iter().map(|&k| (k.name(), k.at(MAX_FIELD_WIDTH))).collect();
            for (name, enc) in encs.iter().map(|(n, e)| (*n, e.as_ref())) {
                let (tl, tr) = (tm_val_with(lhs, enc), tm_val_with(rhs, enc));
                prop_assert_eq!(tl.as_ref(), Some(vl), "{}-TM violates the law (lhs): {}", name, lhs);
                prop_assert_eq!(tr.as_ref(), Some(vr), "{}-TM violates the law (rhs): {}", name, rhs);
            }
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
        let tm = run_tm(&core, &Unary::default(), TmCaps { steps: 20_000, cells: 20_000 });
        match (reference, lambda, tm) {
            (Err(RunError::Runtime(_)), LambdaRun::HitCap, TmRun::HitCap) => {}
            (r, l, t) => prop_assert!(false, "expected all three to diverge on {}:\n ref={:?}\n λ={:?}\n tm={:?}", src, r, l, t),
        }
    }
}
