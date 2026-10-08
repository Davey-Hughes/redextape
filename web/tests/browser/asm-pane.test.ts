import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { AsmPanels } from '../../src/asm-pane'
import { AsmPane } from '../../src/asm-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { AsmProgram, AsmWord } from '../../src/types'
import { FACT3, frameOf } from '../node/asm-fixtures'
import { until } from './harness'

/**
 * The asm view on its own (Plan 7 part 5 spec §6), built as `tm-follow-clamp.test.ts` builds a TM view: a host sized by
 * hand, the pane's events stubbed, and frames written by hand in the shape `AsmState::window` produces. The app-level
 * suite drives the same view from a real compile.
 */

const CONTROLS = {
  canRestart: true,
  canBack: true,
  canForward: true,
  canToNewest: true,
  canPlay: true,
  playing: false,
  stepText: 'step 3 of 55',
  continueLabel: null,
}

const v = (word: string): AsmWord => ({ word, tag: 'Value' })
const l = (word: string): AsmWord => ({ word, tag: 'List' })
const b = (word: string): AsmWord => ({ word, tag: 'Box' })

function events(over: Partial<PaneEvents> = {}): PaneEvents {
  return {
    back: vi.fn(),
    forward: vi.fn(),
    toNewest: vi.fn(),
    play: vi.fn(),
    restart: vi.fn(),
    extend: vi.fn(),
    speed: () => 8,
    setSpeed: vi.fn(),
    rebind: vi.fn(),
    ...over,
  }
}

/** A view in a host `height` pixels tall and `width` wide, attached to the page, with `program` set. */
function mount(
  program: AsmProgram | null,
  on: PaneEvents = events(),
  height = 900,
  width = 1000,
  panels: AsmPanels = {},
) {
  const host = document.createElement('section')
  host.className = 'pane'
  host.dataset.kind = 'asm'
  host.style.height = `${height}px`
  host.style.width = `${width}px`
  document.body.append(host)
  const pane = new AsmPane(host, on, panels)
  pane.setProgram(program)
  return { host, pane }
}

const listing = (host: HTMLElement) => host.querySelector('.asm-listing') as HTMLElement
const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.asm-row')]
const rowText = (r: HTMLElement) => (r.querySelector('.asm-cell') as HTMLElement).textContent
/** The drawn row showing instruction `pc`, found by its text since rows are rebuilt on every draw. */
const rowOfPc = (host: HTMLElement, pc: number) => rows(host).find((r) => rowText(r)?.startsWith(`pc${pc}`) === true)
const panel = (host: HTMLElement, name: string) => host.querySelector(`[data-panel="${name}"]`) as HTMLElement
const registers = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('.asm-register')].map((r) => ({
    name: r.querySelector('dt')?.textContent,
    value: r.querySelector('dd')?.textContent,
    said: r.querySelector('dd')?.getAttribute('aria-description') ?? null,
    changed: r.classList.contains('is-changed'),
    unwritten: r.classList.contains('is-unwritten'),
  }))
const lines = (host: HTMLElement, selector: string) =>
  [...host.querySelectorAll<HTMLElement>(`${selector} > li`)].map((li) => li.textContent)

/** A long straight-line program, so the listing has somewhere to scroll: `li r0, #i` 400 times, then `halt`. */
const LONG: AsmProgram = {
  listing: [...Array.from({ length: 400 }, (_, i) => `li\tr0, #${i}`), 'halt'],
  labels: [],
}

