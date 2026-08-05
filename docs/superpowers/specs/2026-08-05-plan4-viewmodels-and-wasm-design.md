# Plan 4's consumer slice — view models, the WASM boundary, and the first real consumer

**Status: designed, not built.** Companion to the roadmap's Plan 4 entry
([`../plans/2026-07-19-redextape-roadmap.md`](../plans/2026-07-19-redextape-roadmap.md)) and to the
producer slice's design
([`2026-07-30-plan4-sourcemap-trace-and-tokens-design.md`](2026-07-30-plan4-sourcemap-trace-and-tokens-design.md)),
whose "Still open — the consumer slice: `viewmodel.rs`, `crates/redextape-wasm`, serde" is what this
document specifies.

## 0. Why this slice, and why now

`README.md` states the gap: *"The compiler is built; the thing you watch it in is not."* Three
deferrals are parked behind this one and none can be settled without it.

1. **The mimalloc re-measurement** is explicitly *DEFERRED UNTIL WASM* — the roadmap's reasoning is
   that with no `[[bin]]` in the workspace and no `web/`, "which allocator is the REFERENCE
   ENVIRONMENT is undecided", and re-measuring first would "answer a question by default that should
   be answered by decision."
2. **Plan 4 deferral #2** (`NodeId → source Span`) was told to be decided "in Plan 5, where the
   renderer defines what it actually needs."
3. The CI `web` and `docker` jobs auto-activate on `web/package.json` and have never run.

## 1. Decisions taken

Each was decided during brainstorming; alternatives considered are recorded in §9 rather than
discarded.

| # | decision |
| --- | --- |
| 1 | Ship a **real consumer**, not a headless package: `viewmodel.rs` + `crates/redextape-wasm` + a `web/` app with one editable CodeMirror pane. |
| 2 | `LambdaState` carries **printed text by default**, with the structured AST behind an opt-in call. |
| 3 | The TM machine serializes **once per compile**; per-step state carries a **bounded window** around each head, not whole tapes. |
| 4 | "Continue past the cap" is **`raise_cap` in place** on both cursors. |
| 5 | `desugar_mapped` lands now; `SourceMap` grows a **third leg**, `node_to_source`. |
| 6 | The allocator reference environment is **named here and the re-measurement stays deferred**. |
| 7 | `redextape-core`'s zero-dependency rule is **replaced by a wasm32 build gate** (§2); the historical plan docs restating it are annotated by the roadmap, not rewritten. |
| 8 | `viewmodel.rs` lives **in core**, behind an optional, default-off `serde` feature. |
| 9 | The web app is **Vite + TypeScript + CodeMirror 6**, on **pnpm**. |

## 2. The dependency rule becomes a gate

### 2.1 What is true today

`redextape-core`'s `[dependencies]` is empty, and eight plan documents restate the rule. The
manifest carries the measured claim: `cargo check --target wasm32-unknown-unknown -p redextape-core`
(lib only) passes, and an empty `[dependencies]` is what delivers it.

**Nothing in CI checks it.** `rustup target add wasm32-unknown-unknown` appears in `ci.yml` exactly
once, inside the `web` job — which is gated off until `web/package.json` lands. `check-all.sh` does
not mention wasm at all. The invariant is currently enforced by a manifest comment and reviewer
attention.

### 2.2 The rule is stronger than the property it protects

Empty `[dependencies]` is *sufficient* for WASM-clean, not *necessary*. Three things break a wasm32
build — C code, syscalls wasm lacks, and `getrandom` without its `js` feature — and a dependency
only breaks it if it has one. `serde` compiles to wasm32; so does every proc-macro crate, which runs
on the host at build time.

The encoding-registry entry shows the rule being applied past its own justification: `strum` was
rejected because *"a derive macro is still a dependency edge"*, and a derive macro cannot break a
wasm32 build.

The rule was right anyway, for a reason that is not about wasm: **"is `[dependencies]` empty?" is
checkable in one line, forever, and "does the whole transitive closure build for wasm32 under every
future version resolution?" is an audit nobody keeps running.** The failure mode is a minor bump
three levels down adding `getrandom`, discovered when the browser build breaks.

### 2.3 The replacement

Add to `check-all.sh` and to the two CI jobs that reach a base-tier leg — `rust` and `rust-scoped`:

```sh
cargo check --target wasm32-unknown-unknown -p redextape-core --lib
```

This checks the real property at the PR that would break it, in seconds. With it in place the rule
relaxes to **"dependencies are allowed; the gate decides."**

**What gets edited, and what deliberately does not.** `redextape-core`'s `Cargo.toml` comment is live
configuration and is rewritten. The roadmap gains an entry recording the change and its reasoning.
**Eight plan documents restate the rule for `redextape-core` (the roadmap is excluded — this change
is recorded there), and they are left alone** — they are records of what
was true when they were written, and this repo annotates rather than rewrites (the roadmap's own
"ANNOTATION, not a rewrite" entry is the precedent, as is `README.md` keeping four dead λ designs on
purpose). A reader who lands in
[`2026-07-29-encoding-registry-and-generator-dedup.md`](../plans/2026-07-29-encoding-registry-and-generator-dedup.md)'s
"MUST STAY EMPTY" and follows it will be doing something harmless and slightly out of date, which is
strictly better than a history quietly edited to agree with the present.

**Scope of the claim, stated because the manifest already states it honestly:** the gate covers
`--lib`, not `--all-targets`. The dev graph is not WASM-clean and would not be short of dropping
`proptest`; that was true before `mimalloc` existed. `--lib` is what a consumer builds, which is the
claim that matters.

