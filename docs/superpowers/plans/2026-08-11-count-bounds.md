# Count Bounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound the machine-state count and the `NodeId` count at the points that mint them, so four narrowing casts cite a check instead of a prose RAM argument — and so a 4 KB source program stops being able to OOM the wasm module.

**Architecture:** A ceiling inside `tm::build::Builder` (the single choke point every state goes through) makes `states.len() as StateId` provable by counting rather than predicting; the refusal travels out through `lower_tm_guarded -> Option` into the `TmRun::TooLarge` path that already exists and is already wired to the UI. Separately, `NodeGen` saturates at a `MAX_NODE_ID` chosen to sit under `i32::MAX`, which makes `LinkIndex::build`'s `i32::try_from` provably succeed.

**Tech Stack:** Rust 2024, `cargo nextest` + `cargo test --doc`, `clippy::pedantic` with `-D warnings`.

> **Corrections, found during execution of this plan.** This document is left as written apart from
> the notes below — it is the record of what was planned, and rewriting it would hide that the plan
> was where the errors were. Thirteen defects were found across execution and every one was in this
> plan or its spec; none was in the codebase. The ones that changed shipped values:
>
> - **The worst shipped demo is 49,135 binary states, not 38,070.** The figure below came from ten
>   demos picked by hand and asserted to be the largest members of `native_oracle.rs`'s
>   `FIRST_ORDER_DEMOS`. That array has 46 entries and five exceed or approach the figure; the true
>   worst is its `map`/`add1`/`ap2` program. Derived figures move with it: **35.7 MB**, not 27.7 MB;
>   **20×** headroom, not 26×; **4.9%** of the ceiling, not 3.8%. Safety is unaffected. This was the
>   floor of the whole "never rejects a legitimate program" argument, and it was never checked.
> - **The balanced generator takes LEAF COUNT, not `code.len()`.** Task 4's code below says
>   `balanced(0, 256)` / `balanced(0, 1_024)`; it originally said 512 / 2,048, taken from the spec's
>   `code.len()` column. This shape lowers two instructions per leaf.
> - **Tokens are not bytes.** "4 KB" / "16 KB" for the 4,094- and 16,382-token trees are really
>   **6 KB** / **24 KB** — this shape spends ~6 bytes per token.
> - **17 `lower_tm_guarded` call sites, not 15.** The enumerated list was right; the count was not.
> - **`MAX_LOWER_DEPTH` does not bound `code.len()`** in general — it bounds Core *depth*, and 3,472
>   is the ceiling for depth-limited shapes only. A balanced tree exceeds it, which is the entire
>   point of the tests this plan asks for.
> - **Task 2's `git add` omitted `tm.rs`**, which Task 2 Step 6 requires editing.
> - **`attribute.rs` was never mentioned anywhere in this plan or its spec**, and it held the same
>   wrong-answer path the slice exists to close. Closing it was a design gap, not an implementation
>   miss — see the spec and PR #32.

## Global Constraints

- **Design doc:** `docs/superpowers/specs/2026-08-11-count-bounds-design.md`. Every constant's justification lives there; doc comments cite it by section.
- **`panic`, `expect`, `unwrap`, `todo`, `unimplemented` are DENIED in library code** (`clippy.toml` + `[workspace.lints.clippy]` in `Cargo.toml`). They are allowed inside `#[test]` fns and bare `#[cfg(test)]` modules only. `tests/` and `examples/` targets are in neither, so those files carry a file-level `#![allow(...)]`.
- **`clippy::pedantic` is on with nothing allowed globally.** New public items need `#[must_use]` where they return a value and `# Errors` doc sections where they return `Result`.
- **The pre-commit hook runs `cargo fmt` + `cargo clippy -D warnings` on every commit.** A commit that does not compile cleanly cannot be made. Never use `--no-verify`. If a task's commit split turns out to be infeasible, collapse the commits and say so.
- **Comment style is this repo's, not the ecosystem default:** doc comments explain *why*, name the alternative that was rejected, and quote measurements. Match the density of the code you are editing — it is heavy. `///` in Rust.
- **Measured values are load-bearing.** Do not round, "clean up", or re-derive the numbers in doc comments; they come from the spec's §3 and a probe. If a number looks wrong, stop and say so rather than changing it.
- **Verify before claiming.** Run the command, read the output, then report. `scripts/check-all.sh --no-llvm --no-browser` is the local gate for this work.

---

### Task 1: The missing serde clippy row

Independent of everything else. Do it first because it is finishable in a minute.

**Files:**
- Modify: `scripts/check-all.sh:120-141` (the `LEGS` table)

**Interfaces:**
- Consumes: nothing
- Produces: nothing (no Rust code depends on this)

- [ ] **Step 1: Confirm the gap is real**

Run:
```bash
scripts/check-all.sh --list | grep serde
```

Expected — three rows, none of them `clippy`:
```
base	test	-p redextape-core --features serde
base	wasm	-p redextape-core --lib --features serde
```
(plus `base	wasm	-p redextape-core --lib`, which has no `serde`)

If a `clippy` row already appears, stop: the task is done and the plan is stale.

- [ ] **Step 2: Add the row**

In `scripts/check-all.sh`, in the `LEGS=(` array, insert the clippy row immediately **above** the matching test row so cheap legs stay first, matching the comment "ROW ORDER IS RUN ORDER":

```bash
  "base|clippy|--workspace --all-targets"
  "base|test|--workspace"
  "base|clippy|-p redextape-core --features serde --all-targets"
  "base|test|-p redextape-core --features serde"
```

`--all-targets` is what every other clippy row in the table uses.

- [ ] **Step 3: Verify the row is selected and validated**

Run:
```bash
scripts/check-all.sh --list | grep serde
```

Expected — the clippy row now appears, before the test row:
```
base	clippy	-p redextape-core --features serde --all-targets
base	test	-p redextape-core --features serde
base	wasm	-p redextape-core --lib --features serde
```

`--list` runs `check_legs()` first, so a bad tier or kind would have aborted before printing.

- [ ] **Step 4: Run the new leg for real**

Run:
```bash
cargo clippy -p redextape-core --features serde --all-targets -- -D warnings
```

Expected: `Finished`, no warnings. If it reports warnings, that is the gap having been real — fix them in this task and note what they were in the commit message.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-all.sh
git commit -m "check-all: lint the serde config, which was built and tested but never linted

Every serde site in redextape-core is currently a derive, and derive
expansions are not linted, so the hole was benign. The first hand-written
#[cfg(feature = \"serde\")] function would have landed unlinted while the
gate stayed green — the 'covers less than its name claims' defect this
script's own header is about."
```

---

### Task 2: `MAX_MACHINE_STATES` and the `Builder` ceiling

The ceiling itself, plus the two cast-site docs it makes true. A reviewer can accept this and reject Task 3: after this task the cast is provable and the docs are honest, even though nothing yet *reports* a refusal.

**Files:**
- Modify: `crates/redextape-core/src/tm/build.rs` — add the constant, the `overflowed` field, the `overflowed()` accessor, the ceiling in `state()`/`accept()`, and rewrite both method docs
- Modify: `crates/redextape-core/src/sourcemap.rs:168-178` — replace the restated RAM argument with a citation
- Test: `crates/redextape-core/src/tm/build.rs` (inline `#[cfg(test)] mod tests`, which already exists at line ~204)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `pub const MAX_MACHINE_STATES: usize = 1_000_000;` in `crate::tm::build`
  - `Builder::overflowed(&self) -> bool`
  - `Builder::state`/`Builder::accept` unchanged signatures (`&mut self, impl Into<String>) -> StateId`), new behaviour past the ceiling: return `0`, do not push, set the flag

- [ ] **Step 1: Write the failing test**

In `crates/redextape-core/src/tm/build.rs`, inside the existing `#[cfg(test)] mod tests`, add:

```rust
    /// `Builder` stops allocating at `MAX_MACHINE_STATES` and says so, rather than growing until the
    /// allocator gives up.
    ///
    /// THE ONE TEST THAT TRIPS THE CEILING DIRECTLY. It allocates the full ceiling in rule-less
    /// states with a 1-char name — ~64 MB and a second or two, against the ~727 MB a ceiling's worth
    /// of REAL states costs (see `MAX_MACHINE_STATES`). Every other test reaches the refusal through
    /// `lower_tm_all`'s cheap `code.len()` pre-check, which never allocates a state at all; the two
    /// that reach it through gadget expansion are slow-tier for exactly the 727 MB reason.
    #[test]
    fn the_builder_stops_at_the_state_ceiling_and_reports_it() {
        let mut b = Builder::new();
        for _ in 0..MAX_MACHINE_STATES {
            b.state("s");
        }
        assert!(!b.overflowed(), "exactly the ceiling is allowed, not one less");
        assert_eq!(b.state_count(), MAX_MACHINE_STATES);

        let past = b.state("one too many");
        assert!(b.overflowed(), "one past the ceiling must raise the flag");
        assert_eq!(past, 0, "a refused allocation returns state 0, which is always in range by then");
        assert_eq!(b.state_count(), MAX_MACHINE_STATES, "and must not have pushed");

        // `accept` shares the ceiling: a machine cannot smuggle extra states in through the other door.
        assert_eq!(b.accept("also refused"), 0);
        assert_eq!(b.state_count(), MAX_MACHINE_STATES);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cargo test -p redextape-core --lib tm::build::tests::the_builder_stops 2>&1 | tail -20
```

