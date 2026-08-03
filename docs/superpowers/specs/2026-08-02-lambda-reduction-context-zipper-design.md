# λ reduction-context zipper — design

> **BUILT AND MEASURED 2026-08-02 — and it is the first design on this thread that survived.**
> `ZipperCursor` is **wired in**: `reduce_to_normal_form` drives it, `reduce_trace` keeps
> `LambdaCursor`. **1.41–1.43x wall-clock on the corpus**
> (7.4 ms → 5.3 ms; four runs, two of them by an independent reviewer, and the node counts below are
> identical across all four where the milliseconds are not), recovering **99.0% of the `Σ path` ceiling** (54,655 of 55,226 nodes; the climb costs
> 571). Row 31 — the mutually-recursive program that has been the worst case since the hang — runs
> **4.55x** faster. Equivalence is proven, not assumed: 256 generated programs, six curated terminating
> shapes and four curated capping cases emit identical `StepEvent` sequences, identical terms and
> identical statuses. The capping cases exist because the whole-branch review found that the status
> comparison had been **vacuous** until then — every generated program terminates, so it compared
> `Some(Normalized)` with itself — and one of them caps with the zipper away from the root, which is the
> only place `term()` is folded from a non-empty stack at integration level.
>
> **It is not free on trivial input.** Rows below 1.0x exist and are reported: sub-millisecond programs
> where `climbs` exceeds `Σ path`, i.e. terms shallow enough that the search climbs more than it
> descends.
>
> **THIS BRANCH DOES DECIDE WHAT TO DO WITH IT — routing by consumer, not replacement.** An earlier
> draft of this block said the decision was a follow-up slice; it is not, and leaving that standing
> would have been this document describing a tree it no longer matches. The zipper's win exists only
> for a caller that reads the term ONCE, at the end, so `reduce_to_normal_form` drives it and
> `reduce_trace` — which materialises `cursor.term()` every step by contract — keeps `LambdaCursor`.
> Under a zipper that consumer would fold the context stack per step and pay the cost back with frame
> bookkeeping on top: worse, not neutral.
>
> **Depth-selection was considered and rejected.** The sub-1.0x rows lose microseconds while row 31
> gains milliseconds; a runtime branch would buy noise and cost a decision point. What remains genuinely
> open is only whether `reduce_trace`'s per-step materialisation contract is itself worth changing —
> that is an API question with its own consumers to survey, and §6 keeps it a non-goal.
>
> Four designs on this thread were falsified by measurement. This one was corrected twice by
> measurement and then confirmed by it, which is a different outcome and worth naming as one.

**Status: GATE PASSED THE SAME DAY IT WAS WRITTEN, AND NOT BY THE ROUTE IT EXPECTED.** This began as a
measurement slice: compute the ceiling on what a zipper could recover, decide against a bar set in §3
before the number was known. The measurement was never run, because §2's correction showed the quantity
it was going to compute bounds nothing — zipper navigation does not allocate on the descent, so the ceiling is `Σ path`
in full, **36.2% of fitted time**, already measured. §4's `ZipperCursor` is therefore **live work**.

**Read §2's correction block before anything else here.** The design's original reasoning was wrong in
a specific, instructive way, and the error is kept rather than edited out.

This is the bar [`2026-08-01-interpreter-concurrency-design.md`](2026-08-01-interpreter-concurrency-design.md)
§8.1 sets for its own fusion slice — *"a fusion slice must measure `c` on a prototype before
committing"* — applied to §8.2, which never had one. Four designs on this thread have been falsified by
measurement, two of them after being written out in full. The cost of this gate is an afternoon; the
cost of skipping it is the shape of the last four.

**Scope:** `redextape-core`, λ path only. Zero new dependencies. No printed byte moves. The measurement
adds a section to `examples/lambda_sharing_probe.rs` and changes no shipped code.

## 1. Why this is open again

§8.2 named the retraced descent as a real defect and then deferred it, on this reasoning: *"a β-step
costs 1,323 ns … the retraced work is ~8.7 spine nodes per step … a zipper is recovering a single-digit
percentage at best."*

