//! Comments survive a parse of authored `.asm` text, anchored to the line they sit against.

use redextape_core::tm::asm_syntax::parse_asm_full;
use redextape_core::tm::comments::AsmAnchor;

const ANNOTATED: &str = "\
; about the whole listing
result Nat ; what comes back

; about the entry
f: ; the entry label
    li\tr0, #1 ; load one
    ; about returning
    ret
; nothing follows
";

#[test]
fn every_anchor_position_is_recovered() {
    let d = parse_asm_full(ANNOTATED);
    assert_eq!(d.diagnostics, vec![], "fixture must parse clean");

    let got: Vec<(&str, AsmAnchor, bool)> =
        d.comments.iter().map(|c| (c.text.as_str(), c.anchor, c.own_line)).collect();

    assert_eq!(
        got,
        vec![
            ("about the whole listing", AsmAnchor::Result, true),
            ("what comes back", AsmAnchor::Result, false),
            ("about the entry", AsmAnchor::Label(0), true),
            ("the entry label", AsmAnchor::Label(0), false),
            ("load one", AsmAnchor::Instr(0), false),
            // The ordinary case: a whole-line comment directly above an instruction with no label
            // and no directive between them. `li` (index 0) and `ret` (index 1) are two
            // instructions so `Instr(1)` here can only come from a correctly computed position,
            // not a hardcoded `Instr(0)`.
            ("about returning", AsmAnchor::Instr(1), true),
            ("nothing follows", AsmAnchor::Eof, true),
        ]
    );
}

#[test]
fn a_file_with_an_error_recovers_no_comments() {
    // Multi-line: a comment attaches to the label on the first, clean line before the second line
    // errors. This is the sharper form of the rule — not just that an erroring line adds no
    // comment of its own, but that a comment already accumulated from an earlier, successfully
    // parsed line is discarded too, because a single tail check decides `comments` for the whole
    // document rather than each line keeping what it already committed.
    let d = parse_asm_full("f: ; a label comment\nnotamnemonic r0 ; a comment\n");
    assert!(!d.diagnostics.is_empty(), "the fixture must fail to parse");
    assert!(d.program.is_none(), "a file with an error yields no program");
    assert_eq!(
        d.comments,
        vec![],
        "a comment attached to an earlier, successfully-parsed line must not survive a later line's error"
    );
}

use redextape_core::tm::asm::{print_asm, print_asm_doc};

/// A program with a comment against every `AsmAnchor` variant `print_asm_with_inner` can write to,
/// both `own_line` values reached for `Result`, `Label` and `Instr` — two labels (`f`, `g`) and two
/// instructions (`li`, `halt`) so an index (`Label(1)`, `Instr(1)`) can only come from a correctly
/// threaded position, never a hardcoded `0`. `Eof` is own-line only: `parse_asm_full` only ever
/// drains it that way (there is no line left for a trailing comment to sit on), matching
/// `tm_comments.rs`'s `ALL_ANCHORS`.
const ALL_ANCHORS: &str = "\
; about the whole listing
result Nat ; what comes back

; about the first label
f: ; f's trailing
; about the first instruction
    li\tr0, #1 ; li's trailing
; about the second label
g: ; g's trailing
; about the second instruction
    halt ; halt's trailing
; nothing follows
";

