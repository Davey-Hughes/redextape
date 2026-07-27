//! Final-tape structure for the two tapes nothing else inspects: HEAP and STACK.
//!
//! The bank-safety suite covers REG and BOX, the two FIXED-WIDTH tapes, both per-step
//! (`tm_bank_invariant.rs`) and statically (`tm_static_delimiter_safety.rs`). Neither technique
//! transfers here, and that was measured rather than assumed:
//!
//!   * Per-step is impossible. HEAP and STACK are variable-width and their delimiters are DATA —
//!     `cons` creates a `@`, `stack_push_work` creates a `#`, `dispatch_tag` ERASES one. Mid-gadget a
//!     cell or frame is half-written, so there is no skeleton that holds after every step.
//!   * The static rung-3 check is likewise inapplicable. Extending it to these tapes reports 4-10
//!     "violations" on HEAP and up to 52 on STACK for ordinary programs, and inspection shows they are
//!     correct code: `dispatch_tag`'s `on(STACK, Some(SEP), Some(BLANK), Move::L)` deliberately erases
//!     a frame delimiter as part of popping. On REG and BOX a delimiter is immutable for the whole
//!     run, which is exactly what makes a per-rule check possible there and meaningless here.
//!
//! So this checks the FINAL tape of a run that produced a value, which is a real property and the
//! strongest one these tapes admit cheaply.
//!
//! Both properties were sabotage-verified, and the heap one earned its keep in the process. Making
//! `cons` write a MARK where the head/tail `#` belongs turned the corpus test red on a WRONG VALUE —
//! which the existing oracle would also have caught — but turned the generated-program property red on
//! `fn ap(f, x) { f(x) } fn add(y) { y + 0 } ap(add, 0)`, whose answer was still CORRECT while its heap
//! was structurally broken. That is precisely the class the value oracle cannot see, and the reason to
//! check structure rather than only results.

use proptest::prelude::*;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::run;
use redextape_core::tm::{AT, BLANK, HEAP, MARK, SEP, STACK, TM_DEFAULT_CAPS, TmRun, Unary, decode_tape, run_tm};

mod common;
use common::{heap_tape_is_well_formed, stack_is_empty};

/// Programs spanning both tapes: list construction and access (HEAP), calls and recursion (STACK),
/// higher-order dispatch (both), and mutable capture.
const CORPUS: &[&str] = &[
    "1 + 2 * 3",
    "[1, 2, 3]",
    "cons(1, cons(2, nil))",
    "head(tail(cons(1, cons(2, nil))))",
    "head([1, 2, 3])",
    "tail([1, 2, 3])",
    "is_empty(nil)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
    "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)",
    "let mut c = 0; fn ap(f, x) { f(x) } ap(|x| { c = c + x; c }, 5) + c",
];

/// Run `src`, require it produced the reference value, and check both tapes. Returns the number of
/// cons cells the heap ended with, so a caller can assert the corpus reaches the heap at all.
fn check(src: &str) -> usize {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
    let core = desugar(&prog.unwrap());
    let expected = run(src).expect("reference runs");
    let TmRun::Ran { tapes } = run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS) else {
        panic!("`{src}` must run to a value on the TM");
    };
    assert_eq!(decode_tape(&tapes, &expected, &Unary::default()), Some(expected), "`{src}` decoded wrong");

    let heap = tapes[HEAP].snapshot().0;
    if let Err(why) = heap_tape_is_well_formed(&heap, &Unary::default()) {
        panic!("`{src}`: {why}");
    }
    let stack = tapes[STACK].snapshot().0;
    if let Err(why) = stack_is_empty(&stack) {
        panic!("`{src}`: {why}");
    }
    heap.iter().filter(|&&c| c == AT).count()
}

#[test]
fn the_corpus_leaves_both_tapes_well_formed() {
    let mut with_cells = 0usize;
    for src in CORPUS {
        if check(src) > 0 {
            with_cells += 1;
        }
    }
    // Non-vacuity: if nothing allocated a cons cell, `heap_tape_is_well_formed` only ever saw blanks
    // and the corpus proved nothing about heap structure.
    assert!(with_cells >= 6, "only {with_cells} corpus programs allocated heap cells");
}

/// The STACK check specifically, on the programs that actually push frames. A recursive program nests
/// many frames and must still end with none — that is the balance property, and it is invisible to
/// the value oracle unless an imbalance happens to change an answer.
#[test]
fn deep_recursion_leaves_no_stack_residue() {
    for src in [
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(8)",
        "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(7)",
        "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)",
    ] {
        check(src);
    }
}

// ================================================================================================
// Non-vacuity for the checkers themselves
// ================================================================================================

