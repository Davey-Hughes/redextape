# Wire-type generation, PR 3 — the five wasm types — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the five `redextape-wasm` wire types from their Rust declarations, so that `web/src/types.ts` stops declaring any type that has a Rust declaration and becomes the barrel design §5 describes.

**Architecture:** `RunStatus`, `Decoded`, `LambdaStatus`, `TmStatus` and `TmScratchStatus` gain the same `#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]` line the twelve core types carry. `TmStatus.total_steps` takes design §6's fourth fidelity override — in a form the design got wrong, corrected here from measurement. The derive-site coverage scanner PR 2 built for `redextape-core` moves into `redextape-test-support` so both crates' gates share one implementation rather than one drifting copy each. `web/src/types.ts` then re-exports the five and keeps only what has no Rust declaration.

**Tech Stack:** Rust, `ts-rs` 10.1.0, `wasm-bindgen`, TypeScript, `vitest`, `cargo nextest`, `pnpm`.

---

## Global Constraints

Copied from the design and from this repository's standing rules. Every task's requirements include this section.

- **`ts` is optional and default-off on both crates.** `wasm-pack` never enables it; `ts-rs` must never enter the wasm32 dependency graph of a browser build.
- **The canonical derive line is one exact string, written verbatim at every derive site:**
  `#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]`
  No other line in either crate's `.rs` files may mention the bytes `ts_rs`. Both crates' gates enforce this as a whitelist — see `redextape-test-support`'s `ts_derive_scan` after Task 1. An extra `ts(...)` key goes on a **second** `#[cfg_attr(feature = "ts", ts(...))]` line, which mentions no `ts_rs` and is skipped as just another attribute.
- **No generated type may carry `bigint`.** `serde_wasm_bindgen` puts `u64` on the wire as a JS number; `ts-rs` maps it to `bigint` unconditionally.
- **Every `rm -r`-class command written into a script or a document uses `"${VAR:?}"`, never `"$VAR"`.** The colon form is the only one that aborts when the variable is set but empty.
- **Cite symbols, not `file:line`.** `scripts/check-citations.sh` enforces this outside `docs/`; inside `docs/` it is a convention this plan follows anyway, because a line number in a spec goes stale the same way.
- **Commit messages carry no attribution trailer** — no `Co-Authored-By`, no `Generated with`.
- **The pre-commit hook runs `clippy -D warnings` on every commit.** A commit split that cannot be made clippy-clean at each step must be collapsed and said so — never `--no-verify`.
- **A sabotage that does not fire is the finding.** Every gate this plan adds or moves must be shown failing against this tree before it is relied on passing.
- **Fix the class, not the instance.** Before calling any review finding done, run the search that would find its siblings and report the command and its full output.

---

## What the probe measured, before this plan was written

Run at `7c29b23` by adding the five derives, generating into a scratch directory, and reverting. The tree was left clean (`git status --porcelain` empty, no stray `bindings` directories). **These are measurements, not predictions — the tasks below are built on them.**

**1. The five types generate, and the wasm leg runs 5 tests where it ran 0.**

```
$ TS_RS_EXPORT_DIR=<scratch> cargo test -p redextape-wasm --features ts export_bindings
running 5 tests
test session::export_bindings_decoded ... ok
test session::export_bindings_lambdastatus ... ok
test session::export_bindings_runstatus ... ok
test session::export_bindings_tmscratchstatus ... ok
test session::export_bindings_tmstatus ... ok
```

`scripts/build-web-bindings.sh` already invokes that leg and already guards the swap on the scratch directory containing `.ts` files rather than on cargo's exit code — written when the wasm leg legitimately ran 0 tests. **That script needs no change.** Its comment saying the wasm leg runs 0 tests does (Task 3).

**2. `Decoded`, `LambdaStatus`, `RunStatus` and `TmScratchStatus` generate exactly the shapes `types.ts` declares by hand.** `Decoded` comes out as `{ "Value": { text: string, } } | "TooLargeToPrint" | "Undecodable" | "Unfinished" | { "Fault": { message: string, } }` — the same union in a different order, which is not a difference in TypeScript. `Option<NodeId>` (a `u32` alias) generates `number | null`; `usize` generates `number`; `RunStatus` generates `"Running" | "Ended" | "Capped" | "DepthRefused"`. `LambdaStatus`, `TmStatus` and `TmScratchStatus` each get `import type { RunStatus } from "./RunStatus";`.

**3. THE DESIGN'S PRESCRIBED OVERRIDE FOR `TmStatus.total_steps` IS WRONG, AND IT IS THE SAME CLASS OF DEFECT PR 2 FOUND IN THE PRESCRIPTION FOR `RuleView.moves`.** Design §6 prescribes `#[ts(type = "number")]`. Measured:

| override | generated |
|---|---|
| none | `total_steps: bigint \| null` |
| `ts(type = "number")` — **what §6 prescribes** | `total_steps: number` — **the `\| null` is gone** |
| `ts(type = "number \| null")` | `total_steps: number \| null` |
| `ts(as = "Option<u32>")` | `total_steps: number \| null` |
| `ts(as = "Option<f64>")` | `total_steps: number \| null` |

