# Plan 5b — static click-linking: one construct, lit in three panes

Status: design, 2026-08-08.
Roadmap: [`../plans/2026-07-19-redextape-roadmap.md`](../plans/2026-07-19-redextape-roadmap.md) § "Plan 5".
Predecessors: [`2026-08-07-plan5a-panes-and-history-design.md`](2026-08-07-plan5a-panes-and-history-design.md) (5a-i),
[`2026-08-08-plan5a-ii-state-table-design.md`](2026-08-08-plan5a-ii-state-table-design.md) (5a-ii).
Master design: [`2026-07-19-tm-lambda-visualizer-design.md`](2026-07-19-tm-lambda-visualizer-design.md) §6.2 part 1.

---

## 0. Why this slice, and why now

5a's decomposition gave 5b one line and one estimate: *"§6.2 part 1 — static click-linking: click a
source construct, highlight its λ span and TM state-block"*, new Rust *"yes, small"*. **The estimate was
written before 5a-ii measured the λ side, and it is wrong in one direction and right in two.**

Three legs, and they do not cost the same:

| leg | what exists today | verdict |
| --- | --- | --- |
| source → node | `SourceMap::node_to_source: NodeId → Span` | invert it; small |
| node → TM | `SourceMap::node_to_tm: NodeId → Vec<StateId>`, shipped 2026-07-30 (`9fbd911`) and consumed by **nothing but its own coverage tests** since | 5a-ii's table is the surface; small |
| node → λ | `SourceMap::node_to_lambda: NodeId → Path` | **not small** |

The λ leg has two independent problems, and both were already written down in the tree before this
document existed.

**A `Path` is not a byte span.** The λ pane renders `print_lambda_capped`'s text. Nothing correlates a
path with a byte range in that text. `viewmodel.rs:25-29` prices the gap exactly, in the doc comment
explaining why `LambdaState` has no `redex` field: *"a redex is a `Path` INTO THE TERM, while
highlighting it in `text` needs a byte SPAN, and correlating the two means the printer recording where a
given path lands as it walks — real work in `print_lambda_capped`, touching every recursive arm of
`write_term`."*

**The path coordinate system only exists at step 0.** Paths are root-relative into the *initial* lowered
term; normal-order reduction contracts root redexes, so at step N > 1 a path indexes a structurally
different tree. That is 5c's blockage, and it reaches into 5b the moment the play head moves.
`viewmodel.rs:36-55` records the field that shipped on this mistake and was removed rather than left
`None`: measured on `let x = 40; x + 2`, all seven steps reported the same node.

**So 5b is scoped by that second fact rather than fighting it.** The λ link is **step-0 only, and says
so when it is not available** — §6. That is not a limitation smuggled in; it is the honest boundary
between 5b and 5c, and drawing it explicitly is what lets 5b ship a λ link at all.

**What 5b is not.** It is not dual-focus highlight (§6.2 part 2 — that is 5c and needs a coordinate
system nobody has built). It is not synchronized stepping (§6.3, deferred to v1.5 by the master design).
It does not touch accessibility, which the roadmap defers to one pass at the end of Plan 5, deliberately
and with a list of five known instances.

---

## 1. Decisions taken

| # | decision | § |
| --- | --- | --- |
| 1 | The λ link is **step-0 only**, and the absence is reported at every other step | §6 |
| 2 | A click resolves to the **innermost containing node, with no outward walk** | §4.2, §6 |
| 3 | Linking is **fully bidirectional**: source ↔ λ text ↔ TM state row | §4 |
| 4 | The λ pane shows a **window around the target**, not a highlight in truncated frame text | §5 |
| 5 | The window costs **no new printer machinery** — one print per *compile*, then a JS slice | §2.1, §5 |
| 6 | **Explicit click plus a keyboard command**; any edit clears the link until the next compile | §7 |
| 7 | **One export, `linkIndex(byteBudget)`**, not three — three is three chances to mismatch | §3.1 |
| 8 | Resolution happens **in JavaScript**, over an index shipped once per compile | §4.1 |
| 9 | The index is **columnar typed arrays**, transferred, not an array of objects | §4.1 |
| 10 | The index is shipped **eagerly**; laziness was measured against and rejected | §4.1 |
| 11 | The link print reuses **`LAMBDA_BYTE_BUDGET` (65,536)** — no new constant | §3.3 |
| 12 | **`settled()` is fixed first**, as this slice's task 1, before any 5b browser test is written | §8 |
| 13 | `tokenClasses()` ships here, closing §11.6's class rather than another instance | §3.4 |
| 14 | Lands as **one PR**, unlike 5a — the three legs share one index and have no seam | §10 |

---

## 2. What was measured before this document was written

Three probes, run on the 5a-ii corpus plus two programs written to attack *this* slice's bounds rather
than the previous one's.

