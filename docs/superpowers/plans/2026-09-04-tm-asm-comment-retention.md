# TM and asm comment retention — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `print(parse(src))` lossless for the TM and asm text forms, so a formatter can run over hand-written `.tm` and `.asm` files without deleting their comments.

**Architecture:** Comments become a side channel — a `Vec<AnchoredComment<A>>` beside the `Machine`/`Program`, never a field on either — positioned by the printed line they sit against rather than by a byte offset that reformatting invalidates. `parse_tm_full` and `parse_asm_full` return a document struct carrying that channel; two new printers consume it. Every existing printer and narrow parser keeps its signature and its bytes.

**Tech Stack:** Rust 2024, `redextape-core` only. `proptest` (already a dev-dependency) for the round-trip properties. No new third-party dependencies.

**Scope:** This is PR A of the design in `docs/superpowers/specs/2026-09-04-redextape-lsp-design.md`. PR B — the `redextape-lsp` crate — gets its own plan and is not started here.

## Global Constraints

- **`Machine` and `Program` gain no field.** Stated twice in `lower_tm`, held structurally by `tm::header` not importing `Machine`. Comments live beside them, never inside.
- **`print_tm`, `print_tm_with`, `print_asm`, `print_asm_with`, `parse_tm` and `parse_asm` keep their exact signatures and their exact output bytes.** 106 call sites depend on this and the listing goldens pin it.
- **Workspace lints are deny-on-CI:** `clippy::pedantic` as written, plus `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`. Library code threads a `Result` or an `Option`; it does not unwrap. Test code is exempted in `clippy.toml`.
- **`redextape-core` must build for `wasm32-unknown-unknown`** (`--lib`). No `std::time`, no threads, no C.
- **`max_width = 120`** per `rustfmt.toml`. `cargo fmt --check` rewraps neither doc comments nor string literals, so those are the author's job.
- **Coverage floor is 90% lines, workspace-wide**, measured by `cargo llvm-cov nextest --workspace --fail-under-lines 90`.
- **No `file:line` citations in any tracked file**, including Rust comments and Markdown. Cite the symbol. `scripts/check-citations.sh` enforces it on every commit.
- **The pre-commit hook runs `cargo clippy --workspace --all-targets -- -D warnings` on any `*.rs` change**, so a commit that does not compile clean cannot be made. Never pass `--no-verify`.

---

## File Structure

| file | responsibility |
|---|---|
| `crates/redextape-core/src/tm/comments.rs` | **Create.** `AnchoredComment<A>`, `TmAnchor`, `TmDirective`, `AsmAnchor`, the `;`-splitting helpers both parsers use, and `CommentWriter<A>` — the emission rule both PRINTERS use. One module because both forms share every one of these; splitting by form would be one rule maintained twice, in both directions. |
| `crates/redextape-core/src/tm/syntax.rs` | **Modify.** `TmDocument`; `parse_tm_full` returns it and recovers comments; `print_tm_doc` emits them; `print_tm_inner` gains a comment parameter. |
| `crates/redextape-core/src/tm/header.rs` | **Modify.** `write_header` gains a per-`tape`-line suppression so an authored comment can take the trailing slot. |
| `crates/redextape-core/src/tm/asm_syntax.rs` | **Modify.** `AsmDocument`; `parse_asm_full` returns it and recovers comments. |
| `crates/redextape-core/src/tm/asm.rs` | **Modify.** `print_asm_doc`; `print_asm_mapped`/`print_asm_with_mapped` gain a comment parameter. |
| `crates/redextape-core/src/tm.rs` | **Modify.** `pub mod comments;` and the re-exports. |
| `crates/redextape-core/tests/tm_comments.rs` | **Create.** TM recovery, emission and round-trip. |
| `crates/redextape-core/tests/asm_comments.rs` | **Create.** asm recovery, emission and round-trip. |

---

## Task 1: `TmDocument`, with the comment channel empty

A pure refactor. It changes 33 call sites and no behaviour, so every existing test stays green throughout — which is the point of doing it alone: a later task's red test then means something.

**Files:**
- Create: `crates/redextape-core/src/tm/comments.rs`
- Modify: `crates/redextape-core/src/tm.rs`, `crates/redextape-core/src/tm/syntax.rs`

**Interfaces:**
- Produces: `TmDocument { machine: Option<Machine>, header: Option<TmHeader>, comments: Vec<AnchoredComment<TmAnchor>>, diagnostics: Vec<Diagnostic> }`; `parse_tm_full(src: &str) -> TmDocument`; `AnchoredComment<A> { text: String, anchor: A, own_line: bool }`; `TmAnchor`; `TmDirective`; `AsmAnchor`; `CommentWriter<'a, A>` with `new`, `own_line`, `trailing` and `has_trailing`.

- [ ] **Step 1: Create the comments module**

Create `crates/redextape-core/src/tm/comments.rs`:

```rust
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
//! `lower_tm` has no comments and must print exactly as it does today, which is what the listing
//! golden pins — so comments must not reach the compiler's output path.

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
    /// `tape <i>`, by the tape index the line names.
    Tape(usize),
}

/// Which printed line a TM comment sits against. Total over `print_tm_inner`'s output: every line
/// it can emit has a variant here, which is what lets the round-trip property hold.
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
    Rule { state: StateId, index: usize },
    /// Trailing comments with no line after them.
    Eof,
}

/// Which printed line an asm comment sits against. Total over `print_asm_mapped`'s output.
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
    /// Several trailing comments on one anchor cannot each take the slot — `;` runs to end of line
    /// — so they join into one. **A parse can never produce that case**: a line holds at most one
    /// trailing comment and an anchor names one line, so the join is total-by-construction for
    /// documents built by hand and unreachable for documents that were read. The round-trip
    /// property is stated over the latter, which is why the join does not weaken it.
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
    use super::{split_trailing, whole_line};

    #[test]
    fn a_second_semicolon_belongs_to_the_first_comment() {
        assert_eq!(split_trailing("start q0 ; a ; b"), ("start q0 ", Some("a ; b")));
    }

    #[test]
    fn a_line_with_no_semicolon_has_no_comment() {
        assert_eq!(split_trailing("start q0"), ("start q0", None));
    }

    #[test]
    fn an_empty_body_is_a_comment_and_a_blank_line_is_not() {
        assert_eq!(whole_line(";"), Some(""));
        assert_eq!(whole_line(""), None);
    }
}
```

