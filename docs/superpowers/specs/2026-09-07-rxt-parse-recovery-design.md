# Parse recovery for `.rxt` — design

**PR B1 of the LSP track's third slice.** The navigation design
(`2026-09-06-lsp-navigation-design.md`) named one remaining PR, "PR B — `.rxt` navigation", and
scoped it as span plumbing plus a binder-resolution pass. Working through it produced a blocker that
design did not see, and this spec is the PR that clears it.

Two PRs, and this one is the first:

| PR | what | touches |
|---|---|---|
| B1 | Parse recovery for `.rxt`, and every parse error reported instead of only the first | `redextape-core` (`ast`, `parser`, `typeck`, `lints`, `desugar`, `printer`) |
| B2 | Name spans, the binder-resolution pass, `nav_rxt`, and the LSP dispatch arm | `redextape-core`, `redextape-lsp` |

**B1 ships user-visible value on its own, but not through `parse_recovering`.** `analyze` calls
`parser::parse`, which is `parse_full`, which shares `parse_inner` with `parse_recovering` — so the
resync/progress/unclosed-block machinery runs on every `.rxt` parse regardless of which entry point is
called, and `Language::diagnostics` (which already exists and already routes `.rxt` through `analyze`)
now receives every parse error `parse_inner` recorded instead of only the first. `parse_recovering`
itself has no caller anywhere outside this module's own tests, so by the ordinary meaning of the term
it IS dead code in B1 — its consumer, PR B2's navigation index, does not exist yet. The two claims were
conflated: the visible diagnostics improvement is `parse_inner`'s recovery reaching `analyze` through
`parse_full`, which is a different fact from `parse_recovering` having a caller.

---

## §1 The blocker, verified against the tree — as of `fe3d34b`

**`.rxt` has no parse recovery, and the two artifact forms do.** `parse_full` (`parser.rs:38`)
returns `Some(program)` only when the entire input parsed — it bails on the first lexer diagnostic
at line 40 and on the first parser error at line 53. `parse_tm_full` and `parse_asm_full` both
recover and hand back a partial document, which is why PR #80's navigation answers on a `.tm` file
under active editing.

**That collides head-on with the reason navigation exists.** `nav.rs`'s module doc states the
property this slice is built around: *"The moment navigation is worth most is the moment the file is
broken, because that is what a file under active editing is."* A `.rxt` navigation index built from
`parse` would be empty for exactly the buffers it is meant to serve.

**The lexer already recovers; only the parser does not.** `lexer.rs:67` emits one diagnostic per
unknown character and skips it, still returning a complete token stream. `parse_full` discards that
stream wholesale at line 40. So recovery is a parser-level change, and the scanner half of it is
already written and already tested (`unknown_char_becomes_a_diagnostic_and_is_skipped`).

**And the failure mode of NOT recovering is worse than one missing statement.** `parse_fn` calls
`parse_block_body(TokenKind::RBrace)` (`parser.rs:114`), whose loop consumes statements until it
sees its close token. Given `fn f(a) {` with no closing brace, that loop consumes the rest of the
file into the function's body and then fails on the missing `}`. Everything it accumulated belongs
to the statement that failed. A recovery scheme that discards a failed statement therefore discards
the file from that brace onward — and an unclosed brace is not an edge case, it is the state of
every buffer while its author is inside a function they are still writing.

---

## §2 One parser, two contracts

Recovery always runs inside the parser. There is no mode flag, no second parser and no second
grammar. What differs between the two entry points is only the exit condition:

```rust
/// Always a tree. The tree may contain `Stmt::Error`/`Expr::Error` nodes.
pub fn parse_recovering(src: &str) -> (Parsed<'_>, Vec<Diagnostic>)

/// `None` unless the parse was complete — byte-identical to today's behaviour.
pub fn parse_full(src: &str) -> (Option<Parsed<'_>>, Vec<Diagnostic>)
```

`parse_full` is `parse_recovering` plus one test: it answers `None` when the parser recovered even
once. `parse` stays `parse_full` with the trivia dropped, exactly as it is today.