// A VIEWPORT AS WIDE AS A VIEW: the default is 414 pixels, narrower than the hosts below, and a real click aimed at the
// middle of a row that runs past the page's edge lands on nothing.
beforeAll(async () => {
  await page.viewport(1280, 1000)
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the asm listing', () => {
  it('draws each label above the instruction it names, and each instruction as pc, mnemonic and operands', () => {
    const { host } = mount(FACT3)
    expect(listing(host).getAttribute('role')).toBe('grid')
    expect(listing(host).getAttribute('aria-rowcount')).toBe('25')
    const drawn = rows(host).map(rowText)
    expect(drawn.slice(0, 3)).toEqual(['pc0jmp skip1', 'fact.0:', 'pc1mov r0, a0'])
    expect(rows(host)[1]?.classList.contains('is-label')).toBe(true)
    expect(rowOfPc(host, 5)?.querySelector('.asm-mnemonic')?.textContent).toBe('jz')
  })

  it('marks the instruction about to run, and says "runs next" in words, not colour alone', () => {
    const { host, pane } = mount(FACT3)
    pane.render(frameOf({ pc: 13, next: 13 }), CONTROLS)
    const next = rowOfPc(host, 13) as HTMLElement
    expect(next.classList.contains('is-next')).toBe(true)
    expect(next.getAttribute('aria-current')).toBe('step')
    const cell = next.querySelector('.asm-cell') as HTMLElement
    expect(getComputedStyle(cell, '::before').content).toBe('"runs next"')
    expect(host.querySelectorAll('.asm-row.is-next')).toHaveLength(1)
  })

  it('marks nothing as running next once the run has ended', () => {
    const { host, pane } = mount(FACT3)
    pane.render(frameOf({ pc: 20, next: null }), CONTROLS)
    expect(host.querySelector('.asm-row.is-next')).toBeNull()
  })

  it('follows the instruction about to run, stops at a user scroll, and follows again on "follow current instruction"', async () => {
    const { host, pane } = mount(LONG)
    const reattach = () => panel(host, 'listing').querySelector('.table-reattach') as HTMLButtonElement
    pane.render(frameOf({ pc: 300, next: 300 }), CONTROLS)
    expect(rowOfPc(host, 300)).toBeDefined()
    expect(reattach().hidden).toBe(true)
    listing(host).scrollTop = 0
    await until(() => !reattach().hidden, 'a user scroll to stop following')
    pane.render(frameOf({ pc: 301, next: 301 }), CONTROLS)
    expect(rowOfPc(host, 301)).toBeUndefined()
    await userEvent.click(reattach())
    expect(reattach().hidden).toBe(true)
    expect(rowOfPc(host, 301)).toBeDefined()
  })

  it('links the instruction a real click lands on, from the focus elsewhere, and a label row links nothing', async () => {
    const linkInstr = vi.fn()
    const { host, pane } = mount(FACT3, events({ linkInstr }))
    pane.render(frameOf({ pc: 0, next: 0 }), CONTROLS)
    const elsewhere = document.createElement('button')
    document.body.prepend(elsewhere)
    elsewhere.focus()
    await userEvent.click(rowOfPc(host, 4) as HTMLElement)
    expect(linkInstr).toHaveBeenCalledExactlyOnceWith(4)
    expect(document.activeElement).toBe(listing(host))
    const label = rows(host).find((r) => rowText(r) === 'else2:') as HTMLElement
    await userEvent.click(label)
    expect(linkInstr).toHaveBeenCalledTimes(1)
  })

  it('links the active instruction on Enter', async () => {
    const linkInstr = vi.fn()
    const { host } = mount(FACT3, events({ linkInstr }))
    listing(host).focus()
    // Row 2 is pc1, under `fact.0`.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(linkInstr).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('marks a link and the running focus on their instructions, and holds a link made elsewhere until the run moves', () => {
    const { host, pane } = mount(LONG)
    pane.render(frameOf({ pc: 0, next: 0 }), CONTROLS)
    pane.setLink([350, 351], true)
    expect(rowOfPc(host, 350)?.classList.contains('is-linked')).toBe(true)
    expect(rowOfPc(host, 351)?.classList.contains('is-linked')).toBe(true)
    pane.render(frameOf({ pc: 0, next: 0 }), CONTROLS)
    expect(rowOfPc(host, 350), 'a redraw of the same step keeps the link in view').toBeDefined()
    pane.setFocus([2])
    pane.render(frameOf({ step: 1, pc: 1, next: 1 }), CONTROLS)
    // The run moved: following the running instruction brought the listing back to the top.
    expect(rowOfPc(host, 2)?.classList.contains('is-focus')).toBe(true)
    expect(rowOfPc(host, 350)).toBeUndefined()
  })

  it('holds a link made elsewhere through a redraw of the same step, and releases it on a new step whose instruction about to run is the same', () => {
    const { host, pane } = mount(LONG)
    pane.render(frameOf({ pc: 0, next: 0 }), CONTROLS)
    pane.setLink([350, 351], true)
    expect(rowOfPc(host, 350)?.classList.contains('is-linked')).toBe(true)
    pane.render(frameOf({ pc: 0, next: 0 }), CONTROLS)
    expect(rowOfPc(host, 350), 'a redraw of the same step keeps the link in view').toBeDefined()
    // A NEW step whose instruction about to run is the same — a jump to itself — still moved the run: the hold is
    // keyed on the step (`AsmPane.#listingRows`'s `frame`), not on the followed row, so following brings the
    // listing back to the top and the linked rows leave the drawn window.
    pane.render(frameOf({ step: 1, pc: 0, next: 0 }), CONTROLS)
    expect(rowOfPc(host, 0)).toBeDefined()
    expect(rowOfPc(host, 350)).toBeUndefined()
  })

  it('clears on a program that is not there', () => {
    const { host, pane } = mount(FACT3)
    pane.setProgram(null)
    expect(rows(host)).toHaveLength(0)
    expect(listing(host).hasAttribute('aria-rowcount')).toBe(false)
  })
})

