/**
 * Browser-tier setup: give the tester page the app's stylesheet.
 *
 * VITEST'S BROWSER MODE SERVES ITS OWN HTML, NOT THIS PROJECT'S `index.html`, and `index.html` is the
 * only place `style.css` is referenced (`<link rel="stylesheet" href="/src/style.css">` — `main.ts`
 * does not import it, deliberately, so the stylesheet loads from `<head>` rather than after the module
 * and the page does not flash unstyled). The consequence is that every browser test before this file
 * ran against a completely unstyled DOM.
 *
 * THAT IS NOT A COSMETIC DIFFERENCE FOR THE STATE TABLE. `.state-table`'s `max-height: 40vh` is what
 * bounds the scroll container; without it the box lays out at its full content height — measured at
 * 271,968px for 11,332 rows — and a test asserting that virtualization renders few rows would be
 * exercising `TmPane`'s clamp fallback instead of the geometry the app actually ships.
 *
 * Importing the stylesheet here makes the browser tier test the real thing. It is a `setupFiles` entry
 * rather than an import in `main.ts` because the `<head>` link is the right production loading order
 * and this is a test-harness gap, not an application one.
 */
import '../../src/style.css'

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
