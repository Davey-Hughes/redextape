# λ β-fusion — `beta`'s three passes become one — design

~~**Status: NOT BUILT. A MEASUREMENT SLICE WITH A GATE WRITTEN BEFORE THE NUMBER.**~~
**Status 2026-08-04: BUILT, CORRECT, AND SHIPPED — the family bar was RETIRED AS MALFORMED, which is
not the same as missed.** `beta` is 0.13% of the family run the bar was written against, so **1.10x on
that family was unsatisfiable by any change to `beta` whatsoever** (§5.1 gives the arithmetic). The
corpus clause passed on its own terms at **1.288–1.308x**. Under `mimalloc` the family is **0.978x** —
a small, consistent, recorded regression on a fixture that is non-terminating by construction. **Read
§5.1 first.** The block below is the pre-retirement status and is kept as the record of what was
believed on 2026-08-03.

~~**Status 2026-08-03: BUILT, CORRECT, AND THE SHIP BAR IS MISSED.**~~ `beta` is one walk, equivalence is
exhaustive, the count gate PASSED at 4.3% — and on the clock it is **1.288–1.308x on the corpus** and
**0.910–0.925x on the nested-group family**, where the bar was `>= 1.10x`. Every one of the eleven
family levels regresses. **Read §5's SHIP RESULT and §9.1's verdicts before anything else in this
document**; §2's mechanism section is sound and is not where this slice went wrong. This is the target
[`2026-08-02-lambda-reduction-context-zipper-design.md`](2026-08-02-lambda-reduction-context-zipper-design.md)
§5b named on the way out — *"THE TARGET IS `beta`'s THREE PASSES"* — and the first thing this document
does is disagree with the formulation §5b reached for, because that formulation is the one measurement
falsified the same morning. §2 is the mechanism, §4 is the ceiling as arithmetic rather than as a share,
§5 is the bar, and §6 records what the probes had to gain before it could be run. ~~The family half of
the gate cannot be computed with the probes as they stand.~~ **Both probes gained their counters on
2026-08-03 and §5's gate has been RUN: PASSED at 4.3%, and the formulation contest went against §2 on
the corpus — read §5's GATE RESULT before §2.** ~~No reducer code is implemented.~~ **The reducer code
landed the same day (`eb9e134`); what did not survive is the second bar.**

**Four designs on this thread were falsified by measurement and one survived it.** The survivor
(the zipper) is the one that computed a ceiling before writing code and wrote its bar down first. This
document is shaped to be falsifiable the same way, which is why §4 defines a null-result counter
(`Σ freevar`) before §2's code exists.

**Scope:** `redextape-core`, `lambda/term.rs`'s `beta` and nothing else in `src/`. No new dependencies.
No semantics change, no `StepEvent` change, no printed byte moves. `beta` has exactly two callers —
`lambda::reduce::reduce_step` and `trace::zipper::ZipperCursor::reduce_here` — so unlike the zipper
there is no routing decision: both consumers are covered by changing the one function.

---

## 1. Why this is the next slice

The reducer's allocation census, corpus-wide, before the zipper landed (zipper design §5b):

| traversal | counter | share | status |
| --- | --- | --- | --- |
| `reduce_step`'s spine rebuild | `Σ path` | 29.2% | **taken by the zipper, 2026-08-02** |
| `subst`'s per-binder re-shift | `Σ reshift` | 23.5% | falsified 2026-08-02 — the lifted rewrite regresses |
| redex search | `Σ scan` | 13.6% | read-only, priced at ~0 |
| `subst`'s body rebuild | `Σ spine` | 12.5% | near-irreducible without a Krivine machine — §8 |
| `beta`'s closing shift | `Σ closing` | 12.3% | **this slice** |
| `beta`'s opening shift | `Σ opening` | 5.7% | **this slice** |
| `depth_exceeds` | `Σ guard` | 3.1% | O(1) since 2026-08-01 |

Together `Σ opening + Σ closing` is **18.0% of allocations, and 25.3% of what remains once the zipper
removes `Σ path`.**

**The corpus share understates the case, and the family is why.** `shift_cost_probe.rs`'s census over the
nested-group family — the one program family on this thread that actually stresses the reducer — puts
`Σ opening` at **20,725 at level 1 and 190,666 at level 11**, a 9.2x climb, while every other column is
flat or falling:

| program | β-steps | closed arg | `opening` | `spine` | `reshift` |
| --- | --- | --- | --- | --- | --- |
| nested lvl 1 | 109,565 | 89.2% | **20,725** | 296,124 | 5,921 |
| nested lvl 11 | 105,607 | 89.2% | **190,666** | 285,574 | 5,696 |

That is the closing sentence of the roadmap's falsification block, quoted here because it is what selects
this target over the six others: *"`beta`'s own opening `shift(1, 0, arg)` is the only column that scales
with the family."*

## 2. The mechanism — and it is NOT §5b's sentence

§5b describes the fusion as *"replace `Var(j)` with `shift(j, 0, arg)` and decrement free indices above
`j`, in one walk"* — the textbook single-pass formulation (Pierce, TAPL §6.2, exercise form).
**That sentence pays the shift once per occurrence, which is precisely the quantity measured at 1.5x
this morning.** The roadmap's `CLOSED 2026-08-02` block gives the reason and ~~it is forced rather than
incidental: `subst`'s `maxfree` short-circuit means it descends through only the binders *on the path to
an occurrence*, so "binders crossed" is smaller than "occurrences", and paying per occurrence costs more
than paying per binder crossed.~~ **MEASURED 2026-08-03 — NOT FORCED, SEE §5's GATE RESULT.** The
short-circuit argument above is correct on the nested-group family, where `incr` wins by 1.0095x, and
reverses on the 46-program corpus, where `occ` wins by 2.11x. "Forced" was the family's direction
generalised past the corpus that already carried the opposite sign.

