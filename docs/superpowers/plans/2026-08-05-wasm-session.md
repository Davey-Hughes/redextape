# The WASM Session — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `crates/redextape-wasm` — a `Session` that compiles a program and steps its λ and TM legs from JavaScript — proven in headless Chrome, with no JavaScript toolchain in the repository yet.

**Architecture:** All logic stays in `redextape-core`; the new crate is a thin `#[wasm_bindgen]` shell over a natively-testable inner module. That split is architecture *and* a coverage requirement — `wasm-bindgen-test` runs in a browser while `llvm-cov` instruments the native build, so anything only the shell does is uncovered by construction.

**Tech Stack:** Rust (edition 2024, stable), `wasm-bindgen`, `serde-wasm-bindgen`, `wasm-pack` 0.15.0, `wasm-bindgen-test` in headless Chrome.

## This is PR 3a of the slice's final third

Spec: [`../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md`](../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md) §5.

**PR 1 (#10)** replaced core's zero-dependency rule with a wasm32 build gate. **PR 2 (#11)** built the view models, the source-map leg, resumable cursors, and the optional `serde` feature.

**PR 3b is NOT in this plan:** `web/`, the pnpm migration, the `Dockerfile` and `ci.yml` web edits, and arming the `docker` push. §10's landing order treated PR 3 as one slice; it splits here because the JavaScript half carries an entirely different toolchain and a registry-push side effect that deserves its own reviewable event. **This PR adds no JavaScript and leaves the `web` and `docker` CI jobs dormant.**

## Global Constraints

- **Rust edition 2024**; `rustfmt.toml` sets `max_width = 120`, `use_small_heuristics = "Max"`.
- **No panics anywhere.** `[workspace.lints.clippy]` denies `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented` via CI's `-D warnings`; `clippy.toml` exempts test code. This matters more here than anywhere else in the project: **a Rust panic under wasm is an abort that poisons the module — there is no unwinding to catch it.** Every fallible export returns `Result<_, JsValue>`.
- **Coverage floor is 80% lines; the tree sits at 95.85%.** A new workspace member whose code only runs in a browser adds uncovered lines to that denominator. Keep the shell thin and test the inner module natively. **`--exclude redextape-wasm` is rejected** — it is the same shape as a CI job that can be skipped.
- **`redextape-core` is depended on with `features = ["serde"]`.** Core's default build must stay dependency-free; `cargo tree -p redextape-core --edges normal` still lists only itself.
- **`wasm-pack` stays at 0.15.0** — what `ci.yml` and the `Dockerfile` already pin.
- **`main` is linear and PR-only.** Work on branch `plan4/wasm-session`. Squash-merge in the Forgejo web UI. Never push to `main`.
- **Every doc claim must be true of the code.** PR 2 corrected fourteen comments that asserted more than the code delivered. That is this project's most persistent defect; write fewer claims and check the ones you write.

## What already exists, verified against the code

Do not re-derive these; they were checked while writing this plan.

| need | how |
| --- | --- |
| program's result type | `typeck::result_type(&Program) -> Result<Ty, _>` |
| `Core` + a `SourceMap` with all three legs | `SourceMap::build_from_program(&Program, &dyn Encoding) -> (Core, SourceMap)` |
| machine, initial tapes, fitted width | `run_tm_described(&core, kind, ty, caps) -> Result<DescribedRun, TmRun>`; then `header.init(machine.tapes)` and `header.width` |
| λ term | `lambda::lower(&core) -> Result<LambdaTerm, LowerError>` |
| owned TM cursor | `TmCursor::new(Rc::new(machine), &init, caps)` — PR 2 made it generic over `M: Borrow<Machine>` |
| view models | `LambdaState::render(c, byte_budget)`, `LambdaState::ast(c, node_budget)`, `TmProgram::of(&machine, width)`, `TmState::window(c, radius)` |
| resume | `LambdaCursor::raise_cap(extra)`, `TmCursor::raise_cap(extra_steps, extra_cells)` |

**`run_tm_described` runs the program to completion** in order to fit the width. §4.6 accepted that: at ~13 ns per δ-step the `map` demo's 344,999 steps is ~4.5 ms, and pinning the width at 64 instead would reintroduce the 3.59× step regression the auto-fit slice removed.

## Four gaps this PR must close first

Each was found while writing this plan; none is in the spec.

1. **`TmDecline` does not exist.** §5.1's `Session` names it. It must be defined — the TM leg can decline for reasons `TmRun` distinguishes (`TooLarge`, `Overflow`, `LowerError`), and the UI needs to tell them apart.
2. **`Tape::head_index` and `Tape::window` are `pub(crate)`.** `tapeSlice(tape, from, to)` has no public path; an external crate holding `&[Tape]` from `TmCursor::tapes()` can only call `snapshot()`, the O(tape) clone PR 2 removed.
3. **`TmProgram` has no `start`.** A renderer cannot learn the entry state without building a `TmState`, and `tmProgram()` is where it belongs.
4. **`TmState.source_node` is always `None`.** Populating it needs `SourceMap::tm_owner(state_name)`, so `window` must take a `&SourceMap`. PR 2 deliberately did not widen the signature speculatively; §6.2's dual-focus highlight is the consumer that decides it, and it is in this PR's sights.

## File Structure

| file | change | responsibility |
| --- | --- | --- |
| `crates/redextape-core/src/tm/sim.rs` | modify | `head_index`/`window` become `pub`; add a public bounded `slice`. |
| `crates/redextape-core/src/viewmodel.rs` | modify | `TmProgram.start`; `TmState::window` takes `&SourceMap` and resolves `source_node`. |
| `crates/redextape-wasm/Cargo.toml` | **create** | cdylib + rlib, deps, `redextape-core` with `serde`. |
| `crates/redextape-wasm/src/session.rs` | **create** | The inner module — all logic, natively tested. |
| `crates/redextape-wasm/src/lib.rs` | **create** | The `#[wasm_bindgen]` shell — marshalling only. |
| `crates/redextape-wasm/tests/browser.rs` | **create** | `wasm-bindgen-test` in headless Chrome. |
| `Cargo.toml` (workspace) | modify | new member. |
| `scripts/check-all.sh` | modify | a leg that builds the new crate for wasm32. |

Five tasks. Task 1 is the core prerequisites; Tasks 2–4 build the crate; Task 5 proves it in a browser and gates it.

---

### Task 1: The four core prerequisites

**Files:**
- Modify: `crates/redextape-core/src/tm/sim.rs`
- Modify: `crates/redextape-core/src/viewmodel.rs`
- Test: `crates/redextape-core/tests/viewmodel_contract.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `Tape::head_index` and `Tape::window` as `pub`; `Tape::slice(from, to) -> Vec<Symbol>`; `TmProgram.start: StateId`; `TmState::window<M>(c: &TmCursor<M>, map: &SourceMap, radius: usize) -> TmState` with `source_node` resolved. Tasks 2–4 depend on all four.

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-core/tests/viewmodel_contract.rs`:

```rust
/// `tapeSlice(tape, from, to)` needs a public operation in the coordinate space `TmState` defines.
/// Before this, the only public accessor was `Tape::snapshot`, whose O(tape) clone is exactly what
/// `TmState::window` was changed to stop paying — a scrolling renderer calling it per drag would
/// reintroduce the cost one layer out.
#[test]
fn a_tape_can_be_sliced_in_the_same_coordinates_the_window_reports() {
    let (machine, init) = tm_fixture("let x = 40; x + 2");
    let mut c = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());
    c.by_ref().take(50).count();

    let st = TmState::window(&c, &empty_map(), 4);
    let tape0 = &c.tapes()[0];

    // The window is the slice its own coordinates name.
    let via_slice = tape0.slice(st.window_start[0], st.window_start[0] + st.window[0].len());
    assert_eq!(via_slice, st.window[0], "slice and window must agree in the same space");

    // The head sits where the window says.
    assert_eq!(tape0.head_index(), st.heads[0], "head_index is the coordinate window_start counts from");

    // Out-of-range is clamped, not a panic.
    assert!(tape0.slice(0, usize::MAX).len() >= st.window[0].len());
    assert!(tape0.slice(usize::MAX, usize::MAX).is_empty(), "a start past the end yields nothing");
    assert!(tape0.slice(5, 2).is_empty(), "an inverted range yields nothing rather than panicking");
}

/// `tmProgram()` is where a renderer learns the machine's shape, and the entry state is part of it.
#[test]
fn tm_program_reports_the_machines_start_state() {
    let (machine, _) = tm_fixture("let x = 40; x + 2");
    let p = TmProgram::of(&machine, 64);
    assert_eq!(p.start, machine.start);
}

/// §6.2's dual-focus highlight needs the Core node the current TM state came from. The map resolves
/// it by the state's printed NAME, which is why `window` needs the map — `tm_owner` takes a name.
#[test]
fn tm_state_resolves_its_source_node_through_the_map() {
    let (program, core, map, machine, init) = tm_fixture_with_map("let x = 40; x + 2");
    let _ = (&program, &core);
    let mut c = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());

    let mut saw_some = false;
    for _ in 0..200 {
        let st = TmState::window(&c, &map, 2);
        if st.source_node.is_some() {
            saw_some = true;
            break;
        }
        if c.next().is_none() {
            break;
        }
    }
    assert!(saw_some, "at least one visited state should belong to a Core node");

    // A map with no TM leg resolves nothing — the map says nothing where the lowering said nothing.
    let mut c2 = redextape_core::trace::TmCursor::new(&machine, &init, tm_caps());
    c2.by_ref().take(10).count();
    assert_eq!(TmState::window(&c2, &empty_map(), 2).source_node, None);
}
```

`empty_map()` returns `SourceMap::default()`. `tm_fixture_with_map` extends the existing `tm_fixture` to also return the `Program`, `Core` and `SourceMap` from `build_from_program` — read the existing fixture and extend it rather than adding a parallel one.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo nextest run -p redextape-core --test viewmodel_contract`

Expected: FAIL to compile — `Tape::slice` and `TmProgram::start` do not exist, `head_index`/`window` are private, and `TmState::window` takes two arguments.

- [ ] **Step 3: Make the `Tape` accessors public and add `slice`**

In `crates/redextape-core/src/tm/sim.rs`, change `pub(crate) fn head_index` and `pub(crate) fn window` to `pub fn`, and add:

```rust
    /// Cells `from..to` in materialized coordinates — the space `head_index` counts in and
    /// `viewmodel::TmState`'s `heads`/`window_start` report. Clamped at both ends and empty for an
    /// inverted range, so no argument value panics.
    ///
    /// THIS EXISTS SO SCROLLING DOES NOT COST A CLONE. `snapshot` materializes the whole tape; a
    /// renderer dragging a scrollbar calls this per frame, and paying O(tape) each time is the cost
    /// `TmState::window` was changed to stop paying.
    pub fn slice(&self, from: usize, to: usize) -> Vec<Symbol> {
        let len = self.cells();
        let (from, to) = (from.min(len), to.min(len));
        if from >= to {
            return Vec::new();
        }
        // ... build from `left`/`head`/`right` without cloning the whole tape; `window`'s body is the
        // model for how the zipper maps onto display order.
    }
```

Implement the body by the same reasoning `window` uses: `left` is in natural order with `left.last()` adjacent to the head, `right` is reversed with `right.last()` adjacent. **Read `window` and `snapshot` before writing it** — an off-by-one or a missed reversal produces a plausible slice of the wrong cells, which the first test above is written to catch.

`cells()` is `pub(crate)`; it can stay that way, or become `pub` if you find `slice`'s contract needs a caller-visible length. Say which you chose.

- [ ] **Step 4: Add `TmProgram.start`**

Add the field and set it in `TmProgram::of` from `m.start`. Document it as the entry state, in one line.

- [ ] **Step 5: Give `TmState::window` the map**

Change the signature to `window<M: Borrow<Machine>>(c: &TmCursor<M>, map: &SourceMap, radius: usize) -> TmState` and resolve `source_node` as `map.tm_owner(name_of_current_state)`.

The state's printed name comes from the machine: `c.state()` is a `StateId`, and `Machine::states[id].name` is the name `tm_owner` keys on. **Index safely** — `states.get(id as usize)` and `and_then`, never `[]`, because a `StateId` past the end must not panic on a library path.

Replace the struct doc's paragraph explaining why `source_node` is `None` with one explaining what it now resolves — and state the limit honestly: it is `None` for machine scaffolding, for `defunc`-minted constructs, and for any state this lowering did not produce, which is what `tm_owner` already documents.

- [ ] **Step 6: Run the tests**

Run: `cargo nextest run -p redextape-core --test viewmodel_contract`

Expected: PASS, including the three new tests and the pre-existing windowing and cost tests.

Run: `cargo nextest run -p redextape-core`

Expected: PASS. The `TmState::window` signature change breaks every existing caller — fix them; there should be few, and they are all in tests.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/tm/sim.rs crates/redextape-core/src/viewmodel.rs crates/redextape-core/tests/viewmodel_contract.rs
git commit -m "viewmodel: the four things a Session needs that core did not expose

tapeSlice had no public operation in the coordinate space TmState defines — an
external crate holding &[Tape] could only call snapshot, whose O(tape) clone is
what TmState::window was changed to stop paying. Tape::slice is that operation,
clamped at both ends so no argument panics.

TmProgram had no start, so a renderer could not learn the entry state without
building a TmState; tmProgram() is where it belongs.

TmState::source_node was always None because window took no SourceMap and
tm_owner resolves by the state's printed NAME. §6.2's dual-focus highlight is
the consumer that decides it, so window now takes the map. It stays None for
scaffolding, defunc-minted constructs, and states this lowering did not produce
— the map says nothing where the lowering said nothing."
```

---

### Task 2: The crate, and `compile`

**Files:**
- Create: `crates/redextape-wasm/Cargo.toml`
- Create: `crates/redextape-wasm/src/session.rs`
- Create: `crates/redextape-wasm/src/lib.rs`
- Modify: `Cargo.toml` (workspace members)

**Interfaces:**
- Consumes: Task 1's four additions.
- Produces: `session::Session::compile(src, EncodingKind) -> Compiled` where `Compiled { diagnostics: Vec<Diagnostic>, session: Option<Session> }`; `TmDecline`; the `#[wasm_bindgen]` `compile` shell. Tasks 3–5 add methods to this `Session`.

- [ ] **Step 1: Create the manifest**

`crates/redextape-wasm/Cargo.toml`:

```toml
[package]
name = "redextape-wasm"
version = "0.0.0"
edition.workspace = true
license.workspace = true
repository.workspace = true

[lints]
workspace = true

# `rlib` ALONGSIDE `cdylib` ON PURPOSE. `cdylib` is what wasm-pack links; `rlib` is what lets
# `cargo test` compile `session.rs` natively, which is where every branch in this crate lives. Without
# it the inner module could only be exercised in a browser, and `cargo llvm-cov` instruments the
# native build — the whole crate would land in the coverage denominator uncovered.
[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
redextape-core = { path = "../redextape-core", features = ["serde"] }
wasm-bindgen = "0.2.126"
serde-wasm-bindgen = "0.6.5"
js-sys = "0.3.103"
console_error_panic_hook = "0.1.7"

[dev-dependencies]
wasm-bindgen-test = "0.3.76"
```

Add `"crates/redextape-wasm"` to the workspace `members` in the root `Cargo.toml`.

- [ ] **Step 2: Write the failing test**

In `crates/redextape-wasm/src/session.rs`, start with the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::tm::EncodingKind;

    #[test]
    fn a_clean_program_compiles_to_a_session_with_no_diagnostics() {
        let c = Session::compile("let x = 40; x + 2", EncodingKind::Unary);
        assert!(c.diagnostics.is_empty(), "{:?}", c.diagnostics);
        assert!(c.session.is_some());
    }

    #[test]
    fn a_malformed_program_yields_diagnostics_and_no_session() {
        let c = Session::compile("let x = ;", EncodingKind::Unary);
        assert!(!c.diagnostics.is_empty(), "a parse error must be reported");
        assert!(c.session.is_none(), "no session for a program that does not analyze");
    }

    /// Both legs declining is a NORMAL outcome, not an error. A closure that assigns a captured
    /// `let mut` is refused by the λ backend and runs fine on the TM — `LAMBDA_LIMITATION_DEMOS` is
    /// the corpus of these, and a TM-only session is the correct result rather than a failure.
    #[test]
    fn a_lambda_limitation_program_still_produces_a_tm_only_session() {
        let src = "let mut n = 0; let f = || { n = n + 1; n }; f()";
        let c = Session::compile(src, EncodingKind::Unary);
        let s = c.session.expect("the TM leg handles this program");
        assert!(s.lambda.is_err(), "the λ backend declines a closure over a `let mut`");
        assert!(s.tm.is_ok(), "the TM backend does not");
    }
}
```

Check `LAMBDA_LIMITATION_DEMOS` in `crates/redextape-core/tests/three_way_oracle.rs` for a source string that genuinely exercises this, and use one of those rather than the sketch above if it does not compile.

- [ ] **Step 3: Run to verify it fails**

Run: `cargo nextest run -p redextape-wasm`

Expected: FAIL — the package does not exist yet, or `Session` is undefined.

- [ ] **Step 4: Write the inner module**

`crates/redextape-wasm/src/session.rs`. Everything with a branch in it lives here; `lib.rs` only marshals.

```rust
//! The Session, and every decision in this crate.
//!
//! NOTHING HERE IS `#[wasm_bindgen]`, AND THAT IS THE POINT. `lib.rs` is the shell that JavaScript
//! sees; this module is ordinary Rust that `cargo test` compiles natively. `wasm-bindgen-test` runs in
//! a browser while `cargo llvm-cov` instruments the native build, so any logic living in the shell is
//! uncovered by construction and drags the workspace's 80% floor down with it.

