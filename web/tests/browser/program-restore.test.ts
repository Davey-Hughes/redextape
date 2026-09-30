import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { PROGRAM_STORAGE_KEY, parseProgram, serializeProgram } from '../../src/program-store'
import { SHELL, until } from './harness'

/**
 * **A STORED PROGRAM COMES BACK UNDER ITS OWN ENCODING, AND EACH COMPILE STORES WHAT IT POSTS** — Plan 7 part 6a spec
 * §4.3 and §4.4. The program is stored at module scope, before `main()` runs, as a previous page load would have
 * stored it, over the one `setup.ts` stores for every file. It has a function so that the outline can say which text
 * the language server was given. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

const STORED = { text: 'fn times4(y) {\n    y * 4\n}\ntimes4(5)\n', encoding: 'binary' }
localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram(STORED))

const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const stored = () => parseProgram(localStorage.getItem(PROGRAM_STORAGE_KEY), ['unary', 'binary'])
const outlineRows = () =>
  [...document.querySelectorAll<HTMLElement>('[data-leaf="source"] .outline-row')].map((r) => r.textContent)

let view: EditorView

describe('a stored program', () => {
  it('opens in the editor, under the encoding it was stored with', async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    expect(view.state.doc.toString()).toBe(STORED.text)
    expect(picker().value).toBe('binary')
    await until(() => idle() && segments().length > 0, 'the first compile')
    expect(segments()[0]).toMatch(/^λ 20 · /)
  })

  it('is the text the language server was given: the outline lists its function', async () => {
    document
      .querySelector<HTMLButtonElement>('[data-leaf="source"] [data-panel="outline"] button[aria-expanded]')
      ?.click()
    await until(() => outlineRows().length > 0, 'the outline to fill')
    expect(outlineRows()).toEqual(['times4'])
  })

  it('is stored again under the encoding a change picks', async () => {
    await userEvent.selectOptions(picker(), 'unary')
    await until(() => stored()?.encoding === 'unary', 'the new encoding, stored')
    expect(stored()).toEqual({ text: STORED.text, encoding: 'unary' })
  })

  it('is stored with the text an edit leaves', async () => {
    const edited = 'fn times4(y) {\n    y * 4\n}\ntimes4(6)\n'
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: edited } })
    await until(() => stored()?.text === edited, 'the edit, stored')
    expect(stored()).toEqual({ text: edited, encoding: 'unary' })
  })

  /**
   * **ONE WRITE PER TYPING PAUSE** (spec §4.3): the program is stored where its compile posts, once the keys have been
   * still for the debounce, so a burst of keystrokes is one write however many keys it holds. Each key is its own
   * dispatch, as a keystroke is, and all of them land inside one debounce. Counted at the storage shim's `setItem`,
   * which the page reaches by name at every write.
   */
  it('is stored once per typing pause, however many keystrokes it holds', async () => {
    const writes: string[] = []
    const setItem = localStorage.setItem
    localStorage.setItem = (key: string, value: string): void => {
      if (key === PROGRAM_STORAGE_KEY) writes.push(value)
      setItem.call(localStorage, key, value)
    }
    try {
      for (const key of '// seven') view.dispatch({ changes: { from: view.state.doc.length, insert: key } })
      const typed = view.state.doc.toString()
      await until(() => idle() && stored()?.text === typed, 'the burst, stored')
      expect(writes.map((w) => parseProgram(w, ['unary'])?.text)).toEqual([typed])
    } finally {
      localStorage.setItem = setItem
    }
  })
})
