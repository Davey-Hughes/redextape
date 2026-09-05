//! Comments survive a parse of authored `.tm` text, anchored to the line they sit against.

use redextape_core::Span;
use redextape_core::tm::comments::{AnchoredComment, TmAnchor, TmDirective};
use redextape_core::tm::syntax::parse_tm_full;
use redextape_core::tm::syntax::print_tm;

/// A machine with a comment against every anchor variant a header-less file can reach.
const ANNOTATED: &str = "\
; about the whole file
tapes 1 ; how many
start q0 ; where it begins

; about q0
state q0: ; the only working state
  ; about the rule
  [a] -> write [b], move [R], goto q1 ; the only rule
state q1: accept ; done
; nothing follows
";

#[test]
fn every_anchor_position_is_recovered() {
    let d = parse_tm_full(ANNOTATED);
    assert_eq!(d.diagnostics, vec![], "fixture must parse clean");

    let got: Vec<(&str, TmAnchor, bool)> = d.comments.iter().map(|c| (c.text.as_str(), c.anchor, c.own_line)).collect();

    assert_eq!(
        got,
        vec![
            ("about the whole file", TmAnchor::Tapes, true),
            ("how many", TmAnchor::Tapes, false),
            ("where it begins", TmAnchor::Start, false),
            ("about q0", TmAnchor::State(0), true),
            ("the only working state", TmAnchor::State(0), false),
            ("about the rule", TmAnchor::Rule { state: 0, index: 0 }, true),
            ("the only rule", TmAnchor::Rule { state: 0, index: 0 }, false),
            ("done", TmAnchor::State(1), false),
            ("nothing follows", TmAnchor::Eof, true),
        ]
    );
}

#[test]
fn a_header_directive_carries_its_own_anchor() {
    // `tapes 2` (not 1) so `tape 1 ...` names a tape that is actually in range — proving the
    // anchor carries the PARSED index, not a hardcoded 0. The accept state has no rules, so
    // raising the tape count does not require any rule-arity change.
    let src = "\
tapes 2
start q0
version 1 ; the format version
encoding unary
width 8
slots 1
result Nat ; what comes back
tape 1 #________#  ; second tape

state q0: accept
";
    let d = parse_tm_full(src);
    assert_eq!(d.diagnostics, vec![], "fixture must parse clean");

    let got: Vec<(&str, TmAnchor)> = d.comments.iter().map(|c| (c.text.as_str(), c.anchor)).collect();
    assert_eq!(
        got,
        vec![
            ("the format version", TmAnchor::Directive(TmDirective::Version)),
            ("what comes back", TmAnchor::Directive(TmDirective::Result)),
            ("second tape", TmAnchor::Directive(TmDirective::Tape(1))),
        ]
    );
}

/// The parser buffers own-line comments in `pending` and drains ALL of them onto the next anchor
/// that parses. Every other fixture in this file has at most one own-line comment per anchor, so
/// the drain-more-than-one path — and the source-order guarantee across the drain — was untested.
#[test]
fn an_anchor_can_carry_two_own_line_comments_in_source_order() {
    let src = "\
tapes 1
start q0

; first
; second
state q0: accept
";
    let d = parse_tm_full(src);
    assert_eq!(d.diagnostics, vec![], "fixture must parse clean");

    let got: Vec<(&str, TmAnchor, bool)> = d.comments.iter().map(|c| (c.text.as_str(), c.anchor, c.own_line)).collect();
    assert_eq!(got, vec![("first", TmAnchor::State(0), true), ("second", TmAnchor::State(0), true)]);
}

#[test]
fn a_file_with_an_error_recovers_no_comments() {
    let d = parse_tm_full("tapes 1\nstart q0\nnonsense ; a comment\nstate q0: accept\n");
    assert!(!d.diagnostics.is_empty(), "the fixture must fail to parse");
    assert_eq!(d.comments, vec![], "a document with no machine has nothing to print");
}

use redextape_core::Severity;

/// A second `tapes` line is an error, on the same rule `HeaderParts::directive` already states for
/// the four header directives (its "duplicate `encoding` directive" and siblings): the file states a
/// thing once. Before this diagnostic existed, a second `tapes` line silently overwrote the first —
/// `tapes 1` then `tapes 5` yielded a 5-tape machine with no diagnostic at all.
#[test]
fn a_duplicate_tapes_line_is_an_error() {
    let src = "tapes 1\ntapes 5\nstart q0\n\nstate q0: accept\n";
    let d = parse_tm_full(src);
    assert!(d.machine.is_none(), "a duplicate `tapes` line must not yield a machine");
    let dup = d.diagnostics.iter().find(|dg| dg.message.contains("tapes")).expect("a diagnostic naming `tapes`");
    assert_eq!(dup.severity, Severity::Error, "a duplicate line is an ERROR, not a warning");
    assert!(dup.message.contains("duplicate"), "{:?}", d.diagnostics);
    // The SECOND `tapes` line's span, not the first: that is what an editor underlines, and the only
    // observable trace of the ignore-first-wins choice (the diagnostic fires only once `tapes.is_some()`
    // — see `parse_tm_full`'s `tapes` branch — which is true starting on the second line). `"tapes 1\n"`
    // is 8 bytes, so the second line (`"tapes 5"`, 7 bytes) runs from byte 8 to byte 15.
    assert_eq!(dup.span, Span::new(8, 15), "the duplicate diagnostic must point at the SECOND `tapes` line");
}

