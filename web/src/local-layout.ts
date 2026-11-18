import { type Local, type LocalEdge, REACH } from './local-level'

/**
 * The state diagram's local level as geometry: where each node, edge and label goes, from the level's data
 * (`local-level.ts`) and the widths the page measures (`Metrics`). Pure, so the rules that keep its labels clear of
 * the nodes, the self-loops and each other are tested without a page. The reasons for each rule are in
 * `docs/superpowers/specs/2026-11-16-state-diagram-tidy-design.md`.
 */

/** A node's height. MUST equal `.local-node`'s `height` in style.css, or the edges miss the boxes they join. */
export const NODE_HEIGHT = 24
/** The widest a shown name may be, in characters of the node's font: wider names are cut in the middle. */
export const CAP_CHARS = 14

/** The margin around everything drawn. */
const PAD = 8
/** The clearance either side of a label in the gap it sits in; more than a self-loop reaches past its box. */
const LABEL_MARGIN = 10
/** The narrowest gap between columns, for a level whose forward edges carry short labels or none. */
const MIN_GAP = 40
/** Between a self-loop's peak and its label. */
const LOOP_CLEAR = 3
/** Between an edge's line and its label. */
const LINE_CLEAR = 2
/** Between what hangs under one row and what stands over the next. */
const ROW_GAP = 8
/** How far below its row a backward edge's curve dips, at least. */
const BACK_DEPTH = 14
/** Between one lane of backward edges and the next one down. */
const LANE_GAP = 3
/** The step a label moves by while it meets something. */
const NUDGE = 2
/**
 * The blank between one rule and the next in a label where a rule takes several lines: without it, two rules of two
 * tapes each read as four lines with nothing to say where one rule ends.
 */
export const RULE_GAP = 4
/**
 * The least space between the labels of two different edges, across or down: twice `RULE_GAP` and wider than a space
 * in the label font, so two edges' labels never read as one label of more rules, nor as one line.
 */
export const LABEL_GAP = 8
/** The pieces a curve is cut into to stand as an obstacle to the labels of other edges. */
const LINE_PIECES = 32
/**
 * How much further than its own line any other edge's line stays from a label: the nearest line is the one a reader
 * takes a label to belong to, and a pixel keeps it so when the page measures text a fraction differently.
 */
export const NEARER = 1
/** The furthest a label is moved off its place while looking for one clear of everything and nearest its own line. */
const SEARCH = 24
/**
 * How many places past each label's best a level weighs for its labels, in all, before the rest weigh only their best
 * and then take the last resort: a place is weighed against every line near it, and where scores of lines meet, most
 * labels have no place nearer their own line and would weigh every one of their places against all those lines. A
 * level of a few dozen edges stays well under it.
 */
const WEIGHED_PLACES = 2000
/** What a label's second-best place costs, in pixels moved, over its best: the other side of its line. */
const OTHER_SIDE = 8
/** What a label's further places cost: the far end or the middle of a sloping line, where other lines may meet it. */
const FAR_PLACE = 16
/**
 * What a place beside a sloping line rather than over or under it costs: a label there reads along the line less
 * plainly, so it is taken only where every place over and under the line is crossed or nearer another line.
 */
const SIDE_PLACE = 3 * FAR_PLACE
/**
 * How far a self-loop's label keeps right of a line up its column: further than it stands over its own arc, by
 * `NEARER` and the pixel `grown` adds round a line, so the arc stays the line nearest it.
 */
const ASIDE = LOOP_CLEAR + NEARER + 1
/** The most a row is set apart from another for a label between their lines: past this, the label falls back. */
const MOST_APART = 5 * NODE_HEIGHT
/**
 * How far a label set up against its target's box stays from it: clear of the pixel `grown` adds round a box. Less
 * than `LABEL_MARGIN`, which keeps a label clear of a self-loop reaching past its source's box: no loop reaches past
 * a box's left side.
 */
const HUG = 2 * LINE_CLEAR

export type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/** What the layout needs measured, in pixels. */
export type Metrics = {
  /** The width of `text` in a node's font, at the current node's weight, so a node that becomes current fits. */
  readonly nameWidth: (text: string) => number
  /** The width of `text` in an edge label's font. */
  readonly labelWidth: (text: string) => number
  /** The label font's ascent and descent, which are what an SVG `<text>` line's box spans around its baseline. */
  readonly ascent: number
  readonly descent: number
  /** A node box's padding and border, both sides together, around its text. */
  readonly nodeChrome: number
  /** The widest a shown name may be: `CAP_CHARS` of the node's font. */
  readonly cap: number
}

export type PlacedNode = {
  readonly state: number
  readonly column: number
  readonly x: number
  readonly y: number
  readonly width: number
  /** The name as shown: whole, or cut in the middle (`shownNames`). */
  readonly text: string
}

/** An edge's label: each line's anchor is at `x`, and its baseline at the same index of `baselines`. */
export type PlacedLabel = {
  readonly x: number
  readonly anchor: 'start' | 'middle' | 'end'
  readonly lines: readonly string[]
  readonly baselines: readonly number[]
  readonly box: Box
}

/** An edge as drawn: its path, the path's box, and its label. */
export type PlacedEdge = LocalEdge & { readonly d: string; readonly box: Box; readonly label: PlacedLabel }

export type LocalLayout = {
  readonly nodes: readonly PlacedNode[]
  readonly edges: readonly PlacedEdge[]
  readonly width: number
  readonly height: number
  /**
   * The part of the drawing anything is drawn in, with `PAD` round it as over it, held to the drawing: what a placing
   * centres. Not the drawing's whole width, which in a panel wider than the level also spreads the gaps past its
   * outermost columns, and holds nothing there.
   */
  readonly inked: Box
}

type Quad = readonly [number, number, number, number]
/** A cubic Bézier, `M x0 y0 C x1 y1 x2 y2 x3 y3`. */
type Cubic = { readonly xs: Quad; readonly ys: Quad }

const at = (c: Quad, t: number): number => {
  const u = 1 - t
  return u * u * u * c[0] + 3 * u * u * t * c[1] + 3 * u * t * t * c[2] + t * t * t * c[3]
}

