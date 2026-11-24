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
import { mousePointerId } from './engine'
import { boundary, controlState, drag, frame, heightOf, region } from './harness'

/**
 * THE REGIONS THAT DO NOT START WITH A SHARE, AND THE ONE THAT TAKES THE REST — the view layouts spec §11.1.
 *
 * The λ view's term map keeps its own height, 120 px, until a boundary beside it is dragged, as the source view's
 * outline does, which `panel-sizes-stored.test.ts` has, since only the app builds that view. From the first drag each
 * has a share (`data-sized`). And the λ term takes what its view has spare, past six tenths of the WINDOW. A TM view's
 * regions each start with a share.
 */

const CONTROLS = controlState(false, '0')

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
  ...over,
})

let mouseId: number

const hostOf = (kind: string, height: number, width = 640): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane'
  el.dataset.kind = kind
  el.style.height = `${height}px`
  el.style.width = `${width}px`
  document.body.append(el)
  return el
}

beforeAll(async () => {
  await page.viewport(1280, 1000)
  // THE PAGE'S FONTS FIRST, ASKED FOR BY NAME, since nothing on the page has used them yet: a line's height is the
  // font's, and a floor of five lines and a header's height settle as the fonts arrive.
  await Promise.all([document.fonts.load('12px "Hack"'), document.fonts.load('12px "Inter"')])
  mouseId = await mousePointerId()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the TM view’s rules and diagram', () => {
  const STATES = 200
  /** A chain of states, one per instruction, each with one rule to the next: a table far taller than the view. */
  const PROGRAM: TmProgram = {
    states: Array.from({ length: STATES }, (_, i) => ({
      name: `q${i}`,
      accept: i === STATES - 1,
      rules: i === STATES - 1 ? [] : [{ read: [null], write: [null], moves: ['S' as const], next: i + 1 }],
      instr: i,
    })),
    alphabet: ['_'],
    tapes: 1,
    width: 4,
    start: 0,
    listing: Array.from({ length: STATES }, (_, i) => `li\tr0, #${i}`),
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

  const mount = () => {
    const sizes = vi.fn<(s: Shares) => void>()
    const host = hostOf('tm', 900)
    const pane = new TmPane(host, events({ panelSizes: sizes }))
    pane.setProgram(PROGRAM, ['t'])
    pane.render(FRAME, CONTROLS)
    return { host, sizes }
  }

  it('drags the boundary between the rules and the diagram by the diagram’s title, and leaves it open', async () => {
    const { host, sizes } = mount()
    await frame()
    const [rules, diagram] = [region(host, 'rules'), region(host, 'diagram')]
    const bar = diagram.querySelector('.panel-header') as HTMLElement
    const t = diagram.querySelector('.panel-toggle') as HTMLElement
    expect(bar.dataset.resizes, 'precondition: the diagram’s header is a handle').toBe('true')
    expect(getComputedStyle(t).cursor, 'the diagram’s title').toBe('grab')
    const was = { rules: heightOf(rules), diagram: heightOf(diagram) }
    // 50 PX, A WHOLE NUMBER OF PAGE PX IN THE SCALED FRAME: Playwright's Firefox moves the mouse by whole page px.
    await drag(host, t, -50)
    expect(heightOf(diagram), 'the diagram did not take 50 px').toBeCloseTo(was.diagram + 50, 0)
    expect(heightOf(rules), 'the rules did not give them').toBeCloseTo(was.rules - 50, 0)
    expect(t.getAttribute('aria-expanded'), 'the diagram is drawn closed').toBe('true')
    expect(Object.keys(sizes.mock.calls.at(-1)?.[0] as Shares).sort()).toEqual(['diagram', 'rules'])
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

  it('drags the boundary over the map by its title, and leaves it open', async () => {
    const { host } = mount(700)
    await frame()
    const map = region(host, 'map')
    const t = map.querySelector('.panel-toggle') as HTMLElement
    expect(getComputedStyle(t).cursor, 'the map’s title').toBe('grab')
    const was = { term: heightOf(term(host)), map: heightOf(map) }
    await drag(host, t, -100)
    await frame()
    expect(heightOf(map), 'the map did not take 100 px').toBeCloseTo(was.map + 100, 0)
    expect(heightOf(term(host)), 'the term did not give them').toBeCloseTo(was.term - 100, 0)
    expect(t.getAttribute('aria-expanded'), 'the map is drawn closed').toBe('true')
  })

  it('closes a map its title gave a share to as far as a map nobody dragged closes', async () => {
    const { host } = mount(700)
    await frame()
    const map = region(host, 'map')
    const t = map.querySelector('.panel-toggle') as HTMLElement
    await userEvent.click(t)
    await frame()
    expect(t.getAttribute('aria-expanded'), 'precondition: the click closed the map').toBe('false')
    const closed = heightOf(map)
    await userEvent.click(t)
    await frame()
    await drag(host, t, -100)
    await frame()
    expect(map.dataset.sized, 'precondition: the drag gave the map a share').toBe('true')
    await userEvent.click(t)
    await frame()
    expect(t.getAttribute('aria-expanded'), 'precondition: the click closed the map').toBe('false')
    expect(heightOf(map), 'the closed map is taller than one nobody dragged').toBeCloseTo(closed, 0)
    expect(heightOf(host.querySelector('.term-map-host') as HTMLElement), 'the closed map draws its body').toBe(0)
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
          new PointerEvent(type, {
            pointerId: mouseId,
            bubbles: true,
            clientX: x,
            clientY: y,
            isPrimary: true,
            button: 0,
          }),
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
