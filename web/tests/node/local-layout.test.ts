import { describe, expect, it } from 'vitest'
import {
  type Box,
  CAP_CHARS,
  firstClear,
  LABEL_GAP,
  type LocalLayout,
  layoutLocal,
  type Metrics,
  middleCut,
  NODE_HEIGHT,
  RULE_GAP,
  shownNames,
} from '../../src/local-layout'
import { type Local, REACH } from '../../src/local-level'

/** A monospaced font, as every style's node font is: 7.2 px a character for names, 6 for labels. */
const CHAR = 7.2
const METRICS: Metrics = {
  nameWidth: (s) => [...s].length * CHAR,
  labelWidth: (s) => [...s].length * 6,
  ascent: 9,
  descent: 2,
  nodeChrome: 11.6,
  cap: CAP_CHARS * CHAR,
}
const fitsCap = (s: string) => [...s].length <= CAP_CHARS
const charsWide = (s: string) => [...s].length * CHAR

const meets = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const nodeBox = (n: LocalLayout['nodes'][number]): Box => ({
  left: n.x,
  top: n.y,
  right: n.x + n.width,
  bottom: n.y + 24,
})

/** How far apart two boxes are: the larger of the gaps between them across and down, below zero where they overlap. */
const apart = (a: Box, b: Box) => Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom)

/** Points along a drawn edge's path, `M x0 y0 C x1 y1 x2 y2 x3 y3`. */
function along(d: string): [number, number][] {
  const v = d.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number)
  const bez = (c: number[], t: number) =>
    (1 - t) ** 3 * (c[0] ?? 0) +
    3 * (1 - t) ** 2 * t * (c[1] ?? 0) +
    3 * (1 - t) * t ** 2 * (c[2] ?? 0) +
    t ** 3 * (c[3] ?? 0)
  const xs = [v[0] ?? 0, v[2] ?? 0, v[4] ?? 0, v[6] ?? 0]
  const ys = [v[1] ?? 0, v[3] ?? 0, v[5] ?? 0, v[7] ?? 0]
  return Array.from({ length: 129 }, (_, i) => [bez(xs, i / 128), bez(ys, i / 128)])
}

/**
 * Every label box against every node, every self-loop's arc, every other edge's line and every other label, which it
 * must stand `LABEL_GAP` apart from, and against the drawing's own edges.
 */
function collisions(l: LocalLayout): string[] {
  const found: string[] = []
  const loops = l.edges.filter((e) => e.from === e.to)
  for (const [i, e] of l.edges.entries()) {
    const at = `${e.from}->${e.to} (${e.label.lines.join(' / ')})`
    const b = e.label.box
    for (const n of l.nodes) if (meets(b, nodeBox(n))) found.push(`${at} meets node ${n.state}`)
    for (const loop of loops) if (meets(b, loop.box)) found.push(`${at} meets the loop on ${loop.from}`)
    for (const [j, f] of l.edges.entries()) {
      if (j > i && apart(b, f.label.box) < LABEL_GAP - 1e-9) {
        found.push(`${at} is ${apart(b, f.label.box).toFixed(1)} px from ${f.from}->${f.to}'s label`)
      }
      if (j === i || f.from === f.to) continue
      const inside = along(f.d).some(([x, y]) => x > b.left && x < b.right && y > b.top && y < b.bottom)
      if (inside) found.push(`${at} is crossed by ${f.from}->${f.to}'s line`)
    }
    if (b.left < 0 || b.right > l.width || b.top < 0 || b.bottom > l.height) found.push(`${at} is cut off`)
  }
  return found
}

/** How far the box `b` is from the segment `p`..`q`: 0 where the segment enters it. */
function segmentGap([px, py]: [number, number], [qx, qy]: [number, number], b: Box): number {
  const steps = Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py) * 4))
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i <= steps; i += 1) {
    const x = px + ((qx - px) * i) / steps
    const y = py + ((qy - py) * i) / steps
    best = Math.min(best, Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom)))
  }
  return best
}

/**
 * Every label whose nearest line is another edge's than its own: the line a reader takes a label to belong to is the
 * nearest one, measured from the label's box to each edge's drawn path.
 */
function misread(l: LocalLayout): string[] {
  const lines = l.edges.map((e) => along(e.d))
  const gap = (line: [number, number][], b: Box) =>
    Math.min(...line.slice(1).map((q, i) => segmentGap(line[i] ?? q, q, b)))
  const found: string[] = []
  for (const [i, e] of l.edges.entries()) {
    const own = gap(lines[i] ?? [], e.label.box)
    for (const [j, f] of l.edges.entries()) {
      const other = j === i ? Number.POSITIVE_INFINITY : gap(lines[j] ?? [], e.label.box)
      if (other < own) {
        found.push(
          `${e.from}->${e.to} (${e.label.lines.join(' / ')}) is ${other.toFixed(1)} px from ${f.from}->${f.to}'s line and ${own.toFixed(1)} from its own`,
        )
      }
    }
  }
  return found
}

/** How far the box `b` is from the edge drawn as `d`. */
function lineDistance(d: string, b: Box): number {
  const line = along(d)
  return Math.min(...line.slice(1).map((q, i) => segmentGap(line[i] ?? q, q, b)))
}

