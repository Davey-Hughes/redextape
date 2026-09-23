# Plan 7 part 3c — Hover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `textDocument/hover` answers for the source, TM and asm languages and is silent for λ, reached in the app by pointer and by a key.

**Architecture:** The resolvers and the words live in `redextape-core`, in a new `hover.rs` plus two line-resolvers beside the parsers they belong to; `redextape-lsp` adds one request arm, one capability and one markup renderer and decides nothing. Three mechanisms serve the five rows `NameIndex` cannot reach: one walk of the `.rxt` AST (arity and literals), one TM line re-parse, one asm line re-parse. `web/` adds a `hoverTooltip` and one keybinding.

**Tech Stack:** Rust (`redextape-core`, `redextape-lsp`, `redextape-lsp-wasm`), `gen-lsp-types` 0.11.0, TypeScript, CodeMirror 6 (`@codemirror/view` 6.43.8), Vitest browser mode with Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-plan7-part3-editor-intelligence-design.md` §8.1–§8.7, amended at `38fce5f`. Code facts read at `0bd07c5`.

---

## Global Constraints

- **Every commit passes the pre-commit gate**, which runs clippy with `-D warnings`. A task whose end state leaves an unused item fails to commit. Never use `--no-verify`.
- **`file:line` citations are BANNED in tracked source.** They are normal in `docs/`. Cite a symbol by name and the file that declares it.
- **No AI/assistant attribution** anywhere — code comments, docs, commit messages, PR bodies.
- **Doc comments:** `///` in Rust, `/** */` in TypeScript. A `///` in a `.ts` file is drift.
- **λ answers `None` for hover**, and its test is sabotage-verified in Task 9 — not earlier, because a sabotage only discriminates once the other three languages answer.
- **No new dependency** in `web/package.json` or in any `Cargo.toml`. `hoverTooltip` and `activateHover` are already exported by the installed `@codemirror/view` 6.43.8.
- **Roadmap entry before the PR is opened**, not after (Task 10).
- Scratch files go in the session scratchpad, never in the working tree.

---

## Pre-flight findings

Taken at `0bd07c5` before this plan was written. Both probes were reverted; the tree is clean.

| Finding | Value | How |
|---|---|---|
| `.rxt` parse a hover adds, per request | **3.55 ms** | A temporary `#[test]` in `parser.rs` timing `parse_for_nav` over 8,500 `fn`s / 185,896 bytes, median of 9, `--release`. `nav_rxt` on the same fixture is 4.74 ms. The probe asserted `definitions().count() >= 8_500` first, so it measured a parse that ran rather than the empty tree `parse_for_nav` returns above `MAX_TOKENS` (100,000). **Native, not wasm** — the decision holds with a wide margin either way, so no wasm figure was taken. |
| **Decision: no AST cache.** | — | 3.55 ms native for a user-initiated request needs no cache. `Language::hover(src, offset)` keeps its plain signature and `Document` grows no field. |
| F-key delivery to the editor | F1, F2, F4, F8, F9 all arrive | A temporary browser test pressing each through `userEvent`, with a positive control (`ArrowDown`, `true`) and a negative control (`F7`, never sent, `false`). **The first run's control read `false` because the listener was detached before it ran** — the five `true`s beside it were meaningless until that was fixed. |
| **Decision: `F2`.** | — | Chromium binds nothing to F2, unlike F1 (help), F3 (find), F5 (reload), F6, F7 (caret browsing), F10 (menu), F11 (fullscreen) and F12 (devtools). |
| **What that probe could NOT show** | — | Playwright injects keys through CDP at the renderer, so browser-chrome bindings never apply. The probe shows nothing in the app/CodeMirror/vim stack swallows the key; it says nothing about a real Chrome. Picking a key Chrome does not bind is what covers the other half, and Task 9's test carries this limitation in its own doc comment. |

**Test-harness finding that changes Task 9:** `lsp-navigation.test.ts` presses keys with a synthetic `KeyboardEvent`, which never produces the events a real key does. `vim-keymap.test.ts` records this and uses `userEvent`. **Task 9 follows `vim-keymap.test.ts`, not the navigation file it otherwise resembles.**

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `crates/redextape-core/src/hover.rs` | `HoverAnswer`, and the three per-language answer functions. The only place hover's words live. |
| `web/src/lsp-hover.ts` | The CodeMirror `hoverTooltip` source and the DOM it builds. |
| `web/tests/node/lsp-hover.test.ts` | The client's `hover()` over a fake port. |
| `web/tests/browser/lsp-hover.test.ts` | Hover through the real app: source, TM, λ-empty, and the F2 key. |

**Modified**

| File | Change |
|---|---|
| `crates/redextape-core/src/lib.rs` | `pub mod hover;` |
| `crates/redextape-core/src/tm/syntax.rs` | `pub fn rule_at` and `pub fn state_rule_count` |
| `crates/redextape-core/src/tm/asm_syntax.rs` | `MNEMONIC_DOCS`, its drift test, `pub fn instr_at` |
| `crates/redextape-lsp/src/language.rs` | `Language::hover` |
| `crates/redextape-lsp/src/lib.rs` | the hover arm, `hover_provider`, `hover_markdown`, the markup renderer, and the two tests that pin hover's absence |
| `web/src/lsp-protocol.ts` | `LspHover`, `LspMarkupContent` |
| `web/src/lsp-client.ts` | `hover()`, and `plaintext` in the advertised `contentFormat` |
| `web/src/lsp-nav.ts` | the `F2` binding |
| `web/src/scratch-editor.ts`, `web/src/main.ts` | the tooltip extension at both construction sites |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the PR's entry |

---

## Task 1: The protocol arm, answering `null` for everything

The whole hover path, end to end, with no content in it. Every later task is purely additive after this.

**Files:**
- Create: `crates/redextape-core/src/hover.rs`
- Modify: `crates/redextape-core/src/lib.rs`
- Modify: `crates/redextape-lsp/src/language.rs`
- Modify: `crates/redextape-lsp/src/lib.rs`

**Interfaces:**
- Produces: `redextape_core::hover::HoverAnswer { title: String, lines: Vec<String>, span: Span }`; `redextape_core::hover::{rxt, tm, asm}(src: &str, offset: usize) -> Option<HoverAnswer>`; `Language::hover(self, src: &str, offset: usize) -> Option<HoverAnswer>`.

- [ ] **Step 1: Write `hover.rs` with the type and three stubs**

```rust
//! What hover says, for each text form that has anything to say.
//!
//! **THE WORDS LIVE HERE, NOT IN THE SERVER.** `redextape-lsp` renders what this module returns and
//! decides nothing about it. The reason is the drift test: the asm table this module carries is held
//! to `MNEMONICS`, which is private to `asm_syntax`, and a table living in the server could only be
//! held to it across a crate boundary — a weaker claim than `table_agrees_with_the_printer`, the
//! sibling it copies. Core already owns user-facing English; every `Diagnostic` message is core's.
//!
//! **`None` IS THE ORDINARY ANSWER.** A cursor on whitespace, on a keyword, or in `.rxlambda` has
//! nothing to say about it, and LSP spells that `null`. Nothing here is an error path.

use crate::span::Span;

/// One hover answer, carrying no markup.
///
/// Markup is the server's business: the same answer renders as plaintext or as markdown depending
/// on what the client advertised, and authoring it twice would be two copies of one sentence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HoverAnswer {
    /// The first line — a signature, a mnemonic, a literal's type.
    pub title: String,
    /// Everything under the title, one entry per line.
    pub lines: Vec<String>,
    /// What the answer is about, for `Hover.range`. Byte offsets, as every span in this crate is.
    pub span: Span,
}

/// Hover for the `.rxt` source form.
#[must_use]
pub fn rxt(_src: &str, _offset: usize) -> Option<HoverAnswer> {
    None
}

/// Hover for the `.tm` text form.
#[must_use]
pub fn tm(_src: &str, _offset: usize) -> Option<HoverAnswer> {
    None
}

/// Hover for the `.asm` text form.
#[must_use]
pub fn asm(_src: &str, _offset: usize) -> Option<HoverAnswer> {
    None
}
```

- [ ] **Step 2: Register the module**

In `crates/redextape-core/src/lib.rs`, add `pub mod hover;` to the alphabetised `pub mod` list — between `pub mod desugar;` and `pub mod interp;`.

- [ ] **Step 3: Add `Language::hover`**

In `crates/redextape-lsp/src/language.rs`, after `Language::format` and before `Language::nav`:

```rust
    /// What hover says at `offset`, or `None` when this form has nothing to say there.
    ///
    /// **THE FOURTH ONE-CALL-INTO-CORE, AND IT DECIDES AS LITTLE AS THE OTHER THREE.** `.rxlambda`
    /// answers `None` for the reason `nav` does and one more: `LambdaTerm` carries no span on any
    /// variant, so there is nothing to resolve a document position against. That is a designed gap,
    /// asserted by a test rather than left as an omission.
    #[must_use]
    pub fn hover(self, src: &str, offset: usize) -> Option<redextape_core::hover::HoverAnswer> {
        match self {
            Language::Redextape => redextape_core::hover::rxt(src, offset),
            Language::Tm => redextape_core::hover::tm(src, offset),
            Language::Asm => redextape_core::hover::asm(src, offset),
            Language::Lambda => None,
        }
    }
```