/** A cubic's box, from its points along it, which is what the browser's own box of the path is: not its controls. */
function cubicBox(c: Cubic): Box {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (let i = 0; i <= 64; i += 1) {
    const x = at(c.xs, i / 64)
    const y = at(c.ys, i / 64)
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  return { left, top, right, bottom }
}

/** A self-loop at the box whose right edge is `right` and top `top`: out of the right edge, over, into the top. */
const loopAt = (right: number, top: number): Cubic => ({
  xs: [right, right + 22, right - 12, right - 20],
  ys: [top + 6, top - 10, top - 18, top],
})
/** How far a self-loop rises above its box's top. */
const LOOP_RISE = -cubicBox(loopAt(0, 0)).top

/** The `y` where a cubic whose `x` only grows or only shrinks (any edge's but a loop's) crosses `x`, its ends' past them. */
function yAt(c: Cubic, x: number): number {
  const grows = c.xs[3] >= c.xs[0]
  let lo = 0
  let hi = 1
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2
    if (at(c.xs, mid) < x === grows) lo = mid
    else hi = mid
  }
  return at(c.ys, lo)
}

const meets = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const moved = (b: Box, dx: number, dy: number): Box => ({
  left: b.left + dx,
  top: b.top + dy,
  right: b.right + dx,
  bottom: b.bottom + dy,
})
/** `label` moved `dx` right and `dy` down. */
const shifted = (label: PlacedLabel, dx: number, dy: number): PlacedLabel => ({
  ...label,
  x: label.x + dx,
  baselines: label.baselines.map((b) => b + dy),
  box: moved(label.box, dx, dy),
})
/** `b` with across and down swapped, so `firstClear` moves a box sideways: two boxes turned meet as they did. */
const turned = (b: Box): Box => ({ left: b.top, top: b.left, right: b.bottom, bottom: b.right })
/** One pixel more all round, so a label measured a fraction narrower than it draws still clears what it passed. */
const grown = (b: Box): Box => ({ left: b.left - 1, top: b.top - 1, right: b.right + 1, bottom: b.bottom + 1 })
/** A placed label's box with `LABEL_GAP` all round, which another edge's label may not enter. */
const spaced = (b: Box): Box => ({
  left: b.left - LABEL_GAP,
  top: b.top - LABEL_GAP,
  right: b.right + LABEL_GAP,
  bottom: b.bottom + LABEL_GAP,
})
type Point = readonly [number, number]
/** A curve as the `LINE_PIECES + 1` points that cut it into `LINE_PIECES` straight pieces. */
const along = (c: Cubic): Point[] =>
  Array.from({ length: LINE_PIECES + 1 }, (_, i) => [at(c.xs, i / LINE_PIECES), at(c.ys, i / LINE_PIECES)] as const)
/** A curve as `LINE_PIECES` boxes, each around one piece of it and a pixel more, which together cover its line. */
function pieces(points: readonly Point[]): Box[] {
  return points.slice(1).map(([x1, y1], i) => {
    const [x0, y0] = points[i] ?? [x1, y1]
    return grown({ left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) })
  })
}

/** The distance between two boxes: 0 where they meet. */
const boxGap = (a: Box, b: Box) =>
  Math.hypot(Math.max(0, b.left - a.right, a.left - b.right), Math.max(0, b.top - a.bottom, a.top - b.bottom))
/** The distance from `(x, y)` to the segment `p`..`q`. */
function toSegment(x: number, y: number, [px, py]: Point, [qx, qy]: Point): number {
  const dx = qx - px
  const dy = qy - py
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - px) * dx + (y - py) * dy) / length))
  return Math.hypot(x - (px + t * dx), y - (py + t * dy))
}
/** Whether the segment `p`..`q` passes through `b`: some of it is left once it is clipped to each of `b`'s sides. */
function crosses([px, py]: Point, [qx, qy]: Point, b: Box): boolean {
  let t0 = 0
  let t1 = 1
  for (const [step, room] of [
    [px - qx, px - b.left],
    [qx - px, b.right - px],
    [py - qy, py - b.top],
    [qy - py, b.bottom - py],
  ] as const) {
    if (step === 0) {
      if (room < 0) return false
    } else if (step < 0) t0 = Math.max(t0, room / step)
    else t1 = Math.min(t1, room / step)
  }
  return t0 <= t1
}
/** The distance from the box `b` to the line through `points`: 0 where the line passes through it. */
function lineGap(points: readonly Point[], b: Box): number {
  const corners: Point[] = [
    [b.left, b.top],
    [b.right, b.top],
    [b.right, b.bottom],
    [b.left, b.bottom],
  ]
  let best = Number.POSITIVE_INFINITY
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i - 1] ?? [0, 0]
    const q = points[i] ?? [0, 0]
    if (crosses(p, q, b)) return 0
    const ends = [p, q].map(([x, y]) => boxGap({ left: x, top: y, right: x, bottom: y }, b))
    best = Math.min(best, ...ends, ...corners.map(([x, y]) => toSegment(x, y, p, q)))
  }
  return best
}

/**
 * How far `box` moves down, `step` at a time (up where `step` is below 0), before it meets none of `obstacles`: a
 * whole number of steps, the first at which it is clear. One pass over the obstacles rather than one per step, which
 * a label pushed past scores of lines would take millions of: each obstacle across the box's way blocks one run of
 * steps, from the first at which the moved box meets it to the last, so the runs, sorted by where they start, are
 * walked from step 0 until one starts past the step reached. Each run's ends are found with `meets` itself, so the
 * answer is the step a step-at-a-time walk stops at, to the last bit.
 */
