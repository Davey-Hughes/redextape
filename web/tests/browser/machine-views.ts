import { beforeAll, expect, type Mock, vi } from 'vitest'
import { page } from 'vitest/browser'
import init, { compile } from '../../../pkg/redextape_wasm.js'
import initClif, { ClifSession } from '../../../pkg-clif/redextape_clif_wasm.js'
import { ClifPane, type ClifPanels } from '../../src/clif-pane'
import { EXAMPLE_ENCODING, EXAMPLES } from '../../src/examples'
import type { Shares } from '../../src/panel-stack'
import { RxmPane, type RxmPanels } from '../../src/rxm-pane'
import type { ClifListing, ClifState } from '../../src/types'
import { FACT3, frameOf, listWord, valueWord } from '../node/rxm-fixtures'
import { boundary, controlState, frames, inertEvents, panelOf, panelToggle, region } from './harness'

/**
 * THE TWO MACHINE VIEWS, BUILT BY HAND FOR THE BROWSER FILES THAT HOLD THEIR PANELS (the machine panels row design):
 * an rxm view and a CLIF view, each in a host a test sizes itself, drawn with whatever counts the test names, and the
 * readers those files share. One place, so a case about a header and a case about the row measure the same view.
 */

const CONTROLS = controlState(true, 'step 3 of 55')

let clifListing: ClifListing

/** `fact.rxt`'s CLIF listing, which `loadViews` loads and the CLIF view draws. */
export const factClif = (): ClifListing => clifListing

/**
 * Size the page and load what `VIEWS` builds from, before the calling file's first case: the CLIF view's listing is
 * `fact.rxt`'s from a real `ClifSession`. A function and not a hook of this module's own, which would be registered
 * for whichever file imported it first and for no other.
 */
export function loadViews(): void {
  beforeAll(async () => {
    await page.viewport(1280, 1000)
    await init()
    await initClif()
    const fact = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
    const { session } = compile(fact, EXAMPLE_ENCODING) as { session: { clifInput(): unknown; free(): void } | null }
    if (session === null) throw new Error('fact.rxt compiled to no session')
    const clif = new ClifSession(session.clifInput(), 'as-built')
    clifListing = clif.listing() as ClifListing
    clif.free()
    session.free()
  })
}

/**
 * How much a frame's counts say: the call stack's frames, the heap's cells and boxes. `rows`, where given, is how many
 * rows the call stack and the first panel draw: frames, and locals in rxm or values in CLIF. With none given they draw
 * no frame and no local or value. The rest say what those rows read, for a case that needs a text long enough to cut.
 */
export type Counts = {
  readonly depth: number
  readonly cells: number
  readonly boxes: number
  readonly rows?: { readonly stack: number; readonly values: number }
  /** The word of value or local `i`, and the head of heap cell `i + 1`: `String(i)` without it. */
  readonly words?: (i: number) => string
  /** The rxm registers every CLIF value names. */
  readonly regs?: readonly string[]
  /** How many heap cells the window draws as lines, each with `nil` for its tail. */
  readonly lines?: number
  /** The word every rxm frame saved, as its one saved register. */
  readonly saved?: string
  /**
   * The run has ended with this word, and the view is told to mark it: rxm's `next` is `null` and `rr` holds it, and
   * clif's `next` is `null` and `returned` is the last value drawn, which holds it.
   */
  readonly result?: string
  /** The register the rxm frame's last instruction wrote. */
  readonly wrote?: string
}

/** `n` of what `one` makes, its index given. */
const many = <T>(n: number, one: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => one(i))

/** The word `c` gives value, local or heap head `i`. */
const wordOf = (c: Counts, i: number) => valueWord(c.words?.(i) ?? String(i))

/** The heap cells `c` draws as lines. */
const cellsOf = (c: Counts) => many(c.lines ?? 0, (i) => ({ cell: i + 1, head: wordOf(c, i), tail: listWord('0') }))

/** The stored panel states either view reads: each takes its own names from it. */
export type StoredPanels = RxmPanels & ClifPanels

export type Mounted = {
  readonly host: HTMLElement
  readonly pane: RxmPane | ClifPane
  /** Draw a frame whose counts are `c`. */
  draw(c: Counts): void
}

/**
 * Each view, with the thresholds its least widths (the design's §5.1) and the row's gap of 8px (the after-the-try
 * design's G2) give it, wide from `wide` px and medium from `medium`, the name of its first panel, and the parts of the
 * row its values, call stack and heap take, in that order.
 */