/// Pins WHERE `print_asm_doc` puts every comment, not merely that its text appears somewhere.
/// `assert!(out.contains(...))` cannot see a comment land against the wrong anchor — the text is
/// still in the document either way — so this asserts the exact printed bytes of `ALL_ANCHORS`
/// against a frozen expected string, following `tm_comments.rs`'s
/// `printing_a_document_emits_every_comment` (`print_tm_doc`'s sibling test).
#[test]
fn printing_a_document_emits_every_comment() {
    // Own-line comments sit on the line above the construct they annotate, at that construct's
    // indent (`; about the first instruction` is indented four spaces, matching the instruction
    // line below it, not the label line above it, which sits at column 0). Trailing comments sit
    // on their construct's own line, two spaces after whatever precedes them.
    const EXPECTED: &str = "\
; about the whole listing
result Nat  ; what comes back

; about the first label
f:  ; f's trailing
    ; about the first instruction
    li\tr0, #1  ; li's trailing
; about the second label
g:  ; g's trailing
    ; about the second instruction
    halt  ; halt's trailing
; nothing follows
";

    let d = parse_asm_full(ALL_ANCHORS);
    assert_eq!(d.diagnostics, vec![], "fixture must parse clean");

    // Precondition: every `AsmAnchor` variant is reached here, with both `own_line` values on
    // `Result`, `Label` and `Instr` (and two distinct indices on each of the latter two) — so the
    // assertion below is exercising every combination, not silently fewer.
    let anchors: Vec<(&str, AsmAnchor, bool)> =
        d.comments.iter().map(|c| (c.text.as_str(), c.anchor, c.own_line)).collect();
    assert_eq!(
        anchors,
        vec![
            ("about the whole listing", AsmAnchor::Result, true),
            ("what comes back", AsmAnchor::Result, false),
            ("about the first label", AsmAnchor::Label(0), true),
            ("f's trailing", AsmAnchor::Label(0), false),
            ("about the first instruction", AsmAnchor::Instr(0), true),
            ("li's trailing", AsmAnchor::Instr(0), false),
            ("about the second label", AsmAnchor::Label(1), true),
            ("g's trailing", AsmAnchor::Label(1), false),
            ("about the second instruction", AsmAnchor::Instr(1), true),
            ("halt's trailing", AsmAnchor::Instr(1), false),
            ("nothing follows", AsmAnchor::Eof, true),
        ]
    );

    let out = print_asm_doc(&d).expect("the fixture parses, so it prints");
    assert_eq!(out, EXPECTED);
}

/// The strict round trip, over the same fixture: printing `d` and reparsing the result recovers
/// `program`, `header` and `comments` back exactly — not merely "the comment text appears somewhere",
/// but the very list `printing_a_document_emits_every_comment` already pinned, unchanged.
///
/// This is the STRONGER guarantee than `.tm` gets, and it holds here for two reasons established by
/// reading the production code (not assumed):
///
/// 1. `print_asm_with_inner` (and everything it calls) writes a `;` in exactly one place —
///    `CommentWriter::own_line`/`CommentWriter::trailing` — so unlike TM's `write_header`, which
///    fabricates a `; reg`/`; work` tape label via `tape_name` whenever an anchor carries no authored
///    trailing comment, the asm printer never invents a comment a hand-authored file didn't have —
///    `a_document_with_no_comments_prints_exactly_what_the_old_printer_prints` (below) is the test for
///    that: it shows `print_asm_doc` agrees with the pre-comments `print_asm` on a document that has
///    none, not that such a document is some special fixed point (under the strict round trip this
///    file states, EVERY clean-parse document is a fixed point of print-then-parse, comments or not —
///    "with no comments at all" names no distinction the guarantee actually draws). A document with
///    comments only ever reprints the comments it was given.
/// 2. `CommentWriter::trailing` joins several trailing comments on one anchor with `" ; "`, and that
///    join is not a fixed point when a body is empty — the defect that cost `.tm` two of its four
///    review rounds. It cannot fire here: `parse_asm_full` names `AsmAnchor::Result` from at most one
///    line. A second `result` line takes the "duplicate `result` directive" diagnostic ONLY when no
///    code or label precedes it — the `!code.is_empty() || !labels.is_empty()` check runs first and
///    wins whenever anything already parsed, sending that line to the "must precede the first
///    instruction or label" diagnostic instead. Either branch empties `comments` for the whole
///    document (the single tail check does not care which diagnostic fired), so no second `result`
///    line, on either path, ever attaches a second trailing comment to a clean parse. And
///    `Label(i)`/`Instr(i)` are positional — `labels.len() - 1` / `code.len() - 1` at the moment of
///    the push — so no two lines in one clean parse can ever share an index and no two trailing
///    comments can ever land on one anchor. `AsmAnchor::Eof` is never a `trailing` argument at all:
///    `parse_asm_full` only ever drains `pending` into it as `own_line: true`, matching
///    `print_asm_with_inner`'s own `Eof` call (`cw.own_line(&mut out, &mut spans, AsmAnchor::Eof,
///    "")`, no `cw.trailing` counterpart).
#[test]
fn printing_and_reparsing_all_anchors_recovers_the_document_exactly() {
    let d = parse_asm_full(ALL_ANCHORS);
    assert_eq!(d.diagnostics, vec![], "fixture must parse clean");

    // Non-vacuity: pin the same eleven comments `printing_a_document_emits_every_comment` pins for
    // this fixture, in THIS function, so the `reparsed.comments == d.comments` check below cannot
    // pass on `[] == []` if a regression made `parse_asm_full` recover no comments at all — matching
    // `tm_comments.rs`'s `every_anchor_and_own_line_combination_reaches_a_fixed_point`, which puts its
    // own anchor-list assertion and its round-trip assertions in one function for exactly this reason.
    let anchors: Vec<(&str, AsmAnchor, bool)> =
        d.comments.iter().map(|c| (c.text.as_str(), c.anchor, c.own_line)).collect();
    assert_eq!(
        anchors,
        vec![
            ("about the whole listing", AsmAnchor::Result, true),
            ("what comes back", AsmAnchor::Result, false),
            ("about the first label", AsmAnchor::Label(0), true),
            ("f's trailing", AsmAnchor::Label(0), false),
            ("about the first instruction", AsmAnchor::Instr(0), true),
            ("li's trailing", AsmAnchor::Instr(0), false),
            ("about the second label", AsmAnchor::Label(1), true),
            ("g's trailing", AsmAnchor::Label(1), false),
            ("about the second instruction", AsmAnchor::Instr(1), true),
            ("halt's trailing", AsmAnchor::Instr(1), false),
            ("nothing follows", AsmAnchor::Eof, true),
        ]
    );

    let printed = print_asm_doc(&d).expect("a clean parse prints");
    let reparsed = parse_asm_full(&printed);

    assert_eq!(reparsed.program, d.program, "the round trip must preserve the program exactly");
    assert_eq!(reparsed.header, d.header, "the round trip must preserve the header exactly");
    assert_eq!(reparsed.comments, d.comments, "the round trip must preserve every comment exactly");
}

