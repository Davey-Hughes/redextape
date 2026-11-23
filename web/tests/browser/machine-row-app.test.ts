import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import {
  boundary,
  drawn,
  frame,
  hearLoops,
  host,
  mountAt,
  pickPreset,
  pressTab,
  pressToggle,
  region,
  storedLayout,
  toggle,
} from './harness'
import { arrangement, drawnAs, row } from './machine-views'

/**
 * THE MACHINE VIEWS' ARRANGEMENTS IN THE APP (the machine panels row design §5.1's table, and §6.1): the CLIF view and
 * the rxm view as the app builds, hides and shows them, in its own hosts and at the widths its windows give them. Each
 * is read two frames after the gesture that shows it, as the row says it (`data-arrangement`) and as the page draws it
 * (`drawnAs`). `machine-row.test.ts` holds the thresholds to the pixel and the first frame, on hosts built by hand.
 */

/**
 * Each machine view: its toggle's kind, its leaf, the name of its first panel, and the arrangement it has beside the
 * source in a window and as the Stage's one view in a window, by the window's width.
 */
const MACHINES = [
  {
    kind: 'clif',
    leaf: 'clif-0',
    values: 'values',
    beside: { 1280: 'wide', 1024: 'medium' },
    stage: { 1280: 'wide', 1024: 'wide', 800: 'medium' },
  },
  {
    kind: 'rxm',
    leaf: 'rxm-0',
    values: 'registers',
    beside: { 1280: 'medium', 1024: 'narrow' },
    stage: { 1280: 'wide', 1024: 'medium', 800: 'narrow' },
  },
] as const

type Machine = (typeof MACHINES)[number]

/** §5.1's two windows, and the width the design measured inside a view beside the source in each. */
const WINDOWS = [
  { window: 1280, inside: 634 },
  { window: 1024, inside: 506 },
] as const

const HEIGHT = 896

beforeAll(async () => {
  await mountAt(1280, HEIGHT)
}, 30_000)

hearLoops(async () => {
  if (document.querySelector('#views [role="tab"]') !== null) pickPreset('explorer')
  await page.viewport(1280, HEIGHT)
})

/** The source alone in the Explorer, in a window `width` px wide: where each case starts. */
async function sourceAlone(width: number): Promise<void> {
  await page.viewport(width, HEIGHT)
  for (const kind of ['lambda', 'tm', 'rxm', 'clif'])
    if (toggle(kind).getAttribute('aria-pressed') === 'true') await pressToggle(kind)
  expect(drawn(), 'precondition: the source alone').toBe('source')
}

/** The view `m` on the page. */
const viewOf = (m: Machine) => host(m.leaf) as HTMLElement

/** The width `machine-row.ts` chooses by: `el`'s border box less its padding and border. */
function inside(el: HTMLElement): number {
  const css = getComputedStyle(el)
  const edges = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'] as const
  return el.getBoundingClientRect().width - edges.reduce((sum, k) => sum + Number.parseFloat(css[k]), 0)
}

/** That the view `m` says it is in `want` and is drawn in it. */
function holds(m: Machine, want: string, when: string): void {
  expect(arrangement(viewOf(m)), `the ${m.kind} view's row, ${when}`).toBe(want)
  expect(drawnAs(viewOf(m), m.values), `the ${m.kind} view as drawn, ${when}`).toBe(want)
}

/**
 * That the view `m`, off the page, has kept the row `kept` in the arrangement `was`: with no width to choose by, it
 * chooses nothing until it is shown.
 */
function waits(m: Machine, kept: HTMLElement, was: string, when: string): void {
  expect(host(m.leaf), `precondition: the ${m.kind} view is off the page, ${when}`).toBeNull()
  expect(kept.getBoundingClientRect().width, `precondition: its row has no width, ${when}`).toBe(0)
  expect(kept.dataset.arrangement, `the ${m.kind} view's row off the page, ${when}`).toBe(was)
}

