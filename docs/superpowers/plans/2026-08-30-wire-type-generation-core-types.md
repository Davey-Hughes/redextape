# Wire-type generation, PR 2 — the core crate's types

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every wire type `redextape-core` declares is generated from its Rust declaration instead of
mirrored by hand in `web/src/types.ts`. What remains of core's side of that file afterwards is one
structural alias the generator has no derive site for — `Classified` — plus the two consumer
functions and the array that cannot be a type.

**Architecture:** eleven Rust types gain the same `#[cfg_attr(feature = "ts", derive(ts_rs::TS),
ts(export))]` line `Span` gained in PR 1. Three fields whose generated type disagrees with the
measured wire get an override. The prose describing them moves out of TypeScript and into the Rust
doc comments the generator copies, and only then does `web/src/types.ts` drop the declarations and
re-export the generated files. A Rust test asserts no generated file carries `bigint`, so the fifth
field of that class fails at the commit that adds it rather than in Chrome.

**Tech Stack:** Rust, `ts-rs` 10.1.0 (with its default `serde-compat`), serde, TypeScript 7.0.2,
pnpm, Vitest, Playwright, cargo-nextest.

**Design:** [`../specs/2026-08-29-wire-type-generation-design.md`](../specs/2026-08-29-wire-type-generation-design.md), §11 PR 2.
**Predecessor:** [`2026-08-29-wire-type-generation-plumbing.md`](2026-08-29-wire-type-generation-plumbing.md) (PR 1, merged as `3fe84d1`, pull request #69).

---

## Findings this plan was measured against, before it was written

All five were produced at `3fe84d1` by adding the derives, generating, reading the output, and
reverting. They are stated here because three of them would have changed the plan and one of them
**corrects the design**.

**1. `#[serde(skip)]` is honoured — there is no fifth fidelity class in this crate.** `ts-rs` 10's
`serde-compat` is a default feature and the manifest takes default features, so
`LambdaState.redex` — `#[cfg_attr(feature = "serde", serde(skip))]` — does not appear in the
generated `LambdaState.ts` at all. Had it appeared, `Path` and `Dir` would have needed derives of
their own and the wire would have gained a field it does not carry. Design §14 question 2 is
answered for `redextape-core` by this, and Task 1 Step 8 re-establishes it rather than trusting this
paragraph.

**2. Both `u64` step fields generate `bigint`, exactly as §6 predicts.** `LambdaState.step` and
`TmState.step`. No other field in the eleven does.

**3. `#[ts(type = "Array<Move>")]` — the form §6 prescribes — GENERATES A FILE THAT CANNOT
TYPECHECK.** It writes `moves: Array<Move>` into `RuleView.ts` and emits **no import for `Move`**,
because `type` overrides the rendered text without registering a dependency. Nothing in this crate
would notice: `web/bindings/RuleView.ts` enters the TypeScript program only once `types.ts` imports
it, which is Task 4, three tasks after the attribute is written.

**4. `#[ts(as = "Vec<Move>")]` is the form that works**, and it is what this plan uses. It renders
the same `Array<Move>` and emits `import type { Move } from "./Move";`, because `as` routes through
another Rust type's `TS` impl and so records the dependency. Task 1 walks both forms in order, so
the correction lands as a demonstration rather than as a claim.

**5. Nothing else in the eleven disagrees with the hand-written file.** `Symbol` is `char` and
generates `string`; `StateId` and `NodeId` are `u32` and generate `number`; `TmState.rule` is
`Option<usize>` and generates `number | null`; `Vec<(Span, TokenClass)>` generates
`Array<[Span, TokenClass]>`, which is what `Classified` says; `Owner` generates
`{ "Exact": number } | { "Within": number } | "None"`, the same three shapes the hand-written line
carries in a different order, which TypeScript does not distinguish.

**And the end state was typechecked before this plan proposed it.** With all eleven generated and
`web/src/types.ts` rewritten as a barrel over them, `pnpm exec tsc --noEmit` exits 0 against the
44 importers unchanged. That is evidence the swap is possible, not evidence any particular task is
done; every task below re-runs its own gates.

---

## Global Constraints

- **No wire shape changes.** No Rust type's fields or variants change; no `#[wasm_bindgen]` export
  changes what it answers. Where generated output disagrees with `types.ts`, the generator is wrong
  and gets an override — it does not get to redefine the wire.
- **`ts` is default-off on both crates.** Nothing in this PR touches the feature graph.
- **`redextape-core` must build for `wasm32-unknown-unknown`.** Gated by `scripts/check-all.sh`'s
  `wasm` rows, not asserted.
- **No `file:line` citations in tracked source.** `scripts/check-citations.sh` rejects them; cite the
  symbol. `docs/` is exempt, so this plan may carry them and no source file may.
- **Pre-commit runs `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --check`,
  `biome ci --error-on-warnings` and `pnpm run typecheck` on every commit.** A commit split that
  leaves the tree non-compiling or non-typechecking is infeasible; collapse commits rather than pass
  `--no-verify`.
- **A `tests/` target's free helpers are outside `clippy.toml`'s in-test exemptions.** Any new file
  under `crates/*/tests/` that unwraps outside a `#[test]` fn carries the file-level `#![allow(...)]`
  the existing targets carry.
- **No commit attribution.** No `Co-Authored-By`, no `Generated with`.
- **The `$PWD` hazard this bullet used to warn about is closed, by `scripts/build-web-bindings.sh`
  itself.** `pnpm run build:bindings` now calls that script, which `cd`s to `$(dirname "$0")/..` — the
  repo root — before doing anything else, so `TS_RS_EXPORT_DIR` and every path derived from it resolve
  against the repo root regardless of the caller's working directory. Verified directly: `pnpm run
  build:bindings` from `web/`, and `bash scripts/build-web-bindings.sh` invoked with `/tmp` as the
  caller's `$PWD`, both write to `<root>/web/bindings/` and nowhere else. Task 1 Step 9's bare
  `cargo nextest run -p redextape-core --features ts` row (below) does not go through this script at
  all — that command has always needed `TS_RS_EXPORT_DIR` set explicitly, `$PWD`-relative or not, and
  still does; this bullet is only about `pnpm run build:bindings`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `crates/redextape-core/src/diagnostic.rs` | `Severity`, `Diagnostic` gain the derive | 1 |
| `crates/redextape-core/src/analysis.rs` | `TokenClass` gains the derive | 1 |
| `crates/redextape-core/src/lambda/syntax.rs` | `Cut` gains the derive | 1 |
| `crates/redextape-core/src/lambda/reduce.rs` | `Owner` gains the derive | 1 |
| `crates/redextape-core/src/tm/machine.rs` | `Move` gains the derive (it has no serde derive to sit under) | 1 |
| `crates/redextape-core/src/viewmodel.rs` | five derives, two `number` overrides, the `Vec<Move>` override | 1, 3 |
| `crates/redextape-core/tests/ts_bindings.rs` | the no-`bigint` gate and its coverage assertion | 2 |
| `web/src/types.ts` | eleven declarations become re-exports; header restated | 4 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | entry before the PR opens | 5 |

**The eleven, and why they are eleven.** Design §1.1's Class A for this crate: `Cut`, `Diagnostic`,
`LambdaState`, `Owner`, `RuleView`, `Severity`, `StateView`, `TmProgram`, `TmState`, `TokenClass` —
ten carrying a serde derive — plus `Move`, which carries none and never crosses the wire, and is
generated solely as the override target for `RuleView.moves`. `Span` already generates. `Classified`
is `pub type Classified = Vec<(Span, TokenClass)>`, an alias with no derive site, and stays
hand-written permanently.

---

## Task 1: The eleven types generate, and every generated file is read against the one it replaces

**Files:**
- Modify: `crates/redextape-core/src/diagnostic.rs`, `crates/redextape-core/src/analysis.rs`,
  `crates/redextape-core/src/lambda/syntax.rs`, `crates/redextape-core/src/lambda/reduce.rs`,
  `crates/redextape-core/src/tm/machine.rs`, `crates/redextape-core/src/viewmodel.rs`

**Interfaces:**
- Produces: `web/bindings/{Cut,Diagnostic,LambdaState,Move,Owner,RuleView,Severity,StateView,TmProgram,TmState,TokenClass}.ts`,
  which Task 4 re-exports and Task 2's test asserts over.

- [ ] **Step 1: Record the baseline — generation currently produces exactly one file**

From `web/`:

```bash
rm -rf bindings && pnpm run build:bindings >/dev/null && find bindings -type f
```

Expected: `bindings/Span.ts`, and nothing else. If more appears, stop: someone has landed part of
this task already and the rest of it is being applied to a tree it was not measured against.

- [ ] **Step 2: Add the derive to the eleven types**

The attribute is identical everywhere and goes immediately above the `pub struct`/`pub enum` line,
below any existing `#[derive]`/`#[cfg_attr]`:

```rust
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
```

Apply it to, in file order:

| file | items |
|---|---|
| `crates/redextape-core/src/diagnostic.rs` | `pub enum Severity`, `pub struct Diagnostic` |
| `crates/redextape-core/src/analysis.rs` | `pub enum TokenClass` |
| `crates/redextape-core/src/lambda/syntax.rs` | `pub enum Cut` |
| `crates/redextape-core/src/lambda/reduce.rs` | `pub enum Owner` |
| `crates/redextape-core/src/tm/machine.rs` | `pub enum Move` |
| `crates/redextape-core/src/viewmodel.rs` | `pub struct LambdaState`, `pub struct StateView`, `pub struct RuleView`, `pub struct TmProgram`, `pub struct TmState` |

`Move` is the one that does not sit under a `#[cfg_attr(feature = "serde", ...)]` line, because it
has no serde derive — it goes directly under `#[derive(Clone, Copy, Debug, PartialEq, Eq)]`. That
asymmetry is the point design §1.1 draws: `Move` is in Class A without being serialized.

Verify the count before generating:

```bash
grep -rc 'ts_rs::TS' crates/redextape-core/src | grep -v ':0$'
```

Expected: seven files, summing to twelve — `span.rs:1` (PR 1's), `analysis.rs:1`, `diagnostic.rs:2`,
`lambda/reduce.rs:1`, `lambda/syntax.rs:1`, `tm/machine.rs:1`, `viewmodel.rs:5`.

- [ ] **Step 3: Generate, and read every file against the declaration it will replace**

From `web/`:

```bash
rm -rf bindings && pnpm run build:bindings >/dev/null && find bindings -type f | sort
```

Expected: twelve files. Then read each one against its `web/src/types.ts` counterpart. Stripped of
the generated header and the relocated doc comments, the output measured at `3fe84d1` was:

```ts
export type Severity = "Error" | "Warning";
export type Diagnostic = { span: Span, severity: Severity, message: string, };
export type TokenClass = "Ident" | "Nat" | "Bool" | "Keyword" | "Operator" | "Punct" | "Comment" | "Binder" | "Mnemonic" | "Register" | "Label" | "StateName" | "TapeSymbol" | "Move";
export type Cut = "Bytes" | "Depth";
export type Owner = { "Exact": number } | { "Within": number } | "None";
export type Move = "L" | "R" | "S";
export type StateView = { name: string, accept: boolean, rules: Array<RuleView>, };
export type TmProgram = { states: Array<StateView>, alphabet: Array<string>, tapes: number, width: number, start: number, };
export type RuleView = { read: Array<string | null>, write: Array<string | null>, moves: Array<string>, next: number, };
export type LambdaState = { text: string, spans: Array<[Span, TokenClass]>, cut: Cut | null, step: bigint, redex_span: Span | null, owner: Owner, };
export type TmState = { state: number, step: bigint, heads: Array<number>, window_start: Array<number>, window: Array<Array<string>>, source_node: number | null, rule: number | null, };
```

Nine of the eleven already agree with `types.ts` in every field. The two that do not are the next
two steps. **Any disagreement beyond `step` and `moves` is a fifth fidelity class and stops this
task** — record it, and raise it against design §6 before writing an override for it.

- [ ] **Step 4: Confirm the `bigint` class is exactly the two fields §6 names**

```bash
grep -l bigint bindings/*.ts
```

Expected: `bindings/LambdaState.ts` and `bindings/TmState.ts`, and no others. `TmStatus.total_steps`
is the third member of this class and lives in `redextape-wasm`; it is PR 3's, and its absence here
is why this task's gate (Task 2) covers only this crate.

- [ ] **Step 5: Override both `step` fields to `number`**

In `crates/redextape-core/src/viewmodel.rs`, on `LambdaState` and on `TmState` — both fields are
spelled `pub step: u64,`:

```rust
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub step: u64,
```

Regenerate and confirm the class is empty:

```bash
rm -rf bindings && pnpm run build:bindings >/dev/null && grep -l bigint bindings/*.ts
```

Expected: no output, exit 1 from grep. `serde_wasm_bindgen` puts a `u64` on the wire as a JS number,
which `crates/redextape-wasm/tests/browser.rs` measures directly; `ts-rs` maps `u64` to `bigint`
unconditionally. Nothing reconciles the two but this attribute.

- [ ] **Step 6: Write the override design §6 prescribes for `moves`, and watch it produce an unusable file**

In `crates/redextape-core/src/viewmodel.rs`, on `RuleView`:

```rust
    #[cfg_attr(feature = "ts", ts(type = "Array<Move>"))]
    pub moves: Vec<String>,
```

Regenerate, then ask whether the name it just used is in scope:

```bash
rm -rf bindings && pnpm run build:bindings >/dev/null && cat bindings/RuleView.ts
```

Expected — the type is right and the file is broken:

```ts
// This file was generated by [ts-rs](https://github.com/Aleph-Alpha/ts-rs). Do not edit this file manually.

export type RuleView = { read: Array<string | null>, write: Array<string | null>, moves: Array<Move>, next: number, };
```

No `import type { Move }`. `ts(type = ...)` substitutes rendered text and registers no dependency, so
the file references a name it never imports. Nothing in the Rust build can see this, and `tsc` cannot
see it either until Task 4 makes `types.ts` import the file.

- [ ] **Step 7: Replace it with the form that carries the dependency**

```rust
    #[cfg_attr(feature = "ts", ts(as = "Vec<Move>"))]
    pub moves: Vec<String>,
```

`viewmodel.rs` already has `Move` in scope from `crate::tm::machine`. Regenerate:

```bash
rm -rf bindings && pnpm run build:bindings >/dev/null && cat bindings/RuleView.ts
```

Expected:

```ts
// This file was generated by [ts-rs](https://github.com/Aleph-Alpha/ts-rs). Do not edit this file manually.
import type { Move } from "./Move";

export type RuleView = { read: Array<string | null>, write: Array<string | null>, moves: Array<Move>, next: number, };
```

**The Rust field stays `Vec<String>`.** Design §6's reasoning is unchanged by the attribute
correction: `viewmodel::move_text` stringifies `Move` deliberately, its own comment records the
decoupling ("kept as an explicit match rather than `Move`'s `Debug` output so the two cannot drift
independently even though today they happen to agree"), and changing the field to `Vec<Move>` would
be wire-identical and would collapse exactly that. The claim the override makes is already pinned by
`move_text_matches_the_text_forms_own_vocabulary` in `viewmodel.rs`, which asserts the three strings
by name.

- [ ] **Step 8: Confirm the skipped field did not cross**

A count of `redex` in the file is not the check — `redex_span` is a real wire field and the doc
comments mention the path by name. Read the declaration, which the field docs wrap across lines:

```bash
grep -v '^ \*' bindings/LambdaState.ts | grep -v '^/\*\*\|^ \*/'
```

Expected: six fields — `text`, `spans`, `cut`, `step`, `redex_span`, `owner` — and **no `redex`**.
`LambdaState.redex` is `Option<Path>` and `serde(skip)`ped; `ts-rs`'s `serde-compat` is a default
feature and honours that. If `redex` appears, `serde-compat` is off and this is the fifth fidelity
class: stop, and take it back to §6 rather than reaching for `#[ts(skip)]`, because the same
question then reopens for every other serde attribute in the crate.

- [ ] **Step 9: Run the three `ts` legs and confirm nothing scattered**

From the repository root:

```bash
cargo clippy -p redextape-core --features ts --all-targets -- -D warnings
TS_RS_EXPORT_DIR="$PWD/web/bindings" cargo nextest run -p redextape-core --features ts
cargo check --target wasm32-unknown-unknown -p redextape-core --lib --features ts
find crates -maxdepth 2 -name bindings -type d
git status --porcelain
```

Expected: the first three exit 0, `find` prints nothing, and `git status` lists only the six Rust
files this task edits — `web/bindings/` is gitignored.

**The variable on the test row is load-bearing and is not decoration.** `ts-rs` resolves a missing
`TS_RS_EXPORT_DIR` per crate manifest, so a bare `cargo nextest run -p redextape-core --features ts`
runs the `export_bindings_*` tests with no destination and writes
`crates/redextape-core/bindings/` instead. `scripts/check-all.sh` exports the variable for exactly
this reason — PR 1 shipped that row without it, and every gate run scattered a file until the
gitignore and the export were both added. Run the row the way the gate runs it.

- [ ] **Step 10: Commit**

```bash
git add crates/redextape-core/src
git commit -m "feat(ts): generate the eleven core wire types, with the three fidelity overrides"
```

The message body records Step 6: that `ts(type = "Array<Move>")` emits the name without the import,
that `ts(as = "Vec<Move>")` emits both, and that the design says the former.

---

## Task 2: The gate that fails when a fifth `bigint` field appears

**Files:**
- Create: `crates/redextape-core/tests/ts_bindings.rs`

**Interfaces:**
- Consumes: the eleven `TS` impls Task 1 added.
- Produces: `no_generated_type_carries_bigint` and `the_gate_covers_every_exported_type`, run by
  `cargo nextest run -p redextape-core --features ts` — a `scripts/check-all.sh` leg and part of CI's
  `rust` job.

**The code in Step 1 was compiled and run before this plan was written**, extracted verbatim from
this file at `3fe84d1` with Task 1 applied: both tests pass, `cargo clippy -p redextape-core
--features ts --all-targets -- -D warnings` is clean, `cargo fmt --check` reports no diff, and the
Step 3 sabotage fails with the message Step 3 quotes. It was revised once after review, against the
same tree: `the_gate_covers_every_exported_type` compares the exported type NAMES as sets rather than
comparing `generated().len()` against a raw attribute count, because a count is blind to a commit that
removes `ts(export)` from one already-listed type and adds it to a different one — the count stays 12
either way, and `generated()`'s stale entry keeps compiling since `export_to_string()` is a default
trait method that does not require `#[ts(export)]`. And `no_generated_type_carries_bigint` scans only
the lines `without_doc_comments` keeps, because `export_to_string()` reproduces Rust doc comments
verbatim and a doc comment merely discussing `bigint` in prose — `viewmodel::TermNode`'s already does
— would otherwise fail the gate for a documentation reason. Both revisions are demonstrated the same
way as Steps 3 and 5 below: the OLD assertion passes on the counterexample, the NEW one fails on it.

**It was revised a second time, against a Critical a re-review found in that first revision.**
`export` is a bare flag inside the `ts(...)` attribute list and combines with other keys in any order
— `ts(rename = "Foo", export)` carries it exactly as much as `ts(export)` does — so the first
revision's `contains("ts(export)")` substring check silently missed that spelling: the type was never
added to the source-side set, `generated()` was never told to cover it, and nothing panicked. One
ordinary attribute on one new type was enough — no coincident second edit required, unlike the
name-swap the first revision closed. The second revision keyed on the substring `derive(ts_rs::TS)`
instead, and resolved the type name by scanning FORWARD from that derive — past any further attribute
lines and doc-comment lines — to the `pub struct NAME` / `pub enum NAME` line it sits above, panicking
(naming the file and line) at the first line that fits none of those shapes, including running off the
end of the file. Demonstrated the same way again, in Step 5.

**It was revised a third time, against a Critical a re-review found in the second revision — and
against a false claim the second revision's own comments made.** The second revision's doc comments
asserted `derive(ts_rs::TS)` "cannot be spelled another way and still compile." That is false, and the
review compiled two counterexamples: `derive(Default, ts_rs::TS)` on `pub struct Rule` in
`src/tm/machine.rs` carries the derive without the substring `derive(ts_rs::TS)` ever appearing, since
another derive precedes the path in the list; and `#[cfg(feature = "ts")] use ts_rs::TS;` paired with
bare `derive(TS)` carries it with the path `ts_rs::TS` never appearing on the derive line at all, since
the name is imported. Both compile as ordinary Rust, both left `generated()` untouched, and both passed
the second revision's tests silently. The third revision keys on the bare path `ts_rs::TS` — wherever
it sits inside a `derive(...)` list, which closes the first counterexample — and separately panics,
naming the file and line, on any `use ts_rs::` found under `src/`, which refuses the second
counterexample outright rather than letting it compile past the scan unseen. The false completeness
claim is deleted, not softened: the doc comments now say plainly that this is a textual heuristic over
the crate's own sources, not a parse of the language, and name what would still get past it — a
`Cargo.toml` rename of the `ts-rs` dependency, or a macro that expands to the marker at the derive
site — rather than asserting there is nothing left. Demonstrated the same way again, in Step 5.

**Why the test asks the types rather than reading the directory.** `ts-rs` generates one
`export_bindings_*` test per type and cargo runs them in no defined order, so a test that scanned
`web/bindings/` could run before the files existed and pass on an empty directory — the vacuous-gate
shape this repository has on record. `TS::export_to_string()` returns the same bytes the exporter
writes, in-process, with no filesystem and no ordering.

- [ ] **Step 1: Write the test file**

```rust
//! Fidelity gates on the generated TypeScript. Feature-gated whole: without `ts` there are no `TS`
//! impls to ask and this target compiles to nothing.
//!
//! THESE ASK THE TYPES, NOT `web/bindings/`. `ts-rs` emits one `export_bindings_*` test per type and
//! cargo orders tests arbitrarily, so a directory scan can run before generation and pass on an
//! empty directory. `export_to_string` returns what the exporter would write, in this process.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
#![cfg(feature = "ts")]

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use redextape_core::analysis::TokenClass;
use redextape_core::diagnostic::{Diagnostic, Severity};
use redextape_core::lambda::Cut;
use redextape_core::lambda::reduce::Owner;
use redextape_core::span::Span;
use redextape_core::tm::machine::Move;
use redextape_core::viewmodel::{LambdaState, RuleView, StateView, TmProgram, TmState};
use ts_rs::TS;

/// Every type in this crate carrying `#[ts(export)]`, paired with the file it generates.
fn generated() -> Vec<(&'static str, String)> {
    vec![
        ("Cut", Cut::export_to_string().unwrap()),
        ("Diagnostic", Diagnostic::export_to_string().unwrap()),
        ("LambdaState", LambdaState::export_to_string().unwrap()),
        ("Move", Move::export_to_string().unwrap()),
        ("Owner", Owner::export_to_string().unwrap()),
        ("RuleView", RuleView::export_to_string().unwrap()),
        ("Severity", Severity::export_to_string().unwrap()),
        ("Span", Span::export_to_string().unwrap()),
        ("StateView", StateView::export_to_string().unwrap()),
        ("TmProgram", TmProgram::export_to_string().unwrap()),
        ("TmState", TmState::export_to_string().unwrap()),
        ("TokenClass", TokenClass::export_to_string().unwrap()),
    ]
}

/// The one literal line every exported type in this crate must carry, verbatim, to be recognized as
/// exported: a feature-gated derive of `ts_rs::TS` with the crate path spelled out in full, paired
/// with the export flag, both inside one `cfg_attr`. `ts_deriving_type_names_in_crate` treats ANY
/// OTHER line that mentions the bytes `ts_rs` as a failure — see that function's doc for why that is a
/// whitelist and not one more banned spelling.
const CANONICAL_TS_DERIVE: &str = "#[cfg_attr(feature = \"ts\", derive(ts_rs::TS), ts(export))]";

/// The name of every type in this crate carrying [`CANONICAL_TS_DERIVE`], resolved by scanning
/// FORWARD from that line, past any further attribute lines and doc-comment lines, to the
/// `pub struct NAME` / `pub enum NAME` line it sits above.
///
/// THIS IS A TEXTUAL CHECK OVER THE CRATE'S OWN SOURCES, NOT A PARSE OF THE LANGUAGE — stated plainly
/// because four review rounds each compiled a counterexample past the previous wording of this claim.
///
/// **THIS IS A WHITELIST OVER EVERY MENTION OF `ts_rs`, NOT A BLACKLIST OF SPELLINGS TO REFUSE — AND
/// THAT INVERSION IS THE FIX FOR ALL FOUR PRIOR ROUNDS AT ONCE, NOT A FIFTH WIDENING.** Every earlier
/// version of this function asked "does this line avoid the spellings I have banned so far", and each
/// round's answer was a new spelling that had not been banned yet: keying on the substring
/// `ts(export)` missed `ts(rename = "Foo", export)`; keying on `derive(ts_rs::TS)` missed
/// `derive(Default, ts_rs::TS)`; banning `use ts_rs::` (colon-qualified) missed `use ts_rs::TS;` then
/// bare `derive(TS)`, which carries the derive with the path `ts_rs::TS` never appearing on that line
/// at all; and banning that still missed `use ts_rs as tsrs;` then `derive(tsrs::TS)` — a crate alias,
/// which puts `tsrs::TS` on the derive line, not `ts_rs::TS`, so a check for that path never even
/// looked at the line that mattered. Four rounds, four spellings, because a blacklist can only ever
/// enumerate the spellings someone has already thought of, and there is always one more — this
/// function's own history is the proof.
///
/// So this asks the opposite question. Every line in this crate's own `.rs` files — every file at or
/// below `CARGO_MANIFEST_DIR`, `target/` excluded as build output, which is `src/`, `tests/`,
/// `benches/`, `examples/`, and any loose file sitting beside `Cargo.toml`, not `src/` alone — that
/// contains the literal bytes `ts_rs` — checked first, before any of the reasoning below runs, so the
/// check is over the BYTES the crate name itself must appear as, not over any one shape a derive or
/// import could take — must equal [`CANONICAL_TS_DERIVE`] EXACTLY, or the scan panics. `use ts_rs;`,
/// `use ::ts_rs;`, `use ts_rs as tsrs;`, `derive(Default, ts_rs::TS)`, and
/// every spelling nobody has thought of yet all share the one property this scan actually tests for:
/// none of them IS the canonical line, byte for byte. Closing the ALIAS-AND-IMPORT CLASS this way — by
/// asking every mention of the crate name to be one exact line, rather than trying to enumerate what it
/// must not be — is what stops a review round from finding one more spelling INSIDE A FILE THIS SCAN
/// ALREADY READS. It says nothing at all about a file this scan never opens — that is a different
/// class of gap, named below rather than conflated with this one.
///
/// **`src/`-ONLY WAS ITSELF ONE MORE GAP OF EXACTLY THIS SHAPE, FOUND BY THE WHOLE-BRANCH REVIEW PAST
/// THE VERSION THAT SCANNED ONLY `src/`.** `pub use ts_rs::TS;` in `crates/redextape-core/tsalias.rs`
/// — a file directly under `CARGO_MANIFEST_DIR`, never under `src/` — pulled in via
/// `#[path = "../tsalias.rs"] pub mod tsalias;` in `src/lib.rs`, then `derive(crate::tsalias::TS)` on a
/// new type with a `u64` field: the derive line itself carries no `ts_rs` bytes (it names
/// `crate::tsalias::TS`), and the one line that does — `pub use ts_rs::TS;` — sat in a file a
/// `src/`-only scan never read. Both tests in this file passed, and `web/bindings/Sneaky.ts` was
/// really written carrying `bigint`. Widening the walk to the whole crate (below) closes exactly this
/// route: `tsalias.rs` is now a file this scan opens, so its `pub use ts_rs::TS;` line fails the
/// canonical-line check like any other non-canonical mention. The same gap covered a derive placed
/// directly in `tests/` or `benches/`, not routed through `src/` at all.
///
/// WHAT THIS WHITELIST ACTUALLY GUARANTEES, AND WHAT REMAINS OUTSIDE IT, NAMED RATHER THAN DENIED. It
/// guarantees that every line in this crate's own `.rs` files mentioning `ts_rs` is the one canonical
/// derive line, spelled exactly one way — so the whole alias/import class above (any name for the
/// crate or the item other than the literal one this scan matches) cannot compile silently past it,
/// from ANY file this scan reads; a build that tries fails the test binary outright, every time, rather
/// than needing the next spelling named first. It does NOT guarantee no derive can dodge the scan by a
/// route that never writes the bytes `ts_rs` in any `.rs` file this scan opens. Three such routes are
/// named, not denied.
///
/// A `Cargo.toml` rename of the `ts-rs` dependency (a different key in `[dependencies]` with
/// `package = "ts-rs"`, e.g. `bindgen = { package = "ts-rs" }`) routes every derive through a path —
/// `bindgen::TS` — that contains neither `ts_rs` nor the canonical line; this scan reads `.rs` source
/// text and never opens `Cargo.toml`, so such a derive is invisible to it, not refused by it. A macro
/// that expanded to `derive(...ts_rs::TS...)` only at its call site would hide the token from the TEXT
/// this function reads, since nothing here expands macros — the call site itself carries no `ts_rs`
/// bytes.
///
/// **A `#[path = "..."]` THAT RESOLVES OUTSIDE `CARGO_MANIFEST_DIR` pulls in a file this walk never
/// opens, and IS THE THIRD ROUTE, FOUND BY THE WHOLE-BRANCH REVIEW PAST THE VERSION THAT WALKED THE
/// WHOLE CRATE.** The walk starts at `CARGO_MANIFEST_DIR` and reads only what sits at or below it — it
/// has no notion of Rust's module system at all, and does not RESOLVE `#[path]` in either direction: a
/// loose file inside the tree is read because it physically sits there, not because the walk followed
/// anything to find it, and a file outside the tree stays unread for the identical reason, regardless of
/// how many `#[path]` attributes name it. `#[path = "../../tsalias.rs"]` in `src/lib.rs`, resolving to
/// `crates/tsalias.rs` — one directory ABOVE `CARGO_MANIFEST_DIR`, one level further out than the
/// whole-crate walk above already covers — reproduces the prior gap exactly, one level higher. **THIS
/// SCAN IS NOT WIDENED A FIFTH TIME TO CLOSE IT.** Four widenings have each bought one more round before
/// the next `#[path]` moved the boundary again; a fifth walk starting one directory higher is defeated by
/// the same construction moved one directory higher still, forever. The honest boundary is that this
/// walk reads `.rs` files by physical location under one root and does not, and cannot without parsing
/// Rust itself, resolve where a `#[path]` attribute sends the compiler.
///
/// None of the three is closed by this scan; each would need a different mechanism entirely (reading
/// `Cargo.toml`, expanding macros, or resolving `#[path]` the way `rustc` does) to see.
///
/// **The structural alternative, for whoever wants this class actually closed, is `ts-rs`'s own derive
/// macro, not a wider text scan.** `derive(TS)` emits one `export_bindings_*` test per exported type, so
/// `cargo test -p redextape-core --features ts --lib -- --list` reads 12 tests on a clean tree and 13
/// under every construction above (the crate-alias, the `src/`-only gap, and this `#[path]`-outside-the-
/// root gap alike) — that count comes from macro expansion, which sees every derive site `rustc`
/// compiles, not from source text a `#[path]` or a `Cargo.toml` rename can route around. **This gate does
/// not shell out to that count instead, for a reason worth keeping rather than rediscovering: a test
/// binary invoking `cargo test`/`cargo` while it is itself running under `cargo nextest run`/`cargo
/// test` is a build-lock hazard** — cargo holds a lock on the target directory for the duration of a
/// build or test invocation, and a nested invocation launched from inside a running test contends for
/// that same lock, at best serializing this gate behind an unpredictable second build and at worst
/// deadlocking, depending on the invoking harness. The text scan above pays for avoiding that hazard with
/// the four-widenings history recorded above it; the `--list` count would not need widening again, at
/// the cost of introducing exactly the hazard this paragraph names.
///
/// And a doc comment or attribute shape `resolve_item_name` does not recognize is a PANIC, not a pass —
/// loud, but still a shape this heuristic cannot parse the way `rustc` can. What this scan is actually
/// measured against is the sabotage runs recorded against
/// `docs/superpowers/plans/2026-08-30-wire-type-generation-core-types.md`'s Task 2 Step 5 — read that
/// for the counterexamples this construction has been checked against, not this comment's word for it.
///
/// EVERY LINE THIS FUNCTION DOES NOT RECOGNIZE IS A PANIC NAMING THE FILE AND LINE, NEVER A SKIP. A
/// `continue` on an unrecognized line is exactly the defect this replaced — see `resolve_item_name`,
/// which this delegates the forward scan to and which is where that rule is enforced.
fn ts_deriving_type_names_in_crate() -> BTreeSet<String> {
    fn walk(dir: &Path, self_path: &Path, names: &mut BTreeSet<String>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                // `target/` is the one directory under a crate root that is build output rather than
                // source — normally it lives at the workspace root instead, but a `CARGO_TARGET_DIR`
                // override could put one here, and it is large enough that walking into it by accident
                // would be its own kind of bug. Nothing else under a crate root is excluded by
                // directory: `tests/`, `benches/`, `examples/`, and any loose file beside `Cargo.toml`
                // are all Rust source this scan now reads, which is the fix for the gap described
                // above.
                if path.file_name().is_some_and(|n| n == "target") {
                    continue;
                }
                walk(&path, self_path, names);
            } else if path == self_path {
                // THIS FILE, BY ITS OWN PATH — the one file-level exclusion, and it is not a `src/`-
                // shaped carve-out reopening the gap above. `use ts_rs::TS;` at the top of this very
                // file (line 25) is the trait import `export_to_string()` needs, present for a reason
                // that has nothing to do with a derive site: this file is the SCANNER, not a candidate
                // for the sabotage it scans for. Widening the walk to include `tests/` (above) would
                // otherwise make this file fail its own check on its own legitimate import — a false
                // positive, not a caught sabotage. The exclusion is safe precisely because this file
                // declares no `pub struct`/`pub enum` of its own for a derive to attach to; a sabotage
                // that smuggled a real exported type in here would need to add one first, and every
                // other file in the crate — including every other file under `tests/` — is still read.
                //
                // THAT LAST CLAIM IS ENFORCED HERE, NOT MERELY OBSERVED IN THIS COMMENT. A `pub
                // struct`/`pub enum` appended to this very file would be exactly the sabotage described
                // above: the exclusion above hides it from the scan, so a `#[cfg_attr(feature = "ts",
                // derive(ts_rs::TS), ts(export))]` attached to it would generate a real
                // `export_bindings_*` test — running in this same binary, alongside the two gates that
                // cannot see it — with neither gate ever asking about it. Read this file's own source
                // and refuse the silent exclusion the moment that property stops holding, rather than
                // trusting the comment above to stay true.
                let own_src = fs::read_to_string(&path).unwrap();
                assert!(
                    !own_src.lines().any(|line| {
                        let t = line.trim();
                        t.starts_with("pub struct ") || t.starts_with("pub enum ")
                    }),
                    "{} declares a `pub struct`/`pub enum` of its own now, which makes the scanner's \
                     self-exclusion above unsafe: a `ts_rs::TS` derive attached to a type declared HERE \
                     would be invisible to both gates in this binary, exactly the sabotage the exclusion \
                     was written to assume never happens. Move the type out of this file — the scanner —\
                     into an ordinary crate source file, where the walk above reads it like any other.",
                    path.display()
                );
            } else if path.extension().is_some_and(|e| e == "rs") {
                let src = fs::read_to_string(&path).unwrap();
                let lines: Vec<&str> = src.lines().collect();
                for (i, line) in lines.iter().enumerate() {
                    if !line.contains("ts_rs") {
                        continue;
                    }
                    assert!(
                        line.trim() == CANONICAL_TS_DERIVE,
                        "{}:{} mentions `ts_rs` on a line that is not the canonical derive attribute \
                         ({line:?}). This gate treats {CANONICAL_TS_DERIVE:?}, written verbatim at a \
                         type's derive site, as the ONLY line in this crate's own `.rs` files allowed \
                         to mention `ts_rs` — an import (`use ts_rs::TS;` then bare `derive(TS)`), a \
                         crate alias (`use ts_rs as tsrs;` then `derive(tsrs::TS)`), a differently- \
                         shaped derive list, or any other spelling all fail this assertion, because \
                         every one of them would let a derive site avoid ever writing the exact line \
                         this scan looks for — the same way each was found defeating an earlier, \
                         narrower version of this check. Spell the canonical line out exactly, \
                         unmodified, at the derive site. An ordinary ts-rs key this line does not \
                         carry — `rename`, or any other `ts(...)` key — is not banned: put it on a \
                         SECOND `#[cfg_attr(feature = \"ts\", ts(...))]` line below this one, which \
                         this scan never touches because it does not mention `ts_rs`, and which \
                         `resolve_item_name` already skips over as just another attribute line.",
                        path.display(),
                        i + 1
                    );
                    names.insert(resolve_item_name(&path, &lines, i));
                }
            }
        }
    }
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let self_path = crate_root.join("tests").join("ts_bindings.rs");
    let mut names = BTreeSet::new();
    walk(crate_root, &self_path, &mut names);
    names
}

/// From `lines[marker]`, a line containing the literal path `ts_rs::TS`, scan forward over any further
/// attribute lines (`#[...]`) and doc-comment lines (`///...`) to the item they sit above, and return
/// its name. Handles the marker sitting anywhere inside a longer `derive(...)` list
/// (`derive(Default, ts_rs::TS)`), and the derive on its own `cfg_attr` line with `ts(export)` on a
/// separate `cfg_attr` line below it — those intervening attribute lines are skipped, not mistaken for
/// a second marker, because only a line containing `ts_rs::TS` itself triggers a call here.
///
/// PANICS, NAMING `path` AND THE LINE, AT THE FIRST LINE THAT FITS NONE OF: another attribute, a doc
/// comment, or `pub struct NAME` / `pub enum NAME` — including running off the end of the file. A
/// shape this function does not recognize is exactly Finding 1's failure mode one layer down: it must
/// be loud, never a silently skipped line.
fn resolve_item_name(path: &Path, lines: &[&str], marker: usize) -> String {
    let mut i = marker + 1;
    loop {
        let Some(line) = lines.get(i) else {
            panic!(
                "{}:{} carries `ts_rs::TS` but no `pub struct NAME` / `pub enum NAME` line followed \
                 before the file ended. Teach this fixture the new shape.",
                path.display(),
                marker + 1
            );
        };
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with("///") {
            i += 1;
            continue;
        }
        let after_keyword = trimmed.strip_prefix("pub struct ").or_else(|| trimmed.strip_prefix("pub enum "));
        return match after_keyword {
            Some(rest) => rest
                .split(|c: char| c.is_whitespace() || c == '{' || c == '<' || c == '(')
                .next()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| {
                    panic!(
                        "{}:{} carries `ts_rs::TS` but line {} has no type name after `pub \
                         struct`/`pub enum`: {line:?}",
                        path.display(),
                        marker + 1,
                        i + 1
                    )
                })
                .to_string(),
            None => panic!(
                "{}:{} carries `ts_rs::TS` but line {} is neither another attribute, a doc comment, \
                 nor `pub struct NAME` / `pub enum NAME`: {line:?}. Teach this fixture the new shape.",
                path.display(),
                marker + 1,
                i + 1
            ),
        };
    }
}

