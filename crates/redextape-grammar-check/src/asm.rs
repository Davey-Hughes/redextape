//! Asm's grammar: its generated parser, its highlight queries, its capture table, and the thin
//! wrappers over `print_asm_mapped`/`print_asm_with_mapped` that make them asm's authority.
//!
//! **TWO PRINTER ENTRY POINTS, ONE PRINTER.** `print_asm_with_mapped` prepends the header and
//! shifts the listing's spans by its byte length; the listing's bytes are identical either way.
//!
//! | printer | header | classes |
//! |---|---|---|
//! | `print_asm_mapped` | none | 5 — `Label`, `Mnemonic`, `Nat`, `Punct`, `Register` |
//! | `print_asm_with_mapped` | `AsmHeader` | 7 — those, plus `Keyword` and `Ident` |
//!
//! **NEITHER EVER EMITS `Comment`.** `emit --lang asm` writes one in `ASM_PREAMBLE`, but that is
//! the CLI prepending text no printer classifies, so `TokenClass::Comment` never appears on the
//! authority side of this crate's asm differential. See `tests/asm.rs`.
//!
//! Model the layout on `tm.rs`, which went through review — but the shapes genuinely differ here
//! and the differences are the point rather than drift.

use crate::grammar::{Grammar, compare_classified};
use redextape_core::Span;
use redextape_core::analysis::TokenClass;
use tree_sitter_language::LanguageFn;

unsafe extern "C" {
    fn tree_sitter_redextape_asm() -> *const ();
}

/// Hand-written corpus, for the capture and pattern checks — NOT for the differential, whose corpus
/// is printed (`printed_program`, `printed_program_with_header`).
///
/// **EVERY ENTRY MUST PARSE UNDER `parse_asm_full`**, which `tests/asm.rs` asserts.
///
/// Between them they reach every pattern in `queries/highlights.scm`
/// (`every_asm_query_pattern_fires_over_the_corpus`). Three of those patterns — `result`'s keyword,
/// `result`'s operand and `@comment` — are unreachable from a header-less listing, and `@comment`
/// is unreachable from any printer at all, so a corpus of bare listings would leave them at zero
/// coverage with every other test still green.
///
/// The last three entries are the residue: a comment position no printer produces, and the two
/// label names `_label_name`'s aliases exist for.
pub const CORPUS: &[(&str, &str)] = &[
    ("an empty file", ""),
    ("one nullary instruction", "    halt\n"),
    ("a label and an instruction", "foo:\n    halt\n"),
    (
        "every operand kind",
        "    li\tr0, #1\n    mov\ta0, r0\n    add\trr, r0, a0\n    jz\trr, skip1\n    jmp\tskip1\nskip1:\n    call\tskip1\n    ret\n",
    ),
    (
        "the list instructions",
        "    nil\tr0\n    cons\tr1, r0, r0\n    head\tr2, r1\n    tail\tr3, r1\n    isempty\tr4, r1\n",
    ),
    ("the boxing instructions", "    box\tr0, r1\n    box_get\tr2, r0\n    box_set\tr0, r2\n"),
    ("a dotted, digit-bearing label name", "count_down.0:\n    ret\n"),
    ("the header, as the printer emits it", "result Nat\n\n    li\trr, #7\n    halt\n"),
    ("a nested result type", "result List<List<Nat>>\n\n    nil\trr\n    halt\n"),
    // ---- the residue: nothing in this project's PRINTER pipeline emits any of these ----
    ("a whole-line comment, as `emit --lang asm` writes one", "; Register-assembly listing\n    halt\n"),
    (
        "a trailing comment, which the parser accepts everywhere and no printer writes",
        "    halt\t; done\nfoo:  ; here\n",
    ),
    ("labels spelled like reserved words", "halt:\nresult:\n    halt\n"),
];

/// Asm's highlight queries, compiled into the binary so the test needs no file I/O and cannot read
/// a stale copy out of a build directory.
pub const HIGHLIGHTS: &str = include_str!("../../../grammars/tree-sitter-redextape-asm/queries/highlights.scm");

