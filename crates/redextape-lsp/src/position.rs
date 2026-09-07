//! `Span` (a byte range) to an LSP `Position` (a line and a character), under a negotiated
//! encoding.
//!
//! **THE ENCODING IS NEGOTIATED RATHER THAN CHOSEN.** LSP counts `character` in UTF-16 code units
//! unless the client and server agree otherwise. This server reads
//! `InitializeParams.capabilities.general.positionEncodings`, prefers `utf-8` when it is offered,
//! and echoes the result in `ServerCapabilities.positionEncoding`. A client that offers no list
//! gets `utf-16`, which is the protocol's default and therefore the only correct fallback.
//!
//! Under `utf-8` a byte column IS the character column and no re-encoding happens at all, which is
//! the path the intended consumer takes: Neovim advertises `{ "utf-8", "utf-16", "utf-32" }`.

use gen_lsp_types::{Position, PositionEncodingKind, Range};
use redextape_core::Span;

/// The position encoding this server and the client agreed on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Encoding {
    /// `character` counts bytes, so it is the byte column and nothing is re-encoded.
    Utf8,
    /// `character` counts UTF-16 code units. The protocol's default.
    Utf16,
}

impl Encoding {
    /// Pick from the list the client offered in `general.positionEncodings`.
    ///
    /// `None` is a client that sent no list, which the protocol says means `utf-16`. So does a
    /// list that offers only encodings this server does not implement — `utf-32` is not a
    /// permitted answer to a client that did not ask for it.
    #[must_use]
    pub fn negotiate(offered: Option<&[PositionEncodingKind]>) -> Self {
        match offered {
            Some(kinds) if kinds.contains(&PositionEncodingKind::UTF8) => Encoding::Utf8,
            _ => Encoding::Utf16,
        }
    }

    /// What to echo back in `ServerCapabilities.positionEncoding`.
    #[must_use]
    pub fn kind(self) -> PositionEncodingKind {
        match self {
            Encoding::Utf8 => PositionEncodingKind::UTF8,
            Encoding::Utf16 => PositionEncodingKind::UTF16,
        }
    }
}

/// Line-start byte offsets for one version of one document.
///
/// It holds offsets and not the text: the `Document` that owns the text passes it back in at query
/// time, so one version of a file is stored once rather than twice.
pub struct LineIndex {
    /// Byte offset of the first byte of each line. Always begins with `0`, so it is never empty.
    starts: Vec<usize>,
}

impl LineIndex {
    #[must_use]
    pub fn new(text: &str) -> Self {
        let mut starts = vec![0];
        starts.extend(text.match_indices('\n').map(|(i, _)| i + 1));
        LineIndex { starts }
    }

    /// The `(line, character)` for a byte offset into `text`, under `enc`.
    ///
    /// **TOTAL, AND THAT IS NOT DEFENSIVENESS.** An offset past the end clamps to the end of the
    /// text, because a span reported at EOF is a real span and dropping it would lose the
    /// diagnostic it belongs to. An offset inside a multi-byte character walks back to its start,
    /// because the alternative is slicing a `str` off a boundary — which panics, which no clippy
    /// lint in this workspace can see, and which would take the editor's server down rather than
    /// misplace one squiggle.
    #[must_use]
    pub fn position(&self, text: &str, offset: usize, enc: Encoding) -> Position {
        let offset = floor_char_boundary(text, offset);
        // `starts[0]` is 0 and 0 <= offset always, so this is at least 1 and the subtraction
        // cannot wrap; `saturating_sub` says so without an `assert!`.
        let line = self.starts.partition_point(|&s| s <= offset).saturating_sub(1);
        let line_start = self.starts.get(line).copied().unwrap_or(0);
        let prefix = text.get(line_start..offset).unwrap_or("");
        let character = match enc {
            Encoding::Utf8 => prefix.len(),
            Encoding::Utf16 => prefix.chars().map(char::len_utf16).sum(),
        };
        Position::new(clamp_u32(line), clamp_u32(character))
    }

