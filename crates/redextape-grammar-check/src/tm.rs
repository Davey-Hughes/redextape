//! TM's grammar: its generated parser, its highlight queries, its capture table, and the thin
//! wrappers over `print_tm_mapped`/`print_tm_with_mapped` that make them TM's authority.
//!
//! **THE TM FORM HAS TWO PRINTERS AND THEY EMIT DIFFERENT CLASS SETS**, which is the fact design §6.3
//! got wrong until PR 3's survey corrected it. `print_tm_inner` is the one printer and the header
//! `Option` is the only difference between the entry points:
//!
//! | printer | header | classes | `Comment`? |
//! |---|---|---|---|
//! | `print_tm_mapped` | `None` | 7 | no |
//! | `print_tm_with_mapped` | `Some(h)` | 9 — plus `Comment` and `Ident` | yes |
//!
//! So this module carries TWO corpus builders rather than one, and which one a test uses decides
//! which classes that test can possibly exercise. See `printed_machine` and
//! `printed_machine_with_header`.
//!
//! Model the layout on `lambda.rs`, which went through review — but note the shapes genuinely differ
//! here, and that difference is the point rather than drift.

use crate::grammar::{Grammar, compare_classified};
use redextape_core::Span;
use redextape_core::analysis::TokenClass;
use redextape_core::tm::EncodingKind;
use tree_sitter_language::LanguageFn;

unsafe extern "C" {
    fn tree_sitter_redextape_tm() -> *const ();
}

/// Hand-written corpus, for the capture and pattern checks — NOT for the differential, whose corpus
/// is printed (`printed_machine`, `printed_machine_with_header`).
///
/// **EVERY ENTRY MUST PARSE UNDER `parse_tm`**, which `tests/tm.rs` asserts: these are hand-typed, so
/// nothing else establishes that they are TM at all. That constraint is why each carries a `tapes`
/// line, a `start` line and a reachable state rather than being a bare fragment.
///
/// Between them they reach every pattern in `queries/highlights.scm`
/// (`every_tm_query_pattern_fires_over_the_corpus`). Four of those patterns — `encoding`'s operand,
/// `result`'s operand, a `tape` line's packed run, and `@comment` — are reachable ONLY from a headered
/// file, so a corpus of header-less machines would leave them at zero coverage with every other test
/// still green. That is the gap `every_query_pattern_fires` was promoted onto `Grammar` to catch.
///
/// The last two entries are design §6.3's residue: comment positions **no printer can produce**, so
/// they have no differential authority and rest on this corpus plus `tree-sitter test`.
pub const CORPUS: &[(&str, &str)] = &[
    ("a minimal machine", "tapes 1\nstart s\n\nstate s: accept\n"),
    (
        "a rule with wildcards in both groups",
        "tapes 3\nstart s\n\nstate s:\n  [* * *] -> write [* * *], move [S S S], goto t\nstate t: accept\n",
    ),
    (
        "dotted, digit-bearing state names",
        "tapes 1\nstart wl1s2.s.sk0\n\nstate wl1s2.s.sk0:\n  [*] -> write [*], move [S], goto add4.a.c.cwb\nstate add4.a.c.cwb: accept\n",
    ),
    ("a state with no rules that is not an accept state", "tapes 1\nstart s\n\nstate s:\nstate t: accept\n"),
    (
        "the full header block, as the printer emits it",
        "tapes 2\nstart s\nversion 1\nencoding binary\nwidth 4\nslots 5\nresult List<Nat>\ntape 0 #0000#  ; reg\ntape 1 #0000#  ; work\n\nstate s: accept\n",
    ),
    // A HEADER IS ALL-OR-NOTHING: `HeaderParts::finish` reports "incomplete header" unless all four
    // of `encoding`/`width`/`slots`/`result` are present once ANY header directive is. This entry
    // carries the full set for that reason, not for coverage — a `result` line on its own does not
    // parse. `tape 9` needs `tapes 10`, because the range check in `finish` rejects an index outside
    // `0..n_tapes`; index 9 is past this compiler's own five named tapes, which is what makes it a
    // `tape` line the printer would write with no trailing comment.
    (
        "a tape line with no comment, and a nested result type",
        "tapes 10\nstart s\nversion 1\nencoding unary\nwidth 4\nslots 1\nresult List<List<Nat>>\ntape 9 #\n\nstate s: accept\n",
    ),
    // ---- design §6.3's residue: nothing in this project's pipeline emits any of these ----
    ("a whole-line comment", "; what this machine does\ntapes 1\nstart s\n\nstate s: accept\n"),
    // `; stack` is the third residue shape and it is the subtlest: unlike the two below it, the
    // PRINTER would happily write it — `tape_name` names indices 2, 3 and 4 `stack`, `heap` and
    // `box`. It is unreachable in practice because those three tapes start empty and
    // `TmHeader::new` drops empty tapes, so `run_tm_described` never produces a `tape 2` line at
    // all. Reachable-in-principle, unreachable-in-fact: the differential cannot get to it, so it
    // is carried here.
    (
        "a comment naming a tape this compiler never starts non-empty",
        "tapes 3\nstart s\nversion 1\nencoding unary\nwidth 4\nslots 1\nresult Nat\ntape 2 #  ; stack\n\nstate s: accept\n",
    ),
    (
        "a trailing comment on lines the printer never writes one on",
        "tapes 1  ; how many\nstart s  ; where it begins\n\nstate s:  ; the only state\n  [*] -> write [*], move [S], goto s  ; and its only rule\n",
    ),
];

