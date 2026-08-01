# λ shared-subterm guard — design

> **HANG CLOSED 2026-08-01 — READ THIS FIRST.** Everywhere below that says the hang is open, that a
> β-step does not finish, or that the next step is a guard, is **superseded**. The hang was closed by
> fixing the root cause rather than by refusing anything: `term.rs`'s `shift` was Θ(logical) and
> destroyed sharing on every β-step, and `reduce.rs`'s `depth_exceeds` walked the logical tree once per
> step. Both now read `u32`s the constructors maintain. The 512-byte program that did not finish one
> β-step in 13 minutes reduces in **7.48 s**; the two-list counterexample went from **19.0 s in its
> first β-step to under a millisecond**.
>
> **The falsifications in this document stand and are why it is kept.** The quantities are unchanged —
> `max_shared` is still 4 on the counterexample, the corpus maximum is still 684 — so the reasoning
> about *why these guards fail* is unaffected. What is stale is every wall-clock figure and every
> forward-looking "next slice". The **per-redex work budget** named as the successor was never built:
> not falsified, made unnecessary. See the λ section of
> [`../plans/2026-07-19-redextape-roadmap.md`](../plans/2026-07-19-redextape-roadmap.md) and
> `crates/redextape-core/examples/shift_cost_probe.rs`.

**Status: IMPLEMENTED, THEN REVERTED.** Designed 2026-07-31, landed 2026-07-31
(`MAX_SHARED_LOGICAL_NODES` plus `LowerError::TooShared` at the tail of `lower_mapped`, `1652e09`), and
**reverted 2026-08-01 after measurement falsified it — see §10, which is the part of this document to
read first.** A trivially-written two-list program defeats the bound by 2,500x; the mechanism §1 and §2
name is not what `subst` does; and the quantity the guard reads collapses to zero within two β-steps of
the moment it is read. **This is the third design on this hazard to be falsified by measurement.** ~~"and the hang is
open"~~ — closed 2026-08-01 at the root; see the banner at the top of this file.

**What survives, and it is most of the slice.** `lambda::term::max_shared_logical_size` (`b832c89`) is a
sound O(physical) measurement and **stays in the tree with its tests** — the investigation that killed
the guard used it throughout. Two of the guard's four tests stay too, reworded to assert `max_shared`
values rather than refusals: the 699-element list measures 0, the corpus maximum is 684. The refusal, the
constant, the `TooShared` variant and the two tests that exercised refusal are gone.

Every figure in §3 comes from `crates/redextape-core/examples/list_reduction_probe.rs`, committed with
this slice so the table has a repro rather than a quotation. **With the guard reverted the L8–L12 row is
re-derivable again**, which it was not while the guard was in the tree; §3's text below is left as it was
written, so read it as the record of how the bound was calibrated rather than as a live table.
**§9 was reswept 2026-08-01 and no longer reads as though a bound exists:** of its five entries one is
moot, one is answered in a direction it did not anticipate, two survive rephrased, and the last was
never a question — §10 is what happened to it. **§8's test plan is marked the same way, and so are §4,
§5 and §6** — a call site, an error variant and a list of non-goals that the revert respectively
emptied, deleted and left contrasting with nothing. Replaces
[`2026-07-31-lambda-logical-size-guard-design.md`](2026-07-31-lambda-logical-size-guard-design.md),
which was implemented and then withdrawn — see §1. Replaced by no design yet; the successor's shape is
in §10 and routed from the roadmap.

**Scope:** `redextape-core`, λ path only. Zero new dependencies. No printed byte moves.

## 1. Why this design exists, and what killed the previous one

The hazard as it stood: **512 bytes of ordinary surface syntax reach a β-step that does not finish.**
**No longer true since 2026-08-01** — that program now reduces in 7.48 s. Kept in the present tense of
its own moment, because the rest of this section reasons from it.
`lower_group` clones the whole recursive-group tuple once per member (`lambda/lower.rs:453`), which is
linear in the member count and becomes exponential once groups nest, because a member's body is a block
that may declare its own group.

The previous design guarded on the lowered term's **total logical size** at 300,000 nodes. It was
implemented and abandoned before commit, because the existing suite refused it: `lambda/lower.rs`'s
pre-existing `the_guard_admits_a_core_at_the_bound_and_refuses_only_past_it` builds a **699-element list
literal** — chosen only because it sits at the *depth* bound — which lowers to **~497,691 logical nodes
at a logical/physical ratio of exactly 1.000x**. No sharing whatsoever. The size guard refused it.

