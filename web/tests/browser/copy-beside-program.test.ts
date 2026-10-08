import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * A view of the program beside a view of a copy on the same leg, with the copy's view focused last.
 *
 * **THE PROGRAM'S RUNNING FOCUS COMES FROM A VIEW OF THE PROGRAM.** `draw.ts` read each machine leg's running focus
 * off the view of that leg focused last, so focusing a copy's view — which owns no construct of the program's —
 * took every focus mark off the program's own view, though the program had not moved. The check by hand saw it in
 * Explorer and in Stage, where the program's tab was the one shown and stepped. Each leg now reads the most recently
 * focused view that shows the program, and a copy's view is never the source.
 *
 * **THE STATUS LINE NAMES EVERY VIEW SHOWING A COPY.** It read one view per leg, the one focused last, so the asm copy
 * went unnamed while the program's asm view had been focused more recently, and "asm view" said nothing about which
 * of two. With two views on the leg, the copy's is named by its title, whichever was focused last.
 *
 * Every gesture is a `userEvent` one. ONE MOUNT FOR THE FILE, for the reason every sibling gives: `main()` runs once
 * per page.
 */

const SAMPLE = 'let x = 40; x + 2'
const NOT_LINKED = 'not linked to the program'

let view: EditorView
let asmHost: HTMLElement
let tmHost: HTMLElement
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const editorOf = (pane: HTMLElement): EditorView | null => {
  const el = pane.querySelector<HTMLElement>('.term-editor')
  return el === null ? null : EditorView.findFromDOM(el)
}
const copyShown = (pane: HTMLElement) => /copy · not linked/.test(pane.textContent ?? '')
const status = () => document.querySelector('#link-status')?.textContent ?? ''
const titleOf = (pane: HTMLElement) => pane.querySelector('button.view-title')?.textContent?.trim() ?? ''
const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''
const control = (pane: HTMLElement, label: string) =>
  [...pane.querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
const menuOf = (pane: HTMLElement): HTMLElement => {
  const more = pane.querySelector<HTMLButtonElement>('button.view-more')
  const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
  if (more === null || menu === null) throw new Error('no view menu')
  return menu
}
/** The pcs of `pane`'s listing rows painted as the running focus. */
const asmFocus = (pane: HTMLElement) =>
  [...pane.querySelectorAll<HTMLElement>('.asm-row.is-focus .asm-pc')].map((e) => e.textContent ?? '')
/** The names of `pane`'s δ-table state rows painted as the running focus. */
const tmFocus = (pane: HTMLElement) =>
  [...pane.querySelectorAll<HTMLElement>('.state-row.is-focus')].map((e) => e.textContent ?? '')

/** Open `pane`'s `⋯` menu with the pointer and pick `cls`'s item with it, as a user does. */
async function pick(pane: HTMLElement, cls: string): Promise<void> {
  await userEvent.click(pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement)
  await until(() => menuOf(pane).matches(':popover-open'), 'the view menu to open')
  const item = menuOf(pane).querySelector<HTMLButtonElement>(`button.${cls}`)
  if (item === null) throw new Error(`the menu offers no ${cls}`)
  await userEvent.click(item)
}

/** Split `pane` with the program's pair on `leg`, through its menu with the pointer; returns the new view. */
async function splitToProgram(pane: HTMLElement, leg: 'asm' | 'tm'): Promise<HTMLElement> {
  const before = new Set([...document.querySelectorAll<HTMLElement>(`.pane[data-kind="${leg}"]`)])
  await userEvent.click(pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement)
  await until(() => menuOf(pane).matches(':popover-open'), 'the view menu to open')
  await userEvent.click(
    menuOf(pane).querySelector<HTMLButtonElement>('button.view-split[data-dir="row"]') as HTMLButtonElement,
  )
  const pair = () => menuOf(pane).querySelector<HTMLButtonElement>(`button[data-binding="${leg}:source"]`)
  await until(() => pair() !== null, 'the split’s pairs')
  await userEvent.click(pair() as HTMLButtonElement)
  const made = () =>
    [...document.querySelectorAll<HTMLElement>(`.pane[data-kind="${leg}"]`)].find((e) => !before.has(e))
  await until(() => made() !== undefined, 'the split view')
  return made() as HTMLElement
}

/**
 * Click into a copy's view with the pointer, on a row of its grid, and assert the focus landed there. A row of a copy
 * links nothing (amendment 28), so the click moves the focus and changes nothing else.
 */
async function focusInto(pane: HTMLElement, row: string): Promise<void> {
  await userEvent.click(pane.querySelector<HTMLElement>(row) as HTMLElement)
  expect(pane.contains(document.activeElement), 'the click put the focus in the view').toBe(true)
}

/**
 * Focus a view of the program through its title: open the title's menu with the pointer and dismiss it with Escape,
 * which hands the focus back to the title. Not a row: a row of the program's pins its construct, and the pin would
 * add its own clauses to the line these tests read.
 */
async function focusTitle(pane: HTMLElement): Promise<void> {
  const title = pane.querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
  await userEvent.click(title)
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '') as HTMLElement
  await until(() => menu.matches(':popover-open'), 'the title’s menu to open')
  await userEvent.keyboard('{Escape}')
  await until(() => !menu.matches(':popover-open'), 'the title’s menu to close')
  expect(pane.contains(document.activeElement), 'the focus is in the view').toBe(true)
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  asmHost = document.querySelector<HTMLElement>('.pane[data-leaf="asm-0"]') as HTMLElement
  tmHost = document.querySelector<HTMLElement>('.pane[data-leaf="tm-0"]') as HTMLElement
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
  await until(() => asmHost.querySelectorAll('.asm-row').length === 5, 'the program’s listing')
  await until(() => tmHost.querySelectorAll('.state-row').length > 3, 'the program’s rules')
})