**Reproduced by `link_index_probe.rs`, 2026-08-08** — these tables came from a throwaway probe, and a
throwaway probe's numbers rot. The permanent one matches §2.2 **exactly on all twelve rows** and §2.3's
naive figures within 2.4% (`list60`) and 0.36% (`prog200`), the residual being a slightly different
assembly of the rejected shape. Two of its columns had to be corrected first, and the correction is
worth recording because both were *definitional* rather than numerical: a column counting **states**
with an owner is not the same quantity as §2.2's share of **source-mapped nodes** with a TM block, and
serialising `LinkIndex` itself cannot reproduce §2.3's naive figure because its `tm_owner` is already
the dense array the columnar decision introduced. A probe that measures an adjacent quantity is worse
than no probe: it reads as corroboration. The roadmap's standing lesson — *a corpus chosen to be representative cannot
falsify a bound* — landed twice in one day on 5a-ii, so it is applied up front here.

The two adversarial additions:

- **`prog200`** — `let x = 900;` followed by 200 `let yN = N;` bindings, then `x`. A 2,998-byte program.
  This attacks the axis the step-0 term is actually proportional to: **program size**, not run length.
  `while40`, which defeated 5a-ii's tree bound, is irrelevant here — it explodes at step N, not step 0.
- **`num2000`** — `let x = 2000; x + 1`. Nineteen source bytes. This language lowers naturals to **unary
  Church numerals**, so one literal is O(n) bytes of λ text; this is the axis that is genuinely
  unbounded, and it is not program length.

### 2.1 The step-0 term is proportional to the program, not to the reduction

`print_lambda_capped(lower(core), usize::MAX)`, i.e. the whole initial term, uncapped:

| program | src B | step-0 λ B | ratio | λ spans | term depth |
| --- | ---: | ---: | ---: | ---: | ---: |
| sample | 17 | 238 | 14× | 167 | 43 |
| list2 | 6 | 107 | 18× | 68 | 9 |
| while4 | 77 | 858 | 11× | 459 | 38 |
| sum5 | 60 | 617 | 10× | 376 | 33 |
| countdown4 | 97 | 888 | 9× | 469 | 40 |
| map_fold | 257 | 960 | 4× | 589 | 23 |
| num200 | 18 | 874 | 49× | 644 | 203 |
| list20 | 71 | 1,691 | 24× | 1,157 | 43 |
| list60 | 231 | 9,851 | 43× | 7,057 | 123 |
| while40 | 78 | 1,002 | 13× | 567 | 48 |
| **prog200** ⚔ | 2,998 | 88,712 | 30× | 65,413 | 903 |
| **num2000** ⚔ | 19 | 8,074 | **425×** | 6,044 | 2,003 |

**`list60` — the program that made 5a-ii's state table 127,881 rows — is 9,851 bytes of λ text.** The
entire real corpus prints whole in under 10 KB.

**This is what makes decision 5 possible.** Because the λ link is step-0 only, the text it highlights
against is `print(lower(core))`, and that is bounded by the program rather than by any reduction. So
"a window around the target" does not need a windowing printer: print once per compile, index the node
spans, slice in JavaScript. The estimate in §0 that called this expensive was wrong, and it was wrong
because it carried 5a-ii's fear of per-step cost into a per-compile problem.

**The unbounded axis is one integer literal, not program length.** `num2000` is 425× its source. A
`let x = 1000000` would be roughly 4 MB of λ text. The printer's existing budget is the answer, and
truncation is reported rather than hidden — §6 case 2.

### 2.2 The clickable set: the λ leg never dead-ends, the TM leg dead-ends one click in three

For each program, over the nodes `node_to_source` maps — the only nodes a click can ever land on:

| program | mapped nodes | has λ path | has TM block | has both |
| --- | ---: | ---: | ---: | ---: |
| sample | 5 | 100% | 100% | 5 |
| list2 | 7 | 100% | 71% | 5 |
| while4 | 21 | 100% | 81% | 17 |
| sum5 | 17 | 100% | 82% | 14 |
| countdown4 | 24 | 100% | 75% | 18 |
| map_fold | 66 | 100% | 67% | 44 |
| num200 | 5 | 100% | 100% | 5 |
| list20 | 61 | 100% | 67% | 41 |
| list60 | 181 | 100% | 67% | 121 |
| while40 | 21 | 100% | 81% | 17 |
| **prog200** ⚔ | 403 | 100% | **50%** | 203 |
| **num2000** ⚔ | 5 | 100% | 100% | 5 |

Two findings, and the second is the one that shapes the UI.

**The λ leg is empirically total.** Every source-mapped node carries a λ path, on every program
measured. The `Option` stays in the type — see the caveat below — but the common case never fires it.

**The TM leg is absent for one click in three, and that is by design.** 50–82%. `sourcemap.rs`'s module
doc names exactly who is missing: a transparent `Let`/`Seq` binder, a `Lambda`, the callee `Var` of a
statically-resolved or builtin call, and a `Var` whose resolved register is already its destination.
*"THE MAP SAYS NOTHING WHERE THE LOWERING SAID NOTHING. It does not fall back to a surrounding block."*

