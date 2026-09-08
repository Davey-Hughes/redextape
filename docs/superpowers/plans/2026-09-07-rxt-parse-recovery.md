# `.rxt` Parse Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `redextape-core`'s `.rxt` parser error recovery, so a broken file yields a tree and every parse error instead of no tree and only the first.

**Architecture:** One parser with two exit conditions. Recovery always runs internally; `parse_full` answers `None` when it fired even once, so no existing consumer's behaviour over trees changes. A new `parse_recovering` returns the tree unconditionally. Two new AST variants, `Stmt::Error` and `Expr::Error`, hold the source that could not be parsed.

**Tech Stack:** Rust 2024, `cargo nextest`, no new dependencies. `redextape-core` has zero dependencies and this plan keeps it that way.

**Spec:** `docs/superpowers/specs/2026-09-07-rxt-parse-recovery-design.md`

## Global Constraints

- `redextape-core` takes no new dependencies. `cargo tree -p redextape-core --edges normal` must keep printing exactly one line.
- The pre-commit gate runs `cargo clippy -- -D warnings` on every commit. A commit that does not compile clean cannot be split off; collapse tasks rather than using `--no-verify`.
- Every forced match arm is an **answer**, never `unreachable!()` or `panic!()`. Spec §4.
- `parse_full` and `parse` keep their exact current signatures and their exact current tree behaviour: `Some` only for a complete parse.
- No name spans, no binder pass, no `redextape-lsp` change. Those are PR B2.
- Doc comments use `///`. No AI/Claude attribution anywhere.

---

## File Structure

| file | responsibility in this plan |
|---|---|
| `crates/redextape-core/src/ast.rs` | Declares `Stmt::Error` and `Expr::Error`; four arms (drop walker ×2, `span()` ×2) |
| `crates/redextape-core/src/parser.rs` | All recovery: bookkeeping, `resync`, progress, the two entry points |
| `crates/redextape-core/src/typeck.rs` | Two arms |
| `crates/redextape-core/src/lints.rs` | Two arms |
| `crates/redextape-core/src/desugar.rs` | Four arms |
| `crates/redextape-core/src/printer.rs` | Two arms |
| `crates/redextape-core/src/lib.rs` | Re-export `parse_recovering`; update the tests §2 says move |

No new files. Recovery belongs in `parser.rs` because that is the only place that knows token positions, and splitting it out would put the resync rule at a distance from the loop it protects.

---

### Task 1: The two variants and their fourteen arms

Adds both variants and answers every match a new variant breaks. The parser does not yet produce
them, so this task's tests build them by hand. That is deliberate: it proves each consumer's answer
independently of whether recovery ever constructs the node.

**Files:**
- Modify: `crates/redextape-core/src/ast.rs:22-40` (declarations), `:105`, `:147`, `:167`, `:188`
- Modify: `crates/redextape-core/src/typeck.rs:338`, `:390`
- Modify: `crates/redextape-core/src/lints.rs:146`, `:190`
- Modify: `crates/redextape-core/src/desugar.rs:85`, `:364`, `:575`
- Modify: `crates/redextape-core/src/printer.rs:269`, `:920`
- Test: the `#[cfg(test)] mod tests` already present in `typeck.rs`, `lints.rs`, `desugar.rs`, `printer.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `ast::Stmt::Error { span: Span }` and `ast::Expr::Error { span: Span }`. Task 3 constructs `Stmt::Error`; Task 4 constructs `Expr::Error`.

- [ ] **Step 1: Declare both variants**

In `crates/redextape-core/src/ast.rs`, add the last arm to each enum:

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Stmt {
    Let { name: String, mutable: bool, value: Expr, span: Span },
    Fn { name: String, params: Vec<String>, body: Block, span: Span },
    Assign { target: String, value: Expr, span: Span },
    While { cond: Expr, body: Block, span: Span },
    Expr(Expr),
    /// A statement the parser could not read, spanning the source it skipped past.
    ///
    /// Produced only by `parser::parse_recovering`. `parse_full` answers `None` for any input that
    /// produced one, so no consumer reached through `parse`/`parse_full`/`format` can meet it —
    /// which is why every arm answering it below is written as an answer and not an assertion.
    Error { span: Span },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Expr {
    Nat { value: u64, span: Span },
    Bool { value: bool, span: Span },
    Var { name: String, span: Span },
    List { items: Vec<Expr>, span: Span },
    Binary { op: BinOp, lhs: Box<Expr>, rhs: Box<Expr>, span: Span },
    If { cond: Box<Expr>, then_blk: Block, else_blk: Block, span: Span },
    Block { block: Box<Block>, span: Span },
    Lambda { params: Vec<String>, body: Box<Expr>, span: Span },
    Call { callee: Box<Expr>, args: Vec<Expr>, span: Span },
    Method { recv: Box<Expr>, name: String, args: Vec<Expr>, span: Span },
    /// An expression the parser could not read, spanning the source it consumed trying.
    ///
    /// Its existence is what lets `let x = @@@;` still bind `x`: the `value` field needs something
    /// to hold. See `Stmt::Error` for why the arms answering it never assert.
    Error { span: Span },
}
```

- [ ] **Step 2: Run the build to see the fourteen errors**

Run: `cargo build -p redextape-core 2>&1 | grep -c '^error\[E0004\]'`
Expected: a non-zero count of non-exhaustive-match errors. This is the compiler enumerating the work
for steps 3-7. Read the list; it should name `ast.rs`, `typeck.rs`, `lints.rs`, `desugar.rs` and
`printer.rs` and no other file. If it names a sixth file, stop — the spec's §4 inventory is wrong
again and the plan needs updating before continuing.

- [ ] **Step 3: Answer the four `ast.rs` arms**

`take_expr_children` (`ast.rs:105`) — extend the existing childless-leaves arm:

```rust
        // Childless leaves.
        Expr::Nat { .. } | Expr::Bool { .. } | Expr::Var { .. } | Expr::Error { .. } => {}
```

`take_stmt_children` (`ast.rs:147`) — add an arm:

```rust
        // Childless: an error statement holds a span and nothing to unlink.
        Stmt::Error { .. } => {}
```

`Expr::span` (`ast.rs:167`) — add to the or-pattern:

```rust
            | Expr::Method { span, .. }
            | Expr::Error { span, .. } => *span,
```

`Stmt::span` (`ast.rs:188`) — add to the or-pattern:

```rust
            Stmt::Let { span, .. }
            | Stmt::Fn { span, .. }
            | Stmt::Assign { span, .. }
            | Stmt::While { span, .. }
            | Stmt::Error { span, .. } => *span,
```

- [ ] **Step 4: Answer the two `typeck.rs` arms**

`infer_stmt` (`typeck.rs:338`), as the last arm:

```rust
            // Nothing was parsed, so nothing is inferred and nothing is bound. A binding invented
            // here would be a name the source does not contain.
            Stmt::Error { .. } => {}
```

`infer_expr_inner` (`typeck.rs:390`), as the last arm:

```rust
            // A fresh variable unifies with anything, so an unparsed expression adds no type error
            // of its own on top of the parse error already reported. This is the same answer this
            // function already gives an unbound variable and an over-deep expression.
            Expr::Error { .. } => self.fresh(),
```

