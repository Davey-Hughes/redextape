//! Six of the seven properties design §10 holds the formatter to: idempotence, comment preservation,
//! semantics, reparses, width, and anchoring. The seventh — source-order, the printer's visit order —
//! lives in `printer.rs`'s inline test module, because asserting it needs the printer's own traversal
//! and a second one written here could only disagree with the first.

// Test target: a fixture that fails to parse IS the failure this file reports. The `allow-*-in-tests`
// keys in `clippy.toml` reach `#[test]` functions and `#[cfg(test)]` modules, not the free helpers
// below, so the exemption is stated per target — the same note `tests/common/mod.rs` carries.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fmt::Write as _;

use proptest::prelude::*;
use redextape_core::analysis::{TokenClass, classify_source};
use redextape_core::printer::MAX_WIDTH;
use redextape_core::span::Span;
use redextape_core::value::format_value;
use redextape_core::{format, run};
use redextape_test_support::arb_expr_over;

/// Programs exercising every construct the printer prints, each with trivia in a different place.
const CORPUS: &[&str] = &[
    "1",
    "1 + 2 * 3",
    "(1 + 2) * 3",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 3; while x > 0 { x = x - 1; } x",
    "fn f(a, b) { a + b } f(1, 2)",
    "fn g(n) { if n == 0 { 0 } else { n + g(n - 1) } } g(3)",
    "[1, 2, 3]",
    "// leading\nlet x = 1; // trailing\nx + 1",
    "let a = 1;\n\n\n// two blanks collapse\nlet b = 2;\na + b",
    // THE LEADING `let a = 1;` IS LOAD-BEARING, in this entry and the two bracket entries below.
    // `vertical_rows` hardcoded `first = false`, so a list broken for a comment measured its
    // blank-line gap from the previous STATEMENT's end, across its own `[`. With the list as the
    // file's FIRST statement there is no previous statement and the gap is empty, which is the only
    // reason this suite was green: every bracket-comment entry here used to open its file.
    "let a = 1;\nlet xs = [\n    1, // first\n    2,\n];\n0",
    "fn h(a) { // brace-trailing\n    // own line\n    a // tail-trailing\n}\nh(1)",
    // §14: a comment after a list's LAST element, before `]` — the exact shape that was torn out of
    // its list and reattached to an unrelated `;`, with a blank line the author never wrote appearing
    // beside it.
    "let a = 1;\nlet xs = [1, 2 // last\n];\nxs",
    // §14: a comment in the CONNECTOR zone between two method-chain links — the shape that was swept
    // into the next link's own argument list rather than staying between the two calls.
    "fn first(x, y) { x + y } fn second(x, y) { x * y } let a = 1; a.first(2) // step\n    .second(3)",
    // §14's second defect, the BLOCK case: a `{ }` body whose entire content is a comment (no
    // statements, no tail). Two hardcoded `first = false` flush calls leaked a blank line just inside
    // the brace for exactly this input class.
    "fn only_comment() {\n    // nothing else in this body\n}\nonly_comment()",
    // §14's second defect, the FILE case: a program whose entire content is a comment. A tail-less
    // block evaluates to `Unit`, so this both parses and runs, before and after formatting alike.
    "// the whole file is this one comment",
    // Final review C2: a comment whose whole construct is a bracket pair with no elements. The empty
    // early return ran before `must_break` was computed, so §7's forced break never applied here and
    // the comment escaped its own brackets — depth 1 to depth 0, which is exactly what the anchoring
    // property below measures.
    "let a = 1;\nlet xs = [ // inside\n];\nxs",
    // Final review C1: a block expression as a list element, with a comment just inside its `{`.
    // `Expr::Block`'s span used to start at the first token INSIDE the braces, so the comment read as
    // preceding the whole block and escaped it.
    "let a = 1;\nlet xs = [{ // c\nlet b = 2; b }, 2];\nxs",
    // §15: a nested `if` inside an `else` branch, carrying a comment. Before this task's fix, the
    // printer collapsed this into `else if`, which this grammar's parser cannot read back — guarded
    // only by an opaque `.proptest-regressions` seed until now.
    "fn classify(n) { if n == 0 { 0 } else {\n    // nested branch\n    if n > 0 { 1 } else { 2 }\n} }\nclassify(5)",
];

