# LSP navigation for `.tm` and `.asm` (PR A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `textDocument/definition`, `textDocument/references` and `textDocument/documentSymbol` for `.tm` and `.asm` buffers, served from a name-span index the existing parsers build as they scan.

**Architecture:** A new `redextape-core` module `nav.rs` owns `NameIndex` — every name occurrence in one document, each a definition or a reference, with references linked to the definition they name. The two artifact parsers gain a `_nav` entry point returning `(Document, NameIndex)`, mirroring the `print_tm`/`print_tm_mapped` pair the same file already has. `redextape-lsp` gains the inverse position conversion it lacks (`Position` → byte offset), three capability entries and three dispatch arms. `Server::handle` stays a pure function; nothing here touches transport.

**Tech Stack:** Rust 2024, `redextape-core` (zero dependencies — `std` only), `gen-lsp-types` 0.11.0 (default features, so `Uri` is a newtype over `String`), `lsp-server` 0.10.0 (untouched).

Design: [`../specs/2026-09-06-lsp-navigation-design.md`](../specs/2026-09-06-lsp-navigation-design.md). This plan is **PR A** of that design's two. PR B (`.rxt`) is not planned here.

## Global Constraints

- Rust edition 2024, `max_width = 120`, `use_small_heuristics = "Max"` (`rustfmt.toml`).
- `cargo clippy --workspace --all-targets -- -D warnings` must pass. The pre-commit hook runs it on **every** commit, so a commit that does not compile clean cannot be made — never `--no-verify`.
- `[workspace.lints.clippy]` warns on `unwrap`/`expect`/`panic`/`todo`/`unimplemented`. Those are errors under `-D warnings` outside `#[test]` functions and `#[cfg(test)]` modules. `unwrap_or`, `unwrap_or_default` and `unwrap_or_else` are different methods and are permitted.
- `cargo llvm-cov nextest --workspace --fail-under-lines 90` must pass.
- **`redextape-core` has zero dependencies** — verify with `cargo tree -p redextape-core --edges normal`, which must list only itself. `nav.rs` may use `std` and nothing else.
- No panics on user input. Malformed source produces spanned `Diagnostic`s.
- `lsp-server` stays named in `crates/redextape-lsp/src/main.rs` and nowhere else. `git grep -l "use lsp_server\|lsp_server::" crates/redextape-lsp/src | wc -l` must answer `1` at every commit.
- Test commands: `cargo nextest run -p <crate>` runs unit **and** integration tests. `cargo test -p redextape-cli --lib` and `--bin` are both structurally blind — do not use that shape for deciding a task is done.
- Doc comments are `///` in Rust.

## Measured facts this plan rests on

Every figure below was produced by running the real code at `64c1164`, not read off a type signature. Fixtures are quoted verbatim from that probe's output.

**`gen-lsp-types` shapes, compiled and run:**

| what | exact path / shape |
|---|---|
| definition params | `DefinitionParams`, position at `p.text_document_position_params.position`, uri at `p.text_document_position_params.text_document.uri` (both `#[serde(flatten)]`) |
| references params | `ReferenceParams`, same flattened path, plus `p.context.include_declaration: bool` |
| documentSymbol params | `DocumentSymbolParams`, uri at `p.text_document.uri` (**not** flattened) |
| definition result | `Option<DefinitionResponse>`; `DefinitionResponse::Definition(Definition::Location(Location))` |
| references result | `Option<Vec<Location>>` |
| documentSymbol result | `Option<DocumentSymbolResponse>`; `DocumentSymbolResponse::DocumentSymbolList(Vec<DocumentSymbol>)` |
| capabilities | `definition_provider: Option<DefinitionProvider>`, `references_provider: Option<ReferencesProvider>`, `document_symbol_provider: Option<DocumentSymbolProvider>`, each with a `Bool(bool)` variant |

**`DocumentSymbol` has a `#[deprecated]` field named `deprecated`, and this workspace builds with `-D warnings`.** It derives no `Default` and its `::new` takes that field positionally, so **both** construction routes trip the lint. Every construction site needs `#[allow(deprecated)]` on the statement. This was confirmed by compiling it: without the allow, `cargo clippy -p redextape-lsp --all-targets -- -D warnings` fails with ``use of deprecated field `gen_lsp_types::DocumentSymbol::deprecated` ``.

**Parser behaviour, probed:**

| fixture | `machine`/`program` | diagnostics |
|---|---|---|
| `.asm` `jmp nowhere` | `Some` | **0** — asm never checks jump targets |
| `.asm` duplicate `f:` twice | `Some` | **0** — `labels` is `[("f", 0), ("f", 0)]` |
| `.tm` `goto nowhere` | `None` | 1, ``unknown goto target `nowhere` `` |
| `.tm` duplicate `state scan:` | `None` | 1, ``duplicate state name `scan` `` |
| `.tm` rule line with `move [X]` | `None` | 1, `bad move (expected L/R/S)`, span `31..70` — the **whole rule line** |

---

## File Structure

| file | responsibility |
|---|---|
| `crates/redextape-core/src/nav.rs` | **Create.** `NameIndex`, `Occurrence`, `Role`, the builder methods the parsers call, and the four queries the server calls. Knows nothing about either grammar. |
| `crates/redextape-core/src/lib.rs` | **Modify.** Declare `pub mod nav;`. |
| `crates/redextape-core/src/tm/syntax.rs` | **Modify.** `parse_tm_nav`; `parse_tm_full` becomes its `.0`. `RawRule` grows `goto_at`. |
| `crates/redextape-core/src/tm/asm_syntax.rs` | **Modify.** `parse_asm_nav`; `parse_asm_full` becomes its `.0`. Label operand located through `Shape::kinds()`. |
| `crates/redextape-lsp/src/position.rs` | **Modify.** `LineIndex::offset` — the inverse of `position`. |
| `crates/redextape-lsp/src/language.rs` | **Modify.** `Language::nav`, the fifth per-form method beside `diagnostics` and `format`. |
| `crates/redextape-lsp/src/lib.rs` | **Modify.** Three capability entries, three dispatch arms, three handlers. |
| `crates/redextape-lsp/tests/protocol.rs` | **Modify.** One navigation round trip through the real binary. |

---

## Task 1: `LineIndex::offset` — the inverse conversion

**Files:**
- Modify: `crates/redextape-lsp/src/position.rs`

**Interfaces:**
- Consumes: `LineIndex { starts: Vec<usize> }`, `Encoding`, `floor_char_boundary` — all already in this file.
- Produces: `LineIndex::offset(&self, text: &str, pos: Position, enc: Encoding) -> usize`. Tasks 5, 6 call it.

- [ ] **Step 1: Write the failing tests**

Add to the `mod tests` block at the bottom of `crates/redextape-lsp/src/position.rs`:

```rust
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
        for o in 0..=text.len() {
            let back = idx.offset(text, idx.position(text, o, Encoding::Utf8), Encoding::Utf8);
            assert_eq!(back, o, "round trip failed at {o}");
        }
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo nextest run -p redextape-lsp -E 'test(offset) or test(carriage) or test(surrogate)'`
Expected: compilation FAILS with ``no method named `offset` found for struct `LineIndex` ``.

- [ ] **Step 3: Write the implementation**

Insert into `impl LineIndex`, directly after the `position` method:

```rust
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo nextest run -p redextape-lsp`
Expected: PASS, with 4 more tests than before.

- [ ] **Step 5: Sabotage each test and confirm it goes red**

Run each of these, confirm the named test FAILS, then revert the edit:

1. Change `if target < units + ch.len_utf16()` to `if target <= units`. Expected: `a_utf16_column_inside_a_surrogate_pair_resolves_to_that_character_start` fails.
2. Add `let content = content.strip_suffix('\r').unwrap_or(content);` after the `\n` strip — reintroducing the bug an earlier draft of this plan shipped. Expected: `a_carriage_return_is_ordinary_line_content_in_both_directions` fails, both on the column assertions and on the round trip at offsets 3 and 7.
3. Change `line_start + content.len()` to `line_end`. Expected: `a_position_past_the_end_clamps_instead_of_panicking` fails on the "column past end" assertion.

**A sabotage that does not turn the test red is the finding, not a formality** — if any of the three passes, the test is not measuring what its name says and must be fixed before moving on.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-lsp/src/position.rs
git commit -m "position: LineIndex::offset, the inverse of position

Every navigation request arrives as a (line, character) cursor and the
index is keyed by byte offset, so all three need the conversion this file
did not have. Total on position's own contract: a line past the end
clamps to the end of the text, a column past the end of its line stops at
the content end before the terminator, and a utf-16 column inside a
surrogate pair resolves to that character's start.