**The reason the contract is split rather than widened is `format`.** `redextape_core::format` is
`print ∘ parse`. A `parse` that returned a partial tree would give `format` a tree missing the
statements that did not parse, and `format` would write it back over the user's buffer — deleting
their unparsed code. That is the same class of defect PR #77 shipped, where formatting a
hand-written `.tm` deleted every comment in it. Splitting the contract means `format` cannot reach a
recovered tree at all, rather than being trusted to check a flag.

**Nothing that consumes a TREE changes.** `format`, `analyze`'s desugar path, `typecheck`,
`lints::check`, the printer, `redextape-wasm`'s session and `redextape-cli` all call `parse` or
`parse_full` and all keep receiving exactly what they receive today: `Some` for a complete parse,
`None` otherwise.

**Something that consumes DIAGNOSTICS does change, and that change is the point of this PR.** A
`.rxt` file with three parse errors currently reports one, because the parser stops at the first.
After this PR it reports three, through the same `analyze` → `Language::diagnostics` path that
already exists. This is a visible behaviour change and existing tests move with it —
`lib.rs:150`'s `assert_eq!(a.diagnostics.len(), 1)` among them. The claim this section makes is
about the tree, not about the diagnostics, and is written that way because the two were conflated in
the discussion that produced this spec.

---

## §3 Recovery mechanics

Recovery does not fire at one place. `Parser::record` — the point where a diagnostic actually gets
recorded and counted — has five call sites across four functions: `parse_program`'s trailing-token
absorb, `expect_or_record`, `parse_expr_recovering`, and `parse_block_body`'s statement loop, which
calls it twice (once when the iteration bound fires, once per recovered statement). What IS true is
that `parse_block_body`'s statement loop is the one place that resyncs and emits `Stmt::Error`, and the
three properties below are properties of that loop specifically, each pinned by a test rather than by
care.

### §3.1 Progress

`parse_block_body` loops `while self.peek().kind != close`. A recovery step that consumes no token
leaves the parser at the same position with the same lookahead, and the loop spins forever.

The rule: record `self.pos` at the top of each iteration; if the iteration ends — through recovery
or otherwise — with `self.pos` unmoved and the parser not at `close` or `Eof`, `bump()` once.

**A broken progress rule hangs rather than fails, so the test cannot be the only thing holding it
up.** The loop also carries a hard iteration bound: a statement loop can never legitimately run more
times than there are tokens, so exceeding `tokens.len()` iterations pushes a diagnostic and stops.
That is this crate's established shape for turning an uncatchable failure into a `Diagnostic` —
`MAX_TOKENS` (`parser.rs:16`) and `MAX_PARSE_DEPTH` (`parser.rs:74`) both exist for the same reason,
each named in its own doc comment as a guard against a native stack overflow rather than as a
grammar limit.

With the bound in place the test is an ordinary one: it asserts that the diagnostic the bound
produces is *absent* for an input that reproduces the no-progress case. Delete the `bump()` and the
test fails on a diagnostic instead of hanging a suite.

### §3.2 Nesting

Resync skips forward to the next `;` or `}` **at the brace depth recovery started from**. A `}`
closing a block nested inside the failed statement must not be taken for the end of that statement.
Without the depth counter, `fn f(a) { if x { } @@@ }` resyncs on the `if`'s closing brace and
resumes parsing mid-function.

### §3.3 An unclosed block keeps its body

This is the property §1 says the whole option turns on, and it needs its own rule because §3.1 and
§3.2 do not produce it.

`parse_block_body` terminates at `close` **or at `Eof`**. A caller whose subsequent
`expect(RBrace)` then fails records the diagnostic and emits its node carrying the block it
collected, instead of propagating an `Err` that discards it. So `fn f(a) { let y = 1;` at end of
input yields `Stmt::Fn { name: "f", params: ["a"], body: Block { stmts: [Let { y }] } }` plus one
diagnostic naming the missing `}`.

Without this rule, option A's error nodes still leave the unclosed-brace case behaving exactly like
the drop-the-statement scheme it was chosen over — the body is collected, and then thrown away one
frame up.

---

## §4 The two variants, and the fourteen arms they force

```rust
pub enum Stmt { Let {..}, Fn {..}, Assign {..}, While {..}, Expr(Expr), Error { span: Span } }
pub enum Expr { .., Error { span: Span } }
```

Both are needed. `Stmt::Error` covers a statement whose leading token gave the parser nothing to
build on; `Expr::Error` is what lets `let x = @@@;` still bind `x`, by giving the `value` field
something to hold.

