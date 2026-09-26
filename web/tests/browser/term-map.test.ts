import { afterEach, describe, expect, it, vi } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import { Tree } from '../../src/lambda-tree'
import type { PaneEvents } from '../../src/pane-chrome'
import { icicleRect, TermMap } from '../../src/term-map'
import type { LambdaState } from '../../src/types'
import { DEFAULT_DISPLAY } from '../../src/workspace'
import { wireOf } from '../node/tree-fixture'

/** The term map panel on a λ view built directly (Plan 7 part 4a, spec §6). */
const host = (): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane term-map-fixture'
  el.style.width = '640px'
  document.body.append(el)
  return el
}

const events = (over: Partial<PaneEvents> = {}): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
  ...over,
})

const frame: LambdaState = { text: 'x', spans: [], cut: null, step: 0, redex_span: null, owner: 'None' }
const CONTROLS = {
  canRestart: true,
  canBack: false,
  canForward: true,
  canPlay: true,
  playing: false,
  stepText: '0',
  continueLabel: null,
}

/** 300 short arguments, one line each: nothing folded, and far taller than the view. */
const WIDE = `g ${Array.from({ length: 300 }, (_, i) => `(a${i} b${i})`).join(' ')}`

/** `(a<from> b<from>) … (a<to-1> b<to-1>)`. */
const args = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => `(a${from + i} b${from + i})`).join(' ')

/** A term of one argument per line with its next redex halfway down, so a view following it is scrolled. */
const MID = `g ${args(0, 150)} ((\\x. x) y) ${args(150, 300)}`

/** A λ view's display with its term map in minimap mode. */
const MINIMAP = { ...DEFAULT_DISPLAY, map: 'minimap' } as const

/** Two animation frames: long enough for the browser to deliver a scroll's own event. */
const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

/** Click the middle of node `node`'s icicle box. */
const clickIcicle = (canvas: HTMLCanvasElement, t: Tree, node: number) => {
  const r = icicleRect(t, node)
  const box = canvas.getBoundingClientRect()
  canvas.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      clientX: box.left + (r.x + r.w / 2) * box.width,
      clientY: box.top + (r.y + r.h / 2) * box.height,
    }),
  )
}

afterEach(() => {
  for (const el of document.querySelectorAll('.term-map-fixture')) el.remove()
})