#[test]
fn a_document_with_no_comments_prints_exactly_what_the_old_printer_prints() {
    let d = parse_asm_full("f:\n    li\tr0, #1\n");
    let program = d.program.clone().expect("the fixture parses");
    assert_eq!(print_asm_doc(&d).as_deref(), Some(print_asm(&program).as_str()));
}

#[test]
fn a_document_with_no_program_does_not_print() {
    assert_eq!(print_asm_doc(&parse_asm_full("notamnemonic\n")), None);
}

use std::fmt::Write as _;

use proptest::prelude::*;

/// A comment body that survives a round trip: no newline (impossible from a line-based parser anyway)
/// and no leading or trailing whitespace, since the printer writes `; ` and the parser trims.
/// Everything else is fair game, `;` included — `split_trailing` only ever looks at the FIRST `;` on a
/// line, so a body containing one still recovers whole.
fn body() -> impl Strategy<Value = String> {
    "[^\n]{0,40}".prop_map(|s| s.trim().to_string())
}

/// The own-line comments (0..=2, each printed above the construct it belongs to) and the optional
/// trailing comment (printed on the construct's own line) one candidate position gets. Every position
/// below draws its `Slot` INDEPENDENTLY of every other, which is what makes a typical generated
/// document exercise many anchors, and both `own_line` values on most of them, in one case — rather
/// than the shape this task's brief warns against: comments appended after a fixed skeleton, which
/// only ever lands at `Eof` with `own_line: true`.
#[derive(Clone, Debug)]
struct Slot {
    own: Vec<String>,
    trailing: Option<String>,
}

fn slot() -> impl Strategy<Value = Slot> {
    (proptest::collection::vec(body(), 0..=2), proptest::option::weighted(0.7, body()))
        .prop_map(|(own, trailing)| Slot { own, trailing })
}

/// Write `slot`'s own-line comments, each on its own line at `indent`, immediately above the
/// construct line the caller writes next.
fn write_own(out: &mut String, slot: &Slot, indent: &str) {
    for line in &slot.own {
        let _ = writeln!(out, "{indent}; {line}");
    }
}