**This is why decision 2 is "innermost, no outward walk", and why §6 exists.** The obvious alternative —
walk out to the nearest ancestor that has a TM block — degenerates precisely where it is needed: from a
transparent `let` the walk goes `Let` → `Seq` → root, so "nearest enclosing linkable node" frequently
means *highlight the entire program*, which is worse than reporting nothing. Reporting the absence is
therefore the **common path** in this UI, not an edge case, and it has to be built as one.

**The caveat behind the 100% column.** These are programs the λ backend *accepts*. `SourceMap::build`
leaves `node_to_lambda` empty when the λ backend returns `LowerError` — it declines a mutable capture
rather than risk a silent miscompile — so there is a whole-program dead case sitting behind that column
in which no construct has a λ link at all. §6 case 5.

### 2.3 The index does not fit as an array of objects

The TM leg is bounded by the number of **states**, not by the node count. That is the assumption this
design got wrong first and measured second. (The `tm pairs` column below counts `node_to_tm` flattened,
which is what the naive shape would have shipped; §3.1's correction replaces it with a dense
`Vec<i32>` of length `states`, which is the `dense-TM only` column.)

| program | states | tm pairs | λ spans | λ text B | naive JSON B | dense-TM only B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sample | 112 | 77 | 167 | 238 | 6,463 | 6,247 |
| while4 | 580 | 578 | 459 | 858 | 21,791 | 18,848 |
| sum5 | 1,371 | 1,058 | 376 | 617 | 23,226 | 18,884 |
| map_fold | 8,610 | 6,265 | 589 | 960 | 85,097 | 55,505 |
| list20 | 5,515 | 4,404 | 1,157 | 1,691 | 85,712 | 64,171 |
| list60 | 35,715 | 26,484 | 7,057 | 9,851 | **552,724** | 406,011 |
| while40 | 676 | 569 | 567 | 1,002 | 25,531 | 23,053 |
| **prog200** ⚔ | 44,670 | 598 | 48,332 | 65,536 | **1,906,171** | 2,066,608 |

(States are this probe's own measurement. Row counts are quoted from 5a-ii rather than reproduced here —
this probe's `Σ rules.len().max(1)` gives `list60` 101,785, which is a different definition from the one
behind 5a-ii's 127,881, and reconciling two row definitions is not this slice's business.)

**A 1.9 MB object per compile is not shippable**, and the app recompiles on every 300 ms typing pause
(`DEBOUNCE_MS`). Densifying only the TM leg barely helps — `prog200` gets *worse*, because 44,670 dense
slots cost more than its 598 sparse pairs while `λ spans` goes on dominating. **Both legs have to be
columnar**, which is decision 9 and §4.1.

---

## 3. The Rust half

### 3.1 One export, not three

```rust
pub struct LinkIndex {
    /// The step-0 term, printed at the caller's budget. NOT a frame: built once per compile.
    pub lambda_text: String,
    pub lambda_spans: Vec<(Span, TokenClass)>,
    pub lambda_truncated: bool,
    /// Node -> its span in `lambda_text`. ABSENT for a node whose subterm fell past the cut.
    pub lambda_nodes: Vec<(Span, NodeId)>,
    /// `node_to_source`, flattened.
    pub source_nodes: Vec<(Span, NodeId)>,
    /// `owner[state_id]`, `-1` where the lowering said nothing. Dense because `StateId` is dense.
    pub tm_owner: Vec<i32>,
}
```

**`tm_owner` is built BY NAME, not by flattening `node_to_tm`** — corrected 2026-08-08 while writing the
plan, before any code was written. `SourceMap::build_from_program` lowers at `MIN_FIELD_WIDTH` purely to
record which states belong to which node, and `run_tm_described` then **re-lowers, auto-fitting its own
width**. So `node_to_tm`'s `StateId`s index a *different lowering* from the one `TmProgram.states`
indexes, and flattening them into a dense array keyed by the run's `StateId` would mis-attribute most
states in silence. `Session::compile`'s doc already states the invariant that survives: *"The map keys on
state NAMES, which `lower_tm` derives from the instruction stream rather than the field width, so the two
agree on names regardless of which width either used."*

The construction is therefore
`program.states.iter().map(|s| map.tm_owner(&s.name).map_or(-1, |n| n as i32))` — the same resolution
`TmState::window` already performs per step, hoisted to once per compile. `node_to_tm` reaches this
slice through `tm_name_to_node`, which is its by-name inversion, rather than directly.

`LinkIndex` lives in `viewmodel.rs`, which is where the renderer's data contract lives, and its builder
takes the byte budget as a **parameter** — that file's first rule is *"CORE NEVER PICKS A NUMBER"*, and
`LAMBDA_BYTE_BUDGET` is a `web/src/protocol.ts` constant, not a core one.

