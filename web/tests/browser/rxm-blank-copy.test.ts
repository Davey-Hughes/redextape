import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { bindingKey } from '../../src/view-header'
import { editorOf, retypeRxm } from './editor-view-fixture'
import { noticeText, resultsText, rxmPane, rxmValue, SHELL, stateIdle, until } from './harness'

/**
 * A blank rxm copy (Plan 7 part 5 spec §7): *new rxm copy* in the copies menu makes one no view shows, an rxm view's
 * title then offers it, and what is typed into it runs. Its readout line counts its steps in the singular for one
 * (amendment 29) and reads a fault as a fault. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

let view: EditorView

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => !stateIdle(), 'the compile to start')
  await until(stateIdle, 'the compile to finish')
})

describe('a blank rxm copy', () => {
  it('is made from the copies menu, and shows in no view until one picks it', async () => {
    const button = document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement
    await userEvent.click(button)
    const offered = [...document.querySelectorAll<HTMLButtonElement>('.buffer-list > button')].map((b) => b.textContent)
    expect(offered).toEqual(['new rxm copy', 'new TM copy'])
    await userEvent.click(document.querySelector<HTMLButtonElement>('.buffer-list button.new-rxm') as HTMLElement)
    await until(() => noticeText() === 'rxm copy 1 created', 'the notice')
    expect(rxmPane().textContent).not.toMatch(/copy · not linked/)

    const title = rxmPane().querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
    await userEvent.click(title)
    const menu = document.getElementById(title.getAttribute('aria-controls') ?? '') as HTMLElement
    await userEvent.click(
      menu.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('rxm', 'scratch-1')}"]`) as HTMLElement,
    )
    await until(() => editorOf(rxmPane()) !== null, 'the blank copy’s editor')
    expect(editorOf(rxmPane())?.state.doc.toString()).toBe('')
    // AN EMPTY PROGRAM PARSES, AND ITS FIRST FETCH RUNS PAST ITS END (spec amendment 28).
    await until(() => rxmValue() === 'fault: ran past end of program at pc0', 'the empty program’s fault')
    expect(rxmPane().querySelectorAll('.rxm-row').length).toBe(0)
  })

  it('runs what is typed into it', async () => {
    retypeRxm('result Nat\n\n    li\trr, #7\n    halt\n')
    await until(() => rxmValue() === 'value: 7', 'the typed program’s value')
    expect(rxmPane().querySelectorAll('.rxm-row .rxm-pc').length).toBe(2)
  })

  it('says its one instruction in the singular, and its value, in the strip', async () => {
    retypeRxm('result Nat\n\n    halt\n')
    await until(() => rxmValue() === 'value: 0', 'the one-instruction program')
    await userEvent.click(rxmPane().querySelector<HTMLElement>('.rxm-row') as HTMLElement)
    await until(() => resultsText() === 'rxm copy 1 · 1 instruction · value: 0', 'the copy’s strip')
  })

  it('reads a fault as a fault, in its view and in the strip', async () => {
    retypeRxm('result Nat\n\n    li\tr0, #0\n    head\trr, r0\n    halt\n')
    await until(() => rxmValue() === 'fault: head of empty list at pc1', 'the fault')
    await until(() => resultsText() === 'rxm copy 1 · 1 instruction · fault: head of empty list at pc1', 'the strip')
  })

  /**
   * **ITS ROW IN THE COPIES MENU SAYS WHAT ITS READOUT SAYS**, under its name: a machine copy has no term.
   */
  it('says in its copies-menu row what its readout says of its run', async () => {
    await userEvent.click(document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement)
    const row = () =>
      [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row')].find((r) =>
        r.querySelector('.buffer-row-name')?.textContent?.startsWith('rxm copy 1 ·'),
      )
    await until(() => row() !== undefined, 'the copy’s row')
    const term = row()?.querySelector<HTMLElement>('.buffer-row-term')
    expect(term?.textContent).toBe('1 instruction · fault: head of empty list at pc1')
    expect(term?.classList.contains('is-absent')).toBe(false)
    await userEvent.keyboard('{Escape}')
  })
})
