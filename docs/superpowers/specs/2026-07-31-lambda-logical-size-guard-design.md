# λ logical-size guard — design

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

**SUPERSEDED — do not build what this document specifies.** Its successor is
[`2026-07-31-lambda-shared-subterm-guard-design.md`](2026-07-31-lambda-shared-subterm-guard-design.md),
which landed 2026-07-31 and bounded the largest *shared* subterm instead of the term's total size,
because a bound on total size cannot tell sharing-induced blow-up from a program that is simply big
(§10). **That successor was itself reverted 2026-08-01** — do not build it either; see its §10 and the
note below. Read this document for **why** a total-size bound fails — §10 is the falsification, and it
is the reason the successor was shaped differently — not for a design to follow.

**Status:** designed 2026-07-31; Tasks 1 and 2 landed; **the guard itself was implemented on 2026-07-31
and abandoned before commit.** §10 is the record of what falsified it, and is the first thing to read.

~~"Closes the reachable hang recorded in the roadmap's *"THE NEXT λ SLICE IS NOT the `subst` fix"*
entry and sized in
[`2026-07-30-lambda-structural-sharing-design.md`](2026-07-30-lambda-structural-sharing-design.md) §10,
option (a)."~~ — **it does not.** ~~That hang is **still open**.~~ The next attempt must guard on
*sharing* rather than on size, for the reason in §10, and that is a new slice with its own design.
**It was — and the hang is OPEN AGAIN.** `MAX_SHARED_LOGICAL_NODES` = 10,000 plus
`LowerError::TooShared` landed (`1652e09`) and was **reverted 2026-08-01, falsified by measurement in
the same way this document's own guard was**: the mechanism it named is not what `subst` does, and a
two-list program with no recursion scores 4 against its bound of 10,000 while taking 19.0 s in one
β-step. See the successor's §10. This document specifies nothing that should be built; it records why —
and it now has company.

**What survives this document:** §2's `logical_size`, committed and tested; §4's curve, §8's TM
verification, and the de-duplicated fold in `blowup_probe.rs`, all committed. **What does not:** §3's
placement, §5's error, §6's guard tests, and §4's capability claim — corrected in place below.

**Scope:** `redextape-core`, λ path only. Zero new dependencies. No printed byte moves.

## 1. Why this slice exists

**512 bytes of ordinary surface syntax reach a β-step that does not finish.** *(As of 2026-08-01 it
finishes — the whole program reduces in 7.48 s. See the banner above.)* Eleven nested two-member
mutually recursive `fn` groups lower in 196 µs to 1,644 allocations holding 616,152 logical nodes;
reducing that term reaches a β-step that ran 13 minutes at 974 MB without completing.

Two corrections to that sentence, both measured on 2026-07-31 and both load-bearing for §4:

- **It is eleven groups, not ten.** §4's table and `blowup_probe.rs` count groups, and 616,152 is the
  eleventh row; the tenth is 307,928. The two indexings sit one apart and have already caused one
  misreading, so this document uses the group count throughout.
- **The stuck step is not the first one.** One *cursor* step at 616,152 nodes — the depth guard plus
  the first β-step, which is what `--beta-curve` times — takes **50 ms**, so the first β-step costs at
  most that. The cost accrues across the run: a step's output can be |body| x |arg| nodes, and the next
  step starts from that output. This matters because the obvious way to calibrate the bound — time one
  step and see where it hurts — measures the wrong thing, by **32x** against the size that actually
  hangs (19,726,040 / 616,152). §4 records what that curve actually shows.

The mechanism is `lambda/lower.rs:453` — `out = app(out, projection(group.clone(), j))` inside
`for j in 0..n` in `lower_group`, which clones the whole group term once per member. That is linear in
n. It becomes exponential because it *nests*: a member's value is a lowered `fn` body, a body is a
block, and a block may declare its own mutually recursive group, so level k's group sits inside level
k−1's and the factor multiplies.

**The root cause is pre-existing.** Under `Box` the clone was a deep copy, so the same program died
loudly inside `lower`. Under `Rc` it is a refcount bump, so `lower` succeeds and the program dies later
and silently in the reducer. This slice does not fix `lower_group`; it refuses the program before a
step is taken.

**Nothing existing catches it.** `MAX_TERM_DEPTH` is not approached — depth grows ~12 per level, so
3,000 is reached around 250 levels, at a ratio of 2^250. `MAX_REDUCTION_STEPS` is never consulted,
because control never returns from `reduce_step`. A wall-clock budget between steps does not help
either: a 90 s budget was measured producing a 330-second run. **Everything that runs between steps
shares one blind spot, and the failure is inside a step.** That is the whole argument for guarding at
lowering time.

## 2. What it measures

```rust
/// Nodes reached walking BOTH children of every `App` — the size of the tree the term *denotes*,
/// not the DAG that stores it.
fn logical_size(t: &LambdaTerm) -> u64
```

Three properties, each load-bearing:

- **Memoized by allocation identity** (`HashMap<usize, u64>` keyed on `LambdaTerm::alloc_id()`), so the
  fold costs **O(physical)** — 194 allocations for `sum(5)`, 9,541 for a term of logical size 2^72.
  Computing it in O(logical) would be the hang it exists to prevent.
- **Iterative**, an explicit post-order stack. A walk added to stop an overflow must not overflow.
- **Saturating addition.** The measured quantity reaches 2^72.2 and `u64` holds 2^64. Saturating is
  sufficient because the comparison is one-sided: anything that saturates is far past the bound. The
  value returned is therefore a **floor** on the true logical size, exact below `u64::MAX` and
  `u64::MAX` above it. Nothing may treat it as an exact count without checking for saturation.

## 3. Where it runs

