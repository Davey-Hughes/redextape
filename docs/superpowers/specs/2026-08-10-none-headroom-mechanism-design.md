# Where the untagged β-steps actually are — the mechanism behind #28's 96.2%

**Status:** design. Follow-up to region-path tagging
(`2026-08-10-region-path-tagging-design.md`, PR #28), whose closing entry ends with an explicit
instruction to this slice: *"The 96.2% names a quantity, not a mechanism… The next slice's first job
is to answer that, not to assume the figure is a promise."*

**This produces a probe and a decision, not a feature.** No shipped code changes. Its whole output is
three tables and a verdict on whether the contractum-inherits slice gets built at all.

**Line numbers below are as of `5e9b227` and are given sparingly.** Symbol names are the durable
reference; every pointer in this repo's specs rots as later slices move code. Prefer the symbol.

## §0 What is already established, and the one thing it does not say

`none_probe.rs`, run under the cgroup cap and reproduced independently by the controller:

| program | `None` steps | zero tags left (consumed) | ≥1 tag alive (headroom) |
| --- | --- | --- | --- |
| `while4` | 397 | 15 (3.8%) | **382 (96.2%)** |
| `countdown4` | 397 | 15 (3.8%) | **382 (96.2%)** |
| `sum5` | 170 | 2 (1.2%) | 168 (98.8%) |
| `map_fold` | 72 | 8 (11.1%) | 64 (88.9%) |

Consumption is real and confined to a ~15-step end-of-run tail. The tagged-`App` count is
**nonmonotonic** (`while4` runs 9 → 12 → 13 → 15 → 0 across step percentiles), which falsifies a pure
decay model outright. Tags are not a budget being spent down.

**What that table does NOT say is why the redex sits outside the live tags** — and there is a
documented prior which reads the same numbers the opposite way. `reduce.rs`'s `Owner` doc states:

> **`None` IS COMMON AND CORRECT.** `encode.rs` mints every Church/Scott combinator untagged, so
> reducing `40 + 2` is overwhelmingly work inside `plus` and two numerals — code with no source
> construct at all. There is no repair for that and none should be attempted.

On that reading, most of the 382 are combinator interiors, "headroom" is a misnomer, and the right
answer is to build nothing. On #28's reading they are misplaced tags and a propagation rule reaches
them. **Both readings are consistent with every number measured so far, and nothing has counted which
one the 382 belong to.** §1 characterizes the 382 so the two readings stop being equally consistent
with the evidence; §2 prices the rule that only one of them motivates. Neither section alone produces
the verdict — §3's gate reads §2's numbers, and §1 is what makes them interpretable.

## §1 The diagnostic — where the live tags sit relative to the redex

### The structural fact this rests on

`Owner` is derived **purely from the root→redex path** (`reduce_step_go`, which threads `enclosing`
down the descent and never inspects a sibling). `Owner::None` therefore means precisely: *no `App` on
the path from the root to this redex carries a tag.* It says nothing about the rest of the term.

So every tagged `App` that `none_probe` counted alive during a `None` step is, by construction, in one
of exactly two places — **inside the redex's own subterm**, or in a subtree **disjoint** from it.
There is no third case, and neither is currently measured.

### `[POS]` — the split

For each `None` step, over the term entering that step (the same term `none_probe.measure` reads, for
the same reason its doc gives), classify by where the live tagged `App` allocations are:

The redex is an `App` of the form `(λx. b) a`. Its **function** subterm is that `λx. b` — including the
binder — and its **argument** subterm is `a`.

| bucket | definition | what it means |
| --- | --- | --- |
| `fn` | ≥1 tagged `App` reachable from `λx. b` | the redex is machinery about to consume a tagged construct |
| `arg` | ≥1 tagged `App` reachable from `a` | untagged machinery applied *to* a tagged construct |
| `disjoint` | no tagged `App` anywhere inside the redex; every live tag is elsewhere | the redex is pure untagged machinery and the tagged constructs are somewhere else entirely |

`fn` and `arg` are not exclusive and the table reports both plus their union; `disjoint` is exactly the
complement of that union.

**`disjoint` is the bucket §0's two readings disagree about.** It is the case `reduce.rs`'s doc
describes — work inside a combinator with no source construct anywhere near it. **It is a
characterization and not a verdict**, in the direction that matters: a rule that tags contracta can
still reach a `disjoint` step, if the machinery it is running in was produced by contracting a tagged
redex earlier. That is why §2 simulates the rule rather than reading a conversion estimate off this
table — `disjoint` says where the redex is, never where it came from.

Reachability is over **physical allocations**, deduped by `alloc_id` on an explicit worklist — the
convention `count_tagged_apps` already uses, and for the reason its doc gives: under structural sharing
a walk that revisits shared subterms is the hang this probe family exists to avoid, not a measurement of
one.

### `[MACH]` — a hint, and labelled as one

Histogram of the binder name of the `Abs` being applied in each `None` redex (`Node::Abs` carries an
`Rc<str>` name, so this is free). `sel` names a store selector, `h`/`t`/`n`/`c` a Scott list, `m`/`n`
Church arithmetic.

**This table is evidence of nothing on its own and the probe's output says so in its own header.**
`encode::church` mints `f` and `x`, `encode::diverge`'s `omega` mints `x`, and the fixpoint combinator
`lower.rs` builds mints both — a name is shared by constructs with nothing else in common. It is included because a human reading `[POS]` will immediately
ask *which* machinery, and a suggestive histogram beside a rigorous split is better than the same
question answered from memory. `[POS]` is the finding; `[MACH]` orients it.

## §2 The prediction — two inheritance rules, simulated

### The rules

Both apply on contracting a redex whose owner is `Exact(O)` or `Within(O)`; a `None` redex propagates
nothing, since there is nothing to propagate.

- **V1, conservative.** If the contractum's root is an untagged `App`, tag it `O`. Otherwise do
  nothing — and count that, because it is where V1 silently drops a tag. `beta` returns
  `body[x := arg]`, whose root may be a `Var` or an `Abs`, in which case V1 has nowhere to hang `O`.
- **V3, aggressive.** Every untagged `App` in the contractum inherits `O`.

V1 is a lower bound on what inheritance converts, V3 an upper bound. **Reporting both brackets the real
answer instead of guessing one point estimate**, which matters because the intermediate rules (inherit
down to the first `App` on each spine, inherit only through the function side, and so on) are a family
nobody has enumerated and this probe is not the place to.

### Construction — a real cursor paces two shadows

A real `trace::LambdaCursor` drives the run. Two shadow terms — one per variant — step alongside it, each
by a probe-local `shadow_step` mirroring `reduce_step_go` over the public `term.rs` API (`beta`, `abs`,
`app_tagged_for_rebuild` are all `pub`).

**Every step asserts the shadow's redex path equals the real cursor's.** The rules change tags and
never reduction order — `reduce_step_go` chooses its redex structurally and never reads a tag — so path
equality is exactly the invariant that catches a shadow that has drifted from the reducer it claims to
model. It is the load-bearing gate on this whole section: a shadow reducer nobody checks is a second
implementation of the thing being measured, and its numbers would be about itself.

Lockstep also settles a visibility problem rather than working around it. `depth_exceeds` is
`pub(crate)`, so an example cannot install the depth guard `LambdaCursor::next` applies. Following a real
cursor and stopping when it stops inherits the guard instead of reimplementing it — and inherits
`MAX_REDUCTION_STEPS` and the `HitCap` semantics with it.

**Two alternatives were considered and rejected.** Putting the rule behind a flag in `reduce.rs` gives
a divergence-free measurement, but it half-builds the slice before the measurement that decides whether
to build it, and drags the coverage floor and the `-D warnings` gate onto code that may be deleted.
Inferring conversions post-hoc from `none_probe`'s recorded paths needs no new reducer at all, and is
unsound: paths are positions in a term that is rebuilt every step, so "this step is inside that earlier
contractum" cannot be decided by prefix comparison.

### The V3 hazard, which is the one that could wedge the machine

> **CORRECTION (2026-08-10, whole-branch review — this heading's claim is not established, and the
> section below frames the memo as guarding against a measured danger rather than a theoretical one).**
> **What was predicted:** that without the `alloc_id` memo, `retag_all`'s naive recursive rebuild would
> deep-copy the DAG on these four programs and OOM-kill or wedge the machine the way the 60 GiB run that
> motivated this probe family's discipline did — the reading this heading states as settled fact.
> **What was measured:** the plan's own Task 7, Mutation 3 — the memo stripped from `retag_all`, all
> four probe programs run under the same `MemoryMax=2G MemorySwapMax=0` cap — completed to normal form
> on every program, with byte-identical output to the memoized run. No OOM-kill, no wedge, on this
> corpus. **What this shows:** the memo's justification on THIS corpus is theoretical, exactly as Task
> 7's own brief anticipated it might turn out to be ("If it does not blow up, that is a finding worth
> reporting — it would mean these four programs carry less sharing than assumed, and the memo's
> justification is theoretical on this corpus"). It does not show the memo is unnecessary in general —
> `inherit_probe.rs`'s `retag_all` doc now states precisely what is and is not established: sharing loss
> without the memo is real and pinned by a unit test, but the cost that loss was expected to cause on
> this corpus is not. The memo stays. The danger this heading names as the reason it exists does not, on
> the evidence this branch collected.

Re-tagging every untagged `App` in a contractum means rebuilding nodes, and **a naive recursive walk
deep-copies the DAG** — the structural-sharing blowup `max_shared_logical_size` exists to guard against,
and the mechanism behind the 60 GiB run this probe family's discipline was written from.

The re-tag walk is therefore **memoized by `alloc_id`** (old allocation → rebuilt node), so a shared
subterm is rebuilt once and re-shared, sharing is preserved, and cost stays O(physical allocations) per
step — the same order as the `count_tagged_apps` walk `none_probe` already runs per step. The walk is
iterative over an explicit stack, never recursive, for the same reason `count_tagged_apps` is.

The cgroup cap (`MemoryMax=2G MemorySwapMax=0`) remains the backstop, and **an OOM-kill or a timeout is
a result to report, not something to work around by raising the cap.**

## §3 The gate, pre-registered

Fixed here, before any number exists. The point of writing it down in advance is that it cannot then be
adjusted to whatever the run happens to produce.

**FLOOR — V1 must at least double today's tagged rate**, the same standard #28 used, so the bar does not
drift between slices:

| program | tagged today | required | in steps | conversions needed, of 382 headroom |
| --- | --- | --- | --- | --- |
| `while4` | 73/470 = 15.53% | **≥31.1%** | 146 | +73 = 19.1% |
| `countdown4` | 77/474 = 16.24% | **≥32.5%** | 154 | +77 = 20.2% |

**CEILING — the count of degenerate programs must not increase.** M2 calls a program degenerate when its
median `Within` span exceeds 60% of program length. Today that is **1 of these 4** (`sum5`, at 65.0%).
The probe computes span widths the way `owner_probe` does (`SourceMap::source_span`, width as a
percentage of `src.len()`) and reports the median per program under V1.

This half is not decoration. #28's entry names it: `while4`'s `Within` p90 already moved to 53.2%, and
*"anything that widens `Within` further — a contractum inheriting its redex's tag, most obviously —
pushes those medians toward the line that a p90 has already crossed."* A rule that doubles coverage
while making three of four programs degenerate has traded legibility for a number, and the gate should
be able to say so.

> **CORRECTION (2026-08-10, whole-branch review — this paragraph's premise is refuted by this branch's
> own measurement, not by a re-reading of the same numbers).**
> **What was predicted:** that inheritance would WIDEN `Within` spans — the quoted line names "a
> contractum inheriting its redex's tag" as the "most obvious" way medians get pushed toward degenerate,
> and the ceiling exists to catch exactly that failure mode.
> **What was measured:** the clean run's `[GATE]` table shows the opposite. V1 `Within` medians —
> `while4` 6.5%, `countdown4` 5.2%, `sum5` 10.0%, `map_fold` 4.7% — all fell relative to the
> pre-inheritance baseline (reproduced by the same table under Task 7's Mutation 2, V1's inherit made a
> no-op: `sum5` reads back exactly 65.0%, matching the figure this section's CEILING paragraph records
> as "today"). The degenerate count moved from 1 (today) to 0, not up. V3, the aggressive variant, does
> not merely narrow `Within` further — it empties the category: `V3 Within median` reads `-` for all
> four programs, because V3 tags every `App` in a contractum, so a later step's `Owner` is `Exact` or
> `None` and is never `Within` again.
> **Which mutation refuted it:** Task 7's own Mutation 5 — "the M2 ceiling can bite," feed the gate
> V3's medians instead of V1's — changed nothing; `CEILING` stayed `PASS`. Not because the aggressive
> variant is safer, but because with every V3 median absent, the `> 60%` filter has no population to
> count against. The ceiling has never been shown capable of failing for any rule in this family — see
> `inherit_probe.rs`'s `[GATE]` caveat, added in the whole-branch-review fix pass.
> **Why the prediction was wrong, structurally and not just on this corpus:** an inherited tag names the
> redex's OWN construct, which is always at least as near as the enclosing construct it replaces —
> `Exact` is a strictly nearer claim than `Within`, never further. Inheritance can therefore only narrow
> `Within` or convert it to `Exact`; it cannot widen it. The ceiling was built to catch a failure mode
> this rule family cannot structurally produce.

**Both must hold or the contractum-inherits slice is not built.** The gate reads **V1 only**; V3's
figures are reported beside it as the ceiling of the rule family. A rule admitted on the strength of its
most aggressive variant has been chosen by its best case.

**If the gate binds, stop and report** — do not adjust it. #28 is the precedent and the reason: the
threshold bound, the numbers went to the human, and shipping anyway was an explicit decision taken with
the shortfall on the table. That is available here too, and it is the human's call, not the
implementer's.

## §4 Output

Four programs — `while4`, `countdown4`, `sum5`, `map_fold` — the same set and the same source strings as
`none_probe.rs`, so every row is comparable to a row already recorded.

Three tagged tables, `[POS]`, `[MACH]`, `[INH]`, plus the existing `[OV]` totals for orientation. **Each
program's rows are flushed across all tables before the next program's measurement begins**, interleaved
rather than table-by-table, for the reason `none_probe` and `owner_probe` both already give: a kill
mid-run then leaves every table complete through the last finished program, never one table ahead of the
others.

`[INH]` carries, per program and per variant: conversions (`None` → `Exact` or `Within`), the resulting
tagged rate, the resulting `Within` median, and — V1 only — the count of contractions whose contractum
root was not an `App`, i.e. tags V1 had nowhere to put.

## §5 Acceptance — each claim names a mutation AND its expected failure

Per #28's closing rule: *an assertion prescribed by a plan is not evidence that the assertion works.*

| claim | mutation | expected failure |
| --- | --- | --- |
| the shadow reducer matches real reduction order | shadow tries the argument side before the function side | path assertion fires on `while4` step 1 |
| V1 actually tags something | V1's inherit call becomes a no-op | `[INH]` V1 conversions drop to 0 on all four rows |
| V3 preserves sharing | drop the `alloc_id` memo | `map_fold` OOM-kills under the 2G cap |
| `[POS]` classifies against the right term | classify against the post-step term instead of the entering term | the `disjoint` share moves on `while4` — the same pre/post distinction `none_probe.measure`'s doc already pins |
| the M2 ceiling can bite | feed V3's figures to the gate instead of V1's | the ceiling fails if V3 degenerates a second program |

Each mutation is applied, the failure observed, and the mutation reverted — the failure being *observed*
is the deliverable, not the assertion's existence.

## §6 What this does not do

**It does not build anything.** `none_probe.rs`'s successor stays a probe: run manually under the cap,
never in CI, exactly as `owner_probe` and `none_probe` are.

**It does not establish that inheritance is semantically right.** "The work a contractum does belongs to
the construct whose redex produced it" is a claim about *meaning*, and every number here is about
*coverage*. A rule can convert steps and still name the wrong construct — and the `Owner` doc's existing
warnings apply undiminished: the tag names a construct and not a location, and it cannot tell one loop
iteration from its predecessor.

**It does not enumerate the rule family.** V1 and V3 bracket it; the intermediate rules are unmeasured
and the bracket is not a promise that some rule inside it is better than both.

**It does not look at a browser, and it does not touch playback.** Whether the improvement reads as
better at playback speed is 5c's still-open follow-up, untouched by #28 and untouched here. No eyeball
gate runs.

**Four programs, not `owner_probe`'s nine.** `while4` and `countdown4` are the loop family the rule
targets; `sum5` and `map_fold` are the recursive control that a rule aimed at loops must not degrade.
The other five moved not at all under #28 and are too small — `sample`, `num200` at 7 steps, `list2` at
4 — to distinguish anything.
