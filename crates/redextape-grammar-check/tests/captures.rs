#![cfg_attr(test, allow(clippy::pedantic))]

use redextape_core::analysis::TokenClass;
use redextape_grammar_check::{CAPTURE_CLASSES, CORPUS, captures, captures_with, class_for, query_capture_names};

/// Every capture name any query emits must have a class. Adding a capture without deciding its class
/// would otherwise colour something in an editor that the differential then silently ignores.
#[test]
fn the_capture_map_is_total_over_the_queries() {
    for name in query_capture_names().expect("highlights.scm must compile") {
        assert!(class_for(&name).is_some(), "`@{name}` appears in highlights.scm with no entry in CAPTURE_CLASSES");
    }
}

/// The map is a function: one capture name, one class.
#[test]
fn the_capture_map_has_no_duplicate_keys() {
    let mut seen = std::collections::BTreeSet::new();
    for (name, _) in CAPTURE_CLASSES {
        assert!(seen.insert(*name), "`@{name}` appears twice in CAPTURE_CLASSES");
    }
}

/// `class_of` maps `TokenKind::True | TokenKind::False` to `Bool`, not `Keyword`, and the instinct
/// when writing a grammar is to capture them as `@keyword`. This is the pin on that trap.
#[test]
fn booleans_are_bool_and_keywords_are_keyword() {
    let got = captures("let x = true;").expect("the corpus query must run");
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
    let got = captures(src).expect("the corpus query must run");
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
#[test]
fn every_map_row_is_used_by_a_query() {
    let used = query_capture_names().expect("highlights.scm must compile");
    for (name, _) in CAPTURE_CLASSES {
        assert!(used.iter().any(|u| u == name), "`@{name}` is in CAPTURE_CLASSES but no query uses it");
    }
}

/// The shipped queries overlap deliberately and must agree everywhere in the corpus.
#[test]
fn the_shipped_queries_never_disagree() {
    for (name, src) in CORPUS {
        if let Err(why) = captures(src) {
            panic!("`{name}`: {why}");
        }
    }
}

/// THE COLLAPSE IS ONLY SOUND BECAUSE OVERLAPPING CAPTURES AGREE, so the check that they do must be
/// shown capable of failing. `@variable` projects to `Ident` and `@operator` to `Operator`, so this
/// query captures every identifier as two different classes at one byte range.
#[test]
fn a_conflicting_query_is_rejected() {
    let conflicting = "(identifier) @variable\n(identifier) @operator\n";
    let err = captures_with(conflicting, "let x = 1;")
        .expect_err("two captures projecting to different classes must not be collapsed silently");
    assert!(err.contains("disagree"), "the message must say what happened, got: {err}");
}