/// Same rule, same reason, for `start`: a second `start` line used to silently move where the
/// machine begins (`start q0` then `start q1` started at `q1`), with no diagnostic.
#[test]
fn a_duplicate_start_line_is_an_error() {
    let src = "tapes 1\nstart q0\nstart q1\n\nstate q0: accept\nstate q1: accept\n";
    let d = parse_tm_full(src);
    assert!(d.machine.is_none(), "a duplicate `start` line must not yield a machine");
    let dup = d.diagnostics.iter().find(|dg| dg.message.contains("start")).expect("a diagnostic naming `start`");
    assert_eq!(dup.severity, Severity::Error, "a duplicate line is an ERROR, not a warning");
    assert!(dup.message.contains("duplicate"), "{:?}", d.diagnostics);
    // The SECOND `start` line's span, same reasoning as the `tapes` case above. `"tapes 1\n"` (8
    // bytes) then `"start q0\n"` (9 bytes) put the second `start` line's `"start q1"` (8 bytes) at
    // byte 17 through byte 25.
    assert_eq!(dup.span, Span::new(17, 25), "the duplicate diagnostic must point at the SECOND `start` line");
}

/// The new checks are additive, not stricter than intended: exactly one `tapes` line and one `start`
/// line — the shape every existing `.tm` file has — still parses with no diagnostics at all.
#[test]
fn exactly_one_tapes_and_one_start_line_still_parses_clean() {
    let src = "tapes 1\nstart q0\n\nstate q0: accept\n";
    let d = parse_tm_full(src);
    assert!(d.diagnostics.is_empty(), "{:?}", d.diagnostics);
    assert!(d.machine.is_some());
}

/// The exact counterexample the finding was verified against: two `tapes 1 ;` lines, each with an
/// EMPTY trailing comment body, used to attach two trailing comments to one anchor (`TmAnchor::Tapes`)
/// — which `CommentWriter::trailing` joins with `" ; "`, a join that is not a fixed point when a body
/// is empty (`print_once` and `print_twice` differed: `"tapes 1  ;  ; "` then `"tapes 1  ; ;"` — and
/// `print_twice` IS the stable value, reached after one re-parse; there is no third value still to
/// come). The shape parsed with ZERO diagnostics before this fix. It must not parse at all now.
#[test]
fn the_verified_counterexample_is_now_rejected() {
    let src = "tapes 1 ;\ntapes 1 ;\nstart q0\n\nstate q0: accept\n";
    let d = parse_tm_full(src);
    assert!(d.machine.is_none(), "the counterexample must no longer parse to a machine");
    assert!(
        d.diagnostics.iter().any(|dg| dg.severity == Severity::Error && dg.message.contains("duplicate")),
        "expected a duplicate-line error, got {:?}",
        d.diagnostics
    );
}

use redextape_core::tm::syntax::print_tm_doc;

/// Pins WHERE `print_tm_doc` puts every comment, not merely that its text appears somewhere.
/// `assert!(out.contains(...))` cannot see a comment land against the wrong anchor — the text is
/// still in the document either way — so this asserts the exact printed bytes of `ANNOTATED`
/// against a frozen expected string. One `assert_eq!` pins placement (own-line above its construct
/// vs. trailing on its construct's line), indentation, and ordering all at once.
#[test]
fn printing_a_document_emits_every_comment() {
    // Own-line comments sit on the line above the construct they annotate, at that construct's
    // indent (`; about the rule` is indented two spaces, matching the rule line below it, not the
    // `state` line above it). Trailing comments sit on their construct's own line, separated by two
    // spaces, in source order relative to any other trailing text on that line.
    const EXPECTED: &str = "\
; about the whole file
tapes 1  ; how many
start q0  ; where it begins

; about q0
state q0:  ; the only working state
  ; about the rule
  [a] -> write [b], move [R], goto q1  ; the only rule
state q1: accept  ; done
; nothing follows
";

    let d = parse_tm_full(ANNOTATED);
    let out = print_tm_doc(&d).expect("the fixture parses, so it prints");
    assert_eq!(out, EXPECTED);
}