**The one-line proof survives as a bonus.** `serde` enters core as an *optional* dependency, default
off, so `cargo tree -p redextape-core --edges normal` with default features still lists only itself.
That is no longer the guarantee — the gate is — but it costs nothing to keep true.

## 3. Core changes

Five, each small and independently landable.

### 3.1 `desugar_mapped`

`desugar(&Program) -> Core` becomes joined by `desugar_mapped(&Program) -> (Core, Vec<(NodeId, Span)>)`,
the same `_mapped` shape used four times on the producer slice.

**Priced, not estimated:** `desugar.rs` has **21 `g.fresh()` sites**, and every `ast` node already
carries a `Span` (`Program`, `Block`, every `Stmt` variant, every `Expr` variant). The change threads
the enclosing span to each site.

**Synthesized nodes inherit the nearest enclosing expression's span.** Desugaring mints ids that
correspond to no source text — the `Core::Unit` for a tail-less block, the scaffolding inside a
`LetRecGroup`. Attributing them to the construct that caused them is what a highlighter wants; the
alternative, `None`, would leave holes in the source pane exactly where the interesting lowering
happened.

### 3.2 `SourceMap`'s third leg

```rust
pub struct SourceMap {
    node_to_lambda: ..,
    node_to_tm:     ..,
    node_to_source: ..,   // NEW
}
pub fn source_span(&self, id: NodeId) -> Option<Span>
```

This fills the gap Plan 4 deferral #2 identified in the **design**, not in the code: §5.4 asks for
exactly two maps and never specifies a source one, which surfaces only when a renderer asks how to
light the source pane.

**It is needed now because the view models hand out `NodeId`s.** `TmState.source_node` is unusable to a
renderer without it — the field would ship dead — and PR 3's click-linking needs the same leg regardless
of what `LambdaState` does with its own.

**Corrected in PR 2 — this sentence originally named `LambdaState.source_node` too, and that field no
longer exists.** It shipped briefly, then was removed: `node_to_lambda`'s paths are root-relative into
the INITIAL lowered term, while normal-order reduction contracts root redexes, so a `Beta` event's redex
path is only a coordinate into that term on the first step — correct once, then confidently wrong for
every step after (§4.2 below has the full argument). That removal is unrelated to this leg's own
justification, which does not weaken: `TmState.source_node` and PR 3's click-linking are reason enough
for `node_to_source` on their own.

### 3.3 `raise_cap` on both cursors

§6.4 asks for `still running — hit 50k steps` with a "continue" affordance. **Neither cursor can
resume today.** `LambdaCursor` latches `status = Some(HitCap)` and its `next` returns `None`
thereafter; `TmCursor::new` sets `cur: m.start` unconditionally, so a reconstructed TM cursor
restarts rather than continues.

```rust
impl LambdaCursor      { pub fn raise_cap(&mut self, extra_steps: u64); }
impl<M: Borrow<Machine>> TmCursor<M> { pub fn raise_cap(&mut self, extra_steps: u64, extra_cells: u64); }
```

**The arguments are additive, not absolute** — `self.cap = self.cap.saturating_add(extra)`. Absolute
would let a caller *lower* a cap mid-run, which has no meaning for a run already past that many
steps, and saturating removes the only overflow path.

**It clears `HitCap` and nothing else.** `Normalized`, `Halted` and `Rejected` are terminal facts
about the computation, not budget outcomes, and a finished run must not be resurrectable. This is the
distinction the `TmRun` doc comments already draw between `HitCap` and `TooLarge`/`Overflow`, applied
one layer out.

### 3.4 `TmCursor` becomes generic over machine ownership

A stepping session must hold the `Machine` **and** a live cursor over it. `TmCursor<'m>` borrows the
machine, which makes that struct self-referential — normally solved with `unsafe` or a crate this
project would not take.

```rust
pub struct TmCursor<M> { machine: M, tapes: Vec<Tape>, cur: StateId, steps: u64, .. }
impl<M: Borrow<Machine>> TmCursor<M> {
    pub fn new(m: M, init: &[Vec<Symbol>], caps: TmCaps) -> TmCursor<M>
}
```

The lifetime disappears; ownership is a type parameter. Existing callers infer `TmCursor<&Machine>`
and do not change. **Six call sites were checked**: `sim::run`, two in `tests/trace_equivalence.rs`,
three in `examples/concurrency_probe.rs`. Only one annotation moves — `trace_equivalence.rs`'s
`deltas` helper, which names `TmCursor<'m>` explicitly and becomes `TmCursor<&'m Machine>`.

The session then holds `Rc<Machine>` and `TmCursor<Rc<Machine>>`: two owners, no self-reference, no
`unsafe`.

### 3.5 A budget-aware λ printer

**The budget must be enforced *inside* the printer, not applied to its result.** Truncating the
`String` that `print_lambda_mapped` returns is useless: the unbounded allocation has already
happened by then, which is the entire failure being guarded against.

```rust
// lambda/syntax.rs
pub fn print_lambda_capped(t: &LambdaTerm, byte_budget: usize) -> (String, Classified, bool)
```

`write_term` gains an early return once `out.len() >= byte_budget`, and the third return value is
whether it fired. `print_lambda` and `print_lambda_mapped` are unchanged and keep their current
signatures — they are what every existing golden, round-trip and foreign-reader test calls, and this
slice moves no printed byte.

The budget is checked between pushes, so the produced string may overshoot by at most one token.
That is stated rather than tightened: an exact byte count would mean splitting a token, and a
half-written `λ` is not valid UTF-8 to begin with.

