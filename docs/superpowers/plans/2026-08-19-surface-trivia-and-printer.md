# Surface trivia and the surface printer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the mini-language a printer and give comments and blank lines a representation that survives `print ∘ parse`, so `redextape fmt` is unblocked and `TokenClass::Comment` becomes reachable.

**Architecture:** `lex` stops discarding `//` comments and returns them as a sorted side list. `parse_full` bundles that list with the `Program` and the source in one `Parsed` value. A new `printer.rs` walks the AST in source order holding a cursor into that list, flushing each comment before the node that follows it; blank lines need no records because the printer holds `src` and counts newlines in the original gaps. The AST is untouched.

**Tech Stack:** Rust 2024, `redextape-core` (no new dependencies), `proptest` (existing dev-dependency), `redextape-test-support::arb_expr_over` (existing shared generator), `cargo nextest`.

**Design:** [`../specs/2026-08-18-surface-trivia-and-printer-design.md`](../specs/2026-08-18-surface-trivia-and-printer-design.md).

## Global Constraints

- **Rust edition 2024**; `rustfmt.toml` sets `max_width = 120`, `use_small_heuristics = "Max"`.
- **`cargo clippy --workspace --all-targets -- -D warnings` must pass**, and it runs on every commit via the pre-commit hook. `clippy::pedantic` is on with **no lint allowed globally**, so every `pub fn` returning a value needs `#[must_use]` and every `pub fn` returning `Result` needs an `# Errors` doc section.
- **`[workspace.lints.clippy]` denies `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`** on library paths. `clippy.toml` exempts `#[test]` functions and `#[cfg(test)]` modules only — not free helpers in test targets, which need a per-target `#![allow(...)]`.
- **Coverage floor:** `cargo llvm-cov nextest --workspace --fail-under-lines 90`.
- **No panics on user input.** Malformed source produces spanned `Diagnostic`s.
- **`redextape-core` must build for `wasm32-unknown-unknown`** (`scripts/check-all.sh`'s wasm leg, `--lib`). Nothing in this plan adds a dependency.
- **Never use `--no-verify`.** If a commit split turns out infeasible under the gate, collapse the commits and say so.
- **No attribution lines in commit messages.**
- Full local gate: `scripts/check-all.sh --no-llvm --no-browser` (neither leg is touched by this plan).

## Spec addenda found while planning

Two things the design document does not cover. They are requirements of this plan; fold them back into the spec at the branch's close.

1. **The printer must not recurse on left-nested chains.** `parse_binary_inner` climbs precedence in a `while` loop, so `a + b + c + ...` builds a `Binary` tree as deep as the chain is long **without** the parser recursing — which is why `ast.rs`'s hand-written iterative `Drop` exists, its doc naming "left-nested `Binary`/`Call`/`Method` chains up to ~`MAX_TOKENS`/2 deep" and recording that the compiler-generated recursive destructor aborts the process on them. A recursive printer has that identical defect. Task 4 walks all three left spines iteratively.
2. **The printer must re-add parentheses.** The AST does not store them. Binding powers (`parser.rs:347`) are comparisons 1, `+`/`-` 2, `*` 3, left-associative. Without parenthesization `(1 + 2) * 3` prints as `1 + 2 * 3`, which is a different program — caught by Task 10's semantics property, but it belongs in the printer's design rather than being discovered by a test.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `crates/redextape-core/src/token.rs` | **Modify.** Gains `Comment`, beside `Token` — both are lexer outputs. |
| `crates/redextape-core/src/lexer.rs` | **Modify.** Collects comments instead of discarding them; returns a 3-tuple. |
| `crates/redextape-core/src/parser.rs` | **Modify.** Gains `Parsed` and `parse_full`; `parse` becomes a wrapper and keeps its signature. |
| `crates/redextape-core/src/analysis.rs` | **Modify.** `classify_source` merges comment spans; `class_of` untouched. |
| `crates/redextape-core/src/ast.rs` | **Modify.** Gains `Stmt::span()`, matching the existing `Expr::span()`. |
| `crates/redextape-core/src/printer.rs` | **Create.** The whole printer: layout, width, blank lines, comment flush. |
| `crates/redextape-core/src/lib.rs` | **Modify.** `pub mod printer;` and the `format` entry point. |
| `crates/redextape-core/tests/span_wellformed.rs` | **Modify.** Delete the no-comment corpus restriction and the gap test it guards. |
| `crates/redextape-core/tests/format_properties.rs` | **Create.** The six properties from design §10. |
| `crates/redextape-core/examples/rustfmt_calibration_probe.rs` | **Create.** One-shot calibration against real `rustfmt`. |

---

## Task 1: `Comment` and a lexer that keeps them

**Files:**
- Modify: `crates/redextape-core/src/token.rs`
- Modify: `crates/redextape-core/src/lexer.rs`
- Modify: `crates/redextape-core/src/parser.rs` (one line — the `lex` call site)
- Modify: `crates/redextape-core/src/analysis.rs` (one line — the `lex` call site)
- Test: inline `#[cfg(test)] mod tests` in `crates/redextape-core/src/lexer.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `token::Comment { span: Span, own_line: bool }` (derives `Clone, Copy, Debug, PartialEq, Eq`); `lexer::lex(src: &str) -> (Vec<Token>, Vec<Comment>, Vec<Diagnostic>)`.

- [ ] **Step 1: Write the failing tests**

Add to the `mod tests` block at the bottom of `crates/redextape-core/src/lexer.rs`:

```rust
    #[test]
    fn comments_are_collected_with_their_spans_and_text() {
        let src = "1 // a comment\n2";
        let (toks, comments, diags) = lex(src);
        assert!(diags.is_empty(), "unexpected diagnostics: {diags:?}");
        assert_eq!(toks.iter().map(|t| t.kind).collect::<Vec<_>>(), vec![
            TokenKind::Nat(1),
            TokenKind::Nat(2),
            TokenKind::Eof,
        ]);
        assert_eq!(comments.len(), 1);
        assert_eq!(&src[comments[0].span.start..comments[0].span.end], "// a comment");
    }

    #[test]
    fn own_line_is_true_only_when_nothing_but_whitespace_precedes_on_the_line() {
        let (_, comments, _) = lex("1 // trailing\n  // leading\n2");
        assert_eq!(comments.len(), 2);
        assert!(!comments[0].own_line, "a comment after code on the same line is trailing");
        assert!(comments[1].own_line, "a comment with only whitespace before it owns its line");
    }

    #[test]
    fn a_comment_at_the_very_start_of_input_owns_its_line() {
        let (_, comments, _) = lex("// first thing\n1");
        assert_eq!(comments.len(), 1);
        assert!(comments[0].own_line);
    }

    #[test]
    fn a_comment_with_no_trailing_newline_ends_at_end_of_input() {
        let src = "1 // to the end";
        let (_, comments, _) = lex(src);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].span.end, src.len());
        assert_eq!(&src[comments[0].span.start..comments[0].span.end], "// to the end");
    }

    #[test]
    fn a_crlf_line_ending_leaves_the_carriage_return_inside_the_span() {
        // The span stops at `\n`, so a `\r` before it is inside the comment text. The printer trims
        // trailing whitespace (design §3), which is where that is handled — recorded here so the
        // trimming has a reason rather than looking defensive.
        let src = "1 // note\r\n2";
        let (_, comments, _) = lex(src);
        assert_eq!(&src[comments[0].span.start..comments[0].span.end], "// note\r");
    }

    #[test]
    fn a_bare_double_slash_is_still_a_comment() {
        let src = "1 //\n2";
        let (_, comments, _) = lex(src);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].span.end - comments[0].span.start, 2);
    }
```

Also update the existing helper in that same `mod tests`, which destructures a 2-tuple:

```rust
    fn kinds(src: &str) -> Vec<TokenKind> {
        let (toks, _comments, diags) = lex(src);
        assert!(diags.is_empty(), "unexpected diagnostics: {diags:?}");
        toks.into_iter().map(|t| t.kind).collect()
    }
```

And the two other existing tests in that module that destructure `lex`:

```rust
    #[test]
    fn ident_text_is_recovered_by_span() {
        let src = "count_down";
        let (toks, _, _) = lex(src);
        assert_eq!(toks[0].kind, TokenKind::Ident);
        assert_eq!(&src[toks[0].span.start..toks[0].span.end], "count_down");
    }