**The formulation this design takes carries `s` incrementally, exactly as `subst` does today**, and
deletes both shifts anyway:

```rust
/// β-reduce `(\. abs_body) arg` in ONE walk.
pub fn beta(abs_body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm {
    beta_go(abs_body, 0, arg)          // `s` starts as `arg`, NOT `shift(1, 0, arg)`
}

fn beta_go(t: &LambdaTerm, j: u32, s: &LambdaTerm) -> LambdaTerm {
    if t.maxfree() <= j {
        return t.clone();              // byte-identical to today's `subst` prune
    }
    match t.node() {
        // NO THIRD ARM, and the argument is `shift`'s verbatim: `maxfree(Var(k))` is `k + 1`, so this
        // line is reached only when `k + 1 > j`, i.e. `k >= j` unconditionally. `k < j` is unreachable.
        Node::Var(k) => if *k == j { s.clone() } else { var(*k - 1) },
        Node::Abs(n, b) => abs(Rc::clone(n), beta_go(b, j + 1, &shift(1, 0, s))),
        Node::App(f, a) => app(beta_go(f, j, s), beta_go(a, j, s)),
    }
}
```

### 2.1 Why it is the same term

Today's `beta` is `shift(-1, 0, subst(0, shift(1, 0, arg), body))`. Three cases exhaust the body, and
`subst`'s `j` and `shift`'s `cutoff` step in lockstep under `Abs`, so at depth `d` both are `d`:

| body node at depth `d` | today | fused |
| --- | --- | --- |
| `Var(k)`, `k == d` | `subst` puts `s_d = shift(d+1, 0, arg)`; closing `shift(-1, d, ·)` decrements every free index of it (all are `>= d+1`) to give `shift(d, 0, arg)` | `s = shift(d, 0, arg)`, built by the `Abs` arm |
| `Var(k)`, `k > d` | `subst` clones; closing shift gives `var(k-1)` | `var(k-1)` |
| `Var(k)`, `k < d` | pruned by `subst`; left alone by the closing shift | unreachable — the prune returns first |

The first row is the whole identity: **today builds `shift(d+1, 0, arg)` and then shifts it back down by
one; the fused walk never builds the `+1` in the first place.** The opening shift and the closing shift
are, on the substituted argument, an up-and-down pair that cancels.

### 2.2 Why `Σ reshift` cannot invert — the distance from the falsified slice

Today the chain is `s_0 = shift(1, 0, arg)` (that is `Σ opening`) then `s_{d} = shift(1, 0, s_{d-1})`
(that is `Σ reshift`), so reaching depth `d` costs **1 opening + `d` re-shifts**. Fused, the chain is
`s'_0 = arg` (free) then the same `shift(1, 0, ·)` per binder, so reaching depth `d` costs **`d`
re-shifts**. Identical count, one fewer shift overall.

The short-circuits agree too: `shift(1, 0, s)` returns `s`'s allocation iff `s.maxfree() <= 0`, i.e. iff
`arg` is closed — **true of `s = arg` and of `s = shift(1, 0, arg)` alike**, since shifting by 1 at
cutoff 0 leaves `maxfree` at 0 for a closed term. So `Σ reshift` is unchanged bit for bit, on the corpus
where 88.4% of β-steps have a closed argument and on the family where 89.2% do.

**This is the entire distance between this slice and the one falsified this morning.** That one changed
`Σ reshift` into `Σ per_occ` and inverted. This one does not touch `Σ reshift` at all.

### 2.3 Why sharing is not lost

The fused prune is `t.maxfree() <= j`. That is:

- **exactly today's `subst` prune** — same condition, same position, so every subterm `subst` returns by
  `clone()` today is returned by `clone()` here; and
- **exactly what the closing shift prunes at the same depth** — `shift`'s short-circuit is
  `maxfree <= cutoff`, and `cutoff == j` at every node because both increment under `Abs`.

So the fused walk prunes at the same points as both passes it replaces. It performs one traversal where
today performs two, over the same pruned tree. ~~No allocation that is shared today becomes unshared.~~

> **CORRECTED 2026-08-03, from Task 5's measurement — UNDERSTATED, not the whole finding.** Fusion does
> not merely preserve sharing; it RECOVERS sharing the closing shift was destroying. That pass walked
> `subst`'s result as a tree — `shift` does not memoise — so where `subst` had just inserted ONE shared
> allocation of the argument at N occurrences (its hit arm is `s.clone()`, a refcount bump), the closing
> shift descended into each occurrence separately and rebuilt N independent copies, flattening the DAG
> `subst` had just built. The fused walk never makes that pass. Measured on `tests/lambda_sharing.rs`'s
> two gates: distinct allocations **18,939 → 17,920** and **4,364 → 4,305**, node totals unchanged in
> both. A four-mode isolation (three-pass; fused spine with three-pass argument handling; sharing added
> without the identity hand-through; shipped) attributes **82% (835/1,019) and 95% (56/59)** of the
> respective falls to the DEPTH-0 case — the result inheriting the CALLER's own `arg` allocation, which
> needs only a single occurrence — and the remainder to same-depth multi-occurrence sharing at depth
> `>= 1`. `term.rs`'s `a_beta_step_shares_one_allocation_across_every_occurrence_of_an_open_argument`
> pins the mechanism directly; `tests/lambda_sharing.rs`'s own comments carry the four-mode table.

### 2.4 One runtime assert becomes structural

`shift`'s negative-index `assert!` exists because `(i64::from(*k) + d) as u32` wraps a negative result to
a huge index — *"a miscompile is worse than a crash"*, as its doc block puts it — and its doc names
`beta`'s `shift(-1, 0, ·)` as the only caller in the library that passes a negative `d`.

