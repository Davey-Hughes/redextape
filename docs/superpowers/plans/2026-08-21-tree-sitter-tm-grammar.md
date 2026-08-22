# tree-sitter grammars — PR 3: the TM text form

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a tree-sitter grammar for the TM text form, held to `print_tm_mapped` and `print_tm_with_mapped` span for span, so a grammar that colours a printed machine differently from the printer fails a test. Last of the three grammars; the slice closes with it.

**Architecture:** PR 2 generalised `crates/redextape-grammar-check` into a `Grammar` value carrying its own language, queries and capture map, and promoted six shared checks onto it. This PR adds a third `Grammar` and changes none of that machinery. What is new is the *form*: TM is line-oriented, has nine classes rather than three, has two printers rather than one, and produces corpus entries roughly **21× the size of λ's**.

**Tech Stack:** unchanged — tree-sitter CLI 0.25.10 (generation), `tree-sitter` Rust crate 0.26 (loading), `cc` (compiling generated C), `proptest` via `redextape-test-support`.

**Design:** [`../specs/2026-08-20-tree-sitter-grammars-design.md`](../specs/2026-08-20-tree-sitter-grammars-design.md). This implements its §10 PR 3. PR 1 merged 2026-08-21 as #53 (`648b7aa`); PR 2 merged 2026-08-21 as #54 (`80ec6d4`).

**The design was amended before this plan was written**, at `80ec6d4`, because PR 3's survey found two of its claims false. §1.6, §5.1, §6.3, §10 and a new §11.5 carry the corrections. Every figure below was **run on this machine at `80ec6d4`**, not recalled — the same standard §1 of the design sets for itself.

## Global Constraints

Every task's requirements implicitly include all of these.

- **Highlighting only.** No code path from a tree-sitter node to a `redextape_core` AST type. Reading `Span` and `TokenClass` is fine — they are data.
- **`crates/redextape-core` is NOT modified.** Task 1 touches three files under `web/`, comment text only — see that task for why the PR 2 constraint is relaxed exactly that far and no further.
- **Pinned toolchain:** tree-sitter CLI **`0.25.10`**, generated ABI **15**, `tree-sitter` Rust crate `0.26`. `/usr/sbin/tree-sitter` reports `0.27.0` and is Arch's `master` build — **do not use it**; use `.tools/tree-sitter`, which `scripts/setup-dev.sh` installs. Design §8.1.1 records why the pin sits below the newest release: 0.26+ binaries need glibc 2.39 and CI's runner has 2.35.
- **Every grammar directory needs a `tree-sitter.json`.** Without it the CLI warns and silently generates **ABI 14**, which the Rust crate refuses to load.
- **Node IS required** by the CLI to evaluate `grammar.js`. Design §8.1.2 records the invalid measurement that twice claimed otherwise.
- **Library code may not panic.** `[workspace.lints.clippy]` warns `unwrap_used`/`expect_used`/`panic`/`todo`/`unimplemented` plus `pedantic`, and CI makes warnings fatal. `clippy.toml` exempts those only inside a `#[test]` fn or `#[cfg(test)]` module — `src/*.rs` is neither. Integration tests in `tests/` may unwrap freely.
- **Nothing in this crate may reduce.** No `reduce_trace`, no `reduce`. **And for TM the analogue is simulation** — see Task 4 for the one place a bounded simulation is permitted and why.
- **A pre-commit hook runs on every commit** — `cargo fmt --check`, `cargo clippy -- -D warnings`, a C0-control-byte scan, a `file:line` citation scan. NEVER `--no-verify`. If the hook makes a commit split infeasible, collapse the split and say so.
- **No `file:line` citations in tracked source outside `docs/`** — cite symbols by name. **No C0 control bytes** except TAB, LF, CR. This matters more than usual here: Task 1 is about a control byte, and `test/corpus/*.txt` is tracked source.

---

## The TM text form, read from the tree at `80ec6d4`

From `crates/redextape-core/src/tm/syntax.rs` (`print_tm_inner`, `parse_tm_full`, `parse_rule_line`, `write_sym`, `write_syms`, `write_moves`, `write_state_name`) and `crates/redextape-core/src/tm/header.rs` (`write_header`, `parse_cells`, `tape_name`).

```
file       := line*
line       := blank | ';' ...            whole-line comment (after leading whitespace)
            | 'tapes' ' ' NAT            1..=MAX_TAPES, else a diagnostic
            | 'start' ' ' NAME
            | DIRECTIVE ' ' REST         version | encoding | width | slots | result | tape
            | 'state' ' ' NAME ':' [' accept']
            | RULE
RULE       := '[' SYM* ']' '->' 'write' '[' SYM* ']' ',' 'move' '[' MOVE* ']' ',' 'goto' NAME
SYM        := '*' | <single char>        `_` is the blank; a multi-char token uses its FIRST char
MOVE       := 'L' | 'R' | 'S'
```

Every line kind additionally accepts a trailing `;` comment: the parser splits each line at its **first** `;` before doing anything else.

**Four lexical facts that shape the grammar, none of them shared with the other two forms:**

1. **State names are extremely permissive.** The module doc's rule is "no whitespace or reserved `; * : [ ]`". Dots and digits are ordinary characters anywhere in a name. Measured over the machine for `1 + 2`, the character set actually used is `.01234abcdefhiklmnoprstvw`, and real names include `pc0`, `halt`, `overflow`, `wl1s2.s.sk0`, `add4.a.c.cwb`, and the longest, `add4.d.r.home` (13 chars). **Nothing like λ's `[_$A-Za-z][_$A-Za-z0-9]*` or the mini-language's identifier rule applies.** A grammar that reuses either will reject most of every machine this compiler emits.
2. **`tapes ` needs a literal trailing space.** `parse_tm_full` dispatches on `strip_prefix("tapes ")`. So does `start `, `state `. A tab there falls through to the unknown-line error.
3. **A tape's cells are ONE packed lexeme; a rule's symbols are one lexeme EACH.** `write_header` pushes a single `TapeSymbol` span for the whole run (`#0000#0000#`), with the comment *"ONE span for the whole cell run, not one per cell… a 120-cell bank would otherwise contribute 120 adjacent identical spans for no gain"*. `write_syms` pushes one `TapeSymbol` span per symbol inside `[..]`. **The grammar needs two different nodes for what looks like the same thing**, or the differential fails on span count at the first `tape` line.
4. **`->` is `Punct`, not `Operator`.** TM emits no `Operator` at all.

