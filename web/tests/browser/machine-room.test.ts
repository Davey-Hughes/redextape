import { describe, expect, it } from 'vitest'
import type { ClifPane } from '../../src/clif-pane'
import type { RxmPane } from '../../src/rxm-pane'
import { FACT3 } from '../node/rxm-fixtures'
import { controlState, frames, hearLoops } from './harness'
import { type Counts, factClif, loadViews, mount, resize, VIEWS, type View, whole } from './machine-views'

/**
 * THE ROOM THE MACHINE PANELS KEEP (the squeezed values design), in an rxm view and a clif view built by hand. Each
 * track of the values grid is at least as wide as the widest row the run has drawn since the view was told of its
 * program, so a value reads whole wherever the panel is as wide as its row, and is cut, with the tooltip `cut-text.ts`
 * gives it, only where the panel is narrower. A frame or a heap line too long for its panel goes on below, indented,
 * and a heap line keeps the lines its longest text took. The room only grows: a step back to shorter texts or a frame
 * of none moves nothing, and only a new program or listing forgets it. `result-app.test.ts` holds fact(12)'s `rr` in
 * the app.
 */

loadViews()

hearLoops(() => {
  document.body.innerHTML = ''
})

/** fact(12)'s result, nine digits: a row of it with a short name needs every character of the grid's least track. */
const NINE = '479001600'
/** The largest word, 20 digits. */
const LONG = '18446744073709551615'
/** How wide a view the line cases use: narrow enough that a frame or a heap line that holds `LONG` takes three lines. */
const LINES = 90

/** A frame of twelve values or locals, each a short word. */
const SHORT: Counts = { depth: 1, cells: 1, boxes: 0, rows: { stack: 0, values: 12 } }
/** The same frame with `NINE` in value 0. */
const ONE_NINE: Counts = { ...SHORT, words: (i) => (i === 0 ? NINE : String(i)) }

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

/** Whether `dd` is whole with the grid's room taken away, as the grid drew it before the room: its least track alone. */
function wholeWithoutRoom(host: HTMLElement, dd: HTMLElement): boolean {
  const kept = body(host).style.getPropertyValue('--values-room')
  body(host).style.removeProperty('--values-room')
  try {
    return whole(dd)
  } finally {
    body(host).style.setProperty('--values-room', kept)
  }
}

/**
 * The first width from `from` px up, a step of `by`, at which the room `ONE_NINE` keeps draws fewer tracks than
 * `SHORT`'s, both drawn afresh: where value 0 moves the cells. Each width draws `SHORT` and then `ONE_NINE` again, after
 * a new program, as the cases do.
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
  it('draws a value whole wherever the panel is as wide as its row, and cuts it only where the panel is narrower', async () => {
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
      if (room >= needs + 1 && !wholeWithoutRoom(host, dd)) cutBefore.push(w)
    }
    expect(
      cutBefore.length,
      'precondition: widths at which the least track alone cut a row with room for it',
    ).toBeGreaterThan(0)
    expect(narrower.length, 'precondition: widths at which the panel is narrower than the row').toBeGreaterThan(0)
  })

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

/** A Range over `el`'s text. */
function textOf(el: HTMLElement): Range {
  const range = document.createRange()
  range.selectNodeContents(el)
  return range
}

/** The left edge of each line `el`'s text is drawn on, top first. */
function lineStarts(el: HTMLElement): number[] {
  const starts = new Map<number, number>()
  for (const r of textOf(el).getClientRects()) {
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
    expect(whole(heapText(host)), 'its text').toBe(true)
    forget(view, pane)
    draw(named(0))
    await frames()
    expect(heapLine(host).getBoundingClientRect().height, 'the line, a new program').toBeCloseTo(one, 0)
  })
})
