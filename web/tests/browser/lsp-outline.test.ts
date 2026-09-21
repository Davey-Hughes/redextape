import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

let view: EditorView

const idle = () =>
  document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
  (document.querySelector('#results')?.textContent ?? '') !== ''

const paneHost = (leaf: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-leaf="${leaf}"]`)
  if (el === null) throw new Error(`no pane mounted at [data-leaf="${leaf}"]`)
  return el
}

const outlineOf = (leaf: string) => paneHost(leaf).querySelector<HTMLElement>('[data-panel="outline"]')
const rowsIn = (leaf: string) => [...paneHost(leaf).querySelectorAll<HTMLElement>('.outline-row')]

/** Open a panel through its disclosure button, the control a user has. */
function openPanel(leaf: string): void {
  const panel = outlineOf(leaf)
  if (panel === null) throw new Error(`no outline panel in [data-leaf="${leaf}"]`)
  const toggle = panel.querySelector<HTMLButtonElement>('button[aria-expanded]')
  if (toggle === null) throw new Error('the outline panel has no disclosure button')
  if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
}

const TWO_FNS = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfn g(a, b) { a + b }\nfact(3)\n'

describe('the outline', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: TWO_FNS } })
    await until(idle, 'the app to settle')
  })

  it('is closed on a first visit, so it costs nothing to a reader who never opens it', () => {
    const toggle = outlineOf('source')?.querySelector<HTMLButtonElement>('button[aria-expanded]')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(rowsIn('source')).toHaveLength(0)
  })

  it("lists the source document's functions once opened", async () => {
    openPanel('source')
    await until(() => rowsIn('source').length > 0, 'the outline to fill')
    expect(rowsIn('source').map((r) => r.textContent)).toEqual(['fact', 'g'])
  })

  it('jumps the caret to a name when its row is clicked', async () => {
    openPanel('source')
    await until(() => rowsIn('source').length > 1, 'both rows')

    const g = rowsIn('source').find((r) => r.textContent === 'g')
    g?.click()

    // `selectionRange` is the NAME, not the whole definition — a jump should land on `g`, not select
    // its body.
    const sel = view.state.selection.main
    expect(view.state.doc.sliceString(sel.from, sel.to)).toBe('g')
    expect(view.state.doc.lineAt(sel.from).number).toBe(2)
  })

  it('follows the document as it is edited', async () => {
    openPanel('source')
    await until(() => rowsIn('source').length > 0, 'the outline to fill')

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'fn only(x) { x }\nonly(1)\n' } })
    await until(
      () =>
        rowsIn('source')
          .map((r) => r.textContent)
          .join() === 'only',
      'the outline to follow the edit',
    )
  })

  /**
   * **A PANEL THAT IS OPEN AND BLANK READS AS BROKEN**, and this is reachable on any document with
   * no definitions in it — not only an empty one.
   */
  it('says so rather than showing an empty box when there are no symbols', async () => {
    openPanel('source')
    await until(() => rowsIn('source').length > 0, 'the outline to fill first')

    // NOT `let x = 1; x + 1` — a `let` BINDING is a symbol too (kind 13), which is how this test
    // first failed and how the doc on `renderOutline` was found to be wrong. A bare expression
    // binds nothing and defines nothing.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '42\n' } })
    await until(
      () => paneHost('source').querySelector('.outline-empty') !== null,
      'the outline to say there is nothing to show',
    )
    expect(paneHost('source').querySelector('.outline-empty')?.textContent).toBe('nothing to show')
    expect(rowsIn('source')).toHaveLength(0)
  })

  /**
   * **λ ANSWERS NO SYMBOLS BY DESIGN**, because the term type carries no source positions — the
   * umbrella says so and the server confirms it. A panel that can never fill is REMOVED rather than
   * shown empty, which is the umbrella's §4 rule 4.
   */
  it('is absent from a λ view rather than present and empty', () => {
    expect(outlineOf('lambda-0')).toBeNull()
  })

  /**
   * A TM view's symbols are its `state` blocks — measured against the real server, kind 5. The panel
   * is withdrawn while the view shows the program, because there is no document to outline.
   */
  it('is withdrawn from a TM view until it holds a copy', async () => {
    const panel = outlineOf('tm-0')
    expect(panel, 'a TM view has an outline panel in its DOM').not.toBeNull()
    expect(panel?.hidden, 'and it is withdrawn while the view shows the program').toBe(true)

    const pane = paneHost('tm-0')
    pane.querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => pane.querySelector('.term-editor') !== null, 'the copy to mount its editor')
    await until(() => outlineOf('tm-0')?.hidden === false, 'the outline to appear with the editor')

    openPanel('tm-0')
    await until(() => rowsIn('tm-0').length > 0, "the TM copy's states to be listed")
    // Every row is a state of the machine this copy holds.
    const editorHost = pane.querySelector<HTMLElement>('.term-editor')
    const text = EditorView.findFromDOM(editorHost as HTMLElement)?.state.doc.toString() ?? ''
    for (const row of rowsIn('tm-0')) expect(text).toContain(`state ${row.textContent}`)
  })

  /**
   * The jump works in a copy as well as in the source view — a different code path, because a copy's
   * editor is a `ScratchEditor` that reveals into itself rather than into `main.ts`'s view.
   */
  it("moves a copy's caret when one of its rows is clicked", async () => {
    const pane = paneHost('tm-0')
    const editorHost = pane.querySelector<HTMLElement>('.term-editor')
    const editor = EditorView.findFromDOM(editorHost as HTMLElement)
    if (editor == null) throw new Error('the TM copy has no editor')

    openPanel('tm-0')
    await until(() => rowsIn('tm-0').length > 0, 'the rows')

    const last = rowsIn('tm-0').at(-1)
    const name = last?.textContent ?? ''
    last?.click()

    const sel = editor.state.selection.main
    expect(editor.state.doc.sliceString(sel.from, sel.to)).toBe(name)
  })
})