/// Every `TmDirective` variant carries a comment, including one own-line comment above a directive
/// (`; how symbols pack` above `encoding`) — none of that was true of any test before this one:
/// `printing_a_document_emits_every_comment` uses the header-less `ANNOTATED`, so `write_header`
/// never ran under an emission assertion, and the only directive ever exercised anywhere was
/// `Tape`'s trailing/displacement path in `an_authored_comment_takes_the_tape_line_over_the_generated_name`.
#[test]
fn printing_a_header_emits_a_comment_on_every_directive_variant() {
    const SRC: &str = "\
tapes 2
start q0
version 1 ; the format version
; how symbols pack
encoding unary
width 8 ; cells per tape
slots 1 ; how many slots
result Nat ; what comes back
tape 1 #________#  ; second tape

state q0: accept
";

    // `write_header` emits directives in its own fixed order (version, encoding, width, slots,
    // result, then tape lines ascending) regardless of the order the fixture wrote them in — here
    // that happens to match the source order too, but the expected string below follows the
    // printer's order on principle, not the fixture's.
    const EXPECTED: &str = "\
tapes 2
start q0
version 1  ; the format version
; how symbols pack
encoding unary
width 8  ; cells per tape
slots 1  ; how many slots
result Nat  ; what comes back
tape 1 #________#  ; second tape

state q0: accept
";

    let d = parse_tm_full(SRC);
    assert_eq!(d.diagnostics, vec![], "fixture must parse clean");

    // Precondition: every one of the six `TmDirective` variants is actually anchored by a comment
    // here, source order preserved by the drain — so the assertion below is exercising all six
    // and not silently exercising fewer.
    let anchors: Vec<(&str, TmAnchor, bool)> =
        d.comments.iter().map(|c| (c.text.as_str(), c.anchor, c.own_line)).collect();
    assert_eq!(
        anchors,
        vec![
            ("the format version", TmAnchor::Directive(TmDirective::Version), false),
            ("how symbols pack", TmAnchor::Directive(TmDirective::Encoding), true),
            ("cells per tape", TmAnchor::Directive(TmDirective::Width), false),
            ("how many slots", TmAnchor::Directive(TmDirective::Slots), false),
            ("what comes back", TmAnchor::Directive(TmDirective::Result), false),
            ("second tape", TmAnchor::Directive(TmDirective::Tape(1)), false),
        ]
    );

    let out = print_tm_doc(&d).expect("the fixture parses, so it prints");
    assert_eq!(out, EXPECTED);
}

#[test]
fn a_document_with_no_comments_prints_exactly_what_the_old_printer_prints() {
    let src = "tapes 1\nstart q0\n\nstate q0: accept\n";
    let d = parse_tm_full(src);
    let machine = d.machine.clone().expect("the fixture parses");

    assert_eq!(print_tm_doc(&d).as_deref(), Some(print_tm(&machine).as_str()));
}

#[test]
fn a_document_with_no_machine_does_not_print() {
    let d = parse_tm_full("nonsense\n");
    assert_eq!(print_tm_doc(&d), None);
}

/// A machine printed with a header, checked in. Its `tape 0` line carries the generated `; reg`
/// label, which is what makes the collision below reachable rather than hypothetical.
const LIST_1_2: &str = include_str!("fixtures/list_1_2.tm");

#[test]
fn an_authored_comment_takes_the_tape_line_over_the_generated_name() {
    // `write_header` labels tape 0 `; reg` and tape 1 `; work`. Two comments on one line reparse as
    // ONE — `;` runs to end of line — so an authored comment must displace the generated label
    // rather than sit beside it, or the round trip is lost.
    assert!(LIST_1_2.contains("; reg"), "precondition: the fixture must carry a generated label");
    let authored = LIST_1_2.replace("; reg", "; mine");

    let d = parse_tm_full(&authored);
    assert_eq!(d.diagnostics, vec![], "the fixture must parse clean");
    let printed = print_tm_doc(&d).expect("a clean parse prints");

    let tape_line = printed.lines().find(|l| l.trim_start().starts_with("tape 0")).expect("a tape 0 line");
    assert!(tape_line.contains("; mine"), "authored comment missing from: {tape_line}");
    assert!(!tape_line.contains("; reg"), "generated label was not displaced: {tape_line}");
    assert_eq!(tape_line.matches(';').count(), 1, "two comments on one line: {tape_line}");
}

use std::fmt::Write as _;

use proptest::prelude::*;

/// A comment body that survives a round trip: no newline (impossible from a line-based parser
/// anyway) and no leading or trailing whitespace, since the printer writes `; ` and the parser
/// trims. Everything else is fair game, `;` included.
fn body() -> impl Strategy<Value = String> {
    "[^\n]{0,40}".prop_map(|s| s.trim().to_string())
}