- [ ] **Step 2: Register the module**

In `crates/redextape-core/src/tm.rs`, add `pub mod comments;` beside the existing `pub mod` lines, keeping them alphabetical if they already are.

- [ ] **Step 3: Run the module's own tests, expecting a pass**

Run: `cargo nextest run -p redextape-core -E 'test(/comments::tests/)'`
Expected: `3 tests run: 3 passed`.

- [ ] **Step 4: Commit the module alone**

```bash
git add crates/redextape-core/src/tm/comments.rs crates/redextape-core/src/tm.rs
git commit -m "The anchor types and the two splitters both parsers will share"
```

- [ ] **Step 5: Declare `TmDocument` and change `parse_tm_full`'s return type**

In `crates/redextape-core/src/tm/syntax.rs`, add above `parse_tm_full`:

```rust
/// A `.tm` file as authored: the machine it describes, its optional header, and the comments that
/// belong to neither.
///
/// Returned by `parse_tm_full` in place of the 3-tuple it used to return. A struct rather than a
/// wider tuple because the next field this grows — navigation wants one — costs no call site here
/// and would cost all of them there.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TmDocument {
    /// `None` exactly when `diagnostics` holds an error, matching what the tuple returned.
    pub machine: Option<Machine>,
    /// `None` means the file carried no header, which is not an error.
    pub header: Option<TmHeader>,
    /// Recovered only from lines that parsed. A file with an error has no machine, so nothing will
    /// print it and there is nothing for a partial recovery to be right about.
    pub comments: Vec<AnchoredComment<TmAnchor>>,
    pub diagnostics: Vec<Diagnostic>,
}
```

Change the signature to `pub fn parse_tm_full(src: &str) -> TmDocument`, and change each of its four `return`/tail expressions from a tuple to a `TmDocument` with `comments: Vec::new()`. Import `AnchoredComment` and `TmAnchor` from `crate::tm::comments`.

- [ ] **Step 6: Fix `parse_tm`, the one in-file caller**

```rust
#[must_use]
pub fn parse_tm(src: &str) -> (Option<Machine>, Vec<Diagnostic>) {
    let d = parse_tm_full(src);
    (d.machine, d.diagnostics)
}
```

- [ ] **Step 7: Find every remaining call site**

Run: `cargo build --workspace --all-targets 2>&1 | grep -c '^error'`
Expected: a non-zero count. Each error is a destructuring `let (m, h, ds) = parse_tm_full(..)` that must become field access on the returned `TmDocument`. Work through them with `cargo build --workspace --all-targets` until it is zero. Do not change any test's assertions — only the shape of how it reads the result.

- [ ] **Step 8: Verify no behaviour moved**

Run: `cargo nextest run --workspace`
Expected: the same pass count as before this task, with 0 failures.

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: no output, exit 0.

- [ ] **Step 9: Commit**

```bash
git add -A crates/
git commit -m "parse_tm_full returns a document, so the channel comments will arrive on exists before anything fills it"
```

---

## Task 2: Recover TM comments

**Files:**
- Modify: `crates/redextape-core/src/tm/syntax.rs`
- Test: `crates/redextape-core/tests/tm_comments.rs` (create)

**Interfaces:**
- Consumes: `TmDocument`, `AnchoredComment`, `TmAnchor`, `TmDirective`, `split_trailing`, `whole_line` from Task 1.
- Produces: `parse_tm_full` populating `TmDocument::comments`.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-core/tests/tm_comments.rs`:

```rust
//! Comments survive a parse of authored `.tm` text, anchored to the line they sit against.

use redextape_core::tm::comments::{TmAnchor, TmDirective};
use redextape_core::tm::syntax::parse_tm_full;

/// A machine with a comment against every anchor variant a header-less file can reach.
const ANNOTATED: &str = "\
; about the whole file
tapes 1 ; how many
start q0 ; where it begins

; about q0
state q0: ; the only working state
  ; about the rule
  [a] -> write [b], move [R], goto q1 ; the only rule
state q1: accept ; done
; nothing follows
";

#[test]
fn every_anchor_position_is_recovered() {
    let d = parse_tm_full(ANNOTATED);
    assert_eq!(d.diagnostics, vec![], "fixture must parse clean");

    let got: Vec<(&str, TmAnchor, bool)> =
        d.comments.iter().map(|c| (c.text.as_str(), c.anchor, c.own_line)).collect();

    assert_eq!(
        got,
        vec![
            ("about the whole file", TmAnchor::Tapes, true),
            ("how many", TmAnchor::Tapes, false),
            ("where it begins", TmAnchor::Start, false),
            ("about q0", TmAnchor::State(0), true),
            ("the only working state", TmAnchor::State(0), false),
            ("about the rule", TmAnchor::Rule { state: 0, index: 0 }, true),
            ("the only rule", TmAnchor::Rule { state: 0, index: 0 }, false),
            ("done", TmAnchor::State(1), false),
            ("nothing follows", TmAnchor::Eof, true),
        ]
    );
}

#[test]
fn a_header_directive_carries_its_own_anchor() {
    let src = "\
tapes 1
start q0
version 1 ; the format version
encoding unary
width 8
slots 1
result Nat ; what comes back

state q0: accept
";
    let d = parse_tm_full(src);
    assert_eq!(d.diagnostics, vec![], "fixture must parse clean");

    let got: Vec<(&str, TmAnchor)> = d.comments.iter().map(|c| (c.text.as_str(), c.anchor)).collect();
    assert_eq!(
        got,
        vec![
            ("the format version", TmAnchor::Directive(TmDirective::Version)),
            ("what comes back", TmAnchor::Directive(TmDirective::Result)),
        ]
    );
}