**Why one struct and not three exports.** All three legs must come from **one compile**. Three exports is
three chances for a caller to hold one program's source index beside another program's λ index; the
`NodeId`s would resolve, most of them to the wrong construct, and nothing would notice. That is the exact
failure `SourceMap` is shaped to remove — it offers no `with_source` setter for this reason, and records
`tm_name_to_node` at the one place both sides are in hand rather than letting it be derived outside. One
struct is that same fix, applied at the boundary instead of inside the map.

**The Session keeps the initial term.** Recording starts the instant a compile lands, so by the time
anything asks for the index the `LambdaCursor` has moved. `Session` therefore holds
`initial_lambda: Option<LambdaTerm>`, which costs one `Rc` bump — `LambdaTerm` is `Rc`-backed and
persistent — rather than re-lowering or forcing the index to be built before recording can start.

### 3.2 `print_lambda_linked`

```rust
pub fn print_lambda_linked(
    t: &LambdaTerm,
    byte_budget: usize,
    want: &BTreeMap<NodeId, Path>,
) -> (String, Classified, bool, Vec<(Span, NodeId)>)
```

- `write_term`, `write_app_fn`, `write_atom` and `parenthesized` thread a `&mut Vec<Dir>`, pushed and
  popped at exactly the three points `Dir` names (`AppL`, `AppR`, `AbsBody`). **The shape is already
  established**: those same four functions already thread `depth` through, incremented only by
  `write_term`'s `Abs` and `App` arms and passed through unchanged on same-node delegation. The path
  pushes at precisely the arms that increment `depth`.
- Entry records `out.len()`; exit records the span, for any path present in the inverted `want`.
- **The span includes the node's parentheses.** `parenthesized` writes `(` before delegating, so the
  entry mark is taken outside it. A highlight lighting `f x` but not the parens wrapping it reads as a
  different subterm than the one clicked.
- **A node past the truncation cut records nothing**, rather than a span clamped to the cut. Same rule as
  everywhere else in this slice and in `sourcemap.rs`: absent, never wrong.
- `print_lambda_capped` **delegates to this**, exactly as `print_lambda_mapped` already delegates to
  `print_lambda_capped` — *"One walker, not two"*, the invariant
  `an_unreachable_budget_is_identical_to_the_uncapped_printer` already pins. An empty `want` must be
  byte-identical to today's output.

**`Path` never crosses the wasm boundary.** The `want` map goes in on the Rust side; only `NodeId`s and
`Span`s come out. `Path = Vec<Dir>` at depths up to 2,003 (§2.1) would be the largest thing in the index
by an order of magnitude, for data no consumer wants.

**Cost is once per compile**, over a walk that already happens, with `want` at ≤403 entries. Nothing
per-step and nothing per-frame — which is the entire reason this does not repeat `lambdaAst`'s failure
at 850 MB against a 32 MB ring.

### 3.3 The budget: reuse `LAMBDA_BYTE_BUDGET`, add no constant

65,536, the same number `results.ts` already prints the normal form at, so *"the largest term this app
will show you"* stays one number rather than two. Measured consequences, from §2.1:

- The whole real corpus fits with room — `list60` at 15% of it.
- `prog200` truncates at 74% of its term.
- `let x = 1000000` truncates hard, and §6 case 2 says so on screen.

`FRAME_BYTES` (512) is emphatically *not* reused. 5a-i measured that number for a **history frame**, a
thing recorded thousands of times; this is one print per compile, and 512 bytes is about a dozen tokens —
a link that would resolve and then almost always report "past the cut" is technically correct and
practically dead.

### 3.4 `tokenClasses()`, deferred twice and still open, ships here

`lambda_spans` crosses columnar (§4.1), which means `TokenClass` crosses as a **numeric discriminant**
where today it crosses as a serde variant *name*. `types.ts:12-22` already documents the hand-copy risk
in `TOKEN_CLASSES` and its residual failure mode; a discriminant makes that failure mode **worse**,
because a reordered enum would silently mis-colour rather than produce an unrecognised string.

5a-i raised this as §11.6 and deferred it; 5a-ii's open-risk 3 recorded it *"unchanged"* and deferred it
again. So: a one-line `analysis::token_class_names() -> Vec<&'static str>` in declaration order,
exported, with a test asserting `TOKEN_CLASSES` equals it. That closes §11.6's *class* rather than
adding a third instance of it. It is small and it is cuttable, but cutting it means the columnar decision has to carry
the drift risk explicitly instead.

---

## 4. The JS half

### 4.1 Columnar, eager, transferred

```
lambdaText              : string        (<= 65,536 B)
lambdaSpanStart / End   : Uint32Array
lambdaSpanClass         : Uint8Array
lambdaNodeStart/End/Id  : Uint32Array   (<= 403 entries)
sourceNodeStart/End/Id  : Uint32Array   (<= 403 entries)
tmOwner                 : Int32Array    length = states.len(), -1 = no owner
lambdaTruncated         : boolean
```

This is 5a-ii's row-index trade — *"one prefix-sum `Int32Array`, 135 KB for `list60` rather than 127,881
objects"* — applied to all three legs at once. Measured against §2.3's naive column:

| program | naive | columnar | |
| --- | ---: | ---: | --- |
| list60 | 552,724 B | **~220 KB** | 9,851 text + 63,513 spans + 4,344 nodes + 142,860 owner |
| prog200 ⚔ | 1,906,171 B | **~689 KB** | 65,536 text + 434,988 spans + 9,672 nodes + 178,680 owner |

And typed arrays are **transferable**, so `postMessage` moves them zero-copy instead of structured-cloning
them. The worker already ships 131 KB frame batches (256 × `FRAME_BYTES`) routinely.

**Why eager rather than lazy.** Building the index only on first click would spare every compile the user
never clicks into — which is most of them, since the app recompiles on every typing pause. It costs one
worker round trip on the first click after each compile, and **that round trip lands in the worst
possible window**: 5a-ii measured the worker starved for **4,679 ms** during recording, and recording
begins the instant a compile lands, which is exactly when a user reads the result and clicks. Latency is
the axis approach A was chosen for; paying it back on the first click of every edit cycle would undo the
choice. Eager keeps a click at zero messages, always.

### 4.2 `link.ts` — the index and four pure functions, no DOM

1. `nodeAtSource(byteOffset): NodeId | null` — the **smallest** interval containing the offset
2. `nodeAtLambda(byteOffset): NodeId | null` — the same over `lambdaNode*`
3. `nodeForState(stateId): NodeId | null` — `tmOwner[stateId]`, `-1` → `null`
4. `linkFor(node): { source: Span | null; lambda: Span | null; states: StateId[] }`

**Linear scan for 1 and 2, deliberately.** ≤403 intervals, measured. 5a-ii reached for binary search
because it faced 127,881 rows and 12–25 MB of duplication; here the intervals are **nested rather than
disjoint**, which makes a correct binary search subtler than the scan, and it would buy nothing
measurable. That difference is worth stating because the two slices look like the same problem.

**`node → states` is derived, not shipped.** One pass over `tmOwner`, cached per node on first use.
Shipping both directions would be the second object `sourcemap.rs`'s module doc refuses to create — two
representations of one association, with nothing checking they came from one lowering.

### 4.3 Link state, and what `origin` is for

`main.ts` holds `{ node: NodeId; origin: 'source' | 'lambda' | 'tm' } | null`. All three panes render
from the single `node`; `origin` drives **scrolling only**:

- click a source construct → the state table scrolls its block into view
- click a table row → the table does **not** re-scroll itself, and the source pane does not move the caret
- click λ text → neither the λ pane nor the source pane scrolls itself

Without `origin` the panes fight: a scroll-into-view triggered by the pane the user is already looking at
moves the thing under their cursor.

### 4.4 What changes where

| file | change |
| --- | --- |
| `crates/redextape-core/src/lambda/syntax.rs` | `print_lambda_linked`; `print_lambda_capped` delegates |
| `crates/redextape-core/src/viewmodel.rs` | `LinkIndex` + builder |
| `crates/redextape-core/src/analysis.rs` | `token_class_names()` |
| `crates/redextape-wasm/src/session.rs` | `initial_lambda`, `Session::link_index(budget)` |
| `crates/redextape-wasm/src/lib.rs` | the `linkIndex(byteBudget)` export, typed-array construction |
| `crates/redextape-core/examples/link_index_probe.rs` | **new**, permanent — §9 |
| `web/src/link.ts` | **new** — the index and four resolvers |
| `web/src/types.ts` | `LinkIndex` type; `TOKEN_CLASSES` pinned against `tokenClasses()` |
| `web/src/protocol.ts` | the `link-index` message |
| `web/src/session-worker.ts` | build after compile, transfer |
| `web/src/session-client.ts` | receive, generation-checked |
| `web/src/main.ts` | link state, `origin`, dispatch, the `link-status` line |
| `web/src/highlight.ts` | the source-pane decoration |
| `web/src/lambda-pane.ts` | the window view |
| `web/src/state-table.ts` | row click, `is-linked` |
| `web/src/style.css` | `is-linked`, `link-status` |

---

## 5. The λ window

Active only when a link is set **and** the λ leg's play head is at step 0. Otherwise the λ pane renders
the history frame exactly as it does today — 5b changes nothing about the pane's default behaviour.

**"The play head" is two play heads**, and the distinction is load-bearing. `main.ts` holds two
independent `History` instances, `lam.hist` and `tm.hist`, each with its own `head` and its own
`following` flag. The λ link's step-0 condition reads **`lam.hist.step === 0` only**. The TM leg's head
is irrelevant to it, and scrubbing the TM pane must not withdraw a λ highlight — the two legs run at
wildly different step counts (`map` is 344,999 δ-steps against a few hundred β-steps), so a shared
condition would make the λ link vanish almost immediately for reasons that have nothing to do with λ.

