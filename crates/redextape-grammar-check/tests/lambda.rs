#![cfg_attr(test, allow(clippy::pedantic))]

use proptest::prelude::*;
use proptest::test_runner::TestRunner;
use redextape_core::analysis::TokenClass;
use redextape_grammar_check::LAMBDA;
use redextape_grammar_check::lambda::{CORPUS, compare_printed, printed_term};
use redextape_test_support::arb_expr_over;

/// Every capture name any query emits must have a class. Adding a capture without deciding its class
/// would otherwise colour something in an editor that the differential then silently ignores.
///
/// PROMOTED to `Grammar::capture_map_is_total` — this test and the mini-language's identically-named
/// one in `tests/captures.rs` were duplicated verbatim, and neither reads anything grammar-specific
/// beyond `self`. See `src/grammar.rs` for the shared implementation, kept fallible there and
/// panicking here (`clippy.toml` exempts `unwrap`/`expect`/`panic` only inside `#[test]` fns and
/// `#[cfg(test)]` modules).
#[test]
fn the_capture_map_is_total_over_the_queries() {
    if let Err(why) = LAMBDA.capture_map_is_total() {
        panic!("{why}");
    }
}

/// The map is a function: one capture name, one class.
///
/// PROMOTED to `Grammar::capture_map_has_no_duplicate_keys` — see the note on
/// `the_capture_map_is_total_over_the_queries` above; same duplication, same fix.
#[test]
fn the_capture_map_has_no_duplicate_keys() {
    if let Err(why) = LAMBDA.capture_map_has_no_duplicate_keys() {
        panic!("{why}");
    }
}

/// A row no query uses is a row a query edit left behind. Testable only because the tables are
/// per-grammar — design §5.1.
///
/// PROMOTED to `Grammar::every_capture_row_is_used` — same duplication and same fix as
/// `the_capture_map_is_total_over_the_queries` above.
#[test]
fn every_map_row_is_used_by_a_query() {
    if let Err(why) = LAMBDA.every_capture_row_is_used() {
        panic!("{why}");
    }
}

/// `captures` collapses overlapping captures, so its output has one entry per byte range. Unlike the
/// mini-language, λ's occurrence patterns are scoped to never overlap the parameter pattern — see
/// `queries/highlights.scm` — so this also stands as evidence that scoping is exhaustive over the
/// corpus below: an unscoped catch-all colliding with `@variable.parameter` would surface as a
/// `captures` error (different classes on one range), not a silently-wrong length.
///
/// PROMOTED to `Grammar::shipped_queries_never_disagree` — same duplication and same fix as
/// `the_capture_map_is_total_over_the_queries` above.
#[test]
fn the_shipped_queries_never_disagree() {
    if let Err(why) = LAMBDA.shipped_queries_never_disagree(CORPUS) {
        panic!("{why}");
    }
}

/// Pins what `captures` actually returns for one HAND-TYPED source string, text and class together —
/// the analogue of the mini-language's `captures_pins_text_and_class_for_one_source`.
///
/// **NOT A PIN OF PRINTER OUTPUT**, despite `src` looking like one: `Abs("x", App(x, x))` prints as
/// `λx. x x`, with no parentheses, because an abstraction's body is always written at the role that
/// never calls `parens` — `print_lambda_mapped` can never emit `(x x)` here. `src` is legitimate,
/// hand-typed λ all the same: an editor's user can type parentheses the printer never writes, and this
/// pins the query's behaviour on exactly that shape, the same reason `CORPUS`'s "a parenthesized
/// variable" entry exists.
///
/// `λ` and the bound name are BOTH `Binder`: that is `print_lambda_mapped`'s rule (`syntax.rs`), not
/// a simplification here. If this expectation ever looks wrong, check it against that function's
/// `push_span` calls before changing either side.
#[test]
fn captures_pins_text_and_class_for_a_printed_term() {
    let src = "λx. (x x)";
    let got = LAMBDA.captures(src).expect("the query must run");
    let pairs: Vec<(&str, TokenClass)> = got.iter().map(|(s, c)| (&src[s.start..s.end], *c)).collect();
    assert_eq!(
        pairs,
        vec![
            ("λ", TokenClass::Binder),
            ("x", TokenClass::Binder),
            (".", TokenClass::Punct),
            ("(", TokenClass::Punct),
            ("x", TokenClass::Ident),
            ("x", TokenClass::Ident),
            (")", TokenClass::Punct),
        ]
    );
}

