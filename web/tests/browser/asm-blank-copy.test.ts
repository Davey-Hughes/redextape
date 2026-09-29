import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

/**
 * A blank asm copy (Plan 7 part 5 spec §7): *new asm copy* in the copies menu makes one no view shows, an asm view's
 * title then offers it, and what is typed into it runs. Its readout line counts its steps in the singular for one
 * (amendment 29) and reads a fault as a fault. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
 */

let view: EditorView

const asm = () => document.querySelector<HTMLElement>('.pane[data-leaf="asm-0"]') as HTMLElement
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const editor = (): EditorView | null => {
  const el = asm().querySelector<HTMLElement>('.term-editor')
  return el === null ? null : EditorView.findFromDOM(el)
}
const type = (text: string) => {
  const v = editor()
  if (v === null) throw new Error('no editor in the asm view')
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
}
const value = () => asm().querySelector('.asm-value')?.textContent ?? ''
const notice = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const strip = () => document.querySelector('#results')?.textContent ?? ''

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
})

describe('a blank asm copy', () => {
  it('is made from the copies menu, and shows in no view until one picks it', async () => {
    const button = document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement
    await userEvent.click(button)
    const offered = [...document.querySelectorAll<HTMLButtonElement>('.buffer-list > button')].map((b) => b.textContent)
    expect(offered).toEqual(['new asm copy', 'new TM copy'])
    await userEvent.click(document.querySelector<HTMLButtonElement>('.buffer-list button.new-asm') as HTMLElement)
    await until(() => notice() === 'asm copy 1 created', 'the notice')
    expect(asm().textContent).not.toMatch(/copy · not linked/)

    const title = asm().querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
    await userEvent.click(title)
    const menu = document.getElementById(title.getAttribute('aria-controls') ?? '') as HTMLElement
    await userEvent.click(
      menu.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('asm', 'scratch-1')}"]`) as HTMLElement,
    )
    await until(() => editor() !== null, 'the blank copy’s editor')
    expect(editor()?.state.doc.toString()).toBe('')
    // AN EMPTY PROGRAM PARSES, AND ITS FIRST FETCH RUNS PAST ITS END (spec amendment 28).
    await until(() => value() === 'fault: ran past end of program at pc0', 'the empty program’s fault')
    expect(asm().querySelectorAll('.asm-row').length).toBe(0)
  })

  it('runs what is typed into it', async () => {
    type('result Nat\n\n    li\trr, #7\n    halt\n')
    await until(() => value() === 'value: 7', 'the typed program’s value')
    expect(asm().querySelectorAll('.asm-row .asm-pc').length).toBe(2)
  })

  it('says its one instruction in the singular, and its value, in the strip', async () => {
    type('result Nat\n\n    halt\n')
    await until(() => value() === 'value: 0', 'the one-instruction program')
    await userEvent.click(asm().querySelector<HTMLElement>('.asm-row') as HTMLElement)
    await until(() => strip() === 'asm copy 1 · 1 instruction · value: 0', 'the copy’s strip')
  })

  it('reads a fault as a fault, in its view and in the strip', async () => {
    type('result Nat\n\n    li\tr0, #0\n    head\trr, r0\n    halt\n')
    await until(() => value() === 'fault: head of empty list at pc1', 'the fault')
    await until(() => strip() === 'asm copy 1 · 1 instruction · fault: head of empty list at pc1', 'the strip')
  })

  /**
   * **ITS ROW IN THE COPIES MENU SAYS WHAT ITS READOUT SAYS**, under its name, where every asm and TM row read
   * `no term yet` — a machine copy has no term, and the words for that said nothing had come back.
   */
  it('says in its copies-menu row what its readout says of its run', async () => {
    await userEvent.click(document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement)
    const row = () =>
      [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row')].find((r) =>
        r.querySelector('.buffer-row-name')?.textContent?.startsWith('asm copy 1 ·'),
      )
    await until(() => row() !== undefined, 'the copy’s row')
    const term = row()?.querySelector<HTMLElement>('.buffer-row-term')
    expect(term?.textContent).toBe('1 instruction · fault: head of empty list at pc1')
    expect(term?.classList.contains('is-absent')).toBe(false)
    await userEvent.keyboard('{Escape}')
  })
})
