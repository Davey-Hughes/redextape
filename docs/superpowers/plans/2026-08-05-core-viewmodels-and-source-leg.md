# Core View Models and the Source Leg — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `redextape-core` the data contract a renderer consumes — `viewmodel.rs` behind an optional `serde` feature — plus the four capabilities it needs that do not exist yet: a source-span leg on `SourceMap`, resumable cursors, a `TmCursor` that can be owned, and a λ printer that honours a budget.

**Architecture:** Everything lands in `redextape-core` and is exercised by native tests. No crate is created, no renderer exists yet, and nothing outside core is touched. The slice ends with a tested contract and no consumer, which is a legitimate resting point — PR 3 is what renders it.

**Tech Stack:** Rust (edition 2024, stable), `cargo-nextest`, `proptest` via `redextape-test-support`, `serde` as core's first optional dependency.

This is **PR 2 of 3** from [`../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md`](../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md) §10, implementing its §3 and §4. **PR 1 landed as `c975e96`** — the wasm32 gate, and the dependency-rule change that makes this PR's optional `serde` admissible. PR 3 (`crates/redextape-wasm`, `web/`, pnpm) depends on this one and is not in scope.

> **SUPERSEDED IN PLACES — READ THE SPEC FOR THE SHIPPED SHAPE (added 2026-08-05, after the branch merged).**
> This plan was amended once mid-flight (the `redex` field drop) and then left alone as later review
> rounds changed things, so it is inconsistently frozen. What it still shows that did not ship:
> `render(c, map, redex, byte_budget)` — `map` and `redex` went with `LambdaState::source_node`,
> removed because it resolved confidently and constantly wrong after the first β-step; and
> `heads: Vec<i64>` — now `Vec<usize>` alongside a new `window_start`, both indices into the
> materialized tape so `tapeSlice` has a coordinate space. `print_lambda_capped` also gained a depth
> limit the plan does not mention. The spec's §4 carries the shipped shape with the reasons annotated;
> this document is kept as the record of what was planned, not of what exists.

## Global Constraints