Expected: FAIL to **compile**, with `cannot find value MAX_MACHINE_STATES in this scope` and `no method named overflowed found for struct Builder`.

- [ ] **Step 3: Add the constant**

In `crates/redextape-core/src/tm/build.rs`, next to the other `pub const`s (`MAX_TAPES` at line ~21, `MAX_FIELD_WIDTH` at line ~72), add:

```rust
/// The most states any one `Machine` may contain. Reaching it makes `Builder` stop allocating and
/// raise `overflowed`; `lower_tm_all` then refuses the program rather than laying out the rest.
///
/// MEASURED, not chosen for roundness. At **727 bytes per state** — RSS delta around `lower_tm`,
/// stable across a 15x size range, against a `size_of::<State>()` of 56 that understates the heap
/// `String` name and `Vec<Rule>` by 13x — this ceiling is 727 MB. Three facts fix it there:
///
///   * The worst program this project SHIPS (the `map` + `fold` demo in `native_oracle.rs`'s
///     `FIRST_ORDER_DEMOS`) builds **38,070** states, 27.7 MB. The ceiling is 26x that.
///   * A balanced arithmetic tree of 1,022 tokens builds 575,861 states (398 MB) and works today;
///     one of 4,094 tokens builds 8,595,317 (6.0 GB) and does not — that is fatal in wasm32, and at
///     16,382 tokens the same shape SIGKILLed an 8 GB budget. The ceiling admits the largest size
///     measured to work and refuses the first size measured not to.
///   * `StateId` is a `u32`, so the `states.len() as StateId` casts below sit a factor of **4,295**
///     under `StateId::MAX`. That is what makes them provable rather than argued.
///
/// **WHY A STATE COUNT AND NOT A `Program::code.len()` CAP.** Cost per instruction is not a
/// constant: 1 state for `Halt`/`Jmp`, 571 for `Box` under `Binary`, and for `Call` it scales with
/// the local bank — 973 states per call site at `n_loc` 4, 34,577 at 128, so ~270,000 (196 MB) for
/// ONE `Call` at the largest `n_loc` that `MAX_FRAME_LOC` permits. A length that bounds the
/// allocation is single digits; a length that admits real programs bounds nothing. `lower_tm_all`'s
/// three guards bound the MULTIPLIERS (`MAX_SLOTS` the register footprint, `MAX_FRAME_LOC` the frame
/// bank, `MAX_MUL_INSTRS` the `Mul` count) and nothing bounded the base, so their product was
/// unbounded. This bounds the product directly.
///
/// **AND WHY COUNTING RATHER THAN PREDICTING.** A `state_count_unrepresentable(prog, sm, enc)` that
/// estimated the cost up front would be symmetric with those three and would refuse before
/// allocating anything. It would also duplicate per-gadget cost knowledge in a second place, which
/// goes stale silently the first time a gadget changes — the same failure mode as the prose this
/// replaces. `Builder::state`/`accept` is the single choke point every state goes through, so a
/// ceiling here is exact and cannot drift from what the gadgets actually build.
///
/// Full measurement tables: `docs/superpowers/specs/2026-08-11-count-bounds-design.md` §3, and
/// `cargo run --release --example state_cost_probe -p redextape-core` re-derives them.
pub const MAX_MACHINE_STATES: usize = 1_000_000;

/// The state-0 sentinel `state`/`accept` return past the ceiling is only addressable because a
/// state 0 EXISTS by then, which needs the ceiling to be positive. Checked at COMPILE time rather
/// than in a test: a test asserting a property of a literal constant proves nothing a reader cannot
/// see, where this makes a future edit to zero fail the build.
const _: () = assert!(MAX_MACHINE_STATES > 0, "a zero ceiling would put the state-0 sentinel out of range");
```

- [ ] **Step 4: Add the field and the accessor**

Change the struct at `crates/redextape-core/src/tm/build.rs:113-118`:

```rust
/// Incrementally builds a `Machine`'s states.
#[derive(Default)]
pub struct Builder {
    states: Vec<State>,
    overflow: Option<StateId>,
    overflowed: bool,
}
```

Add the accessor next to `state_count()` (line ~188):

```rust
    /// Whether allocation has hit `MAX_MACHINE_STATES`.
    ///
    /// Once true, every `state`/`accept` call has returned the state-0 sentinel without pushing, so
    /// the part-built machine is nonsense — rules have been attached to a state that means nothing —
    /// and it must be DISCARDED rather than finished. `lower_tm_all` checks this once per instruction
    /// and refuses the program.
    ///
    /// NOT THE SAME THING AS `overflow_state()`, despite the names sitting next to each other.
    /// That one is the machine's own runtime overflow guard — a value too wide for its field, a
    /// property of the program being run. This one is a build-time refusal: the machine was too big
    /// to lay out and no machine exists.
    #[must_use]
    pub fn overflowed(&self) -> bool {
        self.overflowed
    }
```

- [ ] **Step 5: Add the ceiling to `state()` and `accept()`, replacing their docs**

Replace `crates/redextape-core/src/tm/build.rs:150-182` (the `state` doc, `state`, the `accept` doc, and `accept`) entirely with:

```rust
    /// Allocate a fresh non-accept state; returns its id. Names should be identifiers (no reserved
    /// text-form chars) so the produced machine stays round-trippable.
    ///
    /// **BOUNDED BY `MAX_MACHINE_STATES`, CHECKED ONE LINE BELOW** — which is what makes the cast
    /// provable rather than argued. `states.len()` cannot exceed the ceiling, and the ceiling is
    /// 4,295x under `StateId::MAX`, so the `as StateId` narrowing cannot truncate. The `#[allow]`
    /// stays only because clippy cannot see the guard above it.
    ///
    /// **PAST THE CEILING THIS RETURNS STATE 0 WITHOUT PUSHING**, and sets `overflowed`. State 0 is
    /// necessarily in range by then — a million states exist before the ceiling can trip — so a
    /// caller that goes on to `add_rule` against the returned id indexes a live state instead of
    /// panicking. It builds nonsense, which is exactly why `overflowed()` must be checked before the
    /// machine is used; being total here and refusing at the caller is the same shape of answer
    /// `lower_tm_all`'s three existing guards already give.
    ///
    /// **THIS REPLACES A PROSE ARGUMENT THAT WAS WRONG.** The previous doc reasoned that
    /// `prog.code.len()` was bounded by ~172 GB of resident memory and so the cast was unreachable.
    /// Measurement found a 4 KB balanced expression building an 8.6M-state, 6.0 GB machine and a
    /// 16 KB one SIGKILLing an 8 GB budget — both reachable from the editor through
    /// `run_tm_described`. The cast was never the defect; the unbounded product was, and the process
    /// died at ~0.2% of the way to `StateId::MAX`. See `MAX_MACHINE_STATES` and
    /// `docs/superpowers/specs/2026-08-11-count-bounds-design.md` §3.
    #[allow(clippy::cast_possible_truncation)]
    pub fn state(&mut self, name: impl Into<String>) -> StateId {
        if self.states.len() >= MAX_MACHINE_STATES {
            self.overflowed = true;
            return 0;
        }
        let id = self.states.len() as StateId;
        self.states.push(State { name: name.into(), accept: false, rules: Vec::new() });
        id
    }

    /// Allocate a fresh accept (halt) state.
    ///
    /// Bounded and total the same way `state` is, and sharing the same counter — see that method's
    /// doc. Sharing matters: a ceiling on one door only would let a machine smuggle unbounded states
    /// in through the other.
    #[allow(clippy::cast_possible_truncation)]
    pub fn accept(&mut self, name: impl Into<String>) -> StateId {
        if self.states.len() >= MAX_MACHINE_STATES {
            self.overflowed = true;
            return 0;
        }
        let id = self.states.len() as StateId;
        self.states.push(State { name: name.into(), accept: true, rules: Vec::new() });
        id
    }