use std::rc::Rc;

use redextape_core::lambda::{self, LambdaTerm, LowerError};
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{self, EncodingKind, TmRun};
use redextape_core::tm::machine::Machine;
use redextape_core::tm::sim::{Caps as TmCaps, DEFAULT_CAPS};
use redextape_core::trace::{LambdaCursor, TmCursor};
use redextape_core::viewmodel::TmProgram;
use redextape_core::{Diagnostic, analyze, parser, typeck};

/// Why the TM leg is absent. `TmRun` already distinguishes these and the UI must not flatten them:
/// `TooLarge` means lowering REFUSED and the program never ran a step; `Overflow` means a value does
/// not fit the encoding at any width up to the ceiling; `LowerError` means it could not be lowered at
/// all. `HitCap` is deliberately NOT here — a run that started and ran out of budget produces a
/// working cursor, which is what `raise_cap` exists for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TmDecline {
    TooLarge,
    Overflow,
    Lower(String),
}

pub struct Compiled {
    pub diagnostics: Vec<Diagnostic>,
    pub session: Option<Session>,
}

pub struct Session {
    pub(crate) lambda: Result<LambdaCursor, LowerError>,
    pub(crate) tm: Result<TmCursor<Rc<Machine>>, TmDecline>,
    pub(crate) program: Option<TmProgram>,
    pub(crate) map: SourceMap,
    pub(crate) caps: TmCaps,
}