describe('the registers', () => {
  it('show pc, rr, the arguments and the locals, each word read by its tag', () => {
    const { host, pane } = mount(FACT3)
    pane.render(
      frameOf({
        pc: 7,
        rr: l('2'),
        args: [v('18446744073709551615')],
        locals: [l('0'), b('1')],
        written: [true, true],
      }),
      CONTROLS,
    )
    expect(registers(host).map((r) => [r.name, r.value])).toEqual([
      ['pc', '7'],
      ['rr', '#2'],
      ['a0', '18446744073709551615'],
      ['r0', 'nil'],
      ['r1', 'box #1'],
    ])
  })

  it('mark the register the last instruction wrote, in words as well as by shape', () => {
    const { host, pane } = mount(FACT3)
    pane.render(frameOf({ locals: [v('1'), v('2')], written: [true, true], wrote: 'r1' }), CONTROLS)
    const r1 = registers(host).find((r) => r.name === 'r1')
    expect(r1).toMatchObject({ changed: true, said: 'changed by the last instruction' })
    expect(registers(host).filter((r) => r.changed)).toHaveLength(1)
  })

  it('dim a local the call has not written, mark it ·, and say it is left over from the caller', () => {
    const { host, pane } = mount(FACT3)
    pane.render(frameOf({ depth: 1, locals: [v('3'), v('9')], written: [true, false] }), CONTROLS)
    const r1 = registers(host).find((r) => r.name === '· r1')
    expect(r1).toMatchObject({ unwritten: true, said: 'left over from caller' })
    expect(host.querySelector('.asm-legend')?.textContent).toBe('· left over from caller')
    const r0 = registers(host).find((r) => r.name === 'r0')
    expect(r0).toMatchObject({ unwritten: false, said: null })
  })

  it('say how many registers are past the window', () => {
    const { host, pane } = mount(FACT3)
    pane.render(frameOf({ locals: [v('1')], written: [true], locals_len: 70, args: [v('1')], args_len: 17 }), CONTROLS)
    const notes = [...panel(host, 'registers').querySelectorAll('.asm-note')].map((n) => n.textContent)
    expect(notes).toContain('+69 more locals')
    expect(notes).toContain('+16 more arguments')
  })
})

