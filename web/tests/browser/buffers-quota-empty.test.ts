import { describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY } from '../../src/buffers-store'

/**
 * **THE NEGATIVE CASE `writeBuffersStorage`'s `hasBuffers` GUARD EXISTS FOR, EXERCISED HERE FOR THE
 * FIRST TIME.** `buffers-quota.test.ts` proves a user WITH buffers gets told once and only once; this
 * file proves the other half of design §4.8's "no buffers, no work, no report" — a user who has never
 * forked, sitting at a full store, gets nothing on `#link-status` at all. Nothing in the existing
 * suite exercises this: every sibling either lets every write through or arms the refusal from INSIDE
 * a test, after the app's own start-up writes have already gone through untouched.
 *
 * **ITS OWN FILE, FOR THE ONE-MOUNT-PER-FILE REASON EVERY SIBLING GIVES** (`buffer-restore.test.ts`'s
 * own doc has the argument in full). This one specifically needs the refusal ARMED BEFORE `main()`'s
 * own module body ever runs, so that the very first `localStorage.setItem(BUFFERS_STORAGE_KEY, ...)`
 * — `refreshBuffers()`'s start-up call in `main.ts`, now made once `linkWiring`/`draw` are real values
 * — is the write under test. `buffers-quota.test.ts` cannot be reused for this: it arms the refusal
 * from inside its own `it`, after that first write has already succeeded, which is exactly wrong for
 * a test about the FIRST write's own `hasBuffers` answer.
 *
 * **THE SHIM IS INSTALLED BY `tests/browser/setup.ts`, NOT BY THIS FILE** — every browser test file
 * gets its own in-memory `Storage` automatically, before this file's own module body runs. What this
 * file adds, at module scope so it is in place before `main()` ever calls `localStorage.setItem`, is a
 * wrapper that refuses ONE key unconditionally — there is no toggle here, unlike
 * `buffers-quota.test.ts`'s `refuseWrites`, because this file has exactly one scenario and the
 * refusal must already be live for the very first write.
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

const passthroughSetItem = localStorage.setItem.bind(localStorage)
localStorage.setItem = (key: string, value: string): void => {
  if (key === BUFFERS_STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError')
  passthroughSetItem(key, value)
}

async function until(predicate: () => boolean, what: string, timeoutMs = 30_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

const linkStatus = (): string => document.querySelector('#link-status')?.textContent ?? ''
const resultsText = (): string => document.querySelector('#results')?.textContent ?? ''

describe('a fresh page, never forked, with a refusing writer', () => {
  /**
   * **THE PAGE COMES UP AND STAYS SILENT ON `#link-status` — NOT "REPORTS AND THEN CLEARS", SILENT
   * FROM THE START.** `writeBuffersStorage`'s `hasBuffers` parameter is `payload.buffers.length > 0`;
   * a page that has never forked restores nothing (`localStorage` under this key is untouched by this
   * file) and mints nothing, so every write this page load makes — the start-up call and the
   * write-back after the first `applyLayout()` — carries an empty `buffers` array and never reaches
   * `reportStorageFailure`.
   *
   * WAITING FOR THE FIRST COMPILE RATHER THAN ASSERTING IMMEDIATELY is what makes this a test of
   * ABSENCE across the app's own start-up sequence and not just a snapshot taken before enough of
   * `main()` has run to say anything. Both buffers writes (`refreshBuffers()`'s start-up call and the
   * write-back after `applyLayout()`) happen synchronously before `main()` returns — before this
   * `await` even begins — so this bound is generous, not load-bearing; it exists to let the source
   * compile settle before the assertion, the same signal every sibling in this directory uses.
   */
  it('never reports, because there is nothing to lose', async () => {
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(
      () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== '',
      'the first compile',
    )
    // **THE POSITIVE CONTROL IS THE ELEMENT'S EXISTENCE, AND IT USED TO BE THE THING THIS PAIR COULD NOT
    // CHECK — whole-branch review before merge, finding 3b.** The two lines here read
    // `expect(linkStatus()).toBe('')` followed by `expect(linkStatus()).not.toContain('not being
    // saved')`, under a comment claiming the first was a positive control that would make a broken
    // `#link-status` "fail loudly here". It did the opposite in both directions: `linkStatus()` is
    // `querySelector('#link-status')?.textContent ?? ''`, so a REMOVED element answers `''` and passes
    // the exact-string check — the regression the control was supposed to catch is the one it hides —
    // and the second assertion could not fail at all once the first had passed, since `''` contains
    // nothing. (That comment also cited `app.test.ts`'s `until(() => linkStatusText() !== '')` as proof
    // of what such a page reads. That wait is for the NON-EMPTY case, on different fixtures, and proves
    // the opposite of what it was cited for.)
    //
    // SO THE ELEMENT IS ASSERTED SEPARATELY FROM ITS TEXT. The first line fails if `#link-status` is
    // gone, which no reading of its text can; the second is then a real statement about a real element.
    // The `.not.toContain` is dropped rather than kept beside it: with the element pinned and the text
    // pinned to `''`, a third assertion that `''` does not contain a phrase is the dead shape this
    // finding is about.
    expect(document.querySelector('#link-status')).not.toBeNull()
    expect(linkStatus()).toBe('')
  })
})