```

- [ ] **Step 6: Re-export the constant**

`tests/` targets reach it as `redextape_core::tm::build::MAX_MACHINE_STATES` either way, but the
sibling constants are all re-exported and an inconsistent one is a papercut. In
`crates/redextape-core/src/tm.rs:25-28`, add it to the `pub use build::{...}` list in alphabetical
position, between `MAX_FIELD_WIDTH` and `MAX_TAPES`:

```rust
pub use build::{
    AT, BOX, Builder, HEAP, MARK, MAX_FIELD_WIDTH, MAX_MACHINE_STATES, MAX_TAPES, MIN_FIELD_WIDTH, REG, RuleSpec,
    SEP, STACK, Slot, TAPE_NAMES, TAPES, WORK, ZERO,
};
```

Run `cargo fmt --all` afterwards — the line will need rewrapping and the pre-commit hook checks it.

- [ ] **Step 7: Run the tests to verify they pass**

Run:
```bash
cargo test -p redextape-core --lib tm::build::tests 2>&1 | tail -20
```

Expected: PASS, including `the_builder_stops_at_the_state_ceiling_and_reports_it`, which takes a second or two — it allocates a million states.

- [ ] **Step 8: Replace the restated RAM argument in `sourcemap.rs`**

Replace the comment block and cast at `crates/redextape-core/src/sourcemap.rs:168-178` with:

```rust
        // `state` is a loop index over `machine.states`, a `Vec<State>` this function only ever gets
        // from `lower_tm_mapped` — built via `Builder::state`/`accept` (push-only, one call per
        // state) and nothing else. Both enforce `MAX_MACHINE_STATES`, which is 4,295x under
        // `StateId::MAX`, so the narrowing cannot truncate. The `#[allow]` stays only because clippy
        // cannot see a guard two modules away.
        //
        // THIS USED TO RESTATE `Builder::state`'s ~172 GB memory argument IN FULL, which is how the
        // same wrong reasoning came to live in two files: the argument was prose, so keeping it in
        // step meant remembering to. Now there is one check and this cites it.
        #[allow(clippy::cast_possible_truncation)]
        out.entry(node).or_default().push(state as StateId);
```

- [ ] **Step 9: Verify the whole crate is green**

Run:
```bash
cargo clippy -p redextape-core --all-targets -- -D warnings && cargo nextest run -p redextape-core 2>&1 | tail -15
```

Expected: clippy clean; all tests pass. Nothing should regress — the ceiling is far above anything the existing suite builds.

- [ ] **Step 10: Commit**

```bash
git add crates/redextape-core/src/tm/build.rs crates/redextape-core/src/sourcemap.rs
git commit -m "tm: bound the state count where states are minted, not where they are cast

Builder::state/accept is the single choke point every state goes through,
so a ceiling there is exact rather than predicted and cannot go stale when
a gadget's cost changes. That makes 'states.len() as StateId' provable one
line above itself, and lets both cast sites delete the ~172 GB memory
argument they were arguing from -- the second of which was a verbatim copy
of the first, which is how prose bounds drift.

The argument was also wrong. A 4 KB balanced expression builds an 8.6M
state, 6.0 GB machine; 16 KB SIGKILLs an 8 GB budget. See the spec's S3.

MAX_MACHINE_STATES = 1_000_000 is 26x the worst shipped demo (38,070
states) and 4,295x under StateId::MAX, at a measured 727 bytes a state."
```

---

### Task 3: Plumb the refusal out to `TmRun::TooLarge`

Without this, `attempt` simulates the degenerate machine, sees `Halted` at a state that is not the overflow guard, and reports `TmRun::Ran` over tapes that decode to nothing — the exact bug `lower_and_size`'s doc says it fixed for `MAX_SLOTS`. Task 2 and this one cannot be usefully split: the intermediate state is a wrong answer.

**Files:**
- Modify: `crates/redextape-core/src/tm/lower_tm.rs` — `lower_tm_all` gains a `refused` return, a cheap `code.len()` pre-check, and a per-instruction bail; `lower_tm_guarded` returns `Option`
- Modify: `crates/redextape-core/src/tm.rs` — `attempt` returns `Option`, its four call sites handle it, `TmRun::TooLarge`'s doc gains the fourth refusal, `lower_and_size`'s doc stops claiming to be the single place
- Modify (mechanical, `.expect(...)` at each site): `crates/redextape-core/tests/tm_static_delimiter_safety.rs:89,108`, `crates/redextape-core/tests/tm_bank_invariant.rs:86,266`, `crates/redextape-core/tests/tm_width_equivalence.rs:299,498`, `crates/redextape-core/tests/tm_exhaustive_bank_safety.rs:141,465`, `crates/redextape-core/examples/concurrency_probe.rs:223`, `crates/redextape-core/examples/width_report.rs:84,101,351`, `crates/redextape-core/examples/step_survey.rs:570,586`, and the three inline tests at `crates/redextape-core/src/tm/lower_tm.rs:370,389,465`
- Test: `crates/redextape-core/src/tm.rs` (inline `#[cfg(test)] mod run_tm_tests`)

**Interfaces:**
- Consumes: `MAX_MACHINE_STATES`, `Builder::overflowed()` from Task 2
- Produces:
  - `pub fn lower_tm_guarded(prog: &Program, enc: &dyn Encoding) -> Option<(Machine, StateId)>` — `None` means refused
  - `fn lower_tm_all(...) -> (Machine, Vec<Option<usize>>, StateId, bool)` — private; the added `bool` is `refused`
  - `fn attempt(...) -> Option<(TmRun, Machine, Vec<Vec<Symbol>>, u64)>` — private; `None` means refused
  - `lower_tm` and `lower_tm_mapped` keep their current signatures and ignore `refused`

- [ ] **Step 1: Write the failing tests**

In `crates/redextape-core/src/tm.rs`, inside the existing `#[cfg(test)] mod run_tm_tests`, add:

```rust
    /// A program past the state ceiling must be reported as `TooLarge` and NEVER as `Ran`.
    ///
    /// THIS IS THE WHOLE REASON THE REFUSAL IS PLUMBED. `lower_tm_all` answers a refusal with a
    /// degenerate machine that halts immediately; if that reached `attempt` unlabelled it would
    /// simulate, halt at a state that is not the overflow guard, and come back as `Ran` over tapes
    /// that decode to nothing — which is exactly the defect `lower_and_size`'s doc records having
    /// fixed for `MAX_SLOTS` and `MAX_FRAME_LOC`.
    ///
    /// Built as asm rather than compiled from source: `MAX_MACHINE_STATES` instructions of source
    /// would be a 20 MB file, and `code.len()` alone is a lower bound on the state count, so this
    /// trips `lower_tm_all`'s cheap pre-check without allocating a single state.
    #[test]
    fn a_program_past_the_state_ceiling_is_too_large_not_ran() {
        use crate::tm::asm::{Instr, Program};
        use crate::tm::build::MAX_MACHINE_STATES;

        let prog = Program { code: vec![Instr::Halt; MAX_MACHINE_STATES + 1], labels: Vec::new() };
        assert!(
            lower_tm_guarded(&prog, &Unary::default()).is_none(),
            "a code stream longer than the ceiling cannot fit and must be refused, not laid out"
        );
    }

    /// A program the ceiling does NOT refuse still runs, and still gives the reference answer. The
    /// other half of every guard in this tree: refusing correctly is worthless if it also refuses
    /// what it should admit.
    #[test]
    fn an_ordinary_program_still_runs_under_the_ceiling() {
        let core = core_of("let x = 40; x + 2");
        let described = run_tm_described(&core, EncodingKind::Unary, Ty::Nat, TM_DEFAULT_CAPS)
            .expect("an ordinary program must not be refused");
        assert!(matches!(described.run, TmRun::Ran { .. }), "got {:?}", described.run);
    }
```

