# Plan 4, core slice — source maps, a delta-shaped step stream, and token classification

**Status:** design approved, ready for an implementation plan.
**Date:** 2026-07-30.
**Predecessors:** [the v1 design spec](2026-07-19-tm-lambda-visualizer-design.md) (§5.4, §9), [core source
map + TM step survey](2026-07-24-core-source-map-and-step-survey-design.md) — which shipped the
Core→asm→TM half of the map this slice completes.
**Successor:** the view-model + `redextape-wasm` slice, which serializes what this produces and is where
Plan 5 attaches.

## Why this slice exists

The roadmap's Plan 4 is "sync anchor + view models + step-trace + WASM" — the data contract the web UI
renders. It bundles four core modules *and* a new WASM crate, and it was written before any of the
interfaces it depends on existed. Two things have changed since.

First, **half of it already shipped.** The 2026-07-24 slice built `lower_asm_mapped`, `defunc_mapped`,
`lower_tm_mapped` and `tm/attribute.rs` — the Core→asm→TM provenance chain, plus the composition that
attributes TM steps to source constructs. Plan 4's `sourcemap.rs` no longer starts from nothing; it
needs the λ half and an inversion of what exists.

Second, **three highlighting tasks got scoped against Plan 6 (the CLI) and turned out to belong here.**
They were originally framed as CLI work:

- **A** — token spans for the printed λ / TM / asm forms, plus source tokens.
- **B** — colouring a derived artifact by *which source construct produced it*.
- **C** — `NodeId → λ-subterm span`.

C is Plan 4's `sourcemap.rs` first bullet verbatim. B is that map's consumer. A's source half is Plan 4's
`analysis.rs` ("semantic tokens"). Only A's *printed-form* half is genuinely new surface unclaimed by any
plan. Building them in Plan 6 would have meant the CLI growing its own span layer that Plan 4 then
duplicated — so they fold in here, and the CLI becomes a consumer.

**This slice is therefore the producer half of Plan 4, and stops before serialization.**

## Scope

`crates/redextape-core` only. **Zero new dependencies**, honouring the standing mandate that core stays
WASM-clean and dependency-free.

**In:**

- `sourcemap.rs` — the λ half of the source map (task C) and the inversion of the shipped TM chain.
- `trace.rs` — one delta-shaped `StepEvent` vocabulary over both backends, stepped lazily.
- `analysis.rs` — token classification for all four languages (task A).
- Highlight composition — token spans crossed with source provenance (task B).

**Out, with reasons:**

| Deferred | Why |
| --- | --- |
| `viewmodel.rs`, `redextape-wasm`, serde | §9.1 asks for "serde-serializable" view models, which contradicts core being dependency-free. Deferring resolves it cleanly: view models land in the WASM crate, which may depend on serde, and nothing renders them until Plan 5 exists anyway. |
| `Rc<LambdaTerm>` structural sharing | A change to a public type that derives `PartialEq` and is used across `lower`/`decode`/`encode`/`syntax`/`reduce`. Deserves its own slice. Evidence and diagnosis in §7. |
| Trace checkpoints | Measured unnecessary for the TM (§7). Revisit for λ only if `Rc` does not fix its replay cost. |
| Resolved symbols for the LSP | The roadmap pairs `analysis.rs` as "symbols + semantic tokens", but the LSP is v2 and nothing in v1 consumes resolved symbols. YAGNI: tokens only. |

## 1. `sourcemap.rs` — the sync anchor

§5.4 requires both backends to emit maps keyed to Core node ids: `node → λ-subterm span` and
`node → TM state-block`.

**The λ half (task C)** follows the `_mapped` pattern the predecessor slice established, so there is
exactly one implementation and the mapped and unmapped forms cannot drift:

```
lambda::lower_mapped(&Core) -> Result<(LambdaTerm, Vec<(NodeId, Path)>), LowerError>
lambda::lower(c)            = lower_mapped(c).map(|(t, _)| t)
```

