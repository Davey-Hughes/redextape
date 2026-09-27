import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { OVERSCAN, ROW_HEIGHT, TmPane } from '../../src/tm-pane'
import { SHELL, until } from './harness'

/**
 * The rule table as a grid, and as a share of its view's height — Plan 7 part 4, spec §9.1 and §9.2
 * (accessibility items 3 and 4).
 *
 * THE SAMPLE'S TABLE IS TALLER THAN THE VIEW, which is what the key cases need: End has to move the active row
 * to a row the first draw did not render, so the window has to scroll to draw it.
 */

let view: EditorView

const SAMPLE = 'let x = 40; x + 2'

const pane = () => document.querySelector('[data-leaf="tm-0"]') as HTMLElement
const grid = () => pane().querySelector('.state-table') as HTMLElement
const rows = () => [...pane().querySelectorAll<HTMLElement>('.state-row')]
const rowCount = () => Number(grid().getAttribute('aria-rowcount'))
/** The row `aria-activedescendant` names, by its 0-based index over the whole table. */
const activeIndex = () => {
  const id = grid().getAttribute('aria-activedescendant')
  const cell = id === null ? null : document.getElementById(id)
  return cell === null ? null : Number(cell.closest('[role="row"]')?.getAttribute('aria-rowindex')) - 1
}
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
const stepButton = (label: string) =>
  [...pane().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)

async function settled(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(
    () =>
      document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
      (document.querySelector('#results')?.textContent ?? '') !== '',
    'the app to settle',
  )
  await until(() => rows().length > 0, 'the rule table to draw')
}

// ONE MOUNT FOR THE FILE, outside both blocks, so either runs alone under `-t`.
beforeAll(async () => {
  // TALL ENOUGH THAT THE TM VIEW HAS ROOM ABOVE ITS PANELS' FLOORS, EVEN WITH A COPY'S EDITOR OPEN: the sharing
  // is only visible there. At 1600 the copy's editor and five tapes left both panels on their floors.
  await page.viewport(1280, 2400)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await settled(SAMPLE)
})

describe('the rule table as a grid', () => {
  it('is one tab stop, counted over the whole table, with one cell per row', () => {
    expect(grid().getAttribute('role')).toBe('grid')
    expect(grid().tabIndex).toBe(0)
    // The count is the whole table's, not the drawn window's: the spacer carries the same number in pixels.
    const spacer = pane().querySelector('.state-spacer') as HTMLElement
    expect(rowCount() * ROW_HEIGHT).toBe(Number.parseFloat(spacer.style.height))
    expect(rows().length).toBeLessThan(rowCount())
    for (const row of rows()) {
      expect(row.getAttribute('role')).toBe('row')
      const cells = row.querySelectorAll('[role="gridcell"]')
      expect(cells).toHaveLength(1)
      // `aria-rowindex` is 1-based, and a cell's id ends in the row's 0-based index.
      expect(cells[0]?.id.endsWith(`-${Number(row.getAttribute('aria-rowindex')) - 1}`)).toBe(true)
    }
  })

  it('says which state is current and which rule fires next', async () => {
    // At the frontier the machine sits in `halt`, where no rule fires; one step back is the rule into it.
    stepButton('◀')?.click()
    await until(() => pane().querySelector('.state-row.is-next') !== null, 'a rule to be about to fire')
    const current = grid().querySelectorAll('[aria-current="step"]')
    expect(current).toHaveLength(1)
    expect(current[0]?.classList.contains('is-current')).toBe(true)
    const next = pane().querySelector('.state-row.is-next > [role="gridcell"]') as HTMLElement
    expect(next.dataset.marks).toBe('fires next')
    // THE WORDS ARE READ, AND ARE NOT THE ROW'S TEXT: generated content carries them.
    expect(getComputedStyle(next, '::before').content).toBe('"fires next"')
    expect(next.textContent).not.toContain('fires next')
  })

  it('moves the active row by index, past the rows the table has drawn', async () => {
    grid().focus()
    await userEvent.keyboard('{End}')
    const last = rowCount() - 1
    expect(activeIndex()).toBe(last)
    // The window scrolled to draw it: the first row drawn is no longer the table's first.
    expect(Number(rows()[0]?.getAttribute('aria-rowindex'))).toBeGreaterThan(1)
    await userEvent.keyboard('{Home}')
    expect(activeIndex()).toBe(0)
    await userEvent.keyboard('{ArrowDown}')
    expect(activeIndex()).toBe(1)
    await userEvent.keyboard('{PageDown}')
    const paged = activeIndex() ?? 0
    expect(paged).toBeGreaterThan(2)
    await userEvent.keyboard('{PageUp}')
    expect(activeIndex()).toBe(1)
    // Keys that scrolled took the table off the machine: following is detached, and its control offered.
    const reattach = pane().querySelector('.table-reattach') as HTMLElement
    expect(reattach.hidden).toBe(false)
    // Following again scrolls the view back to the current state, near the table's top, and an active row left
    // at the far end comes with it: still named, so still a row the table has drawn.
    await userEvent.keyboard('{End}')
    reattach.click()
    const now = activeIndex()
    expect(now).not.toBeNull()
    expect(now).toBeLessThan(last)
  })

  it("links the active row's state on Enter, as a click does", async () => {
    // `pc0`, the first state the program owns: the table opens on `halt` and `overflow`, which belong to no
    // construct and so link nothing.
    grid().focus()
    await userEvent.keyboard('{Home}')
    const pc0 = rows().find((r) => r.textContent === 'pc0') as HTMLElement
    const at = Number(pc0.getAttribute('aria-rowindex')) - 1
    for (let i = 0; i < at; i += 1) await userEvent.keyboard('{ArrowDown}')
    expect(activeIndex()).toBe(at)
    expect(pane().querySelector('.state-row.is-linked')).toBeNull()
    await userEvent.keyboard('{Enter}')
    await until(() => pane().querySelector('.state-row.is-linked') !== null, 'the state to be linked')
    expect(
      pane()
        .querySelector(`[aria-rowindex="${at + 1}"]`)
        ?.classList.contains('is-linked'),
    ).toBe(true)
  })
})

