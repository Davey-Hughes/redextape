# The LSP track's loose ends — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three of the five ends PR #82 (`6e0ad6e`) filed inside its own shipped code: one `fn`-run boundary scan instead of five, an over-cap `.rxt` file that says "not indexed" instead of "no names", and a `documentSymbol` outline that nests and folds.

**Architecture:** Three independent changes against one design ([`../specs/2026-09-08-lsp-loose-ends-design.md`](../specs/2026-09-08-lsp-loose-ends-design.md)). §1 adds `ast::fn_run_at` and reduces five hand-written scans to calls. §2 gives `parse_inner` a three-state `Completeness` so `nav_rxt` can answer `Option<NameIndex>` and inherit the `nav: None` path that already exists. §3 puts an `extent: Option<Span>` on `Role::Definition` and builds the outline into a tree with an explicit stack, which closes filings 4 and 5 with one field.

**Tech Stack:** Rust edition 2024, `redextape-core` (no dependencies) and `redextape-lsp` (`gen-lsp-types`), `cargo nextest`, `cargo clippy` with `pedantic` on.

## Global Constraints

- **Rust edition 2024**, `max_width = 120`, `use_small_heuristics = "Max"` (`rustfmt.toml`).
- `cargo clippy --workspace --all-targets -- -D warnings` runs on **every commit** via pre-commit. A helper with no callers is `dead_code` and fails the gate, which is why the tasks below never split a new item from its first caller.
- Never `git commit --no-verify`.
- **`file:line` citations are banned in tracked source.** They are normal in `docs/`. Refer to code by item name in doc comments.
- `///` for Rust doc comments. No AI attribution anywhere.
- **No panics on user input.** `fn_run_at`'s `assert!` is a caller-bug guard on an internal precondition every call site already tests, not a reaction to source text.
- `redextape-core` has **zero dependencies**; `cargo tree -p redextape-core --edges normal` must stay one line.
- Coverage floor: `cargo llvm-cov nextest --workspace --fail-under-lines 90`.
- Every figure written into a doc or a roadmap entry names the command that produced it, and is run before it is committed.

---

## Task 1: `fn_run_at`, and the four forward callers

**Files:**
- Modify: `crates/redextape-core/src/ast.rs` — add `fn_run_at` after `impl Stmt`, and a test in its `mod tests`
- Modify: `crates/redextape-core/src/typeck.rs` — `infer_block_inner`, the `Stmt::Fn` arm
- Modify: `crates/redextape-core/src/lints.rs` — `Lints::block`, the `Stmt::Fn` arm
- Modify: `crates/redextape-core/src/binder.rs` — `Binder::block`, the `Stmt::Fn` arm
- Modify: `crates/redextape-core/src/desugar.rs` — `free_member_refs`' `Work::B` arm

**Interfaces:**
- Consumes: nothing.
- Produces: `pub(crate) fn fn_run_at(stmts: &[Stmt], i: usize) -> std::ops::Range<usize>` in `crate::ast`. Task 2 is its fifth caller.

