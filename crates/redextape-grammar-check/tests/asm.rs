#![cfg_attr(test, allow(clippy::pedantic))]

use proptest::prelude::*;
use proptest::test_runner::{TestCaseError, TestRunner};
use redextape_core::analysis::TokenClass;
use redextape_grammar_check::ASM;
use redextape_grammar_check::asm::{
    CORPUS, FIXED_CORPUS, compare_printed, printed_program, printed_program_with_header,
};
use redextape_test_support::arb_expr_over;
use tree_sitter::{Query, QueryCursor, StreamingIterator};

/// Byte ranges captured under capture NAME `name`, read from the SHIPPED `ASM.highlights` file —
/// not a literal copy of its query text — so that editing the shipped file moves this helper's
/// answer. That is the whole point: a query hardcoded in the test would pin only that two patterns
/// disagree inside this file, and could never notice a swap in the file it claims to guard.
// This helper is not itself a `#[test]` fn, so it falls outside `clippy.toml`'s
// `allow-expect-in-tests` (that exemption reaches only code lexically inside a `#[test]` function
// or a `#[cfg(test)]` module) — allowed here directly rather than by widening the file-level
// attribute above, which every call site in this file still respects.
#[allow(clippy::expect_used)]
fn ranges_by_capture(src: &str, name: &str) -> Vec<(usize, usize)> {
    let q = Query::new(&ASM.language(), ASM.highlights).expect("the shipped queries must compile");
    let names = q.capture_names().to_vec();
    let tree = ASM.parse(src).expect("the fixture must parse");
    let mut cursor = QueryCursor::new();
    let mut out = Vec::new();
    let mut it = cursor.matches(&q, tree.root_node(), src.as_bytes());
    while let Some(m) = it.next() {
        for c in m.captures {
            if names[c.index as usize] == name {
                out.push((c.node.start_byte(), c.node.end_byte()));
            }
        }
    }
    // COLLAPSES EXACT-DUPLICATE `(start, end)` TUPLES ONLY, never duplicate TEXT: two distinct
    // ranges holding the same name both survive, which is why the reference list below legitimately
    // carries `"else0"` twice. That is safe only because `@label.reference`'s two patterns —
    // `branch_instruction target:` and `jump_instruction target:` — are structurally mutually
    // exclusive, so no single range is ever captured twice under one name. A future overlapping
    // pattern under one capture name would be masked here silently.
    out.sort_unstable();
    out.dedup();
    out
}

#[test]
fn the_capture_map_is_total_over_the_queries() {
    if let Err(why) = ASM.capture_map_is_total() {
        panic!("{why}");
    }
}

#[test]
fn the_capture_map_has_no_duplicate_keys() {
    if let Err(why) = ASM.capture_map_has_no_duplicate_keys() {
        panic!("{why}");
    }
}

#[test]
fn every_map_row_is_used_by_a_query() {
    if let Err(why) = ASM.every_capture_row_is_used() {
        panic!("{why}");
    }
}

#[test]
fn the_shipped_queries_never_disagree() {
    if let Err(why) = ASM.shipped_queries_never_disagree(CORPUS) {
        panic!("{why}");
    }
}

#[test]
fn every_corpus_program_parses_without_error_nodes() {
    if let Err(why) = ASM.every_corpus_program_parses_without_error_nodes(CORPUS) {
        panic!("{why}");
    }
}

/// Asm's mandatory half of `every_query_pattern_fires`. Three of the ten patterns — `result`'s
/// keyword, `result`'s operand and `@comment` — are unreachable from a HEADER-LESS listing, and
/// `@comment` is unreachable from any printer at all, so a `CORPUS` of bare listings would leave
/// them at zero coverage with every other test in this file still green.
#[test]
fn every_asm_query_pattern_fires_over_the_corpus() {
    if let Err(why) = ASM.every_query_pattern_fires(CORPUS) {
        panic!("{why}");
    }
}

