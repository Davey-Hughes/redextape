# Interpreter concurrency and parallelism — design

**Status: MEASURED, NOT IMPLEMENTED.** Raised 2026-08-01 as a question — *can the TM simulator or the λ
reducer be made faster with threads?* — and answered by measurement rather than by argument. **Five
schemes are rejected here, each with the number that rejected it.** What survives is two *sequential*
fixes for one shared defect — **TM run-length fusion** (§8.1) and a **λ reduction-context zipper** (§8.2) —
plus one genuine use of parallelism, **Plan 4/5 workers** (§9). Nothing in this document has been built;
§10 is the instrument it all depends on, and that has not been built either.

**Scope:** `redextape-core`, both step loops (`tm/sim.rs` + `trace::TmCursor`, `lambda/reduce.rs` +
`trace::LambdaCursor`). Zero new dependencies — and §3 and §6 are largely *about* why that constraint
costs nothing here. No printed byte moves. No semantics change: §8 is the only proposal that touches a
step loop, and it must be step-for-step observationally identical.

**Why this is a spec and not a roadmap note.** The rejections are the deliverable. Every one of these
schemes is a thing a reader will propose again — "just use rayon", "just use tokio", "TMs are basically
CPUs, speculate" — and re-deriving the refutation costs more than reading it. This is the same
treatment [`2026-07-31-lambda-shared-subterm-guard-design.md`](2026-07-31-lambda-shared-subterm-guard-design.md)
gives its three falsified guards. **§8.2 is a rejection too** — the λ analogue of §8.1's fusion was
measured and does not carry, and what replaces it is a different fix for the same underlying defect.

---

## 1. The one-sentence answer

**Both step loops are strict data-dependency chains, the per-step work is 12.84 ns, and the cheapest
cross-thread rendezvous is 2,171 ns — so every intra-run parallel scheme loses by two orders of
magnitude, and the wins that remain are sequential (§8) or live outside the interpreter entirely (§9).**

The dependency claim, stated precisely because everything else follows from it:

- **λ:** β-step *N+1*'s input term **is** β-step *N*'s output term. `LambdaCursor::next` replaces
  `self.current` wholesale.
- **TM:** δ-step *N+1*'s state and head cells **are** δ-step *N*'s output. `TmCursor::next` reads
  `self.cur` and all `TAPES` heads through `rule_matches`, then writes both.

Neither admits reordering. That is not an implementation artifact — it is what "simulate this machine"
means, and the project's premise (`README.md`: "what you see is the genuine computation") forbids
computing the answer by a route that skips the configurations.

## 2. Measured baseline (2026-08-01, 32 logical CPUs)

Program: the `map` entry from `FIRST_ORDER_DEMOS` —
`fn map(xs, f) { … } fn add1(x) { x + 1 } [3, 1, 2].map(add1)` — lowered through
`defunc` → `lower_asm` → `lower_tm_guarded` under `Unary::default()` (width `MAX_FIELD_WIDTH` = 64).
**Machine: 3,203 states, 5 tapes, 344,999 steps to halt.** All figures `--release`.

| quantity | measured |
|---|---|
| Full δ-step — state lookup + rule scan + both cap checks + `apply` over all 5 tapes | **12.99 ns** (77.0 M steps/s) |
| Upper bound on one tape's slice of `apply` (whole step ÷ `TAPES`) | 2.60 ns |
| One `std::sync::Barrier` rendezvous — k = 2 / 5 / 8 | **1,400 / 2,063 / 2,691 ns** |
| Non-atomic increment (≈ an `Rc` refcount bump) | 0.23 ns |
| `AtomicU64::fetch_add`, uncontended | 4.68 ns (**20.0×**) |
| `AtomicU64::fetch_add`, 8 threads contended | 8.11 ns (**34.6×**) |
| `simulate_trace` (adds `Tape::snapshot` per tape per step) | **1,011 ns/step** (**78×** untraced) |
| **One β-step**, step-weighted over the corpus (Part H) | **1,323 ns** — *~102× a δ-step* |

Timing method: 200 whole-run repeats (68,999,800 δ-steps in 896.0 ms) rather than a per-step timer, so
the figure is not a measurement of `Instant::now`. The δ-step figure reproduces at **12.5–13.0 ns** across
runs on this host; nothing below turns on a difference that small, and every ratio is computed inside one
run rather than across them.

