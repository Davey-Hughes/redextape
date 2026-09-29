import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { ROW_HEIGHT } from '../../src/state-table'
import { type GridOptions, type GridRows, OVERSCAN, VirtualGrid } from '../../src/virtual-grid'
import type { VisibleWindow } from '../../src/virtual-list'
import { until } from './harness'

/**
 * `VirtualGrid` on its own, with nothing of a view around it: the contract the TM rule table and the asm listing both
 * draw on. The rule table's own suites (`tm-grid`, `tm-pointer`, `tm-follow-clamp`, `app`) hold the same behaviour
 * through a real view; these hold it where a second view could not quietly depend on the first view's wiring.
 *
 * **THE ROW CLASSES ARE THE RULE TABLE'S**, so `style.css`'s `.state-row` height — which must equal `ROW_HEIGHT` —
 * applies here as it does there. The box's height is set inline: no view's flex layout bounds it.
 */

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
/**
 * The next `scroll` event on `el`, once the grid's own listener — registered first, in its constructor — has run.
 * **AWAITED RATHER THAN COUNTING FRAMES**: a scroll's event came later than two frames when the whole file ran, so an
 * assertion after two frames could run before the event it was about, and pass whatever the handler would have done.
 */
const scrolled = (el: HTMLElement) => new Promise<void>((r) => el.addEventListener('scroll', () => r(), { once: true }))
/**
 * The next report of `el`'s size, and a frame after it, so every observer's callback in that delivery has run — the
 * grid's own among them. **NOT A FRAME COUNT**: a delivery comes after the frame's animation callbacks, so an await on
 * a scroll and a frame resolves before the resize reported in that same frame.
 */
const resized = (el: HTMLElement) =>
  new Promise<void>((r) => {
    const o = new ResizeObserver(() => {
      o.disconnect()
      requestAnimationFrame(() => r())
    })
    o.observe(el)
  })

type Made = {
  grid: VirtualGrid
  activate: ReturnType<typeof vi.fn>
  set(next: { count?: number | null; follow?: number | null; frame?: number | null; open?: boolean }): void
}

/** What a case can add to `make`'s grid: the options only some views give, and a fill of its own. */
type Extra = Pick<GridOptions, 'enter' | 'afterDraw' | 'shrinks'> & { readonly fill?: GridRows['fill'] }

/**
 * A grid of `count` rows, each reading `row N`, in a box `height` pixels tall, attached to the page and drawn
 * once. `frame` starts at `0`, an arbitrary but fixed step — every test that does not change it draws the same
 * frame throughout, and the ones proving the hold's new rule (`virtual-grid.ts`'s `GridRows.frame`, amendment 21)
 * move it explicitly.
 */
function make(count: number | null, height = 240, extra: Extra = {}): Made {
  const { fill, ...options } = extra
  let state = { count, follow: null as number | null, frame: 0 as number | null, open: true }
  const activate = vi.fn()
  const grid = new VirtualGrid({
    classes: { box: 'state-table', spacer: 'state-spacer', rows: 'state-rows', row: 'state-row' },
    idPrefix: 'g',
    isOpen: () => state.open,
    rows: () => ({
      count: state.count,
      follow: state.follow,
      frame: state.frame,
      fill:
        fill ??
        ((i, _row, cell) => {
          cell.className = 'state-cell'
          cell.textContent = `row ${i}`
        }),
    }),
    activate,
    ...options,
  })
  grid.el.style.height = `${height}px`
  document.body.append(grid.el)
  grid.draw()
  return {
    grid,
    activate,
    set(next) {
      state = { ...state, ...next }
    },
  }
}