/** The user's screenshot's level: `is_even(6)` under binary at step 276, the current state `bpf31.l2.r1.rw0`. */
const NAMES = ['bpf31.l2.r1.rw2', 'bpf31.l2.r1.rw1', 'bpf31.l2.r1.rw0', 'bpf31.l2.r1.home', 'bpf31.l2.r2.home']
const SCREENSHOT: Local = {
  nodes: NAMES.map((_, i) => ({ state: i, column: i - 2 })),
  edges: [
    { from: 0, to: 0, labels: [['REG:0 L'], ['REG:1 L']], next: false },
    { from: 0, to: 1, labels: [['REG:# L']], next: false },
    { from: 1, to: 1, labels: [['REG:0 L'], ['REG:1 L']], next: false },
    { from: 1, to: 2, labels: [['REG:# L']], next: false },
    { from: 2, to: 2, labels: [['REG:0 L'], ['REG:1 L']], next: true },
    { from: 2, to: 3, labels: [['REG:#']], next: false },
    { from: 3, to: 3, labels: [['WORK:0 L'], ['WORK:1 L']], next: false },
    { from: 3, to: 4, labels: [['WORK:#']], next: false },
  ],
}

/**
 * The shapes the screenshot lacks, from a level around a hub state: three states in column 0 and two in column 1,
 * self-loops on rows below the first, a four-rule edge, an edge between rows, one across two columns, backward
 * edges from one row whose spans overlap, one of them along a column, and rules that touch two tapes on a forward
 * edge, a backward one and a self-loop.
 */
const CROWDED: Local = {
  nodes: [
    { state: 0, column: -2 },
    { state: 1, column: -1 },
    { state: 2, column: 0 },
    { state: 3, column: 0 },
    { state: 4, column: 0 },
    { state: 5, column: 1 },
    { state: 6, column: 1 },
    { state: 7, column: 2 },
  ],
  edges: [
    { from: 0, to: 1, labels: [['REG:0 L'], ['REG:1 L'], ['REG:# L'], ['REG:_ L']], next: false },
    { from: 0, to: 2, labels: [['WORK:1']], next: false },
    { from: 1, to: 2, labels: [['REG:#']], next: false },
    { from: 1, to: 3, labels: [['REG:_']], next: false },
    { from: 2, to: 2, labels: [['REG:0 R'], ['REG:1 R']], next: false },
    { from: 3, to: 3, labels: [['STACK:0 L'], ['STACK:1 L'], ['STACK:# L']], next: false },
    { from: 3, to: 6, labels: [['REG:0/1 R', 'WORK:1 L']], next: false },
    { from: 2, to: 5, labels: [['REG:#']], next: true },
    { from: 5, to: 7, labels: [['WORK:# R']], next: false },
    { from: 5, to: 1, labels: [['REG:# L']], next: false },
    { from: 6, to: 2, labels: [['REG:0 L', 'WORK:0 L'], ['WORK:1 L']], next: false },
    { from: 7, to: 3, labels: [['*']], next: false },
    {
      from: 7,
      to: 7,
      labels: [
        ['REG:0 R', 'WORK:0/0 R'],
        ['REG:1 R', 'WORK:1/1 R'],
      ],
      next: false,
    },
    { from: 4, to: 2, labels: [['REG:1']], next: false },
    { from: 1, to: 7, labels: [['WORK:_ S']], next: false },
  ],
}
const CROWDED_NAMES = ['a.q0', 'a.q1', 'hub.mid.x', 'hub.mid.y', 'hub.mid.z', 'b.c.d.e.f.g.h.i', 'b.q', 'overflow']

/**
 * Short names, so the outer columns are narrow: an edge along each outer column, whose label is wider than its
 * column, and two edges crossing each outer gap from or to one node on adjacent rows, whose labels start at the same
 * place in that gap.
 */
const CLIP: Local = {
  nodes: [
    { state: 0, column: -2 },
    { state: 1, column: -2 },
    { state: 2, column: -1 },
    { state: 3, column: 0 },
    { state: 4, column: 1 },
    { state: 5, column: 2 },
    { state: 6, column: 2 },
  ],
  edges: [
    { from: 0, to: 2, labels: [['WORK:0 R']], next: false },
    { from: 1, to: 0, labels: [['WORK:0/1 L']], next: false },
    { from: 1, to: 2, labels: [['WORK:1 R']], next: false },
    { from: 2, to: 3, labels: [['WORK:0 R']], next: false },
    { from: 3, to: 4, labels: [['WORK:* R']], next: true },
    { from: 4, to: 5, labels: [['WORK:0 R']], next: false },
    { from: 4, to: 6, labels: [['WORK:1 R']], next: false },
    { from: 5, to: 6, labels: [['WORK:0/1 L']], next: false },
  ],
}
const CLIP_NAMES = ['q', 'r', 'p', 's', 't', 'u', 'v']

/**
 * Fans of sloping edges from and into one node: `is_even(6)` under binary at step 11,827, the current state
 * `bdt35.q1.s.sk0`. Four edges come into `bdt35.n0`, one along its row and three rising to it, and two fall from
 * `bdt35.q1.e0` while one rises across them from `bdt35.q1.x0`.
 */