/// `ts` with every JSDoc block `export_to_string` copied verbatim from a Rust doc comment removed, so
/// a scan over the result asks about the generated declaration and not about prose a doc comment
/// happens to contain. `ts-rs` (without the `format` feature, which this crate does not enable)
/// always opens a block on a line that is exactly `/**`, closes it on a line that is exactly ` */`,
/// and writes every line between as ` * ...` or ` *` — verified against this crate's own generated
/// output, which already carries a doc comment on `LambdaState` — so matching on those three exact
/// forms is precise, not a prefix heuristic that could also eat a declaration line.
fn without_doc_comments(ts: &str) -> String {
    let mut kept = String::new();
    let mut in_doc_comment = false;
    for line in ts.lines() {
        let trimmed = line.trim();
        if !in_doc_comment && trimmed == "/**" {
            in_doc_comment = true;
            continue;
        }
        if in_doc_comment {
            if trimmed == "*/" {
                in_doc_comment = false;
            }
            continue;
        }
        kept.push_str(line);
        kept.push('\n');
    }
    kept
}

/// No generated type may carry `bigint`.
///
/// THE DEFAULT IS WRONG SILENTLY AND ONLY THE BROWSER TIER COULD OTHERWISE CATCH IT. `ts-rs` maps
/// `u64` to `bigint` unconditionally; `serde_wasm_bindgen` puts a `u64` on the wire as a JS number,
/// which `redextape-wasm`'s browser tests measure directly. A field of that class added without the
/// `#[ts(type = "number")]` override generates TypeScript that typechecks, ships, and is wrong at
/// runtime. This fails at the commit instead.
///
/// THE SCAN SKIPS JSDOC. `export_to_string` reproduces Rust doc comments verbatim, so a doc comment
/// that merely discusses `bigint` in prose — as `viewmodel::TermNode`'s already does, for a type this
/// gate does not cover — would otherwise fail this test for a documentation reason having nothing to
/// do with the generated type. `without_doc_comments` removes exactly the JSDoc ts-rs emits before the
/// scan runs.
#[test]
fn no_generated_type_carries_bigint() {
    for (name, ts) in generated() {
        assert!(
            !without_doc_comments(&ts).contains("bigint"),
            "{name} generates `bigint`. A `u64`/`i64` field crosses this boundary as a JS number, so \
             it needs `#[cfg_attr(feature = \"ts\", ts(type = \"number\"))]`. Generated:\n{ts}"
        );
    }
}

