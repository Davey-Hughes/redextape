# `redextape-lsp` crate — PR B implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `redextape-lsp` binary that serves diagnostics and formatting for all four text forms over the Language Server Protocol, wired into Neovim by the plugin file this repository already ships.

**Architecture:** A new workspace crate split so that `Server::handle` is a pure function from one client message and the server's state to the messages that go back — no stdio, no threads, no channels. `lsp-server` supplies the transport and appears in `main.rs` alone; `gen-lsp-types` supplies both the LSP payload types and the JSON-RPC envelope types (`gen_lsp_types::json_rpc`), so the pure half never names the transport crate and no second copy of a message shape is hand-written. Every language-specific answer is one call into `redextape-core`, which already computes all of it.

**Tech Stack:** Rust edition 2024, `lsp-server` 0.10.0, `gen-lsp-types` 0.11.0 (default features), `serde_json`, `redextape-core`.

**Design:** [`../specs/2026-09-04-redextape-lsp-design.md`](../specs/2026-09-04-redextape-lsp-design.md) §3–§6. PR A (comment retention) merged as `2ea57a4` (#77); this is PR B of that two-PR design.

---

## Global Constraints

- **Edition 2024**, `[lints] workspace = true`. The workspace denies `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented` in library code and runs `clippy::pedantic` as written. Test code is exempted in `clippy.toml`.
- **No library path may panic.** That includes string slicing: `&s[a..b]` panics on a non-char-boundary index and no clippy lint sees it. Use `s.get(a..b).unwrap_or("")` and clamp offsets to char boundaries.
- **`cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check` run on every commit** via `.pre-commit-config.yaml`. A commit that does not compile clean cannot be made. Never `--no-verify`.
- **Coverage floor is 90% workspace lines**, gated by `cargo llvm-cov nextest --workspace --fail-under-lines 90`. Measured 94.91% at `4135ef7`. A new crate must not pull the workspace under the floor.
- **`lsp-server` is named in `crates/redextape-lsp/src/main.rs` and in no other file of this crate.** `git grep -l lsp_server crates/redextape-lsp/src` must print exactly that one path. This is the property §3.1 and §9 are both about, and it is checkable.
- **Version pins are exact for the two new dependencies**: `lsp-server = "0.10.0"`, `gen-lsp-types = "0.11.0"`. Both were verified present on crates.io and their sources read while writing this plan.
- **`gen-lsp-types` takes DEFAULT features.** With neither `url` nor `fluent-uri` on, `gen_lsp_types::Uri` is a newtype over `String` carrying `AsRef<str>` and `Display` and nothing else. This server keys documents by URI string and never parses one. Enabling either feature would buy a URL crate for nothing and change `Uri` out from under every signature here.
- **Doc comments are `///`** (Rust convention, per this repository's doc-comment rule).

---

## Verified fixtures — use these verbatim, do not invent one

**EVERY FIXTURE BELOW WAS RUN THROUGH THE REAL PARSER AND ITS OUTPUT PINNED**, by an out-of-tree probe (`crates/redextape-core/examples/plan_fixture_probe.rs`, deleted after use) before any task was dispatched. The first draft of this plan invented all of them and **every single one was wrong** — `_ -> _ R halt` is not TM rule syntax, `result Int` is not a value type, and `li r0, 1` needs a `#`. That last one is the third time an asm fixture in a plan for this repository has been missing its `#`.

**Do not edit these strings.** If a task seems to need a different one, run it through the parser first and pin the new assertion to what comes back — never adjust an assertion until it goes green.

```rust
/// Clean. 7 newlines, 116 bytes, so the document ends at line 7, character 0.
const TM_COMMENTS: &str = "\
; a machine
tapes 1
start q0

state q0:
  [a] -> write [b], move [R], goto q1 ; and a trailing one
state q1: accept
";

/// Exactly ONE diagnostic, "duplicate `tapes` line", on line 1 (0-indexed).
const TM_DUP: &str = "tapes 1\ntapes 2\nstart q0\nstate q0: accept\n";

/// Clean.
const TM_CLEAN: &str = "tapes 1\nstart q0\nstate q0: accept\n";

/// Clean. Note the TAB after `li` — that is what the printer emits and what the
/// existing `asm_comments.rs` fixture uses.
const ASM_COMMENTS: &str = "\
; a program
result Nat
f: ; the entry
    li\tr0, #1 ; and a trailing one
    ret
";
```

| source | form | diagnostics | parses | formats |
|---|---|---|---|---|
| `TM_COMMENTS` | `.tm` | 0 | yes | yes, both comments retained |
| `TM_DUP` | `.tm` | 1, line 1, "duplicate \`tapes\` line" | no | no |
| `TM_CLEAN` | `.tm` | 0 | yes | yes |
| `"tapes\n"` | `.tm` | 2 | no | no |
| `ASM_COMMENTS` | `.asm` | 0 | yes | yes, both comments retained |
| `"li\n"` | `.asm` | 1, "\`li\` takes 2 operand(s), found 0" | no | no |
| `"let   x=1;\nx+1"` | `.rxt` | 0 | yes | yes |
| `"1 + true"` | `.rxt` | 1, "expected \`Nat\`, found \`Bool\`" | yes | **yes** |
| `"let x = "` | `.rxt` | 1, "expected an expression" | no | no |
| `"λx.  x"` | `.rxlambda` | 0 | yes | yes |
| `"λx."` | `.rxlambda` | 1 | no | no |

**THE `.rxt` ROW THAT MATTERS IS `1 + true`, AND IT IS WHY THIS TABLE EXISTS.** `redextape_core::format` calls `parser::parse_full` and nothing else, so a file with a *type* error formats perfectly well — only a *parse* error stops it. This plan's first draft used `let x: Int = true` as its "does not format" fixture, which formats. A test asserting `None` there would have failed, and the tempting fix — deleting the assertion — would have removed the only check that `.rxt` formatting refuses a file it cannot print. Use `"let x = "` for that case; it is the repository's own `fmt_error` fixture, near enough.

---

## Spec deltas found while writing this plan

Recorded here rather than silently absorbed, because each is a place the spec and the tree disagree and a reader of the spec alone would be misled.

1. **§3.1's `Server::handle(&mut self, Request) -> Response` cannot express what slice 1 serves.** `textDocument/publishDiagnostics` is a server-to-client *notification* with no request behind it, and the things that produce it — `didOpen`, `didChange` — are notifications too. Neither the input nor the output of that signature has a place for one. The correction is `handle(&mut self, RequestObject) -> Vec<Outgoing>` where `Outgoing` is a response or a notification. It is still one pure function of the client's message and the server's state, which is the property §3.1 wanted; it is merely able to say what the server actually says.

2. **§3.4's dependency claim holds, and the reason is worth writing down.** `gen-lsp-types`' non-optional dependencies really are `serde` and `serde_json`. What makes that true is the featureless `Uri` newtype above — a fact that lives one `#[cfg]` deep in `src/generated/common.rs` and would quietly stop being true if anyone enabled `url`.

3. **§6's test list is partly stale against what PR A landed.** Three of its names exist in the tree as written: `a_file_with_an_error_recovers_no_comments` (`tests/asm_comments.rs`), `an_authored_comment_takes_the_tape_line_over_the_generated_name` and `printing_twice_after_a_reparse_is_idempotent` (`tests/tm_comments.rs`). Two do not: `round_trip_over_documents` is the name the spec gave the property that landed as the idempotence test just listed, and `printer_output_is_unchanged` is the spec's name for the pre-existing listing golden, which is `the_fixture_is_what_the_compiler_emits_today` in `tests/tm_header.rs`. **All five are PR A's and none is rewritten here.** PR B's obligation to them is negative: not to move them.

4. **`crates/redextape-core/src/tm.rs` re-exports every public entry point of `syntax` and `asm_syntax` except the four PR A added.** `parse_tm_full`, `print_tm_with`, `parse_asm_full` and their siblings are all in that block; `TmDocument`, `AsmDocument`, `print_tm_doc` and `print_asm_doc` are not. PR A had no consumer outside the crate, so nothing showed it. PR B is that consumer. Task 4 closes it rather than reaching through `tm::syntax::` and `tm::asm::` for four names whose siblings are one path shorter.

---

## File Structure

```
crates/redextape-lsp/
  Cargo.toml          the two new dependencies and why each
  src/lib.rs          Server, Outgoing, handle() — the pure half, covered
  src/position.rs     Encoding negotiation, LineIndex, Span -> Range
  src/language.rs     Language, and the four-arm dispatch into redextape-core
  src/document.rs     Document, Documents — open files at one version each
  src/main.rs         stdio, the initialize handshake, RequestObject <-> lsp_server::Message
  tests/protocol.rs   the one test that spawns the real binary
```

Modified: `Cargo.toml` (workspace members), `crates/redextape-core/src/tm.rs` (four re-exports), `plugin/redextape.lua` (the LSP registration), `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the entry).

`position.rs`, `language.rs` and `document.rs` each carry their own `#[cfg(test)] mod tests`, matching `redextape-core`'s `smoke_tests` shape. Server-level behaviour is tested from `src/lib.rs`'s own test module, because `Server::handle` is the unit and calling it needs no harness. Only `tests/protocol.rs` is an integration test, and it is the only file permitted to know that stdio exists.

---

## Task 1: The crate, and the language dispatch

**Files:**
- Create: `crates/redextape-lsp/Cargo.toml`
- Create: `crates/redextape-lsp/src/lib.rs`
- Create: `crates/redextape-lsp/src/language.rs`
- Modify: `Cargo.toml:3-11` (workspace `members`)

**Interfaces:**
- Consumes: `redextape_core::{analyze, format, Diagnostic}`, `redextape_core::lambda::{parse_lambda, print_lambda}`, `redextape_core::tm::{parse_tm_full, parse_asm_full}`.
- Produces: `redextape_lsp::language::Language` with `from_language_id(&str) -> Option<Language>` and `diagnostics(self, &str) -> Vec<Diagnostic>`. `format` arrives in Task 4, after the re-exports it needs exist.

- [ ] **Step 1: Add the crate to the workspace**

In the root `Cargo.toml`, insert into `members` in alphabetical position (between `redextape-grammar-check` and `redextape-native`):

```toml
    "crates/redextape-lsp",
```

- [ ] **Step 2: Write the manifest**

`crates/redextape-lsp/Cargo.toml`:

```toml
[package]
name = "redextape-lsp"
version = "0.0.0"
edition.workspace = true
license.workspace = true
repository.workspace = true
publish = false

[lints]
workspace = true

[dependencies]
redextape-core = { path = "../redextape-core" }
# The transport, and nothing else. Its whole dependency list is crossbeam-channel, log, serde,
# serde_derive and serde_json, and it deliberately ships no LSP types crate: it hands over a method
# string and a `serde_json::Value` and lets the caller choose the type layer. That is what lets it
# live in `main.rs` alone — see this crate's `lib.rs` module doc for why that boundary is
# load-bearing rather than tidy.
lsp-server = "0.10.0"
# The message types AND the JSON-RPC envelope types, both generated from Microsoft's official LSP
# MetaModel. `gen_lsp_types::json_rpc` is why the pure half of this crate can speak the protocol
# without naming `lsp-server`: without it, the alternative was a hand-written second copy of
# Request/Response/Notification, which is the drift that made rust-analyzer leave `lsp-types` and
# is the reason this crate is here rather than that one.
#
# DEFAULT FEATURES, DELIBERATELY. With neither `url` nor `fluent-uri` enabled, `Uri` is a newtype
# over `String` with `AsRef<str>` and `Display`. This server keys documents by URI string and never
# parses one, so either feature would buy a URL crate for nothing — and would change `Uri` out from
# under every signature in this crate.
gen-lsp-types = "0.11.0"
serde_json = "1"
```

- [ ] **Step 3: Write the failing test**

`crates/redextape-lsp/src/language.rs`, at the bottom:

```rust
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
}
```

> The `assert!(!…is_empty())` beside each equality is not padding. Equality alone passes when both
> sides are empty, which is what a dispatch arm wired to the wrong front end would very often
> produce — and this repository has already been caught by an assertion blind to exactly the case
> that would falsify it. Each source above must actually error; if one does not, replace it with one
> that does rather than dropping the assertion.

- [ ] **Step 4: Run the test to verify it fails**

```
cargo test -p redextape-lsp
```

Expected: FAIL — `crates/redextape-lsp/src/language.rs` does not exist, so the crate does not compile.

- [ ] **Step 5: Write `src/language.rs` above the test module**

```rust
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

use redextape_core::Diagnostic;

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
}
```

- [ ] **Step 6: Write `src/lib.rs` declaring the module**

```rust
//! `redextape-lsp` — the pure half.
//!
//! **THE SPLIT BETWEEN THIS FILE AND `main.rs` IS NOT STYLISTIC, AND IT BUYS TWO THINGS.**
//!
//! It is what makes the workspace's 90% line-coverage merge gate reachable with a new crate in the
//! tree: `Server::handle` is a function from one client message and the server's state to the
//! messages that go back, so a test constructs a message and asserts on what comes out — no
//! process spawn, no stdio, no threads, no sleeping, no timing.
//!
//! And it is what keeps the web phase possible at no cost to this slice. `web/` is not a consumer
//! and this slice does not make it one; what it does is not foreclose it. `Server::handle` is pure
//! over `gen-lsp-types` structs, which are plain serde types, so a wasm caller could drive the
//! identical code. `lsp-server`'s threads and channels — the part that cannot compile to wasm —
//! live in `main.rs` and nowhere else. That the JSON-RPC envelope types come from
//! `gen_lsp_types::json_rpc` rather than from `lsp-server` is what makes "nowhere else" achievable
//! without hand-writing a second copy of a shape defined elsewhere.

pub mod language;
```

- [ ] **Step 7: Run the tests to verify they pass**

```
cargo test -p redextape-lsp
```

Expected: PASS, 2 tests.

- [ ] **Step 8: Run the gate legs this touches**

```
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: both clean. `clippy::pedantic` is on as written; resolve any warning on its merits rather than adding an `allow`.

- [ ] **Step 9: Commit**

```bash
git add Cargo.toml Cargo.lock crates/redextape-lsp
git commit -m "The redextape-lsp crate, and the four-arm dispatch off the filetype the plugin already owns"
```

---

## Task 2: Position encoding

**Files:**
- Create: `crates/redextape-lsp/src/position.rs`
- Modify: `crates/redextape-lsp/src/lib.rs` (add `pub mod position;`)

**Interfaces:**
- Consumes: `redextape_core::Span` (`{ start: usize, end: usize }`, half-open byte range), `gen_lsp_types::{Position, PositionEncodingKind, Range}`.
- Produces: `position::Encoding` (`Utf8` | `Utf16`) with `negotiate(Option<&[PositionEncodingKind]>) -> Encoding` and `kind(self) -> PositionEncodingKind`; `position::LineIndex` with `new(&str) -> LineIndex`, `position(&self, text: &str, offset: usize, enc: Encoding) -> Position`, `range(&self, text: &str, span: Span, enc: Encoding) -> Range`, `end_position(&self, text: &str, enc: Encoding) -> Position`.

- [ ] **Step 1: Write the failing tests**

`crates/redextape-lsp/src/position.rs`, at the bottom:

```rust
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
        assert_eq!(
            idx.range(text, span, Encoding::Utf16),
            Range::new(Position::new(0, 0), Position::new(0, 2))
        );
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cargo test -p redextape-lsp position
```

Expected: FAIL — `LineIndex`, `Encoding` not defined.

> **Add `pub mod position;` to `lib.rs` before running this, not at Step 4 where it is listed.** An
> undeclared module is never compiled, so without it this command reports "0 tests run" — a green
> result that looks like the failing test does not exist rather than like the type is missing. Step
> 4 then becomes a check that the line is there. The same correction applies to Task 3.

- [ ] **Step 3: Write `src/position.rs` above the test module**

```rust
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
```

- [ ] **Step 4: Declare the module**

In `crates/redextape-lsp/src/lib.rs`, after `pub mod language;`:

```rust
pub mod position;
```

- [ ] **Step 5: Run the tests to verify they pass**

```
cargo test -p redextape-lsp
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Run the sabotage, and confirm it reddens**

Change `Encoding::Utf16 => prefix.chars().map(char::len_utf16).sum()` to `Encoding::Utf16 => prefix.len()` — an encoder that ignores the encoding.

```
cargo test -p redextape-lsp positions_differ_by_encoding
```

Expected: FAIL. **If it passes, the test is not testing the encoder** — stop and fix the test before restoring the line. Then restore it and confirm the suite is green again.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-lsp
git commit -m "Positions are negotiated, not fixed, and the λ that is three different numbers is what shows it"
```

---

## Task 3: Open documents

**Files:**
- Create: `crates/redextape-lsp/src/document.rs`
- Modify: `crates/redextape-lsp/src/lib.rs` (add `pub mod document;`)

**Interfaces:**
- Consumes: `crate::language::Language`, `crate::position::{Encoding, LineIndex}`.
- Produces: `document::Document { language: Option<Language>, version: i32, text: String, index: LineIndex }` with `new(language_id: &str, version: i32, text: String) -> Document` and `replace(&mut self, version: i32, text: String)`; `document::Documents` (`Default`) with `open`, `get`, `replace`, `close`.

- [ ] **Step 1: Write the failing tests**

`crates/redextape-lsp/src/document.rs`, at the bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::position::Encoding;

    #[test]
    fn a_document_is_opened_replaced_and_closed_under_its_uri() {
        let mut docs = Documents::default();
        assert!(docs.get("file:///a.tm").is_none());

        docs.open("file:///a.tm".to_string(), "redextape_tm", 1, "tapes 1\n".to_string());
        let d = docs.get("file:///a.tm").expect("just opened");
        assert_eq!(d.language, Some(Language::Tm));
        assert_eq!(d.version, 1);
        assert_eq!(d.text, "tapes 1\n");

        docs.replace("file:///a.tm", 2, "tapes 2\n\n".to_string());
        let d = docs.get("file:///a.tm").expect("still open");
        assert_eq!(d.version, 2);
        assert_eq!(d.text, "tapes 2\n\n");
        // The index moved with the text: the new file has three line starts, the old had two.
        assert_eq!(d.index.end_position(&d.text, Encoding::Utf8), gen_lsp_types::Position::new(2, 0));

        docs.close("file:///a.tm");
        assert!(docs.get("file:///a.tm").is_none());
    }

    #[test]
    fn replacing_a_document_that_was_never_opened_does_nothing() {
        // A `didChange` for a URI with no `didOpen` is a client bug, not a reason to invent a
        // document with no `languageId` and start answering questions about it.
        let mut docs = Documents::default();
        docs.replace("file:///ghost.tm", 1, "tapes 1\n".to_string());
        assert!(docs.get("file:///ghost.tm").is_none());
    }

    #[test]
    fn an_unknown_language_id_is_tracked_with_no_language() {
        let mut docs = Documents::default();
        docs.open("file:///a.rs".to_string(), "rust", 1, "fn main() {}\n".to_string());
        let d = docs.get("file:///a.rs").expect("tracked anyway");
        assert_eq!(d.language, None);
        assert_eq!(d.text, "fn main() {}\n");
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cargo test -p redextape-lsp document
```

Expected: FAIL — `Documents` not defined.

> **Add `pub mod document;` to `lib.rs` before running this, not at Step 4 where it is listed** —
> see the note at Task 2 Step 2. Found during execution: taken literally, this step reports "0 tests
> run" rather than the stated compile failure, which is the failure mode a TDD step exists to rule
> out.

- [ ] **Step 3: Write `src/document.rs` above the test module**

```rust
//! The open documents, one `LineIndex` per version.
//!
//! `textDocumentSync` is `FULL` in slice 1, so "update" means "replace": these files are small, and
//! incremental sync is an optimization that buys a class of bugs before it buys anything else.
//! `replace` rebuilding the whole index is the honest cost of that choice and the reason it is one
//! line.

use std::collections::HashMap;

use crate::language::Language;
use crate::position::LineIndex;

/// One open document, at one version.
pub struct Document {
    /// `None` for a `languageId` this server does not serve. The document is still tracked — see
    /// `Language::from_language_id` for why answering is better than guessing.
    pub language: Option<Language>,
    pub version: i32,
    pub text: String,
    pub index: LineIndex,
}

impl Document {
    #[must_use]
    pub fn new(language_id: &str, version: i32, text: String) -> Self {
        let index = LineIndex::new(&text);
        Document { language: Language::from_language_id(language_id), version, text, index }
    }

    /// Replace the whole text. Under `FULL` sync this is the only update there is.
    pub fn replace(&mut self, version: i32, text: String) {
        self.index = LineIndex::new(&text);
        self.text = text;
        self.version = version;
    }
}

/// Every open document, keyed by URI string.
///
/// The key is the URI as the client spelled it, not a parsed URL. `gen-lsp-types` under default
/// features makes `Uri` a newtype over `String`, and nothing here needs a scheme, a host or a
/// path — only that the same buffer comes back under the same key.
#[derive(Default)]
pub struct Documents(HashMap<String, Document>);

impl Documents {
    pub fn open(&mut self, uri: String, language_id: &str, version: i32, text: String) {
        self.0.insert(uri, Document::new(language_id, version, text));
    }

    #[must_use]
    pub fn get(&self, uri: &str) -> Option<&Document> {
        self.0.get(uri)
    }

    /// Replace an open document's text. A URI that was never opened is left alone: a `didChange`
    /// with no `didOpen` behind it is a client bug, and inventing a document with no `languageId`
    /// would start answering questions about a file nobody described.
    pub fn replace(&mut self, uri: &str, version: i32, text: String) {
        if let Some(doc) = self.0.get_mut(uri) {
            doc.replace(version, text);
        }
    }

    pub fn close(&mut self, uri: &str) {
        self.0.remove(uri);
    }
}
```

- [ ] **Step 4: Declare the module**

In `crates/redextape-lsp/src/lib.rs`, after `pub mod language;`:

```rust
pub mod document;
```

(Module declarations stay alphabetical: `document`, `language`, `position`.)

- [ ] **Step 5: Run the tests to verify they pass**

```
cargo test -p redextape-lsp
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-lsp
git commit -m "Open documents, one line index per version, and a didChange with no didOpen behind it changes nothing"
```

---

## Task 4: Formatting, and the four re-exports PR A did not add

**Files:**
- Modify: `crates/redextape-core/src/tm.rs:27` and `:44` (re-export block)
- Modify: `crates/redextape-lsp/src/language.rs` (add `Language::format`)

**Interfaces:**
- Consumes: `redextape_core::format`, `redextape_core::lambda::{parse_lambda, print_lambda}`, and — after this task — `redextape_core::tm::{TmDocument, AsmDocument, print_tm_doc, print_asm_doc}`.
- Produces: `Language::format(self, src: &str) -> Option<String>`.

- [ ] **Step 1: Add the four re-exports**

In `crates/redextape-core/src/tm.rs`, line 27, replace:

```rust
pub use asm_syntax::{parse_asm, parse_asm_full};
```

with:

```rust
pub use asm::print_asm_doc;
pub use asm_syntax::{AsmDocument, parse_asm, parse_asm_full};
```

and at line 44 replace:

```rust
pub use syntax::{parse_tm, parse_tm_full, print_tm, print_tm_mapped, print_tm_with, print_tm_with_mapped};
```

with:

```rust
pub use syntax::{
    TmDocument, parse_tm, parse_tm_full, print_tm, print_tm_doc, print_tm_mapped, print_tm_with,
    print_tm_with_mapped,
};
```

**CORRECTED DURING EXECUTION — `rustfmt` was never going to do this.** This step originally read
"Keep `pub use asm::print_asm_doc;` merged into the existing `pub use asm::{…}` block at line 22 if
`rustfmt` prefers it there — run `cargo fmt` and take what it produces." `rustfmt.toml` sets no
`imports_granularity`, and stable `rustfmt` never merges separate `use` items from one path without
it — there was no run of `cargo fmt` under which that instruction could ever fire. Merge
`print_asm_doc` into the existing `pub use asm::{…}` block by hand, the same way `TmDocument` above
is added to `syntax`'s block by hand rather than as a second `pub use syntax::print_tm_doc;` line.

> **Why this is in PR B and not left alone.** Every other public entry point of `syntax` and
> `asm_syntax` is in this block; these four are the only ones PR A added and the only ones missing.
> PR A had no consumer outside `redextape-core`, so nothing showed the gap. PR B is that consumer,
> and the alternative is reaching through `tm::syntax::` and `tm::asm::` for four names whose
> siblings are one path shorter — which is a reader being told these four are different when they
> are not.

- [ ] **Step 2: Write the failing test**

In `crates/redextape-lsp/src/language.rs`'s `mod tests`:

```rust
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

        let out = Language::Asm.format(ASM_COMMENTS).expect("the fixture parses");
        assert!(out.contains("; a program"), "own-line comment lost:\n{out}");
        assert!(out.contains("; and a trailing one"), "trailing comment lost:\n{out}");
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
```

> `TM_COMMENTS` and `ASM_COMMENTS` are the verified constants from the **Verified fixtures**
> section — declare them as `const`s in the test module and use them verbatim. Both were run
> through `parse_tm_full` and `parse_asm_full` and both report zero diagnostics. Do not retype them
> from memory: the tab after `li` and the `#` before `1` are both load-bearing.

- [ ] **Step 3: Run the tests to verify they fail**

```
cargo test -p redextape-lsp format
```

Expected: FAIL — `Language::format` not defined.

- [ ] **Step 4: Add `format` to `impl Language`**

```rust
    /// The formatted form of `src`, or `None` when it does not parse.
    ///
    /// **`None` IS NOT AN ERROR PATH, IT IS THE ANSWER.** The formatter is `print ∘ parse` for all
    /// four forms, so a file that does not parse has nothing to print from. Returning the input
    /// unchanged would be indistinguishable to the editor from a file already formatted, and
    /// returning a partial print would hand the editor a truncated buffer. The caller turns this
    /// into an empty edit list, which is what LSP says "no changes" is.
    ///
    /// For `.tm` and `.asm` the comments survive, which is what PR A landed and the reason
    /// formatting these two forms is offered at all.
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
```

- [ ] **Step 5: Run the tests to verify they pass**

```
cargo test -p redextape-lsp
```

Expected: PASS, 13 tests.

- [ ] **Step 6: Confirm PR A's tests did not move**

```
cargo nextest run -p redextape-core -E 'binary(tm_comments) + binary(asm_comments) + binary(tm_header)'
```

Expected: PASS. The re-export change is additive and nothing in `redextape-core` should have shifted; if `the_fixture_is_what_the_compiler_emits_today` reddens, the listing golden moved and that is a defect in this task, not a golden to update.

- [ ] **Step 7: Run the sabotage, and confirm it reddens**

In `redextape-core`'s TM printer, skip writing the first recovered comment.

```
cargo test -p redextape-lsp formatting_keeps_the_comments_in_the_two_forms_that_have_them
```

Expected: FAIL. Restore, and confirm green.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/src/tm.rs crates/redextape-lsp
git commit -m "Formatting for all four forms, and the four names PR A added to tm.rs without adding to its re-exports"
```

---

## Task 5: `initialize`, and the capabilities slice 1 advertises

**Files:**
- Modify: `crates/redextape-lsp/src/lib.rs`

**Interfaces:**
- Consumes: `gen_lsp_types::json_rpc::{Error, Id, RequestObject, ResponseObject}`, `gen_lsp_types::{ErrorCodes, InitializeParams, InitializeResult, ServerCapabilities, ServerInfo, TextDocumentSync, TextDocumentSyncKind, InitializeRequest, ShutdownRequest}`.

  **CORRECTED DURING EXECUTION — `ErrorCodes` is not in `json_rpc`.** This line originally put
  `ErrorCodes` in the `json_rpc::{…}` list beside `Error`. `gen_lsp_types::json_rpc::ErrorCodes` does
  not exist; the type is re-exported at the crate root, `gen_lsp_types::ErrorCodes`, alongside the
  payload types.
- Produces: `Outgoing` (`Response(ResponseObject)` | `Notification(RequestObject)`), `Server` with `new() -> Server` and `handle(&mut self, RequestObject) -> Vec<Outgoing>`; `Server::encoding(&self) -> Encoding` for tests.

> **`ResponseObject::from_success::<R>(id, result)` is generic over the request type and takes
> `R::Result`.** So `initialize` is `from_success::<InitializeRequest>(id, InitializeResult { … })`
> and `shutdown` is `from_success::<ShutdownRequest>(id, ())`. This is why the envelope types come
> from `gen-lsp-types`: the result type is checked against the method rather than being a bare
> `Value` that could be anything.

- [ ] **Step 1: Write the failing tests**

At the bottom of `crates/redextape-lsp/src/lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use gen_lsp_types::json_rpc::{Id, RequestObject};
    use gen_lsp_types::{InitializeParams, InitializeResult};
    use serde_json::json;

    use super::*;
    use crate::position::Encoding;

    /// Build a client request. Named rather than inlined because every test below needs one and
    /// `RequestObject`'s fields are private — `serde_json::from_value` is the constructor.
    fn request(id: i64, method: &str, params: serde_json::Value) -> RequestObject {
        serde_json::from_value(json!({
            "jsonrpc": "2.0", "id": id, "method": method, "params": params
        }))
        .expect("a well-formed request object")
    }

    fn notification(method: &str, params: serde_json::Value) -> RequestObject {
        serde_json::from_value(json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .expect("a well-formed notification object")
    }

    fn initialize_result(out: &[Outgoing]) -> InitializeResult {
        let [Outgoing::Response(r)] = out else { panic!("expected exactly one response, got {out:?}") };
        serde_json::from_value(r.result().expect("a success response").clone())
            .expect("an InitializeResult")
    }

    #[test]
    fn initialize_advertises_full_sync_and_formatting() {
        let mut server = Server::new();
        let out = server.handle(request(1, "initialize", json!(InitializeParams::default())));
        let caps = initialize_result(&out).capabilities;

        assert_eq!(
            caps.text_document_sync,
            Some(TextDocumentSync::Kind(TextDocumentSyncKind::Full))
        );
        assert_eq!(caps.document_formatting_provider, Some(DocumentFormattingProvider::Bool(true)));
        // Slice 1 advertises no semantic tokens: the four grammars already highlight all four forms
        // in the target editor, so the server would be a second, competing answer to a solved
        // question. Asserted so that adding one is a deliberate edit to this line.
        assert_eq!(caps.semantic_tokens_provider, None);
        assert_eq!(caps.hover_provider, None);
        assert_eq!(caps.definition_provider, None);
    }

    #[test]
    fn the_negotiated_encoding_is_echoed_in_the_capabilities() {
        // The client's offer and the server's answer are two halves of one handshake, and a server
        // that negotiates utf-8 internally while echoing utf-16 would place every diagnostic
        // wrongly in exactly the files where the two differ.
        let mut server = Server::new();
        let params = json!({ "capabilities": { "general": { "positionEncodings": ["utf-8", "utf-16"] } } });
        let out = server.handle(request(1, "initialize", params));
        assert_eq!(initialize_result(&out).capabilities.position_encoding, Some(PositionEncodingKind::UTF8));
        assert_eq!(server.encoding(), Encoding::Utf8);

        let mut server = Server::new();
        let params = json!({ "capabilities": { "general": { "positionEncodings": ["utf-16"] } } });
        let out = server.handle(request(1, "initialize", params));
        assert_eq!(initialize_result(&out).capabilities.position_encoding, Some(PositionEncodingKind::UTF16));
        assert_eq!(server.encoding(), Encoding::Utf16);

        let mut server = Server::new();
        let out = server.handle(request(1, "initialize", json!({ "capabilities": {} })));
        assert_eq!(initialize_result(&out).capabilities.position_encoding, Some(PositionEncodingKind::UTF16));
        assert_eq!(server.encoding(), Encoding::Utf16);
    }

    #[test]
    fn shutdown_is_answered_and_initialized_and_exit_are_silent() {
        let mut server = Server::new();
        let out = server.handle(request(2, "shutdown", json!(null)));
        let [Outgoing::Response(r)] = out.as_slice() else { panic!("expected one response") };
        assert!(r.is_ok());
        assert_eq!(r.id(), &Id::from(2i64));

        assert!(server.handle(notification("initialized", json!({}))).is_empty());
        assert!(server.handle(notification("exit", json!(null))).is_empty());
    }

    #[test]
    fn an_unhandled_request_gets_method_not_found_and_an_unhandled_notification_gets_silence() {
        // A request MUST be answered or the client waits forever; a notification MUST NOT be,
        // because there is no id to answer to. The two halves are why this is one test.
        let mut server = Server::new();
        let out = server.handle(request(3, "textDocument/hover", json!({})));
        let [Outgoing::Response(r)] = out.as_slice() else { panic!("expected one response") };
        assert_eq!(r.error().map(|e| e.code), Some(ErrorCodes::MethodNotFound));

        assert!(server.handle(notification("$/setTrace", json!({ "value": "off" }))).is_empty());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cargo test -p redextape-lsp
```

Expected: FAIL — `Server`, `Outgoing` not defined.

- [ ] **Step 3: Write the server, below the module doc in `src/lib.rs`**

```rust
pub mod document;
pub mod language;
pub mod position;

use gen_lsp_types::json_rpc::{Error, Id, RequestObject, ResponseObject};
use gen_lsp_types::{
    DocumentFormattingProvider, ErrorCodes, InitializeParams, InitializeRequest, InitializeResult,
    PositionEncodingKind, ServerCapabilities, ServerInfo, ShutdownRequest, TextDocumentSync,
    TextDocumentSyncKind,
};

use crate::document::Documents;
use crate::position::Encoding;

/// One message the server sends because of one message from the client.
///
/// **THE DESIGN SAID `handle(&mut self, Request) -> Response`, AND THAT SHAPE CANNOT CARRY
/// DIAGNOSTICS.** `textDocument/publishDiagnostics` is a server-to-client notification with no
/// request behind it, and the messages that produce it — `didOpen`, `didChange` — are notifications
/// too, so neither the input nor the output of that signature had a place for the traffic this
/// slice exists to serve. This enum is the correction. `handle` is still a pure function of the
/// client's message and the server's state, which is the property the split was for.
#[derive(Debug, PartialEq)]
pub enum Outgoing {
    /// An answer to a request, carrying the request's id.
    Response(ResponseObject),
    /// A server-to-client notification, carrying no id. `RequestObject` is the JSON-RPC envelope
    /// for both, distinguished by whether the id is present.
    Notification(RequestObject),
}

/// The language server, and all of its state.
pub struct Server {
    documents: Documents,
    /// Settled by `initialize`. `Utf16` until then, which is the protocol's default and the right
    /// answer for the window in which no negotiation has happened.
    encoding: Encoding,
}

impl Default for Server {
    fn default() -> Self {
        Self::new()
    }
}

impl Server {
    #[must_use]
    pub fn new() -> Self {
        Server { documents: Documents::default(), encoding: Encoding::Utf16 }
    }

    /// The encoding settled by `initialize`.
    #[must_use]
    pub fn encoding(&self) -> Encoding {
        self.encoding
    }

    /// Answer one message from the client.
    ///
    /// A request always produces exactly one response — a client that gets none waits forever. A
    /// notification produces zero or more notifications and never a response, because there is no
    /// id to answer to.
    pub fn handle(&mut self, msg: RequestObject) -> Vec<Outgoing> {
        let (method, id, params) = msg.into_parts();
        let params = params.unwrap_or(serde_json::Value::Null);
        match (method.as_str(), id) {
            ("initialize", Some(id)) => vec![self.initialize(id, params)],
            ("shutdown", Some(id)) => {
                vec![Outgoing::Response(ResponseObject::from_success::<ShutdownRequest>(id, ()))]
            }
            ("initialized" | "exit", None) => Vec::new(),
            (_, Some(id)) => vec![Outgoing::Response(ResponseObject::from_error(
                id,
                Error {
                    code: ErrorCodes::MethodNotFound,
                    message: format!("redextape-lsp does not serve {method}"),
                    data: None,
                },
            ))],
            (_, None) => Vec::new(),
        }
    }

    fn initialize(&mut self, id: Id, params: serde_json::Value) -> Outgoing {
        // A client whose `initialize` params do not deserialize still gets a server: every field
        // this slice reads is optional, so `default()` answers exactly as a client that sent none
        // would be answered. Failing the handshake over an unrecognised extension field would be a
        // worse trade than ignoring it.
        let params: InitializeParams = serde_json::from_value(params).unwrap_or_default();
        let offered = params
            .capabilities
            .general
            .as_ref()
            .and_then(|g| g.position_encodings.as_deref());
        self.encoding = Encoding::negotiate(offered);

        let capabilities = ServerCapabilities {
            position_encoding: Some(self.encoding.kind()),
            // FULL, deliberately: these files are small, and incremental sync is an optimization
            // that buys a class of bugs before it buys anything else.
            text_document_sync: Some(TextDocumentSync::Kind(TextDocumentSyncKind::Full)),
            document_formatting_provider: Some(DocumentFormattingProvider::Bool(true)),
            // Everything else stays `None`. Diagnostics are PUSHED, via `publishDiagnostics`, which
            // needs no capability entry: it is universally supported, where pull diagnostics are a
            // 3.17 addition this slice does not need.
            ..ServerCapabilities::default()
        };

        Outgoing::Response(ResponseObject::from_success::<InitializeRequest>(
            id,
            InitializeResult {
                capabilities,
                server_info: Some(ServerInfo {
                    name: "redextape-lsp".to_string(),
                    version: Some(env!("CARGO_PKG_VERSION").to_string()),
                }),
            },
        ))
    }
}
```

> If `InitializeParams::capabilities.general` is not an `Option` in this version, drop the
> `as_ref().and_then(…)` for a direct field read — check `ClientCapabilities` in
> `gen-lsp-types`' `src/generated/structures.rs` and match what is there rather than forcing this
> spelling. Likewise `ServerInfo`'s field names.

- [ ] **Step 4: Run the tests to verify they pass**

```
cargo test -p redextape-lsp
```

Expected: PASS, 17 tests.

- [ ] **Step 5: Run the sabotage, and confirm it reddens**

Change `position_encoding: Some(self.encoding.kind())` to `position_encoding: Some(PositionEncodingKind::UTF16)` — a server that negotiates one thing and announces another.

```
cargo test -p redextape-lsp the_negotiated_encoding_is_echoed_in_the_capabilities
```

Expected: FAIL. Restore, and confirm green.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-lsp
git commit -m "The handshake: full sync, formatting, and an encoding that is echoed rather than assumed"
```

---

## Task 6: `didOpen`, `didChange`, `didClose`, and the diagnostics they publish

**Files:**
- Modify: `crates/redextape-lsp/src/lib.rs`

**Interfaces:**
- Consumes: `gen_lsp_types::{DidOpenTextDocumentParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams, PublishDiagnosticsNotification, PublishDiagnosticsParams, Diagnostic as LspDiagnostic, DiagnosticSeverity, TextDocumentContentChangeEvent}`, `redextape_core::Severity`.
- Produces: three arms on `Server::handle`, and `Server::publish(&self, uri: &str) -> Outgoing`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib.rs`'s `mod tests`:

```rust
    fn published(out: &[Outgoing]) -> PublishDiagnosticsParams {
        let [Outgoing::Notification(n)] = out else {
            panic!("expected exactly one notification, got {out:?}")
        };
        assert_eq!(n.method(), "textDocument/publishDiagnostics");
        serde_json::from_value(n.params().expect("params").clone()).expect("PublishDiagnosticsParams")
    }

    fn did_open(server: &mut Server, uri: &str, language_id: &str, text: &str) -> Vec<Outgoing> {
        server.handle(notification(
            "textDocument/didOpen",
            json!({ "textDocument": { "uri": uri, "languageId": language_id, "version": 1, "text": text } }),
        ))
    }

    #[test]
    fn opening_a_file_publishes_its_diagnostics_at_the_right_span() {
        let mut server = Server::new();
        server.handle(request(1, "initialize", json!({ "capabilities": { "general": { "positionEncodings": ["utf-8"] } } })));

        // A `.tm` whose second line is the error, so a handler that reported everything at 0:0
        // would be visibly wrong rather than accidentally right.
        let out = did_open(&mut server, "file:///a.tm", "redextape_tm", TM_DUP);
        let p = published(&out);

        assert_eq!(p.uri.to_string(), "file:///a.tm");
        assert_eq!(p.version, Some(1));
        assert_eq!(p.diagnostics.len(), 1, "expected the duplicate-tapes error: {:?}", p.diagnostics);
        assert_eq!(p.diagnostics[0].range.start.line, 1, "the SECOND line is the duplicate");
        assert_eq!(p.diagnostics[0].severity, Some(DiagnosticSeverity::Error));
    }

    #[test]
    fn a_clean_file_publishes_an_empty_list_rather_than_nothing() {
        // AN EMPTY PUBLISH IS THE MESSAGE THAT CLEARS THE PREVIOUS ONE. A server that stays silent
        // when a file becomes clean leaves the editor showing errors the user has already fixed —
        // which is worse than never having shown them.
        let mut server = Server::new();
        server.handle(request(1, "initialize", json!(InitializeParams::default())));

        assert_eq!(published(&did_open(&mut server, "file:///a.tm", "redextape_tm", TM_DUP)).diagnostics.len(), 1);

        let out = server.handle(notification(
            "textDocument/didChange",
            json!({
                "textDocument": { "uri": "file:///a.tm", "version": 2 },
                "contentChanges": [{ "text": TM_CLEAN }]
            }),
        ));
        let p = published(&out);
        assert_eq!(p.diagnostics, vec![], "a fixed file must publish an EMPTY list, not stay silent");
        assert_eq!(p.version, Some(2));
    }

    #[test]
    fn closing_a_file_clears_its_diagnostics_and_forgets_it() {
        let mut server = Server::new();
        server.handle(request(1, "initialize", json!(InitializeParams::default())));
        did_open(&mut server, "file:///a.tm", "redextape_tm", TM_DUP);

        let out = server.handle(notification(
            "textDocument/didClose",
            json!({ "textDocument": { "uri": "file:///a.tm" } }),
        ));
        assert_eq!(published(&out).diagnostics, vec![]);

        // And a formatting request for it is now answered as an unknown document, not from a
        // stale copy.
        let out = server.handle(request(9, "textDocument/formatting", json!({
            "textDocument": { "uri": "file:///a.tm" },
            "options": { "tabSize": 2, "insertSpaces": true }
        })));
        let [Outgoing::Response(r)] = out.as_slice() else { panic!("expected one response") };
        assert_eq!(r.result(), Some(&serde_json::Value::Null));
    }

    #[test]
    fn unknown_language_id_is_answered() {
        // §3.2's fallback, asserted rather than assumed. The document is tracked — it must not
        // vanish — and every language-specific answer is empty.
        let mut server = Server::new();
        server.handle(request(1, "initialize", json!(InitializeParams::default())));

        let out = did_open(&mut server, "file:///a.rs", "rust", "fn main() { let x: i32 = \"\"; }\n");
        assert_eq!(published(&out).diagnostics, vec![], "a Rust buffer must not get redextape errors");

        let out = server.handle(request(9, "textDocument/formatting", json!({
            "textDocument": { "uri": "file:///a.rs" },
            "options": { "tabSize": 4, "insertSpaces": true }
        })));
        let [Outgoing::Response(r)] = out.as_slice() else { panic!("expected one response") };
        assert_eq!(r.result(), Some(&serde_json::Value::Null));
    }

    #[test]
    fn all_four_forms_publish_the_diagnostics_their_front_ends_report() {
        let mut server = Server::new();
        server.handle(request(1, "initialize", json!(InitializeParams::default())));
        for (uri, id, src) in [
            ("file:///a.rxt", "redextape", "1 + true"),
            ("file:///a.rxlambda", "redextape_lambda", "λx."),
            ("file:///a.tm", "redextape_tm", "tapes\n"),
            ("file:///a.asm", "redextape_asm", "li\n"),
        ] {
            let out = did_open(&mut server, uri, id, src);
            let p = published(&out);
            let expected = Language::from_language_id(id).expect("one of the four").diagnostics(src).len();
            assert_eq!(p.diagnostics.len(), expected, "{id} published the wrong count");
            assert!(expected > 0, "{id}'s fixture must actually error or this proves nothing");
        }
    }
```

> `TM_DUP` and `TM_CLEAN` are the verified constants from the **Verified fixtures** section.
> `TM_DUP` reports exactly one error — "duplicate \`tapes\` line", the one `978a8ff` added — on line
> 1, which is why the `range.start.line == 1` assertion discriminates. The four sources in
> `all_four_forms_…` each report at least one diagnostic; the `assert!(expected > 0)` inside the
> loop is what stops that test passing vacuously if one ever stops erroring.

- [ ] **Step 2: Run the tests to verify they fail**

```
cargo test -p redextape-lsp
```

Expected: FAIL — the `didOpen` arm does not exist, so `published` panics on an empty `out`.

- [ ] **Step 3: Add the diagnostic conversion and the three arms**

In `src/lib.rs`, extend the `match` in `handle`:

```rust
            ("textDocument/didOpen", None) => self.did_open(params),
            ("textDocument/didChange", None) => self.did_change(params),
            ("textDocument/didClose", None) => self.did_close(params),
```

and add to `impl Server`:

```rust
    fn did_open(&mut self, params: serde_json::Value) -> Vec<Outgoing> {
        let Ok(params) = serde_json::from_value::<DidOpenTextDocumentParams>(params) else {
            return Vec::new();
        };
        let item = params.text_document;
        let uri = item.uri.to_string();
        self.documents.open(uri.clone(), &item.language_id.to_string(), item.version, item.text);
        vec![self.publish(&uri)]
    }

    fn did_change(&mut self, params: serde_json::Value) -> Vec<Outgoing> {
        let Ok(params) = serde_json::from_value::<DidChangeTextDocumentParams>(params) else {
            return Vec::new();
        };
        // CORRECTED DURING EXECUTION — `DidChangeTextDocumentParams::text_document` is a
        // `VersionedTextDocumentIdentifier`, which flattens `TextDocumentIdentifier` under
        // `text_document_identifier` rather than exposing `.uri` directly; `.version` sits beside
        // it as its own field, unflattened. `DocumentFormattingParams` and
        // `DidCloseTextDocumentParams` both carry a plain `TextDocumentIdentifier` and so DO have
        // `.text_document.uri` directly — this type alone is the versioned one.
        let uri = params.text_document.text_document_identifier.uri.to_string();
        // `FULL` sync, so the LAST whole-document change is the document. A partial change is not
        // something a client should send us — we advertised `Full` — and taking its text as the
        // whole file would corrupt the buffer, so it is skipped rather than misread.
        let Some(text) = params.content_changes.into_iter().rev().find_map(|c| match c {
            TextDocumentContentChangeEvent::TextDocumentContentChangeWholeDocument(w) => Some(w.text),
            TextDocumentContentChangeEvent::TextDocumentContentChangePartial(_) => None,
        }) else {
            return Vec::new();
        };
        self.documents.replace(&uri, params.text_document.version, text);
        vec![self.publish(&uri)]
    }

    fn did_close(&mut self, params: serde_json::Value) -> Vec<Outgoing> {
        let Ok(params) = serde_json::from_value::<DidCloseTextDocumentParams>(params) else {
            return Vec::new();
        };
        let uri = params.text_document.uri.to_string();
        self.documents.close(&uri);
        // AN EMPTY PUBLISH ON CLOSE IS NOT A FORMALITY. Without it the editor keeps showing the
        // diagnostics of a file that is no longer open, and nothing will ever clear them.
        //
        // CORRECTED DURING EXECUTION — this must call `self.publish(&uri)`, not hand-build the
        // notification the way the block below this comment used to. A hand-built
        // `PublishDiagnosticsParams { diagnostics: Vec::new(), .. }` emits an empty list
        // unconditionally, regardless of whether `close` actually removed the document, so
        // `closing_a_file_clears_its_diagnostics_and_forgets_it` (Task 6) would still pass with
        // `self.documents.close(&uri)` deleted from the line above. Routing through `publish`
        // DERIVES the empty list from the document map instead of asserting it: an untracked URI
        // already publishes empty with no version, which is what a closed document needs, but if
        // `close` failed to remove it `publish` would find it still present and re-report its real
        // diagnostics — making a broken `close` visible here instead of producing the same
        // right-looking output either way.
        vec![self.publish(&uri)]
    }

    /// The `publishDiagnostics` notification for one document.
    ///
    /// Always a notification, never nothing: an EMPTY list is the message that clears the previous
    /// one, so a server that goes silent when a file becomes clean leaves the editor showing errors
    /// the user has already fixed. An untracked URI and a document in a language this server does
    /// not serve both produce an empty list, for the same reason.
    fn publish(&self, uri: &str) -> Outgoing {
        let diagnostics = self
            .documents
            .get(uri)
            .map(|doc| {
                doc.language.map_or_else(Vec::new, |lang| {
                    lang.diagnostics(&doc.text)
                        .into_iter()
                        .map(|d| to_lsp_diagnostic(&d, doc, self.encoding))
                        .collect()
                })
            })
            .unwrap_or_default();
        let version = self.documents.get(uri).map(|d| d.version);
        Outgoing::Notification(RequestObject::from_notification::<PublishDiagnosticsNotification>(
            PublishDiagnosticsParams { uri: uri.into(), version, diagnostics },
        ))
    }
```

and, at module level:

```rust
/// A `redextape-core` diagnostic as the protocol's.
///
/// `source` names this server so a buffer with several language servers attached shows which one
/// said what. There is no `code`: these diagnostics do not carry one, and inventing a stable
/// identifier here would be a second naming scheme with nothing behind it.
fn to_lsp_diagnostic(
    d: &redextape_core::Diagnostic,
    doc: &crate::document::Document,
    enc: Encoding,
) -> gen_lsp_types::Diagnostic {
    gen_lsp_types::Diagnostic {
        range: doc.index.range(&doc.text, d.span, enc),
        severity: Some(match d.severity {
            redextape_core::Severity::Error => DiagnosticSeverity::Error,
            redextape_core::Severity::Warning => DiagnosticSeverity::Warning,
        }),
        message: d.message.clone().into(),
        source: Some("redextape".to_string()),
        ..gen_lsp_types::Diagnostic::default()
    }
}
```

> **CORRECTED DURING EXECUTION — `gen_lsp_types::Diagnostic.message` is a `Message` enum, not a
> `String`.** The field originally read `message: d.message.clone(),`, which does not compile:
> `redextape_core::Diagnostic::message` is a plain `String`, and the two types need the `.into()`
> above to bridge them.
>
> `PublishDiagnosticsParams.uri` is a `gen_lsp_types::Uri`. Under default features that is a
> newtype over `String` with a `From<&str>`; if the `impl` in `src/generated/common.rs` is spelled
> differently, use what is there rather than adding a feature to change the type.

- [ ] **Step 4: Run the tests to verify they pass**

```
cargo test -p redextape-lsp
```

Expected: PASS, 22 tests.

- [ ] **Step 5: Run the sabotage, and confirm it reddens**

Make `publish` return `Vec::new()` diagnostics when the list would be empty — that is, go silent instead of publishing an empty list.

```
cargo test -p redextape-lsp a_clean_file_publishes_an_empty_list_rather_than_nothing
```

Expected: FAIL. Restore, and confirm green.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-lsp
git commit -m "Diagnostics for four forms, and the empty publish that clears the ones the user already fixed"
```

---

## Task 7: `textDocument/formatting`

**Files:**
- Modify: `crates/redextape-lsp/src/lib.rs`

**Interfaces:**
- Consumes: `gen_lsp_types::{DocumentFormattingParams, DocumentFormattingRequest, TextEdit, Position, Range}`, `Language::format`.
- Produces: the `textDocument/formatting` arm on `Server::handle`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib.rs`'s `mod tests`:

```rust
    fn format_edits(server: &mut Server, uri: &str) -> Option<Vec<TextEdit>> {
        let out = server.handle(request(9, "textDocument/formatting", json!({
            "textDocument": { "uri": uri },
            "options": { "tabSize": 2, "insertSpaces": true }
        })));
        let [Outgoing::Response(r)] = out.as_slice() else { panic!("expected one response, got {out:?}") };
        serde_json::from_value(r.result().expect("a success response").clone()).expect("Option<Vec<TextEdit>>")
    }

    #[test]
    fn formatting_replaces_the_whole_document_and_keeps_every_comment() {
        let mut server = Server::new();
        server.handle(request(1, "initialize", json!({ "capabilities": { "general": { "positionEncodings": ["utf-8"] } } })));

        did_open(&mut server, "file:///a.tm", "redextape_tm", TM_COMMENTS);

        let edits = format_edits(&mut server, "file:///a.tm").expect("a formattable file");
        assert_eq!(edits.len(), 1, "FULL sync, so formatting is one whole-document edit");

        // The range covers the whole buffer: from the very start to the very end. Getting this
        // wrong appends the formatted file to the unformatted one rather than replacing it.
        assert_eq!(edits[0].range.start, Position::new(0, 0));
        assert_eq!(edits[0].range.end, Position::new(7, 0), "TM_COMMENTS has 7 newlines and ends with one");

        assert!(edits[0].new_text.contains("; a machine"), "own-line comment lost:\n{}", edits[0].new_text);
        assert!(edits[0].new_text.contains("; and a trailing one"), "trailing comment lost:\n{}", edits[0].new_text);

        // CORRECTED DURING EXECUTION — without this, the test above passes against a handler that
        // returns raw `doc.text` unchanged: `TM_COMMENTS` already contains both comment substrings
        // verbatim, so the three assertions above discriminate nothing. Only the real printer can
        // satisfy this one — it normalises the single space before a trailing comment to two — so a
        // genuine `format ∘ parse` round trip must differ from the input, byte for byte.
        assert_ne!(
            edits[0].new_text, TM_COMMENTS,
            "the edit must carry the PRINTER's output, not the buffer's own text — these assertions \
             would otherwise pass against a handler that returned doc.text unchanged"
        );
    }

    #[test]
    fn formatting_a_file_that_does_not_parse_answers_null_rather_than_a_partial_buffer() {
        let mut server = Server::new();
        server.handle(request(1, "initialize", json!(InitializeParams::default())));
        did_open(&mut server, "file:///a.tm", "redextape_tm", "tapes\n");
        assert_eq!(format_edits(&mut server, "file:///a.tm"), None);
    }

    #[test]
    fn formatting_an_untracked_uri_answers_null_rather_than_erroring() {
        let mut server = Server::new();
        server.handle(request(1, "initialize", json!(InitializeParams::default())));
        assert_eq!(format_edits(&mut server, "file:///never-opened.tm"), None);
    }
```

> `Position::new(7, 0)` is derived from the fixture: `TM_COMMENTS` holds seven `\n` characters and
> ends with one, so the document ends at the start of line 7. **If the fixture is edited, recompute
> rather than adjusting the number until it goes green** — an end position tuned to whatever the
> implementation produced tests nothing.

- [ ] **Step 2: Run the tests to verify they fail**

```
cargo test -p redextape-lsp formatting
```

Expected: FAIL — `textDocument/formatting` falls through to the `MethodNotFound` arm, so the response is an error and `r.result()` is `None`.

- [ ] **Step 3: Add the arm**

In `handle`'s `match`, before the catch-alls:

```rust
            ("textDocument/formatting", Some(id)) => vec![self.formatting(id, params)],
```

and in `impl Server`:

```rust
    /// Format a whole document.
    ///
    /// **THE ANSWER IS `null`, NOT AN ERROR, FOR EVERY CASE THIS SERVER CANNOT FORMAT** — an
    /// unknown URI, a language it does not serve, a file that does not parse. `null` is what LSP
    /// says "no edits" is, and an error would surface in the editor as a failed command for the
    /// ordinary case of formatting a file that currently has a syntax error in it.
    // CORRECTED DURING EXECUTION — this took `&mut self`. Formatting reads `self.documents` and
    // `self.encoding` and mutates neither; `&self` is both correct and the tighter signature the
    // handlers around it already use for a read-only answer.
    fn formatting(&self, id: Id, params: serde_json::Value) -> Outgoing {
        let edits = serde_json::from_value::<DocumentFormattingParams>(params)
            .ok()
            .and_then(|p| {
                let uri = p.text_document.uri.to_string();
                let doc = self.documents.get(&uri)?;
                let formatted = doc.language?.format(&doc.text)?;
                // ONE EDIT OVER THE WHOLE BUFFER. `textDocumentSync` is `FULL` and the formatter is
                // `print ∘ parse`, so there is no diff to express: the new text IS the file. A
                // range that stopped short would append the formatted file to the remains of the
                // old one.
                Some(vec![TextEdit {
                    range: Range::new(
                        Position::new(0, 0),
                        doc.index.end_position(&doc.text, self.encoding),
                    ),
                    new_text: formatted,
                }])
            });
        Outgoing::Response(ResponseObject::from_success::<DocumentFormattingRequest>(id, edits))
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```
cargo test -p redextape-lsp
```

Expected: PASS, 25 tests.

- [ ] **Step 5: Run the sabotage, and confirm it reddens**

Change the edit's range end to `Position::new(0, 0)` — an insert rather than a replace.

```
cargo test -p redextape-lsp formatting_replaces_the_whole_document_and_keeps_every_comment
```

Expected: FAIL. Restore, and confirm green.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-lsp
git commit -m "Formatting is one whole-document edit, and every case it cannot serve answers null rather than an error"
```

---

## Task 8: The binary, and the one test that spawns it

**Files:**
- Create: `crates/redextape-lsp/src/main.rs`
- Create: `crates/redextape-lsp/tests/protocol.rs`

**Interfaces:**
- Consumes: `lsp_server::{Connection, IoThreads, Message, Notification, Request, Response, RequestId}`, `redextape_lsp::{Outgoing, Server}`.
- Produces: the `redextape-lsp` binary.

> **THIS TASK IS WHY THE OTHER SEVEN ARE NOT ENOUGH.** A test that only calls `Server::handle`
> never executes a line of `main.rs`, and would pass with the JSON-RPC framing broken end to end.
> This repository has already paid that bill next door: every early check of the Neovim plugin
> supplied the `FileType` autocmd the plugin itself lacked, and three green verifications produced
> no colour at all. So one test runs the real binary over real pipes, and it is the only test
> permitted to know that stdio exists.

- [ ] **Step 1: Write the failing test**

`crates/redextape-lsp/tests/protocol.rs`:

```rust
//! The one test that spawns the binary.
//!
//! Everything else in this crate calls `Server::handle` directly, which is what holds the
//! workspace coverage gate — no process, no stdio, no timing. That is also exactly why this file
//! has to exist: a handler test cannot see the framing, the handshake or the write loop, and all
//! three are in `main.rs`. A server whose `Content-Length` header was wrong would pass every other
//! test in this crate and hang the editor.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

/// Write one LSP message: the `Content-Length` header, a blank line, then the JSON.
fn send(stdin: &mut ChildStdin, msg: &serde_json::Value) {
    let body = serde_json::to_string(msg).expect("serializable");
    write!(stdin, "Content-Length: {}\r\n\r\n{body}", body.len()).expect("write");
    stdin.flush().expect("flush");
}

/// Read one LSP message back, framing and all.
fn recv(out: &mut BufReader<ChildStdout>) -> serde_json::Value {
    let mut len = None;
    loop {
        let mut line = String::new();
        let n = out.read_line(&mut line).expect("read header");
        assert_ne!(n, 0, "the server closed its stdout mid-header");
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some(v) = line.strip_prefix("Content-Length: ") {
            len = Some(v.parse::<usize>().expect("a numeric Content-Length"));
        }
    }
    let len = len.expect("every message carries a Content-Length");
    let mut body = vec![0u8; len];
    out.read_exact(&mut body).expect("read body");
    serde_json::from_slice(&body).expect("a JSON body")
}

#[test]
fn server_binary_speaks_the_protocol() {
    let mut child: Child = Command::new(env!("CARGO_BIN_EXE_redextape-lsp"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("the binary is built by the test harness");

    let mut stdin = child.stdin.take().expect("piped");
    let mut stdout = BufReader::new(child.stdout.take().expect("piped"));

    send(&mut stdin, &serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "capabilities": { "general": { "positionEncodings": ["utf-8"] } } }
    }));
    let reply = recv(&mut stdout);
    assert_eq!(reply["id"], 1);
    assert_eq!(reply["result"]["capabilities"]["positionEncoding"], "utf-8");
    assert_eq!(reply["result"]["capabilities"]["documentFormattingProvider"], true);

    send(&mut stdin, &serde_json::json!({
        "jsonrpc": "2.0", "method": "initialized", "params": {}
    }));

    // The second line is the duplicate, so a diagnostic reported at 0:0 would be visibly wrong.
    send(&mut stdin, &serde_json::json!({
        "jsonrpc": "2.0", "method": "textDocument/didOpen",
        "params": { "textDocument": {
            "uri": "file:///a.tm", "languageId": "redextape_tm", "version": 1,
            // TM_DUP from the Verified fixtures section: one error, on line 1.
            "text": "tapes 1\ntapes 2\nstart q0\nstate q0: accept\n"
        }}
    }));
    let note = recv(&mut stdout);
    assert_eq!(note["method"], "textDocument/publishDiagnostics");
    assert_eq!(note["params"]["uri"], "file:///a.tm");
    let diags = note["params"]["diagnostics"].as_array().expect("an array");
    assert_eq!(diags.len(), 1, "expected the duplicate-tapes error: {diags:?}");
    assert_eq!(diags[0]["range"]["start"]["line"], 1);

    // CORRECTED DURING EXECUTION — without what follows, this test never sends an ordinary,
    // id-bearing request. `initialize` and `shutdown` both go through their own dedicated paths
    // (`initialize` bypasses `dispatch` entirely; `shutdown` is intercepted by
    // `connection.handle_shutdown` before `dispatch` runs), so a version of this test with only
    // those two ids never executed `dispatch`'s response arm or `to_message`'s
    // `Outgoing::Response` arm at all — the exact path an ordinary request/response answer takes.
    // A second, clean document with comments, so formatting it returns real edits rather than a
    // `null` that would round-trip even if the response path silently dropped the payload.
    send(&mut stdin, &serde_json::json!({
        "jsonrpc": "2.0", "method": "textDocument/didOpen",
        "params": { "textDocument": {
            "uri": "file:///b.tm", "languageId": "redextape_tm", "version": 1,
            "text": "; a machine\ntapes 1\nstart q0\n\nstate q0:\n  [a] -> write [b], move [R], goto q1 ; and a trailing one\nstate q1: accept\n"
        }}
    }));
    let note = recv(&mut stdout);
    assert_eq!(note["method"], "textDocument/publishDiagnostics");
    assert_eq!(note["params"]["uri"], "file:///b.tm");
    assert_eq!(note["params"]["diagnostics"].as_array().expect("an array").len(), 0, "this fixture parses clean");

    send(&mut stdin, &serde_json::json!({
        "jsonrpc": "2.0", "id": 3, "method": "textDocument/formatting",
        "params": {
            "textDocument": { "uri": "file:///b.tm" },
            "options": { "tabSize": 2, "insertSpaces": true }
        }
    }));
    let reply = recv(&mut stdout);
    assert_eq!(reply["id"], 3);
    assert!(reply.get("error").is_none(), "formatting a clean file must not error: {reply:?}");
    let edits = reply["result"].as_array().expect("a success response carrying an edit array");
    assert_eq!(edits.len(), 1, "FULL sync, so formatting is one whole-document edit: {edits:?}");
    let new_text = edits[0]["newText"].as_str().expect("a newText string");
    assert!(new_text.contains("; a machine"), "own-line comment lost:\n{new_text}");
    assert!(new_text.contains("; and a trailing one"), "trailing comment lost:\n{new_text}");

    send(&mut stdin, &serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "shutdown" }));
    let reply = recv(&mut stdout);
    assert_eq!(reply["id"], 2);

    send(&mut stdin, &serde_json::json!({ "jsonrpc": "2.0", "method": "exit" }));
    drop(stdin);

    let status = child.wait().expect("the server exits after `exit`");
    assert!(status.success(), "the server exited with {status}");
}
```

> `env!("CARGO_BIN_EXE_redextape-lsp")` is set by cargo for integration tests in a package with a
> binary, so the test never guesses a path and never needs a build step of its own. Add
> `serde_json = "1"` to `[dev-dependencies]` if the dependency is not already inherited — it is a
> normal dependency of this crate, so it will be.

- [ ] **Step 2: Run the test to verify it fails**

```
cargo test -p redextape-lsp --test protocol
```

Expected: FAIL — no binary target exists, so `CARGO_BIN_EXE_redextape-lsp` does not resolve and the crate does not compile.

- [ ] **Step 3: Write `src/main.rs`**

```rust
//! The `redextape-lsp` binary: stdio, the initialize handshake, and the loop that hands every
//! message to `Server::handle`.
//!
//! **THIS FILE IS THE ONLY ONE IN THE CRATE THAT NAMES `lsp-server`.** Everything it does is
//! transport: read a framed message off stdin, translate the envelope, hand it to the handler,
//! write what comes back. No decision about the protocol's meaning is taken here, which is what
//! makes the handler testable without a process and what keeps the door open for a wasm caller
//! that has no stdio at all. `git grep -l lsp_server crates/redextape-lsp/src` must print this
//! path and nothing else.

use std::error::Error;

use lsp_server::{Connection, Message, Notification, Request, Response};
use redextape_lsp::{Outgoing, Server};

fn main() -> Result<(), Box<dyn Error + Sync + Send>> {
    let (connection, io_threads) = Connection::stdio();
    let mut server = Server::new();

    // The handshake goes through the ordinary handler rather than through
    // `Connection::initialize`. That helper answers `initialize` itself with capabilities the
    // caller passes in, which would put the capability decision here — in the file with no tests —
    // rather than in the one that has them.
    let (id, params) = connection.initialize_start()?;
    let init = to_request_object(&Request { id: id.clone(), method: "initialize".into(), params });
    for out in server.handle(init) {
        if let Outgoing::Response(response) = out {
            let value = response
                .result()
                .cloned()
                .ok_or("the initialize handler answered with an error")?;
            connection.initialize_finish(id.clone(), value)?;
        }
    }

    for message in &connection.receiver {
        match message {
            Message::Request(request) => {
                if connection.handle_shutdown(&request)? {
                    break;
                }
                dispatch(&connection, &mut server, to_request_object(&request))?;
            }
            Message::Notification(notification) => {
                let object = notification_to_request_object(&notification);
                dispatch(&connection, &mut server, object)?;
            }
            // A response is an answer to a request this server sent, and it sends none.
            Message::Response(_) => {}
        }
    }

    // CORRECTED DURING EXECUTION — this block originally went straight to `io_threads.join()?`.
    // The writer thread's channel is a rendezvous with `connection.sender` as its only producer;
    // `join` waits for that thread to see the channel close, which only happens once every sender
    // is gone. `connection` lives in this function's scope for the whole call, so without an
    // explicit drop here the sender outlives the join and the two wait on each other forever —
    // the server never exits after `exit`, which is exactly the shape of hang this task exists to
    // avoid, just one line later than the missing-`initialized` case the brief named.
    drop(connection);
    io_threads.join()?;
    Ok(())
}
```

Plus the four transport helpers, in the same file:

```rust
/// An `lsp-server` request as the JSON-RPC envelope the handler speaks.
///
/// Both sides are plain serde types over the same wire shape, so the translation is a round trip
/// through `serde_json::Value` rather than a field-by-field copy that could drift from either.
fn to_request_object(request: &Request) -> gen_lsp_types::json_rpc::RequestObject {
    serde_json::from_value(serde_json::json!({
        "jsonrpc": "2.0",
        "id": request.id,
        "method": request.method,
        "params": request.params,
    }))
    .unwrap_or_else(|_| unreachable!("a Request always forms a valid RequestObject"))
}

fn notification_to_request_object(n: &Notification) -> gen_lsp_types::json_rpc::RequestObject {
    serde_json::from_value(serde_json::json!({
        "jsonrpc": "2.0",
        "method": n.method,
        "params": n.params,
    }))
    .unwrap_or_else(|_| unreachable!("a Notification always forms a valid RequestObject"))
}

fn dispatch(
    connection: &Connection,
    server: &mut Server,
    object: gen_lsp_types::json_rpc::RequestObject,
) -> Result<(), Box<dyn Error + Sync + Send>> {
    for out in server.handle(object) {
        connection.sender.send(to_message(&out)?)?;
    }
    Ok(())
}

fn to_message(out: &Outgoing) -> Result<Message, Box<dyn Error + Sync + Send>> {
    Ok(match out {
        Outgoing::Response(r) => Message::Response(serde_json::from_value::<Response>(
            serde_json::to_value(r)?,
        )?),
        Outgoing::Notification(n) => Message::Notification(Notification {
            method: n.method().to_string(),
            params: n.params().cloned().unwrap_or(serde_json::Value::Null),
        }),
    })
}
```

> `unreachable!` is a panic and the workspace's five restriction lints do not cover it (no clippy
> lint bans it, exactly as the root `Cargo.toml` says). It is used here on the same terms the
> library paths that already carry one use it: a `Request` is by construction a valid
> `RequestObject`, and threading a `Result` through a translation that cannot fail would be error
> handling with no error. If either call turns out to be reachable, that is a defect in this
> function and not a case to handle. Verify the `lsp_server::Response` field names against
> `msg.rs` — 0.10.0 has `response_result: Result<Value, ResponseError>`, not the `result`/`error`
> option pair older versions had, and the round trip through `serde_json::Value` is what keeps this
> code from depending on which.

- [ ] **Step 4: Run the test to verify it passes**

```
cargo test -p redextape-lsp --test protocol
```

Expected: PASS, 1 test. If it hangs, the framing is wrong — that is the failure this test exists to catch. Read the bytes with `cargo test -- --nocapture` and a `dbg!` on the header loop rather than adding a timeout.

- [ ] **Step 5: Confirm the boundary holds**

```
git grep -l lsp_server crates/redextape-lsp/src
```

Expected: exactly `crates/redextape-lsp/src/main.rs`. This is a Global Constraint and the one mechanical check of §3.1's central claim.

- [ ] **Step 6: Run the whole gate**

```
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace
```

Expected: all clean, and the workspace count is the pre-branch 1403 plus this crate's tests.

- [ ] **Step 7: Measure the coverage, and do not assume it**

```
cargo llvm-cov nextest --workspace --fail-under-lines 90
```

Expected: PASS, at or above 90. Record the exact percentage — it goes in the roadmap entry in Task 10.

**If it fails**, the likely cause is `main.rs`: `cargo-llvm-cov` sets `LLVM_PROFILE_FILE` with a `%p` pattern, so a binary spawned by an instrumented test *should* contribute its own profile — but that is a claim about the tool, not a measurement of this tree. Check it with `cargo llvm-cov nextest --workspace --summary-only` and read `main.rs`'s own line count before concluding anything. If the transport really is uncovered and the workspace is under the floor, the remedy is to move a helper out of `main.rs` and test it, not to lower the gate.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-lsp
git commit -m "The binary, and the one test that runs it over real pipes because a handler test cannot see the framing"
```

---

## Task 9: Neovim wiring

**Files:**
- Modify: `plugin/redextape.lua` (append, after the `FileType` autocmd block)

- [ ] **Step 1: Add the registration**

At the end of `plugin/redextape.lua`:

```lua
-- THE LANGUAGE SERVER. Diagnostics for all four forms and formatting for all four, from the same
-- `redextape-core` the CLI and the web UI use — see crates/redextape-lsp.
--
-- `filetypes = FILETYPES` REUSES THE TABLE ABOVE rather than repeating four strings. It is the same
-- discipline `scripts/check-lua.sh` enforces between the parser names and the C symbols they must
-- match: one list, so a fifth form cannot be added to one place and forgotten in the other. It is
-- also what makes the server's dispatch correct — it matches on the `languageId`, which Neovim
-- sends as the buffer's filetype, which is this table.
--
-- THE BINARY IS RESOLVED, NOT ASSUMED, and a missing one is said out loud once. A development
-- checkout has it under `target/release`; someone who ran `cargo install --path crates/redextape-lsp`
-- has it on `PATH`; someone who has done neither gets a warning naming both remedies rather than an
-- LSP client that fails to start with no explanation. That is the shape the missing-parser
-- `vim.notify` above already uses.
local function server_cmd()
  local built = ROOT .. "/target/release/redextape-lsp"
  if vim.uv.fs_stat(built) then
    return built
  end
  if vim.fn.executable("redextape-lsp") == 1 then
    return "redextape-lsp"
  end
  return nil
end

local cmd = server_cmd()
if cmd then
  vim.lsp.config("redextape", {
    cmd = { cmd },
    filetypes = FILETYPES,
    root_markers = { "redextape.toml", ".git" },
  })
  vim.lsp.enable("redextape")
else
  vim.notify(
    "redextape: no redextape-lsp binary found.\n"
      .. "Run `cargo build --release -p redextape-lsp` in "
      .. ROOT
      .. ", or `cargo install --path crates/redextape-lsp` to put it on PATH.\n"
      .. "Diagnostics and formatting are off until then; highlighting is unaffected.",
    vim.log.levels.WARN
  )
end
```

> `vim.uv.fs_stat` is Neovim 0.10+; this file already targets 0.12+ for nvim-treesitter `main`, so
> it is available. `vim.lsp.config`/`vim.lsp.enable` are the 0.11+ API — check them against the
> Neovim actually installed before committing, and if either is missing use
> `vim.lsp.start` in a `FileType` autocmd scoped to `FILETYPES` instead. **Do not guess which:**
> run `nvim --headless -c 'lua print(vim.fn.has("nvim-0.11"))' -c q`.

- [ ] **Step 2: Run the Lua gate**

```
scripts/check-lua.sh --self-test && scripts/check-lua.sh
```

Expected: PASS both. The self-test proves the detector still detects; the scan proves the file is syntactically valid and the `GRAMMARS` keys still match the C symbols.

- [ ] **Step 3: Verify in a real Neovim, and build the harness from nothing**

Build the server, then open one file of each form and confirm colour AND diagnostics:

```bash
cargo build --release -p redextape-lsp
printf 'tapes 1\ntapes 2\nstart q0\nstate q0: accept\n' > /tmp/claude-1000/probe.tm
nvim --headless --clean -u NONE \
  -c 'set runtimepath+=/home/davey/projects/redextape' \
  -c 'runtime plugin/redextape.lua' \
  -c 'edit /tmp/claude-1000/probe.tm' \
  -c 'lua vim.defer_fn(function() print(vim.inspect(vim.diagnostic.get(0))) vim.cmd("qa!") end, 2000)'
```

**CORRECTED DURING EXECUTION — the form above with the probe file as a bare positional argument is
wrong, and it is wrong for a documented Neovim reason.** `-c {command}` always runs after the first
file is loaded, regardless of where the `-c` flags sit relative to the filename on the command
line — `nvim --help` states this plainly. So a probe file named as a positional argument gets
Neovim's built-in extension-based filetype (`tcl` for `.tm`) *before* `-c 'runtime
plugin/redextape.lua'` ever registers this plugin's content-sniffed override, and the LSP never
attaches — not because the wiring is broken, but because the plugin has not loaded yet when the
file opens. This does not reproduce in real usage: lazy.nvim's `lazy = false` sources
`plugin/*.lua` during Neovim's normal plugin-loading phase, which precedes opening any file named
on the command line. The fix above opens the probe via `-c 'edit <path>'` *after* the plugin is
sourced, rather than as a positional argument — `--cmd` (which runs before the first file, config
included) is the other correct form, either works.

**THE `-u NONE` AND THE ABSENCE OF ANY AUTOCMD OF YOUR OWN ARE STILL THE POINT.** This repository has
three green verifications of a plugin that produced no colour, because every harness registered the
autocmd the plugin lacked and was therefore testing the harness. Do not add a `FileType` autocmd, a
`vim.lsp.start` call, or a `set filetype=` to this command — reordering when the probe file opens
relative to sourcing the plugin is not that; it only matches what real startup order already does
for a `lazy=false` plugin. If the diagnostics do not appear, the wiring is wrong — that is the
finding.

Expected: one diagnostic, on line 1 (0-indexed), naming the duplicate `tapes`. Then check
formatting on a file with comments:

```bash
printf '; a machine\ntapes 1\nstart q0\n\nstate q0:\n  [a] -> write [b], move [R], goto q1 ; and a trailing one\nstate q1: accept\n' > /tmp/claude-1000/probe2.tm
nvim --headless --clean -u NONE \
  -c 'set runtimepath+=/home/davey/projects/redextape' \
  -c 'runtime plugin/redextape.lua' \
  -c 'edit /tmp/claude-1000/probe2.tm' \
  -c 'lua vim.defer_fn(function() vim.lsp.buf.format() vim.cmd("w! /tmp/claude-1000/probe2.out") vim.cmd("qa!") end, 2000)'
cat /tmp/claude-1000/probe2.out
```

Expected: both comments present in the output. Record what you actually saw, not what should have happened.

- [ ] **Step 4: Commit**

```bash
git add plugin/redextape.lua
git commit -m "The plugin starts the server when the binary is there and says which two commands build it when it is not"
```

---

## Task 10: The roadmap entry, and the README

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-04-redextape-lsp-design.md` (the four spec deltas)

- [ ] **Step 1: Correct the spec's four stale claims**

Apply the four items from **Spec deltas found while writing this plan** to the design document, at
the sections they belong to: §3.1's signature, §3.4's dependency sentence (add the featureless-`Uri`
reason), §6's test list (the two names that do not exist in the tree, and what they landed as), and
a note in §3.1 that the four `tm.rs` re-exports were added by PR B. **Do not leave the plan as the
only place a reader can learn these** — the spec is what someone reads first.

- [ ] **Step 2: Close the roadmap's open PR B item**

`docs/superpowers/plans/2026-07-19-redextape-roadmap.md` currently says, under PR A's WHAT STAYS
OPEN: "**This is PR A of a two-PR design.** The `redextape-lsp` crate is PR B, and it has no plan
yet." Update that bullet — leading with the closure, because a bullet under a WHAT STAYS OPEN
heading is read by its first clause and this file has already been caught by exactly that.

- [ ] **Step 3: Write the new entry**

Add an entry in this file's established shape: an all-caps heading naming what shipped and what was
learned, the date, the branch, the commit range and the commit count; a Design/Plan link pair; the
body; a WHAT STAYS OPEN list; and a VERIFICATION block.

**Every figure in VERIFICATION names the command that produced it and is re-run at the branch head
before the entry is committed.** Not carried from a task report, not carried from an earlier commit.
The figures this branch owes:

```
N                       commits                    git rev-list --count main..HEAD
N files, +N/-N          whole-branch diff          git diff --shortstat main..HEAD
N passed, N skipped     workspace                  cargo nextest run --workspace
N passed                the new crate              cargo nextest run -p redextape-lsp
NN.NN% lines            coverage, floor 90         cargo llvm-cov nextest --workspace
1                       the lsp-server boundary    git grep -l lsp_server crates/redextape-lsp/src | wc -l
```

WHAT STAYS OPEN, from §8 — each is a property or a deferral, not an oversight:

- No navigation for any form. Go-to-definition on a TM state name is `SourceMap::tm_owner` then `SourceMap::source_span`, both of which already exist; it is a slice of its own.
- `analysis` still drops resolved symbols, and every `.rxt` navigation feature waits on that.
- `classify_lambda` and `classify_tm` over *authored* text still do not exist. This slice advertises no semantic tokens, so it does not need them.
- No semantic tokens, deliberately: the four grammars already highlight all four forms in the target editor.
- Incremental text sync, deliberately: `FULL` is what §3.3 chose and why.
- `web/` is not a consumer, and §9 is why that is a layout decision rather than a promise.
- Whether `redextape fmt` should grow `.tm` and `.asm` support — still open, still not in either PR.

- [ ] **Step 4: Add the server to the README**

Find the section that documents `plugin/redextape.lua` and the four grammars, and add what the
server provides, the one command that builds it, and the `conform.nvim` entries for those who route
formatting there. `formatters_by_ft` is keyed by FILETYPE and this server serves four of them, so
all four need naming — or conform's `["_"]` catch-all:

```lua
redextape = { lsp_format = "fallback" },
redextape_asm = { lsp_format = "fallback" },
redextape_lambda = { lsp_format = "fallback" },
redextape_tm = { lsp_format = "fallback" },
```

Not required — `vim.lsp.buf.format()` works without it. A user's lazy.nvim spec still needs no
change, which is the property that file's own header states as its reason for existing.

- [ ] **Step 5: Run the documentation gates**

```
scripts/check-citations.sh --self-test && scripts/check-citations.sh
scripts/check-doc-figures.sh --self-test && scripts/check-doc-figures.sh
scripts/check-shared-docs.sh --self-test && scripts/check-shared-docs.sh
scripts/check-text-bytes.sh --self-test && scripts/check-text-bytes.sh
```

Expected: all clean. Every citation must grep to its target and every figure must name its command.

- [ ] **Step 6: Commit**

```bash
git add docs README.md
git commit -m "The roadmap entry for the language server, and four spec claims that did not survive writing the plan"
```

---

## Task 11: Whole-branch verification

**Files:** none — this task changes nothing unless it finds something.

> A per-task green is the *condition* for this, not a substitute. Twelve findings across ten rounds
> on PRs #75 and #76 were each found only by looking at the branch as one thing, after every task
> had passed its own review.

- [ ] **Step 1: Run the full local gate**

```
scripts/check-all.sh
```

Expected: every leg green. This is the gate CI runs; a leg that needs a toolchain you do not have will say so rather than silently skipping.

- [ ] **Step 2: Re-run every VERIFICATION figure at the branch head**

Run each command from Task 10 Step 3 again, at `HEAD`, and fix the entry if any number moved. A figure that was true three commits ago and is false now is the single most common defect in this file's history.

- [ ] **Step 3: Read the whole diff**

```
git diff main...HEAD
```

Looking for, specifically:
- A claim in a doc comment or a plan that the code does not support.
- A test whose assertion cannot fail — an equality between two empty things, a count that any implementation would produce.
- A second copy of a rule that already exists somewhere (the `split_trailing` shape).
- Anything in `crates/redextape-lsp/src/` other than `main.rs` that names `lsp_server`.

- [ ] **Step 4: Request a code review**

Use `superpowers:requesting-code-review` over the whole branch. When a finding lands, fix the **class** and show the sibling search that proves the class is closed — three rounds on an earlier branch each fixed the reported defect and the next review found its sibling within minutes.

- [ ] **Step 5: Open the PR**

Branch `redextape-lsp-crate` against `main`. **One long line per paragraph in the body** — Forgejo renders PR bodies with GFM `breaks: true`, so a hard-wrapped paragraph shows as forced line breaks. This is the opposite of the commit-message rule.

---

## Self-review notes

**Spec coverage.** §3.1 layout → Tasks 1–8 (`document.rs`, `language.rs`, `position.rs`, `lib.rs`, `main.rs`, `Cargo.toml`). §3.2 dispatch → Task 1, and the `unknown_language_id_is_answered` half in Task 6. §3.3 capabilities → Task 5. §3.4 dependencies → Task 1 Step 2. §4 encoding → Task 2, echoed in Task 5. §5 Neovim → Task 9. §6 tests → Tasks 1–8, with the five PR A tests left alone and named in the Spec deltas. §7 rejected approaches → nothing to build. §8 what this does not close → Task 10's WHAT STAYS OPEN. §9 the web phase → the `lsp-server` boundary check, Task 8 Step 5. §10 open questions → the `redextape fmt` question stays open, recorded in Task 10.

**Fixtures are no longer left to the implementer.** The first draft of this plan invented every one of them and every one was wrong; they are now pinned in the **Verified fixtures** section against real parser output, and the two defects that probe found — invalid TM rule syntax, and a `.rxt` "does not format" case that formats — are recorded there rather than left to be rediscovered per task.

**One thing this plan still leaves to the implementer, flagged inline rather than guessed:** the Neovim API version check (Task 9 Step 1's note — run the `has("nvim-0.11")` probe rather than assuming `vim.lsp.config`/`vim.lsp.enable` exist). Writing a version here would be writing a claim about a machine this plan cannot see.

**CORRECTED WHILE WRITING TASK 10 — the plan's prose was reviewed before execution, its code was
not, and that gap is why ten defects reached implementation rather than review.** This plan's
**Verified fixtures** section and its **Spec deltas found while writing this plan** section both
exist because an out-of-tree probe checked the *fixture strings* against the real parser before any
task was dispatched — that check caught invalid TM rule syntax, a nonexistent value type, and a
missing `#` in an asm operand, three times over. No equivalent check ran the plan's *code blocks*
through `rustc` or `cargo check` before execution began, so the same rigor that pinned every string
literal to real parser output did not extend to whether a `use` path resolved, a field access
matched the actual struct shape, or a signature matched the trait it implements. Ten defects
reached implementation as a result, each caught only once a task actually compiled the block against
the real crate: `gen_lsp_types::json_rpc::ErrorCodes` named a path that does not exist; `Diagnostic.message`
was assigned a `String` where the field is a `Message` enum; `DidChangeTextDocumentParams`'s `uri` was
read as a direct field when it sits behind a flattened `text_document_identifier`; `main.rs` omitted
the `drop(connection)` that keeps `io_threads.join()` from hanging forever after `exit`; `did_close`
hand-built a notification instead of calling `publish`, which let `documents.close()` go unverified;
`Server::formatting` was typed `&mut self` where it mutates nothing; a Task 4 instruction asked
`rustfmt` to make a merge decision `imports_granularity`'s absence from `rustfmt.toml` means it can
never make; `tests/protocol.rs` never sent an ordinary, id-bearing request, so the write loop's
response arm went unexercised by the one test that exists to prove the wire; the formatting test's
assertions all matched substrings the input fixture already contained, so they would have passed
against a handler returning `doc.text` unchanged; and the Neovim verification command opened its
probe file as a positional argument, which `-c` always processes *after*, handing the probe
Neovim's built-in filetype instead of this plugin's. **A plan's prose can be checked by reading it
against the tree it describes; its code cannot be checked that way — only by compiling it.**