const drawn = (g: VirtualGrid) => [...g.el.querySelectorAll<HTMLElement>('[role="row"]')]
const indexOf = (row: HTMLElement) => Number(row.getAttribute('aria-rowindex')) - 1
/** The scrollTop that centres `row` in a box of `height` over `count` rows — `centredScrollTop`'s arithmetic. */
const centred = (row: number, height: number, count: number) =>
  Math.max(0, Math.min(row * ROW_HEIGHT - Math.floor(height / 2) + ROW_HEIGHT / 2, count * ROW_HEIGHT - height))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('a virtual grid', () => {
  it('draws only the rows in view, counts all of them, and names its active row', () => {
    const { grid } = make(1000)
    expect(grid.el.getAttribute('role')).toBe('grid')
    expect(grid.el.getAttribute('aria-rowcount')).toBe('1000')
    const rows = drawn(grid)
    expect(rows.length).toBeLessThanOrEqual(Math.ceil(240 / ROW_HEIGHT) + 1 + 2 * OVERSCAN)
    expect(rows[0]?.getAttribute('aria-rowindex')).toBe('1')
    expect(rows[0]?.querySelector('[role="gridcell"]')?.id).toBe('g-0')
    expect(grid.el.getAttribute('aria-activedescendant')).toBe('g-0')
    expect(rows[0]?.classList.contains('is-active')).toBe(true)
  })

  it('clears itself for no content at all', () => {
    const made = make(10)
    made.set({ count: null })
    made.grid.draw()
    expect(drawn(made.grid)).toHaveLength(0)
    expect(made.grid.el.hasAttribute('aria-rowcount')).toBe(false)
    expect(made.grid.el.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('moves the active row by index with the keys, past the drawn window, and scrolls so it is drawn', async () => {
    const { grid } = make(1000)
    grid.el.focus()
    await userEvent.keyboard('{End}')
    expect(grid.el.getAttribute('aria-activedescendant')).toBe('g-999')
    expect(document.getElementById('g-999')).not.toBeNull()
    await userEvent.keyboard('{Home}')
    expect(grid.el.getAttribute('aria-activedescendant')).toBe('g-0')
    await userEvent.keyboard('{PageDown}')
    // A page is the whole rows in view less one: 240 / 24 = 10, so 9.
    expect(grid.el.getAttribute('aria-activedescendant')).toBe('g-9')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
    expect(grid.el.getAttribute('aria-activedescendant')).toBe('g-10')
    await userEvent.keyboard('{PageUp}')
    expect(grid.el.getAttribute('aria-activedescendant')).toBe('g-1')
  })

  it('activates the active row on Enter', async () => {
    const { grid, activate } = make(1000)
    grid.el.focus()
    await userEvent.keyboard('{End}{Enter}')
    expect(activate).toHaveBeenCalledExactlyOnceWith(999)
  })

  it('activates the row a real click lands on, once, from the focus elsewhere, and keeps the focus', async () => {
    const { grid, activate } = make(1000)
    // THE VIEW'S REDRAW ON TAKING THE FOCUS, which every view around a grid has (its `draw()` runs on a focus change):
    // a draw replaces every row, so a row focused on `mousedown` would be gone before `mouseup`.
    grid.el.addEventListener('focus', () => grid.draw())
    const elsewhere = document.createElement('button')
    document.body.prepend(elsewhere)
    elsewhere.focus()
    grid.el.scrollTop = 400 * ROW_HEIGHT
    await until(() => indexOf(drawn(grid)[0] as HTMLElement) > 300, 'the grid to scroll')
    const row = drawn(grid)[OVERSCAN + 2] as HTMLElement
    const at = indexOf(row)
    await userEvent.click(row)
    expect(activate).toHaveBeenCalledExactlyOnceWith(at)
    expect(document.activeElement).toBe(grid.el)
    expect(grid.el.getAttribute('aria-activedescendant')).toBe(`g-${at}`)
  })

  it('centres the row it follows, stops at a scroll of the user’s, and follows again on attach', async () => {
    const made = make(1000)
    made.set({ follow: 500 })
    made.grid.draw()
    expect(made.grid.el.scrollTop).toBe(centred(500, 240, 1000))
    expect(made.grid.following).toBe(true)
    made.grid.el.scrollTop = 0
    await until(() => !made.grid.following, 'a user scroll to detach following')
    made.grid.draw()
    expect(made.grid.el.scrollTop).toBe(0)
    made.grid.attach()
    expect(made.grid.following).toBe(true)
    expect(made.grid.el.scrollTop).toBe(centred(500, 240, 1000))
  })

  it('stops following on a key that scrolls, before the draw that key causes', async () => {
    const made = make(1000)
    made.set({ follow: 500 })
    made.grid.draw()
    made.grid.el.focus()
    await userEvent.keyboard('{Home}')
    expect(made.grid.following).toBe(false)
    expect(made.grid.el.scrollTop).toBe(0)
    made.grid.draw()
    expect(made.grid.el.scrollTop).toBe(0)
  })

  /**
   * THE LINK'S ROW STAYS UNTIL THE RUN MOVES — AND "MOVES" MEANS A NEW FRAME, NOT A NEW FOLLOW ROW (amendment 21).
   * The scroll's own event redraws the box, and a link that won only the draw that wrote it lost that redraw to
   * following, a frame later: a link made while the grid followed never showed its rows. The event is awaited,
   * so the assertions after it see what that redraw did.
   *
   * THE SELF-LOOP CASE IS WHY THE HOLD IS KEYED ON THE FRAME. The TM rule table's follow row is the current
   * state's own header, and a step that loops in its state — the ordinary case in a compiled machine — leaves that
   * row exactly where it was. A hold keyed on the row instead of the frame would still be reading `follow: 500`
   * after such a step and never release, which is exactly what `set({ frame: 1 })` below, with `follow` left at
   * 500, reproduces.
   */
  it("holds a link's row over following through the scroll's own event, until the frame it draws changes", async () => {
    const made = make(1000)
    made.set({ follow: 500 })
    made.grid.draw()
    made.grid.scrollToRow(10)
    const echo = scrolled(made.grid.el)
    made.grid.draw()
    expect(made.grid.el.scrollTop).toBe(centred(10, 240, 1000))
    await echo
    expect(made.grid.el.scrollTop, "the scroll's own redraw keeps the link's row").toBe(centred(10, 240, 1000))
    expect(made.grid.following, 'and following is still on').toBe(true)
    made.grid.draw()
    expect(made.grid.el.scrollTop, 'as does any redraw of the same frame').toBe(centred(10, 240, 1000))
    // A NEW FRAME, THE SAME FOLLOW ROW — the self-loop case a keyed-on-`follow` hold cannot see move.
    made.set({ frame: 1 })
    made.grid.draw()
    expect(
      made.grid.el.scrollTop,
      'a new frame brings following back, even though the row it follows has not moved',
    ).toBe(centred(500, 240, 1000))
  })

  it('follows the new content after reset, though a link held the box against the same frame', () => {
    const made = make(1000)
    made.set({ follow: 500 })
    made.grid.draw()
    made.grid.scrollToRow(10)
    made.grid.draw()
    made.grid.reset()
    made.grid.draw()
    expect(made.grid.el.scrollTop).toBe(centred(500, 240, 1000))
  })

  it('follows again on attach after a link, though the frame it draws has not changed', async () => {
    const made = make(1000)
    made.set({ follow: 500 })
    made.grid.draw()
    made.grid.scrollToRow(10)
    made.grid.draw()
    made.grid.el.scrollTop = 0
    await until(() => !made.grid.following, 'a user scroll to detach following')
    made.grid.attach()
    expect(made.grid.el.scrollTop).toBe(centred(500, 240, 1000))
  })

  /**
   * A LINK MADE WHILE THE BOX IS OFF THE PAGE — every view Stage is not showing, which each link made in another view
   * reaches. The box reports a height of 0 there, so the link's own draw can neither centre the row nor say which
   * frame the view will show when it comes back; the first draw on the page does both. The frame does not change in
   * between, as it does not for a run at rest, which is the case a hold keyed on the view's last frame outlived.
   */
  it('centres a link made off the page at the first draw on it, and holds it against the frame that draw shows', async () => {
    const made = make(1000)
    made.set({ follow: 500 })
    made.grid.draw()
    expect(made.grid.el.scrollTop, 'following placed the box before the link').toBe(centred(500, 240, 1000))
    made.grid.el.remove()
    made.grid.scrollToRow(10)
    made.grid.draw()
    document.body.append(made.grid.el)
    const echo = scrolled(made.grid.el)
    made.grid.draw()
    expect(made.grid.el.scrollTop, "the first draw on the page centres the link's row").toBe(centred(10, 240, 1000))
    await echo
    await frame()
    expect(made.grid.el.scrollTop, 'and holds it through its own scroll').toBe(centred(10, 240, 1000))
    const report = resized(made.grid.el)
    made.grid.el.style.height = '200px'
    await report
    expect(made.grid.el.scrollTop, 'and through a resize').toBe(centred(10, 240, 1000))
    expect(made.grid.following).toBe(true)
    made.set({ frame: 1 })
    made.grid.draw()
    expect(made.grid.el.scrollTop, 'the run moving brings following back').toBe(centred(500, 200, 1000))
  })

  it('gives the box back to following when a link is released, and leaves a detached grid where it was', async () => {
    const made = make(1000)
    made.set({ follow: 500 })
    made.grid.draw()
    made.grid.scrollToRow(10)
    made.grid.draw()
    expect(made.grid.el.scrollTop, 'the link holds the box').toBe(centred(10, 240, 1000))
    made.grid.release()
    made.grid.draw()
    expect(made.grid.el.scrollTop, 'released, on the same frame').toBe(centred(500, 240, 1000))
    expect(made.grid.following).toBe(true)

    // THE GRID'S RESIZE OBSERVER REPORTS ONCE AFTER IT IS MADE, and its draw, still following and no longer held,
    // scrolls back to the followed row: a user scroll made before that report can be undone by it before its own
    // event arrives, which then reads as the echo of that draw. Two frames let the report go by.
    await frame()
    await frame()
    made.grid.el.scrollTop = 0
    await until(() => !made.grid.following, 'a user scroll to detach following')
    made.grid.scrollToRow(10)
    made.grid.draw()
    made.grid.release()
    made.grid.draw()
    expect(made.grid.el.scrollTop, 'a release is not a re-attach').toBe(centred(10, 240, 1000))
    expect(made.grid.following).toBe(false)
  })

  it('goes back to the top, following, with the first row active, on reset', async () => {
    const made = make(1000)
    made.grid.el.focus()
    await userEvent.keyboard('{End}')
    expect(made.grid.following).toBe(false)
    const echo = scrolled(made.grid.el)
    made.grid.reset()
    made.grid.draw()
    expect(made.grid.el.scrollTop).toBe(0)
    expect(made.grid.el.getAttribute('aria-activedescendant')).toBe('g-0')
    await echo
    // The reset's own scroll was recorded before it was written, so its echo did not detach following.
    expect(made.grid.following).toBe(true)
  })

  it('reads no scroll as the user’s while its panel is closed', async () => {
    const made = make(1000)
    made.set({ follow: 500 })
    made.grid.draw()
    // A SCROLL EVENT ARRIVING WHILE THE PANEL IS CLOSED. In the app it is the late echo of a draw's own write, landing
    // on a box the panel has hidden, where `scrollTop` reads 0. A hidden box here would drop the event, so the box
    // stays shown and only the panel says it is closed; the write below is far from what following expects, and would
    // read as the user's if the grid listened.
    made.set({ open: false })
    const event = scrolled(made.grid.el)
    made.grid.el.scrollTop = 0
    await event
    expect(made.grid.el.scrollTop).toBe(0)
    expect(made.grid.following).toBe(true)
    made.set({ open: true })
    made.grid.draw()
    expect(made.grid.el.scrollTop).toBe(centred(500, 240, 1000))
  })

  it('keeps following when it grows and its scroll is clamped', async () => {
    const made = make(1000)
    made.set({ follow: 999 })
    made.grid.draw()
    expect(made.grid.el.scrollTop).toBe(1000 * ROW_HEIGHT - 240)
    const clamp = scrolled(made.grid.el)
    made.grid.el.style.height = '600px'
    await clamp
    await frame()
    await frame()
    expect(made.grid.el.scrollTop).toBe(1000 * ROW_HEIGHT - 600)
    expect(made.grid.following).toBe(true)
  })

  it("hands Enter to the view's enter when it gives one, and a click still to activate", async () => {
    const enter = vi.fn()
    const { grid, activate } = make(1000, 240, { enter })
    grid.el.focus()
    await userEvent.keyboard('{End}{Enter}')
    expect(enter).toHaveBeenCalledExactlyOnceWith(999)
    expect(activate).not.toHaveBeenCalled()
    const row = drawn(grid)[OVERSCAN + 2] as HTMLElement
    const at = indexOf(row)
    await userEvent.click(row)
    expect(activate).toHaveBeenCalledExactlyOnceWith(at)
    expect(enter).toHaveBeenCalledOnce()
  })

  it('makes the row the view names the active one, and says which it is', () => {
    const made = make(1000)
    expect(made.grid.active).toBe(0)
    made.grid.setActive(5)
    expect(made.grid.active).toBe(5)
    made.grid.draw()
    expect(made.grid.el.getAttribute('aria-activedescendant')).toBe('g-5')
    expect(
      drawn(made.grid)
        .find((r) => indexOf(r) === 5)
        ?.classList.contains('is-active'),
    ).toBe(true)
  })

  /**
   * A GRID OF NO ROWS HAS AN ACTIVE ROW OF 0, NOT -1: `count - 1` bounds it, and a view that reads `active` as an
   * index — the state diagram's, finding its row again — would read before the first row.
   */
  it('keeps its active row at 0 with no rows to draw', () => {
    const made = make(0)
    expect(made.grid.el.getAttribute('aria-rowcount')).toBe('0')
    expect(made.grid.active).toBe(0)
  })

  it('takes its rows and its active descendant out on clear, though its panel is closed', () => {
    const made = make(1000)
    expect(drawn(made.grid).length, 'rows drawn').toBeGreaterThan(0)
    expect(made.grid.el.hasAttribute('aria-activedescendant')).toBe(true)
    made.set({ open: false, count: 0 })
    made.grid.draw()
    expect(drawn(made.grid).length, 'a closed draw leaves them').toBeGreaterThan(0)
    made.grid.clear()
    expect(drawn(made.grid)).toHaveLength(0)
    expect(made.grid.el.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it("keeps the role a view's fill gives a cell", () => {
    const { grid } = make(10, 240, {
      fill: (i, _row, cell) => {
        cell.textContent = `row ${i}`
        if (i === 0) cell.setAttribute('role', 'rowheader')
      },
    })
    const roles = drawn(grid).map((r) => r.firstElementChild?.getAttribute('role'))
    expect(roles.slice(0, 2)).toEqual(['rowheader', 'gridcell'])
  })

  /**
   * THE HOOK SEES THE ROWS IT IS TOLD OF: it runs once they are in the DOM, so a view drawing beside them — the state
   * diagram's gutter of arcs — draws against the rows on screen, not the last draw's. A draw that lays no rows out,
   * closed or of no content, calls nothing.
   */
  it('tells the view the window each draw laid out, once its rows are in, and nothing for a draw that lays none', () => {
    const calls: { window: VisibleWindow; rows: number[] }[] = []
    const rows = () => [...document.querySelectorAll<HTMLElement>('[role="row"]')].map(indexOf)
    const made = make(1000, 240, { afterDraw: (w) => calls.push({ window: w, rows: rows() }) })
    made.set({ follow: 500 })
    made.grid.draw()
    const last = calls.at(-1)
    expect(last?.rows[0]).toBe(last?.window.firstIndex)
    expect(last?.rows.at(-1)).toBe(last?.window.lastIndex)
    expect(last?.window.firstIndex).toBeGreaterThan(400)
    expect(last?.window.offsetY).toBe((last?.window.firstIndex ?? -1) * ROW_HEIGHT)
    const made1 = calls.length
    made.set({ open: false })
    made.grid.draw()
    made.set({ open: true, count: null })
    made.grid.draw()
    expect(calls).toHaveLength(made1)
  })

  /**
   * A GRID THAT LOSES A ROW UNDER ITS SCROLL: the state diagram's, whose sub-steps row goes as the run steps into a
   * routine with no row, `follow` becoming `null` (`fact(3)`'s `pc20` into `halt`). Here, as there, something beside
   * the rows holds the scroll range up until `afterDraw` resizes it — a gutter the height of the drawn window — so the
   * browser clamps only after the draw has returned, and neither `scrollTop` nor the rows swapped in show it before.
   */
  it('keeps following when it loses a row under the scroll and a gutter holds the range until after the draw', async () => {
    const gutter = document.createElement('div')
    gutter.style.position = 'absolute'
    gutter.style.width = '4px'
    const made = make(1000, 240, {
      shrinks: true,
      afterDraw: (w) => {
        gutter.style.top = `${w.offsetY}px`
        gutter.style.height = `${(w.lastIndex - w.firstIndex + 1) * ROW_HEIGHT}px`
      },
    })
    made.grid.rowsEl.before(gutter)
    made.set({ follow: 999 })
    const echo = scrolled(made.grid.el)
    made.grid.draw()
    await echo
    // The resize observer's first report, for the reason the release case above waits for it.
    await frame()
    await frame()
    expect(made.grid.el.scrollTop).toBe(1000 * ROW_HEIGHT - 240)
    const clamp = scrolled(made.grid.el)
    made.set({ count: 999, follow: null })
    made.grid.draw()
    await clamp
    await frame()
    expect(made.grid.el.scrollTop, 'the browser clamped').toBe(999 * ROW_HEIGHT - 240)
    expect(made.grid.following, 'and that was not the user scrolling').toBe(true)
  })

  /**
   * THE BROWSER'S CLAMP, NOT THE PREDICTED ONE, WHEN THE LAST ROW OVERFLOWS THE SPACER. The grid predicts the clamp
   * from `ROW_HEIGHT`, and a last row taller than that — here by 16 px, past `ECHO_TOLERANCE`'s 12 — makes the
   * browser's position 16 px further down. The old rows hold the range up until they are swapped, so the draw can
   * read the real position there, before the clamp's `scroll` arrives.
   */
  it('keeps following when it loses a row under the scroll and its last row overflows the spacer', async () => {
    let count = 1000
    const made = make(count, 240, {
      shrinks: true,
      fill: (i, row, cell) => {
        cell.textContent = `row ${i}`
        if (i === count - 1) row.style.height = `${ROW_HEIGHT + 16}px`
      },
    })
    made.set({ follow: 999 })
    const echo = scrolled(made.grid.el)
    made.grid.draw()
    await echo
    await frame()
    await frame()
    const clamp = scrolled(made.grid.el)
    count = 999
    made.set({ count, follow: null })
    made.grid.draw()
    // THE BROWSER'S POSITION, read by the draw once the rows are swapped: 16 px past the one predicted from `total`.
    expect(made.grid.el.scrollTop, 'the browser clamped past the prediction').toBe(999 * ROW_HEIGHT + 16 - 240)
    await clamp
    await frame()
    expect(made.grid.following, 'and that was not the user scrolling').toBe(true)
  })
})
