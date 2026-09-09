# The LSP track's loose ends — design

**A cleanup slice, not a feature.** The LSP track closed with PR #82 (`6e0ad6e`), whose roadmap
entry filed five ends left open inside the shipped code. This spec takes three of them, unifies two
of those three into one mechanism, and records why the fourth is deliberately not done. The fifth —
`.rxlambda` navigation — is a feature and is not in this slice.

| end (as filed in #82's entry) | verdict here |
|---|---|
| 1. The `fn`-run boundary scan exists five times | §1 — one helper, five callers |
| 2. `push_reference(n, s)` is exactly `push_resolved_reference(n, s, None)` | §5 — **deliberately not done** |
| 3. A `.rxt` file over `MAX_TOKENS` yields an empty index | §2 — `nav_rxt` answers `Option` |
| 4. The outline lists every `let` as a flat sibling of the functions | §3 — one mechanism |
| 5. `documentSymbol`'s `range` is the enclosing line | §3 — the same mechanism |

Ends 4 and 5 are filed as two and are one: both are `document_symbol` starving for a span the index
does not carry. One field closes both.

| what | where |
|---|---|
| `fn_run_at`, and five call sites reduced to it | `redextape-core/src/ast.rs`, `typeck.rs`, `lints.rs`, `desugar.rs`, `binder.rs` |
| `Completeness`, and a nav-only parse entry point | `redextape-core/src/parser.rs` |
| `nav_rxt -> Option<NameIndex>` | `redextape-core/src/binder.rs`, `redextape-lsp/src/language.rs` |
| A definition's extent | `redextape-core/src/nav.rs`, `binder.rs` |
| The outline tree | `redextape-lsp/src/outline.rs` (new), `lib.rs` |

---

## §1 One `fn`-run boundary scan

### §1.1 The five sites, verified against `6e0ad6e`

A maximal run of consecutive `Stmt::Fn` is the unit `typeck::infer_fn_run` pre-binds: every name in
the run is bound before any body is checked, so a member may forward-reference or mutually recurse
with any other member, and a non-`fn` statement ends the run. Five places compute that run's
boundaries, and nothing holds them in step:

| site | direction | shape |
|---|---|---|
| `typeck.rs:249` | forward | `while i < len && matches!(&block.stmts[i], Stmt::Fn { .. })` |
| `lints.rs:68` | forward | `while i < len && matches!(b.stmts[i], Stmt::Fn { .. })` |
| `binder.rs:193` | forward | `while matches!(b.stmts.get(i), Some(Stmt::Fn { .. }))` |
| `desugar.rs:436` | forward | `while matches!(block.stmts.get(i), Some(Stmt::Fn { .. }))` |
| `desugar.rs:111` | **backward** | `while start > 0 && matches!(stmts.get(start - 1), Some(Stmt::Fn { .. }))` |

#82's whole-branch review verified arm-by-arm that the five agree today. That verification is a
fact about one commit, not a property, which is why it is worth replacing with a call.

### §1.2 The helper

```rust
/// The maximal run of consecutive `Stmt::Fn` containing `i`.
pub(crate) fn fn_run_at(stmts: &[Stmt], i: usize) -> Range<usize>
```

Precondition: `stmts[i]` is a `Stmt::Fn`. It scans back to the run's first statement and forward
past its last, so it answers the same range for every index inside one run rather than only for the
first.

The four forward callers pass the run's first index and get `i..end`. `desugar.rs`'s right-to-left
walker passes `i - 1` — it meets a run's END first — and sets `i = run.start` afterwards, which is
what it does today with its own back-scan.

### §1.3 Why the two directions collapse into one function, measured

The forward callers never pay for the back-scan, and the backward caller never gets a different
answer from the forward scan, for one reason: at each of the five sites the index passed in is
already at a run boundary in the direction the caller does not scan. Both halves were measured on
`6e0ad6e` rather than argued.

A probe was patched into `desugar.rs`'s backward branch asserting two things:

1. `stmts[i]` is never a `Stmt::Fn` when the branch is entered — i.e. `i` is the run's exclusive
   end, so a forward scan cannot run past it.
2. A forward scan from `i - 1` terminates at exactly `i`.

`cargo test --workspace` was green with both in place. **Then the first assertion was inverted to
`assert!(false, ...)` and `cargo test -p redextape-core --lib` reported it 100 times**, which is
what makes the green meaningful: the branch is reached, so a passing assertion there is evidence
rather than an absence.

The reason behind the measurement: walking right-to-left, if `stmts[i]` were a `Stmt::Fn` it would
have been consumed by the previous iteration's run, which would have back-scanned through `i - 1`
and set `i` to that run's start — contradicting `stmts[i - 1]` being an unprocessed `Stmt::Fn`.

### §1.4 What stays a copy

`lints.rs:170` and `desugar.rs:128` route a lone `Stmt::Fn` through their run helpers with
`std::slice::from_ref`. Those are unreachable arms kept correct rather than left as second copies of
a lowering, and they compute no boundary. They are untouched.

---

## §2 A `.rxt` file over `MAX_TOKENS`

### §2.1 What is wrong

`parse_inner` (`parser.rs:67`) refuses input above `MAX_TOKENS` (100,000) by returning an **empty**
`Program` plus one error diagnostic. `nav_rxt` builds its index from that empty tree, so the answer
is an empty `NameIndex` — and `nav.rs`'s own module doc reads an empty index as the claim *this
document contains no names*. It is instead the claim *the parser never ran*.

`.tm` and `.asm` are line-oriented and have no such cap, so the asymmetry arrived with `.rxt` and is
unrecorded outside #82's entry.

**Reproduced on `6e0ad6e`, not inferred.** A generated `let a0 = 0; let a1 = a0; …` program, lexed
through the same `lex` the cap reads:

| statements | tokens | definitions `nav_rxt` answers |
|---|---|---|
| 19,999 | 99,996 | 19,999 |
| 20,000 | 100,001 | **0** |

One statement more than the cap allows turns a full index into an empty one, with no signal
distinguishing it from a file that genuinely names nothing.

### §2.2 The channel already exists

`Document::nav` is `Option<NameIndex>` and `Language::nav` already answers `None` for
`Language::Lambda`, meaning *a form this server does not index*. Every navigation handler funnels
through `let nav = doc.nav.as_ref()?` inside an `and_then`, so `None` becomes JSON `null` — which
the protocol distinguishes from `[]`. `null` is *no outline for this document*; `[]` is *this
document has no symbols*.

The distinction is wired, and it is pinned for one handler out of three:
`definition_on_a_form_this_server_does_not_serve_is_null` (`lib.rs:1042`). `documentSymbol` has no
such test — the arm this slice changes is the unpinned one, which is why §6 adds it. What is
missing beyond the test is a `.rxt` path into the `None`.

### §2.3 The change

`parse_inner`'s `bool` becomes a three-state enum:

```rust
enum Completeness {
    /// Clean lex, within `MAX_TOKENS`, no recovery.
    Complete,
    /// The parser ran and recovered. The tree is partial and navigable.
    Recovered,
    /// The token cap refused the input. The parser never ran and the tree is empty.
    Refused,
}
```

- `parse_full` answers `Some` iff `Complete` — unchanged behaviour, since the over-cap early return
  already hardcodes `false` today.
- `parse_recovering` keeps its signature, its `#[must_use]` and its "always answer a tree" contract.
  Its doc gains one sentence naming `Refused` as the state where that tree is empty because nothing
  was parsed, so a future consumer inherits the fact rather than the blind spot.
- A new crate-private `parse_for_nav(src) -> (Option<Parsed<'_>>, Vec<Diagnostic>)` answers `None`
  on `Refused` and `Some` on the other two.

`nav_rxt` becomes `pub fn nav_rxt(src: &str) -> Option<NameIndex>`, `None` exactly when
`parse_for_nav` refused. `Language::nav`'s `.rxt` arm drops its `Some(...)` wrapper. That is the
only call site outside tests: `language.rs:93`.

**`Refused` is not "did not parse cleanly".** A recovered file must still index — that is the whole
of PR #81 — so the trigger is the cap and nothing else.

---

## §3 A definition's extent, and the outline tree

### §3.1 What is wrong

`document_symbol` sets `range` to `enclosing_line(&doc.text, o.span)` and `children` to `None`,
always. Two consequences:

- A multi-line `fn` folds to its header line. Its `range` is what a client tests the cursor
  against, so breadcrumbs and sticky scroll report no symbol anywhere in the body.
- Every `let` is a flat sibling of every `fn`, including `let`s inside a `fn` body and inside a
  block expression. The reasoning that excludes parameters from the outline — a flat list of every
  parameter of every function is noise — argues equally for these, and no test pins the behaviour
  either way.

`lib.rs:322` and `lib.rs:463` both give the same reason for the line: the index stores name spans,
and recording where a block ends is more than navigation needs. **That was true of `.tm` and `.asm`
and is not true of `.rxt`** — `Stmt::Fn.span` and `Stmt::Let.span` already record it, and #82's
entry says so.

### §3.2 The field

`Role::Definition` gains `extent: Option<Span>`, and `push_definition` a fourth argument.

| pusher | extent |
|---|---|
| `tm/syntax.rs:554` (`state <name>:`) | `None` |
| `tm/asm_syntax.rs:214` (`<name>:`) | `None` |
| `binder.rs`, `DefKind::Fn` | `Stmt::Fn.span` |
| `binder.rs`, `DefKind::Let` | `Stmt::Let.span` |
| `binder.rs`, `DefKind::Param` | `None` |

`None` for `.tm` and `.asm` states a true fact about those forms: no parser records where a state's
rules end, exactly as `lib.rs:322` says. It is not filler.

**This is not the shape §5 rejects.** There, two entry points encode two different *linking rules*,
and folding them would make three call sites pass a `None` that means nothing at those sites. Here
there is one rule and `extent` is data some forms carry and others do not.

`nav.rs` still holds no grammar. An extent is a span the parser supplies and this module only
carries, which is the same standing `DefKind` already has.

### §3.3 The tree pass

New `crates/redextape-lsp/src/outline.rs`. `lib.rs` is 1,430 lines and `document_symbol` is already
its longest handler; the tree building is a protocol concern and belongs beside it, not inside it.

Filter to the definitions `outline_kind` lists — this drops `DefKind::Param`, which keeps a
parameter navigable while leaving it out of the outline, unchanged from #82 — then one pass in
source order, which `NameIndex::definitions` promises and `Binder::finish`'s sort delivers:

1. Pop every extent on the stack that ends at or before this definition's name start.
2. Attach this definition to the innermost extent still open, or to the root when the stack is
   empty.
3. Push this definition's own extent, when it has one.

**Step 1 before step 3 is the correctness argument, and it is not the one this section first gave.**
The original claim — that a `fn`'s name lies inside its own extent, so pushing before attaching
would make every `fn` its own child — is **false on every input**, and shipped into `outline.rs`'s
module doc before a review traced it. On the `Some(extent)` branch a node is only ever *pushed*,
never attached; `attach` is reached for the current node only on the `None`-extent branch, where
nothing was pushed for it. No node can become its own child in either ordering.

What the ordering actually protects is a **closed sibling**. A just-pushed extent shadows an extent
beneath it that has already closed, so that sibling is never popped in time and the drain attaches
it under the node stacked on top. Traced on `let a = 1; let b = 2;` with the steps swapped: `b` is
pushed, the pop loop tests `b`'s own end against `b`'s name and stops, and the drain attaches `b`
under `a` — `a[b]` where `a b` is right. That is exactly the failure the three tests which *did*
redden were pinning, while the test named for self-parenting stayed green.

**A boundary this pass cannot reach, stated because no test can hold it.** The pop compares an
extent's END against a **name's** start. In `.rxt` a name is always preceded by `let ` or `fn `, so
a name's start is at least three bytes past its own statement's start, which is at or after the
previous extent's end; extents end at a `;`, `}` or EOF token with a whole keyword token in
between. So `end == name.start` cannot occur, and `<=` and `<` are the same function on this
grammar. `<=` is written for the general containment semantics. A test claiming to guard that
boundary would be unfalsifiable, which is what the first draft of §6 asked for.

`.tm` and `.asm` carry no extent, so nothing is ever pushed, the stack stays empty, every definition
is a root and the outline is exactly what it is today.

### §3.4 The two response arms

`range` is the extent when there is one and `enclosing_line` otherwise. `selection_range` stays the
name span. The protocol requires the selection range to be contained by the range, and an extent
contains its own name by construction, so containment holds on both paths.

The `SymbolInformation[]` arm — what a client without
`hierarchicalDocumentSymbolSupport` asked for, and not a fallback — stays flat, because that shape
has no `children`. It gains `container_name`, set to the enclosing definition's name, which is the
only place in that shape where the nesting can be reported at all.

---

## §4 Fixtures, every one probed before it was written down

Run through `parse_recovering` and `nav_rxt` on `6e0ad6e` before being committed to this prose. The
byte offsets below are that probe's output, not counted by eye. #82 spent a whole section on three
fixtures that did not hold the property their test would have asserted; this is the response to it.

| source | extents and names | what the tree does |
|---|---|---|
| `fn f(a) {␤  let x = 1;␤  x␤}␤let y = 2;␤y` | `f` name `(3,4)` extent `(0,28)`; `a` `(5,6)` Param; `x` name `(16,17)` extent `(12,22)`; `y` name `(33,34)` extent `(29,39)` | `x` nests under `f`; `y` is a root; `a` is filtered |
| `let g = { let y = 1; y };` | `g` name `(4,5)` extent `(0,25)`; `y` name `(14,15)` | `y` nests under `g` — **through a block expression**, which is not a statement of the outer block and which a statement walk does not show |
| `let a = 1; let b = 2;` | `a` extent `(0,10)`; `b` name `(15,16)` | siblings: `15 >= 10`, so `a`'s extent pops before `b` attaches |
| `fn a(n) { b(n) } fn b(n) { a(n) } 0` | `a` extent `(0,16)`; `b` name `(20,21)` | siblings — a `fn` run does not nest |
| `fn f(a) { a` | `f` name `(3,4)` extent `(0,11)` | a broken `fn` still indexes and still folds; the extent runs to end of input |

The second row is the one that could not have been reached by reading the AST: the binder walks a
block expression through its worklist, so the inner `let` is in the index while the outer
statement list holds only `g`.

---

## §5 What this does not do, and why

**End 2 — folding `push_reference` into `push_resolved_reference` — is deliberately not done.**
#82's entry calls it a legitimate follow-up. It is legitimate and it is a net loss.

`push_reference` has three call sites (`tm/syntax.rs:520`, `tm/syntax.rs:576`,
`tm/asm_syntax.rs:257`) and `push_resolved_reference` has one (`binder.rs:273`). Folding removes one
method and makes those three pass a `, None` that means nothing where they stand: those parsers
cannot resolve anything at push time, because a `goto` may name a state defined further down the
file, and `link` is the rule they want. The two names are what record that there are two linking
rules — a flat namespace for `.tm`/`.asm`, a scope chain for `.rxt`. `nav.rs`'s doc already says
the split enforces nothing and already gives each caller's reason for keeping its own entry point,
which is why this slice edits it no further.

**The record of "considered and declined" then lives only here, which is a weakness.** #82 filed
this end despite that doc already standing, so a reviewer reading the code alone may well file it
again. The roadmap entry must carry it forward for that reason — #82's own entry calls folding
them "a legitimate follow-up", and nothing has recorded the decision to decline it.

**`.rxlambda` navigation is not in this slice.** De Bruijn terms carry no source positions at all,
so it is a feature with a design of its own, not a loose end.

**`MAX_TOKENS` is not raised, and navigation does not run above it.** `parse_recovering` still
descends through `parse_binary`, whose recursion is what the cap guards; the binder being iterative
does not make the parser one. §2 changes what the refusal is *reported as*, not what is refused.

---

## §6 Testing

Each item names the sabotage that must make it fail. A test that cannot fail is the defect this
project has filed most often.

**§1 — `fn_run_at`.**

- Every index of a run answers the same range: over runs of length 1 to 4 in blocks with non-`fn`
  statements before and after, assert `fn_run_at(stmts, i)` is equal for every `i` in the run.
  *Sabotage:* drop the back-scan; the property fails at every index but the first.
- The five call sites are behaviour-preserving: the existing `typeck`, `lints`, `desugar` and
  `binder` suites are the assertion, and `a_fn_run_pre_binds_every_sibling_before_any_body_is_walked`
  (`lints.rs:469`) is the one that bites hardest. *Sabotage:* make `fn_run_at` answer `i..i + 1`;
  mutual recursion stops resolving.

**§2 — the cap.**

- `nav_rxt` answers `None` above `MAX_TOKENS` and `Some` at the boundary. The fixture is generated,
  not written, from the table in §2.1: 20,000 statements of `let a0 = 0; let a1 = a0; …` is 100,001
  tokens and 19,999 is 99,996. Assert `None` at the first and `Some` with 19,999 definitions at the
  second. **The test lexes its own fixture and asserts the token count**, so a change to the lexer
  that moves the boundary fails here rather than silently testing two under-cap programs.
  *Sabotage:* answer `Some` unconditionally; the first assertion fails.
- A recovered file still indexes: `nav_rxt("fn f(a) { a")` is `Some`. *Sabotage:* map `Recovered` to
  `None`; this fails while the cap test still passes, which is what separates the two states.
- The server answers `null` rather than `[]`: a `documentSymbol` request against an over-cap `.rxt`
  document, asserting the `result` is JSON `null`. This goes beside the other handler tests in
  `lib.rs`, not in `tests/protocol.rs` — the null-versus-empty-array distinction is visible at the
  handler, and `protocol.rs` exists for the exchanges a handler test structurally cannot see.
  *Sabotage:* have `document_symbol` answer `Some(vec![])` on a missing index; a test asserting "no
  symbols" would pass and this one does not.

**§3 — the extent and the tree.**

- The five fixtures of §4, asserted as a tree: parent-child pairs by name and index, not by name
  alone. `let x = 1; let x = x + 1;` is in the tree twice with the same name, so a name-keyed
  assertion passes against the wrong node.
- Pop-before-push: a closed sibling is not buried under the node pushed after it.
  `fn f(a) { let x = 1; x } let z = 2;` yields `f[x] z`. *Sabotage:* swap steps 1 and 3; `z` is
  buried under `f`. **The fixture needs a trailing top-level sibling** — `fn f(a) { let x = 1; x }`
  alone yields `f[x]` under either ordering, which is how the first draft of this section asked for
  a test that could not fail.
- Siblings do not nest: `let a = 1; let b = 2;` yields two roots. *Sabotage:* swap steps 1 and 3, as
  above; `b` becomes `a`'s child. **Not** `<` versus `<=` — §3.3 shows that boundary is unreachable,
  so those two are the same function here and no fixture distinguishes them.
- `.tm` and `.asm` outlines are byte-identical to today's: the existing `documentSymbol` tests for
  both forms are unchanged and must stay green with no edit. *Sabotage:* give `.asm` labels
  `enclosing_line` as an extent; the two forms start nesting and those tests fail.
- Containment holds: for every symbol in every fixture, `selection_range` is inside `range`.
  *Sabotage:* set `range` to the name span and `selection_range` to the extent.
- The flat arm: with `hierarchicalDocumentSymbolSupport` off, the same document yields the same
  number of symbols as the tree has nodes, each with `container_name` set to its parent's name and
  `None` at the root. *Sabotage:* emit only the roots; the count assertion fails.

**Beyond the plan.** `nav_rxt` over the `.rxt` files in the tree, asserting the outline tree's node
count equals the flat definition count minus the parameters — a whole-file property no fixture
checks, and the one that would catch a definition lost by the stack pass rather than merely
misplaced.

---

## §7 Verification

Figures to record in the roadmap entry, each with the command that produced it:

- `cargo test --workspace` — binary count and failures.
- `cargo clippy --workspace --all-targets -- -D warnings` — clean.
- `cargo fmt --all --check` — clean.
- `cargo test -p redextape-core --lib` and `cargo test -p redextape-lsp` — counts.
- `git diff --stat <base>..<head> -- crates/`.
- Every sabotage in §6 run, and observed to fire.
- The over-cap fixture's token counts, re-measured on the branch rather than carried over from
  §2.1's table — the numbers there were measured on `6e0ad6e` and this slice edits the parser.
