import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { clickWorkspaceItem, linkStatus, mounted, SHELL, stageTab, stateIdle, until } from './harness'

/**
 * THE λ COPY CLAUSE IN STAGE, where one view is on the page and every other host is off it.
 *
 * It names the λ view on a copy whether that view is on the page or not, as it names every view showing a copy:
 * a view off the page is still a view, and its tab names it (`link-wiring.ts`'s `detachedPanes`). With no λ view
 * of the program on the page the λ link clause reads `'absent'` and says nothing, so the two cannot disagree —
 * `stage.test.ts` has that clause's case.
 *
 * THE OTHER SHARED SURFACES ARE NOT HERE, ON PURPOSE. The running focuses read a leg's live history through a
 * view of the program, on or off the page, and part 2's spec §8 keeps the step bar on "the last view that
 * could" step — `PaneCollection.shown`'s doc has the split.
 */
let view: EditorView
const SRC = 'let x = 40; x + 2'

const title = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .view-title`)?.textContent ?? ''
const COPY = 'λ view shows a copy'

describe('in Stage, the λ copy clause', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SRC } })
    await until(stateIdle, 'the first compile')
  })

  it('names the λ copy whether or not the view showing it is on the page, as the TM clause does', async () => {
    clickWorkspaceItem('[data-switch="views"][data-value="stage"]')
    clickWorkspaceItem('[data-switch="steps"][data-value="view"]')
    stageTab('lambda-0').click()
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
    await until(() => title('lambda-0').includes('copy'), 'the λ view to show a copy')
    expect(linkStatus()).toContain(COPY)

    stageTab('tm-0').click()
    expect(mounted()).toEqual(['tm-0'])
    expect(linkStatus(), 'the hidden λ copy is named').toContain(COPY)

    stageTab('source').click()
    expect(linkStatus(), 'the hidden λ copy is named').toContain(COPY)

    stageTab('lambda-0').click()
    expect(linkStatus()).toContain(COPY)
  })
})
