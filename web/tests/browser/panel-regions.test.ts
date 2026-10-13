import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { Shares } from '../../src/panel-stack'
import { LAMBDA_TREE_NODES } from '../../src/protocol'
import { TmPane } from '../../src/tm-pane'
import type { LambdaState, TmProgram, TmState } from '../../src/types'
import { DEFAULT_DISPLAY } from '../../src/workspace'
import { wireOf } from '../node/tree-fixture'

/**
 * THE REGIONS THAT DO NOT START WITH A SHARE, AND THE ONE THAT TAKES THE REST — the view layouts spec §11.1.
 *
 * Three regions kept their own height before a boundary could be dragged and still do until one beside them is: a
 * copy's text, as tall as what it holds up to eight lines; the λ view's term map, 120 px; and the source view's
 * outline, which `panel-sizes-stored.test.ts` has, since only the app builds that view. From the first drag each
 * has a share (`data-sized`). And the λ term, which was capped at six tenths of the WINDOW whatever its view's
 * height, takes what its view has spare.
 */

const CONTROLS = {
  canRestart: true,
  canBack: false,
  canForward: true,
  canToNewest: true,
  canPlay: true,
  playing: false,
  stepText: '0',
  continueLabel: null,
}

const events = (over: Partial<PaneEvents> = {}): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  toNewest: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
  editSink: () => vi.fn(),
  collapse: vi.fn(),
  ...over,
})

const hostOf = (kind: string, height: number, width = 640): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane'
  el.dataset.kind = kind
  el.style.height = `${height}px`
  el.style.width = `${width}px`
  document.body.append(el)
  return el
}
const heightOf = (el: Element): number => el.getBoundingClientRect().height
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))
const region = (host: HTMLElement, name: string) => host.querySelector(`[data-region="${name}"]`) as HTMLElement
const boundary = (host: HTMLElement, above: string, below: string) =>
  host.querySelector(`.panel-boundary[data-above="${above}"][data-below="${below}"]`) as HTMLElement

/** A real drag of `handle` by `dy` pixels, both ends aimed inside `host`. */
async function drag(host: HTMLElement, handle: HTMLElement, dy: number): Promise<void> {
  const [h, area] = [handle.getBoundingClientRect(), host.getBoundingClientRect()]
  const x = h.left - area.left + h.width / 2
  const y = h.top - area.top + h.height / 2
  await userEvent.dragAndDrop(host, host, { sourcePosition: { x, y }, targetPosition: { x, y: y + dy } })
  await frame()
}