**What the printers classify — the whole authority.** `print_tm_inner` is the one printer and the header `Option` is the only difference between the entry points:

| printed text | `TokenClass` | printer |
|---|---|---|
| `tapes`, `start`, `state`, `accept`, `write`, `move`, `goto` | `Keyword` | both |
| the tape count after `tapes` | `Nat` | both |
| the `start` target, a `goto` target | `StateName` | both |
| the name in `state <name>:` | `Label` | both |
| `:` `[` `]` `,` `->` | `Punct` | both |
| each symbol inside `[..]`, including `*` and `_` | `TapeSymbol` | both |
| `L` `R` `S` | `Move` | both |
| `version`, `encoding`, `width`, `slots`, `result`, `tape` | `Keyword` | headered only |
| the `version`/`width`/`slots` numbers, the `tape` index | `Nat` | headered only |
| the `encoding` name, the `result` type | `Ident` | headered only |
| the packed cell run on a `tape` line | `TapeSymbol` | headered only |
| the trailing `; reg` on a named tape line | `Comment` | headered only |

**Seven classes header-less, nine headered** — measured, not read off the source: `print_tm_mapped` on `1 + 2` lowered at `Unary::at(8)` yields exactly `{Keyword, Label, Move, Nat, Punct, StateName, TapeSymbol}` over 3,163 spans; `print_tm_with_mapped` on the same machine yields those plus `{Comment, Ident}` over 3,177.

**Every printed token carries a span.** Unlike the mini-language, where whitespace is unclassified, TM's printer emits a span for every non-whitespace byte it writes — separators included. So **TM's queries must be total over the grammar's own tokens**: any token the grammar has and the queries do not capture produces a length mismatch in `compare_classified`. That is a stronger constraint than either sibling faced and it is a feature — it means the differential cannot quietly ignore a construct.

**The `<state {id}>` fallback is not reachable and must not be accommodated.** `write_state_name` prints `<state 7>` when a `Machine`'s `next` is out of range. It contains spaces and `<`/`>`, `Machine::validate()` rejects such a machine, and `lower_tm` never builds one. **Do not widen the state-name rule to accept it** — that would be the PR 2 defect (a rule shaped by text no authority produces) in the opposite direction.

---

## Sizing: the fact that makes this grammar different

λ's corpus was free to print. TM's is not, and this must be decided rather than inherited.

Measured at `80ec6d4`, `arb_expr_over` at the leaf range the mini corpus uses (`0u64..100`), 128 samples, lowered with `lower_asm` → `lower_tm(&Unary::at(8))` and printed with `print_tm_mapped`:

| | λ (`print_lambda_mapped`) | TM (`print_tm_mapped`) | ratio |
|---|---|---|---|
| mean bytes per entry | 912 | **18,905** | 21× |
| mean spans per entry | 637 | **6,865** | 11× |
| max bytes seen | 2,977 | **109,668** | 37× |
| max spans seen | — | **39,310** | — |

Curated programs are worse. `1 + 2` alone is a **5-tape, 54-state, 170-line, 8,620-byte** file with **3,177 spans** (via `run_tm_described` at `Unary`). The largest demo in `tm_oracle.rs`/`native_oracle.rs`, `fn count_down(n) { … } count_down(4)`, is **1,365 states, 4,722 lines, 272,283 bytes, 98,012 spans**; `fn sum(n) { … } sum(5)` is **1,182 states**. The smallest that lowers at all, `nil`, is 9 states and 368 spans.

**The authority side is cheap and is not the problem.** 256 lowerings-and-prints take **79 ms in debug, 17 ms in release**. `run_tm_described` — which additionally simulates — runs the small demos in **77–694 µs each**. What is unpriced is tree-sitter's half: at proptest's default 256 cases the TM differential would parse ~4.8 MB and compare ~2.0M spans per run.

**Two consequences, both binding on Task 4:**

- **Set `cases` explicitly. Do not inherit 256.** Start at **32** — that is ~600 KB and ~220K spans, which puts TM's generated leg at roughly the same span volume λ's 256-case leg already carries (163K) and therefore at a cost the suite has demonstrably absorbed. Measure the wall clock, record it, and raise it only with the measurement in hand.
- **`redextape-grammar-check` currently runs in 0.6 s for 28 tests.** That number is the baseline this PR is accountable to; a TM leg that pushes the crate past a few seconds has been sized wrong.

**Design §7's stated risk is not the one that bites.** §7 tells this corpus to filter on successful lowering and log the pass rate so a silent collapse fails visibly. Measured pass rate over `arb_expr_over`: **100% at both leaf ranges, 128 samples each, zero refusals.** Keep the filter and keep the log — the guard is correct and cheap — but do not expect it to fire, and do not let a green pass-rate log stand in for having sized the corpus. Refusal *is* common among the curated demos (53 of 89 collected demo strings do not lower), because several of those lists exist precisely to be refused.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `grammars/tree-sitter-redextape-tm/grammar.js` | the TM grammar — the only hand-edited grammar file |
| `grammars/tree-sitter-redextape-tm/tree-sitter.json` | metadata; **required for ABI 15** |
| `grammars/tree-sitter-redextape-tm/queries/highlights.scm` | capture assignments |
| `grammars/tree-sitter-redextape-tm/test/corpus/*.txt` | `tree-sitter test` cases over tree shape |
| `grammars/tree-sitter-redextape-tm/README.md` | install snippets |
| `grammars/tree-sitter-redextape-tm/src/**` | generated, committed |
| `crates/redextape-grammar-check/src/tm.rs` | TM's language, queries, map, corpus builders |
| `crates/redextape-grammar-check/tests/tm.rs` | TM's differential, capture and corpus tests |