/// `slot`'s trailing comment, formatted to append directly after a construct's own content on the
/// same line — empty when there isn't one.
fn trailing_of(slot: &Slot) -> String {
    match &slot.trailing {
        Some(t) => format!(" ; {t}"),
        None => String::new(),
    }
}

/// Write one construct line, preceded by `slot`'s own-line comments and followed by its trailing
/// comment, both at `indent`.
fn emit(out: &mut String, slot: &Slot, indent: &str, line: &str) {
    write_own(out, slot, indent);
    let _ = writeln!(out, "{indent}{line}{}", trailing_of(slot));
}

/// The result types `AsmHeader::result` admits, matching `ty::parse_ty`'s acceptance and
/// `crate::ty::show`'s output.
const RESULT_TYS: [&str; 3] = ["Nat", "Bool", "Unit"];

/// The optional `result <ty>` header line: `AsmAnchor::Result`'s payload plus the slot that anchors it.
#[derive(Clone, Debug)]
struct HeaderCand {
    ty_idx: usize,
    slot: Slot,
}

fn header_cand() -> impl Strategy<Value = HeaderCand> {
    (0usize..RESULT_TYS.len(), slot()).prop_map(|(ty_idx, slot)| HeaderCand { ty_idx, slot })
}

/// One candidate source line: a label declaration or an instruction, each carrying the `Slot` that
/// anchors comments to it (`AsmAnchor::Label`/`AsmAnchor::Instr`, by whatever index `parse_asm_full`
/// assigns it — this generator never predicts the index itself, since the property only needs the
/// document `parse_asm_full` actually produces to survive its own round trip).
///
/// Drawn from small, closed pools of text that is syntactically valid on its face: the generator's job
/// is to place comments densely, not to explore `parse_instr`'s grammar (the differential in
/// `asm_syntax.rs` and `asm_oracle` already do that). `parse_reg` accepts `r<n>`/`a<n>`/`rr`,
/// `parse_imm` needs the `#` prefix, and a jump/call target only has to be non-empty — `parse_asm_full`
/// never checks that a label operand resolves to a line that exists.
#[derive(Clone, Debug)]
enum LineCand {
    Label { name: &'static str, slot: Slot },
    Instr { text: &'static str, slot: Slot },
}

fn label_name() -> impl Strategy<Value = &'static str> {
    prop_oneof![Just("f"), Just("g"), Just("h"), Just("loop_"), Just("done")]
}

fn instr_text() -> impl Strategy<Value = &'static str> {
    prop_oneof![
        Just("li r0, #1"),
        Just("li r1, #7"),
        Just("mov r0, r1"),
        Just("add r0, r1, r2"),
        Just("sub r2, r0, r1"),
        Just("ret"),
        Just("halt"),
        Just("jmp target"),
        Just("call target"),
        Just("jz r0, target"),
        Just("nil r0"),
        Just("cons r0, r1, r2"),
    ]
}

fn line_cand() -> impl Strategy<Value = LineCand> {
    prop_oneof![
        (label_name(), slot()).prop_map(|(name, slot)| LineCand::Label { name, slot }),
        (instr_text(), slot()).prop_map(|(text, slot)| LineCand::Instr { text, slot }),
    ]
}

/// Up to this many label/instruction lines per generated document. Large enough that a run of 512
/// cases routinely draws two or more of each kind in a single document — reaching `Label(0)` AND
/// `Label(1)`, `Instr(0)` AND `Instr(1)`, together — without making any one case expensive to shrink.
const MAX_LINES: usize = 6;

/// A whole candidate document: an optional header (`AsmAnchor::Result`'s slot), up to `MAX_LINES`
/// label/instruction lines each independently choosing which kind it is and drawing its own `Slot`,
/// and an EOF slot's own-line comments. Every anchor `print_asm_with_inner` can write to is reachable
/// from this shape, with both `own_line` values independently possible everywhere except `Eof` (which
/// `parse_asm_full` only ever drains as `own_line: true` — there is no line left for a trailing
/// comment to sit on, matching `tm_comments.rs`'s generator).
#[derive(Clone, Debug)]
struct DocSpec {
    header: Option<HeaderCand>,
    lines: Vec<LineCand>,
    eof_own: Vec<String>,
}

