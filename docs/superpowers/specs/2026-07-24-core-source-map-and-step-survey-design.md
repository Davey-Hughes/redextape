# Core source map + TM step survey

**Status:** design approved, ready for an implementation plan.
**Date:** 2026-07-24.
**Predecessors:** [optimizer Tier C](2026-07-24-tier-c-opt-measurement-design.md), [native Phase 2 (LLVM)](2026-07-24-native-llvm-phase2-design.md).
**Successor:** the Tier A pass set, which this slice exists to choose *on evidence*.

## Why this slice exists

The roadmap's **Tier A** (Core→Core optimization) is the highest-leverage remaining work: a pass there
helps λ *and* TM *and* both native backends, because it runs before every backend split. But the
roadmap also says to apply YAGNI hard — "add a pass only if it helps demos fit under caps or reads
more clearly."

That instruction cannot be followed today, because **nothing in the repo can say where the cost
actually goes.** `Instr` carries no `NodeId`, so the Core→asm lowering drops the source map and TM
steps cannot be attributed to the constructs that caused them. Choosing passes from the textbook list
would be guesswork.

Tier C's lesson applies directly: build the measurement first, then act on it. This slice builds the
measurement.

**Two questions must be crossed to pick a pass well, and they are different questions:**

- **Where the cost is** — dynamic, per construct, weighted by real TM steps.
- **What a pass would recover** — static and counterfactual; a dynamic profile cannot tell you whether
  constant-folding would fire, only that arithmetic is hot.

The corpus is therefore split to answer both (§6).

## Non-goals

- **No Tier A pass is written in this slice.** The output is evidence and a ranked recommendation.
- **No native-backend provenance.** TM steps are the measurable (unary arithmetic makes them
  meaningful and deterministic); native offers only noisy wall-clock. The map stops at the TM.
- **No change to the TM text format**, and no change to `Program`/`Machine` equality — see §1.
- **No change to what any existing backend computes.** This slice adds observation only.

---

## 1. Provenance is a returned artifact, not a struct field

`Program` and `Machine` both derive `PartialEq`, and the TM text round-trip test asserts
`parse_tm(print_tm(m)) == m`. Adding a side-table *field* would break that test (a reparsed machine
carries no origins) and any `Program` equality in the asm goldens.

So the lowering **returns** the map alongside its existing output:

```rust
// tm/lower_asm.rs
pub fn lower_asm_mapped(core: &Core) -> Result<(Program, Vec<NodeId>), LowerError>;
pub fn lower_asm(core: &Core) -> Result<Program, LowerError>;   // = lower_asm_mapped(core).map(|(p, _)| p)
```

`origins` is parallel to `program.code` — `origins[i]` is the `NodeId` that produced `code[i]`.

**`lower_asm` MUST be implemented in terms of `lower_asm_mapped`**, so there is exactly one lowering
implementation and the mapped and unmapped paths cannot drift. This is the whole reason the artifact
shape is safe; a second parallel implementation would reintroduce the drift risk it avoids.

The TM builder gets the same treatment, returning `Vec<usize>` mapping each state index to the asm
index it was built from.

**Consequences:** zero blast radius. No equality change, no golden change, no round-trip breakage,
every existing consumer compiles untouched.

## 2. Every instruction has an origin — no `Option`

`lower_asm` is a recursive descent over `Core`, so "the node currently being lowered" is always
well-defined. Instructions with no direct source analogue — jumps, frame setup, prologue/epilogue —
attribute to their **enclosing** construct. A branch emitted while lowering an `If` bills that `If`.