**That falsified the previous design's central capability claim** ("every such program observed so far
does not terminate anyway"), and the falsification was then confirmed rather than assumed: the
699-element list **reduces cleanly** — `Normalized` in 1,398 β-steps (exactly 2n), 35.2 s, 215 MB peak.
It is a working program.

**The lesson, and the reason this design is shaped differently.** Total size cannot distinguish a large
*working* term from a large *pathological* one, because size is a symptom. The mechanism is
**duplication of a shared subterm**: `subst` copies a shared subterm into every occurrence of the
variable, so a large *shared* subterm makes a single β-step expensive, while a large *unshared* term is
merely large.

## 2. What it measures

```rust
/// Among allocations reachable from `t` with IN-DEGREE > 1, the largest logical size.
pub fn max_shared_logical_size(t: &LambdaTerm) -> u64
```

**In-degree, not `Rc::strong_count`, and this is load-bearing.** In-degree counts references *within the
term*. `strong_count` counts every live handle anywhere, so a caller retaining snapshots — precisely
what `reduce_trace` does by contract — would inflate it, and the guard's verdict would depend on who
happened to be holding the term. **A guard whose answer changes with observers is not a guard.**

One DAG walk computes in-degree per allocation; the result is the maximum `logical_size` over the
allocations with in-degree > 1. **A term with no shared allocations returns 0** — that is the answer for
every unshared term, including the 699-element list, and it is what makes the guard silent on them
rather than merely lenient. Both passes are **O(physical)** — `logical_size` is already memoized per
allocation (`lambda/term.rs`), so a term denoting 2^72 nodes measures in microseconds. Lives in
`term.rs` beside `logical_size`.

## 3. The bound

```rust
const MAX_SHARED_LOGICAL_NODES: u64 = 10_000;
```

Read off measurement rather than derived from a growth law — the previous design records what happens
when a bound is computed from a model instead of a curve.

| | `max_shared` |
| --- | --- |
| 12 of the 46 `FIRST_ORDER_DEMOS` | **0** |
| the other 34 | 4, 6, or 400–684 |
| **corpus maximum** (`fn s0/s1/s2 … s0(4)`, index 31) | **684** |
| nesting family L1–L5 | 122 / 423 / 1,025 / 2,229 / 4,637 |
| **largest observed SAFE** (family L6) | **9,453** |
| **threshold** | **10,000** |
| **smallest observed DANGEROUS** (family L7) | **19,085** |
| family L8–L12 (~~**no longer re-measurable**~~ — **re-measurable again since the revert**) | 38,349 / 76,877 / 153,933 / 308,045 / 616,269 |

10,000 sits inside **`[9,453, 19,085)`** — closed left, open right, derived by substitution below — in
which **no program of either kind was observed between the endpoints**, and leaves **14.6x** headroom
over the corpus maximum. The right endpoint is excluded and that is the half that matters: the guard
refuses iff `max_shared > bound`, so a bound of exactly 19,085 would *permit* L7, the smallest case
measured to hang.

**The comparison is strictly greater** — refuse iff `max_shared_logical_size(&term) > MAX_SHARED_LOGICAL_NODES`
— matching `MAX_LAMBDA_LOWER_DEPTH`'s existing convention, so a term with a shared subterm of exactly
10,000 nodes lowers. Stated explicitly because the withdrawn design left it implicit and a later
correction then got the resulting interval wrong at both endpoints. Working it through by substitution
rather than by reading notation, because that is how the previous error got in:

- permit L6 → `9,453 > B` must be **false** → `B ≥ 9,453`
- refuse L7 → `19,085 > B` must be **true** → `B < 19,085`

So every threshold in **`[9,453, 19,085)`** — closed left, open right — accepts and refuses exactly the
same programs. Check the endpoints: at `B = 9,453`, `9,453 > 9,453` is false, so L6 lowers ✓. At
`B = 19,085`, `19,085 > 19,085` is false, so L7 **would lower** ✗ — the right endpoint is excluded, and
it is the one value in the neighbourhood that admits the hazard. 10,000 is an ordinary member of that
band, not a special point.

**Why that headroom is the right shape.** ~~"Mutual recursion is the only construct in these programs
that produces sharing at all — the 12 corpus programs at zero are everything without a recursive cycle,
and the jump to 400–684 tracks exactly the demos that have one."~~ — **both halves false, and the table
four lines above already said so.** Re-measured by re-running `list_reduction_probe corpus`:

| band | count | which demos |
| --- | --- | --- |
| **0** | 12 | the programs with no `fn`, no `while` and no `head`/`tail` — straight-line arithmetic, `if`, `let`/`let mut`, a bare `\|x\|` lambda, `is_empty`, `cons`, a list literal |
| **4** | 7 | exactly the `head`/`tail` programs (indices 16–22), **none of which has a recursive cycle** |
| **6** | 22 | every *remaining* program declaring a `fn` or a `while` — the recursive-binding scaffolding, whether or not anything recurses. **`fn sum(n) { … sum(n-1) } sum(5)` is here, not in the band below** |
| **400–684** | 5 | indices 28, 29, 31, 32, 33 — and only these five, every one a *mutually* recursive group of ≥ 2 members |

So 34 of the 46 share something, not 34 minus the twelve claimed to be the only sharers. The
discriminator is **group size, not recursion**: the multiplier is `lower_group` cloning the whole group
term once per member (`lower.rs:453`), so a one-member group — which is what a self-recursive `fn` is —
costs the same 6 as a non-recursive one, and only a group of two or more reaches the hundreds.

The headroom conclusion survives the correction, on a narrower premise. It is spent where a legitimate
*large mutual-recursion group* would land, because that is the only shape in this corpus whose
`max_shared` scales with anything the programmer writes; the 4s and 6s are fixed scaffolding costs that
do not grow with the program. What is no longer claimed is that everything else measures zero.

**The capability cost, stated honestly.** Programs refused are those with a shared subterm above 10,000
logical nodes. Everything observed in that range is the nesting family, which is non-terminating at
every level (§6). No working program is known to be refused — but that is a statement about what has
been measured, not a proof, and the previous design's identical-sounding claim is exactly what this one
was written to replace.

### What "safe" and "dangerous" mean here

The nesting family **cannot normalize at any level**: `f0` calls `g0` calls `f0` with no base case. So
"does reduction complete" is the wrong question and was reframed during measurement. **Safe** means
stepping is steady, cheap and low-memory, and the run self-terminates at its step budget. **Dangerous**
means a *single step* hangs and needs an external kill.

Level 7 is the smallest dangerous level, and its failure mode is worth recording precisely: one step
pegged 100% CPU for 15+ seconds without returning, at a peak RSS of only **93.6 MB**. **The hang is
computational, not memory.** This is the first direct evidence for the claim, previously asserted, that
`MAX_REDUCTION_STEPS` cannot fire because control never returns from `reduce_step`.

## 4. Where it runs

**Nowhere — this section describes a call site that was built and then removed (§10.5).** It is marked
the way the withdrawn predecessor marks its own §3, and for the same reason: the *placement* argument
below is not what failed to compile or to measure, so it is kept rather than struck. What failed is the
premise underneath it, and §10.4 is where that is cashed — reading a term-level property **once** is
the defect, because `max_shared` is non-increasing under reduction, so the one reading a lowering-time
guard takes is always the maximum and the cost it is meant to bound climbs afterwards. Lowering time is
where *sharing* is knowable; it is not where a *step's cost* is knowable, and the successor (§10.6)
moves the check into `LambdaCursor::next` for exactly that reason.

At the **end** of `lower` and `lower_mapped`, after the term is built, before `Ok` — the same site the
withdrawn guard used, for the same reason. `too_deep_node` runs at the **start** of the same function
because depth is a property of the input `Core` and is knowable before lowering; sharing is a property
of the output term and is not. The two sit at opposite ends deliberately, and the doc comment should say
so or a later reader will try to tidy them together.

## 5. The error

**`LowerError::TooShared` does not exist in the tree.** It was added (`1652e09`), the blast-radius
prediction below held exactly — the variant compiled with no other edit anywhere — and it was removed
with the guard on 2026-08-01 (§10.5). Kept for the same reason the predecessor keeps its own §5: a
per-redex budget will need an error of roughly this shape, and the argument for a separate variant
does not depend on what triggers it. **The name is the part not to reuse:** `TooShared` is named for a
mechanism the measurement refuted (§10.2), so a successor should be named for whatever it actually
prices, not for this.

```rust
LowerError::TooShared { node: NodeId, max_shared: u64 }
```

Named for the cause. **Deliberately not `TooLarge`** — that was the withdrawn guard's name, and reusing
it would blur the distinction this slice exists to draw. Distinct from `TooDeep` for the reason
`TmRun::TooLarge` is distinct from `HitCap`: a refused program never took a step, and must not be
reported as one that started and hit a cap.

`node` is the root, not the offending `LetRecGroup` — the measurement runs on the λ term, and mapping a
term position back to Core needs the source map, which `lower_mapped` has and `lower` does not.
`max_shared` is the compensation and is the actionable number.