const FANS: Local = {
  nodes: [-2, -2, -2, -2, -1, 0, 1, 1, 2, 2, 2].map((column, state) => ({ state, column })),
  edges: [
    { from: 0, to: 4, labels: [['*']], next: false },
    { from: 1, to: 4, labels: [['*']], next: false },
    { from: 2, to: 4, labels: [['*']], next: false },
    { from: 3, to: 4, labels: [['*']], next: false },
    { from: 4, to: 5, labels: [['WORK:# R']], next: false },
    { from: 5, to: 6, labels: [['WORK:1 R']], next: false },
    { from: 5, to: 7, labels: [['WORK:0']], next: false },
    { from: 6, to: 9, labels: [['WORK:0 R']], next: false },
    { from: 6, to: 10, labels: [['WORK:1']], next: false },
    { from: 7, to: 7, labels: [['WORK:0 L'], ['WORK:1 L']], next: false },
    { from: 7, to: 8, labels: [['WORK:#']], next: false },
    { from: 10, to: 10, labels: [['WORK:0 L'], ['WORK:1 L']], next: false },
  ],
}
/**
 * A fan of three from one node, to the row above, its own row and the row below: `fact(12)` under binary in
 * `bmul17.s31.up31`. The middle edge's line runs between the other two, which leave it only as they near their rows.
 */
const FAN3: Local = {
  nodes: [-2, -1, 0, 1, 1, 2, 2, 2].map((column, state) => ({ state, column })),
  edges: [
    { from: 0, to: 1, labels: [['WORK:0 R'], ['WORK:1 R']], next: false },
    { from: 1, to: 2, labels: [['WORK:0 R'], ['WORK:1 R']], next: false },
    { from: 2, to: 3, labels: [['WORK:1']], next: false },
    { from: 2, to: 4, labels: [['WORK:0 L']], next: false },
    { from: 4, to: 5, labels: [['WORK:0 R']], next: false },
    { from: 4, to: 6, labels: [['WORK:1 R']], next: false },
    { from: 4, to: 7, labels: [['WORK:# R']], next: false },
  ],
}
const FAN3_NAMES = [
  'bmul17.s31.up29',
  'bmul17.s31.up30',
  'bmul17.s31.up31',
  'overflow',
  'bmul17.s31.need',
  'bmul17.s31.wr0',
  'bmul17.s31.wr1',
  'bmul17.s31.zlo',
]
/** The same level in `fact(4)`, `bmul17.s7.up7`: its names are shown whole, so its boxes are wider and gaps narrower. */
const FAN3_WHOLE_NAMES = [
  'bmul17.s7.up5',
  'bmul17.s7.up6',
  'bmul17.s7.up7',
  'overflow',
  'bmul17.s7.need',
  'bmul17.s7.wr0',
  'bmul17.s7.wr1',
  'bmul17.s7.zlo',
]
/**
 * The same level in `fact(12)`, `bmul17.s9.up31`: its names are as long as the cap shows whole, so the level is wider
 * than its panel and no gap is wider than its labels need.
 */
const FAN3_CAP_NAMES = [
  'bmul17.s9.up29',
  'bmul17.s9.up30',
  'bmul17.s9.up31',
  'overflow',
  'bmul17.s9.need',
  'bmul17.s9.wr0',
  'bmul17.s9.wr1',
  'bmul17.s9.zlo',
]
/** The same fan from its own node, `bmul17.s31.need`: its lower two edges fall steeply, side by side. */
const FAN_DOWN: Local = {
  nodes: [-2, -1, 0, 1, 1, 1, 2, 2].map((column, state) => ({ state, column })),
  edges: [
    { from: 0, to: 1, labels: [['WORK:0 R'], ['WORK:1 R']], next: false },
    { from: 1, to: 2, labels: [['WORK:0 L']], next: false },
    { from: 2, to: 3, labels: [['WORK:0 R']], next: false },
    { from: 2, to: 4, labels: [['WORK:1 R']], next: false },
    { from: 2, to: 5, labels: [['WORK:# R']], next: false },
    { from: 3, to: 6, labels: [['WORK:0/0 L'], ['WORK:1/0 L']], next: false },
    { from: 4, to: 6, labels: [['WORK:0/1 L'], ['WORK:1/1 L']], next: false },
    { from: 5, to: 7, labels: [['WORK:0/0'], ['WORK:1/0']], next: false },
    { from: 6, to: 2, labels: [['WORK:* L']], next: false },
    { from: 7, to: 7, labels: [['WORK:0 L'], ['WORK:1 L']], next: false },
  ],
}
const FAN_DOWN_NAMES = [
  'bmul17.s31.up30',
  'bmul17.s31.up31',
  'bmul17.s31.need',
  'bmul17.s31.wr0',
  'bmul17.s31.wr1',
  'bmul17.s31.zlo',
  'bmul17.s31.back',
  'bmul17.s31.done',
]
/**
 * A self-loop on a node whose column carries a backward edge from it up to the node above: `closure` under binary
 * in `bhd6.hs.at`. That edge's line runs up through the place over the lower node's arc.
 */
