import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

let view: EditorView

/** Replace the whole buffer, exactly as a user retyping it would. */
function retype(src: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
}

const errorMarkers = () => document.querySelectorAll('.cm-editor .cm-lintRange-error').length
const gutterMarkers = () => document.querySelectorAll('.cm-editor .cm-lint-marker-error').length

/**
 * **DIAGNOSTICS NOW COME FROM A WORKER, AND THIS FILE IS THE GUARD ON THAT SWAP RATHER THAN A PROOF
 * OF NEW BEHAVIOUR.** Before part 3a the source editor pulled them synchronously from `analyze`
 * through `lintFromAnalyze`; it now receives them pushed from the LSP worker. **The content is
 * identical and that is provable rather than hoped** — `Language::Redextape`'s diagnostics *are*
 * `redextape_core::analyze(src).diagnostics`, asserted by a test in `language.rs` — so no assertion
 * here can distinguish the two sources, and none tries to.
 *
 * What it does catch is the swap going wrong: markers that never arrive because nothing opened the
 * document, arrive at the wrong offsets because the UTF-16 conversion is wrong, or never clear
 * because `didChange` is not posted. Every one of those is a way this task could ship broken while
 * the node tier stays green.
 *
 * The TM case — the one that could not pass before part 3a, because a TM copy's gutter had no
 * source of diagnostics at all — lives in `lsp-copy-diagnostics.test.ts`. This sentence used to
 * name a file that was never created and a `setDiagnostics` method that no longer exists.
 */
describe('source diagnostics, served by the LSP worker', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  it('marks a broken program, in the text and in the gutter', async () => {
    retype('let x = ;')

    // ASYNCHRONOUS, UNLIKE THE PATH THIS REPLACED. `lintFromAnalyze` ran in the same frame as the
    // keystroke; this is a worker round trip, so the marker cannot be asserted synchronously.
    await until(() => errorMarkers() > 0, 'an error marker for `let x = ;`')
    expect(gutterMarkers()).toBeGreaterThan(0)
  })

  /**
   * **`let x = ;` IS NOT A ZERO-WIDTH DIAGNOSTIC, AND THIS TEST USED IT UNDER THAT NAME.** Driven
   * against the real server it reports `0:8-0:9` — an ordinary one-character range — so the test
   * exercised the ordinary path while its name claimed the widening. `let x = ` reports `0:8-0:8`,
   * twice. Ten of fifteen broken programs measured produce at least one zero-width range.
   *
   * The conversion itself is pinned in `tests/node/lsp-diagnostics-ranges.test.ts`, where the
   * widening can be driven directly; this asserts it reaches the screen.
   */
  it('renders a zero-width diagnostic, which CodeMirror would otherwise draw as nothing', async () => {
    retype('let x = ')
    await until(() => errorMarkers() > 0, 'a marker for a genuinely zero-width range')

    // CodeMirror renders NOTHING for `from === to`, so a zero-width diagnostic that was not widened
    // would leave the gutter marked and the text unmarked.
    const marked = document.querySelector('.cm-editor .cm-lintRange-error')
    expect(marked?.textContent?.length ?? 0).toBeGreaterThan(0)
    expect(gutterMarkers()).toBeGreaterThan(0)
  })

  it('clears the markers when the program becomes valid again', async () => {
    retype('let x = ;')
    await until(() => errorMarkers() > 0, 'a marker before clearing')

    retype('let x = 40; x + 2')
    // Nothing clears these except a fresh `publishDiagnostics`, so this is the assertion that
    // `didChange` is posted on every keystroke rather than only on the first.
    //
    // **BOTH SURFACES ARE WAITED ON, NOT ONE THEN THE OTHER.** The range decorations and
    // `lintGutter`'s markers are separate view plugins updating in separate cycles, so the text can
    // be clear while the gutter is one frame behind — asserting the gutter the instant the text
    // cleared failed on exactly that, with 1 marker left.
    await until(
      () => errorMarkers() === 0 && gutterMarkers() === 0,
      'both the text and the gutter markers to clear once the program parses',
    )
  })

  it('puts the marker on the right line of a multi-line program', async () => {
    retype('let a = 1;\nlet b = 2;\nlet c = ;')
    await until(() => errorMarkers() > 0, 'a marker on the third line')

    // The offsets arrive as UTF-16 line/character and are converted against the document. A
    // conversion that ignored `line` would mark line 1.
    const line = view.state.doc.lineAt(view.posAtDOM(document.querySelector('.cm-editor .cm-lintRange-error') as Node))
    expect(line.number).toBe(3)
  })
})