/// The own-line comments (0..=2, each printed above the construct it belongs to) and the optional
/// trailing comment (printed on the construct's own line) a single candidate position gets. Every
/// anchor `print_tm_inner` can write to is exactly one of these positions, and every position below
/// draws its `Slot` INDEPENDENTLY of every other — which is what makes a typical generated document
/// exercise many anchors, and both `own_line` values on most of them, in one case, rather than
/// requiring a separate case per (anchor, `own_line`) combination to ever touch it at all.
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

/// A data symbol safe against every reserved character (`; * : [ ]` and whitespace) and against the
/// wildcard marker itself, so every generated symbol is exactly one `Symbol` on a round trip.
fn tm_symbol() -> impl Strategy<Value = char> {
    prop_oneof![Just('0'), Just('1'), Just('a'), Just('b'), Just('_')]
}

fn tm_move() -> impl Strategy<Value = char> {
    prop_oneof![Just('L'), Just('R'), Just('S')]
}

/// A `tape` line's packed cell run: 1..=4 cells from the same alphabet a `.tm` file actually uses
/// (`_ # 1 0 @`), so the generated `tape` line always has content and always parses — `directive`'s
/// `val.split_once(' ')` needs cells to be non-empty, or the line is a diagnostic, not a directive.
fn cell_run() -> impl Strategy<Value = String> {
    proptest::collection::vec(prop_oneof![Just('_'), Just('#'), Just('0'), Just('1'), Just('@')], 1..=4)
        .prop_map(|cells| cells.into_iter().collect())
}

const MAX_STATES: usize = 3;
const MAX_RULES: usize = 2;
/// Two more than `build::BOX` (4, the last named tape index `header::tape_name` recognizes).
/// Generated indices run `0..MAX_TAPE_LINES`, so the highest is `BOX + 1` (5) — one past the named
/// range — which is what gives the generated `tape` lines both the named bank indices (where an
/// absent trailing comment can collide with `write_header`'s generated label) and at least one
/// index outside that range.
const MAX_TAPE_LINES: usize = 6;
const RESULT_TYS: [&str; 3] = ["Nat", "Bool", "Unit"];

/// One candidate rule: `TmAnchor::Rule { .. }`'s payload plus the slot that anchors it. `goto` is a
/// state INDEX, resolved to `q<goto>` at render time — always a state that will actually be
/// rendered, so a generated rule is never an unknown-goto diagnostic.
#[derive(Clone, Debug)]
struct RuleCand {
    read: Vec<char>,
    write: Vec<char>,
    moves: Vec<char>,
    goto: usize,
    slot: Slot,
}

fn rule_cand(tapes: usize, n_states: usize) -> impl Strategy<Value = RuleCand> {
    (
        proptest::collection::vec(tm_symbol(), tapes),
        proptest::collection::vec(tm_symbol(), tapes),
        proptest::collection::vec(tm_move(), tapes),
        0..n_states,
        slot(),
    )
        .prop_map(|(read, write, moves, goto, slot)| RuleCand { read, write, moves, goto, slot })
}

/// One candidate state: `TmAnchor::State`'s payload plus the slot that anchors it, plus up to
/// `MAX_RULES` candidate rules — always generated, but only `rule_count` of them rendered, and NONE
/// of them rendered when `accept` (an accept state has no rules; `parse_tm_full` refuses one that
/// does).
#[derive(Clone, Debug)]
struct StateCand {
    accept: bool,
    rule_count: usize,
    rules: Vec<RuleCand>,
    slot: Slot,
}

fn state_cand(tapes: usize, n_states: usize) -> impl Strategy<Value = StateCand> {
    (
        proptest::bool::weighted(0.25),
        0..=MAX_RULES,
        proptest::collection::vec(rule_cand(tapes, n_states), MAX_RULES),
        slot(),
    )
        .prop_map(|(accept, rule_count, rules, slot)| StateCand { accept, rule_count, rules, slot })
}

/// One candidate `tape <i> ...` header line: `TmDirective::Tape(i)`'s payload plus the slot that
/// anchors it. `include` decides whether the line is written at all — an omitted `tape` line is a
/// legal, common case (an empty tape), not a defect, so this has to be reachable too.
#[derive(Clone, Debug)]
struct TapeLineCand {
    include: bool,
    cells: String,
    slot: Slot,
}

fn tape_line_cand() -> impl Strategy<Value = TapeLineCand> {
    (proptest::bool::weighted(0.6), cell_run(), slot()).prop_map(|(include, cells, slot)| TapeLineCand {
        include,
        cells,
        slot,
    })
}

/// The five single-line header directives that are not `tape` lines, each with its own slot.
#[derive(Clone, Debug)]
struct HeaderSlots {
    version: Slot,
    encoding: Slot,
    width: Slot,
    slots: Slot,
    result: Slot,
}

