# tree-sitter grammars — PR 1: harness plus the mini-language

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ship a tree-sitter grammar for the mini-language plus the machinery that holds it against the hand-written front end, so that a grammar which colours something differently from `classify_source` fails a test.

**Architecture:** `grammars/tree-sitter-redextape/` holds `grammar.js` and its committed generated output. A new test-only workspace crate, `crates/redextape-grammar-check`, compiles the generated `parser.c` through `cc` in a `build.rs`, runs `queries/highlights.scm` over corpus text, projects each capture through a single `capture -> TokenClass` map, and asserts the result equals `redextape_core::analysis::classify_source` span for span. A new leg in `scripts/check-all.sh` regenerates the parser and fails if the committed copy differs.

**Tech Stack:** tree-sitter CLI 0.25.10 (generation), the `tree-sitter` Rust crate 0.26 (loading and querying), `cc` 1 (compiling the generated C), `proptest` 1 via `redextape-test-support` (generated corpus).

**Design:** [`../specs/2026-08-20-tree-sitter-grammars-design.md`](../specs/2026-08-20-tree-sitter-grammars-design.md). This plan implements that spec's PR 1 (§10). PRs 2 and 3 — the λ and TM grammars — get their own plans.

## Global Constraints

Every task's requirements implicitly include all of these.

- **Highlighting only.** The grammar produces a CST and is never lowered into Core. No task in this plan may add a code path from a tree-sitter node to a `redextape_core` AST type.
- **Never `web/`.** No file under `web/` is created or modified by this plan.
- **`redextape-core` is not modified.** Its manifest gains nothing. The new crate depends on it, never the reverse.
- **Byte offsets throughout.** `Node::start_byte`/`end_byte` and `redextape_core::Span` are the same unit. Nothing in this plan converts offsets.
- **No reduction.** No task calls `reduce_trace`, `reduce`, or any λ reducer. A λ measurement that reduces has previously cost this machine 60 GiB of RAM and all of swap.
- **Pinned versions.** tree-sitter CLI **`0.25.10`** — NOT the newest; 0.26+ binaries need glibc 2.39 and the CI runner has 2.35 (design §8.1.1). `/usr/sbin/tree-sitter` reports `0.27.0` but is Arch's `tree-sitter-cli-git` off `master` and no such release exists (design §8.1). Generated language ABI `15`, which the released CLI reaches only when `tree-sitter.json` is present. `tree-sitter` Rust crate `0.26`.
- **Pre-commit gate runs on every commit** — `cargo fmt --check`, `cargo clippy -- -D warnings`, the control-byte scan and the citation scan. Never pass `--no-verify`. If a commit split in this plan turns out to be infeasible because an intermediate state does not pass clippy, collapse the commits and say so in the PR.
- **No `file:line` citations in tracked source.** `scripts/check-citations.sh` rejects them outside `docs/`. Cite the symbol.
- **No C0 control bytes** in any tracked text file except TAB, LF, CR.
- **Test code is exempt from `clippy::pedantic`** via `#![cfg_attr(test, allow(clippy::pedantic))]`, following `redextape-test-support`.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `grammars/tree-sitter-redextape/grammar.js` | the mini-language grammar — the only hand-edited grammar file |
| `grammars/tree-sitter-redextape/queries/highlights.scm` | capture assignments; overlapping captures must project to the same class |
| `grammars/tree-sitter-redextape/test/corpus/*.txt` | `tree-sitter test` cases over tree shape |
| `grammars/tree-sitter-redextape/README.md` | install snippets for nvim-treesitter, Helix, Zed |
| `grammars/tree-sitter-redextape/src/**` | generated: `parser.c`, `grammar.json`, `node-types.json`, `tree_sitter/*.h` |
| `crates/redextape-grammar-check/Cargo.toml` | manifest for the test-only crate |
| `crates/redextape-grammar-check/build.rs` | compiles `parser.c` via `cc` |
| `crates/redextape-grammar-check/src/lib.rs` | the language handle, the corpus, the capture map, the comparison |
| `crates/redextape-grammar-check/tests/corpus.rs` | every corpus program parses without ERROR nodes |
| `crates/redextape-grammar-check/tests/captures.rs` | the capture map's totality and the overlap rule |
| `crates/redextape-grammar-check/tests/differential.rs` | the differential over the hand-written corpus |
| `crates/redextape-grammar-check/tests/generated.rs` | the differential over generated programs |

**Modified:**

| Path | Change |
|---|---|
| `Cargo.toml` | add `crates/redextape-grammar-check` to `[workspace] members` |
| `scripts/check-all.sh` | `ensure_treesitter`, a `grammar` leg kind, one `base` row, one entry in the kind validator |
| `scripts/setup-dev.sh` | install the tree-sitter CLI |
| `.forgejo/workflows/ci.yml` | install the tree-sitter CLI in the jobs that reach a base-tier leg |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the closing entry |

---

## Task 1: The mini-language grammar

**Files:**
- Create: `grammars/tree-sitter-redextape/grammar.js`
- Create: `grammars/tree-sitter-redextape/test/corpus/expressions.txt`
- Create: `grammars/tree-sitter-redextape/test/corpus/statements.txt`
- Generated (committed, not hand-edited): `grammars/tree-sitter-redextape/src/parser.c`, `src/grammar.json`, `src/node-types.json`, `src/tree_sitter/*.h`

**Interfaces:**
- Consumes: nothing.
- Produces: a tree-sitter language named `redextape`, exporting the C symbol `tree_sitter_redextape()`. Node names later tasks query: `source_file`, `let_statement`, `function_definition`, `while_statement`, `assignment`, `expression_statement`, `block`, `parameters`, `arguments`, `binary_expression`, `call_expression`, `method_call`, `list`, `closure`, `if_expression`, `parenthesized_expression`, `identifier`, `number`, `boolean`, `comment`. Fields: `name`, `value`, `target`, `condition`, `body`, `function`, `receiver`, `method`, `parameter`.

**The grammar this must match.** Read from `crates/redextape-core/src/lexer.rs` and `parser.rs` at `ef4f130`:

- Comments are `//` to the byte before the newline. Identifiers are `[_A-Za-z][_A-Za-z0-9]*`, ASCII only. Numbers are `[0-9]+`. Keywords: `fn let mut if else while true false`.
- Two-character operators are matched before their one-character prefixes: `== != <= >=`. One-character: `+ - * < > = ( ) { } [ ] , ; | .`
- Binary operators are **left-associative** with three binding powers: comparisons `== != < <= > >=` = 1, additive `+ -` = 2, multiplicative `*` = 3.
- `if` **requires** an `else`. There is no `else if` chain in the parser and no bare `if`.
- Trailing commas are accepted in parameter lists, argument lists and list literals.
- A block is statements followed by an optional tail expression with no semicolon. `source_file` is a block body with no braces.
- Closures are `|params| expr` — a single expression body, not a block (a block is reachable as that expression).

- [ ] **Step 1: Write the failing corpus tests**

Create `grammars/tree-sitter-redextape/test/corpus/expressions.txt`:

```
================================================================================
binary precedence is left-associative, comparisons loosest
================================================================================

1 + 2 * 3 == 4 - 5

--------------------------------------------------------------------------------

(source_file
  (binary_expression
    (binary_expression
      (number)
      (binary_expression
        (number)
        (number)))
    (binary_expression
      (number)
      (number))))

================================================================================
calls, method chains and list literals
================================================================================

[3, 1, 2].map(add1).fold(0, add)

--------------------------------------------------------------------------------

(source_file
  (method_call
    (method_call
      (list
        (number)
        (number)
        (number))
      (identifier)
      (arguments
        (identifier)))
    (identifier)
    (arguments
      (number)
      (identifier))))

================================================================================
if requires an else, and closures take one expression
================================================================================

let f = |x| if x > 0 { 1 } else { 0 };
f(2)

--------------------------------------------------------------------------------

(source_file
  (let_statement
    (identifier)
    (closure
      (parameters
        (identifier))
      (if_expression
        (binary_expression
          (identifier)
          (number))
        (block
          (number))
        (block
          (number)))))
  (call_expression
    (identifier)
    (arguments
      (number))))
```

Create `grammars/tree-sitter-redextape/test/corpus/statements.txt`:

```
================================================================================
a function, a mutable let, a while loop and a tail expression
================================================================================

fn count_down(n) {
    let mut acc = 0;
    while n > 0 { acc = acc + 1; n = n - 1; }
    acc
}
count_down(3)

--------------------------------------------------------------------------------

(source_file
  (function_definition
    (identifier)
    (parameters
      (identifier))
    (block
      (let_statement
        (identifier)
        (number))
      (while_statement
        (binary_expression
          (identifier)
          (number))
        (block
          (assignment
            (identifier)
            (binary_expression
              (identifier)
              (number)))
          (assignment
            (identifier)
            (binary_expression
              (identifier)
              (number)))))
      (identifier)))
  (call_expression
    (identifier)
    (arguments
      (number))))

================================================================================
comments on their own line and trailing
================================================================================

// leading
let x = 1; // trailing
x + 1

--------------------------------------------------------------------------------

(source_file
  (comment)
  (let_statement
    (identifier)
    (number))
  (comment)
  (binary_expression
    (identifier)
    (number)))
```

- [ ] **Step 2: Run the corpus tests to verify they fail**

```bash
cd grammars/tree-sitter-redextape && tree-sitter test
```

Expected: FAIL — there is no `grammar.js`, so the CLI errors before running a single case.

- [ ] **Step 3: Write `grammar.js`**

```js
/**
 * The redextape mini-language, for editor highlighting ONLY.
 *
 * THIS IS NOT AN AUTHORITATIVE GRAMMAR. `crates/redextape-core/src/parser.rs` is the semantic source
 * of truth and owns the canonical printer; this file may never be lowered into Core. Its agreement
 * with the real front end is enforced by `crates/redextape-grammar-check`, which compares every
 * highlight capture against `analysis::classify_source` span for span.
 *
 * NO KNOWN DIVERGENCE FROM THE REAL PARSER, and an earlier draft of this file had one. That draft
 * excluded braced blocks from callee, receiver and condition position — `_expression_except_block`,
 * the device Rust's own tree-sitter grammar uses — assuming `while n > 0 { .. }` would otherwise be
 * ambiguous. It is not: the generated parser resolves all three positions with no declared conflict.
 * The exclusion was REJECTING INPUT THE REAL PARSER ACCEPTS: `parse_postfix` runs its call and method
 * postfixes on any atom `parse_atom` produced, blocks included, so `{ f }(1)`, `{ f }.m(1)` and
 * `while { a } { b }` are all legal and all came back as ERROR nodes. In an editor that shows a valid
 * file as an error region, and nothing in CI would have caught it — the differential refuses a source
 * that produces ERROR nodes rather than comparing it.
 */
module.exports = grammar({
  name: 'redextape',

  // `word` makes the generated parser extract keywords from this token, which is what stops
  // `letter` from lexing as `let` followed by `ter`.
  word: $ => $.identifier,

  extras: $ => [/\s/, $.comment],

  rules: {
    // A source file is a block body with no braces: statements, then an optional tail expression
    // carrying no semicolon.
    source_file: $ => seq(repeat($._statement), optional($._expression)),

    _statement: $ => choice(
      $.let_statement,
      $.function_definition,
      $.while_statement,
      $.assignment,
      $.expression_statement,
    ),

    let_statement: $ => seq(
      'let',
      optional('mut'),
      field('name', $.identifier),
      '=',
      field('value', $._expression),
      ';',
    ),

    function_definition: $ => seq(
      'fn',
      field('name', $.identifier),
      '(',
      optional($.parameters),
      ')',
      field('body', $.block),
    ),

    while_statement: $ => seq(
      'while',
      field('condition', $._expression),
      field('body', $.block),
    ),

    assignment: $ => seq(
      field('target', $.identifier),
      '=',
      field('value', $._expression),
      ';',
    ),

    expression_statement: $ => seq($._expression, ';'),

    block: $ => seq('{', repeat($._statement), optional($._expression), '}'),

    parameters: $ => seq(
      field('parameter', $.identifier),
      repeat(seq(',', field('parameter', $.identifier))),
      optional(','),
    ),

    arguments: $ => seq($._expression, repeat(seq(',', $._expression)), optional(',')),

    // Blocks are included. See the note above on why excluding them was wrong.
    _expression: $ => choice(
      $.binary_expression,
      $.call_expression,
      $.method_call,
      $.if_expression,
      $.closure,
      $.list,
      $.parenthesized_expression,
      $.block,
      $.identifier,
      $.number,
      $.boolean,
    ),

    // Binding powers mirror `parser.rs`'s `infix_op` exactly: comparisons 1, additive 2,
    // multiplicative 3, all left-associative (`parse_binary_inner` recurses at `bp + 1`).
    binary_expression: $ => choice(
      prec.left(1, seq($._expression, choice('==', '!=', '<', '<=', '>', '>='), $._expression)),
      prec.left(2, seq($._expression, choice('+', '-'), $._expression)),
      prec.left(3, seq($._expression, '*', $._expression)),
    ),

    // Postfix binds tighter than any infix operator, matching `parse_postfix` running inside
    // `parse_binary_inner`'s operand position.
    call_expression: $ => prec(10, seq(
      field('function', $._expression),
      '(',
      optional($.arguments),
      ')',
    )),

    method_call: $ => prec(10, seq(
      field('receiver', $._expression),
      '.',
      field('method', $.identifier),
      '(',
      optional($.arguments),
      ')',
    )),

    // `else` is REQUIRED — `parse_atom` calls `expect(TokenKind::Else)`. There is no `else if`.
    if_expression: $ => seq(
      'if',
      field('condition', $._expression),
      field('consequence', $.block),
      'else',
      field('alternative', $.block),
    ),

    closure: $ => seq('|', optional($.parameters), '|', field('body', $._expression)),

    // NOT `optional($.arguments)`: `parse_atom`'s `LBracket` arm builds `Expr::List { items }` with
    // no wrapper node, so delegating here would wrap list elements in a spurious `arguments`.
    list: $ => seq(
      '[',
      optional(seq($._expression, repeat(seq(',', $._expression)), optional(','))),
      ']',
    ),

    parenthesized_expression: $ => seq('(', $._expression, ')'),

    identifier: $ => /[_A-Za-z][_A-Za-z0-9]*/,

    number: $ => /[0-9]+/,

    boolean: $ => choice('true', 'false'),

    comment: $ => token(seq('//', /[^\n]*/)),
  },
});
```

- [ ] **Step 4: Generate the parser and run the corpus tests**

```bash
cd grammars/tree-sitter-redextape && tree-sitter generate && tree-sitter test
```