describe('the call stack', () => {
  it('lists the frames top first, each its function, its return pc and its saved locals, with a count', () => {
    const { host, pane } = mount(FACT3)
    pane.render(
      frameOf({
        depth: 2,
        frames: [
          { ret_pc: 14, saved: [v('2'), v('0')], saved_len: 2 },
          { ret_pc: 20, saved: [v('3')], saved_len: 1 },
        ],
      }),
      CONTROLS,
    )
    expect(panel(host, 'stack').querySelector('.panel-note')?.textContent).toBe('2 frames')
    expect(lines(host, '.asm-stack')).toEqual(['fact.0 → pc14 r0 2 · r1 0', 'fact.0 → pc20 r0 3'])
  })

  it('says how many frames are past the window, and when the run is inside no call', () => {
    const { host, pane } = mount(FACT3)
    pane.render(frameOf({ depth: 12, frames: [{ ret_pc: 14, saved: [], saved_len: 0 }] }), CONTROLS)
    expect(lines(host, '.asm-stack').at(-1)).toBe('+11 more')
    pane.render(frameOf({ depth: 0 }), CONTROLS)
    expect(lines(host, '.asm-stack')).toEqual(['not inside a call'])
    expect(panel(host, 'stack').querySelector('.panel-note')?.textContent).toBe('0 frames')
  })
})

describe('the heap', () => {
  it('lists the cells newest first with the list registers that name them, then the boxes, with a count', () => {
    const { host, pane } = mount(FACT3)
    pane.render(
      frameOf({
        locals: [l('3'), b('1')],
        written: [true, true],
        heap_len: 3,
        cells: [
          { cell: 3, head: v('1'), tail: l('2') },
          { cell: 2, head: v('2'), tail: l('0') },
        ],
        box_len: 1,
        boxes: [{ handle: 1, content: v('7') }],
      }),
      CONTROLS,
    )
    expect(panel(host, 'heap').querySelector('.panel-note')?.textContent).toBe('3 cells · 1 box')
    expect(lines(host, '.asm-heap')).toEqual(['#3 1 → #2 ← r0', '#2 2 → nil', '+1 older', 'box #1 7 ← r1'])
  })

  it('says when it is empty', () => {
    const { host, pane } = mount(FACT3)
    pane.render(frameOf(), CONTROLS)
    expect(lines(host, '.asm-heap')).toEqual(['empty'])
  })
})

describe('the panels', () => {
  it('share the view: the listing two shares, the registers and call stack one side by side, the heap one', () => {
    const { host, pane } = mount(FACT3)
    pane.render(frameOf(), CONTROLS)
    const h = (name: string) => panel(host, name).getBoundingClientRect()
    expect(h('listing').height / h('heap').height).toBeCloseTo(2, 0)
    expect(h('registers').top).toBe(h('stack').top)
    expect(h('registers').height).toBe(h('heap').height)
  })

  it('stack the registers and the call stack when the view is too narrow for both', () => {
    const { host, pane } = mount(FACT3, events(), 900, 400)
    pane.render(frameOf(), CONTROLS)
    expect(panel(host, 'stack').getBoundingClientRect().top).toBeGreaterThan(
      panel(host, 'registers').getBoundingClientRect().top,
    )
  })

  it('report each toggle by name, and open as stored', async () => {
    const panelEvent = vi.fn()
    const host = document.createElement('section')
    host.className = 'pane'
    host.dataset.kind = 'asm'
    host.style.height = '900px'
    document.body.append(host)
    new AsmPane(host, events({ panel: panelEvent }), { heap: false })
    expect(panel(host, 'heap').dataset.open).toBe('false')
    expect(panel(host, 'listing').dataset.open).toBe('true')
    await userEvent.click(panel(host, 'registers').querySelector('.panel-toggle') as HTMLElement)
    expect(panelEvent).toHaveBeenCalledExactlyOnceWith('registers', false)
  })
})

