import { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * **AN ANSWER COMPUTED FROM OLDER TEXT MUST NOT OVERWRITE WHAT WAS TYPED WHILE IT WAS IN FLIGHT.**
 * Two kinds of answer write into an editor after a round trip: a copy's build reply, which re-seeds
 * the copy's editor with the buffer's text, and a `format` answer, whose edits were computed against
 * the text the server held when it was asked. Each used to be applied whatever had been typed since,
 * and the typing was lost — then, for a copy, the pending debounce posted the older text back as if
 * the user had written it.
 *
 * Found on the slower CI runner, through `lsp-copy-diagnostics.test.ts`'s `leaves an unparseable copy
 * alone`: the previous test's `format` recompiled the copy, that build's reply landed after the next
 * test had typed a broken machine, and the re-seed put the valid text back, so no marker ever came.
 *
 * **THE RACE IS PLACED, NOT WAITED FOR.** Each test types from INSIDE the app's own `postMessage` to
 * the worker, so the typing lands after the request leaves and before any answer can come back, on
 * every machine. It types with `dispatch`, which is what a keystroke reaches the editor's listeners
 * as; `userEvent` is a round trip to the browser driver and could not land inside that call. The
 * test then waits for that request's own reply, heard on the worker AFTER the app's listener, which
 * was attached when the app built the worker — so the app has handled it by then.
 */

type Tap = { match: (m: unknown) => boolean; run: (worker: Worker, m: unknown) => void }
const taps: Tap[] = []
/** Every build the app posts, so a test can tell whether a newer one overtook the one it placed. */
const builds: { kind: string; gen: number }[] = []
const post = Worker.prototype.postMessage

let source: EditorView

const paneHost = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"]`) as HTMLElement
const editorIn = (leaf: string) =>
  EditorView.findFromDOM(paneHost(leaf).querySelector('.term-editor') as HTMLElement) as EditorView
const markersIn = (leaf: string) => paneHost(leaf).querySelectorAll('.cm-editor .cm-lintRange-error').length
const retype = (v: EditorView, text: string) =>
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
const kindOf = (m: unknown) => (m as { kind?: string } | null)?.kind

/** Run `run` inside the next `postMessage` whose message `match`es, once. */
function tap(match: Tap['match'], run: Tap['run']): void {
  taps.push({ match, run })
}

/** A reply to the build `gen`, heard on `worker` after the app has handled it. */
function replyTo(worker: Worker, kind: string, gen: number): Promise<void> {
  return new Promise((resolve) => {
    const heard = (e: MessageEvent) => {
      if (e.data?.kind !== kind || e.data.gen !== gen) return
      worker.removeEventListener('message', heard)
      resolve()
    }
    worker.addEventListener('message', heard)
  })
}

/**
 * Type `text` into `leaf`'s copy, and wait until the build that carries exactly it has been answered —
 * a settled start, with no older build left in flight to land on the test that follows.
 */
async function settle(leaf: string, text: string, build: string, reply: string): Promise<void> {
  const answered = new Promise<void>((resolve) =>
    tap(
      (m) => kindOf(m) === build && (m as { src: string }).src === text,
      (w, m) => void replyTo(w, reply, (m as { gen: number }).gen).then(resolve),
    ),
  )
  retype(editorIn(leaf), text)
  await answered
}

/**
 * Type `next` into `leaf`'s copy; when the build carrying it is posted, type `typed` over it at once,
 * and wait for that build's reply. Answers whether a newer build was posted before the reply — the case
 * where the client drops the reply and this test would place nothing.
 */
async function typeWhileBuilding(leaf: string, next: string, typed: string, build: string, reply: string) {
  const editor = editorIn(leaf)
  const answered = new Promise<boolean>((resolve) =>
    tap(
      (m) => kindOf(m) === build && (m as { src: string }).src === next,
      (w, m) => {
        const gen = (m as { gen: number }).gen
        retype(editor, typed)
        void replyTo(w, reply, gen).then(() => resolve(builds.some((b) => b.kind === build && b.gen > gen)))
      },
    ),
  )
  retype(editor, next)
  return { editor, overtaken: await answered }
}

/**
 * Click `format` in `leaf`'s `⋯` menu and type `typed` into `editor` from inside the `formatting`
 * request's `postMessage`, then wait for its answer — heard after the client's listener, whose promise
 * continuations (the one that applies the edits among them) have all run by then.
 */
