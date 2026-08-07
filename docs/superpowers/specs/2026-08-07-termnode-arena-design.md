# `TermNode` becomes an arena — closing two recursive paths structurally rather than bounding them

**Status: built.** Amends
[`2026-08-05-plan4-viewmodels-and-wasm-design.md`](2026-08-05-plan4-viewmodels-and-wasm-design.md)
§4.2, §4.3, and §5.1, and closes the hazard
[`2026-08-06-wasm-boundary-completion-design.md`](2026-08-06-wasm-boundary-completion-design.md)
handed forward to PR 3c. Roadmap:
[`../plans/2026-07-19-redextape-roadmap.md`](../plans/2026-07-19-redextape-roadmap.md), Plan 4.

**This slice lands before PR 3c, not inside it.** It is Rust only. PR 3c remains `web/` + the pnpm
migration + arming the `docker` push.

## 0. Why this slice, and why now

PR 3b named this twice and closed neither, deliberately, because it had no way to reach the code path
a human would use. Its roadmap entry reads: *"Measure both paths, or guard the entry point, before PR
3c ships a UI that calls `lambdaAst`."* PR 3c is that UI, and this slice took the first half of that
instruction before writing any code.

**MEASURED FIRST, AND THE MEASUREMENT FALSIFIED THIS DOCUMENT'S OWN PREMISE — corrected here rather
than left standing.** This section originally read *"The hazard is known-real rather than
theoretical."* On the stack this project ships, it is not. §2 carries the numbers: `lambdaAst`
survives every depth the front-end guards admit on the 8 MiB shadow stack PR 3b linked, and neither
recursive path traps.

**So this slice is not a crash fix, and shipping it as one would have been the exact defect the
roadmap's own lesson names** — *"a cost claim is not established until a program chosen to break it
has been run."* A hazard claim has the same shape, and this one had never been run. What survives the
measurement is two narrower reasons, and they are the whole justification:

**One: the bound is a property of today's frame sizes, not of the type.** It holds at 8 MiB, in Chrome
151, at this serde version, with these frames. `MAX_TERM_DEPTH` is 3,000 and the budget there is
~2.8 KB per frame; nothing in the type system keeps it that way. Every future move in any of those
re-opens a question the arena never asks.

~~**Two: the JavaScript side is covered by none of it, and this is now the load-bearing reason.** A
3,000-deep nested object still traps a recursive JS walk or a `JSON.stringify`.~~
**FALSIFIED 2026-08-07 BY MEASUREMENT, AND THIS IS THE SECOND TIME THIS DOCUMENT ASSERTED A HAZARD IT
HAD NOT RUN.** The final whole-branch review caught it: §0 had replaced one unmeasured claim with
another, and called the replacement load-bearing, on a branch whose entire premise is that a claim is
not established until a program chosen to break it has been run. It was then measured rather than
softened, because softening would have repeated the defect a third time.

Measured in headless Chrome (`the_javascript_side_tolerates_the_depths_this_boundary_reaches`,
`tests/browser.rs`):

| operation | breaks at |
| --- | --- |
| `JSON.stringify` on a nested object | **never** — clean at 1,000,000 deep. V8's implementation is not recursive. |
| a naive recursive JS walk | **~15,000** — fine at 15,000, fails by 15,031 |

**Against a reachable depth of 1,805, that is an 8x margin on the only operation that breaks at all,
and no hazard whatsoever on the one the claim named first.** The claim overstated the walk by ~5x and
was simply wrong about `JSON.stringify`.

**REFINED 2026-08-07, and the refinement is the useful part. The right verdict is not "reason two is
withdrawn" — it is "NEITHER REASON IS BINDING AT TODAY'S CAPS, AND ONE OF THOSE CAPS IS ALREADY BEING
HIT."** Both are conditional on a depth ceiling rather than false, and the thresholds are now known:

| what breaks | at what depth | reachable today? |
| --- | --- | --- |
| `JSON.stringify` in a consumer | never | n/a |
| a naive recursive JS walk in a consumer | ~15,000 | no — 8x above |
| the Rust `Serialize`/`Drop` pair | **unlocated, only known to be > 2,100** | no |
| `MAX_TERM_DEPTH`, the cap that bounds all of the above | **3,000** | **YES — see below** |

