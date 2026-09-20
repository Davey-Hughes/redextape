import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * THE STRIP (Plan 7 part 2 spec §9) — the readout and the link sentence on one line, the readout showing the
 * FOCUSED view's session: the program, or a copy.
 */

const PROGRAM = 'let x = 40; x + 2'
let view: EditorView

const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
const resultsText = () => document.querySelector('#results')?.textContent ?? ''
const state = () => document.querySelector<HTMLElement>('#results')?.dataset.state
const linkStatus = () => document.querySelector('#link-status')?.textContent ?? ''
const live = () => document.querySelector('#live')?.textContent ?? ''

beforeAll(async () => {
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: PROGRAM } })
  await until(() => state() === 'idle' && resultsText().startsWith('λ 42'), 'the first compile')
})

// **`show` TAKES A THUNK PAIR SINCE PART 2b** (`readout.ts`'s `Lines`): the strip and the inspector draw
// different shapes from the same frame, and handing over both eagerly would pay for the unused one on
// every playback frame. These cases are about the strip, so `rows` is never called.
const strip = (segments: readonly string[]) => ({ segments: () => segments, rows: () => [] })

describe('the strip', () => {
  it("reads the program's value and counts in one line, without the normal form", () => {
    const [lambda, tm, ...rest] = segments()
    expect(lambda).toBe('λ 42 · 7 reductions')
    expect(tm).toMatch(/^TM 42 · 2,870 transitions · width \d+$/)
    expect(rest).toEqual([])
    expect(document.querySelector('.strip #results + #link-status')).not.toBeNull()
  })

  it('announces the link sentence after a link gesture, and shows no notice for it', () => {
    view.dispatch({ selection: { anchor: PROGRAM.indexOf('x + 2') } })
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, cancelable: true }))
    expect(linkStatus()).not.toBe('')
    expect(live().trimEnd()).toBe(linkStatus())
    expect(document.querySelector<HTMLElement>('#notice')?.hidden).toBe(true)
  })

  /**
   * **THE SAME GESTURE, AFTER AN EDIT, IS STILL A CHANGE** — spec §11, and the accessibility item this
   * announcement closes. A keystroke rewrites the line twice without announcing either state ("linking
   * resumes when this compiles", then empty when the compile lands), so a second click on the same
   * construct is the line changing from nothing to a sentence. A memo of the last sentence ANNOUNCED
   * cannot see that, and one was there: `link-wiring.ts` compares the line before and after instead.
   */
  it('announces it again after an edit, though the sentence is the same one', async () => {
    const said = live().trimEnd()
    expect(said).not.toBe('')

    view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
    await until(() => state() === 'idle', 'the recompile')

    // THE RAW TEXT, NOT THE TRIMMED ONE: the live region already held this sentence from the gesture in
    // the test above, so "it says the same words" is true whether or not anything was announced. What
    // says it was announced AGAIN is that the region's text changed at all — `notice.ts`'s `say` toggles
    // a trailing space precisely so a repeated sentence is a change a screen reader reads out.
    const raw = live()
    view.dispatch({ selection: { anchor: PROGRAM.indexOf('x + 2') } })
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, cancelable: true }))
    expect(linkStatus()).toBe(said)
    expect(live()).not.toBe(raw)
    expect(live().trimEnd()).toBe(said)
  })

  /**
   * **THE DIM IS THE PROGRAM'S, AND IT MUST NOT REACH A COPY'S READOUT.** `#results[data-state]` stays the
   * program's compile state wherever the strip has moved to (spec §9), and the rule that greys a running
   * compile hangs off the same element — so a copy's readout used to grey out for a compile that had
   * nothing to do with it.
   */
  it('does not dim a copy’s readout for the program’s compile', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    document.querySelector<HTMLElement>('[data-leaf="lambda-0"] button.view-title')?.focus()
    await until(() => /^λ copy 1 · /.test(resultsText()), "the copy's readout")

    view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
    const results = document.querySelector<HTMLElement>('#results')
    expect(results?.dataset.describes).toBe('copy')
    expect(getComputedStyle(results as HTMLElement).opacity).toBe('1')

    await until(() => state() === 'idle', 'the recompile')
    document.querySelector<HTMLElement>('[data-leaf="source"] .cm-content')?.focus()
    expect(document.querySelector<HTMLElement>('#results')?.dataset.describes).toBe('program')
  })

  it('reads a copy while its view is focused, and the program again when the source is', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    document.querySelector<HTMLElement>('[data-leaf="lambda-0"] button.view-title')?.focus()
    await until(() => /^λ copy 1 · [\d,]+ reductions/.test(resultsText()), "the copy's readout")
    expect(segments()).toHaveLength(1)
    expect(state()).toBe('idle')

    document.querySelector<HTMLElement>('[data-leaf="source"] .cm-content')?.focus()
    expect(segments()[0]).toBe('λ 42 · 7 reductions')
    expect(state()).toBe('idle')
  })
})

/**
 * **`createReadout` ON ITS OWN ELEMENT — whole-branch review, M2 and M8's second bullet.** The tests
 * above drive the strip through the whole app, which is the right way to check that the readout FOLLOWS
 * the focus; it cannot reach the first call of a readout's life, because by the time a test can look, the
 * app has already made it. These build their own host and call `show` directly.
 */
describe('createReadout', () => {
  it('says what it describes on the very first call, whose key is empty', async () => {
    const { createReadout } = await import('../../src/readout')
    const host = document.createElement('div')
    // THE APP'S OWN FIRST CALL: no program yet, nothing to say. Its key is `''` — which is what the
    // unchanged-key guard starts at, so this call took the early return and wrote no attribute at all.
    // `style.css` dims a running compile through `[data-state="running"][data-describes="program"]`, so
    // the strip stayed undimmed through the one compile with nothing else on it.
    createReadout(host).show(null, strip([]))
    expect(host.dataset.describes, 'the first call wrote no data-describes').toBe('copy')
  })

  it('keeps a copy out of the program error it renders next', async () => {
    const { createReadout } = await import('../../src/readout')
    const host = document.createElement('div')
    const readout = createReadout(host)
    readout.show(null, strip(['λ copy 1 · 3 reductions']))
    expect(host.dataset.describes).toBe('copy')
    // The error arm returned before writing the attribute too, so `'copy'` survived into a program error.
    readout.show({ kind: 'error', error: 'the worker stopped' } as never, strip([]))
    expect(host.dataset.describes, 'a program error still read as a copy').toBe('program')
  })

  /**
   * Spec §9: "the full text of anything it truncates is in its `title`". The stylesheet ellipsises a
   * segment that does not fit, so the untruncated text has to live somewhere the pointer can reach — and
   * on the SEGMENT rather than on `#results`, which is a `<section>` a `title` would turn into a landmark
   * named after whatever the program last computed.
   */
  it('carries each segment’s whole text in its own title', async () => {
    const { createReadout } = await import('../../src/readout')
    const host = document.createElement('div')
    const long = `λ ${'9'.repeat(200)} · 1 reduction`
    createReadout(host).show(null, strip([long, 'TM 42 · 3 transitions · width 8']))
    const segs = [...host.querySelectorAll<HTMLElement>('.segment')]
    expect(segs.map((s) => s.title)).toEqual([long, 'TM 42 · 3 transitions · width 8'])
    expect(segs.map((s) => s.textContent)).toEqual([long, 'TM 42 · 3 transitions · width 8'])
    expect(host.title, 'the strip itself must not get a name from its contents').toBe('')
  })
})
