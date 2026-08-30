# Wire-type generation, PR 1 — plumbing proved on one type

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** stand up `ts-rs` generation of TypeScript wire types from Rust end to end — feature, gate,
generation, barrel, build wiring — with exactly one type (`Span`) generated, so the pipeline is proved
before any prose moves.

**Architecture:** two crates gain an optional, default-off `ts` feature carrying `ts-rs` derives.
`cargo test` with that feature writes one `.ts` file per type into `web/bindings/`, which is gitignored
and stands to `web/src` exactly as `pkg/` does today. `web/src/types.ts` becomes a barrel that
re-exports the generated types; its 44 importers never learn the difference.

**Tech Stack:** Rust, `ts-rs` 10.1.0, serde, TypeScript 7.0.2 (`verbatimModuleSyntax`,
`isolatedModules`), pnpm, Vitest, Forgejo Actions.

**Design:** [`../specs/2026-08-29-wire-type-generation-design.md`](../specs/2026-08-29-wire-type-generation-design.md), §11 PR 1.

## Global Constraints

- **No wire shape changes.** No Rust type's fields or variants change; no `#[wasm_bindgen]` export
  changes what it answers. If generated output disagrees with `types.ts`, the generator is wrong and
  gets an override — it does not get to redefine the wire.
- **`ts` is default-off on both crates.** `cargo tree -p redextape-core --edges normal` under default
  features must still list only `redextape-core`.
- **`redextape-core` must build for `wasm32-unknown-unknown`.** Gated by `scripts/check-all.sh`'s
  `wasm` rows, not asserted.
- **Every config gets clippy AND tests.** `check-all.sh`'s `LEGS` header states this: *"a config that
  is built but never tested is a blind spot."* A new feature config adds three rows, not one.
- **No `file:line` citations in tracked source.** `scripts/check-citations.sh` rejects them; cite the
  symbol. `docs/` is out of scope, so this plan may carry them and source may not.
- **Pre-commit runs `cargo clippy --workspace --all-targets -- -D warnings` on every commit.** A
  commit split that leaves the tree non-compiling is infeasible; collapse commits rather than pass
  `--no-verify`.
- **No commit attribution.** No `Co-Authored-By`, no `Generated with`.
- **ts-rs version is pinned to `10`** (resolves to 10.1.0), matching the probe every expectation in
  this plan was measured against.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `crates/redextape-core/Cargo.toml` | optional `ts-rs` dep, `ts` feature | 1 |
| `crates/redextape-wasm/Cargo.toml` | optional `ts-rs` dep, `ts` feature forwarding to core | 1 |
| `scripts/check-all.sh` | three `LEGS` rows covering the `ts` config | 1 |
| `crates/redextape-core/src/span.rs` | `Span` gains the `TS` derive | 2 |
| `web/package.json` | `build:bindings`; `typecheck`/`test`/`build` depend on it | 2, 4 |
| `.gitignore` | `web/bindings/` | 2 |
| `web/src/types.ts` | becomes a barrel for `Span`; other 17 types untouched | 3 |
| `.forgejo/workflows/ci.yml` | generation step in the `web` job | 4 |
| `scripts/setup-dev.sh` | generation on a fresh clone | 4 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | entry before the PR opens | 5 |

**`web/bindings/`, not `web/src/bindings/`, and the reason is measured.** `web/biome.json`'s
`files.includes` is `["src/**", "tests/**", "*.ts", "*.json"]` and `web/tsconfig.json`'s `include` is
`["src", "tests", "vite.config.ts"]`. A directory outside both is excluded from lint and formatting
while still being typechecked, because `types.ts` imports it and imports extend the program. Under
`src/` biome would reformat and lint generated code on every commit.

---

## Task 1: The `ts` feature exists, and the wasm32 gate covers it

**Files:**
- Modify: `crates/redextape-core/Cargo.toml`
- Modify: `crates/redextape-wasm/Cargo.toml`
- Modify: `scripts/check-all.sh` (the `LEGS` array)

**Interfaces:**
- Consumes: nothing.
- Produces: a `ts` feature on both crates enabling `ts_rs::TS`, and three `check-all.sh` rows that
  build, lint and test the `ts` configuration. Task 2 relies on `--features ts` compiling.

- [ ] **Step 1: Add the gate rows first, so they fail before the feature exists**

In `scripts/check-all.sh`, in the `LEGS` array, add three rows immediately after the existing
`"base|wasm|-p redextape-core --lib --features serde"` row:

```bash
  "base|clippy|-p redextape-core --features ts --all-targets"
  "base|test|-p redextape-core --features ts"
  "base|wasm|-p redextape-core --lib --features ts"
```

Three rows rather than one because this file's own `LEGS` header requires it: *"Every config gets
clippy AND tests; a config that is built but never tested is a blind spot."* The `wasm` row is the one
that matters for §7 of the design; the other two are the standing rule.

- [ ] **Step 2: Run them and verify they fail**

Run:

```bash
cargo check --target wasm32-unknown-unknown -p redextape-core --lib --features ts
```

Expected: FAIL, with cargo reporting that the `ts` feature does not exist — text along the lines of
`the package 'redextape-core' does not contain this feature: ts`. If it passes, something already
defines `ts` and this plan's premise is wrong; stop and report.

- [ ] **Step 3: Add the dependency and feature to `redextape-core`**

In `crates/redextape-core/Cargo.toml`, add to `[dependencies]` below the existing `serde` line:

```toml
# THE CRATE'S SECOND DEPENDENCY, AND THE FIRST THAT IS NOT `serde`. It exists so `web/src/types.ts`
# stops being a hand-written copy of this crate's wire types: `ts-rs` derives generate the TypeScript
# from these declarations, which is the only arrangement in which a variant added here cannot reach
# the browser unhandled. Optional and default-off, so the browser build never sees it — and
# `scripts/check-all.sh` builds the `ts` configuration for wasm32 anyway rather than trusting that.
ts-rs = { version = "10", optional = true }
```

and extend `[features]`:

```toml
[features]
serde = ["dep:serde"]
# `ts` IMPLIES `serde` RATHER THAN STANDING BESIDE IT. The generated TypeScript describes what serde
# puts on the wire, so a `TS` derive on a type whose `Serialize` is compiled out would describe a
# shape nothing produces.
ts = ["dep:ts-rs", "serde"]
```

- [ ] **Step 4: Add the dependency and feature to `redextape-wasm`**

In `crates/redextape-wasm/Cargo.toml`, add to `[dependencies]`:

```toml
# Optional and default-off, exactly as in `redextape-core` — see that manifest for why the generated
# TypeScript replaces a hand-written copy. `wasm-pack` never enables this feature.
ts-rs = { version = "10", optional = true }
```

and add a `[features]` section (this crate has none today), immediately after `[dependencies]`:

```toml
[features]
# Forwards to core's, because five of the wire types are declared here and twelve there; a generation
# run that enabled only one crate's derives would emit a `bindings/` directory with dangling imports.
ts = ["dep:ts-rs", "redextape-core/ts"]
```

- [ ] **Step 5: Verify the three rows now pass**

Run:

```bash
cargo check --target wasm32-unknown-unknown -p redextape-core --lib --features ts
cargo clippy -p redextape-core --features ts --all-targets -- -D warnings
cargo test -p redextape-core --features ts
```

Expected: all three PASS. The `cargo test` run compiles a config nothing has compiled before, so a
cold first run takes minutes; that is the build, not a hang.

- [ ] **Step 6: Verify the default graph is unchanged**

Run:

```bash
cargo tree -p redextape-core --edges normal
```

Expected: output lists `redextape-core v0.0.0` and nothing else. This is the property the manifest's
existing `serde` comment claims and keeps true; adding a second optional dependency must not break it.

- [ ] **Step 7: Prove the wasm row can fail — the gate is not vacuous**

This repository's rule, from the entry that replaced the zero-dependency rule: *a gate that would pass
anything is worse than no gate.* The `ts` row is currently believed to pass because `ts-rs` is
wasm32-clean, and a row that would pass regardless is worth nothing. So force a failure and observe
it.

Temporarily add to `crates/redextape-core/Cargo.toml`'s `[dependencies]`:

```toml
mimalloc = { version = "0.1", default-features = false, optional = true }
```

and temporarily change the `ts` feature to `ts = ["dep:ts-rs", "dep:mimalloc", "serde"]`.

Run:

```bash
cargo check --target wasm32-unknown-unknown -p redextape-core --lib --features ts
```

Expected: FAIL, on `libmimalloc-sys` — C with no wasm32 toolchain. This is the same demonstration the
`serde` row's own history records.

**Then revert both temporary edits** and re-run Step 5's wasm command to confirm it passes again.
Verify the tree is clean:

```bash
git diff --stat
```

Expected: only the intended edits from Steps 1, 3 and 4 remain.

- [ ] **Step 8: Record the outcome of Step 7 in the commit message**

If `ts-rs` turned out NOT to be wasm32-clean, stop and report — the design's §14 open question 1
assumed either answer was fine, but a dirty `ts-rs` means the feature can never be enabled in a build
that also targets wasm32, which the plan must be re-cut around.

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-core/Cargo.toml crates/redextape-wasm/Cargo.toml scripts/check-all.sh
git commit -m "build(ts): add the default-off ts feature and gate its wasm32 build

The wasm row was shown capable of failing before being relied on: forcing
mimalloc into the ts feature fails on libmimalloc-sys, as the serde row's
own history records. Reverted; the tree is clean."
```

---

## Task 2: `Span` generates, and the generated type matches the hand-written one

**Files:**
- Modify: `crates/redextape-core/src/span.rs`
- Modify: `web/package.json` (add `build:bindings` only; wiring is Task 4)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the `ts` feature from Task 1.
- Produces: `pnpm run build:bindings`, writing `web/bindings/Span.ts`. Task 3 imports from it.

- [ ] **Step 1: Add the generation script**

In `web/package.json`, add to `"scripts"`, immediately after `build:wasm:dev`:

```json
    "build:bindings": "TS_RS_EXPORT_DIR=$PWD/bindings cargo test -p redextape-core --features ts export_bindings && TS_RS_EXPORT_DIR=$PWD/bindings cargo test -p redextape-wasm --features ts export_bindings",
```

Three things about that line are load-bearing and none is obvious:

1. **`$PWD/bindings` is absolute.** `TS_RS_EXPORT_DIR` is resolved relative to each crate's own
   manifest directory, not the workspace root, so a relative value silently scatters output into
   `crates/redextape-core/bindings/` and `crates/redextape-wasm/bindings/`. The tests still pass. pnpm
   runs scripts with the package directory as cwd, so `$PWD` is `web/`.
2. **`export_bindings` is a test-name filter.** `ts-rs` generates one test per exported type, named
   `export_bindings_<type>`. Without the filter this runs the whole core suite — over 1,300 tests — on
   every typecheck.
3. **Both crates run**, even though the second transitively exports types reachable from the first.
   Several core types are reached only from `#[wasm_bindgen]` method return positions rather than from
   any wasm struct field, so transitive reachability cannot be relied on. Both crates emit
   byte-identical files for shared types, so the second run overwriting the first is safe.

- [ ] **Step 2: Run it and verify no `Span.ts` appears**

Run:

```bash
cd web && pnpm run build:bindings && ls bindings 2>&1
```

Expected: the command succeeds (the filter matches no tests, which is not an error) and `bindings/`
either does not exist or contains no `Span.ts`. This is the failing state: generation is wired up and
produces nothing, because no type carries a derive yet.

- [ ] **Step 3: Add the derive to `Span`**

In `crates/redextape-core/src/span.rs`, change the derive block on `Span` from:

```rust
/// A half-open byte range `[start, end)` into the source string.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Span {
    pub start: usize,
    pub end: usize,
}
```

to:

```rust
/// A half-open byte range `[start, end)` into the source string.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Span {
    pub start: usize,
    pub end: usize,
}
```

`ts_rs::TS` is spelled by full path rather than imported, so no `use` is needed and no `cfg` guard on
an import can go stale.

- [ ] **Step 4: Generate and verify the output**

Run:

```bash
cd web && pnpm run build:bindings && cat bindings/Span.ts
```

Expected: `bindings/Span.ts` exists and contains a generated-file header comment, the Rust doc comment
as JSDoc, and this type:

```typescript
export type Span = { start: number, end: number, };
```

**The check that matters is the type, not the formatting.** `usize` must map to `number` — it does;
the probe this plan was measured against generated `number` for both `usize` and `u32`. If either
field comes out as `bigint`, STOP: that is the §6 fidelity class arriving a PR early, and it needs the
`#[ts(type = "number")]` override plus the no-`bigint` test that PR 2 carries.

Compare against `web/src/types.ts`'s current line 9, `export type Span = { start: number; end: number }`.
Semicolon-versus-comma separators and trailing commas are formatting. A differing field name, a
differing field type, or an added or missing field is a stop.

- [ ] **Step 5: Ignore the generated directory**