- **Rust edition 2024**; `rustfmt.toml` sets `max_width = 120`, `use_small_heuristics = "Max"`.
- **No panics on library paths.** `[workspace.lints.clippy]` warns `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`; CI's `-D warnings` makes them fatal. `clippy.toml` exempts test code — read it before writing a test that trips one.
- **`serde` enters as an OPTIONAL, default-off dependency.** `cargo tree -p redextape-core --edges normal` with default features must still list only `redextape-core`. The wasm32 gate (`scripts/check-all.sh`'s `wasm` leg) must stay green.
- **No printed byte moves.** Every existing golden, round-trip, foreign-reader and span test must pass unedited. `print_lambda` and `print_lambda_mapped` keep their exact signatures and output.
- **`main` is linear and PR-only.** Work on branch `plan4/core-viewmodels`, already checked out. Squash-merge in the Forgejo web UI. Never push to `main`.
- **Coverage floor is 80% lines** (`cargo llvm-cov nextest --workspace --fail-under-lines 80`); the tree currently sits at **95.79%**. New code must be tested, not merely written.
- **Annotate, do not rewrite.** Historical plan documents are records. Only this branch's own plan and the roadmap record changes.

## Two design gaps this plan resolves

The spec under-specifies two things. Both are settled here so no task hits them mid-implementation.

**Gap A — `SourceMap` cannot build the source leg from what it is given.** `build(core: &Core, enc: &dyn Encoding)` receives a `Core`, and `Core` carries no spans; the spans exist only in the surface `ast`, which `desugar` consumes. A `with_source(spans)` setter would let a caller attach spans from one program's desugar to a map built from another `Core` — *precisely* the failure `sourcemap.rs`'s module doc records for the TM name index: "a caller holding a `Machine` next to a `SourceMap` with nothing checking the two came from one lowering ... resolves every id to some plausible name and mis-attributes most of them in silence."

**Resolution: one entry point that owns both sides.** `SourceMap::build_from_program(&Program, &dyn Encoding) -> (Core, SourceMap)` desugars internally, so the `Core` and the spans provably come from one desugar. `build(core, enc)` stays exactly as it is for callers that hold no `Program` — tests, examples, the oracle — and leaves `node_to_source` empty, which is how `build` already treats a λ backend that declines. Total over a missing half, never failing.

**Gap B — `LambdaState::render` has no way to know the redex.** §4.3 sketches `render(c: &LambdaCursor, byte_budget)`, but `source_node` needs a `SourceMap` and a `NodeId`, and `node_to_lambda` is `NodeId → Path`, not the inverse. Worse, "the redex" is ambiguous: `LambdaCursor::term()` is the term *after* the last emitted event, while that event's `Beta { redex }` path indexes the term *before* it.

**Resolution: the caller supplies the redex path, exactly as it supplies budgets.** §4.3 already establishes that core provides builders and the caller provides the numbers, because a window radius and a truncation threshold are renderer policy. Which redex to highlight — the one just reduced, or the one about to be — is the same kind of policy, and PR 3's renderer is where it gets decided. `render` takes `Option<&Path>` and resolves `source_node` by longest-prefix match against `node_to_lambda`; `None` in yields `None` out.

## File Structure

| file | change | responsibility |
| --- | --- | --- |
| `crates/redextape-core/src/trace.rs` | modify | `TmCursor<M>` generic over machine ownership; `raise_cap` on both cursors. |
| `crates/redextape-core/src/lambda/syntax.rs` | modify | `print_lambda_capped` — budget enforced during the walk. |
| `crates/redextape-core/src/desugar.rs` | modify | `desugar_mapped` — `NodeId → Span` for all 21 `g.fresh()` sites. |
| `crates/redextape-core/src/sourcemap.rs` | modify | `node_to_source` leg, `source_span`, `build_from_program`. |
| `crates/redextape-core/src/viewmodel.rs` | **create** | The four view-model types and their budget-parameterized builders. |
| `crates/redextape-core/src/span.rs` | modify | One `cfg_attr` line. |
| `crates/redextape-core/src/analysis.rs` | modify | One `cfg_attr` line. |
| `crates/redextape-core/src/lib.rs` | modify | `pub mod viewmodel;`. |
| `crates/redextape-core/Cargo.toml` | modify | Optional `serde`, `[features]`. |
| `crates/redextape-core/tests/viewmodel_contract.rs` | **create** | Budget, windowing and round-trip properties. |

Six tasks. Tasks 1–4 are independent capabilities; Task 5 consumes all of them; Task 6 makes the result serializable. A reviewer could accept any of 1–4 and reject another.

---

### Task 1: `TmCursor` becomes generic over machine ownership

**Files:**
- Modify: `crates/redextape-core/src/trace.rs` — the `TmCursor` struct, its `impl`, and its `Iterator` impl
- Modify: `crates/redextape-core/tests/trace_equivalence.rs` — one type annotation
- Test: `crates/redextape-core/tests/trace_equivalence.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `pub struct TmCursor<M>` with `impl<M: Borrow<Machine>> TmCursor<M>`, constructor `TmCursor::new(m: M, init: &[Vec<Symbol>], caps: TmCaps) -> TmCursor<M>`. Existing callers passing `&Machine` infer `TmCursor<&Machine>` unchanged. Task 2 adds `raise_cap` to this same impl; Task 5's `TmState::window` is generic over the same `M`.

**Why this exists:** PR 3's `Session` must hold the `Machine` and a live cursor over it. With `TmCursor<'m>` borrowing the machine, that struct is self-referential — solvable only with `unsafe` or a crate this project would not take. Making ownership a type parameter lets the session hold `Rc<Machine>` and `TmCursor<Rc<Machine>>`: two owners, no self-reference.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/tests/trace_equivalence.rs`:

```rust
/// The ownership parameter must not change semantics. A cursor that borrows the machine and one that
/// owns it through an `Rc` are the same machine stepped the same way; if they ever diverge, the
/// generic introduced a behavioural difference where it was supposed to introduce only a type one.
/// Same device as `zipper_equivalence.rs` uses to hold the two β-loops equal.
#[test]
fn borrowed_and_owned_cursors_emit_identical_event_sequences() {
    use std::rc::Rc;
    for src in CORPUS {
        let (machine, init) = machine_and_init(src);
        let borrowed: Vec<StepEvent> = TmCursor::new(&machine, &init, TM_DEFAULT_CAPS).collect();
        let owned: Vec<StepEvent> = TmCursor::new(Rc::new(machine), &init, TM_DEFAULT_CAPS).collect();
        assert_eq!(borrowed, owned, "{src:?}: borrowed and owned cursors diverged");
    }
}
```

`CORPUS` and `machine_and_init(src: &str) -> (Machine, Vec<Vec<Symbol>>)` both already exist in this file — use them rather than adding a second way to lower a program. `TM_DEFAULT_CAPS` is already imported there too.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo nextest run -p redextape-core --test trace_equivalence borrowed_and_owned`

Expected: FAIL to compile, with an error on `TmCursor::new(Rc::new(machine), ...)` — the constructor takes `&'m Machine`, so an `Rc<Machine>` is a type mismatch.

- [ ] **Step 3: Make `TmCursor` generic**

In `crates/redextape-core/src/trace.rs`, add `use std::borrow::Borrow;` to the imports, then change the struct and both impls. The lifetime disappears entirely:

```rust
pub struct TmCursor<M> {
    machine: M,
    tapes: Vec<Tape>,
    cur: StateId,
    steps: u64,
    caps: TmCaps,
    status: Option<TmStatus>,
}

impl<M: Borrow<Machine>> TmCursor<M> {
    pub fn new(m: M, init: &[Vec<Symbol>], caps: TmCaps) -> TmCursor<M> {
        // Before allocating a `Tape` per declared tape: a machine declaring e.g. `tapes 10_000_000_000`
        // must hit the cap, not attempt that many allocations. `run` guards this the same way.
        if m.borrow().tapes as u64 > caps.cells {
            return TmCursor {
                cur: m.borrow().start,
                machine: m,
                tapes: Vec::new(),
                steps: 0,
                caps,
                status: Some(TmStatus::HitCap),
            };
        }
        let tapes = (0..m.borrow().tapes).map(|i| Tape::new(init.get(i).map_or(&[][..], Vec::as_slice))).collect();
        let cur = m.borrow().start;
        TmCursor { machine: m, tapes, cur, steps: 0, caps, status: None }
    }
    // ... the remaining methods keep their bodies; `self.machine` becomes `self.machine.borrow()`
    // wherever a `&Machine` is needed.
}

impl<M: Borrow<Machine>> Iterator for TmCursor<M> {
    type Item = StepEvent;
    // body unchanged except `self.machine` -> `self.machine.borrow()` at each use
}
```

Note the field-init order in the early-return: `cur` is computed from `m` before `machine: m` moves it. Getting this wrong is a borrow-checker error, not a silent bug.

`into_tapes(self) -> Vec<Tape>` needs no bound change. Keep every doc comment as it is — the guard-order documentation is still exactly true.

- [ ] **Step 4: Fix the one annotation that moves**

In `crates/redextape-core/tests/trace_equivalence.rs`, the `deltas` helper names the type explicitly:

```rust
fn deltas<'m>(m: &'m Machine, init: &[Vec<Symbol>], caps: TmCaps) -> (Vec<(u32, u32)>, TmCursor<&'m Machine>) {
```

Every other call site — `sim::run`, the other test site, and three in `examples/concurrency_probe.rs` — infers `TmCursor<&Machine>` and needs no edit.

- [ ] **Step 5: Run the tests**

Run: `cargo nextest run -p redextape-core --test trace_equivalence`

Expected: PASS, including `borrowed_and_owned_cursors_emit_identical_event_sequences`.

Run: `cargo clippy -p redextape-core --all-targets -- -D warnings`

Expected: clean.

- [ ] **Step 6: Verify no caller broke**

Run: `cargo check --workspace --all-targets`

Expected: clean. This is what proves the "existing callers infer and do not change" claim rather than assuming it.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/trace.rs crates/redextape-core/tests/trace_equivalence.rs
git commit -m "trace: TmCursor takes its machine by ownership parameter, not by lifetime

A stepping session must hold the Machine AND a live cursor over it, which
TmCursor<'m> makes self-referential — solvable only with unsafe or a crate this
project would not take. Dropping the lifetime for TmCursor<M: Borrow<Machine>>
makes that ordinary safe Rust: the session holds Rc<Machine> and
TmCursor<Rc<Machine>>, two owners and no self-reference.

Six call sites checked; five infer TmCursor<&Machine> unchanged and only
trace_equivalence.rs's deltas helper, which names the type, moves.

A differential test pins that the parameter is a type change and not a
behavioural one: borrowed and owned cursors must emit identical StepEvent
sequences across the demo corpus. Same device zipper_equivalence.rs uses to
hold the two beta-reduction loops equal."
```

---

### Task 2: `raise_cap` on both cursors

**Files:**
- Modify: `crates/redextape-core/src/trace.rs` — one method per cursor
- Test: `crates/redextape-core/tests/trace_equivalence.rs`

**Interfaces:**
- Consumes: Task 1's `impl<M: Borrow<Machine>> TmCursor<M>`.
- Produces: `LambdaCursor::raise_cap(&mut self, extra_steps: u64)` and `TmCursor::raise_cap(&mut self, extra_steps: u64, extra_cells: u64)`. Both additive and saturating; both clear a latched `HitCap` and nothing else.

**Why this exists:** §6.4 wants "still running — hit 50k steps" with a continue affordance. Neither cursor can resume: `LambdaCursor` latches `status = Some(HitCap)` and yields `None` forever, and `TmCursor::new` sets `cur` from `m.start` unconditionally, so rebuilding one restarts rather than continues.

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-core/tests/trace_equivalence.rs`:

```rust
/// Raising the cap on a capped run continues it — same tapes, same state, no restart. Rebuilding a
/// cursor cannot do this: `TmCursor::new` starts at `m.start` by construction.
#[test]
fn raising_the_tm_cap_continues_rather_than_restarts() {
    let (machine, init) = machine_and_init("1 + 2 * 3");
    let stingy = TmCaps { steps: 3, cells: 5_000_000 };
    let mut c = TmCursor::new(&machine, &init, stingy);
    let first: Vec<StepEvent> = c.by_ref().collect();
    assert_eq!(first.len(), 3, "precondition: the cap should bite at 3 steps");
    assert_eq!(c.status(), Some(TmStatus::HitCap));

    let state_at_cap = c.state();
    c.raise_cap(1_000_000, 0);
    assert_eq!(c.status(), None, "raise_cap must clear a latched HitCap");
    assert_eq!(c.state(), state_at_cap, "continuing must not rewind to m.start");

    let rest: Vec<StepEvent> = c.by_ref().collect();
    assert!(!rest.is_empty(), "the run should have continued");

    // The continued run must equal an uncapped run of the same machine, spliced.
    let whole: Vec<StepEvent> = TmCursor::new(&machine, &init, TM_DEFAULT_CAPS).collect();
    let spliced: Vec<StepEvent> = first.into_iter().chain(rest).collect();
    assert_eq!(spliced, whole, "capped-then-raised must reconstruct the uncapped run exactly");
}

/// Only HitCap is a budget outcome. Normalized/Halted/Rejected are facts about the computation, and a
/// finished run must not be resurrectable by handing it more budget.
#[test]
fn raising_the_cap_does_not_resurrect_a_finished_run() {
    let t = closed_normalizing_term();
    let mut c = LambdaCursor::new(&t, 1_000_000);
    let before: Vec<StepEvent> = c.by_ref().collect();
    assert_eq!(c.status(), Some(Status::Normalized), "precondition: this term normalizes");

    c.raise_cap(1_000_000);
    assert_eq!(c.status(), Some(Status::Normalized), "Normalized is terminal, not a budget outcome");
    assert_eq!(c.next(), None);
    assert_eq!(c.steps_taken() as usize, before.len(), "no further steps may be taken");
}

/// Additive, and saturating so there is no overflow path.
#[test]
fn raise_cap_is_additive_and_saturates() {
    let t = closed_normalizing_term();
    let mut c = LambdaCursor::new(&t, 1);
    c.by_ref().count();
    assert_eq!(c.status(), Some(Status::HitCap));
    c.raise_cap(u64::MAX);
    c.raise_cap(u64::MAX); // must not overflow
    assert_eq!(c.status(), None);
}
```

`machine_and_init(src)` already exists in this file. `closed_normalizing_term()` is one you write — parse, desugar and `lower` a small program, the same three-step shape `syntax.rs`'s `printed_lowering_of_every_demo_reparses` uses:

```rust
fn closed_normalizing_term() -> redextape_core::lambda::LambdaTerm {
    let (program, _) = redextape_core::parser::parse("let x = 1; x + 2");
    let core = redextape_core::desugar::desugar(&program.expect("parses"));
    redextape_core::lambda::lower(&core).expect("a first-order program lowers")
}
```

Put it beside the existing helpers. `"1 + 2 * 3"` is chosen for the TM test because it is the first entry of `CORPUS` and takes well over 3 steps — assert the precondition rather than trusting it, as the test above does.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo nextest run -p redextape-core --test trace_equivalence raise`

Expected: FAIL to compile — `no method named 'raise_cap' found`.

- [ ] **Step 3: Implement both**

In `crates/redextape-core/src/trace.rs`, add to `impl LambdaCursor`:

```rust
    /// Extend a capped run's budget and let it proceed. §6.4's "still running — hit 50k steps ...
    /// continue" is what calls this.
    ///
    /// ADDITIVE AND SATURATING, not absolute. An absolute cap would let a caller set a budget BELOW the
    /// steps already taken, which has no meaning for a run already past it; saturating removes the only
    /// overflow path, so there is no argument value that misbehaves.
    ///
    /// IT CLEARS `HitCap` AND NOTHING ELSE. `Normalized` is a fact about the term, not about a budget,
    /// and a run that finished must not be resurrectable by handing it more of one. This is the same
    /// distinction `TmRun` already draws between `HitCap` and `TooLarge`/`Overflow` — the first says the
    /// budget ran out, the others say the answer is in.
    pub fn raise_cap(&mut self, extra_steps: u64) {
        self.cap = self.cap.saturating_add(extra_steps);
        if self.status == Some(Status::HitCap) {
            self.status = None;
        }
    }
```

And to `impl<M: Borrow<Machine>> TmCursor<M>`:

```rust
    /// Extend a capped run's budget and let it proceed, continuing from the tapes and state it reached.
    ///
    /// THIS IS WHY THE CURSOR CANNOT BE REBUILT INSTEAD. `TmCursor::new` sets `cur` from `machine.start`
    /// by construction, so a reconstructed cursor restarts the machine; only mutating the live one
    /// continues it. Additive, saturating, and clears `HitCap` only — see `LambdaCursor::raise_cap` for
    /// the reasoning on all three, which is identical.
    pub fn raise_cap(&mut self, extra_steps: u64, extra_cells: u64) {
        self.caps.steps = self.caps.steps.saturating_add(extra_steps);
        self.caps.cells = self.caps.cells.saturating_add(extra_cells);
        if self.status == Some(TmStatus::HitCap) {
            self.status = None;
        }
    }
```

If `Status` or `TmStatus` does not derive `PartialEq`, add it — they are `Copy` enums and the derive is free. Check before assuming.

- [ ] **Step 4: Run the tests**

Run: `cargo nextest run -p redextape-core --test trace_equivalence`

Expected: PASS, all three new tests included.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/trace.rs crates/redextape-core/tests/trace_equivalence.rs
git commit -m "trace: cursors can be given more budget without restarting

Neither cursor could resume. LambdaCursor latches status = Some(HitCap) and
yields None forever; TmCursor::new sets cur from machine.start by construction,
so rebuilding one restarts the machine rather than continuing it. Section 6.4's
'still running — hit 50k steps ... continue' had nothing to call.

raise_cap is additive and saturating: absolute would let a caller set a budget
below the steps already taken, and saturating leaves no argument value that
misbehaves. It clears HitCap and nothing else — Normalized, Halted and Rejected
are facts about the computation rather than budget outcomes, the same
distinction TmRun already draws between HitCap and TooLarge/Overflow.

Pinned by splicing: a run capped at 3 steps, raised, and continued must
reconstruct the uncapped event sequence exactly."
```

---

### Task 3: `print_lambda_capped`

**Files:**
- Modify: `crates/redextape-core/src/lambda/syntax.rs` — new public fn, budget threaded through the writers
- Modify: `crates/redextape-core/src/lambda.rs` — re-export
- Test: `crates/redextape-core/src/lambda/syntax.rs` `#[cfg(test)]` module (where the existing printer tests live)

**Interfaces:**
- Consumes: nothing.
- Produces: `pub fn print_lambda_capped(t: &LambdaTerm, byte_budget: usize) -> (String, Classified, bool)` — text, spans, and whether the budget fired. Re-exported from `lambda`. Task 5's `LambdaState::render` calls it.

**Why this exists:** `print_lambda_mapped` walks the term through `write_term` with no memoization and no output cap. The in-memory term is a shared DAG; printing expands it to its *logical* size — the unbounded quantity four falsified λ designs on this thread were about. **The budget must be enforced during the walk.** Truncating the returned `String` is useless: the unbounded allocation has already happened.

- [ ] **Step 1: Write the failing tests**

Add to `syntax.rs`'s existing `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn capped_printing_stops_at_the_budget_and_says_so() {
        let t = lower(&core_of("let xs = [0..200); head(xs)")).expect("first-order demo lowers");
        let (full, _, full_truncated) = print_lambda_capped(&t, usize::MAX);
        assert!(!full_truncated, "an unreachable budget must not report truncation");

        let (short, spans, truncated) = print_lambda_capped(&t, 64);
        assert!(truncated, "a 64-byte budget on a term printing {} bytes must fire", full.len());
        assert!(short.len() < full.len(), "the capped output must be shorter than the full one");
        assert!(spans.iter().all(|(s, _)| s.end <= short.len()), "spans must stay inside the text");
    }

    /// The whole point: the budget bounds what is BUILT, not what is returned. A capped print of a term
    /// whose full printing is enormous must not first build the enormous string.
    #[test]
    fn the_budget_bounds_the_allocation_not_just_the_result() {
        let t = lower(&core_of("let xs = [0..2000); head(xs)")).expect("first-order demo lowers");
        let (short, _, truncated) = print_lambda_capped(&t, 128);
        assert!(truncated);
        // Overshoot is bounded by one token, not by the term's size.
        assert!(short.len() < 128 + 64, "expected <= one token of overshoot, got {} bytes", short.len());
    }

    /// No printed byte moves. At a budget larger than the term, capped printing is byte-identical to
    /// `print_lambda_mapped` — text AND spans — which is what pins that this slice changed no output.
    #[test]
    fn an_unreachable_budget_is_identical_to_the_uncapped_printer() {
        use crate::desugar::desugar;
        use crate::lambda::lower::lower;
        use crate::parser::parse;

        // The same demo list `printed_lowering_of_every_demo_reparses` uses, for the same reason: it is
        // the set whose printed lowering this module already promises to keep stable.
        let demos = ["1 + 2 * 3", "let x = 1; let y = x + x; y * 3", "if 2 > 1 { 10 } else { 20 }", "[1, 2, 3]"];
        for src in demos {
            let (program, _) = parse(src);
            let Some(program) = program else { continue };
            let Ok(t) = lower(&desugar(&program)) else { continue };
            let (want_text, want_spans) = print_lambda_mapped(&t);
            let (got_text, got_spans, truncated) = print_lambda_capped(&t, usize::MAX);
            assert!(!truncated, "{src:?}");
            assert_eq!(got_text, want_text, "{src:?}: text moved");
            assert_eq!(got_spans, want_spans, "{src:?}: spans moved");
        }
    }
