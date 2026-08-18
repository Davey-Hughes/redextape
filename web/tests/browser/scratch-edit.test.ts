import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * **THE SECOND EDIT GESTURE, DRIVEN THROUGH THE APP** — design §4.3's `editScratch`, plan T8's last
 * obligation. `scratch-fork.test.ts`'s new DOM `describe` proves the FIRST gesture (a truncated frame
 * forks and seeds an editor); this file proves the second one works on what that editor becomes: a
 * real CodeMirror buffer whose keystrokes recompile the SAME scratch (`ScratchBuffers.recompile`,
 * not a second fork), and leave the source session's own result alone.
 *
 * **THIS SENTENCE USED TO END "and disappear the moment a source recompile retires the scratchpad
 * underneath them", AND STAGE 4 ASSERTED IT.** 5d-ii-c decision 2 (design §4.3's table) removes that
 * retire: a source keystroke ends no buffer, so the editor stays mounted over a session that is still
 * running, and STAGE 5 — new with the rewrite — types into it afterwards to prove the buffer's own
 * worker is still answering rather than merely that its box is still on screen.
 *
 * **ONE SEQUENCED `it`, NOT THREE INDEPENDENT ONES, AND THAT IS A DELIBERATE DEPARTURE FROM THE
 * BRIEF'S SKETCH.** `scratch-app.test.ts` already states the house rule this follows: the states here
 * are ordered — there is no bad-edit case to test until a good fork exists, and no retirement to test
 * until an editor exists to retire — and `beforeAll` mounts ONE app for the file (ES module imports
 * are cached, so `main()` runs once per page), so three separate `it`s would make each depend on the
 * previous having actually run, which is exactly the shared-mutable-fixture shape that file's own
 * comment rejects. Every stage below asserts before it acts, same as there.
 *
 * **`EditorView.findFromDOM` PLUS A REAL CHANGE TRANSACTION, NOT `ScratchEditor#setText`.**
 * `scratch-editor.test.ts`'s own file doc records why: `setText` sets a `#seeding` flag for the
 * duration of its dispatch so a fork's seed is never mistaken for a keystroke, which means calling it
 * here would report zero recompiles instead of one. This file's `type` helper is that file's, aimed
 * at the pane's editor host instead of a bare one.
 */
const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

const SAMPLE = 'let x = 40; x + 2'

let view: EditorView

async function until(predicate: () => boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const term = () => document.querySelector('[data-leaf="lambda-0"] .term')?.textContent ?? ''
const editorHost = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor')
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== ''

const clickLambda = (label: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')].find(
    (x) => x.textContent === label,
  )
  if (b === undefined) throw new Error(`no \`${label}\` button in the λ pane`)
  b.click()
}

/** A real keystroke into the scratch's own editor — see the file doc for why not `setText`. */
function typeIntoScratchEditor(text: string): void {
  const host = editorHost()
  if (host === null) throw new Error('no scratch editor mounted under [data-leaf="lambda-0"]')
  const cmView = EditorView.findFromDOM(host)
  if (cmView === null) throw new Error('no CodeMirror view mounted under the editor host')
  cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: text } })
}

describe('editing the scratch, through the app', () => {
  beforeAll(async () => {
    // Each browser test file gets its own in-memory `Storage` now, installed in `tests/browser/setup.ts`
    // before this file's own module body runs — see that file's doc for why clearing a shared key was
    // not enough. Neither key needs clearing here any more.
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(idle, 'the first compile')
  })

  it('edits recompile the scratch, leave the source result untouched, report bad text without losing the last good frames, and survive a source recompile', async () => {
    // STAGE 0 — settled on the sample program, which never truncates at either budget, so the fork
    // control is available at the frontier with no scrubbing needed.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
    await until(idle, 'the sample program to compile')
    const resultsBefore = resultsText()
    expect(resultsBefore).not.toBe('')

    // STAGE 1 — fork. Synchronous up to the rebind; `[detached]` and the editor arrive over the wire.
    clickLambda('✎ fork')
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('[detached]')
    await until(() => editorHost() !== null, 'the editor to mount')
    await until(() => term() !== '', 'the scratchpad to produce its first frame')

    // STAGE 2 — a genuine edit changes the frames region, and the SOURCE's own result is untouched.
    // `onScratchReply` never writes `#results` (its own doc: "never touches `results.dataset.state`
    // except on a throw") — the scratch and the source are two sessions, not one mutable one, which
    // is the whole reason three sessions exist (design §4.3).
    const beforeEdit = term()
    typeIntoScratchEditor('(λa. a a) (λb. b)')
    await until(() => term() !== beforeEdit, 'the edited scratch to recompile')
    expect(term()).toContain('b')
    expect(resultsText()).toBe(resultsBefore)

    // STAGE 3 — an edit that does not parse. Design §4.4: "leaves the frames region showing the last
    // good run and puts the diagnostics in the gutter" — the opposite of what a broken SOURCE program
    // does to its own panes (`onReply`'s `no-session`: "stale frames must not survive a broken
    // program"), and deliberately so: a scratch mid-edit still has the term it had a keystroke ago.
    const lastGood = term()
    typeIntoScratchEditor('(λa.')
    await until(
      () =>
        document.querySelectorAll('[data-leaf="lambda-0"] .cm-lintRange, [data-leaf="lambda-0"] .cm-lint-marker')
          .length > 0,
      'the scratch editor to mark the parse error',
    )
    expect(term()).toBe(lastGood)

    // STAGE 4 — RECOMPILING FROM SOURCE LEAVES BOTH THE BUFFER AND THE BOX ALONE, WHERE THIS STAGE
    // USED TO ASSERT THAT IT "retires the scratchpad and takes the editor with it" (5d-i design §4.3:
    // "the same mechanism as poison recovery"). 5d-ii-c decision 2 ends that: `compile.ts` no longer
    // retires anything, so `editorHost()` — which this stage checked was `null` — must still be there,
    // and the pane must still be `[detached]` on the buffer it was editing.
    //
    // **IT IS ASSERTED FROM THE MIDDLE OF A BAD EDIT ON PURPOSE.** The editor is holding `(λa.` from
    // STAGE 3, which is the state the old behaviour was most defensible in: a keystroke in the source
    // editor threw away a buffer whose text did not parse, and the user got no say. Now the diagnostics
    // stay, the last good frames stay, and STAGE 5 recovers the buffer by fixing the text.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let y = 1; y + 1' } })
    expect(editorHost()).not.toBeNull()
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('[detached]')
    expect(term()).toBe(lastGood)
    // AND THE SOURCE REALLY DID RECOMPILE, so none of the four lines above passed on a keystroke that
    // never reached `schedule`.
    await until(() => idle() && resultsText().includes('2'), 'the recompile from source')
    expect(editorHost()).not.toBeNull()
    expect(term()).toBe(lastGood)

    // STAGE 5 — THE BUFFER'S OWN THREAD IS STILL ANSWERING, which is the half a mounted `.term-editor`
    // cannot show: the box would look identical over a session `pool.unbind` had terminated. A real
    // keystroke into it recompiles the SAME buffer (`ScratchBuffers.recompile`), and the frames region
    // moving to the new term is that worker replying after the source recompile that used to kill it.
    typeIntoScratchEditor('(λm. m) (λn. n)')
    await until(() => term() !== lastGood, 'the buffer to recompile after the source did')
    expect(term()).toContain('n')
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('[detached]')
  })
})