**Not anywhere — this section describes code that was written and withdrawn (§10).** The placement
argument below is sound and was verified by building it; what failed is §4's claim about *what the
guard would then refuse*. A sharing-based guard would run in the same place for the same reason, so
this section is kept rather than struck.

At the **end** of `lower` and `lower_mapped`, after the term is built, before `Ok`.

That is deliberately the mirror of `too_deep_node`, which runs at the **start** of the same function.
**Depth is a property of the input `Core` and is knowable before lowering; size is a property of the
output term and is not.** The two guards sit at opposite ends of the same function for that reason, and
the doc comment should say so — a later reader will otherwise try to "tidy" them together.

## 4. The bound

```rust
const MAX_LOGICAL_NODES: u64 = 300_000;
```

### The curve it is chosen against

Measured on the nesting family (`crates/redextape-core/examples/blowup_probe.rs`), `levels` counting
mutually recursive groups. The last column is one cursor step, timed on its own (`--beta-curve`); read
the warning under it before using it for anything.

| levels | source | physical | logical | one cursor step (depth guard + β-step) |
| --- | --- | --- | --- | --- |
| 1 | 47 B | 154 | 306 | 0.000 s |
| 2 | 93 B | 303 | 908 | 0.000 s |
| 4 | 185 B | 601 | 4,520 | 0.000 s |
| 8 | 369 B | 1,197 | 76,760 | 0.005 s |
| 9 | 415 B | 1,346 | 153,816 | 0.010 s |
| 10 | 461 B | 1,495 | 307,928 | 0.022 s |
| 11 | 512 B | 1,644 | 616,152 | 0.050 s |
| 15 | 716 B | 2,240 | 9,862,872 | 0.847 s |
| 16 | 767 B | 2,389 | 19,726,040 | **OOM-killed at 2 GiB** |
| 23 | 1,124 B | 3,432 | 2.52e9 | not reached |
| 64 | 3,215 B | 9,541 | ≥2^64 (saturated) | not reached |

The 64-level row used to read `5.55e21 (2^72.2)`, from a private `f64` fold that lived in
`blowup_probe.rs`. That fold is deleted; the shared `logical_size` is `u64` and **saturates**, so the
figure is now reported as the floor it is. Rows 1 through 23 are unchanged to the digit, which is what
cross-checked the de-duplication.

~~"Against a corpus whose largest lowered term is **2,007** logical nodes (three mutually recursive
`fn`s, 697 physical). Everything in the corpus that is not mutual recursion sits at ~1.0x
logical/physical. So 300,000 is **150x the largest corpus program**."~~ — **corrected 2026-07-31: that
program is not in the corpus.**

2,007 is a real measurement and reproduces exactly — `blowup_probe.rs`'s §2b baseline `fn a/b/c … a(5)`,
re-run 2026-07-31 under the 2 GiB cap at 697 physical / 2,007 logical, unchanged to the digit. But §2b
is a **six-program illustrative list**, and the corpus is `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS`,
**46 programs**. `a`/`b`/`c` is not one of them. The bound was calibrated against a headroom figure read
off a list the corpus does not contain.

**Measured over all 46 on 2026-07-31** (`parse` → `desugar` → `lower` → `logical_size`, every program
lowering successfully): the true maximum is **2,173 logical nodes, 751 physical, ratio 2.89x** — the
three-way mutual recursion `fn s0/s1/s2 … s0(4)`. It is clear of the field: second is `fn ev/od/id …
ev(4, id)` at 914, then 912, then `is_even`/`is_odd` at 870, and nothing else exceeds 321. So **300,000
is 138x the largest corpus program**, not 150x. It still refuses ≥10 nesting levels
and permits ≤9; that half of the sentence was read off the curve and is unaffected.

~~"Everything in the corpus that is not mutual recursion sits at ~1.0x logical/physical."~~ — **also
loose.** Measured across the 46, the ratio runs **1.00x to 2.89x**. Exactly 12 of the 46 sit at 1.00x;
the other 34 range 1.03x–2.89x, and the sharing is not confined to mutual recursion — a `while` loop
measures 1.03x, `head(cons(7, nil))` 1.09x, two independent non-recursive `fn`s 1.18x. What *is* true is
the converse: **everything above 1.9x is a mutually recursive group**, and there are five of them.

**What this figure could not catch is in §10.** The largest list literal anywhere in either list is
`[1, 2, 3]` — 57 logical nodes — so list literals were never in the measurement at all, and it is a list
literal that falsified the design.

### A calibration error worth recording, because it nearly shipped a useless guard

The bound was first derived as "N levels permitted" — `2,007 × 2^N`, using the corpus's
three-mutually-recursive-`fn` program as the base. **That is wrong, and a bound of 1,000,000 derived
that way lets the known-hanging 512-byte program straight through.**

The error: 2,007 is not "one level" of the pathological family. That family starts at **306**. Levels
are not a portable unit across program shapes — two programs at "the same level" differ by 6.5x here.
**Node count is the only quantity that transfers**, so the bound must be read off the measured curve
rather than computed from a growth law applied to an unrelated base.

**The base was also the wrong program, which the correction above establishes and this paragraph did
not know.** 2,007 is `blowup_probe.rs`'s §2b baseline, not a corpus member; the corpus maximum is 2,173.
Nothing here changes — the argument is that *no* base transfers, so a wrong one is beside the point —
but it is the second time this section's headline figure turned out to be measured on something other
than what its sentence named, and that pattern is what §10 is about.

### The margin, measured

**Measured 2026-07-31**, every run under `systemd-run --user --scope -q -p MemoryMax=2G
-p MemorySwapMax=0`, one cursor step per point, one term alive at a time, `reduce_trace` never called.
**300,000 is confirmed. It does not move.**

