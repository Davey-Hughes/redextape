# Firefox PR 2: tab contention — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a full `pnpm test:firefox` run fails nothing outside the one-tab set R: the capture files run one at a time
in a Firefox of their own beside the rest, a guard fails a file that captures off the list, two checks hold the
split's premises, and the test frame is given the focus at each file's start and before a `focus()` it would ignore.

**Architecture:** `vite.config.ts` builds two Firefox projects from `browserProject`: `firefox`, the rest, which
`test:firefox` runs at 6 tabs (the user's R6), and `firefox-capture`, the files on `CAPTURE_FILES` with
`browser.fileParallelism: false`, each with its own `playwright()` and so its own browser. A new setup file,
`tests/browser/firefox-input.ts`, second of three and installing no wrapper, hook or command call in Chromium, holds
the capture guard, the frame's focus at each file's start, the frame-focus step, the browser registration and the
one-at-a-time check; its node side is four commands in the config.
`tests/firefox/` holds the two self-tests.

**Tech stack:** Vitest 4.1.12 browser mode, `@vitest/browser-playwright` 4.1.12, Playwright 1.64.1 (Firefox
`firefox-1555`), TypeScript, Biome 2.6.4.

**Spec:** `docs/superpowers/specs/2026-11-04-firefox-pr2-tab-contention-design.md` at `0a1ad67` (approved by the user
on 2026-11-04; `67b81cc` records his ruling "Blocks now" on ruling 5, `f22e855` the corrections of fact from this
plan's probes, `355c4df` the pre-flight round's: the `aroundAll` span, his "Yes, every run", whole-file failures in R
and C1, S3's three and S10; `0a1ad67` his R6 after Task 2's STOP: the rest at 6 tabs, cause 3 and Task 2's 32 cases
under it). Section numbers below (§4.3, C1, S5, F3) are the spec's.

## Global constraints

- Work only in `~/temp/redextape-firefox-contention` (branch `firefox-contention`). Never edit or build in
  `/home/davey/projects/redextape`.
- `export CARGO_TARGET_DIR=$HOME/.cache/redextape-firefox-contention-target` in every shell that builds or commits: the
  pre-commit hook's `web-typecheck` runs `build:bindings`, a cargo build.
- Heavy runs (the wasm and bindings builds, `pnpm run typecheck` and `pnpm test`, which both run the bindings build,
  `test:coverage`, `build:app`, a commit that touches `web/`) under `flock ~/temp/redextape-heavy.lock`; every browser
  run under `flock ~/temp/redextape-browser.lock`, the heavy lock outside the browser lock when a run needs both. Other
  lanes share both locks.
- Browser tabs are set with `VITEST_MAX_WORKERS=N`, never `--maxWorkers` (it does not reach browser tabs). `-- <name>`
  does not scope files: name the files.
- Where a test claims a user path, real gestures, never synthetic `.click()` or `dispatchEvent`. The reported-id
  sites of PR 1's Task 3 stay synthetic by the user's U2 ruling, and each already says why the driver cannot carry it.
- No numeric `until` timeouts in browser tests, and no wait of a file's own: every wait is `until` at its default,
  `engine.ts`'s included (`until` lives in `until.ts` since PR 1).
- Sabotages run in the scratch worktree `$S` (below), with `node_modules`, `pkg`, `pkg-lsp` and `bindings` COPIED,
  never symlinked. Before each, save a copy of the file to `$R/sab/`; after, restore it from that copy, then
  `cmp` it with the saved copy and with `git -C $S show HEAD:<path>`. Never `git checkout` to restore.
- The pre-commit hook on every commit (Biome, the eight scans, the licence check, the comment guard, typecheck);
  never `--no-verify`. Format with `pnpm exec biome format --write <files>` before committing.
- A comment says why: no history, no measurements, no `file:line` in tracked source, no block over 8 counted lines
  of text, and `collect.ts`'s doc block does not grow. TypeScript docs use `/** */`. If the guard reports
  `web/tests` over its share, raise `scripts/comment-budget.json` to the value it reports, in the same commit.
- The Bash tool is zsh: `noclobber` is on (write logs with `>|`), and there is no word splitting.
- Nothing is pushed. Each task ends in its own new commit; a fix found later is a new commit, never an amend. Tasks 1,
  2 and 8 measure and commit nothing unless a step says so: their output is the record.
- No `src` change (A3), no CI change (A1), no tolerance, engine-difference or caret fix (A2), no vitest internals
  (A4), and Chromium runs as today (A5).

## Names used below

- `W=~/temp/redextape-firefox-contention`, the worktree. `S=~/temp/redextape-firefox-contention-sab`, the scratch
  worktree Task 3 makes. `R=~/temp/redextape-firefox-ci-record`, the record.
- `$R/scripts/pr2/run.sh <label> <tree> <script> [vitest args]` runs `pnpm run <script>` from `<tree>/web` in
  `systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0`, with `--reporter=verbose --reporter=json`, and
  writes `$R/logs/pr2/<label>.log` and `.json`. `test:firefox`, `test` and `test:coverage` take the heavy lock outside
  the browser lock; `test:browser` the browser lock alone. The log's `lock=` line has the 1-minute load at the lock,
  its `EXIT=` line the load at the exit. Environment: `TABS=N` (sets `VITEST_MAX_WORKERS`, which wins over the 6 that
  `test:firefox` gives the rest from Task 3 on; without `TABS` a run passes none), `CONFIG=<file under web/>`
  (passed as `--config`), `SAMPLE=1` (writes `<label>.mem.tsv`, the scope's `memory.current` every 2 s), `PROPS='-p
  CPUQuota=50%'` (systemd properties), `LOGDIR=<dir>`; `PR2_*` variables pass through to the probe config. It sets
  `REDEXTAPE_FIREFOX=1` for `test:firefox`, prints the summary lines and exits with pnpm's status. Never `run.sh … test`
  in `$S`: `test` builds the bindings.
- `python3 -I $R/scripts/pr2/targets.py [--r <label>]… [--floor N] [--tabs default|3] [--config <file>] <label>…` writes
  `<label>-failures.tsv` beside each run's JSON (file, full name cut at 110 characters, first error cut at 220, the form
  `beyond.py`, `diag.py` and `cluster.py` read) and prints, per run: the counts; each file-level failure; C1, the
  failures outside R, tests with their kind and whole files (`FILE` lines), and C2, the drag-kind among them; C7, T3's
  37 cases; C8, the guard's failures; C9, the one-at-a-time check's; F4, the two self-tests; the focus-kind failures
  (`diag.py`'s `FOCUS` pattern); C4, each group's files, peak in flight and span; C5, the wall time from the lock to the
  exit, and C6, the scope's memory peak. Firefox's JSON failure messages hold only the stack, so each error is read from
  the log. It exits 1 on a miss of C1, C2, C7, C8, C9 or F4, of C3 with `--floor`, of C5 and C6 with `--tabs`:
  `--tabs default` holds a run to 300 s and 8 GiB, read since R6 for `test:firefox`'s own count, the rest at 6 from
  Task 3 on, and `--tabs 3` to 450 s and 4.5 GiB (spec §6.3). **A run
  that does not hold both self-tests reads F4 `NOT met`, and one that does not run all of T3's 37 cases reads the
  missing ones `not run` in C7; either alone makes it exit 1,** so a step reads its lines, and expects exit 0 only where
  it says so. The capture list is read from `--config`'s `CAPTURE_FILES` (default `$W/web/vite.config.ts`; at the base,
  D's 7 and step-focus-recording). The version this plan uses is `$R/scripts/pr2-planfix/targets.py`, which Task 3 Step
  1 installs: it reads R's whole files from the `--r` runs and counts a whole-file failure outside them in C1
  (`$R/logs/pr2-planfix/targets-new.out`); the plan writer's version counted tests alone in C1.
- `python3 -I $R/scripts/pr2/errdiff.py A B` (Task 3 Step 1 installs it from `$R/scripts/pr2-planfix/`) lists run B's
  failures that run A's `-failures.tsv` lacks (NEW) or holds with another first error (DIFF), by file and name: a
  failure a change causes in a test R already holds shows as DIFF, which C1 cannot see.
- **R, the one-tab set** (§6.2): `RSET=(--r tabs1-1 --r focusobs-1 --r t1-base-1tab)`, the union of M1's `tabs1-1`,
  M2's `focusobs-1` and Task 1's one-tab base run, by file and name, and by file the files that fail as a whole in
  them (share-open-deep's "InternalError: too much recursion" alone). Every `targets.py` call below passes `$RSET`.
  Beside it, `targets.py`'s `R_BY_SHAPE` adds to R, until PR 4, a view-keys failure whose first error has the caret
  at offset 0, keys typed there or the caret read there, not where it was; a view-keys failure of any other shape
  stays outside R (spec §6.2).
- **The outside-R record,** `$R/tasks/pr2/outside-r.md` (ruling 5, "Yes, every run", spec §6.2). From Task 2 on, each
  failure outside R in a task's run, a test or a whole file (`targets.py`'s C1 lines), is a line there: the task, the
  run's label, the file, the test or `FILE`, the first error, and its alone run's label and outcome. The alone run is
  made at once, at that commit: `TABS=1 run.sh <label>-alone-<k> <tree> test:firefox <file> -t '<title>'`, the whole
  file for a chained file (spec §3.6) or a whole-file failure. **One that fails alone is that task's regression: the
  task STOPS and reports it.** One that passes alone is Task 10 Step 6's, which finds its cause. Not recorded: Task
  1's base runs, one shared Firefox at `ec4f11a`, whose failures outside R are cause 1's (spec §6.2), and the
  sabotages' runs, whose failures are made on purpose. Measure 3's R6 runs (`M3` rows) and the R6 update's probes
  (`R6` rows, `$R/logs/pr2-r6/`) are on it too: four view-keys failures in the capture project, two cases, each
  passing alone. **Task 2's rows, 32 distinct cases, take cause 3** (spec §3.8, §6.2; the user's R6): no
  cause-finding each; Task 10 Step 5's runs test it, and a case of them that fails there is a row of Task 10's, with
  its own cause-finding.
- `$R/scripts/pr2/capdiag.py <label>` reads `capture-diag.ts`'s lines; `peaks.py`, `beyond.py`, `diag.py` and
  `$R/scripts/cluster.py` as the spec's §6 says.
- The probe config, `$R/pr2/untracked/web/vite.probe.config.ts`, with `tests/zz-pr2/` beside it (M2's): copied into
  `$W/web/` for a run that needs it and removed after, since the comment guard reads untracked files. `git -C $W
  status --porcelain` is empty after each such run.
- **The 16 focus files**, M2's (spec §3.4): `F16=(view-keys view-keys-focus storage-blocked vim-keymap lsp-hover
  about-menu state-diagram-no-machine lambda-display focus live-views-bound-switch notice view-toggles lambda-follow
  focus-handoff tm-pointer four-views-fixture)`, each `tests/browser/<name>.test.ts`.
- **The tab-count files** (the R6 probe, `$R/tasks/pr2/r6-update.md`): `TC=(readout-history-held
  lambda-copy-typed-text keystrokes-in-flight parked-view-state tm-pane-follows-session running-focus
  share-through-open hidden-views pool-isolation parked-view-state-restore rxm-app program-quota-return
  tm-blank-buffer active-pane stage-copy-editor worker panel-regions view-keys divider-drag-format-on-blur)`, 16 rest
  files and 3 capture files, each `tests/browser/<name>.test.ts`. `python3 -I $R/scripts/pr2-r6/inflight.py --logdir
  $R/logs/pr2 <label>…` prints each project's files, peak in flight and span, from the run's JSON and its log's
  project tags, and the seconds both projects had a file in flight.
- From Task 3 on, a run at `TABS=1` still runs the two projects side by side, a tab in each Firefox (`r6-tabs1`): a
  full one-tab run is 1 + 1. A run that names one file runs one project.
- A run's verbose log tags a test `|firefox (firefox)|` or `|firefox-capture (firefox)|`, and marks a skip `↓`, a
  pass `✓` and a failure `×`. Vitest names each project by its instance, `firefox (firefox)`, so that is also what a
  command's `ctx.project.name` reads.

## What the plan rests on (probed 2026-11-04)

The probes ran in `$W` at `67b81cc`, whose `web/` is `ec4f11a`'s, with the drafts of this plan's files as untracked
files at their final paths and the config as an untracked `web/vite.plan.config.ts`; they were moved to
`$R/scripts/pr2-plan-probes/` after, and `$W` left clean. The logs are in `$R/logs/pr2-plan-probes/`, and
`$R/scripts/pr2-plan-probes/README.txt` gives each command. The drafts are this plan's code. The pre-flight round's
probes ran the same way in `~/temp/redextape-firefox-planfix`, a worktree of `c44d793` (`web/` as at `ec4f11a`), from
`$R/scripts/pr2-planfix/` (its `README.txt` gives each command), with logs in `$R/logs/pr2-planfix/`; the tree was
left clean after each.

- **The shape types and lints** (`tsc-1.log` to `tsc-6.log`, `biome-ci-4.log`): with `CAPTURE_FILES` exported, the
  options parameter, `commands: Record<string, BrowserCommand<never[]>>` (which takes commands with arguments and
  `requestGC` alike), the four commands typed `BrowserCommand<[…]>`, `fileParallelism` set only when given (the config
  has `exactOptionalPropertyTypes`), the `BrowserCommands` and `ProvidedContext` additions, `firefox-input.ts` and the
  three test files, `tsc --noEmit` reports nothing and `biome ci --error-on-warnings` passes. Neither warns on the
  deprecated `browser.fileParallelism` (§9's question).
- **The two projects run together, each with its browser** (`pA2.log`, `pFinal.log`): both tags print, the capture
  project's files ran one at a time, and `two-browsers.test.ts` passed (905 ms in `pFinal`): its own-browser decoy
  `{ decoyClicks: 0, decoyAlone: 1 }`, the rest's `{ 1, 1 }`, 6 moves heard, 2 browsers. A run of one rest file
  (`sS1.log`) leaves `firefox-capture` with no file and reports no error for it.
- **Vitest names the projects `firefox (firefox)` and `firefox-capture (firefox)`** (`pA.log`): a lookup of the
  rest's browser under `'firefox'` found none and the case timed out. The rest's browser is the one registered under
  the name that is not the caller's.
- **A test file's import of `firefox-input.ts` evaluates a second instance** (`pA2-span.log`):
  `two-browsers.test.ts`'s span began and ended twice. So the guard's records live on the frame's `window`, and only
  the first instance in a page wraps and registers hooks.
- **The span needs an `aroundAll`** (`pA2-span.log`; the fix round's `pf-*`, six capture files in an order a probe
  sequencer fixed): a setup file's `beforeAll` runs before the file's own and its `afterAll` after (Vitest's
  `sequence.hooks` default, `'stack'`), and a file whose own `beforeAll` throws still runs both `afterAll`s; but a
  file whose own top-level `afterAll` throws or times out ends the hook list, so an `afterAll`'s `'end'` was never
  sent and each of the 5 files after failed "began while" (`pf-afterall`). With the span in the setup file's
  `aroundAll`, the outermost hook of a file, every span began and ended, the three files whose own hooks threw or
  timed out failed on their own errors, and the three after them passed (`pf-around`); with `fileParallelism: true`,
  3 of 8 capture files failed "began while", each naming another then in flight by its path from `web/`
  (`pf-around-s8`); `tsc` and Biome pass over it (`tsc-around.log`, `biome-around.log`). `ctx.testPath` in the
  command equals the page's `expect.getState().testPath`: the check's precondition passed in every capture-project
  file.
- **Every sabotage fires as the spec names it** (`chain-sab.out`): S1 fails view-keys' hint case with the guard's
  message, on `div.layout-divider (real input)` (`sS1.log`); S2 fails `two-browsers.test.ts` at "the guard recorded the
  real presses’ captures", and S1's command then passes the hint case, 19 failed against S1's 20 (`sS2.log`,
  `sS2-s1.log`, both with Task 6's step in place, under which view-keys' "arms on the prefix …" passed); S4 fails it at
  the rest's decoy, `decoyClicks: +0` (`sS4.log`); S6 at the wait for the rest's registration (`sS6.log`); S8 fails 4 of
  the 5 capture-project files of a 6-file run with "began while … had not ended", the fifth failing only its scroll
  case, in R (`sS8.log`); S3 fails both `frame-focus.test.ts` cases at `activeElement` (`sS3.log`); S9 the second alone
  (`sS9.log`); S7 fails the list's node test naming the misspelt path (`node-list-s7.log`); S5 fails the widened scan
  with `engine.ts:54 passes 10_000` and passes the scan as it is (`inv-wide-s5.log`, `inv-base-s5.log`); S10, a file of
  the rest whose `beforeAll` takes a real capture, fails at the guard's `afterAll` with its message, its precondition
  case passing (`pf-hookcap.log`).
- **Whole-file failures** (`targets-new.out`, the planfix `targets.py` over copies of D's three runs and Task 1's two
  default runs): share-open-deep fails as a whole ("InternalError: too much recursion") in every run of the record that
  ran it, the one-tab ones included, so it is in R's files; `t1-base-default-1`'s divider-drag-format-on-blur failed
  as a whole (a lost `beforeAll` click, cause 1), which the plan writer's C1 did not count and this one does.
- **The 8th capture file** (`capdiag-sfr.log`, M2's instrument in A's mode): step-focus-recording took 2 real
  captures, both held, on `div.layout-divider`, in "⏭ waiting through a divider’s drag …". Task 1's whole-tier run
  confirms that no other file does.
- **The step on every `focus()` leaves §3.4's five** (`p16-step.log`, the 16 files in one tab, the drafts in place):
  25 failed, 138 passed, 3 skipped (M2: 36 without a step, 27 with the first-call step); 0 outside R; the focus-kind
  failures are lambda-display's, live-views-bound-switch's, view-keys-focus's and view-toggles' cases of §3.4's table,
  and about-menu's fails on "expected `<a …>` to be `<button …>`", which `FOCUS` does not match. That is its last
  assertion, the focus back on its button after Escape, and its first error is `<a …>` in some runs and `<body>`,
  which `FOCUS` matches, in others, each with and without a step (§3.4; fix round A). Task 8 starts from these five.
- **parked-copy-editor-mount passes alone** (`pcem-alone-1.log`: one tab, 915 ms). Its duration across M1's and M2's
  16 runs with the file (their JSONs) spans 1,090 ms to 17,408 ms. It failed in four, three of them at or past the
  15,000 ms test timeout: `d-split-2` at 17,408 ms on `locator.click: Timeout 680ms` at its `clickToggle('tm')`,
  `default-1` at 15,578 ms, `e2-serial-1` at 15,292 ms ("Test timed out"); `diag-default-1` at 9,599 ms on an
  assertion of the views on the page. `d-split-1` took 5,286 ms, `d-split-tabs3-1` 2,150 ms.
- **The timeout scan widened** (`inv-wide.log`): every `.ts` module under `tests/browser/` and `tests/firefox/`, with
  `until.ts` left out of the re-declaration check alone, passes its 15 cases on today's tree.
- **Chromium with the new setup file** (`pChromium.log`): engine, layout-view and panel-sizes-stored, 33 of 33.
- **The comments** (`guard-1.log`): with `firefox-input.ts`, the two self-tests and the list's node test untracked,
  `node scripts/check-comments.mjs --base HEAD` reports every area within its budget and no grown block.
- **The tooling** (`targets-dsplit.out`): `targets.py` over copies of M2's three D runs, with R as `tabs1-1` and
  `focusobs-1`, gives 0, 1 and 0 outside R, the 1 parked-copy-editor-mount's, the spec's §3.2 figures, and its TSV
  equals `analyse2.py`'s on file and name.
- **`pkg`, `pkg-lsp` and `web/bindings` exist in `$W`**, built at `1b2f0cb`, and `ec4f11a` changes no file under
  `crates/`.
- **The rest's 6 tabs from `test:firefox`'s environment** (the R6 probe at `d08803e`, `$R/tasks/pr2/r6-update.md`,
  logs `$R/logs/pr2-r6/`, scripts `$R/scripts/pr2-r6/`): an untracked config of Task 3's two projects, the `TC` files,
  each project's peak in flight from `inflight.py`. HEAD's script: the rest 12, the capture project 1, side by side
  (`r6-base-12`); with `test:firefox` as Task 3 Step 3 writes it: 6 and 1, side by side (`r6-default`), 3 and 1 at
  `TABS=3` (`r6-tabs3`), 1 and 1 at `TABS=1` (`r6-tabs1`); `test:browser` on the 16 rest files, 12 (`r6-chromium`).
  A `maxWorkers: 6` on both projects also gives 6 and 1 (`r6a-filtered`), but an unfiltered run with
  `REDEXTAPE_FIREFOX` set then refuses to start on two `maxWorkers` values in one group (`r6a-unfiltered`).

## File map

| File | Task | What changes |
|---|---|---|
| `web/vite.config.ts` | 3, 4, 5 | `CAPTURE_FILES`; `browserProject`'s options; the two Firefox projects; three comments they make untrue (3); the `provide` key (4); the setup list (4); the commands and their stores (4, 5) |
| `web/package.json` | 3 | `test:firefox` names both projects and gives the rest 6 tabs |
| `web/tests/browser/provided-context.d.ts` | 3, 4 | Its doc's "browser project" (3); `pointerCaptureRefused` (4) |
| `web/tests/browser/collect.ts` | 3, 4 | A comment's "the Firefox project" (3); its doc's count of setup files (4) |
| `web/tests/node/capture-files.test.ts` | 3 | New: every listed path is a file |
| `README.md` | 3, 4 | Checks: the two projects, the rest's 6 tabs, the list, the guard's remedy |
| `web/tests/browser/firefox-input.ts` | 4, 5, 6, 9, FRB | New: the guard and the registration (4); the one-at-a-time check (5); the frame-focus step (6); the frame's focus at each file's start (9); the guard's third default named, `CaptureRecord` not exported (fix round B) |
| `web/tests/browser/engine.ts` | 3, 4, 5 | `requestGC`'s doc (3); the `BrowserCommands` block: three commands (4, 5) |
| `web/tests/firefox/two-browsers.test.ts` | 4 | New: the two-browsers invariant and the guard's self-test |
| `web/tests/firefox/frame-focus.test.ts` | 6, 9, FRB | New: the step's self-test (6); its doc (9); a first case that holds the frame's focus at the file's start (fix round B) |
| `web/tests/node/browser-timeout-invariants.test.ts` | 7, 9, FRB | The scan reads every module under `tests/browser/` and `tests/firefox/` (7); a case that the default scan reaches `tests/firefox/` and a helper module (9); that case's doc, and its `tests/firefox/` half under `REDEXTAPE_SCAN_DIR` (fix round B) |
| `web/tests/browser/until.ts` | 7, 9 | Its doc's sentence on the invariant's scope (7), for the whole tier (9) |
| `web/tests/**` (what §4.6 finds) | 9 | Task 8 found one: the setup call in `firefox-input.ts` (above). FRB is fix round B (`$R/tasks/pr2/fix-round-b.md`) |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | 11 | PR 2's entry, last in the file |

---

### Task 1: The base at `ec4f11a` (§6.2)

The runs PR 2 is measured against, before its first code commit. `$W`'s `web/` is `ec4f11a`'s (`git -C $W diff
--stat ec4f11a -- web` is empty). No commit.

**Files:** none tracked. Writes `$R/logs/pr2/t1-*` and `$R/tasks/pr2/t1-base.md`.

**Interfaces:**
- Produces: `t1-base-1tab-failures.tsv`, the third member of `$RSET`; the skip floor every later `--floor` uses;
  `t1-chromium`'s file and test counts, the Chromium base.

- [ ] **Step 1: Build.** From `$W/web`, under the heavy lock: `pnpm install --frozen-lockfile`, `pnpm run
  build:wasm`, `pnpm run build:lsp-wasm`, `pnpm run build:bindings`, each logged with `>|` to
  `$R/logs/pr2/t1-build-<step>.log`. Expected: each exits 0.

- [ ] **Step 2: Chromium.** `run.sh t1-chromium $W test:browser`. Expected: every file and test passed,
  `numPendingTests` 0, no `Errors` line. Record the files and tests (spec §3.7: 221 `.test.ts` files under
  `tests/browser/`, 7 of them probes, so 214 files are expected).

- [ ] **Step 3: Firefox in one tab.** `TABS=1 SAMPLE=1 run.sh t1-base-1tab $W test:firefox` (M1's `tabs1-1` took
  1,194 s). Then `python3 -I $R/scripts/pr2/targets.py --r tabs1-1 --r focusobs-1 t1-base-1tab`. Record files, tests,
  failed, skipped, wall time and memory peak. Its TSV is R's third member from here on.

- [ ] **Step 4: Firefox at the default tab count, twice.** `SAMPLE=1 run.sh t1-base-default-1 $W test:firefox` and
  `t1-base-default-2`. Then `python3 -I $R/scripts/pr2/targets.py $RSET t1-base-default-1 t1-base-default-2`. Record
  each run's counts, its skips (expected 21 in each, spec §3.7; a run with more lost a `beforeAll` click to cause 1,
  which is recorded, as M1's runs were), wall time and memory. The failures outside R are cause 1's and are recorded,
  not asserted. The skip floor is the smallest skip count of the three Firefox runs; if it is not 21, record why from
  the `↓` lines.

- [ ] **Step 5: The capture instrument over the tier, in A's mode.** Copy `$R/pr2/untracked/web/vite.probe.config.ts`
  to `$W/web/` and `$R/pr2/untracked/web/tests/zz-pr2/capture-diag.ts` to `$W/web/tests/zz-pr2/`. `PR2_PERSESSION=1
  PR2_CAPDIAG=1 CONFIG=vite.probe.config.ts run.sh t1-capdiag $W test:firefox`, then `python3 -I
  $R/scripts/pr2/capdiag.py t1-capdiag`. Remove both copies; `git -C $W status --porcelain` is empty. Expected: the
  files whose real captures held are exactly the 8 of §4.2 (default-views-gestures, divider-drag-focus,
  divider-drag-format-on-blur, panel-boundaries, panel-regions, panel-sizes-stored, step-focus-recording, view-keys),
  and no file has a synthetic capture that held. M2's counts for the 7 were 4, 7, 2, 12, 3, 7 and 1, and the probe's
  for step-focus-recording 2. **If the set differs either way, STOP and report it: it goes to the user before PR 2's
  first commit** (§6.2).

- [ ] **Step 6: Write `$R/tasks/pr2/t1-base.md`:** each run's command, counts, skips, wall time, load at the lock and
  memory; R's size from Step 4's first line; the floor; Step 5's table. Append a line to `$R/progress.md`.

---

### Task 2: The cause of parked-copy-editor-mount's `d-split-2` failure (ruling 5, "Blocks now")

**Done, 2026-11-04: STOPPED at Step 5 ("anything else"), and the STOP resolved by the user's R6**
(`$R/tasks/pr2/t2-parked-copy-editor-mount.md`; spec §3.8, §2). The cause, cause 3: the rest's one shared Firefox
synthesises every tab's real clicks on its parent-process main thread, which the load left about half a core, so each of
the case's 10 real clicks took a median 577-1,010 ms against 74 ms alone; reproduced in `t2-timed-d-4` (16,700 ms). Its
seven D runs put 49 rows, 32 distinct cases, in the outside-R record, each case passing alone (state-diagram's as its
whole file). On measure 3's figures (`$R/pr2/measure-3.md`) the user ruled "R6: one Firefox, 6 tabs", which Task 3
makes, and Task 2's rows take cause 3 (Names). Deviation: Step 2's three `CPUQuota=50%` D runs were not made, since Step
4's D runs reproduced the failure without them. The case makes 10 real clicks, not the 9 said below.

The user ruled that this failure blocks PR 2 until its cause is found, whether or not a run at the head repeats it.
This task finds the cause, with evidence. It changes no tracked file unless its fix lies inside the spec's scope (a
change to `web/tests` for tab contention or the frame's focus); **a fix anywhere else, or one that would widen PR 2,
is not made: the task STOPS and reports, for the user's ruling.**

**Files:** none tracked unless Step 5 says so. Writes `$R/logs/pr2/t2-*`, `$R/tasks/pr2/t2-parked-copy-editor-mount.md`.

**What is known** (this plan's probes): it passed alone in one tab in 915 ms. Over the 16 runs of M1 and M2 that ran
it, it took 1,090 to 17,408 ms; it failed in `d-split-2` (17,408 ms, `TimeoutError: locator.click: Timeout 680ms
exceeded.` at `clickToggle('tm')`, line 83), `default-1` (15,578 ms, a `locator.click` timeout), `e2-serial-1`
(15,292 ms, "Test timed out in 15000ms") and `diag-default-1` (9,599 ms, `expected [ 'source', 'rxm-0', 'tm-0' ] to
deeply equal [ 'source', 'tm-0', 'pane-1' ]`). The browser tier's `testTimeout` is 15,000 ms (`until.ts`'s doc). The
case makes 9 real clicks, a synthetic `.click()` on the copy's detach button and a programmatic `.focus()` on the TM
view's title, and waits with `until` four times.

- [x] **Step 1: Read the failure.** From `$R/logs/pr2/d-split-2.log` and `.json`: the file's start and end times, the
  files in flight beside it (the JSON's `startTime` and `endTime`), the 1-minute load around it (`d-split-2.mem.tsv`),
  and whether the click's 680 ms is the time the case had left of its 15,000 ms: read how `@vitest/browser` 4.1.12
  sets a locator command's timeout (`processTimeoutOptions` in its `dist`) and quote it.

- [x] **Step 2: Reproduce it under D's configuration.** Copy `vite.probe.config.ts` in (as Task 1 Step 5; D needs no
  file of `tests/zz-pr2/`). Three full runs: `PR2_SPLIT=$R/pr2/capfiles.txt CONFIG=vite.probe.config.ts SAMPLE=1 run.sh
  t2-d-<n> $W test:firefox --project firefox-cap`, `<n>` 1 to 3, then `python3 -I $R/scripts/pr2/targets.py $RSET
  --config $R/pr2/capfiles.txt t2-d-1 t2-d-2 t2-d-3`. Record the case's status and duration in each. If none fails,
  three more with `PROPS='-p CPUQuota=50%'` (the record's finding: a CPU quota reproduces timeouts a slow runner shows).
  Every other failure these runs list outside R goes in the outside-R record with its alone run (Names).

- [x] **Step 3: Alone.** `TABS=1 run.sh t2-alone-<n> $W test:firefox tests/browser/parked-copy-editor-mount.test.ts`,
  three times, and three under `PROPS='-p CPUQuota=50%'`. Record each duration.

- [x] **Step 4: Where the time goes.** An untracked copy of the file with a `console.error` line of `performance.now()`
  after each `await` and each `until`, named `tests/zz-pr2/pcem-timed.test.ts` and the only file in
  `$W/web/tests/zz-pr2/` (the probe config's `PR2_PROBES=1` includes `tests/zz-pr2/**/*.test.ts`), run under D (Step 2's
  command with `PR2_PROBES=1`) until a run is slow (above 10,000 ms) or fails, and alone. The `console.error` lines
  reach the log (`console.log` does not). Name the step or steps that took the time, and whether the file before it in
  its tab (`window.top.__redextapeFiles`, which `collect.ts` keeps, printed at the copy's start) was the same in the
  slow runs. Remove the copies after; `git -C $W status --porcelain` is empty.

- [x] **Step 5: Name the cause, and decide.** Write `$R/tasks/pr2/t2-parked-copy-editor-mount.md`: the first error,
  the runs and their durations, the step that took the time, the load, the file before it, and the cause in one
  sentence with the evidence for it. Then one of:
  - **Cause 1 or cause 2, which PR 2's design removes** (a capture in another tab, a lost click, the frame without the
    focus): say which task removes it, and the check that will show it (Task 10's runs at the head). No commit.
  - **A fix in `web/tests` inside the spec's scope**: make it, with the alone rule's runs (Step 3's command, and the
    file under D) passing, in its own commit, named for what it changes.
  - **Anything else** (the case's length under load, an engine difference, a product bug, a fix outside `web/tests`):
    **STOP and report** the cause and the options, for the user.
  Append a line to `$R/progress.md`.

---

### Task 3: Two Firefox projects and the capture list (§4.1, §4.2)

**Files:**
- Modify: `web/vite.config.ts` (after `FIREFOX`'s declaration: `CAPTURE_FILES`, `FIREFOX_COMMANDS`, `ProjectOptions`;
  `FIREFOX`'s doc; `browserProject`'s doc, signature, `include`, `exclude` and the comment above it, and `browser`; the
  `projects` array's `FIREFOX` branch), `web/package.json` (`test:firefox`), `web/tests/browser/provided-context.d.ts`
  (its doc), `web/tests/browser/collect.ts` (the `else` branch's comment), `web/tests/browser/engine.ts` (`requestGC`'s
  doc), `README.md` (Checks, the paragraph ending "nothing else runs it, CI included.")
- Create: `web/tests/node/capture-files.test.ts`

**Interfaces:**
- Produces: `export const CAPTURE_FILES: string[]` from `web/vite.config.ts`; `FIREFOX_COMMANDS`, the object both
  Firefox projects register (Tasks 4 and 5 add to it); `ProjectOptions` (Task 4 adds `pointerCaptureRefused`);
  `browserProject(name, browser, provider, commands = {}, options: ProjectOptions = {})`; the projects `firefox` and
  `firefox-capture`; `test:firefox` giving the rest 6 tabs (R6); `$S`; the record's `targets.py` and `errdiff.py` at
  their planfix versions.

- [ ] **Step 1: Make `$S` at the base, and install the record's tools.** `git -C $W worktree add -q --detach $S HEAD`;
  then `cp -a $W/web/node_modules $W/web/bindings $S/web/` and `cp -a $W/pkg $W/pkg-lsp $S/`. Check: `git -C $S
  rev-parse HEAD` is `$W`'s, and `find $S/web/node_modules -maxdepth 0 -type l` prints nothing. Then, unless the
  controller has done it already, `cp $R/scripts/pr2-planfix/targets.py $R/scripts/pr2-planfix/errdiff.py
  $R/scripts/pr2/`, each `cmp`'d with its source. Check: `python3 -I $R/scripts/pr2/targets.py $RSET
  t1-base-default-1` prints an `R:` line naming share-open-deep among R's files, and a C1 line with `files 1`, the
  line after it divider-drag-format-on-blur's (Names; `targets-new.out`).

- [ ] **Step 2: The config.** In `web/vite.config.ts`, after `FIREFOX`'s declaration:

```ts
/**
 * The files that take a pointer capture that holds through real input: they run in `firefox-capture`, one at a time.
 * In one Firefox every page's mouse is one pointer, so while a page holds a capture the clicks of every other tab go
 * to it. Paths are relative to `web/`.
 */
export const CAPTURE_FILES = [
  'tests/browser/default-views-gestures.test.ts',
  'tests/browser/divider-drag-focus.test.ts',
  'tests/browser/divider-drag-format-on-blur.test.ts',
  'tests/browser/panel-boundaries.test.ts',
  'tests/browser/panel-regions.test.ts',
  'tests/browser/panel-sizes-stored.test.ts',
  'tests/browser/step-focus-recording.test.ts',
  'tests/browser/view-keys.test.ts',
]

/** What each Firefox project registers. */
const FIREFOX_COMMANDS = {
  // Playwright's own collection, for `collect.ts` in an engine that gives a page no `gc`.
  requestGC: async ({ page }) => page.requestGC(),
} satisfies Record<string, BrowserCommand<never[]>>

/** What a project adds to the shared definition: an `include` given replaces the shared one. */
interface ProjectOptions {
  include?: string[]
  exclude?: string[]
  fileParallelism?: boolean
}
```

  `browserProject` gains `options: ProjectOptions = {}` after `commands`, whose type becomes `Record<string,
  BrowserCommand<never[]>>`. In its body: `include: options.include ?? ['tests/browser/**/*.test.ts']`; `exclude`
  appends `...(options.exclude ?? [])`; `browser` becomes a multi-line object that ends with
  `...(options.fileParallelism === undefined ? {} : { fileParallelism: options.fileParallelism })` (the config has
  `exactOptionalPropertyTypes`). The `FIREFOX` branch:

```ts
      ...(FIREFOX
        ? [
            // Its tab count is `test:firefox`'s `VITEST_MAX_WORKERS`: 6 unless the caller sets one (README, Checks).
            browserProject('firefox', 'firefox', playwright(), FIREFOX_COMMANDS, {
              include: ['tests/browser/**/*.test.ts', 'tests/firefox/**/*.test.ts'],
              exclude: CAPTURE_FILES,
            }),
            // ONE FILE AT A TIME, AND BESIDE THE REST: `browser.fileParallelism`, not `maxWorkers` or the top-level
            // `fileParallelism` its deprecation points to, either of which puts this project in a group of its own,
            // run after the rest. Its own `playwright()` gives it its own browser.
            browserProject('firefox-capture', 'firefox', playwright(), FIREFOX_COMMANDS, {
              include: CAPTURE_FILES,
              fileParallelism: false,
            }),
          ]
        : []),
```

  The comments two Firefox projects make untrue change, each keeping its line count:
  - `FIREFOX`'s doc: "Whether this run has the Firefox project:" becomes "…the Firefox projects:".
  - `browserProject`'s doc: "so they cannot drift apart in the files they run, their setup or what they are given."
    becomes "so they cannot drift apart in their setup; what one changes is named in its `options`."
  - The comment above `exclude`: "Harmless only because `include` above is confined to `tests/browser/`" becomes
    "Harmless only because each `include` is confined to `tests/browser/` and `tests/firefox/`".
  - `provided-context.d.ts`'s doc: "What `vite.config.ts`'s browser project hands its tests" becomes "…browser projects
    hand their tests".
  - `collect.ts`'s `else` comment: "a coverage run that starts the Firefox project fails" becomes "…starts a Firefox
    project fails", and "a command only the Firefox project registers" becomes "…only the Firefox projects register".
  - `engine.ts`'s `requestGC` doc: "registered by the Firefox project alone" becomes "…by the Firefox projects alone".

- [ ] **Step 3: The script and the list's check.**
  - `web/package.json`: `"test:firefox": "REDEXTAPE_FIREFOX=1 VITEST_MAX_WORKERS=${VITEST_MAX_WORKERS:-6} vitest run
    --project firefox --project firefox-capture"`, on one line: the rest at 6 tabs (spec §4.1, R6), a
    `VITEST_MAX_WORKERS` the caller gives winning over the 6. `test:browser` does not change.
  - `web/tests/node/capture-files.test.ts`:

```ts
import { statSync } from 'node:fs'
import { expect, it } from 'vitest'
import { CAPTURE_FILES } from '../../vite.config'

/**
 * A path on `CAPTURE_FILES` that names no file would leave its file, renamed, in `firefox`, where a capture of its
 * takes the clicks of every other tab: this names the stale entry instead.
 */
it('every path on the capture list is a file', () => {
  const missing = CAPTURE_FILES.filter(
    (f) => statSync(new URL(`../../${f}`, import.meta.url), { throwIfNoEntry: false })?.isFile() !== true,
  )
  expect(missing, 'paths on vite.config.ts’s CAPTURE_FILES that are not files').toEqual([])
})
```

- [ ] **Step 4: README.** In Checks, after "…where the default reporter leaves some out.", insert: "`pnpm test:firefox`
  runs two Firefox projects, each in a Firefox of its own: `firefox-capture` runs the files on `vite.config.ts`'s
  `CAPTURE_FILES` one at a time, since a press on a separator takes a pointer capture and, in one Firefox, a capture
  takes the clicks of every other tab; `firefox` runs the rest in one Firefox at 6 tabs, since that Firefox's one
  parent process synthesises every tab's real input, and with more tabs on a loaded machine its clicks come late
  enough to time cases out (`VITEST_MAX_WORKERS` sets another count)." The paragraph's other sentences stay, "The run
  still has known failures, …" last.

- [ ] **Step 5: Checks.**
  1. `pnpm exec vitest run --project node tests/node/capture-files.test.ts`: 1 passed.
  2. Unset, `pnpm exec vitest run --project firefox-capture` stops with `No projects matched the filter
     "firefox-capture".`, exit 1.
  3. `run.sh t3-chromium $W test:browser tests/browser/engine.test.ts tests/browser/layout-view.test.ts`: all passed;
     its tag is `|browser (chromium)|` alone.
  4. `SAMPLE=1 run.sh t3-firefox $W test:firefox`, then `python3 -I $R/scripts/pr2/targets.py $RSET t3-firefox`:
     both tags; C4 reads the rest's peak in flight 6 (the base's default runs: 12) and the capture group's 8 files
     with peak in flight 1, ending within the rest's span; the counts, the wall time and the memory peak are recorded
     (M3's R6: 229 and 198 s, 5.30 and 5.25 GiB). It exits 1, F4 reading `NOT met` (the self-tests come in Tasks 4
     and 6); a miss in C2, C7, C8 or C9 is a finding. Each failure C1 lists, a test or a `FILE`, goes in the
     outside-R record with its alone run (Names; ruling 5, "Yes, every run"): one that fails alone stops this task,
     one that passes alone is Task 10's. D at `1b2f0cb` had 0 to 1 outside the one-tab union, M3's R6 at `d08803e` 1
     and 0, the 1 in view-keys in the capture project.
  5. The count holds against a caller's: `TABS=1 run.sh t3-tabs1 $W test:firefox tests/browser/${^TC}.test.ts`, then
     `python3 -I $R/scripts/pr2-r6/inflight.py --logdir $R/logs/pr2 t3-tabs1`: each project's peak in flight 1, the
     alone rule's form (the probe's `r6-tabs1`: 1 and 1). Its failures outside R go in the record as in Check 4. And,
     before the commit, `git diff -- web/package.json` changes the `test:firefox` line alone, so Chromium's
     `test:browser` keeps its count.
  6. `pnpm exec biome ci --error-on-warnings` and `flock ~/temp/redextape-heavy.lock pnpm run typecheck`: exit 0.