fn header_slots() -> impl Strategy<Value = HeaderSlots> {
    (slot(), slot(), slot(), slot(), slot()).prop_map(|(version, encoding, width, slots, result)| HeaderSlots {
        version,
        encoding,
        width,
        slots,
        result,
    })
}

/// A candidate header: `TmHeader`'s five directives plus up to `MAX_TAPE_LINES` candidate `tape`
/// lines, one per index `0..MAX_TAPE_LINES` — rendered only for the indices actually below the
/// document's `tapes` count, so every index used is in range, and each index has exactly one
/// candidate, so none collide.
#[derive(Clone, Debug)]
struct HeaderCand {
    width: usize,
    slots: u32,
    encoding_binary: bool,
    result_idx: usize,
    lines: HeaderSlots,
    tape_lines: Vec<TapeLineCand>,
}

fn header_cand() -> impl Strategy<Value = HeaderCand> {
    (
        1usize..=8,
        0u32..=3,
        proptest::bool::ANY,
        0usize..RESULT_TYS.len(),
        header_slots(),
        proptest::collection::vec(tape_line_cand(), MAX_TAPE_LINES),
    )
        .prop_map(|(width, slots, encoding_binary, result_idx, lines, tape_lines)| HeaderCand {
            width,
            slots,
            encoding_binary,
            result_idx,
            lines,
            tape_lines,
        })
}

/// A whole candidate document: every position `print_tm_inner` can anchor a comment to, each with
/// its own independently-drawn `Slot` — `Tapes`, `Start`, an optional header (reaching all six
/// `TmDirective` variants), up to `MAX_STATES` states each with up to `MAX_RULES` rules, and an EOF
/// slot. Built so every rendering is diagnostic-free BY CONSTRUCTION — unique state names in
/// definition order, in-range goto targets, matching rule arity, in-range and non-colliding tape
/// indices, exactly the five required directives together or not at all — so the `prop_assume!` in
/// the property below is a safety net, not the mechanism that keeps cases from being discarded.
#[derive(Clone, Debug)]
struct DocSpec {
    tapes: usize,
    tapes_slot: Slot,
    start: usize,
    start_slot: Slot,
    header: Option<HeaderCand>,
    n_states: usize,
    states: Vec<StateCand>,
    eof_own: Vec<String>,
}

fn doc_spec() -> impl Strategy<Value = DocSpec> {
    (1usize..=MAX_TAPE_LINES, 1usize..=MAX_STATES).prop_flat_map(|(tapes, n_states)| {
        (
            slot(),
            0..n_states,
            slot(),
            proptest::option::weighted(0.85, header_cand()),
            proptest::collection::vec(state_cand(tapes, n_states), MAX_STATES),
            proptest::collection::vec(body(), 0..=2),
        )
            .prop_map(move |(tapes_slot, start, start_slot, header, states, eof_own)| DocSpec {
                tapes,
                tapes_slot,
                start,
                start_slot,
                header,
                n_states,
                states,
                eof_own,
            })
    })
}

/// Render `spec` as `.tm` source text — the one producer standing in for every way an author might
/// have written comments into a real file.
fn render(spec: &DocSpec) -> String {
    let mut src = String::new();
    emit(&mut src, &spec.tapes_slot, "", &format!("tapes {}", spec.tapes));
    emit(&mut src, &spec.start_slot, "", &format!("start q{}", spec.start));

    if let Some(h) = &spec.header {
        emit(&mut src, &h.lines.version, "", "version 1");
        let enc = if h.encoding_binary { "binary" } else { "unary" };
        emit(&mut src, &h.lines.encoding, "", &format!("encoding {enc}"));
        emit(&mut src, &h.lines.width, "", &format!("width {}", h.width));
        emit(&mut src, &h.lines.slots, "", &format!("slots {}", h.slots));
        emit(&mut src, &h.lines.result, "", &format!("result {}", RESULT_TYS[h.result_idx]));
        for (idx, cand) in h.tape_lines.iter().enumerate() {
            if cand.include && idx < spec.tapes {
                emit(&mut src, &cand.slot, "", &format!("tape {idx} {}", cand.cells));
            }
        }
    }
    src.push('\n');

    for i in 0..spec.n_states {
        let st = &spec.states[i];
        if st.accept {
            emit(&mut src, &st.slot, "", &format!("state q{i}: accept"));
        } else {
            emit(&mut src, &st.slot, "", &format!("state q{i}:"));
            for r in &st.rules[..st.rule_count.min(MAX_RULES)] {
                let read: String = r.read.iter().map(ToString::to_string).collect::<Vec<_>>().join(" ");
                let write: String = r.write.iter().map(ToString::to_string).collect::<Vec<_>>().join(" ");
                let moves: String = r.moves.iter().map(ToString::to_string).collect::<Vec<_>>().join(" ");
                let line = format!("[{read}] -> write [{write}], move [{moves}], goto q{}", r.goto);
                emit(&mut src, &r.slot, "  ", &line);
            }
        }
    }
    write_own(&mut src, &Slot { own: spec.eof_own.clone(), trailing: None }, "");
    src
}