**What one cursor step costs.** The column above. It times `LambdaCursor::next`, which runs
`depth_exceeds` over the full logical tree *before* every β-step (`trace.rs:73`) and does not
short-circuit at these depths — 141 against `MAX_TERM_DEPTH` = 3,000 — so each row is the depth guard
plus a β-step, and is an **upper bound** on that β-step rather than its cost. *(Both facts are
pre-2026-08-01: `depth_exceeds` is now O(1), so a row is the β-step alone.)* The guard's share is
**~2%, derived rather than measured — and ~48x low for a whole run, since it was later measured at 96%
of one; a per-step share says nothing about the run**: `depth_exceeds` is Θ(logical) and `reduce.rs` records it
crossing 3.6 s at 2.52e9 logical nodes, so ~1.4 ns/node, so ~0.9 ms at 616,152 against a 50 ms row —
and the same ~2% falls out at every other row (0.4 ms / 22 ms at 307,928, 14 ms / 847 ms at 9,862,872).
This used to read "~1%", which was neither measured nor derived and was low by 2x. It still changes no
conclusion, which is why the correction is to show the arithmetic rather than to add a second timer.

It never reaches a 10-second budget: it is **OOM-killed at 2 GiB inside a single step at 16 levels,
19,726,040 logical nodes**, having taken 0.847 s at 15 levels. The wall on a first β-step is therefore
**memory, not time**, and it arrives at 48 B per materialized node. **The ~947 MB of *output* alone is
an estimate, not a measurement** — 19,726,040 × 48 B, from a node cost the probe prints and a linear
timing series that supports the model, but the output was never sized because the process died before
it finished existing. `subst`'s per-binder re-copying then carries the peak past 2 GiB. Levels 1
through 15 complete in under a second each.

**The kill point reproduced exactly on a second run; the timings did not** — 15 levels gave 0.852 s
against 0.847 s. What is repeatable here is the boundary, which is the part the bound is read against;
the wall-clock is not, and nothing below leans on it.