### 3.6 Two `cfg_attr` lines

The view models embed almost nothing that needs a `Serialize` impl, because the ids are aliases:
`NodeId = u32`, `StateId = u32`, `Symbol = char`. Only `Span` (a two-`usize` struct) and
`TokenClass` (a plain enum) are real types, and `Machine`/`State`/`Rule` are untouched because
`TmProgram` is a projection rather than a re-export.

```rust
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
```

on `Span` and `TokenClass`. That is the entire footprint outside the new module.

## 4. `viewmodel.rs`

### 4.1 Placement, and why it is core rather than the WASM crate

§9.1 names view models as core outputs, and the reason to honor that is **a second consumer**. Plan
6's `redextape-cli` wants them for a `run --trace` or a JSON dump, and the terminal-visualization
extension track wants them too. Neither can sanely depend on `redextape-wasm`, which is a `cdylib`.
This is the same reasoning the roadmap applies to the trivia decision: *"That decision now has a
second consumer, so do it once."*

Putting them in the WASM crate would have the CLI reimplementing the projections, and the two copies
would drift — the failure this repo has already recorded three times (the third direct-then-defunc
match, `core_of` defined four times, the inverted `_mapped` suffix).

### 4.2 Types

```rust
pub struct LambdaState {
    pub text: String,
    pub spans: Vec<(Span, TokenClass)>,
    pub truncated: bool,
    pub step: u64,
    // `source_node: Option<NodeId>` removed in PR 2 — see the note below. `redex: Option<Span>` had
    // already been dropped before that, for the reason §4.3 records.
}

pub struct TmProgram {          // once per compile
    pub states: Vec<StateView>, // name, accept, rules
    pub alphabet: Vec<Symbol>,
    pub tapes: usize,
    pub width: usize,
}

pub struct TmState {            // per step — O(window), not O(tape)
    pub state: StateId,
    pub step: u64,
    pub heads: Vec<usize>,        // corrected in PR 2 — see the note below
    pub window_start: Vec<usize>, // added in PR 2 — see the note below
    pub window: Vec<Vec<Symbol>>,
    pub source_node: Option<NodeId>,
}

pub enum TermNode { Var(u32), Abs(String, Box<TermNode>), App(Box<TermNode>, Box<TermNode>) }
```

**`source_node` was removed from `LambdaState` in PR 2 — corrected here, not silently edited.** It
shipped for one PR, computed by an `owning_node` helper from a caller-supplied redex `Path`. It was
right for exactly the first β-event and confidently wrong for every one after: `node_to_lambda`'s paths
are root-relative into the INITIAL lowered term, but normal-order reduction contracts root redexes, so a
redex path at step N > 1 indexes a structurally different tree — the coordinate system had stopped
existing, and `owning_node` could not tell, because the root sits at the empty path and the empty path
is a prefix of every path, so it always found a match. Measured on `let x = 40; x + 2`: all seven steps
named the same node, "let x = 40;"; `x + 2` was never named. That is worse than shipping no field at all
— the standard this same section already applied to `redex` — so the field is gone, not left `None`.
`TmState.source_node` is untouched by this: it stays honestly `None`, and PR 3 decides it.

### 4.3 Core supplies budgets; the caller supplies numbers

```rust
impl LambdaState { pub fn render(c: &LambdaCursor, byte_budget: usize) -> LambdaState; } // corrected twice in PR 2 — see the note below
impl LambdaState { pub fn ast(c: &LambdaCursor, node_budget: usize) -> Option<TermNode>; }
impl TmProgram   { pub fn of(m: &Machine, width: usize) -> TmProgram; }
impl TmState     { pub fn window<M: Borrow<Machine>>(c: &TmCursor<M>, radius: usize) -> TmState; }
```

**Core never picks a window radius or a truncation threshold.** Those are renderer policy, and policy
in a library is how it stops being reusable. The builders take the numbers.

**`LambdaState::render` gained two parameters during PR 2, then lost them again later in the same PR —
both corrections recorded here, not silently edited.** This section originally specified `render(c:
&LambdaCursor, byte_budget: usize)` alongside a `LambdaState::redex: Option<Span>` field. The redex a
step highlights is not something `LambdaCursor` carries — `LambdaCursor::term()` is the term *after* the
last emitted event, while the event's `Beta { redex }` path indexes the term *before* it, so which one
to highlight is a caller decision, like the budget. `render` was accordingly widened to take `map:
&SourceMap` and `redex: Option<&Path>`, resolving them internally via `owning_node` and storing the
result in a new `source_node` field rather than in `redex`.

**That widening is reverted, and the reason is `source_node` itself, not this section's first
argument.** The resolution `owning_node` performed turned out to be wrong past the first β-step:
`node_to_lambda`'s paths are root-relative into the INITIAL lowered term, and normal-order reduction
contracts root redexes, so a later step's redex path is not a coordinate into that term at all —
`owning_node` never surfaced this, because the root's empty path is a prefix of every path, so it always
matched, confidently, and wrong from step two on (§4.2 has the measurement). `LambdaState.source_node`
and `owning_node` are both gone, and `render` is back to the signature this section originally
specified: `render(c: &LambdaCursor, byte_budget: usize) -> LambdaState`, with no `SourceMap` and no
redex path required to call it. `TmState.source_node` is untouched by any of this — it stays honestly
`None`, and PR 3 decides it.