**Modified:**

| Path | Change |
|---|---|
| `crates/redextape-grammar-check/src/lib.rs` | `pub mod tm;` and its re-export |
| `crates/redextape-grammar-check/build.rs` | compiles the third `parser.c` |
| `web/src/style.css`, `web/tests/browser/buffers-quota-restored.test.ts`, `web/tests/browser/pane-layout-controls.test.ts` | Task 1b — comment text only |
| `scripts/check-all.sh` | Task 5 — one stale comment saying two grammars exist |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | Task 6 — the closing entry |

---

## Task 1: The two repairs PR 2 carried forward

**Files:**
- Modify: `web/src/style.css`, `web/tests/browser/buffers-quota-restored.test.ts`, `web/tests/browser/pane-layout-controls.test.ts`

**This task is first, and deliberately.** Both items are small, both are already three weeks old in slice-time, and both are the kind of thing that gets squeezed out of the last task of a large PR. Neither depends on anything else here.

> **THIS WHOLE TASK LANDED AHEAD OF THE PLAN, in the PR that carried the design amendment.** 1a went
> first: once the fix was proved the regenerated diff turned out to be **10 lines of `parser.c`, 2 of
> `grammar.json`, 0 of `node-types.json`**, so the one argument for deferring it — a large generated
> diff buried in a grammar PR — did not exist. 1b followed once two checks came back: CI's
> `rust-browser` and `web` jobs are gated on **file existence** (`Cargo.toml`, `web/package.json`), not
> on changed paths, so they already ran on that PR and 1b's marginal CI cost was zero; and the third
> citation turned out to be **worse than dangling** (below). **The steps are kept as the record of what
> was done and why, and are checked.** The plan proper begins at Task 2.

### 1a — U+000B VERTICAL TAB in the mini grammar — **DONE**

`grammars/tree-sitter-redextape/grammar.js` has `extras: $ => [/\s/, $.comment]`. **`/\s/` is ASCII in tree-sitter and the mini-language's authority is `is_ascii_whitespace()`, and they diverge on exactly one code point.** PR 2 found this while widening λ's own `extras` for the opposite reason, proved it with an exhaustive probe over every `char::is_whitespace()` code point plus U+FEFF, and left it open with a comment in `tree-sitter-redextape-lambda/grammar.js` saying so.

**THE DIFFERENTIAL CANNOT SEE THIS DEFECT, AND THAT IS THE FINDING.** Measured at `80ec6d4` on `let x =<VT>1;`:

| | grammar | `classify_source` | `parser::parse` |
|---|---|---|---|
| plain space | 0 error nodes, 5 captures | 5 spans | ok |
| **U+000B** | **0 error nodes, 5 captures** | **the same 5 spans** | **`unexpected character` — REJECTED** |
| U+000C FORM FEED | 0 error nodes, 5 captures | 5 spans | ok |
| U+00A0 NBSP | 2 error nodes at 7..9 | 5 spans | rejected |

`classify_source` is total on malformed input: it *skips* the offending byte and emits no span for it, so it returns the identical classification either way. `compare_classified` therefore **passes** on U+000B input. The defect is only visible against `parser::parse`. The NBSP row is the contrast — there, grammar and authority already agree.

**The fix is one character's worth of regex**, and it was proved before this plan was written. In a scratch copy of the grammar regenerated with `.tools/tree-sitter` 0.25.10:

```
extras: $ => [/[\t\n\f\r ]/, $.comment],      // was /\s/ — drops U+000B, which is what
                                              // is_ascii_whitespace() also drops
```

```
$ tree-sitter parse "let x = 1;"     →  (source_file (let_statement name: (identifier) value: (number)))
$ tree-sitter parse "let x =<VT>1;"  →  (source_file (let_statement name: (identifier)
                                           (ERROR (ERROR)) value: (number)))
$ tree-sitter parse "let x =<FF>1;"  →  clean
$ tree-sitter parse "let x =<LF>1;"  →  clean
```

Rust's `is_ascii_whitespace()` is the WhatWG Infra set — SPACE, TAB, LF, FF, CR — and **excludes VT**, which is the whole divergence.

- [x] **Step 1: Write the failing test first**, in `crates/redextape-grammar-check/tests/captures.rs`. It must compare **acceptance against `parser::parse`**, not spans against `classify_source` — the table above is why. Something in this shape:

```rust
/// The mini grammar's `extras` must accept exactly what `is_ascii_whitespace()` accepts.
///
/// **THIS CANNOT BE A DIFFERENTIAL TEST.** `classify_source` skips a byte the lexer rejects and
/// emits no span for it, so it returns the same classification whether or not the grammar accepts
/// U+000B, and `compare_classified` passes either way. The only authority that can see this is
/// `parser::parse`, so this test asks it directly.
#[test]
fn the_grammar_and_the_lexer_agree_on_every_ascii_whitespace_candidate() {
    for (name, sep, lexer_accepts) in [
        ("SPACE", ' ', true),
        ("TAB", '\t', true),
        ("LF", '\n', true),
        ("FF", '\u{0c}', true),
        ("CR", '\r', true),
        ("VT", '\u{0b}', false),   // is_ascii_whitespace() rejects it; /\s/ used to accept it
        ("NBSP", '\u{a0}', false),
    ] {
        let src = format!("let x ={sep}1;");
        let tree = MINI.parse(&src).expect("the grammar must parse");
        let grammar_accepts = MINI.error_nodes(&tree).is_empty();
        let (_, diags) = redextape_core::parser::parse(&src);
        assert_eq!(diags.is_empty(), lexer_accepts, "{name}: the lexer changed, not the grammar");
        assert_eq!(grammar_accepts, lexer_accepts, "{name}: the grammar and the lexer disagree");
    }
}
```