/// Every `TmAnchor` variant, `TmDirective` sub-variant, and `own_line` value the printer/parser pair
/// can produce, all in one fixture — the deterministic companion to
/// `printing_twice_after_a_reparse_is_idempotent` below: that property's generator is BELIEVED to
/// reach every one of these; this test DEMONSTRATES it, and proves the restated (idempotence)
/// property holds for the document that does. Each construct below carries an own-line comment above
/// it AND a trailing comment on its own line, which is what gives every anchor both `own_line` values
/// from one occurrence — except `Eof`, which `parse_tm_full` only ever drains as `own_line: true`
/// (there is no line left for a trailing comment to sit on), so this fixture's `Eof` comment is
/// own-line only, on purpose. `tape 1` (not `tape 0`) additionally proves the anchor carries the
/// PARSED index rather than a hardcoded one, matching `a_header_directive_carries_its_own_anchor`
/// above.
///
/// `TmAnchor::Tapes` carries TWO own-line comments (`about tapes` and `also about tapes`), not one —
/// every other anchor here has at most one, which is exactly why this deterministic test used to NOT
/// redden under the `.skip(1)` sabotage on `CommentWriter::own_line`: with a single own-line comment
/// per anchor, `.skip(1)` drops it entirely on the FIRST print, so the drop is already reflected in
/// `print_once`, and reparsing-then-reprinting drops nothing further — `print_once == print_twice`
/// still holds even though real data was lost. Two comments on one anchor make the loss GRADUAL
/// (`[A, B]` -> `[B]` -> `[]` across two prints), which is what makes `print_once != print_twice`
/// under the sabotage and gives this test the same bite the proptest property already has.
const ALL_ANCHORS: &str = "\
; about tapes
; also about tapes
tapes 2 ; tapes trailing
; about start
start q0 ; start trailing
; about version
version 1 ; version trailing
; about encoding
encoding unary ; encoding trailing
; about width
width 8 ; width trailing
; about slots
slots 1 ; slots trailing
; about result
result Nat ; result trailing
; about tape 1
tape 1 #____# ; tape trailing

; about q0
state q0: ; state trailing
  ; about the rule
  [a b] -> write [b a], move [R L], goto q1 ; rule trailing
state q1: accept
; eof own comment
";

#[test]
fn every_anchor_and_own_line_combination_reaches_a_fixed_point() {
    let d = parse_tm_full(ALL_ANCHORS);
    assert_eq!(d.diagnostics, vec![], "fixture must parse clean");

    let got: Vec<(&str, TmAnchor, bool)> = d.comments.iter().map(|c| (c.text.as_str(), c.anchor, c.own_line)).collect();
    assert_eq!(
        got,
        vec![
            ("about tapes", TmAnchor::Tapes, true),
            ("also about tapes", TmAnchor::Tapes, true),
            ("tapes trailing", TmAnchor::Tapes, false),
            ("about start", TmAnchor::Start, true),
            ("start trailing", TmAnchor::Start, false),
            ("about version", TmAnchor::Directive(TmDirective::Version), true),
            ("version trailing", TmAnchor::Directive(TmDirective::Version), false),
            ("about encoding", TmAnchor::Directive(TmDirective::Encoding), true),
            ("encoding trailing", TmAnchor::Directive(TmDirective::Encoding), false),
            ("about width", TmAnchor::Directive(TmDirective::Width), true),
            ("width trailing", TmAnchor::Directive(TmDirective::Width), false),
            ("about slots", TmAnchor::Directive(TmDirective::Slots), true),
            ("slots trailing", TmAnchor::Directive(TmDirective::Slots), false),
            ("about result", TmAnchor::Directive(TmDirective::Result), true),
            ("result trailing", TmAnchor::Directive(TmDirective::Result), false),
            ("about tape 1", TmAnchor::Directive(TmDirective::Tape(1)), true),
            ("tape trailing", TmAnchor::Directive(TmDirective::Tape(1)), false),
            ("about q0", TmAnchor::State(0), true),
            ("state trailing", TmAnchor::State(0), false),
            ("about the rule", TmAnchor::Rule { state: 0, index: 0 }, true),
            ("rule trailing", TmAnchor::Rule { state: 0, index: 0 }, false),
            ("eof own comment", TmAnchor::Eof, true),
        ]
    );

    // The restated property, not a literal round trip: printing twice must be stable, and reparsing
    // either printed form must recover the same document. (This particular fixture carries an
    // authored trailing comment on every anchor, including its one `tape` line, so `write_header`'s
    // generated-label path never fires for it — but the FIRST print does NOT equal `ALL_ANCHORS`
    // byte-for-byte: the source writes one space before each trailing `;` and `CommentWriter::trailing`
    // writes two, so every one of the ten trailing-comment lines above differs by that one space. No
    // assertion here depends on the first print matching the source; see
    // `printing_twice_after_a_reparse_is_idempotent`'s doc comment for why a literal round trip is
    // false in general.)
    let (print_once, parse_once, print_twice) = settle(&d);
    assert_eq!(print_twice, print_once, "printing a second time must change nothing");

    // NOT a check on `parse_twice`: once `print_twice == print_once`, `parse_tm_full(&print_twice)` is
    // `parse_tm_full` applied to a string already shown equal to `print_once` — a pure function fed
    // the same bytes — so `parse_twice` equals `parse_once` field-for-field by construction, and
    // asserting that again would be unable to fail. What needs checking is whether the first print
    // preserved what `d` (this fixture's own parse) carried.
    assert_eq!(parse_once.machine, d.machine);
    assert_eq!(parse_once.header, d.header);

    // `comments` is checked for SURVIVAL (a sub-multiset check), not equality — see
    // `printing_twice_after_a_reparse_is_idempotent`'s doc comment for why equality is false in
    // general (a fabricated `; reg`/`; work` tape label) and `is_sub_multiset`'s doc for why survival
    // has to count duplicates rather than merely check containment. For THIS fixture specifically
    // `d.comments` and `parse_once.comments` do in fact agree exactly, since every named tape line
    // here already carries an authored trailing comment — but the assertion below states the weaker,
    // always-true property on principle, matching the proptest.
    assert!(
        is_sub_multiset(&d.comments, &parse_once.comments),
        "every comment `d` carried must survive into `parse_once`: d.comments={:?} parse_once.comments={:?}",
        d.comments,
        parse_once.comments
    );
}

