/**
 * Shared browser-tier fixtures: the app shell every test file mounts into, and the poll helper every
 * test file waits on. Both were duplicated — `SHELL` 29 times, `until` 23 times in 7 different bodies —
 * until this file replaced them.
 *
 * **WHY THIS DOES NOT BREAK THE DIRECTORY'S STANDING IDIOM.** Files in this directory have long carried
 * a comment saying that each browser test file gets its own page — `main()` runs once per module load
 * and Vitest gives each test file its own page — and concluding from it that duplicating a mount
 * helper is right, because "a shared mount would be a shared page two files could not both own". The
 * premise is a fact about the test runner and it holds; the conclusion is about a MOUNT. `SHELL` is an
 * inert template string and `until` closes over nothing, so importing either into two files shares no
 * page, no state and no mount. `setup.ts` already demonstrates a shared non-test module being loaded
 * once per page without sharing anything across pages. `mountApp` deliberately stays per-file: four
 * files declare one, all four bodies differ, and each owns its own page.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names
 * end in `.test.ts`, and this one does not.
 */

/**
 * The app shell that `index.html` provides in production and Vitest's own tester HTML does not.
 *
 * Reset `document.body.innerHTML` to this before a mount so a new instance queries fresh elements
 * rather than ones an earlier instance's listeners are still attached to.
 */
export const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

/** Longest predicate source a failure message will quote before it starts eliding. */
const MAX_SOURCE_CHARS = 120

const sourceOf = (predicate: () => boolean): string => {
  const src = predicate.toString().replace(/\s+/g, ' ').trim()
  return `\`${src.length > MAX_SOURCE_CHARS ? `${src.slice(0, MAX_SOURCE_CHARS)}…` : src}\``
}

/**
 * Poll `predicate` until it holds, or throw naming what never happened.
 *
 * **THE PREDICATE IS EVALUATED BEFORE THE FIRST SLEEP**, so `until(() => true)` waits for nothing. Every
 * one of the seven bodies this replaced had that property and several call sites rely on it.
 *
 * **THE DEFAULT IS BOUNDED BELOW VITEST'S OWN, WHICH IS THE ENTIRE REASON IT IS ONE NUMBER.** Browser
 * mode raises `testTimeout` to 15,000 ms and `hookTimeout` to 30,000 — both measured against this
 * project's own config, which sets neither — so a wait bounded at or above the harness's own lets Vitest
 * kill the test first and report `Test timed out in 15000ms.` with no name for what never arrived. Twelve
 * files shipped a default above the bound and eleven call sites shipped `60_000`, none of which could
 * ever fire. 10,000 clears both bounds and is five times the slowest wait measured anywhere in this
 * tier. **That property is per WAIT, not per test.** Vitest's bound covers a test as a whole, so one
 * wait can reach this ceiling and still print its own name while two in the same test cannot. No wait
 * in this tier exceeds 2,000 ms, so the margin is ample today and the distinction is worth stating
 * rather than discovering.
 *
 * **DO NOT PASS `timeoutMs` FROM A CALL SITE.** `tests/node/browser-timeout-invariants.test.ts` fails if
 * any call site under `tests/browser/` passes a numeric timeout. A wait that genuinely needs longer is a
 * reason to change this default and say why in the commit, not to add a number nothing re-checks.
 *
 * **THE REAL CEILING IS `timeoutMs + pollMs`, NOT `timeoutMs` ALONE**, because the throw only fires once
 * a sleep returns and finds the predicate still false. At today's defaults that is 10,000 + 20 = 10,020
 * ms, comfortably under both vitest bounds — but the gate above reads only `timeoutMs`; nothing checks
 * `pollMs`. A future `pollMs` raised high enough reintroduces the exact defect this file exists to close,
 * with the gate reporting green throughout, because it was never asked about the parameter that moved.
 *
 * **`pollMs` EXISTS FOR THE NODE-TIER UNIT TESTS IN `tests/node/harness.test.ts`, AND MUST NOT BE PASSED
 * FROM THE BROWSER TIER.** Shortening the poll interval there is what lets a unit test built around a
 * fake predicate finish in milliseconds instead of waiting out a real one; no file under `tests/browser/`
 * has a reason to pass it. The gate's own boundary does not distinguish which parameter a call site's
 * argument lands in, so a browser call passing only `pollMs` numerically is still rejected — with a
 * message reading "passes a numeric timeout", which is true of the ceiling this file protects and not of
 * which of the two parameters actually carried the number.
 */
export async function until(predicate: () => boolean, what?: string, timeoutMs = 10_000, pollMs = 20): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what ?? sourceOf(predicate)}`)
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
}