Expected: PASS, all five cases. If `tree-sitter generate` reports a conflict, the fix is a `prec`
adjustment in `grammar.js` — never adding a case to the corpus to match wrong output. If a corpus
case fails, read the actual tree the CLI prints and decide which side is wrong by checking
`parser.rs`; the corpus above was written from that file, not from the grammar.

- [ ] **Step 5: Confirm the generated ABI is 15**

```bash
grep -m1 LANGUAGE_VERSION grammars/tree-sitter-redextape/src/parser.c
```

Expected: `#define LANGUAGE_VERSION 15`. **If it reads 14, `tree-sitter.json` is missing or unreadable**
— the released CLI warns and falls back to ABI 14 without it — and Task 2 will then fail to load the
parser with an error that looks like a build problem rather than a version problem.

- [ ] **Step 6: Commit**

```bash
git add grammars/tree-sitter-redextape
git commit -m "grammar: the mini-language, generated at ABI 15"
```

---

## Task 2: The check crate loads and parses

**Files:**
- Create: `crates/redextape-grammar-check/Cargo.toml`
- Create: `crates/redextape-grammar-check/build.rs`
- Create: `crates/redextape-grammar-check/src/lib.rs`
- Create: `crates/redextape-grammar-check/tests/corpus.rs`
- Modify: `Cargo.toml` — `[workspace] members`

**Interfaces:**
- Consumes: `tree_sitter_redextape()` from Task 1.
- Produces: `pub fn language() -> tree_sitter::Language`, `pub fn parse(src: &str) -> Result<tree_sitter::Tree, String>`, `pub const CORPUS: &[(&str, &str)]` (name, source), and `pub fn error_nodes(tree: &Tree) -> Vec<Span>` returning byte ranges of `ERROR`/`MISSING` nodes as `redextape_core::Span`.

**Why the fallible signatures.** `[workspace.lints.clippy]` warns on `expect_used`/`unwrap_used`/`panic`
and CI makes that fatal; `clippy.toml`'s exemption reaches only code lexically inside a `#[test]` fn or
a `#[cfg(test)]` module, which `src/lib.rs` is not. So every library path here returns `Result` and the
tests — which the exemption does reach — unwrap. This is the workspace's stated rule (*"no library path
may panic: every failure is a `Diagnostic`, a `RuntimeError`, or a typed `Err`"*), not a concession to
the linter: an ABI mismatch is a real failure mode and its message is more useful than an abort.

- [ ] **Step 1: Add the crate to the workspace**

In `Cargo.toml`, add to `[workspace] members`, keeping the list alphabetical:

```toml
    "crates/redextape-core",
    "crates/redextape-grammar-check",
    "crates/redextape-native",
```

- [ ] **Step 2: Write the manifest**

Create `crates/redextape-grammar-check/Cargo.toml`:

```toml
[package]
name = "redextape-grammar-check"
version = "0.0.0"
edition.workspace = true
license.workspace = true
repository.workspace = true
publish = false

[lints]
workspace = true

[dependencies]
tree-sitter = "0.26"

[dev-dependencies]
redextape-core = { path = "../redextape-core" }
redextape-test-support = { path = "../redextape-test-support" }
proptest = "1"

[build-dependencies]
cc = "1"
```

- [ ] **Step 3: Write `build.rs`**

```rust
//! Compiles the committed generated parsers into this crate.
//!
//! The C is a BUILD ARTIFACT CHECKED INTO GIT, which is the tree-sitter convention and the reason
//! `scripts/check-all.sh` carries a `grammar` leg: nothing here can tell whether `parser.c` was
//! generated from the `grammar.js` sitting beside it, so a separate gate regenerates and diffs.

use std::path::Path;

fn main() {
    let dir = Path::new("../../grammars/tree-sitter-redextape/src");
    cc::Build::new()
        .include(dir)
        .file(dir.join("parser.c"))
        // The generated C is not ours to keep warning-clean, and its warnings would drown the
        // workspace's own under `-D warnings`.
        .warnings(false)
        .compile("tree-sitter-redextape");
    println!("cargo:rerun-if-changed={}", dir.join("parser.c").display());
}
```

- [ ] **Step 4: Write the failing test**

Create `crates/redextape-grammar-check/tests/corpus.rs`:

```rust
#![cfg_attr(test, allow(clippy::pedantic))]

use redextape_grammar_check::{CORPUS, error_nodes, parse};

#[test]
fn every_corpus_program_parses_without_error_nodes() {
    for (name, src) in CORPUS {
        let tree = parse(src).expect("the pinned ABI must load");
        let errors = error_nodes(&tree);
        assert!(errors.is_empty(), "`{name}` produced ERROR/MISSING nodes at {errors:?}");
    }
}
```

- [ ] **Step 5: Run it to verify it fails**

```bash
cargo nextest run -p redextape-grammar-check
```

Expected: FAIL to compile — `redextape_grammar_check` has no `CORPUS`, `error_nodes` or `parse`.

- [ ] **Step 6: Write `src/lib.rs`**

```rust
//! Holds the tree-sitter grammars to the hand-written front end.
//!
//! **A TEST-ONLY CRATE, and that is why it is a crate.** The natural home for this would be a module
//! inside `redextape-core`, but that would put `tree-sitter` and a C `build-dependency` in the
//! manifest of the crate whose whole identity is being WASM-clean. `redextape-test-support` exists
//! for the same reason and states it the same way.
//!
//! **NOTHING HERE MAY LOWER A CST.** The roadmap's tree-sitter entry permits a highlighting-only
//! lane and forbids a second authoritative grammar; its test for "authoritative" is lowering. A
//! tree-sitter node reaching a `redextape_core` AST type is the line this crate must not cross.

use redextape_core::Span;
use tree_sitter::{Language, Node, Parser, Tree};

unsafe extern "C" {
    fn tree_sitter_redextape() -> *const ();
}

/// The mini-language grammar, loaded from the generated parser this crate compiles.
#[must_use]
pub fn language() -> Language {
    // SAFETY: `tree_sitter_redextape` is generated by `tree-sitter generate` and returns a pointer
    // to a `'static` `TSLanguage`. The ABI it was generated at is pinned to 15 and checked by
    // `abi_version_is_pinned` below, so a toolchain bump that changes it fails here by name rather
    // than as an opaque `set_language` error.
    unsafe { std::mem::transmute(tree_sitter_redextape()) }
}

/// Parse mini-language source.
///
/// # Errors
///
/// Returns a message when the generated parser's ABI is incompatible with the linked `tree-sitter`
/// crate. That is the failure a toolchain bump produces, and it is why this returns `Result` rather
/// than panicking: a bare abort here reads like a build problem rather than a version problem.
pub fn parse(src: &str) -> Result<Tree, String> {
    let mut p = Parser::new();
    p.set_language(&language()).map_err(|e| {
        format!("the generated parser's ABI is incompatible with the linked tree-sitter crate: {e}")
    })?;
    p.parse(src, None)
        .ok_or_else(|| "tree-sitter produced no tree; it returns None only under a timeout or cancellation, and neither is set".to_string())
}

/// Byte ranges of every `ERROR` and `MISSING` node, in offset order.
///
/// A corpus entry that fails to parse would otherwise yield an empty capture list and compare equal
/// to nothing, so the differential checks this first rather than separately.
#[must_use]
pub fn error_nodes(tree: &Tree) -> Vec<Span> {
    let mut out = Vec::new();
    let mut cursor = tree.walk();
    let mut stack = vec![tree.root_node()];
    while let Some(node) = stack.pop() {
        if node.is_error() || node.is_missing() {
            out.push(Span::new(node.start_byte(), node.end_byte()));
        }
        stack.extend(node.children(&mut cursor).collect::<Vec<Node>>());
    }
    out.sort_by_key(|s| s.start);
    out
}