/// Programs whose comments sit in a STATEMENT-INTERIOR position — between `=` and its value, in an
/// `Assign`, after `|params|`. Design §17: the printer has no flush point inside a statement, so such
/// a comment is emitted at the next one, by which time the statement is already printed. It therefore
/// MOVES, and `every_comment_keeps_the_construct_it_was_written_against` fails on it by design.
///
/// **SEPARATED RATHER THAN OMITTED, and that is the point.** Dropping these inputs would leave the
/// divergence stated only in prose; listing them here runs every OTHER property over them — they are
/// idempotent, they keep every comment byte for byte, they compute the same value, they reparse — so
/// what is excluded is exactly one property and no more. If a fix ever gives statement interiors a
/// flush point, these entries move into `CORPUS` and the exclusion goes away with them.
const RELOCATING_TRIVIA: &[&str] =
    &["let a = // c\n1;\na", "let mut a = 1;\na = // c\n2;\na", "let f = |x| // c\nx;\nf(1)"];

/// Every `//` occurrence, in order, with trailing whitespace trimmed — the comparison design §10.2
/// specifies. Counting `//` rather than re-lexing keeps this independent of the lexer under test.
fn comments_of(src: &str) -> Vec<String> {
    src.lines().filter_map(|l| l.find("//").map(|i| l[i..].trim_end().to_string())).collect()
}

#[test]
fn formatting_is_idempotent_on_the_corpus() {
    for src in CORPUS.iter().chain(RELOCATING_TRIVIA) {
        let once = format(src).unwrap_or_else(|d| panic!("{src:?} must parse: {d:?}"));
        let twice = format(&once).unwrap_or_else(|d| panic!("formatted output must reparse: {d:?}"));
        assert_eq!(once, twice, "not idempotent for {src:?}");
    }
}

#[test]
fn every_comment_survives_in_order_and_byte_for_byte() {
    for src in CORPUS.iter().chain(RELOCATING_TRIVIA) {
        let out = format(src).unwrap();
        assert_eq!(comments_of(&out), comments_of(src), "comments changed for {src:?}\n{out}");
    }
}

#[test]
fn formatting_does_not_change_what_a_program_computes() {
    for src in CORPUS.iter().chain(RELOCATING_TRIVIA) {
        let out = format(src).unwrap();
        let before = run(src);
        let after = run(&out);
        match (before, after) {
            (Ok(a), Ok(b)) => assert_eq!(format_value(&a), format_value(&b), "value changed for {src:?}"),
            (Err(_), Err(_)) => {}
            (a, b) => panic!("outcome changed for {src:?}: {a:?} then {b:?}"),
        }
    }
}

#[test]
fn output_always_reparses_with_no_diagnostics() {
    for src in CORPUS.iter().chain(RELOCATING_TRIVIA) {
        let out = format(src).unwrap();
        format(&out).unwrap_or_else(|d| panic!("output of {src:?} did not reparse: {d:?}\n{out}"));
    }
}

