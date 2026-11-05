/**
 * The browser tier's one wait, in a module that imports nothing: `engine.ts`, which `collect.ts` loads before any
 * module of `src` compiles, waits on it too. `harness.ts` re-exports it for the test files.
 */

/** Longest predicate source a failure message will quote before it starts eliding. */
const MAX_SOURCE_CHARS = 120

const sourceOf = (predicate: () => boolean): string => {
  const src = predicate.toString().replace(/\s+/g, ' ').trim()
  return `\`${src.length > MAX_SOURCE_CHARS ? `${src.slice(0, MAX_SOURCE_CHARS)}…` : src}\``
}

/**
 * Poll `predicate` until it holds, or throw naming what never happened.
 *
 * **THE PREDICATE IS EVALUATED BEFORE THE FIRST SLEEP**, so `until(() => true)` waits for nothing.
 * Several call sites rely on it.
 *
 * **AND AFTER EVERY SLEEP IT IS EVALUATED BEFORE THE DEADLINE IS CHECKED**, so a state that arrived during a
 * sleep resolves the wait even when that sleep ended past `timeoutMs`. A page whose main thread is held runs
 * no timer, and the first poll after it can come seconds past the deadline. Checked the other way round, such
 * a wait would throw on a state that had arrived. `tests/node/harness.test.ts` holds the order.
 *
 * **THE DEFAULT IS BOUNDED BELOW VITEST'S OWN, WHICH IS THE ENTIRE REASON IT IS ONE NUMBER.** Browser
 * mode raises `testTimeout` to 15,000 ms and `hookTimeout` to 30,000 — both measured against this
 * project's own config, which sets neither — so a wait bounded at or above the harness's own lets Vitest
 * kill the test first and report `Test timed out in 15000ms.` with no name for what never arrived. 10,000
 * clears both bounds. **That property is per WAIT, not per test.** Vitest's bound covers a test as a whole,
 * so one wait can reach this ceiling and still print its own name while two in the same test cannot.
 *
 * **DO NOT PASS `timeoutMs` FROM A CALL SITE.** `tests/node/browser-timeout-invariants.test.ts` fails if a call
 * site under `tests/browser/` or `tests/firefox/` passes a numeric timeout. A wait that genuinely needs longer is a
 * reason to change this default and say why in the commit, not to add a number nothing re-checks.
 *
 * **THE REAL CEILING IS `timeoutMs + pollMs`, NOT `timeoutMs` ALONE**, because the throw only fires once
 * a sleep returns and finds the predicate still false. At the defaults that is 10,000 + 20 = 10,020 ms,
 * comfortably under both vitest bounds — but the gate above reads only the `timeoutMs` default; nothing
 * checks the `pollMs` default. A future `pollMs` raised high enough reintroduces the exact defect the
 * bound above closes, with the gate reporting green throughout, because it was never asked about the
 * parameter that moved.
 *
 * **`pollMs` EXISTS FOR THE NODE-TIER UNIT TESTS IN `tests/node/harness.test.ts`, AND MUST NOT BE PASSED
 * FROM THE BROWSER TIER.** Shortening the poll interval there is what lets a unit test built around a
 * fake predicate finish in milliseconds instead of waiting out a real one; no browser-tier file has a reason
 * to pass it. The gate's own boundary does not distinguish which parameter a call site's
 * argument lands in, so a browser call passing only `pollMs` numerically is still rejected, and its
 * failure names the number it found, not which of the two parameters carried it.
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
