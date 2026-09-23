//! Which of the four text forms a document is, and the one call into `redextape-core` that each
//! form's answer is.
//!
//! **THE `languageId` IS THE FILETYPE, AND THE FILETYPE IS ALREADY THIS REPOSITORY'S.**
//! `plugin/redextape.lua` registers exactly `redextape`, `redextape_asm`, `redextape_lambda` and
//! `redextape_tm`, and Neovim sends the buffer's filetype as `languageId`. So dispatch is a
//! four-arm match on strings this repository already owns: no extension sniffing here, and no
//! second place where "which language is this" gets decided. The sniffing that IS needed — `.tm`
//! and `.asm` are contested extensions — happens once, in that Lua file, before the server hears
//! about the buffer at all.

use gen_lsp_types::SymbolKind;
use redextape_core::Diagnostic;
use redextape_core::nav::{DefKind, NameIndex};

/// One of the four text forms this repository defines.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Language {
    /// `.rxt` — the source language.
    Redextape,
    /// `.rxlambda`
    Lambda,
    /// `.tm`
    Tm,
    /// `.asm`
    Asm,
}

impl Language {
    /// `None` for a `languageId` this server does not serve.
    ///
    /// An unrecognised id is answered rather than assumed: the caller still tracks the document,
    /// and every language-specific request returns empty. Guessing a front end for an unknown
    /// buffer would answer it with diagnostics from a language it is not written in.
    #[must_use]
    pub fn from_language_id(id: &str) -> Option<Self> {
        match id {
            "redextape" => Some(Language::Redextape),
            "redextape_lambda" => Some(Language::Lambda),
            "redextape_tm" => Some(Language::Tm),
            "redextape_asm" => Some(Language::Asm),
            _ => None,
        }
    }

    /// Every static diagnostic this form's front end reports over `src`.
    ///
    /// Slice 1 adds no analysis. All four of these are already written, already tested, and
    /// already consumed by the CLI and the web UI; each returns the same spanned `Diagnostic`.
    #[must_use]
    pub fn diagnostics(self, src: &str) -> Vec<Diagnostic> {
        match self {
            Language::Redextape => redextape_core::analyze(src).diagnostics,
            Language::Lambda => redextape_core::lambda::parse_lambda(src).1,
            Language::Tm => redextape_core::tm::parse_tm_full(src).diagnostics,
            Language::Asm => redextape_core::tm::parse_asm_full(src).diagnostics,
        }
    }

    /// The formatted form of `src`, or `None` when it does not parse.
    ///
    /// **`None` IS NOT AN ERROR PATH, IT IS THE ANSWER.** The formatter is `print ∘ parse` for all
    /// four forms, so a file that does not parse has nothing to print from. Returning the input
    /// unchanged would be indistinguishable to the editor from a file already formatted, and
    /// returning a partial print would hand the editor a truncated buffer. The caller turns this
    /// into an empty edit list, which is what LSP says "no changes" is.
    ///
    /// For `.tm` and `.asm` the comments survive formatting, which is the reason formatting
    /// these two forms is offered at all.
    #[must_use]
    pub fn format(self, src: &str) -> Option<String> {
        match self {
            Language::Redextape => redextape_core::format(src).ok(),
            Language::Lambda => {
                redextape_core::lambda::parse_lambda(src).0.as_ref().map(redextape_core::lambda::print_lambda)
            }
            Language::Tm => redextape_core::tm::print_tm_doc(&redextape_core::tm::parse_tm_full(src)),
            Language::Asm => redextape_core::tm::print_asm_doc(&redextape_core::tm::parse_asm_full(src)),
        }
    }

    /// What hover says at `offset`, or `None` when this form has nothing to say there.
    ///
    /// **THE FOURTH ONE-CALL-INTO-CORE, AND IT DECIDES AS LITTLE AS THE OTHER THREE.** `.rxlambda`
    /// answers `None` for the reason `nav` does and one more: `LambdaTerm` carries no span on any
    /// variant, so there is nothing to resolve a document position against. That is a designed gap,
    /// asserted by a test rather than left as an omission.
    ///
    /// **`nav` IS `doc.nav`, PASSED THROUGH RATHER THAN REBUILT.** Core's three functions used to
    /// call `parse_tm_nav`/`parse_asm_nav`/`nav_rxt` themselves — a full re-parse on every hover
    /// request, on top of the one `Document::nav` already pays and caches per version. `lib.rs`'s
    /// `hover` passes `doc.nav.as_ref()` straight through; core uses it instead of building its own.
    #[must_use]
    pub fn hover(
        self,
        src: &str,
        offset: usize,
        nav: Option<&NameIndex>,
    ) -> Option<redextape_core::hover::HoverAnswer> {
        match self {
            Language::Redextape => redextape_core::hover::rxt(src, offset, nav),
            Language::Tm => redextape_core::hover::tm(src, offset, nav),
            Language::Asm => redextape_core::hover::asm(src, offset, nav),
            Language::Lambda => None,
        }
    }