```

The first two tests build their term the same way. There is no `core_of` in this module — `printed_lowering_of_every_demo_reparses` does `parse` → `desugar` → `lower` inline, and matching that is better than importing a fourth `core_of`.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo nextest run -p redextape-core --lib lambda::syntax::tests`

Expected: FAIL to compile — `cannot find function 'print_lambda_capped'`.

- [ ] **Step 3: Implement**

In `syntax.rs`, add the public function and thread a budget through the writers. The existing `print_lambda` and `print_lambda_mapped` **keep their exact signatures and bodies' behaviour** — implement them over the capped walker with an unreachable budget, so there is one walker rather than two that must agree:

```rust
/// `print_lambda_mapped`, bounded. Returns the text, its spans, and whether the budget fired.
///
/// THE BUDGET IS ENFORCED DURING THE WALK, WHICH IS THE ENTIRE POINT. Truncating the string this
/// function returns would be useless: `write_term` recurses over the term's LOGICAL size, and the
/// in-memory term is a shared DAG, so a caller that lets the walk finish has already paid the
/// exponential allocation the budget exists to prevent. This is the same quantity four falsified λ
/// designs on this thread were aimed at, and the one `maxfree`/`depth` short-circuit to avoid touching.
///
/// OVERSHOOT IS BOUNDED BY ONE TOKEN, and that is a decision rather than sloppiness. The check happens
/// between pushes, so the last token to start before the budget was reached finishes. Cutting mid-token
/// would split a `λ` — three bytes in UTF-8 — and produce a `String` that is not valid UTF-8 at all.
pub fn print_lambda_capped(t: &LambdaTerm, byte_budget: usize) -> (String, Classified, bool) {
    let mut out = String::new();
    let mut spans: Classified = Vec::new();
    let mut names: Vec<String> = Vec::new();
    write_term(t, &mut names, &mut out, &mut spans, byte_budget);
    let truncated = out.len() >= byte_budget;
    (out, spans, truncated)
}
```

