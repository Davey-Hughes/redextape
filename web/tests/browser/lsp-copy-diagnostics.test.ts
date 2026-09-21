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

const editorViewOf = (pane: HTMLElement): EditorView => {
  const host = pane.querySelector<HTMLElement>('.term-editor')
  if (host === null) throw new Error('this pane has no mounted editor')
  const v = EditorView.findFromDOM(host)
  if (v === null) throw new Error('no CodeMirror view under the editor host')
  return v
}

/** Error markers inside ONE pane's editor, so a source-editor marker cannot be mistaken for a copy's. */
const markersIn = (pane: HTMLElement) => pane.querySelectorAll('.cm-editor .cm-lintRange-error').length
const guttersIn = (pane: HTMLElement) => pane.querySelectorAll('.cm-editor .cm-lint-marker-error').length

/** Make a copy of what this pane shows, through the control a user has. */
async function makeCopy(pane: HTMLElement): Promise<EditorView> {
  const button = pane.querySelector<HTMLButtonElement>('button.detach')
  if (button === null) throw new Error('this view offers no `edit a copy` control')
  expect(button.disabled, 'the fork control should be available on this machine').toBe(false)
  button.click()
  await until(() => pane.querySelector('.term-editor') !== null, 'the copy to mount its editor')
  return editorViewOf(pane)
}

/** Replace a copy's text and wait past the edit debounce, which is what posts `didChange`. */
function retype(v: EditorView, text: string): void {
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
}

/** Click `format` in a view's `⋯` menu, the control a user has. */
function formatVia(leaf: string): void {
  const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
  if (more === null) throw new Error(`no ⋯ menu on [data-leaf="${leaf}"]`)
  more.click()
  const item = document
    .getElementById(more.getAttribute('aria-controls') ?? '')
    ?.querySelector<HTMLButtonElement>('button.format-doc')
  if (item == null) throw new Error('this view offers no `format` item')
  item.click()
}

/**
 * **THE TM GUTTER SHOWED NOTHING, WHATEVER WAS WRONG WITH THE MACHINE, AND THIS IS THE CASE THAT
 * COULD NOT PASS BEFORE THIS TASK.** Diagnostics for a copy used to arrive on the session worker's
 * run reply and were handed to `LambdaPane.setDiagnostics`. `tm-pane.ts` had no such method, so
 * `setDiagnostics` had callers in `lambda-pane.ts` and nowhere else — the umbrella's "closes the TM
 * gutter showing none", literally. Every editor is an LSP document now.
 */
describe('diagnostics in a copy', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(idle, 'the app to settle')
  })

  it('marks a broken machine in a TM copy, where nothing was ever marked before', async () => {
    const pane = paneHost('tm-0')
    const editor = await makeCopy(pane)

    // A duplicate `tapes` line: one diagnostic, `duplicate \`tapes\` line`, measured against the
    // real server rather than guessed.
    retype(editor, 'tapes 1\ntapes 2\nstart s\nstate s: accept\n')

    await until(() => markersIn(pane) > 0, 'an error marker in the TM copy')
    expect(guttersIn(pane)).toBeGreaterThan(0)
  })

  it('clears them when the machine parses again', async () => {
    const pane = paneHost('tm-0')
    const editor = editorViewOf(pane)
    retype(editor, 'tapes 1\ntapes 2\nstart s\nstate s: accept\n')
    await until(() => markersIn(pane) > 0, 'a marker before clearing')

    retype(editor, 'tapes 1\nstart s\nstate s: accept\n')
    await until(() => markersIn(pane) === 0 && guttersIn(pane) === 0, 'both surfaces to clear once the machine parses')
  })

  it('marks a broken term in a λ copy too', async () => {
    const pane = paneHost('lambda-0')
    const editor = await makeCopy(pane)

    retype(editor, '(\\x. x')

    await until(() => markersIn(pane) > 0, 'an error marker in the λ copy')
    expect(guttersIn(pane)).toBeGreaterThan(0)
  })
})