**The cap is already binding on ordinary programs, which is what makes this more than hypothetical.**
§2's measurement found a recursive `sum(n)` over 100 elements reaching **3,001** — it hits
`MAX_TERM_DEPTH` exactly. That is not adversarial input; it is a hundred-element sum. Depth grows
roughly quadratically with input size on that shape, so a modestly larger program needs a multiple of
3,000, and anyone who wants deeper or larger λ programs must raise that constant.

**That is where the arena earns its place.** Raising `MAX_TERM_DEPTH` under the `Box` shape walks
toward a Rust-side trap depth **nobody has located** — the probes established only that it is above
2,100, because the shape was replaced before the boundary was found. Raising it far enough also puts a
consumer's recursive walk into range of the ~15,000 limit. The arena has no such depth on either side,
so raising the cap becomes a decision about reduction cost alone rather than one that quietly re-opens
a stack question at two layers.

**A third property, structural rather than measured.** `Box` children cost one heap allocation per
node — 42,623 of them for the 200-element fixture in §7 — and one free each at teardown. The arena is
a single `Vec`: a logarithmic number of reallocations and one free. **No timing claim is made here and
none was measured**; the allocation *count* is a fact about the shape, and it is stated as a count for
exactly that reason.

**Stated at its true size**, then: an unbounded recursion removed from a boundary where a trap cannot
unwind, for +227 bytes, no API surface change and one type — defensive today, and load-bearing the
moment `MAX_TERM_DEPTH` moves. A reader weighing whether to keep `lambdaAst` at all (§9.3) should
weigh it at that size, which is smaller than §0 first claimed and larger than "withdrawn" suggests.

**The project has already paid to fix this one type over**, which is why the shape is worth removing
even while it is not biting. `LambdaTerm` — the type `TermNode` is built *from* — carries a
hand-written iterative destructor at `lambda/term.rs:482`, whose own doc opens: *"a deep term (large
lowering / reduction growth) would otherwise recurse once per node in the compiler-generated
`drop_in_place` and abort the process."* `viewmodel.rs`'s `TermNode` reintroduced exactly the shape
that destructor exists to defeat. PR 2's execution ledger recorded the `Drop` half at the time and it
was not actioned; PR 3b promoted it out of scratch into the roadmap; this document closes it.

**Why a trap would be worth avoiding if one did occur.** A wasm trap has no unwinding, so neither path
returns an error — **both poison the module**. The `Drop` path is the worse of the two because it
fires where no caller can see it, and can fire while unwinding from something else entirely.

## 1. Decisions taken

Each was decided during brainstorming; the alternatives are recorded in §9 rather than discarded.

| # | decision |
| --- | --- |
| 1 | **`TermNode`'s children become `u32` indices** into a flat `TermTree { nodes, root }`, so neither `Serialize` nor `Drop` recurses at any depth. |
| 2 | **No depth guard, and no new constant.** The arena removes the quantity a guard would bound; this slice deletes a measurement obligation rather than adding one. |
| 2b | **ADDED 2026-08-07, after measuring: the slice is structural insurance and consumer safety, NOT a crash fix.** The trap this document was written to close does not occur at any reachable depth on the shipped stack. §0 carries the two reasons that survive; §2 carries the numbers. |
| 3 | **`root` is stored, not implied**, though the walk's post-order makes it derivable. |
| 4 | **Arena indices are `u32`, and overflow refuses through the existing `None`** rather than panicking or widening to `bigint` at the boundary. |
| 5 | **The wire shape is measured in a browser test, not asserted from drafted TypeScript** — PR 3b's `Decoded` lesson, applied before the fact this time. |
| 6 | **`lambdaAst` keeps its export and its `node_budget`.** This slice changes the payload's shape, not the boundary's surface. |

## 2. The hazard, verified against the code

**Two recursive paths on one type** (`viewmodel.rs:131`):

```rust
pub enum TermNode {
    Var(u32),
    Abs(String, Box<TermNode>),
    App(Box<TermNode>, Box<TermNode>),
}
```

- **Derived `Serialize`**, reached by `lambdaAst` through `to_value` (`redextape-wasm/src/lib.rs:110`).
  serde's derived impl descends one frame per `Abs`/`App` level.
- **Derived `Drop`**, on the same spine. The compiler's `drop_in_place` walks the `Box` chain the same
  way.

**Both are per-LEVEL, not per-node.** Depth is the governing quantity for each, which is why a single
depth bound would in principle address both — and why removing depth as a quantity addresses both
without a bound.