#[test]
fn no_line_exceeds_the_budget_except_the_three_documented_constructs() {
    // THE EXCEPTIONS ARE ENUMERATED, NOT WAIVED BY A WILDCARD — and there are THREE, not one. This
    // test said "nothing else may" while asserting only the first; design §6 said "no input can
    // produce an unbounded line" while three constructs could. §17 corrects both, and each exception
    // is pinned below by an input that overruns, so a fix that closes one fails here and gets to say
    // so rather than passing silently.
    let breakable = "fn wide(a) { a } wide([1, 2, 3])";
    for line in format(breakable).unwrap().lines() {
        assert!(line.len() <= MAX_WIDTH, "over budget: {line:?}");
    }

    // §6.6, the deliberate divergence: binary expressions never break.
    let binary = format(&vec!["1"; 200].join(" + ")).unwrap();
    assert!(
        binary.lines().any(|l| l.len() > MAX_WIDTH),
        "a long binary chain is a DOCUMENTED exception; if this now fits, §6.6 changed and this test \
         should be updated rather than deleted"
    );

    // §17, first divergence: parameter lists are `Vec<String>`, printed with `join(", ")` and no
    // width handling at all, in `Stmt::Fn` and `Expr::Lambda` alike. Measured at 509 and 511 columns.
    let params = (0..30).map(|i| format!("param_number_{i}")).collect::<Vec<_>>().join(", ");
    for src in [format!("fn wide({params}) {{ 1 }}\n0"), format!("let f = |{params}| 1;\n0")] {
        let out = format(&src).unwrap();
        assert!(
            out.lines().any(|l| l.len() > MAX_WIDTH),
            "a parameter list is a DOCUMENTED exception (§17); if this now fits, that changed: {out}"
        );
    }

    // §17, second divergence: indentation. A construct nested d deep indents 4*d columns before its
    // first character, so deep enough nesting exceeds the budget with nothing on the line but spaces
    // and one element. No fill rule closes this one — rustfmt has the same property.
    let mut deep = String::from(
        "[aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb]",
    );
    for _ in 0..40 {
        deep = format!("[{deep}]");
    }
    let out = format(&deep).unwrap();
    assert!(
        out.lines().any(|l| l.len() > MAX_WIDTH),
        "deep nesting is a DOCUMENTED exception (§17); if this now fits, that changed"
    );
}

/// Where a comment sits, structurally: how deeply nested it is, and the nearest real tokens either
/// side of it.
///
/// **THIS IS THE PROPERTY §10 WAS MISSING, AND ITS ABSENCE COST TWO BUGS.** Design §14 records both:
/// a comment touching a bracket was torn out of its list and reattached to an unrelated `;`, and a
/// comment trailing one link of a method chain was swept into the next link's argument list. Both
/// outputs reparsed, preserved every comment's text and order, and were idempotent — so properties
/// 1 through 4 all passed while the comment sat on the wrong construct.
///
/// **Depth is what catches them.** A comment inside `[ … ]` is at depth 1; moved outside, it is at 0.
/// A comment after a chain link is at 0; swept into the next call's arguments, it is at 1.
///
/// **Punctuation is excluded from the neighbours on purpose.** A construct that breaks vertically
/// gains a trailing comma, so the token immediately before a trailing comment legitimately changes
/// from `2` to `,`. Comparing the nearest NON-punctuation token either side is stable under that while
/// still pinning the comment between the same two real tokens.
fn comment_anchors(src: &str) -> Vec<(usize, String, String, String)> {
    let spans = classify_source(src);
    let text = |s: Span| src[s.start..s.end].to_string();
    let is_open = |t: &str| matches!(t, "[" | "(" | "{");
    let is_close = |t: &str| matches!(t, "]" | ")" | "}");
    let mut out = Vec::new();
    for (i, (span, class)) in spans.iter().enumerate() {
        if *class != TokenClass::Comment {
            continue;
        }
        let depth = spans[..i].iter().filter(|(_, c)| *c == TokenClass::Punct).fold(0i32, |d, (s, _)| {
            let t = text(*s);
            d + i32::from(is_open(&t)) - i32::from(is_close(&t))
        });
        let real = |j: &&(Span, TokenClass)| j.1 != TokenClass::Comment && j.1 != TokenClass::Punct;
        let before = spans[..i].iter().rev().find(real).map_or(String::new(), |(s, _)| text(*s));
        let after = spans[i + 1..].iter().find(real).map_or(String::new(), |(s, _)| text(*s));
        out.push((usize::try_from(depth.max(0)).unwrap_or(0), before, text(*span), after));
    }
    out
}

#[test]
fn every_comment_keeps_the_construct_it_was_written_against() {
    for src in CORPUS {
        let out = format(src).unwrap();
        assert_eq!(comment_anchors(&out), comment_anchors(src), "comment moved for {src:?}\n{out}");
    }
}