**One consequence worth stating separately, because it corrects an intuition.** At 77.9 M steps/s the
`DEFAULT_CAPS.steps` cap of 5,000,000 is reached in **64 ms**. A capped *untraced* TM run is not a UI
hazard. The 4.8-second figure people will reach for is the *traced* path (5M × 964 ns), and the UI does
not use it — `trace::TmCursor` exists precisely so "a renderer never holds the whole run". The λ side is
where the seconds are (`shift_cost_probe`: 7.48 s for one nested-group reduction), and §9 is about that.

## 3. Rejected: parallel `apply` over tapes, via thread pool or async runtime

The shape that invites it: `sim::apply` loops over `TAPES` tapes, and the iterations are independent —
each writes its own head and moves its own zipper.

**The number that rejects it: 2,063 ns against 12.99 ns.** The barrier alone is **159× the entire step
it would be parallelizing** — and it is not an artifact of picking k = 5:

| k | ns/barrier | × δ-step | break-even work per step |
|---|---|---|---|
| 2 | 1,400 | 108× | 2,800 ns (**216×** today's step) |
| **5** (`TAPES`) | **2,063** | **159×** | **2,579 ns (199× today's step)** |
| 8 | 2,691 | 207× | 3,076 ns (237× today's step) |

**A thread pool does not address this.** A pool removes thread *creation*, which was never the cost. The
irreducible cost is the **rejoin**: `rule_matches` reads all `TAPES` heads, so step *N+1* cannot begin
until every tape from step *N* is written. That rendezvous is required once per step, and it is the
2,063 ns. A tuned spin-barrier does better than `std::sync::Barrier` — but even an optimistic 200 ns
floor for five cores is 15× the step.

**Break-even, so the gap is a number and not a vibe.** A k-way split pays off when `W/k + barrier < W`,
i.e. `W > barrier · k/(k−1)`. At k = 5 that is `W > 2,579 ns` against a current `W` of 12.99 ns. **The
work per step would have to grow ~200×** — and note the *narrow* row, k = 2, is no kinder: fewer threads
means a cheaper barrier but a worse `k/(k−1)`, so the requirement barely moves.

**An async runtime is strictly worse, and for a reason that is not about speed.** Async exists to hide
*blocking* — a task that yields while something external completes. There is nothing external here: no
I/O, no locks, no waiting, just arithmetic on resident data. A multi-threaded executor pays the same
rendezvous plus per-poll dispatch and a `Send + 'static` requirement that `&mut [Tape]` cannot satisfy
without rewriting the ownership model. A single-threaded executor gives interleaving, which is not
parallelism and buys nothing for pure CPU work. **Async is the wrong tool by category, not by margin.**

**The one place with the right shape still loses, and this is the strongest form of the result.**
`Tape::snapshot()` is the only genuinely O(cells) per-tape operation in either interpreter — it clones
`left`, pushes the head, and extends with `right` reversed — and `simulate_trace` pays it per tape per
step, which is the whole 1,011 ns. Five independent tapes, real work in each. Split it *perfectly*:
`1011/5 + 2069 = 2,271 ns` against `1,011 ns` sequential. **2.25× slower.** Even the most favourable
operation in the codebase does not clear the barrier.

The correct fix there is sequential and already available: do not snapshot. `TmCursor` steps lazily and
hands out `&[Tape]`; `simulate_trace` is the API that promises the full history by contract, and callers
that only walk forward should not be using it. Compare `simulate_counts`, which exists for exactly this
reason ("counting a 178k-step program through [a trace] would allocate 178k tape snapshots").

**Not rejected, and left explicitly open:** parallelism across *independent runs* — the width sweeps
(`tm_width_equivalence`, `step_survey`, `width_report`) run the same program at many widths, and the
oracle runs one corpus across five backends. Those are embarrassingly parallel and correct to
parallelize. They are also **already parallel and already fast** (§7), so there is nothing to do.

## 4. Rejected: speculative execution over δ-steps

The proposal: predict the next rule from a per-state history, apply it to the tapes speculatively,
validate, and squash on a miss — a branch predictor for the simulator.

**Why CPU speculation pays and this does not: a latency asymmetry that is absent here.** A CPU
speculates past a branch whose condition needs a load that may miss to DRAM (~300 cycles) while the
instructions it runs ahead cost ~1 cycle each. It converts a long *dependency* into overlapped *work*.
In `TmCursor::next` the thing you would speculate on (which rule matches) and the work you would
speculate past (applying it) **are the same size** — the rule scan is a large fraction of the 12.84 ns.
You would speculate past ~5 ns to save ~5 ns, and pay rollback bookkeeping for the privilege.

**And the dispatch is not the problem, which is the part that surprised the investigation.** The
measurement was taken expecting the classic interpreter-dispatch failure and found the opposite:

| | measured |
|---|---|
| States in the machine | 3,203 |
| Distinct states actually visited over 344,999 steps | **3,100** |
| Share of all steps covered by the 10 hottest states | **1.3%** |
| Rules per state | mean 2.45, max 4 (dynamic mean 2.94) |

Maximal target entropy from a single indirect-dispatch site — a branch-target buffer should be helpless.
**It is not**, because of §8: steps arrive in long same-state runs, so last-target prediction hits ~97%.
The hardware is already predicting this workload correctly. There is no misprediction to recover.

## 5. Rejected: parallel or speculative β-reduction

Unlike §4 this one is *sound in theory*, which is why it needs a written refutation rather than a
dismissal. Parallel graph reduction, Lamping/Asperti optimal reduction and interaction-net machines all
exploit that soundness.

**Confluence, stated exactly, because the whole rejection turns on what it does and does not give.** A
term generally has several redexes, and reducing different ones yields different terms. Write `→` for one
β-step and `→*` for zero or more.

> **Confluence (Church–Rosser).** If `t →* t₁` and `t →* t₂`, then there is some `t₃` with `t₁ →* t₃` and
> `t₂ →* t₃`. Any two divergent reduction paths can always be rejoined.

Its corollary is **uniqueness of normal forms**: a normal form has no redex, so it cannot reduce further;
if `t₁` and `t₂` are both normal forms, rejoining forces `t₁ = t₃ = t₂`. **A term has at most one normal
form, and no choice of redex can change which one.** That is what makes a parallel reducer *sound* — two
workers reducing different redexes cannot produce conflicting answers.

**What confluence does not give is reachability, and that gap is this section's second blocker.**
Uniqueness says the paths that *reach* a normal form all reach the same one. It says nothing about whether
a given path reaches one at all. `(\x. \y. y) Ω` has a normal form (`\y. y`); leftmost-outermost discards
`Ω` unreduced and terminates, while reducing `Ω` first never terminates. Both are legitimate β-reduction
sequences, and confluence is satisfied vacuously — the non-terminating path simply never arrives.
Reachability is the separate standardization/normalization result, and **that** is the one saying normal
order finds a normal form whenever one exists. `lambda/reduce.rs`'s module header makes the same point
about why the strategy is required rather than chosen: "correct prior knowledge points the wrong way
exactly where these docs were silent."

**Blocker 1 — the step sequence is the product, not a means to it.** `reduce::Step` is
`{ term, redex: Path }`, and `sourcemap` maps that path back to a `NodeId`. Parallel reduction yields a
*partial order* over redexes, not a sequence. There would be nothing to scrub, nothing to sync to the
source pane, and no answer to "which redex is next" — which is the question the visualizer exists to
answer.

**Blocker 2 — and this one is severe: speculating off the leftmost path speculates into Ω by
construction.** `lambda/reduce.rs`'s module header documents three constructs this backend emits that
diverge unless normal order avoids them, each sufficient alone:

1. `Core::If` lowers to `app(app(cond, then), else)` — **both branches are unthunked arguments.**
2. The fixpoint is the **call-by-name Y**, `\f. (\x. f (x x)) (\x. f (x x))`.
3. `head`/`tail` pass `DIVERGE = (\x. x x) (\x. x x)` **unconditionally** as the nil branch.

A speculative worker that picks a non-leftmost redex in `head(cons(7, nil))` picks Ω. That is not a
mispredict you squash on the next cycle — **the speculative thread never returns.** Bounding it requires
a per-speculation work budget, which is precisely the guard shape that has now been designed and
falsified three times (see the shared-subterm design's §10). **Speculation here does not risk being
slower; it risks being the hang this project already spent two slices closing.**

## 6. Rejected: `Rc` → `Arc` in `lambda/term.rs`

Any thread-level scheme touching λ terms needs this first: `LambdaTerm` is `LambdaTerm(Rc<Node>, u32, u32)`
and `Rc` is not `Send`.

**The number: 4.68 ns against 0.23 ns — a 20.0× tax on refcount bumps, 34.6× under contention.**

**And it lands exactly on the operation the 2026-08-01 fix made hot.** After
[`2026-07-30-lambda-structural-sharing-design.md`](2026-07-30-lambda-structural-sharing-design.md) and the
`shift`/`depth` fixes, the reducer's fast paths *are* refcount bumps:

- `subst`'s `Var` arm is `s.clone()` — "a refcount bump, where under `Box` this deep-copied the whole
  substituted argument once per occurrence. That single line is a large share of the win."
- Both `maxfree` short-circuits return `t.clone()`, preserving the allocation.
- `reduce_step`'s `App` arms clone the untouched sibling — "the cost this representation exists to
  remove."

The two-list counterexample went **19.0 s → 0.002 s** on the strength of those clones being nearly free.
Making every one of them an atomic RMW taxes the fix at its point of maximum leverage, to enable schemes
§3 and §5 already reject on independent grounds.

**Corollary for the WASM path (§9), and it is a happy one.** Workers do not share a heap by default —
they pass messages. §9's design posts `StepEvent`s across the boundary and keeps each interpreter's terms
thread-local, so it needs no `Arc` at all. **The parallelism that survives is the parallelism that does
not need shared mutable terms.**

## 7. Not a target: test-suite and oracle parallelism

Checked so it is not re-proposed. `cargo nextest run -p redextape-core --release`: **646 tests, 1.976 s
wall on 32 logical CPUs.** The whole 46-program three-way oracle
(`three_way_oracle_on_the_first_order_suite`, which loops `FIRST_ORDER_DEMOS` serially inside one
`#[test]`) is **0.218 s** — splitting it per-program would save fractions of a second inside a 2-second
suite.

This is the work [`../plans/2026-07-28-test-suite-parallelism.md`](../plans/2026-07-28-test-suite-parallelism.md)
already did, and its `tm_bank_invariant` split is why the tail is flat. **These numbers are not comparable
to that plan's 231.7 s baseline** — different profile and a different machine (12 logical CPUs) — and are
recorded here only to close the question for the release profile on this host, not to restate its result.

**The caveat that does apply, from the λ probes rather than the tests.** Running probes in parallel
multiplies peak RSS by the fan-out. `shift_cost_probe.rs` carries memory-cap rules in its module docs for
a reason — one λ measurement has cost 60 GiB of RAM and all swap. **A parallel probe sweep must size its
per-process cgroup cap at `total / N`, not hand each worker the single-run cap.** This is the one place in
this document where adding parallelism can make something actively worse rather than merely not better.

## 8. THE INTERPRETER WINS: kill the per-step recomputation (sequential, both loops)

**Both interpreters carry the same defect, and it is the one this codebase has now hit three times:
recomputing per step a quantity the previous step already knew.** `depth_exceeds` walked the logical tree
every step until `depth` was stored on the handle — 187.6 s of level 11's 195.7 s was that one function,
and storing it took the level to 7.48 s. `TmCursor::next` still re-sums `Tape::cells` every step. What
follows is the same class in each step loop — **but the two want different fixes, and §8.2 is where the
analogy breaks.**

### 8.1 TM: run-length fusion — and the encoding decides whether it pays

**Measured over the whole 46-program corpus under both encodings** (16.2 M δ-steps), not one program:

| encoding | programs | δ-steps | **mean run** | longest run | steps in a run ≥2 | **strictly fusable** |
|---|---|---|---|---|---|---|
| `Unary` | 46 | 7,128,311 | **38.56** | 77 | **99.3%** | **96.9%** |
| `Binary` | 46 | 9,045,208 | **7.77** | 1,431 | 88.5% | 86.0% |

*Strictly fusable* = the share of steps repeating the immediately preceding **(state, rule)** pair — the
transition that can actually be bulk-applied, not merely the same state reached by a different rule.

**Under `Unary` this is overwhelming and the single-program figure was representative** — mean run 38.56
against `map`'s 37.09, 99.3% either way. The sweeps are field traversals: on `map` the longest run was
65 = `MAX_FIELD_WIDTH` + 1, a full field plus its `#` delimiter, and they are the simulator-side view of
the 92–97% padding share `width_report`'s Part A attributes to width.

**So the waste is not misprediction (§4) — it is re-dispatch.** For a 38-step sweep the interpreter runs
the full `TmCursor::next` preamble 38 times: `states.get`, the accept check, the step-cap check, the
`iter().map(Tape::cells).sum()` cells-cap check, and a 2.94-rule linear scan — to perform 38 identical
one-cell moves.

**The optimization.** When the matched rule self-loops (`rule.next == state`), scan forward for the first
cell that fails the read pattern, and apply the whole run as one bulk operation — a `Vec` splice on the
zipper rather than *n* `push`/`pop` pairs.

**`Binary` is where the estimate stops being comfortable, and this is the finding the one-program
measurement hid.** Its mean run is **7.77, five times shorter**. Model a fused operation as costing `c`
ordinary steps: a run of length `R` goes from `R` steps to `c`, so the speedup is roughly `R/c` on the
fused fraction. At `c = 10` — the pessimistic constant this document previously used to reach "~3.7×" —
`Unary` gives ~3.9× and **`Binary` gives 0.78×, a net loss.** At a more plausible `c ≈ 2–3` for a scan
plus a `Vec` splice, the two are ~13–19× and ~2.6–3.9×.

**So the honest statement is that `c` decides it, not `R`**, and `c` is a property of an implementation
nobody has written. **A fusion slice must measure `c` on a prototype before committing**, and must report
both encodings — a change tuned on `Unary` and silently regressing `Binary` would still leave every
oracle green, because fusion is semantics-preserving by construction. (`Binary`'s longest run of 1,431
also says the run-length distribution there is far more skewed than `Unary`'s, so a mean is a poor summary
of it; a slice wants the histogram, which is a one-line change to Part E.)

**Non-negotiable constraint: the emitted step sequence must not change.** `TmCursor` computes in bulk and
*replays* the individual `StepEvent::Delta`s, so `simulate_counts`, `simulate_trace`, every golden step
count and `tm_bank_invariant`'s per-step watcher all see exactly what they see today. A macro-step event
may be worth adding later as a *rendering* choice — scrubbing 64 identical cell-moves is poor UX — but
that is a Plan 5 decision and must not be smuggled in as an optimization.

**Two free adjacent cleanups, same class:**

1. `TmCursor::next` recomputes `self.tapes.iter().map(Tape::cells).sum()` every step. `Tape::step` knows
   when it grows. Maintain the total incrementally.
2. `state.rules.iter().position(|r| rule_matches(…))` is a linear scan. At mean 2.45 rules this is small,
   but a precomputed dispatch table keyed on the read tuple removes it entirely.

Neither is worth a slice alone; both are worth doing inside this one.

**Confidence: the distribution is measured and exact; every speedup number above is a model.** The
speedup depends on `c`, and `c` depends on an implementation that does not exist. **No slice may quote a
figure from this section** — this document's own §4 is what happens when the expected result and the
measured one disagree, and §8.1's own history is what happens when one program is generalized: "~3.7×
across the board" survived exactly as long as it took to run the second encoding.

### 8.2 λ: NOT fusion — a reduction-context zipper

**The direct analogue was measured over the whole corpus and it does not carry.** The TM's unit of
repetition is "same state"; the λ equivalent is "same redex path". Over **5,955 β-steps across every
corpus program the λ backend accepts**:

| | corpus (all) | deepest program (#9, `sum(5)`) | shallowest shown (#30) |
|---|---|---|---|
| β-steps | 5,955 | 626 | 25 |
| Mean redex-path length | 9.27 | 19.63 | 3.36 |
| **Same-path runs ≥ 2** | **34.9%** | 46.2% | 40.0% |
| **Mean run length** | **1.22** | 1.30 | 1.32 |
| Consecutive root redexes | 1.3% | 0.0% | 8.0% |
| **Descent retracing the previous path** | **93.7%** | **97.2%** | 78.6% |

**Read the two bold middle rows against §8.1's `Unary` figures — 99.3% at mean run 38.56.** λ's same-path
runs average **1.22 steps**. There is nothing to fuse: the redex *moves* after almost every step, which is
exactly what normal-order reduction over a term being rewritten should do. **Run-length fusion is a TM
optimization, not an interpreter optimization** — and unlike §8.1's positive result, this negative one is
already corpus-wide, which is why it is stated with more confidence than the thing it is contrasted with.

**And the other obvious guess is deader still: 1.3% consecutive root redexes.** So n-ary β — collapsing
`(\a.\b.\c. body) x y z` into one multi-argument substitution, the trick Krivine/SECD-style machines get
for free — has essentially no surface in terms this backend emits.

**The last row is the real finding, and it is the same defect wearing different clothes: 93.7% of all
descent retraces the path the previous step already walked.** `LambdaCursor::next` calls
`reduce_step(&self.current)` from the **root** every step, so it re-descends ~9.27 nodes to find a redex
that is usually a sibling of the last one — and `reduce_step`'s `App` arms rebuild the spine on the way
back up (`app(f2, a.clone())` per level), so the retraced prefix is **re-allocated** too.

**The fix is a zipper, not a fusion**: carry the reduction context — the spine from root to the current
redex — as an explicit stack across steps, popping when the next redex lies higher and pushing when it
lies deeper. This is the shape a Krivine machine has natively and `reduce_step` does not.

**Three things a slice here must handle**, none of which the TM version faces:

1. The redex can move **up**, not just down, so the context stack must pop; a descent-only cache is wrong.
2. `LambdaCursor::term()` must still hand back the whole term (`reduce_trace` snapshots it per step **by
   contract**). The zipper must rebuild on demand rather than maintain the root eagerly, or it just moves
   the cost.
3. `Step.redex: Path` is consumed by `sourcemap`, so the path must still be produced exactly as today.

#### And then Part H measured the denominator, which argues for doing this LAST

**A β-step costs 1,323 ns, step-weighted across the corpus — about 102× a δ-step**, ranging from 303 ns to
15,034 ns. That is the number §8.2 is a fraction of, and it reframes the 93.7%.

The retraced work is ~8.7 spine nodes per step (9.27 × 93.7%). Against a 1,323 ns step, a zipper is
recovering a **single-digit percentage at best** — the exact figure depends on the per-level cost of a
`reduce_step` frame plus one `app()` allocation, which is unmeasured. **The 93.7% is a large share of a
small thing.** `subst`, which rebuilds the spine of whatever it descends into, is where the 1,323 ns
actually lives, and a zipper does not touch it.

**So the recommendation inverts the order this section was drafted in.** ~~The roadmap's standing λ target —
carrying `subst`'s per-binder re-shift down as one `shift(d, 0, ·)`, with a shift-additivity lemma already
verified exhaustively (53,376 cases) and a differential already run (355,840 triples, 0 mismatches) —
attacks the dominant cost and is *already designed*. **That should land first.**~~ §8.2 is real, correctly
diagnosed, and small; it is worth doing after the measurement it would then be a visible fraction of, not
before. This is open question 6, and Part H is what answered it.

> **THE TARGET NAMED HERE WAS FALSIFIED 2026-08-02 AND WILL NOT LAND.** The lifted-shift rewrite is a
> **0.99x regression** on the nested-group family; it was sized against a static counter that
> over-reports the cost it deletes by ~1,584x. The lemma and the differential above are both still valid
> — what was wrong is the sizing, not the algebra. See the roadmap's **"CLOSED 2026-08-02"** block and
> the perf design's §10.
>
> **WHAT THIS DOES TO §8.2's ORDERING ARGUMENT, which is the part that matters here.** The reasoning was
> "the λ target attacks the dominant cost, so do it first and re-measure §8.2 against the smaller
> baseline." Nothing is landing first. §8.2's 93.7% is still "a large share of a small thing" and the
> sentence above it — **`subst`, which rebuilds the spine of whatever it descends into, is where the
> 1,323 ns actually lives** — is now the *measured* finding rather than the aside it was written as:
> `Σ spine` plus `Σ path` is ~52% of every allocation the reducer makes. So §8.2 stays deferred, on
> stronger evidence than it was deferred with, and against a baseline nobody should now expect to shrink.

## 9. Where real parallelism belongs: Plan 4/5 workers

The project's premise supplies the one genuine task-parallel opportunity in it: **the λ reduction and the
TM simulation of the same Core are wholly independent computations.** Nothing flows between them; they
are compared only at the end, by the oracle. Two Web Workers, one per model, is real parallelism and it
is free of every objection in §3–§6 — no shared terms, no barrier per step, no `Arc`.

Three things this buys, in descending order of importance:

1. **Getting the reducer off the UI thread at all.** This is latency, not throughput, and it is the
   reason to do it. `MAX_REDUCTION_STEPS` is 5,000,000 and one nested-group λ reduction is 7.48 s
   (`shift_cost_probe`). On the main thread that is a frozen tab.
2. **Both panes advancing independently**, which is what "watch the Church–Turing thesis happen" asks for
   — neither model's step rate gating the other's.
3. **Run-ahead buffering.** A worker steps the cursor ahead of the scrub position while the user watches
   at human speed. This is the CPU analogy that *does* hold — it is a **prefetcher, not a speculator**.
   The sequence is deterministic, so it never squashes, and it is pure latency hiding.

**`trace` is already shaped for this.** `LambdaCursor` and `TmCursor` are lazy `Iterator`s over a shared
`StepEvent` vocabulary, and the design already states that "a renderer never holds the whole run". The
worker boundary wants `StepEvent`s posted across it, not terms — which is the interface that already
exists.

**One caveat carried forward.** `MAX_TERM_DEPTH`'s doc notes it is "effective only when the running
thread's stack is large enough (WASM shadow-stack sizing is a Plan 4 follow-up)". A worker does not
resolve that — the shadow stack is still a link-time size — but it does change the failure mode from
killing the tab to killing the worker, which is strictly better and recoverable.

## 10. The instrument — `examples/concurrency_probe.rs`, landed with this document

**Every figure in §2, §3, §4, §6 and §8 comes from one run of
`crates/redextape-core/examples/concurrency_probe.rs`**, committed alongside this spec so the tables are a
repro rather than a quotation — the discipline `list_reduction_probe.rs`, `blowup_probe.rs`,
`guard_hole_probe.rs` and `shift_cost_probe.rs` all exist to enforce. Run it as its module docs say:

```text
systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
  cargo run --release -p redextape-core --example concurrency_probe
```

**`--release` is load-bearing, not hygiene:** every figure is a timing and the whole argument is a ratio
between a ~13 ns step and a ~2,000 ns rendezvous, only one of which an unoptimized build moves. The memory
cap is `shift_cost_probe.rs`'s rule, for the same reason — Parts G and H reduce real λ terms.

**Writing it changed two of this document's conclusions**, which is the argument for the discipline rather
than a mishap: the corpus run put `Binary`'s mean run at 7.77 against `Unary`'s 38.56 (§8.1, where a
single-program "~3.7×" had been generalized), and Part H's 1,323 ns β-step made §8.2 a single-digit-percent
lever rather than a headline one. Neither was visible from the throwaway harness the first draft used.

Its parts, lettered as the file is:

- **A.** ns per δ-step, from *N* whole-run repeats of a named corpus program (not a per-step timer).
- **B.** *k*-thread barrier cost and the derived break-even work-per-step, so §3's 211× is re-derivable.
- **C.** Non-atomic vs. uncontended vs. contended RMW, for §6's 20.1×/37.1×.
- **D.** Dispatch profile: states visited, top-10 step share, static and dynamic rules/state.
- **E.** Same-state run-length distribution — count, mean, max, share in runs ≥ 2 — which is §8.1's whole
  case and the only table a fusion slice is calibrated against.
- **F.** `simulate_trace` ns/step against untraced, for §3's snapshot result.
- **G.** λ redex-path profile over `FIRST_ORDER_DEMOS`: β-steps, mean/max path length, same-path run
  share and mean run length, consecutive-root-redex share, and **retraced-descent share** — §8.2's table.
  The first four exist to keep the *negative* results falsifiable: if same-path runs ever approach the
  TM's 99.3%, §8.2's conclusion flips and fusion becomes a λ optimization after all.
- **H.** ns per β-step, from whole-reduction repeats — the denominator §8.2 is a fraction of.

Parts E and G stream `TmCursor`/`LambdaCursor` rather than `simulate_trace`/`reduce_trace`: Part F prices
the snapshot at 78× the step, so measuring the distribution through it would have measured the instrument.
The file reports the host's logical CPU count and whether it was built in release, since §2's numbers are
meaningless without both.

**What it does not yet do**, both one-line changes and neither blocking: a run-length *histogram* rather
than a mean (§8.1 — `Binary`'s longest run of 1,431 against a mean of 7.77 says that distribution is
skewed enough that a mean misleads), and a `c` measurement against a fusion prototype, which cannot exist
before the prototype does.

## 11. Open questions

1. **ANSWERED, and partly in the negative — it was a `Unary` artifact in the part that mattered.**
   `Unary` generalizes cleanly (mean run 38.56 corpus-wide against `map`'s 37.09, 99.3% either way), but
   `Binary`'s mean run is **7.77** — five times shorter, with a far more skewed distribution (longest
   1,431). The *distribution* claim survives; the *speedup* claim did not, and §8.1 now turns on the
   fused-op constant `c` rather than on the run length. **Remaining:** measure `c`, and report a
   histogram rather than a mean for `Binary`.
2. **Does fusion interact with the overflow guard?** A fused run must not skip past the state
   `lower_tm_guarded` hands back, or a program that should report `Overflow` reports a value.
   `tm_bank_invariant`'s per-step watcher is the existing check and must be run against a fused cursor
   unedited.
3. **Is `Tape`'s zipper the right representation for bulk moves?** Fusing a rightward sweep is
   `left.extend(right.drain(..n).rev())`-shaped. Whether that beats *n* `push`/`pop` pairs by enough to
   matter is unmeasured, and it is the entire mechanism.
4. **§8.1's cleanup 1 changes when the cells cap fires** if done carelessly — an incrementally maintained
   total must agree with the recomputed one *exactly*, including on the step that trips the cap.
   `cells_cap_stops_unbounded_tape_growth` is the existing pin and is not sufficient alone.
5. **Does a λ zipper survive `MAX_TERM_DEPTH`?** The guard exists because `reduce_step`/`shift`/`subst`
   recurse once per node and would otherwise overflow the native stack. An explicit context stack moves
   *one* of those three off the native stack and not the other two, so the guard is still needed — but
   whether its accounting still means the same thing against a zipper is unchecked.
6. ~~**ANSWERED: no — do the `subst` re-shift first.**~~ **RE-OPENED 2026-08-02, and the answer now
   points the other way.** Part H puts a β-step at **1,323 ns** (still valid — measured after the `shift`
   fix, and the corpus independently prices a step at ~1,243 ns today). What was wrong is the
   denominator: "~8.7 retraced spine nodes are a single-digit percentage" divided them into a per-step
   node count taken from `Σ abs×arg`, a static counter that over-reports by **~1,584x**. Against the
   measured accounting a β-step allocates **~31.8 nodes**, of which **`Σ path` is ~9.3 — 29.2% of nodes
   and 36.2% of fitted time, the largest single allocating traversal in the corpus.** Same 8.7 nodes,
   right denominator. The `subst` re-shift that was to go first is falsified and will not be built.
   **Remaining, and it is the same gap as before:** the exact zipper share is still unmeasured. A zipper
   *changes* what the spine rebuild costs rather than deleting it, so the saving is a fraction of 36.2%
   and bounding it still needs the per-level cost of a `reduce_step` frame plus one `app()`, which Part H
   does not isolate. `examples/lambda_sharing_probe.rs` is repaired and can now answer it.
7. **Why is a β-step ~102× a δ-step?** Not a defect claim — the two do incomparable work — but the ratio
   is unexplained, it spans 303 ns to 15,034 ns across the corpus, and the outliers are where `subst`
   rebuilds most. Whatever explains the spread is likely the same thing item 6 is pointing at.
