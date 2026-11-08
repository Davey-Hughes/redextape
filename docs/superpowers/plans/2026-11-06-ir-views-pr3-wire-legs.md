# IR views groundwork PR 3: shared wire types and table-driven legs — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec §6's PR 3 (`docs/superpowers/specs/2026-10-27-ir-views-groundwork-design.md`): §4.4's shared wire
types, serialisable `Program` and one lowering per compile, and §5.1's table-driven legs, gated by §7.2 (no hot path
slows) and §7.3 (the app behaves the same, including a walkthrough in a browser). Behaviour does not change (spec §1
non-goals).

**Architecture:** The Rust half (R tasks) gives core's rxm `Program` serde, lowers Core to rxm once per compile and
hands that lowering to the `SourceMap`, the TM run and the rxm leg, replaces the three TM status mappings and the two
scratch prologues with one each, and moves the eight wire types, their helpers and `to_value` into a new crate,
`redextape-wire`, with the generated TypeScript byte-identical. The web half (W tasks) replaces per-leg reply kinds,
recordings, scratch requests and per-leg fields with tables keyed by `Leg`, keeping each leg's own frame encoding;
switches whose arms genuinely differ stay and end in `unhandled`. W0 lands first: a probe of recording through the
session worker that is the §7.2 base point for both halves.

**Tech Stack:** Rust 2024, serde, ts-rs, wasm-bindgen, serde-wasm-bindgen, cargo-nextest; TypeScript, vitest (node
and browser projects, Chromium), pnpm, Biome.

`$W` is the worktree `~/temp/redextape-ir-wire-legs` (branch `ir-wire-legs`, from `783af0e`); `$R` is the lane record
`~/temp/redextape-ir-wire-legs-record`.

## Order

W0 → R1 … R8 → W1 … W8 → Z1 → R9 + Z2 (one quiet-machine hold) → Z3 → Z4.

The R tasks change no TypeScript type name or path and the W tasks change no Rust, so the two halves do not depend
on each other beyond W0 landing first. Each task is implemented by a fresh subagent, then reviewed; plan code and
plan facts are drafts, so an implementer who finds one wrong stops and reports rather than transcribing it.

## Decisions

Builder's calls (spec §10), taken by the plan writers and the controller; open to the user's correction:

- The wire types move to a new crate, `redextape-wire`, not core's `serde` feature: `to_value` needs `wasm-bindgen`
  and `serde-wasm-bindgen`, which core would carry as a third, wasm-only feature (Rust half's RD1-RD3 below).
- No Rust leg trait (RD4 below).
- §7.2 adds a new probe, `record-cost` (W0): no existing probe times the session worker or `replies.ts`, and §10's
  condition on probes is that each hot path is covered.
- `onRun` records in `LEGS` order (λ, rxm, TM), today's order, now held by a test (W2).

The user's decision (2026-11-06, Q1 below; not to be re-asked):

- **`redextape-wire`'s comment budget is its measured share after the verbatim move.** R7 writes the figure
  `node scripts/check-comments.mjs` prints for `crates/redextape-wire` into `scripts/comment-budget.json` as the
  crate's entry. R7's move check stays byte-identical (its commit 1). Trimming the moved docs' history goes to a later
  comment pass, which Z4 lists as not closed.

Drafted 2026-11-06 against `783af0e` in `$W`. Every fact below marked "checked" was read with grep/sed or measured at
`783af0e` while drafting; the rest is a design the implementer derives against the code.

## Global constraints (Rust)

- Work only in `~/temp/redextape-ir-wire-legs` (branch `ir-wire-legs`, from `783af0e`). Never edit or build in
  `/home/davey/projects/redextape` (it serves a dev server). `CARGO_TARGET_DIR=$HOME/.cache/redextape-ir-wire-legs-target`;
  `LLVM_SYS_231_PREFIX=/usr` for any `--features llvm` run; the cargo registry is `~/.local/share/cargo`. A scratch
  worktree (R9) gets its own `CARGO_TARGET_DIR`, never this one.
- A heavy run (a release build, coverage, `check-all.sh`) goes under `flock ~/temp/redextape-heavy.lock`; a browser run
  (`scripts/check-all.sh --browser-only`, any vitest browser run) under `flock ~/temp/redextape-browser.lock`.
- The pre-commit hook runs fmt, clippy `-D warnings`, the hygiene scans and the comment guard on every commit. Never
  `--no-verify`. If a commit cannot pass clippy alone, merge it with the next and say so in the message.
- Workspace clippy has `pedantic` on: a new `pub fn` returning a value without side effects takes `#[must_use]`; a
  new `pub fn` returning `Result` takes a `# Errors` doc section.
- No `file:line` in tracked source. A comment holds the why: no history, no measurement; a block over 8 lines of text
  fails the guard unless it is carried by a move (rule 2 matches a moved run at ≥ 0.5 shared words). Each area's
  share may not rise above `scripts/comment-budget.json` (`crates/redextape-core` 0.3078, `crates/redextape-wasm`
  0.4126, `scripts` 0.3200), and an area whose share falls more than 0.0050 below its budget while losing comment
  lines must write the budget down in the same diff. A new crate needs an entry from its first commit. Run
  `node scripts/check-comments.mjs` before committing; it prints the exact entry to write.
- Tests: a task is done by `cargo nextest run -p <crate> [features]` and the COUNT it reports, never by a filtered
  `cargo test`. Every test a task adds gets a named sabotage, run and seen to fail, in that task. Restore a sabotage
  by a saved copy and `cmp`, not `git checkout`. Use `--no-fail-fast` when a sabotage should fail several tests.
- Dependencies: no new third-party crate. One new workspace crate, `redextape-wire` (R7), whose manifest names only
  crates already in `Cargo.lock`. `bash scripts/check-licences.sh` exits 0 after R7 and R8 (path crates are skipped
  by `web/scripts/licences.ts`, and no third-party crate enters the wasm build's tree).
- The generated TypeScript does not change. **One baseline:** W0's fresh copy `$R/bindings-783af0e/` (regenerated at
  `783af0e`, 29 files; web Global constraints). After every Rust commit, `bash scripts/build-web-bindings.sh` (what
  `pnpm run build:bindings` runs) writes 29 files into `web/bindings/` that are byte-identical to that copy, with one
  exception: R7's doc-word commit (its commit 2) and every commit after it carry that commit's JSDoc-only difference,
  saved as `$R/bindings-r7.diff` (check given in R7). R8 adds no difference (checked at `783af0e`): it moves functions,
  which ts-rs does not export, and no doc on a `TS`-derived type in core or wasm names any of the six. One such doc,
  `RxmWord`'s in `viewmodel.rs`, says `serde-wasm-bindgen` is "the serializer `redextape-wasm` puts every frame
  through". That stays true after R8, because the wasm crate still calls it, through the wire crate's `to_value`, so R8
  leaves it alone. R1-R6 add no difference either: R4's doc edits are on `session.rs` items with no `TS` derive, and R4
  leaves `viewmodel.rs`'s cited doc alone (see R4).
- After a move or deletion, sweep for every symbol the base declared and HEAD lost (each task names its list).
- Nothing is pushed and no PR is opened without the user's word. Each task appends what it did, its SHAs and its
  measured counts to `~/temp/redextape-ir-wire-legs-record/progress.md`'s Log.

---

## Facts verified at `783af0e` (Rust half)

Measured 2026-11-06 on the x86-64 development machine in the worktree, with the target dir above. Nothing was left
in the worktree: the bindings were written to a scratch directory, and the `crates/*/bindings/` that the `--features
ts` test runs scatter when `TS_RS_EXPORT_DIR` is unset (gitignored) were removed. A task running a `ts` test leg by
hand sets `TS_RS_EXPORT_DIR=$PWD/web/bindings`, as `check-all.sh` does, or removes that scatter after.

| # | Fact | How measured |
|---|---|---|
| F1 | `cargo nextest run`: `-p redextape-wasm` 128; `--features ts` 139 (8 `export_bindings_*` + 3 in `tests/ts_bindings.rs` on top); `--features probe-no-tm-scratch-ceiling` 127; `--features probe-rxm-copy` 128. `-p redextape-core` 1319 (32 skipped); `--features serde` 1325; `--features ts` 1349. `-p redextape-native` 75; `--features llvm` 117. All passed. | nextest summaries |
| F2 | The bindings: core's leg writes 21 files, wasm's leg 9: the eight wasm types plus `RxmCap.ts`, byte-identical to core's (`cmp`), which `build-web-bindings.sh`'s `check_no_leg_collisions` deletes. 29 files in all. ts-rs copies each Rust doc comment into JSDoc (`Decoded.ts` has 51 JSDoc lines), so a doc edit on a moved type changes the bindings. | the script's two `cargo test … export_bindings` commands with `TS_RS_EXPORT_DIR` set to a scratch dir; `cmp`; `ls \| sort -u \| wc -l` |
| F3 | `compile_with_caps` lowers Core to rxm three times: `tm::run_tm_described(&desugar(&program), …)` → `lower_and_size` → `lower_program`; `SourceMap::build_from_program` → `desugar_mapped` + `build` → `rxm_half`, its own copy of `lower_program`'s dispatch over `lower_rxm_mapped`/`defunc_mapped`; `build_rxm_leg` → `lower_program`. It also desugars twice (`desugar` is `desugar_mapped(..).0`). | `sed` of `session.rs` `compile_with_caps`, `sourcemap.rs`, `desugar.rs` |
| F4 | `lower_rxm` is `lower_rxm_mapped(..).0` and `defunc` is `defunc_mapped(..).0`, so the map's program and `lower_program`'s are equal by construction of one dispatch. A third copy of the dispatch is `tm/attribute.rs` `lower_mapped`. Deliberate independent copies stay: `tests/sourcemap_coverage.rs`, session test `every_billed_state_resolves_at_the_width_the_run_fitted`, grammar-check's `lower_via_program_template`. | `grep -n 'lower_rxm_mapped(\|defunc_mapped('` over `crates/` |
| F5 | After this PR these still pair a SourceMap with a separate lowering: core `tests/viewmodel_contract.rs` `rxm_fact`; session tests `a_headered_scratch_matches_the_session_path_except_for_the_source_node` and `reduced_text`'s caller; core examples `link_index_probe.rs` and `frame_cost_probe.rs`. So `sourcemap.rs`'s `rxm_owner_covers_the_program_lower_program_returns` (still at line 337) stays. Other lowering callers, untouched: CLI `emit.rs` (`lower_rxm`, `run_tm_described[_at]`), native `lib.rs`/`measure.rs`/`codegen_snapshots.rs` and unit tests (`lower_program`), grammar-check `tm.rs`. | `grep -rn 'SourceMap::build\|build_from_program\|run_tm_described\|lower_program('` |
| F6 | The TM cursor → `RunStatus` match is in `Session::tm_status`, `TmScratch::tm_status` and `TmValueRun::run`; `TmCursor::status()` returns `Option<tm::TmStatus>` by value. The scratch prologue is in `rxm_scratch_with_caps` and `tm_scratch_with_caps`: a ceiling (`MAX_SCRATCH_RXM_BYTES`/`MAX_SCRATCH_TM_BYTES`, off under `probe-rxm-copy`/`probe-no-tm-scratch-ceiling` by `cfg!`), the same message but for "an rxm copy"/"a TM copy", then the parse; rxm builds only when its diagnostics are empty, TM whenever a machine parsed. | `grep -n 'RunStatus::Capped'`, `sed` of both functions |
| F7 | `to_value` (`lib.rs`) names `wasm_bindgen::JsValue` and `serde_wasm_bindgen::Serializer`; core depends on neither. `BinOp` is `redextape_core::core::BinOp` (`core.rs`), not an rxm type. `tm::rxm::Caps` derives only `Clone, Copy, Debug` (no `PartialEq`). | `sed` |
| F8 | No wasm module size gate exists. PR 1's size baseline is native object sizes (`crates/redextape-native/tests/size_baseline.rs`), which this half does not reach (no change in `redextape-native`). | `git grep -i '_bg.wasm'` over scripts and web tests |
| F9 | No probe times `Session::compile`. `test:probe:rxm-copy` times an rxm copy's build (`rxm_scratch`), `test:probe:tm-buffer` a TM copy's; `frame-cost` and `session-memory` call `compile` untimed or inside a larger reading. | `web/package.json` scripts; `grep -n performance.now` in `web/tests/browser/` |
| F10 | Roadmap: none of #160's, #161's or #166's WHAT THIS DID NOT CLOSE items lands in this half. | read of the three entries |

---

## The Rust half's decisions (builder's calls, spec §10)

- **RD1. The wire types go into a new small crate, `redextape-wire`, not core.** What a second wasm crate (the CLIF
  view's optional module, §9 piece 1) pulls in is the same either way: it needs core with `serde` (D4: the
  `Program` crosses by serde), `wasm-bindgen` and `serde-wasm-bindgen` already; the wire crate adds a few hundred
  lines and no third-party crate. Wasm size is the same either way: the linker drops what a module does not call.
  The difference is the feature tangle: `to_value` names `JsValue` and `serde_wasm_bindgen` (F7), so in core it
  would need a third feature, wasm-only, with two optional dependencies and its own check-all legs, beside `serde`
  and `ts`. In the wire crate those are plain dependencies. ts-rs derives stay in two crates, core and wire (today
  core and wasm), so `build-web-bindings.sh` keeps two legs. Core's comment budget is not touched.
- **RD2. All eight wire types move, verbatim**, not only `RunStatus` and `Decoded`. The "shared shape" stays the
  shape the status structs already share (`available`, `reason`, `run`, `total_steps`), held in one crate. A
  generic status struct embedded with `#[serde(flatten)]` would change the generated TypeScript (ts-rs writes an
  intersection type) and so the web half. Moving all eight leaves `redextape-wasm` with no `TS` derive, so its `ts`
  feature, its `ts-rs` dependency and its `ts_bindings.rs` gate move to the wire crate whole. Verbatim docs keep
  the bindings byte-identical (F2).
- **RD3. `rxm_fault` moves with them**: it is the one wording of a fault at an instruction, and a CLIF view that
  wrote its own would be the second fault-message table §1 forbids.
- **RD4. No Rust leg trait.** The three duplications §4.4 names each go with one function (R2-R6). A trait would
  have three impls whose methods differ in shape (`state(radius)`, `state(window)`, `lambda_state(byte_budget)`),
  and `#[wasm_bindgen]` impl blocks cannot be generic, so `lib.rs` would keep its per-leg methods anyway.
- **RD5. The TM mapping stays in `session.rs`** (`tm_run_status`, beside `lambda_run_status`): it maps a TM
  cursor, which a second wasm crate does not have.
- **RD6. The round-trip corpus** is `tests/rxm_roundtrip.rs`'s `DEMOS` ∪ `DEFUNC_DEMOS` through `lower_program`
  (its neighbour already counts them at 16 of 16 `Instr` variants), plus one hand-built program with all 9
  `BinOp`s and all 3 `Reg` kinds, which no corpus is shown to reach. The native oracle corpus lives in
  `redextape-native`, which core's tests cannot reach, and adds no variant.
- **RD7. One dispatch, not only one call.** `tm::lower_program_mapped` becomes the only implementation of the
  first-order-then-`defunc` dispatch; `lower_program`, the SourceMap and `attribute.rs` call it (F4). The equality
  test stays (F5) with its doc brought up to date.
- **RD8. Compile time is measured on `Session::compile` natively, in release** (R9), not in the browser: no probe
  times the browser's `compile` (F9); `Session::compile` is the whole of what the `compile` export does besides
  marshalling, which this half does not change (`to_value` is generic and monomorphised in the caller either way).
  If the controller wants the browser figure as well, the same probe as a throwaway vitest file over `pkg/` per
  side fits the web half's browser hold.

---

## File structure

| File | Responsibility | Tasks |
|---|---|---|
| `crates/redextape-core/src/tm/rxm.rs`, `src/core.rs` | serde derives on `Reg`, `Instr`, `Program`, `Caps`; `BinOp` | R1 |
| `crates/redextape-core/tests/rxm_roundtrip.rs` | the serde round trips | R1 |
| `crates/redextape-core/src/tm.rs` | `Lowered`, `lower_program_mapped`; `lower_program` on it; `run_tm_described_program`; `lower_and_size` split | R2, R3 |
| `crates/redextape-core/src/sourcemap.rs` | `rxm_half` on the one dispatch; `Prepared`, `SourceMap::build_prepared`; the equality test's doc | R2, R3, R4 |
| `crates/redextape-core/src/tm/attribute.rs` | `lower_mapped` on the one dispatch | R2 |
| `crates/redextape-wasm/src/session.rs` | one lowering in `compile_with_caps`; `tm_run_status`; the scratch prologue; wire imports | R4, R5, R6, R7, R8 |
| `crates/redextape-wire/` (new: `Cargo.toml`, `src/lib.rs`, `tests/ts_bindings.rs` moved) | the eight wire types, the helpers, `to_value`, their gates | R7, R8 |
| `crates/redextape-wasm/Cargo.toml`, `src/lib.rs`, `src/probe.rs` | depend on the wire crate; lose `ts`, `ts-rs`, the test-support dev-dependency, the re-export, `to_value`, and `serde` if unused | R7, R8 |
| `Cargo.toml` (members), `Cargo.lock` | the new crate | R7 |
| `scripts/build-web-bindings.sh`, `scripts/check-all.sh`, `.gitignore` (comment), `scripts/comment-budget.json` | the bindings leg, the legs, the budgets | R7 |
| comments naming `redextape-wasm` as the home of the moved items (swept, list in R7/R8) | wording | R7, R8 |

---

## Global constraints (web)

- Work only in `$W` (branch `ir-wire-legs`). Never read, build in or serve from `/home/davey/projects/redextape`.
  `pnpm install --frozen-lockfile` in `$W/web` is a real install; never symlink `node_modules`, `pkg/`, `pkg-lsp/` or
  `bindings/` from another checkout.
- Generated inputs are built here, and rebuilt when stale. `pnpm run build:bindings`, `build:wasm` and `build:lsp-wasm`
  run cargo: set `CARGO_TARGET_DIR=$HOME/.cache/redextape-ir-wire-legs-target` and run them under
  `flock ~/temp/redextape-heavy.lock`. Before any browser run, rebuild `pkg/` if `git log -1 --format=%H -- crates/`
  names a commit newer than the last build (record the SHA built in the task's log line): a stale `pkg/` tests the
  wrong wasm. At `783af0e` the worktree has no `pkg/` or `pkg-lsp/` (checked), so `tsc` reports 17 TS2307 errors, all
  "Cannot find module" for those two, and the node project fails 5 tests in `licences-scan.test.ts` and
  `wasm-vocabulary.test.ts` for the same reason (checked). Build both first.
- Browser runs: `flock ~/temp/redextape-browser.lock env VITEST_MAX_WORKERS=6 pnpm exec vitest run --project browser
  <files>`. Pass file paths (vitest's `-- <name>` does not scope files); `--maxWorkers` skips the browser project.
  Node runs: `pnpm exec vitest run --project node [files]`. Logs go to `$R/logs/<task>-<what>.log` with `>|`; read the
  `Test Files` and `Tests` lines, ANSI stripped (`sed 's/\x1b\[[0-9;]*m//g'`), and the exit status from the log, never
  through a pipe that hides it.
- Typecheck with `pnpm exec tsc --noEmit -p .` once `bindings/` exists (`pnpm run typecheck` rebuilds bindings through
  cargo; use it only under the heavy lock). Lint with `pnpm exec biome ci --error-on-warnings`.
- **Behaviour does not change** (spec §1 non-goals, §5.1 "pure refactor"). No task edits a test's assertion except to
  follow a renamed message kind, field or method; each such edit is a rename and nothing else, and the task's commit
  message says how many lines it renamed in which files.
- **The comment budget is tight in `web/src` and stale-armed in `web/tests`** (checked, by a copy of
  `scripts/check-comments.mjs` patched to print its shares): `web/src` is 0.4826 (15,899 comment lines, 17,045 code)
  against a budget of 0.4836, so about 68 deleted code lines with no comment deleted push it over. A task that removes a
  per-leg copy removes the comment that explained that copy (most say "for `TM_RECORDING`'s reason" or "`seedTmPane`'s
  twin") and keeps one statement of the why at the table; it never raises the budget for this. `web/tests` is 0.2575
  against 0.2641, more than the guard's 0.0050 below, so a commit that leaves fewer comment lines in `web/tests` than the
  base has fails the guard until `scripts/comment-budget.json` takes the share it prints, in that commit. Run
  `node scripts/check-comments.mjs --base 783af0e` before each commit; the pre-commit hook runs it too.
- Comments hold the why only, `/** */` for TypeScript docs, a block at most 8 lines of text, no `file:line` in tracked
  source. A comment that names a symbol this branch deletes is rewritten or removed in the same commit.
- **Deleted-symbol sweep, every task:** list each exported or module-level name the task deleted or renamed
  (`git diff` of the task, `-` lines with `export`, `const`, `function`, `type`, `case '`), then
  `grep -rn '<name>' web/src web/tests web/scripts README.md web/*.html` for each; zero hits outside `docs/` and the
  roadmap. Enumerate the names from the diff; never grep only for the ones you expect.
- **Typing pattern for per-leg tables** (checked: a scratch file compiled by the worktree's `tsc` 7.0.2, under the
  project's `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`): a table is a mapped type over `Leg`,
  `{ readonly [K in Leg]: (x: LegFrame[K]) => … }`, and a caller that holds a `Leg` goes through a generic function
  `<K extends Leg>(leg: K, …)` that indexes the table with `leg`, the shape `session-worker.ts`'s `PART` and `holdPart`
  already take. A reply union member written as `{ [K in L]: {…; leg: K; frames: LegFrame[K][]} }[L]` narrows by `kind`
  and passes to such a function without a cast. `LEGS.flatMap(<K extends Leg>(leg: K) => TABLE[leg](parts[leg]))`
  typechecks. Use these before reaching for a cast.
- Every test a task adds gets a named sabotage, run and seen to fail, in that task; restore it from a saved copy and
  `cmp` it, never `git checkout`. A sabotage that does not fire is a finding: add the missing case, then re-run it.
- Each task ends with: `tsc` (the 17 baseline TS2307 only, or 0 once `pkg/` is built), biome, the full node project
  (count = the previous task's plus its **Adds** line's node figure), the browser files the task names, then the whole
  browser project once (count = W0's plus every **Adds** line's browser figure so far), and the comment guard. A count
  that differs from that sum is a stop-and-report, not a correction to the figure. Then the commit, which the pre-commit
  hook gates; never `--no-verify`.
- Nothing is pushed and no PR is opened without the user's word. Each task appends its SHA, counts and the leg count's
  two figures where it re-ran them to `$R/progress.md`'s Log.
- The Rust half keeps every ts-rs binding name and path and every wasm-bindgen export the web calls (`compile`,
  `lambdaScratchAt`, `tmScratch`, `rxmScratch`, `tapeNames`, and the `Session` and scratch-handle methods listed in
  `session-worker.ts`'s `Session`, `LambdaScratchHandle`, `TmScratchHandle`, `TmValueRunHandle`, `RxmScratchHandle`).
- **One bindings baseline, built fresh.** W0 regenerates `web/bindings/` at `783af0e` and copies it to
  `$R/bindings-783af0e/` (W0's last step). It never copies what is already on disk: the worktree has had a
  `web/bindings/` since a drafting probe, so its age and source are unknown. R7 and Z3 compare against that one copy.
  After any Rust commit, `bash scripts/build-web-bindings.sh && diff -r $R/bindings-783af0e web/bindings` (run from `$W`)
  prints nothing, with **exactly one allowed difference**: R7's doc-word commit, the second of R7's two commits
  (subject `wire: the moved docs name where their tests are`), changes JSDoc only. R7 saves that `diff -r` output as
  `$R/bindings-r7.diff`. From that commit on, the implementer recognises the allowed difference in two ways: the new
  `diff -r` output is byte-identical to `$R/bindings-r7.diff` (`cmp`), and R7's JSDoc-strip loop prints nothing. Any
  other difference, and any difference before that commit, means stop and report.

## The leg count (spec §5.1 "Done when")

A place a new leg must touch is counted two ways, both in `web/src`, by two scripts that W0 writes to `$R/leg-count/`
exactly as below. The roadmap entry cites this section for the method.

**T, the sites `tsc` names.** `tsc-sites.zsh` adds a fourth member, `'probe'`, to `Leg` (`protocol.ts`) and to
`PaneKind` (`panes.ts`; a new leg needs a view kind too, and `PaneKind` is a literal union, not derived from `Leg`,
checked), runs `tsc`, restores both files from saved copies and `cmp`s them, and counts the unique `file:line` error
sites the edited tree has and the unedited one does not. Run: `$R/leg-count/tsc-sites.zsh $W $R/leg-count/<label>`. The
two precondition `grep`s fail the script if either declaration's text has changed; a task that changes one updates the
script's patterns and says so in its log line.

```zsh
#!/usr/bin/env zsh
# Usage: tsc-sites.zsh <worktree> <outdir>
# Adds a fourth leg, 'probe', to `Leg` and to `PaneKind`, runs tsc, restores both files (saved copy + cmp),
# and lists every error site tsc names that the unedited tree does not have.
set -eu
W=${1:?worktree}; O=${2:?outdir}
mkdir -p "$O"
cd "$W/web"
P=src/protocol.ts; K=src/panes.ts
cp "$P" "$O/protocol.ts.saved"; cp "$K" "$O/panes.ts.saved"
restore() { cp "$O/protocol.ts.saved" "$P"; cp "$O/panes.ts.saved" "$K"; cmp "$O/protocol.ts.saved" "$P"; cmp "$O/panes.ts.saved" "$K"; }
trap restore EXIT
npx tsc --noEmit -p . >| "$O/tsc-before.log" 2>&1 || true
grep -c "^export type Leg = 'lambda' | 'rxm' | 'tm'$" "$P" | grep -qx 1
grep -c "^export type PaneKind = 'source' | 'lambda' | 'rxm' | 'tm'$" "$K" | grep -qx 1
sed -i "s/^export type Leg = 'lambda' | 'rxm' | 'tm'$/export type Leg = 'lambda' | 'rxm' | 'tm' | 'probe'/" "$P"
sed -i "s/^export type PaneKind = 'source' | 'lambda' | 'rxm' | 'tm'$/export type PaneKind = 'source' | 'lambda' | 'rxm' | 'tm' | 'probe'/" "$K"
npx tsc --noEmit -p . >| "$O/tsc-after.log" 2>&1 || true
sites() { grep -oE '^[^(]+\([0-9]+' "$1" | sed 's/(/:/' | sort -u; }
sites "$O/tsc-before.log" >| "$O/before.sites"
sites "$O/tsc-after.log" >| "$O/after.sites"
comm -13 "$O/before.sites" "$O/after.sites" >| "$O/new.sites"
print "new error lines: $(grep -c 'error TS' "$O/tsc-after.log") after vs $(grep -c 'error TS' "$O/tsc-before.log") before"
print "sites (unique file:line): $(wc -l < "$O/new.sites")"
print "  in src/: $(grep -c '^src/' "$O/new.sites" || true), files $(grep '^src/' "$O/new.sites" | cut -d: -f1 | sort -u | wc -l)"
print "  in tests/: $(grep -c '^tests/' "$O/new.sites" || true), files $(grep '^tests/' "$O/new.sites" | cut -d: -f1 | sort -u | wc -l)"
print "  elsewhere: $(grep -vc '^src/\|^tests/' "$O/new.sites" || true)"
```

**N, the per-leg names `tsc` cannot ask for.** `leg-names.py` tokenises `web/src/**/*.ts` with comments stripped, takes
every identifier, and every string literal made only of letters, digits, `-` and `_`, that has exactly one component
naming a leg, replaces that component with `<L>` to get the token's family (`tmFrameBytes`, `rxmFrameBytes` →
`<L>framebytes`; `'tm-frames'` → `<L>-frames`), and counts the (file, family) pairs in which one file spells a family
for two or more legs: code written once per leg side by side. Run: `cd $W/web && python3 -I $R/leg-count/leg-names.py
src --list`. It counts a table's per-leg values too (`lambdaFrameBytes` in a table literal), which `tsc` also names; the
two figures are reported side by side, never summed into one claim of distinct places.

```python
"""Usage: python3 -I leg-names.py <web/src> [--list]

Counts the per-leg sites `tsc` cannot name. A leg-named token is an identifier, or a string literal of
letters, digits, `-` and `_`, found outside comments, with exactly one component that names a leg
(`lambda`, `tm` or `rxm`, any case; components split at `_`, `-`, `$` and camelCase humps). Its family is
the token with that component replaced by `<L>`: `tmFrameBytes` and `rxmFrameBytes` are `<L>framebytes`.
A SITE is a (file, family) pair in which that one file spells the family for two or more legs: code written
once per leg, side by side, which a fourth leg must extend by hand."""
import collections, pathlib, re, sys

LEGS = {'lambda', 'tm', 'rxm'}

def tokens(text):
    i, n, line = 0, len(text), 1
    while i < n:
        c = text[i]
        if c == '\n':
            line += 1; i += 1; continue
        if text.startswith('//', i):
            j = text.find('\n', i); i = n if j < 0 else j; continue
        if text.startswith('/*', i):
            j = text.find('*/', i + 2); end = n if j < 0 else j + 2
            line += text.count('\n', i, end); i = end; continue
        if c in '\'"`':
            j = i + 1
            while j < n and text[j] != c:
                j += 2 if text[j] == '\\' else 1
            body = text[i + 1:j]
            if re.fullmatch(r'[A-Za-z0-9_-]+', body): yield line, body
            line += body.count('\n'); i = j + 1; continue
        m = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*').match(text, i)
        if m:
            yield line, m.group(0); i = m.end(); continue
        i += 1

def family(tok):
    parts = []
    for chunk in re.split(r'[_\-$]+', tok):
        parts += re.findall(r'[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+', chunk)
    legs = [p.lower() for p in parts if p.lower() in LEGS]
    if len(legs) != 1 or len(parts) < 2: return None
    sep = '-' if '-' in tok else '_' if '_' in tok else ''
    return sep.join('<L>' if p.lower() in LEGS else p.lower() for p in parts), legs[0]

src = pathlib.Path(sys.argv[1])
legs_in = collections.defaultdict(set)     # (file, family) -> legs spelt there
lines_in = collections.defaultdict(set)    # (file, family) -> lines
for f in sorted(src.rglob('*.ts')):
    rel = f.relative_to(src).as_posix()
    for line, tok in tokens(f.read_text()):
        r = family(tok)
        if r:
            legs_in[(rel, r[0])].add(r[1]); lines_in[(rel, r[0])].add(line)
sites = sorted(k for k, v in legs_in.items() if len(v) >= 2)
files = sorted({f for f, _ in sites})
lines = {(f, l) for k in sites for l in lines_in[k] for f in [k[0]]}
print(f'sites (file, family): {len(sites)}; files: {len(files)}; families: {len({k[1] for k in sites})}; lines: {len(lines)}')
if '--list' in sys.argv:
    for f in files:
        fams = [k[1] + '(' + ','.join(sorted(legs_in[k])) + ')' for k in sites if k[0] == f]
        print(f'  {f}: {len(fams)}: ' + ' '.join(fams))
```

**Baseline at `783af0e`, measured while drafting (no `pkg/`):** T: 97 error lines against 17, 78 new sites, 46 in
`web/src` in 15 files and 32 in `web/tests` in 7 files. The `src` sites carry 48 errors: 19 TS2741 (a
`Record<Leg|PaneKind, …>` literal missing the new key, 7 of them `examples.ts`' per-example outcomes), 10 TS2345
(`unhandled` arms), 4 TS2366 (a returning `switch` missing an arm), and 10 TS2536 and 5 TS7053 (a type indexed by `Leg`
that is not keyed by it: 8 cascade from `LegFrame` on 7 lines, 6 from `ResultLegs`/`HeldLegs`, 1 from `compiled`). N:
101 (file, family) sites in 21 files, 43 families, 536 lines. The two file sets share 10 files; their union is 26 files. §2.4's "about 60 sites in about 20 files" was a
hand inventory; only the file count compares (about 20 against 26). W0 re-runs both and records them; Z1 runs them at
the last code commit.

## W0: the §7.2 base point — a probe of recording through the session worker, and the baselines

**Why first.** No existing probe times the code §5.1 changes (checked): `test:probe:rxm-copy`'s two files call the wasm
from the test page and from `rxm-copy-memory-worker.ts`; `buffer-affordability.test.ts` (the warm-buffer probe) records
rings in its own `affordability-*-worker.ts` workers and reads memory, not time; there is no share-positions probe
(`share-positions.test.ts` is a gate test with no timing). `session-memory.test.ts`, `worker.test.ts` and
`examples.test.ts` drive the real `session-worker.ts` but time nothing. The probe lands before any code task of either
half, so that its commit is the §7.2 base for both.

**Why it times stepping too (traced at `783af0e`).** Code that W6 and W7 change runs on every step. A step's handler
in `transport.ts` (`events(slot)`'s `back`, `forward`, `toNewest`) moves the history, then calls `draw()`
synchronously. `player.ts`'s `tick` calls `deps.draw()` once per animation frame in which ▶'s playback moved a step.
On every call, the closure `draw.ts`'s `createDraw` returns does two things:
- For every connected pane, it runs the two `unseen.has(...)` checks. W6 replaces them with one seed lookup per pane;
  the seed itself, through `programOf`/`readingOf`, runs once per unseen pane, which is then deleted from `unseen`.
- It calls `readout.show`. Before `show` compares against `rendered` and returns early, it evaluates
  `lines.segments()` (strip) or `lines.rows()` (inspector). Those call `programSegments`/`programRows` over the
  `recording` object (W7's `ProgramRecording.legs`), or, for a focused copy, the per-leg copy functions that W7's
  `COPY_FACTS` replaces.

So W0's probe times steps (cases e and f). No existing probe does: none of the seven `PROBE_FILES` mounts the app and
steps. `SessionEntry` seeding is not a per-step path: rebind, reseed, retire and `applyLayout`'s creation arms call it,
none of them on a step.

**W0 touches no Rust** (its Files below are `web/` only, and `web/bindings/` is gitignored, checked: `.gitignore`'s
`/web/bindings/`). So W0's commit and `783af0e` build the same Rust, and R9's base (`783af0e`) and Z2's base (W0's
commit) are one base for every Rust figure. The last step below checks this.

**Files:** Create `web/tests/browser/record-cost.test.ts`. Modify `web/vite.config.ts` (`PROBE_FILES` gains it),
`web/package.json` (`test:probe:record`: `REDEXTAPE_PROBE=1 vitest run --project browser --reporter=verbose
tests/browser/record-cost.test.ts`).

**Interfaces:** Consumes the real `session-worker.ts` through `new Worker(new URL('../../src/session-worker.ts',
import.meta.url), { type: 'module' })`, as `examples.test.ts`'s `run` does, and `EXAMPLES`/`EXAMPLE_ENCODING`
(`src/examples.ts`), and `rxm-copy-corpus.ts`'s `CASES`. Produces figure lines on `console.error` (`console.log` does
not reach the vitest log), one per figure, in the line format `rxm-copy-cost.test.ts` prints, so a comparer like
`task13/c/cmp3.py` reads both.

- [ ] Cases, each run 5 times in a fresh worker, each figure the median of the 5: (a) `run` of `fact-12`
  (`examples.ts`: λ and TM fill their histories, rxm ends); (b) `run` of a `sum_to`-shaped source whose bound makes the
  rxm leg stop on `budget` (find the bound by measurement; write it in the file with the reason); (c) an rxm copy,
  through the scratch request, of a loop that runs to its step cap (written in the probe; the corpus has none, checked:
  its `CASES` each fill the stack, the heap, the boxes or the saved frames); (d) an rxm copy of `CASES`' `heap cells`,
  whose frames carry a filled heap, the heaviest rxm frames. Add a λ copy and a TM copy only if each costs under a
  second a run.
- [ ] Stepping cases, the per-step path traced above, each run 5 times on a freshly mounted app (`harness.ts`'s
  `mountAt`, as the app tests mount it). Each figure is the median of the 5.
  - (e) The program: compile `fact-12` and wait until each leg has recorded. Then, for each of the λ, TM and rxm
    views: seek it to step 0, then time K synchronous `.click()`s on that view's ▶ (`step-controls.ts`'s "one step
    forward"; each click runs `forward` → `draw()` once). Do this once with the readout on `strip` and once on
    `inspector` (`ws.switches.readout`, as `inspector.test.ts` sets it). Figure: ms per step.
  - (f) The same over an rxm copy's view and a TM copy's view, each focused, so that `draw()` takes the copy readout
    path.
  - K is the view's recorded length less one, capped at 2,000. Raise K, or repeat the walk, until each timed loop is at
    least 100 ms. The must-not-vary check: after the loop, the view's step readout names step K.
  - A synthetic `.click()` is right here: it times the handler and the draw. No gesture is under test.
- [ ] Figures per case: ms from posting to `compiled` (or to the copy's `*-scratch-compiled`); per leg, ms from posting
  to the frames reply with `done !== null`, frames received, frames replies received, and `done`; ms to `result` for
  (a) and (b). Timed figures must each be at least 100 ms at the median, or the case is enlarged.
- [ ] Must-not-vary assertions (`expect`, so a broken run fails rather than prints): every leg of (a) and (b) and the
  copy's leg records at least one frame, and its `done` equals the value the case names (`budget` for a history that
  fills, as `examples.ts`' `history-full` reads; `ended` for (a)'s rxm). Frame and reply counts must be equal across the
  5 runs.
- [ ] Sabotage: in `session-worker.ts`'s `onRun`, delete the `await recordRxm(...)` line → (a) and (b) fail on the rxm
  leg's frame count. Sabotage 2: in `transport.ts`'s `forward`, drop `leg.hist.forward()`'s effect (call
  `leg.hist.back()` instead) → (e) and (f) fail on the step readout. Restore each from its saved copy, `cmp`.
- [ ] Run it 3 times under the browser lock (`pnpm run test:probe:record`); record the medians and spreads in
  `$R/w0-probe.md`.
- [ ] Baselines, recorded in `$R/progress.md`: the leg count (both scripts, `$R/leg-count/base/`); `tsc` (0 errors once
  `pkg/` is built); the full node project (71 files, 1,453 tests at `783af0e`, checked, with 5 failing until `pkg/` and
  `pkg-lsp/` exist); the whole browser project's files and tests; `pnpm run test:coverage` under both locks, its four
  figures against the floors 95 / 89 / 97 / 97 (statements / branches / functions / lines, `vite.config.ts`'s
  `thresholds`; #166's gate read 286 files, 3,069 tests, 97.65 / 92.39 / 98.43 / 98.94).
- [ ] **The one bindings baseline, regenerated.** Do this before any R task, from `$W` while its Rust is still
  `783af0e`'s.
  1. `[[ ! -e $R/bindings-783af0e ]]` (refuse to overwrite); `mkdir -p $R/logs` (absent at drafting).
  2. `flock ~/temp/redextape-heavy.lock env CARGO_TARGET_DIR=$HOME/.cache/redextape-ir-wire-legs-target bash
     scripts/build-web-bindings.sh >| $R/logs/w0-bindings.log 2>&1`, exit 0. The script builds a whole new tree and
     swaps it in for `web/bindings/`, so nothing already on disk survives into the copy.
  3. `cp -r web/bindings $R/bindings-783af0e`.
  4. `ls $R/bindings-783af0e | wc -l` is 29 (F2).
  5. `(cd $R/bindings-783af0e && sha256sum *.ts) >| $R/bindings-783af0e.sha256`.
- [ ] **Adds** 0 node cases and 0 browser-project cases: `record-cost.test.ts` is in `PROBE_FILES`, so it is outside the
  browser project's default set. The probe has 6 `it`s (a to f), plus one for each optional copy case taken (the log
  line says which). The node and browser counts recorded above are the base every later task adds to.
- [ ] Commit `web: a probe that times recording through the session worker (§7.2 base point)`. Then check that W0
  touched no Rust: `git diff --quiet 783af0e HEAD -- crates Cargo.toml Cargo.lock rust-toolchain.toml` exits 0.

## Task R1: serde for the rxm `Program` (core)

**Files:** Modify `crates/redextape-core/src/tm/rxm.rs` (`Reg`, `Instr`, `Program`, `Caps`) and `src/core.rs` (`BinOp`):
add `#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]`, the form `diagnostic.rs` uses. No
`TS` derive (nothing in `web/` reads a `Program`). Modify `crates/redextape-core/tests/rxm_roundtrip.rs`.

**Interfaces:** Produces `Serialize + Deserialize` for those five types under `serde`. Consumes `serde_json` (already a
core dev-dependency).

- [ ] Add the derives.
- [ ] Add two `#[cfg(feature = "serde")]` tests to `rxm_roundtrip.rs`, in a section after
  `every_program_the_web_app_runs_prints_to_text_a_copy_runs`:
  - `every_program_the_web_app_runs_survives_a_serde_round_trip`: for each of `DEMOS` and `DEFUNC_DEMOS` lowered by
    `lower_program`, plus `all_ops`, a hand-built `Program` with one `Instr::Bin(op, Reg::Loc(1), Reg::Arg(2), Reg::Rr)`
    per `BinOp` variant (all 9) and one label: `let back: Program = serde_json::from_str(&serde_json::to_string(&prog)?)?;
    assert_eq!(back, prog, "{src}")`, and the variants seen through `variant_name` count 16, as its neighbour counts.
  - `the_rxm_caps_survive_a_serde_round_trip`: `DEFAULT_CAPS` and a `Caps` whose four fields all differ, compared as
    `format!("{back:?}") == format!("{caps:?}")` (`Caps` has no `PartialEq`, F7; adding one is not asked for).
- [ ] Gate: `cargo nextest run -p redextape-core --features serde`: 1327 (1325 + 2). `--features ts`: 1351.
  `cargo nextest run -p redextape-core`: 1319 (the tests are compiled out). `cargo check --target wasm32-unknown-unknown
  -p redextape-core --lib --features serde` exits 0.
- [ ] Sabotage 1: `#[cfg_attr(feature = "serde", serde(rename = "Add"))]` on `BinOp::Sub` → the round trip fails, on
  `all_ops` at least (record whether a corpus program fails too). Sabotage 2:
  `#[cfg_attr(feature = "serde", serde(skip))]` on `Program::labels` → it fails on the first program with a call. Restore
  each by saved copy, `cmp`.
- [ ] Commit `core: serde for the rxm Program, its instructions, registers, operators and caps`.

## Task R2: one lowering dispatch (core)

`lower_program`, `sourcemap::rxm_half` and `attribute::lower_mapped` each write the first-order-then-`defunc`
dispatch (F3, F4). After this task one function does, and it keeps the origins.

**Files:** Modify `crates/redextape-core/src/tm.rs` (new `Lowered`, `lower_program_mapped`; `lower_program` becomes
`lower_program_mapped(core).map(|l| l.program)`; `lower_program`'s doc moves to `lower_program_mapped`, less its
sentence that `attribute.rs` and `sourcemap.rs` repeat the dispatch), `src/sourcemap.rs` (`RxmHalf` replaced by
`Lowered`; `rxm_half` becomes `lower_program_mapped(core).ok()`; `owners` a private fn over `&Lowered`),
`src/tm/attribute.rs` (`lower_mapped`'s dispatch becomes `lower_program_mapped(core)?`).

**Interfaces:** Produces, in `tm.rs`:

```rust
/// `lower_program`'s one lowering, with each instruction's origin.
#[derive(Clone, Debug)]
pub struct Lowered {
    pub program: Program,
    /// `origins[i]` is the Core node whose lowering emitted `program.code[i]`.
    pub origins: Vec<NodeId>,
    /// The nodes `defunc` minted, which name no source construct; empty for a first-order program.
    pub synthetic: BTreeSet<NodeId>,
}
pub fn lower_program_mapped(core: &Core) -> Result<Lowered, LowerError>; // with `# Errors`
```

- [ ] Write `lower_program_mapped` (the dispatch from `rxm_half`, keeping `TooDeep` immediate) and route the three
  callers through it. `attribute.rs` keeps its `lower_tm_mapped` step and everything after it.
- [ ] Gate, unchanged counts: `cargo nextest run -p redextape-core --features serde` 1327; `-p redextape-core` 1319;
  `-p redextape-native` 75 and `LLVM_SYS_231_PREFIX=/usr cargo nextest run -p redextape-native --features llvm` 117,
  whose snapshot tests show native codegen, which lowers through `lower_program`, unchanged.
- [ ] Sabotage 1: in `lower_program`, drop the program's last instruction → `sourcemap::tests::rxm_owner_covers_the_program_lower_program_returns`
  fails (the equality test still watches `lower_program` against the map). Sabotage 2: in `lower_program_mapped`,
  return the first `Unsupported` instead of retrying through `defunc` → `sourcemap::tests::instructions_defunc_minted_have_no_owner`
  fails, and at least one test that attributes a higher-order program through `attribute.rs` (record which; none is a
  finding: the attribute path would be unwatched). Restore, `cmp`.
- [ ] Sweep: `git grep -n 'RxmHalf'` → 0 hits.
- [ ] Commit `core: one lowering dispatch, which keeps each instruction's origin, for lower_program, the source map and attribution`.

## Task R3: the TM run and the source map take a lowering (core)

**Files:** Modify `crates/redextape-core/src/tm.rs`: split `lower_and_size` into the lowering and a private
`sized(prog: &Program) -> Result<lower_tm::SlotMap, TmRun>` (the three pre-checks); add `run_tm_described_program`;
`run_tm_described` becomes `run_tm_described_program(&lower_program(core).map_err(TmRun::LowerError)?, …)`. The
`#[allow(clippy::needless_pass_by_value)]` and its reason move with the body.

`lower_and_size` has four callers, all in `tm.rs` (checked: `git grep -n 'lower_and_size'`; the other hits are docs
and comments). Each one:

| Caller | After R3 | Who calls it (checked) |
|---|---|---|
| `run_tm_described` | becomes the wrapper above; its body moves to `run_tm_described_program`, which calls `sized` | `compile_with_caps` until R4 switches it to `run_tm_described_program`; also CLI `emit.rs`, grammar-check `tm.rs`, core's examples, unit and integration tests, and `session.rs`'s tests, all of which keep calling it |
| `run_tm_described_at` | unchanged: still `lower_and_size(core)?` | CLI `emit.rs`, `tm/reduction.rs`, `tests/universal_oracle.rs` |
| `run_tm_fitted` | unchanged | CLI `run.rs`, core examples and tests, native `tests/native_oracle.rs` |
| `run_tm_at` | unchanged | core tests |

`lower_and_size` stays as a private fn of two steps, `lower_program(core).map_err(TmRun::LowerError)?`, then
`sized(&prog)?`. The three unchanged callers keep their bodies and their behaviour, and none of them is the session's
path. The docs that cite `lower_and_size`'s pre-checks (in `tm.rs`, `tm/header.rs`, `tm/attribute.rs`,
`tests/guard_counterexamples.rs`) stay true, because it still pre-checks, through `sized`; `sized`'s doc says it is
those pre-checks.

Modify `src/sourcemap.rs`: add
`Prepared` and `build_prepared`; `build_from_program` becomes `Prepared::new` + `build_prepared`; `build` shares a
private body with `build_prepared`.

**Interfaces:** Produces:

```rust
// tm.rs: `run_tm_described`'s search and run over a program already lowered; same `Err`s less the lowering's.
pub fn run_tm_described_program(prog: &Program, kind: EncodingKind, result: Ty, caps: TmCaps)
    -> Result<DescribedRun, TmRun>;

// sourcemap.rs: one desugar and one lowering, for a caller that builds a map AND runs the backends from them.
// All fields private, so the source leg can only come from the desugar that made `core` (the no-setter rule
// `build_from_program`'s doc gives), and the map only from the lowering of that `core`.
pub struct Prepared { core: Core, spans: Vec<(NodeId, Span)>, lowered: Result<Lowered, LowerError> }
impl Prepared {
    pub fn new(program: &crate::ast::Program) -> Prepared;   // desugar_mapped + lower_program_mapped
    pub fn core(&self) -> &Core;
    pub fn lowered(&self) -> Result<&Lowered, &LowerError>;
    pub fn into_parts(self) -> (Core, Result<Lowered, LowerError>);
}
impl SourceMap { pub fn build_prepared(p: &Prepared, enc: &dyn Encoding) -> SourceMap; }
```

- [ ] Write them. `build_from_program`'s and `build`'s docs keep their reasons; `build_prepared` gets the
  no-setter paragraph's point in one line.
- [ ] Gate, unchanged: core 1327 (`--features serde`) and 1319; native 75 and 117 (llvm). No test is added: every
  existing `run_tm_described` and `build_from_program` caller now runs the new bodies.
- [ ] Watch sabotages (show the existing tests reach the new bodies): skip `sized` in `run_tm_described_program` →
  a `TooLarge` test in `tests/guard_counterexamples.rs` fails; make `build_prepared` use an `Err` lowering →
  `sourcemap::tests` fail through `build_from_program`. Restore, `cmp`.
- [ ] Commit `core: the TM run and the source map take one lowering a caller hands them`.

## Task R4: one lowering per compile (session)

**Files:** Modify `crates/redextape-wasm/src/session.rs`: `compile_with_caps` builds one `Prepared`, runs the TM with
`run_tm_described_program` over its program (a lowering `Err(e)` becomes `Err(TmRun::LowerError(e.clone()))`, the
value `run_tm_described` answered before), builds the map with `build_prepared` at the fitted width, then moves the
program into `RxmLeg::run(Rc::new(program), rxm_caps)`. Delete `build_rxm_leg`. Update the docs that went false:
`compile`'s two paragraphs (the run no longer desugars on its own; the rxm program is the map's own lowering), the
`rxm` field's ("Absent ONLY when the lowering fails"). Also update the two comments in `compile_with_caps` that
name the path R4 replaces (checked): "`run_tm_described` ERRS ONLY FOR A PROGRAM THAT NEVER RAN", which names
`lower_and_size` as one of its two fallible calls, and the comment on the arm that maps any other `Err`, which rests
on "`lower_and_size` produces no other `Err`". After R4, the session calls `run_tm_described_program`. Its fallible
calls are `sized` and `attempt`, and the lowering's `Err` is mapped to `TmRun::LowerError` before it. In core, update
the equality test's doc (`rxm_owner_covers_the_program_lower_program_returns`): it stays for the callers F5 lists, and
`rxm_half` no longer has branches.

**Leave `viewmodel.rs`'s `RxmState::source_node` doc alone**, the one that cites that test. Its words stay true: the
map still indexes the program `lower_program` returns, which is now `lower_program_mapped`'s program. It is also in
the bindings (`RxmState.ts`, checked), so an edit there would be a second bindings difference, which the Global
constraints forbid.

**Interfaces:** Consumes `Prepared`, `run_tm_described_program`, `build_prepared`. Produces no new public item.

- [ ] Make the change. The order stays: lower, run the TM, build the map at the width the run fitted, then the λ leg.
- [ ] Add one test in `session.rs` beside `the_link_index_carries_one_owner_per_listed_instruction`:
  `the_rxm_leg_and_the_map_index_one_lowering_through_defunc` over the tests' `MAP` (higher-order, 54 instructions,
  17 minted): `rxm_program().listing.len()`, `link_index(65_536).rxm_owner.len()` and `s.map.tm_listing.len()` are
  equal, and the link index has as many unowned entries as `s.map.rxm_owner` has `None`s (17).
- [ ] Gate: `cargo nextest run -p redextape-wasm` 129 (128 + 1); `--features probe-no-tm-scratch-ceiling` 128;
  `--features probe-rxm-copy` 129. Behaviour is held by the existing leg tests: `all_three_legs_agree`,
  `every_billed_state_resolves_at_the_width_the_run_fitted`, `a_program_that_does_not_lower_declines_the_rxm_leg_and_refuses_its_methods`,
  `a_declined_tm_leg_reports_why_and_refuses_its_methods`, `the_rxm_state_windows_the_cursor_and_names_its_owner`.
- [ ] Sabotage 1 (the new test): hand `RxmLeg::run` the program with its last instruction dropped → the new test and
  `the_link_index_carries_one_owner_per_listed_instruction` fail. Sabotage 2 (the TM run's input): run the TM over the
  program with its last instruction dropped → `all_three_legs_agree` or `every_billed_state_resolves_at_the_width_the_run_fitted`
  fails (record which). Restore, `cmp`.
- [ ] Sweep: `git grep -n 'build_rxm_leg\|third lowering'` outside `docs/` → 0 hits.
- [ ] Commit `wasm: one lowering per compile, shared by the source map, the TM run and the rxm leg`.

## Task R5: one TM cursor → `RunStatus` mapping (session)

**Files:** Modify `crates/redextape-wasm/src/session.rs`: add `fn tm_run_status(status: Option<tm::TmStatus>) ->
RunStatus` beside `lambda_run_status`, carrying the one comment on why `HitCap` is unambiguous here; `Session::tm_status`,
`TmScratch::tm_status` and `TmValueRun::run` call it.

- [ ] Gate: `cargo nextest run -p redextape-wasm` 129, unchanged. Held per surface by: Session
  `the_tm_run_status_separates_running_from_halted`, `a_raised_tm_cap_driven_to_a_halt_answers_what_the_status_claims`;
  TmScratch `a_capped_scratch_machine_can_be_raised_and_continued`; TmValueRun `a_reduced_run_is_held_to_exactly_its_recorded_steps`,
  `a_value_run_is_unfinished_until_it_ends`.
- [ ] Watch sabotage: map `HitCap` to `Ended` in `tm_run_status` → at least one failure on each of the three
  surfaces (record the names; a surface with none is a finding). Restore, `cmp`.
- [ ] Commit `wasm: one mapping from a TM cursor's status to a leg's run status`.

## Task R6: one scratch-build prologue (session)

**Files:** Modify `crates/redextape-wasm/src/session.rs`: a private ceiling description and one function that
refuses text over the ceiling unparsed (the zero-width diagnostic and its one message, naming "a TM copy" or "an rxm
copy") and otherwise runs the leg's parse. `rxm_scratch_with_caps` and `tm_scratch_with_caps` call it and keep their
own build steps (rxm builds only when its diagnostics are empty, TM whenever a machine parsed, F6).

**Interfaces:** Produces (private):

```rust
struct Ceiling { bytes: usize, off: bool, copy: &'static str } // `off` is `cfg!(feature = …)`, usable in a const
const TM_CEILING: Ceiling;   // MAX_SCRATCH_TM_BYTES, probe-no-tm-scratch-ceiling, "a TM copy"
const RXM_CEILING: Ceiling;  // MAX_SCRATCH_RXM_BYTES, probe-rxm-copy, "an rxm copy"
fn parse_copy<P>(src: &str, ceiling: &Ceiling, parse: impl FnOnce(&str) -> (Option<P>, Vec<Diagnostic>))
    -> (Option<P>, Vec<Diagnostic>);
```

- [ ] Make the change; the "before the parse" reason is written once, on `parse_copy`.
- [ ] Gate, unchanged: `cargo nextest run -p redextape-wasm` 129; `--features probe-no-tm-scratch-ceiling` 128;
  `--features probe-rxm-copy` 129; clippy on both feature sets (`scripts/check-all.sh` rows `base|clippy|-p redextape-wasm
  --features probe-… --all-targets`). Held by `a_file_at_the_ceiling_builds_and_one_byte_more_is_refused`,
  `an_oversized_file_is_refused_before_it_is_parsed`, `an_rxm_copy_at_the_ceiling_builds_and_one_byte_more_is_refused_unparsed`,
  `a_copy_refuses_a_parse_error_and_a_label_mistake`, `unparseable_tm_text_yields_diagnostics_and_no_scratch`, and under
  the features `the_probe_build_parses_text_over_the_ceiling` and `the_probe_build_parses_rxm_text_over_the_ceiling`.
- [ ] Watch sabotage: `>` to `>=` in `parse_copy`'s check → both at-the-ceiling tests fail. Restore, `cmp`.
- [ ] Commit `wasm: one prologue for building a copy from text: the size ceiling, then the parse`.

## Task R7: `redextape-wire`, the eight wire types

**Files:**
- Create `crates/redextape-wire/Cargo.toml`: workspace package fields, `[lints] workspace = true`; dependencies
  `redextape-core = { path = "../redextape-core", features = ["serde"] }`, `serde = { version = "1", features =
  ["derive"] }`, `ts-rs = { version = "12", optional = true }`; feature `ts = ["dep:ts-rs", "redextape-core/ts"]` (its
  reason, `RxmStatus::cap`'s import of `RxmCap`, moves from the wasm manifest); the target-gated
  `redextape-test-support` dev-dependency with `default-features = false` and its comment, moved from the wasm manifest.
- Create `crates/redextape-wire/src/lib.rs`: a short `//!` saying the crate holds what every wasm module puts on the
  wire, so a second module shares the types and serializer instead of copying them; then `RunStatus`, `Decoded`,
  `LambdaStatus`, `TmStatus`, `RxmStatus`, `TmScratchStatus`, `ReductionStatus`, `ValueRun`, moved from `session.rs`
  with their attributes and docs byte for byte.
- `git mv crates/redextape-wasm/tests/ts_bindings.rs crates/redextape-wire/tests/ts_bindings.rs`; its `use` names
  `redextape_wire`.
- Modify `Cargo.toml` (member `crates/redextape-wire`), `crates/redextape-wasm/Cargo.toml` (depend on the wire crate;
  remove `ts-rs`, the `ts` feature, the test-support dev-dependency and their comments; `serde` stays until R8),
  `crates/redextape-wasm/src/lib.rs` (remove the `#[cfg(feature = "ts")] pub use session::{…}` and its doc),
  `session.rs` (`use redextape_wire::{…}`).
- Modify `scripts/build-web-bindings.sh`: the second leg runs `-p redextape-wire`; rename `WASM_DIR` and the messages
  that name the crate. `scripts/check-all.sh`: replace rows `-p redextape-wasm --features ts` (clippy, test, wasm) with
  `base|clippy|-p redextape-wire --features ts --all-targets`, `base|test|-p redextape-wire --features ts`,
  `base|wasm|-p redextape-wire --lib`, `base|wasm|-p redextape-wire --lib --features ts`; its comment naming the two
  crates that scatter `bindings/`; `.gitignore`'s comment likewise.
- Modify `scripts/comment-budget.json`: add `crates/redextape-wire` and write `crates/redextape-wasm` down, both to
  what `node scripts/check-comments.mjs` prints. **The wire crate's entry is its measured share after the verbatim
  move** (the user's decision on Q1, 2026-11-06; a rough count puts it near 0.6-0.7). Do not trim the moved docs to
  lower it: commit 1 stays byte-identical, and the trim is a later comment pass (Z4). Commit 2 rewrites the entry only
  if the guard asks (its rewording changes the comment line count).

**Interfaces:** Produces `redextape_wire::{RunStatus, Decoded, LambdaStatus, TmStatus, RxmStatus, TmScratchStatus,
ReductionStatus, ValueRun}`, unchanged in shape and derives. TypeScript names and paths unchanged: the web half
needs nothing.

- [ ] Before any edit: the baseline is W0's `$R/bindings-783af0e/` (one copy, regenerated fresh at `783af0e`; R7 takes
  none of its own). Run `(cd $R/bindings-783af0e && sha256sum -c --quiet ../bindings-783af0e.sha256)`, which exits 0.
  Then `bash scripts/build-web-bindings.sh && diff -r $R/bindings-783af0e web/bindings` prints nothing: R1-R6 changed no
  binding.
- [ ] Commit 1, the move, verbatim. Gate: `bash scripts/build-web-bindings.sh && diff -r $R/bindings-783af0e
  web/bindings` prints nothing, and `ls web/bindings | wc -l` is 29. `cargo nextest run -p redextape-wire --features ts`:
  11 (8 `export_bindings_*` + 3 gates). `cargo nextest run -p redextape-wasm`: 129, unchanged (the moved tests ran only
  under `ts`). `scripts/check-all.sh --list` shows the four wire rows and no `-p redextape-wasm --features ts` row.
  `cargo check --target wasm32-unknown-unknown -p redextape-wire --lib` and `… --features ts` exit 0.
  `bash scripts/check-licences.sh` exits 0. Commit `wire: the eight wire types move to redextape-wire, so a second wasm
  module can share them`.
- [ ] Sweep, after commit 1. Its rewordings go in commit 2. A reworded doc on a `TS`-derived type changes the
  bindings, so it must land in that commit and in no later one. `RxmCap`'s doc in `trace/rxm_cursor.rs` is one: it
  says `redextape-wasm` "reports how a leg's run stands in its own `RunStatus`", and it is in `RxmCap.ts`, checked.
  `git grep -n -E 'redextape[-_]wasm' -- crates scripts .gitignore .forgejo` and read each hit that says the
  wasm crate declares TS types or holds `ts_bindings.rs` (at `783af0e`: core `tests/ts_bindings.rs` 68-77,
  `redextape-test-support` `Cargo.toml` 30, `src/lib.rs` 34, `src/ts_derive_scan.rs` 5 and 1219, `redextape-lsp-wasm`
  `Cargo.toml` 25 and `src/lib.rs` 5, core `trace/rxm_cursor.rs` 36); reword each that went false.
  `git grep -n 'pub use session::'` → 0 hits.
- [ ] Commit 2, doc words the move made false, **with the sweep's rewordings above**. In the moved docs, `grep -nE 'below|above|this crate|this file' crates/redextape-wire/src/lib.rs`, and fix
  each that now points nowhere (`Decoded`'s two "below"s point at `redextape-wasm`'s session tests). Keep reworded lines
  free of history. This commit is the PR's one allowed bindings difference (Global constraints).
  Gate: the bindings differ from the baseline in JSDoc only. This loop prints nothing:
  `for f in web/bindings/*.ts; do b=$R/bindings-783af0e/${f:t}; cmp -s <(perl -0pe 's{/\*\*.*?\*/\n}{}gs' $b) <(perl -0pe
  's{/\*\*.*?\*/\n}{}gs' $f) || print -r -- "$f differs outside JSDoc"; done`.
  Then save the difference that every later Rust commit must reproduce: `diff -r $R/bindings-783af0e web/bindings >|
  $R/bindings-r7.diff` (exit 1, since the trees differ). List the files it names in the progress log.
  Commit `wire: the moved docs name where their tests are`.
- [ ] Sabotage 1: `#[serde(rename = "widths")]` on `TmStatus::width` (ts-rs follows serde's renames; the Rust name,
  and so `session.rs`, is untouched) → `diff -r $R/bindings-783af0e web/bindings` no longer equals
  `$R/bindings-r7.diff`, and the new lines are in `TmStatus.ts`'s field, so the check sees the moved types. Sabotage 2: delete `ValueRun`'s entry from the wire crate's `generated()` → `the_gate_covers_every_exported_type`
  fails. Restore, `cmp`.

## Task R8: `redextape-wire`, the helpers and `to_value`

**Files:** Move into `crates/redextape-wire/src/lib.rs`, as `pub`: `to_value` (from `lib.rs`), `decoded_value`,
`decoded_or_undecodable`, `decoded_of`, `grouped`, `rxm_fault` (from `session.rs`), with `#[must_use]` where clippy
asks and `# Errors` on `to_value`; and the test `grouped_puts_a_comma_between_every_three_digits` into a
`#[cfg(test)] mod tests` there. Add `wasm-bindgen = "0.2.130"` and `serde-wasm-bindgen = "0.6.5"` to the wire manifest
(the wasm crate's pins). `session.rs`, `lib.rs` and `probe.rs` import them. The three `*_reports_too_large_to_print_*`
tests stay in `session.rs`: they are named for the session's producers. Remove `serde` from the wasm manifest (and its
comment) if `git grep -n 'serde::' crates/redextape-wasm/src` then finds nothing.

**Interfaces:** Produces `redextape_wire::{to_value, decoded_value, decoded_or_undecodable, decoded_of, grouped,
rxm_fault}` with today's signatures.

- [ ] Before the move, run the browser leg once and record its count:
  `flock ~/temp/redextape-browser.lock scripts/check-all.sh --browser-only` (wasm-bindgen-test's summary).
- [ ] Move. Fix the doc words the move made false (`grouped`'s "this crate writes" is now `redextape-wasm`'s). These
  docs are not in the bindings.
- [ ] Gate: `cargo nextest run -p redextape-wasm` 128 (129 − 1); `--features probe-no-tm-scratch-ceiling` 127;
  `--features probe-rxm-copy` 128. `cargo nextest run -p redextape-wire` 1; `--features ts` 12. R8 adds no bindings
  difference: run `bash scripts/build-web-bindings.sh && diff -r $R/bindings-783af0e web/bindings >|
  $R/logs/r8-bindings.diff`, then `cmp $R/logs/r8-bindings.diff $R/bindings-r7.diff`, which exits 0. The
  `RxmWord` doc stays as it is (Global constraints). The browser leg (under the lock): the count recorded above, all
  passing; it is what exercises `to_value` on the wire (`tests/browser.rs`).
- [ ] Sabotage 1: `grouped` without commas → the moved test and both at-the-ceiling tests in `session.rs` fail.
  Sabotage 2: `serialize_missing_as_null(false)` in `to_value` → the browser leg fails on a `null` read as `undefined`
  (record the test; if none fails, the serializer's one rule is unwatched, a finding to report, not to fix here).
  Restore, `cmp`.
- [ ] Sweep: `git grep -n -E 'fn (to_value|decoded_value|decoded_or_undecodable|decoded_of|grouped|rxm_fault)\b'`
  → each once, in `crates/redextape-wire/src/lib.rs`; `git grep -n "redextape-wasm's \`decoded_value\`"` (native-rt's
  doc cites it) → reworded.
- [ ] Commit `wire: the decoded-value helpers, digit grouping, the fault wording and the one serializer move to redextape-wire`.

## W1: one `frames` reply and the per-leg frame-bytes table

**Files:** `web/src/protocol.ts` (`LegFrame` moves here from `sessions.ts`; every importer, `grep -rn LegFrame
web/src web/tests`, imports it from `protocol.ts`, with no re-export left behind; `RunReply`'s three
`*-frames` members become `FramesReply`; the table), `web/src/record-loop.ts` (`RecordLeg` loses `reply`; `recordLeg`
posts the one kind), `web/src/session-worker.ts` (the three `*_RECORDING` objects lose `reply`, and `bytes` reads the
table), `web/src/replies.ts` (`onReply` and `onScratchReply`: three arms each become one `case 'frames'`),
`web/src/share-positions.ts` (`LinkPositions`' three arms become one; its two `{ lambda: 0, rxm: 0, tm: 0 }` literals
become `perLeg(() => 0)`). Tests that name the old kinds, by a rename only (checked counts of lines naming
`'lambda-frames'`, `'tm-frames'` or `'rxm-frames'`): `tests/browser/worker.test.ts` 36, `scratch-fork.test.ts` 6,
`restart-rewind.test.ts` 3, `examples.test.ts` 3, `session-memory.test.ts` 2, `pool-isolation.test.ts` 1,
`link-hold.test.ts` 1, `tm-scratch-fork.test.ts` 1; `tests/node/session-client.test.ts` 6, `replies.test.ts` 4,
`record-loop.test.ts` 3, `sessions.test.ts` 1.

**Interfaces:** Produces, in `protocol.ts`:

```ts
export type LegFrame = { lambda: LambdaState; rxm: RxmState; tm: TmState }
export type FramesReply<L extends Leg = Leg> = {
  [K in L]: { kind: 'frames'; leg: K; gen: number; epoch: number; frames: LegFrame[K][]; done: RecordEnd | null }
}[L]
export const LEG_FRAME_BYTES: { readonly [K in Leg]: (frame: LegFrame[K]) => number } = {
  lambda: lambdaFrameBytes, rxm: rxmFrameBytes, tm: tmFrameBytes,
}
```

`FRAME_BYTES` is taken: it is the λ printer's 512-byte budget for a history frame (checked), so the table is not called
that. `RecordLeg<H, F>` becomes `RecordLeg<K extends Leg, H>` with frames `LegFrame[K]`; `recordLeg` posts `{ kind:
'frames', leg: leg.leg, gen, epoch, frames, done }`.

- [ ] No transfer list is added. At `783af0e` no frames reply carries one (checked: `ctx.postMessage` transfers only for
  `compiled`, the link index's eleven buffers, and `lambda-tree`); a λ frame's spans byte string is cloned, and stays
  so. Each leg's encoding is its frame type and its byte function; both are unchanged.
- [ ] `replies.ts`: one helper `<K extends Leg>(session, reply: FramesReply<K>)` calls the existing `pushFrames` with
  `sessions.legOf({ session, leg: reply.leg })` and `LEG_FRAME_BYTES[reply.leg]`. The doc above `replies.test.ts`'s
  "a recording chunk redraws once per frame" says "the six `*-frames` arms"; it becomes two arms over three legs.
- [ ] Held by: `tests/node/replies.test.ts` (that describe runs both switches for all three legs),
  `record-loop.test.ts` (8 cases), `session-client.test.ts`, `sessions.test.ts`, `share-positions.test.ts` (node and
  browser); browser `worker.test.ts`, `examples.test.ts`, `scratch-fork.test.ts`, `restart-rewind.test.ts`,
  `link-hold.test.ts`, `session-memory.test.ts`, `pool-isolation.test.ts`, `tm-scratch-fork.test.ts`,
  `share-positions.test.ts`.
- [ ] Sabotage: swap `rxm` and `tm` in `LEG_FRAME_BYTES` (each through a cast). Expect a node or browser case that
  checks a history's charge to fail; if none does, add one to `replies.test.ts`'s describe: after one chunk per leg,
  `entry.legs[leg].hist`'s charged bytes equal `LEG_FRAME_BYTES[leg]` summed over the chunk's frames. Restore, `cmp`.
- [ ] `node scripts/check-comments.mjs --base 783af0e`; the deleted `reply` members took code lines only.
- [ ] **Adds** 0 browser cases, and 0 node cases, or 1 if the sabotage finds no case and the `replies.test.ts` case
  above is added. Expected node count: W0's, or W0's + 1. The log line says which.
- [ ] Commit `web: one frames reply carrying its leg, and one frame-bytes table`.

## W2: the `RECORDINGS` table; extend, rewind and run look a leg up

**Files:** `web/src/record-loop.ts` (`RecordLeg` gains `raise` and `rewind`; new `extendLeg`; `rewindAndRecord` moves
here from `session-worker.ts`), `web/src/session-worker.ts` (`LAMBDA_RECORDING`, `TM_RECORDING`, `RXM_RECORDING`
become the entries of `RECORDINGS`; `recordLambda`, `recordTm`, `recordRxm` go; `onRun` loops; `onExtend`'s
`switch (req.leg)` and `onRewind`'s go), `web/tests/node/record-loop.test.ts`, `web/tests/browser/worker.test.ts`.

**Interfaces:** Produces `RecordLeg<K, H>` members `raise(handle: H): void` (the bare wasm call: `raiseLambdaCap
(EXTEND_STEPS)`, `raiseTmCap(EXTEND_STEPS, EXTEND_CELLS)`, `raiseRxmCap(EXTEND_STEPS)`) and `rewind(handle: H): void`
(`rewindLambda`, `rewindTm`, `rewindRxm`). Produces `extendLeg<K extends Leg, H>(leg: RecordLeg<K, H>, worker:
RecordWorker, gen: number): Promise<boolean>`: `false` when `leg.handle(gen)` is `null`; otherwise `raise` when
`leg.end(handle) === 'capped'`, then `recordLeg(leg, worker, gen, false)`. In the worker, `RECORDINGS: { readonly [K
in Leg]: RecordLeg<K, Session | ScratchOf[K]> }`, with `type ScratchOf = { lambda: LambdaScratchHandle; rxm:
RxmScratchHandle; tm: TmScratchHandle }` beside the handle types.

- [ ] **The raise rule is `end === 'capped'`, written once in a covered module.** Today the arms test
  `lambdaStatus().run === 'Capped'`, `tmStatus().run === 'Capped'`, and `run === 'Capped' && cap === 'Steps'`. `end` is
  `endOf(run)` for λ and TM, `'capped'` exactly when `run` is `Capped`; for rxm it is `rxmRecordEnd`, `'capped'` when
  `Capped` with `cap` `Steps` or `null`. The `null` case cannot occur: `RxmStatus.cap` is documented in `session.rs` as
  `Some` exactly when `run` is `Capped` (checked), and `rxmRecordEnd` already reads it as the step cap. The rule then
  matches the continue `controls.ts` offers, which is keyed on the same `RecordEnd`.
- [ ] `onExtend` keeps its gen and epoch checks and its allowance line, then `ran = await extendLeg(RECORDINGS[leg],
  worker, req.gen)` through a generic helper, and its post-record tail unchanged. `onRewind` is one lookup into the
  moved `rewindAndRecord`, which calls `leg.rewind(held)` and keeps `holdPart`'s call through a callback the worker
  passes (it touches `posted` and `live`, which stay in the worker).
- [ ] `onRun` records `for (const leg of LEGS) await recordLeg(RECORDINGS[leg], …)`: `LEGS` is λ, rxm, TM (checked,
  `LEG_NAME`'s key order), the order `onRun`'s comment gives Plan 7 part 5 spec §5.4's reason for. Keep that reason at
  the loop and point it at `LEG_NAME`'s order. No case holds the cross-leg order today (checked: `worker.test.ts`'s "sends
  compiled first, then frames, then the result" orders kinds, not legs); add one: "records λ, then rxm, then TM" — the
  first frames reply of each leg arrives in that order for an example with all three legs. Sabotage: loop over
  `[...LEGS].reverse()` → it fails. Restore, `cmp`.
- [ ] `record-loop.test.ts` gains: `extendLeg` raises once before recording when `end` is `capped`; does not raise when
  `end` is anything else (an `it.each` over the six other `RecordEnd`s: `ended`, `depth-refused`, `budget`,
  `stack-full`, `heap-full`, `memory-full`, checked against `protocol.ts`); returns `false` and raises nothing when
  `handle` is `null`. Sabotage: make `extendLeg` raise unconditionally → the not-`capped` cases fail; drop the `null`
  check → the null case fails (the fake's `raise` records calls).
- [ ] **Adds** 8 node cases (`record-loop.test.ts`: 1 + 6 + 1) and 1 browser case (`worker.test.ts`'s order case).
- [ ] Held by: `worker.test.ts` ("replies to extend even when the run already ended", "answers extend on an rxm copy…",
  "rewinds each leg of a session…", "rewinds a λ, a TM and an rxm copy…", "stops the recording a rewind replaces…",
  "posts no result of its own, and an extend or a rewind the page cannot post records nothing"),
  `extend-during-recompile.test.ts`, `restart-rewind.test.ts`, `step-controls.test.ts`, `step-focus-recording.test.ts`,
  `readout-history-full.test.ts`, `examples.test.ts`.
- [ ] The three handles' comments ("for `TM_RECORDING`'s reason", the λ arm's six-line note in `onExtend`) collapse to one
  statement at the table; the comment guard decides whether enough went (Global constraints).
- [ ] Commit `web: legs record, extend and rewind through one table`.

## W3: one scratch request carrying its leg, one reset, one fresh-leg builder, and the copy build in a covered module

**Files:** `web/src/protocol.ts` (`RunRequest`), `web/src/session-client.ts` (`scratch`, `tmScratch`, `rxmScratch`
become one `scratch`), `web/src/scratch.ts` (the two request `switch (state.leg)`s become one call each;
`#pendingLegs`' switch goes), `web/src/record-loop.ts` (new: `resetRecording`, beside W2's `extendLeg` and `rewindAndRecord`), `web/src/copy-build.ts`
(new module: `claimLive`, `Occupant`, `liveHandle`, `CopyBuild`, `buildCopy`; its module doc says it holds the worker's
one-occupant rule and copy build, here for the reason `record-loop.ts`'s doc gives), `web/src/session-worker.ts`
(`onLambdaScratch`, `onTmScratch`, `onRxmScratch` become `onScratch`, one call into `buildCopy`; the four reset
prologues become `claimLive`; `Live`'s three scratch kinds become one), `web/src/sessions.ts` (`freshLeg`),
`web/src/main.ts` (the source entry's three `LegState` literals), `web/tests/node/record-loop.test.ts` (case 1),
`web/tests/node/copy-build.test.ts` (new: cases 2-8).

**Tests and probes that build or read the old request kinds** (checked: `grep -rnE "'(lambda|tm|rxm)-scratch'"
web/tests`, each hit read). Some hits name a session or a label, not a request. Those stay, and the counts below are
of request sites only.
- Renamed: `tests/node/scratch.test.ts` 22, `session-client.test.ts` 2 (plus the `tmScratch`/`rxmScratch` method calls
  at its four cases), `session-pool.test.ts` 1, `replies.test.ts` 1 (a posted request read back);
  `tests/browser/keystrokes-in-flight.test.ts` 11 (the `build` argument of its `settle` and its expected lists),
  `worker.test.ts` 6, `scratch-fork.test.ts` 1, `build-reply-fixture.ts` 1 (its `BUILDS` set of the three kinds
  becomes `'scratch'`). Where a test told the legs apart by the kind, it reads `leg` instead. That counts as a rename.
- Not requests, and they stay: `tests/node/sessions.test.ts`' 25, `panes.test.ts`' 5, the other 11 in
  `session-pool.test.ts` and `pool-isolation.test.ts`' 2 are session ids; `session-memory.test.ts`' 2 are its `Slot`
  ids; `view-title.test.ts`' 1 is a `SessionId`.
- **The probes that send a scratch request** (enumerated by the same grep; 3 files, no others):
  `rxm-copy-cost.test.ts` (its `clone` figure, `cloneMs({ kind: 'rxm-scratch', gen: 1, src: text })`),
  `tm-buffer-cost.test.ts` (its `clone` figure, `cloneMs({ kind: 'tm-scratch', gen: 1, src: text })`, and the doc line
  that spells that payload), and `tm-fork-cost.test.ts` (its `MessageChannel` post `{ kind: 'tm-scratch', gen: 1, src:
  text }`). Each becomes the request the app now sends, `{ kind: 'scratch', gen: 1, leg, src, step: 0 }`, written
  `satisfies RunRequest` so that `tsc` holds it to the protocol from now on. A probe must exercise what the app sends.
  Their wasm export calls (`rxmScratch(text)`, `tmScratch(text)`) stay. These probes post to their own workers and are
  untouched: `rxm-copy-memory.test.ts` (`{ src, caps }`), `buffer-affordability.test.ts` and its `affordability-*`
  workers. Z2 reads the probe diff.

**Interfaces:**

```ts
// protocol.ts: the RunRequest member replacing the three
| { kind: 'scratch'; gen: number; leg: Leg; src: string; step: number }
// session-client.ts
scratch(gen: number, leg: Leg, src: string, step: number): void
// sessions.ts
export function freshLeg<K extends Leg>(leg: K, bytes: number, status: LegAvailability): LegState<LegFrame[K]>

// record-loop.ts
/** Zeroes `recorded`, sets `allowance` to HISTORY_BYTES, clears `recording`, zeroes `epoch`, for every leg. */
export function resetRecording(worker: RecordWorker): void

// copy-build.ts: covered by node cases; the worker passes what touches `live`, `posted` and wasm handles
/** What claiming the thread touches in the worker. */
export type Claim = { ready: Promise<unknown>; dropLive(): void; forgetResult(): void }
/** The one reset before a build: wait for the module, drop the occupant, reset recording, forget the result parts. */
export async function claimLive(claim: Claim, worker: RecordWorker): Promise<void>
/** The worker's one occupant: its session, or one copy of one leg (a worker's own type may add fields). */
export type Occupant<S, C extends { [K in Leg]: unknown }> =
  | { gen: number; kind: 'session'; session: S }
  | { [K in Leg]: { gen: number; kind: 'scratch'; leg: K; session: C[K] } }[Leg]
/** What `leg`'s recording may step for `gen`: the session, or this leg's copy; `null` for another leg's copy. */
export function liveHandle<S, C extends { [K in Leg]: unknown }, K extends Leg>(
  live: Occupant<S, C> | null, leg: K, gen: number): S | C[K] | null
/** What differs by leg in building a copy. Every member calls wasm or sets `live`, so the entries stay in the worker. */
export type CopyBuild<M> = {
  build(src: string, step: number): { made: M | null; diagnostics: Diagnostic[] }
  free(made: M): void                          // a build a newer generation superseded; TM frees its value run too
  occupy(gen: number, made: M): void           // sets `live`
  compiled(gen: number, made: M): RunReply     // the leg's `*-scratch-compiled`, unchanged
  after?(gen: number): Promise<void>           // TM's `runValueLoop`
}
/** Claim, build, refuse or drop a superseded build, occupy, post the compiled reply, record, then `after`. */
export async function buildCopy<K extends Leg, M, H>(
  build: CopyBuild<M>, record: RecordLeg<K, H>, claim: Claim, latest: () => number,
  worker: RecordWorker, req: { gen: number; src: string; step: number }): Promise<void>
```

- [ ] `step` is sent for every leg and read by λ alone, as `scratch.ts`'s TM arm comment already says of the `step`
  parameter; that comment moves to the one call.
- [ ] **The flow moves to `copy-build.ts` (`resetRecording` to `record-loop.ts`); the worker keeps only what touches its state or a wasm handle.** `buildCopy`
  writes once the order that each of today's three handlers writes:
  1. `claimLive`;
  2. the build;
  3. `no-session` with its diagnostics when nothing was made;
  4. `free` when `latest() !== req.gen`;
  5. `occupy`;
  6. post `compiled`;
  7. `recordLeg(record, worker, req.gen, true)`;
  8. `after`.

  `onRun` calls `claimLive` too. **The one-occupant invariant** (the doc on `Live`: "`dropLive` empties it before
  anything else is built") becomes `claimLive`'s and `buildCopy`'s documented order, held by a node case. Kept in
  `session-worker.ts`, each for the reason given:
  - `live`, `posted`, `rewoundFrom`, `latest` and `ready`: the worker's state. Every handler reads them, and a record
    loop re-reads `live` at each yield.
  - `dropLive`: it frees wasm handles.
  - The `Claim` object (`dropLive`, and `forgetResult` clearing `rewoundFrom` and `posted`): it writes worker state.
  - `BUILD: { readonly [K in Leg]: CopyBuild<…> }`: each entry calls a wasm export (`lambdaScratchAt`, `tmScratch`,
    `rxmScratch`) or handle methods (`free`, the statuses, `tmProgram`, `tapeNames`, `rxmProgram`, `rxmValue`), or sets
    `live`. The compiled replies stay three kinds, because their payloads and their `replies.ts` arms genuinely differ.
  - `runValueLoop`: it steps the TM value-run handle and re-reads `live` at each chunk.
  - `onScratch`: one generic call, `buildCopy(BUILD[req.leg], RECORDINGS[req.leg], claim, () => latest, worker, req)`.
    The dispatch `switch (req.kind)` keeps `latest = req.gen` on the one `'scratch'` arm.
  - Each `RECORDINGS` entry's `handle`, now `(gen) => liveHandle(live, leg, gen)`: it reads `live`.
- [ ] `Live` becomes `{ gen; kind: 'session'; session: Session } | ScratchLive` with `ScratchLive = { [K in Leg]: { gen;
  kind: 'scratch'; leg: K; session: ScratchOf[K] } & (K extends 'tm' ? { value: TmValueRunHandle | null } : {}) }[Leg]`,
  or an equivalent the implementer finds simpler. It must stay assignable to `Occupant<Session, ScratchOf>`.
  Checked on a scratch file with the worktree's `tsc`, under `strict`, `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`:
  - The `ScratchLive` above, TM's `value` included, is assignable to `Occupant<Session, ScratchOf>`.
  - A call must give the type arguments, `liveHandle<Session, ScratchOf, K>(live, leg, gen)`. Inferred from `Live`,
    `liveHandle(live, 'tm', 1)` returns `unknown`.
  - `liveHandle`'s body needs one cast, `live.session as C[K]`, because `live.leg === leg` does not narrow a generic
    `K`.

  `liveHandle` keeps the "no such leg here" answer the arms' comment insists on. `dropLive` frees
  TM's value handle by `kind === 'scratch' && leg === 'tm'`. `onLambdaTree`'s guard becomes `liveHandle(live, 'lambda',
  req.gen) !== null`, which means "a session, or a λ copy".
- [ ] `freshLeg` builds `{ hist: new History<LegFrame[K]>(bytes), status, done: null, playing: false, epoch: 0, gen: 0
  }`. `main.ts`'s source entry takes `legs` from it for every leg (through `perLeg` and the existing `satisfies
  Required<SessionLegs>`; W4's `mapLegs` lands after this task); `ScratchBuffers.#pendingLegs` returns the one leg's record.
- [ ] Held by: node `scratch.test.ts`, `session-client.test.ts`, `session-pool.test.ts`, `sessions.test.ts`,
  `panes.test.ts`; browser `worker.test.ts` (the rxm copy cases, "rewinds a λ, a TM and an rxm copy…"),
  `scratch-fork.test.ts`, `tm-scratch-fork.test.ts`, `rxm-copy.test.ts`, `rxm-blank-copy.test.ts`,
  `tm-blank-buffer.test.ts`, `keystrokes-in-flight.test.ts`, `pool-isolation.test.ts`, `buffer-cool-warm.test.ts`,
  `scratch-app.test.ts`, `copy-edit-leaving.test.ts`.
- [ ] Node cases, case 1 in `record-loop.test.ts` and cases 2-8 in the new `copy-build.test.ts`, each with its sabotage (restore each from a saved copy, `cmp`). The fakes
  record calls into one log, as the `recordLeg` cases' fakes do.
  1. `resetRecording`: every leg's four fields after a reset of a worker whose fields were all set. Sabotage: skip
     `epoch` → fails.
  2. `freshLeg`: each leg's record is empty, unplayed, epoch 0, with the status given. Sabotage: `playing: true` →
     fails.
  3. `claimLive`: it awaits `ready`, then drops the occupant, then resets recording, then forgets the result. The log
     order is asserted, and the worker's fields are reset. Sabotage: drop the `dropLive()` call → fails.
  4. `buildCopy`, one occupant: the old occupant is dropped before `build` runs. Sabotage: run `build` before
     `claimLive` → fails.
  5. `buildCopy`, a refused build: it posts `no-session` with the build's diagnostics, and occupies, frees and records
     nothing. Sabotage: drop the `made === null` return → fails.
  6. `buildCopy`, a superseded build (`latest()` moved on): it frees what was made, and posts and occupies nothing.
     Sabotage: drop the `free` call → fails.
  7. `buildCopy`, a build that lands: `occupy`, then the compiled reply, then the first frames reply (its initial frame
     included), then `after`, in that order. Sabotage: call `after` before `recordLeg` → fails.
  8. `liveHandle`, one table over a session, each leg's copy, another generation and `null`, asked for each leg: the
     session for every leg, a copy for its own leg only, else `null`. Sabotage: answer a copy's handle whatever its
     leg → fails.
- [ ] **Adds** 8 node cases (1 in `record-loop.test.ts`, 7 in `copy-build.test.ts`; the list above) and 0 browser cases.
- [ ] Commit `web: one scratch request carrying its leg, one reset, one fresh-leg builder, and one copy build outside the worker`.

## W4: the `result` reply and its legs keyed by `Leg`

**Files:** `web/src/legs.ts` (`mapLegs`), `web/src/protocol.ts` (`ResultLegs`, `HeldLegs`, `keepDecided`,
`keepInFlight`, the `result` member), `web/src/session-worker.ts` (`postResult`, `PART`, `rewoundFrom`),
`web/src/replies.ts` (the `result` arm), `web/src/readout.ts` (`ProgramResult`'s `result` member;
`programResultRows`' `['rxm', 'tm'] as const`), `web/src/results.ts` (`resultRows`). Tests:
`tests/node/protocol.test.ts`, `results.test.ts`, `readout.test.ts`, `replies.test.ts`, `session-client.test.ts`,
`rxm-fixtures.ts`; browser `worker.test.ts`, `examples.test.ts`.

**Interfaces:**

```ts
// legs.ts: a table whose entries differ by leg in type, built by one rule
export function mapLegs<M extends { [K in Leg]: unknown }>(value: <K extends Leg>(leg: K) => M[K]): M
// protocol.ts
export type LegResult = { lambda: LambdaLeg; rxm: RxmLeg; tm: TmLeg }
export type ResultLegs = { [K in Leg]: LegResult[K] }
export type HeldLegs = { [K in Leg]: LegResult[K] | null }
| { kind: 'result'; gen: number; legs: ResultLegs }      // replaces lambda, rxm, tm at the top level
// results.ts
export function resultRows(legs: ResultLegs): Row[]     // LEGS.flatMap over a ROWS table keyed by Leg
```

- [ ] `keepDecided` and `keepInFlight` are each one `mapLegs` call (checked compiling in the scratch file of Global
  constraints). `rewoundFrom` is `perLeg(() => null)` typed `HeldLegs`. `ProgramResult`'s `result` member carries
  `legs`; `readout.ts` reads `r.legs.tm` where it read `r.tm`.
- [ ] `programResultRows` loops `['rxm', 'tm'] as const` for the "recording stopped at the history's budget" row; a new
  leg would be left out with `tsc` green. It becomes a `Record<Leg, boolean>` (λ `false`, rxm and TM `true`) named for
  what it decides, read in a `LEGS` loop. Find why λ is out (`git log -S` on that line) and put that reason on the λ
  entry; if no reason is found, say so in the task's report rather than inventing one.
- [ ] Held by: `protocol.test.ts` (`keepDecided`, `keepInFlight`), `results.test.ts` ("lists the legs in order, λ then
  rxm then TM"), `readout.test.ts`, `replies.test.ts`, browser `worker.test.ts` (the five cases from "keeps a decided λ value in the next result after a λ rewind" to "keeps the λ
  part a rewind found in the generation's first result…", and "posts a new generation's own rxm part…"), `readout-history-full.test.ts`, `readout-history-held.test.ts`,
  `inspector.test.ts`, `examples.test.ts`.
- [ ] A node case for `mapLegs`: entries in `LEGS` order, one call per leg. Sabotage: build from `LEGS.slice(1)` → it
  fails, and so do `protocol.test.ts`'s cases. Restore, `cmp`.
- [ ] **Adds** 1 node case (`mapLegs`'s) and 0 browser cases.
- [ ] Commit `web: the result reply's legs, and the rows read from them, are keyed by leg`.

## W5: the `compiled` reply carries statuses and programs keyed by `Leg`

**Files:** `web/src/protocol.ts` (the `compiled` member), `web/src/sessions.ts` (`TmCompiled`, `RxmCompiled`: their
text fields become one name), `web/src/session-worker.ts` (`onRun`'s post), `web/src/replies.ts` (the `compiled`,
`no-session` and `worker-error` arms), `web/src/share-positions.ts` (`reply[leg].available`), and every reader of the
renamed fields. `tmText` and `rxmText` occur in 9 files under `web/src` (checked: `grep -rlE 'tmText|rxmText'
web/src`): `copy-editor.ts`, `pane-host.ts`, `protocol.ts`, `replies.ts`, `rxm-seed.ts`, `session-worker.ts`,
`sessions.ts`, `tm-seed.ts`, `transport.ts`. In `protocol.ts` they are the `compiled` member's two fields and their
docs, which this task replaces. In `session-worker.ts` they are of two kinds:
- the wasm methods `tmText()` and `rxmText()` on the worker's `Session` type, their docs, and `onRun`'s calls of them.
  These **stay**: they are wasm-bindgen exports the Rust half keeps, and the Rust half renames nothing.
- `onRun`'s two locals and the `compiled` post's two fields. These become `programs.tm.text` and `programs.rxm.text`.

The test hits (9 files) are read the same way:
- A call of `session.tmText()` stays (`tm-fork-cost.test.ts`, `buffer-affordability.test.ts`).
- `copy-pin.test.ts`'s `tmText` is a local of its own, and stays.
- A field on a reply or an entry, and a comment naming that field (`rxm-copy.test.ts`, `tm-scratch-fork.test.ts`),
  is renamed. Tests: `tests/node/replies.test.ts`, `share-positions.test.ts`,
`session-client.test.ts`; browser `worker.test.ts` ("sends tmProgram and tapeNames once, on compiled", "sends the
program's rxm as text on compiled…"), `pool-isolation.test.ts`, `scratch-fork.test.ts`, `examples.test.ts`,
`link-hold.test.ts`, `tm-scratch-fork.test.ts`.

**Interfaces:**

```ts
export type LegStatus = { lambda: LambdaStatus; rxm: RxmStatus; tm: TmStatus }
export type LegProgram = { rxm: RxmCompiled; tm: TmCompiled }       // λ compiles no program a view seeds from
| {
    kind: 'compiled'
    gen: number
    statuses: { [K in Leg]: LegStatus[K] }
    programs: { [K in keyof LegProgram]: LegProgram[K] | null }
    declinedSpan: Span | null
    linkIndex: LinkIndexWire | null
  }
```

`TmCompiled` and `RxmCompiled` move to `protocol.ts` (one type on the wire and in the entry); `tmText`/`rxmText` become
`text`, and `TmCompiled` keeps `tapeNames` and `tmResultDecodable` (TM's alone). The spec writes `programs: {[L in
Leg]?: …}`; keying by `keyof LegProgram` makes the same map without a `lambda: never` member, and a new leg that
compiles a program still has to say so in `LegProgram`, where `tsc` then reaches every reader. Built in the worker
from the same `Session` calls as today; no Rust wire change.

- [ ] `onRun` keeps every guard as it is (`rxmProgram` and `tmProgram` asked only for an available leg, `forkable` before
  `tmText`, `rxmText` unguarded) and the transfer list unchanged; only where the values land changes.
- [ ] `replies.ts`: the `compiled` arm passes `reply.statuses` to `resetLegs` and each program to the existing
  `setTmProgram`/`setRxmProgram` (W6 replaces those); `no-session` and `worker-error` clear both.
- [ ] Held by the tests above and `share-positions.test.ts` (node and browser), `share-open*.test.ts`,
  `copy-beside-program.test.ts`, `tm-pane-follows-session.test.ts`, `rxm-app.test.ts`.
- [ ] Sabotage: in `onRun`, post `programs.rxm` as `null` when the leg is available → `worker.test.ts`'s rxm-text case
  fails. Restore, `cmp`.
- [ ] **Adds** 0 node and 0 browser cases.
- [ ] Commit `web: the compiled reply carries each leg's status and program under its leg`.

## W6: `SessionEntry` keyed by `Leg`, and one seed table for a view's program

**Files:** `web/src/sessions.ts` (`SessionEntry`), `web/src/replies.ts` (`setTmProgram`, `setRxmProgram`,
`storeAndSetProgram`; the copy arms that write `tmScratch`/`rxmScratch`), `web/src/main.ts` (the source entry's four
fields; the `tmProgramOf`, `tmScratchOf`, `rxmProgramOf`, `rxmScratchOf` deps), `web/src/scratch.ts` (the copy entry's
four fields), `web/src/pane-host.ts` (the four deps; `seedTmPane`/`seedRxmPane`; the seeding `switch`es in the rebind
path, the reseeding of slots, and the retire path, three of its six; the two seed calls in `applyLayout`'s creation
arms), `web/src/draw.ts` (the "unseen" seeding block), `web/src/tm-seed.ts`, `web/src/rxm-seed.ts`. Tests:
`tests/node/sessions.test.ts`, `session-fixtures.ts`, `replies.test.ts`, `scratch.test.ts`, `readout.test.ts`; browser
files that build entries or read these fields (grep `tmProgram|rxmProgram|tmScratch|rxmScratch` in `web/tests`, and
keep the hits that are wasm handle methods).

**Interfaces:**

```ts
export type LegReading = { rxm: RxmScratchReading; tm: TmScratchReading }   // a copy's retained status and value
// SessionEntry: replaces tmProgram, tmScratch, rxmProgram, rxmScratch
programs: { [K in keyof LegProgram]?: LegProgram[K] | null }
readings: { [K in keyof LegReading]?: LegReading[K] | null }
// pane-host.ts deps: replace the four
programOf<K extends keyof LegProgram>(session: SessionId, leg: K): LegProgram[K] | null
readingOf<K extends keyof LegReading>(session: SessionId, leg: K): LegReading[K] | null
// one seed per leg, the spec's Record<Leg, seed>; λ's entry does nothing (a λ view is told nothing of a program)
const SEED: { readonly [K in Leg]: (pane: LegPane[K], session: SessionId) => void }
```

`LegPane` maps each leg to its pane class (`LambdaPane`, `RxmPane`, `TmPane`); the `as unknown as TmPane` casts in
pane-host's seeding sites collapse into one cast inside the lookup.

- [ ] The rebind seeding `switch (entry.kind)`, the reseed `switch (p.kind)` and the retire `switch (p.kind)` become
  `seedPane(kind, pane, session)`; a `'source'` kind seeds nothing, as its arm does now. `applyLayout`'s creation
  `switch (l.pane)` stays (each arm calls a different constructor with different options, which is §5.2's to unify),
  and each arm's `seedTmPane`/`seedRxmPane` becomes the lookup.
- [ ] `draw.ts`'s block that seeds a TM or rxm pane `unseen` holds becomes one lookup over the pane's leg; its
  `setFocus`/`setLink` lines read focus links per leg and stay (links are §5.4's).
- [ ] `replies.ts`: `setTmProgram` and `setRxmProgram` become one `setProgram<K>(session, leg, compiled)` over the
  table; TM's fork-availability call stays TM's, as a step the TM entry adds.
- [ ] Held by: `sessions.test.ts`, `replies.test.ts`, `scratch.test.ts`; browser `tm-pane-follows-session.test.ts`,
  `live-views-bound*.test.ts`, `pane-kind-switch.test.ts`, `scratch-rebind-editor.test.ts`, `buffer-cool-warm.test.ts`,
  `rxm-copy.test.ts`, `rxm-copy-restore.test.ts`, `tm-buffer-restore.test.ts`, `tm-copy-value-readout.test.ts`,
  `parked-view-*.test.ts`, `hidden-views.test.ts`, `copy-beside-program.test.ts`.
- [ ] Sabotage: make `SEED.rxm` do nothing → a case where an rxm view rebound or created after its session compiled
  shows the listing fails (`rxm-copy.test.ts` or `pane-kind-switch.test.ts`; find which, and add one if none does).
  Restore, `cmp`.
- [ ] **Adds** 0 node cases, and 0 browser cases, or 1 if the sabotage finds none and one is added. The log line says
  which.
- [ ] This task is the largest; if it passes ~120 calls, land the `SessionEntry`/readers half and the seed half as two
  commits, the first with the seed sites reading the new fields.
- [ ] Commit `web: a session's programs and readings are keyed by leg, and a view is seeded through one table`.

## W7: the copy readout and its rows by table

**Files:** `web/src/readout.ts` (`LambdaCopyLeg`, `TmCopyLeg`, `RxmCopyLeg`, identical, become `CopyLeg`;
`lambdaCopyParts`/`Segments`, `tmCopyFacts`/`Parts`/`Segments`/`Row`, `rxmCopyFacts`/`Parts`/`Segments`/`Row` become a
`COPY_FACTS: { readonly [K in Leg]: (reading: …, leg: CopyLeg) => string[] }` and three generic functions;
`ProgramRecording`'s `rxm` and `tm` become `legs: { [K in Leg]?: RecordingLeg }`), `web/src/draw.ts` (the copy readout
`switch (entry.slot.binding.leg)` becomes one lookup; the source `recording` object), `web/src/main.ts`
(`copyHolds`: its TM and rxm arms become one; its λ arm, which shows the term's text, stays). Tests:
`tests/node/readout.test.ts`; browser `inspector.test.ts`, `inspector-phone.test.ts`, `tm-copy-value-readout.test.ts`,
`readout-history-*.test.ts`, `buffer-list.test.ts`, `copy-header.test.ts`.

- [ ] λ's facts keep their shape: `[reason]` when declined, else the reduction count and the stop reason, as
  `lambdaCopyParts` gives after the name. Each leg's unit word (`reduction`, `transition`, `instruction`) stays in its
  entry.
- [ ] Sabotage: swap the unit words of TM and rxm → `readout.test.ts` fails. Restore, `cmp`.
- [ ] **Adds** 0 node and 0 browser cases.
- [ ] Commit `web: a copy's readout and its row come from one table`.

## W8: the copy affordances: one detach for a program, one rule for an editor that leaves

**Files:** `web/src/pane-chrome.ts` (`PaneEvents.detachMachine` and `detachRxm` become `detachProgram`; `detach(step)`,
λ's, stays: it carries a step, as its doc says), `web/src/tm-pane.ts`, `web/src/rxm-pane.ts` (their `editCopy` reads
`on.detachProgram`), `web/src/transport.ts` (the TM and rxm spreads' `detachMachine`/`detachRxm` become one
`detachProgram` from `programs[leg]?.text`; `NO_TEXT` stays a table), `web/src/pane-host.ts` (`claiming`'s two spreads
become one; the custody `switch (p.slot.binding.leg)` in the removal pass becomes a lookup of an
`EDITOR_ON_LEAVE: Readonly<Record<Leg, 'hold' | 'destroy'>>`, λ `hold`, TM and rxm `destroy`, keeping the TM arm's
reason once at the table), `web/src/editor-custody.ts` (its comment names both handlers). Tests:
`tests/node/sessions.test.ts`; browser `rxm-pane.test.ts`, `tm-scratch-fork.test.ts`, `editor-custody.test.ts`,
`copy-edit-leaving.test.ts`, `parked-copy-*.test.ts`, `tm-pane-editor.test.ts`, `lambda-pane-editor.test.ts`.

- [ ] The link handlers (`linkState`, `linkInstr`, `linkLambda`) and the display handlers (`display`, `tmDisplay`) stay:
  links are spec §5.4's and views' settings §5.2's, both PR 4.
- [ ] Sabotage: set `EDITOR_ON_LEAVE.tm` to `hold` → `copy-edit-leaving.test.ts` or `editor-custody.test.ts` fails (the
  TM arm's comment names the leak a held TM editor causes; find the case that holds it, and add one if none does).
  Restore, `cmp`.
- [ ] **Adds** 0 node cases, and 0 browser cases, or 1 if the sabotage finds none and one is added. The log line says
  which.
- [ ] Commit `web: one detach for a machine's or a listing's program, and one table for an editor whose view leaves`.

## What stays a `switch`, ending in `unhandled` (the reviewer's checklist)

Arms that genuinely differ, kept so `tsc` names them for a new leg: `applyLayout`'s pane construction; `holdsEditor`
and `legOfPane` (over `PaneKind`, §5.3's); the three `*-scratch-compiled` replies and their `replies.ts` arms;
`copyHolds`' λ arm; `onLambdaTree` (λ only); `draw.ts`'s focus links and `link-wiring.ts`/`link-status.ts` (§5.4);
the per-language tables in `colour.ts` and `lsp-protocol.ts` (a grammar per language, not leg machinery);
**`tm-value` and `rxm-value`, and their `replies.ts` arms**, whose payloads differ beyond the leg (checked:
`protocol.ts`'s `RunReply`, `session-worker.ts`'s posts, `replies.ts`' `onScratchReply`):
- Payload: `tm-value` is `{ gen; run: ValueRun; value: Decoded }`; `rxm-value` is `{ gen; value: Decoded }`, with no
  run.
- When it is sent: `tm-value` streams after every `VALUE_CHUNK` of a TM copy's value run (`runValueLoop`); `rxm-value`
  answers a `[continue]` on an rxm copy (`onExtend`).
- What its arm does: the TM arm replaces the reading and coalesces its draw while `run.run` is `Running`; the rxm arm
  keeps a decided value against `Unfinished` (`keepDecidedPart`) and draws at once.

Both stay in `onReply`'s list of kinds that never reach the program's session. Z1 lists the
T and N sites left and names each one's reason against this list.

## Z1: the leg count after

- [ ] At the last code commit of both halves, `$R/leg-count/tsc-sites.zsh $W $R/leg-count/final` and `leg-names.py src
  --list >| $R/leg-count/final/names.txt`, with `pkg/` built from that commit.
- [ ] A table, base against final: T in `src` (sites, files), T in `tests` (sites, files), N (sites, files, families,
  lines), the union of files. Expect N to fall (the `<L>-frames`, `<L>_recording`, `record<L>`, `on<L>scratch`,
  `<L>-scratch`, `set<L>program`, `seed<L>pane`, `<L>programof`, `<L>scratchof`, `<L>copy*` and per-leg field families
  go or shrink to their table's file) and T to move toward table entries (TS2741) and away from cascades (TS2536,
  TS7053). Every family N still lists and every T site is named against "What stays a `switch`" or as a table entry.
  A T site with no reason is a finding for the whole-branch review.

## Task R9: §7.2 compile time and the wasm module's size

Run by the controller or one dispatch that does nothing else, in the same quiet-machine hold as the web half's §7.2
browser round (the controller asks the other sessions for a hold first). Base = `783af0e`; final = the branch head.
**R9's base and Z2's base are one base for the Rust figures.** Z2's base is W0's commit, and W0 touches no Rust.
Before the round, re-run W0's check: `git diff --quiet 783af0e <W0's SHA> -- crates Cargo.toml Cargo.lock
rust-toolchain.toml` exits 0. Any change there means stop and report.
Each side in a scratch worktree (`git worktree add --detach ~/temp/redextape-ir-wire-legs-ct-<side> <sha>`) with its
own `CARGO_TARGET_DIR=$HOME/.cache/redextape-ir-wire-legs-ct-<side>-target`; scripts and logs in
`~/temp/redextape-ir-wire-legs-record/r9/`. Remove both worktrees and target dirs after.

- **The probe**, written once to `r9/ct_probe.rs` (record its sha256), included in each side by appending one line to
  that side's `session.rs`: `#[cfg(test)] #[path = "<abs>/r9/ct_probe.rs"] mod ct_probe;` (identical bytes both sides).
  It is one `#[test] #[ignore] fn compile_time()` that reads `web/src/examples/*.rxt` (7 files, sorted) from
  `env!("CARGO_MANIFEST_DIR")/../../web/src/examples`, and for each file and each of `EncodingKind::Unary` and
  `Binary` compiles twice untimed, then 15 times timed by `Instant` around `Session::compile` alone (drop after the
  reading, `std::hint::black_box` the result), and prints `name enc median_us min_us max_us`, then one `total` line
  (sum of medians).
- **Build** each side once before the window: `cargo test --release -p redextape-wasm --lib --no-run`.
- **Run** ABBA, 4 pairs: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- taskset -c 8-15,24-31
  cargo test --release -p redextape-wasm --lib ct_probe -- --ignored --nocapture --test-threads=1`, with `uptime`
  before and after each run. The build must be a no-op inside the window (check `Compiling` is absent from each log).
- **The rule** (#160's): per figure, the median of a side's runs; flag a final median above base's by more than base's
  spread (largest less smallest). Any flag → a repeat round and the pooled comparison; a figure flagged after pooling
  blocks the PR until explained or removed. Expected: no slower; the session drops two lowerings and one desugar per
  compile (F3).
- **Native compile time, measured, not argued.** R2 routes `lower_program` through `lower_program_mapped`, which also
  builds the origins and the minted-node set that `lower_program` then drops. Native lowers through `lower_program`
  (`run_native_with`). Measure it with the harness's native 8-pair ABBA round, `~/temp/redextape-ab-harness/task13/b/`.
  Read its `README.md`, then `tasks/task-13b-brief.md` and `tasks/task-13b-report.md` for the usage and what the
  comparer prints.
  - **Adapt.** Copy `task13/b/` to `r9/b/`, `task13/cmp.py` to `r9/cmp.py` (`cmp2.py` imports it from its parent
    directory) and `task13/c/native-grid.py` to `r9/c/`. In every copied script that names
    `~/temp/redextape-ir-lowering-record` or `redextape-ir-s72` (checked: `ab2.zsh`, `run-unit2.zsh`,
    `build-harness.zsh`, `count.zsh`, `native-grid.py`'s `sys.path`):
    - `B=` and `T13=` name `r9/b` and `r9`;
    - `WT` names R9's `~/temp/redextape-ir-wire-legs-ct-<side>`, and `CARGO_TARGET_DIR` names that side's target dir;
    - drop the `TREE_SITTER` lines. They name the main checkout's `.tools/`, which this lane may not touch, and no
      crate's build reads `TREE_SITTER` (checked: `grep -rn TREE_SITTER crates/` is empty).
  - **Build**, before the window, under the heavy lock, with `LLVM_SYS_231_PREFIX=/usr`:
    1. Per side, `cargo build --release --example opt_report -p redextape-native --features llvm` (`task13/build.zsh`'s
       line), copied to `r9/bin/opt_report-<side>`.
    2. `zsh -f r9/b/build-harness.zsh`. It copies `src/ab_rows.rs` byte for byte into each side's
       `crates/redextape-native/examples/`, untracked, builds it and copies it to `r9/b/bin/`.
    3. `sha256sum` of the four binaries into `r9/b/bin/SHA256SUMS`, with paths relative to `r9/b`, because `ab2.zsh`
       checks it from there with `sha256sum -c` (exit 6 on a mismatch).
    4. Delete the untracked `ab_rows.rs` from both worktrees once the round is done.
  - **Run**: `zsh -f r9/b/run-unit2.zsh r1 8`, in the window, beside the `ct_probe` runs. That is 8 pairs ABBA, each
    slot running `opt` (`opt_report`'s whole grid), `iso` and `rot` (`ab_rows`), each process under `perf stat`,
    `taskset -c 8-15,24-31`, and the gate us+sy ≤ 20 and r ≤ 8. Expect a few minutes when quiet (`ab2.zsh` prints its
    estimate).
  - **Programs** (checked, `measure.rs`'s `CORPUS`): `loop1000000`, `sum30000`, `list30000`, `box30000` and
    `map30000`, each under cranelift and llvm at O0, O1, O2, O3, Os and Oz, so 60 rows. Each row has two timed
    figures and a size:
    - `compile` is `compile_runs`, codegen alone, from a program lowered once outside the clock. R2 does not reach it,
      so it is the control.
    - `compile+run` is `time_runs` → `run_native_with` → `lower_program`. It is the figure R2's route reaches.
    - Object bytes must be equal between the sides.
  - **Compare**:
    - `python3 -I r9/b/cmp2.py r9/b/rounds/r1`: the loop1000000 cranelift figures of every kind, with per-process
      `instructions:u` beside them.
    - `python3 -I r9/c/native-grid.py r9/b/rounds/r1`: every flagged figure over the whole grid, 120 per kind.

    The rule is #160's, as above. A figure still flagged after a repeat round and pooling blocks the PR until it is
    explained or removed. Report an `instructions:u` rise over 1% in `compile+run` even with no timing flag.
- **Size**, no gate (F8): in each side, `wasm-pack build crates/redextape-wasm --release --target web --out-dir
  <abs>/r9/pkg-<side>`; record `wc -c` and `gzip -c | wc -c` of `redextape_wasm_bg.wasm`. Explain any change over 1% of
  the raw size. Native object sizes are not reached by this half: R2 and R3's native snapshot and size tests hold them.
- **Worker boundary:** nothing this half does changes what crosses it: R7's bindings check holds the types, R8's
  browser leg the values.
- Hand to Z4 (the roadmap entry), under its §7.2 heading: the machine, the window, the load at each run, the
  commands, the probe's sha256, every figure with base and final medians and spreads, the flags, and the two sizes;
  for the native round, the binaries' sha256s, `cmp2.py`'s and `native-grid.py`'s verdicts (flags of 120 per kind) and
  the instruction counts.

---

## Z2: §7.2, no hot path slows (both halves)

Run by the controller or one dispatch that does nothing else, on a quiet machine, with the user's word on timing (#166's
D5). Base = W0's commit (the probe present, no code task of either half); final = the last code commit. W0 touches no
Rust (checked in W0's last step and again in R9), so for every Rust figure this base is R9's base, `783af0e`: the two
rounds share one base for the Rust half. Each side in its
own scratch worktree (`~/temp/redextape-ir-wire-legs-s72-{base,final}`) with its own `CARGO_TARGET_DIR`
(`~/.cache/redextape-ir-wire-legs-s72-{base,final}-target`); scripts, rounds and logs in `$R/s72/`.

- [ ] **Adapt the harness.** Copy `~/temp/redextape-ab-harness/task13/c/` to `$R/s72/c/`. In `ab3.zsh` and
  `run-unit3.zsh`, `C=` names `~/temp/redextape-ir-lowering-record/task13/c` and `wt()` names
  `~/temp/redextape-ir-s72-$1`, as does the build dir and `CARGO_TARGET_DIR` (checked); repoint all four. Its exit 6
  requires the two sides' probe wasm to differ, which holds only if the Rust half changed `redextape-wasm`'s build;
  confirm before the round and drop that check for the record probe if they are equal.
- [ ] **M-rxm-copy** (Rust half's rxm copy builds and runs): `ab3.zsh` as adapted, 8 pairs ABBA, `test:probe:rxm-copy`
  (`rxm-copy-cost.test.ts`, `rxm-copy-memory.test.ts`). Each side runs its own probe files, and **they differ by the
  scratch request's shape only**. Check that `git diff <base> <final> -- web/tests/browser/rxm-copy-cost.test.ts
  web/tests/browser/rxm-copy-memory.test.ts` shows only W3's change to `rxm-copy-cost.test.ts`'s `clone` payload
  (`{ kind: 'rxm-scratch', gen, src }` becomes `{ kind: 'scratch', gen, leg: 'rxm', src, step: 0 }`). Any other line is
  stop and report. A `clone` difference between the sides is then the protocol change's own cost (a request two fields
  longer), and it counts against §7.2 like any other figure. Being a probe edit does not exempt it.
- [ ] **M-record** (this half's worker and replies path, all three legs' recording, and the browser compile path's
  `compiled` latency): a copy of `ab3.zsh` as `ab-record.zsh` whose build step runs `pnpm run build:wasm` per side into
  that worktree's `pkg/` (sha256 of `pkg/redextape_wasm_bg.wasm` and the `.js` glue recorded and re-checked around each
  run, as `ab3.zsh` checks its probe wasm) and whose run step is `pnpm exec vitest run --project browser
  --reporter=verbose tests/browser/record-cost.test.ts` with `REDEXTAPE_PROBE=1`. 8 pairs ABBA. `git diff base final --
  web/tests/browser/record-cost.test.ts` must show only the renames that W1, W3 and W5 make to message kinds, fields
  and the scratch request. As with M-rxm-copy, a difference that the request's shape causes counts against §7.2.
- [ ] **Stepping**: the code W6 and W7 change runs on every step. W0's "Why it times stepping too" traces it:
  `transport.ts`'s `forward`/`back`/`toNewest` → `draw()`, and `player.ts`'s `tick` → `draw()` once per frame while ▶
  plays. In `draw.ts` that reaches the per-pane seed lookup, and `readout.show`'s `segments()`/`rows()` over
  `ProgramRecording.legs` and `COPY_FACTS`. So M-record's cases (e) and (f) are §7.2's stepping figures: ms per step
  for each leg's view, strip and inspector, the program and a copy, under the rule below.
- [ ] **The warm-buffer probe, once a side:** `pnpm run test:probe` (`buffer-affordability.test.ts`). It reads ring
  memory, not time; its readings must be equal between the sides (the frame types and byte charges do not change).
- [ ] **Slot for the Rust half's compile time:** R9's `Session::compile` probe and its native 8-pair round, run in the
  same window and unit; and the
  `compiled` latency figures M-record prints, which time the browser's compile path (`compile`, the statuses, the
  programs, the link index and their transfer) through the real worker.
- [ ] **The rule** (#160's, as #166 applied it): per figure, the median of a side's runs; flag a final median above
  base's by more than base's spread (largest less smallest); figures that must not vary (frame counts, reply counts,
  `done`, the probe's byte and instruction counts) equal across every run. A flag calls for a repeat round and the
  pooled comparison; a figure still flagged blocks the PR until explained or removed. The gate of `ab3.zsh` (vmstat
  `us+sy <= 20`, `r <= 8`, port 63315 free) and its CPU pin stay as they are.
- [ ] Record for the roadmap: the machine, the window, the load at each run, each command, each build's sha256, flagged
  figures with ratios, the median final/base ratio per figure.

## Z3: §7.3, the whole-branch gate, a walkthrough and a whole-branch review

- [ ] Each step in its own `systemd-run --user` unit with `MemoryMax=16G`, `MemorySwapMax=0` and `--setenv` for every
  variable it needs, heavy steps under the heavy lock and browser steps under both, each log in `$R/gate/` ending in
  its exit status:
  `scripts/check-all.sh --no-browser` (with `LLVM_SYS_231_PREFIX=/usr`); `scripts/check-all.sh --browser-only`;
  `cargo llvm-cov nextest --workspace --fail-under-lines 90`; `scripts/check-slow.sh`; the eight scans as #166's
  VERIFICATION runs them, `--self-test` then alone; `node scripts/check-comments.mjs --self-test`, then `--base 783af0e`
  (the merge base with `origin/main`); `scripts/check-licences.sh --self-test`, then alone, from `web/`; `pnpm install
  --frozen-lockfile`, `build:wasm`, `build:lsp-wasm`, `build:bindings`, `biome ci --error-on-warnings`, `typecheck`;
  `pnpm run test:coverage`, its four figures against the floors 95 / 89 / 97 / 97 and against W0's figures, none lower
  than its floor and the floors unchanged or raised; `pnpm run build:app`; the Docker image as CI builds it (`docker
  buildx build` on a `docker-container` builder if available, else `docker build`, said in the entry), run, and read
  `healthy`, HTTP 200 for `/`, the hashed JS and both `.wasm`.
- [ ] **The Rust half's checks at the head**, logged in `$R/gate/` like the rest:
  1. **Bindings against the one baseline.** Run `bash scripts/build-web-bindings.sh` (heavy lock), then `diff -r
     $R/bindings-783af0e web/bindings >| $R/gate/bindings.diff`. Pass when `cmp $R/gate/bindings.diff
     $R/bindings-r7.diff` exits 0 (the head's difference is R7's JSDoc-only change and nothing else), R7's
     JSDoc-strip loop over `web/bindings/*.ts` against `$R/bindings-783af0e` prints nothing, and `ls web/bindings | wc
     -l` is 29.
  2. **nextest per crate and feature set, each against the R tasks' expected figure.** A `ts` run sets
     `TS_RS_EXPORT_DIR=$PWD/web/bindings`, as `check-all.sh` does.

     | Crate | Default | Features (count) | From |
     |---|---|---|---|
     | `redextape-core` | 1319 | `serde` 1327, `ts` 1351 | R1: 1319, 1325, 1349 at `783af0e`, + 2 serde-gated |
     | `redextape-wasm` | 128 | `probe-no-tm-scratch-ceiling` 127, `probe-rxm-copy` 128; its `ts` feature is gone | R4 + 1, R8 − 1 |
     | `redextape-wire` | 1 | `ts` 12 | R7, R8 |
     | `redextape-native` | 75 | `llvm` 117, with `LLVM_SYS_231_PREFIX=/usr` | unchanged |

     Any other figure is a finding. Report it with the task whose figure it contradicts.
  3. **`scripts/check-all.sh --list`** prints 37 rows (36 at `783af0e`, checked). Four of them name `redextape-wire`:
     `base|clippy|-p redextape-wire --features ts --all-targets`, `base|test|-p redextape-wire --features ts`,
     `base|wasm|-p redextape-wire --lib` and `base|wasm|-p redextape-wire --lib --features ts`. None reads `-p
     redextape-wasm --features ts`. In the `check-all.sh --no-browser` log above, each of the four wire rows ran and
     passed.
  4. **CI picks the crate up.** `.forgejo/workflows/ci.yml` keeps no crate list of its own (checked). Read it for
     these, and say in the log where each one is:
     - The `rust` job runs `./scripts/check-all.sh --no-llvm --no-browser`, which carries the wire rows (base tier).
     - The same job runs `cargo llvm-cov nextest --workspace --fail-under-lines 90`, which counts the crate once it is a
       `Cargo.toml` `members` entry. `crates/redextape-wire/src/lib.rs` appears in this gate's `cargo llvm-cov` report.
     - `rust-scoped`'s `scripts/check-scoped.sh` maps `crates/<dir>/…` to `-p <dir>`, so the package name must equal
       its directory name, `redextape-wire`.
     - The `web` job's `pnpm run build:bindings` runs `build-web-bindings.sh`, whose second leg is now `-p
       redextape-wire`.
     - The same job's `../scripts/check-licences.sh` runs `web/scripts/licences.ts`, whose `cargo tree` over
       `WASM_CRATES` (`redextape-wasm`, `redextape-lsp-wasm`) reaches the wire crate as a path dependency and skips it
       as redextape's own (`source` is null).
     - The comment-guard step reads `scripts/comment-budget.json`'s `crates/redextape-wire` entry.
     - The scans read tracked files and list no crate. `check-doc-figures.sh`'s `wasm_exports` counts the
       `#[wasm_bindgen]` names in `crates/redextape-wasm/src/lib.rs`, and R8's move of the private `to_value` leaves
       that count as it was.
     - The `docker` job's `Dockerfile` copies `crates/` whole.
- [ ] `check-all.sh` needs tree-sitter 0.25.10. The worktree has no `.tools/` (checked); #166's gate pointed
  `TREE_SITTER` at the main checkout's copy, which this lane may not touch. Install it into `$W/.tools/` with the
  commands `scripts/setup-dev.sh` runs for it (its tree-sitter section), and confirm `.tools/tree-sitter --version`
  reads 0.25.10.
- [ ] Two load-dependent failures #160 recorded may recur: `test:coverage`'s "Failed to fetch dynamically imported
  module" and `session-memory.test.ts`'s "measures what a leg of history really costs…" under a 1-minute load above
  30. A failure of either is re-run once at a lower load and reported with both loads, never retried silently.
- [ ] **The walkthrough**, by the controller's browser driver against a dev server from `$W/web` (its own port; not the
  main checkout's server), each step's expected outcome read from the page, a screenshot per item into `$R/walk/`:
  1. Every entry of the examples menu: each leg's results row and readout match `examples.ts`' `outcomes` and `value`.
  2. Each leg's run: ▶ to the end, ◀ and ▶ single steps, ⏭, and `back to step 0` in each view (its leg alone rewinds,
     the other views keep their steps).
  3. Extend: a `capped` stop on each of λ, TM and rxm continues further; a `budget` stop (fact-12's λ and TM) records
     further on continue; a `stack-full`/`heap-full` rxm stop offers no continue.
  4. Copies: a λ copy at a later step (*edit a copy*), a TM copy of the machine, an rxm copy of the listing, each records
     and steps; edit each and see it rebuild; an edit that does not parse reads `did not build` and the notice ends once
     it builds; blank TM and rxm copies from the buffer list; switch a view between the program and a copy and back (the
     TM and rxm views reseed); close a view holding a copy's editor (λ's is kept for the next view, TM's and rxm's are
     destroyed and a remaining view of that copy mounts one).
  5. Share links: copy a link at mid-run positions in each view, open it in a new tab, each leg continues to its step.
  6. Link highlighting: a click in the source highlights the λ term, the TM states and the rxm instructions; a click on
     an rxm instruction and on a TM state links back to the source; a copy's views read `not linked`.
  7. The results panel and the inspector at desktop and phone widths, for the program and for each kind of copy.
- [ ] A whole-branch review of both halves before the roadmap entry is final (#166's practice; clean task reviews are its
  precondition, not its substitute).

## Z4: the roadmap entry

- [ ] Last in `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, in the #166 entry's shape: a heading that says
  what shipped; the opening paragraph (spec sections, plan path, the user's decisions with their dates, commit counts,
  the lane record); WHAT SHIPPED, TASK BY TASK (each task's SHA); THE LEG COUNT (Z1's table, base and final, citing this
  plan's "The leg count" for the method and naming the two commands; the comparison with §2.4's ~60 by file count only);
  THE §7.2 MEASUREMENTS (R9 and Z2); WHAT THE PLAN STATED THAT NO GATE HELD; WHAT THIS DID NOT CLOSE (at least: links,
  displays and pane construction left per-leg for PR 4; `PaneKind` still a literal union; any T site Z1 could not name a
  reason for; whatever Z2 and Z3 leave open; and the Rust half's items:
  - the later comment pass that trims the history in `redextape-wire`'s moved docs (the user's decision on Q1,
    2026-11-06). Its bindings difference will be JSDoc only, and the crate's budget then falls with it;
  - each compile still builds the TM machine twice (`lower_tm_guarded` in the run, `lower_tm_mapped` in the map's TM
    half) and lowers λ twice (`lambda::lower` for the leg, `lambda::lower_mapped` for the map). §4.4 asked for Core →
    rxm once only ("Observations outside §4.4");
  - R8's sabotage 2 (`serialize_missing_as_null(false)` in `to_value`), if it did not fire: the serializer's one rule
    is then watched by no test;
  - any of R2's or R5's watch sabotages that found a surface no test reaches);

  VERIFICATION, every figure with the command that produced it.
- [ ] Every count in the entry is anchored to a SHA and written after the last code commit; the entry is the last commit.

## Spec coverage, Rust half (§4.4)

| Spec item | Task |
|---|---|
| `RunStatus`, `Decoded`, the status structs, `decoded_*`/`grouped`, `to_value` out of `redextape-wasm` into a place a second wasm crate can depend on (RD1, RD2, RD3) | R7, R8 |
| ts-rs bindings from one place, unchanged | R7 (bindings byte-identical; JSDoc-only doc-word commit) |
| `Program`, `Instr`, `Reg`, `BinOp`, `Caps` serde behind core's `serde`, round-trip test | R1 |
| One TM cursor → `RunStatus` mapping | R5 |
| One scratch prologue | R6 |
| One lowering per compile; equality test kept where callers lower separately | R2, R3, R4 (F5) |
| A Rust leg trait only if simpler (RD4: none) | — |
| §7.2 compile time; wasm size | R9 |

## Spec coverage, web half (§5.1) and the gates (§7.2, §7.3)

| Spec item | Task |
|---|---|
| One `{kind: 'frames', leg, …}` reply and a frame-bytes table keyed by `Leg`, used by the worker and `replies.ts`; each leg keeps its encoding and transfer list | W1 (`LEG_FRAME_BYTES`; no transfer list added) |
| `RECORDINGS` table; `RecordLeg` gains the raise-cap rule; `onExtend` one lookup; `onRun` loops over legs; per-leg logic outside `session-worker.ts` | W2 (`extendLeg`, `rewindAndRecord` in `record-loop.ts`) |
| One scratch request carrying `leg`; one reset helper; the four reset prologues go | W3 (`resetRecording` in `record-loop.ts`; `claimLive`, `buildCopy`, `liveHandle` in `copy-build.ts`; the probes send the new request) |
| `compiled`, `result`, `SessionEntry` keyed by `Leg` (`programs`); a `Record<Leg, seed>` | W5, W4, W6 (`SEED`) |
| `pane-host.ts`, `draw.ts`, `transport.ts`, `scratch.ts`, `pane-chrome.ts`, `readout.ts`, `results.ts`: lookups where arms differ only by leg; genuine switches stay, ending in `unhandled` | W3, W4, W6, W7, W8; "What stays a `switch`" |
| §2.4's `tm-value`/`rxm-value` replies | stay per-leg: their payloads differ beyond the leg ("What stays a `switch`") |
| "Done when": the leg count, recorded against §2.4's ~60 | W0 (base), Z1 (final), Z4 |
| §7.2 browser rxm stepping and recording | W0 (`record-cost`), Z2 (M-record, M-rxm-copy, warm-buffer once a side) |
| §7.2 native runtime calls; native compile time | R9: `Session::compile` time, and the harness's native 8-pair round over `measure.rs`'s `CORPUS` (`compile` and `compile+run`, base against final) |
| §7.2 browser stepping | W0's cases (e) and (f) (the per-step `draw()` path W6 and W7 change), run by Z2's M-record |
| §7.3 full `check-all.sh`, browser tier, coverage floors | Z3 |
| §7.3 walkthrough after PR 3 | Z3 |

## Questions for the user (Rust half), answered

- **Q1. The wire crate's comment budget. ANSWERED 2026-11-06:** the measured share after the verbatim move is the
  budget; R7's move check stays byte-identical; trimming the moved docs goes to a later comment pass (Decisions; R7;
  Z4). The question as asked: its docs move verbatim so the bindings stay byte-identical, which puts its comment share
  well above every crate's but `grammar-check`'s (roughly 0.6-0.7 by a line count); the alternative, not taken, trimmed
  them in R7 and made R7's bindings check JSDoc-only.

## Observations outside §4.4 (not planned)

- Each compile still builds the TM machine twice, in the run (`lower_tm_guarded`) and in the map's TM half
  (`lower_tm_mapped`), and lowers λ twice, for the leg (`lambda::lower`) and the map's λ half (`lambda::lower_mapped`).
  §4.4 asks only for Core → rxm once.
