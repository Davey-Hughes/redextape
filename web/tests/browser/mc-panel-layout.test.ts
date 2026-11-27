import { beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import init, { compile } from '../../../pkg/redextape_wasm.js'
import initClif, { ClifSession } from '../../../pkg-clif/redextape_clif_wasm.js'
import initArm64, { machineCode as arm64Code } from '../../../pkg-mc-arm64/redextape_mc_wasm.js'
import initX86, { machineCode as x86Code } from '../../../pkg-mc-x86-64/redextape_mc_wasm.js'
import { ClifPane, type ClifPanels } from '../../src/clif-pane'
import { EXAMPLE_ENCODING, EXAMPLES } from '../../src/examples'
import { MIN_VIEW_PX } from '../../src/layout'
import type { McAnswer } from '../../src/machine-code'
import type { Shares } from '../../src/panel-stack'
import type { McTarget } from '../../src/protocol'
import { STYLE_IDS } from '../../src/skin'
import type { ClifAt, ClifListing, ClifState, McListing } from '../../src/types'
import { DEFAULT_CLIF_DISPLAY } from '../../src/workspace'
import { boundary, controlState, frames, hearLoops, inertEvents, panelOf, region } from './harness'
import { boundaryKeys, codeUnder } from './machine-views'

/**
 * THE MACHINE CODE PANEL'S PLACE IN A CLIF VIEW (machine code panel design §4 and §6): closed, the view is the one
 * without it, its header between the listing and the row and nothing of its own said; open, a region with its own
 * share, boundaries and stored shares, its rows scrolled inside its box, following the run's current block there and
 * nowhere else; a header of one line whose target choice stays put; and the run's marks on the rows, not the cells.
 * A `ClifPane` built by hand on `fact.rxt`, its machine code the real packages' for each target.
 */

const CONTROLS = controlState(true, 'step 3 of 55')
/** Each long case's own bound, past every wait in it. */
const CASE_MS = 60_000

let clif: ClifListing
const code = {} as Record<McTarget, McListing>

beforeAll(async () => {
  await page.viewport(1280, 1000)
  await init()
  await initClif()
  await initX86()
  await initArm64()
  const fact = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
  const { session } = compile(fact, EXAMPLE_ENCODING) as { session: { clifInput(): unknown; free(): void } | null }
  if (session === null) throw new Error('fact.rxt compiled to no session')
  const s = new ClifSession(session.clifInput(), 'as-built')
  clif = s.listing() as ClifListing
  s.free()
  code['x86-64'] = x86Code(session.clifInput(), 'as-built') as McListing
  code.arm64 = arm64Code(session.clifInput(), 'as-built') as McListing
  session.free()
})

hearLoops(() => {
  document.body.innerHTML = ''
})

/** The clif instruction whose pc has the most machine instructions on `target`, and that pc. */
function busiest(target: McTarget): { readonly at: ClifAt; readonly pc: number; readonly n: number } {
  const count = new Map<number, number>()
  for (const r of code[target].rows) if (r.kind === 'Inst' && r.pc !== null) count.set(r.pc, (count.get(r.pc) ?? 0) + 1)
  let best: { at: ClifAt; pc: number; n: number } | null = null
  for (const r of clif.rows) {
    if (r.kind !== 'Inst' || r.pc === null || r.at === null) continue
    const n = count.get(r.pc) ?? 0
    if (best === null || n > best.n) best = { at: r.at, pc: r.pc, n }
  }
  if (best === null) throw new Error('no clif instruction has machine code')
  return best
}

/** Every clif instruction with machine code, in listing order. */
const withCode = (target: McTarget): readonly ClifAt[] => {
  const pcs = new Set(code[target].rows.flatMap((r) => (r.kind === 'Inst' && r.pc !== null ? [r.pc] : [])))
  return clif.rows.flatMap((r) => (r.kind === 'Inst' && r.pc !== null && r.at !== null && pcs.has(r.pc) ? [r.at] : []))
}

function mount(
  width: number,
  o: {
    height?: number
    panels?: ClifPanels
    sizes?: Shares
    target?: McTarget
    bytes?: boolean
    /** A package still loading, with no answer: what the panel says, open, is its "loading" notice. */
    loading?: boolean
  } = {},
) {
  const sizes = vi.fn<(s: Shares) => void>()
  const host = document.createElement('section')
  host.className = 'pane'
  host.dataset.kind = 'clif'
  host.style.width = `${width}px`
  host.style.height = `${o.height ?? 900}px`
  document.body.append(host)
  // ONE ANSWER OBJECT PER TARGET, as the page's store keeps: the pane draws its rows afresh only for a new answer.
  const answers: Record<McTarget, McAnswer> = { 'x86-64': { code: code['x86-64'] }, arm64: { code: code.arm64 } }
  // A CASE MAY LET THE PACKAGE IN LATER, as the page's store does when its load is answered.
  const store = { loading: o.loading === true }
  const machineCode = {
    load: () => (store.loading ? 'loading' : 'ready') as 'loading' | 'ready',
    intent: vi.fn(),
    code: (target: McTarget) => (store.loading ? null : answers[target]),
    want: vi.fn(),
    retry: vi.fn(),
  }
  const display = { ...DEFAULT_CLIF_DISPLAY, target: o.target ?? 'x86-64', bytes: o.bytes ?? false }
  const pane = new ClifPane(
    host,
    inertEvents({ panelSizes: sizes, machineCode }),
    o.panels ?? {},
    o.sizes ?? {},
    display,
  )
  pane.setProgram({ listing: clif, level: 'as-built' })
  let step = 0
  let last: ClifState | null = null
  const at = (next: ClifAt | null) => {
    step += 1
    last = {
      step,
      at: next ?? { function: 0, inst: 0 },
      next,
      pc: null,
      values: [],
      values_len: 0,
      returned: null,
      depth: 1,
      frames: [],
      heap_len: 0,
      result: null,
      cells: [],
      box_len: 0,
      boxes: [],
    }
    pane.render(last, CONTROLS)
  }
  at(null)
  /** Draw the frame shown again, as the page does when an answer comes: the run has not moved. */
  const again = () => pane.render(last, CONTROLS)
  return { host, pane, sizes, at, again, store }
}

const codePanel = (host: HTMLElement) => panelOf(host, 'code')
const listingBox = (host: HTMLElement) => codePanel(host).querySelector('.mc-listing') as HTMLElement
const rowsOf = (host: HTMLElement, cls: string) => [
  ...codePanel(host).querySelectorAll<HTMLElement>(`.clif-row.${cls}`),
]
const heightOf = (host: HTMLElement, name: string) => region(host, name).getBoundingClientRect().height
const inside = (el: HTMLElement, box: DOMRect) => {
  const r = el.getBoundingClientRect()
  return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5
}

describe('a clif view whose machine code panel is closed', () => {
  it('says nothing in the panel, and has a region and a panel of each name once', async () => {
    const { host } = mount(634, { loading: true })
    await frames()
    expect(codePanel(host).dataset.open, 'precondition: closed').toBe('false')
    expect(host.querySelectorAll('.mc-notice, p.clif-notice').length, 'a notice in the view').toBe(0)
    const regions = [...host.querySelectorAll<HTMLElement>('[data-region]')].map((r) => r.dataset.region)
    const panels = [...host.querySelectorAll<HTMLElement>('[data-panel]')].map((p) => p.dataset.panel)
    expect(
      regions.filter((n, i) => regions.indexOf(n) !== i),
      'regions named twice',
    ).toEqual([])
    expect(
      panels.filter((n, i) => panels.indexOf(n) !== i),
      'panels named twice',
    ).toEqual([])
    expect(boundaryKeys(host)).toEqual(['listing|machine'])
    // ITS HEADER LIES RIGHT UNDER THE LISTING'S BOUNDARY, AND THE ROW A PANEL'S GAP UNDER IT.
    expect(codeUnder(host)).toEqual([8, 0])
    // OPEN, THE SAME PANEL SAYS ITS PACKAGE IS LOADING: the state has a notice, which the closed panel did not draw.
    await userEvent.click(codePanel(host).querySelector('.panel-toggle') as HTMLElement)
    await frames()
    expect(host.querySelectorAll('.mc-notice').length, 'precondition: open, the notice').toBe(1)
  })
})

describe('a clif view whose machine code panel is open', () => {
  it("takes two shares to the listing's two and the row's one, and keeps the row in the view", async () => {
    const { host } = mount(634, { height: 1600, panels: { code: true } })
    await frames()
    expect(heightOf(host, 'code') / heightOf(host, 'listing'), 'the machine code to the listing').toBeCloseTo(1, 2)
    expect(heightOf(host, 'machine') / heightOf(host, 'listing'), 'the row to the listing').toBeCloseTo(0.5, 2)
    const box = listingBox(host)
    expect(box.scrollHeight, 'its rows scroll inside its box').toBeGreaterThan(box.clientHeight)
    const pane = (host.querySelector('.clif-pane') as HTMLElement).getBoundingClientRect()
    expect(pane.bottom, 'the view does not grow').toBeLessThanOrEqual(host.getBoundingClientRect().bottom + 0.5)
  })

  it('parts the listing, the machine code and the row with boundaries of their own, each storing its two shares', async () => {
    for (const [above, below] of [
      ['listing', 'code'],
      ['code', 'machine'],
    ] as const) {
      document.body.innerHTML = ''
      const { host, sizes } = mount(634, { panels: { code: true } })
      await frames()
      expect(boundaryKeys(host)).toEqual(['listing|code', 'code|machine'])
      boundary(host, above, below).focus()
      await userEvent.keyboard('{ArrowDown}')
      await frames()
      const stored = sizes.mock.calls.at(-1)?.[0] as Shares
      expect(Object.keys(stored).sort(), `${above}|${below}`).toEqual([above, below].sort())
    }
  })

  // THE BUSIEST BLOCK'S ROWS RUN FROM ITS FIRST TO ITS LAST WITH ANOTHER INSTRUCTION'S BETWEEN, as many as a 900 px
  // view's box shows whole: centred on one of its rows, its last would be cut. In an 800 px view they are more.
  it.each([
    [900, true],
    [800, false],
  ])(
    'keeps the current block in a box of a %i px view as the run steps (whole: %s), and scrolls neither the page nor the view',
    async (height, whole) => {
      const { host, at } = mount(634, { height, panels: { code: true } })
      await frames()
      const box = listingBox(host)
      const where = () => [window.scrollY, host.scrollTop, (host.querySelector('.clif-pane') as HTMLElement).scrollTop]
      const before = where()
      /** The current rows, and how many rows from the first of them to the last. */
      const block = () => {
        const rows = rowsOf(host, 'is-current')
        const index = (r: HTMLElement | undefined) => Number(r?.getAttribute('aria-rowindex'))
        return { rows, span: index(rows.at(-1)) - index(rows[0]) + 1 }
      }
      const all = withCode('x86-64')
      const busy = busiest('x86-64').at
      at(busy)
      await frames()
      if (whole)
        expect(block().span, 'precondition: the busiest block as tall as the whole rows the box shows').toBe(
          Math.floor(box.clientHeight / 24),
        )
      else
        expect(block().span * 24, 'precondition: the busiest block taller than the box').toBeGreaterThan(
          box.clientHeight,
        )
      for (const [i, next] of [all[all.length - 1], all[0], busy, all[Math.floor(all.length / 2)], busy].entries()) {
        at(next ?? null)
        await frames()
        const { rows, span } = block()
        expect(rows.length, `step ${i}: precondition: rows marked current`).toBeGreaterThan(0)
        const rect = box.getBoundingClientRect()
        if (span * 24 <= box.clientHeight)
          expect(
            rows.filter((r) => !inside(r, rect)).map((r) => r.textContent),
            `step ${i}: current rows outside the box`,
          ).toEqual([])
        else
          expect(
            (rows[0] as HTMLElement).getBoundingClientRect().top,
            `step ${i}: the first current row at the box's top`,
          ).toBeCloseTo(rect.top, 0)
        expect(rowsOf(host, 'is-next').length, `step ${i}: one row followed`).toBe(1)
        expect(where(), `step ${i}: the page and the view stay where they were`).toEqual(before)
      }
    },
  )

  // THE LISTING'S OWN RULE (`state-table.ts`'s `Follow`): a scroll the user makes stops following until they ask for
  // it again with the re-attach.
  it('follows no more once the user scrolls its box, until the re-attach is pressed', async () => {
    const { host, at } = mount(634, { panels: { code: true } })
    await frames()
    const box = listingBox(host)
    const all = withCode('x86-64')
    at(busiest('x86-64').at)
    await frames()
    const followed = box.scrollTop
    // ROOM FOR THE PAGE TO SCROLL, so that a scroll of it the wheel or the re-attach made would show.
    const room = document.createElement('div')
    room.style.height = '2000px'
    document.body.append(room)
    expect(document.documentElement.scrollHeight, 'precondition: a page that can scroll').toBeGreaterThan(innerHeight)
    const where = () => [window.scrollY, host.scrollTop, (host.querySelector('.clif-pane') as HTMLElement).scrollTop]
    const page = where()
    await userEvent.wheel(box, { delta: { y: 400 } })
    await frames()
    const left = box.scrollTop
    expect(left, 'precondition: the wheel scrolled the box').not.toBe(followed)
    expect(where(), 'the wheel scrolled the page or the view').toEqual(page)
    // THE LAST STEP IS THE LISTING'S FIRST, far from where the wheel left the box, so that the rows the re-attach must
    // bring back are out of the box until it does.
    for (const next of [all[all.length - 1], all[0]]) {
      at(next ?? null)
      await frames()
      expect(box.scrollTop, 'the box where the user left it').toBe(left)
    }
    expect(
      rowsOf(host, 'is-current').filter((r) => inside(r, box.getBoundingClientRect())).length,
      'precondition: no current row in the box before the re-attach',
    ).toBe(0)
    const reattach = codePanel(host).querySelector('.table-reattach') as HTMLElement
    expect(reattach.hidden, 'the re-attach offered').toBe(false)
    await userEvent.click(reattach)
    await frames()
    const rect = box.getBoundingClientRect()
    // DRAWN AND INSIDE, NOT ONLY NONE OUTSIDE: the grid draws the rows in view alone, so rows left out of view are not
    // in the page at all.
    expect(
      rowsOf(host, 'is-current').filter((r) => inside(r, rect)).length,
      'current rows in the box once re-attached',
    ).toBeGreaterThan(0)
    expect(
      rowsOf(host, 'is-current').filter((r) => !inside(r, rect)).length,
      'current rows outside the box once re-attached',
    ).toBe(0)
    expect(box.scrollTop, 'following moved the box back').not.toBe(left)
    expect(where(), 'the re-attach scrolled the page or the view').toEqual(page)
  })

  it('marks a current row on the row, so its cell lets the next, link and focus marks show', async () => {
    const { host, at, pane } = mount(634, { panels: { code: true } })
    await frames()
    const { at: busy, pc } = busiest('x86-64')
    pane.setLink([pc], false)
    at(busy)
    await frames()
    const current = rowsOf(host, 'is-current')
    expect(current.length, 'precondition: a block').toBeGreaterThan(1)
    for (const r of current) {
      const cell = r.querySelector('.clif-cell') as HTMLElement
      expect(getComputedStyle(cell).backgroundColor, 'a current cell paints no wash').toBe('rgba(0, 0, 0, 0)')
      expect(getComputedStyle(r).borderInlineStartStyle, "the link's dashed edge on a current row").toBe('dashed')
    }
    const [followed] = rowsOf(host, 'is-next')
    const other = current.find((r) => !r.classList.contains('is-next')) as HTMLElement
    expect(followed?.classList.contains('is-current'), 'precondition: the followed row is current').toBe(true)
    const bg = (el: HTMLElement) => getComputedStyle(el).backgroundColor
    expect(bg(followed as HTMLElement), "the followed row is the next mark's, not the current wash").not.toBe(bg(other))
  })

  /** A row's bar: the first of the shadows its marks share (`style.css`'s `--row-bar`). */
  const bar = (el: HTMLElement) =>
    getComputedStyle(el)
      .boxShadow.split(/,(?![^(]*\))/)[0]
      ?.trim() ?? ''

  it('bars every current row as the state table bars its current row, a shape and not a colour alone', async () => {
    const { host, at } = mount(634, { panels: { code: true } })
    await frames()
    at(busiest('x86-64').at)
    await frames()
    const others = rowsOf(host, 'is-current').filter((r) => !r.classList.contains('is-next'))
    const [followed] = rowsOf(host, 'is-next')
    const plain = codePanel(host).querySelector<HTMLElement>('.clif-row:not(.is-current):not(.is-next)')
    expect(others.length, 'precondition: current rows beside the followed one').toBeGreaterThan(0)
    const root = document.documentElement
    try {
      for (const style of STYLE_IDS)
        for (const theme of ['light', 'dark']) {
          root.dataset.style = style
          root.dataset.theme = theme
          const said = `${style}, ${theme}`
          expect(bar(followed as HTMLElement), `${said}: precondition: the followed row's bar`).not.toBe(
            bar(plain as HTMLElement),
          )
          for (const r of others) expect(bar(r), `${said}: a current row's bar`).toBe(bar(followed as HTMLElement))
        }
    } finally {
      delete root.dataset.style
      delete root.dataset.theme
    }
  })

  it('scrolls to a link pinned in another view before its rows came, once they come', async () => {
    const { host, pane, again, store } = mount(634, { panels: { code: true }, loading: true })
    await frames()
    const rows = code['x86-64'].rows
    const pc = rows.findLast((r) => r.pc !== null)?.pc ?? null
    if (pc === null) throw new Error('no machine row of fact.rxt carries a pc')
    pane.setLink([pc], true)
    await frames()
    store.loading = false
    again()
    await frames()
    const box = listingBox(host)
    expect(
      rowsOf(host, 'is-linked').filter((r) => inside(r, box.getBoundingClientRect())).length,
      'the pinned rows in the box',
    ).toBeGreaterThan(0)
  })
})

describe("the machine code panel's header", () => {
  /** The header's height, and the left edge of the target choice. */
  const header = (host: HTMLElement) => {
    const h = codePanel(host).querySelector('.panel-header') as HTMLElement
    const target = h.querySelector('.mc-target') as HTMLElement
    return { height: h.getBoundingClientRect().height, left: Math.round(target.getBoundingClientRect().left) }
  }
  /** A header of one line: as tall as the listing's, whose header holds its toggle alone. */
  const oneLine = (host: HTMLElement) =>
    (panelOf(host, 'listing').querySelector('.panel-header') as HTMLElement).getBoundingClientRect().height

  const bar = (host: HTMLElement) => codePanel(host).querySelector('.panel-header') as HTMLElement
  const rectOf = (host: HTMLElement, selector: string) =>
    (bar(host).querySelector(selector) as HTMLElement).getBoundingClientRect()
  /** Detach the panel from the run with a wheel over its rows, so the header shows the re-attach. */
  const detach = async (host: HTMLElement) => {
    await userEvent.wheel(listingBox(host), { delta: { y: 400 } })
    await frames()
    expect((bar(host).querySelector('.table-reattach') as HTMLElement).hidden, 'precondition: detached').toBe(false)
  }
  /** What the header draws outside its own box, left or right, in whole pixels: 0 for nothing. */
  const outside = (host: HTMLElement) => {
    const box = bar(host).getBoundingClientRect()
    let most = 0
    for (const el of bar(host).querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0) most = Math.max(most, r.right - box.right, box.left - r.left)
    }
    return Math.round(most)
  }

  it.each([300, 506, 600, 640])(
    'is one line in a view %i px wide, its target choice where it was on either target',
    async (width) => {
      const { host } = mount(width, { panels: { code: true } })
      await frames()
      const x86 = header(host)
      expect(x86.height, 'x86-64').toBeCloseTo(oneLine(host), 0)
      await userEvent.click(codePanel(host).querySelector('[role="radio"][data-value="arm64"]') as HTMLElement)
      await frames()
      const arm64 = header(host)
      expect(arm64.height, 'arm64').toBeCloseTo(oneLine(host), 0)
      expect(arm64.left, 'the target choice on arm64, where the syntax choice is gone').toBe(x86.left)
      // THE BUTTONS NEVER GIVE WAY; THE TITLE AND THE NAME ON THE TOGGLE DO.
      for (const b of codePanel(host).querySelectorAll<HTMLElement>('.panel-actions button:not([hidden])'))
        expect(b.scrollWidth, `${b.textContent} whole`).toBeLessThanOrEqual(b.clientWidth)
      expect(outside(host), 'drawn outside the header').toBe(0)
    },
  )

  /** The clif view's width beside the source in a 1280 px window, the width most views are seen at. */
  it('names the target and the listing whole in a view 634 px wide, the longer listing too', async () => {
    const { host } = mount(634, { panels: { code: true } })
    await frames()
    const title = bar(host).querySelector('.mc-title') as HTMLElement
    expect(title.textContent).toBe('x86-64 · as built')
    expect(title.scrollWidth, 'as built cut').toBeLessThanOrEqual(title.clientWidth)
    // THE OTHER LISTING'S WORDS, set in place: the pane draws them only when the program's listing changes.
    title.textContent = 'x86-64 · optimised'
    await frames()
    expect(title.scrollWidth, 'optimised cut').toBeLessThanOrEqual(title.clientWidth)
    expect(header(host).height, 'one line').toBeCloseTo(oneLine(host), 0)
  })

  // THE CONTROLLER'S CALL (option a): the re-attach and the maximise take a second line of their own where they do not
  // fit beside the name, the title and the choices whole, as the listing's header wraps its re-attach, and the first
  // line stays as it was. The width the header needs for one line is read in a view with room for it.
  it('takes a second line for the re-attach only where it does not fit beside the rest, and leaves the first as it was', async () => {
    const wide = mount(1280, { panels: { code: true } })
    await frames()
    wide.at(busiest('x86-64').at)
    await frames()
    await detach(wide.host)
    const box = bar(wide.host).getBoundingClientRect()
    const gap = Number.parseFloat(
      getComputedStyle(bar(wide.host).querySelector('.panel-actions') as HTMLElement).columnGap,
    )
    const [syntax, reattach, maximise] = ['.mc-syntax', '.table-reattach', '.panel-maximise'].map((s) =>
      rectOf(wide.host, s),
    )
    const needs =
      (syntax?.right ?? 0) -
      box.left +
      gap +
      (maximise?.right ?? 0) -
      (reattach?.left ?? 0) +
      box.right -
      (maximise?.right ?? 0)
    for (const [width, lines] of [
      [Math.ceil(needs), 1],
      [Math.floor(needs) - 1, 2],
    ] as const) {
      document.body.innerHTML = ''
      const { host, at } = mount(width, { panels: { code: true } })
      await frames()
      at(busiest('x86-64').at)
      await frames()
      const before = { ...header(host), toggle: rectOf(host, '.panel-toggle').width }
      await detach(host)
      const target = rectOf(host, '.mc-target')
      const [re, max] = [rectOf(host, '.table-reattach'), rectOf(host, '.panel-maximise')]
      expect(header(host).left, `${width} px: the target choice where it was`).toBe(before.left)
      expect(rectOf(host, '.panel-toggle').width, `${width} px: the name as it was`).toBe(before.toggle)
      expect(Math.abs(re.top - max.top), `${width} px: the re-attach and the maximise on one line`).toBeLessThan(1)
      if (lines === 1) {
        expect(header(host).height, `${width} px: one line`).toBeCloseTo(oneLine(host), 0)
        expect(re.left, `${width} px: the re-attach right of the choices`).toBeGreaterThanOrEqual(target.right)
      } else {
        expect(header(host).height, `${width} px: more than one line`).toBeGreaterThan(oneLine(host) + 1)
        expect(re.top, `${width} px: the re-attach under the choices`).toBeGreaterThanOrEqual(target.bottom)
      }
      expect(outside(host), `${width} px: drawn outside the header`).toBe(0)
    }
  })

  it(
    'draws nothing outside itself in a view of any width down to the narrowest a view may be, the re-attach shown or not',
    async () => {
      for (const width of [MIN_VIEW_PX, 200, 250, 300, 360, 440, 500, 640, 700]) {
        document.body.innerHTML = ''
        const { host, at } = mount(width, { panels: { code: true } })
        await frames()
        at(busiest('x86-64').at)
        await frames()
        expect(outside(host), `${width} px`).toBe(0)
        await detach(host)
        expect(outside(host), `${width} px, the re-attach shown`).toBe(0)
        for (const b of codePanel(host).querySelectorAll<HTMLElement>('.panel-actions button:not([hidden])'))
          expect(b.scrollWidth, `${width} px: ${b.textContent} whole`).toBeLessThanOrEqual(b.clientWidth)
      }
    },
    CASE_MS,
  )
})

