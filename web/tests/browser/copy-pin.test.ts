import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { BUFFERS_STORAGE_KEY } from '../../src/buffers-store'
import { SHELL, until } from './harness'

/**
 * A view showing a copy marks nothing, whatever is pinned (Plan 7 part 5 spec §4.5, amendment 32 in the inbound
 * direction): a pin resolves to the PROGRAM's instruction and state indices, and a copy numbers its rows by itself, so
 * an index read there names whatever the copy has at it. Both routes a pin takes to a machine view are here, on both
 * legs: `link-wiring.ts`'s fan-out to every view, made while the copy's view is on the page, and `draw.ts`'s re-applied
 * pin, for a view seeded when it is shown after its copy rebuilt off the page. So is the program's running focus,
 * which resolves to the same indices and which `draw.ts` hands every machine view on the page, a copy's among them,
 * while a view of the program beside it is the one the user last focused.
 *
 * Every pointer gesture is a `userEvent` one, and the pin is `Mod-'` pressed through `userEvent.keyboard` in the
 * source, with the caret put on the construct first.
 *
 * ONE MOUNT FOR THE FILE, for the reason every sibling gives: `main()` runs once per page.
 */

const SAMPLE = 'let x = 40; x + 2'
/** The construct pinned, with the caret on its `+`: `x + 2` lowers to `pc3`, `add rr, r1, r2`, and owns TM states. */
const PINNED = 'x + 2'
/** An edited asm copy: five instructions, as the program has, so its `pc3` is there to be mis-marked. */
const EDITED = 'result Nat\n\n    li\tr1, #5\n    li\tr2, #6\n    li\tr3, #7\n    li\trr, #8\n    halt\n'
/** The same copy edited again while its view is off the page, so its rebuild lands there. */
const EDITED_AGAIN = 'result Nat\n\n    li\tr1, #1\n    li\tr2, #2\n    li\tr3, #3\n    li\trr, #9\n    halt\n'

let view: EditorView

/** The two views' hosts, held from the mount: `pane-host.ts` keeps a host for good, on the page or off it. */
let asmHost: HTMLElement
let tmHost: HTMLElement
const asm = () => asmHost
const tm = () => tmHost
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const editorOf = (pane: HTMLElement): EditorView | null => {
  const el = pane.querySelector<HTMLElement>('.term-editor')
  return el === null ? null : EditorView.findFromDOM(el)
}
const replace = (v: EditorView, text: string) =>
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
const pcs = () => [...asm().querySelectorAll<HTMLElement>('.asm-row .asm-pc')].map((e) => e.textContent)
const value = () => asm().querySelector('.asm-value')?.textContent ?? ''
const sourceLinked = () => view.dom.querySelector('.linked')?.textContent ?? null
const copyShown = (pane: HTMLElement) => /copy · not linked/.test(pane.textContent ?? '')
const stored = () => localStorage.getItem(BUFFERS_STORAGE_KEY) ?? ''
const tab = (leaf: string) =>
  document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`) as HTMLElement
const menuOf = (pane: HTMLElement): HTMLElement => {
  const more = pane.querySelector<HTMLButtonElement>('button.view-more')
  const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
  if (more === null || menu === null) throw new Error('no view menu')
  return menu
}
const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)))

/** Open `pane`'s `⋯` menu with the pointer and pick `cls`'s item with it, as a user does. */
async function pick(pane: HTMLElement, cls: string): Promise<void> {
  await userEvent.click(pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement)
  await until(() => menuOf(pane).matches(':popover-open'), 'the view menu to open')
  const item = menuOf(pane).querySelector<HTMLButtonElement>(`button.${cls}`)
  if (item === null) throw new Error(`the menu offers no ${cls}`)
  await userEvent.click(item)
}

/** Pin `PINNED` in the source with `Mod-'`, the keyboard's link gesture, and wait for the source to show it. */
async function pin(): Promise<void> {
  view.dispatch({ selection: { anchor: SAMPLE.indexOf('+') } })
  view.focus()
  await userEvent.keyboard("{Control>}'{/Control}")
  await until(() => sourceLinked() === PINNED, 'the source to show the pin')
  // THE FAN-OUT IS SYNCHRONOUS WITH THE SOURCE'S MARK; a frame more lets any scroll a pin asked for draw its rows.
  await frame()
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  asmHost = document.querySelector<HTMLElement>('.pane[data-leaf="asm-0"]') as HTMLElement
  tmHost = document.querySelector<HTMLElement>('.pane[data-leaf="tm-0"]') as HTMLElement
  replace(view, SAMPLE)
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
  await until(() => pcs().length === 5, 'the program’s listing')
  await until(() => tm().querySelectorAll('.state-row').length > 3, 'the program’s rules')
})