**Blast radius:** there are two distinct `LowerError` types. `lambda::lower::LowerError` is referenced
only in `lambda/lower.rs` and `lambda.rs`, both via non-exhaustive `matches!`; every match site in
`tm.rs`, `sourcemap.rs`, `tm/attribute.rs`, `tm/defunc.rs` and the examples uses the **TM** one. Adding
a variant should compile with no other edits — verified before this design was written, and to be
re-verified rather than assumed at implementation time.

## 6. What this deliberately does **not** close

**Written as the guard's non-goals; it closes nothing now, so read it as the successor's.** The list
below is unchanged and every entry is still open for the reason it gives — what is no longer true is
the implied contrast, that something adjacent *was* closed. The single-step hang is not (§10), so the
first two bullets' "not this guard's job" is now "not yet anyone's". The last bullet is the exception
and stays a finding rather than a non-goal: the TM path was measured and has no analogous hazard. The
imperative in the first bullet ("say this in the doc comment") applied to a doc comment that was
deleted with the constant.

- **Divergence.** The family is non-terminating at every level; L1–L6 still step forever until
  `MAX_REDUCTION_STEPS`. That is correct — divergence is the step cap's job, and the halting problem is
  not this guard's to solve. **Say this in the doc comment**, or the guard will be read as an oracle.
- **Slow but terminating.** The 699-element list takes 35 s. Cost grows ~n³, so it stops being
  comfortable between n=450 and n=500. It terminates in bounded memory, so it is a UX question, and
  Plan 5 already carries the "still running — hit 50k steps" affordance for it.
- **`lower_group`'s duplication**, the root cause. Binding `group` once was measured *not* to close the
  blow-up — it relocates the same expansion to reduction time under call-by-name — and it moves every
  pinned step count and `Origins` path in that function.
- **Target-aware limits.** Nine stack-calibrated depth constants across eight files, needing a WASM
  build to calibrate. Plan 5's first task.
- **The TM path**, measured linear on the same family: 18/69/137/205 instructions at 1/4/8/12 levels,
  `slots` flat at 6–7 against `MAX_SLOTS` = 100,000, `defunc` never reached.

## 7. Something the measurement turned up that belongs in the record

**`MAX_TERM_DEPTH` already bounds large list literals, mid-reduction, and nobody knew.** A list's
*static* depth is 2n+2 — well under 3,000 out to n≈1500 — but reduction grows it to roughly 4n, as the
already-reduced cons prefix nests around the still-unreduced suffix (traversing a reduced cell costs 3
hops against 1 for an unreduced one). So at n≈800 the depth guard fires gracefully with `HitCap`. This
was found by measurement, matches the analytic prediction (`2i + 2n + 2 > 3000` at i≈700, n=800), and is
not something any existing test or comment records.

## 8. Testing

**Written as a plan for the guard's tests; two of these no longer describe the suite (2026-08-01).**
Nothing here asserts a refusal any more — §10.5 lists what was deleted. Marked in place rather than
rewritten, since what was planned is part of the record; the surviving bullets are still live tests.

- **The 699-element list must lower.** The program that falsified the previous design becomes a
  permanent regression test. It lowers fast even though it reduces slowly, so the test is cheap — assert
  both that it lowers and that its `max_shared` is **0**. **Still live, and now in two places:**
  `lambda/lower.rs`'s `a_large_unshared_list_measures_zero_shared_nodes`, and
  `crates/redextape-core/tests/guard_counterexamples.rs`, which also pins the 497,691 logical nodes and
  the 1.000x ratio that make it a counterexample rather than merely a large program.
- ~~**The measured boundary, pinned from both sides:** family L6 lowers (9,453), family L7 is refused
  (19,085).~~ — **GONE. Nothing is refused.** `the_guard_refuses_at_the_measured_boundary` and
  `too_shared_reports_the_measured_size` were removed with the guard (§10.5). With no bound there is no
  boundary to pin from either side, and with the guard gone the L8–L12 row of §3's table is
  re-derivable again.
- **Corpus non-regression:** all 46 `FIRST_ORDER_DEMOS` lower; the maximum is 684, ~~**14.6x** under~~
  — **under nothing; there is no bound to be under.** The 684 itself survives as a pinned measurement
  (`the_corpus_maximum_shared_subterm_is_684`), and the existing three-way oracle still runs every demo.
- **`max_shared_logical_size` is exact** on hand-built cases, including that a term with no sharing
  gives 0 and that a subterm referenced twice is counted once at its full logical size.
- **O(physical):** the fold completes on a term denoting 2^72 nodes. This is the property that
  distinguishes a correct implementation from one that walks the logical tree, and it must be pinned by
  a test that hangs without it.