const COLUMN_LOOP: Local = {
  nodes: [-2, -2, -1, 0, 1, 2, 2].map((column, state) => ({ state, column })),
  edges: [
    { from: 0, to: 0, labels: [['HEAP:@ L'], ['HEAP:# L'], ['HEAP:0 L'], ['HEAP:1 L']], next: false },
    { from: 0, to: 2, labels: [['HEAP:_ R']], next: false },
    { from: 1, to: 2, labels: [['*']], next: false },
    { from: 2, to: 3, labels: [['HEAP:@']], next: false },
    { from: 3, to: 4, labels: [['WORK:# R']], next: false },
    { from: 4, to: 4, labels: [['WORK:0/1 R']], next: false },
    { from: 4, to: 5, labels: [['WORK:1/0']], next: false },
    { from: 4, to: 6, labels: [['WORK:# L']], next: false },
    { from: 5, to: 5, labels: [['WORK:0 L'], ['WORK:1 L']], next: false },
    { from: 6, to: 6, labels: [['WORK:0/0 L'], ['WORK:1/0 L']], next: false },
    { from: 6, to: 5, labels: [['WORK:# R']], next: false },
  ],
}
const COLUMN_LOOP_NAMES = [
  'bhd6.hs.rw.wl',
  'bhd6.hs.sk.sk17',
  'bhd6.hs.rw.on',
  'bhd6.hs.at',
  'bhd6.hs.dc.s.sk0',
  'bhd6.hs.dc.d',
  'bhd6.hs.dc.n',
]
/**
 * An edge rising to a node that a line along its row also comes into, from a node a backward edge curves under:
 * `fact(12)` under binary in `bmul17.p31.fin`. Its source's end of the line has the backward edge and its label
 * below and the source's self-loop label above, and its target's end is shared.
 */
const RISE: Local = {
  nodes: [-2, -2, -1, 0, 1, 2].map((column, state) => ({ state, column })),
  edges: [
    { from: 0, to: 2, labels: [['*']], next: false },
    { from: 1, to: 2, labels: [['REG:0 R', 'WORK:0/1 R']], next: false },
    {
      from: 1,
      to: 1,
      labels: [
        ['REG:0 R', 'WORK:1/0 R'],
        ['REG:1 R', 'WORK:0/0 R'],
        ['REG:1 R', 'WORK:1/1 R'],
      ],
      next: false,
    },
    {
      from: 2,
      to: 2,
      labels: [
        ['REG:0 R', 'WORK:0/0 R'],
        ['REG:0 R', 'WORK:1/1 R'],
        ['REG:1 R', 'WORK:0/1 R'],
      ],
      next: false,
    },
    { from: 2, to: 1, labels: [['REG:1 R', 'WORK:1/0 R']], next: false },
    { from: 2, to: 3, labels: [['REG:# L', 'WORK:# L']], next: false },
    { from: 3, to: 3, labels: [['REG:0 L'], ['REG:1 L']], next: false },
    { from: 3, to: 4, labels: [['REG:# L']], next: false },
    { from: 4, to: 4, labels: [['REG:0 L'], ['REG:1 L']], next: false },
    { from: 4, to: 5, labels: [['REG:# L']], next: false },
    { from: 5, to: 5, labels: [['REG:0 L'], ['REG:1 L']], next: false },
  ],
}
const RISE_NAMES = [
  'bmul17.p31.ws.sk0',
  'bmul17.p31.c1',
  'bmul17.p31.c0',
  'bmul17.p31.fin',
  'bmul17.p31.r1.rw4',
  'bmul17.p31.r1.rw3',
]

const FANS_NAMES = [
  'bdt35.q0.rx0.home',
  'bdt35.q0.rx1.home',
  'bdt35.q0.rx2.home',
  'bdt35.q0.rx3.home',
  'bdt35.n0',
  'bdt35.q1.s.sk0',
  'bdt35.q1.e0',
  'bdt35.q1.x0',
  'bdt35.q1.rx0.home',
  'bdt35.q1.e1',
  'bdt35.q1.x1',
]

describe('a name cut in the middle (decision 1)', () => {
  it('keeps a name that fits whole', () => {
    expect(middleCut('bpf31.l2.c0', fitsCap)).toBe('bpf31.l2.c0')
  })

  it('keeps the first segment and as many whole trailing segments as fit', () => {
    expect(middleCut('bpf31.l2.r1.rw2', fitsCap)).toBe('bpf31…r1.rw2')
    expect(middleCut('bpf31.l2.r1.home', fitsCap)).toBe('bpf31…r1.home')
    expect(middleCut('bcons12.cc.in.r.home', fitsCap)).toBe('bcons12…r.home')
    expect(middleCut('bcons123.cc.in.r.home', fitsCap)).toBe('bcons123…home')
  })

  it('cuts by characters, keeping more of the end, when the first and last segments do not fit together', () => {
    const cut = middleCut('accumulatorstate.finalphase', fitsCap)
    expect([...cut].length).toBeLessThanOrEqual(CAP_CHARS)
    expect(cut).toMatch(/^accu…/)
    expect(cut).toMatch(/phase$/)
  })

  it('shows two different names whole when their cuts would read the same', () => {
    const names = ['bpf31.l2.r1.home', 'bpf31.l3.r1.home', 'bpf31.l2.r1.rw2']
    expect(shownNames(names, charsWide, METRICS.cap)).toEqual(['bpf31.l2.r1.home', 'bpf31.l3.r1.home', 'bpf31…r1.rw2'])
  })

  it('lengthens only the cuts that would read the same, until they differ, short of the whole name', () => {
    // `bcons103…home` twice: a trailing segment more tells them apart, and the third name, which differs at its
    // cap, keeps it.
    const names = ['bcons103.lh.r1.home', 'bcons103.lh.r2.home', 'bcons103.lh.r1.rw0']
    expect(shownNames(names, charsWide, METRICS.cap)).toEqual(['bcons103…r1.home', 'bcons103…r2.home', 'bcons103…rw0'])
    // NAMES WITH NO DOTS, which differ only well inside their middle: more of each end until they differ, which is
    // still shorter than any of them whole.
    const long = ['alpha', 'beta', 'gamma', 'delta'].map((p) => `accumulator_phase_${p}_final_state`)
    const shown = shownNames(long, charsWide, METRICS.cap)
    expect(new Set(shown).size).toBe(long.length)
    for (const [i, s] of shown.entries()) {
      expect(s).toContain('…')
      expect([...s].length).toBeLessThan([...(long[i] ?? '')].length - 8)
    }
  })
})