**`TmState`'s head coordinates changed during PR 2, and PR 3's `tapeSlice` depends on the new shape.**
This section originally specified `heads: Vec<i64>` alone, which the implementation first read as an
index into `window[i]` — enough to place a marker inside the window and nothing else, leaving
`tapeSlice(tape, from, to)` with no coordinate space to speak in. Both fields are now indices into the
tape **as materialized**: `heads[i]` is the head's position, `window_start[i]` is where `window[i][0]`
sits, so the marker is `heads[i] - window_start[i]` and scrolling addresses the same space. `usize`
rather than `i64` because they cannot be negative.

**The caveat, stated because it is real:** `Tape` is a zipper, so this origin is the leftmost cell the
tape has materialized. If the head moves left of that region the origin shifts. There is no
process-wide absolute coordinate to report instead, and a renderer holding a `window_start` from an
earlier step must not assume it still means the same cell.

### 4.4 Why the λ payload is text, and why the budget is not optional

`print_lambda_mapped` walks the term structurally through `write_term`, with **no memoization and no
output cap**. The in-memory term is a shared DAG; printing expands it to its *logical* size — the
unbounded quantity that four falsified designs on the λ thread were about, and the one the
`maxfree`/`depth` short-circuits exist to avoid touching.

A JSON tree is strictly worse: serializing the DAG as a tree destroys the structural sharing that
makes the in-memory term tractable at all.

So `LambdaState::render` delegates to §3.5's `print_lambda_capped`, which stops writing at the budget
and reports whether it did — the cap is enforced during the walk, never after it.
`LambdaState::ast` takes a node budget and returns **`None` when exceeded** rather than a partial
tree: a truncated AST is a lie about the term's shape, where truncated text is visibly truncated.

`ast` must also count as it walks and bail at the budget, for the same reason — building the whole
tree and then measuring it defeats the purpose.

**Native recursion is bounded, but not by anything upstream of the printer — corrected 2026-08-05, this
section originally argued the opposite.** It claimed the reducer's `MAX_TERM_DEPTH` (3,000) already
bounded print depth, because a term reachable through a cursor could not exceed it. That premise is
false: `LambdaCursor::new` performs no depth check at all, and `trace.rs`'s guard fires only when a
caller *steps* the cursor — the very first term a cursor holds, before any step, can already be deeper
than a native recursive walk survives. This is the same premise `viewmodel.rs`'s `to_tree` was written
iteratively to honor, so the two disagreed with each other as well as with the code.

Nor can the byte budget substitute for a depth limit on its own. A left-nested spine — `write_app_fn`
delegating into `write_term` down the function-position chain, exactly the shape `lower.rs`'s
`Core::Apply` builds — writes zero bytes while descending: every frame recurses again before writing
anything of its own, so `out.len() >= byte_budget` cannot fire during that descent no matter how small
`byte_budget` is. Native recursion depth there equals the spine length, and 100,000 juxtaposed atoms
overflow the stack regardless of budget.

`write_term`, `write_app_fn`, `write_atom` and `parenthesized` now thread a `depth` counter alongside
`budget`, incremented once per `Abs`/`App` level and checked at the top of each function next to the
budget check; past `MAX_TERM_DEPTH` the walk stops and sets `hit` the same way the budget does. So
`truncated` means "bounded, for either reason" — the budget bounds *width*, the depth counter bounds
*recursion*, and neither substitutes for the other.

### 4.5 Why the TM machine is split out