A carriage return is ordinary line content, in both directions. position
already counted it that way and offset must agree or the two stop being
inverses on every CRLF file. Checked against rust-analyzer's line-index
rather than assumed: that crate records only newline positions, computes
a column as the raw byte distance from the line start, and contains no
carriage-return handling anywhere."
```

---

## Task 2: `nav.rs` — the index type and its queries

**Files:**
- Create: `crates/redextape-core/src/nav.rs`
- Modify: `crates/redextape-core/src/lib.rs`

**Interfaces:**
- Consumes: `crate::Span`.
- Produces, all `pub` unless marked:
  - `NameIndex` (derives `Clone, Debug, Default, PartialEq, Eq`)
  - `Occurrence { pub name: String, pub span: Span, pub role: Role }`
  - `Role::Definition` and `Role::Reference { def: Option<usize> }`
  - `NameIndex::push_definition(&mut self, name: &str, span: Span)` — `pub(crate)`
  - `NameIndex::push_reference(&mut self, name: &str, span: Span)` — `pub(crate)`
  - `NameIndex::link(&mut self)` — `pub(crate)`
  - `NameIndex::at(&self, offset: usize) -> Option<(usize, &Occurrence)>`
  - `NameIndex::get(&self, i: usize) -> Option<&Occurrence>`
  - `NameIndex::definition_of(&self, i: usize) -> Option<usize>`
  - `NameIndex::definitions(&self) -> impl Iterator<Item = &Occurrence>`
  - `NameIndex::references_to(&self, def: usize) -> impl Iterator<Item = &Occurrence>`
  - Tasks 3, 4 call the `pub(crate)` three. Tasks 5, 6, 7 call the queries.

- [ ] **Step 1: Write the failing tests**

Create `crates/redextape-core/src/nav.rs` containing **only** this test module for now (the implementation lands in step 3):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Three occurrences of one name and two of another, laid out so that every query has a
    /// wrong answer available to it. `alpha` is defined at 20..25 and referenced at 0..5 and
    /// 40..45 — a reference BEFORE its definition and one after, because a `goto` may name a
    /// state defined further down the file.
    fn fixture() -> NameIndex {
        let mut n = NameIndex::default();
        n.push_reference("alpha", Span::new(0, 5));
        n.push_definition("alpha", Span::new(20, 25));
        n.push_reference("alpha", Span::new(40, 45));
        n.push_definition("beta", Span::new(60, 64));
        n.push_reference("ghost", Span::new(80, 85));
        n.link();
        n
    }

    #[test]
    fn a_reference_links_to_the_definition_of_its_own_name() {
        let n = fixture();
        // Index 1 is `alpha`'s definition. Asserting the INDEX and not just the name is what
        // makes this test able to fail: every occurrence here named `alpha` would satisfy a
        // name-only assertion.
        assert_eq!(n.definition_of(0), Some(1), "the forward reference");
        assert_eq!(n.definition_of(2), Some(1), "the backward reference");
        assert_eq!(n.get(1).map(|o| o.span), Some(Span::new(20, 25)));
    }

    #[test]
    fn a_definition_is_its_own_definition() {
        let n = fixture();
        assert_eq!(n.definition_of(1), Some(1));
        assert_eq!(n.definition_of(3), Some(3));
    }

    #[test]
    fn a_reference_to_a_name_nothing_defines_links_to_nothing() {
        // NOT AN ERROR STATE. `parse_asm_full` accepts `jmp nowhere` with zero diagnostics,
        // so a dangling reference is an ordinary value this index must be able to hold.
        let n = fixture();
        assert_eq!(n.definition_of(4), None);
        assert_eq!(n.get(4).map(|o| o.role), Some(Role::Reference { def: None }));
    }

    #[test]
    fn at_finds_the_occurrence_containing_an_offset_and_nothing_outside_one() {
        let n = fixture();
        assert_eq!(n.at(0).map(|(i, _)| i), Some(0), "first byte is inside");
        assert_eq!(n.at(4).map(|(i, _)| i), Some(0), "last byte is inside");
        assert_eq!(n.at(5), None, "the end is exclusive");
        assert_eq!(n.at(22).map(|(i, _)| i), Some(1));
        assert_eq!(n.at(19), None, "between occurrences");
        assert_eq!(n.at(9_999), None, "past everything");
    }

    #[test]
    fn references_to_lists_every_reference_and_excludes_the_definition() {
        // The definition's own inclusion is `include_declaration`'s job at the LSP layer, and
        // that is a decision the CLIENT makes. Building it in here would answer the same list
        // either way and ignore the parameter.
        let n = fixture();
        let spans: Vec<_> = n.references_to(1).map(|o| o.span).collect();
        assert_eq!(spans, vec![Span::new(0, 5), Span::new(40, 45)]);
        assert_eq!(n.references_to(3).count(), 0, "beta is defined and never referenced");
    }

    #[test]
    fn definitions_lists_only_definitions_in_source_order() {
        let n = fixture();
        let names: Vec<_> = n.definitions().map(|o| o.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "beta"]);
    }

    #[test]
    fn the_first_definition_wins_when_a_name_is_defined_twice() {
        // `.asm` accepts a duplicate label with no diagnostic at all — `labels` comes back as
        // [("f", 0), ("f", 0)] — so this is a shape the index really meets, not a hypothetical.
        // BOTH definitions stay listed; only the link is singular.
        let mut n = NameIndex::default();
        n.push_definition("f", Span::new(0, 1));
        n.push_definition("f", Span::new(10, 11));
        n.push_reference("f", Span::new(20, 21));
        n.link();
        assert_eq!(n.definition_of(2), Some(0), "the FIRST definition, not the last");
        assert_eq!(n.definitions().count(), 2, "both are still listed for documentSymbol");
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo nextest run -p redextape-core -E 'test(nav)'`
Expected: **zero tests run, and NOT a compile error.** An undeclared module file is invisible to the build — `nav.rs` is not compiled at all until `lib.rs` names it, so nothing fails. To get real RED evidence, do Step 4's `pub mod nav;` declaration FIRST, then run this command and record the genuine compile failure (`cannot find type `NameIndex` in this scope`, and the same for `Occurrence`/`Role`). A run reporting "0 tests" is not a failing test, and recording it as one would be the first blind check of this task.

- [ ] **Step 3: Write the implementation**

Prepend to `crates/redextape-core/src/nav.rs`, above the test module:

```rust
//! Where names are written in one document, and which of them define rather than mention.
//!
//! **THIS MODULE HOLDS NO GRAMMAR.** It does not know what a TM state is, what an asm label is,
//! or which of the two a given document contains. The parsers push occurrences as they scan —
//! they are the only things in this crate that know where a name begins — and the server maps a
//! definition to a `SymbolKind` at the one place that knows the document's language. Anything
//! here that could answer "is this a state?" would be a second definition of a grammar that
//! already has exactly one.
//!
//! **AN INDEX OUTLIVES A FAILED PARSE, AND THAT IS THE DIFFERENCE FROM `comments`.** Comment
//! recovery is all-or-nothing across a document because comments feed the PRINTER, which has
//! nothing to print for a file with an error. This feeds NAVIGATION: a jump from a `goto` to its
//! `state` is correct on its own terms, and nothing else in the file has to be true for it to be
//! the right answer. The moment navigation is worth most is the moment the file is broken,
//! because that is what a file under active editing is.

use std::collections::HashMap;

use crate::Span;

/// Every name occurrence in one document, in source order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NameIndex {
    occurrences: Vec<Occurrence>,
}

/// One name, as written, at one place.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Occurrence {
    /// The name as written. An owned `String` and not a slice: the index outlives the borrow of
    /// the text it was built from, and every consumer holds it across a parse.
    pub name: String,
    /// The span of the NAME — not of the line, statement or block containing it.
    pub span: Span,
    pub role: Role,
}

/// Whether an occurrence introduces a name or mentions one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Definition,
    Reference {
        /// Index into the document's occurrences. `None` when nothing in this document defines
        /// the name — `parse_asm_full` accepts `jmp nowhere` with zero diagnostics, so a
        /// dangling reference is an ordinary value rather than an error to report.
        def: Option<usize>,
    },
}

impl NameIndex {
    pub(crate) fn push_definition(&mut self, name: &str, span: Span) {
        self.occurrences.push(Occurrence { name: name.to_string(), span, role: Role::Definition });
    }

    /// Record a mention. The link is filled by `link`, not here: a `goto` may name a state
    /// defined further down the file, so nothing can be resolved until the scan has finished.
    pub(crate) fn push_reference(&mut self, name: &str, span: Span) {
        self.occurrences.push(Occurrence { name: name.to_string(), span, role: Role::Reference { def: None } });
    }

    /// Point every reference at the FIRST definition of its name. Called once, by each parser,
    /// after the whole document has been scanned.
    pub(crate) fn link(&mut self) {
        let mut first: HashMap<&str, usize> = HashMap::new();
        for (i, o) in self.occurrences.iter().enumerate() {
            if o.role == Role::Definition {
                first.entry(o.name.as_str()).or_insert(i);
            }
        }
        // `first` borrows `self.occurrences`, so the resolved links are collected before the
        // mutable pass rather than looked up inside it.
        let links: Vec<Option<usize>> =
            self.occurrences.iter().map(|o| first.get(o.name.as_str()).copied()).collect();
        for (o, link) in self.occurrences.iter_mut().zip(links) {
            if let Role::Reference { def } = &mut o.role {
                *def = link;
            }
        }
    }

    /// The occurrence containing `offset`, and its index. `None` when the cursor is on
    /// punctuation, whitespace, a comment, or anything else that is not a name.
    ///
    /// A linear scan. Occurrences are in source order and a hand-written document has few of
    /// them; binary search would be the same answer with a sortedness invariant to hold.
    #[must_use]
    pub fn at(&self, offset: usize) -> Option<(usize, &Occurrence)> {
        self.occurrences.iter().enumerate().find(|(_, o)| o.span.start <= offset && offset < o.span.end)
    }

    #[must_use]
    pub fn get(&self, i: usize) -> Option<&Occurrence> {
        self.occurrences.get(i)
    }

    /// The index of the definition occurrence `i` names: itself when `i` is a definition, its
    /// link when `i` is a reference. `None` for a dangling reference or an index out of range.
    #[must_use]
    pub fn definition_of(&self, i: usize) -> Option<usize> {
        match self.occurrences.get(i)?.role {
            Role::Definition => Some(i),
            Role::Reference { def } => def,
        }
    }

    /// Every definition, in source order. A name defined twice appears twice — `.asm` accepts
    /// that with no diagnostic, and an outline should show the file that exists.
    pub fn definitions(&self) -> impl Iterator<Item = &Occurrence> {
        self.occurrences.iter().filter(|o| o.role == Role::Definition)
    }

    /// Every reference linked to `def`. **The definition itself is excluded**: whether to
    /// include it is `ReferenceContext::include_declaration`, which is the client's choice, and
    /// answering the same list either way would ignore the parameter rather than serve it.
    pub fn references_to(&self, def: usize) -> impl Iterator<Item = &Occurrence> {
        self.occurrences.iter().filter(move |o| o.role == Role::Reference { def: Some(def) })
    }
}
```

- [ ] **Step 4: Declare the module**

In `crates/redextape-core/src/lib.rs`, add `pub mod nav;` to the module list, in alphabetical position among the existing `pub mod` declarations.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo nextest run -p redextape-core -E 'test(nav)'`
Expected: PASS, 7 tests.

- [ ] **Step 6: Confirm the zero-dependency invariant still holds**

Run: `cargo tree -p redextape-core --edges normal`
Expected: one line, `redextape-core v0.0.0 (...)`, and nothing beneath it.

- [ ] **Step 7: Sabotage**

1. In `link`, change `.or_insert(i)` to `.insert(i)` followed by returning the map — i.e. make the LAST definition win. Expected: `the_first_definition_wins_when_a_name_is_defined_twice` fails. Revert.
2. In `at`, change `offset < o.span.end` to `offset <= o.span.end`. Expected: `at_finds_the_occurrence_containing_an_offset_and_nothing_outside_one` fails on the exclusive-end assertion. Revert.
3. In `references_to`, drop the `def: Some(def)` filter and match any reference by name. Expected: `references_to_lists_every_reference_and_excludes_the_definition` still passes — **this fixture cannot catch it**, because every `alpha` reference does link to `alpha`. Add this test before moving on:

```rust
    #[test]
    fn references_to_does_not_answer_by_name() {
        // TWO DEFINITIONS OF THE SAME NAME IS THE ONLY FIXTURE THAT SEPARATES THE TWO
        // IMPLEMENTATIONS. Two definitions of DIFFERENT names does not: a name-match resolves
        // those correctly too, so such a test passes under the defect it claims to catch. Here,
        // link-matching says the reference belongs to the first `f` alone, while name-matching
        // says it belongs to both.
        let mut n = NameIndex::default();
        n.push_definition("f", Span::new(0, 1));
        n.push_definition("f", Span::new(10, 11));
        n.push_reference("f", Span::new(20, 21));
        n.link();
        assert_eq!(n.references_to(0).map(|o| o.span).collect::<Vec<_>>(), vec![Span::new(20, 21)], "links to the first");
        assert_eq!(n.references_to(1).count(), 0, "nothing links to the SECOND `f`, despite the name matching");
    }
```

Re-run sabotage 3 with the new test present. Expected: it now FAILS.

**MEASURED, because an earlier draft of this step got it wrong in exactly the way the step exists to prevent.** That draft's fixture defined `a` and `b` — two definitions of *different* names — under a comment asserting it was the fixture a name-match could not satisfy. It was not: both its assertions hold under name-matching, so it passed the sabotage while claiming to catch it. Running the sabotage against both versions gives `references_to_does_not_answer_by_name` PASS on the old shape and FAIL on the shape above. Revert the sabotage, keep the test.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/src/nav.rs crates/redextape-core/src/lib.rs
git commit -m "core: nav.rs, a name-span index with no grammar in it

Every name occurrence in one document, each a definition or a reference,
with references linked to the definition they name rather than matched to
it. The link is what makes the type reusable for .rxt, where shadowing
means name-matching is wrong and not merely slow.

The module holds no grammar: parsers push occurrences because they are the
only things that know where a name begins, and the server picks a
SymbolKind because it is the only thing that knows the language.

References exclude their own definition -- whether to include it is
ReferenceContext::include_declaration, which is the client's choice."
```

