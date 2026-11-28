import { describe, expect, it } from 'vitest'
import type { ClifPane } from '../../src/clif-pane'
import { pcColumn } from '../../src/clif-view'
import type { RxmPane } from '../../src/rxm-pane'
import type { ClifAt } from '../../src/types'
import { FACT3 } from '../node/rxm-fixtures'
import { controlState, frames, hearLoops } from './harness'
import { arrangement, type Counts, factClif, loadViews, mount, resize, VIEWS, type View, whole } from './machine-views'

/**
 * THE ROOM THE MACHINE PANELS KEEP (the squeezed values design), in an rxm view and a clif view built by hand. Each
 * track of the rxm registers is at least as wide as the widest row the run has drawn since the view was told of its
 * program, and each of the clif values as wide as a 20-digit word's row from the first step, so a value reads whole
 * wherever the panel is as wide as its row, and is cut, with the tooltip `cut-text.ts` gives it, only where the panel
 * is narrower. A frame or a heap line too long for its panel goes on below, indented, and a heap line keeps the lines
 * its longest text took, as a clif frame keeps its pc as wide as the listing's widest. The room only grows: a step back
 * to shorter texts or a frame of none moves nothing, and only a new program or listing forgets it.
 * `result-app.test.ts` holds fact(12)'s `rr` in the app.
 */

loadViews()

hearLoops(() => {
  document.body.innerHTML = ''
})

/** fact(12)'s result, nine digits: a row of it with a short name needs every character of the grid's least track. */
const NINE = '479001600'
/** The largest word, 20 digits. */
const LONG = '18446744073709551615'
/** How wide a view the line cases use: narrow enough that a frame or a heap line holding `LONG` takes more than one. */
const LINES = 90

/** A frame of twelve values or locals, each a short word. */
const SHORT: Counts = { depth: 1, cells: 1, boxes: 0, rows: { stack: 0, values: 12 } }
/** The same frame with `NINE` in value 0. */
const ONE_NINE: Counts = { ...SHORT, words: (i) => (i === 0 ? NINE : String(i)) }
/** The same frame with `LONG` in value 0. */
const ONE_LONG: Counts = { ...SHORT, words: (i) => (i === 0 ? LONG : String(i)) }

/** The name of value `i`'s row: a local's in rxm, a value's in clif. */
const nameOf = (view: View, i: number) => (view.kind === 'rxm' ? `r${i}` : `v${i}`)

const list = (host: HTMLElement) => host.querySelector('.rxm-register-list') as HTMLElement
/** The values panel's body, which holds the grid and its room. */
const body = (host: HTMLElement) => host.querySelector('.rxm-registers') as HTMLElement
const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.rxm-register')]
/** How many tracks the grid has. */
const tracks = (host: HTMLElement) => getComputedStyle(list(host)).gridTemplateColumns.split(' ').length

/** The word of value `i`. */
function value(host: HTMLElement, view: View, i: number): HTMLElement {
  const row = rows(host).find((r) => r.querySelector('dt')?.textContent === nameOf(view, i))
  if (row === undefined) throw new Error(`no row reads ${nameOf(view, i)}`)
  return row.querySelector('dd') as HTMLElement
}

/** How wide `dd`'s row is with its word whole: its padding, its name, the gap and the whole word. */
function rowNeeds(dd: HTMLElement): number {
  const row = dd.parentElement as HTMLElement
  return row.getBoundingClientRect().width - dd.getBoundingClientRect().width + dd.scrollWidth
}

/** Where each row is, by its name, to the pixel. */
const places = (host: HTMLElement) =>
  Object.fromEntries(
    rows(host).map((r) => {
      const b = r.getBoundingClientRect()
      return [r.querySelector('dt')?.textContent ?? '', `${Math.round(b.left)},${Math.round(b.top)}`]
    }),
  )

/** What `read` answers with the grid's room taken away, its least track alone. */
function withoutRoom<T>(host: HTMLElement, read: () => T): T {
  const kept = body(host).style.getPropertyValue('--values-room')
  body(host).style.removeProperty('--values-room')
  try {
    return read()
  } finally {
    body(host).style.setProperty('--values-room', kept)
  }
}

/**
 * The first width from `from` px up, a step of `by`, at which the room `ONE_NINE` keeps draws fewer tracks than
 * `SHORT`'s, both drawn afresh: where value 0 moves the cells. Each width draws `SHORT` and then `ONE_NINE` again,
 * after a new program, as the cases do.
 */