In `.gitignore`, add immediately after the existing `# WebAssembly build output` block:

```
# Generated TypeScript for the wasm boundary's wire types (ts-rs, via `pnpm run build:bindings`).
# Stands to `web/src` exactly as `/pkg/` above does: built from the Rust declarations on every
# typecheck, test and app build, so there is no committed copy that can be stale. Deliberately NOT
# under `web/src/`, which would put generated files inside biome's `files.includes` and have it
# reformat and lint them.
/web/bindings/
```

- [ ] **Step 6: Verify the tree is clean apart from the intended edits**

Run:

```bash
git status --porcelain
```

Expected: `crates/redextape-core/src/span.rs`, `web/package.json` and `.gitignore` modified, and
**nothing** from `web/bindings/`. If `bindings/` shows as untracked, the `.gitignore` entry is wrong.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/span.rs web/package.json .gitignore
git commit -m "feat(ts): generate Span's TypeScript from its Rust declaration"
```

---

## Task 3: The barrel re-exports the generated `Span`

**Files:**
- Modify: `web/src/types.ts`

**Interfaces:**
- Consumes: `web/bindings/Span.ts` from Task 2.
- Produces: `types.ts` exporting `Span` by re-export rather than declaration. All 44 files that import
  `Span` from `./types` are unchanged.

- [ ] **Step 1: Confirm the current state passes, so a later failure is attributable**

Run:

```bash
cd web && pnpm run typecheck
```

Expected: PASS, with `Span` still hand-written.

- [ ] **Step 2: Replace the declaration with a re-export**

In `web/src/types.ts`, replace line 9:

```typescript
export type Span = { start: number; end: number }
```

with:

```typescript
import type { Span } from '../bindings/Span'

export type { Span }
```

**`export type`, not `export`.** `web/tsconfig.json` sets both `verbatimModuleSyntax: true` and
`isolatedModules: true`, under which a value-position re-export of a type-only symbol is an error.

**BOTH LINES ARE REQUIRED, AND A BARE RE-EXPORT DOES NOT COMPILE.** This step first specified
`export type { Span } from '../bindings/Span'` alone, which fails: `types.ts` uses the bare name `Span`
internally in `Classified`, `Diagnostic` and `LambdaState.redex_span`, and a re-export creates no local
binding. The error is `TS2304: Cannot find name 'Span'`. Biome's import organisation wants a blank line
between the import and the re-export. Corrected here after the implementer hit it and verified the
failure before fixing it.

- [ ] **Step 3: Extend the file header to say what changed**

The header currently ends with the sentence about `Decoded` being a union of strings and objects.
Append to it:

```typescript
//
// TYPES RE-EXPORTED FROM `../bindings/` ARE GENERATED FROM THE RUST DECLARATION and are not edited
// here — `pnpm run build:bindings` writes them. The directory is gitignored, so there is no
// committed copy to go stale.
//
// THE MIGRATION IS PARTIAL AND THIS COMMENT TRACKS IT. `Span` is generated; every other type below is
// still declared by hand and still agrees with its Rust counterpart only by someone remembering to.
// Two more PRs move the remaining seventeen.
```

**The second paragraph is not optional and must not be written in the end state's voice.** After this
PR seventeen types are still hand-written here, so a header claiming the file's hand-written remainder
is only what *cannot* be generated would assert a property the tree does not have. PR 3 replaces this
paragraph when it becomes true.

**AND THE FIRST PARAGRAPH LOST A CLAUSE FOR THE SAME REASON.** It originally read "…writes them, and
`typecheck`, `test` and `build:app` all run it first" — wiring Task 4 has not done at the point this
step runs. That is the sixth instance on this branch of a comment asserting something not yet true of
the tree, and the fifth authored in this plan rather than by an implementer. **The rule this branch
earned: write the tree you have, not the tree the next task will build.** Task 4 does not re-add the
clause; its `package.json` diff is self-documenting.

- [ ] **Step 4: Verify the typecheck passes through the generated file**

Run:

```bash
cd web && rm -rf bindings && pnpm run build:bindings && pnpm run typecheck
```

Expected: PASS. The `rm -rf bindings` proves generation actually produces what the barrel imports,
rather than a leftover file from Task 2 satisfying it.

- [ ] **Step 5: Verify no importer moved**

Run:

```bash
cd web && pnpm exec biome ci --error-on-warnings && pnpm run test
```

Expected: both PASS. `biome` must not report `bindings/` at all — it is outside `files.includes`.

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts
git commit -m "refactor(web): re-export the generated Span rather than declaring it"
```