/// Where the two vocabularies meet, FOR ASM. Design §5.1 of the tree-sitter spec records why the
/// tables are per-grammar.
///
/// **TWO ROWS PROJECT TO `Label` AND THE DIFFERENTIAL CANNOT TELL THEM APART.** `Operand::class`
/// maps a label operand to `Label` and `print_asm_mapped` pushes `Label` for a declaration too;
/// `TokenClass::StateName` is a TM-only distinction. The captures are kept separate so an editor
/// can theme a definition differently from a reference — the projection map is allowed to be
/// many-to-one, and `capture_map_has_no_duplicate_keys` checks it is a function, not an injection.
/// `each_label_capture_lands_on_its_own_positions` in `tests/asm.rs` is what actually holds the two
/// apart, because `compare_classified` structurally cannot.
///
/// **`@comment` HAS NO PRINTER.** It is in the map because a query uses it and
/// `capture_map_is_total` requires a row; `Comment` never appears on the authority side.
///
/// There is no `@punctuation.bracket` row and no `@operator` row: this form has no brackets and
/// emits no `Operator` class, and either row would fail `every_capture_row_is_used`.
pub const CAPTURE_CLASSES: &[(&str, TokenClass)] = &[
    ("keyword", TokenClass::Keyword),
    ("type", TokenClass::Ident),
    ("function", TokenClass::Mnemonic),
    ("variable.builtin", TokenClass::Register),
    ("number", TokenClass::Nat),
    ("label", TokenClass::Label),
    ("label.reference", TokenClass::Label),
    ("punctuation.delimiter", TokenClass::Punct),
    ("comment", TokenClass::Comment),
];

/// Asm's grammar: its generated parser, its highlight queries and its capture table together as one
/// `Grammar` value.
///
/// See `mini::MINI`'s doc comment for why `LanguageFn::from_raw` over the generated symbol, rather
/// than a hand-rolled transmute, is the sanctioned conversion.
pub static ASM: Grammar = Grammar {
    name: "asm",
    // SAFETY: `tree_sitter_redextape_asm` is generated by `tree-sitter generate` and returns a
    // pointer to a `'static` `TSLanguage`, which is exactly what `LanguageFn::from_raw` requires.
    // The ABI it was generated at is pinned to 15 and checked by `abi_version_is_pinned` below, so
    // a toolchain bump that changes it fails here by name rather than as an opaque `set_language`
    // error.
    language_fn: unsafe { LanguageFn::from_raw(tree_sitter_redextape_asm) },
    highlights: HIGHLIGHTS,
    capture_classes: CAPTURE_CLASSES,
};

/// Compare the asm grammar's projected captures against the printer's own classification of the
/// same printed text.
///
/// **THE DIRECTION MATTERS**, the same as every sibling: the printer is the authority because it is
/// the only thing that can classify asm text at all. A divergence is a defect in `grammar.js` or
/// `highlights.scm`, never a reason to relax the comparison.
///
/// # Errors
///
/// As `compare_classified`, run with asm's shipped `HIGHLIGHTS`.
pub fn compare_printed(text: &str, want: &[(Span, TokenClass)]) -> Result<(), String> {
    compare_classified(&ASM, HIGHLIGHTS, text, want)
}

/// `lower_program`'s template, reproduced. `redextape_core::tm::lower_program` is private, and this
/// is the third documented duplicate of it in this workspace — `redextape-native`'s
/// `tests/native_oracle.rs` and `redextape-core`'s `tests/guard_counterexamples.rs` are the other
/// two, both of which say so in a doc comment.
///
/// **THE ORDER IS LOAD-BEARING AND IS NOT A PREFERENCE.** Try the program as first-order Core
/// unchanged, and defunctionalize only when the direct attempt rejects it as higher-order.
/// `lower_program`'s own doc records what the other order costs: `defunc` treats any bare `Lambda`
/// in `Let`'s value position as a higher-order value-use, so defunctionalizing first regresses
/// `let add1 = |x| x + 1; add1(41)` from lowering cleanly to `LowerError`. `TooDeep` is returned
/// immediately rather than retried: it is never a signal that defunctionalizing would help.
///
/// **THIS IS WHAT REACHES `box`/`box_get`/`box_set`.** Those three `Instr` variants are emitted only
/// by `defunc`'s mutable-capture boxing rewrite, so a builder that called `lower_asm` alone would
/// leave three of the sixteen variants — and three of the twenty-four mnemonics — outside every
/// corpus in this crate.
fn lower_via_program_template(core: &redextape_core::core::Core) -> Option<redextape_core::tm::Program> {
    match redextape_core::tm::lower_asm(core) {
        Ok(p) => return Some(p),
        Err(redextape_core::tm::LowerError::Unsupported { .. }) => {}
        Err(redextape_core::tm::LowerError::TooDeep { .. }) => return None,
    }
    let defunced = redextape_core::tm::defunc::defunc(core).ok()?;
    redextape_core::tm::lower_asm(&defunced).ok()
}