Then add `budget: usize` as the last parameter of `write_term`, `write_app_fn`, `write_atom` and `parenthesized`, and make each return early when over budget. The guard goes at the TOP of `write_term`:

```rust
fn write_term(t: &LambdaTerm, names: &mut Vec<String>, out: &mut String, spans: &mut Classified, budget: usize) {
    if out.len() >= budget {
        return;
    }
    // ... existing body, passing `budget` down to every recursive call
}
```

`print_lambda_mapped` becomes:

```rust
pub fn print_lambda_mapped(t: &LambdaTerm) -> (String, crate::analysis::Classified) {
    let (text, spans, _) = print_lambda_capped(t, usize::MAX);
    (text, spans)
}
```

**Do not change `push_span`, the classification of any token, or the parenthesization rules.** The third test above is what proves you did not.

- [ ] **Step 4: Re-export**

In `crates/redextape-core/src/lambda.rs`:

```rust
pub use syntax::{parse_lambda, print_lambda, print_lambda_capped, print_lambda_mapped};
```

- [ ] **Step 5: Run the printer's whole test surface**

Run: `cargo nextest run -p redextape-core lambda`

Expected: PASS, including the pre-existing `print_then_parse_round_trips`, `print_is_idempotent`, `printed_lowering_of_every_demo_reparses`, and `print_lambda_mapped_spans_stay_in_bounds_on_every_demo`.

Run: `cargo nextest run -p redextape-core --test lambda_foreign_reader --test span_wellformed`

Expected: PASS. These are the tests that would catch a moved byte from outside the module.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/lambda/syntax.rs crates/redextape-core/src/lambda.rs
git commit -m "lambda: a printer that honours a byte budget while it walks

print_lambda_mapped recurses over the term's LOGICAL size with no memoization
and no cap. The in-memory term is a shared DAG, so printing expands the
exponential quantity that four falsified designs on this thread were aimed at
and that maxfree/depth exist to avoid touching. A renderer printing a term per
step needs a bound.

The bound is enforced DURING the walk. Truncating the returned String would be
useless — by then the allocation has happened, which is the whole failure.

One walker, not two: print_lambda_mapped is now print_lambda_capped at an
unreachable budget, and a corpus-wide test asserts the two are byte-identical
in both text and spans, which is what pins that no printed byte moved.

Overshoot is bounded by one token and stated rather than tightened: cutting
mid-token would split a multi-byte λ and yield a String that is not UTF-8."
```

---

### Task 4: `desugar_mapped` and `SourceMap`'s source leg

**Files:**
- Modify: `crates/redextape-core/src/desugar.rs` — span-carrying variant
- Modify: `crates/redextape-core/src/sourcemap.rs` — `node_to_source`, `source_span`, `build_from_program`
- Test: `crates/redextape-core/tests/sourcemap_coverage.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `desugar_mapped(&Program) -> (Core, Vec<(NodeId, Span)>)`; `SourceMap.node_to_source: BTreeMap<NodeId, Span>`; `SourceMap::source_span(&self, id: NodeId) -> Option<Span>`; `SourceMap::build_from_program(&Program, &dyn Encoding) -> (Core, SourceMap)`. Task 5's `LambdaState::render` and `TmState::window` take `&SourceMap` and call `source_span`.

**Why this exists:** §5.4 specifies two maps and never a source one — a gap in the design, surfaced only by asking how a renderer lights the source pane. The view models hand out `NodeId`s, and without this leg those fields ship dead.

