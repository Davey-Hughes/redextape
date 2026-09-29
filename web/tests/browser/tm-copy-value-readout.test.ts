import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * **A TM COPY'S VALUE NEVER REACHED THE FOOTER READOUT UNTIL SOME OTHER EVENT REDREW IT, ON `main` TOO.**
 * `replies.ts`'s scratch-reply `case 'tm-value'` stored the reading on the entry and called the TM view's own
 * `setScratchValue` — which is why `.tm-value`, the copy's IN-PANE line, always read correctly — but never called
 * `draw()`, which is the only thing that repaints `#results`, the footer readout `readout.ts`'s `tmCopyFacts` feeds
 * (spec §9). Seen by hand: `TM copy 2 · 18,574 transitions` right after *edit a copy*, `… · value: 6` only once some
 * unrelated gesture forced a redraw. `asm-value` beside it already called `draw()`; this is `tm-value`'s sibling fix.
 *
 * **WHY THE TWO LINES ARE CHECKED TOGETHER, RATHER THAN THE FOOTER ALONE.** `.tm-value` and `#results` are written
 * from the SAME reply handler invocation — one call sets the pane's own line unconditionally, the other repaints the
 * footer only if `draw()` runs — so whenever the in-pane line already shows the ended value, the footer either shows
 * it too (the fix ran in the same synchronous turn) or never will (nothing else in this test redraws it). Waiting on
 * `.tm-value` alone would pass whether or not the footer ever moved, which is exactly the gap `f9c2eb5` shipped with.
 *
 * **NO GESTURE AFTER THE FORK.** The test's whole claim is that the readout follows the copy's OWN value run with
 * nothing else prompting it, so nothing after `pick(tmHost, 'detach')` clicks, types or steps anything — a second
 * gesture would redraw the footer for an unrelated reason and the assertion below would pass at `f9c2eb5` too.
 */

const SAMPLE = 'let x = 40; x + 2'

let tmHost: HTMLElement
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const describesCopy = () => document.querySelector<HTMLElement>('#results')?.dataset.describes === 'copy'
const strip = () => document.querySelector('#results')?.textContent ?? ''
const tmValueText = () => tmHost.querySelector('.tm-value')?.textContent ?? ''
const copyShown = (pane: HTMLElement) => /copy · not linked/.test(pane.textContent ?? '')
const editorMounted = (pane: HTMLElement) => pane.querySelector('.term-editor .cm-editor') !== null

const menuOf = (pane: HTMLElement): HTMLElement => {
  const more = pane.querySelector<HTMLButtonElement>('button.view-more')
  const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
  if (more === null || menu === null) throw new Error('no view menu')
  return menu
}

/** Open `pane`'s `⋯` menu with the pointer and pick *edit a copy* with it, as a user does. */
async function detach(pane: HTMLElement): Promise<void> {
  await userEvent.click(pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement)
  await until(() => menuOf(pane).matches(':popover-open'), 'the view menu to open')
  const item = menuOf(pane).querySelector<HTMLButtonElement>('button.detach')
  if (item === null) throw new Error('the menu offers no detach')
  await userEvent.click(item)
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  tmHost = document.querySelector<HTMLElement>('.pane[data-leaf="tm-0"]') as HTMLElement
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
})

describe('the footer readout following a TM copy’s value', () => {
  it('reaches value: 42 with no gesture beyond the fork itself', async () => {
    // PRECONDITION: before any copy exists, neither line says anything of one — the TM view is on the
    // program, whose own reads carry no `TmScratchStatus` to draw a value line from, and the focused
    // view is still the source (amendment 12's default), not this one.
    expect(tmValueText()).toBe('')
    expect(describesCopy()).toBe(false)

    await detach(tmHost)
    await until(() => editorMounted(tmHost) && copyShown(tmHost), 'the TM copy’s build to land')

    // NO FURTHER GESTURE FROM HERE — see this file's own doc for why. `tmValueText` and `strip` are read
    // from the SAME reply's handler, so the combined predicate below is false forever at `f9c2eb5` (the
    // in-pane line reaches `value: 42` and the footer never follows) and true the instant both do.
    await until(
      () => tmValueText() === 'value: 42' && strip().includes('value: 42'),
      'the footer to follow the TM copy’s value with nothing else redrawing it',
    )
    expect(describesCopy()).toBe(true)
    expect(strip()).toMatch(/^TM copy \d+ · [\d,]+ transitions · value: 42$/)
  })
})