**The 1,323 ns is still right. The denominator was not.** "~8.7 nodes is single-digit" divided them into
a per-step node count taken from `Σ abs×arg`, the static counter falsified on 2026-08-02 as
over-reporting by ~1,584x. Against the repaired accounting a β-step allocates **~31.8 nodes**, of which
`Σ path` — `reduce_step` rebuilding the redex spine on the way back up — is **~9.3**: 29.2% of every
allocation the reducer makes, and **36.2% of fitted time. The largest single allocating traversal in the
corpus.** Same 8.7 nodes; right denominator.

So the question is re-opened. It is *not* answered: what §8.2 proposes is a zipper, and a zipper does
not delete the spine rebuild — it moves it. §2 is about how much actually goes away.

## 2. The ceiling, and why it is a different statistic from §8.2's 93.7%

> **CORRECTED BEFORE ANY MEASUREMENT WAS RUN — 2026-08-02, same day, and the correction moves the
> verdict.** The first draft of this section claimed *"a zipper's pop rebuilds a node"* and built a
> whole pop-survival statistic on it. **That is false.** Navigating a zipper does not allocate, because
> the ancestor is never needed as a `LambdaTerm`:
>
> - *Is the parent a redex?* Frame `AppL(arg)` with an `Abs` focus — known from the frame tag and the
>   focus node, without constructing the `App`.
> - *Reduce it?* `beta(body, arg)` directly, where `focus = Abs(_, body)`. The parent is never built.
> - *Move to the sibling?* New focus is `arg`, new frame is `AppR(old_focus)`. A handle swap.
>
> Allocation happens at the β-reduction and at materialisation, nowhere else. So pop-survival bounds
> nothing, the formula below measures a quantity that does not gate anything, and **the ceiling for a
> lazy consumer is essentially all of `Σ path`** — 55,226 allocations, 29.2% of nodes, **36.2% of fitted
> time — minus one final fold of the stack.**
>
> > **QUALIFIED 2026-08-02 BY THE IMPLEMENTATION, WHICH IS WHERE §7 SAID TO EXPECT IT.** "Navigation
> > does not allocate" is true of the descent and of sibling moves, and false of the *climb*. Moving
> > up past a subtree the search has exhausted needs the parent as a term to continue from, so
> > `advance` builds one node per level climbed. The three claims above survive exactly as written —
> > testing an ancestor for redex-ness, reducing it, and moving to a sibling are all allocation-free —
> > but they are not the whole of navigation, and this block read as though they were.
> >
> > **What it costs the ceiling.** The saving is `Σ path − climbs`, not `Σ path`, and *climbs* is
> > unmeasured. The gate in §3 was decided on 36.2%, which is now an **upper** bound on the ceiling
> > rather than the ceiling; whether it clears the >25% bar depends on a number nobody has. §3's
> > verdict is not retroactively withdrawn — the bar governs the prototype now, not the go/no-go, and
> > the prototype is what produces the missing number. The plan already requires PART D to count
> > `advance`'s rebuilds for exactly this reason, written before the code existed.
> >
> > **This is the second correction to this section and both went the same direction: reasoning about
> > a representation rather than about code that would implement it.** The first was pessimistic and
> > invented a bound; this one was optimistic and dropped a cost. Neither survived contact with an
> > implementation. Found by review of Task 2, not by the author.
>
> **The gate in §3 is therefore already passed by data in hand**, and the cheap measurement it was
> written to demand does not exist: there is no number obtainable without an implementation that would
> change the decision. The risk moved rather than vanished — it is now entirely in the constant factor,
> whether the frame bookkeeping eats a 36% node reduction, and only a prototype answers that.
>
> The struck reasoning is kept below because the error is instructive: it is a *pessimistic* modelling
> mistake, the mirror of the optimistic one that killed the `subst` slice, and it would have sent this
> slice to measure a statistic that bounds nothing. Both come from reasoning about a representation
> instead of about the code that would implement it.

~~**A zipper's pop rebuilds a node.** Moving the focus up the context stack means reconstructing
`app(focus, sibling)` — one allocation, exactly what `reduce_step` pays today. What a zipper saves is
therefore only the part of the spine that is **never popped between consecutive steps**:~~