    /// The name-span index for this form, or `None` for a form that has none.
    ///
    /// **`None` IS NOT AN EMPTY INDEX.** An empty index says "this document contains no names",
    /// which is a claim about the document; `None` says "this server cannot answer navigation
    /// for this form", which is a claim about the server. `.rxlambda` waits on a term type that
    /// carries no source positions at all.
    ///
    /// `.rxt` answers `None` for a second reason: a document above `MAX_TOKENS` is refused by the
    /// parser before it runs, so there is no tree to index. `.tm` and `.asm` are line-oriented and
    /// have no such cap, which makes this asymmetry `.rxt`'s alone.
    #[must_use]
    pub fn nav(self, src: &str) -> Option<NameIndex> {
        match self {
            Language::Tm => Some(redextape_core::tm::parse_tm_nav(src).1),
            Language::Asm => Some(redextape_core::tm::parse_asm_nav(src).1),
            Language::Redextape => redextape_core::binder::nav_rxt(src),
            Language::Lambda => None,
        }
    }
}

/// The `SymbolKind` a document outline lists this definition as, or `None` for a definition an
/// outline should not list.
///
/// **THIS TAKES NO `Language`, AND THAT IS WHAT REPLACED A TEST.** `Language::symbol_kind`
/// answered one fixed kind per form, and `every_form_with_an_index_has_a_symbol_kind` existed to
/// stop `nav` and that match drifting apart — because a form gaining an index without gaining a
/// kind reports nothing in an outline, with no compile error. `DefKind` moves the answer to the
/// push site, so the match is exhaustive over kinds and a new one is a compile error here. The
/// test is gone; the compiler holds what it held.
///
/// **`None` MEANS "NOT AN OUTLINE SYMBOL", NOT "NOT INDEXED".** A parameter must be in the index —
/// go-to-definition on one has to land — but an outline node per parameter is noise whether flat
/// or nested under its `fn`: a parameter's navigability is what the index is for, and that is a
/// different question from what belongs in a document's outline. The name is `outline_kind` rather
/// than `symbol_kind` because those are two different questions and the old name answered one.
pub(crate) fn outline_kind(kind: DefKind) -> Option<SymbolKind> {
    match kind {
        // A TM state is a place the machine can be in; an asm label names a point in a program.
        // `Class` and `Function` are the nearest of the protocol's fixed set. Unchanged.
        DefKind::State => Some(SymbolKind::Class),
        DefKind::Label | DefKind::Fn => Some(SymbolKind::Function),
        DefKind::Let => Some(SymbolKind::Variable),
        DefKind::Param => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_four_filetypes_resolve_and_nothing_else_does() {
        assert_eq!(Language::from_language_id("redextape"), Some(Language::Redextape));
        assert_eq!(Language::from_language_id("redextape_lambda"), Some(Language::Lambda));
        assert_eq!(Language::from_language_id("redextape_tm"), Some(Language::Tm));
        assert_eq!(Language::from_language_id("redextape_asm"), Some(Language::Asm));

        // Not a near miss the server should be generous about: `rust` is a real `languageId` a
        // misconfigured client could send, and guessing a front end for it would answer a Rust
        // buffer with redextape diagnostics.
        assert_eq!(Language::from_language_id("rust"), None);
        assert_eq!(Language::from_language_id("redextape_"), None);
        assert_eq!(Language::from_language_id(""), None);
    }

    #[test]
    fn each_form_reports_the_diagnostics_its_own_front_end_reports() {
        // One erroring source per form, asserted against the front end directly rather than
        // against a message string — the dispatch is what is under test, not the wording.
        let rxt = "1 + true";
        assert_eq!(Language::Redextape.diagnostics(rxt), redextape_core::analyze(rxt).diagnostics);
        assert!(!Language::Redextape.diagnostics(rxt).is_empty());

        let lam = "λx.";
        assert_eq!(Language::Lambda.diagnostics(lam), redextape_core::lambda::parse_lambda(lam).1);
        assert!(!Language::Lambda.diagnostics(lam).is_empty());

        let tm = "tapes\n";
        assert_eq!(Language::Tm.diagnostics(tm), redextape_core::tm::parse_tm_full(tm).diagnostics);
        assert!(!Language::Tm.diagnostics(tm).is_empty());

        let asm = "li\n";
        assert_eq!(Language::Asm.diagnostics(asm), redextape_core::tm::parse_asm_full(asm).diagnostics);
        assert!(!Language::Asm.diagnostics(asm).is_empty());
    }

    /// Clean. 7 newlines, 116 bytes, so the document ends at line 7, character 0.
    const TM_COMMENTS: &str = "\
; a machine
tapes 1
start q0

state q0:
  [a] -> write [b], move [R], goto q1 ; and a trailing one
state q1: accept
";

    /// Clean. Note the TAB after `li` — that is what the printer emits and what the
    /// existing `asm_comments.rs` fixture uses.
    const ASM_COMMENTS: &str = "\
; a program
result Nat
f: ; the entry
    li\tr0, #1 ; and a trailing one
    ret
";

    #[test]
    fn each_form_formats_through_its_own_printer() {
        let rxt = "let   x=1;\nx+1";
        assert_eq!(Language::Redextape.format(rxt), redextape_core::format(rxt).ok());
        assert!(Language::Redextape.format(rxt).is_some());

        let lam = "λx.  x";
        let printed = redextape_core::lambda::parse_lambda(lam).0.as_ref().map(redextape_core::lambda::print_lambda);
        assert_eq!(Language::Lambda.format(lam), printed);
        assert!(Language::Lambda.format(lam).is_some());
    }

    #[test]
    fn formatting_keeps_the_comments_in_the_two_forms_that_have_them() {
        // THE WHOLE REASON PR A EXISTS. Before it, `print ∘ parse` over these two forms deleted
        // every comment in the file — in the files hand-writing is most plausible in. This asserts
        // the property from the consumer's side, which is where a regression would actually be
        // felt: nothing else in this crate would notice a printer that stably dropped them.
        let out = Language::Tm.format(TM_COMMENTS).expect("the fixture parses");
        assert!(out.contains("; a machine"), "own-line comment lost:\n{out}");
        assert!(out.contains("; and a trailing one"), "trailing comment lost:\n{out}");
        // The two assertions above would ALSO pass against a `format` that returned `src` unchanged
        // — `TM_COMMENTS` already holds both substrings verbatim. This one only the printer can
        // satisfy: it normalises the single space before a trailing comment to two, so a real
        // `print ∘ parse` round trip must differ from the input, byte for byte.
        assert_ne!(
            out, TM_COMMENTS,
            "format must answer with the PRINTER's output, not its input — the assertions above \
             would otherwise pass against a `format` that returned `src` unchanged"
        );

        let out = Language::Asm.format(ASM_COMMENTS).expect("the fixture parses");
        assert!(out.contains("; a program"), "own-line comment lost:\n{out}");
        assert!(out.contains("; and a trailing one"), "trailing comment lost:\n{out}");
        // Same, and asm's printer differs from its input twice over: the same trailing-comment
        // spacing, plus a blank line written before the `f:` label the fixture does not have.
        assert_ne!(
            out, ASM_COMMENTS,
            "format must answer with the PRINTER's output, not its input — the assertions above \
             would otherwise pass against a `format` that returned `src` unchanged"
        );
    }

    #[test]
    fn a_file_that_does_not_parse_is_not_formatted() {
        // There is no partial format. A file with an error has no machine, so nothing will print
        // it — and handing the editor a truncated buffer is worse than handing it nothing.
        assert_eq!(Language::Tm.format("tapes\n"), None);
        assert_eq!(Language::Asm.format("li\n"), None);
        assert_eq!(Language::Lambda.format("λx."), None);

        // A PARSE error, not a type error. `redextape_core::format` calls `parser::parse_full` and
        // nothing else, so `1 + true` — which does not typecheck — formats perfectly well. This
        // assertion is about the file the printer has nothing to print from.
        assert_eq!(Language::Redextape.format("let x = "), None);
        assert!(Language::Redextape.format("1 + true").is_some(), "a type error still formats");
    }

    #[test]
    fn three_of_the_four_forms_have_a_navigation_index() {
        assert!(Language::Tm.nav("tapes 1\nstart q0\nstate q0: accept\n").is_some());
        assert!(Language::Asm.nav("f:\n\tret\n").is_some());
        assert!(Language::Redextape.nav("let x = 1;\nx\n").is_some(), "the binder pass ships here");
        // `.rxlambda` waits on a term type that carries no source positions at all. `None` is the
        // answer and not an empty index: an empty index would claim the file has no names in it.
        assert!(Language::Lambda.nav("λx. x").is_none());
    }

    #[test]
    fn hover_reaches_core_for_every_dispatching_form_and_lambda_never_calls_in() {
        // Originally (Task 1) `hover::rxt`, `hover::tm` and `hover::asm` were all unconditional
        // `None` stubs, so this test alone could not prove WHICH stub a given `Language` arm
        // called — a mis-wiring that swapped `Tm`'s and `Asm`'s dispatch would have been
        // byte-identical to this assertion passing. What it proves, and has always proved, is that
        // `Language::hover`'s match has a LIVE arm for each of the three non-Lambda forms that
        // reaches `redextape_core::hover` at all, rather than a `Lambda`-only path with the other
        // three silently falling through to the same hard-coded `None`.
        // `hover_answers_content_only_through_the_matching_form` below is what proves WHICH arm,
        // now that `hover::rxt`, `hover::tm` and `hover::asm` all have real content to disagree
        // over — this test's own job stays narrower: only that the call reaches core at all.
        //
        // None of the three stubs remain, so each fixture below is instead a position its own live
        // handler genuinely has nothing to say about — a directive or declaration KEYWORD, never an
        // occurrence or a construct with content — so a `None` answer here means "the arm ran and
        // had nothing to add", not "the arm never ran".
        assert_eq!(Language::Redextape.hover("let x = 1;\nx", 0, None), None);
        assert_eq!(Language::Tm.hover("tapes 1\nstart q0\nstate q0: accept\n", 0, None), None);
        // On the `result` directive keyword — asm's own analogue of `.rxt`'s `let` and `.tm`'s
        // `tapes` above: a header line names no mnemonic and no label, so neither `instr_at` nor the
        // navigation index has anything here, unlike `"f:\n\tret\n"` (the fixture this used before
        // `hover::asm` had content), whose `f:` and `ret` now both answer.
        assert_eq!(Language::Asm.hover("result Nat\n", 0, None), None);
        // `.rxlambda` is the one arm that is deliberately hard-coded rather than dispatched — it
        // never reaches `redextape_core::hover` at all, which is the designed gap `Language::hover`'s
        // own doc comment names.
        assert_eq!(Language::Lambda.hover("λx. x", 0, None), None);
    }

    #[test]
    fn hover_answers_content_only_through_the_matching_form() {
        // Task 1 could not write this: with all three of `hover::rxt`, `hover::tm` and `hover::asm`
        // returning `None` unconditionally, a `Language::hover` match with `Redextape` and `Tm`
        // swapped was byte-identical to a correct one — there was no input for which the two
        // disagreed. `hover::rxt` now answers content for a literal, which is exactly the
        // disagreement that swap needs: feeding this `.rxt` source through `Language::Redextape`
        // must answer something, and the SAME text through `Language::Tm` or `Language::Asm` must
        // still answer `None`, a pair no crossed arm could satisfy.
        let src = "let x = 42;\nx\n";
        let at = src.find("42").expect("fixture holds it");
        assert!(Language::Redextape.hover(src, at, None).is_some(), "a literal must hover through Redextape");
        assert_eq!(Language::Tm.hover(src, at, None), None);
        assert_eq!(Language::Asm.hover(src, at, None), None);
    }

    #[test]
    fn an_outline_lists_functions_and_bindings_and_not_parameters() {
        // A parameter must be IN the index — go-to-definition on one has to land — but an outline
        // node per parameter is noise whether flat or nested under its `fn`: a parameter's
        // navigability is what the index is for. `None` here means "not an outline symbol", which
        // is why this is not called symbol_kind.
        assert_eq!(outline_kind(DefKind::Fn), Some(SymbolKind::Function));
        assert_eq!(outline_kind(DefKind::Let), Some(SymbolKind::Variable));
        assert_eq!(outline_kind(DefKind::Param), None);
        // Unchanged from the slice that shipped them.
        assert_eq!(outline_kind(DefKind::State), Some(SymbolKind::Class));
        assert_eq!(outline_kind(DefKind::Label), Some(SymbolKind::Function));
    }
}
