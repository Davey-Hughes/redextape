# The `.rxt` navigation index — design

**PR B2 of the LSP track's third slice, and the last of it.** PR A
([`2026-09-06-lsp-navigation-design.md`](2026-09-06-lsp-navigation-design.md)) shipped the whole
server-side navigation surface — `definition`, `references`, `documentSymbol`, the position
arithmetic and `nav.rs` itself — against `.tm` and `.asm`, whose name resolution is a flat lookup.
PR B1 ([`2026-09-07-rxt-parse-recovery-design.md`](2026-09-07-rxt-parse-recovery-design.md)) found
and cleared a blocker that neither design had seen: `.rxt` had no parse recovery, so an index built
from `parse` would have been empty for exactly the broken files navigation exists to serve.

This PR spends both. It is three things and one dispatch arm:

| what | where |
|---|---|
| Name spans on the AST, and a `Param` type carrying one | `redextape-core/src/ast.rs`, `parser.rs` |
| The binder-resolution pass, and `nav_rxt` | `redextape-core/src/binder.rs` (new) |
| A definition-kind discriminant | `redextape-core/src/nav.rs` |
| `Language::nav`, and `symbol_kind`'s replacement | `redextape-lsp/src/language.rs`, `lib.rs` |

---

## §1 What is missing, verified against the tree — as of `1412686`

**`Language::nav` and `Language::symbol_kind` both still read
`Language::Redextape | Language::Lambda => None`** (`language.rs:115` and `language.rs:97`). Those
two arms are the whole of the LSP-side gap. `document_symbol` reaches `symbol_kind` at
`lib.rs:336`, and `definition`, `references` and `documentSymbol` are already advertised, already
dispatched and already tested against the two artifact forms.

**The AST retains occurrence spans but not definition spans.** `Expr::Var` carries `name` and its
own `span`, which is exactly the occurrence, so references are free. Nothing else is:

| construct | what it carries today | what a definition needs |
|---|---|---|
| `Stmt::Let` | `name: String`, `span` of the statement including its `;` | the name's own span |
| `Stmt::Fn` | `name: String`, `span` from `fn` to the body's `}` | the name's own span |
| `Stmt::Assign` | `target: String`, `span` including its `;` | the target's own span (a *reference*, per §2) |
| `Stmt::Fn { params }` | `Vec<String>` | a span per parameter |
| `Expr::Lambda { params }` | `Vec<String>` | a span per parameter |
| `Expr::Method { name }` | `String`, and the whole call's `span` | the method name's own span |

`parse_param_list` (`parser.rs:428`) returns `Vec<String>` and is the one producer of both `params`
fields. `Expr::Method` is built at `parser.rs:529`.

**`Role::Definition` carries no kind.** `.tm` and `.asm` need none — one form yields one kind of
definition, so `Language::symbol_kind` answers a per-language constant. `.rxt` yields three, and
PR A's §2.4 says so explicitly rather than leaving it to be discovered here.

**Nothing outside `nav.rs` names `nav::Role`.** `grep -rn "Role::" --include='*.rs' crates` returns
7 lines, all in `lambda/syntax.rs`, all the unrelated `Role { Term, AppFn, Atom }` of the λ printer.
So giving `Role::Definition` a field is a change to `nav.rs` and to the LSP methods that call
`definitions()`, and to nothing else.

---

## §2 The scoping rules this pass must reproduce

**A navigation answer that disagrees with the typechecker is a wrong answer, not a different one.**
Every rule below was read at `1412686` rather than inferred from the grammar.

| construct | rule | site |
|---|---|---|
| resolution | reverse scan of the binding stack — innermost, latest wins | `typeck.rs:65` |
| `let x = v;` | `v` is inferred **before** `x` is bound | `typeck.rs:341` |
| `fn` run | the maximal run of consecutive `Stmt::Fn`; every name bound before any body | `typeck.rs:239`, `typeck.rs:287` |
| parameters | bound for their own body, dropped after it | `typeck.rs:318`, `typeck.rs:324` |
| `x = v;` | `env.lookup(target)` — a **reference** to an existing binding | `typeck.rs:352` |
| block, `if` arm, `while` body | its own scope, truncated on exit | `typeck.rs:239`, `typeck.rs:262` |
| `recv.m(args)` | `m` is looked up in the environment — a reference | `desugar.rs:406` |

