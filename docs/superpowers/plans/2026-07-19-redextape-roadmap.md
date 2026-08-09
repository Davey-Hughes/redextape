# Redextape v1 — Implementation Roadmap

> **Companion to** the design spec: [`docs/superpowers/specs/2026-07-19-tm-lambda-visualizer-design.md`](../specs/2026-07-19-tm-lambda-visualizer-design.md).
> This roadmap sequences v1 (§11 of the spec) into **six focused implementation plans**. Each
> plan produces working, testable software on its own. Only Plan 1 (Foundation) is written in
> full detail so far — see [`2026-07-19-foundation-frontend.md`](2026-07-19-foundation-frontend.md).
> The remaining plans are sketched here and get written out one at a time, on demand, once the
> interfaces they depend on actually exist (writing them earlier would detail code against
> interfaces that will still shift).

## Why a sequence, not one plan

v1 is a full compiler front end + two backends + two interpreters + source maps + WASM + a web
UI + a CLI + a formatter. That is many independent subsystems. Per the writing-plans skill, each
becomes its own plan that ends in an independently testable deliverable. They compose along one
spine: everything meets at the **Core AST** (the spec's synchronization anchor, §4.1).

## Global constraints (apply to every plan)

Copied verbatim from the spec / existing repo config:

- **Rust edition 2024**, `max_width = 120`, `use_small_heuristics = "Max"` (`rustfmt.toml`).
- Toolchain: `stable`, components `rustfmt` + `clippy` (`rust-toolchain.toml`).
- CI gates (`.forgejo/workflows/ci.yml`) that must stay green:
  - `cargo fmt --all --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo llvm-cov nextest --workspace --fail-under-lines 90` *(was `--all-targets ... 80` — the
    runner moved to nextest at the swap recorded below, and the floor rose 2026-08-09)*
  - Web job: `pnpm exec biome ci`, `pnpm run typecheck`, `pnpm run test:coverage`, `pnpm run build:app`.
- CI auto-activates on the presence of a **root `Cargo.toml`** and **`web/package.json`** — the
  workspace manifest must live at the repo root.
- Planned crates: `redextape-core` (lib), `redextape-cli` (bin), `redextape-wasm` (cdylib),
  `redextape-lsp` (bin, v2); web app under `web/`. Landed since this list was written, and not
  originally planned as separate crates: `redextape-native` and `redextape-native-rt` (the native
  backend and its runtime).
- **Every Core-AST node carries a stable `NodeId`** — the source-map / sync anchor (§5.4, §9).
- **No panics on user input** — malformed source produces spanned `Diagnostic`s, never a panic
  (§9.4: parse-error diagnostics from day one).
- `Nat` is a non-negative integer with **truncated subtraction (monus)**: `3 - 5 == 0` (§3.4).
- **UFCS** `recv.m(args)` is pure sugar for `m(recv, args)` (§3.4) — reduced during desugar.

## The six plans

### Plan 1 — Foundation: front end + reference interpreter  ✅ *(detailed)*

- **Crate:** `crates/redextape-core` (new workspace).
- **Delivers:** `text → tokens → surface AST → typecheck → Core AST → Value`. Lexer, Pratt
  parser, Hindley–Milner typechecker, desugar to Core, and the **reference tree-walker**
  interpreter (the oracle for §10's three-way test). Spanned parse/type diagnostics surfaced
  through a public `analyze` / `run` API.
- **Depends on:** nothing.
- **Key interfaces exposed downstream:** `redextape_core::core::{Core, NodeId}`,
  `redextape_core::value::Value`, `analyze(&str) -> Analysis`, `run(&str) -> Result<Value, RunError>`.
- **Testable outcome:** run `count_down`, `map`/`fold` demo programs end-to-end and assert the
  resulting `Value`; malformed programs yield diagnostics with correct spans.
- **Detail:** [`2026-07-19-foundation-frontend.md`](2026-07-19-foundation-frontend.md).

### Plan 2 — Lambda backend + reducer + λ text form

- **Modules in `redextape-core`:** `lambda/term.rs` (de Bruijn terms — explicit binders from day
  one, §9.2), `lambda/lower.rs` (Core → term), `lambda/reduce.rs` (normal-order reducer tracking
  the redex), `lambda/encode.rs` (Church `Nat`, Scott `Bool`/`List`), `lambda/decode.rs`
  (normal form → `Value`), `lambda/syntax.rs` (parser + printer for the λ text form).
- **Delivers:** Core → λ-term (Church/Scott, `fix`/Y for recursion, store-passing for
  `mut`/`while`, §5.1); leftmost-outermost reducer; a human-readable λ text language with a
  round-tripping parser/printer (§7.2); the first oracle test — `reference == decoded λ normal form`.
- **Depends on:** Plan 1 (`Core`, `Value`).
- **Key interfaces exposed:** `LambdaTerm`, `lower(&Core) -> LambdaTerm`, `reduce_trace(...)`,
  `decode(&LambdaTerm) -> Option<Value>`, `parse_lambda`/`print_lambda`.
- **Testable outcome:** two-way oracle (reference vs λ) passes on the demo suite + proptest
  round-trips for encodings and `parse ∘ print`.

### Plan 3 — TM backend + simulator + register-assembly + TM text form

- **Modules in `redextape-core`:** `tm/asm.rs` (register-assembly IR + parser/printer),
  `tm/lower_asm.rs` (Core → assembly), `tm/defunc.rs` (defunctionalization — closures → tag +
  env, `apply` → jump table, §5.3), `tm/machine.rs` (multi-tape TM), `tm/lower_tm.rs`
  (assembly → TM), `tm/sim.rs` (simulator: state/head/tapes, binary + unary display, §5.2),
  `tm/decode.rs` (final tape → `Value`), `tm/syntax.rs` (TM text parser/printer).
- **Delivers:** the full TM path and the three-way oracle (`reference == λ == TM`, §10.1).
  Defunctionalization may itself be phased (first-order core first, closures second — §13.3).
- **Depends on:** Plan 1. Shares the demo suite + oracle harness with Plan 2.
- **Key interfaces exposed:** `Machine`, `lower_tm(&Core) -> Machine`, `simulate_trace(...)`,
  `decode_tape(...) -> Option<Value>`, `parse_tm`/`print_tm`, `print_asm`. *(`parse_asm` was
  promised here but never landed — `tm/asm.rs` prints but cannot read the asm form back. See the
  Plan 6 survey note below, "Genuinely missing and unclaimed.")*
- **Testable outcome:** three-way oracle passes on the demo suite; proptest generates random
  valid programs and checks all three agree (§10.2); TM text round-trips.

### Plan 4 — Sync anchor + view models + step-trace + WASM

- **Modules:** `sourcemap.rs` (Core node → λ span, Core node → TM block, §5.4), `viewmodel.rs`
  (serde-serializable `LambdaState` / `TmState`, §9.1), `trace.rs` (step-event stream, §9.3),
  `analysis.rs` (symbols + semantic tokens on top of Plan 1's diagnostics, §8/§9.4);
  new crate `crates/redextape-wasm` (cdylib, `wasm-bindgen`).
- **Delivers:** the data contract the UI renders — structured view models, a scrubbable trace,
  and source maps (§10.4). No rendering yet. *(Said "full node coverage" until 2026-07-30; see the
  correction below — full coverage is false of the TM half.)*
- **Depends on:** Plans 1–3.
- **Key interfaces exposed:** `LambdaState`, `TmState`, `StepEvent`, `SourceMap`; WASM exports
  `compile`, `step`, `run_to_cap`.
- **Testable outcome:** source-map coverage test (every Core node → non-empty λ span, and every node
  *of a kind that emits code* → non-empty TM block — **corrected 2026-07-30**, see below); view models
  serialize/round-trip; `wasm-pack build` succeeds.

#### Plan 4's producer slice is DELIVERED (2026-07-30)

Plan: [`2026-07-30-plan4-sourcemap-trace-and-tokens.md`](2026-07-30-plan4-sourcemap-trace-and-tokens.md).
`redextape-core` still has **zero dependencies** (`cargo tree -p redextape-core --edges normal` shows
only itself), and no printed byte moved — every pre-existing golden, round-trip and fixture passed
unedited, which is the evidence for that claim.

**Interfaces now exposed:**

| module | surface |
| --- | --- |
| `sourcemap` | `SourceMap { node_to_lambda, node_to_tm }`, `build`, `lambda_path`, `tm_block` |
| `lambda` | `lower_mapped(&Core) -> Result<(LambdaTerm, Vec<(NodeId, Path)>), LowerError>` |
| `trace` | `StepEvent::{Beta, Delta}`, `LambdaCursor`, `TmCursor` — both `Iterator`, both O(1) in steps |
| `analysis` | `TokenClass`, `Classified`, `Attributed`, `classify_source`, `attribute_tm_spans` |
| printers | `print_lambda_mapped`, `print_tm_with_mapped`, `print_tm_mapped`, `print_asm_mapped` |

~~**Still open — the consumer slice:** `viewmodel.rs`, `crates/redextape-wasm`, serde. Lands with Plan 5.~~
**PARTLY CLOSED 2026-08-05 (PR #11).** `viewmodel.rs` and the optional `serde` feature landed;
`crates/redextape-wasm` is what remains, and it lands with `web/` rather than with Plan 5 as a whole.
See the entry at the end of this file.

**What implementation falsified, recorded rather than absorbed:**

- **§10.4's premise was false** and the spec is corrected: `Lambda`, `Seq`, a `Let` whose value is not a
  `Lambda`, and an `Apply`'s callee `Var` emit no instructions at all, so they map to `None`. The map
  says nothing where the lowering said nothing. `LetRec`/`LetRecGroup` are NOT in that set.
- **The root is not always covered.** `lower_asm_mapped` bills the terminating `Halt` to `core.id()` on
  the direct path only — on the defunc path it runs on the *defunctionalized* Core. The corpus was
  entirely first-order, so nothing exercised it; it now includes higher-order programs asserting
  `lower_asm(&core).is_err()` to prove defunc really runs.
- **Path→node is not injective:** a zero-argument `Apply` gives the `Apply` node and its callee the same
  path. Anything inverting the λ map must not assume otherwise.
- **λ lowering had NO depth guard** (pre-existing, not introduced here) — **now closed.**
  `lambda/lower.rs` recursed unbounded while every other stage was guarded, and a list literal past
  ~1470 elements aborted the process with an uncatchable stack overflow inside `lower` on an 8 MiB
  stack. It now measures the input's nesting depth once, iteratively (`too_deep_node`, the shape
  `defunc` already used), before any recursive pass — the lowering itself *and* the `assigns_captured`
  / `collect_region_vars` analyses that walk a sub-tree before it is lowered — and answers
  `LowerError::TooDeep`. Bound `MAX_LAMBDA_LOWER_DEPTH = 700`: ~2.1x below the measured crash, and
  exactly `MAX_EVAL_DEPTH`, so nothing the reference interpreter can evaluate is refused.

  **Two consequences worth stating rather than discovering later.** First, this is a *capability
  reduction* on λ-only paths, not purely an abort-to-error conversion: programs between depth 701 and
  ~1470 lowered successfully before and now answer `TooDeep`. That is justified by the bound equalling
  `MAX_EVAL_DEPTH` — the invariant becomes "if the reference interpreter can evaluate it, the λ backend
  can lower it", and anything deeper already failed elsewhere (interp faults, and the TM guards are
  stricter at 580) — but it is a real change, not a free one.

  **Second: an 8 MiB-calibrated bound does not protect WASM.** The measurement behind 700 was taken on
  a native 8 MiB stack; WASM's is ~1 MB, where the crash arrives around **depth 180**. So a browser
  build can still abort inside that window. This matters more than it looks, because Plan 4 exists
  specifically to feed the WASM/web target — the one place the guard does not yet reach. Closing it
  properly needs a per-target bound (or a stack-probing check) rather than one constant, and the same
  gap applies to the sibling guards `MAX_EVAL_DEPTH`, `MAX_LOWER_DEPTH` and `MAX_DEFUNC_DEPTH`, all
  calibrated the same way. ~~**Decide it with the WASM slice**, where the target's real stack is
  known.~~ **CLOSED 2026-08-06 (PR 3b), by raising the stack rather than by lowering the bounds — and
  the "depth 180" above is wrong; measured, it is 256–260.** See the shadow-stack entry at the end of
  this Plan 4 section.
- **`Rc<LambdaTerm>` remains the λ performance fix**, not checkpoints. Evidence in the design doc §7.
  **It landed 2026-07-31, and what it measured corrects the 99 ms this entry quotes** — see the λ
  structural-sharing note at the end of this Plan 4 section.

**Deferred by the final whole-branch review (2026-07-30), each with why.** None is wrong code; all are
unfinished contract. Ordered by when a consumer will hit them.

1. **Nothing pairs a `SourceMap` to the `Machine` it describes** — *fixed on this branch*, recorded here
   because the failure was severe and the shape of the fix is the lesson. `build` lowered a machine and
   discarded it, and `attribute_tm_spans` took map and machine separately, so a map built under one
   encoding against a machine lowered under another mis-attributed **1049 of 1374** spans silently. The
   fix records the state-name association at build time and removes the `Machine` parameter, so there is
   no second object to mismatch.
2. **No `NodeId → source Span` — the sync anchor has no source leg.** §5.4 asks for exactly two maps
   (`node → λ span`, `node → TM block`) and never specifies a source one, so this is a gap in the
   DESIGN, surfaced only by asking how a renderer lights the source pane. **Nothing is lost by
   deferring:** `desugar(&Program) -> Core` already takes the AST, every AST node carries a `Span`
   (`ast.rs:16-23`), and the ids are minted right there — so `desugar_mapped` later is the same
   `_mapped` shape used four times on this branch. **Decide it in Plan 5**, where the renderer defines
   what it actually needs.
3. **~~The four printers disagree on span coverage.~~ CLOSED.** The design's §6 asks for spans covering
   the printed string except whitespace; the shipped test omitted that property and it did not hold.
   Measured non-whitespace gaps: **λ 56** (the binder `.` was unclassified while `(`/`)` two lines away
   were not), **asm 16** (the label `:` and the `, ` operand separator), **TM 0**. Resolved by taking the
   first option: `check` in `tests/span_wellformed.rs` now asserts coverage, and the λ binder `.`, the asm
   label `:` and the asm operand `,` classify as `Punct`, matching what the TM printer already did. No
   printed byte changed. `classify_source` is held to the same property, with the one documented
   exception below — item 4's comment bytes, which the corpus therefore excludes on purpose.
4. **`classify_source` can never emit `TokenClass::Comment`, and this is the `fmt` blocker wearing a
   different hat.** `lexer.rs` discards `//` comments, so `TokenKind` has no variant for them and the
   one class every source highlighter needs is unreachable. Fixing it means deciding how trivia
   attaches — token stream or AST — **which is exactly the decision that blocks `redextape fmt`**, since
   a `print ∘ parse` formatter over an AST that never saw comments deletes every comment in the file.
   Patching it for the highlighter alone would likely be redone once `fmt` forces the real design.
   **Do it once, as its own slice, and both consumers are served.** See the Plan 6 note below.
**Minor findings from the same review.** Recorded here because the execution ledger they were logged in
is git-ignored scratch, so leaving them there would have discarded them at merge. Six of the seven were
fixed before merge; the status below is what is true now, not what the review first found.

- **STILL OPEN — a third copy of the direct-then-defunc lowering match:** `sourcemap.rs` ≈
  `tm/attribute.rs` ≈ `tm.rs`. `sourcemap.rs` admits it in a comment. All three answer "lower this Core,
  falling back to `defunc` only on `Unsupported` and never on `TooDeep`" — a decision that should exist
  once. Not folded here only because it was the one Minor needing real design (the three callers want
  different outputs from the same choice), and the branch was already long.
- ~~`Core::for_each_child` vs recursive test helpers~~ — **fixed.** `nat_nodes` is now iterative over an
  explicit worklist; `children` deleted.
- ~~The `_mapped` suffix convention inverted for the TM printer~~ — **fixed.** It was
  `print_tm`↔`print_tm_mapped_bare` and `print_tm_with`↔`print_tm_mapped`, so the suffix meant opposite
  things. Now `print_tm`↔`print_tm_mapped` and `print_tm_with`↔`print_tm_with_mapped`.
- ~~Argument-order drift among the write-in-place helpers~~ — **fixed.** All are `(out, spans, payload)`.
- ~~`print_asm_mapped` rescanned every label per instruction~~ — **fixed.** Labels are bucketed by index
  once, preserving the order several labels at one index print in, with a test pinning that order.
- ~~No lint enforced the no-`unwrap` cardinal rule~~ — **fixed, and it found seven real violations**:
  four `unwrap`s in `tm/header.rs::finish`, two in `tm/lower_asm.rs`, one in `lambda/syntax.rs`. All
  fixed rather than allowed. `[workspace.lints.clippy]` now warns `unwrap_used`, `expect_used`, `panic`,
  `todo`, `unimplemented`; `clippy.toml` exempts test code and documents the two limits of that
  exemption. The rule had been documentation-only since the project began.
- ~~`core_of` defined four times~~ — **mostly fixed.** The two integration tests share one from
  `tests/common/mod.rs`. Two copies remain inside `src/` `#[cfg(test)]` modules, unreachable from
  `tests/common`, and one of those differs on purpose.

**STILL OPEN — five `unreachable!` on library paths.** `clippy::unreachable` is deliberately NOT enabled,
so these are listed rather than silently pre-allowed: the arith/compare dispatch split in both encodings
(`tm/encoding/binary.rs`, `tm/encoding/unary.rs`, two each) and `tm/lower_asm.rs`'s arity table. Each
marks an invariant between two tables. Removing them means changing the *types* so the impossible arm
cannot be written — a design change, not a cleanup. A sixth, a bare `unreachable!()` in `lambda/syntax.rs`'s
`fresh`, WAS removed: its unbounded `0..` search is now bounded by a pigeonhole argument and returns a
value instead of aborting a printer.

5. ~~**`sim::run` and `TmCursor::next` are a duplicated 8-guard sequence (~29 lines).**~~ **CLOSED** —
   `sim::run` is now a consumer of `TmCursor`, so the δ-stepping loop exists once, matching what the λ
   half already did. `sim.rs` retains only the `rule_matches`/`apply` definitions the cursor calls; all
   three distinctive guards (`stuck == halt`, the pre-allocation tape-count check, the malformed-rule
   check) appear in exactly one file. The three optional recorders survive: `record` snapshots ahead of
   each step, `counts` tallies the emitted event's state, `watch` sees post-step tapes and stops at
   `cursor.state()`. One API addition, `TmCursor::into_tapes`, to spare `run` a clone. Perf within noise
   on the three heaviest δ tests.

   **One trade-off this created — and how it was closed.** Folding forced `run` to handle a non-`Delta`
   event and an absent status, both structurally impossible today. The `unwrap_used` deny (added the same
   day) rules out asserting they cannot happen, so the code breaks the loop and defaults instead — which
   would have meant a future `StepEvent` variant silently truncating a run rather than failing loudly,
   with the λ half identically exposed. The wildcard keeping them total is the same wildcard that would
   hide the bug. Closed by `trace::tests::every_step_event_variant_has_a_declared_producer`, an
   exhaustive match with no wildcard: **adding a variant is now a build error**, verified, so the
   decision must be made deliberately. Same device as `analysis::class_of` and `Core::for_each_child`.
   **Original finding, for context:** The design §2 said
   `simulate_trace` would be reimplemented over the cursor as `reduce_trace` was; only the λ half
   happened, and this is an unrecorded deviation rather than a decision. Mitigated by the differential
   tests in `tests/trace_equivalence.rs`, which pin the two against each other on every corpus program,
   at each cap boundary, and on a machine whose tape count is not `TAPES`. `simulate_trace`'s
   `record`/`counts`/`watch` hooks are all expressible over the cursor, so nothing forced the split.

#### Plan 4 is split in two, and its first half is designed (2026-07-30)

Design: [`2026-07-30-plan4-sourcemap-trace-and-tokens-design.md`](../specs/2026-07-30-plan4-sourcemap-trace-and-tokens-design.md).

**Producer slice (designed):** `sourcemap.rs`, `trace.rs`, `analysis.rs`, highlight composition —
`redextape-core` only, zero new dependencies. **Consumer slice (deferred):** `viewmodel.rs` +
`crates/redextape-wasm` + serde, landing with Plan 5, which is what renders them.

The split resolves a contradiction in this entry as written. §9.1 asks for *serde-serializable* view
models, but the shipped source-map slice mandates that `redextape-core` stay WASM-clean and
dependency-free. Deferring serialization to the WASM crate — which may depend on serde — satisfies both,
and nothing consumes a view model until Plan 5 exists anyway.

**Half of this entry already shipped** via the 2026-07-24 source-map slice: `lower_asm_mapped`,
`defunc_mapped`, `lower_tm_mapped` and `tm/attribute.rs` are the Core→asm→TM chain. What remains is the λ
half (`lower_mapped`, giving `NodeId → Path`) plus an inversion of the shipped chain. Note that plan doc's
35 checkboxes are all still unticked despite the work having landed — the code, not the checkboxes, is the
status of record.

**`analysis.rs` ships semantic tokens only; resolved symbols are dropped.** The LSP is v2 and nothing in
v1 consumes symbols. YAGNI.

**Three highlighting tasks scoped against Plan 6 moved here**, because two of them are this entry's own
deliverable: `NodeId → λ-subterm span` is `sourcemap.rs`'s first bullet verbatim, and colouring a derived
artifact by originating source construct is that map's consumer. Building them under the CLI would have
meant Plan 6 growing a span layer Plan 4 then duplicated. See the Plan 6 note below for what stayed.

**Measurements that fixed the trace design** (release, native, best of three — full tables in the design):

| | steps | materialized | replay from 0 |
| --- | --- | --- | --- |
| TM `sum(5)` | 178,222 | **592.9 MB** | 1.5 ms |
| TM `map` | 344,999 | — | **3.0 ms** |
| λ `sum(5)` | 626 | ~23 MB | **99 ms** |

- **Materializing is not viable and never was.** 593 MB for row 7 of the existing demo suite. The
  5,000,000-step cap bounds *steps*, not bytes, and at ~3.5 KB/step it authorizes terabytes.
- **The TM needs no checkpoints — lazy stepping is the final answer there, not a stopgap.** ~115M steps/s
  means a full replay of the largest demo is 3.0 ms against a 16 ms frame budget.
- **λ is 18,000× slower per step, and the remedy is `Rc<LambdaTerm>`, not checkpoints.** Two hypotheses
  were tested and refuted: not the `depth_exceeds` guard (the measured loop never calls it), and not term
  growth or the O(depth²) `path.insert(0, ..)` — measured max term depth **69**, max size **1,213 nodes**,
  max redex path **30**. The cause is `Box`-based `LambdaTerm`: `reduce_step` rebuilds the spine as
  `App(Box::new(f2), a.clone())`, deep-cloning the untouched sibling at every level — ~36k node
  allocations per step, which at ~4 ns/node predicts ~150 µs against 158 µs measured. Structural sharing
  makes spine rebuild O(path) *and* snapshots nearly free, collapsing the trade-off instead of working
  around it. **Own slice:** `LambdaTerm` is public and derives `PartialEq`, used across
  `lower`/`decode`/`encode`/`syntax`/`reduce`.
- **The TM delta is `(state, rule)` — 8 bytes, no allocation.** The machine is immutable during a run, so
  a rule reference determines the writes and moves. An earlier draft stored `[Option<Symbol>; TAPES]`,
  which is **wrong**: `TAPES` is the lowering's convention but `Machine::tapes` is a runtime field and
  `parse_tm` accepts any declared count, so a fixed array would silently mis-shape every hand-written
  machine. Nothing in the suite would have caught it, because every machine the lowering builds has five
  tapes — hence the explicit non-`TAPES` regression test in the design's §6.

#### λ structural sharing landed, and it corrects the 99 ms above (2026-07-31)

Design: [`2026-07-30-lambda-structural-sharing-design.md`](../specs/2026-07-30-lambda-structural-sharing-design.md).
`LambdaTerm` is now a structurally shared `Rc` newtype (`LambdaTerm(Rc<Node>)`, match sites go through
`.node()`), with a hand-written iterative `Drop` over `Rc::into_inner`, an `Rc::ptr_eq` fast path on
`PartialEq`, and `Rc<str>` name hints. Every pre-existing golden, oracle, round-trip, proptest and
fixture passes unedited, and `redextape-core` still has zero dependencies.

**The 99 ms above was row 9 of 46, not the worst case.** Measured over the whole first-order corpus
rather than two hand-picked programs, **seven of 46 programs exceeded 350 ms and the worst was
2,580 ms**. That is a hang, not "a visible hitch on a scrub". The conclusion Plan 4 drew from 99 ms —
that λ replay cost did not block its own slice — is unaffected. The characterisation of the cost is
what was wrong.

**What `Rc` bought: a uniform 2.1x–2.8x**, on the nine heaviest programs. `sum(5)` 116 ms →
**41.6 ms** — the probe measures 116 ms for the program Plan 4's instrument reported at 99 ms above, and
the point of this block is the distribution, not that gap; the corpus worst case 2,580 ms →
**1,216.7 ms**; programs over 350 ms, seven → **one**. Full before/after table in the design's §2.

**The worst case is still a hang.** 1,216.7 ms is ~76 frames at 16 ms. λ scrubbing is not yet usable on
the worst program in the *existing* demo suite, and Plan 5 must not assume it is. The design's §7
therefore gates further optimization on first explaining what actually dominates λ replay time — node
count demonstrably does not predict it, and the evidence got stronger, not weaker: row 7 runs **6.7x**
faster than row 31 while being larger by every available measure, a gap that **widened** from 5.5x under
`Box`. **That gate is no longer open: layer 1.5 answered it, and the answer is below.**

**Hash-consing was measured NOT to be YAGNI**, which is the finding that shaped the type — a newtype
rather than `Rc` children on the enum, so an interned handle can be swapped in later without touching a
match site. Two independent measurements say so:

- **within-term** (the discriminating ratio: structurally identical subterms *built separately*, which
  `Rc` cannot share and interning can) — **1.3x–64.2x**, corpus-wide 43,580 nodes collapsing to 2,994
  distinct (**14.56x**). The distinct count never exceeds ~155 anywhere in the corpus, whether the term
  holds 16 nodes or 9,763: it is bounded by the program's encoding vocabulary, not by how far the
  reduction has run.
- **the three-way count, available only once `Rc` shipped and there were allocations to count.**
  `sum(5)`'s whole trace: 502,146 logical nodes → 140,529 distinct `Rc` allocations → 13,590 distinct
  structural subterms. `Rc` removes 72%; interning would remove a further **90% of what `Rc` leaves**,
  **10.3x beyond `Rc`** — and 50.0x on the `while`-loop program. The design's §3 originally argued this
  ratio away, on the grounds that since "`Rc` already captures the bulk of it" the ratio "proves nothing
  about interning". The bulk clause is fair; the conclusion drawn from it is measurably false, because
  what survives `Rc` is still an order of magnitude above the structural floor. Corrected there.

**This is a memory/allocation argument, not a speed one**, and the distinction is load-bearing rather
than a hedge: `subst`/`shift` still traverse the whole abstraction body, and under de Bruijn a shifted
copy carries *different indices*, so it is a structurally new term that interning does not dedupe.
Turning fewer nodes into less work needs memoized traversals keyed on interned ids. That was queued as
"a further layer, behind the same gate" until the gate was answered; **it is not the next layer** — see
below.

**One hazard carried forward.** Structural sharing lets a term's **logical** size exceed its
**physical** size — thirty nested `App(c, c)` levels is 30 allocations and 2^30 logical nodes — and
`depth_exceeds`, `print_lambda`, `PartialEq` and `decode` all walk the logical expansion. Under `Box`
such a term was **impossible to construct**; under `Rc` it is ~~**possible and merely unreached** by the
current corpus, which is a weaker guarantee~~ — **possible AND REACHED, from 512 bytes of ordinary
source; falsified 2026-07-31, see the blow-up entry below.** `MAX_TERM_DEPTH` bounds depth, not
width-by-sharing. `LambdaTerm`'s `Drop` is the one traversal bounded by allocation count rather than
logical size, and that half held under measurement. Full statement in the design's §10.

#### Layer 1.5 answered the gate, and the answer is neither interning nor memoization (2026-07-31)

> **EVERY PERCENTAGE IN THIS BLOCK IS A SHARE OF `Σ abs×arg`, AND THAT COUNTER WAS FALSIFIED ON
> 2026-08-02 — see "CLOSED 2026-08-02" below.** It is a static model, `count_abs(body) × size_of(arg)`,
> written against a `subst` whose `Abs` arm copied unconditionally; the `maxfree` short-circuits that
> closed the hang removed the cost it counts without changing the counter, and it over-reports by
> **~1,584x** (70,542,349 modelled, 44,539 measured). So 86.8%, 95.6%, 99.7% and the ρ 0.996 below are
> all measurements of a function that no longer exists. **What survives is the negative half** — that
> neither interning nor memoization is the answer — because that rests on the *mechanism* (a shifted
> copy carries different de Bruijn indices and has nothing to dedupe), not on the size. What does not
> survive is any ranking taken from these shares, including the one that deferred the zipper.

**What dominates λ replay time is `subst` re-copying the argument under every binder** — **86.8%** of the
nodes the reducer visits, and **95.6%** of the ones it *constructs*, which is the bucket that is 90.8% of
all nodes and **99.7% of the time**. `subst`'s `Abs` arm re-shifts the argument on the way down
(`abs(n, subst(j + 1, &shift(1, 0, s), b))`), so the argument is deep-copied **once per binder in the
body** — not once per occurrence, and whether or not the variable occurs beneath that binder at all.
Over the corpus's 5,955 β-steps `subst` replaced 6,220 occurrences and built 273,004 copies of the
argument: **44 copies for every use the step had for one.** Measured by
`examples/lambda_sharing_probe.rs` PART B/C.

**This closes the gate the block above leaves open.** "Explain what actually dominates λ replay time" is
answered, and the explanation is verified against **all 46 rows** rather than the two that raised the
question: the counter `Σ abs×arg` reaches Spearman ρ 0.996 against `replay ms`, and — the discriminating
test, since ρ stays near 1.0 for anything that merely grows with the program — the whole accounting
prices at **18.0 to 34.5 ns per node** across traces spanning five orders of magnitude of work. Row 31 is
the worst case because `lower_group` lowers a mutually recursive group as one fixpoint over an n-tuple,
making every member's body binder-dense: the argument-weighted mean binder count is **232 on row 31
against 44 on row 7**, which is the 6.74x. The corpus's five mutually recursive programs are its five
slowest.

**The hypothesis layer 1.5 was written to test was refuted.** That hypothesis was *substitution blowup* —
a large argument copied into many occurrences. There is none anywhere in this corpus: the mean occurrence
count is 1.04, so `Σ occ×arg` and `Σ arg` sit within 5% of each other on every row that takes measurable
time. The argument is copied 44 times and used once.

**Layers 2 and 3 are therefore declared not worth planning, and this is the evidence rather than a
deferral.** Neither addresses the 86.8%. **Interning cannot touch it** — every one of those nodes is
produced by `shift`, and a shifted copy carries *different de Bruijn indices*, so it is a structurally
new term with nothing to deduplicate; worse, interning does not *avoid* constructing a node, it *hashes*
one, at ~60 ns/node against the ~35 ns/node the reducer pays to construct one. **Memoization would cache
a computation that can simply be deleted** — a `shift` memo keyed on `(d, cutoff, alloc_id)` does hit,
but the six-line fix recovers all of it with no cache, no ids and no invalidation question.

**What survives of the interning case above, stated precisely because the two halves come apart.** The
**memory** argument is untouched: the residual after `Rc` is still 10.3x and 50.0x on the two rows with
allocation counts, and that stands on its own. What is refuted is its **speed corollary** — the cost
interning would attack is 13% of the nodes, and the 87% is structurally invisible to it.

> **FALSIFIED 2026-08-02 — READ THE NEXT PARAGRAPH AS HISTORY.** ~~"The next target is `subst`'s
> per-binder re-shift."~~ Measured against what `subst` NOW allocates it is a **0.99x loss** on the
> nested-group family at every level and 1.00x on both guard counterexamples. The whole record is
> further down this file, under **"CLOSED 2026-08-02 — the `subst` slice is falsified, and the short-
> circuit is why"**; the paragraph is left standing because the 70.5M figure it quotes is what the
> falsification is about.
>
> **It also contains a SECOND stale claim, and it is a different one.** "`shift` has no
> sharing-preserving arm" stopped being true on 2026-08-01: `shift` now returns its argument's
> allocation whenever `maxfree(t) <= cutoff`. The conclusion drawn from it survives — `beta`'s *closing*
> `shift(-1, 0, ·)` is at cutoff 0 over a term with a free variable, so the short-circuit cannot fire at
> the root and it does still rebuild the reduct — but the general claim does not, and the difference is
> load-bearing: `beta`'s *opening* shift takes the short-circuit on 88.4% of steps. Measured,
> `Σ opening` is 5.7% of allocations against `Σ closing`'s 12.3%.

**The next target is `subst`'s per-binder re-shift.** At binder depth `d` the argument is `shift(1,0,·)`
applied `d` times, which is `shift(d,0,·)`, so the lift can be carried down and paid once per occurrence
instead of once per binder — turning `Σ abs×arg` into `Σ occ×arg`, 70.5M nodes into 828,569. The design
records it written out, with a shift-additivity lemma verified exhaustively (53,376 cases) and a
differential against today's `subst` (355,840 triples, 0 mismatches). After it, the largest remaining
cost is **not** `depth_exceeds` — that is 64% of the remaining *nodes* but ~5% of the remaining *time* —
but `beta`'s closing `shift(-1, 0, ·)`, at ~37%, which a second, independent line of evidence reaches
from the sharing side: because `shift` has no sharing-preserving arm, that call rebuilds the whole reduct
node for node and its output shares **zero** allocations with either of `beta`'s inputs.

**Explicitly not "fix `subst` and then do interning".** The next slice is: fix `subst`, re-run the probe,
and **re-derive** layers 2 and 3 from the new measurement — the instrument is committed and reproducible,
so the next bottleneck gets named the way this one was. That discipline has now refuted two intuitions in
one slice: hash-consing priced as YAGNI, and substitution blowup. Full statement in the design's §10.

#### CLOSED 2026-08-01 — the hang was `shift`, and fixing it removed the need for the guard

**Read this before the two blocks below, which are now history.** The record said the next λ slice was a
per-redex work budget, with "worth doing first: re-examine `lower_group`'s duplication, since fixing the
root cause may remove the need for a guard at all." That is what happened, one level deeper than
`lower_group`.

`term.rs`'s `shift` rebuilt every node it visited, unconditionally — no memo by allocation, and no check
for whether any free index was in range. So it was **Θ(logical) rather than Θ(physical)**, and it
**destroyed sharing**: `shift(App(c, c))` recursed twice and produced two separate copies of `c`.
`lower_group`'s duplication only writes the promise; `shift` was what cashed it, on every β-step. That is
why `|arg|` in the measured cost model `|body| + Abs(body) × |arg|` was the logical number and not the
physical one — the part of that diagnosis that was never stated.

**Two committed measurements had already recorded the cause as a symptom, from opposite ends, and
neither was read that way.** `blowup_probe.rs`'s `step` section: *"a β-step's output aliases nothing, and
the within-term ratio is exactly 1.00x after ≥6 steps."* And the perf entry immediately above this one:
*"because `shift` has no sharing-preserving arm, that call rebuilds the whole reduct node for node and
its output shares **zero** allocations with either of `beta`'s inputs."* The second names the mechanism
outright, as a note on what to fix *after* `subst`.

**The fix is one comparison in each of two functions.** Each `LambdaTerm` handle carries `maxfree` — the
highest free de Bruijn index plus one, so `0` means closed — maintained in O(1) by `var`/`abs`/`app`.
`shift(d, cutoff, t)` is the identity exactly when `maxfree(t) <= cutoff`; `subst(j, s, t)` is exactly
when `maxfree(t) <= j`. Both then return `t.clone()`, which preserves the **allocation** — the half that
matters, since the rebuilt copy was always structurally *equal*, which is why `==` never noticed and the
cost stayed invisible for as long as it did. The `subst` check also sits above that function's `Abs` arm,
so the per-binder `&shift(1, 0, s)` is never built for a variable that does not occur — the argument
expression that made the re-shift unconditional.

#### …and then `depth_exceeds` was 96% of what remained

With `shift` fixed the reduction ramp still doubled per level, and almost none of that was reduction.
`reduce.rs`'s `depth_exceeds` walked the **logical** expansion once per β-step — the same bug class, one
file over, and it survived the first fix. Sampled 1-in-200 against a memoized equivalent, verdicts
identical on every sample:

| level | steps | logical walk | memoized | speedup |
| --- | --- | --- | --- | --- |
| 7 | 107,379 | 11.630 s | 25.110 s | 0.5x |
| 9 | 106,493 | 46.863 s | 23.527 s | 2.0x |
| 11 | 105,607 | **187.599 s** | 23.824 s | 7.9x |

**187.6 s of level 11's 195.7 s was the depth guard.** Memoizing was measured and **rejected** — the
level-7 row is why: a `HashMap` per call is a net loss on the small terms the ordinary corpus reduces,
and that flat ~24 s is per-call allocation overhead across ~105,000 calls, not walking. `depth` is
instead carried on the handle beside `maxfree`, O(1) at construction and O(1) to read, so `depth_exceeds`
is now `t.depth() > limit` — no walk, no allocation.

Two smaller items landed with it, both consequences of the `shift` change rather than independent work:
`shift`'s `else { var(*k) }` became **provably unreachable** (the short-circuit returns whenever
`k < cutoff`, so reaching the match guarantees `k >= cutoff`; coverage confirmed it) and is replaced by a
`debug_assert!`; and `subst`'s `k > j` arm now returns `t.clone()` rather than rebuilding an identical
`var(*k)`.

| program | before either fix | `shift` only | both |
| --- | --- | --- | --- |
| the 512-byte nested-group hang | one β-step unfinished at 13 min / 974 MB | 105,607 steps, 195.7 s | **7.48 s** |
| `let xs = [0..500); let ys = […]; head(xs) + head(ys)` | **19.0 s in the first β-step** | 0.024 s | **<0.001 s** |
| `[0, 1, …, 698]` | 35 s over 1,398 steps | 3.187 s | **0.986 s**, same 1,398 steps |

**The reduction ramp is now flat** — 7.5–9.0 s at every level from 1 to 11, against a logical size
growing 306 → 616,152 across that range.

**Semantics are unchanged, and that is asserted rather than claimed.** Every oracle, golden, round-trip
and proptest in the workspace passed unedited (34 test binaries, 0 failures). Step counts are identical
wherever they were pinned. The only tests that moved are the two sharing gates, which pin *allocation
counts* and which fell **7.42x** (140,529 → 18,939) and **42.5x** (185,459 → 4,364) at **unchanged node
totals** — same reduction, node for node, in a fraction of the memory.

**The per-redex work budget was not built.** Its reasoning survives — it priced the measured cost model
rather than a proxy, and it checked per step — but the quantity it was going to bound is no longer large,
because `|arg|` is no longer paid logically. A bound sized from the pre-fix numbers would be calibrated
against costs inflated up to ~9,500x on these programs. If a guard is wanted later it must be
re-measured from scratch. `tests/guard_counterexamples.rs` still holds, and both its programs now
reduce quickly rather than merely lowering.

**What is NOT closed.** Divergence is untouched and was never this slice's to solve; the nested-group
family has no base case, so "terminates" means it reaches a cap in bounded time. The cap it reaches is
`MAX_TERM_DEPTH`, **not** `MAX_REDUCTION_STEPS` — 105,607 steps against a step cap of 5,000,000 — because
the family grows deep as it diverges.

**The flat ramp is a fact about this family, not a complexity claim.** What both fixes removed is cost
that scaled with the *logical* size while the physical size stayed small — which is exactly what this
family is built to exhibit. A program whose physical size genuinely grows still pays for it, and `subst`
still rebuilds the spine of whatever it descends into. ~~The older next target — carrying `subst`'s
per-binder re-shift down as one `shift(d, 0, ·)`, with an additivity lemma already verified in the perf
design — is untouched and still available.~~ **Falsified a day later by the same short-circuit — see
"CLOSED 2026-08-02" below.**

Instrument: `crates/redextape-core/examples/shift_cost_probe.rs`, committed with the fix — it carries the
memory-cap rules in its module docs and is the re-runnable source for every figure above.

#### Concurrency was asked of both interpreters and measured out: five rejections, one sequential win (2026-08-01)

Design: [`2026-08-01-interpreter-concurrency-design.md`](../specs/2026-08-01-interpreter-concurrency-design.md).
**Nothing built.** Raised as a question — can threads make the TM simulator or the λ reducer faster? — and
answered by measurement, in the same spirit as the two blocks above: the interesting output is the
rejections, because each is a thing a reader will re-propose.

**The governing numbers, on the `map` demo under `Unary::default()` (3,203 states, 5 tapes, 344,999 steps,
32 logical CPUs):** a full δ-step is **12.99 ns** (77.0 M steps/s); a 5-thread barrier is **2,063 ns**.
**Every intra-run parallel scheme loses on that ratio alone** — break-even for a 5-way split needs ~200×
more work per step than exists, and k = 2 is no kinder (cheaper barrier, worse k/(k−1)). Rejected with
numbers: parallel `apply` over tapes via thread pool *or* async runtime (§3, and the async case is wrong
by category — there is nothing blocking to hide); speculative δ-stepping (§4 — no latency asymmetry to
exploit, and dispatch turns out to be *well* predicted, not badly); parallel β-reduction (§5); `Rc` →
`Arc` (§6 — **20.0× on refcount bumps**, landing exactly on the clones the `shift` fix above made the hot
path). Test-suite parallelism is not a target either: **646 tests, 1.976 s wall** in release on this host
(§7).

**The strongest form of the rejection**, because it is the case most favourable to threads:
`simulate_trace`'s `Tape::snapshot` is the only genuinely O(cells) per-tape operation in either
interpreter — 1,011 ns/step, 78× untraced, five independent tapes. Split perfectly across five threads it
is still **2.25× slower** than sequential. The barrier is not close to payable anywhere.

**What survives is sequential, and BOTH loops have the same bug class as `depth_exceeds` above** — per-step
recomputation of something the previous step already knew. **The two want different fixes, and finding that
out was the useful part.**

**TM (§8.1) — run-length fusion, and the ENCODING decides whether it pays.** Under `Unary` the corpus
confirms it overwhelmingly: **99.3% of δ-steps sit in a same-state run averaging 38.56** (on `map`, longest
65 = `MAX_FIELD_WIDTH` + 1 — these are field sweeps, the simulator-side view of the 92–97% padding share
`width_report` already reports). The interpreter re-runs the whole `TmCursor::next` preamble once per cell
to perform 38 identical one-cell moves; bulk-apply a self-looping rule and replay the individual
`StepEvent`s so no observer sees a difference. **But `Binary`'s mean run is 7.77 — five times shorter.**
Modelling a fused op at `c` ordinary steps makes the win ~`R/c`: at the pessimistic `c = 10` this block
originally used to claim "~3.7×", `Unary` gives ~3.9× and **`Binary` gives 0.78×, a net loss.** `c` decides
it, not `R`, and `c` belongs to an implementation nobody has written. **No slice may quote a number from
here** — and a change tuned on `Unary` that regressed `Binary` would leave every oracle green, since fusion
is semantics-preserving by construction.

**λ (§8.2) — the analogue was measured and does NOT carry; the fix is a zipper, and it should go LAST.**
Over 5,955 β-steps across every corpus program λ accepts, same-redex-path runs average **1.22** against the
TM's 38.56, and consecutive root redexes are **1.3%** — so neither run fusion nor n-ary β has a surface,
because the redex *moves* after nearly every step. (This negative result is corpus-wide, which is why it is
stated with more confidence than the positive one above.) What the same data shows instead: **93.7% of all
descent retraces the path the previous step already walked** (97.2% on `sum(5)`), because
`LambdaCursor::next` re-enters `reduce_step` from the **root** every step and rebuilds the spine coming
back up. **Then Part H measured the denominator: a β-step is 1,323 ns, ~102× a δ-step** — so the ~8.7
retraced spine nodes are a single-digit-percent lever, a large share of a small thing. ~~**The standing
`subst` re-shift target attacks where that 1,323 ns actually lives and is already designed, differentially
tested and unbuilt; it goes first.**~~ That settles §11 item 6 in the opposite direction to how §8.2 was
drafted.

> **BOTH HALVES OF THAT ORDERING ARE OVERTURNED — 2026-08-02, and this one goes the other way.** The
> `subst` re-shift target is falsified (below), so nothing goes first ahead of §8.2. And the reason §8.2
> was demoted does not survive either: "a single-digit-percent lever" divided ~8.7 spine nodes into a
> per-step node count taken from `Σ abs×arg`, which over-counted by ~1,584x. Against the measured
> accounting a β-step allocates **~31.8 nodes**, of which **`Σ path` — the spine `reduce_step` rebuilds —
> is ~9.3, or 29.2% of nodes and 36.2% of fitted time. It is the largest single allocating traversal in
> the corpus.** That is the same ~8.7 nodes, re-divided by a denominator that is right.
>
> **This RE-OPENS §8.2; it does not decide it.** A zipper changes what the spine rebuild costs rather
> than deleting it, so the saving is a fraction of 36.2% and nobody has measured which fraction. The
> β-step figure itself is unaffected — Part H's 1,323 ns was taken after the `shift` fix, and the corpus
> independently prices a step at ~1,243 ns today. What changed is only the denominator the lever was
> compared against. `examples/lambda_sharing_probe.rs` is the instrument, repaired to be able to answer
> this.

**The real parallelism is Plan 4/5's, and the premise hands it over:** λ reduction and TM simulation of the
same Core are wholly independent, so one worker each is genuine task parallelism with no shared terms, no
per-step barrier, and no `Arc`. The point is latency — a 7.48 s λ reduction on the UI thread is a frozen
tab — plus run-ahead buffering, which is a *prefetcher* rather than a speculator and therefore never
squashes. `trace`'s lazy cursors over a shared `StepEvent` vocabulary are already the right interface.

**Caveat that applies to parallelising the probes, not the interpreters:** fan-out multiplies peak RSS, and
one λ measurement has already cost 60 GiB and all swap. A parallel sweep must size its per-process cap at
`total / N` rather than handing each worker the single-run cap.

**Instrument: `crates/redextape-core/examples/concurrency_probe.rs`, committed with the design** — every
figure above is one run of it, and it carries the memory-cap rules in its module docs the way
`shift_cost_probe.rs` does. **Writing it changed two conclusions the throwaway harness had reached** —
`Binary`'s 7.77 against `Unary`'s 38.56, and the 1,323 ns β-step that demoted §8.2 — which is the argument
for this discipline rather than an accident of it, and the third time on this thread that a measurement has
overturned a plausible estimate. Part G's four run columns exist to keep §8.2's *negative* result
falsifiable: if same-path runs ever approach the TM's, the conclusion flips and fusion becomes a λ
optimization after all.

#### BUILT 2026-08-02 — the reduction-context zipper works: ~1.4x, and the first λ design on this thread to survive

**Four designs on this thread were falsified by measurement. This one was corrected twice by measurement
and then confirmed by it.** `ZipperCursor` (`src/trace/zipper.rs`) carries the reduction context across
β-steps instead of re-descending from the root, and on the lazy consumer it is:

| | measured |
| --- | --- |
| corpus wall-clock | **1.41–1.43x (glibc)** — 7.4 ms → 5.3 ms, four runs |
| ceiling `Σ path` recovered | **99.0%** — 54,655 of 55,226 nodes |
| what the climb costs | **571 nodes**, 1% of the ceiling |
| row 31, the mutually-recursive worst case | **4.55x** |
| worst row | **0.62x** |

**It is not free on trivial input, and that is reported rather than smoothed.** The rows meaningfully
below 1.0x are programs where `climbs` exceeds `Σ path` outright — terms shallow enough that the search
climbs more than it descends, so carrying the context costs more than rebuilding it. (Rows at
0.96x–0.98x have positive net and are ordinary run-to-run noise, not this mechanism.)

**What to do about it is settled here, by routing rather than replacement.** `reduce_to_normal_form`
drives the zipper; `reduce_trace` keeps `LambdaCursor`, because it materialises `cursor.term()` every
step by contract and under a zipper would fold the stack per step and pay the cost back with frame
bookkeeping on top. Depth-selection was rejected — the sub-1.0x rows lose microseconds while row 31
gains milliseconds, so a runtime branch buys noise. **The whole suite now reduces through the zipper**:
748 tests green, including the three-way oracle, which is stronger evidence than the 256-program
proptest alone.

**The prediction discipline paid twice here.** §7 of the design predicted "recovers more than half of
`Σ path`"; it recovered 99.0%. And §2's second correction — made during review, that `advance`'s climb
allocates and the ceiling is therefore `Σ path − climbs` — was *right about the mechanism and wrong
about the magnitude*, which only the `climbs` column could establish. The plan required that column
before the code existed, precisely so a null result could be attributed instead of guessed at.

**Correctness is proven, not assumed.** `tests/zipper_equivalence.rs`: 256 generated programs plus six
curated terminating shapes and four curated capping cases (added by the whole-branch review that closed
out `EQUIV_CAP` as dead code — it had never fired before them), identical `StepEvent` sequences,
identical terms, identical statuses. It landed one task *before* the optimization and stayed green
through it with zero edits, which is what made resumption safe to add.

Full record: [`../specs/2026-08-02-lambda-reduction-context-zipper-design.md`](../specs/2026-08-02-lambda-reduction-context-zipper-design.md).
This also answers §8.2 and open question 6 of the concurrency design, which had deferred the zipper on
the stale accounting the block below retired.

#### BUILT, MEASURED AND SHIPPED — β-fusion, 1.29–1.31x on the corpus, and a bar retired for being unsatisfiable

> **UPDATED 2026-08-04: THE FAMILY BAR IS RETIRED AS MALFORMED, AND THAT IS NOT THE SAME AS MISSED.**
> An in-process clock split puts **all of `beta` at 0.106–0.114 s of an ~85 s family run — 0.13%**, so
> the `>= 1.10x` this block was written against **could not have been reached by any change to `beta`**;
> making it free gives 1.0013x. The bar was chosen on a sound principle (measure what a user waits for)
> and then never sized against a measured denominator — the family is dominated by `reduce_step`
> chasing a ~2,840-node spine from the root every step, because it caps on DEPTH.
> **A bar must be sized against a measured denominator, not a workload's importance.** Fifth time on
> this thread that a number was sized against something nobody had measured.
>
> **Under `mimalloc`** (the probes' allocator since 2026-08-04) the family is **0.978x** — three-pass
> faster in 30 of 36 pairings, a real and recorded ~2% regression, *mostly* explained: the L1 DTLB gap
> driving the glibc result closes from **+52% to +1.9–2.2%**, and the remainder has no named mechanism.
> **WASM is unmeasured** — `dlmalloc` is neither allocator and the mechanism is allocator-specific.
>
> **Shipped on this instead:** correct over two 88,960-pair differentials; **~1.30x on the corpus**,
> which is what the demonstration actually reduces; **14.6% fewer instructions**; and **more sharing**
> (18,939 → 17,920 allocations at identical node totals), because the three-pass closing shift had been
> *un-sharing* argument copies it walked as a tree. Full record and the coherent counter-argument:
> [`../specs/2026-08-02-lambda-beta-fusion-design.md`](../specs/2026-08-02-lambda-beta-fusion-design.md) §5.1.

~~#### BUILT AND MEASURED 2026-08-03, SHIP BAR MISSED — β-fusion is correct, 1.29–1.31x on the corpus, and a REGRESSION on the family it was selected for~~

**`beta` is one walk now — `shift(-1, 0, subst(0, shift(1, 0, arg), body))` became `beta_go(body, 0, arg)`
carrying the argument incrementally — and it does not ship on the bar its own design wrote.** The bar was
a conjunction: **≥ 1.10x on nested-group levels 1–11 AND ≥ 1.00x on the 46-program corpus.** Measured
across two builds, four runs each side, probes held constant:

| | measured |
| --- | --- |
| corpus wall-clock | **1.288–1.308x** — 7.416–7.466 ms → 5.707–5.760 ms. PASSES `>= 1.00x` |
| nested-group family, Σ levels 1–11 | **0.910–0.925x** — 84.1–84.8 s → 91.7–92.5 s. **MISSES `>= 1.10x`** |
| worst row | **0.880–0.895x** (level 7) |
| best family row | **0.965–0.997x** (level 1) — still below 1.00x |
| GO/NO-GO count gate | **PASSED at 4.3%** — `Σ freevar` 1,458 against `Σ opening + Σ closing` 34,085, bar 40% |
| `Σ freevar` as a share | **4.3%** of `opening + closing`, **6.3%** of `closing` alone; 0 of 46 corpus rows and 0 of 13 family rows allocate more |
| allocation win, corpus | `Σ β today` 102,273 → `Σ β fused` 69,646, **1.47x** |
| allocation win, family level 11 | 718,210 → 299,819, **2.40x** |

**EVERY FAMILY ROW REGRESSES. Not one of eleven reaches 1.00x**, and the two shallowest are the only ones
that come close. Ordering was the obvious confound — all fused runs ran before all three-pass runs — and
it points the wrong way, since the later runs are the faster ones; it was tested anyway by snapshotting
both binaries and alternating them, and the split reproduces (family 0.917–0.930x, corpus 1.292–1.299x).

**A COUNT WIN IS A CLOCK LOSS, FOR THE SECOND TIME ON THIS FAMILY AND WITH A BIGGER COUNT BEHIND IT.** The
`subst` slice below cut ~19% of allocations for 0.99x. This one cuts **2.40x of `beta`'s allocations at
level 11** for **0.90x**. The arithmetic says plainly that the loss is not in `beta`: fusion removes 3.96
allocations per β-step and the clock loses **7.0 µs per β-step**. What dominates the family is
`reduce_step`, an **unmemoized** leftmost-outermost search that recurses into both children of every
`App` — so its cost tracks the *logical* tree, which is identical on both sides, and **no allocation
saving can reach it.** The design selected this family because `Σ opening` scales with it and never asked
what share of the family's *seconds* that column could reach. Why fusion additionally *loses* 7 µs/step
is **not established and is left open**: `perf` is unavailable on this host and neither probe carries a
counter that separates locality from allocator churn from anything else.

**WHAT STANDS REGARDLESS, AND IT IS NOT NOTHING.** Equivalence is exhaustive — 88,960 (body, arg) pairs
against a three-pass reference, 0 mismatches, plus the three-way oracle, every golden and every step count
unmoved. And **sharing improved, which nothing predicted**: the old closing shift walked `subst`'s result
as a tree with no memoisation and rebuilt every substituted argument copy, so deleting it collapses N
copies back to N handles on one allocation. `tests/lambda_sharing.rs`'s pins moved **18,939 → 17,920** and
**4,364 → 4,305** distinct allocations with their node totals (502,146 and 1,379,187) unchanged to the
unit. Those two edited constants are also the one place §7's *"zero edited expectations"* gate was not
literally met, and they are declared rather than absorbed. Side effect, as designed: nothing in `src/`
passes a negative `d` to `shift` any more.

**STATE OF THE WORK.** The code is landed on `lambda/beta-fusion` and nothing has been reverted — the
measurement is the deliverable, and what to do with a change that is +29% on a corpus replaying in
microseconds and −9% on the family that actually stresses the reducer is the same trade the `subst` block
below adjudicated in the opposite direction, and is the owner's call rather than this task's. Note the
symmetry before deciding: that block rejected a slice for being *"+19% on programs finishing in
microseconds and −1% on the ones that do not"*, and this slice is a larger version of the same shape.

Full record, with the per-level table and the §9 predictions marked hit or missed:
[`../specs/2026-08-02-lambda-beta-fusion-design.md`](../specs/2026-08-02-lambda-beta-fusion-design.md) §5
and §9.1.

#### CLOSED 2026-08-02 — the `subst` slice is falsified, and the short-circuit is why

**The standing next λ slice is not a win. On the family it was most likely to help it is a 0.99x LOSS.**
Carrying `subst`'s per-binder re-shift down as one `shift(d, 0, ·)` — paying it once per occurrence
instead of once per binder — was sized against `Σ abs×arg` = 70,542,349 corpus-wide. That counter is
`count_abs(body) × size_of(arg)`, a **static model written before either `maxfree` short-circuit
existed**, and it models neither of them. Priced instead against what `subst` now actually allocates:

| program | β-steps | closed arg | `reshift` (today) | `per_occ` (rewrite) | win |
| --- | --- | --- | --- | --- | --- |
| nested groups, level 1 | 109,565 | 89.2% | 5,921 | 8,881 | **0.99x** |
| nested groups, level 11 | 105,607 | 89.2% | 5,696 | 8,549 | **0.99x** |
| two 500-element lists | 22 | 81.8% | 0 | 0 | 1.00x |
| 699-element literal | 1,398 | 100.0% | 0 | 0 | 1.00x |

Thirteen of thirteen programs at **≤ 1.00x**. `reshift` — the quantity the rewrite deletes — is **5,696
allocations across 105,607 β-steps**, 0.05 per step, against a model that priced it at 44 copies of the
argument per step. The ordinary corpus agrees from the other end: **88.4% of its 5,955 β-steps have a
CLOSED argument**, so `shift(1, 0, arg)` is a refcount bump and the re-shift is already free; its win is
2.16x on a quantity that is 36,595 allocations across all 46 programs.

**"FALSIFIED" DOES NOT MEAN "NEGLIGIBLE", and the distinction is the whole of what to carry forward.** On
the ordinary corpus the re-shift is **23.5% of every allocation the reducer makes**, second-largest of
seven counters, and the rewrite really would cut it to ~7,944 — about 19% off the total. What sinks it is
magnitude and target, not direction: the absolute is **~1.5 ms across all 46 programs**, and on the
family that actually stresses the reducer it is a regression. A change that is +19% on programs finishing
in microseconds and −1% on the ones that do not is not worth its blast radius. What is falsified is the
*sizing* — the 7.0x/18.0x corpus-wide win — and the premise that it helps where help is needed.

~~**WHY IT INVERTS**~~ **WHY IT INVERTS ON THIS FAMILY** — ~~and the direction is forced rather than incidental~~. **CORRECTED
2026-08-03, from the β-fusion design's §5 GATE RESULT (Task 3):** it is not forced, it is this family's
direction only. The identical quantity, `Σ reshift` against `Σ per_occ`, inverts a second time on the
46-program corpus — where `occ` (per-occurrence) wins, not `reshift` — which is the same 2.16x already
recorded two paragraphs above; the family's and the corpus's verdicts on the same quantity point opposite
ways, and neither generalises to the other. What follows in this paragraph is this family's mechanism and
stays correct as a statement about the family alone. `subst`'s short-circuit means it
descends through only the binders **on the path to an occurrence**, not every `Abs` node in the body — so
"binders crossed" is now *smaller* than "occurrences", and paying once per occurrence costs more than
paying once per binder crossed. The 44:1 abs-to-occ ratio the design quotes is over the whole body,
computed statically. The per-unit comparison runs the same way: today's `Abs` arm shifts the
progressively lifted `s_d`, whose higher indices make the short-circuit fire *less* often, so each unit
of today's cost is at least each unit of the rewrite's. `per_occ`/`reshift` = 1.5 therefore means the
rewrite performs at least 1.5x as many shifts as it removes.

**What the census found instead, and neither column was being tracked.** The body **spine** `subst`
rebuilds is 60–90% of what it now allocates, and no guard or rewrite proposed so far touches it.
`beta`'s own **opening** `shift(1, 0, arg)` is the only column that scales with the family — 20,725 →
190,666 across levels 1 to 11 while every other column is flat or falling. If anything here is the next
target it is that, and it is a different function from the one every proposal so far has been about.

**This is the third measurement on this thread to overturn a written-down cost claim**, after
hash-consing (priced as YAGNI, refuted) and substitution blowup (hypothesized, refuted). The pattern is
the same each time and worth naming: a *model* of a cost outlived the *code* it modelled. `Σ abs×arg` was
correct when it was written and stayed in the record, quoted by four documents, for one day after the
change that made it wrong. That is exactly the failure "grep the tree for a falsified claim, not the
document that stated it first" (below, 2026-07-31) is about — and the grep that would have caught it here
is not for prose but for the counter's *name*, because the claim lives in a probe's arithmetic rather
than in a sentence.

Instrument: `crates/redextape-core/examples/shift_cost_probe.rs`'s census section — it mirrors `subst`
arm for arm including both short-circuits, rather than modelling it, and steps with `LambdaCursor`.
Counts only, no seconds. Full statement in the perf design's §10.

#### THE NEXT λ SLICE IS NOT the `subst` fix: 512 bytes of ordinary source reaches an unbounded β-step (2026-07-31)

**Superseded by the block above — read as history.** Found by an investigation run after the branch was
reviewed and green, and recorded here rather than fixed on it — **the branch lands, this is what the next
slice is planned from**. Instrument: `crates/redextape-core/examples/blowup_probe.rs`, committed with the
branch so the repro can be re-run instead of quoted. Full statement, sizing and confidence in the
design's §10.

> **REVERTED 2026-08-01 — READ THIS BLOCK AS HISTORY.** ~~"THE HANG IS OPEN AND NOTHING REFUSES THIS
> PROGRAM."~~ — nothing refuses it still, and **nothing needs to**: the hang was closed later the same
> day by fixing `shift` and `depth_exceeds`, two sections above. ~~"LANDED 2026-07-31 — the program is
> refused at lowering time"~~ — true for one day.
> `MAX_SHARED_LOGICAL_NODES` = 10,000 with `LowerError::TooShared` (`1652e09`) was **falsified by
> measurement and removed**; what stays is the measurement it read, `max_shared_logical_size`
> (`b832c89`), which is sound. The whole record is the design's **§10**, and the three-line version is:
>
> - **A trivially-written program defeats it by 2,500x.** `let xs = [0..500); let ys = [0..500);
>   head(xs) + head(ys)` — 4,821 bytes, **no recursion, no `while`, no closure** — measures `max_shared`
>   = **4** against the bound of 10,000 and takes **19.0 s in its first β-step**. The single-list
>   control **at that same n=500** — same element count, same lowering path, one binding instead of two
>   — takes **0.043 s** and scores 0: **442x apart, and invisible to every quantity the guard
>   measures.** ~~"At the largest n `lower` accepts (697) one step takes 196.5 s; the single-list
>   control at the same n takes 0.043 s. 442x apart"~~ — **corrected 2026-08-01: two different pairs
>   were being read as one.** 442x is 19.0 / 0.043, both at n=500, and it is the control comparison.
>   The **196.5 s** row is `guard_hole_probe ceiling 1500` — n=697 with every element the flat literal
>   `1500`, so that `|arg|` rises without the Core's nesting depth rising with it — and **no control
>   was run at that n**, so it sizes how far the shape goes inside `MAX_LAMBDA_LOWER_DEPTH` and divides
>   into nothing. `tests/guard_counterexamples.rs` had the pairing right the whole time. Cost is linear
>   in the number of let-bound lists (2.2 / 7.1 / 17.6 / 42.0 s at k = 2/4/8/16), so it is a family.
> - **The stated mechanism is not what `subst` does.** Its `Var` arm is `s.clone()` — an `Rc` bump, so
>   **occurrences are free** — while its `Abs` arm re-shifts the whole argument **once per `Abs` node in
>   the body, unconditionally**, before anything checks whether the variable occurs. A step costs
>   **`|body| + Abs(body) × |arg|`**, measured at 23.1–23.6 ns/node-copy over a 1,255x range.
>   **Neither factor is a sharing property**; both are large in an alias-free term scoring 0.
> - **The quantity collapses rather than growing.** Sampled after every step across six programs,
>   `max_shared` is **non-increasing in all six** — peak is always the lowering-time value. At 6 groups
>   it is 0 by step 2 while individual steps are reaching ~4.2 s each by step 9. **The guard read a
>   property destroyed by the second β-step, at the one moment it is maximal.**
>
> **The deciding evidence was already committed and nobody connected it.**
> `examples/lambda_sharing_probe.rs`'s PART B — on the branch immediately before this one — recorded
> `Σ abs×arg` at **86.8% of all nodes the reducer visits, as its headline finding**. That is the same
> product, from the other end, in the same directory, while this guard was being designed against
> "occurrences × |arg|".
>
> **~~THE NEXT λ SLICE IS A PER-REDEX WORK BUDGET.~~ NOT BUILT — OVERTAKEN 2026-08-01 by the `shift`
> fix, recorded in its own section above.** This design was sound and was never falsified; it was made
> unnecessary. It would have bounded `logical_abs_count(body) × logical_size(arg)`, and `|arg|` is no
> longer paid logically, so the quantity it priced is no longer large. A bound read off the numbers below
> would be calibrated against costs inflated up to ~9,500x. Re-measure from scratch if a guard is wanted.
> The rest of this block is still the best account of WHY the two earlier guards failed, which is why it
> is kept rather than deleted. `logical_abs_count(body) × logical_size(arg)`, both
> O(physical), checked in **`LambdaCursor::next` BEFORE performing the step** it prices.
> `logical_abs_count` is already written and exercised in `examples/guard_hole_probe.rs`. Two properties,
> and they are exactly the two failures above: it prices the **measured** cost model rather than a proxy
> for it, and it runs **at every step**, so the one-shot problem cannot recur.
>
> **This is NOT the "checked between steps" blind spot this entry warns about**, and the distinction is
> load-bearing because the warning is ~150 lines below and reads as covering it. That warning rejects "a
> node budget inside `LambdaCursor` … because one β-step can produce |body| × |arg| nodes, so a check
> between steps reads a number that says nothing about the next one" — and it is right, **about a check
> on the size of the current term, after the fact**. This is a **pre-flight check on the specific redex
> about to be reduced**, reading the two factors of *that step's* cost *before* that step runs. The
> rejected design measures the wrong quantity too late; this one measures the right quantity in time.
> Open and to be measured, not asserted: the budget's value, and whether an O(physical) check per step is
> affordable (§9 records the reverted guard at ~87% of `lower()` on the largest program `lower` admits —
> the same axis, now paid per step rather than once).
>
> Instrument: `crates/redextape-core/examples/guard_hole_probe.rs`, committed with the revert and the
> only re-runnable source for the counterexample and the ns/node-copy rate. **Everything below in this
> block was written while the guard was in the tree.** Its numbers are still right; its verdict is not.
>
> **The bound is read off a measured gap rather than derived from a growth law** — the previous attempt
> is the record of what happens otherwise. Corpus maximum **684** (`fn s0/s1/s2 … s0(4)`, index 31 of
> the 46; **twelve of them measure 0**). Largest case observed stepping steadily: the nesting family at
> 6 groups, **9,453**. Smallest where a single step hangs: 7 groups, **19,085**. The comparison is
> **strictly greater**, so every bound in **`[9,453, 19,085)`** — closed left, open right — accepts and
> refuses exactly the same programs; 10,000 is an ordinary member of that band, at 14.6x over the
> corpus, not a special point.
>
> **It is keyed on the largest shared subterm, not on the ratio this entry predicted.** ~~"Keyed on the
> logical/physical ratio, or on size only when the ratio is high"~~ — **that direction is not what
> landed.** The ratio is a whole-term average and the hazard is *one* big shared subterm: `subst` copies
> a shared subterm into every occurrence of the variable, so what makes a single step expensive is the
> largest one, not how much of the term is shared on average. In-degree rather than `Rc::strong_count`,
> because `strong_count` counts every live handle anywhere — a caller retaining snapshots, which is
> exactly what `reduce_trace` does by contract, would inflate it. **A guard whose verdict depends on who
> is holding the term is not a guard.**
>
> **WHAT IT DOES NOT CLOSE, stated first because a guard named for sharing will be read as covering
> more than it does.**
>
> - **Divergence — not closed, and not this guard's job.** The nesting family is non-terminating at
>   every level (`nested_groups_src` emits `fn g{k}(n) { f{k}(n) }` at every level and every `f{k}` body
>   ends in `+ g{k}(n)`, so `g{k} → f{k} → g{k}` closes with no base case at every group count), and
>   **every level steps forever until `MAX_REDUCTION_STEPS`.** That is correct and it outlived the
>   guard: divergence is the step cap's job and the halting problem was never this slice's to solve. The
>   guard refused only the case where a SINGLE STEP does not return — and did not catch it.
> - **Slow but terminating — not closed, deliberately.** The 699-element list literal that falsified the
>   previous design reduces cleanly in **1,398 β-steps (exactly 2n), 35.2 s, 215 MB peak**, and must
>   keep lowering. It measures `max_shared` = **0**, so this guard is *silent* on it rather than merely
>   lenient — that is the property the previous one could not have. Its cost grows ~n³ and stops being
>   comfortable between n=450 and n=500, which makes it a UX question: **Plan 5's "still running — hit
>   50k steps" affordance is where it belongs**, not here.
> - **`lower_group`'s duplication — the root cause, still unfixed.** Its `group.clone()` still clones the
>   whole group term once per member. Binding `group` once was measured *not* to close the blow-up — `g`
>   then occurs n times in the body, and under call-by-name the first β-step substitutes `G` into all n
>   occurrences, relocating the same expansion to reduction time — and it moves every pinned step count
>   and every `Origins` path in that function. ~~"This slice makes the program fail fast and typed
>   instead of hanging; it does not make it work."~~ — **it does neither, since the revert. The program
>   hangs.** And the falsification widened the root cause: `lower_group`'s duplication is one source of
>   an expensive step, not the source. Two let-bound list literals, which `lower_group` never touches,
>   reach 196.5 s in a single step by the same `Abs(body) × |arg|` route.
>
> **Two results the measurement turned up that nothing else in the tree records.**
>
> **Level 7's hang is computational, not memory.** One step held 100% CPU for **15+ seconds** at a peak
> RSS of only **93.6 MB**, and had to be killed from outside. That is the **first direct evidence** for
> the claim this entry has asserted since it was written — that `MAX_REDUCTION_STEPS` is never consulted
> because control never returns from `reduce_step`. Every prior observation of this family was a memory
> one (974 MB at 11 groups, an OOM kill at 16 levels), so the failure *looked* like a memory failure;
> at the size the guard actually refuses, it is not, and a memory cap alone would never have caught it.
> **11 groups is also not the boundary** — this entry records it because that is the size the first
> investigation ran, and the level-by-level ramp puts the smallest hanging level at **7**.
>
> **`MAX_TERM_DEPTH` already bounds large list literals, mid-reduction, at n≈800 — and nobody knew.** A
> list's *static* depth is 2n+2, well under 3,000 out to n≈1500, but **reduction grows it to roughly
> 4n**: the already-reduced cons prefix nests around the still-unreduced suffix, and traversing a
> reduced cell costs 3 hops against 1 for an unreduced one. So a large list literal answers `HitCap`
> from the *depth* guard mid-run rather than normalizing. Found by measurement, and it matches the
> analytic prediction (`2i + 2n + 2 > 3000` at i≈700, n=800). No existing test or comment records it.
>
> **The instrument is committed:** `crates/redextape-core/examples/list_reduction_probe.rs`, the only
> re-runnable source for the 699-element list's reduction, the 46-program corpus sharing profile and the
> family's `max_shared` per level. A recorded finding whose repro cannot be re-run is the
> non-re-runnable-evidence defect this project has already flagged twice.

> **STILL OPEN, and the next slice changed shape — updated 2026-07-31.** A logical-**size** guard was
> designed
> ([`2026-07-31-lambda-logical-size-guard-design.md`](../specs/2026-07-31-lambda-logical-size-guard-design.md)),
> planned, and **implemented; it was abandoned before commit.** The measurement it needs landed —
> `lambda::term::logical_size` (`517f15e`) and the β-step curve plus the TM check (`1d53ed0`) are in the
> tree and stay. **The guard did not, and nothing in the tree refuses this program today.**
>
> **What killed it.** `lambda/lower.rs`'s pre-existing depth-guard test builds a **699-element list
> literal** — chosen only to sit exactly at `MAX_LAMBDA_LOWER_DEPTH` — which measures **497,691 logical
> nodes at a logical/physical ratio of exactly 1.000x** (measured 2026-07-31). No sharing anywhere: half
> a million real allocations, a working program that reduces normally. The size guard refuses it. The
> design's capability claim — "every such program observed so far does not terminate anyway" — is
> **false for that program**, and the reason is structural: **a bound on logical size cannot tell
> sharing-induced blow-up from a program that is simply big.** The bound's calibration could not have
> caught it either, because the corpus it was read off has no list literal larger than `[1, 2, 3]`.
> Quantified: 300,000 nodes caps list literals at **541 elements** (541 → 299,717, 542 → 300,813) where
> the depth guard admits **699** — a separately designed limit silently tightened by 23%.
>
> ~~**So the next λ slice is a SHARING-based guard, not a size guard.** Keyed on the logical/physical
> ratio, or on size only when the ratio is high; the hazard is sharing, and `deep_list(699)` at 1.000x
> is not it. **That is a direction, not a design** — nobody has checked whether the ratio is cheap to
> compute (physical size needs its own pass), what threshold separates the corpus's measured 1.00x–2.89x
> from the hazard's 375x, or whether a ratio guard has its own false positives. It is a new slice with
> its own design, and **the hang stays open until it lands.**~~
>
> — **IT LANDED, ON A THIRD QUANTITY, AND THE HANG RE-OPENED (2026-08-01).** Not the ratio: the slice
> that followed was keyed on the largest *shared* subterm, and it is the block above this one. Struck
> whole rather than corrected clause by clause, because every clause is individually reasonable and the
> paragraph is still wrong — the hazard was named as *sharing* off one program that had sharing and one
> that did not, and a sharing bound was then calibrated correctly against a quantity that does not
> govern the cost at all (`|body| + Abs(body) × |arg|`, neither factor a sharing property). **"The hang
> stays open until it lands" is the sentence to keep**, for the shape of its mistake rather than its
> content: a design's landing is not a hazard's closing, and this one landed, closed nothing, and was
> reverted inside a day. **The next λ slice is a per-redex work budget** — read the block above, not
> this one. Full record with every number: the
> **logical-size-guard design's §10** (not the structural-sharing design's §10, which the paragraph above
> this block cites — two documents, both with a §10, and this entry now points at both).
>
> **The headroom figure that sized the abandoned bound was also wrong**, and it is the reason this block
> re-states the corpus maximum. ~~"a corpus whose largest lowered term is 2,007 logical nodes"~~ — that
> is `blowup_probe.rs`'s six-program §2b baseline `fn a/b/c … a(5)`, **which is not in
> `FIRST_ORDER_DEMOS` at all**. Measured over all 46 on 2026-07-31, the true corpus maximum is **2,173**
> (751 physical, 2.89x), the `fn s0/s1/s2 … s0(4)` three-way mutual recursion. The bound's headroom was
> stated against a program the corpus does not contain — the lesson below, surviving in a place nobody
> thought to grep, because the number was right and only its attribution was wrong.

**The hazard the block above carries forward as "possible and merely unreached" is REACHED.** Not by a
hand-built term — by **512 bytes of surface syntax** that parses, typechecks and lowers through the
public pipeline. It lowers in **196 µs** to **1,644 allocations holding 616,152 logical nodes (375x)**,
and reducing it reaches a **β-step that did not finish in 13 minutes**, holding **974 MB**. At 3,215
bytes the ratio is **5.8e17** (9,541 allocations, 2^72.2 logical) and `lower` still returns in 2.9 ms —
though **2^72.2 is the deleted `f64` fold's figure**, and the probe now prints that term as
`>=2^64 (SATURATED)` since `logical_size` is `u64` and saturates. Read it as the size the term denotes,
not as a number still printed anywhere.

> ~~"its **first** β-step did not finish in 13 minutes"~~ — **falsified 2026-07-31 and corrected in
> place, per the lesson below.** `blowup_probe --beta-curve` times one *cursor* step — the depth guard
> plus the first β-step — and gets **50 ms** at those same 616,152 nodes, so the first β-step costs at
> most that; it is cheap at every size this family reaches. The cost accrues *across* the run, because
> a step's output can be |body| x |arg| nodes and the next step starts from that output. This mattered,
> and is not pedantry: the obvious way to calibrate a bound — time one step and see where it hurts —
> measures the wrong curve, by **32x against the size that actually hangs** (19,726,040 / 616,152 =
> 32.0; against `MAX_LOGICAL_NODES` = 300,000 the same wall is 65.75x, which is clearance rather than
> looseness — both figures are right and each needs its base said). The correction is what kept
> `MAX_LOGICAL_NODES` at 300,000 instead of ~19M — a bound that was itself withdrawn days later, so
> both figures in this paragraph are arithmetic about a constant the tree does not contain; its
> successor `MAX_SHARED_LOGICAL_NODES` = 10,000, on the largest *shared* subterm, was a different
> quantity that neither ratio sizes — **and it was reverted in turn (2026-08-01), so the tree now
> enforces no bound of either kind.** The claim had survived in
> **seven** committed sites across five files — README, `reduce.rs`, this roadmap, the structural-sharing
> design, and three separate places in the guard's plan, one of which was a commit message body. The
> review that caught it enumerated six; grepping found the seventh. **That is the lesson below recurring
> a fourth time, including its corollary that the fix's own count of the damage is not to be trusted
> either.**

**Nothing fires.** `MAX_TERM_DEPTH` is not approached — depth **141** against 3,000, and depth grows ~12
per nesting level, so the guard is reached around 250 levels at a ratio of 2^250. `MAX_REDUCTION_STEPS`
is **never consulted**, because control never returns from `reduce_step`. And a wall budget checked
between steps cannot help: 90 s produced a 330-second run. **The failure mode is a hang at GB scale, not
a clean OOM** — the investigation expected a kill, set the ramp up to be killed, and did not get one.

**The mechanism is `lower_group`'s projection loop** — `out = app(out, projection(group.clone(), j))` inside `for j in
0..n` in `lower_group`, which clones the whole group term once per member of a mutually recursive `fn`
group. That is a factor of n, i.e. linear. **It becomes exponential because it nests and multiplies:** a
member's body is a block, and a block may declare its own mutually recursive group.

**The signature changed and the root cause did not, which is the part that routes the fix.** Under `Box`,
`group.clone()` was a deep copy, so the same program died **loudly, inside `lower`**, at a much smaller
size — n deep copies, immediately, in a pure function. Under `Rc` it is n refcount bumps, so **`lower`
succeeds** and the program dies **later and silently in the reducer**. **The root cause is pre-existing
in `lower_group`; this branch did not create it — it moved the detonation.** That is also why the corpus
never hit it: nothing in the corpus nests mutual recursion, and under `Box` anyone who tried was told
immediately.

**The obvious fix does not work, and this is why the entry names four options rather than one.** Binding
`group` once makes the *lowered* term linear, but `g` then occurs n times in the body and the first
β-step substitutes `G` into all n occurrences — so under call-by-name the same expansion reappears at
reduction time, one level per step. It is a delay, not a fix, and it moves every pinned step count and
every `Origins` path in `lower_group`. **Do not take it for the blow-up.** The design's §10 sizes all
four: a logical-size guard at the end of `lower` (~25 lines, O(allocations), the only cheap one, and it
must measure *logical* size because physical size is exactly the number that looks fine here); the
`lower_group` rewrite just described; call-by-need or a graph reducer, which is the only thing that
removes the class rather than an instance and is a different project; and a node budget inside
`LambdaCursor`, rejected because one β-step can produce |body| × |arg| nodes, so a check between steps
reads a number that says nothing about the next one.

**Option (a) was taken, and it is the one that came back — corrected 2026-07-31.** "It must measure
*logical* size because physical size is exactly the number that looks fine here" is true and is **half
the requirement**. Logical size alone refuses working programs, because a large no-sharing term measures
large too (the block above).

~~"What the guard actually needs is **both numbers**: logical size is the hazard's symptom, and the
logical/**physical** ratio is what tells the hazard apart from a big program. The sentence dismissed
physical size as uninformative when what it is, is the missing denominator."~~ — **that direction is
not what landed either, and this paragraph is 150 lines below the entry that already struck it.** The
correction is the same one made at the λ-blow-up entry above and is repeated here rather than
cross-referenced, because the hedge on that entry is a blockquote note scoped to the blockquote it sits
in and does not reach this paragraph. What shipped is keyed on **the largest shared subterm** —
`MAX_SHARED_LOGICAL_NODES` = 10,000 over `max_shared_logical_size`, `1652e09`. The ratio is a whole-term
*average* and the hazard is *one* big shared subterm: `subst` copies a shared subterm into every
occurrence of the variable, so what makes a single step expensive is the largest one, not how much of
the term is shared on average. Physical size was not "uninformative" and was also **not the missing
denominator** — it is not in the shipped measurement at all. Two successive corrections to this one
sentence both named a quantity that turned out not to be the answer, which is worth more than either
of them: the sentence was wrong about *what to measure*, and each attempt fixed it by proposing a
different function of the same two whole-term totals.

**A THIRD CORRECTION, 2026-08-01, and it retires the shipped one too.** "`subst` copies a shared subterm
into every occurrence of the variable" is **not what `subst` does** — its `Var` arm is `s.clone()`, an
`Rc` bump, so occurrences are free; its `Abs` arm copies the argument once per binder in the body,
unconditionally. A step costs `|body| + Abs(body) × |arg|`, and **neither factor is a whole-term total,
a ratio, or a sharing property.** `MAX_SHARED_LOGICAL_NODES` was reverted. That makes **three** successive
answers to this one sentence, and the standing observation now has a sharper form: every attempt named a
function of quantities that were already being computed, and the right answer was a pair of quantities
nobody was computing until `examples/guard_hole_probe.rs` did. The full record is the shared-subterm
design's §10.

**Three supporting results the same investigation established, kept because each stands alone.**
**`Drop`'s Θ(physical) claim holds** — 10,001 allocations carrying 2^10001 logical nodes, freed in
175 µs; it is the one traversal that survives this shape. **`beta`'s closing `shift(-1, 0, …)` means
reduction cannot COMPOUND the ratio — it MATERIALIZES it**, measured at exactly 1.00x within-term after
≥6 steps from starting ratios up to 114x; this reaches the design's §8 conclusion about that same
`shift` from the opposite direction, and it is the second independent line of evidence for why
`tests/lambda_sharing.rs`'s four constants cannot move. **`PartialEq`'s `ptr_eq` saves the
same-allocation case and only that case** — a separately built structurally equal term pays the full 2^n
and crosses 2 s at n = 30 — and **`parse_lambda` introduces no sharing**, verified on three inputs and
argued structurally (`syntax.rs` holds exactly one `.clone()`, on a binder *name*).

**Ordering against the `subst` fix.** These are independent: the `subst` rewrite is a constant-factor win
on programs that terminate, and this is a class of programs that does not. Neither blocks the other. The
`subst` fix has a written design, an exhaustive differential and a test target; this has a measurement
and a decision to make. **The decision is which of the four to take, or none.**

#### Minor findings from the λ structural-sharing review (2026-07-31)

Recorded here because the execution ledger they were logged in is git-ignored scratch, so leaving them
there would have discarded them at merge — the same reason and the same treatment as the Plan 4 producer
slice's minors above. The ledger held **fifteen**. **Nine were fixed before the branch landed and a
tenth is fixed by this commit; the status below is what is true now, not what the review first found.**
Four remain and two were judged not worth carrying — each for a stated reason rather than by omission.

- **STILL OPEN — the `if let Some(root) = Rc::get_mut(..)` in `term.rs`'s `impl Drop for LambdaTerm` has a silently empty else-branch.**
  Unreachable today (no `Weak` anywhere in the workspace, grep-verified) and the comment above it says
  why. But if a `Weak` is ever added, the destructor degenerates to compiler drop glue and overflows —
  the exact failure it exists to prevent, with nothing to catch it. A `debug_assert!` would make the
  trap explicit. Not taken here because the blow-up commit is doc-and-example only by construction.
- **STILL OPEN — `lambda.rs:16` re-exports `Dir`, `LambdaTerm` and `Path` but not `Node`,** so every
  consumer that matches on a term needs two imports (`lambda::LambdaTerm` + `lambda::term::Node`). A
  papercut paid by each of this branch's seven tasks in turn. It is a public-API addition, so it belongs
  to a slice that is allowed to make one.
- **STILL OPEN — the across-step sharing assertion in `term.rs`'s `a_real_multi_step_reduction_still_shares_allocations_across_steps` is weaker than its message.**
  `before_ids.intersection(&after_ids).next().is_some()` requires only SOME shared allocation, not the
  specific untouched sibling at each `App` branch, so on the two deepest steps a regression that broke
  sharing at one level but not another would pass. The realistic regression — total loss of sharing — is
  still caught on all four asserted steps, which is why this was filed rather than blocking.
- **STILL OPEN, cosmetic — doc-comment density on `lib.rs`'s new `App` drop-test trio** diverges from the
  `LetRecGroup` pair it invokes as its model: that pair documents the shared "why two chains" reason once,
  on the first test only. Substantively the same device, stylistically not.
- ~~`lib.rs:331` pointed a permanent source comment at the branch's review notes~~ — **fixed here.**
  `.superpowers/sdd/` is git-ignored, so it named an artifact nobody who clones the repo will have. The
  comment was otherwise self-contained (the O(1)-vs-O(depth) sabotage argument is spelled out in the
  block), so the pointer was dead weight rather than a lost explanation, and the sentence is now deleted
  rather than repointed. Introduced by a fix dispatch on this branch, which is where the class of error
  the lesson below describes comes from.
- ~~`reduce.rs`'s `depth_exceeds` doc said the early exit made it "bounded work"~~ — **fixed before
  landing**, and superseded twice over: it bounds DEPTH, not WORK, and the blow-up entry above is that
  distinction being cashed. The doc now leads with it.
- ~~Three stale references to a `take_children` helper~~ (`lib.rs:278`, `:303`, `:328`) — **fixed.** It
  existed in the `Box` destructor and the `Rc` rewrite inlined it away; grep now returns zero hits
  workspace-wide.
- ~~`alloc_id`'s doc claimed shared-id implies same-allocation without the liveness qualifier~~ —
  **fixed.** It now says WHILE BOTH ARE ALIVE and argues why an allocator may reuse a freed address.
- ~~The restored `PartialEq` sentence credited "fires on real terms" to the wrong test~~ — **fixed.**
  All three tests are now credited for what each one actually carries: agreement from the hand-built
  case, firing from the two that run real reductions.
- ~~The design said the probe carried the falsified across-trace claim "in two places"~~ — **fixed.** It
  was three; an inline `// ACROSS-TRACE:` comment nobody had named was the third, which is itself the
  lesson below in miniature.
- ~~The design stated the intern pass's `ns/node` band with confidence the instrument does not
  support~~ — **fixed.** Both bands are single-pass rather than best-of-three; a same-session re-run gave
  56.9–61.9 against the quoted 58.9–65.1, and the caveat plus "re-derive the band rather than reconciling
  a re-run against these two rows" now sits with the number.
- ~~The plan's File Structure table undercounted the λ drop tests~~ — **fixed**, and so was the same
  undercount in the design's §8; the shipped count is five.
- ~~Task 3's new drop-test doc comment overclaimed that a corrupted survivor "fails an assertion
  here"~~ — **fixed.** `Drop` has no `unsafe`, so a freed-while-shared survivor is unreachable in safe
  Rust; what the depth walk distinguishes is a STRUCTURAL logic bug from "did not crash", and the comment
  now says exactly that.

**Two were judged not worth carrying, with the reason, rather than left unmentioned.** The plan's Task 1
"Estimate: 20 minutes" was not bumped when the task grew a third test and a second sabotage round — the
Plan 4 entry above already records that the plan documents' checkboxes are not the status of record, so
a stale estimate inside one is not a finding. And `term.rs`'s new tests were filed for putting
cross-module `use` statements inside each test fn rather than once atop `mod tests`, on a comparison
with `reduce.rs`; the comparison picks the wrong sibling, because `lib.rs::drop_tests` — the module this
branch's other new tests live in and were modelled on — uses the per-fn form throughout.

#### The lesson this branch cost the most to learn: grep the tree for a falsified claim, not the document that stated it first (2026-07-31)

Recorded as a working practice, not as an anecdote, because it is the shape of the last defect this
branch had left. **Three of the four findings in the final whole-branch review were the same failure
mode:** a superseded claim surviving somewhere nobody re-read — two architecture summary lines, a
**printed runtime legend**, and this roadmap. The pattern recurred the whole run. The falsified
across-trace claim survived in **three** separate probe sites, one of which (an inline `// ACROSS-TRACE:`
comment) nobody had even enumerated, so the correction that fixed "both" of them was itself wrong about
the count. The plan document carried non-terminating `Drop` code for **two tasks** after the shipped code
had diverged from it.

**The rule: when a claim is falsified, grep the whole tree for it — including printed output and example
transcripts — rather than fixing the document that stated it first.** A claim's first statement is
rarely its last copy. Printed legends are the copy most often missed, because they are read by users and
by nobody doing a documentation pass; a stale legend is a wrong answer shipped in a UI.

The corollary this branch also paid for: **correct in place and date it, rather than quietly replacing
the text.** The falsified sentences above are struck through and left standing next to the measurement
that killed them, because in every case the wrong conclusion was reached from individually true clauses,
and a reader who only sees the corrected text learns the fact but not the trap. That is the same
discipline the TM-header and optimizer-tier entries above record from their own reviews — what is new
here is the *printed-output* leg, and the observation that a fix dispatch can introduce a fresh instance
of the class it was dispatched to close.

**Recurrence, 2026-07-31 — the printed-output leg for the third time, and the count short for the
fourth.** `blowup_probe.rs`'s `--beta-curve` printed `"choose MAX_LOGICAL_NODES with margin BELOW that
figure."` — a legend telling a user to calibrate a constant withdrawn with the total-size guard. The
logical-size design had **named** the site twice (its "Four stale references left standing in code"
subsection) and deferred it twice, so this is also the first recorded case of the class surviving *two*
deliberate namings. Fixed with the three doc-comment siblings, and the enumeration of four was again
short by two: `reduce.rs`'s `depth_exceeds` doc cited 300,000 as "the bound the guard's design settles
on" in the present tense, and the probe's own module doc still described the nesting family as one that
lowers, which it has not since `1652e09`. **The figures were not re-pointed at the successor constant** —
`MAX_SHARED_LOGICAL_NODES` measured the largest *shared* subterm, not total size, so 65.75x re-based
onto 10,000 would have been a stale number given a false denominator, which is this lesson's own trap
committed while closing it.

**Recurrence, 2026-08-01 — and the count short for the fifth time.** Reverting the shared-subterm guard
was scoped as three documents plus "the probes' pre-guard notes". The grep found **eight** files needing
edits, including `README.md`'s architecture summary (which asserted the hang was closed), both earlier
designs' status lines, and both plans. `reduce.rs`'s `depth_exceeds` doc was the worst of them: it closed
with "the sizes at which one step does not return are refused before reduction ever starts" — a sentence
that was false the moment the guard came out and that a reader would have taken as a guarantee. Not
declining to re-grep the tree; the tree was re-grepped. **The enumeration written before the grep was
short again, for the fifth consecutive time on this class**, which is now less a warning than a
measurement: on this codebase, a list of consequence sites written from memory runs ~2x short.

#### The sibling lesson: a cost claim is not established until a program chosen to break it has been run (2026-08-01)

Recorded beside the lesson above because it is the same discipline read from the other end. That one is
about a claim that was **once true** surviving where nobody re-greps. This one is about a claim that was
**never true** shipping because nobody looked for the counterexample — and the tree already contained it
both times.

**Three designs on the λ single-step hazard, three falsifications, each by measurement rather than
reasoning.**

**Two of the three are in the table, and which one is missing is this entry's whole subject.** The
first falsification is the structural-sharing design's §10 claim that a term whose logical size runs
away from its physical size was "possible and merely unreached" — falsified 2026-07-31 by 512 bytes of
ordinary source, and recorded struck-through at the λ-structural-sharing entry above. It has no row
because its falsifying program **was not already in the tree**: `examples/blowup_probe.rs` had to be
written to find it. The two below are the ones where the program was already there, already passing,
and already read — which is the failure this entry exists to name.

| design | the claim | what falsified it | where the evidence already sat |
| --- | --- | --- | --- |
| total logical size ≥ 300,000 | "every such program observed so far does not terminate anyway" | a 699-element list literal reduces cleanly in 1,398 steps, 35 s | `lambda/lower.rs`'s own depth-guard test had been constructing it since before the design |
| largest shared subterm > 10,000 | "`subst` copies a shared subterm into every occurrence of the variable" | a two-list program with no recursion scores **4** against 10,000 and takes **19.0 s in one step** | `examples/lambda_sharing_probe.rs` PART B, one branch earlier: `Σ abs×arg` at **86.8%** of visited nodes, its headline finding |

**In both cases the deciding evidence was already in the tree, already passing, and already read by
whoever wrote the design.** Neither was found by re-reading code; both were found by running a program
picked to be inconvenient. Reasoning from the code's shape produced a plausible mechanism twice and both
times the code did something else — the second time contradicted by a number the same author's previous
branch had printed as its headline.

**The rule: before a bound ships, run the program designed to defeat it, and look for that program in
what the repository already runs.** The corpus is calibration, not coverage: it is chosen to be
representative, so it cannot falsify. The 46-program corpus admitted both bounds. The tests admitted both
bounds. What falsified them was one adversarial program each, cheap to write and cheap to run, in both
cases derivable from a number the tree had already measured. **A guard's own instrument should include
the case it is designed to miss**, and the reverted guard's record is what that looks like when it is
added afterwards ([`2026-07-31-lambda-shared-subterm-guard-design.md`](../specs/2026-07-31-lambda-shared-subterm-guard-design.md) §10,
`examples/guard_hole_probe.rs`).

#### The same family, one level up: generate task briefs JUST-IN-TIME, never in a batch (2026-07-31)

Recorded beside the lesson above because it is the same failure — a superseded claim surviving where
nobody re-read — moved from documents into the **execution machinery**.

**What happened, on the logical-size-guard slice.** The controller pre-generated all three task briefs
at the start of execution. Task 2 then corrected an off-by-one in the plan's test literals — the
generator's `nested_groups_src(m)` yields **m+1** groups, so both pinned programs were one level off —
and the correction landed in the plan document (`d738bac`) and in Task 2's report. **`task-3-brief.md`
had already been extracted and still carried the stale literals.** Task 3's implementer hit the failure
on the first run, traced it, found the fix sitting one directory over, and applied it independently.
Nothing was lost, but only because the stale literal happened to fail loudly; the same off-by-one on a
figure that is merely *wrong* rather than *assertion-breaking* would have shipped.

**The rule: a task brief is generated when its task starts, from the plan as it stands then.** A brief
extracted ahead of time is a copy, and this roadmap's whole standing lesson is that copies do not
receive corrections. Batching them converts every mid-run plan correction into a silent divergence for
every task that has not started yet — and mid-run corrections are the *expected* case here, since the
project's stated practice is to correct the plan when measurement contradicts it.

**Why it belongs beside the lesson above rather than inside it.** That one is about *where* a falsified
claim hides (printed output, example transcripts, a second design's summary line). This one is about
*when* a copy is taken: even a perfect grep of the tree cannot reach a brief in git-ignored scratch that
was extracted before the correction existed. The two together are the same rule read from both ends —
**do not make copies you will not re-derive, and re-grep the ones you cannot avoid.**

### Plan 5 — Web UI: editable panes, renderers, linking, detach, caps

- **New app:** `web/` (Vite + React + TypeScript + Biome). CodeMirror 6 panes for source / λ /
  TM (editable + runnable, §7.1); text/table/tape renderers (§6.1); static click-linking +
  dual-focus highlight (§6.2); detach-on-edit + recompile-from-source (§7.1); per-run step/size
  caps with the "still running — hit 50k steps" affordance (§6.4).
- **Depends on:** Plan 4 (WASM package).
- **Testable outcome:** Vitest component tests + a Playwright smoke test (load a program, run,
  see linked highlights, edit a derived pane → detached badge). `npm run build` green (activates
  the CI `web` + `docker` jobs).

#### Accessibility is deferred to one pass at the end of Plan 5, deliberately (raised 2026-08-08, PR 5a-ii)

**The decision, so it is not mistaken for an oversight:** no accessibility work happens per-slice while
the pane set is still changing shape. 5b adds click-linking and dual-focus highlight, 5d makes the λ and
TM panes editable with detach-on-edit — each of which adds, removes or re-purposes controls. Semantics
written now would be rewritten twice and end up a patchwork of three slices' habits. One pass, once the
controls settle, produces something coherent.

**The risk of deferring is that it silently never happens**, which is why this is a list with instances
rather than a note saying a11y is on the todo. Known outstanding, all observed rather than guessed:

1. **A control that hides itself on click strands the keyboard.** Measured on `tm-pane.ts`'s reattach:
   after a click, `document.activeElement` is `<body>`. `pane-chrome.ts`'s `[continue]` shares the
   **added and removed, never disabled** idiom and the same hazard, but not unconditionally — its
   handler is an async worker round trip, and `controls.ts` keeps the button when a run hits `budget`
   again, so it survives its own click in the common case. The idiom is right and should survive — a
   control that provably cannot work should not be offered, which is why `raise_cap`'s refusal of
   `depth_capped` means no button rather than a grey one — so the fix is to move focus deliberately,
   not to start disabling things.
2. **The δ-table toggle relabels itself** (`hide δ` / `show δ`) with nothing announcing that the table's
   state changed. Same shape as the appearance button, which PR #20 solved with an `aria-label` naming
   the current state; nothing else in `web/` has been given the same treatment.
3. **A virtualized table is unreachable by assistive tech, and this is a design question rather than a
   patch.** Only the ~24 rows in view exist in the DOM out of up to 127,881, so the rows a screen reader
   can reach are exactly the rows that happen to be scrolled into view. `aria-rowcount`/`aria-rowindex`
   over a `role="grid"` is the standard answer and it has to be designed against the row *index*
   (§3.2's prefix sum) rather than the rendered window.
4. **State is carried visually only** in three places — `.state-row.is-current`, `.state-row.is-firing`
   and `.cell.head`. Only the first is colour *alone*: `is-firing` adds an outline and the head cell
   turns `.cell`'s transparent border visible and bolds it. What all three share is the real gap —
   **none has a non-visual equivalent**, so none of it reaches a screen reader however it is drawn.
5. **No focus-visible styling was ever specified**, so focus rings are whatever the UA draws over a
   palette that was designed without them in mind.
6. **`#link-status` announces nothing** (added 2026-08-09, PR 5b). It is a live-updating line carrying
   the answer to a user's click — including the common case, at 50–82% TM coverage, where the answer is
   an absence — and it is a plain `<div>`, so a screen reader is never told it changed. It is the
   strongest candidate on this list for `aria-live`, and unlike the rest it carries information that
   exists *nowhere else on screen*.
7. **Three more colour-carried states** (added 2026-08-09, PR 5b): `.linked` in the source pane,
   `.state-row.is-linked` in the δ table, and `.term .is-linked` in the λ window. The first and third
   add an inset underline so they are not colour *alone*; the second is a background only. All three
   share item 4's real gap — **no non-visual equivalent** — and they compound it, because a link is a
   correspondence *between* panes and nothing conveys that relationship except three simultaneous
   highlights a screen reader cannot see.

What already exists, so the pass starts from the right baseline: the appearance control is a real
`<button type="button">` with an `aria-label` naming its current state, updated on every change
(`main.ts`, PR #20) — and, from PR 5b, `Mod-'` links at the caret, so the primary new interaction of
that slice is reachable without a mouse. That is the whole of it.

**5b deliberately added no other semantics**, per the decision above, and its `link-status` line is the
one place where deferring is least comfortable: it is a control whose entire purpose is to report
something the other panes cannot show.

#### ~~`settled()`'s invariant is false, and it is the root cause of the browser tier's flakes~~ — FIXED (raised 2026-08-08, PR 5a-ii; closed 2026-08-09, PR 5b task 1)

**Closed by the first of the two shapes below**, taken deliberately as task 1 of a fresh branch rather
than as a drive-by: `SessionClient` gained `supersede()`, which claims the generation synchronously at
dispatch, and `request(gen, …)` posts only if that generation is still current. The 300 ms window in
which a superseded run's replies were still accepted no longer exists. The note below is kept for the
measurement it records.

One consequence went unnoticed until the whole-branch review and is now item 1 of 5b's residual list:
`client.extend()` silently no-ops for the duration of the debounce, because the worker drops an extend
for a generation it has not yet seen.


`web/tests/browser/app.test.ts`'s `settled(view, src)` is what ~20 browser tests use to mean "the
program I just dispatched has run". Its doc claims: *"there is no stale `'idle'` left over from a
previous test for this to resolve against by accident."* **Measured false**, and two separate flakes on
PR 5a-ii traced to it — one in a test from 5a-i, one added by 5a-ii.

**The mechanism, verified against the code rather than inferred.** `schedule` (`main.ts:304-308`) does
set `results.dataset.state = 'running'` synchronously, which is the half the doc gets right. But it
then defers the actual `client.request` by `DEBOUNCE_MS = 300`, and `request` is the **only** thing that
increments `SessionClient.#gen` (`session-client.ts:33`) — which is the filter that drops replies from
a superseded generation (`session-client.ts:28`). So for at least 300 ms after a dispatch, the previous
generation's replies are still considered current, and its `result` sets the state back to `'idle'`.
`until`'s 50 ms poll then samples in that window and `settled` returns against the **old** program.

The window is far wider than 300 ms in practice, because a `setTimeout` competes with recording: each
`lambda-frames`/`tm-frames` batch is 256 frames and every one triggers a full `draw()`, so during an
extend the timer is starved for **seconds**. Measured timeline, dispatching a new program while the
previous test's extend was still streaming:

```
2 ms      running | spacer 277200px   <- dispatch; `schedule` sets 'running' synchronously
4679 ms   idle    | spacer 277200px   <- PREVIOUS generation's `result`; `settled` resolves HERE
4710 ms   idle    | spacer 8112px     <- the new program's `compiled` finally lands
```

That 31 ms is where `restart returns to step 0 and forward walks out again` read `'not run'`, and where
a state-table test read the previous program's geometry.

**What is in the tree now is mitigation, not the fix.** Two call sites wait for a signal specific to
their own program after `settled` returns. That works for those two and leaves the exposure for every
other caller — including any test whose first assertion depends on `setProgram` having run.

**The durable fix is in the helper**, and there are two shapes: bump the generation eagerly at dispatch
so stale replies are filtered immediately (moving `#gen += 1` out of `request` and into `schedule`), or
give `settled` a signal tied to the dispatched source rather than to a shared state flag. The first is
smaller but touches the supersession machinery that PR 3c's review spent a slice getting right, so it
wants its own measurement rather than a drive-by. **Not attempted on 5a-ii**: changing a helper 20 tests
depend on, at the end of a 30-commit branch, is how a green suite becomes a mystery.

#### A large integer literal kills the wasm module, `MAX_TERM_DEPTH` cannot stop it, and the shadow stack is the wrong suspect (raised 2026-08-09, during PR 5b)

**Typing `let x = 2690; x + 1` into the app destroys the session, unrecoverably.** This language lowers
naturals to unary Church numerals, so the literal *is* the term depth. Measured in headless Chrome, the
threshold is between **2680 (survives) and 2690 (crashes)**.

The sequence: `RangeError: Maximum call stack size exceeded` inside the printer's
`Printer::{node, write, parens}` recursion, and then every later call throws *"attempted to take
ownership of Rust value while it was borrowed"* — a wasm-bindgen borrow guard left taken because a
`&mut self` call aborted mid-flight. The page stays alive; the module is dead.

**IT IS NOT 5b's, and this was checked rather than assumed.** `linkIndex(65536)` reproduces it, but so
does `lambdaState(65536)` with `linkIndex` never invoked — and `session-worker.ts:298`'s `lambdaLeg` has
called exactly that on every compile since `d999ec6`, two commits before 5b's first. The suspicion that
5b's larger print budget newly reached the depth was arithmetically plausible and wrong: `FRAME_BYTES`
is not the only big-budget print, and never was.

**TWO CORRECTIONS TO WHAT THE TREE CURRENTLY DOCUMENTS, and they matter more than the bug.**

1. **The shadow stack is the wrong suspect.** `reduce.rs:48` calls this a sizing problem — *"WASM
   shadow-stack sizing is a Plan 4 follow-up"* — which implies `-zstack-size` would fix it. It would
   not. The overflow is **V8's own call-stack limit** on the JS/wasm frame stack, not the linear-memory
   shadow stack that flag sizes. Anyone who follows that note to its obvious remedy will spend the
   effort and still crash.
2. **`MAX_TERM_DEPTH = 3,000` is set ABOVE the reachable limit, so in wasm the guard is decorative.**
   The crash lands at ~2,690, so the check can never fire before V8 kills the module. A guard that
   cannot execute is worse than no guard, because the code reads as protected. Natively the same
   program is fine in single-digit milliseconds — the constant was chosen against a native stack.

**What would actually work**, unpriced and unimplemented: a guard on `LambdaTerm::depth()`, which is a
cached field and therefore O(1), checked before either big-budget print, margined well under 2,690. It
belongs with whatever revisits `MAX_TERM_DEPTH`, because picking one number without the other repeats
this.

#### Non-progress detection: a TM-only UI diagnostic, and NOT a guard (raised 2026-07-31)

Raised while designing the λ logical-size guard, and recorded here rather than there because it is a
renderer feature, not a safety one. **Nothing in the tree detects this today** — verified by grep:
there is no cycle, spin-loop or non-progress check anywhere, and `non_termination_hits_the_cap`
(`lambda/reduce.rs`) handles Ω purely by exhausting the step cap.

**Why it is not a guard, which is the part worth keeping.** The 512-byte blow-up above is *not* a spin
loop — the term is changing, it is being built, and the failure is that **one β-step never completes**.
Control never returns from `reduce_step`. So a state-change check has exactly the same blind spot as
the two guards that already miss it: `MAX_REDUCTION_STEPS` is read between steps, a wall-clock budget
is read between steps (measured: a 90 s budget produced a 330-second run), and a "did the state move?"
check would be read between steps too. **Anything that runs between steps cannot see a failure inside
one.** ~~That is the whole reason the guard belongs at lowering time.~~ — **corrected 2026-08-01: it is
the reason the check must be read BEFORE a step, which is not the same as at lowering time.** A
lowering-time guard was built on that inference and reverted: the quantity it read is destroyed by the
second β-step while the cost it was meant to bound keeps climbing. "Not between steps" leaves two
placements, and the successor takes the other one — a per-redex work budget inside
`LambdaCursor::next`, priced on the redex about to be reduced. See the λ blow-up entry above.

**On the TM it is decidable, and for a bounded-tape run it is complete.** A configuration is (state,
tapes, head positions); the machine is deterministic, so an identical configuration after a step means
it loops forever — O(tape) to check. Stronger: if tape usage is bounded, the configuration space is
*finite*, so non-halting ⟺ some configuration repeats, and Floyd/Brent cycle detection is a decision
procedure rather than a heuristic. "This machine is in a loop, here is the repeating configuration" is
a much better thing to show than "hit 5,000,000 steps".

**On the λ side it is a trap, for two independent reasons.** First, Ω does β-reduce to itself
structurally, but `beta` rebuilds through `shift`, which allocates on every arm — so the result is a
fresh allocation, `PartialEq`'s `ptr_eq` fast path never fires, and each check costs a full structural
compare, which is O(*logical* size) — the exponential quantity every guard proposed for this hazard has
tried to avoid touching, and none of them is in the tree. **The check would itself be the hazard.** Second, the non-terminations that matter do not repeat: `Y f`
and unbounded recursion produce ever-growing distinct terms forever. It would catch Ω and almost
nothing else. The honest λ affordance is the step cap.

**In general it is undecidable** — it is the halting problem, which is a pointed thing to meet in a
project whose tagline is *"watch the Church–Turing thesis happen."* Worth saying out loud in the UI
rather than hiding: the TM pane can sometimes prove a loop, the λ pane cannot, and that asymmetry is
a real fact about the two models rather than a gap in the implementation.

### Plan 6 — CLI + formatter surface

- **New crate:** `crates/redextape-cli` (bin) — `redextape fmt` (the canonical `print ∘ parse`
  formatter, §8), `redextape lint` (parse/type diagnostics to the terminal), and subcommands to
  emit + run λ / TM artifacts.
- **Depends on:** Plans 1–3 (parsers, printers, interpreters).
- **Testable outcome:** `trycmd`/`assert_cmd` golden tests for `fmt` idempotency and `run` output.

#### What surveying Plan 6 turned up, before it was deferred behind Plan 4 (2026-07-30)

Plan 6 was surveyed as the next slice and its dependencies confirmed present, then deferred: the
highlighting work it wanted turned out to be Plan 4's deliverable, and the CLI reads better as a consumer
of that than as a thing growing its own span layer. What is recorded here is what the survey found, so the
next reader does not re-derive it.

**`fmt` needs a surface printer that does not exist.** λ, TM and asm all have printers; the mini-language
has a parser and no printer. §7.2 defines the formatter as exactly `print ∘ parse`, so this is the bulk of
the work, not a wrapper over something existing.

**The blocking decision for `fmt` is comment retention, and it is bigger than the printer.** `lexer.rs`
skips `//` comments entirely, so a `print ∘ parse` formatter over an AST that never saw them **deletes
every comment in the file**. Either trivia gets attached to tokens/AST, or `fmt` is comment-destroying and
unshippable. Decide this before writing the printer.

**That decision now has a second consumer, so do it once.** Plan 4's producer slice shipped
`analysis::classify_source`, and it can never emit `TokenClass::Comment` for exactly the same reason —
the lexer discards comments, so `TokenKind` has no variant for them. The one class every source
highlighter needs is unreachable on the source path. Whoever settles trivia representation serves both
`fmt` and the highlighter; settling it for either alone means redoing it. See item 4 of the deferral list
under Plan 4 above.

**Already present, contrary to an earlier reading:** `value.rs` exports `format_value`, so `run` output
needs no new formatting (`42`, `[1, 2, 3]`, `()`), and `examples/tm_emit.rs`, `tm_demo.rs`,
`lambda_demo.rs`, `step_survey.rs` already do most of what emit/run subcommands need.

**Genuinely missing and unclaimed:** `parse_asm`. The asm form prints but cannot be read back — this entry
promised it (see Plan 3's key interfaces) and it never landed. Only needed if the asm pane should
round-trip or be editable like λ and TM; costs a parser plus round-trip proptests, so priced and left out
of v1 unless a consumer asks.

**Stays with Plan 6:** colouring the *source* language, which needs no new producer — `lexer::lex` already
yields `Token { kind, span }` — and is what `lint` output actually wants. Also the printed-form token spans
for λ/TM/asm if Plan 4's `analysis.rs` has not already covered them by then; that half was the one piece of
the highlighting work no plan claimed, and a CLI dump is its natural consumer.

## Deferred beyond v1 (tracked, not planned here)

- **v1.5:** reference-clock synchronized stepping (§6.3) — the deferred hard part (order mismatch,
  §13.1).
- **v2:** graphical renderers (TM flow/state diagram, Tromp diagrams), linter rule sets,
  `redextape-lsp`, visible assembly pane, single-tape TM view, signed integers (§11).
- **Research track:** bidirectional editing feasibility — report + prototype, not a feature (§7.3).

### Extension tracks (raised 2026-07-22, expanded 2026-07-23 — placement recorded, not yet planned)

Several directions on different tracks. **None is on the critical path**; all are post-Plan-3.
Suggested order for the compiler-shaped work: single-tape TM → optimizing compiler (+ native backend,
its Tier C) → tree-sitter; the alternative front-ends, self-application demos, and terminal
visualization are each independent and can slot in anywhere. Closures/higher-order (Plan 3b) is a
separate axis. The unifying architectural fact behind most of these tracks: **the Core AST is the
front-end hub and the register-asm (`Instr`) IR is the imperative-backend hub** — front-ends plug
*into* Core, backends plug *out of* Core (λ) or *out of* asm (TM, native), optimizations live at
whichever hub maximizes reach, and visualizers are pure *consumers* of the traces the backends already
produce. The oracle validates every combination.

- **Binary-encoding follow-ups left on the table (2026-07-27).** The final whole-branch review found no
  defect that changes an answer, no totality hole, and no ladder rung whose assertions fail to bite on
  binary shapes. These are what it filed instead of blocking; each records why, so a future reader can
  weigh rather than rediscover.

  1. **DONE (15ed8dd). `Binary::arith`'s `Mul` has no lowering-size guard, and reaches an allocation abort from a ~1 KB
     source.** `Mul` is O(width²) STATES per instruction (`1.5w² + 26.5w + 13` for the gadget alone:
     143 at width 4, 7,853 at 64). Measured on `2 * 2 * … * 2` at width 64: 128 muls → 6.8M states,
     19.6M rules, **4.57 GB** peak RSS, where unary needs ~8 KB of source to reach comparable size.
     Unary is already quadratic in program length, so this is a ~35× worsening of an existing class
     rather than a new one — but "no input may crash any process" is the cardinal rule, and
     `lower_tm.rs` already establishes both the policy and the mechanism for exactly this
     (`MAX_SLOTS`/`MAX_FRAME_LOC` refuse BEFORE building, returning a degenerate halt machine).
     **Shipped:** `mul_count_unrepresentable` + `MAX_MUL_INSTRS` (32, cheap predicate: too many `Mul`
     instructions, checked unconditionally on encoding since unary reaches the same danger zone more
     slowly rather than never), refused before `lower_tm_all` builds anything, mirrored by `attribute`.
     A new `TmRun::TooLarge` reports it (and `MAX_SLOTS`'s existing refusal moved to it too, for
     consistency) rather than `HitCap`/`Overflow` — measured exactly two exhaustive `match` sites in the
     whole workspace that needed a new arm for the variant, both updated. Done together with item 1 of
     the "TM bank-safety" filing below (the same `run_tm`-mirrors-`lower_tm` story, in the same
     functions).

  2. **DONE (2026-07-27). `Binary`'s decode was width-strict; `Unary`'s is not — and the asymmetry
     was removable.** `decode_nat`/`parse_heap_cells` required a field to close exactly at `width`, so a
     tape fitted at 16 cells decoded to `None` under `Binary::default()` (64). Both now read from one
     delimiter to the next and never consult `self.width`, so any instance decodes any tape; shared
     `digit_run` (tied to `BITS`) and `word` (LSB-first, `None` past 2^64) replace the two inline loops.
     Structural is not permissive — a field must still be CLOSED by a `#`, so a run stopped by a foreign
     symbol, a run off the end of the tape, and a slot past the last field all still yield `None`.

     **The cost landed where the plan did not predict.** Giving up the width-length check was known and
     accepted; what was not written down is that this check was the RECORDED COMPENSATION for item 6's
     `heap_tape_is_well_formed` gap, so removing it would have left binary heap word length unverified
     anywhere. And the hole is invisible to every value assertion: digits are LSB-first, so a word
     truncated from its HIGH end when those digits are zero spells the SAME number (`@0#00` and `@00#00`
     both parse to `[(0, 0)]` at width 2). New `Encoding::heap_word_len` (`None` for unary, whose heap
     words are value-length mark runs; `Some(width)` for binary) moved the check into the checker in the
     same slice. REG needed no such move — `reg_bank_is_well_formed` already pins the skeleton at
     `1 + slots * (width + 1)` cells.

     Callers were NOT churned. `run_tm_fitted` + `at_width` is now redundant rather than required, and
     every site kept it with its doc corrected to say why it stays (the width names a failure, and it
     keeps `at_width` on the executed path). Removing it would delete coverage, not add clarity.

     **One more instance of the recurring pattern, caught by measuring instead of assuming.** The
     end-to-end test's first corpus (`1 + 2 * 3`, `[1, 2, 3]`, `head(tail([4,5,6]))`, `sum(4)`) fitted
     BINARY at 4 for every program — `MIN_FIELD_WIDTH`, the narrowest width there is — so the "read at a
     NARROWER width than the tape was written at" case never happened for the one encoding the test
     exists for; unary hid it by fitting at 8/16/32. Values in [16, 31] put unary at 32 and binary at 8
     simultaneously. Now asserted from both ends (`MIN_FIELD_WIDTH < width < MAX_FIELD_WIDTH`), and
     sabotage-verified that the narrow reader earns its place: a ONE-SIDED width dependence
     (`if n > self.width { return None }`) is accepted by the default reader AND the fitted reader, and
     caught only by `read at 4`.

  3. **DONE (8f49a06). `ripple_add`'s `c1 -> overflow` exit checked only REG's `SEP`** while `c0 -> fin` checks both
     tapes, and `ripple_sub`'s two exits both check both. Safe today by equal-width lockstep (and rule
     ordering cannot misfire — the four digit rules precede it and require an explicit digit on both
     tapes), but the asymmetry is unexplained in the file, and a future desync would be mislabelled
     "overflow" rather than surfacing as a stuck halt. One line.

  4. **DONE (8f49a06). `skip_cells` sat under the "HEAP tape sub-primitives" banner** though in
     `binary.rs`, with eleven call sites (3 HEAP, 8 BOX). Pure relocation into a shared-primitives
     region; work that greps by section banner could miss it.

  5. **DONE (8f49a06), and it was bigger than filed. `three_way_oracle.rs`'s `tm_val` was unary-only** — and it drove not one test but the
     ~14 metamorphic law proptests (arithmetic, list, mutation, closure, if, map_head, monus,
     distributivity) via `assert_equiv`, while its sibling `three_way_value` in the same file had been
     made four-way. Two value-oracle paths, one updated and one not: precisely the drift shape this
     branch kept finding. Now `tm_val_with(src, enc)`, checked under both encodings with the encoding
     named in every failure message, and verified to actually run by decoding the binary tape at
     `width + 4` and watching `arithmetic_laws` fail on `binary-TM violates the law (lhs): 0 + 0`.

  6. **Two checker limits. One FIXED (2026-07-27), one still documented-not-fixed.**
     `heap_tape_is_well_formed`'s missing word-LENGTH check is now **CLOSED** — item 2's structural
     decode deleted the compensation that made the gap tolerable, so the check moved into the checker
     via `Encoding::heap_word_len`. See item 2.

     Still open: `assert_delimiter_safe` infers "WORK is a fixed-width bank" from
     `!enc.init_work().is_empty()` — a proxy for a property the trait does not state, so a third encoding
     with a structured-yet-initially-empty WORK would be silently unchecked. It carries a `KNOWN LIMIT`
     block in `tests/common/mod.rs`, so a reader of the checker finds it rather than a reader of this
     roadmap. Deferred because inventing the trait predicate now means guessing what it should mean; the
     third encoding that would settle it does not exist yet.

- **Self-describing TM text form (optional header) — DONE (2026-07-28).** Spec:
  `docs/superpowers/specs/2026-07-27-tm-self-describing-header-design.md`; plan:
  `docs/superpowers/plans/2026-07-27-tm-self-describing-header.md`. A `.tm` file now records **both
  halves of a Turing machine**: δ and q₀ as before, plus the initial configuration — the literal initial
  tapes, so any simulator can run it, and the `encoding`/`width`/`slots`/`result` recipe needed to
  interpret the answer. `tests/tm_header.rs` turns a checked-in 464-line fixture into a `Value` with no
  `Core`, no `lower_tm` and no reference run; that test is the one that could not have been written if
  any part of the header were insufficient.

  **What it guarantees:** a foreign tool can RUN a `.tm` file. **What it cannot:** that tool cannot
  INTERPRET the result. Decoding needs the encoding's semantics, and a name cannot convey them. The
  asymmetry is inherent — running is universal, interpreting is not — so the header closes the gap it
  can close and names the gap it cannot.

  **Optionality is free and is pinned by four properties** (`tm/syntax.rs`), because a header adds no
  capability to the machine — it removes an INPUT requirement. Property 4 (a header-less file yields
  `None`, *not* a diagnostic) is the one that would regress silently, since a parser taught to
  recognize directives is a parser that can start requiring them. `Machine` gained no field, per the
  rule `lower_tm.rs` states twice; `tm/header.rs` does not even import `Machine`, so that rule holds at
  the import level rather than by convention. `print_tm`'s output is byte-identical to before the
  branch, pinned by the pre-existing listing golden.

  **The historical framing that motivated this slice was already stale when it started, and the
  correction is worth keeping.** The binary branch's width-STRICT decode — a tape fitted at 16 cells
  decoding to `None` under a 64-cell `Binary` — was cited as the concrete symptom. Structural decode
  removed that symptom before this slice began, but not the underlying gap: a file still recorded no
  initial tapes, no slot count and no result type. One consequence propagated all the way into the
  test design: **`width` is invisible to the end-to-end decode**, because `Binary::decode_nat` and
  `parse_heap_cells` each state outright that `self.width` is never consulted. It is visible only to
  the consistency check, where `init_reg` writes `width` cells per field. A sabotage aimed at the
  end-to-end test would have proved nothing.

  **Two findings the slice produced beyond its own scope.**

  1. *A totality hole, latent until this slice made it reachable.* `asm.rs`'s `decode_word_ty` recursed
     on the heap chain under a type that never shrinks for `List`, so a **cyclic heap overflowed the
     stack**. Unreachable while every heap came from the compiler — a cons cell's tail points only at an
     earlier cell, so compiled chains are acyclic — and reachable the moment a heap can come from a
     FILE. The spine is now a loop bounded by one step per cell, so a cycle decodes to `None`.

  2. *Thirteen instances of "the guard proves less than its name claims" across both slices — and **the majority originated in the
     PLAN**, not in the implementations.* Each was caught by a review instructed to hand-trace the
     claim rather than accept it:

     | where | claimed | actually asserted |
     |---|---|---|
     | long-list decode test | "must not change any acyclic answer" | length + nil terminator only; a reversed rebuild passed |
     | `print_tm` prefix-strip test | header lines removed | safe only by a one-character margin (`"tapes 1"` vs the `"tape "` prefix), undocumented |
     | malformed-header test | its own name says "spanned diagnostics" | `start <= end <= len`, which `{0,0}` satisfies |
     | range-check ordering | the check lives in `finish` *because* directives are order-independent | never tested with the lines reversed |
     | described-run test | "computes what an ordinary run computes" | `is_some()` |
     | tape-flip sabotage | flipping a literal tape cell reddens the end-to-end test | a DATA cell cannot — `lower_into` writes `Rr` unconditionally and the decoder reads only REG slot 0, so `Rr`'s data cells are structurally write-before-read |
     | WORK consistency equation | one of two load-bearing equations | vacuous under `Unary` (`init_work()` is empty, and empty tapes are dropped) |

     **The two most instructive were found by RUNNING the check, not reading it.** The tape-flip
     sabotage was discovered when an implementer ran it, watched it fail to fire, and root-caused it
     rather than adjusting the assertion until it passed. And the `{0,0}` span bug was living inside a
     test with the word "spanned" in its name. This is the same lesson the optimizer-tier and
     source-map branches recorded; what is new is *where* it was caught — six times in plan text,
     before it became a green test nobody would question again.

  **One new registration point:** a third encoding must be added to `EncodingKind` and its `parse`,
  which is inherent to a format that names its variants.

  **Slice 2 — hardening, versioning and tooling (2026-07-28).** Spec:
  `docs/superpowers/specs/2026-07-28-tm-header-hardening-and-tooling-design.md`. Slice 1's own
  whole-branch review returned *Not ready*, and the shape of its three findings is the lesson: the
  branch's stated threat model — "a `.tm` file is untrusted" — was honoured in two places and abandoned
  in two others. It had closed a cyclic-heap stack overflow in code unreachable in-tree, while three
  file-supplied integers (`tapes`/`slots`/`width`) fed eager allocations with no cap, and the
  type-directed decoder's cost was exponential in a file-controlled type depth. **A hardening argument
  that applies to one input and not its three siblings is not a hardening argument.**

  Fixed: `MAX_TAPES` plus the existing `MAX_SLOTS`/`MAX_FIELD_WIDTH` now gate the parser (both
  directions tested — the value AT each cap still parses); `MAX_DECODE_NODES` bounds the decode's
  total SIZE, a guarantee separate from the spine loop's cycle bound; and optionality property 2 is
  pinned on compiled 5-tape machines under both encodings rather than one hand-built toy.

  **Two things slice 1 recorded as deliberately not done, which slice 2 then did.** A format `version`
  directive (always emitted, absent means 1, unknown is a hard error — because a future version could
  change what `width` or `slots` MEAN, and a warning would let a v2 file decode to a confidently wrong
  value). And a file-emitting entry point: `examples/tm_emit.rs`, `emit` and `run`, which makes the
  headline claim executable outside the test harness. Both entries above are struck rather than
  deleted, so the reasoning that judged them speculative stays visible next to what changed it.

  **`tests/tm_foreign_reader.rs`** is the slice's most unusual artifact: an independent simulator and
  unary decoder written from the doc comments rather than the implementation, which found three
  documentation gaps. Its own header records the residual honestly — the compound (heap) decode was
  brief-derived, not doc-derived, so that half remains asserted rather than demonstrated.

  **Still open after slice 2**, in rough order of how likely they are to bite:

  1. **`decode_word_ty` is not sharing-aware.** `Instr::Tail` is a pointer READ, not an allocation, so
     an ordinary `tails`-style function returns a `List<List<Nat>>` whose inner lists share the outer
     spine — `~2m` heap cells but `m² + m + 1` decode nodes, because the decoder re-walks each shared
     sub-list once per pointer into it. Breakeven `m ≈ 4,471`, three orders of magnitude below the heap
     cap, so **a correct, fast, cap-respecting program can still be refused** (a refusal, never a wrong
     answer — which is why it does not block). No constant closes it: raising the budget to cover
     `d = 2` reopens `d = 3`. The fix is memoizing on `(pointer, type)`. **This applies to
     `decode_asm_ty` on the AOT path too** — a second consumer that will not read this branch's specs.
  2. ~~`attribute.rs` builds an `init` setting only REG.~~ **FIXED (2026-07-28) — and it was a LIVE bug,
     not the latent one this entry predicted.** `lower_mapped`'s doc claimed it mirrored `run_tm`'s
     lowering "step for step" while seeding only REG. Under `Binary`, `init_work()` lays out a real
     bank, so the machine walked off a bank that was not there, hit a rule-less state, and HALTED —
     and a rule-less halt is indistinguishable from a real one, so `capped` stayed false and callers
     were told they had a COMPLETE execution. `sum(5)` attributed to **329** steps against a real
     **223,886**; `1 + 2 * 3` to 1,436 against 58,393. The corrected figure is 10.2x the unary 5,724,
     exactly the ratio the binary-encoding branch independently recorded for that Mul-heavy program —
     the strongest available evidence the number is now right rather than merely different. Every
     step-attribution figure ever produced under `Binary` was wrong; the `Unary` ones are unaffected.
  3. `run_tm_fitted` and `run_tm_described` each carry their own `MIN_FIELD_WIDTH`/doubling/`Overflow`
     retry loop. They agree today and nothing pins that they keep agreeing.
  4. ~~Header directives are accepted anywhere in the file.~~ **FIXED (2026-07-28).** The grammar always
     said they must precede the first `state`; the parser accepted them anywhere. Enforced now
     precisely because nothing this project emits was affected — the printer always writes the block in
     position — so the set of files a stricter parser would break was still empty. That set only grows.

- **λ typed decode + foreign reader — DONE (2026-07-28).** Spec:
  `docs/superpowers/specs/2026-07-28-lambda-foreign-reader-and-typed-decode-design.md`; plan:
  `docs/superpowers/plans/2026-07-28-lambda-foreign-reader-and-typed-decode.md`. The λ backend had the
  two gaps the TM header branch had just closed on its side: a printed normal form could not be
  INTERPRETED without a reference run, and every test of "any reducer can read this" used OUR reducer.
  Both are closed, and **λ needed no header to close them** — `print_tm` serialized half a machine, but a
  λ term IS its whole configuration, so importing the TM's answer would have been cargo-culting a
  solution to a problem this backend does not have.

  **Shipped.** `lambda::decode_lambda_ty` as a SIBLING of `decode`, with both deliberate disagreements
  pinned (nil under a `Cons` witness; `Unit`) so re-expressing either over the other cannot quietly
  loosen the oracle's list-length check. Its list spine is walked ITERATIVELY, and the spec's A2 answer is
  narrower than this branch first wrote it. `decode_cons` destructures `nf` before it consults `expected`
  and descends only where BOTH are cons-shaped, so `decode`'s depth is `min(expected's spine length, nf's
  own cons nesting)`; the term is the binding half, because every producer caps term depth
  (`MAX_TERM_DEPTH` = 3,000, `MAX_PARSE_DEPTH` = 256 — about 750 frames at four term nodes per Scott
  cell). Safe on a normal stack, so `decode` was left recursive. What it is NOT is "bounded by a `Value`
  the caller already holds and so needs no guard of its own" — a caller-held spine is millions of cells,
  the very premise the branch's own next commit acted on in `value.rs` (below). `decode_lambda_ty` is
  iterative because it is new code that could drop the data-proportional axis for free, not because
  `decode` enjoys a guard it lacks; **removing the axis beats bounding it**, and it survives
  directly-built terms past every producer cap as a result.
  No node budget, either: `decode_tape_ty` needs one because the TM heap is a graph that can cycle and
  alias, whereas a λ normal form is a finite tree already in memory. And `tests/lambda_foreign_reader.rs`
  — its own term type, parser, normal-order reducer and Church/Scott decoder, written from doc comments
  only, consuming the printed LOWERED term so the reducer is genuinely exercised (3-626 β-steps per row,
  asserted `> 0`, so no row can pass by decoding something already in normal form). All 13 corpus rows
  agreed with the reference **on first run, with no adjustment to the reducer**.

  **THE FINDING, and it was live.** `print_lambda`'s output did not reparse in `parse_lambda` for any
  program with mutable state: `lower.rs` binds store-passing state as `$store`, and the lexer accepted
  only `_` and ASCII alphanumerics. `parse_print_round_trips` had proptested exactly that property since
  Plan 2 and could never have caught it, because its generator emitted exactly **two binder hints**.
  *The guard proved less than its name claimed, and the gap was in the generator, not the property.* The
  generator now draws from a hint pool including `$store`, and the fix was sabotage-checked: reverting
  the lexer change must make the proptest fail with a `$store` counterexample. Also written down, because
  the foreign reader needed it and could not find it: the identifier grammar, and the naming rule that
  makes printed output unambiguous — `fresh` checks the full ancestor chain, so no binder shares a name
  with any binder ENCLOSING it and the parser's rightmost-in-scope match is **exact, not a convention**.
  The spec expected the α-renaming rule to be the missing piece; it was sound and merely unwritten, and
  the cruder defect above was the real one.

  **A pre-existing defect the branch surfaced by accident, in code neither section named.** `value.rs`'s
  `Drop` is hand-written and iterative, and its own doc gives the reason: a list built at runtime is a
  `Value::Cons` spine whose length is bounded only by the step budget, so millions of cells. `PartialEq`
  and `Debug` walked that same spine RECURSIVELY — so the premise that made `Drop` necessary made both
  of them overflow at exactly the lengths `Drop` was written to survive. Both are iterative now. The
  follow-up commit is worth its own line: the first `Debug` fix was O(n²) (rebuilding a string per cell)
  in a function whose own doc cites "millions of cells" — it satisfied the LETTER of the finding (no
  recursion, no overflow) while leaving the same premise unmet along a different axis.

  **The recurring pathology showed up twice on this branch, and the second instance is the sharper one.**
  (a) `decode.rs` shipped doc blocks asserting a `value.rs` property that **the branch's own next commit
  falsified**; corrected in `fix(value,lambda): correct stale docs and make Debug O(n) over the spine`,
  cited by SUBJECT rather than by hash on purpose — a hash written inside the branch it names cannot
  survive that branch's own rebase, and this entry originally carried one that had already gone dangling.
  (b) The foreign reader's finding 10 claimed `MAX_PARSE_DEPTH` had
  "no doc comment at all". It has one, and that doc answers the exact question the finding posed. The
  cause is the instructive part: the doc extraction used `grep '^//!'`, which **by construction cannot
  match a `///`** — absence of evidence recorded as evidence of absence, inside the one artifact whose
  entire value is its accuracy. The correction is recorded IN the findings list along with its mechanism
  rather than silently applied, because a findings list that quietly drops a false entry teaches the next
  reader nothing.

  **Honest bound — what the foreign reader does NOT establish**, stated because the file's title suggests
  more. Its `shift`/`subst`/`beta` share the originals' names, signatures, TAPL (§6.2) formulation and
  one verbatim doc line — all permitted, since signatures and doc comments were on the reading list, but
  the consequence is that **the substitution layer is not an independent cross-check**: a shared
  TAPL-level misreading would be invisible here, both implementations agreeing and both wrong the same
  way. The genuinely independent component is REDEX SELECTION — which side of `App` reduces first,
  whether reduction descends under `Abs` — and that is precisely where the one correctness finding came
  from. Four of the eleven findings are additionally marked UNEXERCISED: the corpus cannot falsify them,
  so they are guesses the file does not license anyone to rely on.

  **What stays open**, in rough order of how likely each is to bite:

  1. ~~Nothing documents that the format REQUIRES normal order.~~ **DONE (2026-07-28).** It was a
     correctness gap, not a doc gap: an applicative-order reader does not merely differ from ours, it is
     **non-terminating**, for three independent reasons each sufficient alone. `Core::If` lowers to
     `app(app(cond, then), else)` with both branches unthunked, so call-by-value evaluates the branch not
     taken and `sum(5)`'s base case can never stop the recursion; `fix` is the call-by-name Y, whose
     `x x` argument regenerates the same redex forever under call-by-value (Z is the call-by-value
     combinator, and nothing in an emitted term says which was intended); and `head`/`tail` pass Ω as
     their `nil` branch on EVERY call, so even `head(cons(7, nil))` hangs. A faithful independent
     implementer, reading everything we published, could build something that hangs. Now stated
     normatively in **`reduce.rs`'s module doc** — all three mechanisms, not one, because they are what a
     later optimization pass would have to retire before relaxing the requirement — with a cross-reference
     from **`encode.rs`'s module doc**, where `diverge()` is defined. Written down alongside it: why this
     misleads a COMPETENT reader. β-reduction is confluent, so any two sequences that reach normal forms
     reach the same one — correct about UNIQUENESS, and silent about REACHABILITY, which is the separate
     standardization result. The docs were quiet exactly where correct prior knowledge points the wrong
     way, and the symptom (a step-cap timeout) misdiagnoses as "cap too low".
  2. **DONE (2026-07-29). No reader-facing file records that the encodings collide.** `true` and `nil`
     are both `Abs(Abs(Var 1))`; `false` and `church 0` are both `Abs(Abs(Var 0))` — so a result type is
     needed in PRINCIPLE, not as a convenience. The fact was documented only in `lambda/decode.rs`'s
     module doc, and that file is correctly off-limits to a foreign reader (it describes the very
     strategy such a reader must rederive), so the fact was invisible to the one reader it mattered to.
     **Shipped:** a paragraph in `encode.rs`'s module doc — the collision, both colliding pairs, and that
     it propagates through structure (a one-element Scott list holding either collides too, so the
     problem is not confined to the leaves) — plus a NEW paragraph added to `syntax.rs`'s module doc, the
     file where a foreign reader actually meets the problem, stating for the first time in that file that
     this text form carries no result type and pointing back to `encode.rs` for the full statement. (The
     phrase itself did not already live in `syntax.rs`, or anywhere under `lambda/`, before this branch —
     it previously appeared only in `tests/lambda_foreign_reader.rs` and a prior branch's planning docs;
     this entry understated what shipped as much as it overstated it.) The one
     non-obvious decision: the new paragraph deliberately does **not** cite `decode.rs`, even though
     that is where the collision was first written down — pointing a foreign reader at the file they are
     told not to open would reintroduce the exact gap this item exists to close.
  3. **DONE (2026-07-28). `term.rs`'s `shift` WRAPPED on a negative result** — `(i64::from(*k) + d) as u32`
     silently produced a huge index instead of failing. Reachable only on an open term, which the compiler
     never produces, so it was latent rather than live; but the undocumented case had silent corruption
     behind it in production code, not merely an unstated convention. **Shipped:** an UNCONDITIONAL
     `assert!`, not a `debug_assert!`, on the strength of a measurement — five release runs put the
     guarded version's range around the unguarded one (0.2078–0.2191s vs 0.2123–0.2151s for 2,000 shifts
     over a 400-deep term), i.e. the cost is below run-to-run noise, so the weaker guard bought nothing.
     A miscompile is worse than a crash, and `debug_assert!` would have left release builds wrapping.

     Two things worth keeping from doing it. The deferral had reasoned "nothing can exercise it" — true of
     compiled output, but `shift` is `pub`, so `shift(-1, 0, &var(0))` reaches it directly, and
     `shift_panics_instead_of_wrapping_to_a_dangling_index` is that call. **Sabotage-checked:** deleting
     the `assert!` makes that test the only thing in the tree that notices. And the invariant keeping this
     unreachable is not local to either function — it holds because `subst`'s `j + 1` and `shift`'s
     `cutoff + 1` step in lockstep under `Abs`. Two functions agreeing by construction is what a refactor
     breaks silently, which is the actual argument for a permanent check.
  4. **DONE (2026-07-28). Two minors in the freshening work itself.** `fresh`'s fallback to `"v"` on an
     empty hint is now stated in the naming-rule doc, and the `hint{k}` notation is spelled out as
     digit-appending with an example (`x` collides → `x0`, `x1`, …) rather than left to be read as literal
     braces.
  5. **§C's residual.** Resolved as "nothing" — the λ text form carries no result type, because every
     consumer already holds one and none receives text without the program it came from. Open item 2
     above is the sharpened version of the same fact and does not change the answer: the collision proves
     a type must EXIST, not that it must travel IN the text. A `.lam` file handed to another tool would
     flip it, and wants `run_lambda` returning the type before it wants a `; result:` line — see the
     spec's §C, which records the grep the criterion turned on.

- **Single-tape TM — backend/theory track, highest thematic payoff.** Build it as a *transformation*
  on the finished `Machine`, NOT a separate compile target: multi-tape → single-tape via the textbook
  `2k`-track interleaving simulation (per tape: a content track + a head-marker track on one tape over a
  product alphabet; each multi-tape step becomes a scan-heads / apply-and-move sweep). This *executes*
  another theorem — multi-tape ≡ single-tape — extending "watch the Church–Turing thesis happen," and
  drops straight into the oracle as a new leg: `reference == λ == multitape-TM == singletape-TM`. It is a
  pure `Machine(k-tape) → Machine(1-tape)` fn + a decode that un-interleaves the tracks; touches nothing
  in Core/asm/encoding — one interface, one oracle test. **When:** right after 2b-2-iv, while the
  multi-tape oracle context is warm. **Risk:** quadratic slowdown → generous caps + a product-alphabet
  decode (keep the alphabet a tuple, not a blown-up power set). This *supersedes* the passive "single-tape
  TM view" listed under v2 above — the reduction is the interesting artifact; the view falls out of it.

- **Machine-model reductions — a PIPELINE, of which single-tape is stage 1 (raised 2026-07-27, not yet
  planned).** The project varies two things today: the COMPILATION TARGET (reference / λ / TM / native)
  and the REPRESENTATION INSIDE a machine (unary / binary `Encoding`). It has never varied **the machine
  model itself**, and that is the axis where each step is a named theorem. The architectural principle
  is already stated for single-tape above and generalizes to all of these: a `Machine -> Machine`
  function plus a decode-unwrapper, touching NOTHING in Core, asm or `encoding`.

  **Tier 1 — three reductions that COMPOSE, and whose composition is the punchline.**

  | stage | theorem | cost |
  |---|---|---|
  | k tapes → 1 tape | multi-tape ≡ single-tape (2k-track interleaving) | quadratic |
  | arbitrary alphabet → `{0,1}` | alphabet reduction; each symbol becomes a k-bit block | ×k length, ×O(k) steps |
  | two-way tape → one-way | fold the tape at the origin onto two tracks | ~×2 |

  Apply all three and the result is the most austere machine in the textbook — **one tape, one head, two
  symbols, infinite in one direction only** — running a mini-language program, with each stage
  independently validated as its own oracle leg. The tape-folding stage is genuinely available: `sim.rs`'s
  `Tape` is a zipper with both ends growable, i.e. two-way infinite today.

  **Why this project in particular.** "Polynomial slowdown" is normally a hand-wave; here step counts are
  exact integers, so each reduction's real cost becomes a measured table on actual programs. That is the
  same move the binary-encoding slice just made, where a *predicted* slowdown turned out to be a 0.51×
  speedup once bank width was allowed to vary — the prediction was right about the mechanism and wrong
  about which effect dominates, and only measurement showed it.

  **Tier 2 — different machine MODELS (more striking, much more expensive; each needs its own simulator
  and decode, so these are not `Machine -> Machine`).**
  - *Universal TM.* Encode the machine as a tape string and run it on ONE fixed machine — the deepest
    theorem available. Direct synergy with the self-describing header slice above: a `.tm` file that
    carries its own initial configuration and result type is most of what a UTM needs as input.
  - *Two-counter (Minsky) machine.* Two integers plus increment/decrement/zero-test is Turing-complete;
    "your program, reduced to two numbers" is arresting. **Honest caveat:** the standard 2-stack →
    2-counter route uses Gödel encoding (`2^a · 3^b`), so the counters explode astronomically — realistically
    demonstrable only on trivial programs, with step counts to match.

  **Tier 3 — property-preserving variants.** A *reversible* TM (Bennett) — every step undoable, costing a
  history tape — connects computation to thermodynamics and the Landauer limit, which no other track here
  touches. An *oblivious* TM (head motion independent of input) is mainly a stepping stone to circuit
  constructions.

  **Two architectural notes, both worth settling BEFORE the first reduction ships.** (1) *Orthogonality.*
  `Encoding` varies representation WITHIN a machine; a reduction varies THE MACHINE. They must compose
  freely — binary × single-tape × 2-symbol should be a legal combination — which means the oracle's legs
  become a PRODUCT of the axes, not a sum. Decide early whether CI runs every combination or only a
  diagonal, because the cost is combinatorial and the exhaustive sweep is already the slow tier's
  dominant term. (2) *The header slice becomes load-bearing rather than a nicety.* With a family of
  machine shapes in play, "which shape is this and how do I read its tape back" stops being optional;
  a reduced machine whose initial configuration and result type travel with it is what makes a pipeline
  inspectable at each stage.

  **RECOMMENDATION: alphabet reduction to `{0,1}` is the best one to do after single-tape.** It is a pure
  `Machine -> Machine` function, it is the natural companion to the binary `Encoding` work just finished —
  and the contrast between the TWO SENSES OF "BINARY" (how a NUMBER is represented in a field, versus how
  a SYMBOL is represented in cells) is itself worth documenting, since conflating them is the obvious
  misreading — and composing the two reductions reaches the canonical machine, which is a satisfying
  place for this project to arrive.

- **Optimizing compiler — IR track, oracle-guarded.** Optimization passes over the IR. Motivation:
  (a) practical — TM step counts explode (unary arithmetic, STACK recursion, quadratic single-tape), and
  slot-count / register-width drive tape length, so shrinking the program shrinks the machine and its
  step count; (b) pedagogical — "optimization preserves semantics" is itself an oracle story
  (`optimized == unoptimized == reference`). The strong existing oracle auto-validates every pass on the
  demo corpus + proptest, making this project unusually SAFE to optimize.
  **Optimization lives at three tiers, and the earlier a pass sits, the more backends it helps:**
  - **Tier A — Core → Core (helps λ *and* TM *and* native).** Constant folding, DCE, CSE, inlining,
    copy/const propagation, algebraic identities, **closure specialization**. Backend-agnostic — optimize
    once on Core and a smaller Core yields a shorter λ term (fewer β-steps), a smaller/faster TM (fewer
    states + steps), *and* faster native. Highest leverage; `defunc` already proves the Core→Core pass shape.
    *Which* of these to build, and in what order, is no longer a guess — see **the ranked pass set** below.
  - **Tier B — asm → asm (helps TM + native, not λ — λ lowers Core→λ directly, bypassing asm).**
    Register allocation / slot minimization (shrinks the REG bank + tape length most), peephole,
    dead-store elimination, jump threading, strength reduction on the `Instr` stream. **The survey's
    #2 target — `Ret`'s frame-restore — lands here, not in Tier A**, which is the one place the measured
    ranking cuts across the tier order.
  - **Tier C — native codegen (native only): DONE** (merged 2026-07-24, `e7ca13b..451cbb4`; spec
    `docs/superpowers/specs/2026-07-24-tier-c-opt-measurement-design.md`, plan
    `.../plans/2026-07-24-tier-c-opt-measurement.md`). GVN, LICM, loop unrolling, vectorization, native
    regalloc — the LLVM/Cranelift internal passes. LLVM's arrived with native Phase 2; this slice added
    **Cranelift's opt levels, which had never been set** (so every native oracle leg had been validating
    unoptimized codegen), plus the instrumentation that makes the tier falsifiable: `measure`/`opt_report`
    (compile time, object bytes, end-to-end time per backend × level), a per-target-triple object-size
    regression gate, `scripts/check-all.sh`, and a Forgejo `rust-llvm` CI job invoking that same script.
    **Two findings worth remembering.** (1) `native_depth_cap`'s documented safety argument — "`O1+` only
    ever shrinks frames" — is **backwards for Cranelift**: optimized frames are ~3× *larger*, because
    live-range splitting spills more distinct values than there are asm registers. The margin survives
    (worst 2.94 words/register against the 4 that `BYTES_PER_VAR = 32` charges), so the constant was left
    alone — the right guard is a test that notices if the ratio moves, not a bigger constant. (2) The honest
    payoff is modest: Cranelift 0.7–1.8% smaller objects with compile time in the noise; LLVM 11–40% smaller
    for ~2.6× the compile time; and `Os`/`Oz` are byte-identical to `speed` on Cranelift, so six levels yield
    two distinct outputs there. **Tiers A and B now have a validated `-O3` reference point to measure
    against — and the TM's step-count goldens, not native wall-clock, are where their value will show.**
  **The ranked pass set — measured, not guessed.** The Core source map + step survey slice (merged
  2026-07-25, `07b5ee6`; spec `docs/superpowers/specs/2026-07-24-core-source-map-and-step-survey-design.md`)
  built the instrument that picks these passes, and **the evidence overturned the recommendation this
  roadmap previously implied**. Re-derive any number below with
  `cargo run --release --example step_survey -p redextape-core` — the survey is the source of truth and
  prints its own caveats; the ranking is transcribed here so choosing a pass does not require running it.
  **Caveat on that source of truth:** the survey's corpus (`step_survey.rs`'s own `FIRST_ORDER_DEMOS` /
  `LAMBDA_LIMITATION_DEMOS`) is a HAND-MAINTAINED copy of `tests/three_way_oracle.rs`'s arrays of the same
  names — an example is a separate binary crate and cannot `use` an integration test's module, so the
  strings are duplicated by hand — and it can silently drift out of sync with the oracle it claims to
  mirror. That is exactly what happened before this refresh: the copy sat 12 demos stale (28 vs 40) across
  two prior slices.
  Corpus: 44 oracle programs, 6,654,774 TM steps, shares step-weighted.
  1. **Closure specialization / known-callee devirtualization — 25.6%** (1,705,468 steps: `$applyN` dispatch
     12.6% + `ClosureScaffold`'s dispatch half 13.0%). *Tier A.* **The enabling pass — you cannot inline
     through `$apply1`**, so it must come first for the inliner to have anything to work on. Every closure at
     every call site in this corpus is statically known, so the opportunity is 100% present, not
     hypothetical. Measured ceilings: 86.7% on an isolated shape, 50.5% on `map` specialized to its known
     callback — both with the specialized function still *called*, so neither bundles the inliner.
     **This resync moved more than magnitudes — the raw ranking flipped.** Pre-resync this pass was both
     the recommended #1 *and* the survey's single largest bucket (27.5% > `Ret`'s 24.8%). Post-resync it
     stays #1 by recommendation but is **no longer the largest by raw step-share**: `Ret`'s frame-restore
     below now measures 27.6%, ahead of this pass's 25.6%. It keeps build-order #1 for the *structural*
     reason above — nothing can be inlined through `$apply1` until this runs — not because it is the
     biggest bucket; that argument no longer holds and this roadmap no longer makes it.
     **Prerequisite (DONE):** `defunc` used to *reject* functions both called by name and used as a
     value — the entire "direct call to a value-used function" case. Shipped 2026-07-25; see
     `docs/superpowers/plans/2026-07-25-defunc-both-called-and-value-used.md`. One exception remains:
     a cycle in the emitted binder graph (kept `fn`s and `$applyN` dispatchers) that returns to a BOTH
     function's own dispatcher is still `Unsupported` — reachable directly, through other kept `fn`s, or
     (the non-obvious path) through dispatchers of OTHER arities, e.g. `$apply1 -> f -> $apply2 -> h ->
     $apply1` when `f` and `h` are each BOTH at a different arity (see `defunc.rs`'s module doc for the
     worked counterexample). A dispatcher/callee `LetRecGroup` would lift it.
  2. **`Ret`'s frame-restore / live-`Loc`-bank reduction — 27.6%** (1,839,145 steps). The **largest single
     bucket in the survey — larger than any user construct kind, and, post-resync, larger than
     devirtualization's target above too** — and measured to grow **exactly quadratically** in locals live
     across a call (constant 2nd differences; 42× the ABI cost at K=8 versus K=0 for the *same one call*).
     *Tier B (asm→asm), not Tier A.* It is the one candidate with **no pass-ceiling probe**, because a
     hand-optimized form would have to be a different ABI rather than a different program; the scaling
     measurement is the evidence offered in place of a ceiling.
  3. **Inlining — 9.3%** (20.7% counting self-recursive calls, which it can only unroll). *Tier A.*
     Legitimate and it compounds with (1) — it also retires the `MachineScaffold` at the sites it removes —
     but its honest probe ceiling is **62.5–86.2%, not the 91.0%** the identity-callee shape reports, and its
     share is 0.36× devirtualization's.
  4. **Arithmetic passes (folding, algebraic identities, const-prop) — 7.0% step-weighted**, which looks
     negligible only under step-weighting *of this corpus*: program-averaged they are 16.1%, and on the 29
     first-order programs **25.5%, beating merged-`Apply`'s 25.0%**. Their Part B ceilings are the survey's
     highest (88.5–98.7%). *Tier A.*
  - **Adjacent, and excluded from (1) by the same bucketing rule** (*bucket by what a pass could do about
    it*): defunc's mutable-capture **boxing totals 1.2%** (79,784 steps). Devirtualization removes none of
    it; a different mutable-capture strategy removes all of it.
  - **The trap this survey exists to defuse.** A single merged `Apply` bucket (37.3%) names inlining the
    standout. It is not: that bucket is four populations with opposite optimizer implications, its largest
    slice (12.6% dispatch) is untouchable by an inliner, and another 3.3% is `cons`/`head`/`tail`/`is_empty`
    — **one asm instruction each, no frame, no `Call`, no `Ret`** — with nothing there to inline at all.
  - **The bound on all of the above, which must travel with the numbers.** This corpus is an oracle suite
    built for **backend feature coverage, not workload representativeness**. Fifteen higher-order demos
    carry **86.2% of the steps**; drop them and the headline inverts. The survey says where steps go *in
    these programs*. Choosing a pass on it means betting an intended workload resembles one of these
    populations — and that bet, not the table, is the decision.
  Two properties make this project special: the **oracle is the optimizer's test harness** (every pass must
  keep `reference == λ == TM (== native)` — a miscompiling pass is refuted instantly by whichever leg
  breaks), and the **TM makes savings measurable** (the step-count goldens quantify exactly what a pass
  saved: "DCE cut `sum(5)` from 178k steps to N"; λ shows β-step deltas; native shows wall-clock — three
  lenses on one optimization). **When:** its own plan(s), after the backends are complete, oracle green so a
  regression is unambiguous. The tier order (Tier A → Tier B → Tier C, the last now done) still says which
  tier *reaches* the most backends, but the **ranked pass set above says which pass to build**, and the two
  disagree once: the #2 target is Tier B — and, since this resync, is also the single largest bucket by raw
  step-share, ahead of the #1 pass. Build order still follows the dependency, not the share: `defunc` BOTH →
  devirtualization → frame-restore ABI → inlining. **Risk:**
  miscompilation — mitigated by the oracle; apply YAGNI hard (add a pass only if it helps demos fit under
  caps or reads more clearly).

