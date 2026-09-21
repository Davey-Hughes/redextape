import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

let view: EditorView

const idle = () =>
  document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
  (document.querySelector('#results')?.textContent ?? '') !== ''

/** Every editable text region on the page, as a screen reader finds them. */
const textboxes = () => [...document.querySelectorAll<HTMLElement>('.cm-content[contenteditable="true"]')]

/**
 * **DEFERRED-ACCESSIBILITY ITEM 16 — "neither editable text region carries an accessible name".**
 * CodeMirror gives its content a `textbox` role and no name, so on a workspace showing three editors
 * at once every one of them announced identically.
 */
describe('editable regions carry accessible names', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(idle, 'the app to settle')
  })

  it('names the source editor', () => {
    const source = document.querySelector<HTMLElement>('[data-leaf="source"] .cm-content')
    expect(source?.getAttribute('aria-label')).toBe('source program editor')
  })

  it('names a copy after the view that holds it, and distinctly from the source', async () => {
    const pane = document.querySelector<HTMLElement>('[data-leaf="tm-0"]')
    pane?.querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => pane?.querySelector('.term-editor') !== null, 'the copy to mount its editor')

    const copy = pane?.querySelector<HTMLElement>('.term-editor .cm-content')
    const name = copy?.getAttribute('aria-label') ?? ''
    expect(name).toContain('TM')
    expect(name).toContain('editor')
    expect(name).not.toBe('source program editor')
  })

  it('leaves no editable region unnamed', () => {
    expect(textboxes().length).toBeGreaterThan(1)
    for (const box of textboxes()) {
      const name = box.getAttribute('aria-label') ?? ''
      expect(name, `an editable region announced as "${name}"`).not.toBe('')
    }
    // And no two announce the same way, which is the whole point on a tiled workspace.
    const names = textboxes().map((b) => b.getAttribute('aria-label'))
    expect(new Set(names).size).toBe(names.length)
  })
})