**Five files carry a match a new variant breaks, and there are fourteen arms across them** — as
built, at `17dd18a`. Adding a variant makes each a compile error until it is answered, which is the
mechanism this option was chosen for.

**DO NOT DERIVE THAT LIST FROM A GREP. ASK THE COMPILER.** Adding the variants and running
`cargo build -p redextape-core` prints one `E0004` per unanswered arm — fourteen of them, none sharing
a line, because the compiler cites the enclosing `match`'s own line rather than the arm or the
function signature. That is the enumeration. Every wrong version of this inventory came from a grep
standing in for that question, and there were three:

1. `lambda/lower.rs` entered the touch list on three `git grep 'Stmt::'` hits. All three are
   doc-comment prose.
2. `parser.rs` entered the file list on a `git grep -l 'Expr::Method'` hit. It **constructs**
   `Expr::Method` (`parser.rs:285`) and matches an `Expr` only inside `#[cfg(test)]`, where every
   match has a fallthrough. Six files became five.
3. The arm count read *thirteen* until the build produced fourteen. `free_member_refs` carries a
   **statement** walk as well as an expression walk, and the recount that found its second `Expr`
   match had searched for `Expr::Nat` — a probe that cannot, in principle, find a `Stmt` match. The
   fix for a bad proxy was a second bad proxy of the same shape.

The through-line is one error, not three: a grep for a *variant name* answers "which files mention
this text", and the question is "which matches must be exhaustive over this type". Those differ, and
the compiler answers the second one exactly.

**Every arm is an ANSWER, not an assertion.** `language.rs:85` records what this repository has
already paid for the alternative: a `SymbolKind` arm was written as an answer rather than a
`panic!` precisely so that a later PR reaching it could not crash the server. The same reasoning
applies to a variant reachable only through `parse_recovering`.

**The table below is NOT raw `cargo build` output — a build of the tree as shipped prints no `E0004`
at all, because every arm below already answers it.** It is that output reproduced: the fourteen
answering arms were removed in an isolated worktree, `cargo build -p redextape-core` was run against
the result, and the `file:line` column is each real `E0004`'s location, read back against the
unmodified tree. An earlier version of this table cited the enclosing `fn`'s line for every row and
put both of `free_member_refs`'s arms on `desugar.rs:364` — a location no real `E0004` list can
produce twice, since two match arms in the same function are never on the same line. The compiler
cites the `match` keyword's own line, which the two walks below do not share.

| file:line | arm | answer |
|---|---|---|
| `ast.rs:177` | `take_expr_children` | childless leaf — nothing to unlink |
| `ast.rs:219` | `take_stmt_children` | childless leaf — nothing to unlink |
| `ast.rs:241` | `Expr::span` | the variant's own `span` field |
| `ast.rs:263` | `Stmt::span` | the variant's own `span` field |
| `typeck.rs:339` | `infer_stmt` | nothing inferred, nothing bound |
| `typeck.rs:394` | `infer_expr_inner` | `self.fresh()` |
| `lints.rs:147` | `stmt` | no binding pushed, no descent |
| `lints.rs:193` | `expr` | no use marked, no descent |
| `desugar.rs:119` | `lower_stmts_at` | `acc` unchanged — an error statement has no lowering |
| `desugar.rs:380` | `free_member_refs`, expression walk | no member reference, no descent |
| `desugar.rs:420` | `free_member_refs`, **statement** walk | no binding introduced, no descent |
| `desugar.rs:584` | `lower_expr_at` | `Core::Var(id, "$error")` (below) |
| `printer.rs:281` | `expr_prec` | echo `src[span.start..span.end]` verbatim |
| `printer.rs:930` | `stmt` | echo `src[span.start..span.end]` verbatim |

`printer.rs`'s `bp_of` (line 718) needs no arm — it ends in `_ => ATOM_BP`, and atom binding power
is the right answer for an error node, which must never be parenthesised.

**`typeck`'s answer is the existing idiom, not a new invention.** `self.fresh()` is already what
`infer_expr_inner` returns for an unbound variable (`typeck.rs:400`) and for an expression past
`MAX_TYPE_DEPTH` (`typeck.rs:383`). A fresh type variable unifies with anything, so an error node
produces no cascading type errors of its own.

