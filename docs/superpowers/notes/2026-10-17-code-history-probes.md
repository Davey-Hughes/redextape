# Code history moved out of comments

Text moved verbatim out of code comments when they were trimmed to their why. Each entry names the file and the line of code the comment sat above.

## `crates/redextape-core/examples/concurrency_probe.rs`, above `const FIRST_ORDER_DEMOS: &[&str] = &[`

That test was extended from five to six when this file landed (and from six to seven for
`examples/state_cost_probe.rs`'s copy, added later), which is the protocol its own doc comment
specifies: the enumeration method is `grep -rn FIRST_ORDER_DEMOS` over the whole tree, and the count
has been wrong more than once by being maintained from memory instead.

## `crates/redextape-core/examples/guard_hole_probe.rs`, above `fn nested_groups_src(m: u32) -> String {`

`m+1` nested groups of two mutually recursive functions — the family whose `max_shared` sets the
reverted guard's bound (9,453 at 6 groups; `lower` admits every level again). COPIED from
`list_reduction_probe.rs`, which copied it from `blowup_probe.rs` (not `pub` in either).

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `const FIRST_ORDER_DEMOS: &[&str] = &[`

Verbatim copy of `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS` (comments stripped).

THIS COPY IS COVERED, and was not until the whole-branch review found it. `three_way_oracle.rs`'s
`first_order_demos_stay_synced_across_all_seven_copies` reads this file as text and asserts its
literals are byte-for-byte equal to the canonical array's. It was the FIFTH copy and the last one
found: that test had just been extended from three to four, by a fix that enumerated the damage and
missed this file. Nothing here needs a by-hand diff before it is trusted.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `fn physical(t: &LambdaTerm) -> usize {`

Distinct `Rc` allocations reachable from `t`. Copied from `blowup_probe.rs::physical` (not `pub`
there, so not importable) — the standard O(one-visit-per-allocation) walk over the DAG.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `fn depth(t: &LambdaTerm) -> u32 {`

Maximum nesting depth, memoized over the DAG — copied from `blowup_probe.rs::depth` (not `pub`
there either). This is the quantity `MAX_TERM_DEPTH` (reduce.rs, 3,000) bounds; added after Q2's
ramp showed `HitCap` appear at n=800 with fewer steps than a full normalization needs, which is
`LambdaCursor`'s depth guard firing mid-run, not the step cap.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `const FIRST_ORDER_DEMOS: &[&str] = &[`

Verbatim copy of `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS`, itself copied into
`examples/step_survey.rs` and `redextape-native/tests/native_oracle.rs` — copied from
`step_survey.rs`'s verified-synced copy rather than retyped from the canonical file, so this is a
copy of a copy known equal to the canonical, not a fresh transcription.

THIS COPY IS COVERED, and was not when it was committed. `three_way_oracle.rs`'s
`first_order_demos_stay_synced_across_all_seven_copies` reads this file as text and asserts its
literals are byte-for-byte equal to the canonical array's; the test previously covered three copies
and this comment claimed it covered this one. The claim was made true rather than softened — the
check is textual and path-based, so a probe that CI never runs is as checkable as a test target.
Nothing here needs a by-hand diff before it is trusted.

FIVE, NOT FOUR: extending that test to cover this file left `examples/lambda_sharing_probe.rs`'s
copy still uncovered, found by the whole-branch review. See the test's own doc for the count.

## `crates/redextape-core/examples/state_cost_probe.rs`, above `const FIRST_ORDER_DEMOS: &[&str] = &[`

Verbatim copy of `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS` — THAT array is the canonical one
this copy is checked against, not `crates/redextape-native/tests/native_oracle.rs`, which carries
the same array but is just another row in `three_way_oracle.rs`'s own `copies` table (true of this
file's copy only by transitivity, through the shared canonical). `redextape-core` cannot depend on
`redextape-native` — the dependency runs the other way — so this is a copy, not an import.

THIS COPY IS COVERED. `three_way_oracle.rs`'s `first_order_demos_stay_synced_across_all_seven_copies`
reads this file as text and asserts this array's literals are byte-for-byte equal to the canonical
one's — the same protocol every other copy uses (see that test's own doc for why a `read_to_string`
check needs no import). THIS WAS NOT ALWAYS TRUE: this array shipped in this same branch as a
`part_g` local named `demos`, which neither the sync test nor a `grep -rn FIRST_ORDER_DEMOS` audit
could find — see that test's doc for the fix. Nothing here needs a by-hand diff before it is
trusted; if `FIRST_ORDER_DEMOS` gains an entry, re-copy it here and re-run this probe, and the sync
test's own count (`copies.len() + 1`) is what catches a copy dropped instead of updated.

## `crates/redextape-core/examples/frame_cost_probe.rs`, above `const WEB_BYTE_BUDGET: usize = 65_536;`

`link_index_probe.rs`
cites the SAME constant one line the other way, for the mirror-image reason — see its
`WEB_BYTE_BUDGET`.

## `crates/redextape-core/examples/inherit_probe.rs`, above `fn programs() -> Vec<(&'static str, &'static str)> {`

The four programs, **copied VERBATIM from `none_probe.rs`'s `programs()`** so the source strings
cannot drift between the two probes and every row here is comparable to a row already recorded.
`none_probe` copied them from `owner_probe` for the same reason. Examples are separate crates and
cannot share a helper; verbatim duplication with this note is the convention in this tree.

## `crates/redextape-core/examples/inherit_probe.rs`, above `fn count_tagged_apps(t: &LambdaTerm) -> u64 {`

Number of DISTINCT allocations reachable from `t` that are a tagged `App`. **Copied verbatim from
`none_probe.rs`** — see `programs()` for why duplication rather than sharing.

**Physical, not logical** — deduped by `alloc_id` over an explicit worklist, the same convention
`term.rs`'s `max_shared_logical_size` uses: under structural sharing a term can denote an
astronomical logical tree from a small number of allocations, so a walk that revisits shared
subterms would be a hang, not a measurement. Iterative over an explicit stack, never recursive.

## `crates/redextape-core/examples/inherit_probe.rs`, above `fn percentile(xs: &[f64], q: f64) -> Option<f64> {`

Same
convention as `owner_probe.rs`'s pair of the same name, so the two probes' medians mean the same
thing and are comparable.

## `crates/redextape-core/examples/link_index_probe.rs`, above `const WEB_BYTE_BUDGET: usize = 65_536;`

`protocol.ts`'s `LAMBDA_BYTE_BUDGET` — the budget the app passes `linkIndex`.