**Gap A resolution, restated because it governs the API you write:** `build(core, enc)` cannot compute this leg — `Core` carries no spans. A `with_source(spans)` setter would let a caller attach one program's spans to another program's map, which is exactly the silent mis-attribution `sourcemap.rs`'s module doc records for the TM name index. `build_from_program` owns both sides so they cannot disagree. `build` stays, and leaves the leg empty — total over a missing half, like it already is for a declining λ backend.

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-core/tests/sourcemap_coverage.rs`:

```rust
/// Every node the desugar mints resolves to a span, and every span is inside the source. Synthesized
/// nodes — the `Core::Unit` of a tail-less block, `LetRecGroup` scaffolding — inherit the nearest
/// enclosing expression's span rather than mapping to nothing: a highlighter wants the construct that
/// CAUSED the lowering, and `None` would leave holes exactly where the interesting lowering happened.
#[test]
fn every_core_node_resolves_to_an_in_bounds_source_span() {
    for src in BOTH_BACKENDS {
        let (program, _) = redextape_core::parser::parse(src);
        let Some(program) = program else { continue };
        let (core, spans) = redextape_core::desugar::desugar_mapped(&program);
        let by_id: std::collections::BTreeMap<_, _> = spans.into_iter().collect();

        for id in all_ids(&core) {
            let span = by_id.get(&id).unwrap_or_else(|| panic!("{src:?}: node {id} has no source span"));
            assert!(span.end <= src.len(), "{src:?}: node {id} span {span:?} past end of {} bytes", src.len());
            assert!(span.start <= span.end, "{src:?}: node {id} span {span:?} is inverted");
        }
    }
}

/// `build_from_program` is the only way to get the source leg, and it owns both sides so they cannot
/// disagree. `build` stays total and simply has no source leg — the same shape it already uses for a λ
/// backend that declines.
#[test]
fn build_from_program_populates_the_source_leg_and_build_does_not() {
    let src = "let x = 40; x + 2";
    let (program, _) = redextape_core::parser::parse(src);
    let program = program.expect("parses");
    let enc = redextape_core::tm::encoding::Unary::at(64);

    let (core, mapped) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &enc);
    assert!(!mapped.node_to_source.is_empty(), "build_from_program must fill the source leg");
    assert!(mapped.source_span(core.id()).is_some(), "the root must resolve");

    let plain = redextape_core::sourcemap::SourceMap::build(&core, &enc);
    assert!(plain.node_to_source.is_empty(), "build has no Program and must leave the leg empty");
    assert_eq!(plain.node_to_lambda, mapped.node_to_lambda, "the other legs must be identical");
    assert_eq!(plain.node_to_tm, mapped.node_to_tm, "the other legs must be identical");
}
```

`BOTH_BACKENDS` and `all_ids(&core)` both already exist in `sourcemap_coverage.rs`, and the file already has `mod common; use common::core_of;`. Use all three as they are. The roadmap records `core_of` having been defined four times and that being cleaned up — do not reintroduce the pattern by writing a local id-collector.

Note this test needs the `Program`, not a `Core`, so it calls `parser::parse` directly rather than `core_of` — `core_of` returns a `Core` and the spans live only in the surface AST.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo nextest run -p redextape-core --test sourcemap_coverage source_span`

Expected: FAIL to compile — `desugar_mapped` and `build_from_program` do not exist.

- [ ] **Step 3: Implement `desugar_mapped`**

In `crates/redextape-core/src/desugar.rs`, thread an optional span sink through `NodeGen`. The existing `desugar` keeps its signature and behaviour:

```rust
/// `desugar`, plus the span each minted `NodeId` came from — §5.4's missing third leg.
///
/// SYNTHESIZED NODES INHERIT THE NEAREST ENCLOSING EXPRESSION'S SPAN. Desugaring mints ids that
/// correspond to no source text: the `Core::Unit` standing for a tail-less block's value, the
/// scaffolding inside a `LetRecGroup`. Attributing them to the construct that caused them is what a
/// highlighter wants; `None` would leave holes precisely where the interesting lowering happened, which
/// is the opposite of useful. This is a deliberate difference from `node_to_tm`, which DOES say nothing
/// where the lowering said nothing — that map answers "which states did this node emit", and the honest
/// answer is sometimes none; this one answers "what did the user write that produced this node", and
/// there is always an answer.
pub fn desugar_mapped(program: &Program) -> (Core, Vec<(NodeId, Span)>) {
    let mut g = NodeGen::default();
    let mut spans = Vec::new();
    let core = lower_block_at(&mut g, &program.block, program.block.span, &mut spans);
    (core, spans)
}
```

Implementation approach: give each lowering helper an extra `at: Span` parameter (the enclosing construct's span) and a `&mut Vec<(NodeId, Span)>` sink, and record `(id, at)` at each of the 21 `g.fresh()` sites. Where a helper lowers a sub-expression that has its own span, it passes that span down instead of `at`. Keep `desugar` as a thin wrapper that discards the sink, so there is one lowering rather than two:

```rust
pub fn desugar(program: &Program) -> Core {
    desugar_mapped(program).0
}
```

**That wrapper is the important part.** Two desugars that must stay in agreement is the drift this repo has recorded three times; one lowering with an optional sink cannot drift.

- [ ] **Step 4: Implement the `SourceMap` leg**

In `crates/redextape-core/src/sourcemap.rs`, add the field, the accessor, and the new constructor:

```rust
pub struct SourceMap {
    pub node_to_lambda: BTreeMap<NodeId, Path>,
    pub node_to_tm: BTreeMap<NodeId, Vec<StateId>>,
    pub tm_name_to_node: BTreeMap<String, NodeId>,
    /// `NodeId` -> the source text that produced it. Empty unless the map was built by
    /// `build_from_program`; see that constructor for why there is no setter.
    pub node_to_source: BTreeMap<NodeId, Span>,
}

impl SourceMap {
    /// Both backend halves AND the source leg, from the one desugar that produced the `Core`.
    ///
    /// THERE IS NO `with_source` SETTER, AND THAT IS THE DESIGN. A setter would let a caller attach one
    /// program's spans to a map built from another program's `Core`; the ids would resolve, most of them
    /// to the wrong construct, and nothing would notice. That is the same failure this module's TM name
    /// index was shaped to remove — see the module doc — and the same fix: record the association where
    /// both sides are in hand, so there is no second object to mismatch.
    ///
    /// `build` remains for callers holding no `Program` (tests, examples, the oracle) and leaves
    /// `node_to_source` empty, staying total the way it already is over a λ backend that declines.
    pub fn build_from_program(program: &Program, enc: &dyn Encoding) -> (Core, SourceMap) {
        let (core, spans) = crate::desugar::desugar_mapped(program);
        let mut map = SourceMap::build(&core, enc);
        map.node_to_source = spans.into_iter().collect();
        (core, map)
    }

    /// The source text a Core node came from. `None` for a map built by `build`, which has no `Program`.
    pub fn source_span(&self, id: NodeId) -> Option<Span> {
        self.node_to_source.get(&id).copied()
    }
}
```

`build_from_program` calling `build` internally is why the other two legs are provably identical between the two constructors — the second test asserts exactly that.

- [ ] **Step 5: Run the tests**

Run: `cargo nextest run -p redextape-core --test sourcemap_coverage`

Expected: PASS, including the pre-existing coverage tests for the other two legs.

Run: `cargo nextest run -p redextape-core desugar`

Expected: PASS. The pre-existing `NodeId` uniqueness tests are what catch a threading mistake that reuses an id.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/desugar.rs crates/redextape-core/src/sourcemap.rs crates/redextape-core/tests/sourcemap_coverage.rs
git commit -m "sourcemap: the third leg, so a NodeId can find the text that produced it

Section 5.4 specifies node->lambda and node->TM and never a source map. That is
a gap in the DESIGN, not the code, and it surfaces only when a renderer asks how
to light the source pane — the view models hand out NodeIds, and without this
leg those fields ship dead.

desugar_mapped threads the enclosing span to each of desugar.rs's 21 fresh()
sites; desugar is now a wrapper that discards the sink, so there is one lowering
rather than two that must agree.

Synthesized nodes inherit the nearest enclosing expression's span. That is a
deliberate difference from node_to_tm, which says nothing where the lowering
said nothing: that map answers 'which states did this node emit' and the honest
answer is sometimes none, while this one answers 'what did the user write' and
there is always an answer.

No with_source setter. It would let one program's spans attach to another
program's map, resolving most ids to the wrong construct in silence — the exact
failure this module's TM name index was shaped to remove. build_from_program
owns both sides instead."
```

---

### Task 5: `viewmodel.rs`

**Files:**
- Create: `crates/redextape-core/src/viewmodel.rs`
- Modify: `crates/redextape-core/src/lib.rs` — `pub mod viewmodel;`
- Create: `crates/redextape-core/tests/viewmodel_contract.rs`

**Interfaces:**
- Consumes: Task 1's `TmCursor<M>`, Task 3's `print_lambda_capped`, Task 4's `SourceMap::source_span`.
- Produces: `LambdaState`, `TmProgram`, `TmState`, `TermNode`, and the four builders below. Task 6 adds `Serialize`/`Deserialize` to them. PR 3's `Session` is the only other consumer.

**Gap B resolution, restated because it governs the signatures:** `render` cannot compute `source_node` on its own — it has no map, and `node_to_lambda` is `NodeId → Path` with no inverse. It also cannot decide *which* redex to show, because `LambdaCursor::term()` is the post-step term while a `Beta` event's path indexes the pre-step one. **The caller supplies the redex path**, exactly as it supplies budgets, and PR 3's renderer is where that policy gets decided.

- [ ] **Step 1: Write the failing contract tests**

Create `crates/redextape-core/tests/viewmodel_contract.rs`:

```rust
//! The data contract PR 3 renders. These are properties of the builders, not of any renderer.

use redextape_core::viewmodel::{LambdaState, TmProgram, TmState};

#[test]
fn the_byte_budget_is_honoured_and_truncation_is_reported_exactly() {
    let (term, map) = lambda_fixture("let xs = [0..200); head(xs)");
    let mut cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);

    let generous = LambdaState::render(&cursor, &map, None, usize::MAX);
    assert!(!generous.truncated);

    let tight = LambdaState::render(&cursor, &map, None, 64);
    assert!(tight.truncated, "a 64-byte budget must fire on a term printing {} bytes", generous.text.len());
    assert!(tight.text.len() < generous.text.len());
    assert!(tight.spans.iter().all(|(s, _)| s.end <= tight.text.len()), "spans must stay in the text");

    cursor.next();
    let stepped = LambdaState::render(&cursor, &map, None, usize::MAX);
    assert_eq!(stepped.step, 1, "step must track the cursor");
}