describe.each(MACHINES)('the $kind view in the app', (m) => {
  it.each(WINDOWS)('is drawn as §5.1 says beside the source in a $window px window', async (w) => {
    await sourceAlone(w.window)
    await pressToggle(m.kind)
    expect(drawn(), 'precondition: the view beside the source').toBe(`row[50](source ${m.leaf})`)
    const width = inside(viewOf(m))
    console.error(`the ${m.kind} view beside the source in a ${w.window} px window is ${width} px wide inside`)
    expect(
      Math.abs(width - w.inside),
      `precondition: ${width} px inside, the design's ${w.inside}`,
    ).toBeLessThanOrEqual(2)
    holds(m, m.beside[w.window], `shown in a ${w.window} px window`)
  })

  it('is drawn in the arrangement its width gives when its toggle shows it again in a window resized meanwhile', async () => {
    await sourceAlone(1280)
    await pressToggle(m.kind)
    const kept = row(viewOf(m))
    holds(m, m.beside[1280], 'shown at 1280 px')
    for (const [from, to] of [
      [1280, 1024],
      [1024, 1280],
    ] as const) {
      await pressToggle(m.kind)
      await page.viewport(to, HEIGHT)
      waits(m, kept, m.beside[from], `hidden at ${from} px and the window now ${to}`)
      await pressToggle(m.kind)
      expect(row(viewOf(m)), 'precondition: the view that was hidden, not one built anew').toBe(kept)
      expect(drawn(), 'precondition: the view beside the source').toBe(`row[50](source ${m.leaf})`)
      holds(m, m.beside[to], `hidden at ${from} px and shown again at ${to}`)
    }
  })

  it('is drawn in the arrangement its width gives when its Stage tab is chosen in a window resized meanwhile', async () => {
    await sourceAlone(1280)
    await pressToggle(m.kind)
    pickPreset('stage')
    expect(drawn(), 'precondition: the Stage, the source and the view its tabs').toBe(`stage(source ${m.leaf})`)
    await pressTab(m.leaf)
    const kept = row(viewOf(m))
    holds(m, m.stage[1280], 'its tab chosen at 1280 px')
    let from: keyof Machine['stage'] = 1280
    for (const to of [800, 1024, 1280] as const) {
      await pressTab('source')
      await page.viewport(to, HEIGHT)
      waits(m, kept, m.stage[from], `its tab left at ${from} px and the window now ${to}`)
      await pressTab(m.leaf)
      expect(row(viewOf(m)), 'precondition: the view whose tab was left, not one built anew').toBe(kept)
      holds(m, m.stage[to], `its tab left at ${from} px and chosen again at ${to}`)
      from = to
    }
  })
})

describe('the rxm view in the app', () => {
  const m = MACHINES[1]

  it('stores the split of its registers and call stack in the workspace, narrow beside the source', async () => {
    await sourceAlone(1024)
    // TALL ENOUGH THAT THE CALL STACK IS OVER ITS FLOOR AFTER A STEP.
    await page.viewport(1024, 1600)
    await pressToggle('rxm')
    holds(m, 'narrow', 'beside the source in a 1024 px window')
    const view = viewOf(m)
    const stack = () => region(view, 'stack').getBoundingClientRect().height
    const before = stack()
    boundary(view, 'machine', 'stack').focus()
    await userEvent.keyboard('{ArrowDown}')
    await frame()
    expect(stack(), "precondition: the call stack's region is shorter").toBeLessThan(before - 1)
    const stored = storedLayout<{ panelSizes?: Record<string, Record<string, number>> }>().panelSizes?.['rxm-0']
    expect(stored?.stack, "the call stack's part").toBeGreaterThan(0)
    expect(stored?.stack, "the call stack's part").toBeLessThan(0.5)
    expect(stored?.machine, 'the row keeps its share').toBeCloseTo(1, 2)
  })
})