/// TM's highlight queries, compiled into the binary so the test needs no file I/O and cannot read a
/// stale copy out of a build directory.
pub const HIGHLIGHTS: &str = include_str!("../../../grammars/tree-sitter-redextape-tm/queries/highlights.scm");

/// Where the two vocabularies meet, FOR TM. Design §5.1 records why the tables are per-grammar.
///
/// **TWO ROWS PROJECT TO `Ident` AND BOTH ARE REQUIRED.** `@variable` is `encoding`'s operand and
/// `@type` is `result`'s; `write_header` classifies both `Ident` because neither an encoding name nor
/// a type has a class of its own. Splitting the capture is what gets `result List<Nat>` coloured as a
/// type in an editor, and collapsing them would fail `capture_map_is_total` the moment the query file
/// kept using both.
///
/// **`@label` AND `@label.reference` ARE THE PAIR DESIGN §5.2 EXISTS FOR** — `Label` for a state name
/// where it is DEFINED, `StateName` for the same name as a `start` or `goto` target. TM is the
/// grammar that pays for that decision, and this is where the two become visible to the differential
/// as distinct.
///
/// There is no `@operator` row: TM emits no `Operator` class, and `->` is `@punctuation.delimiter`.
pub const CAPTURE_CLASSES: &[(&str, TokenClass)] = &[
    ("keyword", TokenClass::Keyword),
    ("number", TokenClass::Nat),
    ("label", TokenClass::Label),
    ("label.reference", TokenClass::StateName),
    ("variable", TokenClass::Ident),
    ("type", TokenClass::Ident),
    ("character", TokenClass::TapeSymbol),
    ("constant.builtin", TokenClass::Move),
    ("comment", TokenClass::Comment),
    ("punctuation.bracket", TokenClass::Punct),
    ("punctuation.delimiter", TokenClass::Punct),
];

/// TM's grammar: its generated parser, its highlight queries and its capture table together as one
/// `Grammar` value.
///
/// See `mini::MINI`'s doc comment for why `LanguageFn::from_raw` over the generated symbol, rather
/// than a hand-rolled transmute, is the sanctioned conversion.
pub static TM: Grammar = Grammar {
    name: "tm",
    // SAFETY: `tree_sitter_redextape_tm` is generated by `tree-sitter generate` and returns a pointer
    // to a `'static` `TSLanguage`, which is exactly what `LanguageFn::from_raw` requires. The ABI it
    // was generated at is pinned to 15 and checked by `abi_version_is_pinned` below, so a toolchain
    // bump that changes it fails here by name rather than as an opaque `set_language` error.
    language_fn: unsafe { LanguageFn::from_raw(tree_sitter_redextape_tm) },
    highlights: HIGHLIGHTS,
    capture_classes: CAPTURE_CLASSES,
};

/// Lower a mini-language program to a `Machine` and print it HEADER-LESS with its classification, or
/// `None` when the program does not lower.
///
/// **SEVEN CLASSES, NOT NINE.** This is `print_tm_mapped`, so no `Comment` and no `Ident` can appear
/// in what it returns — use `printed_machine_with_header` for those. Design §6.3.
///
/// **THIS MUST NOT SIMULATE.** The pipeline stops at `lower_tm`, which builds a `Machine`, and
/// `print_tm_mapped`, which prints one. Simulation is the TM-side analogue of the reduction the λ
/// corpus is forbidden from doing. The cost that makes it worth forbidding is the LOWERING, not the
/// run: `run_tm_described` builds a whole `Machine` before it steps once, and `MAX_MACHINE_STATES`
/// bounds that at 1,000,000 states — **roughly 700 MB at the 700-725 bytes per state
/// `examples/state_cost_probe.rs` measures** — refusing past it rather than growing. A reviewer
/// should treat a `simulate` in this function as a defect.
///
/// **Lowering is allowed to fail and that is not this function's failure to report** — `lower_asm`
/// returns `Result` because `LowerError` outcomes are expected for some programs. Callers filter on
/// `None`. Measured over `arb_expr_over` at both leaf ranges in use, 128 samples each: nothing
/// refused. The filter is real and currently idle; design §11.5 says what actually needs sizing.
///
/// `Unary::at(8)` rather than the default width: the field width is not what this corpus is about,
/// and a narrow one keeps a printed machine at roughly 19 KB instead of considerably more.
#[must_use]
pub fn printed_machine(src: &str) -> Option<(String, Vec<(Span, TokenClass)>)> {
    let (program, _diagnostics) = redextape_core::parser::parse(src);
    let program = program?;
    let core = redextape_core::desugar::desugar(&program);
    let prog = redextape_core::tm::lower_asm(&core).ok()?;
    let machine = redextape_core::tm::lower_tm(&prog, &redextape_core::tm::Unary::at(8));
    Some(redextape_core::tm::print_tm_mapped(&machine))
}