beforeAll(async () => {
  await page.viewport(1280, 1000)
  // THE PAGE'S FONTS FIRST, ASKED FOR BY NAME, since nothing on the page has used them yet: a line's height is the
  // font's, and a floor of five lines and a header's height settle as the fonts arrive.
  await Promise.all([document.fonts.load('12px "Hack"'), document.fonts.load('12px "Inter"')])
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('a copy’s text, in a TM view', () => {
  const STATES = 200
  /** A chain of states, each with one rule to the next: a table far taller than the view. */
  const PROGRAM: TmProgram = {
    states: Array.from({ length: STATES }, (_, i) => ({
      name: `q${i}`,
      accept: i === STATES - 1,
      rules: i === STATES - 1 ? [] : [{ read: [null], write: [null], moves: ['S' as const], next: i + 1 }],
      instr: null,
    })),
    alphabet: ['_'],
    tapes: 1,
    width: 4,
    start: 0,
    listing: [],
    labels: [],
  }
  const FRAME: TmState = {
    state: 0,
    step: 0,
    heads: [0],
    window_start: [0],
    window: ['_'],
    source_node: null,
    rule: 0,
  }
  /** Three lines: shorter than the eight a text panel shows before it scrolls. */
  const TEXT = 'tapes 1\nstart q0\naccept q1\n'

  const mount = () => {
    const sizes = vi.fn<(s: Shares) => void>()
    const host = hostOf('tm', 900)
    const pane = new TmPane(host, events({ panelSizes: sizes }))
    pane.setProgram(PROGRAM, ['t'])
    pane.render(FRAME, CONTROLS)
    pane.setEditor(TEXT)
    return { host, pane, sizes }
  }

  it('keeps its own height, with a boundary under it, above the tapes', async () => {
    const { host } = mount()
    await frame()
    const text = region(host, 'text')
    expect(text.hidden, 'precondition: the text panel is shown').toBe(false)
    expect(text.dataset.sized, 'a text nobody dragged has a share').toBeUndefined()
    const lines = host.querySelectorAll('.term-editor .cm-line').length
    expect(lines, 'precondition: the editor holds the text’s lines').toBeGreaterThanOrEqual(3)
    expect(heightOf(text), 'the text panel is not as tall as its three lines and its header').toBeLessThan(140)
    const b = boundary(host, 'text', 'rules')
    expect(b.getAttribute('aria-label')).toBe('resize text and rules')
    // UNDER THE UPPER REGION: the status line and the tapes lie between it and the rules, and keep their own height.
    expect(b.previousElementSibling).toBe(text)
    expect(b.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      (host.querySelector('.tapes') as HTMLElement).getBoundingClientRect().top + 0.5,
    )
    // THE TEXT'S PART OF THE TWO AS THEY ARE DRAWN, though it has no share to say.
    b.focus()
    const rules = region(host, 'rules')
    expect(b.getAttribute('aria-valuenow')).toBe(
      String(Math.round((heightOf(text) / (heightOf(text) + heightOf(rules))) * 100)),
    )
  })

  it('takes a share at the first drag, and the tapes move with the boundary at the height they had', async () => {
    const { host, sizes } = mount()
    await frame()
    const tapes = host.querySelector('.tapes') as HTMLElement
    const [text, rules, diagram] = [region(host, 'text'), region(host, 'rules'), region(host, 'diagram')]
    const was = { text: heightOf(text), rules: heightOf(rules), diagram: heightOf(diagram), tapes: heightOf(tapes) }
    const tapesTop = tapes.getBoundingClientRect().top
    await drag(host, boundary(host, 'text', 'rules'), 80)
    expect(text.dataset.sized).toBe('true')
    expect(heightOf(text), 'the text did not take 80 px').toBeCloseTo(was.text + 80, 0)
    expect(heightOf(rules), 'the rules did not give them').toBeCloseTo(was.rules - 80, 0)
    expect(heightOf(diagram), 'the diagram, which the boundary does not part, moved').toBeCloseTo(was.diagram, 1)
    expect(heightOf(tapes), 'the tapes did not keep their height').toBe(was.tapes)
    expect(tapes.getBoundingClientRect().top, 'the tapes did not move down with the boundary').toBeCloseTo(
      tapesTop + 80,
      0,
    )
    expect(host.scrollHeight, 'the view grew').toBe(host.clientHeight)
    // THE EDITOR FILLS THE SHARE ITS PANEL HAS, and scrolls inside it where its text is longer.
    const editor = host.querySelector('.term-editor') as HTMLElement
    expect(editor.getBoundingClientRect().bottom).toBeCloseTo(text.getBoundingClientRect().bottom, 0)
    // THE TWO REGIONS THE BOUNDARY PARTS HAVE A SHARE FROM THE DRAG, in the diagram's measure: it is built with a
    // share of 1 and has none stored, so a share is a height as a multiple of the diagram's.
    const s = sizes.mock.calls.at(-1)?.[0] as Shares
    expect(Object.keys(s).sort()).toEqual(['rules', 'text'])
    expect(s.rules as number).toBeCloseTo(heightOf(rules) / heightOf(diagram), 2)
    expect(s.text as number).toBeCloseTo(heightOf(text) / heightOf(diagram), 2)
  })

  it('goes back to its own height at Enter on its boundary', async () => {
    const { host, sizes } = mount()
    await frame()
    const text = region(host, 'text')
    const was = heightOf(text)
    await drag(host, boundary(host, 'text', 'rules'), 80)
    expect(heightOf(text), 'precondition: the drag moved the boundary').toBeGreaterThan(was + 70)
    boundary(host, 'text', 'rules').focus()
    await userEvent.keyboard('{Enter}')
    await frame()
    expect(text.dataset.sized).toBeUndefined()
    expect(heightOf(text)).toBeCloseTo(was, 0)
    expect(Object.keys(sizes.mock.calls.at(-1)?.[0] as Shares)).toEqual([])
  })
  /**
   * **A MAXIMISE ENDS WHEN ITS PANEL LEAVES THE VIEW.** A copy's text panel is hidden when its editor is taken down,
   * and a maximise of it then drew every other panel closed for a panel nobody could see, with no pressed button
   * left to press.
   */
  it('ends a maximise of its panel when the editor is taken down', async () => {
    const { host, pane } = mount()
    await frame()
    const expanded = (name: string) =>
      host.querySelector(`[data-panel="${name}"] .panel-toggle`)?.getAttribute('aria-expanded')
    await userEvent.click(host.querySelector('[data-panel="text"] .panel-maximise') as HTMLElement)
    await frame()
    expect([expanded('rules'), expanded('diagram')], 'precondition: the maximise drew the others closed').toEqual([
      'false',
      'false',
    ])
    pane.setEditor(null)
    await frame()
    expect(region(host, 'text').hidden, 'precondition: the text panel is hidden').toBe(true)
    expect([expanded('rules'), expanded('diagram')], 'the other panels are still drawn closed').toEqual([
      'true',
      'true',
    ])
    expect(
      host.querySelectorAll('.panel-maximise[aria-pressed="true"]').length,
      'a maximise button is still pressed',
    ).toBe(0)
    expect(boundary(host, 'rules', 'diagram'), 'no boundary is drawn between the two').not.toBeNull()
  })
})

describe('the λ view’s term and its map', () => {
  const STATE: LambdaState = { text: 'x', spans: new Uint8Array(), cut: null, step: 0, redex_span: null, owner: 'None' }
  /** 4,999 arguments of three nodes, each joined by an application: one argument a line, under the cap by three. */
  const BIG = `g ${Array.from({ length: 4_999 }, () => '(a b)').join(' ')}`

  const mount = (height: number, mode: 'icicle' | 'minimap' = 'icicle') => {
    const sizes = vi.fn<(s: Shares) => void>()
    const host = hostOf('lambda', height)
    const pane = new LambdaPane(host, events({ panelSizes: sizes }), {
      display: { ...DEFAULT_DISPLAY, map: mode },
      map: true,
    })
    pane.render(STATE, CONTROLS)
    const wire = wireOf(BIG)
    pane.renderTree({ kind: 'tree', tree: wire })
    return { host, pane, sizes, nodes: wire.kind.length }
  }
  const term = (host: HTMLElement) => host.querySelector('.term') as HTMLElement
  const canvas = (host: HTMLElement) => host.querySelector('.term-map') as HTMLCanvasElement

  it('gives the term what the view has spare, past six tenths of the window', async () => {
    const { host } = mount(950)
    await frame()
    expect(innerHeight, 'precondition: the window is 1,000 px tall').toBe(1000)
    expect(heightOf(term(host)), 'the term is capped at six tenths of the window').toBeGreaterThan(
      0.6 * innerHeight + 50,
    )
    // FROM UNDER THE VIEW'S HEADER TO THE BOUNDARY OVER ITS MAP, and the view does not scroll.
    expect(term(host).getBoundingClientRect().bottom).toBeCloseTo(
      boundary(host, 'term', 'map').getBoundingClientRect().top,
      0,
    )
    expect(region(host, 'map').getBoundingClientRect().bottom).toBeCloseTo(host.getBoundingClientRect().bottom, 0)
    expect(host.scrollHeight).toBe(host.clientHeight)
  })

  it('keeps the map at 120 px until its bar is dragged, and draws it at the height it has after', async () => {
    const { host, sizes } = mount(700)
    await frame()
    const map = region(host, 'map')
    expect(map.dataset.sized, 'a map nobody dragged has a share').toBeUndefined()
    expect(canvas(host).clientHeight).toBe(120)
    const was = { term: heightOf(term(host)), map: heightOf(map) }
    await drag(host, map.querySelector('.panel-header') as HTMLElement, -100)
    await frame()
    expect(map.dataset.sized).toBe('true')
    expect(heightOf(map), 'the map did not take 100 px').toBeCloseTo(was.map + 100, 0)
    expect(heightOf(term(host)), 'the term did not give them').toBeCloseTo(was.term - 100, 0)
    expect(canvas(host).clientHeight, 'the canvas does not fill the share its panel has').toBe(220)
    expect(canvas(host).height, 'the map was not drawn again at the height it has').toBe(
      Math.round(220 * devicePixelRatio),
    )
    expect(Object.keys(sizes.mock.calls.at(-1)?.[0] as Shares).sort()).toEqual(['map', 'term'])
  })

  /**
   * **THE TERM'S ROWS ARE THE ONES IN ITS BOX, AT EVERY FRAME OF A DRAG** (spec §11.5's first point). The term draws
   * the lines in view and a few past each edge, and a boundary dragged down gives it a taller box with nothing else
   * to say so: `LambdaBody`'s own resize observer draws again before the frame is shown. On the largest term a view
   * lays out, scrolled to its middle so there are rows to need past both edges, with this file's own pointer events:
   * the driver's drag is one move, and the frames between a press and a release are what is held.
   */
  for (const mode of ['icicle', 'minimap'] as const) {
    it(`keeps the term’s rows over its whole box at every frame of a drag, and the map drawn at its height (${mode})`, async () => {
      const { host, nodes } = mount(700, mode)
      expect(nodes, 'precondition: the term is three nodes under the most a view lays out').toBe(LAMBDA_TREE_NODES - 3)
      await frame()
      const box = term(host)
      expect(box.scrollHeight, 'precondition: the term is far taller than its box').toBeGreaterThan(50_000)
      box.scrollTop = 40_000
      await frame()
      await frame()
      const b = boundary(host, 'term', 'map')
      const at = b.getBoundingClientRect()
      const [x, y0] = [at.left + at.width / 2, at.top + at.height / 2]
      const fire = (type: string, y: number) =>
        b.dispatchEvent(
          new PointerEvent(type, { pointerId: 1, bubbles: true, clientX: x, clientY: y, isPrimary: true, button: 0 }),
        )
      /** How far the drawn rows fall short of the term's box, top and bottom: 0 where they cover it. */
      const gap = (): { top: number; bottom: number } => {
        const tb = box.getBoundingClientRect()
        let [top, bottom] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
        for (const r of box.querySelectorAll<HTMLElement>('.term-rows > *')) {
          const rb = r.getBoundingClientRect()
          top = Math.min(top, rb.top)
          bottom = Math.max(bottom, rb.bottom)
        }
        return { top: Math.max(0, top - tb.top), bottom: Math.max(0, tb.bottom - bottom) }
      }
      expect(gap(), 'precondition: the rows cover the box before the drag').toEqual({ top: 0, bottom: 0 })

      const heights = new Set<number>()
      const worst = { top: 0, bottom: 0 }
      let undrawn = 0
      fire('pointerdown', y0)
      // UP, SO THE TERM SHRINKS, THEN DOWN PAST WHERE IT BEGAN: growing is what needs rows the last frame lacked.
      const path = [
        ...Array.from({ length: 30 }, (_, i) => y0 - (i + 1) * 10),
        ...Array.from({ length: 45 }, (_, i) => y0 - 300 + (i + 1) * 10),
      ]
      for (const y of path) {
        fire('pointermove', y)
        await frame()
        await frame()
        const g = gap()
        worst.top = Math.max(worst.top, g.top)
        worst.bottom = Math.max(worst.bottom, g.bottom)
        heights.add(box.clientHeight)
        const map = canvas(host)
        if (map.height !== Math.round(map.clientHeight * devicePixelRatio)) undrawn += 1
      }
      fire('pointerup', path.at(-1) as number)
      expect(heights.size, 'precondition: the drag gave the term many heights').toBeGreaterThan(30)
      expect(Math.max(...heights) - Math.min(...heights), 'precondition: and they differ by hundreds').toBeGreaterThan(
        300,
      )
      expect(worst, 'a frame showed the term’s box with rows missing').toEqual({ top: 0, bottom: 0 })
      expect(undrawn, 'frames at which the map was not drawn at the height it had').toBe(0)
    })
  }
})