- [ ] **Step 6: Commit,** under the heavy lock (`git add web/vite.config.ts web/package.json
  web/tests/browser/provided-context.d.ts web/tests/browser/collect.ts web/tests/browser/engine.ts
  web/tests/node/capture-files.test.ts README.md`, then `flock ~/temp/redextape-heavy.lock git commit`):

```
`pnpm test:firefox` runs two Firefox projects, each with a Firefox of its own: `firefox-capture` runs the eight files on `vite.config.ts`'s `CAPTURE_FILES`, whose real presses on a separator take a pointer capture, one at a time beside `firefox`, the rest, at 6 tabs unless `VITEST_MAX_WORKERS` sets another count, and a node test fails a listed path that names no file
```

- [ ] **Step 7: S7, in `$S` moved to the commit** (`git -C $S checkout -q --detach <the commit>`). In
  `$S/web/vite.config.ts`, `'tests/browser/panel-regions.test.ts'` becomes `'tests/browser/panel-region.test.ts'`.
  From `$S/web`: `pnpm exec vitest run --project node tests/node/capture-files.test.ts` fails, and its diff names
  `"tests/browser/panel-region.test.ts"`. Restore as the Global constraints say.

---

### Task 4: The capture guard and the two-browsers invariant (§4.3, §4.4)