describe('an asm view of the program beside an asm view of a copy', () => {
  let program: HTMLElement

  it('keeps marking the program’s running focus when the copy’s view is focused last', async () => {
    await pick(asmHost, 'detach')
    await until(() => editorOf(asmHost) !== null && copyShown(asmHost), 'the asm copy in the first view')
    program = await splitToProgram(asmHost, 'asm')
    await until(() => program.querySelectorAll('.asm-row').length === 5, 'the program’s listing in the split')

    // STEP 0: `pc0`, `li r0, #40`, runs next, and the focus is the literal `40`'s.
    await userEvent.click(control(program, '↺') as HTMLButtonElement)
    await until(() => stepOf(program).startsWith('step 0 of'), 'the program’s view to restart')
    await until(() => asmFocus(program).length > 0, 'the program’s view to mark the focus')
    const atZero = asmFocus(program)
    expect(atZero).toEqual(['pc0'])

    await focusInto(asmHost, '.asm-row')
    expect(asmFocus(program), 'the program’s view kept its focus marks').toEqual(atZero)
    expect(asmFocus(asmHost), 'the copy’s view marks nothing of the program’s').toEqual([])
  })

  it('moves the program’s marks when the program steps, with the copy’s view focused last again', async () => {
    const atZero = asmFocus(program)
    // STEPPED UNTIL THE FOCUS NAMES ANOTHER CONSTRUCT, then the copy's view is focused again.
    for (let i = 0; i < 4 && asmFocus(program).join() === atZero.join(); i += 1) {
      await userEvent.click(control(program, '▶') as HTMLButtonElement)
    }
    const moved = asmFocus(program)
    expect(moved.length, 'a later step’s construct is marked').toBeGreaterThan(0)
    expect(moved).not.toEqual(atZero)

    await focusInto(asmHost, '.asm-row')
    expect(asmFocus(program)).toEqual(moved)
  })

  it('names the asm copy by its title in the status line, whichever asm view was focused last', async () => {
    const said = `${titleOf(asmHost)} view shows a copy — ${NOT_LINKED}`
    expect(titleOf(asmHost)).toMatch(/^asm · copy \d+$/)
    // THE COPY'S VIEW WAS FOCUSED LAST: "asm view shows a copy" would not say which of the two.
    expect(status()).toBe(said)
    // THE PROGRAM'S VIEW FOCUSED LAST: the line said nothing of the asm copy on screen.
    await focusTitle(program)
    expect(status()).toBe(said)
  })
})

