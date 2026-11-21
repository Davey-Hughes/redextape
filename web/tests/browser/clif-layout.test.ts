import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import init, { compile } from '../../../pkg/redextape_wasm.js'
import initClif, { ClifSession } from '../../../pkg-clif/redextape_clif_wasm.js'
import { ClifPane } from '../../src/clif-pane'
import { PC_COLUMNS } from '../../src/clif-view'
import { EXAMPLE_ENCODING, EXAMPLES } from '../../src/examples'
import type { Listing } from '../../src/protocol'
import { ROW_HEIGHT } from '../../src/state-table'
import type { ClifListing, ClifRowKind } from '../../src/types'
import type { ClifDisplay } from '../../src/workspace'
import { textColumn } from './clif-fixture'
import { controlState, everyFrame, fixtureHost, frames, menuOf, moreOf, paneEvents, until } from './harness'

/**
 * A CLIF view's two layouts (CLIF view design §4, *Listing*): compact by default, each function as Cranelift prints one
 * with no source locations right of the pc column, while *compact* is checked in the view's `⋯` menu, and Cranelift's
 * own columns while it is unchecked. A row's text is read where it is drawn, in columns of the listing's face from the
 * right edge of the pc column, on `fact.rxt`'s listings from a real `ClifSession`.
 */

const listings = {} as Record<Listing, ClifListing>

beforeAll(async () => {
  await page.viewport(1280, 1000)
  await init()
  await initClif()
  const fact = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
  for (const listing of ['as-built', 'optimised'] as const) {
    const { session } = compile(fact, EXAMPLE_ENCODING) as { session: { clifInput(): unknown; free(): void } | null }
    if (session === null) throw new Error('fact.rxt compiled to no session')
    const clif = new ClifSession(session.clifInput(), listing)
    listings[listing] = clif.listing() as ClifListing
    clif.free()
    session.free()
  }
})

afterEach(() => {
  document.body.innerHTML = ''
})

/** A CLIF view 800 px tall showing `listing`, built with `display` as stored; `clifDisplay` is its report's spy. */
function mount(listing: Listing, display?: ClifDisplay) {
  const host = fixtureHost('clif-layout-fixture')
  host.dataset.kind = 'clif'
  host.style.height = '800px'
  const clifDisplay = vi.fn()
  const pane = new ClifPane(host, { ...paneEvents(), clifDisplay }, {}, {}, display)
  pane.setProgram({ listing: listings[listing] })
  pane.render(null, controlState(false, ''))
  return { host, pane, clifDisplay }
}

const box = (host: HTMLElement) => host.querySelector<HTMLElement>('.clif-listing') as HTMLElement
const rowAt = (host: HTMLElement, row: number) =>
  host.querySelector<HTMLElement>(`.clif-row[aria-rowindex="${row + 1}"]`)
const compactItem = (host: HTMLElement) =>
  menuOf(moreOf(host)).querySelector<HTMLButtonElement>('button.clif-compact') as HTMLButtonElement

/** The kinds of row whose text has a left edge to read: every kind but a blank line. */
const KINDS: readonly ClifRowKind[] = ['Function', 'Decl', 'Block', 'Inst', 'Alias', 'Close']

/**
 * The column each kind of row's text starts at in the view `host` shows, from the first row of each kind `listing`
 * has, each scrolled into view to be read. The pc column is an instruction row's `.rxm-pc`, whose label is no wider
 * than `PC_COLUMNS`, so the box is `PC_COLUMNS` columns wide and gives the column's width too.
 */
async function columns(host: HTMLElement, listing: Listing): Promise<Partial<Record<ClifRowKind, number>>> {
  const rows = listings[listing].rows
  const inst = rows.findIndex((r) => r.kind === 'Inst' && r.pc !== null)
  const read = async (row: number) => {
    box(host).scrollTop = row * ROW_HEIGHT
    await until(() => rowAt(host, row) !== null, `row ${row} to draw`)
    return rowAt(host, row) as HTMLElement
  }
  const pcBox = (await read(inst)).querySelector('.rxm-pc')?.getBoundingClientRect() as DOMRect
  expect(pcBox.width, 'precondition: a pc column drawn').toBeGreaterThan(0)
  const ch = pcBox.width / PC_COLUMNS
  const out: Partial<Record<ClifRowKind, number>> = {}
  for (const kind of KINDS) {
    const row = rows.findIndex((r) => r.kind === kind && (kind !== 'Inst' || r.pc !== null))
    if (row >= 0) out[kind] = textColumn(await read(row), pcBox.right, ch)
  }
  box(host).scrollTop = 0
  return out
}

/** Compact: the function line, a block header and the brace one column right of the pc column, the rest 4 further. */
const COMPACT = { Function: 1, Decl: 5, Block: 1, Inst: 5, Alias: 5, Close: 1 }
/** Exact: Cranelift's columns, 0, 4, 32 and 36, counted from the row's start, where the pc column's 5 begin. */
const EXACT = { Function: -5, Decl: -1, Block: 27, Inst: 31, Alias: 31, Close: -5 }
/** `layout`'s columns for `listing`'s kinds of row: the optimised listing has no alias. */
const expected = (layout: Record<string, number>, listing: Listing) =>
  listing === 'optimised' ? Object.fromEntries(Object.entries(layout).filter(([k]) => k !== 'Alias')) : layout