---

## Task 4: Build wiring — generation runs before everything that reads it

**Files:**
- Modify: `web/package.json`
- Modify: `.forgejo/workflows/ci.yml`
- Modify: `scripts/setup-dev.sh`

**Interfaces:**
- Consumes: `build:bindings` from Task 2.
- Produces: a tree in which `typecheck`, `test` and `build` cannot run against absent bindings.

- [ ] **Step 1: Demonstrate the failure this task fixes**

Run:

```bash
cd web && rm -rf bindings && pnpm run typecheck
```

Expected: FAIL, with TypeScript unable to resolve `'../bindings/Span'`. This is the staleness hazard
the design's §12 item 4 names, in its simplest form.

- [ ] **Step 2: Chain generation into the three scripts that read the bindings**

In `web/package.json`, change these three script values:

```json
    "build": "pnpm run build:wasm && pnpm run build:bindings && pnpm run build:app",
    "typecheck": "pnpm run build:bindings && tsc --noEmit",
    "test": "pnpm run build:bindings && vitest run",
```

`test:coverage`, `test:node` and `test:browser` are left alone deliberately: CI's `web` job runs
`typecheck` before `test:coverage`, so generation has already happened, and chaining it onto every
variant would run cargo four times in one job.

**THIS STEP ORIGINALLY NAMED `build:app` WHERE IT NOW NAMES `build`, AND SHIPPING IT THAT WAY BROKE THE
DOCKER IMAGE.** `Dockerfile` stage 2 is `FROM node:26-slim` and runs exactly `pnpm run build:app`,
under a comment stating that this stage has no Rust toolchain; the chained `build:bindings` shells out
to `cargo`, and the build failed with `sh: 1: cargo: not found`. `build` is the script that already
required Rust (it chains `build:wasm`), so generation belongs there and `build:app` must stay
`vite build`. The `docker` job never runs on a pull request, so nothing in CI would have reported it —
this was found by a whole-branch review and confirmed by running `docker build .` by hand. The design's
§9 carried the premise that made it invisible; see that section.

**The cost is real and it is already paid.** The `web typecheck` hook runs `pnpm run typecheck`, so
every commit touching a `web/**/*.ts` file now compiles the `ts` configuration; this adds one more
feature configuration to the incremental build, not a new class of cost.

**THE MECHANISM ORIGINALLY GIVEN FOR THAT WAS FALSE.** This paragraph read *"the same hook set already
runs `cargo clippy --workspace --all-targets -- -D warnings`, so cargo is in the commit path
regardless"*. `.pre-commit-config.yaml` scopes `cargo-clippy` and `cargo-fmt` with `files: \.rs$`, so
on a `web/`-only commit — the exact commit class this change affects — neither hook fires. The
conclusion survives by a different route: `tsc --noEmit` resolves `../pkg/redextape_wasm.js` against a
`.d.ts` that only `pnpm run build:wasm` produces, and that needs wasm-pack and therefore cargo, so
anyone whose `web typecheck` hook can pass at all already has a Rust toolchain. The design's §9 carries
the same correction.

- [ ] **Step 3: Verify the chain works from nothing**

Run:

```bash
cd web && rm -rf bindings && pnpm run typecheck
```

Expected: PASS, having regenerated `bindings/Span.ts` on the way.

- [ ] **Step 4: Add the CI step**

In `.forgejo/workflows/ci.yml`, in the `web` job, add a step immediately after the existing
`Build the WASM package` step and before `Install the Chromium Playwright needs`:

```yaml
      - name: Generate the wire-type bindings (web/bindings is gitignored; typecheck resolves against it)
        run: pnpm run build:bindings
```

It is explicit rather than left to `typecheck`'s chain so a generation failure is reported as its own
red step, next to the wasm build it mirrors, rather than as a confusing typecheck error. The job
already installs Rust and the wasm32 target for `build:wasm`, so no new toolchain is needed.

- [ ] **Step 5: Add the fresh-clone step**

In `scripts/setup-dev.sh`, add immediately before the `pre-commit` block at the end of the file:

```bash
# The web tree imports generated TypeScript from `web/bindings/`, which is gitignored — so a fresh
# clone does not typecheck, and an editor's language server reports unresolved imports, until this has
# run once. `pnpm run typecheck` runs it too; doing it here means the tree is coherent before anyone
# opens it.
if [ -d web/node_modules ]; then
  echo "==> generating wire-type bindings (web/bindings)"
  (cd web && pnpm run build:bindings)
else
  echo "==> skipping wire-type bindings: run 'pnpm install' in web/, then 'pnpm run build:bindings'" >&2
fi
```

- [ ] **Step 6: Update the pre-commit hook count in `setup-dev.sh`**

The script's final `pre-commit install` block prints `(6: control bytes, citations, cargo fmt, clippy,
biome, web typecheck)`. **That count is already wrong** — measured 2026-08-29 at `b77fd04`:

```bash
$ grep -c '      - id: ' .pre-commit-config.yaml
9
```

The three it omits are `check-doc-figures`, `check-shared-docs` and `check-lua`. Correct the line to:

```bash
  echo "==> pre-commit hooks installed (9: control bytes, citations, doc figures, shared docs, lua, cargo fmt, clippy, biome, web typecheck)"
```

This is fixed here rather than left alone because this task edits the block immediately above it, and
this repository has twice recorded a comment counting its own steps being wrong. Do not add a third.

- [ ] **Step 7: Run the full local gate**

Run:

```bash
scripts/check-all.sh --no-llvm --no-browser
```

Expected: exit 0. Quote its own final line in the commit rather than calling the run green — it
reports which tiers were skipped, and a partial run is not a full gate.

- [ ] **Step 8: Commit**

```bash
git add web/package.json .forgejo/workflows/ci.yml scripts/setup-dev.sh
git commit -m "build(ts): run binding generation before typecheck, test and app build"
```

---

## Task 5: The roadmap entry, before the PR opens

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Append an entry at the end of the file**

Follow the house shape of the entries already there: an all-caps `####` heading naming what closed and
what surprised, the date, the branch, the commit range, then the design and plan links, then what
shipped, then a VERIFICATION block.

The entry must state, at minimum:

1. That this is PR 1 of 3 and generates exactly one type on purpose.
2. That `assertTokenClasses` is called only from `web/src/main.ts` and no browser test imports that
   file — so the tree's one runtime agreement check runs in nothing. This is a finding about the tree
   independent of the slice, and PR 3 acts on it.
3. That `tsc --strict` already forces consumers to handle a variant once the union knows it, measured
   with an added `'Aborted'` variant producing TS2322 and TS2339 — which is why generation closes the
   whole gap rather than half of it.
4. The Step 7 result from Task 1: whether `ts-rs` is wasm32-clean, and that the row was shown capable
   of failing before being relied on.

- [ ] **Step 2: Each VERIFICATION figure names its command and is run before committing**

Every number in the block must be produced by the command printed beside it, run against the tree at
the commit being described. Do not carry a figure across commits.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "docs(roadmap): record PR 1 of the wire-type-generation slice"
```

---

## Self-review notes

**Spec coverage.** §11's PR 1 lists: the `ts` feature (Task 1), `build:bindings` (Task 2), the
gitignore entry (Task 2), the barrel (Task 3), the CI step (Task 4), `setup-dev.sh` (Task 4), the
wasm32 gate shown failing (Task 1 Step 7), and `Span` alone generated (Task 2). All eight are covered.

**Deliberately deferred to PR 2, per §11 and §6:** the no-`bigint` test, the three `#[ts(type =
"number")]` overrides, the `RuleView.moves` override, and all prose relocation. Task 2 Step 4 carries
a stop condition in case the `bigint` class shows up on `Span` a PR early — measured evidence says it
will not, since `usize` generated `number` in the probe.

**Deliberately deferred to PR 3, per §11:** the `TOKEN_CLASSES` compile-time pin, the
`assertTokenClasses` retention note, and reducing `types.ts` to a barrel. Task 3 moves one type only
and Task 3 Step 3's header text describes the PARTIAL state. **This was corrected at pre-flight
review.** The step first mandated the end-state wording — "what remains hand-written is what cannot be
generated" — which is false while seventeen types are still declared by hand, and this plan's own
self-review had waved it through as "describes what the file is becoming". A comment asserting a
property the tree does not have is the defect class this repository has recorded most often.

**Open question this plan does not answer.** Design §14 question 1, whether `ts-rs`'s runtime builds
for wasm32, is answered by Task 1 Step 5 rather than assumed. Step 8 is the stop condition if the
answer is no.