If `TM_DEFAULT_CAPS`, `Ty`, `EncodingKind` or `Unary` are not already in scope in that module, add the imports the compiler asks for — `run_tm_tests` already does `use super::*;`.

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cargo test -p redextape-core --lib tm::run_tm_tests::a_program_past 2>&1 | tail -20
```

Expected: FAIL to compile — `lower_tm_guarded` returns a tuple, so `.is_none()` does not exist on it.

- [ ] **Step 3: Add the `refused` return and the two bails to `lower_tm_all`**

First bring the constant into scope. `crates/redextape-core/src/tm/lower_tm.rs:11` currently reads
`use crate::tm::build::{Builder, RuleSpec, Slot};` — change it to:

```rust
use crate::tm::build::{Builder, MAX_MACHINE_STATES, RuleSpec, Slot};
```

Then change the signature at line ~161:

```rust
fn lower_tm_all(prog: &Program, enc: &dyn Encoding) -> (Machine, Vec<Option<usize>>, StateId, bool) {
```

Update its doc to note the fourth element. Then make **every** existing early return carry `true` (they are all refusals). The three existing ones become:

```rust
    if sm.n_slots() > MAX_SLOTS {
        let state_origins = vec![None; b.state_count()];
        return (b.finish(halt), state_origins, overflow, true);
    }
```
```rust
    if mul_count_unrepresentable(prog) {
        let state_origins = vec![None; b.state_count()];
        return (b.finish(halt), state_origins, overflow, true);
    }
```
```rust
    if frame_bank_unrepresentable(prog, &sm) {
        let state_origins = vec![None; b.state_count()];
        return (b.finish(halt), state_origins, overflow, true);
    }
```

Add a fourth guard immediately after the `mul_count_unrepresentable` one (before the `pc` allocation at line ~187):

```rust
    // One `pc` entry state per instruction is a LOWER BOUND on the machine's size, so a `code`
    // longer than the ceiling cannot possibly fit and is refused before the `pc` loop below builds a
    // `format!("pc{i}")` String per instruction for a machine that is going to be thrown away.
    //
    // NOT AN ESTIMATE, which is the distinction that matters: `MAX_MACHINE_STATES` is enforced by
    // COUNTING states rather than predicting them precisely so no second copy of per-gadget cost
    // knowledge can go stale (see its doc). This is an exact lower bound on the count, so refusing on
    // it cannot reject a program the ceiling itself would have admitted. It is a fast path, not a
    // second opinion.
    if n >= MAX_MACHINE_STATES {
        let state_origins = vec![None; b.state_count()];
        return (b.finish(halt), state_origins, overflow, true);
    }
```

At the end of the per-instruction loop, after the `state_origins` push block at lines ~306-309, add the bail:

```rust
        let after = b.state_count();
        for _ in before..after {
            state_origins.push(Some(i));
        }
        // The ceiling is reached MID-GADGET for any program the length pre-check waved through — 2,000
        // `Box` instructions are ~1.1M states from a 2,001-instruction program — so it is checked per
        // instruction rather than once at the end. Stopping here bounds the wasted work at one
        // instruction's worth; running on would keep attaching rules to the state-0 sentinel that
        // `Builder::state` hands back past the ceiling, growing the machine's rule count without
        // growing its state count.
        if b.overflowed() {
            let state_origins = vec![None; b.state_count()];
            return (b.finish(halt), state_origins, overflow, true);
        }
```

And the successful return at line ~312:

```rust
    (b.finish(pc.first().copied().unwrap_or(halt)), state_origins, overflow, false)
```

- [ ] **Step 4: Update the three internal wrappers**

In the same file:

```rust
/// Lower `prog` to a Turing machine, returning the machine AND its state map (see `lower_tm_all`).
///
/// A REFUSED program yields the degenerate halt-immediately machine and a map of `None`s, the same
/// as before the refusal was plumbed. `sourcemap.rs` — the only caller — already skips states with no
/// origin, so it reads a refusal as "no ownership recorded", which is true. `lower_tm_guarded` is the
/// entry point that reports the refusal, because it is the one on the `run_tm*` path where treating a
/// degenerate machine as a real one would produce a wrong ANSWER rather than an empty map.
pub fn lower_tm_mapped(prog: &Program, enc: &dyn Encoding) -> (Machine, Vec<Option<usize>>) {
    let (m, origins, _, _) = lower_tm_all(prog, enc);
    (m, origins)
}
```

```rust
/// Lower `prog`, returning the machine AND its overflow-guard state — or `None` if the layout was
/// REFUSED. Halting in that guard state means a value did not fit the encoding's field width; retry
/// at a wider one (`run_tm` does exactly that).
///
/// `None` MEANS NO MACHINE EXISTS, and is a different thing from the guard state entirely: one is
/// "this program is too big to lay out", the other is "this value is too wide for its field". Four
/// conditions produce it — `MAX_SLOTS`, `MAX_FRAME_LOC`, `MAX_MUL_INSTRS` and `MAX_MACHINE_STATES`.
///
/// `Option` RATHER THAN A THIRD TUPLE ELEMENT. A `bool` alongside a `Machine` that looks perfectly
/// usable is the easiest thing in this design to ignore, and ignoring it is precisely the
/// `Ran`-over-empty-tapes bug `lower_and_size`'s doc records: the degenerate machine halts
/// immediately, so a caller that skips the check gets a plausible-looking wrong answer rather than a
/// crash. `Option` makes skipping it not compile.
///
/// Returned as an artifact rather than stored on `Machine` for the same reason as the origin map:
/// `Machine` derives `PartialEq` and the TM text round-trip asserts `parse_tm(print_tm(m)) == m`, which
/// a side-table field would break for a reason unrelated to what the machine computes.
#[must_use]
pub fn lower_tm_guarded(prog: &Program, enc: &dyn Encoding) -> Option<(Machine, StateId)> {
    let (m, _, overflow, refused) = lower_tm_all(prog, enc);
    if refused { None } else { Some((m, overflow)) }
}
```

And `lower_tm` (line ~343):

```rust
pub fn lower_tm(prog: &Program, enc: &dyn Encoding) -> Machine {
    lower_tm_all(prog, enc).0
}
```
(unchanged body — `.0` still selects the machine.)

- [ ] **Step 5: Make `attempt` and its four callers handle the refusal**

In `crates/redextape-core/src/tm.rs`, change `attempt` (line ~132):

```rust
fn attempt(
    prog: &Program,
    enc: &dyn Encoding,
    n_slots: u32,
    caps: TmCaps,
) -> Option<(TmRun, Machine, Vec<Vec<Symbol>>, u64)> {
    let (machine, overflow) = lower_tm_guarded(prog, enc)?;
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots);
    init[WORK] = enc.init_work();
    let (run, steps) = match simulate_final(&machine, &init, caps) {
        (_, s, TmStatus::Halted, n) if s == overflow => (TmRun::Overflow, n),
        (tapes, _, TmStatus::Halted, n) => (TmRun::Ran { tapes }, n),
        (_, _, TmStatus::HitCap, n) => (TmRun::HitCap, n),
    };
    Some((run, machine, init, steps))
}
```

Add to `attempt`'s doc, above the existing prose:

```rust
/// `None` IF THE LAYOUT WAS REFUSED. Three of the four refusals are pre-checked by `lower_and_size`
/// and so never reach here; `MAX_MACHINE_STATES` cannot be pre-checked — it is only known once the
/// gadgets have been built — so this is where it surfaces.
```

`run_tm_fitted`, the unbounded-encoding branch (line ~191):

```rust
    if enc.field_width().is_none() {
        return (attempt(&prog, enc, n_slots, caps).map_or(TmRun::TooLarge, |a| a.0), None);
    }
```

`run_tm_fitted`, the width loop (line ~197):

```rust
        match attempt(&prog, &*fitted, n_slots, caps).map_or(TmRun::TooLarge, |a| a.0) {
            TmRun::Overflow if width < MAX_FIELD_WIDTH => width = (width * 2).min(MAX_FIELD_WIDTH),
            other => return (other, Some(width)),
        }
```

A refusal falls into `other` and returns immediately, which is right: the state ceiling does not depend on field width, so retrying wider would re-refuse at every width — the same reasoning this function's doc already gives for not retrying `TooLarge`.

`run_tm_described` (line ~257):

```rust
        let Some((run, machine, init, steps)) = attempt(&prog, &*fitted, n_slots, caps) else {
            return Err(TmRun::TooLarge);
        };
```

`run_tm_at` (line ~277):

```rust
    attempt(&prog, enc, sm.n_slots(), caps).map_or(TmRun::TooLarge, |a| a.0)
```

- [ ] **Step 6: Correct the two docs that now under-count the refusals**

`TmRun::TooLarge`'s doc at `crates/redextape-core/src/tm.rs:65-68` — replace with:

```rust
    /// `lower_tm` REFUSED to build a machine for this program at all. FOUR conditions produce it: an
    /// absurd register file (`lower_tm::MAX_SLOTS`), an absurd `Loc` bank in a call-containing program
    /// (`lower_tm::MAX_FRAME_LOC`), too many `Mul` instructions (`lower_tm::MAX_MUL_INSTRS`, each
    /// O(width²) states under `Binary`), or a machine that exceeds `build::MAX_MACHINE_STATES`.
    ///
    /// THE FOURTH IS NOT LIKE THE OTHER THREE. Those bound a quantity readable off the `Program`, so
    /// `lower_and_size` pre-checks them before lowering. The state count is only known once the
    /// gadgets have been laid out, so it is reported BY the lowering — see `lower_tm_guarded`.