- Printed λ text contains **no newlines**, so the window is `±CONTEXT` characters, not lines.
- **The window always begins at the target's start** (minus context) and clips the **tail**. A target
  subterm can be most of the term — the root node's span is the whole thing — and hiding a target's
  beginning is the one outcome that makes the feature lie about what was clicked.
- Edges snap **outward** to token boundaries via `lambdaSpan*`, so no name is cut in half. `…` marks each
  clipped side, matching `lambda-pane.ts`'s existing `truncated` affordance.
- Colour: slice `lambdaSpan*` to the window and offset into window coordinates, reusing
  `decorationRanges`' sort / clamp / byte→UTF-16 rules. **Not a second copy of them** — `spans.ts`'s
  `byteIndexAt` doc already argues that case ("ONE HOME, not three"), and `λ` being two bytes and one
  UTF-16 unit means the conversion fires on every term with a binder.
- **The target is marked flat, not nested.** Every token span inside the target range additionally gets
  `is-linked`. A wrapper element would have to handle spans straddling the target's edges; a class does
  not, because the edges are already token boundaries.

`CONTEXT` is a legibility number, not a cost number. Unlike `FRAME_BYTES` and `LAMBDA_TREE_NODES` it
resolves by eye check in real Chromium, not by probe, and the plan should say so rather than inventing a
measurement to justify a value.

**THE WINDOW'S COORDINATE SYSTEM IS BYTES, AND THE SLICE MUST GO THROUGH `byteToIndex`** — added
2026-08-09 after the whole-branch review found the opposite shipped. ~~"This function does no slicing of
its own that could split a character."~~ That sentence was false and load-bearing: `target`, `spans` and
every returned offset are UTF-8 byte offsets, while `text.length` is a UTF-16 count and
`text.slice(a, b)` indexes UTF-16 units. `λ` is 2 bytes and 1 unit, so a clipped window's text is
displaced right by the number of binders before its start while the target and spans stay in byte space.

Measured on `map_fold` in real Chromium: **75 of 257 source offsets produce a head-clipped window; 21 of
those light zero tokens and the rest render mangled text.** It also feeds `data-at`, so **λ→source clicks
resolve to the wrong node whenever the head is clipped** — one of the three directions §1 decision 3
promises was simply wrong. The demo `sample` is 238 bytes of λ text and `CONTEXT` is 240, so it never
clips, which is why every earlier check passed.

The slice goes through `byteToIndex`/`byteIndexAt`, and `map.length - 1` replaces `text.length` as the
end bound. `spans.ts` already owns this conversion in both directions.

**And the tests must contain a binder.** Every fixture in `lambda-window.test.ts` was pure ASCII, so
byte offsets and UTF-16 indices coincided and the entire axis was untested. `lambdaWindow` is the one
function on this slice whose input is *guaranteed* to contain `λ`, and it was the only one tested
without it.

### 5.1 Two scroll authorities, and which wins

Added 2026-08-09; §4.3 specified `origin`-driven scrolling without saying what happens when the table is
already auto-scrolling to the machine's current state, and the omission shipped as a bug — `setLink`
writes `scrollTop` and then `#drawTable` overwrites it in the same synchronous block whenever `Follow`
is attached, which is the default after every compile. Measured on `sum(5)`: a linked block that lands
at `scrollTop` 595 with the table detached lands at 0, entirely off-screen, with it following.

**A link scroll is a direct user gesture and wins for exactly one draw.** Following is automatic
tracking and is not disturbed by it — the next step re-follows, which is correct, because the user asked
to see a construct once, not to stop watching the machine. Implemented as a one-shot pending target
`#drawTable` honours in preference to the follow target for that draw, arming `Follow`'s `#expected`
once rather than twice.

The alternative — having a link detach the table — was rejected for the reason `setLink` already
refuses to touch `Follow` at all: a link is about a construct and following is about the run, and a
click on one must not silently change the other's state.

---

## 6. Five absences, each reported

A new `link-status` line under the source pane. The TM pane's `tm-status` already carries `name · width`
and is the wrong place to overload; the source pane is where the gesture originates and where the echo
lands.

**The source pane always echoes the resolved construct**, in every case below. Without it no resolution
policy is legible — the user cannot tell whether they hit the `x` or the statement containing it, and
decision 2 makes that distinction load-bearing.

| # | condition | source | λ | TM | line says |
| --- | --- | --- | --- | --- | --- |
| 1 | no TM block for this node | lit | lit | cleared | this construct emits no machine states |
| 2 | λ span past the cut | lit | cleared | lit | the term is truncated at 65,536 bytes |
| 3 | `lam.hist.step ≠ 0` | lit | cleared | lit | the λ link is only defined at step 0 |
| 4 | edited since last compile | cleared | cleared | cleared | linking resumes when this compiles |
| 5 | λ backend declined the program | lit | cleared | lit | no λ lowering for this program |

**Case 1 is the common path**, at 50–82% coverage (§2.2), not an edge. **Case 5 is whole-program**, not
per-construct: a mutable capture makes `node_to_lambda` empty, so the λ link is dead for every construct
for as long as that program is loaded.

