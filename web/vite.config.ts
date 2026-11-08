import { fileURLToPath } from 'node:url'
// `browser.provider` takes a provider factory, not the bare string `'playwright'` (`tsc --noEmit`
// rejects that: TS2769, `string` is not a `BrowserProviderOption`). `playwright()`, from its own
// package, is the documented factory — see the JSDoc on `BrowserConfigOptions.provider` in
// `@vitest/browser`'s own shipped types.
import { playwright } from '@vitest/browser-playwright'
import type { Browser } from 'playwright'
// `defineConfig` comes from `vitest/config`, not `vite`, even though this file is also the Vite
// config. Vitest augments Vite's `UserConfig` type with the `test` field via a `declare module
// "vite"` block in its own type-only entry point — TypeScript only applies that augmentation to
// files that pull it into the compilation. Importing `defineConfig` from `vite` compiles and runs
// fine (Vite ignores the extra `test` key at runtime either way) but fails `tsc --noEmit` with
// TS2769 because the `test` property is invisible to the checker. `vitest/config` re-exports the
// same Vite `defineConfig` plus that import path.
import { configDefaults, defineConfig, type TestProjectInlineConfiguration } from 'vitest/config'
import type { BrowserCommand } from 'vitest/node'
import { inlinePrepaint } from './src/prepaint.ts'

// `pkg/` is built to the REPO ROOT, one level above this Vite root, because the Dockerfile places
// stage 1's output at /app/pkg beside /app/web. Vite's dev server refuses to serve outside its root
// unless that path is allow-listed.
//
// ABSOLUTE, AND REPEATED ON THE BROWSER PROJECTS — a relative `'..'` here is not enough, and the
// failure it produces is remote from its cause. Vitest's browser mode stands up its own nested Vite
// server and rebuilds `server.fs.allow` against THAT server's root, so a relative entry resolves
// somewhere else and the wasm fetch dies with "outside of Vite serving allow list" — while the same
// config serves the same file correctly under a plain `vite dev`.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The site's pages: the app, and the four beside it (about pages design §4). */
const PAGES = ['index', 'about', 'help', 'licences', 'privacy']

/**
 * The probes' own files, excluded from every browser project's default set unless `REDEXTAPE_PROBE` is
 * set — the `pnpm test:probe*` scripts are what set it.
 *
 * **IT IS A MEASUREMENT WHOSE CONSOLE OUTPUT IS THE DELIVERABLE, AND A DELIVERABLE NOBODY READS ON EVERY PUSH IS
 * PURE COST.** The 5d-ii-d design §4.6's probe runs `MAX_WARM_BUFFERS` real wasm workers and builds as many 32 MiB
 * rings, and its TM case one more of each, deserialising every frame onto the main thread — about the half gigabyte
 * it exists to measure. The browser project has no `fileParallelism: false`, so under the default `include` that
 * peak could land concurrently with `session-memory.test.ts`'s and `frame-cost.test.ts`'s, in one origin, on every
 * push. `tm-fork-cost.test.ts` is far cheaper (ten compiles, no workers, each mounting a real CodeMirror editor to
 * time) but joins the same list because its console output is its deliverable too, not because it shares that
 * weight. `tm-buffer-cost.test.ts` joins it for the reason and for its weight: it parses every reduced file its
 * script emits seven times, files of up to 16,000,000 bytes, from a directory and a wasm build under `target/` that
 * only its script creates.
 *
 * **AN ENV FLAG RATHER THAN A BARE `exclude`, BECAUSE A FILE OUTSIDE `include` CANNOT BE NAMED BACK IN.**
 * Vitest's positional filters select WITHIN the resolved include set, so `vitest run <path>` on an
 * excluded file reports no test files rather than running it — which under `passWithNoTests: false`
 * (see the `test` block below for why that is off) is an error, not a probe run. Gating the exclusion
 * makes each `pnpm test:probe*` script the one way in and keeps the default suite free of it.
 *
 * **THE GATE LIVES HERE AND NOT INSIDE THE PROBE FILES, BECAUSE `process.env` DOES NOT EXIST IN THE
 * BROWSER PROJECT'S RUNTIME.** A probe file's own top level cannot read `REDEXTAPE_PROBE` to skip
 * itself (`describe.runIf(process.env.REDEXTAPE_PROBE === '1')` throws `ReferenceError: process is not
 * defined` the moment the browser tries to import it — `process` is a Node global this Vite-served page
 * never gets) — this array, evaluated by Vitest's own Node-side config loader, is the only place the
 * check can run before the file is ever fetched into the browser at all.
 *
 * NOT DELETED, NOT SKIPPED, AND NOT MOVED OUT OF `tests/browser/`: every probe here is a real test file
 * that must keep running against the real app under the same harness and the same Chromium flags —
 * 5d-ii-d §4.6's whole argument is that a cap like this is a measurement rather than an extrapolation, and a
 * measurement that cannot be re-run is an extrapolation with a date on it.
 */