THAT POINTER READ `protocol.ts` line 9 UNTIL THIS COMMIT, AND IT WAS NEVER RIGHT — invalidated by
its own commit, which is the mechanism this slice exists to retire caught in the act. Line 9 held
that constant in the PARENT of the commit that wrote this doc, static click-linking (#23); that
same commit added a `LinkIndexWire` import at the top of `protocol.ts` and pushed the constant one
line down, so what landed was a pointer at the ` */` closing the constant's own doc block. It has
not moved since, so the pointer has been one line short for its whole life. `frame_cost_probe.rs`
cites the SAME constant one line the other way, for the mirror-image reason — its `#17` commit
lifted the constant while this one lowered it, and each probe recorded the position its own commit
had just destroyed. See that file's `WEB_BYTE_BUDGET`.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `fn lower_src(src: &str) -> Option<LambdaTerm> {`

`None` when `lower` REFUSES the program, printing the error rather than aborting the process — the
same shape as `blowup_probe.rs::lower_src`, and for the same reason. While `1652e09`'s shared-subterm
guard was in the tree this file's own nesting family was refused from seven groups on, and a `panic!`
here made the documented no-argument invocation die at `q3` before `corpus` or `family` ever ran.
That guard has been reverted and nothing refuses these programs today, but the shape stays: a ramp
that reports a refusal still reports every level below it, and a ramp that panics reports nothing
after it.

## `crates/redextape-core/examples/step_survey.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

It said "four" until the whole-branch review found the fifth;

## `crates/redextape-core/examples/blowup_probe.rs`, above `Err(e @ LowerError::Unsupported { .. }) => match defunc(&core).and_then(|d| lower_asm(&d))`

THE CATCH-ALL THIS REPLACED DID NOT REPRODUCE IT. `Err(e) =>` fell into `defunc` on
`TooDeep` as well, which `lower_program` returns IMMEDIATELY from its
`LowerError::TooDeep` arm (`tm.rs`) — so on a `TooDeep` program this line would have
printed a `defunc` path `run_tm` never took. Unreachable at these levels, since `lower_asm`
succeeds directly at every one; corrected in the code rather than in the comment because
the comment's claim is the one worth keeping, and a hazard demonstrator's transcript must
not be able to say something false.

## `crates/redextape-core/examples/blowup_probe.rs`, above `fn tm_check() {`

MEASURED 2026-07-31: **the family is LINEAR on this side.** `lower_asm` succeeds directly at every
level (`defunc` is never reached, so `MAX_DEFUNC_DEPTH` is not what bounds this), emitting 18 / 69 /
137 / 205 instructions at 1 / 4 / 8 / 12 levels — ~17 per level against the λ side's doubling — with
3 labels per level and `slots` FLAT at 6-7, four orders under `MAX_SLOTS`. No refusal fires: not
`MAX_SLOTS`, not `TmRun::TooLarge`, not either 580-deep bound. What bounds it is `TmCaps::steps`,
reported as `HitCap` after ~70 ms, and this family is genuinely non-terminating (`f0` calls `g0`
calls `f0`), so `HitCap` is the correct answer rather than a shortfall.

THAT ATTRIBUTION IS MEASURED, NOT INFERRED, and it could not have been inferred from the rows
above: `HitCap` is returned for the step cap and the live-cell cap alike, and at 14 ns/step the
cell cap was every bit as plausible. The `WHICH CAP` block below raises one cap at a time. Measured
2026-07-31 at 8 levels: cells raised to 500,000,000 still caps in **0.070 s**, unchanged from the
default, so that is the STEP cap. Steps raised to 500,000,000 with cells left at 5,000,000 caps
only after **3.7 s or more**, an order of magnitude later, so the cell cap is not what ends the
default run. Which of the two ended the raised-step-cap run is not distinguished and does not need
to be; the two walls are that far apart, so the attribution is not a knife edge.

THE TIMINGS DO NOT REPRODUCE, ONLY THE SEPARATION DOES. Seven runs on 2026-07-31 on a 32-core box
under background load gave 3.73 / 3.73 / 4.57 / 7.66 / 7.69 / 10.62 / 10.74 s for the
raised-step-cap row, against 0.067–0.52 s for the default row in the same run — a ratio anywhere
from 15x to 114x. The tight cluster at 3.73 s is what a quiet box gives, and the paired default row
is at its own 0.070 s floor there, so **3.77 s is best read as a FLOOR on that row rather than as
its value.** Nothing here leans on the ratio: the attribution needs only that the raised-step-cap
run is far longer than the default, which every one of the seven runs shows.

## `crates/redextape-core/examples/blowup_probe.rs`, above `fn beta_curve() {`

The number this exists to produce is THE LOGICAL SIZE AT WHICH ONE β-STEP STOPS BEING TOLERABLE.
It was produced FOR THE WITHDRAWN TOTAL-SIZE GUARD, whose `MAX_LOGICAL_NODES` = 300,000 was to be
chosen with real margin under it rather than 2x under a single observed hang. **That constant was
withdrawn and is not in the tree.** Its successor, `MAX_SHARED_LOGICAL_NODES` = 10,000 on the largest
SHARED subterm, landed and was then **reverted after measurement falsified it** — a different
quantity again, which this curve also does not measure and could not have calibrated. **THE TREE NOW
ENFORCES NO BOUND OF EITHER KIND.** Every figure below is kept as the record of what a one-step curve
does and does not establish; none of it is a margin against anything.

WHAT THE LAST COLUMN ACTUALLY TIMES is one CURSOR step, not one β-step alone. `LambdaCursor::next`
ran `depth_exceeds` over the full logical tree before every step (`trace.rs`) and did not
short-circuit at these depths — 141 against `MAX_TERM_DEPTH` = 3,000 — so every row was the depth
guard PLUS a β-step, and each row was an UPPER BOUND on its β-step rather than that step's cost.

**ALL OF THAT IS PRE-2026-08-01. `depth_exceeds` IS NOW O(1)** — `LambdaTerm` carries `depth` as a
construction-time invariant, so the guard is a `u32` comparison and contributes nothing measurable.
Each row is now the β-step alone rather than an upper bound on it. **Re-run before quoting any
timing here.**

THE DERIVATION THIS REPLACES, kept because it is the arithmetic someone will want if they re-derive
the split. The guard's share was put at ~2%, DERIVED rather than measured, from `reduce.rs`'s
Θ(logical) rate of ~1.4 ns/node: at 616,152 nodes that is ~0.9 ms against a 50 ms row, and the same
~2% came out at every other row (0.4 ms / 22 ms at 307,928; 14 ms / 847 ms at 9,862,872).

**AND ~2% WAS WRONG BY A FACTOR OF ~48 FOR THE RUN AS A WHOLE, which is the lesson.** It is right
for ONE step on the terms this section builds, and the section only ever times one step. Measured
across a full reduction of the same family, `depth_exceeds` was **96%** of the time (187.6 s of
195.7 s at eleven levels) — because the guard is Θ(logical) per step while a single early step is
cheap, so a per-step share says nothing about the run. That is the same error as sizing a guard from
a one-step curve, recorded two paragraphs down.

MEASURED 2026-07-31, under `MemoryMax=2G MemorySwapMax=0`: the 10 s budget is never reached. One
cursor step is 0.022 s at 307,928 logical nodes, 0.847 s at 9,862,872, and at 19,726,040 (16
levels) the process is OOM-KILLED inside that one step. **The wall this measurement finds is
memory, not time**, and it is 65.75x above the withdrawn total-size guard's `MAX_LOGICAL_NODES` =
300,000 (19,726,040 / 300,000) — arithmetic about a bound that no longer exists, kept because the
paragraph below is about what that ratio does NOT mean.

**DO NOT READ THAT AS 65.75x OF MARGIN, AND THIS IS THE WHOLE TRAP.** This section times the FIRST
step, whose cost is set by the term `lower` handed over. The hang a guard would exist to prevent is a
LATER step, whose cost is set by what earlier steps have already materialized: a step's output can
be |body| x |arg|, and the next step starts from that output. `part_oom` reduces rather than
single-steps, and it hangs at 616,152 — a size this section clears in 50 ms. So a bound derived
from this curve alone would be **32x too loose against the size that actually hangs**
(19,726,040 / 616,152 = 32.0), in exactly the way §4 of the design records the first attempt being
wrong: a growth number transferred from the wrong base. The 65.75x above is the same wall measured
against that withdrawn 300,000-node total-size bound instead; both are right, and the denominator
has to be said or the two read as a disagreement. Neither denominator was ever
`MAX_SHARED_LOGICAL_NODES` either: 10,000 bounded the largest shared subterm, not the whole term, so
dividing this wall by it would have been a third base and a meaningless one — and that bound has
since been reverted, so there is no live constant this curve is a margin against at all.

which is how the OOM-killed run above still reports 15 levels.

## `crates/redextape-core/examples/blowup_probe.rs`, above `fn part_oom() {`

MEASURED 2026-07-31: it does NOT get OOM-killed, which is what it was built expecting. Up to `m`=9
(ten nested groups, 307,928 logical) it survives a 2 GiB cgroup; at `m`=10 (eleven groups, 616,152
logical) a β-step had not returned after 13 minutes, with peak RSS at 974 MB and creeping ~1 MB per
40 s — the reducer allocates and frees gigabyte-scale terms inside one `reduce_step` rather than
accumulating toward a limit. The failure this section actually finds is a hang, not an allocation
failure. Stop it by hand.

THE STUCK STEP IS NOT THE FIRST. `--beta-curve` times one CURSOR step — the depth guard plus the
first β-step, so an upper bound on that β-step alone — and gets 50 ms at `m`=10's 616,152 nodes,
and 0.85 s at 9,862,872. This section is stuck because it has already
taken steps, each of which materializes what the last one denoted.

NOTHING IN-PROCESS COULD BOUND THIS AS MEASURED HERE, which is why the bound was external. A β-step's
output WAS `shift(-1, 0, subst(0, shift(1, 0, arg), body))` — every occurrence of the bound variable
in `body` was replaced by `arg` and the whole result was then deep-copied by the outer `shift`, so ONE
step could produce on the order of |body| x |arg| LOGICAL nodes as real allocations. **Both the
`maxfree` short-circuit (2026-08-01) and β-fusion (2026-08-03) have since removed that outer
deep-copy — see `examples/shift_cost_probe.rs` — so this section's own hang is not expected to
reproduce.** It survives as the re-runnable source for the LOWERING figures, which are unchanged
and still reachable — the RSS and timing figures above it ARE the hang (974 MB, 13 minutes without
returning), so a section that no longer hangs cannot re-produce those. What changed is what
REDUCING one of these terms costs, which is the line this file's own header already draws.
**The "not expected" is a prediction, not a measurement** — refuting it means an unbounded reduction
run, which this repo's λ-measurement rule requires a hard cgroup cap for, and nothing here has run
one. A guard
that checked the
term's size between steps would therefore be reading a number that says nothing about what the next
step is about to allocate. `part_step`'s node ceiling is honest only because it runs at sizes where
the product is small.

So: run this under `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0`. Each `m`
prints its "before" line and flushes it BEFORE stepping, so the transcript names the size that is
stuck (or that died) whether or not the process survives to report it. The wall budget below is
checked BETWEEN steps and so overshoots badly — 90 s produced a 330 s run at `m`=9. That
overshoot is a measurement, not a bug in the harness: it is what "a step cannot be interrupted"
looks like from outside.

## `crates/redextape-core/examples/blowup_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

  * PART 1 — the hazard exists at all. `c = app(c.clone(), c)`, n times: n+1 allocations,
    2^(n+1)-1 logical nodes. Which consumers pay the logical number, and at which n do they cross
    a 2-second budget? ANSWER: all of them but two. `depth_exceeds` crosses at n = 30,
    `LambdaCursor::next` at n = 29, `c == d` (separately built, so `ptr_eq` cannot fire) at n = 30,
    `print_lambda` produces 2.10 MB at n = 19. The two that are immune are `c == c.clone()` (one
    pointer comparison at any n) and `drop` — n = 10,000, a term of 2^10001 logical nodes, freed in
    175 µs, which is `Drop`'s Θ(physical) claim demonstrated rather than argued.
  * PART 2 — is the shape reachable from a source program? The only path a user controls is
    parse -> desugar -> Core -> `lower` -> reduce, so this ramps a family of source programs and
    measures the ratio of the term `lower` returns. ANSWER: REACHABLE, from 512 bytes. The
    multiplier is `lower_group`'s `group.clone()` — it clones the whole group term once per member of a
    mutually recursive `fn` group — and it NESTS, because a member's body is a block that can
    declare its own group. 512 bytes lowers in ~196 µs to 1,644 allocations holding 616,152
    logical nodes (375x), and reducing that term reaches a β-step that did not finish in 13
    minutes at 974 MB. No guard fires: depth 141 against `MAX_TERM_DEPTH` = 3,000, and
    `MAX_REDUCTION_STEPS` is never consulted because control does not return from `reduce_step`.

THAT STEP IS NOT THE FIRST ONE, which this file used to say it was. `--beta-curve` (PART D)
times exactly one CURSOR step per size — `depth_exceeds` over the full logical tree, then one
β-step — and gets **50 ms** at those same 616,152 nodes, which makes 50 ms an UPPER BOUND on
that β-step rather than its cost alone; the first step is cheap at every size the family
reaches. The cost accrues ACROSS the run, because a step's output can be |body| x |arg| and the
next step starts from that. Correcting it matters because any guard sized from this curve is
sized against the wrong one otherwise — which is how the first attempt went wrong, and no
guard is in the tree to be sized today. See PART D's doc comment.

`lower` REFUSES NOTHING HERE, AND THAT SENTENCE IS A CORRECTION. Between `1652e09` and the revert
below it did: `MAX_SHARED_LOGICAL_NODES` = 10,000 on the largest SHARED subterm cut this family off
at seven groups, and every λ-side section that ramps it through `lower_src` (2c, 2d, 2e, `step`,
`oom`, `--beta-curve`) stopped there printing `lower error: TooShared { .. }`. **That guard was
falsified by measurement and reverted** — the mechanism it named is not what `subst` does, and
`let xs = [0..500); let ys = [0..500); head(xs) + head(ys)` scores 4 against its bound of 10,000 while
spending 19.0 s in one β-step (`examples/guard_hole_probe.rs`, and the design's §10). So every ramp
here runs to its own budget again, and `lower` still refuses nothing. The `--tm` section was never
affected either way — it goes through `lower_asm`, not `lower`.

**~~"the hang this probe demonstrates is open"~~ — CLOSED 2026-08-01, and this probe's own `step`
section is what identified the cause.** See the next paragraph, then `examples/shift_cost_probe.rs`.
Every LOWERING figure here is unchanged and still re-reachable: `lower` builds the same term it
always did, so PART 2's ratios, the 512-byte / 1,644-allocation / 616,152-logical row, and the
`--beta-curve` sizes all still hold. What changed is what REDUCING one costs.

WHAT THE `step` SECTION IS FOR, since it looks redundant next to `oom`. It showed that reduction
cannot COMPOUND the ratio — it MATERIALIZES it: `beta`'s closing `shift(-1, 0, ..)` rebuilt every
node it visited, so a β-step's output aliased nothing, and the within-term ratio was exactly 1.00x
after ≥6 steps from starting ratios up to 114x. The compact term was never small; it was a promise
to allocate, and the reducer kept it.

**THAT WAS THE ROOT CAUSE, RECORDED HERE AS A SYMPTOM FOR A DAY BEFORE ANYONE READ IT THAT WAY.**
"a β-step's output aliases nothing" is not a fact about β-reduction; it is a fact about a `shift`
that rebuilt unconditionally — Θ(logical) rather than Θ(physical), and sharing-destroying, since
`shift(App(c, c))` recursed twice and built two copies of `c`. `lower_group`'s duplication only
writes the promise; `shift` was what cashed it, on every step. `term.rs` now carries a `maxfree` per
handle and both `shift` and `subst` return their argument's ALLOCATION when no free index is in
range. **RE-RUN THIS SECTION: the 1.00x figure above is the pre-fix measurement and is not expected
to reproduce.** The two-list counterexample went from 19.0 s in its first β-step to 0.002 s, and the
512-byte program that did not finish one β-step in 13 minutes ran 105,607 steps in 195.7 s.

**`depth_exceeds` was then 96% of what remained** — 187.6 s of that 195.7 s — for the same reason
one function over: it walked the logical expansion, once per step. `LambdaTerm` now carries `depth`
beside `maxfree`, so that guard is a `u32` comparison. The same program is **7.48 s**, and the ramp
is FLAT at 7.5–9.0 s across all eleven levels. **`--beta-curve`'s timings are all pre-fix**; the
sizes it reports are unchanged, since `lower` builds the same term it always did.

THAT FOLD USED TO LIVE HERE, in `f64`, and was deleted when the shared `u64` one landed. Two copies
of one measurement is drift waiting to happen, and this target's committed figures — 306 / 908 /
4,520 / 76,760 / 307,928 logical at 1 / 2 / 4 / 8 / 10 nesting levels — are what cross-checked the
survivor when the local copy went. The shared fold SATURATES at `u64::MAX` where the `f64` one kept
approximating, so this family's rows past ~56 levels now read `>=2^64 (SATURATED)` rather than
`5.552e21 (2^72.2)`. That is a floor reported as a floor, not a regression: see `fmt_count`.

```
# ALLOCATOR — READ THIS BEFORE TRUSTING ANY TIMING ABOVE
```

**This target has set `mimalloc` as its global allocator since 2026-08-04. Every timing recorded
in this file above this note was measured under glibc's malloc and is NOT comparable to a run
made today.** Counts are: node counts, allocation counts and step counts are properties of the
reduction, not of the machine, and did not move. Seconds, ms and ns did.

It is here for a measured reason rather than a preference. The reducer allocates one `Rc<Node>`
per term node and frees on the same order, and glibc's layout for that pattern costs real
address-translation pressure: on the nested-group family, swapping ONLY the allocator took L1
DTLB misses from 1.20e9 to 0.92e9 for the three-pass `beta` and from 1.83e9 to 0.93e9 for the
fused one, with the wall clock following at ~9% and ~16%. That is also how the β-fusion family
regression was explained — it was glibc's layout, not the reducer's work.

## `crates/redextape-core/examples/common/tag_census.rs`, above `pub(crate) fn programs() -> Vec<(&'static str, &'static str)> {`

the pair `owner_probe.rs` measured at 397 `None` each

## `crates/redextape-core/examples/concurrency_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

```
# WHAT IT FOUND (2026-08-01, 32 logical CPUs)
```

A full δ-step is **12.99 ns**; a 5-thread barrier is **2,063 ns**, or **159x the entire step it would
be parallelizing**. Break-even for a 5-way split needs ~200x more work per step than exists, and k = 2
is no kinder (a cheaper barrier, a worse k/(k-1)). That single ratio is what rejects parallel `apply`,
and it is why a thread pool does not help: a pool removes thread *creation*, and the cost is the
*rejoin*.

The strongest form of the result is Part F. `Tape::snapshot` is the only genuinely O(cells) per-tape
operation in either interpreter — five independent tapes, real work in each, 1,011 ns/step. Split
perfectly across five threads it is **still 2.25x slower** than sequential, because the barrier is
larger than the whole traced step.

What survives is sequential, and both loops carry the same defect — recomputing per step a quantity the
previous step already knew, the class `depth_exceeds` cost 187.6 s of 195.7 s to before `depth` was
stored.

**WRITING THIS FILE CHANGED TWO CONCLUSIONS THE THROWAWAY HARNESS HAD REACHED, which is the argument
for the probe discipline rather than an accident of it.**

  1. **Part E: `Binary` is not `Unary`.** Under `Unary` the corpus confirms the single-program figure
     (mean run 38.56 vs `map`'s 37.09; 99.3% of steps in a run >= 2). Under `Binary` the mean run is
     **7.77** — five times shorter, and far more skewed (longest 1,431). A fused op costing `c`
     ordinary steps turns a run of `R` into `c`, so the win is ~`R/c`: at the pessimistic `c = 10` the
     first draft used, `Unary` gives ~3.9x and **`Binary` gives 0.78x — a LOSS**. The design's "~3.7x
     across the board" did not survive running the second encoding.
  2. **Part H: a β-step is 1,323 ns, ~102x a δ-step.** Part G's headline — **93.7% of all λ descent
     retraces the previous step's path** — is a large share of a SMALL thing: ~8.7 spine nodes against
     a 1,323 ns step. The zipper it argues for is a single-digit-percent lever, and the standing
     `subst` re-shift target (which attacks where that 1,323 ns lives) should land first.

Part G's negative result did survive the corpus, and is stated with more confidence than the positive
one it contrasts with: same-redex-path runs average **1.22** against the TM's 38.56, and consecutive
root redexes are 1.3%, so there is nothing to fuse in λ and n-ary β has no surface.

## `crates/redextape-core/examples/frame_cost_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

It priced a per-step `TermTree` recorder — one tree per history frame, the design this probe's
measurements declined — and `TermTree` is gone with `lambdaAst`. Part 4a serves one tree for the
displayed step, rebuilt from checkpoints (`redextape-wasm`'s `LambdaLeg`); its cost is measured
by `web/tests/browser/lambda-tree-cost.test.ts`.

**SINCE A λ FRAME'S SPANS CROSS AS ONE BYTE STRING (2026-10-07) A λ ROW'S
`json_b` SPELLS A SPAN AS TWELVE JSON NUMBERS**, one a byte, so it no longer proxies what a span holds in the
browser, 12.56 bytes (`frame-cost.test.ts`), and it is not comparable with a λ row taken before then.

## `crates/redextape-core/examples/guard_hole_probe.rs`, above `fn curve_row(label: &str, t: LambdaTerm, every: u64, step_cap: u64) {`

At 6 groups it reaches 0 by step 2 while individual steps are reaching ~4.2 s each by step 9.

## `crates/redextape-core/examples/guard_hole_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

The counterexample below went from **19.0 s in its first β-step to under a millisecond**, and the
whole program normalises.

— 773,869,551 node-copies on the n=500 two-list row. Beside it
that row's first β-step now reads **0.000 s**, and the ns/predicted-copy rate collapses toward zero.

(2.2 / 7.1 / 17.6 / 42.0 s at k = 2/4/8/16)

on the branch immediately before the guard's — so this is a re-derivation of a number that was already in
the tree, unconnected, while the guard was being designed against a different mechanism.

**`Σ abs×arg` ITSELF WAS FALSIFIED ON 2026-08-02** — it is a static model of a `subst` that no longer
exists, over-reporting by ~1,584x since the `maxfree` short-circuits landed.

(15+ s in one step at
93.6 MB peak RSS)

## `crates/redextape-core/examples/inherit_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

Successor to `none_probe.rs`, which established that 96.2% of
`while4`'s 397 `None` steps happen with tagged `App`s alive elsewhere in the term — a quantity,
not a mechanism.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `/// Time one closure, batched: repeat until the batch clears `BATCH_MIN_MS`, divide by the`

THE PROPOSED `subst` REWRITE'S VALIDATION MOVED OUT OF THIS FILE.

It used to live here — `subst_lifted`/`subst_at` (the candidate rewrite §10 records), an exhaustive
differential against `subst` in `src/`, the shift-additivity lemma the rewrite depends on, and a
`lift == 0` allocation-identity pin — and it ran on every MANUAL `cargo run --example
lambda_sharing_probe`. That turned out to be weaker evidence than it sounds: CI compiles this
example — `ci.yml`'s `rust` job, in its `Feature matrix (non-LLVM, non-browser configs)` step,
which runs `scripts/check-all.sh`, whose base tier carries the `clippy|--workspace --all-targets`
row — but never RUNS it, so the check that makes the rewrite safe to act on gated nothing
automatically.

It now lives in `crates/redextape-core/tests/subst_differential.rs` as three `#[test]`s,
which `cargo nextest run -p redextape-core` executes on every CI run. It is not duplicated here: two
copies of an equivalence argument is exactly the kind of drift this branch spent its effort removing.

**AND ITS SUBJECT INVERTED ON 2026-08-02.** The candidate rewrite was falsified on cost — 0.99x on
the nested-group family, against a `Σ abs×arg` that over-reports by ~1,584x — so `subst_lifted` is
no longer a proposal.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `let mut ranked: Vec<&(&str, &str, u64, bool)> = where_it_goes.iter().collect();`

and the reason is this file's own history: the sentence
that used to sit here named a winner by hand, and the hand-named winner was a static model that
had stopped describing the code.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `remaining(rows, &reliable, &ms);`

**THIS USED TO BE "WHAT THE FIX WOULD BUY", AND THERE IS NO FIX.** It projected `Σ abs×arg`
becoming `Σ occ×arg` — the argument shifted once per OCCURRENCE instead of once per BINDER — at
7.0x flat and 18.0x allocating. Both were projections from a static counter, both were recorded as
falsifiable predictions, and on 2026-08-02 both were falsified together: the rewrite measures at
2.16x on this corpus and 0.99x — a regression — on the nested-group family. What replaces the
projection is the same table without the counterfactual: where the allocations actually go.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `const RELIABLE_MS: f64 = 1.0;`

**THE SUBJECT OF THIS CONSTANT CHANGED ON 2026-08-02 AND THE NUMBER DELIBERATELY DID NOT.** It used
to test `replay ms` itself, which was one replay: below a millisecond a single `Instant` reading
carries enough cache and scheduling noise that a 2x ratio means nothing. That test was correct and
it stopped selecting anything useful — after the 2026-08-01 fixes only 2 of 46 single replays
cleared it, and a two-parameter fit over two points is not a measurement. Batching moved the
uncertainty: `replay ms` is now a batch of `BATCH_MIN_MS`-or-`BATCH_MAX_REPS` divided by its
repetition count, so what has to clear a millisecond is the BATCH. Essentially every row does, which
is the repair — the corpus can price a node again.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `let (replay_ms, batch_ms) = batch_best_of_three(|| {`

**THIS USED TO BE BEST-OF-THREE SINGLE REPLAYS, AND THE 2026-08-01 FIXES BROKE IT.** Nothing
about the corpus changed; it got three to four orders of magnitude faster, and an instrument that
samples each program once went from timing 14 rows usably to timing 2. Everything downstream
degraded with it — PART C.2 was left fitting two parameters to two points and returned a
NEGATIVE price per read-only node, and the projection table printed negative milliseconds. That
is what a measurement apparatus outliving its subject looks like from the inside, and the fix is
to measure a batch rather than to widen the tolerances until the numbers look plausible again.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `batch_ms: f64,`

after the 2026-08-01
fixes a single replay of 44 of the 46 programs finishes below the timer's resolution.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `fn alloc(&self) -> u64 {`

**THE PREVIOUS VERSION OF THIS FUNCTION WAS `path + arg + body + abs×arg + (body - occ +
occ×arg)`**, which is the same list expressed as static products — and every one of those
products over-counts now. `arg` charges a full copy of an argument that is closed 88.4% of the
time; `abs×arg` charges every `Abs` in the body where `subst` descends through the ones on the
path to an occurrence; `occ×arg` charges a copy per occurrence where `subst`'s `Var` arm returns
a handle. Corpus-wide the old sum reports 73,806,194 against a measured 68,188-plus-reduct.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `depth_guard: u64,`

It used to walk the whole
logical expansion, which is what `term_size` counts and what 96% of the hang turned out to be.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `per_occ: u64,`

New 2026-08-03 with β-fusion, which needs it to price §5b's
formulation against §2's.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `opening: u64,`

Zero whenever `arg` is closed, which is
88.4% of corpus steps — the single fact that retired the `subst` lifted-shift slice.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `fn beta_allocs_fused(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> (u64, u64, u64) {`

~~`beta_go` is not in this tree; it
is the spec's proposed fused `beta`, named here so a reader grepping the crate lands on the spec
instead of an empty search.~~ **Corrected 2026-08-04:** that was true when this counter was written
against a proposal and false from the moment the proposal landed — and it justified itself by an
appeal to `grep`, which is exactly what falsifies it.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `fn subst_allocs_lifted(j: u32, lift: u32, s: &LambdaTerm, t: &LambdaTerm) -> (u64, u64) {`

one sentence of that file's inline `lift == 0` comment did not make the crossing.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `/// Node-constructions `shift(d, cutoff, t)` performs, counted FAITHFULLY — the recursion `

because PART A's `replay ms` column contains a 6.7x that node count does not explain: row 7 has more steps (470 vs
411) and bigger terms (9,763 vs 4,898 nodes) than row 31 and runs in 180 ms against row 31's 1,203.
Sharing did not touch it — both rows sped up ~2.5x when `LambdaTerm` became `Rc`-backed and the
ratio between them barely moved. Whatever separates them is therefore not allocation volume.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `// Example target: `clippy.toml`'s `allow-*-in-tests` keys do not reach example targets at`

```
# PART B WENT STALE ON 2026-08-01 AND WAS REPAIRED ON 2026-08-02 — READ THIS BEFORE ANY B/C FIGURE
```

**The failure is worth stating before the fix, because it is the interesting half.** PART B's cost
counters were STATIC MODELS: `Σ abs×arg` is `count_abs(body) × size_of(arg)`, computed from the
trace's terms rather than by watching `subst`. When the `maxfree` short-circuits and the stored
`depth` landed and the reducer got three to four orders of magnitude faster, **every counter here
reported exactly the number it had reported the day before.** An instrument built to falsify claims
about cost could not detect that its own subject had changed underneath it.

It showed up as nonsense rather than as silence, which is the only reason it was caught: only **2 of
46 rows** still cleared timer resolution, the two-price fit was left fitting two parameters to two
points and returned **-77.04 ns/node** for read-only work, and the closing table projected
**-427.5 ms** of remaining time. A negative millisecond is an instrument reporting that it can no
longer price its corpus.

**What the models were wrong by**, now printed by PART B itself rather than quoted here:
`Σ abs×arg` over-reports the re-shift `subst` performs by **~1,584x** (70,542,349 against 44,539),
and `Σ size` over-reports `depth_exceeds` by **~1,248x** (7,433,964 against 5,955 — it reads a
stored field, once per step). The headline "86.8% of the nodes the reducer visits" is a share of the
first and inherits its error. The fix PART C used to project at 7.0x/18.0x measures at **2.16x here
and 0.99x — a regression — on the nested-group family**; it is falsified and will not be built. See
`shift_cost_probe.rs`'s census section and the perf design's §10.

**The repair, in three parts.** (1) Counters that MIRROR the functions — `Σ opening`, `Σ spine`,
`Σ reshift`, `Σ closing`, `Σ guard` — replacing the products in `alloc`/`read`. (2) The stale models
kept beside them as CONTROLS and entered in PART C's contest, where they lose: `Σ alloc` now prices
at a spread of 1.8x against `Σ abs×arg`'s 4,318x. (3) Batched timing — each replay repeated until it
clears `BATCH_MIN_MS` — which puts all 46 rows back above the timer and makes the two-price fit a
fit again (`a` stable to ~1% under leave-one-out, where it printed `0.00 to 0.00 (infx)`).

The accounting now predicts the clock: 189,152 nodes at the fitted prices is 7.6 ms against a corpus
that replays in 7.4 ms.

```
# PART B RAN THE β-FUSION GATE ON 2026-08-03, AND IT PASSED AT 4.3%
```

Measured here:

```text
GATE (design §5): Σ freevar = 1458 against Σ opening + Σ closing = 34085 — 4.3%, and the bar is under 40%.
```

and **0 of the 46 rows rise** under either candidate. `Σ β today` 102,273 → `Σ β fused` 69,646.

**`Σ freevar` is the design's null-result counter, and this corpus tests its defining claim 46 times
without being asked to.** §4 calls it a proper subset of `Σ closing`; `freevar <= closing` holds on
every row and `freevar == 0` on exactly the rows where `closing == 0`. The corpus-wide ratio is
**6.3%**, which is the mechanism rather than luck: the closing shift rebuilds whole PATHS to free
variables and `Σ freevar` counts only the leaves at their ends.

**`Σ opening + Σ closing = 34,085` is NOT independent corroboration of that**, and the temptation to
read it as such is why this paragraph exists. It agrees to the unit with the zipper design's §5b —
but both are pre-existing `Work` fields that the β-fusion work never touched, and §5b's table was
built from THIS probe, so the agreement is an identity and could not have come out otherwise. The
one thing it establishes is that adding `Σ per_occ` and `Σ freevar` perturbed neither counter.

**THE FORMULATION CONTEST WENT AGAINST THE DESIGN ON THIS CORPUS.** `Σ β fused` (design §2, `s`
carried per binder) is **69,646**; `Σ β occ` (design §5b, the shift paid per occurrence) is
**33,051**. The whole gap is `Σ reshift` **44,539** against `Σ per_occ` **7,944**, since `Σ spine`
and `Σ freevar` are common to both. §2 predicted the reverse and argued the direction was *"forced
rather than incidental"* from `shift_cost_probe.rs`'s nested-group family, where the sign genuinely
is reversed (64,006 against 96,036, `incr` ahead by 1.0095x). **Both corpora were already in the
record; the design generalised one of them.** Neither formulation regresses a row, so this decides
WHICH fusion, not whether — see the design's §5 GATE RESULT.

**AND ON THE CLOCK, 2026-08-03: THIS CORPUS WON AND THE FAMILY LOST.** The `replay ms` column below
(PART B's three-decimal column, not PART A's one) sums to **7.416–7.466 ms three-pass against
5.707–5.760 ms fused, a 1.288–1.308x** over four runs a side across two builds. No row's median
regresses and three carry 87% of it — rows 35, 9 and 36 — while four (28, 31, 32, 33) have
overlapping ranges and are at parity rather than improved. The nested-group family measured **0.910–0.925x** on the same pair of
builds, so the design's ship bar — `>= 1.10x` on the family AND `>= 1.00x` here — is MISSED on a
clause this corpus passes. **The half expected to show nothing is the half that moved**, which is
the design's §9 prediction 3 failing in both directions at once; §5's SHIP RESULT has the tables.

Its own module doc already records that
its numbers did not move when `LambdaTerm` became `Rc`-backed.

Measured either side of the conversion,
the corpus totals are identical to the node — 7,435,004 trace nodes, 43,580 within-term nodes over
2,994 distinct (14.56x).

interning would still collapse by 10.3x and 50.0x

CORRECTED 2026-07-31. This bullet read "`Rc` already captures the bulk of it ... proves nothing
about interning" — an inference made before any `Rc` allocation existed to count. Layer 1
produced them, and on the two rows now counted the conclusion did not survive. The design's §3
records the correction — and note what the correction does NOT say: that a big number here
justifies interning. That would be false on the 44 rows with no allocation count.

the intern pass is about **1.7x** dearer per node, not the
~15x that this line's earlier "~4 ns/node" (a figure nothing here ever measured) implied.

The answer is `Σ abs×arg` — `subst` deep-copies the argument once per `Abs`
NODE IN THE BODY (its `Abs` arm re-shifts it), where the step has ~1 use for it — and it is **86.8%
of the nodes the reducer visits**. That is neither of the two costs this file's sharing question was
about, and no amount of interning or memoization addresses it; see the design's §10.

price about 18x apart, so `depth_exceeds`' whole-term walk is a large share of
the node count and a small share of the clock

that list has drifted from hand-copying twice
before, as `step_survey.rs`'s module doc records.

for why it took two attempts to get here.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `fn family_sharing_profile() {`

IT REACHES 12 AGAIN. Between `1652e09` and the shared-subterm guard's revert this ramp printed levels
1–6 and stopped, because `lower` refused the family from seven groups on; that guard is gone, so the
L7–L12 rows in the design's §3 table are re-derivable here rather than quoted from a pre-guard run.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `/// Question A — the corpus sharing profile that sets the bound: `max_shared` and total `l`

Added for the λ shared-subterm guard's threshold-setting measurement (sharing-profile.md).

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `fn shared_subterm_report() {`

RAMPS UPWARD THROUGH ALL THREE LEVELS AGAIN. The two levels this section was written around — 8 and
10 groups (38,349 and 153,933) — were unreachable between `1652e09` and the shared-subterm guard's
revert, and are live measurements once more.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `fn list_ramp_past_699() {`

By n=699 the row already took 35 s against a 10 s budget, on a roughly cubic
time curve (0.014 s / 0.101 s / 0.747 s / 6.254 s / 35.209 s at n = 50/100/200/400/699 — each ~2x n
costs ~7-8x time). Extrapolating that curve, n=1000 costs roughly 100 s and n=2000 roughly 800 s
(13 min); this ramp stops well short of finding out the hard way.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `fn list_ramp_crossing() {`

added after the fixed 50/100/200/400/699 ramp showed n=699 already taking
35 s — over `BUDGET_S` — while n=400 took 6.25 s: the crossing is somewhere in (400, 699], not past
it.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `// --- question 1 & 2: does the list reduce, and where does it stop being fine? ----------`

THE IN-DEGREE FOLD USED TO LIVE HERE, as a local `ref_counts` + `max_shared_logical_size` pair that
called `logical_size` once per shared node — O(shared x physical). It went the way `blowup_probe.rs`'s
local `logical()` fold went, and for the same reason: `lambda::term::max_shared_logical_size` is `pub`
and O(physical), so two copies of one measurement is drift waiting to happen and the local one was the
slower copy besides.

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `fn direct_list_term(n: u64) -> LambdaTerm {`

matching the task's own anticipation ("you may need to construct the Core
directly... if you cannot get past 699 without fighting another guard, say so and stop").

## `crates/redextape-core/examples/list_reduction_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

The LOGICAL-SIZE design was withdrawn because a PRE-EXISTING test — `lower.rs`'s
`the_guard_admits_a_core_at_the_bound_and_refuses_only_past_it` — builds a **699-element list
literal** (`deep_list(MAX_LAMBDA_LOWER_DEPTH - 1)`) that measures 497,691 logical nodes at a
logical/physical ratio of exactly 1.000x, and the guard refused it. The falsification's premise is
that this program is FINE — a large but working program the guard should not refuse. **Nobody had
ever reduced it**; the pre-existing test only asserts `lower(&at_bound).is_ok()`.

(because `subst` duplicates a shared subterm into every occurrence it substitutes
into, where an unshared subterm of the same size is copied once, by construction).
**THE PARENTHESIS IS WRONG AND THE HYPOTHESIS WITH IT** — `subst`'s `Var` arm is `s.clone()`,
an `Rc` bump, so occurrences are FREE; it is the `Abs` arm that copies, once per binder in the
body, whether or not the variable occurs. See the note after section 6. **The measurements
themselves stand** — what was falsified is the reading taken off them.

Those three killed the old design. **Three further sections set the new one's bound**, added once
the answer to question 3 turned out to be the discriminator

  4. `corpus` — `max_shared` over every program in `FIRST_ORDER_DEMOS`. ANSWER: the maximum is
     **684**, at index 31 (`fn s0/s1/s2 … s0(4)`); **twelve of the 46 measure zero** and the other
     **34 share something**, in three bands. 4 for the seven `head`/`tail` programs, 400–684 for the
     five with a mutual-recursion group of **two or more members**, and 6 for the twenty-two
     remaining programs that declare a `fn` or a `while` (the recursive-binding scaffolding, whether
     or not anything actually recurses). Only the middle band is large, and group SIZE is why: the multiplier is
     `lower_group` cloning the whole group term once per member, so a *self*-recursive `fn` is a
     one-member group and measures 6, the same as a non-recursive one. The twelve zeros are the
     programs with none of those three constructs — not "everything without a recursive cycle".
  5. `family` — `max_shared` and `logical_size` for the nesting family at 1..=12 groups.
     Construction only, no reduction. ANSWER: **9,453** at 6 groups, **19,085** at 7, roughly
     doubling per level after that.
  6. `family-reduce <level>` — does ONE level keep stepping, or does a single step hang? **THE
     HAZARD SECTION.** ANSWER: level 6 steps steadily; level 7 pegged one core at 100% for 15+
     seconds inside a single step, at a peak RSS of only **93.6 MB**, and had to be killed from
     outside — the hang is computational, not memory.

THE GUARD THIS PROBE CALIBRATED WAS REVERTED, AND EVERY RAMP HERE REACHES ITS FULL RANGE AGAIN.
Between `1652e09` and the revert, `lambda/lower.rs`'s `MAX_SHARED_LOGICAL_NODES` = 10,000 refused a  check-attributions: allow
term whose largest SHARED subterm exceeded it, so `q3`, `family` and `family-reduce` stopped at seven
groups printing `lower error: TooShared { .. }`. **Measurement then falsified the guard.** The
mechanism it was calibrated against is not the one `subst` implements, and a program with no
recursion at all — `let xs = [0..500); let ys = [0..500); head(xs) + head(ys)`, 4,821 bytes — measures
`max_shared` = 4 against that bound of 10,000 while spending 19.0 s in its FIRST β-step — **a
pre-2026-08-01 timing; that step is now under a millisecond, see `examples/shift_cost_probe.rs`. The
score of 4 is unchanged, so the falsification stands.** Instrument:
`examples/guard_hole_probe.rs`; record: the shared-subterm design's §10. So the figures above at
seven groups and beyond are **live measurements again, not a pre-guard record**. ~~"`family-reduce 7`
is once more the hazard this file warns about"~~ — **no longer true as of 2026-08-01: it reduces.**
Every WALL-CLOCK figure in this file predates the `shift` and `depth` fixes and will not reproduce;
every SIZE and STEP COUNT is unaffected, because `lower` builds the same term it always did and the
reductions take the same steps.

`lower_src` RETURNS `Option` ANYWAY and must not go back to panicking. It used to `panic!` on `Err`,
which killed the documented no-argument invocation below at `q3` — before `corpus` or `family` ran at
all — so the headline command in this very doc block aborted. Nothing refuses these programs today,
but a ramp that reports a refusal and keeps its remaining rows is the shape that survives the next
guard as well as this one.

An earlier measurement on this project consumed 60 GiB of RAM and 29 GiB of swap and wedged the
machine, from calling `reduce_trace` (which materializes every step by contract) on a term of
unbounded growth.

— and did, in the 60/29 GiB run above.

## `crates/redextape-core/examples/none_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

that probe measured `while4` and `countdown4` at 470/474
steps with 397 `None` each, after `lower.rs` grew five tagging sites.

## `crates/redextape-core/examples/rustfmt_calibration_probe.rs`, above `// Probe target: a probe that cannot run its own subprocess has nothing to report, so pani`

**MEASURED 2026-08-19, rustfmt 1.9.0-stable (8bab26f4f6 2026-07-14):**
  1. long short-element array: filled  (agrees)
  2. switch point: 10  (`SHORT_ELEMENT` = 10 agrees — the "array at the short-element boundary (10)"
     / "array just past it (11)" pair above straddles it directly: width 10 fills, width 11 breaks
     one-per-line, on both sides)
  3. trailing comma: fill yes, vertical yes  (fill DIFFERED — printer had no trailing comma in fill
     mode; fixed in `fill_rows`)
  4. method chain: broke at every `.`  (agrees — the "method chain long enough to break" case above,
     matching the printer's own pinned unit test `a_long_method_chain_breaks_one_link_per_line`
     (`.filter(|a_long_parameter| a_long_parameter > 2)` x5), breaks at every link on both sides.
     The original "method chain" case above stays 105 columns wide at its `let _ = ` indent, under
     the 120 budget, so it never exercised the break rule; kept alongside the new case as a "stays
     inline" contrast.)

A FIFTH finding, outside the four numbered questions but squarely inside the "long argument list"
case above: Task 6's `bracketed` rule was "rustfmt packs short elements in an array literal but
NEVER in an argument list" — the case's own rustfmt output filled the 11-argument call instead of
breaking it one-per-line, at the identical `SHORT_ELEMENT`-based 10/11 threshold as arrays (checked
directly, both boundary widths). That recollection was wrong for this project's
`use_small_heuristics = "Max"`, and is now DIFFERED and fixed: `bracketed` uses one fill rule for
both lists and argument lists, and `allow_fill` — no longer a real difference between the two
callers — is gone rather than kept as a vestige.

## `crates/redextape-core/examples/shift_cost_probe.rs`, above `line("");`

Recorded costs, pre-fix: the two-list program spent
19.0 s in its FIRST β-step; the 699-element literal took 35 s over 1,398 steps.

## `crates/redextape-core/examples/shift_cost_probe.rs`, above `closing: u64,`

**ABSENT FROM THIS CENSUS UNTIL 2026-08-03, AND CORRECTLY SO FOR THE QUESTION IT WAS BUILT
FOR.**

## `crates/redextape-core/examples/shift_cost_probe.rs`, above `fn beta_allocs_fused(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> (u64, u64, u64) {`

~~`beta_go` is not in this tree; it
is the spec's proposed fused `beta`, named here so a reader grepping the crate lands on the spec
instead of an empty search.~~ **Corrected 2026-08-04:** that was true when this counter was written
against a proposal and false from the moment the proposal landed — and it justified itself by an
appeal to `grep`, which is exactly what falsifies it.

## `crates/redextape-core/examples/shift_cost_probe.rs`, above `// This probe carries no unwrap/expect/panic allow because it never trips those lints — it`

The record said the next slice was a per-redex work budget, and that `lower_group`'s duplication
was worth re-examining first because "fixing the root cause may remove the need for a guard at
all". It does. The root cause was not `lower_group`, which only writes the promise:

`blowup_probe.rs` had already recorded (2) as a finding without naming it as a cause — "a β-step's
output aliases nothing, and the within-term ratio is exactly 1.00x after ≥6 steps from starting
ratios up to 114x". The compact term was never small; `shift` is what made the reducer keep the
promise.

**187.6 s of level 11's 195.7 s was the depth guard.** Memoizing is not the answer, and the level-7
row is why:

```
# MEASURED 2026-08-01
```

| program | before either fix | `shift` only | both |
| --- | --- | --- | --- |
| the 512-byte nested-group hang | one β-step unfinished at 13 min / 974 MB | 105,607 steps, 195.7 s | **7.48 s** |
| `let xs = [0..500); let ys = […]; head(xs) + head(ys)` | 19.0 s in the FIRST β-step | 0.024 s | **<0.001 s** |
| `[0, 1, …, 698]` | 35 s over 1,398 steps | 3.187 s | **0.986 s**, same 1,398 steps |

**The reduction ramp is now FLAT** — 7.5–9.0 s at every level from 1 to 11, against a logical size
that grows 306 → 616,152 across that range. Before the depth fix it doubled per level in step with
the logical size; before the `shift` fix the last level did not finish.

Step counts are unchanged wherever they were recorded, which is the evidence that both changes are
representational and not semantic. The sharing gate agrees from the other end: the same node totals
held in 7.42x and 42.5x fewer allocations (`tests/lambda_sharing.rs`).

~~The record's older "next target" — carrying `subst`'s per-binder re-shift down as a single
`shift(d, 0, ·)`, with an additivity lemma already verified in the perf design — is untouched and
still available.~~ **FALSIFIED 2026-08-02 by the census section below — see the next heading.**

```
# AND THEN THE OLDER "NEXT TARGET" WAS FALSIFIED TOO, BY THE SAME SHORT-CIRCUIT (2026-08-02)
```

**`reshift` — the quantity the rewrite deletes — is 5,696 allocations across 105,607 β-steps**, or
0.05 per step, where the model that sized the slice priced it at 44 copies of the argument per step
(`lambda_sharing_probe.rs` PART B's `Σ abs×arg`, 70,542,349 corpus-wide).

**WHY IT INVERTS** — ~~and the direction is forced rather than incidental~~. **CORRECTED 2026-08-03:**
it is not forced

The ordinary corpus agrees from the other end: 88.4% of its 5,955 β-steps have a CLOSED argument, so
`shift(1, 0, arg)` is a refcount bump and the re-shift is already free. Its win is 2.16x on a
quantity that is 36,595 allocations across all 46 programs.

**`spine` is 60-90% of what `subst` now costs**

20,725 to 190,666 across levels 1 to 11

produced is a landed finding. The rows above are unchanged to the unit across the addition, which is
the evidence that the new columns moved nothing.

**The `win` column climbs monotonically 1.26x, 1.37x, 1.49x, 1.60x, 1.71x, 1.83x, 1.94x, 2.05x,
2.17x, 2.28x, 2.40x across levels 1 to 11** — because `beta_today` carries `opening` and `closing`,
the two columns that scale, and `fused_incr` carries neither. Over all 13 rows `beta_today` is
6,138,291 against `fused_incr`'s 3,370,731, a 1.82x. **These are allocation counts and say nothing
about the clock** — the lifted-shift slice cut ~19% of allocations and measured 0.99x, which is why
the design's ship bar is in seconds and is a separate measurement from this one.

**`freevar` is the null-result counter and it came in at 4.3%** of `opening + closing` on the
46-program corpus (1,458 against 34,085), against a bar of 40% written before the number existed.
No row of either the corpus or this family allocates more under fusion than it does today.

```
# AND THEN THE CLOCK SAID NO, ON THIS VERY FAMILY — MEASURED 2026-08-03
```

**The 1.82x above buys nothing here. The reduction ramp printed by `main` below is 0.910–0.925x
FUSED AGAINST THREE-PASS — a regression on every one of the eleven levels**, worst 0.880–0.895x at
level 7, best 0.965–0.997x at level 1, four runs a side across two builds with this file held
constant. The design's ship bar was `>= 1.10x` on exactly this ramp, and it is MISSED. (The
46-program corpus went the other way, 1.288–1.308x; the split is the whole result.)

**The paragraph above warned that counts say nothing about the clock, and it was right for a reason
it did not name.** At level 11 fusion removes 3.96 allocations per β-step and the clock loses 7.0 µs
per β-step — three orders of magnitude apart, so the loss is not in `beta` at all. What the ramp
actually spends its ~70 µs a step on is `reduce_step`, which has NO MEMO: it recurses into both
children of every `App` hunting the leftmost-outermost redex, so it costs the LOGICAL tree, which is
identical under both `beta`s. **No allocation saving can reach it**, which is why this family — the
one `Σ opening` was selected on — was never able to pay fusion back. Why it additionally LOSES 7
µs/step is not established; see the design's §5 SHIP RESULT, which leaves it open rather than
guessing.

| | `reshift` | `per_occ` | winner |
| --- | --- | --- | --- |
| this family, 13 rows | 64,006 | 96,036 | `incr`, by 32,030 — a 1.0095x |
| the 46-program corpus | 44,539 | 7,944 | `occ`, by 36,595 — a 2.11x |

The family row is the one the falsification heading above already reported: binders crossed are
fewer than occurrences *here*. **The corpus row is the same 36,595 that heading calls a 2.16x win on
a small quantity** — it was in this file's own record the whole time, and the fusion design's §2
generalised the family's sign over it. Neither formulation regresses any row, so this decides which
fusion to build rather than whether to build one.

```
# ALLOCATOR — READ THIS BEFORE TRUSTING ANY TIMING ABOVE
```

**This target has set `mimalloc` as its global allocator since 2026-08-04. Every timing recorded
in this file above this note was measured under glibc's malloc and is NOT comparable to a run
made today.** Counts are: node counts, allocation counts and step counts are properties of the
reduction, not of the machine, and did not move. Seconds, ms and ns did.

It is here for a measured reason rather than a preference. The reducer allocates one `Rc<Node>`
per term node and frees on the same order, and glibc's layout for that pattern costs real
address-translation pressure: on the nested-group family, swapping ONLY the allocator took L1
DTLB misses from 1.20e9 to 0.92e9 for the three-pass `beta` and from 1.83e9 to 0.93e9 for the
fused one, with the wall clock following at ~9% and ~16%. That is also how the β-fusion family
regression was explained — it was glibc's layout, not the reducer's work.

## `crates/redextape-core/examples/state_cost_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

and the step past 4,094 tokens was killed by `SIGKILL` under an 8 GB budget WHEN THESE
NUMBERS WERE TAKEN — before `MAX_MACHINE_STATES` existed. `Builder::state`/`accept` now bounds
every lowering this file can reach at that same ceiling (~727 MB), so a fresh run cannot reproduce
that kill; see the post-guard note below for what changed. The cap stays here as the same
belt-and-suspenders every `*_probe.rs` in this crate runs under, not because this file is
currently expected to need it:

Four narrowing casts used to justify themselves with a prose argument that
`Program::code.len()` was bounded by ~172 GB of resident memory. It is not, and the prose had
already been copied verbatim into a second file.

## `crates/redextape-core/examples/step_survey.rs`, above `Synthetic,`

MEASURED on this corpus, the row is entirely
`$box_get` (30,742 steps) + `$box_set` (18,888) — defunc's mutable-capture boxing, nothing else.

## `crates/redextape-core/examples/step_survey.rs`, above `fn devirt_target(&self) -> u64 {`

Commit `3b932ec` established the
rule "bucket by what a pass could DO about it" and applied it to the first of those three;
these are the other two, removed by the same alternative mutable-capture strategy and by no
amount of devirtualization. Leaving them in overstated this target by ~0.9pp.

## `crates/redextape-core/examples/step_survey.rs`, above `println!("    ONE asm instruction each (`lower_asm.rs`'s `lower_builtin_apply`) — no frame`

"a SINGLE" became "ONE" on the same line for width alone: the symbol is 18 characters longer
than the coordinate it replaces, which puts the line 5 over `max_width = 120`; dropping
"a SINGLE" for "ONE" saves exactly 5. "ONE" is the wording `ApplyClass::Builtin` already uses
for this same claim, so the two now match.

## `crates/redextape-core/examples/step_survey.rs`, above `"fn head(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } head(1) + ap(add1, 2)",`

(measured at 3246742: reference 5, λ 5, TM 3)

## `crates/redextape-core/examples/step_survey.rs`, above `"fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \`

λ 411 steps, TM 145,819.

## `crates/redextape-core/examples/step_survey.rs`, above `"fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)",`

λ 25 steps, TM 16,143.

## `crates/redextape-core/examples/step_survey.rs`, above `"fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \`

λ 502 steps, TM 120,899.

## `crates/redextape-core/examples/step_survey.rs`, above `"fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \`

Measured cost (well inside both caps): λ 367 of 5,000,000 steps, TM 99,699 of 5,000,000.

## `crates/redextape-core/examples/step_survey.rs`, above `// Example target: a demo that cannot build its own input has nothing to demonstrate, so a`

This copy (and `redextape-native/tests/native_oracle.rs`'s) drifted from `FIRST_ORDER_DEMOS` twice
across two slices despite the "verbatim" claim above, so hand-checking is no longer enough:

## `crates/redextape-core/examples/tm_emit.rs`, above `let h = doc.header.ok_or_else(|| {`

#32's `lower_tm` "cannot drift" entry is the failure this comment exists to
avoid: two places asserting opposite things about one condition, with neither naming the other.

## `crates/redextape-core/examples/width_report.rs`, above `fn fitted(src: &str, family: &dyn Encoding) -> (Option<usize>, String) {`

This was once required for correctness: `Binary`'s decode was width-strict, so a tape fitted at, say,
4 cells decoded to `None` under a 64-cell `Binary`, while `Unary`'s scan-to-the-first-blank decode hid
the asymmetry — this function used to decode every result with `Unary::default()` regardless of the
fitted width and happened to work only because of it. Both decoders are structural now, so the
`at_width` below is no longer load-bearing;

## `crates/redextape-core/examples/width_report.rs`, above `// Example target: a demo that cannot build its own input has nothing to demonstrate, so a`

The experiment that motivated per-program sizing was originally run by editing a constant and
rebuilding eleven times.

## `crates/redextape-core/examples/common/footprint.rs`, above `pub(crate) fn lower_src(src: &str) -> Option<LambdaTerm> {`

Since the shared-subterm guard was reverted only `TooDeep` and the two `Unsupported` cases can fire here

and that defect is exactly what took `list_reduction_probe`'s documented invocation down when the guard landed.

## `crates/redextape-core/examples/inherit_probe.rs`, above `assert_eq!(classify_pos(0, 0, 0), PosBucket::NoTags, "no tagged App anywhere in the term")`

and the case the old `an_untagged_redex_with_no_tags_inside_is_disjoint` test could not distinguish from it.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `println!("\nHOW TO READ THIS:");`

THE 10.3x/50.0x BELOW ARE DERIVED, NOT MEASURED HERE, and they are the third superseded claim this legend has had to be corrected for.

## `crates/redextape-core/examples/step_survey.rs`, above `"fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \`

was asserted only by unit tests stopping at the reference and `run_asm`, never through λ, the TM, or native.

## `crates/redextape-core/examples/frame_cost_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

PR 3c's worker drives λ with `runLambda(50_000)` — **one wasm call per 50,000 β-steps**.

If printing dominates stepping, then `RECORD_BUDGET`
and `FRAME_BYTES` are wrong before the plan that picks them is written.

## `crates/redextape-core/examples/blowup_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

— and did: an earlier version of this investigation consumed **60 GiB of RAM and 29 GiB of swap** before it was stopped by hand.

That 60/29 GiB run is what calling it costs

## `crates/redextape-core/examples/blowup_probe.rs`, above `fn beta_curve() {`

and a previous run of this measurement consumed 60 GiB of RAM and 29 GiB of swap doing exactly that.

## `crates/redextape-core/examples/frame_cost_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

An earlier measurement over a comparable family took 60 GiB of RAM and 29 GiB of swap and wedged the machine

and that is how the 60 GiB run happened.

## `crates/redextape-core/examples/guard_hole_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

An earlier measurement on this project consumed 60 GiB of RAM and 29 GiB of swap and wedged the machine.

## `crates/redextape-core/examples/inherit_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

An earlier measurement over this family took 60 GiB of RAM and 29 GiB of swap and wedged the machine.

and is how the 60 GiB run happened.

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

IT WAS WRITTEN AGAINST THE `Box` REPRESENTATION AND ITS NUMBERS DID NOT MOVE WHEN `LambdaTerm` BECAME `Rc`-BACKED, which is worth stating because the opposite is the natural guess.

## `crates/redextape-core/examples/shift_cost_probe.rs`, above `#![allow(clippy::pedantic)]`

An earlier measurement over the same family took 60 GiB of RAM and 29 GiB of swap and wedged the machine

and that is precisely how the 60 GiB run happened.

## `crates/redextape-core/examples/state_cost_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

the historical 727 was measured at a row this file can no longer reach post-guard — see note below

The 8.6M-state / 6.0 GB / `SIGKILL` figures above were measured BEFORE this crate had a ceiling at all, using a scratch copy of this file that called the (then-unguarded) `lower_tm`.

That figure was measured at the 4,094-token row, which this file can no longer reach (now refused outright)

## `crates/redextape-core/examples/concurrency_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

an earlier measurement over that path took 60 GiB of RAM and 29 GiB of swap and wedged the machine

and that is exactly how the 60 GiB run happened.

## `crates/redextape-core/examples/guard_hole_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

**ALL TIMINGS BELOW ARE PRE-2026-08-01 AND WILL NOT REPRODUCE.** The costs this probe was built to
expose were removed at the root, not guarded: `term.rs`'s `shift` was Θ(logical) and
sharing-destroying, and `reduce.rs`'s `depth_exceeds` walked the logical tree once per step. Both now
read `u32`s the constructors maintain.

**The quantities are unchanged and the falsification stands** — `max_shared` is still 4, the corpus
maximum is still 684, and `max_shared` still collapses rather than grows. What this file establishes
about the two reverted guards does not depend on the timings, which is why it is corrected in place
rather than rewritten.

The `source` section's counterexample is `let xs = [0..500); let ys = [0..500); head(xs) + head(ys)` —
4,821 bytes, no recursion, no `while`, no closure — which measures `max_shared` = **4** against a
bound of 10,000 and **spent 19.0 s in its first β-step**; `lets` shows that cost was linear in the
number of let-bound lists

so it is a family rather than an artifact of one ceiling; and `curve` shows `max_shared` COLLAPSING
rather than growing — sampled after every step across six programs it is non-increasing in all six,
so the lowering-time reading was the peak, taken at the one moment it is maximal and destroyed by the
second β-step.

**The guard is gone; this file is kept as the re-runnable source for those figures and for the
23.1–23.6 ns/node-copy rate the cost model below is calibrated on.**

it attributes 86.8% of all nodes the reducer visits to `Σ abs×arg`, as its HEADLINE FINDING

but a reader arriving here for the 86.8% should read `shift_cost_probe.rs`'s census section first.

## `crates/redextape-core/examples/guard_hole_probe.rs`, above `fn curve_row(label: &str, t: LambdaTerm, every: u64, step_cap: u64) {`

The guard ran once, at lowering time. This asked whether the number it read stayed true, and it does
not: `max_shared` is NON-INCREASING across all six rows, so the peak is always the lowering-time
value.

A one-shot reading is taken at the single moment the quantity is largest and is destroyed by the
second β-step — the opposite of the monotonicity a lowering-time guard needs.

## `crates/redextape-core/examples/inherit_probe.rs`, above `fn retag_all(t: &LambdaTerm, o: NodeId) -> LambdaTerm {`

a mutation that stripped the memo from this very function and
ran all four probe programs under the 2 GB cap completed to normal-form on every one, with
byte-identical output to the memoized run. These four programs evidently do not build enough
duplicate structure through this walk to hit the wall `max_shared_logical_size` guards against

## `crates/redextape-core/examples/lambda_sharing_probe.rs`, above `let steps: u64 = rows.iter().map(|r| r.steps as u64).sum();`

`Σ occ×arg` and `Σ arg` sitting on top of
each other in the table is not a coincidence to note in passing — it says the mean occurrence
count is ~1, i.e. there is no substitution blowup anywhere in this corpus.

## `crates/redextape-core/examples/link_index_probe.rs`, above `owned_states: usize,`

A program can have
`states` far exceed `src_nodes` — `prog200` is 44,670 states over 403 nodes — so the two ratios
read nothing alike: `prog200` is ~1.3% by this count against 50% by `tm_pct`.

## `crates/redextape-core/examples/none_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

An earlier measurement over a comparable family took 60 GiB of RAM and 29 GiB of swap and wedged the
machine.

and is how the 60 GiB run happened.

## `crates/redextape-core/examples/owner_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

An earlier measurement over a comparable family took 60 GiB of RAM and 29 GiB of swap and wedged the
machine.

and is how the 60 GiB run happened.

## `crates/redextape-core/examples/shift_cost_probe.rs`, above `#![allow(clippy::pedantic)]`

it identified `shift` as the blow-up's cash register and then `depth_exceeds` as what was left

```
# AND THEN `depth_exceeds` WAS 96% OF WHAT REMAINED
```

With `shift` fixed, the reduction ramp still doubled per level — and the second measurement found
that almost none of that was reduction. `reduce.rs`'s `depth_exceeds` walked the LOGICAL expansion
once per β-step, the same bug class one function over. Sampled 1-in-200 against a memoized
equivalent, verdicts identical on every sample:

```text
level   steps   logical_depth   memo_depth   speedup
    7  107379          11.630       25.110      0.5x
    9  106493          46.863       23.527      2.0x
   11  105607         187.599       23.824      7.9x
```

a `HashMap` per call is a net LOSS on the small terms the ordinary corpus reduces (that flat ~24 s
is per-call allocation overhead, not walking).

105,607 steps against a step cap of 5,000,000

**This family is now flat; that is not a claim about every family.**

The standing next λ slice was carrying `subst`'s per-binder re-shift down as one `shift(d, 0, ·)`,
paying it once per OCCURRENCE instead of once per BINDER. **It is not a win, and on this family it
is a LOSS.** The census section at the bottom of `main` prices it against what `subst` now
allocates:

```text
program          steps  closed_arg   opening     spine   reshift   per_occ    today   lifted    win
nested lvl  1   109565       89.2%     20725    296124      5921      8881   322770   325730  0.99x
nested lvl 11   105607       89.2%    190666    285574      5696      8549   481936   484789  0.99x
two 500-lists       22       81.8%         7        43         0         0       50       50  1.00x
699-literal       1398      100.0%         0      5592         0         0     5592     5592  1.00x
```

it is this family's direction only, and "THE TWO FORMULATIONS DISAGREE ABOUT WHICH CORPUS THEY ARE
MEASURED ON" below is where the 46-program corpus inverts it — the same `reshift` against `per_occ`
split, with the sign flipped. `subst`'s `maxfree` short-circuit means it descends through only the
binders ON THE PATH TO AN OCCURRENCE, not every `Abs` node in the body — so "binders crossed" is now
SMALLER than "occurrences", and paying once per occurrence costs more than paying once per binder
crossed. The 44:1 abs-to-occ ratio the design quotes is `count_abs(body)` over the whole body,
computed statically and before the short-circuit existed. And the per-unit comparison runs the same
way: today's `Abs` arm shifts the progressively lifted `s_d`, whose higher indices make the
short-circuit fire LESS often, so each unit of today's cost is at least each unit of the rewrite's.
A ratio of `per_occ`/`reshift` = 1.5 therefore means the rewrite performs at least 1.5x as many
shifts as it removes.

```
# WHAT THE CENSUS FOUND INSTEAD, and neither column was being tracked
```

**`spine` is 60-90% of what `subst` now costs** — the body it rebuilds on the way down. No guard and
no rewrite proposed so far touches it.

**`opening` — `beta`'s own `shift(1, 0, arg)` — is the only column that scales with the family**,
20,725 to 190,666 across levels 1 to 11 while every other column is flat or falling. If anything
here is the next target it is that, and it is a different function from the one every proposal so
far has been about.

```
# AND THAT COLUMN BECAME A SLICE WITH A GATE — RUN 2026-08-03, PASSED AT 4.3%
```

The census gained `closing`, `freevar` and a SECOND contest — `beta_today` against `beta_fused_incr`
and `beta_fused_occ` — for `docs/superpowers/specs/2026-08-02-lambda-beta-fusion-design.md`, which
proposes collapsing `beta`'s three passes into one walk. **`today()` and `lifted()` above are
deliberately untouched**: `closing` is paid by both sides of that ratio and cancels, and the 0.99x
it produced is a landed finding. The rows above are unchanged to the unit across the addition, which
is the evidence that the new columns moved nothing.

```text
program          steps    opening     spine   reshift   per_occ   closing   freevar   beta_today  fused_incr  fused_occ    win
nested lvl 1    109565      20725    296124      5921      8881     68089      8881       390859      310926     313886   1.26x
nested lvl 11   105607     190666    285574      5696      8549    236274      8549       718210      299819     302672   2.40x
two 500-lists       22          7        43         0         0         5         0           55          43         43   1.28x
699-literal       1398          0      5592         0         0         0         0         5592        5592       5592   1.00x
```

**and the two corpora disagree about the sign:**

## `crates/redextape-core/examples/shift_cost_probe.rs`, above `freevar: u64,`

and a slice that cannot attribute a null result is how four designs on this thread died.

## `crates/redextape-core/examples/shift_cost_probe.rs`, above `fn today(&self) -> u64 {`

THE LIFTED-REWRITE CONTEST, DELIBERATELY UNCHANGED. `closing` is paid by both sides and cancels, and
the 0.99x this ratio produced is a landed finding the roadmap quotes. Adding a term to both sides of
it would move a published number without adding information.

## `crates/redextape-core/examples/shift_cost_probe.rs`, above `fn census_run(t: &LambdaTerm, cap: u64) -> (SubstCensus, Option<redextape_core::lambda::Status>) {`

and this family is exactly what made an earlier run of it eat 60 GiB.

## `crates/redextape-core/examples/shift_cost_probe.rs`, above `line("");`

and is what made an earlier run of this family eat 60 GiB.

## `crates/redextape-core/examples/shift_cost_probe.rs`, above `line("");`

The roadmap's standing next λ slice is carrying `subst`'s per-binder re-shift down as one `shift(d,
0, ·)`. It was sized against `Σ abs×arg` = 70,542,349 corpus-wide — a STATIC model
(`lambda_sharing_probe.rs`'s `account`, `count_abs(body) × size_of(arg)`) written before either
short-circuit existed. This section prices the same rewrite against what the function now actually
allocates.

## `crates/redextape-core/examples/state_cost_probe.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

Sections F and G are the refutation: a balanced arithmetic tree of 6 KB — well inside `MAX_TOKENS`,
and reachable from the editor through `run_tm_described` — builds an 8.6 million state machine
costing 6.0 GB.

| section | question | what it fixes |
| --- | --- | --- |
| H | bytes per state | 700-725 B/state, measured as RSS delta at the row a fresh run can still reach (`size_of::<State>()` of 56 understates it ~13x); the historical 727 was measured at a row this file can no longer reach post-guard — see note below |
| A | how big can `code.len()` get from source | not `MAX_TOKENS` — `lower_asm`'s `MAX_LOWER_DEPTH` |
| B | states per instruction, by kind and encoding | 1 (`Halt`) to 571 (`Box`); `Call` scales with `n_loc` |
| C | the bisected `code.len()` ceiling | 3,472 — and only for depth-limited shapes |
| D | the largest machine a depth-limited program builds | 2.8M states, pre-guard — table in design doc §3.2 |
| E | the largest `NodeId` minted from source | 80,000, roughly one per token |
| G | what the SHIPPED demos cost | 49,135 states worst case — the floor a ceiling must clear |
| F | the balanced tree, which no depth guard bounds | the live OOM, pre-guard (see below) |

What a fresh run DOES still re-derive: 575,861 states at the 1,022-token row, at roughly 700-725
B/state (RSS delta is allocator- and machine-dependent; the spec's §3.1 table records **725** for
this row) — NOT 727.

so a fresh run cannot reproduce it, and neither can it reproduce the "stable across a 15x size
range" claim that rests on comparing the two rows. Also still reproducible: the 49,135-state worst
shipped demo, and the 80,000 max `NodeId`. The larger historical figures survive only in
`docs/superpowers/specs/2026-08-11-count-bounds-design.md` §3 and in the git history of the scratch
probe that produced them — this file cannot reach them again by design, and should not be made to.

## `crates/redextape-core/examples/step_survey.rs`, above `"let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n, 5)",`

Confirmed non-vacuous by sabotage (reverting `tail1`'s emitted name to the bare `"tail"`): the TM
diverges (`HitCap`) while reference and λ still agree.

## `crates/redextape-core/examples/step_survey.rs`, above `#[derive(Clone, Copy, PartialEq, Eq)]`

THE Critical finding of the review: one `Apply` bucket merges four populations with opposite
optimizer implications, and the merged number over-credits inlining by ~4.7x.

## `crates/redextape-core/examples/step_survey.rs`, above `fn print_width_reranking() {`

Step cost is affine in the width (`steps = a + b*W`) and the `b*W` term is 91–97% of the total at
64, so those shares are very nearly a ranking by `b` alone — by field-traversal cost. `run_tm` now
fits a narrower width per program, where the fixed term is a third of the cost rather than a
twentieth.

## `crates/redextape-core/examples/step_survey.rs`, above `let order = |s: &Shares| if s.dispatch > s.machine { "devirt > ABI" } else { "ABI > devirt" };`

and the ClosureScaffold half alone is barely half of it. Comparing the raw buckets would test a
margin of ~14pp instead of the real ~1pp.

## `crates/redextape-core/examples/step_survey.rs`, above `fn print_width_caveat() {`

An earlier draft of this survey asserted a mechanism here — that a traversal-eliminating pass (the
frame-restore ABI) would lose most of its measured win as fields narrow while an
instruction-eliminating one (devirtualization) kept its. That was reasoning, not measurement, and
the measurement contradicts its direction: the ABI share ROSE. Both pass targets rose, because the
buckets that shrink fastest under sizing are the user constructs, not the scaffolding.

## `crates/redextape-core/examples/width_report.rs`, above `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]`

That distinction is the reason this report supersedes the estimated table in
`docs/superpowers/specs/2026-07-26-per-program-field-width-design.md`. Those fitted widths were read
off answer agreement, which is an unsound detector: at width 4 the program `3 - 5` destroys a field
delimiter and still returns 0, and `0 + 5` merges two 4-cell fields into a 9-cell run and still
returns 5. The numbers below come from the guard instead, so some are one power of two higher.
