#![cfg_attr(test, allow(clippy::pedantic))]

use proptest::prelude::*;
use proptest::test_runner::TestRunner;
use redextape_core::analysis::TokenClass;
use redextape_grammar_check::TM;
use redextape_grammar_check::tm::{
    CORPUS, HEADERED_CORPUS, compare_printed, printed_machine, printed_machine_with_header,
};
use redextape_test_support::arb_expr_over;

/// Every capture name any query emits must have a class.
///
/// PROMOTED to `Grammar::capture_map_is_total` in PR 2, specifically so this grammar would call it
/// rather than become a third verbatim copy. See `src/grammar.rs`.
#[test]
fn the_capture_map_is_total_over_the_queries() {
    if let Err(why) = TM.capture_map_is_total() {
        panic!("{why}");
    }
}

/// The map is a function: one capture name, one class.
#[test]
fn the_capture_map_has_no_duplicate_keys() {
    if let Err(why) = TM.capture_map_has_no_duplicate_keys() {
        panic!("{why}");
    }
}

/// A row no query uses is a row a query edit left behind. Testable only because the tables are
/// per-grammar — design §5.1.
#[test]
fn every_map_row_is_used_by_a_query() {
    if let Err(why) = TM.every_capture_row_is_used() {
        panic!("{why}");
    }
}

/// `captures` collapses overlapping captures, so its output has one entry per byte range.
///
/// **TM's QUERIES ARE WRITTEN NEVER TO OVERLAP AT ALL**, which is a stronger position than either
/// sibling's. Every name in this form is one `identifier` token and the queries tell them apart by
/// FIELD, so `state s:` matches only the `name:` pattern and `goto s` only the `target:` one. There is
/// no catch-all `(identifier) @variable` to collide with anything — see
/// `a_conflicting_query_is_rejected` for what adding one would do.
#[test]
fn the_shipped_queries_never_disagree() {
    if let Err(why) = TM.shipped_queries_never_disagree(CORPUS) {
        panic!("{why}");
    }
}

/// Pins what `captures` returns for one headered machine, text and class together, as the FULL
/// ORDERED sequence — the same standard `print_tm_mapped_agrees_and_classifies_states_symbols_and_
/// moves` holds the printer to in `tm/syntax.rs`.
///
/// **THIS IS THE ONE TEST THAT WOULD CATCH A WHOLE CLASS BEING SILENTLY DROPPED.** All nine classes
/// the headered printer emits appear below. The two that only a headered file can reach are `Comment`
/// (`; reg`) and `Ident`, and `Ident` arrives twice from two different captures — `@variable` for
/// `encoding`'s operand and `@type` for `result`'s — which is why both rows must exist in the map even
/// though they project to the same class.
///
/// **`#1#` IS ONE SPAN AND `*` IS ANOTHER, AND THAT ASYMMETRY IS THE POINT.** `write_header` pushes a
/// single `TapeSymbol` span for a whole packed cell run; `write_syms` pushes one per symbol inside
/// `[..]`. Same-looking text, two span shapes, which is why the grammar has both `cells` and `symbol`.
#[test]
fn captures_pins_text_and_class_for_a_headered_machine() {
    let src = "tapes 1\nstart s\nencoding unary\nresult Nat\ntape 0 #1#  ; reg\n\nstate s:\n  [*] -> write [_], move [R], goto s\n";
    let got = TM.captures(src).expect("the query must run");
    let pairs: Vec<(&str, TokenClass)> = got.iter().map(|(s, c)| (&src[s.start..s.end], *c)).collect();
    assert_eq!(
        pairs,
        vec![
            ("tapes", TokenClass::Keyword),
            ("1", TokenClass::Nat),
            ("start", TokenClass::Keyword),
            ("s", TokenClass::StateName),
            ("encoding", TokenClass::Keyword),
            ("unary", TokenClass::Ident),
            ("result", TokenClass::Keyword),
            ("Nat", TokenClass::Ident),
            ("tape", TokenClass::Keyword),
            ("0", TokenClass::Nat),
            ("#1#", TokenClass::TapeSymbol),
            ("; reg", TokenClass::Comment),
            ("state", TokenClass::Keyword),
            ("s", TokenClass::Label),
            (":", TokenClass::Punct),
            ("[", TokenClass::Punct),
            ("*", TokenClass::TapeSymbol),
            ("]", TokenClass::Punct),
            ("->", TokenClass::Punct),
            ("write", TokenClass::Keyword),
            ("[", TokenClass::Punct),
            ("_", TokenClass::TapeSymbol),
            ("]", TokenClass::Punct),
            (",", TokenClass::Punct),
            ("move", TokenClass::Keyword),
            ("[", TokenClass::Punct),
            ("R", TokenClass::Move),
            ("]", TokenClass::Punct),
            (",", TokenClass::Punct),
            ("goto", TokenClass::Keyword),
            ("s", TokenClass::StateName),
        ]
    );
}