describe('the term map', () => {
  /** A closed map costs nothing: no draw for a tree, a scroll, or a view with no tree, until it is opened. */
  it('is a closed panel until opened, draws nothing while closed, and reports the toggle', () => {
    const el = host()
    const panel = vi.fn()
    const draw = vi.spyOn(TermMap.prototype, 'draw')
    const clear = vi.spyOn(TermMap.prototype, 'clear')
    try {
      const pane = new LambdaPane(el, events({ panel }))
      pane.render(frame, CONTROLS)
      pane.renderTree({ kind: 'refused', nodes: 30_000 })
      pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
      el.querySelector('.term')?.dispatchEvent(new Event('scroll'))
      const toggle = el.querySelector<HTMLButtonElement>('[data-panel="map"] .panel-toggle')
      expect(toggle?.getAttribute('aria-expanded')).toBe('false')
      expect(draw, 'nothing drawn while closed').not.toHaveBeenCalled()
      expect(clear, 'nothing cleared while closed').not.toHaveBeenCalled()
      toggle?.click()
      expect(panel).toHaveBeenCalledWith('map', true)
      expect(draw, 'drawn once opened').toHaveBeenCalled()
      const canvas = el.querySelector<HTMLCanvasElement>('.term-map') as HTMLCanvasElement
      // A NEW CANVAS IS 300 WIDE: a drawn one is as wide as it is shown.
      expect(canvas.width, 'sized to the view').toBe(Math.round(canvas.clientWidth * devicePixelRatio))
      expect(canvas.width, 'not a new canvas').not.toBe(300)
      expect(canvas.getAttribute('aria-label')).toMatch(/term map: \d+ nodes by depth/)
    } finally {
      draw.mockRestore()
      clear.mockRestore()
    }
  })

  it('switches between icicle and minimap from its header, and reports the display', () => {
    const el = host()
    const display = vi.fn()
    const pane = new LambdaPane(el, events({ display }), { map: true })
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    const mode = (m: string) => el.querySelector<HTMLButtonElement>(`.map-mode[data-value="${m}"]`)
    expect(mode('icicle')?.getAttribute('aria-checked')).toBe('true')
    mode('minimap')?.click()
    expect(mode('minimap')?.getAttribute('aria-checked')).toBe('true')
    expect(display).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY, map: 'minimap' })
    expect(el.querySelector('.term-map')?.getAttribute('aria-label')).toMatch(/term map: \d+ lines/)
  })

  /**
   * **A PICK OPENS THE FOLDS ON ITS PATH AND BRINGS THE NODE'S ROW ON SCREEN** (spec §6). `g (h A0 … A149) z`:
   * `h A0 … A149` is 601 nodes, so it starts folded — the view is one line, `g (… 601 nodes) z`, and `A149` is
   * on none. Picked, it is the last argument of a 150-line block.
   */
  it('opens the folds on the path of a node picked on the icicle, and scrolls its row on screen', async () => {
    const el = host()
    const pane = new LambdaPane(el, events(), { map: true })
    pane.render(frame, CONTROLS)
    const wire = wireOf(`g (h ${args(0, 150)}) z`, { nextRedex: null })
    const t = new Tree(wire)
    const folded = t.right(t.left(0))
    const picked = t.right(folded)
    const leaf = () => el.querySelector<HTMLElement>(`.term [data-node="${t.left(picked)}"]`)
    pane.renderTree({ kind: 'tree', tree: wire })
    const body = el.querySelector<HTMLElement>('.term') as HTMLElement
    expect(el.querySelector(`.term .term-fold[data-node="${folded}"]`), 'folded to start with').not.toBeNull()
    expect(leaf(), 'on no line to start with').toBeNull()
    clickIcicle(el.querySelector<HTMLCanvasElement>('.term-map') as HTMLCanvasElement, t, picked)
    await frames()
    expect(el.querySelector('.term .term-fold'), 'every fold on its path opened').toBeNull()
    expect(leaf()?.textContent, 'its row drawn').toBe('a149')
    const row = leaf()?.closest('.term-line')?.getBoundingClientRect()
    const view = body.getBoundingClientRect()
    expect(body.scrollTop, 'scrolled to it').toBeGreaterThan(0)
    expect(row?.top, 'on screen').toBeGreaterThanOrEqual(view.top)
    expect(row?.bottom, 'on screen').toBeLessThanOrEqual(view.bottom)
  })

  /**
   * **A PICK IS THE USER TAKING CONTROL, AND FOLLOWING MUST HEAR SO AT ONCE.** The scroll a pick makes reports
   * itself a frame later; a tree drawn before then — every frame of play draws one — still followed, and put
   * the view straight back on the redex.
   */
  it('keeps the view where a pick put it, though a tree is drawn before the pick’s scroll reports itself', async () => {
    const el = host()
    const pane = new LambdaPane(el, events(), { map: true })
    pane.render(frame, CONTROLS)
    const wire = wireOf(MID)
    const t = new Tree(wire)
    pane.renderTree({ kind: 'tree', tree: wire })
    await frames()
    const body = el.querySelector<HTMLElement>('.term') as HTMLElement
    const followed = body.scrollTop
    expect(followed, 'following the redex').toBeGreaterThan(0)
    clickIcicle(el.querySelector<HTMLCanvasElement>('.term-map') as HTMLCanvasElement, t, t.right(0))
    const picked = body.scrollTop
    expect(picked, 'the pick scrolled').toBeGreaterThan(followed)
    pane.renderTree({ kind: 'tree', tree: wire })
    await frames()
    expect(body.scrollTop, 'still where the pick put it').toBe(picked)
    expect(el.querySelector<HTMLButtonElement>('.term-reattach')?.hidden, 'follow redex offered').toBe(false)
  })

  /**
   * **A VIEW WITH NO TREE HAS NOTHING TO MAP**, and the map said otherwise: over a refused step's flat text it
   * went on drawing the last tree, labelled with that tree's node count.
   */
  it('empties, and says why, when the view falls back to flat text', () => {
    const el = host()
    const pane = new LambdaPane(el, events(), { map: true })
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    const canvas = el.querySelector<HTMLCanvasElement>('.term-map') as HTMLCanvasElement
    expect(painted(canvas), 'a tree is drawn').toBeGreaterThan(0)
    pane.renderTree({ kind: 'refused', nodes: 30_000 })
    expect(el.querySelector('.term')?.getAttribute('data-layout'), 'the view shows text').toBe('flat')
    expect(painted(canvas), 'nothing is drawn').toBe(0)
    expect(canvas.getAttribute('aria-label')).toBe(
      `term map: empty — this step’s term has ${(30_000).toLocaleString()} nodes, too many to map`,
    )
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(painted(canvas), 'a tree is drawn again').toBeGreaterThan(0)
    pane.renderTree({ kind: 'none' })
    expect(painted(canvas), 'nothing is drawn while no tree has come').toBe(0)
    expect(canvas.getAttribute('aria-label')).toBe('term map: empty — no tree for this step yet')
  })

  /**
   * **EVERY LINE AT 2 PX WITH ITS INDENTATION, LIKE AN EDITOR'S MINIMAP** (spec §6) — so a short term is a
   * short picture at the top of the map, not one stretched to fill it.
   */
  it('draws each line of a short term 2 px tall, from the top of the minimap', () => {
    const el = host()
    const pane = new LambdaPane(el, events(), { map: true, display: MINIMAP })
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(`g ${args(0, 30)}`, { nextRedex: null }) })
    const canvas = el.querySelector<HTMLCanvasElement>('.term-map') as HTMLCanvasElement
    const n = Number(canvas.getAttribute('aria-label')?.match(/(\d+) lines/)?.[1])
    const ratio = canvas.width / canvas.clientWidth
    expect(n, 'one line per argument').toBeGreaterThan(20)
    expect(n * 2, 'the term is shorter than the map').toBeLessThan(canvas.clientHeight)
    const bars = rowsWhere(canvas, like(resolved(el, '--rule')))
    for (let k = 0; k < n; k += 1) {
      expect(bars, `line ${k}'s bar`).toContain(Math.round(2 * k * ratio))
      expect(bars, `the gap under line ${k}`).not.toContain(Math.round(2 * (k + 1) * ratio) - 1)
    }
    expect(Math.max(...bars), 'nothing under the last line').toBeLessThan(Math.round(2 * n * ratio))
  })

  /**
   * **A TERM TALLER THAN THE MAP SCROLLS IT, AS AN EDITOR'S MINIMAP DOES**, so the view's window stays in
   * sight — here at the redex the view follows, then at either end of the term.
   */
  it('scrolls a tall term’s minimap with the view, so the view’s window stays in sight', async () => {
    const el = host()
    const pane = new LambdaPane(el, events(), { map: true, display: MINIMAP })
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(MID) })
    await frames()
    const canvas = el.querySelector<HTMLCanvasElement>('.term-map') as HTMLCanvasElement
    const body = el.querySelector<HTMLElement>('.term') as HTMLElement
    const ratio = canvas.width / canvas.clientWidth
    const n = Number(canvas.getAttribute('aria-label')?.match(/(\d+) lines/)?.[1])
    expect(n * 2, 'the term is taller than the map').toBeGreaterThan(canvas.clientHeight * 2)
    // THE WINDOW'S TOP AND BOTTOM EDGES BOTH ON THE MAP: its outline spans as many 2 px lines as the view shows.
    const shown = Math.ceil(body.clientHeight / 20)
    const inSight = (where: string) => {
      const edges = rowsWhere(canvas, like(resolved(el, '--accent')))
      expect(edges.length, `${where}: the window is drawn`).toBeGreaterThan(0)
      expect(Math.max(...edges) - Math.min(...edges), `${where}: both of its edges`).toBeGreaterThanOrEqual(
        (2 * shown - 2) * ratio,
      )
      return edges
    }
    const edges = inSight('following the redex')
    const redex = rowsWhere(canvas, like(resolved(el, '--tok-operator')))
    expect(redex.length, 'the redex’s line is drawn').toBeGreaterThan(0)
    expect(Math.min(...redex), 'inside the window').toBeGreaterThan(Math.min(...edges))
    expect(Math.max(...redex), 'inside the window').toBeLessThan(Math.max(...edges))
    body.scrollTop = 0
    await frames()
    inSight('at the top')
    body.scrollTop = body.scrollHeight
    await frames()
    inSight('at the bottom')
  })

  /** A click names the line drawn under it, through however far the minimap is scrolled. */
  it('picks the line clicked on a scrolled minimap', async () => {
    const el = host()
    const pane = new LambdaPane(el, events(), { map: true, display: MINIMAP })
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(MID) })
    await frames()
    const canvas = el.querySelector<HTMLCanvasElement>('.term-map') as HTMLCanvasElement
    const body = el.querySelector<HTMLElement>('.term') as HTMLElement
    const ratio = canvas.width / canvas.clientWidth
    const line = Number(
      el.querySelector<HTMLElement>('.term .is-next-redex')?.closest<HTMLElement>('.term-line')?.dataset.line,
    )
    // THE REDEX'S LINE IS A LANDMARK ON THE MAP: fifteen lines under it is fifteen lines further down the term.
    const at = Math.min(...rowsWhere(canvas, like(resolved(el, '--tok-operator')))) / ratio
    const y = at + 15 * 2 + 1
    expect(y, 'the clicked line is on the map').toBeLessThan(canvas.clientHeight)
    const box = canvas.getBoundingClientRect()
    canvas.dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: box.left + box.width / 2, clientY: box.top + y }),
    )
    expect(body.scrollTop).toBe(Math.max(0, (line + 15) * 20 - body.clientHeight / 2))
  })

  /**
   * Both modes mark the contractum (spec §6): the minimap draws its lines on a band, as the icicle fills its
   * column.
   */
  it('marks the contractum in the minimap', () => {
    const el = host()
    const src = `g ${args(0, 30)}`
    const t = new Tree(wireOf(src))
    let spine = 0
    for (let k = 29; k > 10; k -= 1) spine = t.left(spine)
    const pane = new LambdaPane(el, events(), { map: true, display: MINIMAP })
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(src, { nextRedex: null, contractum: t.right(spine) }) })
    const canvas = el.querySelector<HTMLCanvasElement>('.term-map') as HTMLCanvasElement
    const ratio = canvas.width / canvas.clientWidth
    const line = Number(
      el.querySelector<HTMLElement>('.term .is-contractum')?.closest<HTMLElement>('.term-line')?.dataset.line,
    )
    expect(line, 'the contractum is on a line of its own').toBeGreaterThan(0)
    const band = rowsWhere(canvas, like(resolved(el, '--tok-operator'), [16, 160], 4))
    // THE GAP UNDER A LINE'S BAR IS THE BAND ALONE.
    const gap = (k: number) => Math.round(2 * (k + 1) * ratio) - 1
    expect(band, 'under the contractum’s bar').toContain(gap(line))
    expect(band, 'not under the next line’s').not.toContain(gap(line + 1))
  })

  /**
   * **A TOKEN'S TEXT IS NOT A COLOUR A CANVAS TAKES.** Every palette token is a `light-dark(…)` pair, which
   * `fillStyle` ignores, and the map was drawn entirely in black. `setup.ts` loads the real `style.css`, so
   * the tokens here are the ones the app ships; the colour gate cannot see this, since no literal is involved.
   */
  it('draws a node in its palette colour, and again in the other theme’s', () => {
    const el = host()
    const root = document.documentElement
    root.dataset.theme = 'light'
    try {
      const pane = new LambdaPane(el, events(), { map: true })
      pane.render(frame, CONTROLS)
      // `y`, a variable: drawn in `--rule`, and no mark crosses the middle of its box.
      const wire = wireOf('(\\x. x) y', { nextRedex: null })
      const t = new Tree(wire)
      pane.renderTree({ kind: 'tree', tree: wire })
      const canvas = el.querySelector<HTMLCanvasElement>('.term-map') as HTMLCanvasElement
      const pixel = () => {
        const r = icicleRect(t, 3)
        const x = Math.floor((r.x + r.w / 2) * canvas.width)
        const y = Math.floor((r.y + r.h / 2) * canvas.height)
        return Array.from((canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(x, y, 1, 1).data)
      }
      const light = resolved(el, '--rule')
      expect(near(pixel().slice(0, 3), light), 'the light theme’s --rule').toEqual(light)
      expect(pixel()[3], 'painted').toBeGreaterThan(0)
      root.dataset.theme = 'dark'
      const dark = resolved(el, '--rule')
      expect(dark, 'the themes differ').not.toEqual(light)
      // THE SAME TREE, THE SAME WINDOW: only the colours changed, and the map must draw again for them.
      pane.renderTree({ kind: 'tree', tree: wire })
      expect(near(pixel().slice(0, 3), dark), 'the dark theme’s --rule').toEqual(dark)
    } finally {
      delete root.dataset.theme
    }
  })
})

