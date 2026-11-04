# Firefox PR 1: a local Firefox project, with the Chromium-only tests gated — design

The user's request (2026-11-03): run the web browser tier and the wasm boundary in Firefox in CI. His rulings:
fix every Firefox failure first and switch CI on last, with no expected-to-fail marks and no advisory job, in five
pull requests, one at a time: (1) a local Firefox project, with the Chromium-only tests gated; (2) tab contention;
(3) engine-difference test fixes; (4) the caret bug, after step-focus merges; (5) CI switch-on, with Playwright's
Firefox in both tiers and geckodriver pinned.

This document covers PR 1 only. Code facts were read at `e9bbf67` (#161), which `origin/main` was when fetched on
2026-11-03. The base measurement is `~/temp/redextape-firefox-ci-record/measure-report.md`, taken at the same commit
with Playwright 1.64.1 (Firefox 157.0, `firefox-1555`; Chromium 156.0.8078.4, `chromium-1248`) and Vitest 4.1.12.
Its logs and scripts are beside it, and "the record" below means that directory. The probes in §2.5 were run for
this design in `~/temp/redextape-firefox-local` at the same commit, with the same browsers.

## §1 Intent, goals, anti-goals

**Why.** Firefox cannot run the browser tier as it is. `collect.ts`, the first setup file of every browser file,
throws without Chromium's `gc`, and 17 tests use what only Chromium has. Until there is a Firefox run whose failures
are all Firefox's own, PRs 2 to 4 have nothing clean to measure.

**Goals.**

- G1. A Firefox project that a developer runs with one command, and that nothing else runs.
- G2. Firefox's cluster (a) at 0. The 15 tests that need an API only Chromium has are skipped in Firefox, each
  with its reason, and still run in Chromium. The 2 tests that failed only because one of them failed first pass.
- G3. Firefox's 19 unhandled errors at 0. All 19 come from synthetic pointers that carry Chromium's mouse id.
- G4. Chromium and the coverage gate as they are today.

**Anti-goals.**

- A1. No CI change. CI's `web` job runs `pnpm run test:coverage`, and that must resolve the same two projects as
  today.
- A2. No change to the tab count, to focus handling or to any tolerance. PRs 2 and 3 own those.
- A3. No change to app behaviour. The `src/` edits are comments alone: `separator.ts`'s, which states Chromium's
  pointer id as if every engine used it, and the three that say the browser tier runs Chromium only or needs Chrome,
  two in `style.css` and one in `session-worker.ts` (§4).
- A4. No Chromium test changes the gesture it makes, except panel-boundaries' finger case, which becomes a real
  touch (U1, §7).

## §2 What exists

### §2.1 The browser project

- `web/vite.config.ts` has two projects, `node` and `browser`. `browser` has one instance,
  `{ browser: 'chromium' }`. Vitest prints it as `browser (chromium)` (the base logs), and `--project browser`
  selects it.
- Its provider is `playwright({ launchOptions: { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] } })`.
  Both flags are Chromium's: `frame-cost.test.ts` needs both, and `collect.ts` needs the second.
- Coverage uses the v8 provider and sits at the `test` root, so one `vitest run --coverage` merges both projects.
  Its floors are lines 97, functions 97, branches 89 and statements 95. The config's own comment says v8 works only
  because `instances` names Chromium alone.
- The browser project lists two setup files, `collect.ts` and then `setup.ts`, and `sequence.setupFiles: 'list'`
  runs them in that order. `global-setup.ts` hands pages `coverageOn` through `provide`, the project's `provide`
  carries two probe run stamps, and the seven probe files are excluded unless `REDEXTAPE_PROBE` is set.
- No test or source file branches on the engine. The report grepped `tests/` and `src/` for `server.browser`,
  `userAgent` and `'firefox'` and found nothing.

### §2.2 Who runs Vitest

- `web/package.json`:
  - `test` is `pnpm run build:bindings && vitest run`, which runs both projects.
  - `test:browser` is `vitest run --project browser`.
  - `test:coverage` is `vitest run --coverage`.
  - Each `test:probe*` script sets `REDEXTAPE_PROBE=1` and runs `--project browser` on named files.
- CI's `web` job runs `pnpm exec playwright install --with-deps chromium` and `pnpm run test:coverage`.
- Nothing else runs Vitest: no other job, no script under `scripts/` (`check-all.sh` included) and no pre-commit
  hook. `grep -rn vitest scripts/ .forgejo/workflows/ci.yml .pre-commit-config.yaml` finds nothing, and
  `grep -n 'pnpm run test' .forgejo/workflows/ci.yml` finds only `test:coverage`.

### §2.3 `collect.ts`

1. It throws `BLOCKED` if `globalThis.gc` is missing.
2. When `coverageOn` is set, it stops V8's precise coverage over CDP.
3. It calls `gc()` twice. When coverage is on, it adds a last-resort collection and starts coverage again.
4. It counts the earlier pages of its tab that are still alive. It holds them as `WeakRef`s on `window.top`, and
   throws when more than `MOST_PAGES_ALIVE` (8) are alive.

All of this is Chromium's. In Firefox, a page has no `gc` and no `performance.memory` (P1), and CDP is absent.

### §2.4 The base, in Firefox

From the report, with its commands:

- **Run 1**, `scripts/run-web.sh firefox-full firefox`, on a tree with `firefox-measure.patch` applied. The patch adds
  an environment switch for the instance, and a `collect.ts` that skips `gc` and logs where the guard would throw.
  - 212 files, 1,540 tests: 1,370 passed, 145 failed, 25 skipped.
  - 19 unhandled errors, 12 tabs, wall 160.9 s.
- **Run 2**, the same plus one diagnostic line: 139 failed, 2 skipped, 19 unhandled errors.
- **Chromium**, `run-web.sh chromium-full chromium`, on the pristine tree: 1,540 of 1,540 passed, 0 skipped, wall
  73.3 s.

**Cluster (a).** `python3 -I scripts/cluster.py logs/firefox-full-failures.tsv logs/firefox-rerun-1tab-failures.tsv`
sorts run 1's cluster (a) into CDP 10, CDP cascade 2, heap harness 4 and AltGraph 1. That is 17 tests in 7 files. The
same command over `logs/firefox-full2-failures.tsv` gives the same 17 for run 2.

**The 17 include the 2 cascades.** "145 − 17 − 2" would count them twice. The correct arithmetic is 145 − 17 = 128
for run 1, and 139 − 17 = 122 for run 2.

**The 19 unhandled errors** are all `NotFoundError: Element.setPointerCapture: Invalid pointer id`, thrown by
`separator.ts`'s capture: divider-drag 9, panel-boundaries 7, panel-regions 2, layout-view 1. Both runs have the same
19 sites, grouped from each log's `[Unhandled error]` blocks by their first test-file frame. No test failed on them,
but they fail the run.

**Pages kept alive.** With no collection, a Firefox tab held up to 13 earlier pages. In run 1, 22 files started with
more than 8 alive.

### §2.5 Probes for this design

Each probe ran from `web/` as `flock ~/temp/redextape-browser.lock pnpm exec vitest run --config
~/temp/redextape-firefox-ci-record/scripts/pr1-probes/probe.config.mjs [flags]`. That config has a `browser` project
(Chromium, with its two flags) and a Firefox project, and runs only the probe file. Each probe file was copied into
`tests/browser/` for its run and deleted afterwards. The sources, the flags of each run and the logs are in the
record's `scripts/pr1-probes/` and `logs/pr1-probes/`. Nothing tracked changed.

- **P1, engine and heap** (probe1). `server.browser` reads `chromium` and `firefox`, and `server.provider` reads
  `playwright`. In Chromium `gc` is a function and `performance.memory` reads a heap size. In Firefox both are
  `undefined`. The base run 1's patch also branched on `server.browser === 'firefox'`, and the log line printed only
  in that branch appears in its log: `grep -c FIREFOX-ALIVE logs/firefox-full.log` gives 44, two lines for each of
  the 22 files over the bound.
- **P2, pointer capture** (probe1, and probe2 in one Firefox tab).
  - Chromium: a synthetic `pointerdown` with id 1 is captured on a fresh page; ids 0 and 2 throw `NotFoundError`.
  - Firefox, fresh page: ids 0, 1 and 2 all throw `NotFoundError`.
  - Firefox, after one real `userEvent.hover`: the hover's `pointermove` carries id 0, and id 0 is now captured,
    including as `pointerType: 'touch'`. It still is 500 ms later, and after `document.body` is replaced. The next
    file in the same tab, which made no input of its own, has it captured too. Id 1 is never captured.
  - Real ids: a real hover and click carry 1 in Chromium and 0 in Firefox.
- **P3, skip notes** (probe1 and probe3).
  - `ctx.skip(condition, note)` skips when the condition is true. The verbose reporter prints the note beside the
    test: `↓ |firefox (firefox)| … [NOTE-GATE the reason]`. The JSON report marks the test `skipped` and drops the
    note.
  - `afterEach` still runs for a test skipped this way.
  - `it.for([...])('… %s', (row, ctx) => …)` hands the test its context and keeps the `%s` names.
- **P4, project filters** (probe4, probe5). With a second project named `firefox`, or named `browser-firefox`,
  `--project browser` runs Chromium alone (1 test).
- **P5, v8 coverage with a Firefox project present.**
  - No project filter (probe6): Vitest stops at startup with `@vitest/coverage-v8 does not work with { browser: {
    provider: playwright(), instances: [ { browser: 'firefox' } …`, exit 1.
  - `--project browser` (probe7): runs, with coverage.
  - `--project firefox` (probe8): coverage-v8's browser module fails with `CDP session is only available in
    Chromium`, exit 1.
- **P6, Playwright's collection** (probe9). The run is eight one-test files in one tab
  (`VITEST_MAX_WORKERS=1`). Each file awaits a Vitest browser command that calls Playwright's `page.requestGC()`,
  and then counts the earlier pages still alive.
  - In both engines, 1 page is alive before the call and 0 after it, in every file from the second on.
  - Each call took 25-28 ms in Firefox (47 ms in the first file) and 6-8 ms in Chromium.
  - playwright-core 1.64.1 sends Juggler's `Heap.collectGarbage` for it in Firefox, and CDP's
    `HeapProfiler.collectGarbage` in Chromium.
- **P7, clipboard** (probe10). Playwright's `grantPermissions(['clipboard-read', 'clipboard-write'])` fails in
  Firefox with `Unknown permission: clipboard-read`. Even so, in Firefox a click's `navigator.clipboard.writeText`
  and the same page's `readText` both succeed, and the text read back is the text written.
- **P8, an unknown project** (probe11): `Error: No projects matched the filter "nope".`, exit 1.

## §3 Design

### §3.1 The Firefox project

- **One definition, two projects.** `vite.config.ts` builds `browser` and `firefox` from one shared definition,
  `browserProject`, a function of the project's name, its engine, its provider (`browser`'s carries Chromium's launch
  options) and the browser commands it registers. The two then cannot drift in `include`,
  `exclude` (the probes stay out of both), `setupFiles`, `globalSetup`, `provide` or `server.fs`.
- **Name `firefox`.** Vitest prints it as `firefox (firefox)`, and `--project browser` does not select it (P4).
- **Opt-in.** The project is in `projects` only when `REDEXTAPE_FIREFOX` is set, tested as `REDEXTAPE_PROBE` is.
  - Unset, the config resolves the same two projects as today. `pnpm test`, `pnpm run test:browser` and
    `pnpm run test:coverage` then run what they run today, and so does CI.
  - Set, an unfiltered run with coverage stops at startup, and `--project firefox --coverage` fails before any test
    runs (P5). Those are loud refusals, not a quiet Chromium-only report.
- **Script.** `"test:firefox": "REDEXTAPE_FIREFOX=1 vitest run --project firefox"`.
  - A developer installs the browser once, with `pnpm exec playwright install firefox` (Playwright 1.64.1 installs
    `firefox-1555`).
  - File filters and reporter flags pass through, as they do for `test:browser`.
  - `README.md`'s Checks section says so, says that `--reporter=verbose` prints every skip's reason where the
    default reporter leaves some out, and says that the run still has known failures, which later PRs fix.
- **Provider.** `playwright()` with no launch options, since both flags are Chromium's.
- **Command.** The Firefox project registers one Vitest browser command, `requestGC`, which calls Playwright's
  `page.requestGC()` on the test's page (P6). `collect.ts` calls it (§3.3).
- **Tab count.** PR 1 sets none, so Vitest uses its default, as `browser` does: 12 tabs on this machine (the
  report). PR 2 owns contention and measures it against the default the base used. A lower count here would move
  the 45 contention failures the report counts, and mix PR 2's subject into PR 1's measurement.
  - A one-tab run is `VITEST_MAX_WORKERS=1 pnpm test:firefox`, as in the report's re-run. `--maxWorkers` does not
    reach browser tabs.
  - At 12 tabs, the base run's scope used 7.6-8.4 GiB (`MemoryCurrent`). A smaller machine sets the variable.

| | Approach | Why not / why |
|---|---|---|
| 1 | A third project, always in the config | Rejected. `pnpm test` would run it, and `test:coverage` stops at startup (P5) unless every script names its projects |
| 2 | A second instance in `browser`, behind the variable | Rejected. The instances share the parent's name, so `--project browser` selects both, and each instance needs its own launch flags |
| 3 | A second config file | Rejected. It is a second root to keep in step: `sequence.setupFiles`, the coverage block, `server.fs` |
| 4 | A third project, added only under `REDEXTAPE_FIREFOX` | **Chosen.** It is the probes' own pattern, and unset the config is today's |

### §3.2 How a test knows its engine

- **`server.browser`, from `vitest/browser`.** `@vitest/browser` 4.1.12's `context.d.ts` declares
  `server.browser: string`, documented as "Name of the current browser", and P1 reads it as `chromium` and
  `firefox`.
  - Not `provide`: that would be a second source for what the instance already says, with one key per project to
    keep in step with `instances`.
  - Not `navigator.userAgent`: that is a string the engine writes, which the test would have to parse.
- **A new file, `web/tests/browser/engine.ts`.** It imports only `vitest`, `vitest/browser` and `until.ts` (§3.5), none
  of which imports `src`, so `collect.ts`, which imports nothing of `src`, may import it.
  - `CHROMIUM`: `server.browser === 'chromium'`.
  - `chromiumOnly(ctx, reason)`: the first statement of a test that needs what only Chromium has. It is
    `ctx.skip(!CHROMIUM, reason)`. In Chromium it returns and the test runs as it does today. In any other engine
    the test is skipped, and the verbose reporter prints the reason beside it (P3).
  - `mousePointerId()`: see §3.5.
- **One shape.** Tests skip for an engine only through `chromiumOnly`. They do not use `it.skipIf` or
  `describe.skipIf`, which print no reason and cannot gate one row of a table. To gate a row, the table is written
  with `it.for`, which hands each row its context and keeps the names (P3). Setup code (`collect.ts`) reads
  `CHROMIUM`.
- **Hooks.** A skipped test's `beforeEach` and `afterEach` still run (P3), so any hook a gated test relies on must
  work in every engine itself. Share-popover's `afterAll` is the only such hook (§3.4).
- **A self-test, `web/tests/browser/engine.test.ts`,** with two cases:
  1. **The gate.** A case records that it was entered, calls `chromiumOnly`, and records that it got past the call.
     The file's `afterAll` runs only if the case was entered, so a `-t` filter that leaves the case out cannot trip
     it. It expects the case to have got past exactly when `server.browser === 'chromium'`.
     - The check compares against the raw value, not against `CHROMIUM`, so a wrong `CHROMIUM` also fails it.
     - **This is what stops a gate from hiding a Chromium regression:** a helper that skipped in Chromium would fail
       Chromium's run.
  2. **The pointer id.** A synthetic press made with `await mousePointerId()`, on an element whose `pointerdown`
     captures the pointer, is captured without a throw.

  With this file, Chromium has 213 files and 1,542 tests.

### §3.3 `collect.ts` in Firefox

- **In Chromium, it is unchanged, line for line:** the `gc` check, the coverage stop and start, and the collections.
- **In any other engine:**
  - There is no `gc` check and no coverage call, because coverage cannot run there (P5). An unfiltered run stops at
    startup. `--project firefox --coverage` fails in coverage-v8's own browser module before any test runs.
  - The page collects with `requestGC` in place of `gc`. In P6 that freed the previous file's page in every file of
    a one-tab run, at 25-28 ms a file in Firefox.
- **The guard runs in both engines, with the same bound, 8.** The page list and its `WeakRef`s are unchanged.
  - §5.2 T5 measures whether real Firefox pages stay under the bound.
  - If any file trips the guard, the plan stops and reports to the user. It does not raise the bound or drop the
    guard, because a trip means Firefox keeps pages alive that Chromium frees.
- **Comments.** `collect.ts`'s doc block is already over the comment guard's 8-line cap, so it cannot grow. The
  reason for the other-engine branch goes in its own block of 8 lines at most.

### §3.4 The Chromium-only tests

All 15 are gated and none is rewritten. Each row starts its test with `chromiumOnly(ctx, …)`, and the reason column is
what that call says. A `U2` in it marks a case U2's follow-up could bring to Firefox; it is not part of the reason
string. With the finger case (§3.5, U1), Firefox skips 16 tests by design.

| File | Test | API | Decision | Reason |
|---|---|---|---|---|
| focus-press | a first press into the TM copy at 390×844, the focus in the source view > maximises the copy’s outline from a tap, in Explorer | CDP `Input.dispatchTouchEvent` (a tap) | gate | `vitest/browser` sends no touch, and CDP's touch is Chromium's |
| focus-press | a press whose release never comes > leaves a keyboard’s focus move after a cancelled touch drawn at once | CDP `Input.dispatchTouchEvent` (start, cancel) | gate | as above, and only CDP sends a cancelled touch |
| focus-press | … > draws a press’s focus move when the window loses the focus before the release | CDP `Input.dispatchMouseEvent` (press held, no release); `Runtime.evaluate` on the top page | gate | `userEvent` cannot hold a press; U2 |
| focus-press | … > draws a right press’s focus move at its contextmenu, before the release | CDP `Input.dispatchMouseEvent` (right press held) | gate | as above; U2 |
| focus-press | … > draws a focus move made while a press on a `<select>` is held, at once | CDP `Input.dispatchMouseEvent` (press held) | gate | as above; U2 |
| frame-cost | frame cost > measures bytes per span by heap differential, not JSON size | `performance.memory`, `gc` | gate | Firefox gives a page neither (P1), and the figures are V8 heap bytes |
| frame-cost | rxm frame cost > measures bytes per rxm word by heap differential, and the ring charges at least that | `performance.memory`, `gc` | gate | as above |
| session-memory | session memory > measures three sessions at four legs against one session at two | `performance.memory` (`requireHeapHarness`) | gate | as above |
| session-memory | session memory > measures what a leg of history really costs against what the ring charged it | `performance.memory` (`requireHeapHarness`) | gate | as above |
| lambda-follow | a λ view whose box changes size under it > stays following when the WINDOW grows and its clamp is reported before its resize | CDP `Emulation.setDeviceMetricsOverride` | gate | it resizes the top-level window, which no `vitest/browser` call does; U2 |
| share-open-clamps | an open's clamps > takes a press on undo, held while a clamp redraws the open's notice, as a click, and undoes the open | CDP `Input.dispatchMouseEvent` (press held) | gate | `userEvent` cannot hold a press; U2 |
| share-popover | share > copies the link on a click, and says so | CDP `Browser.grantPermissions`, `Target.getTargetInfo` | gate | Firefox has no clipboard permission to grant (P7); U2 |
| share-popover | share > says the link is selected in the field when the clipboard refuses it | CDP `Browser.setPermission` (denied) | gate | Playwright's Firefox knows no clipboard permission (P7), so no refusal can be set |
| view-keys | view keys > is not armed by a prefix pressed during a composition | CDP `Input.imeSetComposition` | gate | neither `vitest/browser` nor Playwright has an input-method call, and CDP's is Chromium's |
| view-keys | view keys > stays armed through AltGraph pressed alone, and the key after it acts | `userEvent.keyboard('{AltGraph}')` | gate this row of the `it.each`, rewritten as `it.for` | Playwright's Firefox fails the press: `keyboard.down: Protocol error (Page.dispatchKeyEvent)` |

**Chromium still runs every one of them.** Its run must show 0 skipped (§5.1), and S1 (§5.3) shows each one failing
in Chromium when its body is sabotaged.

**The 2 cascades in share-open-clamps:**

- "names every leg the run ended short of in one notice, with the open’s undo, and says it"
- "withdraws the clamp's undo at the next edit that changes the program"

These get no gate. The CDP case sets `holding = true` before its first CDP call and calls `letGo()` only after it, so
in Firefox it throws with every later compile held, and the next two cases time out. Gated as the case's first
statement, it never sets `holding`. The report ran the two cases without the CDP case
(`-t 'names every leg|withdraws the clamp'`, `logs/clamps-noncdp.log`), and both passed.

**Share-popover's `afterAll`** resets the permissions over CDP (`Browser.resetPermissions`). In Firefox that failed
the suite, outside the 145. After PR 1, the hook resets only if a case set a permission: each of the two gated cases
sets a flag just before its first CDP call. The hook then branches on what a case did, not on the engine. In
Chromium, when both cases run, it does exactly what it does today.

**Why no rewrite.** Every engine-neutral route either needs a new Playwright command (a held press with `page.mouse`,
a window resize with `page.setViewportSize`, a permission grant through the context), or has no Firefox equivalent
at all (touch, an input method, heap readings, AltGraph). P7 shows the copy case could run in Firefox, but only behind
a grant that knows the engine. Those commands are U2's follow-up, after PR 5 (§7).

### §3.5 The synthetic pointers

**Why a fixed id cannot work (P2).** In Firefox, `setPointerCapture` throws for a synthetic id until real mouse input
has reached the tab. After that it accepts 0, Firefox's mouse id, and never 1. Chromium accepts its id, 1, on a page
with no input. A fixed id per engine would therefore pass or throw depending on which file the tab ran before.

**PR 1's change.** Every site's `pointerId: 1` becomes the id that a real pointer move on the page reported, from
`mousePointerId()` in `engine.ts`. The function:

- is memoised per page;
- hovers a temporary fixed element at two different points, so that the second hover is a move from the first,
  wherever the mouse started. Each point gets a fresh `position` object, because `userEvent.hover` scales its
  `position` in place;
- resolves with the `pointerId` of the last `pointermove` it heard, and removes the element;
- waits for that move with `until` at its default bound, so a move that never comes fails naming the engine.

**`until` moves to a module free of `src` (the user's ruling, 2026-11-03).** `harness.ts` imports `src`, so
`engine.ts` cannot import it. `until`, with `sourceOf` and `MAX_SOURCE_CHARS`, moves to a new
`web/tests/browser/until.ts` that imports nothing. `harness.ts` re-exports it, so none of its 164 importers changes
(157 test files and 7 helper modules), and `engine.ts` is its one new importer. The code moves unchanged, and so does
its doc but for one sentence, which says the invariant test fails for a numeric timeout in a `.test.ts` file under
`tests/browser/`, the only files it scans. The browser tier keeps one bound, which
`tests/node/browser-timeout-invariants.test.ts` reads from `until.ts`; its alias check matches an import from either
module. The plan's probe shows `collect.ts` loading `engine.ts` and `until.ts` and no module of `src`, in both
engines (`logs/pr1-plan-probes/order-chromium.log`, `order-firefox.log`).

Each file awaits the id once, in a `beforeAll` that runs before its first mount, and its event helpers read the
result. Panel-regions' helper is a closure inside one test, and it reads the id its file's `beforeAll` took, so the
hover comes before the λ view mounts (the user's ruling, 2026-11-03).

In Chromium, the hover also moves the real mouse to the temporary element's corner. Chromium's full run (§5.1)
measures any effect that has on these files.

**Why no site becomes a real gesture in PR 1.** Every site but three needs something the driver's one-move
`userEvent.dragAndDrop` cannot do, and the table says what. The three it could carry go to U2's follow-up with the
rest, because converting them changes what Chromium runs (A4), and whether real Firefox input is dependable is still
an open question for PR 2.

The handles these sites drive are also dragged for real elsewhere:

- `divider-drag-focus` and `default-views-gestures` drag the dividers with `userEvent.dragAndDrop`;
- panel-boundaries' `drag()` cases and panel-regions' first-drag cases drag the boundaries for real.

| File | Test | Synthetic events | What the driver cannot do | PR 1 |
|---|---|---|---|---|
| divider-drag | dragging a divider on a mounted app > does not destroy the divider being dragged | down, 3 moves, up | a check between moves | reported id |
| divider-drag | … > tracks the pointer for the whole drag, not one frame of it | down, 3 moves, up | more than one move: a drag that stops after one frame passes a one-move drag | reported id |
| divider-drag | … > writes storage once for the gesture, not once per frame | down, 3 moves, up | more than one frame | reported id |
| divider-drag | … > keeps aria-valuenow truthful during the drag, not only after it | down, move, up | a check between the move and the release | reported id |
| divider-drag | … > writes nothing for a press and release that never moved | down, up | none: a click carries it (U2) | reported id |
| divider-drag | … > writes nothing for a pointermove that never changes coordinate | down, 2 moves at the press's point, up | a move with no displacement | reported id |
| divider-drag | dragging a divider a second time, after the first drag commits and rebuilds it > moves the layout by both drags in full, off a freshly re-queried divider | 2 × (down, 3 moves, up) | "in full" needs more than one move | reported id |
| divider-drag | a dragged layout across a reload > comes back where it was dragged to | down, 3 moves, up | none: a one-move drag carries the reload claim (U2) | reported id |
| layout-view | renderLayout > reports a resize when a divider is dragged, as a FRACTION of the split — not raw pixels | down, move, up, synchronous, on a stub | none: a one-move drag carries it (U2) | reported id |
| panel-boundaries | a drag of a boundary > stores a share that keeps its ratio, and is not 0, however small the shares it starts from | down, move, up | the boundary is below the window | reported id |
| panel-boundaries | … > ends a key’s gesture on one boundary when another boundary is dragged, and moves the right two regions | down, move, frame, up, with a synthetic held key | a frame between the move and the release | reported id |
| panel-boundaries | … > does not go on holding a pointer’s gesture whose view left the page under the press | down, move, then a release on `document.body` after the view leaves and comes back | a held press; the release must carry the press's id, or `stop` ignores it | reported id, both events |
| panel-boundaries | … > follows a pointer that overshot a floor only once it is back | down, 3 moves, up | a check after each move | reported id |
| panel-boundaries | a panel’s header, as the handle for the boundary above it > leaves a finger’s press alone, which the boundary itself takes | touch down, move, up on the header bar (no capture: the header refuses a finger) and on the boundary | a real touch exists only in CDP | a real touch through CDP in Chromium, gated in Firefox (U1) |
| panel-boundaries | … > draws an open hand at rest and a closed one while it is held | down, up, on the header and on the boundary | checks between press and release | reported id |
| panel-regions | the λ view’s term and its map > keeps the term’s rows over its whole box at every frame of a drag, and the map drawn at its height (icicle), (minimap) | down, 75 moves with a frame and a check after each, up | a check at every frame | reported id |
| pane-floor (a probe, outside both default sets) | a pane at the floor > reports what each pane kind shows when driven to MIN_PANE_FRACTION | 2 × (down, move, up) | moves to x −2000 and y 5000, outside the window | reported id |

**The finger case (U1).** It sends a real finger through CDP's `Input.dispatchTouchEvent`, as focus-press's `tap`
does: a start at the bar's centre in page coordinates, a move of 60 px scaled by the frame, a frame, and the end; then
the same on the boundary. It checks that the bar is not drawn held right after the press. Chromium sends the bar a
`pointercancel` after its first move, since the header leaves a finger's pan to the browser, so the checks after the
release alone would rest on that one move (the plan's probe, `logs/pr1-plan-probes/finger1.log`). The finger is lifted
in a `finally`, so a failed check leaves no touch down for the cases and files after it, and focus-press's `tap` lifts
its finger the same way (the user's ruling, 2026-11-03).

**The `separator.ts` comment.** It says capture throws for any id but 1, "the reserved mouse-pointer id". PR 1
rewords it, one line for one, to say that capture throws for an id the browser does not hold as an active pointer,
which a test's synthetic event can carry.

## §4 What PR 1 changes

- `web/vite.config.ts`: the shared browser-project definition, the `firefox` project under `REDEXTAPE_FIREFOX`, its
  `requestGC` command, and the v8 comment reworded to match (§3.1).
- `web/package.json`: `test:firefox`.
- New: `web/tests/browser/engine.ts` and `web/tests/browser/engine.test.ts` (§3.2).
- `web/tests/browser/collect.ts` (§3.3).
- The gates (§3.4): `focus-press`, `frame-cost`, `session-memory`, `lambda-follow`, `share-open-clamps`,
  `share-popover` (the gates and the hook's flag) and `view-keys` (two gates; `it.each` becomes `it.for`).
- `panel-boundaries`' finger case: a real CDP touch, gated in Firefox (§3.5, U1).
- The pointer sites (§3.5): `divider-drag`, `layout-view`, `panel-boundaries`, `panel-regions`, `pane-floor`.
  Pane-floor's comment on its id, which called `1` the reserved mouse-pointer id, says what `separator.ts`'s does.
- `web/tests/browser/until.ts` (new), `harness.ts` (`until` moved out and re-exported) and
  `tests/node/browser-timeout-invariants.test.ts` (it reads the default from `until.ts`, matches an alias of either
  module, and gains one case for it) (§3.5). Four comments that name `harness.ts` as `until`'s home
  (`buffers-quota`, `buffer-cool-warm`, `tm-reduced-buffer`, `tm-blank-buffer`) name `until.ts`.
- focus-press's `tap` lifts its finger in a `finally` (§3.5).
- Comments that a second browser project makes inexact, one line for one: five in `vite.config.ts` (the `REPO_ROOT`
  comment, the probes' exclusion, the setup files, the setup comment's pointer to `sequence.setupFiles`,
  `passWithNoTests`), and `lsp-hover.test.ts`'s, which says of every engine that Playwright injects keys through CDP.
- `web/src/separator.ts`: the comment only, the sentence after it included.
- `web/src/style.css`: the comments on the `@supports not (position-area: …)` fallbacks of `.view-menu` and
  `.buffer-list`, which say the browser tier runs Chromium only. PR 1 rewords both, one line for one, to say that its
  engines, Chromium and the opt-in Firefox, both have `position-area`, so the fallback fires in neither. Playwright
  1.64.1's Firefox 157.0 and Chromium 156.0.8078.4 both answer `true` to `CSS.supports('position-area: block-end')`
  (the whole-branch review's probe, in the record's `tasks/whole-branch-review.md`).
- `web/src/session-worker.ts`: the comment that says the browser tier needs Chrome says it needs a browser.
- `README.md`: the Checks section's sentences on `pnpm test:firefox` (§3.1).
- A roadmap entry in `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, written before the PR opens, in which
  every figure names its command.
- Comments obey the comment guard: no history, no new block over 8 lines, and no existing block grown. Run
  `node scripts/check-comments.mjs`. If the reasons push `web/tests`' share over its budget, the budget goes up in the
  same diff, to the value the guard reports.

## §5 What PR 1 proves

Every browser run happens under `flock ~/temp/redextape-browser.lock systemd-run --user --scope -q -p MemoryMax=16G
-p MemorySwapMax=0`, from `web/` in this worktree, with `--reporter=verbose --reporter=json
--outputFile.json=<label>.json` and the log written with `>|`; verbose, because only it prints a skip's reason
(P3). Failures are listed with the record's `scripts/failures.py` and sorted into clusters with `scripts/cluster.py`.

### §5.1 Chromium and the coverage gate, as they are today

- `pnpm run test:browser`: 213 files and 1,542 tests, all passed, 0 failed and 0 skipped (`numPendingTests` 0 in the
  JSON), and no `Errors` line in the summary. The base is 212 files and 1,540 of 1,540; the difference is
  `engine.test.ts` alone.
- `pnpm run test:coverage`, run at `e9bbf67` and at the head on the same machine: exit 0 both times, with the four
  figures from its `All files` row recorded for both. No floor is edited:
  `git diff e9bbf67 -- web/vite.config.ts` has no `thresholds` line.
- `pnpm test` prints only the `|node|` and `|browser (chromium)|` tags.
- `pnpm exec vitest run --project firefox`, with `REDEXTAPE_FIREFOX` unset, fails with `No projects matched the
  filter "firefox".` and exit 1 (P8's form).
- `REDEXTAPE_FIREFOX=1 pnpm run test:coverage` stops at startup with P5's coverage-v8 error.
- CI is unchanged: `git diff e9bbf67 --stat -- .forgejo` is empty, and under `scripts` only `comment-budget.json` may
  differ (§4).

### §5.2 Firefox

Two full runs of `pnpm test:firefox`, with the default tab count, then a one-tab re-run of the files that failed
(`VITEST_MAX_WORKERS=1 pnpm test:firefox <files>`), which gives PR 2 its contention split. The targets:

- **T1.** 0 failures among cluster (a)'s 17 tests: the 15 report skipped with their reasons, and the 2 cascades
  pass, in both runs.
- **T2.** 0 unhandled errors: no `Errors` line in the summary, and no `[Unhandled error]` line in the log, in both
  runs.
- **T3. No new failure.** Every failing test must be in the union of the two base runs' failures
  (`logs/firefox-full-failures.tsv` and `logs/firefox-full2-failures.tsv`, 175 tests by the report). A failure outside
  that union is re-run alone in one tab:
  - If it fails alone, it is PR 1's regression, and it blocks the PR.
  - If it passes alone, it is listed as contention, for PR 2.

  T3 covers the hover that `mousePointerId()` adds to four files under 12 tabs.
- **T4. Counts.**
  - 213 files and 1,542 tests.
  - Skipped: 17 by design (the 15 gates, the finger case and `engine.test.ts`'s gate case), plus share-open-deep's 2.
    Add 23 more if tm-view-narrow's `beforeAll` times out, as it did in base run 1.
  - Failed: the measured target is the base less cluster (a), which is 128 under run 1's conditions and 122 under
    run 2's. Contention moved the base by 6 between two runs, so the count is recorded for both runs. T1 to T3 are
    the assertions; the count is not.
- **T5.** The guard: no file fails with "pages this tab ran before this file are still alive", in either run.

### §5.3 Sabotages

Each sabotage is run and seen to fail, in this worktree, which no dev server serves. Before each one, the plan saves a
copy of the file it edits; afterwards it restores the copy and checks it with `cmp`. The outcome named for each is
the expected one. A sabotage that does not fire as named is a finding, reported before the PR opens.

- **S1, gate placement.** A `throw new Error('S1')` is put after each of the 16 `chromiumOnly` calls in the gated
  tests, all at once; for view-keys' AltGraph row it goes inside the row's guard, so the other seven rows do not
  throw.
  - Chromium (`pnpm run test:browser`): exactly those 16 fail, with `S1`.
  - Firefox (`pnpm test:firefox`): those 16 are skipped, and none fails with `S1`.
- **S2, the helper.** `chromiumOnly` skips in every engine. Chromium: `engine.test.ts`'s `afterAll` fails, and the
  JSON shows 17 skipped.
- **S3, the predicate.** `CHROMIUM` compares with a wrong name. `collect.ts` takes the other-engine branch in
  Chromium and calls `requestGC`, which `browser` does not register, so every file fails at setup, `engine.test.ts`
  included, before its `afterAll` can run. S2 shows that `afterAll` failing.
- **S4, a wrong id.** `mousePointerId()` resolves with the id it heard plus 1. In both engines, every synthetic site
  in the default set throws an unhandled `NotFoundError` (18 sites; the finger case, one of the base's 19, is a real
  touch), and `engine.test.ts`'s capture case fails.
- **S5, no hover.** `mousePointerId()` resolves with 0 without hovering. `pnpm test:firefox
  tests/browser/divider-drag.test.ts`, alone in a fresh tab, gives 9 unhandled errors. With the hover restored, it
  gives 0.
- **S6, no collection.** `collect.ts`'s other-engine branch skips `requestGC`. In Firefox, the guard then throws in
  files after a tab's ninth (the base saw 22 files over 8). That shows the guard runs in Firefox, and that the
  collection is what keeps it quiet.
- **S7, the cascade.** Share-open-clamps' CDP case loses its gate. In Firefox it fails, and the two cascades time out
  on "the second clamp" and "the clamp's notice", as at the base.
- **S8, the hook.** Share-popover's reset sends a misspelt CDP method.
  - Chromium: the file's `afterAll` fails.
  - Firefox: unaffected, because no case set a permission.
- **S9, the finger case.** `panel-stack.ts`'s header accepts a finger: the `pointerType === 'touch'` refusal is
  removed. In Chromium the case fails at its check right after the press, that the bar is not drawn held, and no other
  case in the file fails (the plan's probe: 1 failed, 24 passed, `logs/pr1-plan-probes/pb-s9-chromium.log`). Firefox
  skips it.
- **S10, the one bound.** `until.ts`'s default `timeoutMs` is raised to 15,000. `browser-timeout-invariants.test.ts`
  fails "the shared until default is below vitest browser testTimeout".
- **S11, an alias of the moved module.** The invariant's alias patterns match `harness` alone again. Its new case for
  an alias imported from `until.ts` fails.

### §5.4 The rest of the `web` job, locally

- `pnpm exec biome ci --error-on-warnings`
- `pnpm run typecheck`
- `pnpm run build:app`
- `../scripts/check-licences.sh`
- `node scripts/check-comments.mjs`
- the pre-commit hooks on every commit, never `--no-verify`

## §6 Not in PR 1

- **PR 2, tab contention.**
  - Firefox's tab count or file parallelism.
  - Focus: `document.hasFocus()` was false at the start of all 212 files in base run 2.
  - The 16 drags that do not move under 12 tabs, and the 27 tests that pass in one tab.
  - The two `view.hasFocus` waits (`storage-blocked`, `view-keys-focus`).
  - Memory at the slower runner's 3 tabs (report question 5).
  - Whether real Firefox input is dependable, which U2's follow-up depends on.
- **PR 3, engine differences and tolerances.** Clusters 3 to 9 and 11:
  - sub-pixel scroll positions, the wheel, and text metrics;
  - the menus' gutter against the viewport edge;
  - focus semantics;
  - the scroll echo from a box taken off the page;
  - share-open-deep's fixture depth.
- **PR 4, the caret bug.** Cluster 2, 25 tests, after step-focus merges.
- **PR 5, CI.**
  - `playwright install --with-deps firefox` and a `pnpm test:firefox` step in the `web` job, and the job's place in
    `gate`.
  - The wasm boundary's Firefox leg: a `--firefox` leg in `check-all.sh`, `moz:firefoxOptions` in `webdriver.json`,
    and geckodriver pinned, as the user ruled.
  - `v8_native_limits`' Firefox figure (report question 9).
  - U3's check that the Chromium run skips nothing.
- **After PR 5 (U2):** real gestures through Playwright commands for the cases PR 1 gates or leaves synthetic.

## §7 The user's decisions (2026-11-03)

- **U1 = (b), the finger case in panel-boundaries,** "leaves a finger’s press alone, which the boundary itself takes".
  It becomes a real touch through CDP `Input.dispatchTouchEvent` in Chromium, and is gated in Firefox, where
  `vitest/browser` sends no touch (§3.5). S9 and S1 prove it, and Firefox's by-design skips are 17 (T4).
- **U2 = (a), real gestures through Playwright commands,** for what PR 1 gates or leaves synthetic: commands over
  `page.mouse` (a press held, one move at a time), `page.setViewportSize` and the context's permissions. They are a
  follow-up after PR 5, recorded in PR 1's roadmap entry. They could bring 6 gated cases to Firefox (focus-press's 3
  held presses, share-open-clamps' held press, lambda-follow's window, share-popover's copy), and turn the synthetic
  sites into real input in both engines, except where a point lies outside the window or a move has no displacement.
- **U3 = (a), a CI check that Chromium skips nothing,** reading the Chromium run's JSON for `numPendingTests` 0, lands
  in PR 5 with the CI switch-on. In PR 1, §5.1's 0-skipped check is run by hand.

## §8 Designer's calls

Settled by the designer, open to the user's correction:

- The names `firefox`, `test:firefox` and `REDEXTAPE_FIREFOX` (any value turns it on, as with `REDEXTAPE_PROBE`).
- Firefox keeps the pages-alive guard and its bound, collecting through Playwright's `requestGC`. If the guard trips,
  the plan stops and asks the user (§3.3).
- The `requestGC` command is registered on the Firefox project only.
- `engine.test.ts` adds one file and two tests to both engines' counts.
- `mousePointerId()` hovers in both engines, so there is one code path.
- Share-popover's reset is keyed to a flag the cases set, not to the engine.
- `separator.ts`'s comment is corrected, and `README.md`'s Checks section says how to run the Firefox project.

## §9 Left to the plan

- The exact reason strings, within the table's reasons.
- The shared definition's form in `vite.config.ts`.
- The variable names the pointer helpers read.
- Where the `requestGC` command's type declaration lives.
- The order of the tasks, one dispatch per task.
- The `web/tests` comment budget, if the guard asks for a new one.