- **No printed byte moves;** every existing golden, oracle, round-trip and fixture passes unedited.

## 9. ~~Open questions~~ — RESWEPT 2026-08-01, after the revert

**Every entry below was written while the guard was in the tree, and every one of them presumed a live
bound.** There is no bound. `MAX_SHARED_LOGICAL_NODES` and `LowerError::TooShared` are out of
`lambda/lower.rs`, and nothing in any crate's `src/` refuses anything on the strength of a sharing
measurement. The original text is struck and answered in place rather than deleted, because the
distinction worth preserving here is between **a question nobody answered** and **a question this
branch answered the hard way** — and the last one is the second kind. One is moot, one is answered in a
direction it did not anticipate, two survive in altered form, and one was never a question.

- ~~**Whether a legitimate program can exceed 10,000.** Nothing measured comes close, but the only real
  source of sharing is mutual recursion, and no program with a large single mutual-recursion group (say
  ten members, unnested) has been measured. That is the shape most likely to surprise this bound.~~ —
  **MOOT: there is nothing to exceed.** The question was about calibration — whether 10,000 sat far
  enough above legitimate programs — and calibration is not a property a withdrawn constant has. Its
  one durable residue is a **gap in the measured corpus profile**, not a risk: §3's table still has no
  row for a single unnested mutual-recursion group of ~ten members, so the largest `max_shared` any
  hand-written program produces remains unknown above the corpus's 684. That is worth a row in
  `list_reduction_probe corpus` if anyone ever needs the number again. Nothing depends on it today.
- ~~**Whether `max_shared` stays the right discriminator under a future `lower_group` fix.** If the root
  cause is ever fixed, the sharing it creates goes away and this guard may become dead weight — which
  would be a good outcome, but should be checked rather than left.~~ — **HALF ANSWERED, and the half
  that survives is about the measurement rather than the guard.** `max_shared` is not the right
  discriminator at all, fixed `lower_group` or not: §10.2 shows a β-step costs `|body| + Abs(body) ×
  |arg|` and neither factor is a sharing property. That settles the "discriminator" half without
  waiting for the root-cause fix. What survives, rephrased: **if `lower_group` is ever fixed, does
  `max_shared_logical_size` still measure anything anyone wants?** It is a sound O(physical)
  measurement of a real quantity, and it is kept on those grounds — but see the next entry for how
  thin its current claim to a place in the public API is. "Dead weight" arrived early and by a
  different route than this bullet predicted.
- ~~**Whether in-degree should be exposed publicly.** The guard needs it internally; nothing else does
  yet. Left private until a second consumer exists.~~ — **ANSWERED, and not in either direction this
  bullet allows for.** Per-allocation in-degree is still private, a local `HashMap` inside
  `max_shared_logical_size`, and nothing has asked for it. What is public is the **aggregate over**
  it, `lambda::term::max_shared_logical_size`, which was `pub` from `b832c89` onward — and the
  in-library consumer that justified computing it is gone. **It is now a public function with no
  caller anywhere in any crate's `src/`.** Every use is a `#[cfg(test)]` module, a `tests/` target, or
  an `examples/` probe. The "second consumer" test this bullet proposed was in effect met from outside
  the library entirely: `guard_hole_probe.rs` and `list_reduction_probe.rs` are `examples/` targets,
  which cannot import a private item, so the investigation that killed the guard could only run
  against a public one. **This is not a live question, and an earlier draft of this bullet wrongly
  left it as one** ("either a deliberate measurement surface… or it is unowned surface area", to be
  re-examined by whoever designs the successor). Counted 2026-08-01: **20 call sites** —
  `guard_hole_probe.rs` (10), `list_reduction_probe.rs` (8), `tests/guard_counterexamples.rs` (2).
  An `examples/` target and a `tests/` target each compile as a **separate crate** linking
  `redextape-core` externally, so neither can call a non-`pub` item. `pub` is therefore a
  **requirement of the committed-instrument pattern**, not a preference to revisit: demoting it to
  `pub(crate)` breaks all twenty, and `logical_size` sits in exactly the same position for exactly
  the same reason. The successor not calling it changes nothing — the instruments and the two
  regression tests are the consumers, and they are committed on purpose.

  What survives is narrower and is the next entry's subject: whether a measurement nothing in `src/`
  calls is worth the ~92.6 ms it costs the code paths that *do* call it.

~~Two more, filed by the whole-branch review of 2026-07-31 and deliberately **not** fixed on it — neither
is a correctness defect and both would move numbers this branch pinned.~~ — the first survives with a
sharper edge; the second is not a question and never was.

