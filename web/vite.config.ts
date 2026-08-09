import { fileURLToPath } from 'node:url'
// Vitest 4 split the Playwright driver out of `@vitest/browser` into its own package with a
// provider-factory API; `browser.provider` no longer accepts the bare string `'playwright'` that
// earlier Vitest majors did (`tsc --noEmit` rejects it: TS2769, `string` is not a
// `BrowserProviderOption`). `playwright()` is the documented replacement — see the JSDoc on
// `BrowserConfigOptions.provider` in `@vitest/browser`'s own shipped types.
import { playwright } from '@vitest/browser-playwright'
// `defineConfig` comes from `vitest/config`, not `vite`, even though this file is also the Vite
// config. Vitest augments Vite's `UserConfig` type with the `test` field via a `declare module
// "vite"` block in its own type-only entry point — TypeScript only applies that augmentation to
// files that pull it into the compilation. Importing `defineConfig` from `vite` compiles and runs
// fine (Vite ignores the extra `test` key at runtime either way) but fails `tsc --noEmit` with
// TS2769 because the `test` property is invisible to the checker. `vitest/config` re-exports the
// same Vite `defineConfig` plus that import path.
import { defineConfig } from 'vitest/config'

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

export default defineConfig({
  server: { fs: { allow: [REPO_ROOT] } },
  worker: { format: 'es' },
  test: {
    // No `passWithNoTests`. It was set while the scaffold had no tests yet; now that both projects
    // have them, a project reporting no test files means a broken `include` glob, and that should
    // fail rather than pass quietly.
    // Coverage spans BOTH projects because this block sits at the `test` root rather than inside
    // either one — a single `vitest run --coverage` merges the node and browser tiers into one
    // report. That merge is the point, not a convenience. Five modules (`main`, `tm-pane`,
    // `lambda-pane`, `pane-chrome`, `session-worker`) are DOM and worker wiring the `node` project
    // cannot execute at all, so a node-only number would have to exclude exactly the layer where a
    // regression hides best. Four of those five are covered by the merge; `session-worker` is
    // excluded below for a reason that is about INSTRUMENTATION rather than reach, and that entry
    // documents both the reason and what it costs.
    //
    // v8 works here only because `instances` below is chromium-only; on any other browser Vitest
    // throws at config-resolution time rather than silently under-reporting.
    coverage: {
      provider: 'v8',
      // LOAD-BEARING, AND NOT A DEFAULT WORTH INHERITING. Vitest 4 changed `coverage.include`:
      // left unset it counts only files LOADED during the run, so a module nobody imports is absent
      // from the report rather than scored zero — and the aggregate then reads high because the
      // untested file was never counted at all. That is the one failure direction a coverage gate
      // never announces.
      //
      // MEASURED 2026-08-09, and the experiment named its own beneficiary: with this line removed,
      // `session-worker.ts` VANISHED from the report rather than scoring 0%, the statement
      // denominator fell 1072 -> 918 — exactly that module's 154 statements — and the aggregate
      // ROSE from 79.94% to 93.35% purely by no longer counting an untested file. That is the
      // failure mode described two sentences up, reproduced on demand.
      //
      // THAT EXPERIMENT NO LONGER REPRODUCES AS WRITTEN, and the reason is worth knowing before you
      // try it: the measurement predates the `exclude` below, which now drops `session-worker.ts`
      // whether or not `include` is set. Pick any other unimported module to re-run it. The
      // mechanism is general; session-worker was merely the tree's one instance at the time.
      include: ['src/**/*.ts'],
      // One entry, and it is an instrumentation limit, not a testing gap — the measurement that
      // justifies it sits in the comment right above it. The bar for adding another entry here is
      // the same: a dated comment recording what was measured, not a hunch that a file is hard to
      // reach.
      //
      // MEASURED 2026-08-09, NOT ASSUMED: v8 coverage collects through CDP against the page and did
      // not attach to this module's dedicated-worker context — it reported 0% while
      // `tests/browser/worker.test.ts` spawns the real module as a Worker and drives it end to end
      // (asserting the λ leg reaches `Ended` at step 7 with both legs decoded), so the module IS
      // genuinely exercised. This is an instrumentation gap, not a testing gap, and conflating the
      // two is what the exclusion is documented to prevent. Confirmed by removing this entry: the
      // row REAPPEARS at 0% and the statement denominator RISES 918 -> 1072, exactly
      // session-worker.ts's 154 statements.
      //
      // WHAT THIS COSTS, stated because an exclusion that only advertises its justification is half
      // an argument: 444 lines / 154 statements — about 17% of the statement denominator — are now
      // invisible to the gate. New UNTESTED code inside session-worker.ts will not move any of the
      // four numbers. `tests/browser/worker.test.ts` is the only thing standing behind this module,
      // and nothing mechanical fires when that stops being enough. Re-measure and delete this entry
      // when Vitest gains worker coverage.
      exclude: ['src/session-worker.ts'],
      reporter: ['text', 'html'],
      // MEASURED 2026-08-09: lines 95.9, functions 94.4, branches 86.66, statements 93.35.
      // Each floor is `floor(measured) - 1` — a margin of one to two points, sized for the genuine
      // run-to-run variation in a merged browser+node report (which arm of a timing-dependent branch
      // runs is not fixed). A PR that legitimately lowers one of these edits the floor in the same
      // diff, where a reviewer sees it, rather than the floor drifting years behind the tree.
      //
      // THE TIGHTEST OF THE FOUR IS `functions`, NOT `branches`, and the nominal margins say the
      // opposite. Computed from the committed figures, the number of NEW UNTESTED entries needed to
      // trip each floor is: functions **3** (135/146 -> 92.47%), branches 10 (416/490 -> 84.90%),
      // statements 14 (857/932 -> 91.95%), lines 17 (772/822 -> 93.92%). Losing already-covered
      // entries instead takes 3 / 9 / 13 / 16.
      //
      // Branches' 1.66-point margin looks like the thin one and is not: its denominator is 480, so
      // a point costs many branches. `functions` has 143 entries, so three untested ones fail the
      // build. That is the gate working as designed, and it is the floor that will produce friction
      // first — expect it on a new helper module before you see it anywhere else.
      thresholds: { lines: 94, functions: 93, branches: 85, statements: 92 },
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
          // Vitest serves its own tester HTML, so this project's `index.html` — and therefore its
          // `<link>` to `style.css` — never reaches the page. See `tests/browser/setup.ts`: without it
          // the state table's `max-height: 40vh` never applies and the browser tier measures a
          // different geometry than the app ships.
          setupFiles: ['tests/browser/setup.ts'],
          browser: {
            enabled: true,
            provider: playwright({
              // `frame-cost.test.ts` reads `performance.memory.usedJSHeapSize` to measure `SPAN_BYTES`
              // for real. WITHOUT THIS FLAG the value is frozen at a stale sample for tens of seconds
              // regardless of allocation — verified by allocating and dropping a 5M-element array under
              // 45s of wall-clock with no change in the reading. WITH IT, the same experiment tracks
              // allocation and collection within one read. Chromium-only and harmless to every other
              // browser test, which don't touch `performance.memory`.
              launchOptions: { args: ['--enable-precise-memory-info'] },
            }),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