This makes the map total, avoids threading `Option<NodeId>` through the lowering, and produces the
attribution a reader actually wants (the cost of a loop should include the loop's own branching).

## 3. `defunc` preserves source ids, and declares what it synthesized

`defunc` rewrites Core→Core with fresh ids from `NodeGen::seeded(max_id + 1)`. Left alone, every
higher-order program would attribute its cost to synthesized nodes — and higher-order programs are
exactly where TM costs are largest.

- Where a rewritten node **derives from** a source node, it carries that node's id.
- Genuine scaffolding — `$applyN` dispatchers and their internals — gets fresh ids.
- The pass **returns the set of synthetic ids** it minted — via the same artifact discipline as §1:
  `defunc_mapped(&Core) -> Result<(Core, BTreeSet<NodeId>), LowerError>`, with the existing
  `defunc(&Core) -> Result<Core, LowerError>` reimplemented as `defunc_mapped(core).map(|(c, _)| c)`.
  `defunc` has callers in `run_tm`, native's `lower_program`, and several test modules; none of them
  should have to change, and there must be exactly one implementation so the two cannot drift.

The survey uses that set to bucket steps as *attributable to source construct X* versus *closure
scaffolding*. Without the split, the report would attribute cost to ids that do not exist in the
user's program — misleading in precisely the way this project's reviews keep catching. The
scaffolding bucket is real information, not a residue: it says what defunctionalization itself costs.

## 4. The correctness invariant

A source map that is silently wrong is worse than none. Attribution must be **exhaustive and
non-overlapping**:

> **Σ (steps attributed to each `NodeId`, plus the scaffolding bucket) == the total step count the
> simulator reports.**

Every step lands in exactly one bucket. This single assertion catches dropped instructions,
double-counted states, and off-by-one index errors, and it is cheap enough to check on every corpus
program.

It is backed by a **sabotage test**: perturb the mapping (e.g. shift `origins` by one) and confirm the
invariant fails. A guard that cannot fail is the defect class this project has repeatedly shipped and
then had to fix; this one is proven to bite before it is trusted.

Additional checks: every origin id is present in the post-`defunc` Core or in the declared synthetic
set (no dangling ids), and a hand-checkable program (a bare `2 * 3`) attributes its arithmetic steps
to the `BinOp` node.

## 5. Counting without materialising a trace

`simulate_trace` records per-step state, tapes, and head position. A 178k-step `sum(5)` trace holding
tapes per step is far too heavy merely to count steps.

The simulator gains a **counting mode** that accumulates per-state step counts into a
`Vec<u64>` indexed by state, with no per-step allocation. Composition is then pure index arithmetic:
per-state counts → asm index → `NodeId` → histogram.

Totality is inherited, not re-derived: the mapped lowering keeps `lower_asm`'s existing depth guard,
and the counting simulator keeps the existing `TmCaps`. A program that hits a cap yields a partial
histogram, which the report must label as such rather than presenting truncated counts as complete.

## 6. The corpus — two parts, answering two questions

**Part A — the existing oracle/demo corpus.** The programs already exercised by `three_way_oracle`
and the TM goldens. They are known TM-feasible, already agree across every leg, and several have
committed step-count goldens the survey can be cross-checked against. This answers *where the cost
actually goes*, with no new judgement about what is representative.

**Part B — a handful of single-purpose probes.** Each isolates one candidate pass's opportunity, so
the survey can measure what that pass could recover rather than inferring it:

| Probe | Candidate pass |
|---|---|
| literal-heavy arithmetic | constant folding |
| `x + 0`, `x * 1`, `x * 0`, `if true` | algebraic identities |
| a binding never read | dead-code elimination |
| an immutable binding used repeatedly | constant/copy propagation |
| a repeated subexpression | common-subexpression elimination |
| a small non-recursive call | inlining |

**Every probe must fit under `TM_DEFAULT_CAPS`.** TM arithmetic is unary and `sum(5)` alone is ~178k
steps of a 5M budget, so probes stay small — this is a hard sizing constraint, not a style preference.
The probes are *diagnostic*, not a benchmark suite: each exists to answer "what would this pass
recover here," and is measured by hand-writing the optimized form and comparing step counts.

## 7. The report

An example — `cargo run --example step_survey` — sibling to `opt_report`/`native_demo`, printing:

- **Per corpus program:** total TM steps, and the top Core constructs by attributed steps, each shown
  as **construct kind + `NodeId` + share of total** (e.g. `BinOp(Mul) #42 — 61%`). Note the honest
  limit: `Core` nodes carry a `NodeId` but no source span, so the report identifies a construct by
  kind and id, not by line and column. Mapping ids back to source text would need the parser's span
  table threaded through desugaring — a larger change, deliberately out of scope here, and not needed
  to rank passes.
- **The scaffolding bucket**, separately, so defunctionalization's own cost is visible.
- **Per probe:** steps for the written form versus the hand-optimized form, i.e. what that pass could
  recover.
- **A cap notice** where a program did not run to completion, so partial data is never read as total.

The report is the artifact a human reads to choose the Tier A pass set. It asserts nothing about
timings and gates nothing.

## 8. What the tests assert

1. **The exhaustiveness invariant** (§4) on every corpus program.
2. **The sabotage test** proving the invariant can fail.
3. **No dangling origin ids** — every id is in the post-`defunc` Core or the declared synthetic set.
4. **A hand-checked attribution** — `2 * 3` bills its arithmetic to the `BinOp` node.
5. **`lower_asm` is unchanged in behaviour** — the existing asm/TM/oracle suites stay green, which is
   the evidence that routing it through `lower_asm_mapped` altered nothing.

## Risks

| Risk | Mitigation |
|---|---|
| Mapped and unmapped lowering drift | Impossible by construction — `lower_asm` *is* `lower_asm_mapped` with the map discarded |
| `defunc` id preservation is subtle (closures, boxing) | Correspondence-preserving only where it exists; everything else declared synthetic, and the invariant catches leaks |
| Attribution silently wrong | The Σ-invariant plus a sabotage test that proves it fails |
| A trace-based counter exhausts memory | Counting mode allocates per state, not per step |
| Probes exceed TM caps | Sizing is a stated constraint; the report labels any capped run as partial |
| Slice produces a map nobody uses | The survey is in this slice precisely so the map ships with a consumer that validates it |

## Interfaces produced

- `tm::lower_asm_mapped(&Core) -> Result<(Program, Vec<NodeId>), LowerError>`
- the TM builder's mapped variant → `(Machine, Vec<usize>)` (state index → asm index)
- `tm::defunc_mapped(&Core) -> Result<(Core, BTreeSet<NodeId>), LowerError>`, with `defunc` unchanged
  in signature and reimplemented over it
- a simulator counting mode → per-state step counts
- an attribution function composing the above → per-`NodeId` step histogram + scaffolding bucket
- `crates/redextape-core/examples/step_survey.rs`

## What this slice decides

The deliverable is **a ranked recommendation for the Tier A pass set**, grounded in: which constructs
dominate real TM step counts, and what each candidate pass measurably recovers on a probe. That
recommendation becomes the next spec.