```
(keep whatever the remainder of the original doc says about `init_reg`.)

`lower_and_size`'s doc at line ~145-155 — it currently claims to be "The single place `run_tm_fitted`/`run_tm_at` decide 'is this program representable at all'". Replace that sentence with:

```rust
/// The single place `run_tm_fitted`/`run_tm_at` PRE-CHECK representability, so the two cannot drift
/// from each other or from the guards they mirror — the same reason `frame_bank_unrepresentable` is a
/// shared predicate rather than re-derived at each call site.
///
/// THREE OF THE FOUR REFUSALS, NOT ALL FOUR. `MAX_MACHINE_STATES` cannot be pre-checked: it bounds
/// the machine, and the machine does not exist until the gadgets are built. `attempt` reports it via
/// `lower_tm_guarded`'s `None`. Keeping these three here anyway is deliberate — `MAX_SLOTS` in
/// particular must refuse BEFORE `init_reg` lays out a bank from `n_slots`, which is an allocation
/// the state ceiling would never see.
```

- [ ] **Step 7: Update the 17 `lower_tm_guarded` call sites**

Every one is in a test or example target, where `.expect(...)` is permitted. Each currently reads `let (m, _) = lower_tm_guarded(&program, enc);` (bindings vary). Append `.expect(...)` with a reason specific to the site — these are small, deliberate programs, so a refusal means the guard is wrong:

```rust
    let (m, _) = lower_tm_guarded(&program, enc).expect("test program must lower");
```

The full list (grep to confirm none were missed):
```bash
grep -rn "lower_tm_guarded" --include="*.rs" crates/ | grep -v "^crates/redextape-core/src/tm/lower_tm.rs:3[0-9][0-9]:"
```
- `tests/tm_static_delimiter_safety.rs:89, 108`
- `tests/tm_bank_invariant.rs:86, 266`
- `tests/tm_width_equivalence.rs:299, 498`
- `tests/tm_exhaustive_bank_safety.rs:141, 465`
- `examples/concurrency_probe.rs:223`
- `examples/width_report.rs:84, 101, 351`
- `examples/step_survey.rs:570, 586`
- `src/tm/lower_tm.rs:370, 389, 465` (inline tests)

- [ ] **Step 8: Run the tests to verify they pass**

Run:
```bash
cargo test -p redextape-core --lib tm::run_tm_tests 2>&1 | tail -20
```

Expected: PASS, including both new tests.

- [ ] **Step 9: Verify the whole workspace still compiles and passes**

Run:
```bash
cargo clippy --workspace --all-targets -- -D warnings && cargo nextest run --workspace 2>&1 | tail -20
```

Expected: clippy clean, all tests pass. This is the step that catches a missed `lower_tm_guarded` call site.

- [ ] **Step 10: Commit**

```bash
git add crates/redextape-core/src/tm/lower_tm.rs crates/redextape-core/src/tm.rs \
        crates/redextape-core/tests crates/redextape-core/examples
git commit -m "tm: report the state-ceiling refusal instead of silently degenerating

lower_tm_all answers a refusal with a machine that halts immediately. The
three existing guards get away with that because lower_and_size pre-checks
them, so the degenerate machine never reaches attempt. The state ceiling
cannot be pre-checked -- it bounds the machine, and the machine does not
exist until the gadgets are built -- so unplumbed it would have come back
as TmRun::Ran over tapes that decode to nothing, which is the defect
lower_and_size's own doc records fixing for MAX_SLOTS.

lower_tm_guarded returns Option rather than a bool beside a usable-looking
Machine, so ignoring the refusal does not compile. TmRun::TooLarge already
reaches the UI as 'the machine this program needs is too large to build'."
```

---

### Task 4: The counterexamples — what the ceiling must admit, and what it must refuse

`tests/guard_counterexamples.rs` is this tree's existing home for the "does the guard reject something real" question. `MAX_MACHINE_STATES` is the first guard here whose ceiling a *shipped* program comes within three orders of magnitude of, so that half of its justification needs a test rather than a sentence.

**Files:**
- Modify: `crates/redextape-core/tests/guard_counterexamples.rs` — add a TM section (the file is currently λ-only, so also extend the module header)

**Interfaces:**
- Consumes: `MAX_MACHINE_STATES` (Task 2), `lower_tm_guarded -> Option` (Task 3)
- Produces: nothing

- [ ] **Step 1: Extend the module header**

The file's header opens *"The two programs that falsified the two withdrawn λ blow-up guards"* and its table lists two λ designs. This task adds a third, non-λ subject, so the header must say so or it becomes false. Add after the existing table:

```rust
//! **A THIRD SUBJECT, AND NOT A λ ONE: `tm::build::MAX_MACHINE_STATES`.** The rows below it are the
//! same shape of evidence pointing the other way. The two λ guards were *proposals killed by
//! counterexample*; the state ceiling *exists*, and what needs pinning is that it sits between two
//! measured programs — above the worst demo this project ships (38,070 states) and below the
//! balanced arithmetic tree that OOMs (8,595,317 states from 4 KB of source). A guard is only as
//! good as both of its sides, which is what this file is for either way.
```

- [ ] **Step 2: Write the tests**

Append to `crates/redextape-core/tests/guard_counterexamples.rs`. Add whatever imports the compiler asks for (`redextape_core::tm::{Binary, EncodingKind, TM_DEFAULT_CAPS, TmRun, Unary, defunc, lower_asm, lower_tm_guarded, run_tm_described}`, `redextape_core::tm::build::MAX_MACHINE_STATES`, `redextape_core::tm::asm::{Instr, Program, Reg}`, `redextape_core::ty::Ty`, `parse`, `desugar`). Resolve the exact paths against what `cargo build` reports rather than guessing.

```rust
/// Source to `Core`, through the same front end `run_tm_described` uses.
fn core_of(src: &str) -> redextape_core::core::Core {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
    desugar(&prog.expect("parse produced no program"))
}

/// `n` leaves, balanced, so depth is log2(n) and `lower_asm`'s `MAX_LOWER_DEPTH` never fires. Shared
/// by the two tests below rather than defined in each: they assert opposite outcomes about the SAME
/// shape at different sizes, so a copy that drifted would silently stop testing the pair.
fn balanced(lo: usize, hi: usize) -> String {
    if hi - lo <= 1 {
        return "1".into();
    }
    let mid = (lo + hi) / 2;
    format!("({} + {})", balanced(lo, mid), balanced(mid, hi))
}

/// `Core` to asm, reproducing `lower_program`'s own order: direct, then `defunc` on an unsupported
/// higher-order construct. Reproduced rather than called because `lower_program` is private.
fn asm_of(src: &str) -> redextape_core::tm::asm::Program {
    let core = core_of(src);
    lower_asm(&core)
        .or_else(|_| defunc(&core).and_then(|d| lower_asm(&d)))
        .expect("program must lower to asm")
}

/// THE WORST PROGRAM THIS PROJECT SHIPS must still lower, with room to spare.
///
/// `MAX_MACHINE_STATES` is the first guard in this tree that a REAL program comes anywhere near, so
/// "never rejects a legitimate program" has to be a test. This is the largest member of
/// `native_oracle.rs`'s `FIRST_ORDER_DEMOS`: 123 tokens, and 38,070 states under `Binary` — 3.8% of
/// the ceiling.
///
/// THE ASSERTION IS THE RELATION, NOT THE LITERAL. A gadget change that moves the count is fine; a
/// change that puts the shipped demo within 10x of the ceiling is not, and is the thing worth being
/// told about — either the ceiling is too low or a gadget regressed by an order of magnitude.
#[test]
fn the_worst_shipped_demo_lowers_far_below_the_state_ceiling() {
    const WORST_SHIPPED_DEMO: &str = "\
        fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
        fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
        fn add(a, b) { a + b }\n\
        fn add1(x) { x + 1 }\n\
        fold([3, 1, 2].map(add1), 0, add)";

    let prog = asm_of(WORST_SHIPPED_DEMO);
    let (machine, _) = lower_tm_guarded(&prog, &Binary::default())
        .expect("the worst program this project ships must not be refused");

    assert!(
        machine.states.len() * 10 < MAX_MACHINE_STATES,
        "the shipped map+fold demo needs {} states against a ceiling of {MAX_MACHINE_STATES}; \
         a shipped demo within 10x of the ceiling means the ceiling is too low or a gadget regressed",
        machine.states.len()
    );
}