Two consequences worth stating, because both are places a plausible implementation is wrong:

- **`let x = 1; let x = x + 1;` resolves the right-hand `x` to the FIRST `let`.** The value is
  walked in the pre-binding scope. A name-keyed index answers "both", which is what PR A's §2.4
  built the `def` link one PR ahead of its need to avoid.
- **A `fn` may forward-reference any other `fn` in its own run, and no `fn` outside it.** A
  non-`fn` statement ends the run (`typeck.rs:245`). Two members of one run may not share a name —
  `infer_fn_run` reports that — but the index records both definitions regardless, on the same
  reasoning §3.1 of PR A's design gives for duplicate `.tm` states: an error elsewhere does not
  unmake a `fn` line that parsed.

---

## §3 The binder pass

A new module, `crates/redextape-core/src/binder.rs`, with one public entry:

```rust
pub fn nav_rxt(src: &str) -> NameIndex
```

built over `parser::parse_recovering(src).0.program` (`parser.rs:45`) — never `parse` or
`parse_full`, which answer `None` for exactly the files this exists to serve.

**It is a new module rather than an addition to `analysis.rs`, and the written design says
otherwise.** PR A's §7 calls this "teach `analysis` to keep resolved symbols", and the roadmap
repeats the phrasing. `analysis.rs`'s module doc is about token classes and the
core-emits-classes-never-colours split; a scoping pass is a second concern with a different
consumer, and `nav.rs` was itself a new module in this crate for the same reason. The correction is
recorded here rather than made silently, and `analysis.rs` gains one line pointing at `binder.rs`
so a reader following the old phrasing lands somewhere.

### §3.1 Iterative, and the guarantee it cannot borrow

**`lints.rs`'s module doc records a stack-safety guarantee that this pass is outside.** `check` is
fully recursive over the surface tree, and is safe only because both of its callers — `analyze`,
and `redextape-wasm`'s `Session::compile_with_caps` — run it after typechecking has added no
error-severity diagnostic, so `typeck.rs`'s `MAX_TYPE_DEPTH` has already rejected any program
nested deeper than typeck itself can recurse over.

A navigation pass runs **before** typechecking, on a tree that may not typecheck and — since B1 —
may not have parsed completely either. It cannot borrow that guarantee, and the failure it would
buy is not a diagnostic: a recursive walk over adversarial nesting is an uncatchable native stack
overflow that takes the editor's server process with it.

The bound is real rather than theoretical. `MAX_TOKENS` is `100_000` (`parser.rs:17`), and
`ast.rs`'s hand-written iterative `Drop` exists because the parser builds left-nested
`Binary`/`Call`/`Method` chains up to roughly half that deep. `MAX_PARSE_DEPTH` does not bound
them: left-nesting is a loop in the parser, not recursion.

`desugar.rs`'s `free_member_refs` (`desugar.rs:367`) already walks this exact scoping shape
iteratively, over an explicit worklist, and its own doc comment says why. **This pass follows that
shape rather than reinventing one.**

### §3.2 The scope arena

Mirrors `free_member_refs`'s `Shadow` chain (`desugar.rs:318`), with one field added:

- Scopes live in a flat `Vec` and are addressed by index. Each entry is
  `(parent, name, def_event)`; a root sentinel ends the chain.
- Scopes are **immutable and persistent**, which is what lets a worklist item carry its own scope
  and be popped in any order. A mutable push/pop stack cannot survive an out-of-order walk.
- `resolve(scope, name)` walks parent links to the root and takes the first match — a loop, like
  `shadowed` (`desugar.rs:332`), and the same answer as `TyEnv::lookup`'s reverse scan.