/// THE COLLAPSE IN `captures` IS ONLY SOUND BECAUSE OVERLAPPING CAPTURES AGREE, so the check that
/// they do must be shown capable of failing. A future reader adding a catch-all to this grammar
/// would most likely write a broad `(identifier) @variable` — "so unnamed identifiers still get a
/// colour" — since that is the bare capture TM's sibling test uses for exactly this edit. The
/// conflicting query below uses `@type` instead, standing in for that same class of edit: either
/// way, a label name is an `identifier`, so the catch-all lands on the same byte range as
/// `(label name: ...) @label`.
///
/// **`@type`, because `@variable` cannot reach the branch under test here.** TM's `CAPTURE_CLASSES`
/// has a `variable` row (`encoding`'s operand), so TM's stray `@variable` there is a live capture
/// that disagrees with `@label`. Asm has no bare `variable` row — only `variable.builtin`, a
/// distinct capture name — so the same literal query would fail `captures_with` on the missing row
/// before ever reaching the disagreement it is meant to demonstrate. `@type` is the row this
/// grammar actually has that projects to `Ident`, so it lands on `(label name: ...) @label`'s span
/// and asks for `Ident` where the printer says `Label` — keeping the property under test, two
/// captures on one span disagreeing on class, genuinely reachable here.
#[test]
fn a_conflicting_query_is_rejected() {
    let conflicting = "(label name: (identifier) @label)\n(identifier) @type\n";
    let err = ASM
        .captures_with(conflicting, "halt\nfoo:\n")
        .expect_err("a label name captured as both Label and Ident must not be collapsed silently");
    assert!(err.contains("disagree"), "the message must say what happened, got: {err}");
}

/// The headered leg — **the only corpus in this crate that reaches `Keyword` and `Ident` for asm**,
/// and the one that reaches every mnemonic. `FIXED_CORPUS` is fixed rather than generated because
/// `arb_expr_over` is five arms over numeric leaves: it never produces a list operation, a call or
/// a mutable capture, so it reaches nine of the twenty-four mnemonics and no more.
#[test]
fn the_asm_grammar_agrees_with_the_headered_printer() {
    let mut keywords = 0;
    let mut idents = 0;
    for src in FIXED_CORPUS {
        let (text, want) =
            printed_program_with_header(src).unwrap_or_else(|| panic!("`{src}` must lower and print with a header"));
        keywords += want.iter().filter(|(_, c)| *c == TokenClass::Keyword).count();
        idents += want.iter().filter(|(_, c)| *c == TokenClass::Ident).count();
        if let Err(why) = compare_printed(&text, &want) {
            panic!("`{src}` diverged:\n{why}");
        }
    }
    assert_eq!(keywords, FIXED_CORPUS.len(), "every headered listing carries exactly one `result`");
    assert_eq!(idents, FIXED_CORPUS.len(), "every headered listing carries exactly one result type");
}

/// **The whole mnemonic table, reached by LOWERING AND PRINTING rather than by constructing `Instr`
/// values — the only route in this tree that does.** Not the only check that reaches all 24:
/// `asm_syntax.rs` covers the same table by construction three times over, in
/// `table_agrees_with_the_printer`, `every_table_mnemonic_builds_an_instruction` and
/// `the_table_has_one_row_per_mnemonic_and_no_duplicates`. What is unique here is that the mnemonics
/// arrive through real programs, so this is a claim about text an editor would actually be handed.
/// `asm_roundtrip.rs`'s `the_demo_corpus_covers_thirteen_of_the_sixteen_instr_variants` asserts 13
/// of 16 `Instr` variants, and PR 2's roadmap entry records the missing three as structural to that
/// file's `lower` helper. Lowering through `lower_program`'s template instead reaches all of them.
///
/// Counted from the printed TEXT rather than by matching on `Instr`, so this test needs nothing
/// `pub(super)` out of `redextape-core` and stays a claim about what an editor would actually see.
/// The list is written out because the printer's table (`instr_parts` plus `bin_mnemonic`) is not
/// visible from this crate; a wrong entry here fails loudly rather than silently shrinking the set.
#[test]
fn the_fixed_corpus_reaches_every_mnemonic() {
    const ALL: &[&str] = &[
        "add", "box", "box_get", "box_set", "call", "cmpeq", "cmpge", "cmpgt", "cmple", "cmplt", "cmpne", "cons",
        "halt", "head", "isempty", "jmp", "jz", "li", "mov", "mul", "nil", "ret", "sub", "tail",
    ];
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for src in FIXED_CORPUS {
        let (text, _) = printed_program_with_header(src).expect("lowers and prints");
        for line in text.lines() {
            let t = line.trim_start();
            if t.ends_with(':') || t.starts_with("result") || t.is_empty() {
                continue;
            }
            if let Some(m) = t.split(char::is_whitespace).next()
                && !m.is_empty()
            {
                seen.insert(m.to_string());
            }
        }
    }
    let want: std::collections::BTreeSet<String> = ALL.iter().map(|s| (*s).to_string()).collect();
    assert_eq!(seen, want, "the fixed corpus must print every one of the 24 mnemonics");
}

