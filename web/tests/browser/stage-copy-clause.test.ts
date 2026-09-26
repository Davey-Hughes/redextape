import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * THE λ COPY CLAUSE IN STAGE, where one view is on the page and every other host is off it.
 *
 * It names the λ view on the page when there is one — the view the λ link clause comes from, since
 * `linkStatus` suppresses a copy's own clauses (`stage.test.ts` has that clause's case) — and otherwise the
 * active λ view, off the page, AS THE TM COPY CLAUSE NAMES A HIDDEN TM COPY. With no λ view on the page the
 * λ link clause reads `'absent'` and says nothing, so the two cannot disagree. Selecting a tab records the
 * focused leaf and marks no pane active, so the λ view last clicked into can be off the page while the
 * status line is read.
 *
 * THE OTHER SHARED SURFACES ARE NOT HERE, ON PURPOSE. The running focuses and the TM copy clause read a leg's
 * live history through the active pane, on or off the page, and part 2's spec §8 keeps the step bar on "the
 * last view that could" step — `PaneCollection.shown`'s doc has the split.
 */
let view: EditorView
const SRC = 'let x = 40; x + 2'

const pick = (sel: string): void => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  const m = document.querySelector<HTMLElement>('#workspace-menu')
  if (m?.matches(':popover-open')) m.hidePopover()
}
const tab = (leaf: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`) as HTMLElement
/** The view hosts on the page — every `[data-leaf]` that is not itself a tab. */
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const linkStatus = () => document.querySelector('#link-status')?.textContent ?? ''
const title = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .view-title`)?.textContent ?? ''
const COPY = 'λ view shows a copy'

describe('in Stage, the λ copy clause', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SRC } })
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  it('names the λ copy whether or not the view showing it is on the page, as the TM clause does', async () => {
    pick('[data-switch="views"][data-value="stage"]')
    pick('[data-switch="steps"][data-value="view"]')
    tab('lambda-0').click()
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    await until(() => title('lambda-0').includes('copy'), 'the λ view to show a copy')
    expect(linkStatus()).toContain(COPY)

    tab('tm-0').click()
    expect(mounted()).toEqual(['tm-0'])
    expect(linkStatus(), 'the hidden λ copy is named').toContain(COPY)

    tab('source').click()
    expect(linkStatus(), 'the hidden λ copy is named').toContain(COPY)

    tab('lambda-0').click()
    expect(linkStatus()).toContain(COPY)
  })
})