export const VIEWS = [
  {
    kind: 'rxm',
    values: 'registers',
    wide: 880,
    medium: 584,
    parts: [1, 1, 1],
    build(host: HTMLElement, panels: StoredPanels, sizes: Shares, onSizes: (s: Shares) => void): Mounted {
      const pane = new RxmPane(host, inertEvents({ panelSizes: onSizes }), panels, sizes)
      pane.setProgram(FACT3)
      const draw = (c: Counts) => {
        pane.setResult(c.result !== undefined)
        pane.render(
          frameOf({
            pc: 3,
            next: c.result === undefined ? 3 : null,
            rr: valueWord(c.result ?? '0'),
            wrote: c.wrote ?? null,
            depth: c.depth,
            heap_len: c.cells,
            box_len: c.boxes,
            frames: many(c.rows?.stack ?? 0, () => {
              const saved = c.saved === undefined ? [] : [valueWord(c.saved)]
              return { ret_pc: 3, saved, saved_len: saved.length }
            }),
            locals: many(c.rows?.values ?? 0, (i) => wordOf(c, i)),
            cells: cellsOf(c),
          }),
          CONTROLS,
        )
      }
      draw({ depth: 1, cells: 1, boxes: 0 })
      return { host, pane, draw }
    },
  },
  {
    kind: 'clif',
    values: 'values',
    wide: 606,
    medium: 362,
    parts: [1, 2, 2],
    build(host: HTMLElement, panels: StoredPanels, sizes: Shares, onSizes: (s: Shares) => void): Mounted {
      const pane = new ClifPane(host, inertEvents({ panelSizes: onSizes }), panels, sizes)
      pane.setProgram({ listing: clifListing, level: 'as-built' })
      const at = { function: 0, inst: 0 }
      const draw = (c: Counts) => {
        const count = c.rows?.values ?? 0
        const word = (i: number) => (c.result !== undefined && i === count - 1 ? valueWord(c.result) : wordOf(c, i))
        const s: ClifState = {
          step: 1,
          at,
          next: c.result === undefined ? at : null,
          pc: null,
          values: many(count, (i) => ({ value: i, word: word(i), regs: [...(c.regs ?? [])] })),
          values_len: count,
          returned: c.result === undefined ? null : count - 1,
          depth: c.depth,
          frames: many(c.rows?.stack ?? 0, () => at),
          heap_len: c.cells,
          result: null,
          cells: cellsOf(c),
          box_len: c.boxes,
          boxes: [],
        }
        pane.setResult(c.result !== undefined)
        pane.render(s, CONTROLS)
      }
      draw({ depth: 1, cells: 1, boxes: 0 })
      return { host, pane, draw }
    },
  },
] as const

export type View = (typeof VIEWS)[number]

/**
 * A view `width` px wide and `height` tall, built with the stored `panels` and `sizes`, on the page unless `parent`
 * is given, which is where it goes (`null`: nowhere yet). `sizes` in what it answers hears each share the view stores.
 */
export function mount(
  view: View,
  width: number,
  o: { height?: number; panels?: StoredPanels; sizes?: Shares; parent?: HTMLElement | null } = {},
): Mounted & { readonly sizes: Mock<(s: Shares) => void> } {
  const sizes = vi.fn<(s: Shares) => void>()
  const host = document.createElement('section')
  host.className = 'pane'
  host.dataset.kind = view.kind
  host.style.height = `${o.height ?? 900}px`
  host.style.width = `${width}px`
  if (o.parent !== null) (o.parent ?? document.body).append(host)
  return { ...view.build(host, o.panels ?? {}, o.sizes ?? {}, sizes), sizes }
}

/** Make the view `width` px wide and wait for two frames, the first of which its observers see. */
export async function resize(host: HTMLElement, width: number): Promise<void> {
  host.style.width = `${width}px`
  await frames()
}

/**
 * Whether `el`'s text is drawn whole: none of it past the box that clips it, by the box's scroll width and by the
 * glyphs' own box (an ellipsis is drawn over the text, not in place of its layout).
 */
export function whole(el: HTMLElement): boolean {
  const range = document.createRange()
  range.selectNodeContents(el)
  const glyphs = range.getBoundingClientRect()
  const clip = el.getBoundingClientRect()
  return el.scrollWidth <= el.clientWidth && glyphs.left >= clip.left - 0.5 && glyphs.right <= clip.right + 0.5
}

/** The row the first two panels share. */
export const row = (host: HTMLElement) => host.querySelector('.rxm-machine') as HTMLElement

/** The box of the panel named `name`. */
export const box = (host: HTMLElement, name: string) => panelOf(host, name).getBoundingClientRect()

/** The arrangement the row says it is in (`machine-row.ts`). */
export const arrangement = (host: HTMLElement) => row(host).dataset.arrangement

/** Each boundary the view draws, top to bottom, as the two regions it parts. */
export const boundaryKeys = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('.panel-boundary')].map((b) => `${b.dataset.above}|${b.dataset.below}`)

/** The width of each column a row of `parts` draws, the row as wide as it is now. */
export function columnsOf(host: HTMLElement, parts: readonly number[]): readonly number[] {
  const gap = Number.parseFloat(getComputedStyle(row(host)).columnGap)
  const room = row(host).getBoundingClientRect().width - (parts.length - 1) * gap
  const sum = parts.reduce((a, b) => a + b, 0)
  return parts.map((p) => (room * p) / sum)
}