describe("the machine code panel's bytes", () => {
  it.each(['x86-64', 'arm64'] as const)(
    'on %s, line every instruction up after a column as wide as the widest bytes',
    async (target) => {
      const { host } = mount(1000, { height: 1600, panels: { code: true }, target, bytes: true })
      await frames()
      const spans = [...codePanel(host).querySelectorAll<HTMLElement>('.mc-bytes')]
      expect(spans.length, 'precondition: bytes drawn').toBeGreaterThan(10)
      const rights = new Set(spans.map((s) => Math.round(s.getBoundingClientRect().right)))
      expect([...rights], 'one right edge for every bytes column').toHaveLength(1)
      // THE LISTING'S WIDEST BYTES, measured as text: the column is that wide and no wider.
      const widest = Math.max(...code[target].rows.map((r) => r.bytes.length / 2))
      const probe = document.createElement('span')
      probe.textContent = Array.from({ length: widest }, () => '00').join(' ')
      ;(spans[0] as HTMLElement).after(probe)
      const range = document.createRange()
      range.selectNodeContents(probe)
      const text = range.getBoundingClientRect().width
      probe.remove()
      expect((spans[0] as HTMLElement).getBoundingClientRect().width, `as wide as ${widest} bytes`).toBeCloseTo(text, 0)
    },
  )
})
