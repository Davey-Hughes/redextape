import { StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { FORMAT_ON_BLUR_KEY } from '../../src/editor-prefs'
import { EXAMPLES, type Example } from '../../src/examples'
import { SHELL, until } from './harness'

/**
 * **A PICK'S UNDO OUTLIVES A FORMAT ON BLUR THAT CHANGES NOTHING** — Plan 7 part 6a spec §4.5. The undo is withdrawn
 * at the next edit to the program, since it would throw that edit away. With *format on blur* on, leaving the editor
 * for the undo button asks the language server to format, and the server answers a formatted example with one edit
 * replacing the whole document by the same text: a transaction that changes the document and leaves it equal. That
 * is not an edit anything could lose, so the undo stays. *Format on blur* is stored at module scope, before `main()`
 * reads it, as a returning visitor's choice would be. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

localStorage.setItem(FORMAT_ON_BLUR_KEY, 'true')

const example = (id: string): Example => EXAMPLES.find((e) => e.id === id) as Example
const button = () => document.querySelector<HTMLButtonElement>('#examples') as HTMLButtonElement
const item = (id: string) =>
  document.querySelector<HTMLButtonElement>(`#examples-menu button[data-example="${id}"]`) as HTMLButtonElement
const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

let view: EditorView

/** How many transactions have changed the source document and left it equal — the format pass this file is about. */
let unchangedPasses = 0

beforeAll(async () => {
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(idle, 'the first compile')
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((u) => {
        if (u.docChanged && u.startState.doc.eq(u.state.doc)) unchangedPasses += 1
      }),
    ),
  })
})

describe('a pick, with format on blur', () => {
  /**
   * **THE FOCUS LEAVES THE EDITOR BY KEYS, AND THE FORMAT PASS LANDS BEFORE THE UNDO IS CLICKED.** A pointer click
   * races the pass — its mousedown blurs the editor, and whether the answer lands before its click is timing, which a
   * test's instant click nearly always wins and a hand's slower one can lose. Going by keys leaves the editor well
   * before the undo is pressed, so the pass has landed by then, every time.
   */
  it('can still be undone once the focus has left the editor and its format pass has landed', async () => {
    expect(document.querySelector<HTMLInputElement>('#format-on-blur')?.checked).toBe(true)
    await userEvent.selectOptions(picker(), 'binary')
    await until(idle, 'the compile under binary')

    await userEvent.click(button())
    await userEvent.click(item('sum-to'))
    expect(view.state.doc.toString()).toBe(example('sum-to').text)
    await userEvent.click(view.contentDOM)
    expect(view.hasFocus).toBe(true)
    const before = unchangedPasses

    // BACK ALONG THE TAB ORDER TO THE NOTICE LINE, a key at a time, as a keyboard user reaches the undo.
    for (let i = 0; i < 40 && document.activeElement !== undoButton(); i += 1) {
      await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    }
    await until(() => unchangedPasses > before, 'the format pass on blur')
    expect(document.activeElement, 'the undo was withdrawn before it could be reached').toBe(undoButton())

    await userEvent.click(undoButton() as HTMLButtonElement)
    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
    expect(picker().value).toBe('binary')
  })

  /**
   * **AND BY A CLICK HELD AS A HAND HOLDS ONE.** The mousedown blurs the editor, and a quarter of a second passes
   * before the click: the format pass lands in between, which a test's own instant click does not give it time to.
   */
  it('can still be undone by a click on undo, straight from the editor', async () => {
    // FORMATTED ALREADY, so the pass that leaving the editor for the menu asks for cannot change what the pick replaces.
    const formatted = 'let x = 40;\nx + 2\n'
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } })
    await until(idle, 'the formatted program’s compile')

    await userEvent.click(button())
    await userEvent.click(item('fact'))
    expect(view.state.doc.toString()).toBe(example('fact').text)
    await userEvent.click(view.contentDOM)
    expect(view.hasFocus).toBe(true)

    await userEvent.click(undoButton() as HTMLButtonElement, { delay: 250 })
    expect(view.state.doc.toString()).toBe(formatted)
    expect(picker().value).toBe('binary')
  })
})