Cases 2, 3 and 5 are three different reasons the λ pane shows no link, and they are worded differently on
purpose. Collapsing them into one "no λ link" message would tell a user nothing about whether to scrub, to
shrink the program, or to stop using a mutable capture.

---

## 7. Trigger and staleness

**Explicit click, plus a keyboard command.** The source pane is a CodeMirror editor, so a click already
means "place the caret"; a link fires on the pointer event, not on caret movement. Arrow keys and typing
do not link. That keeps linking a deliberate gesture, which matters more once 5d makes all three panes
editable. The keyboard command links at the current caret; its binding is chosen against CM6's default
keymap during the plan rather than guessed here.

This partly anticipates a decision the roadmap took deliberately — all accessibility work is one pass at
the end of Plan 5 — and it is included anyway because a mouse-only primary interaction would have to be
retrofitted rather than adjusted by that pass. It is one binding, not an a11y pass, and the roadmap's
five outstanding instances stay outstanding.

**Staleness keys on generation, never on a shared flag.** Any CM6 document change clears the link and
sets `linkable = false`. A `compiled` message **for the current generation** installs the new index and
sets it true. The index is from the last compile, so the first keystroke shifts every source span in it;
a link resolved against a stale index is the silently-wrong answer this whole design refuses elsewhere.

Keying on a shared state flag instead of on the generation is precisely the `settled()` defect the
roadmap logs — which is §8.

---

## 8. `settled()` is fixed first, as task 1

`web/tests/browser/app.test.ts`'s `settled(view, src)` is what ~20 browser tests use to mean *"the program
I just dispatched has run"*, its documented invariant is **measured false**, and two flakes on 5a-ii
traced to it. `schedule` sets `results.dataset.state = 'running'` synchronously but defers the actual
`client.request` by `DEBOUNCE_MS = 300`, and `request` is the only thing that increments
`SessionClient.#gen` — the filter that drops superseded replies. What is in the tree now is mitigation at
two call sites, not the fix.

5b adds roughly six browser tests. Inheriting a known-broken helper for six more call sites, and then
debugging their flakes as if they were 5b's, is not a trade worth making.

**The fix**: move `#gen += 1` out of `request` and into `schedule`, so stale replies are filtered at
dispatch rather than 300 ms later. The roadmap notes this touches the supersession machinery PR 3c's
review spent a slice getting right, and therefore *"wants its own measurement rather than a drive-by"* —
so it gets one, as task 1, on a clean branch. That is the exact opposite of the reason 5a-ii declined it:
*"changing a helper 20 tests depend on, at the end of a 30-commit branch, is how a green suite becomes a
mystery."* At the **start** of a branch, with nothing else in flight, it is a measurable change with a
20-test regression suite already pointed at it.

If the measurement says the eager bump breaks supersession, the fallback is the roadmap's second shape —
give `settled` a signal tied to the dispatched source rather than to a shared state flag — and that
decision belongs in the plan, informed by the measurement, not here.

---

## 9. Testing

**Rust, and the first one is the strong one.**

1. **Span fidelity, as two properties rather than one.** ~~For every node whose span was recorded
   untruncated, `lambda_text[span]` equals `print_lambda(subterm_at(path))`.~~ — **corrected
   2026-08-08, during Task 3, before the test was written: that oracle's premise is false for most
   subterms.** `Var(i)` is a de Bruijn index resolved against the binders ambient *where it is
   printed*, so re-rooting a subterm that references an outer binder changes what it denotes. Minimal
   counterexample, on a closed term with no free variables in sight: the body of `λx. x` prints `x` in
   context and `?0` extracted, `?0` being the printer's deliberate marker for an index with no binder.
   That comparison tests de Bruijn semantics, not span recording. It splits:

   1a. **The reprint oracle, restricted to closed subterms** (`maxfree() == 0`), which is exactly the
   condition under which extraction is meaning-preserving. The restriction is not a gutting *if the
   fixtures are chosen for it*: an application of closed terms has closed subterms at the root, at both
   `App` arms, and at their arms in turn — the very structure a swapped `AppL`/`AppR` push corrupts.
   The test pins the closed-subterm count per fixture so a later edit cannot quietly reduce it to the
   trivial root case.

   **Closed is necessary and not sufficient, for a second reason with nothing to do with de Bruijn** —
   found during Task 3 by running the corrected oracle, which failed on `(λx. x) (λy. y y)` at `[AppL]`:
   `"(λx. x)"` in context against `"λx. x"` extracted. A subterm's **role** in its parent decides its
   parentheses — `AppFn` wraps an `Abs`, `Atom` wraps anything but a `Var`, `Term` (the root and every
   `AbsBody` slot) wraps nothing — while `print_lambda_mapped` always prints at `Term`. That is the same
   contract §3.2 states as "a recorded span includes the node's own parentheses".
   **The role is predicted, not tolerated.** Accepting "the reprint, or the reprint in parens" would
   pass a node that should be wrapped and is not, and one that should not be and is — the exact `Role`
   dispatch this oracle covers. The last step of the path plus the subterm's own kind determine the
   answer, so the comparison stays an equality.

   1b. **Arm ordering, which needs no reprinting and therefore covers every subterm, closed or not.**
   The function position is written before the argument, so `span(AppL).end <= span(AppR).start`, and
   both sit inside the parent's span. Pushing `AppR` where `AppL` belongs returns the left child's span
   under the right child's path, and this inverts. This is the oracle that actually catches the defect
   the original was reaching for.

   **A second correction from the same task:** every fixture must be **closed**. `parse_atom` rejects a
   free identifier outright — "Everything the backend produces is closed", pinned by the pre-existing
   `free_variable_is_a_diagnostic` — so a fixture like `f (g h)` panics in `parse_ok` before the printer
   is reached at all.