#[test]
fn a_file_with_an_error_recovers_no_comments() {
    let d = parse_tm_full("tapes 1\nstart q0\nnonsense ; a comment\nstate q0: accept\n");
    assert!(!d.diagnostics.is_empty(), "the fixture must fail to parse");
    assert_eq!(d.comments, vec![], "a document with no machine has nothing to print");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo nextest run -p redextape-core --test tm_comments`
Expected: FAIL. `every_anchor_position_is_recovered` and `a_header_directive_carries_its_own_anchor` compare a populated list against an empty `d.comments`; `a_file_with_an_error_recovers_no_comments` already passes.

- [ ] **Step 3: Add the accumulators to the parse loop**

In `parse_tm_full`, beside the existing six accumulators:

```rust
    let mut comments: Vec<AnchoredComment<TmAnchor>> = Vec::new();
    // Own-line comments seen but not yet attached: they belong to the NEXT line that parses, which
    // has not been read. Drained at each anchor and, if any survive, at end of input.
    let mut pending: Vec<String> = Vec::new();
```

- [ ] **Step 4: Capture whole-line comments instead of discarding them**

Replace the existing blank-and-comment skip with:

```rust
        let trimmed = content.trim_start();
        if let Some(body) = comments::whole_line(trimmed) {
            pending.push(body.to_string());
            continue;
        }
        if trimmed.is_empty() {
            // Blank lines are structure, not content: the printer decides where they go.
            continue;
        }
```

- [ ] **Step 5: Attach at each anchor**

Add this closure above the loop:

```rust
    // Attach everything waiting to `anchor`, then the line's own trailing comment. Called only
    // from a branch that has decided the line parses — a line that errors leaves `pending` intact
    // for the next line that does, and contributes no trailing comment of its own.
    let attach = |comments: &mut Vec<AnchoredComment<TmAnchor>>,
                  pending: &mut Vec<String>,
                  anchor: TmAnchor,
                  content: &str| {
        for text in pending.drain(..) {
            comments.push(AnchoredComment { text, anchor, own_line: true });
        }
        if let (_, Some(body)) = comments::split_trailing(content) {
            comments.push(AnchoredComment { text: body.to_string(), anchor, own_line: false });
        }
    };
```

Then call it at the end of each successful branch, before `continue` where one exists:

| branch | call |
|---|---|
| `tapes ` parsed `Ok(n)` | `attach(&mut comments, &mut pending, TmAnchor::Tapes, content);` |
| directive accepted | `attach(&mut comments, &mut pending, TmAnchor::Directive(dir), content);` |
| `start ` | `attach(&mut comments, &mut pending, TmAnchor::Start, content);` |
| `state ` pushed a `RawState` | `let id = (states.len() - 1) as StateId;` then `attach(.., TmAnchor::State(id), content);` |
| rule pushed `Ok(r)` | `let id = (states.len() - 1) as StateId;` and `let index = state.rules.len() - 1;` then `attach(.., TmAnchor::Rule { state: id, index }, content);` |

The state id is `states.len() - 1` because ids are assigned in definition order and the entry was just pushed — the same order `print_tm_inner` walks `m.states` in, which is what makes the anchor round-trip.

**The rule branch needs its two indices in this order or it will not borrow-check.** `state` is a `&mut` into `states`, so `states.len()` cannot be read while it is live:

```rust
            match parse_rule_line(trimmed, span) {
                Ok(r) => {
                    state.rules.push(r);
                    let index = state.rules.len() - 1; // still inside `state`'s borrow
                    let id = (states.len() - 1) as StateId; // `state` is dead from here
                    attach(&mut comments, &mut pending, TmAnchor::Rule { state: id, index }, content);
                }
                Err(d) => diags.push(d),
            }
```

- [ ] **Step 6: Map a directive key to its variant**

Add beside `parse_tm_full`:

```rust
/// The anchor for a header directive line. `rest` is everything after the key, which for `tape` is
/// the index followed by the cells.
///
/// Returns `None` when a `tape` line's index does not parse — that line is about to produce a
/// diagnostic, so the caller attaches nothing and the comment waits for a line that works.
fn directive_anchor(key: &str, rest: &str) -> Option<TmDirective> {
    Some(match key {
        "version" => TmDirective::Version,
        "encoding" => TmDirective::Encoding,
        "width" => TmDirective::Width,
        "slots" => TmDirective::Slots,
        "result" => TmDirective::Result,
        "tape" => TmDirective::Tape(rest.split_whitespace().next()?.parse().ok()?),
        _ => return None,
    })
}
```

- [ ] **Step 7: Drain what is left at end of input**

After the loop, before the `tapes` check:

```rust
    for text in pending.drain(..) {
        comments.push(AnchoredComment { text, anchor: TmAnchor::Eof, own_line: true });
    }
```

- [ ] **Step 8: Return the comments only on a clean parse**

At each `return`/tail that yields `machine: None`, keep `comments: Vec::new()`. At the success tail, use the accumulated `comments`. This is what `a_file_with_an_error_recovers_no_comments` pins, and the reason is worth a comment at the site:

```rust
    // Comments ride with a machine or not at all. A document with `machine: None` is never printed,
    // so a partial recovery from a half-parsed file would be a value nothing can be right or wrong
    // about — and it is the shape in which an anchor could name a line the printer never emits.
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cargo nextest run -p redextape-core --test tm_comments`
Expected: `3 tests run: 3 passed`.

- [ ] **Step 10: Verify nothing else moved**

Run: `cargo nextest run --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: no failures, no clippy output.

- [ ] **Step 11: Commit**

```bash
git add -A crates/
git commit -m "The TM parser keeps the comments it used to drop, anchored to the line each one sits against"
```

---

## Task 3: Emit TM comments

**Files:**
- Modify: `crates/redextape-core/src/tm/syntax.rs`, `crates/redextape-core/src/tm/header.rs`
- Test: `crates/redextape-core/tests/tm_comments.rs`

**Interfaces:**
- Consumes: `TmDocument` with populated `comments` from Task 2.
- Produces: `print_tm_doc(d: &TmDocument) -> Option<String>`.

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-core/tests/tm_comments.rs`:

```rust
use redextape_core::tm::syntax::{print_tm_doc, print_tm_with};

#[test]
fn printing_a_document_emits_every_comment() {
    let d = parse_tm_full(ANNOTATED);
    let out = print_tm_doc(&d).expect("the fixture parses, so it prints");

    for body in [
        "about the whole file",
        "how many",
        "where it begins",
        "about q0",
        "the only working state",
        "about the rule",
        "the only rule",
        "done",
        "nothing follows",
    ] {
        assert!(out.contains(&format!("; {body}")), "missing `; {body}` in:\n{out}");
    }
}

#[test]
fn a_document_with_no_comments_prints_exactly_what_the_old_printer_prints() {
    let src = "tapes 1\nstart q0\n\nstate q0: accept\n";
    let d = parse_tm_full(src);
    let machine = d.machine.clone().expect("the fixture parses");

    assert_eq!(print_tm_doc(&d).as_deref(), Some(print_tm(&machine).as_str()));
}

#[test]
fn a_document_with_no_machine_does_not_print() {
    let d = parse_tm_full("nonsense\n");
    assert_eq!(print_tm_doc(&d), None);
}

/// A machine printed with a header, checked in. Its `tape 0` line carries the generated `; reg`
/// label, which is what makes the collision below reachable rather than hypothetical.
const LIST_1_2: &str = include_str!("fixtures/list_1_2.tm");

#[test]
fn an_authored_comment_takes_the_tape_line_over_the_generated_name() {
    // `write_header` labels tape 0 `; reg` and tape 1 `; work`. Two comments on one line reparse as
    // ONE — `;` runs to end of line — so an authored comment must displace the generated label
    // rather than sit beside it, or the round trip is lost.
    assert!(LIST_1_2.contains("; reg"), "precondition: the fixture must carry a generated label");
    let authored = LIST_1_2.replace("; reg", "; mine");

    let d = parse_tm_full(&authored);
    assert_eq!(d.diagnostics, vec![], "the fixture must parse clean");
    let printed = print_tm_doc(&d).expect("a clean parse prints");

    let tape_line =
        printed.lines().find(|l| l.trim_start().starts_with("tape 0")).expect("a tape 0 line");
    assert!(tape_line.contains("; mine"), "authored comment missing from: {tape_line}");
    assert!(!tape_line.contains("; reg"), "generated label was not displaced: {tape_line}");
    assert_eq!(tape_line.matches(';').count(), 1, "two comments on one line: {tape_line}");
}
```

Add `use redextape_core::tm::syntax::print_tm;` to the imports.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo nextest run -p redextape-core --test tm_comments`
Expected: FAIL to compile — `print_tm_doc` does not exist.

- [ ] **Step 3: Give `print_tm_inner` a comment parameter**

Change its signature to:

```rust
fn print_tm_inner(
    m: &Machine,
    header: Option<&TmHeader>,
    comments: &[AnchoredComment<TmAnchor>],
) -> (String, Classified)
```

and pass `&[]` from `print_tm_mapped` and `print_tm_with_mapped`. An empty slice writes nothing, so those two produce byte-identical output by construction rather than by care — which is what keeps the listing golden green.

- [ ] **Step 4: Build the writer**

At the top of `print_tm_inner`:

```rust
    let cw = CommentWriter::new(comments);
```

That is the whole of it — the bucketing, the own-line loop, the trailing join and the
`has_trailing` predicate all live in `comments.rs` and are shared with the asm printer, because
they are one rule rather than two that agree.

- [ ] **Step 5: Call it at each anchored line**

For `tapes`, `start`, each `state` header and each rule: call `cw.own_line(o, s, anchor, indent)` before writing the line — `indent` is `""` for everything but a rule and `"  "` for a rule — and `cw.trailing(o, s, anchor)` after the line's last span and before its `'\n'`. After the state loop, call `cw.own_line(o, s, TmAnchor::Eof, "")`.

The `state ... accept` branch has its own `o.push('\n'); continue;`, so it needs its own `cw.trailing` call before that newline — the non-accept path's call does not cover it.

- [ ] **Step 6: Thread the writer into `write_header`**

Change `write_header` to take `cw: &CommentWriter<'_, TmAnchor>`, call `cw.own_line` and `cw.trailing` around each directive line, and suppress the generated `tape_name` label when the author wrote their own:

```rust
        // AN AUTHORED COMMENT DISPLACES THE GENERATED LABEL RATHER THAN JOINING IT. `;` runs to end
        // of line, so `; reg  ; mine` reparses as ONE comment whose body is `reg  ; mine`, and the
        // round trip is lost. The author's line wins: a generated label is a convenience, and
        // somebody who wrote their own has said what they want the line to say.
        //
        // Reachable, not defensive: `tape_name` labels tape 0 `reg` and tape 1 `work`, and
        // `tests/fixtures/list_1_2.tm` carries `; reg` on its `tape 0` line today.
        if !cw.has_trailing(TmAnchor::Directive(TmDirective::Tape(*i))) {
            if let Some(name) = tape_name(*i) {
                out.push_str("  ");
                push_span(out, spans, &format!("; {name}"), TokenClass::Comment);
            }
        }
```

`write_header`'s two existing callers pass the writer through. `print_tm_mapped` and `print_tm_with_mapped` build theirs from `&[]`, so it answers `false` to every `has_trailing` and writes nothing — which is what keeps their bytes identical.

- [ ] **Step 7: Add `print_tm_doc`**

```rust
/// Render a document — machine, header and comments — as `.tm` text.
///
/// `None` when the document has no machine, which is exactly when it carried an error diagnostic.
/// A formatter has nothing to write for a file that does not parse, and saying so with `None` is
/// what lets the caller leave the buffer alone rather than replace it with something.
#[must_use]
pub fn print_tm_doc(d: &TmDocument) -> Option<String> {
    let m = d.machine.as_ref()?;
    Some(print_tm_inner(m, d.header.as_ref(), &d.comments).0)
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cargo nextest run -p redextape-core --test tm_comments`
Expected: `7 tests run: 7 passed`.

- [ ] **Step 9: Verify the golden did not move**

Run: `cargo nextest run --workspace`
Expected: no failures. Any golden diff here means Step 3's empty slice is not actually reaching the old path.

- [ ] **Step 10: Sabotage the suppression, to check the test bites**

Temporarily delete the `if !cw.has_trailing(..)` guard from Step 6. Run `cargo nextest run -p redextape-core --test tm_comments`. Expected: `an_authored_comment_takes_the_tape_line_over_the_generated_name` FAILS on the `matches(';').count()` assertion. Restore the guard and re-run to green.

- [ ] **Step 11: Commit**

```bash
git add -A crates/
git commit -m "The TM printer writes the comments back, and an authored one displaces the generated tape label rather than colliding with it"
```

---

## Task 4: The TM round-trip property

**Files:**
- Test: `crates/redextape-core/tests/tm_comments.rs`

- [ ] **Step 1: Write the failing test**

Append:

```rust
use proptest::prelude::*;

/// A comment body that survives a round trip: no newline (impossible from a line-based parser
/// anyway) and no leading or trailing whitespace, since the printer writes `; ` and the parser
/// trims. Everything else is fair game, `;` included.
fn body() -> impl Strategy<Value = String> {
    "[^\n]{0,40}".prop_map(|s| s.trim().to_string())
}

proptest! {
    /// The property the formatter's safety rests on, and the one nothing checked before.
    #[test]
    fn printing_then_parsing_returns_the_same_document(
        bodies in proptest::collection::vec(body(), 0..6),
    ) {
        let mut src = String::from("tapes 1\nstart q0\n\nstate q0: accept\n");
        for b in &bodies {
            src.push_str(&format!("; {b}\n"));
        }

        let first = parse_tm_full(&src);
        prop_assume!(first.diagnostics.is_empty());
        let printed = print_tm_doc(&first).expect("a clean parse prints");
        let second = parse_tm_full(&printed);

        prop_assert_eq!(&second.machine, &first.machine);
        prop_assert_eq!(&second.header, &first.header);
        prop_assert_eq!(&second.comments, &first.comments);
    }
}
```

- [ ] **Step 2: Run it**

Run: `cargo nextest run -p redextape-core --test tm_comments -E 'test(printing_then_parsing)'`
Expected: PASS if Tasks 2 and 3 are right. If it fails, proptest writes a minimal counterexample to `crates/redextape-core/tests/tm_comments.proptest-regressions` — fix the parser or printer, never the property.

- [ ] **Step 3: Sabotage the printer, to check the property bites**

Temporarily change `CommentWriter::own_line` in `comments.rs` to drop its first comment:

```rust
        for text in self.own.get(&anchor).into_iter().flatten().skip(1) {
```

Run: `cargo nextest run -p redextape-core --test tm_comments`
Expected: FAIL. `printing_then_parsing_returns_the_same_document` must report a `comments` mismatch on any input with two or more own-line comments, and `printing_a_document_emits_every_comment` must fail too. A property that stays green under a printer that silently drops a comment is not checking the thing this slice exists for.

Restore the line and re-run to green before committing.

- [ ] **Step 4: Commit**

```bash
git add -A crates/
git commit -m "The round trip over documents is a property now, not a claim about the direction the guarantee did not cover"
```

---

## Task 5: `AsmDocument`, with the comment channel empty

The asm mirror of Task 1. 16 call sites.

**Files:**
- Modify: `crates/redextape-core/src/tm/asm_syntax.rs`

**Interfaces:**
- Produces: `AsmDocument { program: Option<Program>, header: Option<AsmHeader>, comments: Vec<AnchoredComment<AsmAnchor>>, diagnostics: Vec<Diagnostic> }`; `parse_asm_full(src: &str) -> AsmDocument`.

- [ ] **Step 1: Declare `AsmDocument`**

In `crates/redextape-core/src/tm/asm_syntax.rs`, above `parse_asm_full`:

```rust
/// An `.asm` file as authored: the program it describes, its optional header, and the comments that
/// belong to neither. `TmDocument`'s shape over asm's line grammar, for the reasons stated there.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AsmDocument {
    /// `None` exactly when `diagnostics` is non-empty, matching what the tuple returned.
    pub program: Option<Program>,
    pub header: Option<AsmHeader>,
    /// Recovered only from lines that parsed, for the reason `TmDocument::comments` states.
    pub comments: Vec<AnchoredComment<AsmAnchor>>,
    pub diagnostics: Vec<Diagnostic>,
}
```

- [ ] **Step 2: Change the signature and the tail**

`pub fn parse_asm_full(src: &str) -> AsmDocument`, with the tail becoming:

```rust
    if diags.is_empty() {
        AsmDocument { program: Some(Program { code, labels }), header, comments: Vec::new(), diagnostics: diags }
    } else {
        AsmDocument { program: None, header: None, comments: Vec::new(), diagnostics: diags }
    }
```

- [ ] **Step 3: Fix `parse_asm`**

```rust
#[must_use]
pub fn parse_asm(src: &str) -> (Option<Program>, Vec<Diagnostic>) {
    let d = parse_asm_full(src);
    (d.program, d.diagnostics)
}
```

- [ ] **Step 4: Fix the remaining call sites**

Run `cargo build --workspace --all-targets` and work through each error until it is zero. Change only how a result is read, never an assertion.

- [ ] **Step 5: Verify no behaviour moved**

Run: `cargo nextest run --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: the same pass count as before this task, no clippy output.

- [ ] **Step 6: Commit**

```bash
git add -A crates/
git commit -m "parse_asm_full returns a document too, the same shape and for the same reason"
```

---

## Task 6: Recover asm comments

**Files:**
- Modify: `crates/redextape-core/src/tm/asm_syntax.rs`
- Test: `crates/redextape-core/tests/asm_comments.rs` (create)

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-core/tests/asm_comments.rs`:

```rust
//! Comments survive a parse of authored `.asm` text, anchored to the line they sit against.

use redextape_core::tm::asm_syntax::parse_asm_full;
use redextape_core::tm::comments::AsmAnchor;

const ANNOTATED: &str = "\
; about the whole listing
result Nat ; what comes back

; about the entry
f: ; the entry label
    li\tr0, 1 ; load one
    ret
; nothing follows
";

#[test]
fn every_anchor_position_is_recovered() {
    let d = parse_asm_full(ANNOTATED);
    assert_eq!(d.diagnostics, vec![], "fixture must parse clean");

    let got: Vec<(&str, AsmAnchor, bool)> =
        d.comments.iter().map(|c| (c.text.as_str(), c.anchor, c.own_line)).collect();

    assert_eq!(
        got,
        vec![
            ("about the whole listing", AsmAnchor::Result, true),
            ("what comes back", AsmAnchor::Result, false),
            ("about the entry", AsmAnchor::Label(0), true),
            ("the entry label", AsmAnchor::Label(0), false),
            ("load one", AsmAnchor::Instr(0), false),
            ("nothing follows", AsmAnchor::Eof, true),
        ]
    );
}

#[test]
fn a_file_with_an_error_recovers_no_comments() {
    let d = parse_asm_full("notamnemonic r0 ; a comment\n");
    assert!(!d.diagnostics.is_empty(), "the fixture must fail to parse");
    assert_eq!(d.comments, vec![], "a document with no program has nothing to print");
}
```

The mnemonics and operand spelling come from `instr_parts`: `Instr::Li(rd, n)` prints as `li` with a register and an immediate, `Instr::Ret` as `ret` with no operands. `print_asm_mapped` indents an instruction four spaces, writes a `\t` before the first operand and `, ` between the rest, and writes a label at column 0 — so the fixture above is in the printer's own format, which is what lets the emission test compare against it directly.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo nextest run -p redextape-core --test asm_comments`
Expected: FAIL on the empty `d.comments`.

- [ ] **Step 3: Add the accumulators and capture whole-line comments**

In `parse_asm_full`, beside the existing accumulators:

```rust
    let mut comments: Vec<AnchoredComment<AsmAnchor>> = Vec::new();
    let mut pending: Vec<String> = Vec::new();
```

The existing `let text = content.split(';').next()...` already discards the comment. Replace it so both halves are kept:

```rust
        let (before, comment) = comments::split_trailing(content);
        let text = before.trim();
        if text.is_empty() {
            if let Some(body) = comment {
                pending.push(body.to_string());
            }
            continue;
        }
```

This handles the whole-line case and the blank-line case together, because a whole-line comment has an empty `before`.

- [ ] **Step 4: Attach at each anchor**

Add the same `attach` closure as Task 2, over `AsmAnchor`, taking the already-split `comment: Option<&str>` rather than re-splitting:

```rust
    let attach = |comments: &mut Vec<AnchoredComment<AsmAnchor>>,
                  pending: &mut Vec<String>,
                  anchor: AsmAnchor,
                  comment: Option<&str>| {
        for text in pending.drain(..) {
            comments.push(AnchoredComment { text, anchor, own_line: true });
        }
        if let Some(body) = comment {
            comments.push(AnchoredComment { text: body.to_string(), anchor, own_line: false });
        }
    };
```

Call it in three places:

| branch | call |
|---|---|
| a label was pushed | `attach(&mut comments, &mut pending, AsmAnchor::Label(labels.len() - 1), comment);` |
| `result` accepted | `attach(&mut comments, &mut pending, AsmAnchor::Result, comment);` |
| `parse_instr` returned `Ok` | `attach(&mut comments, &mut pending, AsmAnchor::Instr(code.len() - 1), comment);` |

`Label` is indexed by position in `Program::labels` rather than by name, because several labels may sit at one instruction index and the printer reproduces `Program::labels` order.

- [ ] **Step 5: Drain at end of input and gate on a clean parse**

After the loop:

```rust
    for text in pending.drain(..) {
        comments.push(AnchoredComment { text, anchor: AsmAnchor::Eof, own_line: true });
    }
```

and pass `comments` in the `diags.is_empty()` arm only, keeping `Vec::new()` in the other.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cargo nextest run -p redextape-core --test asm_comments`
Expected: `2 tests run: 2 passed`.

- [ ] **Step 7: Commit**

```bash
git add -A crates/
git commit -m "The asm parser keeps its comments too, and the split it already did is now used for both halves"
```

---

## Task 7: Emit asm comments

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs`
- Test: `crates/redextape-core/tests/asm_comments.rs`

**Interfaces:**
- Produces: `print_asm_doc(d: &AsmDocument) -> Option<String>`.

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-core/tests/asm_comments.rs`:

```rust
use redextape_core::tm::asm::{print_asm, print_asm_doc};

#[test]
fn printing_a_document_emits_every_comment() {
    let d = parse_asm_full(ANNOTATED);
    let out = print_asm_doc(&d).expect("the fixture parses, so it prints");
    for body in ["about the whole listing", "what comes back", "about the entry", "the entry label", "load one", "nothing follows"] {
        assert!(out.contains(&format!("; {body}")), "missing `; {body}` in:\n{out}");
    }
}

#[test]
fn a_document_with_no_comments_prints_exactly_what_the_old_printer_prints() {
    let d = parse_asm_full("f:\n    li\tr0, 1\n");
    let program = d.program.clone().expect("the fixture parses");
    assert_eq!(print_asm_doc(&d).as_deref(), Some(print_asm(&program).as_str()));
}

#[test]
fn a_document_with_no_program_does_not_print() {
    assert_eq!(print_asm_doc(&parse_asm_full("notamnemonic\n")), None);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo nextest run -p redextape-core --test asm_comments`
Expected: FAIL to compile — `print_asm_doc` does not exist.

- [ ] **Step 3: Thread comments through the asm printer**

Give `print_asm_mapped` and `print_asm_with_mapped` a private shared inner taking the comments, and have both public entry points pass `&[]` — the same construction Task 3 used, and for the same reason: an empty slice writes nothing, so the old output is byte-identical by construction rather than by care.

```rust
fn print_asm_with_inner(
    prog: &Program,
    header: Option<&AsmHeader>,
    comments: &[AnchoredComment<AsmAnchor>],
) -> (String, crate::analysis::Classified) {
    use crate::analysis::TokenClass as C;
    let mut out = String::new();
    let mut spans: crate::analysis::Classified = Vec::new();

    // The same writer the TM printer uses. One rule, one implementation.
    let cw = CommentWriter::new(comments);

    if let Some(h) = header {
        cw.own_line(&mut out, &mut spans, AsmAnchor::Result, "");
        push_span(&mut out, &mut spans, "result", C::Keyword);
        out.push(' ');
        push_span(&mut out, &mut spans, &crate::ty::show(&h.result), C::Ident);
        cw.trailing(&mut out, &mut spans, AsmAnchor::Result);
        out.push('\n');
        out.push('\n');
    }

    // `(usize, &str)` rather than `&str`: the anchor is the label's index in `prog.labels`, because
    // several labels may sit at one instruction index and this bucketing is what reproduces their
    // order. The index has to travel with the name to reach the emit calls below.
    let mut labels_at: Vec<Vec<(usize, &str)>> = vec![Vec::new(); prog.code.len() + 1];
    for (li, (name, at)) in prog.labels.iter().enumerate() {
        if let Some(bucket) = labels_at.get_mut(*at) {
            bucket.push((li, name.as_str()));
        }
    }

    let emit_label = |o: &mut String, s: &mut crate::analysis::Classified, li: usize, name: &str| {
        cw.own_line(o, s, AsmAnchor::Label(li), "");
        push_span(o, s, name, C::Label);
        push_span(o, s, ":", C::Punct);
        cw.trailing(o, s, AsmAnchor::Label(li));
        o.push('\n');
    };

    for (idx, instr) in prog.code.iter().enumerate() {
        for (li, name) in labels_at.get(idx).into_iter().flatten() {
            emit_label(&mut out, &mut spans, *li, name);
        }
        cw.own_line(&mut out, &mut spans, AsmAnchor::Instr(idx), "    ");
        out.push_str("    ");
        let (mnemonic, operands) = instr_parts(instr);
        push_span(&mut out, &mut spans, mnemonic, C::Mnemonic);
        for (i, operand) in operands.iter().enumerate() {
            if i == 0 {
                out.push('\t');
            } else {
                push_span(&mut out, &mut spans, ",", C::Punct);
                out.push(' ');
            }
            push_span(&mut out, &mut spans, &operand_str(operand), operand.class());
        }
        cw.trailing(&mut out, &mut spans, AsmAnchor::Instr(idx));
        out.push('\n');
    }
    for (li, name) in labels_at.get(prog.code.len()).into_iter().flatten() {
        emit_label(&mut out, &mut spans, *li, name);
    }
    cw.own_line(&mut out, &mut spans, AsmAnchor::Eof, "");
    (out, spans)
}
```

Then `print_asm_mapped(prog)` becomes `print_asm_with_inner(prog, None, &[])` and `print_asm_with_mapped(prog, h)` becomes `print_asm_with_inner(prog, Some(h), &[])`. Check `crate::ty::show`'s spelling and the header's exact blank-line placement against the existing `print_asm_with_mapped` before replacing it — the goldens pin both, and Step 6 is what catches a mistake.

- [ ] **Step 4: Add `print_asm_doc`**

```rust
/// Render a document — program, header and comments — as `.asm` text.
///
/// `None` when the document has no program, for the reason `print_tm_doc` states.
#[must_use]
pub fn print_asm_doc(d: &AsmDocument) -> Option<String> {
    let p = d.program.as_ref()?;
    Some(match d.header.as_ref() {
        Some(h) => print_asm_with_inner(p, Some(h), &d.comments).0,
        None => print_asm_with_inner(p, None, &d.comments).0,
    })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo nextest run -p redextape-core --test asm_comments`
Expected: `5 tests run: 5 passed`.

- [ ] **Step 6: Verify the asm goldens did not move**

Run: `cargo nextest run -p redextape-core --test asm_roundtrip --test asm_oracle`
Expected: no failures.

- [ ] **Step 7: Commit**

```bash
git add -A crates/
git commit -m "The asm printer writes its comments back, and its label bucketing carries the index the anchor needs"
```

---

## Task 8: The asm round-trip property

**Files:**
- Test: `crates/redextape-core/tests/asm_comments.rs`

**This task was rewritten after Task 4 shipped.** Its first draft appended generated comments after a
fixed skeleton, which puts every one of them at `AsmAnchor::Eof` with `own_line: true` — the exact
weakness a review found in Task 4's property, where it meant roughly one of a dozen (anchor,
`own_line`) combinations was ever exercised. Do not reintroduce that shape.

**And asm may support a STRONGER property than TM does.** TM's guarantee had to be weakened to
idempotence because `write_header` fabricates `; reg` / `; work` labels via `tape_name`, so a
hand-authored document without them is not a fixed point. The asm printer has no such generated-comment
path — but **verify that rather than assuming it**, by reading `print_asm_with_inner` and everything it
calls for any site that writes a `;` other than from the `CommentWriter`. If there is none, assert the
strict round trip. If there is one, assert idempotence and report the site.

**AND ASK THE QUESTION THAT COST TM FOUR ROUNDS, WHICH IS NOT THE ONE ABOUT GENERATED COMMENTS.**
TM's guarantee was falsified twice. The first time by `write_header` fabricating a `; reg` label, which
the paragraph above tells you to look for. The second time by something the first search would never
have found: **two lines in one document attaching two TRAILING comments to the same anchor.**

`CommentWriter::trailing` joins several trailing comments on one anchor with `" ; "`, and that join is
not a fixed point when a body is empty — `["", ""]` prints `";  ; "` and reparses to `";"`. TM's
`TmAnchor::Tapes` and `TmAnchor::Start` were each named from a **family** of lines (every `tapes ...`
line, every `start ...` line) rather than from one line, and `parse_tm_full` diagnosed neither
duplicate, so the shape parsed clean and idempotence was false for it. The fix was a production
change: `duplicate \`tapes\` line` and `duplicate \`start\` line` are errors now.

**So before asserting anything, establish for EVERY `AsmAnchor` variant that a clean parse cannot
attach two trailing comments to it.** The asm side looks safe — `parse_asm_full` already emits
`duplicate \`result\` directive`, and `Label(i)` and `Instr(i)` are positional rather than
keyword-named — but *looks safe* is what TM's own lemma said, in production code, while being false
for two anchors. Verify it against `parse_asm_full` and write the finding down; if any anchor can
receive two, that is a production decision to report, not to route around.

**And make the property able to see the answer.** TM's property could not: its generator emitted one
`tapes` and one `start` line per document, so 512 green cases said nothing about the class that
falsified it. If a duplicate is diagnosed, pin that with a deterministic test naming the severity,
since a generator that only produces clean documents cannot notice the diagnostic being removed later.

- [ ] **Step 1: Write the deterministic all-variants test**

A fixture in which every `AsmAnchor` variant — `Result`, `Label(i)`, `Instr(i)`, `Eof` — carries both
an own-line and a trailing comment, except `Eof`, which can only carry own-line ones. Assert the
parse recovers exactly that list, then assert the round trip (or idempotence, per the check above).

The fixture must parse with zero diagnostics, and asserting that is part of the test. Use at least two
labels and two instructions so `Label(0)`/`Label(1)` and `Instr(0)`/`Instr(1)` are distinguished — a
test that only ever sees index 0 cannot tell a correctly computed index from a hardcoded one.

- [ ] **Step 2: Write the property**

Generate a document by placing comments at chosen positions rather than appending them at the end:
for each line of a skeleton, an optional trailing comment and an optional run of own-line comments
above it. Every anchor and both `own_line` values must be densely reachable, not merely possible.

Keep `prop_assume!(first.diagnostics.is_empty())`. **State its reason correctly, because the obvious
one is false** — this plan stated the false one first, and it reached a shipped code comment before a
review caught it. The guard does not filter out documents that would compare unequal; without it the
property **panics**. `parse_asm_full`'s tail check sets `program: None` whenever any diagnostic was
reported, and `print_asm_doc` opens with `let p = d.program.as_ref()?`, so such a document prints
`None` and the `.expect(..)` fires before any comparison runs. The guard is load-bearing against a
panic, and a future reader who takes it for tidiness and weakens it gets a shrink-storm.

Build the source with `writeln!` and `use std::fmt::Write as _;`. `push_str(&format!(..))` trips
`clippy::format_push_string` under this workspace's deny-on-CI gate.

- [ ] **Step 3: Run it, and report the discard count**

Run: `cargo nextest run -p redextape-core --test asm_comments`

**Report how many cases proptest rejected.** A property that `prop_assume!`s away most of its inputs
is another way of testing nothing, and the count is the only thing that shows which happened.

If the property fails, proptest writes a counterexample to
`crates/redextape-core/tests/asm_comments.proptest-regressions`. **Fix the code, never the property,
and never narrow the generator to route around a failing case.** Task 4's strengthened property went
red on its first run and the red was a false claim in the design, not a bad test. Escalate a failure
with the counterexample verbatim rather than working around it.

- [ ] **Step 4: Sabotage, to prove the property bites**

Temporarily change `CommentWriter::own_line` in `crates/redextape-core/src/tm/comments.rs` to skip its
first comment:

```rust
        for text in self.own.get(&anchor).into_iter().flatten().skip(1) {
```

Expected: the property fails. Restore, confirm green and an empty `git diff` on `comments.rs`.

**Note what this sabotage does and does not catch, because it differs by property.** Under a strict
round trip, an anchor carrying one own-line comment is enough: the comment is dropped and the second
document differs from the first. Under idempotence it is not, because a stable loss still prints the
same bytes twice — there the sabotage only bites where some anchor carries two or more. Whichever
property this task lands on, make sure the fixtures reach the case that can fail.

- [ ] **Step 5: Commit**

```bash
git add -A crates/
git commit -m "The asm comment round trip is a property, and it ranges over every anchor rather than one"
```

---

## Task 9: The full gate, and the roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Run the whole gate**

Run: `scripts/check-all.sh`
Expected: `all configs green — base, LLVM and browser`, exit 0. If LLVM or a browser is unavailable locally, use `--no-llvm` / `--no-browser` and say which legs were skipped in the roadmap entry rather than claiming a full run.

- [ ] **Step 2: Measure coverage against the floor**

Run: `cargo llvm-cov nextest --workspace --fail-under-lines 90`
Expected: exit 0. Record the actual percentage — the entry needs the number, not the verdict.

- [ ] **Step 3: Confirm the printers really are byte-identical**

The checked-in fixture was produced by `print_tm_with`, so reprinting it must reproduce it byte for byte. That needs no stash and no baseline:

```bash
cargo run -q -p redextape-cli -- emit crates/redextape-cli/tests/cmd/emit_asm.in/p.rxt --lang tm > /tmp/after.tm
head -1 /tmp/after.tm
```

Expected: a `tapes <n>` line, exit 0 — the emitter still produces a listing.

Then the direct byte check, which is the one that matters:

```bash
cargo run -q -p redextape-cli -- run crates/redextape-core/tests/fixtures/list_1_2.tm
```

Expected: the same value this fixture produced before the branch — it round-trips through `parse_tm_full`, which this slice changed. A `.tm` file is accepted by `run` directly, per the `Run` command's own doc.

Both are covered by tests already; they are run once by hand because the whole slice rests on the printers not moving, and a command a person watched is a different kind of evidence from a test that passed.

- [ ] **Step 4: Write the roadmap entry**

Add an entry under the extension-tracks section of `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` recording: what was closed and for which two forms; that λ has no comment syntax so the work was two forms and not three; the `tape_name` displacement rule and why two comments on one line cannot both be written; that comments ride with a machine or not at all; and a VERIFICATION block whose every figure names the command that produced it and was run at this head.

Per the repository's convention, the entry goes in **before** the PR is opened, and every figure in it is measured at the commit it is filed against — not carried from an earlier one.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "The roadmap entry for the two forms that now keep their comments"
```

- [ ] **Step 6: Open the PR**

Body as one long line per paragraph — Forgejo renders with GFM `breaks: true`, so a hard-wrapped paragraph shows as forced line breaks.

---

## Three corrections to the spec, found while reading the parsers

The design document was written before `parse_tm_full` and `parse_asm_full` had been read line by
line. Three of its claims did not survive that, and the plan implements the corrected version. The
spec should be amended to match rather than left to disagree with the code that ships.

1. **`unanchorable_comment_is_a_diagnostic` has nothing to report, and the test is dropped.** The
   spec anticipated comment text that could not round-trip. Once comments are recovered only from
   lines that parse, every body is by construction "the rest of a line after `;`" — it cannot
   contain a newline, and `;` runs to end of line so it cannot reopen the line it sits on. The
   unanchorable case does not exist. What replaces it is `a_file_with_an_error_recovers_no_comments`,
   which pins the rule that makes it not exist.

2. **The `tape_name` collision is reachable, not a corner.** The spec inherited the roadmap's note
   that `; stack`, `; heap` and `; box` are unreachable because those tapes start empty. True, and
   irrelevant: `tape_name` also labels tape 0 `reg` and tape 1 `work`, and
   `crates/redextape-core/tests/fixtures/list_1_2.tm` carries `; reg` on its `tape 0` line today.
   The displacement rule in Task 3 is load-bearing rather than defensive, and its test uses that
   fixture.

3. **The spec's §10 open question is answered: `AsmAnchor` needs no fourth case.** A comment
   following the last instruction of a non-final label block is either a trailing comment on
   `Instr(i)` or an own-line comment before `Label(j)`; `Result`, `Label`, `Instr` and `Eof` are
   total over `print_asm_mapped`'s output. Answered by reading the printer, and the answer belongs
   in `AsmAnchor`'s own doc, where Task 1 puts it.

## What this plan does not do

- **It does not build the LSP.** PR B in the design; its own plan.
- **It does not teach `redextape fmt` the two forms.** Now possible without data loss, and a follow-on.
- **It does not preserve blank lines.** The printer decides where those go, as it always has. Only comments are recovered.
- **It does not preserve comment placement within a line** — column, or whether the author wrote `;x` or `; x`. The body is trimmed and reprinted as `; body`, which is what makes the round trip a fixed point rather than a best effort.
- **It does not touch the λ text form**, which has no comment syntax to retain.
