import { describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY } from '../../src/buffers-store'
import { idle, noticeEl, SHELL, until } from './harness'

/**
 * **THE NEGATIVE CASE `writeBuffersStorage`'s `hasBuffers` GUARD EXISTS FOR.** `buffers-quota.test.ts`
 * proves a user WITH buffers gets told once and only once; this file proves the other half of design
 * §4.8's "no buffers, no work, no report" — a user who has never forked, sitting at a full store, is
 * told nothing on the notice line, where that report rests. `buffers-quota-restored.test.ts` arms the
 * same refusal before the mount, but its page restores a buffer and so has something to lose.
 *
 * **ITS OWN FILE, FOR THE ONE-MOUNT-PER-FILE REASON `app.test.ts` GIVES** (`buffer-restore.test.ts`'s
 * own doc has the argument in full). This one specifically needs the refusal ARMED BEFORE `main()`'s
 * own module body ever runs, so that the very first `localStorage.setItem(BUFFERS_STORAGE_KEY, ...)`
 * — `refreshBuffers()`'s start-up call in `main.ts` — is the write under test. `buffers-quota.test.ts`
 * cannot be reused for this: it arms the refusal from inside its own `it`, after that first write has
 * already succeeded, which is exactly wrong for a test about the FIRST write's own `hasBuffers` answer.
 *
 * **THE SHIM IS INSTALLED BY `tests/browser/setup.ts`, NOT BY THIS FILE** — every browser test file
 * gets its own in-memory `Storage` automatically, before this file's own module body runs. What this
 * file adds, at module scope so it is in place before `main()` ever calls `localStorage.setItem`, is a
 * wrapper that refuses ONE key unconditionally — there is no toggle here, unlike
 * `buffers-quota.test.ts`'s `refuseWrites`, because this file has exactly one scenario and the
 * refusal must already be live for the very first write.
 */

/** How many writes of the copies the wrapper below has refused. */
let refused = 0
const passthroughSetItem = localStorage.setItem.bind(localStorage)
localStorage.setItem = (key: string, value: string): void => {
  if (key === BUFFERS_STORAGE_KEY) {
    refused += 1
    throw new DOMException('quota', 'QuotaExceededError')
  }
  passthroughSetItem(key, value)
}

describe('a fresh page, never forked, with a refusing writer', () => {
  /**
   * **THE PAGE COMES UP AND ITS NOTICE LINE STAYS HIDDEN — NOT "REPORTS AND THEN CLEARS", SILENT FROM
   * THE START.** `writeBuffersStorage`'s `hasBuffers` parameter is `payload.buffers.length > 0`;
   * a page that has never forked restores nothing (`localStorage` under this key is untouched by this
   * file) and mints nothing, so every write this page load makes — the start-up call, and each
   * `applyLayout()`'s after it — carries an empty `buffers` array and never reaches
   * `reportStorageFailure`.
   *
   * WAITING FOR THE FIRST COMPILE RATHER THAN ASSERTING IMMEDIATELY is what makes this a test of
   * ABSENCE across the app's own start-up sequence and not just a snapshot taken before enough of
   * `main()` has run to say anything. Start-up's buffers writes (`refreshBuffers()`'s own call, and
   * `applyLayout()`'s after it) happen synchronously before `main()` returns — before this
   * `await` even begins — so this bound is generous, not load-bearing; it exists to let the source
   * compile settle before the assertion.
   */
  it('never reports, because there is nothing to lose', async () => {
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(idle, 'the first compile')
    // THE WRITE UNDER TEST HAPPENED, AND WAS REFUSED: silence after no write would prove nothing.
    expect(refused).toBeGreaterThan(0)
    // **THE COPIES' REPORT RESTS ON THE NOTICE LINE** (`main.ts`'s `reportStorageFailure`) until a write of
    // the copies goes through, and this file refuses every one, so a report made anywhere in start-up
    // leaves the line showing here. `noticeEl()` has no fallback for a missing `#notice` (its cast only
    // hides the `null` from the type), so a page without the line throws on `.hidden` instead of passing
    // as silent.
    expect(noticeEl().hidden).toBe(true)
  })
})
