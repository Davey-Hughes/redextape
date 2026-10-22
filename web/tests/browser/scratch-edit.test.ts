import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { editorHost, focusProgram, idle, lambdaTermText, resultsText, SHELL, until } from './harness'
import { lambdaSettled } from './lambda-text'
import { typeIntoScratchEditor } from './scratch-editor-fixture'

/**
 * **THE SECOND EDIT GESTURE, DRIVEN THROUGH THE APP** — 5d-iii design §4.3's edit path (`editSink`).
 * `scratch-fork.test.ts`'s DOM `describe` proves the FIRST gesture (a truncated frame forks and seeds an
 * editor); this file proves the second one works on what that editor becomes: a real CodeMirror buffer
 * whose keystrokes recompile the SAME scratch (`ScratchBuffers.recompile`, not a second fork), leave the
 * source session's own result alone, and survive a source recompile. A source keystroke ends no buffer
 * (5d-ii-c §4.3's table), so the editor stays mounted over a session that is still running, and STAGE 5
 * types into it afterwards to prove the buffer's own worker is still answering rather than merely that
 * its box is still on screen.
 *
 * **ONE SEQUENCED `it`, NOT THREE INDEPENDENT ONES.** `scratch-app.test.ts` states the house rule this
 * follows: the states here are ordered — there is no bad-edit case to test until a good fork exists,
 * and no source recompile to survive until an editor exists — and `beforeAll` mounts ONE app for the
 * file (ES module imports are cached, so `main()` runs once per page), so three separate `it`s would
 * make each depend on the previous having actually run, which is exactly the shared-mutable-fixture
 * shape that file's own comment rejects. Every stage below asserts before it acts, same as there.
 *
 * **A REAL CHANGE TRANSACTION, NOT `ScratchEditor#setText`.** `setText` sets a `#seeding` flag for the
 * duration of its dispatch so a fork's seed is never mistaken for a keystroke, which means calling it
 * here would report zero recompiles instead of one. `typeIntoScratchEditor` (`scratch-editor-fixture.ts`)
 * finds the pane's editor with `EditorView.findFromDOM` and dispatches the change to it.
 */

const SAMPLE = 'let x = 40; x + 2'

let view: EditorView

describe('editing the scratch, through the app', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(idle, 'the first compile')
  })

  it('edits recompile the scratch, leave the source result untouched, report bad text without losing the last good frames, and survive a source recompile', async () => {
    // STAGE 0 — settled on the sample program, which never truncates at either budget, so the fork
    // control is available at every step.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
    await until(idle, 'the sample program to compile')
    focusProgram()
    const resultsBefore = resultsText()
    expect(resultsBefore).not.toBe('')

    // STAGE 1 — fork. Synchronous up to the rebind; `copy · not linked` and the editor arrive over the wire.
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('copy · not linked')
    await until(() => editorHost() !== null, 'the editor to mount')
    await until(() => lambdaTermText() !== '', 'the scratchpad to produce its first frame')
    await lambdaSettled()

    // STAGE 2 — a genuine edit changes the frames region, and the SOURCE's own result is untouched.
    // `onScratchReply` never writes `#results` (its own doc: "never touches `results.dataset.state`
    // at all") — the scratch and the source are two sessions, not one mutable one (5d-i design §4.3).
    const beforeEdit = lambdaTermText()
    typeIntoScratchEditor('(λa. a a) (λb. b)')
    await until(() => lambdaTermText() !== beforeEdit, 'the edited scratch to recompile')
    await lambdaSettled()
    expect(lambdaTermText()).toContain('b')
    focusProgram()
    expect(resultsText()).toBe(resultsBefore)

    // STAGE 3 — an edit that does not parse. 5d-iii §4.4: "leaves the frames region showing the last
    // good run and puts the diagnostics in the gutter" — the opposite of what a broken SOURCE program
    // does to its own panes (`onReply`'s `no-session`: "stale frames must not survive a broken
    // program"), and deliberately so: a scratch mid-edit still has the term it had a keystroke ago.
    await lambdaSettled()
    const lastGood = lambdaTermText()
    typeIntoScratchEditor('(λa.')
    await until(
      () =>
        document.querySelectorAll('[data-leaf="lambda-0"] .cm-lintRange, [data-leaf="lambda-0"] .cm-lint-marker')
          .length > 0,
      'the scratch editor to mark the parse error',
    )
    expect(lambdaTermText()).toBe(lastGood)

    // STAGE 4 — RECOMPILING FROM SOURCE LEAVES BOTH THE BUFFER AND THE BOX ALONE (5d-ii-c §4.3's table):
    // `editorHost()` must still be there, and the pane must still be `copy · not linked` on the buffer
    // it was editing.
    //
    // **IT IS ASSERTED FROM THE MIDDLE OF A BAD EDIT ON PURPOSE.** The editor is holding `(λa.` from
    // STAGE 3, a buffer whose text does not parse, and a keystroke in the source editor must not throw it
    // away without the user having a say: the diagnostics stay, the last good frames stay, and STAGE 5
    // recovers the buffer by fixing the text.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let y = 1; y + 1' } })
    expect(editorHost()).not.toBeNull()
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('copy · not linked')
    expect(lambdaTermText()).toBe(lastGood)
    // AND THE SOURCE REALLY DID RECOMPILE, so none of the four lines above passed on a keystroke that
    // never reached `schedule`.
    focusProgram()
    await until(() => idle() && resultsText().includes('2'), 'the recompile from source')
    expect(editorHost()).not.toBeNull()
    expect(lambdaTermText()).toBe(lastGood)

    // STAGE 5 — THE BUFFER'S OWN THREAD IS STILL ANSWERING, which is the half a mounted `.term-editor`
    // cannot show: the box would look identical over a session `pool.unbind` had terminated. A real
    // keystroke into it recompiles the SAME buffer (`ScratchBuffers.recompile`), and the frames region
    // moving to the new term is that worker replying after the source recompile.
    typeIntoScratchEditor('(λm. m) (λn. n)')
    await until(() => lambdaTermText() !== lastGood, 'the buffer to recompile after the source did')
    await lambdaSettled()
    expect(lambdaTermText()).toContain('n')
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('copy · not linked')
  })
})