    /// The byte offset of `pos` into `text`, under `enc`. The inverse of `position`.
    ///
    /// **TOTAL, ON `position`'s OWN CONTRACT, AND FOR THE SAME REASON.** A line past the end of
    /// the file clamps to the end of the text; a character past the end of its line clamps to
    /// that line's content end, BEFORE the terminator rather than into the next line; a character
    /// column landing inside a multi-byte character resolves to that character's start. The
    /// alternative is slicing a `str` off a boundary — which panics, which no clippy lint in this
    /// workspace can see, and which would take the editor's server down rather than misplace one
    /// jump. A client sending a position this server cannot honour is the ORDINARY case, not a
    /// broken one: a cursor is stale the moment an edit lands under it.
    ///
    /// **A `\r` IS ORDINARY LINE CONTENT, NOT A TERMINATOR, AND THAT IS `position`'s RULE BEFORE
    /// IT IS THIS METHOD'S.** `LineIndex::new` records only `\n`, and `position` counts the raw
    /// byte prefix — so a `\r` occupies a column there. An `offset` that skipped it would
    /// disagree with its own inverse on every CRLF file. This is also what rust-analyzer's
    /// `line-index` does: that crate records only `\n` positions, computes a column as the raw
    /// distance from the line start, and contains no `\r` handling anywhere.
    #[must_use]
    pub fn offset(&self, text: &str, pos: Position, enc: Encoding) -> usize {
        let line = usize::try_from(pos.line).unwrap_or(usize::MAX);
        let Some(&line_start) = self.starts.get(line) else {
            return text.len();
        };
        let line_end = self.starts.get(line + 1).copied().unwrap_or(text.len());
        let content = text.get(line_start..line_end).unwrap_or("");
        // Only the `\n`. See the note above on why the `\r` stays.
        let content = content.strip_suffix('\n').unwrap_or(content);
        let target = usize::try_from(pos.character).unwrap_or(usize::MAX);
        match enc {
            // A byte column IS the character column, so the only work is refusing to land
            // inside a character.
            Encoding::Utf8 => line_start + floor_char_boundary(content, target),
            Encoding::Utf16 => {
                let mut units = 0usize;
                for (i, ch) in content.char_indices() {
                    // `<`, not `==`: a target inside this character's code units — the second
                    // half of a surrogate pair — belongs to THIS character, not the next one.
                    if target < units + ch.len_utf16() {
                        return line_start + i;
                    }
                    units += ch.len_utf16();
                }
                line_start + content.len()
            }
        }
    }

    /// The position of the very end of `text` — where a whole-document edit stops.
    #[must_use]
    pub fn end_position(&self, text: &str, enc: Encoding) -> Position {
        self.position(text, text.len(), enc)
    }

    /// The range a `Span` covers, under `enc`.
    #[must_use]
    pub fn range(&self, text: &str, span: Span, enc: Encoding) -> Range {
        Range::new(self.position(text, span.start, enc), self.position(text, span.end, enc))
    }
}

/// The largest char boundary at or below `offset`, clamped into `text`.
///
/// `str::floor_char_boundary` is unstable; this is it, and it is three lines.
fn floor_char_boundary(text: &str, offset: usize) -> usize {
    let mut o = offset.min(text.len());
    while o > 0 && !text.is_char_boundary(o) {
        o -= 1;
    }
    o
}

