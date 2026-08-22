# tree-sitter grammars — PR 2: the λ text form

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a tree-sitter grammar for the λ text form, held to `print_lambda_mapped` span for span, so a grammar that colours a printed λ term differently from the printer fails a test.

**Architecture:** PR 1 built `crates/redextape-grammar-check` around a single grammar. This PR generalises it to a `Grammar` value carrying its own language, queries and capture map — design §5.1's per-grammar tables, made real — then adds `grammars/tree-sitter-redextape-lambda/` alongside. The λ authority is a **printer**, not a classifier, so its corpus is produced by printing rather than authored.

**Tech Stack:** unchanged from PR 1 — tree-sitter CLI 0.25.10 (generation), `tree-sitter` Rust crate 0.26 (loading), `cc` (compiling generated C), `proptest` via `redextape-test-support`.

**Design:** [`../specs/2026-08-20-tree-sitter-grammars-design.md`](../specs/2026-08-20-tree-sitter-grammars-design.md). This implements its §10 PR 2. PR 1 (the mini-language) merged 2026-08-21 as #53, squash `648b7aa`.

## Global Constraints

Every task's requirements implicitly include all of these.

- **Highlighting only.** No code path from a tree-sitter node to a `redextape_core` AST type. Reading `Span` and `TokenClass` is fine — they are data.
- **No file under `web/` is created or modified.** `crates/redextape-core` is NOT modified.
- **Pinned toolchain:** tree-sitter CLI **`0.25.10`**, generated ABI **15**, `tree-sitter` Rust crate `0.26`. `/usr/sbin/tree-sitter` reports `0.27.0` and is Arch's `master` build — **do not use it**; use `.tools/tree-sitter`, which `scripts/setup-dev.sh` installs. Design §8.1.1 records why the pin sits below the newest release: 0.26+ binaries need glibc 2.39 and CI's runner has 2.35.
- **Every grammar directory needs a `tree-sitter.json`.** Without it the CLI warns and silently generates **ABI 14**, which the Rust crate refuses to load.
- **Node IS required** by the CLI to evaluate `grammar.js`. Design §8.1.2 records the invalid measurement that twice claimed otherwise.
- **Library code may not panic.** `[workspace.lints.clippy]` warns `unwrap_used`/`expect_used`/`panic`/`todo`/`unimplemented` plus `pedantic`, and CI makes warnings fatal. `clippy.toml` exempts those only inside a `#[test]` fn or `#[cfg(test)]` module — `src/lib.rs` is neither. Integration tests in `tests/` may unwrap freely.
- **Nothing in this crate may reduce.** No `reduce_trace`, no `reduce`. Lowering and printing only. A λ measurement that reduces has previously cost this machine 60 GiB of RAM and all of swap.
- **A pre-commit hook runs on every commit** — `cargo fmt --check`, `cargo clippy -- -D warnings`, a C0-control-byte scan, a `file:line` citation scan. NEVER `--no-verify`.
- **No `file:line` citations in tracked source outside `docs/`** — cite symbols by name. **No C0 control bytes** except TAB, LF, CR.

---

## The λ text form, read from the tree at `648b7aa`

From `crates/redextape-core/src/lambda/syntax.rs` — `parse_lambda`, `parse_application`, `parse_atom`, `parse_abstraction`, `is_ident_start`, `is_ident_continue`, and the printer's `push_span` calls.

```
term        := atom+                              application, LEFT-associative, by juxtaposition
atom        := abstraction | '(' term ')' | ident
abstraction := ('\' | 'λ') ident '.' term
ident       := [_$A-Za-z][_$A-Za-z0-9]*
```