/// The header-less leg, generated.
///
/// **`cases` IS SET EXPLICITLY AND 256 IS A MEASUREMENT, NOT AN INHERITED DEFAULT.** One printed
/// asm listing averages 146 bytes and 36 spans against λ's 912/637 and TM's 18,905/6,865. Both asm
/// figures are FLOORS of a measured 256-case total rather than figures a total can be derived from,
/// so multiplying either out undercounts. The measured span total is roughly 9,000 and moves with
/// the seed: fifteen runs observed on 2026-08-26 ranged from 8,384 to 9,620. Even at the top of that
/// range this leg compares less than a sixteenth of what λ's 256-case leg does (163K) and less than
/// a twenty-ninth of TM's 32-case leg (282,006). This is the cheapest of the four corpora; if you
/// lower it, say why.
///
/// **Reproducible on demand**: this is what `arb_expr_over` at this leaf range, through
/// `printed_program`, actually produces at 256 cases, and the `eprintln!` below prints the live
/// span total on every run.
///
/// Driven through `TestRunner` directly rather than the `proptest!` macro so the lowering pass rate
/// can be logged once after every case has run — the same reason λ's and TM's generated legs do.
/// **Expect 100%**: measured over 64 samples at this leaf range, `lower_asm` refused nothing.
#[test]
fn the_asm_grammar_agrees_with_the_printer_on_generated_programs() {
    let strategy = arb_expr_over((0u64..100).prop_map(|n| n.to_string()));
    let mut runner =
        TestRunner::new(ProptestConfig { cases: 256, source_file: Some(file!()), ..ProptestConfig::default() });
    let total = std::cell::Cell::new(0usize);
    let lowered = std::cell::Cell::new(0usize);
    let spans = std::cell::Cell::new(0usize);
    let outcome = runner.run(&strategy, |src| {
        total.set(total.get() + 1);
        let Some((text, want)) = printed_program(&src) else { return Ok(()) };
        lowered.set(lowered.get() + 1);
        spans.set(spans.get() + want.len());
        if let Err(why) = compare_printed(&text, &want) {
            return Err(TestCaseError::fail(why));
        }
        Ok(())
    });
    let (total, lowered, spans) = (total.get(), lowered.get(), spans.get());
    eprintln!("asm generated leg: {lowered}/{total} programs lowered, {spans} spans compared");
    if let Err(why) = outcome {
        panic!("{why}");
    }
    assert!(lowered >= total / 2, "only {lowered}/{total} generated programs lowered; the leg is not exercising asm");
}

/// The comparison must be capable of failing — the standard every PR in the tree-sitter slice has
/// met, and PR 1's review found `compare_classified` had shipped entirely untested.
///
/// **THIS FIRES THE LENGTH BRANCH, NOT THE PER-INDEX ONE, AND THE CHOICE IS DELIBERATE.** A subset
/// query like `[":" ","] @punctuation.delimiter` would diverge at index 0 (the mnemonic against the
/// first `,`) and never reach the length comparison. `(comment) @comment` over printed text
/// captures nothing at all — no asm printer writes a comment — so `got` is empty, the per-index
/// loop runs zero times, and every one of `want`'s spans becomes an extra on the authority side.
/// The length branch is what catches a grammar that silently captures too little.
#[test]
fn the_asm_comparison_can_fail() {
    let (text, want) = printed_program("1 + 2").expect("this program lowers");
    assert!(!want.is_empty(), "the fixture must produce spans, or this test proves nothing");
    let err =
        redextape_grammar_check::compare_classified(&redextape_grammar_check::ASM, "(comment) @comment", &text, &want)
            .expect_err("a query capturing nothing must not compare equal to a full classification");
    assert!(err.contains("more span(s)"), "expected a length mismatch, got: {err}");
}