**Files:**
- Create: `web/tests/browser/firefox-input.ts`, `web/tests/firefox/two-browsers.test.ts`
- Modify: `web/vite.config.ts` (before `FIREFOX_COMMANDS`: the browser store and two commands; `FIREFOX_COMMANDS`
  gains them; `CAPTURE_FILES` gains `'tests/firefox/two-browsers.test.ts'` last and its doc a sentence;
  `ProjectOptions`, `browserProject`'s `provide` and the `firefox` call: `pointerCaptureRefused`; the setup list and
  its comment), `web/tests/browser/provided-context.d.ts` (one key), `web/tests/browser/collect.ts` (its doc's count
  of setup files), `web/tests/browser/engine.ts` (the `BrowserCommands` block), `README.md` (Checks)

**Interfaces:**
- Consumes: `CAPTURE_FILES`, `FIREFOX_COMMANDS`, `ProjectOptions` and `browserProject`'s options (Task 3).
- Produces, from `./firefox-input`: `interface CaptureRecord { trusted: boolean; element: string }`,
  `capturesOfThisCase(): readonly CaptureRecord[]`, `captureFailure(records: readonly CaptureRecord[], file: string):
  string`; the page store `window.__redextapeFirefoxInput`; the module-level `first`, `records`, `fromWeb` and `file`,
  and `refused` in the `if (!CHROMIUM && first)` block, that Tasks 5 and 6 use; `inject('pointerCaptureRefused'):
  boolean`, true in `firefox` alone. Commands: `registerBrowser(): Promise<{ others: number; browsers: number }>`,
  `decoyDuringCapture(selector: string, browserOf: 'own' | 'rest'): Promise<{ decoyClicks: number; decoyAlone:
  number }>`.