`Path` (`Vec<Dir>`, with `Dir::{AppL, AppR, AbsBody}`) already exists in `lambda/term.rs` — the reducer
uses it to report redex positions. It *is* the subterm address §5.4 asks for, so no new address type is
needed; the work is producing `NodeId → Path` during lowering.

**The TM half needs no new lowering.** It inverts the shipped chain: `lower_tm_mapped`'s
`state_origins[s] → code index`, composed with `lower_asm_mapped`'s `origins[i] → NodeId`, with
`defunc_mapped`'s minted-id set excluded. `attribute.rs` already composes these three forwards to build
step histograms; this inverts the same composition.

```
SourceMap {
    node_to_lambda: BTreeMap<NodeId, Path>,
    node_to_tm:     BTreeMap<NodeId, Vec<StateId>>,
}
```

**Coverage (§10.4).** Every Core node maps to a non-empty λ path. On the TM side the claim is narrower —
see the correction below. Two exclusions are principled, not convenience: programs the λ backend declines
(mutable capture — it returns `LowerError` rather than risk a silent miscompile) are tested TM-only, and
ids `defunc` minted have no source construct to map to, which is precisely why `defunc_mapped` returns
that set.

**CORRECTION (2026-07-30, during implementation) — a third exclusion, because this section's original
premise was false.** As first written, this section claimed every Core node maps to a *non-empty TM
block*, with only the two exclusions above. Implementation showed that is not true of the shipped
`lower_asm`: some constructs emit no instructions at all. Verified against `lower_asm.rs`, the
instruction-free kinds are **`Lambda`, `Seq`, a `Let` whose value is not a `Lambda`, and an `Apply`'s
callee `Var`** — note that `LetRec`/`LetRecGroup` are *not* in this set (they emit their group's
`jmp skip` and each body's `ret` under the binder's id), and neither is a `Let` bound to a call-only
lambda.

**Those nodes map to `None`. The map says nothing where the lowering said nothing.** The first
implementation instead had uncovered nodes inherit their nearest covered ancestor's block, which was
rejected for two reasons. It asserts provenance that does not exist — highlighting `let x =` would light
up the states belonging to a *sibling* expression, and `tm_block` returning `Some` made that
indistinguishable from a real block. And it made the coverage test vacuous: with inheritance in place,
retaining only the root's block still passed, so the TM half of the assertion had collapsed to "the root's
`Halt` is billed" and would not have noticed `lower_asm` silently dropping `BinOp`, `If` or `Apply`.

The coverage test therefore asserts non-empty TM blocks only for kinds that emit code, and a companion
test names the instruction-free kinds and asserts they map to `None` — turning the discovery into a
regression guard rather than erasing it. A caller wanting "nearest enclosing block" for highlighting
computes it at the call site, where it is visibly a UI heuristic rather than map data.

**Also corrected: the root is not always covered.** The rejected inheritance pass leaned on
`lower_asm_mapped` billing the terminating `Halt` to `core.id()`. That holds on the direct path only — on
the defunc path `lower_asm_mapped` runs on the *defunctionalized* Core, not the original, so the root can
be uncovered. The original coverage corpus was entirely first-order, so nothing exercised this; the corpus
now includes higher-order programs that assert `lower_asm(&core).is_err()` to prove defunc really runs.

## 2. `trace.rs` — one delta vocabulary, stepped lazily

§9 requires a step-event stream so any renderer can scrub or animate. Both backends already emit steps;
what is missing is a shared shape and a size that fits a browser.

```
enum StepEvent {
    Beta  { redex: Path },
    Delta { state: StateId, rule: u32 },
}
```

**The TM delta is a rule reference, not a copy of the rule's effects.** The machine is immutable for the
duration of a run, so `(state, rule)` fully determines the writes and head moves — they are recoverable as
`m.states[state].rules[rule]`. That makes the variant **8 bytes with no allocation**, against the 3,488
bytes/step the current `sim::Step` holds by copying all tapes. A renderer needs the `Machine` in hand
regardless, so resolving the reference is free.

