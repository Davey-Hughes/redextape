//! Token classification for every language in the project (§8, §9.4). One vocabulary spans all four,
//! so a renderer learns one enum rather than four.
//!
//! CORE EMITS CLASSES, NEVER COLOURS. No ANSI, no CSS, no theme — those belong to consumers (the CLI,
//! the web UI), which keeps this crate WASM-clean and matches the model/renderer split §9.1 locks in.
//!
//! WHY THE PRINTERS REPORT SPANS INSTEAD OF SOMETHING RE-LEXING THEIR OUTPUT. Only the source language
//! has a reusable lexer. λ's parser scans chars inline with no token type, TM's is line-oriented, and
//! asm has no parser at all — so "re-lex the printed text" would mean three new scanners recovering
//! structure the printer just discarded, each obliged to stay in step with its printer and nothing
//! forcing them to agree. That is the second-parallel-implementation failure this project's
//! conventions treat as a defect rather than a style choice.

use crate::core::NodeId;
use crate::lexer::lex;
use crate::sourcemap::SourceMap;
use crate::span::Span;
use crate::token::TokenKind;

/// What a span of printed or authored text IS. Shared variants first, then form-specific ones.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum TokenClass {
    Ident,
    Nat,
    Bool,
    Keyword,
    Operator,
    Punct,
    Comment,
    /// A λ binder: the `λ` and the name it binds.
    Binder,
    /// An asm mnemonic (`add`, `jz`, `cons`).
    Mnemonic,
    /// An asm register (`r0`, `a1`, `rr`).
    Register,
    /// An asm or TM label / state name in DEFINING position.
    Label,
    /// A TM state name in REFERENCE position (a `goto` target).
    StateName,
    /// A symbol on a TM tape, or a wildcard.
    TapeSymbol,
    /// A TM head move (`L`, `R`, `S`).
    Move,
}

/// Every `TokenClass` variant's name, in declaration order, so `names[c as usize] == name of c`.
///
/// EXPORTED SO THE TYPESCRIPT COPY CAN BE CHECKED RATHER THAN TRUSTED. `web/src/types.ts` holds the
/// same list by hand, and until now nothing could verify it — the residual risk its own doc names is
/// a variant added here and not mirrored there. That risk changes shape in Plan 5b: `LinkIndex` ships
/// classes as a `Uint8Array` of discriminants, so a REORDERING (not just an addition) would silently
/// mis-colour every span past the moved variant instead of producing an unrecognised string.
///
/// The list is written out rather than derived from a macro because the enum is written out too;
/// a macro pairing the two would be a third thing to keep in step. The test below is what makes the
/// pairing mechanical: it asserts the index of a variant at each end and in the middle, and pins the
/// count, so an insertion anywhere fails rather than shifting the tail by one.
#[must_use]
pub fn token_class_names() -> &'static [&'static str] {
    &[
        "Ident",
        "Nat",
        "Bool",
        "Keyword",
        "Operator",
        "Punct",
        "Comment",
        "Binder",
        "Mnemonic",
        "Register",
        "Label",
        "StateName",
        "TapeSymbol",
        "Move",
    ]
}

pub type Classified = Vec<(Span, TokenClass)>;

/// Append `text` to `out` and record the span it just occupied as `class`. The whole point of the
/// mapped printers: a span is produced BY the write that creates the text, so an offset cannot drift
/// from what was printed — there is no second pass to keep in step.
///
/// Sets the argument order every write-in-place helper follows: `(out, spans, ..payload)`. The two
/// sinks lead, always in that order, so a reader never has to check which end of a call the buffer is
/// at — and so the payload, the part that actually varies between helpers, is the part that varies in
/// the call.
pub(crate) fn push_span(out: &mut String, spans: &mut Classified, text: &str, class: TokenClass) {
    let start = out.len();
    out.push_str(text);
    spans.push((Span::new(start, out.len()), class));
}

/// A classified span plus the Core node it came from, when one is known. `None` covers machine
/// scaffolding and `defunc`-minted constructs, which have no source construct to point at — the same
/// asymmetry `tm::attribute`'s `StepBucket` already models. It is NOT a gap to be filled: the map says
/// nothing where the lowering said nothing, and a nearest-enclosing-node fallback is the caller's UI
/// heuristic to compute at its own call site, where it reads as one.
pub type Attributed = Vec<(Span, TokenClass, Option<NodeId>)>;