```text
for each consecutive pair of redex paths (P[n-1], P[n]):     # SUPERSEDED — measures nothing
    shared = common_prefix_len(P[n-1], P[n])
    saved += shared
    paid  += len(P[n-1]) - shared
```

~~**THIS IS NOT §8.2's 93.7%.** That figure is *descent overlap*; this is *pop-survival*.~~ Both are
descriptive of the same paths and **neither bounds the saving**, now that navigation is known to be
allocation-free on the descent (see §2's second correction — the *climb* does allocate). §8.2's 93.7%
remains what it always was: a statement about *read* work, which the next
paragraph prices at approximately zero.

**Two consequences hold regardless, and both survive the correction above.**

**The read saving is worth approximately nothing.** `Σ scan` — the rejected left siblings a descent walks
— is 25,698 nodes, and PART C.2 prices read-only work at effectively zero (`r` fits slightly negative,
which the probe correctly reports as "too cheap for this corpus to separate from noise"). §8.2's
headline is about descent, and descent is the half that does not pay. **The rebuild is the prize.**

**`reduce_trace`'s ceiling is exactly zero, by construction rather than by measurement.** It materialises
`cursor.term()` every step **by contract** — that is the API's whole promise — so the spine is rebuilt
per step whatever the reducer does internally. A zipper cannot help that consumer, and no measurement
should be run pretending it might. What it *can* help is the lazy consumers:
`reduce_to_normal_form` (one `term()` at the end), which is what `run_lambda` — the λ backend's entry
point, used by the three-way oracle — reduces through.

**AND THE UI IS NOT ONE OF THEM, because there is no UI.** An earlier draft of this section said "the
`LambdaCursor` path the UI is built on". `crates/redextape-wasm` and `web/` are in the README's *Not
built yet*, so that named a beneficiary that does not exist. Corrected rather than deleted, because the
claim shaped the case for the slice: the win is real and it reaches `run_lambda` today, but a reader
weighing this against other work should know it currently speeds up the oracle and the test suite, and
that the *interactive* consumer the zipper is theoretically best suited to — a cursor walked forward
without materialising every step — is a consumer Plan 5 has not written yet.

**So the ceiling is reported per consumer**, and the corpus's `replay ms` — which drives
`reduce_to_normal_form` — is the lazy one.

## 3. The bar, set before the number is known — and PASSED at 36.2%

Written down before the number, so it could not be adjusted to fit the result afterwards. Ceiling as a
share of fitted corpus time, lazy consumer:

| ceiling | verdict |
| --- | --- |
| **< 10%** | **Kill.** Record the falsification; `ZipperCursor` is never written. |
| **10–25%** | **Kill unless the prototype is demonstrably cheap**, and say which it was, explicitly, rather than proceeding on momentum. |
| **> 25%** | **Build** §4, with the ceiling as its acceptance test. |

**Outcome: 36.2%, so §4 is built.** The bar survives its own use in one respect worth noting — it was
written expecting to kill this slice, and the number that passed it came from the correction in §2
rather than from a measurement the bar anticipated. **The bar is not retroactively satisfied by a
different quantity than it named:** it named "ceiling as a share of fitted corpus time, lazy consumer",
and `Σ path`'s 36.2% is exactly that, measured by the repaired probe before this design existed.

**What the bar now governs is the prototype, not the go/no-go.** `ZipperCursor` must recover a
substantial fraction of 36.2% on the lazy consumer. If it recovers a small fraction, the finding is that
**frame bookkeeping costs more than spine rebuilding** — a real and reportable result, and the fifth
falsification on this thread — not a reason to tune until the number looks better.

**The ceiling is also the prototype's acceptance test, not just its permission slip.** A `ZipperCursor`
measuring far below the ceiling means the implementation is wrong or the bookkeeping is eating the win —
not that the idea is refuted. Distinguishing those two afterwards is impossible without a number
computed beforehand.

## 4. `ZipperCursor` — live work, gate passed at §3

A second cursor beside `LambdaCursor`, same `Iterator<Item = StepEvent>` contract, sharing `beta`,
`term.rs` and both guards — so an A/B isolates the descent strategy and nothing else. One file to delete
on a kill.

```rust
enum Frame {
    AppL(LambdaTerm),   // descended into the function; holds the argument
    AppR(LambdaTerm),   // descended into the argument; holds the function
    AbsBody(Rc<str>),   // descended under a binder; holds its name hint
}
```

§8.2 lists three things a slice here must handle. It predates the stored `depth`, so there is a fourth.

1. **The redex can move up, so the stack must pop.** Resolved, and the walk is bounded: after a β-step
   the focus can only create a redex in ancestors reached by `AppL`. An `AppR` ancestor's function side
   is untouched by the rewrite *and* was already known not to be an `Abs` — if it were, that `App` would
   have been the outermore redex and been reduced first. So the pop-up is a walk over consecutive `AppL`
   frames, O(1) per level, not a re-scan.
2. **`term()` must still return the whole term.** Rebuild on demand by folding the stack, never
   maintained eagerly — maintaining it eagerly *is* the cost being removed.
3. **`Step.redex: Path` must be produced exactly as today.** Free: the frame stack *is* the path, in
   order. `sourcemap` consumes it and must not notice.
4. **`depth_exceeds` needs whole-term depth every step, and there is no root handle to read it from.**
   Not in §8.2's list because the stored `depth` landed the same day. Resolved by carrying a running
   maximum: each frame caches the best depth hanging off it, so whole-term depth is
   `max(spine_len + focus.depth(), frame_running_max)` — O(1) per push and pop. **A zipper that drops
   this guard reopens the hang**, which is not a trade this slice is permitted to make.

## 5. Gates

- **Equivalence, not similarity.** Both cursors over the whole corpus must emit **identical
  `StepEvent` sequences** and identical final terms — the shape
  `trace.rs`'s `lambda_cursor_emits_the_same_redex_paths_as_reduce_trace` already uses. Step counts,
  goldens, the three-way oracle and the sharing pins all follow from that and must move by nothing.
- **The measurement reports both consumers**, and reports the ceiling beside the achieved figure. A
  slice that reports only the flattering consumer is the error §8.1's own history records.
- **Counts before seconds.** The ceiling is an allocation count and is machine-independent; the timing
  is not. Both are reported; only the count is a gate.

## 5b. What is left after this, and one target that is NOT worth chasing

Added 2026-08-02 with the measurement, so the next slice starts from data rather than from a re-reading
of the same table. Shares of the reducer's allocations, before the zipper lands:

| traversal | counter | share | verdict |
| --- | --- | --- | --- |
| `reduce_step`'s spine rebuild | `Σ path` | 29.2% | **taken by this slice** |
| `subst`'s per-binder re-shift | `Σ reshift` | 23.5% | falsified 2026-08-02 — the lifted-shift slice regresses |
| redex search | `Σ scan` | 13.6% | read-only, priced at ~0 |
| `subst`'s body rebuild | `Σ spine` | 12.5% | **near-irreducible, see below** |
| `beta`'s closing shift | `Σ closing` | 12.3% | **the next target, with `Σ opening`** |
| `beta`'s opening shift | `Σ opening` | 5.7% | **the next target, with `Σ closing`** |
| `depth_exceeds` | `Σ guard` | 3.1% | O(1) since 2026-08-01 |

**`Σ spine` IS NEAR-IRREDUCIBLE AND SHOULD NOT BE THE NEXT SLICE.** It is `subst` rebuilding the body it
descends through, and the `maxfree` short-circuit already prunes every subtree that does not contain the
bound variable — so what it rebuilds is exactly the paths to actual occurrences, which is the minimum a
substitution producing a new term can rebuild. Going lower means not substituting eagerly: explicit
substitutions, or environments and closures — a Krivine-style machine. **§6 rejects that, and not on
performance grounds:** it changes the evaluation model, and the project's premise (`README.md`, "what you
see is the genuine computation") forbids reaching the answer by a route that skips configurations.
Recorded here so the next reader does not price it again.

**THE TARGET IS `beta`'s THREE PASSES.** `beta(body, arg)` is
`shift(-1, 0, subst(0, shift(1, 0, arg), body))` — three traversals where the textbook single-pass
formulation folds the index adjustment into `subst` itself: replace `Var(j)` with `shift(j, 0, arg)` and
decrement free indices above `j`, in one walk. **Same semantics, same reduction order, no model change.**
Together `Σ opening` + `Σ closing` is **34,085 nodes, 18.0% of allocations — and 25.3% of what remains
once this slice removes `Σ path`.**

**IT SOUNDS LIKE THE SLICE FALSIFIED THIS MORNING AND IT IS NOT THE SAME ONE.** That one deferred the
per-binder *re-shift* (`Σ reshift`) and inverted because `subst` descends through fewer binders than it
finds occurrences. This fuses the *opening and closing* shifts, which are per-β-step rather than
per-binder, and are paid whether or not any binder is crossed. Different quantity, different mechanism.

**It earns the same gate regardless**, and the resemblance is the reason: a ceiling computed before any
code, a bar written before the number, and a counter that can attribute a null result — the
`climbs`-equivalent, which here would be whatever the fused pass still has to rebuild. Four designs on
this thread died for want of exactly that.

## 6. Non-goals

- **Not a Krivine machine.** Closures and environments change the evaluation model, and the project's
  premise (`README.md`: "what you see is the genuine computation") forbids reaching the answer by a
  route that skips configurations. A zipper is a representation of the same reduction; that is the
  whole reason it is admissible.
- **Not n-ary β.** §8.2 measured 1.3% consecutive root redexes. Dead already.
- **Not fusion.** §8.2's own negative result, corpus-wide: same-path runs average 1.22 steps.
- **Not `reduce_trace`.** Its contract is per-step materialisation. Changing that is an API slice with
  its own consumers to survey, and it is not this one.

## 7. What would falsify this design

Recorded as predictions, in the form that makes them checkable — the discipline §10 of the perf design
credits with catching its own error.

- ~~**The bookkeeping eats the win.**~~ **PREDICTION MADE AND MET — measured 2026-08-02.** The stated
  prediction was "the prototype recovers more than half of `Σ path` on the lazy consumer." **It recovers
  99.0%**: ceiling 55,226 nodes, `climbs` 571, net 54,655 — and **1.41–1.43x wall-clock corpus-wide** across four runs, 7.4
  ms → 5.3 ms. Per row it ranges from **4.55x on row 31** — the mutually-recursive program that has
  been the worst case throughout this thread — down to 0.62x. Instrument: `lambda_sharing_probe.rs`
  PART D.

  **The rows meaningfully below 1.0x are real and are not noise.** They are sub-millisecond programs
  where `climbs` exceeds `Σ path` outright: a term shallow enough that the search climbs more than it
  descends pays more to carry the context than to rebuild it. (Rows sitting at 0.96x–0.98x have a
  *positive* net — `Σ path` still exceeds `climbs` there — and are ordinary run-to-run noise, not this
  mechanism; the claim is about the rows the mechanism actually explains.) The zipper is not free on
  trivial input. The `net` column shows exactly where it goes negative, which is the honest form of this
  result.
- ~~**Navigation is not allocation-free in practice.**~~ **FIRED 2026-08-02, during Task 2's review.**
  This predicted that writing the implementation might turn up a case forcing an ancestor to be
  materialised, and it did: `advance` rebuilds one node per level it climbs past an exhausted subtree,
  because continuing the search from that position needs the parent as a term. The prediction was
  right that the ceiling moves; it was wrong about how far — this does not fall back to pop-survival,
  because the descent and sibling moves really are free. The ceiling is `Σ path − climbs` with
  *climbs* unmeasured, and PART D counts it. **Recording this as a hit rather than quietly amending
  §2 is the point of writing predictions down**: the section was corrected once already, in the
  opposite direction, and without this bullet the second correction would read as bad luck rather than
  as the same error twice.
- **The equivalence gate fails.** Any divergence in the `StepEvent` sequence is a correctness defect and
  ends the slice on the spot; normal order is not negotiable (`reduce.rs`'s module doc gives the three
  independent reasons).
- **`Σ path` is not on the critical path of anything a user waits for.** The corpus replays in 7.4 ms
  total. A 36% cut of a 7.4 ms corpus is ~2.7 ms, and the case for it rests on the *blowup family* and
  the UI cursor rather than on this corpus — which is a claim this design has not measured and should
  not pretend to have.
