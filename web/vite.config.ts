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
      // MEASURED 2026-08-12 (plan 5d-ii-a's close, after the whole-branch review's fixes): lines 97.40
      // (1501/1541), functions 96.83 (306/316), branches 89.17 (824/924), statements 94.80
      // (1698/1791) — every figure above the 2026-08-09 baseline this file previously recorded
      // (95.9 / 94.4 / 86.66 / 93.35), so the slice raised coverage rather than diluting it. Each
      // floor is `floor(measured) - 1` — a margin of one to two points, sized for the genuine
      // run-to-run variation in a merged browser+node report (which arm of a timing-dependent branch
      // runs is not fixed). A PR that legitimately lowers one of these edits the floor in the same
      // diff, where a reviewer sees it, rather than the floor drifting years behind the tree.
      //
      // `branches` IS THE ONE FLOOR THE FORMULA NO LONGER REPRODUCES EXACTLY, AND IT IS LEFT ALONE
      // DELIBERATELY. The floors were set when branches measured 88.96 (`floor(88.96) - 1 = 87`); the
      // review fixes above moved it to 89.17, which crosses the integer `floor` rounds on and would
      // read out as 88. Chasing a 0.21-point drift across a rounding boundary would be the gate
      // tracking noise — exactly what the one-to-two-point margin exists to absorb — so 87 stands.
      //
      // RAISED HERE RATHER THAN LEFT, AND THAT WAS A DECISION, NOT THE DEFAULT. The convention above
      // is stated as a formula, not as a one-way ratchet that only fires when coverage falls — and
      // the two prior slices (5d-i, 5d-ii-a's own earlier commits) left these floors unmoved while
      // measured coverage climbed past them without anyone arguing the case either way. Leaving them
      // stale a third time would let the gap between floor and measured keep widening for no reason
      // anyone decided. See roadmap.md, "PLAN 5d-ii-a CLOSES", for the argument in full.
      //
      // RE-MEASURED 2026-08-12, AFTER THE THIRD REVIEW ROUND'S FIXES, AND THE FLOORS ARE LEFT WHERE
      // THEY ARE: lines 97.99 (1513/1544), functions 97.77 (308/315), branches 89.52 (829/926),
      // statements 95.37 (1713/1796). Every figure moved UP — the two tests that round added executed
      // `replies.ts`'s phantom-fork retire arm, which nothing had reached before. The formula would now
      // read 96/96/88/94; **it is not re-run here, and that is the same decision the `branches`
      // paragraph above records rather than a lapse.** These are review-fix deltas of a half point or
      // less on a gate whose stated margin is one to two points, and a floor that moves on every commit
      // is a floor nobody can read a regression against. The place to re-run the formula is a slice's
      // close, where a reviewer sees the argument beside the number.
      //
      // THE TIGHTEST OF THE FOUR IS STILL `functions`, NOT `branches`. Computed from the RE-MEASURED
      // figures against these floors, the number of NEW UNTESTED entries needed to trip each is:
      // functions **10** (308/325 -> 94.77%), branches 27 (829/953 -> 86.99%), statements 46
      // (1713/1842 -> 92.99%), lines 33 (1513/1577 -> 95.94%). LOSING already-covered entries instead
      // takes: functions 9 (299/315 -> 94.92%), branches 24 (805/926 -> 86.93%), statements 43
      // (1670/1796 -> 92.98%), lines 31 (1482/1544 -> 95.98%).
      //
      // BOTH LISTS ARE SPELLED OUT RATHER THAN ONE BEING DERIVED FROM THE OTHER BY A RULE. This block
      // used to say the losing counts were "one fewer each, since the denominator doesn't grow with
      // them" — true of functions and lines, false of branches (three fewer) and statements (two), and
      // it came paired with parenthetical fractions that were the LOSING scenario's arithmetic printed
      // against the NEW-UNTESTED scenario's integers. Both were found in the whole-branch review. The
      // integers above are computed, not reasoned about: the rounding is not linear near a floor and
      // the two scenarios differ by however many entries that rounding swallows.
      //
      // `functions` has 315 entries against a 95% floor, so nine lost or ten new-and-untested trips
      // it — still the floor that will produce friction first, same as before the raise.
      thresholds: { lines: 96, functions: 95, branches: 87, statements: 93 },
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
              // TWO FLAGS, AND `frame-cost.test.ts` NEEDS BOTH — one to make the reading move at all,
              // the other to make it mean something. Chromium-only, and harmless to every other browser
              // test, which touch neither `performance.memory` nor `gc`.
              //
              // `--enable-precise-memory-info` — `frame-cost.test.ts` reads
              // `performance.memory.usedJSHeapSize` to measure `SPAN_BYTES` for real. WITHOUT IT the
              // value is frozen at a stale sample for tens of seconds regardless of allocation —
              // verified by allocating and dropping a 5M-element array under 45s of wall-clock with no
              // change in the reading, and again on 2026-08-10 by deleting this flag and watching every
              // heap delta in that test come back as exactly 0. WITH IT, the same experiment tracks
              // allocation and collection within one read.
              //
              // `--js-flags=--expose-gc` — exposes `globalThis.gc()`, a full synchronous collection.
              // WITHOUT IT the heap delta across a window is "bytes allocated MINUS whatever the
              // collector happened to do in that window", which is a schedule, not a size: measured
              // 2026-08-10, the same test on the same build reported 51.9, 74.6 and 91.4 bytes/span
              // purely by varying V8's GC flags. That variation has no fixed sign or bound — a "nothing
              // collected" model predicts ~-0.1 bytes/span, but observed failures ran 40-55x that
              // (-3.955, -4.192, -5.746, and separately +91.4 from a run where a large collection
              // landed inside one window) — see `frame-cost.test.ts` for the full, correctly-paired
              // numbers; it is partial collection landing asymmetrically between the two windows, not
              // "nothing collected", and it has no guaranteed sign.
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