§9.1 puts the machine inside the per-step `TmState`. The `map` demo is **3,203 states, 5 tapes,
344,999 steps**, and `DEFAULT_CAPS.cells` permits 5,000,000 cells summed across all tapes
(`trace.rs` totals `Tape::cells()` over every tape — it is not a per-tape limit, and it is a default
rather than a property of `Caps`; **corrected 2026-08-05**, this section originally said "5,000,000
cells per tape"). Re-sending the machine per
step re-sends 3,203 states 344,999 times, and sending whole tapes per step is the O(tape) per-step
cost `trace.rs`'s own header was written to avoid — it records 3,488 bytes/step and 592.9 MB for
`sum(5)`.

The machine is immutable for the duration of a run, so it crosses once. Per-step state is a window
of radius `r` around each head, which is all §6.1's tape strip ever displays, plus
`tapeSlice(tape, from, to)` for scrolling.

**§9.1 is corrected here rather than contradicted silently**, the same treatment the roadmap gives
§10.4's false premise and §3.3's wrong WORK-tape estimate.

### 4.6 Width fitting costs a second run, and that is acceptable

`run_tm_fitted` finds the narrowest field width by attempting 4 → 8 → 16 → 32 → 64, which requires
running to completion. The session then lowers once more at the found width for stepping.

At the concurrency design's measured **~13 ns per δ-step**, the `map` demo's 344,999 steps is ~4.5 ms
and a full 5,000,000-step cap is ~65 ms. Paying it twice is not a cost worth designing around.
Pinning width at 64 to avoid it would reintroduce the **3.59× step regression** the per-program
field-width slice removed.

## 5. `crates/redextape-wasm`

### 5.1 Shape

```rust
#[wasm_bindgen]
pub struct Session {
    lambda:  Result<LambdaCursor, LowerError>,
    tm:      Result<TmCursor<Rc<Machine>>, TmDecline>,
    program: Option<TmProgram>,   // projected once at compile; None iff `tm` is Err
    map:     SourceMap,
}
```

**Each leg is a `Result`, not an `Option`, because the refusal reason is the payload** —
`lambdaStatus()`/`tmStatus()` return it, and an `Option` would throw away the one thing the UI needs
to say.

There is no separate `machine` field. `TmCursor<Rc<Machine>>` owns the only `Rc`, and `TmProgram` is
projected once at compile time and cached — so `tmProgram()` is a clone of a small struct rather than
a re-walk of 3,203 states, and there is no second object that could disagree with the cursor's. That
is the same failure Plan 4 deferral #1 fixed by removing the `Machine` parameter from
`attribute_tm_spans`, and it should not be reintroduced one layer out.

```ts
compile(src: string, encoding: "unary" | "binary"): CompileResult
// { diagnostics: Diagnostic[], session: Session | null }

class Session {
  lambdaStatus(): { available: true } | { available: false, reason: string, node: number }
  tmStatus():     { available: true, width: number } | { available: false, reason: string }

  stepLambda(): boolean
  lambdaState(byteBudget: number): LambdaState  // correct as written again — see the note below
  lambdaAst(nodeBudget: number): TermNode | null

  tmProgram(): TmProgram
  stepTm(): boolean
  tmState(radius: number): TmState
  tapeSlice(tape: number, from: number, to: number): Symbol[]

  raiseLambdaCap(extra: number): void
  raiseTmCap(extraSteps: number, extraCells: number): void

  sourceSpan(node: number): Span | null
}
```

The two legs step independently. **Synchronized stepping is v1.5** (§6.3, deferred for the
order-mismatch reason in §13.1) and this API deliberately does not pretend otherwise.

**Corrected again, later in the same PR — `lambdaState(byteBudget: number)` is correct exactly as
written above, and the paragraph above no longer describes what it needs.** §4.2 and §4.3 record why:
`LambdaState.source_node` was removed, `owning_node` went with it, and `render` dropped `map` and
`redex` because they existed only to compute that field. `lambdaState` calls `render`, so it needs
neither a `SourceMap` nor a redex path either — `byteBudget` alone is enough, which is what this line
said in the first place, before the correction above walked it away and this one walks it back.
`Session` still holds `map: SourceMap` (the struct above is unchanged): `sourceSpan(node)` needs it, and
so does PR 3's click-linking. Retaining the last `Beta` event's path for `lambdaState`'s sake, though, is
no longer something this API requires — whether `Session` needs it for some other reason is open and not
decided here.

### 5.2 The crate is thin by design, and CI is why

Coverage runs `cargo llvm-cov nextest --workspace --fail-under-lines 80`, and the CI comment records
both runners sitting ~15 points above the gate. **A new workspace member whose code only executes in
a browser adds uncovered lines to that denominator** — `wasm-bindgen-test` runs in headless Chrome
while `llvm-cov` instruments the native build, so nothing collects.

Two responses, the first of which is good architecture on its own merits:

1. **All logic lives in `viewmodel.rs`** — budgets, the projection, windowing, truncation. Natively
   tested, natively covered.
2. **`redextape-wasm` splits into a testable inner module and a `#[wasm_bindgen]` shell.** The shell
   is marshalling with no branches; the inner module is ordinary Rust with ordinary tests.

**`--exclude redextape-wasm` from coverage is rejected.** It is the same shape as a CI job that can
be skipped: the gate stops meaning what it says.

### 5.3 Dependencies

| crate | version |
| --- | --- |
| `wasm-bindgen` | 0.2.126 |
| `serde-wasm-bindgen` | 0.6.5 |
| `js-sys` | 0.3.103 |
| `console_error_panic_hook` | 0.1.7 |
| `wasm-bindgen-test` (dev) | 0.3.76 |

`wasm-pack` stays at **0.15.0**, which is what `ci.yml` and the `Dockerfile` already pin and is
current. `web-sys` is left out until something needs raw DOM beyond CodeMirror.

`console_error_panic_hook` sits here rather than in core: core's lints mean it should have nothing to
report, and installing a panic hook is the binary's business — the same argument the core manifest
already makes about `mimalloc` and global allocators.

## 6. `web/`

### 6.1 Stack

Vite + TypeScript + CodeMirror 6, on **pnpm**. Versions checked against the registries on
2026-08-05:

| package | version |
| --- | --- |
| `vite` | 8.2.0 |
| `typescript` | 7.0.2 |
| `@biomejs/biome` | 2.5.7 |
| `vitest` | 4.1.10 |
| `@codemirror/state` | 6.7.1 |
| `@codemirror/view` | 6.43.8 |
| `@codemirror/commands` | 6.10.4 |
| `@codemirror/lint` | 6.9.7 |
| `@codemirror/search` | 6.7.1 |
| `@types/node` | 26.1.2 |
| pnpm | 11.20.0 (pinned via `packageManager`) |
| node | 26.6.0 (`node:26-slim` / `node:26-bookworm`, already correct) |

**Not taken: the `codemirror` meta-package and `@codemirror/language`.** The meta-package's
`basicSetup` pulls in autocomplete and the Lezer language system — precisely the parts §6.2 makes
unnecessary.

**Two facts verified rather than recalled.** `typescript@7.0.2` ships platform binaries as optional
dependencies (`@typescript/typescript-linux-x64`, `-darwin-arm64`, …), i.e. `tsc` is the native port
and no longer JavaScript. Low risk *for this stack*, because nothing here consumes the TypeScript
compiler API programmatically — Vite transpiles with Rolldown, Vitest rides Vite, Biome has its own
Rust parser, and we only run `tsc --noEmit`. The operational consequence is per-platform binaries in
the lockfile. Separately, `vite@8.2.0` depends on `rolldown ~1.2.0` and `lightningcss` directly, with
no esbuild or rollup; `vitest@4.1.10` declares `vite: ^6 || ^7 || ^8`, so the pair is compatible, and
Vite 8's `engines` (`^20.19 || >=22.12`) is cleared by Node 26.

### 6.2 CodeMirror integration uses decorations, not a grammar

CM6 offers two independent paths. The **language system** — a Lezer grammar compiled to a parser,
`styleTags` mapping node types to highlight tags — is what "custom language support" normally means,
and it would be **a second authoritative grammar for this language**, the exact hazard the roadmap
flags under the tree-sitter track ("never maintain two authoritative grammars").

The **decoration path** takes externally-computed ranges:

```ts
const spans = classify_source(doc.toString());       // from core, via wasm
const b = new RangeSetBuilder<Decoration>();
for (const { from, to, cls } of spans)
  b.add(from, to, Decoration.mark({ class: `tok-${cls}` }));
// served through a StateField → EditorView.decorations
```

`analysis::classify_source` already ships and returns `Vec<(Span, TokenClass)>`, so **CodeMirror's
headline feature is already delivered, in Rust**. Linting is the same shape: `@codemirror/lint`'s
`linter(view => Diagnostic[])` takes `{from, to, severity, message}`, which is core's `Diagnostic`
plus `Span` renamed.

What a Lezer grammar would additionally buy — incremental re-parse on large documents, bracket
matching, structural folding, indent-on-newline — is not in v1 scope and is not worth a second
grammar.

**Known limitation, recorded not hidden:** the decoration path re-tokenizes the whole document on
every change rather than incrementally. Lexing a source file of the size this language is used at is
microseconds; it would matter for a large `.tm` document, which §11 lists as an open risk.

### 6.3 What this slice builds

**One editable CodeMirror pane for source** — highlighted from `classify_source`, linted from
`Diagnostic` — with λ and TM results below as plain text: normal form, decoded value, both step
counts, and each leg's status when it declines.

**Not in this slice:** the λ and TM panes, click-linking (§6.2), dual-focus highlight, detach-on-edit
(§7.1), the caps affordance UI (§6.4). Those are Plan 5. What this proves is that the decoration and
lint paths work end to end against real core output.

### 6.4 Toolchain migration

`Dockerfile` stage 2 and the CI `web` job both assume npm. Four edits, cheap now because `web/` does
not exist:

```
Dockerfile : node:26-slim + pinned pnpm; COPY package.json pnpm-lock.yaml
             npm ci        → pnpm install --frozen-lockfile
             npm run build → pnpm run build
ci.yml     : npm ci        → pnpm install --frozen-lockfile
             npx biome ci  → pnpm exec biome ci
             npm run X     → pnpm run X
             cache ~/.npm keyed on package-lock.json
                  → pnpm store keyed on pnpm-lock.yaml
detect     : unchanged — still gates on web/package.json
```

pnpm is pinned by a `packageManager` field and installed explicitly at a pinned version in both
images, rather than relying on corepack being bundled.

**Why pnpm over npm:** strict `node_modules`. npm's flat install permits importing a package that was
never declared — it resolves as a transitive dependency of something else, until a version bump moves
it. pnpm's symlinked layout makes that a hard error. That is the same shape as §2's gate: a
mechanical check replacing a rule nobody enforces.

**Bun and Deno were considered and rejected** (§9.4).

### 6.5 The `docker` job arms on this slice

`ci.yml`'s `docker` job is conditioned on `github.event_name != 'pull_request'`, **not** on a tag. So
landing `web/package.json` means every push to `main` builds and pushes an image to
`forge.daveynet.xyz`. **This is intended and was confirmed.**

The buildx-collision hazard the job's own comment describes — a shared runner with `ws-sim`, and an
unconditional `docker rm -f` — is already resolved by the per-repo builder name (`redextape-wud`)
from PR #2. Landing `web/` does not reopen it.

## 7. Error handling

Five refusal kinds reach the boundary, and the UI must not flatten them:

```
analyze()                → Error-severity Diagnostic[]   → no session
lambda::lower            → LowerError::{StatefulClosure, Unsupported, TooDeep}
tm lowering              → TmRun::{TooLarge, LowerError(..)}    — never started
tm run                   → TmRun::Overflow                      — not representable at any width
either cursor, mid-run   → HitCap                               — recoverable, with one exception per cursor (see below)
render budget exceeded   → truncated: true  /  ast() → None
```

The distinctions are load-bearing in core already. `TooLarge` is reported once at the first width
with no retry, because `run_tm_fitted`'s widen-and-retry loop would re-lower and re-refuse the same
program at every width. `Overflow` *is* retried, because widening is exactly the fix. `HitCap` is the
only *budget* outcome among the five, which is why §3.3's `raise_cap` targets it and nothing else.

**"Continuable" is not the same claim as "a budget outcome" — corrected 2026-08-05, this section
originally said `HitCap` was simply "the only continuable one."** `HitCap` has more than one producer
on each cursor, and not every producer is a budget running out. `LambdaCursor`'s depth guard latches
`HitCap` for a term already too deep to recurse over safely — a fact about the *term*, not about `cap`.
Raising the cap cannot change a term's depth, so clearing `HitCap` on that path takes zero steps and
re-latches it immediately: `LambdaCursor::raise_cap` now checks which producer fired before clearing.
`TmCursor::new`'s absurd-declared-tape-count refusal is the same shape on the TM side: it latches
`HitCap` *without ever allocating a tape*, so there is no "tapes and state it reached" to continue
from — `TmCursor::raise_cap` now refuses to clear that one too. Both checks are documented on their
respective `raise_cap` methods, in `trace.rs`.

**Both legs declining is a normal outcome, not an error state.** `LAMBDA_LIMITATION_DEMOS` — a
closure that assigns a captured `let mut` — produces `LowerError::StatefulClosure`, and a TM-only
session is the correct result. Rendering that honestly is better product than hiding it, and it is a
real asymmetry between the two models rather than a gap in the implementation.

**No panic may cross the boundary.** A Rust panic under wasm is an abort that poisons the module;
there is no unwinding to catch. `[workspace.lints.clippy]`'s `unwrap_used`/`expect_used`/`panic`/
`todo`/`unimplemented` already forbid the sources and `redextape-wasm` inherits them. Every fallible
export returns `Result<_, JsValue>`. `console_error_panic_hook` is installed for legibility if one
ever escapes, not as a strategy.

## 8. Testing

**Core (native, counts toward coverage):**

- `desugar_mapped` — every `NodeId` in the produced `Core` resolves to a `Span`; synthesized nodes
  inherit the nearest enclosing expression; spans stay in bounds on every corpus program, the
  property `tests/span_wellformed.rs` already asserts for the four printers.
- `raise_cap` — clears `HitCap`; leaves `Normalized`/`Halted`/`Rejected` terminal; a raised TM run
  continues from its actual tapes and state rather than from `m.start`.
- `TmCursor<M>` — a differential test that `TmCursor<&Machine>` and `TmCursor<Rc<Machine>>` emit
  identical `StepEvent` sequences on the corpus. This is the guard that the ownership change altered
  no semantics, and it is the same device `tests/zipper_equivalence.rs` uses for the two β-loops.
- `print_lambda_capped` — output never exceeds the budget by more than one token; the flag is true
  iff the cap fired; at a budget larger than the term it is byte-identical to `print_lambda_mapped`,
  which is what pins that no printed byte moved.
- View-model builders — the byte budget is honored exactly; `truncated` is true iff it was hit;
  `ast` returns `None` rather than a partial tree; `TmState::window(r)` yields `2r+1` cells per tape,
  clamped at tape ends; `TmProgram::of` reproduces `Machine::alphabet()`.
- serde round-trip for all four types, behind the `serde` feature — §10.4's stated outcome.

**Boundary:**

- `wasm-pack build` green — Plan 4's own named testable outcome.
- `wasm-bindgen-test` in headless Chrome: compile → step both legs → read state, on one ordinary
  program and on one `LAMBDA_LIMITATION_DEMOS` program to pin the TM-only path.

**Web:**

- Vitest over the CM6 wiring: `classify_source` spans become the correct `Decoration.mark` ranges;
  `Diagnostic` spans become the correct `@codemirror/lint` entries. These are pure functions from
  core output to CM6 input and need no browser.
- `npx biome ci`, `tsc --noEmit`, `pnpm run build` — the four commands the CI `web` job already runs.

**Gate:**

- `cargo check --target wasm32-unknown-unknown -p redextape-core --lib` in `check-all.sh`.

## 9. Considered and not taken

### 9.1 View models in the WASM crate

Rejected on the second-consumer argument (§4.1). The orphan rule would force a wrapper type per core
type purely to attach `Serialize`, and the alternative — an optional `serde` feature on core — is
what §2 makes admissible anyway, so the wrapper cost buys nothing.

### 9.2 Leptos instead of TypeScript

**Seriously considered, and it would have deleted more of this design than any other option.** A
Leptos app depends on `redextape-core` directly: no wasm-bindgen marshalling, no serde, no
`TmProgram` projection, no text-vs-AST decision — the renderer would hold `Rc<Node>` and `&Machine`
and walk them with memoization. It also deletes the npm toolchain outright.

The editor requirement is also smaller than "CodeMirror" implies, because `classify_source` does the
hard part: a highlighted `<textarea>` over a scroll-synced `<pre>` covers editing, undo, IME, paste,
click-to-offset and span painting in roughly 150 lines.

**Rejected on four gaps, ranked by what a user would hit:** bracket matching and auto-indent;
undo-versus-programmatic-edits, which §7.1's "recompile from source discards the edits" flow hits
directly; find/replace across a transparent textarea over a visible `<pre>`; and no virtualization
for large documents. The last is mitigated in practice — nobody hand-edits a 3,203-state generated
machine, and the generated one needs windowing under either stack for DOM reasons — but it is real.

**The asymmetry was noted and knowingly spent.** Leptos does not foreclose CodeMirror (a Leptos app
can mount CM6 through `wasm_bindgen` later); TypeScript does foreclose deleting the boundary. The
decision accepts a permanent serialization layer in exchange for a battle-tested editor from day one
and a clear path to the v2 LSP.

**The insurance policy is kept anyway:** `viewmodel.rs` lives in core with the `serde` feature, so the
data contract exists and is tested independently of which frontend consumes it.

### 9.3 Following §9.1 literally

One `TmState` carrying the machine and whole tapes every step. Recorded as the option the spec names;
§4.5 has the numbers.

### 9.4 Bun, Deno, and plain npm

**The JS toolchain here is build-time only** — `Dockerfile` stage 3 is `nginx:alpine` serving static
files, and no JS runtime ships. So Bun's and Deno's headline feature, a faster runtime, is worth
nothing to the product.

- **Bun** — `bun install` is the fastest of the four, but its test runner is not Vitest and Vite is a
  second-class path. The win over pnpm is small once CI caches.
- **Deno** — its built-in fmt/lint duplicate Biome, which the spec already picked, and Vite +
  `node_modules` interop is the least-trodden path of the four.
- **npm** — defensible: zero switching cost, and the images already match. Rejected because the
  migration is ~8 lines today versus a lockfile-churning PR later, and strict `node_modules` is the
  kind of mechanical guarantee this repo prefers.

### 9.5 `strum` for the encoding registry — deferred, not rejected

§2 makes it admissible. It is **not** taken in this slice, because it is unrelated work and belongs
with the next change to the registry.

Scoped when it happens: `encoding_kinds!` generates five things, and strum covers three — `ALL`
(EnumIter), `name` (Display), `parse` (EnumString). It does **not** cover `at`, which maps each
variant to a *different type's* constructor, so that stays a hand-written match. The trade is a
documented ~60-line macro for a plain enum plus three derives plus one manual match. It buys back the
recorded cost — "less greppable and produces weaker rustdoc" — but relocates rather than eliminates
the drift hazard the macro exists for.

### 9.6 `smallvec` for `Path` — rejected, and the finding is the point

`trace.rs`'s header records the λ `Beta` variant allocating a small `Vec` per step, "accepted rather
than optimized" because the inline-capacity alternative "would need a dependency core is not
allowed." §2 removes that objection. It should still not be taken.

**`smallvec` would not fix what is actually suboptimal there.** `reduce_step` builds the path
bottom-up: `Vec::new()` at the redex, then `path.insert(0, dir)` at each level on the way out.
`insert(0, ..)` is an O(n) memmove, so a depth-*d* path costs O(d²) memmoves. SmallVec does not
change that — it is the same memmove on the stack. **The O(d) fix is `push` then one `reverse()`, and
it needs no dependency.**

The allocation itself is one per β-step against ~2,840 node visits per β-step (the β-fusion
measurement), so it is ~0.035% of the node traffic.

**Neither change should be made on this reasoning alone.** It has not been measured, and optimizing
against an unmeasured cost model is this thread's signature failure — the most recent over-reported
the cost it named by ~1,584×. Recorded as a candidate with a named mechanism, for whoever next
measures the λ hot path.

### 9.7 `bumpalo` for the arena — unchanged by §2

The roadmap lists the dependency as **obstacle 1 of 3**, and says the third "is the one that makes
this a rewrite": `Rc` wants individual deallocation where a pure bump arena never frees (on the order
of 3×10⁸ node allocations at level 11, tens of GB unreclaimed), and `&'a Node` propagates through
`trace`, both cursors, `lower`, `decode` and every test holding a term across a call.

