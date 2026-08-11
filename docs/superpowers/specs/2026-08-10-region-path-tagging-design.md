# Tagging the region path — the loop programs 5c could not name

**Status:** design. Follow-up to Plan 5c (`2026-08-10-plan5c-dual-focus-design.md`), which
built the provenance tag and the running focus but tagged only the functional lowering path.

**Line numbers below are as of `8a017a5` and are given sparingly.** Symbol names are the durable
reference; every pointer in this repo's specs rots as later slices move code, which was verified rather
than assumed — five merged specs carry pointers that the 5c branch alone invalidated. Prefer the symbol.

## §0 The gap, measured

5c's closing entry named this the single highest-value follow-up and left one question open: *whether
those constructs even have a taggable root `App` was not investigated*. It has been now — see §1.

The rates, from `owner_probe` on current main (re-run 2026-08-10, reproduces the recorded table
cell-for-cell):

| program | tagged (Exact+Within) | None |
| --- | --- | --- |
| `while4` | 38/470 = **8.1%** | 91.9% |
| `countdown4` | 43/474 = **9.1%** | 90.9% |
| `sum5` | 456/626 = 72.8% | 27.2% |
| `map_fold` | 483/555 = 87.0% | 13.0% |

**The recursive programs are already well covered; the loop programs are an order of magnitude worse.**
That is one fact, not two: `lower.rs` has five `app_owned` sites and all five are in `lower_expr`, the
functional path. `lower_region_body` — the store-passing path, which handles both `Let` arms, `Seq`,
`Assign`, `While` and `If` in region position — has **none**. So a loop program's store-passing spine,
its `fix` loop machinery and its store rebuilds are untagged, which is why its steps report `None`
rather than `Within`: they sit under no tagged `App` at all.

## §1 The lowering change

### What is taggable, resolved

`Owner` rides an `App`. A construct is taggable exactly when the term its lowering arm returns has an
`App` at the root:

| construct | root the arm returns | taggable |
| --- | --- | --- |
| `Let { mutable: true }` | `app(abs(STORE, cont), new_store)` | **yes** |
| `Let { mutable: false }` | `app(abs(name, lb), lv)` | **yes** — the shape `lower_expr`'s `Let` arm already tags |
| `Seq` | `app(abs(STORE, cont), first_store)` | **yes** — same shape again |
| region `If` | `app(app(lc, lt), le)` | **yes** — the shape `lower_expr`'s `If` arm already tags |
| `While`, store position | `app(app(fix(), g), s_init)` (`build_while`) | **yes** |
| `While`, value position | `encode::church(0)` — `in_position` discards the loop | no, and correctly: nothing runs |
| `Assign` | `store_of(..)` = `abs("sel", ..)` | **no — the root is an `Abs`** |
| region entry (`lower_region`) | `app(abs(STORE, body), initial_store)` | yes, but deliberately not taken — see below |

### Five sites

Both region `Let` arms, `Seq`, region `If`, and `While` in store position — each switching `app` to
`app_owned` with the id its own arm already binds. `build_while` gains a `NodeId` parameter, the only
signature change in the slice.

**The two `Let` arms were missed in this design's first draft and found while writing the plan.** They
matter more than their late arrival suggests: `while4` opens `let mut n = 4; let mut acc = 0;`, so the
mutable arm fires twice in the smaller of the two loop programs, and the immutable arm is the same
functional-versus-region inconsistency as `If` — `lower_expr` tags `Let`, `lower_region_body` did not.

**Neither creates the duplication §1 rejects for the region entry.** `lower_region` is entered only for
`Let { mutable: true }`, `Assign`, `While` and `Seq`, so an immutable region `let` can never be the
region root. A mutable one can — but the entry `App` it would tag is a different node from the one its
own arm builds, and the entry stays untagged regardless.

**Nothing else moves.** `Owner`, `reduce_step_go`, `ZipperCursor`, `LambdaState`, the wire types are all
untouched. `app_owned` is the same constructor the five functional sites use, and the tag-survives-β
machinery is construct-agnostic.

### Why the region entry is NOT a sixth site

`lower_region(node)` and `lower_region_body(node)` are called with the *same* node, so tagging both puts
one `NodeId` on two distinct `App`s. That breaks the invariant
`lambda_provenance.rs::region_constructs_tag_their_own_roots_without_duplicating` pins — *exactly these
tags, nothing more and nothing less* — and makes "the construct's own root App" no longer unique;
`a_while_in_value_position_carries_no_tag` would also start failing, since tagging the region entry tags
a term that is discarded rather than run. (`lowering_tags_each_core_construct_at_its_own_root`, the older
invariant test, does NOT catch this: its fixture is purely functional and never enters `lower_region`.)