describe('format in a copy', () => {
  /**
   * **THE COPY PATH IS A DIFFERENT ONE FROM THE SOURCE VIEW'S**, which `lsp-format.test.ts` covers.
   * A copy's editor is a `ScratchEditor`: it holds the document itself, and its edits reach the
   * server on a debounce rather than per keystroke — so formatting one has to flush that debounce
   * first or the server answers an edit computed from the text before the last keystrokes, which,
   * being a whole-document replacement, would silently undo them.
   */
  /**
   * **THE ASSERTIONS THIS TEST USED TO CARRY COULD NOT SEE THE PROPERTY ITS NAME CLAIMS.** They were
   * `toContain('tapes 1')`, `'start s'` and `'accept'` — every one of them true of the text BEFORE
   * the edit as well, so the test passed whether or not the last keystrokes survived. And the menu
   * path it drives did not flush at all; only the blur path did. Found by a whole-branch review.
   *
   * The edit below is a whole extra `state` block, and the assertion is that it is still there
   * afterwards. It is made inside the 300 ms debounce, which is the window where the server still
   * holds the previous text.
   */
  it('reformats a copy without losing an edit made inside the debounce window', async () => {
    const pane = paneHost('tm-0')
    const editor = editorViewOf(pane)
    // Settled first, so the server holds THIS text when the edit below lands.
    retype(editor, 'tapes 1\nstart s\n\nstate s: accept\n')
    await new Promise((r) => setTimeout(r, 400))

    // A whole new state block, and deliberately not laid out the way the printer lays it out — so
    // the format has something to change AND something it could lose. If the pending edit is not
    // flushed, the server formats the settled text above and `state t` disappears with it.
    retype(editor, 'tapes 1\nstart s\nstate s:\n  [*] -> write [*], move [S], goto t\nstate t:    accept\n')
    formatVia('tm-0')

    await until(() => !editor.state.doc.toString().includes('    accept'), 'the copy to reformat')
    const after = editor.state.doc.toString()
    expect(after, 'the block added inside the debounce window must survive').toContain('state t')
    expect(after).toContain('tapes 1')
  })

  it('leaves an unparseable copy alone', async () => {
    const pane = paneHost('tm-0')
    const editor = editorViewOf(pane)
    retype(editor, 'tapes 1\ntapes 2\nstart s\nstate s: accept\n')
    await until(() => markersIn(pane) > 0, 'the copy to be broken')

    const before = editor.state.doc.toString()
    formatVia('tm-0')
    await new Promise((r) => setTimeout(r, 50))
    expect(editor.state.doc.toString()).toBe(before)
  })
})

describe('format on blur in a copy', () => {
  /**
   * **THE FLUSH IS A CLAIM, AND THIS IS THE MEASUREMENT OF IT.** A copy's edits reach the server on a
   * 300 ms debounce (`EDITOR_DEBOUNCE_MS`). Blurring inside that window, the server would still hold
   * the text from before the last keystrokes — and `textDocumentSync` is Full, so the edit it answers
   * with replaces the WHOLE document and silently reverts them. `ScratchEditor` flushes the pending
   * change before asking, and this test blurs immediately after typing so that the window is open.
   */
  it('keeps keystrokes made inside the debounce window', async () => {
    const box = document.querySelector<HTMLInputElement>('#format-on-blur')
    if (box === null) throw new Error('no `format on blur` setting')
    box.checked = true
    box.dispatchEvent(new Event('change'))

    const pane = paneHost('tm-0')
    const editor = editorViewOf(pane)
    // A machine whose LAST edit is the accept state's name. If the flush did not happen, the server
    // would format the text as it was before this dispatch and `s_final` would vanish.
    retype(editor, 'tapes 1\nstart s_final\nstate s_final:    accept\n')

    // No wait: the debounce is still pending, which is the whole point.
    editor.contentDOM.dispatchEvent(new FocusEvent('blur'))

    await until(
      () => editor.state.doc.toString().includes('s_final') && !editor.state.doc.toString().includes('    accept'),
      'the copy to format with the pending keystrokes included',
    )
    expect(editor.state.doc.toString()).toContain('s_final')

    box.checked = false
    box.dispatchEvent(new Event('change'))
  })
})

describe('navigation in a copy', () => {
  /**
   * **A COPY'S KEYMAP IS A DIFFERENT CODE PATH FROM THE SOURCE VIEW'S.** `ScratchEditor` builds its
   * own `navKeymap` with its own document, and reveals into itself rather than into `main.ts`'s view.
   */
  it('jumps to a state definition with F12 inside a TM copy', async () => {
    const pane = paneHost('tm-0')
    const editor = editorViewOf(pane)
    retype(editor, 'tapes 1\nstart s\n\nstate s:\n  [_] -> write [_], move [R], goto t\n\nstate t: accept\n')
    await new Promise((r) => setTimeout(r, 400))

    // The `goto t` on line 5 (1-based); its definition is the `state t:` block on line 7.
    const gotoLine = editor.state.doc.line(5)
    const at = gotoLine.from + gotoLine.text.indexOf('goto t') + 5
    editor.dispatch({ selection: { anchor: at } })
    editor.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', cancelable: true, bubbles: true }))

    await until(() => editor.state.doc.lineAt(editor.state.selection.main.head).number === 7, 'the jump')
    const sel = editor.state.selection.main
    expect(editor.state.doc.sliceString(sel.from, sel.to)).toBe('t')
  })
})
