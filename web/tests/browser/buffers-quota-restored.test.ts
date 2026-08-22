import { describe, expect, it } from 'vitest'
import { BUFFERS_STORAGE_KEY, serializeBuffers } from '../../src/buffers-store'

/**
 * **THE REGRESSION TEST FOR THE CRITICAL THIS SLICE'S OWN SELF-REVIEW FOUND AND DID NOT FIX ON FIRST
 * PASS** — a page that restored buffers from storage, hitting a full store on its very first write,
 * used to die at start-up rather than degrade. `main.ts`'s `refreshBuffers()` start-up call reached
 * `persistBuffers()` reached `writeBuffersStorage()`'s `catch`, which called `reportStorageFailure()`
 * — and `reportStorageFailure` reads `linkWiring`/`draw`, both still `undefined` at that point in
 * `main()`. The result was a bare `TypeError` thrown out of `main()` itself, not caught anywhere,
 * which is strictly worse than the silent failure this whole task exists to improve on.
 *
 * **THE FIX MOVED THE START-UP `refreshBuffers()` CALL PAST WHERE `linkWiring` AND `draw` ARE
 * ASSIGNED** (see that call site's own comment in `main.ts`, and the comment left at the old
 * position). This file is what proves it: mount a page that restores a buffer, refuse the buffers
 * write from before the mount even begins, and assert `main()` still returns a working page — the
 * SAME assertion the crash would have failed, and the specific scenario `buffers-quota.test.ts`'s
 * "a full store" describe does not reach, since that file's page has never forked when it mounts.
 *
 * **ONE STORED BUFFER, NO BINDING, IS THE WHOLE FIXTURE** — deliberately the minimal shape the
 * hazard needs and not a full restore-and-rebind scenario (`buffer-restore.test.ts` already covers
 * that path in depth). `hasBuffers` is `payload.buffers.length > 0`, read off `scratchpad`'s own
 * records regardless of which pane, if any, is bound to a buffer — `main.ts` passes exactly that
 * expression as `writeBuffersStorage`'s second argument, and it names `payload.buffers` and never
 * `payload.bindings`. So an orphaned buffer and an empty `bindings` map reproduce the hazard exactly,
 * with no layout seeding and no warming needed.
 *
 * **THAT SENTENCE USED TO CITE AN UNTRACKED WORKING NOTE, AND THE CITATION HAD GONE WORSE THAN DEAD.**
 * It named a per-task report file under the scratch note directory, whose own `.gitignore` is `*` — so
 * nothing there was ever tracked and no clone could follow it. Worse, those reports are numbered per
 * SLICE, not globally, so a later slice reused the filename: the path now holds a tree-sitter
 * regenerate-leg report about grammar generation, and the sentence this comment quoted is nowhere in
 * it. A dangling path fails loudly; a REUSED one resolves to a real, plausible-looking document about
 * something else entirely. The claim is now sourced to the code, which is tracked and checkable, and
 * the path is not spelled out here so that a grep for it stays a real check.
 *
 * **ITS OWN FILE, FOR THE ONE-MOUNT-PER-FILE REASON EVERY SIBLING GIVES.** It needs the buffers key
 * seeded with a real payload AND every subsequent write to that key refused from before `main()`'s
 * own module body runs — a combination no other file in this directory needs at once.
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

const linkStatus = (): string => document.querySelector('#link-status')?.textContent ?? ''

describe('a restored page with a refusing writer', () => {
  /**
   * **`await ... .ready` NOT RESOLVING IS THE FAILURE MODE UNDER TEST**, not a side detail of driving
   * the app. Before the fix this line is where the suite would report the crash: `main()`'s promise
   * rejects with the `TypeError` `reportStorageFailure` threw, and this `it` fails with that error
   * rather than with a normal assertion. After the fix `main()` returns its `EditorView` normally —
   * `linkWiring` and `draw` are both real by the time the refused write is attempted, so
   * `reportStorageFailure` runs to completion instead of throwing.
   *
   * **THE SECOND ASSERTION IS WHAT RULES OUT AN EVASIVE FIX.** A version that made this pass by
   * swallowing the write failure (a bare `catch`, or `linkWiring?.setForkFailed(...)` with nothing to
   * follow up) would also make `main()` return cleanly — but `#link-status` would stay silent about a
   * failure that is real, which is the same silence design §4.8 was written to remove. Requiring the
   * report to actually appear is what makes this a test of "degrades gracefully" and not merely
   * "does not crash".
   */
  it('comes up rather than dying at start-up on the restore-time write', async () => {
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    expect(linkStatus()).toContain('not being saved')
  })
})
