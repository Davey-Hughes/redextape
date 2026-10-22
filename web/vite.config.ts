import { fileURLToPath } from 'node:url'
// `browser.provider` takes a provider factory, not the bare string `'playwright'` (`tsc --noEmit`
// rejects that: TS2769, `string` is not a `BrowserProviderOption`). `playwright()`, from its own
// package, is the documented factory — see the JSDoc on `BrowserConfigOptions.provider` in
// `@vitest/browser`'s own shipped types.
import { playwright } from '@vitest/browser-playwright'
// `defineConfig` comes from `vitest/config`, not `vite`, even though this file is also the Vite
// config. Vitest augments Vite's `UserConfig` type with the `test` field via a `declare module
// "vite"` block in its own type-only entry point — TypeScript only applies that augmentation to
// files that pull it into the compilation. Importing `defineConfig` from `vite` compiles and runs
// fine (Vite ignores the extra `test` key at runtime either way) but fails `tsc --noEmit` with
// TS2769 because the `test` property is invisible to the checker. `vitest/config` re-exports the
// same Vite `defineConfig` plus that import path.
import { configDefaults, defineConfig } from 'vitest/config'
import { inlinePrepaint } from './src/prepaint.ts'

// `pkg/` is built to the REPO ROOT, one level above this Vite root, because the Dockerfile places
// stage 1's output at /app/pkg beside /app/web. Vite's dev server refuses to serve outside its root
// unless that path is allow-listed.
//
// ABSOLUTE, AND REPEATED ON THE BROWSER PROJECT — a relative `'..'` here is not enough, and the
// failure it produces is remote from its cause. Vitest's browser mode stands up its own nested Vite
// server and rebuilds `server.fs.allow` against THAT server's root, so a relative entry resolves
// somewhere else and the wasm fetch dies with "outside of Vite serving allow list" — while the same
// config serves the same file correctly under a plain `vite dev`.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The site's pages: the app, and the four beside it (about pages design §4). */
const PAGES = ['index', 'about', 'help', 'licences', 'privacy']

/**
 * The probes' own files, excluded from the browser project's default set unless `REDEXTAPE_PROBE` is
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
  'tests/browser/asm-copy-cost.test.ts',
  'tests/browser/asm-copy-memory.test.ts',
]
const PROBE_EXCLUDE = process.env.REDEXTAPE_PROBE === undefined ? PROBE_FILES : []

export default defineConfig({
  server: { fs: { allow: [REPO_ROOT] } },
  plugins: [{ name: 'redextape-prepaint', transformIndexHtml: { order: 'pre', handler: inlinePrepaint } }],
  define: { 'import.meta.env.VITE_COMMIT_HASH': JSON.stringify(process.env.COMMIT_HASH ?? '') },
  worker: { format: 'es' },
  // `assetsInlineLimit` — WITHOUT THIS, ONE OF FOUR GRAMMAR `.wasm` FILES INLINES AND THE OTHER
  // THREE DO NOT, FOR A REASON THAT HAS NOTHING TO DO WITH THE GRAMMARS THEMSELVES.
  //
  // `colour.ts` imports all four tree-sitter grammar `.wasm` with Vite's `?url` suffix. Three of
  // them (`tree-sitter-redextape`, `tree-sitter-redextape-asm`, `tree-sitter-redextape-tm`, each
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
    // ONCE. Only the browser project has any, and its first, `tests/browser/collect.ts`, stops and
    // restarts V8's precise coverage: a module `setup.ts` imports, compiled while that is under way,
    // would be counted at function granularity for the rest of its file. A root option and not the
    // project's own, because Vitest reads this one from the root config alone.
    sequence: { setupFiles: 'list' },
    // No `passWithNoTests`: both projects have tests, so a project reporting no test files means a
    // broken `include` glob, and that should fail rather than pass quietly.
    // Coverage spans BOTH projects because this block sits at the `test` root rather than inside
    // either one — a single `vitest run --coverage` merges the node and browser tiers into one
    // report. That merge is the point, not a convenience. The DOM and worker wiring (`main`, `pane-host`
    // and the λ, TM and asm panes, the two workers) is code the `node` project cannot execute at all, so
    // a node-only number would have to exclude exactly the layer where a regression hides best. The DOM
    // modules are covered by the merge; the two workers are excluded below for a reason that is about
    // INSTRUMENTATION rather than reach, and that entry documents both the reason and what it costs.
    //
    // v8 works here only because `instances` below is chromium-only; on any other browser Vitest
    // throws at config-resolution time rather than silently under-reporting.
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
      {
        server: { fs: { allow: [REPO_ROOT] } },
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          // THE PROBE IS NOT IN THE DEFAULT SET — see `PROBE_FILES` above for the whole argument.
          // Each `pnpm test:probe*` script sets `REDEXTAPE_PROBE`, and this list is then empty.
          //
          // `...configDefaults.exclude` FIRST, BECAUSE A BARE `exclude: PROBE_EXCLUDE` REPLACES
          // VITEST'S DEFAULT LIST RATHER THAN ADDING TO IT — `**/node_modules/**` and `**/.git/**` would
          // silently drop out. Harmless only because `include` above is confined to
          // `tests/browser/`, so nothing under `node_modules` or `.git` could match it anyway; the
          // moment that glob widens, the omission bites without a test to catch it.
          exclude: [...configDefaults.exclude, ...PROBE_EXCLUDE],
          // `tm-buffer-cost.test.ts`'s run stamp, which `pnpm run test:probe:tm-buffer` sets and every other run
          // leaves empty. A browser test cannot read `process.env` (`PROBE_FILES`' doc says why), so the probe
          // learns its own run's stamp here, and refuses a corpus or a build under `target/` stamped by another.
          provide: {
            probeTmBufferRun: process.env.REDEXTAPE_PROBE_TM_BUFFER_RUN ?? '',
            probeAsmCopyRun: process.env.REDEXTAPE_PROBE_ASM_COPY_RUN ?? '',
          },
          // Vitest serves its own tester HTML, so this project's `index.html` — and therefore its
          // `<link>` to `style.css` — never reaches the page. See `tests/browser/setup.ts`: without it
          // the browser tier measures a different geometry than the app ships. `tests/browser/collect.ts`
          // comes FIRST: it collects the pages of the files before, and restarts coverage, before any
          // module of `src` is compiled in this one (`sequence.setupFiles` above).
          setupFiles: ['tests/browser/collect.ts', 'tests/browser/setup.ts'],
          // Whether coverage is on, for `collect.ts`, which cannot read the run's settings itself.
          globalSetup: ['tests/browser/global-setup.ts'],
          browser: {
            enabled: true,
            provider: playwright({
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
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
