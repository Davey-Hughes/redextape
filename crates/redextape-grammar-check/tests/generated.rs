#![cfg_attr(test, allow(clippy::pedantic))]

use proptest::prelude::*;
use proptest::test_runner::TestCaseError;
use redextape_grammar_check::mini::compare;
use redextape_test_support::arb_expr_over;

proptest! {
    /// The generated corpus gives DEPTH ON A NARROW SHAPE, not breadth: `arb_expr_over` produces
    /// `+`, `-`, `>`, `==` and `if` over numeric leaves — no `fn`, no `while`, no closures, no UFCS.
    /// Those live in `CORPUS` and rest on the weaker layer, which design §11.3 states rather than
    /// leaves for a reader to discover.
    ///
    /// This is a new caller of `arb_expr_over` and RECORDS NO RATE against it, so it adds no
    /// constraint on that generator's recursion parameters — read its doc comment before changing
    /// anything there.
    #[test]
    fn the_grammar_agrees_with_classify_source_on_generated_programs(
        src in arb_expr_over((0u64..100).prop_map(|n| n.to_string()))
    ) {
        // `TestCaseError::fail` rather than `prop_assert!(compare(..).is_ok(), .., compare(..))`:
        // that form calls `compare` a second time to build its message, and reaches for
        // `unwrap_err` inside a macro-generated test fn where clippy's in-tests exemption is not
        // guaranteed to apply. This form calls once and cannot panic.
        if let Err(why) = compare(&src) {
            return Err(TestCaseError::fail(why));
        }
    }
}