**The walk that BUILDS the tree is already iterative, and that is the tell.** `to_tree`
(`viewmodel.rs:178`) uses an explicit worklist, and its doc says why: *"the very first term a cursor
holds can already be deeper than a native recursive walk survives."* The construction was made safe;
the two things that happen to the result afterwards were not.

**`node_budget` bounds count, not depth.** Depth ≤ nodes is a loose bound: a 3,000-node budget admits
a 3,000-deep left-nested spine. `tests/browser.rs:102` already calls `lambdaAst` with a budget of
1,000,000.

**Nothing upstream bounds it either.** `trace/zipper.rs:363` refuses to *step* a term past
`MAX_TERM_DEPTH`, but `LambdaCursor::new` performs no depth check at all, so the first term a cursor
holds is unbounded — the correction the companion spec's §4.4 already records. A depth-refused run
therefore *keeps* its deep term, and `lambdaAst` can still be called on it.

**MEASURED, AND THE SHAPE IS REACHABLE WHILE THE TRAP IS NOT.** Both quantities were probed before any
code changed.

*Depth, natively.* A 600-element list literal is **8,403 nodes with a depth of 607** at compile time.
The roadmap's *"thousands of nodes deep"* conflated those two numbers, and the distinction is
load-bearing: depth is what both recursive paths are linear in, so the node count overstates the risk
by an order of magnitude. Under REDUCTION the same program reaches **depth 1,805**, and ordinary
programs go further — a recursive `sum(n)` over 100 elements reaches **3,001**, which is
`MAX_TERM_DEPTH` itself. Depth scales roughly quadratically with list size on un-thunked Church
arithmetic, so 100 elements is not adversarial input. The idiom matters as much as the size: a
`fold`/`add` list-sum reaches only 365, because the list spine forces early collapse.

*The trap, in headless Chrome on the shipped 8 MiB stack.* **It does not occur.** `lambdaAst` was
called repeatedly across the reduction of a 600-element list (peak ~1,805) and of `sum(100)` driven to
depth ~2,100, and returned a tree every time. 10/10 browser tests passed with no cascade — a cascade
being the signature a trap leaves, since it does not unwind. Both paths ran: `Serialize` on every
call, `Drop` on every freed tree.

*The gap, stated rather than papered over.* Depths between ~2,100 and `MAX_TERM_DEPTH`'s 3,001 were
never reached — driving `sum(100)` that far costs several more minutes of browser wall-clock, and the
frame arithmetic predicts the result: 8 MiB across 3,001 frames is ~2.8 KB each, against serde and drop
frames of a few hundred bytes. **That is an extrapolation, and it is labelled as one rather than
reported as a measurement.**

**So the arena rests on §0's two narrower reasons, not on a crash.**

## 3. The types

```rust
/// A λ term as a flat arena.
///
/// `nodes` is in POST-ORDER: every child precedes its parent, so `root` is always
/// `nodes.len() - 1`. It is stored anyway — see §9.4.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TermTree {
    pub nodes: Vec<TermNode>,
    pub root: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum TermNode {
    Var(u32),
    Abs(String, u32),
    App(u32, u32),
}
```

`TermNode` keeps its name. It has three references outside `viewmodel.rs` — an import and a signature
in `redextape-wasm/src/session.rs:17,445`, and a comment in `tests/browser.rs:104` — so renaming buys
nothing and costs spec churn.

**`nodes` is never empty when the result is `Some`.** A term has at least one node, and a zero budget
refuses at the first `Enter`. So `root` always indexes a real element; §7's tests pin it rather than
the type encoding it.

**What this deletes.** `Serialize` on `TermTree` walks a `Vec` whose fields are `u32` and `String`;
`Drop` frees a flat buffer. Neither recurses at any depth, for any input, so `lambdaAst` needs no
depth guard, no interaction with `MAX_TERM_DEPTH`, and no browser measurement of frame sizes.

## 4. The walk

`to_tree`'s structure does not change. Three edits:

1. `results: Vec<TermNode>` becomes `results: Vec<u32>` — a stack of indices, not of subtrees.
2. A `nodes: Vec<TermNode>` arena is threaded alongside. Each completed node is pushed to `nodes` and
   its index pushed to `results`.
3. The `Abs`/`App` arms pop indices instead of subtrees and store them directly.

The `Enter`/`Abs`/`App` marker protocol is untouched, and so is the pop order — the existing comment
at `viewmodel.rs:202` explaining why `a` comes off `results` first and `f` last stays correct verbatim,
because only the element type changed.