An earlier draft of this design stored `[Option<Symbol>; TAPES]` directly. That is **wrong**, and the
reason is worth recording: `TAPES` is the lowering's convention, but `Machine::tapes` is a runtime field,
and `parse_tm` accepts a hand-written machine declaring any tape count. A fixed-size array keyed to
`TAPES` would silently mis-shape every such machine. The rule reference has no tape-count assumption at
all.

The λ variant does allocate a small `Vec` (`Path`, measured maximum length 30). That is accepted rather
than optimized: `Path` is the type the reducer already produces, and inventing an inline-capacity
alternative would need a dependency core is not allowed.

Both backends expose `Iterator<Item = StepEvent>` cursors with O(1) memory. `reduce_trace` and
`simulate_trace` are reimplemented over those cursors, keeping their signatures and returned values
identical; the existing suites are the regression evidence.

**Why lazy rather than checkpointed** — see §7 for the numbers. Briefly: the TM replays at ~115M steps/s,
so seeking from step 0 to the end of the largest demo costs 3.0 ms, and checkpoints would guard a cost
that is not there. The delta *shape* is retained regardless, so adding checkpoints later would be a pure
performance change behind an unchanged API. That is the one part of the checkpoint design worth keeping
now: the shape, not the machinery.

## 3. `analysis.rs` — token classification (task A)

One `TokenClass` vocabulary spans all four languages: shared variants (`Ident`, `Nat`, `Bool`, `Operator`,
`Punct`, `Comment`) plus form-specific ones (`Binder`, `Mnemonic`, `Register`, `Label`, `StateName`,
`TapeSymbol`, `Move`).

- **Source:** `classify_source(&str) -> Vec<(Span, TokenClass)>` over the existing `lexer::lex`. No new
  scanner — `lexer.rs` already produces `Token { kind, span }`.
- **λ / TM / asm:** `print_*_mapped(..) -> (String, Vec<(Span, TokenClass)>)`, with each plain `print_*`
  reimplemented over its mapped form.

**Why the printers report spans rather than something re-lexing their output.** Only the source language
has a reusable lexer. λ's parser scans chars inline with no token type, TM's is line-oriented, and asm has
no parser at all — so "re-lex the printed text" means writing three new scanners to recover structure the
printer just discarded, each of which must stay in step with its printer with nothing forcing agreement.
That is the second-parallel-implementation failure the predecessor slice named as "a plan violation, not a
style preference."

**No ANSI or CSS in core.** Core emits classified spans; escape codes belong to consumers. This keeps core
WASM-clean and matches the model/renderer split §9.1 locks in.

## 4. Highlight composition (task B)

Crossing §1 with §3 gives `Vec<(Span, TokenClass, Option<NodeId>)>`, so a renderer may colour by token
kind *or* by originating source construct — the `while` loop in one hue, the `if` in another, across the
asm and TM forms. `NodeId` is `Option` because machine scaffolding and defunc-minted constructs have no
source origin, the same asymmetry `attribute.rs` already models with `StepBucket`.

This is the capability that makes the project's premise legible: the same construct, lit up
simultaneously in source, λ and TM.

## 5. Error handling

No new failure modes. `lower_mapped` returns the existing `LowerError`. The mapped printers are total —
they print the structure they are given. The cursors keep the existing `Caps`, `MAX_REDUCTION_STEPS` and
`MAX_TERM_DEPTH` guards. No `unwrap`/`expect`/panic on any library path, per the standing cardinal rule;
test and example code may panic deliberately.

## 6. Testing

1. **Equivalence, proptested** — `print_x(v) == print_x_mapped(v).0` and `lower(c) == lower_mapped(c).0`.
   This is what makes "exactly one implementation" checked rather than asserted.
2. **Span well-formedness** — every span in bounds, ordered, non-overlapping, and covering the printed
   string except whitespace.
3. **Trace equivalence** — cursor-derived traces equal today's `reduce_trace` / `simulate_trace` output,
   proving the rewrite changed no behaviour.
4. **Delta resolution** — replaying a `Delta { state, rule }` stream reproduces byte-identical tapes to a
   direct simulation. This is now the crux of §2: if the reference does not resolve to the same effects,
   every consumer silently diverges from the oracle while both traces still look well-formed.