describe('the local level laid out (decisions 1-3)', () => {
  const screenshot = layoutLocal(SCREENSHOT, (s) => NAMES[s] ?? '', METRICS, 844)
  const crowded = layoutLocal(CROWDED, (s) => CROWDED_NAMES[s] ?? '', METRICS, 400)

  it("shows the screenshot's names cut so each reads differently, in boxes sized to them", () => {
    const shown = screenshot.nodes.map((n) => n.text)
    expect(shown).toEqual(['bpf31…r1.rw2', 'bpf31…r1.rw1', 'bpf31…r1.rw0', 'bpf31…r1.home', 'bpf31…r2.home'])
    for (const n of screenshot.nodes) {
      expect(n.width).toBeGreaterThanOrEqual(METRICS.nameWidth(n.text) + METRICS.nodeChrome)
      expect(n.width).toBeLessThanOrEqual(METRICS.nameWidth(n.text) + METRICS.nodeChrome + 1)
    }
  })

  it('draws a line per rule, and no label over a node, a self-loop or another line, or near another label', () => {
    for (const layout of [screenshot, crowded]) {
      for (const e of layout.edges) expect(e.label.lines).toEqual(e.labels.flat())
      expect(collisions(layout)).toEqual([])
    }
  })

  it('keeps every label inside the drawing and apart from the others, whole and cut to one rule, at any width', () => {
    // FURTHER APART THAN ONE LABEL'S RULES ARE, so two edges' labels never read as one label of more rules.
    expect(LABEL_GAP).toBeGreaterThanOrEqual(2 * RULE_GAP)
    const fixtures: [string, Local, readonly string[]][] = [
      ['screenshot', SCREENSHOT, NAMES],
      ['crowded', CROWDED, CROWDED_NAMES],
      ['clip', CLIP, CLIP_NAMES],
    ]
    for (const [name, local, names] of fixtures) {
      for (const reach of [REACH, 1]) {
        for (const width of [0, 400, 844]) {
          const layout = layoutLocal(within(local, reach), (s) => names[s] ?? '', METRICS, width)
          expect(collisions(layout), `${name} within ${reach}, ${width} px`).toEqual([])
        }
      }
    }
  })

  it("sets each label nearer its own edge's line than any other edge's, whole and cut to one rule", () => {
    // AT ITS OWN NATURAL WIDTH, `FANS` HAS NO ROOM TO SPARE: the fall of `bdt35.q1.e0`'s two edges and the rise across
    // them leave `WORK:0 R` as near the rising line as its own, so it is measured spread over the screenshot's panel.
    const fixtures: [string, Local, readonly string[], readonly number[]][] = [
      ['fans', FANS, FANS_NAMES, [844]],
      ['fans', within(FANS, 1), FANS_NAMES, [0, 400, 844]],
      ['clip', CLIP, CLIP_NAMES, [0, 400, 844]],
      // THE SCREENSHOT'S PANEL, as the examples are measured in (the design doc's "Placing labels").
      ['fan3', FAN3, FAN3_NAMES, [844]],
      ['fan3, names whole', FAN3, FAN3_WHOLE_NAMES, [844]],
      ['fan3, names at the cap', FAN3, FAN3_CAP_NAMES, [829, 844]],
      ['fan down', FAN_DOWN, FAN_DOWN_NAMES, [844]],
      ['column loop', COLUMN_LOOP, COLUMN_LOOP_NAMES, [0, 400, 844]],
      ['rise', RISE, RISE_NAMES, [844]],
    ]
    const found: string[] = []
    for (const [name, local, names, widths] of fixtures) {
      for (const reach of [REACH, 1]) {
        for (const width of widths) {
          const layout = layoutLocal(within(local, reach), (s) => names[s] ?? '', METRICS, width)
          for (const f of [...misread(layout), ...collisions(layout)])
            found.push(`${name} within ${reach}, ${width} px: ${f}`)
        }
      }
    }
    expect(found).toEqual([])
  })

  it("sets a fan's label by its own line in the narrowest gap, its tape named REG, WORK, STACK, HEAP or BOX", () => {
    // A panel of no width, for the narrowest gaps. None of the fan's rules writes: a rule that writes, such as
    // `STACK:0/1 R`, is not covered here.
    const found: string[] = []
    for (const tape of ['REG', 'WORK', 'STACK', 'HEAP', 'BOX']) {
      const local: Local = {
        nodes: FAN3.nodes,
        edges: FAN3.edges.map((e) => ({ ...e, labels: e.labels.map((r) => r.map((l) => l.replace('WORK', tape))) })),
      }
      const layout = layoutLocal(local, (s) => FAN3_CAP_NAMES[s] ?? '', METRICS, 0)
      for (const f of [...misread(layout), ...collisions(layout)]) found.push(`${tape}: ${f}`)
    }
    expect(found).toEqual([])
  })

  it("sets each self-loop's label above its arc, clear of it", () => {
    for (const e of [...screenshot.edges, ...crowded.edges].filter((e) => e.from === e.to)) {
      expect(e.label.box.bottom, `${e.from} ${e.label.lines.join('/')}`).toBeLessThan(e.box.top)
    }
  })

  it("keeps each self-loop's label just above its own arc, over it, where a line runs up its column", () => {
    for (const reach of [REACH, 1]) {
      for (const width of [0, 400, 844]) {
        const layout = layoutLocal(within(COLUMN_LOOP, reach), (s) => COLUMN_LOOP_NAMES[s] ?? '', METRICS, width)
        for (const e of layout.edges.filter((e) => e.from === e.to)) {
          const at = `${e.from} within ${reach}, ${width} px`
          const b = e.label.box
          expect(e.box.top - b.bottom, at).toBeGreaterThan(0)
          expect(e.box.top - b.bottom, at).toBeLessThanOrEqual(4)
          expect(Math.min(b.right, e.box.right) - Math.max(b.left, e.box.left), at).toBeGreaterThan(0)
        }
      }
    }
  })

  it('widens the gaps to their longest label, and spreads a narrower level across its panel', () => {
    // The screenshot's level is narrower than its 844 px panel, so it spans the panel.
    expect(screenshot.width).toBe(844)
    // The crowded one is wider than 400 px, so it keeps its own width and the panel scrolls; its widest gap label,
    // the two-tape rule's wider line, still fits between the columns it joins.
    expect(crowded.width).toBeGreaterThan(400)
    const wide = crowded.edges.find((e) => e.labels[0]?.[0] === 'REG:0/1 R')
    const from = crowded.nodes.find((n) => n.state === 3)
    const to = crowded.nodes.find((n) => n.state === 6)
    expect(wide?.label.box.left).toBeGreaterThan((from?.x ?? 0) + (from?.width ?? 0))
    expect(wide?.label.box.right).toBeLessThan(to?.x ?? 0)
  })

  it('sets a rule that touches several tapes a tape a line, and its rules apart, in a gap its widest line fits', () => {
    const two: Local = {
      nodes: [
        { state: 0, column: 0 },
        { state: 1, column: 1 },
      ],
      edges: [
        {
          from: 0,
          to: 1,
          labels: [
            ['REG:0 R', 'WORK:0/0 R'],
            ['REG:1 R', 'WORK:1/1 R'],
          ],
          next: false,
        },
      ],
    }
    const layout = layoutLocal(two, (s) => `q${s}`, METRICS, 0)
    const label = layout.edges[0]?.label
    expect(label?.lines).toEqual(['REG:0 R', 'WORK:0/0 R', 'REG:1 R', 'WORK:1/1 R'])
    const step = METRICS.ascent + METRICS.descent
    const b = label?.baselines ?? []
    expect([(b[1] ?? 0) - (b[0] ?? 0), (b[2] ?? 0) - (b[1] ?? 0), (b[3] ?? 0) - (b[2] ?? 0)]).toEqual([
      step,
      step + RULE_GAP,
      step,
    ])
    // THE GAP IS SIZED TO `WORK:0/0 R`, not to the rule's two tapes on one line.
    const [from, to] = layout.nodes
    const gap = (to?.x ?? 0) - (from?.x ?? 0) - (from?.width ?? 0)
    expect(gap).toBeGreaterThan(METRICS.labelWidth('WORK:0/0 R'))
    expect(gap).toBeLessThan(METRICS.labelWidth('REG:0 R WORK:0/0 R'))
  })

  it('spaces a label whose rules are a line each evenly, a line a rule', () => {
    for (const e of screenshot.edges) {
      const b = e.label.baselines
      for (let i = 1; i < b.length; i += 1) {
        expect((b[i] ?? 0) - (b[i - 1] ?? 0)).toBeCloseTo(METRICS.ascent + METRICS.descent)
      }
    }
  })

  it('names the part of the drawing anything is drawn in, with the margin it leaves above it round it', () => {
    // A LEVEL WITH NOTHING BEFORE ITS CURRENT STATE, in a panel wider than it: the gaps on its left, which hold no
    // state, spread with the rest, and leave room in the drawing that holds nothing.
    const ahead: Local = {
      nodes: [0, 1, 2].map((state) => ({ state, column: state })),
      edges: [
        { from: 0, to: 1, labels: [['REG:# R']], next: true },
        { from: 1, to: 2, labels: [['REG:# R']], next: false },
      ],
    }
    const lopsided = layoutLocal(ahead, (s) => ['start', 'middle', 'end'][s] ?? '', METRICS, 1000)
    for (const [name, layout] of Object.entries({ screenshot, crowded, lopsided })) {
      const boxes = [...layout.nodes.map(nodeBox), ...layout.edges.flatMap((e) => [e.box, e.label.box])]
      const margin = Math.min(...boxes.map((b) => b.top))
      const left = Math.min(...boxes.map((b) => b.left))
      const right = Math.max(...boxes.map((b) => b.right))
      expect(layout.inked.left, `${name}, its left`).toBeCloseTo(Math.max(0, left - margin), 6)
      expect(layout.inked.right, `${name}, its right`).toBeCloseTo(Math.min(layout.width, right + margin), 6)
      expect(layout.inked.top, `${name}, its top`).toBe(0)
      expect(layout.inked.bottom, `${name}, its bottom`).toBe(layout.height)
    }
    expect(lopsided.width, 'precondition: spread to the panel').toBe(1000)
    expect(lopsided.inked.left, 'precondition: room on its left that holds nothing').toBeGreaterThan(100)
  })

  it('leaves the same margin above and below what it draws', () => {
    for (const layout of [screenshot, crowded]) {
      const boxes = [...layout.nodes.map(nodeBox), ...layout.edges.flatMap((e) => [e.box, e.label.box])]
      const top = Math.min(...boxes.map((b) => b.top))
      const bottom = Math.max(...boxes.map((b) => b.bottom))
      expect(top).toBeCloseTo(layout.height - bottom, 0)
    }
  })
})