**The budget check stays exactly where it is**, before each node is counted and built. §4.4's
reasoning — *"building the tree and then measuring it defeats the purpose"* — is unaffected, and so is
the shared-subterm accounting: a DAG node reached through two parents still becomes two arena entries
and still costs the budget twice.

`to_tree` returns `Option<TermTree>`, assembling `TermTree { nodes, root }` from the single index left
on `results`.

## 5. Index width, and the second refusal

Arena indices are `u32`. `node_budget` is a caller-supplied `usize` and the existing tests pass
`usize::MAX` (`session.rs:719,945`), so the narrowing needs a story rather than an assumption.

```rust
let idx = u32::try_from(nodes.len()).ok()?;
```

**Refusal travels through the channel that already exists.** `None` already means "this term was not
rendered as a tree"; an arena that cannot be indexed is another instance of that, and the caller's
handling is identical. The `unwrap_used`/`panic` lints rule out asserting it away, and `unreachable!`
is not available either — a panic under wasm aborts the module, which is the same reasoning that
deleted the fabricated `"internal: a TM leg with no projected program"` status in PR 3b.

**It is physically unreachable, and is not written as though it were impossible.** 2^32 nodes at
`size_of::<TermNode>()` is on the order of 100 GB. The check costs one comparison per node against a
hazard that cannot occur — which is the price of not having a branch that lies about being total.

**`u32` rather than `usize` is a boundary decision, not a memory one.** wasm-bindgen maps `u64` to JS
`bigint`; `usize` indices would put `bigint` in every node of the payload. `TermNode::Var` already
carries a `u32` de Bruijn index, so the payload stays uniform.

## 6. Error handling

Unchanged in every respect that a consumer can observe.

| condition | result |
| --- | --- |
| λ leg absent | `Err(SessionError::LambdaAbsent)` |
| budget exceeded | `Ok(None)` |
| arena index overflow (§5) | `Ok(None)` |
| otherwise | `Ok(Some(TermTree))` |

`None` still means "no tree", never a partial one. §4.4's argument — a truncated AST is a lie about the
term's shape, where truncated text is visibly truncated — is untouched, and the arena does not weaken
it: a partial arena would be the same lie with an index on it.

`Session::lambda_ast` keeps its signature but for the payload type:
`Result<Option<TermTree>, SessionError>`. `lib.rs`'s export is unchanged except for what `to_value`
receives.

## 7. Testing

**1. The existing tests carry over unmodified.** `session.rs:942`'s
`the_lambda_ast_refuses_a_budget_it_cannot_meet_and_answers_one_it_can` asserts `is_none`/`is_some`
and `session.rs:719` asserts `LambdaAbsent`; none reads the payload's shape.
`viewmodel.rs:310`'s `to_tree_matches_the_term_shape_within_budget` does, and is rewritten against the
arena.

**2. Structural round-trip against the corpus.** ~~Rebuild the nested shape from the arena and assert
it matches the term, so flattening is shown to have moved no structure — not merely to have
compiled.~~ **CORRECTED 2026-08-07 — that is not what the test does, and following it literally would
reintroduce the hazard this slice removes.** The implementation walks the ARENA and the TERM IN
LOCKSTEP over an explicit worklist, comparing each arena node against the corresponding term node as
it goes; nothing is ever reconstructed into a nested `Box`-shaped value, iteratively or otherwise.
"Rebuild" was the wrong verb — a rebuild, however written, recreates the shape flattening exists to
avoid holding at all, while a lockstep walk never holds it. The same conclusion, that flattening moved
no structure, is reached without ever materializing the thing being flattened away.

**The walk must itself be iterative, not merely non-recursive in name.** A recursive lockstep walk
reintroduces the exact hazard this slice removes, inside the test that certifies its removal, and it
would pass on every corpus program while failing on the one shape that matters. Stated here because
it is the obvious way to get this wrong.

**3. The wire shape is measured in a browser test, not designed.** `serde-wasm-bindgen` renders enums
externally tagged, so nodes are expected to cross as `{ Var: 0 }`, `{ Abs: ["x", 3] }`,
`{ App: [1, 2] }` and `TermTree` as `{ nodes: [...], root: n }` — **expected, not asserted from this
document.** PR 3b drafted TypeScript for `Decoded` in a design spec and the real shape differed; the
correction cost a mid-flight defect. The test records what actually crosses, and this section is
corrected in place if the two disagree.