describe('the tapes (spec §9.3)', () => {
  it('are labelled groups that say where each head is and what it reads', () => {
    const tapes = [...pane().querySelectorAll<HTMLElement>('.tape')]
    expect(tapes).toHaveLength(5)
    for (const tape of tapes) {
      expect(tape.getAttribute('role')).toBe('group')
      const name = tape.querySelector('.tape-label')?.textContent
      const head = tape.querySelector('.cell.head')?.textContent
      const said = head === '_' ? 'blank' : head
      expect(tape.getAttribute('aria-label')).toMatch(new RegExp(`^tape ${name}, head at cell \\d+, reading ${said}$`))
    }
  })
})

describe("the rule table's height is its view's (spec §9.1)", () => {
  it('shares the view with the state diagram, two to one, and fills it', () => {
    // No `max-height` of its own: the view's flex layout is what bounds it.
    expect(getComputedStyle(grid()).maxHeight).toBe('none')
    const diagram = pane().querySelector('[data-panel="diagram"]') as HTMLElement
    // The last open panel runs to the view's bottom edge, and the view does not scroll.
    expect(Math.abs(pane().getBoundingClientRect().bottom - diagram.getBoundingClientRect().bottom)).toBeLessThan(2)
    expect(pane().scrollHeight).toBeLessThanOrEqual(pane().clientHeight + 1)
    const ratio =
      grid().getBoundingClientRect().height /
      (diagram.querySelector('.state-diagram') as HTMLElement).getBoundingClientRect().height
    expect(ratio).toBeGreaterThan(1.6)
    expect(ratio).toBeLessThan(2.4)
    // And every row the table shows is drawn: the rows reach the table's own bottom edge.
    const drawn = rows().at(-1)?.getBoundingClientRect().bottom ?? 0
    expect(drawn).toBeGreaterThanOrEqual(grid().getBoundingClientRect().bottom - 1)
  })

  it('gives the outline one share beside them, and redraws the rows when its share changes', async () => {
    // Following, to begin with: the keys above took the table off the machine.
    const reattach = pane().querySelector('.table-reattach') as HTMLElement
    if (!reattach.hidden) reattach.click()
    pane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => pane().querySelector('.term-editor') !== null, 'the copy to mount its editor')
    const outline = pane().querySelector('[data-panel="outline"]') as HTMLElement
    await until(() => !outline.hidden, 'the outline to appear with the editor')
    await until(() => rows().length > 0, 'the copy to draw its table')
    const tableBefore = grid().getBoundingClientRect().height
    const bottom = () => grid().getBoundingClientRect().bottom
    const lastRow = () => rows().at(-1)?.getBoundingClientRect().bottom ?? 0
    // **EVERY OTHER WAY IN TO THE TABLE'S DRAW IS HELD WHILE THE SHARES CHANGE** — `render`, `setLink` and
    // `setProgram`, the pane's public callers of it — so the rows can follow the table only through its resize
    // observer. A copy's value run renders the view on its own schedule, and a panel's toggle moves the focus
    // and with it the link; each drew the rows for whatever height the table had then, and this passed with no
    // observer at all, polled and then with `render` alone held.
    const { render, setLink, setProgram } = TmPane.prototype
    Object.assign(TmPane.prototype, { render: () => undefined, setLink: () => undefined, setProgram: () => undefined })
    try {
      outline.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click()
      await until(() => grid().getBoundingClientRect().height < tableBefore, 'the table to give up a share')
      await frame()
      await frame()
      const table = grid().getBoundingClientRect().height
      const list = (outline.querySelector('.outline') as HTMLElement).getBoundingClientRect().height
      // Two shares against one of the space the headers leave; the headers are why it is not exactly 2.
      expect(table / list).toBeGreaterThan(1.6)
      expect(table / list).toBeLessThan(2.4)
      // THE CHECK BELOW HOLDS ONLY IF THE ROWS DO NOT ALREADY COVER THE GROWTH. `visibleWindow` draws `OVERSCAN`
      // rows past the last row seen, so a window drawn for the smaller table ends less than `OVERSCAN + 2` rows
      // below its edge; rows left over from the larger table would reach past it, and no draw could be seen.
      expect(lastRow()).toBeLessThan(bottom() + (OVERSCAN + 2) * ROW_HEIGHT)
      // Closing the outline hands its share back, and the rows drawn follow the table down to its new bottom
      // edge within the frame that resized it — not polled, two frames on.
      outline.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click()
      await frame()
      await frame()
      expect(grid().getBoundingClientRect().height).toBeGreaterThan(table)
      expect(lastRow()).toBeGreaterThanOrEqual(bottom() - 1)
    } finally {
      Object.assign(TmPane.prototype, { render, setLink, setProgram })
    }
    // AND STILL FOLLOWING: the table grew, the draw moved its scroll to keep the current row centred, and that
    // write's own `scroll` event is not the user taking control. Nothing clamps here, the rows running far past
    // the table's end; `tm-follow-clamp.test.ts` holds a clamp.
    await frame()
    expect(reattach.hidden).toBe(true)
  })
})