#[test]
fn the_heap_checker_accepts_real_heaps_and_rejects_damage() {
    // The shape `[1, 2, 3]` actually produces: cons(3,nil), cons(2,·), cons(1,·).
    let good: Vec<char> = "_@111#@11#1@1#11_".chars().collect();
    assert_eq!(heap_tape_is_well_formed(&good, &Unary::default()), Ok(()));
    // A zero-valued head and tail is legitimate (`@#`).
    assert_eq!(heap_tape_is_well_formed(&"_@#@11#1_".chars().collect::<Vec<_>>(), &Unary::default()), Ok(()));
    // An empty heap.
    assert_eq!(heap_tape_is_well_formed(&[BLANK], &Unary::default()), Ok(()));
    assert_eq!(heap_tape_is_well_formed(&[], &Unary::default()), Ok(()));

    // A cell whose head/tail separator is missing — the structure `decode_tape` walks would be lost.
    assert!(heap_tape_is_well_formed(&"_@111@11#1_".chars().collect::<Vec<_>>(), &Unary::default()).is_err());
    // Content after the heap's end.
    assert!(heap_tape_is_well_formed(&"_@1#1__1_".chars().collect::<Vec<_>>(), &Unary::default()).is_err());
    // A stray symbol where a cell should start.
    assert!(heap_tape_is_well_formed(&"_@1#1_#_".chars().collect::<Vec<_>>(), &Unary::default()).is_err());
    let _ = (MARK, SEP);
}

#[test]
fn the_stack_checker_accepts_empty_and_rejects_residue() {
    assert_eq!(stack_is_empty(&[]), Ok(()));
    assert_eq!(stack_is_empty(&[BLANK, BLANK, BLANK]), Ok(()));
    assert!(stack_is_empty(&"__1#__".chars().collect::<Vec<_>>()).is_err(), "a leaked frame must be rejected");
    assert!(stack_is_empty(&"__#__".chars().collect::<Vec<_>>()).is_err(), "even a bare delimiter is residue");
}

// ================================================================================================
// The same properties over generated programs
// ================================================================================================

/// Shape-templated generators with randomized values, so the fitted width varies and the heap holds
/// different pointer values. Mirrors `tm_bank_invariant.rs`'s generator, restricted to the shapes that
/// actually reach HEAP or STACK — a generator of pure arithmetic would leave both tapes blank and
/// prove nothing.
fn arb_heap_or_stack_program() -> impl Strategy<Value = String> {
    prop_oneof![
        (0u64..12, 0u64..12, 0u64..12).prop_map(|(a, b, c)| format!("[{a}, {b}, {c}]")),
        (0u64..12, 0u64..12).prop_map(|(a, b)| format!("head(tail(cons({a}, cons({b}, nil))))")),
        (0u64..12, 0u64..12).prop_map(|(a, b)| format!("tail(cons({a}, cons({b}, nil)))")),
        (1u64..6).prop_map(|n| format!("fn sum(k) {{ if k == 0 {{ 0 }} else {{ k + sum(k - 1) }} }} sum({n})")),
        (0u64..10, 0u64..10).prop_map(|(a, b)| format!("fn ap(f, x) {{ f(x) }} fn add(y) {{ y + {a} }} ap(add, {b})")),
        (0u64..8, 0u64..8).prop_map(|(a, b)| format!(
            "fn map(xs, f) {{ if is_empty(xs) {{ nil }} else {{ cons(f(head(xs)), map(tail(xs), f)) }} }} \
             fn inc(x) {{ x + 1 }} head([{a}, {b}].map(inc))"
        )),
        (0u64..10, 0u64..10)
            .prop_map(|(a, b)| format!("let mut c = {a}; fn ap(f, x) {{ f(x) }} ap(|x| {{ c = c + x; c }}, {b}) + c")),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, ..ProptestConfig::default() })]

    #[test]
    fn generated_programs_leave_both_tapes_well_formed(src in arb_heap_or_stack_program()) {
        let (prog, ds) = parse(&src);
        prop_assume!(ds.is_empty());
        let core = desugar(&prog.unwrap());
        let Ok(expected) = run(&src) else { return Ok(()) };
        let TmRun::Ran { tapes } = run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS) else {
            return Ok(()); // a cap or an overflow can stop mid-call; neither property applies then
        };
        prop_assert_eq!(decode_tape(&tapes, &expected, &Unary::default()), Some(expected), "decoded wrong: {}", src);
        if let Err(why) = heap_tape_is_well_formed(&tapes[HEAP].snapshot().0, &Unary::default()) {
            prop_assert!(false, "`{}`: {}", src, why);
        }
        if let Err(why) = stack_is_empty(&tapes[STACK].snapshot().0) {
            prop_assert!(false, "`{}`: {}", src, why);
        }
    }
}