impl Session {
    pub fn compile(src: &str, kind: EncodingKind) -> Compiled {
        let (program, mut diagnostics) = parser::parse(src);
        let Some(program) = program else {
            return Compiled { diagnostics, session: None };
        };
        diagnostics.extend(typeck::typecheck(&program));
        if diagnostics.iter().any(|d| d.severity == redextape_core::Severity::Error) {
            return Compiled { diagnostics, session: None };
        }
        // ... result_type, build_from_program, lower the λ leg, run_tm_described for the TM leg,
        //     project TmProgram once, build the cursors.
        todo!("see the steps below")
    }
}
```

**`todo!` is denied by the workspace lints** — that sketch shows the shape, not the code you commit. Write the body in this step.

The construction sequence, all verified to exist:

```rust
let ty = typeck::result_type(&program)?;                       // the result Ty run_tm_described needs
let enc = kind.at(64);                                         // any width; build_from_program needs an Encoding
let (core, map) = SourceMap::build_from_program(&program, &*enc);
let lambda = lambda::lower(&core).map(|t| LambdaCursor::new(&t, lambda::MAX_REDUCTION_STEPS));
let tm = match tm::run_tm_described(&core, kind, ty, DEFAULT_CAPS) {
    Ok(d) => {
        let init = d.header.init(d.machine.tapes);
        let width = d.header.width;
        let machine = Rc::new(d.machine);
        Ok((TmProgram::of(&machine, width), TmCursor::new(Rc::clone(&machine), &init, DEFAULT_CAPS)))
    }
    Err(TmRun::TooLarge) => Err(TmDecline::TooLarge),
    Err(TmRun::Overflow) => Err(TmDecline::Overflow),
    Err(TmRun::LowerError(e)) => Err(TmDecline::Lower(format!("{e:?}"))),
    Err(other) => Err(TmDecline::Lower(format!("{other:?}"))),
};
```

**`run_tm_described` returns `Err` only for a decline; a `HitCap` run still returns `Ok`** with `run: TmRun::HitCap` — check that against the function before relying on it, and handle whichever shape is true.

`typeck::result_type` returns a `Result`; a program that typechecked cannot fail it, but **do not `unwrap`** — map the error into a diagnostic and return no session.

- [ ] **Step 5: Write the shell**

`crates/redextape-wasm/src/lib.rs`:

```rust
//! The `#[wasm_bindgen]` surface. Marshalling only — every decision lives in `session.rs`; see that
//! module's header for why.
//!
//! NO PANIC MAY CROSS THIS BOUNDARY. A Rust panic under wasm is an abort that poisons the module —
//! there is no unwinding to catch it — so every fallible export returns `Result<_, JsValue>`.
//! `console_error_panic_hook` is installed for legibility if one ever escapes, not as a strategy.