- [x] **Step 2: Run it and confirm the VT row fails**, and only the VT row. If NBSP fails too, the grammar has moved since this plan was measured — stop and report rather than adjusting the expectation.
- [x] **Step 3: Apply the one-character fix** to `grammars/tree-sitter-redextape/grammar.js`, with a comment naming `is_ascii_whitespace()` as the authority and pointing at λ's `extras` as the deliberately-wider sibling — the mirror of the comment already sitting over there. **Do not "harmonise" the two.** Regenerate with `.tools/tree-sitter generate` from inside the grammar directory and commit the regenerated `src/**`.
- [x] **Step 4: Re-run.** The full crate must be green, not just the new test.
- [x] **Step 5: Close the open item where it was left open.** `grammars/tree-sitter-redextape-lambda/grammar.js` and its `README.md` both said the divergence is *"a known open item for a later PR, not fixed here."* Both sentences were false once 1a landed. Rewritten to say what was done and where the check lives — the passage was **kept**, because the reason the two `extras` classes differ is exactly what a later reader needs and is the only thing keeping someone from "fixing" them into agreement.

**As landed:** the test fails on the VT row and only the VT row before the fix, and `redextape-grammar-check` goes 28 → 29 tests, all green. Both grammars regenerate clean under `.tools/tree-sitter` 0.25.10 (`tree-sitter test`: mini 8/8, λ 6/6).

### 1b — the `.superpowers/` sweep — **DONE**

Three tracked files cite paths under `.superpowers/`, which carries a `.gitignore` containing `*` — **so nothing under it is tracked, and every one of these citations is dangling in any clone**:

| file | cites | resolves locally? |
|---|---|---|
| `web/src/style.css` | `.superpowers/sdd/task-8-picker-*.png` | **no — the files are gone** |
| `web/tests/browser/pane-layout-controls.test.ts` | `.superpowers/sdd/task-8-picker-*.png` | **no — the files are gone** |
| `web/tests/browser/buffers-quota-restored.test.ts` | `.superpowers/sdd/task-6-report.md` §5 | yes, on this machine only |

- [x] **Step 1: Rewrite the three passages to stand on their own.** Each citation is doing real work — it is the evidence for a claim the comment makes ("this was measured rather than reasoned about", "the hazard's own write-up is explicit that…"). **Do not just delete the path**; that turns a supported claim into an unsupported one. Move the substance into the comment: what the before/after pair showed, what the write-up said. Then say the artifact was an untracked working note and is not in the repository, so nobody goes looking.
- [x] **Step 2: Prove the sweep is complete.** `git grep -n '\.superpowers/' -- . ':!docs'` must return nothing. Docs are deliberately excluded — the roadmap and four spec/plan files also cite that directory, and this repository annotates rather than rewrites its own history.

**As landed, and one finding that was not in the survey.** Two of the three citations named screenshot
files that no longer exist. **The third was worse than dangling: it resolved to the wrong document.**
Those per-task reports are numbered per SLICE rather than globally, so a later slice reused the
filename — the cited path now holds a tree-sitter regenerate-leg report about grammar generation, and
the sentence the comment quoted is nowhere in it. **A dangling path fails loudly; a reused one resolves
to a real, plausible-looking document about something else.** Both replacements are stronger than what
they replaced: the two screenshot claims now point at `pane-layout-controls.test.ts`, which re-measures
the geometry with `getBoundingClientRect` against the shipped stylesheet on every run, and the quoted
sentence is now sourced to `main.ts`'s own `writeBuffersStorage` call. The offending path is
deliberately **not spelled out** in the replacement prose, so that Step 2's grep stays a real check.
Verified: `biome ci` and `tsc --noEmit` clean, and the two edited browser test files run 21 passed.

**Why this touches `web/` when PR 2's plan forbade it:** PR 2's constraint was PR 2's, and this item is on PR 3's list because PR 2 put it there. The relaxation is exactly three files, **comment text only** — no CSS rule, no test body, no behaviour. Note that `web/tests/browser/*.ts` edits still put the browser tier on the critical path for CI; a comment-only change is safe but the tier will run. `web/src/highlight.ts`'s doc comment about Lezer is **not** in scope: design §2 records it was already corrected twice and now argues from what is checkable.

- [x] **Step 3: Commit.** One commit for 1a, one for 1b, if the pre-commit hook allows both to stand alone.

**A larger sweep that is NOT in this task.** PR 2's entry also flagged the `"the brief"` references in merged code. There are **17 of them across 10 files**, they are references to a concept rather than to a path, and they are a different piece of work. Left open, and named here so it is not mistaken for something this task covered.

---

## Task 2: The TM grammar — **DONE**

**Files:**
- Create: `grammars/tree-sitter-redextape-tm/grammar.js`, `tree-sitter.json`, `test/corpus/*.txt`
- Create (generated, committed): `grammars/tree-sitter-redextape-tm/src/**`
- Modify: `crates/redextape-grammar-check/build.rs`

**Interfaces:**
- Consumes: nothing from this crate — a grammar is standalone until Task 3 queries it.
- Produces: the `tree_sitter_redextape_tm` symbol, and node/field names Task 3's queries reference.

**Read "The TM text form" above before writing a line of it.** In particular facts 1 and 3 — the permissive state name, and the packed cell run being one lexeme where a rule's symbols are one lexeme each.

**Suggested shape.** This is a sketch, not a specification; the CLI will have opinions:

```js
module.exports = grammar({
  name: 'redextape_tm',
  extras: $ => [/[ \t\r\n]/, $.comment],
  word: $ => $.state_name,
  rules: {
    source_file: $ => repeat($._line),
    _line: $ => choice($.tapes, $.start, $.directive, $.tape, $.state, $.rule),
    tapes: $ => seq('tapes', $.number),
    start: $ => seq('start', field('target', $.state_name)),
    directive: $ => choice(
      seq('version', $.number), seq('width', $.number), seq('slots', $.number),
      seq('encoding', $.encoding_name), seq('result', $.type_name),
    ),
    tape: $ => seq('tape', $.number, optional($.tape_cells)),
    state: $ => seq('state', field('name', $.label), ':', optional('accept')),
    rule: $ => seq(
      '[', repeat($.symbol), ']', '->',
      'write', '[', repeat($.symbol), ']', ',',
      'move', '[', repeat($.move), ']', ',',
      'goto', field('target', $.state_name),
    ),
    comment: _ => token(seq(';', /[^\n]*/)),
    // ... state_name / label / symbol / tape_cells / move / number tokens
  },
});
```