- **The measurement's own cost, and it is now paid by nobody.** ~~"The guard's own cost is unmeasured,
  and it now dominates `lower` on the largest program `lower` admits."~~ — **the underlying fact
  stands, restated for a tree with no guard in it.** Re-measured 2026-08-01, optimized:
  `max_shared_logical_size` on the 699-element list's output — 497,691 allocations — is **92.6 ms**
  against a guard-free `lower()` of **9.7 ms**, so the fold is ~9.5x the lowering it used to be
  attached to. While the guard existed those summed to the ~87% of a ~104 ms lowering the review
  reported, roughly **7x** the pre-guard cost, on the largest program `lower` admits. **Those two
  multiples do not share a base and neither should be quoted without one** — the same discipline this
  branch already applied to 32x-vs-65.75x. 7x is the review's, against the ~13% of its own ~104 ms
  that was not the guard (~13.5 ms). Against the **9.7 ms re-measured here**, the same ~102 ms total is
  **~10.5x**. The re-measured pair is the one to carry forward, since it is the only one whose two
  halves were timed in the same run. **The revert did
  not make the fold cheaper; it made it optional.** No `src/` path calls it, so no program pays it on
  any user-facing path, and the regression
  the whole-branch review flagged is simply not in the tree. ~~"The guard is correct and the constant
  is right"~~ — **there is no constant.** What the entry got right and what still matters: every doc
  comment on this path states cost in *logical* size ("microseconds", O(physical) offered as
  reassurance) and **never in physical size**, which is the axis that program is extreme on — 497,691
  allocations at a ratio of exactly 1.000x, so "O(physical)" names precisely the expensive case rather
  than the cheap one. **That mis-stated axis is the part to carry forward**, because §10.6's successor
  proposes running an O(physical) fold **per β-step** instead of once per `lower`, where ~90 ms is a
  budget rather than a footnote. Unmeasured, and the thing to measure first.
- ~~**The record states the bound's false-POSITIVE direction and never the false-NEGATIVE one.**~~ —
  **NOT AN OPEN QUESTION. It is what happened, and §10 is the answer.** This entry filed the false
  negative as hypothetical: a program *under* 10,000 that still hangs inside one step, because a
  β-step's cost has two factors and `max_shared` measures neither, with `(\x. … x … x …) BIG` scoring
  **0** as the illustration. ~~"Nothing in the corpus or the nesting family has this shape, so no such
  program is known — but 'not measured' is the honest status."~~ — **it was then measured.** The
  investigation built exactly that shape from ordinary source rather than by hand — `let xs = […];
  let ys = […]; head(xs) + head(ys)`, 4,821 bytes, no recursion — measured `max_shared` = **4**
  against the bound of 10,000, and timed its first β-step at **19.0 s** (§10.1). The hand-built
  `(\x. BODY) ARG` case survives as §10.2's `mechanism` section, where the bound variable does not
  occur *at all* and the step still costs `Abs(BODY) × |ARG|`. **The falsification record is §10; read
  it rather than this entry.** ~~"The calibration is right; the coverage claim is one-sided."~~ — the
  calibration was right about a quantity that does not govern the cost, which is the more expensive
  way to be wrong.

Both counterexamples are now executable, not quoted:
`crates/redextape-core/tests/guard_counterexamples.rs` pins the 699-element list at 497,691 logical
nodes / 1.000x / `max_shared` 0 and the two-list program at `max_shared` 4, so a fourth design bounding
total size or sharing fails a test rather than a review. The 19.0 s is deliberately not asserted there —
it is neither deterministic nor cheap — and stays a `guard_hole_probe` figure.

## 10. FALSIFIED — the guard was implemented, then reverted (2026-08-01)

The last open question in §9 was asked and answered. **The answer is that the guard does not work**, and
it does not work by 2,500x on a program a first-week user could write by accident. Instrument:
`crates/redextape-core/examples/guard_hole_probe.rs`, committed with the revert. Everything below is a
run of it, not an argument from the code.

### 10.1 The counterexample

```
let xs = [0, 1, …, 499];
let ys = [0, 1, …, 499];
head(xs) + head(ys)
```

**4,821 bytes. No recursion, no `while`, no closure, no mutual-recursion group — nothing this document
identifies as a source of sharing at all.** It lowers, measures **`max_shared` = 4** against a bound of
**10,000**, and its **first β-step takes 19.0 s**.