**`printer`'s answer is implementable because the printer already holds the source.** `Printer` has
a `src: &'a str` field (`printer.rs:81`), taken from `parsed.src` at `printer.rs:1005`. This arm is
unreachable today — `format` never sees a recovered tree, per §2 — and it is written as a real echo
rather than a `panic!` so that a future formatter for broken files has the mechanism rather than a
crash.

**`desugar`'s is the one arm with a genuine guard, and it states the guard rather than asserting
it.** `analyze` (`lib.rs:70`) desugars only when no diagnostic has `Severity::Error`, and a recovered
tree always carries at least one error diagnostic — that is what "recovered" means. So desugar
cannot receive an error node through `analyze`. But `desugar::desugar` is `pub`, so a caller that
skips `analyze` can reach it, and the arm has to answer.

Of desugar's four arms, three answer by doing nothing — a `Stmt::Error` contributes no link to
`lower_stmts_at`'s accumulator chain, and neither of `free_member_refs`'s two walks finds a member
reference or a binding in a node with no children. The fourth has to produce a value, because an
expression position demands one, and it answers `Core::Var(id, "$error")`.

**`Core` has no fault variant** — `core.rs:21` lists `Nat`,
`Bool`, `Unit`, `Var`, `BinOp`, `If`, `Lambda`, `Apply`, `Let` and `LetRec`, and adding one would
ripple through `interp`, `lambda/lower`, `tm/lower_asm`, `tm/defunc` and `redextape-native`'s
codegen, which is a backend change this PR has no business making. What `Core::Var` gives instead is
already exactly the required behaviour: an unbound name yields `RuntimeError::new("unbound variable
...")` at `interp.rs:117`, a fault rather than a panic. And `$` is the established prefix for a
Core-level name user source cannot spell — `prelude.rs:35-41` uses `$box`, `$box_get` and
`$box_set`, and states outright that "`$` is unforgeable in user" source, because the lexer starts
an identifier only on `_` or an ASCII letter (`lexer.rs:58`).

So the arm collides with no user program, cannot panic, and produces a message naming the problem.
The alternative worth ruling out explicitly is `Core::Unit`: it would make an unparsed expression
evaluate successfully to a value, which is the confidently-wrong-answer class this repository has
been bitten by repeatedly.

---

## §5 The diagnostic cap

Recovery over a file of pure garbage produces roughly one diagnostic per token, and `MAX_TOKENS` is
100,000 (`parser.rs:16`). That is 100,000 diagnostics pushed to the editor on a single keystroke,
through a server whose `textDocumentSync` is `FULL` and which therefore re-parses on every one.

**The cap is 100 recovered diagnostics per parse, not 100 statements.** `Parser::record` increments
`recovered` unconditionally on every call and stops appending to the diagnostic list once that count
passes 100, appending one final diagnostic that says how many were suppressed. Past the cap the parser
keeps recovering — the tree stays as complete as it can be, because B2's navigation reads the tree and
not the diagnostics.

**A single statement can cost more than one against this cap.** `let x = ` calls `record` twice —
once from `parse_expr_recovering` for the missing value, once from `expect_or_record` for the missing
`;` — and neither call knows the other happened, so it counts as two toward the cap despite being one
`Stmt::Let` (not even a `Stmt::Error`). The cap is a count of `record()` calls, which is diagnostics,
not of statements recovery touched. An earlier draft of this section argued the opposite — that
counting statements rather than diagnostics was the deliberate choice, "because a single statement can
legitimately produce more than one diagnostic without that indicating a storm" — which described a
design the field's name and behaviour never matched: `MAX_RECOVERED_DIAGNOSTICS` counts what its name
says.

---

## §6 Testing

Beyond the per-property tests §3 names:

- **The contract split, asserted from both sides.** For an input that recovers: `parse_full`
  answers `None`, and `parse_recovering` answers a tree. For an input that does not: both answer a
  tree, and the trees are equal. The second half is what makes the first mean something — without
  it, a `parse_recovering` that always returned an empty tree would pass.
- **`format` cannot reach a recovered tree.** `format("let x = ")` answers `Err`, and the property
  is asserted at `format`'s own level rather than by reasoning about `parse_full`'s callers.