/// The cheap half of the refusal: a `code` stream longer than the ceiling is a machine larger than
/// the ceiling, because `lower_tm_all` allocates one `pc` entry state per instruction
/// unconditionally. Refused by the length pre-check without allocating a single state, which is what
/// makes this fast-tier where the gadget-expansion case below is not.
#[test]
fn a_code_stream_longer_than_the_ceiling_is_refused() {
    let prog = Program { code: vec![Instr::Halt; MAX_MACHINE_STATES + 1], labels: Vec::new() };
    assert!(
        lower_tm_guarded(&prog, &Unary::default()).is_none(),
        "one pc state per instruction is a lower bound, so this cannot fit and must be refused"
    );
}

/// THE CASE THE LENGTH PRE-CHECK CANNOT CATCH, and the reason `lower_tm_all` checks `overflowed()`
/// once per instruction rather than once at the end: 4,000 instructions is nowhere near the ceiling,
/// but `Box` costs ~571 states each under `Binary`, so the machine is ~2.3M — past it.
///
/// SLOW TIER because tripping the ceiling by expansion means allocating a ceiling's worth of real
/// states first: ~727 MB at the measured 727 bytes a state. The pre-check case above costs nothing
/// and stays in the merge gate; this one is the mechanism, and it is checked where minutes are
/// affordable.
#[test]
#[ignore = "slow tier: allocates ~MAX_MACHINE_STATES real states (~727 MB); run via scripts/check-slow.sh"]
fn a_short_program_whose_gadgets_exceed_the_ceiling_is_refused() {
    let mut code = vec![Instr::Li(Reg::Loc(1), 1)];
    code.extend(std::iter::repeat(Instr::Box(Reg::Loc(2), Reg::Loc(1))).take(4_000));
    code.push(Instr::Halt);
    let prog = Program { code, labels: Vec::new() };

    assert!(
        lower_tm_guarded(&prog, &Binary::default()).is_none(),
        "4,000 Box gadgets at ~571 states each exceed MAX_MACHINE_STATES; the per-instruction \
         overflowed() check is what must catch it, since the length pre-check waves 4,002 through"
    );
}

/// THE TWO SIDES OF THE LINE, from source rather than hand-built asm — the shape that made this a
/// live defect rather than a latent one.
///
/// A BALANCED expression tree is depth-log, so `lower_asm`'s `MAX_LOWER_DEPTH` never fires and the
/// whole token budget turns into instructions AND slots, which multiply: growth is about
/// O(code.len()^1.9). Left-nested shapes hit the depth guard at ~580 and never get here, which is
/// why `code.len()` LOOKED bounded at 3,472 and why this went unnoticed.
///
/// 1,022 tokens builds 575,861 states (398 MB) and must be ADMITTED — it works today.
/// 4,094 tokens builds 8,595,317 states (6.0 GB) and must be REFUSED — it is fatal in wasm32, and at
/// 16,382 tokens the same shape SIGKILLed an 8 GB budget.
///
/// SLOW TIER: the admitted half alone is 398 MB.
#[test]
#[ignore = "slow tier: builds a ~400 MB machine; run via scripts/check-slow.sh"]
fn the_balanced_tree_is_admitted_below_the_ceiling_and_refused_above_it() {
    let admitted = asm_of(&balanced(0, 256));
    let (machine, _) = lower_tm_guarded(&admitted, &Binary::default())
        .expect("1,022 tokens builds 575,861 states, under the ceiling — it must still lower");
    assert!(machine.states.len() < MAX_MACHINE_STATES);

    let refused = asm_of(&balanced(0, 1_024));
    assert!(
        lower_tm_guarded(&refused, &Binary::default()).is_none(),
        "4,094 tokens builds 8,595,317 states (6.0 GB) and must be refused — this is the program \
         that made the gap a live OOM reachable from the editor, not a latent cast hazard"
    );
}

/// THE END-TO-END ASSERTION, and the one that would have caught the bug this slice's Task 3 exists
/// to prevent: the refusal must arrive at the caller as `TooLarge` and NEVER as `Ran`.
///
/// `lower_tm_guarded` returning `None` (asserted above) is only half of it. `lower_tm_all` answers a
/// refusal with a machine that HALTS IMMEDIATELY, so a version of this that failed to plumb the
/// refusal out would simulate that machine, halt at a state that is not the overflow guard, and come
/// back as `Ran` over tapes that decode to nothing — a plausible-looking wrong answer rather than a
/// crash. That is the defect `lower_and_size`'s doc records having fixed for `MAX_SLOTS` and
/// `MAX_FRAME_LOC`, reachable again through the one guard it cannot pre-check.
///
/// `TooLarge` is what reaches the user as "the machine this program needs is too large to build"
/// (`redextape-wasm`'s `session.rs`), so this also pins that the UI is told the truth.
///
/// SLOW TIER for the same reason as the pair above — the refused program builds a ceiling's worth of
/// states before the per-instruction check stops it.
#[test]
#[ignore = "slow tier: builds a ceiling's worth of states before refusing; run via scripts/check-slow.sh"]
fn a_program_past_the_ceiling_reaches_the_caller_as_too_large() {
    let core = core_of(&balanced(0, 1_024));
    let outcome = run_tm_described(&core, EncodingKind::Binary, Ty::Nat, TM_DEFAULT_CAPS);
    assert!(
        matches!(outcome, Err(TmRun::TooLarge)),
        "a refused program must never come back as Ran over tapes that decode to nothing; got {:?}",
        outcome.map(|d| d.run)
    );
}
```

- [ ] **Step 3: Run the fast-tier tests**

Run:
```bash
cargo nextest run -p redextape-core --test guard_counterexamples 2>&1 | tail -20
```

Expected: PASS — `the_worst_shipped_demo_lowers_far_below_the_state_ceiling` and `a_code_stream_longer_than_the_ceiling_is_refused`. The three `#[ignore]`d tests are listed as skipped.

- [ ] **Step 4: Run the slow-tier tests once, deliberately, under a memory cap**

The 727 MB and 400 MB allocations are real. Cap them so a mistake cannot take the machine down:

```bash
systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet \
  cargo nextest run --release -p redextape-core --test guard_counterexamples --run-ignored all 2>&1 | tail -20
```

Expected: PASS, all five tests in the file (two fast, three slow). If any slow test is killed (exit 137), the ceiling's memory arithmetic is wrong — stop and report the measured figure rather than raising the cap.

- [ ] **Step 5: Verify clippy is clean on the test target**

Run:
```bash
cargo clippy -p redextape-core --all-targets -- -D warnings
```

Expected: clean. If `guard_counterexamples.rs` lacks a file-level `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]`, the free helper `asm_of` (which is outside any `#[test]` fn) will trip the deny — check the top of the file and add it if missing, matching the other files in `tests/`.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/tests/guard_counterexamples.rs
git commit -m "guard counterexamples: both sides of the state ceiling

MAX_MACHINE_STATES is the first guard here that a shipped program comes
within three orders of magnitude of, so 'never rejects a legitimate
program' needs a test. The worst demo this project ships is 38,070 states
against a 1,000,000 ceiling, asserted as a 10x relation rather than a
literal so a gadget regression is what fails.

The refusal side is tested twice on purpose: the length pre-check (cheap,
merge gate) and gadget expansion (~727 MB, slow tier), because only the
second exercises the per-instruction overflowed() check.

The balanced-tree pair is the shape that made this live -- depth-log, so
MAX_LOWER_DEPTH never fires and code.len() only LOOKED bounded at 3,472.
The end-to-end test pins the half that matters most: a refused program
reaches the caller as TooLarge, never as Ran over tapes that decode to
nothing."
```

---

### Task 5: `MAX_NODE_ID` — close the wrap at the source

The other hat. Independent of Tasks 2-4; a reviewer can take those and reject this.

**Files:**
- Modify: `crates/redextape-core/src/core.rs:183-214` — add the constant, the `exhausted` field and accessor, clamp `seeded`, saturate `fresh`, rewrite the docs
- Modify: `crates/redextape-core/src/viewmodel.rs:529-537` — correct the premise that is now false
- Test: `crates/redextape-core/src/core.rs` (add a `#[cfg(test)] mod tests` if the file has none)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `pub const MAX_NODE_ID: NodeId = 1_000_000_000;` in `crate::core`
  - `NodeGen::exhausted(&self) -> bool`
  - `NodeGen::seeded` and `NodeGen::fresh` keep their signatures

- [ ] **Step 1: Write the failing tests**

In `crates/redextape-core/src/core.rs`, in a `#[cfg(test)] mod tests` (create it at the end of the file if absent, with `use super::*;`):

