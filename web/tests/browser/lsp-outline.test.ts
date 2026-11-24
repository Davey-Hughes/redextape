import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { idle, paneOrThrow, SHELL, until } from './harness'

let view: EditorView

const outlineOf = (leaf: string) => paneOrThrow(leaf).querySelector<HTMLElement>('[data-panel="outline"]')
const rowsIn = (leaf: string) => [...paneOrThrow(leaf).querySelectorAll<HTMLElement>('.outline-row')]

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

    // NOT `let x = 1; x + 1` — a `let` BINDING is a symbol too (kind 13). A bare expression binds
    // nothing and defines nothing.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '42\n' } })
    await until(
      () => paneOrThrow('source').querySelector('.outline-empty') !== null,
      'the outline to say there is nothing to show',
    )
    expect(paneOrThrow('source').querySelector('.outline-empty')?.textContent).toBe('nothing to show')
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

  /** **NOR DOES A TM OR RXM VIEW HAVE ONE**: neither holds an editor, so there is no document of its own to list. */
  it('is absent from a TM or rxm view', () => {
    expect(outlineOf('tm-0'), 'the TM view').toBeNull()
    expect(outlineOf('rxm-0'), 'the rxm view').toBeNull()
  })
})