/// Lower a mini-language program to a `Program` and print it HEADER-LESS with its classification,
/// or `None` when the program does not lower.
///
/// **FIVE CLASSES, NOT SEVEN.** This is `print_asm_mapped`, so no `Keyword` and no `Ident` can
/// appear in what it returns — use `printed_program_with_header` for those.
///
/// **THIS MUST NOT RUN.** The pipeline stops at the lowering and the printer. `run_asm` exists and
/// is one import away; calling it here would be the asm analogue of the reduction the λ corpus is
/// forbidden from doing, and a reviewer should treat it as a defect.
///
/// **Lowering is allowed to fail and that is not this function's failure to report.** Callers
/// filter on `None`. Measured over 64 samples of `arb_expr_over` at the leaf range in use: nothing
/// refused. The filter is real and currently idle.
#[must_use]
pub fn printed_program(src: &str) -> Option<(String, Vec<(Span, TokenClass)>)> {
    let (program, _diagnostics) = redextape_core::parser::parse(src);
    let program = program?;
    let core = redextape_core::desugar::desugar(&program);
    let prog = lower_via_program_template(&core)?;
    Some(redextape_core::tm::print_asm_mapped(&prog))
}

/// Lower a mini-language program and print it WITH a `result` header, or `None` when it does not
/// lower or its result type is not one the directive can express.
///
/// **THIS IS THE ONLY PATH IN THIS MODULE THAT REACHES `Keyword` AND `Ident`.**
///
/// **THE HEADER IS BUILT THE WAY `emit --lang asm` BUILDS IT, DELIBERATELY.**
/// `crates/redextape-cli/src/emit.rs` runs the result type through `ty::show` and back through
/// `ty::parse_ty`, and writes a header only when that round trip succeeds — `parse_ty` admits
/// exactly `Nat`/`Bool`/`Unit`/`List<T>`, and `AsmHeader` must not carry anything its own reader
/// would reject. Constructing an `AsmHeader` some other way would produce text no writer in this
/// project emits, which is a corpus that checks something nobody would ever see.
///
/// **IT DOES NOT RUN ANYTHING.** `typeck::result_type` is a type, not an execution, which is why
/// this needs none of the bounds `tm::printed_machine_with_header` documents for its simulation.
#[must_use]
pub fn printed_program_with_header(src: &str) -> Option<(String, Vec<(Span, TokenClass)>)> {
    let (program, _diagnostics) = redextape_core::parser::parse(src);
    let program = program?;
    let ty = redextape_core::typeck::result_type(&program).ok()?;
    let core = redextape_core::desugar::desugar(&program);
    let prog = lower_via_program_template(&core)?;
    let result = redextape_core::ty::parse_ty(&redextape_core::ty::show(&ty))?;
    Some(redextape_core::tm::print_asm_with_mapped(&prog, &redextape_core::tm::AsmHeader { result }))
}

/// The FIXED list the headered corpus is built from. Fixed rather than generated because
/// `arb_expr_over` is five arms over numeric leaves and reaches nine of the twenty-four mnemonics;
/// everything structurally interesting in this form is here.
///
/// **THE FIRST TWELVE ARE `asm_roundtrip.rs`'s `DEMOS`, IN ORDER**, reused because they were
/// already chosen for `Instr`-variant coverage and are already held to the round-trip properties.
/// There is no shared `const` between the two files, so the two lists can drift; that is accepted,
/// since they answer different questions.
///
/// **THE LAST FIVE ARE THIS CRATE'S OWN ADDITIONS, EACH FOR A NAMED GAP.** The mutable-capture
/// closure is the only entry that needs the `defunc` retry and the only one that reaches
/// `box`/`box_get`/`box_set`. The four comparisons reach `cmpne`, `cmplt`, `cmple` and `cmpge`,
/// which `DEMOS` alone does not: measured, `DEMOS` plus the closure reaches 20 of 24 mnemonics and
/// this list reaches all 24 (`the_fixed_corpus_reaches_every_mnemonic`).
pub const FIXED_CORPUS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "let add1 = |x| x + 1; add1(41)",
    "head(cons(7, nil))",
    "is_empty(nil)",
    "[1, 2, 3]",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "let mut x = 1; x = x + 1; let x = x + 10; x",
    "let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc",
    "tail(cons(7, nil))",
    "let mut acc = 0; let bump = |n| { acc = acc + n; acc }; bump(1); acc",
    "if 1 != 2 { 1 } else { 0 }",
    "if 1 < 2 { 1 } else { 0 }",
    "if 1 <= 2 { 1 } else { 0 }",
    "if 1 >= 2 { 1 } else { 0 }",
];

#[cfg(test)]
mod tests {
    use super::*;

    /// A toolchain bump that changes the generated ABI past what the Rust crate reads presents as a
    /// bare `set_language` failure, which reads like a build error rather than a version error.
    /// Pinning it here makes the message name the real cause.
    #[test]
    fn abi_version_is_pinned() {
        assert_eq!(
            ASM.language().abi_version(),
            15,
            "regenerate with the pinned tree-sitter CLI 0.25.10; ABI 14 means tree-sitter.json was not picked up"
        );
    }
}