mod session;

use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct Session(session::Session);

#[wasm_bindgen]
pub fn compile(src: &str, encoding: &str) -> Result<JsValue, JsValue> {
    // encoding parses through `EncodingKind::parse`, which returns None for an unknown name — a
    // renderer sending a typo gets an error rather than a silent default.
    todo!("write in this step")
}
```

Serialize with `serde_wasm_bindgen::to_value`.

**`Diagnostic` does NOT derive `Serialize`** — checked: PR 2 added the `cfg_attr` to `Span` and `TokenClass` only, because those were the only types the view models embedded. `compile` returns diagnostics, so this must be resolved. Two options:

- **Add `#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]` to `Diagnostic` and `Severity` in core** — one line each, the same shape and the same justification as PR 2's two. This is the smaller change and keeps one representation.
- **Project it here** into a local `DiagnosticView`. Avoids touching core, but adds a second shape of the same data that must be kept in step — the drift this repo has recorded four times.

Take the first unless you find a reason not to, and say which you took. If you take it, note that it widens this PR's core footprint beyond Task 1's four items, and mention it in the commit.

- [ ] **Step 6: Run the tests**

Run: `cargo nextest run -p redextape-wasm`

Expected: PASS, all three.

Run: `cargo clippy -p redextape-wasm --all-targets -- -D warnings`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-wasm Cargo.toml
git commit -m "wasm: the Session, and a crate shaped so its logic can be covered

