import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { TmProgram } from '../../src/types'
import { controlState, diagram, diagramChoice, frames, until } from './harness'
import { mountTmFixture } from './tm-fixture'

/**
 * A fan whose middle line runs along its row (`docs/superpowers/specs/2026-11-16-state-diagram-tidy-design.md`, the
 * fans): `fact(12)`'s level under binary in `bmul17.s9.up31`, laid out over 829 px, the 844 px panel less a classic
 * scroll bar's room. Its names are as long as the cap shows whole, so in either engine's font the level is wider than
 * that and its gaps no wider than their labels need, where a row is set furthest apart for the label along it to sit
 * by its own line, the line a reader takes it to belong to. The view is given the states around that state, `LEVEL`,
 * rather than a run walked there, a walk too long for a test.
 */

const STATE = 'bmul17.s9.up31'
const level = () => diagram().querySelector('.local-level') as HTMLElement
const nodes = () => [...diagram().querySelectorAll<HTMLElement>('.local-node')]

/** A rule on the `WORK` tape alone, the second of five: what it reads, how its head moves, the state it goes to. */
const work = (read: string, move: 'L' | 'R' | 'S', next: number) => ({
  read: [null, read, null, null, null],
  write: [null, null, null, null, null],
  moves: ['S', move, 'S', 'S', 'S'] as ('L' | 'R' | 'S')[],
  next,
})

/**
 * The states within two rules of `STATE` in `fact(12)`'s machine under binary, and their rules among them, as it
 * compiles: the level is drawn from these alone. In the machine's order, which orders the states of a column. All but
 * `overflow` are billed to one instruction, which the local level does not draw; `overflow` to none, as the core
 * builds it.
 */
const LEVEL: TmProgram = {
  states: [
    ['overflow', []],
    ['bmul17.s9.up29', [work('0', 'R', 2), work('1', 'R', 2)]],
    ['bmul17.s9.up30', [work('0', 'R', 3), work('1', 'R', 3)]],
    [STATE, [work('1', 'S', 0), work('0', 'L', 4)]],
    ['bmul17.s9.need', [work('0', 'R', 5), work('1', 'R', 6), work('#', 'R', 7)]],
    ['bmul17.s9.wr0', []],
    ['bmul17.s9.wr1', []],
    ['bmul17.s9.zlo', []],
  ].map(([name, rules]) => ({
    name: name as string,
    accept: false,
    rules: rules as ReturnType<typeof work>[],
    instr: name === 'overflow' ? null : 0,
  })),
  alphabet: ['#', '0', '1', '_'],
  tapes: 5,
  width: 32,
  start: 3,
  listing: ['bmul17.s9'],
  labels: [],
}

type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
/** How far the point `(x, y)` is from the box `b`: 0 inside it. */
const toBox = (x: number, y: number, b: Box) =>
  Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom))

beforeAll(async () => {
  await page.viewport(1280, 2400)
  const { host, pane } = mountTmFixture(LEVEL, ['REG', 'WORK', 'STACK', 'HEAP', 'BOX'], { width: 1280, height: 1000 })
  // NAMED AS THE APP'S FIRST TM VIEW IS, so the harness's readers of that view's diagram read this one.
  host.dataset.leaf = 'tm-0'
  // IN `STATE`, ITS `WORK` HEAD ON A BLANK, WHICH NO RULE OF IT READS.
  pane.render(
    {
      state: 3,
      step: 0,
      heads: [0, 0, 0, 0, 0],
      window_start: [0, 0, 0, 0, 0],
      window: ['_', '_', '_', '_', '_'],
      source_node: null,
      rule: null,
    },
    controlState(false, 'step 0 of 0', false, false, false),
  )
  await userEvent.click(diagramChoice('local') as HTMLButtonElement)
  await until(() => nodes().length === 8, `the local level around ${STATE}`)
  // THE PANEL LESS A CLASSIC SCROLL BAR'S ROOM: overlay scroll bars here take none, so the panel is that wide itself.
  const chrome = host.offsetWidth - level().offsetWidth
  host.style.width = `${829 + chrome}px`
  await until(() => level().offsetWidth === 829, 'the level to be 829 px wide')
  await frames()
})

describe('a fan with a line along its row', () => {
  it('lays the level out at two rules each way, wider than its panel', () => {
    expect(nodes().map((n) => Number(n.dataset.column))).toEqual([-2, -1, 0, 1, 1, 2, 2, 2])
    expect(nodes().find((n) => n.dataset.column === '0')?.title).toBe(STATE)
    const svg = diagram().querySelector<SVGSVGElement>('svg.local-edges')
    expect(svg?.getBoundingClientRect().width ?? 0).toBeGreaterThan(829)
  })

  it("sets each edge's label nearer its own line than any other edge's line", () => {
    const edges = [...diagram().querySelectorAll<SVGPathElement>('.local-edges path.local-edge')].map((path) => {
      const length = path.getTotalLength()
      const points = Array.from({ length: Math.ceil(length * 2) + 1 }, (_, i) =>
        path.getPointAtLength(Math.min(length, i / 2)),
      )
      return { at: `${path.dataset.from}->${path.dataset.to}`, points }
    })
    const texts = [...diagram().querySelectorAll<SVGTextElement>('.local-edges text.local-label')]
    expect([edges.length, texts.length]).toEqual([7, 7])
    const misread: string[] = []
    for (const text of texts) {
      const at = `${text.dataset.from}->${text.dataset.to}`
      // THE SVG's OWN UNITS, AS THE PATHS' POINTS ARE: `getBBox` has no sides of its own, only a corner and a size.
      const { x, y, width, height } = text.getBBox()
      const box = { left: x, top: y, right: x + width, bottom: y + height }
      const gaps = edges.map((e) => ({ at: e.at, gap: Math.min(...e.points.map((p) => toBox(p.x, p.y, box))) }))
      const own = gaps.find((g) => g.at === at)?.gap ?? Number.POSITIVE_INFINITY
      expect(Number.isFinite(own), `${at}'s distance from its own line`).toBe(true)
      for (const g of gaps) {
        if (g.at !== at && g.gap <= own)
          misread.push(`${at} is ${g.gap.toFixed(1)} px from ${g.at}, ${own.toFixed(1)} from its own`)
      }
    }
    expect(misread).toEqual([])
  })
})