```rust
    /// THE WRAP THIS CLOSES. `seeded(u32::MAX)` used to reach it in one call: `fresh()` returned
    /// `u32::MAX` and left `next` at 0, so the NEXT id collided with the root of whatever tree was
    /// being built — silently, in release, in the map the UI resolves clicks through.
    #[test]
    fn a_seed_past_the_ceiling_never_recycles_id_zero() {
        let mut g = NodeGen::seeded(NodeId::MAX);
        assert!(g.exhausted(), "a seed past MAX_NODE_ID has already lost ids, and says so");

        let first = g.fresh();
        let second = g.fresh();
        assert_eq!(first, MAX_NODE_ID, "clamped to the ceiling, not left at u32::MAX");
        assert_eq!(second, MAX_NODE_ID, "saturates rather than wrapping");
        assert_ne!(second, 0, "the wrap this guards against re-issued id 0");
    }

    /// THE POINT OF THE SPECIFIC VALUE. `viewmodel::LinkIndex::build` casts `NodeId -> i32` for the
    /// `tm_owner` leg (an `Int32Array` crossing to JavaScript). The ceiling sitting under `i32::MAX`
    /// is what turns that cast from "usually succeeds" into "provably succeeds", so the RELATION is
    /// what is pinned — not the literal, which may be tuned.
    #[test]
    fn every_issuable_node_id_fits_i32() {
        assert!(i32::try_from(MAX_NODE_ID).is_ok(), "MAX_NODE_ID must fit i32 for LinkIndex::build");
        let mut g = NodeGen::seeded(MAX_NODE_ID);
        assert!(i32::try_from(g.fresh()).is_ok(), "even the last id issuable must fit");
    }

    /// Ordinary issuance is untouched: consecutive, from zero, not exhausted. The guard must be
    /// invisible to every real tree — the largest `NodeId` measured from source is 80,000.
    #[test]
    fn fresh_still_issues_consecutive_ids_from_zero() {
        let mut g = NodeGen::default();
        assert_eq!((g.fresh(), g.fresh(), g.fresh()), (0, 1, 2));
        assert!(!g.exhausted());

        // `seeded` below the ceiling is unchanged too — the `defunc` use, seeding past a tree's max id.
        let mut s = NodeGen::seeded(500);
        assert_eq!((s.fresh(), s.fresh()), (500, 501));
        assert!(!s.exhausted());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cargo test -p redextape-core --lib core::tests 2>&1 | tail -20
```

Expected: FAIL to compile — `cannot find value MAX_NODE_ID`, `no method named exhausted`.

- [ ] **Step 3: Add the constant**

In `crates/redextape-core/src/core.rs`, immediately above `pub struct NodeGen` (line ~183):

```rust
/// The largest `NodeId` `NodeGen` will issue. Reaching it stops issuance rather than wrapping.
///
/// **THE VALUE IS CHOSEN AGAINST `i32`, NOT AGAINST MEMORY.** It is below `i32::MAX`
/// (2,147,483,647), which is what makes `viewmodel::LinkIndex::build`'s `i32::try_from(node)`
/// provably succeed instead of merely usually succeeding: the `tm_owner` leg crosses to JavaScript as
/// an `Int32Array`, and a `NodeId` past `2^31` would go negative under the cast — landing on `-1` for
/// the one id that turns it exactly, and so becoming indistinguishable from "this state has no
/// owner", or on some other negative value that `web/src/link.ts`'s `nodeForState` collapses to the
/// same `null`.
///
/// It is **12,500x** the largest `NodeId` measured from source: 80,000, at 80,002 tokens, from a
/// `1 + 1 + ...` chain. `desugar` has no depth guard of its own, so `parser::MAX_TOKENS` (100,000) is
/// what bounds real issuance — roughly one id per token. No memory argument justifies a tighter
/// number: a `Core` tree of 10^9 nodes is impossible at >= 40 bytes a node, so this ceiling exists to
/// bound the COUNTER, not the tree.
///
/// See `docs/superpowers/specs/2026-08-11-count-bounds-design.md` §4.3.
pub const MAX_NODE_ID: NodeId = 1_000_000_000;
```

- [ ] **Step 4: Rewrite `NodeGen`**

Replace `crates/redextape-core/src/core.rs:183-214` (the struct, `seeded`, and `fresh` with its doc) with:

```rust
/// Monotonic `NodeId` source. Every desugar run uses a fresh one starting at 0.
#[derive(Default)]
pub struct NodeGen {
    next: NodeId,
    exhausted: bool,
}

impl NodeGen {
    /// A generator whose first `fresh()` returns `next`. Used by synthetic passes (e.g. `defunc`)
    /// that mint new nodes and must not collide with an existing tree's ids: seed past its max id.
    ///
    /// **CLAMPED TO `MAX_NODE_ID`, because this is the door the wrap was actually reachable
    /// through.** A `Core` tree of 4.29 billion nodes cannot be built — `MAX_TOKENS` holds real
    /// issuance to ~100,000 — but `seeded` is `pub` and takes an arbitrary `u32`, so
    /// `seeded(u32::MAX)` plus one `fresh()` reached the wrap from outside this module. A seed past
    /// the ceiling has already lost ids, so the generator reports `exhausted()` immediately rather
    /// than pretending the clamp was free.
    #[must_use]
    pub fn seeded(next: NodeId) -> Self {
        NodeGen { next: next.min(MAX_NODE_ID), exhausted: next > MAX_NODE_ID }
    }

    /// Whether issuance has reached `MAX_NODE_ID`.
    ///
    /// Once true, every `fresh()` returns `MAX_NODE_ID` again, so ids are no longer unique and
    /// anything keyed by `NodeId` — all three legs of `SourceMap` — would collide on that one id.
    #[must_use]
    pub fn exhausted(&self) -> bool {
        self.exhausted
    }

    /// Issue the next id. **SATURATES AT `MAX_NODE_ID` rather than wrapping.**
    ///
    /// This was a bare `self.next += 1`, which wraps silently in release (this workspace sets no
    /// `[profile]` overrides, so no debug assertion catches it) and re-issues id 0 to whatever mints
    /// next — colliding with the root of the tree and every early node, in the map the UI resolves
    /// clicks through.
    ///
    /// **SATURATION STILL REPEATS AN ID, and that is the honest trade rather than an oversight.** One
    /// known repeated id at a documented ceiling beats a silent restart at 0 that collides with the
    /// nodes most likely to be clicked. Making this fallible is the only fully correct fix — no id
    /// ever issued twice — and it ripples through ~15 call sites and `desugar`'s own return type,
    /// which cannot express refusal; `panic`/`expect`/`unwrap` are denied in library code
    /// (`clippy.toml`), so aborting is not available either. `exhausted()` is how a caller that cares
    /// finds out.
    ///
    /// **THE GAP `LinkIndex::build` CITED IS NOW CLOSED AT THE SOURCE.** Its `NodeId -> i32` cast
    /// refused because "nothing bounds how many a `Core` tree can mint (`NodeGen::fresh` is a bare
    /// counter)". Something does now, and `MAX_NODE_ID < i32::MAX`, so that cast provably succeeds.
    /// The refusal stays as defence in depth — see its own doc.
    pub fn fresh(&mut self) -> NodeId {
        let id = self.next;
        if self.next >= MAX_NODE_ID {
            self.exhausted = true;
        } else {
            self.next += 1;
        }
        id
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
cargo test -p redextape-core --lib core::tests 2>&1 | tail -20
```

Expected: PASS, all three.

- [ ] **Step 6: Correct the now-false premise in `viewmodel.rs`**

In `crates/redextape-core/src/viewmodel.rs`, the `tm_owner` field doc (lines ~529-537) currently says the cast could overflow because "nothing bounds how many a `Core` tree can mint (`core::NodeGen::fresh` is a bare counter)". Replace that paragraph — keep the paragraphs either side, including the recorded reasoning about why `-1` must not be the fallback and why the narrower alternative was rejected:

```rust
    /// **A `NodeId` THAT WOULD NOT FIT `i32` DECLINES THE WHOLE LEG, THE SAME WAY A `None` PROGRAM
    /// DOES — IT DOES NOT BECOME `-1`.** `NodeId` is a `u32`, and a value at or past `2^31` goes
    /// negative under `as i32` — landing on `-1` for the one id that turns it exactly, or some other
    /// negative value otherwise, and either way becoming indistinguishable from (or worse, a wrong
    /// index next to) a state that genuinely has no owner. `build` refuses that cast with
    /// `i32::try_from` and empties the whole vec on failure — the same "no lie, just nothing" refusal
    /// `emit` (above) makes for `TermTree`'s arena index.
    ///
    /// **THAT REFUSAL IS NOW PROVABLY UNREACHABLE, AND IS KEPT ANYWAY.** It used to cite
    /// `core::NodeGen::fresh` as a bare counter that bounded nothing; `core::MAX_NODE_ID` bounds it
    /// now, and sits under `i32::MAX` precisely so this cast cannot fail. The check stays because it
    /// costs one comparison and because the alternative is a cast whose soundness lives in another
    /// module's constant — if that ceiling is ever raised past `2^31`, this refuses instead of
    /// silently emitting a wrong owner.
```

