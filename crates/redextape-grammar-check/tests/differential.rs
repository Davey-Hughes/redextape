#![cfg_attr(test, allow(clippy::pedantic))]

use redextape_grammar_check::{CORPUS, compare, compare_with};

#[test]
fn the_grammar_agrees_with_classify_source_on_every_corpus_program() {
    for (name, src) in CORPUS {
        if let Err(why) = compare(src) {
            panic!("`{name}` diverges:\n{why}");
        }
    }
}

/// The differential must be capable of failing. A grammar that agreed with nothing would pass a
/// comparison that silently compared nothing, and this repository has shipped a gate that could not
/// fail before — see the roadmap's citation-gate entries.
#[test]
fn the_comparison_can_fail() {
    // `@@@` is not lexable: `classify_source` recovers and classifies what it can while the grammar
    // produces ERROR nodes. Whatever the two do here, they must not agree silently.
    assert!(compare("let x = @@@;").is_err(), "the comparison must reject un-lexable input");
}

/// `the_comparison_can_fail` above only ever exercises the ERROR-node guard: for `let x = @@@;` the
/// two sides happen to agree on all four real spans, so `compare`'s own comparison — the per-index
/// mismatch loop and the `want.len() != got.len()` extra-spans block — never runs. Both are untested
/// by every other test in this crate: the shipped `HIGHLIGHTS` never disagrees with `classify_source`
/// anywhere the corpus or the generated programs reach. These two tests drive `compare_with` with a
/// deliberately wrong query, the same device `a_conflicting_query_is_rejected` (tests/captures.rs)
/// uses for `captures_with`, to pin that the comparison itself can fail, not just its guard.
///
/// This one drives the length branch. `(number) @number` alone is a strict SUBSET of the shipped
/// queries: over "1 + x" it captures only "1", never the operator or the identifier after it. The two
/// sides agree at index 0 (both say "1" is `Nat` at 0..1), so the per-index loop finds nothing before
/// the lengths are compared — `want` has 3 spans, `got` has 1, and the length check is what catches
/// the gap.
#[test]
fn compare_reports_the_extra_span_when_the_grammar_side_is_short() {
    let err = compare_with("(number) @number\n", "1 + x")
        .expect_err("a query that only captures numbers must not agree with classify_source's full token list");
    assert!(err.contains("more span(s)"), "expected the length-mismatch message, got: {err}");
    assert!(err.contains("\"+\""), "expected the message to name the extra span's text, got: {err}");
}

/// This one drives the per-index mismatch loop. The query below captures every token `"let x = 1;"`
/// needs — same five spans `classify_source` produces — but reclassifies the identifier `x` as
/// `@keyword` instead of `@variable`: same byte range, different `TokenClass`. Equal lengths rule out
/// the length branch above ever firing here, so this is the mismatch loop and nothing else.
#[test]
fn compare_reports_a_class_disagreement_at_a_shared_index() {
    let query = concat!(
        "\"let\" @keyword\n",
        "(identifier) @keyword\n",
        "\"=\" @operator\n",
        "(number) @number\n",
        "\";\" @punctuation.delimiter\n",
    );
    let err = compare_with(query, "let x = 1;")
        .expect_err("classify_source says `x` is Ident, the query says Keyword — they must not agree");
    assert!(err.contains("at index 1"), "expected the disagreement to land at index 1, got: {err}");
    assert!(err.contains("Ident"), "expected classify_source's class in the message, got: {err}");
    assert!(err.contains("Keyword"), "expected the grammar's (wrong) class in the message, got: {err}");
}