export function firstClear(box: Box, step: number, obstacles: readonly Box[]): number {
  /** The box's top and bottom `k` steps on, worked out as `moved` works them out. */
  const top = (k: number) => box.top + step * k
  const bottom = (k: number) => box.bottom + step * k
  /** The least step from 0 at which `holds`, which stays true at every step after; `guess` is within one of it. */
  const least = (holds: (k: number) => boolean, guess: number) => {
    let k = Math.max(0, Math.floor(guess))
    while (k > 0 && holds(k - 1)) k -= 1
    while (!holds(k)) k += 1
    return k
  }
  const down = step > 0
  const runs: [number, number][] = []
  for (const o of obstacles) {
    // BESIDE THE BOX'S WAY, OR NOT A NUMBER, it is never met: `meets` is false for a box with a side that is NaN.
    if (!(o.left < box.right && box.left < o.right) || !Number.isFinite(o.top + o.bottom)) continue
    const first = down
      ? least((k) => o.top < bottom(k), (o.top - box.bottom) / step)
      : least((k) => top(k) < o.bottom, (o.bottom - box.top) / step)
    const end = down
      ? least((k) => !(top(k) < o.bottom), (o.bottom - box.top) / step)
      : least((k) => !(o.top < bottom(k)), (o.top - box.bottom) / step)
    if (first < end) runs.push([first, end])
  }
  runs.sort((a, b) => a[0] - b[0])
  let k = 0
  for (const [first, end] of runs) {
    if (first > k) break
    k = Math.max(k, end)
  }
  return k === 0 ? 0 : step * k
}

/**
 * `name` as shown in at most what `fits` allows. Whole if it fits. Otherwise its first dotted segment, `…`, and as
 * many whole trailing segments as fit: the compiler names a state from the outside in (`bpf31.l2.r1.rw2`), so the
 * first segment says which gadget a state is in and the last ones which state it is, and the middle is what states
 * near each other share. A name whose first and last segments do not fit together is cut by characters, two thirds
 * of what fits kept from its end.
 */
export function middleCut(name: string, fits: (shown: string) => boolean): string {
  if (fits(name)) return name
  const parts = name.split('.')
  const first = parts[0] ?? ''
  for (let keep = parts.length - 2; keep >= 1; keep -= 1) {
    const cut = `${first}…${parts.slice(-keep).join('.')}`
    if (fits(cut)) return cut
  }
  const chars = [...name]
  for (let kept = chars.length - 1; kept > 0; kept -= 1) {
    const head = Math.floor(kept / 3)
    const cut = `${chars.slice(0, head).join('')}…${chars.slice(chars.length - (kept - head)).join('')}`
    if (fits(cut)) return cut
  }
  return '…'
}

/**
 * Each name as shown (`middleCut`) in at most `cap` of `widthOf`, except that names whose cuts would read the same as
 * another name's are given a character more room at a time, and cut again, until they read differently: the cut is
 * there so states can be told apart, and two boxes reading the same would undo it. A name that differs only where no
 * cut keeps it is shown whole, which every distinct name is.
 */
export function shownNames(names: readonly string[], widthOf: (shown: string) => number, cap: number): string[] {
  const room = names.map(() => cap)
  const char = Math.max(1, widthOf('0'))
  const cut = (i: number) => middleCut(names[i] ?? '', (s) => widthOf(s) <= (room[i] ?? cap))
  const shown = names.map((_, i) => cut(i))
  for (;;) {
    const owners = new Map<string, Set<string>>()
    for (const [i, s] of shown.entries()) owners.set(s, (owners.get(s) ?? new Set()).add(names[i] ?? ''))
    const clashing = [...shown.keys()].filter(
      (i) => shown[i] !== names[i] && (owners.get(shown[i] ?? '')?.size ?? 0) > 1,
    )
    if (clashing.length === 0) return shown
    for (const i of clashing) {
      room[i] = (room[i] ?? cap) + char
      shown[i] = cut(i)
    }
  }
}

/**
 * A place a label may take, the step it moves by from there while it meets something (a pixel across, `dx`, or
 * down, `dy`, away from its line), and what taking it costs.
 */
type Place = { readonly label: PlacedLabel; readonly dx: number; readonly dy: number; readonly cost: number }
/**
 * An edge as it is being drawn: its line as `points` (`along`), worked out once for every place; `places` best
 * first, and `label` the one it takes.
 */
type Drawn = { edge: LocalEdge; path: Cubic; points: readonly Point[]; places: readonly Place[]; label: PlacedLabel }
type Side = 'above' | 'below'
/** An edge's rules, each a list of its tapes' parts (`ruleLabel`). */
type Rules = readonly (readonly string[])[]

/**
 * Lay `local` out for a panel `panelWidth` wide. Each column is as wide as its widest box or self-loop label, each gap
 * as its widest forward label and their margins, and a level narrower than its panel spreads the difference evenly
 * over the gaps. Each row stands as tall as its self-loops and
 * labels need, and hangs as low as its backward edges' lanes. Coordinates are the drawing's own, from its top left,
 * and `height` leaves the same margin under it as over it.
 */
