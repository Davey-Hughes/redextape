/**
 * Browser-tier setup: give the tester page the app's stylesheet.
 *
 * VITEST'S BROWSER MODE SERVES ITS OWN HTML, NOT THIS PROJECT'S `index.html`, and `index.html` is the
 * only place `style.css` is referenced (`<link rel="stylesheet" href="/src/style.css">` — `main.ts`
 * does not import it, deliberately, so the stylesheet loads from `<head>` rather than after the module
 * and the page does not flash unstyled). The consequence is that every browser test before this file
 * ran against a completely unstyled DOM.
 *
 * THAT IS NOT A COSMETIC DIFFERENCE FOR THE STATE TABLE. The TM view's flex rules are what bound
 * the scroll container; without them the box lays out at its full content height — measured at
 * 271,968px for 11,332 rows — and a test asserting that virtualization renders few rows would be
 * measuring a table that draws every row instead of the geometry the app actually ships.
 *
 * Importing the stylesheet here makes the browser tier test the real thing. It is a `setupFiles` entry
 * rather than an import in `main.ts` because the `<head>` link is the right production loading order
 * and this is a test-harness gap, not an application one.
 */
import '../../src/style.css'
import { PROGRAM_STORAGE_KEY, serializeProgram } from '../../src/program-store'

/**
 * Browser-tier setup, before the test file's own module body: collect the page the previous test file left
 * behind. IT SITS BELOW THE STYLESHEET'S IMPORT BECAUSE MOVING IT ABOVE WOULD CHANGE NOTHING: a static `import`
 * is evaluated before any statement in its module, wherever it is written. What this frees does not depend on
 * running first, only on running before the test file mounts anything of its own.
 *
 * A FINISHED FILE'S PAGE IS NOT REMOVED WHEN IT FINISHES, BUT WHEN ITS TAB STARTS THE NEXT FILE. Vitest's
 * browser orchestrator removes every iframe it holds at the top of `createTesters`, just before it builds the
 * next one, so by the time a setup file runs the previous file's page is gone. Its heap, its app, and the
 * handles of the workers that died with it are garbage now and were not a moment ago. A `gc()` in a finishing
 * file's `afterAll` runs while its own iframe is still in the page and can free none of it; only the START of
 * the next file can.
 *
 * WITHOUT THIS, V8 LEFT THAT GARBAGE WHERE IT WAS WHILE THE TAB STAYED BUSY. Each tab runs about ten files in
 * a row, and the renderers' memory fell by more than a third only once their tabs went idle at the end of the
 * run. Chrome's shared memory went with it: Playwright launches Chromium with `--disable-dev-shm-usage`, so
 * those segments are files in `/tmp`, a RAM tmpfs here, and every file loaded left more of them until a
 * collection. The roadmap entry that added this has the measurement.
 *
 * TWICE, BECAUSE THAT IS WHAT WAS MEASURED; one call alone was not. A THROW, NOT A SKIP, WHEN `gc` IS MISSING:
 * `--js-flags=--expose-gc` in `vite.config.ts` is what puts it there, and a guard that quietly did nothing
 * would put the peak back with every test still green.
 */
const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc
if (typeof gc !== 'function') {
  throw new Error('BLOCKED: globalThis.gc is unavailable — launch Chromium with --js-flags=--expose-gc')
}
gc()
gc()

/**
 * Browser-tier setup, part two: give every test file its own `Storage`, not the browser's real one.
 *
 * `localStorage` IS SCOPED TO AN ORIGIN, NOT TO A TEST FILE, AND VITEST RUNS BROWSER FILES CONCURRENTLY
 * IN ONE ORIGIN — the evidence for the concurrency half being the suite's own timing, where the
 * wall-clock duration is less than half the sum of its per-file test time (re-measured 2026-08-17:
 * 53.9 s of wall clock against 149.8 s of summed test time, across 38 files). Every browser test file
 * gets its own page (`main()` runs once per page, since ES module
 * imports are cached, and Vitest gives each test FILE its own page) — but every page is the same origin,
 * and therefore the same `localStorage`, so one file's write to it is visible to every sibling that
 * mounts `main()`.
 *
 * AN EARLIER MITIGATION HAD ~14 FILES CLEAR THE SHARED KEYS BEFORE THEIR OWN MOUNT, AND IT LEFT A RACE —
 * because the window it needed to close is the WIDEST one in `main()`, not the narrowest. `main()`
 * AWAITS `init()` — a wasm fetch and instantiation — and the storage reads sit AFTER that await, so the
 * gap between a sibling's `removeItem()` and its own read spans the whole wasm load. No ordering of
 * synchronous clears on either side of that gap can shrink it; only not sharing the key can. Reproduced
 * twice under the clearing mitigation before this shim replaced it: `scratch-cap.test.ts` (`expected
 * 'buffers 1 ▾' to be 'buffers 0 ▾'`) and, on a different interleaving of the same suite, distinctly in
 * `link-truncated.test.ts`.
 *
 * REPLACING `window.localStorage` FOR THIS FILE'S OWN PAGE, RATHER THAN CLEARING THE SHARED ONE, IS WHAT
 * ACTUALLY CLOSES IT — and it is forced rather than fastidious. `setupFiles` are imported and fully run
 * BEFORE the test file's own module body is (`@vitest/runner`'s `collectTests` awaits `runSetupFiles`
 * before it calls `runner.importFile(filepath, "collect")`), and each browser test file gets its own
 * page, so the `Storage` installed here is this file's own for its entire run — nothing a sibling does to
 * the real store, on either side of this file's mount, can reach it or be reached by it. That ordering is
 * what a handful of files rely on to seed a value into storage before they mount `main()`.
 *
 * THE SHIM IS A COMPLETE `Storage`, NOT A PARTIAL STUB — `length`, `clear`, `getItem`, `key`,
 * `removeItem`, `setItem` — because `appearance.ts` reads and writes through it during `main()` too, and
 * a stub missing one of those fails in a way that looks like an app bug rather than a harness one.
 */
const cell = new Map<string, string>()
const shim: Storage = {
  get length() {
    return cell.size
  },
  clear: () => cell.clear(),
  getItem: (k: string) => cell.get(k) ?? null,
  key: (i: number) => [...cell.keys()][i] ?? null,
  removeItem: (k: string) => {
    cell.delete(k)
  },
  setItem: (k: string, v: string) => {
    cell.set(k, v)
  },
}
Object.defineProperty(window, 'localStorage', { value: shim, configurable: true })

/**
 * Browser-tier setup, part three: every file starts on `let x = 40; x + 2`, the program it was written against.
 *
 * **A FIRST VISIT OPENS ON THE FIRST-LOAD EXAMPLE NOW** (Plan 7 part 6a spec §4.4), and every file's storage above
 * starts empty, so every file that mounts the app would start on `sum_to(5)`: a longer first compile in all of them,
 * and a different program in the ones that never type one of their own. The old start-up program is stored here
 * instead, under the default encoding, as a returning visitor's would be. `first-load.test.ts` removes it before it
 * mounts, and a file that clears storage before its mount starts on the example too.
 */
shim.setItem(PROGRAM_STORAGE_KEY, serializeProgram({ text: 'let x = 40; x + 2', encoding: 'unary' }))