5. **A machine whose tape count is not `TAPES`** — parsed from TM text declaring a different count, traced
   end to end. A regression guard on the bug §2 records: nothing else in the suite would notice a design
   that quietly assumed five tapes, because every machine the lowering builds has five.
6. **Coverage** — §1's §10.4 test, with the **three** principled exclusions: a λ backend that declines
   the program, ids `defunc` minted, and — added once implementation falsified the original premise —
   node kinds that emit no instructions at all.
7. **Sabotage checks in both directions** on the coverage and equivalence guards. A guard that cannot fail
   is not a guard — the repo has precedent for verifying this explicitly.

## 7. Measurements behind the trace decision

Taken on one machine, release build, best of three runs, native (not WASM).

**Cost of the current materialize-everything traces:**

| Program | Backend | Steps | Materialized |
| --- | --- | --- | --- |
| `1 + 2 * 3` | TM | 5,724 | 8.3 MB (1,523 B/step) |
| `sum(5)` | TM | 178,222 | **592.9 MB** (3,488 B/step) |
| `1 + 2 * 3` | λ | 13 | negligible (414 term nodes) |
| `sum(5)` | λ | 626 | **~23 MB** (502,113 term nodes) |

The TM figure counts real tape contents (`Symbol = char`, 4 bytes, × 5 tapes) plus `Vec` bookkeeping. The
λ figure is an exact node count times an assumed per-node cost — order-of-magnitude, not precise.
`sum(5)` is row 7 of the existing demo suite, not a stress test.

**Replay throughput:**

| Backend | Program | Steps | Full replay from 0 | Rate |
| --- | --- | --- | --- | --- |
| TM | `1 + 2 * 3` | 5,724 | 0.1 ms | 113M steps/s |
| TM | `sum(5)` | 178,222 | 1.5 ms | 117M steps/s |
| TM | `map` | 344,999 | **3.0 ms** | 115M steps/s |
| λ | `1 + 2 * 3` | 13 | 0.1 ms | 235k steps/s |
| λ | `sum(5)` | 626 | **99 ms** | 6.3k steps/s |

**What this settles.** The TM needs no checkpoints: a full replay of the largest demo is 3.0 ms against a
16 ms frame budget, so even a several-fold WASM penalty leaves headroom. Lazy stepping is the *final*
answer there, not a stopgap.

**Why λ is 18,000× slower per step, and why the fix is not checkpoints.** Two hypotheses were tested and
refuted. It is not the `depth_exceeds` guard — the measured loop never calls it. It is not term growth or
the O(depth²) `path.insert(0, ..)` in `reduce_step`: measured maximum term depth is **69**, maximum size
**1,213 nodes**, maximum redex path length **30**, so the worst-case path cost is ~900 shifts.

The cause is `LambdaTerm` being `Box`-based. `reduce_step` rebuilds the spine as
`App(Box::new(f2), a.clone())`, **deep-cloning the untouched sibling subtree at every level** — a redex 30
deep clones ~30 subtrees of up to 1,213 nodes, roughly 36k node allocations per step. At ~4 ns/node that
predicts ~150 µs/step against 158 µs measured. Close enough to call the cause, though it is inference from
matching arithmetic rather than a verified experiment.

**So the λ remedy is `Rc<LambdaTerm>`,** which makes spine rebuild O(path) instead of O(term size) *and*
makes snapshots nearly free by sharing unchanged subterms. That collapses the trade-off rather than
engineering around it, and it is why checkpoints are not designed here. Deferred to its own slice per the
scope table; 99 ms is a visible hitch on a scrub, not a hang, so it does not block this one.

## 8. Open questions

- **Whether λ ever needs checkpoints.** Unanswerable until `Rc` lands and λ replay is re-measured. The
  delta shape keeps the option open at no cost.
- **Token-class granularity for the TM form.** Whether `TapeSymbol` should distinguish blank / delimiter /
  digit is a renderer question; the vocabulary can gain variants without breaking consumers, so it is
  deliberately left to first contact with a real renderer.
