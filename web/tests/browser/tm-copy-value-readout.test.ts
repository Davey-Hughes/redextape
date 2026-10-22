import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { copyShown, pickInViewMenu, resultsText, SHELL, stateIdle, until } from './harness'

/**
 * **A TM COPY'S VALUE REACHES THE FOOTER READOUT WITH NOTHING ELSE REDRAWING IT.** `replies.ts`'s scratch-reply
 * `case 'tm-value'` stores the reading on the entry and calls the TM view's own `setScratchValue`, which writes
 * `.tm-value`, the copy's IN-PANE line; `#results`, the footer readout `readout.ts`'s `tmCopyFacts` feeds
 * (spec §9), is repainted only by a draw, so an arm that skipped it would leave the footer without the value
 * until some unrelated gesture forced a redraw.
 *
 * **WHY THE TWO LINES ARE CHECKED TOGETHER, RATHER THAN THE FOOTER ALONE.** `.tm-value` and `#results` are written
 * from the SAME reply handler invocation — one call sets the pane's own line unconditionally, the other repaints the
 * footer only if `draw()` runs — so whenever the in-pane line already shows the ended value, the footer either shows
 * it too (the draw ran in the same synchronous turn) or never will (nothing else in this test redraws it). Waiting on
 * `.tm-value` alone would pass whether or not the footer ever moved.
 *
 * **NO GESTURE AFTER THE FORK.** The test's whole claim is that the readout follows the copy's OWN value run with
 * nothing else prompting it, so nothing after `pickInViewMenu(tmHost, 'detach')` clicks, types or steps anything — a
 * second gesture would redraw the footer for an unrelated reason and the assertion below would pass on an arm that
 * never draws.
 */

const SAMPLE = 'let x = 40; x + 2'

let tmHost: HTMLElement
const describesCopy = () => document.querySelector<HTMLElement>('#results')?.dataset.describes === 'copy'
const tmValueText = () => tmHost.querySelector('.tm-value')?.textContent ?? ''
const editorMounted = (pane: HTMLElement) => pane.querySelector('.term-editor .cm-editor') !== null

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  tmHost = document.querySelector<HTMLElement>('.pane[data-leaf="tm-0"]') as HTMLElement
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
  await until(() => !stateIdle(), 'the compile to start')
  await until(stateIdle, 'the compile to finish')
})

describe('the footer readout following a TM copy’s value', () => {
  it('reaches value: 42 with no gesture beyond the fork itself', async () => {
    // PRECONDITION: before any copy exists, neither line says anything of one — the TM view is on the
    // program, whose own reads carry no `TmScratchStatus` to draw a value line from.
    expect(tmValueText()).toBe('')
    expect(describesCopy()).toBe(false)

    await pickInViewMenu(tmHost, 'detach')
    await until(() => editorMounted(tmHost) && copyShown(tmHost), 'the TM copy’s build to land')

    // NO FURTHER GESTURE FROM HERE — see this file's own doc for why. `tmValueText` and `resultsText` are read
    // from the SAME reply's handler, so the combined predicate below would stay false forever on an arm that
    // never draws (the in-pane line reaching `value: 42` and the footer never following) and is true the
    // instant both do.
    await until(
      () => tmValueText() === 'value: 42' && resultsText().includes('value: 42'),
      'the footer to follow the TM copy’s value with nothing else redrawing it',
    )
    expect(describesCopy()).toBe(true)
    expect(resultsText()).toMatch(/^TM copy \d+ · [\d,]+ transitions · value: 42$/)
  })
})