/** Open the view's `⋯` menu, unless it is open, and press *compact* in it. */
async function pressCompact(host: HTMLElement): Promise<void> {
  if (!menuOf(moreOf(host)).matches(':popover-open')) {
    await userEvent.click(moreOf(host))
    await until(() => menuOf(moreOf(host)).matches(':popover-open'), 'the view menu to open')
  }
  await userEvent.click(compactItem(host))
}

describe("a CLIF view's layout", () => {
  it.each(['as-built', 'optimised'] as const)(
    'is compact by default: %s as Cranelift prints a function with no source locations, beside the pc column',
    async (listing) => {
      const { host, clifDisplay } = mount(listing)
      expect(await columns(host, listing)).toEqual(expected(COMPACT, listing))
      expect(compactItem(host).getAttribute('role')).toBe('checkbox')
      expect(compactItem(host).getAttribute('aria-checked')).toBe('true')
      expect(compactItem(host).textContent).toBe('compact')
      // CHECKED, IT IS DRAWN HEAVIER, as a λ view's *expand all* is: a cue that does not rest on colour alone.
      expect(getComputedStyle(compactItem(host)).fontWeight).toBe('600')
      expect(clifDisplay, 'a view on the default reports nothing, so nothing is stored for it').not.toHaveBeenCalled()
    },
  )

  it.each(['as-built', 'optimised'] as const)(
    "is Cranelift's own while compact is unchecked in the view's menu, and compact again checked, %s",
    async (listing) => {
      const { host, clifDisplay } = mount(listing)
      const decl = () => rowAt(host, 1)?.querySelector('.clif-cell')?.textContent ?? ''
      const compact = decl()
      await pressCompact(host)
      expect(decl(), 'the press redraws the rows in view, with no scroll to redraw them').not.toBe(compact)
      expect(compactItem(host).getAttribute('aria-checked')).toBe('false')
      expect(getComputedStyle(compactItem(host)).fontWeight).toBe('400')
      expect(menuOf(moreOf(host)).matches(':popover-open'), 'a setting leaves the menu open').toBe(true)
      expect(clifDisplay).toHaveBeenLastCalledWith({ layout: 'exact' })
      expect(await columns(host, listing)).toEqual(expected(EXACT, listing))

      await pressCompact(host)
      expect(compactItem(host).getAttribute('aria-checked')).toBe('true')
      expect(getComputedStyle(compactItem(host)).fontWeight).toBe('600')
      expect(clifDisplay).toHaveBeenLastCalledWith({ layout: 'compact' })
      expect(clifDisplay).toHaveBeenCalledTimes(2)
      expect(await columns(host, listing)).toEqual(expected(COMPACT, listing))
    },
  )

  it('is the one the view was built with, as a stored display', async () => {
    const { host, clifDisplay } = mount('as-built', { layout: 'exact' })
    expect(compactItem(host).getAttribute('aria-checked')).toBe('false')
    expect(await columns(host, 'as-built')).toEqual(EXACT)
    expect(clifDisplay, 'a view built with a display reports no change').not.toHaveBeenCalled()
  })

  /**
   * **ONE FRAME, THE SAME ROWS IN VIEW**: read in every frame from before the press until after it, the view shows the
   * rows it showed in one layout and then the same rows, at the same scroll, in the other, and nothing between.
   */
  it('changes in one frame, keeping the same rows in view', async () => {
    const { host } = mount('as-built')
    box(host).scrollTop = 80 * ROW_HEIGHT + 7
    await until(() => rowAt(host, 80) !== null, 'row 80 to draw')
    await userEvent.click(moreOf(host))
    await until(() => menuOf(moreOf(host)).matches(':popover-open'), 'the view menu to open')
    const seen = () => {
      const top = box(host).getBoundingClientRect().top
      const rows = [...host.querySelectorAll<HTMLElement>('.clif-row')]
      const first = rows
        .filter((r) => r.getBoundingClientRect().bottom > top + 1)
        .sort((a, b) => Number(a.getAttribute('aria-rowindex')) - Number(b.getAttribute('aria-rowindex')))[0]
      const offset = Math.round((first?.getBoundingClientRect().top ?? 0) - top)
      return JSON.stringify({
        scroll: box(host).scrollTop,
        first: `${first?.getAttribute('aria-rowindex')} at ${offset}`,
        drawn: rows.map((r) => r.getAttribute('aria-rowindex')).join(','),
        text: rows.map((r) => r.querySelector('.clif-cell')?.textContent ?? '').join('\n'),
      })
    }
    await frames()
    const before = seen()
    const watch = everyFrame(seen)
    await frames()
    await pressCompact(host)
    await frames()
    await frames()
    watch.stop()
    const after = seen()
    const at = (s: string) => JSON.parse(s) as Record<string, string | number>
    expect(at(after).text, 'precondition: the press changed the layout').not.toBe(at(before).text)
    expect(at(after).scroll).toBe(at(before).scroll)
    expect(at(after).first).toBe(at(before).first)
    expect(at(after).drawn).toBe(at(before).drawn)
    expect(watch.seen.length, 'precondition: frames were read through the press').toBeGreaterThan(3)
    const runs = watch.seen
      .map((s) => (s === before ? 'compact' : s === after ? 'exact' : s))
      .filter((s, i, all) => s !== all[i - 1])
    expect(runs, 'what each frame showed, in order, a run of the same once').toEqual(['compact', 'exact'])
  })
})