/**
 * `closure` under binary in `btl11.hs.dc.r.home`: a backward edge from `hs.dc.s.sk0` down to `hs.dc.n` under it, whose
 * line rises up their column through the place over `hs.dc.n`'s self-loop.
 */
const HOME: Local = {
  nodes: [
    { state: 0, column: -2 },
    { state: 1, column: -2 },
    { state: 2, column: -1 },
    { state: 3, column: 0 },
    { state: 4, column: 1 },
    { state: 5, column: 2 },
    { state: 6, column: 2 },
  ],
  edges: [
    { from: 0, to: 0, labels: [['WORK:0/1 R']], next: false },
    { from: 0, to: 2, labels: [['WORK:1/0']], next: false },
    { from: 0, to: 1, labels: [['WORK:# L']], next: false },
    { from: 1, to: 1, labels: [['WORK:0/0 L'], ['WORK:1/0 L']], next: false },
    { from: 1, to: 2, labels: [['WORK:# R']], next: false },
    { from: 2, to: 2, labels: [['WORK:0 L'], ['WORK:1 L']], next: false },
    { from: 2, to: 3, labels: [['WORK:#']], next: false },
    { from: 3, to: 4, labels: [['WORK:# R']], next: false },
    { from: 4, to: 5, labels: [['WORK:1']], next: false },
    { from: 4, to: 4, labels: [['WORK:0 R']], next: false },
    { from: 4, to: 6, labels: [['WORK:# L']], next: false },
    { from: 5, to: 5, labels: [['WORK:0 L'], ['WORK:1 L']], next: false },
    { from: 6, to: 6, labels: [['WORK:0 L'], ['WORK:1 L']], next: false },
  ],
}
const HOME_NAMES = [
  'btl11.hs.dc.s.sk0',
  'btl11.hs.dc.n',
  'btl11.hs.dc.d',
  'btl11.hs.dc.r.home',
  'btl11.hs.bz.s.sk0',
  'btl11.hs.bz.nz',
  'btl11.hs.bz.z',
]

