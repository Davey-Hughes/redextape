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
import { configDefaults, defineConfig } from 'vitest/config'

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

/**
 * The probes' own files, excluded from the browser project's default set unless `REDEXTAPE_PROBE` is
 * set — `pnpm test:probe` and `pnpm test:probe:tm` are what set it.
 *
 * **IT IS A MEASUREMENT WHOSE CONSOLE OUTPUT IS THE DELIVERABLE (each file's own header says so), AND A
 * DELIVERABLE NOBODY READS ON EVERY PUSH IS PURE COST.** Design §4.6's probe runs eleven real wasm
 * workers and builds eleven 32 MiB rings, deserialising every frame onto the main thread — the peak is
 * roughly half a gigabyte inside one page, which is the threshold it exists to measure. The browser
 * project has no `fileParallelism: false`, so under the default `include` that peak could land
 * concurrently with `session-memory.test.ts`'s and `frame-cost.test.ts`'s, in one origin, on every
 * push. This repo's history already records a λ probe taking 60 GiB of RAM and all of swap. 5d-iv T2's
 * probe is far cheaper (ten compiles, no workers — the fix round's own confirming points widened the
 * corpus from six programs to ten, and each one now mounts a real CodeMirror editor to time, not merely
 * compiles it) but joins the same list for the same structural reason below, not because it shares that
 * weight.
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
 * §4.6's whole argument is that a cap like this is a measurement rather than an extrapolation, and a
 * measurement that cannot be re-run is an extrapolation with a date on it.
 */