/// THE COLLAPSE IS ONLY SOUND BECAUSE OVERLAPPING CAPTURES AGREE, so the check that they do must be
/// shown capable of failing.
///
/// The conflicting query below is exactly the edit a future reader is most likely to make to this
/// grammar: adding a broad `(identifier) @variable` catch-all "so unnamed identifiers still get a
/// colour". Because every name here is one `identifier` token, that catch-all lands on the SAME byte
/// range as `(state name: ...) @label` and asks for `Ident` where the printer says `Label`.
///
/// **NOT PROMOTED, unlike the checks above**: the query has to name capture rows that exist in *this*
/// grammar's table, so a grammar-agnostic version would have no query to hand it.
#[test]
fn a_conflicting_query_is_rejected() {
    let conflicting = "(state name: (identifier) @label)\n(identifier) @variable\n";
    let err = TM
        .captures_with(conflicting, "tapes 1\nstart s\n\nstate s: accept\n")
        .expect_err("a state name captured as both Label and Ident must not be collapsed silently");
    assert!(err.contains("disagree"), "the message must say what happened, got: {err}");
}

/// `Grammar::parse` succeeds even on a syntax error — it returns a `Tree` CONTAINING `ERROR`/`MISSING`
/// nodes — and `captures` never inspects them, so a corpus entry that stopped parsing cleanly would
/// still pass every capture check above with a short-but-consistent list.
#[test]
fn every_corpus_program_parses_without_error_nodes() {
    if let Err(why) = TM.every_corpus_program_parses_without_error_nodes(CORPUS) {
        panic!("{why}");
    }
}

/// TM's mandatory half of `every_query_pattern_fires`. It matters more here than for either sibling:
/// TM has the largest query file of the three, and several of its patterns — `encoding`'s operand,
/// `result`'s operand, a `tape` line's packed run, a comment — are reachable ONLY from a headered
/// file. A `CORPUS` of header-less machines would leave four patterns with zero coverage while every
/// other test in this file stayed green.
#[test]
fn every_tm_query_pattern_fires_over_the_corpus() {
    if let Err(why) = TM.every_query_pattern_fires(CORPUS) {
        panic!("{why}");
    }
}

/// The corpus is hand-written here (unlike the differential's, which is printed), so nothing but this
/// checks that the strings are TM at all. `parse_tm_full` is the authority; if it rejects an entry,
/// that entry is not evidence about anything.
///
/// This is the analogue of λ's `parse_lambda_succeeds_on_every_backslash_spelled_corpus_entry`, and
/// it exists for the same reason: design §6.3's residue — a whole-line comment, and a trailing comment
/// on a line the printer never writes one on — has no printer to be compared against, so "the grammar
/// accepts it" and "the authority accepts it" have to be checked as two separate facts.
#[test]
fn parse_tm_accepts_every_corpus_entry() {
    for (name, src) in CORPUS {
        let (machine, diagnostics) = redextape_core::tm::parse_tm(src);
        assert!(diagnostics.is_empty(), "`{name}` must parse under the real authority cleanly, got: {diagnostics:?}");
        assert!(machine.is_some(), "`{name}` produced no machine despite no diagnostics");
    }
}