**After this slice nothing in `src/` passes a negative `d`.** The fused `Var` arm reaches `*k - 1` only
when `k > j >= 0`, hence `k >= 1`, so the underflow the assert guards is impossible by the branch
condition rather than by a check. The assert and the signed `d` **stay** — `shift` is `pub` and still
guards foreign callers, and narrowing the signature is a different slice (§8) — but the doc block's claim
about its caller goes stale on landing and is repaired as part of this slice, not after it.

## 3. A worked example, so §4's arithmetic is checkable by hand

Body `App(Var(0), Var(3))`, `j = 0`, closed `arg`:

| | today | fused |
| --- | --- | --- |
| opening `shift(1, 0, arg)` | 0 — `arg` closed, refcount bump | — not performed |
| `subst` | 1 (`App` node) | — |
| fused walk | — | 1 (`App` node) + 1 (`var(2)`) |
| closing `shift(-1, 0, ·)` over `App(arg, Var(3))` | 1 (`App` node) + 1 (`var(2)`) | — |
| **total** | **3** | **2** |

`Σ opening = 0`, `Σ closing = 2`, `Σ freevar = 1`, `Σ spine = 1`. Saving is `0 + (2 − 1) = 1`, which is
the `App` node the closing pass rebuilt after `subst` had already rebuilt it.

## 4. The ceiling, as arithmetic rather than as a share

```
today  = Σ opening + Σ spine + Σ reshift + Σ closing
fused  =             Σ spine + Σ reshift + Σ freevar
saving = Σ opening + (Σ closing − Σ freevar)
```

**`Σ freevar` is the null-result counter — this slice's `climbs`.** It counts the `var(k-1)` nodes the
fused walk still allocates for body free variables above the binder. It is a proper subset of
`Σ closing`: today's closing pass allocates those same var nodes, *plus* the spine down to them (which
`subst` had already rebuilt), *plus* a rebuild of every substituted argument copy whose free indices sit
above the cutoff. The middle and last of those three are what fusion deletes.

**A ceiling is not a claim about time.** `Σ opening + Σ closing` is 18.0% of allocations, and the zipper
design's PART C.2 fitted prices say a node share and a time share are different quantities. The ceiling
gates the *decision to write code*; §5's second bar is what decides shipping.

## 5. The bar, set before the number is known — and PASSED at 4.3%

**GO / NO-GO — counts, computed before a line of reducer code:**

- `Σ freevar < 40%` of `Σ opening + Σ closing`, i.e. the fusion recovers **more than 60%** of the 18.0%;
  **and**
- no corpus row's total allocations rise.

The count is machine-independent, which is why it is the gate that runs first — the zipper design's §5,
*"counts before seconds"*.

**SHIP — seconds, after the prototype exists:**

- nested groups, levels 1–11: **>= 1.10x** wall-clock;
- 46-program corpus: **>= 1.00x**, i.e. no regression.

> **GATE RESULT — 2026-08-03.** `Σ freevar` is **1,458** against `Σ opening + Σ closing` of **34,085**,
> i.e. **4.3%** against a bar of 40%. **PASSED.** Corpus rows where allocations rise: **0** — and 0 of
> the 13 family rows. The formulation contest, on the corpus: `Σ β fused` **69,646** against `Σ β occ`
> **33,051**, so §2's incremental form **loses**, which was **not predicted**. Family: `beta_today` **390,859** →
> `fused_incr` **310,926** at level 1 and **718,210** → **299,819** at level 11. Raw output:
> `shift_cost_probe` and `lambda_sharing_probe`, re-runnable rather than quoted.
>
> **THE CONTEST SPLITS BY CORPUS, AND §2 IS WRONG ABOUT THE HALF IT GENERALISED FROM.** The whole gap
> between the two formulations is `Σ reshift − Σ per_occ`, since `Σ spine` and `Σ freevar` are common
> to both. On the corpus that is **44,539 against 7,944** — per-occurrence is 5.6x cheaper and `occ`
> wins by 36,595 allocations, a 2.11x. On the family it is **64,006 against 96,036** — per-occurrence
> is 1.5x dearer and `incr` wins by 32,030, a 1.0095x. §2 calls the direction *"forced rather than
> incidental"*; it is not, it is **the family's direction**, and the corpus's opposite direction was
> already in the record before this design was written — `shift_cost_probe.rs`'s module doc states the
> lifted rewrite's *"win is 2.16x on a quantity that is 36,595 allocations across all 46 programs"*,
> and 36,595 is exactly `Σ reshift − Σ per_occ` as measured here. So §2's error is not a measurement it
> lacked; it is a generalisation over a record that already carried both signs.
>
> **What that does and does not move.** It does not move the GO/NO-GO gate: that bar is about
> `Σ freevar` and about no row rising, and **both** formulations clear **both** clauses on all 46
> corpus rows and all 13 family rows. §2.2 also holds — 88.4% of corpus and 89.2% of family β-steps
> have a closed argument, so `Σ reshift` is bit-for-bit unchanged by fusion either way, and the choice
> is genuinely *which* fusion rather than *whether*. What it does move is Task 5, which can no longer
> implement §2 on §2's argument: the argument is falsified on the corpus, the corpus is the
> **>= 1.00x** no-regression bar above, and the 1.0095x by which `incr` wins the family is not a
> margin to spend a central claim on. §8's *"not the per-occurrence formulation — unless PART B's
> `Σ fused_occ` says otherwise on this corpus"* is the escape hatch this design wrote for itself, and
> **PART B said otherwise.**
>
> **Why `Σ freevar` is believable at 4.3%, and what is not evidence for it.** `freevar <= closing`
> holds on all 46 corpus rows, and `freevar == 0` exactly where `closing == 0` — 46 tests of §4's
> *"proper subset of `Σ closing`"* that nothing asked for. Corpus-wide the ratio is **6.3%**, which is
> the mechanism rather than a coincidence: the closing shift rebuilds whole *paths* to free variables
> and `Σ freevar` counts only the leaves at their ends. The family's `two 500-lists` row has
> `closing = 5` against `freevar = 0`, so the biconditional is a corpus fact and the subset relation is
> the general one. **What is NOT evidence:** `Σ opening + Σ closing = 34,085` agrees with the zipper
> design's §5b to the unit, and that is an *identity*, not a corroboration — both are pre-existing
> `Work` fields this branch never touched and §5b's table was built from this same probe, so the
> agreement could not have come out otherwise. All it establishes is that Tasks 1–2 perturbed neither
> counter, which is worth knowing and is not confirmation of anything.