```

```rust
    #[test]
    fn unknown_char_becomes_a_diagnostic_and_is_skipped() {
        let (toks, _, diags) = lex("1 $ 2");
        assert_eq!(diags.len(), 1);
        assert_eq!(&"1 $ 2"[diags[0].span.start..diags[0].span.end], "$");
        assert_eq!(toks.iter().map(|t| t.kind).collect::<Vec<_>>(), vec![
            TokenKind::Nat(1),
            TokenKind::Nat(2),
            TokenKind::Eof,
        ]);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo nextest run -p redextape-core --lib lexer`

Expected: FAIL to compile — `cannot find type Comment in this scope`, and `expected a tuple with 2 elements, found one with 3`.

- [ ] **Step 3: Add `Comment` to `token.rs`**

Append to `crates/redextape-core/src/token.rs`, after the `Token` struct:

```rust
/// A `//` line comment the lexer kept instead of discarding. The TEXT is not stored —
/// `src[span.start..span.end]` recovers it, for the same reason `TokenKind` is `Copy` and identifier
/// spelling is recovered by span rather than held.
///
/// The span covers `//` through the last byte before the newline, so a CRLF line ending leaves the
/// `\r` inside it; the printer trims trailing whitespace.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Comment {
    pub span: Span,
    /// True when only whitespace separates this comment from the previous newline (or the start of
    /// input). Decided HERE, where the backward scan is already in reach, rather than recomputed by
    /// the printer — two places deciding what "own line" means is one place too many, and only one of
    /// them would be tested.
    pub own_line: bool,
}
```

- [ ] **Step 4: Collect comments in `lex`**

In `crates/redextape-core/src/lexer.rs`, change the import line:

```rust
use crate::token::{Comment, Token, TokenKind};
```

Change the signature and add the accumulator:

```rust
#[must_use]
pub fn lex(src: &str) -> (Vec<Token>, Vec<Comment>, Vec<Diagnostic>) {
    let mut toks = Vec::new();
    let mut comments = Vec::new();
    let mut diags = Vec::new();
```

Replace the `// Line comments.` arm:

```rust
        // Line comments. Kept rather than skipped: a `print ∘ parse` formatter over an AST that never
        // saw them would delete every comment in the file.
        if c == b'/' && bytes.get(i + 1) == Some(&b'/') {
            let start = i;
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            comments.push(Comment { span: Span::new(start, i), own_line: own_line_at(bytes, start) });
            continue;
        }
```

Change the final return:

```rust
    toks.push(Token { kind: TokenKind::Eof, span: Span::new(src.len(), src.len()) });
    (toks, comments, diags)
}

/// True when only whitespace separates `start` from the previous newline, or from the start of input.
/// Byte-wise and backwards from `start`, so it costs the length of one line at most.
fn own_line_at(bytes: &[u8], start: usize) -> bool {
    let mut j = start;
    while j > 0 {
        j -= 1;
        if bytes[j] == b'\n' {
            return true;
        }
        if !bytes[j].is_ascii_whitespace() {
            return false;
        }
    }
    true
}
```

Update the module doc's first line, which currently claims comments are skipped:

```rust
//! Hand-written lexer. Skips whitespace and COLLECTS `//` line comments; recognizes keywords, `Nat`
//! literals, identifiers, the v1 operator set, and delimiters. Unknown characters become a
//! `Diagnostic` and are skipped (no token emitted).
```

- [ ] **Step 5: Update the two call sites**

`crates/redextape-core/src/parser.rs`, in `parse`:

```rust
    let (tokens, _comments, mut diags) = lex(src);
```

`crates/redextape-core/src/analysis.rs`, in `classify_source`:

```rust
    let (tokens, _comments, _diagnostics) = lex(src);
```

`crates/redextape-core/examples/state_cost_probe.rs` needs no change — it uses `.0.len()`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo nextest run -p redextape-core`

Expected: PASS, whole crate. Every existing test still green — no printed byte and no token stream has changed.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/token.rs crates/redextape-core/src/lexer.rs \
        crates/redextape-core/src/parser.rs crates/redextape-core/src/analysis.rs
git commit -F - <<'MSG'
lexer: keep `//` comments instead of discarding them

`lex` returns a sorted `Vec<Comment>` beside its tokens. `own_line` is decided
here, where the backward scan to the previous newline is already in reach.
MSG
```

---

## Task 2: `Parsed` and `parse_full`

**Files:**
- Modify: `crates/redextape-core/src/parser.rs`
- Test: inline `#[cfg(test)] mod tests` in `crates/redextape-core/src/parser.rs`

**Interfaces:**
- Consumes: `token::Comment`, `lexer::lex` (Task 1).
- Produces: `parser::Parsed<'a> { program: Program, comments: Vec<Comment>, src: &'a str }`; `parser::parse_full(src: &str) -> (Option<Parsed<'_>>, Vec<Diagnostic>)`. `parser::parse` keeps its existing signature `(Option<Program>, Vec<Diagnostic>)`.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `crates/redextape-core/src/parser.rs`:

```rust
    #[test]
    fn parse_full_returns_the_comments_beside_the_program() {
        let src = "// lead\nlet x = 1; // trail\nx";
        let (parsed, diags) = parse_full(src);
        assert!(diags.is_empty(), "unexpected diagnostics: {diags:?}");
        let parsed = parsed.expect("a clean program parses");
        assert_eq!(parsed.src, src);
        let texts: Vec<&str> = parsed.comments.iter().map(|c| &src[c.span.start..c.span.end]).collect();
        assert_eq!(texts, vec!["// lead", "// trail"]);
        assert_eq!(parsed.program.block.stmts.len(), 1);
    }

    #[test]
    fn parse_full_yields_none_and_diagnostics_on_malformed_input() {
        let (parsed, diags) = parse_full("let x = ;");
        assert!(parsed.is_none(), "a program that does not parse yields no Parsed");
        assert!(!diags.is_empty(), "and says why");
    }

    #[test]
    fn parse_is_unchanged_and_still_returns_a_two_tuple() {
        let (program, diags) = parse("let x = 1; x");
        assert!(diags.is_empty());
        assert!(program.is_some());
    }

    #[test]
    fn comments_are_sorted_by_start_offset() {
        let src = "// a\nlet x = 1; // b\n// c\nx";
        let (parsed, _) = parse_full(src);
        let parsed = parsed.expect("parses");
        assert!(
            parsed.comments.windows(2).all(|w| w[0].span.start < w[1].span.start),
            "the printer's cursor walks this list once, forwards"
        );
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo nextest run -p redextape-core --lib parser`

Expected: FAIL to compile — `cannot find function parse_full in this scope`.

- [ ] **Step 3: Add `Parsed` and `parse_full`**

In `crates/redextape-core/src/parser.rs`, change the import line:

```rust
use crate::token::{Comment, Token, TokenKind};
```

Replace the existing `parse` function with the three items below (`parse` keeps its exact signature and becomes a wrapper):

```rust
/// A parse and everything needed to print it back: the tree, its trivia, and the string both are
/// measured against.
///
/// THE THREE TRAVEL TOGETHER BECAUSE A MISMATCH AMONG THEM IS SILENT. Comments carry byte offsets;
/// resolving them against a different string yields text from the wrong place with no error and no
/// empty result. `analysis::attribute_tm_spans` records the same failure from the version that took a
/// map and a machine as two arguments — it "could not check they described one lowering", and
/// resolved every id to some other state's name. One value makes that unrepresentable.
#[derive(Debug)]
pub struct Parsed<'a> {
    pub program: Program,
    pub comments: Vec<Comment>,
    pub src: &'a str,
}

/// Parse `src`, keeping its trivia. `Some` only when the entire input parsed.
///
/// `comments` is sorted by start offset and no comment overlaps a token, which is what lets the
/// printer walk it with a single forward cursor.
#[must_use]
pub fn parse_full(src: &str) -> (Option<Parsed<'_>>, Vec<Diagnostic>) {
    let (tokens, comments, mut diags) = lex(src);
    if !diags.is_empty() {
        return (None, diags);
    }
    if tokens.len() > MAX_TOKENS {
        diags.push(Diagnostic::error(
            Span::new(0, src.len()),
            format!("program too large: {} tokens exceeds the maximum of {MAX_TOKENS} (deeply nested or very long programs are rejected to avoid stack overflow)", tokens.len()),
        ));
        return (None, diags);
    }
    let mut p = Parser { src, tokens, pos: 0, depth: 0 };
    match p.parse_program() {
        Ok(program) => (Some(Parsed { program, comments, src }), diags),
        Err(diag) => {
            diags.push(diag);
            (None, diags)
        }
    }
}

/// Parse `src`, discarding trivia. The entry point for every consumer that wants a tree and nothing
/// else — roughly 25 call sites across this workspace, none of which formats anything.
#[must_use]
pub fn parse(src: &str) -> (Option<Program>, Vec<Diagnostic>) {
    let (parsed, diags) = parse_full(src);
    (parsed.map(|p| p.program), diags)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo nextest run -p redextape-core && cargo nextest run -p redextape-native`

Expected: PASS both. `redextape-native` has many `parse(src).0.unwrap()` call sites and none of them changes.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/parser.rs
git commit -F - <<'MSG'
parser: add `parse_full` and `Parsed`, leaving `parse` alone

`Parsed` bundles the tree, its comments and the source they index into, so a
comment list cannot be resolved against the wrong string. `parse` keeps its
signature and becomes a wrapper — its ~25 call sites are untouched.
MSG
```

---

## Task 3: `classify_source` emits `Comment`

This is the deliverable the web highlighter has been waiting on, and it stands on its own without any printer.

**Files:**
- Modify: `crates/redextape-core/src/analysis.rs`
- Modify: `crates/redextape-core/tests/span_wellformed.rs`
- Test: inline `#[cfg(test)] mod tests` in `crates/redextape-core/src/analysis.rs`, plus the corpus change

**Interfaces:**
- Consumes: `lexer::lex`'s comment list (Task 1).
- Produces: `analysis::classify_source` now yields `(Span, TokenClass::Comment)` entries, sorted with the tokens by start offset. Signature unchanged: `classify_source(src: &str) -> Classified`.

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `crates/redextape-core/src/analysis.rs`:

```rust
    #[test]
    fn classify_source_emits_comment_spans_in_offset_order() {
        let src = "1 + // why\n2 // and again";
        let got = classify_source(src);
        let slice = |s: Span| &src[s.start..s.end];
        let pairs: Vec<(&str, TokenClass)> = got.iter().map(|(s, c)| (slice(*s), *c)).collect();
        assert_eq!(pairs, vec![
            ("1", TokenClass::Nat),
            ("+", TokenClass::Operator),
            ("// why", TokenClass::Comment),
            ("2", TokenClass::Nat),
            ("// and again", TokenClass::Comment),
        ]);
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
```

**Why the count assertion is not padding.** The ordering assertion alone cannot fail against the pre-merge implementation: the tokens are already mutually non-overlapping and in lex order, so a regression that dropped every comment span would leave it green. It still earns its place — an `extend` without the `sort_by_key` appends the leading comment after the tokens and breaks the ordering — but the count is what makes it a test of the merge rather than a test of the lexer.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo nextest run -p redextape-core --lib analysis`

Expected: FAIL — `assertion \`left == right\` failed`, with the comment entries missing from `left`.

- [ ] **Step 3: Merge the comment spans**

In `crates/redextape-core/src/analysis.rs`, replace the body of `classify_source`:

```rust
#[must_use]
pub fn classify_source(src: &str) -> Classified {
    let (tokens, comments, _diagnostics) = lex(src);
    let mut out: Classified = tokens
        .iter()
        .filter(|t| t.kind != TokenKind::Eof)
        .map(|t| (t.span, class_of(t.kind)))
        .collect();
    // A MERGE, NOT A RECONCILIATION. A comment can never overlap a token — the lexer consumes it whole
    // before emitting anything else — so ordering the union by start offset is the entire operation,
    // and `class_of` stays the exhaustive match it was. `TokenClass::Comment` was declared and
    // unreachable until this line.
    out.extend(comments.iter().map(|c| (c.span, TokenClass::Comment)));
    out.sort_by_key(|(s, _)| s.start);
    out
}
```

Add the import for `Comment` only if the compiler asks — the code above names no comment type directly.

- [ ] **Step 4: Run the test to verify it passes, and watch the deferred test go red**

Run: `cargo nextest run -p redextape-core`

Expected: the two new `analysis` tests PASS, and `span_wellformed::source_with_a_comment_is_the_one_gap_this_corpus_avoids` FAILS. That failure is the intended signal — the test was written to fire exactly here, and its own doc says "THIS TEST WILL FAIL, and the fix is to delete it and add a commented program to `CORPUS`."

- [ ] **Step 5: Discharge the deferred test**

In `crates/redextape-core/tests/span_wellformed.rs`, delete the whole `source_with_a_comment_is_the_one_gap_this_corpus_avoids` test together with its doc comment.

Replace the `CORPUS` doc comment — the first paragraph, which states the now-retired restriction — with:

```rust
/// COMMENTS ARE IN THE CORPUS AS OF THE TRIVIA SLICE, AND THAT IS THE POINT. `lexer.rs` used to
/// discard `//` comments, so `classify_source` emitted nothing over their bytes — a real,
/// non-whitespace hole in the coverage assertion in `check`, which this corpus avoided on purpose and
/// `source_with_a_comment_is_the_one_gap_this_corpus_avoids` stated outright. `lex` now returns them
/// and `classify_source` classifies them, so the last entry below exercises the property that was
/// previously excluded from it. The printed forms are unaffected: no printer emits a comment.
/// THE `if` IS NOT DECORATION. The four straight-line programs lower to assembly with NO LABELS, so the
/// coverage assertion could not see the label `:` at all: deleting its classification left this whole
/// file green, which is how it was measured. A branch is the smallest program that emits one.
const CORPUS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "let x = 1; let y = x + x; y * 3",
    "[1, 2, 3]",
    "if 2 > 1 { 10 } else { 20 }",
    "// leading\nlet x = 1; // trailing\nx + 1",
];
```

- [ ] **Step 6: Run the whole suite**

Run: `cargo nextest run -p redextape-core`

Expected: PASS. Note that `CORPUS` grew by one, and `span_wellformed`'s `assert_eq!(checked, CORPUS.len() * 5, ...)` scales automatically — no count to update by hand.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/analysis.rs crates/redextape-core/tests/span_wellformed.rs
git commit -F - <<'MSG'
analysis: `TokenClass::Comment` becomes reachable

`classify_source` merges the lexer's comment spans into its output. The class was
declared, indexed and unreachable; `class_of` is untouched.

Discharges `source_with_a_comment_is_the_one_gap_this_corpus_avoids`, which was
written to fail at exactly this change, and puts a commented program in the
span-coverage corpus for the first time.
MSG
```

---

## Task 4: The printer — expressions

**Files:**
- Create: `crates/redextape-core/src/printer.rs`
- Modify: `crates/redextape-core/src/lib.rs` (add `pub mod printer;`)
- Test: inline `#[cfg(test)] mod tests` in `crates/redextape-core/src/printer.rs`

**Interfaces:**
- Consumes: `ast::{BinOp, Block, Expr, Program, Stmt}`.
- Produces: `printer::MAX_WIDTH: usize` (120); private `Printer` with `fn expr(&mut self, e: &Expr)`, `fn expr_prec(&mut self, e: &Expr, min_bp: u8)`, `fn col(&self) -> usize`, `fn newline(&mut self)`, `fn indent(&mut self)`. Task 5 adds statements and the public entry point; nothing outside this module is public yet except `MAX_WIDTH`.

**Note on blocks:** `Expr::Block` and `Expr::If` need `Block` printing, which Task 5 owns. This task stubs neither — it implements `braced` because an `if` expression is an expression. `Stmt` printing is Task 5.

- [ ] **Step 1: Write the failing tests**