- [ ] **Step 4: Add the imports to `lib.rs`**

In `crates/redextape-lsp/src/lib.rs`, add to the flat `use gen_lsp_types::{...}` list, keeping it alphabetised: `Contents, Hover, HoverParams, HoverProvider, HoverRequest, MarkupContent, MarkupKind`.

Do **not** import `MarkedString` or `MarkedStringWithLanguage` — both are `#[deprecated]` in `gen-lsp-types`, whose crate-internal `#![allow(deprecated)]` does not extend here, so touching either fails the `-D warnings` gate.

- [ ] **Step 5: Add the negotiated field to `Server`**

Beside `hierarchical_symbols` in the `Server` struct:

```rust
    /// Whether the client listed `markdown` in `textDocument.hover.contentFormat`.
    ///
    /// Negotiated exactly as `hierarchical_symbols` is, and for the same reason: the client says what
    /// it can render and the server renders that, rather than both guessing. The web client advertises
    /// plaintext, which is what lets `web/` hold no markdown renderer for a tooltip.
    hover_markdown: bool,
```

Add `hover_markdown: false` to `Server::default`'s struct literal, beside `hierarchical_symbols: false`.

- [ ] **Step 6: Negotiate it in `initialize`, and advertise the capability**

In `fn initialize`, after the `self.hierarchical_symbols = ...` assignment:

```rust
        // `as_deref` rather than `as_ref`, for the same reason the `position_encodings` line above
        // uses it: `content_format` is `Option<Vec<MarkupKind>>`, and a `&[MarkupKind]` is what can
        // be tested without moving out of a borrow. `MarkupKind` is not `Copy` — it carries a
        // `Custom(Cow<'static, str>)` variant — so this compares by reference.
        self.hover_markdown = params
            .capabilities
            .text_document
            .as_ref()
            .and_then(|t| t.hover.as_ref())
            .and_then(|h| h.content_format.as_deref())
            .is_some_and(|formats| formats.contains(&MarkupKind::Markdown));
```

In the `ServerCapabilities` literal, beside `definition_provider`:

```rust
            hover_provider: Some(HoverProvider::Bool(true)),
```

- [ ] **Step 7: Add the dispatch arm and the handler**

In `handle`'s match, beside the `definition` arm:

```rust
            ("textDocument/hover", Some(id)) => vec![self.hover(id, params)],
```

After `fn definition`, add:

```rust
    /// What the construct under the cursor means.
    ///
    /// **THIS DOES NOT GO THROUGH `locate`, AND THE DIFFERENCE IS THE POINT.** That helper answers
    /// "the name under the cursor" and requires a `NameIndex`; five of hover's seven answers are not
    /// about a name at all — a TM rule, an asm instruction and a `.rxt` literal are resolved from the
    /// text itself. Reusing it would make hover silent wherever a form has no index, including a
    /// `.rxt` above `MAX_TOKENS`, for reasons that have nothing to do with hover.
    ///
    /// `null` for every case with no answer, which is what LSP says "nothing to show" is.
    fn hover(&self, id: Id, params: serde_json::Value) -> Outgoing {
        let params = match serde_json::from_value::<HoverParams>(params) {
            Ok(p) => p,
            Err(e) => return invalid_params(id, "textDocument/hover", &e),
        };
        let found = Some(params).and_then(|p| {
            let pos = p.text_document_position_params;
            let doc = self.documents.get(pos.text_document.uri.as_ref())?;
            let offset = doc.index.offset(&doc.text, pos.position, self.encoding);
            let answer = doc.language?.hover(&doc.text, offset)?;
            Some(Hover {
                contents: Contents::MarkupContent(self.markup(&answer)),
                range: Some(doc.index.range(&doc.text, answer.span, self.encoding)),
            })
        });
        Outgoing::Response(ResponseObject::from_success::<HoverRequest>(id, found))
    }

    /// One answer, rendered as whatever the client said it could read.
    ///
    /// The answer is authored once and rendered twice; neither arm is a second copy of the words.
    fn markup(&self, answer: &redextape_core::hover::HoverAnswer) -> MarkupContent {
        let (kind, title) = if self.hover_markdown {
            (MarkupKind::Markdown, format!("```\n{}\n```", answer.title))
        } else {
            (MarkupKind::PlainText, answer.title.clone())
        };
        let separator = if self.hover_markdown { "\n\n" } else { "\n" };
        let value =
            std::iter::once(title).chain(answer.lines.iter().cloned()).collect::<Vec<_>>().join(separator);
        MarkupContent { kind, value }
    }
```


- [ ] **Step 8: Fix the two tests that pin hover's absence**

In `initialize_advertises_full_sync_and_formatting`, change `assert_eq!(caps.hover_provider, None);` to:

```rust
        assert_eq!(caps.hover_provider, Some(HoverProvider::Bool(true)));
```

In `an_unhandled_request_gets_method_not_found_and_an_unhandled_notification_gets_silence`, the method must change rather than the assertion — the test is about the `(_, Some(id))` arm and `textDocument/hover` was only its example:

```rust
        // `textDocument/rename` rather than `textDocument/hover`: this test is about the arm that
        // answers a method this server does not serve, and hover — which it used to name — is served
        // as of part 3c. Swapping the assertion would have deleted the test's subject.
        let out = server.handle(request(3, "textDocument/rename", &json!({})));
```

- [ ] **Step 9: Write the tests for this task**

Add to `crates/redextape-lsp/src/lib.rs`'s test module:

```rust
    #[test]
    fn hover_off_anything_this_server_can_say_nothing_about_is_null() {
        let mut server = Server::new();
        init_hierarchical(&mut server);
        did_open(&mut server, "file:///a.rxlambda", "redextape_lambda", "λx. x");
        let out = server.handle(request(
            7,
            "textDocument/hover",
            &json!({ "textDocument": { "uri": "file:///a.rxlambda" }, "position": { "line": 0, "character": 3 } }),
        ));
        assert_eq!(success_value(&out), serde_json::Value::Null);
    }

    #[test]
    fn a_hover_request_this_server_cannot_read_is_an_error_not_a_null() {
        // The same rule `invalid_params` states for the other four handlers: a request that did not
        // PARSE is not a question with no answer.
        let mut server = Server::new();
        let out = server.handle(request(8, "textDocument/hover", &json!({ "textDocument": { "uri": "file:///a.tm" } })));
        assert_eq!(error_of(&out).code, ErrorCodes::InvalidParams);
    }

    #[test]
    fn the_markup_kind_is_the_one_the_client_advertised() {
        // Two servers, two handshakes, one answer type. A client that lists neither format gets
        // plaintext, which is the conservative default and what a client omitting the field means.
        let answer = redextape_core::hover::HoverAnswer {
            title: "t".to_string(),
            lines: vec!["l".to_string()],
            span: redextape_core::Span { start: 0, end: 1 },
        };

        let mut plain = Server::new();
        plain.handle(request(1, "initialize", &json!({ "capabilities": {} })));
        assert_eq!(plain.markup(&answer).kind, MarkupKind::PlainText);
        assert_eq!(plain.markup(&answer).value, "t\nl");

        let mut md = Server::new();
        md.handle(request(
            1,
            "initialize",
            &json!({ "capabilities": { "textDocument": { "hover": { "contentFormat": ["markdown", "plaintext"] } } } }),
        ));
        assert_eq!(md.markup(&answer).kind, MarkupKind::Markdown);
        assert!(md.markup(&answer).value.starts_with("```\nt\n```"), "got {:?}", md.markup(&answer).value);
    }
```

- [ ] **Step 10: Run the tests**

```bash
cargo test -p redextape-core -p redextape-lsp 2>&1 | tail -20
```

Expected: all pass. The three new tests pass; the two edited ones pass.

- [ ] **Step 11: Run clippy**

```bash
cargo clippy --all-targets -- -D warnings 2>&1 | tail -20
```

Expected: no output before the final summary. If `hover::rxt`/`tm`/`asm` are reported unused, they are not — they are `pub` in a library crate and reached from `language.rs`.

- [ ] **Step 12: Commit**

```bash
git add crates/redextape-core/src/hover.rs crates/redextape-core/src/lib.rs \
        crates/redextape-lsp/src/language.rs crates/redextape-lsp/src/lib.rs
git commit -m "Hover is served and answers null, and the test that used it as an unserved method names a different one"
```

---

## Task 2: The `.rxt` literal rows

**Files:**
- Modify: `crates/redextape-core/src/hover.rs`

**Interfaces:**
- Consumes: `HoverAnswer` from Task 1.
- Produces: `hover::rxt` answering for `Expr::Nat` and `Expr::Bool`; a private `walk(program, offset) -> Option<(Span, Lit)>`. **Task 3 widens this same function's return type** rather than adding a second traversal, and it is not left carrying an unread field here — `-D warnings` rejects that.

- [ ] **Step 1: Write the failing tests**

Add to `hover.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// The answer's title and lines joined, for assertions that do not care about the split.
    fn text(a: &HoverAnswer) -> String {
        std::iter::once(a.title.clone()).chain(a.lines.iter().cloned()).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn a_nat_literal_hovers_with_its_other_bases() {
        let src = "let x = 42;\nx\n";
        let at = src.find("42").expect("fixture holds it");
        let a = rxt(src, at).expect("a literal answers");
        assert_eq!(a.span, Span { start: at, end: at + 2 });
        assert!(text(&a).contains("Nat"), "{}", text(&a));
        assert!(text(&a).contains("0x2a"), "{}", text(&a));
        assert!(text(&a).contains("0b101010"), "{}", text(&a));
    }

    #[test]
    fn a_bool_literal_hovers_with_what_it_lowers_to() {
        // `1` and `0` are `lower_asm`'s, not this module's invention: `Core::Bool(_, b)` emits
        // `Li(dst, u64::from(*b))`. A Bool has no bases, which is why this row says something else.
        let src = "let b = true;\nb\n";
        let at = src.find("true").expect("fixture holds it");
        let a = rxt(src, at).expect("a literal answers");
        assert!(text(&a).contains("Bool"), "{}", text(&a));
        assert!(text(&a).contains('1'), "{}", text(&a));

        let src = "let b = false;\nb\n";
        let at = src.find("false").expect("fixture holds it");
        let a = rxt(src, at).expect("a literal answers");
        assert!(text(&a).contains('0'), "{}", text(&a));
    }

    #[test]
    fn a_cursor_on_nothing_answers_nothing() {
        let src = "let x = 42;\nx\n";
        // On the `let` keyword, and past the end of the document.
        assert!(rxt(src, 1).is_none());
        assert!(rxt(src, src.len() + 99).is_none());
    }

    #[test]
    fn a_literal_hovers_in_every_construct_that_can_hold_one() {
        // ONE ROW PER STATEMENT KIND THAT CARRIES AN EXPRESSION. An earlier draft of the walk
        // visited `Let`, `Assign` and `Fn` only, so a literal in a `while` condition, a `while`
        // body or a bare expression statement answered nothing — and the bare expression statement
        // is the commonest shape a program has.
        let cases = [
            ("let x = 7;\nx\n", "a let"),
            ("fn f(a) { 7 }\nf(1)\n", "a fn body"),
            ("let mut i = 0;\nwhile i < 7 { i = i + 1; }\ni\n", "a while condition"),
            ("let mut i = 0;\nwhile i < 3 { i = i + 7; }\ni\n", "a while body"),
            ("fn f(a) { a }\nf(7);\n0\n", "a bare expression statement"),
            ("let x = if true { 7 } else { 0 };\nx\n", "an if branch"),
            ("let xs = [7];\nxs\n", "a list element"),
        ];
        for (src, what) in cases {
            let at = src.find('7').unwrap_or_else(|| panic!("fixture for {what} must hold a 7"));
            assert!(rxt(src, at).is_some(), "no hover for a literal in {what}");
        }
    }

    #[test]
    fn the_innermost_literal_wins_over_an_enclosing_expression() {
        // A literal inside a call inside a binary: the walk must not stop at the outermost node
        // whose span contains the offset, or every hover in a nested expression answers the wrong one.
        let src = "fn f(a) { a }\nlet y = f(7) + 100;\ny\n";
        let at = src.find('7').expect("fixture holds it");
        let a = rxt(src, at).expect("the inner literal answers");
        assert_eq!(a.span, Span { start: at, end: at + 1 });
        assert!(text(&a).contains('7'), "{}", text(&a));
    }
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cargo test -p redextape-core hover:: 2>&1 | tail -20
```

Expected: four failures, each `called \`Option::unwrap\` on a \`None\` value` or the `expect` message, because `rxt` still returns `None`.

- [ ] **Step 3: Implement the walk and the literal rows**

Replace the `rxt` stub in `hover.rs`:

```rust
use crate::ast::{Block, Expr, Program, Stmt};

/// What the cursor landed on, when it landed on a literal.
enum Lit {
    Nat(u64),
    Bool(bool),
}

/// Walk every block and expression for the innermost literal at `offset`.
///
/// **TASK 3 EXTENDS THIS SAME FUNCTION RATHER THAN ADDING A SECOND ONE.** The arity row needs the
/// same traversal, and written separately one of the two ends up missing a construct the other
/// visits — the symptom being a row that silently never answers inside a `while` body.
///
/// **INNERMOST, NOT FIRST.** A literal sits inside a call inside a binary inside a `let`, and every
/// one of those spans contains the offset. Taking the first match answers the statement.
///
/// **EXHAUSTIVE MATCHES, NO `_` ARM.** A new `Stmt` or `Expr` variant must be a compile error here
/// rather than a construct hover silently never reaches — the same argument `outline_kind` makes for
/// matching `DefKind` exhaustively.
fn walk(program: &Program, offset: usize) -> Option<(Span, Lit)> {
    fn holds(span: Span, offset: usize) -> bool {
        offset >= span.start && offset < span.end
    }

    // An explicit worklist rather than recursion: `ast.rs` builds trees up to roughly `MAX_TOKENS`/2
    // deep and states that its own `Drop` is iterative for exactly that reason. A recursive walk here
    // would overflow on the documents that module already guards against.
    let mut found: Option<(Span, Lit)> = None;
    let mut blocks: Vec<&Block> = vec![&program.block];
    let mut exprs: Vec<&Expr> = Vec::new();

    while let Some(block) = blocks.pop() {
        for stmt in &block.stmts {
            match stmt {
                Stmt::Let { value, .. } | Stmt::Assign { value, .. } => exprs.push(value),
                // Task 3 replaces this arm with one that also records `(*name_span, params.len())`.
                Stmt::Fn { body, .. } => blocks.push(body),
                // A `while` holds both an expression and a block, and an earlier draft of this walk
                // visited neither — a literal in a loop condition would never have hovered.
                Stmt::While { cond, body, .. } => {
                    exprs.push(cond);
                    blocks.push(body);
                }
                // The common case, and the one the earlier draft also missed: a bare expression
                // statement. `fact(3)` on its own line is this, not the block's tail.
                Stmt::Expr(e) => exprs.push(e),
                Stmt::Error { .. } => {}
            }
        }
        if let Some(tail) = block.tail.as_deref() {
            exprs.push(tail);
        }

        while let Some(expr) = exprs.pop() {
            match expr {
                Expr::Nat { value, span } => {
                    if holds(*span, offset) {
                        found = Some((*span, Lit::Nat(*value)));
                    }
                }
                Expr::Bool { value, span } => {
                    if holds(*span, offset) {
                        found = Some((*span, Lit::Bool(*value)));
                    }
                }
                Expr::List { items, .. } => exprs.extend(items),
                Expr::Binary { lhs, rhs, .. } => {
                    exprs.push(lhs);
                    exprs.push(rhs);
                }
                Expr::Call { callee, args, .. } => {
                    exprs.push(callee);
                    exprs.extend(args);
                }
                Expr::Method { recv, args, .. } => {
                    exprs.push(recv);
                    exprs.extend(args);
                }
                Expr::If { cond, then_blk, else_blk, .. } => {
                    exprs.push(cond);
                    blocks.push(then_blk);
                    blocks.push(else_blk);
                }
                Expr::Block { block, .. } => blocks.push(block),
                Expr::Lambda { body, .. } => exprs.push(body),
                Expr::Var { .. } | Expr::Error { .. } => {}
            }
        }
    }
    found
}

/// Hover for the `.rxt` source form.
#[must_use]
pub fn rxt(src: &str, offset: usize) -> Option<HoverAnswer> {
    // `parse_for_nav`, not `parse_full`: the file hover is worth most on is the one being typed
    // into, which is exactly the file `parse_full` answers `None` for. This is the same choice
    // `nav_rxt` states for itself.
    let (parsed, _diags) = crate::parser::parse_for_nav(src);
    let parsed = parsed?;

    if let Some((span, lit)) = walk(&parsed.program, offset) {
        return Some(match lit {
            Lit::Nat(n) => HoverAnswer {
                title: "Nat".to_string(),
                // Decimal, hex and binary. The source grammar has no radix prefix — `lexer.rs` takes
                // digits and nothing else — so these are informational and cannot be typed back.
                lines: vec![format!("{n}  ·  {n:#x}  ·  {n:#b}")],
                span,
            },
            Lit::Bool(b) => HoverAnswer {
                title: "Bool".to_string(),
                // A Bool has no bases. What it has is a lowering: `lower_asm`'s `Core::Bool` arm
                // emits `Li(dst, u64::from(*b))`, so the value below is that arm's and not a
                // convention invented here.
                lines: vec![format!("lowers to {} in a register", u64::from(b))],
                span,
            },
        });
    }
    None
}
```

`parse_for_nav` is `pub(crate)` and `hover.rs` is inside `redextape-core`, so this needs no visibility change.

- [ ] **Step 4: Run the tests**

```bash
cargo test -p redextape-core hover:: 2>&1 | tail -20
```

Expected: four passes.

- [ ] **Step 5: Run clippy and commit**

```bash
cargo clippy --all-targets -- -D warnings 2>&1 | tail -5
git add crates/redextape-core/src/hover.rs
git commit -m "A source literal hovers with its other bases, and a Bool with the 1 or 0 it lowers to"
```

---

## Task 3: The `.rxt` name rows — arity and builtins

**Files:**
- Modify: `crates/redextape-core/src/hover.rs`

**Interfaces:**
- Consumes: `innermost_literal` and `rxt` from Task 2.
- Produces: `rxt` additionally answering for a `fn` name and for the five builtins.

- [ ] **Step 1: Write the failing tests**

Add to `hover.rs`'s test module:

```rust
    #[test]
    fn a_fn_name_hovers_with_its_arity() {
        let src = "fn add3(a, b, c) { a + b + c }\nadd3(1, 2, 3)\n";
        // On the declaration.
        let at = src.find("add3").expect("fixture holds it");
        let a = rxt(src, at).expect("a fn name answers");
        assert!(text(&a).contains("add3"), "{}", text(&a));
        assert!(text(&a).contains('3'), "arity missing from {}", text(&a));

        // And on the CALL, which resolves through the same index `definition` uses.
        let call = src.rfind("add3").expect("fixture holds it twice");
        assert!(text(&rxt(src, call).expect("a call answers")).contains("add3"));
    }

    #[test]
    fn a_builtin_hovers_with_its_signature_and_its_one_line() {
        let src = "head(cons(1, nil))\n";
        let at = src.find("head").expect("fixture holds it");
        let a = rxt(src, at).expect("a builtin answers");
        // The signature is COMPUTED from `prelude::type_env` through `ty::show`, so this asserts the
        // shape rather than a string this module authored.
        assert!(text(&a).contains("head"), "{}", text(&a));
        assert!(text(&a).contains("List<"), "{}", text(&a));
        // The authored half: a type cannot say this.
        assert!(text(&a).to_lowercase().contains("empty"), "{}", text(&a));
    }

    #[test]
    fn every_builtin_has_a_line_of_its_own() {
        // A table with a hole answers `None` for one name and nothing says so. `type_env` is the
        // authority for WHICH names exist, so the loop is over it rather than over this module's table.
        for (name, _) in crate::prelude::type_env() {
            let src = format!("{name}\n");
            let a = rxt(&src, 0).unwrap_or_else(|| panic!("no hover for builtin `{name}`"));
            assert!(!a.lines.is_empty(), "builtin `{name}` has a signature and no line");
        }
    }

    #[test]
    fn a_shadowed_fn_name_answers_the_declaration_the_cursor_resolves_to() {
        // The reason arity is keyed on the DEFINITION'S SPAN rather than looked up by name: both
        // `f`s below are declared, with different arities, and a name lookup answers whichever the
        // walk happened to reach first for both cursors.
        let src = "fn f(p) { fn f(q, r) { q } f(1, 2) }\nf(0)\n";
        let outer = src.find("f(0)").expect("fixture holds the outer call");
        let a = rxt(src, outer).expect("the outer call answers");
        assert!(text(&a).contains('1'), "the outer f takes one parameter: {}", text(&a));

        let inner = src.find("f(1, 2)").expect("fixture holds the inner call");
        let a = rxt(src, inner).expect("the inner call answers");
        assert!(text(&a).contains('2'), "the inner f takes two parameters: {}", text(&a));
    }

    #[test]
    fn a_local_binding_is_not_mistaken_for_a_builtin() {
        // `head` shadowed by a `let` must not answer with the builtin's signature.
        let src = "let head = 1;\nhead\n";
        let at = src.rfind("head").expect("fixture holds it");
        let a = rxt(src, at);
        assert!(
            a.as_ref().is_none_or(|a| !text(a).contains("List<")),
            "a shadowed name answered as the builtin: {a:?}"
        );
    }
```

- [ ] **Step 2: Run to verify they fail**

```bash
cargo test -p redextape-core hover:: 2>&1 | tail -20
```

Expected: the four new tests fail; Task 2's four still pass.

- [ ] **Step 3: Implement the two rows**

**First widen `walk`, which Task 2 left returning the literal alone.** Add the carrier, change the
signature, and record each `fn` as the walk already passes it — the `Stmt::Fn` arm is the only one
that changes:

```rust
/// Everything one walk of the tree answers.
///
/// **ONE WALK, TWO ANSWERS, BECAUSE TWO WALKS DRIFT.** The literal row and the arity row both need
/// the AST and both need every block reached; written separately, one of them ends up missing a
/// construct the other visits, and the symptom is a row that silently never answers inside a
/// `while` body.
#[derive(Default)]
struct Walked {
    literal: Option<(Span, Lit)>,
    /// Every `fn` declaration, as the span of its NAME and its parameter count. The span is the key
    /// because it is exactly what `NameIndex` stores for the same declaration, which is what lets a
    /// hover on a CALL resolve to its definition and read that definition's arity.
    fns: Vec<(Span, usize)>,
}
```

Change `walk`'s signature to `fn walk(program: &Program, offset: usize) -> Walked`, replace
`let mut found: Option<(Span, Lit)> = None;` with `let mut out = Walked::default();`, replace the two
`found = Some(...)` assignments with `out.literal = Some(...)`, replace the trailing `found` with
`out`, and replace the `Stmt::Fn` arm with:

```rust
                Stmt::Fn { params, body, name_span, .. } => {
                    out.fns.push((*name_span, params.len()));
                    blocks.push(body);
                }
```

Then in `rxt`, replace `if let Some((span, lit)) = walk(&parsed.program, offset) {` with:

```rust
    let walked = walk(&parsed.program, offset);
    if let Some((span, lit)) = walked.literal {
```

Then add beside `walk`:

```rust
/// The signature and description of a builtin, or `None` for a name that is not one.
///
/// **THE LOOKUP IS `type_env`, NOT `BUILTIN_NAMES`.** One lookup answers both "is this a builtin" and
/// "what is its type", and `prelude.rs`'s own comment rests a paragraph on nothing reading
/// `BUILTIN_NAMES`. Keeping that true costs nothing here.
fn builtin(name: &str) -> Option<(String, &'static str)> {
    let scheme = crate::prelude::type_env().into_iter().find(|(n, _)| n == name).map(|(_, s)| s)?;
    // Authored, because a type cannot say any of it. The `fault` halves are `interp`'s behaviour,
    // which the signatures above give no hint of.
    let description = match name {
        "nil" => "The empty list.",
        "cons" => "Prepends an element to a list.",
        "head" => "The first element. Faults on an empty list.",
        "tail" => "Everything after the first element. Faults on an empty list.",
        "is_empty" => "Whether a list has no elements.",
        _ => return None,
    };
    Some((format!("{name} : {}", crate::ty::show(&scheme.ty)), description))
}
```

Then extend `rxt`, after the literal branch and before the final `None`:

```rust
    // A name, resolved through the index `definition` and `references` already share. The literal
    // branch ran first because a literal is not an occurrence and the two cannot both match.
    let nav = crate::binder::nav_rxt(src)?;
    let (i, occurrence) = nav.at(offset)?;
    let name = occurrence.name.clone();
    let span = occurrence.span;

    // A name this document BINDS is never the builtin of the same name, whatever it is called.
    if nav.definition_of(i).is_none() {
        if let Some((signature, description)) = builtin(&name) {
            return Some(HoverAnswer { title: signature, lines: vec![description.to_string()], span });
        }
    }

    // **ARITY IS KEYED ON THE DEFINITION'S SPAN, NOT ON THE NAME.** `DefKind::Fn` is a bare
    // discriminant and the count is `params.len()` on `Stmt::Fn`, which only the AST has — but
    // looking that `fn` up BY NAME would answer the wrong one wherever a name is shadowed. The span
    // `NameIndex` stores for a declaration is the same `name_span` the AST carries, so matching on
    // it is exact. A cursor on a `let` resolves to a definition no `fn` declares, and falls through.
    let definition = nav.get(nav.definition_of(i)?)?;
    let arity = walked.fns.iter().find(|(s, _)| *s == definition.span).map(|(_, n)| *n)?;
    Some(HoverAnswer {
        title: format!("fn {name}"),
        lines: vec![format!("{arity} parameter{}", if arity == 1 { "" } else { "s" })],
        span,
    })
```

The `builtin` branch above already returned for a name nothing defines, so reaching here means `definition_of` is `Some` — but it is still written as `?` rather than an `expect`, because that is a claim about the branch above rather than about this line.

- [ ] **Step 4: Run the tests**

```bash
cargo test -p redextape-core hover:: 2>&1 | tail -20
```

Expected: all eight pass.

- [ ] **Step 5: Run clippy and commit**

```bash
cargo clippy --all-targets -- -D warnings 2>&1 | tail -5
git add crates/redextape-core/src/hover.rs
git commit -m "A fn name hovers with its arity and a builtin with a signature type_env computes"
```

---

## Task 4: The TM rows, which never read the machine

**Files:**
- Modify: `crates/redextape-core/src/tm/syntax.rs`
- Modify: `crates/redextape-core/src/hover.rs`

**Interfaces:**
- Produces: `redextape_core::tm::rule_at(src: &str, offset: usize) -> Option<(Span, RuleFacts)>` where `pub struct RuleFacts { pub reads: Vec<Option<Symbol>>, pub writes: Vec<Option<Symbol>>, pub moves: Vec<Move>, pub goto: String }`; `redextape_core::tm::state_rule_count(src: &str, state_span: Span) -> usize`; `hover::tm` answering both TM rows.

- [ ] **Step 1: Write the failing tests**

Add to `hover.rs`'s test module:

```rust
    const MACHINE: &str = "\
tapes 1
start q0

state q0:
  [a] -> write [b], move [R], goto q1
  [b] -> write [a], move [L], goto q0
state q1: accept
";

    #[test]
    fn a_rule_hovers_with_what_it_does_in_words() {
        let at = MACHINE.find("write [b]").expect("fixture holds it");
        let a = tm(MACHINE, at).expect("a rule answers");
        let t = text(&a);
        assert!(t.contains('b'), "{t}");
        assert!(t.contains("q1"), "the goto target is missing from {t}");
        // The move, in words rather than as the letter the file already shows.
        assert!(t.to_lowercase().contains("right"), "{t}");
    }

    #[test]
    fn a_state_name_hovers_with_how_many_rules_it_has() {
        let at = MACHINE.find("q0:").expect("fixture holds it");
        let a = tm(MACHINE, at).expect("a state answers");
        assert!(text(&a).contains('2'), "q0 has two rules: {}", text(&a));

        let at = MACHINE.find("q1:").expect("fixture holds it");
        let a = tm(MACHINE, at).expect("a state answers");
        assert!(text(&a).contains('0'), "q1 has none: {}", text(&a));
    }

    #[test]
    fn a_rule_in_a_file_carrying_an_error_still_hovers() {
        // THE PROPERTY §8.3 EXISTS FOR, and the hover sibling of
        // `definition_in_a_broken_file_still_answers`. The broken line is a DIFFERENT line from the
        // one under the cursor: `TmDocument::machine` is `None` for this whole document, so a hover
        // built on the machine answers nothing here.
        let broken = "tapes 1\nstart q0\n\nstate q0:\n  [a] -> write [b], move [R], goto q1\n  this line is not a rule\nstate q1: accept\n";
        assert!(
            crate::tm::parse_tm_full(broken).machine.is_none(),
            "the fixture must really be broken, or this test proves nothing"
        );
        let at = broken.find("write [b]").expect("fixture holds it");
        let a = tm(broken, at).expect("a rule in a broken file still answers");
        assert!(text(&a).contains("q1"), "{}", text(&a));
    }

    #[test]
    fn a_malformed_rule_line_answers_nothing() {
        let broken = "tapes 1\nstart q0\n\nstate q0:\n  this line is not a rule\n";
        let at = broken.find("not a rule").expect("fixture holds it");
        assert!(tm(broken, at).is_none());
    }
```

- [ ] **Step 2: Run to verify they fail**

```bash
cargo test -p redextape-core hover:: 2>&1 | tail -20
```

Expected: the four new tests fail; the previous eight pass.

- [ ] **Step 3: Expose the line resolvers from `syntax.rs`**

In `crates/redextape-core/src/tm/syntax.rs`, after `parse_rule_line`:

```rust
/// What one rule line says, read out of that line alone.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuleFacts {
    pub reads: Vec<Option<Symbol>>,
    pub writes: Vec<Option<Symbol>>,
    pub moves: Vec<Move>,
    pub goto: String,
}

/// The rule on the line containing `offset`, read from that line's own text.
///
/// **THIS NEVER TOUCHES A `Machine`, AND THAT IS THE WHOLE REASON IT EXISTS.** `TmDocument::machine`
/// is `None` whenever the file carries an error diagnostic, so an answer built on it goes quiet on
/// exactly the mid-edit file navigation is worth most on — where `definition` deliberately still
/// answers. `parse_rule_line` already reads a rule out of one line, so a hover that reads lines has
/// one code path rather than a clean one and a broken one.
///
/// `None` for a line that is not a rule, which includes a rule line that is itself malformed: there
/// is no rule there to describe.
#[must_use]
pub fn rule_at(src: &str, offset: usize) -> Option<(Span, RuleFacts)> {
    let (line_span, line) = line_containing(src, offset)?;
    let trimmed = line.trim_start();
    let raw = parse_rule_line(trimmed, line_span).ok()?;
    Some((line_span, RuleFacts { reads: raw.read, writes: raw.write, moves: raw.moves, goto: raw.goto }))
}

/// How many rule lines follow the `state` line that `state_span` sits on, before the next one.
///
/// Line-oriented for `rule_at`'s reason: counting `Machine::states` would make this row go quiet on a
/// file the other row answers for.
#[must_use]
pub fn state_rule_count(src: &str, state_span: Span) -> usize {
    let Some((line_span, _)) = line_containing(src, state_span.start) else { return 0 };
    let mut count = 0;
    for raw_line in src.get(line_span.end..).unwrap_or("").split_inclusive('\n').skip(1) {
        let trimmed = raw_line.trim_end_matches(['\r', '\n']).trim_start();
        if trimmed.starts_with("state ") {
            break;
        }
        if parse_rule_line(trimmed, Span { start: 0, end: 0 }).is_ok() {
            count += 1;
        }
    }
    count
}

/// The span and text of the line `offset` sits on, terminator excluded.
///
/// The same walk `parse_tm_nav` does — `split_inclusive('\n')` with a running offset — so a line's
/// span means the same thing in both.
fn line_containing(src: &str, offset: usize) -> Option<(Span, &str)> {
    let mut start = 0usize;
    for raw_line in src.split_inclusive('\n') {
        let end = start + raw_line.len();
        let content = raw_line.trim_end_matches(['\r', '\n']);
        if offset < end || end == src.len() {
            let span = Span { start, end: start + content.len() };
            return (offset <= span.end).then_some((span, content));
        }
        start = end;
    }
    None
}
```

Confirm `Symbol` and `Move` are in scope in `syntax.rs`; both come from `super::machine` and the file already names them.

- [ ] **Step 4: Implement `hover::tm`**

Replace the `tm` stub in `hover.rs`:

```rust
/// Hover for the `.tm` text form.
#[must_use]
pub fn tm(src: &str, offset: usize) -> Option<HoverAnswer> {
    // The rule row first: a rule line holds no state NAME, so the two cannot both match.
    if let Some((span, facts)) = crate::tm::rule_at(src, offset) {
        let sym = |s: &Option<char>| s.map_or_else(|| "any symbol".to_string(), |c| format!("`{c}`"));
        let reads = facts.reads.iter().map(sym).collect::<Vec<_>>().join(", ");
        let writes = facts.writes.iter().map(sym).collect::<Vec<_>>().join(", ");
        let moves = facts
            .moves
            .iter()
            .map(|m| match m {
                crate::tm::Move::L => "left",
                crate::tm::Move::R => "right",
                crate::tm::Move::S => "stays",
            })
            .collect::<Vec<_>>()
            .join(", ");
        return Some(HoverAnswer {
            title: format!("rule → {}", facts.goto),
            lines: vec![
                format!("reads {reads}"),
                format!("writes {writes}"),
                format!("moves {moves}"),
                format!("then goes to `{}`", facts.goto),
            ],
            span,
        });
    }

    let nav = crate::tm::parse_tm_nav(src).1;
    let (_, occurrence) = nav.at(offset)?;
    if !matches!(occurrence.role, crate::nav::Role::Definition { kind: crate::nav::DefKind::State, .. }) {
        return None;
    }
    let count = crate::tm::state_rule_count(src, occurrence.span);
    Some(HoverAnswer {
        title: format!("state {}", occurrence.name),
        lines: vec![format!("{count} rule{}", if count == 1 { "" } else { "s" })],
        span: occurrence.span,
    })
}
```

**Re-export is required, and is not a glob.** `crates/redextape-core/src/tm.rs` lists each module's public items explicitly — `pub use syntax::{...}` is the line carrying `parse_tm_nav`. Add `RuleFacts`, `rule_at` and `state_rule_count` to that list, keeping it alphabetised, or `crate::tm::rule_at` does not resolve.

- [ ] **Step 5: Run the tests**

```bash
cargo test -p redextape-core hover:: 2>&1 | tail -20
```

Expected: all twelve pass.

- [ ] **Step 6: Run clippy and commit**

```bash
cargo clippy --all-targets -- -D warnings 2>&1 | tail -5
git add crates/redextape-core/src/tm/syntax.rs crates/redextape-core/src/hover.rs
git commit -m "TM hover reads lines rather than the machine, so a rule in a broken file still answers"
```

---

## Task 5: The asm rows and the 24-mnemonic table

**Files:**
- Modify: `crates/redextape-core/src/tm/asm_syntax.rs`
- Modify: `crates/redextape-core/src/hover.rs`

**Interfaces:**
- Produces: `redextape_core::tm::instr_at(src: &str, offset: usize) -> Option<(Span, &'static MnemonicDoc)>` where `pub struct MnemonicDoc { pub mnemonic: &'static str, pub summary: &'static str, pub operands: &'static [&'static str] }`; `hover::asm`.

- [ ] **Step 1: Write the failing drift test**

Add to `asm_syntax.rs`'s test module:

```rust
    #[test]
    fn every_mnemonic_has_a_doc_row_and_every_row_a_mnemonic() {
        // The pattern `table_agrees_with_the_printer` established, applied to the second table.
        // `MNEMONICS` is the authority for WHICH spellings exist; this table must cover it exactly.
        for (mnemonic, _) in MNEMONICS {
            assert!(
                MNEMONIC_DOCS.iter().any(|d| d.mnemonic == *mnemonic),
                "no hover row for mnemonic `{mnemonic}`"
            );
        }
        for doc in MNEMONIC_DOCS {
            assert!(
                MNEMONICS.iter().any(|(m, _)| *m == doc.mnemonic),
                "hover row `{}` names no mnemonic the printer emits",
                doc.mnemonic
            );
        }
        assert_eq!(MNEMONIC_DOCS.len(), MNEMONICS.len());
    }

    #[test]
    fn every_doc_rows_operand_roles_match_its_shape() {
        // The arity is DERIVED, not authored: a row that names three roles for a two-operand
        // mnemonic is a failure here rather than a wrong tooltip.
        for doc in MNEMONIC_DOCS {
            let shape = shape_of(doc.mnemonic).expect("the test above pins every row to a mnemonic");
            assert_eq!(
                doc.operands.len(),
                shape.kinds().len(),
                "`{}` names {} operand roles for a shape taking {}",
                doc.mnemonic,
                doc.operands.len(),
                shape.kinds().len()
            );
        }
    }
```

- [ ] **Step 2: Run to verify it fails**

```bash
cargo test -p redextape-core asm_syntax 2>&1 | tail -20
```

Expected: a compile error, `cannot find value MNEMONIC_DOCS in this scope`.

- [ ] **Step 3: Write the table**

In `asm_syntax.rs`, after `MNEMONICS` and `shape_of`:

```rust
/// One mnemonic's hover text.
#[derive(Clone, Copy, Debug)]
pub struct MnemonicDoc {
    pub mnemonic: &'static str,
    pub summary: &'static str,
    /// One role name per operand, in order. The COUNT is checked against `Shape`; the names are
    /// this table's, because `Shape` knows kinds and not roles.
    pub operands: &'static [&'static str],
}

/// What each of the 24 spellings does.
///
/// **24 ROWS AGAINST 16 `Instr` VARIANTS, AND THE NINE ARE WHY THIS IS AUTHORED.** `Instr::Bin`
/// prints as one of nine and carries one doc comment — `rd <- ra op rb` — for all of them, so the
/// arithmetic and comparison spellings cannot be transcribed from it. Held to `MNEMONICS` by
/// `every_mnemonic_has_a_doc_row_and_every_row_a_mnemonic`, and to `Shape` by its sibling.
pub(super) const MNEMONIC_DOCS: &[MnemonicDoc] = &[
    MnemonicDoc { mnemonic: "li", summary: "Loads an immediate into a register.", operands: &["destination", "immediate"] },
    MnemonicDoc { mnemonic: "mov", summary: "Copies one register into another.", operands: &["destination", "source"] },
    MnemonicDoc { mnemonic: "add", summary: "Adds two registers, yielding a Nat.", operands: &["destination", "left", "right"] },
    MnemonicDoc { mnemonic: "sub", summary: "Subtracts the right register from the left, yielding a Nat.", operands: &["destination", "left", "right"] },
    MnemonicDoc { mnemonic: "mul", summary: "Multiplies two registers, yielding a Nat.", operands: &["destination", "left", "right"] },
    MnemonicDoc { mnemonic: "cmpeq", summary: "Sets the destination to 1 when the two registers are equal, else 0.", operands: &["destination", "left", "right"] },
    MnemonicDoc { mnemonic: "cmpne", summary: "Sets the destination to 1 when the two registers differ, else 0.", operands: &["destination", "left", "right"] },
    MnemonicDoc { mnemonic: "cmplt", summary: "Sets the destination to 1 when the left register is less than the right, else 0.", operands: &["destination", "left", "right"] },
    MnemonicDoc { mnemonic: "cmple", summary: "Sets the destination to 1 when the left register is at most the right, else 0.", operands: &["destination", "left", "right"] },
    MnemonicDoc { mnemonic: "cmpgt", summary: "Sets the destination to 1 when the left register is greater than the right, else 0.", operands: &["destination", "left", "right"] },
    MnemonicDoc { mnemonic: "cmpge", summary: "Sets the destination to 1 when the left register is at least the right, else 0.", operands: &["destination", "left", "right"] },
    MnemonicDoc { mnemonic: "jz", summary: "Jumps to the label when the register is zero.", operands: &["tested register", "label"] },
    MnemonicDoc { mnemonic: "jmp", summary: "Jumps to the label unconditionally.", operands: &["label"] },
    MnemonicDoc { mnemonic: "call", summary: "Calls the subroutine at the label, saving the local frame; the result returns in the result register.", operands: &["label"] },
    MnemonicDoc { mnemonic: "ret", summary: "Returns to the caller, restoring its local frame.", operands: &[] },
    MnemonicDoc { mnemonic: "halt", summary: "Stops the program; the top-level result is in the result register.", operands: &[] },
    MnemonicDoc { mnemonic: "nil", summary: "Loads the null list pointer.", operands: &["destination"] },
    MnemonicDoc { mnemonic: "cons", summary: "Allocates a heap cell from a head and a tail, yielding its pointer.", operands: &["destination", "head", "tail"] },
    MnemonicDoc { mnemonic: "head", summary: "Reads a list cell's head. Faults when the list is nil.", operands: &["destination", "list"] },
    MnemonicDoc { mnemonic: "tail", summary: "Reads a list cell's tail. Faults when the list is nil.", operands: &["destination", "list"] },
    MnemonicDoc { mnemonic: "isempty", summary: "Sets the destination to 1 when the list is nil, else 0.", operands: &["destination", "list"] },
    MnemonicDoc { mnemonic: "box", summary: "Allocates a fresh mutable box holding the value, yielding its 1-based pointer.", operands: &["destination", "value"] },
    MnemonicDoc { mnemonic: "box_get", summary: "Reads a box. Faults when the pointer is null or dangling.", operands: &["destination", "box"] },
    MnemonicDoc { mnemonic: "box_set", summary: "Overwrites a box in place. Faults when the pointer is null or dangling.", operands: &["box", "value"] },
];

/// The mnemonic on the line containing `offset`, with its doc row.
///
/// Line-oriented for `rule_at`'s reason: `Program` carries no spans, so there is nothing to resolve
/// a position against, and re-reading the line keeps the answer alive on a file that does not parse.
#[must_use]
pub fn instr_at(src: &str, offset: usize) -> Option<(Span, &'static MnemonicDoc)> {
    let mut start = 0usize;
    for raw_line in src.split_inclusive('\n') {
        let end = start + raw_line.len();
        if offset < end || end == src.len() {
            let content = raw_line.trim_end_matches(['\r', '\n']);
            let content = comments::content_before_comment(content);
            let (trimmed, pad) = trimmed_at(content);
            // A label line is `name:` and carries no mnemonic; the label row answers it instead.
            let word = trimmed.split(|c: char| c.is_whitespace() || c == ',').next().unwrap_or("");
            let doc = MNEMONIC_DOCS.iter().find(|d| d.mnemonic == word)?;
            let span = Span { start: start + pad, end: start + pad + word.len() };
            return (offset <= span.end).then_some((span, doc));
        }
        start = end;
    }
    None
}
```

- [ ] **Step 4: Run the drift tests**

```bash
cargo test -p redextape-core asm_syntax 2>&1 | tail -20
```

Expected: both new tests pass. If `every_doc_rows_operand_roles_match_its_shape` fails, the row named in the message has the wrong number of roles — fix the row, not the test.

- [ ] **Step 5: Write and pass the asm hover tests**

Add to `hover.rs`'s test module:

```rust
    const PROGRAM: &str = "\
result Nat
f:
    li\tr0, #1
    ret
";

    #[test]
    fn an_instruction_hovers_with_what_it_does_and_its_operand_roles() {
        let at = PROGRAM.find("li").expect("fixture holds it");
        let a = asm(PROGRAM, at).expect("an instruction answers");
        let t = text(&a);
        assert!(t.contains("li"), "{t}");
        assert!(t.to_lowercase().contains("immediate"), "{t}");
        assert!(t.contains("destination"), "the operand roles are missing from {t}");
    }

    #[test]
    fn a_label_hovers_with_where_it_is_defined() {
        let at = PROGRAM.find("f:").expect("fixture holds it");
        let a = asm(PROGRAM, at).expect("a label answers");
        assert!(text(&a).contains('f'), "{}", text(&a));
    }
```

Then replace the `asm` stub in `hover.rs`:

```rust
/// Hover for the `.asm` text form.
#[must_use]
pub fn asm(src: &str, offset: usize) -> Option<HoverAnswer> {
    if let Some((span, doc)) = crate::tm::instr_at(src, offset) {
        let mut lines = vec![doc.summary.to_string()];
        if !doc.operands.is_empty() {
            lines.push(format!("operands: {}", doc.operands.join(", ")));
        }
        return Some(HoverAnswer { title: doc.mnemonic.to_string(), lines, span });
    }

    let nav = crate::tm::parse_asm_nav(src).1;
    let (_, occurrence) = nav.at(offset)?;
    Some(HoverAnswer {
        title: format!("label {}", occurrence.name),
        // BOTH ARMS ARE STRUCT VARIANTS. `Role::Reference` carries a `def: Option<usize>` — a
        // dangling reference is an ordinary value here, because `parse_asm_full` accepts
        // `jmp nowhere` with zero diagnostics — so this matches `{ .. }` rather than a bare name.
        lines: vec![match occurrence.role {
            crate::nav::Role::Definition { .. } => "Defined here.".to_string(),
            crate::nav::Role::Reference { .. } => "A jump or call target.".to_string(),
        }],
        span: occurrence.span,
    })
}
```

Add `MnemonicDoc` and `instr_at` to `tm.rs`'s `pub use asm_syntax::{...}` line, beside `parse_asm_nav`. `MNEMONIC_DOCS` itself stays `pub(super)` — `hover.rs` reaches it only through `instr_at`, and the drift test lives in `asm_syntax.rs` where it is visible.

- [ ] **Step 6: Run everything and commit**

```bash
cargo test -p redextape-core 2>&1 | tail -10
cargo clippy --all-targets -- -D warnings 2>&1 | tail -5
git add crates/redextape-core/src/tm/asm_syntax.rs crates/redextape-core/src/hover.rs
git commit -m "Twenty-four mnemonics get a hover row each, held to MNEMONICS and to their own Shape"
```

---

## Task 6: asm proven at the server, where it has no editor

§11.2: asm has no editor until part 5, so it is tested at the wasm boundary rather than in the app.

**Files:**
- Modify: `crates/redextape-lsp-wasm/src/` (the existing test module — find it with `grep -rn '#\[cfg(test)\]' crates/redextape-lsp-wasm/src/`)

- [ ] **Step 1: Write the test**

Follow the shape of the existing `redextape-lsp-wasm` test that caught `formatting`'s `null`. It drives `LspServer::handle` with JSON strings:

```rust
    #[test]
    fn asm_answers_hover_at_the_boundary_though_no_editor_mounts_it() {
        // asm has no editor until part 5. This is what makes part 5 inherit a proven language
        // rather than an untested one, and it runs through `handle`'s JSON in and JSON out rather
        // than against the Rust API, because the JSON is the contract the client holds.
        let mut server = LspServer::new();
        server.handle(&json_of("initialize", 1, serde_json::json!({ "capabilities": {} })));
        server.handle(&notification_of(
            "textDocument/didOpen",
            serde_json::json!({ "textDocument": {
                "uri": "redextape:///view/a.asm", "languageId": "redextape_asm", "version": 1,
                "text": "result Nat\nf:\n    li\tr0, #1\n    ret\n" } }),
        ));
        let out = server.handle(&json_of(
            2,
            "textDocument/hover",
            serde_json::json!({ "textDocument": { "uri": "redextape:///view/a.asm" },
                                "position": { "line": 2, "character": 4 } }),
        ));
        assert!(out.contains("immediate"), "hover did not reach asm through the boundary: {out}");
        assert!(out.contains("\"plaintext\""), "a client advertising nothing must get plaintext: {out}");
    }
```

Adapt `json_of`/`notification_of` to whatever the existing tests in that file already use; do not add helpers that duplicate them.

- [ ] **Step 2: Run, then commit**

```bash
cargo test -p redextape-lsp-wasm 2>&1 | tail -10
cargo clippy --all-targets -- -D warnings 2>&1 | tail -5
git add crates/redextape-lsp-wasm/src/
git commit -m "asm hover is proven at the wasm boundary, which is the only place it is reachable until part 5"
```

---

## Task 7: The client's `hover()`

**Files:**
- Modify: `web/src/lsp-protocol.ts`
- Modify: `web/src/lsp-client.ts`
- Create: `web/tests/node/lsp-hover.test.ts`

**Interfaces:**
- Produces: `LspHover = { contents: LspMarkupContent; range?: LspRange }`, `LspMarkupContent = { kind: 'plaintext' | 'markdown'; value: string }`, `LspClient.hover(uri, position): Promise<LspHover | null>`.

- [ ] **Step 1: Add the types**

In `web/src/lsp-protocol.ts`, beside `LspLocation`:

```typescript
/**
 * What the server advertises it can render. The client asks for `plaintext` only, which is what
 * lets this app hold no markdown renderer for a tooltip — see `lsp-client.ts`'s `initialize`.
 */
export type LspMarkupContent = { kind: 'plaintext' | 'markdown'; value: string }

export type LspHover = { contents: LspMarkupContent; range?: LspRange }
```

- [ ] **Step 2: Advertise the content format and add the method**

In `lsp-client.ts`, find where `initialize` is sent (search for `hierarchicalDocumentSymbolSupport`) and add a sibling under `capabilities.textDocument`:

```typescript
        // PLAINTEXT ONLY, DELIBERATELY. The server renders markdown for a client that asks; asking
        // for it here would put a markdown renderer in this app for one tooltip.
        hover: { contentFormat: ['plaintext'] },
```

Then beside `definition`:

```typescript
  /**
   * What the construct under `position` means, or `null`.
   *
   * `null` is the ordinary answer for a cursor on whitespace or a keyword, and for every position in
   * a `.rxlambda` document — λ carries no source spans, so there is nothing to resolve against.
   */
  async hover(uri: string, position: LspPosition): Promise<LspHover | null> {
    const result = await this.#request('textDocument/hover', { textDocument: { uri }, position })
    return (result ?? null) as LspHover | null
  }
```

- [ ] **Step 3: Write the node test**

Create `web/tests/node/lsp-hover.test.ts`, following `web/tests/node/lsp-client.test.ts`'s fake-port harness exactly — read that file first and reuse its helpers rather than writing a second fake port. Cover: a hover request produces the right JSON-RPC method and params; a `null` result resolves to `null` rather than throwing; a result with `contents` resolves to it.

- [ ] **Step 4: Run and commit**

```bash
cd web && pnpm test:node 2>&1 | tail -15 && pnpm typecheck 2>&1 | tail -5
cd .. && git add web/src/lsp-protocol.ts web/src/lsp-client.ts web/tests/node/lsp-hover.test.ts
git commit -m "The client asks for hover in plaintext, so web/ needs no markdown renderer for a tooltip"
```

---

## Task 8: The tooltip and the key

**Files:**
- Create: `web/src/lsp-hover.ts`
- Modify: `web/src/lsp-nav.ts`
- Modify: `web/src/scratch-editor.ts`
- Modify: `web/src/main.ts`

- [ ] **Step 1: Write `lsp-hover.ts`**

```typescript
import { hoverTooltip, type Tooltip } from '@codemirror/view'
import type { LspClient } from './lsp-client'
import type { LspPosition } from './lsp-protocol'

/** What the tooltip needs to ask a question: which document, and of whom. */
export type HoverDeps = {
  readonly uri: () => string | undefined
  readonly client: () => LspClient | undefined
}

/**
 * The hover tooltip, for the pointer.
 *
 * The KEYBOARD path is not here — it is a binding in `lsp-nav.ts` calling `activateHover`, so that
 * both editors get it from the one place both already build their navigation keys.
 *
 * Plaintext, because that is what `lsp-client.ts` advertises: the value goes in as `textContent`,
 * which is also what stops a server answer from being able to inject markup.
 */
export function lspHover(deps: HoverDeps) {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    const uri = deps.uri()
    const client = deps.client()
    if (uri === undefined || client === undefined) return null

    const line = view.state.doc.lineAt(pos)
    const position: LspPosition = { line: line.number - 1, character: pos - line.from }
    const answer = await client.hover(uri, position).catch(() => null)
    if (answer === null) return null

    return {
      pos,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'cm-hover-answer'
        // `textContent`, never `innerHTML`.
        dom.textContent = answer.contents.value
        return { dom }
      },
    }
  })
}
```

- [ ] **Step 2: Add the key to `navKeymap`**

In `web/src/lsp-nav.ts`, import `activateHover` from `@codemirror/view` and add a third binding to the array `navKeymap` returns:

```typescript
    {
      // F2, and the choice was measured on both halves it has. Nothing in the app, CodeMirror or
      // vim swallows it — a probe pressed F1/F2/F4/F8/F9 through `userEvent` and all five reached
      // the editor. The other half a probe CANNOT show: Playwright injects keys through CDP at the
      // renderer, so browser-chrome bindings never apply in a test. F2 is chosen because Chromium
      // binds nothing to it, unlike F1, F3, F5, F6, F7, F10, F11 and F12.
      key: 'F2',
      run: (view) => {
        const head = view.state.selection.main.head
        activateHover(view, head, 1)
        return true
      },
    },
```

Because both editor construction sites already call `keymap.of(navKeymap({...}))`, this one edit reaches both.

- [ ] **Step 3: Install the tooltip at both construction sites**

In `web/src/scratch-editor.ts`'s extension array, beside the spread colour entry:

```typescript
          lspHover({ uri: () => this.#document?.uri, client: () => this.#document?.client }),
```

In `web/src/main.ts`'s `EditorState.create` extension array, beside `colourFor('redextape')`:

```typescript
        lspHover({ uri: () => SOURCE_URI, client: () => lspClient }),
```

Add the import to both files.

- [ ] **Step 4: Style the tooltip**

In `web/src/style.css`, beside the other `cm-` rules, add a `.cm-hover-answer` rule using palette tokens only — **no colour literals**, which the pre-commit gate enforces. `white-space: pre-line` so the answer's line breaks render.

- [ ] **Step 5: Verify and commit**

```bash
cd web && pnpm typecheck 2>&1 | tail -5 && pnpm exec biome ci src 2>&1 | tail -5
cd .. && git add web/src/lsp-hover.ts web/src/lsp-nav.ts web/src/scratch-editor.ts web/src/main.ts web/src/style.css
git commit -m "Hover reaches both editors by pointer and by F2, from the one place both build their keys"
```

---

## Task 9: The browser tests, and λ's sabotage

**Files:**
- Create: `web/tests/browser/lsp-hover.test.ts`

- [ ] **Step 1: Write the test file**

Follow `vim-keymap.test.ts`'s harness, **not** `lsp-navigation.test.ts`'s. Its header must record why:

```typescript
/**
 * **HOVER, THROUGH THE APP** — Plan 7 part 3c, design §8.6 and §11.2.
 *
 * **KEYS ARRIVE THROUGH `userEvent`, NOT A SYNTHETIC `KeyboardEvent`.** `lsp-navigation.test.ts`
 * dispatches its own `KeyboardEvent` and this file deliberately does not copy it: a synthetic event
 * proves the keymap routes a key it was handed, not that the browser delivers one.
 *
 * **WHAT THE F2 CASE CANNOT SHOW.** Playwright injects keys through CDP at the renderer, so
 * browser-chrome bindings never apply here. This asserts nothing in the app stack swallows F2; that
 * Chromium itself binds nothing to it is why F2 was chosen and is not what this test checks.
 */
```

Cover four cases:
1. Pointer hover over a `.rxt` `Nat` literal shows a tooltip containing `0x`.
2. Pointer hover over a TM rule in a TM copy shows one naming the goto target.
3. `F2` at the caret, through `userEvent.keyboard('{F2}')`, opens the same tooltip.
4. λ: hover anywhere in a λ copy shows **no** tooltip.

- [ ] **Step 2: Sabotage-verify the λ case**

§8.7 requires this, and it only discriminates now that three languages answer.

Temporarily change `Language::hover` in `crates/redextape-lsp/src/language.rs` so λ falls through to a language that answers:

```rust
            Language::Lambda => redextape_core::hover::rxt(src, offset),
```

Use a λ fixture that would produce an answer under that fallback — `λx. 42` contains a `Nat` literal, so the source arm answers for it.

```bash
cd web && pnpm build:lsp-wasm && pnpm vitest run --project browser tests/browser/lsp-hover.test.ts 2>&1 | tail -20
```

Expected: **the λ case FAILS.** If it passes, the test is not testing what it claims — fix the test before reverting.

Then revert the sabotage:

```bash
cd .. && git checkout crates/redextape-lsp/src/language.rs && cd web && pnpm build:lsp-wasm
```

Record the sabotage, what it changed and that the test failed, in the roadmap entry (Task 10).

- [ ] **Step 3: Run the browser suite and commit**

```bash
cd web && pnpm test:browser 2>&1 | tail -20
cd .. && git add web/tests/browser/lsp-hover.test.ts
git commit -m "Hover is asserted through the app, and lambda's silence is shown able to fail"
```

---

## Task 10: The roadmap entry and the full gate

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Run every gate, not just `check-all`**

`check-all.sh` is not all of CI. Run each and record the figure each produces:

```bash
bash scripts/check-all.sh 2>&1 | tail -20
bash scripts/check-slow.sh 2>&1 | tail -20
cargo llvm-cov --workspace --summary-only 2>&1 | tail -10   # the 90% floor
cd web && pnpm test && pnpm typecheck && pnpm exec biome ci src && cd ..
docker build -t redextape:3c . && docker run --rm -d -p 8099:80 --name rxt3c redextape:3c
# confirm the app serves, then: docker rm -f rxt3c
```

- [ ] **Step 2: Write the roadmap entry**

Append an entry in this file's established form. Every figure names the command that produced it and is measured **at the branch's last code commit**, not carried from this plan. Include:

- the commit range and count, `git rev-list --count <base>..<head>`
- `git diff --shortstat <base>..<head>`
- the λ sabotage from Task 9: what was changed, and that the test failed
- the pre-flight figures from this plan, re-taken if any code moved them
- the manual visual check across the three presets in light and dark (§11.5 — no pixel baselines)
- the two decisions §8 left open and what they cost

Anchor the entry to a SHA **after** the last code commit, so a later fix round does not stale it.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Roadmap: plan 7 part 3c"
```

- [ ] **Step 4: Open the PR**

Fact-check the body against the tree before opening. Forgejo renders PR bodies with GFM `breaks: true`, so write **one long line per paragraph**, not hard-wrapped text.

---

## Self-review

**Spec coverage.** §8's seven answers: source literal (Task 2), source arity and builtins (Task 3), TM rule and state (Task 4), asm instruction and label (Task 5), λ empty (Tasks 1 and 9). §8.2's placement: Tasks 1–5. §8.3's broken-file property: Task 4's `a_rule_in_a_file_carrying_an_error_still_hovers`. §8.4's drift test: Task 5. §8.6's pointer, key and negotiated markup: Tasks 1, 7, 8. §8.7's two broken tests: Task 1 Step 8. §11.2's rows: Tasks 6 and 9.

**Four defects this plan's own code carried, found by checking the tree rather than by trusting the draft.** Recorded because the same four are what a reviewer of the executed branch would otherwise find:

1. **The AST walk visited three statement kinds of six.** It handled `Let`, `Assign` and `Fn`, and `Stmt` also has `While { cond, body }`, `Expr(Expr)` and `Error`. A literal in a loop condition, a loop body, or a bare expression statement would have answered nothing — and a bare expression statement is the commonest shape a program has. Fixed, the matches are now exhaustive with no `_` arm, and `a_literal_hovers_in_every_construct_that_can_hold_one` is the test that would have caught it.
2. **`Expr::Method { recv, args, .. }` was unwalked**, so a literal in a method call's arguments answered nothing. Now walked.
3. **`Role::Reference` is a struct variant** carrying `def: Option<usize>`, not a unit variant. Task 5's match would not have compiled.
4. **Arity was looked up by name**, which answers the wrong declaration wherever a `fn` name is shadowed. It is now keyed on the definition's `name_span` — the same span `NameIndex` stores — which is exact. `a_shadowed_fn_name_answers_the_declaration_the_cursor_resolves_to` holds it there.

**Both re-export questions are answered, not deferred.** `crates/redextape-core/src/tm.rs` lists each module's public items explicitly; `pub use syntax::{...}` carries `parse_tm_nav` and `pub use asm_syntax::{...}` carries `parse_asm_nav`. Tasks 4 and 5 each name what to add to which line.

**Type consistency.** `HoverAnswer { title, lines, span }` is used identically in Tasks 1–5 and rendered once, in Task 1's `markup`. `walk` is introduced in Task 2 returning `Option<(Span, Lit)>` and widened in Task 3 to a `Walked { literal, fns }` whose second field its own commit reads. `LspHover`/`LspMarkupContent` are declared in Task 7 and consumed in Tasks 8 and 9. `MnemonicDoc { mnemonic, summary, operands }` is declared and consumed in Task 5.

**Still unverified by compilation.** This plan's code has not been built. The shapes it was written against were read at `0bd07c5` and are cited per step; the first task to run `cargo test` is Task 1, and any residue surfaces there rather than in review.
