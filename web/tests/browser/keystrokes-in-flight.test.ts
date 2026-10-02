import { EditorView } from '@codemirror/view'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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
/**
 * Every build the app posts, so a test can tell whether a newer one overtook the one it placed, and what
 * the last one carried.
 */
const builds: { kind: string; gen: number; src: string | undefined }[] = []
const post = Worker.prototype.postMessage
/** A `postMessage` kept back until `after` settles, which is how one answer is made to come after another. */
type Hold = { match: (m: unknown) => boolean; after: Promise<unknown> }
const holds: Hold[] = []

let source: EditorView

const paneHost = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"]`) as HTMLElement
const editorIn = (leaf: string) =>
  EditorView.findFromDOM(paneHost(leaf).querySelector('.term-editor') as HTMLElement) as EditorView
const markersIn = (leaf: string) => paneHost(leaf).querySelectorAll('.cm-editor .cm-lintRange-error').length
const retype = (v: EditorView, text: string) =>
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
const kindOf = (m: unknown) => (m as { kind?: string } | null)?.kind
const isFormatting = (m: unknown) =>
  kindOf(m) === 'msg' && JSON.parse((m as { json: string }).json).method === 'textDocument/formatting'

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
  const more = paneHost(leaf).querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
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

/**
 * Type `next` into `leaf`'s copy; when the build carrying it is posted, type `typed` over it and click
 * `format` at once, with the `formatting` request kept back until that build's reply has landed — so the
 * reply meets an editor whose pending edit the format has taken off the debounce. Waits for the format's
 * own answer. Answers what the editor held once the build's reply had landed, whether a newer build was
 * posted before that reply, as `typeWhileBuilding` does, and the text of the last build posted by the end:
 * the edit the format owed its copy.
 */
async function formatWhileBuilding(leaf: string, next: string, typed: string, build: string, reply: string) {
  const editor = editorIn(leaf)
  const formatted = new Promise<void>((resolve) => tap(isFormatting, (w, m) => void answerTo(w, m).then(resolve)))
  const landed = new Promise<{ atReply: string; overtaken: boolean }>((resolve) =>
    tap(
      (m) => kindOf(m) === build && (m as { src: string }).src === next,
      (w, m) => {
        const gen = (m as { gen: number }).gen
        const replied = replyTo(w, reply, gen)
        holds.push({ match: isFormatting, after: replied })
        retype(editor, typed)
        clickFormat(leaf)
        void replied.then(() =>
          resolve({
            atReply: editor.state.doc.toString(),
            overtaken: builds.some((b) => b.kind === build && b.gen > gen),
          }),
        )
      },
    ),
  )
  retype(editor, next)
  const at = await landed
  await formatted
  return { editor, ...at, sent: builds.findLast((b) => b.kind === build)?.src }
}

async function fork(leaf: string): Promise<void> {
  const button = paneHost(leaf).querySelector<HTMLButtonElement>('button.detach') as HTMLButtonElement
  expect(button.disabled).toBe(false)
  button.click()
  await until(() => paneHost(leaf).querySelector('.term-editor') !== null, `a copy's editor in ${leaf}`)
}