**Five decisions the sketch is deliberately vague about, each with the constraint that settles it:**

1. **`extras` and newlines.** The authority is strictly line-oriented; the sketch is not. Putting `\n` in `extras` means the grammar accepts `tapes 5 start pc0` on one line, which `parse_tm_full` rejects. That is an **accept-more** divergence, which is the right direction for an editor (PR 2's `source_file: optional($._term)` is the precedent, and PR 1's entry records a rule that *rejected* valid input as the defect to avoid). **If you take it, state it in `grammar.js` and carry it into Task 6's entry.** The alternative — newline as a real token — is more faithful and materially more grammar; do not take it without a reason beyond faithfulness.
2. **`$.comment` must not cross a newline.** `token(seq(';', /[^\n]*/))`. A `/;.*/` that eats the following line will silently delete constructs from the tree and the differential will report it as a span-count mismatch a hundred lines later.
3. **`state_name` vs `label` vs `symbol` vs `tape_cells` will conflict lexically**, because their character sets overlap almost completely — `#`, `1`, `_` are all legal in a name and are all tape symbols. Expect to separate them with `token()`, explicit precedence, and the fact that each is valid in only one context. **Resolve conflicts by narrowing the token, never by widening a rule to swallow the other's text.**
4. **`word: $ => $.state_name`** is what gives tree-sitter proper keyword extraction, so that `state`, `goto`, `write`, `move`, `accept`, `tapes`, `start` and the six directives are not matched by the name token. Confirm the CLI accepts the permissive pattern as a word token; if it will not, keyword extraction has to be done by precedence instead and that must be tested rather than assumed.
5. **The file extension is `tm`.** `scope: "source.tm"`, `file-types: ["tm"]`, `injection-regex: "^tm$"`, mirroring the two existing `tree-sitter.json` files. `.tm` is what this project's own README and `examples/tm_emit.rs` call these files. It collides with TeXmacs in the wider world; that is a README line, not a reason to invent a new extension.

- [x] **Step 1: Write the `tree-sitter test` corpus first**, in `grammars/tree-sitter-redextape-tm/test/corpus/`. Model the file format on `grammars/tree-sitter-redextape-lambda/test/corpus/terms.txt`. At minimum, one case each for: a minimal header-less machine; a headered one; a state with `accept`; a state with no rules; a multi-tape rule with `*` wildcards in both read and write; a `tape` line with a packed run and a trailing comment; a `tape` line with no comment; a whole-line comment; a state name with dots and digits (`wl1s2.s.sk0`).
- [x] **Step 2: Write `grammar.js` and `tree-sitter.json`.**
- [x] **Step 3: Generate and test.**

```bash
cd grammars/tree-sitter-redextape-tm && ../../.tools/tree-sitter generate && ../../.tools/tree-sitter test
grep -m1 LANGUAGE_VERSION src/parser.c    # must be 15; 14 means tree-sitter.json was not picked up
```

- [x] **Step 4: Parse the two checked-in fixtures.** `crates/redextape-core/tests/fixtures/list_1_2.tm` (464 lines) and `list_1_2_binary.tm` (658 lines) are real, complete, headered `.tm` files produced by `examples/regen_fixtures.rs`. **They are the cheapest end-to-end check this task has and they exist already.**

```bash
../../.tools/tree-sitter parse --config-path <cfg> ../../crates/redextape-core/tests/fixtures/list_1_2_binary.tm | grep -c ERROR   # must be 0
```

`tree-sitter parse` resolves a grammar through the CLI's config, **not** through the working directory. With no config it prints *"You have not configured any parser directories"* and parses nothing — **and still exits in a way that a naive `grep -c ERROR` reads as success.** Point `--config-path` at a config whose `parser-directories` contains a directory holding this grammar, and confirm the output is a real parse tree before believing any count taken from it.

- [x] **Step 5: Add the third `compile_grammar("tree-sitter-redextape-tm")` line to `build.rs`.** Read that file's module doc first: one `cc::Build` per grammar, each with its own library name, or two grammars silently compile into one archive and the missing symbol surfaces as a link error downstream.
- [x] **Step 6: Record `wc -c src/parser.c`** for Task 6. The siblings are 103,342 (mini) and 11,483 (λ) bytes.

---

## Task 3: TM queries and its capture map — **DONE**

**Files:**
- Create: `grammars/tree-sitter-redextape-tm/queries/highlights.scm`
- Create: `crates/redextape-grammar-check/src/tm.rs`, `crates/redextape-grammar-check/tests/tm.rs`
- Modify: `crates/redextape-grammar-check/src/lib.rs`

**Interfaces:**
- Consumes: `Grammar` and its six promoted checks; node names from Task 2.
- Produces: `pub static TM: Grammar`, with `HIGHLIGHTS` and `CAPTURE_CLASSES` in `tm.rs`.

**The map, from design §5.1 and the printer table above:**

| capture | `TokenClass` | what it covers |
|---|---|---|
| `@keyword` | `Keyword` | `tapes`, `start`, `state`, `accept`, `write`, `move`, `goto`, and the six header directives |
| `@number` | `Nat` | the tape count, `version`/`width`/`slots`, a `tape` index |
| `@label` | `Label` | the name in `state <name>:` — DEFINING position |
| `@label.reference` | `StateName` | a `start` or `goto` target |
| `@character` | `TapeSymbol` | a symbol inside `[..]`, and the packed run on a `tape` line |
| `@constant.builtin` | `Move` | `L`, `R`, `S` |
| `@punctuation.bracket` | `Punct` | `[` `]` |
| `@punctuation.delimiter` | `Punct` | `:` `,` `->` |
| `@comment` | `Comment` | a `;` comment, whole-line or trailing |
| `@variable` | `Ident` | the `encoding` operand |
| `@type` | `Ident` | the `result` operand |

