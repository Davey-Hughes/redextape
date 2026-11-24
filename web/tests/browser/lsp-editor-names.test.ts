import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { idle, SHELL, until } from './harness'

let view: EditorView

/** Every editable text region on the page, as a screen reader finds them. */
const textboxes = () => [...document.querySelectorAll<HTMLElement>('.cm-content[contenteditable="true"]')]

/**
 * **DEFERRED-ACCESSIBILITY ITEM 16 — "neither editable text region carries an accessible name".**
 * CodeMirror gives its content a `textbox` role and no name, so a screen reader would announce the source editor as
 * an unnamed text box, with nothing to say what it holds.
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

  it('leaves no editable region unnamed', () => {
    expect(textboxes().length).toBe(1)
    for (const box of textboxes()) {
      const name = box.getAttribute('aria-label') ?? ''
      expect(name, `an editable region announced as "${name}"`).not.toBe('')
    }
  })
})