/// Hand-written corpus. Covers what `arb_expr_over` cannot reach: `fn`, `while`, closures, UFCS
/// chains, list literals, comments, and `mut`.
pub const CORPUS: &[(&str, &str)] = &[
    ("empty", ""),
    ("tail expression only", "1 + 2 * 3"),
    ("comparison and booleans", "if 1 == 1 { true } else { false }"),
    ("let and mut", "let mut acc = 0;\nacc"),
    ("assignment", "let mut n = 3;\nn = n - 1;\nn"),
    ("function and call", "fn double(n) { n * 2 }\ndouble(21)"),
    ("while loop", "let mut n = 3;\nwhile n > 0 { n = n - 1; }\nn"),
    ("closure", "let add1 = |x| x + 1;\nadd1(1)"),
    ("closure with two parameters", "let add = |a, b| a + b;\nadd(1, 2)"),
    ("ufcs chain", "[3, 1, 2].map(|x| x + 1).fold(0, |a, b| a + b)"),
    ("trailing commas", "fn f(a, b,) { a + b }\nf(1, 2,)"),
    ("comments", "// leading\nlet x = 1; // trailing\nx + 1"),
    ("nested blocks", "let x = { let y = 1; y + 1 };\nx"),
];

#[cfg(test)]
mod tests {
    use super::*;