/// True when every element of `sub` reappears in `full` at least as many times as it appears in
/// `sub` — `sub` is a SUB-MULTISET of `full`, not merely a subset. Duplicates matter: `body()`'s
/// strategy CAN draw the same comment text twice for one anchor — how often it does was not
/// measured, and the reason to count duplicates does not need a frequency — and two comments with
/// identical text are two obligations for the printer to preserve, not one. Set containment
/// (`sub.iter().all(|c| full.contains(c))`) is blind to that — it is satisfied by `full` holding a
/// single copy while a second, otherwise-identical comment silently vanished, which is exactly the
/// kind of loss this check exists to catch. Implemented by removing each matched element from a
/// working copy of `full` so it cannot be reused to satisfy a second `sub` entry; `O(sub.len() *
/// full.len())`, which is fine at the sizes a generated `.tm` document reaches in this file's tests.
fn is_sub_multiset(sub: &[AnchoredComment<TmAnchor>], full: &[AnchoredComment<TmAnchor>]) -> bool {
    let mut remaining: Vec<&AnchoredComment<TmAnchor>> = full.iter().collect();
    for item in sub {
        match remaining.iter().position(|c| **c == *item) {
            Some(pos) => {
                remaining.remove(pos);
            }
            None => return false,
        }
    }
    true
}

use redextape_core::tm::syntax::TmDocument;