describe('a view on the page showing a copy', () => {
  it('marks no instruction of an edited asm copy, where a view of the program marks the pin', async () => {
    await pick(asm(), 'detach')
    await until(() => editorOf(asm()) !== null, 'the asm copy’s editor')
    replace(editorOf(asm()) as EditorView, EDITED)
    await until(() => value() === 'value: 8', 'the edited copy to build')
    expect(pcs()).toEqual(['pc0', 'pc1', 'pc2', 'pc3', 'pc4'])

    await pin()
    await until(() => tm().querySelector('.state-row.is-linked') !== null, 'the program’s TM view to mark the pin')
    expect(asm().querySelector('.asm-row.is-linked')).toBeNull()
  })

  it('marks no state of a TM copy', async () => {
    await pick(tm(), 'detach')
    await until(() => editorOf(tm()) !== null, 'the TM copy’s editor')
    await until(() => copyShown(tm()) && tm().querySelectorAll('.state-row').length > 3, 'the TM copy’s rules')

    // THE PIN THE TEST ABOVE MADE IS CLEARED FIRST — an edit to the source clears it, and the recompile repaints the
    // source without it — so the pin below is this test's own keypress, and `pin`'s wait for the source's mark is a
    // positive control rather than the mark the test above left.
    replace(view, SAMPLE)
    await until(() => !idle(), 'the recompile to start')
    await until(idle, 'the recompile to finish')
    await until(() => sourceLinked() === null, 'the earlier pin to clear')
    await pin()
    expect(tm().querySelector('.state-row.is-linked')).toBeNull()
    expect(asm().querySelector('.asm-row.is-linked')).toBeNull()
  })
})