/// THE COLLAPSE IS ONLY SOUND BECAUSE OVERLAPPING CAPTURES AGREE, so the check that they do must be
/// shown capable of failing. `@variable.parameter` projects to `Binder` and `@variable` to `Ident`,
/// so a query that captures a parameter as BOTH captures one identifier as two different classes at
/// one byte range — the exact shape `queries/highlights.scm`'s scoped occurrence patterns are
/// written to avoid.
///
/// **NOT PROMOTED, unlike the five checks above.** The conflicting query this builds must name
/// capture rows that exist in *this* grammar's table — `@variable.parameter`/`@variable` here, but
/// `@variable`/`@operator` for the mini-language (see `tests/captures.rs`'s copy) — so a
/// grammar-agnostic version would have no query to hand it. This one legitimately stays per-grammar.
#[test]
fn a_conflicting_query_is_rejected() {
    let conflicting = "(abstraction parameter: (identifier) @variable.parameter)\n(identifier) @variable\n";
    let err = LAMBDA
        .captures_with(conflicting, "λx. x")
        .expect_err("a parameter captured as both Binder and Ident must not be collapsed silently");
    assert!(err.contains("disagree"), "the message must say what happened, got: {err}");
}

/// `Grammar::parse` succeeds even on a syntax error — it returns a `Tree` that CONTAINS
/// `ERROR`/`MISSING` nodes rather than failing — and `captures` never inspects `error_nodes`, so a
/// corpus entry that stopped parsing cleanly would still pass `the_shipped_queries_never_disagree`
/// with a short-but-consistent capture list. This is λ's analogue of the mini-language's
/// `tests/corpus.rs::every_corpus_program_parses_without_error_nodes`, and it matters more here than
/// it would look: several `CORPUS` entries are COPIED (not shared) from
/// `grammars/tree-sitter-redextape-lambda/test/corpus/terms.txt`, so "`tree-sitter test` already
/// holds this string to the grammar" is true only until that file next changes underneath this one —
/// this test is what keeps the guarantee alive independent of that.
///
/// PROMOTED to `Grammar::every_corpus_program_parses_without_error_nodes` — this test and
/// `tests/corpus.rs`'s identically-named mini-language one were duplicated verbatim, and neither
/// reads anything grammar-specific beyond `self`. See `src/grammar.rs` for the shared implementation.
#[test]
fn every_corpus_program_parses_without_error_nodes() {
    if let Err(why) = LAMBDA.every_corpus_program_parses_without_error_nodes(CORPUS) {
        panic!("{why}");
    }
}

/// Design §6.2's stated mitigation for the `\` alias gap — a λ corpus entry cannot be hand-typed with
/// a `\` and then classified, because the differential's corpus is printer-produced (§4) and the
/// printer emits only `λ`, so no comparison entry can ever contain a `\` — is a hand-written corpus
/// entry checked by `tree-sitter test` for tree shape, "plus the observation that `parse_lambda(text)`
/// must succeed on each" (design §6.2, and the λ README's *How it is checked*). Before this test that
/// second half was only an observation: nothing in this crate called `parse_lambda`
/// (`grep -rn parse_lambda crates/redextape-grammar-check/` was empty). This makes it real.
#[test]
fn parse_lambda_succeeds_on_every_backslash_spelled_corpus_entry() {
    let mut checked = 0;
    for (name, src) in CORPUS {
        if !src.contains('\\') {
            continue;
        }
        checked += 1;
        let (term, diagnostics) = redextape_core::lambda::parse_lambda(src);
        assert!(
            diagnostics.is_empty(),
            "`{name}` (`{src}`) must parse under the real authority cleanly, got: {diagnostics:?}"
        );
        assert!(term.is_some(), "`{name}` (`{src}`) produced no term despite no diagnostics");
    }
    // Guards against a future edit quietly dropping the one `\`-spelled entry and leaving this test
    // green while checking nothing — the same shape of gap `every_query_pattern_fires` exists to
    // catch one layer up.
    assert!(checked > 0, "no `\\`-spelled entry in CORPUS; this test would vacuously pass");
}

