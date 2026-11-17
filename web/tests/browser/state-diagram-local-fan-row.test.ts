import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import FACT_12 from '../../src/examples/fact-12.rxt?raw'
import { diagram, diagramChoice, frames, SHELL, stateIdle, tmPane, tmStatus, until } from './harness'

/**
 * A fan whose middle line runs along its row (`docs/superpowers/specs/2026-11-16-state-diagram-tidy-design.md`, the
 * fans): `fact(12)`'s level under binary in `bmul17.s9.up31`, laid out over 829 px, the 844 px panel less a classic
 * scroll bar's room. Its names are as long as the cap shows whole, so in either engine's font the level is wider than
 * that and its gaps no wider than their labels need, where a row is set furthest apart for the label along it to sit
 * by its own line, the line a reader takes it to belong to. The TM copy starts in that state rather than walking there.
 */

const STATE = 'bmul17.s9.up31'
const level = () => diagram().querySelector('.local-level') as HTMLElement
const nodes = () => [...diagram().querySelectorAll<HTMLElement>('.local-node')]

/** The TM view's own copy's editor, detached from the program first. */
async function copyEditor(): Promise<EditorView> {
  const content = () => tmPane().querySelector<HTMLElement>('.term-editor .cm-content')
  if (content() === null) tmPane().querySelector<HTMLButtonElement>('button.detach')?.click()
  await until(() => content() !== null, 'the copy to mount its editor')
  const { EditorView } = await import('@codemirror/view')
  return EditorView.findFromDOM(content() as HTMLElement) as EditorView
}

type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
/** How far the point `(x, y)` is from the box `b`: 0 inside it. */
const toBox = (x: number, y: number, b: Box) =>
  Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom))

beforeAll(async () => {
  await page.viewport(1280, 2400)
  document.body.innerHTML = SHELL
  const view = await (await import('../../src/main')).ready
  // THE TM VIEW ALONE IN ITS ROW, as the other local-level files have it.
  document.querySelector<HTMLButtonElement>('[data-leaf="rxm-0"] button.view-close')?.click()
  await until(() => document.querySelector('[data-leaf="rxm-0"]') === null, 'the rxm view to close')
  // PICKED FROM THE MENU, which also sets the binary encoding, whose state names these are.
  await userEvent.click(document.querySelector('#examples') as HTMLElement)
  await userEvent.click(document.querySelector('#examples-menu [data-example="fact-12"]') as HTMLElement)
  await until(() => view.state.doc.toString() === FACT_12 && stateIdle() && tmStatus() !== '', 'fact(12) to compile')
  tmPane().querySelector<HTMLButtonElement>('[data-panel="rules"] .panel-toggle')?.click()
  const copy = await copyEditor()
  const start = /^start .*$/m.exec(copy.state.doc.toString())
  expect(start).not.toBeNull()
  const from = start?.index ?? 0
  copy.dispatch({ changes: { from, to: from + (start?.[0].length ?? 0), insert: `start ${STATE}` } })
  await until(() => tmStatus().startsWith(`${STATE} `), `the copy to start in ${STATE}`)
  await userEvent.click(diagramChoice('local') as HTMLButtonElement)
  await until(() => nodes().length === 8, `the local level around ${STATE}`)
  // THE PANEL LESS A CLASSIC SCROLL BAR'S ROOM: overlay scroll bars here take none, so the panel is that wide itself.
  const chrome = window.innerWidth - level().offsetWidth
  await page.viewport(829 + chrome, 2400)
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
