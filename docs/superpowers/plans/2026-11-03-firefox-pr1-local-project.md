# Firefox PR 1: a local Firefox project, with the Chromium-only tests gated — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm test:firefox` runs the browser tier in Playwright's Firefox, opt-in and run by nothing else, with
every failure Firefox's own: the 15 Chromium-only tests and the finger case skipped there with their reasons, the 19
unhandled errors gone, and Chromium and the coverage gate as they are today.

**Architecture:** `vite.config.ts` builds `browser` and a `firefox` project from one definition, the second only under
`REDEXTAPE_FIREFOX`. A new `tests/browser/engine.ts` says which engine a page runs in (`CHROMIUM`), gates a test to
Chromium (`chromiumOnly`) and reports the pointer id a real move carried (`mousePointerId`). `collect.ts` collects
through a `requestGC` command outside Chromium and keeps its guard. `until` moves from `harness.ts` to
`tests/browser/until.ts`, which imports nothing, so `engine.ts` can wait on it.

**Tech stack:** Vitest 4.1.12 browser mode, `@vitest/browser-playwright` 4.1.12, Playwright 1.64.1 (Firefox 157.0,
`firefox-1555`; Chromium 156.0.8078.4, `chromium-1248`), TypeScript, Biome.

**Spec:** `docs/superpowers/specs/2026-11-03-firefox-pr1-local-project-design.md` (`acb67fd`: the user's decisions
U1 = (b), U2 = (a), U3 = (a) in §7, and his rulings on the plan's pre-flight, `until` free of `src`, panel-regions'
id and the finger's `finally`, in §3.5). Section numbers below (§3.4, S1, T3) are the spec's.

## Global constraints

- Work only in `~/temp/redextape-firefox-local` (branch `firefox-local`). Never edit or build in
  `/home/davey/projects/redextape`.
- `export CARGO_TARGET_DIR=$HOME/.cache/redextape-firefox-local-target` in every shell that builds or commits: the
  pre-commit hook's `web-typecheck` runs `build:bindings`, a cargo build.
- Heavy runs (the wasm and bindings builds, `pnpm run typecheck` and `pnpm test`, which both run the bindings build,
  `test:coverage`, `build:app`, a commit that touches `web/`) under `flock ~/temp/redextape-heavy.lock`; every browser
  run under `flock ~/temp/redextape-browser.lock`, the heavy lock outside the browser lock when a run needs both. Other
  lanes share both locks.
- Browser tabs are set with `VITEST_MAX_WORKERS=N`, never `--maxWorkers` (it does not reach browser tabs). `-- <name>`
  does not scope files: name the files.
- Where a test claims a user path, real gestures, never synthetic `.click()` or `dispatchEvent`. The reported-id
  sites of Task 3 stay synthetic by the user's U2 ruling, and each already says why the driver cannot carry it.
- No numeric `until` timeouts in browser tests, and no wait of a file's own: every wait is `until` at its default,
  `engine.ts`'s included, which is why Task 1 moves `until` into `until.ts`.
- Sabotages run in the scratch worktree `$S` (below), with `node_modules`, `pkg`, `pkg-lsp` and `bindings` COPIED,
  never symlinked. Before each, save a copy of the file to `$R/sab/`; after, restore it from that copy, then
  `cmp` it with the saved copy and with `git -C $S show HEAD:<path>`. Never `git checkout` to restore.
- The pre-commit hook on every commit (Biome, the eight scans, the licence check, the comment guard, typecheck);
  never `--no-verify`. Format with `pnpm exec biome format --write <files>` before committing.
- A comment says why: no history, no measurements, no `file:line` in tracked source, no block over 8 counted lines
  of text, and `collect.ts`'s doc block does not grow. TypeScript docs use `/** */`. If the guard reports
  `web/tests` over its share, raise `scripts/comment-budget.json` to the value it reports, in the same commit.
- The Bash tool is zsh: `noclobber` is on (write logs with `>|`), and there is no word splitting.
- Nothing is pushed. Each task ends in its own new commit; a fix found later is a new commit, never an amend.

## Names used below

- `W=~/temp/redextape-firefox-local`, the worktree. `S=~/temp/redextape-firefox-local-sab`, the scratch worktree
  Task 1 makes. `R=~/temp/redextape-firefox-ci-record`, the record.
- `$R/scripts/pr1/run.sh <label> <tree> <script> [vitest args]` runs `pnpm run <script>` from `<tree>/web` under the
  browser lock (and the heavy lock outside it with `HEAVY=1`, and always for `test` and `test:coverage`) in `systemd-run
  --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0`, with `--reporter=verbose --reporter=json`. It writes
  `$R/logs/pr1/<label>.log` and `.json`, prints the summary lines and `EXIT=`, and exits with pnpm's status.
  `REDEXTAPE_FIREFOX` and `VITEST_MAX_WORKERS` pass through. Never `run.sh … test` in `$S`: `test` builds the bindings.
- `python3 -I $R/scripts/pr1/targets.py <run.json>…` checks a Firefox run against T1 (the 17 cluster (a) tests: 15
  skipped, 2 passed), T3 (failures outside the union of the base runs' failure lists, 175 tests) and prints T4's
  counts. It exits 1 on a T1 miss or a failure outside the union. On a run without the gated files every T1 row
  reads `0 matches` and it exits 1 whatever the run did: there, read its T3 line alone.
- A run's verbose log marks a skip `↓` with its reason in brackets, a pass `✓` and a failure `×`, each with its
  project tag, `|browser (chromium)|` or `|firefox (firefox)|`.

## What the plan rests on (probed 2026-11-03)

The first probes ran in `$W` at `be23df0` with copies that were deleted after. The second round (the `until` move,
the module order, the finger case in its file, S9 to S11, the comment guard) ran in a scratch worktree at `c6e72ba`,
since removed, with `node_modules` copied and no wasm build. The drafts and their logs are in
`$R/scripts/pr1-plan-probes/` and `$R/logs/pr1-plan-probes/` (`README.txt` there gives each command).

- **The base.** `python3 -I $R/scripts/pr1/targets.py $R/logs/firefox-full.json $R/logs/firefox-full2.json` prints
  T1 0 of 17 (all 17 failed), T3 0 outside the union, and T4 212 files and 1,540 tests, 145 failed and 25 skipped
  (run 1) and 139 failed and 2 skipped (run 2). The Chromium base, `$R/logs/chromium-full.json`, is 212 files and
  1,540 of 1,540 passed, 0 skipped. `grep -c BLOCKED` gives 8 on each base Firefox log (the heap tests, gated in
  Task 2), and `grep -c 'globalThis.gc is unavailable'` gives 0.
- **The finger case is one of the 19 unhandled errors.** In `$R/logs/firefox-full.log` the seven panel-boundaries
  `[Unhandled error]` blocks have their test frame at `panel-boundaries.test.ts` lines 290, 335, 367, 403, 485 (the
  finger case's press on the boundary) and 498 twice. With the finger case a real touch, 18 sites remain:
  divider-drag 9, panel-boundaries 6, panel-regions 2, layout-view 1.
- **The engine helpers** (`engine2.log`, the record's two-project probe config). `mousePointerId()` resolves 1 in
  Chromium and 0 in Firefox, and the move was already heard when the second hover resolved, in both. The gate's case
  passes in Chromium and is skipped in Firefox with its note, and its `afterAll` passes in both. A synthetic press
  with the reported id is captured without a throw in both; the id plus 1 throws `NotFoundError` in both. With the
  final `engine.ts`, which waits with `until` (`engine3-chromium.log`, `engine3-firefox.log`): 2 passed in Chromium;
  1 passed and 1 skipped with its reason in Firefox.
- **`hasPointerCapture` reads `false` after a synthetic press in both engines, even when the capture did not throw**
  (`engine1.log`, where a check on it failed in both; the spec's own `probe1.log` reads `has=false` on every `ok`
  row). The capture case therefore asserts that no throw came, and nothing about `hasPointerCapture`.
- **Types** (`tsc2.log`, the plan's own forms). With `until.ts`, `engine.ts` (its `declare module 'vitest/browser'`),
  `collect.ts` calling `commands.requestGC()`, the shared definition typed `TestProjectInlineConfiguration`
  (`vitest/config`) with commands typed `Record<string, BrowserCommand<[]>>` (`vitest/node`), `harness.ts`'s
  re-export and the invariant test's edits in place, `tsc --noEmit` reports no error in any of them. Its 73 errors are
  the 73 the untouched worktree reports, all from the absent `pkg` and `bindings`. Without the declaration it reports
  `TS2339: Property 'requestGC' does not exist on type 'BrowserCommands'` (`tsc1.log`, an earlier draft that
  augmented `'vitest/internal/browser'`, which typechecks as well).
- **The `until` move** (`inv1.log`, `inv-s10.log`, `inv-s11.log`). With `until`, `sourceOf` and `MAX_SOURCE_CHARS` in
  `until.ts` and re-exported from `harness.ts`, the node run of `browser-timeout-invariants.test.ts` (15 cases with
  the new one) and `harness.test.ts` (14) passes, 29 tests. S10 fails the default's case alone, and S11 the new alias
  case alone. 164 files import `until` from a `harness` specifier, 157 test files and 7 helper modules (a scan of
  every `import { … } from '…harness'` under `web/tests`, the invariant test's quoted samples left out).
- **The module order** (`order-chromium.log`, `order-firefox.log`). At the end of a draft `collect.ts` that listed the
  page's resource entries, both engines had fetched `collect.ts`, `engine.ts` and `until.ts` and no URL under
  `/src/`, in each of two files (`engine.test.ts`, `layout-view.test.ts`).
- **The opt-in** (`ff-unset.log`, `ff-coverage.log`). With the draft config and `REDEXTAPE_FIREFOX` unset,
  `--project firefox` stops with `Error: No projects matched the filter "firefox".`, exit 1. Set, `--coverage` with no
  filter stops at startup with `@vitest/coverage-v8 does not work with`, exit 1.
- **The Firefox project with the draft `collect.ts`** (`ff-e2e1.log`, `VITEST_MAX_WORKERS=1`, the engine probe,
  `layout-view` and `panel-boundaries`, no heap test among them): no `BLOCKED`, no guard trip, 5 failures in
  panel-boundaries, all five in the base union, and 8 unhandled errors, the unconverted sites.
- **A real touch through CDP in Chromium** (`finger1.log`). The tester's frame is scaled (0.72 there), so a move in
  page coordinates is `dy * scale`. On the header bar: `pointerdown` (touch), one `pointermove` at −60 px, then
  `pointercancel`, since the header leaves a finger's pan to the browser. On the boundary (`touch-action: none`):
  down, move, up, and the heap takes the 60 px. Each event had arrived when its CDP call resolved. The case passed.
  In its file, with Task 2's helper and its `finally` (`pb-chromium.log`): 25 of 25 passed. S9 (`pb-s9-chromium.log`):
  1 failed, at "a finger’s press on the bar drew it held", and 24 passed; in Firefox (`pb-s9-firefox.log`) the case
  is skipped with its reason, beside the base's 5 failures and the 6 unconverted sites' errors.
- **The comments** (`guard2.log`). With every comment this plan supplies written into its file, `node
  scripts/check-comments.mjs --base c6e72ba` passes: no history and no grown block in the 10 changed files, and every
  area within its budget. Biome's `ci` passes on them once formatted.
- **The bar's centre is its empty part.** Panel-boundaries' "drags that boundary by a real press on the bar’s empty
  part" presses the bar's centre (`harness.ts`'s `drag`) and passes, so a real touch there reaches the header's own
  press filter, not a control's.
- **No `pkg`, `pkg-lsp` or `web/bindings` in `$W` yet**, and no `$CARGO_TARGET_DIR`: Task 1's first build is cold.
  Playwright's `firefox-1555` and `chromium-1248` are installed (the spec's probes ran both).

## File map

| File | Task | What changes |
|---|---|---|
| `web/tests/browser/until.ts` | 1 | New: `until`, `sourceOf` and `MAX_SOURCE_CHARS`, moved from `harness.ts` unchanged |
| `web/tests/browser/harness.ts` | 1 | `until` imported from `./until` and re-exported; its doc's first sentence |
| `web/tests/node/browser-timeout-invariants.test.ts` | 1 | The default read from `until.ts`; aliases of either module; one new case |
| `buffers-quota`, `buffer-cool-warm`, `tm-reduced-buffer` (`web/tests/browser/*.test.ts`) | 1 | One comment each names `until.ts` |
| `web/tests/browser/engine.ts` | 1 | New: `CHROMIUM`, `chromiumOnly`, `mousePointerId`, the `requestGC` command's type |
| `web/tests/browser/engine.test.ts` | 1 | New: the gate's case and the capture case |
| `web/vite.config.ts` | 1 | One definition for both browser projects; `firefox` under `REDEXTAPE_FIREFOX`; its command; four comments |
| `web/package.json` | 1 | `test:firefox` |
| `web/tests/browser/collect.ts` | 1 | The Chromium path inside `if (CHROMIUM)`; `requestGC` otherwise; the guard in both |
| `README.md` | 1 | One sentence in Checks |
| `focus-press`, `frame-cost`, `session-memory`, `lambda-follow`, `share-open-clamps`, `share-popover`, `view-keys` (`web/tests/browser/*.test.ts`) | 2 | The 15 gates; share-popover's reset flag; view-keys' modifier table as `it.for`; focus-press's `tap` lifts in a `finally` |
| `web/tests/browser/panel-boundaries.test.ts` | 2, 3 | Task 2: the finger case as a real CDP touch, gated. Task 3: its synthetic sites take the reported id |
| `divider-drag`, `layout-view`, `panel-regions`, `pane-floor` (`web/tests/browser/*.test.ts`) | 3 | The reported id at every synthetic site; pane-floor's comment |
| `web/src/separator.ts` | 3 | The capture comment only, its five lines one for one |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | 5 | PR 1's entry, last in the file |

---

### Task 1: `until` free of `src`, the engine helpers, the opt-in Firefox project, and `collect.ts` in every engine

**Files:**
- Create: `web/tests/browser/until.ts`, `web/tests/browser/engine.ts`, `web/tests/browser/engine.test.ts`
- Modify: `web/tests/browser/harness.ts` (`MAX_SOURCE_CHARS`, `sourceOf` and `until` out; the file doc's first
  sentence), `web/tests/node/browser-timeout-invariants.test.ts` (the default reader, the alias patterns, their
  docs, one new case), one comment each in `web/tests/browser/buffers-quota.test.ts`, `buffer-cool-warm.test.ts` and
  `tm-reduced-buffer.test.ts`, `web/vite.config.ts` (the `projects` array; the comments on the probes' exclusion,
  the setup files, `passWithNoTests` and v8), `web/package.json` (scripts), `web/tests/browser/collect.ts` (the
  statements between the file's doc block and `MOST_PAGES_ALIVE`'s doc), `README.md` (Checks, the paragraph ending
  "Recount with `pnpm test`.")

**Interfaces:**
- Produces, from `./until`: `until(predicate, what?, timeoutMs = 10_000, pollMs = 20): Promise<void>`, unchanged;
  `./harness` re-exports it.
- Produces, from `./engine`: `CHROMIUM: boolean`; `chromiumOnly(ctx: TestContext, reason: string): void`;
  `mousePointerId(): Promise<number>`; `commands.requestGC(): Promise<void>` (registered on `firefox` alone).
- Produces: the `firefox` project and `pnpm test:firefox`; `$S`, the scratch worktree later tasks reuse.

- [ ] **Step 1: Build, and make the scratch worktree's inputs.** From `$W/web`, under the heavy lock:
  `pnpm install --frozen-lockfile`, `pnpm run build:wasm`, `pnpm run build:lsp-wasm`, `pnpm run build:bindings`,
  each logged with `>|` to `$R/logs/pr1/t1-build-<step>.log`. Expected: each exits 0; `$W/pkg`, `$W/pkg-lsp` and
  `$W/web/bindings` exist.

- [ ] **Step 2: Move `until` into `until.ts` (the user's ruling of 2026-11-03).** `harness.ts` imports `src`, so
  `engine.ts`, which `collect.ts` loads before any module of `src` compiles, cannot import it.
  - **The new module.** `web/tests/browser/until.ts` holds `MAX_SOURCE_CHARS` with its doc, `sourceOf` and `until`
    with its whole doc, moved from `harness.ts` unchanged, under this header:

```ts
/**
 * The browser tier's one wait, in a module that imports nothing: `engine.ts`, which `collect.ts` loads before any
 * module of `src` compiles, waits on it too. `harness.ts` re-exports it for the test files.
 */
```

  - **`harness.ts`.** `import { until } from './until'` after its last import, for its own 13 calls, and
    `export { until }` at its end. Its file doc's first sentence, "… and the poll helper they wait on; for", becomes
    "… and `until.ts`'s wait, re-exported; for".
  - **The importers.** None of today's 164 importers moves: 157 test files and 7 helper modules
    (`build-reply-fixture`, `editor-view-fixture`, `format-on-leave-fixture`, `lambda-deep`, `lambda-text`,
    `share-open-hashchange-fixture`, `user-event-fixture`) keep `until` from `./harness` (or, in
    `tests/node/harness.test.ts`, `../browser/harness`). `engine.ts` (Step 4) is the one importer of `./until`.
  - **`browser-timeout-invariants.test.ts`, one line for one in every doc.** The top doc: "declared once, in
    `harness.ts`" becomes "in `until.ts`"; "ending in harness>" becomes "ending in harness or until>"; "`harness.ts`'s
    own declared default" becomes "`until.ts`'s". `numericTimeoutSites`' doc: "Both live in `harness.ts`" becomes
    "Both live in `until.ts`". `untilNames`' doc: "ending in harness>" becomes "ending in harness or until>", the
    pattern it quotes becomes `[^'"]*\b(?:harness|until)`, and "module's own name." becomes "name of either module:
    `until.ts` declares the wait, and `harness.ts` re-exports it.". `namedRe` and `namespaceRe` match
    `\b(?:harness|until)['"]` where they match `\bharness['"]`. `declaredTimeoutMsDefault`'s doc and its two error
    messages say `until.ts` where they say `harness.ts`. "the shared until default is below vitest browser
    testTimeout" reads `new URL('../browser/until.ts', import.meta.url)`. After the case "untilNames matches an
    aliased import reached through a relative parent-directory specifier", one new case:

```ts
/** `until.ts` declares the wait that `harness.ts` re-exports, so a name imported from either module is `until`. */
it('untilNames matches an aliased or namespace import of the until module as well as of harness', () => {
  expect(untilNames("import { until as waitFor } from './until'\n")).toContain('waitFor')
  expect(untilNames("import * as u from '../until'\n")).toContain('u.until')
})
```

  - **Three comments that name `harness.ts` as the wait's home** say `until.ts`: buffers-quota's "`harness.ts`'s
    shared default covers it", buffer-cool-warm's "`harness.ts`'s single default" and tm-reduced-buffer's "`until`'s
    doc in `harness.ts`".
  - **Check:** `pnpm exec vitest run --project node tests/node/browser-timeout-invariants.test.ts
    tests/node/harness.test.ts`: 2 files, 29 passed (15 and 14). `grep -n 'harness' <the invariant test>` shows no
    line that names `harness.ts` as where the default or the wait lives.

- [ ] **Step 3: Write `engine.test.ts`, and see it fail.** Its content:

```ts
import { afterAll, expect, it } from 'vitest'
import { server } from 'vitest/browser'
import { chromiumOnly, mousePointerId } from './engine'

/**
 * `engine.ts`'s own checks. The gate's is read in `afterAll` against the engine's raw name, not against `CHROMIUM`,
 * so a gate that skipped in Chromium, or a `CHROMIUM` that read the wrong name, fails Chromium's run.
 */
let entered = false
let past = false

afterAll(() => {
  // A `-t` filter that leaves the gate's case out never enters it, and leaves nothing to check.
  if (!entered) return
  expect(past, `the gate let its test past in ${server.browser}`).toBe(server.browser === 'chromium')
})

it('runs a test behind the gate in Chromium alone', (ctx) => {
  entered = true
  chromiumOnly(ctx, 'the gate’s own case, which runs in Chromium alone')
  past = true
})

it('takes a synthetic press that carries the id a real move reported, and its capture does not throw', async () => {
  const id = await mousePointerId()
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:100px;top:100px;width:100px;height:100px'
  document.body.append(el)
  let thrown: unknown = null
  el.addEventListener('pointerdown', (e) => {
    try {
      el.setPointerCapture(e.pointerId)
    } catch (err) {
      thrown = err
    }
  })
  const at = { bubbles: true, pointerId: id, isPrimary: true, clientX: 150, clientY: 150 }
  el.dispatchEvent(new PointerEvent('pointerdown', at))
  el.dispatchEvent(new PointerEvent('pointerup', at))
  el.remove()
  // THE THROW IS WHAT SHOWS: `hasPointerCapture` reads false after a synthetic press in both engines, taken or not.
  expect(thrown).toBeNull()
})
```

  Run: `$R/scripts/pr1/run.sh t1-red $W test:browser tests/browser/engine.test.ts`. Expected: exit 1, the file
  failing to import `./engine`.

- [ ] **Step 4: Write `engine.ts`.** Its content, as probed (`$R/scripts/pr1-plan-probes/engine.ts`,
  `engine3-*.log`):

```ts
import type { TestContext } from 'vitest'
import { server, userEvent } from 'vitest/browser'
import { until } from './until'

/**
 * What a browser test knows of the engine it runs in. It imports nothing of `src`, because `collect.ts`, which must
 * compile no module of `src` before it has collected, imports it.
 */

declare module 'vitest/browser' {
  interface BrowserCommands {
    /** Playwright's `page.requestGC()`, a full collection, registered by the Firefox project alone. */
    requestGC: () => Promise<void>
  }
}

/** Whether this page runs in Chromium, the one engine with CDP, `gc` and `performance.memory`. */
export const CHROMIUM = server.browser === 'chromium'

/**
 * The first statement of a test that needs what only Chromium has. In Chromium it returns and the test runs; in any
 * other engine it skips the test, and the verbose reporter prints `reason` beside it. A skipped test's `beforeEach`
 * and `afterEach` still run, so a hook such a test relies on must work in every engine.
 */
export function chromiumOnly(ctx: TestContext, reason: string): void {
  ctx.skip(!CHROMIUM, reason)
}

let reported: Promise<number> | undefined

/**
 * The `pointerId` a real pointer move on this page carried, for a test's own synthetic pointer events. No fixed id
 * works in every engine: Chromium's `setPointerCapture` takes 1 on a page with no input, and Firefox's takes no
 * synthetic id until real mouse input has reached the tab, and then takes 0. Once a page, the first call hovers a
 * temporary element at two points, so that the second hover is a move wherever the mouse began.
 */
export function mousePointerId(): Promise<number> {
  reported ??= hoverForId()
  return reported
}

async function hoverForId(): Promise<number> {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:0;top:0;width:40px;height:40px;z-index:2147483647'
  document.body.append(el)
  const ids: number[] = []
  el.addEventListener('pointermove', (e) => {
    ids.push(e.pointerId)
  })
  try {
    // A FRESH `position` EACH TIME: `userEvent.hover` scales the one it is given in place.
    await userEvent.hover(el, { position: { x: 10, y: 10 } })
    await userEvent.hover(el, { position: { x: 30, y: 30 } })
    await until(() => ids.length > 0, `a pointer move on the page after two hovers, in ${server.browser}`)
    return ids.at(-1) as number
  } finally {
    el.remove()
  }
}
```

- [ ] **Step 5: The shared project definition and the Firefox project, in `vite.config.ts`.**
  - Add `type TestProjectInlineConfiguration` to the `vitest/config` import, and `import type { BrowserCommand } from
    'vitest/node'`.
  - Beside `PROBE_EXCLUDE`, add:

```ts
/**
 * Whether this run has the Firefox project: `pnpm test:firefox` sets `REDEXTAPE_FIREFOX`, and nothing else does.
 * OPT-IN, BECAUSE A FIREFOX PROJECT IN EVERY RUN WOULD BREAK TWO OF THEM: `pnpm test` would run it, and an unfiltered
 * run with coverage stops at startup with it in the projects, which `test:coverage`, CI's `web` job, is.
 */
const FIREFOX = process.env.REDEXTAPE_FIREFOX !== undefined

/**
 * A browser project in one engine. Both engines' projects are built here, so they cannot drift apart in the files
 * they run, their setup or what they are given.
 */
function browserProject(
  name: string,
  browser: 'chromium' | 'firefox',
  provider: ReturnType<typeof playwright>,
  commands: Record<string, BrowserCommand<[]>> = {},
): TestProjectInlineConfiguration {
```

  - The function's body returns the `browser` project's object as it is, moved with its comments: `server`, and in
    `test` the `include`, `exclude`, `provide`, `setupFiles` and `globalSetup` entries and `browser: { enabled: true,
    provider, headless: true, commands, instances: [{ browser }] }`, with `name` from the parameter.
  - The `projects` array becomes `node` as it is, then:

```ts
      browserProject(
        'browser',
        'chromium',
        playwright({
          // (the TWO FLAGS comment block, moved here as it is)
          launchOptions: { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] },
        }),
      ),
      ...(FIREFOX
        ? [
            browserProject('firefox', 'firefox', playwright(), {
              // Playwright's own collection, for `collect.ts` in an engine that gives a page no `gc`.
              requestGC: async ({ page }) => page.requestGC(),
            }),
          ]
        : []),
```

  - **Comments the second browser project makes inexact, one line for one** (P5's three outcomes: an unfiltered
    run stops at startup, `--project browser --coverage` runs, `--project firefox --coverage` fails before any test):
    - The two v8 lines above `coverage` become:

```ts
    // v8 works here only because a coverage run starts no Firefox: with `REDEXTAPE_FIREFOX` set, an unfiltered run
    // stops at startup, and `--project firefox` fails before any test runs, rather than under-report.
```

    - `PROBE_FILES`' doc: "excluded from the browser project's default set" becomes "excluded from both browser
      projects' default sets".
    - `sequence`'s comment: "Only the browser project has any, and its first," becomes "Only the browser projects
      have any, and their first,".
    - The `passWithNoTests` comment: "both projects have tests" becomes "every project has tests".
  - `package.json`: after `test:browser`, `"test:firefox": "REDEXTAPE_FIREFOX=1 vitest run --project firefox",`.

- [ ] **Step 6: `collect.ts` in every engine.** Add `commands` to the `vitest/browser` import and `import { CHROMIUM }
  from './engine'`. The statements from `const gc = (` to the closing `}` of `if (coverage) { … }` move, unchanged,
  into `if (CHROMIUM) { … }`. Its `else` branch, then the guard as it is:

```ts
} else {
  // ANY OTHER ENGINE GIVES A PAGE NO `gc`, AND PRECISE COVERAGE IS CHROMIUM'S ALONE: a coverage run that starts the
  // Firefox project fails before any of its tests runs. Playwright's own collection, `page.requestGC()`, frees the
  // earlier pages in its place, through a command only the Firefox project registers (`vite.config.ts`). The guard
  // below holds every engine to the same bound, since a page Firefox keeps alive keeps its WebAssembly memories as
  // Chromium's does.
  await commands.requestGC()
}
```

  The file's doc block is not edited.

- [ ] **Step 7: README.** After "Recount with `pnpm test`." in Checks, one sentence: "`pnpm test:firefox` runs the
  browser tier in Playwright's Firefox (install it once with `pnpm exec playwright install firefox`), where each test
  that needs what only Chromium has is skipped with its reason; nothing else runs it, CI included."

- [ ] **Step 8: Prove it in `$W`.** Each command from `$W/web`; the run labels are the log names.
  1. `run.sh t1-engine-chromium $W test:browser tests/browser/engine.test.ts`: 1 file, 2 passed, 0 skipped.
  2. `run.sh t1-engine-firefox $W test:firefox tests/browser/engine.test.ts`: 2 tests, 1 passed, 1 skipped; the `↓`
     line carries "the gate’s own case, which runs in Chromium alone".
  3. `run.sh t1-chromium $W test:browser`: 213 files, 1,542 tests, all passed; `numPendingTests` 0 in the JSON; no
     `Errors` line.
  4. `run.sh t1-firefox $W test:firefox`: 213 files and 1,542 tests. `grep -c 'globalThis.gc is unavailable'` on the
     log gives 0 (`collect.ts`'s own throw; `BLOCKED` alone still gives 8 here, from the heap tests Task 2 gates), and
     `grep -c 'pages this tab ran before this file are still alive'` gives 0 (T5, early). The `Errors` line reads 19
     errors: the finger case's, which Task 2 converts, and the 18 sites Task 3 converts. Failures are recorded with
     `targets.py`, not asserted (its T1 reads 0 of 17 until Task 2, so it exits 1). **If the guard trips in any file,
     stop and report to the controller (spec §3.3): do not raise the bound or drop the guard.**
  5. `pnpm exec vitest run --project firefox` with `REDEXTAPE_FIREFOX` unset: `Error: No projects matched the filter
     "firefox".`, exit 1.
  6. `REDEXTAPE_FIREFOX=1 pnpm run test:coverage`: stops at startup with `@vitest/coverage-v8 does not work with`,
     exit 1.
  7. `flock ~/temp/redextape-heavy.lock pnpm run typecheck` and `pnpm exec biome ci --error-on-warnings`: exit 0.
  8. Step 2's node check again: 29 passed.

- [ ] **Step 9: Commit,** under the heavy lock with `CARGO_TARGET_DIR` exported:

```
`until` moves to `until.ts`, which imports nothing, and `harness.ts` re-exports it; an opt-in `firefox` browser project, `pnpm test:firefox`, built from the same definition as `browser`; `engine.ts` gates a test to Chromium and reports the pointer id a real move carried, and `collect.ts` collects through Playwright's `page.requestGC()` outside Chromium, under the same pages-alive guard
```

- [ ] **Step 10: Make `$S` at the commit.** `git -C $W worktree add -q --detach $S HEAD`; then `cp -a
  $W/web/node_modules $W/web/bindings $S/web/` and `cp -a $W/pkg $W/pkg-lsp $S/`. Check: `git -C $S rev-parse HEAD`
  equals `git -C $W rev-parse HEAD`, and `git -C $S status --porcelain` is empty.

- [ ] **Step 11: Sabotages, in `$S`, each restored as the Global constraints say.**
  - **S10, the one bound.** `until.ts`: `timeoutMs = 10_000` becomes `timeoutMs = 15_000`. `pnpm exec vitest run
    --project node tests/node/browser-timeout-invariants.test.ts`, from `$S/web`: exactly one case fails, "the shared
    until default is below vitest browser testTimeout" (probed: `inv-s10.log`, 1 failed, 14 passed).
  - **S11, an alias of the moved module.** The invariant test: `namedRe` and `namespaceRe` match `\bharness['"]`
    again. The same command: exactly one case fails, the new "untilNames matches an aliased or namespace import of the
    until module as well as of harness" (probed: `inv-s11.log`).
  - **S2, Task 1's part.** `engine.ts`: `ctx.skip(!CHROMIUM, reason)` becomes `ctx.skip(true, reason)`.
    `run.sh t1-s2 $S test:browser tests/browser/engine.test.ts`: the file fails on its `afterAll`, "the gate let its
    test past in chromium"; the JSON has 1 skipped.
  - **S3.** `engine.ts`: `'chromium'` in `CHROMIUM` becomes `'chrome'`. `run.sh t1-s3 $S test:browser
    tests/browser/engine.test.ts tests/browser/layout-view.test.ts`: both files fail at setup, with an error naming
    `requestGC`, which `browser` does not register. The setup failure comes before `engine.test.ts`'s `afterAll`
    could run (spec §5.3); S2 shows the `afterAll`.
  - **S4, Task 1's part.** `engine.ts`: `return ids.at(-1) as number` becomes `return (ids.at(-1) as number) + 1`.
    `run.sh t1-s4-chromium $S test:browser tests/browser/engine.test.ts` and `run.sh t1-s4-firefox $S test:firefox
    tests/browser/engine.test.ts`: the capture case fails in each, its `thrown` a `NotFoundError`.
  - **S6.** `collect.ts`: the `else` branch's `await commands.requestGC()` is deleted. `run.sh t1-s6 $S
    test:firefox`: `grep -c 'pages this tab ran before this file are still alive'` on the log is at least 1 (the base,
    with no collection, had 22 files over the bound). Record the count and the files.

  Expected: each fails as named. One that does not is a finding: report it, do not adjust the sabotage to fit.

---

### Task 2: The Chromium-only tests gated, and the finger case a real touch

**Files:**
- Modify: `web/tests/browser/focus-press.test.ts`, `frame-cost.test.ts`, `session-memory.test.ts`,
  `lambda-follow.test.ts`, `share-open-clamps.test.ts`, `share-popover.test.ts`, `view-keys.test.ts`,
  `panel-boundaries.test.ts` (the finger case, the file's doc, its imports), all under `web/tests/browser/`;
  focus-press's `tap` too (it lifts its finger in a `finally`).

**Interfaces:**
- Consumes: `chromiumOnly(ctx, reason)` and, in panel-boundaries, `cdp` (`vitest/browser`) and `pageCentreOf`,
  `until`, `frame` (`./harness`).

- [ ] **Step 1: The gates.** Each test below takes `ctx` and starts with `chromiumOnly(ctx, <reason>)`, before
  anything else, `requireHeapHarness()` and any CDP call included. A reason used more than once in a file may be a
  `const` of that file. No other line of these tests changes.

| File | Test (its own title) | Reason |
|---|---|---|
| focus-press | maximises the copy’s outline from a tap, in Explorer | `a tap is CDP’s Input.dispatchTouchEvent, and vitest/browser sends no touch` |
| focus-press | leaves a keyboard’s focus move after a cancelled touch drawn at once | `a cancelled touch is CDP’s Input.dispatchTouchEvent, which only Chromium has` |
| focus-press | draws a press’s focus move when the window loses the focus before the release | `a press held with no release is CDP’s Input.dispatchMouseEvent, which only Chromium has` |
| focus-press | draws a right press’s focus move at its contextmenu, before the release | as above |
| focus-press | draws a focus move made while a press on a `<select>` is held, at once | as above |
| frame-cost | measures bytes per span by heap differential, not JSON size | `its figures are V8 heap bytes, read through performance.memory and gc, which only Chromium gives a page` |
| frame-cost | measures bytes per rxm word by heap differential, and the ring charges at least that | as above |
| session-memory | measures three sessions at four legs against one session at two | as above |
| session-memory | measures what a leg of history really costs against what the ring charged it | as above |
| lambda-follow | stays following when the WINDOW grows and its clamp is reported before its resize | `it resizes the top-level window through CDP’s Emulation.setDeviceMetricsOverride, which only Chromium has` |
| share-open-clamps | takes a press on undo, held while a clamp redraws the open's notice, as a click, and undoes the open | `a press held with no release is CDP’s Input.dispatchMouseEvent, which only Chromium has` |
| share-popover | copies the link on a click, and says so | `it grants the clipboard through CDP, and Playwright’s Firefox knows no clipboard permission` |
| share-popover | says the link is selected in the field when the clipboard refuses it | `it refuses the clipboard through CDP, and Playwright’s Firefox knows no clipboard permission` |
| view-keys | is not armed by a prefix pressed during a composition | `a composition is CDP’s Input.imeSetComposition, which only Chromium has` |
| view-keys | stays armed through AltGraph pressed alone, and the key after it acts | `Playwright’s Firefox cannot press AltGraph: its keyboard.down fails with a protocol error` |

  - **view-keys' modifier table** (`it.each([... 'AltGraph' ...])('stays armed through %s pressed alone, …')`)
    becomes `it.for` with the same rows and title; its callback takes `(modifier, ctx)` and starts with
    `if (modifier === 'AltGraph') chromiumOnly(ctx, <reason>)`. The file's other two `it.each` tables are not
    touched.
  - **share-open-clamps' two cascades** get no gate: with the CDP case gated as its first statement, `holding` is
    never set, so the next two cases compile freely (spec §3.4).
  - **share-popover's `afterAll`** resets only if a case set a permission. A file-level `let permissionSet = false`;
    each of the two gated cases sets it to `true` on the line before its first `cdp().send` (whose argument's
    `await context()` is itself a CDP call); the hook becomes `if (permissionSet) await cdp().send(…)` as it is. Its
    comment says why: the hook branches on what a case did, not on the engine, so a case that ran is always undone.

- [ ] **Step 2: The finger case as a real touch (U1).** In `panel-boundaries.test.ts`:
  - Imports: `cdp` from `vitest/browser`; `pageCentreOf` and `until` beside `./harness`'s others;
    `chromiumOnly` from `./engine`.
  - Under `fire`, a helper, as probed in its file (`$R/scripts/pr1-plan-probes/panel-boundaries.task2.ts.txt`):

```ts
/**
 * A finger's press at `el`'s centre, a move of `dy` px and its release, sent through CDP as a real touch: `pressed`
 * looks right after the press, and `moved` a frame after the move.
 */
async function finger(el: HTMLElement, dy: number, pressed: () => void, moved: () => void): Promise<void> {
  const at = pageCentreOf(el)
  const scale = (window.frameElement as HTMLElement).getBoundingClientRect().width / innerWidth
  let down = false
  let after = false
  const heard = () => {
    after = true
  }
  el.addEventListener(
    'pointerdown',
    () => {
      down = true
    },
    { once: true },
  )
  el.addEventListener('pointermove', heard, { once: true })
  el.addEventListener('pointercancel', heard, { once: true })
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] })
  try {
    await until(() => down, 'the finger’s press')
    pressed()
    await cdp().send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: at.x, y: at.y + dy * scale }],
    })
    await until(() => after, 'the finger’s move')
    await frame()
    moved()
  } finally {
    // LIFTED WHATEVER FAILED: a finger left down would hold the tab's touch for every case and file after this one.
    await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await frame()
}
```

  - The case "leaves a finger’s press alone, which the boundary itself takes" becomes:

```ts
  /** A finger's press on a bar is left alone: a header is most of what a narrow view offers to scroll by. */
  it('leaves a finger’s press alone, which the boundary itself takes', async (ctx) => {
    chromiumOnly(ctx, 'a real touch is CDP’s Input.dispatchTouchEvent, which only Chromium has')
    const { host, sizes } = mount()
    const before = heights(host)
    const bar = header(host, 'heap')
    // ALSO AT THE PRESS: the bar leaves a finger's pan to the browser, which cancels the pointer once the pan
    // starts, so the checks after the move hold only while a move comes before that cancel.
    await finger(
      bar,
      -60,
      () => expect(bar.dataset.dragging, 'a finger’s press on the bar drew it held').toBeUndefined(),
      () => expect(heights(host), 'a finger on the bar dragged').toEqual(before),
    )
    expect(bar.dataset.dragging, 'the bar is drawn held').toBeUndefined()
    expect(sizes).not.toHaveBeenCalled()
    const b = boundary(host, 'machine', 'heap')
    expect(getComputedStyle(b).touchAction, 'the boundary leaves a finger’s drag to the gesture').toBe('none')
    await finger(
      b,
      -60,
      () => expect(b.dataset.dragging, 'a finger’s press on the boundary').toBe('true'),
      () => expect(heights(host).heap, 'a finger on the boundary did not drag').toBeCloseTo(before.heap + 60, 0),
    )
  })
```

  - `fire` loses its `pointerType` parameter (no caller passes one now) and keeps `pointerType: 'mouse'`.
  - **focus-press's `tap`** (the user's ruling of 2026-11-03) lifts its finger the same way: its `touchStart` call goes
    inside `try { … }`, and its `touchEnd` call into `finally { … }`, with no comment of its own (the helper's doc
    already says it is a tap, a touch and its release). Its check is Step 3.1, where "maximises the copy’s outline
    from a tap, in Explorer" passes in Chromium.
  - The file's doc sentence "Three cases need more than the driver gives and make their own pointer events, and each
    says so: a pointer that overshoots a floor and comes back, a finger, and a press that is held." is reworded one
    line for one: the cases that make their own pointer events are the overshoot and the held press, and the finger
    is a real touch through CDP, which only Chromium has.

- [ ] **Step 3: Prove it in `$W`.** The nine files: the eight above and `tests/browser/engine.test.ts`.
  1. `run.sh t2-chromium $W test:browser <nine files>`: 9 files, 107 tests (105 at the base, and
     `engine.test.ts`'s 2), all passed, 0 skipped; no `Errors` line.
  2. `run.sh t2-firefox $W test:firefox <nine files>`: `grep -c '↓'` on the log gives 17 (the 16 gates and the
     engine's gate case), each `↓` line carrying its reason; `targets.py` on the JSON prints T1 17 of 17 and T3 0
     outside. `grep -c BLOCKED` on the log gives 0: the heap tests that threw it are skipped. Expected `Errors`
     line: 6 errors, panel-boundaries' unconverted sites (Task 3).
  3. `flock ~/temp/redextape-heavy.lock pnpm run typecheck` and `pnpm exec biome ci --error-on-warnings`: exit 0.

- [ ] **Step 4: Commit,** under the heavy lock:

```
The 15 browser tests that need what only Chromium has start with `chromiumOnly` and are skipped in Firefox with their reasons, view-keys' AltGraph row through `it.for`; share-popover resets permissions only after a case set one; and panel-boundaries' finger case sends a real touch through CDP, gated in Firefox, lifting the finger in a `finally` as focus-press's `tap` now does
```

- [ ] **Step 5: Sabotages, in `$S` moved to the commit** (`git -C $S checkout -q --detach <sha>`, then
  `git -C $S status --porcelain` empty), each restored as the Global constraints say.
  - **S1.** A `throw new Error('S1')` on the line after each of the 16 `chromiumOnly` calls of this task, all at once.
    For view-keys' AltGraph row the throw goes inside the row's guard, `if (modifier === 'AltGraph') { chromiumOnly(ctx,
    …); throw new Error('S1') }`, since a line after a one-line `if` runs for all eight rows. `run.sh t2-s1-chromium $S
    test:browser <nine files>`: exactly 16 failed, each with `S1`. `run.sh t2-s1-firefox $S test:firefox <nine files>`:
    those 16 skipped, and `grep -c 'Error: S1'` on the log gives 0.
  - **S2, in full.** `engine.ts`'s `ctx.skip(!CHROMIUM, reason)` becomes `ctx.skip(true, reason)`. `run.sh t2-s2 $S
    test:browser <nine files>`: `engine.test.ts` fails on its `afterAll`, and the JSON has 17 skipped.
  - **S7.** share-open-clamps' CDP case loses its `chromiumOnly` line. `run.sh t2-s7 $S test:firefox
    tests/browser/share-open-clamps.test.ts`: that case fails, and the two cascades time out waiting for "the second
    clamp" and "the clamp's notice", as at the base.
  - **S8.** share-popover's reset sends `'Browser.resetPermission'`. `run.sh t2-s8-chromium $S test:browser
    tests/browser/share-popover.test.ts`: the file fails on its `afterAll`. `run.sh t2-s8-firefox $S test:firefox
    tests/browser/share-popover.test.ts`: no `afterAll` failure.
  - **S9.** `web/src/panel-stack.ts`'s header press filter loses `|| (e instanceof PointerEvent && e.pointerType ===
    'touch')`. `run.sh t2-s9-chromium $S test:browser tests/browser/panel-boundaries.test.ts`: the finger case fails at
    "a finger’s press on the bar drew it held", and nothing else in the file fails: 1 failed, 24 passed (probed,
    `pb-s9-chromium.log`; the helper's `finally` lifts the finger, so the cases after it run with no touch down).
    `run.sh t2-s9-firefox $S test:firefox tests/browser/panel-boundaries.test.ts`: the finger case is skipped.

---

### Task 3: The synthetic pointer sites take the id a real move reported

**Files:**
- Modify: `web/tests/browser/divider-drag.test.ts` (`pointer`), `layout-view.test.ts` (the FRACTION case's three
  events), `panel-boundaries.test.ts` (`fire`, and the held case's release on `document.body`),
  `panel-regions.test.ts` (the λ drag's `fire` closure), `pane-floor.test.ts` (its six events and its
  `pointerId: 1 AGAIN` comment), `web/src/separator.ts` (the five-line comment above `e.preventDefault()`).

**Interfaces:**
- Consumes: `mousePointerId(): Promise<number>` from `./engine`.

- [ ] **Step 1: The id, once a file.** In each of the five test files, a file-level `let mouseId: number` set by
  `mouseId = await mousePointerId()` in a top-level `beforeAll` that runs before the file's first mount: the end of
  the existing top-level `beforeAll` in panel-boundaries and panel-regions, a new one in divider-drag, layout-view and
  pane-floor. Every `pointerId: 1` in these files becomes `pointerId: mouseId`. Panel-regions' closure reads
  `mouseId` too, so its hover comes before the λ view is mounted, as in the other files (the user's ruling of
  2026-11-03; spec §3.5).

- [ ] **Step 2: The two comments,** no block growing (their text passed the comment guard in the probe tree,
  `guard2.log`).
  - `separator.ts`, the five lines from "BEFORE `setPointerCapture`, NOT AFTER." become five, the sentence after the
    reworded one included, since "one with another id" would lose its referent:

```ts
    // BEFORE `setPointerCapture`, NOT AFTER. Capture throws `NotFoundError` for a `pointerId` the
    // browser holds no active pointer for, which a test's synthetic `PointerEvent` can carry: Firefox
    // holds none for a synthetic id until real mouse input has reached the tab. A test whose event
    // carried such an id would throw here, and `preventDefault` is what stops a drag from
    // selecting text across the panes, so it must not be the thing a throw skips.
```

  - `pane-floor.test.ts`, the six lines from "`pointerId: 1` AGAIN, NOT A FRESH ID" become four:

```ts
      // The same id as the drag above, the one a real move on the page reported (`engine.ts`'s `mousePointerId`):
      // `setPointerCapture` throws `NotFoundError` for an id the browser holds no active pointer for, which a synthetic
      // event can carry, and that surfaces as an unhandled error at the end of the run even though the gesture itself
      // still completes.
```

- [ ] **Step 3: Prove it in `$W`.** The five files: divider-drag, layout-view, panel-boundaries, panel-regions and
  `engine.test.ts`.
  1. `grep -rn 'pointerId: 1' web/tests`, from `$W`, finds nothing (after Step 2, which rewrites pane-floor's comment
     that quotes it).
  2. `run.sh t3-chromium $W test:browser <five files>`: 5 files, 65 tests, all passed, 0 skipped; no `Errors` line.
  3. `run.sh t3-floor $W test:probe:floor`: pane-floor's one test passed.
  4. `run.sh t3-firefox $W test:firefox <five files>`: no `Errors` line, and `grep -c '\[Unhandled error\]'` on the
     log gives 0 (T2 for these files). `targets.py` on its JSON: read the T3 line alone, which prints 0 outside. This
     run holds none of the gated files, so every T1 row reads `0 matches` and the script exits 1 whatever the run did.
  5. `VITEST_MAX_WORKERS=1 run.sh t3-firefox-divider $W test:firefox tests/browser/divider-drag.test.ts`: no `Errors`
     line (S5's restored side).
  6. `flock ~/temp/redextape-heavy.lock pnpm run typecheck` and `pnpm exec biome ci --error-on-warnings`: exit 0.

- [ ] **Step 4: Commit,** under the heavy lock:

```
The synthetic pointer events of divider-drag, layout-view, panel-boundaries, panel-regions and pane-floor carry the id a real move on the page reported, which Firefox's `setPointerCapture` takes, and `separator.ts`'s and pane-floor's comments say that capture throws for an id the browser holds no active pointer for
```

- [ ] **Step 5: Sabotages, in `$S` moved to the commit**, each restored as the Global constraints say.
  - **S4, in full.** `engine.ts`: `return ids.at(-1) as number` becomes `return (ids.at(-1) as number) + 1`. `run.sh
    t3-s4-chromium $S test:browser <five files>` and `run.sh t3-s4-firefox $S test:firefox <five files>`: in each, the
    `Errors` line reads 18 errors (divider-drag 9, panel-boundaries 6, panel-regions 2, layout-view 1, each a
    `NotFoundError` from `setPointerCapture`), and `engine.test.ts`'s capture case fails.
  - **S5.** `engine.ts`: `hoverForId`'s body becomes `return 0`. `VITEST_MAX_WORKERS=1 run.sh t3-s5 $S test:firefox
    tests/browser/divider-drag.test.ts`: the `Errors` line reads 9 errors. Step 3.5 is its restored side.

---

### Task 4: The whole-branch gate

**Files:** none, unless a check fails. A fix is its own commit, named for what it changes, and the checks it touches
are run again.

- [ ] **Step 1: CI's `web` job, in order, from `$W/web`, each logged to `$R/logs/pr1/t4-<step>.log`.** Under the heavy
  lock: `pnpm install --frozen-lockfile`, `pnpm run build:wasm`, `pnpm run build:lsp-wasm`, `pnpm run build:bindings`.
  Then `../scripts/check-licences.sh --self-test && ../scripts/check-licences.sh`, `pnpm exec biome ci
  --error-on-warnings`, `flock ~/temp/redextape-heavy.lock pnpm run typecheck`, `HEAVY=1 run.sh t4-coverage-head $W
  test:coverage` and, under the heavy lock, `pnpm run build:app`. Expected: each exits 0. Record `test:coverage`'s `All
  files` row (statements, branches, functions, lines).

- [ ] **Step 2: The coverage at the base.** `git diff --stat e9bbf67 -- crates` is empty, so `$S`'s copied `pkg` is
  the base's build too. `git -C $S checkout -q --detach e9bbf67`, `git -C $S status --porcelain` empty, then `HEAVY=1
  run.sh t4-coverage-base $S test:coverage`: exit 0. Record its `All files` row beside the head's.

- [ ] **Step 3: The scans, from `$W`.** Each of `scripts/check-text-bytes.sh`, `check-citations.sh`,
  `check-attributions.sh`, `check-doc-figures.sh`, `check-shared-docs.sh`, `check-colours.sh`, `check-grammar-wasm.sh`
  and `check-lua.sh` with `--self-test` and then without; `node scripts/check-comments.mjs --self-test` and `node
  scripts/check-comments.mjs --base e9bbf67`. Expected: every one exits 0.

- [ ] **Step 4: Chromium as it is today (spec §5.1).**
  1. `run.sh t4-chromium $W test:browser`: 213 files, 1,542 tests, all passed, `numPendingTests` 0, no `Errors`
     line.
  2. `HEAVY=1 run.sh t4-test $W test` (its bindings build is a cargo build). Then
     `grep -oE '\|[a-z]+( \([a-z]+\))?\|' <log> | sort -u` prints `|browser (chromium)|` and `|node|` alone.
  3. Unset, `pnpm exec vitest run --project firefox` fails with `No projects matched the filter "firefox".`, exit 1;
     `REDEXTAPE_FIREFOX=1 pnpm run test:coverage` stops with `@vitest/coverage-v8 does not work with`, exit 1.
  4. `git diff e9bbf67 --stat -- .forgejo` is empty; `git diff e9bbf67 --stat -- scripts` is empty or names
     `scripts/comment-budget.json` alone; `git diff e9bbf67 -- web/vite.config.ts | grep -c thresholds` gives 0.

- [ ] **Step 5: Firefox against the targets (spec §5.2).**
  1. Two full runs: `run.sh t4-firefox-1 $W test:firefox` and `run.sh t4-firefox-2 $W test:firefox`.
  2. The files with a failure in run 1, from its JSON, re-run in one tab: `VITEST_MAX_WORKERS=1 run.sh
     t4-firefox-1tab $W test:firefox <those files>`.
  3. **T1:** `python3 -I $R/scripts/pr1/targets.py $R/logs/pr1/t4-firefox-1.json $R/logs/pr1/t4-firefox-2.json`
     prints T1 17 of 17 for both.
  4. **T2:** no `Errors` line in either log, and `grep -c '\[Unhandled error\]'` gives 0 for both. `grep -c BLOCKED`
     gives 0 for both: the heap tests that throw it are gated, and `collect.ts` throws it in Chromium alone.
  5. **T3:** `targets.py` prints 0 outside the union for both. Each test it lists otherwise is re-run alone, in one
     tab (`VITEST_MAX_WORKERS=1 run.sh t4-alone-<n> $W test:firefox <its file> -t '<its title>'`): one that fails
     alone is PR 1's regression and blocks the PR (report it); one that passes alone is listed as contention, for
     PR 2.
  6. **T4:** 213 files and 1,542 tests in each; skipped 19 (the 16 gates, the engine's gate case and share-open-deep's
     2), or 42 if tm-view-narrow's `beforeAll` timed out (its 23); the failed count recorded for each run against
     the targets 128 (run 1's base conditions) and 122 (run 2's). The counts are recorded, not asserted.
  7. **T5:** `grep -c 'pages this tab ran before this file are still alive'` gives 0 for both.

- [ ] **Step 6: Leave `$S`.** `git -C $W worktree remove --force $S` (its copies are untracked), then `git -C $W
  worktree list` no longer shows it.

---

### Task 5: The roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (append, last in the file)

- [ ] **Step 1: Write the entry,** after Task 4 and after the final code commit, in the shape of the entries above
  it: a `####` heading that says what PR 1 does, with the date, the branch `firefox-local`, the range from `e9bbf67`
  to the last code commit, its commit count, "plus this entry"; then `#####` sections.
  - **What changed**, one bullet per task's commit, with its SHA.
  - **The user's decisions,** U1 = (b), U2 = (a), U3 = (a), dated 2026-11-03, one line each.
  - **WHAT THIS DID NOT CLOSE,** each with where it goes:
    - U2's follow-up, after PR 5: Playwright commands over `page.mouse` (a press held, one move at a time),
      `page.setViewportSize` and the context's clipboard permissions. They could bring 6 gated cases to Firefox
      (focus-press's 3 held presses, share-open-clamps' held press, lambda-follow's window, share-popover's copy) and
      turn the synthetic sites into real input in both engines, except panel-boundaries' "keeps its ratio" and
      pane-floor (points outside the window) and divider-drag's move with no displacement. The driver could carry
      three sites today: divider-drag's "never moved" and "across a reload", and layout-view's fraction case.
    - PR 2, tab contention: Firefox's tab count, the 16 drags that do not move under 12 tabs and the tests that pass
      in one tab (Task 4's T3 and one-tab lists), `document.hasFocus()` false at every file's start, the two
      `view.hasFocus` waits, memory at the slower runner's 3 tabs, and whether real Firefox input is dependable.
    - PR 3, engine differences and tolerances (clusters 3 to 9 and 11). PR 4, the caret bug (cluster 2), after
      step-focus merges.
    - PR 5, CI: `playwright install --with-deps firefox` and a `pnpm test:firefox` step in the `web` job and `gate`;
      U3's check that the Chromium run's `numPendingTests` is 0; the wasm boundary's Firefox leg with geckodriver
      pinned; `v8_native_limits`' Firefox figure; README's "nothing else runs it, CI included".
    - Anything Tasks 1 to 4 found that is not fixed.
  - **VERIFICATION.** Every figure names its command and log: Task 4's `All files` rows at `e9bbf67` and at the
    head, the Chromium counts, both Firefox runs' T1 to T5 with `targets.py`'s lines, the one-tab re-run, S6's count,
    and each sabotage S1 to S11 with what failed. The record is `~/temp/redextape-firefox-ci-record/` (`logs/pr1/`).

- [ ] **Step 2: Check and commit.** `scripts/check-doc-figures.sh` and `scripts/check-citations.sh` pass (the hook
  runs both). Commit:

```
The roadmap's entry for Firefox PR 1: an opt-in Firefox project with the Chromium-only tests gated, what it measured, and what it leaves to PRs 2 to 5 and to the real-gesture follow-up
```

---

## Spec coverage

| Spec | Where |
|---|---|
| §3.1 the project, opt-in, script, provider, command, tab count | Task 1 Steps 5, 8 |
| §3.2 `engine.ts`, one shape, hooks, `engine.test.ts` | Task 1 Steps 3-4; Task 2 Step 1 |
| §3.3 `collect.ts` | Task 1 Step 6; S3, S6 |
| §3.4 the 15 gates, the cascades, share-popover's hook | Task 2 Step 1; S1, S2, S7, S8 |
| §3.5 `until` free of `src` | Task 1 Step 2; S10, S11 |
| §3.5 the pointer sites, the finger case (U1) and its `finally`, `tap`, `separator.ts` | Task 2 Step 2; Task 3; S4, S5, S9 |
| §4 README, the comments, the comment guard and budget | Task 1 Steps 2, 5, 7; Task 3 Step 2; Task 4 Step 3 |
| §5.1 Chromium and coverage | Task 1 Step 8; Task 4 Steps 1-4 |
| §5.2 T1-T5 | Task 4 Step 5 (T5 early in Task 1 Step 8) |
| §5.3 S1-S11 | Task 1 Step 11; Task 2 Step 5; Task 3 Step 5 |
| §5.4 the rest of the `web` job | Task 4 Steps 1, 3 |
| §6, §7 what PR 1 leaves | Task 5 |