---

## Task 3: `parse_tm_nav`

**Files:**
- Modify: `crates/redextape-core/src/tm/syntax.rs`

**Interfaces:**
- Consumes: `NameIndex::{push_definition, push_reference, link}` from Task 2.
- Produces: `pub fn parse_tm_nav(src: &str) -> (TmDocument, NameIndex)`. `parse_tm_full` keeps its signature exactly and becomes `parse_tm_nav(src).0`.

**What the parser must record:** `state <name>:` is a definition; `start <name>` and each rule's `goto <name>` are references.

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-core/src/tm/syntax.rs`'s `mod tests`:

```rust
    /// Probed at `64c1164`: parses clean, and `scan` appears at 14, 25 and 66 while `halt`
    /// appears at 106 and 117. Three occurrences of one name is the point — an assertion that
    /// only checked the NAME would be satisfied by any of them.
    const NAV_TM: &str = "tapes 1\nstart scan\nstate scan:\n  [1] -> write [*], move [R], goto scan\n  [*] -> write [1], move [S], goto halt\nstate halt: accept\n";

    #[test]
    fn tm_navigation_records_definitions_and_references_at_name_spans() {
        let (doc, nav) = parse_tm_nav(NAV_TM);
        assert!(doc.machine.is_some(), "the fixture's premise: it parses");

        // Every span is asserted BOTH as text and as an offset. Text alone cannot tell three
        // `scan`s apart; an offset alone would not catch a span that is off by the length of
        // the keyword before it.
        let names: Vec<_> =
            nav.definitions().map(|o| (o.name.as_str(), o.span.start, &NAV_TM[o.span.start..o.span.end])).collect();
        assert_eq!(names, vec![("scan", 25, "scan"), ("halt", 117, "halt")]);

        // `start scan` at 14 resolves to the DEFINITION at 25, not to itself and not to the
        // `goto scan` at 66.
        let (i, occ) = nav.at(14).expect("a name at 14");
        assert_eq!(occ.span, Span { start: 14, end: 18 });
        assert_eq!(nav.get(nav.definition_of(i).expect("resolves")).map(|o| o.span), Some(Span { start: 25, end: 29 }));
    }

    #[test]
    fn a_goto_resolves_to_a_state_defined_further_down() {
        // `goto halt` at 106 precedes `state halt:` at 117. Linking after the scan is what
        // makes a forward reference resolve; linking during it could not.
        let (_, nav) = parse_tm_nav(NAV_TM);
        let (i, occ) = nav.at(106).expect("a name at 106");
        assert_eq!(&NAV_TM[occ.span.start..occ.span.end], "halt");
        assert_eq!(nav.definition_of(i).and_then(|d| nav.get(d)).map(|o| o.span), Some(Span { start: 117, end: 121 }));
    }

    #[test]
    fn a_line_that_does_not_parse_contributes_no_occurrences() {
        // Probed: this reports one diagnostic, `bad move (expected L/R/S)`, spanning the WHOLE
        // rule line 31..70 — and `parse_rule_line` reads `goto` last, so the `halt` at 66 is
        // never reached. The `state halt:` definition at 77 is on a line that DOES parse and is
        // recorded. That asymmetry is the per-line rule, stated as a test.
        let src = "tapes 1\nstart scan\nstate scan:\n  [1] -> write [*], move [X], goto halt\nstate halt: accept\n";
        let (doc, nav) = parse_tm_nav(src);
        assert!(doc.machine.is_none(), "the fixture's premise: it does not parse");
        assert_eq!(nav.at(66), None, "the goto on the failed line contributes nothing");
        assert_eq!(nav.at(77).map(|(_, o)| o.span), Some(Span { start: 77, end: 81 }), "the state line still counts");
    }

    #[test]
    fn an_index_survives_a_document_that_produced_no_machine() {
        // THE WHOLE REASON THE INDEX IS RETURNED BESIDE THE DOCUMENT RATHER THAN INSIDE IT.
        // Probed: this reports `unknown goto target `nowhere`` and `machine` is None, while
        // `comments` would have been emptied. Navigation is not.
        let src = "tapes 1\nstart scan\nstate scan:\n  [*] -> write [*], move [S], goto nowhere\n";
        let (doc, nav) = parse_tm_nav(src);
        assert!(doc.machine.is_none());
        assert_eq!(nav.definitions().count(), 1, "`state scan:` is still a definition");
        let (i, _) = nav.at(66).expect("`nowhere` is still a reference");
        assert_eq!(nav.definition_of(i), None, "and it resolves to nothing");
    }

    #[test]
    fn parse_tm_full_is_exactly_the_documents_half_of_parse_tm_nav() {
        // The two entry points must not be able to disagree about the document, which is the
        // property that makes adding the second one safe. Checked over a file that parses and
        // one that does not.
        for src in [NAV_TM, "tapes 1\nstate q0:\n", "", "tapes\n"] {
            assert_eq!(parse_tm_full(src), parse_tm_nav(src).0, "disagreement on {src:?}");
        }
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo nextest run -p redextape-core -E 'test(nav) or test(goto_resolves) or test(contributes_no_occurrences)'`
Expected: compilation FAILS — `parse_tm_nav` does not exist.

- [ ] **Step 3: Remove Task 2's `#[allow(dead_code)]` attributes**

Task 2 put `#[allow(dead_code, reason = ...)]` on `NameIndex::push_definition`, `push_reference` and
`link`, because until this task they had no caller outside `nav.rs`'s own tests and the pre-commit
clippy gate rejects that. **This task is what gives them callers, so all three attributes come off
here.**

**Clippy never reports a stale `allow`.** Leaving them would silently shield these three methods
from `dead_code` forever — including the case where a later refactor removes the last real caller
and nobody is told. Delete the three attributes, then confirm
`cargo clippy --workspace --all-targets -- -D warnings` is still clean, which it will be only if
this task's calls are real.

- [ ] **Step 4: Add the offset helper**

Add near `parse_sym` in `crates/redextape-core/src/tm/syntax.rs`:

```rust
/// `s` with surrounding whitespace removed, plus how far into `s` the result begins.
///
/// Spans are built by ARITHMETIC over lengths, not by pointer comparison between a slice and its
/// parent. Both work; only one is checkable by reading it.
fn trimmed_at(s: &str) -> (&str, usize) {
    (s.trim(), s.len() - s.trim_start().len())
}
```

- [ ] **Step 5: Give `RawRule` the goto's offset**

In `struct RawRule`, add a field after `span`:

```rust
    /// Where the goto target begins, relative to the start of the line `parse_rule_line` was
    /// given — which is the line already trimmed of its indentation. The caller adds the line's
    /// own start and that indentation back.
    goto_at: usize,
```

In `parse_rule_line`, the `goto` is currently produced by:

```rust
    let goto = rest.trim_start().strip_prefix("goto").ok_or_else(|| err(span, "expected `goto`"))?.trim();
```

Replace that line and the `Ok(RawRule { .. })` at the end of the function with:

```rust
    let after_goto = rest.trim_start().strip_prefix("goto").ok_or_else(|| err(span, "expected `goto`"))?;
    let (goto, goto_pad) = trimmed_at(after_goto);
    if goto.is_empty() {
        return Err(err(span, "expected a goto target"));
    }
    // `line` here is the comment-stripped line; every slice above came from it by prefix
    // stripping, so the goto's offset is the whole line's length minus what is left after it.
    let goto_at = line.len() - after_goto.len() + goto_pad;
```

and

```rust
    Ok(RawRule { read, write, moves, goto: goto.to_string(), span, goto_at })
```

Delete the now-duplicated `if goto.is_empty()` check that sat between the old `goto` binding and the `read`/`write` lines — there must be exactly one.

- [ ] **Step 6: Rename the parse function and thread the index**

Rename `pub fn parse_tm_full` to `pub fn parse_tm_nav`, change its return type to `(TmDocument, NameIndex)`, and add above it:

```rust
/// Parse the TM text form. Unchanged in signature and behaviour.
///
/// `parse_tm_nav`'s document half, exactly as `print_tm` is `print_tm_mapped`'s text half. One
/// parser, two entry points, and no way for them to disagree.
#[must_use]
pub fn parse_tm_full(src: &str) -> TmDocument {
    parse_tm_nav(src).0
}
```

Add `use crate::nav::NameIndex;` to the file's imports.

Inside `parse_tm_nav`, declare the index beside the other accumulators:

```rust
    let mut nav = NameIndex::default();
```

Inside the per-line loop, immediately after `let trimmed = content.trim_start();`, add:

```rust
    // How far the line's content sits from the line's own start. Every name span below is
    // `line_start + indent + <offset within `trimmed`>`.
    let indent = content.len() - trimmed.len();
```

In the `start` branch, inside the `else` arm that sets `start_name`, add after the `attach` call:

```rust
                let (name, pad) = trimmed_at(comments::content_before_comment(rest));
                if !name.is_empty() {
                    let at = line_start + indent + "start ".len() + pad;
                    nav.push_reference(name, Span { start: at, end: at + name.len() });
                }
```

In the `state` branch, immediately before `states.push(RawState { name, accept, rules: Vec::new() });`, add:

```rust
            // Recorded even when this line also produced a `duplicate state name` diagnostic:
            // the file really does define the name twice, and an outline should show that.
            {
                let (_, pad) = trimmed_at(name_part);
                let at = line_start + indent + "state ".len() + pad;
                nav.push_definition(&name, Span { start: at, end: at + name.len() });
            }
```

This requires the `state` branch to keep the untrimmed name slice. Change

```rust
            let Some((name, tail)) = rest.split_once(':') else {
```

to

```rust
            let Some((name_part, tail)) = rest.split_once(':') else {
```

and the following line

```rust
            let (name, tail) = (name.trim().to_string(), tail.trim());
```

to

```rust
            let (name, tail) = (name_part.trim().to_string(), tail.trim());
```

In the rule branch, inside the `Ok(r) => { .. }` arm, add before `state.rules.push(r);`:

```rust
                    let at = line_start + indent + r.goto_at;
                    nav.push_reference(&r.goto, Span { start: at, end: at + r.goto.len() });
```

- [ ] **Step 7: Link and return at every exit**

`parse_tm_nav` returns from four places. Each becomes a tuple. Before the FIRST of them, add:

```rust
    nav.link();
```

placed immediately after the per-line loop closes and before the `for text in pending.drain(..)` block, so every subsequent `return` sees a linked index. Then change each `return TmDocument { .. }` to `return (TmDocument { .. }, nav);` and the final expression `TmDocument { .. }` to `(TmDocument { .. }, nav)`.

- [ ] **Step 8: Fix the call sites**

Run: `cargo build --workspace --all-targets 2>&1 | grep -c '^error'`

`parse_tm_full` keeps its signature, so this should report `0`. If anything fails, it is a caller of a function this task renamed rather than wrapped — fix it to call `parse_tm_full`.

- [ ] **Step 9: Run the tests**

Run: `cargo nextest run -p redextape-core`
Expected: PASS, with 5 more tests than before and **no pre-existing test edited**. If a pre-existing TM test now fails, the change altered behaviour and must be corrected rather than the test updated.

- [ ] **Step 10: Sabotage**

1. Change the `state` branch's span to use `indent` alone, dropping `+ "state ".len()`. Expected: `tm_navigation_records_definitions_and_references_at_name_spans` fails on the offset, not the text — which is the assertion pair earning its place.
2. Move `nav.link()` to before the per-line loop. Expected: `a_goto_resolves_to_a_state_defined_further_down` fails.
3. In the rule branch, push the reference for `Err(d)` lines too. Expected: `a_line_that_does_not_parse_contributes_no_occurrences` fails.

Revert each.

- [ ] **Step 11: Commit**

```bash
git add crates/redextape-core/src/tm/syntax.rs
git commit -m "tm: parse_tm_nav, the parser's half of print_tm_mapped

state <name>: is a definition, start <name> and each rule's goto are
references, and every span is the NAME rather than the line. RawRule
carries the goto's offset within the line it was parsed from because
parse_rule_line does not know the line's indentation.

parse_tm_full keeps its signature and becomes parse_tm_nav().0, so the
two entry points cannot disagree about the document -- a property the
tests check directly over a file that parses and one that does not.

Linking happens after the scan, which is what lets a goto resolve to a
state defined further down. The index is returned even when the document
has no machine: comments are emptied on any diagnostic because they feed
the printer, and navigation does not."
```

---

## Task 4: `parse_asm_nav`

**Files:**
- Modify: `crates/redextape-core/src/tm/asm_syntax.rs`

**Interfaces:**
- Consumes: `NameIndex::{push_definition, push_reference, link}`, and `trimmed_at` — which lives in `tm/syntax.rs`. Make it `pub(super) fn trimmed_at` there and import it here with `use super::syntax::trimmed_at;`.
- Produces: `pub fn parse_asm_nav(src: &str) -> (AsmDocument, NameIndex)`. `parse_asm_full` keeps its signature and becomes `parse_asm_nav(src).0`.

**What the parser must record:** `<name>:` is a definition. The `Label` operand of any instruction is a reference — located through `Shape::kinds()`, never through a list of mnemonics.

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-core/src/tm/asm_syntax.rs`'s `mod tests`:

```rust
    /// Probed at `64c1164`: parses clean, `labels` is [("f", 0), ("g", 3)] and `code` is
    /// [Li(Loc(0), 1), Jz(Loc(0), "g"), Jmp("g"), Ret]. Note the TABs — that is what the
    /// printer emits and what the existing fixtures in this file use.
    const NAV_ASM: &str = "result Nat\nf:\n\tli\tr0, #1\n\tjz\tr0, g\n\tjmp\tg\ng:\n\tret\n";

    #[test]
    fn asm_navigation_records_labels_and_the_label_operand_of_any_instruction() {
        let (doc, nav) = parse_asm_nav(NAV_ASM);
        assert!(doc.program.is_some(), "the fixture's premise: it parses");

        let defs: Vec<_> =
            nav.definitions().map(|o| (o.name.as_str(), &NAV_ASM[o.span.start..o.span.end])).collect();
        assert_eq!(defs, vec![("f", "f"), ("g", "g")]);

        // Resolve through `at` on the operand of `jz`, which is the SECOND operand — a
        // reference located by operand position 0 would find `r0` instead.
        let jz_g = NAV_ASM.find("r0, g").expect("fixture") + "r0, ".len();
        let (i, occ) = nav.at(jz_g).expect("a name at the jz operand");
        assert_eq!(&NAV_ASM[occ.span.start..occ.span.end], "g");
        let def = nav.definition_of(i).and_then(|d| nav.get(d)).expect("resolves");
        assert_eq!(&NAV_ASM[def.span.start..def.span.end], "g");
        assert_eq!(def.span.start, NAV_ASM.rfind("g:").expect("fixture"), "the LABEL, not an operand");
    }

    #[test]
    fn a_register_operand_is_not_a_name() {
        // `jz r0, g` has a Reg then a Label. Recording both would make go-to-definition fire on
        // a register, and `Shape::kinds()` is what tells them apart — a mnemonic list could not.
        let (_, nav) = parse_asm_nav(NAV_ASM);
        let r0 = NAV_ASM.find("r0, g").expect("fixture");
        assert_eq!(nav.at(r0), None, "r0 is a register, not a name");
    }

    #[test]
    fn a_dangling_jump_target_is_a_reference_that_resolves_to_nothing() {
        // Probed: this parses with `program: Some` and ZERO diagnostics. asm never checks jump
        // targets, so this is a clean file carrying a reference to nothing — not an error.
        let src = "result Nat\nf:\n\tjmp\tnowhere\n\tret\n";
        let (doc, nav) = parse_asm_nav(src);
        assert!(doc.program.is_some());
        assert_eq!(doc.diagnostics.len(), 0, "the premise: asm does not check jump targets");
        let (i, _) = nav.at(src.find("nowhere").expect("fixture")).expect("still a reference");
        assert_eq!(nav.definition_of(i), None);
    }

    #[test]
    fn a_duplicate_label_is_listed_twice_and_the_first_one_is_linked() {
        // Probed: `labels` comes back [("f", 0), ("f", 0)] with ZERO diagnostics — unlike `.tm`,
        // which diagnoses a duplicate state name. Both must appear in an outline.
        let src = "result Nat\nf:\nf:\n\tjmp\tf\n\tret\n";
        let (doc, nav) = parse_asm_nav(src);
        assert_eq!(doc.diagnostics.len(), 0, "the premise: asm does not diagnose duplicates");
        assert_eq!(nav.definitions().count(), 2);
        let (i, _) = nav.at(src.rfind('f').expect("fixture")).expect("the jmp operand");
        assert_eq!(nav.definition_of(i), Some(0), "the FIRST `f:`");
    }

    #[test]
    fn parse_asm_full_is_exactly_the_documents_half_of_parse_asm_nav() {
        for src in [NAV_ASM, "\tli\tr0, #1\n\tret\n", "", "li\n"] {
            assert_eq!(parse_asm_full(src), parse_asm_nav(src).0, "disagreement on {src:?}");
        }
    }

    #[test]
    fn every_label_taking_shape_is_covered_by_the_derivation() {
        // THE POINT OF DERIVING FROM `Shape::kinds()` IS LOST IF THE TEST HARDCODES WHAT THE
        // CODE REFUSES TO. This walks the real MNEMONICS table, builds a line for every entry
        // whose shape contains a Label, and asserts each produces exactly one reference. A
        // fourth label-taking mnemonic added later is covered the day it is added.
        let mut checked = 0;
        for (mnemonic, shape) in MNEMONICS {
            let kinds = shape.kinds();
            let Some(pos) = kinds.iter().position(|k| matches!(k, OperandKind::Label)) else {
                continue;
            };
            let operands: Vec<String> = kinds
                .iter()
                .enumerate()
                .map(|(i, k)| match k {
                    OperandKind::Reg => format!("r{i}"),
                    OperandKind::Imm => "#1".to_string(),
                    OperandKind::Label => "target".to_string(),
                })
                .collect();
            let src = format!("target:\n\t{mnemonic}\t{}\n", operands.join(", "));
            let (doc, nav) = parse_asm_nav(&src);
            assert!(doc.program.is_some(), "{mnemonic} line did not parse: {:?}", doc.diagnostics);
            let refs = nav.definitions().count();
            assert_eq!(refs, 1, "{mnemonic}: expected one label definition");
            let operand_at = src.rfind("target").expect("fixture");
            let (i, _) = nav.at(operand_at).unwrap_or_else(|| panic!("{mnemonic}: no name at operand {pos}"));
            assert_eq!(nav.definition_of(i), Some(0), "{mnemonic}: operand links to the label");
            checked += 1;
        }
        assert_eq!(checked, 3, "MNEMONICS has three label-taking entries today: jz, jmp, call");
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo nextest run -p redextape-core -E 'test(asm_navigation) or test(dangling_jump) or test(label_taking_shape)'`
Expected: compilation FAILS — `parse_asm_nav` does not exist.

- [ ] **Step 3: Invert `parse_instr` so it reports the label operand's offset**

`parse_instr` already splits the mnemonic, looks up `Shape::kinds()`, and splits the operands on
commas. **Wrapping it and re-deriving those three things would be a second copy of the operand
grammar** — the exact duplication this design refuses everywhere else. So the pair is inverted, the
same way `parse_tm_full` becomes `parse_tm_nav`'s first half: `parse_instr_at` does the parse and
records the offset as it splits, and `parse_instr` keeps its signature as the wrapper.

**This code was compiled and run against the real file before this plan was written.** With it in
place, `cargo nextest run -p redextape-core` reports 988 passed / 10 skipped and
`cargo clippy -p redextape-core --all-targets -- -D warnings` is clean — no existing test edited.

Replace the head of `parse_instr`:

```rust
/// One instruction line, already stripped of indentation and comments.
///
/// `parse_instr_at`'s instruction half, the shape `parse_asm` and `parse_tm` already use for the
/// same reason: one reader, two entry points, and no way for them to disagree.
fn parse_instr(text: &str) -> Result<Instr, String> {
    parse_instr_at(text).map(|(i, _)| i)
}

/// `parse_instr`, plus where the `Label` operand begins relative to the start of `text` — `None`
/// for the twenty-one shapes that take no label.
///
/// **THE OFFSET IS RECORDED AS THE OPERANDS ARE SPLIT**, which is the discipline `print_tm_inner`
/// already states for its own spans: an offset is exact by construction and nothing re-scans the
/// text. Which operand is the label comes from `Shape::kinds()`, the one table that says so — a
/// list of label-taking mnemonics here would be a second copy of `MNEMONICS` with no gate able to
/// hold the two in agreement.
fn parse_instr_at(text: &str) -> Result<(Instr, Option<usize>), String> {
    let (mnemonic, rest_raw) = text.split_once(char::is_whitespace).unwrap_or((text, ""));
    let shape = shape_of(mnemonic).ok_or_else(|| format!("unknown mnemonic `{mnemonic}`"))?;
    let kinds = shape.kinds();

    // Where `rest` begins in `text`: past the mnemonic and its delimiter, then past the leading
    // whitespace `trim` removes. Derived from LENGTHS rather than from the delimiter's width, so a
    // multi-byte whitespace character cannot shift it.
    let rest_start = (text.len() - rest_raw.len()) + (rest_raw.len() - rest_raw.trim_start().len());
    let rest = rest_raw.trim();
```

Replace the `operands` binding (the `Vec<&str>` collect and nothing else) with:

```rust
    // Each operand's text AND where it begins in `text`. Still bounded to `kinds.len() + 1` for
    // the reason the previous version stated: one operand past what any shape accepts is what lets
    // the arity check below tell "too many" from "too few".
    let mut operands: Vec<(&str, usize)> = Vec::new();
    if !rest.is_empty() {
        let mut cursor = rest_start;
        for piece in rest.split(',').take(kinds.len() + 1) {
            operands.push((piece.trim(), cursor + (piece.len() - piece.trim_start().len())));
            cursor += piece.len() + 1; // `+ 1` for the comma `split` consumed
        }
    }
```

The three operand closures now index a tuple. Change exactly these three lines:

```rust
        parse_reg(operands[i].0).ok_or_else(|| format!("`{}` is not a register", operands[i].0))
```
```rust
        parse_imm(operands[i].0).ok_or_else(|| format!("`{}` is not an immediate (expected `#n`)", operands[i].0))
```
```rust
        let l = operands[i].0;
```

Immediately before the `if let Some(op) = bin_op_for(mnemonic)` block, add:

```rust
    let label_at = kinds.iter().position(|k| matches!(k, OperandKind::Label)).map(|k| operands[k].1);
```

This sits AFTER the arity check, which is what makes `operands[k]` in bounds — the same invariant
the three closures rely on, and the one the long SAFETY INVARIANT comment above them documents.

Change the `bin_op_for` early return and the final match to carry the offset:

```rust
    if let Some(op) = bin_op_for(mnemonic) {
        return Ok((Instr::Bin(op, reg(0)?, reg(1)?, reg(2)?), label_at));
    }

    let instr = match mnemonic {
```

and close that match with `}?;` followed by:

```rust
    Ok((instr, label_at))
```

**Verified offsets.** With this shape in place, `parse_instr_at` returns these — measured, not
derived on paper. Add them as a unit test in the same module:

```rust
    #[test]
    fn the_label_operand_offset_survives_every_spacing_the_grammar_allows() {
        // Tabs, several spaces, and no space after the comma are all legal here, and each moves
        // the operand. A fixture using only the printer's own tab layout would pass against
        // arithmetic that is wrong for every hand-written file.
        for (text, want) in [
            ("jmp\tf", Some(4)),
            ("jz\tr0, f", Some(7)),
            ("call\tlong_name", Some(5)),
            ("jmp   f", Some(6)),
            ("jz\tr0,f", Some(6)),
            ("jmp f", Some(4)),
            ("li\tr0, #1", None),
            ("ret", None),
            ("add\tr0, r1, r2", None),
        ] {
            let (_, at) = parse_instr_at(text).unwrap_or_else(|e| panic!("{text:?}: {e}"));
            assert_eq!(at, want, "{text:?}");
        }
    }
```

- [ ] **Step 4: Thread the index through `parse_asm_nav`**

Add `use crate::nav::NameIndex;` and `use super::syntax::trimmed_at;` to the imports, and in `tm/syntax.rs` change `fn trimmed_at` to `pub(super) fn trimmed_at`.

Rename `pub fn parse_asm_full` to `pub fn parse_asm_nav`, change its return type to `(AsmDocument, NameIndex)`, and add above it:

```rust
/// Parse the register-assembly text form. Unchanged in signature and behaviour.
///
/// `parse_asm_nav`'s document half, for the reason `parse_tm_full` states.
#[must_use]
pub fn parse_asm_full(src: &str) -> AsmDocument {
    parse_asm_nav(src).0
}
```

Declare `let mut nav = NameIndex::default();` beside the other accumulators.

In the label branch, inside the `else` arm that pushes to `labels`, add after the `attach` call:

```rust
                let indent = content.len() - content.trim_start().len();
                let (name_text, pad) = trimmed_at(name);
                let at = line_start + indent + pad;
                nav.push_definition(name_text, Span::new(at, at + name_text.len()));
```

In the instruction branch, replace `match parse_instr(text)` with `match parse_instr_at(text)` and change the `Ok` arm to bind both halves:

```rust
            Ok((instr, label_at)) => {
                if let Some(rel) = label_at {
                    let indent = content.len() - content.trim_start().len();
                    // `text` is `before.trim()` and `before` starts where `content` does, so
                    // `text` begins exactly `indent` bytes in — there is no further leading pad.
                    // An earlier draft added `content.trim_start().len() - text.len()`, which
                    // measures what was stripped from the END (a trailing comment) and so pushed
                    // the span INTO the comment: `jmp f ; go back` reported the `k` of `back`.
                    let at = line_start + indent + rel;
                    if let Some(name) = label_operand_name(&instr) {
                        nav.push_reference(name, Span::new(at, at + name.len()));
                    }
                }
                code.push(instr);
                attach(&mut comments, &mut pending, AsmAnchor::Instr(code.len() - 1), comment);
            }
```

Add the accessor beside `bin_op_for`:

```rust
/// The label an instruction names, for the three shapes that name one.
///
/// Reading it off the parsed `Instr` rather than off the text is what keeps the span and the name
/// describing the same operand: `parse_instr` has already decided what the label is.
fn label_operand_name(i: &Instr) -> Option<&str> {
    match i {
        Instr::Jmp(l) | Instr::Call(l) | Instr::Jz(_, l) => Some(l.as_str()),
        _ => None,
    }
}
```

- [ ] **Step 5: Re-export both `_nav` entry points from `tm.rs`**

`tm/syntax.rs` and `tm/asm_syntax.rs` are private modules behind `tm.rs`'s `pub use` lists, so a
`pub fn` in either is unreachable from outside the crate until that list names it. Task 3 added
`parse_tm_nav` and did not export it — its tests reach it through `super::*` and pass regardless,
which is exactly why the gap is invisible until a consumer outside the crate tries the path.

Add `parse_tm_nav` to the `tm::syntax` re-export list and `parse_asm_nav` to the `tm::asm_syntax`
one, keeping each list's existing alphabetical order.

Then prove the paths resolve from OUTSIDE the crate, because that is the thing the unit tests
structurally cannot check — add to `crates/redextape-core/tests/` (or extend an existing
integration test) :

```rust
#[test]
fn the_nav_entry_points_are_reachable_from_outside_the_crate() {
    // `redextape-lsp` calls exactly these two paths. A `pub fn` in a private module is not
    // public, and this crate's own unit tests reach it through `super::*` either way — so
    // nothing inside `redextape-core` can tell the difference. This can.
    let (_doc, nav) = redextape_core::tm::parse_tm_nav("tapes 1\nstart q0\nstate q0: accept\n");
    assert_eq!(nav.definitions().count(), 1);
    let (_doc, nav) = redextape_core::tm::parse_asm_nav("f:\n\tret\n");
    assert_eq!(nav.definitions().count(), 1);
}
```

- [ ] **Step 6: Link and return**

Add `nav.link();` immediately before the final `if diags.is_empty() { .. } else { .. }`, and wrap both arms:

```rust
    if diags.is_empty() {
        (AsmDocument { program: Some(Program { code, labels }), header, comments, diagnostics: diags }, nav)
    } else {
        (AsmDocument { program: None, header: None, comments: Vec::new(), diagnostics: diags }, nav)
    }
```

- [ ] **Step 7: Run everything**

Run: `cargo nextest run -p redextape-core`
Expected: PASS, with 6 more tests than before and no pre-existing test edited.

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: clean. If `label_operand_name`'s match arms do not cover the real `Instr` variant names, read `tm/asm.rs`'s `pub enum Instr` and correct them — do not add a catch-all that hides a missing variant.

- [ ] **Step 8: Sabotage**

1. In `parse_instr_at`, replace the `Shape::kinds()` lookup with a hardcoded `matches!(mnemonic, "jmp" | "call")` — dropping `jz`. Expected: `every_label_taking_shape_is_covered_by_the_derivation` fails on `jz`, and `asm_navigation_records_labels_and_the_label_operand_of_any_instruction` fails at the `jz` operand.
2. Change `if i == k` to `if i == 0`. Expected: `a_register_operand_is_not_a_name` fails — `r0` becomes a name.
3. Delete the `nav.link()` call. Expected: `a_duplicate_label_is_listed_twice_and_the_first_one_is_linked` fails.

Revert each.

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-core/src/tm/asm_syntax.rs crates/redextape-core/src/tm/syntax.rs
git commit -m "asm: parse_asm_nav, with the label operand found through Shape::kinds

A label declaration is a definition and the Label operand of any
instruction is a reference. Which operand that is comes from
Shape::kinds(), the table that already says so -- a list of label-taking
mnemonics here would be a second copy of MNEMONICS with nothing able to
hold the two in agreement, and the test walks the real table rather than
naming jz, jmp and call.

asm accepts a dangling jump target and a duplicate label with zero
diagnostics, unlike .tm, which diagnoses both. Both are recorded: the
first definition is linked and every definition is listed."
```

---

## Task 5: `Language::nav` and `textDocument/definition`

**Files:**
- Modify: `crates/redextape-lsp/src/language.rs`
- Modify: `crates/redextape-lsp/src/lib.rs`

**Interfaces:**
- Consumes: `NameIndex` and its queries; `LineIndex::offset` from Task 1; `parse_tm_nav`/`parse_asm_nav` from Tasks 3–4.
- Produces: `Language::nav(self, src: &str) -> Option<NameIndex>`; the `definition_provider` capability; the `textDocument/definition` arm.

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-lsp/src/language.rs`'s `mod tests`:

```rust
    #[test]
    fn only_the_two_artifact_forms_have_a_navigation_index() {
        // `.rxt` waits on a binder-resolution pass and `.rxlambda` on a term type that carries
        // no source positions at all. `None` is the answer, not an empty index: an empty index
        // would tell the server "this file has no names in it", which is a different claim.
        assert!(Language::Tm.nav("tapes 1\nstart q0\nstate q0: accept\n").is_some());
        assert!(Language::Asm.nav("f:\n\tret\n").is_some());
        assert!(Language::Redextape.nav("let x = 1;\nx\n").is_none());
        assert!(Language::Lambda.nav("λx. x").is_none());
    }
```

Add to `crates/redextape-lsp/src/lib.rs`'s `mod tests`:

```rust
    /// `scan` is defined at 25 and referenced at 14 (`start`) and 66 (`goto`). Three
    /// occurrences of one name, so a handler that returns "some scan" is distinguishable
    /// from one that returns the right one.
    const NAV_TM: &str = "tapes 1\nstart scan\nstate scan:\n  [1] -> write [*], move [R], goto scan\n  [*] -> write [1], move [S], goto halt\nstate halt: accept\n";

    fn open_tm(server: &mut Server, uri: &str, text: &str) {
        server.handle(notification(
            "textDocument/didOpen",
            &json!({"textDocument": {"uri": uri, "languageId": "redextape_tm", "version": 1, "text": text}}),
        ));
    }

    #[test]
    fn definition_on_a_goto_answers_the_state_that_defines_it() {
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        // The `goto scan` at byte 66 is on line 3. Under the default (utf-16) encoding with no
        // multi-byte characters in this fixture, the character column is the byte column.
        let out = server.handle(request(
            2,
            "textDocument/definition",
            &json!({"textDocument": {"uri": "file:///a.tm"}, "position": {"line": 3, "character": 35}}),
        ));
        let v = success_value(&out);
        // Line 2 is `state scan:`; the name begins at character 6. NOT line 1 (`start scan`),
        // which is the other place the string `scan` appears before this one.
        assert_eq!(v["uri"], "file:///a.tm");
        assert_eq!(v["range"]["start"], json!({"line": 2, "character": 6}));
        assert_eq!(v["range"]["end"], json!({"line": 2, "character": 10}));
    }

    #[test]
    fn definition_off_a_name_is_null_rather_than_an_error() {
        // A cursor on whitespace, on a keyword, in a file this server does not serve, or in a
        // file it has never opened. All four are ordinary, and an error would surface in the
        // editor as a failed command.
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        for (uri, line, character) in
            [("file:///a.tm", 0, 0), ("file:///a.tm", 3, 2), ("file:///nope.tm", 2, 6), ("file:///a.tm", 99, 0)]
        {
            let out = server.handle(request(
                2,
                "textDocument/definition",
                &json!({"textDocument": {"uri": uri}, "position": {"line": line, "character": character}}),
            ));
            assert_eq!(success_value(&out), serde_json::Value::Null, "{uri} {line}:{character}");
        }
    }

    #[test]
    fn definition_in_a_broken_file_still_answers() {
        // THE REASON THE INDEX SURVIVES A FAILED PARSE. This file has an unknown goto target,
        // so `machine` is None and it publishes a diagnostic — and go-to-definition on the
        // `start scan` reference still lands on `state scan:`.
        let mut server = Server::new();
        let broken = "tapes 1\nstart scan\nstate scan:\n  [*] -> write [*], move [S], goto nowhere\n";
        open_tm(&mut server, "file:///b.tm", broken);
        let out = server.handle(request(
            2,
            "textDocument/definition",
            &json!({"textDocument": {"uri": "file:///b.tm"}, "position": {"line": 1, "character": 6}}),
        ));
        assert_eq!(success_value(&out)["range"]["start"], json!({"line": 2, "character": 6}));
    }

    #[test]
    fn initialize_advertises_the_three_navigation_providers() {
        let mut server = Server::new();
        let out = server.handle(request(1, "initialize", &json!(InitializeParams::default())));
        let caps = initialize_result(&out).capabilities;
        assert_eq!(caps.definition_provider, Some(DefinitionProvider::Bool(true)));
    }
```

If `request`, `notification`, `success_value` or `initialize_result` helpers do not already exist in that test module under those names, read the module and use the ones that do — do not add a second set.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo nextest run -p redextape-lsp`
Expected: compilation FAILS — `Language::nav` does not exist.

- [ ] **Step 3: Add `Language::nav`**

In `crates/redextape-lsp/src/language.rs`, add after `format`:

```rust
    /// The name-span index for this form, or `None` for a form that has none.
    ///
    /// **`None` IS NOT AN EMPTY INDEX.** An empty index says "this document contains no names",
    /// which is a claim about the document; `None` says "this server cannot answer navigation
    /// for this form", which is a claim about the server. `.rxt` waits on a binder-resolution
    /// pass — names there are scoped, so an occurrence resolves to a BINDING and not to a name —
    /// and `.rxlambda` on a term type that carries no source positions at all.
    #[must_use]
    pub fn nav(self, src: &str) -> Option<NameIndex> {
        match self {
            Language::Tm => Some(redextape_core::tm::parse_tm_nav(src).1),
            Language::Asm => Some(redextape_core::tm::parse_asm_nav(src).1),
            Language::Redextape | Language::Lambda => None,
        }
    }
```

Add `use redextape_core::nav::NameIndex;` to that file's imports.

- [ ] **Step 4: Add the capability and the dispatch arm**

In `crates/redextape-lsp/src/lib.rs`, add to the `ServerCapabilities` literal in `initialize`, beside `document_formatting_provider`:

```rust
            definition_provider: Some(DefinitionProvider::Bool(true)),
```

Add to `handle`'s match, beside the formatting arm:

```rust
            ("textDocument/definition", Some(id)) => vec![self.definition(id, params)],
```

Add the handler beside `formatting`:

```rust
    /// Go to the definition of the name under the cursor.
    ///
    /// `null` for every case with no answer — an unknown URI, a form with no index, a cursor
    /// that is not on a name, a reference to a name nothing defines. `null` is what LSP says
    /// "no definition" is, and an error would surface in the editor as a failed command for the
    /// ordinary case of a cursor sitting on a keyword.
    fn definition(&self, id: Id, params: serde_json::Value) -> Outgoing {
        let found = serde_json::from_value::<DefinitionParams>(params).ok().and_then(|p| {
            let pos = p.text_document_position_params;
            let (doc, nav, offset) = self.locate(&pos.text_document.uri.to_string(), pos.position)?;
            let (i, _) = nav.at(offset)?;
            let target = nav.get(nav.definition_of(i)?)?;
            Some(DefinitionResponse::Definition(Definition::Location(Location::new(
                pos.text_document.uri,
                doc.index.range(&doc.text, target.span, self.encoding),
            ))))
        });
        Outgoing::Response(ResponseObject::from_success::<DefinitionRequest>(id, found))
    }

    /// The document, its index and the cursor as a byte offset — the three things every
    /// navigation handler starts from.
    ///
    /// One place, so the three handlers cannot disagree about what "the name under the cursor"
    /// means. `None` for an untracked URI or a form this server does not index.
    fn locate(&self, uri: &str, pos: Position) -> Option<(&crate::document::Document, NameIndex, usize)> {
        let doc = self.documents.get(uri)?;
        let nav = doc.language?.nav(&doc.text)?;
        let offset = doc.index.offset(&doc.text, pos, self.encoding);
        Some((doc, nav, offset))
    }
```

Add to the `gen_lsp_types` import list: `Definition, DefinitionParams, DefinitionProvider, DefinitionRequest, DefinitionResponse, Location`. Add `use redextape_core::nav::NameIndex;`.

- [ ] **Step 5: Run the tests**

Run: `cargo nextest run -p redextape-lsp`
Expected: PASS. `initialize_advertises_full_sync_and_formatting` still passes unchanged — `semantic_tokens_provider` and `hover_provider` stay `None`, and only its `definition_provider` assertion needs updating, which step 6 does.

- [ ] **Step 6: Update the one stale assertion**

In `initialize_advertises_full_sync_and_formatting`, change

```rust
        assert_eq!(caps.definition_provider, None);
```

to

```rust
        // Slice 2 serves definition. The two assertions above it stay: they are what keeps a
        // capability this server does not serve from appearing without a decision.
        assert_eq!(caps.definition_provider, Some(DefinitionProvider::Bool(true)));
```

Run: `cargo nextest run -p redextape-lsp`
Expected: PASS.

- [ ] **Step 7: Sabotage**

1. In `definition`, replace `nav.definition_of(i)?` with `Some(i)` — answer the occurrence under the cursor. Expected: `definition_on_a_goto_answers_the_state_that_defines_it` fails, because the answer becomes line 3 rather than line 2.
2. In `Language::nav`, return `Some(NameIndex::default())` for `Redextape`. Expected: `only_the_two_artifact_forms_have_a_navigation_index` fails.
3. In `locate`, drop the `doc.language?` check (e.g. `doc.language.unwrap_or(Language::Tm)`). Expected: **nothing fails.** That is the finding, and the step is to add a test that does catch it.

   **THE OBVIOUS COVERING TEST ALSO DOES NOT CATCH IT, AND THAT WAS MEASURED RATHER THAN GUESSED.**
   A fixture of arbitrary non-TM text (Rust source, say) opened under an unrecognised `languageId`
   still answers `null` under the sabotage — because that text parses to an *empty* index either
   way, so the `null` proves nothing about whether the check ran. The fixture must be **valid
   `.tm` text opened under an unrecognised `languageId`**: only then does a server that falls back
   to a default `Language` answer with a real `Location` instead of `null`. Write the test, run the
   sabotage against it, and confirm it goes red before reverting.

Revert each.

- [ ] **Step 8: Verify the transport boundary is untouched**

Run: `git grep -l "use lsp_server\|lsp_server::" crates/redextape-lsp/src | wc -l`
Expected: `1`.

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-lsp/src/language.rs crates/redextape-lsp/src/lib.rs
git commit -m "lsp: textDocument/definition for .tm and .asm

Language::nav is the fifth per-form method beside diagnostics and format,
and it answers None rather than an empty index for the two forms with no
index -- an empty index would claim the document has no names in it,
which is a different statement from this server not serving the form.

A cursor with no answer gets null: an unknown URI, a form with no index,
a cursor on a keyword, a reference to a name nothing defines. An error
would surface as a failed editor command in ordinary use.

locate() is the one place that turns a URI and a position into a
document, an index and a byte offset, so the three handlers cannot
disagree about what the name under the cursor is."
```

---

## Task 6: `textDocument/references`

**Files:**
- Modify: `crates/redextape-lsp/src/lib.rs`

**Interfaces:**
- Consumes: `locate`, `NameIndex::{at, definition_of, references_to, get}`.
- Produces: the `references_provider` capability and the `textDocument/references` arm.

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-lsp/src/lib.rs`'s `mod tests`:

```rust
    #[test]
    fn references_lists_every_mention_and_honours_include_declaration() {
        // `scan` is referenced twice — `start scan` on line 1 and `goto scan` on line 3 — and
        // defined once on line 2. The declaration's inclusion is the CLIENT's choice, so the
        // two calls below must differ; a handler that ignored the flag would pass one of them.
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);

        let ask = |server: &mut Server, include: bool| {
            let out = server.handle(request(
                3,
                "textDocument/references",
                &json!({
                    "textDocument": {"uri": "file:///a.tm"},
                    "position": {"line": 2, "character": 6},
                    "context": {"includeDeclaration": include}
                }),
            ));
            success_value(&out)
                .as_array()
                .expect("an array")
                .iter()
                .map(|l| (l["range"]["start"]["line"].as_u64(), l["range"]["start"]["character"].as_u64()))
                .collect::<Vec<_>>()
        };

        assert_eq!(ask(&mut server, false), vec![(Some(1), Some(6)), (Some(3), Some(35))]);
        assert_eq!(ask(&mut server, true), vec![(Some(2), Some(6)), (Some(1), Some(6)), (Some(3), Some(35))]);
    }

    #[test]
    fn references_from_a_reference_finds_its_siblings_not_just_itself() {
        // Asking from `goto scan` on line 3 must give the same set as asking from the
        // definition. A handler that returned only the occurrence under the cursor would pass
        // a test that asked from the definition and nothing else.
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        let out = server.handle(request(
            3,
            "textDocument/references",
            &json!({
                "textDocument": {"uri": "file:///a.tm"},
                "position": {"line": 3, "character": 35},
                "context": {"includeDeclaration": false}
            }),
        ));
        let lines: Vec<_> = success_value(&out)
            .as_array()
            .expect("an array")
            .iter()
            .map(|l| l["range"]["start"]["line"].as_u64())
            .collect();
        assert_eq!(lines, vec![Some(1), Some(3)]);
    }

    #[test]
    fn references_off_a_name_is_null() {
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        let out = server.handle(request(
            3,
            "textDocument/references",
            &json!({
                "textDocument": {"uri": "file:///a.tm"},
                "position": {"line": 0, "character": 0},
                "context": {"includeDeclaration": true}
            }),
        ));
        assert_eq!(success_value(&out), serde_json::Value::Null);
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo nextest run -p redextape-lsp -E 'test(references)'`
Expected: FAIL — the method is not served, so the response is a `MethodNotFound` error rather than a result.

- [ ] **Step 3: Implement**

Add the capability beside `definition_provider`:

```rust
            references_provider: Some(ReferencesProvider::Bool(true)),
```

**And add its assertion to `initialize_advertises_the_three_navigation_providers`.** That test is
named for three providers and asserts one, because Task 5 was the only one that existed then —
which makes its name a claim the test does not support. Task 6 and Task 7 each add theirs, and the
name becomes true rather than being corrected.

Add the dispatch arm:

```rust
            ("textDocument/references", Some(id)) => vec![self.references(id, params)],
```

Add the handler:

```rust
    /// Every mention of the name under the cursor, in this document.
    ///
    /// **THE DECLARATION IS INCLUDED ONLY WHEN THE CLIENT ASKS FOR IT.** `include_declaration`
    /// is a parameter, not a preference: answering the same list either way would be ignoring
    /// it. It comes first when present, which is where an editor's quickfix list wants it.
    fn references(&self, id: Id, params: serde_json::Value) -> Outgoing {
        let found = serde_json::from_value::<ReferenceParams>(params).ok().and_then(|p| {
            let include = p.context.include_declaration;
            let pos = p.text_document_position_params;
            let uri = pos.text_document.uri;
            let (doc, nav, offset) = self.locate(&uri.to_string(), pos.position)?;
            let (i, _) = nav.at(offset)?;
            let def = nav.definition_of(i)?;
            let spans = include
                .then(|| nav.get(def).map(|o| o.span))
                .flatten()
                .into_iter()
                .chain(nav.references_to(def).map(|o| o.span));
            Some(
                spans
                    .map(|s| Location::new(uri.clone(), doc.index.range(&doc.text, s, self.encoding)))
                    .collect::<Vec<_>>(),
            )
        });
        Outgoing::Response(ResponseObject::from_success::<ReferencesRequest>(id, found))
    }
```

Add `ReferenceParams, ReferencesProvider, ReferencesRequest` to the `gen_lsp_types` imports.

- [ ] **Step 4: Run the tests**

Run: `cargo nextest run -p redextape-lsp`
Expected: PASS.

- [ ] **Step 5: Sabotage**

1. Replace `include.then(..)` with `Some(..)` unconditionally. Expected: `references_lists_every_mention_and_honours_include_declaration` fails on the `false` call.
2. Replace `nav.references_to(def)` with `std::iter::once(nav.get(i)?.span)`. Expected: `references_from_a_reference_finds_its_siblings_not_just_itself` fails.

Revert each.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-lsp/src/lib.rs
git commit -m "lsp: textDocument/references for .tm and .asm

Asking from a reference gives the same set as asking from the definition,
because both resolve to the definition first and the index is keyed by
the link rather than by the name.

include_declaration is honoured rather than assumed. It is a parameter,
not a preference, and answering the same list either way would ignore it;
the two tests differ only in that flag."
```

---

## Task 7: `textDocument/documentSymbol`

**Files:**
- Modify: `crates/redextape-lsp/src/lib.rs`

**Interfaces:**
- Consumes: `Documents::get`, `Language::nav`, `NameIndex::definitions`.
- Produces: the `document_symbol_provider` capability and the `textDocument/documentSymbol` arm.

**Note the `-D warnings` trap:** `DocumentSymbol` has a `#[deprecated]` field. The construction site needs `#[allow(deprecated)]` or the build fails. This was confirmed by compiling it.

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-lsp/src/lib.rs`'s `mod tests`:

```rust
    #[test]
    fn document_symbol_lists_the_states_a_tm_file_defines() {
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        let out = server
            .handle(request(4, "textDocument/documentSymbol", &json!({"textDocument": {"uri": "file:///a.tm"}})));
        let v = success_value(&out);
        let syms = v.as_array().expect("an array");
        let names: Vec<_> = syms.iter().map(|s| s["name"].as_str()).collect();
        // The DEFINITIONS, in source order. `start scan` is a reference and must not appear.
        assert_eq!(names, vec![Some("scan"), Some("halt")]);
        assert_eq!(syms[0]["range"]["start"], json!({"line": 2, "character": 6}));
        assert_eq!(syms[0]["selectionRange"], syms[0]["range"], "both are the name span");
        assert!(syms[0]["children"].is_null(), "flat, not nested: 18,499 rules under 7,353 states is not an outline");
    }

    #[test]
    fn a_tm_state_and_an_asm_label_get_different_symbol_kinds() {
        // `nav.rs` is language-agnostic on purpose, so the kind is chosen here — the one place
        // that knows the document's language. A single hardcoded kind would pass a test that
        // only looked at one form.
        let mut server = Server::new();
        open_tm(&mut server, "file:///a.tm", NAV_TM);
        server.handle(notification(
            "textDocument/didOpen",
            &json!({"textDocument": {
                "uri": "file:///a.asm", "languageId": "redextape_asm", "version": 1,
                "text": "result Nat\nf:\n\tret\n"
            }}),
        ));
        let kind = |server: &mut Server, uri: &str| {
            let out = server.handle(request(4, "textDocument/documentSymbol", &json!({"textDocument": {"uri": uri}})));
            success_value(&out)[0]["kind"].as_u64()
        };
        let tm = kind(&mut server, "file:///a.tm");
        let asm = kind(&mut server, "file:///a.asm");
        assert!(tm.is_some() && asm.is_some());
        assert_ne!(tm, asm, "a state and a label are not the same kind of thing");
    }

    #[test]
    fn document_symbol_is_null_for_a_form_this_server_does_not_index() {
        // A `.rxt` buffer is served diagnostics and formatting and no navigation. Null, not an
        // empty array: an empty array claims the file defines nothing.
        let mut server = Server::new();
        server.handle(notification(
            "textDocument/didOpen",
            &json!({"textDocument": {
                "uri": "file:///a.rxt", "languageId": "redextape", "version": 1, "text": "fn f() { 1 }\nf()\n"
            }}),
        ));
        let out = server
            .handle(request(4, "textDocument/documentSymbol", &json!({"textDocument": {"uri": "file:///a.rxt"}})));
        assert_eq!(success_value(&out), serde_json::Value::Null);

        let out = server
            .handle(request(4, "textDocument/documentSymbol", &json!({"textDocument": {"uri": "file:///gone.tm"}})));
        assert_eq!(success_value(&out), serde_json::Value::Null, "an untracked URI too");
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo nextest run -p redextape-lsp -E 'test(document_symbol) or test(symbol_kinds)'`
Expected: FAIL — `MethodNotFound`.

- [ ] **Step 3: Implement**

Add the capability:

```rust
            document_symbol_provider: Some(DocumentSymbolProvider::Bool(true)),
```

**And add its assertion to `initialize_advertises_the_three_navigation_providers`**, completing the
three its name promises. After this task that test must assert all three, and it is the only test
asserting `references_provider` and `document_symbol_provider` at all.

Add the dispatch arm:

```rust
            ("textDocument/documentSymbol", Some(id)) => vec![self.document_symbol(id, params)],
```

Add the handler:

```rust
    /// Every name this document DEFINES, flat and in source order.
    ///
    /// **FLAT, NOT NESTED.** Rules could hang under their state, but the demo suite contains a
    /// machine of 7,353 states carrying 18,499 rules, and nesting the second under the first is
    /// not an outline a human uses. (`map_fold`'s 25,852 is its ROW count, the two added together.)
    ///
    /// `range` and `selection_range` are both the name's span. The protocol only requires the
    /// selection range to be contained by the range, and the index stores name spans — a range
    /// enclosing a whole state's rules would mean the parser recording where each state's block
    /// ends, which is more than navigation needs.
    ///
    /// The `SymbolKind` is chosen HERE because this is the one place that knows the document's
    /// language; `nav.rs` deliberately holds no grammar and cannot tell a state from a label.
    fn document_symbol(&self, id: Id, params: serde_json::Value) -> Outgoing {
        let found = serde_json::from_value::<DocumentSymbolParams>(params).ok().and_then(|p| {
            let doc = self.documents.get(&p.text_document.uri.to_string())?;
            let language = doc.language?;
            let nav = language.nav(&doc.text)?;
            let kind = match language {
                // A TM state is a place the machine can be in; an asm label names a point in a
                // program. `Class` and `Function` are the nearest of the protocol's fixed set.
                Language::Tm => SymbolKind::Class,
                Language::Asm => SymbolKind::Function,
                // Unreachable while `nav` answers `None` for these two, and answered rather
                // than asserted so that PR B adding `.rxt` cannot make this panic.
                Language::Redextape | Language::Lambda => SymbolKind::Variable,
            };
            Some(DocumentSymbolResponse::DocumentSymbolList(
                nav.definitions()
                    .map(|o| {
                        let range = doc.index.range(&doc.text, o.span, self.encoding);
                        // `DocumentSymbol::deprecated` is a #[deprecated] field with no default
                        // and a positional slot in `::new`, so BOTH construction routes trip the
                        // lint that `-D warnings` makes fatal. The allow is the only way to
                        // build the type this protocol requires.
                        #[allow(deprecated)]
                        DocumentSymbol {
                            name: o.name.clone(),
                            detail: None,
                            kind,
                            tags: None,
                            deprecated: None,
                            range,
                            selection_range: range,
                            children: None,
                        }
                    })
                    .collect(),
            ))
        });
        Outgoing::Response(ResponseObject::from_success::<DocumentSymbolRequest>(id, found))
    }
```

Add `DocumentSymbol, DocumentSymbolParams, DocumentSymbolProvider, DocumentSymbolRequest, DocumentSymbolResponse, SymbolKind` to the `gen_lsp_types` imports, and `use crate::language::Language;`.

- [ ] **Step 4: Run everything**

Run: `cargo nextest run -p redextape-lsp && cargo clippy --workspace --all-targets -- -D warnings`
Expected: both clean. If clippy reports the deprecated field, the `#[allow(deprecated)]` is on the wrong item — it must sit on the struct-literal expression's statement.

- [ ] **Step 5: Sabotage**

1. Change `Language::Asm => SymbolKind::Function` to `SymbolKind::Class`. Expected: `a_tm_state_and_an_asm_label_get_different_symbol_kinds` fails.
2. Change `nav.definitions()` to iterate every occurrence. Expected: `document_symbol_lists_the_states_a_tm_file_defines` fails — `scan` would appear three times.
3. Return `Some(DocumentSymbolResponse::DocumentSymbolList(Vec::new()))` instead of `None` for a `.rxt` buffer. Expected: `document_symbol_is_null_for_a_form_this_server_does_not_index` fails.

Revert each.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-lsp/src/lib.rs
git commit -m "lsp: textDocument/documentSymbol for .tm and .asm

Definitions only, flat, in source order. A TM state and an asm label get
different SymbolKinds, chosen here because this is the one place that
knows the document's language -- nav.rs holds no grammar and cannot tell
them apart.

range and selectionRange are both the name span. A range enclosing a
whole state's rules would mean the parser recording where each block
ends, which is more than navigation needs.

DocumentSymbol::deprecated is a #[deprecated] field with no Default and a
positional slot in ::new, so both construction routes trip the lint that
-D warnings makes fatal. The allow is load-bearing."
```

---

## Task 8: End-to-end verification and the roadmap entry

**Files:**
- Modify: `crates/redextape-lsp/tests/protocol.rs`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no new code interfaces; a protocol-level regression test and the roadmap entry the repository requires before a PR is opened.

- [ ] **Step 1: Add a navigation round trip to the protocol test**

`tests/protocol.rs` is the one test that spawns the binary and the only thing that can see framing and the handshake. Extend `server_binary_speaks_the_protocol` after its existing exchanges — do not add a second `#[test]` that spawns a second process:

```rust
    // Navigation over the wire. The handler tests call `Server::handle` directly and cannot see
    // that a `Location` survives serialization, or that a request arriving after several
    // notifications is still answered against the right document version.
    send(
        &mut stdin,
        &serde_json::json!({
            "jsonrpc": "2.0", "id": 10, "method": "textDocument/definition",
            "params": {
                "textDocument": {"uri": "file:///nav.tm"},
                "position": {"line": 3, "character": 35}
            }
        }),
    );
    let reply = recv(&mut stdout);
    assert_eq!(reply["id"], 10);
    assert_eq!(reply["result"]["uri"], "file:///nav.tm");
    assert_eq!(reply["result"]["range"]["start"]["line"], 2);
    assert_eq!(reply["result"]["range"]["start"]["character"], 6);
```

This needs a `didOpen` for `file:///nav.tm` with `languageId` `redextape_tm` and the `NAV_TM` text earlier in the same test, before the request. Add it in the same style as the existing `didOpen` in that file, and read the surrounding code for the exact shape rather than copying this block blind.

- [ ] **Step 2: Run the full suite and the local gate**

Run: `bash scripts/check-all.sh`
Expected: every check passes. This is the same script CI runs.

- [ ] **Step 3: Measure the figures the roadmap entry will carry**

Run each and record the exact output — do **not** carry a number from an earlier task's report:

```bash
git rev-list --count main..HEAD
git diff --shortstat main..HEAD
cargo nextest run --workspace
cargo nextest run -p redextape-lsp
cargo nextest run -p redextape-core
cargo llvm-cov nextest --workspace --fail-under-lines 90
git grep -l "use lsp_server\|lsp_server::" crates/redextape-lsp/src | wc -l
cargo tree -p redextape-core --edges normal
```

Every figure in the roadmap entry names the commit it was measured at. `git rev-list` and `git diff` name a SHA because only they can move once the entry itself is committed.

- [ ] **Step 4: Verify in a real Neovim, with no scaffolding**

The plugin is expected to need no change — `vim.lsp.buf.definition` dispatches off the capabilities the server advertises. **Confirm it rather than assume it.**

**THIS COMMAND IS THE CORRECTED ONE. The first version of this step was blind in three new ways on top of the slice-1 trap it was written to correct, and each had to be found by running it** — the reasons are below the command, and the roadmap entry for this branch records them as a finding.

```bash
# --release, not a bare build: plugin/redextape.lua resolves the binary at
# target/release/redextape-lsp, then PATH, and warns instead of attaching if it finds neither.
cargo build --release -p redextape-lsp
SP=/tmp/claude-1000/nav-probe            # anywhere outside the tree with no /redextape/ component
mkdir -p "$SP"
printf 'tapes 1\nstart scan\nstate scan:\n  [1] -> write [*], move [R], goto scan\n  [*] -> write [1], move [S], goto halt\nstate halt: accept\n' > "$SP/nav-probe.tm"
cat > "$SP/probe.lua" <<'LUA'
-- OBSERVATION ONLY. This file starts no client, registers no autocmd and sets no filetype:
-- everything it prints has to have been done by plugin/redextape.lua and the server.
vim.api.nvim_win_set_cursor(0, { 4, 35 })       -- the `s` of `scan` in `goto scan`
vim.wait(5000, function() return #vim.lsp.get_clients({ bufnr = 0 }) > 0 end)
print("filetype=" .. vim.bo.filetype)
print("lsp_clients=" .. #vim.lsp.get_clients({ bufnr = 0 }))
vim.lsp.buf.definition()
vim.wait(3000)
local a = vim.api.nvim_win_get_cursor(0)
print("cursor_after=" .. a[1] .. "," .. a[2])
print("line_under_cursor=" .. vim.api.nvim_get_current_line())
LUA
nvim --headless -u NONE \
  --cmd 'set runtimepath=/usr/share/nvim/runtime,'"$PWD" \
  -c 'filetype on' \
  -c "source $PWD/plugin/redextape.lua" \
  -c "edit $SP/nav-probe.tm" \
  -c "luafile $SP/probe.lua" \
  -c 'qa!'
```

Expected: `filetype=redextape_tm`, `lsp_clients=1`, `cursor_after=3,6`, `line_under_cursor=state scan:`.

**Run the control too, and record its output.** The same command with the `source` line removed must print `filetype=tcl` — Neovim's own built-in mapping for `.tm` — with `lsp_clients=0` and the cursor still at `4,35`. Without that run there is nothing showing the real run's answers came from the plugin rather than from the harness, which is the failure the grammar slice recorded against three green verifications in a row.

**Why the first version of this command could not have observed anything:**

- **It never moved the cursor.** It called `vim.lsp.buf.definition()` where `:edit` leaves it — line 1, column 0, on the `tapes` keyword, where `null` is the correct answer — and then printed the cursor's line, which is the starting line whether navigation works or not. Its stated pass condition, "the definition's line, not the cursor's starting line", is unsatisfiable, and the reading is the same for a working feature and a missing one.
- **`cargo build -p redextape-lsp` builds `target/debug/`, and the plugin looks in `target/release/`.** With nothing named `redextape-lsp` on `PATH`, `server_cmd()` returns `nil` and no client ever attaches.
- **`-u NONE` sets `loadplugins=false`, which turns filetype detection off**, because Neovim's detection lives in a bundled runtime *plugin*. The plugin's `vim.filetype.add` then registers a rule nothing triggers: measured, `vim.bo.filetype` is the empty string and there are zero clients, under the corrected `-c` ordering. Slice 1's fix corrected the ordering trap sitting on top of a harness that was already inert. `-c 'filetype on'`, with the runtimepath pinned so no user configuration is reachable, is what turns it back on.
**And one constraint on fixing it rather than a fourth defect in it: `nvim` accepts at most ten `+command`/`-c`/`--cmd` arguments together** — measured, ten run and eleven exit 1 with `Too many "+command", "-c command" or "--cmd command" arguments`. The first version uses eight of the ten, so the cursor move plus the filetype, client-count and cursor assertions do not fit inside its shape. Putting the observation in a `luafile` is what keeps it under the limit.

**The `-c` ordering trap slice 1 hit is still real and still handled here.** Neovim processes `-c` commands after positional file arguments regardless of where they sit on the command line, so a probe file passed positionally gets its filetype before the plugin loads. Opening it with `-c 'edit <path>'` after sourcing the plugin is what makes the filetype right.

If the plugin does need a change, make it and say so in the roadmap entry — the design predicted no change and a prediction that turns out wrong is worth recording.

- [ ] **Step 5: Write the roadmap entry**

Append an entry to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, in the established shape: an ALL-CAPS heading naming what shipped and what the branch learned, a design and plan link, the body, a `##### WHAT STAYS OPEN` list, and a `##### VERIFICATION` block whose every figure names the command that produced it.

`WHAT STAYS OPEN` must carry at least these, which this plan does not close:

- **PR B — `.rxt` navigation** — needs the binder-resolution pass in `analysis`, and the AST growing name spans for `Let`/`Fn`/`Assign` and for the two `params: Vec<String>` fields.
- **`.rxlambda` has no navigation and cannot cheaply get any** — `LambdaTerm` is de Bruijn with a print-only name hint and no source positions at all.
- **No cross-form navigation** — `SourceMap::tm_owner` returns `None` for a name from a different lowering and `source_span` returns `None` for a map built by `build`, so an authored `.tm` buffer yields nothing without knowing which `.rxt` produced it and at which encoding.
- **No rename and no `documentHighlight`** — `documentHighlight` is the cheapest follow-on named anywhere in this design.
- **`scripts/check-lua.sh`'s `GRAMMARS`-to-C-symbol check still has no self-test** — carried forward from slice 1, still out of scope, and still the shape the `FILETYPES` check beside it already has.

- [ ] **Step 6: Re-run the gates after writing the entry**

Run: `bash scripts/check-citations.sh && bash scripts/check-doc-figures.sh && bash scripts/check-shared-docs.sh && bash scripts/check-text-bytes.sh`
Expected: all four pass. `check-doc-figures` compares documented figures against the tree, so a figure typed by hand into the entry will be caught here.

- [ ] **Step 7: Commit**

**TWO COMMITS, NOT ONE, AND THE REASON IS THE ANCHOR.** The first version of this step committed the protocol test and the roadmap entry together — which makes the entry's own git figures unanchorable, because the SHA they would name is the SHA of the commit being written. Committing the source change first gives the entry a fixed commit to measure `main..<SHA>` against, and leaves the entry commit as the Markdown-only one the "everything after the anchor is Markdown" property needs.

```bash
# 1. The source change. This SHA is the anchor every figure in the entry names.
git add crates/redextape-lsp/tests/protocol.rs
git commit -m "lsp: a navigation round trip over real framing

Everything else in this crate calls Server::handle directly, so nothing
else can see that a Location survives serialization and the framed write
loop, or that a request answered after three didOpen notifications on one
connection still reads the document it names."

# 2. Measure the Step 3 figures at that SHA, write the entry, then commit the
#    Markdown on its own.
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md \
        docs/superpowers/plans/2026-09-06-lsp-navigation-tm-asm.md
git commit -m "Roadmap: the navigation slice, and the verification command that could not verify"
```

---

## Self-Review

**Spec coverage.** §2.1 `parse_*_nav` mirroring the printer → Tasks 3, 4. §2.2 return value not a field → Tasks 3, 4 step 5. §2.3 the type → Task 2. §2.4 the `def` link and the missing kind discriminant → Task 2 (link) and Task 7 (kind chosen at the LSP layer, `.rxt` arm answered rather than asserted). §3.1 TM roles → Task 3. §3.2 asm roles via `Shape::kinds()` → Task 4. §3.3 dangling references → Tasks 2, 4. §4 per-line recovery → Task 3 steps 1 and 9. §5.1 capabilities, arms, `include_declaration` → Tasks 5, 6, 7. §5.2 `Position` → offset → Task 1. §5.3 `SymbolKind` and flat symbols → Task 7. §5.4 no plugin change, verified not assumed → Task 8 step 4. §6 testing and sabotage → every task's sabotage step. §8's exclusions → Task 8 step 5's `WHAT STAYS OPEN`.

**Type consistency.** `NameIndex::at` returns `Option<(usize, &Occurrence)>` in Task 2 and is destructured as `(i, _)` or `(i, occ)` at every call site in Tasks 3–7. `definition_of` takes and returns `usize` indices throughout. `Language::nav` returns `Option<NameIndex>` in Task 5 and is used as such in Tasks 5 and 7. `trimmed_at` is defined in `tm/syntax.rs` in Task 3 and promoted to `pub(super)` in Task 4 step 4, which is where its second consumer arrives.

**Every piece of arithmetic in this plan was executed before it was written.** Task 4 step 3's first draft wrapped `parse_instr` and re-derived the mnemonic and the operand split from the text — a second copy of the operand grammar, and the duplication this design refuses everywhere else. The pre-flight scan caught it, and the fix was to invert the pair rather than to accept it: `parse_instr_at` does the parse and `parse_instr` wraps it, which is the shape `parse_tm_full`/`parse_tm_nav` already uses one layer up. The replacement was applied to the real file, its offsets asserted over nine spacings, `cargo nextest run -p redextape-core` run (988 passed, 10 skipped, no existing test edited) and `cargo clippy -p redextape-core --all-targets -- -D warnings` run clean, before being reverted and written down here.

Two tests still carry belt and braces on top of that: `every_label_taking_shape_is_covered_by_the_derivation` walks the real `MNEMONICS` table so a fourth label-taking mnemonic is covered the day it is added, and `the_label_operand_offset_survives_every_spacing_the_grammar_allows` uses tabs, multiple spaces and a bare comma, because a fixture in the printer's own layout would pass against arithmetic that is wrong for every hand-written file.