#[test]
fn a_supplied_redex_resolves_to_the_node_that_owns_it() {
    let (term, map) = lambda_fixture("let x = 40; x + 2");
    let mut cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);
    let Some(redextape_core::trace::StepEvent::Beta { redex }) = cursor.next() else {
        panic!("this program takes at least one beta step");
    };
    let with = LambdaState::render(&cursor, &map, Some(&redex), usize::MAX);
    let without = LambdaState::render(&cursor, &map, None, usize::MAX);
    assert!(with.source_node.is_some(), "a supplied redex must resolve to some owning node");
    assert_eq!(without.source_node, None, "no redex in, no node out");
}

#[test]
fn the_window_is_bounded_by_its_radius_and_clamped_at_tape_ends() {
    let (machine, init) = tm_fixture("let x = 40; x + 2");
    let mut cursor = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());
    cursor.by_ref().take(50).count();

    for radius in [0usize, 1, 8] {
        let st = TmState::window(&cursor, radius);
        assert_eq!(st.window.len(), machine.tapes, "one window per tape");
        for w in &st.window {
            assert!(w.len() <= 2 * radius + 1, "radius {radius} yielded {} cells", w.len());
        }
        assert_eq!(st.heads.len(), machine.tapes);
    }
}

#[test]
fn tm_program_projects_the_machine_and_agrees_with_its_alphabet() {
    let (machine, _) = tm_fixture("let x = 40; x + 2");
    let p = TmProgram::of(&machine, 64);
    assert_eq!(p.states.len(), machine.states.len());
    assert_eq!(p.tapes, machine.tapes);
    assert_eq!(p.width, 64);
    assert_eq!(p.alphabet, machine.alphabet(), "the projection must not re-derive the alphabet");
}

#[test]
fn the_ast_returns_none_over_budget_rather_than_a_partial_tree() {
    let (term, map) = lambda_fixture("let xs = [0..200); head(xs)");
    let cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);
    let _ = &map;
    assert!(LambdaState::ast(&cursor, 4).is_none(), "a 4-node budget must refuse, not truncate");
    assert!(LambdaState::ast(&cursor, usize::MAX).is_some(), "an unreachable budget must succeed");
}
```

Write the three fixtures at the bottom of the file. `tests/common/mod.rs` exposes `core_of(src) -> Core`, which is not enough here — `lambda_fixture` needs the `Program` so it can call `build_from_program` and get a map carrying its source leg, and `tm_fixture` needs a lowered `Machine` plus initial tapes:

```rust
mod common;

fn lambda_fixture(src: &str) -> (redextape_core::lambda::LambdaTerm, redextape_core::sourcemap::SourceMap) {
    let (program, _) = redextape_core::parser::parse(src);
    let program = program.expect("fixture parses");
    let enc = redextape_core::tm::encoding::Unary::at(64);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &enc);
    (redextape_core::lambda::lower(&core).expect("fixture lowers"), map)
}
```

`tm_fixture` and `tm_caps` mirror `trace_equivalence.rs`'s `machine_and_init` and its `TM_DEFAULT_CAPS` — read that file and follow the same lowering path rather than inventing a second one. Integration tests are separate crates, so it cannot be imported; copying the four-line body is correct here, and note in a comment that it is deliberately the same path.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo nextest run -p redextape-core --test viewmodel_contract`

Expected: FAIL to compile — `unresolved import redextape_core::viewmodel`.

- [ ] **Step 3: Create the module**

Create `crates/redextape-core/src/viewmodel.rs`:

```rust
//! The data contract a renderer consumes (§9.1). Types plus budget-parameterized builders — and the
//! budgets are PARAMETERS, never constants in this file.
//!
//! CORE NEVER PICKS A NUMBER. A window radius and a truncation threshold are renderer policy: how much
//! tape fits on screen and how much text a pane will hold are facts about the pane, not about the
//! machine. A library that hardcodes them stops being reusable by the second consumer, and there are
//! already two more coming — Plan 6's CLI and the terminal-visualization track.
//!
//! THE MACHINE CROSSES ONCE, NOT PER STEP. §9.1 puts the machine inside `TmState`; the `map` demo is
//! 3,203 states and 344,999 steps, so that would re-send 3,203 states 344,999 times. `TmProgram` is
//! built once per compile and `TmState` carries a bounded window instead — the same reasoning that made
//! `trace.rs` refuse to materialize tapes per step (3,488 bytes/step, 592.9 MB for `sum(5)`).

use std::borrow::Borrow;

use crate::analysis::TokenClass;
use crate::core::NodeId;
use crate::lambda::{Dir, LambdaTerm, Path, print_lambda_capped};
use crate::sourcemap::SourceMap;
use crate::span::Span;
use crate::tm::machine::{Machine, StateId, Symbol};
use crate::trace::{LambdaCursor, TmCursor};

/// NO `redex` FIELD, DELIBERATELY — see the note below the struct.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LambdaState {
    pub text: String,
    pub spans: Vec<(Span, TokenClass)>,
    pub truncated: bool,
    pub step: u64,
    pub source_node: Option<NodeId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StateView {
    pub name: String,
    pub accept: bool,
    pub rules: Vec<RuleView>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuleView {
    pub read: Vec<Option<Symbol>>,
    pub write: Vec<Option<Symbol>>,
    pub moves: Vec<String>,
    pub next: StateId,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TmProgram {
    pub states: Vec<StateView>,
    pub alphabet: Vec<Symbol>,
    pub tapes: usize,
    pub width: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TmState {
    pub state: StateId,
    pub step: u64,
    pub heads: Vec<i64>,
    pub window: Vec<Vec<Symbol>>,
    pub source_node: Option<NodeId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TermNode {
    Var(u32),
    Abs(String, Box<TermNode>),
    App(Box<TermNode>, Box<TermNode>),
}
```