- [ ] **Step 1: The commands.** In `web/vite.config.ts`, `import type { Browser } from 'playwright'` (Biome's import
  order puts it after `@vitest/browser-playwright`'s import), and before `FIREFOX_COMMANDS`:

```ts
/** Each Firefox project's browser, by the name Vitest gives the project, for `two-browsers.test.ts`. */
const browsers = new Map<string, Browser>()

const registerBrowser: BrowserCommand<[]> = ({ page, project }) => {
  const browser = page.context().browser()
  if (browser !== null) browsers.set(project.name, browser)
  return {
    others: [...browsers.keys()].filter((n) => n !== project.name).length,
    browsers: new Set(browsers.values()).size,
  }
}

/**
 * A real press at the middle of `selector` in the test frame, a click on a counting button in a page of a new context
 * of `browserOf`'s browser during the press, a move of 80 px in 5 steps and the release, then a click on the decoy
 * alone. A decoy in the case's own browser loses its click to the capture; one in the other project's does not.
 */
const decoyDuringCapture: BrowserCommand<[selector: string, browserOf: 'own' | 'rest']> = async (
  { page, iframe, project },
  selector,
  browserOf,
) => {
  const browser =
    browserOf === 'own' ? page.context().browser() : [...browsers].find(([name]) => name !== project.name)?.[1]
  if (browser === null || browser === undefined) throw new Error(`no browser registered for ${browserOf}`)
  const box = await iframe.locator(selector).boundingBox()
  if (box === null) throw new Error(`${selector} has no box in the test frame`)
  const context = await browser.newContext()
  try {
    const decoy = await context.newPage()
    await decoy.setContent(
      '<button style="position:fixed;left:0;top:0;width:60px;height:60px" onclick="window.n=(window.n??0)+1">decoy</button>',
    )
    const clicks = (): Promise<number> => decoy.evaluate(() => (window as Window & { n?: number }).n ?? 0)
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
    await page.mouse.move(x, y)
    await page.mouse.down()
    await decoy.mouse.click(5, 5)
    const decoyClicks = await clicks()
    await page.mouse.move(x, y + 80, { steps: 5 })
    await page.mouse.up()
    await decoy.mouse.click(5, 5)
    return { decoyClicks, decoyAlone: (await clicks()) - decoyClicks }
  } finally {
    await context.close()
  }
}
```

  `FIREFOX_COMMANDS` gains `registerBrowser` and `decoyDuringCapture`. `CAPTURE_FILES`' doc gains, before "Paths are
  relative to `web/`.": "A file that captures and is not listed fails in `firefox` on `firefox-input.ts`'s guard,
  which names this list." `ProjectOptions` gains `pointerCaptureRefused?: boolean`; `browserProject`'s `provide` gains
  `pointerCaptureRefused: options.pointerCaptureRefused ?? false`, and the comment above `provide` a sentence:
  "`pointerCaptureRefused` tells `firefox-input.ts`'s guard whether this project refuses a pointer capture."; the
  `firefox` call's options gain `pointerCaptureRefused: true`. The setup list becomes `['tests/browser/collect.ts',
  'tests/browser/firefox-input.ts', 'tests/browser/setup.ts']`, and its comment's last sentence gains:
  "`tests/browser/firefox-input.ts` comes second, before `setup.ts` imports `src`, and installs nothing in Chromium."
  `collect.ts`'s doc, which does not grow: "the FIRST of its two files" becomes "the FIRST of its three files", and
  "Vitest's default imports the two at once" becomes "Vitest's default imports them at once".

- [ ] **Step 2: The types.** `engine.ts`'s `BrowserCommands` block, after `requestGC`:

```ts
    /** Registers this project's browser in the config's process; replies how many other projects have, and browsers. */
    registerBrowser: () => Promise<{ others: number; browsers: number }>
    /** A real press on `selector` with a decoy click during it in `browserOf`'s browser: `two-browsers.test.ts`. */
    decoyDuringCapture: (
      selector: string,
      browserOf: 'own' | 'rest',
    ) => Promise<{ decoyClicks: number; decoyAlone: number }>
```

  `provided-context.d.ts`, after `coverageOn`:

```ts
    /** Whether this project refuses a pointer capture, for `firefox-input.ts`'s guard: true in `firefox` alone. */
    pointerCaptureRefused: boolean
```

- [ ] **Step 3: `web/tests/browser/firefox-input.ts`:**

```ts
import { afterAll, afterEach, beforeEach, expect, inject } from 'vitest'
import { commands } from 'vitest/browser'
import { CHROMIUM } from './engine'

/**
 * Browser-tier setup, the SECOND of its three files, for Firefox's input; in Chromium it installs nothing. Second, so
 * that what it wraps is wrapped before `setup.ts` imports `src`, and importing nothing of `src`, so that `collect.ts`
 * still finishes before any module of `src` compiles. In Firefox it fails a pointer capture outside the capture
 * project and registers this project's browser (`vite.config.ts`'s `CAPTURE_FILES` and commands).
 */

/** A pointer capture that held, taken in this page: whether real input led to it, and the element's tag and class. */
export interface CaptureRecord {
  trusted: boolean
  element: string
}

/**
 * The guard's records, ON THE WINDOW, NOT IN THIS MODULE: a test file that imports this module gets an instance of its
 * own beside the one Vitest loaded as a setup file, and its exports must read what that one recorded. Only the first
 * instance in a page installs anything, so each page's prototypes are wrapped once.
 */
interface Records {
  ofCase: CaptureRecord[]
  ofHooks: CaptureRecord[]
  inCase: boolean
}
const page = window as Window & { __redextapeFirefoxInput?: Records }
const first = page.__redextapeFirefoxInput === undefined
page.__redextapeFirefoxInput ??= { ofCase: [], ofHooks: [], inCase: false }
const records = page.__redextapeFirefoxInput

/** The captures that held in the case that is running, for `two-browsers.test.ts`'s check of the guard. */
export function capturesOfThisCase(): readonly CaptureRecord[] {
  return records.ofCase
}

/** The guard's failure: `file` took the captures `records` outside the capture project. */
export function captureFailure(records: readonly CaptureRecord[], file: string): string {
  const where = records.map((r) => `${r.element} (${r.trusted ? 'real input' : 'a synthetic event'})`).join(', ')
  return (
    `${file} took a pointer capture that held, on ${where}, in the \`firefox\` project. In one Firefox every page's ` +
    'mouse is one pointer, so a capture takes the clicks of every other tab: add the file to `CAPTURE_FILES` in ' +
    'vite.config.ts, whose project runs one file at a time in a Firefox of its own.'
  )
}

/** A test file's path from `web/`, as `CAPTURE_FILES` names it. */
const fromWeb = (path: string): string => `tests/${path.split('/tests/').pop()}`
const file = fromWeb(expect.getState().testPath ?? '(unknown)')