| | `max_shared` | first β-step |
| --- | --- | --- |
| **the counterexample** (n=500, elements `0..500`, 4,821 B) | **4** | **19.0 s** |
| single-list control, **same n=500** (`let xs = [0..500); head(xs)`) | 0 | **0.043 s** |
| the same shape at the largest n `lower` accepts (n=697, **every element `1500`**, 8,405 B) | **4** | **196.5 s** |

**Read the ratio off the first two rows and only those two** — they are the pair `guard_hole_probe
source` runs side by side at each n, and they are what "control" means here. **Same element count, same
lowering path, one binding instead of two, 442x apart** (19.0 / 0.043) — and the guard's quantity is 4
on one and 0 on the other. Nothing this design measures can tell them apart, and the gap is not near
any threshold: it is invisible in kind, not in degree.

**The third row is a ceiling, not a control, and its figures do not divide into the others.** It comes
from `guard_hole_probe ceiling 1500`, which uses a *flat* element value so `|arg|` can be raised
without raising the Core's nesting depth — which is why 8,405 B rather than the ~6,800 B that n=697 of
the `0..n` form would print, and why no control was run at that n. It establishes how far the shape
goes inside `MAX_LAMBDA_LOWER_DEPTH`, not a ratio. **Quoting 196.5 s against 0.043 s as though it were
the control comparison overstates the measured gap by ten**, which the roadmap's copy of these figures
did outright and this table left open by saying only "at the same n" — both corrected 2026-08-01.
`tests/guard_counterexamples.rs` had the pairing right from the start, which is one more argument for
committing the counterexample as a test rather than as a row.

**It is a family, not a ceiling artifact.** `guard_hole_probe lets` ramps the number of let-bound lists
at fixed element count: the first step costs **2.2 / 7.1 / 17.6 / 42.0 s at k = 2 / 4 / 8 / 16** —
linear in k, `max_shared` pinned at 4 throughout. The product is maximized well inside
`MAX_LAMBDA_LOWER_DEPTH`, so the depth guard is not what makes these programs reachable; ordinary code
shape is.

### 10.2 The mechanism this document states is wrong

§1 and the guard's own doc comment say `subst` "copies a shared subterm into every occurrence of the
variable". **That is not what the code does.**

```rust
// lambda/term.rs, `subst`, verbatim:
Node::Var(k)    => if *k == j { s.clone() } else { var(*k) },   // an Rc bump — FREE
Node::Abs(n, b) => abs(Rc::clone(n), subst(j + 1, &shift(1, 0, s), b)),
```

The `Var` arm is a refcount bump, so **occurrences are free**. The `Abs` arm takes `shift(1, 0, s)` — a
**full logical copy of the argument** — **once per `Abs` node in the body, unconditionally, before
anything checks whether the variable occurs in that subtree at all.** So a step costs

```
|body| + Abs(body) × |arg|          (logical sizes, both factors)
```

measured at **23.1–23.6 ns per predicted node-copy, constant over a 1,255x range** of predicted copies.
The `mechanism` section pins the unconditionality directly: it hand-builds `(\x. BODY) ARG` where `BODY`
**does not mention `x`**, so the substitution is a no-op and the output is smaller than the input — and
the step still costs `Abs(BODY) × |ARG|`, exactly as predicted.

**Neither factor is a sharing property.** Both are large in a completely alias-free term, whose
`max_shared_logical_size` is 0 by definition. A guard on sharing cannot see either one. The bound was
calibrated correctly against a quantity that does not govern the cost.

### 10.3 The deciding evidence was already in the tree, unconnected

`crates/redextape-core/examples/lambda_sharing_probe.rs`'s **PART B**, committed on the branch
immediately before this one, attributes **86.8% of every node the reducer visits to `Σ abs×arg`** — and
records it as its **headline finding**. That is this same product, measured from the other end, sitting
in the same crate's examples directory while this guard was being designed against "occurrences × |arg|".
Nobody connected them.

**This is the second time on this hazard.** The total-size design was falsified by a 699-element list
literal that `lambda/lower.rs`'s own pre-existing depth-guard test had been constructing all along. In
both cases the evidence that killed the design was already committed, already passing, and already read
by whoever wrote the design — and in both cases the design shipped anyway.

### 10.4 `max_shared` collapses; the guard reads it at its one maximum

`guard_hole_probe curve` samples `max_shared_logical_size` after **every** step, across six programs
spanning the corpus's bands (a corpus zero, the band-6 scaffolding, the corpus maximum at 684, a
store-passing `while`, and the nesting family at 4 and 6 groups).