cdylib for wasm-pack, rlib so cargo test compiles session.rs natively. Every
branch lives in the inner module because wasm-bindgen-test runs in a browser
while llvm-cov instruments the native build — logic in the shell would be
uncovered by construction and drag the workspace's 80% floor with it.

TmDecline is defined here rather than reused from TmRun because the UI must not
flatten the reasons: TooLarge means lowering refused and nothing ran, Overflow
means no width fits the value, Lower means it could not be lowered. HitCap is
deliberately absent — that run produced a working cursor, which is what
raise_cap is for.

Both legs declining is a normal outcome. A closure over a captured `let mut` is
refused by the λ backend and runs on the TM, and a TM-only session is the
correct answer rather than a failure."
```

---

### Task 3: The λ leg

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs`, `crates/redextape-wasm/src/lib.rs`

**Interfaces:**
- Consumes: Task 2's `Session`.
- Produces: `lambda_status`, `step_lambda`, `lambda_state`, `lambda_ast`, `raise_lambda_cap` on the inner `Session`, and their `#[wasm_bindgen]` shells (`lambdaStatus`, `stepLambda`, `lambdaState`, `lambdaAst`, `raiseLambdaCap`).

- [ ] **Step 1: Write the failing tests**

In `session.rs`'s test module:

```rust
    #[test]
    fn stepping_the_lambda_leg_advances_its_state_and_stops_at_the_end() {
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        let before = s.lambda_state(usize::MAX).expect("λ available").step;
        assert!(s.step_lambda().expect("λ available"), "this program takes at least one step");
        assert!(s.lambda_state(usize::MAX).expect("λ available").step > before);

        while s.step_lambda().unwrap_or(false) {}
        assert!(!s.step_lambda().expect("λ available"), "a finished run keeps reporting false");
    }

    #[test]
    fn a_declined_lambda_leg_reports_why_and_refuses_its_methods() {
        let src = "let mut n = 0; let f = || { n = n + 1; n }; f()";
        let s = Session::compile(src, EncodingKind::Unary).session.expect("TM handles it");
        assert!(!s.lambda_status().available);
        assert!(!s.lambda_status().reason.is_empty(), "the reason is the payload the UI needs");
        assert!(s.lambda_state(usize::MAX).is_err(), "no state without a leg");
    }

    #[test]
    fn raising_the_lambda_cap_lets_a_capped_run_continue() {
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        s.cap_lambda_at(1);                      // test-only helper; see Step 3
        while s.step_lambda().unwrap_or(false) {}
        let stalled = s.lambda_state(usize::MAX).expect("λ available").step;
        s.raise_lambda_cap(1_000_000).expect("λ available");
        assert!(s.step_lambda().expect("λ available"), "raising the cap must let it proceed");
        assert!(s.lambda_state(usize::MAX).expect("λ available").step > stalled);
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo nextest run -p redextape-wasm`