`ts(type = ...)` substitutes the **whole field type**, `Option` and all. `LambdaState.step` and `TmState.step` — the two core fields PR 2 gave `ts(type = "number")` — are bare `u64` with no `Option`, so the same override is correct there and wrong here. **This plan ships `ts(type = "number | null")`**, the literal form: it states what the wire carries, needs no import (neither `number` nor `null` is a named type, which is what made PR 2's `Array<Move>` fail), and does not claim a narrower Rust integer than the field has, which `Option<u32>` would.

**4. NO RUST-SIDE GATE CAN SEE THAT DEFECT, AND ONE TYPESCRIPT CONSUMER HAPPENING TO NARROW ON THE FIELD IS WHAT CATCHES IT.** `no_generated_type_carries_bigint` passes on `total_steps: number` — there is no `bigint` in it. What is left is `tsc`: `resultRows` in `web/src/results.ts` tests `t.status.total_steps !== null`, and `web/tests/node/replies.test.ts` and `web/tests/node/session-client.test.ts` assign `null` to the field. Task 2 Step 8 demonstrates that rather than asserting it, and names the boundary in the Rust doc.

**CORRECTION (2026-08-31, found by Task 3's fix round) — `resultRows` CATCHES NOTHING; THIS ENTRY NAMED THE WRONG MECHANISM.** `resultRows`'s `!== null` narrowing runs against a plain `number` type once the field is narrowed, and a `number`-vs-`null` comparison is not an error `tsc` reports — measured directly, sabotaging the field produces zero errors in `web/src/results.ts`. What actually catches it is three test fixtures assigning a literal `null` — `web/tests/node/replies.test.ts`, `web/tests/node/results.test.ts` (missing from this entry too) and `web/tests/node/session-client.test.ts` — and nothing in production source. Step 8 below still correctly instructs recording "every file and error code" from the real `tsc` output rather than asserting a mechanism in advance; only this probe finding's own guess at the mechanism was wrong, and the design doc's §6 CORRECTION carries the corrected version.

**5. `mod session;` IS PRIVATE, so an integration test in `crates/redextape-wasm/tests/` cannot name the five types.** Measured working: a `#[cfg(feature = "ts")] pub use session::{...}` in `lib.rs`, after which `cargo test -p redextape-wasm --features ts --test ts_bindings` compiles and runs, and `cargo clippy -p redextape-wasm --features ts --all-targets` and `cargo clippy -p redextape-wasm --all-targets` are both silent. The alternatives were `pub mod session` (exports the whole module to enable one test) and an inline `#[cfg(test)]` gate in `src/` (impossible: the scanner reads `src/session.rs`, so a `use ts_rs::TS;` in a test module inside it fails the canonical-line check).

**6. `check-doc-figures.sh` has no row this PR can move.** Its repo-level rows count workspace crates, pre-commit hooks and wasm **browser** tests; this PR adds no crate, no hook, and no `#[wasm_bindgen_test]`.

---

## File Structure

| file | fate |
|---|---|
| `crates/redextape-test-support/src/ts_derive_scan.rs` | **Create.** The derive-site scanner, moved out of `redextape-core`'s test file and parameterised by crate root. |
| `crates/redextape-test-support/src/lib.rs` | Modify: `pub mod ts_derive_scan;` and a paragraph on why a scanner lives in this crate. |
| `crates/redextape-core/tests/ts_bindings.rs` | Modify: shrinks to `generated()`, the two `#[test]`s, and their docs; the scanner's implementation and its doc leave. |
| `crates/redextape-wasm/src/session.rs` | Modify: five derive lines, one field override, prose merged into `TmStatus.total_steps` and `TmScratchStatus`. |
| `crates/redextape-wasm/src/lib.rs` | Modify: the feature-gated `pub use` the gate needs. |
| `crates/redextape-wasm/Cargo.toml` | Modify: `redextape-test-support` as a **target-gated** dev-dependency. |
| `crates/redextape-wasm/tests/ts_bindings.rs` | **Create.** The wasm crate's copy of the two gates, over its own five types. |
| `web/src/types.ts` | Modify: five declarations become re-exports; the migration paragraph goes; the file is the barrel. |
| `scripts/build-web-bindings.sh` | Modify: one comment that says the wasm leg runs 0 tests. |
| `docs/superpowers/specs/2026-08-29-wire-type-generation-design.md` | Modify: §6 CORRECTION for the override; §11 note that the scanner extraction is scope §11 did not name. |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | Modify: PR 3's entry (Task 4, **after** the whole-branch review). |

**CORRECTION (2026-09-01, found by the whole-branch review) — THE DESIGN §6 ROW ABOVE PROMISED A §11
NOTE THIS PLAN'S OWN SELF-REVIEW ALREADY DECIDED AGAINST.** The table's `docs/superpowers/specs/2026-
08-29-wire-type-generation-design.md` row says that file gets "§11 note that the scanner extraction is
scope §11 did not name." The Self-review section below states the opposite decision and the reason for
it: the scanner extraction "belongs in the roadmap entry, where scope decisions for a PR are recorded,"
not in the design. Design §11 is untouched by this branch — the roadmap entry is where that note
belongs, and where it lands when PR 3's entry is written (Task 4, after the whole-branch review, per
the last row of this table).

**Why the scanner moves rather than being copied.** The wasm types need the same two gates the core types have, and the coverage gate is ~180 lines of scanning logic whose seven revisions are recorded in its own doc. A second copy would drift silently the moment one is widened and the other is not — the exact class of defect this whole slice exists to close. `redextape-test-support` is where this workspace already puts a definition four call sites shared and could have forked. The alternative considered and rejected: leave `redextape-core`'s gate alone and give `redextape-wasm` a narrower one, on the argument that its one source file is easier to watch. That is the reasoning every one of the seven defeated revisions rested on.

---

### Task 1: The derive-site scanner moves into `redextape-test-support`

**Files:**
- Create: `crates/redextape-test-support/src/ts_derive_scan.rs`
- Modify: `crates/redextape-test-support/src/lib.rs`
- Modify: `crates/redextape-core/tests/ts_bindings.rs`

**Interfaces:**
- Produces, for Task 2:
  ```rust
  pub const CANONICAL_TS_DERIVE: &str = "#[cfg_attr(feature = \"ts\", derive(ts_rs::TS), ts(export))]";
  pub fn ts_deriving_type_names_in_crate(crate_root: &Path, scanner_path: &Path) -> BTreeSet<String>;
  pub fn without_doc_comments(ts: &str) -> String;
  ```
  `crate_root` is the caller's `Path::new(env!("CARGO_MANIFEST_DIR"))`. `scanner_path` is the one file the walk must not check — the caller's own test file — and the function asserts that file declares no `pub struct`/`pub enum` before excluding it.

**This task changes no behaviour.** `redextape-core`'s two tests must pass before and after, and the sabotages recorded against them must still fire. That is the whole acceptance criterion.

- [ ] **Step 1: Record the baseline, before touching anything**

```bash
cargo nextest run -p redextape-core --features ts -E 'binary(ts_bindings)'
```

Expected: `2 tests run: 2 passed`. **Write the exact line into the task report.** If it reads `0 tests run`, stop — the filter is wrong, not the tree. (`cargo nextest run -p redextape-core --features ts ts_bindings` matches test NAMES, not binaries, and silently runs nothing; that vacuous command shipped in PR 2's plan and was corrected there.)

- [ ] **Step 2: Create `crates/redextape-test-support/src/ts_derive_scan.rs` by moving, not rewriting**

Move these four items out of `crates/redextape-core/tests/ts_bindings.rs` **with their doc comments intact**: `CANONICAL_TS_DERIVE`, `ts_deriving_type_names_in_crate`, `resolve_item_name`, `without_doc_comments`. Make the first, second and fourth `pub`; leave `resolve_item_name` private to the module.

The file opens with:

```rust
//! The derive-site scanner both crates' `ts_bindings` gates run, and the JSDoc stripper the
//! `bigint` gate needs.
//!
//! **IT LIVES HERE BECAUSE THERE ARE TWO CRATES TO SCAN AND ONE SCANNER IS THE POINT.**
//! `redextape-core` and `redextape-wasm` each declare types carrying `ts_rs::TS`, and each needs the
//! same coverage gate over its own sources. The scanning logic below took four revisions plus three
//! more in review, every one of them defeated within minutes by an ordinary spelling of the same
//! attribute — a history recorded in full on `ts_deriving_type_names_in_crate`. A second copy of that
//! logic would drift from the first the moment one is widened and the other is not, which is the same
//! class of defect the gate itself exists to catch. Parameterising by crate root costs one argument.
//!
//! **THE PANICS BELOW ARE THE PRODUCT, NOT A LIBRARY PATH THAT FORGOT TO RETURN `Result`.** This
//! module is a test gate: a source shape it cannot resolve must fail loudly, naming the file and
//! line, rather than be skipped — a silent `continue` on an unrecognized line is precisely the defect
//! an earlier revision shipped. The workspace's `unwrap_used`/`expect_used`/`panic` lints are allowed
//! at module level for that reason, stated here rather than at each site. `clippy.toml`'s
//! `allow-*-in-tests` keys do not reach this code: these are free functions in a library crate, not
//! bodies of `#[test]` functions.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
```

Then the four items, in that order.

- [ ] **Step 3: Apply exactly these substitutions to the moved doc comments**

The moved prose describes "this crate" and "this file", which are now parameters. Change **only** these, and change every occurrence of each:

| from | to |
|---|---|
| `every file at or below `CARGO_MANIFEST_DIR`` | `every file at or below `crate_root`` |
| `this crate's own `.rs` files` | `the scanned crate's own `.rs` files` |
| `every line in this crate's own` | `every line in the scanned crate's own` |
| `The walk starts at `CARGO_MANIFEST_DIR`` | `The walk starts at `crate_root`` |
| `resolves outside `CARGO_MANIFEST_DIR`` | `resolves outside `crate_root`` |
| `one directory ABOVE `CARGO_MANIFEST_DIR`` | `one directory ABOVE `crate_root`` |
| `THIS FILE, BY ITS OWN PATH` | `THE CALLER'S OWN GATE FILE, BY THE PATH IT PASSES AS `scanner_path`` |
| ``use ts_rs::TS;` at the top of this very file (line 25)` | ``use ts_rs::TS;` at the top of the caller's gate file` |
| `this file is the SCANNER, not a candidate` | `that file is a SCANNER's caller, not a candidate` |

Two further edits, each for a reason of its own rather than a mechanical rename:

1. The `#[path]`-outside-the-root paragraph names `crates/redextape-core/tsalias.rs` and `crates/tsalias.rs` as the constructions that defeated earlier revisions. **Keep those paths.** They are the record of a specific sabotage that was really run against a specific crate, not a description of what the parameter now means; rewriting them to say `<crate_root>/tsalias.rs` would turn a measurement into a hypothetical.
2. The paragraph ending *"What this scan is actually measured against is the sabotage runs recorded against `docs/superpowers/plans/2026-08-30-wire-type-generation-core-types.md`'s Task 2 Step 5"* gains a second sentence: *"and the re-runs of those same sabotages recorded against `docs/superpowers/plans/2026-08-31-wire-type-generation-wasm-types.md`'s Task 1 Step 6, which is where this function was moved here from that file and shown still to fire."*

- [ ] **Step 4: Declare the module and say why it is in this crate**

In `crates/redextape-test-support/src/lib.rs`, after the existing crate-level doc, add a paragraph and the declaration:

```rust
//! `ts_derive_scan` (below) is the second thing this crate holds for the same structural reason as
//! the first: two crates need one definition and neither can own it. It needs no `proptest` and is
//! not behind that feature — it is plain `std`, so a consumer that opts out of `proptest` compiles it
//! at no dependency cost.

pub mod ts_derive_scan;
```

Put the `pub mod` after the `#![cfg_attr(test, allow(clippy::pedantic))]` attribute and before `#[cfg(feature = "proptest")] use proptest::prelude::*;`.

- [ ] **Step 5: Reduce `crates/redextape-core/tests/ts_bindings.rs` to its two gates**

The file keeps its module doc, its `#![allow(...)]`/`#![cfg(feature = "ts")]` header, its imports, `generated()`, and the two `#[test]` functions **with their doc comments unchanged**. It loses `CANONICAL_TS_DERIVE`, `ts_deriving_type_names_in_crate`, `resolve_item_name` and `without_doc_comments`, and gains:

```rust
use redextape_test_support::ts_derive_scan::{ts_deriving_type_names_in_crate, without_doc_comments};
```

`the_gate_covers_every_exported_type`'s body changes only in how it obtains `in_src`:

```rust
#[test]
fn the_gate_covers_every_exported_type() {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let in_src = ts_deriving_type_names_in_crate(crate_root, &crate_root.join("tests").join("ts_bindings.rs"));
    let in_gate: BTreeSet<String> = generated().into_iter().map(|(name, _)| name.to_string()).collect();

    let missing_from_gate: Vec<&String> = in_src.difference(&in_gate).collect();
    let stale_in_gate: Vec<&String> = in_gate.difference(&in_src).collect();

    assert!(
        missing_from_gate.is_empty() && stale_in_gate.is_empty(),
        "`generated()` and this crate's `ts_rs::TS` derive sites disagree. Carry the derive but are \
         missing from `generated()`: {missing_from_gate:?}. Listed in `generated()` but no longer carry \
         the derive: {stale_in_gate:?}. Add the new type to `generated()`, or remove the stale entry — \
         or, if the derive was written in some other form, make the two agree."
    );
}
```

Drop `use std::fs;` if nothing else in the file uses it; keep `use std::collections::BTreeSet;` and `use std::path::Path;`.

**The doc on `the_gate_covers_every_exported_type` ends by pointing at `ts_deriving_type_names_in_crate`'s own doc "for what this construction actually guarantees".** That pointer now crosses a crate. Change the final sentence to name the new home: *"See `redextape_test_support::ts_derive_scan::ts_deriving_type_names_in_crate`'s own doc for what this construction actually guarantees, and what remains outside it, named rather than denied."*

- [ ] **Step 6: Prove the move preserved every sabotage, by re-running them**

This is the task's real verification. `cargo nextest run` passing after a refactor says the tests still compile and pass; it does not say they still **catch** anything. Re-run each of these against the moved scanner, one at a time, restoring the tree between each. **Record the command, the assertion message, and the restore in the task report.**

```bash
# S1 — a type carrying the derive but absent from `generated()`.
#      Append to crates/redextape-core/src/span.rs:
#          #[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#          #[derive(Clone, Copy, Debug, PartialEq, Eq)]
#          #[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#          pub struct Sneaky { pub n: u32 }
cargo nextest run -p redextape-core --features ts -E 'binary(ts_bindings)'
# Expected: the_gate_covers_every_exported_type FAILS naming `Sneaky` in `missing_from_gate`.

# S2 — a non-canonical mention of the crate name, via an alias.
#      Add to crates/redextape-core/src/lib.rs:  use ::ts_rs as tsrs;
cargo nextest run -p redextape-core --features ts -E 'binary(ts_bindings)'
# Expected: the canonical-line assertion FAILS, naming lib.rs and the line.

# S3 — a `u64` field with no override.
#      In crates/redextape-core/src/viewmodel.rs, delete the
#      `#[cfg_attr(feature = "ts", ts(type = "number"))]` line above `LambdaState::step`.
cargo nextest run -p redextape-core --features ts -E 'binary(ts_bindings)'
# Expected: no_generated_type_carries_bigint FAILS naming LambdaState.

# S4 — a `pub struct` added to the gate file itself, which the self-exclusion would otherwise hide.
#      Append `pub struct X;` to crates/redextape-core/tests/ts_bindings.rs.
cargo nextest run -p redextape-core --features ts -E 'binary(ts_bindings)'
# Expected: the self-exclusion's own assertion FAILS, naming that file.
```

After each: restore the file and re-run to `2 tests run: 2 passed`. Then confirm nothing was left behind:

```bash
git status --porcelain
find crates -maxdepth 2 -iname bindings -type d
```

Both must print nothing. **`crates/*/bindings/` is gitignored, so a stray generated directory leaves `git status` clean — check it by name, every time.**

- [ ] **Step 7: Run the checks this task can break, and commit**

```bash
cargo clippy -p redextape-test-support --all-targets
cargo clippy -p redextape-core --features ts --all-targets
cargo nextest run -p redextape-core --features ts -E 'binary(ts_bindings)'
cargo nextest run -p redextape-cli    # the one consumer with `default-features = false`
```

All four must be silent / green. Then:

```bash
git add crates/redextape-test-support/src/ts_derive_scan.rs crates/redextape-test-support/src/lib.rs crates/redextape-core/tests/ts_bindings.rs
git commit -m "refactor: the ts-rs derive-site scanner moves to redextape-test-support

Two crates need this gate and one implementation is the point: the scan took
seven revisions, each defeated by an ordinary spelling of the same attribute,
and a second copy would drift from the first the moment one is widened. The
doc moves with the function; the four sabotages it was measured against were
re-run against the moved copy and all four still fire."
```

---

### Task 2: The five derives, the override, the prose, and the wasm gate

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs`
- Modify: `crates/redextape-wasm/src/lib.rs`
- Modify: `crates/redextape-wasm/Cargo.toml`
- Create: `crates/redextape-wasm/tests/ts_bindings.rs`
- Modify: `docs/superpowers/specs/2026-08-29-wire-type-generation-design.md`

**Interfaces:**
- Consumes, from Task 1: `redextape_test_support::ts_derive_scan::{CANONICAL_TS_DERIVE, ts_deriving_type_names_in_crate, without_doc_comments}`.
- Produces, for Task 3: `web/bindings/{RunStatus,Decoded,LambdaStatus,TmStatus,TmScratchStatus}.ts`, generated by `pnpm run build:bindings`.

- [ ] **Step 1: Add the five derive lines**

In `crates/redextape-wasm/src/session.rs`, insert the canonical line **immediately above** each type's existing `#[derive(...)]` line — above it, not merged into it, and byte-identical to `CANONICAL_TS_DERIVE`:

```rust
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
```

The five sites are the `#[derive(Clone, ...)]` lines above `pub enum RunStatus`, `pub enum Decoded`, `pub struct LambdaStatus`, `pub struct TmStatus` and `pub struct TmScratchStatus`. These types carry `serde::Serialize, serde::Deserialize` inside the main `derive` list rather than under a `cfg_attr` — unlike the core types, because this crate depends on `serde` unconditionally. **Leave that line alone**; the new line goes above it.

- [ ] **Step 2: Add the override on `TmStatus.total_steps`, and the prose that justifies it**

Replace the field's declaration (keeping the existing doc comment above it in full) with the existing doc followed by these paragraphs and the attribute:

```rust
    /// **`ts(type = "number | null")`, NOT `ts(type = "number")` — AND THE DESIGN PRESCRIBED THE
    /// SECOND.** `ts-rs` maps `u64` to `bigint` unconditionally, which is not what the wire carries:
    /// `serde_wasm_bindgen` puts it across as a JS number, which
    /// `all_three_legs_agree_across_the_boundary` in `crates/redextape-wasm/tests/browser.rs`
    /// measures directly against a real browser. So an override is needed. But `ts(type = ...)`
    /// substitutes the WHOLE field type, `Option` and all, so the prescribed `ts(type = "number")`
    /// generates `total_steps: number` and silently drops the `| null` that `None` puts on the wire.
    /// `LambdaState::step` and `TmState::step` take that same override correctly, because they are
    /// bare `u64` with no `Option` around them.
    ///
    /// **NO RUST-SIDE GATE CAN SEE THE DROPPED `| null`.** `no_generated_type_carries_bigint` passes
    /// on `total_steps: number` — there is no `bigint` in it to find. What catches it is `tsc`, and
    /// only because consumers happen to narrow on the field: `resultRows` in `web/src/results.ts`
    /// tests `!== null`, and `web/tests/node/replies.test.ts` assigns `null` to it. That is real
    /// coverage rather than a gate, and it is named here rather than being relied on quietly.
    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
    pub total_steps: Option<u64>,
```

**CORRECTION (2026-08-31, found by Task 3's fix round) — THE NARROWING-CONSUMER CLAIM ABOVE IS WRONG,
AND THE SHIPPED DOC DOES NOT MATCH THIS STEP.** `resultRows`'s `!== null` narrowing runs against a
plain `number` and produces no `tsc` error — the prescribed paragraph above names a mechanism that
catches nothing. `crates/redextape-wasm/src/session.rs`'s doc comment, as it now stands, instead names
three test fixtures assigning a literal `null` to the field, and states plainly that no production
source file catches this. Treat the paragraph above as superseded prose, not the version that shipped.

- [ ] **Step 3: Merge the one paragraph of TypeScript prose that has no Rust counterpart**

Of the five types, only `TmScratchStatus` carries a doc comment in `web/src/types.ts`. Compare it against the Rust doc: the `total_steps` argument, the `header` argument and the `width`/`run` non-nullability argument are all already in the Rust doc, at greater length. **One fact is not**, and it is the mechanical one — append it to the Rust doc's `total_steps` paragraph:

```rust
/// The Rust side pins the field list by an exhaustive destructuring in this module's own tests
/// (`let TmScratchStatus { available, reason, width, run, header } = sc.tm_status();`), so a sixth
/// field added here fails to compile there with `E0027` rather than merely going unrendered.
```

Everything else in the TypeScript block is a restatement, and its closing line already says so — *"See that Rust struct for the argument in full."* Relocating means reconciling, not pasting (design §8).

- [ ] **Step 4: Re-export the five so an integration test can name them**

`mod session;` is private, so `crates/redextape-wasm/tests/ts_bindings.rs` cannot reach these types. In `crates/redextape-wasm/src/lib.rs`, immediately after `mod session;`:

```rust
/// The five wire types this crate declares, re-exported for `tests/ts_bindings.rs`.
///
/// **FEATURE-GATED, AND NARROWED TO FIVE NAMES, BECAUSE IT EXISTS FOR A GATE.** `mod session` is
/// private and stays private: `Session`, `Compiled`, `TmScratch` and the rest are this crate's
/// internals, reached from JavaScript through `#[wasm_bindgen]` rather than from Rust. But the two
/// fidelity gates are integration tests, and an integration test links against this crate the way any
/// consumer would — it cannot see into a private module. `pub mod session` would export everything to
/// enable one test; an inline `#[cfg(test)]` gate inside `session.rs` cannot work at all, because the
/// coverage scanner reads that file and a `use ts_rs::TS;` anywhere in it fails the canonical-line
/// check. Under default features — which is every browser build — this line does not exist.
#[cfg(feature = "ts")]
pub use session::{Decoded, LambdaStatus, RunStatus, TmScratchStatus, TmStatus};
```

- [ ] **Step 5: Add the dev-dependency, target-gated**

In `crates/redextape-wasm/Cargo.toml`, after the existing `[dev-dependencies]` block:

```toml
# `redextape-test-support` HOLDS THE DERIVE-SITE SCANNER `tests/ts_bindings.rs` RUNS, and it is behind
# a target gate for the same reason `redextape-core`'s `mimalloc` is: `wasm-pack test` builds this
# crate's dev-dependency graph for wasm32, and nothing in that graph may be able to break the browser
# leg. The gate this pulls in is `#![cfg(feature = "ts")]` and never compiled for wasm32 anyway, so the
# dependency has no business being in that graph at all. `default-features = false` drops `proptest`,
# which this crate does not use — the same opt-out `redextape-cli` takes.
[target.'cfg(not(target_arch = "wasm32"))'.dev-dependencies]
redextape-test-support = { path = "../redextape-test-support", default-features = false }
```

- [ ] **Step 6: Write `crates/redextape-wasm/tests/ts_bindings.rs`**

```rust
//! Fidelity gates on the generated TypeScript for the types THIS crate declares. Feature-gated
//! whole: without `ts` there are no `TS` impls to ask and this target compiles to nothing.
//!
//! **THE SIBLING OF `crates/redextape-core/tests/ts_bindings.rs`, OVER A DIFFERENT SET OF TYPES.**
//! Both run the same two gates and both call the same scanner —
//! `redextape_test_support::ts_derive_scan` — which is why that scanner lives in a shared crate
//! rather than in either test file. Read its doc for what the coverage scan guarantees, the seven
//! revisions that shaped it, and the three routes it names as outside its reach rather than closed.
//! What is local to this file is the list below and the reason each entry is on it.
//!
//! THESE ASK THE TYPES, NOT `web/bindings/`. `ts-rs` emits one `export_bindings_*` test per type and
//! cargo orders tests arbitrarily, so a directory scan can run before generation and pass on an empty
//! directory. `export_to_string` returns what the exporter would write, in this process.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
#![cfg(feature = "ts")]

use std::collections::BTreeSet;
use std::path::Path;

use redextape_test_support::ts_derive_scan::{ts_deriving_type_names_in_crate, without_doc_comments};
use redextape_wasm::{Decoded, LambdaStatus, RunStatus, TmScratchStatus, TmStatus};
use ts_rs::TS;

/// Every type in this crate carrying `#[ts(export)]`, paired with the file it generates.
///
/// **FIVE, AND `redextape-core`'s TWELVE ARE NOT AMONG THEM.** Each crate's gate covers its own
/// derive sites, because `ts_deriving_type_names_in_crate` scans one crate root and a type declared
/// in the other one is invisible to it from here. That is the correct division: a core type added
/// without an entry in core's `generated()` fails core's gate, not this one.
fn generated() -> Vec<(&'static str, String)> {
    vec![
        ("Decoded", Decoded::export_to_string().unwrap()),
        ("LambdaStatus", LambdaStatus::export_to_string().unwrap()),
        ("RunStatus", RunStatus::export_to_string().unwrap()),
        ("TmScratchStatus", TmScratchStatus::export_to_string().unwrap()),
        ("TmStatus", TmStatus::export_to_string().unwrap()),
    ]
}

/// No generated type may carry `bigint`.
///
/// THE DEFAULT IS WRONG SILENTLY AND ONLY THE BROWSER TIER COULD OTHERWISE CATCH IT. `ts-rs` maps
/// `u64` to `bigint` unconditionally; `serde_wasm_bindgen` puts a `u64` on the wire as a JS number,
/// which `browser.rs` measures directly in this very crate. A field of that class added without an
/// override generates TypeScript that typechecks, ships, and is wrong at runtime. This fails at the
/// commit instead.
///
/// **IT DOES NOT CATCH EVERY WAY AN OVERRIDE CAN BE WRONG, AND `TmStatus::total_steps` IS THE
/// STANDING EXAMPLE.** `ts(type = "number")` on that `Option<u64>` field generates `total_steps:
/// number` — no `bigint`, so this gate passes, and the `| null` that `None` puts on the wire is gone.
/// See that field's own doc for what does catch it. Naming the hole here is the point: a gate that
/// implied it covered the whole override class would tell the next reader not to check.
///
/// THE SCAN SKIPS JSDOC. `export_to_string` reproduces Rust doc comments verbatim, so a doc comment
/// that merely discusses `bigint` in prose would otherwise fail this test for a documentation reason
/// having nothing to do with the generated type.
#[test]
fn no_generated_type_carries_bigint() {
    for (name, ts) in generated() {
        assert!(
            !without_doc_comments(&ts).contains("bigint"),
            "{name} generates `bigint`. A `u64`/`i64` field crosses this boundary as a JS number, so \
             it needs an override — `#[cfg_attr(feature = \"ts\", ts(type = \"number\"))]` for a bare \
             field, or `ts(type = \"number | null\")` for one behind an `Option`, because \
             `ts(type = ...)` replaces the WHOLE field type rather than the integer inside it. \
             Generated:\n{ts}"
        );
    }
}

/// The list above covers every type in this crate that derives `ts_rs::TS` — by name, not merely by
/// count, and not by trusting one literal spelling of the attribute that carries it.
///
/// WITHOUT THIS, THE GATE ABOVE IS ONLY AS COMPLETE AS SOMEONE'S MEMORY. A type added with the derive
/// and not added to `generated()` would be unwatched, and the failure would be silence.
///
/// A COUNT IS NOT ENOUGH TO CATCH THAT: a commit that removes the derive from a listed type and adds
/// it to a different one leaves the count unchanged while `generated()`'s stale entry keeps compiling,
/// because `export_to_string` is a default trait method and does not require `#[ts(export)]`.
/// Comparing NAMES as sets catches both directions.
///
/// **THE SCAN ITSELF IS `redextape_test_support::ts_derive_scan`'s, AND ITS DOC IS WHERE THE
/// REASONING LIVES** — four revisions plus three more in review, each defeated by an ordinary
/// spelling of the same attribute, ending in a whitelist rather than a fifth banned spelling. Read it
/// before assuming this gate is stronger or weaker than it is; it names three routes it does not
/// close rather than denying them.
#[test]
fn the_gate_covers_every_exported_type() {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let in_src = ts_deriving_type_names_in_crate(crate_root, &crate_root.join("tests").join("ts_bindings.rs"));
    let in_gate: BTreeSet<String> = generated().into_iter().map(|(name, _)| name.to_string()).collect();

    let missing_from_gate: Vec<&String> = in_src.difference(&in_gate).collect();
    let stale_in_gate: Vec<&String> = in_gate.difference(&in_src).collect();

    assert!(
        missing_from_gate.is_empty() && stale_in_gate.is_empty(),
        "`generated()` and this crate's `ts_rs::TS` derive sites disagree. Carry the derive but are \
         missing from `generated()`: {missing_from_gate:?}. Listed in `generated()` but no longer carry \
         the derive: {stale_in_gate:?}. Add the new type to `generated()`, or remove the stale entry — \
         or, if the derive was written in some other form, make the two agree."
    );
}
```

- [ ] **Step 7: Run the gates and confirm they pass on an honest tree**

```bash
cargo nextest run -p redextape-wasm --features ts -E 'binary(ts_bindings)'
```

Expected: `2 tests run: 2 passed`. Then generate and read the output:

```bash
cd web && pnpm run build:bindings && ls bindings && grep -n total_steps bindings/TmStatus.ts
```

Expected: 17 files; `total_steps: number | null, };`. **If the count is not 17 or the field is not `number | null`, stop and report — do not proceed to Task 3.**

- [ ] **Step 8: Sabotage all three, one at a time**

**Each is restored before the next.** Record every command, its failure message, and the restore.

```bash
# S1 — the override removed entirely. Delete the `#[cfg_attr(feature = "ts", ts(type = ...))]`
#      line above `total_steps`.
cargo nextest run -p redextape-wasm --features ts -E 'binary(ts_bindings)'
# Expected: no_generated_type_carries_bigint FAILS naming TmStatus.

# S2 — THE DESIGN'S OWN PRESCRIPTION. Change the override to `ts(type = "number")`.
cargo nextest run -p redextape-wasm --features ts -E 'binary(ts_bindings)'
# Expected: BOTH GATES PASS. This is the finding, not a failure of the exercise — record the
# "2 tests run: 2 passed" line verbatim, because it is the evidence for the `total_steps` doc's
# claim that no Rust-side gate sees this.
cd web && pnpm run build:bindings && grep -n total_steps bindings/TmStatus.ts && pnpm run typecheck; cd ..
# Expected: `total_steps: number` in the generated file, and `pnpm run typecheck` FAILS.
# Record the full tsc output — every file and error code. That output is what the doc's claim
# rests on, and PR 2 had a disputed figure precisely because a count was asserted instead of run.

# S3 — a sixth type carrying the derive but absent from `generated()`. Append to session.rs:
#          #[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#          #[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#          pub struct Sneaky { pub n: u32 }
cargo nextest run -p redextape-wasm --features ts -E 'binary(ts_bindings)'
# Expected: the_gate_covers_every_exported_type FAILS naming `Sneaky` in `missing_from_gate`.
```

After the last restore, check for strays by name — `web/bindings/` and `crates/*/bindings/` are gitignored, so a leftover `Sneaky.ts` leaves `git status` clean:

```bash
git status --porcelain
ls web/bindings | wc -l          # must read 17
ls web/bindings/Sneaky.ts 2>&1   # must say "No such file or directory"
find crates -maxdepth 2 -iname bindings -type d
```

- [ ] **Step 9: Correct design §6**

Add a second CORRECTION block to §6, below the existing one about `Array<Move>`:

```markdown
**CORRECTION (2026-08-31, found by PR 3's probe) — `#[ts(type = "number")]` ON `TmStatus.total_steps`
IS THE WRONG FORM, FOR THE SAME REASON THE `Array<Move>` PRESCRIPTION ABOVE WAS.** `ts(type = ...)`
substitutes the WHOLE field type, `Option` included. Measured on the five types: no override generates
`bigint | null`; the prescribed `ts(type = "number")` generates `total_steps: number`, silently
dropping the `| null` that `None` puts on the wire; and `ts(type = "number | null")`,
`ts(as = "Option<u32>")` and `ts(as = "Option<f64>")` all generate `number | null`. PR 3 ships the
first of those three — literal, needing no import, and claiming no narrower Rust integer than the
field has. **The two `redextape-core` fields in the table above are unaffected**: `LambdaState.step`
and `TmState.step` are bare `u64` with no `Option`, so `ts(type = "number")` is correct there and
shipped in PR 2. **And no Rust-side gate sees this class**, which is the sharper half: the no-`bigint`
gate passes on `total_steps: number`. `tsc` catches it, and only because two TypeScript consumers
happen to narrow on the field — see PR 3's roadmap entry for that measurement.
```

**CORRECTION (2026-08-31, found by Task 3's fix round) — "TWO TYPESCRIPT CONSUMERS... NARROW ON THE
FIELD" IS WRONG, AND SO IS THE BLOCK IT WAS COPIED INTO.** Only one of the two ever named,
`resultRows` in `web/src/results.ts`, is a consumer at all, and its `!== null` narrowing against a
plain `number` produces no `tsc` error — it catches nothing. What catches the dropped `| null` is
three test fixtures assigning a literal `null` (`replies.test.ts`, `results.test.ts`,
`session-client.test.ts`), none of them a "TypeScript consumer" in the sense this sentence means.
This step's block is what actually got typed into §6 first, and §6 has since been corrected past it
directly (its own second CORRECTION block now names the three test fixtures and says outright that
no production source file catches this) — read that block, not this one.

Also convert §6's `crates/redextape-wasm/tests/browser.rs:884` citation to the symbol
`all_three_legs_agree_across_the_boundary` in `crates/redextape-wasm/tests/browser.rs`. A line number
in a spec goes stale the way one in source does; this table's own row is the only `file:line` left in
the section.

- [ ] **Step 10: Run the full local gate and commit**

```bash
cargo clippy -p redextape-wasm --features ts --all-targets
cargo clippy -p redextape-wasm --all-targets
cargo nextest run -p redextape-wasm --features ts
cargo check --target wasm32-unknown-unknown -p redextape-wasm --lib
```

The last is the browser build's configuration — it must be clean, and it must **not** pull `ts-rs` in. Then commit `session.rs`, `lib.rs`, `Cargo.toml`, `tests/ts_bindings.rs` and the design.

---

### Task 3: `types.ts` becomes the barrel

**Files:**
- Modify: `web/src/types.ts`
- Modify: `scripts/build-web-bindings.sh`

**Interfaces:**
- Consumes, from Task 2: `web/bindings/{RunStatus,Decoded,LambdaStatus,TmStatus,TmScratchStatus}.ts`.
- Produces: nothing new. **The 44 files that import `./types` are not touched.**

- [ ] **Step 1: Replace the five declarations with re-exports**

Delete `export type RunStatus`, `export type Decoded`, `export type LambdaStatus`, `export type TmStatus`, and `export type TmScratchStatus` **together with `TmScratchStatus`'s doc block** — that prose moved into Rust in Task 2 and `ts-rs` now copies it into the generated file verbatim. Leaving a copy behind is the drift this slice exists to close.

`Decoded` is needed as a name inside this file (`decodedText`'s parameter), so it follows the `Owner`/`Span`/`TokenClass` pattern already here: import it, and add it to the re-export list.

The import and export blocks become:

```ts
import type { Decoded } from '../bindings/Decoded'
import type { Owner } from '../bindings/Owner'
import type { Span } from '../bindings/Span'
import type { TokenClass } from '../bindings/TokenClass'

export type { Cut } from '../bindings/Cut'
export type { Diagnostic } from '../bindings/Diagnostic'
export type { LambdaState } from '../bindings/LambdaState'
export type { LambdaStatus } from '../bindings/LambdaStatus'
export type { Move } from '../bindings/Move'
export type { RuleView } from '../bindings/RuleView'
export type { RunStatus } from '../bindings/RunStatus'
export type { Severity } from '../bindings/Severity'
export type { StateView } from '../bindings/StateView'
export type { TmProgram } from '../bindings/TmProgram'
export type { TmScratchStatus } from '../bindings/TmScratchStatus'
export type { TmState } from '../bindings/TmState'
export type { TmStatus } from '../bindings/TmStatus'
export type { Decoded, Owner, Span, TokenClass }
```

- [ ] **Step 2: Rewrite the header — the file is no longer partially migrated**

The last paragraph of the header (`THE MIGRATION IS PARTIAL AND THIS COMMENT TRACKS IT ...`) describes a state this commit ends. Replace it with:

```ts
// WHAT IS STILL DECLARED BELOW IS EVERYTHING THAT HAS NO RUST DECLARATION TO GENERATE FROM, and that
// is now the whole of it — there is no remaining migration and no later PR to wait for. `Classified`
// is a structural alias over two generated types, with no derive site to attach a `#[derive(TS)]` to.
// `TOKEN_CLASSES` is a runtime array, which a generated *type* cannot supply; the pin below it is what
// holds the two together. `ownerNode`, `decodedText` and `assertTokenClasses` are consumers, not
// shapes.
//
// `LinkIndexWire` IS THE ONE WIRE TYPE THIS FILE NEVER COVERED, and it is still hand-written and
// still unwatched — see `link.ts`, where `Session::link_index` assembles a columnar value by hand at
// the boundary rather than serializing a struct. Generation cannot reach it. It is named here so this
// header is not read as claiming the whole boundary is generated.
```

**Keep the first two paragraphs unchanged.** They describe how the boundary encodes things — the snake_case `total_steps`, the bare-variant-name enum encoding — which is about this file rather than any one type, and design §5 puts it here on purpose. **Carry no count of any kind** into this header; PR 2 deliberately left counts out of it, and the roadmap records why.

- [ ] **Step 3: Fix the one stale comment in the build script**

`scripts/build-web-bindings.sh` says, in two places, that `redextape-wasm`'s leg "legitimately runs 0 tests today". After Task 2 it runs five. **The guard itself must not change** — a filter that matches nothing still exits 0 having written nothing, which is the property that guard tests for, and it remains true. Only the parenthetical example is now false. Replace both occurrences of the claim with the reason stated without that example: a `cargo test` filter that matches nothing exits 0 having written nothing, so "cargo exited 0" was never evidence that generation happened. (`redextape-wasm`'s leg ran 0 tests until PR 3 gave that crate its own derives; the guard was written then and is unchanged.)

- [ ] **Step 4: Typecheck, test, and read the diff of the generated surface**

```bash
cd web
pnpm run build:bindings
pnpm run typecheck
pnpm run test
```

Expected: 17 files generated, `typecheck` exit 0, and the vitest suite at least as green as `main`'s 69 files / 676 tests. **Record the actual counts; do not copy those two figures forward.** If any test fails, the generated shape differs from the hand-written one — report the diff rather than editing the test.

- [ ] **Step 5: Prove the barrel actually re-exports what it claims**

```bash
grep -c '^export type [A-Za-z]' web/src/types.ts
```

Expected: `1` — `Classified` alone, the one type with no derive site. Then check nothing imports a binding directly around the barrel:

```bash
grep -rn "from '\.\./bindings/\|from '\./\.\./bindings/" web/src/ | grep -v 'web/src/types.ts'
```

Expected: no output. The barrel is the single entry point; a direct import elsewhere would route around it.

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts scripts/build-web-bindings.sh
git commit -m "feat: types.ts becomes the barrel — five wasm types re-exported, none declared

Every type in this file that has a Rust declaration now comes from it. What
stays is what cannot be generated: a structural alias with no derive site, a
runtime array a generated type cannot supply, and three consumers. The header
says so, and names LinkIndexWire as the wire type this file never covered."
```

---

## Before Task 4: the whole-branch review

**Task 4 writes the branch's summary, so it must not run before the review that reads the whole branch.** That ordering is a standing rule here, and PR 1 paid for breaking it: its roadmap entry claimed *"no mechanism was changed because a review asked for it"*, and the whole-branch review then changed three mechanisms, one of them a Critical.

Dispatch the whole-branch review on the most capable available model, over `git merge-base main HEAD..HEAD`, and ask it the questions only it can be asked:

1. **What unchanged code depended on a guard this branch removed?** Every instance this repository has recorded was found by that question. Point it at `scripts/build-web-bindings.sh`'s swap guard (the wasm leg's test count changed under it), at `redextape-core`'s gate (its scanner moved out from under it), and at `web/`'s 44 importers of `./types`.
2. **What did this plan ASSERT rather than measure?** The probe measurements at the top of this file are the ones with evidence; anything else is a claim.
3. **Does a later commit contradict an earlier one it corrected?** Task 2 corrects the design; Task 3 corrects a script comment Task 2 falsified.
4. Triage the Minor findings banked in the ledger.

The `docker` job is **skipped on pull requests and absent from `gate`'s `needs`**, so a PR can go green on a `Dockerfile` this branch broke — which is exactly how PR 1's Critical shipped past four clean task reviews. This branch touches no `Dockerfile` and adds no build step to `build:app`, but say so from evidence rather than from memory: `git diff --stat` over the branch, and `grep -n build:bindings web/package.json`.

---

### Task 4: The roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**This task runs last, after the whole-branch review and its fix rounds.** A substantive PR needs its entry before it opens.

- [ ] **Step 1: Write the entry, following the PR 2 entry's shape**

Place it directly after the PR 2 entry (the one headed `THE TWELVE CORE WIRE TYPES GENERATE...`). It opens with a `####` heading naming what the PR found rather than what it did, then `Design:` and `Plan:` links, then `#####` sections. The sections this PR has earned:

- **The design's second wrong override, and why it is the same defect as the first.** §6 has now been corrected twice, both times because `ts(type = ...)` substitutes more of the type than the prescription assumed. Say what the shared mechanism is.
- **A gate that passes on the defect, stated as the finding.** Task 2 Step 8's S2 is the evidence: both Rust gates green on `total_steps: number`, and `pnpm typecheck` red. Quote both outputs.
- **The scanner moved rather than being copied, and the four sabotages were re-run against the moved copy.** Task 1 Step 6's output.
- **WHAT STAYS OPEN.** Carry forward, updated: `LinkIndexWire`; `TermTree`/`TermNode`; the coverage scan's three named routes; nothing comparing generated types against the measured wire; a stale `web/bindings/` still typechecking. **Remove** "PR 3 — the five wasm types" — this is it. **Add** the override class: no gate covers an override that changes a field's nullability, and `tsc` catches it only while a consumer narrows on the field.
- **The `docker` job's PR exemption**, restated, per PR 1's instruction to say so every time.
- **CI**, with the run number and the SHA read from the pull request's own `head.sha` rather than assumed from the branch.
- **VERIFICATION.**

- [ ] **Step 2: Measure every VERIFICATION figure, at the branch's last commit before this entry**

Each row names its command and each command is run. **Do not carry a figure forward from an earlier entry or from this plan** — the probe figures above were measured at `7c29b23` against a tree that had no derives.

```
<n>   commits                     git rev-list --count <merge-base>..<head>
<n>   files, +a/-b                git diff --shortstat <merge-base>..<head>
<n>   generated files             (cd web && rm -rf "${PWD:?}/bindings" && pnpm run build:bindings
                                   >/dev/null && find bindings -type f | wc -l)
<n>   ts(export) attributes       grep -rc 'ts(export)' crates/redextape-wasm/src | awk -F: '{n+=$2} END {print n}'
<n>   types declared in types.ts  grep -c '^export type [A-Za-z]' web/src/types.ts
```

Plus the outputs of `pnpm run typecheck`, `pnpm run test`, `pre-commit run --all-files`, and `scripts/check-all.sh --no-llvm --no-browser` — the last quoted with its own closing PARTIAL line rather than called green.

**State the property, not the count, wherever a count would drift**, and never write "the only" or "the largest" where a value can be written instead.

- [ ] **Step 3: Confirm no stray generated artifacts, then commit**

```bash
git status --porcelain
find crates -maxdepth 2 -iname bindings -type d
find web -maxdepth 1 -iname 'bindings.*'
```

All three must print nothing (`web/bindings` itself is expected and gitignored).

---

## Self-review

**Spec coverage.** Design §11's PR 3 list: derives ✅ (Task 2 Step 1); prose relocated ✅ (Task 2 Step 3); the `TOKEN_CLASSES` pin — **already shipped in PR 2**, and §11 carries the correction saying so; the `assertTokenClasses` retention note — **already in `types.ts`**, written in PR 2 on both `TOKEN_CLASSES` and `assertTokenClasses`, and Task 3 Step 2 preserves it; the header prose to the barrel ✅ (`types.ts` *is* the barrel — Task 3 Step 2 keeps the first two paragraphs and replaces only the migration tracker); `types.ts` reduced to the barrel ✅ (Task 3). §6's fourth override ✅ (Task 2 Step 2), in a corrected form. §7's feature gating ✅ (Task 2 Step 10's wasm32 check).

**Scope §11 does not name:** the scanner extraction (Task 1). It is here because the five wasm types otherwise ship either unwatched or watched by a second copy of a gate that has been defeated seven times. Task 2 Step 9 does not record this in the design — it belongs in the roadmap entry, where scope decisions for a PR are recorded.

**Placeholders:** none. Every code step carries its code; every verification step carries its command and its expected output.

**Type consistency:** `ts_deriving_type_names_in_crate(crate_root, scanner_path)` has the same two-argument signature in Task 1 Step 5, Task 1's Interfaces block, and Task 2 Step 6. `without_doc_comments(&str) -> String` is unchanged from PR 2. `redextape_wasm::{Decoded, LambdaStatus, RunStatus, TmScratchStatus, TmStatus}` is the same five names in Task 2 Steps 4 and 6.

**The one figure this plan asserts without measuring it here:** Task 3 Step 4's "at least as green as `main`'s 69 files / 676 tests". Those two numbers come from the PR 2 roadmap entry, at `d4d3cfa`. The step says to record the actual counts rather than copy them forward, for that reason.