**The cost differs from `free_member_refs`'s and the doc must say so rather than inherit its
bound.** There, only names in the member set get a node, so `shadowed`'s doc can say the chain is
0 or 1 deep in practice. Here every binding gets one, so a lookup is O(bindings live at that
point) — the same shape `lints.rs` and `TyEnv::lookup` already pay, and bounded by nesting rather
than by file length, because a chain holds enclosing bindings and not every binding seen.

**That last clause is wrong, and the code's doc says otherwise.** `block` threads `cur =
self.bind(cur, …)` across CONSECUTIVE statements, not only nested ones, so a flat run of N `let`s
at one nesting depth still produces a chain N deep. Each `let aK = a0;` statement in such a run is
exactly 5 tokens (`let`, name, `=`, name, `;`), so N reaches the tens of thousands before the
parser's 100,000-token `MAX_TOKENS` intervenes — measured: 19,999 such statements is 99,996 tokens
and parses whole, 20,000 is 100,001 and does not — and the last one's resolve walks to the bottom
of the chain. The true bound is the number of bindings in scope at that point, which in a flat
block grows with the number of preceding `let`s, not only with nesting depth. `resolve` returns on
the first match, so that N is a worst case rather than every case: a miss, or a name bound near the
root, walks all N, while the most recently bound name resolves after one link.

That is not a new cost class in this crate, but the comparison holds asymmetrically and saying
otherwise would be a third version of this same mistake. `TyEnv::lookup` pays the same reverse scan
to the same depth on every program that typechecks. `lints.rs`'s scope walk pays it only when
`check` runs at all, and `lints.rs`'s own module doc records that this is after typechecking has
added no error-severity diagnostic — so on a file that does not typecheck, or since B1 does not
parse, the binder pays this cost and `lints.rs` never runs. Those are exactly the files navigation
exists to serve. `binder.rs`'s doc is corrected to say this rather than the bound this section
stated.

### §3.3 Source order arrives by sorting, not by push discipline

`NameIndex` occurrences are in source order: `definitions()` (`nav.rs:119`) promises it and
`documentSymbol` renders it. A worklist pops LIFO — `free_member_refs` pushes `cond`, `then_blk`,
`else_blk` and pops them backwards — so the walk does not produce that order.

The pass therefore emits **events** (`{ name, span, Def(DefKind) | Ref(Option<event_id>) }`), and
builds the index in one final pass:

1. Stable-sort the event indices by `(span.start, span.end)`.
2. Build `remap[event_id] -> occurrence_index` from that order.
3. Push in that order, translating each `Ref`'s target through `remap`.

**The alternative — pushing children reversed so pop order is source order — was rejected because
getting it wrong is close to invisible.** `at()` (`nav.rs:86`) finds an occurrence by containment
and is indifferent to order, so a mis-ordered walk still answers `definition` and `references`
correctly and corrupts only the outline. Sorting makes source order a property of one line rather
than a discipline held at every push site.

**`NameIndex::link` (`nav.rs:63`) is never called for `.rxt`.** It points every reference at the
first definition of its *name*, which is the right rule for a flat namespace and the wrong one
under shadowing. `nav.rs` gains
`push_resolved_reference(name, span, def: Option<usize>)` beside the existing
`push_reference` (`nav.rs:57`), and the two linking rules stay separate and separately named.

---

## §4 AST name spans

One new type:

```rust
pub struct Param { pub name: String, pub span: Span }
```

and six field changes: `name_span` on `Stmt::Let`, `Stmt::Fn` and `Expr::Method`; `target_span` on
`Stmt::Assign`; `params: Vec<String>` to `Vec<Param>` on `Stmt::Fn` and `Expr::Lambda`.

**A pair of parallel `Vec`s was rejected.** `params: Vec<String>` beside `param_spans: Vec<Span>`
compiles against every existing `for p in params` and costs almost no churn, at the price of a
length invariant nothing enforces — with `parser` writing both and `printer` reading one. A desync
there produces wrong spans rather than a failure, which is the shape this repository has twice
recorded as a check that is green and blind. `Param` makes the pairing structural.

**The churn is measured, and it is contained to one crate.**
`grep -rn "Stmt::Fn {[^}]*params\|Expr::Lambda {[^}]*params" --include='*.rs' crates` returns 16
lines across 5 files: `desugar.rs` 6, `typeck.rs` 3, `parser.rs` 3, `lints.rs` 2, `printer.rs` 2.
`grep -rn "ast::" --include='*.rs' crates | grep -v redextape-core` returns 0 lines, and `ast.rs`
carries 0 `cfg_attr` attributes — no `serde`, no `ts_rs` — so no `web/` TypeScript copy moves.

`Param` holds a `String` and a `Span` and recurses into nothing, so it stays outside `ast.rs`'s
iterative `Drop` worklist.

**`Expr::Method`'s new `name_span` does not change what the lowered `Var` inherits.**
`desugar.rs:652` synthesizes the UFCS callee and comments that "the method name has no span of its
own in this AST", so it inherits the whole call's span. That comment becomes false and is
corrected; the span it feeds `spans` is left alone, because moving it would move sourcemap entries
that `tests/sourcemap_coverage.rs` pins.

---

## §5 The definition kind

`nav.rs` gains `pub enum DefKind { State, Label, Let, Fn, Param }`, and `Role::Definition` carries
one. `push_definition` (`nav.rs:51`) takes it; the `.tm` and `.asm` parsers pass `State` and
`Label`.

**This puts four grammars' vocabulary in a module whose doc opens "THIS MODULE HOLDS NO GRAMMAR",
so that doc is corrected rather than contradicted.** The rule it means is that nothing here may
*decide* what a name is — a function answering "is this a state?" would be a second definition of a
grammar that has one. A discriminant the parser supplies and this module only carries does not
decide anything. The doc gains that distinction explicitly.

The trade this buys is a compile error in place of a test. `Language::symbol_kind` (`language.rs:97`)
exists in its current form because a review pointed out that `document_symbol` had its own match
naming `Redextape | Lambda`, unreachable only because `nav` answered `None` — so teaching `nav`
about `.rxt` would have made every `fn`, `let` and parameter report as one kind with no compile
error and no failing test. `every_form_with_an_index_has_a_symbol_kind` is what holds the two lists
in step today.

**That test is deleted, and the compiler takes over what it watched.** The replacement is a free
function in `language.rs`:

```rust
fn outline_kind(kind: DefKind) -> Option<SymbolKind>
```

exhaustive over `DefKind`, taking no `Language` at all. A new kind is a compile error at one site.
The deletion is stated here because removing a guard a review asked for is a decision, not a
tidy-up.

**`Param` maps to `None`, and that is a third meaning for `None` in this file.** A parameter must
be in the index — go-to-definition on a parameter has to land — but an outline listing every
parameter of every function as a flat sibling of the functions is noise. `outline_kind` answers
"the `SymbolKind` an outline lists this as, or `None` for a definition an outline should not list",
and `document_symbol` filters on it. The name is `outline_kind` rather than `symbol_kind` because
the two questions genuinely differ and the old name answered only one.

The mapping:

| `DefKind` | `SymbolKind` | why |
|---|---|---|
| `State` | `Class` | unchanged from PR A — a place the machine can be in |
| `Label` | `Function` | unchanged from PR A — a point in a program |
| `Fn` | `Function` | |
| `Let` | `Variable` | |
| `Param` | `None` | navigable, not outlined |

---

## §6 The LSP surface

- `Language::nav` gains `Language::Redextape => Some(redextape_core::binder::nav_rxt(src))`, the
  module being `pub mod binder;` beside `pub mod nav;` (`lib.rs:25`).
  `Language::Lambda => None` stays, on the reason already recorded: `.rxlambda` terms are de
  Bruijn-indexed and carry no source positions.
- `document_symbol` (`lib.rs:326`) replaces `doc.language?.symbol_kind()?` with a per-occurrence
  `outline_kind`, and filters the `None`s.
- `definition`, `references` and `dangling_like` need no change at all. They read the index through
  `definition_of`, `references_to` and `at`, and every one of those already answers on links rather
  than on names — which is what PR A's §2.4 built one PR early, for this PR.
- **Two existing tests assert the absence this PR removes, and both invert.**
  `only_the_two_artifact_forms_have_a_navigation_index` (`language.rs`) asserts
  `Language::Redextape.nav(...).is_none()`; its name and its body both change.
  `document_symbol_is_null_for_a_form_this_server_does_not_index` (`lib.rs:1267`) opens a
  `.rxt` buffer holding `fn f() { 1 }\nf()\n` and asserts `null`, under a comment reading "A `.rxt`
  buffer is served diagnostics and formatting and no navigation" — after this PR that buffer has an
  outline listing `f`. The test moves to `.rxlambda`, which is the form the assertion is now true
  of, and the `.rxt` case it vacates becomes a positive test: that same source yields exactly one
  outline entry, `f`, as `SymbolKind::Function`.

---

## §7 Testing

Each of these names the sabotage that must redden it. **A property this spec claims a test holds up
is a claim to check**, and the branch this one follows shipped three tests that could not fail.

1. **Shadowing resolves to the binding, not the name.** `let x = 1; let x = x + 1; x` — the
   right-hand `x` links to the first `let`, the tail `x` to the second. Asserting *indices*, not
   names: every occurrence here is called `x`, so a name-only assertion passes against everything.
   Sabotage: resolve outermost-first.
2. **A parameter shadows an outer binding.** `let x = 1; fn f(x) { x } x` — the body's `x` links to
   the parameter, the tail's to the `let`. Sabotage: skip the parameter bind.
3. **A `fn` forward-references its own run and not past it.** `fn a(n) { b(n) } fn b(n) { a(n) } 0`
   resolves both ways. The negative needs a run boundary between the two:
   `fn a(n) { b(n) } let z = 1; fn b(n) { n } 0` must leave the `b` inside `a` **dangling**, which
   `analyze` confirms is the language's own answer — it reports ``unbound variable `b` `` on that
   source and nothing else. Sabotage: bind each `fn` in turn instead of the run.
4. **`definitions()` is in source order when the walk order is not.** An `if` with definitions in
   both arms — the worklist pops `else_blk` first. Sabotage: drop the sort; assert spans, and
   choose names so source order and alphabetical order disagree.
5. **A left-nested chain near `MAX_TOKENS`/2 indexes without overflowing.** Sabotage: make the walk
   recursive.

   **THE OBVIOUS VERSION OF THIS TEST CANNOT FAIL, AND THE PRECEDENT THAT SAYS SO IS IN THE SAME
   CRATE.** `.cargo/config.toml` sets `RUST_MIN_STACK` to 32 MiB, so a default test thread is far
   too large to overflow at any depth this input can reach — a recursive binder would pass. The
   `drop_tests` module (`lib.rs:243`) exists under a doc comment stating exactly this, and every
   test in it runs its body on an **explicit 512 KiB thread**. This test does the same, at the same
   40,000 depth those use. It must also call `nav_rxt` and nothing else: `analyze` recurses to
   `MAX_TYPE_DEPTH = 1500` and overflows 512 KiB on its own, which would redden the test for a
   reason that is not the one it is about.
6. **A file that does not parse still indexes.** Two fixtures, both probed at `1412686` rather than
   assumed:
   - `let x = ; x` — one diagnostic. `Let` keeps `name: "x"` with an `Expr::Error` value, and the
     tail `Var x` at `10..11` resolves to it. The binding under the cursor survives losing its
     right-hand side, which is the property B1 shipped.
   - `fn f(a) { a` — one diagnostic, unclosed body. Yields `f`, the parameter `a`, and the body's
     `a` resolving to that parameter.

   **`fn f(a) { a + ` was this item's fixture until it was probed, and it does not hold the
   property.** The trailing `+` makes recovery swallow the body into a single
   `Stmt::Error { span: 10..13 }` with `tail: None`, so the body's `a` is not in the tree at all
   and the test would have asserted an occurrence that cannot exist. It is recorded rather than
   quietly swapped, because the failure is the one this project keeps meeting: a fixture chosen by
   reading the grammar instead of running it.
7. **An assignment target is a reference.** `let mut x = 1; x = 2; x` — three occurrences, one
   definition. Sabotage: push the target as a definition; `documentSymbol` would list `x` twice.
8. **A method name resolves.** `fn m(v) { v } 1.m()` links the `m` in the call to the `fn`.
9. **A block-scoped binding does not escape its block.** `let g = { let y = 1; y }; y` — the inner
   `y` at `21..22` resolves to the inner `let`, and the trailing `y` at `26..27` dangles. Sabotage:
   never truncate the scope, which makes the trailing `y` resolve. The bare-block form
   `{ let y = 1; y } y` was rejected as this fixture: the trailing `y` parses as a `Stmt::Error`,
   so there is no occurrence to assert on.

---

## §8 What this does not do

- **`documentSymbol`'s `range` stays `enclosing_line`.** A multi-line `fn` folds to its header
  line. Widening it to the statement's span means `Occurrence` carrying a second span that all
  three parsers supply, for outline folding rather than for navigation. The protocol requires only
  that `selection_range` be contained by `range`, which holds as written.
- **`let x 1;` — a name present, the `=` missing — still discards the binding**, exactly as B1 left
  it (`parser.rs:391`–`396`). `parse_let` propagates on the missing `=` before there is a
  `Stmt::Let` to hold a placeholder. The blind window is narrow: the moment `=` is typed,
  `Let { name, value: Expr::Error }` appears and the binding is live, so the cost is an outline
  entry flickering rather than a jump that lands wrong, and no reference to a name still being
  typed exists to jump from. Left to its own change rather than folded into a PR that already
  changes the parser's data.
- **No recovery, no index and no navigation for `.rxlambda`.** Unchanged, and recorded in the
  earlier navigation slice as separate design work.
- **No incremental sync.** `textDocumentSync` stays `FULL`, for the reason the two prior slices
  already record.
- **No rename, no hover, no semantic tokens.** The index would serve the first two; neither is in
  this slice.

---

## §9 Verification

Every `file:line` in this spec was read at `1412686` rather than remembered. The figures, each with
the command that produced it:

| figure | command | result |
|---|---|---|
| 16 `params` sites in 5 files | `grep -rn "Stmt::Fn {[^}]*params\|Expr::Lambda {[^}]*params" --include='*.rs' crates \| wc -l` | `16` |
| per-file split | the same with `grep -rc ... \| grep -v ':0'` | desugar 6, typeck 3, parser 3, lints 2, printer 2 |
| `ast::` outside the crate | `grep -rn "ast::" --include='*.rs' crates \| grep -cv redextape-core` | `0` |
| serialised AST copies | `grep -c "cfg_attr" crates/redextape-core/src/ast.rs` | `0` |
| `nav::Role` consumers outside `nav.rs` | `grep -rn "Role::" --include='*.rs' crates \| grep -v "src/nav.rs"` | 7 lines, all `lambda/syntax.rs`'s unrelated `Role` |
| `MAX_TOKENS` | `grep -n "pub const MAX_TOKENS" crates/redextape-core/src/parser.rs` | `100_000` |
| `SymbolKind::Variable` exists | `grep -rn "SymbolKind::Variable" <gen-lsp-types-0.11.0>/src` | `enumerations.rs:574` |

**Every fixture in §7 was run through `parse_recovering` before being written down**, via a
throwaway `examples/` probe deleted afterwards. That pass rejected three of them: `fn f(a) { a + `
(§7.6), `{ let y = 1; y } y` (§7.9), and the negative half of §7.3, which named a fixture with no
`b` inside `a` to be unresolved. Each had been chosen by reading the grammar, each looked right,
and none held the property its test would have asserted. The deep-chain measurement is from the
same probe: 20,000 terms parse to a `Binary` chain 19,999 deep in 1.7 ms release.

The two figures this spec does **not** state as numbers, because no gate holds them and a count in
prose goes stale silently: the size of the `binder.rs` diff, and the number of tests added. §7
states the properties instead.