Expected: FAIL to compile — the methods do not exist.

- [ ] **Step 3: Implement on the inner `Session`**

Each method returns `Result<_, LegAbsent>` where the λ leg is absent, so the shell can turn that into a `JsValue` error rather than a panic. Define a small error type; do not use `String` for it — the shell needs to distinguish "no leg" from any other failure.

`cap_lambda_at` is a `#[cfg(test)]` helper that rebuilds the cursor with a small cap, so the raise test has something to raise from. Keep it test-only.

**`lambda_state` delegates to `LambdaState::render(cursor, byte_budget)`** — PR 2 removed the map and redex parameters, so this is the whole call.

- [ ] **Step 4: Add the shells**

`lambdaStatus`, `stepLambda`, `lambdaState`, `lambdaAst`, `raiseLambdaCap` in `lib.rs`, each converting the inner result into `Result<JsValue, JsValue>`. No branching beyond the error conversion.

- [ ] **Step 5: Run the tests**

Run: `cargo nextest run -p redextape-wasm` and `cargo clippy -p redextape-wasm --all-targets -- -D warnings`

Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-wasm
git commit -m "wasm: the λ leg — step, render, ast, and continue past the cap

Every method answers Err when the leg is absent rather than panicking, because a
panic under wasm aborts the module rather than unwinding. A declined leg reports
its reason: that is the one thing the UI has to say, and an Option would have
thrown it away.