/// Design §6.3's residue, pinned by name so a corpus edit cannot quietly drop it. These are the
/// comment positions NO printer can produce — a whole-line comment, and a trailing comment on a line
/// that is not a named `tape` line — so they have no differential authority and rest on
/// `tree-sitter test` plus `parse_tm_accepts_every_corpus_entry` above. That is weaker than the
/// differential, and saying so is the point.
#[test]
fn the_corpus_carries_the_comment_positions_no_printer_emits() {
    let whole_line = CORPUS.iter().filter(|(_, s)| s.lines().any(|l| l.trim_start().starts_with(';'))).count();
    let trailing_off_a_tape_line = CORPUS
        .iter()
        .filter(|(_, s)| {
            s.lines().any(|l| {
                let t = l.trim_start();
                !t.starts_with(';') && !t.starts_with("tape ") && t.contains(';')
            })
        })
        .count();
    assert!(whole_line > 0, "no corpus entry carries a whole-line comment; §6.3's residue is unchecked");
    assert!(
        trailing_off_a_tape_line > 0,
        "no corpus entry carries a trailing comment off a `tape` line; §6.3's residue is unchecked"
    );
}

/// The headered leg — **the only corpus in this crate that reaches `Comment` and `Ident`**, and the
/// reason design §6.3's gap is much narrower than that section claimed before PR 3's survey.
///
/// `HEADERED_CORPUS` is FIXED rather than generated because `printed_machine_with_header` simulates;
/// see its doc for the three bounds that make that safe. The comment floor is what stops a future
/// edit from quietly dropping the `Binary` entries and leaving this leg comparing nine classes it no
/// longer reaches: `Unary` yields one `Comment` span per entry and `Binary` two, so the measured
/// total over this list is 8.
#[test]
fn the_tm_grammar_agrees_with_the_headered_printer() {
    let mut comments = 0;
    let mut idents = 0;
    for (src, kind) in HEADERED_CORPUS {
        let (text, want) = printed_machine_with_header(src, *kind)
            .unwrap_or_else(|| panic!("`{src}` under {kind:?} must run and print"));
        comments += want.iter().filter(|(_, c)| *c == TokenClass::Comment).count();
        idents += want.iter().filter(|(_, c)| *c == TokenClass::Ident).count();
        if let Err(why) = compare_printed(&text, &want) {
            panic!("`{src}` under {kind:?} diverged:\n{why}");
        }
    }
    assert_eq!(comments, 8, "the headered corpus must reach Comment; Unary yields 1 per entry and Binary 2");
    assert_eq!(idents, 2 * HEADERED_CORPUS.len(), "every headered file carries exactly `encoding` and `result`");
}