**DECISION — 2026-08-03.** Asked which formulation to ship given the split, the project owner chose to
**keep the incremental form (`beta_fused_incr`)**. Reasoning on the record: the identical
corpus-versus-family split on the identical quantity (`Σ reshift` against `Σ per_occ`) was already
adjudicated on this thread when the lifted-shift slice was killed — the roadmap's `CLOSED 2026-08-02`
block states the verdict as *"a change that is +19% on programs finishing in microseconds and −1% on
the ones that do not is not worth its blast radius."* `incr` leaves `Σ reshift` untouched and therefore
inherits none of that slice's risk. ~~And the fork is small against what it sits inside: **~1%** against
a primary win that runs **1.26x** (family level 1) to **2.40x** (level 11) — a refinement on the
result, not the result.~~ **CORRECTED 2026-08-03 — unscoped, that is the same family-only
generalisation §2 was struck for.** On the family the fork *is* small against what it
sits inside — ~1% against a primary win running 1.26x (level 1) to 2.40x (level 11) — and "a
refinement, not the result" holds there. On the corpus it does not: the primary win is `Σ β today`
102,273 → `Σ β fused` (incr) 69,646, **1.47x**, and the fork itself — `Σ β fused` 69,646 against `Σ β
occ` 33,051 — is **2.11x**, larger than the win it sits inside. On the corpus the fork *is* the result,
not a refinement on it, so this reason holds only on the family and does not generalise. **The decision
does not rest on it**: the precedent above and the `Σ reshift`-untouched reason stand unaided without
this clause, and the second is the sharper of the two — the per-occurrence form would swap `Σ reshift`
for `Σ per_occ` in the fused walk, importing the falsified rewrite's own quantity into the very slice
this decision is trying to keep clean.

**Why the second bar is in seconds even though the house rule prefers counts.** The lifted-shift slice
cut allocations by ~19% of the reducer's total and measured **0.99x** on the family. A count gate alone
would have passed it. The family is the ship bar rather than the corpus because the corpus replays in
5.3 ms post-zipper and is not something a user waits for, while `Σ opening` is the only census column
that scales with the family.

**Both figures are reported as ranges over four runs, never as point values** — the rule from
`docs(lambda): four wall-clock quotes were still point values, one of them a heading`.