/**
 * `local` cut to the states within `reach` rules of its current one: the level of a state with nothing further away,
 * still laid out in `REACH`'s columns.
 */
function within(local: Local, reach: number): Local {
  const kept = new Set(local.nodes.filter((n) => Math.abs(n.column) <= reach).map((n) => n.state))
  return {
    nodes: local.nodes.filter((n) => kept.has(n.state)),
    edges: local.edges.filter((e) => kept.has(e.from) && kept.has(e.to)),
  }
}

describe('a level a fraction of a pixel wider than its panel', () => {
  it("fits its panel where a self-loop's room past a line up its column leaves a fraction of a pixel over", () => {
    // IN HACK'S WIDTHS, `closure`'s level in `btl11.hs.dc.r.home` needs 829.3 px with the room `hs.dc.n`'s label
    // takes right of the line up its column: an 844 px panel less a classic scroll bar's kept room.
    const hack: Metrics = {
      ...METRICS,
      nameWidth: (s) => [...s].length * 7.224609375,
      labelWidth: (s) => [...s].length * 6.0205078125,
      cap: CAP_CHARS * 7.224609375,
    }
    const names = (s: number) => HOME_NAMES[s] ?? ''
    const layout = layoutLocal(HOME, names, hack, 829)
    expect(layout.width).toBe(829)
    expect(collisions(layout)).toEqual([])
    expect(misread(layout)).toEqual([])
    expect(layoutLocal(HOME, names, hack, 828).width).toBe(829)
  })
})