- [ ] **Step 5: Answer the two `lints.rs` arms**

`stmt` (`lints.rs:146`), as the last arm:

```rust
            // No binding to push and no children to walk.
            Stmt::Error { .. } => {}
```

`expr` (`lints.rs:190`) — extend the existing no-op arm:

```rust
            Expr::Nat { .. } | Expr::Bool { .. } | Expr::Error { .. } => {}
```

- [ ] **Step 6: Answer the four `desugar.rs` arms**

`lower_stmts_at` (`desugar.rs:85`), inside `acc = match stmt { .. }`:

```rust
            // An error statement contributes no link to the chain: it bound nothing and computed
            // nothing, so the accumulator passes through unchanged.
            Stmt::Error { .. } => acc,
```

`free_member_refs` carries two matches over the same scoping walk, one per node kind it visits, and
both need an arm.

Its expression walk (inside the `Work::E` arm of its own match) — extend the childless arm:

```rust
                Expr::Nat { .. } | Expr::Bool { .. } | Expr::Error { .. } => {}
```

Its **statement** walk (inside the `Work::B` arm, over `block.stmts`) — add an arm. This is the one
this plan's own first draft missed: the earlier count of "thirteen arms" persisted through a
grep-based recount of `free_member_refs`'s matches that searched for `Expr::Nat` — a probe built
around an `Expr` literal that cannot, in principle, find a `Stmt` match, so it re-confirmed the
miscount instead of catching it. Only the compiler's `E0004` list produced fourteen:

```rust
                        // An error statement references nothing and binds nothing, so it neither
                        // contributes a dependency nor shadows a member name.
                        Stmt::Error { .. } => {
                            i += 1;
                        }
```

`lower_expr_at` (`desugar.rs:575`), as the last arm:

```rust
        // An expression position demands a value, so this is the one desugar arm that must produce
        // a node. `Core` has no fault variant and adding one would ripple into `interp`,
        // `lambda/lower`, `tm/lower_asm`, `tm/defunc` and `redextape-native`'s codegen. An unbound
        // `Core::Var` already faults rather than panics (`interp.rs:117`), and `$` is unforgeable in
        // user source (`lexer.rs:58` starts an identifier on `_` or an ASCII letter), so this
        // collides with no program a user can write.
        Expr::Error { span } => {
            let id = g.fresh();
            spans.push((id, *span));
            Core::Var(id, "$error".into())
        }
```

- [ ] **Step 7: Answer the two `printer.rs` arms**

`expr_prec` (`printer.rs:269`), as the last arm:

```rust
            // Echo the source verbatim. Unreachable through `format`, which never sees a recovered
            // tree — written as a real echo so a formatter for broken files has the mechanism
            // rather than a crash. `self.src` is `&'a str`, so binding it out first keeps the
            // borrow off `&mut self`; see `comment_text`'s doc for the same pattern.
            Expr::Error { span } => {
                let text = self.src.get(span.start..span.end).unwrap_or("");
                self.out.push_str(text);
            }
```

`stmt` (`printer.rs:920`), as the last arm:

```rust
            Stmt::Error { span } => {
                let text = self.src.get(span.start..span.end).unwrap_or("");
                self.out.push_str(text);
            }
```

`bp_of` (`printer.rs:718`) needs no arm — it ends in `_ => ATOM_BP`, and atom binding power is right
for an error node, which must never be parenthesised.

- [ ] **Step 8: Run the build to verify it is clean**

Run: `cargo build -p redextape-core`
Expected: success, no warnings.

- [ ] **Step 9: Write the four consumer tests**

These build the variants by hand because no parser produces them yet.

In `crates/redextape-core/src/typeck.rs`'s test module:

```rust
    #[test]
    fn an_error_expression_types_as_a_fresh_variable_and_adds_no_type_error() {
        use crate::ast::{Block, BinOp, Expr, Program};
        // `1 + <error>`. A fresh variable unifies with Nat, so the ONLY diagnostic a user sees for
        // a broken file is the parse error — not a type error stacked on top of it. Sabotage: make
        // the arm answer `Ty::Bool` and this reddens.
        let program = Program {
            block: Block {
                stmts: Vec::new(),
                tail: Some(Box::new(Expr::Binary {
                    op: BinOp::Add,
                    lhs: Box::new(Expr::Nat { value: 1, span: Span::new(0, 1) }),
                    rhs: Box::new(Expr::Error { span: Span::new(4, 7) }),
                    span: Span::new(0, 7),
                })),
                span: Span::new(0, 7),
            },
        };
        assert_eq!(typecheck(&program), Vec::new(), "an error node must not cascade");
    }
```

In `crates/redextape-core/src/lints.rs`'s test module:

```rust
    #[test]
    fn an_error_statement_warns_about_nothing() {
        use crate::ast::{Block, Program, Stmt};
        // An unparsed statement might have read any binding in scope. Reporting `x` unused because
        // the only thing that could have read it did not parse would be a warning about the
        // parser's failure dressed up as one about the user's code.
        let program = Program {
            block: Block {
                stmts: vec![
                    Stmt::Let {
                        name: "x".into(),
                        mutable: false,
                        value: Expr::Nat { value: 1, span: Span::new(8, 9) },
                        span: Span::new(0, 10),
                    },
                    Stmt::Error { span: Span::new(11, 15) },
                ],
                tail: None,
                span: Span::new(0, 15),
            },
        };
        let ds = check(&program);
        assert_eq!(ds.len(), 1, "only the unused-variable warning for `x`: {ds:?}");
        assert!(ds[0].message.contains("unused variable"), "got {:?}", ds[0].message);
    }
```

In `crates/redextape-core/src/desugar.rs`'s test module:

```rust
    #[test]
    fn an_error_expression_lowers_to_a_fault_rather_than_a_panic() {
        use crate::ast::{Block, Expr, Program};
        use crate::interp;
        // The arm must produce something EVALUABLE that fails loudly. Both halves matter: a panic
        // would abort the process, and `Core::Unit` would make an unparsed expression evaluate
        // successfully to a value.
        let program = Program {
            block: Block {
                stmts: Vec::new(),
                tail: Some(Box::new(Expr::Error { span: Span::new(0, 3) })),
                span: Span::new(0, 3),
            },
        };
        let core = desugar(&program);
        let err = interp::eval(&core).expect_err("an error node must not evaluate to a value");
        assert!(format!("{err:?}").contains("$error"), "the fault should name the node: {err:?}");
    }
```

In `crates/redextape-core/src/printer.rs`'s test module:

```rust
    #[test]
    fn an_error_node_prints_back_the_source_it_could_not_parse() {
        use crate::ast::{Block, Program, Stmt};
        use crate::parser::Parsed;
        // The span indexes `src`, so the printer echoes the bytes rather than inventing text. The
        // assertion names the exact slice: a printer that emitted a placeholder like `<error>`
        // would satisfy "output is non-empty" but not this.
        let src = "let x = 1;\n@@@ nonsense\n";
        let program = Program {
            block: Block {
                stmts: vec![Stmt::Error { span: Span::new(11, 23) }],
                tail: None,
                span: Span::new(0, src.len()),
            },
        };
        let parsed = Parsed { program, comments: Vec::new(), src };
        assert!(print(&parsed).contains("@@@ nonsense"), "got {:?}", print(&parsed));
    }