Removing obstacle 1 leaves it exactly as unbuildable. The whole item remains "NOT BUILT, AND NOT YET
JUSTIFIED" — the ~2 ns mechanism is still unnamed, and `perf stat` with V4 as the discriminator is
the instrument that would name it.

## 10. Landing order

**This is too large for one PR and decomposes cleanly into three**, each independently green and each
useful on its own. The order is forced: 2 depends on 1's rule change, 3 depends on 2's types.

**PR 1 — the gate and the rule.** `cargo check --target wasm32-unknown-unknown -p redextape-core
--lib` in `check-all.sh` and the two CI jobs that reach a base-tier leg — `rust` and `rust-scoped`;
`Cargo.toml`'s comment rewritten and a roadmap entry
added, with the eight historical plan documents left as written (§2.3). No new dependency, no
behaviour change, no new code. Smallest possible PR that settles the question everything else is
built on.

**PR 2 — the core changes.** `desugar_mapped`, `SourceMap::node_to_source`, `raise_cap` on both
cursors, `TmCursor<M>`, `print_lambda_capped`, `viewmodel.rs`, and the optional `serde` feature.
Entirely native, entirely covered by the existing coverage gate, and it leaves the tree with a tested
data contract and no consumer — which is a legitimate resting point, not a half-finished one.