- [ ] **Step 7: Verify the workspace**

Run:
```bash
cargo clippy --workspace --all-targets -- -D warnings && cargo nextest run --workspace 2>&1 | tail -20
```

Expected: clippy clean, all tests pass. `defunc`'s `SynthGen` uses `NodeGen::seeded` and must be unaffected — real seeds are ~100,000, ten thousand times under the clamp.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/src/core.rs crates/redextape-core/src/viewmodel.rs
git commit -m "core: cap NodeId issuance at the source, closing the wrap viewmodel worked around

fresh() was a bare 'self.next += 1' that wraps silently in release and
re-issues id 0 -- colliding with the root of the tree and every early node,
in the map the UI resolves clicks through. seeded() is pub, so
seeded(u32::MAX) reached it from outside the module in one call.

MAX_NODE_ID = 1_000_000_000 is chosen against i32, not memory: it sits
under i32::MAX so LinkIndex::build's NodeId -> i32 cast provably succeeds,
which is exactly what fresh()'s old doc said capping at the source would
buy. 12,500x the largest NodeId measured from source (80,000).

Saturation still repeats an id at the ceiling. Fallible issuance is the
only fully correct fix and ripples through desugar's return type, which
cannot express refusal; panic is denied in library code. exhausted()
is how a caller that cares finds out."
```

---

### Task 6: Keep the probe

Eight `*_probe.rs` examples already exist because this tree's standing practice is to gate on counts in tests and report costs from `examples/`. Every number in Tasks 2-5's doc comments came from this one; without it they are unverifiable assertions.

**Files:**
- Create: `crates/redextape-core/examples/state_cost_probe.rs`
- Source material: `/tmp/claude-1000/-home-davey-projects-redextape/6221d6d1-93f7-4718-a2a8-38812e608a13/scratchpad/state_cost_probe_draft.rs`

**Interfaces:**
- Consumes: `MAX_MACHINE_STATES` (Task 2), `MAX_NODE_ID` (Task 5), `lower_tm_guarded -> Option` (Task 3)
- Produces: nothing

- [ ] **Step 1: Copy the draft in**

```bash
cp /tmp/claude-1000/-home-davey-projects-redextape/6221d6d1-93f7-4718-a2a8-38812e608a13/scratchpad/state_cost_probe_draft.rs \
   crates/redextape-core/examples/state_cost_probe.rs
```

The draft has seven sections: `part_h` (bytes/state), `part_a` (front-door ceiling), `part_b` (states per instruction by kind and encoding, plus the `Call`/`n_loc` scaling), `part_c` (bisected `code.len()` ceiling), `part_d` (largest legitimate machine), `part_e` (largest `NodeId`), `part_g` (the shipped demo suite), `part_f` (the balanced tree).

- [ ] **Step 2: Replace the placeholder module header**

The draft's header says "TEMPORARY survey ... Delete before commit." Replace it with a real one in the house style of the other probes — state what each section answers, which constant it justifies, and the hazard:

```rust
//! What a `Machine` state COSTS, and what that makes representable — the measurements behind
//! `tm::build::MAX_MACHINE_STATES` and `core::MAX_NODE_ID`.
//!
//!     cargo run --release --example state_cost_probe -p redextape-core
//!
//! **RUN IT UNDER A MEMORY CAP.** Section F deliberately walks a balanced expression tree upward
//! until the lowering stops fitting, and the step past 4,094 tokens SIGKILLed an 8 GB budget when
//! these numbers were taken. That kill IS the measurement — the section ramps and prints each row so
//! the last good one survives on stdout — but an uncapped run will take the machine's swap with it:
//!
//!     systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet \
//!       cargo run --release --example state_cost_probe -p redextape-core
//!
//! **WHY THIS EXISTS.** Four narrowing casts used to justify themselves with a prose argument that
//! `Program::code.len()` was bounded by ~172 GB of resident memory. It is not, and the prose had
//! already been copied verbatim into a second file. Sections F and G are the refutation: a balanced
//! arithmetic tree of 4 KB — well inside `MAX_TOKENS`, and reachable from the editor through
//! `run_tm_described` — builds an 8.6 million state machine costing 6.0 GB.
//!
//! | section | question | what it fixes |
//! | --- | --- | --- |
//! | H | bytes per state | 727, measured as RSS delta; `size_of::<State>()` of 56 understates it 13x |
//! | A | how big can `code.len()` get from source | not `MAX_TOKENS` — `lower_asm`'s `MAX_LOWER_DEPTH` |
//! | B | states per instruction, by kind and encoding | 1 (`Halt`) to 571 (`Box`); `Call` scales with `n_loc` |
//! | C | the bisected `code.len()` ceiling | 3,472 — and only for depth-limited shapes |
//! | D | the largest machine a depth-limited program builds | 2.8M states |
//! | E | the largest `NodeId` minted from source | 80,000, roughly one per token |
//! | G | what the SHIPPED demos cost | 38,070 states worst case — the floor a ceiling must clear |
//! | F | the balanced tree, which no depth guard bounds | the live OOM |
//!
//! Section G's programs are the largest members of `native_oracle.rs`'s `FIRST_ORDER_DEMOS`. If that
//! list grows a bigger program, add it here too — G is what pins the "never rejects a legitimate
//! program" half of `MAX_MACHINE_STATES`, and `guard_counterexamples.rs` asserts the relation this
//! section measures.
//!
//! Section order is deliberate: F runs LAST because it is the one that can be killed.
```

- [ ] **Step 3: Fix up the draft for the post-Task-3 API and the lint policy**

Three mechanical changes:

1. The file-level allow must cover an `examples/` target (free helpers are outside any `#[test]`):
```rust
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
```
(the draft already has this — confirm it is present.)

2. `main()` must run the sections in the order the header claims, F last:
```rust
fn main() {
    part_h();
    part_a();
    part_b();
    part_c();
    part_d();
    part_e();
    part_g();
    part_f();
}
```

3. The draft calls `lower_tm`, not `lower_tm_guarded`, so Task 3's `Option` change does not reach it. Confirm with a build; if any call site does use `lower_tm_guarded`, add `.expect(...)`.

- [ ] **Step 4: Build and run it**

```bash
cargo build --release --example state_cost_probe -p redextape-core && \
systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet \
  timeout 1200 ./target/release/examples/state_cost_probe 2>&1 | tail -60
```

Expected: sections H, A, B, C, D, E, G print; F prints rows up to 1,024 and is then killed. Check these against the doc comments written in Tasks 2 and 5 — **if any figure disagrees, stop and report it rather than editing either side.** The ones that matter:

| section | figure |
| --- | --- |
| H | ~727 bytes/state |
| G | worst shipped demo 38,070 binary states |
| E | max `NodeId` 80,000 |
| F | 1,022 tokens → 575,861; 4,094 tokens → 8,595,317 |

- [ ] **Step 5: Verify clippy accepts the example**

```bash
cargo clippy -p redextape-core --all-targets -- -D warnings
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/examples/state_cost_probe.rs
git commit -m "probe: the measurements MAX_MACHINE_STATES and MAX_NODE_ID rest on

Every number in this slice's doc comments came from here: 727 bytes a
state, 38,070 for the worst shipped demo, 80,000 for the largest NodeId
from source, and the balanced-tree ramp that turns the old '~172 GB before
this is reachable' argument into a 6.0 GB machine from 4 KB of input.

Kept rather than deleted for the reason the other eight probes are: this
tree gates on counts in tests and reports costs from examples/. Section F
must be run under a memory cap -- the kill is the measurement."
```

---

## Final verification

- [ ] **Run the full local gate**

```bash
scripts/check-all.sh --no-llvm --no-browser
```

Expected: every leg green, ending with `green, but PARTIAL — these tiers were SKIPPED: LLVM browser.` The new serde clippy leg from Task 1 must appear in the run.

- [ ] **Run the slow tier**

```bash
systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet scripts/check-slow.sh
```

Expected: green, including the three new `#[ignore]`d tests from Task 4.

- [ ] **Confirm no cast site still argues from RAM**

```bash
grep -rn "172 GB\|172GB" --include="*.rs" crates/
```

Expected: **three matches, all HISTORICAL NARRATION, none load-bearing** — `tm/build.rs` ("the
previous doc reasoned…"), `sourcemap.rs` ("THIS USED TO RESTATE…"), and the probe's header ("used to
justify themselves with…"). An earlier draft of this plan expected zero, which was wrong: recording
what the old argument was, and that measurement refuted it, is worth more than deleting it. What must
be gone is the argument used as a LIVE justification for a cast — check each hit reads as history.