export function layoutLocal(
  local: Local,
  nameOf: (state: number) => string,
  m: Metrics,
  panelWidth: number,
): LocalLayout {
  const shown = shownNames(
    local.nodes.map((n) => nameOf(n.state)),
    m.nameWidth,
    m.cap,
  )
  const step = m.ascent + m.descent
  /** Each line's baseline below the first's: a line a tape, and `RULE_GAP` between rules once any is several. */
  const offsets = (rules: Rules): number[] => {
    const gap = rules.some((r) => r.length > 1) ? RULE_GAP : 0
    const out: number[] = []
    let y = 0
    for (const [i, rule] of rules.entries()) {
      if (i > 0) y += gap
      for (const _ of rule) {
        out.push(y)
        y += step
      }
    }
    return out
  }
  const blockWidth = (rules: Rules) => Math.max(0, ...rules.flat().map((l) => m.labelWidth(l)))
  const blockHeight = (rules: Rules) => (offsets(rules).at(-1) ?? -step) + step

  const column = new Map<number, number>()
  const row = new Map<number, number>()
  const width = new Map<number, number>()
  const filled = new Map<number, number>()
  for (const [i, n] of local.nodes.entries()) {
    const r = filled.get(n.column) ?? 0
    filled.set(n.column, r + 1)
    column.set(n.state, n.column)
    row.set(n.state, r)
    width.set(n.state, Math.ceil(m.nameWidth(shown[i] ?? '') + m.nodeChrome))
  }
  const rows = Math.max(1, ...filled.values())
  const col = (s: number) => column.get(s) ?? 0
  const rowOf = (s: number) => row.get(s) ?? 0
  const loops = local.edges.filter((e) => e.from === e.to)
  const forward = local.edges.filter((e) => col(e.to) > col(e.from))
  const backward = local.edges.filter((e) => e.from !== e.to && col(e.to) <= col(e.from))

  // A SLOPING EDGE'S LABEL GOES BY THE END WHERE ITS LINE IS APART FROM THE OTHERS: the forward edges out of one node
  // leave from one point and those into one node arrive at one, so by a shared end a label is as near the other
  // edges' lines as its own. It goes by its source unless other edges leave from there too, then by its target
  // unless other edges arrive there too, and then by its middle; an edge along a row keeps its label over its middle.
  const outs = new Map<number, number>()
  const ins = new Map<number, number>()
  for (const e of forward) {
    outs.set(e.from, (outs.get(e.from) ?? 0) + 1)
    ins.set(e.to, (ins.get(e.to) ?? 0) + 1)
  }
  const endOf = (e: LocalEdge): 'source' | 'target' | 'middle' => {
    if (rowOf(e.from) === rowOf(e.to)) return 'middle'
    if ((outs.get(e.from) ?? 0) === 1) return 'source'
    return (ins.get(e.to) ?? 0) === 1 ? 'target' : 'middle'
  }
  /**
   * The side of its line a label by one end takes: the side the line turns away from, so the line runs off from the
   * label rather than through it. By its source, a line rising to its target turns up, so its label goes under it.
   */
  const awayAt = (e: LocalEdge, end: 'source' | 'target'): Side =>
    (end === 'source') === rowOf(e.to) < rowOf(e.from) ? 'below' : 'above'

  // COLUMNS AND GAPS, EACH AS WIDE AS WHAT IT HOLDS: a column its boxes and self-loop labels, a gap the labels of the
  // edges that leave the column before it. One width for all would be wider than many a panel for the sake of one
  // long label (the design doc's measurement).
  const columns = 2 * REACH + 1
  const slot = new Array<number>(columns).fill(0)
  const gap = new Array<number>(columns - 1).fill(MIN_GAP)
  for (const [s, w] of width) slot[col(s) + REACH] = Math.max(slot[col(s) + REACH] ?? 0, w)
  for (const e of loops) slot[col(e.from) + REACH] = Math.max(slot[col(e.from) + REACH] ?? 0, blockWidth(e.labels))
  // A SELF-LOOP'S LABEL GOES RIGHT OF A LINE UP ITS COLUMN, SO ITS COLUMN HAS THAT ROOM: a backward edge rises at
  // either end from under its lowest row to the middle of its end's box, through the place over the arc of every
  // node of that column down from the box under its end, and a label across that line reads as the line's.
  for (const loop of loops) {
    const s = loop.from
    for (const e of backward) {
      for (const n of [e.from, e.to]) {
        if (col(n) !== col(s) || rowOf(n) >= rowOf(s) || rowOf(s) > Math.max(rowOf(e.from), rowOf(e.to))) continue
        const c = col(s) + REACH
        slot[c] = Math.max(slot[c] ?? 0, (width.get(n) ?? 0) / 2 + ASIDE + blockWidth(loop.labels))
      }
    }
  }
  for (const e of forward) {
    const g = (endOf(e) === 'target' ? col(e.to) - 1 : col(e.from)) + REACH
    gap[g] = Math.max(gap[g] ?? 0, blockWidth(e.labels) + 2 * LABEL_MARGIN)
  }
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)
  const natural = 2 * PAD + sum(slot) + sum(gap)
  // THE GAPS PAST THE OUTERMOST COLUMNS THAT HOLD A STATE hold nothing, so a panel too narrow for the level with them
  // takes them in first, and they cost no state its place in it. A panel wider than that spreads over them as over the
  // rest, which keeps the current state's column where it stands.
  const used = local.nodes.map((n) => n.column + REACH)
  const empty = gap.map((_, g) => g < Math.min(...used) || g >= Math.max(...used))
  const spare = sum(gap.filter((_, g) => empty[g]))
  // A WHOLE NUMBER OF PIXELS, THE NEAREST: up to half a pixel over it comes off the gaps, each of which keeps
  // `LABEL_MARGIN` either side of its widest label, so a level that much over its panel, as a self-loop's room past a
  // line up its column can leave one, fits it rather than scrolling a pixel sideways. AND NEVER NARROWER THAN A BACKWARD
  // EDGE'S LABEL WITH `PAD` EITHER SIDE, which `hang` keeps inside the drawing: no gap is widened for one, and with the
  // empty gaps taken in, its edge's columns alone can be narrower than it.
  const backLabel = Math.max(0, ...backward.map((e) => Math.ceil(blockWidth(e.labels)) + 2 * PAD))
  const totalWidth = Math.max(panelWidth, Math.round(natural - spare), backLabel)
  for (let g = 0; g < gap.length; g += 1) {
    if (totalWidth >= natural || spare === 0) gap[g] = (gap[g] ?? 0) + (totalWidth - natural) / gap.length
    else if (empty[g]) gap[g] = ((gap[g] ?? 0) * (totalWidth - natural + spare)) / spare
  }
  const slotLeft = (c: number) => PAD + sum(slot.slice(0, c + REACH)) + sum(gap.slice(0, c + REACH))
  const gapLeft = (c: number) => slotLeft(c) + (slot[c + REACH] ?? 0)

  // ROWS, TOP DOWN: what stands over each row (its self-loops and the labels over its lines' ends), what hangs under
  // it beside its boxes (the labels under its lines' ends), then, once the rows above it are placed, the lanes its
  // backward edges hang in.
  const over = new Array<number>(rows).fill(0)
  const under = new Array<number>(rows).fill(0)
  for (const e of loops) {
    const r = rowOf(e.from)
    over[r] = Math.max(over[r] ?? 0, LOOP_RISE + LOOP_CLEAR + blockHeight(e.labels))
  }
  for (const e of forward) {
    const end = endOf(e)
    if (end === 'middle' && rowOf(e.from) !== rowOf(e.to)) continue
    const r = rowOf(end === 'target' ? e.to : e.from)
    const need = blockHeight(e.labels) + LINE_CLEAR - NODE_HEIGHT / 2
    if (end === 'middle' || awayAt(e, end) === 'above') over[r] = Math.max(over[r] ?? 0, need)
    else under[r] = Math.max(under[r] ?? 0, need)
  }
  // A LINE ALONG A ROW BETWEEN TWO FROM ITS SOURCE THAT RISE AND FALL TO OTHER ROWS: those two cross every place by
  // its source and its middle, on both sides, so its label goes over it by its target, up against the box, and its
  // row stands far enough under the row the rising line goes to that that line has left the label's band by then.
  const apart: { readonly upper: number; readonly lower: number; readonly by: number }[] = []
  for (const e of forward) {
    const r = rowOf(e.from)
    if (rowOf(e.to) !== r) continue
    const others = forward.filter((f) => f.from === e.from)
    if (!others.some((f) => rowOf(f.to) > r)) continue
    for (const up of others.filter((f) => rowOf(f.to) < r)) {
      const by = leastRise(e, up)
      if (by > 0) apart.push({ upper: rowOf(up.to), lower: r, by })
    }
  }
  /**
   * The least rise from `e`'s row to `up`'s target's at which `up`'s line is further from `e`'s label over its target
   * end than `e`'s own line, by `NEARER` and a pixel, from the label's box and from its middle; 0 past `MOST_APART`.
   */
  function leastRise(e: LocalEdge, up: LocalEdge): number {
    const x1 = slotLeft(col(e.from)) + (width.get(e.from) ?? 0)
    const x2 = slotLeft(col(up.to))
    const right = slotLeft(col(e.to)) - HUG
    const h = blockHeight(e.labels)
    const box = { left: right - blockWidth(e.labels), top: -LINE_CLEAR - h, right, bottom: -LINE_CLEAR }
    const cx = right - blockWidth(e.labels) / 2
    const centre = { left: cx, top: -LINE_CLEAR - h / 2, right: cx, bottom: -LINE_CLEAR - h / 2 }
    const clear = LINE_CLEAR + NEARER + 1
    for (let by = NODE_HEIGHT + ROW_GAP; by <= MOST_APART; by += 1) {
      const points = along({ xs: [x1, x1 + PAD, x2 - PAD, x2], ys: [0, 0, -by, -by] })
      if (lineGap(points, box) >= clear && lineGap(points, centre) >= h / 2 + clear) return by
    }
    return 0
  }
  const top: number[] = []
  const drawn: Drawn[] = []
  const xOf = (s: number) => slotLeft(col(s))
  const yOf = (s: number) => top[rowOf(s)] ?? 0
  const wOf = (s: number) => width.get(s) ?? 0
  let y = over[0] ?? 0
  for (let r = 0; r < rows; r += 1) {
    for (const a of apart) if (a.lower === r) y = Math.max(y, (top[a.upper] ?? 0) + a.by)
    top[r] = y
    const bottom = y + NODE_HEIGHT
    const deepest = hang(
      backward.filter((e) => Math.max(rowOf(e.from), rowOf(e.to)) === r),
      bottom,
    )
    y = Math.max(bottom + (under[r] ?? 0), deepest) + ROW_GAP + (over[r + 1] ?? 0)
  }

  /** Lay one row's backward edges out in lanes under it, and answer how low the lowest label reaches. */
  function hang(edges: readonly LocalEdge[], bottom: number): number {
    const spans = edges.map((e) => {
      const x1 = xOf(e.from) + wOf(e.from) / 2
      const x2 = xOf(e.to) + wOf(e.to) / 2
      const half = blockWidth(e.labels) / 2
      // UNDER THE CURVE'S MIDDLE, BUT INSIDE THE DRAWING: a label wider than an outer column, on an edge along it,
      // would otherwise hang past the drawing's edge, where no scroll reaches.
      const mid = Math.min(Math.max((x1 + x2) / 2, PAD + half), totalWidth - PAD - half)
      return { e, x1, x2, mid, from: Math.min(x1, x2, mid - half), to: Math.max(x1, x2, mid + half) }
    })
    spans.sort((a, b) => a.to - a.from - (b.to - b.from))
    const lanes: (typeof spans)[] = []
    for (const s of spans) {
      const lane = lanes.find((l) => l.every((o) => s.to + LANE_GAP <= o.from || o.to + LANE_GAP <= s.from))
      if (lane === undefined) lanes.push([s])
      else lane.push(s)
    }
    // THE FIRST LANE'S CURVES DIP `BACK_DEPTH`, AND EACH LATER LANE'S CLEAR THE LABELS OF THE LANE ABOVE: the
    // curve's lowest point is no higher than its midpoint, `(ya + yb) / 8 + 3 low / 4`, which sets `low`.
    let floor = bottom + (3 * BACK_DEPTH) / 4
    let lowest = bottom
    for (const lane of lanes) {
      let next = floor
      for (const { e, x1, x2, mid } of lane) {
        const ya = yOf(e.from) + NODE_HEIGHT
        const yb = yOf(e.to) + NODE_HEIGHT
        const low = Math.max(bottom + BACK_DEPTH, (floor - (ya + yb) / 8) / 0.75)
        const path: Cubic = { xs: [x1, x1, x2, x2], ys: [ya, low, low, yb] }
        const points = along(path)
        // UNDER THE CURVE'S MIDDLE, OR UNDER EITHER END OF ITS BOTTOM where something stands under the middle.
        const places = [
          beside(path, points, e.labels, mid, 'middle', 'below', 0),
          beside(path, points, e.labels, Math.min(x1, x2), 'start', 'below', OTHER_SIDE),
          beside(path, points, e.labels, Math.max(x1, x2), 'end', 'below', OTHER_SIDE),
        ]
        const label = places[0]?.label ?? block(mid, 'middle', [], ya)
        drawn.push({ edge: e, path, points, places, label })
        next = Math.max(next, label.box.bottom + LANE_GAP)
        lowest = Math.max(lowest, label.box.bottom)
      }
      floor = next
    }
    return lowest
  }

  /** A label whose block's bottom is at `bottom`, anchored at `x`. */
  function block(x: number, anchor: PlacedLabel['anchor'], rules: Rules, bottom: number): PlacedLabel {
    const w = blockWidth(rules)
    const left = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w
    const below = offsets(rules)
    const first = bottom - m.descent - (below.at(-1) ?? 0)
    return {
      x,
      anchor,
      lines: rules.flat(),
      baselines: below.map((o) => first + o),
      box: { left, top: first - m.ascent, right: left + w, bottom },
    }
  }

  for (const e of loops) {
    const right = xOf(e.from) + wOf(e.from)
    const t = yOf(e.from)
    // RIGHT-ALIGNED TO THE BOX, OVER THE ARC, AND INSIDE THE COLUMN: a label wider than its box moves right, never
    // left past the column into the gap where the edge in carries its own label. Where something stands over part
    // of the arc, such as a line up the column, the label moves right along the arc, as far as its column reaches.
    const x = Math.max(right, xOf(e.from) + blockWidth(e.labels))
    const label = block(x, 'end', e.labels, t - LOOP_RISE - LOOP_CLEAR)
    const room = slotLeft(col(e.from)) + (slot[col(e.from) + REACH] ?? 0) - x
    const places = Array.from({ length: Math.ceil(Math.max(0, room) / NUDGE) + 1 }, (_, i) => ({
      label: shifted(label, Math.min(i * NUDGE, room), 0),
      dx: 0,
      dy: -1,
      cost: Math.min(i * NUDGE, room),
    }))
    const path = loopAt(right, t)
    drawn.push({ edge: e, path, points: along(path), places, label })
  }

  /** A place anchored at `x` for a label of `rules` on `side` of `path`, `LINE_CLEAR` from it under its whole width. */
  function beside(
    path: Cubic,
    points: readonly Point[],
    rules: Rules,
    x: number,
    anchor: PlacedLabel['anchor'],
    side: Side,
    cost: number,
  ): Place {
    const w = blockWidth(rules)
    const left = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w
    const ys = [yAt(path, left), yAt(path, left + w)]
    for (const [px, py] of points) if (px > left && px < left + w) ys.push(py)
    return side === 'above'
      ? { label: block(x, anchor, rules, Math.min(...ys) - LINE_CLEAR), dx: 0, dy: -1, cost }
      : { label: block(x, anchor, rules, Math.max(...ys) + LINE_CLEAR + blockHeight(rules)), dx: 0, dy: 1, cost }
  }
  /**
   * A place for a label of `rules` beside a steep part of a line, `LINE_CLEAR` to the `side` of it across its whole
   * height, level with a point of it, `y`: where a line climbs a row, every place over or under it is as
   * near the lines either side, and one beside it is not.
   */
  function aside(points: readonly Point[], rules: Rules, [, y]: Point, side: 'left' | 'right', cost: number): Place {
    const h = blockHeight(rules)
    const top = y - h / 2 - LINE_CLEAR
    const bottom = y + h / 2 + LINE_CLEAR
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (let i = 1; i < points.length; i += 1) {
      const [x0, y0] = points[i - 1] ?? [0, 0]
      const [x1, y1] = points[i] ?? [0, 0]
      const t0 = y1 === y0 ? 0 : Math.max(0, Math.min((top - y0) / (y1 - y0), (bottom - y0) / (y1 - y0)))
      const t1 = y1 === y0 ? 1 : Math.min(1, Math.max((top - y0) / (y1 - y0), (bottom - y0) / (y1 - y0)))
      if (t0 > t1 || (y1 === y0 && (y0 < top || y0 > bottom))) continue
      for (const t of [t0, t1]) {
        lo = Math.min(lo, x0 + t * (x1 - x0))
        hi = Math.max(hi, x0 + t * (x1 - x0))
      }
    }
    return side === 'right'
      ? { label: block(hi + LINE_CLEAR, 'start', rules, y + h / 2), dx: 1, dy: 0, cost }
      : { label: block(lo - LINE_CLEAR, 'end', rules, y + h / 2), dx: -1, dy: 0, cost }
  }
  for (const e of forward) {
    const x1 = xOf(e.from) + wOf(e.from)
    const y1 = yOf(e.from) + NODE_HEIGHT / 2
    const x2 = xOf(e.to)
    const y2 = yOf(e.to) + NODE_HEIGHT / 2
    const path: Cubic = { xs: [x1, x1 + PAD, x2 - PAD, x2], ys: [y1, y1, y2, y2] }
    const points = along(path)
    // BY AN END, IN FROM IT BY A LABEL'S MARGIN; BY THE MIDDLE, IN THE GAP AFTER THE SOURCE'S COLUMN, the one gap
    // every forward edge crosses and that was widened for it.
    const middle = gapLeft(col(e.from)) + (gap[col(e.from) + REACH] ?? 0) / 2
    // ITS PLACES ALONG ITS LINE: by either end, in from it by a label's margin, by its middle, and a quarter of the
    // way in from either end, on either side. The best is the one its end calls for, on the side away from the
    // line's turn; the other side there is next; the rest are further, for a line whose best place is taken.
    // A PLACE BY THE MIDDLE OR A QUARTER IS KEPT BETWEEN THE ENDS' PLACES, so no label of a forward edge reaches
    // further into a column than one by an end would.
    const half = blockWidth(e.labels) / 2
    const between = (x: number) => Math.max(Math.min(x, x2 - LABEL_MARGIN - half), x1 + LABEL_MARGIN + half)
    const spots = [
      { where: 'source', x: x1 + LABEL_MARGIN, anchor: 'start' },
      { where: 'target', x: x2 - LABEL_MARGIN, anchor: 'end' },
      { where: 'middle', x: middle, anchor: 'middle' },
      { where: 'quarter', x: between(x1 + (x2 - x1) / 4), anchor: 'middle' },
      { where: 'quarter', x: between(x2 - (x2 - x1) / 4), anchor: 'middle' },
    ] as const
    const end = endOf(e)
    const best = (where: string): Side => (where === 'source' || where === 'target' ? awayAt(e, where) : 'above')
    const places = spots.flatMap(({ where, x, anchor }) =>
      (['above', 'below'] as const).map((side) =>
        beside(
          path,
          points,
          e.labels,
          x,
          anchor,
          side,
          (where === end ? 0 : FAR_PLACE) + (side === best(where) ? 0 : OTHER_SIDE),
        ),
      ),
    )
    // A LINE BETWEEN ROWS ALSO HAS PLACES BESIDE IT, either side, level with its middle and an eighth of its length
    // either way from there, the middle cheapest: where it climbs steepest, furthest from where it meets other lines.
    // A LINE ALONG A ROW ALSO HAS PLACES UP AGAINST ITS TARGET, either side, furthest from its source's self-loop and
    // from where other lines leave the source with it: the place over it is the one a fan's rows were set apart for.
    if (y1 === y2) {
      for (const side of ['below', 'above'] as const) {
        const cost = FAR_PLACE + (side === 'below' ? 0 : OTHER_SIDE) + 1
        places.push(beside(path, points, e.labels, x2 - HUG, 'end', side, cost))
      }
    } else {
      for (const [i, at] of [LINE_PIECES / 2, (3 * LINE_PIECES) / 8, (5 * LINE_PIECES) / 8].entries()) {
        const point = points[at] ?? [x1, y1]
        for (const side of ['right', 'left'] as const) places.push(aside(points, e.labels, point, side, SIDE_PLACE + i))
      }
    }
    places.sort((p, q) => p.cost - q.cost)
    drawn.push({ edge: e, path, points, places, label: places[0]?.label ?? block(middle, 'middle', [], y1) })
  }

  // EACH LABEL TAKES THE CHEAPEST PLACE CLEAR OF EVERYTHING AND NEARER ITS OWN LINE THAN ANY OTHER: its places best
  // first, each moved away from its line in `NUDGE` steps as far as `SEARCH`, a step costing its pixels. The rows
  // above leave room for the common shapes, and this catches the rest (an edge between rows, an edge across two
  // columns, a label wider than its lane). What a label stays clear of: the nodes, the self-loops' arcs, the other
  // edges' lines, the labels already placed, by `LABEL_GAP`, and the drawing's sides. A label with no such place
  // takes the clear place least behind; with none clear in reach, the place it moves least from to be clear. Self-loop
  // labels go first, as they are tied to their node.
  const taken: Box[] = []
  for (const s of local.nodes) {
    taken.push(
      grown({
        left: xOf(s.state),
        top: yOf(s.state),
        right: xOf(s.state) + wOf(s.state),
        bottom: yOf(s.state) + NODE_HEIGHT,
      }),
    )
  }
  for (const d of drawn) if (d.edge.from === d.edge.to) taken.push(grown(cubicBox(d.path)))
  // EVERY EDGE'S LINE AS POINTS AND AS STRAIGHT PIECES' BOXES, AND THE BOX OF IT ALL, which most places are clear of.
  const lines = drawn.map((d) => ({
    edge: d.edge,
    points: d.points,
    pieces: pieces(d.points),
    box: grown(cubicBox(d.path)),
  }))
  const lineOf = new Map(lines.map((l) => [l.edge, l.points]))
  const labels: Box[] = []
  const clear = (d: Drawn, box: Box) =>
    !taken.some((t) => meets(box, t)) &&
    !labels.some((l) => meets(box, l)) &&
    !lines.some(
      (l) => l.edge !== d.edge && l.edge.from !== l.edge.to && meets(box, l.box) && l.pieces.some((p) => meets(box, p)),
    )
  /**
   * Whether `a` and `b` run along one row over some of the same gaps: an edge along a row across a column is drawn
   * straight through it, over the lines of that row's other edges, so no place is nearer one than the other.
   */
  const overlaid = (a: LocalEdge, b: LocalEdge) =>
    [a, b].every((e) => rowOf(e.from) === rowOf(e.to) && col(e.to) > col(e.from) && rowOf(e.from) === rowOf(a.from)) &&
    col(a.from) < col(b.to) &&
    col(b.from) < col(a.to)
  /**
   * How much nearer `box` is to `d`'s own line than to any other edge's, measured from its edge and from its middle,
   * or `most` if that is less, and as soon as it is known to be less than `floor`: a label in the angle between two
   * lines from one point can touch its own line at a corner and lie along the other. A line drawn over its own counts
   * as `NEARER` further than it is.
   */
  const lead = (d: Drawn, box: Box, most: number, floor: number) => {
    const mid = (box.left + box.right) / 2
    const centre = { left: mid, right: mid, top: (box.top + box.bottom) / 2, bottom: (box.top + box.bottom) / 2 }
    const points = lineOf.get(d.edge) ?? []
    const own = lineGap(points, box)
    const ownCentre = lineGap(points, centre)
    let least = most
    for (const l of lines) {
      const slack = overlaid(d.edge, l.edge) ? NEARER : 0
      if (l.edge === d.edge || boxGap(l.box, box) + slack - Math.max(own, ownCentre) >= least) continue
      least = Math.min(least, lineGap(l.points, box) + slack - own, lineGap(l.points, centre) + slack - ownCentre)
      if (least < floor) return least
    }
    return least
  }
  /**
   * What `clear` keeps `d`'s label off, as boxes: a piece of a line lies inside the line's box, so meeting a piece is
   * meeting both.
   */
  const obstacles = (d: Drawn): Box[] => [
    ...taken,
    ...labels,
    ...lines.flatMap((l) => (l.edge !== d.edge && l.edge.from !== l.edge.to ? l.pieces : [])),
  ]
  const inside = (box: Box) => box.left >= 0 && box.right <= totalWidth
  const fits = (d: Drawn, box: Box) => inside(box) && clear(d, box) && lead(d, box, NEARER, NEARER) >= NEARER
  // SELF-LOOPS' LABELS FIRST, tied to their node; then those over the lines along rows, the most of any level and
  // each in the place its row was made tall enough for; then backward edges' in their lanes; and last the sloping
  // edges', whose best places no other label takes and which have the most places to go to besides.
  const rank = (d: Drawn) =>
    d.edge.from === d.edge.to
      ? 0
      : col(d.edge.to) > col(d.edge.from)
        ? rowOf(d.edge.from) === rowOf(d.edge.to)
          ? 1
          : 3
        : 2
  const order = [...drawn].sort((a, b) => rank(a) - rank(b))
  let weighed = 0
  for (const d of order) {
    let best: { label: PlacedLabel; cost: number } | undefined
    // ITS BEST PLACE IS WEIGHED HOWEVER MANY THE LEVEL HAS WEIGHED, and only the rest count against `WEIGHED_PLACES`,
    // so a label late in a crowded level still takes the place it was made room for, where that place is free.
    for (const [i, p] of d.places.entries()) {
      for (
        let off = 0;
        off <= SEARCH &&
        p.cost + off < (best?.cost ?? Number.POSITIVE_INFINITY) &&
        (i === 0 || weighed < WEIGHED_PLACES);
        off += NUDGE
      ) {
        if (i > 0) weighed += 1
        if (fits(d, moved(p.label.box, p.dx * off, p.dy * off))) {
          best = { label: shifted(p.label, p.dx * off, p.dy * off), cost: p.cost + off }
          break
        }
      }
    }
    // WITH NO PLACE NEARER ITS OWN LINE, THE CLEAR PLACE NEAREST BEING ONE: where the most it is ahead by is least
    // behind, so the line a reader takes it for is at worst a near second to its own.
    let ahead = Number.NEGATIVE_INFINITY
    for (const p of best === undefined ? d.places : []) {
      for (let off = 0; off <= SEARCH && weighed < WEIGHED_PLACES; off += NUDGE) {
        weighed += 1
        const box = moved(p.label.box, p.dx * off, p.dy * off)
        const by =
          inside(box) && clear(d, box) ? lead(d, box, Number.POSITIVE_INFINITY, ahead) : Number.NEGATIVE_INFINITY
        if (by > ahead) {
          ahead = by
          best = { label: shifted(p.label, p.dx * off, p.dy * off), cost: 0 }
        }
      }
    }
    // WITH NO CLEAR PLACE IN REACH, THE PLACE IT MOVES LEAST FROM TO BE CLEAR, inside the drawing: each place moved
    // the way its search moves it, sideways beside a climbing line and up or down elsewhere, until it meets nothing,
    // the cheaper place where two move as far. Moving only its best place would carry a label in a fan of lines past
    // every line on that side, far from its own, where another of its places is clear a short way off.
    if (best === undefined) {
      const all = obstacles(d)
      const across = all.map(turned)
      let least = Number.POSITIVE_INFINITY
      for (const p of d.places) {
        const by =
          p.dx === 0
            ? firstClear(p.label.box, (p.dy || -1) * NUDGE, all)
            : firstClear(turned(p.label.box), p.dx * NUDGE, across)
        const label = p.dx === 0 ? shifted(p.label, 0, by) : shifted(p.label, by, 0)
        if (Math.abs(by) < least && inside(label.box)) {
          least = Math.abs(by)
          best = { label, cost: 0 }
        }
      }
    }
    // WHERE NONE IS INSIDE THE DRAWING ONCE CLEAR, its best place moved up or down until clear, which moves it no
    // further out of the drawing than that place is.
    if (best === undefined) {
      const [first] = d.places
      const dy = first === undefined ? 0 : firstClear(first.label.box, (first.dy || -1) * NUDGE, obstacles(d))
      best = { label: shifted(first?.label ?? d.label, 0, dy), cost: 0 }
    }
    d.label = best.label
    labels.push(spaced(d.label.box))
  }

  // THE SAME MARGIN OVER AND UNDER: everything moves down so the highest thing drawn is `PAD` from the top.
  const boxes = [
    ...local.nodes.map((n) => ({ top: yOf(n.state), bottom: yOf(n.state) + NODE_HEIGHT })),
    ...drawn.flatMap((d) => [cubicBox(d.path), d.label.box]),
  ]
  const drawnTop = Math.min(...boxes.map((b) => b.top))
  const drawnBottom = Math.max(...boxes.map((b) => b.bottom))
  const shift = PAD - drawnTop
  const height = drawnBottom - drawnTop + 2 * PAD
  const across = [
    ...local.nodes.map((n) => ({ left: xOf(n.state), right: xOf(n.state) + wOf(n.state) })),
    ...drawn.flatMap((d) => [cubicBox(d.path), d.label.box]),
  ]
  const inked = {
    left: Math.max(0, Math.min(...across.map((b) => b.left)) - PAD),
    top: 0,
    right: Math.min(totalWidth, Math.max(...across.map((b) => b.right)) + PAD),
    bottom: height,
  }
  const n = (v: number) => String(Math.round(v * 100) / 100)
  const byEdge = new Map(drawn.map((d) => [d.edge, d]))
  return {
    nodes: local.nodes.map((node, i) => ({
      state: node.state,
      column: node.column,
      x: xOf(node.state),
      y: yOf(node.state) + shift,
      width: wOf(node.state),
      text: shown[i] ?? '',
    })),
    edges: local.edges.flatMap((e) => {
      const d = byEdge.get(e)
      if (d === undefined) return []
      const { xs, ys } = d.path
      const y: Quad = [ys[0] + shift, ys[1] + shift, ys[2] + shift, ys[3] + shift]
      return [
        {
          ...e,
          d: `M${n(xs[0])} ${n(y[0])} C${n(xs[1])} ${n(y[1])} ${n(xs[2])} ${n(y[2])} ${n(xs[3])} ${n(y[3])}`,
          box: moved(cubicBox(d.path), 0, shift),
          label: shifted(d.label, 0, shift),
        },
      ]
    }),
    width: totalWidth,
    height,
    inked,
  }
}