**4. A depth-tolerance test, in a browser — NOT a regression test, because there is no regression to
pin.** §2 measured the recursive shape surviving every reachable depth, so a test asserting "the arena
returns where `Box` trapped" would assert something that never happened. What this case pins instead
is that `lambdaAst` tolerates the deepest terms the guards admit, so a future change that reintroduces
per-level recursion — or that lowers the shadow stack — fails here.

**It must call `lambdaAst` on a REDUCED term, and that is the whole design of the test.** A freshly
compiled 600-element list is depth 607; the same program mid-reduction is 1,805. A test that samples
only the compile-time term pins a depth three times shallower than the program reaches and would stay
green through exactly the reintroduction it exists to catch. So: step the cursor in chunks and call
`lambdaAst` after each chunk, with a budget large enough that the node budget never refuses first —
otherwise the case passes for the wrong reason.

**Gate:** `scripts/check-all.sh --no-llvm` green, browser suite green, and the per-file coverage row
for `viewmodel.rs` — the file absorbing every decision here — checked in the direction PR 3b's entry
establishes as load-bearing, rather than the workspace total.

## 8. Documents this amends

Per project convention, corrections land at the original claim, not only in a new entry.

- **`2026-08-05-plan4-viewmodels-and-wasm-design.md` §4.2** — the type block at its line 263.
- **Same document, §4.3** — `LambdaState::ast`'s signature at its line 287,
  `pub fn ast(c: &LambdaCursor, node_budget: usize) -> Option<TermNode>;`. Missed from this list in the
  original version of this section, which named only §4.2 and §5.1 — corrected 2026-08-07, at its site.
- **Same document, §5.1** — the TS interface at its line 423, `lambdaAst(nodeBudget: number): TermNode | null`.
- **The roadmap's Plan 4 section** — both places recording the two recursive paths as open, marked
  closed, with the note that they were closed structurally rather than bounded.

## 9. Considered and not taken

### 9.1 A depth guard at the `lambdaAst` boundary

The roadmap's own suggestion, and the cheapest diff: `LambdaTerm::depth()` is an O(1) stored invariant
(`lambda/term.rs:99`) and predicts the built tree's depth exactly, since `TermNode` shares the spine
one-to-one. Reusing `MAX_TERM_DEPTH` would follow the precedent `print_lambda_capped` set for this
same hazard on the text path.

**This document originally rejected it for owing a measurement, and that argument is now spent.** §2
took the measurement: the recursion is safe at every reachable depth, so a guard calibrated against it
would be honest rather than hopeful. The rejection stands, on two different legs.

**It would refuse terms that work.** A guard at `MAX_TERM_DEPTH` bounds nothing — the run cannot exceed
that anyway — and a guard low enough to bound something would refuse `lambdaAst` on `sum(100)`-shaped
programs, which §2 measured reaching 3,001 and which render correctly today. It buys safety the
measurement says is unnecessary by removing a capability that works.

~~**And it never reaches the consumer.**~~ **NARROWED 2026-08-07 with §0's second reason, which this
leg rested on.** Measurement put V8's recursive-walk limit at ~15,000 against a reachable depth of
1,805, and `JSON.stringify` never traps — so a nested payload does not force a problem onto the
consumer at any depth this boundary can produce *today*. It would if `MAX_TERM_DEPTH` rose past
~15,000, which §0 now records as a threshold rather than a certainty.

**The first leg stands alone and is sufficient**, because it never depended on the consumer: a guard
would refuse terms that work, to buy safety the measurement says is unnecessary. That is enough to
reject a depth guard without leaning on a conditional argument.

**And a guard ages the wrong way.** §0's refinement is that the arena's value grows when
`MAX_TERM_DEPTH` moves — a guard's shrinks, because a bound calibrated against today's frames has to
be re-derived every time they change, which is the obligation §9.1's original rejection named before
the measurement made it look spent.

### 9.2 A hand-written iterative `Drop` on `TermNode`

Mirrors `lambda/term.rs:482`, and would be *simpler* than that one — `Box` needs no refcount check, so
neither of the two guards that destructor's doc explains is required.

**Rejected on a tax the codebase already documented.** `term.rs`'s own comment records that keeping
`Node` free of `Drop` is what lets its contents *"be destructured BY VALUE below — moving a field out
of a `Drop` type does not compile."* Adding `Drop` to a public view-model type that consumers are meant
to destructure imports that restriction deliberately. It is also the most code of any option here, and
it closes only one of the two paths — `Serialize` would still need §9.1's guard and §9.1's
measurement.