describe('a label with no place clear of everything', () => {
  /** `step` at a time from `box` until it meets none of `obstacles`, as the last resort once moved: the reference. */
  function stepwise(box: Box, step: number, obstacles: readonly Box[]): number {
    let dy = 0
    const at = () => ({ ...box, top: box.top + dy, bottom: box.bottom + dy })
    while (obstacles.some((o) => meets(at(), o))) dy += step
    return dy
  }

  it('lands where moving a step at a time would, up or down, past boxes in its way, beside it or behind it', () => {
    // SCATTERED BOXES, from a fixed seed so every run weighs the same cases, many of them across the label's way.
    let seed = 7
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let run = 0; run < 200; run += 1) {
      const obstacles = Array.from({ length: 1 + Math.floor(next() * 40) }, () => {
        const left = next() * 200
        const top = next() * 400 - 200
        return { left, top, right: left + 1 + next() * 60, bottom: top + 0.5 + next() * 30 }
      })
      const left = next() * 150
      const top = next() * 100 - 50
      const box = { left, top, right: left + 6 + next() * 50, bottom: top + 11 + next() * 20 }
      for (const step of [2, -2]) {
        expect(firstClear(box, step, obstacles), `run ${run}, step ${step}`).toBe(stepwise(box, step, obstacles))
      }
    }
  })

  it('sits by its own line in a fan too crowded to weigh every place of every label, the same each time', () => {
    // `fact(12)`'s level in `pc20`: 32 states each with one edge into `bdt25.n0`, whose lines close in on one point
    // too steeply for any label between them, so the level weighs more places than it may before the last labels.
    const fan: Local = {
      nodes: [
        ...Array.from({ length: 32 }, (_, i) => ({ state: i, column: -2 })),
        { state: 32, column: -1 },
        { state: 33, column: 0 },
        { state: 34, column: 1 },
      ],
      edges: [
        ...Array.from({ length: 32 }, (_, i) => ({ from: i, to: 32, labels: [['*']], next: false })),
        { from: 32, to: 33, labels: [['*']], next: false },
        { from: 33, to: 34, labels: [['*']], next: false },
      ],
    }
    const names = [...Array.from({ length: 32 }, (_, i) => `bdt25.q0.rx${i}.home`), 'bdt25.n0', 'pc20', 'halt']
    const layout = layoutLocal(fan, (s) => names[s] ?? '', METRICS, 844)
    expect(collisions(layout)).toEqual([])
    const far = layout.edges.flatMap((e) => {
      const own = lineDistance(e.d, e.label.box)
      return own > 2 * NODE_HEIGHT ? [`${e.from}->${e.to} is ${own.toFixed(1)} px from its own line`] : []
    })
    expect(far).toEqual([])
    expect(layoutLocal(fan, (s) => names[s] ?? '', METRICS, 844)).toEqual(layout)
  })

  it('looks at each box in its way a few times, not once a step', () => {
    // A THOUSAND BOXES 10 PX TALL AND 5 APART, too near each other for a label 10 px tall between any two, listed
    // from the far end: a step at a time, each step would look through most of them for the one it meets.
    let reads = 0
    const counted = (b: Box): Box => ({
      get left() {
        reads += 1
        return b.left
      },
      get top() {
        reads += 1
        return b.top
      },
      get right() {
        reads += 1
        return b.right
      },
      get bottom() {
        reads += 1
        return b.bottom
      },
    })
    const stack = Array.from({ length: 1000 }, (_, i) => ({ left: 0, top: 15 * i, right: 50, bottom: 15 * i + 10 }))
    const label = { left: 10, top: 0, right: 40, bottom: 10 }
    const down = stack.map(counted).reverse()
    expect(firstClear(label, 2, down)).toBe(14996)
    expect(reads).toBeLessThanOrEqual(20 * stack.length)
    reads = 0
    const below = { left: 10, top: 14990, right: 40, bottom: 15000 }
    expect(firstClear(below, -2, stack.map(counted))).toBe(-15000)
    expect(reads).toBeLessThanOrEqual(20 * stack.length)
  })
})

describe('a level with nothing two rules away', () => {
  /** A state between one before it and one after it, and nothing in the outer columns. */
  const THREE: Local = {
    nodes: [-1, 0, 1].map((column, state) => ({ state, column })),
    edges: [
      { from: 0, to: 1, labels: [['*']], next: false },
      { from: 1, to: 2, labels: [['*']], next: false },
    ],
  }
  const names = (s: number) => ['before', 'here', 'after'][s] ?? ''
  /** The space left of the first box, right of the last, and between the first two. */
  function spaces(l: LocalLayout): { left: number; right: number; inner: number } {
    const [a, s, b] = [0, 1, 2].map((state) => l.nodes.find((n) => n.state === state))
    if (a === undefined || s === undefined || b === undefined) throw new Error('a node missing')
    return { left: a.x, right: l.width - (b.x + b.width), inner: s.x - (a.x + a.width) }
  }

  it('takes no room for the empty outer columns in a panel narrower than it would be with them', () => {
    const least = layoutLocal(THREE, names, METRICS, 0)
    // `PAD`, the drawing's margin, and no gap past it: within the half pixel a whole width can take or give.
    expect(spaces(least).left).toBeCloseTo(8, 0)
    expect(spaces(least).right).toBeCloseTo(8, 0)
    // A PANEL SHORT OF THE ROOM THE EMPTY COLUMNS' GAPS WOULD TAKE: it fits, the room shared out either side.
    const between = layoutLocal(THREE, names, METRICS, least.width + 30)
    expect(between.width).toBe(least.width + 30)
    expect(spaces(between).left).toBeCloseTo(spaces(between).right, 6)
    expect(spaces(between).inner).toBe(spaces(least).inner)
  })

  it('keeps a backward label wider than its columns inside the drawing in a panel too narrow for it', () => {
    // TWO STATES SIDE BY SIDE AND AN EDGE BACK, whose label is wider than the two columns and the gap between them.
    const BACK: Local = {
      nodes: [0, 1].map((column, state) => ({ state, column })),
      edges: [{ from: 1, to: 0, labels: [['accumulator:0/1 R accumulator:1/0 R']], next: false }],
    }
    for (const width of [0, 100, 150, 200]) {
      const l = layoutLocal(BACK, (s) => ['a', 'b'][s] ?? '', METRICS, width)
      const box = l.edges[0]?.label.box
      expect(box?.right ?? 0, `${width} px: precondition, a label wider than 200 px`).toBeGreaterThan(
        (box?.left ?? 0) + 200,
      )
      expect(box?.left, `${width} px: its left edge`).toBeGreaterThanOrEqual(0)
      expect(box?.right, `${width} px: its right edge`).toBeLessThanOrEqual(l.width)
    }
  })

  it('spreads a panel wider than it with the empty outer columns over every gap alike', () => {
    const wide = spaces(layoutLocal(THREE, names, METRICS, 1000))
    expect(wide.left - 8).toBeCloseTo(wide.inner, 6)
    expect(wide.right - 8).toBeCloseTo(wide.inner, 6)
  })
})
