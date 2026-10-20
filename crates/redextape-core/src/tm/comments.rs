//! Comments recovered from authored text, positioned by what they sit against.
//!
//! WHY AN ANCHOR AND NOT A SPAN. `token::Comment` carries a `Span` because the source form's
//! formatter walks tokens and can order a comment against them. The TM and asm printers walk a
//! `Machine` and a `Program` — they never see a token — so a byte offset into the text a comment
//! CAME from cannot say where to write it in the text being produced. Naming the printed line the
//! comment belongs to is what survives reformatting.
//!
//! WHY NOT A FIELD ON `Machine` OR `Program`. `lower_tm` states the rule twice and `tm::header`
//! holds it at the import level by not importing `Machine` at all. A machine that came out of
//! `lower_tm` has no comments and must print exactly what the listing golden pins — so comments must
//! not reach the compiler's output path.

use std::collections::HashMap;
use std::hash::Hash;

use crate::analysis::{Classified, TokenClass, push_span};
use crate::tm::machine::StateId;

/// A comment recovered from authored text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnchoredComment<A> {
    /// The body, WITHOUT the leading `;` and without the whitespace either side of it. A printer
    /// writes `; ` and then this. Storing the body rather than the raw lexeme is what makes
    /// `; x` and `;x` print alike instead of preserving an accident of typing.
    ///
    /// Owned rather than borrowed: a document that needs the text it came from in order to print
    /// is not a document, and a formatter has nothing else in scope.
    pub text: String,
    /// The printed line this comment belongs to.
    pub anchor: A,
    /// True when only whitespace separated the comment from the previous newline — so it sits on
    /// its own line above `anchor` rather than trailing it. Decided at parse time, where the line
    /// is already in hand, for the reason `token::Comment` gives for deciding it there.
    pub own_line: bool,
}

/// Which header directive line a TM comment sits against. One variant per line `write_header`
/// emits, in the order it emits them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TmDirective {
    Version,
    Encoding,
    Width,
    Slots,
    Result,
    /// A reduced file's `reduced` line.
    Reduced,
    /// A reduced file's `steps` line.
    Steps,
    /// `tape <i>`, by the tape index the line names.
    Tape(usize),
}

/// Which printed line a TM comment sits against. Total over `print_tm_inner`'s output: every line
/// it can emit has a variant here. `.tm` has no round-trip property — only idempotence
/// (`printing_twice_after_a_reparse_is_idempotent`) — and totality here is what lets THAT hold:
/// a variant missing for some line `print_tm_inner` emits would be a line no comment could ever
/// anchor to, on either print.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TmAnchor {
    /// The leading `tapes <n>` line.
    Tapes,
    /// The `start <name>` line.
    Start,
    Directive(TmDirective),
    /// A `state <name>:` line, by the id definition order assigns it.
    State(StateId),
    /// A rule line, by its owning state and its position within that state.
    Rule {
        state: StateId,
        index: usize,
    },
    /// Trailing comments with no line after them.
    Eof,
}

/// Which printed line an asm comment sits against. Total over `print_asm_with_inner`'s output.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AsmAnchor {
    /// The `result <ty>` directive.
    Result,
    /// A label line, by its index into `Program::labels` — not by name, because several labels may
    /// sit at one instruction index and `Program::labels` order is what the printer reproduces.
    Label(usize),
    /// An instruction line, by its index into `Program::code`.
    Instr(usize),
    /// Trailing comments with no line after them.
    Eof,
}

/// Split a line into its content and the body of its trailing comment, if any.
///
/// `;` starts a comment unconditionally in both grammars — that is what makes splitting on the
/// first one safe rather than any later check — so everything after the first `;` is the body,
/// including any further `;`.
#[must_use]
pub(crate) fn split_trailing(content: &str) -> (&str, Option<&str>) {
    match content.split_once(';') {
        Some((before, after)) => (before, Some(after.trim())),
        None => (content, None),
    }
}