/// Cross printed TM spans with the source map: a span NAMING a state is attributed to whichever Core
/// node produced that state. This is what lets one construct light up in source, λ and TM at once.
///
/// Only `Label` (a state definition) and `StateName` (a `start`/`goto` target) can carry an origin. A
/// mnemonic, tape symbol or move is not a state reference even when its text happens to be spelled
/// like one, so it is left unattributed rather than looked up.
///
/// TAKES NO `Machine`, AND THAT IS THE WHOLE OF THE GUARANTEE. It once took one, purely to turn the
/// map's `StateId`s into the names the text uses; `SourceMap` now records that association itself, at
/// build time, against the very machine it was built from (`SourceMap::tm_owner`). There is therefore
/// no second object to pass and no wrong one to pass. The version that took both could not check they
/// described one lowering: a map built at one encoding, indexed through a machine lowered at another,
/// resolved each id to some other state's name and attributed the majority of state-naming spans to
/// the wrong construct — no error, no empty result, just a confidently wrong highlight.
///
/// Takes `text` because a `Span` carries offsets, not the bytes at those offsets — resolving a state
/// name means slicing the string the spans were produced against. Total: an out-of-range span or an
/// unknown name yields `None`, never a panic, and the span sequence is returned unchanged in order.
#[must_use]
pub fn attribute_tm_spans(text: &str, map: &SourceMap, spans: &Classified) -> Attributed {
    spans
        .iter()
        .map(|(span, class)| {
            let node = matches!(class, TokenClass::Label | TokenClass::StateName)
                .then(|| text.get(span.start..span.end).and_then(|name| map.tm_owner(name)))
                .flatten();
            (*span, *class, node)
        })
        .collect()
}

/// Classify mini-language source. Reuses the existing lexer — no second scanner. Diagnostics are
/// discarded here on purpose: highlighting a file with errors is exactly when it matters most, so
/// whatever tokens the lexer recovered are classified and the errors are surfaced through `analyze`.
#[must_use]
pub fn classify_source(src: &str) -> Classified {
    let (tokens, comments, _diagnostics) = lex(src);
    let mut out: Classified =
        tokens.iter().filter(|t| t.kind != TokenKind::Eof).map(|t| (t.span, class_of(t.kind))).collect();
    // A MERGE, NOT A RECONCILIATION. A comment can never overlap a token — the lexer consumes it whole
    // before emitting anything else — so ordering the union by start offset is the entire operation,
    // and `class_of` stays the exhaustive match it was. `TokenClass::Comment` was declared and
    // unreachable until this line.
    out.extend(comments.iter().map(|c| (c.span, TokenClass::Comment)));
    out.sort_by_key(|(s, _)| s.start);
    out
}

