//! The two-way oracle (§10.1): for every demo program, the reference tree-walker's result equals
//! the decoded lambda normal form. This is the first cross-backend agreement guarantee; Plan 3
//! extends it to three ways.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::desugar::desugar;
use redextape_core::lambda::{LambdaRun, MAX_REDUCTION_STEPS, decode, run_lambda};
use redextape_core::parser::parse;
use redextape_core::{RunError, run};

/// Every program the reference runs to a value, the lambda backend must run to a normal form that
/// decodes (guided by that value's type) to the SAME value.
fn assert_oracle_agrees(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
    match (reference, lambda) {
        (Ok(rv), LambdaRun::Reduced(nf)) => {
            // Decode the lambda normal form guided by the reference value's type; it must equal it.
            assert_eq!(decode(&nf, &rv), Some(rv.clone()), "reference vs lambda disagree for: {src}");
        }
        (Err(RunError::Runtime(_)), LambdaRun::HitCap) => {
            // A reference runtime fault (e.g. head(nil)) has no finite lambda normal form — acceptable.
        }
        (r, l) => panic!("oracle mismatch for {src}:\n  reference={r:?}\n  lambda={l:?}"),
    }
}

#[test]
fn two_way_oracle_on_the_demo_suite() {
    let demos = [
        "1 + 2 * 3",
        "3 - 5",
        "if 2 > 1 { 10 } else { 20 }",
        "let add1 = |x| x + 1; add1(41)",
        "head(cons(7, nil))",
        "[1, 2, 3]",
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
        "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
        "\
            fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
            fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
            fn add(a, b) { a + b }\n\
            fn add1(x) { x + 1 }\n\
            fold([3, 1, 2].map(add1), 0, add)",
    ];
    for src in demos {
        assert_oracle_agrees(src);
    }
}