/// The list above covers every type in this crate that derives `ts_rs::TS` — by name, not merely by
/// count, and not by trusting one literal spelling of the attribute that carries it.
///
/// WITHOUT THIS, THE GATE ABOVE IS ONLY AS COMPLETE AS SOMEONE'S MEMORY. A type added with the derive
/// and not added to `generated()` would be unwatched, and the failure would be silence.
///
/// A COUNT IS NOT ENOUGH TO CATCH THAT. A commit that removes the derive from an already-listed type
/// and adds it to a different type leaves the COUNT unchanged while `generated()`'s stale entry keeps
/// compiling — `export_to_string` is a default trait method and does not require `#[ts(export)]` — so
/// the newly-attributed type's `bigint` fidelity is never checked and the test stays green. Comparing
/// the NAMES as sets catches both directions: a name present in the sources but not in `generated()`,
/// and a name present in `generated()` but no longer in the sources.
///
/// NOR IS TEXT-MATCHING ONE SPELLING OF THE ATTRIBUTE ENOUGH — FOUR REVIEW ROUNDS EACH COMPILED A
/// COUNTEREXAMPLE PAST THE PREVIOUS WORDING, EACH TIME BY FINDING ONE MORE SPELLING A BLACKLIST HAD NOT
/// NAMED YET. `ts(rename = "Foo", export)` carried the export flag without the substring `ts(export)`.
/// `derive(Default, ts_rs::TS)` carried the derive without the substring `derive(ts_rs::TS)`. `use
/// ts_rs::TS;` followed by bare `derive(TS)` carried it without the path `ts_rs::TS` appearing on the
/// derive line at all. And `use ts_rs as tsrs;` followed by `derive(tsrs::TS)` carried it under an
/// aliased crate name — the fourth round, found by the whole-branch review with `web/bindings/Rule.ts`
/// really written while both tests here stayed green. A fifth round found the scan itself scoped to
/// `src/` only, missing a derive routed through a file elsewhere in the crate — see
/// `ts_deriving_type_names_in_crate`'s doc for that construction. `ts_deriving_type_names_in_crate`
/// does not try to name a sixth banned spelling: it WHITELISTS the one canonical derive line and fails
/// on any OTHER line that so much as mentions `ts_rs`, so every spelling above — and every one nobody
/// has thought of yet — fails the same assertion, for the same reason, rather than needing its own ban
/// added after the fact. See that function's own doc for what this construction actually guarantees,
/// and what remains outside it, named rather than denied.
#[test]
fn the_gate_covers_every_exported_type() {
    let in_src = ts_deriving_type_names_in_crate();
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

- [ ] **Step 2: Run it**

```bash
cargo nextest run -p redextape-core --features ts -E 'binary(ts_bindings)'
```

Expected: `2 tests run: 2 passed`, naming both tests.

**The filter is `-E 'binary(...)'` and a bare `ts_bindings` will not do.** nextest matches a bare
positional filter against TEST names, not binary names, so
`cargo nextest run -p redextape-core --features ts ts_bindings` selects nothing and reports
`0 tests run: 0 passed, 981 skipped` — a command that looks like it ran this file's tests and ran
none of them. It exits non-zero with `error: no tests to run`, which is the only reason that is a
nuisance rather than a vacuous gate.

A passing new test is not yet evidence of anything; Steps 3 and 5 are.

- [ ] **Step 3: Sabotage the override and watch the gate fire**

Remove `#[cfg_attr(feature = "ts", ts(type = "number"))]` from `LambdaState.step` in
`crates/redextape-core/src/viewmodel.rs`, then:

```bash
cargo nextest run -p redextape-core --features ts -E 'binary(ts_bindings)'
```

Expected: `no_generated_type_carries_bigint` FAILS. Measured, with the override removed:

```
FAIL [ 0.003s] (1/2) redextape-core::ts_bindings no_generated_type_carries_bigint
LambdaState generates `bigint`. A `u64`/`i64` field crosses this boundary as a JS number, so it
needs `#[cfg_attr(feature = "ts", ts(type = "number"))]`. Generated:
export type LambdaState = { text: string, spans: Array<[Span, TokenClass]>, cut: Cut | null, step: bigint,
```

Copy what YOUR run prints into the commit message — the run is the evidence, not this plan's record
of an earlier one.

- [ ] **Step 4: Restore the override and confirm green**

Put the attribute back, then re-run the command from Step 3. Expected: `2 passed`.

- [ ] **Step 5: Sabotage the coverage assertion too**

Delete the `("Move", Move::export_to_string().unwrap()),` line from `generated()`, then re-run.
Expected: `the_gate_covers_every_exported_type` FAILS, naming `Move` as missing from `generated()` and
nothing as stale. Measured:

```
thread 'the_gate_covers_every_exported_type' (2669360) panicked at crates/redextape-core/tests/ts_bindings.rs:385:5:
`generated()` and this crate's `ts_rs::TS` derive sites disagree. Carry the derive but are
missing from `generated()`: ["Move"]. Listed in `generated()` but no longer carry the derive: [].
Add the new type to `generated()`, or remove the stale entry — or, if the derive was written in
some other form, make the two agree.
```

Restore the line and re-run to green. **Both assertions are sabotaged because they fail for different
reasons and a sabotage that does not fire is the finding** — a coverage assertion that cannot fail
would make the `bigint` gate look total while being a list.

**Every sabotage below that targets a dummy type uses `crates/redextape-core/src/span.rs`, never
`crates/redextape-core/src/tm/machine.rs`.** `tm/machine.rs` already declares a real `pub struct Rule`
(the delta-rule type, with `read`/`write`/`moves`/`next` fields) — a second `pub struct Rule` there is
`E0428`, "the name `Rule` is defined multiple times," before any of this test's own assertions get a
chance to run. `span.rs` has no such name in it.

**A second sabotage, run against `generated()`'s own construction rather than against a scan of
`src/`.** `generated()` calls `Type::export_to_string()` on all twelve names directly — it is a literal
list, not a loop over anything — so removing the derive from an already-listed type (say, `Diagnostic`
in `crates/redextape-core/src/diagnostic.rs`) does not reach either test in this file at all. It fails
the CRATE'S OWN COMPILE, before `cargo test` produces a binary to run:

```
error[E0599]: the associated function or constant `export_to_string` exists for struct `Diagnostic`, but its trait bounds were not satisfied
  --> crates/redextape-core/tests/ts_bindings.rs:31:36
   |
31 |         ("Diagnostic", Diagnostic::export_to_string().unwrap()),
   |                                    ^^^^^^^^^^^^^^^^ associated function or constant cannot be called on `Diagnostic` due to unsatisfied trait bounds
```

That is a stronger property than the plan originally claimed for this construction, not a weaker one:
"move the derive off an already-listed type and nothing notices" cannot happen silently, or even reach
a test assertion, for any of the twelve — `generated()`'s own shape rules it out. Restore
`diagnostic.rs` afterward.

**The error class above is a property of `Diagnostic` specifically, not of every type in the twelve, and
this transcript's choice is load-bearing.** `Diagnostic` is not embedded as a field inside any other
`ts_rs::TS`-deriving type, so `rustc` finds the missing `impl TS for Diagnostic` only where the test file
calls `Diagnostic::export_to_string()` — `E0599`, at the call site quoted above. `Cut` is different: it
sits inside `LambdaState.cut: Option<Cut>`, and `LambdaState` itself derives `TS`, so removing `Cut`'s
derive instead surfaces as `E0277`, "the trait bound `Cut: TS` is not satisfied," at
`crates/redextape-core/src/viewmodel.rs:69:14` — inside the LIBRARY'S OWN compile, before the test crate
is even reached, rather than at a test-file call site:

```
error[E0277]: the trait bound `Cut: TS` is not satisfied
   --> crates/redextape-core/src/viewmodel.rs:69:14
    |
 69 |     pub cut: Option<Cut>,
    |              ^^^^^^^^^^^ unsatisfied trait bound
```

Both are compile failures neither test in this file ever runs to see, so the property Step 5 relies on —
"removing the derive from an already-listed type fails the crate's own compile, not a test assertion" —
holds either way; only the diagnostic code and its location move. Measured against both: `Diagnostic`
(not embedded) confirmed `E0599` above; `Cut` (embedded in `LambdaState`) confirmed `E0277` in
`viewmodel.rs`. Restore whichever was sabotaged afterward.

**A third sabotage — the Critical a re-review found in the second revision, above.** Keying detection
on `contains("ts(export)")` (the shape the second revision still used) was defeatable: `export` is a
bare flag inside the `ts(...)` list and combines with other keys in any order, so
`#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(rename = "Rule", export))]` above a new
`pub struct Rule` in `span.rs` — `generated()` left untouched — carried the flag exactly as much as
plain `ts(export)` does, but the literal substring never appeared. That version of the test PASSED on
this tree, silently missing a real exported type with one ordinary attribute. **The shipped gate no
longer asks whether this ONE line matches ONE banned substring; it asks whether every line in this
crate's own `.rs` files that mentions `ts_rs` is the canonical derive line, byte for byte** — so this
spelling now fails that whitelist directly, inside `ts_deriving_type_names_in_crate`, before
`the_gate_covers_every_exported_type` ever runs:

```
thread 'the_gate_covers_every_exported_type' (2675165) panicked at crates/redextape-core/tests/ts_bindings.rs:213:21:
/home/davey/projects/redextape/crates/redextape-core/src/span.rs:27 mentions `ts_rs` on a line
that is not the canonical derive attribute ("#[cfg_attr(feature = \"ts\", derive(ts_rs::TS),
ts(rename = \"Rule\", export))]"). This gate treats "#[cfg_attr(feature = \"ts\",
derive(ts_rs::TS), ts(export))]", written verbatim at a type's derive site, as the ONLY line in
this crate's own `.rs` files allowed to mention `ts_rs` — an import (`use ts_rs::TS;` then bare
`derive(TS)`), a crate alias (`use ts_rs as tsrs;` then `derive(tsrs::TS)`), a differently-
shaped derive list, or any other spelling all fail this assertion, because every one of them
would let a derive site avoid ever writing the exact line this scan looks for — the same way each
was found defeating an earlier, narrower version of this check. Spell the canonical line out
exactly, unmodified, at the derive site. An ordinary ts-rs key this line does not carry —
`rename`, or any other `ts(...)` key — is not banned: put it on a SECOND `#[cfg_attr(feature =
"ts", ts(...))]` line below this one, which this scan never touches because it does not mention
`ts_rs`, and which `resolve_item_name` already skips over as just another attribute line.
```