/// Asm's printer spans EVERY non-whitespace byte it writes, separators included, so the grammar's
/// captures must be total over its own tokens — there is no unclassified text a query could
/// legitimately miss. `compare_printed` already enforces this implicitly through its length check;
/// this names the property, so a future query edit that drops a pattern fails with a legible reason
/// rather than as an off-by-N span count buried in a generated case.
#[test]
fn every_printed_token_is_captured() {
    for src in FIXED_CORPUS {
        let (text, want) = printed_program_with_header(src).expect("lowers and prints");
        let got = redextape_grammar_check::ASM.captures(&text).expect("the query must run");
        assert_eq!(
            got.len(),
            want.len(),
            "`{src}`: the printer wrote {} spans and the queries captured {} — asm has no unclassified tokens, so \
             any difference is a query that does not cover one",
            want.len(),
            got.len()
        );
    }
}

/// The hand-written `CORPUS` is the only corpus in this module nothing else vouches for — the
/// differential's two are printed, so they are asm by construction. `parse_asm_full` is the
/// authority; if it rejects an entry, that entry is not evidence about anything.
#[test]
fn parse_asm_accepts_every_corpus_entry() {
    for (name, src) in CORPUS {
        let doc = redextape_core::tm::parse_asm_full(src);
        let (prog, diagnostics) = (doc.program, doc.diagnostics);
        assert!(diagnostics.is_empty(), "`{name}` must parse under the real authority cleanly, got: {diagnostics:?}");
        assert!(prog.is_some(), "`{name}` produced no program despite no diagnostics");
    }
}

/// The residue, pinned by name so a corpus edit cannot quietly drop it. **No asm printer writes a
/// `;` at all** — `emit --lang asm` prepends `ASM_PREAMBLE`, but that is the CLI, not the printer —
/// so `@comment` has no differential authority whatsoever and rests on `tree-sitter test` plus
/// `parse_asm_accepts_every_corpus_entry` above.
#[test]
fn the_corpus_carries_the_comment_positions_no_printer_emits() {
    let whole_line = CORPUS.iter().filter(|(_, s)| s.lines().any(|l| l.trim_start().starts_with(';'))).count();
    let trailing = CORPUS
        .iter()
        .filter(|(_, s)| {
            s.lines().any(|l| {
                let t = l.trim_start();
                !t.starts_with(';') && t.contains(';')
            })
        })
        .count();
    assert!(whole_line > 0, "no corpus entry carries a whole-line comment; the residue is unchecked");
    assert!(trailing > 0, "no corpus entry carries a trailing comment; the residue is unchecked");
}

/// **THE ONE HOLE `compare_classified` STRUCTURALLY CANNOT SEE.** `@label` and `@label.reference`
/// both project to `TokenClass::Label` here — unlike TM, where the printer distinguishes `Label`
/// from `StateName` and a swap fails the differential immediately. So this reads the two capture
/// names apart from the SHIPPED `ASM.highlights` file, through `ranges_by_capture`, and asserts the
/// byte ranges each one lands on: a declaration capture that started matching jump targets, or the
/// reverse, changes these lists and nothing else in this crate would notice. Asserting on text and
/// ranges rather than on `TokenClass` is the point — the class is exactly what the two captures
/// share, so a class-level assertion would be blind to the same swap `compare_classified` is.
#[test]
fn each_label_capture_lands_on_its_own_positions() {
    let src = "    jz\tr0, else0\n    jmp\tendif1\nelse0:\n    call\telse0\nendif1:\n    halt\n";

    let decls = ranges_by_capture(src, "label");
    let decl_text: Vec<&str> = decls.iter().map(|(s, e)| &src[*s..*e]).collect();
    assert_eq!(decl_text, vec!["else0", "endif1"], "@label must land on declarations only");

    let refs = ranges_by_capture(src, "label.reference");
    let ref_text: Vec<&str> = refs.iter().map(|(s, e)| &src[*s..*e]).collect();
    assert_eq!(ref_text, vec!["else0", "endif1", "else0"], "@label.reference must land on targets only");

    // The two sets are disjoint by BYTE RANGE, which is the property the class equality hides.
    let decl_spans: std::collections::BTreeSet<(usize, usize)> = decls.iter().copied().collect();
    for (s, e) in &refs {
        assert!(!decl_spans.contains(&(*s, *e)), "a target at {s}..{e} was also captured as a declaration");
    }
}