/// A line's content with any trailing comment removed and the remainder trimmed.
///
/// `split_trailing`'s first half, which is what a caller wants when it needs only the content and
/// not the comment. It exists so that "where does this line's content end" is decided by one
/// function rather than at each site that happens to need it. Both grammars reach that decision
/// through `split_trailing` — TM's content side through this wrapper and its comment side through
/// `attach`, asm's both halves through a single destructured call — so a change to what starts a
/// comment lands in one place. That is the property.
///
/// The hazard in hand-rolling `line.split(';').next().unwrap_or("").trim()` beside `split_trailing` is
/// the duplication, not any disagreement: the two spellings agree — `split` always yields at least one
/// item, so the `unwrap_or` arm is unreachable and both answer with the prefix before the first `;`, or
/// the whole string when there is none — and nothing makes them agree. One change to what starts a
/// comment — an escape rule, say — would have to land in every copy.
#[must_use]
pub(crate) fn content_before_comment(line: &str) -> &str {
    split_trailing(line).0.trim()
}

/// The body of a whole-line comment: everything after the first `;`, trimmed.
///
/// Returns `None` for a line that is not a comment, so a caller cannot mistake a blank line for an
/// empty comment.
#[must_use]
pub(crate) fn whole_line(trimmed: &str) -> Option<&str> {
    trimmed.strip_prefix(';').map(str::trim)
}

/// The comment-emission rule, written once for both printers.
///
/// ONE IMPLEMENTATION BECAUSE IT IS ONE RULE, not two that happen to agree. The TM and asm
/// printers differ in what a line IS and agree completely on what to do with the comments around
/// one, so a second copy would be one rule maintained in two places — the drift this repository
/// treats as a defect rather than a style choice.
pub(crate) struct CommentWriter<'a, A> {
    own: HashMap<A, Vec<&'a str>>,
    trailing: HashMap<A, Vec<&'a str>>,
}

impl<'a, A: Copy + Eq + Hash> CommentWriter<'a, A> {
    /// Bucket by anchor once rather than rescanning per printed line — the reason
    /// `print_asm_mapped` buckets its labels, since both lists grow with program size.
    pub(crate) fn new(comments: &'a [AnchoredComment<A>]) -> Self {
        let mut own: HashMap<A, Vec<&'a str>> = HashMap::new();
        let mut trailing: HashMap<A, Vec<&'a str>> = HashMap::new();
        for c in comments {
            let bucket = if c.own_line { &mut own } else { &mut trailing };
            bucket.entry(c.anchor).or_default().push(c.text.as_str());
        }
        Self { own, trailing }
    }

    /// Write the own-line comments for `anchor`, each at `indent`, each ending its own line.
    ///
    /// The indent is the caller's because it belongs to the line being introduced: a comment above
    /// a rule lines up with the rule, not with the state header above it.
    pub(crate) fn own_line(&self, out: &mut String, spans: &mut Classified, anchor: A, indent: &str) {
        for text in self.own.get(&anchor).into_iter().flatten() {
            out.push_str(indent);
            push_span(out, spans, &format!("; {text}"), TokenClass::Comment);
            out.push('\n');
        }
    }