Restore `span.rs` afterward. (The fourth, fifth and sixth sabotages below panic with this same
explanatory text, differing only in the quoted line, its file, and its line number — shown there once
more in full rather than elided, since a "Measured:" transcript is a claim about literal output.)

**A fourth sabotage — the first of two counterexamples a re-review compiled against the third
revision's own false claim that `derive(ts_rs::TS)` "cannot be spelled another way and still
compile."** `#[cfg_attr(feature = "ts", derive(Default, ts_rs::TS), ts(export))]` above a new
`pub struct Rule` in `span.rs` — `generated()` left untouched. `Default` precedes `ts_rs::TS` in the
derive list, so the substring `derive(ts_rs::TS)` never appears; that version of the test PASSED on
this tree. **This is now caught the same way as the third sabotage, not by a distinct mechanism**: the
line is not byte-for-byte the canonical one, so the whitelist refuses it, naming `span.rs` and the
line, with `"#[cfg_attr(feature = \"ts\", derive(Default, ts_rs::TS), ts(export))]"` quoted as the
offending text. Restore `span.rs` afterward.

**A fifth sabotage — the second counterexample against that same false claim.** In `span.rs`, add
`#[cfg(feature = "ts")]` / `use ts_rs::TS;` near the top of the file, then
`#[cfg_attr(feature = "ts", derive(TS), ts(export))]` above a new `pub struct Rule`  — `generated()`
left untouched. The path `ts_rs::TS` never appears on the DERIVE line at all, only the bare name `TS`
(imported); the SECOND revision's test keyed only on that derive line and PASSED on this tree — the
same miss sabotage 4 shows, from the other of the two counterexamples the third revision closes at
once. The
`use ts_rs::TS;` line itself is what the shipped whitelist catches — any line in this crate's own
`.rs` files mentioning `ts_rs` must be the canonical line, and an import is not:

```
thread 'the_gate_covers_every_exported_type' (2680830) panicked at crates/redextape-core/tests/ts_bindings.rs:213:21:
/home/davey/projects/redextape/crates/redextape-core/src/span.rs:5 mentions `ts_rs` on a line
that is not the canonical derive attribute ("use ts_rs::TS;"). This gate treats
"#[cfg_attr(feature = \"ts\", derive(ts_rs::TS), ts(export))]", written verbatim at a type's
derive site, as the ONLY line in this crate's own `.rs` files allowed to mention `ts_rs` — an
import (`use ts_rs::TS;` then bare `derive(TS)`), a crate alias (`use ts_rs as tsrs;` then
`derive(tsrs::TS)`), a differently- shaped derive list, or any other spelling all fail this
assertion, because every one of them would let a derive site avoid ever writing the exact line
this scan looks for — the same way each was found defeating an earlier, narrower version of this
check. Spell the canonical line out exactly, unmodified, at the derive site. An ordinary ts-rs
key this line does not carry — `rename`, or any other `ts(...)` key — is not banned: put it on a
SECOND `#[cfg_attr(feature = "ts", ts(...))]` line below this one, which this scan never touches
because it does not mention `ts_rs`, and which `resolve_item_name` already skips over as just
another attribute line.
```

Restore `span.rs` afterward.

**A sixth sabotage — the fourth counterexample, found by the whole-branch review past the third
revision above, and the reason the gate below is a whitelist rather than a fourth widening of a
blacklist.** The third revision's `use ts_rs::` ban (colon-qualified) was itself widened once, by the
whole-branch review, to ban any `use ts_rs` (no colon required) — closing `use ts_rs::TS;` AND
`use ts_rs as tsrs;` alike, since both contain the literal substring `use ts_rs`. But
**`use ::ts_rs as tsrs;` — leading `::`, a crate alias rather than an item import — does not contain
that substring**: `use `, then `::`, then `ts_rs`, with the colons sitting exactly where the ban's
match would need `use ts_rs` to be contiguous. Paired with `derive(tsrs::TS)` above a new
`pub struct Rule`, this compiled, both tests in this file passed, `web/bindings/Rule.ts` was really
written, and `cargo test -p redextape-core --features ts export_bindings` reported 13 passing where
twelve were expected. In `span.rs`: `#[cfg(feature = "ts")]` / `use ::ts_rs as tsrs;` near the top,
then `#[cfg_attr(feature = "ts", derive(tsrs::TS), ts(export))]` above the new `pub struct Rule`. The
shipped gate's whitelist catches the ALIAS IMPORT LINE itself, the same way it catches every other
mention of `ts_rs` that is not the one canonical line — not by naming this fourth spelling, but by no
longer needing to:

```
thread 'the_gate_covers_every_exported_type' (2685885) panicked at crates/redextape-core/tests/ts_bindings.rs:213:21:
/home/davey/projects/redextape/crates/redextape-core/src/span.rs:5 mentions `ts_rs` on a line
that is not the canonical derive attribute ("use ::ts_rs as tsrs;"). This gate treats
"#[cfg_attr(feature = \"ts\", derive(ts_rs::TS), ts(export))]", written verbatim at a type's
derive site, as the ONLY line in this crate's own `.rs` files allowed to mention `ts_rs` — an
import (`use ts_rs::TS;` then bare `derive(TS)`), a crate alias (`use ts_rs as tsrs;` then
`derive(tsrs::TS)`), a differently- shaped derive list, or any other spelling all fail this
assertion, because every one of them would let a derive site avoid ever writing the exact line
this scan looks for — the same way each was found defeating an earlier, narrower version of this
check. Spell the canonical line out exactly, unmodified, at the derive site. An ordinary ts-rs
key this line does not carry — `rename`, or any other `ts(...)` key — is not banned: put it on a
SECOND `#[cfg_attr(feature = "ts", ts(...))]` line below this one, which this scan never touches
because it does not mention `ts_rs`, and which `resolve_item_name` already skips over as just
another attribute line.
```

Restore `span.rs` afterward.

**And the panic path itself is real, not aspirational — though not by the construction an earlier
version of this step used.** Appending a bare line of literal text (a `//` comment mentioning
`ts_rs::TS`, not a real attribute) no longer reaches `resolve_item_name` at all: the shipped whitelist
checks EVERY line mentioning `ts_rs` against the canonical string first, so a comment fails that check
immediately, the same way the third through sixth sabotages above do. And a REAL canonical
attribute cannot dangle at end-of-file the way the earlier construction relied on — `rustc` refuses a
bare `#[cfg_attr(...)]` with no item after it (`error: expected item after attributes`) before this
test binary can even be built, so that specific shape of `resolve_item_name`'s panic is no longer
reachable through a tree that compiles. What IS still reachable, and still needs to be loud rather than
silently skipped: the canonical line sitting above something that is neither another attribute, a doc
comment, nor `pub struct NAME` / `pub enum NAME` — for instance a PRIVATE struct (no `pub`). Append, as
the last item in `span.rs`:

```rust
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
struct Rule {
    x: i32,
}
```

Re-run: `the_gate_covers_every_exported_type` panics naming the file and the line that broke the
pattern, rather than silently skipping it:

```
thread 'the_gate_covers_every_exported_type' (2690882) panicked at crates/redextape-core/tests/ts_bindings.rs:287:21:
/home/davey/projects/redextape/crates/redextape-core/src/span.rs:27 carries `ts_rs::TS` but line
28 is neither another attribute, a doc comment, nor `pub struct NAME` / `pub enum NAME`: "struct
Rule {". Teach this fixture the new shape.
```

Restore `span.rs` afterward.

- [ ] **Step 6: Full clippy, then commit**

```bash
cargo clippy -p redextape-core --features ts --all-targets -- -D warnings
git add crates/redextape-core/tests/ts_bindings.rs
git commit -m "test(ts): fail the build when a generated wire type carries bigint"
```

---

## Task 3: The prose relocates into the Rust declarations

**Files:**
- Modify: `crates/redextape-core/src/viewmodel.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: the doc comments Task 4 deletes from `web/src/types.ts` without losing them.

**This is a merge, not a copy, and most of it is already merged.** Four of the six prose blocks
attached to core types in `types.ts` restate an argument the Rust declaration already makes in more
detail. Relocating those means **verifying the Rust says it and deleting the TypeScript**, which
Task 4 does. Only the blocks below have content with no Rust home.

- [ ] **Step 1: Verify — do not assume — that the four already-covered blocks are covered**

For each pair, read both and confirm every claim the TypeScript makes appears in the Rust:

| `web/src/types.ts` | `crates/redextape-core/src/…` | the claim to look for |
|---|---|---|
| `Owner`'s doc | `lambda/reduce.rs`, `Owner`'s doc | three states not two; `Exact` vs `Within`; 5b's "highlight the entire program"; `None` is common and correct |
| `TmState`'s doc | `viewmodel.rs`, `TmState`'s doc | `heads`/`window_start` are materialized-tape coordinates; `source_node` is honestly `None` for three kinds of state |
| `TmState.rule`'s doc | `viewmodel.rs`, `rule`'s doc | names what happens next, not what produced this frame; `None` at accept/halt/stuck |
| `LambdaState.redex_span`'s doc | `viewmodel.rs`, `redex_span`'s doc | resolved against this frame's own term; covers the contractum; `None` at step 0 or past the cut; the path is `serde(skip)`ped |

Record any claim that is NOT covered and carry it into Step 2 rather than letting Task 4 delete it.
A claim deleted here is not recoverable from the generated file, because the generated file is
whatever Rust says.

- [ ] **Step 2: Give `RuleView` the type doc it does not have**

`RuleView` in `crates/redextape-core/src/viewmodel.rs` carries no doc at all; `types.ts` carries the
only description of it in the tree. Above `#[derive(Clone, Debug, PartialEq, Eq)]`:

```rust
/// One transition, projected for a renderer. `read`/`write` carry one entry PER TAPE and `None` is a
/// wildcard — `RuleSpec` defaults every untouched tape to (wildcard read, unchanged write, `Stay`),
/// which is what lets a gadget name only the tapes it touches.
```

- [ ] **Step 3: Give `RuleView.moves` the field doc that carries the override's argument**

This is where `types.ts`'s `Move` doc goes. The TypeScript said *"A STRING UNION RATHER THAN AN ENUM,
because `RuleView.moves` is `Vec<String>` on the Rust side"* — an argument about this field, written
on a different type because TypeScript had nowhere else to put it. Above `pub moves`, keeping the
`ts(as = ...)` attribute below it:

**The doc comment below must not spell out `ts(as = ...)` or `ts(type = ...)` as literal attribute
syntax.** `export_to_string` copies a Rust doc comment into JSDoc verbatim, and Step 6 asserts the
literal text `ts(as = ` does NOT appear anywhere in the generated `RuleView.ts` — so the two attribute
names have to be named in prose (`as`, `type`) rather than written as the attributes themselves:

```rust
    /// Head moves, one per tape, as `move_text` prints them.
    ///
    /// `Vec<String>` AND GENERATED AS `Array<Move>`, WHICH IS NOT A CONTRADICTION. `TmProgram::of`
    /// stringifies through `move_text`, whose own comment records why that is an explicit match
    /// rather than `Move`'s `Debug`: the text form and this projection must not drift independently
    /// even though today they agree. Changing the field to `Vec<Move>` would be wire-identical —
    /// the variants are literally `L`, `R`, `S` — and would collapse exactly that decoupling, so the
    /// field stays stringly typed and the TypeScript is narrowed by attribute instead.
    ///
    /// THE OVERRIDE SPELLS `as`, NOT `type`, AND THE DIFFERENCE IS NOT COSMETIC. `type` substitutes
    /// rendered text and registers no dependency, so it would generate a `RuleView.ts` that names
    /// `Move` without importing it — a file no `tsc` run in this repository would see until
    /// `web/src/types.ts` imports it. `as` routes through `Vec<Move>`'s own `TS` impl, so the import
    /// is emitted with the name. `move_text_matches_the_text_forms_own_vocabulary` is what pins the
    /// three strings this override claims.
    #[cfg_attr(feature = "ts", ts(as = "Vec<Move>"))]
    pub moves: Vec<String>,
```

- [ ] **Step 4: Give `TmProgram` its type doc**

`TmProgram` has a doc on `start` and none on the type. Above `#[derive(Clone, Debug, PartialEq, Eq)]`:

```rust
/// The machine, projected ONCE per compile and never per step — see the module doc for the
/// measurement behind that split, and `TmProgram::of` for what `width` is doing in the signature.
```

- [ ] **Step 5: Add the consumer-facing paragraph to `redex_span`**

`types.ts` carries one fact the Rust doc does not: what a JavaScript consumer must do with the
number. Design §8 accepts this cost knowingly — Rust documentation carrying TypeScript-audience prose
is what one source of truth costs. Append to `redex_span`'s existing doc, as a final paragraph:

```rust
    /// **BYTES, LIKE EVERY OTHER SPAN ON THIS TYPE.** A consumer indexing into a JS string converts
    /// first — `web/src/spans.ts`'s `byteToIndex`/`byteIndexAt` — and `web/src/lambda-pane.ts`'s
    /// frame view is the one place this crosses into a DOM range.
```

- [ ] **Step 6: Regenerate and confirm the prose crossed**

From `web/`:

```bash
rm -rf bindings && pnpm run build:bindings >/dev/null
grep -c '^ \*' bindings/RuleView.ts bindings/TmProgram.ts bindings/LambdaState.ts
grep -n 'byteToIndex' bindings/LambdaState.ts
grep -n 'ts(as = ' bindings/RuleView.ts
```

Expected: the three files carry JSDoc lines; `byteToIndex` appears in the generated `LambdaState.ts`;
and `ts(as = ` does NOT appear in `RuleView.ts` — the attribute paragraph is Rust-side documentation
about the Rust declaration, and if it reads oddly in a generated `.d.ts`-shaped file, that is a
signal to shorten it, not to delete the argument.

- [ ] **Step 7: Commit**

```bash
cargo clippy -p redextape-core --features ts --all-targets -- -D warnings
git add crates/redextape-core/src/viewmodel.rs
git commit -m "docs(viewmodel): relocate the TypeScript wire prose onto the Rust declarations"
```

---

## Task 4: `web/src/types.ts` stops declaring what Rust declares

**Files:**
- Modify: `web/src/types.ts`

**Interfaces:**
- Consumes: the twelve files in `web/bindings/`.
- Produces: an unchanged public surface — every one of the 44 importers keeps importing `./types`.

- [ ] **Step 1: Confirm the current tree is green, so a later failure is attributable**

From `web/`:

```bash
pnpm run typecheck && pnpm run test
grep -rl "from '\./types'\|from '\.\./types'\|from '\.\./\.\./src/types'" src tests | wc -l
```

Expected: exit 0, and the vitest summary line. Record the test and file counts it prints — Step 6
compares against them — and the importer count, which Step 5 does.

- [ ] **Step 2: Replace the eleven declarations with re-exports**

Delete the hand-written `export type` declarations for `TokenClass`, `Severity`, `Diagnostic`,
`Cut`, `Owner`, `Move`, `LambdaState`, `RuleView`, `StateView`, `TmProgram` and `TmState`, together
with the doc comments Task 3 relocated. Keep `TOKEN_CLASSES`, `Classified`, `ownerNode`,
`decodedText`, `assertTokenClasses`, and the five wasm types (`RunStatus`, `Decoded`,
`LambdaStatus`, `TmStatus`, `TmScratchStatus`) exactly as they are — those are PR 3's.

The import block becomes:

```ts
import type { Owner } from '../bindings/Owner'
import type { Span } from '../bindings/Span'
import type { TokenClass } from '../bindings/TokenClass'

export type { Owner, Span, TokenClass }
export type { Cut } from '../bindings/Cut'
export type { Diagnostic } from '../bindings/Diagnostic'
export type { LambdaState } from '../bindings/LambdaState'
export type { Move } from '../bindings/Move'
export type { RuleView } from '../bindings/RuleView'
export type { Severity } from '../bindings/Severity'
export type { StateView } from '../bindings/StateView'
export type { TmProgram } from '../bindings/TmProgram'
export type { TmState } from '../bindings/TmState'
```

`Owner`, `Span` and `TokenClass` are imported as well as re-exported because this file's own code
uses them: `Classified` is `[Span, TokenClass][]` and `ownerNode` takes an `Owner`. The other eight
are pure pass-through. If biome's import ordering disagrees with the arrangement above, take biome's
— `biome ci --error-on-warnings` is a pre-commit hook and this file has no reason to fight it.

- [ ] **Step 3: Restate the header for the state the file is actually in**

The header's last paragraph currently reads *"`Span` is generated; every other type below is still
declared by hand … Two more PRs move the remaining seventeen."* Both halves become false at this
commit. Replace that paragraph with:

```ts
// THE MIGRATION IS PARTIAL AND THIS COMMENT TRACKS IT. Every type re-exported from `../bindings/`
// above is generated from its Rust declaration. The types still DECLARED below are the ones
// `redextape-wasm` owns; they agree with their Rust counterparts only by someone remembering to,
// and PR 3 is what moves them. `Classified` is not waiting for a PR — it is a structural alias over
// two generated types, with no Rust declaration to derive from, and stays here permanently.
```

**State the property, not a count.** A number written into this paragraph is a number the next PR
has to remember to change, in the same file whose drift this whole slice exists to end — and the
previous version of this paragraph is the example: it said "seventeen" and was wrong about which set
it was counting before it was wrong about the count.

- [ ] **Step 4: Typecheck through the generated files**

From `web/`:

```bash
pnpm run typecheck
```

Expected: exit 0. This is the first run in which `tsc` sees any generated file other than `Span.ts`,
and so the first that could catch Task 1 Step 6's missing import. If it reports
`Cannot find name 'Move'` in `bindings/RuleView.ts`, the `ts(as = ...)` override did not land.

- [ ] **Step 5: Confirm no importer moved**

```bash
grep -rl "from '\./types'\|from '\.\./types'\|from '\.\./\.\./src/types'" src tests | wc -l
git diff --stat -- src tests
```

Expected: the count is unchanged from before this task, and the diff touches `src/types.ts` only.
The barrel exists precisely so this slice does not edit 44 files for no behavioural reason.

- [ ] **Step 6: Run the web tiers, node and browser**

```bash
pnpm run test
pnpm run test:browser
```

Expected: the same file and test counts Step 1 recorded, all passing. The browser tier matters here
beyond habit: `assertTokenClasses` runs in 26 of the 44 browser test files through `main.ts`'s
module-scope `ready`, and it is the only check in the tree that compares `TOKEN_CLASSES` against the
loaded wasm module rather than against a file on disk.

- [ ] **Step 7: Commit**

```bash
git add web/src/types.ts
git commit -m "refactor(web): re-export the core wire types instead of declaring them"
```

---

## Task 5: The roadmap entry and the full gate, before the PR opens

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Run the full local gate and quote its own final line**

```bash
scripts/check-all.sh --no-llvm --no-browser
```

Expected: exit 0. Quote the script's own closing line in the commit rather than calling the run
green — it names the tiers it skipped, and a partial run is not a full gate.

- [ ] **Step 2: Append an entry at the end of the roadmap**

Follow the house shape: an all-caps `####` heading naming what closed and what surprised, the date,
the branch, the commit range, the design and plan links, what shipped, then a VERIFICATION block.

The entry must state, at minimum:

1. That this is PR 2 of 3, and that what it leaves hand-written on the core side is one structural
   alias with no derive site rather than a backlog.
2. **That the design's prescribed override was wrong and how that was found.**
   `#[ts(type = "Array<Move>")]` generates `moves: Array<Move>` with no import for `Move`, and no
   Rust-side gate can see it — `web/bindings/RuleView.ts` enters the TypeScript program only when
   `types.ts` imports it. `#[ts(as = "Vec<Move>")]` emits both. This is the entry's finding.
3. That `#[serde(skip)]` on `LambdaState.redex` is honoured by `ts-rs`'s default `serde-compat`, so
   the skipped path does not cross and no fifth fidelity class exists in this crate — design §14
   question 2, answered for `redextape-core`.
4. That the no-`bigint` gate was shown failing (Task 2 Step 3) and its coverage assertion was shown
   failing (Task 2 Step 5), with the messages both produced.

- [ ] **Step 3: Every VERIFICATION figure names its command and is run against this tree**

Each number in the block is produced by the command printed beside it, run at the commit being
described. Do not carry a figure across commits, and write the value rather than a relationship —
"twelve files" and the command that counts them, never "the most" or "all of them".

Suggested rows, each with its command:

```
12                      generated files            (cd web && rm -rf bindings && pnpm run build:bindings
                                                     >/dev/null && find bindings -type f | wc -l)
12                      ts(export) attributes      grep -rc 'ts(export)' crates/redextape-core/src
                                                     | awk -F: '{n+=$2} END {print n}'
0                       generated files with       (cd web && grep -l bigint bindings/*.ts | wc -l)
                          bigint
<measure it>            types still declared by    grep -c '^export type [A-Za-z]' web/src/types.ts
                          hand in types.ts           (`Classified` plus the five `redextape-wasm`
                                                     owns; name them rather than only counting)
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "docs(roadmap): record PR 2 of the wire-type-generation slice"
```

---

## Before the pull request opens

**Run the whole-branch review, not only the per-task ones.** Green per-task reviews are the condition
for it, not a substitute: on this repository it has found the only Critical three times, most
recently in a file no task in the plan edited. **Do not write the branch summary before it runs** —
the summary written first is the one the review gets read against.

The `docker` job does not run on pull requests and is absent from `gate`'s `needs`. This branch
touches no `Dockerfile`, `.forgejo/` or compose file, so the exemption costs nothing here — but say
so in the roadmap entry rather than leaving it unmentioned, because the previous entry is where that
stopped being free.

---

## Self-review notes

**Spec coverage.** Design §11's PR 2 lists four things: the derives (Task 1), their prose relocated
(Tasks 3 and 4), the fidelity overrides (Task 1), and the no-`bigint` test (Task 2). §6's fourth
override, `TmStatus.total_steps`, is **not** in this PR: `TmStatus` is declared in `redextape-wasm`
and is one of PR 3's five. §11 says "the four fidelity overrides" while §6's table puts one of the
four in the other crate — this plan implements the three that are reachable from core's types and
Task 2's gate covers only this crate for the same reason. That discrepancy is stated here rather
than silently resolved.

**§8's line-count figure is not carried into this plan.** The design estimates 87 lines relocating
across both PRs. Task 3 found that most of core's share is already stated in Rust, so the work is
verification plus four additions rather than a transcription of a measured number of lines. A count
copied from a design into a plan is a figure nobody re-measures, and this file does not need one.

**Type consistency.** `ts(as = "Vec<Move>")` appears in Task 1 Step 7 and again in Task 3 Step 3's
code block, where it sits below the new field doc. The attribute is written once in the file; Task 3
moves the doc above it and must not add a second copy.

**What a reviewer should be hardest on.** Task 3 Step 1 is the step this plan is most likely to lose:
it asks for verification and produces no artifact, so an implementer under time pressure can tick it
without doing it, and the cost lands in Task 4 as prose deleted from `types.ts` that was never in
Rust. If any doubt survives, the check is mechanical — read the deleted block and the Rust doc side
by side in the Task 4 diff.

---

## Post-review corrections (2026-08-30, whole-branch review)

The whole-branch review on `wire-type-core-types` found six findings after every per-task review had
already come back Approved — the standing pattern this repository's own record holds: green per-task
reviews are the condition for that review being worth running, not a reason to skip it. All six are
fixed on the same branch, not deferred. **What actually shipped now disagrees with three things this
plan and its design said would ship, and this section is the record of the disagreement rather than a
silent rewrite of either document.**

1. **Critical — the derivation this branch removed was never replaced with anything, and the doc block
   still claimed it existed.** `web/src/types.ts` used to derive `TokenClass` FROM `TOKEN_CLASSES`;
   this branch replaced that with a re-export of the generated union and left the two independent,
   while the array's doc comment still said the array was the source. Design §5's compile-time pin —
   planned for PR 3 — landed here instead, in `web/src/types.ts` beside `TOKEN_CLASSES`, and the doc
   block was rewritten to describe the mechanism the file now has: the union comes from Rust, the pin
   is what stops the array and the union disagreeing, and `assertTokenClasses` stays because it is the
   only check that compares against the *loaded wasm module* rather than a file on disk. Design §11 is
   corrected in place to say the pin shipped in PR 2, with the reasoning: the branch that generates
   `TokenClass` is the branch that deletes the derivation the pin replaces, so the replacement belongs
   with it rather than one PR later. Demonstrated both directions — deleting `'Binder'` from the array
   and adding a name the Rust enum does not have — each producing its own `TS2344` error naming the
   offending member, with a clean typecheck restored between and after.

2. **Important — `build:bindings` wrote but never pruned, exactly the hazard PR 1's roadmap entry
   deferred to this PR.** `web/package.json`'s `build:bindings` gained a leading `rm -rf bindings` (a
   literal path, no shell variable) so a run produces exactly what the current Rust declares, rather
   than every file any past run ever wrote. Demonstrated by generating a type, removing its export,
   re-running the old script (the orphan survives, `pnpm run build:bindings` still exits 0), then
   re-running the fixed script (the orphan is gone). `pnpm run typecheck` and `pnpm run test` both
   pass afterward (69 files, 676 tests).

3. **Important — a fourth spelling defeated the gate in `crates/redextape-core/tests/ts_bindings.rs`.**
   The gate panicked on `use ts_rs::` under `src/` but not on `use ts_rs as tsrs;` followed by
   `derive(tsrs::TS)` — an aliased crate name never puts the literal path `ts_rs::TS` on the derive
   line, so a type could derive and export for real while both gate tests stayed green. The banned
   substring widened from `use ts_rs::` to `use ts_rs`, closing both the item-import and the
   crate-alias forms by refusing the import outright. The function's own "what would still get past
   it" doc names this as the fourth counterexample a review round compiled, closed rather than merely
   named. Demonstrated: the exact counterexample from the review compiles, both tests pass, and
   `web/bindings/Rule.ts` is really written under the old gate; under the fixed gate the same
   counterexample fails `the_gate_covers_every_exported_type`, naming the file and line; reverted, both
   tests pass again.

4. **Important — six `file:line` citations in the design doc, falsified by this branch's own line
   moves, that `docs/`'s exemption from `scripts/check-citations.sh` let stand unnoticed.** Two in
   §1.1 (`TOKEN_CLASSES`, `assertTokenClasses`), two in §6's override table (`LambdaState.step`,
   `TmState.step`), and two in §6's prose (`move_text`'s comment, and
   `move_text_matches_the_text_forms_own_vocabulary`) — all six re-derived against the tree as this
   pass leaves it, by opening the line rather than by arithmetic, and rewritten to name the symbol
   instead of a line number, so the next edit that moves these lines does not falsify them again. This
   is the same convention `scripts/check-citations.sh` already requires of tracked source; adopting it
   here is a deliberate strengthening of a document that gate does not reach, not a requirement of it.
   `web/src/link.ts:116` and `crates/redextape-wasm/tests/browser.rs:884` were re-verified correct and
   left as line citations, per the finding.

5. **Minor — Task 3 Step 3's code block, followed literally, would have failed Task 3 Step 6.** Step 3
   quoted the literal syntax `` `ts(as = ...)` `` inside a Rust doc comment destined for `RuleView`;
   `export_to_string` copies doc comments verbatim into JSDoc, so that string would have landed in the
   generated `RuleView.ts`, contradicting Step 6's own assertion that it does not appear there. The
   code block now matches what actually shipped in `crates/redextape-core/src/viewmodel.rs`: the two
   attribute names are discussed in prose (`as`, `type`) rather than spelled out as the attributes
   themselves. Re-verified against the current generated `RuleView.ts`: `ts(as = ` does not appear.

6. **Minor — `scripts/check-all.sh`'s `TS_RS_EXPORT_DIR` comment described a hazard PR 1 had already
   partly closed.** It said an unset variable scatters a `bindings/` directory "untracked and outside
   `.gitignore`'s `/web/bindings/` entry" — but PR 1 also added `crates/*/bindings/` to `.gitignore`,
   so the scatter is no longer untracked, only still the wrong copy (not what the web build consumes,
   and silently divergent from `web/bindings/` the moment the two are generated at different times).
   The comment now says that.

None of the six touch any wire shape, any Rust type's fields or variants, or what any `#[wasm_bindgen]`
export answers — the design's scope boundary, stated before anything else in it, held through this
pass as it held through the rest of the branch.

## Post-review corrections, round 2 (2026-08-30, whole-branch review)

The whole-branch review's second pass on `wire-type-core-types` found seven findings after the first
round's six were fixed and reviewed Approved — this branch's own record of what a green per-task
review is a condition for, not a reason to skip. All seven are fixed here, not deferred. The governing
instruction for this round was to fix the CLASS a finding names, not the one instance reported, and to
search for siblings before calling any finding done — round 1 fixed exactly the instances it was
given, and the review immediately found a next instance of the same class in three of the six.

1. **Important — the gate's import ban was a blacklist, and round 1's widening still lost to a fifth
   spelling.** `use ::ts_rs as tsrs;` — a crate alias with a leading `::` — does not contain the literal
   bytes `use ts_rs`, so round 1's widened ban (`!line.contains("use ts_rs")`) let it past: paired with
   `derive(tsrs::TS)`, both tests in `ts_bindings.rs` stayed green while `web/bindings/Rule.ts` was
   really written and `cargo test --features ts export_bindings` reported 13 passing instead of 12.
   Rewritten as a whitelist instead of a fourth widening: every line under
   `crates/redextape-core/src` that mentions `ts_rs` must equal the one canonical derive attribute,
   byte for byte, or the scan panics naming the file, the line, and the canonical form it expected —
   closing the alias-and-import class as a class rather than naming a fifth spelling. Both doc comments
   in `ts_bindings.rs` now say what this whitelist actually guarantees (every mention of `ts_rs` under
   `src/` is the canonical line) and what remains outside it (a `Cargo.toml` dependency rename, macro
   expansion) — the previous wording named a `Cargo.toml` rename and macro expansion but not the alias
   class, which read as though that class were closed when only part of it was. Demonstrated: the
   reviewer's counterexample passing under the pre-fix gate and failing under the whitelist; two
   further spellings (a bare `use ts_rs::TS;` import, and `derive(Default, ts_rs::TS)`) failing under
   the whitelist; the clean tree still passing both tests, `cargo fmt --check` and
   `cargo clippy -p redextape-core --features ts --all-targets -- -D warnings` both clean. Searched:
   `grep -rn "ts_rs" crates/redextape-core/src/` — twelve occurrences, every one the canonical line,
   confirming the whitelist's premise before relying on it.

2. **Important — a seventh stale citation survived the round that "finished" six.** Design §1.1 cited
   `crates/redextape-core/src/analysis.rs:88` for `Classified`; commit `2ce0d16` on this branch
   inserted a derive above `TokenClass` in that file, pushing `Classified` to line 89 — a citation
   round 1's citation pass never found because it converted only the six citations it was handed and
   never searched for a seventh. Fixed the same way as those six: named the file, not the line
   (`Classified` is already named in the surrounding prose, so the file alone is enough). Searched:
   the design doc and the plan with `scripts/check-citations.sh`'s own `CITATION_RE` (run by hand,
   since `docs/` is exempt from that gate), plus every one of the ten non-doc files this branch
   touched. Found three real `file:line` citations total in the design doc — the one above (stale, now
   fixed) and two more, both re-verified correct against the current tree:
   `web/src/link.ts:116` (still the `TOKEN_CLASSES[...]` read in `lambdaSpans`) and
   `crates/redextape-wasm/tests/browser.rs:884` (still `assert_eq!(num(&tm_status, "total_steps"),
   2870.0, ...)`) — a second re-verification of the same two round 1 already checked. None of the
   plan's or the ten source files' apparent `file:N` matches were real citations: the plan's
   `grep -rc 'ts_rs::TS' ...` example output is a file-to-COUNT table, not a line citation, and every
   other match sits inside Step 5's quoted panic transcripts (finding 4, below), which are literal
   terminal output, not navigational prose.

3. **Important — the design still asserted the derivation this branch deleted, and its own footnote
   had gone stale in the same commit that removed the numbers it named.** §1.1's `TOKEN_CLASSES`
   sentence still said `TokenClass` was "derived from" the array — exactly the claim §11's own
   correction (added in the SAME commit, 9707b5f) says is false. Rewritten to describe the pin instead,
   matching §11. The blockquote directly under it opened "Both numbers were `25` and `237`," but round
   1's citation conversion had removed both numbers from the sentence above it in that same commit —
   rewritten as a past-tense note recording what those two citations used to be (`types.ts:25`,
   `types.ts:237`, corrected once already to `types.ts:35`/`types.ts:247` before going stale a second
   time) and why they were replaced with the symbol-named form, rather than deleted outright or left
   naming numbers no longer in the paragraph above it. Also fixed the identical overstated claim in
   design §5 — "It fires at `pnpm typecheck`, which is a pre-commit hook and a CI job" — the same class
   as finding 7 below. Searched: `grep -rn "TokenClass\` derived from\|derived from it" docs/ web/src/
   crates/` for the first half of this finding (clean afterward, and the historical mentions elsewhere
   in the tree are all correctly past-tense); `grep -rn "pre-commit hook and a CI job\|FIRES AT"
   docs/ crates/ web/src/` for the second half, which is what found design §5's sibling of finding 7.