**Why the helper and its first four callers are one commit:** a `pub(crate)` item with no call site is `dead_code`, and the pre-commit gate makes that fatal.

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-core/src/ast.rs`'s existing `mod tests`:

```rust
    /// Every index inside one run answers that run, not just its first.
    ///
    /// The four forward callers only ever ask at a run's first statement, so a scan that looked
    /// forward alone would satisfy all of them and still be wrong for `desugar`'s statement
    /// lowering, which walks right-to-left and meets a run's END first. This is the property that
    /// separates the two.
    #[test]
    fn fn_run_at_answers_the_same_range_from_every_index_in_the_run() {
        use crate::ast::{Stmt, fn_run_at};
        use crate::parser::parse_recovering;

        for n in 1..=4usize {
            let mut src = String::from("let before = 0;");
            for k in 0..n {
                src.push_str(&format!(" fn f{k}(a) {{ a }}"));
            }
            src.push_str(" let after = 1; after");
            let (parsed, _diags) = parse_recovering(&src);
            let stmts = &parsed.program.block.stmts;
            // Probed on 6e0ad6e: this parses to [Let, Fn * n, Let] with `after` as the tail, so
            // the run is bracketed by a non-`fn` on both sides rather than by the block's ends.
            let first = stmts.iter().position(|s| matches!(s, Stmt::Fn { .. })).expect("a run");
            assert_eq!(first, 1, "n={n}");
            let expected = first..first + n;
            for i in expected.clone() {
                assert_eq!(fn_run_at(stmts, i), expected, "n={n}, asked at {i}");
            }
        }
    }

    /// A non-`fn` statement ends a run, and a `fn` after it starts a fresh one — the rule
    /// `typeck::infer_fn_run` enforces, asserted on the boundary rather than on a single run.
    #[test]
    fn a_non_fn_statement_separates_two_runs() {
        use crate::ast::fn_run_at;
        use crate::parser::parse_recovering;

        // Probed on 6e0ad6e: [Fn, Let, Fn] with `0` as the tail.
        let (parsed, _diags) = parse_recovering("fn a(n) { n } let x = 0; fn b(n) { n } 0");
        let stmts = &parsed.program.block.stmts;
        assert_eq!(fn_run_at(stmts, 0), 0..1);
        assert_eq!(fn_run_at(stmts, 2), 2..3);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core --lib fn_run_at`

Expected: FAIL to compile, `cannot find function fn_run_at in module crate::ast`.

- [ ] **Step 3: Add the helper**

In `crates/redextape-core/src/ast.rs`, immediately after the `impl Stmt` block that ends with `span()`:

```rust
/// The maximal run of consecutive `Stmt::Fn` containing `i`.
///
/// A run is the unit `typeck::infer_fn_run` pre-binds: every name in it is bound before any body
/// is checked, so a member may forward-reference or mutually recurse with any other member, and
/// any non-`fn` statement ends it. Five passes need that boundary — `typeck`, `lints`, `binder`
/// and `desugar` twice — and until this existed they agreed only by inspection.
///
/// **SCANS BOTH WAYS, AND THE BACKWARD HALF IS NOT DEAD WEIGHT.** `desugar`'s statement lowering
/// walks right-to-left and so meets a run's END first; it asks at the run's last statement. The
/// other four walk left-to-right and ask at the first, where the backward scan stops on its first
/// test. Answering the same range from any index inside a run is what lets one function serve
/// both directions.
///
/// # Panics
///
/// Panics when `stmts[i]` is not a `Stmt::Fn`. That is a caller bug — every call site is already
/// inside a `matches!(.., Stmt::Fn { .. })` arm — and not a reaction to source text, so it does
/// not breach the no-panics-on-user-input rule. The alternative, an empty range, would stall
/// every forward caller's `i = run.end` in an infinite loop.
#[must_use]
pub(crate) fn fn_run_at(stmts: &[Stmt], i: usize) -> std::ops::Range<usize> {
    assert!(matches!(stmts.get(i), Some(Stmt::Fn { .. })), "fn_run_at asked at a statement that is not a `fn`");
    let mut start = i;
    while start > 0 && matches!(stmts.get(start - 1), Some(Stmt::Fn { .. })) {
        start -= 1;
    }
    let mut end = i + 1;
    while matches!(stmts.get(end), Some(Stmt::Fn { .. })) {
        end += 1;
    }
    start..end
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p redextape-core --lib -- fn_run_at a_non_fn_statement_separates_two_runs`

Expected: 2 passed.

- [ ] **Step 5: Run the sabotage that proves the backward scan is load-bearing**

Temporarily replace the backward loop's body with nothing — that is, change

```rust
    let mut start = i;
    while start > 0 && matches!(stmts.get(start - 1), Some(Stmt::Fn { .. })) {
        start -= 1;
    }
```

to

```rust
    let start = i;
```

Run: `cargo test -p redextape-core --lib fn_run_at`

Expected: FAIL — `fn_run_at_answers_the_same_range_from_every_index_in_the_run` fails at `n=2, asked at 2`. **Restore the loop and re-run to green before continuing.** A sabotage that does not fire means the test is not testing what it says.

- [ ] **Step 6: Convert `typeck.rs`**

In `infer_block_inner`, replace:

```rust
                let start = i;
                while i < block.stmts.len() && matches!(&block.stmts[i], Stmt::Fn { .. }) {
                    i += 1;
                }
                self.infer_fn_run(&mut env, &block.stmts[start..i]);
```

with:

```rust
                let run = fn_run_at(&block.stmts, i);
                i = run.end;
                self.infer_fn_run(&mut env, &block.stmts[run]);
```

Keep the existing comment above it — the rule it states is still the rule — and add `fn_run_at` to the `use crate::ast::{..}` line at the top of the file.

- [ ] **Step 7: Convert `lints.rs`**

In `Lints::block`, replace:

```rust
                let start = i;
                while i < b.stmts.len() && matches!(b.stmts[i], Stmt::Fn { .. }) {
                    i += 1;
                }
                self.fn_run(&b.stmts[start..i]);
```

with:

```rust
                let run = fn_run_at(&b.stmts, i);
                i = run.end;
                self.fn_run(&b.stmts[run]);
```

Add `fn_run_at` to this file's `use crate::ast::{..}` line.

- [ ] **Step 8: Convert `binder.rs`**

In `Binder::block`'s `Stmt::Fn` arm, replace:

```rust
                    let start = i;
                    while matches!(b.stmts.get(i), Some(Stmt::Fn { .. })) {
                        i += 1;
                    }
                    let run = b.stmts.get(start..i).unwrap_or(&[]);
```

with:

```rust
                    let range = fn_run_at(&b.stmts, i);
                    i = range.end;
                    let run = &b.stmts[range];
```

Add `fn_run_at` to `use crate::ast::{Block, Expr, Param, Program, Stmt};`.

- [ ] **Step 9: Convert `desugar.rs`'s forward site**

In `free_member_refs`' `Work::B` arm, replace:

```rust
                            let start = i;
                            while matches!(block.stmts.get(i), Some(Stmt::Fn { .. })) {
                                i += 1;
                            }
                            let nested = block.stmts.get(start..i).unwrap_or(&[]);
```

with:

```rust
                            let range = fn_run_at(&block.stmts, i);
                            i = range.end;
                            let nested = &block.stmts[range];
```

Add `fn_run_at` to this file's `use crate::ast::{..}` line.

- [ ] **Step 10: Run the full core suite**

Run: `cargo test -p redextape-core`

Expected: 0 failures. The four conversions are behaviour-preserving, so the existing suites are the assertion — `a_fn_run_pre_binds_every_sibling_before_any_body_is_walked` in `lints.rs` and `a_fn_run_binds_every_member_before_any_body_is_walked` in `binder.rs` are the two that bite hardest on a wrong run boundary.

- [ ] **Step 11: Run the sabotage that proves the four conversions are covered**

Temporarily change `fn_run_at`'s last line from `start..end` to `i..i + 1`.

Run: `cargo test -p redextape-core`

Expected: FAIL in both `lints` and `binder`, on mutual recursion no longer resolving. **Restore `start..end` and re-run to green.**

- [ ] **Step 12: Commit**

```bash
git add crates/redextape-core/src/ast.rs crates/redextape-core/src/typeck.rs \
        crates/redextape-core/src/lints.rs crates/redextape-core/src/binder.rs \
        crates/redextape-core/src/desugar.rs
git commit -m "core: one fn-run boundary scan, and four of the five callers

The maximal run of consecutive Stmt::Fn is the unit typeck::infer_fn_run
pre-binds, and five passes computed its boundary by hand. fn_run_at scans both
ways so it answers the same range from any index in a run, which is what lets
one function serve desugar's right-to-left walk as well as the four that go
left to right. Four of them convert here; the backward one follows.

Both sabotages fired: dropping the backward scan reddens the property test at
n=2, and answering i..i+1 reddens mutual recursion in lints and binder."
```

---

## Task 2: `desugar`'s backward caller, the fifth

**Files:**
- Modify: `crates/redextape-core/src/desugar.rs` — `lower_block_at`, the `Stmt::Fn` branch of the right-to-left statement walk

**Interfaces:**
- Consumes: `ast::fn_run_at` from Task 1.
- Produces: nothing new.

**Why this is its own task:** it is the only site whose index is not already at the boundary the caller does not scan, so it is the one a reviewer could reject while approving Task 1. The equivalence was measured on `6e0ad6e` and §1.3 of the spec records how; Step 2 below re-runs that measurement on the branch.

- [ ] **Step 1: Re-run the measurement that justifies the conversion**

Before changing anything, patch the existing backward branch in `lower_block_at` with a probe, immediately above `let mut start = i - 1;`:

```rust
            assert!(
                !matches!(stmts.get(i), Some(Stmt::Fn { .. })),
                "PROBE: i is not the run's exclusive end"
            );
            {
                let mut fwd = i - 1;
                while matches!(stmts.get(fwd), Some(Stmt::Fn { .. })) {
                    fwd += 1;
                }
                assert_eq!(fwd, i, "PROBE: a forward scan from i-1 disagrees with i");
            }
```

Run: `cargo test --workspace`

Expected: 0 failures.

- [ ] **Step 2: Prove the probe is reached**

Change the first assertion's condition to `false`.

Run: `cargo test -p redextape-core --lib 2>&1 | grep -c "PROBE: i is not the run's exclusive end"`

Expected: a count in the hundreds — it was **100** on `6e0ad6e`. A green probe on an unreached branch is not evidence. **Remove the whole probe block before continuing.**

- [ ] **Step 3: Convert the site**

Replace:

```rust
            let mut start = i - 1;
            while start > 0 && matches!(stmts.get(start - 1), Some(Stmt::Fn { .. })) {
                start -= 1;
            }
            acc = lower_fn_run_at(g, stmts.get(start..i).unwrap_or(&[]), acc, spans);
            i = start;
            continue;
```

with:

```rust
            // Walking right-to-left we meet a run's END first, so this asks at its last statement
            // and `fn_run_at`'s backward scan finds the rest. The four left-to-right callers ask
            // at a run's first statement instead; the range is the same either way, which is the
            // whole reason one function serves both.
            let run = fn_run_at(stmts, i - 1);
            i = run.start;
            acc = lower_fn_run_at(g, &stmts[run], acc, spans);
            continue;
```

Keep the existing comment above the branch that explains why `fn`s are lowered a run at a time.

- [ ] **Step 4: Run the full workspace suite**

Run: `cargo test --workspace`

Expected: 0 failures. `desugar`'s ordering of a mutually-recursive run is asserted by the three-way oracle, so a wrong boundary here fails far more than a unit test.

- [ ] **Step 5: Run the sabotage**

Temporarily change the conversion to `let run = fn_run_at(stmts, i - 1); i = run.start; acc = lower_fn_run_at(g, &stmts[run.start..run.start + 1], acc, spans);`

Run: `cargo test -p redextape-core`

Expected: FAIL — a run of two or more `fn`s loses every member but the first. **Restore and re-run to green.**

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/desugar.rs
git commit -m "core: the fifth fn-run scan, the one that walks backward

lower_block_at walks statements right-to-left, so it meets a run's end first
and asks fn_run_at at the run's last statement rather than its first. Measured
before converting, on this branch: a probe asserting that stmts[i] is never a
Stmt::Fn there and that a forward scan from i-1 ends at i was green across the
workspace, and inverting it fired 100 times in redextape-core --lib, so the
green was evidence and not an unreached branch."
```

---

## Task 3: `Completeness`, and `nav_rxt` answers `Option<NameIndex>`

**Files:**
- Modify: `crates/redextape-core/src/parser.rs` — `parse_inner`, `parse_full`, `parse_recovering`; add `Completeness` and `parse_for_nav`
- Modify: `crates/redextape-core/src/binder.rs` — `nav_rxt`, and every `nav_rxt(..)` in its `mod tests`
- Modify: `crates/redextape-lsp/src/language.rs` — `Language::nav`'s `Redextape` arm

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `pub fn nav_rxt(src: &str) -> Option<NameIndex>`; `pub(crate) fn parse_for_nav(src: &str) -> (Option<Parsed<'_>>, Vec<Diagnostic>)`.

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-core/src/binder.rs`'s `mod tests`:

```rust
    /// `let a0 = 0; let a1 = a0; … let a<n-1> = a0;` — five tokens per statement plus `Eof`.
    fn let_chain(n: usize) -> String {
        let mut s = String::from("let a0 = 0;");
        for i in 1..n {
            s.push_str(&format!(" let a{i} = a0;"));
        }
        s
    }

    /// An over-cap file is NOT indexed, which is a different claim from containing no names.
    ///
    /// **THE TOKEN COUNTS ARE ASSERTED, NOT ASSUMED.** The fixture is generated, so a lexer change
    /// that moves the boundary would otherwise leave this quietly comparing two under-cap
    /// programs and passing for the wrong reason. Measured on 6e0ad6e: 19,999 statements is
    /// 99,996 tokens and 20,000 is 100,001, against a cap of 100,000.
    #[test]
    fn a_program_over_the_token_cap_is_not_indexed_and_one_under_it_is() {
        let under = let_chain(19_999);
        let over = let_chain(20_000);
        assert_eq!(crate::parser::MAX_TOKENS, 100_000);
        assert_eq!(crate::lexer::lex(&under).0.len(), 99_996);
        assert_eq!(crate::lexer::lex(&over).0.len(), 100_001);

        let indexed = nav_rxt(&under).expect("99,996 tokens is within the cap");
        assert_eq!(indexed.definitions().count(), 19_999);
        assert_eq!(nav_rxt(&over), None);
    }

    /// Recovery is not refusal, and this is the assertion that separates the two states.
    ///
    /// A sabotage mapping `Completeness::Recovered` to `None` leaves the cap test above green and
    /// reddens only this one, which is what makes the three-state enum earn its third state.
    #[test]
    fn a_file_that_did_not_parse_completely_is_still_indexed() {
        let n = nav_rxt("fn f(a) { a").expect("a recovered file is indexed");
        // Probed on 6e0ad6e: `f` and its parameter `a`.
        assert_eq!(n.definitions().count(), 2);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core --lib -- token_cap a_file_that_did_not_parse`

Expected: FAIL to compile — `expect` on a `NameIndex`, which is not an `Option`.

- [ ] **Step 3: Add `Completeness` and `parse_for_nav`**

In `crates/redextape-core/src/parser.rs`, add above `parse_inner`:

```rust
/// How much of `src` `parse_inner` actually read.
///
/// **THE THIRD STATE IS THE POINT.** `Refused` and `Recovered` both produce a tree that is not the
/// whole document, and a `bool` collapsed them — so a consumer could not tell a file the parser
/// read and recovered from a file the parser never started on. Navigation is the consumer that
/// needs the difference: a recovered tree is exactly what it exists to serve, and an empty one
/// from `Refused` would be read as a document containing no names.
enum Completeness {
    /// Clean lex, within `MAX_TOKENS`, nothing recovered.
    Complete,
    /// The parser ran and recovered. The tree is partial, and every name in it is real.
    Recovered,
    /// The token cap refused the input before the parser ran. The tree is EMPTY, and that
    /// emptiness is a fact about the cap rather than about the document.
    Refused,
}
```

Change `parse_inner`'s signature to `fn parse_inner(src: &str) -> (Parsed<'_>, Vec<Diagnostic>, Completeness)`, and its doc comment's first line to:

```rust
/// The one parse. `Completeness` says how much of `src` was read — see that enum.
```

In the `tokens.len() > MAX_TOKENS` early return, change the trailing `false` to `Completeness::Refused`. At the end of the function, replace:

```rust
    let complete = clean_lex && p.recovered == 0;
```

with:

```rust
    let completeness =
        if clean_lex && p.recovered == 0 { Completeness::Complete } else { Completeness::Recovered };
```

and the returned tuple's third element with `completeness`.

Change `parse_full`'s body to:

```rust
    let (parsed, diags, completeness) = parse_inner(src);
    if matches!(completeness, Completeness::Complete) { (Some(parsed), diags) } else { (None, diags) }
```

Change `parse_recovering`'s binding to `let (parsed, diags, _completeness) = parse_inner(src);` and append this paragraph to its doc comment:

```rust
/// **IT ANSWERS A TREE EVEN WHEN THE PARSER NEVER RAN.** Above `MAX_TOKENS` the tree is an empty
/// `Program`, which a consumer counting statements reads as a document with none. `parse_for_nav`
/// is the entry point that distinguishes the two; anything that would draw a conclusion from an
/// empty tree wants that one.
```

Add after `parse_full`:

```rust
/// Parse `src` for navigation. `Some` whenever the parser ran, recovery included.
///
/// `None` only for `Completeness::Refused` — the `MAX_TOKENS` refusal, where nothing was parsed.
/// That is the one case where an empty index would be a claim about the document rather than
/// about the cap, and `NameIndex`'s own doc reads an empty index as "this document contains no
/// names".
pub(crate) fn parse_for_nav(src: &str) -> (Option<Parsed<'_>>, Vec<Diagnostic>) {
    let (parsed, diags, completeness) = parse_inner(src);
    match completeness {
        Completeness::Refused => (None, diags),
        Completeness::Complete | Completeness::Recovered => (Some(parsed), diags),
    }
}
```

- [ ] **Step 4: Change `nav_rxt`**

In `crates/redextape-core/src/binder.rs`, replace `nav_rxt`'s body and doc:

```rust
/// Every name written in one `.rxt` document, each reference pointed at the binding it resolves
/// to. `None` when the document was never parsed.
///
/// Built from `parse_for_nav`, never `parse` or `parse_full`: those answer `None` for exactly the
/// broken files navigation is worth most on. `parse_for_nav` rather than `parse_recovering`
/// because the two disagree in one case — above `MAX_TOKENS`, where `parse_recovering` answers an
/// empty tree and this must not answer an empty index, since an empty index is the claim that the
/// document contains no names.
#[must_use]
pub fn nav_rxt(src: &str) -> Option<NameIndex> {
    let (parsed, _diags) = crate::parser::parse_for_nav(src);
    let parsed = parsed?;
    let mut b = Binder::default();
    b.walk(&parsed.program);
    Some(b.finish())
}
```

- [ ] **Step 5: Update `nav_rxt`'s existing test call sites**

Every `let n = nav_rxt(..)` in `binder.rs`'s `mod tests` gains `.expect("within the token cap")`. There are call sites in the tests at the fixtures `"let x = 1; let x = x + 1; x"`, `"let x = 1; fn f(x) { x } x"`, `"let g = { let y = 1; y }; y"`, `"let mut x = 1; x = 2; x"`, `"fn m(v) { v } 1.m()"`, `"let c = true; if c { let z = 1; z } else { let a = 2; a }"`, `"let x = ; x"`, `"fn f(a) { a"`, `"fn a(n) { b(n) } fn b(n) { a(n) } 0"`, `"let x = 1; let f = |x| [x, x]; while f(0) { x }"`, `"} let z = 1; z"`, plus the whole-file and stack-safety tests.

Run `cargo build -p redextape-core --all-targets` and let the compiler enumerate them rather than working from this list.

- [ ] **Step 6: Update `Language::nav`**

In `crates/redextape-lsp/src/language.rs`, change the `Redextape` arm:

```rust
            Language::Redextape => redextape_core::binder::nav_rxt(src),
```

and extend that method's doc comment, after the existing `**\`None\` IS NOT AN EMPTY INDEX.**` paragraph:

```rust
    /// `.rxt` answers `None` for a second reason: a document above `MAX_TOKENS` is refused by the
    /// parser before it runs, so there is no tree to index. `.tm` and `.asm` are line-oriented and
    /// have no such cap, which makes this asymmetry `.rxt`'s alone.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cargo test -p redextape-core --lib` then `cargo test -p redextape-lsp`

Expected: 0 failures in both, including the two new tests.

- [ ] **Step 8: Run both sabotages**

1. In `parse_for_nav`, change the match to answer `Some(parsed)` for every arm.
   Run: `cargo test -p redextape-core --lib a_program_over_the_token_cap`
   Expected: FAIL on `assert_eq!(nav_rxt(&over), None)`.
2. Restore, then change the match so `Completeness::Recovered => (None, diags)`.
   Run: `cargo test -p redextape-core --lib`
   Expected: FAIL on `a_file_that_did_not_parse_completely_is_still_indexed` while the cap test stays green — which is what makes the third state earn its place.

**Restore and re-run to green.**

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-core/src/parser.rs crates/redextape-core/src/binder.rs \
        crates/redextape-lsp/src/language.rs
git commit -m "core, lsp: an over-cap .rxt file is not indexed, rather than empty

parse_inner's bool collapsed two states a consumer has to tell apart: a tree
the parser read and recovered, and a tree the parser never started on because
MAX_TOKENS refused the input. nav_rxt built an index from the second and
answered an empty NameIndex, which nav.rs's own doc reads as the claim that
the document contains no names.

Completeness names the third state, nav_rxt answers Option<NameIndex>, and
Language::nav's .rxt arm inherits the nav: None path Language::Lambda already
used, where every handler answers JSON null.

Measured, and asserted in the test rather than derived: 19,999 statements of
let a0 = 0; let a1 = a0; ... is 99,996 tokens and 19,999 definitions; 20,000 is
100,001 tokens and no index at all."
```

---

## Task 4: the server answers `null`, not `[]`

**Files:**
- Modify: `crates/redextape-lsp/src/lib.rs` — a test in `mod tests`

**Interfaces:**
- Consumes: `nav_rxt -> Option<NameIndex>` from Task 3.
- Produces: nothing.

**Why a test-only task:** the handler code already funnels a missing index to JSON `null` through `let nav = doc.nav.as_ref()?`. `definition_on_a_form_this_server_does_not_serve_is_null` pins that for one handler out of three, and `documentSymbol` — the arm Task 6 rewrites — has no such test. Pinning it before that rewrite is what makes the rewrite safe.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-lsp/src/lib.rs`'s `mod tests`, beside `definition_on_a_form_this_server_does_not_serve_is_null`:

```rust
    /// An over-cap `.rxt` document has no outline, and `null` is not `[]`.
    ///
    /// **THE TWO ANSWERS MEAN DIFFERENT THINGS AND THE PROTOCOL DISTINGUISHES THEM.** `[]` is
    /// "this document has no symbols"; `null` is "no outline for this document". A 100,001-token
    /// file is full of names, and the parser refused it before reading one — so `[]` would be a
    /// claim about the file that nothing in the server ever checked.
    ///
    /// The fixture is generated because the cap is 100,000 tokens; the count is asserted in
    /// `binder`'s own `a_program_over_the_token_cap_is_not_indexed_and_one_under_it_is`, and this
    /// test exists to prove the refusal reaches the wire.
    #[test]
    fn document_symbol_on_an_over_cap_rxt_file_is_null_rather_than_an_empty_list() {
        let mut src = String::from("let a0 = 0;");
        for i in 1..20_000 {
            src.push_str(&format!(" let a{i} = a0;"));
        }
        let mut server = Server::new();
        server.handle(request(1, "initialize", &json!(InitializeParams::default())));
        did_open(&mut server, "file:///big.rxt", "redextape", &src);
        let out = server.handle(request(
            2,
            "textDocument/documentSymbol",
            &json!({"textDocument": {"uri": "file:///big.rxt"}}),
        ));
        assert_eq!(success_value(&out), serde_json::Value::Null);
    }
```

If `did_open`'s fourth parameter is `&str`, pass `&src`; if it is `&'static str`, change the helper's parameter to `&str` — the other call sites pass string literals and keep compiling.

- [ ] **Step 2: Run the test**

Run: `cargo test -p redextape-lsp document_symbol_on_an_over_cap`

Expected: PASS. Task 3 already made it true; this is the pin, and Step 3 is what proves it is a pin rather than a tautology.

- [ ] **Step 3: Run the sabotage**

In `document_symbol`, temporarily replace `let nav = doc.nav.as_ref()?;` with:

```rust
            let empty = redextape_core::nav::NameIndex::default();
            let nav = doc.nav.as_ref().unwrap_or(&empty);
```

Run: `cargo test -p redextape-lsp document_symbol_on_an_over_cap`

Expected: FAIL — the result is `[]` rather than `null`. **Restore and re-run to green.**

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-lsp/src/lib.rs
git commit -m "lsp: pin documentSymbol's null answer before rewriting the handler

definition had a test for the no-index path and documentSymbol did not, which
is the arm the outline work is about to rewrite. The distinction it pins is
null versus [], and the sabotage that reddens it is a default NameIndex
standing in for a missing one."
```

---

## Task 5: a definition carries its extent

**Files:**
- Modify: `crates/redextape-core/src/nav.rs` — `Role::Definition`, `push_definition`, `Occurrence::extent`, and its `mod tests`
- Modify: `crates/redextape-core/src/binder.rs` — `Ev::Def`, `Binder::bind`, `Binder::params`, `Binder::block`, `Binder::finish`
- Modify: `crates/redextape-core/src/tm/syntax.rs` — the `push_definition` call
- Modify: `crates/redextape-core/src/tm/asm_syntax.rs` — the `push_definition` call

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Role::Definition { kind: DefKind, extent: Option<Span> }`; `NameIndex::push_definition(&mut self, name: &str, span: Span, kind: DefKind, extent: Option<Span>)`; `Occurrence::extent(&self) -> Option<Span>`.

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-core/src/binder.rs`'s `mod tests`:

```rust
    /// A `.rxt` definition carries the span of the statement that introduces it, which is the
    /// span `documentSymbol` needs and the name span cannot supply.
    ///
    /// Offsets probed on 6e0ad6e, not counted by eye.
    #[test]
    fn a_definition_carries_the_extent_of_its_statement() {
        let src = "fn f(a) {\n  let x = 1;\n  x\n}\nlet y = 2;\ny";
        let n = nav_rxt(src).expect("within the token cap");
        let extents: Vec<_> =
            n.definitions().map(|o| (o.name.as_str(), o.def_kind(), (o.span.start, o.span.end), o.extent().map(|e| (e.start, e.end)))).collect();
        assert_eq!(
            extents,
            vec![
                ("f", Some(DefKind::Fn), (3, 4), Some((0, 28))),
                ("a", Some(DefKind::Param), (5, 6), None),
                ("x", Some(DefKind::Let), (16, 17), Some((12, 22))),
                ("y", Some(DefKind::Let), (33, 34), Some((29, 39))),
            ]
        );
    }

    /// A parameter is navigable and has no extent: its statement is the whole `fn`, which is its
    /// parent's extent and not its own.
    #[test]
    fn a_parameter_has_no_extent() {
        let n = nav_rxt("fn f(a) { a }").expect("within the token cap");
        let a = n.definitions().find(|o| o.name == "a").expect("the parameter is indexed");
        assert_eq!(a.extent(), None);
    }
```

Add to `crates/redextape-core/src/nav.rs`'s `mod tests`:

```rust
    /// `.tm` and `.asm` carry no extent, and that is a fact about those forms rather than a gap:
    /// no parser records where a state's rules end.
    #[test]
    fn an_artifact_form_definition_has_no_extent() {
        let mut n = NameIndex::default();
        n.push_definition("q0", Span::new(0, 2), DefKind::State, None);
        assert_eq!(n.get(0).and_then(Occurrence::extent), None);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core --lib extent`

Expected: FAIL to compile — no method `extent`, and `push_definition` takes three arguments.

- [ ] **Step 3: Add the field and the accessor**

In `crates/redextape-core/src/nav.rs`, change `Role::Definition`:

```rust
    Definition {
        kind: DefKind,
        /// The span of the construct this name introduces — a `.rxt` `let` statement or `fn`
        /// declaration, terminator and body included. `None` for a form whose parser does not
        /// record one: no `.tm` or `.asm` parser knows where a state's rules end, which is the
        /// same fact `documentSymbol`'s line-shaped range is built on.
        ///
        /// **SUPPLIED BY THE PARSER, LIKE `kind`.** Nothing here derives an extent, and nothing
        /// here may: a span enclosing a construct is a grammar's answer, and this module holds no
        /// grammar.
        extent: Option<Span>,
    },
```

Change `push_definition`:

```rust
    pub(crate) fn push_definition(&mut self, name: &str, span: Span, kind: DefKind, extent: Option<Span>) {
        self.occurrences.push(Occurrence { name: name.to_string(), span, role: Role::Definition { kind, extent } });
    }
```

Add beside `Occurrence::def_kind`:

```rust
    /// The span of the construct this definition introduces, or `None` for a reference and for a
    /// form whose parser records none.
    #[must_use]
    pub fn extent(&self) -> Option<Span> {
        match self.role {
            Role::Definition { extent, .. } => extent,
            Role::Reference { .. } => None,
        }
    }
```

- [ ] **Step 4: Update the two artifact-form call sites and `nav.rs`'s own tests**

`crates/redextape-core/src/tm/syntax.rs`: `nav.push_definition(&name, Span { start: at, end: at + name.len() }, DefKind::State, None);`

`crates/redextape-core/src/tm/asm_syntax.rs`: `nav.push_definition(name_text, Span::new(at, at + name_text.len()), DefKind::Label, None);`

Every `push_definition` in `nav.rs`'s `mod tests` gains a trailing `, None`. Run `cargo build -p redextape-core --all-targets` and let the compiler enumerate them.

- [ ] **Step 5: Carry the extent through the binder**

In `crates/redextape-core/src/binder.rs`, change `Ev::Def`:

```rust
    Def { name: &'a str, span: Span, kind: DefKind, extent: Option<Span> },
```

`Binder::bind`:

```rust
    fn bind(&mut self, scope: usize, name: &'a str, span: Span, kind: DefKind, extent: Option<Span>) -> usize {
        let ev = self.events.len();
        self.events.push(Ev::Def { name, span, kind, extent });
        self.chain.push((scope, name, ev));
        self.chain.len() - 1
    }
```

`Binder::params` — a parameter's construct is the enclosing `fn`, not itself:

```rust
            inner = self.bind(inner, p.name.as_str(), p.span, DefKind::Param, None);
```

`Binder::block`'s `Stmt::Fn` arm — add `span` to the destructuring and pass it:

```rust
                    for stmt in run {
                        if let Stmt::Fn { name, name_span, span, .. } = stmt {
                            cur = self.bind(cur, name.as_str(), *name_span, DefKind::Fn, Some(*span));
                        }
                    }
```

`Binder::block`'s `Stmt::Let` arm — likewise:

```rust
                Stmt::Let { name, name_span, span, value, .. } => {
                    work.push(Work::E(value, cur));
                    cur = self.bind(cur, name.as_str(), *name_span, DefKind::Let, Some(*span));
                    i += 1;
                }
```

`Binder::finish`:

```rust
                Ev::Def { name, span, kind, extent } => index.push_definition(name, *span, *kind, *extent),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p redextape-core`

Expected: 0 failures, including the three new tests.

- [ ] **Step 7: Run the sabotage**

Change the `Stmt::Fn` arm to pass `Some(*name_span)` instead of `Some(*span)`.

Run: `cargo test -p redextape-core --lib a_definition_carries_the_extent`

Expected: FAIL — `f`'s extent reads `(3, 4)` rather than `(0, 28)`, which is the difference between a name and the construct it names. **Restore and re-run to green.**

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/src/nav.rs crates/redextape-core/src/binder.rs \
        crates/redextape-core/src/tm/syntax.rs crates/redextape-core/src/tm/asm_syntax.rs
git commit -m "core: a definition carries the extent of the construct it introduces

Two of #82's five filings — the outline listing every let as a flat sibling,
and documentSymbol folding a multi-line fn to its header — are one defect: the
index carries name spans and the outline needs the construct's span. One
Option<Span> on Role::Definition answers both.

None for .tm states and .asm labels is a fact about those forms, not a gap: no
parser records where a state's rules end, which is the reason documentSymbol's
range is a line in the first place. A parameter is None for a different reason
— its construct is the enclosing fn, which is that fn's extent."
```

---

## Task 6: the outline becomes a tree

**Files:**
- Create: `crates/redextape-lsp/src/outline.rs`
- Modify: `crates/redextape-lsp/src/lib.rs` — declare the module, move `enclosing_line` out of it, rewrite `document_symbol`'s hierarchical arm

**Interfaces:**
- Consumes: `Occurrence::extent` from Task 5; `language::outline_kind`.
- Produces: `pub(crate) struct OutlineNode { name: String, kind: SymbolKind, range: Span, selection_range: Span, children: Vec<OutlineNode> }` and `pub(crate) fn outline(nav: &NameIndex, text: &str) -> Vec<OutlineNode>`, both in `crate::outline`; `pub(crate) fn enclosing_line(text: &str, span: Span) -> Span` moves there from `lib.rs`.

**Why a new module:** `lib.rs` is 1,430 lines and `document_symbol` is already its longest handler. The tree building is a protocol concern that belongs beside the handler, not inside it.

- [ ] **Step 1: Write the failing tests**

Create `crates/redextape-lsp/src/outline.rs` with the module doc, the test module, and nothing else yet:

```rust
//! The document outline, as a tree.
//!
//! `NameIndex` is a flat list of definitions in source order, and `documentSymbol` wants a
//! hierarchy. The shape that turns one into the other is an extent — the span of the construct a
//! definition introduces — and containment over extents is the whole rule: a definition is a child
//! of the innermost extent that contains its name.
//!
//! **`.tm` AND `.asm` CARRY NO EXTENT, SO THEY ARE UNCHANGED BY EVERY LINE HERE.** Nothing is ever
//! pushed on the stack for them, the stack stays empty, every definition is a root, and the
//! outline is exactly the flat list it was. That is not a fallback path — it is the same pass
//! reading a form that records no construct spans.

#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::binder::nav_rxt;

    /// The names of a tree, parent first, each node's children in brackets.
    fn shape(nodes: &[OutlineNode]) -> String {
        nodes
            .iter()
            .map(|n| {
                if n.children.is_empty() {
                    n.name.clone()
                } else {
                    format!("{}[{}]", n.name, shape(&n.children))
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Probed on 6e0ad6e: `f` extent (0,28) contains `x`'s name at (16,17) and not `y`'s at
    /// (33,34), and the parameter `a` is filtered by `outline_kind` inside the pass's own loop,
    /// before this iteration reaches the stack work.
    #[test]
    fn a_let_inside_a_fn_body_becomes_that_fn_s_child() {
        let src = "fn f(a) {\n  let x = 1;\n  x\n}\nlet y = 2;\ny";
        let nav = nav_rxt(src).expect("within the token cap");
        assert_eq!(shape(&outline(&nav, src)), "f[x] y");
    }

    /// The nesting rule is containment, not statement structure: this `let` is inside a BLOCK
    /// EXPRESSION, so it is not a statement of the outer block at all and no walk over
    /// `Program::block::stmts` would find it. The binder reaches it through its worklist and the
    /// extent puts it in the right place.
    #[test]
    fn a_let_inside_a_block_expression_nests_under_the_binding_that_holds_it() {
        let src = "let g = { let y = 1; y };";
        let nav = nav_rxt(src).expect("within the token cap");
        assert_eq!(shape(&outline(&nav, src)), "g[y]");
    }

    /// Probed on 6e0ad6e: `a`'s extent ends at 10 and `b`'s name starts at 15, so the pop test
    /// pops before `b` attaches. The comparison is `<=` for the general containment semantics;
    /// `<` would behave identically, because a `.rxt` name always lies past its own keyword and so
    /// can never begin exactly where the previous extent ended.
    #[test]
    fn consecutive_lets_are_siblings() {
        let src = "let a = 1; let b = 2;";
        let nav = nav_rxt(src).expect("within the token cap");
        assert_eq!(shape(&outline(&nav, src)), "a b");
    }

    /// A `fn` run is a scoping unit and not a nesting one: `a` and `b` see each other, and neither
    /// contains the other.
    #[test]
    fn a_fn_run_does_not_nest() {
        let src = "fn a(n) { b(n) } fn b(n) { a(n) } 0";
        let nav = nav_rxt(src).expect("within the token cap");
        assert_eq!(shape(&outline(&nav, src)), "a b");
    }

    /// A closed sibling is not buried under the node pushed after it.
    ///
    /// **THE TRAILING `let z` IS WHY THIS TEST CAN FAIL.** Without it the fixture yields `f[x]`
    /// under EITHER ordering, because nothing has closed by the time anything is pushed — which is
    /// what an earlier draft of this test asked for, and it was green under the swap.
    #[test]
    fn a_closed_construct_does_not_bury_its_trailing_sibling() {
        let src = "fn f(a) { let x = 1; x } let z = 2;";
        let nav = nav_rxt(src).expect("within the token cap");
        let tree = outline(&nav, src);
        assert_eq!(tree.len(), 2, "`f` and `z` are both roots");
        assert_eq!(shape(&tree), "f[x] z");
    }

    /// A broken file still outlines. Probed on 6e0ad6e: recovery gives `f` the extent (0,11),
    /// which runs to end of input.
    #[test]
    fn a_file_that_did_not_parse_completely_still_outlines() {
        let src = "fn f(a) { a";
        let nav = nav_rxt(src).expect("a recovered file is indexed");
        assert_eq!(shape(&outline(&nav, src)), "f");
    }

    /// Every node's selection range is inside its range, which the protocol requires and which
    /// holds on both paths: an extent contains its own name, and a line contains any span on it.
    #[test]
    fn a_selection_range_is_always_inside_its_range() {
        for src in [
            "fn f(a) {\n  let x = 1;\n  x\n}\nlet y = 2;\ny",
            "let g = { let y = 1; y };",
            "fn a(n) { b(n) } fn b(n) { a(n) } 0",
        ] {
            let nav = nav_rxt(src).expect("within the token cap");
            let tree = outline(&nav, src);
            let mut stack: Vec<&OutlineNode> = tree.iter().collect();
            while let Some(n) = stack.pop() {
                assert!(
                    n.range.start <= n.selection_range.start && n.selection_range.end <= n.range.end,
                    "{src:?}: {} selection {:?} escapes range {:?}",
                    n.name,
                    n.selection_range,
                    n.range
                );
                stack.extend(n.children.iter());
            }
        }
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-lsp outline`

Expected: FAIL to compile — `outline`, `OutlineNode` and the `outline` module do not exist.

- [ ] **Step 3: Declare the module and move `enclosing_line`**

In `crates/redextape-lsp/src/lib.rs`, add `mod outline;` beside the existing `pub mod document;` line, and add `use crate::outline::{OutlineNode, enclosing_line, outline};` to the `use crate::` block.

Cut the whole `fn enclosing_line` — its doc comment included — out of `lib.rs` and paste it into `outline.rs` above the test module, changing its signature to `pub(crate) fn enclosing_line(text: &str, span: Span) -> Span` and its parameter and return types to the imported `Span` rather than the `redextape_core::Span` path. Leave every existing `enclosing_line` test in `lib.rs` where it is; the import makes them keep compiling.

- [ ] **Step 4: Write the pass**

Above the test module in `crates/redextape-lsp/src/outline.rs`:

```rust
use gen_lsp_types::SymbolKind;
use redextape_core::Span;
use redextape_core::nav::NameIndex;

use crate::language::outline_kind;

/// One symbol in the outline, in BYTE offsets. The conversion to protocol positions happens in the
/// handler, so nothing here needs to know the client's `Encoding`.
pub(crate) struct OutlineNode {
    pub name: String,
    pub kind: SymbolKind,
    /// What a client tests the cursor against: the construct's extent when it has one, the
    /// enclosing line when it does not.
    pub range: Span,
    /// The part to reveal: the name, always.
    pub selection_range: Span,
    pub children: Vec<OutlineNode>,
}

/// The outline of one document, as a tree.
///
/// **ONE PASS, IN SOURCE ORDER, WITH AN EXPLICIT STACK.** `NameIndex::definitions` promises source
/// order and `Binder::finish`'s sort delivers it, which is what makes containment testable against
/// one offset instead of a search. For each definition: pop every extent that has closed, attach
/// the definition to the innermost extent still open, then push its own extent.
///
/// **POP BEFORE PUSH IS THE CORRECTNESS ARGUMENT, AND IT IS NOT ABOUT SELF-PARENTING.** A node
/// with an extent is only ever pushed here, never attached, so nothing can become its own child in
/// either ordering. What the order protects is a CLOSED SIBLING: a just-pushed extent shadows one
/// beneath it that has already closed, so that sibling is never popped in time and the drain
/// attaches it under the node stacked on top. Swapped, `let a = 1; let b = 2;` yields `a[b]`.
///
/// The stack is explicit because it is the natural shape for this pass, NOT because recursion
/// would be unsafe here. A `let` or `fn` extent nests inside another only through a braced block,
/// and the parser refuses blocks nested past `MAX_PARSE_DEPTH`, so the tree's depth is bounded and
/// `to_document_symbol` and `flatten` recurse over it safely. `binder` is iterative for a
/// different reason, not this one: it runs BEFORE typechecking, so `MAX_TYPE_DEPTH` has not gated
/// anything, and the parser builds left-nested chains far deeper than a recursive walk survives.
/// This pass has neither problem — it reads `NameIndex::definitions`, a flat sorted list.
pub(crate) fn outline(nav: &NameIndex, text: &str) -> Vec<OutlineNode> {
    let mut roots: Vec<OutlineNode> = Vec::new();
    // Each entry is an open extent's END and the node that owns it.
    let mut open: Vec<(usize, OutlineNode)> = Vec::new();

    let attach = |open: &mut Vec<(usize, OutlineNode)>, roots: &mut Vec<OutlineNode>, node: OutlineNode| {
        match open.last_mut() {
            Some((_, parent)) => parent.children.push(node),
            None => roots.push(node),
        }
    };

    for o in nav.definitions() {
        // A definition an outline does not list — a `.rxt` parameter. Filtered here rather than in
        // the index, which keeps it navigable. The filter is inside this loop, not ahead of it:
        // the walk sees every definition and this `continue` skips the ones `outline_kind` maps to
        // `None` before they reach the stack work, so one can neither become a parent nor be
        // attached as a child.
        let Some(kind) = o.def_kind().and_then(outline_kind) else { continue };

        while open.last().is_some_and(|(end, _)| *end <= o.span.start) {
            let (_, closed) = open.pop().expect("just tested");
            attach(&mut open, &mut roots, closed);
        }

        let extent = o.extent();
        let node = OutlineNode {
            name: o.name.clone(),
            kind,
            range: extent.unwrap_or_else(|| enclosing_line(text, o.span)),
            selection_range: o.span,
            children: Vec::new(),
        };
        match extent {
            Some(e) => open.push((e.end, node)),
            None => attach(&mut open, &mut roots, node),
        }
    }

    while let Some((_, closed)) = open.pop() {
        attach(&mut open, &mut roots, closed);
    }
    roots
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p redextape-lsp outline`

Expected: 7 passed.

- [ ] **Step 6: Run the two sabotages that pin the pass**

1. Swap attach and push: move the `match extent` block above the `while open.last()` loop.
   Run: `cargo test -p redextape-lsp outline`
   Expected: FAIL on the pop-before-push test — the one whose fixture carries a TRAILING
   top-level sibling. A fixture without one passes under either ordering.
2. Restore. **Do not sabotage `<=` into `<`**: §3.3 of the design shows that boundary is
   unreachable in this grammar, so the two are the same function and no fixture distinguishes
   them. Sabotage the pop loop's presence instead — delete it entirely.
   Run: `cargo test -p redextape-lsp outline`
   Expected: FAIL on `consecutive_lets_are_siblings` — with nothing ever popped, `b` is attached
   under `a`.

**Restore and re-run to green.**

- [ ] **Step 7: Wire the hierarchical arm**

In `document_symbol`, replace the `symbols` iterator and the `DocumentSymbolList` arm's `map` with a walk over the tree. Replace:

```rust
            let symbols = nav.definitions().filter_map(|o| {
                // `None` is a definition an outline does not list — a `.rxt` parameter. Filtering
                // here rather than in the index keeps the parameter navigable.
                let kind = outline_kind(o.def_kind()?)?;
                let selection_range = doc.index.range(&doc.text, o.span, self.encoding);
                let range = doc.index.range(&doc.text, enclosing_line(&doc.text, o.span), self.encoding);
                Some((o.name.clone(), kind, range, selection_range))
            });
```

with:

```rust
            let tree = outline(nav, &doc.text);
```

and the `DocumentSymbolList` arm's body with:

```rust
                DocumentSymbolResponse::DocumentSymbolList(
                    tree.iter().map(|n| self.to_document_symbol(doc, n)).collect(),
                )
```

Add this method beside `document_symbol`:

```rust
    /// One `OutlineNode` and its children as the protocol's `DocumentSymbol`.
    ///
    /// Recursive, and bounded by the outline's nesting rather than by the file's: `outline` builds
    /// the tree iteratively, and a tree deep enough to matter here would need that many nested
    /// `fn`/`let` constructs, each of which the parser's own `MAX_PARSE_DEPTH` already refused.
    fn to_document_symbol(&self, doc: &crate::document::Document, node: &OutlineNode) -> DocumentSymbol {
        // `DocumentSymbol::deprecated` is a #[deprecated] field with no default and a positional
        // slot in `::new`, so BOTH construction routes trip the lint that `-D warnings` makes fatal.
        #[allow(deprecated)]
        DocumentSymbol {
            name: node.name.clone(),
            detail: None,
            kind: node.kind,
            tags: None,
            deprecated: None,
            range: doc.index.range(&doc.text, node.range, self.encoding),
            selection_range: doc.index.range(&doc.text, node.selection_range, self.encoding),
            children: if node.children.is_empty() {
                None
            } else {
                Some(node.children.iter().map(|c| self.to_document_symbol(doc, c)).collect())
            },
        }
    }
```

Update `document_symbol`'s own doc comment: the paragraph beginning `/// \`range\` and \`selection_range\` are both the name's span.` is now false. Replace it with:

```rust
    /// `selection_range` is the name; `range` is the construct's extent when the form records one
    /// and the enclosing line when it does not. `.tm` and `.asm` record none — no parser knows
    /// where a state's rules end — so both keep the line-shaped range they shipped with, and
    /// `.rxt` gets the `fn` or `let` statement itself. `outline` builds the nesting; see that
    /// module for why containment is the rule.
```

- [ ] **Step 8: Add the handler-level nesting test**

The tests in Step 1 exercise `outline` directly. This one proves the tree reaches the wire, which a unit test on the pass structurally cannot see — #82 shipped a missing re-export that passed every in-crate test because `super::*` cannot see one.

Add to `lib.rs`'s `mod tests`, using the existing `init_hierarchical` helper:

```rust
    /// A client that asked for `DocumentSymbol[]` gets the nesting, not a flattened list.
    #[test]
    fn a_hierarchical_client_gets_a_lets_children_under_their_fn() {
        let src = "fn f(a) {\n  let x = 1;\n  x\n}\nlet y = 2;\ny";
        let mut server = Server::new();
        init_hierarchical(&mut server);
        did_open(&mut server, "file:///a.rxt", "redextape", src);
        let out = server.handle(request(
            2,
            "textDocument/documentSymbol",
            &json!({"textDocument": {"uri": "file:///a.rxt"}}),
        ));
        let value = success_value(&out);
        let roots = value.as_array().expect("the hierarchical arm is an array");
        let names: Vec<_> = roots.iter().map(|s| s["name"].as_str().expect("a name")).collect();
        assert_eq!(names, vec!["f", "y"], "only the two top-level constructs are roots");
        let children: Vec<_> = roots[0]["children"]
            .as_array()
            .expect("`f` has children")
            .iter()
            .map(|s| s["name"].as_str().expect("a name"))
            .collect();
        assert_eq!(children, vec!["x"]);
        // The `fn` folds to its body, not its header: probed extent (0, 28) is four lines.
        assert_eq!(roots[0]["range"]["start"]["line"], 0);
        assert_eq!(roots[0]["range"]["end"]["line"], 3);
        assert_eq!(roots[0]["selectionRange"]["start"]["line"], 0);
    }
```

- [ ] **Step 9: Run the LSP suite**

Run: `cargo test -p redextape-lsp`

Expected: 0 failures. **The existing `.tm` and `.asm` `documentSymbol` tests must pass with no edit** — those forms carry no extent, so nothing about them changes. If one needs editing, the pass has a bug; do not edit the test.

- [ ] **Step 10: Run the regression sabotage for the artifact forms**

The claim to sabotage is that `.tm` and `.asm` are untouched. Give them an extent they should not have: in `tm/syntax.rs`, change the `push_definition` call's last argument from `None` to `Some(Span { start: at, end: at + name.len() })`.

Run: `cargo test -p redextape-lsp`

Expected: FAIL — `.tm` states change their `range` from the enclosing line to the bare name, and the existing `.tm` `documentSymbol` tests say so. **Restore and re-run to green.** If nothing fails, the `.tm` outline is not covered at all and that is the finding.

- [ ] **Step 10: Commit**

```bash
git add crates/redextape-lsp/src/outline.rs crates/redextape-lsp/src/lib.rs
git commit -m "lsp: the outline is a tree, and a multi-line fn folds to its body

Two filings, one mechanism. documentSymbol set range to the enclosing line and
children to None always, so a multi-line fn reported no symbol anywhere in its
body and every let — block-local ones included — was a flat sibling of the
functions.

outline.rs turns the flat index into a tree in one pass over an explicit stack:
pop the extents that have closed, attach to the innermost still open, then push
this definition's own. Attach before push is the correctness argument, because
a fn's name lies inside its own extent.

.tm and .asm record no extent, so nothing is ever pushed for them, every
definition is a root, and their existing tests pass unedited."
```

---

## Task 7: the flat arm reports its containers

**Files:**
- Modify: `crates/redextape-lsp/src/lib.rs` — remove `flatten`, rewire the `SymbolInformationList` arm
- Modify: `crates/redextape-lsp/src/outline.rs` — receive `flatten`, widened to carry the container

**Interfaces:**
- Consumes: `OutlineNode` and `outline` from Task 6.
- Produces: `pub(crate) fn flatten(nodes: &[OutlineNode]) -> Vec<(&OutlineNode, Option<&str>)>` in `crate::outline`.

**THIS TASK NO LONGER ADDS `flatten` — IT MOVES AND WIDENS ONE THAT ALREADY EXISTS.** Task 6's
Step 7 snippet left the `SymbolInformationList` arm not compiling, so its implementer wrote a
`flatten` to close that, and Task 6's review then required a test for it. What is in the tree at
the start of this task is:

```rust
// in lib.rs, private, no container names
fn flatten(nodes: &[OutlineNode]) -> Vec<&OutlineNode> {
    let mut out = Vec::new();
    for n in nodes {
        out.push(n);
        out.extend(flatten(&n.children));
    }
    out
}
```

plus a test `the_flat_arm_lists_every_node_not_just_the_roots` in `lib.rs` that asserts the arm
emits `["f", "x", "y"]` and that `f`'s `location.range` is the extent. **That test must keep
passing unedited** — this task adds container names, it does not change which nodes are listed.

Three things to do, therefore: move the function to `outline.rs` beside the type it walks (Task 6's
review noted `lib.rs` NET GREW by 37 lines against the new module's whole purpose), widen its
return to pair each node with its parent's name, and set `container_name` from that pair.

- [ ] **Step 1: Write the failing tests**

Add to `outline.rs`'s test module:

```rust
    /// The flat shape has no `children`, so the nesting has to reach it as a container NAME or not
    /// at all — and the nodes themselves must all still be there.
    #[test]
    fn flattening_keeps_every_node_and_names_its_container() {
        let src = "fn f(a) {\n  let x = 1;\n  x\n}\nlet y = 2;\ny";
        let nav = nav_rxt(src).expect("within the token cap");
        let tree = outline(&nav, src);
        let flat: Vec<_> = flatten(&tree).into_iter().map(|(n, c)| (n.name.as_str(), c)).collect();
        assert_eq!(flat, vec![("f", None), ("x", Some("f")), ("y", None)]);
    }

    /// Source order survives flattening: a parent immediately precedes its children, which is what
    /// a client with no hierarchy renders as a list.
    #[test]
    fn flattening_keeps_source_order() {
        let src = "let g = { let y = 1; y };";
        let nav = nav_rxt(src).expect("within the token cap");
        let tree = outline(&nav, src);
        let flat: Vec<_> = flatten(&tree).into_iter().map(|(n, c)| (n.name.as_str(), c)).collect();
        assert_eq!(flat, vec![("g", None), ("y", Some("g"))]);
    }
```

Add to `lib.rs`'s test module:

```rust
    /// A client without `hierarchicalDocumentSymbolSupport` gets every symbol the tree holds, not
    /// only its roots — the nesting reaches it through `containerName`.
    ///
    /// `the_flat_arm_lists_every_node_not_just_the_roots` already pins the node LIST and `f`'s
    /// range for this arm; what is new here is the container on each row. Both stay, but not for
    /// the reason an earlier draft of this comment gave: a roots-only `flatten` fails BOTH, and
    /// what the older test still uniquely covers is `f`'s `location.range` being the extent.
    ///
    /// **THE FLAT SHAPE IS WHAT THIS CLIENT ASKED FOR, NOT A FALLBACK**, and
    /// `DocumentSymbolResponse` is `#[serde(untagged)]`, so sending the wrong arm is not an error
    /// the client can report. A pass that emitted only the roots would look like a working outline
    /// with the body of every function missing.
    #[test]
    fn a_client_without_hierarchical_support_gets_every_symbol_with_its_container() {
        let src = "fn f(a) {\n  let x = 1;\n  x\n}\nlet y = 2;\ny";
        let mut server = Server::new();
        server.handle(request(1, "initialize", &json!(InitializeParams::default())));
        did_open(&mut server, "file:///a.rxt", "redextape", src);
        let out = server.handle(request(
            2,
            "textDocument/documentSymbol",
            &json!({"textDocument": {"uri": "file:///a.rxt"}}),
        ));
        let value = success_value(&out);
        let names: Vec<_> = value
            .as_array()
            .expect("the flat arm is an array")
            .iter()
            .map(|s| (s["name"].as_str().expect("a name"), s["containerName"].as_str()))
            .collect();
        assert_eq!(names, vec![("f", None), ("x", Some("f")), ("y", None)]);
    }
```

`Server::new()` must not advertise hierarchical support for this test. If the existing helper does, initialize with an explicit `InitializeParams` whose `capabilities.text_document.document_symbol.hierarchical_document_symbol_support` is `Some(false)`, following whatever the existing hierarchical-versus-flat test in `lib.rs` already does.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-lsp -- flatten a_client_without_hierarchical`

Expected: FAIL to compile. `outline.rs`'s test module reaches its own module through `super::*`,
and `flatten` is still in `lib.rs`, so the two new tests there cannot resolve it; the `lib.rs` test
fails on the `(n, c)` pair its current single-value `flatten` does not return.

- [ ] **Step 3: Add `flatten`**

In `outline.rs`, after `outline`:

```rust
/// Every node of the tree in source order, each paired with the name of its parent.
///
/// For the `SymbolInformation[]` shape, which has no `children`: `container_name` is the only
/// place the nesting can appear, and dropping the non-roots would present a partial outline as a
/// complete one.
pub(crate) fn flatten(nodes: &[OutlineNode]) -> Vec<(&OutlineNode, Option<&str>)> {
    let mut out = Vec::new();
    fn go<'a>(nodes: &'a [OutlineNode], container: Option<&'a str>, out: &mut Vec<(&'a OutlineNode, Option<&'a str>)>) {
        for n in nodes {
            out.push((n, container));
            go(&n.children, Some(n.name.as_str()), out);
        }
    }
    go(nodes, None, &mut out);
    out
}
```

- [ ] **Step 4: Wire the flat arm**

In `document_symbol`, replace the `SymbolInformationList` arm's body:

```rust
                DocumentSymbolResponse::SymbolInformationList(
                    crate::outline::flatten(&tree)
                        .into_iter()
                        .map(|(n, container)| {
                            #[allow(deprecated)]
                            SymbolInformation {
                                deprecated: None,
                                location: Location::new(
                                    uri.clone(),
                                    doc.index.range(&doc.text, n.range, self.encoding),
                                ),
                                base_symbol_information: BaseSymbolInformation {
                                    name: n.name.clone(),
                                    kind: n.kind,
                                    tags: None,
                                    container_name: container.map(str::to_string),
                                },
                            }
                        })
                        .collect(),
                )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p redextape-lsp`

Expected: 0 failures.

- [ ] **Step 6: Run the sabotage**

Change `flatten`'s `go` to skip the recursive call, so only roots are emitted.

Run: `cargo test -p redextape-lsp`

Expected: FAIL on both `flattening_keeps_every_node_and_names_its_container` and `a_client_without_hierarchical_support_gets_every_symbol_with_its_container`. **Restore and re-run to green.**

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-lsp/src/outline.rs crates/redextape-lsp/src/lib.rs
git commit -m "lsp: the flat symbol shape reports its containers

SymbolInformation[] has no children, so a tree reaches it as containerName or
not at all. Emitting only the roots would have presented a partial outline as a
complete one, with the body of every function missing and nothing logged on
either side — DocumentSymbolResponse is untagged, so the client cannot report
a wrong arm."
```

---

## Task 8: the claims this branch made false, and the whole-file property

**Files:**
- Modify: `README.md` — the LSP bullet under `### Not built yet`
- Modify: `crates/redextape-core/src/nav.rs` — the module doc
- Modify: `crates/redextape-core/src/analysis.rs` — the `nav_rxt` pointer
- Modify: `crates/redextape-lsp/src/document.rs` — the `nav` field doc, if it states anything this branch changed
- Modify: `plugin/redextape.lua` — only if it states what navigation answers
- Modify: `crates/redextape-lsp/src/outline.rs` — the whole-file property test

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

**Why this is its own task, and why it is not optional.** #82's own whole-branch review found **five false load-bearing claims, every one in a file the branch never edited** — which is exactly why no diff-scoped review could see them. This task is the sweep that finds this branch's equivalent, and it runs before the whole-branch review rather than after.

- [ ] **Step 1: Find the claims**

Run each of these and read every hit, not only the ones in files this branch touched:

```bash
grep -rn "empty index\|no names\|contains no names" --include='*.rs' --include='*.md' --include='*.lua' .
grep -rn "enclosing line\|enclosing_line\|whole state's rules\|more than navigation needs" --include='*.rs' --include='*.md' .
grep -rn "flat sibling\|documentSymbol\|document symbol\|outline" --include='*.rs' --include='*.md' --include='*.lua' .
grep -rn "parse_recovering\|nav_rxt\|MAX_TOKENS" --include='*.rs' --include='*.md' .
grep -rn "fn run\|fn_run\|maximal run" --include='*.rs' --include='*.md' .
```

Write the list of claims that are now false into the commit message. Known starting points, each of which must be checked rather than assumed:

- `README.md`'s LSP bullet lists what is built and what is not for each form.
- `nav.rs`'s module doc explains what an index outliving a failed parse means; the `MAX_TOKENS` refusal is a case it does not cover.
- `analysis.rs`'s pointer at `binder::nav_rxt` describes a function whose return type changed.
- `document.rs`'s `nav` field doc describes when the index is `None`.
- `lib.rs`'s `document_symbol` doc, corrected in Task 6 — confirm no second copy of the same sentence survives elsewhere, which is the exact shape of #82's `nav.rs`-versus-`lib.rs` twin.

- [ ] **Step 2: Fix each one, in place**

No new prose beyond what a claim needs to become true. Where a claim was true of `.tm` and `.asm` and is now false only for `.rxt`, say which form rather than deleting the sentence.

- [ ] **Step 3: Add the whole-file property test**

Add to `outline.rs`'s test module:

```rust
    /// Every definition the outline lists reaches the tree exactly once.
    ///
    /// A whole-file property no fixture checks: a stack pass can LOSE a node — popped and attached
    /// to a parent that was itself already popped — and every fixture above would still pass,
    /// because each names the nodes it expects rather than counting them.
    ///
    /// **THE TREE'S OWN `.rxt` CORPUS COULD NOT EXERCISE THAT PROPERTY, AND THIS PLAN SAID IT
    /// COULD.** Measured when this test first shipped: 21 fixtures, ALL depth-1, with zero
    /// parent-child edges between them — so a test run only over them proved nothing about a pass
    /// that mis-nests. `run_nested_scopes.in/p.rxt`, added later as a CLI end-to-end case for a
    /// program whose scopes actually nest, has since given the corpus its first real parent-child
    /// edges — one fixture is not scale, though, so the generated nested source alongside the
    /// corpus walk is still what exercises the property at breadth. The shipped test guards on
    /// NODES BUILT and the corpus's own max depth rather than files read, and compares placement
    /// as well as identity, because a comparison that discards the container passes green while
    /// every node is re-parented.
    #[test]
    fn every_listed_definition_appears_in_the_tree_exactly_once() {
        // Measured on this branch: 22 `.rxt` files, all under `crates/redextape-cli/tests/cmd`,
        // and several are deliberately broken fixtures — which is the population this pass exists
        // for.
        let root = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
        let mut files = Vec::new();
        let mut dirs = vec![root.to_path_buf()];
        while let Some(dir) = dirs.pop() {
            for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                let path = entry.path();
                let name = entry.file_name();
                if name == "target" || name == ".git" || name == "node_modules" {
                    continue;
                }
                if path.is_dir() {
                    dirs.push(path);
                } else if path.extension().and_then(std::ffi::OsStr::to_str) == Some("rxt") {
                    files.push(path);
                }
            }
        }
        // **A FILE COUNT IS THE WRONG GUARD, AND THIS DRAFT USED IT.** Measured on this branch:
        // 10 of the 22 fixtures parse and contribute ZERO outline-eligible definitions, so the
        // corpus half can compare two empty lists 22 times with a file-count assertion green. The
        // shipped test counts NODES BUILT (20 measured, floor raised to 15) and the corpus's own
        // max depth (3 measured, floor 2), and keeps the file count only as a third, weaker check
        // that the walk found the tree at all.
        assert!(files.len() >= 20, "expected the tree's .rxt fixtures, found {}", files.len());

        for path in files {
            let src = std::fs::read_to_string(&path).expect("a readable fixture");
            let Some(nav) = nav_rxt(&src) else { continue };
            let listed = nav.definitions().filter(|o| o.def_kind().and_then(outline_kind).is_some()).count();
            assert_eq!(flatten(&outline(&nav, &src)).len(), listed, "{}", path.display());
        }
    }
```

- [ ] **Step 4: Run everything**

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```

Expected: 0 failures, clean, clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs, lsp: the claims this branch made false, and a whole-file property

#82's whole-branch review found five false load-bearing claims, every one in a
file that branch never edited — structurally invisible to a diff-scoped review.
This is the sweep for this branch's equivalent, run before the review rather
than after it.

The property test is the one no fixture can be: a stack pass that LOSES a node
would leave every named-shape assertion green, because each names the nodes it
expects instead of counting them."
```

---

## Task 9: the roadmap entry, and the PR

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` — a new `####` entry at the end

**Interfaces:**
- Consumes: every task above.
- Produces: the entry a PR body cites.

**A substantive PR needs its roadmap entry before it is opened**, and every figure in it names the command that produced it and is run immediately before it is committed.

- [ ] **Step 1: Collect the figures**

Run each and record the output:

```bash
cargo test --workspace 2>&1 | tail -5
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
cargo test -p redextape-core --lib 2>&1 | tail -3
cargo test -p redextape-lsp 2>&1 | tail -3
git diff --stat 6e0ad6e..HEAD -- crates/
cargo tree -p redextape-core --edges normal
```

- [ ] **Step 2: Write the entry**

A `####` heading in the file's established style, naming the branch, the commit range, and the commit count. It must state:

- Three of #82's five filings closed, and that two of the three were one defect.
- The `fn_run_at` measurement: green probe across the workspace, inverted probe fired 100 times, so the green was evidence.
- The measured cap figures, with the fixture that produced them.
- **A `WHAT STAYS OPEN` section**, carrying forward the two ends this slice did not take — `push_reference`'s split, kept deliberately with the reason, and `.rxlambda` navigation — plus anything the tasks above filed.
- **A `VERIFICATION` section** with Step 1's figures, each naming its command.

- [ ] **Step 3: Commit and push**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "roadmap: the LSP track's loose ends"
git push -u origin lsp-loose-ends
```

- [ ] **Step 4: Request the whole-branch review before opening the PR**

Run a review over the whole branch diff, not per task. Six clean per-task reviews preceded #82's five false claims, so a clean per-task record is the PRECONDITION for this review rather than a reason to skip it. Brief it explicitly to check **claims in files this branch did not edit**.

- [ ] **Step 5: Open the PR**

Body written as one long line per paragraph — Forgejo renders bodies with GFM `breaks: true`, so hard wrapping produces ragged output. Cite the design spec and the roadmap entry.

---

## Self-review notes

**Spec coverage.** §1 → Tasks 1–2. §2 → Tasks 3–4. §3.2 → Task 5. §3.3 → Task 6. §3.4 → Tasks 6–7. §4's fixtures → Tasks 5–6, each named in a test. §5's refusal → Task 9's `WHAT STAYS OPEN`. §6's sabotages → one per task, each with its own step. §7 → Task 9 Step 1.

**Commit granularity is bounded by the gate, not by taste.** Every task that adds an item also adds its first caller, because `dead_code` under `-D warnings` fails the pre-commit hook.

**Names used across tasks:** `fn_run_at` (Tasks 1–2), `Completeness` / `parse_for_nav` / `nav_rxt` (Tasks 3–4), `Occurrence::extent` / `push_definition`'s fourth argument (Task 5), `OutlineNode` / `outline` / `enclosing_line` (Tasks 6–8), `flatten` (Tasks 7–8).