- **The unclosed-brace case, by content.** `fn f(a) { let y = 1;` yields a tree containing the
  binding `y`. Asserting the diagnostic count alone would pass against a scheme that discarded the
  body, which is the scheme §3.3 exists to rule out.
- **Sabotage runs, recorded with their output.** Removing §3.1's progress bump must hang the
  progress test; removing §3.2's depth counter must redden the nesting test; removing §3.3's
  `Eof` termination must redden the unclosed-brace test. A property this spec claims a test holds up
  is a claim to check, and the three above are the ones where a passing test is cheapest to write by
  accident.

---

## §7 What B2 inherits

- `parse_recovering`, returning a tree for any input.
- `Stmt::Error` and `Expr::Error`, so the binder pass has an explicit node to walk past rather than
  a gap to infer.
- The unchanged `parse`/`parse_full` contract, so B2's AST name-span change lands against consumers
  that have not moved.

B2 still owns everything the navigation design's §7 named: name spans on `Stmt::Let`, `Stmt::Fn` and
`Stmt::Assign`, spans for the two `params: Vec<String>` fields, the binder-resolution pass,
`Role::Definition`'s kind discriminant, `nav_rxt`, and the `Language::nav` / `Language::symbol_kind`
arms.

**One constraint B2 inherits that is not in that list.** The binder pass must be **iterative**.
`lints.rs`'s module doc records that its own recursive walk is safe only because both its callers
run it after typechecking, and `typeck.rs`'s `MAX_TYPE_DEPTH` bounds anything that clears that gate.
A navigation pass runs before typechecking, on a tree that may not typecheck at all, so it cannot
borrow that guarantee. `desugar.rs`'s `free_member_refs` is the shape to follow — it walks the same
scoping rule iteratively and says why.

---

## §8 What this does not do

- **No name spans and no binder pass.** Both are B2. B1 changes no field of an existing variant.
- **No recovery for the other three forms.** `.tm` and `.asm` already recover; `.rxlambda` does not,
  and has no navigation slice asking it to.
- **No formatting of a broken file.** `printer`'s error arm makes it reachable later; `format`'s
  contract is unchanged, and `Language::format` still answers `None` for a `.rxt` that does not
  parse.
- **No change to the LSP crate.** B1 touches `redextape-core` only. The transport boundary check —
  `git grep -l "use lsp_server\|lsp_server::" crates/redextape-lsp/src` answering `1` — is
  unaffected because nothing in this PR is in that crate.
- **No incremental sync.** `textDocumentSync` stays `FULL`, unchanged and for the reason already
  recorded in the two prior slices.

---

## §9 Verification

Every `file:line` this spec cites was read at `fe3d34b` rather than remembered, and one of them was
wrong on the first pass — `MAX_PARSE_DEPTH` was cited at `parser.rs:71`, which is a line of its doc
comment, and the constant is at `parser.rs:74`. The citations are re-checkable in one command:

```sh
git grep -n 'pub const MAX_TOKENS\|pub fn parse_full\|fn parse_block_body\|pub const MAX_PARSE_DEPTH' \
    fe3d34b -- crates/redextape-core/src/parser.rs
```

The two claims that are properties rather than line numbers, with the command that answers each:

```
Core has no fault variant     git show fe3d34b:crates/redextape-core/src/core.rs
                                | sed -n '/pub enum Core/,/^}/p' | grep -c Error   -> 0
14 arms across 5 files        cargo build -p redextape-core, with the variants added
                                and no arms answered: one E0004 per arm, at 17dd18a
```

**The arm count was wrong twice and the file count once, and §4 records all three with their cause.**
They are left in the record rather than quietly corrected because one mistake produced all of them:
a grep for a variant name answers "which files mention this text", and the binding question is
"which matches must be exhaustive over this type".

**What replaced the grep is the compiler.** `cargo build` with the variants added and no arms
answered emits one `E0004` per unanswered match, naming file and line. §4's table is that output
reproduced against the shipped tree — the shipped tree itself answers every arm and builds clean, so
there is no live `E0004` list to point at directly — and a reviewer re-derives it by the same command
rather than by trusting the number. **This spec's
own §9 already said a grep was not a match-site count, one committed revision before the arm count
proved wrong for the same reason** — so writing the warning down did not prevent the next instance,
and naming the mechanism that answers the question correctly is what does.
