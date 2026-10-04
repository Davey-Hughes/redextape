import { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { BUFFERS_STORAGE_KEY, parseBuffers } from '../../src/buffers-store'
import { SHELL, until } from './harness'

/**
 * **A λ COPY KEEPS THE TEXT TYPED INTO IT.** A build of a copy is answered with the copy's text, and the app puts
 * that answer in the copy's editor and in its text of record. The answer used to be the worker's print of the term,
 * for an edit as for a copy made from a later step, so whatever the printer spells differently was replaced under
 * the caret each time a build was answered: a space typed at the end was gone, and the letter typed after a pause
 * joined the one before it; a caret inside the text went to the start; `\`, a line break and parentheses the
 * printer does not write became the printer's. And a copy's text of record never held the space.
 *
 * **EACH CASE WAITS FOR THE ANSWER TO THE BUILD THAT CARRIES ITS TEXT**, since the answer is what replaced the
 * text. `answered` hears every answer on the copy's worker after the app's own listener, attached when the app
 * built the worker, so the app has handled an answer by the time it is listed. **BY ITS TEXT AND NOT AS THE NEXT
 * BUILD**: several keys typed against the shipped 300 ms debounce can be split by a slow machine into a build of
 * a part of them, and that build is not the one a case is about. Nothing is slept.
 *
 * **THE KEYS UNDER TEST ARE REAL ONES** (`userEvent`), typed where the caret is; a case's starting text is
 * dispatched, which the editor reports as typing all the same.
 *
 * ONE MOUNT FOR THE FILE, for the reason every sibling gives: `main()` runs once per page.
 */

const post = Worker.prototype.postMessage
/** Each λ build the app posted and has handled the answer to: its text, and the kind of its answer. */
const answered: { src: string; reply: string }[] = []

let copy = ''

const pane = () => document.querySelector<HTMLElement>('.pane[data-leaf="lambda-0"]') as HTMLElement
const editor = () => EditorView.findFromDOM(pane().querySelector('.term-editor') as HTMLElement) as EditorView
const text = () => editor().state.doc.toString()
const caret = () => editor().state.selection.main.head
/** The copy's text of record, as stored — what a reload rebuilds it from. */
const stored = (): string | null =>
  parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))?.buffers.find((b) => b.id === copy)?.text ?? null

/** Wait until the app has handled the answer to the build carrying exactly `src`, and return that answer's kind. */
async function built(src: string): Promise<string> {
  await until(() => answered.some((b) => b.src === src), `the build carrying ${JSON.stringify(src)} to be answered`)
  return answered.findLast((b) => b.src === src)?.reply ?? ''
}

/** Give the copy `start` and wait for that build's answer, so a case begins with nothing in flight. */
async function holding(start: string): Promise<void> {
  expect(text(), 'a start the copy does not hold already, or no build is posted').not.toBe(start)
  answered.length = 0
  editor().dispatch({ changes: { from: 0, to: text().length, insert: start } })
  expect(await built(start)).toBe('scratch-compiled')
  expect(text()).toBe(start)
}

/** Put the selection from `anchor` to `head` in the copy's editor and type `keys` there with the keyboard. */
async function typeAt(anchor: number, head: number, keys: string): Promise<void> {
  const e = editor()
  e.dispatch({ selection: { anchor, head } })
  e.focus()
  await until(() => e.hasFocus, 'the copy’s editor to take the focus')
  answered.length = 0
  await userEvent.keyboard(keys)
}

beforeAll(async () => {
  Worker.prototype.postMessage = function (this: Worker, message: unknown, options?: unknown) {
    ;(post as (this: Worker, m: unknown, o?: unknown) => void).call(this, message, options)
    const m = message as { kind?: string; gen?: number; src?: string } | null
    if (m?.kind !== 'lambda-scratch') return
    const heard = (e: MessageEvent) => {
      if (e.data?.gen !== m.gen || (e.data.kind !== 'scratch-compiled' && e.data.kind !== 'no-session')) return
      this.removeEventListener('message', heard)
      answered.push({ src: m.src ?? '', reply: e.data.kind })
    }
    this.addEventListener('message', heard)
  }
  document.body.innerHTML = SHELL
  const source = await (await import('../../src/main')).ready
  source.dispatch({ changes: { from: 0, to: source.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the app to settle')
  const detach = pane().querySelector<HTMLButtonElement>('button.detach') as HTMLButtonElement
  expect(detach.disabled).toBe(false)
  detach.click()
  await until(() => pane().querySelector('.term-editor') !== null, 'the copy’s editor')
  const binding = pane().querySelector<HTMLButtonElement>('button.view-title')?.dataset.binding ?? ''
  copy = binding.slice(binding.indexOf(':') + 1)
  await until(() => stored() !== null, 'the copy to be stored')
})

afterAll(() => {
  Worker.prototype.postMessage = post
})

describe('a λ copy keeps the text typed into it', () => {
  it('keeps a space typed at its end, so a letter typed after the build is answered follows it', async () => {
    await holding('λp. p')
    await typeAt(5, 5, ' ')
    expect(await built('λp. p ')).toBe('scratch-compiled')
    // NO CARET MOVE BEFORE THIS KEY: it lands wherever the answered build left the caret.
    await userEvent.keyboard('p')
    expect(text()).toBe('λp. p p')
  })

  it('stores a space typed at its end in the copy’s text of record', async () => {
    await holding('λq. q')
    expect(stored()).toBe('λq. q')
    await typeAt(5, 5, ' ')
    expect(await built('λq. q ')).toBe('scratch-compiled')
    expect(stored()).toBe('λq. q ')
  })

  it('leaves the caret where a key inside the text put it', async () => {
    await holding('λr. r r')
    await typeAt(3, 3, ' ')
    expect(await built('λr.  r r')).toBe('scratch-compiled')
    expect(caret()).toBe(4)
  })

  it('keeps a term as it was spelled: a backslash, a line break, parentheses the printer does not write', async () => {
    await holding('λs. s')
    await typeAt(0, 5, '(\\t.{Enter}(t))')
    expect(await built('(\\t.\n(t))')).toBe('scratch-compiled')
    expect(text()).toBe('(\\t.\n(t))')
  })
})