**Why `LambdaState` has no `redex` field, decided before implementation began.** §4.2 lists one, and
nothing in this PR can fill it: `redex` would be a span in the PRINTED TEXT, while a `Beta` event
carries a `Path` in the TERM, and correlating the two means the printer recording where a given path
lands as it walks — real work in `print_lambda_capped`, touching every recursive arm of `write_term`.

Shipping the field as a structural `None` would be the exact defect that justified building the source
leg in the first place: a consumer cannot distinguish "no redex here" from "not implemented", and this
repository has a recorded habit of catching dead contract. **The field is omitted until something can
populate it**, which is the same call the spec already made for `TmState.source_node`. Adding it in PR
3 is not a breaking change, because nothing consumes these types yet.

§6.1's `current redex ►hi◄` is therefore a PR 3 deliverable, and it needs the printer change above —
whoever picks it up should price that, not assume the span is already available.

Then the builders. `render` takes the redex from the caller — see the Gap B note above:

```rust
impl LambdaState {
    /// Render the term the cursor currently holds, bounded by `byte_budget`.
    ///
    /// THE REDEX IS AN ARGUMENT, NOT SOMETHING THIS FUNCTION KNOWS. `LambdaCursor::term()` is the term
    /// AFTER the last emitted event, while that event's `Beta { redex }` path indexes the term BEFORE
    /// it — so "the redex" is genuinely ambiguous here, and which one a pane should highlight is the
    /// renderer's decision, like the budget. Pass the path from the event you just received, or `None`.
    pub fn render(c: &LambdaCursor, map: &SourceMap, redex: Option<&Path>, byte_budget: usize) -> LambdaState {
        let (text, spans, truncated) = print_lambda_capped(c.term(), byte_budget);
        let source_node = redex.and_then(|p| owning_node(map, p));
        LambdaState { text, spans, truncated, step: c.steps_taken(), source_node }
    }

    /// The term as a tree, or `None` if it exceeds `node_budget`.
    ///
    /// `None` RATHER THAN A PARTIAL TREE. Truncated text is visibly truncated; a truncated AST is a lie
    /// about the term's shape. The count happens during the walk for the same reason the printer's
    /// budget does — building the tree and then measuring it defeats the purpose.
    pub fn ast(c: &LambdaCursor, node_budget: usize) -> Option<TermNode> {
        let mut budget = node_budget;
        to_tree(c.term(), &mut Vec::new(), &mut budget)
    }
}
```

`owning_node(map, path)` is the longest-prefix match: the `NodeId` whose `node_to_lambda` path is the longest prefix of `path`. Write it as a small private fn with a doc comment saying why longest-prefix is the right relation — a redex sits *inside* the subterm a construct lowered to, so the deepest construct containing it is the one that owns it.

`to_tree` walks the term decrementing `budget`, returning `None` the moment it would go below zero. `TmProgram::of` projects `Machine` (using `machine.alphabet()` rather than re-deriving it), and `TmState::window` reads `c.tapes()` and `c.state()` and slices `2*radius+1` cells around each head, clamped at the ends.

`TmState::window` sets `source_node` via the machine's state name and `map.tm_owner(name)` — but note `window` as specced takes no map, so **leave `source_node: None` in this task and add a `window_with_map` variant only if Task 5's tests require it**. Do not widen the signature speculatively.

- [ ] **Step 4: Register the module**

In `crates/redextape-core/src/lib.rs`, add `pub mod viewmodel;` in alphabetical position (after `pub mod value;`).

- [ ] **Step 5: Run the tests**

Run: `cargo nextest run -p redextape-core --test viewmodel_contract`

Expected: PASS, all five.

Run: `cargo clippy -p redextape-core --all-targets -- -D warnings`

Expected: clean. Watch for `unwrap_used` — the no-panic lints apply to this module.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/viewmodel.rs crates/redextape-core/src/lib.rs crates/redextape-core/tests/viewmodel_contract.rs
git commit -m "viewmodel: the data contract a renderer consumes, with budgets as parameters

Section 9.1's view models, in core rather than the WASM crate, because there is
a second consumer: Plan 6's CLI wants them for a trace dump and cannot depend on
a cdylib. Putting them in the WASM crate would have the CLI reimplementing the
projections, and two copies drift.

Core never picks a number. A window radius and a truncation threshold are facts
about a pane, not about the machine, so they are arguments.

The machine crosses once. Section 9.1 puts it inside the per-step TmState; the
map demo is 3,203 states over 344,999 steps, so TmProgram is built per compile
and TmState carries a bounded window — the same reasoning trace.rs used to
refuse materializing tapes per step.

render takes the redex path as an argument rather than deriving it: term() is
the post-step term while a Beta event's path indexes the pre-step one, so which
redex a pane highlights is a renderer decision. ast returns None over budget
rather than a partial tree, because truncated text is visibly truncated and a
truncated AST is a lie about the term's shape."
```

---

### Task 6: The optional `serde` feature

**Files:**
- Modify: `crates/redextape-core/Cargo.toml` — optional dependency and `[features]`
- Modify: `crates/redextape-core/src/span.rs` — one `cfg_attr`
- Modify: `crates/redextape-core/src/analysis.rs` — one `cfg_attr`
- Modify: `crates/redextape-core/src/viewmodel.rs` — `cfg_attr` on the six types
- Modify: `scripts/check-all.sh` — a leg covering the feature
- Test: `crates/redextape-core/tests/viewmodel_contract.rs`

**Interfaces:**
- Consumes: Task 5's types.
- Produces: `redextape-core` with a `serde` feature, default off. PR 3's `redextape-wasm` enables it.

**Why the footprint is two lines outside the module:** the ids are aliases — `NodeId = u32`, `StateId = u32`, `Symbol = char` — so only `Span` and `TokenClass` are real types needing a derive. `Machine`/`State`/`Rule` are untouched because `TmProgram` projects rather than re-exports.

- [ ] **Step 1: Write the failing round-trip test**

Add to `crates/redextape-core/tests/viewmodel_contract.rs`:

```rust
/// §10.4's stated outcome: the view models serialize and round-trip. Feature-gated, because serde is
/// optional and default-off — this test does not exist in a default build.
#[cfg(feature = "serde")]
#[test]
fn every_view_model_round_trips_through_json() {
    let (term, map) = lambda_fixture("let x = 40; x + 2");
    let cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);
    let ls = LambdaState::render(&cursor, &map, None, usize::MAX);
    let back: LambdaState = serde_json::from_str(&serde_json::to_string(&ls).expect("serialize"))
        .expect("deserialize");
    assert_eq!(ls, back);

    let (machine, init) = tm_fixture("let x = 40; x + 2");
    let p = TmProgram::of(&machine, 64);
    let back: TmProgram = serde_json::from_str(&serde_json::to_string(&p).expect("serialize"))
        .expect("deserialize");
    assert_eq!(p, back);

    let mut c = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());
    c.by_ref().take(20).count();
    let ts = TmState::window(&c, 8);
    let back: TmState = serde_json::from_str(&serde_json::to_string(&ts).expect("serialize"))
        .expect("deserialize");
    assert_eq!(ts, back);
}
```

`serde_json` goes in `[dev-dependencies]`, not `[dependencies]` — it is test-only.

- [ ] **Step 2: Run to verify it fails**

Run: `cargo nextest run -p redextape-core --features serde --test viewmodel_contract round_trips`

Expected: FAIL — `none of the selected packages contains these features: serde`.

- [ ] **Step 3: Add the feature**

In `crates/redextape-core/Cargo.toml`:

```toml
[dependencies]
# THE CRATE'S FIRST DEPENDENCY, AND IT IS OPTIONAL ON PURPOSE. `redextape-core` must build for wasm32,
# which `scripts/check-all.sh`'s wasm leg now checks on every gate run — serde builds for wasm32, so it
# is admissible under the rule that gate replaced ("dependencies are admissible; the gate decides",
# PR #10). Optional and default-off keeps `cargo tree -p redextape-core --edges normal` listing only
# this crate in a default build, which is no longer the guarantee but costs nothing to keep true.
#
# It is here rather than in a wrapper crate because §9.1's view models are CORE outputs and there is a
# second consumer coming: Plan 6's CLI wants them and cannot depend on a cdylib.
serde = { version = "1", features = ["derive"], optional = true }