fn class_of(k: TokenKind) -> TokenClass {
    match k {
        TokenKind::Nat(_) => TokenClass::Nat,
        TokenKind::Ident => TokenClass::Ident,
        TokenKind::True | TokenKind::False => TokenClass::Bool,
        TokenKind::Fn | TokenKind::Let | TokenKind::Mut | TokenKind::If | TokenKind::Else | TokenKind::While => {
            TokenClass::Keyword
        }
        TokenKind::Plus
        | TokenKind::Minus
        | TokenKind::Star
        | TokenKind::Eq
        | TokenKind::Ne
        | TokenKind::Lt
        | TokenKind::Le
        | TokenKind::Gt
        | TokenKind::Ge
        | TokenKind::Assign => TokenClass::Operator,
        TokenKind::LParen
        | TokenKind::RParen
        | TokenKind::LBrace
        | TokenKind::RBrace
        | TokenKind::LBracket
        | TokenKind::RBracket
        | TokenKind::Comma
        | TokenKind::Semi
        | TokenKind::Pipe
        | TokenKind::Dot => TokenClass::Punct,
        // Kept apart from the real-punctuation arm above rather than merged into it, even though both
        // produce `Punct` today: `Eof` is a synthetic end-of-scan marker with no source character
        // behind it (and `classify_source` already filters it out before classifying), not a
        // punctuation glyph — the two are different "not real content" cases that happen to share a
        // rendering class now but are not the same case.
        #[allow(clippy::match_same_arms)]
        TokenKind::Eof => TokenClass::Punct,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_source_labels_keywords_names_and_literals() {
        let src = "let mut x = 1 + y;";
        let got = classify_source(src);
        let slice = |s: Span| &src[s.start..s.end];
        let pairs: Vec<(&str, TokenClass)> = got.iter().map(|(s, c)| (slice(*s), *c)).collect();
        assert_eq!(
            pairs,
            vec![
                ("let", TokenClass::Keyword),
                ("mut", TokenClass::Keyword),
                ("x", TokenClass::Ident),
                ("=", TokenClass::Operator),
                ("1", TokenClass::Nat),
                ("+", TokenClass::Operator),
                ("y", TokenClass::Ident),
                (";", TokenClass::Punct),
            ]
        );
    }

    #[test]
    fn classify_source_omits_eof_and_stays_in_bounds() {
        let src = "1 + 2";
        for (span, _) in classify_source(src) {
            assert!(span.start <= span.end && span.end <= src.len(), "span out of bounds: {span:?}");
            assert!(span.start < span.end, "no zero-width spans: {span:?}");
        }
    }

    #[test]
    fn classify_source_is_total_on_malformed_input() {
        // Lexing a program with an illegal character must not panic; whatever tokens survive classify.
        let _ = classify_source("let x = @@@;");
        let _ = classify_source("");
    }

    #[test]
    fn classify_source_emits_comment_spans_in_offset_order() {
        let src = "1 + // why\n2 // and again";
        let got = classify_source(src);
        let slice = |s: Span| &src[s.start..s.end];
        let pairs: Vec<(&str, TokenClass)> = got.iter().map(|(s, c)| (slice(*s), *c)).collect();
        assert_eq!(
            pairs,
            vec![
                ("1", TokenClass::Nat),
                ("+", TokenClass::Operator),
                ("// why", TokenClass::Comment),
                ("2", TokenClass::Nat),
                ("// and again", TokenClass::Comment),
            ]
        );
    }

    #[test]
    fn classified_spans_are_sorted_and_do_not_overlap() {
        let src = "// lead\nlet x = 1; // trail\nx";
        let got = classify_source(src);
        // BOTH COMMENTS MUST BE PRESENT, and this assertion is what makes the ordering check below
        // mean something. The tokens alone are already sorted and non-overlapping, so without this a
        // regression that dropped every comment span would leave the ordering assertion green.
        assert_eq!(
            got.iter().filter(|(_, c)| *c == TokenClass::Comment).count(),
            2,
            "both comments must reach the output: {got:?}"
        );
        assert!(
            got.windows(2).all(|w| w[0].0.end <= w[1].0.start),
            "a consumer indexes these in order; overlapping spans would double-colour bytes"
        );
    }

    #[test]
    fn token_class_names_is_indexed_by_discriminant() {
        // EVERY VARIANT, AND THE INDEX IS THE DISCRIMINANT. `LinkIndex` ships span classes across the
        // wasm boundary as a `Uint8Array` of these indices, so a name at the wrong index mis-colours
        // silently rather than producing an unrecognised string.
        //
        // EVERY VARIANT IS NAMED, NOT THREE SPOT-CHECKS. Anchoring only the ends and the middle misses
        // a TRANSPOSITION: swapping two variants between the anchors moves neither anchor's
        // discriminant nor the count. And comparing `names` against a bare array literal would be
        // worse — it pins one literal against another and never evaluates a discriminant at all, so an
        // enum reordered without touching the literal would still pass. Writing `c as usize` beside
        // each spelling is what makes this test about the enum.
        let names = token_class_names();
        let expected = [
            (TokenClass::Ident, "Ident"),
            (TokenClass::Nat, "Nat"),
            (TokenClass::Bool, "Bool"),
            (TokenClass::Keyword, "Keyword"),
            (TokenClass::Operator, "Operator"),
            (TokenClass::Punct, "Punct"),
            (TokenClass::Comment, "Comment"),
            (TokenClass::Binder, "Binder"),
            (TokenClass::Mnemonic, "Mnemonic"),
            (TokenClass::Register, "Register"),
            (TokenClass::Label, "Label"),
            (TokenClass::StateName, "StateName"),
            (TokenClass::TapeSymbol, "TapeSymbol"),
            (TokenClass::Move, "Move"),
        ];
        assert_eq!(names.len(), expected.len(), "a variant was added or removed without updating either list");
        for (class, spelling) in expected {
            assert_eq!(names[class as usize], spelling, "{spelling} is not at its own discriminant");
        }
    }
}