const PROBE_FILES = [
  'tests/browser/buffer-affordability.test.ts',
  'tests/browser/tm-fork-cost.test.ts',
  'tests/browser/pane-floor.test.ts',
  'tests/browser/tm-buffer-cost.test.ts',
  'tests/browser/lambda-tree-cost.test.ts',
  'tests/browser/rxm-copy-cost.test.ts',
  'tests/browser/rxm-copy-memory.test.ts',
  'tests/browser/record-cost.test.ts',
]
const PROBE_EXCLUDE = process.env.REDEXTAPE_PROBE === undefined ? PROBE_FILES : []

/**
 * Whether this run has the Firefox projects: `pnpm test:firefox` sets `REDEXTAPE_FIREFOX`, and nothing else does.
 * OPT-IN, BECAUSE A FIREFOX PROJECT IN EVERY RUN WOULD BREAK TWO OF THEM: `pnpm test` would run it, and an unfiltered
 * run with coverage stops at startup with it in the projects, which `test:coverage`, CI's `web` job, is.
 */
const FIREFOX = process.env.REDEXTAPE_FIREFOX !== undefined

/**
 * The files that take a pointer capture that holds through real input: they run in `firefox-capture`, one at a time.
 * In one Firefox every page's mouse is one pointer, so while a page holds a capture the clicks of every other tab go
 * to it. A file that captures and is not listed fails in `firefox` on `firefox-input.ts`'s guard, which names this
 * list. Paths are relative to `web/`.
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
  'tests/firefox/two-browsers.test.ts',
]

/** Each Firefox project's browser, by the name Vitest gives the project, for `two-browsers.test.ts`. */
const browsers = new Map<string, Browser>()

/** The capture-project files whose span has begun and not ended, by their path. */
const captureFilesInFlight = new Set<string>()

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

/** What each Firefox project registers. */
const FIREFOX_COMMANDS = {
  // Playwright's own collection, for `collect.ts` in an engine that gives a page no `gc`.
  requestGC: async ({ page }) => page.requestGC(),
  registerBrowser,
  decoyDuringCapture,
  captureFileSpan,
} satisfies Record<string, BrowserCommand<never[]>>

/** What a project adds to the shared definition: an `include` given replaces the shared one. */
interface ProjectOptions {
  include?: string[]
  exclude?: string[]
  fileParallelism?: boolean
  pointerCaptureRefused?: boolean
}

/**
 * A browser project in one engine. Both engines' projects are built here, so they cannot drift apart in their setup;
 * what one changes is named in its `options`.
 */