describe('a closed machine panel', () => {
  it('shrinks to its header and lets the open call stack panel take the row', () => {
    const { host, pane } = mount(FACT3, events(), 900, 1000, { registers: false })
    pane.render(frameOf(), CONTROLS)
    const registersPanel = panel(host, 'registers')
    const stackPanel = panel(host, 'stack')
    // Precondition: registers closed, call stack open.
    expect(registersPanel.dataset.open).toBe('false')
    expect(stackPanel.dataset.open).toBe('true')
    const machine = registersPanel.parentElement as HTMLElement
    const header = registersPanel.querySelector('.panel-header') as HTMLElement
    expect(registersPanel.getBoundingClientRect().height).toBe(header.getBoundingClientRect().height)
    expect(stackPanel.getBoundingClientRect().width).toBeGreaterThan(machine.getBoundingClientRect().width * 0.8)
  })

  it('leaves the machine row no taller than the two headers when both panels are closed, and grows the listing', () => {
    const { host: openHost, pane: openPane } = mount(FACT3)
    openPane.render(frameOf(), CONTROLS)
    const openListingHeight = panel(openHost, 'listing').getBoundingClientRect().height

    const { host, pane } = mount(FACT3, events(), 900, 1000, { registers: false, stack: false })
    pane.render(frameOf(), CONTROLS)
    const registersPanel = panel(host, 'registers')
    const stackPanel = panel(host, 'stack')
    // Precondition: both machine panels closed.
    expect(registersPanel.dataset.open).toBe('false')
    expect(stackPanel.dataset.open).toBe('false')
    const machine = registersPanel.parentElement as HTMLElement
    const headerHeights = [registersPanel, stackPanel].map(
      (p) => (p.querySelector('.panel-header') as HTMLElement).getBoundingClientRect().height,
    )
    expect(machine.getBoundingClientRect().height).toBeLessThanOrEqual(Math.max(...headerHeights) + 1)
    // Neither closed panel takes a share of the row's width either: each stays far short of half the row,
    // rather than splitting it with its equally-closed sibling.
    const machineWidth = machine.getBoundingClientRect().width
    expect(registersPanel.getBoundingClientRect().width).toBeLessThan(machineWidth * 0.3)
    expect(stackPanel.getBoundingClientRect().width).toBeLessThan(machineWidth * 0.3)
    expect(panel(host, 'listing').getBoundingClientRect().height).toBeGreaterThan(openListingHeight)
  })

  it('restores the side-by-side split on re-opening', async () => {
    const { host, pane } = mount(FACT3, events(), 900, 1000, { registers: false })
    pane.render(frameOf(), CONTROLS)
    const registersPanel = panel(host, 'registers')
    // Precondition: registers starts closed.
    expect(registersPanel.dataset.open).toBe('false')
    await userEvent.click(registersPanel.querySelector('.panel-toggle') as HTMLElement)
    expect(registersPanel.dataset.open).toBe('true')
    const stackPanel = panel(host, 'stack')
    expect(registersPanel.getBoundingClientRect().top).toBe(stackPanel.getBoundingClientRect().top)
    expect(registersPanel.getBoundingClientRect().height).toBe(stackPanel.getBoundingClientRect().height)
  })
})

describe('at the width of a real view', () => {
  it('lays out at 1280 by 800 without a horizontal scroll', async () => {
    await page.viewport(1280, 800)
    const { host, pane } = mount(FACT3, events(), 780, 620)
    pane.render(frameOf({ depth: 1, locals: [v('1'), v('2')], written: [true, false], pc: 4, next: 4 }), CONTROLS)
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth)
  })
})

describe('edit a copy', () => {
  const item = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button.detach')

  it('is offered for the program, disabled with a reason where its text is withheld, and absent with nothing to copy', () => {
    const { host, pane } = mount(FACT3, events({ detachAsm: vi.fn() }))
    pane.setForkAvailable('result Nat\n\n    halt\n', 21)
    expect(item(host)?.disabled).toBe(false)
    // A PROGRAM WHOSE TEXT WAS WITHHELD HAS NO TEXT TO POST, AND THE REFUSAL SAYS HOW LARGE IT IS.
    pane.setForkAvailable(null, 300_000)
    expect(item(host)?.disabled).toBe(true)
    expect(item(host)?.getAttribute('aria-description')).toBe('300,000 instructions — too large to open in an editor')
    pane.setForkAvailable(null, 0)
    expect(item(host)).toBeNull()
  })

  it('is withdrawn from a view on a copy', () => {
    const { host, pane } = mount(FACT3, events({ detachAsm: vi.fn() }))
    pane.setForkAvailable('result Nat\n\n    halt\n', 21)
    pane.setDetached(true)
    expect(item(host)).toBeNull()
  })
})
