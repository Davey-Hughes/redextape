import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page } from 'vitest/browser'
import { LspClient } from '../../src/lsp-client'
import { host, idle, pressToggle, retype, SHELL, toggle, until } from './harness'

let view: EditorView

/** Every `openDocument` call the app makes, from before `main` builds its client. */
let opened: MockInstance<LspClient['openDocument']>

beforeAll(async () => {
  // SET BEFORE `main` IS IMPORTED: the source editor opens its document as the app mounts.
  opened = vi.spyOn(LspClient.prototype, 'openDocument')
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
})

const errorMarkers = () => document.querySelectorAll('.cm-editor .cm-lintRange-error').length
const gutterMarkers = () => document.querySelectorAll('.cm-editor .cm-lint-marker-error').length

/**
 * **THE SOURCE EDITOR'S DIAGNOSTICS ARE PUSHED FROM THE LSP WORKER, AND THIS FILE GUARDS THAT PATH, NOT
 * THEIR CONTENT.** `Language::Redextape`'s diagnostics *are* `redextape_core::analyze(src).diagnostics`,
 * asserted by a test in `language.rs`, so no assertion here checks what they say.
 *
 * What it does catch is the path going wrong: markers that never arrive because nothing opened the
 * document, arrive at the wrong offsets because the UTF-16 conversion is wrong, or never clear
 * because `didChange` is not posted. Every one of those is a way the app could ship broken while
 * the node tier stays green.
 */
describe('source diagnostics, served by the LSP worker', () => {
  it('marks a broken program, in the text and in the gutter', async () => {
    retype(view, 'let x = ;')

    // ASYNCHRONOUS: this is a worker round trip, so the marker cannot be asserted synchronously.
    await until(() => errorMarkers() > 0, 'an error marker for `let x = ;`')
    expect(gutterMarkers()).toBeGreaterThan(0)
  })

  /**
   * **`let x = ` IS A ZERO-WIDTH DIAGNOSTIC, AND `let x = ;` IS NOT.** Against the real server `let x = ;`
   * reports `0:8-0:9`, an ordinary one-character range, and `let x = ` reports `0:8-0:8`, twice.
   *
   * The conversion itself is pinned in `tests/node/lsp-diagnostics-ranges.test.ts`, where the
   * widening can be driven directly; this asserts it reaches the screen.
   */
  it('renders a zero-width diagnostic, which CodeMirror would otherwise draw as nothing', async () => {
    retype(view, 'let x = ')
    await until(() => errorMarkers() > 0, 'a marker for a genuinely zero-width range')

    // CodeMirror renders NOTHING for `from === to`, so a zero-width diagnostic that was not widened
    // would leave the gutter marked and the text unmarked.
    const marked = document.querySelector('.cm-editor .cm-lintRange-error')
    expect(marked?.textContent?.length ?? 0).toBeGreaterThan(0)
    expect(gutterMarkers()).toBeGreaterThan(0)
  })

  it('clears the markers when the program becomes valid again', async () => {
    retype(view, 'let x = ;')
    await until(() => errorMarkers() > 0, 'a marker before clearing')

    retype(view, 'let x = 40; x + 2')
    // Nothing clears these except a fresh `publishDiagnostics`, so this is the assertion that
    // `didChange` is posted on every keystroke rather than only on the first.
    //
    // **BOTH SURFACES ARE WAITED ON, NOT ONE THEN THE OTHER.** The range decorations and
    // `lintGutter`'s markers are separate view plugins updating in separate cycles, so the text can
    // be clear while the gutter is one frame behind.
    await until(
      () => errorMarkers() === 0 && gutterMarkers() === 0,
      'both the text and the gutter markers to clear once the program parses',
    )
  })

  it('puts the marker on the right line of a multi-line program', async () => {
    retype(view, 'let a = 1;\nlet b = 2;\nlet c = ;')
    await until(() => errorMarkers() > 0, 'a marker on the third line')

    // The offsets arrive as UTF-16 line/character and are converted against the document. A
    // conversion that ignored `line` would mark line 1.
    const line = view.state.doc.lineAt(view.posAtDOM(document.querySelector('.cm-editor .cm-lintRange-error') as Node))
    expect(line.number).toBe(3)
  })
})

/**
 * **EVERY DOCUMENT THE APP OPENS IS IN `redextape`**, the one language whose grammar the page loads. The other views
 * show what the program records and hold no editor, so showing each of them opens nothing in another language.
 */
describe('the LSP documents the app opens', () => {
  it('are in redextape alone, with the λ, TM, rxm and clif views each shown on the compiled program', async () => {
    const [width, height] = [window.innerWidth, window.innerHeight]
    // WIDE ENOUGH FOR EVERY TOGGLE TO BE IN THE HEADER: a narrow window puts them in the workspace menu.
    await page.viewport(1280, 900)
    try {
      await until(idle, 'the first compile to finish recording')
      for (const kind of ['lambda', 'tm', 'rxm', 'clif']) {
        if (toggle(kind).getAttribute('aria-pressed') !== 'true') await pressToggle(kind)
        await until(() => host(`${kind}-0`) !== null, `the ${kind} view to be shown`)
      }
    } finally {
      await page.viewport(width, height)
    }
    expect(opened.mock.calls.length, 'the source editor opened its document').toBeGreaterThan(0)
    for (const [uri, languageId] of opened.mock.calls) expect(languageId, uri).toBe('redextape')
  })
})