[features]
serde = ["dep:serde"]
```

Add `serde_json = "1"` to `[dev-dependencies]`.

- [ ] **Step 4: Add the derives**

`crates/redextape-core/src/span.rs`, on `Span`:

```rust
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
```

`crates/redextape-core/src/analysis.rs`, on `TokenClass`: the same line.

`crates/redextape-core/src/viewmodel.rs`, the same line on `LambdaState`, `StateView`, `RuleView`, `TmProgram`, `TmState` and `TermNode`.

- [ ] **Step 5: Verify both feature configurations**

Run: `cargo nextest run -p redextape-core --features serde --test viewmodel_contract`

Expected: PASS, including the round-trip.

Run: `cargo tree -p redextape-core --edges normal`

Expected: `redextape-core v0.0.0 (...)` and nothing else — the default build has no dependency.

Run: `cargo tree -p redextape-core --features serde --edges normal`

Expected: `serde` appears. This is what proves the feature actually wires up rather than being dead config.

Run: `cargo check --target wasm32-unknown-unknown -p redextape-core --lib --features serde`

Expected: clean. The gate covers the default build; this checks the configuration PR 3 will actually use.

- [ ] **Step 6: Add a gate leg for the feature**

The wasm leg and the `--workspace` legs both build core with default features, so nothing in the gate would catch a `serde`-only compile error. Add one row to `LEGS` in `scripts/check-all.sh`, immediately after `"base|test|--workspace"`:

```bash
  "base|test|-p redextape-core --features serde"
```

No new kind is needed — `test` already dispatches, and `test_cfg` pairs nextest with `cargo test --doc` at the same flags, which is the pairing that file's comment says to preserve when adding a leg.

Run: `scripts/check-all.sh --list`

Expected: the new row appears in the base tier.

- [ ] **Step 7: Run the full gate**

Run: `scripts/check-all.sh --no-llvm`

Expected: `base configs green`.

Run: `cargo llvm-cov nextest --workspace --fail-under-lines 80`

Expected: PASS. Note this measures the DEFAULT feature set, so the `#[cfg(feature = "serde")]` test does not run and the derives are not instrumented — the figure should be close to the 95.79% baseline.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/Cargo.toml crates/redextape-core/src/span.rs crates/redextape-core/src/analysis.rs crates/redextape-core/src/viewmodel.rs crates/redextape-core/tests/viewmodel_contract.rs scripts/check-all.sh
git commit -m "core: serde as an optional feature, and a gate leg that builds it

The crate's first dependency, admissible because PR #10 replaced 'keep
[dependencies] empty' with a wasm32 build gate that checks the property the rule
proxied. serde builds for wasm32, so the gate has nothing to say about it.

Optional and default-off, so cargo tree --edges normal still lists only this
crate in a default build — no longer the guarantee, but free to keep true.

The footprint outside viewmodel.rs is two cfg_attr lines. The ids are aliases
(NodeId = u32, StateId = u32, Symbol = char), so only Span and TokenClass are
real types needing a derive, and Machine/State/Rule are untouched because
TmProgram projects rather than re-exports them.

A gate leg builds and tests the feature. Without it neither the wasm leg nor the
--workspace pair would touch this configuration, and a serde-only compile error
would reach PR 3 instead of this PR."
```

---

## Self-Review

**Spec coverage.** §3.1 → Task 4. §3.2 → Task 4. §3.3 → Task 2. §3.4 → Task 1. §3.5 → Task 3. §3.6 → Task 6. §4.1 (placement) → Task 5's module doc and Task 6's manifest comment. §4.2 (types) → Task 5. §4.3 (budget-parameterized builders) → Task 5. §4.4 (why text, why the budget is not optional) → Tasks 3 and 5. §4.5 (why the machine is split out) → Task 5's `TmProgram`/`TmState` split. §10's PR-2 scope list is exactly Tasks 1–6.

**Deliberately out of scope**, traceable rather than dropped: §4.6's width-fitting cost is a PR 3 concern — nothing here fits a width. §5 (`crates/redextape-wasm`) and §6 (`web/`, pnpm) are PR 3. `TmState::window`'s `source_node` is left `None` (Task 5 Step 3) because populating it needs a map the specced signature does not take; PR 3 decides whether to widen it, and the field exists so that is not a breaking change.

**Placeholder scan.** No "TBD", "similar to Task N", or "add error handling". Every step that changes code shows the code. Three steps deliberately say "check the existing helper before writing a new one" rather than pasting a helper — that is an instruction to avoid the `core_of`-defined-four-times pattern the roadmap records, not a placeholder.

**Type consistency.** `print_lambda_capped(t, byte_budget) -> (String, Classified, bool)` is identical in Tasks 3 and 5. `LambdaState::render(c, map, redex, byte_budget)` is identical in Task 5's implementation and both Task 5 and Task 6 tests. `raise_cap` is `(extra_steps)` on `LambdaCursor` and `(extra_steps, extra_cells)` on `TmCursor` in Task 2's tests, implementation, and doc comments. `TmCursor<M: Borrow<Machine>>` is the same bound in Tasks 1, 2 and 5. `build_from_program(&Program, &dyn Encoding) -> (Core, SourceMap)` matches between Task 4's implementation, its test, and Task 5's fixtures.

**One risk worth naming.** Task 4 threads a span parameter through every lowering helper in a 893-line file. If the threading attributes a span to the wrong construct the tests here will still pass — they check that every node HAS an in-bounds span, not that it has the RIGHT one. A wrong-but-plausible attribution surfaces only when PR 3's source pane highlights the wrong text. Task 4's test could be strengthened with a hand-checked fixture asserting specific `(node, span)` pairs on a small program; that is left to the implementer's judgment if the threading turns out to be non-obvious, and flagged here so a reviewer knows the coverage boundary.