const PROBE_FILES = ['tests/browser/buffer-affordability.test.ts', 'tests/browser/tm-fork-cost.test.ts']
const PROBE_EXCLUDE = process.env.REDEXTAPE_PROBE === undefined ? PROBE_FILES : []

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
      // tracking noise — exactly what the one-to-two-point margin exists to absorb — so 87 stood.
      // (SUPERSEDED 2026-08-13, at a slice's close rather than mid-review: `branches` is 88 now. The
      // reasoning here is not repudiated — the last block below answers it on its own terms.)
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
      // RE-MEASURED 2026-08-13 (plan 5d-ii-b's close), AND THE FORMULA IS RE-RUN: lines 98.13
      // (1634/1665), functions 97.98 (340/347), branches 89.89 (890/990), statements 95.71
      // (1854/1937), over 498 tests in 51 files. Every figure is above the 5d-ii-a close recorded in
      // the paragraph above, so this slice raised coverage too. `floor(measured) - 1` gives
      // 97/96/88/94 and THOSE ARE THE FLOORS BELOW, raised from 96/95/87/93.
      //
      // THIS IS THE RE-RUN THE PARAGRAPH ABOVE DEFERRED, NOT A NEW POLICY. That block declined to move
      // the floors for a review-fix delta and named where the decision belonged: "the place to re-run
      // the formula is a slice's close, where a reviewer sees the argument beside the number." This is
      // a slice's close.
      //
      // THE COUNTER-ARGUMENT, ANSWERED RATHER THAN SKIPPED. Movement since that measurement is small —
      // statements +0.34, branches +0.37, functions +0.21, lines +0.14, none of them half a point — and
      // by itself that is noise, which is exactly the reasoning that left `branches` at 87 across a
      // 0.21-point drift and was right to. **The operative quantity is the gap between floor and
      // measured, not the delta since the last run.** That gap had reached 2.71 (statements), 2.89
      // (branches), 2.98 (functions) and 2.13 (lines) — past the one-to-two points this convention says
      // its floors are sized for, on all four at once. Deltas too small to justify a move individually
      // are precisely how a floor drifts a full point behind and stops catching a regression near where
      // it happens. After the raise the gaps are 1.71 / 1.89 / 1.98 / 1.13, back inside the margin.
      // (Subtracted from the figures as the reporter PRINTS them, which truncates; from the unrounded
      // ratios each is up to 0.01 larger. Stated so a reader re-deriving these does not read a
      // discrepancy where there is only a rounding rule.)
      //
      // THE TIGHTEST OF THE FOUR IS STILL `functions`, AND IT IS THE REASON TO ACT. Under the OLD floor
      // of 95, **11** already-covered functions could disappear (329/347 -> 94.81%) or 11 new untested
      // ones arrive (340/358 -> 94.97%) before the gate said anything — the same magnitude (12) that
      // argued 5d-ii-a's raise. Under 96 it is 7 lost (333/347 -> 95.96%) or 8 new (340/355 -> 95.77%).
      //
      // THE OTHER THREE UNDER THE NEW FLOORS, both scenarios computed separately for each metric rather
      // than one derived from the other by a rule — see the paragraph below for why that matters.
      // NEW UNTESTED entries needed to trip each: lines 20 (1634/1685 -> 96.97%), branches 22
      // (890/1012 -> 87.94%), statements 36 (1854/1973 -> 93.96%). LOSING already-covered entries
      // instead takes: lines 19 (1615/1665 -> 96.99%), branches 19 (871/990 -> 87.97%), statements 34
      // (1820/1937 -> 93.95%).
      //
      // EVERY PERCENTAGE IN THIS BLOCK IS TRUNCATED, NOT ROUNDED — the rule the parenthetical four
      // paragraphs up already states, restated here because five of the ten fractions above are cases
      // where truncating and rounding disagree, and this block used to print the rounded one for them.
      // `istanbul-lib-coverage`'s `percent` is `Math.floor((100000 * covered / total) / 10) / 100`, so
      // a figure written the way a calculator rounds it is not the figure the report shows. The
      // sharpest case is `lines` under the losing scenario: 1615/1665 is 96.9970%, which a ROUNDING
      // reporter would print as `97.00` — equal to the floor, and so reading as a pass on a run that
      // has in fact tripped. It prints `96.99`, and that is the whole reason the rule is worth stating
      // twice.
      //
      // NO TRIP COUNT ABOVE MOVES BECAUSE OF THIS, and it cannot: every floor is an integer, and
      // truncating to two decimals never carries a value across an integer boundary, so `pct < floor`
      // has the same answer for the truncated figure and the exact ratio alike.
      //
      // BOTH LISTS ARE SPELLED OUT RATHER THAN ONE BEING DERIVED FROM THE OTHER BY A RULE. This block
      // used to say the losing counts were "one fewer each, since the denominator doesn't grow with
      // them" — true of functions and lines, false of branches (three fewer) and statements (two), and
      // it came paired with parenthetical fractions that were the LOSING scenario's arithmetic printed
      // against the NEW-UNTESTED scenario's integers. Both were found in 5d-ii-a's whole-branch review.
      // The integers above are computed, not reasoned about: the rounding is not linear near a floor and
      // the two scenarios differ by however many entries that rounding swallows. Under the new floors
      // `functions` still differs by one between the two scenarios and `branches` by three.
      //
      // See roadmap.md, "PLAN 5d-ii-b CLOSES", for the argument in full.
      //
      // RE-MEASURED 2026-08-13 (plan 5d-ii-c's close), THE FORMULA RE-RUN, AND THE FLOORS LEFT WHERE
      // THEY ARE: lines 98.24 (1735/1766), functions 98.09 (361/368), branches 90.00 (927/1030),
      // statements 95.81 (1967/2053), over 541 tests in 55 files. Every figure is above the 5d-ii-b close
      // recorded above (98.13 / 97.98 / 89.89 / 95.71), so this slice raised coverage too.
      //
      // RE-MEASURED FIVE TIMES THE SAME DAY: after the deferred-a11y item 11/12 fix added four tests,
      // after the editor-leak fix its review turned up added a fifth, after a browser walkthrough found
      // two defects in that leak fix and added a sixth, after the three usability changes that
      // walkthrough asked for added two more, and after two tests written for the two uncovered paths
      // whose failure costs most.
      //
      // **AND THIS TIME THE FLOORS MOVE. THE FOUR ENTRIES BEFORE IT DECLINED TO MOVE THEM AND THAT WAS
      // RIGHT; THIS IS NOT THE SAME SITUATION, WHICH IS WHY IT IS WRITTEN OUT RATHER THAN JUST DONE.**
      //
      // WHAT THOSE FOUR DECLINED TO CHASE WAS DRIFT. `branches` crossed the integer boundary `floor`
      // rounds on THREE TIMES in one day — 90.06 -> 90.15 -> 89.92 -> 90.00 — so the formula's answer
      // for it read 89, 89, 88, 89 across four commits on a 0.23-point total. A gate raised, lowered and
      // raised again inside a day is a gate reporting noise, and the one-to-two-point margin exists
      // precisely to absorb that. Nothing about that reasoning is repudiated here.
      //
      // WHAT THIS IS INSTEAD: two tests deliberately written for paths that had never executed —
      // `showBanner`, the app's entire "did not start" surface, and `transport.ts`'s re-throw arm, the
      // line that keeps a wiring bug from being rendered as a dim status line saying `fork failed`.
      // Statements moved +0.29 and crossed a WHOLE point (95.81 -> 96.10). That is not run-to-run
      // variation; it is coverage that did not exist before and does now, and it is exactly the case
      // 5d-ii-b's counter-rule was written for: "the operative quantity is the gap between floor and
      // measured, not the delta since the last run."
      //
      // THE GAPS ARE WHAT DECIDE IT. Against the OLD floors they were 2.10 / 2.09 / 2.36 / 1.52 — three
      // of four outside the margin this convention states, and the gate would have let 44 statements,
      // 22 branches, 9 functions and 27 lines rot before saying anything. Against the new ones they are
      // 1.10 / 1.09 / 1.36 / 1.52, every one inside it, and the rot allowance roughly halves: 23 / 12 /
      // 6 / 27. `lines` is unchanged by the formula and stays at 97.
      //
      // THE CONCRETE TEST, RECOMPUTED FROM THE NEW DENOMINATORS RATHER THAN SHIFTED — rounding near a
      // floor is not linear, which is why every one of these is derived and not adjusted. Under the NEW
      // floors: `functions` 6 already-covered can disappear (356/368 -> 96.73%) or 6 new untested arrive
      // (362/374 -> 96.79%); `statements` 23 lost (1950/2053 -> 94.98%) / 24 new (1973/2077 -> 94.99%);
      // `branches` 12 lost (916/1030 -> 88.93%) / 13 new (928/1043 -> 88.97%); `lines` 27 lost
      // (1713/1766 -> 96.99%) / 28 new (1740/1794 -> 96.98%). `functions` is still the tightest of the
      // four and still the one to watch.
      //
      // (EVERY FIGURE IN THAT LIST IS THE FIRST VALUE THAT *TRIPS* THE GATE, NOT THE LAST THAT PASSES —
      // the count is "how many can be lost/arrive BEFORE it says anything", so the percentage beside it
      // is already below the floor. This paragraph first read `24 new (1973/2077 -> 95.00%, the boundary
      // case, and it passes)`, which was wrong twice over: the figure is 94.99%, and it fails. Written
      // down because a threshold comment that quietly mixes the two conventions is unreadable, and
      // because it was caught by re-running the derivation rather than by reading it.)
      //
      // WHAT WOULD MAKE THIS THE WRONG CALL, stated so the next close can check rather than re-argue: if
      // 5d-ii-d's measured coverage comes in below 95 / 89 / 97 / 97 on a branch that added no untested
      // code, then this raise was tracking a peak rather than a level, and the honest response is to put
      // them back and say so — not to write tests to defend the number.
      // Every percentage above is TRUNCATED, not rounded, per the rule two blocks up.
      //
      // WHAT WOULD CHANGE THE ANSWER, stated so the next close does not have to re-derive it: if
      // `branches` and `functions` still read 90.xx and 98.xx at 5d-ii-d's close, the crossing will have
      // held across a slice rather than being a boundary artifact of one, and the raise to 89/97 should
      // be made there on that evidence. The place to re-run the formula remains a slice's close.
      //
      // See roadmap.md, "PLAN 5d-ii-c CLOSES", for the argument in full.
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
          // THE PROBE IS NOT IN THE DEFAULT SET — see `PROBE_EXCLUDE` above for the whole argument.
          // `pnpm test:probe` sets `REDEXTAPE_PROBE` and this list is then empty.
          //
          // `...configDefaults.exclude` FIRST, BECAUSE A BARE `exclude: PROBE_EXCLUDE` REPLACES
          // VITEST'S DEFAULT LIST RATHER THAN ADDING TO IT — `**/node_modules/**` and `**/.git/**` would
          // silently drop out. Harmless today only because `include` above is already confined to
          // `tests/browser/`, so nothing under `node_modules` or `.git` could match it anyway; the
          // moment that glob widens, the omission bites without a test to catch it.
          exclude: [...configDefaults.exclude, ...PROBE_EXCLUDE],
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