> **SHIP RESULT — 2026-08-03. THE BAR IS MISSED.** The corpus clause **passes at 1.288–1.308x**; the
> family clause — the one this slice was selected on — is **missed at 0.910–0.925x**, which is a
> **regression** and not a shortfall. **No level of the family reaches 1.00x, let alone 1.10x.** The bar
> is a conjunction, so the slice does not ship on its stated bar.
>
> Method, per §6.3: four runs per side, two builds, **probes held constant**. The branch as it stands;
> then `git checkout main -- crates/redextape-core/src/lambda/term.rs` for the three-pass `beta` with
> this branch's probes; then restored, `git status --short` clean. `--release`, one run at a time, each
> under `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0`.
>
> | | three-pass | fused | ratio |
> | --- | --- | --- | --- |
> | 46-program corpus, Σ `replay ms` | 7.416–7.466 ms | 5.707–5.760 ms | **1.288–1.308x** — PASSES `>= 1.00x` |
> | nested groups, Σ levels 1–11 | 84.139–84.825 s | 91.676–92.452 s | **0.910–0.925x** — MISSES `>= 1.10x` |
>
> The corpus figure is summed from **PART B's** `replay ms`, which prints three decimals. PART A's
> column and the `corpus that replays in …` summary line are the same quantity rounded to one, which
> is 1.8% of the total and too coarse to sit under a `>= 1.00x` bar; taken from PART A the same eight
> runs give 7.4–7.5 → 5.7–5.8 ms, a 1.276–1.316x, and the wider range is print resolution, not spread.
>
> Per level, from `shift_cost_probe`'s reduction ramp. Ratio is three-pass ÷ fused, so above 1.00x is a
> fusion win. **The β-step counts are identical to the unit on both sides at every level**, which is
> what says the two builds reduce the same terms rather than two different workloads:
>
> | level | β-steps | three-pass s | fused s | ratio |
> | --- | --- | --- | --- | --- |
> | 1 | 109,565 | 8.386–8.576 | 8.605–8.693 | 0.965–0.997x |
> | 2 | 109,594 | 8.407–8.575 | 8.769–8.917 | 0.943–0.978x |
> | 3 | 109,151 | 7.861–8.041 | 8.521–8.655 | 0.908–0.944x |
> | 4 | 108,708 | 7.733–7.885 | 8.437–8.513 | 0.908–0.935x |
> | 5 | 108,265 | 7.523–7.587 | 8.385–8.442 | 0.891–0.905x |
> | 6 | 107,822 | 7.504–7.551 | 8.305–8.349 | 0.899–0.909x |
> | 7 | 107,379 | 7.457–7.486 | 8.366–8.470 | **0.880–0.895x** — worst row |
> | 8 | 106,936 | 7.373–7.452 | 8.151–8.233 | 0.896–0.914x |
> | 9 | 106,493 | 7.335–7.390 | 8.087–8.214 | 0.893–0.914x |
> | 10 | 106,050 | 7.308–7.325 | 7.989–8.040 | 0.909–0.917x |
> | 11 | 105,607 | 7.201–7.227 | 7.903–7.999 | 0.900–0.914x |
>
> **On the corpus no row's median regresses, and three rows carry 87% of the win** — row 35,
> 2.700–2.732 → 1.773–1.789 ms; row 9, 1.590–1.620 → 1.211–1.226 ms; row 36, 0.858–0.866 →
> 0.692–0.700 ms, together 1.491 ms of a 1.705 ms total. Four rows (28, 31, 32, 33) have **overlapping
> ranges** — indistinguishable rather than improved, median deltas of 0.000–0.004 ms — and one row
> prints 0.000 ms on both sides. So the honest form of "no regression" is *no median regression, with
> four rows at parity*, not *every row improved*.
>
> **NOT AN ORDERING ARTIFACT, AND THAT WAS CHECKED RATHER THAN ARGUED.** All four fused runs preceded
> all four three-pass runs, so thermal or frequency drift is a live confound — and it points the wrong
> way, since the *later* runs are the *faster* ones. It was still tested directly: both example binaries
> were snapshotted and re-run alternated, B–A–A–B for the family and B–A–B–A for the corpus. Family
> totals came back 84.780–85.837 s three-pass against 92.281–92.409 s fused (**0.917–0.930x**, level 11
> at 0.915–0.916x); corpus came back 7.384–7.393 ms against 5.692–5.714 ms (**1.292–1.299x**). Both
> splits reproduce.
>
> **THE REGRESSION IS NOT IN `beta`, AND THAT IS ARITHMETIC RATHER THAN INFERENCE.** At level 11 fusion
> removes `beta_today` 718,210 − `fused_incr` 299,819 = **418,391 allocations over 105,607 β-steps**,
> 3.96 per step. The measured loss is 0.74 s over the same steps, **7.0 µs per β-step**. Four fewer
> allocations cannot cost seven microseconds; whatever got dearer is not the allocations this slice
> deletes. The same tables also come back **byte-identical between the two builds** — both census tables
> in `shift_cost_probe`, and every non-timing column of `lambda_sharing_probe` — which is the check that
> the counters are properties of the reduction and not of the build that ran them.
>
> **WHY FUSION CANNOT WIN THIS FAMILY, WHICH IS A WEAKER AND ESTABLISHED CLAIM.** The family's per-step
> cost is ~68 µs three-pass and ~75 µs fused. `LambdaCursor::next` is `depth_exceeds` — O(1) off the
> stored `depth` since 2026-08-01 — plus `reduce_step`, and `reduce_step` has **no memo**: it recurses
> into both children of every `App` looking for the leftmost-outermost redex, so a subterm reached by
> two edges is searched twice. Its cost is therefore a function of the *logical* tree, which is
> identical on both sides, and **no allocation saving can reduce it.** §1 selected this family because
> `Σ opening` is the only census column that scales with it; the column scales, and the clock the column
> is supposed to move does not belong to `beta`.
>
> **WHAT IS NOT ESTABLISHED, AND IS LEFT OPEN RATHER THAN GUESSED.** The above says fusion cannot *win*
> here. It does not say why fusion *loses* 7 µs per step. The terms are equal and the step sequences are
> equal, so the only things that differ are `beta`'s own internals — where the fused walk does strictly
> less, one traversal of the body against `subst`'s traversal plus the closing shift's traversal of its
> result — and the physical shape of the DAG handed to the next `reduce_step`, which fusion leaves more
> shared because the closing `shift(-1, 0, ·)` used to rebuild each argument copy. A locality or
> allocator-churn account of that is *plausible and unmeasured*: `perf` is not installed on this host and
> neither probe carries a counter that would separate it from the alternatives. **It is recorded as an
> open question, not as a mechanism.** Naming one here would be the same move §2 was struck for.
>
> Raw output for all twenty-four runs — sixteen primary, eight interleaved:
> `.superpowers/sdd/task-7-report.md`.


### 5.1 THE FAMILY BAR IS RETIRED AS MALFORMED, NOT AMENDED — 2026-08-04

**It could not have been passed by any change to `beta`, and that is arithmetic rather than opinion.**
~~All of `beta` is 0.106–0.114 s of an ~85 s family run — 0.13%, so making `beta` free would yield
1.0013x.~~ **CORRECTED 2026-08-04 by the whole-branch review, which caught this mixing two builds.**
The 0.106–0.114 s numerator is the **fused** build's `beta`; the ~85 s denominator is the **three-pass**
build's total, and the fused run is ~92 s. A ceiling on what *any* `beta` could deliver has to use the
BASELINE's `beta` cost. Instrumented on a clean clone, `Instant` around the one `beta` call, Σ levels
1–11:

| build | `beta` | total | share | ceiling if `beta` were free |
| --- | --- | --- | --- | --- |
| three-pass | **0.2124 s** | 86.375 s | **0.246%** | **1.0025x** |
| fused | 0.1160 s | 92.533 s | 0.125% | 1.0013x |

The bar asked for **1.10x** against a ceiling of **1.0025x** — a **40x** shortfall. No formulation, no
allocator, no author could have cleared it. The correction moves the figure by ~1.9x and the conclusion
survives with two orders of magnitude to spare, which is why it is a correction and not a retraction.

**Why it was written anyway, stated so the next bar is not written the same way.** §5 chose the family
over the corpus on a sound principle — *the corpus replays in 5.3 ms and is not something a user waits
for* — and then never asked what share of the family `beta` actually was. The family is dominated by
`reduce_step`, which has no memo and chases a ~2,840-node spine from the root every step because this
family caps on **depth**. `beta`'s share of that is a tenth of a percent. **A bar must be sized against
a measured denominator, not against a workload's importance.** That is the transferable finding, and it
is the fifth time on this thread that a number was sized against something nobody had measured.