/**
 * The arrangement a view is drawn in, by where its three panels' boxes are, which of them the row holds and whether the
 * call stack's and the heap's regions are hidden, `values` naming its first panel: what the page shows, to hold
 * against what the row says it chose.
 */
export function drawnAs(host: HTMLElement, values: string): string {
  const [v, s, h] = [box(host, values), box(host, 'stack'), box(host, 'heap')]
  const stackRegion = region(host, 'stack')
  const stackIn = panelOf(host, 'stack').parentElement
  const stackInRow = stackIn === row(host)
  const heapInRow = panelOf(host, 'heap').parentElement === row(host)
  const outside = stackInRow && stackRegion?.hidden === true
  if (
    outside &&
    heapInRow &&
    region(host, 'heap').hidden &&
    v.top === s.top &&
    s.top === h.top &&
    v.right < s.left &&
    s.right < h.left
  )
    return 'wide'
  if (outside && !heapInRow && v.top === s.top && v.right < s.left && h.top > s.bottom) return 'medium'
  const inRegion = stackRegion !== null && stackIn === stackRegion && !stackRegion.hidden
  if (inRegion && !heapInRow && s.top > v.bottom && h.top > s.bottom && v.width === s.width) return 'narrow'
  return `none: ${JSON.stringify({ stackInRow, stackRegion: stackRegion?.hidden, heapInRow, v, s, h })}`
}

/**
 * Each boundary the view draws, top to bottom, as the two regions it parts and how far under its bottom what is drawn
 * next begins, in whole pixels: `listing|machine 0` where the boundary takes the place of the gap above it. What is
 * drawn next is the lower region, or the header of a closed region between the two, as a CLIF view's closed machine
 * code panel is (`codeUnder` measures the row under that one).
 */
export const underBoundaries = (host: HTMLElement): string[] =>
  boundaryKeys(host).map((k) => {
    const [above = '', below = ''] = k.split('|')
    const bar = boundary(host, above, below)
    let next = bar.nextElementSibling
    while (next !== null && getComputedStyle(next).display === 'none') next = next.nextElementSibling
    const gap = (next ?? region(host, below)).getBoundingClientRect().top - bar.getBoundingClientRect().bottom
    return `${k} ${Math.round(gap)}`
  })

/**
 * How far under the closed machine code panel of a CLIF view the region below it begins, and how far under the
 * boundary above the panel the panel does, in whole pixels: the gap a panel keeps above itself, and none.
 */
export const codeUnder = (host: HTMLElement): readonly [number, number] => {
  const code = panelOf(host, 'code')
  const after = code.nextElementSibling as HTMLElement
  const before = code.previousElementSibling as HTMLElement
  const top = code.getBoundingClientRect()
  return [
    Math.round(after.getBoundingClientRect().top - top.bottom),
    Math.round(top.top - before.getBoundingClientRect().bottom),
  ]
}

/** The header of the panel named `name`, and its count, its title and its maximise button. */
export const header = (host: HTMLElement, name: string) =>
  panelOf(host, name).querySelector('.panel-header') as HTMLElement
export const note = (host: HTMLElement, name: string) => header(host, name).querySelector('.panel-note') as HTMLElement
export const title = (host: HTMLElement, name: string) => header(host, name).querySelector('.panel-name') as HTMLElement
export const maximise = (host: HTMLElement, name: string) =>
  panelOf(host, name).querySelector('.panel-maximise') as HTMLButtonElement

/**
 * Hold that the body of the panel named `name` is `n` of its rows tall and shows `n` whole, its rows its values' or
 * its frames', each a line, several side by side where the values' grid has room: by their boxes, not their text.
 * The body holds more rows than `n`, so a body that is `n` tall cuts the next at its edge.
 */
export function expectRows(host: HTMLElement, name: string, n: number, when: string): void {
  const body = document.getElementById(panelToggle(host, name).getAttribute('aria-controls') ?? '') as HTMLElement
  const b = body.getBoundingClientRect()
  const rows = [...body.querySelectorAll<HTMLElement>('.rxm-register, .rxm-frame')].map((r) =>
    r.getBoundingClientRect(),
  )
  const lines = (rs: DOMRect[]) => new Set(rs.map((r) => Math.round(r.top))).size
  const row = rows[0]?.height ?? 0
  expect(lines(rows), `precondition: ${when}, the ${name} has more than ${n} rows`).toBeGreaterThan(n)
  expect(row, `precondition: ${when}, a row of the ${name} is drawn`).toBeGreaterThan(0)
  expect(b.height, `${when}: the body of the ${name} is not ${n} rows tall`).toBeCloseTo(n * row, 0)
  const whole = rows.filter((r) => r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5)
  expect(lines(whole), `${when}: the ${name} does not show ${n} rows whole`).toBe(n)
}