**It is non-increasing in all six.** The peak over every run is the lowering-time value, always. At 6
groups it reaches **0 by step 2** — while individual steps are reaching **~4.2 s each by step 9**. The
mechanism is already in the tree and was already understood: `beta`'s closing `shift(-1, 0, ·)` has no
sharing-preserving arm, so it rebuilds the reduct node for node and its output shares zero allocations
with either input (`2026-07-30-lambda-structural-sharing-design.md` §8, and `blowup_probe`'s `step`
section from the other side).

So the guard reads its quantity **once, at lowering time, at the single moment it is maximal**, and the
property is destroyed by the second β-step while the cost it was supposed to bound is still climbing. §4
records the one-shot placement as a deliberate choice with a stated reason. The reason was right about
*when* sharing is knowable and wrong about whether knowing it then is worth anything.

### 10.5 What was reverted, and what was kept

**Removed:** `MAX_SHARED_LOGICAL_NODES`, `LowerError::TooShared`, the guard call at the tail of
`lower_mapped`, and the two tests that exercised refusal
(`the_guard_refuses_at_the_measured_boundary`, `too_shared_reports_the_measured_size`).

**Kept:** `lambda::term::max_shared_logical_size` and its four tests — a sound O(physical) measurement,
and the one the investigation ran on every term it timed. The two remaining lowering tests, reworded to
measure rather than gate: `a_large_unshared_list_measures_zero_shared_nodes` (the 699-element list is 0)
and `the_corpus_maximum_shared_subterm_is_684`. Both pins are cheap and both catch a lowering that
changes shape.

### 10.6 The next design, and why it is not the blind spot this record already names

A **per-redex work budget**: `logical_abs_count(body) × logical_size(arg)`, both O(physical), checked
inside `LambdaCursor::next` **before performing the step**.

Two properties, and they are the two failures above:

- **It prices the actual cost.** Both factors of the measured model, computed on the specific redex
  about to be reduced, in the one place that has both of them in hand.
- **It runs at every step, so §10.4 does not apply.** The one-shot reading is the defect; a check that
  re-derives its inputs from the current term cannot go stale against it.

**This is not the "checked between steps" option the record rejects.** The λ-blow-up roadmap entry
rejects "a node budget inside `LambdaCursor`… because one β-step can produce |body| × |arg| nodes, so a
check between steps reads a number that says nothing about the next one" — and that objection is
correct, about a check on the *size of the current term*. This is a **pre-flight check on the redex about
to be reduced**: it reads the two factors of that step's cost, before that step runs. The rejected
design measures the wrong thing after the fact; this one measures the right thing before. `logical_abs_count`
is already written and exercised in `guard_hole_probe.rs` and is the shape `logical_sizes` uses —
iterative, memoized by allocation identity, saturating.

Open, and to be answered by measurement rather than by this paragraph: what the budget's value is, and
whether the check's own O(physical) cost is acceptable per step (§9 already records the reverted guard
running at ~87% of `lower()` on the largest program `lower` admits — the same axis, now paid per step
instead of once).

### 10.7 The pattern, stated once

**Three designs on one hazard, three falsifications, each by measuring rather than reasoning.**

**The table has two rows, and the missing one is the point of the fourth column.** The first
falsification is
[`2026-07-30-lambda-structural-sharing-design.md`](2026-07-30-lambda-structural-sharing-design.md) §10's
claim that a term whose logical size runs away from its physical size was "possible and merely
unreached" — falsified 2026-07-31 by 512 bytes of ordinary source. It is not in the table because its
falsifying program **was not already in the tree**: `examples/blowup_probe.rs` had to be written to
find it. The two rows below are the ones where it was, which is the harder lesson and the one the
roadmap files under its own heading.

| design | claim | what falsified it | where the evidence already was |
| --- | --- | --- | --- |
| total logical size ≥ 300,000 | "every such program observed so far does not terminate anyway" | a 699-element list literal reduces cleanly in 1,398 steps | `lower.rs`'s own depth-guard test built it |
| largest shared subterm > 10,000 | "`subst` copies a shared subterm into every occurrence" | a two-list program scores 4 and takes 19.0 s | `lambda_sharing_probe.rs` PART B: `Σ abs×arg` = 86.8%, its headline finding |

Both fell to a program the tree already contained, and both were shipped by someone who had read the
thing that disproved them. The roadmap carries a standing lesson about falsified claims surviving in
places nobody re-greps; this is its sibling and belongs beside it: **a claim about cost is not
established until it has been measured against a program chosen to break it, and the cheapest place to
look for that program is what the repository already runs.** Reasoning from the code's shape produced a
plausible mechanism twice, and both times the code did something else.