**`@label`/`@label.reference` is design §5.2's whole worked example** — the standard vocabulary has no clean pair for defining-vs-reference, and the dotted name works because nvim-treesitter and Helix both fall back to a capture's prefix when the theme has no rule for the full name. **This is the grammar that pays for that decision**, and the map is what makes the two visible to the differential as distinct.

**`@variable` and `@type` both project to `Ident`, and that is not a mistake.** `write_header`'s own comment says why: *"`encoding` and `result` name an encoding and a type; neither has a class of its own, and `Ident` is the vocabulary's word for a name whose meaning comes from elsewhere in the file."* Splitting the capture is what gets `result List<Nat>` coloured as a type in an editor; both rows must be in the table or `capture_map_is_total` fails.

**`->` is `@punctuation.delimiter`, not `@operator`.** TM has no `Operator` class. A map row for `@operator` would fail `every_capture_row_is_used`.

- [x] **Step 1: Write the failing tests.** Create `crates/redextape-grammar-check/tests/tm.rs`. **Five of the six checks are already methods on `Grammar`** — `capture_map_is_total`, `capture_map_has_no_duplicate_keys`, `every_capture_row_is_used`, `every_corpus_program_parses_without_error_nodes`, `shipped_queries_never_disagree`, `every_query_pattern_fires` — promoted in PR 2 specifically so this task calls them rather than becoming a third copy. **Read `tests/lambda.rs` and call them; do not reimplement.** `a_conflicting_query_is_rejected` is the one that must stay per-grammar; its doc comment in each `tests/*.rs` says why.

Add one TM-specific test with concrete expectations, the analogue of λ's `captures_pins_text_and_class_for_a_printed_term`. Pin a short hand-written machine covering a header line with a comment, a `state`, and one rule, and assert the **full ordered** `(text, class)` sequence — the same standard `print_tm_mapped_agrees_and_classifies_states_symbols_and_moves` already holds the printer to in `tm/syntax.rs`.

- [x] **Step 2: Run, confirm failure.**
- [x] **Step 3: Write `queries/highlights.scm` and `src/tm.rs`.** Model `tm.rs` on `lambda.rs`; its module doc must say which of the two printers each part of the corpus comes from, because that is the thing a reader of this file will otherwise get wrong.
- [x] **Step 4: Run.** `every_query_pattern_fires` is the one most likely to fail honestly here — TM has more query patterns than either sibling and the produced corpus does not reach all of them. **A pattern the corpus cannot reach is a corpus gap, not a reason to delete the pattern**; PR 2's entry records exactly that mistake being made and caught. Add the corpus entry that reaches it.
- [x] **Step 5: Confirm the ABI pin.** Add `abi_version_is_pinned` to `src/tm.rs`'s test module, mirroring `lambda.rs`.

---

## Task 4: The TM differential, over two printed corpora — **DONE**

**Files:**
- Modify: `crates/redextape-grammar-check/src/tm.rs`, `tests/tm.rs`

**Interfaces:**
- Consumes: `compare_classified` from PR 2; `TM` from Task 3.
- Produces: `pub fn printed_machine(src: &str) -> Option<(String, Vec<(Span, TokenClass)>)>` (header-less, for the generated corpus) and `pub fn printed_machine_with_header(src, EncodingKind) -> Option<(String, Vec<(Span, TokenClass)>)>` (headered, for the fixed set), plus `pub fn compare_printed(text, want) -> Result<(), String>`.

**Two corpora, because the two printers emit different class sets.** This is the choice design §6.3 says the plan must make, and it is made here:

| corpus | printer | pipeline | size | what it is for |
|---|---|---|---|---|
| generated | `print_tm_mapped` | `parse` → `desugar` → `lower_asm` → `lower_tm(&Unary::at(w))` | **32 cases** | volume and depth over the seven header-less classes |
| headered | `print_tm_with_mapped` | `parse` → `result_type` → `desugar` → `run_tm_described` | **a fixed handful** | `Comment` and `Ident`, which the other corpus cannot reach |

**The headered corpus uses `run_tm_described`, and that is the one place simulation is permitted.** It is the production path — `examples/tm_emit.rs` and `examples/regen_fixtures.rs` both call it, and the two checked-in fixtures are its output — so its header is one the rest of the project already agrees is correct, rather than a `TmHeader::new` this crate invents. **It simulates**, which is the TM analogue of the reduction the global constraints forbid, so it is bounded three ways: `TM_DEFAULT_CAPS`, a *fixed* list rather than a generated one, and small programs only. Measured cost on `1 + 2`, `3 - 5`, `cons(1, cons(2, nil))`, `[1, 2, 3]`, `if 2 > 1 { 10 } else { 20 }` under both encodings: **77–694 µs each**. `examples/state_cost_probe.rs` records `run_tm_described` building an 8.6-million-state machine costing 6.0 GB on an unlucky input — **which is why the list is fixed and hand-chosen, and why no generated program may reach this path.**

**What the headered corpus actually reaches, measured:** every entry yields all nine classes. `Unary` yields **one** `Comment` span (`; reg`; `Unary::init_work()` is empty so there is no `tape 1` line) and `Binary` yields **two** (`; reg`, `; work`). Tapes 2–4 (`stack`, `heap`, `box`) start empty and `TmHeader::new` drops empty tapes, so **`; stack`, `; heap` and `; box` never print from this path, and neither does an unnamed tape index.** Include at least one `Binary` entry, or the corpus carries a single comment span in total.

- [x] **Step 1: Write the failing tests.**

