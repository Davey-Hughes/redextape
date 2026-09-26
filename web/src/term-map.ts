import { type Line, lineText } from './lambda-layout'
import { KIND_ABS, type Tree } from './lambda-tree'

/** The term map's two views of one term (spec §6). */
export type MapMode = 'icicle' | 'minimap'

/** A rectangle in fractions of the map, `0..1` on both axes. */
export type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/**
 * Node `i`'s icicle rectangle: one row per depth, and as wide as its subtree.
 *
 * **PRE-ORDER MAKES THIS ARITHMETIC.** Node `i`'s subtree is the index range `[i, i + size[i])`, so its
 * horizontal extent is that range over the node count — no layout pass, and every subtree nests inside
 * its parent's extent by construction.
 */
export function icicleRect(t: Tree, i: number): Rect {
  const rows = t.maxDepth + 1
  return { x: i / t.count, y: (t.depth[i] as number) / rows, w: (t.size[i] as number) / t.count, h: 1 / rows }
}

/**
 * The node an icicle click at fractions `(fx, fy)` names: the node at that row whose extent covers `fx` —
 * or, where the column ends above that row, the deepest node there.
 */
export function nodeAtIcicle(t: Tree, fx: number, fy: number): number {
  const row = Math.min(t.maxDepth, Math.max(0, Math.floor(fy * (t.maxDepth + 1))))
  let at = Math.min(t.count - 1, Math.max(0, Math.floor(fx * t.count)))
  while (at > 0 && (t.depth[at] as number) > row) at = t.parent[at] as number
  return at
}

/**
 * The node range the lines `first..last` show, as `[lo, hi)` in pre-order — the icicle's viewport box.
 * `null` when those lines show no node.
 */
export function visibleNodes(
  t: Tree,
  lines: readonly Line[],
  first: number,
  last: number,
): { lo: number; hi: number } | null {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let l = Math.max(0, first); l <= last && l < lines.length; l += 1) {
    for (const tok of (lines[l] as Line).tokens) {
      lo = Math.min(lo, tok.node)
      hi = Math.max(hi, tok.node + (tok.kind === 'fold' ? (t.size[tok.node] as number) : 1))
    }
  }
  return lo === Number.POSITIVE_INFINITY ? null : { lo, hi }
}

/** A minimap line's height, in CSS pixels — spec §6's "every line … at 2 px". */
export const MINIMAP_LINE = 2

/**
 * How far the minimap is scrolled, in CSS pixels, over `lineCount` lines of which the view shows `first..last`,
 * in a map `height` CSS pixels tall.
 *
 * **AN EDITOR'S MINIMAP.** A term that fits is drawn from the top and never scrolls. A taller one scrolls as far
 * through its overflow as the view is through its own, so the picture of the view's window moves from the
 * map's top to its bottom as the view does, and never leaves it.
 */
export function minimapScroll(lineCount: number, first: number, last: number, height: number): number {
  const over = lineCount * MINIMAP_LINE - height
  const room = lineCount - (last - first + 1)
  if (over <= 0 || room <= 0) return 0
  return (Math.min(Math.max(first, 0), room) / room) * over
}

/** The line a minimap click `y` CSS pixels below the map's top names, with the minimap scrolled by `scroll`. */
export function lineAtMinimap(lineCount: number, y: number, scroll: number): number {
  return Math.min(Math.max(0, lineCount - 1), Math.max(0, Math.floor((y + scroll) / MINIMAP_LINE)))
}

/** What the map draws, and marks. */
export type MapState = {
  readonly tree: Tree
  readonly lines: readonly Line[]
  readonly mode: MapMode
  /** The lines the body shows, first and last. */
  readonly first: number
  readonly last: number
  /** Linked nodes, by index. */
  readonly linked: readonly number[]
}

/** What a click on the map names: a node (icicle) or a line (minimap). */
export type MapPick = { readonly node: number } | { readonly line: number }

/** The palette tokens the map draws with. */
const TOKENS = ['--rule', '--tok-binder', '--tok-nat', '--tok-operator', '--link-edge', '--accent'] as const