- **There are no comments and no literals.** The form has four token shapes: a binder head, an identifier, `.`, and parens.
- **`\` and `λ` are interchangeable to the parser; the printer emits only `λ`.** `\` is a permanent input alias because it is what a keyboard types.
- **`$` is a legal identifier character**, start included. The lowering names its store-passing binder `$store`; `$` is the marker for a compiler-generated name the surface syntax cannot forge.
- **Application binds tighter than nothing and is left-associative** — `f x y` is `(f x) y`. A binder body extends as far right as possible: `λx. f x` is `λx. (f x)`.

**What `print_lambda_mapped` classifies — the whole authority, five sites:**

| printed text | `TokenClass` |
|---|---|
| `λ` | `Binder` |
| the bound name after it | `Binder` |
| `.` | `Punct` |
| `(` and `)` | `Punct` |
| a variable occurrence | `Ident` |

Whitespace between atoms carries no span on either side, so it needs no treatment.

**`?<index>` is NOT a gap, and this is worth stating before someone files it as one.** A free variable prints as `?0`, classified `Ident`. `?` is not an identifier character, so the grammar will reject it — and so does `parse_lambda`, deliberately, so that an open term fails to reparse loudly rather than silently rebinding. **The grammar rejecting `?0` is agreement with the authority, not divergence.** Everything the backend produces is closed, so no generated corpus entry can contain one.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `grammars/tree-sitter-redextape-lambda/grammar.js` | the λ grammar — the only hand-edited grammar file |
| `grammars/tree-sitter-redextape-lambda/tree-sitter.json` | metadata; **required for ABI 15** |
| `grammars/tree-sitter-redextape-lambda/queries/highlights.scm` | capture assignments |
| `grammars/tree-sitter-redextape-lambda/test/corpus/*.txt` | `tree-sitter test` cases over tree shape |
| `grammars/tree-sitter-redextape-lambda/README.md` | install snippets |
| `grammars/tree-sitter-redextape-lambda/src/**` | generated, committed |
| `crates/redextape-grammar-check/src/grammar.rs` | the `Grammar` value and its generic helpers |
| `crates/redextape-grammar-check/src/mini.rs` | the mini-language's language, queries, map, corpus |
| `crates/redextape-grammar-check/src/lambda.rs` | the λ equivalents, plus its printed-corpus builder |
| `crates/redextape-grammar-check/tests/lambda.rs` | λ's differential, capture and corpus tests |

**Modified:**

| Path | Change |
|---|---|
| `crates/redextape-grammar-check/src/lib.rs` | becomes a thin module root; its current contents move into the three modules above |
| `crates/redextape-grammar-check/build.rs` | compiles the second `parser.c` |
| `crates/redextape-grammar-check/tests/*.rs` | updated for the new paths |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the closing entry |

---

## Task 1: One crate, two grammars

**Files:**
- Create: `crates/redextape-grammar-check/src/grammar.rs`, `src/mini.rs`
- Modify: `crates/redextape-grammar-check/src/lib.rs`, `tests/corpus.rs`, `tests/captures.rs`, `tests/differential.rs`, `tests/generated.rs`

**Interfaces:**
- Consumes: everything PR 1 built, unchanged in behaviour.
- Produces: `pub struct Grammar` with `name`, `language()`, `highlights`, `capture_classes`, and methods `class_for`, `query_capture_names`, `parse`, `error_nodes`, `captures`, `captures_with`; a free `compare_classified(g: &Grammar, query_src: &str, src: &str, want: &[(Span, TokenClass)]) -> Result<(), String>` (CORRECTED 2026-08-21 by review: this summary had drifted to a stale 3-arg form without `query_src`; Step 3 below already showed the shipped 4-arg signature, and this line now matches it); and `pub static MINI: Grammar`. `mini::compare` and `mini::compare_with` stay as thin wrappers over `classify_source`.

**THIS TASK CHANGES NO BEHAVIOUR.** All 14 existing tests must still pass, unmodified in substance — only their import paths may change. If a test needs its assertion changed to pass, something has been broken; stop and report rather than adjusting the test.

**Why the split is `Grammar`-shaped rather than two copies:** design §5.1 requires per-grammar capture tables because `@variable.parameter` is `Ident` in the mini-language and `Binder` in λ. What must NOT be duplicated is the comparison machinery — `captures_with`'s overlap collapse, the disagreement rule, the match-limit check, and the span-for-span comparison are one implementation parameterised by a `Grammar`, or PR 3 will make it three.

**The authority does NOT live on `Grammar`.** The mini-language's authority is `classify_source`, a function of the source text; λ's is `print_lambda_mapped`, which *produces* text and spans together. Those have different shapes and cannot share a signature. `compare_classified` takes the expected spans as an argument, and each language's module supplies them its own way.

- [ ] **Step 1: Read what you are moving**

```bash
wc -l crates/redextape-grammar-check/src/lib.rs   # 317 at 648b7aa
cargo nextest run -p redextape-grammar-check      # 14 passed — the number to preserve
```

- [ ] **Step 2: Create `src/grammar.rs` with the `Grammar` value**

```rust
//! One grammar's identity, and the comparison machinery every grammar shares.
//!
//! **THE CAPTURE TABLE IS PER GRAMMAR AND THE MACHINERY IS NOT.** Design §5.1 records why the tables
//! cannot be shared: `@variable.parameter` is an `Ident` in the mini-language, where `class_of` calls
//! a parameter an identifier, and a `Binder` in λ, where `print_lambda_mapped` folds the bound name
//! into the binder. Both are right for their own language. What would be a defect is three copies of
//! the overlap rule, the disagreement check and the span comparison — so those live here, once.

use redextape_core::Span;
use redextape_core::analysis::TokenClass;
use tree_sitter::{Language, Parser, Query, QueryCursor, StreamingIterator, Tree};
use tree_sitter_language::LanguageFn;

pub struct Grammar {
    /// Names this grammar in every error message, so a failure says which one.
    pub name: &'static str,
    pub language_fn: LanguageFn,
    pub highlights: &'static str,
    pub capture_classes: &'static [(&'static str, TokenClass)],
}
```

Then move `language`, `parse`, `error_nodes`, `class_for`, `query_capture_names`, `captures`,
`captures_with` onto `impl Grammar` as methods, changing only what the move requires: `language()`
becomes `Language::new(self.language_fn)`, and `class_for` reads `self.capture_classes`. **Carry
every doc comment across** — they hold the reasoning for the overlap rule, the identical-ranges-only
caveat, the match-limit check and the ABI pin, and a doc comment left behind while its code moves is
how this repository loses its own arguments.

Every error message these produce must now name `self.name`, so a failure in a three-grammar crate
says which grammar failed rather than leaving the reader to guess.

- [ ] **Step 3: Extract `compare_classified` into `src/grammar.rs`**

Take the body of PR 1's `compare_with` and change only its source of truth: instead of calling
`classify_source(src)` itself, accept `want: &[(Span, TokenClass)]`.

```rust
/// Compare a grammar's projected captures against an authority's classification of the same text.
///
/// **THE DIRECTION MATTERS.** The authority is right; this function has no opinion of its own. A
/// divergence is a defect in `grammar.js` or `highlights.scm`, never a reason to relax the
/// comparison.
///
/// The caller supplies `want` because the two authorities have different shapes: the mini-language's
/// `classify_source` is a function of source text, while λ's `print_lambda_mapped` produces the text
/// and its spans together. A single signature could not serve both without lying about one.
///
/// Parse failure is checked FIRST. A source that produces `ERROR` nodes yields a short capture list,
/// and a short list that happens to be a prefix of the truth is the shape of a comparison that passes
/// while covering nothing.
///
/// # Errors
///
/// [carry PR 1's four-message list across, unchanged in substance]
pub fn compare_classified(
    g: &Grammar,
    query_src: &str,
    src: &str,
    want: &[(Span, TokenClass)],
) -> Result<(), String> {
```

- [ ] **Step 4: Create `src/mini.rs`** holding `HIGHLIGHTS`, `CAPTURE_CLASSES`, `CORPUS`, `pub static MINI: Grammar`, and `compare`/`compare_with` as thin wrappers that call `classify_source(src)` and hand the result to `compare_classified`. `lib.rs` becomes module declarations plus re-exports.

- [ ] **Step 5: Update the four test files for the new paths and run them**

```bash
cargo nextest run -p redextape-grammar-check
```

Expected: **14 passed**, the same 14 by name. A different count means the move changed behaviour.

- [ ] **Step 6: Check clippy and fmt, since the hook will**

```bash
cargo clippy -p redextape-grammar-check --all-targets -- -D warnings
cargo fmt --check
```

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-grammar-check
git commit -m "grammar-check: one Grammar value, so a second grammar is an addition not a copy"
```

---

## Task 2: The λ grammar

**Files:**
- Create: `grammars/tree-sitter-redextape-lambda/grammar.js`, `tree-sitter.json`, `test/corpus/terms.txt`
- Generated (committed): `grammars/tree-sitter-redextape-lambda/src/**`
- Modify: `crates/redextape-grammar-check/build.rs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: a tree-sitter language named `redextape_lambda`, exporting `tree_sitter_redextape_lambda()`. Node names Task 3 queries: `source_file`, `abstraction`, `application`, `parenthesized_term`, `identifier`. Fields: `parameter`, `body`, `function`, `argument`.

- [ ] **Step 1: Write the failing corpus tests**

Create `grammars/tree-sitter-redextape-lambda/test/corpus/terms.txt`:

```
================================================================================
application is left-associative
================================================================================

f x y

--------------------------------------------------------------------------------

(source_file
  (application
    (application
      (identifier)
      (identifier))
    (identifier)))

================================================================================
a binder body extends as far right as it can
================================================================================

λx. f x

--------------------------------------------------------------------------------

(source_file
  (abstraction
    (identifier)
    (application
      (identifier)
      (identifier))))

================================================================================
the backslash alias parses identically
================================================================================

\x. x

--------------------------------------------------------------------------------

(source_file
  (abstraction
    (identifier)
    (identifier)))

================================================================================
parentheses, and a compiler-generated $ name
================================================================================

(λ$store. $store) (λa.λb. a)

--------------------------------------------------------------------------------

(source_file
  (application
    (parenthesized_term
      (abstraction
        (identifier)
        (identifier)))
    (parenthesized_term
      (abstraction
        (identifier)
        (abstraction
          (identifier)
          (identifier))))))
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd grammars/tree-sitter-redextape-lambda && ../../.tools/tree-sitter test
```

Expected: FAIL — no `grammar.js` yet.

- [ ] **Step 3: Write `tree-sitter.json`**

Copy the shape from `grammars/tree-sitter-redextape/tree-sitter.json`, changing `name` to
`redextape_lambda`, `camelcase` to `RedextapeLambda`, `scope` to `source.rxlambda`, and the file
types. **Do not omit this file** — without it the CLI silently generates ABI 14.

- [ ] **Step 4: Write `grammar.js`**

```js
/**
 * The redextape λ text form, for editor highlighting ONLY.
 *
 * THIS IS NOT AN AUTHORITATIVE GRAMMAR. `crates/redextape-core/src/lambda/syntax.rs` is the semantic
 * source of truth; this file may never be lowered into a term. Agreement is enforced by
 * `crates/redextape-grammar-check`, which compares every highlight capture against
 * `print_lambda_mapped` span for span.
 *
 * `\` AND `λ` ARE BOTH ACCEPTED, and that asymmetry is deliberate upstream: `parse_lambda` takes
 * either, `print_lambda` emits only `λ`. So `λ` is the canonical form and `\` is a permanent input
 * alias, because it is what a keyboard types. The differential can only ever see the `λ` half — its
 * corpus is printer-produced — so the `\` arm rests on `tree-sitter test` alone. Design §6.2.
 *
 * `?<index>` IS DELIBERATELY NOT ACCEPTED. A free variable prints as `?0`, and `parse_lambda` rejects
 * it too, so that an open term fails to reparse loudly rather than silently rebinding. Rejecting it
 * here is agreement with the authority, not a gap in this grammar.
 */