function browserProject(
  name: string,
  browser: 'chromium' | 'firefox',
  provider: ReturnType<typeof playwright>,
  commands: Record<string, BrowserCommand<never[]>> = {},
  options: ProjectOptions = {},
): TestProjectInlineConfiguration {
  return {
    server: {
      fs: { allow: [REPO_ROOT] },
      // A PROBE'S LOG IS WHAT IT DELIVERS, SO EACH LINE A PAGE PRINTS IS THERE ONCE, WHOEVER RUNS IT: where Vite
      // detects a coding agent it also forwards a page's console errors to the terminal, beside the reporter's copy.
      ...(process.env.REDEXTAPE_PROBE === undefined ? {} : { forwardConsole: false }),
    },
    test: {
      name,
      include: options.include ?? ['tests/browser/**/*.test.ts'],
      // THE PROBE IS NOT IN THE DEFAULT SET — see `PROBE_FILES` above for the whole argument.
      // Each `pnpm test:probe*` script sets `REDEXTAPE_PROBE`, and this list is then empty.
      //
      // `...configDefaults.exclude` FIRST, BECAUSE A BARE `exclude: PROBE_EXCLUDE` REPLACES
      // VITEST'S DEFAULT LIST RATHER THAN ADDING TO IT — `**/node_modules/**` and `**/.git/**` would
      // silently drop out. Harmless only because each `include` is confined to `tests/browser/` and
      // `tests/firefox/`, so nothing under `node_modules` or `.git` could match it anyway; the
      // moment that glob widens, the omission bites without a test to catch it.
      exclude: [...configDefaults.exclude, ...PROBE_EXCLUDE, ...(options.exclude ?? [])],
      // `tm-buffer-cost.test.ts`'s run stamp, which `pnpm run test:probe:tm-buffer` sets and every other run
      // leaves empty. A browser test cannot read `process.env` (`PROBE_FILES`' doc says why), so the probe
      // learns its own run's stamp here, and refuses a corpus or a build under `target/` stamped by another.
      // `pointerCaptureRefused` tells `firefox-input.ts`'s guard whether this project refuses a pointer capture.
      provide: {
        probeTmBufferRun: process.env.REDEXTAPE_PROBE_TM_BUFFER_RUN ?? '',
        probeRxmCopyRun: process.env.REDEXTAPE_PROBE_RXM_COPY_RUN ?? '',
        pointerCaptureRefused: options.pointerCaptureRefused ?? false,
      },
      // Vitest serves its own tester HTML, so this project's `index.html` — and therefore its
      // `<link>` to `style.css` — never reaches the page. See `tests/browser/setup.ts`: without it
      // the browser tier measures a different geometry than the app ships. `tests/browser/collect.ts`
      // comes FIRST: it collects the pages of the files before, and restarts coverage, before any
      // module of `src` is compiled in this one (`sequence.setupFiles` below). `tests/browser/firefox-input.ts`
      // comes second, before `setup.ts` imports `src`, and installs no wrapper, hook or command call in Chromium.
      setupFiles: ['tests/browser/collect.ts', 'tests/browser/firefox-input.ts', 'tests/browser/setup.ts'],
      // Whether coverage is on, for `collect.ts`, which cannot read the run's settings itself.
      globalSetup: ['tests/browser/global-setup.ts'],
      browser: {
        enabled: true,
        provider,
        headless: true,
        commands,
        instances: [{ browser }],
        ...(options.fileParallelism === undefined ? {} : { fileParallelism: options.fileParallelism }),
      },
    },
  }
}