**This is a retirement, not a renegotiation, and the distinction is the whole of the discipline here.**
A renegotiation moves a bar after seeing a number you dislike. This bar is being struck because it was
unsatisfiable when written, by a factor its own author could have computed and did not. The corpus
clause is untouched and **passed on its own terms at 1.288–1.308x against `>= 1.00x`.**

> **SHIP RESULT UNDER `mimalloc` — 2026-08-04.** The probes took `mimalloc` as their global allocator
> (roadmap, *"DEFERRED UNTIL WASM"*), which is the environment every figure from here on is measured in.
> Six runs a side, alternated, Σ levels 1–11:
>
> | | three-pass | fused | ratio |
> | --- | --- | --- | --- |
> | nested groups, glibc | 84.67–86.20 s | 92.52–93.53 s | 0.905–0.932x |
> | **nested groups, mimalloc** | 75.74–78.79 s | 77.50–79.98 s | **0.978x median** |
> | 46-program corpus, glibc | 7.416–7.466 ms | 5.707–5.760 ms | **1.288–1.308x** |
>
> **The residual 2% is a REGRESSION and is recorded as one.** Three-pass is faster in **30 of 36**
> run pairings — small, consistent, not noise. It is *mostly* explained and not fully: the L1 DTLB gap
> that accounts for the glibc regression closes from **+52% to +1.9–2.2%** under mimalloc, and the last
> couple of percent has no named mechanism. Four candidate mechanisms and four allocator knobs were
> measured out getting this far (investigation record).
>
> **WASM IS OPEN AND UNMEASURED.** `wasm32` uses `dlmalloc`, which is neither glibc nor mimalloc, and
> the mechanism here is allocator-specific by construction. Nothing licenses carrying either number
> across to the browser target.

**VERDICT: SHIP.** Against honest criteria rather than the retired one — correct over 88,960 pairs on
terms and 88,960 on allocation identity; **1.231–1.255x on the corpus under the shipped allocator**,
which is what the demonstration actually reduces; **more sharing** (18,939 → 17,920 allocations at
identical node totals), because the three-pass closing shift had been *un-sharing* argument copies it
walked as a tree; against **~2% on a depth-capped fixture that is non-terminating by construction and
halts on `MAX_TERM_DEPTH` rather than on an answer.**

> **TWO FIGURES IN THE LINE ABOVE WERE GLIBC MEASUREMENTS AND ARE CORRECTED — 2026-08-04, by the
> whole-branch review.**
>
> ~~**~1.30x on the corpus.**~~ That is 1.288–1.308x measured under **glibc**. Re-measured with both
> `beta`s built into the unmodified mimalloc probe, three runs a side alternated, Σ PART B `replay ms`:
> three-pass **5.185–5.258 ms**, fused **4.191–4.211 ms** — **1.231–1.255x**. Still clears `>= 1.00x`
> comfortably; the number was wrong, not the conclusion. **The rule that catches this is one this branch
> wrote and then failed to apply to itself:** `3ca6df3` caveated the zipper's 1.41–1.43x at seven sites
> because *"the zipper's own mechanism is reducing allocation — so a cheaper allocator plausibly shrinks
> its margin."* β-fusion's mechanism is also reducing allocation. The rule was applied to the
> neighbour's number and not to this one.
>
> ~~**14.6% fewer instructions under both allocators.**~~ **False under mimalloc, and this one mattered
> to an argument.** glibc 1.0914e12 → 0.9325e12 is −14.6%; mimalloc **0.6896e12 → 0.6886e12 is
> −0.15%**, because mimalloc's shorter malloc path removes almost all of the difference. It is dropped
> from the verdict rather than restated, because a 0.15% instruction saving is not a reason to ship
> anything — see the counter-argument below, where it was doing real work and no longer can.

**The counter-argument, kept because it is coherent — and WEAKER than this document first stated it
down.** By §5's own principle — measure what people wait for — the family is the subject that matters
and fusion makes it marginally worse. What answers it is that reverting does not return the tree to
neutral: it returns it to a `beta` that **destroys sharing** and is **1.23–1.25x slower on the corpus**.

~~and executes 14.6% more instructions~~ — **struck 2026-08-04**: under the shipped allocator that is
0.15%, so the instruction-count leg of this rebuttal carries essentially nothing. What survives is the
sharing recovery, which is a **count** and therefore immune to any allocator, and the corpus win at its
corrected size.

**AND THE INVERSION THIS DOCUMENT DID NOT NAME, added by the same review.** §5 disqualified the corpus
as a ship criterion in as many words — *"the corpus replays in 5.3 ms post-zipper and is not something a
user waits for"* — and the verdict above then leads with the corpus. That may well be right: 46 real
programs are a better subject than one non-terminating depth-capped fixture. But it **inverts §5's own
stated principle**, and the first draft of this section argued only that "the family is not the subject
that matters" without admitting that the replacement subject is the one §5 had already ruled out. Read
the family as the product-relevant workload and reverting is defensible; that reading is recorded here
rather than argued away.

## 6. The instrument — and the gap that stops the family half today

### 6.1 `lambda_sharing_probe.rs` PART B — the corpus half

`Work` gains **two** fields, and PART B gains two projected totals produced by walks that **mirror the
candidate arm for arm**, not by summing existing columns:

```
Σ fused_incr   mirrors §2's beta_go              = Σ spine + Σ reshift + Σ freevar
Σ fused_occ    mirrors §5b's per-occurrence form = Σ spine + Σ per_occ  + Σ freevar
```

- **`freevar`** is new to both probes.
- **`per_occ` is new to this probe.** `shift_cost_probe.rs`'s census has a faithful `per_occ` that
  mirrors `subst` arm for arm and is the thing to model it on. `Work`'s existing `occ_times_arg`
  (`Σ occ×arg`) is **not** it — that is one of the three STALE models kept beside the faithful counters
  as controls, and reusing it would reproduce the exact error this probe was repaired for.

