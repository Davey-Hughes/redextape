import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { FORMAT_ON_BLUR_KEY } from '../../src/editor-prefs'
import { SHELL, until } from './harness'

let view: EditorView

const UNFORMATTED = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(3)\n'

const retype = (src: string): void => {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
}
const text = () => view.state.doc.toString()

/** Click `format` in a view's `⋯` menu, the control a user has. */
function formatVia(leaf: string): void {
  const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
  if (more === null) throw new Error(`no ⋯ menu on [data-leaf="${leaf}"]`)
  more.click()
  const menu = document.getElementById(more.getAttribute('aria-controls') ?? '')
  const item = menu?.querySelector<HTMLButtonElement>('button.format-doc')
  if (item == null) throw new Error('this view offers no `format` item')
  item.click()
}

// ONE MOUNT FOR THE FILE. ES module imports are cached, so `main()` runs once per page and Vitest
// gives each test FILE its own page. A second `beforeAll` that re-assigns `document.body.innerHTML`
// gets fresh controls with none of the listeners `main()` attached to the old ones — which is how
// this file first failed: the `format on blur` checkbox changed nothing because it was a different
// checkbox.
beforeAll(async () => {
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
})

describe('format', () => {
  it('reformats the source document from the view menu', async () => {
    retype(UNFORMATTED)
    formatVia('source')

    // `print ∘ parse`, so the body is laid out over lines rather than kept on one.
    await until(() => text() !== UNFORMATTED, 'the formatted text to replace the buffer')
    expect(text()).toContain('fn fact(n) {\n')
    expect(text()).toContain('fact(3)')
  })

  /**
   * **THE CASE THE SERVER'S `null` MAKES INTERESTING.** `Language::format` answers `None` for text
   * that does not parse, which arrives as JSON `null` rather than as an empty list. A client that
   * mapped over the result would throw here — on the single most likely buffer there is, one being
   * typed into — and this is what makes *format on blur* safe to leave on.
   */
  it('leaves an unparseable buffer alone, and raises nothing', async () => {
    retype('let x = ;')
    formatVia('source')

    // Nothing to wait for, so wait for a round trip that would have landed by now: a format of a
    // VALID document, which proves the server answered in between rather than that time passed.
    await new Promise((r) => setTimeout(r, 50))
    expect(text()).toBe('let x = ;')

    retype('let  x  =  1;')
    formatVia('source')
    await until(() => text() !== 'let  x  =  1;', 'the valid document to format, proving the server was reachable')
  })

  it('is offered on a view that has an editor', () => {
    const more = document.querySelector<HTMLButtonElement>('[data-leaf="source"] button.view-more')
    more?.click()
    const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
    expect(menu?.querySelector('button.format-doc')).not.toBeNull()
    // Its accessible name is its visible label — the umbrella's §4 rule 1, held here as well as by
    // the class-level control test.
    expect(menu?.querySelector('button.format-doc')?.textContent).toContain('format')
  })
})

describe('format on blur', () => {
  it('is off until the setting is turned on, and then formats when focus leaves', async () => {
    const box = document.querySelector<HTMLInputElement>('#format-on-blur')
    if (box === null) throw new Error('no `format on blur` setting in the settings menu')
    expect(box.checked, 'off on a first visit').toBe(false)

    retype(UNFORMATTED)
    view.contentDOM.dispatchEvent(new FocusEvent('blur'))
    await new Promise((r) => setTimeout(r, 50))
    expect(text(), 'blur must do nothing while the setting is off').toBe(UNFORMATTED)

    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(localStorage.getItem(FORMAT_ON_BLUR_KEY)).toBe('true')

    view.contentDOM.dispatchEvent(new FocusEvent('blur'))
    await until(() => text() !== UNFORMATTED, 'the buffer to format when focus leaves')
    expect(text()).toContain('fn fact(n) {\n')
  })
})