export default defineConfig({
  server: { fs: { allow: [REPO_ROOT] } },
  plugins: [{ name: 'redextape-prepaint', transformIndexHtml: { order: 'pre', handler: inlinePrepaint } }],
  define: { 'import.meta.env.VITE_COMMIT_HASH': JSON.stringify(process.env.COMMIT_HASH ?? '') },
  worker: { format: 'es' },
  // `assetsInlineLimit` — WITHOUT THIS, ONE OF FOUR GRAMMAR `.wasm` FILES INLINES AND THE OTHER
  // THREE DO NOT, FOR A REASON THAT HAS NOTHING TO DO WITH THE GRAMMARS THEMSELVES.
  //
  // `colour.ts` imports all four tree-sitter grammar `.wasm` with Vite's `?url` suffix. Three of
  // them (`tree-sitter-redextape`, `tree-sitter-redextape-rxm`, `tree-sitter-redextape-tm`, each
  // 8-17 KiB) land as hashed files under `dist/assets/`. `tree-sitter-redextape-lambda.wasm` is
  // 2,514 bytes — under Vite's default `assetsInlineLimit` of 4096 — so it alone would be inlined
  // into the JS bundle as a `data:application/wasm;base64,...` URI instead of being emitted.
  //
  // THE INLINED FORM IS NOT BROKEN, AND THIS ENTRY IS NOT A BUGFIX: it removes an inconsistency the
  // size threshold introduces by accident, for three reasons:
  //
  // 1. LOAD-BEARING: THE THRESHOLD FLIPS BEHAVIOUR SILENTLY. If this grammar ever grows past 4096
  //    bytes it becomes an emitted asset with no signal anywhere that its production loading path
  //    just changed underneath a file nobody touched — an unchecked threshold that changes
  //    behaviour is exactly the shape this repository removes on sight.
  // 2. The design (see `colour.ts`) has each grammar load independently, so a grammar that fails
  //    to load leaves only its language uncoloured, with one notice. An inlined grammar cannot
  //    fail that way — it is already in the bundle — so λ alone has a different failure surface
  //    from its three siblings.
  // 3. Dev and production would differ for λ alone (dev never inlines), which makes a
  //    λ-specific loading bug reproducible in only one of the two environments.
  //
  // A FUNCTION, NOT A BARE NUMBER, AND `false`/`undefined`, NOT `true`/`false`. Returning `false`
  // means "never inline this file"; returning `undefined` means "fall through to Vite's own
  // default rule" — omitting the fallthrough (returning `true`, or passing a bare number) would
  // change behaviour for every other asset type this file ships (fonts, icons) rather than only
  // `.wasm`.
  build: {
    assetsInlineLimit: (filePath) => (filePath.endsWith('.wasm') ? false : undefined),
    rolldownOptions: {
      input: Object.fromEntries(PAGES.map((p) => [p, fileURLToPath(new URL(`${p}.html`, import.meta.url))])),
    },
  },
  test: {
    // SETUP FILES IN THE ORDER LISTED, ONE AFTER ANOTHER, WHERE VITEST'S DEFAULT IMPORTS THEM ALL AT
    // ONCE. Only the browser projects have any, and their first, `tests/browser/collect.ts`, stops and
    // restarts V8's precise coverage: a module `setup.ts` imports, compiled while that is under way,
    // would be counted at function granularity for the rest of its file. A root option and not the
    // project's own, because Vitest reads this one from the root config alone.
    sequence: { setupFiles: 'list' },
    // No `passWithNoTests`: every project has tests, so a project reporting no test files means a
    // broken `include` glob, and that should fail rather than pass quietly.
    // Coverage spans BOTH projects because this block sits at the `test` root rather than inside
    // either one — a single `vitest run --coverage` merges the node and browser tiers into one
    // report. That merge is the point, not a convenience. The DOM and worker wiring (`main`, `pane-host`
    // and the λ, TM and rxm panes, the two workers) is code the `node` project cannot execute at all, so
    // a node-only number would have to exclude exactly the layer where a regression hides best. The DOM
    // modules are covered by the merge; the two workers are excluded below for a reason that is about
    // INSTRUMENTATION rather than reach, and that entry documents both the reason and what it costs.
    //
    // v8 works here only because a coverage run starts no Firefox: with `REDEXTAPE_FIREFOX` set, an unfiltered run
    // stops at startup, and `--project firefox` or `firefox-capture` exits 1 on coverage-v8's error in each file.
    coverage: {
      provider: 'v8',
      // LOAD-BEARING, AND NOT A DEFAULT WORTH INHERITING. Left unset, `coverage.include` counts only
      // files LOADED during the run, so a module nobody imports is absent from the report rather than
      // scored zero — and the aggregate then reads high because the untested file was never counted
      // at all. That is the one failure direction a coverage gate never announces.
      include: ['src/**/*.ts'],
      // TWO ENTRIES, EACH AN INSTRUMENTATION LIMIT, NOT A TESTING GAP. v8 coverage collects through CDP
      // against the page and does not attach to a dedicated worker's context, so each of these worker
      // modules reports 0% while a browser test runs it for real: `tests/browser/worker.test.ts` spawns
      // `session-worker.ts` as a Worker and drives it end to end (asserting the λ leg reaches `Ended` at
      // step 7 with the λ and TM legs decoded), and `tests/browser/lsp-diagnostics.test.ts` mounts the real
      // app, which spawns `lsp-worker.ts`, and asserts diagnostics that can only have come through it.
      //
      // THE BAR FOR ADDING ANOTHER ENTRY IS THE SAME: a measurement showing the module runs and v8 cannot
      // see it — its row at 0% while a named test drives it — not a hunch that a file is hard to reach.
      // A new entry's measurement is recorded, dated, in the docs of the change that adds it, and this
      // comment names the test that drives the module. `session-worker.ts`'s measurement is in
      // `docs/superpowers/notes/2026-10-17-code-history-web-src.md`, `lsp-worker.ts`'s in the roadmap's
      // PLAN 7 PART 3a entry. A module belongs here only once a test drives it: before that, its 0% is a
      // TESTING gap, and excluding it would hide an untested file behind a comment about instrumentation —
      // the precise failure the `include` entry above exists to prevent.
      //
      // WHAT THIS COSTS, stated because an exclusion that only advertises its justification is half an
      // argument: both modules are invisible to the gate, so new UNTESTED code inside either will not
      // move any of the four numbers. The two tests above are what stand behind them, and nothing
      // mechanical fires when that stops being enough. Re-measure and delete these entries when Vitest
      // gains worker coverage.
      exclude: ['src/session-worker.ts', 'src/lsp-worker.ts'],
      reporter: ['text', 'html'],
      // EACH FLOOR IS SET AT `floor(measured) - 1` WHEN IT MOVES — a margin of one to two points at that
      // moment, sized for the genuine run-to-run variation in a merged browser+node report (which arm of
      // a timing-dependent branch runs is not fixed). A PR that legitimately lowers one of these edits
      // the floor in the same diff, where a reviewer sees it, rather than the floor drifting years behind
      // the tree.
      //
      // THE PLACE TO RE-RUN THE FORMULA IS A SLICE'S CLOSE, where a reviewer sees the argument beside
      // the number. A review-fix delta of a half point or less, or a drift across the integer `floor`
      // rounds on, is the noise the margin exists to absorb, and a floor that moves on every commit is
      // a floor nobody can read a regression against. **The operative quantity is the gap between floor
      // and measured, not the delta since the last run**: deltas too small to justify a move
      // individually are precisely how a floor drifts a full point behind and stops catching a
      // regression near where it happens.
      //
      // EVERY PERCENTAGE THE REPORT PRINTS IS TRUNCATED, NOT ROUNDED. `istanbul-lib-coverage`'s
      // `percent` is `Math.floor((100000 * covered / total) / 10) / 100`, so a figure written the way a
      // calculator rounds it is not the figure the report shows: 1615/1665 is 96.9970%, which a
      // ROUNDING reporter would print as `97.00` — equal to a floor of 97, and so reading as a pass on a
      // run that has in fact tripped. It prints `96.99`. Truncating to two decimals never carries a
      // value across an integer boundary, so `pct < floor` has the same answer for the truncated figure
      // and the exact ratio alike. How many entries it takes to trip a floor is computed, not reasoned
      // about: the rounding is not linear near a floor, and losing covered entries and adding untested
      // ones differ by however many entries that rounding swallows.
      //
      // See roadmap.md, "PLAN 5d-ii-a CLOSES", "PLAN 5d-ii-b CLOSES" and "PLAN 5d-ii-c CLOSES", for the
      // measurements and the argument behind each move of these floors.
      thresholds: { lines: 97, functions: 97, branches: 89, statements: 95 },
    },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/node/**/*.test.ts'],
        },
      },
      browserProject(
        'browser',
        'chromium',
        playwright({
          // TWO FLAGS, AND `frame-cost.test.ts` NEEDS BOTH — one to make the reading move at all,
          // the other to make it mean something. Chromium-only. The second is not the probes'
          // alone: `tests/browser/collect.ts` calls `gc` at the start of every browser file, to collect
          // the page the file before it left, and throws if this flag is missing.
          //
          // `--enable-precise-memory-info` — `frame-cost.test.ts` reads
          // `performance.memory.usedJSHeapSize` to measure `SPAN_BYTES` for real. WITHOUT IT the
          // value is frozen at a stale sample for tens of seconds regardless of allocation, and every
          // heap delta in that test reads exactly 0. WITH IT, the reading tracks allocation and
          // collection within one read.
          //
          // `--js-flags=--expose-gc` — exposes `globalThis.gc()`, a full synchronous collection.
          // WITHOUT IT the heap delta across a window is "bytes allocated MINUS whatever the
          // collector happened to do in that window", which is a schedule, not a size: partial
          // collection lands asymmetrically between the two windows, with no fixed sign or bound
          // (the readings are in `docs/superpowers/notes/2026-10-17-code-history-web-tests.md`, in
          // `frame-cost.test.ts`'s entry above `THE READINGS ARE TAKEN AFTER A FULL COLLECTION`).
          // WITH IT that test collects before every reading, so each delta is retained heap, and
          // the result is reproducible to the byte across browser restarts.
          launchOptions: { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] },
        }),
      ),
      ...(FIREFOX
        ? [
            // Its tab count is `test:firefox`'s `VITEST_MAX_WORKERS`: 6 unless the caller sets one (README, Checks).
            browserProject('firefox', 'firefox', playwright(), FIREFOX_COMMANDS, {
              include: ['tests/browser/**/*.test.ts', 'tests/firefox/**/*.test.ts'],
              exclude: CAPTURE_FILES,
              pointerCaptureRefused: true,
            }),
            // ONE FILE AT A TIME, AND BESIDE THE REST: `browser.fileParallelism`, not `maxWorkers` or the top-level
            // `fileParallelism` its deprecation points to, either of which puts this project in a group of its own,
            // run after the rest. Its own `playwright()` gives it its own browser. `firefox-input.ts`'s one-at-a-time
            // check fails the run if the option stops holding.
            browserProject('firefox-capture', 'firefox', playwright(), FIREFOX_COMMANDS, {
              include: CAPTURE_FILES,
              fileParallelism: false,
            }),
          ]
        : []),
    ],
  },
})
