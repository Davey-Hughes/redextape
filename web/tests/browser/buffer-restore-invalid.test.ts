import { beforeAll, describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY, BUFFERS_VERSION, parseBuffers } from '../../src/buffers-store'
import { defaultLayout, LAYOUT_STORAGE_KEY, serializeLayout } from '../../src/layout'

/**
 * **A CORRUPT `redextape.buffers` DEGRADES TO A FRESH PAGE** — design §4.1's whole argument for
 * co-locating the bindings with the buffers they name, asserted through `main()`.
 *
 * **A SECOND FILE RATHER THAN A SECOND TEST, AND THE REASON IS THE ONE `buffer-restore.test.ts` STATES
 * AT LENGTH**: ES module imports are cached, so `main()` runs once per page and Vitest gives each test
 * FILE its own page. This claim needs `localStorage` to hold something DIFFERENT at the moment of that
 * one mount, and there is no way to ask for a second one.
 *
 * **THE FIXTURE IS A PAYLOAD THAT PARSES AS JSON AND THEN VIOLATES THE TYPE**, not a string of noise.
 * `parseBuffers`'s own doc names the hazard it is written for — a hand-edited `localStorage` entry — and
 * a value that fails `JSON.parse` is caught by a `try` that would be there anyway. `minted: "lots"` gets
 * past the envelope and the version check and is refused on a field, which is the class of failure the
 * validation exists for and the only one that could otherwise reach the app.
 *
 * IT NO LONGER SUBSTITUTES ITS OWN `Storage` — every browser test file gets one automatically now,
 * installed in `tests/browser/setup.ts` before this file's own module body runs, for
 * `buffer-restore.test.ts`'s reason verbatim: `localStorage` is scoped to an ORIGIN and Vitest runs
 * browser files concurrently in one, so a CORRUPT value written to the shared store would be read by
 * whichever sibling mounts `main()` next — this file's fixture is exactly the thing no other file should
 * ever see. What is left here is just the seeding, straight through `localStorage`, which is that
 * per-file shim by the time this line runs.
 */

const SHELL = `
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

beforeAll(async () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(defaultLayout()))
  localStorage.setItem(BUFFERS_STORAGE_KEY, `{"version":${BUFFERS_VERSION},"minted":"lots"}`)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
})

/**
 * **WHAT THIS FILE ACTUALLY PINS, STATED PLAINLY — IT IS THE WRITER'S BEHAVIOUR, NOT THE READER'S.**
 * Both assertions below are satisfied by an implementation that never reads `redextape.buffers` at
 * all, not only by one that reads it and correctly refuses a corrupt payload. The first (`#buffers`
 * reads the zero-buffer label, no `.detached-badge`) is vacuously true whenever nothing restores,
 * corrupt payload or none. The second (the stored value equals `{minted:0,buffers:[],bindings:{}}`) is
 * produced by `refreshBuffers()`'s ordinary, unconditional start-up write (`main.ts`'s start-up
 * `refreshBuffers()` call, made after `compile.schedule(SAMPLE)` — that call site's own comment is the
 * authoritative account of why it sits there), which fires on every
 * page load regardless of whether anything upstream of it ever looked at these bytes. So this file
 * cannot distinguish "read the corrupt payload and refused it" from "never read the key at all" — it
 * pins that a refused restore leaves the app in the state a fresh page starts in, not that the refusal
 * itself happened. `buffer-restore.test.ts` carries the READER claim (that a valid payload actually
 * comes back); this file is its weaker sibling, kept as coverage of the degrade-safely behaviour rather
 * than rewritten, because closing the gap needs an assertion that can tell "read and refused" apart
 * from "never read" — a spy on the read path, or a payload that is well-formed but should still be
 * refused for a reason this file does not have one of.
 */
describe('a corrupt buffers payload', () => {
  it('a corrupt buffers key leaves the page with no buffers and every pane on source', () => {
    // **THE BUTTON READS THE ZERO-BUFFER LABEL — 5d-iv T10.** This used to assert `#buffers`'s own
    // `hidden` was `true`, which `main.ts`'s `refreshBuffers` no longer sets at any count: the menu now
    // offers "new TM buffer" and so is never empty, which is exactly why the control is reachable at
    // zero rather than withheld. `textContent` is what still answers "did nothing restore" — the label
    // is `buffers ▾` (`buffer-list.ts`'s `update`, the zero case this task added) only when the count is
    // genuinely zero, which a restored buffer would move off of.
    expect(document.querySelector<HTMLButtonElement>('#buffers')?.textContent).toBe('buffers ▾')
    // AND NO PANE IS DETACHED. `.detached-badge` is `pane-chrome.ts`'s own class for the `[detached]`
    // marker, mounted and unmounted rather than hidden, and a buffer is the only session in this app
    // that can produce one — so its absence is "every pane is on the source session" stated in the DOM.
    expect(document.querySelector('[data-leaf="lambda-0"] .detached-badge')).toBeNull()
  })

  /**
   * **THE PAGE DOES NOT LEAVE THE BAD BYTES BEHIND.** An earlier version of this comment claimed:
   * "`main()`'s write-back after the first `applyLayout()` persists the payload... Without it the corrupt
   * value would sit in storage being re-refused on every load." That statement is false — the corrupt
   * bytes are already cleared before `applyLayout()` runs. `refreshBuffers()`'s unconditional start-up
   * call fires during initialization and includes `persistBuffers()`, which
   * unconditionally writes `{minted:0,buffers:[],bindings:{}}` regardless of whether anything upstream
   * ever read or refused the corrupt payload. The write-back — `main()`'s last `persistBuffers()`, after
   * the first `applyLayout()` — corrects the bindings map (which start-up's write left empty by
   * necessity), not the failed restore itself.
   *
   * BOTH CITED BY SYMBOL RATHER THAN BY LINE. This file used to name the same two call sites by number,
   * as lines 947 and 1249 of `main.ts`, while its sibling `buffer-restore.test.ts` named the same two
   * as lines 936 and 1240 — two files disagreeing about one pair of lines, and both wrong
   * (whole-branch review before merge). A number that has to be maintained in two files is a number that
   * will not be.
   *
   * ASSERTED THROUGH `parseBuffers` RATHER THAN ON THE RAW STRING, because what matters is that what is
   * there now is a value this app would ACCEPT — the bad payload was a string too.
   */
  it('replaces the corrupt payload with the empty one the page actually has', () => {
    expect(parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))).toEqual({ minted: 0, buffers: [], bindings: {} })
  })
})