lambda_state is render(cursor, byte_budget) and nothing else — PR 2 removed the
map and redex parameters along with source_node."
```

---

### Task 4: The TM leg

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs`, `crates/redextape-wasm/src/lib.rs`

**Interfaces:**
- Consumes: Tasks 1–2. Uses `Tape::slice` and the map-taking `TmState::window` from Task 1.
- Produces: `tm_status`, `tm_program`, `step_tm`, `tm_state`, `tape_slice`, `raise_tm_cap`, `source_span`, and their shells.

- [ ] **Step 1: Write the failing tests**

```rust
    #[test]
    fn the_machine_crosses_once_and_the_state_is_windowed() {
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        let p = s.tm_program().expect("TM available");
        assert!(!p.states.is_empty());
        assert_eq!(p.start, p.start, "start is reported");   // replace with a real expectation

        for _ in 0..50 {
            if !s.step_tm().expect("TM available") {
                break;
            }
        }
        let st = s.tm_state(3).expect("TM available");
        assert_eq!(st.window.len(), p.tapes);
        for w in &st.window {
            assert!(w.len() <= 7, "radius 3 yields at most 7 cells, got {}", w.len());
        }
    }

    /// The slice must speak the same coordinates the window reports, or a scrolling renderer cannot
    /// relate the two.
    #[test]
    fn tape_slice_agrees_with_the_window_it_overlaps() {
        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        for _ in 0..50 {
            if !s.step_tm().expect("TM available") {
                break;
            }
        }
        let st = s.tm_state(3).expect("TM available");
        let from = st.window_start[0];
        let got = s.tape_slice(0, from, from + st.window[0].len()).expect("TM available");
        assert_eq!(got, st.window[0]);
    }

    #[test]
    fn a_source_span_resolves_for_a_node_the_map_knows() {
        let s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        let st = s.tm_state(1).expect("TM available");
        if let Some(node) = st.source_node {
            assert!(s.source_span(node).is_some(), "a node the TM leg named must resolve in the source leg");
        }
    }

    #[test]
    fn an_out_of_range_tape_index_is_an_error_not_a_panic() {
        let s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
        assert!(s.tape_slice(9_999, 0, 10).is_err(), "an absent tape must not index out of bounds");
    }
```

Replace the placeholder `assert_eq!(p.start, p.start, ..)` with a real expectation — read what `Machine::start` is for this program and pin it, or assert it names a state that exists (`p.states.get(p.start as usize).is_some()`).

- [ ] **Step 2: Run to verify they fail**

Run: `cargo nextest run -p redextape-wasm` — FAIL, methods missing.

- [ ] **Step 3: Implement**

`tm_program` clones the cached `TmProgram` — it is projected once at compile time and never re-walked. `tm_state` calls `TmState::window(cursor, &self.map, radius)`. `tape_slice` looks the tape up with `.get(tape)` and answers `Err` for an absent index, never `[]`.

- [ ] **Step 4: Add the shells and run**

Run: `cargo nextest run -p redextape-wasm` and clippy with `-D warnings`.

Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-wasm
git commit -m "wasm: the TM leg — program once, state windowed, tape sliced

tmProgram is the cached projection, not a re-walk: the map demo is 3,203 states
over 344,999 steps, and re-sending the machine per step is the cost the
TmProgram/TmState split exists to avoid.

tapeSlice speaks the coordinates tmState reports, so a scrolling renderer can
relate the two, and an absent tape index answers Err rather than indexing out of
bounds."
```

---

### Task 5: Prove it in a browser, and gate it

**Files:**
- Create: `crates/redextape-wasm/tests/browser.rs`
- Modify: `scripts/check-all.sh`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: a `wasm-bindgen-test` suite runnable in headless Chrome, and a gate leg that builds the crate for wasm32.

**Why this task exists separately:** everything above is native. Nothing so far proves the crate *links* as wasm, that `serde-wasm-bindgen` marshals these types, or that `wasm-pack build` succeeds — which is Plan 4's own named testable outcome.

- [ ] **Step 1: Write the browser test**

`crates/redextape-wasm/tests/browser.rs`:

```rust
//! Runs in headless Chrome via `wasm-bindgen-test`, NOT under `cargo test`. What it proves that the
//! native tests cannot: that the crate links as wasm at all, and that `serde-wasm-bindgen` marshals
//! these types across the boundary rather than merely compiling.

use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
fn compile_step_and_read_both_legs() {
    // ... drive `compile`, step each leg, read a state back, and assert the values that come back
    //     are the ones a native run produces.
}