describe('a view on the page showing a copy, beside a view of the program', () => {
  /** Split `pane` with the program's pair on `leg`, through its menu with the pointer; the new view takes the focus. */
  async function splitToProgram(pane: HTMLElement, leg: 'asm' | 'tm'): Promise<HTMLElement> {
    const before = new Set([...document.querySelectorAll<HTMLElement>(`.pane[data-kind="${leg}"]`)])
    await userEvent.click(pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement)
    await until(() => menuOf(pane).matches(':popover-open'), 'the view menu to open')
    const split = menuOf(pane).querySelector<HTMLButtonElement>('button.view-split[data-dir="row"]')
    await userEvent.click(split as HTMLButtonElement)
    const pair = () => menuOf(pane).querySelector<HTMLButtonElement>(`button[data-binding="${leg}:source"]`)
    await until(() => pair() !== null, 'the split’s pairs')
    await userEvent.click(pair() as HTMLButtonElement)
    const made = () =>
      [...document.querySelectorAll<HTMLElement>(`.pane[data-kind="${leg}"]`)].find((e) => !before.has(e))
    await until(() => made() !== undefined, 'the split view')
    return made() as HTMLElement
  }
  const control = (pane: HTMLElement, label: string) =>
    [...pane.querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
  const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''

  /** Walk `pane`'s whole virtualized rule table and report whether any row is painted as the running focus. */
  async function anyFocusedRow(pane: HTMLElement): Promise<boolean> {
    const table = pane.querySelector<HTMLElement>('.state-table') as HTMLElement
    let found = false
    for (let s = 0; s <= 60 && !found; s += 1) {
      table.scrollTop = (table.scrollHeight * s) / 60
      table.dispatchEvent(new Event('scroll'))
      await frame()
      found = pane.querySelector('.state-row.is-focus') !== null
    }
    return found
  }

  it('marks no instruction of an asm copy for the program’s running focus', async () => {
    const program = await splitToProgram(asm(), 'asm')
    // STEP 0, WHERE `pc0` — `li r0, #40`, the literal `40`'s — RUNS NEXT, AND THE FOCUS IS ITS CONSTRUCT.
    await userEvent.click(control(program, '↺') as HTMLButtonElement)
    await until(() => stepOf(program).startsWith('step 0 of'), 'the program’s view to restart')
    await until(() => program.querySelector('.asm-row.is-focus') !== null, 'the program’s view to mark the focus')
    expect(copyShown(asm()), 'the first view still shows its copy').toBe(true)
    expect(asm().querySelector('.asm-row.is-focus')).toBeNull()
  })

  it('marks no state of a TM copy for the program’s running focus', async () => {
    const program = await splitToProgram(tm(), 'tm')
    // ONE STEP BACK FROM THE FRONTIER, WHERE THE MACHINE STANDS IN `pc4` AND THE FOCUS IS `pc4`'S CONSTRUCT —
    // `running-focus.test.ts` measured the tail.
    // BY `⏭`: a run opens on step 0 (`History`).
    await userEvent.click(program.querySelector('.controls button.to-newest') as HTMLButtonElement)
    await until(() => /step 2,870 of 2,870/.test(stepOf(program)), 'the program’s view at the frontier')
    await userEvent.click(control(program, '◀') as HTMLButtonElement)
    await until(() => program.querySelector('.state-row.is-focus') !== null, 'the program’s view to mark the focus')
    expect(copyShown(tm()), 'the first view still shows its copy').toBe(true)
    expect(await anyFocusedRow(tm())).toBe(false)
  })
})

describe('a view off the page when its copy rebuilt, and shown after the pin', () => {
  it('marks nothing on either leg once it is shown', async () => {
    const asmEditor = editorOf(asm()) as EditorView
    const tmEditor = editorOf(tm()) as EditorView
    // STAGE: ONE VIEW ON THE PAGE, the source's, so both copies' views are off it.
    await userEvent.click(document.querySelector<HTMLButtonElement>('#workspace') as HTMLButtonElement)
    const stage = document.querySelector<HTMLButtonElement>('#workspace-menu [data-switch="views"][data-value="stage"]')
    if (stage === null) throw new Error('the workspace menu offers no stage')
    await userEvent.click(stage)
    const menu = document.querySelector<HTMLElement>('#workspace-menu')
    if (menu?.matches(':popover-open')) await userEvent.keyboard('{Escape}')
    await until(() => tab('source') !== null, 'the stage’s tabs')
    await userEvent.click(tab('source'))
    await until(() => !asm().isConnected && !tm().isConnected, 'both copies’ views to be off the page')

    // EACH COPY REBUILDS OFF THE PAGE, which puts its view in `replies.ts`'s `unseen`. A rebuild is stored when it
    // lands (`onBuffersPersist`) and not when it is typed, so the stored copies changing is the build having landed.
    let before = stored()
    replace(asmEditor, EDITED_AGAIN)
    await until(() => stored() !== before, 'the asm copy’s rebuild to land off the page')
    before = stored()
    replace(tmEditor, `${tmEditor.state.doc.toString()}\n`)
    await until(() => stored() !== before, 'the TM copy’s rebuild to land off the page')

    await pin()

    await userEvent.click(tab('asm-0'))
    await until(() => asm().isConnected && value() === 'value: 9', 'the asm view, seeded with its rebuilt copy')
    await frame()
    expect(pcs()).toEqual(['pc0', 'pc1', 'pc2', 'pc3', 'pc4'])
    expect(asm().querySelector('.asm-row.is-linked')).toBeNull()

    await userEvent.click(tab('tm-0'))
    await until(() => tm().isConnected && tm().querySelectorAll('.state-row').length > 3, 'the TM view’s rules')
    await frame()
    expect(tm().querySelector('.state-row.is-linked')).toBeNull()
  })
})