2. **Nesting**: an ancestor's span contains a descendant's, whenever one path is a prefix of the other.
3. **Delegation**: `print_lambda_linked` with an empty `want` is byte-identical to `print_lambda_capped`.
4. **Truncation**: a node past the cut records **no** span — not a clamped one.
5. `tests/sourcemap_coverage.rs` gains the §2.2 claim: for programs the λ backend accepts, every
   source-mapped node has a λ path.

**Vitest unit** — `link.ts`'s four functions: innermost wins on nested intervals; both boundary offsets
(a span's `start` and its `end`); an offset in no interval; an empty index; `tmOwner[s] === -1`.

**Browser tier** — click a construct → source echo, λ window, table rows lit; click a table row → source
lights and the table does not re-scroll; edit → everything clears; scrub to step 1 → λ withheld and TM
stays. Written **after** task 1, against a fixed `settled()`.

**A permanent `link_index_probe.rs`**, following `frame_cost_probe.rs`: the §2.1 / §2.2 / §2.3 tables,
re-runnable. Every number in this document came from a throwaway probe, and a throwaway probe's numbers
rot silently. It runs under the same cgroup cap convention as its predecessor, though it reduces nothing
and holds no cursor.

---

## 10. Delivery shape

**One PR, unlike 5a.** 5a split because its two halves were genuinely separable surfaces — panes and
history, then a state table — with the second able to start from the first's shipped contract. 5b has no
such seam: all three legs read **one index**, resolve through **one `node`**, and render through **one**
`origin` rule, so cutting it in two would mean shipping an index with two of its three consumers stubbed
and a `link-status` line that can only say two of its five things.

Task 1 (§8) is the one part that could stand alone, and the argument for keeping it here is exactly the
argument for doing it first: it exists to make 5b's browser tier trustworthy, so separating it would
either delay 5b by a merge cycle or leave the two to land concurrently and interleave the flakes.

---

## 11. Open risks

1. **`CONTEXT` has no measurement behind it**, by choice (§5). The risk is that an eye check on the demo
   corpus picks a value that is wrong for `prog200`-scale terms, where the window is a keyhole onto
   65,536 bytes. Mitigation is to eye-check at both ends of the corpus, not only at `sample`.
2. **The columnar decision moves `TokenClass` to a numeric discriminant** (§3.4). If `tokenClasses()` is
   cut from scope, this risk is real and unmitigated rather than merely noted.
3. **Task 1 may not land as designed.** §8 names the fallback; the risk is schedule, not correctness.
4. **Nested-interval resolution is the one rule living only in TypeScript** (§4.2). It is pinned by
   Vitest rather than by proptest, which is a weaker tier than the rest of this slice sits on.
5. **`prog200`'s 689 KB index is the largest thing crossing per compile.** It is transferable and it is
   once per 300 ms pause at worst, but no measurement here says what that costs *in the browser* — §2.3's
   numbers are Rust-side sizes, the same gap `frame_cost_probe`'s doc names about `json_b`.

---

## 12. What this settles, and what it hands on

**Settled.** §6.2 part 1, in all three directions rather than the one it asks for. `node_to_tm`, shipped
2026-07-30 and never consumed outside its own tests, gets its first real one. The "is a `Path` usable for
highlighting" question that `viewmodel.rs`'s no-`redex` doc left open is answered **yes, at step 0, via a
recording printer** — and answered without touching the per-step path that made `lambdaAst` unaffordable.
`settled()`, if task 1 holds.

**Handed on.** 5c still needs a λ redex→source coordinate system that survives reduction, and nothing
here builds one — but it now inherits `print_lambda_linked`, which is the *other* half of what 5c needs:
given a coordinate system, turning it into a highlight is solved. 5d inherits a source pane that already
distinguishes a linking click from a caret placement, which is the distinction it needs when all three
panes become editable. The end-of-Plan-5 accessibility pass inherits one more control (`link-status`) and
one more colour-carried state (`is-linked`) — added to the roadmap's list of five, not solved here.