/// λ's mandatory half of `every_query_pattern_fires` — see that function's doc for why the gap it
/// closes was invisible to every other test in this crate.
#[test]
fn every_lambda_query_pattern_fires_over_the_corpus() {
    if let Err(why) = LAMBDA.every_query_pattern_fires(CORPUS) {
        panic!("{why}");
    }
}

/// The hand-written half of λ's differential: programs chosen (in `mini::CORPUS`) to exercise
/// binders, nesting and application, lowered to λ and printed, then checked against the grammar.
///
/// Not every corpus program lowers — `let mut`, `while`, UFCS and list literals either are not yet
/// supported by `lambda::lower` or fall outside it entirely — and that is expected, not a failure:
/// `printed_term` returns `None` for those and this loop filters them out rather than asserting. The
/// measured rate is 12 of `mini::CORPUS`'s 13 entries: only `"ufcs chain"` fails to lower, because list
/// literals and UFCS sit outside `lambda::lower` entirely. The `printed >= 12` floor holds the suite to
/// that measured rate, so a regression that dropped even one more entry — never mind a collapse toward
/// zero — fails loudly instead of this test passing on a shrunken comparison.
#[test]
fn the_lambda_grammar_agrees_with_the_printer_on_every_corpus_program() {
    let total = redextape_grammar_check::mini::CORPUS.len();
    let mut printed = 0;
    for (name, src) in redextape_grammar_check::mini::CORPUS {
        let Some((text, want)) = printed_term(src) else { continue };
        printed += 1;
        if let Err(why) = compare_printed(&text, &want) {
            panic!("`{name}` lowered and printed, then diverged:\n{why}");
        }
    }
    // Same style as the generated leg's `eprintln!` below: written every run, but `cargo nextest`
    // captures and discards a passing test's stdout/stderr, so this is not something a green run
    // shows anyone — the floor below is what actually catches a regression.
    eprintln!("lambda corpus leg: {printed}/{total} mini::CORPUS programs lowered to λ");
    assert!(
        printed >= 12,
        "only {printed}/{total} corpus programs lowered (expected 12 of 13 — \"ufcs chain\" is the \
         one known exception, since list literals and UFCS are outside `lambda::lower`); the corpus \
         is not exercising λ"
    );
}

/// The comparison must be capable of failing, the same standard `differential.rs`'s
/// `the_comparison_can_fail` holds the mini-language to. PR 1 shipped `compare_classified`'s span-for
/// -span comparison completely untested — deletable with the suite still green, caught only by the
/// final whole-branch review — and this is what closes that gap for λ.
///
/// A query that captures only parens leaves every binder and identifier uncaptured, so the grammar
/// side is short and the length branch must fire.
///
/// The mini source is `"1"`, not `"let f = |x| x; f(1)"`: that program's printed
/// term DOES contain literal parens (`"(λf. f (λf0. λx. f0 x)) (λx. x)"`), and one of them sits at
/// `want`'s second element, so `compare_classified`'s PER-INDEX loop finds a mismatch (a `Binder` at
/// `want[1]` against a `Punct` at `got[1]`) before the lengths are ever compared — the wrong branch,
/// verified by actually running it rather than assumed up front. Church numeral `1`
/// prints as `"λf. λx. f x"`, with NO literal parentheses anywhere, so `["(" ")"] @punctuation.bracket`
/// captures nothing at all here: `got` is empty, the per-index loop (zipped against an empty iterator)
/// runs zero times, and every one of `want`'s 8 spans becomes an extra span on the authority side —
/// the length branch, unambiguously.
#[test]
fn the_lambda_comparison_can_fail() {
    let (text, want) = printed_term("1").expect("this program lowers");
    let err = redextape_grammar_check::compare_classified(&LAMBDA, "[\"(\" \")\"] @punctuation.bracket", &text, &want)
        .expect_err("a strict-subset query must not compare equal");
    assert!(err.contains("more span(s)"), "expected a length mismatch, got: {err}");
}