#[wasm_bindgen_test]
fn a_lambda_limitation_program_reports_a_tm_only_session() {
    // ... the boundary must carry a declined leg's reason, not lose it in marshalling.
}
```

Write both bodies. The second matters more than it looks: a declined leg crossing the boundary is the path most likely to be silently lossy, and it is the one §7 says the UI must render honestly.

- [ ] **Step 2: Run it**

Run: `wasm-pack test --headless --chrome crates/redextape-wasm`

Expected: both tests pass. If Chrome is unavailable in the environment, say so and report what you ran instead — do not silently skip and claim it passed.

- [ ] **Step 3: Verify the package builds**

Run: `wasm-pack build crates/redextape-wasm --release --target web`

Expected: succeeds. This is Plan 4's named testable outcome and what PR 3b's `web/` will import.

- [ ] **Step 4: Add a gate leg**

Nothing in `check-all.sh` builds the new crate for wasm32 — the existing wasm leg is `-p redextape-core --lib`. A crate whose only real target is wasm must be built for it in the gate, or a wasm-only compile error reaches PR 3b.

Add a `LEGS` row checking `-p redextape-wasm --lib` for `wasm32-unknown-unknown`. Read the table's comments and the existing `wasm` kind first — PR 2 parameterized it on cargo args, so this may be one row and no new kind. `check_legs`'s whitelist and `do_leg`'s dispatch must agree, and `--list` must show it under `--no-llvm` and not `--llvm-only`.

**Do not add `wasm-pack test` to the gate** — it needs a browser, and `check-all.sh` is the local merge check. CI is where a browser belongs, and that is PR 3b's `web` job.

- [ ] **Step 5: Run the full gate and coverage**

Run: `scripts/check-all.sh --no-llvm`

Expected: green, with the new leg listed.

Run: `cargo llvm-cov nextest --workspace --fail-under-lines 80`

Expected: PASS. **Report the figure.** The tree was at 95.85% before this crate existed; if the new crate drops it materially, the shell is doing more than marshalling and the logic belongs in `session.rs`.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-wasm/tests/browser.rs scripts/check-all.sh
git commit -m "wasm: prove it in a browser, and gate the target it exists for

The native tests cover every branch but prove nothing about wasm: not that the
crate links, not that serde-wasm-bindgen marshals these types. wasm-bindgen-test
in headless Chrome does, and wasm-pack build succeeding is Plan 4's own named
testable outcome.

A gate leg builds the crate for wasm32. The existing leg covers redextape-core
--lib only, so nothing checked the crate whose only real target IS wasm — a
wasm-only compile error would have reached PR 3b. wasm-pack test stays out of
check-all.sh: it needs a browser, and the local merge check should not."
```

---

## Self-Review

**Spec coverage.** §5.1's `Session` shape and every method in its TypeScript sketch map to a task: `compile` (2), the λ five (3), the TM six plus `sourceSpan` (4). §5.2's thin-shell requirement is Task 2 Step 1's `crate-type` and the module split, with Task 5 Step 5 measuring whether it held. §5.3's dependency table is Task 2 Step 1 verbatim. The four gaps §5 does not mention are Task 1.

**Deliberately out of scope**, traceable rather than dropped: `web/`, pnpm, the `Dockerfile` and `ci.yml` web edits, and arming the `docker` push are PR 3b (spec §6). §6.2's CodeMirror decoration path and §6.4's caps affordance are renderer work with no consumer until `web/` exists. §6.1's redex highlight additionally needs the printer to record where a path lands, which PR 2 recorded as unpriced — it is not in this plan and PR 3b must price it before promising it.

**Placeholder scan.** Two `todo!()` sketches appear in Task 2 and are labelled as shape-not-code with the instruction to write the body in that step; the workspace lints deny `todo!`, so neither can survive a commit. Task 4 Step 1 carries a deliberately placeholder assertion (`p.start, p.start`) with an explicit instruction to replace it and two concrete options — flagged rather than left to be discovered.

**Type consistency.** `TmDecline` is defined once (Task 2) and used in Tasks 2–4. `TmState::window(c, map, radius)` is three-argument in Task 1's implementation, Task 1's tests, and Task 4's call. `LambdaState::render(c, byte_budget)` is two-argument everywhere, matching what PR 2 shipped. `Tape::slice(from, to)` matches between Task 1 and Task 4.

**Two risks worth naming.** First, Task 5 Step 2 depends on a headless Chrome being available; if it is not, the browser half of this PR is unproven and the plan says to report that rather than paper over it. Second, the coverage figure after Task 5 is the only real test of whether the thin-shell design held — the plan cannot predict it, so it asks for the number and names what a material drop would mean.