fn doc_spec() -> impl Strategy<Value = DocSpec> {
    (
        proptest::option::weighted(0.85, header_cand()),
        proptest::collection::vec(line_cand(), 0..=MAX_LINES),
        proptest::collection::vec(body(), 0..=2),
    )
        .prop_map(|(header, lines, eof_own)| DocSpec { header, lines, eof_own })
}

/// Render `spec` as `.asm` source text — placing each `Slot`'s comments AT the position they anchor
/// to, as the document is built, rather than appending every comment after a fixed skeleton once it is
/// done. That "append at the end" shape is the mistake this task's brief names: it puts every comment
/// at `Eof` with `own_line: true`, one of a dozen (anchor, `own_line`) combinations, and a green run
/// under it says nothing about the rest.
fn render(spec: &DocSpec) -> String {
    let mut src = String::new();
    if let Some(h) = &spec.header {
        emit(&mut src, &h.slot, "", &format!("result {}", RESULT_TYS[h.ty_idx]));
        src.push('\n');
    }
    for line in &spec.lines {
        match line {
            LineCand::Label { name, slot } => emit(&mut src, slot, "", &format!("{name}:")),
            LineCand::Instr { text, slot } => emit(&mut src, slot, "    ", text),
        }
    }
    write_own(&mut src, &Slot { own: spec.eof_own.clone(), trailing: None }, "");
    src
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    /// The strict round trip stated over every document this generator can build: printing `first` and
    /// reparsing the result recovers `program`, `header` and `comments` back exactly. Justified by the
    /// two verifications `printing_and_reparsing_all_anchors_recovers_the_document_exactly`'s doc
    /// comment states in full — no fabricated comment on the print side, and no anchor that can ever
    /// receive two trailing comments on the parse side — so unlike TM's property, this one does not
    /// have to weaken to idempotence or drop to a sub-multiset check on `comments`.
    ///
    /// `prop_assume!(first.diagnostics.is_empty())` stays even though every candidate this generator
    /// draws is built from syntax that parses clean by construction (closed pools of valid label names
    /// and instruction text, a header type from `RESULT_TYS`, comment bodies that carry no newline): it
    /// guards against a PANIC below, not against a failed comparison. `parse_asm_full`'s tail check —
    /// the single `if diags.is_empty() { .. } else { .. }` at the end of the function — sets
    /// `program: None` whenever `diags` is non-empty, and `print_asm_doc` opens with
    /// `let p = d.program.as_ref()?;`, so it returns `None` for any document with a diagnostic. Without
    /// the guard, a candidate `first` that failed to parse would reach
    /// `print_asm_doc(&first).expect("a clean parse prints")` with `first.program: None` and panic
    /// there — never reaching the `prop_assert_eq!` calls below, so there is no equality for a false
    /// guard to protect. `a_document_with_no_program_does_not_print` is the test for that `None`
    /// return; `a_file_with_an_error_recovers_no_comments` shows the same tail check emptying
    /// `comments`. The discard count this run reports is therefore expected to be zero; if it is not,
    /// that is itself a finding about what the generator can produce.
    #[test]
    fn printing_and_reparsing_recovers_the_document_exactly(spec in doc_spec()) {
        let src = render(&spec);

        let first = parse_asm_full(&src);
        prop_assume!(first.diagnostics.is_empty());

        let printed = print_asm_doc(&first).expect("a clean parse prints");
        let reparsed = parse_asm_full(&printed);

        // Named directly rather than left to surface indirectly through a program mismatch (a reparse
        // failure sets `reparsed.program: None` while `first.program` is `Some`, so the assertions below
        // would already catch it — but as the wrong failure, reporting a program diff instead of the
        // diagnostic that actually caused it).
        prop_assert!(reparsed.diagnostics.is_empty());
        prop_assert_eq!(&reparsed.program, &first.program);
        prop_assert_eq!(&reparsed.header, &first.header);
        prop_assert_eq!(&reparsed.comments, &first.comments);
    }
}