if (!CHROMIUM && first) {
  // THE CONDITION IS A CAPTURE THAT HOLDS, NOT ONE MADE BY REAL INPUT: a capture that holds is what takes the other
  // tabs' clicks, and reading it after the call needs no `window.event`.
  const setPointerCapture = Element.prototype.setPointerCapture
  Element.prototype.setPointerCapture = function (this: Element, pointerId: number): void {
    setPointerCapture.call(this, pointerId)
    if (!this.hasPointerCapture(pointerId)) return
    const cls = this.classList[0]
    ;(records.inCase ? records.ofCase : records.ofHooks).push({
      trusted: window.event?.isTrusted === true,
      element: cls === undefined ? this.localName : `${this.localName}.${cls}`,
    })
  }

  await commands.registerBrowser()

  const refused = inject('pointerCaptureRefused')
  beforeEach(() => {
    records.ofCase = []
    records.inCase = true
  })
  afterEach(() => {
    records.inCase = false
    if (refused && records.ofCase.length > 0) throw new Error(captureFailure(records.ofCase, file))
  })
  afterAll(() => {
    if (refused && records.ofHooks.length > 0) throw new Error(captureFailure(records.ofHooks, file))
  })
}
```

- [ ] **Step 4: `web/tests/firefox/two-browsers.test.ts`,** and `CAPTURE_FILES` gains
  `'tests/firefox/two-browsers.test.ts'` last:

```ts
import { expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { captureFailure, capturesOfThisCase } from '../browser/firefox-input'
import { until } from '../browser/until'

/**
 * The premise of the split into two Firefox projects, which Vitest does not document: each project gets a browser of
 * its own, so a capture held in `firefox-capture` takes no click from a page of `firefox`. On the capture list, since
 * it takes a real capture itself. It needs a file of `firefox` running beside it, as a full `pnpm test:firefox` has.
 */

let registered: { others: number; browsers: number } | undefined
let asking = false

/** Asks the config's process which projects have registered, one request at a time, for a synchronous `until`. */
function rest(): boolean {
  if (!asking) {
    asking = true
    void commands.registerBrowser().then((r) => {
      registered = r
      asking = false
    })
  }
  return (registered?.others ?? 0) > 0
}

it('takes no click from the other project while a real press holds a capture', async () => {
  await until(rest, 'the `firefox` project to register its browser: name a file of it beside this one')
  expect(registered?.browsers, 'the two projects registered two browsers').toBe(2)

  const handle = document.createElement('div')
  handle.className = 'handle'
  handle.style.cssText = 'position:fixed;left:40px;top:40px;width:200px;height:12px;touch-action:none'
  document.body.append(handle)
  let moves = 0
  let ups = 0
  handle.addEventListener('pointerdown', (e) => handle.setPointerCapture(e.pointerId))
  handle.addEventListener('pointermove', () => moves++)
  handle.addEventListener('pointerup', () => ups++)
  try {
    const own = await commands.decoyDuringCapture('.handle', 'own')
    expect(own, 'precondition: a decoy in this project’s browser loses its click to the capture').toEqual({
      decoyClicks: 0,
      decoyAlone: 1,
    })

    moves = 0
    const upsBefore = ups
    const other = await commands.decoyDuringCapture('.handle', 'rest')
    await until(() => ups > upsBefore, 'the release of the press with the decoy in the other browser')
    expect(other, 'a decoy in the other project’s browser keeps its click').toEqual({ decoyClicks: 1, decoyAlone: 1 })
    expect(moves, 'the handle heard every move of the press').toBe(6)

    const records = capturesOfThisCase()
    expect(records, 'the guard recorded the real presses’ captures').toContainEqual({
      trusted: true,
      element: 'div.handle',
    })
    expect(captureFailure(records, 'tests/firefox/two-browsers.test.ts')).toContain(
      'tests/firefox/two-browsers.test.ts took a pointer capture that held, on div.handle (real input)',
    )
  } finally {
    handle.remove()
  }
})
```

  The message's assertion holds the function's use of the file and the records it is given; the guard's own `file`,
  `fromWeb` of the page's `testPath`, is shown by S1's run alone (spec §4.3, "Not blind").

- [ ] **Step 5: README.** After Task 3's sentence: "A file outside the list that takes a capture fails in `firefox`
  with a message naming the list: add it to `CAPTURE_FILES`."

- [ ] **Step 6: Checks.**
  1. `run.sh t4-pair $W test:firefox tests/firefox/two-browsers.test.ts tests/browser/lsp-hover.test.ts`:
     `two-browsers.test.ts` passed.
  2. `run.sh t4-alone $W test:firefox tests/firefox/two-browsers.test.ts`: it fails with "timed out after 10000ms
     waiting for the `firefox` project to register its browser: name a file of it beside this one".
  3. `run.sh t4-chromium $W test:browser tests/browser/engine.test.ts tests/browser/layout-view.test.ts
     tests/browser/panel-sizes-stored.test.ts`: 33 passed.
  4. `SAMPLE=1 run.sh t4-firefox $W test:firefox`, then `python3 -I $R/scripts/pr2/targets.py $RSET t4-firefox`: C8
     reads 0 (no file in `firefox` takes a capture that holds), `two-browsers.test.ts` passed, and C4 reads the rest at
     peak 6 and 9 capture files at peak 1. It exits 1, F4 reading `NOT met` until Task 6 adds `frame-focus.test.ts`.
     Each failure C1 lists goes in the outside-R record with its alone run, as in Task 3.
  5. `pnpm exec vitest run --project node tests/node/capture-files.test.ts` (9 paths), `pnpm exec biome ci
     --error-on-warnings` and `flock ~/temp/redextape-heavy.lock pnpm run typecheck`: exit 0.

- [ ] **Step 7: Commit** (heavy lock):

```
In Firefox a pointer capture that holds fails its case in the `firefox` project with a message naming `CAPTURE_FILES`, through a new setup file, `firefox-input.ts`, that installs nothing in Chromium, and `two-browsers.test.ts` checks that the two projects' browsers are separate: a decoy click in the other project's browser survives a held capture, one in its own does not
```

- [ ] **Step 8: Sabotages, in `$S` moved to the commit.** S2, S4 and S6 run `two-browsers.test.ts` with `lsp-hover`
  beside it, a file of the rest for its registration; S1 runs view-keys alone, which it moves into `firefox`.
  - **S1.** `CAPTURE_FILES` loses `'tests/browser/view-keys.test.ts'`. `run.sh t4-s1 $S test:firefox
    tests/browser/view-keys.test.ts`: "lets a pointer press at the hint through to what is under it" fails with
    "tests/browser/view-keys.test.ts took a pointer capture that held, on div.layout-divider (real input), in the
    `firefox` project". Record the run's failed count. (The probe's 20 had Task 6's step in place, under which
    view-keys' "arms on the prefix from the source editor, …" passed; without the step it failed in 4 of the record's
    6 one-tab runs that ran it, `tabs1-1`, `t1-base-1tab`, `focusobs-1` and `focusfiles-1tab-free`, so the count may
    be one more.)
  - **S2.** `firefox-input.ts`: `const held = this.hasPointerCapture(pointerId)` before the original call, and `if
    (!held) return` after it. `run.sh t4-s2 $S test:firefox tests/firefox/two-browsers.test.ts
    tests/browser/lsp-hover.test.ts`: it fails at "the guard recorded the real presses’ captures". With S1's edit as
    well, `run.sh t4-s2-s1 $S test:firefox tests/browser/view-keys.test.ts` passes the hint case. The hint case is the
    proof, not the failed count, which "arms on the prefix …" can move by one from run to run without the step.
  - **S4.** `decoyDuringCapture`'s `'rest'` takes `page.context().browser()`. `run.sh t4-s4 $S test:firefox` with S2's
    two files: it fails at "a decoy in the other project’s browser keeps its click" with `decoyClicks: +0`.
  - **S6.** `firefox-input.ts` drops `await commands.registerBrowser()`. `run.sh t4-s6 $S test:firefox` with S2's two
    files: it fails at the wait for the `firefox` project's registration.
  - **S10, the guard's hook arm.** No tracked file changes: copy
    `$R/scripts/pr2-planfix/web/tests/firefox/zz-hookcap.test.ts` to `$S/web/tests/firefox/`, run `run.sh t4-s10 $S
    test:firefox tests/firefox/zz-hookcap.test.ts`, then remove the copy; `git -C $S status --porcelain` is empty. Its
    `beforeAll` appends a capturing handle and presses it through `decoyDuringCapture`. Expected, as the fix round's
    `pf-hookcap`: its case "precondition: the hook press took a capture" passes, and the file fails as a whole with
    "tests/firefox/zz-hookcap.test.ts took a pointer capture that held, on div.handle (real input), in the `firefox`
    project".

---

### Task 5: The one-at-a-time check (§4.10)

**Files:**
- Modify: `web/vite.config.ts` (the store after `browsers`, the command after `decoyDuringCapture`;
  `FIREFOX_COMMANDS`; the `firefox-capture` comment's last sentence), `web/tests/browser/engine.ts`
  (`BrowserCommands`), `web/tests/browser/firefox-input.ts` (its doc's last sentence, `aroundAll` in its import, a
  block at the end of the `if`)

**Interfaces:**
- Consumes: `first`, `file`, `fromWeb`, `refused` (Task 4).
- Produces: `captureFileSpan(edge: 'begin' | 'end'): Promise<string[]>`, the absolute paths in flight.

- [ ] **Step 1: The command.** In `web/vite.config.ts`, after `browsers`:

```ts
/** The capture-project files whose span has begun and not ended, by their path. */
const captureFilesInFlight = new Set<string>()
```

  and after `decoyDuringCapture`:

```ts
/**
 * The capture project's one-at-a-time check: `'begin'` adds the calling file to the files in flight and replies with
 * them, `'end'` removes it. A reply that names another file means two capture-project files ran at once.
 */
const captureFileSpan: BrowserCommand<[edge: 'begin' | 'end']> = ({ testPath }, edge) => {
  if (testPath === undefined) return []
  if (edge === 'begin') captureFilesInFlight.add(testPath)
  else captureFilesInFlight.delete(testPath)
  return [...captureFilesInFlight]
}
```

  `FIREFOX_COMMANDS` gains `captureFileSpan`. The comment above the `firefox-capture` call gains a last sentence:
  "`firefox-input.ts`'s one-at-a-time check fails the run if the option stops holding." `engine.ts`'s block gains:

```ts
    /** The capture project's span of a file, `'begin'` and `'end'`; replies with the files in flight. */
    captureFileSpan: (edge: 'begin' | 'end') => Promise<string[]>
```

- [ ] **Step 2: The check.** `firefox-input.ts` imports `aroundAll` too; its doc's last sentence ends "…and registers
  this project's browser, and in `firefox-capture` fails a file that begins while another is in flight
  (`vite.config.ts`'s `CAPTURE_FILES` and commands)." At the end of the `if (!CHROMIUM && first)` block:

```ts
  if (!refused) {
    // THE LATER OF TWO OVERLAPPING FILES FAILS HERE: it begins while the earlier is still in the set. AN `aroundAll`,
    // NOT AN `afterAll`: a file's own `afterAll` runs before this module's, and one that throws ends the hook list,
    // so an `afterAll` here would leave the file in the set and fail every later one.
    const own = expect.getState().testPath
    aroundAll(async (runSuite) => {
      const inFlight = await commands.captureFileSpan('begin')
      try {
        if (own === undefined || !inFlight.includes(own)) {
          throw new Error(`the one-at-a-time check did not hear ${file} begin: it replied ${JSON.stringify(inFlight)}`)
        }
        const others = inFlight.filter((f) => f !== own).map(fromWeb)
        if (others.length > 0) {
          throw new Error(
            `${file} began while ${others.join(', ')} had not ended: \`firefox-capture\` runs its files one at a time ` +
              '(`browser.fileParallelism: false` in vite.config.ts), since a capture in one takes the clicks of another.',
          )
        }
        await runSuite()
      } finally {
        await commands.captureFileSpan('end')
      }
    })
  }
```

  A setup file's `aroundAll` is the outermost of a file's hooks, so the span begins before the file's own `beforeAll`
  and ends after its own `afterAll`, and the `finally` sends `'end'` whatever those threw or timed out on. A throw
  before `runSuite()` fails the file and skips its cases. The fix round probed it (`pf-around`, `pf-around-s8`,
  `tsc-around.log`, `biome-around.log`); with an `afterAll` in its place, a file whose own top-level `afterAll` threw
  or timed out never sent `'end'`, and every capture file after it failed "began while" (`pf-afterall`).

- [ ] **Step 3: Checks.**
  1. `run.sh t5-cap $W test:firefox tests/browser/panel-sizes-stored.test.ts tests/browser/panel-regions.test.ts
     tests/firefox/two-browsers.test.ts tests/browser/lsp-hover.test.ts`: no failure carries "began while" or "did
     not hear" (`grep -c` gives 0 for each), and `two-browsers.test.ts` passed.
  2. `SAMPLE=1 run.sh t5-firefox $W test:firefox`, then `targets.py $RSET t5-firefox`: C9 reads 0, C8 0, C4 the rest at
     peak 6 and 9 capture files at peak 1. It exits 1, F4 reading `NOT met` until Task 6. Each failure C1 lists goes in
     the outside-R record with its alone run, as in Task 3.
  3. `pnpm exec biome ci --error-on-warnings` and `flock ~/temp/redextape-heavy.lock pnpm run typecheck`: exit 0.

- [ ] **Step 4: Commit** (heavy lock):

```
A file of `firefox-capture` that begins while another of its files is in flight fails, through a `captureFileSpan` command the setup file's `aroundAll` calls at each capture-project file's start and end, whatever the file's own hooks throw, so that `browser.fileParallelism: false` is held by a check in every Firefox run
```

- [ ] **Step 5: Sabotages, in `$S` moved to the commit.**
  - **S8.** `firefox-capture`'s `fileParallelism: false` becomes `true`. `run.sh t5-s8 $S test:firefox` (full, at the
    script's count, which with `fileParallelism` true gives the capture project 6 tabs as well): exit non-zero; `python3
    -I $R/scripts/pr2/targets.py $RSET t5-s8`'s C9 counts at least 1 failing file (not `grep -c 'began while'`, which
    counts each failure twice, its code frame repeating the message); each such failure's message names another
    capture-project file then in flight, by its path from `web/`. C9 is S8's reading, not C4: each overlapping file
    fails before its first case, and the JSON gives a file with no case run a span of zero length at the run's start,
    so under S8 C4 reads the capture group's peak in flight as 1 (Task 5's `t5-s8`: C9 8, C4 1). (The plan's probe: 4
    of the 5 capture-project files of a 6-file run, `sS8.log`; the fix round's, with the `aroundAll`: 3 of 8,
    `pf-around-s8`.)
  - **The precondition.** `captureFileSpan`'s body becomes `return []`. `run.sh t5-pre $S test:firefox` with Check 1's
    four files: panel-sizes-stored, panel-regions and two-browsers fail as whole files with "the one-at-a-time check
    did not hear", and lsp-hover, in the rest, does not.

---

### Task 6: The frame-focus step (§4.5)

**Files:**
- Modify: `web/tests/browser/firefox-input.ts` (its doc; a block after the capture wrapper)
- Create: `web/tests/firefox/frame-focus.test.ts`

**Interfaces:**
- Consumes: `first` (Task 4).

- [ ] **Step 1: The step.** In `firefox-input.ts`, inside `if (!CHROMIUM && first)`, after the `setPointerCapture`
  wrapper and before `await commands.registerBrowser()`:

```ts
  // A FRAME WITHOUT THE FOCUS IGNORES `focus()`, and every file starts so, with the focus in the top document. Vitest's
  // `keyboard` gives the frame the focus before it types if the frame's `activeElement` is its body; this does so
  // before every `focus()` that would otherwise be ignored, the app's own included, which no harness call precedes.
  for (const proto of [HTMLElement.prototype, SVGElement.prototype]) {
    const focus = proto.focus
    proto.focus = function (this: HTMLElement | SVGElement, options?: FocusOptions): void {
      if (!document.hasFocus()) window.focus()
      focus.call(this, options)
    }
  }
```

  The doc's sentence of what it does in Firefox gains "gives the frame the focus before a `focus()` the frame would
  ignore," after "In Firefox it".

- [ ] **Step 2: `web/tests/firefox/frame-focus.test.ts`:**

```ts
import { afterEach, expect, it } from 'vitest'

/**
 * `firefox-input.ts`'s frame-focus step. A `focus()` on an element of the top document runs the top realm's `focus`,
 * which the step does not wrap, and leaves this frame without the focus: the state every file starts in.
 */

const top = window.top as Window
const made: Element[] = []

function button(name: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.id = name
  b.textContent = name
  document.body.append(b)
  made.push(b)
  return b
}

function focusTopDocument(): void {
  const away = top.document.createElement('button')
  top.document.body.append(away)
  made.push(away)
  away.focus()
  expect(document.hasFocus(), 'precondition: the frame lacks the focus once the top document holds it').toBe(false)
}

// THE TOP DOCUMENT OUTLIVES THIS FILE, and the tab's later files share it: what a case made goes with the case.
afterEach(() => {
  for (const el of made.splice(0)) el.remove()
})

it('gives the frame the focus before a focus() the frame would ignore', () => {
  focusTopDocument()
  const b = button('first')
  b.focus()
  expect(document.activeElement, 'the button took the focus').toBe(b)
  expect(document.hasFocus(), 'the frame has the focus').toBe(true)
})

it('does so for a later focus() in a case, not only its first', () => {
  window.focus()
  button('first').focus()
  focusTopDocument()
  const b = button('second')
  b.focus()
  expect(document.activeElement, 'the later button took the focus').toBe(b)
  expect(document.hasFocus(), 'the frame has the focus').toBe(true)
})
```

  No `window.focus()` in the `afterEach`, where the plan writer's draft had one: each file runs in a frame of its own
  (Vitest's orchestrator removes the iframes before it builds the next), so the frame's focus needs no restoring, and
  every file starts without it (spec §3.4, §4.5). In the passing path it was a no-op: each case ends with the frame
  focused by its own last `focus()`.

- [ ] **Step 3: Checks.**
  1. `run.sh t6-ff $W test:firefox tests/firefox/frame-focus.test.ts`: 2 passed.
  2. The 16 files in one tab: `TABS=1 run.sh t6-16 $W test:firefox tests/browser/${^F16}.test.ts` (zsh's `${^…}` puts
     each name in the path), then `targets.py $RSET t6-16` and `python3 -I $R/scripts/pr2/errdiff.py focusobs-1 t6-16`.
     Expected, as the probe (`p16-step.log`): 0 outside R; NEW 0, and DIFF rows only where the record holds the new
     first error for that case in a run without the step (`grep -F '<title>' $R/logs/*/*-failures.tsv`), as about-menu's
     two, `<a href="/about.html" …>` and `<body>`, each are (§3.4); the five M2's step cleared pass: view-keys' "arms on
     the prefix from the source editor, shows the keys, and leaves on Escape without a mark", view-keys-focus's "stays
     on the toggle the keys leave as the only one pressed, …", lsp-hover's "opens on F2, closes on the next caret move,
     and leaves pointer hover working", state-diagram-no-machine's "hands the focus to the local level itself when a
     compile empties i…" and vim-keymap's "mounts in vim because storage said so, not because the control was touched";
     the focus-kind failures are the four of §3.4's table that `FOCUS` matches (lambda-display, live-views-bound-switch,
     view-keys-focus's "goes to + view …", view-toggles), and about-menu's case fails, a fifth when its first error is
     `<body>` (Task 6's `t6-16`: 5; the probe: 4). A NEW row, or a DIFF whose new first error no run without the step
     holds for that case, is a failure the step causes, which C1 cannot see: a finding. Record the counts (the probe: 25
     failed, 138 passed, 3 skipped). `targets.py` exits 1 here: F4 reads `NOT met` and C7 reads 28 of T3's cases `not
     run`, since the 16 files hold neither self-test and 9 of the 37. Each failure C1 lists goes in the outside-R record
     with its alone run, as in Task 3.
  3. `run.sh t6-chromium $W test:browser tests/browser/engine.test.ts tests/browser/focus.test.ts`: all passed. It
     shows that the setup file does not break Chromium; that Chromium installs no step rests on the `!CHROMIUM` gate,
     which a Chromium run cannot tell from a step that does nothing there.
  4. The whole tier at the script's count, the rest at 6, the first run that can meet F4: `SAMPLE=1 run.sh t6-firefox $W
     test:firefox`, then `targets.py $RSET t6-firefox`: F4 met, C8 0, C9 0, C4 the rest at peak 6 and 9 capture files at
     peak 1. Each failure C1 lists goes in the outside-R record with its alone run, as in Task 3.
  5. `pnpm exec biome ci --error-on-warnings` and `flock ~/temp/redextape-heavy.lock pnpm run typecheck`: exit 0.

- [ ] **Step 4: Commit** (heavy lock; `git add web/tests/browser/firefox-input.ts
  web/tests/firefox/frame-focus.test.ts`):

```
In Firefox the test frame is given the focus before every `focus()` it would otherwise ignore, the app's own included, through the setup file's wrapper of `HTMLElement` and `SVGElement`'s `focus`, and `frame-focus.test.ts` checks a case's first such call and a later one
```

- [ ] **Step 5: Sabotages, in `$S` moved to the commit.**
  - **S3.** The step's `if (!document.hasFocus()) window.focus()` is removed. `run.sh t6-s3 $S test:firefox
    tests/firefox/frame-focus.test.ts`: both cases fail at their `activeElement` assertion. `TABS=1 run.sh t6-s3-16 $S
    test:firefox tests/browser/${^F16}.test.ts`: view-keys-focus's "stays on the toggle the keys leave as the only one
    pressed, …", lsp-hover's "opens on F2, …" and state-diagram-no-machine's "hands the focus to the local level
    itself …" fail, as each did in every 16-file run without a step that ran it (4 of 4, 4 of 4, 3 of 3). view-keys'
    "arms on the prefix …" and vim-keymap's "mounts in vim …" are recorded either way: each also passed without a step
    in other one-tab runs (`focusfix-base-1` and `focusfiles-1tab-cpu100`; `tabs1-1`), so a pass of either is not S3
    failing to fire. **From Task 9's commit on (`66ff467`) the 16-file half no longer fires:** the setup file's
    `window.focus()` at each file's start gives the frame the focus before a file's first `focus()`, so with the step
    removed the three pass (`t9-s3-16`: 23 failed, 140 passed, 3 skipped, the three and the other two passed, C1 0),
    and `t8-16-win-1`'s step fired on 0 of its 257 calls. From there S3 is its first command's alone: both
    `frame-focus.test.ts` cases, which move the focus to the top document themselves (`t9-s3`: both fail at their
    `activeElement` assertion), the step's reach past a case's first `focus()` (decision 4) being S9's. From fix
    round B's `0ff60cd` the file's first case is the setup call's, which passes under S3 (`frb-s3`).
  - **S9.** The step acts on a case's first `focus()` only: `let armed = true` and a `beforeEach(() => { armed = true
    })` before the loop, and in the wrapper `if (armed) { armed = false; if (!document.hasFocus()) window.focus() }`.
    `run.sh t6-s9 $S test:firefox tests/firefox/frame-focus.test.ts`: "does so for a later focus() …" fails at "the
    later button took the focus", and the first case passes. It fires the same at Task 9's commit (`t9-s9`), and at
    fix round B's (`frb-s9`), where the other two cases pass.

---

### Task 7: The timeout invariant's scope (§4.8)

**Files:**
- Modify: `web/tests/node/browser-timeout-invariants.test.ts`, `web/tests/browser/until.ts` (one sentence of its doc)

- [ ] **Step 1: Widen the scan.** `testFilesUnder` becomes `modulesUnder` and collects every `.ts` file
  (`entry.name.endsWith('.ts')`), still reading directories by `dirent.isFile()`; its doc says why: helper modules
  call `until` too, `engine.ts` and the fixtures among them, and a number passed there is as unbounded as one in a
  test file. No count or list of those modules goes in the comment: that is spec §4.8's measurement, and it goes false
  when a fixture gains or loses a call. `numericTimeoutSites` with its default directory scans `DIR` and
  `` `${DIR}../firefox/` `` (named `FIREFOX_DIR`), naming each hit by its path from `DIR`, so a hit there reads
  `../firefox/<file>:<line> passes <n>`. `FIREFOX_DIR` may be missing only under `REDEXTAPE_SCAN_DIR` (an older tree
  may have none): a normal run reads it unconditionally, so a wrong path throws instead of scanning nothing. Given
  another directory it scans that alone, as the self-test cases need. "no file under tests/browser re-declares until
  locally" reads the same two directories and leaves out `` `${DIR}until.ts` ``, the one declaration, by path.
  - Every comment that names `testFilesUnder` names `modulesUnder` (its four are in the top doc, the specifier
    paragraph and two cases' docs), and the text that gives the scope as `tests/browser/` alone names both
    directories: the top doc's "Every wait in `tests/browser/`", the two case names "no until call site under
    tests/browser passes …" and "no file under tests/browser re-declares until locally", and `numericTimeoutSites`'
    doc, which opens "Scans `dir` (by default `tests/browser/` and `tests/firefox/`) for …". The top doc's bullet
    becomes:

```
 * - a call site in a test file or a helper module, nested arbitrarily deep under `tests/browser/` or
 *   `tests/firefox/`, while ignoring a directory whose own name ends in `.ts` (`modulesUnder`);
```

  - **Each edited comment block keeps its counted line count**: the top doc has 20 and `numericTimeoutSites`' 8, and
    the guard fails a block over 8 that grows (`blockFailures` in `scripts/check-comments.mjs`).
  - `until.ts`'s doc: "fails if a call site in a `.test.ts` file under `tests/browser/` passes a numeric timeout"
    becomes "fails if a call site under `tests/browser/` or `tests/firefox/` passes a numeric timeout", the same
    length: its block has 28 counted lines.
  - One new case after "the scanner sees a numeric timeout reached through both recursion and an aliased relative
    import": a throwaway directory with `zz-helper.ts` calling `until(() => true, 'x', 5)` is reported, matched as its
    neighbours are, `expect.stringMatching(/^zz-helper\.ts:\d+ passes 5$/)`. A literal `zz-helper.ts:` with a line
    number in the source fails `check-citations.sh`.

- [ ] **Step 2: Checks.** `pnpm exec vitest run --project node tests/node/browser-timeout-invariants.test.ts`: 16
  passed (15 and the new case). `git grep -n testFilesUnder -- web` prints nothing. `node scripts/check-comments.mjs
  --base HEAD`, `pnpm exec biome ci --error-on-warnings` and `flock ~/temp/redextape-heavy.lock pnpm run typecheck`:
  exit 0.

- [ ] **Step 3: Commit** (heavy lock; `git add web/tests/node/browser-timeout-invariants.test.ts
  web/tests/browser/until.ts`):

```
The browser tier's timeout invariant reads every module under `tests/browser/` and `tests/firefox/`, not only the test files under `tests/browser/`, so a numeric timeout in `engine.ts`, a fixture's `until` or a Firefox self-test fails it as one in a test file does
```

- [ ] **Step 4: S5, in `$S` moved to the commit.** Save `$S`'s `web/tests/browser/engine.ts`,
  `web/tests/firefox/two-browsers.test.ts` and `web/tests/node/browser-timeout-invariants.test.ts` to `$R/sab/` as
  `t7-<name>.orig` first. Then `engine.ts`'s `until(…, \`a pointer move on the page after two hovers, in
  ${server.browser}\`)` and `two-browsers.test.ts`'s `until(rest, …)` each gain `, 10_000`. From `$S/web`, `pnpm exec
  vitest run --project node tests/node/browser-timeout-invariants.test.ts`: `1 failed | 15 passed (16)`, the received
  list naming both, `../firefox/two-browsers.test.ts:<its line> passes 10_000` and `engine.ts:<its line> passes
  10_000` (54 at `ec4f11a`, 63 once Tasks 4 and 5 have added nine lines to the `BrowserCommands` block above it).
  The control: with the invariant test as at `ec4f11a` in place (`git -C $S show
  ec4f11a:web/tests/node/browser-timeout-invariants.test.ts`), the same command passes, `15 passed (15)`, since it
  reads neither a helper module nor `tests/firefox/`. Restore the three files from the saved copies, and `cmp` each
  with its copy and with `git -C $S show HEAD:<path>`.

---

### Task 8: The focus failures the step does not reach (§4.6), the investigation

Five of §3.4's table fail with the step on every `focus()` (Task 6 Check 2), and the extend-focus-probe leak is open.
about-menu's case is not one the step can reach: it fails on its last assertion, the focus back on its button after
Escape, which the popover's own hiding moves, with no `focus()` call (`wireMenu` sets `autofocus` and calls none), so
its trace is in the instrument's `focusin` and `focusout` lines, not its `focus()` lines. Its first error is `<a …>`
in some runs and `<body>` in others, each with and without a step (§3.4); Task 6's report (plan difference 1, with
fix round A's citations) has the runs.
§4.7 also puts storage-blocked's and view-keys-focus's `view.hasFocus` waits here: each is in scope if it fails in
Step 3's runs.
This task answers §4.6's three questions for each and writes the findings; it commits nothing. If it passes about 120
tool calls, it writes a HANDOFF in its findings file for a second dispatch.

**Files:** none tracked. Untracked while it runs, in `$W/web/`, removed after: `vite.focus.config.ts` and
`tests/zz-pr2/focus-trace.ts`, kept in `$R/scripts/pr2/`. Writes `$R/logs/pr2/t8-*` and
`$R/tasks/pr2/t8-focus-findings.md`.

- [ ] **Step 1: The instrument, `$R/scripts/pr2/focus-trace.ts`,** after M2's `focus-observe.ts`
  (`$R/pr2/untracked/web/tests/zz-pr2/`): one `FFTRACE` line per programmatic `focus()` (the file, the case, the
  element's tag and id or first class, `document.hasFocus()` before and after, whether the step fired, what
  `document.activeElement` became), one per `focusin` and `focusout` on the frame's document (target, related target),
  and one `FFTRACE-FILE` line with the file before in the tab (`window.top.__redextapeFiles`, which `collect.ts` keeps).
  It wraps `focus` after `firefox-input.ts` does (Step 2), so the step fired on a call exactly when the frame lacked the
  focus before it. Its precondition, as `focus-probe.test.ts`'s instrument case: its own first line moves the focus to
  the top document and requires `document.hasFocus()` false and a `focusout` heard, else it throws. No `blur` counter
  (M1 found the frame's `blur` blind). `console.error` only.

- [ ] **Step 2: The probe config, `$R/scripts/pr2/vite.focus.config.ts`:** it imports `./vite.config` and, for both
  Firefox projects, puts `tests/zz-pr2/focus-trace.ts` in `setupFiles` after `firefox-input.ts` and before
  `setup.ts`, so that its wrapper of `focus` is the outer one and sees each call before the step does. With
  `PR2_ONE_PROJECT=1` it keeps the `firefox` project alone, with `CAPTURE_FILES` taken out of its `exclude` and
  `pointerCaptureRefused` false (the leak's pair has a capture file), so that extend-focus-probe and
  step-focus-recording share a tab; and it sets the root `test.sequence.sequencer` to a `BaseSequencer` subclass
  (`vitest/node`) whose `sort` keeps the files in the order `PR2_ORDER` lists (comma-separated paths): documented
  config, no internals.

- [ ] **Step 3: The runs,** 1 to 4 with `CONFIG=vite.focus.config.ts`, each followed by `targets.py $RSET <label>`:
  1. The 16 files in one tab, twice: `TABS=1 run.sh t8-16-<n> $W test:firefox tests/browser/${^F16}.test.ts`.
  2. Each of the five alone in one tab (`t8-alone-<file>`), with `-t '<title>'`, and the whole file for the chained
     ones, live-views-bound-switch and view-toggles (§3.6).
  3. Each after the file that ran before it in a failing run (from its `FFTRACE-FILE` line), in one tab, under
     `PR2_ONE_PROJECT=1 PR2_ORDER=<before>,<it>`.
  4. The leak, with `P=tests/browser/extend-focus-probe.test.ts` and `Q=tests/browser/step-focus-recording.test.ts`:
     `PR2_ONE_PROJECT=1 PR2_ORDER=$P,$Q TABS=1 run.sh t8-leak-<n> $W test:firefox $P $Q`, three times; the log's
     `FFTRACE-FILE` lines show the order. F3's target: "⏭ at a `budget` stop hands the focus to ▶, …" passes 3 of 3.
  5. The full tier in one tab at the head, F2's run: `TABS=1 SAMPLE=1 run.sh t8-1tab $W test:firefox` (tracked
     config), then `targets.py $RSET t8-1tab`; every focus-kind failure it lists joins this task's scope, and is run
     as in 2 and 3.

  Each failure these runs list outside R goes in the outside-R record with its alone run, as in Task 3 (ruling 5,
  "Yes, every run").

- [ ] **Step 4: The findings,** `$R/tasks/pr2/t8-focus-findings.md`: for each failure, its first error, the runs it
  failed and passed in, and (a) whether a later `focus()` found the frame without the focus and the step met it, (b)
  whether the file before left the focus outside the frame, (c) whether it is an engine difference in focus, with the
  `FFTRACE` lines that show it. Then its outcome: **the frame's focus**, with the fix Task 9 makes (in `web/tests`
  alone); **an engine difference**, recorded with its evidence for the roadmap entry and PR 3 (§2, decision 3); **a
  product bug**, which STOPS this task: report it with its evidence, for the user (A3). Append a line to
  `$R/progress.md`. Remove the untracked files; `git -C $W status --porcelain` is empty.

---

### Task 9: The fixes §4.6 calls for (F1, F3)

Runs only for the failures Task 8 found to be the frame's focus; if it found none, this task records that and
commits nothing. Each fix is in `web/tests` alone (A3), keeps its test's user path real (no synthetic `.click()`), and
waits only with `until` at its default.

**Files:** the test files or `firefox-input.ts`, as Task 8's findings name them.

- [ ] **Step 1: Each fix,** as Task 8's findings give it, with its why in a comment where the code does not say it.

- [ ] **Step 2: Checks.**
  1. F1: Task 6 Check 2's command (`t9-16`): 0 focus-kind failures but for those Task 8 recorded as engine
     differences, each named.
  2. F3: Task 8 Step 3.4's command (`t9-leak-<n>`, three times): the case passes 3 of 3, in a run whose log shows the
     order.
  3. Each changed file alone in one tab, and at the script's count (the rest at 6) with a rest file beside it: no new
     failure.
  4. S3's first command in `$S` at this commit (`run.sh t9-s3 $S test:firefox tests/firefox/frame-focus.test.ts`) still
     fails both `frame-focus.test.ts` cases.
  5. `biome ci`, `typecheck`; Chromium for each changed test file (`run.sh t9-chromium $W test:browser <files>`): all
     passed.

  Each failure Checks 1 to 3 list outside R goes in the outside-R record with its alone run, as in Task 3.

- [ ] **Step 3: Commit** (heavy lock), one per fix, each named for what it changes.

---

### Task 10: The whole-branch gate

**Files:** none, unless a check fails. A fix is its own commit, named for what it changes, and the checks it touches
are run again. `$S` is moved to `$W`'s head first (`git -C $S checkout -q --detach <head>`).

- [ ] **Step 1: CI's `web` job, in order, from `$W/web`, each logged to `$R/logs/pr2/t10-<step>.log`.** Under the
  heavy lock: `pnpm install --frozen-lockfile`, `pnpm run build:wasm`, `pnpm run build:lsp-wasm`, `pnpm run
  build:bindings`. Then `../scripts/check-licences.sh --self-test && ../scripts/check-licences.sh`, `pnpm exec biome ci
  --error-on-warnings`, `flock ~/temp/redextape-heavy.lock pnpm run typecheck`, `run.sh t10-coverage-head $W
  test:coverage` and, under the heavy lock, `pnpm run build:app`. Expected: each exits 0. Record `test:coverage`'s `All
  files` row.

- [ ] **Step 2: The coverage at the base.** `git diff --stat ec4f11a -- crates` is empty, so `$S`'s copied `pkg` is
  the base's build. `git -C $S checkout -q --detach ec4f11a`, `git -C $S status --porcelain` empty, then `run.sh
  t10-coverage-base $S test:coverage`: exit 0, and its `All files` row equals the head's (§6.1). Then `git -C $S
  checkout -q --detach <head>`.

- [ ] **Step 3: The scans, from `$W`.** Each of `scripts/check-text-bytes.sh`, `check-citations.sh`,
  `check-attributions.sh`, `check-doc-figures.sh`, `check-shared-docs.sh`, `check-colours.sh`, `check-grammar-wasm.sh`
  and `check-lua.sh` with `--self-test` and then without; `node scripts/check-comments.mjs --self-test` and `node
  scripts/check-comments.mjs --base ec4f11a`. Expected: every one exits 0.

- [ ] **Step 4: Chromium and the opt-in, as today (§6.1).**
  1. `run.sh t10-chromium $W test:browser`: the files and tests of `t1-chromium`, all passed, `numPendingTests` 0, no
     `Errors` line.
  2. `run.sh t10-test $W test`, then `grep -oE '\|[a-z-]+( \([a-z]+\))?\|' <log> | sort -u` prints `|browser
     (chromium)|` and `|node|` alone.
  3. Unset, `pnpm exec vitest run --project firefox` and `pnpm exec vitest run --project firefox-capture` each stop with
     "No projects matched", exit 1; `REDEXTAPE_FIREFOX=1 pnpm run test:coverage` stops with `@vitest/coverage-v8 does
     not work with`, exit 1. Then the coverage check, one run through the script's own entry point, both projects
     together and the rest at 6: `SAMPLE=1 run.sh t10-coverage $W test:firefox --coverage`, then `targets.py $RSET
     t10-coverage`. It exits 1 with one `Prepare Error` and one `Run Error`, "CDP session is only available in
     Chromium", for each file, its tests running and its JSON written (fix round B at `0ff60cd`, `frb-coverage`: 216
     files, `Errors 432 errors`, `Tests 100 failed | 1372 passed | 15 skipped (1598)`, 221 s, 5.84 GiB; C4 met, the rest
     at 6 and the capture group at 1 inside its span; C1 1, buffer-cool-warm's case, a row of the outside-R record).
     `vite.config.ts`'s and `collect.ts`'s comments say so. This check does not hold F4: under `--coverage` a file
     loses its last results (in the JSON, `pending`: `frb-coverage` 111 of 1,598; this step's `t10-coverage` and its
     re-run `t10-coverage-2` 219 and 251, frame-focus's three cases among them), so `targets.py` may read F4 `NOT met`
     here, and its C1 sees only the cases with a result. F4 is judged on Step 5's full runs. The check's failures
     outside R still are the outside-R record's rows, with their alone runs, and block as any run's (the user,
     2026-11-04: "Yes, they block too"). Fix round A's four rows came from direct `--project` calls, which put the rest
     at Vitest's 12 tabs and leave `firefox-capture` without the `firefox` project two-browsers waits for: the user
     ruled them explained (2026-11-04: "Explained, don't block"), so they take no cause-finding.
  4. `git diff --stat ec4f11a -- .forgejo` is empty; `git diff --stat ec4f11a -- scripts` is empty or names
     `scripts/comment-budget.json` alone; `git diff ec4f11a -- web/vite.config.ts | grep -c thresholds` gives 0;
     `git diff --stat ec4f11a -- web/src` is empty.

- [ ] **Step 5: Cause 1's targets (§6.3), and R6's test of cause 3.** Two full runs as `test:firefox` makes them, the
  rest at 6 tabs, and one at 3, each with `SAMPLE=1`: `run.sh t10-r6-1 $W test:firefox`, `t10-r6-2`, and `TABS=3 …
  t10-tabs3-1`. Then `python3 -I $R/scripts/pr2/targets.py $RSET --floor <Task 1's floor> --tabs default t10-r6-1
  t10-r6-2` and `… --tabs 3 t10-tabs3-1`. Expected, in each, and exit 0: C1 0 outside R, tests and whole files; C2 0; C3
  the floor; C4 the rest at peak 6 (3 in `t10-tabs3-1`) and the capture group at peak 1, its start and end inside the
  rest's span; C5 at most 300 s at 6 (M3's R6: 229 and 198 s) and 450 s at 3, and a miss with a load above 80 at the
  lock is run again before it counts; C6 at most 8 GiB at 6 (M3's R6: 5.30 and 5.25 GiB) and 4.5 GiB at 3; C7 37 of 37;
  C8 0 and C9 0, over every error of each failure; F4 met, every case of both self-test files; each label's last line
  `not met: none`. A failure of one of Task 2's 32 cases here is a row of this task's in the outside-R record (Names,
  spec §6.2).

- [ ] **Step 6: The alone rule (§6.2; ruling 5, "Blocks now" and "Yes, every run").** Its input is the outside-R
  record: Tasks 2 to 9's rows, and this task's, since each failure Step 5 lists outside R goes in it with its alone
  run, as in Task 3. First, a sweep that nothing was missed: `python3 -I $R/scripts/pr2/targets.py $RSET <label>…`
  over every Firefox run of Tasks 2 to 9 in `$R/logs/pr2/` but the sabotages' and the alone runs' (each task names its
  sabotage labels; Task 2's with `--config $R/pr2/capfiles.txt`), measure 3's `m3-r6-1` and `m3-r6-2` (`--config
  $R/pr2/capfiles-8.txt`) and the R6 probe's `r6-base-12`, `r6-default`, `r6-tabs3`, `r6-tabs1` and `r6a-filtered`
  (`--logdir $R/logs/pr2-r6 --config $R/pr2/capfiles-8.txt`; `$R/logs/pr2-r6/targets.out`); every failure its C1 lines
  list is in the record, and one that is not is added now, with its alone run at the head. Then, for each row:
  - **Task 2's rows** (32 distinct cases): no cause-finding each. Their class cause is cause 3 (Task 2; spec §3.8),
    which R6 answers, and Step 5's runs test it; a case of them that failed there is a row of this task's and takes
    the bullets below.
  - **It failed alone:** PR 2's regression at its commit, which stopped its task; it is in the report with what was
    done about it.
  - **It passed alone,** at whatever commit: a cause-finding like Task 2's, at the head, in
    `$R/tasks/pr2/t10-causes.md`: the failure read from its run (the files in flight beside it, the load, the file
    before it in its tab); reproduced under its run's configuration, three runs, and three more under `PROPS='-p
    CPUQuota=50%'` if none fails; alone, three times; where the time goes, from an untracked timed copy as Task 2
    Step 4's; and the cause in one sentence with the evidence. Then one of Task 2 Step 5's three outcomes: a cause
    PR 2's design removes (cause 1 or 2), named with the task that removes it and the head runs that show it gone; a
    fix in `web/tests` inside the spec's scope, made in its own commit with the alone rule's runs passing; or
    **anything else (the case's length under load, an engine difference, a product bug, a fix outside `web/tests`),
    which STOPS this task, for the user.** Each cause-finding may be its own dispatch, handing off through
    `t10-causes.md`.
  - A popover assert with no wait (header-menus-narrow's `openAt`, share-popover's, §4.7) that fails here is probed
    for a menu that opened late (an untracked copy with an `until` on the menu's open) before any change is proposed.

  **Either way, report each failure with its first error, its alone run and its cause, for the user, before Step 7.**

- [ ] **Step 7: Cause 2's targets (§6.4), each run at the head.** Task 9's `t9-16` and `t9-leak-1` to `-3` ran on a
  dirty tree at `e305ab5` (`dirty=2`), and test files changed after them, so F1 and F3 are run again. F1: Task 6
  Check 2's command, `t10-16`, about-menu's case read by name (§6.4 F1). F2: `TABS=1 SAMPLE=1 run.sh t10-1tab $W
  test:firefox`, then `targets.py $RSET t10-1tab`: each focus-kind failure it lists is one of Task 8's findings,
  none of them the frame's focus; and `errdiff.py t1-base-1tab t10-1tab`, one tab against one tab, whose DIFF lines
  show a failure inside R whose first error PR 2 changed, which C1 cannot see. F3: Task 8 Step 3.4's command,
  `t10-leak-1` to `-3`. F4: in each run of Step 5. F1 to F3 are read by name against Task 8's findings, not by
  `targets.py`'s exit status.

- [ ] **Step 8: The sabotages' record.** `$R/tasks/pr2/` holds each of S1 to S11 and the precondition sabotage of
  Task 5 with its command, its log and what failed; one that did not fire as the spec names it is a finding, reported
  here. Then `git -C $W worktree remove --force $S` (its copies are untracked), and `git -C $W worktree list` no longer
  shows it.

---

### Task 11: The roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (append, last in the file)

- [ ] **Step 1: Write the entry,** after Task 10 and after the final code commit, in the shape of the entries above
  it: a `####` heading that says what PR 2 does, with the date, the branch `firefox-contention`, the range from
  `ec4f11a` to the last code commit, its commit count, "plus this entry"; then `#####` sections.
  - **WHAT CHANGED**, one bullet per commit, with its SHA (the spec's commits included).
  - **THE USER'S DECISIONS:** approach D and cause 2 in PR 2 (2026-11-04), the six answers to the spec's §10 at
    `08ec2b4`, "Blocks now" on parked-copy-editor-mount's failure, "Yes, every run" on the alone rule's reach (on
    the plan's pre-flight), "R6: one Firefox, 6 tabs" on Task 2's STOP (measure 3's figures), "Yes, they block too"
    on the Firefox coverage check's failures outside R, and "Explained, don't block" on fix round A's four rows from
    its direct `--project` calls, one line each, dated.
  - **WHAT THIS DID NOT CLOSE,** each with where it goes:
    - PR 3: each engine difference in focus Task 8 recorded, with its evidence (its `FFTRACE` lines, its runs);
      header-menus-narrow's 9 (the gutter); PR 1's list for PR 3. Task 8 recorded two (`$R/tasks/pr2/t8-focus.md`),
      each still failing with Task 9's fix in place (`t9-16`; `t9-leak-1` to `-3`):
      - view-keys-focus's "goes to + view when the window is narrowed past 40rem, …" ("the focus is not on + view in
        the narrow window, at once: expected `<body>`"). `style.css`'s `@media (max-width: 40rem)` rule hides the
        views toggles at the style update, and Firefox blurs the focused toggle (`focusout button.view-toggle
        rel=null`) before it dispatches the media query's `change` event (`media-change matches=1 … active=body`), on
        which `main.ts`'s `placeToggles` calls `handOff`, which then finds `<body>` and moves nothing; Chromium's order
        lets the listener see the toggle focused (`t8-alone-view-keys-focus-none`; the same order in `t8-16-none-1`).
        It failed in every Firefox run of Task 8, alone included, and passes in every Chromium run of the record. It
        is user-visible in Firefox: a user who narrows the window with the focus on a toggle is left on `<body>`,
        which the hand-off exists to prevent (whether a top-level window's resize orders the two as the test frame
        does is unmeasured). Its fix is in `web/src` (A3).
      - extend-focus-probe's "hiding the focused continue button, or disabling a focused button, strands focus on
        body". Its `extend.focus()` takes (`focus() button.extend before=0 step=1 … took=1`), and the assertion right
        after `extend.hidden = true`, that `activeElement` is `<body>`, reads `expected <button …(2)> to be <body>`;
        the frame's `focusout button.extend rel=null` comes later. Firefox keeps a just-hidden focused element as
        `activeElement` until a later style update, where Chromium answers `<body>` at once. It failed in all 7 of
        Task 8's leak runs; the file probes the engine, so no app path is shown wrong by it.
    - PR 4: the caret cluster, the view-keys caret test included ("a key held down > acts once with Ctrl held through
      a held ], and its repeats are not the editor's", §3.5), which runs in `firefox-capture` and failed there in each
      of D's runs; and `targets.py`'s rule that holds view-keys' failures in its shape in R until PR 4 (spec §6.2).
    - PR 5: both Firefox projects in the `web` job; memory and wall time on the runners (measured on this machine
      only: the rest at 6, and at 3 + 1); Firefox as root, unmeasured.
    - U2's follow-up: a file that holds a press across `page.mouse` commands joins the capture list.
    - parked-copy-editor-mount's cause (Task 2: cause 3, answered by R6), what Step 5's runs showed of Task 2's 32
      cases, and each cause the alone rule found (Task 10 Step 6, over the outside-R record), with the user's ruling
      on each.
    - The frame-focus step's `SVGElement` half and its reach into a file's own hooks are held by the code's shape, a
      two-prototype array and no per-case state, not by a case: `frame-focus.test.ts` focuses buttons inside cases,
      and no `focus()` in `web/src` targets an SVG element at `085874c` (Task 6's review, M2).
    - The setup file's `window.focus()` at each file's start (Task 9, `66ff467`): its presence is held by
      `frame-focus.test.ts`'s first case (fix round B, `0ff60cd`; S11) in every `firefox` run of the file, and not in
      `firefox-capture`, where the file does not run. Its sufficiency, a focused start letting a real click's or a
      popover's `autofocus` focus reach its element after a file whose frame ended focused, is held by runs alone:
      F1's 16 files hold about-menu, lambda-display, live-views-bound-switch and view-toggles; F2's full one-tab run
      those, add-view-floor, follow-kept and view-header; F3 the leak's victim; each run at the head in Task 10 Step
      7. `e305ab5` is that commit without the call, where Task 8's `none` runs fail them. A two-file pair for it
      needs the record's untracked `Ordered` sequencer (`vite.focus.config.ts`): Vitest orders files by cached
      duration and size.
    - The product reads a user's scroll of a following grid only from its `scroll` event, so a redraw that lands
      between a real wheel scroll and its event could take the scroll back; a key that scrolls detaches at once and
      has no such window. It was seen only as state-diagram-no-machine's test race (Task 10c, `6f19fe8`); whether a
      real gesture can land in that window is unmeasured. Where it goes is the user's call.
    - The whole-branch review's "For the roadmap entry" list, as fix round B carries it
      (`$R/tasks/pr2/fix-round-b.md`).
    - Anything Tasks 1 to 10 found that is not fixed.
  - **VERIFICATION.** Every figure names its command and log: Task 1's base runs (counts, floor, R's size, the capture
    instrument's 8 files); Task 2's and measure 3's figures behind cause 3 and R6, and the R6 probe's peaks
    (`$R/logs/pr2-r6/`); the `All files` rows at `ec4f11a` and the head; the Chromium counts; each of Task 10's runs
    with `targets.py`'s C1 to C9 and F4 lines, the wall times, loads and memory peaks; F1, F2 and F3 with their runs;
    and each sabotage, S1 to S11 and Task 5's precondition, with what failed. The record is
    `~/temp/redextape-firefox-ci-record/` (`logs/pr2/`, `tasks/pr2/`).

- [ ] **Step 2: Check and commit.** `scripts/check-doc-figures.sh` and `scripts/check-citations.sh` pass (the hook
  runs both). Commit:

```
The roadmap's entry for Firefox PR 2: the browser tier in two Firefox projects split by pointer capture, the rest at 6 tabs, the guard and the two checks that hold the split, the frame-focus step, what it measured, and what it leaves to PRs 3 to 5
```

---

## Spec coverage

| Spec | Where |
|---|---|
| §2 decision 5, "Blocks now": parked-copy-editor-mount | Task 2; Task 11's DID NOT CLOSE |
| §2 decision 5, "Yes, every run": a failure outside R in any run of PR 2 | The outside-R record (Names; Tasks 2-9); Task 10 Step 6 |
| §2 R6 and §4.1's tab count: the rest at 6 from `test:firefox`'s environment | Task 3 Steps 2-5 (`t3-firefox`'s C4, `t3-tabs1`); C4 in Tasks 4-6 and 10 |
| §3.8 cause 3; §6.2's rule for Task 2's 32 cases | Task 2 (done); the outside-R record (Names); Task 10 Steps 5-6; Task 11 |
| §4.1 two projects, options, names, script, `provide`, setup list, commands | Task 3 Steps 2-3; Task 4 Steps 1-2; Task 5 Step 1 |
| §4.2 the capture list, the list's check | Task 3 Steps 2-3, S7; Task 4 Step 4; Task 1 Step 5 confirms the 8 |
| §4.3 the capture guard | Task 4 Step 3; S1, S2, S10; C8 in Tasks 4 and 10 |
| §4.4 the two-browsers invariant | Task 4 Steps 1, 4; S4, S6; F4 |
| §4.5 the frame-focus step | Task 6; S3, S9 |
| §4.6 the focus failures the step does not reach, the leak | Task 8; Task 9; F1, F2, F3; the setup call's case and S11 (fix round B) |
| §4.7 PR 1's "For PR 2" list | Tasks 3-9 as §4.7 places each; Task 11 |
| §4.8 the timeout invariant's scope | Task 7; S5 |
| §4.9 the view-keys caret test | R (Task 1); Task 11's DID NOT CLOSE |
| §4.10 the one-at-a-time check | Task 5 (the `aroundAll`); S8; C9 |
| §5 README, comments, the roadmap entry | Task 3 Step 4; Task 4 Step 5; every commit's hook; Task 11 |
| §6.1 Chromium and coverage | Task 1 Step 2; Task 10 Steps 1, 2, 4 |
| §6.2 the base, R, its whole files, the alone rule | Task 1; Task 3 Step 1 (`targets.py` reads R's files); the outside-R record; Task 10 Step 6 |
| §6.3 C1-C9 | Task 10 Step 5 (C4 and C8 earlier in Tasks 3-5) |
| §6.4 F1-F4 | Task 6 Checks 2 and 4; Task 8; Task 9; Task 10 Step 7 |
| §6.5 S1-S11 | Task 3 (S7); Task 4 (S1, S2, S4, S6, S10); Task 5 (S8); Task 6 (S3, S9); Task 7 (S5); fix round B (S11); Task 10 Step 8 |
| §6.6 the rest of the `web` job | Task 10 Steps 1, 3; every commit's hook |
| §9 left to the plan | `CAPTURE_FILES` exported from the config (Task 3); the poll (Task 4 Step 4); the messages (Tasks 4-5); Biome and `tsc` on `fileParallelism` (probed: no warning); the order (above); the comment budget (probed within it); §4.10's reply and hooks, its `'end'` when a file's own hooks fail (Task 5 Step 2's `aroundAll`, probed in the fix round) |