Mirroring rather than modelling is not stylistic. PART B's own module doc records that `Σ abs×arg` was a
static model that over-reported the quantity it named by **~1,584x** and stayed quoted by four documents
for a day after the code moved out from under it. Both new totals enter PART C's contest against
`Σ alloc`, so a candidate that prices badly is visible rather than assumed — and `Σ fused_occ` is carried
specifically so that §2's disagreement with §5b is **measured on this corpus rather than argued from this
morning's table.**

### 6.2 `shift_cost_probe.rs`'s census — the family half, and it cannot compute the gate today

The census prints `opening | spine | reshift | per_occ`, and its `today()` is
`opening + spine + reshift`. **`closing` is absent, and its absence was correct for the question that
census was built for:** comparing today's `subst` against the lifted rewrite, the closing shift is paid
by both sides and cancels out of the ratio. It does not cancel here — it is half of what this slice
deletes.

So the census gains `closing`, `freevar` and a **second contest** — `beta_today` against
`beta_fused_incr` and `beta_fused_occ` — printed as its own table. ~~`today()` becomes
`opening + spine + reshift + closing`.~~ **It does not: `today()` and `lifted()` stay exactly as they
are.** `closing` cancels between those two, and the 0.99x that ratio produced is a landed finding the
roadmap quotes; adding a term to both sides of it would move a published number without adding
information. The fusion contest gets its own totals beside them.

~~**Until that lands, §5's GO/NO-GO gate is computable on the corpus and not on the family**, which is
the half that selected this target. This is the first task of any plan built from this document.~~
**LANDED 2026-08-03**, as that plan's first task: the census prints `closing` and `freevar` and the
second contest, `today()`/`lifted()` are untouched, and the level-1 and level-11 rows of the lifted
table are unchanged to the unit — which is the check that adding the columns moved nothing. §5's gate
ran on both halves; its GATE RESULT block has the numbers.

### 6.3 Wall-clock A/B — across two builds, not two functions

PART D A/Bs `LambdaCursor` against `ZipperCursor`, which works because both live in `src/`. Two `beta`s
cannot, and carrying a dead three-pass copy in `src/` to make the harness symmetric would be worse than
the measurement is worth.

**So: counts in one build, seconds across two.** Run the probes on `HEAD` and on the branch, four runs
each, corpus and family, on the same host, `--release`, under
`systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0` — the memory rule
`shift_cost_probe.rs`'s module doc carries, for the reason it carries it: one λ measurement on this
thread has already cost 60 GiB and all swap.

## 7. Gates and tests

**The gate is zero edited expectations.** `beta` has two callers, both in `src/`, so the 46-program
three-way oracle, every golden, every step count and the sharing pins all follow from equivalence and
must move by nothing. A single edited expectation is a correctness defect and ends the slice, not a
number to renegotiate — the shape the zipper's §5 uses.

1. **`tests/subst_differential.rs` gains a fused-vs-three-pass differential** over the same generated
   triples the lifted-shift investigation ran (355,840 triples, 0 mismatches), with a local
   `beta_three_pass` — the pattern `subst_naive` already establishes in that file. This is the test that
   would catch a wrong index in §2.1's first row, which is the only subtle case.
2. **`tests/lambda_foreign_reader.rs` stays three-pass** and becomes an independent oracle at zero cost:
   it is a complete second implementation with its own term type, written from the documented spec, and
   it reduces the whole corpus. **But its §5 goes stale on landing.** That section records
   `beta body arg = shift(-1, 0, subst(0, shift(1, 0, arg), body))` as *"VERIFIED, all three shifts
   independently"* against `term.rs` — and `term.rs` will no longer have three shifts. Rewording it so it
   documents *the rule the printed form implies* rather than *the implementation `term.rs` happens to
   have* is part of this slice. Leaving it is exactly the drift class the roadmap's
   `grep the tree for a falsified claim, not the document that stated it first` entry is about.
3. **`term.rs`'s existing `beta` unit tests pass unedited** — `beta_reduces_identity_application`,
   `beta_reduces_const_application`, `a_beta_step_is_bounded_by_allocations_not_by_logical_nodes`,
   `a_beta_step_inherits_the_untouched_sibling_allocation`,
   `a_real_multi_step_reduction_still_shares_allocations_across_steps`. The last three are the sharing
   pins and are the reason §2.3 is stated as a claim rather than a hope.
4. **A new pin for §2.4:** that the fused `Var` arm's `k > j >= 0` invariant holds — i.e. that a body
   free variable above the binder is the only route to `*k - 1`, so the subtraction is safe by branch
   condition. A `debug_assert!` in the arm plus a test that reaches it, in the shape `shift`'s own
   `debug_assert!` and `shift_still_moves_a_free_index_at_the_cutoff` already use.
5. **`shift`'s doc block is repaired** where it names `beta` as its only negative-`d` caller.

## 8. Non-goals

- **Not narrowing `shift`'s `d: i64`.** After §2.4 nothing in `src/` passes a negative `d`, which makes
  an unsigned `d` and the deletion of the negative-index assert *look* like free cleanups. They are not:
  `shift` is `pub`, the assert still guards callers this crate does not own, and the differential test
  passes negative `d` deliberately. A separate slice with the public-API survey it deserves.
- **Not `Σ spine`.** The zipper design §5b prices it as near-irreducible: the `maxfree` short-circuit
  already prunes every subtree without an occurrence, so what `subst` rebuilds is the minimum a
  substitution producing a new term can rebuild. Going lower means explicit substitutions or a
  Krivine-style machine, which the zipper design §6 rejects on premise grounds rather than performance
  grounds (`README.md`: *"what you see is the genuine computation"*).