The codebase already hit this in the parallel source-map machinery and resolved it in the same
direction, in `lower_region`:

```rust
// `lower_expr` already recorded `node` against this whole term; `lower_region_body` recorded it
// again, at `mb`, against the store-lambda's body. Keep the outer (larger) one only.
origins.drop_at(mb);
```

`origins` entries can be dropped after the fact; **tags cannot** — terms are immutable once built. So
the clean move is not to mint the duplicate at all. The region entry `App` is store plumbing
(`(\$store. body) initial_store`), not a user construct, and whichever construct is the region root is
tagged by its own arm inside.

### `Assign` stays untagged, and this is not a gap to close later

An assignment lowers to a rebuilt store, and a store is `\sel. sel s0 … s(k-1)` — a lambda. There is
nowhere on it to hang a tag. Synthesising one would mean inventing an `App` that reduction then steps
through, which contradicts the premise the whole coordinate system rests on (*the tag is inherited,
never recomputed*; design 5c §2.1) and costs a β-step per assignment.

It also buys less than it appears to. **An assignment's value expression is already tagged** — `acc + 1`
is a `BinOp` and goes through `lower_expr`. What is untagged is the store rebuild, and once `Seq`
carries a tag that rebuild sits inside the `Seq`'s own `App`, so its steps report `Within(Seq)`. A true
and reasonably narrow answer, arrived at without inventing a node.

## §2 The measurement and its gate

**Instrument:** `owner_probe`, unchanged, on the same nine programs, under the cgroup cap its module doc
specifies (`MemoryMax=2G MemorySwapMax=0`, driving `LambdaCursor` and never `reduce_trace`).

### M1 — the success threshold, pre-registered

**The tagged rate on `while4` and `countdown4` must at least double: ≥16.2% and ≥18.2%.**

Fixed here, before the measurement, and not renegotiated after it — the same discipline 5c applied to
its own 60%. The point of writing it down in advance is that it cannot be adjusted to whatever the run
happens to produce. Missing it means the tagging did not reach the steps that matter, and the slice
reports that rather than shipping.

### M2 — the gate, unchanged in form

Median `Within` span as a fraction of program length, per program. Today exactly one of nine crosses
60% (`sum5`, 65.0%, every one of its 402 `Within` steps resolving to the same span). **If the re-run
puts two or more over, §3 runs before merge. If it stays at one, §3 does not run** and the slice is
lowering plus tests.

`while4`'s `Within` median is 6.5% today and will move sharply once `While` carries a tag — its loop is
roughly half the program text. That is the expected mechanism, not a result to explain away.

### The threshold's scope changed, and that is why §3 exists

The 60% rule was derived when a wide `Within` competed against a *narrower* `Within`. After this change
the alternative, for the steps in question, is `None` — no highlight at all. "You are somewhere inside
this loop" is worth more against nothing than against a tighter answer. That is the argument for
responding to width per-frame (§3) rather than demoting `Within` globally, and it is why the gate's
*form* is kept while its *remedy* is reconsidered.

**Both tables — before and after — land in the roadmap's closing entry**, so the next slice inherits
numbers rather than an impression.

## §3 Width-aware rendering — CONDITIONAL on §2

Runs only if M2 puts two or more programs over 60%.

**The rule:** a `Within` whose source span exceeds 60% of program length renders weakly. Everything else
renders as it does today.

**60% is reused, not reinvented.** The per-frame rule and the corpus gate become literally the same
threshold; two numbers would need two justifications and could drift apart.

**`within` only — not `exact`, not `coincident`.** `Exact` says *this step IS this construct*, a strong
and true claim regardless of the construct's size, and M2 was never about it. `Coincident` is the rarer
and more informative signal and keeps winning outright. Width modulates exactly the claim whose
usefulness degrades with width.

**The weak treatment is an edge rule instead of a wash — and note it REPLACES rather than keeps.**
`.is-focus-within` today is `background` only, a 10% wash with no edge at all; `.is-focus-exact` is the
one carrying `box-shadow: inset 0 -2px 0`. So `is-focus-within-wide` is not "within minus the wash": it
drops the wash *and* takes an edge the within treatment never had, at reduced weight against
`.is-focus-exact`'s 2px solid.

