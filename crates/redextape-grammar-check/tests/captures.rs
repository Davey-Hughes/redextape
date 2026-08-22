#![cfg_attr(test, allow(clippy::pedantic))]

use redextape_core::analysis::TokenClass;
use redextape_grammar_check::MINI;
use redextape_grammar_check::mini::CORPUS;

/// Every capture name any query emits must have a class. Adding a capture without deciding its class
/// would otherwise colour something in an editor that the differential then silently ignores.
///
/// PROMOTED to `Grammar::capture_map_is_total` — this test and λ's identically-named one in
/// `tests/lambda.rs` were duplicated verbatim, and neither reads anything grammar-specific beyond
/// `self`. See `src/grammar.rs` for the shared implementation, kept fallible there and panicking here
/// (`clippy.toml` exempts `unwrap`/`expect`/`panic` only inside `#[test]` fns and `#[cfg(test)]`
/// modules).
#[test]
fn the_capture_map_is_total_over_the_queries() {
    if let Err(why) = MINI.capture_map_is_total() {
        panic!("{why}");
    }
}

/// The map is a function: one capture name, one class.
///
/// PROMOTED to `Grammar::capture_map_has_no_duplicate_keys` — see the note on
/// `the_capture_map_is_total_over_the_queries` above; same duplication, same fix.
#[test]
fn the_capture_map_has_no_duplicate_keys() {
    if let Err(why) = MINI.capture_map_has_no_duplicate_keys() {
        panic!("{why}");
    }
}

/// `class_of` maps `TokenKind::True | TokenKind::False` to `Bool`, not `Keyword`, and the instinct
/// when writing a grammar is to capture them as `@keyword`. This is the pin on that trap.
#[test]
fn booleans_are_bool_and_keywords_are_keyword() {
    let got = MINI.captures("let x = true;").expect("the corpus query must run");
    let classes: Vec<TokenClass> = got.iter().map(|(_, c)| *c).collect();
    assert!(classes.contains(&TokenClass::Bool), "expected a Bool among {classes:?}");
    assert!(classes.contains(&TokenClass::Keyword), "expected a Keyword among {classes:?}");
}

/// `captures` collapses overlapping captures, so its output has one entry per byte range.
/// Pins what `captures` actually returns for one source, text and class together.
///
/// REPLACES A TAUTOLOGY. This test used to dedup the returned spans and assert the length was
/// unchanged — which a `BTreeMap` keyed by `(start, end)` guarantees before the test runs, so it
/// could not fail for any implementation that used one. Asserting on real content can.
#[test]
fn captures_pins_text_and_class_for_one_source() {
    let src = "let mut x = 1; // hi";
    let got = MINI.captures(src).expect("the corpus query must run");
    let pairs: Vec<(&str, TokenClass)> = got.iter().map(|(s, c)| (&src[s.start..s.end], *c)).collect();
    assert_eq!(
        pairs,
        vec![
            ("let", TokenClass::Keyword),
            ("mut", TokenClass::Keyword),
            ("x", TokenClass::Ident),
            ("=", TokenClass::Operator),
            ("1", TokenClass::Nat),
            (";", TokenClass::Punct),
            ("// hi", TokenClass::Comment),
        ]
    );
}

/// A row no query uses is a row a query edit left behind. Testable only because the tables are
/// per-grammar — design §5.1.
///
/// PROMOTED to `Grammar::every_capture_row_is_used` — same duplication and same fix as
/// `the_capture_map_is_total_over_the_queries` above.
#[test]
fn every_map_row_is_used_by_a_query() {
    if let Err(why) = MINI.every_capture_row_is_used() {
        panic!("{why}");
    }
}

/// The shipped queries overlap deliberately and must agree everywhere in the corpus.
///
/// PROMOTED to `Grammar::shipped_queries_never_disagree` — same duplication and same fix as
/// `the_capture_map_is_total_over_the_queries` above.
#[test]
fn the_shipped_queries_never_disagree() {
    if let Err(why) = MINI.shipped_queries_never_disagree(CORPUS) {
        panic!("{why}");
    }
}

/// THE COLLAPSE IS ONLY SOUND BECAUSE OVERLAPPING CAPTURES AGREE, so the check that they do must be
/// shown capable of failing. `@variable` projects to `Ident` and `@operator` to `Operator`, so this
/// query captures every identifier as two different classes at one byte range.
///
/// **NOT PROMOTED, unlike the five checks above.** The conflicting query this builds must name
/// capture rows that exist in *this* grammar's table — `@variable`/`@operator` here, but
/// `@variable.parameter`/`@variable` for λ (see `tests/lambda.rs`'s copy) — so a grammar-agnostic
/// version would have no query to hand it. This one legitimately stays per-grammar.
#[test]
fn a_conflicting_query_is_rejected() {
    let conflicting = "(identifier) @variable\n(identifier) @operator\n";
    let err = MINI
        .captures_with(conflicting, "let x = 1;")
        .expect_err("two captures projecting to different classes must not be collapsed silently");
    assert!(err.contains("disagree"), "the message must say what happened, got: {err}");
}

/// The mini-language's half of the pattern-coverage guard, kept only because running it showed every
/// one of its patterns already fires over `CORPUS` — verified, not assumed. If a future edit to
/// either `CORPUS` or this grammar's `highlights.scm` opens a gap, this is deliberately where it
/// fails: that would be a finding about an already-merged pair, and reporting it rather than quietly
/// adding a corpus entry is the point.
#[test]
fn every_mini_query_pattern_fires_over_the_corpus() {
    if let Err(why) = MINI.every_query_pattern_fires(CORPUS) {
        panic!("{why}");
    }
}