module.exports = grammar({
  name: 'redextape_lambda',

  // WIDER THAN THE MINI-LANGUAGE'S, DELIBERATELY. λ's `skip_ws` uses `char::is_whitespace` (Unicode
  // White_Space); the mini-language's lexer uses `is_ascii_whitespace`. The same `/\s/` is therefore
  // correct there and wrong here. Do not harmonise them.
  extras: $ => [/[\s\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/],

  rules: {
    source_file: $ => optional($._term),

    // Application by juxtaposition, LEFT-associative: `f x y` is `(f x) y`.
    _term: $ => choice($.abstraction, $.application, $._atom),

    // CORRECTED 2026-08-21 by review: the argument accepts a bare `abstraction`, not just `_atom`.
    // `parse_application`'s loop tests for `\`/`λ` before calling `parse_atom`, whose FIRST arm is
    // the abstraction — so `f λx. x` is legal and means `f (λx. x)`. The first draft of this rule
    // excluded it, which made the grammar ERROR on input the authority accepts. **Nothing downstream
    // could have caught it**: `print_lambda` always parenthesizes an abstraction argument, so the
    // printer-produced corpus of Task 4 never contains the shape.
    application: $ => prec.left(1, seq(
      field('function', choice($.application, $._atom)),
      field('argument', choice($._atom, $.abstraction)),
    )),

    // The body runs as far right as it can, which is what `parse_abstraction` calling `parse_term`
    // (not `parse_atom`) produces: `λx. f x` is `λx. (f x)`, never `(λx. f) x`.
    abstraction: $ => prec.right(seq(
      choice('\\', 'λ'),
      field('parameter', $.identifier),
      '.',
      field('body', $._term),
    )),

    _atom: $ => choice($.parenthesized_term, $.identifier),

    parenthesized_term: $ => seq('(', $._term, ')'),

    // `$` is legal in start position AND inside: the lowering names its store-passing binder
    // `$store`, and `$` is this project's marker for a compiler-generated name the surface syntax
    // cannot forge. Matches `is_ident_start` / `is_ident_continue`.
    identifier: $ => /[_$A-Za-z][_$A-Za-z0-9]*/,
  },
});
```

- [ ] **Step 5: Generate and test**

```bash
cd grammars/tree-sitter-redextape-lambda && ../../.tools/tree-sitter generate && ../../.tools/tree-sitter test
grep -m1 LANGUAGE_VERSION src/parser.c    # must read 15; 14 means tree-sitter.json was not picked up
```

If `generate` reports a conflict, fix it with `prec` — never by deleting a rule or editing a corpus
case to match wrong output. If a corpus case fails, decide which side is wrong by reading
`lambda/syntax.rs`; the cases above were written from it.

- [ ] **Step 6: Teach `build.rs` about the second parser**

Compile both `parser.c` files. Give each `cc::Build` a distinct library name — two invocations
compiling to the same output name silently produce one library and the second symbol goes missing at
link time, which surfaces as an undefined reference rather than as a build-script error.

- [ ] **Step 7: Verify the whole gate still passes**

```bash
scripts/check-all.sh --no-llvm --no-browser
```

The grammar leg iterates `grammars/*/`, so it now regenerates and tests BOTH grammars with no edit.

- [ ] **Step 8: Commit**

```bash
git add grammars/tree-sitter-redextape-lambda crates/redextape-grammar-check/build.rs
git commit -m "grammar: the lambda text form, generated at ABI 15"
```

---

## Task 3: λ queries and its capture map

**Files:**
- Create: `grammars/tree-sitter-redextape-lambda/queries/highlights.scm`
- Create: `crates/redextape-grammar-check/src/lambda.rs`
- Create: `crates/redextape-grammar-check/tests/lambda.rs`

**Interfaces:**
- Consumes: `Grammar` from Task 1; node names from Task 2.
- Produces: `pub static LAMBDA: Grammar`, with `HIGHLIGHTS` and `CAPTURE_CLASSES` in `lambda.rs`.

**The map, from design §5.1 and the five printer sites:**

| capture | `TokenClass` | what it covers |
|---|---|---|
| `@keyword.function` | `Binder` | the `λ` or `\` token |
| `@variable.parameter` | `Binder` | the name the binder binds |
| `@variable` | `Ident` | a variable occurrence |
| `@punctuation.delimiter` | `Punct` | the `.` |
| `@punctuation.bracket` | `Punct` | `(` and `)` |

**`@variable.parameter` is the row that forced per-grammar tables** — it is `Ident` in the
mini-language and `Binder` here. Do not "fix" the apparent inconsistency by aligning them.

- [ ] **Step 1: Write the failing tests**

Create `crates/redextape-grammar-check/tests/lambda.rs` with, at minimum: totality of the map over
the queries; reverse totality (no row no query uses); one entry per byte range; that the shipped
queries never disagree over the corpus; and a `captures_with` case proving a deliberately conflicting
query is rejected. **Model each on the mini-language's `tests/captures.rs`, which already has all five
in a reviewed form** — read it rather than inventing new shapes.

Add one λ-specific test with concrete expectations, the analogue of
`captures_pins_text_and_class_for_one_source`:

```rust
#[test]
fn captures_pins_text_and_class_for_a_printed_term() {
    let src = "λx. (x x)";
    let got = LAMBDA.captures(src).expect("the query must run");
    let pairs: Vec<(&str, TokenClass)> =
        got.iter().map(|(s, c)| (&src[s.start..s.end], *c)).collect();
    assert_eq!(
        pairs,
        vec![
            ("λ", TokenClass::Binder),
            ("x", TokenClass::Binder),
            (".", TokenClass::Punct),
            ("(", TokenClass::Punct),
            ("x", TokenClass::Ident),
            ("x", TokenClass::Ident),
            (")", TokenClass::Punct),
        ]
    );
}
```

If that expectation does not match what the code returns, **check it against `print_lambda_mapped`'s
`push_span` calls before changing either side.** A wrong-but-passing expectation is the exact failure
this test exists to prevent.

- [ ] **Step 2: Run it, confirm it fails to compile** (`LAMBDA` does not exist yet).

- [ ] **Step 3: Write the queries**

```scheme
; Highlight captures for the redextape λ text form.
;
; Five capture sites, matching `print_lambda_mapped`'s five `push_span` calls exactly. The binder head
; and the name it binds are BOTH `Binder` — that is the printer's rule, not a simplification here.

["\\" "λ"] @keyword.function

(abstraction parameter: (identifier) @variable.parameter)

"." @punctuation.delimiter

["(" ")"] @punctuation.bracket

; Every other identifier is an occurrence. Ordered after the parameter pattern; the two overlap on a
; binder's name, and `captures_with` requires overlapping captures to agree — they do NOT here, so
; this pattern must NOT match a parameter. Scope it to the positions a variable occurrence can hold.
(application function: (identifier) @variable)
(application argument: (identifier) @variable)
(parenthesized_term (identifier) @variable)
(abstraction body: (identifier) @variable)
(source_file (identifier) @variable)
```

**READ THE COMMENT ABOVE CAREFULLY — this is the one place λ differs from the mini-language in kind.**
There, every identifier role projected to `Ident`, so a broad `(identifier) @variable` could safely
overlap the narrow patterns. Here a parameter is `Binder` and an occurrence is `Ident`, so a broad
pattern WOULD disagree and `captures_with` would return an error. The positions above must therefore
cover every occurrence site exactly once and never reach a parameter. **If Task 4's differential
reports a length mismatch, the likely cause is an occurrence position missing from this list** —
add it rather than broadening to a catch-all.

- [ ] **Step 4: Write `src/lambda.rs`** with `HIGHLIGHTS`, `CAPTURE_CLASSES` and `pub static LAMBDA`.

- [ ] **Step 5: Run the tests, then clippy and fmt.**

- [ ] **Step 6: Commit**

```bash
git add grammars/tree-sitter-redextape-lambda/queries crates/redextape-grammar-check
git commit -m "grammar-check: lambda highlight queries and its own capture map"
```

---

## Task 4: The λ differential, over a printed corpus

**Files:**
- Modify: `crates/redextape-grammar-check/src/lambda.rs`, `tests/lambda.rs`

**Interfaces:**
- Consumes: `compare_classified` from Task 1; `LAMBDA` from Task 3.
- Produces: `pub fn printed_term(src: &str) -> Option<(String, Vec<(Span, TokenClass)>)>` — lower a mini-language program to a λ term and print it with its classification, or `None` when the program does not lower; and `pub fn compare_printed(text: &str, want: &[(Span, TokenClass)]) -> Result<(), String>`.

**The corpus is PRODUCED, not authored**, and that is design §4's central asymmetry: λ has no classifier over arbitrary text, only a printer. The pipeline:

```
mini source -> parse -> desugar -> Core -> lambda::lower -> print_lambda_mapped -> (text, want)
```

**`lower` returns `Result`, and a failure is not a test failure** — filter, do not assert. Log the
pass rate so a silent collapse to near-zero corpus entries fails visibly rather than passing
vacuously.

- [ ] **Step 1: Write the failing tests**

```rust
/// The hand-written half: programs chosen to exercise binders, nesting and application.
#[test]
fn the_lambda_grammar_agrees_with_the_printer_on_every_corpus_program() {
    let mut printed = 0;
    for (name, src) in redextape_grammar_check::mini::CORPUS {
        let Some((text, want)) = printed_term(src) else { continue };
        printed += 1;
        if let Err(why) = compare_printed(&text, &want) {
            panic!("`{name}` lowered and printed, then diverged:\n{why}");
        }
    }
    assert!(printed >= 5, "only {printed} corpus programs lowered; the corpus is not exercising λ");
}

/// The comparison must be capable of failing, the same standard PR 1's `the_comparison_can_fail`
/// holds the mini-language to.
#[test]
fn the_lambda_comparison_can_fail() {
    let (text, want) = printed_term("let f = |x| x; f(1)").expect("this program lowers");
    // A query that captures only parens leaves every binder and identifier uncaptured, so the
    // grammar side is short and the length branch must fire.
    let err = redextape_grammar_check::grammar::compare_classified(
        &LAMBDA, "[\"(\" \")\"] @punctuation.bracket", &text, &want,
    )
    .expect_err("a strict-subset query must not compare equal");
    assert!(err.contains("more span(s)"), "expected a length mismatch, got: {err}");
}
```

- [ ] **Step 2: Run, confirm failure to compile.**

- [ ] **Step 3: Implement `printed_term` and `compare_printed` in `src/lambda.rs`.**

`printed_term` parses, desugars, lowers and prints; every fallible step returns `None` rather than
panicking, because library code here may not panic. **It must not reduce.**

- [ ] **Step 4: Add the generated leg**

A proptest over `arb_expr_over`, mirroring `tests/generated.rs`. Read `arb_expr_over`'s doc comment
first: it forbids changing its recursion parameters or arm set without re-measuring every caller that
records a rate. **This is a new caller that records no rate, so it adds no constraint** — but it
should log its lowering pass rate for the reason above. Use `TestCaseError::fail`, not
`prop_assert!` with a second `compare` call.

- [ ] **Step 5: Run everything**

```bash
cargo nextest run -p redextape-grammar-check
cargo nextest run --workspace
cargo clippy -p redextape-grammar-check --all-targets -- -D warnings
```

Record the workspace total; Task 5's roadmap entry needs it.

- [ ] **Step 6: Prove the new tests pin the code**

Rewrite `compare_classified`'s two comparison conditions as `if false && …`, confirm
`the_lambda_comparison_can_fail` **and** the mini-language's two equivalents go red, then revert.
PR 1 shipped this comparison untested and the final review caught it; the same mistake in a second
language would be less forgivable, not more.

- [ ] **Step 7: Commit**

---

## Task 5: README and the roadmap entry

**Files:**
- Create: `grammars/tree-sitter-redextape-lambda/README.md`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Write the README**, modelled on `grammars/tree-sitter-redextape/README.md`. It must carry the same three things that one does: the CLI pin and why it sits below the newest release, the fact that the repository is not anonymously clonable today so the install snippets do not yet work for anyone, and that the grammar is not authoritative.

- [ ] **Step 2: Write the roadmap entry.** Read the last few `####` entries first and match their shape: a title naming the finding that outranks the feature, Design and Plan links, what closed, **WHAT THIS DID NOT CLOSE**, and a **VERIFICATION** block whose every figure carries the command that produces it. Cover at minimum: that the shared capture map PR 1's review predicted would collide is exactly what happened, and was already fixed; the `\` alias resting on `tree-sitter test` alone (§6.2) and `?<index>` being agreement rather than a gap; and the identifier-overlap difference from the mini-language, where a broad catch-all is unsafe because a parameter and an occurrence carry different classes.

- [ ] **Step 3: Run the full gate and record real output for the entry.**

```bash
scripts/check-all.sh --no-llvm --no-browser
cargo nextest run --workspace
wc -c grammars/tree-sitter-redextape-lambda/src/parser.c
```

- [ ] **Step 4: Commit and open the PR.** Do not merge — Davey reviews and merges his own PRs.

---

## Self-Review

**Spec coverage.** Design §3's layout → Tasks 2, 5. §4's per-language authority table → Task 4's
`printed_term`. §5.1's per-grammar maps → Tasks 1 and 3, with `@variable.parameter` called out at
both. §6.2's `\` gap → stated in Task 2's grammar.js doc comment, covered by corpus in Task 2, and
carried into the roadmap entry in Task 5. §7's "corpus generated by printing" → Task 4. §8's pin →
Global Constraints, and Task 2 Step 5 checks the ABI. §10's PR 2 scope → this whole plan. §6.1 and
§6.3 belong to the mini-language and PR 3 respectively and are correctly absent.

**One thing deliberately different from PR 1:** there is no separate "harness" task, because Task 1
generalises the harness PR 1 already built and reviewed. That is why Task 1 must change no behaviour —
it is the one task whose success is measured by nothing happening.

**Type consistency.** `Grammar` and `compare_classified` are defined in Task 1 and used in Tasks 3 and
4. `LAMBDA` is defined in Task 3 and used in Tasks 3 and 4. `printed_term` and `compare_printed` are
defined in Task 4 and used only there. `mini::CORPUS` is Task 1's relocation of PR 1's `CORPUS` and is
read by Task 4. Node and field names produced by Task 2 — `abstraction parameter:`, `abstraction
body:`, `application function:`, `application argument:`, `parenthesized_term`, `source_file` — are
exactly those Task 3's queries reference.