4. **Important — the plan's Task 2 and the shipped gate had diverged again, for a fourth time.** Three
   commits said in their own message that they brought Task 2 Step 1's code block and Step 5's
   sabotage list into agreement with the shipped test; the fourth, `0e9110b`, touched the same file and
   did not, and finding 1 above touched it a fifth time. The plan's fenced Step 1 block is now a
   byte-for-byte copy of the shipped `ts_bindings.rs` — verified by extracting the block and diffing it
   against the file: empty. Step 5's transcripts are re-measured against the current gate rather than
   assumed forward from the old ones: the `derive(Default, ts_rs::TS)` and `use ts_rs::TS;` sabotages
   now fail at the whitelist check (not the old substring bans they used to defeat), a new sixth
   sabotage entry records the crate-alias counterexample from finding 1 — the one the shipped gate's
   own doc points readers to this list for — and the "second sabotage" (moving a derive between two
   already-listed types) is corrected from a claimed graceful test failure, which was never actually
   reproducible (`generated()` calls each of the twelve types' `export_to_string()` directly, so
   removing the derive from any one of them fails the CRATE'S OWN COMPILE before either test can run),
   to what actually happens. Every dummy-type sabotage now targets
   `crates/redextape-core/src/span.rs` rather than `tm/machine.rs`, which already declares a real
   `pub struct Rule` and made the original construction an `E0428` name collision rather than a passing
   gate. The "panic path is real" demonstration is rebuilt too: a `//`-comment marker no longer reaches
   `resolve_item_name` at all under the whitelist (it fails the canonical-line check first), and a real
   canonical attribute cannot dangle at end-of-file without `rustc` refusing to compile the crate
   first — replaced with a private (non-`pub`) struct following the canonical derive, which does still
   reach and exercise that panic branch. Verified: the plan's block diffed against the shipped file is
   empty, and every re-measured transcript in Step 5 was captured from an actual run against the
   current tree, not carried forward from an earlier one.

5. **Important — `rm -rf bindings`, run at the start of every `typecheck`/`test`/`build` in `web/`, had
   two measured consequences.** A failed `cargo test` (the case `scripts/setup-dev.sh` explicitly
   tolerates on a first clone with no network) left `web/bindings/` deleted and never rebuilt, so the
   next `tsc` reported 27 errors — 12 `TS2307`s plus a spray of unrelated `TS7006`s — with the real
   cause, a failed generation, not the first thing a reader saw. And `tsc --noEmit` was measurably
   sensitive to the delete for roughly its first second of file-reading: deleting mid-read gave exit 1
   with 27 errors, deleting after gave exit 0. `web/package.json`'s `build:bindings` now calls the new
   `scripts/build-web-bindings.sh`, which generates into `web/bindings.tmp/` and swaps it in as two
   renames (`bindings` → `bindings.old`, `bindings.tmp` → `bindings`) with the actual `rm -rf` of the
   old copy moved to AFTER the swap completes — every recursive delete in the script uses a literal
   path, never a variable. `.gitignore` and `.dockerignore` both gained the two new directory names
   beside the `/web/bindings/`/`web/bindings/` entry each already carried. `biome.json`'s
   `files.includes` and `tsconfig.json`'s `include` need no change: neither lists `bindings`, and the
   scratch directories sit outside `src/`/`tests/` the same way `web/bindings/` itself already does —
   confirmed by running `pnpm run typecheck` and `pnpm exec biome ci --error-on-warnings` against the
   new pipeline, both clean. CI's `web` job needs no change either: it still just calls
   `pnpm run build:bindings`, and the swap logic is internal to that script; `scripts/check-all.sh`
   needs no change, since its own Rust-side leg writes into `web/bindings/` directly and never deletes
   anything there. Demonstrated: a `cargo test` failure (a deliberate syntax error introduced into
   `span.rs`) leaves `web/bindings/`'s twelve files byte-for-byte unchanged (`md5sum` before and after
   match) with no `bindings.old` created; a clean run afterward produces exactly twelve files again,
   with both scratch directories gone.

6. **Minor — a paragraph about reordering sat under the mechanism that cannot see a reorder.** The
   `TOKEN_CLASSES` doc comment's closing paragraph — "a reordering here mis-colours silently" — used to
   sit directly under the sentence about `assertTokenClasses`, which joins both arrays into strings and
   is sensitive to order; the rewrite moved it to sit under the pin instead, which is set-based
   (`Exclude<...>`) and typechecks clean on a swap. Moved back into `assertTokenClasses`'s own doc
   comment, and the pin's own comment now says explicitly that it is blind to order, so the block no
   longer implies the pin catches a reorder anywhere it is described.

7. **Minor — "fires at `pnpm typecheck`, a pre-commit hook and a CI job" overstated the pre-commit
   hook's reach.** `web-typecheck` is scoped `files: ^web/.*\.(ts|tsx)$`, so a Rust-only commit that
   adds a `TokenClass` variant without touching any `.ts`/`.tsx` file — the exact drift the pin exists
   to catch — never runs that hook locally; CI's `web` job still catches it once the commit is pushed.
   Corrected in `web/src/types.ts`, and in design §5 (finding 3), which made the identical claim.

None of the seven touch any wire shape, any Rust type's fields or variants, or what any
`#[wasm_bindgen]` export answers — the design's scope boundary held through this pass as it held
through the last two.

---

## Post-review corrections, round 3 (2026-08-31, whole-branch review)

Round 2's finding 5 fix — `scripts/build-web-bindings.sh`, generating into a scratch directory and
swapping it in — was itself a regression: **a fix that is worse than the problem it fixed shipped
anyway**, because the swap used two fixed, shared scratch names with no lock. This round found that
Critical and three Important/Minor findings around it, plus two overstated claims a previous round
volunteered. Every finding is fixed here, not deferred; nothing was reverted to the pre-round-2 inline
shape, because the per-process-names-plus-lock design below closes the regression without giving up
round 2's two real fixes (a failed generation no longer destroys the last-good copy; `tsc` is no longer
sensitive to the directory being gone for the length of a `cargo test` run).

1. **Critical — two concurrent runs of `scripts/build-web-bindings.sh` destroyed `web/bindings`, every
   time, at exit 0.** The script used two fixed, shared scratch names (`web/bindings.tmp`,
   `web/bindings.old`) and `rm -rf`'d both unconditionally with no lock: a second run's `rm -rf` deleted
   the first run's already-populated scratch mid-flight, the first run's swap then moved the SECOND
   run's directory into place, and the loser's final `mv` found nothing — `web/bindings` ended up not
   existing at all, twelve files stranded under `bindings.old`. A second, latent defect sat in the same
   lines: `mv web/bindings web/bindings.old` when `web/bindings.old` already existed (a straggler from a
   crashed run) moved the directory INSIDE it, silently producing `web/bindings.old/bindings/`. Fixed
   with two changes together, exactly as the finding required: scratch directories are now per-process
   (`mktemp -d "web/bindings.tmp.XXXXXX"`, with `.old` appended to that unique name — never
   pre-created, so a `mv` onto it can never land inside an existing directory), and the swap itself —
   the two renames — runs under an `mkdir web/bindings.lock` mutex, `mkdir` being POSIX-atomic,
   portable, and needing no new dependency. `flock` was considered and rejected on evidence, not taste:
   it is util-linux, Linux-only, and `scripts/setup-dev.sh`'s `brew install` fallbacks for
   cargo-nextest and wasm-pack establish that this repo is set up on macOS too, where `flock(1)` is not
   part of the base system — `mkdir` needs nothing this repo does not already assume everywhere. A
   `trap cleanup EXIT INT TERM HUP` removes each run's own scratch directories on every exit that trap
   can catch; a lock left behind by a killed holder is reclaimed by a waiter that reads the holder's PID
   from `web/bindings.lock/pid` and confirms via `kill -0` that it is gone before ever touching the
   lock, never on mere absence of proof, and only after a bounded `LOCK_TIMEOUT_SECS` wait otherwise —
   bounded means this cannot deadlock the pre-commit hook, even though it is not instant. The script's
   header now states plainly what this guarantees and what it does not: `SIGKILL` cannot be trapped, so
   a run killed strictly between the two renames leaves an orphaned `*.old` scratch directory nothing
   auto-sweeps — no data lost, but a human may need to remove it by hand.

   **Demonstrated: 8 concurrent pairs of the script directly, 3 concurrent pairs of
   `pnpm run typecheck`, and one kill-mid-swap race.** All 11 races: both processes exit 0, `web/bindings`
   exists with exactly 12 files afterward, and no scratch or lock directory is left behind. Full tables
   below. The kill race: a temporary copy of the script (never shipped — deleted immediately after, and
   `git status --porcelain` confirmed clean before continuing) with a `sleep 2` inserted between the two
   `mv`s let the process be caught reliably inside the window; `kill -9` there left `web/bindings`
   genuinely absent, the pre-kill last-good copy intact under `web/bindings.tmp.<suffix>.old` (12
   files), the freshly generated tree intact under `web/bindings.tmp.<suffix>` (12 files, never lost),
   and the lock held by the now-dead PID. Running the real, unmodified script immediately afterward —
   with no manual lock removal — reclaimed the stale lock, exited 0 in 0.2s (not the 20s timeout budget
   given it), and restored `web/bindings` to 12 files; the killed run's orphaned scratch pair remained,
   exactly as the header now says it will.

   | Race | Runs | Exit codes | `web/bindings` after | Files | Scratch/lock left |
   |---|---|---|---|---|---|
   | Direct script × 8 | 2 concurrent `bash scripts/build-web-bindings.sh` per round, 8 rounds | 0/0 every round | exists every round | 12 every round | none every round |
   | `pnpm run typecheck` × 3 | 2 concurrent `pnpm run typecheck` per round, 3 rounds | 0/0 every round | exists every round | 12 every round | none every round |
   | Kill mid-swap | 1 (delayed copy, killed with `-9` between the two renames) | killed process never exits (SIGKILL); recovery run exits 0 | absent immediately after kill; exists (12 files) after the next run | 12 (`*.old`, pre-kill) + 12 (`*.tmp`, never swapped) at the moment of the kill; 12 after recovery | the killed run's `*.tmp.<suffix>` and `*.tmp.<suffix>.old` remain (expected, documented); lock reclaimed automatically, none left |

2. **Important — "cargo exited 0" was not "generation succeeded."** Nothing checked the scratch
   directory had contents, so a `cargo test` filter matching nothing — legitimately the normal case for
   `redextape-wasm`'s leg today, which runs 0 tests — exited 0 having written nothing, and the swap
   would have installed an EMPTY directory over the last-good copy. Fixed: the swap is now guarded on
   `find "$TMP_DIR" -maxdepth 1 -name '*.ts' -print -quit` finding at least one file, and the failure
   message says what went wrong (both legs exited 0, the export directory is empty, "0 tests passed" is
   not itself evidence of a problem for this pipeline) rather than trusting the exit code. Demonstrated:
   a copy of the script with both `cargo test` filters changed to `export_bindings_matches_nothing_xyz`
   ran both legs to `0 tests run: 0 passed` each, the guard fired, exit 1, and `md5sum` of
   `web/bindings/*.ts` before and after matched byte-for-byte — the last-good copy was never touched, and
   no scratch or lock directory was left behind.

3. **Important — the shipped comment on the unconditional `rm -rf` was false of its own crash window.**
   Line 37 read "Safe to clear unconditionally: neither one is the last-good copy `web/bindings` is,"
   which is exactly false if a run is interrupted between the two renames, when the ONLY copy sits under
   `bindings.old`. Closed by construction rather than by a truer comment alone: per-process scratch names
   (finding 1) mean there is no longer a SHARED name for an unconditional `rm -rf` to race against, so the
   dangerous shape the old comment was asserting safety about no longer exists. The rewritten header
   states the real invariant instead — a run's own scratch directories are safe to remove because they
   are its own, never anyone else's, and says explicitly what a `SIGKILL` mid-swap leaves behind (finding
   1's demonstration).

4. **Important — a sixth spelling defeated the whitelist because the scan only ever read `src/`.**
   `crates/redextape-core/tests/ts_bindings.rs`'s doc claimed "there is no sixth kind of 'not equal to
   this string' left to discover," true only of spellings WITHIN a scanned file — the reviewer's
   construction put the `ts_rs` bytes in a file the scan never opened at all. `pub use ts_rs::TS;` in a
   new `crates/redextape-core/tsalias.rs` (a file directly under `CARGO_MANIFEST_DIR`, never under
   `src/`), pulled in via `#[path = "../tsalias.rs"] pub mod tsalias;` in `src/lib.rs`, then
   `derive(crate::tsalias::TS)` on a new `Sneaky` struct with a `u64` field: the derive line itself
   carries no `ts_rs` bytes, and the one line that does sat outside the scanned tree. Reproduced first
   against the unfixed gate: both tests passed, `web/bindings/Sneaky.ts` was really written carrying
   `bigint`. Fixed by widening the walk from `crate_root.join("src")` to `crate_root` itself
   (`target/` excluded by name, as the one directory under a crate root that is build output rather than
   source) — `tsalias.rs`'s import line is now read and fails the canonical-line check like any other
   non-canonical mention. Widening surfaced one self-referential false positive the fix needed to name
   and close, not paper over: `ts_bindings.rs` itself carries `use ts_rs::TS;` (the trait import
   `export_to_string()` needs), and a whole-crate scan would otherwise fail the gate on its own
   legitimate infrastructure. `ts_deriving_type_names_in_crate`'s walk now excludes exactly one file, by
   its own path (`crate_root.join("tests").join("ts_bindings.rs")`) — safe because this file declares no
   `pub struct`/`pub enum` of its own for a derive to attach to, so nothing a sabotage could add here
   would go uncaught elsewhere. `ts_deriving_type_names_in_src` is renamed
   `ts_deriving_type_names_in_crate` throughout (its one caller, and every doc comment referencing it by
   name), since it no longer scans `src/` alone. The doc's absolute claim is replaced with a named
   boundary rather than repeated more narrowly: what remains outside this scan, after widening, is a
   `Cargo.toml` dependency rename (`bindgen = { package = "ts-rs" }`, routing every derive through a path
   containing neither `ts_rs` nor the canonical line — this scan never opens `Cargo.toml`) and a macro
   that expands to the marker only at its call site (the call site itself carries no `ts_rs` bytes).
   Demonstrated: the reviewer's `tsalias.rs`/`Sneaky` construction passing both tests under the pre-fix
   scan, and failing `the_gate_covers_every_exported_type` under the widened scan, naming
   `crates/redextape-core/tsalias.rs:1` and quoting `"pub use ts_rs::TS;"` — both runs' full output is
   in the round-3 fix report. Reverted afterward (`tsalias.rs` deleted, `lib.rs`'s `mod`/`Sneaky` lines
   removed); `git status --porcelain` clean.

5. **Minor — the whitelist's failure message named only one remedy, which read as "drop your rename."**
   `ts(export, rename = "…")` is ordinary `ts-rs` and now fails the canonical-line check like any other
   non-canonical spelling; the working answer — verified: a SECOND `#[cfg_attr(feature = "ts",
   ts(...))]` line below the canonical one, carrying the extra keys — passes, because that line does not
   mention `ts_rs` at all and `resolve_item_name` already skips it as just another attribute line. The
   8-line message said only "Spell the canonical line out exactly, unmodified, at the derive site," which
   read literally as "no other `ts-rs` attribute is allowed here" — the same message a `src/` doc comment
   merely mentioning `ts_rs` in prose was also served. Fixed by naming the escape hatch in the message
   itself, in the same edit as finding 4 above (both live in the same `assert!` string).

6. **Minor — a Global Constraint warned about a `$PWD` hazard finding 1's script already closes.** The
   bullet said `pnpm run build:bindings` "resolves its export directory from `$PWD`" and warned that
   running from the repo root writes to `<root>/bindings/`, silently — true of the pre-round-2 inline
   shape, no longer true of `scripts/build-web-bindings.sh`, which `cd`s to its own repo root before
   doing anything else. Rewritten to say the hazard is closed and by what, verified directly (not
   asserted): `bash scripts/build-web-bindings.sh` run with `/tmp` as the caller's `$PWD` still wrote to
   `<root>/web/bindings/` and created nothing under `/tmp`, exit 0. Task 1 Step 9's bare
   `cargo nextest run -p redextape-core --features ts` row is unaffected either way — it never goes
   through the script and has always needed `TS_RS_EXPORT_DIR` set explicitly — and the rewritten bullet
   says so, to avoid overclaiming a fix that covers a command it does not touch.