/// Lower a mini-language program and print it WITH a header, or `None` when it does not run.
///
/// **THIS IS THE ONLY PATH IN THIS CRATE THAT REACHES `Comment` AND `Ident`**, and it is the reason
/// design §6.3's gap is much narrower than that section originally claimed.
///
/// **IT SIMULATES, AND THAT IS PERMITTED HERE FOR EXACTLY THREE REASONS.** `run_tm_described` lowers,
/// fits the field width, RUNS the machine under `TM_DEFAULT_CAPS`, and hands back a `DescribedRun`
/// whose header the rest of the project already agrees is correct — `examples/tm_emit.rs` and
/// `examples/regen_fixtures.rs` both call it, and the two checked-in `.tm` fixtures are its output.
/// The alternative, hand-building a `TmHeader::new`, runs nothing but constructs a value no other
/// non-test caller constructs that way, and a header built wrongly is a corpus that checks text
/// nobody would ever write. The three bounds that make the simulation safe: `TM_DEFAULT_CAPS`, a
/// FIXED hand-chosen program list (`HEADERED_CORPUS`), and small programs only. **No generated
/// program may reach this function.**
///
/// **WHAT IT ACTUALLY REACHES, MEASURED.** Every entry yields all nine classes. `Unary` yields ONE
/// `Comment` span (`; reg`; `Unary::init_work()` is empty, so there is no `tape 1` line) and `Binary`
/// yields TWO (`; reg`, `; work`). Tapes 2-4 — `stack`, `heap`, `box` — start empty and
/// `TmHeader::new` drops empty tapes, so `; stack`, `; heap` and `; box` are unreachable from here and
/// stay in §6.3's residue alongside the whole-line comment.
#[must_use]
pub fn printed_machine_with_header(src: &str, kind: EncodingKind) -> Option<(String, Vec<(Span, TokenClass)>)> {
    let (program, _diagnostics) = redextape_core::parser::parse(src);
    let program = program?;
    let result = redextape_core::typeck::result_type(&program).ok()?;
    let core = redextape_core::desugar::desugar(&program);
    let described =
        redextape_core::tm::run_tm_described(&core, kind, result, redextape_core::tm::TM_DEFAULT_CAPS).ok()?;
    Some(redextape_core::tm::print_tm_with_mapped(&described.machine, &described.header))
}

/// The FIXED list of programs the headered corpus is built from, with the encoding each is printed
/// under. Fixed rather than generated because `printed_machine_with_header` simulates — see its doc.
///
/// **AT LEAST ONE `Binary` ENTRY IS LOAD-BEARING.** `Unary::init_work()` is empty, so a `Unary`-only
/// list would carry exactly one `Comment` span per entry and would never exercise a second `tape`
/// line at all.
pub const HEADERED_CORPUS: &[(&str, EncodingKind)] = &[
    ("1 + 2", EncodingKind::Unary),
    ("1 + 2", EncodingKind::Binary),
    ("3 - 5", EncodingKind::Binary),
    ("if 2 > 1 { 10 } else { 20 }", EncodingKind::Unary),
    ("cons(1, cons(2, nil))", EncodingKind::Binary),
];

/// Compare the TM grammar's projected captures against the printer's own classification of the same
/// printed text.
///
/// **THE DIRECTION MATTERS**, the same as `mini::compare` and `lambda::compare_printed`: the printer
/// is the authority because it is the only thing that can classify TM text at all. A divergence is
/// always a defect in `grammar.js` or `highlights.scm`, never a reason to relax the comparison.
///
/// # Errors
///
/// As `compare_classified`, run with TM's shipped `HIGHLIGHTS`.
pub fn compare_printed(text: &str, want: &[(Span, TokenClass)]) -> Result<(), String> {
    compare_classified(&TM, HIGHLIGHTS, text, want)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A toolchain bump that changes the generated ABI past what the Rust crate reads presents as a
    /// bare `set_language` failure, which reads like a build error rather than a version error.
    /// Pinning it here makes the message name the real cause.
    #[test]
    fn abi_version_is_pinned() {
        assert_eq!(
            TM.language().abi_version(),
            15,
            "regenerate with the pinned tree-sitter CLI 0.25.10; ABI 14 means tree-sitter.json was not picked up"
        );
    }
}