```

- [ ] **Step 10: Run the tests**

Run: `cargo nextest run -p redextape-core`
Expected: PASS, with the four new tests among them. If `an_error_expression_lowers_to_a_fault_rather_than_a_panic`
fails on the message not containing `$error`, read `RuntimeError`'s `Debug` shape and adjust the
assertion to name the field that carries the message — do not weaken it to `is_err()`, which would
pass against a `Core::Unit` arm only if evaluation failed for some other reason.

- [ ] **Step 11: Commit**

```bash
git add crates/redextape-core/src/
git commit -m "Add Stmt::Error and Expr::Error, and answer every arm they force

Thirteen arms across five files, each an answer rather than an assertion:
the variants are reachable only through parse_recovering, which does not
exist yet, and an unreachable panic in this crate is a panic in the
language server.

typeck gives an error expression a fresh type variable, the answer it
already gives an unbound variable, so a parse error does not also produce
a type error. desugar's expression arm lowers to Core::Var(\"\$error\"),
which faults at interp.rs:117 rather than panicking; Core has no fault
variant and adding one is a backend change. The printer echoes the source
span verbatim.

No parser produces either variant yet, so the tests build them by hand."
```

---

### Task 2: Recovery bookkeeping and the two-contract entry points

Establishes the plumbing the spec's §2 contract needs, with recovery still firing only at the
whole-file level. After this task `parse_full` behaves exactly as it does today and
`parse_recovering` exists and always returns a tree — an empty one, for now, whenever the parse fails.

**Files:**
- Modify: `crates/redextape-core/src/parser.rs:38-57` (entry points), `:76-82` (the `Parser` struct)
- Modify: `crates/redextape-core/src/lib.rs` (re-export)
- Test: `crates/redextape-core/src/parser.rs` test module

**Interfaces:**
- Consumes: `Stmt::Error`, `Expr::Error` from Task 1 (declared, not yet constructed here).
- Produces: `parser::parse_recovering(src: &str) -> (Parsed<'_>, Vec<Diagnostic>)`; `Parser::record(&mut self, d: Diagnostic)`; the `Parser` fields `diags: Vec<Diagnostic>` and `recovered: usize`. Tasks 3, 4 and 5 all call `record`.

- [ ] **Step 1: Write the failing tests**

In `crates/redextape-core/src/parser.rs`'s test module:

```rust
    #[test]
    fn parse_recovering_always_answers_a_tree_and_parse_full_only_answers_a_complete_one() {
        // BOTH HALVES ARE LOAD-BEARING. Without the clean-input half, a `parse_recovering` that
        // always returned an empty tree would satisfy the broken-input half.
        let clean = "let x = 1; x + 1";
        let (recovered, rd) = parse_recovering(clean);
        let (full, fd) = parse_full(clean);
        assert!(rd.is_empty() && fd.is_empty(), "clean input: {rd:?} {fd:?}");
        assert_eq!(recovered.program, full.expect("clean input parses").program, "same tree");

        let broken = "let x = ";
        let (_, rd) = parse_recovering(broken);
        let (full, fd) = parse_full(broken);
        assert!(full.is_none(), "parse_full must not hand a partial tree to `format`");
        assert!(!rd.is_empty() && !fd.is_empty(), "both report the error: {rd:?} {fd:?}");
    }

    #[test]
    fn diagnostics_come_back_ordered_by_span() {
        // The editor renders them in list order. Lexer diagnostics and parser diagnostics are
        // produced by two separate passes, so their concatenation is not sorted by construction.
        let (_, diags) = parse_recovering("let x = 1;\n@ y");
        assert!(
            diags.windows(2).all(|w| w[0].span.start <= w[1].span.start),
            "diagnostics out of order: {diags:?}"
        );
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo nextest run -p redextape-core parse_recovering_always_answers`
Expected: FAIL — `cannot find function 'parse_recovering' in this scope`.

- [ ] **Step 3: Add the bookkeeping fields and `record`**

In `crates/redextape-core/src/parser.rs`, replace the `Parser` struct (line 76) and add the cap:

```rust
/// Recovered constructs past which diagnostics stop being recorded.
///
/// Recovery itself does NOT stop — the tree stays as complete as it can be, because navigation
/// reads the tree and not the diagnostics. What stops is the reporting: `MAX_TOKENS` is 100,000 and
/// a file of pure garbage recovers at roughly one construct per token, which is 100,000 diagnostics
/// pushed to an editor that re-parses on every keystroke.
const MAX_RECOVERED_DIAGNOSTICS: usize = 100;

struct Parser<'a> {
    src: &'a str,
    tokens: Vec<Token>,
    pos: usize,
    depth: u32,
    /// Diagnostics recovery recorded rather than propagated through `PResult`.
    diags: Vec<Diagnostic>,
    /// How many times recovery fired. `parse_full` answers `None` when this is non-zero, which is
    /// the whole of the contract split — see the module's two entry points.
    recovered: usize,
}
```

Add to `impl Parser<'_>`, beside `expect`:

```rust
    /// Record a diagnostic recovery produced, and count the recovery.
    ///
    /// The COUNT is unconditional and the RECORDING is capped, so `parse_full`'s answer never
    /// depends on how many errors a file has — only on whether it had any.
    fn record(&mut self, d: Diagnostic) {
        self.recovered += 1;
        if self.recovered <= MAX_RECOVERED_DIAGNOSTICS {
            self.diags.push(d);
        }
    }

    /// Append the summary line when the cap suppressed anything. Called once, after parsing.
    fn finish_diagnostics(&mut self) {
        let Some(n) = self.recovered.checked_sub(MAX_RECOVERED_DIAGNOSTICS) else { return };
        if n == 0 {
            return;
        }
        let end = self.src.len();
        self.diags.push(Diagnostic::error(Span::new(end, end), format!("{n} further parse errors not reported")));
    }
```

- [ ] **Step 4: Split the entry points**

Replace `parse_full` (`parser.rs:38-57`) with three functions:

```rust
/// Parse `src`, keeping its trivia, and always answer a tree.
///
/// The tree may contain `Stmt::Error`/`Expr::Error` nodes marking source that did not parse. The
/// diagnostics say what went wrong.
///
/// **THIS IS NOT A REPLACEMENT FOR `parse_full`, IT IS THE OTHER HALF OF A SPLIT CONTRACT.**
/// `format` is `print ∘ parse`, so a `parse` that answered a partial tree would have `format` write
/// that tree back over the author's buffer and delete the part that did not parse. Consumers that
/// print, lower, or evaluate must keep going through `parse`/`parse_full`; this exists for
/// navigation, which is worth most on exactly the broken files those must refuse.
#[must_use]
pub fn parse_recovering(src: &str) -> (Parsed<'_>, Vec<Diagnostic>) {
    let (parsed, diags, _complete) = parse_inner(src);
    (parsed, diags)
}

/// Parse `src`, keeping its trivia. `Some` only when the entire input parsed.
///
/// `comments` is sorted by start offset and no comment overlaps a token, which is what lets the
/// printer walk it with a single forward cursor.
#[must_use]
pub fn parse_full(src: &str) -> (Option<Parsed<'_>>, Vec<Diagnostic>) {
    let (parsed, diags, complete) = parse_inner(src);
    if complete { (Some(parsed), diags) } else { (None, diags) }
}

/// The one parse. `bool` is whether it was complete — no lexer diagnostic, within `MAX_TOKENS`, and
/// no recovery.
fn parse_inner(src: &str) -> (Parsed<'_>, Vec<Diagnostic>, bool) {
    let (tokens, comments, lex_diags) = lex(src);
    let clean_lex = lex_diags.is_empty();
    let mut diags = lex_diags;
    let whole = Span::new(0, src.len());
    if tokens.len() > MAX_TOKENS {
        diags.push(Diagnostic::error(
            whole,
            format!("program too large: {} tokens exceeds the maximum of {MAX_TOKENS} (deeply nested or very long programs are rejected to avoid stack overflow)", tokens.len()),
        ));
        let program = Program { block: Block { stmts: Vec::new(), tail: None, span: whole } };
        return (Parsed { program, comments, src }, diags, false);
    }
    let mut p = Parser { src, tokens, pos: 0, depth: 0, diags: Vec::new(), recovered: 0 };
    // Task 3 replaces this with a `parse_program` that recovers per statement. Until then the
    // recovery granularity is the whole file: an error costs the tree, exactly as it does today.
    let program = match p.parse_program() {
        Ok(program) => program,
        Err(d) => {
            p.record(d);
            Program { block: Block { stmts: Vec::new(), tail: None, span: whole } }
        }
    };
    p.finish_diagnostics();
    let complete = clean_lex && p.recovered == 0;
    diags.extend(p.diags);
    // Two passes produce these — the lexer left to right, then the parser — so their concatenation
    // is not sorted by construction even though each half is.
    diags.sort_by_key(|d| d.span.start);
    (Parsed { program, comments, src }, diags, complete)
}
```

Add `Block` and `Program` to the `use crate::ast::{..}` line at the top of the file if they are not
already there — the current import is `use crate::ast::{BinOp, Block, Expr, Program, Stmt};`, so
both are present.

- [ ] **Step 5: Re-export from the crate root**

In `crates/redextape-core/src/lib.rs`, wherever `parser::parse` and `parser::parse_full` are
re-exported, add `parse_recovering` alongside them. If the module is re-exported wholesale
(`pub mod parser;`), no change is needed — confirm with:

Run: `git grep -n 'parse_full' crates/redextape-core/src/lib.rs`

- [ ] **Step 6: Run the tests**

Run: `cargo nextest run -p redextape-core`
Expected: PASS, including the two new tests. Every pre-existing test must still pass — this task
changes no tree behaviour, and a failure here means the contract split leaked.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/parser.rs crates/redextape-core/src/lib.rs
git commit -m "Split the parse contract: parse_recovering always answers a tree

One parse, two exit conditions. parse_inner does the work and reports
whether it was complete; parse_full answers None when it was not, which is
byte-identical to what it did before, and parse_recovering answers the tree
either way.

format is why the contract is split rather than widened: it is print of
parse, so a parse that answered a partial tree would have format write that
tree back over the author's buffer and delete what did not parse.

Recovery granularity here is still the whole file -- an error costs the
tree. Statement-level recovery is the next commit. What lands now is the
bookkeeping it needs: a recovered count, a diagnostic buffer, and a cap at
100 recorded diagnostics so a garbage file cannot push 100,000 of them at
an editor that re-parses on every keystroke."
```

---

### Task 3: Statement-level recovery

The core of the PR. `parse_block_body` stops propagating statement errors and instead records,
resyncs, and emits `Stmt::Error`. Three properties from spec §3 land here.

**Files:**
- Modify: `crates/redextape-core/src/parser.rs:107-142` (`parse_program`, `parse_block_body`), `:216-222` (`parse_braced_block_inner`)
- Modify: `crates/redextape-core/src/lib.rs:146-157` (the test §2 says moves)
- Test: `crates/redextape-core/src/parser.rs` test module

**Interfaces:**
- Consumes: `Parser::record` and the `recovered` counter from Task 2; `Stmt::Error` from Task 1.
- Produces: `Parser::resync(&mut self)`; `parse_block_body(&mut self, close: TokenKind) -> Block` (infallible — note the changed return type, which Task 5 relies on).

- [ ] **Step 1: Write the failing tests**

> **THE INPUTS BELOW WERE REASONED ABOUT, NOT RUN.** They were chosen by tracing a Pratt parser by
> hand, and a hand-traced input is a guess about which code path it takes. What settles it is step
> 8's sabotage runs, in this task: if disabling the mechanism a test names leaves that test green,
> the input does not reach the path and the input is what must change — never the assertion. Treat a
> green sabotage as a failing task, not a passing one. This repository's own record has three
> plan-authored tests that could not fail, all from exactly this.
>
> The red at step 2 does not substitute. It fires because recovery does not exist yet, which is a
> different reason from the one each test names.

```rust
    #[test]
    fn every_parse_error_is_reported_not_just_the_first() {
        // THE SHIPPING VALUE OF THIS PR. Three broken statements, three diagnostics, and the two
        // good statements around them survive.
        let src = "let a = ; let b = 1; let c = ; let d = 2; let e = ;";
        let (parsed, diags) = parse_recovering(src);
        assert_eq!(diags.len(), 3, "one per broken statement: {diags:?}");
        let good = parsed
            .program
            .block
            .stmts
            .iter()
            .filter(|s| matches!(s, Stmt::Let { name, .. } if name == "b" || name == "d"))
            .count();
        assert_eq!(good, 2, "the statements between the errors must survive");
    }

    #[test]
    fn recovery_makes_progress_on_a_token_it_cannot_start_a_statement_with() {
        // A stray `}` at top level starts no statement and `resync` returns on it without
        // consuming, so without the progress bump `parse_block_body` spins forever. With the
        // iteration bound in place the failure is a diagnostic rather than a hang, and this
        // asserts that bound never fires.
        let (_, diags) = parse_recovering("} } } let x = 1; x");
        assert!(
            !diags.iter().any(|d| d.message.contains("parser made no progress")),
            "the progress bump should have kept the bound from firing: {diags:?}"
        );
    }

    #[test]
    fn resync_skips_a_whole_nested_block_and_stops_at_its_end() {
        // A `fn` with no name fails BEFORE its body, so resync meets the body's braces. It must
        // consume the block whole and stop at the `}` that closes it — not stop at the `{`, and
        // not run past the `}` looking for a `;` that a braced construct never has. Either
        // mistake swallows `g`.
        let src = "fn (a) { 1; } fn g(b) { b }";
        let (parsed, _) = parse_recovering(src);
        let names: Vec<&str> = parsed
            .program
            .block
            .stmts
            .iter()
            .filter_map(|s| match s {
                Stmt::Fn { name, .. } => Some(name.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(names, vec!["g"], "the next function must survive recovery: {names:?}");
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo nextest run -p redextape-core every_parse_error_is_reported`
Expected: FAIL — the diagnostic count is 1, because recovery does not exist yet.

- [ ] **Step 3: Add `resync` and the iteration bound**

In `impl Parser<'_>`, beside `record`:

```rust
    /// Skip forward to just past the next `;`, or to the `}` or end of input that closes the
    /// construct recovery started inside — whichever comes first.
    ///
    /// **THE DEPTH COUNTER IS WHAT MAKES THIS SAFE INSIDE A NESTED BLOCK.** Without it,
    /// `fn f(a) { if a > @ { 1 } else { 2 } }` resyncs on the `if`'s closing brace and resumes
    /// parsing mid-function, so every construct after it is read in the wrong context.
    ///
    /// Consumes nothing at `Eof` or at a `}` belonging to an enclosing block, which is what leaves
    /// the enclosing `parse_block_body` free to see its own close token. That also means resync can
    /// return without advancing, which is why its caller carries the progress rule.
    fn resync(&mut self) {
        let mut depth = 0usize;
        loop {
            match self.peek().kind {
                TokenKind::Eof => return,
                TokenKind::LBrace => {
                    depth += 1;
                    self.bump();
                }
                TokenKind::RBrace => {
                    if depth == 0 {
                        return;
                    }
                    depth -= 1;
                    self.bump();
                    // A block closing back to the depth we started at IS a statement boundary.
                    // Without this, `fn (a) { 1; }` — which fails at the missing name, before its
                    // body — resyncs past the body's `}` and then keeps going, because there is no
                    // `;` after a braced construct. It would eat every following declaration.
                    if depth == 0 {
                        return;
                    }
                }
                TokenKind::Semi if depth == 0 => {
                    self.bump();
                    return;
                }
                _ => {
                    self.bump();
                }
            }
        }
    }
```

- [ ] **Step 4: Restructure `parse_block_body`**

Replace `parse_program` and `parse_block_body` (`parser.rs:107-142`):

```rust
    fn parse_program(&mut self) -> Program {
        let mut block = self.parse_block_body(TokenKind::Eof);
        // `parse_block_body`'s `Tail` arm can break its loop on a token that is not `close` (a tail
        // expression not followed by `;` stops the loop, not the input), and every OTHER exit is
        // followed by a caller-side `expect(close)` that turns leftover tokens into a recorded
        // diagnostic — except this one, the top level, which has no such caller. Without this check
        // trailing tokens are silently dropped and the parse reports as complete. `bump` never
        // advances past `Eof`, so the absorbing loop below always terminates.
        if self.peek().kind != TokenKind::Eof {
            let start = self.peek().span;
            let mut end = start;
            while self.peek().kind != TokenKind::Eof {
                end = self.bump().span;
            }
            let span = start.merge(end);
            self.record(Diagnostic::error(start, "expected end of input"));
            block.stmts.push(Stmt::Error { span });
            block.span = block.span.merge(span);
        }
        Program { block }
    }

    /// What one turn of the statement loop produced.
    fn parse_block_item(&mut self) -> PResult<BlockItem> {
        match self.peek().kind {
            TokenKind::Let => return Ok(BlockItem::Stmt(self.parse_let()?)),
            TokenKind::Fn => return Ok(BlockItem::Stmt(self.parse_fn()?)),
            TokenKind::While => return Ok(BlockItem::Stmt(self.parse_while()?)),
            _ => {}
        }
        // An identifier followed by `=` is an assignment statement.
        if self.peek().kind == TokenKind::Ident && self.tokens[self.pos + 1].kind == TokenKind::Assign {
            return Ok(BlockItem::Stmt(self.parse_assign()?));
        }
        let e = self.parse_expr()?;
        if self.peek().kind == TokenKind::Semi {
            self.bump();
            Ok(BlockItem::Stmt(Stmt::Expr(e)))
        } else {
            Ok(BlockItem::Tail(e))
        }
    }

    /// Parse statements + optional tail until (but not consuming) `close`, or until end of input.
    ///
    /// **INFALLIBLE, AND THAT IS THE RECOVERY.** A statement that does not parse becomes a
    /// `Stmt::Error` and the loop carries on, so one bad line costs one line rather than the file.
    /// Stopping at `Eof` as well as at `close` is what keeps an unclosed block's body: the caller
    /// records the missing brace instead of propagating an error that would discard everything
    /// collected here.
    fn parse_block_body(&mut self, close: TokenKind) -> Block {
        let start = self.peek().span;
        let mut stmts = Vec::new();
        let mut tail = None;
        // A statement loop cannot legitimately run more times than there are tokens. Exceeding that
        // turns a hang into a diagnostic, the same shape `MAX_TOKENS` and `MAX_PARSE_DEPTH` use.
        let bound = self.tokens.len() + 1;
        let mut turns = 0usize;
        while self.peek().kind != close && self.peek().kind != TokenKind::Eof {
            turns += 1;
            if turns > bound {
                self.record(Diagnostic::error(self.peek().span, "parser made no progress"));
                break;
            }
            let before = self.pos;
            match self.parse_block_item() {
                Ok(BlockItem::Stmt(s)) => stmts.push(s),
                Ok(BlockItem::Tail(e)) => {
                    tail = Some(Box::new(e));
                    break;
                }
                Err(d) => {
                    self.record(d);
                    self.resync();
                    // `resync` returns without advancing at a `}` that closes an enclosing block,
                    // and `parse_block_item` can fail without consuming (the depth guard does).
                    // One bump is what guarantees the loop terminates.
                    if self.pos == before {
                        self.bump();
                    }
                    let end = self.tokens[self.pos.saturating_sub(1).max(before)].span;
                    stmts.push(Stmt::Error { span: self.tokens[before].span.merge(end) });
                }
            }
        }
        let end = self.peek().span;
        Block { stmts, tail, span: start.merge(end) }
    }
```

Add the helper enum beside `PResult` (near `parser.rs:83`):

```rust
/// One turn of `parse_block_body`'s loop: a statement, or the block's tail expression.
enum BlockItem {
    Stmt(Stmt),
    Tail(Expr),
}
```

- [ ] **Step 5: Update `parse_braced_block_inner` for the new return type**

`parse_block_body` is now infallible, so drop the `?` (`parser.rs:216-222`). Task 5 replaces the
`expect` below it; leave it propagating for now:

```rust
    fn parse_braced_block_inner(&mut self) -> PResult<Block> {
        self.expect(TokenKind::LBrace, "`{`")?;
        let block = self.parse_block_body(TokenKind::RBrace);
        self.expect(TokenKind::RBrace, "`}`")?;
        Ok(block)
    }
```

And in `parse_inner` (Task 2, step 4), replace the `match p.parse_program()` block, since
`parse_program` no longer returns a `Result`:

```rust
    let program = p.parse_program();
```

- [ ] **Step 6: Update the test §2 says moves**

`crates/redextape-core/src/lib.rs:146` asserts a single diagnostic for `"(1 + 2"`. That input now
reports more than one. Change the assertion to name the property rather than the count, and say why:

```rust
    #[test]
    fn analyze_reports_parse_errors_with_spans() {
        let src = "(1 + 2";
        let a = analyze(src);
        assert!(a.core.is_none());
        // NOT A COUNT. Recovery reports every parse error rather than only the first, so the number
        // here is a property of how many times recovery fires on this input — which is an
        // implementation detail of the resync rule, not a contract. What IS the contract is that
        // the missing `)` is reported, with a span inside the source.
        assert!(!a.diagnostics.is_empty());
        assert!(a.diagnostics.iter().any(|d| d.message.contains(')')), "{:?}", a.diagnostics);
        let span = a.diagnostics[0].span;
        assert!(span.start <= span.end && span.end <= src.len(), "span out of bounds: {span:?}");
    }
```