    /// A toolchain bump that changes the generated ABI past what the Rust crate reads presents as a
    /// bare `set_language` failure, which reads like a build error rather than a version error.
    /// Pinning it here makes the message name the real cause.
    #[test]
    fn abi_version_is_pinned() {
        assert_eq!(language().abi_version(), 15, "regenerate with the pinned tree-sitter CLI 0.25.10; ABI 14 means tree-sitter.json was not picked up");
    }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cargo nextest run -p redextape-grammar-check
```

Expected: PASS — `every_corpus_program_parses_without_error_nodes` and `abi_version_is_pinned`.

- [ ] **Step 8: Check clippy, since the pre-commit hook will**

```bash
cargo clippy -p redextape-grammar-check --all-targets -- -D warnings
```

Expected: no warnings. `pedantic` is on workspace-wide; if it fires on the `transmute`, resolve it on
its merits rather than adding a workspace-level `allow`.

- [ ] **Step 9: Commit**

```bash
git add Cargo.toml Cargo.lock crates/redextape-grammar-check
git commit -m "grammar-check: load the generated parser and pin its ABI"
```

---

## Task 3: Highlight queries and the capture map

**Files:**
- Create: `grammars/tree-sitter-redextape/queries/highlights.scm`
- Modify: `crates/redextape-grammar-check/src/lib.rs` — add `HIGHLIGHTS`, `CAPTURE_CLASSES`, `class_for`, `query_capture_names`, `captures`
- Create: `crates/redextape-grammar-check/tests/captures.rs`

**Interfaces:**
- Consumes: node names and fields from Task 1; `parse` and `language` from Task 2.
- Produces: `pub const HIGHLIGHTS: &str`, `pub const CAPTURE_CLASSES: &[(&str, TokenClass)]`, `pub fn class_for(capture: &str) -> Option<TokenClass>`, `pub fn query_capture_names() -> Result<Vec<String>, String>`, `pub fn captures(src: &str) -> Result<Vec<(Span, TokenClass)>, String>`, and `pub fn captures_with(query_src: &str, src: &str) -> Result<Vec<(Span, TokenClass)>, String>` — the same, over a caller-supplied query, so a test can prove the disagreement check fires.

**How overlapping captures are resolved, and why it is not pattern order.** A real `highlights.scm`
puts a broad `(identifier) @variable` alongside narrow patterns like `(call_expression function:
(identifier) @function.call)`, and relies on the editor's highlight layer applying override
semantics. A raw `QueryCursor` has no such layer — it returns every match — so one identifier comes
back captured twice.

Enumerating every parent position to make the patterns disjoint is the obvious fix and it is a trap:
the positions an `identifier` can occupy include `method_call receiver:` and `if_expression
condition:`, both easy to miss, and a missed one leaves a token *uncaptured*, which fails the
differential in Task 4 with a message about a length mismatch rather than about the query.

**The rule instead: overlapping captures must AGREE on their `TokenClass`, and one is kept.** This
works because every identifier capture — `@variable`, `@variable.parameter`, `@function`,
`@function.call` — projects to `Ident` regardless. It is robust against a query that overlaps in a
way nobody enumerated, and it turns the one case that would matter — two captures projecting to
*different* classes — into an `Err` instead of a silent choice.

**And that `Err` is proved reachable rather than assumed.** `captures_with` takes the query as an
argument so `a_conflicting_query_is_rejected` can run a deliberately-broken one — `(identifier)
@variable` alongside `(identifier) @operator`, two rows of `CAPTURE_CLASSES` that disagree — and
assert the error actually happens. A check nobody has seen fail is a check nobody has tested, which
is the standard Task 6 Step 5 holds the regenerate leg to.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-grammar-check/tests/captures.rs`:

```rust
#![cfg_attr(test, allow(clippy::pedantic))]

use redextape_core::analysis::TokenClass;
use redextape_grammar_check::{
    CAPTURE_CLASSES, CORPUS, captures, captures_with, class_for, query_capture_names,
};

/// Every capture name any query emits must have a class. Adding a capture without deciding its class
/// would otherwise colour something in an editor that the differential then silently ignores.
#[test]
fn the_capture_map_is_total_over_the_queries() {
    for name in query_capture_names().expect("highlights.scm must compile") {
        assert!(
            class_for(&name).is_some(),
            "`@{name}` appears in highlights.scm with no entry in CAPTURE_CLASSES"
        );
    }
}

/// The map is a function: one capture name, one class.
#[test]
fn the_capture_map_has_no_duplicate_keys() {
    let mut seen = std::collections::BTreeSet::new();
    for (name, _) in CAPTURE_CLASSES {
        assert!(seen.insert(*name), "`@{name}` appears twice in CAPTURE_CLASSES");
    }
}

/// `class_of` maps `TokenKind::True | TokenKind::False` to `Bool`, not `Keyword`, and the instinct
/// when writing a grammar is to capture them as `@keyword`. This is the pin on that trap.
#[test]
fn booleans_are_bool_and_keywords_are_keyword() {
    let got = captures("let x = true;").expect("the corpus query must run");
    let classes: Vec<TokenClass> = got.iter().map(|(_, c)| *c).collect();
    assert!(classes.contains(&TokenClass::Bool), "expected a Bool among {classes:?}");
    assert!(classes.contains(&TokenClass::Keyword), "expected a Keyword among {classes:?}");
}

/// `captures` collapses overlapping captures, so its output has one entry per byte range.
/// Pins what `captures` actually returns for one source, text and class together.
///
/// REPLACES A TAUTOLOGY. This test used to dedup the returned spans and assert the length was
/// unchanged — which a `BTreeMap` keyed by `(start, end)` guarantees before the test runs, so it
/// could not fail for any implementation that used one. Asserting on real content can.
#[test]
fn captures_pins_text_and_class_for_one_source() {
    let src = "let mut x = 1; // hi";
    let got = captures(src).expect("the corpus query must run");
    let pairs: Vec<(&str, TokenClass)> =
        got.iter().map(|(s, c)| (&src[s.start..s.end], *c)).collect();
    assert_eq!(
        pairs,
        vec![
            ("let", TokenClass::Keyword),
            ("mut", TokenClass::Keyword),
            ("x", TokenClass::Ident),
            ("=", TokenClass::Operator),
            ("1", TokenClass::Nat),
            (";", TokenClass::Punct),
            ("// hi", TokenClass::Comment),
        ]
    );
}

/// A row no query uses is a row a query edit left behind. Testable only because the tables are
/// per-grammar — design §5.1.
#[test]
fn every_map_row_is_used_by_a_query() {
    let used = query_capture_names().expect("highlights.scm must compile");
    for (name, _) in CAPTURE_CLASSES {
        assert!(used.iter().any(|u| u == name), "`@{name}` is in CAPTURE_CLASSES but no query uses it");
    }
}

/// The shipped queries overlap deliberately and must agree everywhere in the corpus.
#[test]
fn the_shipped_queries_never_disagree() {
    for (name, src) in CORPUS {
        if let Err(why) = captures(src) {
            panic!("`{name}`: {why}");
        }
    }
}

/// THE COLLAPSE IS ONLY SOUND BECAUSE OVERLAPPING CAPTURES AGREE, so the check that they do must be
/// shown capable of failing. `@variable` projects to `Ident` and `@operator` to `Operator`, so this
/// query captures every identifier as two different classes at one byte range.
#[test]
fn a_conflicting_query_is_rejected() {
    let conflicting = "(identifier) @variable\n(identifier) @operator\n";
    let err = captures_with(conflicting, "let x = 1;")
        .expect_err("two captures projecting to different classes must not be collapsed silently");
    assert!(err.contains("disagree"), "the message must say what happened, got: {err}");
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cargo nextest run -p redextape-grammar-check --test captures
```

Expected: FAIL to compile — no `HIGHLIGHTS`, `CAPTURE_CLASSES`, `class_for`, `query_capture_names`,
`captures` or `captures_with`.

- [ ] **Step 3: Write the queries**

Create `grammars/tree-sitter-redextape/queries/highlights.scm`:

```scheme
; Highlight captures for the redextape mini-language.
;
; THE BROAD `(identifier) @variable` PATTERN AND THE NARROW ONES BELOW IT DELIBERATELY OVERLAP. An
; editor resolves that by override order; `crates/redextape-grammar-check` reads raw query matches
; instead, and resolves it by requiring the overlapping captures to project to the same TokenClass —
; which they do, since every identifier role is `Ident`. Adding a pattern that overlaps an existing
; one with a DIFFERENT class is what that check exists to catch.

; Keywords. `true`/`false` are NOT here: `class_of` in `analysis.rs` maps them to `TokenClass::Bool`.
["fn" "let" "mut" "if" "else" "while"] @keyword

(boolean) @boolean

(number) @number

(comment) @comment

["==" "!=" "<" "<=" ">" ">=" "+" "-" "*" "="] @operator

["(" ")" "{" "}" "[" "]"] @punctuation.bracket

; `.` and `|` are `Punct` in `class_of`, NOT `Operator` — `TokenKind::Dot` and `TokenKind::Pipe` fall
; in the punctuation arm. Capturing either as `@operator` is the single most likely way to fail the
; differential in Task 4.
["," ";" "." "|"] @punctuation.delimiter

; Every identifier, whatever its role. Required: without it, an identifier in a position no narrow
; pattern below names would go uncaptured and the differential would fail on a length mismatch.
(identifier) @variable

; Roles, refining the above for an editor's benefit. All project to `Ident`, so the differential
; cannot tell them apart — design §6.1 states that gap and prices the alternatives.
(call_expression function: (identifier) @function.call)
(method_call method: (identifier) @function.call)
(function_definition name: (identifier) @function)
(parameters parameter: (identifier) @variable.parameter)
```

- [ ] **Step 4: Add the map and the capture runner**

Append to `crates/redextape-grammar-check/src/lib.rs`:

```rust
use redextape_core::analysis::TokenClass;
use tree_sitter::{Query, QueryCursor, StreamingIterator};

/// The mini-language's highlight queries, compiled into the binary so the test needs no file I/O and
/// cannot read a stale copy out of a build directory.
pub const HIGHLIGHTS: &str =
    include_str!("../../../grammars/tree-sitter-redextape/queries/highlights.scm");

/// Where the two vocabularies meet, FOR THE MINI-LANGUAGE. λ and TM get their own tables when their
/// grammars land; design §5.1 records why one shared table was wrong — `@variable.parameter` is an
/// `Ident` here, where `class_of` calls a parameter an identifier, and a `Binder` in λ, where
/// `print_lambda_mapped` folds the bound name into the binder. Both are right for their own language.
///
/// Standard tree-sitter capture names on the left, because editors' themes are written against them;
/// `TokenClass` on the right, because that is what the hand-written front end produces. The table is
/// a function — `the_capture_map_has_no_duplicate_keys` pins that — total over every capture the
/// queries emit (`the_capture_map_is_total_over_the_queries`), and carries no row no query uses
/// (`every_map_row_is_used_by_a_query`).
///
/// The extra granularity on the left is DELIBERATELY UNCHECKED: `@function.call` and `@variable` both
/// project to `Ident`, so a grammar capturing every identifier as a call would pass the differential.
/// Design §6.1 prices the two alternatives and says why neither was taken.
pub const CAPTURE_CLASSES: &[(&str, TokenClass)] = &[
    ("keyword", TokenClass::Keyword),
    ("boolean", TokenClass::Bool),
    ("number", TokenClass::Nat),
    ("comment", TokenClass::Comment),
    ("operator", TokenClass::Operator),
    ("punctuation.bracket", TokenClass::Punct),
    ("punctuation.delimiter", TokenClass::Punct),
    ("function", TokenClass::Ident),
    ("function.call", TokenClass::Ident),
    ("variable", TokenClass::Ident),
    ("variable.parameter", TokenClass::Ident),
];

/// The class a capture name projects to, or `None` if the map does not cover it.
#[must_use]
pub fn class_for(capture: &str) -> Option<TokenClass> {
    CAPTURE_CLASSES.iter().find(|(n, _)| *n == capture).map(|(_, c)| *c)
}

/// Every capture name the queries actually use.
///
/// # Errors
///
/// Returns the compile error if `highlights.scm` is not a valid query for this grammar — which is
/// what a query naming a node the grammar no longer has produces.
pub fn query_capture_names() -> Result<Vec<String>, String> {
    let q = Query::new(&language(), HIGHLIGHTS).map_err(|e| format!("highlights.scm: {e}"))?;
    Ok(q.capture_names().iter().map(|n| (*n).to_string()).collect())
}

/// Run the highlight queries over `src` and project every capture through `CAPTURE_CLASSES`.
///
/// Returns offset-ordered `(Span, TokenClass)` with ONE ENTRY PER BYTE RANGE — the same shape and the
/// same unit as `analysis::classify_source`, which is what makes the comparison in
/// `tests/differential.rs` a direct equality rather than a reconciliation.
///
/// **Overlapping captures are collapsed, and disagreement is an `Err` rather than a choice.** The
/// broad `(identifier) @variable` pattern overlaps the role-specific ones by design; every identifier
/// role projects to `Ident`, so collapsing is sound. Two captures on one range projecting to
/// different classes means a query was written that this rule cannot resolve, and silently keeping
/// one of them would make the differential compare something nobody chose.
///
/// # Errors
///
/// Returns a message when the query fails to compile, when the source cannot be parsed, when a
/// capture has no row in `CAPTURE_CLASSES`, when two captures on one byte range disagree, or when the
/// query cursor hit its match limit — which would otherwise drop captures silently and surface much
/// later as an unexplained span-count mismatch in `compare`.
///
/// **THE DISAGREEMENT RULE COVERS IDENTICAL BYTE RANGES ONLY.** Every pattern the shipped queries use
/// captures a leaf, so two captures either land on the same range or on disjoint ones. A future
/// pattern capturing a composite node — `(call_expression) @function.call`, say — would produce an
/// entry OVERLAPPING several others without ever comparing unequal, and `compare` would then report a
/// span-count mismatch instead of naming the query. Capture leaves.
pub fn captures(src: &str) -> Result<Vec<(Span, TokenClass)>, String> {
    captures_with(HIGHLIGHTS, src)
}

/// `captures`, over a caller-supplied query.
///
/// **EXISTS SO THE DISAGREEMENT CHECK CAN BE SHOWN TO FIRE.** `a_conflicting_query_is_rejected` runs
/// a query that captures one identifier as two classes; without this entry point that error would be
/// unreachable from a test, and a check nobody has seen fail is a check nobody has tested.
///
/// # Errors
///
/// As `captures`.
pub fn captures_with(query_src: &str, src: &str) -> Result<Vec<(Span, TokenClass)>, String> {
    let lang = language();
    let q = Query::new(&lang, query_src).map_err(|e| format!("query failed to compile: {e}"))?;
    let names = q.capture_names().to_vec();
    let tree = parse(src)?;
    let mut cursor = QueryCursor::new();
    let mut by_span: std::collections::BTreeMap<(usize, usize), TokenClass> =
        std::collections::BTreeMap::new();
    let mut it = cursor.matches(&q, tree.root_node(), src.as_bytes());
    while let Some(m) = it.next() {
        for c in m.captures {
            let name = names[c.index as usize];
            let class = class_for(name)
                .ok_or_else(|| format!("`@{name}` has no row in CAPTURE_CLASSES"))?;
            let key = (c.node.start_byte(), c.node.end_byte());
            if let Some(prev) = by_span.insert(key, class)
                && prev != class
            {
                // `get` rather than `&src[..]`: a slice that is not on a char boundary panics, and a
                // library path in this workspace may not panic. tree-sitter advances by codepoint so
                // the range should always be valid, but an error path is a poor place to find out.
                return Err(format!(
                    "two captures on {}..{} (`{}`) disagree: {prev:?} and {class:?} via `@{name}`",
                    key.0,
                    key.1,
                    src.get(key.0..key.1).unwrap_or("<not a char boundary>")
                ));
            }
        }
    }
    if cursor.did_exceed_match_limit() {
        return Err("the query cursor hit its match limit, so captures were dropped".to_string());
    }
    Ok(by_span.into_iter().map(|((start, end), c)| (Span::new(start, end), c)).collect())
}
```

`BTreeMap` keyed by `(start, end)` gives the offset ordering for free, so nothing sorts afterwards.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cargo nextest run -p redextape-grammar-check --test captures
```

Expected: PASS, all six.

**If `the_capture_map_is_total_over_the_queries` fails**, a capture name in `highlights.scm` has no
row in `CAPTURE_CLASSES`. Add the row — do not delete the capture, which would leave a token
uncaptured and move the failure to Task 4.

- [ ] **Step 6: Commit**

```bash
git add grammars/tree-sitter-redextape/queries crates/redextape-grammar-check
git commit -m "grammar-check: highlight queries and the capture -> TokenClass map"
```

---

## Task 4: The differential over the hand-written corpus

**Files:**
- Create: `crates/redextape-grammar-check/tests/differential.rs`
- Modify: `crates/redextape-grammar-check/src/lib.rs` — add `compare`

**Interfaces:**
- Consumes: `captures`, `error_nodes`, `parse`, `CORPUS`.
- Produces: `pub fn compare(src: &str) -> Result<(), String>` — `Ok(())` when the grammar's projected captures equal `classify_source`'s classification exactly, otherwise a message naming the first divergence with both sides' text and class.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-grammar-check/tests/differential.rs`:

```rust
#![cfg_attr(test, allow(clippy::pedantic))]

use redextape_grammar_check::{CORPUS, compare};

#[test]
fn the_grammar_agrees_with_classify_source_on_every_corpus_program() {
    for (name, src) in CORPUS {
        if let Err(why) = compare(src) {
            panic!("`{name}` diverges:\n{why}");
        }
    }
}

/// The differential must be capable of failing. A grammar that agreed with nothing would pass a
/// comparison that silently compared nothing, and this repository has shipped a gate that could not
/// fail before — see the roadmap's citation-gate entries.
#[test]
fn the_comparison_can_fail() {
    // `@@@` is not lexable: `classify_source` recovers and classifies what it can while the grammar
    // produces ERROR nodes. Whatever the two do here, they must not agree silently.
    assert!(compare("let x = @@@;").is_err(), "the comparison must reject un-lexable input");
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cargo nextest run -p redextape-grammar-check --test differential
```

Expected: FAIL to compile — no `compare`.

- [ ] **Step 3: Write `compare`**

Append to `crates/redextape-grammar-check/src/lib.rs`:

```rust
/// Compare the grammar's projected captures against the hand-written front end's classification.
///
/// **THE DIRECTION MATTERS.** `analysis::classify_source` is the authority; this function has no
/// opinion of its own. A divergence is always a defect in `grammar.js` or `highlights.scm`, never a
/// reason to relax the comparison.
///
/// Parse failure is checked FIRST. A source that produces `ERROR` nodes would otherwise yield a
/// short capture list, and a short list that happens to be a prefix of the truth is the shape of a
/// comparison that passes while covering nothing.
///
/// # Errors
///
/// Returns the first divergence, naming the offset, both texts and both classes.
pub fn compare(src: &str) -> Result<(), String> {
    let tree = parse(src)?;
    let errors = error_nodes(&tree);
    if !errors.is_empty() {
        return Err(format!("the grammar produced ERROR/MISSING nodes at {errors:?}"));
    }

    let want = redextape_core::analysis::classify_source(src);
    let got = captures(src)?;

    for (i, (w, g)) in want.iter().zip(got.iter()).enumerate() {
        if w != g {
            // `get` rather than `&src[..]` throughout: a slice off a char boundary panics, and a
            // library path in this workspace may not panic. Same rule as `captures_with`.
            return Err(format!(
                "at index {i}: classify_source says {:?} {:?} at {}..{}, the grammar says {:?} {:?} at {}..{}",
                src.get(w.0.start..w.0.end).unwrap_or("<not a char boundary>"), w.1, w.0.start, w.0.end,
                src.get(g.0.start..g.0.end).unwrap_or("<not a char boundary>"), g.1, g.0.start, g.0.end,
            ));
        }
    }
    if want.len() != got.len() {
        let (longer, which) = if want.len() > got.len() { (&want, "classify_source") } else { (&got, "the grammar") };
        let extra = &longer[want.len().min(got.len())..];
        let first = extra.first().ok_or_else(|| {
            "unreachable: the lengths differ, so the longer side has at least one extra span".to_string()
        })?;
        return Err(format!(
            "{which} produced {} more span(s); the first is {:?} at {}..{}",
            extra.len(),
            src.get(first.0.start..first.0.end).unwrap_or("<not a char boundary>"),
            first.0.start,
            first.0.end,
        ));
    }
    Ok(())
}
```

- [ ] **Step 4: Run the tests**

```bash
cargo nextest run -p redextape-grammar-check --test differential
```

Expected: PASS both.

**If `the_grammar_agrees_with_classify_source_on_every_corpus_program` fails**, read which side is
wrong before changing anything. The two most likely divergences, in order:

1. **A `|` in a closure.** `class_of` maps `TokenKind::Pipe` to `Punct`. If `highlights.scm` captured
   it as `@operator` it projects to `Operator` and diverges. The fix is the query.
2. **The `.` of a UFCS chain.** `class_of` maps `TokenKind::Dot` to `Punct`, not `Operator`.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-grammar-check
git commit -m "grammar-check: the differential, and a test that it can fail"
```

---

## Task 5: The generated corpus

**Files:**
- Create: `crates/redextape-grammar-check/tests/generated.rs`

**Interfaces:**
- Consumes: `compare` from Task 4; `arb_expr_over` from `redextape-test-support`.
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the test**

Create `crates/redextape-grammar-check/tests/generated.rs`:

```rust
#![cfg_attr(test, allow(clippy::pedantic))]

use proptest::prelude::*;
use proptest::test_runner::TestCaseError;
use redextape_grammar_check::compare;
use redextape_test_support::arb_expr_over;

proptest! {
    /// The generated corpus gives DEPTH ON A NARROW SHAPE, not breadth: `arb_expr_over` produces
    /// `+`, `-`, `>`, `==` and `if` over numeric leaves — no `fn`, no `while`, no closures, no UFCS.
    /// Those live in `CORPUS` and rest on the weaker layer, which design §11.3 states rather than
    /// leaves for a reader to discover.
    ///
    /// This is a new caller of `arb_expr_over` and RECORDS NO RATE against it, so it adds no
    /// constraint on that generator's recursion parameters — read its doc comment before changing
    /// anything there.
    #[test]
    fn the_grammar_agrees_with_classify_source_on_generated_programs(
        src in arb_expr_over((0u64..100).prop_map(|n| n.to_string()))
    ) {
        // `TestCaseError::fail` rather than `prop_assert!(compare(..).is_ok(), .., compare(..))`:
        // that form calls `compare` a second time to build its message, and reaches for
        // `unwrap_err` inside a macro-generated test fn where clippy's in-tests exemption is not
        // guaranteed to apply. This form calls once and cannot panic.
        if let Err(why) = compare(&src) {
            return Err(TestCaseError::fail(why));
        }
    }
}
```

- [ ] **Step 2: Run it**

```bash
cargo nextest run -p redextape-grammar-check --test generated
```

Expected: PASS. A failure prints the shrunk program, which is the smallest input on which the two
disagree — treat that program as a new `CORPUS` entry once fixed, so the case stays covered by the
cheaper test too.

- [ ] **Step 3: Run the whole workspace, since that is what CI runs**

```bash
cargo nextest run --workspace
```

Expected: PASS. Record the test count for the roadmap entry in Task 7.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-grammar-check
git commit -m "grammar-check: the generated-corpus leg"
```

---

## Task 6: The regenerate leg

**Files:**
- Modify: `scripts/check-all.sh` — `ensure_treesitter`, a `grammar` kind in `do_leg`, the kind validator, one `LEGS` row
- Modify: `scripts/setup-dev.sh` — install the CLI
- Modify: `.forgejo/workflows/ci.yml` — install the CLI in `rust` and `rust-scoped`

**Interfaces:**
- Consumes: the committed generated files from Task 1.
- Produces: `scripts/check-all.sh --list` gains a `base grammar` row.

**Why this task is not optional.** The differential compiles `src/parser.c`. If someone edits
`grammar.js` and does not regenerate, every test in Tasks 2–5 passes against the previous grammar
while the file that claims to describe the language says something else. Without this leg the rest of
this plan is decorative.

- [ ] **Step 1: Add `ensure_treesitter` to `scripts/check-all.sh`**

Insert immediately before `ensure_browser()`, following its shape:

```bash
# The tree-sitter CLI, which regenerates the committed parsers. PINNED: the grammars are generated at
# language ABI 15 and `redextape-grammar-check` asserts that on load, so a CLI old enough to emit an
# earlier ABI produces a diff here AND a failing test there.
#
# PROBED BY PATH AS WELL AS `$PATH`, for the reason the Chrome probe above gives: this machine keeps
# it in /usr/sbin, which is off `$PATH` under a non-interactive shell, and the resulting "not found"
# reads like "not installed".
ensure_treesitter() {
  if [ -z "${TREE_SITTER:-}" ] && command -v tree-sitter >/dev/null 2>&1; then
    TREE_SITTER="$(command -v tree-sitter)"
  fi
  if [ -z "${TREE_SITTER:-}" ]; then
    local c
    for c in /usr/sbin/tree-sitter /usr/local/bin/tree-sitter "$HOME/.cargo/bin/tree-sitter"; do
      if [ -x "$c" ]; then TREE_SITTER="$c"; break; fi
    done
  fi
  if [ -z "${TREE_SITTER:-}" ]; then
    echo "error: tree-sitter CLI not found, so the grammars cannot be checked against their source." >&2
    echo "  install: scripts/install-treesitter-ci.sh (pinned v0.25.10)" >&2
    echo "  or:      or download v0.25.10 from the release tag" >&2
    echo "  set it explicitly: TREE_SITTER=/path/to/tree-sitter scripts/check-all.sh" >&2
    exit 1
  fi
  export TREE_SITTER
  echo "==> using tree-sitter at $TREE_SITTER"
}
```

- [ ] **Step 2: Add the `grammar` leg to `do_leg`**

In `do_leg`, after the `wasm)` arm:

```bash
    # NOT a `cargo` leg. Regenerates each grammar and fails if the committed output differs, because
    # `src/parser.c` is a build artifact checked into git and nothing else can tell whether it was
    # built from the `grammar.js` beside it.
    grammar) ensure_treesitter; check_grammars ;;
```

And define `check_grammars` immediately above `do_leg`:

```bash
check_grammars() {
  local g status=0
  for g in grammars/*/; do
    echo "==> regenerating ${g}"
    ( cd "$g" && "$TREE_SITTER" generate )
  done
  # `--exit-code` makes a difference an error. Restricted to `grammars/` so an unrelated dirty file
  # in the working tree does not fail this leg.
  if ! git diff --quiet --exit-code -- grammars/; then
    echo "error: the committed generated parsers differ from what grammar.js produces." >&2
    echo "  a grammar.js was edited without regenerating. run, from the grammar's directory:" >&2
    echo "    tree-sitter generate" >&2
    echo "  then commit the regenerated src/." >&2
    git --no-pager diff --stat -- grammars/ >&2
    status=1
  fi
  return "$status"
}
```

- [ ] **Step 3: Register the kind and add the row**

In the kind validator, add `grammar` to the accepted set:

```bash
      fmt|clippy|build|test|probe|wasmprobe|wasm|browserprobe|browser|grammar) ;;
```

In `LEGS`, add a `base` row. Put it directly after the `both|fmt|` row, so a stale parser fails in
seconds rather than after the whole test suite:

```bash
  "both|fmt|"
  "base|grammar|"
  "base|wasmprobe|"
```

- [ ] **Step 4: Verify the leg is registered and runs**

```bash
scripts/check-all.sh --list
```

Expected: a `base	grammar	` row appears in the listing.

```bash
scripts/check-all.sh --no-llvm --no-browser
```

Expected: the grammar leg prints `==> using tree-sitter at ...` and `==> regenerating grammars/tree-sitter-redextape/`, then the run continues. The whole gate passes.

- [ ] **Step 5: Verify the leg can actually fail**

A gate that would pass anything is worse than no gate — the same standard the wasm leg was held to
when `mimalloc` was moved into `[dependencies]` to prove it.

```bash
# Edit grammar.js so the generated parser must change, WITHOUT regenerating.
sed -i 's/number: \$ => \/\[0-9\]+\//number: $ => \/[0-9]+n?\//' grammars/tree-sitter-redextape/grammar.js
scripts/check-all.sh --no-llvm --no-browser
```

Expected: FAIL at the grammar leg with "the committed generated parsers differ from what grammar.js produces."

```bash
git checkout -- grammars/tree-sitter-redextape/grammar.js
cd grammars/tree-sitter-redextape && tree-sitter generate && cd ../..
git diff --stat -- grammars/
```

Expected: no diff. Record in the PR body that the leg was verified non-vacuous.

- [ ] **Step 6: Add the CLI to `setup-dev.sh`**

Follow the file's existing style for installing a tool; install the pinned `tree-sitter` CLI at `0.25.10` and
print the resolved path.

- [ ] **Step 7: Add the CLI to CI**

In `.forgejo/workflows/ci.yml`, add an install step to the `rust` job and to `rust-scoped` — both
reach a base-tier leg, `rust-scoped` because `check-scoped.sh` escalates to the full base tier on any
change its default-deny arm does not recognise, which a new top-level `grammars/` directory certainly
is. `rust-llvm` selects no base-tier row and `rust-slow` runs a different script, so neither needs it.

Prefer the prebuilt binary over `cargo install`, which would add minutes to a cache that was
deliberately halved in PR #50.

**This is the step this plan is least certain about, and it is honest to say so:** what the
self-hosted runner already has is not knowable from here. The first CI run is where it gets settled.
**SETTLED 2026-08-21:** there is no `tree-sitter-cli@0.27.0` to fall back to — it was never released
(design §8.1). The pin is the v0.25.10 release asset, fetched and checksummed by
`scripts/install-treesitter-ci.sh`. **Do not make the leg conditional to get CI green**; a gate that goes green when its tool is missing is the
defect this task exists to prevent.

- [ ] **Step 8: Commit**

```bash
git add scripts/check-all.sh scripts/setup-dev.sh .forgejo/workflows/ci.yml
git commit -m "ci: regenerate the grammars and fail on a stale parser.c"
```

---

## Task 7: The README and the roadmap entry

**Files:**
- Create: `grammars/tree-sitter-redextape/README.md`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Write the grammar README**

Create `grammars/tree-sitter-redextape/README.md` covering: what the grammar is for (external editor
highlighting), the constraint that it is not authoritative and never lowers to Core, how it is checked
(`crates/redextape-grammar-check`), how to regenerate (`tree-sitter generate`), and install snippets
for nvim-treesitter (`install_info` with `url` and `location`), Helix (`[[grammar]]` with `source.git`
and `source.subpath`), and Zed.

**Verify the Zed snippet before writing it.** nvim-treesitter's `location` and Helix's `subpath` both
read a grammar from a subdirectory; Zed's extension format is repository-plus-commit and its
subdirectory support was not confirmed while this plan was written. If Zed cannot read a subdirectory,
say so in the README and name the mirror-repo fallback rather than changing the layout — design §11.2.

- [ ] **Step 2: Verify the install snippets are syntactically valid**

Read each editor's current documentation rather than writing the snippets from memory. A README's
install block is the one part of this PR nothing in CI can check.

- [ ] **Step 3: Run the full gate**

```bash
scripts/check-all.sh --no-llvm --no-browser
```

Expected: PASS. Record the workspace test count and the `parser.c` size:

```bash
cargo nextest run --workspace 2>&1 | tail -3
wc -c grammars/tree-sitter-redextape/src/parser.c
```

- [ ] **Step 4: Write the roadmap entry**

Append a `####` entry to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, following the shape
every slice since Plan 4 has used: a title naming the finding that outranks the feature, the design and
plan links, what closed, **what this did NOT close**, and a Verification block carrying the commands
that produce every figure the entry quotes.

Cover at minimum:

- The tree-sitter entry's own trigger had not fired; the gate was opened deliberately. Annotate the
  entry rather than rewriting it — this repository annotates, and the roadmap's "ANNOTATION, not a
  rewrite" entry is the precedent.
- The three gaps of design §6, restated with what each rests on instead.
- Whether the regenerate leg was verified non-vacuous, with the command.
- The measured `parser.c` size against design §11.1's open question.
- What is left: the λ grammar (PR 2), the TM grammar (PR 3), and `parse_asm`, still unclaimed.

- [ ] **Step 5: Commit and open the PR**

```bash
git add grammars/tree-sitter-redextape/README.md docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "docs: install snippets and the roadmap entry"
```

Open the PR against `main`. Do not merge it — Davey reviews and merges his own PRs, and holds a branch
to fix findings rather than landing and following up.

---

## Self-Review

**Spec coverage.** §3 layout → Tasks 1, 2, 7. §4 the drift check → Task 4. §5 the map and its totality
→ Task 3. §6.1 the stated gap → documented at `CAPTURE_CLASSES` in Task 3 and in the roadmap entry in
Task 7. §6.2 and §6.3 are λ and TM gaps and belong to PRs 2 and 3, correctly absent here. §7 corpus
generation → Task 5 for the generated half, `CORPUS` in Task 2 for the hand-written half; the λ/TM
lowering half of §7's diagram belongs to PRs 2 and 3. §8.1 version pinning → `abi_version_is_pinned` in
Task 2 and Step 5 of Task 1. §8.2 the regenerate leg → Task 6, including its non-vacuity proof. §8.3 no
new CI job → satisfied by riding `base|test|--workspace`; Task 6 adds a leg and an install step, never
a job. §11.1 `parser.c` size → measured in Task 7 Step 3. §11.2 Zed → flagged in Task 7 Step 1. §11.3
narrow generator → stated in the doc comment in Task 5. §12 exclusions → nothing in this plan creates
`locals.scm`, `injections.scm`, folds, indents, packaging, or touches `web/`.

**One gap found and left deliberately:** design §9 layer 1 asks for `tree-sitter test` corpus files as
a standing layer, and Task 1 creates two. No later task adds cases as the grammar grows, because the
grammar does not grow after Task 1 in this PR.

**Type consistency.** `compare(&str) -> Result<(), String>` is defined in Task 4 and used in Tasks 4
and 5. `captures(&str) -> Vec<(Span, TokenClass)>` is defined in Task 3 and used in Tasks 3 and 4.
`error_nodes(&Tree) -> Vec<Span>` is defined in Task 2 and used in Tasks 2 and 4. `CORPUS` is defined
in Task 2 and used in Tasks 2, 3 and 4. `class_for` and `query_capture_names` are defined in Task 3 and
used only in Task 3's tests. `language()` and `parse()` are defined in Task 2 and used in Tasks 2, 3
and 4. Node and field names produced by Task 1 are consumed by Task 3's queries: `call_expression`
`function:`, `method_call` `method:`, `function_definition` `name:`, `parameters` `parameter:`,
`let_statement` `name:`, `assignment` `target:`, `while_statement` `condition:`, `closure` `body:`.