Create `crates/redextape-core/src/printer.rs` containing ONLY the test module for now, so the failure is a missing implementation rather than a missing file:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse;

    /// Print the tail expression of a one-expression program. The printer's public entry point
    /// arrives in Task 5; until then this drives `Printer` directly.
    fn p(src: &str) -> String {
        let (program, diags) = parse(src);
        assert!(diags.is_empty(), "test input must parse: {diags:?}");
        let program = program.expect("parses");
        let tail = program.block.tail.as_ref().expect("test inputs are a single tail expression");
        let mut pr = Printer::new();
        pr.expr(tail);
        pr.out
    }

    #[test]
    fn prints_leaves() {
        assert_eq!(p("42"), "42");
        assert_eq!(p("true"), "true");
        assert_eq!(p("false"), "false");
        assert_eq!(p("some_name"), "some_name");
    }

    #[test]
    fn prints_binary_with_spaces_and_no_redundant_parens() {
        assert_eq!(p("1+2"), "1 + 2");
        assert_eq!(p("1 + 2 * 3"), "1 + 2 * 3");
        assert_eq!(p("1 - 2 - 3"), "1 - 2 - 3");
        assert_eq!(p("1 == 2"), "1 == 2");
    }

    #[test]
    fn re_adds_the_parens_the_ast_does_not_store() {
        assert_eq!(p("(1 + 2) * 3"), "(1 + 2) * 3");
        assert_eq!(p("1 * (2 + 3)"), "1 * (2 + 3)");
        // Left-associative, so the right operand of a same-precedence op needs parens and the left
        // does not.
        assert_eq!(p("1 - (2 - 3)"), "1 - (2 - 3)");
        assert_eq!(p("(1 - 2) - 3"), "1 - 2 - 3");
    }

    #[test]
    fn prints_lists_calls_methods_and_lambdas() {
        assert_eq!(p("[1, 2, 3]"), "[1, 2, 3]");
        assert_eq!(p("[]"), "[]");
        assert_eq!(p("f(1, 2)"), "f(1, 2)");
        assert_eq!(p("f()"), "f()");
        assert_eq!(p("xs.map(|x| x + 1)"), "xs.map(|x| x + 1)");
        assert_eq!(p("|x, y| x + y"), "|x, y| x + y");
        assert_eq!(p("|| 1"), "|| 1");
    }

    #[test]
    fn a_lambda_used_as_an_operand_or_a_callee_is_parenthesised() {
        // A lambda body is greedy, so `(|x| x) + 1` would re-parse as `|x| (x + 1)` without parens.
        assert_eq!(p("(|x| x) + 1"), "(|x| x) + 1");
        assert_eq!(p("(|x| x)(1)"), "(|x| x)(1)");
    }

    #[test]
    fn prints_if_as_an_expression() {
        assert_eq!(p("if a > b { 1 } else { 2 }"), "if a > b {\n    1\n} else {\n    2\n}");
    }

    #[test]
    fn collapses_a_nested_else_into_else_if() {
        assert_eq!(
            p("if a { 1 } else { if b { 2 } else { 3 } }"),
            "if a {\n    1\n} else if b {\n    2\n} else {\n    3\n}"
        );
    }

    #[test]
    fn a_long_left_nested_chain_does_not_overflow_the_stack() {
        // `parse_binary_inner` climbs precedence in a LOOP, so this builds a `Binary` tree 20,000
        // deep while the parser's own recursion depth stays at one. `ast.rs`'s hand-written iterative
        // `Drop` exists for exactly this shape and records that the recursive version aborts the
        // process. A recursive printer has the identical defect, so this test is the guard on it.
        let src = std::iter::repeat_n("1", 20_000).collect::<Vec<_>>().join(" + ");
        let out = p(&src);
        assert_eq!(out, src);
    }

    #[test]
    fn a_long_postfix_chain_does_not_overflow_the_stack() {
        let src = format!("x{}", ".f()".repeat(20_000));
        let out = p(&src);
        assert_eq!(out, src);
    }

    #[test]
    fn the_visit_order_is_non_decreasing_in_span_start() {
        // The load-bearing assumption of the whole trivia design (spec §4): a single forward cursor
        // into a sorted comment list is only correct while the printer visits nodes in source order.
        let (program, _) = parse("f(a + b, [1, 2]).g(|x| x * 2)");
        let program = program.expect("parses");
        let mut pr = Printer::new();
        pr.expr(program.block.tail.as_ref().expect("tail"));
        assert!(
            pr.visited.windows(2).all(|w| w[0].start <= w[1].start),
            "visit order went backwards: {:?}",
            pr.visited
        );
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo nextest run -p redextape-core --lib printer`

Expected: FAIL — the module is not declared in `lib.rs`, so nothing runs. Add `pub mod printer;` to `crates/redextape-core/src/lib.rs` in alphabetical position — **after `pub mod prelude;`**, since `prelude` sorts before `printer` (`pre` < `pri`) — re-run, and the failure becomes `cannot find type Printer in this scope`.

**Two lint suppressions are needed for this task and must not outlive it.** `Printer` has no non-test caller until Task 5's `pub fn print` lands, so a non-test build sees the whole type as unused:

```rust
// TEMPORARY, AND TASK 5 DELETES IT. `Printer` has no caller outside `#[cfg(test)]` until
// `pub fn print` lands in the next task, so a non-test build flags every method. A module-wide
// allow is a blunt instrument and this project allows no lint globally — it exists for exactly
// one task and its removal is a step of the next one.
#![allow(dead_code)]
```

and on `visit`, whose body is entirely `#[cfg(test)]` so the non-test build sees a method that ignores `self`:

```rust
    #[allow(clippy::unused_self)]
    fn visit(&mut self, span: Span) {
```

- [ ] **Step 3: Write the printer**

Prepend to `crates/redextape-core/src/printer.rs`, above the test module:

```rust
//! Printer for the mini-language: a parsed program plus its trivia back to canonical text.
//!
//! `redextape fmt` is exactly `print ∘ parse` (spec §7.2), so EVERY line break below is this module's
//! choice and none of it is recovered from the author's layout. That is what makes comment placement
//! a decision rather than bookkeeping.
//!
//! TWO SHAPES THE AST DOES NOT CARRY, both re-derived here:
//!
//!   * **Parentheses.** `(1 + 2) * 3` and `1 + 2 * 3` are different trees and the same token set minus
//!     two bytes. `expr_prec` re-adds exactly the parens the binding powers require.
//!   * **Nothing about the left spine's depth.** `parse_binary_inner` climbs precedence in a loop, so
//!     `a + b + c + …` nests as deep as the chain is long while the parser recurses once. `ast.rs`'s
//!     hand-written iterative `Drop` exists for that shape and records that the recursive version
//!     aborts the process; a recursive printer would abort on the same input. `binary_chain` and
//!     `postfix_chain` walk their spines iteratively. Everything else recurses, bounded by the
//!     parser's own `MAX_PARSE_DEPTH`.

use crate::ast::{BinOp, Block, Expr};
use crate::span::Span;

/// Column budget, matching this repo's `rustfmt.toml` `max_width`.
pub const MAX_WIDTH: usize = 120;

/// Spaces per nesting level — rustfmt's default `tab_spaces`.
const INDENT: usize = 4;

/// Binding power of an expression in operand position: the operator's own for a `Binary`, zero for a
/// `Lambda` (its body is greedy, so it always parenthesises inside an operator), and above every
/// operator for anything else.
const ATOM_BP: u8 = 4;

struct Printer {
    out: String,
    /// Byte index in `out` at which the current line starts. The column is `out.len() - line_start`.
    line_start: usize,
    /// Nesting level, in units of `INDENT`.
    level: usize,
    /// Node spans in visit order. Test-only: the whole trivia design rests on this sequence being
    /// non-decreasing, and a field is how that gets asserted without a second traversal to disagree
    /// with the first.
    #[cfg(test)]
    visited: Vec<Span>,
}

impl Printer {
    fn new() -> Self {
        Printer {
            out: String::new(),
            line_start: 0,
            level: 0,
            #[cfg(test)]
            visited: Vec::new(),
        }
    }

    fn col(&self) -> usize {
        self.out.len() - self.line_start
    }

    fn newline(&mut self) {
        self.out.push('\n');
        self.line_start = self.out.len();
    }

    fn indent(&mut self) {
        for _ in 0..self.level * INDENT {
            self.out.push(' ');
        }
    }

    /// Record that a node is being visited. The body is test-only; the call sites are not, so the
    /// visit order asserted by the tests is the order production printing actually uses.
    fn visit(&mut self, span: Span) {
        #[cfg(test)]
        self.visited.push(span);
        let _ = span;
    }

    fn expr(&mut self, e: &Expr) {
        self.expr_prec(e, 0);
    }

    /// Print `e`, wrapping it in parens when its binding power is below `min_bp`.
    fn expr_prec(&mut self, e: &Expr, min_bp: u8) {
        if bp_of(e) < min_bp {
            self.out.push('(');
            self.expr_prec(e, 0);
            self.out.push(')');
            return;
        }
        self.visit(e.span());
        match e {
            Expr::Nat { value, .. } => self.out.push_str(&value.to_string()),
            Expr::Bool { value, .. } => self.out.push_str(if *value { "true" } else { "false" }),
            Expr::Var { name, .. } => self.out.push_str(name),
            Expr::Binary { .. } => self.binary_chain(e),
            Expr::List { items, .. } => self.list(items),
            Expr::Lambda { params, body, .. } => {
                self.out.push('|');
                self.out.push_str(&params.join(", "));
                self.out.push_str("| ");
                self.expr_prec(body, 0);
            }
            Expr::Call { .. } | Expr::Method { .. } => self.postfix_chain(e),
            Expr::Block { block, .. } => self.braced(block),
            Expr::If { cond, then_blk, else_blk, .. } => self.if_chain(cond, then_blk, else_blk),
        }
    }

    /// A left-nested `Binary` run at one precedence level, printed without recursing down the spine.
    ///
    /// The spine is collected only while the left child's binding power is at least the parent's —
    /// which is exactly when no parens are needed — so a precedence drop ends the run and recurses
    /// once. There are three precedence levels, so that recursion is bounded by three, not by the
    /// chain's length.
    fn binary_chain(&mut self, e: &Expr) {
        let Expr::Binary { op, .. } = e else { return };
        let bp = bp_of_op(*op);
        let mut spine: Vec<(BinOp, &Expr)> = Vec::new();
        let mut cur = e;
        while let Expr::Binary { op: o, lhs, rhs, .. } = cur {
            if bp_of_op(*o) != bp {
                break;
            }
            spine.push((*o, rhs.as_ref()));
            cur = lhs.as_ref();
        }
        spine.reverse();
        // `cur` is the leftmost operand of the run. Left-associative: the left side accepts equal
        // binding power, the right side does not.
        self.expr_prec(cur, bp);
        for (o, rhs) in spine {
            self.out.push(' ');
            self.out.push_str(op_text(o));
            self.out.push(' ');
            self.expr_prec(rhs, bp + 1);
        }
    }

    /// A left-nested run of calls and method calls, printed without recursing down the spine.
    fn postfix_chain(&mut self, e: &Expr) {
        enum Link<'a> {
            Call(&'a [Expr]),
            Method(&'a str, &'a [Expr]),
        }
        let mut links: Vec<Link<'_>> = Vec::new();
        let mut cur = e;
        loop {
            match cur {
                Expr::Call { callee, args, .. } => {
                    links.push(Link::Call(args));
                    cur = callee.as_ref();
                }
                Expr::Method { recv, name, args, .. } => {
                    links.push(Link::Method(name, args));
                    cur = recv.as_ref();
                }
                _ => break,
            }
        }
        links.reverse();
        // A `Binary` or `Lambda` base would re-parse as something else without parens: `|x| x (1)`
        // reads the call as part of the lambda body.
        self.expr_prec(cur, ATOM_BP);
        for link in links {
            match link {
                Link::Call(args) => self.args(args),
                Link::Method(name, args) => {
                    self.out.push('.');
                    self.out.push_str(name);
                    self.args(args);
                }
            }
        }
    }

    /// `[a, b, c]`, always on one line. Task 6 adds the width and comment rules that break it.
    fn list(&mut self, items: &[Expr]) {
        self.out.push('[');
        for (i, item) in items.iter().enumerate() {
            if i > 0 {
                self.out.push_str(", ");
            }
            self.expr_prec(item, 0);
        }
        self.out.push(']');
    }

    /// `(a, b, c)`, always on one line. Task 6 adds the width and comment rules that break it.
    fn args(&mut self, args: &[Expr]) {
        self.out.push('(');
        for (i, a) in args.iter().enumerate() {
            if i > 0 {
                self.out.push_str(", ");
            }
            self.expr_prec(a, 0);
        }
        self.out.push(')');
    }

    /// `{` on the current line, body indented, `}` at the introducer's indent. Leaves the cursor
    /// immediately after `}` so `} else {` can continue on the same line.
    fn braced(&mut self, block: &Block) {
        self.out.push('{');
        self.level += 1;
        self.block_body(block);
        self.level -= 1;
        self.newline();
        self.indent();
        self.out.push('}');
    }

    fn if_chain(&mut self, cond: &Expr, then_blk: &Block, else_blk: &Block) {
        self.out.push_str("if ");
        self.expr_prec(cond, 0);
        self.out.push(' ');
        self.braced(then_blk);
        self.out.push_str(" else ");
        // `else { if c { … } else { … } }` and `else if c { … } else { … }` are the same tree, and
        // rustfmt prints the collapsed form. A block with no statements and an `If` tail is the shape.
        if let (true, Some(tail)) = (else_blk.stmts.is_empty(), else_blk.tail.as_deref())
            && let Expr::If { cond, then_blk, else_blk, .. } = tail
        {
            self.if_chain(cond, then_blk, else_blk);
        } else {
            self.braced(else_blk);
        }
    }
}

fn bp_of(e: &Expr) -> u8 {
    match e {
        Expr::Binary { op, .. } => bp_of_op(*op),
        // A lambda body runs as far as it can, so a lambda in operand position always parenthesises.
        Expr::Lambda { .. } => 0,
        _ => ATOM_BP,
    }
}

/// Mirrors `parser::infix_op`'s binding powers. The two tables are pinned against each other by
/// `binding_powers_match_the_parser` below, because a printer that disagrees with its parser about
/// precedence emits programs that mean something else.
fn bp_of_op(op: BinOp) -> u8 {
    match op {
        BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => 1,
        BinOp::Add | BinOp::Sub => 2,
        BinOp::Mul => 3,
    }
}

fn op_text(op: BinOp) -> &'static str {
    match op {
        BinOp::Add => "+",
        BinOp::Sub => "-",
        BinOp::Mul => "*",
        BinOp::Eq => "==",
        BinOp::Ne => "!=",
        BinOp::Lt => "<",
        BinOp::Le => "<=",
        BinOp::Gt => ">",
        BinOp::Ge => ">=",
    }
}
```

`block_body` is Task 5's. To keep this task compiling and testable on its own, add this placeholder — Task 5 replaces it:

```rust
impl Printer {
    /// Statements and tail of a block. Task 5 fills this in; a block with only a tail is enough for
    /// this task's `if` tests.
    fn block_body(&mut self, block: &Block) {
        if let Some(tail) = block.tail.as_deref() {
            self.newline();
            self.indent();
            self.expr_prec(tail, 0);
        }
    }
}
```

- [ ] **Step 4: Add the parser-agreement test**

Append inside `mod tests`:

```rust
    #[test]
    fn binding_powers_match_the_parser() {
        // Enumerated rather than derived: `parser::infix_op` maps TOKENS to (op, bp) and is private
        // to that module, so the only mechanical link available is this table, checked by parsing.
        // Each case is a program whose tree depends on the two tables agreeing.
        for (src, expected) in [
            ("1 + 2 * 3", "1 + 2 * 3"),
            ("1 * 2 + 3", "1 * 2 + 3"),
            ("(1 + 2) * 3", "(1 + 2) * 3"),
            ("1 == 2 + 3", "1 == 2 + 3"),
            ("(1 == 2) == 3", "1 == 2 == 3"),
            ("1 == (2 == 3)", "1 == (2 == 3)"),
        ] {
            assert_eq!(p(src), expected, "for {src:?}");
        }
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo nextest run -p redextape-core --lib printer`

Expected: PASS, all twelve.

- [ ] **Step 6: Check the stack-safety tests actually ran under a normal stack**

Run: `cargo nextest run -p redextape-core --lib printer stack`

Expected: PASS. If either overflows, the spine walk is still recursing somewhere — the `Vec` collection in `binary_chain`/`postfix_chain` is what must not be bypassed.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/printer.rs crates/redextape-core/src/lib.rs
git commit -F - <<'MSG'
printer: expressions, with parens and iterative left spines

The AST stores neither parentheses nor any bound on left-spine depth. `expr_prec`
re-adds exactly the parens the binding powers require; `binary_chain` and
`postfix_chain` walk their spines with an explicit worklist, because the parser
builds those iteratively and a recursive printer aborts the process on a
20,000-term chain — the same defect `ast.rs`'s hand-written `Drop` exists to avoid.
MSG
```

---

## Task 5: The printer — statements, blocks, and the entry point

**Files:**
- Modify: `crates/redextape-core/src/ast.rs` (add `Stmt::span()`)
- Modify: `crates/redextape-core/src/printer.rs`
- Test: inline `#[cfg(test)] mod tests` in both files

**Interfaces:**
- Consumes: Task 4's `Printer`; `parser::Parsed` (Task 2).
- Produces: `ast::Stmt::span(&self) -> Span`; `printer::print(parsed: &Parsed) -> String`.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `crates/redextape-core/src/ast.rs`:

```rust
    #[test]
    fn stmt_span_covers_each_variant() {
        use crate::parser::parse;
        let src = "let x = 1; fn f(a) { a } x = 2; while x > 0 { x = 0; } x; 0";
        let (program, diags) = parse(src);
        assert!(diags.is_empty(), "{diags:?}");
        let stmts = &program.expect("parses").block.stmts;
        for s in stmts {
            let sp = s.span();
            assert!(sp.start < sp.end, "empty span for {s:?}");
            assert!(sp.end <= src.len());
        }
        // `Let` and `Assign` swallow their `;`; `Fn`, `While` and a bare `Expr` do not.
        assert_eq!(&src[stmts[0].span().start..stmts[0].span().end], "let x = 1;");
    }
```

If `ast.rs` has no `mod tests`, create one at the end of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // (the test above goes here)
}
```

Add to `mod tests` in `crates/redextape-core/src/printer.rs`:

```rust
    /// Format a whole program through the public entry point.
    fn f(src: &str) -> String {
        let (parsed, diags) = crate::parser::parse_full(src);
        assert!(diags.is_empty(), "test input must parse: {diags:?}");
        print(&parsed.expect("parses"))
    }

    #[test]
    fn prints_each_statement_kind() {
        assert_eq!(f("let x=1;x"), "let x = 1;\nx\n");
        assert_eq!(f("let mut x=1;x"), "let mut x = 1;\nx\n");
        assert_eq!(f("let mut x=1;x=2;x"), "let mut x = 1;\nx = 2;\nx\n");
        assert_eq!(f("f(1);0"), "f(1);\n0\n");
    }

    #[test]
    fn prints_fn_and_while_without_a_trailing_semicolon() {
        assert_eq!(f("fn f(a,b){a+b} f(1,2)"), "fn f(a, b) {\n    a + b\n}\nf(1, 2)\n");
        assert_eq!(f("fn f(){1} f()"), "fn f() {\n    1\n}\nf()\n");
        assert_eq!(
            f("let mut x=3; while x>0 { x=x-1; } x"),
            "let mut x = 3;\nwhile x > 0 {\n    x = x - 1;\n}\nx\n"
        );
    }

    #[test]
    fn nests_blocks_at_four_spaces_per_level() {
        assert_eq!(
            f("fn f(a){ if a > 0 { let b = a; b } else { 0 } } f(1)"),
            "fn f(a) {\n    if a > 0 {\n        let b = a;\n        b\n    } else {\n        0\n    }\n}\nf(1)\n"
        );
    }

    #[test]
    fn output_ends_with_exactly_one_newline() {
        for src in ["1", "let x = 1; x", "fn f(){1} f()"] {
            let out = f(src);
            assert!(out.ends_with('\n'), "{src:?} -> {out:?}");
            assert!(!out.ends_with("\n\n"), "{src:?} -> {out:?}");
        }
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo nextest run -p redextape-core --lib`

Expected: FAIL to compile — `no method named span found for enum Stmt`, and `cannot find function print in this scope`.

- [ ] **Step 3: Add `Stmt::span`**

Append to `crates/redextape-core/src/ast.rs`, beside the existing `impl Expr`:

```rust
impl Stmt {
    /// The statement's own span. `Let` and `Assign` include their terminating `;` because the parser
    /// merges it in; `Fn` and `While` end at their body's closing brace; `Stmt::Expr` carries no span
    /// of its own and reports its expression's, which stops short of the `;`.
    #[must_use]
    pub fn span(&self) -> Span {
        match self {
            Stmt::Let { span, .. }
            | Stmt::Fn { span, .. }
            | Stmt::Assign { span, .. }
            | Stmt::While { span, .. } => *span,
            Stmt::Expr(e) => e.span(),
        }
    }
}
```

- [ ] **Step 4: Replace `block_body` and add `print`**

In `crates/redextape-core/src/printer.rs`, widen the AST import — Task 4 deliberately imported only what it used, because `-D warnings` rejects an unused one:

```rust
use crate::ast::{BinOp, Block, Expr, Program, Stmt};
```

Then replace the Task 4 placeholder `block_body` with:

```rust
impl Printer {
    /// Statements then tail, each on its own line at the current level.
    fn block_body(&mut self, block: &Block) {
        for s in &block.stmts {
            self.newline();
            self.indent();
            self.stmt(s);
        }
        if let Some(tail) = block.tail.as_deref() {
            self.newline();
            self.indent();
            self.expr_prec(tail, 0);
        }
    }

    fn stmt(&mut self, s: &Stmt) {
        self.visit(s.span());
        match s {
            Stmt::Let { name, mutable, value, .. } => {
                self.out.push_str(if *mutable { "let mut " } else { "let " });
                self.out.push_str(name);
                self.out.push_str(" = ");
                self.expr_prec(value, 0);
                self.out.push(';');
            }
            Stmt::Assign { target, value, .. } => {
                self.out.push_str(target);
                self.out.push_str(" = ");
                self.expr_prec(value, 0);
                self.out.push(';');
            }
            Stmt::Fn { name, params, body, .. } => {
                self.out.push_str("fn ");
                self.out.push_str(name);
                self.out.push('(');
                self.out.push_str(&params.join(", "));
                self.out.push_str(") ");
                self.braced(body);
            }
            Stmt::While { cond, body, .. } => {
                self.out.push_str("while ");
                self.expr_prec(cond, 0);
                self.out.push(' ');
                self.braced(body);
            }
            Stmt::Expr(e) => {
                self.expr_prec(e, 0);
                self.out.push(';');
            }
        }
    }

    /// The top-level block: same as `block_body` but with no braces and no leading newline before the
    /// first item.
    fn program(&mut self, program: &Program) {
        let mut first = true;
        for s in &program.block.stmts {
            if !first {
                self.newline();
            }
            first = false;
            self.indent();
            self.stmt(s);
        }
        if let Some(tail) = program.block.tail.as_deref() {
            if !first {
                self.newline();
            }
            self.indent();
            self.expr_prec(tail, 0);
        }
        self.newline();
    }
}

/// Print a parsed program back to canonical text.
///
/// The output always ends with exactly one newline, and re-parsing it yields a program with the same
/// meaning — see `tests/format_properties.rs` for the properties that hold this to account.
#[must_use]
pub fn print(parsed: &Parsed<'_>) -> String {
    let mut p = Printer::new();
    p.program(&parsed.program);
    p.out
}
```

Add the import at the top of the file:

```rust
use crate::parser::Parsed;
```

- [ ] **Step 5: Delete the module-level `dead_code` allow — and ONLY that one**

Task 4 left three suppressions in `printer.rs`, and they have three different lifetimes. Getting this wrong breaks the gate, so it is spelled out:

| suppression | what to do now |
| --- | --- |
| `#![allow(dead_code)]` at module level | **Delete it.** It existed only because `Printer` had no non-test caller, and `pub fn print` is that caller. |
| `#[allow(dead_code)]` on `col` | **Keep it.** `col`'s first caller is Task 6's width-aware breaking. It comes out there. |
| `#[allow(clippy::unused_self)]` on `visit` | **Keep it, permanently.** `visit`'s body is `#[cfg(test)]`-gated, so `self` is unused in every non-test build regardless of what `print` does. |

Then run `cargo clippy -p redextape-core --all-targets -- -D warnings`.

Expected: clean. If `dead_code` still fires on something other than `col`, a method the plan expects `print` to reach is genuinely unreachable — find out which and why, and report it rather than widening an allow. A suppression that outlives its stated reason is how a project that permits no global allow ends up with one.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo nextest run -p redextape-core --lib`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/ast.rs crates/redextape-core/src/printer.rs
git commit -F - <<'MSG'
printer: statements, blocks, and `print(&Parsed)`

`Stmt::span` lands beside the existing `Expr::span`; the printer gains every
statement kind and a top-level entry point. No trivia yet — comments and blank
lines are still dropped, which the properties in Task 10 will not accept.
MSG
```

---

## Task 6: Width-aware lists and argument lists

**Files:**
- Modify: `crates/redextape-core/src/printer.rs`
- Test: inline `#[cfg(test)] mod tests` in `crates/redextape-core/src/printer.rs`

**Interfaces:**
- Consumes: Task 5's `Printer`.
- Produces: `printer::SHORT_ELEMENT: usize` (private, 10). `list` and `args` gain break behaviour. No public signature changes.

**The mechanism, stated once because both `list` and `args` use it:** print the inline form, and if the line ends up past `MAX_WIDTH`, truncate `out` back to the mark and print the broken form instead. This reuses one traversal rather than adding a measuring printer — the "second parallel implementation" shape `analysis.rs`'s module doc treats as a defect. The cursor into the comment list is untouched during the attempt because Task 8 only chooses inline when the construct holds no comment, so truncation cannot lose a flushed comment.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `crates/redextape-core/src/printer.rs`:

```rust
    #[test]
    fn a_short_list_stays_inline() {
        assert_eq!(f("[1, 2, 3]"), "[1, 2, 3]\n");
    }

    #[test]
    fn a_list_of_short_elements_fills_when_it_does_not_fit() {
        let src = format!("[{}]", (0..80).map(|i| i.to_string()).collect::<Vec<_>>().join(", "));
        let out = f(&src);
        assert!(out.starts_with("[\n    "), "fill mode indents its first row: {out:?}");
        assert!(out.lines().all(|l| l.len() <= MAX_WIDTH), "no line over the budget: {out:?}");
        let body: Vec<&str> = out.lines().filter(|l| l.starts_with("    ")).collect();
        assert!(body.len() > 1, "it broke into rows: {out:?}");
        assert!(body[0].matches(',').count() > 1, "fill puts several elements on a row: {body:?}");
        assert!(!out.contains(",\n]"), "fill mode adds no trailing comma: {out:?}");
    }

    #[test]
    fn a_list_with_a_wide_element_breaks_one_per_line_with_a_trailing_comma() {
        let wide = "a_rather_long_name";
        let src = format!("[{}]", std::iter::repeat_n(wide, 12).collect::<Vec<_>>().join(", "));
        let out = f(&src);
        let rows: Vec<&str> = out.lines().filter(|l| l.starts_with("    ")).collect();
        assert_eq!(rows.len(), 12, "one element per row: {out:?}");
        assert!(rows.iter().all(|r| r.ends_with(',')), "every row is comma-terminated: {rows:?}");
        assert!(out.contains(",\n]"), "vertical mode adds a trailing comma: {out:?}");
    }

    #[test]
    fn arguments_break_one_per_line_rather_than_filling() {
        let src = format!("f({})", (0..80).map(|i| i.to_string()).collect::<Vec<_>>().join(", "));
        let out = f(&src);
        let rows: Vec<&str> = out.lines().filter(|l| l.starts_with("    ")).collect();
        assert_eq!(rows.len(), 80, "arguments never fill: {out:?}");
        assert!(out.contains(",\n)"), "vertical mode adds a trailing comma: {out:?}");
    }

    #[test]
    fn no_line_exceeds_the_budget_for_a_breakable_construct() {
        let src = format!("f({})", (0..300).map(|i| format!("x{i}")).collect::<Vec<_>>().join(", "));
        assert!(f(&src).lines().all(|l| l.len() <= MAX_WIDTH));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo nextest run -p redextape-core --lib printer`

Expected: FAIL — the fill and one-per-line assertions, because `list` and `args` still emit one long line.

- [ ] **Step 3: Implement the break rules**

Add the constant near `INDENT` in `crates/redextape-core/src/printer.rs`:

```rust
/// A list element whose printed form is wider than this forces one-per-line instead of fill.
/// rustfmt's `short_array_element_width_threshold` default. `examples/rustfmt_calibration_probe.rs`
/// is what confirms or moves it; it is written down so the probe has something to disagree with.
const SHORT_ELEMENT: usize = 10;
```

> **SUPERSEDED BY TASK 7'S MEASUREMENT — read this before writing the code below.** The `allow_fill`
> parameter in this step, the "arguments never fill" assertion in its tests, and the rationale attached to
> both were **falsified** by the calibration probe: rustfmt fills argument lists exactly as it fills
> arrays, at the same threshold, with the same trailing comma. Task 7 deleted the parameter, so
> `bracketed` takes `(open, close, items)` and has one rule. Rule 4 fell in the same run — rustfmt emits a
> trailing comma in fill mode too. The code below is kept as the record of what this task specified and
> what measurement then corrected; see the design's §13.

Replace `list` and `args` with two thin wrappers over one body. **The two constructs differ in exactly two things — the bracket pair and whether fill mode is eligible — so those are parameters, not two functions to keep in step.**

```rust
impl Printer {
    fn list(&mut self, items: &[Expr]) {
        self.bracketed('[', ']', items, true);
    }

    fn args(&mut self, args: &[Expr]) {
        self.bracketed('(', ')', args, false);
    }

    /// A bracketed, comma-separated element sequence.
    ///
    /// Prints the inline form, and truncates back to `mark` when it overruns. That reuses ONE
    /// traversal rather than adding a measuring printer beside the real one — the
    /// "second parallel implementation" shape `analysis.rs`'s module doc treats as a defect rather
    /// than a style choice.
    ///
    /// `allow_fill` is the only behavioural difference between the two callers. rustfmt packs several
    /// short elements per row in an array literal but NEVER in an argument list, because an argument
    /// list is a set of distinct roles and packing them hides which is which.
    fn bracketed(&mut self, open: char, close: char, items: &[Expr], allow_fill: bool) {
        if items.is_empty() {
            self.out.push(open);
            self.out.push(close);
            return;
        }
        let mark = self.out.len();
        self.out.push(open);
        for (i, item) in items.iter().enumerate() {
            if i > 0 {
                self.out.push_str(", ");
            }
            self.expr_prec(item, 0);
        }
        self.out.push(close);
        if self.col() <= MAX_WIDTH {
            return;
        }
        self.out.truncate(mark);
        let fill = allow_fill && items.iter().all(|item| width_of(item) <= SHORT_ELEMENT);
        self.out.push(open);
        self.level += 1;
        if fill {
            self.fill_rows(items);
        } else {
            self.vertical_rows(items, true);
        }
        self.level -= 1;
        self.newline();
        self.indent();
        self.out.push(close);
    }

    /// As many elements per row as fit, `", "`-separated, no trailing comma.
    fn fill_rows(&mut self, items: &[Expr]) {
        self.newline();
        self.indent();
        for (i, item) in items.iter().enumerate() {
            if i > 0 {
                if self.col() + 2 + width_of(item) > MAX_WIDTH {
                    self.out.push(',');
                    self.newline();
                    self.indent();
                } else {
                    self.out.push_str(", ");
                }
            }
            self.expr_prec(item, 0);
        }
    }

    /// One element per row, each comma-terminated.
    fn vertical_rows(&mut self, items: &[Expr], trailing_comma: bool) {
        for (i, item) in items.iter().enumerate() {
            self.newline();
            self.indent();
            self.expr_prec(item, 0);
            if trailing_comma || i + 1 < items.len() {
                self.out.push(',');
            }
        }
    }
}

/// Printed width of one element, standalone.
///
/// Printed alone rather than sliced out of the inline attempt: elements are separated by `", "`
/// there, and an element's own text can contain `", "` too, so splitting the string would mis-measure
/// any list holding a call or a nested list.
fn width_of(item: &Expr) -> usize {
    let mut probe = Printer::new();
    probe.expr_prec(item, 0);
    probe.out.len()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo nextest run -p redextape-core --lib printer`

Expected: PASS.

- [ ] **Step 5: Write the failing test for method-chain breaking**

Design §6 rule 5: a chain stays on one line up to the width, then takes one `.method(...)` per line at +4. Add to `mod tests`:

```rust
    #[test]
    fn a_short_method_chain_stays_on_one_line() {
        assert_eq!(f("xs.map(|x| x + 1).fold(0, |a, b| a + b)"), "xs.map(|x| x + 1).fold(0, |a, b| a + b)\n");
    }

    #[test]
    fn a_long_method_chain_breaks_one_link_per_line() {
        let src = format!("xs{}", ".filter(|a_long_parameter| a_long_parameter > 2)".repeat(5));
        let out = f(&src);
        let rows: Vec<&str> = out.lines().collect();
        assert_eq!(rows.len(), 6, "base then one row per link: {out:?}");
        assert_eq!(rows[0], "xs");
        assert!(rows[1..].iter().all(|r| r.starts_with("    .")), "links indent by four: {rows:?}");
        assert!(out.lines().all(|l| l.len() <= MAX_WIDTH), "no line over budget: {out:?}");
    }

    #[test]
    fn a_chain_of_plain_calls_does_not_break() {
        // Only `.method(…)` links are breakable — there is nowhere to put a newline in `f(1)(2)`.
        assert_eq!(f("f(1)(2)(3)"), "f(1)(2)(3)\n");
    }
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cargo nextest run -p redextape-core --lib printer chain`

Expected: FAIL — `a_long_method_chain_breaks_one_link_per_line` reports one row, because `postfix_chain` always prints inline.

- [ ] **Step 7: Break long chains**

Replace the tail of `postfix_chain` (everything from `links.reverse();` onward) in `crates/redextape-core/src/printer.rs`:

```rust
        links.reverse();
        let mark = self.out.len();
        // A `Binary` or `Lambda` base would re-parse as something else without parens: `|x| x (1)`
        // reads the call as part of the lambda body.
        self.expr_prec(cur, ATOM_BP);
        for link in &links {
            match link {
                Link::Call(args) => self.args(args),
                Link::Method(name, args) => {
                    self.out.push('.');
                    self.out.push_str(name);
                    self.args(args);
                }
            }
        }
        // ONLY `.method(…)` LINKS ARE BREAKABLE. `f(1)(2)` has nowhere to put a newline, so a chain of
        // plain calls stays on one line however long it gets — the same class of exception as §6.6's
        // binary chains, and named here rather than discovered.
        let breakable = links.iter().any(|l| matches!(l, Link::Method(..)));
        if self.col() <= MAX_WIDTH || !breakable {
            return;
        }
        self.out.truncate(mark);
        self.expr_prec(cur, ATOM_BP);
        self.level += 1;
        for link in &links {
            match link {
                Link::Call(args) => self.args(args),
                Link::Method(name, args) => {
                    self.newline();
                    self.indent();
                    self.out.push('.');
                    self.out.push_str(name);
                    self.args(args);
                }
            }
        }
        self.level -= 1;
    }
```

`Link` must derive nothing but must be iterable twice, so change its declaration to hold copies rather than being consumed:

```rust
        #[derive(Clone, Copy)]
        enum Link<'a> {
            Call(&'a [Expr]),
            Method(&'a str, &'a [Expr]),
        }
```

- [ ] **Step 8: Run it to verify it passes**

Run: `cargo nextest run -p redextape-core --lib printer`

Expected: PASS, all of Task 6's tests plus Tasks 4–5's unchanged.

- [ ] **Step 9: Delete `col`'s `dead_code` allow**

`col`'s first caller is `bracketed`, which this task just wrote. Remove the `#[allow(dead_code)]` Task 4 put on it, then run `cargo clippy -p redextape-core --all-targets -- -D warnings`.

Expected: clean. `printer.rs` should now carry exactly one suppression — the permanent `#[allow(clippy::unused_self)]` on `visit`, whose body stays `#[cfg(test)]`-gated for good.

- [ ] **Step 10: Run clippy, because this task adds the most new code**

Run: `cargo clippy -p redextape-core --all-targets -- -D warnings`

Expected: clean. `clippy::pedantic` is on with no global allows; the likely complaint is `needless_pass_by_value` on the helpers taking `&[Expr]`.

- [ ] **Step 11: Commit**

```bash
git add crates/redextape-core/src/printer.rs
git commit -F - <<'MSG'
printer: lists fill, arguments and method chains break

Each tries the inline form and truncates back to a mark when it overruns the
120-col budget, so there is one traversal rather than a second measuring printer.
Lists of short elements pack several per row; argument lists never do, because an
argument list is a set of distinct roles. A chain breaks at its `.method(…)` links
only — `f(1)(2)` has nowhere to put a newline.
MSG
```

---

## Task 7: Calibrate against real rustfmt

A one-shot probe, not a CI gate: rustfmt version drift would make it flaky. It exists so Tasks 4–6's rules are checked against rustfmt's actual behaviour rather than against recollection.

**Files:**
- Create: `crates/redextape-core/examples/rustfmt_calibration_probe.rs`

**Interfaces:**
- Consumes: `printer::print`, `parser::parse_full`.
- Produces: nothing importable — a binary that prints a report.

- [ ] **Step 1: Write the probe**

Create `crates/redextape-core/examples/rustfmt_calibration_probe.rs`:

```rust
//! Calibrate the surface printer's break rules against real `rustfmt`.
//!
//! A PROBE, NOT A TEST. rustfmt's output changes between toolchain releases, so gating CI on it would
//! buy a flake in exchange for a property we only need to establish once. Run it by hand when the
//! layout rules change:
//!
//!     cargo run -p redextape-core --example rustfmt_calibration_probe
//!
//! For each case it prints our output beside rustfmt's output for the equivalent Rust, so the shapes
//! can be compared by eye. It asserts nothing — the report is the deliverable.

// Probe target: a probe that cannot run its own subprocess has nothing to report, so panicking is the
// useful behaviour here. Matches every other `examples/*_probe.rs` in this crate.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::Write;
use std::process::{Command, Stdio};

use redextape_core::parser::parse_full;
use redextape_core::printer::print;

/// Each case is (label, mini-language source, equivalent Rust expression body).
///
/// The Rust side is written by hand rather than translated, because the point is to compare LAYOUT
/// DECISIONS on equivalent shapes, not to build a transpiler.
const CASES: &[(&str, &str, &str)] = &[
    ("short list", "[1, 2, 3]", "fn main() { let _ = [1, 2, 3]; }"),
    (
        "long list of short elements",
        "[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40]",
        "fn main() { let _ = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40]; }",
    ),
    (
        "list of wide elements",
        "[a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name]",
        "fn main() { let _ = [a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name]; }",
    ),
    (
        "long argument list",
        "f(aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd, eeeeeeeeee, ffffffffff, gggggggggg, hhhhhhhhhh, iiiiiiiiii, jjjjjjjjjj, kkkkkkkkkk)",
        "fn main() { f(aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd, eeeeeeeeee, ffffffffff, gggggggggg, hhhhhhhhhh, iiiiiiiiii, jjjjjjjjjj, kkkkkkkkkk); }",
    ),
    (
        "method chain",
        "xs.map(|x| x + 1).filter(|x| x > 2).fold(0, |a, b| a + b).map(|x| x * 2).filter(|x| x > 100)",
        "fn main() { let _ = xs.map(|x| x + 1).filter(|x| x > 2).fold(0, |a, b| a + b).map(|x| x * 2).filter(|x| x > 100); }",
    ),
    (
        "blank lines and comments",
        "// lead\nlet a = 1;\n\n\n// two blanks above collapse to one\nlet b = 2; // trailing\nb",
        "fn main() {\n// lead\nlet a = 1;\n\n\n// two blanks above collapse to one\nlet b = 2; // trailing\nb\n}",
    ),
];

fn rustfmt(src: &str) -> String {
    let mut child = Command::new("rustfmt")
        .args(["--edition", "2024", "--config", "max_width=120,use_small_heuristics=Max"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("rustfmt is on PATH (it is a rust-toolchain.toml component)");
    child.stdin.as_mut().expect("stdin").write_all(src.as_bytes()).expect("write");
    let out = child.wait_with_output().expect("rustfmt runs");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn main() {
    for (label, ours_src, rust_src) in CASES {
        println!("\n=== {label} ===");
        let (parsed, diags) = parse_full(ours_src);
        match parsed {
            Some(p) => println!("--- redextape ---\n{}", print(&p)),
            None => println!("--- redextape --- DID NOT PARSE: {diags:?}"),
        }
        println!("--- rustfmt ---\n{}", rustfmt(rust_src));
    }
    println!(
        "\nCompare the SHAPES, not the syntax. What to check:\n\
         1. does rustfmt fill the long short-element array, or break it one-per-line?\n\
         2. at what element width does it switch (SHORT_ELEMENT is set to 10)?\n\
         3. does it add a trailing comma in fill mode? in vertical mode?\n\
         4. does it break the method chain, and at which `.`?\n\
         Any disagreement is a change to printer.rs's rules, not to this probe."
    );
}
```

- [ ] **Step 2: Run it**

Run: `cargo run -p redextape-core --example rustfmt_calibration_probe`

Expected: a report, six sections. It asserts nothing, so it exits 0 either way — reading it is the step.

- [ ] **Step 3: Record the readings and reconcile**

Write the four answers into the probe's own module doc as a dated block, in this shape:

```rust
//! **MEASURED <date>, rustfmt <version from `rustfmt --version`>:**
//!   1. long short-element array: <filled | one-per-line>
//!   2. switch point: <observed>  (SHORT_ELEMENT = 10 <agrees | moved to N>)
//!   3. trailing comma: fill <yes|no>, vertical <yes|no>
//!   4. method chain: <broke at every `.` | stayed inline | …>
```

If any reading disagrees with Task 6's rules, change `printer.rs` and its tests to match rustfmt, then re-run Task 6's tests. Record the change in the probe doc as well — a probe whose reading was acted on is more useful than one that only reported.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/examples/rustfmt_calibration_probe.rs crates/redextape-core/src/printer.rs
git commit -F - <<'MSG'
probe: calibrate the printer's break rules against real rustfmt

Six shapes printed side by side with rustfmt's output for equivalent Rust, and the
four readings recorded in the probe's own doc. A probe rather than a gate: rustfmt
output moves between toolchain releases and this property only needs establishing
once.
MSG
```

---

## Task 8: Blank lines

**Files:**
- Modify: `crates/redextape-core/src/printer.rs`
- Test: inline `#[cfg(test)] mod tests` in `crates/redextape-core/src/printer.rs`

**Interfaces:**
- Consumes: Task 5's `Printer`, `Parsed::src`.
- Produces: `Printer` gains `src: &'a str` and `last_end: usize`; `print` threads `parsed.src` in. `Printer` becomes `Printer<'a>`. No public signature changes.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `crates/redextape-core/src/printer.rs`:

```rust
    #[test]
    fn a_single_blank_line_between_statements_survives() {
        assert_eq!(f("let a = 1;\n\nlet b = 2;\nb"), "let a = 1;\n\nlet b = 2;\nb\n");
    }

    #[test]
    fn runs_of_blank_lines_collapse_to_one() {
        assert_eq!(f("let a = 1;\n\n\n\n\nlet b = 2;\nb"), "let a = 1;\n\nlet b = 2;\nb\n");
    }

    #[test]
    fn no_blank_line_is_kept_just_inside_a_brace() {
        assert_eq!(f("fn g(){\n\n  1\n\n}\ng()"), "fn g() {\n    1\n}\ng()\n");
    }

    #[test]
    fn no_blank_line_at_the_start_of_the_file() {
        assert_eq!(f("\n\n\nlet a = 1;\na"), "let a = 1;\na\n");
    }

    #[test]
    fn blank_lines_inside_a_block_survive() {
        assert_eq!(
            f("fn g(){ let a = 1;\n\nlet b = 2;\na + b } g()"),
            "fn g() {\n    let a = 1;\n\n    let b = 2;\n    a + b\n}\ng()\n"
        );
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo nextest run -p redextape-core --lib printer`

Expected: FAIL — every blank line is currently destroyed, so `a_single_blank_line_between_statements_survives` reports `"let a = 1;\nlet b = 2;\nb\n"`.

- [ ] **Step 3: Give the printer the source and a cursor**

In `crates/redextape-core/src/printer.rs`, change the struct and its constructor:

```rust
struct Printer<'a> {
    /// The string every span in the tree indexes into. Blank lines are read back out of it rather
    /// than recorded, which is why the trivia list holds comments only.
    src: &'a str,
    out: String,
    line_start: usize,
    level: usize,
    /// End offset of the last item written — construct OR comment. Gaps measure from here, so a
    /// comment sitting between two statements does not swallow the blank line on one side of it and
    /// invent one on the other.
    last_end: usize,
    #[cfg(test)]
    visited: Vec<Span>,
}

impl<'a> Printer<'a> {
    fn new(src: &'a str) -> Self {
        Printer {
            src,
            out: String::new(),
            line_start: 0,
            level: 0,
            last_end: 0,
            #[cfg(test)]
            visited: Vec::new(),
        }
    }
```

Change every other `impl Printer` block to `impl Printer<'_>`, and the `Printer::new()` call inside `width_of` to `Printer::new("")` — that probe prints one element in isolation and consults no source.

Task 4's test helper constructs a `Printer` directly too, so update it in the same pass:

```rust
    fn p(src: &str) -> String {
        let (program, diags) = parse(src);
        assert!(diags.is_empty(), "test input must parse: {diags:?}");
        let program = program.expect("parses");
        let tail = program.block.tail.as_ref().expect("test inputs are a single tail expression");
        let mut pr = Printer::new(src);
        pr.expr(tail);
        pr.out
    }
```

Add the gap helper and use it:

```rust
impl Printer<'_> {
    /// True when the author left at least one blank line between `prev_end` and `next_start`.
    /// Total: a reversed or out-of-range pair reads as no blank line rather than panicking.
    fn blank_between(&self, prev_end: usize, next_start: usize) -> bool {
        self.src.get(prev_end..next_start).is_some_and(|gap| gap.matches('\n').count() >= 2)
    }

    /// Open the line for the next item at `start`, emitting a blank line first when the author left
    /// one. `first` suppresses that: no blank line is kept at the start of a file or just inside a
    /// brace.
    fn open_line(&mut self, start: usize, first: bool) {
        if !first && self.blank_between(self.last_end, start) {
            self.newline();
        }
        self.newline();
        self.indent();
    }
}
```

Replace `block_body` and `program`:

```rust
impl Printer<'_> {
    fn block_body(&mut self, block: &Block) {
        let mut first = true;
        for s in &block.stmts {
            self.open_line(s.span().start, first);
            first = false;
            self.stmt(s);
            self.last_end = s.span().end;
        }
        if let Some(tail) = block.tail.as_deref() {
            self.open_line(tail.span().start, first);
            self.expr(tail);
            self.last_end = tail.span().end;
        }
    }

    fn program(&mut self, program: &Program) {
        let mut first = true;
        for s in &program.block.stmts {
            if first {
                self.indent();
            } else {
                self.open_line(s.span().start, false);
            }
            first = false;
            self.stmt(s);
            self.last_end = s.span().end;
        }
        if let Some(tail) = program.block.tail.as_deref() {
            if first {
                self.indent();
            } else {
                self.open_line(tail.span().start, false);
            }
            self.expr(tail);
            self.last_end = tail.span().end;
        }
        self.newline();
    }
}
```

Update `print`:

```rust
#[must_use]
pub fn print(parsed: &Parsed<'_>) -> String {
    let mut p = Printer::new(parsed.src);
    p.program(&parsed.program);
    p.out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo nextest run -p redextape-core --lib printer`

Expected: PASS, including every test from Tasks 4–6 unchanged.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/printer.rs
git commit -F - <<'MSG'
printer: blank lines survive, following rustfmt

Runs collapse to one, none is kept just inside a brace or at file start. No records
were added: the printer holds `src` and counts newlines in the original gap, which
is why the trivia list is comments only.
MSG
```

---

## Task 9: Comments

**Files:**
- Modify: `crates/redextape-core/src/printer.rs`
- Test: inline `#[cfg(test)] mod tests` in `crates/redextape-core/src/printer.rs`

**Interfaces:**
- Consumes: Task 2's `Parsed::comments`, Task 8's `Printer<'a>`.
- Produces: `Printer` gains `comments: &'a [Comment]` and `next: usize`, plus `fn flush_before(&mut self, upto: usize, first: bool)` and `fn contains_comment(&self, span: Span) -> bool`. `list`/`args` consult `contains_comment` before choosing the inline form. No public signature changes.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `crates/redextape-core/src/printer.rs`:

```rust
    #[test]
    fn an_own_line_comment_prints_above_the_construct_it_precedes() {
        assert_eq!(f("// why\nlet a = 1;\na"), "// why\nlet a = 1;\na\n");
    }

    #[test]
    fn a_trailing_comment_stays_on_its_line_with_exactly_one_space() {
        assert_eq!(f("let a = 1;   // note\na"), "let a = 1; // note\na\n");
    }

    #[test]
    fn a_comment_takes_the_indentation_of_what_it_anchors_to_and_gains_no_space() {
        assert_eq!(
            f("fn g(){\n// inner\nlet a = 1;\na\n}\ng()"),
            "fn g() {\n    // inner\n    let a = 1;\n    a\n}\ng()\n"
        );
    }

    #[test]
    fn comment_text_is_copied_byte_for_byte_with_trailing_space_trimmed() {
        assert_eq!(f("let a = 1; //   spaced   \na"), "let a = 1; //   spaced\na\n");
        assert_eq!(f("let a = 1; //no space after slashes\na"), "let a = 1; //no space after slashes\na\n");
    }

    #[test]
    fn a_comment_after_the_last_construct_still_prints() {
        assert_eq!(f("let a = 1;\na\n// last word\n"), "let a = 1;\na\n// last word\n");
    }

    #[test]
    fn a_comment_inside_a_list_forces_the_list_to_break() {
        // THE HAZARD THIS RULE EXISTS FOR: `//` runs to end of line, so `[1, // first 2]` is not an
        // ugly rendering of the input — it is a one-element list, or a parse error.
        let out = f("let xs = [\n1, // first\n2,\n];\nxs");
        assert_eq!(out, "let xs = [\n    1, // first\n    2,\n];\nxs\n");
        let (reparsed, diags) = crate::parser::parse_full(&out);
        assert!(diags.is_empty(), "output must reparse: {diags:?}");
        assert!(reparsed.is_some());
    }

    #[test]
    fn blank_lines_measure_against_a_comment_when_one_sits_between() {
        assert_eq!(
            f("let a = 1;\n\n// note\nlet b = 2;\nb"),
            "let a = 1;\n\n// note\nlet b = 2;\nb\n"
        );
        assert_eq!(
            f("let a = 1;\n// note\n\nlet b = 2;\nb"),
            "let a = 1;\n// note\n\nlet b = 2;\nb\n"
        );
    }

    #[test]
    fn every_comment_survives_regardless_of_where_it_sits() {
        let src = "// a\nfn g(a) { // b\n  // c\n  a // d\n} // e\n// f\ng(1) // g\n// h";
        let out = f(src);
        let count = |s: &str| s.matches("//").count();
        assert_eq!(count(&out), count(src), "no comment dropped:\n{out}");
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo nextest run -p redextape-core --lib printer`

Expected: FAIL — every comment is currently dropped, so `an_own_line_comment_prints_above_the_construct_it_precedes` reports `"let a = 1;\na\n"`.

- [ ] **Step 3: Add the cursor and the flush**

In `crates/redextape-core/src/printer.rs`, add to the struct and constructor:

```rust
struct Printer<'a> {
    src: &'a str,
    /// Sorted by start offset and non-overlapping with any token, which is what lets `next` be a
    /// single forward cursor rather than a search.
    comments: &'a [Comment],
    next: usize,
    out: String,
    line_start: usize,
    level: usize,
    last_end: usize,
    #[cfg(test)]
    visited: Vec<Span>,
}

impl<'a> Printer<'a> {
    fn new(src: &'a str, comments: &'a [Comment]) -> Self {
        Printer {
            src,
            comments,
            next: 0,
            out: String::new(),
            line_start: 0,
            level: 0,
            last_end: 0,
            #[cfg(test)]
            visited: Vec::new(),
        }
    }
```

Update `width_of`'s probe to `Printer::new("", &[])` — it prints one element with no trivia in reach — and Task 4's test helper to `Printer::new(src, &[])`, which drives expressions only and has no comment list to hand it.

Add the import:

```rust
use crate::token::Comment;
```

Add the flush and the containment test:

```rust
impl Printer<'_> {
    /// Comment text with trailing whitespace trimmed. A CRLF line ending leaves a `\r` inside the
    /// span (see `token::Comment`), and rustfmt trims trailing space; both are this one call.
    fn comment_text(&self, c: Comment) -> &str {
        self.src.get(c.span.start..c.span.end).unwrap_or("").trim_end()
    }

    /// Is there a comment anywhere inside `span`? A construct that holds one must break, because a
    /// comment printed mid-line would comment out the rest of that line.
    fn contains_comment(&self, span: Span) -> bool {
        self.comments.iter().any(|c| c.span.start >= span.start && c.span.start < span.end)
    }

    /// Emit every comment starting before `upto`.
    ///
    /// CALLED BEFORE THE PREVIOUS LINE IS TERMINATED, and that is what makes a trailing comment
    /// possible at all: a trailing comment's span starts after the preceding construct and before the
    /// next one, so the same cursor finds both kinds at the same moment. A flush that ran after the
    /// newline could only ever produce own-line comments.
    ///
    /// EMITTING A COMMENT ALWAYS ENDS THE LINE. `//` runs to end of line, so anything written after
    /// one on the same line is inside it.
    ///
    /// Returns whether it emitted anything, which is what lets `open_line` tell "first thing in this
    /// block" from "first CONSTRUCT in this block, but a comment already opened it".
    fn flush_before(&mut self, upto: usize, first: bool) -> bool {
        let mut first = first;
        let mut emitted = false;
        while self.next < self.comments.len() && self.comments[self.next].span.start < upto {
            let c = self.comments[self.next];
            self.next += 1;
            if c.own_line {
                if !first && self.blank_between(self.last_end, c.span.start) {
                    self.newline();
                }
                self.newline();
                self.indent();
            } else {
                self.out.push(' ');
            }
            let text = self.comment_text(c);
            self.out.push_str(text);
            self.last_end = c.span.end;
            first = false;
            emitted = true;
        }
        emitted
    }
}
```

Rewrite `open_line` so it flushes first:

```rust
impl Printer<'_> {
    /// Open the line for the item at `start`: flush any comments that precede it, then emit the blank
    /// line the author left, then the newline and indent for the item itself.
    ///
    /// `first` suppresses the blank line — nothing is kept just inside a brace or at file start.
    /// A comment flushed just now UNSUPPRESSES it: the comment has already opened the block, so a
    /// blank line between that comment and this construct is the author's and survives. The
    /// suppression must key off what THIS call emitted, not off the cursor's global position — a
    /// cursor that has passed any comment anywhere in the file is never at zero again, and using it
    /// as the test would let a blank line through just inside every brace after the file's first
    /// comment.
    fn open_line(&mut self, start: usize, first: bool) {
        let flushed = self.flush_before(start, first);
        if (!first || flushed) && self.blank_between(self.last_end, start) {
            self.newline();
        }
        self.newline();
        self.indent();
    }
}
```

Rewrite `program` so the first item and the EOF drain are handled:

```rust
impl Printer<'_> {
    fn program(&mut self, program: &Program) {
        let mut first = true;
        for s in &program.block.stmts {
            self.open_first_or_next(s.span().start, &mut first);
            self.stmt(s);
            self.last_end = s.span().end;
        }
        if let Some(tail) = program.block.tail.as_deref() {
            self.open_first_or_next(tail.span().start, &mut first);
            self.expr(tail);
            self.last_end = tail.span().end;
        }
        // Anything after the last construct. `usize::MAX` drains the rest of the cursor.
        self.flush_before(usize::MAX, false);
        self.newline();
    }

    /// The top level has no braces, so its first item opens the file rather than opening a line.
    fn open_first_or_next(&mut self, start: usize, first: &mut bool) {
        if *first {
            self.flush_before(start, true);
            if self.out.is_empty() {
                self.indent();
            } else {
                self.newline();
                self.indent();
            }
        } else {
            self.open_line(start, false);
        }
        *first = false;
    }
}
```

Rewrite `block_body`'s close so comments between the last item and the closing brace are flushed inside the block:

```rust
impl Printer<'_> {
    fn block_body(&mut self, block: &Block) {
        let mut first = true;
        for s in &block.stmts {
            self.open_line(s.span().start, first);
            first = false;
            self.stmt(s);
            self.last_end = s.span().end;
        }
        if let Some(tail) = block.tail.as_deref() {
            self.open_line(tail.span().start, first);
            self.expr(tail);
            self.last_end = tail.span().end;
        }
        // Comments between the last item and `}` belong inside the braces, at the body's indent.
        self.flush_before(block.span.end, false);
    }
}
```

Make `bracketed` respect the rule — one place, so `list` and `args` both get it. The guard runs *before* the inline attempt, because a construct holding a comment must never be attempted inline at all:

```rust
    fn bracketed(&mut self, open: char, close: char, items: &[Expr]) {
        if items.is_empty() {
            self.out.push(open);
            self.out.push(close);
            return;
        }
        // A COMMENT ANYWHERE INSIDE FORCES THE BREAK, and the inline attempt is skipped rather than
        // made and discarded: `//` runs to end of line, so an inline form holding a comment is not an
        // ugly candidate to measure, it is a different program.
        let must_break = self.contains_comment(list_span(items));
        let mark = self.mark();
        if !must_break {
            self.out.push(open);
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    self.out.push_str(", ");
                }
                self.expr_prec(item, 0);
            }
            self.out.push(close);
            if self.col() <= MAX_WIDTH {
                return;
            }
            self.rewind(mark);
        }
        // Fill packs several elements per row, which puts a trailing comment mid-row. Vertical rows
        // are the only shape that can carry one, so a comment rules fill out.
        let fill = !must_break && items.iter().all(|item| width_of(item) <= SHORT_ELEMENT);
        self.out.push(open);
        self.level += 1;
        if fill {
            self.fill_rows(items);
        } else {
            self.vertical_rows(items, true);
        }
        self.level -= 1;
        self.newline();
        self.indent();
        self.out.push(close);
    }
```

`bracketed`'s own inline attempt never flushes a comment — it is only reached when `must_break` is false — so the guard coming first is what keeps that path clean, rather than the truncation having to undo a flush.

**BUT THAT ARGUMENT DOES NOT COVER `postfix_chain`, AND THE CURSOR MUST GO IN `Mark`.** `postfix_chain` has no `must_break` guard: its inline attempt calls `args`, which calls `bracketed`, which — if *that* argument list contains a comment — takes `must_break` and breaks vertically, and `vertical_rows` calls `open_line`, which calls `flush_before`, which advances `next` and writes output. `postfix_chain` then sees the newline, rewinds, and reprints. Without restoring `next`, those comments are consumed by a print that was thrown away: the reprint skips them and they vanish from the output entirely.

So add `next` to `Mark` alongside `out_len`, `line_start` and `last_end`, and restore it in `rewind`. This is the third piece of state this file has needed to add to that struct, each found the same way — by asking what a discarded print had already changed. **The rule to apply when adding any printer field is "does this need to rewind?", not "is this a byte offset?"**

Make `vertical_rows` flush trailing comments per element:

```rust
    fn vertical_rows(&mut self, items: &[Expr], trailing_comma: bool) {
        for (i, item) in items.iter().enumerate() {
            self.open_line(item.span().start, false);
            self.expr_prec(item, 0);
            if trailing_comma || i + 1 < items.len() {
                self.out.push(',');
            }
            self.last_end = item.span().end;
            // A comment trailing THIS element sits before the next element's start; flushing it here
            // keeps it on this row.
            let upto = items.get(i + 1).map_or(usize::MAX, |n| n.span().start);
            self.flush_before(upto.min(self.next_boundary(item)), false);
        }
    }

    /// The offset past which a comment no longer belongs to `item`'s row: the end of the line `item`
    /// ends on, in the ORIGINAL source.
    ///
    /// `get` rather than indexing — a span end that is not a char boundary would panic on a slice,
    /// and the no-panic-on-user-input rule holds here as everywhere else.
    fn next_boundary(&self, item: &Expr) -> usize {
        let end = item.span().end;
        self.src.get(end..).and_then(|rest| rest.find('\n')).map_or(self.src.len(), |off| end + off)
    }
```

Add the span helper near `op_text`:

```rust
/// The span covering a whole element sequence. The AST gives spans per element, not per bracket, so
/// this is what `contains_comment` is asked about.
fn list_span(items: &[Expr]) -> Span {
    match (items.first(), items.last()) {
        (Some(f), Some(l)) => f.span().merge(l.span()),
        _ => Span::new(0, 0),
    }
}
```

Update `print`:

```rust
#[must_use]
pub fn print(parsed: &Parsed<'_>) -> String {
    let mut p = Printer::new(parsed.src, &parsed.comments);
    p.program(&parsed.program);
    p.out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo nextest run -p redextape-core --lib printer`

Expected: PASS. If `a_comment_after_the_last_construct_still_prints` fails with a doubled newline, the EOF drain is emitting its own line terminator as well as `program`'s final `newline()` — the drain must not.

- [ ] **Step 5: Run clippy and the whole crate**

Run: `cargo clippy -p redextape-core --all-targets -- -D warnings && cargo nextest run -p redextape-core`

Expected: clean and green.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/printer.rs
git commit -F - <<'MSG'
printer: comments, anchored to what follows them

Own-line comments print above their construct at its indent; a comment sharing a
line with code stays trailing. The flush runs BEFORE the previous line is
terminated, which is the only point at which both kinds are distinguishable.

Emitting a comment always ends the line and any construct holding one is forced to
break — `[1, // first 2]` is a different program, not an ugly rendering.
MSG
```

---

## Task 10: `format` and the property suite

**Files:**
- Modify: `crates/redextape-core/src/lib.rs`
- Create: `crates/redextape-core/tests/format_properties.rs`

**Interfaces:**
- Consumes: `parser::parse_full`, `printer::print`.
- Produces: `redextape_core::format(src: &str) -> Result<String, Vec<Diagnostic>>`.

- [ ] **Step 1: Write `format`'s test**

Add to `mod smoke_tests` in `crates/redextape-core/src/lib.rs`:

```rust
    #[test]
    fn format_returns_canonical_text_or_the_diagnostics_that_stopped_it() {
        assert_eq!(format("let  x=1;x").expect("formats"), "let x = 1;\nx\n");
        let err = format("let x = ;").expect_err("does not parse");
        assert!(!err.is_empty(), "and says why");
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo nextest run -p redextape-core --lib smoke`

Expected: FAIL to compile — `cannot find function format in this scope`.

- [ ] **Step 3: Add `format`**

Add `pub mod printer;` to the module list if Task 4 did not, then add beside `run` in `crates/redextape-core/src/lib.rs`:

```rust
/// Format `src`: parse it and print it back canonically. The formatter is exactly `print ∘ parse`
/// (spec §7.2), so nothing about the input's layout is preserved except its comments and its blank
/// lines, both of which are trivia the printer places by rule.
///
/// # Errors
///
/// Returns the parse diagnostics when `src` does not parse. There is no partial format: a file that
/// does not parse is returned untouched to the caller, which is the only safe thing to do with it.
pub fn format(src: &str) -> Result<String, Vec<Diagnostic>> {
    let (parsed, diagnostics) = parser::parse_full(src);
    match parsed {
        Some(p) => Ok(printer::print(&p)),
        None => Err(diagnostics),
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cargo nextest run -p redextape-core --lib smoke`

Expected: PASS.

- [ ] **Step 5: Write the property suite**

Create `crates/redextape-core/tests/format_properties.rs`:

```rust
//! The six properties design §10 holds the formatter to. Five are pinned here; the sixth — the
//! printer's visit order — lives in `printer.rs`'s inline test module, because asserting it needs the
//! printer's own traversal and a second one written here could only disagree with the first.

// Test target: a fixture that fails to parse IS the failure this file reports. The `allow-*-in-tests`
// keys in `clippy.toml` reach `#[test]` functions and `#[cfg(test)]` modules, not the free helpers
// below, so the exemption is stated per target — the same note `tests/common/mod.rs` carries.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use proptest::prelude::*;
use redextape_core::analysis::{TokenClass, classify_source};
use redextape_core::printer::MAX_WIDTH;
use redextape_core::span::Span;
use redextape_core::value::format_value;
use redextape_core::{format, run};
use redextape_test_support::arb_expr_over;

/// Programs exercising every construct the printer prints, each with trivia in a different place.
const CORPUS: &[&str] = &[
    "1",
    "1 + 2 * 3",
    "(1 + 2) * 3",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 3; while x > 0 { x = x - 1; } x",
    "fn f(a, b) { a + b } f(1, 2)",
    "fn g(n) { if n == 0 { 0 } else { n + g(n - 1) } } g(3)",
    "[1, 2, 3]",
    "// leading\nlet x = 1; // trailing\nx + 1",
    "let a = 1;\n\n\n// two blanks collapse\nlet b = 2;\na + b",
    "let xs = [\n    1, // first\n    2,\n];\n0",
    "fn h(a) { // brace-trailing\n    // own line\n    a // tail-trailing\n}\nh(1)",
];

/// Every `//` occurrence, in order, with trailing whitespace trimmed — the comparison design §10.2
/// specifies. Counting `//` rather than re-lexing keeps this independent of the lexer under test.
fn comments_of(src: &str) -> Vec<String> {
    src.lines()
        .filter_map(|l| l.find("//").map(|i| l[i..].trim_end().to_string()))
        .collect()
}

#[test]
fn formatting_is_idempotent_on_the_corpus() {
    for src in CORPUS {
        let once = format(src).unwrap_or_else(|d| panic!("{src:?} must parse: {d:?}"));
        let twice = format(&once).unwrap_or_else(|d| panic!("formatted output must reparse: {d:?}"));
        assert_eq!(once, twice, "not idempotent for {src:?}");
    }
}

#[test]
fn every_comment_survives_in_order_and_byte_for_byte() {
    for src in CORPUS {
        let out = format(src).unwrap();
        assert_eq!(comments_of(&out), comments_of(src), "comments changed for {src:?}\n{out}");
    }
}

#[test]
fn formatting_does_not_change_what_a_program_computes() {
    for src in CORPUS {
        let out = format(src).unwrap();
        let before = run(src);
        let after = run(&out);
        match (before, after) {
            (Ok(a), Ok(b)) => assert_eq!(format_value(&a), format_value(&b), "value changed for {src:?}"),
            (Err(_), Err(_)) => {}
            (a, b) => panic!("outcome changed for {src:?}: {a:?} then {b:?}"),
        }
    }
}

#[test]
fn output_always_reparses_with_no_diagnostics() {
    for src in CORPUS {
        let out = format(src).unwrap();
        format(&out).unwrap_or_else(|d| panic!("output of {src:?} did not reparse: {d:?}\n{out}"));
    }
}

#[test]
fn no_line_exceeds_the_budget_except_an_unbreakable_one() {
    // THE EXCEPTIONS ARE ENUMERATED, NOT WAIVED BY A WILDCARD. Design §6.6: binary expressions never
    // break, so an arithmetic chain can overrun. Nothing else may.
    let breakable = "fn wide(a) { a } wide([1, 2, 3])";
    for line in format(breakable).unwrap().lines() {
        assert!(line.len() <= MAX_WIDTH, "over budget: {line:?}");
    }
    let unbreakable = format(&vec!["1"; 200].join(" + ")).unwrap();
    assert!(
        unbreakable.lines().any(|l| l.len() > MAX_WIDTH),
        "a long binary chain is the DOCUMENTED exception; if this now fits, §6.6 changed and this \
         test should be updated rather than deleted"
    );
}

/// Where a comment sits, structurally: how deeply nested it is, and the nearest real tokens either
/// side of it.
///
/// **THIS IS THE PROPERTY §10 WAS MISSING, AND ITS ABSENCE COST TWO BUGS.** Design §14 records both:
/// a comment touching a bracket was torn out of its list and reattached to an unrelated `;`, and a
/// comment trailing one link of a method chain was swept into the next link's argument list. Both
/// outputs reparsed, preserved every comment's text and order, and were idempotent — so properties
/// 1 through 4 all passed while the comment sat on the wrong construct.
///
/// **Depth is what catches them.** A comment inside `[ … ]` is at depth 1; moved outside, it is at 0.
/// A comment after a chain link is at 0; swept into the next call's arguments, it is at 1.
///
/// **Punctuation is excluded from the neighbours on purpose.** A construct that breaks vertically
/// gains a trailing comma, so the token immediately before a trailing comment legitimately changes
/// from `2` to `,`. Comparing the nearest NON-punctuation token either side is stable under that while
/// still pinning the comment between the same two real tokens.
fn comment_anchors(src: &str) -> Vec<(usize, String, String, String)> {
    let spans = classify_source(src);
    let text = |s: Span| src[s.start..s.end].to_string();
    let is_open = |t: &str| matches!(t, "[" | "(" | "{");
    let is_close = |t: &str| matches!(t, "]" | ")" | "}");
    let mut out = Vec::new();
    for (i, (span, class)) in spans.iter().enumerate() {
        if *class != TokenClass::Comment {
            continue;
        }
        let depth = spans[..i]
            .iter()
            .filter(|(_, c)| *c == TokenClass::Punct)
            .fold(0i32, |d, (s, _)| {
                let t = text(*s);
                d + i32::from(is_open(&t)) - i32::from(is_close(&t))
            });
        let real = |j: &&(Span, TokenClass)| j.1 != TokenClass::Comment && j.1 != TokenClass::Punct;
        let before = spans[..i].iter().rev().find(real).map_or(String::new(), |(s, _)| text(*s));
        let after = spans[i + 1..].iter().find(real).map_or(String::new(), |(s, _)| text(*s));
        out.push((depth.max(0) as usize, before, text(*span), after));
    }
    out
}

#[test]
fn every_comment_keeps_the_construct_it_was_written_against() {
    for src in CORPUS {
        let out = format(src).unwrap();
        assert_eq!(comment_anchors(&out), comment_anchors(src), "comment moved for {src:?}\n{out}");
    }
}

#[test]
fn comment_anchoring_catches_the_two_defects_it_was_written_for() {
    // NOT A REGRESSION TEST FOR THE BUGS — `printer.rs` already has those. This asserts the PROPERTY
    // itself is capable of failing, by checking it distinguishes the two shapes design §14 records.
    // A property that cannot fail is worth nothing, and these two passed four other properties.
    let torn_from_its_list = ("let xs = [1, 2 // t\n];\nlet y = 3;\ny", "let xs = [1, 2]; // t\n\nlet y = 3;\ny\n");
    let swept_into_next_link = ("xs.first(1) // n\n.second(2)", "xs\n    .first(1)\n    .second( // n\n        2,\n    )\n");
    for (src, wrong) in [torn_from_its_list, swept_into_next_link] {
        assert_ne!(
            comment_anchors(wrong),
            comment_anchors(src),
            "the anchoring property cannot tell these apart, so it would not have caught §14: {src:?}"
        );
    }
}

fn arb_leaf() -> impl Strategy<Value = String> {
    (0u64..20).prop_map(|n| n.to_string())
}

/// A program with trivia: `let` statements over generated expressions, each optionally preceded by an
/// own-line comment, optionally trailed by one, and optionally separated by a blank line.
///
/// `arb_expr_over`'s recursion parameters are NOT touched — its doc records measured rates that other
/// tests depend on. This wraps it rather than varying it.
fn arb_program_with_trivia() -> impl Strategy<Value = String> {
    proptest::collection::vec((arb_expr_over(arb_leaf()), any::<bool>(), any::<bool>(), any::<bool>()), 1..4)
        .prop_map(|stmts| {
            let mut out = String::new();
            for (i, (e, lead, trail, blank)) in stmts.iter().enumerate() {
                if *blank && i > 0 {
                    out.push('\n');
                }
                if *lead {
                    out.push_str("// lead\n");
                }
                out.push_str(&format!("let v{i} = {e};"));
                if *trail {
                    out.push_str(" // trail");
                }
                out.push('\n');
            }
            out.push_str("v0");
            out
        })
}

proptest! {
    #[test]
    fn idempotent_on_generated_programs(src in arb_program_with_trivia()) {
        let once = format(&src).expect("generated programs parse");
        let twice = format(&once).expect("formatted output reparses");
        prop_assert_eq!(once, twice);
    }

    #[test]
    fn comments_survive_on_generated_programs(src in arb_program_with_trivia()) {
        let out = format(&src).expect("generated programs parse");
        prop_assert_eq!(comments_of(&out), comments_of(&src));
    }

    #[test]
    fn value_survives_on_generated_programs(src in arb_program_with_trivia()) {
        let out = format(&src).expect("generated programs parse");
        match (run(&src), run(&out)) {
            (Ok(a), Ok(b)) => prop_assert_eq!(format_value(&a), format_value(&b)),
            (Err(_), Err(_)) => {}
            _ => prop_assert!(false, "outcome changed"),
        }
    }
}
```

- [ ] **Step 6: Run the property suite**

Run: `cargo nextest run -p redextape-core --test format_properties`

Expected: PASS, eight tests (five example-based, three proptests). A failure here is a real printer defect — read the shrunk counterexample rather than adjusting the property.

- [ ] **Step 7: Run the full gate**

Run: `scripts/check-all.sh --no-llvm --no-browser`

Expected: green, including `cargo fmt --all --check`, clippy at `-D warnings`, the wasm `--lib` check, and the coverage floor at 90.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/src/lib.rs crates/redextape-core/tests/format_properties.rs
git commit -F - <<'MSG'
format: the entry point and the six properties

`format(src)` is `print ∘ parse` with diagnostics on failure and no partial output.
Idempotence, comment preservation, value preservation, reparseability and the width
budget are pinned on a corpus and on generated programs; the printer's visit order
is pinned inside `printer.rs` where the traversal lives.
MSG
```

---

## Task 11: Roadmap entry and spec addenda

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`
- Modify: `docs/superpowers/specs/2026-08-18-surface-trivia-and-printer-design.md`

- [ ] **Step 1: Fold the two planning findings into the spec**

Add a `## §13 Found while planning` section to the design document recording, in the house style, the two items from this plan's "Spec addenda" block: the iterative left-spine requirement (with the `ast.rs` `Drop` precedent) and the parenthesization requirement (with the binding-power table). Note that both were found by mapping the spec onto the code and neither was visible from the spec alone.

- [ ] **Step 2: Write the roadmap close entry**

Append a `#### THE `fmt` BLOCKER CLOSES — …` entry to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, following the shape every entry since 5d-ii-a uses. It must state:

- what closed: Plan 4's deferral item 4 and Plan 6's comment-retention blocker, both of them, from one decision.
- the commit range and the measured diffstat, excluding this branch's own design and plan documents and stating the exclusion.
- the two defects the planning pass found in the spec, and that a green spec review had not found them.
- what this did NOT close: `crates/redextape-cli` is still unbuilt, `parse_asm` is still unclaimed, λ/TM/asm printers are untouched, and comment content is never re-wrapped.
- the calibration probe's four readings and whether any moved a rule.
- that `span_wellformed.rs`'s deferred test fired exactly where its author predicted, which is the cheapest confirmation in the branch and worth recording as evidence the device works.

Update Plan 4's deferral item 4 and Plan 6's survey note to strike through the closed text rather than deleting it, matching how every other closed item in that file reads.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md \
        docs/superpowers/specs/2026-08-18-surface-trivia-and-printer-design.md
git commit -F - <<'MSG'
roadmap: the fmt blocker closes

Plan 4's deferral item 4 and Plan 6's comment-retention blocker were the same
decision, and both close here. Two defects the spec did not have are recorded in
its own §13 rather than only in the plan that found them.
MSG
```

---

## Verification

Run before opening the PR:

```bash
scripts/check-all.sh --no-llvm --no-browser
```

Every one of the following must be true, and each is checkable rather than asserted:

1. `cargo nextest run -p redextape-core` and `-p redextape-native` both green — `parse`'s ~25 call sites are unchanged by construction, and the native crate is where most of them live.
2. `cargo clippy --workspace --all-targets -- -D warnings` clean under `pedantic` with no global allows.
3. `cargo llvm-cov nextest --workspace --fail-under-lines 90` at or above the floor.
4. `cargo check --target wasm32-unknown-unknown -p redextape-core --lib` green — no dependency was added.
5. `rg 'TokenClass::Comment' crates/redextape-core/src` shows a producer, not only a declaration.
6. `cargo run -p redextape-core --example rustfmt_calibration_probe` runs, and its four readings are recorded in its own module doc with a date and a rustfmt version.