#[test]
fn comment_anchoring_catches_the_two_defects_it_was_written_for() {
    // NOT A REGRESSION TEST FOR THE BUGS — `printer.rs` already has those. This asserts the PROPERTY
    // itself is capable of failing, by checking it distinguishes the two shapes design §14 records.
    // A property that cannot fail is worth nothing, and these two passed four other properties.
    let torn_from_its_list = ("let xs = [1, 2 // t\n];\nlet y = 3;\ny", "let xs = [1, 2]; // t\n\nlet y = 3;\ny\n");
    let swept_into_next_link =
        ("xs.first(1) // n\n.second(2)", "xs\n    .first(1)\n    .second( // n\n        2,\n    )\n");
    for (src, wrong) in [torn_from_its_list, swept_into_next_link] {
        assert_ne!(
            comment_anchors(wrong),
            comment_anchors(src),
            "the anchoring property cannot tell these apart, so it would not have caught §14: {src:?}"
        );
    }
}

fn arb_leaf() -> impl Strategy<Value = String> {
    (0u64..20).prop_map(|n| n.to_string())
}

/// A list literal carrying comments at the three positions a statement-level generator can never
/// reach: just after the `[`, just after an interior `,`, and just before the `]`.
///
/// **EVERY DEFECT THE FINAL REVIEW FOUND LIVED IN ONE OF THESE POSITIONS**, and none of them was
/// reachable from `arb_program_with_trivia` alone, which placed comments only own-line before a `let`
/// and trailing after its `;`. The suite that found §15's `else if` within 89 cases could not have
/// found any of them however long it ran. The empty-list arm is here for the same reason: a comment
/// whose entire construct is `[ ]` skipped the forced break altogether.
fn arb_list_with_bracket_trivia(element: impl Strategy<Value = String>) -> impl Strategy<Value = String> {
    (proptest::collection::vec(element, 0..3), any::<bool>(), any::<bool>(), any::<bool>()).prop_map(
        |(items, lead, mid, trail): (Vec<String>, bool, bool, bool)| {
            let mut s = String::from("[");
            if lead {
                s.push_str(" // lead");
            }
            s.push('\n');
            for (i, e) in items.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                    if mid {
                        s.push_str(" // mid");
                    }
                    s.push('\n');
                }
                s.push_str(e);
            }
            if trail && !items.is_empty() {
                s.push_str(" // trail");
            }
            s.push_str("\n]");
            s
        },
    )
}

/// A list literal written COMPACTLY: elements joined by `", "` rather than one per line, and no
/// forced newline before `]` unless a trailing comment needs one to keep `//` from running into it.
///
/// `arb_list_with_bracket_trivia` (above) puts one element per line BY CONSTRUCTION — every comma and
/// every `]` gets its own `\n` — which is exactly why `next_boundary` (§17.7: "the end of the line
/// this item ends on, in the ORIGINAL SOURCE") never had anywhere to overrun TO: every element already
/// had a nearby newline stopping it. This is the shape actual formatter input looks like instead:
/// several constructs sharing one physical source line.
fn arb_compact_list(element: impl Strategy<Value = String>) -> impl Strategy<Value = String> {
    (proptest::collection::vec(element, 1..3), any::<bool>()).prop_map(|(items, trail): (Vec<String>, bool)| {
        let mut s = format!("[{}", items.join(", "));
        if trail {
            s.push_str(" // trail");
        }
        s.push_str(if trail { "\n]" } else { "]" });
        s
    })
}

