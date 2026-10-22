import { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { answered, recordBuildReplies } from './build-reply-fixture'
import { stored } from './copy-text-fixture'
import { lambdaPane, SHELL, stateIdle, until } from './harness'

/**
 * **A λ COPY KEEPS THE TEXT TYPED INTO IT.** A build of a copy is answered with the copy's text, and the app puts
 * that answer in the copy's editor and in its text of record. Were the answer the worker's print of the term, for an
 * edit as for a copy made from a later step, whatever the printer spells differently would be replaced under the
 * caret each time a build was answered: a space typed at the end would go, and the letter typed after a pause would
 * join the one before it; a caret inside the text would go to the start; `\`, a line break and parentheses the
 * printer does not write would become the printer's. And a copy's text of record would never hold the space.
 *
 * **EACH CASE WAITS FOR THE ANSWER TO THE BUILD THAT CARRIES ITS TEXT**, since the answer is what would replace the
 * text. `answered` (`build-reply-fixture.ts`) hears every answer on the copy's worker after the app's own listener,
 * attached when the app built the worker, so the app has handled an answer by the time it is listed. **BY ITS TEXT
 * AND NOT AS THE NEXT BUILD**: several keys typed against the shipped 300 ms debounce can be split by a slow machine
 * into a build of a part of them, and that build is not the one a case is about. Nothing is slept.
 *
 * **THE KEYS UNDER TEST ARE REAL ONES** (`userEvent`), typed where the caret is; a case's starting text is
 * dispatched, which the editor reports as typing all the same.
 *
 * ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives: `main()` runs once per page.
 */

/** Puts `Worker`'s own `postMessage` back once this file is done: `recordBuildReplies` wraps it for the whole file. */
let unrecord = (): void => undefined
let copy = ''

const editor = () => EditorView.findFromDOM(lambdaPane().querySelector('.term-editor') as HTMLElement) as EditorView
const text = () => editor().state.doc.toString()
const caret = () => editor().state.selection.main.head

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
  unrecord = recordBuildReplies()
  document.body.innerHTML = SHELL
  const source = await (await import('../../src/main')).ready
  source.dispatch({ changes: { from: 0, to: source.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(stateIdle, 'the app to settle')
  const detach = lambdaPane().querySelector<HTMLButtonElement>('button.detach') as HTMLButtonElement
  expect(detach.disabled).toBe(false)
  detach.click()
  await until(() => lambdaPane().querySelector('.term-editor') !== null, 'the copy’s editor')
  const binding = lambdaPane().querySelector<HTMLButtonElement>('button.view-title')?.dataset.binding ?? ''
  copy = binding.slice(binding.indexOf(':') + 1)
  await until(() => stored(copy) !== null, 'the copy to be stored')
})

afterAll(() => unrecord())

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
    expect(stored(copy)).toBe('λq. q')
    await typeAt(5, 5, ' ')
    expect(await built('λq. q ')).toBe('scratch-compiled')
    expect(stored(copy)).toBe('λq. q ')
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