describe('a TM view of the program beside a TM view of a copy', () => {
  let program: HTMLElement

  it('keeps marking the program’s running focus when the copy’s view is focused last', async () => {
    await pick(tmHost, 'detach')
    await until(() => editorOf(tmHost) !== null && copyShown(tmHost), 'the TM copy in the first view')
    await until(() => tmHost.querySelectorAll('.state-row').length > 3, 'the TM copy’s rules')
    program = await splitToProgram(tmHost, 'tm')
    // BY `⏭`: a run opens on step 0 (`History`).
    await userEvent.click(program.querySelector('.controls button.to-newest') as HTMLButtonElement)
    await until(() => /step 2,870 of 2,870/.test(stepOf(program)), 'the program’s view at the frontier')

    // ONE STEP BACK FROM THE FRONTIER THE MACHINE STANDS IN `pc4`, WHICH IS THE FOCUS — `running-focus.test.ts`
    // measured the tail.
    await userEvent.click(control(program, '◀') as HTMLButtonElement)
    await until(() => tmFocus(program).length > 0, 'the program’s view to mark the focus')
    expect(tmFocus(program)).toEqual(['pc4'])

    await focusInto(tmHost, '.state-row')
    expect(tmFocus(program), 'the program’s view kept its focus marks').toEqual(['pc4'])
  })

  it('moves the program’s marks when the program steps, with the copy’s view focused last again', async () => {
    // ONE MORE STEP BACK AND THE FOCUS IS `x + 2`'S `add5.d.*` BLOCK, several state headers.
    await userEvent.click(control(program, '◀') as HTMLButtonElement)
    await until(() => stepOf(program).includes('step 2,868'), 'the program’s view one step further back')
    const block = tmFocus(program)
    expect(block.length, 'a construct’s whole block is marked').toBeGreaterThan(1)

    await focusInto(tmHost, '.state-row')
    expect(tmFocus(program)).toEqual(block)
  })

  it('names both copies in the status line, each by its title', async () => {
    const asmTitle = titleOf(asmHost)
    const tmTitle = titleOf(tmHost)
    expect(tmTitle).toMatch(/^TM · copy \d+$/)
    expect(status()).toBe(`${asmTitle} and ${tmTitle} views show copies — ${NOT_LINKED}`)
    await focusTitle(program)
    expect(status()).toBe(`${asmTitle} and ${tmTitle} views show copies — ${NOT_LINKED}`)
  })
})

/**
 * **EACH MACHINE COPY'S ROW IN THE COPIES MENU SAYS WHAT ITS READOUT SAYS OF ITS RUN** — the line under its name,
 * which read `no term yet` for every TM and asm copy, run or not. Read here against the strip, with each copy's view
 * focused in turn: the row is the strip's line for the copy, without the name.
 */
describe('the copies menu, beside both copies', () => {
  const strip = () => document.querySelector('#results')?.textContent ?? ''
  const rowOf = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('.buffer-list .buffer-row')]
      .find((r) => r.querySelector('.buffer-row-name')?.textContent?.startsWith(`${name} ·`))
      ?.querySelector<HTMLElement>('.buffer-row-term')?.textContent ?? null

  it('says under each machine copy what its readout says, in the readout’s words', async () => {
    const lines: [string, string][] = []
    for (const [pane, row] of [
      [asmHost, '.asm-row'],
      [tmHost, '.state-row'],
    ] as const) {
      await focusInto(pane, row)
      const name = titleOf(pane).replace(' · ', ' ')
      await until(() => strip().startsWith(`${name} · `), `the strip to read ${name}`)
      lines.push([name, strip().slice(name.length + 3)])
    }
    expect(lines.map(([, line]) => line)).toEqual(['5 instructions · value: 42', '2,870 transitions · value: 42'])

    await userEvent.click(document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement)
    for (const [name, line] of lines) {
      await until(() => rowOf(name) !== null, `${name}’s row`)
      expect(rowOf(name), `${name}’s row`).toBe(line)
    }
    await userEvent.keyboard('{Escape}')
  })
})