/// Print `d`, reparse the result, and print THAT: the computation both
/// `every_anchor_and_own_line_combination_reaches_a_fixed_point` and the property below need in order
/// to state the restated guarantee. Returns `(print_once, parse_once, print_twice)` — printing `d` for
/// the first time, what reparsing that text recovers, and printing THAT recovered document again — so
/// a caller can check the guarantee at the byte level (`print_twice == print_once`) and at the
/// document level (`parse_tm_full(&print_twice)` against `parse_once`).
///
/// Panics (via `print_tm_doc`'s `.expect`) if either print fails, which only happens when a
/// `TmDocument` has no machine — never true of `parse_once` when `d.diagnostics.is_empty()`, since a
/// clean parse always yields `Some(machine)` and `write_header`/the rest of the printer accept any
/// header/comment combination the parser can produce.
///
/// This helper is not itself a `#[test]` fn, so it falls outside `clippy.toml`'s
/// `allow-expect-in-tests` (that exemption reaches only code lexically inside a `#[test]` function or
/// a `#[cfg(test)]` module) — allowed here directly rather than by widening a file-level attribute,
/// which every other call site in this file still respects.
#[allow(clippy::expect_used)]
fn settle(d: &TmDocument) -> (String, TmDocument, String) {
    let print_once = print_tm_doc(d).expect("a clean parse prints");
    let parse_once = parse_tm_full(&print_once);
    let print_twice = print_tm_doc(&parse_once).expect("a clean parse prints");
    (print_once, parse_once, print_twice)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    /// The property the formatter's safety rests on — restated as IDEMPOTENCE, not a round trip from
    /// an arbitrary document.
    ///
    /// **Why the round trip (`parse(print(x)) == x`) is FALSE in general.** `write_header`
    /// (`tm::header::write_header`) labels a `tape <i>` line with a generated comment (`tape_name`:
    /// `; reg` / `; work` / `; stack` / `; heap` / `; box` for the five indices it names) whenever that
    /// anchor carries no AUTHORED trailing comment — `CommentWriter::has_trailing` is what decides
    /// "no authored comment". A hand-written file is not required to comment every `tape` line, so a
    /// `tape 0` line with nothing after it parses with no comment on that anchor and PRINTS with the
    /// generated label anyway; reparsing the printed text then records a comment (`; reg`, anchored to
    /// `Directive(Tape(0))`) that was never in the source. This is a PROPERTY of every generated label
    /// — true for any document with a named tape index whose line has no authored trailing comment,
    /// however many or few such lines it has — not a count of which tapes happen to trigger it.
    ///
    /// **Why idempotence (`print(parse(print(parse(x)))) == print(parse(x))`) is TRUE.** The first
    /// print may add a generated label, but by then it is ordinary TEXT sitting on that line. Reparsing
    /// it records that label as an AUTHORED trailing comment on the same anchor — parsing cannot tell
    /// a generated label from a hand-typed one, they are the same bytes. On the second print,
    /// `write_header`'s `has_trailing` check now sees that anchor as commented and takes the
    /// displacement branch (`an_authored_comment_takes_the_tape_line_over_the_generated_name` pins this
    /// branch directly): it writes the recorded text back out and never calls `tape_name` again. The
    /// generated-label path and the authored-comment path converge on identical bytes, which is what
    /// makes the second print equal to the first — not because nothing changed on the first print, but
    /// because whatever changed is now indistinguishable, to the printer, from something the author
    /// wrote.
    ///
    /// `doc_spec`/`render` still range over every `TmAnchor` variant — `Tapes`, `Start`, all six
    /// `TmDirective` variants, `State`, `Rule` and `Eof` — with both `own_line` values independently
    /// possible at each one (`Eof` excepted: the parser only ever drains it as `own_line: true`, so
    /// that is the one combination no document can produce). A typical case touches most of these at
    /// once, and in particular routinely generates a named `tape` line with no trailing comment at
    /// all — `tape_line_cand`'s `Slot` draws its `trailing` independently and `weighted(0.7, ..)` still
    /// leaves 30% with none — which is exactly the shape that made the literal round trip false above.
    #[test]
    fn printing_twice_after_a_reparse_is_idempotent(spec in doc_spec()) {
        let src = render(&spec);

        let first = parse_tm_full(&src);
        prop_assume!(first.diagnostics.is_empty());

        let (print_once, parse_once, print_twice) = settle(&first);

        // Byte-level idempotence: printing a second time changes nothing.
        prop_assert_eq!(&print_twice, &print_once);

        // NOT a check on `parse_twice`/`print_twice`: once `print_twice == print_once` holds,
        // `parse_tm_full(&print_twice)` is `parse_tm_full` applied to a string already shown equal
        // to `print_once` — a pure function fed the same bytes — so every field of `parse_twice`
        // equals the corresponding field of `parse_once` by construction, and asserting that again
        // here cannot fail. What actually needs checking is whether the first print preserved
        // anything: relate `parse_once` back to `first`, the parse of the ORIGINAL generated source.
        prop_assert_eq!(&parse_once.machine, &first.machine);
        prop_assert_eq!(&parse_once.header, &first.header);

        // `comments` is checked for SURVIVAL, not equality. Equality would be false in general — see
        // this property's doc comment above: `parse_once.comments` may legitimately carry a generated
        // `; reg`/`; work` label (`tm::header::write_header` via `tape_name`) that `first.comments`
        // does not, fabricated for an uncommented named `tape` line. But that asymmetry only ever ADDS
        // a comment; it says nothing about a comment `first` HAD that `parse_once` LACKS — and a
        // printer that stably dropped every comment would still satisfy every `prop_assert` above this
        // one. `is_sub_multiset` (a SUB-MULTISET check, not set containment — see its doc for why
        // duplicates need counting) is what closes that gap: every comment `first` carried must
        // reappear in `parse_once`.
        prop_assert!(
            is_sub_multiset(&first.comments, &parse_once.comments),
            "every comment `first` carried must survive into `parse_once`: first={:?} parse_once={:?}",
            first.comments,
            parse_once.comments
        );
    }
}
