import type { EditorView } from '@codemirror/view'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { leafEl, retype, SHELL, stateIdle, until } from './harness'

/**
 * **AN ANSWER COMPUTED FROM OLDER TEXT MUST NOT OVERWRITE WHAT WAS TYPED WHILE IT WAS IN FLIGHT.**
 * A `format` answer writes into an editor after a round trip, and its edits were computed against the text the
 * server held when it was asked. Applied whatever had been typed since, it would lose the typing.
 *
 * **THE RACE IS PLACED, NOT WAITED FOR.** The test types from INSIDE the app's own `postMessage` to
 * the worker, so the typing lands after the request leaves and before any answer can come back, on
 * every machine. It types with `dispatch`, which is what a keystroke reaches the editor's listeners
 * as; `userEvent` is a round trip to the browser driver and could not land inside that call. The
 * test then waits for that request's own reply, heard on the worker AFTER the app's listener, which
 * was attached when the app built the worker — so the app has handled it by then.
 */

type Tap = { match: (m: unknown) => boolean; run: (worker: Worker, m: unknown) => void }
const taps: Tap[] = []
const post = Worker.prototype.postMessage

let source: EditorView

const kindOf = (m: unknown) => (m as { kind?: string } | null)?.kind
const isFormatting = (m: unknown) =>
  kindOf(m) === 'msg' && JSON.parse((m as { json: string }).json).method === 'textDocument/formatting'

/** Run `run` inside the next `postMessage` whose message `match`es, once. */
function tap(match: Tap['match'], run: Tap['run']): void {
  taps.push({ match, run })
}

/** The answer to the language server request `m`, heard on `worker` after the client has handled it. */
function answerTo(worker: Worker, m: unknown): Promise<void> {
  const id = JSON.parse((m as { json: string }).json).id
  return new Promise((resolve) => {
    const heard = (e: MessageEvent) => {
      if (e.data?.kind !== 'out' || !e.data.messages.some((x: { id?: number }) => x.id === id)) return
      worker.removeEventListener('message', heard)
      resolve()
    }
    worker.addEventListener('message', heard)
  })
}

/** Click `format` in `leaf`'s `⋯` menu, the control a user has. */
function clickFormat(leaf: string): void {
  const more = leafEl(leaf).querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
  more.click()
  const item = document.getElementById(more.getAttribute('aria-controls') ?? '')?.querySelector('button.format-doc')
  ;(item as HTMLButtonElement).click()
}

/**
 * Click `format` in `leaf`'s `⋯` menu and type `typed` into `editor` from inside the `formatting`
 * request's `postMessage`, then wait for its answer — heard after the client's listener, whose promise
 * continuations (the one that applies the edits among them) have all run by then.
 */
async function formatWhileTyping(leaf: string, editor: EditorView, typed: string): Promise<void> {
  const answered = new Promise<void>((resolve) =>
    tap(isFormatting, (w, m) => {
      retype(editor, typed)
      void answerTo(w, m).then(resolve)
    }),
  )
  clickFormat(leaf)
  await answered
}

beforeAll(async () => {
  Worker.prototype.postMessage = function (this: Worker, message: unknown, options?: unknown) {
    ;(post as (this: Worker, m: unknown, o?: unknown) => void).call(this, message, options)
    const i = taps.findIndex((t) => t.match(message))
    if (i === -1) return
    const [t] = taps.splice(i, 1)
    t?.run(this, message)
  }
  document.body.innerHTML = SHELL
  source = await (await import('../../src/main')).ready
  source.dispatch({ changes: { from: 0, to: source.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(stateIdle, 'the app to settle')
})

afterAll(() => {
  Worker.prototype.postMessage = post
})

/** A tap a failed test left behind would be taken by the next test's request instead of its own. */
afterEach(() => {
  taps.length = 0
})

describe('a format answer', () => {
  it('is not applied over what was typed into the source while it was in flight', async () => {
    retype(source, 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(3)\n')
    const typed = 'let y = 1; y + 1\n'
    await formatWhileTyping('source', source, typed)
    expect(source.state.doc.toString()).toBe(typed)
  })
})