    /// Write the trailing comment for `anchor`, if any, WITHOUT the newline that ends the line.
    ///
    /// Several trailing comments on one anchor cannot each take the slot — `;` runs to end of line —
    /// so they join into one. A parse can never produce that case, but not merely because "a line
    /// holds at most one trailing comment and an anchor names one line", which is false for two
    /// anchors on its own: `TmAnchor::Tapes` and `TmAnchor::Start` are each named by `parse_tm_nav`
    /// from a FAMILY of lines (every `tapes ...` line, every `start ...` line), not from one fixed
    /// line, so a second line in either family would attach a second trailing comment to the same
    /// anchor with no diagnostic. What makes the anchor-names-one-line claim TRUE is that
    /// `parse_tm_nav` diagnoses a second `tapes` or `start` line as an error (the "duplicate `tapes`
    /// line" / "duplicate `start` line" diagnostics) and attaches no comment from it, so only the first
    /// line in either family ever reaches an anchor. `Directive`, `State` and `Rule` name at most one
    /// line — a `state`/rule/directive line is anchored by its own identity (index, state id, or
    /// directive key), not by a shared, uncounted keyword, and `HeaderParts::directive` refuses a
    /// duplicate directive the same way. `Eof` needs no such argument at all: it names no line —
    /// `parse_tm_nav` only ever drains it own-line, never trailing — so this function is never even
    /// called with it. So the join is total-by-construction for documents built by hand and
    /// unreachable for documents that were read. `.tm`'s guarantee — idempotence, not a round trip —
    /// is stated over the latter, which is why the join does not weaken it.
    ///
    /// `.tm` has no round-trip property; `printing_twice_after_a_reparse_is_idempotent` is what
    /// it has, because `write_header` fabricates a `tape_name` label that an authored document
    /// never carried.
    ///
    /// **This argument is `parse_tm_nav`-specific.** `CommentWriter` is generic over its anchor type,
    /// and the reasoning above does not transfer to another instantiation by itself.
    ///
    /// **`AsmAnchor` is the second instantiation, and for it the argument is DISCHARGED.**
    /// `print_asm_with_inner` is the printer that instantiates `CommentWriter<AsmAnchor>`.
    /// `AsmAnchor::Result` is diagnosed on either of its two branches — a second `result` line takes
    /// "duplicate `result` directive" when nothing has parsed yet, or "must precede the first
    /// instruction or label" once anything has — under one tail check that empties `comments` for the
    /// whole document whichever fired, so no second trailing comment ever reaches it.
    /// `AsmAnchor::Label(i)`/`Instr(i)` are positional, so no two lines in one clean parse can share an
    /// index. `AsmAnchor::Eof` is drained own-line only and is never passed to `trailing` at all. The
    /// full argument is written out in `printing_and_reparsing_all_anchors_recovers_the_document_exactly`'s
    /// doc comment in `crates/redextape-core/tests/asm_comments.rs`, which is what the strict `.asm`
    /// round trip rests on.
    ///
    /// **The two obligations still stand for a genuinely third anchor type.** Whoever instantiates
    /// `CommentWriter` there must establish, for that parser: one line holds at most one trailing
    /// comment, AND every anchor variant names at most one line. The second is the easy one to assume
    /// true without checking: `TmAnchor`'s `Tapes` and `Start` are each named from a family of lines.
    pub(crate) fn trailing(&self, out: &mut String, spans: &mut Classified, anchor: A) {
        let all: Vec<&str> = self.trailing.get(&anchor).into_iter().flatten().copied().collect();
        if !all.is_empty() {
            out.push_str("  ");
            push_span(out, spans, &format!("; {}", all.join(" ; ")), TokenClass::Comment);
        }
    }

    /// True when `anchor` carries a trailing comment. This is what lets `write_header` drop its
    /// generated tape label rather than write two comments onto one line.
    pub(crate) fn has_trailing(&self, anchor: A) -> bool {
        self.trailing.contains_key(&anchor)
    }
}

#[cfg(test)]
mod tests {
    use super::{content_before_comment, split_trailing, whole_line};

    #[test]
    fn a_second_semicolon_belongs_to_the_first_comment() {
        assert_eq!(split_trailing("start q0 ; a ; b"), ("start q0 ", Some("a ; b")));
    }

    #[test]
    fn a_line_with_no_semicolon_has_no_comment() {
        assert_eq!(split_trailing("start q0"), ("start q0", None));
    }

    #[test]
    fn content_stops_at_the_first_semicolon_and_is_trimmed() {
        assert_eq!(content_before_comment("  x  ; c"), "x");
        assert_eq!(content_before_comment("a;b;c"), "a");
        assert_eq!(content_before_comment("no comment here"), "no comment here");
    }

    /// The two inputs every caller can receive: an empty line, and a line that is nothing but a comment.
    #[test]
    fn an_empty_line_and_a_bare_comment_both_yield_empty_content() {
        assert_eq!(content_before_comment(""), "");
        assert_eq!(content_before_comment(";"), "");
        assert_eq!(content_before_comment("   "), "");
        assert_eq!(split_trailing(""), ("", None));
        assert_eq!(split_trailing(";"), ("", Some("")));
    }

    #[test]
    fn an_empty_body_is_a_comment_and_a_blank_line_is_not() {
        assert_eq!(whole_line(";"), Some(""));
        assert_eq!(whole_line(""), None);
    }
}