The gate's original wording said "status line, not highlight". That is rejected here: `#link-status` is
item 6 on the deferred-a11y list as a live-updating `<div>` that announces nothing, 5c already
*aggravated* it by adding a second job to it, and a third job in a slice with no a11y budget makes a
known problem worse. The edge also wins on its merits — a 51%-wide block of faint tint reads as noise,
where a rule under the range reads as an extent.

**The risk this carries, stated rather than discovered:** a 2px solid rule spanning half a program can
be *louder* than the 10% wash it replaces, which would invert the intent. Reduced weight is the
mitigation and the eyeball gate is what settles it — this is a real thing the gate must judge, not a
formality it rubber-stamps. If the edge cannot be made to read as weaker than the wash at that width,
the fallback is the status line after all, and the a11y cost gets paid.

**Shape, all in existing seams:**

- `link.ts` gains a pure predicate (span + program byte length → wide), unit-testable in `tests/node/`
  exactly as `runningFocus` and `isCoincident` already are.
- `highlight.ts`'s `setFocus` claim widens to include `'within-wide'` → `is-focus-within-wide`.
- `style.css` gains one rule for `.is-focus-within-wide`: an edge, no background, weighted below
  `.is-focus-exact`'s. Both operands stay `light-dark()`, so it is theme-aware without a second
  declaration, matching every other rule in that block.
- **Program byte length is recorded once per compile, alongside `index`** — never recomputed per frame.
  Spans are bytes and `doc.length` is UTF-16, so the conversion needs a real encode, which the record
  loop must not pay once per frame.

## §4 Testing

### The equivalence gate has no region coverage at all today

All six cases in `zipper_equivalence.rs::curated_shapes_agree_step_for_step` are purely functional —
arithmetic, let chain, conditional, recursion, list, higher-order — and `arb_expr_over` emits only `+`,
monus `-`, `>`, `==` and `if` over integer leaves, as that file's own comment states. **So the strongest
gate in the crate, the one holding both β-loops equal on whole `StepEvent`s including `owner`, never
executes a `while`, a `let mut` or an assignment.**

Pre-existing, but this slice walks into it: the new tags live entirely in the region path, and the
zipper derives `Owner` from a reverse frame scan where the reducer carries it down a descent.
`build_while`'s `fix`-based spine is deeper and differently shaped than anything that gate currently
sees — precisely where two routes to one answer can diverge.

1. **Add a loop program to the curated cases**, and extend `OwnerCensus`'s anti-vacuity assertion so the
   run must actually *observe* region tags. Without that the added case passes while proving nothing,
   which is the exact failure `OwnerCensus` exists to catch.

### Lowering

2. **Region analogue of `lowering_tags_each_core_construct_at_its_own_root`**: on a loop program the
   tagged set must be exactly the expected ids. This is what catches the region-entry duplication §1
   designs out — without it, re-adding that tag is invisible.
3. **`While`'s tag must resolve to the loop's own source text**, not the whole program. The same
   assertion 5c added for `Let`'s span and for the same reason: if it resolved wider, the entire
   `Within` non-degeneracy argument collapses.
4. **`While` in value position stays untagged** — a test that fails if someone later "fixes"
   `in_position` to stop discarding the loop.

### Propagation

5. **Nothing new needed.** The `shift`/`subst`/`beta_go` tests and
   `a_full_reduction_never_produces_a_tag_that_was_not_in_the_source_term` are construct-agnostic; the
   new tags inherit that coverage.

### Web — only if §3 runs

6. Node unit tests for the width predicate: exactly 60%, either side, and a zero-length guard.
7. One browser case asserting a wide `Within` takes `is-focus-within-wide` and a narrow one does not.

### The probe stays a probe

Run manually under the cgroup cap and recorded in the roadmap, not converted into a test — same as 5c.

## §5 What this slice does not do

- **`Assign` is not tagged.** §1 gives the reason; it is a decision, not a deferral.
- **The M2 threshold is not re-derived.** Its *form* is kept and only its remedy is reconsidered (§2).
- **Playback legibility is untouched.** `PLAY_MS`, dwell-and-decay and a step-to-next-tagged-step control
  are 5c's other recorded follow-up and stay separate; this slice changes what is nameable, not the rate
  at which names go past.
- **No accessibility work.** Deferred to the one pass gated on 5d's controls settling. §3 is shaped to
  avoid *adding* to that debt, which is not the same as paying it down.