- **Native code backend — backend track, the 4th oracle leg. v1 (Cranelift JIT) DONE** (merged, crate
  `redextape-native`; see the design spec `docs/superpowers/specs/2026-07-23-native-backend-design.md` and
  plan `docs/superpowers/plans/2026-07-23-native-backend-v1-cranelift.md`). `Core → asm → native machine code`,
  reusing `lower_asm` + `defunc` UNCHANGED (the register-asm is already conventional three-address code:
  registers, `Bin` ALU ops, `Jz`/`Jmp`/labels branches, `Call`/`Ret` with an explicit stack, `Cons`/`Box`
  heap ops). Emit via **Cranelift** (pure-Rust, fast compile, JIT-oriented, lighter opts — what v1 uses) or
  **LLVM/inkwell** (heavy dependency + toolchain, but the full −O3 pipeline — deepest native codegen). Both
  consume the *same* `Program` behind a `NativeCodegen` seam, so the native backend is the least locked-in
  decision in the system — v1 stood up on Cranelift and can swap to LLVM later without touching any front-end
  or optimizer pass. Needs only a tiny runtime (a bump allocator for cons/box cells + a result-decode routine
  mirroring `decode_asm`). Slots into the oracle as a new leg: `reference == λ == TM == native`, plus a
  `native == asm-interp` independent-codegen cross-check. **Honest bound (recalibrated during v1):** native
  runs real `u64`, so it extends the practical reach *beyond* the TM's `FIELD_WIDTH < 64` representability
  bound — but it does NOT *uniquely* escape it, because the asm INTERPRETER (`run_asm`) already runs `u64`
  (that bound is the TM's alone). Native's real payoff is the compiled-to-hardware milestone + the Tier-C
  prerequisite + the codegen cross-check. **When:** pairs with the optimizing-compiler track as its Tier C.
  **Phase 2 — LLVM behind the `Codegen` seam: DONE** (merged 2026-07-24, `782bc73..1fa29fe`; spec
  `docs/superpowers/specs/2026-07-24-native-llvm-phase2-design.md`, plan
  `docs/superpowers/plans/2026-07-24-native-llvm-phase2.md`). A second native backend on **inkwell 0.9 /
  LLVM 22.1.8** behind `--features llvm`, feature-gated so `redextape-core` stays WASM-clean and the default
  build needs no LLVM toolchain. `src/llvm.rs` is the asm→LLVM-IR walk (mirrors `codegen.rs` arm-for-arm);
  `src/shared.rs` holds the codegen-agnostic prep both backends now share (`reg_over_cap`, `param_count`,
  `native_depth_cap`); `Codegen { Cranelift, Llvm { opt } }` + `run_native_with` are the seam. **Real
  optimization:** `default<O1..O3>` IR pipelines (`O0` deliberately skips the pipeline) plus size levels
  `Os`/`Oz`. **Oracle:** `reference == cranelift == llvm` with a *direct* per-opt-level cross-backend
  comparison, faults/caps compared across backends, and a first-order proptest. `cargo run --example
  llvm_demo -p redextape-native --features llvm`.
  - **Two findings worth remembering.** (1) The `default<O_>` pipelines *delete unused function
    declarations*, so `FunctionValue` handles captured before optimizing dangle — mapping one onto the
    execution engine is UB. The fix is to re-fetch the `rt_*` imports **by name** from the post-pass module.
    (2) For `-Os`/`-Oz` the **pipeline string alone does nothing**: with the `optsize`/`minsize` function
    attributes suppressed, `Oz` comes out *larger* than `O3` (63 vs 61 IR instructions); with them, 32 vs 61.
    The attributes are the entire effect. Caveat: the size levels are near-inert on typical output from this
    front-end — every emitted callee is either recursive (the inliner declines) or single-call-site (inlined
    even at `Oz`), so loop unrolling is the only discriminating lever.
  **Phase 3 — AOT (a real runnable binary): DONE** (merged 2026-07-24, `9f173e8`; spec
  `docs/superpowers/specs/2026-07-23-native-aot-phase3-design.md`, plan
  `docs/superpowers/plans/2026-07-23-native-aot-phase3.md`). ADDITIVE — JIT and AOT coexist: both
  `JITModule` (`cranelift-jit`) and `ObjectModule` (`cranelift-object`) implement the same
  `cranelift-module::Module` trait, so the asm→CLIF walk is written once against `Module` and targets
  either. `emit_object` produces a real linkable `.o`; `link_executable` (a platform-aware `cc` link)
  produces a standalone binary that runs and prints its result. The `rt_*` host functions moved to a new
  no-Cranelift `redextape-native-rt` crate (rlib + staticlib); decode happens at the edge, driven by a
  serialized CONFIG blob. `cargo run --example aot_demo -p redextape-native` → `5050` from an actual binary.

  **Remaining phases / follow-ons (not yet planned; pursue after confirmation):**
  - **`run_asm` vs native `Loc`/`Rr` frame semantics — a real, pre-existing, backend-agnostic divergence.**
    `run_asm`'s `Call` clones the caller's locals into the saved frame and leaves `vm.locals` in place, so a
    callee **inherits** the caller's `Loc` values; both compiled backends give the callee a **zeroed** bank.
    The same class applies to `Rr` (a single global VM register in the interpreter, a per-function slot in
    both compilers): `$main: li rr,1; call g; halt` with `g: ret` gives `asm=1`, `cranelift=0`, `llvm=0`.
    Reachable through the public `compile_and_run` APIs with a hand-built `Program`, but **unreachable from
    `lower_asm`/`defunc` output** — verified by a definite-assignment dataflow check over 30 real programs
    (recursion, mutual list recursion, `while`, heap ops, `map`/`fold`, currying, immutable capture,
    mutable capture via boxing): 0 findings. (`Arg` is structurally immune: `partition` sets
    `arity = max_arg_read + 1`.) That is exactly why no oracle leg catches it. Fixing it means changing
    `redextape-core`'s `Call` semantics — a change to the *reference* oracle leg, so it deserves its own
    slice and a full re-validation, not a drive-by.
  - **AOT via LLVM.** Phase 3's object emit is Cranelift-only (`aot.rs` is `cranelift`-gated); Phase 2's
    LLVM backend is JIT-only. Emitting a `.o` through LLVM's `TargetMachine::write_to_memory_buffer` would
    give the AOT path the `-O3`/`-Os`/`-Oz` pipelines too, and would let the size levels be measured in
    **machine-code bytes** rather than IR instruction count (the honest observable for `-Oz`, which nothing
    currently measures).
  - **Pedagogical "show the native code" view — cheap, high demo value.** A `print`-style dump of the
    generated code for a program, sibling to `print_asm` / `print_tm` / `print_lambda`: the human-readable
    Cranelift IR (`Function::display()`, already available post-`define_function`) and/or a disassembly of the
    finalized machine bytes (via `cranelift-jit`'s emitted buffer or a `capstone`/`iced-x86` decode). Makes the
    demo show "here's the actual native code this program compiles to," completing the interpret / reduce /
    simulate / **compile-and-show** picture. Pure trace/artifact consumer — no codegen change, ~an afternoon.
  - **AOT-binary debuggability (tiered, convention-matching).** **Tier 0 (in Phase 3): named function
    symbols** kept in the emitted object by default (`$main`/`$sum`/`$applyN`/`rt_*`) so `nm`/`objdump`/
    backtraces are readable — matching `cc`/`ld`/`rustc` (symbols kept, opt-out `strip`). **Tier 1
    (optional follow-on): opt-in `-g` source-level debug info in each platform's NATIVE format** — DWARF
    (`gimli::write`) on ELF/Mach-O, CodeView/PDB on Windows (harder — no mature Rust PDB writer). Shared
    prerequisite: thread source spans `desugar→Core→lower_asm→codegen` + Cranelift `set_srcloc` (the asm
    IR carries none today). **Tier 2 (not planned):** variable/type info — post-lowering registers aren't
    user-meaningful. Value is marginal vs. the visualizer track for a mini-language; see the Phase-3 spec.
  **Risk:** the runtime (allocation + decode) was the only genuinely new surface; the codegen is a near-1:1
  walk of the asm. (v1's actual surprises: `lower_asm`'s inline fn layout forced a reachability partition, and
  deep fat-frame recursion forced a frame-size-aware depth cap — both resolved.)

- **Deforestation / supercompilation — optimizer track, Tier A, DECIDED 2026-07-27.** The
  zero-cost-abstraction question, asked directly: Rust fuses a chain of iterator adapters into one
  imperative loop, and the analogue here would fuse `map(f) ∘ map(g)` into `map(f∘g)` without building
  the intermediate list. **Rust's mechanism does not transfer.** Its adapters are monomorphized structs
  whose `next()` inlines, after which LLVM fuses the loop; here the builtins are only `nil`/`cons`/
  `head`/`tail`/`is_empty`, and `map`/`fold` are ORDINARY USER-DEFINED RECURSION over a cons list. So
  what is wanted is deforestation, not adapter fusion.

  **Route chosen: general deforestation, up to supercompilation. The two cheaper routes are rejected,
  and why is the point of recording this.** (a) *Pattern-rewriting the known shapes* — fires only on
  shapes someone anticipated, i.e. the optimizer that optimizes the benchmark; the exhaustive sweep and
  proptest generators exist precisely to catch that class, and an optimizer designed to need them is the
  wrong shape. (b) *Making `map`/`filter` builtins carrying fusion laws* — cheap and effective, and it
  **weakens the demonstration**: the interesting fact about this language is that `map` is DEFINABLE in
  it, not primitive to it, and a fusion law on a builtin proves nothing about the language.

  **Why this project suits supercompilation unusually well.** The hard parts in a real language —
  effects, exceptions, laziness, mutable aliasing — are largely absent; the one mutable construct
  (capture via BOX) is bounded and explicit. `defunc` already proves the Core→Core pass shape. And the
  payoff is measurable in the exact currency deforestation targets: an eliminated intermediate list is
  literally fewer `@` cons cells on the final HEAP tape and fewer HEAP walks, so "the intermediate
  structure is gone" is an OBSERVATION on the tape, not an inference from a benchmark. The oracle
  becomes `supercompiled == unoptimized == reference == λ == unary-TM == binary-TM`.

  **The two hard parts, both of which are totality problems in this project's terms.** (1) *Termination
  of the driving loop* — supercompilation drives the program symbolically and must decide when to fold a
  repeated configuration; without a whistle (a well-quasi-order such as homeomorphic embedding) forcing
  generalization, the COMPILER diverges. Totality is the cardinal rule, so the whistle is the same class
  of guard as `MAX_LOWER_DEPTH`/`MAX_DEFUNC_DEPTH`, not polish. (2) *Residual code blowup* — output can
  be exponentially larger, and on a TM that is directly visible as state count. `Mul`'s O(width²) states
  already shows state count is a real budget, so a size cap and an honest measurement of the trade are
  part of the slice, not a follow-up.

  **This REORGANIZES the ranked pass set above rather than adding to it.** Inlining, constant folding
  and closure specialization are all special cases of driving, so committing to supercompilation
  partly subsumes them. The measured #1 (closure devirtualization, 25.6%) stays first regardless — it
  is cheap, it is a special case worth having standalone, and nothing can be driven through `$apply1`
  until it runs. Ordering is therefore: devirtualize, then supercompile the first-order residue.

  **Success criteria, falsifiable:** intermediate cons cells eliminated (count `@` cells on the final
  HEAP tape, before vs after), step ratio per program, state count as the size cost, and the oracle
  green at every level. **Placement:** after the binary encoding branch and the self-describing header
  slice. Opt-in, default off, in the same discipline as `Unary::default()` remaining the default
  through the entire encoding branch — the DIFF is the artifact, not the optimized machine.

- **Alternative front-ends — frontend track, purely additive; the angle is *paradigm diversity*.** A new
  surface language compiling to the *same* Core needs only lexer → parser → typecheck → desugar-to-Core;
  everything downstream (`defunc`, λ, asm, TM, native, the entire oracle) is REUSED UNCHANGED — it operates on
  Core, not surface syntax, so front-ends are cheap and low-risk (the oracle validates each against every
  backend on the shared demo corpus). The compelling thing isn't more syntaxes — it's spanning *paradigms*,
  demonstrating the Church–Turing thesis at the level of syntax: wildly different surface languages are the
  same underlying computation, the same λ-term, the same TM. Candidates, by (easy × compelling):
  - **C-like (imperative)** — an *easier* fit than the Rust-like one: Core is already imperative-friendly
    (`let mut`/`Assign`/`While`/`Seq`), so mutable locals / loops / functions map cleanly (`for`/`break`
    desugar to `while`; `goto` maps to the asm's `Jmp` + labels). Core needs extension only for C-only
    features — pointers, arrays, structs (a memory model); raw pointer arithmetic has no clean λ encoding, so
    those programs run on `reference`/TM/native but not λ, landing in the `assert_tm_only` two-way bucket (the
    same pattern Plan 3b-2's mutable capture uses).
  - **Lisp / S-expressions (homoiconic)** — highest bang-for-buck: S-exprs are almost free to parse and map
    near-directly onto Core (it *is* Core in parens). The code-is-data angle pairs perfectly with the
    self-application track below.
  - **Concatenative / Forth-like (stack)** — `2 3 + 4 *`: a radically different surface (no variables, a data
    stack) with a tiny grammar, lowered by threading a *compile-time* stack of Core expressions. Striking
    precisely because it looks nothing like the others yet is the same computation. (The asm's STACK tape is
    the *call* stack; the concatenative data stack compiles away entirely.)
  - **Tiny ML (functional)** — `let`/`fun`/`if`/tuples/lists/`match`: the natural functional companion; Core
    is already functional-friendly, and pattern-matching is a satisfying desugar. This is also the front-end
    that most motivates growing Core toward **sum types**, the prerequisite for fuller self-hosting (below).

  Together with the Rust-like original that is four paradigms — imperative, functional, concatenative,
  homoiconic — one Core, one λ-term, one TM. **Skip:** Prolog/logic (unification + backtracking needs a large
  new runtime — high risk) and visual/blocks (only meaningful once the web UI exists). **When:** any is a
  self-contained plan whenever desired; independent of everything else.

- **Self-application & self-hosting — demo/theory track.** Two very different levels:
  - **Scoped self-application (feasible NOW, and the more on-theme demo):** write a small interpreter *in* the
    mini-language and run it three ways. The standout: a **λ-calculus reducer** — encode λ-terms as tagged
    cons-list ASTs (tag in the head: 0 = var as a de Bruijn `Nat`, 1 = `lam`, 2 = `app` — the *same* shape
    `defunc` uses for closures `cons(tag, env)`), then write a normal-order β-step as recursion over
    `cons`/`head`/`tail`/`if`. de Bruijn indices avoid fresh-name generation, so no strings/sum-types are
    needed (ASTs are numeric-tagged trees). Result: **a Turing machine simulating a λ-calculus reducer** — the
    Church–Turing equivalence made doubly literal and self-referential (the project's two backends, one
    implemented *inside* the other). The mirror — a TM-simulator written in the mini-language, run on the λ
    backend — is equally on-theme. Bounded by `FIELD_WIDTH < 64` on the TM leg (small terms); unbounded on
    `reference`/native.
  - **Full self-hosting (INFEASIBLE with today's language, and not close):** a real compiler needs *strings*
    (source text), *sum types + pattern matching* (an AST is a tagged union of many node kinds),
    *maps/environments*, error handling, and *I/O* (to read source). The mini-language has
    `Nat`/`Bool`/`List`/functions/closures and none of the rest. **What it would take:** add strings (a
    `String` type or a `List<Nat>` convention), add **sum types + `match`** (the tiny-ML front-end is the
    natural motivator), add records, and an input path. Even then, a realistic milestone is self-hosting a
    **small subset** (the mini-language compiling a stripped-down version of itself), not the whole toolchain —
    a large undertaking. Honest read: the language is too minimal to host its *compiler* but exactly rich
    enough to host a small *interpreter*, so pursue scoped self-application first and treat full self-hosting
    as a north star that the tiny-ML + sum-types work incrementally unlocks.

- **Terminal (TUI) visualization — view-surface track, mostly for fun; a cheap rehearsal of Plan 5.** The
  render model already exists — every viewer is a pure *consumer* of traces the backends already produce, so
  this needs ZERO backend changes: the TM's `simulate_trace` → `Trace` carries per-step
  `(state, tapes-with-head-index)`; the λ reducer's `reduce_trace` carries per-step term + the *redex path*;
  the asm interpreter (`run_asm`) exposes register/heap/box state; and `print_asm`/`print_lambda`
  pretty-print. All three backends are visualizable in the terminal:
  - **TM** — animate the (now 5) tapes as labelled rows with the head cell highlighted, current state name,
    the δ-rule just fired, step counter. *Tier 1:* a quick auto-play example (crossterm/ANSI + a screen-clear
    loop, ~100 lines — ships in an afternoon: watch `1 + 2 * 3` grind through 5,724 transitions). *Tier 2:* an
    interactive stepper (ratatui) — step / play-pause / **scrub-backward** (free: the whole `Trace` is in
    memory) / speed. **Constraint:** unary tapes are long (a 326-cell REG bank) and programs step-heavy, so
    render a **viewport window centered on the head** (scroll the tape under a fixed window — more faithful to
    a real head anyway) plus speed control; lean on small demos; cap Tier 2 to small programs or step
    `simulate` lazily to avoid materializing a 240k-step trace.
  - **λ** — scrub the β-reduction: show the term at each step with the **redex highlighted** (the reducer
    already tracks the redex path), via the existing `print_lambda`. Bonus: an ASCII tree / Tromp-style
    rendering of the term.
  - **asm** — a register table + heap/box cells alongside the current `Instr` as `run_asm` steps — a
    middle-ground view between source and the TM tape.

  **Tech:** ratatui + crossterm (Tier 2), plain crossterm/ANSI (Tier 1). **When:** Tier 1 anytime (it's
  `tm_demo` + a loop + a sleep); Tier 2 a small plan paired with the CLI (Plan 6). **Payoff:** a standalone
  fun artifact *and* it validates the view-model ergonomics before the web UI. This complements the passive
  "assembly pane / single-tape view" notes under v2 — the terminal is the fastest medium to prototype them.

- **tree-sitter grammar — frontend/tooling track, defer to the visualizer.** A CST for editor tooling:
  incremental parsing, error-tolerant highlighting, a live editing surface. It does NOT replace the
  hand-written front-end parser for the oracle (it produces a CST you'd still lower into the typed Core).
  **When:** only once the interactive visualizer (Plan 5) exists and wants in-browser editing; nothing on
  the compiler/oracle path depends on it. **Risk — dual-grammar drift:** pick a lane up front — either
  tree-sitter for *highlighting only* (hand-parser stays the semantic source of truth; drift is cosmetic)
  or tree-sitter as the *only* parser (lower CST→Core; couples the build to the tree-sitter toolchain).
  Never maintain two authoritative grammars.

- **TM value encoding — the swappable `Encoding` seam, realized. Encoding track, items 1-3: DONE.**
  `tm/encoding.rs`'s `Encoding` trait was declared a "swappable seam" back in Part 2b-1 and had exactly
  one implementation (`Unary`) through all of Plan 3. Three slices closed the track out:
  1. **Per-program field-width sizing + the overflow guard — DONE** (merged 2026-07-26, `3613837..5cfd3b1`;
     spec `docs/superpowers/specs/2026-07-26-per-program-field-width-design.md`). `run_tm` now auto-fits
     the narrowest field width a program's values actually need (4 → 8 → 16 → 32 → 64, doubling) instead of
     always paying for a pinned 64-cell bank — measured **3.59× fewer steps** on the oracle corpus — and a
     value that overflows every width up to 64 now reports `TmRun::Overflow` instead of silently corrupting
     the bank (the pre-guard failure mode: a too-narrow run wrote past its field boundary and still returned
     an answer, sometimes the right one by coincidence — the dangerous case).
  2. **The bank-safety ladder — DONE** (same slice). A six-layer verification ladder for the register bank
     (write-site enumeration, guard-rule position, a per-step corpus/generated/EXHAUSTIVE — 198,928
     programs — tape invariant, a static per-rule non-termination check, HEAP/STACK final-tape structure),
     built to be reused rather than re-derived by whatever encoding came next.
  3. **`Binary`, a second `impl Encoding` — DONE** (branch `tm-binary-encoding`, 2026-07-27 onward from
     `8f076e0`; spec `docs/superpowers/specs/2026-07-26-tm-binary-encoding-design.md`, corrected in place —
     not left to drift — by this branch's own final slice). A base-2 encoding — a `w`-cell field is `w`
     LSB-first bits, holding `0..2^w` — proven against the SAME four-way oracle
     (`reference == λ == unary-TM == binary-TM`) and the SAME bank-safety ladder from item 2, generalized
     over both encodings by three new trait methods (`parse_heap_cells`, `field_symbols`, `init_work`).
     **Two predictions were made before the measurement existed; it went 1-for-2:**
     - *Binary banks are narrower — HELD.* Auto-fit settles binary at a smaller cell count for the same
       program (`let x = 40; x + 2` needs 8 cells where unary needs 64).
     - *Binary step counts are probably higher on this corpus — REFUTED IN AGGREGATE, HELD AT A FIXED
       WIDTH.* The reasoning (every demo value is under 64, precisely where a `k`-cell unary add beats a
       `w`-cell ripple carry) is correct when the width is held equal: same-width goldens
       (`tm_step_count_goldens_binary`/`_golden_higher_order_binary`, both pinned at 64 cells) show binary
       1.15-1.72× slower on three of four goldens and 10.2× slower on the one built on `Mul`. But
       `run_tm_fitted` fits each encoding to ITS OWN narrowest width, not a shared one, and the space
       saving dominates: over `width_report.rs`'s 18-program corpus binary totals **0.45×** unary's steps
       (270,369 → 122,972); over the full 50-program first-order oracle corpus (`step_survey.rs`'s Part D),
       **0.39×**. (This line first said 0.45× was 0.51×. That figure is the subtotal of a NINE-row hand
       check — which the artifact did reproduce exactly, program for program — mislabelled as the corpus
       total. Caught by the final whole-branch review, which re-ran the cited artifact.)
       The programs that DO lose are the controlled case: both encodings fit at width 4, so there is no
       bank-width advantage to hide the per-operation cost, and binary is 5-20% slower there — the number
       the refuted prediction was actually describing, isolated from the width effect it was conflated with.
     - **`Mul` costs materially more STATES than its unary counterpart**: `1.5w² + 26.5w + 13` (143 states
       at width 4, 821 at 16, 7,853 at 64) — the one gadget where shift-and-add is not a wash against
       unary's per-value chain.
     - **The design spec's own §3.3 WORK-tape estimate was wrong**: it predicted three scratch fields (for
       `mul`'s accumulator/multiplicand/multiplier). The shipped design needs **one** (`N_WORK_FIELDS = 1`)
       — `mul` shifts the ACCUMULATOR instead of the multiplicand (no multiplier register, no loop counter;
       the `w` iterations unroll at build time), and `eq`/`ne` park their intermediate in REG `rd` exactly
       as `Unary::eq_to_work` already does. Verified three times during the branch.
     - **Corrected two doc-comment claims this same branch had made false**, in `redextape-native`'s
       `native_oracle.rs`/`native_demo.rs`: "no `MAX_FIELD_WIDTH` ceiling, unlike the TM's fixed-width
       tape" was true of UNARY alone even before `Binary` existed — the phrase just never had to say so
       while unary was the only encoding. `Binary` at 64 cells covers the entire `u64` range, matching
       native's registers and the reference's own `Value::Nat(u64)` + saturating arithmetic — so the
       honest remaining gap (values `>= 2^64`) is not one this language can even express. The test
       (`native_runs_beyond_field_width`) was kept, not deleted: it still tests a real difference (native
       vs. unary), just a narrower one than advertised.

       **ANNOTATION, not a rewrite (item 4 below contradicts this):** "not one this language can even
       express" reads as "there is nothing to test at this boundary" — false. Item 4's `SATURATION_DEMOS`
       are exactly such programs (`18446744073709551615 + 1`, a 20-digit literal that parses with no
       diagnostics), and they are meaningful, exercised, and pin a real divergence: reference/native
       SATURATE to `u64::MAX`, the TM halts in its rule-less overflow guard. What is true is narrower —
       no `Value::Nat` ever HOLDS a number `>= 2^64` (saturation forbids it) — but a program can
       absolutely reach for that boundary and get a well-defined, testable answer. Left as written per
       this repo's annotate-don't-drift convention; see item 4 for the corrected, sharper statement.
  4. **DONE (2026-07-29). `Binary` as a fourth PARTICIPATING leg in the native oracle** (branch
     `binary-oracle-leg-and-collision-doc`). Item 3 above corrected the doc claims; the suite itself
     still only ran unary. Five sites in `crates/redextape-native/tests/native_oracle.rs`: (1) the
     four-way suite split into one `#[test]` per encoding via a `four_way_tests!` macro that also
     records `EMITTED`; (2) `every_encoding_has_a_four_way_test`, a guard deriving its expectation from
     `encodings()` at RUNTIME and comparing it against `EMITTED` — it catches drift BETWEEN THOSE TWO
     LISTS (a generated test deleted, or a macro invocation left behind `encodings()`), not drift between
     `encodings()` and the set of encodings that actually exists: `tm_leg`'s exhaustive match (no
     wildcard arm) is the real compile-time forcing function that brings a developer adding a third
     `EncodingKind` to this file at all, but nothing forces them to also extend `encodings()` once here,
     so an encoding never registered there stays covered by nothing regardless of this guard; (3)
     `binary_runs_the_demos_unary_cannot_represent`, turning a doc-comment claim into a measured result
     while the unary `Overflow` control stays untouched; (4) a NEW proptest
     (`binary_tm_agrees_while_unary_tm_is_never_wrong_on_random_programs`) over a NEW mixed-range
     generator (`arb_tm_mixed_range_expr`) adds the TM legs — the pre-existing wide-range proptest
     (`native_agrees_with_reference_and_asm_on_random_programs`) was deliberately left untouched, not
     extended; (5) `past_the_u64_ceiling_the_backends_diverge_by_design`. Plus a doc-coherence pass. 7
     tests → 12.

     **The wall-clock result, which was the design bet.** Baseline 16.786s, of which ONE test
     (`four_way_oracle_on_the_first_order_suite`) was 16.784s — the file's entire long pole. Splitting
     per encoding lets `cargo-nextest` run the two legs CONCURRENTLY instead of sequentially in one test.
     Four independent measurements of the split suite exist on this tree, agreeing on the shape but not
     the decimals: the controller, right after the Task 2 split (9 tests) — `…_binary` 16.240s, `…_unary`
     17.045s, total 17.045s; Task 7's own pasted verification run — `…_binary` 16.223s, `…_unary`
     17.001s, total 17.002s; Task 8's full-gate run — `…_binary` 16.721s, `…_unary` 17.505s, total
     17.505s; and the figure this entry originally stated as THE result — `…_binary` 16.165s, `…_unary`
     16.938s, total 16.939s — cited to "see Verification below" even though that section pastes the
     16.223s/17.001s run, and which happened to be the lowest of the four, quoted to a millisecond
     (caught by review). Read honestly this is a RANGE across runs, not a single measurement: the suite
     totals roughly **16.9-17.5s**, with the two encoding legs each landing around 16-17.5s and running
     CONCURRENTLY, so the total tracks whichever leg is slower that run rather than their sum. What is
     solid across all four runs: adding an entire second encoding cost a fraction of a second, never
     close to doubling the file's long pole, because a second test doing the same work in parallel is
     close to free — one test doing both legs would have doubled it instead.

     **Finding the item did not anticipate: the ≥2⁶⁴ gap cannot be closed by an agreement test.** The
     reference and native SATURATE to `u64::MAX` (`tm/asm.rs`'s `saturating_add`/`saturating_mul`); the
     TM halts in its rule-less overflow guard (`tm/lower_tm.rs`'s `Builder::overflow`) and never
     saturates. Both deliberate. So it is pinned as a DIVERGENCE (`past_the_u64_ceiling_the_backends_
     diverge_by_design` + `SATURATION_DEMOS`), with the reason recorded in the test so nobody later
     "fixes" it by making the TM saturate.

     **The branch's own defect, and the lesson.** The plan and spec justified fitting binary
     (`run_tm_fitted` rather than `Binary::default()`) by claiming its DECODE needs the fitted width.
     **That was false.** Both decoders are structural; `a_tape_decodes_the_same_at_every_reader_width`
     (`redextape-core/src/tm.rs:316`) pins that a default-width `Binary` decodes a fitted-at-16 tape.
     Caught by sabotage: swapping the fitted encoding for `&Binary::default()` was expected to fail and
     PASSED. Provenance: core's `three_way_oracle.rs` records this as *"That was once REQUIRED"* and
     retracts it two sentences later; the plan author extracted the obsolete half and propagated it as
     live justification because it READS like a correctness constraint. It reached five places across
     spec and plan and into committed code (fixed: `fbc970f` in code, `1fec082` in the documents).
     **Three independent defenses had to fire to catch it** — the sabotage that disproved it, a reviewer
     that flagged the sabotage as exercising only one branch of the assertion (which is what prompted the
     second sabotage that found the false claim), and a Task 6 implementer who read the plan's draft
     module-doc text against an explicit "do not undo this correction" warning in the same dispatch and
     refused to transcribe the draft. Any one alone and it ships. (Binary itself stays fitted anyway —
     the width it settles on is worth naming, and it matches the convention core's `three_way_oracle.rs`
     already uses — so the asymmetry with unary is deliberate convention plus this branch's
     additive-only constraint, never a correctness requirement.)

     **Why unary was not also fitted, to close the asymmetry the other way.** Considered and rejected.
     Unary's demos are all small enough to fit at width 8-16, so moving unary from its fixed
     `MAX_FIELD_WIDTH` (64) to `run_tm_fitted` would have silently moved every demo from a 64-cell bank
     down to an 8-16-cell one — a LATERAL coverage change, not a strict improvement: fixed-64 exercises
     wide banks, fitted exercises narrow banks and sits closer to the overflow boundary, and neither
     dominates the other. Applying that change here means reshaping an already-green check's coverage
     without being asked to, on a branch whose entire subject is checks that under-deliver on what they
     claim — not a place to add a new instance of that failure mode. The width axis itself is also not
     this file's job: `tm_width_equivalence.rs` and `tm_bank_invariant.rs` already own it, running
     `widths() x encodings_at(width)` deliberately across the full range; `native_oracle.rs` checks native
     agreement at one width per encoding, not a second width sweep. So unary stays fixed-64 by choice,
     and that choice is separate from — and in addition to — the additive-only constraint above.

     **A measurement that changed the work.** The proptest's unary half was initially asserted "never
     wrong" over a generator drawing leaves `0..1000`, which unary cannot represent. Measured fire rate:
     11/1920 cases (0.6%), silent on ~70% of runs. A new generator (`arb_tm_mixed_range_expr`,
     `prop_oneof![4 => 0..8, 1 => 0..1000]`, otherwise structurally identical to the existing
     `arb_native_safe_expr`) raised it to 60.4% (1159/1920), live on 30/30 runs; the sabotage went from
     luck-dependent to reddening 5/5 independent runs. The test was also RENAMED to
     `binary_tm_agrees_while_unary_tm_is_never_wrong_on_random_programs`, because raising the fire rate
     does not change the semantic asymmetry — binary AGREES, unary is merely NEVER-CAUGHT-WRONG — so a
     name using "agree" for both would keep overclaiming.

     **Also fixed in passing** (commit `cbec82a`): core's `three_way_oracle.rs` cited its pinning test as
     `a_default_encoding_decodes_a_tape_fitted_to_a_narrower_width`, which never existed under that name.
     A doc citing a guard nobody can grep reads as an absent guard.
  **Honest bound, stated because every item above earns one:** all of it is measured on the oracle demo
  corpus (`FIRST_ORDER_DEMOS`/`LAMBDA_LIMITATION_DEMOS`/`BEYOND_FIELD_WIDTH_DEMOS`), built for backend
  feature coverage, not workload representativeness — the step survey's own recurring caveat applies here
  too. **What stays open:**
  arbitrary-precision (variable-length) fields — every widening write would have to shift the bank,
  invalidating the fixed-window in-place-write invariant every gadget rests on — a large separate slice,
  deferred not rejected. (The generator-duplication item that also sat here — `arb_native_safe_expr` and
  `arb_tm_mixed_range_expr` as copy-paste duplicates nothing enforced the lockstep of — is **CLOSED**;
  see item 2 below. It is struck from this list rather than left standing, because a "what stays open"
  list carrying an item that is shut is the same defect the branch below it exists to remove.)

  Two more, filed after the whole-branch review rather than left in a review transcript, both now
  **DONE (2026-07-29)** — branch `encoding-registry-and-generator-dedup`, spec
  `docs/superpowers/specs/2026-07-29-encoding-registry-and-generator-dedup-design.md`, plan
  `docs/superpowers/plans/2026-07-29-encoding-registry-and-generator-dedup.md`:

  1. **DONE (2026-07-29). No structural link between `EncodingKind` and the files keeping local
     encoding lists.** **The site survey undercounted three times, which is itself the finding worth
     recording.** The original filing said 6 sites across 5 files, counting only functions literally
     named `encodings`/`encodings_at`. A full grep for every way a file could enumerate the variant set
     found **13 sites across 10 files in 3 shapes** (`Box<dyn Encoding>` lists, `EncodingKind` arrays, and
     a proptest strategy — the spec's own prose rounded this to "nine files," but its own table lists 10;
     the count here is the table's) — the spec that closes this item corrected itself on the 6-vs-13 point
     before planning began, because filing a follow-up smaller than it is would have been the same defect
     this item exists to fix. Executing the plan then found a **14th site in a 4th shape**:
     `tm_width_equivalence.rs`'s width-monotonicity loop iterated a bare `["unary", "binary"]` string
     array into a hand-written `encoding_named` dispatcher, which matched neither the `EncodingKind::`
     variant-pair greps nor the `("unary", …)` tuple greps that found the other 13. (Hardened first,
     commit `d97cee9` — `encoding_named`'s catch-all silently returned `Unary` for any unrecognized name,
     so a third encoding's tests would have quietly run `Unary` twice while reporting as coverage — then
     converted and deleted, commit `c398422`, since a dispatcher with no remaining callers that stays
     "hardened" reads as protection while protecting nothing.) **A whole-branch review — after this task
     was believed done — then found a 15th, in a place none of the three previous passes looked: core's
     own unit tests.** `encoding_kind_instantiates_the_named_encoding_at_the_given_width` in
     `crates/redextape-core/src/tm/header.rs` hard-coded `Unary`/`Binary` by name to check
     `at(width).field_width()` and boundedness, so a third registry row would compile clean and pass this
     test while it still exercised only two of three kinds. Fixed in commit `48f8231` by looping both
     assertions over `EncodingKind::ALL`.

     **Shipped:** a `macro_rules! encoding_kinds!` registry in `crates/redextape-core/src/tm/header.rs`
     (commit `8ded4de`) generating `EncodingKind`, `ALL`, `at`, `name` and `parse` from one row per
     encoding — complete by construction. All 15 known sites now derive their ENUMERATION of encodings
     from `ALL` instead of naming variants by hand (commits `057cd6a`, `74fefba`, `c398422`, `d97cee9`,
     `d5a283a`, `48f8231`) — stated precisely as "enumeration" because one of the 15,
     `tm_exhaustive_bank_safety.rs`'s `sweep_targets()`, derives *which* encodings get a width list from
     `ALL` but still hand-picks the width VALUES themselves; see below for why that half stays manual. A
     hand-written `ALL` was rejected for a reason, not on taste: it cannot be made self-verifying in
     stable Rust — a developer can add a variant, fix every exhaustive match the compiler flags, and still
     leave the list short, and every guard would still pass. `strum`/`enum-iterator` were rejected too, to
     keep `redextape-core`'s `[dependencies]` **empty** — the crate is deliberately WASM-clean, and a
     derive macro is still a dependency edge. **Cost recorded, not hidden:** the enum is now
     macro-generated, so it is less greppable and produces weaker rustdoc than a plain `enum`.

     **This entry once said one site "could not be converted at all" — that claim has since been
     falsified, and the falsification is itself worth recording.** `sweep_targets()` in
     `tm_exhaustive_bank_safety.rs` pairs each encoding with its OWN width list, and the width VALUES
     genuinely cannot be inherited by a new encoding: "narrow enough that overflow is common" is a
     property of the value RANGE (`width` for unary, `2^width` for binary), not the cell count. That half
     was, and remains, irreducibly manual — whoever adds a registry row must pick its widths on purpose.
     But the ENUMERATION of which encodings get swept at all was never actually irreducible, and this
     entry originally chose a *runtime* guard (`every_encoding_has_a_sweep_target`, a count-and-name
     check, commit `b493bf0`, later widened to check both directions by commit `0db85f8`) without ever
     recording that compile-time forcing had been considered and set aside — which is a stronger claim
     than the evidence supported, the same defect shape this item exists to remove from the rest of the
     tree. **Found by the whole-branch review, not during the original task, and converted by commits
     `d5a283a` and `48f8231`:** `widths_for(kind: EncodingKind) -> &'static [usize]` and
     `capacity(kind: EncodingKind, width: usize) -> u64` are now wildcard-free matches on `EncodingKind`,
     and `sweep_targets()` derives from `EncodingKind::ALL` through `widths_for` — a new registry row is
     now an `error[E0004]` (non-exhaustive patterns) at three sites (`widths_for`, `capacity`, and
     `the_swept_widths_cover_the_overflow_regime_for_each_encoding`) before any test runs, not a guard
     that only fires after a developer already forgot to add a width list.
     `every_encoding_has_a_sweep_target` was deleted as vacuous once `sweep_targets()` satisfied its own
     assertions by construction, and `encoding_named` was deleted with it — its callers now hold an `EncodingKind`
     directly from `sweep_targets()` and call `kind.at(width)` themselves. **The lesson:** the width
     values were a genuine hand-judgment case; the enumeration never was, and stating "made LOUD instead"
     as if that were the ceiling on what this site could do was a claim the evidence never supported.

     **Two sabotage recipes answer different questions**, discovered when the wrong one was used (Task
     2 of the plan). ADDITION (add a registry row) tests count-derived guards — the shape Tasks 3-5
     needed, and the shape that makes `tm_bank_invariant.rs`'s cross-product guard, the sweep-target
     count, and `native_oracle.rs`'s wildcard-free `tm_leg` match all turn genuinely red. REMOVAL (delete
     a row) tests "did this site stop naming variants by hand" — a converted site names no variant and
     compiles; an unconverted one fails to compile, naming itself. An addition-sabotage carries ZERO
     distinguishing bits for the second question, because Rust array literals are not
     exhaustiveness-checked: a site still reading `for k in [Unary, Binary]` survives an added row just
     as cleanly as a converted site does.

     **Still open, filed here rather than left implicit.** `crates/redextape-core/examples/width_report.rs`
     names both encodings explicitly to build a two-column comparison table — a third encoding would be
     silently omitted from the report. Lower stakes than a test (an incomplete report, not a false-green
     check), but the same shape. `TmRun::Ran`'s doc comment in `crates/redextape-core/src/tm.rs` ("Both
     encodings read STRUCTURALLY") is a factual statement about the two encodings that exist today, which
     a third would make stale — cited by symbol rather than line number, per `49f386d`'s reasoning earlier
     in this same branch: line numbers in docs rot silently, symbol names do not. And
     `crates/redextape-core/examples/tm_emit.rs`'s user-facing help and error text (its usage banner and
     `--encoding` argument parser) hard-code `unary|binary` and are equally derivable from `ALL` — the
     same shape as the other two, and its absence from this list until now was the same defect this
     paragraph exists to fix: a "still open" list that is short is not automatically a complete one.

     **UNRESOLVED, and filed as unresolved rather than as a flake: nextest's `(1 leaky)` marker.** One
     run of `scripts/check-all.sh` (2026-07-29) reported `45 tests run: 45 passed (1 leaky)` in the
     `--no-default-features --features llvm` config, naming
     `redextape-native analysis::tests::partitions_main_and_one_subroutine`. nextest marks a test leaky
     when its process exits but something still holds the test's stdout/stderr pipe past a grace period
     (default 100ms). **It had been dismissed as "a pre-existing timing flake" in three separate agent
     reports without anyone naming the test or the mechanism**, which is the reason this entry exists:
     the dismissal was an assertion, not a finding.

     Investigated; ROOT CAUSE NOT FOUND. What was ruled out, so nobody re-derives it:

     - **Not the test's own work.** `partitions_main_and_one_subroutine` builds a `Program` literal,
       calls `partition`, and asserts. No threads, no I/O, no subprocess. Verified by reading it.
     - **Not `aot.rs`'s nested `cargo build`** (the one real subprocess in the crate, at
       `ensure_staticlib`'s best-effort branch). That config never reaches it: the runtime staticlib was
       deleted and nothing in the run rebuilt it.
     - **Not the runner threads.** Both `jit.rs` and `llvm.rs` spawn via `thread::scope` +
       `spawn_scoped`, which is joined at scope exit by construction.
     - **Not LLVM linkage spawning threads per test binary.** Many clean runs in that exact config.
     - **Not generic pipe-teardown latency.** Re-run with `leak-timeout = "1ms"` (vs the 100ms default):
       zero leaks. Slowness would have caught many.
     - **Not CPU contention.** Reproduced attempts under 8-way saturation: clean. (The original occurred
       during a 15-config gate at 206% CPU, which is why this was the leading theory.)

     ~25 isolated runs across both feature configs produced no second occurrence. **Impact is nil** —
     the test passed, nextest treats leaky as a warning, and the gate exits 0. Deliberately NOT handled
     by setting an explicit `leak-timeout` in a repo `nextest.toml`: that would tune a threshold to
     suppress a signal nobody understands, which is the defect class this whole line of work removes.
     If it recurs, the useful next step is `--no-capture` plus `lsof` on the test process, or checking
     whether nextest 0.9.140 has a known macOS pipe-teardown race.

  2. **DONE (2026-07-29). The generator duplication, and the prose-only 60.4% figure.** This list
     previously said `arb_native_safe_expr` and `arb_tm_mixed_range_expr` were copy-paste duplicates
     that "nothing structurally enforces stay in lockstep," and that deduplicating was forbidden by the
     previous branch's additive-only constraint. **That is now false.** A new `redextape-test-support`
     crate (commit `b10be2c`) holds the one `prop_recursive(3, 8, 3, …)` five-arm shape
     (`arb_expr_over`, parameterised only by its leaf strategy), and all four call sites —
     `arb_native_safe_expr`/`arb_tm_mixed_range_expr` (`redextape-native/tests/native_oracle.rs`),
     `arb_first_order_expr` (`llvm_oracle.rs`), `arb_tm_safe_expr` (`redextape-core/tests/three_way_
     oracle.rs`) — now call it (commit `365d535`).

     **The dedup needed a NEW dev-only crate**, not a module in `redextape-core`, because a feature-gated
     module there would require `proptest` as an optional REGULAR dependency, and an entry in
     `[dependencies]` is an entry whether or not a feature enables it — spending the same WASM-clean
     invariant item 1 above protects by a different route. `redextape-test-support` is a
     `[dev-dependencies]` entry of both `redextape-core` and `redextape-native`; core's own
     `[dependencies]` was not touched.

     **Seed-identity: the SHA-256 recomputation is not the load-bearing evidence, though this entry once
     read as if it were.** Each of the four generators' output was captured — 20 values off a fixed
     `TestRng::deterministic_rng(RngAlgorithm::ChaCha)` — before and after the conversion; all four were
     byte-identical, and the reviewer independently recomputed the SHA-256 of each capture
     (`cb51b986…`/`19f848b3…`/`d7c977c6…`) rather than trusting the reported hashes. **What that
     recomputation actually proves is narrower than "PROVEN, not argued": it shows the report is
     internally consistent — the pasted "before" and "after" samples match each other bit-for-bit — but
     it carries ZERO bits on whether the "before" capture predates the edit. Capturing "before" after
     already converting the generator would reproduce the identical matching hashes; a hash comparison
     cannot see when either sample was taken.** The conclusion survives on a different argument that does
     not depend on capture order and is the one actually load-bearing here: `arb_expr_over`'s body (in
     `redextape-test-support/src/lib.rs`) is textually identical to each of the four deleted generator
     bodies, and commit `365d535`'s diff shows every call site passing its original leaf strategy
     unchanged — so the strategy tree provably cannot have changed, independent of any trust in when a
     capture happened.

     **The 60.4% figure now defends itself.** A new deterministic fixed-seed test
     (`the_unary_leg_of_the_random_test_actually_fires`, commit `937b82f`) measures **126/200 (63.0%)**
     against a floor of 60 — close to, and consistent with, the neighbouring proptest's 60.4% aggregate
     over 1920 randomized cases, the small difference being ordinary sampling variance at a much smaller
     n. Sabotaging the generator's leaf back to a single wide range (`0u64..1000`, dropping the
     `prop_oneof![4 => 0..8, 1 => 0..1000]` mix) drops the measured rate to **1/200 (0.5%)**, reproducing
     the pre-fix ~0.6% condition and confirming the floor test catches exactly the regression it exists
     to catch.

     **Honest bound, carried over from the item this closes:** all of it — the 63.0% floor, the 60.4%
     aggregate, the seed-identity proof — is measured on this suite's demo corpora, built for backend
     feature coverage rather than workload representativeness. That is the same standing caveat every
     other measured entry in this roadmap carries, restated here because this item's whole claim rests
     on a number.

- **TM bank-safety: the four items left on the table (2026-07-26).** The per-program field-width slice
  built a verification ladder for the register bank — enumeration of write sites, guard-rule position,
  a per-step tape invariant (corpus then generated then exhaustive over 198,928 length-2 asm programs),
  and a static per-rule check covering non-terminating runs. HEAP/STACK final-tape structure followed.
  These four were assessed and deliberately NOT done; each records why, so a future reader can weigh it
  rather than rediscover it.

  1. **DONE (15ed8dd). `run_tm` guards `MAX_SLOTS` but not `MAX_FRAME_LOC`** (small, real, PRE-EXISTING). `attribute`
     mirrors both refusals; `run_tm` mirrors only one, so a program whose `Loc` bank `lower_tm` refuses
     to lay out comes back as `TmRun::Ran` over tapes that decode to nothing, instead of a resource
     outcome. Already documented as a known asymmetry in `attribute.rs`'s `Attribution::unrepresentable`
     doc. **Shipped:** `run_tm_fitted`/`run_tm_at` now share one `lower_and_size` helper that calls
     `frame_bank_unrepresentable` (and the new `mul_count_unrepresentable`, see the binary-encoding
     follow-up item 1 above — done together, same fix in the same functions) and reports a new
     `TmRun::TooLarge`, not `HitCap`: a refused program never took a step, so `HitCap` ("hit a
     step/cell cap") would itself be a claim of more than is true.

  2. **Length-3 enumeration** (rung 2 stops at 2). Exhaustive length-3 is ~11.2M programs per width —
     infeasible — but a seeded sample is easy. **Why deferred:** length 2 is where store-then-read
     interaction first appears, which is the shape the bank invariant is about; the marginal defect
     class at length 3 is speculative rather than identified. Revisit if a defect ever escapes to a
     3-instruction shape.

  3. **The LENGTH half of the bank skeleton has no static cover.** Rung 3 proves delimiters are never
     overwritten, for every execution. It cannot see the head walking off the end of the bank and
     extending the tape, because that is a position property; that half rests on simulation. The
     informal argument is that with delimiters provably intact, `rewind_home`'s counted `#`-walk cannot
     run off — but that is an argument, not a check. Closing it needs the head-offset dataflow analysis
     rung 3 deliberately avoided, whose own soundness would become a new thing to trust.

  4. **`Encoding::at_width` on an unbounded encoding — CLOSED (2026-07-27).** This item predicted the
     branch would become testable free "the day `Binary` lands". **That prediction was wrong, and the
     binary slice recorded why:** `Binary` is bounded (a `w`-cell field holds `v < 2^w`), so it does
     not exercise `field_width() == None` either. What covers the branch is a test-only `Unbounded`
     mock in `tests/tm_encoding.rs` that delegates every gadget to `Unary` and differs only in what it
     reports. Cheap, but not free, and not a side effect of anything.

  Also settled, so nobody re-opens it: **rung 4 (mechanized proof) was assessed and rejected.** Bounded
  model checking (Kani) loses to plain enumeration on this property, because the input space is small
  enough to enumerate while executions are 10^4-10^5 steps and would have to be symbolically unwound. A
  proof assistant would verify a MODEL and leave the model-matches-`encoding.rs` gap unproven — the same
  objection raised against rung 3's analyzer, one level larger.

  **What the dumb checker COSTS, measured 2026-07-28 — so the refusals above are priced, not just
  principled.** Decomposing one bank-invariant unit (debug, the profile the fast tier uses) into
  simulate-only / +watcher-call / +materialize-the-tape / +scan, over four workloads:

  | | simulation | watcher call | materialize | **invariant scan** |
  |---|---|---|---|---|
  | share of runtime | ~1% | ~0% | 18-20% | **~80%** |

  So `reg_bank_is_well_formed` rescanning the whole bank after every step IS the test. The machine it is
  checking is 1%. A TM step writes at most one cell per tape, so an INCREMENTAL check would be O(1)
  where this is O(cells), and it is inductively sound (verify the initial state, then each delta) — it is
  the only large lever left in this file.

  **Still rejected, for the reason rungs 3 and 4 were:** an incremental checker is cleverer, and its
  correctness becomes a new thing to trust, against a checker whose whole value is being "the same dumb
  tape check, looking at the same actual tape". The difference now is that the bill is known: **this
  project pays ~80% of the file's runtime for a checker too stupid to be wrong.** Reopen it only with
  that number in hand.

  **And a negative result worth not repeating.** `Tape::snapshot` allocates a fresh `Vec` per watcher
  call, which looked like the obvious free win inside that 18-20%. It is not: reworking it to refill a
  reused buffer was implemented and measured at **no effect** (49.2/55.5s vs 49.7/54.1s on the heaviest
  unit, ranges fully overlapping), because in a debug build the cost of materializing is the COPY, not
  the malloc — and the copy cannot go without giving the checkers an indexable view instead of a slice,
  since they index randomly. Reverted rather than shipped. The 18-20% is real but is not reachable by
  removing the allocation alone.

- **Fast-tier wall clock: 231.7s → 60.4s (3.8x), no assertion weakened (2026-07-28).** Plan:
  `plans/2026-07-28-test-suite-parallelism.md`, which carries the measured distribution. Two changes.

  **1. `cargo-nextest` is now the runner** (`scripts/check-all.sh`, CI). `cargo test` runs the 22 test
  binaries ONE AT A TIME and shares threads only WITHIN a binary, which left a 12-core machine at 1.39x;
  nextest pools every test from every binary. 231.7s → 135.2s, 623 tests, same pass set, nothing about
  any test changed. CI's coverage step moved to `llvm-cov nextest` too: 373.7s → 164.6s. **Coverage is
  not bit-identical and the CI comment says so rather than rounding it away** — 95.55% → 95.52% lines,
  the 10-line delta being example targets `--all-targets` instruments and nextest's default does not.
  The gate HARD-FAILS without nextest rather than falling back, so it behaves the same everywhere.

  **nextest does not run doctests and never will** (rustdoc is a separate pipeline), so every config
  pairs it with an explicit `cargo test --doc` at the same feature flags. That pairing had no teeth —
  the tree had zero doctests, so it executed nothing and asserted nothing, and a config added later with
  a bare `cargo nextest run` would have dropped doctests silently. `ty::show` now carries one real
  doctest so each config prints `1 passed` and a dropped pairing shows as a zero. **Do not delete it as
  redundant.** `scripts/check-slow.sh` deliberately stays on `cargo test`: nextest's `--no-capture`
  implies `--test-threads 1`, so converting it would serialise the thing the switch is for.

  **2. The corpus bank invariant was split so the runner can schedule it.** It was ONE `#[test]` running
  19 programs x 5 widths x 2 encodings — 131s on one core, 95%+ of what remained. Now one test per
  `(width, encoding)`. 135.2s → 60.4s; the file 131.0s → 49.8s.

  **The measurement chose the axis, and it was not the obvious one.** Cost is QUADRATIC in field width
  (4:0.48s 8:2.20s 16:7.23s 32:24.34s 64:94.26s), so width 64 alone is 73% and a per-width split leaves a
  94.3s long pole while looking like a fix. It also corrected the plan's own threshold: that had been set
  from the next tier OUTSIDE this file (~18-20s), but the real ceiling is inside it — the 51.2s generated
  proptest, which Task 3 may deliberately leave alone. A finer `(program, width, encoding)` axis gives a
  13s pole and saves nothing while that stands, so it was rejected in favour of 10 tests whose names say
  what they cover.

  **The guard is the deliverable, not the speedup.** The 10 tests hard-code the cross product, but
  `widths()` is COMPUTED from `MIN_FIELD_WIDTH`/`MAX_FIELD_WIDTH`. If `MAX_FIELD_WIDTH` doubles the new
  width is covered by NOTHING — the file gets faster AND weaker and every remaining test still passes.
  So the macro records what it emitted and `the_split_covers_the_whole_cross_product` compares that
  against `widths() x encodings_at` derived AT RUNTIME (never a second hard-coded list, or the guard just
  restates what it checks). Sabotage-verified in both directions — deleting a generated test and shrinking
  the width ladder each make it fail, naming the missing cell.

  **REJECTED with the measurement, because it is the obvious next idea.** `[profile.test] opt-level = 2`
  takes the suite to ~15s, a further ~9x and the largest single lever available. A probe showed a
  recursive 5,000-cell spine walk SURVIVES a 256 KiB stack once optimised (LLVM turns the tail call into
  a loop), so the small-stack guards in `lambda/decode.rs` and `value.rs` would pass against exactly the
  recursive implementations they exist to reject. It is not free speed; the price is paid in silence.

  **Honest bound and what stays open.** All timings are one machine, warm, debug except where stated. The
  floor is now the two ~50s bank-invariant tests, and ~80% of that is the invariant scan itself — see
  the bank-safety section above, where that cost is decomposed and the incremental-checker option is
  priced and declined. Task 3 (splitting the generated proptest by `prop_oneof!` alternative) is still
  open and is deliberately framed as a DECISION: it preserves the case count but changes the
  distribution and the seeds and can orphan a recorded regression, and on its own it moves the floor by
  only ~5s. Splitting width 64 further BY PROGRAM only becomes worthwhile once that proptest is split.

#### NOT BUILT, AND NOT YET JUSTIFIED — arena allocation for `Node`, raised 2026-08-03 by the β-fusion regression

**Raised by a measurement, and deliberately NOT designed yet.** β-fusion is 1.29–1.31x on the corpus and
**0.91x on the nested-group family** — a regression whose mechanism is, at the time of writing, *not
established*. What is established: the reducer enters identical nodes in identical order under both
`beta`s (counted, to the unit, at all eleven levels), so the whole difference is **~2 ns on each of
2,840 node visits per β-step**, and the fastest variants are the ones that **allocate more**. V4 —
which un-shares the substituted argument per occurrence, strictly more work than shipped — recovers
70% of the loss.

**Why an arena is the shape that fits that finding.** Every direct proxy for "does more memory work"
points the wrong way (V1 has the smallest RSS, the fewest minor faults, and the fewest allocations, and
is the slowest). What survives is the *layout* of what the allocator hands back: nodes allocated
together land together; nodes fetched from a free list at different times do not. An arena makes the
first case universal — a spine rebuilt in one β-step is contiguous by construction, allocation is a
pointer bump, and glibc's per-chunk metadata (~16 B against a small node) disappears. It would also
delete the variable four allocator-knob screens failed to pin down, by deleting the free list.

**Three obstacles, in increasing seriousness. The third is the one that makes this a rewrite.**

1. **Zero new dependencies** is the crate's rule, so `bumpalo` / `typed_arena` are out. Hand-rolling is
   ~50 lines and then this project owns an allocator.
2. **`Rc` wants individual deallocation and an arena does not do that.** A pure bump arena never frees;
   at level 11 the reducer makes on the order of 3×10^8 node allocations, which is tens of GB
   unreclaimed — dead on exactly the family this would exist to fix. Region-per-step with survivor
   copying is a garbage collector.
3. **The lifetime propagates through the whole API.** `&'a Node` in place of `Rc<Node>` means
   `LambdaTerm<'a>`, and that reaches `trace`, `ZipperCursor`, `LambdaCursor`, `reduce_trace`'s
   per-step materialisation contract, `lower`, `decode` and every test that holds a term across a call.
   This is the third representation change on this thread, and unlike the first two it is not local.

**What it is NOT blocked by:** the project's premise. `README.md`'s "what you see is the genuine
computation" forbids reaching the answer by a route that skips configurations — a Krivine machine, an
environment, explicit substitutions. An arena changes *where nodes live*, not which configurations
occur, so it is admissible on the same grounds structural sharing and the stored `depth` were.

**THE CHEAP EXPERIMENT COMES FIRST, AND IT DISCRIMINATES.** Swapping the global allocator — one
`#[global_allocator]` line and one dev-dependency, no change to the term type — tests the same
hypothesis at ~15 minutes against a multi-week rewrite. mimalloc and jemalloc both use size-segregated
free lists with reuse ordering unlike glibc's tcache:

- if the V0/V1 gap **collapses** under a different allocator, the mechanism is free-list policy and an
  arena is the principled fix for it;
- if the gap **survives all three allocators**, it is a property of the access pattern and an arena
  would have been an expensive way to discover that.

**Do not design this before the mechanism is named.** Four designs on this thread were falsified because
they were sized against cost models nobody had measured — the most recent over-counted by **1,584x**.
"Arena-allocate the nodes" on the strength of an unexplained 2 ns is that same shape. The instrument
that would name it is `perf stat` for cache and dTLB counters, with **V4 as the discriminator**: any
counter that separates V0 from V1 must also separate V4 from V1 and must place V4 with V0. That control
is what correctly rejected the traversal-locality story, which had looked obvious.

#### DEFERRED UNTIL WASM — re-measuring every probe timing under mimalloc (2026-08-04)

**The examples took `mimalloc` as their global allocator on 2026-08-04** (`[dev-dependencies]` only;
`redextape-core`'s `[dependencies]` stays empty and WASM-clean). It is worth **~9% to the three-pass
`beta` and ~16% to the fused one** on the nested-group family, and it is the explanation for that
family's β-fusion regression: glibc took **52% more L1 DTLB misses** from the fused build's changed free
pattern, and under mimalloc that gap is **1.9–2.2%**.

**Every timing recorded in the seven measurement probes predates this and is not comparable.** Each
carries a dated note saying so, so nothing in the tree is unmarked-stale. Counts are untouched — node,
allocation and step counts are properties of the reduction, not of the machine, and every count-based
result on this thread (the β-fusion gate at 4.28%, both 88,960-pair differentials, the sharing pins, the
census shares) stands.

**WHY IT IS DEFERRED RATHER THAN DONE: re-measuring now would answer a question by default that should
be answered by decision.** There is no `[[bin]]` in this workspace and `web/` does not exist yet, so
which allocator is the REFERENCE ENVIRONMENT is undecided — and WASM will not use `mimalloc` at all, it
gets `dlmalloc`. Re-measuring to mimalloc before the deliverable exists bets on the answer, and if
`web/` lands first the whole pass needs doing again.

**What is actually at risk, ranked.** The zipper's **1.41–1.43x** is the one figure that could move
materially — it is landed, quoted in four places, and its mechanism is *reducing allocation*, which a
cheaper allocator plausibly shrinks the margin on. Every site is now caveated `(glibc)`. Next,
`lambda_sharing_probe`'s PART C fitted node prices, which convert allocation counts into time shares —
the counts do not move, the attribution does. **The concurrency design's 159× is NOT at risk and moves
the safe way:** its argument is a ~13 ns δ-step against a ~2,063 ns barrier, barriers are allocator-
independent, so a faster δ-step makes every one of its five rejections stronger.

#### THE ZERO-DEPENDENCY RULE IS RETIRED AND REPLACED BY A GATE (2026-08-05)

Design: [`../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md`](../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md) §2.

**`redextape-core`'s empty `[dependencies]` was a PROXY, and the thing it proxies was unchecked.**
Empty is *sufficient* for wasm32-cleanliness, not *necessary* — `serde` builds for wasm32, and a
proc-macro dependency cannot break a wasm32 build at all, since it runs on the host at build time. The
encoding-registry entry above shows the rule applied past its own justification: `strum` was rejected
because "a derive macro is still a dependency edge."

**Nothing in CI verified the real property.** `rustup target add wasm32-unknown-unknown` appeared in
`ci.yml` exactly once, inside the `web` job — gated off until `web/package.json` lands — and
`check-all.sh` did not mention wasm at all. The invariant was held up by a manifest comment and
reviewer attention. **The rule was still right while that was true**, for a reason that is not about
wasm: "is `[dependencies]` empty?" is checkable in one line forever, and "does the whole transitive
closure build for wasm32 under every future version resolution?" is an audit nobody keeps running.

**The replacement is `scripts/check-all.sh`'s `wasm` leg** — a base-tier row running `cargo check
--target wasm32-unknown-unknown -p redextape-core --lib`, which checks the actual property at the PR
that would break it. `setup-dev.sh` installs the target; so do the two CI jobs that reach a base-tier
leg — `rust`, which runs `check-all.sh --no-llvm` directly, and `rust-scoped`, whose `check-scoped.sh`
ESCALATES to the same command on any change its default-deny arm does not recognise. `rust-llvm` does
not need it, because `--llvm-only` selects no base-tier row, and `rust-slow` runs a different script.
That second job was missed on the first pass and caught in review: being non-gating means it cannot
block a merge, not that it cannot go red. **The rule is now: dependencies are admissible, and the gate
decides.**

**Verified non-vacuous rather than assumed.** `mimalloc` was moved into `[dependencies]`, the leg
failed on `libmimalloc-sys` (C, no wasm32 toolchain), and the edit was reverted. A gate that would
pass anything is worse than no gate.

**Scope of the claim, unchanged and still stated honestly:** `--lib`, not `--all-targets`. The dev
graph is not wasm32-clean — `proptest` drags `wait-timeout` and `getrandom` — and was not before
`mimalloc` existed. Nothing short of dropping `proptest` would fix it. `--lib` is what a consumer
builds.

**The one-line proof survives as a bonus, not as the guarantee.** `serde` enters core in PR 2 as an
*optional* dependency, default off, so `cargo tree -p redextape-core --edges normal` with default
features still lists only itself.

**EIGHT PLAN DOCUMENTS RESTATE THE RULE FOR `REDEXTAPE-CORE`** (the roadmap is excluded — this change
is recorded here) **AND ARE DELIBERATELY LEFT AS WRITTEN.** They are
records of what was true when written, and this repository annotates rather than rewrites — the
"ANNOTATION, not a rewrite" entry above is the precedent, as is `README.md` keeping four dead λ
designs on purpose. A reader who lands in
[`2026-07-29-encoding-registry-and-generator-dedup.md`](2026-07-29-encoding-registry-and-generator-dedup.md)'s
"MUST STAY EMPTY" and obeys it does something harmless and slightly out of date; a history edited to
agree with the present is worse, because nothing then records that the rule ever changed or why.

**What this unblocks, and what it does NOT.** It makes PR 2's optional `serde` admissible. It does
**not** license the three dependencies this thread rejected: `strum` is deferred to the next change to
the encoding registry (design §9.5); `smallvec` stays rejected because `reduce_step`'s
`path.insert(0, ..)` makes path construction O(d²) and smallvec fixes neither that nor anything
measured (§9.6); `bumpalo` is unchanged, since the dependency was obstacle 1 of 3 and the other two
are what make an arena a rewrite (§9.7).

#### PLAN 4'S CONSUMER SLICE, HALF OF IT — `viewmodel.rs` AND FOUR MISSING CAPABILITIES (2026-08-05, PR #11)

Design: [`../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md`](../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md) §3, §4.
Plan: [`2026-08-05-core-viewmodels-and-source-leg.md`](2026-08-05-core-viewmodels-and-source-leg.md).

**PR 2 of 3.** PR #10 was the wasm32 gate; PR 3 is `crates/redextape-wasm`, `web/` and the pnpm
migration. This one ends with a tested contract and no consumer, which is the intended resting point.

**`redextape-core` has a dependency for the first time** — `serde`, optional and default-off. Only
admissible because #10 replaced "keep `[dependencies]` empty" with a gate that checks the real
property. `cargo tree --edges normal` still lists only the crate in a default build.

**Four capabilities the design assumed and the code did not have:**

- **`TmCursor<M: Borrow<Machine>>`.** A session must hold the `Machine` AND a live cursor over it,
  which `TmCursor<'m>` makes self-referential.
- **`raise_cap` on both cursors.** §6.4's "still running — hit 50k steps ... continue" had nothing to
  call: `LambdaCursor` latched `HitCap` forever and `TmCursor::new` restarts from `machine.start`.
- **`print_lambda_capped`.** The λ term is an `Rc`-shared DAG whose printed size is its LOGICAL size.
- **`desugar_mapped` + `SourceMap::node_to_source`.** §5.4 specified two maps and never a source one.

**THREE DEFECTS PASSED EVERY TEST, AND THE SHAPE IS THE LESSON.**

1. **`TmState::window` cloned the whole tape** while documented "never the whole tape" — O(tape) to
   return O(radius), the exact cost the `TmProgram`/`TmState` split exists to avoid. Tests passed
   because they asserted *lengths*.
2. **`LambdaState::ast` transposed every application.** `to_tree` pushes `Enter(a)` then `Enter(f)`;
   LIFO puts `a`'s result on top and the arm popped `f` first. The comment above it stated the
   correct order. 692 tests passed because **nothing asserted a tree's shape**.
3. **`print_lambda_capped` aborted the process.** `write_app_fn` descends writing zero bytes, so the
   budget guard never fires and recursion depth equals the spine length — 100,000 juxtaposed atoms
   overflowed the stack at a 16-byte budget. Under wasm that is an abort that poisons the module.

Each was found by asking a question the suite was not asking — enumerate the write sites, assert a
shape, check whether the depth premise is true. **A test that checks a size cannot catch a wrong
value, and a test that checks presence cannot catch a wrong structure.**

**The depth fix produced an invariant worth keeping:** the printer's depth counter maximum equals
`LambdaTerm::depth()`, and `depth_exceeds` is `t.depth() > limit`, so **printable ⟺ steppable**. A
renderer never sees depth-truncation without a matching "cannot continue" status.

**TWO FIELDS WERE REMOVED RATHER THAN SHIPPED WRONG, and the second was measured.** `LambdaState` has
no `redex` — a redex *span* needs the printer to record where a path lands, not in this PR, and a
structurally-always-`None` field cannot be told from "not implemented". It has no `source_node`
either: `node_to_lambda`'s paths are root-relative into the INITIAL term, a `Beta` event at step N
indexes a structurally different tree, and the lookup matched anyway because the root sits at the
empty path. On `let x = 40; x + 2` all seven steps reported `"let x = 40;"` and `x + 2` was never
named — the fallback `sourcemap.rs` forbids, one layer out. `TmState.source_node` stays; it is
honestly `None`.

**FOURTEEN FALSE CLAIMS WERE CORRECTED, which was this branch's real defect class.** Comments
asserting more than the code delivers, including two in this roadmap's own §4.5 wording and one — the
worst — stating that `MAX_PARSE_DEPTH` made the deep-spine case unreachable from the parser.
`parse_application` loops over juxtaposed atoms at constant parser depth, so `λa.` and 30,000 `a`s
parses at depth **2**. Believed, that comment licenses deleting the guard that closes defect 3.

**Recorded, not fixed** — each noted at the code: UFCS callee spans point at the whole method call,
because `ast::Expr::Method` discards the name's span (a two-line parser change fixes it);
`Block.span` is asymmetric, so a tail-less block's synthesized `Unit` highlights `"n; }"`;
`TermNode` is `Box`-recursive with a derived `Drop`, bounded in practice by the caller's
`node_budget` and NOT by `MAX_LAMBDA_LOWER_DEPTH` (a one-line `500000` lowers to a λ term of depth
500,003); and `Tape`'s window accessors are `pub(crate)`, so PR 3 needs a small core change before it
can implement `tapeSlice`.

> **CLOSED 2026-08-07** — the `TermNode` item above, specifically. `TermNode`'s children are now `u32`
> indices into a flat `TermTree`, so the derived `Drop` no longer recurses at any depth; the
> `node_budget`/`MAX_LAMBDA_LOWER_DEPTH` distinction above no longer applies, because there is no
> depth-linear path left to bound. Measured, not merely closed by construction: the recursive shape
> did not trap at any reachable depth on the shipped 8 MiB shadow stack either, so this was structural
> insurance, not a crash fix. See
> [`../specs/2026-08-07-termnode-arena-design.md`](../specs/2026-08-07-termnode-arena-design.md) §0, §2.
> The other three items in this list are unaffected and remain open.

#### PLAN 4'S CONSUMER SLICE, THE WASM SESSION — `crates/redextape-wasm` (2026-08-05, PR #13)

Design: [`../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md`](../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md) §5.
Plan: [`2026-08-05-wasm-session.md`](2026-08-05-wasm-session.md).

**PR 3a of 3, and §10's landing order had four PRs rather than three when this entry was written.**
PR 3 split because the JavaScript half carries an entirely different toolchain and a registry-push
side effect that deserves its own reviewable event. ~~**PR 3b is `web/`, the pnpm migration, the
`Dockerfile`/`ci.yml` web edits, and arming the `docker` push.**~~ **CORRECTED 2026-08-07: that is not
what PR 3b turned out to be.** The design spec
([`../specs/2026-08-06-wasm-boundary-completion-design.md`](../specs/2026-08-06-wasm-boundary-completion-design.md),
opening paragraphs) split PR 3b a second time — keeping the "3b" label for the boundary completion (`runLambda`,
`Decoded`, the third leg, `TmStatus.total_steps`, the raised shadow stack; see the entries below) and
moving `web/`, the pnpm migration, the `Dockerfile`/`ci.yml` edits and arming the `docker` push to a
new PR 3c. **§10's landing order now has FIVE PRs, not four** — the wasm32 gate, `viewmodel.rs`,
`crates/redextape-wasm` (3a), the boundary completion (3b), and the app (3c) — verified against the
design spec's own §10 rather than assumed. This PR (#13, PR 3a) itself still adds no JavaScript and
still leaves the `web` and `docker` jobs dormant.

**The crate is `cdylib` + `rlib`, and the second is a coverage requirement, not a convenience.**
`wasm-bindgen-test` runs in a browser while `llvm-cov` instruments the native build, so any logic in
the `#[wasm_bindgen]` shell is uncovered BY CONSTRUCTION. `session.rs` holds every branch and is
natively tested; `lib.rs` is marshalling and one error conversion. Measured: **95.50% workspace lines,
down from 95.85%, against a floor of 80** — `lib.rs` is 0% over 64 lines, which is the cost that
design accepts, and `session.rs` is 95.7%. A material drop would have meant logic had leaked into the
shell; 0.35 points did not. **CORRECTED 2026-08-07: "95.50% workspace lines" mislabeled the column —
95.50% was REGIONS, not lines.** The true figure this PR left the tree at is **96.04% lines / 95.53%
regions**. The design spec's §8 coverage expectation carried the same mislabeled figure forward and is
corrected at that site too; the boundary-completion entry below states the true figures from the start
rather than repeating the error.

**FOUR THINGS CORE DID NOT EXPOSE, none of them in the spec** — each found while writing the plan:

- **`Tape::slice(from, to)`**, plus `head_index`/`window` made `pub`. An external crate holding
  `&[Tape]` could only call `snapshot`, whose O(tape) clone is what `TmState::window` was changed to
  stop paying. `cells()` stays `pub(crate)`: a returned `Vec` shorter than `to - from` already tells a
  caller the range ran off an end, so the contract needs no length accessor.
- **`TmProgram.start`.** A renderer could not learn the entry state without building a `TmState`.
- **`TmState::window` takes a `&SourceMap`** and resolves `source_node`. §6.2's dual-focus highlight
  is the consumer that decided it. **This one survived where `LambdaState`'s did not, and the reason
  is the whole distinction:** it is keyed by the state's printed NAME, and a name is not a coordinate
  into a tree that reduction rewrites underneath it.
- **`TmCursor::machine()`** — a FIFTH the plan did not anticipate. `state()` is only an index, and the
  cursor's `machine` field was private, so `window` had no way to get from one to the other.
- **`LambdaCursor::depth_capped()`** — a SIXTH, found by reviewing the branch rather than by writing
  it. See below: without it the run status cannot be honest.

**`raiseLambdaCap`/`raiseTmCap` SHIPPED AS API NOTHING COULD CORRECTLY DECIDE TO CALL, and the review
that caught it is the point.** `stepLambda`/`stepTm` answer `false` for EVERY end condition —
normalized/halted, hit-cap, and (λ) depth-refused — and nothing else exposed the difference:
`lambdaStatus`/`tmStatus` described whether the LEG existed, not how the RUN ended. So a renderer
could not tell a finished run from one that spent its budget, and "continue" is meaningful for exactly
one of those. §3.3 justifies `raise_cap` existing by §6.4's "still running — hit 50k steps ...
continue"; the data half of that affordance belonged in this PR and had been left out of it.

`RunStatus` is `Running | Ended | Capped | DepthRefused`. **The fourth variant is not pedantry:** the
λ cursor latches `HitCap` for the depth guard too, and raising the cap cannot make a term shallower —
folding it into `Capped` would put the button on the one run that cannot continue, which is the defect
`raise_cap`'s own guard fixed one layer in, reintroduced at the boundary. Telling them apart needed
`depth_capped()` in core, because `status()` cannot.

**ONE SERIALIZER, AND THAT WAS A FIX RATHER THAN A TIDY-UP.** `serde-wasm-bindgen` renders
`Option::None` as `undefined`; the first cut special-cased the two top-level returns to `null` and left
struct FIELDS on the default — so `lambdaStatus().run` would have been `undefined` while `lambdaAst()`
was `null`, one boundary needing two rules in the renderer. `serialize_missing_as_null` everywhere.

**THE PLAN'S SKETCH FOR READING `run_tm_described` WAS WRONG, and checking beat assuming.** It
proposed `Err(TmRun::Overflow) => TmDecline::Overflow`. `lower_and_size` is that function's only
fallible call and produces `LowerError` or `TooLarge` and nothing else — reaching `MAX_FIELD_WIDTH`
and still overflowing returns **`Ok` with `run: TmRun::Overflow`** and a machine attached. The decline
is read off `d.run` too, so it is two matches, not one. `Ran` and `HitCap` both yield a working
cursor, which is why `HitCap` is deliberately not a `TmDecline`.

**`compile` BUILDS THE MAP AT `MIN_FIELD_WIDTH` AND LETS THE RUN AUTO-FIT ITS OWN WIDTH.** Sound only
because `lower_tm` derives state NAMES from the instruction stream rather than the field width — and
the failure would have been silent, since `source_node` would read `None` everywhere, which is also
what it honestly reads for scaffolding. Pinned by a test rather than trusted.

**The commit split the plan asked for was not achievable.** It wanted the crate, the λ leg and the TM
leg as three commits; the pre-commit hook runs clippy with `-D warnings`, and a `Session` whose fields
no method reads yet is `dead_code`. The three are a unit or they are nothing.

**Proven in a browser, not merely compiled.** 4 `wasm-bindgen-test` cases green under headless Chrome
151, and `wasm-pack build --release --target web` produces a 572 KB module — Plan 4's own named
testable outcome. **Every browser call goes through `Reflect`**, looking each method up on the
prototype of the object `compile` returned: holding a `Session` as a Rust value would re-run the
native tests in a browser and never touch the generated glue. Both sides pin the same figures —
`let x = 40; x + 2` is 7 β-steps to Church 42 and 2,870 δ-steps on a 5-tape, 123-state machine fitted
to width 64 — because "the values that come back are the ones a native run produces" is otherwise a
hope rather than a claim.

**Two deviations from §5.3 and §5.1, both stated at the code.** `serde` is a direct dependency (not a
new edge — `serde-wasm-bindgen` already pulls it; named directly because a `derive` needs the crate in
scope, and the alternative was `js_sys::Reflect` branching in the shell). And `raiseLambdaCap`/
`raiseTmCap` take `u32` and widen, because wasm-bindgen maps `u64` to JS `bigint` and §5.1 writes
`extra: number`; the raise is additive and saturating, so nothing is lost.

**The gate's `wasm` kind moved its package into the rows.** It hardcoded `-p redextape-core --lib`,
which cannot name a second crate without checking both in one invocation and reporting them as one
leg — so the crate whose ONLY real target is wasm32 would have failed under the other crate's name.
`wasm-pack test` stays out of `check-all.sh`: it needs a browser, and the local merge check should not.

#### PLAN 4'S BOUNDARY COMPLETION — `runLambda`, `Decoded`, the third leg, and the count core already had (2026-08-06/07, PR 3b)

Design: [`../specs/2026-08-06-wasm-boundary-completion-design.md`](../specs/2026-08-06-wasm-boundary-completion-design.md).
Plan: [`2026-08-06-wasm-boundary-completion.md`](2026-08-06-wasm-boundary-completion.md).

**PR 3b of the five-PR landing order** (see the correction on PR 3a's entry above): the wasm32 gate,
`viewmodel.rs`, `crates/redextape-wasm` (3a), this slice, and the app (3c). Eight tasks, eight commits
— the `dead_code` lesson PR 3a's entry recorded above is why this PR could split at all: each field
lands in the same commit as the method that reads it, rather than as one undividable unit.

**Two free exports, so linting never runs a backend.** `classifySource` and `analyze` close the two
gaps the design's §2 found first, and the reason is a number, not a preference: the only route to any
diagnostic before this slice was `compile()`, which lowers both backends **and runs the TM to a
halt** — 344,999 δ-steps on the `map` demo. A source pane wired to `compile` for a red squiggle on
every keystroke would have gone through that simulation on every keystroke. `classifySource` wraps
`analysis::classify_source` (highlighting only — no diagnostics, because highlighting a broken file is
when it matters most); `analyze` wraps `core::analyze` (parse + typecheck + desugar, no backend at
all). Both were already `pub` in core, so exporting them cost no new derive and no new viewmodel type.

**`runLambda(budget)` replaces the single-step-only boundary with a chunked one, built around a
distinction that gets the affordance backwards if it is missed.** `MAX_REDUCTION_STEPS` is
5,000,000, so `while (s.stepLambda()) {}` is up to five million boundary crossings on the main thread
with no progress and no cancellation; chunked at, say, 50,000 steps, that is roughly 100 crossings
with progress rendering and cancellation for free. **THE LOAD-BEARING DISTINCTION: a spent chunk
budget is not a spent cap.** Exhausting `budget` leaves the run `Running`; only the cursor's own cap
yields `Capped`. Backwards, this puts a continue button on a run that has merely paused for its chunk
to end, and hides "continue" from the one run that can actually use it — the same shape of defect PR
3a's own entry recorded above for `raiseLambdaCap`/`raiseTmCap` shipping as API nothing could
correctly decide to call, reintroduced one layer out if this had gone the other way.

**`Decoded`, and its wire shape had to be measured rather than designed.** Four states rather than
`string | null`, for the reason `RunStatus` has four rather than three: `decode_lambda_ty` and
`decode_tape_ty` both answer `Option<Value>`, and "the run has not finished" and "it finished and the
result is not a recognizable encoding" are different facts a renderer must not flatten into one blank
field. **CORRECTED 2026-08-07 at the design spec's §3, the seventh plan defect this branch corrected
mid-flight:** the TypeScript the design drafted for `Decoded` — a normalized `{ kind, ... }` union —
is not what crosses. `Decoded` is externally tagged and mixes unit and struct variants, so the real
shape is `"Undecodable" | "Unfinished" | { Value: { text } } | { Fault: { message } }`; a consumer
must branch on `typeof x === "string"` before indexing it. See the design spec for the measurement and
the full correction, including why a comment in `tests/browser.rs` — which is what the plan's Task 8
Step 2 told the implementer to fix it with — was not an adequate home for a falsified wire-format
claim.

**`evaluate()` puts the reference interpreter on the boundary as a third leg**, so a disagreement
between the λ and TM backends is visible in the product and not only in CI's three-way oracle. §8 of
the design moves that oracle to the layer the product reads, in
`all_three_legs_agree_across_the_boundary`.

**`lambdaValue()` and `tmValue()` decode a leg's answer into the same `Decoded`, and `tmValue()`'s
defining property is what it does NOT do.** It does not re-run the machine. `compile` already ran the
TM to a halt inside `run_tm_described`; driving the cursor again for the same answer would repeat the
`map` demo's 344,999 steps. The result comes from the run `compile` already performed, kept rather
than re-derived.

**The `Session` grows five fields it needed all along** — `core`, `ty`, `final_tapes`, `kind`,
`total_steps` — each kept because `compile` already built it and, before this slice, threw it away:
`core: Core` for `evaluate`; `ty: Ty` for both decoders; `final_tapes`/`kind` for `tmValue`;
`total_steps` for `TmStatus.total_steps`.

**`TmStatus` grows `total_steps`, and `LambdaStatus` gets no counterpart — deliberately, not by
oversight.** The TM's length is known at compile time because `compile` ran the machine to
completion; λ's is not, because `compile` builds the cursor and never reduces. There is no honest
number to put on `LambdaStatus` for the same field.

**The number itself was always available in `redextape-core` and every layer above discarded it.**
`sim::run` has counted δ-steps since before this slice, to enforce the step cap, and `simulate`,
`simulate_final`, `simulate_watched`, `simulate_trace` — and every test and demo built on them —
discarded the count rather than reporting it. It now rides on **`DescribedRun.steps`**: `run_tm_described`
answers `Err` only for a program that never ran, so a `DescribedRun` always describes a run that
started, `HitCap` and `Overflow` included, and both of those have step counts a field hung off
`TmRun::Ran` would have had nowhere to put.

**The gate.** Browser suite **9/9** in headless Chrome. `scripts/check-all.sh --no-llvm` green, all
three wasm legs. `wasm-pack build --release --target web` succeeds at **604,966 bytes**. Coverage
**95.98% lines / 95.48% regions**, measured on the final tree after the whole-branch review's fixes
landed — the figure taken before them was 95.93% / 95.46%, and it went UP rather than down despite
`lib.rs` gaining a seventh export, because the five tests those fixes added cover more than the new
marshalling costs.

**On that coverage figure, precision matters more than the arithmetic that looks like proof.** PR 3a's
own entry above recorded the pre-slice baseline as "95.50% workspace lines" — **that was the REGIONS
column, not lines**, corrected in place there; the true baseline this slice started from is **96.04%
lines / 95.53% regions**. Reproducing that baseline to two decimal places after `lib.rs` roughly
doubled would look like proof nothing leaked out of the marshalling shell — 95.98% and 96.04% are
0.06 apart, 95.48% and 95.53% are 0.05 apart, both "a few tenths" as the design predicted. **That
arithmetic is not the evidence, and it is not why nothing leaked.** It holds only because
`session.rs`'s new lines happen to land near the pool average, which is coincidence, not a property
under test. **The load-bearing number is the per-file row: `session.rs` absorbed every one of this
slice's decisions and its own coverage ROSE rather than fell — it finishes at 96.19% lines / 97.50%
regions, against a 92.26% baseline.** (Both columns are named deliberately: mislabelling one as the
other is the exact error corrected twice in this file.) A shell that had absorbed logic it was not supposed to hold would
show the opposite signature on that row — more lines and falling coverage on the file doing the
marshalling. It shows the reverse; that is what "nothing leaked into `lib.rs`" actually rests on, not
the workspace total.

**A known gap handed to PR 3c, not closed here.** `evaluate()` runs with a 5,000,000-step default
budget (`interp::DEFAULT_BUDGET`) in one uninterruptible call, and it is not cached — every call
re-runs the interpreter from scratch. `interp::eval` is not resumable the way `LambdaCursor` is, so it
cannot be chunked the way `runLambda` was. **The owner chose to expose a budgeted variant,
`evaluateWithBudget`, rather than cache the result — so this slice ships SEVEN new exports, not the
six the plan scoped.** Stated plainly, because a scope change that lands unremarked is exactly the
defect class this section exists to prevent.

**And the already-known `lambdaAst` question travels forward to PR 3c too, not answered here.** It
returns a recursive `TermNode` that `to_value` serializes to JS. The WALK that builds that tree is
deliberately iterative — an explicit worklist, no native recursion, precisely because a native
recursive walk cannot be trusted at this depth — but serde's derived `Serialize` on the recursive
`TermNode` enum is not iterative. So the shadow-stack headroom the entry below measured is established
for `compile` only, not for `lambdaAst`. Recorded, not fixed: PR 3c is the first slice where a human
clicks through that method, and it is the one that must check it.

> **CLOSED 2026-08-07 — structurally, not by a guard.** `TermNode`'s children are now `u32` indices
> into a flat `TermTree`, so neither derived impl recurses at any depth and no depth constant was
> added. Design:
> [`../specs/2026-08-07-termnode-arena-design.md`](../specs/2026-08-07-termnode-arena-design.md).

**THERE ARE TWO RECURSIVE PATHS ON `TermNode`, NOT ONE, AND THE PROJECT ALREADY PAID TO FIX THIS
HAZARD ONE TYPE OVER.** Alongside the derived `Serialize` above, `TermNode` (`viewmodel.rs`,
`Abs(String, Box<TermNode>)` / `App(Box<TermNode>, Box<TermNode>)`) has a **derived `Drop`**, which
recurses on the same spine — so a tree deep enough to trap while serializing is also deep enough to
trap while being freed, and the second one fires on a path no caller can see. This is not a
theoretical worry: `LambdaTerm`, the type `TermNode` is BUILT FROM, carries a hand-written iterative
destructor at `lambda/term.rs:482` for exactly this reason. The view-model type reintroduced the shape
that destructor exists to defeat. PR 2's ledger recorded the `Drop` half at the time and it was not
actioned; it is written here so it stops living only in a scratch file.

Why it is worth closing rather than watching: a wasm trap has no unwinding, so **neither path returns
an error — both poison the module**, and the `Drop` path can fire while unwinding from something else
entirely. `LambdaTerm::depth` is an O(1) stored invariant, so a depth guard on the `lambdaAst`
boundary is cheap and does not need a measurement to justify it. Measure both paths, or guard the
entry point, before PR 3c ships a UI that calls `lambdaAst`.

> **CLOSED 2026-08-07, both ways this paragraph named.** Neither path needed a depth guard, and neither
> was left at "measure or guard": `TermNode`'s children are now `u32` indices into a flat `TermTree`,
> so `Serialize` and `Drop` are both closed structurally, at no depth. Measured before the fix landed,
> the hazard also did not reproduce on the shipped 8 MiB shadow stack at any depth the front-end guards
> admit — so this was not, in the end, a crash fix. See
> [`../specs/2026-08-07-termnode-arena-design.md`](../specs/2026-08-07-termnode-arena-design.md) §0, §2.

**One shape was filed and then fixed before merge.** `Session.program: Option<TmProgram>` was `Some`
exactly when `Session.tm` was `Ok` — both were set from one match arm in `compile` — so the two fields
encoded one fact twice and the type system could not say so. `tm_status` therefore had to match on the
PAIR and handle a state that cannot occur, and it could not answer that state with `unreachable!()`,
because a panic under wasm aborts the module. It fabricated a user-facing status instead, reading
`"internal: a TM leg with no projected program"` — **an error message for a condition no input can
produce, and therefore one no test could ever trigger or cover.** Separately, `tm_program` read
availability from `program` while `tm_status` read it from `tm`: two sources for one fact, the same
drift hazard `DescribedRun.steps` is cross-checked against a `TmCursor` to prevent.

`tm: Result<(TmProgram, TmCursor<Rc<Machine>>), TmDecline>` deletes the `Option`, the impossible arm
and the fabricated string together, and gives availability a single source. Four match arms become
two. The pairing is what makes the bad state unrepresentable rather than merely unreached.

It was PR 3a's shape rather than this slice's, and this slice first made it MORE visible without
acting on it — `build_tm_leg` already returned the program and the cursor together and `compile`
immediately split them apart again, so the code built them as one thing and then took them apart. The
fix was to stop splitting. Behaviour is unchanged: all 48 crate tests passed unmodified, and the one
test that needed an edit needed it to COMPILE (it read both fields) rather than to pass.

#### THE WASM SHADOW STACK, MEASURED — and the depth guards were decorative, exactly as feared (2026-08-06, PR 3b)

`.cargo/config.toml` now links wasm32 with `-C link-arg=-zstack-size=8388608`, target-scoped so native
is untouched. **NOTHING IN `redextape-core` CHANGED, AND NO CONSTANT GAINED A
`#[cfg(target_arch = "wasm32")]` VALUE.** Raising the stack to the size the bounds were calibrated
against was enough; diverging the seven constants per target would have made the browser refuse
programs the CLI accepts, and the measurement says it is not necessary.

**The measurement, in headless Chrome 151, on a DEBUG build** — which is the conservative side, since
release frames are smaller than the ones measured here. Two shapes, because one is not enough: a list
literal is `Expr::List { items }`, FLAT in the AST, so it never reaches the parser or typechecker
guards and only becomes deep after desugaring into a `cons`-`Apply` spine; a left-nested `+` chain is
the shape `MAX_TYPE_DEPTH` actually bounds.

| shape | stock 1 MiB shadow stack | shipped 8 MiB |
| --- | --- | --- |
| list literal, *n* elements | **255 returns, 260 aborts** | **no crash at any *n*** — 3,000 returns |
| left-nested `+` chain, *n* operands | **250 returns, 300 aborts** | 1,498 returns (browser-measured); a native probe puts the guard's true boundary one operand higher — counting operands written, **1,499 returns, 1,500 is refused** by `MAX_TYPE_DEPTH` |

**THE SHADOW STACK WAS BINDING, NOT THE ENGINE'S CALL-DEPTH LIMIT.** The crash depth moved — what
aborted at 260 now returns at 3,000 — and the trap says the same thing twice over: every abort
reported `RuntimeError: memory access out of bounds`, the shadow-stack pointer running off the end of
linear memory, and never `Maximum call stack size exceeded`, which is what the engine limit raises. A
module cannot set that second limit; it did not have to.

**The roadmap's "the crash arrives around depth 180" was wrong, and it was never measured.** It is
256–260 for the shape the native measurement used. Corrected at the original claim above rather than
only here.

**THERE IS NO POST-FLAG CRASH DEPTH, and that is the result rather than a gap in it.** At 8 MiB the
guards refuse before the stack runs out: past 580 the TM lowering declines, past 700 the λ lowering
declines, and at 1,500 the typechecker does (1,499 operands written is the deepest it accepts) — so no
input **`compile`** accepts can be pushed deep enough to trap. Scoped to `compile` deliberately: see
the note on the session's post-compile surface below the per-pass paragraph — this measurement never
exercised it. The margin therefore had to be measured by bisecting the STACK SIZE against each worst
case that IS reachable, rather than bisecting the depth against a fixed stack:

| deepest input the guards admit | shadow stack it needs |
| --- | --- |
| 575-element list — the fattest LIST shape this bisection reached (TM lowers *and* the machine runs); NOT the fattest reachable shape overall — see below | > 2 MiB, ≤ 3 MiB |
| 699-element list — `MAX_LAMBDA_LOWER_DEPTH` at its limit, TM already declined | > 2 MiB, ≤ 3 MiB |
| 1,498-operand chain, one operand below `MAX_TYPE_DEPTH`'s true limit of 1,499 (native probe; see the shape table above) | > 1 MiB, ≤ 2 MiB |

So the shapes actually bisected need 2–3 MiB of the 8 given, which the original entry reported as a
**2.7x–4x margin**. **That arithmetic used the wrong worst case.** `lambda/lower.rs:36-38` records the
project's own native calibration: the UNGUARDED lowering survived depth 1453 and overflowed by 1473 on
its fattest reachable shape — a store-passing region's statement spine (the `let mut`/`while` path) —
while a plain list spine, the shape bisected above, survived to ~1750. That is roughly **19% fatter
frames per level** for the store-passing spine (1750/1473 ≈ 1.19), and this bisection never touched
that shape directly. Scaling the 2–3 MiB figure by that factor gives the true worst-reachable-case
need: roughly **2.4–3.6 MiB**, a **~2.2x–3.4x margin** — the figure a future reader should rely on,
not 2.7x–4x. **The decision does not flip**: 2.2x still clears the rule's 2x floor, but it is
materially thinner headroom than 4x for a future guard-raise to plan against. This is a scaled
estimate, not a fresh measurement — bisecting the store-passing shape directly would cost many more
minutes of browser time for a result that would not change the decision, so it was not run.

Comparing that stack-size margin against the ~2.1x native DEPTH margin `MAX_LAMBDA_LOWER_DEPTH` was
calibrated at (`lambda/lower.rs:39`) assumes STACK USE IS LINEAR IN DEPTH for this pass — true here,
since lowering is a straight-line recursive walk with no growth in per-frame state as depth increases,
but stated explicitly because it is the premise that makes a stack-size ratio and a depth ratio
comparable at all.

**A CRASH DEPTH IS PER-PASS, NOT PER-TARGET, and comparing the largest bound to one number would have
given the wrong answer.** `MAX_TYPE_DEPTH` is 1,500 while the list shape's extrapolated 8 MiB crash is
~2,050 — 0.73 of it, which fails a naive "every bound below half the crash" test. But those are
different frames: typecheck's are thin enough that depth 1,499 fits in under 2 MiB (the chain actually
bisected above used 1,498, one operand below the guard's true limit), while the lowering's are fat
enough that depth 575 does not. `MAX_LAMBDA_LOWER_DEPTH`'s own doc already says this ("these frames
differ in size from `lower_into`'s, so the number follows this module's own measurement"); the wasm
answer obeys the same rule.

**THIS MEASUREMENT ESTABLISHES THE INVARIANT FOR `compile` ONLY.** The session's post-compile surface
is untested: `lambdaAst` returns a recursive `TermNode` (`viewmodel.rs:130-134`, `Var`/`Abs`/`App`)
that `to_value` serializes to JS. The tree-building WALK is deliberately iterative
(`viewmodel.rs:158-176`, explicit worklist, no native recursion) precisely because a native recursive
walk cannot be trusted at this depth — but serde's derived `Serialize` on that recursive enum is not
iterative, and a 600-element list's λ term is thousands of nodes deep. Whether that derived
`Serialize` overflows the shadow stack before `LambdaState::ast`'s own `node_budget` truncates it is
not established here and is out of this task's scope. **PR 3c, the first slice where a human clicks
through `lambdaAst` and the session's other post-compile methods, must check it.**

> **CORRECTED 2026-08-07 — "thousands of nodes deep" conflated node COUNT with DEPTH, and the
> conflation overstated the risk by an order of magnitude.** Measured: a 600-element list's λ term is
> **8,403 nodes with a depth of 607** at compile time — depth, not count, is the quantity both
> recursive paths are linear in. Under reduction the same program reaches depth **1,805** natively
> (**1,803** measured in a browser, the gap being sampling discretization), and an ordinary recursive
> `sum(100)` reaches **3,001**, which is `MAX_TERM_DEPTH` itself. The question this paragraph left
> open is answered, and not the way it feared: `lambdaAst` was called repeatedly across both
> reductions on the shipped 8 MiB shadow stack and returned a tree every time — the trap does not
> reproduce. See
> [`../specs/2026-08-07-termnode-arena-design.md`](../specs/2026-08-07-termnode-arena-design.md) §0,
> §2.

> **CLOSED 2026-08-07 — structurally, not by a guard.** `TermNode`'s children are now `u32` indices
> into a flat `TermTree`, so neither derived impl recurses at any depth and no depth constant was
> added. Design:
> [`../specs/2026-08-07-termnode-arena-design.md`](../specs/2026-08-07-termnode-arena-design.md).

**And `Serialize` is only one of the two recursive paths on that type** — `TermNode`'s `Drop` is
derived and recurses on the same spine, so the tree can also trap while being freed, on a path no
caller can see. The boundary-completion entry above carries the full argument, including why this is
known-real rather than theoretical: `LambdaTerm`, the type `TermNode` is built from, already has a
hand-written iterative destructor (`lambda/term.rs:482`) for precisely this hazard.

> **CLOSED 2026-08-07, and "known-real" is the phrase this entry's own design spec retracts.** Measured
> on the shipped 8 MiB shadow stack, the hazard this paragraph calls known-real did not reproduce at any
> depth the front-end guards admit — see
> [`../specs/2026-08-07-termnode-arena-design.md`](../specs/2026-08-07-termnode-arena-design.md) §0.
> What survives is structural: `TermNode`'s children are now `u32` indices into a flat `TermTree`, so
> neither `Serialize` nor `Drop` recurses, regardless of depth.

**`MAX_PARSE_DEPTH` WAS ITSELF UNREACHABLE ON STOCK WASM — the guard trapped before it could fire.**
A 400-deep paren nest refuses natively at **300 parens written** (299 is the deepest accepted — the
parser's own internal depth counter is a different quantity from a count of parens written, and first
exceeds `MAX_PARSE_DEPTH` = 300 while parsing the 300th paren; do not read that counter as the token
count). Run alone against a 1 MiB shadow stack it aborts the module instead. This is the sharpest
evidence that the guards were decorative rather than merely tight, and it is now a committed test.

**What ships is the safe side only,** three cases in `tests/browser.rs`: refusal at 400 nested parens,
a clean compile at 200 elements, and a 600-element list that compiles at 8 MiB and aborts at 1 MiB.
The last is the regression test for the link arg — verified by re-running the whole suite with the
stock stack forced back on, where it traps and takes the rest of the file down with it, which is
precisely why the crash depth itself is recorded in this prose and not asserted in the suite.

**One plan claim the measurement falsified.** The task brief's own safe-side test proposed a
400-ELEMENT LIST as the program "deeper than `MAX_PARSE_DEPTH` (300), so the front end refuses it
before any backend runs". It is not: a list literal is flat in the AST and `MAX_PARSE_DEPTH` counts
`parse_binary`/block nesting only, so 2,000 elements still parse and typecheck with **zero**
diagnostics. The shipped test uses nested parens, which is what that guard bounds.

#### THE TERMNODE ARENA LANDS — structural insurance and consumer safety, NOT a crash fix (2026-08-07)

Design: [`../specs/2026-08-07-termnode-arena-design.md`](../specs/2026-08-07-termnode-arena-design.md).
Plan: [`2026-08-07-termnode-arena.md`](2026-08-07-termnode-arena.md).

**MEASURED FIRST, AND THE MEASUREMENT FALSIFIED THE SLICE'S OWN PREMISE.** The `Box`-shaped `TermNode`
the two entries above left open was tested in headless Chrome on the shipped 8 MiB shadow stack and
did **not** trap at any depth the front-end guards admit. **So this is not a crash fix**, and writing
it as one would have been the exact defect this roadmap's own lesson names — a hazard claim is not
established until a program chosen to break it has been run, and this one never had been. What
survives is **one** narrow reason: the bound that held is a property of today's frame sizes — 8 MiB,
Chrome 151, this serde version — not of the type, and nothing in the type system keeps it that way.

**A SECOND REASON WAS ARGUED, CALLED LOAD-BEARING, AND THEN FALSIFIED BY MEASUREMENT TOO — the same
defect twice on one branch, caught by the final whole-branch review rather than by the author.** The
design's §0 claimed that no Rust-side measurement reaches the JavaScript consumer, where a deep
nested object "still traps a recursive walk or `JSON.stringify`". Nobody had run that either. Measured
in headless Chrome: **`JSON.stringify` never traps** — clean at 1,000,000 deep, because V8's
implementation is not recursive — and **a naive recursive JS walk survives to ~15,000**, failing only
by 15,031. Against a reachable depth of 1,805 that is an **8x margin** on the one operation that
breaks at all, and no hazard on the one the claim named first.

**The lesson is the one this file has now paid for twice in a single slice:** a hazard claim is
exactly as unestablished as a cost claim until something built to break it has been run, and
replacing a falsified claim with a second unmeasured one is the easiest possible way to repeat the
error while appearing to have corrected it. The measurement cost one browser test.

**THE VERDICT THAT SURVIVES BOTH FALSIFICATIONS IS NOT "THE REASONS WERE WRONG" — IT IS "NEITHER IS
BINDING AT TODAY'S CAPS, AND ONE OF THOSE CAPS IS ALREADY BEING HIT."** Every threshold is now known:

| what breaks | at what depth |
| --- | --- |
| `JSON.stringify` in a consumer | never — clean at 1,000,000 |
| a naive recursive JS walk in a consumer | ~15,000 |
| the Rust `Serialize`/`Drop` pair | **unlocated — known only to be > 2,100**, because the shape was replaced before the boundary was found |
| **`MAX_TERM_DEPTH`, which bounds all of the above** | **3,000** |

**`sum(100)` reaches 3,001. It hits the cap exactly, and it is a hundred-element sum, not adversarial
input.** Depth grows roughly quadratically with input size on that shape, so a modestly larger program
needs a multiple of 3,000 — meaning anyone who wants deeper or larger λ programs must raise that
constant, and the pressure to do so exists now rather than hypothetically.

**That is where this slice earns its place.** Raising `MAX_TERM_DEPTH` under the `Box` shape walks
toward a Rust-side trap depth nobody has located, and far enough puts a consumer's recursive walk into
range of ~15,000. Under the arena there is no such depth on either side, so raising the cap becomes a
question about reduction cost alone instead of one that quietly re-opens a stack question at two
layers. A third property, structural rather than measured: `Box` children cost one heap allocation per
node — 42,623 for `big_list_program()` — against a single `Vec`. **No timing was measured and none is
claimed**; the count is a fact about the shape.

**What the slice is worth, at its true size:** an unbounded recursion removed from a boundary where a
trap cannot unwind, for +227 bytes, no API surface change, and one type. Defensive today, load-bearing
the moment `MAX_TERM_DEPTH` moves.

**A GATE ON PR 3c, not a suggestion.** `lambdaAst` still has no consumer, and the design's §9.3
(delete it outright) was a serious alternative that the final whole-branch review called the cleaner
answer. **PR 3c is the first slice with a real renderer and MUST decide explicitly whether an arena is
the shape that renderer wants.** If it is not, reopen §9.3 and delete the export rather than patching
around it — an unused export that has now had two design slices spent on it is exactly the thing that
accretes by inheritance when nobody is required to choose.

**The number the two entries above got wrong, corrected in place there and restated here.** "Thousands
of nodes deep" conflated node COUNT with DEPTH, and depth is the quantity both recursive paths are
linear in, so the conflation overstated the risk by an order of magnitude. Measured: the 600-element
list's λ term is **8,403 nodes with a depth of 607** at compile time. Under reduction the same program
reaches depth **1,805** natively (**1,803** measured in-browser, the gap being sampling
discretization), and an ordinary recursive `sum(100)` reaches **3,001**, which is `MAX_TERM_DEPTH`
itself.

**What shipped.** `TermNode`'s children became `u32` indices into a flat `TermTree { nodes:
Vec<TermNode>, root: u32 }`, closing both recursive paths — derived `Serialize` and derived `Drop` —
structurally rather than by a depth guard, and adding no new depth constant. `to_tree`'s worklist
threads an arena alongside its existing stack of indices; the `Enter`/`Abs`/`App` marker protocol and
the pop order are untouched, only the element type changed. `root` is stored rather than left implied
by the walk's post-order, so a future change to the walk's ordering cannot silently invalidate it.

**The wire shape, measured in a browser rather than designed** — PR 3b's `Decoded` lesson, applied
before the fact this time: externally tagged, `{"Var":1}`, `{"Abs":["f",85]}`, `{"App":[f,a]}`. A
child index arrives as a JS number, not a `bigint`, which is why arena indices are `u32` and not
`usize` — a `usize` index would put `bigint` in every node of a payload that already carries a `u32`
de Bruijn index on `Var`.

**Two tests, and what each catches.** The structural test cross-checks `tree.nodes.len()` against
`logical_size(&term)`, an independently implemented occurrence count: both **42,623** on
`big_list_program()`, the 200-element list (`let xs = [0..200]; head(xs)`) — not the 600-element list,
whose figures are given above (8,403 nodes, depth 607). The cross-check is what rules out a dedup
regression a content-only comparison would miss. The
depth-tolerance test steps a reduction in chunks, calling `lambdaAst` after each and reading the
arena's own height with a consumer-side iterative walk — not a regression test, since nothing here
found a depth to regress from, but a tripwire for a future change that reintroduces per-level
recursion or lowers the shadow stack. It samples every 100 β-steps and observes depth climbing
monotonically and plateauing — `607, 707, 807, ..., 1707, 1803, 1803` — and asserts the peak exceeds
1,500.

**Three alternatives, rejected.** A depth guard at the boundary would refuse terms that work —
`sum(100)`-shaped programs render correctly today at depth 3,001 — and it never reaches the consumer,
which is now the load-bearing hazard a Rust-side guard cannot touch. A hand-written iterative `Drop`
on `TermNode`, mirroring `lambda/term.rs:482`, imports a tax the codebase already documented:
`term.rs`'s own comment records that keeping a type free of `Drop` is what lets its fields be
destructured by value, and adding `Drop` to a public view-model type consumers are meant to
destructure imports that restriction deliberately — and it would close only one of the two paths
regardless. Deleting `lambdaAst` and
`TermNode` outright was the closest call — there is no v1 consumer, the λ pane is out of PR 3c's
scope, and deleting removes the hazard outright — but was not taken because the capability is wanted
and the cost of keeping it is now one small type change.

**The gate.** `scripts/check-all.sh --no-llvm` green. `wasm-pack build --release --target web`
succeeds at **605,193 bytes**, against PR 3b's 604,966 — **+227**. Browser suite **10/10**; core
`viewmodel_contract` **10/10** default, **11/11** under `--features serde`. The per-file coverage row
for `viewmodel.rs` — the file absorbing every decision here — moves from PR 3b's 98 lines / 100.00%
to **113 lines / 100.00%**: the file gained `emit` and lost three `Box::new` calls, net +15 lines, and
line coverage stayed exactly flat rather than falling, which is the direction this project's
convention treats as the tell. Region coverage did fall, from 98.54% to 96.48% (3 missed of 205 → 8
missed of 227) — stated rather than smoothed over — and the new misses are the `u32::try_from`
overflow branch (§5 of the design: physically unreachable, since 2^32 nodes is on the order of 100 GB)
together with the rewritten `to_tree` match arms, not logic that leaked in from elsewhere.

**Two follow-ups, recorded here rather than left living only in the design spec.** First, the gap
between depth ~2,100 and `MAX_TERM_DEPTH`'s 3,001 was never driven in a browser — it rests on frame
arithmetic (8 MiB across 3,001 frames is ~2.8 KB each), not a run, and closing it is an estimated
10-15 minutes of wall-clock that was deliberately not spent because it is predicted not to change the
verdict (design §11.4). Second, `lambdaAst` still has no v1 consumer — PR 3c is the first slice that
can say whether an arena is the shape a renderer actually wants, and if it is not, deleting `lambdaAst`
and `TermNode` outright (§9.3, close but not taken here) should be reopened rather than patched around
(design §11.1).

#### PLAN 4'S CONSUMER SLICE CLOSES — `web/`, the first thing a human can click, and the five-PR landing order ends (2026-08-07, PR 3c)

Design: [`../specs/2026-08-07-web-app-first-consumer-design.md`](../specs/2026-08-07-web-app-first-consumer-design.md).
Plan: [`2026-08-07-web-app-first-consumer.md`](2026-08-07-web-app-first-consumer.md).

**THE FIVE-PR LANDING ORDER IS COMPLETE, AND THIS WAS THE LAST OF IT.** The wasm32 gate, `viewmodel.rs`,
`crates/redextape-wasm` (3a), the boundary completion (3b), and now the app (3c): `web/`, a pnpm
project (`packageManager: pnpm@11.20.0`) built on Vite and CodeMirror 6 with no framework, wired to the
boundary the four PRs before it built and did nothing but test. Eleven tasks; the ten that build it
landed clean, none carrying a Critical or Important review finding, and this is the eleventh — the
record. It is also the first slice in the project a human can click: one editable source pane with live
syntax highlighting and lint diagnostics, and a results readout that runs the λ and TM legs side by
side.

**THE EIGHTH EXPORT.** The design's own count was seven — a web-only PR, no Rust change — until the
picker was written and found nothing on the boundary named the valid encoding set. Hardcoding
`["unary", "binary"]` in TypeScript would have reintroduced, one language over, exactly the drift
`encoding_kinds!` exists to prevent: nothing in stable Rust compares a written-out list against the
variant set, and a hand-written list in TypeScript is worse, because not even the compiler is watching.
`encodings()` ships instead, generated from `EncodingKind::ALL`'s own rows, so a third encoding appears
in the picker with no TypeScript edit. Cost: **+2,844 bytes** — see the gate below.

**THREE AMBIGUITIES IN §6.3, RESOLVED RATHER THAN INTERPRETED SILENTLY.** §6.3 says "normal form" for
both legs, and the TM leg has no text normal form — its end state is a set of tapes, and rendering
tapes is Plan 5's job. Read literally, §6.3 would have this slice build a tape view it also says is out
of scope; resolved instead as λ shows normal-form text while TM reports **fitted width, δ-step count
and decoded value**, both showing status and reason when they decline. Second, `total_steps` is read
against `tmValue()`, not against `run`: `run` reports where the cursor stands, and nothing in this
slice steps the TM cursor, so `run` reads `"Running"` for a run `compile` already finished at compile
time. `browser.rs` pins the pair directly — `total_steps == 2870` alongside `run == "Running"`
(`crates/redextape-wasm/tests/browser.rs:720-724`) — so `tmValue()`, not the cursor, is what tells a
reader whether 2,870 is a completed length or a count at which a cap was hit. Third, the capped wording
does not name **which** cap: `TmCursor` caps on both the step budget and the live-cell budget, and
`trace.rs` already says no test can tell the two apart, so a message naming a specific cap would be a
guess presented as a fact.

**THE BROWSER TIER PAID FOR ITSELF IMMEDIATELY, and this is the entry's most useful claim.** Two
defects it caught were invisible to every unit test. First, `server.fs.allow: ['..']` does not survive
into Vitest's browser mode — browser mode stands up a nested Vite server and rebuilds the allow-list
against *that* server's root, so the relative entry resolves somewhere useless and the wasm fetch is
refused with "outside of Vite serving allow list," while the identical config serves the same file
correctly under a plain `vite dev`. Fixed with an absolute path. Second, the worker never replied at
all for a λ-refusing program: `drive()` was called unconditionally, but `run_lambda` answers
`Err(SessionError::LambdaAbsent)` when that leg declined, and the wasm binding raises it as a **thrown
exception** — rejecting the async handler, so no reply was ever posted and the caller waited forever. A
declined λ backend is a normal case this UI exists to report; it would have hung the results pane
silently rather than showing a refusal. Fixed by guarding the drive on `lambdaStatus().available`. The
three tests with a healthy λ leg all passed throughout, which is why it hid from anything short of a
program the λ backend actually refuses.

**THREE PLAN PREDICTIONS FALSIFIED BY MEASUREMENT.** The λ-refusing program's TM value is `'10'`, not
the `'0'` the plan predicted — the TM leg reads `n` at call time, not capture time, which is exactly
the ambiguity the λ backend refuses over; the two legs disagreeing there is the point of the program.
That program's decline reason is `LowerError::Unsupported` ("the λ backend does not support unbound
`n`"), not the `StatefulClosure` the plan assumed — this program's mutable capture resolves as an
*unbound name* during lowering, not as a closure over a captured variable, and only the `Unsupported`
branch fires for it. And `@vitest/browser-playwright` is a required dependency the plan never listed,
because Vitest 4 split the Playwright driver out of `@vitest/browser`; `browser.provider` no longer
takes the string `'playwright'`. Now pinned at `4.1.10` to match `vitest` in both version tables.

**THE `lambdaAst` VERDICT IS DEFERRED, NOT ANSWERED.** Nothing in this slice calls it. The roadmap's
PR #15 entry above expected this slice to say whether the arena `TermNode` became is the shape a
renderer actually wants; it cannot, because §6.3's scope has no λ pane — the source pane and the
plain-text results readout are the whole of it, and building a throwaway consumer purely to have an
opinion would not have been evidence about a real one. The question travels to Plan 5 along with the
deletion question the arena design's §9.3 came close to taking: if Plan 5's real renderer finds the
arena is not the shape it wants, §9.3 should be reopened rather than patched around, not treated as
settled by this slice's silence.

**THE GATE.** `scripts/check-all.sh --no-llvm`: green, exit 0 — partial by design, since that flag
skips the LLVM tier. Native test tiers: **825 passed** (3 skipped, workspace default), **700 passed**
(3 skipped, `redextape-core --features serde`), **10 passed** (`redextape-native
--no-default-features`). `wasm-pack test --headless --chrome crates/redextape-wasm`: **12/12** — the
plan predicted 11/11 on an assumed 10-test baseline, but the real pre-existing baseline was 11, not 10;
a stale count in the plan, not a defect. `web`: **48 tests across 8 files** — **38** in the node
project, **10** in the real-Chromium browser project — `biome ci` clean over 20 files, `tsc --noEmit`
clean. `pnpm run build` succeeds: `dist/` holds `redextape_wasm_bg.wasm` 608.03 kB (gzip 215.12 kB),
`index.js` 315.42 kB (gzip 101.91 kB), `index.css` 2.32 kB, `session-worker.js` 7.10 kB. The wasm bundle
itself is **608,037 bytes**, against PR #15's **605,193** — **+2,844**, which is `encodings()` and
nothing else.

**OPEN GAPS, STATED NOT SMOOTHED.** `compile()`'s wall-clock is still unmeasured (design §12 risk 1) —
off the main thread it cannot block input, but a TM-heavy program still delays the results pane by an
unknown amount with only a "running…" state to show for it, and it is now measurable for the first time
because there is finally a UI to measure from. The worker's abandon path has no test — every test sends
one request per worker, so supersession-mid-drive is unexercised; the client-side staleness guard is
tested, the worker-side one is not. A transient two-session window exists during rapid supersession: a
new request's `compile()` can run while an older, still-driving session has not yet reached its
yield-triggered abandon check, so two `Session` handles are briefly live — not a leak, since both are
freed on their own exit paths, and bounded at two in practice because `compile()` blocks the worker and
the old handler cannot wake during it, but worth a look if peak memory during typing bursts ever
matters. And `TokenClass` is hand-copied into TypeScript with nothing checking it against the Rust
enum (design §12 risk 5) — `classify_source` reaches six of `TokenClass`'s fourteen variants today, and
a variant added to `analysis::TokenClass` and not mirrored in the TypeScript copy arrives as an
unstyled span rather than an error; the cheap close is a `tokenClasses()` export shaped like
`encodings()`, deferred to whichever slice first needs it.

**LANDING THIS ARMS THE `docker` JOB.** `ci.yml`'s `docker` job is conditioned on
`github.event_name != 'pull_request'`, not on a tag, so every push to `main` now builds and pushes an
image to `forge.daveynet.xyz`. The plan-4 design's §6.5 records this as intended and confirmed ahead of
time; it is nonetheless the one irreversible effect of this merge, and the one thing about it worth
naming plainly rather than discovering from a CI log after the fact.

#### PLAN 5 SPLITS INTO FIVE, AND 5a-i CLOSES — three panes, a scrubbable history, and two risks its own measurements closed (2026-08-08, PR 5a-i)

Design: [`../specs/2026-08-07-plan5a-panes-and-history-design.md`](../specs/2026-08-07-plan5a-panes-and-history-design.md).
Plan: [`2026-08-07-plan5a-i-panes-and-history.md`](2026-08-07-plan5a-i-panes-and-history.md).

**PLAN 5 WAS NEVER ONE SLICE, AND SAYING SO WAS THE DESIGN'S FIRST JOB.** Surveying the roadmap's Plan
5 bullet — panes, renderers, click-linking, dual-focus highlight, detach-on-edit, per-run caps — split
it into 5a–5e, and one piece is blocked on a problem this project deliberately left open rather than
solved. **5c needs a λ redex→source coordinate system that survives reduction, and none exists.** The
TM half of §6.2's dual focus works today — `TmState.source_node`, resolved through
`SourceMap::tm_owner` — but the λ half shipped once and was removed
(`crates/redextape-core/src/viewmodel.rs:36-55`): `node_to_lambda` records paths root-relative into the
*initial* lowered term, normal-order reduction contracts root redexes, and by step N > 1 the path
indexes a structurally different tree. Measured on `let x = 40; x + 2`, all seven steps reported the
same node, `let x = 40;`, and `x + 2` was never named — the field was removed rather than left `None`
because a value that is sometimes silently wrong tells a consumer nothing is wrong at all. §6.2's dual
focus is therefore half-buildable, and the missing half is research rather than renderer work. 5a is
what was buildable now, and it is what this entry records; 5a-ii — the λ structural tree and the
virtualized state table — is not in it.

**THE DESIGN'S OWN FRAME-SIZE CLAIM WAS FALSIFIED BY THE PROBE WRITTEN TO CHECK IT.** §3.2's first
draft reasoned from `LAMBDA_BYTE_BUDGET = 65,536` that "one λ frame can therefore be 64 KB" — wrong,
because that budget bounds `text` and says nothing about `spans: Vec<(Span, TokenClass)>`, one entry
per token. `examples/frame_cost_probe.rs`, run under a hard memory cap, found the largest frame at the
web's own budget was **781,038 bytes** for `while4` — 12× the claimed figure — and that **spans are
~95% of a frame, at every budget tried.** The fix moved the lever rather than the argument:
**`FRAME_BYTES = 512`, two orders of magnitude below `LAMBDA_BYTE_BUDGET`'s 65,536 and measured
10-31× faster to render and ~22× smaller** — `while4` 59.67→5.77 µs/step, `list60` 230.91→7.40 µs/step,
frame bytes falling by 20-23× alongside. `LAMBDA_BYTE_BUDGET` stays at 65,536 for the one term a user
reads; `FRAME_BYTES` is a separate, much smaller budget for the frames a history keeps.

**`SPAN_BYTES` WAS MEASURED IN THE BROWSER, AND THE ANSWER REVERSED THE SUSPICION.** A review of the
constant's own doc comment found its premise cutting the wrong way: it argued 80 was safely an
over-estimate, but the real JS-object cost it reasoned from would *exceed* the 76-byte JSON figure it
was rounded from — so 80 might **under**-report, the one failure mode the sizer exists to prevent.
Measured rather than argued further: a differential in real Chromium
(`web/tests/browser/frame-cost.test.ts`) that retains full frames against the same frames with `spans`
dropped, alternating A/B/A/B/A/B so a monotonic drift cannot be blamed on whichever ran last, put it at
**~52.8 bytes/span, reproducible within 0.2 bytes across five process runs — 80 was an over-estimate,
not an under-estimate.** V8 interns the fourteen `TokenClass` string literals, which JSON rewrites in
full every time it serializes one, so JSON overstates rather than understates. `SPAN_BYTES` is now
**60**. Getting the reading at all needed `--enable-precise-memory-info` added to the Playwright launch
options: without it `performance.memory` is frozen at a stale sample, verified by allocating and
dropping a 5M-element array over 45 seconds of wall-clock with no change in the reading — Chromium-only,
and no other browser test in this project reads `performance.memory`.

**THE TM LEG'S CONSTRAINT IS STEP COUNT, NOT FRAME COST, WHICH INVERTS AN ASSUMPTION THE RECORDING LOOP
WAS WRITTEN UNDER.** Per-TM-frame cost is negligible — 0.12–0.18 µs/step and ~300–800 bytes/frame,
three orders of magnitude cheaper than the λ leg — but the runs are not: `map_fold` takes **266,863
δ-steps** against **555 β-steps** on the λ leg for the same program, and `list60` takes 2,172,796
δ-steps against 120. At ~410 bytes a frame that is 109 MB and 890 MB of TM history for two rows out of
the demo suite, not adversarial programs written to defeat the design. `RECORD_BUDGET` is therefore
**derived from `HISTORY_BYTES` rather than stated as a step figure** — a single step count would mean
two different things on the two legs, so recording stops when the ring would evict its own first frame,
and "recording stopped, history is full at step N" is what the UI says instead.

**`compile()` IS 0.21–75.44 MS**, closing PR 3c's open risk 1 after two slices unmeasured: `list2`
0.21 ms, `sample` 0.40 ms, `map_fold` 19.48 ms, `list60` 75.44 ms. Fast enough that PR 3c's §10
terminate-on-supersede note stays resolved as rejected — its own condition for reconsidering it was
`compile()` measured long enough that abandoning only at a chunk boundary is too coarse, and 75 ms is
not.

**THE BOUNDARY COST IS 0.063 MS/FRAME**, closing this design's own risk 3 — the one measurement §8
left to a later slice, wondering whether `serde_wasm_bindgen` plus a structured clone per frame would
land the spans-are-95%-of-a-frame result harder in JS objects than in JSON. It did not: measured in
real Chromium (`web/tests/browser/frame-cost.test.ts`, Task 12), a boundary frame is **18,103
bytes/frame** and costs 0.063 ms to cross, consistent with the Rust probe's 4-7 µs/step prediction plus
per-span object-construction overhead. `HISTORY_BYTES` and `RECORD_CHUNK` need no revisiting on this
evidence.

**THE TWO-SESSION WINDOW CLOSED RATHER THAN WIDENED.** The design's §11 risk 4 predicted that keeping
a `Session` alive across messages — needed so `[continue]` has something to resume — would lengthen
PR 3c's transient two-session window from "until the next yield" to "until the next compile completes".
It did the opposite: exactly one `Session` is live at a time and it is freed *before* the next compile
runs, which makes the window PR 3c's review flagged **strictly zero rather than merely bounded**
(`session-worker.ts`'s module doc).

**THE NINTH EXPORT, `tapeNames()`.** Five unlabeled tape rows are unreadable, and hand-coding
`["REG","WORK","STACK","HEAP","BOX"]` in TypeScript would reintroduce, one language over, exactly the
drift `encodings()` was exported to prevent. `tapeNames()` returns `build.rs`'s own constants instead —
and states its limit rather than hiding it: those names describe machines *this compiler* produced.
`parse_tm` accepts a hand-written machine declaring any tape count up to `MAX_TAPES = 64`, and 5d will
introduce exactly such machines, so a consumer must label tape *i* with `names[i]` when one exists and
`tape i` otherwise — the export's doc says so rather than implying five names describe every machine.

**WHAT THE REVIEWS ACTUALLY CAUGHT IS THIS SLICE'S MOST USEFUL CLAIM.** Nearly every Important finding
across thirteen tasks was a defect in the **plan**, not the implementation — Task 2's own example test
declared four shapes and asserted none of them; Task 4's plan shipped a `back()` that failed its own
"clamps back at the oldest" test; Tasks 5/6/9 inherited three tests, verbatim from their briefs, that
let a real mutant live. **Mutation testing repeatedly killed tests that looked adequate, including,
twice, a replacement test written specifically to close an earlier gap:** Task 4's eviction test
asserted the opposite branch from its name and let two trivial mutants survive; the *reviewer's own
suggested replacement* also failed to kill one of them, because its chosen frame count made the correct
decrement coincide with the mutant's forced value, and only a second rewrite — 4 frames, `seek(2)` —
landed a decrement the mutant could be told apart from. **And the `▶`-at-frontier path turned out to be
dead code:** `canForward` was `head < length - 1`, false exactly when the head sits at the frontier, so
`pane-chrome.ts` rendered `▶` disabled at precisely the moment `main.ts`'s extend branch would have
fired — the design says `▶` and `[continue]` are the same operation with different labels, and only
`[continue]` worked until this was found and `▶` made live.

**THE GATE.** `pnpm test`: **114** (node 81, browser 33). `wasm-pack test --headless --chrome
crates/redextape-wasm`: **13/13**. `pkg/redextape_wasm_bg.wasm`: **608,481 bytes**, against PR #16's
**608,037** — **+444**, which is `tapeNames()` and nothing else. `scripts/check-all.sh --no-llvm`
green, `pre-commit run --all-files` green, `pnpm run build` succeeds.

**WHAT 5a-ii STILL OWES.** The `lambdaAst` verdict PR #15 asked for and PR 3c could not supply — this
slice built the text pane, not the tree, so whether the arena `TermNode` became is the shape a renderer
wants is still open. And the virtualized state table: `crates/redextape-core/tests/fixtures/list_1_2.tm`
is 146 states and 464 lines for the two-element list literal `[1, 2]`, unvirtualized that is thousands
of DOM nodes rebuilt every step, and `virtual-list.ts` — fixed row height, offset arithmetic, no
library — has not been written yet.

#### PLAN 5a-ii CLOSES — the λ tree is cut, the state table ships, and a corpus chosen to be representative could not falsify either bound (2026-08-08, PR 5a-ii)

Design: [`../specs/2026-08-08-plan5a-ii-state-table-design.md`](../specs/2026-08-08-plan5a-ii-state-table-design.md).
Plan: [`2026-08-08-plan5a-ii-state-table.md`](2026-08-08-plan5a-ii-state-table.md).

**THE λ TREE IS CUT.** `lambdaAst` as a per-frame or per-step export costs **850 MB against a 32 MB
ring** at `LAMBDA_TREE_NODES = 65,536` — 731.65 µs/step against the text frame's 5.77 µs at
`FRAME_BYTES = 512`, 127× the per-step cost of the thing already being recorded — and a frontier-only
tree, built for the newest step alone, does not rescue it: **84.0% of steps refuse to build one at all
at 65,536 nodes, and still 70.8% refuse at 524,288.** The two levers that could fix this move against
each other instead: raising the budget cuts refusals but raises per-step cost superlinearly (15.71 →
102.18 → 731.65 → 4,941.62 µs/step across 1,024 → 8,192 → 65,536 → 524,288 nodes) while the trees that
do build reach hundreds of thousands of nodes, not a thing a person reads. The reason the fix that saved
5a-i's `FRAME_BYTES` — a much smaller budget for history than for the readout — does not transfer here
is the transferable lesson: **text truncates, trees refuse.** `print_lambda_capped` short-circuits to a
visibly-truncated string at any budget; `LambdaState::ast` returns `None` rather than a partial tree, on
the deliberate and unquestioned ground that a truncated AST is a lie about the term's shape. A small
budget therefore buys the text pane speed and memory together, and buys the tree pane only *absence* —
`FRAME_BYTES`' lever does not exist for a node budget.

**THE ARENA'S §9.3 DELETION QUESTION REOPENS**, on narrow grounds the design is careful to isolate:
`TermTree` is a fine shape — flat, index-addressed, non-recursive on every derived path, exactly what it
was built for — **with no consumer, not a wrong one.** What fails is `lambdaAst` as an export, on cost
and availability that an arena-vs-boxed-tree choice would not change; a `Box`-based tree at the same node
counts would be worse on both axes, plus the sharing trap the arena exists to avoid.

**THE `[1, 2]` FIXTURE WAS 0.4% OF THE REAL SCALE.** The panes-and-history design sized the state table
from one number, `list_1_2.tm`'s 455 rows — the smallest program in the corpus but one. Measured across
all ten, `list60` is **127,881 rows, 281× the fixture.** 127,881 row objects would be 12–25 MB of
main-thread duplication for a list of which ~40 are ever on screen, and **the row array became a row
index because of it**: one prefix-sum `Int32Array`, 135 KB for `list60` rather than 127,881 objects, row
identity resolved by binary search rather than lookup.

**§2.1'S LESSON LANDED TWICE IN ONE DAY, ON TWO DIFFERENT QUANTITIES.** A corpus chosen to be
representative could not falsify either bound, because both bounds looked affordable to a corpus built to
attack a *different* quantity: the nine-program suite runs a few hundred β-steps at most, so it never
stressed a per-frame tree, which is bounded by frame size × step count; and its smallest-but-one program
was quoted as the state table's scale for the same reason — nobody had asked the corpus for its largest.
**Both fell to the first program written to attack the bound that actually existed** — `while40`,
`while4` with `n = 40` for `n = 4`, an ordinary counting loop rather than an adversarial one, for the
tree; and, for the table, no new program at all, just the states/rules columns the probe already carried,
extended to count rows and read off against `list60`.

**THE BROWSER TIER HAD NEVER LOADED THE APP'S STYLESHEET.** `index.html` is the only reference to
`style.css` in the project, and Vitest's browser mode serves its own tester HTML, so every browser test
since the tier existed — back through 5a-i — ran against a completely unstyled DOM. Cosmetic for every
earlier pane; not for this one, where `max-height: 40vh` is the **only** thing bounding the scroll
container. Without it the box laid out at its full content height — **measured at 271,968px for 11,332
rows** — so every `#drawTable()` rendered every row and the first test to exercise the table at scale
timed out. Fixed at the tier where it happened (`tests/browser/setup.ts`), not papered over with a
TypeScript-side clamp: an untested defence encoding a CSS rule in TypeScript would silently mis-render
the day the rule changed, and the browser tier now asserts the container is bounded, so the gap fails a
test rather than turning every other assertion into a test of a fallback.

**EVERY TASK FOUND A DEFECT IN THE PLAN, AND ESSENTIALLY NONE IN THE IMPLEMENTATIONS** — 5a-i's finding
repeats, harder. The pre-flight scan alone found four before any code was written: two CSS custom
properties that do not exist (`--mono`, `--accent-soft`), a `flex: 1 1 auto` on a table whose parent is
not a flex column — so it would have laid out at its full 3,069,144px — and three test helpers named in
a brief that `app.test.ts` does not have. Then: a reference implementation that failed its own test
(`first` clamped at the bottom and not the top, giving `firstIndex: 416` on a 20-row list), a wrong
expected value beside it, a stale test-count baseline, an unkillable mutant, two defects in a class
whose entire purpose was preventing that class, a `setProgram` that would have detached the table on
every compile, and three browser assertions that would have passed for the wrong reason. Each is a
commit on this branch. Two are worth carrying on their own. **A mutant that was mathematically
unkillable:** a task brief specified `i <= start` as a mutation its tests must kill, but the index's
binary search guarantees `start <= i` as an unconditional precondition at that comparison, which makes
`i <= start` logically identical to `i === start` — no reachable input tells the two branches apart,
traced by hand before the empirical run confirmed zero failures. **And a browser assertion that was a
tautology, comparing a variable against itself:** a brief captured a parked scroll position *after*
dispatching the scroll event that would trigger a re-centre, against a step click that never awaited its
own async worker round trip — so nothing wrote to the value being compared, between the capture and the
assertion, at all. The comparison passed on a broken-detach mutant regardless of whether detaching
worked.

**AND THE WHOLE-BRANCH REVIEW FOUND A DESIGN REQUIREMENT THAT NO TASK HAD CARRIED.** §3.7 and §4 of this
slice's design both mandate a control that reattaches the table after a manual scroll detaches it. The
implementation plan carried it into none of its eight tasks, and the plan's own self-review nevertheless
claimed *"§3.7 (follow) → Task 5"*. What shipped up to that point had `Follow.attach()` with exactly one
caller — the compile path — so **one scroll detached the table for the rest of the run**, the current row
not merely scrolled out of view but absent from the DOM, recoverable only by editing the source and
throwing away the history you were watching. A node test named `it('reattaches on demand')` passed the
whole time, against an API path no UI could reach. **A green test for a method nobody calls is the
shape a missing feature takes when the plan's checklist is the thing being checked.**

**TWO ABSENT TESTS ARE WHY IT SURVIVED, AND BOTH FAILED THE SAME WAY: THEY ASSERTED ONLY THE NEGATIVE.**
Disabling the follow-scroll write outright — deleting the feature from the app — left the suite green,
because the one test covering following asserted that a *detached* table does not move, which a table
that never moves satisfies perfectly. And `ROW_HEIGHT` against `.state-row`'s CSS height went unguarded
exactly as the CSS comment beside it predicted: 24 against 31 also passed, because the browser test
computed its expected row count *from the same constant*, so the mismatch cancelled itself out. **A test
that derives its expectation from the value under test cannot fail.**

**THE RE-REVIEW THEN FOUND A DETACH WITH NO USER GESTURE IN IT AT ALL.** `#drawTable` writes `scrollTop`
and the browser delivers that write's `scroll` event at the next rendering update rather than
synchronously — so hiding the table in between lands the echo on a `display: none` box, where
`scrollTop` reads back 0, further from the expected position than any tolerance can absorb. Step, hide
δ, show δ, and the table silently follows nothing. It had hidden behind two green toggle tests because
both use `let x = 40; x + 2`, whose follow target is ~122px: the restored offset happens to show the
current row anyway, so the detach was invisible to the assertion. **THE FIRST TEST WRITTEN FOR IT PASSED
WITHOUT THE FIX** — it stepped, hid, and awaited two animation frames, but whether an echo is in flight
at the instant of the hide depends on whether that step moved the follow target, which depends on the
program. Rewritten to dispatch the event where the mechanism needs it rather than hoping the timing
lines up; removing the guard now fails it and nothing else. That makes three times in two slices that a
test written specifically to close a gap did not close it, and each was caught only by running the
mutation rather than by reading the test.

**THE GATE.** `pnpm test`: **189** (node 140, browser 49). `wasm-pack test --headless --chrome
crates/redextape-wasm`: **13/13**. `scripts/check-all.sh --no-llvm` green, reporting **PARTIAL** by
design — the LLVM tier is skipped and the script says so rather than passing quietly. `pre-commit run
--all-files` green.

#### PLAN 5b CLOSES — three panes linked in three directions, and the demo program was too small to show the bug (2026-08-09, PR 5b)

Design: [`../specs/2026-08-08-plan5b-click-linking-design.md`](../specs/2026-08-08-plan5b-click-linking-design.md).
Plan: [`2026-08-08-plan5b-click-linking.md`](2026-08-08-plan5b-click-linking.md).

§6.2 part 1 ships, in all three directions rather than the one it asks for: click a source construct and
its λ subterm and TM state block light up; click a δ-table row or a λ token and the source construct
lights up. `node_to_tm`, shipped 2026-07-30 and consumed by nothing but its own coverage tests since,
gets its first real consumer.

**THE ESTIMATE WAS WRONG IN ONE DIRECTION AND RIGHT IN TWO.** 5a's decomposition priced 5b as *"yes,
small"*. The source and TM legs were: invert `node_to_source`, read `tm_owner`. The λ leg was not, and
`viewmodel.rs`'s no-`redex` doc had already priced it — *"a redex is a `Path` INTO THE TERM, while
highlighting it in `text` needs a byte SPAN, and correlating the two means the printer recording where a
given path lands as it walks"*. That is `print_lambda_linked`, and the walker had to become a struct to
get it: the four functions already carried seven arguments each, recording needs two more, and
`too_many_arguments` denies at eight.

**THE STEP-0 SCOPE IS WHAT MADE THE λ LEG AFFORDABLE AT ALL.** Paths are root-relative into the initial
lowered term and reduction rewrites that tree, so the link is defined at step 0 and honestly absent
after. That is not a limitation smuggled in; it is the boundary between 5b and 5c, and drawing it
explicitly is what let a λ link ship. It also collapses the cost: the index is built once per COMPILE,
not per step, which is why this does not repeat `lambdaAst`'s 850 MB against a 32 MB ring.

**`tm_owner` CANNOT BE `node_to_tm` FLATTENED, and the app's own sample proves it.** `build_from_program`
lowers at `MIN_FIELD_WIDTH` to record ownership; `run_tm_described` re-lowers with its own auto-fitted
width. Those `StateId`s index different machines. The review supplied the mechanism the design had only
asserted: `MIN_FIELD_WIDTH = 4` holds a maximum of 15, and `let x = 40; x + 2` computes 42, so the
auto-fit is *forced* wider — which changes the bit-iteration structure of a digit-serial TM and so the
state graph, while `lower_tm` still derives the same NAMES. Flattening would have been visibly wrong on
the default program. Caught while writing the plan, before any code existed.

**THE DEMO PROGRAM WAS TOO SMALL TO SHOW THE WORST BUG, AND SO WAS EVERY TEST.** `lambdaWindow` sliced
UTF-8 byte offsets as UTF-16 string indices. `λ` is 2 bytes and 1 unit, so a clipped window's text was
displaced right by the number of binders before its start while the spans stayed in byte space.
Measured in real Chromium on `map_fold`: **75 of 257 source offsets produce a head-clipped window, 21 of
those lit zero tokens, and the rest rendered mangled text.** It also fed `data-at`, so **λ→source clicks
resolved to the wrong node whenever the head was clipped** — one of the three advertised directions was
wrong. Three things hid it:

1. **the function's own doc asserted the opposite** — *"does no slicing of its own that could split a
   character"* — which is how it passed a task review that was reading the doc against the code;
2. **`sample` is 238 bytes of λ text against a 240-byte context**, so it never clips. Every earlier
   check passed for that reason, *including the eye check in a real browser*;
3. **every fixture in `lambda-window.test.ts` was pure ASCII**, so byte and UTF-16 offsets coincided and
   the axis was untested — on the one function of this slice whose input is GUARANTEED to contain `λ`.
   `highlight.test.ts`'s new case deliberately uses `λf. λx. f x` and says so; this one did not.

**FOURTEEN OF THE FIFTEEN OTHER DEFECTS WERE TESTS THAT PROVED NOTHING, NOT IMPLEMENTATIONS THAT WERE
WRONG.** The pattern 5a-i and 5a-ii each recorded held for a third slice and is now the most reliable
prediction available about where this project's defects live. A partial list, all caught before merge:
a truncation test that would have passed against "never record a span" (its budget was smaller than the
term's first binder prefix, so `hit` fired before any recursion and the assertion reduced to
`0 < want.len()`); a variant test blind to a transposition of two middle enum variants — **and its
proposed fix, comparing the name list against an array literal, would have been blind to the same thing,
because neither operand evaluates a discriminant**; a documented tie-break rule with no test at all; a
boundary test covering 3 of 10 array columns; and, on the feature's PRIMARY direction, **no test that a
source click lights either of the two panes it is supposed to light** — the two tests believed to cover
it checked only the source echo, and the one other `is-linked` reference filters those tokens out
without asserting any exist.

**THE ORACLE FOR SPAN FIDELITY WAS WRONG THREE TIMES, EACH SURFACING ONLY WHEN THE LAST WAS FIXED**, and
all three are one mistake: assuming printing is context-free when it is context-dependent in three
separate ways. Free identifiers never reach the printer, because `parse_atom` rejects them. `Var(i)`
resolves against the binders ambient WHERE IT IS PRINTED, so the body of `\x. x` is `x` in context and
`?0` extracted. And a subterm's ROLE decides its parentheses while an extracted reprint always prints at
`Term`. What survives is a reprint oracle restricted to closed subterms with the role's parens
*predicted* rather than tolerated, plus arm-ordering — which needs no reprinting and is the one that
actually catches a swapped push.

**TWO DESIGN GAPS, NOT CODE BUGS.** §6 case 4 says an edit clears all three panes; the implementation
cleared the source pane only, leaving the λ window and δ rows painted for the whole debounce while the
status line said linking had stopped. And §4.3 specified `origin`-driven scrolling without saying which
authority wins when the table is already following the machine — so `setLink` wrote `scrollTop` and
`#drawTable` overwrote it in the same synchronous block, and the block landed off-screen in the default
state. §5.1 now states the rule: a link scroll is a direct gesture and wins for exactly one draw;
following is not disturbed, because the user asked to see a construct once, not to stop watching the run.

**MEASURED, AND RE-RUNNABLE.** `link_index_probe.rs` reproduces the design's §2 tables — λ-path coverage
is 100% on every program, TM coverage 50–82%, `list60`'s step-0 term 9,851 bytes, the columnar index
~220 KB against ~552 KB naive. Two of its columns had to be corrected first, and both were
*definitional*: a column counting STATES with an owner is not §2.2's share of source-mapped NODES with a
TM block, and serialising `LinkIndex` cannot reproduce the naive figure because its `tm_owner` is
already the dense array the decision introduced. **A probe measuring an adjacent quantity is worse than
no probe: it reads as corroboration.**

**RETIRED HERE:** §11.6's `TokenClass` hand-copy drift, deferred by 5a-i and again by 5a-ii, closes as a
class rather than a third instance — `tokenClasses()` plus a startup assertion. And `settled()`'s false
invariant, which the previous slice declined to touch at the end of a 30-commit branch, was fixed as
task 1 of this one: the generation is claimed at dispatch rather than 300 ms later, so a stale reply
cannot resolve a wait against the previous program.

**HANDED ON.** 5c still needs a λ redex→source coordinate system that survives reduction and nothing
here builds one — but it inherits `print_lambda_linked`, which is the *other* half: given a coordinate
system, turning it into a highlight is solved. 5d inherits a source pane that already distinguishes a
linking click from a caret placement.

**ONE PROCESS FINDING, SHARPER THAN 5a-ii'S AND WORTH KEEPING.** That slice recorded that parallel
agents need disjoint *toolchains* rather than merely disjoint files, because `vitest`'s `-- <name>` does
not scope which files run. The sharper rule this slice found: **they need disjoint COMPILE UNITS.** Two
agents editing different files in the same Rust crate both run `cargo test -p <crate>`, and a transient
compile error in one agent's file fails the other's test run for reasons it cannot diagnose — so it
burns turns debugging a break it did not cause. In practice that left exactly three safe pairings across
twelve tasks: a web task beside a Rust task, `redextape-core`'s examples beside `redextape-wasm` (different
packages, therefore different compile units), and any review beside any implementation. Everything else
serialised, and five of the twelve tasks serialised on `main.ts` alone.

Two smaller ones with the same shape. `web/package.json` drives **pnpm**, and `test:node` /
`test:browser` are `vitest run --project <name>` — which scopes by project even though it cannot scope
by file, and is what keeps a node-tier agent off the slow browser tier. And the commit gate runs
`biome ci --error-on-warnings`, so a task that deliberately leaves a binding unused for its successor to
consume **cannot commit alone**; that is what collapsed tasks 8 and 9 into one commit, which is the
project's existing convention for a split the gate makes infeasible.

##### What 5b left open — three items, after seven of the whole-branch review's nine Minors were fixed

Recorded here rather than in `.superpowers/sdd/progress.md`, which `git clean -fdx` destroys: a finding
that survives only in scratch is a finding nobody will ever act on. **Everything not listed below was
fixed before merge** — `indexToByte`'s doc narrowed to its real contract with the surrogate behaviour
pinned by a test; length-1 and empty-text window cases; `lambdaLinkState`'s `declined` branch end to
end; `LinkIndex`'s mixed-presence cases; `protocol.ts`'s and `session-client.ts`'s docs corrected
without weakening either guard; the missing `assert_eq!` message.

1. **`client.extend()` silently no-ops for the whole debounce.** `supersede()` advances `#gen` at
   dispatch, but the worker's `onExtend` drops any request for a generation it has never seen — so for
   ≥300 ms after any keystroke or encoding change, `▶`-at-the-frontier and `[continue]` do nothing.
   **The click is correctly inert**: the run it would extend is about to be discarded by the imminent
   compile. The defect is the *silence*, which makes the fix a control-visibility rule rather than a
   messaging change — and the deferred-accessibility list above already owns that principle (*"a
   control that provably cannot work should not be offered"*). It belongs with that pass; a second
   mechanism here would be worse than the gap. Introduced by 5b's task 1, untested and undocumented
   until now.
2. **The λ pane still double-renders when a link is active.** The per-frame case was fixed — a guard
   skips `renderLink`'s redraw when neither the old nor the new value exists, which is the playback
   path. What survives is `draw()`'s `render()` then `renderLink(win)` when a link IS set, each running
   `#redraw()` in full. That happens at step 0 on a click rather than per frame, so it is out of the hot
   path, and removing it means merging the two into one `update(frame, controls, win)` — an API change
   for waste nobody has measured. **That measurement is the prerequisite, not the refactor.**
3. **`lambdaLinkState`'s `truncated` branch has no end-to-end test, and cannot get one today.** It needs
   a λ term over `LAMBDA_BYTE_BUDGET` (65,536 bytes), which needs an integer literal past ~2,690 — and
   that crashes the wasm module outright, per the entry above. Not deferred by choice. Whoever fixes
   `MAX_TERM_DEPTH` unblocks this test as a side effect.