```rust
/// The generated leg. CASES IS SET EXPLICITLY AND THE NUMBER IS A MEASUREMENT, not a default:
/// one printed TM machine averages 18,905 bytes and 6,865 spans against λ's 912 and 637, so
/// proptest's default 256 would parse ~4.8 MB and compare ~2.0M spans per run. 32 puts this leg at
/// roughly the span volume λ's 256-case leg already carries. See the plan's sizing table.
proptest! {
    #![proptest_config(ProptestConfig { cases: 32, ..ProptestConfig::default() })]
    #[test]
    fn the_tm_grammar_agrees_with_the_printer_on_generated_programs(
        src in arb_expr_over((0u64..100).prop_map(|n| n.to_string()))
    ) {
        let Some((text, want)) = printed_machine(&src) else { return Ok(()) };
        if let Err(why) = compare_printed(&text, &want) {
            return Err(TestCaseError::fail(why));
        }
    }
}

/// The headered leg — the only corpus in this crate carrying `Comment` and `Ident`.
#[test]
fn the_tm_grammar_agrees_with_the_headered_printer() {
    let mut comments = 0;
    for (src, kind) in HEADERED_CORPUS {
        let (text, want) = printed_machine_with_header(src, *kind).expect("this program runs");
        comments += want.iter().filter(|(_, c)| *c == TokenClass::Comment).count();
        if let Err(why) = compare_printed(&text, &want) {
            panic!("`{src}` under {kind:?} diverged:\n{why}");
        }
    }
    assert!(comments >= 3, "only {comments} Comment spans; the headered corpus is not reaching them");
}

/// The comparison must be capable of failing — the standard PR 1 and PR 2 both met.
#[test]
fn the_tm_comparison_can_fail() { /* a strict-subset query; assert the error says "more span(s)" */ }
```

- [x] **Step 2: Run, confirm failure to compile, then implement.**
- [x] **Step 3: Log the lowering pass rate** for the generated leg, as design §7 requires. **Expect 100%** — measured over 128 samples at both leaf ranges in use, nothing refused. Keep the log anyway; it is what makes a future collapse visible instead of vacuous. Do **not** treat a green pass rate as evidence the corpus was sized.
- [x] **Step 4: Measure and record the wall clock.**

```bash
cargo nextest run -p redextape-grammar-check      # 28 tests / 0.600s at 80ec6d4 — the baseline
```

Record the new count and the new time. **If the crate is now measured in seconds rather than tenths, the case count was wrong** — halve it and measure again rather than accepting it. If it is barely moved, raising `cases` is defensible; raise it with the number in hand and say so in the code comment.

- [x] **Step 5: Check the differential is not silently short.** TM's printer emits a span for every token it writes, so the grammar's captures must be total over its own tokens. Assert on at least one entry that the capture count equals the authority's span count exactly — `compare_classified` already does this, but a test that names the property makes a future query edit fail for a legible reason.

---

## Task 5: §6.3's residue — the comments no authority can classify — **DONE**

**Files:**
- Modify: `grammars/tree-sitter-redextape-tm/test/corpus/*.txt`, `crates/redextape-grammar-check/tests/tm.rs`
- Modify: `scripts/check-all.sh`

**What is left after Task 4, and it is much less than the design originally claimed.** Design §6.3 said `print_tm_mapped` emits no `Comment` at all and built a stated gap on it. **That was false** and was corrected at `80ec6d4`: `write_header` emits `Comment`, so Task 4's headered corpus puts real, printer-authored, printer-classified comments inside the differential. What no printer can produce, and therefore what still has no differential authority:

- **a whole-line `;` comment** — no printer emits one;
- **a trailing `;` comment after any line that is not a named `tape` line** — `parse_tm_full` accepts one after every line kind; `write_header` writes one only after `tape <i>` for `i` in `{reg, work, stack, heap, box}`;
- **`; stack`, `; heap`, `; box`** specifically — those tapes start empty and `TmHeader::new` drops empty tapes.

Same treatment as design §6.2's `\` alias: hand-written corpus, `tree-sitter test` for tree shape, plus a test asserting `parse_tm` accepts each entry. **That is weaker than the differential — it checks that the text parses, not that any capture agrees with a classification — and saying so is the point.**

- [x] **Step 1: Add the `tree-sitter test` cases** for each shape above.
- [x] **Step 2: Add the `parse_tm` test**, the analogue of PR 2's `parse_lambda`-on-each-backslash-entry test. That test did not exist until PR 2's whole-branch review found the design and the README both claiming it did — **do not repeat that**: write it, run it, and confirm it can fail.
- [x] **Step 3: Fix `scripts/check-all.sh`'s stale comment.** It says *"Two grammars exist today (`tree-sitter-redextape`, `tree-sitter-redextape-lambda`)"*. `check_grammars` globs `grammars/*/` so no logic changes — but a comment that miscounts the thing it is documenting is exactly the class of defect this slice keeps finding.
- [x] **Step 4: Run the grammar leg.** There is no per-leg flag — the script takes only `--no-llvm`, `--no-browser`, `--llvm-only`, `--browser-only` and `--list`. Run `scripts/check-all.sh --no-llvm --no-browser` and read its `==> regenerating grammars/...` lines: all three must regenerate and leave `git diff -- grammars/` clean.

---

## Task 6: README and the roadmap entry

**Files:**
- Create: `grammars/tree-sitter-redextape-tm/README.md`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [x] **Step 1: Write the README**, modelled on the two siblings. It must carry the same things they do: the CLI pin and why it sits below the newest release; that the repository is **not anonymously clonable today**, so the install snippets do not work for anyone (re-probe rather than copy — PR 2 re-probed and found `forge.daveynet.xyz` answering `401` and `git.daveynet.xyz` answering the ref advertisement with HTTP 200 and a zero-byte body, which `git ls-remote` reports as **exit 0 and no output**); and that the grammar is not authoritative. Add one TM-specific line: `.tm` collides with TeXmacs, so an editor that already maps that extension needs the user to say which wins.

- [ ] **Step 2: Write the roadmap entry.** Read the last two `####` entries and match their shape: a title naming the finding that outranks the feature, Design and Plan links, what closed, **WHAT THIS DID NOT CLOSE**, and a **VERIFICATION** block whose every figure carries the command that produces it.

Cover at minimum:

- **The design was wrong about its own gap, and the wrongness was load-bearing.** §6.3 claimed the TM printer emits no `Comment`, which made the gap look total when the headered printer had been emitting comments all along. The class count was under by two. §1.6, §5.1, §6.3, §10 and a new §11.5 carry the corrections, made **before** the plan was written so they went in as facts rather than as review findings.
- **A defect the differential is structurally unable to see** (Task 1a, landed with the design amendment rather than in the grammar PR). The mini grammar accepted U+000B where `is_ascii_whitespace()` does not, and `classify_source` returns the identical spans either way, so `compare_classified` passed. The check had to be built against `parser::parse` instead. **This is the third variation on PR 2's finding** — a grammar can be wrong exactly where nothing downstream is able to look — and the first where the blind spot is in the *authority* rather than in the corpus.
- **A measurement that could not see what it was measuring.** `tree-sitter parse` with no configured parser directory prints a warning, parses nothing, and produces output a `grep -c ERROR` reads as a clean parse. Caught during this plan's own research, before it reached a task.
- **The risk the design named was not the risk that bit.** §7 warned that TM lowering can refuse and told the corpus to log its pass rate. Measured: 100%, zero refusals over 128 samples at both leaf ranges. What actually needed handling was **size** — 21× λ's bytes and 11× its spans per entry — and that became §11.5 and an explicit `cases: 32`.
- **Which comments made it into the differential and which did not**, with the measured counts: nine classes headered against seven header-less, one `Comment` span per `Unary` entry and two per `Binary`, and `; stack`/`; heap`/`; box` unreachable because those tapes start empty.

- [ ] **Step 3: MEASURE THE FIGURES AT PR TIME, NOT AT TASK TIME.**

**Both previous entries in this slice needed an appended correction for the identical structural reason, and PR 2's entry says so in as many words:** the closing entry is written in the last *task*, the whole-branch review then runs and reliably lands more commits, and the entry's figures are stale by construction the moment they are written. PR 1 had four figures move; PR 2 had three.

So: write the entry's **prose** here if that is convenient, but **take every number after the final review's fixes have landed, from the commit CI actually passed on.** Leave the VERIFICATION block empty until then. An entry whose figures were true at a commit nobody merged is describing a tree that never shipped.

Figures to take, each with its command:

```bash
git rev-list --count 80ec6d4..<final>                          # commits
cargo nextest run --workspace                                  # 1109 passed, 8 skipped, 38.5s at 80ec6d4
cargo nextest run -p redextape-grammar-check                   # 28 passed / 0.600s at 80ec6d4
scripts/check-all.sh --no-llvm --no-browser                    # and quote its own "PARTIAL" line
wc -c grammars/tree-sitter-redextape-tm/src/parser.c           # siblings: 103,342 and 11,483
grep -m1 LANGUAGE_VERSION grammars/tree-sitter-redextape-tm/src/parser.c
cd grammars/tree-sitter-redextape-tm && ../../.tools/tree-sitter test    # "Total parses: N"
wc -l < grammars/tree-sitter-redextape-tm/grammar.js           # siblings: 156 and 78
grep -v '^;' grammars/tree-sitter-redextape-tm/queries/highlights.scm | grep -c '@'   # patterns
grep -v '^;' …/highlights.scm | grep -oE '@[a-z.]+' | sort -u | wc -l                 # capture names
awk '/^pub const CAPTURE_CLASSES/,/^\];/' crates/redextape-grammar-check/src/tm.rs | grep -c '^    ("'
```

**The `-v '^;'` is not cosmetic.** PR 1's entry recorded that without it the pattern count reads 14 instead of 12, because two prose comments in the query file name captures — and 14 is what that entry said before the command was run against it.

- [ ] **Step 4: Commit and open the PR.** Do not merge — Davey reviews and merges his own PRs, and holds branches to fix findings rather than landing and following up.

---

## Self-Review

**Spec coverage.** Design §3's layout → Tasks 2 and 6. §4's per-language authority table → Task 4, which needs *two* rows for TM where the table has one; that is the §6.3 correction arriving in the implementation. §5.1's per-grammar map → Task 3, including the two `Ident` rows the amended table added. §5.2's `@label`/`@label.reference` pair → Task 3, and TM is the grammar that pays for that design decision. §6.1 is unchanged and still priced rather than deferred. §6.3 → split across Task 4 (the part that is now inside the differential) and Task 5 (the part that never can be). §7's produced corpus → Task 4; §7's pass-rate log → Task 4 Step 3, with the measured 100% saying what it is worth. §8's pin → Global Constraints and Task 2 Step 3. §10's PR 3 scope → this whole plan. §11.5's sizing → the sizing section and Task 4's `cases: 32`. §12 stays out entirely.

**Two things deliberately different from PR 2.** There is no harness task — PR 2's `Grammar` generalisation and its six promoted checks are exactly what a third grammar was meant to inherit, and Task 3 inherits them by calling them. And Task 1 is repair work that has nothing to do with TM, placed first because a large PR's last task is where carried-forward items go to die.

**Type consistency.** `TM: Grammar` is defined in Task 3 and used in Tasks 3, 4 and 5. `printed_machine` (header-less) and `printed_machine_with_header` (headered) are both defined in Task 4; they return the same `(String, Vec<(Span, TokenClass)>)` shape so one `compare_printed` serves both. `HEADERED_CORPUS` is a fixed `&[(&str, EncodingKind)]` in `src/tm.rs`, read only by Task 4. Node and field names produced by Task 2 are exactly those Task 3's queries reference; Task 2 Step 1 writes the corpus before the grammar so the names are chosen once.

**What this plan does not decide, and hands to the implementer with the constraint attached.** Whether `\n` is an `extra` or a token (Task 2, decision 1 — with the accept-more precedent and the requirement to state it). Whether `word: $ => $.state_name` survives contact with the CLI (Task 2, decision 4 — with the fallback named). And whether `cases: 32` is right (Task 4 Step 4 — with the baseline to measure against and the instruction to halve rather than accept).