/**
 * The term map: one canvas, drawn as an icicle or as a minimap (spec §6).
 *
 * **EVERY COLOUR IS A PALETTE TOKEN**, resolved at draw time — the colour gate holds `style.css` to its
 * palette, and a canvas that hard-coded a colour would be the one surface the palette could not reach.
 *
 * **RESOLVED THROUGH A COMPUTED `color`, NOT READ AS TEXT.** Every token is a `light-dark(…)` pair, in
 * `style.css`'s fallback and in what `skin.ts` writes alike, and a canvas's `fillStyle` ignores one: read as
 * text, the whole map was drawn in black. An element's computed `color` is the pair resolved against the
 * page's colour scheme. So the colours are part of what the map last drew, too: the first draw after a theme
 * or palette change is not skipped as unchanged.
 */
export class TermMap {
  readonly el: HTMLCanvasElement
  #state: MapState | null = null
  /** What the canvas last drew, so a frame that changes none of it redraws nothing. */
  #drawn: { sig: string; tree: Tree; lines: readonly Line[] } | null = null
  /** How far the minimap was last drawn scrolled, in CSS pixels — a click maps through it. */
  #scroll = 0

  constructor(onPick: (pick: MapPick) => void) {
    this.el = document.createElement('canvas')
    this.el.className = 'term-map'
    this.el.setAttribute('role', 'img')
    this.el.addEventListener('click', (e) => {
      const s = this.#state
      if (s === null || this.el.clientWidth === 0 || this.el.clientHeight === 0) return
      const fx = e.offsetX / this.el.clientWidth
      const fy = e.offsetY / this.el.clientHeight
      onPick(
        s.mode === 'icicle'
          ? { node: nodeAtIcicle(s.tree, fx, fy) }
          : { line: lineAtMinimap(s.lines.length, e.offsetY, this.#scroll) },
      )
    })
  }

  draw(state: MapState): void {
    this.#state = state
    const w = this.el.clientWidth
    // THE HEIGHT IS THE STYLESHEET'S (`.term-map`), read here rather than written twice.
    const h = this.el.clientHeight
    const ratio = window.devicePixelRatio || 1
    const resolved = this.#resolve()
    const sig = `${state.mode}:${state.first}:${state.last}:${state.linked.join(',')}:${w}:${h}:${ratio}:${[...resolved.values()].join()}`
    const d = this.#drawn
    if (d !== null && d.sig === sig && d.tree === state.tree && d.lines === state.lines) return
    this.#drawn = { sig, tree: state.tree, lines: state.lines }
    this.el.setAttribute(
      'aria-label',
      state.mode === 'icicle'
        ? `term map: ${state.tree.count} nodes by depth`
        : `term map: ${state.lines.length} lines`,
    )
    this.el.width = Math.max(1, Math.round(w * ratio))
    this.el.height = Math.max(1, Math.round(h * ratio))
    const ctx = this.el.getContext('2d')
    if (ctx === null) return
    const colour = (name: string) => resolved.get(name) ?? ''
    const W = this.el.width
    const H = this.el.height
    ctx.clearRect(0, 0, W, H)
    if (state.mode === 'icicle') this.#icicle(ctx, state, W, H, colour)
    else this.#minimap(ctx, state, W, H, ratio, colour)
  }

  /**
   * Draw nothing, and say why: the view shows no tree to map. A click on an empty map picks nothing, and the
   * next `draw` draws in full.
   */
  clear(reason: string): void {
    const label = `term map: empty — ${reason}`
    if (this.#state === null && this.el.getAttribute('aria-label') === label) return
    this.#state = null
    this.#drawn = null
    this.el.setAttribute('aria-label', label)
    this.el.getContext('2d')?.clearRect(0, 0, this.el.width, this.el.height)
  }

  /** Each token the map draws with, as the colour the page resolves it to. */
  #resolve(): Map<string, string> {
    const out = new Map<string, string>()
    for (const token of TOKENS) {
      this.el.style.color = `var(${token})`
      out.set(token, getComputedStyle(this.el).color)
    }
    this.el.style.color = ''
    return out
  }

  #icicle(ctx: CanvasRenderingContext2D, s: MapState, W: number, H: number, colour: (n: string) => string): void {
    const t = s.tree
    const rule = colour('--rule')
    const binder = colour('--tok-binder')
    const nat = colour('--tok-nat')
    ctx.globalAlpha = 0.6
    for (let i = 0; i < t.count; i += 1) {
      const r = icicleRect(t, i)
      ctx.fillStyle = t.chip(i)?.kind === 'numeral' ? nat : t.kind(i) === KIND_ABS ? binder : rule
      ctx.fillRect(r.x * W, r.y * H, Math.max(r.w * W, 0.5), r.h * H - 0.5)
    }
    ctx.globalAlpha = 1
    const column = (i: number, stroke: string, fill: boolean) => {
      const r = icicleRect(t, i)
      const x = r.x * W
      const y = r.y * H
      const w = Math.max(r.w * W, 1)
      if (fill) {
        ctx.globalAlpha = 0.25
        ctx.fillStyle = stroke
        ctx.fillRect(x, y, w, H - y)
        ctx.globalAlpha = 1
      }
      ctx.strokeStyle = stroke
      ctx.lineWidth = 1.5
      ctx.strokeRect(x, y, w, H - y)
    }
    const op = colour('--tok-operator')
    if (t.wire.contractum !== null) column(t.wire.contractum, op, true)
    if (t.wire.nextRedex !== null) column(t.wire.nextRedex, op, false)
    for (const l of s.linked) column(l, colour('--link-edge'), false)
    const seen = visibleNodes(t, s.lines, s.first, s.last)
    if (seen !== null) {
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = colour('--accent')
      ctx.lineWidth = 2
      ctx.strokeRect((seen.lo / t.count) * W, 1, Math.max(((seen.hi - seen.lo) / t.count) * W, 2), H - 2)
      ctx.setLineDash([])
    }
  }

  /**
   * Every line `MINIMAP_LINE` CSS pixels tall with its indentation, its bar one device pixel short of that so
   * lines stay apart, scrolled by `minimapScroll`. The next redex's lines are drawn in `--tok-operator` and
   * linked lines in `--link-edge`; the contractum's lines sit on a band of `--tok-operator`, as its column is
   * filled in the icicle; the view's window is outlined in `--accent`.
   */
  #minimap(
    ctx: CanvasRenderingContext2D,
    s: MapState,
    W: number,
    H: number,
    ratio: number,
    colour: (n: string) => string,
  ): void {
    const t = s.tree
    const lh = MINIMAP_LINE * ratio
    // WHOLE DEVICE PIXELS, so a scrolled line's bar is as sharp as an unscrolled one's.
    const top = Math.round(minimapScroll(s.lines.length, s.first, s.last, H / ratio) * ratio)
    this.#scroll = top / ratio
    let cols = 1
    for (const line of s.lines) cols = Math.max(cols, line.indent + lineText(line).length)
    const cw = W / cols
    const redex = t.wire.nextRedex
    const contractum = t.wire.contractum
    const rule = colour('--rule')
    const op = colour('--tok-operator')
    const link = colour('--link-edge')
    const end = Math.min(s.lines.length, Math.ceil((top + H) / lh))
    for (let l = Math.floor(top / lh); l < end; l += 1) {
      const line = s.lines[l] as Line
      const nodes = line.tokens.map((k) => k.node)
      const y = l * lh - top
      if (contractum !== null && nodes.some((x) => t.contains(contractum, x))) {
        ctx.globalAlpha = 0.25
        ctx.fillStyle = op
        ctx.fillRect(0, y, W, lh)
        ctx.globalAlpha = 1
      }
      const marked = redex !== null && nodes.some((x) => t.contains(redex, x))
      const linked = s.linked.some((a) => nodes.some((x) => t.contains(a, x)))
      ctx.fillStyle = marked ? op : linked ? link : rule
      ctx.fillRect(line.indent * cw, y, Math.max(lineText(line).length * cw, 1), Math.max(lh - 1, 1))
    }
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = colour('--accent')
    ctx.lineWidth = 2
    ctx.strokeRect(1, s.first * lh - top, W - 2, Math.max((s.last - s.first + 1) * lh, 2))
    ctx.setLineDash([])
  }
}