### 9.3 Deleting `lambdaAst` and `TermNode` until a consumer exists

Genuine YAGNI, and it was close. There is no v1 consumer: the companion spec's §6.3 excludes the λ
pane from PR 3c, §4.4 is titled *"Why the λ payload is text"*, Plan 5's λ pane renders
`LambdaState::render`, and the natural structural consumer — Tromp diagrams — is v2. Deleting removes
the hazard outright and shrinks the module.

**Not taken because the capability is wanted and the cost of keeping it is now one small type change.**
The strongest argument *for* deletion is recorded rather than dismissed: designing a wire shape with no
consumer is exactly what got `Decoded` wrong in PR 3b. §7's third test is the answer — measure what
crosses instead of trusting this document — and the arena's shape is far less contestable than
`Decoded`'s was, being a `Vec` and an index rather than a four-state union.

### 9.4 Leaving `root` implied as `nodes.len() - 1`

The walk's post-order makes it true, and a comment could say so.

**Rejected**: it costs 4 bytes to be self-describing, and it puts a convention in the consumer that a
future change to the walk's ordering would silently invalidate. The project already prefers the
explicit form — `2026-07-27-tm-self-describing-header.md` is a whole slice spent on exactly this
trade. §7's round-trip test pins `root` against the post-order property, so the two cannot drift.

### 9.5 `usize` arena indices

Removes §5's overflow branch entirely. **Rejected at the boundary, not in memory:** wasm-bindgen maps
`u64` to JS `bigint`, so every index in every node would cross as a `bigint`, against a `TermNode::Var`
payload that is already `u32`. §5's one comparison per node is cheaper than that asymmetry.

### 9.6 Making `TermTree` non-empty by construction

A newtype guaranteeing `nodes` is non-empty would make `root`'s validity a type-level fact rather than
a tested one. **Rejected as disproportionate**: the invariant is established by two lines in one
function in the same file, the only constructor is `to_tree`, and the field is `pub` for a renderer to
read. A test is the right weight for this.

## 10. Landing order

**One PR, ahead of PR 3c.** Rust only, no JavaScript, no change to the exported surface.

**Likely one commit, and the constraint is the same one PR 3a hit.** The pre-commit hook runs clippy
with `-D warnings`, so `TermTree` cannot land before the walk that builds it and the signature that
returns it — a type no code constructs is `dead_code`. The type, `to_tree`, `LambdaState::ast` and
`Session::lambda_ast` are a unit. The tests and the spec amendments in §8 can be separate commits.

## 11. Open risks

1. **The wire shape is still designed without a consumer**, which is §9.3's argument surviving the
   decision. §7's third test bounds the exposure to "this document is corrected" rather than "PR 3c
   codes against a shape that does not exist", but it does not eliminate it. PR 3c is still the first
   slice that can say whether an arena is what a renderer wants.
2. **The arena makes safety possible, not automatic — and this entry was the honest wording all
   along**, where §0 stated the same fact as a certainty and was wrong to. Measured, a JavaScript
   consumer that walks the payload recursively survives to ~15,000 against a reachable depth of 1,805,
   so it does not recreate a depth problem in its own stack at today's caps. **The risk is deferred,
   not removed:** it returns if `MAX_TERM_DEPTH` rises past ~15,000, and `sum(100)` already sits at
   that constant's current value of 3,000, so pressure to raise it exists now. The flat shape means an
   iterative walk is available without one being forced.
3. ~~**A 600-element list may not be the deepest cheap vehicle** for §7's fourth test.~~ **RESOLVED,
   and the answer was worse than the risk as written.** The concern was that the list might not trap;
   measured, *nothing* traps — see §2, and §0 for what that does to this document's premise. Two
   further findings came out of resolving it, both now folded into §7's fourth test: a freshly
   compiled term is three times shallower than the same program mid-reduction, so the test had to
   move to a stepped cursor; and the deep shapes are `sum(n)`-style un-thunked Church arithmetic
   rather than list literals, since a `fold`/`add` spine collapses early and reaches only 365.

4. **The extrapolation in §2 is the one unmeasured link left.** Depths from ~2,100 to 3,001 rest on
   frame arithmetic rather than a browser run. It would take ~10-15 minutes of wall-clock to close and
   is predicted not to change the verdict, so it was deliberately not spent — but if a future reader
   needs the ceiling proven rather than argued, that is the probe to run.