/**
 * The device rows of `canvas` holding a pixel, clear of its side edges, that passes `test`. The edges are left
 * out because the minimap's window outline runs down them.
 */
function rowsWhere(canvas: HTMLCanvasElement, test: (px: readonly number[]) => boolean): number[] {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const out: number[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 4; x < width - 4; x += 1) {
      const i = (y * width + x) * 4
      if (test([data[i], data[i + 1], data[i + 2], data[i + 3]] as number[])) {
        out.push(y)
        break
      }
    }
  }
  return out
}

/** A pixel of colour `rgb`, within `tolerance`, whose alpha lies in `alpha` — opaque by default. */
const like =
  (rgb: readonly number[], alpha: readonly [number, number] = [200, 255], tolerance = 3) =>
  (px: readonly number[]) =>
    (px[3] as number) >= alpha[0] &&
    (px[3] as number) <= alpha[1] &&
    rgb.every((c, i) => Math.abs(c - (px[i] as number)) <= tolerance)

/** How many of `canvas`'s pixels are painted at all. */
function painted(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let n = 0
  for (let i = 3; i < data.length; i += 4) if ((data[i] as number) > 0) n += 1
  return n
}

/** `token` as the page resolves it, `[r, g, b]` — the colour an element whose `color` is that token is drawn in. */
function resolved(where: HTMLElement, token: string): number[] {
  const probe = document.createElement('span')
  probe.style.color = `var(${token})`
  where.append(probe)
  const rgb = getComputedStyle(probe).color.match(/\d+/g)?.slice(0, 3).map(Number) ?? []
  probe.remove()
  return rgb
}

/**
 * `want` if every channel of `got` is within one of it, else `got` — so `toEqual(want)` passes on a match and
 * prints the pixel on a miss. A translucent fill is stored premultiplied, and reading it back can round a
 * channel by one.
 */
function near(got: number[], want: number[]): number[] {
  return got.length === want.length && got.every((v, i) => Math.abs(v - (want[i] as number)) <= 1) ? want : got
}