/// A `usize` as the `u32` the protocol uses, saturating rather than wrapping.
///
/// A file long enough to reach `u32::MAX` lines is not a file this server can usefully answer, and
/// a truncating `as` cast would answer it with a position pointing somewhere else entirely.
fn clamp_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positions_differ_by_encoding() {
        // `λ` IS TWO BYTES, ONE UTF-16 CODE UNIT AND ONE CODEPOINT: three different numbers for
        // one character, in the form named after it. Asserting BOTH numbers from ONE source is
        // what shows the encoder is doing something — a test asserting one number passes against
        // an encoder that ignores its argument.
        let text = "λx. x\n";
        let idx = LineIndex::new(text);
        let after_lambda = "λ".len();
        assert_eq!(after_lambda, 2, "the fixture's premise: λ is two bytes");

        assert_eq!(idx.position(text, after_lambda, Encoding::Utf8), Position::new(0, 2));
        assert_eq!(idx.position(text, after_lambda, Encoding::Utf16), Position::new(0, 1));
    }

    #[test]
    fn a_line_offset_lands_on_the_line_it_is_in() {
        let text = "a\nbb\nccc";
        let idx = LineIndex::new(text);
        assert_eq!(idx.position(text, 0, Encoding::Utf8), Position::new(0, 0));
        // The newline itself belongs to the line it ends.
        assert_eq!(idx.position(text, 1, Encoding::Utf8), Position::new(0, 1));
        assert_eq!(idx.position(text, 2, Encoding::Utf8), Position::new(1, 0));
        assert_eq!(idx.position(text, 5, Encoding::Utf8), Position::new(2, 0));
        assert_eq!(idx.end_position(text, Encoding::Utf8), Position::new(2, 3));
    }

    #[test]
    fn an_offset_past_the_end_or_inside_a_character_is_answered_rather_than_panicking() {
        // A span reported at EOF is a real span and dropping it would lose the diagnostic; a span
        // landing mid-character should not be able to take the server down. Neither case is
        // expected from these parsers — which is exactly why neither would be noticed if it
        // panicked only in the field.
        let text = "λ";
        let idx = LineIndex::new(text);
        assert_eq!(idx.position(text, 999, Encoding::Utf8), Position::new(0, 2));
        assert_eq!(idx.position(text, 1, Encoding::Utf8), Position::new(0, 0));
        assert_eq!(idx.position(text, 1, Encoding::Utf16), Position::new(0, 0));
    }

    #[test]
    fn utf8_is_taken_when_offered_and_utf16_is_the_only_fallback() {
        // Measured on the target editor rather than assumed: Neovim advertises
        // { "utf-8", "utf-16", "utf-32" }, so the intended consumer takes the first arm and a byte
        // column IS the character column.
        let nvim = [PositionEncodingKind::UTF8, PositionEncodingKind::UTF16, PositionEncodingKind::UTF32];
        assert_eq!(Encoding::negotiate(Some(&nvim)), Encoding::Utf8);

        assert_eq!(Encoding::negotiate(Some(&[PositionEncodingKind::UTF16])), Encoding::Utf16);
        // utf-32 alone is not utf-8, and this server does not implement it: utf-16 is the
        // protocol's default and the only correct answer a server can give here.
        assert_eq!(Encoding::negotiate(Some(&[PositionEncodingKind::UTF32])), Encoding::Utf16);
        assert_eq!(Encoding::negotiate(Some(&[])), Encoding::Utf16);
        // A client that sent no list at all.
        assert_eq!(Encoding::negotiate(None), Encoding::Utf16);
    }

    #[test]
    fn a_span_becomes_the_range_between_its_two_positions() {
        let text = "λx. x\n";
        let idx = LineIndex::new(text);
        let span = redextape_core::Span::new(0, "λx".len());
        assert_eq!(idx.range(text, span, Encoding::Utf16), Range::new(Position::new(0, 0), Position::new(0, 2)));
    }

    #[test]
    fn offset_is_the_inverse_of_position_on_every_character_boundary() {
        // THE PROPERTY, NOT A TABLE OF HAND-COMPUTED COLUMNS. A table can agree with a
        // conversion that is wrong in the same direction twice; a round trip over every
        // boundary in a fixture with multi-byte characters and several lines cannot.
        let text = "tapes 1\nstart λscan\nstate λscan: accept\n";
        let idx = LineIndex::new(text);
        for enc in [Encoding::Utf8, Encoding::Utf16] {
            for o in 0..=text.len() {
                if !text.is_char_boundary(o) {
                    continue;
                }
                let back = idx.offset(text, idx.position(text, o, enc), enc);
                assert_eq!(back, o, "round trip failed at {o} under {enc:?}");
            }
        }
    }

    #[test]
    fn a_utf16_column_inside_a_surrogate_pair_resolves_to_that_character_start() {
        // `𝄞` is FOUR bytes and TWO UTF-16 code units, so column 2 on this line is the
        // second half of one character. There is no byte offset for it, and the answer
        // must be the character's start rather than the next character or the line end.
        let text = "a𝄞b\n";
        let idx = LineIndex::new(text);
        assert_eq!("a".len(), 1);
        assert_eq!('𝄞'.len_utf8(), 4);
        assert_eq!(idx.offset(text, Position::new(0, 1), Encoding::Utf16), 1, "start of 𝄞");
        assert_eq!(idx.offset(text, Position::new(0, 2), Encoding::Utf16), 1, "mid-pair floors to 𝄞");
        assert_eq!(idx.offset(text, Position::new(0, 3), Encoding::Utf16), 5, "start of b");
    }

    #[test]
    fn a_position_past_the_end_clamps_instead_of_panicking() {
        // `position`'s own contract, in the other direction. A client can send any position
        // at all — a stale cursor after an edit is the ordinary case — and slicing a `str`
        // off a boundary would take the server down rather than misplace one jump.
        let text = "ab\ncd\n";
        let idx = LineIndex::new(text);
        assert_eq!(idx.offset(text, Position::new(99, 0), Encoding::Utf8), text.len(), "line past end");
        // Column past the end of its line stops at the line's CONTENT end, before the
        // newline — not at the start of the next line.
        assert_eq!(idx.offset(text, Position::new(0, 99), Encoding::Utf8), 2, "column past end");
        assert_eq!(idx.offset(text, Position::new(0, 99), Encoding::Utf16), 2, "column past end, utf-16");
    }

    #[test]
    fn a_carriage_return_is_ordinary_line_content_in_both_directions() {
        // `LineIndex::new` records only `\n`, so a `\r` occupies a column rather than ending a
        // line — `position` already counts it that way, and `offset` disagreeing would make the
        // two stop being inverses on every CRLF file. Verified against rust-analyzer's
        // `line-index`, which records only `\n` positions, computes a column as the raw byte
        // distance from the line start, and has no `\r` handling at all.
        let text = "ab\r\ncd\r\n";
        let idx = LineIndex::new(text);
        assert_eq!(idx.offset(text, Position::new(0, 2), Encoding::Utf8), 2, "the \\r's own column");
        assert_eq!(idx.offset(text, Position::new(0, 3), Encoding::Utf8), 3, "the \\n's own column");
        // Past the end of a CRLF line stops at the `\n`, which is the end of that line's content
        // WITH the `\r` counted — not before the `\r`, and not in the next line.
        assert_eq!(idx.offset(text, Position::new(0, 99), Encoding::Utf8), 3);
        assert_eq!(idx.offset(text, Position::new(1, 99), Encoding::Utf8), 7);
        // And the round trip holds at every boundary, terminators included. Keeping this in the
        // SAME test as the columns above is deliberate: the two assertions constrain each other,
        // and it was their conflict in an earlier draft that produced a method whose stated
        // invariant was false at two offsets of this exact fixture.
        // BOTH encodings. The fixture is ASCII, so `len_utf16` equals the byte length and the
        // UTF-16 arm collapses to the UTF-8 one — which is exactly why running only one of them
        // leaves the stated "every `o`, CRLF included" property half-checked the day that arm is
        // edited. The design's own testing section names a round trip run only under `Utf8` as a
        // trap to look for, and this was one.
        for enc in [Encoding::Utf8, Encoding::Utf16] {
            for o in 0..=text.len() {
                let back = idx.offset(text, idx.position(text, o, enc), enc);
                assert_eq!(back, o, "round trip failed at {o} under {enc:?}");
            }
        }
    }
}