async function widthWhereRoomMoves(view: View, from: number, by: number): Promise<number> {
  const { host, pane, draw } = mount(view, from)
  try {
    for (let w = from; w < view.wide + 300; w += by) {
      await resize(host, w)
      forget(view, pane)
      draw(SHORT)
      const before = tracks(host)
      draw(ONE_NINE)
      if (tracks(host) < before) return w
    }
    throw new Error('precondition: no width at which value 0 moves the cells')
  } finally {
    host.remove()
  }
}

/** Tell the view of its program again, as a recompile does, which forgets the room. */
function forget(view: View, pane: RxmPane | ClifPane): void {
  if (view.kind === 'rxm') (pane as RxmPane).setProgram(FACT3)
  else (pane as ClifPane).setProgram({ listing: factClif(), level: 'as-built' })
}

describe.each(VIEWS)('the room of the $kind view’s values', (view) => {
  it('draws a value whole wherever the panel fits its row, and cuts it only where the panel is narrower', async () => {
    const { host, draw } = mount(view, 100)
    draw(ONE_NINE)
    await frames()
    const cutBefore: number[] = []
    const narrower: number[] = []
    for (let w = 100; w <= view.wide + 300; w += 10) {
      await resize(host, w)
      const dd = value(host, view, 0)
      expect(dd.firstChild?.textContent, 'precondition: value 0 reads the nine digits').toBe(NINE)
      const needs = rowNeeds(dd)
      const room = list(host).clientWidth
      if (room >= needs + 1) expect(whole(dd), `at ${w} px, value 0, its row ${needs} px in ${room}`).toBe(true)
      else if (room < needs - 1) {
        narrower.push(w)
        expect(whole(dd), `at ${w} px, value 0, its row ${needs} px in ${room}`).toBe(false)
      }
      expect(body(host).scrollWidth, `at ${w} px, the panel scrolls sideways`).toBeLessThanOrEqual(
        body(host).clientWidth,
      )
      if (room >= needs + 1 && !withoutRoom(host, () => whole(dd))) cutBefore.push(w)
    }
    expect(
      cutBefore.length,
      'precondition: widths at which the least track alone would cut a row with room for it',
    ).toBeGreaterThan(0)
    expect(narrower.length, 'precondition: widths at which the panel is narrower than the row').toBeGreaterThan(0)
  })
})

describe("the room of the rxm view's registers", () => {
  const view = VIEWS[0]

  it('moves no cell at a step back to shorter values, at an empty frame, or at the longer value again', async () => {
    const width = await widthWhereRoomMoves(view, 200, 10)
    const { host, pane, draw } = mount(view, width)
    draw(SHORT)
    await frames()
    const before = tracks(host)
    draw(ONE_NINE)
    await frames()
    const grown = tracks(host)
    expect(grown, `precondition: at ${width} px value 0 widens the tracks`).toBeLessThan(before)
    const at = places(host)
    draw(SHORT)
    await frames()
    expect(tracks(host), 'the tracks, a step back').toBe(grown)
    expect(places(host), 'the cells, a step back').toEqual(at)
    pane.render(null, controlState(true, 'step 0 of 55'))
    await frames()
    draw(SHORT)
    await frames()
    expect(places(host), 'the cells, after a frame of none').toEqual(at)
    draw(ONE_NINE)
    await frames()
    expect(places(host), 'the cells, the longer value again').toEqual(at)
  })

  it('leaves the result’s row out of the room, as it spans every track', async () => {
    const width = await widthWhereRoomMoves(view, 200, 10)
    const { host, draw } = mount(view, width)
    draw(SHORT)
    await frames()
    const before = tracks(host)
    draw({ ...SHORT, result: NINE })
    await frames()
    expect(tracks(host), 'the tracks, the result drawn').toBe(before)
  })

  it('forgets the room when the view is told of its program again', async () => {
    const width = await widthWhereRoomMoves(view, 200, 10)
    const { host, pane, draw } = mount(view, width)
    draw(SHORT)
    await frames()
    const before = tracks(host)
    draw(ONE_NINE)
    await frames()
    expect(tracks(host), 'precondition: value 0 widens the tracks').toBeLessThan(before)
    forget(view, pane)
    draw(SHORT)
    await frames()
    expect(tracks(host), 'the tracks, a new program drawn').toBe(before)
  })
})