- [ ] **Step 7: Run the whole suite**

Run: `cargo nextest run --workspace`
Expected: PASS. Other tests may also have pinned single-diagnostic counts on broken `.rxt` input —
fix each the same way, by asserting the property rather than the count, and never by weakening an
assertion that was about something else.

- [ ] **Step 8: Run this task's two sabotages and capture their output**

The red at step 2 was the wrong red: it fires because recovery does not exist at all, which says
nothing about whether these inputs reach the mechanisms they name. Each sabotage is a one-line edit,
a test run, and a `git checkout` to undo it.

```bash
# Sabotage A: delete the progress bump in parse_block_body's Err arm
#   (the `if self.pos == before { self.bump(); }`)
cargo nextest run -p redextape-core recovery_makes_progress 2>&1 | tail -5
# Expected: FAIL on "parser made no progress" -- the iteration bound firing.
git checkout crates/redextape-core/src/parser.rs

# Sabotage B: neuter resync's depth counter
#   (in the LBrace arm, replace `depth += 1;` with nothing, keeping the bump)
cargo nextest run -p redextape-core resync_skips_a_whole_nested_block 2>&1 | tail -5
# Expected: FAIL -- `names` is empty or does not equal ["g"].
git checkout crates/redextape-core/src/parser.rs
```