beforeAll(async () => {
  Worker.prototype.postMessage = function (this: Worker, message: unknown, options?: unknown) {
    const send = () => (post as (this: Worker, m: unknown, o?: unknown) => void).call(this, message, options)
    const h = holds.findIndex((x) => x.match(message))
    if (h === -1) send()
    else void holds.splice(h, 1)[0]?.after.then(send)
    const gen = (message as { gen?: number } | null)?.gen
    if (gen !== undefined) builds.push({ kind: kindOf(message) ?? '', gen, src: (message as { src?: string }).src })
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
  await fork('asm-0')
})

afterAll(() => {
  Worker.prototype.postMessage = post
})

/** A tap or a hold a failed test left behind would be taken by the next test's request instead of its own. */
afterEach(() => {
  taps.length = 0
  holds.length = 0
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

/**
 * **A FORMAT TAKES THE PENDING EDIT OFF THE DEBOUNCE, AND FOR THAT ROUND TRIP NO TIMER SAYS THE EDITOR IS
 * NEWER THAN ITS COPY.** The build posted before the edit is still out, and its reply re-seeds with the
 * text before the edit: a TM or an asm copy's record, a λ copy's term as that build printed it. It used to
 * be applied, the format's own answer was then refused as overtaken, and the older text went back as the
 * edit the format owed.
 *
 * Found on the slower CI runner, through `lsp-copy-diagnostics.test.ts`'s `reformats a copy without losing
 * an edit made inside the debounce window`, which waits 400 ms after typing its settled text. The debounce
 * posts that text's build at 300 ms, so a reply more than 100 ms away lands after the test's edit and its
 * `format`. That it did so there is an inference: the race placed here ends on the text that run reported.
 *
 * **THE `formatting` REQUEST IS KEPT BACK UNTIL THE BUILD'S REPLY HAS LANDED**, because the two answers
 * come from two workers and nothing else orders them. Answered first, the format posts a newer build and
 * the client drops the older reply.
 */
describe("a copy's build reply, landing while a format is in flight", () => {
  it('keeps the edit the format took off the debounce, in a TM copy', async () => {
    await settle('tm-0', 'tapes 1\nstart s\nstate s: accept\n', 'tm-scratch', 'tm-scratch-compiled')
    const typed = 'tapes 1\nstart s\nstate s:\n  [*] -> write [*], move [S], goto t\nstate t:    accept\n'
    const { editor, atReply, overtaken, sent } = await formatWhileBuilding(
      'tm-0',
      'tapes 1\nstart s\n\nstate s: accept\n',
      typed,
      'tm-scratch',
      'tm-scratch-compiled',
    )
    expect(overtaken, 'the reply has to land while the format holds the edit').toBe(false)
    expect(atReply, 'the reply re-seeded the editor over the edit').toBe(typed)
    // And the format answers for the edit, not for the text before it, and that is what the copy is built from.
    const formatted = 'tapes 1\nstart s\n\nstate s:\n  [*] -> write [*], move [S], goto t\nstate t: accept\n'
    expect(editor.state.doc.toString()).toBe(formatted)
    expect(sent, 'the copy was not built from the formatted edit').toBe(formatted)
  })

  it('keeps the edit the format took off the debounce, in a λ copy', async () => {
    await settle('lambda-0', '\\x. x', 'lambda-scratch', 'scratch-compiled')
    const typed = '\\y.   y   y'
    const { editor, atReply, overtaken, sent } = await formatWhileBuilding(
      'lambda-0',
      '\\z. z',
      typed,
      'lambda-scratch',
      'scratch-compiled',
    )
    expect(overtaken, 'the reply has to land while the format holds the edit').toBe(false)
    // Not `λz. z`, the older build's text as the worker prints it.
    expect(atReply, 'the reply re-seeded the editor over the edit').toBe(typed)
    expect(editor.state.doc.toString()).toBe('λy. y y')
    expect(sent, 'the copy was not built from the formatted edit').toBe('λy. y y')
  })

  it('keeps the edit the format took off the debounce, in an asm copy', async () => {
    await settle('asm-0', 'result Nat\n\n    li\trr, #3\n    halt\n', 'asm-scratch', 'asm-scratch-compiled')
    const typed = 'result Nat\nli rr,#5\nhalt\n'
    const { editor, atReply, overtaken, sent } = await formatWhileBuilding(
      'asm-0',
      'result Nat\n\n    li\trr, #4\n    halt\n',
      typed,
      'asm-scratch',
      'asm-scratch-compiled',
    )
    expect(overtaken, 'the reply has to land while the format holds the edit').toBe(false)
    expect(atReply, 'the reply re-seeded the editor over the edit').toBe(typed)
    const formatted = 'result Nat\n\n    li\trr, #5\n    halt\n'
    expect(editor.state.doc.toString()).toBe(formatted)
    expect(sent, 'the copy was not built from the formatted edit').toBe(formatted)
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