**Why that number is NOT the bound, and this is the section's whole point.** 19,726,040 is 65.75x
`MAX_LOGICAL_NODES`, and adopting it would be the calibration error above committed a second time.
A first β-step's cost is set by the term `lower` produced. **The hang is a later step**, whose cost is
set by what earlier steps have already materialized — output can be |body| x |arg|, and the next step
starts from that. The whole-run measurement (`blowup_probe.rs`'s `oom` section) hangs at **11 levels /
616,152 nodes**, a size the single-step curve clears in 50 ms. **A bound read off the single-step curve
would be 32x too loose and would let the known-hanging 512-byte program straight through** — the same
failure, and the same shape of failure, as deriving it from `2,007 × 2^N`. **32x, not 65.75x, and the
denominator is the whole difference:** 19,726,040 / 616,152 = 32.0 measures the single-step wall
against the size that actually hangs, which is what "too loose" means; 19,726,040 / 300,000 = 65.75
measures the same wall against the bound, which is what "clearance" means. Both figures appear in this
section and both are right, so each is quoted with its base.

So the two curves bracket the bound from opposite sides, and only the slower one constrains it:

| | logical nodes | levels | outcome |
| --- | --- | --- | --- |
| whole-run, still stepping | 307,928 | 10 | survives a 2 GiB cap; a 90 s budget overshot to ~330 s |
| **`MAX_LOGICAL_NODES`** | **300,000** | — | refuses 10 levels, permits 9 |
| whole-run, hangs | 616,152 | 11 | a β-step did not return in 13 minutes |
| one cursor step (depth guard + β-step), OOM | 19,726,040 | 16 | killed at 2 GiB inside one step |

**The honest statement of the margin: what is thin is the evidence, not the clearance.**

~~"300,000 sits 1.03x under the largest size still observed making progress … a bound sitting
essentially *on* the boundary."~~ **That is one side of the picture and it manufactures a knife edge.**
300,000 is 1.03x under 307,928, the first refused size — and *simultaneously* **1.95x above 153,816,
the largest size it permits**. Both are true, and quoting only the first makes the bound look brittle.

**It is not brittle, because this family's logical size doubles per level.** There is no program in it
anywhere strictly between 153,816 and 307,928, so a whole range of bounds accepts and refuses exactly
the same programs. **Derive that range from the comparison rather than by eye**, because the comparison
is strictly greater (§5): a bound `B` refuses iff `logical_size(&term) > B`, so `B` *permits* a term of
exactly `B` nodes.

- 9 groups, **153,816** nodes, must be permitted → `153,816 ≤ B` → `B ≥ 153,816`.
- 10 groups, **307,928** nodes, must be refused → `307,928 > B` → `B < 307,928`.

**So the indifference band is `[153,816, 307,928)` — closed on the left, open on the right.** 153,816
is in it, because a bound of exactly 153,816 still permits the 9-group program. **307,928 is not**,
because a bound of 307,928 *permits* the 307,928-node program — the first refused size, and the one
this section records overshooting a 90 s budget to ~330 s. **153,816, 200,000 and 300,000 are the same
guard; 307,928 is a different and worse one.** The band is an octave wide and the bound sits inside it;
1.03x describes its position in the band, not a tolerance.

~~"every bound in the open interval (153,816, 307,928] accepts and refuses exactly the same programs.
200,000, 300,000 and 307,928 are the same guard."~~ — **corrected 2026-07-31, and it was the dangerous
kind of wrong.** It excluded 153,816, which belongs; it included 307,928, which does not; and it called
a half-open interval open. The bad end is the right-hand one, because this paragraph's whole conclusion
is that *moving the bound inside the band is a change with no effect* — read at 307,928 that authorised
raising the bound to the exact value that admits the hazard program. **It is the off-by-one at the
bound that the strictly-greater convention exists to make unambiguous, reappearing one level up, in the
sentence written to argue the bound has room.**

**What is genuinely thin is that no program in this family has a size anywhere in the open interval
(153,816, 307,928).** *That* interval is open at **both** ends, because a measured program sits exactly
on each, so neither endpoint is an interior gap. The band's left end is closed for a different reason
entirely — the strictly-greater comparison, not the data — which is precisely why the two intervals do
not coincide. The band `[153,816, 307,928)` therefore contains exactly one data point, its own left
endpoint, and no *bound* in it has ever been run against anything the others were not. 300,000's
placement inside it is unmeasured in *either*
direction — there is no evidence it could not be higher, and none that it is not already too high.
**That, and not 1.03x, is why it must not move without new measurement:** moving it inside the band is
a change with no effect, and moving it out of the band is a new guess about programs nobody has run. It
is a stronger statement than the ratio was.

**The two intervals are different objects that look alike, which is how the error got in.**
`[153,816, 307,928)` ranges over *bounds* and is the set that behaves identically. `(153,816, 307,928)`
ranges over *sizes* and is the set no program occupies. Same two endpoints, different brackets,
different thing being ranged over — quote the numbers without the brackets and the two collapse into
one claim that is false.

**Settle what the margin IS, so it is not re-argued.** It is a **safety margin stated against the wrong
reference point** — the single-step curve, 65.75x clear, is the reference a reader reaches for, and the
one that constrains the bound is the whole-run curve two rows below it. It is **not a capability cost**:
307,928 diverges regardless, as this section already records and §8 confirms from the generator. And it
is **not brittleness**, per the indifference band above.

**The direction of the error, stated for what was actually observed.** 300,000 is **2.05x under the
documented hang** at 616,152, and that clearance is real because 616,152 sits outside the indifference
band. Within the band: the first refused size (10 levels, 307,928) was seen overshooting a 90 s budget
to ~330 s without being observed to finish; the last permitted size (9 levels, 153,816) was seen only
to *survive a 2 GiB cgroup while stepping*, which is a memory observation and not a timing one — **it
was not observed to finish either, and nothing in this family does.** So the asymmetry the bound rests
on is between sizes observed to keep stepping under a memory cap and sizes observed to hang, not
between sizes that terminate and sizes that do not. Anyone
tempted to loosen it should note that the next level up is the documented hang, and that the
roomy-looking single-step number is measuring the wrong step.

**What would move it.** Not a bigger single-step budget — that curve is already 65.75x clear. Only the
`subst` fix (§8's first non-goal), which is what makes a *run* cost proportional to the term rather
than to the term re-copied per binder. Until then this number is the correct kind of conservative.

### What the bound means in bytes

A β-step's output is alias-free — `beta` is `shift(-1, 0, subst(...))` and `shift` rebuilds every node
it visits, so its output shares nothing with its input. **The reducer converts logical nodes into
48-byte allocations one for one.** 300,000 nodes is therefore ~14.4 MB *materialised*. Peak during
reduction is much higher, because `subst`'s per-binder re-copying (recorded in the structural-sharing
design's §10) dwarfs the result — the 616,000-node program peaked at 974 MB.

### The capability cost — FALSIFIED BY IMPLEMENTATION, see §10

~~"Programs with ~10 or more levels of nested mutual recursion are refused. Every such program observed
so far does not terminate anyway, so this converts a hang into a typed error rather than removing
working capability — a **weaker** capability cost than `MAX_LAMBDA_LOWER_DEPTH`, which genuinely refused
programs that previously lowered."~~ — **falsified 2026-07-31 by building it and running the full
suite. §10 is the record; this paragraph is the claim it kills.**

**The premise is the hidden half.** The sentence describes what the guard was *aimed* at, and then
reasons about the capability cost as if that were also what it *hits*. It is not. The guard refuses
**size**, and size is reached two ways: by sharing-induced blow-up, and by writing a large program.
`logical_size` cannot tell them apart and neither can a bound on it. The first thing this guard refused
was a **699-element list literal at a logical/physical ratio of exactly 1.000x** — no sharing anywhere,
half a million real allocations, a program that reduces normally.

**The direction of the error is the opposite of what was claimed.** The cost is **stronger** than
`MAX_LAMBDA_LOWER_DEPTH`'s, not weaker, and worse than merely stronger: it silently **overrides** that
constant, capping list literals at **541** elements where the depth guard admits **699** — a separately
designed, separately justified limit tightened by **23%** from a document that never mentions it.

**Why generous rather than tight:** the constant will be tightened for constrained targets by Plan 5's
per-target limit work, which is where a WASM stack and a browser memory budget are actually known.
Native keeps the capability; the browser build takes a smaller value through a mechanism that already
has to exist.

## 5. The error

**`LowerError::TooLarge` does not exist in the tree.** It was added, compiled cleanly with no other edit
required anywhere — the blast-radius prediction in the plan held — and was withdrawn with the rest of
Task 3 (§10). Kept because a sharing-based guard needs an error of this shape and the argument for a
separate variant does not depend on what triggers it.

```rust
LowerError::TooLarge { node: NodeId, logical: u64 }
```

Refused when `logical_size(&term) > MAX_LOGICAL_NODES` — strictly greater, so a term of exactly
300,000 nodes lowers. That matches `MAX_LAMBDA_LOWER_DEPTH`'s existing convention, whose tests read
`at_bound = deep_list(MAX - 1) // depth == MAX` and `past_bound = deep_list(MAX) // depth == MAX + 1`.
`logical` carries the saturating measurement from §2, so a consumer formatting it must handle
`u64::MAX` as "at least this".

A new variant, not a reuse of `TooDeep`. The project already draws this line: `TmRun::TooLarge`'s doc
records that a refused program "never took a step, so it must not come back as `Ran` … or as `HitCap`
(which claims a run started and then hit a resource cap mid-flight)." The same argument applies here.
`TooDeep` tells a user their program nests too deeply; `TooLarge` tells them it lowers to a term too
big to reduce. Different causes, different fixes.

**`node` is the root `NodeId`, not the offending `LetRecGroup`, and that is a known weakness.** The fold
runs on the λ term; mapping a term position back to Core needs the source map, which `lower_mapped`
has and `lower` does not. `logical` is the compensation — the diagnostic can report how big the term
was, which is the actionable part, since the user's fix is "nest less" and does not need a precise
node. Recorded rather than hidden: if a consumer later needs the precise group, the cost is threading
origin information through the fold.

## 6. Testing

- **`at_bound` / `past_bound` pair**, mirroring `MAX_LAMBDA_LOWER_DEPTH`'s existing tests in
  `lambda/lower.rs` — a program at the bound lowers, one past it answers `TooLarge`.
- **Corpus non-regression:** all 46 `FIRST_ORDER_DEMOS` programs still lower. ~~"The largest is 2,007
  logical, 150x under."~~ — **the largest is 2,173, 138x under** (§4, measured 2026-07-31). **And this
  bullet was the wrong non-regression test.** All 46 do still lower with the guard in place — that was
  run and it passed. What broke is a program the corpus does not contain: `lambda/lower.rs`'s own
  699-element list literal. **A corpus non-regression check over 46 programs whose largest list literal
  is `[1, 2, 3]` cannot see a capability cost that begins at a 542-element list**, which is §10.
- **The repro is refused**, as a committed test built from the nesting family already in
  `blowup_probe.rs`.
- **`logical_size` is exact:** an `App(c, c)` chain of depth n has exactly 2^(n+1)−1 logical nodes,
  checkable by hand at small n.
- **The memoization works — the one that matters.** The fold must *complete*, quickly, on a term whose
  logical size is 2^72. `blowup_probe.rs` already builds these. This is the difference between
  O(physical) and the hang the guard exists to prevent, and a fold that quietly walked logically would
  pass every other test here.

  **"2^72" is the deleted `f64` fold's figure; the probe's transcript no longer shows it.**
  `logical_size` is `u64` and saturates, so that term now prints as `>=2^64 (SATURATED)` (§4's 64-level
  row, and `fmt_count`). It is the same term — 9,541 allocations from 3,215 bytes of source — and the
  test's point is unchanged, since a fold that walked logically would not finish at 2^64 either. Read
  2^72 as the size the term denotes, not as a figure still printed anywhere.
- **No printed byte moves;** every existing golden, oracle, round-trip and fixture passes unedited.

## 7. Plan notes

One task beyond the guard itself: **measure the β-step cost curve** (§4) at several points on the
nesting family, under `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0`, ramping
upward with a per-point budget and never calling `reduce_trace`. That instrument exists —
`blowup_probe.rs` — and its module doc carries the safety rules. Confirm 300,000 has real margin, or
move it.

**Done 2026-07-31.** The curve is `--beta-curve` in `blowup_probe.rs`; §4 records what it shows and why
the number it produces is not the bound. 300,000 is confirmed and unchanged. The probe's private
logical-size fold was deleted in the same pass in favour of `lambda::term::logical_size`, cross-checked
against its own committed figures (§4's table, rows 1–23 unchanged to the digit).

## 8. Non-goals

- **Not the `subst` fix.** Recorded separately in the structural-sharing design's §10; it is a
  performance change and this is a robustness one.
- **Not `lower_group`'s duplication.** Binding `group` once was measured *not* to close the blow-up —
  it moves the same expansion to reduction time under call-by-name — and it moves every pinned step
  count and `Origins` path. See §10 option (b) of the structural-sharing design.
- **Not target-aware limits.** Nine stack-calibrated depth constants across eight files, needing a
  WASM build to calibrate against. Plan 5's first task.
- **Not non-progress detection.** Recorded under Plan 5 in the roadmap; it is a renderer diagnostic and
  cannot help here anyway, for the reason in §1.
- **Not the TM path — verified 2026-07-31, no longer asserted.** Two halves, both checked.

  *Structure.* `asm::Instr` is a flat enum over `Reg` / `u64` / `String` with no self-reference,
  `asm::Program` is a `Vec<Instr>` plus a label table, and `core::Core` on the way in is `Box`-owned.
  Nothing on the path holds an `Rc`, so a program's physical size **is** its logical size and there is
  no divergence for a ratio to measure.

  *Behaviour*, because the structural argument only rules out the λ path's specific failure and not an
  exponential instruction stream. The same nesting family through `lower_asm` / `defunc` / `run_tm`
  (`blowup_probe.rs --tm`, `Unary`, default caps):

  | levels | source | `code` | labels | slots | `run_tm` |
  | --- | --- | --- | --- | --- | --- |
  | 1 | 47 B | 18 | 3 | 6 | `HitCap`, 0.070 s |
  | 4 | 185 B | 69 | 12 | 7 | `HitCap`, 0.070 s |
  | 8 | 369 B | 137 | 24 | 7 | `HitCap`, 0.071 s |
  | 12 | 563 B | 205 | 36 | 7 | `HitCap`, 0.072 s |

  **The family is linear here** — ~17 instructions per level against the λ side's doubling, and `slots`
  is flat at 6–7, four orders under `MAX_SLOTS` = 100,000. `lower_asm` succeeds directly at every
  level, so `defunc` is never reached and `MAX_DEFUNC_DEPTH` is not what bounds this; neither is
  `MAX_LOWER_DEPTH`, `MAX_SLOTS`, nor `TmRun::TooLarge`. **What bounds it is `TmCaps::steps`**, reported
  as `HitCap` in ~70 ms — and this family is genuinely non-terminating (`f0` calls `g0` calls `f0`), so
  `HitCap` is the right answer rather than a shortfall.

  **That last attribution was measured on 2026-07-31, because the table above cannot support it.**
  `TmStatus` has two variants and `HitCap` is returned for the step cap and the live-cell cap alike —
  `trace.rs:112` calls them "genuinely interchangeable" — and the probe prints the classified outcome,
  so `HitCap` at ~70 ms is equally consistent with 5,000,000 steps (14 ns each) and with 5,000,000 live
  cells. `--tm`'s `WHICH CAP` block raises one cap at a time and separates them, at 8 levels:

  | caps | outcome |
  | --- | --- |
  | 5,000,000 steps / 500,000,000 cells | `HitCap`, **0.070 s** — unchanged from the default |
  | 500,000,000 steps / 5,000,000 cells | `HitCap`, **≥3.7 s** — an order of magnitude later |

  5,000,000 steps cannot touch 500,000,000 cells, so the first row's `HitCap` is the **step cap**, and
  it is the same 0.070 s the default run reports. The second row shows the cell cap is not what ends
  the default run: with the step cap out of the way it keeps going far longer. Which cap ended *that*
  run is not distinguished and does not need to be — the two walls are an order of magnitude apart, so
  this is not a knife edge.

  **Why 5,000,000 steps cannot touch 500,000,000 cells**, since that is what makes the first row a step
  cap and the mechanism was left implicit. One step applies one rule; `sim::apply` writes and moves
  *every* tape once, and `Tape::step` extends a tape by at most one cell — a move onto an empty side
  materializes one `BLANK`. The machine has `build::TAPES` = 5 tapes, and the cap is on the **sum**
  across tapes (`trace.rs`'s `self.tapes.iter().map(Tape::cells).sum()`), not per tape — which is the
  version that has to be argued, since a per-tape argument would be 5x weaker than the cap it defends.
  Total live cells therefore grow by at most 5 per step, so 5,000,000 steps reach at most ~25,000,000:
  **20x under 500,000,000.** Nothing changes, and 20x is real headroom, but it is a finite number and
  belongs on the page.

  **The timings do not reproduce; only the separation does.** 3.77 s was one run. Seven runs on
  2026-07-31 on a 32-core box under background load gave 3.73 / 3.73 / 4.57 / 7.66 / 7.69 / 10.62 /
  10.74 s for the raised-step-cap row, against 0.067–0.52 s for the default row *in the same run* — a
  ratio anywhere between 15x and 114x. The tight 3.73 s cluster is the quiet-box figure, and its paired
  default row is at its own 0.070 s floor, so **read 3.77 s as a floor on that row, not as its value**;
  the "54x" it was quoted with is one pairing of two noisy numbers. §4 already says the same of the
  β-curve's wall-clock. Nothing here leans on the ratio — the attribution needs only that the
  raised-step-cap run runs far longer than the default, which all seven runs show.

  Neither variant lifts a cap to `u64::MAX`: this family does not halt, so a run with no step cap
  returns only if the tape **reaches the 5,000,000-cell cap**. That is a finite target rather than
  unbounded growth — the condition stated here used to be the stronger one — but it is still a
  proposition about this family's tape behaviour that nothing has established, so the reason for not
  lifting the cap is unchanged. Raising 100x keeps both variants terminating by construction.

  **Why the step cap works there and not here** is §1's argument read backwards, and is the useful part
  of this check: a TM transition is O(1), so a cap counted *between* steps bites within one step of
  overshoot. A β-step is unbounded and uninterruptible, which is why `MAX_REDUCTION_STEPS` is never
  even consulted. Same mechanism, opposite outcome, because the unit being counted is bounded on one
  side and not on the other. **No analogous hazard, and no follow-up slice needed.**

## 9. Open questions

- ~~**Whether 300,000 survives §7's measurement.**~~ **Answered 2026-07-31: it does, unchanged.** See
  §4. ~~"The bound sits 1.03x under the largest size that completes at all."~~ **Nothing in this family
  completes at all**, so that phrasing was not merely unsupported — it described something impossible.
  The generator settles it — though **not with the line this bullet first cited.** "`g0(1)` calls
  `f0(1)`, whose body is `1 + g0(1)`" is `nested_groups_src(0)`: the 47-byte **one-group** program, not
  either of the sizes under discussion. At 9 and 10 groups `f0`'s body is the nested block whose value
  is `g1(n) + g0(n)`. The conclusion survives and is better argued structurally than per size:
  `nested_groups_src` emits `fn g{k}(n) { f{k}(n) }` at every level and every `f{k}` body ends in
  `+ g{k}(n)`, so `g{k} → f{k} → g{k}` closes with no base case **at every group count**, the 47-byte
  program included. §4 records 307,928 as observed "without being observed to finish" and §8 calls the
  family "genuinely non-terminating"; this bullet contradicted both. What 307,928 is, is **the largest
  size observed still *stepping* under a 2 GiB cap**. And what the measurement actually showed about the
  margin is in §4: no program in this family has a size anywhere in the **open** interval
  (153,816, 307,928) — 307,928 is itself a data point, which is why that interval is open at the right
  and why the indifference band of admissible bounds is the half-open `[153,816, 307,928)` — so the
  bound's placement inside that band is unmeasured in either direction. The open question that replaces
  this one is unchanged — whether the `subst` fix should precede any attempt to loosen it.
- **Whether any consumer will want the precise offending `LetRecGroup`** rather than the root id (§5).
  Nothing does today.
- **Whether `parse_lambda` needs the same guard.** It builds fresh nodes with no sharing, so logical
  size equals physical size and is already bounded by input length and `MAX_PARSE_DEPTH` — but that was
  argued, not tested, and a test would be cheap. **§10 makes this bullet's own reasoning suspect:** "no
  sharing, so logical equals physical" is exactly the property that makes a term *safe* from the hazard,
  and this document used it here as a reason a guard is unnecessary while §3 placed a guard that ignores
  it. Both readings cannot be right.
- **Every question a sharing-based guard raises, none of them answered.** Whether the ratio can be
  computed as cheaply as `logical_size` is; what threshold separates the corpus's measured 1.00x–2.89x
  from the hazard's 375x; whether a ratio guard has its own false positives. §10's last subsection.

## 10. Implemented, then falsified: the guard refuses working programs (2026-07-31)

**Task 3 built this guard exactly as §3 and §5 specify — the constant, the `TooLarge` variant, the call
at the tail of `lower_mapped` — ran the full suite, and the work was abandoned before commit.** It is
not in the tree. The two other tasks landed and are unaffected. What follows is the measurement that
stopped it and the decision taken from it.

### The regression

`lambda/lower.rs`'s `the_guard_admits_a_core_at_the_bound_and_refuses_only_past_it` is **pre-existing**
— part of `MAX_LAMBDA_LOWER_DEPTH`'s own suite, written for the depth guard, green before this change.
It builds `deep_list(MAX_LAMBDA_LOWER_DEPTH - 1)`, a **699-element list literal** chosen only to sit
exactly at the *depth* bound, and asserts it lowers. With the size guard in place it does not: `lower`
answers `TooLarge`.

Measured 2026-07-31, `[0, 1, … n−1]` through `parse` → `desugar` → `lower` → `logical_size`, under
`systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0`:

| n | source | physical | logical | ratio |
| --- | --- | --- | --- | --- |
| 100 | 390 B | 11,303 | 11,303 | 1.000x |
| 300 | 1,390 B | 93,903 | 93,903 | 1.000x |
| 500 | 2,390 B | 256,503 | 256,503 | 1.000x |
| **541** | 2,595 B | **299,717** | **299,717** | 1.000x |
| **542** | 2,600 B | **300,813** | **300,813** | 1.000x |
| 699 | 3,385 B | 497,691 | 497,691 | 1.000x |

**The ratio is exactly 1.000x at every size measured, and that is the finding.** Physical equals
logical: a list literal shares nothing, so `deep_list(699)` is 497,691 *real* `Rc` allocations, not a
small term denoting a large one. It is not the structural-sharing hazard. It is a big program, and it
reduces normally.

### Exactly which claim this falsifies

**§4's capability section**, quoted and struck through there: "every such program observed so far does
not terminate anyway, so this converts a hang into a typed error rather than removing working
capability". **False for this program.** It terminates, it was working, and the guard removes it.

The sentence's error is a hidden premise — that what the guard refuses is the nesting family. The guard
refuses *size*. Size is reached by sharing-induced blow-up **and** by writing a large program, and
`logical_size` returns one number for both. **A bound on it cannot distinguish the hazard from the
capability**, which is a property of the design, not of Task 3's implementation of it.

**The calibration could not have caught this, and that is the second half of the finding.** §4's
headroom figure was read off a six-program list whose largest list literal is `[1, 2, 3]`; the real
46-program corpus's largest is also `[1, 2, 3]`, at 57 logical nodes. **List literals were never in the
measurement.** The bound was defended against the family it was aimed at, on a corpus that contains
nothing of the shape it broke.

### What it costs, quantified

`deep_list(n)`'s logical size is **quadratic**, not linear — element k is a numeral costing ~2k nodes —
and fits `n² + 13n + 3` against every row above (n=100 → 11,303; n=300 → 93,903; n=699 → 497,691). So a
300,000-node bound caps list literals at **541 elements**: 541 measures 299,717 and lowers, 542 measures
300,813 and is refused. `MAX_LAMBDA_LOWER_DEPTH` caps them at **699**. The size guard tightens an
existing, separately justified limit by **23%**, from a constant that never mentions it and in a
document that never mentions that constant.

**Do not read the average as a rate.** 712 is 497,691 / 699 — the average cost per element **at
n = 699**, and because the total is quadratic that average is itself a function of n: at n = 541 it is
299,717 / 541 = 554. Dividing 300,000 by the wrong-size average gives **421**, understating the cap by
120 elements. The measured crossing is **541**. Recorded because the same shape of arithmetic —
carrying a rate measured at one size across to another — is exactly what §4's calibration-error section
is already about.

### The redirect: guard on sharing, not on size

**Decided by the human, 2026-07-31.** The hazard is sharing-induced blow-up. A ratio-1.000x term of half
a million nodes is a working program and refusing it buys nothing. A guard keyed on the
logical/physical **ratio** — or on size only when the ratio is high — targets the actual failure, and
would have admitted `deep_list(699)` untouched while still refusing the 512-byte program at 375x.

**That is a direction, not a design, and nothing here should be read as one.** Open, all of it:

- **Is the ratio cheap?** `logical_size` is a memoized fold, O(physical). Physical size needs its own
  pass; the only one in the tree is `blowup_probe.rs`'s `HashSet` walk, which is O(physical) too but
  allocates a set the size of the term. Whether the two can share one traversal is unexamined.
- **What threshold?** The corpus measures 1.00x–2.89x (§4). The hazard measures 375x at 512 bytes. That
  is a wide gap and it is also two data points and a corpus, which is how 300,000 was chosen.
- **What are its false positives?** A small term with high sharing that reduces fine is the exact mirror
  of what killed this design, and nobody has looked for one. Note from §4's own table that the ratio is
  already **114x at 9 nesting levels** (1,346 physical, 153,816 logical) — a size *this* design permits —
  against **375x at 11** (1,644 physical, 616,152 logical, the hang). A ratio guard has to separate
  those two, and they are a factor of 3.3 apart where the sizes are a factor of 4.

**It is a new slice with its own design**, and the numbers above are its inputs, not its conclusions.

### ~~The hang is still open~~ ~~— CLOSED 2026-07-31~~ ~~— THE HANG IS OPEN (2026-08-01)~~ — CLOSED 2026-08-01, AT THE ROOT

"512 bytes of ordinary surface syntax still lower to 616,152 logical nodes and still reach a β-step that
does not finish. **Nothing in the tree refuses it.**" — struck through on 2026-07-31, **restored on
2026-08-01** when the guard was reverted, and **struck for good later the same day**. Nothing in the
tree refuses it and nothing needs to: `shift` and `depth_exceeds` were fixed, the 616,152 logical nodes
are unchanged, and the program reduces in **7.48 s**. The heading's four states are left visible because
the oscillation is the point — three of them were written by someone certain. Successor
design: [`2026-07-31-lambda-shared-subterm-guard-design.md`](2026-07-31-lambda-shared-subterm-guard-design.md),
whose §10 is the falsification. `lower` and `lower_mapped` refused a term whose largest SHARED subterm
exceeded **`MAX_SHARED_LOGICAL_NODES = 10_000`** with `LowerError::TooShared` (`1652e09`) for one day;
the constant and the variant were then removed. What stays is the measurement,
`lambda::term::max_shared_logical_size` (`b832c89`), which is sound and is what the investigation ran.
**The nesting family lowers at every level again, and the 512-byte program hangs.** *(That last clause
held for part of one day. Since 2026-08-01 it reduces in 7.48 s — see the banner at the top.)*

**§1's argument for guarding at lowering time was taken by the successor and is now the thing that
failed.** The successor guarded in exactly that place, at the tail of `lower_mapped`, and the quantity it
read — the largest *shared* subterm — turned out to **collapse to zero within two β-steps of the moment
it is read**, so a once-at-lowering check reads a property at its single maximum and the cost it is meant
to bound keeps climbing afterwards. Lowering time is where *sharing* is knowable; it is not where a
step's cost is knowable. The design after next moves the check into `LambdaCursor::next`, before each
step. This document remains the record of a design that was built and withdrawn; what is no longer true
is that the problem was left unhandled **or that its successor handled it**. The two open questions above
— what threshold, and what are its false positives — were carried into the successor's §9, and its §10
answers the second one: the false negatives were what mattered.

### Four stale references left standing in code, named rather than fixed

Per the roadmap's own rule — grep the tree, do not fix only the document that stated it first — these
were found and are **deliberately not edited**, because this correction is documentation-only and every
one of them is a source file:

`crates/redextape-core/examples/blowup_probe.rs` names `MAX_LOGICAL_NODES` in three doc comments
(lines 678, 697, 707) and **prints it** at line 740 — `"choose MAX_LOGICAL_NODES with margin BELOW that
figure."` The constant does not exist in the tree and, on this design's evidence, should not. The
printed one is the copy that matters: it is a legend a user reads, telling them to calibrate a guard
that was withdrawn. **Fix it in the sharing-guard slice, with whatever that guard's constant turns out
to be** — a documentation pass that renamed it now would be inventing the successor's name before the
successor is designed.

**Still open after the sharing-guard slice landed (`b832c89`, `1652e09`) — named a second time rather
than fixed.** The successor's name is now known (`MAX_SHARED_LOGICAL_NODES` = 10,000), so the reason
the first attempt gave for deferring no longer applies; what applies instead is that the slice's
closing commit is documentation-and-example only by construction, the same reason this subsection gives
above. All four sites are unchanged, and line 740 still prints a legend naming a constant the tree does
not contain.

**CLOSED 2026-07-31, before the branch was reviewed; re-swept 2026-08-01 when the successor was
reverted.** All four sites say what the figure was about — the sizing evidence for the *withdrawn*
total-size guard — and that the constant it names is not in the tree. The printed legend no longer
advises setting anything; it names `MAX_LOGICAL_NODES` = 300,000 as withdrawn and
`MAX_SHARED_LOGICAL_NODES` = 10,000 as **landed and then reverted**, keyed on a **different quantity**
that this one-step curve does not calibrate either. **The figures were not re-pointed at the new
constant** — 19,726,040 / 300,000 = 65.75 is arithmetic about a bound that no longer exists, and
dividing that wall by 10,000 would be a third base and a meaningless one. Two further sites turned up
that this subsection's count of four missed, as the roadmap's lesson predicts a fix's own count will:
`lambda/reduce.rs`'s `depth_exceeds` doc called 300,000 "the bound the guard's design settles on" in the
present tense, and `blowup_probe.rs`'s module doc still described the nesting family as one that lowers
— ~~"`lower` has refused it at seven groups since `1652e09`, so every λ-side section that ramps it now
stops there."~~ — **true for one day only; corrected 2026-08-01.** The guard was reverted, `lower`
refuses the family at no level, and every λ-side ramp reaches its full range again;
`blowup_probe.rs`'s module doc has been corrected back accordingly and now says so directly. **The
sentence that was written to fix a stale claim became a stale claim itself within a day** — which is
the roadmap's standing lesson arriving one level up, in the correction rather than in the thing
corrected.