**A sabotage that leaves its test GREEN is this task's finding, not a formality.** It means the input
does not reach the path the test names, and the INPUT is what changes — never the assertion. Report
the actual output of both runs. If either stays green, find an input that makes it fail and say in
the report what the original input actually exercised.

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-core/src/parser.rs crates/redextape-core/src/lib.rs
git commit -m "Recover per statement, so one bad line costs one line

parse_block_body no longer propagates a statement error. It records the
diagnostic, resyncs to the next semicolon or closing brace at the depth it
started from, and emits a Stmt::Error spanning what it skipped.

Three properties hold it up. resync counts brace depth, so a nested block's
closing brace is not mistaken for the end of the statement containing it.
The loop bumps once when a turn consumed nothing, because resync returns
without advancing at a brace that closes an enclosing block and the depth
guard fails without consuming at all. And a turn counter bounded by the
token count turns a hang into a diagnostic, the shape MAX_TOKENS and
MAX_PARSE_DEPTH already use -- a progress bug that hangs a suite is worse
than one that fails it.

analyze_reports_parse_errors_with_spans asserted a diagnostic count of one.
It now asserts the property it was really about: the missing paren is
reported, with an in-bounds span. The count was an implementation detail of
the resync rule."
```

---

### Task 4: `Expr::Error`, so a broken value still binds its name

`let x = @@@;` must leave `x` navigable. That needs `parse_let` and `parse_assign` to recover their
value expression instead of propagating.

**Files:**
- Modify: `crates/redextape-core/src/parser.rs:144-186` (`parse_let`, `parse_assign`)
- Test: `crates/redextape-core/src/parser.rs` test module

**Interfaces:**
- Consumes: `Parser::record` (Task 2); `Expr::Error` (Task 1).
- Produces: `Parser::parse_expr_recovering(&mut self) -> Expr` and `Parser::expect_or_record(&mut self, kind: TokenKind, what: &str) -> Span`. Task 5 calls `expect_or_record`.

- [ ] **Step 1: Write the failing test**

```rust
    #[test]
    fn a_binding_whose_value_does_not_parse_still_binds_its_name() {
        // THE REASON Expr::Error EXISTS. `@@@` is skipped by the lexer, so the parser meets
        // `let x = ;` and has nothing to put in `value`. Dropping the statement would lose `x` --
        // which is the name under the cursor at the moment someone is typing its value.
        let (parsed, diags) = parse_recovering("let x = @@@; let y = 2; x + y");
        assert!(!diags.is_empty(), "the broken value must be reported");
        let bound: Vec<&str> = parsed
            .program
            .block
            .stmts
            .iter()
            .filter_map(|s| match s {
                Stmt::Let { name, .. } => Some(name.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(bound, vec!["x", "y"], "both bindings survive: {bound:?}");
    }

    #[test]
    fn the_error_expression_spans_the_source_that_did_not_parse() {
        // A zero-width span would make the node invisible to anything that locates by offset, and
        // an over-wide one would swallow the neighbours. `let x = ;` -- the `;` is where an
        // expression was expected, at offsets 8..9.
        let (parsed, _) = parse_recovering("let x = ;");
        let value_span = parsed.program.block.stmts.iter().find_map(|s| match s {
            Stmt::Let { value: Expr::Error { span }, .. } => Some(*span),
            _ => None,
        });
        assert_eq!(value_span, Some(Span::new(8, 9)), "the span should cover the `;` it found instead");
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo nextest run -p redextape-core a_binding_whose_value_does_not_parse`
Expected: FAIL — the statement becomes a `Stmt::Error` and no `Stmt::Let` survives, so `bound` is empty.

- [ ] **Step 3: Add the two helpers**

In `impl Parser<'_>`, beside `resync`:

```rust
    /// `expect`, but a mismatch is recorded rather than propagated. Answers the span the construct
    /// should end at: the matched token's, or the current token's when nothing matched.
    ///
    /// Recording here counts a recovery, so `parse_full` still answers `None` for the file.
    fn expect_or_record(&mut self, kind: TokenKind, what: &str) -> Span {
        let t = self.peek();
        if t.kind == kind {
            self.bump().span
        } else {
            self.record(Diagnostic::error(t.span, format!("expected {what}")));
            t.span
        }
    }

    /// Parse an expression, or record the failure and answer an `Expr::Error` covering what was
    /// consumed trying.
    ///
    /// **DOES NOT RESYNC.** The statement that called this owns the resync rule, and skipping ahead
    /// here would eat the `;` the caller is about to expect. When nothing was consumed the span
    /// covers the offending token itself, so the node is never zero-width.
    fn parse_expr_recovering(&mut self) -> Expr {
        let before = self.pos;
        match self.parse_expr() {
            Ok(e) => e,
            Err(d) => {
                self.record(d);
                let end = self.tokens[self.pos.saturating_sub(1).max(before)].span;
                Expr::Error { span: self.tokens[before].span.merge(end) }
            }
        }
    }
```

**Superseded by `c32b9e3`.** The claim above — that the node is never zero-width because the span
covers the offending token itself — was already false at `Eof`, where nothing can follow and the span
is zero-width by construction. It also produced a live defect this code as drafted does not show:
answering the *full* span of a token that was never consumed let a construct claim source a following
sibling also claimed, e.g. `"let x =\nlet y = 1;\ny"` gave `Let(x)` the span `0..11`
("let x =\nlet"), overlapping the following `Let(y)`. The fix, shipped in `c32b9e3`, answers a
zero-width span at the unconsumed token's start instead of its full span whenever nothing was
consumed — a zero-width span is now the deliberate, correct answer in exactly that case, the reverse
of what this section claimed. See `parser.rs`'s current doc comment on `parse_expr_recovering` for the
shipped rule and the fixture that pins it.

- [ ] **Step 4: Use them in `parse_let` and `parse_assign`**

```rust
    fn parse_let(&mut self) -> PResult<Stmt> {
        let kw = self.expect(TokenKind::Let, "`let`")?;
        let mutable = if self.peek().kind == TokenKind::Mut {
            self.bump();
            true
        } else {
            false
        };
        // Still propagating: with no name there is no binding to salvage, and the statement is a
        // `Stmt::Error` in full. Everything after this point recovers in place.
        let name_tok = self.expect(TokenKind::Ident, "a variable name")?;
        let name = self.text(name_tok.span);
        self.expect(TokenKind::Assign, "`=`")?;
        let value = self.parse_expr_recovering();
        let semi = self.expect_or_record(TokenKind::Semi, "`;`");
        Ok(Stmt::Let { name, mutable, value, span: kw.span.merge(semi) })
    }

    fn parse_assign(&mut self) -> PResult<Stmt> {
        let name_tok = self.bump(); // Ident (checked by caller)
        let target = self.text(name_tok.span);
        self.expect(TokenKind::Assign, "`=`")?;
        let value = self.parse_expr_recovering();
        let semi = self.expect_or_record(TokenKind::Semi, "`;`");
        Ok(Stmt::Assign { target, value, span: name_tok.span.merge(semi) })
    }
```

- [ ] **Step 5: Run the tests**

Run: `cargo nextest run --workspace`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/parser.rs
git commit -m "A binding whose value does not parse still binds its name

let and assignment recover their value expression into Expr::Error instead
of propagating, and record a missing semicolon instead of failing on it. So
`let x = @@@;` keeps x -- the name under the cursor at the moment someone
is typing its value, which is exactly when navigation is asked for.

parse_expr_recovering deliberately does not resync: the statement owns that
rule, and skipping ahead here would eat the semicolon the caller is about
to expect. When nothing was consumed the error span covers the offending
token rather than being zero-width, so the node stays locatable by offset.

The name itself still propagates. With no name there is no binding to
salvage and the whole statement is a Stmt::Error."
```

---

### Task 5: An unclosed block keeps its body

The property spec §3.3 says the whole option turns on, and the one Tasks 3 and 4 do not produce.

**Files:**
- Modify: `crates/redextape-core/src/parser.rs:216-222` (`parse_braced_block_inner`)
- Test: `crates/redextape-core/src/parser.rs` test module

**Interfaces:**
- Consumes: `expect_or_record` (Task 4); the `Eof`-terminating `parse_block_body` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```rust
    #[test]
    fn an_unclosed_block_keeps_the_body_it_collected() {
        // THE CASE THE WHOLE RECOVERY DESIGN TURNS ON. parse_block_body consumes to end of input
        // looking for its `}`, so everything after the brace belongs to the statement that then
        // fails. Propagating that failure discards the file from the brace onward -- and a brace
        // still open is what a buffer looks like while its author is inside the function.
        let (parsed, diags) = parse_recovering("fn f(a) { let y = 1;");
        assert!(!diags.is_empty(), "the missing `}` must be reported");
        let body_names: Vec<&str> = parsed
            .program
            .block
            .stmts
            .iter()
            .filter_map(|s| match s {
                Stmt::Fn { name, body, .. } if name == "f" => Some(body),
                _ => None,
            })
            .flat_map(|b| {
                b.stmts.iter().filter_map(|s| match s {
                    Stmt::Let { name, .. } => Some(name.as_str()),
                    _ => None,
                })
            })
            .collect();
        // Asserting the BINDING and not the diagnostic count is what makes this test able to fail:
        // a scheme that reported the missing brace and then threw the body away satisfies the
        // assertion above and not this one.
        assert_eq!(body_names, vec!["y"], "the body's bindings must survive: {body_names:?}");
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo nextest run -p redextape-core an_unclosed_block_keeps_the_body`
Expected: FAIL — `body_names` is empty, because `expect(RBrace)` propagates and the outer loop turns
the whole `fn` into a `Stmt::Error`.

- [ ] **Step 3: Record the missing brace instead of propagating**

```rust
    fn parse_braced_block_inner(&mut self) -> PResult<Block> {
        // Still propagating: with no `{` there is no block, and the construct is a `Stmt::Error`.
        self.expect(TokenKind::LBrace, "`{`")?;
        let block = self.parse_block_body(TokenKind::RBrace);
        // **NOT `?`.** `parse_block_body` consumes to end of input looking for this brace, so
        // everything it collected belongs to the statement that would fail here. Propagating
        // discards the file from an unclosed brace onward, and an unclosed brace is what a buffer
        // looks like while its author is still inside the function.
        self.expect_or_record(TokenKind::RBrace, "`}`");
        Ok(block)
    }
```

- [ ] **Step 4: Run the whole suite**

Run: `cargo nextest run --workspace`
Expected: PASS.

- [ ] **Step 5: Run this task's sabotage and capture its output**

```bash
# Restore `?` on parse_braced_block_inner's closing brace:
#   self.expect(TokenKind::RBrace, "`}`")?;
cargo nextest run -p redextape-core an_unclosed_block_keeps_the_body 2>&1 | tail -5
# Expected: FAIL -- body_names is empty.
git checkout crates/redextape-core/src/parser.rs
```

A green sabotage means the test does not check what it claims. Fix the test — never the assertion's
expected value — before committing, and report what the original input actually exercised.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/parser.rs
git commit -m "An unclosed block keeps the body it collected

parse_block_body consumes to end of input looking for its closing brace, so
everything after an unclosed one belongs to the statement that then fails.
Propagating that failure discarded the file from the brace onward.

It now records the missing brace and answers the block it collected. A
brace still open is what a buffer looks like while its author is inside the
function they are writing, which is the state navigation is asked for most.

The opening brace still propagates: with no `{` there is no block."
```

---

### Task 6: Sabotage verification and the storm cap end to end

Nothing new ships here. This task runs the sabotages spec §6 names and records their output, and
covers the one behaviour no earlier task exercised.

**Files:**
- Test: `crates/redextape-core/src/parser.rs` test module
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the entry this PR needs before it opens)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Write the two uncovered tests**

```rust
    #[test]
    fn the_diagnostic_cap_bounds_the_report_without_bounding_the_recovery() {
        // BOTH HALVES. A cap that also stopped recovering would answer a truncated tree, and
        // navigation reads the tree. 300 broken statements, capped at 100 reports plus one
        // summary, and every one of the 300 still present in the tree.
        let src = "let a = ; ".repeat(300);
        let (parsed, diags) = parse_recovering(&src);
        assert_eq!(diags.len(), MAX_RECOVERED_DIAGNOSTICS + 1, "100 reports and one summary: {}", diags.len());
        assert!(
            diags.last().is_some_and(|d| d.message.contains("further parse errors not reported")),
            "the summary must say how many were suppressed: {:?}",
            diags.last()
        );
        assert_eq!(parsed.program.block.stmts.len(), 300, "recovery itself must not stop at the cap");
    }

    #[test]
    fn format_never_sees_a_recovered_tree() {
        // Asserted at `format`'s own level, not by reasoning about parse_full's callers. This is
        // the property that keeps a recovered tree from being written back over the author's
        // buffer with the unparsed part deleted.
        assert!(crate::format("let x = ").is_err());
        assert!(crate::format("fn f(a) { let y = 1;").is_err());
        assert!(crate::format("let x = @@@;").is_err());
        // And the converse, so the assertions above are not passing because `format` rejects
        // everything.
        assert!(crate::format("let x = 1; x").is_ok());
    }
```

- [ ] **Step 2: Run them**

Run: `cargo nextest run -p redextape-core the_diagnostic_cap format_never_sees`
Expected: PASS. If the cap test reports 101 where it expected something else, read
`MAX_RECOVERED_DIAGNOSTICS` rather than editing the expectation to match the output.

- [ ] **Step 3: Confirm the earlier sabotages are on the record**

The three recovery-property sabotages run in the tasks that write their tests — two in Task 3 step 8,
one in Task 5 step 5. Read those task reports and confirm each records the actual command output and
a genuine FAIL. A sabotage reported as "expected to fail" without its output is not evidence; send
that task back rather than accepting it here.

- [ ] **Step 4: Run the full local gate**

Run: `scripts/check-all.sh`
Expected: green across all three tiers.

Run: `cargo tree -p redextape-core --edges normal`
Expected: one line — the crate itself. This PR adds no dependency.

- [ ] **Step 5: Write the roadmap entry**

A substantive PR needs its roadmap entry in `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`
before it opens. Follow the shape of the entries above it: what shipped, what the reviews found,
`##### WHAT STAYS OPEN`, and a `##### VERIFICATION` block.

Every VERIFICATION figure names the command that produced it and is measured fresh — not carried
from any task report. Anchor the two git figures to a SHA rather than to `HEAD`, and state the
Markdown-only property that keeps the rest invariant. At minimum:

```
<n>                     commits                       git rev-list --count main..<sha>
<n> files, +<a>/-<b>    whole-branch diff             git diff --shortstat main..<sha>
<n> passed, <n> skipped workspace                     cargo nextest run --workspace
<n>% lines              coverage, floor 90 [exit 0]   cargo llvm-cov nextest --workspace
                                                        --fail-under-lines 90
itself and nothing else redextape-core's dependencies cargo tree -p redextape-core --edges normal
green, all three tiers  the full local gate           scripts/check-all.sh
```

WHAT STAYS OPEN must carry, at least: that `.rxlambda` still has no recovery and no navigation; that
B2 owns name spans, the binder pass and `nav_rxt`; and that the binder pass must be **iterative**,
because `lints.rs`'s recursive walk is safe only behind typeck's `MAX_TYPE_DEPTH` gate and a
navigation pass runs before typechecking.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/parser.rs docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Cover the storm cap and the format boundary, and record the sabotages

The cap test asserts both halves: 100 reports plus a summary, and all 300
recovered statements still in the tree. A cap that also stopped recovering
would answer a truncated tree, and navigation reads the tree.

format_never_sees_a_recovered_tree asserts the boundary at format's own
level rather than by reasoning about parse_full's callers, and asserts the
converse so it cannot pass by rejecting everything.

Roadmap entry, with every VERIFICATION figure measured fresh and named
with its command."
```

---

## Self-Review

**Spec coverage.** §1 blocker → Tasks 3-5. §2 two contracts → Task 2, asserted again in Task 6.
§3.1 progress → Task 3 (bump + iteration bound). §3.2 nesting → Task 3 (`resync`'s depth counter).
§3.3 unclosed block → Task 5. §4 variants and fourteen arms → Task 1, one step per file. §5 cap →
Task 2 implements, Task 6 covers. §6 testing → distributed, with the sabotages in Task 6. §7 what B2
inherits → Task 6's roadmap entry. §8 exclusions → the Global Constraints.

**One place this plan is more precise than the spec.** Spec §4's prose says desugar "answers
`Core::Var(id, "$error")`". That is one of its four arms. `lower_stmts_at` answers `acc` unchanged, and
`free_member_refs` answers by not descending in each of its two walks — the expression walk and the
statement walk, which needs its own arm for the same reason the expression walk does — because none of
the three is in a position that must produce a value. The spec's table was corrected to match in
commit `e517485` and again in this correction pass, which added the statement walk this plan itself had
never mentioned; the prose still reads as though desugar had one arm, and Task 1 step 6 is the
authority.

**THE ONE DEFECT THIS SELF-REVIEW MISSED, RECORDED AFTER IT SHIPPED.** Task 3's `parse_program`
above originally read `let block = self.parse_block_body(TokenKind::Eof); Program { block }` — the
`expect(Eof)` the old code ended with was dropped when `parse_block_body` became infallible, and
nothing replaced it. `parse_block_body`'s `Tail` arm breaks its loop on a token that is not `close`,
so trailing tokens were discarded with no `record()` call, `recovered` stayed 0, and `parse_full`
answered `Some` for a tree that had lost source. `format("1 2")` answered `Ok("1\n")`. An exhaustive
sweep found 3724 of 30941 token sequences of length ≤ 4 losing source.

**That is the exact failure the whole design exists to prevent, in the task whose brief opens by
naming it as the single point of failure.** The code above is corrected. What it cost to find was a
review that ran `format` rather than reading it — the path is not visibly wrong, and no amount of
re-reading the diff would have surfaced it. Every claim in this plan about what a code path does is
the same kind of claim, and only the executed ones are evidence.

**The largest risk, and it is in the test inputs rather than the implementation.** Every recovery
test's input was chosen by tracing the parser by hand. Writing the self-review surfaced two of these
as wrong before they shipped: the original nesting test used `fn f(a) { if a > @ { 1 } else { 2 } }`,
whose `{ 1 }` the atom parser may take as a block expression rather than an `if` arm, so what it
actually exercises is unknown; and tracing the replacement found that `resync` as first drafted ran
past a closed block looking for a `;` that a braced construct never has, swallowing every following
declaration — a defect in the mechanism, found only by trying to predict a test's output. Both are
fixed above. What is NOT fixed is that the remaining inputs carry the same provenance. The sabotages
are the only thing that converts them from guesses into evidence, which is why each runs in the task
that writes its test (Task 3 step 8, Task 5 step 5) and why a green sabotage is a finding rather than
a formality. They sat in Task 6 in the first draft of this plan; a task reviewer gating Tasks 3-5
would then have been approving tests whose coverage nothing had confirmed, and a green sabotage would
have sent the work back three tasks.

**One risk this plan does not remove.** Task 3 step 7 says other tests may have pinned
single-diagnostic counts on broken `.rxt` input. Which tests those are is not enumerated here,
because the set depends on how many diagnostics each input recovers into — a number the resync rule
decides. The instruction is to fix each by asserting the property rather than the count. An
implementer who instead edits an expected count to match observed output has replaced a test with a
transcript.

**Type consistency.** `parse_recovering` returns `(Parsed<'_>, Vec<Diagnostic>)` in Tasks 2, 3, 4, 5
and 6. `parse_block_body` returns `Block` from Task 3 onward and every later caller is updated in the
task that changes it. `expect_or_record` returns `Span` and is introduced in Task 4 before Task 5
uses it. `record` takes `Diagnostic` and returns nothing throughout.
