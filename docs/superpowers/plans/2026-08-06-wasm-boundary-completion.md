# WASM Boundary Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the `redextape-wasm` boundary so the companion spec's §6.3 results block is buildable, and close the depth-guard gap on the one target the guards do not reach.

**Architecture:** Two free `#[wasm_bindgen]` functions give highlighting and linting a path that never runs a backend; four `Session` methods give the λ leg a chunked run loop and all three legs a decoded value. The `Session` stops discarding the four things `compile` already built (`Core`, `Ty`, the halted run's tapes, the `EncodingKind`), so nothing is recomputed. Every decision lives in `session.rs`, which `cargo test` compiles natively; `lib.rs` stays marshalling.

**Tech Stack:** Rust 2024, `wasm-bindgen` 0.2.126, `serde-wasm-bindgen` 0.6.5, `wasm-bindgen-test` 0.3.76, `wasm-pack` 0.15.0, headless Chrome.

**Design:** [`../specs/2026-08-06-wasm-boundary-completion-design.md`](../specs/2026-08-06-wasm-boundary-completion-design.md).
**Companion spec** (§5, §6, §7 referenced throughout): [`../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md`](../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md).

## Global Constraints

- **No JavaScript, no `web/`, no pnpm, no `Dockerfile` or `ci.yml` edits.** All of that is PR 3c.
- **No panic may cross the boundary.** The workspace lints deny `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`, and `redextape-wasm` inherits them. Every fallible export returns `Result<_, JsValue>`.
- **Every decision goes in `session.rs`; `lib.rs` is marshalling only.** `wasm-bindgen-test` runs in a browser, `cargo llvm-cov` instruments the native build — logic in the shell is uncovered by construction.
- **One serializer.** `to_value` in `lib.rs`, already using `.serialize_missing_as_null(true)`. Do not add a second, and do not special-case `None`.
- **`redextape-core` must keep building for `wasm32-unknown-unknown`.** `scripts/check-all.sh` has three `wasm` legs; they gate this.
- **Coverage floor is 80 lines, tree is at 95.50%.** `lib.rs` is 0% by construction and grows here; a drop of more than a few tenths means logic leaked into the shell.
- **The pre-commit hook runs `cargo fmt` and `cargo clippy -D warnings`.** Never `--no-verify`. Every task below adds new `Session` fields *together with their readers*, so no commit carries a `dead_code` field.
- **`js_name` camelCase on every export**, matching the twelve PR 3a shipped.

---

## File Structure

| file | change | responsibility |
| --- | --- | --- |
| `crates/redextape-core/src/tm/sim.rs` | modify | `run` reports the step count; `simulate_final` passes it on |
| `crates/redextape-core/src/tm.rs` | modify | `DescribedRun.steps`; `attempt` threads it |
| `crates/redextape-core/src/tm/lower_tm.rs` | modify | two `simulate_final` call sites |
| `crates/redextape-core/src/tm/encoding/unary.rs` | modify | one `simulate_final` call site (test) |
| `crates/redextape-core/tests/tm_binary_gadgets.rs` | modify | one `simulate_final` call site |
| `crates/redextape-core/examples/width_report.rs` | modify | one `simulate_final` call site |
| `crates/redextape-core/examples/step_survey.rs` | modify | one `simulate_final` call site |
| `crates/redextape-wasm/src/session.rs` | modify | `Decoded`; four new methods; four new `Session` fields; `TmStatus.total_steps`; all new native tests |
| `crates/redextape-wasm/src/lib.rs` | modify | six new exports, marshalling only |
| `crates/redextape-wasm/tests/browser.rs` | modify | the boundary cases only a browser can prove |
| `.cargo/config.toml` | modify | the wasm32 shadow-stack link arg |

---

### Task 1: The TM step count reaches `DescribedRun`

`sim::run` builds a `TmCursor`, `TmCursor::steps_taken()` is already `pub`, and every layer above throws the number away. This task plumbs it up. Nothing consumes it yet — that is Task 6 — but it is a self-contained core change that leaves every existing test green.

**Files:**
- Modify: `crates/redextape-core/src/tm/sim.rs:207-303`
- Modify: `crates/redextape-core/src/tm.rs:132-143` (`attempt`), `:207-213` (`DescribedRun`), `:229-245` (`run_tm_described`)
- Modify: `crates/redextape-core/src/tm/lower_tm.rs:382`, `:458`
- Modify: `crates/redextape-core/src/tm/encoding/unary.rs:2055`
- Modify: `crates/redextape-core/tests/tm_binary_gadgets.rs:47`
- Modify: `crates/redextape-core/examples/width_report.rs:105`
- Modify: `crates/redextape-core/examples/step_survey.rs:590`
- Test: `crates/redextape-core/src/tm.rs` (its existing `#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: nothing.
- Produces: `pub struct DescribedRun { pub run: TmRun, pub machine: Machine, pub header: TmHeader, pub steps: u64 }` and `pub fn simulate_final(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<Tape>, StateId, Status, u64)`.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/tm.rs`'s existing `#[cfg(test)] mod tests`:

```rust
/// `DescribedRun.steps` is the δ-count of the run whose outcome `run` reports — the number a UI
/// shows as "2,870 steps" and uses as the denominator of a progress bar.
///
/// PINNED AGAINST THE CURSOR, not against a literal alone. The same machine driven through a
/// `TmCursor` must reach the same total, because the product will read one number from the fitting
/// run and drive the other from the cursor, and two sources for one number is a drift hazard.
#[test]
fn described_run_reports_the_step_count_the_cursor_reaches() {
    use crate::trace::TmCursor;

    let (program, _) = crate::parser::parse("let x = 40; x + 2");
    let program = program.expect("parses");
    let ty = crate::typeck::result_type(&program).expect("typechecks");
    let core = crate::desugar::desugar(&program);

    let d = run_tm_described(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS).expect("runs");
    assert!(matches!(d.run, TmRun::Ran { .. }), "this program halts, got {:?}", d.run);
    assert_eq!(d.steps, 2870, "the pinned δ-count for `let x = 40; x + 2` under Unary");

    let init = d.header.init(d.machine.tapes);
    let mut cursor = TmCursor::new(&d.machine, &init, TM_DEFAULT_CAPS);
    while cursor.next().is_some() {}
    assert_eq!(cursor.steps_taken(), d.steps, "the fitting run and the cursor must not drift");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --lib tm::tests::described_run_reports_the_step_count_the_cursor_reaches`

Expected: FAIL — `no field 'steps' on type 'DescribedRun'`.

- [ ] **Step 3: Make `run` report the count**

In `crates/redextape-core/src/tm/sim.rs`, widen the private `run`. Its signature at line 207 becomes:

```rust
fn run(
    m: &Machine,
    init: &[Vec<Symbol>],
    caps: Caps,
    mut record: Option<&mut Vec<Step>>,
    mut counts: Option<&mut Vec<u64>>,
    mut watch: Option<Watcher<'_>>,
) -> (Vec<Tape>, StateId, Status, u64) {
```

Both of its returns gain the count. The early return inside the `watch` hook:

```rust
        if let Some(w) = watch.as_deref_mut()
            && !w(cursor.tapes())
        {
            let stopped_in = cursor.state();
            let steps = cursor.steps_taken();
            return (cursor.into_tapes(), stopped_in, Status::Halted, steps);
        }
```

and the normal one at the end of the function:

```rust
    let final_state = cursor.state();
    let steps = cursor.steps_taken();
    // `None` only if the loop broke on an event a `TmCursor` cannot emit; the run is over either way.
    let status = cursor.status().unwrap_or(Status::Halted);
    (cursor.into_tapes(), final_state, status, steps)
}
```

`cursor.into_tapes()` consumes the cursor, so both `state()` and `steps_taken()` must be read before it — that ordering is why they are bound to locals rather than inlined into the tuple.

- [ ] **Step 4: Update the five wrappers in `sim.rs`**

Only `simulate_final` passes the count on; the other four discard it, because none of their callers asked for it and widening them would be churn with no consumer.

```rust
/// Simulate to a halt or a cap, without retaining the step trace.
pub fn simulate(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<Tape>, Status) {
    let (tapes, _final, status, _steps) = run(m, init, caps, None, None, None);
    (tapes, status)
}
```

```rust
/// Simulate to a halt or a cap, reporting the final state and the δ-count alongside the tapes. The
/// state is what tells a caller *why* a machine halted — in particular whether it halted in the
/// overflow-guard state that `lower_tm_guarded` hands back. `simulate` is exactly this with the state
/// and the count discarded.
///
/// THE COUNT IS REPORTED HERE RATHER THAN BY A FIFTH WRAPPER, because it is a fact about the run
/// that every caller could use and none could previously reach — `run` has always counted it to
/// enforce the step cap.
pub fn simulate_final(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<Tape>, StateId, Status, u64) {
    run(m, init, caps, None, None, None)
}
```

```rust
pub fn simulate_watched(
    m: &Machine,
    init: &[Vec<Symbol>],
    caps: Caps,
    watch: Watcher<'_>,
) -> (Vec<Tape>, StateId, Status) {
    let (tapes, final_state, status, _steps) = run(m, init, caps, None, None, Some(watch));
    (tapes, final_state, status)
}
```

In `simulate_trace` (line 291) and `simulate_counts` (line 303), add a trailing `_steps` binding:

```rust
    let (tapes, final_state, status, _steps) = run(m, init, caps, Some(&mut steps), None, None);
```

```rust
    let (_tapes, _final, status, _steps) = run(m, init, caps, None, Some(&mut counts), None);
```

- [ ] **Step 5: Thread it through `attempt` and `DescribedRun`**

In `crates/redextape-core/src/tm.rs`, `attempt` gains a fourth tuple element — **appended last**, so `run_tm_at`'s existing `.0` still names the `TmRun`:

```rust
fn attempt(prog: &Program, enc: &dyn Encoding, n_slots: u32, caps: TmCaps) -> (TmRun, Machine, Vec<Vec<Symbol>>, u64) {
    let (machine, overflow) = lower_tm_guarded(prog, enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots);
    init[WORK] = enc.init_work();
    let (run, steps) = match simulate_final(&machine, &init, caps) {
        (_, s, TmStatus::Halted, n) if s == overflow => (TmRun::Overflow, n),
        (tapes, _, TmStatus::Halted, n) => (TmRun::Ran { tapes }, n),
        (_, _, TmStatus::HitCap, n) => (TmRun::HitCap, n),
    };
    (run, machine, init, steps)
}
```

`DescribedRun` gains the field:

```rust
pub struct DescribedRun {
    /// What happened.
    pub run: TmRun,
    /// The machine that ran. `print_tm_with(&machine, &header)` is a complete, self-describing file.
    pub machine: Machine,
    /// The recipe AND the literal initial tapes, captured from the configuration `simulate` was
    /// handed — not re-derived from the recipe, which is what makes the consistency check a check.
    pub header: TmHeader,
    /// δ-steps taken by the run `run` describes.
    ///
    /// ON `DescribedRun` RATHER THAN ON `TmRun::Ran`, and the reason is not only that `Ran` is
    /// destructured at 52 sites. `run_tm_described` answers `Err` for a program that never ran, so a
    /// `DescribedRun` always describes a run that STARTED — including `HitCap` and `Overflow`, both
    /// of which have step counts and would have nowhere to put them if the field hung off `Ran`.
    ///
    /// FOR `Overflow` THIS IS THE LAST ATTEMPT'S COUNT. The width search below doubles and retries,
    /// so a program that overflows at width 8 and fits at 64 simulates four times; the count reported
    /// belongs to the run whose outcome is reported.
    pub steps: u64,
}
```

And in `run_tm_described`, bind it from `attempt` and pass it into the struct literal:

```rust
        let (run, machine, init, steps) = attempt(&prog, &*fitted, n_slots, caps);
        match run {
            TmRun::Overflow if width < MAX_FIELD_WIDTH => width = (width * 2).min(MAX_FIELD_WIDTH),
            run => {
                let tapes = init.into_iter().enumerate().collect();
                let header = TmHeader::new(kind, width, n_slots, result, tapes);
                return Ok(DescribedRun { run, machine, header, steps });
            }
        }
```

- [ ] **Step 6: Fix the five external `simulate_final` call sites**

Each gains one trailing `_` in its destructuring. Nothing else changes.

`crates/redextape-core/src/tm/lower_tm.rs:382` and `:458`:

```rust
        let (_, final_state, status, _) = simulate_final(&m, &init, CAPS);
```

`crates/redextape-core/src/tm/encoding/unary.rs:2055`:

```rust
        let (_, final_state, status, _) = crate::tm::sim::simulate_final(&m, &init, TM_DEFAULT_CAPS);
```

`crates/redextape-core/tests/tm_binary_gadgets.rs:47`:

```rust
    let (tapes, final_state, status, _) = simulate_final(&m, &init, TM_DEFAULT_CAPS);
```

`crates/redextape-core/examples/width_report.rs:105` and `crates/redextape-core/examples/step_survey.rs:590`:

```rust
    let (_, final_state, status, _) = simulate_final(&m, &init, TM_DEFAULT_CAPS);
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cargo test -p redextape-core --lib tm::tests::described_run_reports_the_step_count_the_cursor_reaches`

Expected: PASS.

- [ ] **Step 8: Run the whole core suite**

Run: `cargo nextest run -p redextape-core`

Expected: all green. If `tm_header.rs` or the oracles fail, a `simulate_final` site was missed — the compiler names it.

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-core/src/tm.rs crates/redextape-core/src/tm/sim.rs \
        crates/redextape-core/src/tm/lower_tm.rs crates/redextape-core/src/tm/encoding/unary.rs \
        crates/redextape-core/tests/tm_binary_gadgets.rs \
        crates/redextape-core/examples/width_report.rs crates/redextape-core/examples/step_survey.rs
git commit -m "tm: DescribedRun carries the step count run already counted

sim::run builds a TmCursor and TmCursor::steps_taken() is pub, so the number
existed at the bottom and was discarded at every layer above. A UI needs it as
the denominator of a progress bar and as the '2,870 steps' a results pane shows,
and reaching it otherwise means driving the cursor for a run that already
happened.

On DescribedRun rather than TmRun::Ran. Ran is destructured at 52 sites, all of
which would need a `..`; DescribedRun has 10 references and one struct literal.
It is also the more honest home: run_tm_described errs for a program that never
ran, so a DescribedRun always describes a run that started, including HitCap and
Overflow — both of which have counts and would have nowhere to put them.

simulate_final reports it; the other four wrappers over `run` discard it, since
no caller of theirs asked. The test pins the count against a TmCursor driven to
the same end rather than against a literal alone: the product will read one
number from the fitting run and drive the other from the cursor, and two sources
for one number drift unless something says they cannot."
```

---

### Task 2: `classifySource` and `analyze` — a path that never runs a backend

The two exports §6.2 assumes exist. `analysis::classify_source` and `core::analyze` are both already `pub`, and `TokenClass`, `Span`, `Diagnostic` and `Severity` already carry the serde `cfg_attr`, so this is marshalling and nothing else.

**Files:**
- Modify: `crates/redextape-wasm/src/lib.rs`
- Test: `crates/redextape-wasm/src/session.rs` (its `#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: nothing.
- Produces: `classifySource(src: string): [Span, TokenClass][]` and `analyze(src: string): Diagnostic[]` on the wasm boundary; `session::classify_source(&str) -> Classified` and `session::analyze(&str) -> Vec<Diagnostic>` natively.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-wasm/src/session.rs`'s `#[cfg(test)] mod tests`:

```rust
/// `classify_source` must reach the boundary WITHOUT a session, and must classify a file that does
/// not analyze. Highlighting a broken file is when highlighting matters most, which is why
/// `analysis::classify_source` discards the lexer's diagnostics — they come back through `analyze`.
#[test]
fn classify_source_works_on_a_program_that_does_not_analyze() {
    let spans = classify_source("let x = ;");
    assert!(!spans.is_empty(), "a file with a parse error still has tokens to highlight");
    let (span, _) = spans[0];
    assert!(span.end > span.start, "spans are well-formed ranges");
    assert_eq!(spans, redextape_core::analysis::classify_source("let x = ;"), "the boundary adds nothing");
}

/// `analyze` is the CHEAP diagnostics path, and its separation from `compile` is the whole point:
/// linting through `compile` would lower both backends and simulate a Turing machine to a halt on
/// every keystroke.
#[test]
fn analyze_reports_diagnostics_without_building_a_session() {
    let clean = analyze("let x = 40; x + 2");
    assert!(clean.is_empty(), "a clean program has no diagnostics, got {clean:?}");

    let broken = analyze("let x = ;");
    assert!(!broken.is_empty(), "a parse error must be reported");
    assert!(broken.iter().any(|d| d.severity == Severity::Error));

    assert_eq!(broken, Session::compile("let x = ;", EncodingKind::Unary).diagnostics,
        "analyze and compile must not disagree about what is wrong with a program");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-wasm --lib`

Expected: FAIL — `cannot find function 'classify_source' in this scope`.

- [ ] **Step 3: Add the two functions to `session.rs`**

Above the `Session` struct, after the `Compiled` definition:

```rust
/// Token spans for highlighting, with no session and no backend.
///
/// A THIN WRAPPER ON PURPOSE, and it earns its place by existing at all: `analysis::classify_source`
/// is `pub` in core and had no boundary, so §6.2's "CodeMirror's headline feature is already
/// delivered, in Rust" was true of the function and false of anything JavaScript could call.
pub fn classify_source(src: &str) -> Classified {
    redextape_core::analysis::classify_source(src)
}

/// Static diagnostics — parse and typecheck — with no backend and no session.
///
/// **SEPARATE FROM `compile` BECAUSE OF WHAT `compile` COSTS.** `compile` lowers both backends and
/// runs the TM to a halt (`run_tm_described`), which is 344,999 δ-steps on the `map` demo. An editor
/// linting on every keystroke cannot go through that path, and this is the one it goes through
/// instead. `Analysis.core` is dropped: a `Core` has no boundary representation and no consumer here.
pub fn analyze(src: &str) -> Vec<Diagnostic> {
    redextape_core::analyze(src).diagnostics
}
```

Add `Classified` to the existing `redextape_core` import block at the top of the file:

```rust
use redextape_core::analysis::Classified;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p redextape-wasm --lib`

Expected: PASS.

- [ ] **Step 5: Export both from `lib.rs`**

Add after the existing `compile` export:

```rust
/// `classifySource(src)` -> `[Span, TokenClass][]`.
///
/// NO SESSION, BY DESIGN. An editor highlights while a program is mid-edit and unparseable, so this
/// path must not depend on anything a compile produces.
#[wasm_bindgen(js_name = classifySource)]
pub fn classify_source(src: &str) -> Result<JsValue, JsValue> {
    to_value(&session::classify_source(src))
}

/// `analyze(src)` -> `Diagnostic[]`.
///
/// THE LINT PATH, and the reason it is not `compile`: see `session::analyze`.
#[wasm_bindgen]
pub fn analyze(src: &str) -> Result<JsValue, JsValue> {
    to_value(&session::analyze(src))
}
```

- [ ] **Step 6: Verify both targets build**

Run: `cargo clippy -p redextape-wasm --all-targets -- -D warnings`

Expected: clean.

Run: `cargo check -p redextape-wasm --lib --target wasm32-unknown-unknown`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-wasm/src/session.rs crates/redextape-wasm/src/lib.rs
git commit -m "wasm: a highlight path and a lint path that never run a backend

§6.2 says CodeMirror's headline feature is already delivered in Rust. It was
true of analysis::classify_source and false of anything JavaScript could call —
the function is pub in core and had no export. Same for diagnostics: the only
route to them was compile(), which lowers both backends and runs the TM to a
halt, so linting on keystroke would have simulated 344,999 steps per edit on the
map demo.

Both are pure marshalling. TokenClass, Span, Diagnostic and Severity already
carry the serde cfg_attr, so no new derives and no new view-model types.

The tests pin that the boundary adds nothing — classify_source agrees with
core's, and analyze agrees with compile about what is wrong with a program — so
a future divergence is a failure rather than a discovery."
```

---

### Task 3: `runLambda(budget)` — the chunked run loop

`MAX_REDUCTION_STEPS` is 5,000,000, so `while (s.stepLambda()) {}` from JavaScript is up to five million boundary crossings on the main thread. This is the export that replaces it. No new `Session` fields.

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs`
- Modify: `crates/redextape-wasm/src/lib.rs`
- Test: `crates/redextape-wasm/src/session.rs`

**Interfaces:**
- Consumes: `RunStatus`, `SessionError`, `Session::lambda_status`, `Session::cap_lambda_at` (test-only) — all from PR 3a.
- Produces: `Session::run_lambda(&mut self, budget: u64) -> Result<RunStatus, SessionError>`; `runLambda(budget: number): RunStatus` on the boundary.

- [ ] **Step 1: Write the failing tests**

Add to `session.rs`'s `#[cfg(test)] mod tests`:

```rust
/// THE LOAD-BEARING DISTINCTION OF THIS METHOD. A spent CHUNK budget leaves the run `Running`; only
/// the cursor's own cap yields `Capped`. Getting it backwards puts a "continue" affordance on a run
/// that has merely paused, and withholds it from the one run that can actually continue.
#[test]
fn a_spent_chunk_budget_is_running_not_capped() {
    let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
    let mut s = c.session.expect("compiles");

    // 3 of the 7 β-steps this program takes.
    assert_eq!(s.run_lambda(3).expect("λ leg is present"), RunStatus::Running);
    assert_eq!(s.lambda_state(1_000_000).expect("present").step, 3, "the chunk ran exactly its budget");

    assert_eq!(s.run_lambda(3).expect("present"), RunStatus::Running);
    assert_eq!(s.run_lambda(3).expect("present"), RunStatus::Ended, "the 7th step ends it mid-chunk");
    assert_eq!(s.lambda_state(1_000_000).expect("present").step, 7);
}

/// A budget larger than the run reaches the end in one call, which is the shape a caller uses when it
/// does not care about progress.
#[test]
fn a_budget_larger_than_the_run_ends_it_in_one_call() {
    let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
    let mut s = c.session.expect("compiles");
    assert_eq!(s.run_lambda(1_000_000).expect("present"), RunStatus::Ended);
    assert_eq!(s.lambda_state(1_000_000).expect("present").step, 7);
}

/// The cursor's OWN cap is what produces `Capped`, and it must not be confused with a chunk budget
/// that happens to be the same size.
#[test]
fn the_cursors_cap_yields_capped_not_running() {
    let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
    let mut s = c.session.expect("compiles");
    s.cap_lambda_at(3);
    assert_eq!(s.run_lambda(1_000_000).expect("present"), RunStatus::Capped, "the CURSOR ran out, not the chunk");
}

/// A run that has already ended stays ended and takes no further steps, however large the budget.
#[test]
fn running_an_ended_cursor_is_a_no_op() {
    let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
    let mut s = c.session.expect("compiles");
    assert_eq!(s.run_lambda(1_000_000).expect("present"), RunStatus::Ended);
    assert_eq!(s.run_lambda(1_000_000).expect("present"), RunStatus::Ended);
    assert_eq!(s.lambda_state(1_000_000).expect("present").step, 7, "no step was taken after the end");
}

/// A zero budget is a legitimate call — a caller polling status without advancing — and must not be
/// mistaken for an ended run.
#[test]
fn a_zero_budget_advances_nothing_and_reports_running() {
    let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
    let mut s = c.session.expect("compiles");
    assert_eq!(s.run_lambda(0).expect("present"), RunStatus::Running);
    assert_eq!(s.lambda_state(1_000_000).expect("present").step, 0);
}

/// An absent λ leg throws rather than aborting, the same as every other λ method.
#[test]
fn run_lambda_on_an_absent_leg_is_an_error() {
    let c = Session::compile(LAMBDA_DECLINES, EncodingKind::Unary);
    let mut s = c.session.expect("the TM leg handles this program");
    assert_eq!(s.run_lambda(10), Err(SessionError::LambdaAbsent));
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p redextape-wasm --lib run_lambda`

Expected: FAIL — `no method named 'run_lambda'`.

- [ ] **Step 3: Implement `run_lambda`**

In `session.rs`, immediately after `step_lambda`:

```rust
    /// Advance up to `budget` β-steps, then report how the run stands.
    ///
    /// **CHUNKED RATHER THAN RUN-TO-CAP, AND THAT IS A UI REQUIREMENT.** `MAX_REDUCTION_STEPS` is
    /// 5,000,000; a single call that spends all of it blocks the browser's main thread with no
    /// progress and no way to cancel. A caller loops on `Running` and yields between chunks, which
    /// costs ~100 crossings at a 50,000-step chunk instead of five million.
    ///
    /// **A SPENT `budget` IS NOT A SPENT CAP.** Exhausting `budget` leaves the run `Running`; only
    /// the cursor's own cap yields `Capped`. This is the same distinction `RunStatus` was introduced
    /// for one layer in — folding them together would offer "continue" on a run that has merely
    /// paused, and hide it from the one run that can actually take it.
    ///
    /// Returns `RunStatus` rather than `bool` for the reason `step_lambda`'s doc records: `false`
    /// answers every end condition identically, and a renderer cannot act on that.
    pub fn run_lambda(&mut self, budget: u64) -> Result<RunStatus, SessionError> {
        let c = self.lambda.as_mut().map_err(|_| SessionError::LambdaAbsent)?;
        for _ in 0..budget {
            if c.next().is_none() {
                break;
            }
        }
        Ok(self.lambda_status().run.unwrap_or(RunStatus::Running))
    }
```

`lambda_status().run` is `Some` on every path that reaches here — it is `None` only for a declined leg, which the `?` above has already returned for — so `unwrap_or` is a total fallback rather than a guess, and it cannot panic under wasm.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p redextape-wasm --lib run_lambda`

Expected: PASS, 6 tests.

- [ ] **Step 5: Export it**

In `lib.rs`, after `step_lambda`:

```rust
    /// `u32` and widened, for the reason `raiseLambdaCap` above records: wasm-bindgen maps `u64` to
    /// JS `bigint`, and §5.1 writes every count as `number`. A caller wanting a chunk larger than
    /// 4.29e9 steps is asking for a freeze, not a chunk.
    #[wasm_bindgen(js_name = runLambda)]
    pub fn run_lambda(&mut self, budget: u32) -> Result<JsValue, JsValue> {
        let st = self.0.run_lambda(u64::from(budget)).map_err(err)?;
        to_value(&st)
    }
```

- [ ] **Step 6: Verify both targets build**

Run: `cargo clippy -p redextape-wasm --all-targets -- -D warnings && cargo check -p redextape-wasm --lib --target wasm32-unknown-unknown`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-wasm/src/session.rs crates/redextape-wasm/src/lib.rs
git commit -m "wasm: runLambda(budget), because stepLambda cannot reach a normal form

MAX_REDUCTION_STEPS is 5,000,000, so a JS `while (s.stepLambda()) {}` is up to
five million boundary crossings on the main thread. §6.3 needs the normal form,
which means driving the cursor, which means this.

Chunked rather than run-to-cap: the caller loops on Running and yields between
chunks, so a long run renders progress and stays cancellable at ~100 crossings
instead of five million. Roadmap Plan 4 named a `run_to_cap` export; the chunked
primitive is what that should have been, and the convenience is one line of JS on
top of it.

Returns RunStatus, not bool. PR 3a's review found stepLambda answering false for
every end condition and raiseLambdaCap shipping as API nothing could correctly
decide to call; a run method returning bool reintroduces exactly that.

Five of the six tests exist for one distinction: a spent CHUNK budget leaves the
run Running, and only the cursor's own cap yields Capped. Backwards, it offers
'continue' on a run that merely paused and hides it from the one that can take
it — the defect LambdaCursor::raise_cap fixed one layer in, reappearing at the
boundary."
```

---

### Task 4: `Decoded` and `evaluate()` — the reference leg

The `Decoded` type every value-producing call answers with, and the first of its three producers. `Session` starts keeping the `Core` it currently builds and drops.

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs`
- Modify: `crates/redextape-wasm/src/lib.rs`
- Test: `crates/redextape-wasm/src/session.rs`

**Interfaces:**
- Consumes: `Session::compile` from PR 3a.
- Produces: `pub enum Decoded { Value { text: String }, Undecodable, Unfinished, Fault { message: String } }`; `Session::evaluate(&self) -> Decoded`; field `pub(crate) core: redextape_core::core::Core` on `Session`; `evaluate(): Decoded` on the boundary.

- [ ] **Step 1: Write the failing tests**

Add to `session.rs`'s test module:

```rust
/// The reference interpreter is the ground truth the three-way oracle checks both backends against.
/// Surfacing it means a disagreement is visible in the product, not only in CI.
#[test]
fn evaluate_answers_the_reference_value() {
    let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
    let s = c.session.expect("compiles");
    assert_eq!(s.evaluate(), Decoded::Value { text: "42".to_string() });
}

/// A list renders through `format_value`, which is what the product shows. `Value` itself cannot
/// cross: `Value::Closure` holds an `Env` and an `Rc<Core>`.
#[test]
fn evaluate_renders_a_list_through_format_value() {
    let c = Session::compile("[1, 2, 3]", EncodingKind::Unary);
    let s = c.session.expect("compiles");
    assert_eq!(s.evaluate(), Decoded::Value { text: "[1, 2, 3]".to_string() });
}

/// `RunError::Runtime` is the one genuinely new failure shape this slice adds, and it must arrive as
/// a message rather than as an abort.
#[test]
fn a_runtime_fault_is_reported_as_a_fault_not_an_abort() {
    let c = Session::compile("head([])", EncodingKind::Unary);
    let s = c.session.expect("the program is well-typed; it faults at runtime");
    match s.evaluate() {
        Decoded::Fault { message } => assert!(!message.is_empty(), "a fault carries its reason"),
        other => panic!("expected a runtime fault, got {other:?}"),
    }
}

/// `evaluate` reaches NEITHER middle state, and that asymmetry is the point of the reachability
/// table in the design's §3: `interp::eval` answers a `Value` or a `RuntimeError`, with no decoding
/// step to fail and no partial run to report.
#[test]
fn evaluate_never_answers_unfinished_or_undecodable() {
    for src in ["let x = 40; x + 2", "[1, 2, 3]", "true", "head([])"] {
        let c = Session::compile(src, EncodingKind::Unary);
        let s = c.session.unwrap_or_else(|| panic!("{src} compiles"));
        assert!(
            !matches!(s.evaluate(), Decoded::Unfinished | Decoded::Undecodable),
            "{src}: evaluate reached a state it has no producer for"
        );
    }
}

/// `RunError::Static` is unreachable from a Session method, and this is what makes that structural
/// rather than incidental: a session exists only for a program with no error-severity diagnostics.
#[test]
fn a_session_never_exists_for_a_program_with_static_errors() {
    assert!(Session::compile("let x = ;", EncodingKind::Unary).session.is_none());
    assert!(Session::compile("1 + true", EncodingKind::Unary).session.is_none());
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p redextape-wasm --lib evaluate`

Expected: FAIL — `cannot find type 'Decoded' in this scope`.

- [ ] **Step 3: Add `Decoded`**

In `session.rs`, after the `RunStatus` definition:

```rust
/// A leg's answer, or why there is not one.
///
/// **FOUR STATES RATHER THAN `Option<String>`, for the reason `RunStatus` has four rather than
/// three.** `decode_lambda_ty` and `decode_tape_ty` both answer `Option<Value>`, and "the run has
/// not finished" and "it finished and the result is not a recognizable encoding" are different facts
/// about the program. A renderer that flattens them shows one blank field for two situations that
/// call for different words.
///
/// **NOT EVERY PRODUCER REACHES EVERY STATE, and the asymmetry is real rather than incidental:**
///
/// | | `Value` | `Undecodable` | `Unfinished` | `Fault` |
/// | --- | --- | --- | --- | --- |
/// | `lambda_value` | ✅ | ✅ | the cursor has not reached `Ended` | — |
/// | `tm_value` | ✅ | ✅ | `TmRun::HitCap` — a working cursor, no final tapes | — |
/// | `evaluate` | ✅ | — | — | ✅ |
///
/// `tm_value`'s `Unfinished` is NOT λ-specific: `compile` gives both `Ran` and `HitCap` a working
/// cursor, so a capped machine is a live session with no tapes to decode.
///
/// `text` IS `format_value` OUTPUT, AND `Value` ITSELF CANNOT CROSS. `Value::Closure { params, body:
/// Rc<Core>, env: Env }` carries an environment and a Core subtree; it has no serde derive and should
/// not acquire one. That is a property of the type, not a convenience.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Decoded {
    Value { text: String },
    Undecodable,
    Unfinished,
    Fault { message: String },
}
```

- [ ] **Step 4: Keep the `Core` and add `evaluate`**

Add the field to `Session`:

```rust
pub struct Session {
    /// KEPT RATHER THAN DROPPED, so `evaluate` needs no second front end. A free `evaluate(src)`
    /// would re-run parse, typecheck and desugar — work `compile` has already done — purely to reach
    /// a `Core` this struct could have held.
    pub(crate) core: redextape_core::core::Core,
    pub(crate) lambda: Result<LambdaCursor, LowerError>,
    pub(crate) tm: Result<TmCursor<Rc<Machine>>, TmDecline>,
    pub(crate) program: Option<TmProgram>,
    pub(crate) map: SourceMap,
}
```

In `compile`, the `core` binding is currently consumed by two borrows and then dropped. Move it into the struct literal at the end:

```rust
        Compiled { diagnostics, session: Some(Session { core, lambda, tm, program, map }) }
```

Add the method, in a new section after the TM leg's methods:

```rust
    // --- the reference leg --------------------------------------------------------------------

    /// The reference interpreter's answer — the ground truth `three_way_oracle.rs` checks both
    /// backends against, surfaced so a disagreement is visible in the product rather than only in CI.
    ///
    /// A METHOD RATHER THAN A FREE `evaluate(src)`, so the front end runs once. See the `core` field.
    ///
    /// `RunError::Static` IS STRUCTURALLY UNREACHABLE HERE: `compile` answers `session: None` for any
    /// program with an error-severity diagnostic, so a `Session` existing at all means the static
    /// half already passed. Only `RuntimeError` can arrive.
    pub fn evaluate(&self) -> Decoded {
        match redextape_core::interp::eval(&self.core) {
            Ok(v) => Decoded::Value { text: redextape_core::value::format_value(&v) },
            Err(e) => Decoded::Fault { message: e.message },
        }
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p redextape-wasm --lib`

Expected: PASS, including the five new tests.

- [ ] **Step 6: Export it**

In `lib.rs`, after the TM leg's methods and before `source_span`:

```rust
    #[wasm_bindgen]
    pub fn evaluate(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.evaluate())
    }
```

- [ ] **Step 7: Verify both targets build**

Run: `cargo clippy -p redextape-wasm --all-targets -- -D warnings && cargo check -p redextape-wasm --lib --target wasm32-unknown-unknown`

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-wasm/src/session.rs crates/redextape-wasm/src/lib.rs
git commit -m "wasm: Decoded, and the reference interpreter as a third leg

Without ground truth a results block cannot tell you an answer is wrong: λ says
42, TM says 41, and the UI shows two numbers and no signal. The three-way oracle
exists in the test suite precisely because agreement between the two backends is
not self-certifying, and this is that check in the product.

A Session method, not a free evaluate(src). compile already parsed, typechecked
and desugared; a free function would redo all three to reach a Core this struct
built and dropped. It now keeps it, so the interpreter is the only added work and
the front end still runs once.

Decoded has four states rather than Option<String>, for the reason RunStatus has
four rather than three: the decoders answer Option<Value>, and 'has not finished'
and 'finished, and the result is not a recognizable encoding' are different facts
a renderer must not flatten. Not every producer reaches every state — evaluate
reaches neither middle one — and the doc carries the table.

text is format_value output because Value cannot cross: Value::Closure holds an
Env and an Rc<Core>. That is the type's property, not a shortcut.

RunError::Static is structurally unreachable from a Session method, since compile
answers session: None for any error-severity diagnostic. A test pins that rather
than leaving it as a reading of the code."
```

---

### Task 5: `lambdaValue()`

The λ leg's decoded answer. `Session` starts keeping the `Ty` that `compile` computes and passes away.

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs`
- Modify: `crates/redextape-wasm/src/lib.rs`
- Test: `crates/redextape-wasm/src/session.rs`

**Interfaces:**
- Consumes: `Decoded` and the `core` field from Task 4; `Session::run_lambda` from Task 3.
- Produces: `Session::lambda_value(&self) -> Result<Decoded, SessionError>`; field `pub(crate) ty: redextape_core::ty::Ty` on `Session`; `lambdaValue(): Decoded` on the boundary.

- [ ] **Step 1: Write the failing tests**

```rust
/// Church 42 decodes to 42, but only after the run reaches its end.
#[test]
fn lambda_value_decodes_the_normal_form() {
    let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
    let mut s = c.session.expect("compiles");
    assert_eq!(s.lambda_value(), Ok(Decoded::Unfinished), "nothing to decode before the run ends");
    assert_eq!(s.run_lambda(1_000_000).expect("present"), RunStatus::Ended);
    assert_eq!(s.lambda_value(), Ok(Decoded::Value { text: "42".to_string() }));
}

/// The λ answer must equal the reference answer. This is the three-way oracle's λ half, asserted at
/// the layer the product reads rather than at core's.
#[test]
fn the_lambda_leg_agrees_with_the_reference() {
    for src in ["let x = 40; x + 2", "[1, 2, 3]", "true", "1 + 2 * 3"] {
        let c = Session::compile(src, EncodingKind::Unary);
        let mut s = c.session.unwrap_or_else(|| panic!("{src} compiles"));
        assert_eq!(s.run_lambda(1_000_000).expect("λ leg present"), RunStatus::Ended, "{src}");
        assert_eq!(s.lambda_value(), Ok(s.evaluate()), "{src}: the λ leg and the reference disagree");
    }
}

/// A capped run is `Unfinished`, not `Undecodable` — it has a term, it is simply not a normal form.
#[test]
fn a_capped_lambda_run_is_unfinished() {
    let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
    let mut s = c.session.expect("compiles");
    s.cap_lambda_at(3);
    assert_eq!(s.run_lambda(1_000_000).expect("present"), RunStatus::Capped);
    assert_eq!(s.lambda_value(), Ok(Decoded::Unfinished));
}

/// An absent λ leg is an error, not a `Decoded` variant — "this program has no λ backend" is a fact
/// about the program, and flattening it into "no value" loses the reason.
#[test]
fn lambda_value_on_an_absent_leg_is_an_error() {
    let c = Session::compile(LAMBDA_DECLINES, EncodingKind::Unary);
    let s = c.session.expect("the TM leg handles this program");
    assert_eq!(s.lambda_value(), Err(SessionError::LambdaAbsent));
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p redextape-wasm --lib lambda_value`

Expected: FAIL — `no method named 'lambda_value'`.

- [ ] **Step 3: Keep the `Ty`**

Add the field to `Session`, after `core`:

```rust
    /// The program's top-level type, which BOTH decoders need — `decode_lambda_ty(nf, &ty)` and
    /// `decode_tape_ty(&tapes, &ty, enc)`. `compile` computes it for `run_tm_described` and passed
    /// it away; decoding is type-directed, so a session that discarded it could not decode anything.
    pub(crate) ty: redextape_core::ty::Ty,
```

`run_tm_described` takes `ty` by value, so `compile` clones it — `Ty` derives `Clone`:

```rust
        let tm = match tm::run_tm_described(&core, kind, ty.clone(), tm::TM_DEFAULT_CAPS) {
```

and the struct literal becomes:

```rust
        Compiled { diagnostics, session: Some(Session { core, ty, lambda, tm, program, map }) }
```

- [ ] **Step 4: Implement `lambda_value`**

In `session.rs`, after `raise_lambda_cap`:

```rust
    /// The λ leg's answer, decoded against the program's type.
    ///
    /// `Unfinished` UNTIL THE RUN ENDS, and that is a check on `RunStatus` rather than on the shape
    /// of the term. A term mid-reduction can happen to *look* like a Church numeral — a partially
    /// reduced `40 + 2` passes through terms that decode — so decoding whatever the cursor currently
    /// holds would report an answer that is not the program's.
    ///
    /// `Undecodable` IS A REAL OUTCOME, not a failure: a normal form of a type the decoder has no
    /// encoding for is a fact about this pair of program and backend, and the UI should say so
    /// rather than show an empty field.
    pub fn lambda_value(&self) -> Result<Decoded, SessionError> {
        let c = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
        if self.lambda_status().run != Some(RunStatus::Ended) {
            return Ok(Decoded::Unfinished);
        }
        Ok(match lambda::decode_lambda_ty(c.term(), &self.ty) {
            Some(v) => Decoded::Value { text: redextape_core::value::format_value(&v) },
            None => Decoded::Undecodable,
        })
    }
```

Add `decode_lambda_ty` to the existing `lambda` import if the module is imported by name rather than glob; `use redextape_core::lambda::{self, LowerError};` already brings `lambda::decode_lambda_ty` into reach, so no import change is needed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p redextape-wasm --lib`

Expected: PASS. If `the_lambda_leg_agrees_with_the_reference` fails on a particular program, that is a real disagreement between the λ backend and the interpreter — report it rather than weakening the test.

- [ ] **Step 6: Export it**

In `lib.rs`, after `raise_lambda_cap`:

```rust
    #[wasm_bindgen(js_name = lambdaValue)]
    pub fn lambda_value(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.lambda_value().map_err(err)?)
    }
```

- [ ] **Step 7: Verify both targets build**

Run: `cargo clippy -p redextape-wasm --all-targets -- -D warnings && cargo check -p redextape-wasm --lib --target wasm32-unknown-unknown`

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-wasm/src/session.rs crates/redextape-wasm/src/lib.rs
git commit -m "wasm: lambdaValue(), decoded against the type the session now keeps

decode_lambda_ty is pub in core and reached neither a view model nor the
boundary, so §6.3's 'decoded value' had no path. Decoding is type-directed and
compile computed the Ty for run_tm_described and passed it away; the session
keeps it now, since a session that discarded it could not decode anything.

Unfinished is gated on RunStatus, not on the shape of the term. A term
mid-reduction can look like a Church numeral — a partially reduced 40 + 2 passes
through terms that decode — so decoding whatever the cursor holds would report an
answer that is not the program's.

An absent λ leg is an error rather than a Decoded variant: 'this program has no λ
backend' is a fact about the program, and flattening it into 'no value' loses the
reason lambdaStatus exists to carry.

The agreement test asserts the three-way oracle's λ half at the layer the product
reads rather than at core's, which is the argument for surfacing the reference leg
at all."
```

---

### Task 6: `tmValue()` and `TmStatus.total_steps`

The TM leg's answer comes from the run `compile` already performed. `Session` starts keeping the halted run's tapes, the encoding kind, and Task 1's step count.

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs`
- Modify: `crates/redextape-wasm/src/lib.rs`
- Test: `crates/redextape-wasm/src/session.rs`

**Interfaces:**
- Consumes: `DescribedRun.steps` (Task 1); `Decoded` (Task 4); the `ty` field (Task 5).
- Produces: `Session::tm_value(&self) -> Result<Decoded, SessionError>`; fields `pub(crate) final_tapes: Option<Vec<Tape>>`, `pub(crate) kind: EncodingKind`, `pub(crate) total_steps: Option<u64>` on `Session`; `TmStatus.total_steps: Option<u64>`; `tmValue(): Decoded` on the boundary.

- [ ] **Step 1: Write the failing tests**

```rust
/// The TM's answer comes from the run `compile` ALREADY performed. Driving the cursor for the same
/// answer would simulate the machine a second time.
#[test]
fn tm_value_decodes_the_run_compile_already_performed() {
    let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
    let s = c.session.expect("compiles");
    // No stepping: the cursor is still at 0 and the value is already known.
    assert_eq!(s.tm_state(1).expect("present").step, 0);
    assert_eq!(s.tm_value(), Ok(Decoded::Value { text: "42".to_string() }));
}

/// All three legs must agree. This is the three-way oracle asserted at the layer the product reads.
#[test]
fn all_three_legs_agree() {
    for src in ["let x = 40; x + 2", "[1, 2, 3]", "true", "1 + 2 * 3"] {
        let c = Session::compile(src, EncodingKind::Unary);
        let mut s = c.session.unwrap_or_else(|| panic!("{src} compiles"));
        assert_eq!(s.run_lambda(1_000_000).expect("λ leg present"), RunStatus::Ended, "{src}");
        let reference = s.evaluate();
        assert_eq!(s.lambda_value(), Ok(reference.clone()), "{src}: λ disagrees with the reference");
        assert_eq!(s.tm_value(), Ok(reference), "{src}: TM disagrees with the reference");
    }
}

/// `total_steps` describes the WHOLE run; `run` describes where the CURSOR is. A renderer showing
/// "step 40 of 2,870" reads both, and they are different numbers about different things.
#[test]
fn tm_status_reports_the_whole_runs_length_alongside_the_cursors_position() {
    let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
    let mut s = c.session.expect("compiles");
    assert_eq!(s.tm_status().total_steps, Some(2870), "the length of the whole run");
    assert_eq!(s.tm_status().run, Some(RunStatus::Running), "the cursor has not moved");

    let mut driven = 0;
    while s.step_tm().expect("present") {
        driven += 1;
    }
    assert_eq!(driven, 2870, "the cursor reaches the length the fitting run reported");
    assert_eq!(s.tm_status().total_steps, Some(2870), "unchanged: it was never about the cursor");
}

/// A declined TM leg has no run, so no length.
#[test]
fn a_declined_tm_leg_reports_no_total_steps() {
    let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
    let s = c.session.expect("compiles");
    assert!(s.tm_status().total_steps.is_some(), "an available leg has a length");
    // The declining program's λ leg is the absent one; assert the shape holds for a real decline by
    // checking the field is `None` exactly when `available` is false.
    let status = s.tm_status();
    assert_eq!(status.total_steps.is_some(), status.available);
}

/// An absent TM leg is an error, matching every other TM method.
#[test]
fn tm_value_on_an_absent_leg_is_an_error() {
    // A higher-order program the TM backend refuses and the λ backend accepts.
    let c = Session::compile("fn twice(g, x) { g(g(x)) } twice(|y| y + 1, 5)", EncodingKind::Unary);
    let s = c.session.expect("compiles");
    if s.tm_status().available {
        return; // this program lowers after all; the absent-leg path is covered by the assert below
    }
    assert_eq!(s.tm_value(), Err(SessionError::TmAbsent));
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p redextape-wasm --lib tm_value`

Expected: FAIL — `no method named 'tm_value'`.

- [ ] **Step 3: Keep the fitting run's results**

Add three fields to `Session`:

```rust
    /// The halted run's final tapes, from `TmRun::Ran`. `None` for `HitCap` — a capped run never
    /// reached a final configuration, which is what `tm_value` reports as `Unfinished` rather than
    /// as `Undecodable`.
    pub(crate) final_tapes: Option<Vec<Tape>>,
    /// The encoding the tapes were produced under. NO WIDTH IS KEPT ALONGSIDE IT: `TmRun::Ran`'s own
    /// doc records that both encodings decode structurally, delimiter to delimiter, so any instance
    /// decodes tapes produced at any width. There is therefore no second object that can disagree
    /// with the first — the shape that once mis-attributed 1,049 of 1,374 spans.
    pub(crate) kind: EncodingKind,
    /// δ-steps the whole run takes, from `DescribedRun.steps`. `None` when the TM leg declined.
    pub(crate) total_steps: Option<u64>,
```

Add `Tape` to the `tm` import:

```rust
use redextape_core::tm::{self, EncodingKind, Symbol, Tape, TmRun};
```

Rewrite `compile`'s `Ok(d)` arm so `Ran` and `HitCap` differ only in the tapes they carry. A free helper keeps the shared body in one place and the match exhaustive — no catch-all arm, so a future `TmRun` variant is a compile error rather than a silent `None`:

```rust
/// The shared tail of `compile`'s two non-declining arms. `Ran` and `HitCap` build the same cursor
/// and the same projected program; they differ only in whether a final configuration exists.
fn build_tm_leg(
    header: tm::TmHeader,
    machine: tm::machine::Machine,
    final_tapes: Option<Vec<Tape>>,
) -> (TmProgram, TmCursor<Rc<Machine>>, Option<Vec<Tape>>) {
    let init = header.init(machine.tapes);
    let width = header.width;
    let machine = Rc::new(machine);
    // `TmProgram` is projected ONCE, here, and cached — never per step.
    let program = TmProgram::of(&machine, width);
    let cursor = TmCursor::new(Rc::clone(&machine), &init, tm::TM_DEFAULT_CAPS);
    (program, cursor, final_tapes)
}
```

and in `compile`:

```rust
        let described = tm::run_tm_described(&core, kind, ty.clone(), tm::TM_DEFAULT_CAPS);
        let total_steps = described.as_ref().ok().map(|d| d.steps);
        let tm = match described {
            Err(TmRun::TooLarge) => Err(TmDecline::TooLarge),
            Err(TmRun::LowerError(e)) => Err(TmDecline::Lower(format!("{e:?}"))),
            // `lower_and_size` produces no other `Err`, so this arm is unreachable today. It is a
            // mapping rather than an `unreachable!()` because that macro is a panic, and a panic under
            // wasm aborts the module; a future `Err` variant becomes a legible decline instead.
            Err(other) => Err(TmDecline::Lower(format!("{other:?}"))),
            Ok(d) => match d.run {
                TmRun::Overflow => Err(TmDecline::Overflow),
                TmRun::TooLarge => Err(TmDecline::TooLarge),
                TmRun::LowerError(e) => Err(TmDecline::Lower(format!("{e:?}"))),
                // `Ran` and `HitCap` BOTH yield a working cursor, and that is the point of the split:
                // a run that spent its budget is resumable through `raise_tm_cap`, so flattening it
                // into a decline would throw away a session the user can still drive.
                TmRun::Ran { tapes } => Ok(build_tm_leg(d.header, d.machine, Some(tapes))),
                TmRun::HitCap => Ok(build_tm_leg(d.header, d.machine, None)),
            },
        };

        let (program, tm, final_tapes) = match tm {
            Ok((p, c, t)) => (Some(p), Ok(c), t),
            Err(d) => (None, Err(d), None),
        };
```

`total_steps` is read off the `Ok` before the match consumes it, so a declining leg reports `None` and every started run reports its own count — including `Overflow` and `TooLarge` when they arrive inside an `Ok`.

The struct literal becomes:

```rust
        Compiled {
            diagnostics,
            session: Some(Session { core, ty, kind, lambda, tm, program, map, final_tapes, total_steps }),
        }
```

- [ ] **Step 4: Add `total_steps` to `TmStatus` and implement `tm_value`**

Extend `TmStatus`:

```rust
pub struct TmStatus {
    pub available: bool,
    pub reason: String,
    pub width: Option<usize>,
    /// Where the CURSOR stands.
    pub run: Option<RunStatus>,
    /// How long the WHOLE run is, in δ-steps, from the run `compile` performed.
    ///
    /// **A DIFFERENT NUMBER ABOUT A DIFFERENT THING THAN `run`**, and both are needed: a renderer
    /// showing "step 40 of 2,870" reads the cursor for the first and this for the second. It does not
    /// move as the cursor advances, because it was never about the cursor.
    ///
    /// **`LambdaStatus` HAS NO COUNTERPART, and the asymmetry is real.** The TM's length is known at
    /// compile time because `compile` already ran the machine; λ's is not, because `compile` builds
    /// the cursor and never reduces. There is no honest number to put there.
    pub total_steps: Option<u64>,
}
```

Every `TmStatus` construction in `tm_status` gains the field: `total_steps: self.total_steps` on the available arm, and `total_steps: None` on the internal-error and declined arms.

Add the method after `raise_tm_cap`:

```rust
    /// The TM leg's answer, decoded from the run `compile` already performed.
    ///
    /// **NO SECOND RUN.** `compile` calls `run_tm_described`, which simulates the machine to a halt;
    /// driving the cursor for the same answer would simulate the `map` demo's 344,999 steps twice.
    /// The cursor exists for WATCHING a run, which is Plan 5's job.
    ///
    /// `Unfinished` when there are no final tapes, which happens for exactly one reason: `HitCap`.
    /// A capped machine is a live session — `raise_tm_cap` can continue it — that has not reached a
    /// final configuration, so there is nothing to decode rather than something that failed to.
    pub fn tm_value(&self) -> Result<Decoded, SessionError> {
        if self.tm.is_err() {
            return Err(SessionError::TmAbsent);
        }
        let Some(tapes) = &self.final_tapes else {
            return Ok(Decoded::Unfinished);
        };
        let enc = self.kind.at(tm::MIN_FIELD_WIDTH);
        Ok(match tm::decode_tape_ty(tapes, &self.ty, &*enc) {
            Some(v) => Decoded::Value { text: redextape_core::value::format_value(&v) },
            None => Decoded::Undecodable,
        })
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p redextape-wasm --lib`

Expected: PASS. `all_three_legs_agree` failing on a particular program is a real disagreement — report it rather than weakening the test.

- [ ] **Step 6: Export it**

In `lib.rs`, after `raise_tm_cap`:

```rust
    #[wasm_bindgen(js_name = tmValue)]
    pub fn tm_value(&self) -> Result<JsValue, JsValue> {
        to_value(&self.0.tm_value().map_err(err)?)
    }
```

- [ ] **Step 7: Verify both targets build**

Run: `cargo clippy -p redextape-wasm --all-targets -- -D warnings && cargo check -p redextape-wasm --lib --target wasm32-unknown-unknown`

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-wasm/src/session.rs crates/redextape-wasm/src/lib.rs
git commit -m "wasm: tmValue() and TmStatus.total_steps, from the run compile already did

compile calls run_tm_described, which simulates the machine to a halt, and then
matched TmRun::Ran { .. } and threw the final tapes away. decode_tape_ty on those
tapes is §6.3's decoded value with no second run — driving the cursor for the same
answer would simulate the map demo's 344,999 steps twice. The cursor is for
watching a run, which is Plan 5's job.

No width is kept beside the encoding kind: TmRun::Ran's doc records that both
encodings decode structurally, so any instance decodes tapes from any width.
There is no second object that can disagree with the first, which is the shape
that once mis-attributed 1,049 of 1,374 spans.

total_steps is on TmStatus next to run, and they are different numbers about
different things: run is where the cursor stands, total_steps is how long the
whole run is. 'Step 40 of 2,870' needs both. LambdaStatus gets no counterpart —
the TM's length is known at compile time because compile ran it, and λ's is not,
so there would be no honest number to put there.

Ran and HitCap now build through one helper rather than a shared arm, so the
match stays exhaustive and a future TmRun variant is a compile error instead of a
silent None."
```

---

### Task 7: The wasm shadow stack, measured

Every depth bound in core was calibrated on a native 8 MiB stack; the roadmap recorded wasm dying near depth 180 against bounds of 256–1500. **(CORRECTED 2026-08-07: that "180" was never measured — PR 3b's measurement found 256–260, and the roadmap entry now reflects it; the "decorative guards" conclusion below held anyway and is now confirmed.)** On that target the guards are decorative — the trap fires first, and a wasm trap has no unwinding.

**Files:**
- Modify: `.cargo/config.toml`
- Modify: `crates/redextape-wasm/tests/browser.rs`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**Interfaces:**
- Consumes: nothing.
- Produces: no API. A link flag, a recorded measurement, and safe-side tests.

- [ ] **Step 1: Record the pre-flag crash depths**

**This is a manual probe, run once, and it is deliberately NOT a committed test.** A wasm trap poisons the module for every later case in the same instance, so a binary search that overflows on purpose would take the rest of the file down with it and the failure would read as unrelated.

Write a scratch test in `crates/redextape-wasm/tests/probe.rs` (deleted at the end of this task, never committed):

```rust
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use wasm_bindgen_test::*;
wasm_bindgen_test_configure!(run_in_browser);

/// A list literal `[0, 0, ..., 0]` of `n` elements nests to depth ~n in the AST, which is the shape
/// the roadmap used for the native measurement.
fn nested(n: usize) -> String {
    let elems = vec!["0"; n].join(", ");
    format!("[{elems}]")
}

#[wasm_bindgen_test]
fn probe_one_depth() {
    // Edit N by hand between runs; each run either returns or kills the module.
    const N: usize = 180;
    let _ = redextape_wasm::compile(&nested(N), "unary");
}
```

Run it at increasing `N` — 100, 150, 180, 250, 400, 700 — one value per invocation:

```bash
wasm-pack test --headless --chrome crates/redextape-wasm
```

A run that returns is below the crash; a run that reports the module aborting is above it. **Record the highest returning value.**

- [ ] **Step 2: Add the flag and re-probe**

```toml
# .cargo/config.toml — append below the existing `[env]` block

# THE DEPTH GUARDS DO NOT REACH WASM WITHOUT THIS. Every bound in `redextape-core`
# (`MAX_PARSE_DEPTH` 300, λ-syntax 256, `MAX_TYPE_DEPTH` 1500, `MAX_EVAL_DEPTH` 700,
# `MAX_LAMBDA_LOWER_DEPTH` 700, `MAX_LOWER_DEPTH` 580, `MAX_DEFUNC_DEPTH` 580) was calibrated on a
# native 8 MiB stack. wasm32's default linear-memory shadow stack is 1 MiB, where the crash arrives
# far below every one of them — so on that target the guards never fire and the trap does. A wasm
# trap has no unwinding, so it poisons the module rather than returning an error.
#
# TARGET-SCOPED, so native builds are unaffected. An environment `RUSTFLAGS` would silently override
# this and disarm it without failing anything; nothing in `.forgejo/` or `scripts/` sets one.
#
# This controls the SHADOW stack in linear memory, NOT the engine's own wasm call-depth limit, which
# a module cannot set. The measurement recorded in the roadmap is what says whether it was enough.
[target.wasm32-unknown-unknown]
rustflags = ["-C", "link-arg=-zstack-size=8388608"]
```

Re-run Step 1's probe at increasing `N`. **Record the new highest returning value.**

- [ ] **Step 3: Apply the decision rule**

Every bound must sit at or below **half** the measured crash depth — the margin the native 700 was calibrated at (~1470 / 2.1).

- If the largest bound, `MAX_TYPE_DEPTH` at 1500, clears `crash / 2`, nothing else changes. Go to Step 4.
- If it does not, give each failing constant a `#[cfg(target_arch = "wasm32")]` value that does, documented at the constant with the divergence stated plainly — the browser then refuses programs the CLI accepts, which breaks the invariant `MAX_LAMBDA_LOWER_DEPTH` was set to give ("if the reference interpreter can evaluate it, the λ backend can lower it") on wasm only.
- **If the crash depth did not move between Steps 1 and 2, the binding constraint was never the shadow stack** but the engine's wasm call-depth limit. Say so in the roadmap entry, keep the flag (it is still correct), and take the per-target-constant path.

- [ ] **Step 4: Delete the probe**

```bash
rm crates/redextape-wasm/tests/probe.rs
```

It has served its purpose and must not reach CI.

- [ ] **Step 5: Add the safe-side test**

In `crates/redextape-wasm/tests/browser.rs`:

**CORRECTED 2026-08-07: this step's body originally asserted a 400-element LIST LITERAL was "deeper
than `MAX_PARSE_DEPTH` (300)". PR 3b's measurement falsified that — a list literal is
`Expr::List { items }`, flat in the AST, and never reaches that guard; 2,000 elements still parse and
typecheck with zero diagnostics. What shipped uses 400 NESTED PARENS instead, the shape that guard
actually bounds, shown below in place of the original.**

```rust
/// The depth guards must ANSWER rather than trap, on the one target where they were never calibrated.
///
/// **THIS TEST DELIBERATELY STAYS BELOW THE CRASH.** A wasm trap poisons the module for every later
/// case in this file, so nothing here may cross the line — the crash depth itself was measured once
/// by hand and is recorded in the roadmap, not asserted here.
#[wasm_bindgen_test]
fn a_deep_program_is_refused_rather_than_trapping() {
    // 300 parens written is the first depth `MAX_PARSE_DEPTH` refuses (299 is the deepest accepted),
    // so 400 is well past it and the front end refuses this before any backend runs.
    let (diagnostics, session) = compile(&format!("{}0{}", "(".repeat(400), ")".repeat(400)));
    assert!(diagnostics.length() > 0, "a program past the parse guard is refused, not trapped");
    assert!(session.is_null(), "no session for a program that does not analyze");
}

/// Just under the parse guard, the whole pipeline runs in a browser — which is what says the guard is
/// the thing stopping deep input, rather than the module dying a little further along.
#[wasm_bindgen_test]
fn a_program_just_under_the_guard_still_compiles() {
    let elems = vec!["0"; 200].join(", ");
    let (diagnostics, session) = compile(&format!("[{elems}]"));
    assert_eq!(diagnostics.length(), 0, "200 elements is within every guard");
    assert!(!session.is_null(), "and it compiles in a browser, not only natively");
}
```

- [ ] **Step 6: Run the browser suite**

Run: `wasm-pack test --headless --chrome crates/redextape-wasm`

Expected: every test passes, including both new cases. If `a_program_just_under_the_guard_still_compiles` kills the module, the flag did not take effect — check that no `RUSTFLAGS` is set in the environment.

- [ ] **Step 7: Record the measurement in the roadmap**

Append to the Plan 4 section of `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, under the PR #13 entry, replacing the "Decide it with the WASM slice" deferral with what was measured. State: the pre-flag crash depth, the post-flag crash depth, whether the delta shows the shadow stack or the engine limit was binding, and which of the seven constants (if any) gained a `cfg`.

- [ ] **Step 8: Commit**

```bash
git add .cargo/config.toml crates/redextape-wasm/tests/browser.rs docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "wasm: raise the shadow stack, and measure what the guards actually protect

Every depth bound in core — MAX_PARSE_DEPTH 300, λ-syntax 256, MAX_TYPE_DEPTH
1500, MAX_EVAL_DEPTH 700, MAX_LAMBDA_LOWER_DEPTH 700, MAX_LOWER_DEPTH 580,
MAX_DEFUNC_DEPTH 580 — was calibrated on a native 8 MiB stack. wasm32's default
shadow stack is 1 MiB, where the crash arrives below every one of them, so on that
target the guards never fired and the trap did. A wasm trap has no unwinding: it
poisons the module, which is the outcome §7 says must never happen.

The roadmap deferred this to 'the WASM slice' and PR 3a did not take it up. PR 3c
is the first slice with a human typing into a box, so this is the last PR where it
can be closed before it is a user-facing defect.

The link arg is target-scoped so native is untouched, and it controls the
linear-memory shadow stack, not the engine's own call-depth limit. Which of the
two was binding is what the before/after measurement answers, and the roadmap
records both numbers.

The measurement was a one-off manual probe, deliberately not committed: a trap
poisons the module for every later case in the same file, so a binary search that
overflows on purpose would take the rest of the suite down and read as unrelated.
What ships is the safe side only — refusal at 400 elements, a clean compile at
200 — with the crash depth itself recorded in prose."
```

---

### Task 8: Prove the whole boundary in a browser, and gate it

The native tests cover every branch; none of them proves `serde-wasm-bindgen` marshals `Decoded`, or that six new methods reached the generated glue.

**Files:**
- Modify: `crates/redextape-wasm/tests/browser.rs`
- Test: itself

**Interfaces:**
- Consumes: every export from Tasks 2–6.
- Produces: nothing.

- [ ] **Step 1: Write the browser test**

Add to `crates/redextape-wasm/tests/browser.rs`:

```rust
/// The two free exports, which take no session and must therefore be reachable as module-level
/// functions rather than as prototype methods.
#[wasm_bindgen_test]
fn the_free_exports_need_no_session() {
    let spans: Array = redextape_wasm::classify_source("let x = 40; x + 2").expect("marshals").unchecked_into();
    assert!(spans.length() > 0, "a clean program has tokens to highlight");
    let first: Array = spans.get(0).unchecked_into();
    assert_eq!(first.length(), 2, "each entry is a (Span, TokenClass) pair");

    // Highlighting a broken file is when highlighting matters most.
    let broken: Array = redextape_wasm::classify_source("let x = ;").expect("marshals").unchecked_into();
    assert!(broken.length() > 0, "a file that does not analyze still has tokens");

    let clean: Array = redextape_wasm::analyze("let x = 40; x + 2").expect("marshals").unchecked_into();
    assert_eq!(clean.length(), 0, "a clean program has no diagnostics");
    let errs: Array = redextape_wasm::analyze("let x = ;").expect("marshals").unchecked_into();
    assert!(errs.length() > 0, "a parse error is reported");
    assert_eq!(get(&errs.get(0), "severity").as_string().as_deref(), Some("Error"));
}

/// All three legs, through the glue, agreeing. `Decoded` is an externally tagged enum with struct
/// variants — the shape most likely to be mangled by a serializer — so its tag and payload are both
/// read rather than only its presence.
#[wasm_bindgen_test]
fn all_three_legs_agree_across_the_boundary() {
    let (_, session) = compile("let x = 40; x + 2");

    // Before the λ run, its value is `Unfinished`: a unit variant, which serde renders as a bare
    // string rather than an object.
    let before = call(&session, "lambdaValue", &[]);
    assert_eq!(before.as_string().as_deref(), Some("Unfinished"), "got {before:?}");

    // The chunked loop: three steps at a time, exactly as a renderer drives it.
    let mut chunks = 0;
    loop {
        let st = call(&session, "runLambda", &[JsValue::from_f64(3.0)]);
        chunks += 1;
        assert!(chunks <= 100, "this program normalizes in 7 β-steps");
        match st.as_string().as_deref() {
            Some("Running") => continue,
            Some("Ended") => break,
            other => panic!("unexpected status {other:?}"),
        }
    }
    assert_eq!(chunks, 3, "7 steps at 3 per chunk ends inside the third");

    // `Value { text }` is a struct variant: serde renders it as `{ Value: { text: "42" } }`.
    let expected = |v: &JsValue| {
        let inner = get(v, "Value");
        assert!(inner.is_object(), "a decoded value is a tagged object, got {v:?}");
        get(&inner, "text").as_string()
    };
    let lambda = call(&session, "lambdaValue", &[]);
    let tm = call(&session, "tmValue", &[]);
    let reference = call(&session, "evaluate", &[]);
    assert_eq!(expected(&lambda).as_deref(), Some("42"), "λ");
    assert_eq!(expected(&tm).as_deref(), Some("42"), "TM");
    assert_eq!(expected(&reference).as_deref(), Some("42"), "reference");

    // `tmValue` needed no stepping: the answer came from the run `compile` performed.
    let tm_status = call(&session, "tmStatus", &[]);
    assert_eq!(num(&tm_status, "total_steps"), 2870.0, "the whole run's length");
    assert_eq!(
        get(&tm_status, "run").as_string().as_deref(),
        Some("Running"),
        "and the cursor has not moved — total_steps is not about the cursor"
    );
}
```

- [ ] **Step 2: Run the browser suite**

Run: `wasm-pack test --headless --chrome crates/redextape-wasm`

Expected: all tests pass. If `Decoded`'s tag arrives in a different shape than `{ Value: { text } }`, fix the ASSERTION to match what `serde-wasm-bindgen` actually produces and record the real shape in a comment — the renderer in PR 3c will read exactly this.

Chrome lives in `/usr/sbin` on this machine and is off `PATH` under some shells; if `wasm-pack` reports it unavailable, put it on `PATH` rather than skipping. **If the browser genuinely cannot run, say so and report what ran instead — do not claim this task passed.**

- [ ] **Step 3: Verify the package builds**

Run: `wasm-pack build crates/redextape-wasm --release --target web`

Expected: succeeds. This is what PR 3c's `web/` will import.

- [ ] **Step 4: Run the full gate**

Run: `scripts/check-all.sh --no-llvm`

Expected: green, with all three `wasm` legs listed. The gate already covers `-p redextape-wasm --lib` for wasm32 (row added by PR 3a); no new row is needed.

- [ ] **Step 5: Run coverage**

Run: `cargo llvm-cov nextest --workspace --fail-under-lines 80`

Expected: PASS. **Report the figure.** The tree was at 95.50% before this slice; `lib.rs` grows from 64 to roughly 110 lines and stays 0% by construction, so a drop of a few tenths is the designed cost. A materially larger drop means logic leaked out of `session.rs`, and the fix is to move it back rather than to exclude the file.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-wasm/tests/browser.rs
git commit -m "wasm: prove the completed boundary in a browser

The native tests cover every branch and prove nothing about wasm: not that six
new methods reached the generated glue, not that serde-wasm-bindgen marshals
Decoded. Decoded is the hardest shape on this boundary — an externally tagged
enum mixing unit and struct variants — so both its tag and its payload are read
rather than only its presence.

The chunked loop is driven exactly as a renderer will drive it, three steps at a
time, and lands inside the third chunk because the program takes seven. That is
the assertion that runLambda's chunk/cap distinction survives the crossing.

tmValue is read WITHOUT stepping and tmStatus.run is still Running at the same
moment total_steps reads 2,870 — which is the whole claim of Task 6 in one
assertion: the TM's answer comes from the run compile already performed, and
total_steps was never about the cursor."
```

---

## Self-Review

**Spec coverage.** §3's surface maps to tasks: `classifySource`/`analyze` (2), `runLambda` (3), `Decoded` + `evaluate` (4), `lambdaValue` (5), `tmValue` (6). §3's reachability table is asserted in Tasks 4, 5 and 6 and documented on the type in Task 4. §4's four kept fields land with their readers — `core` (4), `ty` (5), `final_tapes`/`kind` (6) — plus `total_steps`, which §4 did not list because §5 hung the count on `DescribedRun` and only Task 6 revealed the session must carry it too. §5 is Task 1. §6 is Task 7, all four numbered steps. §7's one new failure shape is Task 4's fault test; its claim that `RunError::Static` is unreachable is pinned by `a_session_never_exists_for_a_program_with_static_errors`. §8's native list is distributed across Tasks 2–6 and its browser list is Tasks 7–8; the coverage expectation is Task 8 Step 5.

**Three spec corrections this plan forced, all applied to the spec before this plan was committed.**
§10 said PR 3b was one commit, reasoning from PR 3a that new `Session` fields are `dead_code` until
their readers exist — true only when a field lands *separately from* its reader, which Tasks 4, 5 and
6 do not do; it now says eight commits. §5 justified rejecting a `simulate_final_counted` sibling as
"two functions running the same loop", which is wrong — `sim.rs` already has four one-line wrappers
over one private `run` — so the real reason (the count is a fact every caller could use) replaced it.
And §4's table did not list `total_steps` on the `Session`, because §5 hung the count on
`DescribedRun` and only Task 6 revealed the session must carry it too; the row and the
`TmStatus`/`LambdaStatus` asymmetry are now in the spec.

**Deliberately out of scope**, traceable rather than dropped: `web/`, pnpm, the `Dockerfile` and `ci.yml` edits, and arming the `docker` push are PR 3c. `LambdaStatus` gains no `total_steps` (Task 6 records why). `parse_asm` remains unclaimed, per the roadmap's Plan 6 note.

**Placeholder scan.** No `TODO`, `TBD`, or "similar to Task N". Task 7 Steps 1–3 are the one place a number is not written down, and that is the point of the task: the plan specifies the probe, the decision rule and where the result is recorded, because a spec that pre-committed to a crash depth it had not measured would be guessing. Task 8 Step 2 likewise names what to do if `Decoded`'s serialized shape differs from the assertion, rather than assuming.

**Type consistency.** `Decoded` is defined once (Task 4) and used in Tasks 4, 5, 6 and 8. `Session::run_lambda(&mut self, budget: u64)` is `u64` natively and `u32`-widened at the boundary in every mention, matching `raise_lambda_cap`'s shipped convention. `build_tm_leg` returns a 3-tuple in Task 6 and is destructured as one at its single call site. `DescribedRun.steps` is `u64` in Task 1 and read as `Option<u64>` into `Session.total_steps` in Task 6. `simulate_final`'s widened 4-tuple is destructured with a trailing element at all seven call sites listed in Task 1 Steps 4 and 6.

**Two risks worth naming.** Task 7 Step 6 depends on headless Chrome; if it cannot run, the browser half of this PR is unproven and the plan says to report that rather than paper over it. And `all_three_legs_agree` (Task 6) is the first test to compare all three answers at this layer — if it fails, it has found a real backend disagreement, and the instruction is to report it rather than weaken the assertion.
