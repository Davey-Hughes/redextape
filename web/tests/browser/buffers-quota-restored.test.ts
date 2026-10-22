import { describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY, serializeBuffers } from '../../src/buffers-store'
import { noticeText, SHELL } from './harness'

/**
 * **A PAGE THAT RESTORED BUFFERS FROM STORAGE, HITTING A FULL STORE ON ITS VERY FIRST WRITE, DEGRADES
 * RATHER THAN DYING AT START-UP.** `main.ts`'s `refreshBuffers()` start-up call reaches `persistBuffers()`,
 * which reaches `writeBuffersStorage()`'s `catch`, which calls `reportStorageFailure()` — all inside
 * `main()`, so a throw on that path would leave `main()` itself, not caught anywhere, which is strictly
 * worse than the silent failure 5d-ii-d design §4.8 exists to improve on. This file is what proves it does
 * not: mount a page that restores a buffer, refuse the buffers write from before the mount even begins, and
 * assert `main()` still returns a working page — the specific scenario `buffers-quota.test.ts`'s "a full
 * store" describe does not reach, since that file's page has never forked when it mounts.
 *
 * **ONE STORED BUFFER, NO BINDING, IS THE WHOLE FIXTURE** — deliberately the minimal shape the
 * hazard needs and not a full restore-and-rebind scenario (`buffer-restore.test.ts` already covers
 * that path in depth). `hasBuffers` is `payload.buffers.length > 0`, read off `scratchpad`'s own
 * records regardless of which pane, if any, is bound to a buffer — `main.ts` passes exactly that
 * expression as `writeBuffersStorage`'s second argument, and it names `payload.buffers` and never
 * `payload.bindings`. So an orphaned buffer and an empty `bindings` map reproduce the hazard exactly,
 * with no layout seeding and no warming needed.
 *
 * **ITS OWN FILE, FOR THE ONE-MOUNT-PER-FILE REASON `app.test.ts` GIVES.** It needs the buffers key
 * seeded with a real payload AND every subsequent write to that key refused from before `main()`'s
 * own module body runs — a combination no other file in this directory needs at once.
 */

/**
 * **THE STATE A PREVIOUS PAGE LOAD WOULD HAVE LEFT: one buffer, and nothing bound to it.**
 * `buffer-restore.test.ts`'s own `SEEDED` names this shape "an orphan" and builds it with
 * `serializeBuffers` for the same reason repeated here: the stored bytes are then exactly what the
 * app writes, so `parseBuffers` accepting them proves something about the app rather than about this
 * file's spelling of an envelope.
 */
const SEEDED = serializeBuffers({
  minted: 1,
  buffers: [{ id: 'scratch-1', label: 'scratch 1', text: '(\\a. a)', collapsed: false, leg: 'lambda' }],
  bindings: {},
})

/**
 * **SEEDED THROUGH THE PASSTHROUGH, BEFORE THE WRAPPER BELOW IS INSTALLED** — the seed itself must
 * reach storage, and the refusal that follows is for `main()`'s own writes, not for this file's own
 * setup. Both happen at module scope, before `beforeAll`/`it` machinery even runs, so the refusal is
 * "armed... before the mount" in the strongest sense: it is live before this file's own test bodies
 * exist to arm it from inside one.
 */
const passthroughSetItem = localStorage.setItem.bind(localStorage)
passthroughSetItem(BUFFERS_STORAGE_KEY, SEEDED)
localStorage.setItem = (key: string, value: string): void => {
  if (key === BUFFERS_STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError')
  passthroughSetItem(key, value)
}

describe('a restored page with a refusing writer', () => {
  /**
   * **`await ... .ready` NOT RESOLVING IS THE FAILURE MODE UNDER TEST**, not a side detail of driving
   * the app. A throw on the restore-time write is reported at this line: `main()`'s promise rejects
   * with it, and this `it` fails with that error rather than with a normal assertion.
   *
   * **THE SECOND ASSERTION IS WHAT RULES OUT AN EVASIVE FIX.** A version that made this pass by
   * swallowing the write failure (a bare `catch`, or a guarded notify with nothing to follow up) would
   * also make `main()` return cleanly — but the notice line would stay silent about a
   * failure that is real, which is the same silence design §4.8 was written to remove. Requiring the
   * report to actually appear is what makes this a test of "degrades gracefully" and not merely
   * "does not crash".
   */
  it('comes up rather than dying at start-up on the restore-time write', async () => {
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    expect(noticeText()).toContain('not being saved')
  })
})