/// The header-less leg, generated.
///
/// **`cases` IS SET EXPLICITLY AND THE NUMBER IS A MEASUREMENT, NOT A DEFAULT** — design §11.5. One
/// printed TM machine averages 18,905 bytes and 6,865 spans against λ's 912 and 637, so proptest's
/// default 256 would have this leg parsing ~4.8 MB and comparing ~2.0M spans every run.
///
/// **AT 32 THIS LEG COMPARES 282,006 SPANS IN 0.74 s**, measured, which is already 1.7x what λ's
/// 256-case leg compares (163K) and takes the whole crate from 0.600 s to 0.742 s. Raising it is
/// affordable and was deliberately not done: `arb_expr_over` is five arms over numeric leaves —
/// design §11.3's "depth on a narrow shape, not breadth" — so a 64th case of the same shape buys
/// very little that the 32nd did not, and the hand-written `CORPUS` and `HEADERED_CORPUS` are where
/// the structurally interesting constructs actually live. If you raise it, raise it with a new
/// measurement rather than on the theory that more is better.
///
/// Driven through `TestRunner` directly rather than the `proptest!` macro so the lowering pass rate
/// can be logged once after every case has run — the same reason λ's generated leg does.
///
/// The pass rate is logged because design §7 asks for it. **Expect 100%**: measured over 128 samples
/// at both leaf ranges in use, `lower_asm` refused nothing. The guard is real and currently idle, and
/// §11.5 records that the risk §7 named is not the one that bites.
#[test]
fn the_tm_grammar_agrees_with_the_printer_on_generated_programs() {
    let strategy = arb_expr_over((0u64..100).prop_map(|n| n.to_string()));
    // `source_file` set the way the `proptest!` macro sets it internally, so a shrunk counterexample
    // persists to `.proptest-regressions` and replays instead of printing once and being forgotten.
    let mut runner =
        TestRunner::new(ProptestConfig { cases: 32, source_file: Some(file!()), ..ProptestConfig::default() });
    let total = std::cell::Cell::new(0usize);
    let lowered = std::cell::Cell::new(0usize);
    let spans = std::cell::Cell::new(0usize);
    let outcome = runner.run(&strategy, |src| {
        total.set(total.get() + 1);
        let Some((text, want)) = printed_machine(&src) else { return Ok(()) };
        lowered.set(lowered.get() + 1);
        spans.set(spans.get() + want.len());
        if let Err(why) = compare_printed(&text, &want) {
            return Err(TestCaseError::fail(why));
        }
        Ok(())
    });
    let (total, lowered, spans) = (total.get(), lowered.get(), spans.get());
    // Written every run, but `cargo nextest` discards a passing test's output, so this is not
    // something a green run shows anyone — the floor below is what catches a regression.
    eprintln!("tm generated leg: {lowered}/{total} programs lowered, {spans} spans compared");
    if let Err(why) = outcome {
        panic!("{why}");
    }
    assert!(lowered >= total / 2, "only {lowered}/{total} generated programs lowered; the leg is not exercising TM");
}

/// The comparison must be capable of failing — the standard PR 1 and PR 2 both met, and PR 1's review
/// found `compare_classified` shipped entirely untested.
///
/// **THIS FIRES THE LENGTH BRANCH, NOT THE PER-INDEX ONE, AND THE CHOICE IS DELIBERATE.** A subset
/// query like `["[" "]"] @punctuation.bracket` would diverge at index 0 (`tapes`/`Keyword` against
/// `[`/`Punct`) and never reach the length comparison. `(comment) @comment` over HEADER-LESS printed
/// text captures nothing at all — `print_tm_mapped` writes no comment, which is the true half of what
/// design §6.3 originally claimed — so `got` is empty, the per-index loop runs zero times, and every
/// one of `want`'s spans becomes an extra on the authority side. The length branch is what catches a
/// grammar that silently captures too little, so it is the branch worth proving can fire.
#[test]
fn the_tm_comparison_can_fail() {
    let (text, want) = printed_machine("1 + 2").expect("this program lowers");
    assert!(!want.is_empty(), "the fixture must produce spans, or this test proves nothing");
    let err = redextape_grammar_check::compare_classified(&TM, "(comment) @comment", &text, &want)
        .expect_err("a query capturing nothing must not compare equal to a full classification");
    assert!(err.contains("more span(s)"), "expected a length mismatch, got: {err}");
}

/// TM's printer spans EVERY token it writes, separators included, so the grammar's captures must be
/// total over its own tokens — there is no unclassified text for a query to legitimately miss.
///
/// `compare_printed` already enforces this implicitly through its length check. This names the
/// property, so a future query edit that drops a pattern fails with a legible reason rather than as
/// an off-by-N span count buried in a generated case.
#[test]
fn every_printed_token_is_captured() {
    for (src, kind) in HEADERED_CORPUS {
        let (text, want) = printed_machine_with_header(src, *kind).expect("runs and prints");
        let got = TM.captures(&text).expect("the query must run");
        assert_eq!(
            got.len(),
            want.len(),
            "`{src}` under {kind:?}: the printer wrote {} spans and the queries captured {} — TM has no \
             unclassified tokens, so any difference is a query that does not cover one",
            want.len(),
            got.len()
        );
    }
}