async function formatWhileTyping(leaf: string, editor: EditorView, typed: string): Promise<void> {
  const answered = new Promise<void>((resolve) =>
    tap(
      (m) => kindOf(m) === 'msg' && JSON.parse((m as { json: string }).json).method === 'textDocument/formatting',
      (w, m) => {
        const id = JSON.parse((m as { json: string }).json).id
        retype(editor, typed)
        const heard = (e: MessageEvent) => {
          if (e.data?.kind !== 'out' || !e.data.messages.some((x: { id?: number }) => x.id === id)) return
          w.removeEventListener('message', heard)
          resolve()
        }
        w.addEventListener('message', heard)
      },
    ),
  )
  const more = paneHost(leaf).querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
  more.click()
  const item = document.getElementById(more.getAttribute('aria-controls') ?? '')?.querySelector('button.format-doc')
  ;(item as HTMLButtonElement).click()
  await answered
}

async function fork(leaf: string): Promise<void> {
  const button = paneHost(leaf).querySelector<HTMLButtonElement>('button.detach') as HTMLButtonElement
  expect(button.disabled).toBe(false)
  button.click()
  await until(() => paneHost(leaf).querySelector('.term-editor') !== null, `a copy's editor in ${leaf}`)
}

beforeAll(async () => {
  Worker.prototype.postMessage = function (this: Worker, message: unknown, options?: unknown) {
    ;(post as (this: Worker, m: unknown, o?: unknown) => void).call(this, message, options)
    const gen = (message as { gen?: number } | null)?.gen
    if (gen !== undefined) builds.push({ kind: kindOf(message) ?? '', gen })
    const i = taps.findIndex((t) => t.match(message))
    if (i === -1) return
    const [t] = taps.splice(i, 1)
    t?.run(this, message)
  }
  document.body.innerHTML = SHELL
  source = await (await import('../../src/main')).ready
  source.dispatch({ changes: { from: 0, to: source.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the app to settle')
  await fork('tm-0')
  await fork('lambda-0')
})

afterAll(() => {
  Worker.prototype.postMessage = post
})

describe("a copy's build reply", () => {
  it('keeps what was typed into a TM copy while its build was in flight', async () => {
    await settle('tm-0', 'tapes 1\nstart s\nstate s: accept\n', 'tm-scratch', 'tm-scratch-compiled')
    const broken = 'tapes 1\ntapes 2\nstart s\nstate s: accept\n'
    const { editor, overtaken } = await typeWhileBuilding(
      'tm-0',
      'tapes 1\nstart q\nstate q: accept\n',
      broken,
      'tm-scratch',
      'tm-scratch-compiled',
    )
    expect(overtaken, 'the reply has to land while the typing is still unsent').toBe(false)
    expect(editor.state.doc.toString()).toBe(broken)
    // And the server comes to hold it: the duplicate `tapes` line is marked.
    await until(() => markersIn('tm-0') > 0, 'the typed machine to be marked broken')
    expect(editor.state.doc.toString()).toBe(broken)
  })

  it('keeps what was typed into a λ copy while its build was in flight', async () => {
    await settle('lambda-0', '\\x. x', 'lambda-scratch', 'scratch-compiled')
    const { editor, overtaken } = await typeWhileBuilding(
      'lambda-0',
      '\\z. z',
      '\\y. y y',
      'lambda-scratch',
      'scratch-compiled',
    )
    expect(overtaken, 'the reply has to land while the typing is still unsent').toBe(false)
    // Not `λz. z`, the older build's text as the worker prints it.
    expect(editor.state.doc.toString()).toBe('\\y. y y')
  })
})

describe('a format answer', () => {
  it('is not applied over what was typed into a copy while it was in flight', async () => {
    await settle('tm-0', 'tapes 1\nstart s\nstate s:    accept\n', 'tm-scratch', 'tm-scratch-compiled')
    const editor = editorIn('tm-0')
    const typed = 'tapes 1\nstart q\nstate q:    accept\n'
    await formatWhileTyping('tm-0', editor, typed)
    expect(editor.state.doc.toString()).toBe(typed)
  })

  it('is not applied over what was typed into the source while it was in flight', async () => {
    retype(source, 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(3)\n')
    const typed = 'let y = 1; y + 1\n'
    await formatWhileTyping('source', source, typed)
    expect(source.state.doc.toString()).toBe(typed)
  })
})