describe("the room of the clif view's values", () => {
  const view = VIEWS[1]

  it("keeps a 20-digit word's room from the first step, and no cell moves for one or at a new listing", async () => {
    const roomMoves: number[] = []
    for (let w = 100; w <= view.wide + 300; w += 20) {
      // A VIEW OF ITS OWN AT EACH WIDTH, so its first frame of values is the run's first step.
      const { host, pane, draw } = mount(view, w)
      await frames()
      draw(SHORT)
      const at = places(host)
      if (withoutRoom(host, () => tracks(host)) > tracks(host)) roomMoves.push(w)
      for (const [when, c] of [
        ['nine digits', ONE_NINE],
        ['20 digits', ONE_LONG],
        ['a step back', SHORT],
      ] as const) {
        draw(c)
        expect(places(host), `at ${w} px, the cells, ${when}`).toEqual(at)
      }
      forget(view, pane)
      draw(SHORT)
      expect(places(host), `at ${w} px, the cells, a new listing`).toEqual(at)
      host.remove()
    }
    expect(roomMoves.length, 'precondition: widths at which the least track alone draws more tracks').toBeGreaterThan(0)
  })

  it("holds a 20-digit word and a register after it whole in the row's least wide width", async () => {
    const { host, draw } = mount(view, view.wide)
    draw({ ...ONE_LONG, regs: ['rr'] })
    await frames()
    expect(arrangement(host), 'precondition: the row is wide').toBe('wide')
    const dd = value(host, view, 0)
    expect(dd.textContent, 'precondition: the word and the register').toBe(`${LONG} rr`)
    expect(whole(dd), 'the word and the register').toBe(true)
  })
})

/**
 * The boxes of `el`'s text, each text node's alone: a Range over an element would give its child elements' boxes too,
 * and an inline block's, a clif frame's pc, stands on its line from another top than the text's.
 */
function textBoxes(el: HTMLElement): DOMRect[] {
  const boxes: DOMRect[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const range = document.createRange()
    range.selectNodeContents(node)
    boxes.push(...range.getClientRects())
  }
  return boxes
}

/** The left edge of each line `el`'s text is drawn on, top first. */
function lineStarts(el: HTMLElement): number[] {
  const starts = new Map<number, number>()
  for (const r of textBoxes(el)) {
    if (r.width === 0) continue
    const top = Math.round(r.top)
    starts.set(top, Math.min(starts.get(top) ?? r.left, r.left))
  }
  return [...starts.entries()].sort(([a], [b]) => a - b).map(([, left]) => left)
}

/** How many px `n` ch is in `el`'s font. */
function chIn(el: HTMLElement, n: number): number {
  const probe = document.createElement('span')
  probe.style.cssText = `display: inline-block; width: ${n}ch`
  el.append(probe)
  const width = probe.getBoundingClientRect().width
  probe.remove()
  return width
}

/** The first heap line, and its text. */
const heapLine = (host: HTMLElement) => host.querySelector('.rxm-cell-line') as HTMLElement
const heapText = (host: HTMLElement) => heapLine(host).querySelector('.rxm-line') as HTMLElement

/** A frame with one heap cell, which the first `refs` values or locals hold and its line names. */
const named = (refs: number): Counts => ({
  depth: 1,
  cells: 1,
  boxes: 0,
  rows: { stack: 0, values: 4 },
  lines: 1,
  refs,
})

/**
 * The first width from `from` px up, a step of `by`, at which the heap line four values name is taller than the one
 * none does, each drawn afresh after a new program.
 */
async function widthWhereNamesWrap(view: View, from: number, by: number): Promise<number> {
  const { host, pane, draw } = mount(view, from)
  try {
    for (let w = from; w < view.wide + 300; w += by) {
      await resize(host, w)
      forget(view, pane)
      draw(named(4))
      const four = heapLine(host).getBoundingClientRect().height
      forget(view, pane)
      draw(named(0))
      if (four > heapLine(host).getBoundingClientRect().height + 1) return w
    }
    throw new Error('precondition: no width at which the names take the heap line onto another line')
  } finally {
    host.remove()
  }
}

