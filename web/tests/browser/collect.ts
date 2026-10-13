import { expect, inject } from 'vitest'
import { cdp } from 'vitest/browser'

/**
 * Browser-tier setup, the FIRST of its two files: collect the pages the test files before this one left behind, and
 * stop coverage from keeping them.
 *
 * A FINISHED FILE'S PAGE IS NOT REMOVED WHEN IT FINISHES, BUT WHEN ITS TAB STARTS THE NEXT FILE. Vitest's browser
 * orchestrator removes every iframe it holds at the top of `createTesters`, just before it builds the next one, so by
 * the time a setup file runs the previous file's page is gone. Its heap, its app, and the handles of the workers that
 * died with it are garbage now and were not a moment ago. A `gc()` in a finishing file's `afterAll` runs while its own
 * iframe is still in the page and can free none of it; only the START of the next file can.
 *
 * WITHOUT A COLLECTION HERE, V8 LEFT THAT GARBAGE WHERE IT WAS WHILE THE TAB STAYED BUSY. A tab runs its files one
 * after another, and the renderers' memory fell by more than a third only once their tabs went idle at the end of the
 * run. Chrome's shared memory went with it: Playwright launches Chromium with `--disable-dev-shm-usage`, so those
 * segments are files in `/tmp`, a RAM tmpfs here, and every file loaded left more of them until a collection. TWICE,
 * BECAUSE THAT IS WHAT WAS MEASURED; one call alone was not. A THROW, NOT A SKIP, WHEN `gc` IS MISSING:
 * `--js-flags=--expose-gc` in `vite.config.ts` is what puts it there, and a guard that quietly did nothing would put
 * the peak back with every test still green. The roadmap entry that added the collection has the measurement.
 *
 * **UNDER `--coverage` THAT COLLECTION FREED NO PAGE AT ALL, AND CI'S SLOWER RUNNER RAN OUT OF ROOM FOR WEBASSEMBLY.**
 * Vitest starts V8's precise coverage once in each tab and never stops it (`@vitest/coverage-v8`'s browser module:
 * "Browser mode should not stop coverage as same V8 instance is shared between tests"), and while precise coverage is
 * on V8 holds every function's feedback vector as a root (`Coverage::SelectMode`: "Root all feedback vectors to avoid
 * early collection"). Every page a tab had run stayed alive while it was on, with the WebAssembly memories its app
 * had made, and a renderer has room for 123 or 124 of those, its pages' workers' included. Measured 2026-10-13 on
 * eight files in one tab: pages alive at each file's start 0, 1, 2 … 7, the heap 15.5 MiB to 83.6, the room 124 to
 * 112. CI's slower runner runs three files at once, about seventy to a tab, and `main` at #142's merge failed twice
 * there on `WebAssembly.instantiate(): Out of memory`; the whole suite in two tabs under `--coverage` failed 54 files
 * of 210 here, that message among their errors. The faster runner runs eleven at once, about nineteen to a tab, and
 * never got that far.
 *
 * SO PRECISE COVERAGE IS STOPPED FOR THE COLLECTION AND STARTED AGAIN AFTER IT, with the settings Vitest starts it
 * with. Nothing it has counted is lost: Vitest takes each file's coverage as that file finishes, before this runs.
 *
 * **AND A LAST-RESORT COLLECTION BEFORE IT STARTS AGAIN, BECAUSE STOPPING IT TAKES THE BLOCK COUNTERS OFF EVERY
 * FUNCTION ALREADY COMPILED** (`Coverage::SelectMode`: "Since we delete coverage infos at that point, any following
 * coverage recording (without reloads) will be at function granularity"), and the next page compiling the same module
 * gets those functions back from V8's compilation cache. Without it the report fell from 97.59 / 92.19 / 98.39 / 98.92,
 * by as much as the run made it: to 96.01 / 89.00 / 98.39 / 97.45 in one run, which the coverage floors passed, and to
 * 94.95 / 86.84 / 98.39 / 96.64 in another, which they failed. A last-resort collection clears the compilation cache
 * (`Heap::CollectAllAvailableGarbage`), and with it every run gave the report a stock run gives, file by file.
 *
 * FIRST, AND IMPORTING NOTHING OF `src`, for the same reason: a module this page compiles before coverage starts
 * again is counted at function granularity. `sequence.setupFiles: 'list'` in `vite.config.ts` is what makes this file
 * finish before `setup.ts`'s imports begin; Vitest's default imports the two at once.
 *
 * Whether coverage is on comes from `global-setup.ts`: starting precise coverage in a run without it would put the
 * leak back, and a page cannot read the run's settings itself.
 */
const gc = (
  globalThis as typeof globalThis & {
    gc?: (options?: { type: 'major'; execution: 'sync'; flavor: 'last-resort' }) => void
  }
).gc
if (typeof gc !== 'function') {
  throw new Error('BLOCKED: globalThis.gc is unavailable — launch Chromium with --js-flags=--expose-gc')
}
const coverage = inject('coverageOn')
if (coverage) await cdp().send('Profiler.stopPreciseCoverage')
gc()
gc()
if (coverage) {
  gc({ type: 'major', execution: 'sync', flavor: 'last-resort' })
  await cdp().send('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
}

/**
 * The most pages of earlier files a tab may still hold after the collection above.
 *
 * **A HEALTHY TAB HELD THREE AT MOST, AND THE LEAK ADDS ONE A FILE.** Measured 2026-10-13 at each of 1,260 file starts:
 * five whole runs of `pnpm run test:coverage` in twelve tabs, and one in three tabs under a CPU quota of one and a half
 * cores, with this file's collection. Eight leaves that margin more than twice over and still trips at a tab's tenth
 * file, so a tab of nineteen files, as on the faster runner, shows a leak that only the slower runner's seventy could
 * turn into a failed allocation: with the restart above taken out, a whole run in twelve tabs failed 104 browser files
 * here.
 */
const MOST_PAGES_ALIVE = 8

/**
 * THE LIST OF EARLIER PAGES LIVES ON THE ORCHESTRATOR'S PAGE, which outlives every page it builds, and is made with
 * that page's own constructors. A weak reference this page made would be an object of this page's realm, and the
 * orchestrator holding it would keep the realm, and so the page, alive.
 */
type Orchestrator = Window &
  typeof globalThis & {
    __redextapePages?: WeakRef<Window>[]
    __redextapeFiles?: string[]
  }
const orchestrator = window.top as Orchestrator
orchestrator.__redextapePages ??= new orchestrator.Array<WeakRef<Window>>()
orchestrator.__redextapeFiles ??= new orchestrator.Array<string>()
const pages = orchestrator.__redextapePages
const files = orchestrator.__redextapeFiles
const alive = files.filter((_, i) => pages[i]?.deref() !== undefined)
if (alive.length > MOST_PAGES_ALIVE) {
  throw new Error(
    `${alive.length} of the ${files.length} pages this tab ran before this file are still alive after a full ` +
      `collection (${alive.join(', ')}), where a healthy tab holds three at most. Each keeps the WebAssembly ` +
      'memories its app made, and a renderer has room for 123 of them: see collect.ts.',
  )
}
pages.push(new orchestrator.WeakRef(window))
files.push((expect.getState().testPath ?? '(unknown)').split('/').pop() ?? '(unknown)')