/// The generated leg for λ: mirrors `tests/generated.rs`'s coverage of the mini-language grammar, but
/// over the produced (not authored) λ corpus — every generated program that lowers is printed and
/// compared.
///
/// Driven through `TestRunner` directly rather than the `proptest!` macro so the lowering pass rate
/// can be logged exactly once, after every generated case has run: the macro owns the whole test
/// function it expands to and gives no hook after its internal loop, and `cargo nextest` runs every
/// `#[test]` in its own process, so a static counter shared with a second, later test would not see
/// what this one counted.
///
/// This is a new caller of `arb_expr_over` and records no rate AGAINST that generator's own
/// recursion parameters or arm set, so it adds no constraint there — see that function's doc before
/// changing anything about it. The rate logged below is about λ's lowering coverage, not about
/// `arb_expr_over` itself.
#[test]
fn the_lambda_grammar_agrees_with_the_printer_on_generated_programs() {
    let strategy = arb_expr_over((0u64..100).prop_map(|n| n.to_string()));
    // `TestRunner::default()` leaves `Config::source_file` at `None`, so `FileFailurePersistence`
    // would warn "no source file known" and save nothing — a shrunk counterexample would print once
    // and then be forgotten. Set it the same way the `proptest!` macro does internally (see
    // `tests/generated.rs`), so a failure here persists to a `.proptest-regressions` file and replays
    // on the next run.
    let mut runner = TestRunner::new(ProptestConfig { source_file: Some(file!()), ..ProptestConfig::default() });
    let total = std::cell::Cell::new(0usize);
    let lowered = std::cell::Cell::new(0usize);
    let outcome = runner.run(&strategy, |src| {
        total.set(total.get() + 1);
        // `TestCaseError::fail` rather than `prop_assert!`, matching `tests/generated.rs`: that form
        // calls `compare_printed` a second time to build its message and reaches for `unwrap_err`
        // inside a macro-generated fn where clippy's in-tests exemption is not guaranteed to apply.
        let Some((text, want)) = printed_term(&src) else { return Ok(()) };
        lowered.set(lowered.get() + 1);
        if let Err(why) = compare_printed(&text, &want) {
            return Err(TestCaseError::fail(why));
        }
        Ok(())
    });
    let (total, lowered) = (total.get(), lowered.get());
    // Same caveat as the corpus leg's `eprintln!` above: written every run, but `cargo nextest`
    // discards a passing test's output, so this is not something a green run shows anyone.
    eprintln!("lambda generated leg: {lowered}/{total} generated mini-language programs lowered to λ");
    if let Err(why) = outcome {
        panic!("{why}");
    }
    // Deliberately loose, unlike the corpus leg's floor: tightening this to the measured rate would
    // record a rate against `arb_expr_over`'s own recursion parameters and arm set, and that
    // function's doc says not to do that without re-measuring every other caller that also records a
    // rate against it. `total / 2` is a sanity floor on THIS leg's lowering coverage, not a pin on the
    // generator's distribution.
    assert!(
        lowered >= total / 2,
        "only {lowered}/{total} generated programs lowered; the generated leg is not exercising λ"
    );
}