describe.each(VIEWS)('the lines of the $kind view’s call stack and heap', (view) => {
  it('go on below where the panel is too narrow, indented, with nothing cut', async () => {
    const { host, draw } = mount(view, LINES)
    draw({ depth: 2, cells: 1, boxes: 0, rows: { stack: 2, values: 0 }, lines: 1, words: () => LONG, saved: LONG })
    await frames()
    const frame = host.querySelector('.rxm-frame') as HTMLElement
    for (const [name, box, text] of [
      ['the frame', frame, frame],
      ['the heap line', heapLine(host), heapText(host)],
    ] as const) {
      const starts = lineStarts(text)
      expect(starts.length, `precondition: ${name} over more than one line`).toBeGreaterThan(1)
      expect(whole(box), `${name}, cut`).toBe(true)
      expect(box.scrollWidth, `${name}, past its box`).toBeLessThanOrEqual(box.clientWidth)
      const indent = chIn(text, 2)
      for (const [i, left] of starts.slice(1).entries())
        expect(left - (starts[0] ?? 0), `${name}'s line ${i + 2}, in from its first`).toBeCloseTo(indent, 0)
    }
    if (view.kind === 'rxm') expect(frame.textContent?.endsWith(LONG), 'the frame ends with its saved word').toBe(true)
    expect(heapText(host).textContent, 'the heap line holds its head').toContain(LONG)
  })

  it('keep a heap line as tall as its longest text, when fewer values name its cell, until a new program', async () => {
    const width = await widthWhereNamesWrap(view, 120, 10)
    const { host, pane, draw } = mount(view, width)
    draw(named(0))
    await frames()
    const one = heapLine(host).getBoundingClientRect().height
    draw(named(4))
    await frames()
    const more = heapLine(host).getBoundingClientRect().height
    expect(more, `precondition: at ${width} px the names take the line onto another`).toBeGreaterThan(one + 1)
    draw(named(0))
    await frames()
    expect(heapText(host).textContent?.includes('←'), 'precondition: no value names the cell').toBe(false)
    expect(heapLine(host).getBoundingClientRect().height, 'the line, fewer names').toBeCloseTo(more, 0)
    expect(whole(heapLine(host)), 'the line, whole').toBe(true)
    forget(view, pane)
    draw(named(0))
    await frames()
    expect(heapLine(host).getBoundingClientRect().height, 'the line, a new program').toBeCloseTo(one, 0)
  })
})

/**
 * Two instructions of one function of `fact.rxt`'s listing whose pc labels differ in length, the shorter first, each
 * with its label.
 */
function twoLabels(): readonly [ClifAt, string, ClifAt, string] {
  const l = factClif()
  for (const [k, f] of l.functions.entries()) {
    const end = l.functions[k + 1]?.first_row ?? l.rows.length
    const insts = l.rows
      .slice(f.first_row, end)
      .flatMap((r) => (r.kind === 'Inst' && r.at !== null ? [{ at: r.at, label: pcColumn(r.pc) }] : []))
      .sort((a, b) => a.label.length - b.label.length)
    const [first, last] = [insts[0], insts[insts.length - 1]]
    if (first !== undefined && last !== undefined && first.label.length < last.label.length)
      return [first.at, first.label, last.at, last.label]
  }
  throw new Error('precondition: no function whose pc labels differ in length')
}

describe("the clif view's call stack", () => {
  it('moves no line at a step that moves its frames to a pc label of another width', async () => {
    const [short, shortLabel, long, longLabel] = twoLabels()
    const view = VIEWS[1]
    const { host, draw } = mount(view, LINES)
    const stackFrames = () => [...host.querySelectorAll<HTMLElement>('.rxm-frame')]
    const pc = () => stackFrames()[0]?.querySelector('.rxm-ret') as HTMLElement
    /** Each frame's top and height, to the pixel. */
    const boxes = () =>
      stackFrames().map((f) => {
        const b = f.getBoundingClientRect()
        return `${Math.round(b.top)}+${Math.round(b.height)}`
      })
    const at = (where: ClifAt): Counts => ({ depth: 2, cells: 0, boxes: 0, rows: { stack: 2, values: 0 }, at: where })
    let wrapped = false
    for (const w of [...Array.from({ length: 86 }, (_, i) => 60 + 4 * i), view.medium + 20, view.wide + 40]) {
      await resize(host, w)
      draw(at(short))
      expect(pc().textContent, 'precondition: the shorter label').toBe(shortLabel)
      const was = boxes()
      if (lineStarts(stackFrames()[0] as HTMLElement).length > 1) wrapped = true
      draw(at(long))
      expect(pc().textContent, 'precondition: the longer label').toBe(longLabel)
      expect(boxes(), `at ${w} px, each frame's top and height`).toEqual(was)
    }
    expect(wrapped, 'precondition: some width at which the frame goes on below').toBe(true)
  })
})