7. **Minor — the sibling sweep missed one, for the third round running.**
   `docs/superpowers/specs/2026-08-29-wire-type-generation-design.md` line 143, in §1 (before §2, and
   well before §5's own already-correct wording), still said "`web typecheck` is already both a
   pre-commit hook and a CI job" — the identical overstatement round 2's finding 3 and finding 7 fixed
   in §5 and in `web/src/types.ts`, sitting in a THIRD location the round-2 sweep never reached, using
   the exact grep pattern round 2's own correction records running. Fixed to say what §5 says: CI's
   `web` job always runs it, the pre-commit hook does not reliably (scoped to `.ts`/`.tsx` files), and
   the conclusion survives that distinction. Sweep re-run this round, across every file the branch
   touches and the whole repository, not just the three directories round 2 checked:
   `grep -rn "pre-commit hook and a CI job\|FIRES AT" docs/ crates/ web/src/` and again with
   `--include="*.md" --include="*.rs" --include="*.ts" --include="*.sh"` over `.` (excluding
   `.superpowers/sdd/`, this branch's own historical report archive). Both found the same four
   remaining hits: two inside this plan's OWN round-2 corrections prose (lines ~1404, ~1407 as of this
   writing), correctly past-tense — one quotes the old, now-fixed design §5 text as the thing that was
   wrong, the other quotes the grep command itself; one inside finding 7's own round-2 entry, likewise a
   correctly past-tense description of what was fixed; and `web/src/types.ts:46`,
   "THE PIN BELOW FIRES AT `pnpm typecheck` AND AT CI'S `web` JOB" — the ALREADY-CORRECTED wording from
   round 2's own finding 7, immediately followed at line 48 by "IT DOES NOT RELIABLY FIRE AT THE
   PRE-COMMIT HOOK," so this hit needs no change; it is the fix, not a sibling of the defect. A fourth,
   narrower sweep (`always fires\|always runs\|runs on every commit\|is already both`) over every file
   this branch's diff against `main` touches found nothing further.

**Also recorded, per this round's brief, without their own numbered finding because neither is a defect
in the current tree:**

- **The plan's "second sabotage" transcript depends on which type is sabotaged, and now says so.** The
  plan already stated the corrected property (removing a listed type's derive fails the crate's own
  compile, before either test runs) but showed only `Diagnostic`'s transcript (`E0599` at the test
  file's `export_to_string()` call site) without noting that the error CLASS is a property of which type
  is chosen, not a universal constant. `Diagnostic` is not embedded in any other `TS`-deriving type, so
  the missing `impl TS` surfaces only where the test calls it. `Cut` is embedded — `LambdaState.cut:
  Option<Cut>`, and `LambdaState` itself derives `TS` — so removing `Cut`'s derive instead surfaces as
  `E0277`, "the trait bound `Cut: TS` is not satisfied," inside the LIBRARY's own compile at
  `crates/redextape-core/src/viewmodel.rs:69:14`, before the test crate is even reached. Both measured
  directly this round (`Cut`'s derive removed, `cargo test -p redextape-core --features ts --no-run`
  run, transcript captured, derive restored, `git status --porcelain` confirmed clean); the plan's Task 2
  "second sabotage" paragraph now shows both and says the choice is load-bearing, rather than
  generalizing from the one transcript it happened to capture.

- **It is NOT true that all four `tm/machine.rs` sabotages collide with the pre-existing `pub struct
  Rule` — only a construction that adds a SECOND one does, and the current plan already says so
  correctly.** The overstated version lived in `.superpowers/sdd/whole-branch-fix-report.md`'s round-2
  entry, not in the plan: "every 'add `derive(...)` above `pub struct Rule` in `tm/machine.rs`'
  construction in the original plan is an `E0428` name collision" reads as a property of the FILE, when
  it is a property of adding a second declaration of the same name. Measured directly this round:
  `#[cfg_attr(feature = "ts", derive(Default, ts_rs::TS), ts(export))]` added straight onto the real
  `pub struct Rule` in `tm/machine.rs` — no second struct — compiles cleanly (no `E0428`) and produces a
  clean whitelist panic naming `tm/machine.rs:29`, the same class of failure `span.rs` produces (derive
  restored, `git status --porcelain` confirmed clean afterward). Corrected in that report file directly,
  per this round's explicit instruction to fix the claim wherever it currently lives: every dummy-type
  sabotage still targets `span.rs`, but the reason is that six of them need a genuinely NEW type absent
  from `generated()` to demonstrate the coverage gate — decorating the real `Rule` would add real
  coverage, not a counterexample — not because `tm/machine.rs` itself refuses the derive.

None of the seven touch any wire shape, any Rust type's fields or variants, or what any
`#[wasm_bindgen]` export answers. Two — findings 1 and 3 — are entirely inside `scripts/`, `.gitignore`
and `.dockerignore`; the rest are `tests/ts_bindings.rs` and documentation. The design's scope boundary
held through this pass as it held through the last two.

## Post-review corrections, round 4 (2026-08-31, whole-branch review)

Round 3 fixed the lock race, the empty-generation guard, the `src/`-only scan gap, and swept the
`is already both` claim, but its own commit messages claiming Task 2 Step 1's fenced block and Step 5's
sabotage transcripts were re-synced were wrong: the block still named the removed
`ts_deriving_type_names_in_src` and still carried a deleted false claim, and all five Step 5 panic
transcripts quoted stale line numbers and, for three of them, message text round 3 had rewritten. This
is the third time that specific resync was announced and not fully done; this round treats it as
blocking and does it last, after the two code changes below, so it syncs once against final state
rather than needing a fifth round.

1. **Blocking — the plan's embedded test and its five transcripts were stale again.** Round 3 rewrote
   `crates/redextape-core/tests/ts_bindings.rs` (renaming `ts_deriving_type_names_in_src` to
   `ts_deriving_type_names_in_crate`, deleting the now-false "there is no sixth kind of 'not equal to
   this string' left to discover" sentence, widening the walk) without updating the plan's Task 2 Step 1
   fenced block or Step 5's quoted panic transcripts. Extracting the plan's fence and diffing it against
   the shipped file at the start of this round showed 162 differing lines. Fixed by replacing the fenced
   block with the shipped file byte-for-byte (verified by re-extracting and diffing: empty), and by
   re-running all five sabotages against the CURRENT gate — including this round's own findings 2 and 4
   below, so the transcripts are measured against the tree this plan ships, not an intermediate one — and
   replacing every quoted transcript with what those runs actually printed:
   - Coverage-assertion sabotage (`Move` deleted from `generated()`): `ts_bindings.rs:280:5` → `:385:5`.
   - Third sabotage (`ts(rename = "Rule", export)`): `:116:21` → `:213:21`, `span.rs:28` → `:27`.
   - Fifth sabotage (`use ts_rs::TS;` + bare `derive(TS)`): `:116:21` → `:213:21`, `span.rs:5` unchanged.
   - Sixth sabotage (`use ::ts_rs as tsrs;` + `derive(tsrs::TS)`): `:116:21` → `:213:21`; this round's own
     reproduction also moved the offending line from `span.rs:4` to `:5`, because it added the
     `#[cfg(feature = "ts")]` gate line the fifth sabotage's construction uses and the plan's prior
     transcript for this one had omitted — the plan's prose is corrected to match what was actually run,
     not just the line number.
   - Seventh sabotage (canonical derive above a private struct): `:184:21` → `:287:21`, `span.rs:26`/`27`
     → `:27`/`28`.

   The three whitelist-violation transcripts (third, fifth, sixth) also carry substantially more message
   text than the stale versions quoted: the shipped gate's assertion now says "the ONLY line in this
   crate's own `.rs` files allowed to mention `ts_rs`" (not "the ONLY line under `src/` allowed",
   left over from before round 3's whole-crate widening) and ends with a paragraph naming the SECOND
   `#[cfg_attr(feature = "ts", ts(...))]` escape hatch for an ordinary `ts-rs` key like `rename` — both
   additions the stale transcripts predated. The connecting prose between transcripts (the "third
   sabotage" and "fifth sabotage" paragraphs) had the same `src/`-scoped wording and the old function
   name; corrected in place. Full transcripts and the empty fence diff are recorded in this round's fix
   report.

2. **Important — the doc's `#[path]` claim overclaimed what the widened walk covers, and the class it
   still misses had no name.** `ts_deriving_type_names_in_crate`'s doc said every `.rs` file at or below
   `CARGO_MANIFEST_DIR` is read, "AND ANY LOOSE FILE PULLED IN BY `#[path = "..."]` FROM ANYWHERE IN THAT
   TREE" — phrasing that reads as covering any `#[path]` target, when the walk has no notion of Rust's
   module system at all and reads a file only because it sits physically under the crate root, never
   because it resolved an attribute to find it. `#[path = "../../tsalias.rs"]` in `src/lib.rs`,
   resolving to `crates/tsalias.rs` — one directory ABOVE `CARGO_MANIFEST_DIR`, one level further out
   than round 3's whole-crate widening reaches — reproduces round 3's own gap one level higher: a new
   `SneakyTwo` struct in `span.rs` deriving `crate::tsalias::TS` (with `crates/tsalias.rs` holding
   `pub use ts_rs::TS;`) passed both gates and `web/bindings/SneakyTwo.ts` was really written carrying
   `bigint` — `n: u64` with no override. **This round does not widen the walk a fifth time to close it.**
   Four widenings have each bought one more round before the next `#[path]` moved the boundary again; a
   fifth walk starting one directory higher is defeated by the same construction moved one directory
   higher still, forever — the walk reads `.rs` files by physical location under one root and cannot,
   without parsing Rust itself, resolve where a `#[path]` attribute sends the compiler, and that is the
   honest boundary this scan stops at. Fixed by correcting the overclaiming sentence (it now says the
   walk covers `src/`, `tests/`, `benches/`, `examples/`, and any loose file beside `Cargo.toml` — no
   claim about following `#[path]`) and by naming this as the THIRD route in the "WHAT REMAINS OUTSIDE
   IT" list, alongside the `Cargo.toml` rename and macro-expansion routes round 3 already named. The
   structural alternative is recorded there too, for whoever wants the class actually closed rather than
   named: `ts-rs`'s derive macro emits one `export_bindings_*` test per exported type, so
   `cargo test -p redextape-core --features ts --lib -- --list` reads 12 tests on a clean tree and 13
   under every one of these constructions, because that count comes from macro expansion rather than
   source text a `#[path]` or `Cargo.toml` rename can route around — and the doc now says explicitly why
   this gate does not shell out to that count instead: a test binary invoking `cargo test`/`cargo` while
   it is itself running under `cargo nextest run`/`cargo test` is a build-lock hazard, cargo holding a
   lock on the target directory that a nested invocation from inside a running test would contend for.
   Demonstrated: the `../../tsalias.rs`/`SneakyTwo` construction reproduced exactly as above — both gates
   passed blind to it; `cargo test -p redextape-core --features ts --lib -- --list` read 13
   `export_bindings_*` tests including `span::export_bindings_sneakytwo`, where a clean tree reads 12; and
   the generated `SneakyTwo.ts` read `export type SneakyTwo = { n: bigint, };`. Reverted afterward
   (`crates/tsalias.rs` deleted, `lib.rs`'s `mod tsalias` and `span.rs`'s `SneakyTwo` removed);
   `git status --porcelain` confirmed clean and no stray `tsalias.rs` found anywhere in the tree by name.

3. **Minor — `kill -0` cannot tell "dead" from "not mine to signal", and `scripts/build-web-bindings.sh`
   asserted otherwise.** Line 55's header comment claimed reclaiming a lock "can never steal a lock a
   live process still holds," but `acquire_lock`'s check treated ANY `kill -0` failure as proof the
   holder PID was gone. `kill -0` fails for two different reasons — ESRCH (no such process) and EPERM (a
   live process this caller may not signal, e.g. one owned by another user, or PID 1) — and bash's `kill`
   builtin distinguishes them only in its error TEXT ("No such process" vs "Operation not permitted"),
   not its exit code. Planting a lock with `pid=1` (root, always alive, never signalable by an ordinary
   user) made the unfixed script reclaim it on the very next loop iteration, exit 0 — irrelevant on a
   single-user machine, real on a shared runner. Fixed: `acquire_lock` now captures `kill -0`'s stderr
   text and reclaims only when it reads "No such process"; any other failure (EPERM included) falls into
   the same "cannot prove gone" bucket as "genuinely still alive," waited out rather than reclaimed. The
   header comment states the real distinction rather than the old blanket claim. Demonstrated in
   isolation (an extracted copy of `acquire_lock`, never the file at its real path): a lock file naming
   `pid=1` was NOT reclaimed by the fixed function — it waited the full `LOCK_TIMEOUT_SECS` and failed
   loudly naming the holder, rather than being reclaimed instantly the way the unfixed version reclaimed
   it in 0.003s — while a lock naming a genuinely dead PID (a real subprocess started, killed, and
   `wait`ed on) was still reclaimed in 0.003s, unaffected by the fix.

4. **Minor — the self-exclusion `ts_deriving_type_names_in_crate` grants its own scanner file was an
   observed property of today's file, not an enforced one.** The doc said the exclusion "is safe
   precisely because this file declares no `pub struct`/`pub enum` of its own for a derive to attach
   to" — true when written, but nothing checked it stayed true, and a `#[derive(TS)] #[ts(export)]
   pub struct` appended to `ts_bindings.rs` itself would generate a real `export_bindings_*` test running
   in the same binary as the two gates that cannot see it (the file is excluded from the scan by its own
   path). Fixed: the exclusion branch now reads the scanner file's own source and asserts none of its
   lines, trimmed, start with `pub struct ` or `pub enum `, panicking with a message naming the file and
   pointing at moving the type elsewhere if that ever stops holding. The exclusion itself is unchanged —
   this adds a check, not a narrower scan. Demonstrated: a real `pub struct SneakyThree { pub n: u64 }`
   with the canonical derive, appended to `ts_bindings.rs`, made `the_gate_covers_every_exported_type`
   panic on the new assertion (naming the file), rather than passing silently while
   `export_bindings_sneakythree` ran ungated in the same binary. Reverted afterward.

None of the four touch any wire shape, any Rust type's fields or variants, or what any
`#[wasm_bindgen]` export answers. Finding 3 is entirely inside `scripts/`; the rest are
`tests/ts_bindings.rs` and this plan's own Task 2 prose. The design's scope boundary held through this
pass as it held through the last three.