/// Two or three `arb_compact_list`s, comma-joined on ONE source line, as the elements of one outer
/// list.
///
/// §17.7 NEEDED A CONSTRUCT WITH NO COMMENT OF ITS OWN, forced vertical by something else entirely —
/// `arb_expr_over`'s `if` arms always braces both branches, and a braced block always breaks (see
/// `braced`'s doc) — SHARING A LINE with a LATER construct that does carry one. Only then can the
/// first construct's own trailing flush, uncapped at its own close, reach across its own `]` and the
/// outer `,` and steal a comment that was never inside it. Neither existing arm above can produce
/// that: `arb_list_with_bracket_trivia` puts a comment on every element it generates and always
/// follows one with `\n`, so a comment is never more than one line from where it belongs. This is what
/// found the defect design §17.7 records, and is kept here as the arm that could find the next one in
/// the same family.
fn arb_multi_construct_line() -> impl Strategy<Value = String> {
    proptest::collection::vec(arb_compact_list(arb_expr_over(arb_leaf())), 2..4)
        .prop_map(|parts| format!("[{}]", parts.join(", ")))
}

/// Either a plain generated expression, or one wrapped in a comment-bearing list, two levels of those
/// nested — the shape where a comment forces the INNER list to break and the outer one must then break
/// around it, which is the path `Printer::speculating` aborts through — or several constructs sharing
/// one source line, per `arb_multi_construct_line`.
fn arb_expr_with_trivia() -> impl Strategy<Value = String> {
    prop_oneof![
        arb_expr_over(arb_leaf()),
        arb_list_with_bracket_trivia(arb_expr_over(arb_leaf())),
        arb_list_with_bracket_trivia(arb_list_with_bracket_trivia(arb_expr_over(arb_leaf()))),
        arb_multi_construct_line(),
    ]
}

/// A program with trivia: `let` statements over generated expressions, each optionally preceded by an
/// own-line comment, optionally trailed by one, and optionally separated by a blank line. The
/// expressions themselves may carry comments at their bracket edges — see
/// `arb_list_with_bracket_trivia`.
///
/// `arb_expr_over`'s recursion parameters are NOT touched — its doc records measured rates that other
/// tests depend on. This wraps it rather than varying it.
fn arb_program_with_trivia() -> impl Strategy<Value = String> {
    proptest::collection::vec((arb_expr_with_trivia(), any::<bool>(), any::<bool>(), any::<bool>()), 1..4).prop_map(
        |stmts| {
            let mut out = String::new();
            for (i, (e, lead, trail, blank)) in stmts.iter().enumerate() {
                if *blank && i > 0 {
                    out.push('\n');
                }
                if *lead {
                    out.push_str("// lead\n");
                }
                let _ = write!(out, "let v{i} = {e};");
                if *trail {
                    out.push_str(" // trail");
                }
                out.push('\n');
            }
            out.push_str("v0");
            out
        },
    )
}

proptest! {
    #[test]
    fn idempotent_on_generated_programs(src in arb_program_with_trivia()) {
        let once = format(&src).expect("generated programs parse");
        let twice = format(&once).expect("formatted output reparses");
        prop_assert_eq!(once, twice);
    }

    #[test]
    fn comments_survive_on_generated_programs(src in arb_program_with_trivia()) {
        let out = format(&src).expect("generated programs parse");
        prop_assert_eq!(comments_of(&out), comments_of(&src));
    }

    /// PROPERTY 7 OVER GENERATED PROGRAMS, not just the hardcoded corpus. Design §14 records that
    /// anchoring is the property whose absence cost two bugs; running it only over inputs someone
    /// wrote by hand means it can only catch shapes someone already thought of, which is exactly the
    /// gap the final review found — every defect it reported was an interior comment in a
    /// multi-statement file, outside both of the old generator's two comment positions.
    #[test]
    fn comments_keep_their_construct_on_generated_programs(src in arb_program_with_trivia()) {
        let out = format(&src).expect("generated programs parse");
        prop_assert_eq!(comment_anchors(&out), comment_anchors(&src));
    }

    #[test]
    fn value_survives_on_generated_programs(src in arb_program_with_trivia()) {
        let out = format(&src).expect("generated programs parse");
        match (run(&src), run(&out)) {
            (Ok(a), Ok(b)) => prop_assert_eq!(format_value(&a), format_value(&b)),
            (Err(_), Err(_)) => {}
            _ => prop_assert!(false, "outcome changed"),
        }
    }
}