- **Not n-ary β.** The concurrency design §8.2 measured 1.3% consecutive root redexes. Dead already.
- **Not the per-occurrence formulation** — unless PART B's `Σ fused_occ` says otherwise on this corpus,
  which is why it is measured rather than dismissed (§6.1). **2026-08-03 — the condition fired:**
  `Σ fused_occ` said otherwise on the corpus, by 2.11x, and §5's GATE RESULT records it. The bullet
  stands anyway: §5's DECISION keeps the per-occurrence formulation a non-goal **on risk and precedent,
  not on count**, so the fired condition does not reopen it.
- **Not a `StepEvent` change.** Fusion here is inside one β-step; the step sequence is untouched by
  construction.

## 9. What would falsify this design

Recorded as predictions, in the form that makes them checkable before the code exists.

- **The ceiling gate stops it.** `Σ freevar >= 40%` of `Σ opening + Σ closing` — free-variable
  occurrences above the binder would have to rival the spine and the argument copies together. **If this
  fires, no reducer code is written.** §3's worked example is the intuition for why it should not:
  `Σ freevar` counts leaves, and the two quantities it is measured against count interior nodes and
  whole argument rebuilds.
- **A count win is a clock loss.** This is not a hypothetical — it is what happened to the lifted-shift
  slice on 2026-08-02, which cut ~19% of allocations and measured 0.99x. §5's second bar exists because
  of it.
- **The corpus shows nothing, and this is the outcome to expect.** `Σ opening` is 5.7% corpus-wide; the
  case rests on it running 20,725 → 190,666 across levels 1–11. If the corpus is flat **and** the family
  misses 1.10x, this is a null result and gets written up as the fifth on this thread rather than
  shipped. A design that can only be right is not a measurement.
- **The equivalence gate fails.** Any divergence in the three-way oracle, a golden, a step count or a
  sharing pin ends the slice on the spot. §2.1's first row — the up-and-down cancellation on the
  substituted argument — is where a wrong index would hide, and it is what test 1 exists to catch.
- **§2.3 is wrong about sharing.** If the fused walk prunes at even one point differently from the pair
  it replaces, an allocation shared today becomes unshared, and
  `a_beta_step_inherits_the_untouched_sibling_allocation` is the pin that would say so.

### 9.1 The verdicts — 2026-08-03, marked against numbers written after the predictions

**Convention: HIT means the falsifier FIRED** — the design was wrong in the way this bullet named.
MISSED means it did not. One of five fired, and it is the one that decides the slice.

1. **The ceiling gate stops it — MISSED.** `Σ freevar` came in at **1,458 against 34,085, 4.3%**, where
   the bullet's falsifier was 40%. It was not close, and §3's reason for expecting that — `Σ freevar`
   counts leaves while both quantities it is measured against count interior nodes and whole argument
   rebuilds — held on all 46 corpus rows and all 13 family rows.
2. **A count win is a clock loss — HIT, and this is the bullet that ends the slice **on its stated bar — see §5.1, which retires that bar as unsatisfiable and ships anyway**.** On the family,
   allocations fell **2.40x at level 11** (718,210 → 299,819) and the clock went to **0.900–0.914x**.
   The bullet was written from the lifted-shift slice's 0.99x and it has now fired a second time on the
   same family, with a *larger* count win behind it. **The corpus did not fire it** — 1.47x in counts,
   1.288–1.308x on the clock — so what is established is not "counts never predict seconds" but that on
   this family they do not, because the family's per-step cost is a search that is insensitive to
   allocation (§5's SHIP RESULT).
3. **The corpus shows nothing, and this is the outcome to expect — MISSED, in both halves and in
   opposite directions.** The bullet predicted the corpus would be flat and named the family as where
   the case rests. Measured, **the corpus is the only half that won** — 1.288–1.308x on a `Σ opening` that
   is 5.7% of its allocations — and the family, chosen precisely because `Σ opening` runs 20,725 →
   190,666 across it, **regressed on every level**. The conjunction the bullet defines a null result by
   (*"the corpus is flat AND the family misses 1.10x"*) therefore did **not** fire; the slice is not the
   fifth null result on this thread but a **split**, which no prediction in this section anticipated.
   **The reasoning error is now visible and it is the same one §2 and §5's DECISION were both struck
   for:** the family was selected by an allocation column, and this design never asked what share of the
   family's *seconds* that column could reach.
4. **The equivalence gate fails — MISSED semantically, with one edited expectation to declare.** The
   three-way oracle, every golden and every step count are unmoved, and §7's five test items landed.
   `tests/subst_differential.rs::the_shipped_beta_agrees_with_the_three_pass_formulation_on_every_enumerated_pair`
   runs the fused `beta` against a local `beta_three_pass` over **88,960 (body, arg) pairs, 0
   mismatches**. **But §7's letter is "zero edited expectations", and two
   constants in `tests/lambda_sharing.rs` were edited**: 18,939 → 17,920 and 4,364 → 4,305 distinct
   allocations. Both moved *down*, with the node totals they divide (502,146 and 1,379,187) unchanged to
   the unit, so the pins record strictly better sharing rather than a divergence — but a gate that says
   "zero" and then re-pins twice should say so out loud rather than be read as clean.
5. **§2.3 is wrong about sharing — MISSED, and inverted.** Not only was no sharing lost, sharing
   *improved*, unpredicted: the three-pass closing shift walked `subst`'s result as a tree with no
   memoisation and rebuilt each substituted argument copy, so fusion deleting it collapses N copies back
   to N handles on one allocation. That is the mechanism behind item 4's two re-pinned constants, and it
   is pinned as a mechanism by
   `a_beta_step_shares_one_allocation_across_every_occurrence_of_an_open_argument` at binder depth 0 and
   at depth >= 1. **This design predicted sharing would be preserved and it was improved** — the one
   result on this slice that is better than what was written down in advance.