**PR 3 — the boundary and the app.** `crates/redextape-wasm`, `web/`, the pnpm migration, and the
`Dockerfile` + `ci.yml` edits. This is the PR that arms the `docker` push (§6.5) and activates the
`web` job.

Splitting this way also means the riskiest coverage question (§5.2) arrives last, with PR 2's
inner-module tests already in the tree to absorb it.

## 11. Open risks

1. **A large `.tm` document in an editable pane.** A 3,203-state machine's text form is on the order
   of 250 KB. §6.2's decoration path re-tokenizes the whole document per change, and CM6 without a
   Lezer grammar has no incremental parse. Not hit by this slice — the source pane is the only
   editor here — but it lands on Plan 5's desk with the λ and TM panes, and the mitigation is
   probably the same windowing policy §4.5 already establishes.
2. **Coverage headroom.** §5.2's split is designed to keep the gate green, but the actual figure is
   not knowable until the crate exists. If it drops below 80%, the response is more inner-module
   tests, not an `--exclude`.
3. **The allocator reference environment is named here, and the re-measurement is not done.** The
   reference environment for the shipped product is **the browser under `dlmalloc`**; `mimalloc`
   remains a dev-only probe allocator and never enters `[dependencies]`. The seven probes keep their
   dated stale-timing notes, and the roadmap entry moves from DEFERRED to a named follow-up slice.
   The zipper's **1.41–1.43× (glibc)** is the figure most at risk and the one that follow-up should
   start from — its mechanism is reducing allocation, which a cheaper allocator plausibly shrinks the
   margin on. The concurrency design's 159× is not at risk and moves the safe way.
4. **`desugar_mapped`'s span attribution for synthesized nodes** is a judgment (§3.1) that no
   renderer has yet exercised. If Plan 5's source pane finds nearest-enclosing wrong, the fix is
   local to `desugar.rs`.
