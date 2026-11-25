import { beforeAll, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { ClifPane } from '../../src/clif-pane'
import { CUT_TEXT, watchCutText } from '../../src/cut-text'
import { ROW_HEIGHT } from '../../src/state-table'
import { TmPane } from '../../src/tm-pane'
import type { TmProgram } from '../../src/types'
import { OVERSCAN } from '../../src/virtual-grid'
import { frames, hearLoops, inertEvents, menuOf, moreOf, pick } from './harness'
import {
  type Counts,
  factClif,
  loadViews,
  maximise,
  mount,
  resize,
  title,
  VIEWS,
  type View,
  whole,
} from './machine-views'

/**
 * A CUT TEXT READS WHOLE IN THE BROWSER'S TOOLTIP WHILE THE POINTER RESTS ON IT, AND ONLY WHILE IT IS CUT (the cut-text
 * tooltips design, `cut-text.ts`): a value, a panel's name, a frame, a heap line and a listing row in an rxm view and a
 * clif view built by hand, and an accept state in a TM view's rule table. A tooltip cannot be seen from here, so each
 * case reads the `title` a real hover leaves, and first holds the text cut or whole, so that no case passes because a
 * text happened to fit. A view built by hand has no app to add the watcher, so this file adds it.
 */

loadViews()

beforeAll(() => watchCutText(document))

hearLoops(() => {
  document.body.innerHTML = ''
})

/** The largest word, 20 digits: long enough that the views these cases draw cut it, which each case checks first. */
const LONG = '18446744073709551615'
/** Another word as long, for a step that changes a cut value. */
const OTHER = '12345678901234567890'

/** The name of value `i`'s row: a local's in rxm, a value's in clif. */
const nameOf = (view: View, i: number) => (view.kind === 'rxm' ? `r${i}` : `v${i}`)

/** The row of value `i`. */
function register(host: HTMLElement, view: View, i: number): HTMLElement {
  const row = [...host.querySelectorAll<HTMLElement>('.rxm-register')].find(
    (r) => r.querySelector('dt')?.textContent === nameOf(view, i),
  )
  if (row === undefined) throw new Error(`no row reads ${nameOf(view, i)}`)
  return row
}

/** The word of value `i`, and its name. */
const value = (host: HTMLElement, view: View, i: number) => register(host, view, i).querySelector('dd') as HTMLElement
const valueName = (host: HTMLElement, view: View, i: number) =>
  register(host, view, i).querySelector('dt') as HTMLElement

/** A text with its spaces taken out, so that a title, which reads a row's columns apart, compares with its text. */
const bare = (s: string | null) => (s ?? '').replaceAll(' ', '')

/** The watched texts under `root` that carry a `title`. */
const titled = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(CUT_TEXT)].filter((e) => e.hasAttribute('title'))

/**
 * How far `el`'s text runs past the end of its content box, where the ellipsis is drawn, to a fraction of a pixel: a
 * Range over its text against its box less its border and padding.
 */
function pastEnd(el: HTMLElement): number {
  const range = document.createRange()
  range.selectNodeContents(el)
  const style = getComputedStyle(el)
  const end =
    el.getBoundingClientRect().right - Number.parseFloat(style.borderRightWidth) - Number.parseFloat(style.paddingRight)
  return range.getBoundingClientRect().right - end
}

/**
 * Make `host` as wide as puts `el`'s text `by` px past its box: by halving the widths between the one `host` has and
 * `wider`, where `el` runs past less.
 */
function widthFor(host: HTMLElement, el: HTMLElement, by: number, wider: number): void {
  let [narrow, wide] = [host.getBoundingClientRect().width, wider]
  for (let i = 0; i < 30; i += 1) {
    const mid = (narrow + wide) / 2
    host.style.width = `${mid}px`
    if (pastEnd(el) > by) narrow = mid
    else wide = mid
  }
}

/**
 * Make `host` as wide as cuts `el`'s text by less than a pixel while its scroll width, a whole pixel, reads it whole:
 * from the width that cuts it by half a pixel, a step at a time.
 */
async function cutUnderAPixel(host: HTMLElement, el: HTMLElement, wider: number): Promise<void> {
  widthFor(host, el, 0.5, wider)
  const from = host.getBoundingClientRect().width
  for (let w = from - 0.5; w < from + 0.5; w += 0.02) {
    host.style.width = `${w}px`
    const past = pastEnd(el)
    if (past > 0.05 && past < 0.95 && el.scrollWidth === el.clientWidth) break
  }
  await frames()
}

/**
 * Spies on an element's scroll, client and offset widths and on an element's or a Range's rects, the watcher's readers
 * among them, and answers which watched texts, or texts inside one, they have measured since the last `clear`.
 */
function measures() {
  const spies = [
    vi.spyOn(Element.prototype, 'scrollWidth', 'get'),
    vi.spyOn(Element.prototype, 'clientWidth', 'get'),
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get'),
    vi.spyOn(Element.prototype, 'getBoundingClientRect'),
    vi.spyOn(Element.prototype, 'getClientRects'),
    vi.spyOn(Range.prototype, 'getBoundingClientRect'),
    vi.spyOn(Range.prototype, 'getClientRects'),
  ]
  const measured = (c: unknown) => (c instanceof Range ? c.startContainer : c)
  return {
    watched: () =>
      spies
        .flatMap((s) => (s.mock.contexts as unknown[]).map(measured))
        .filter((e) => e instanceof Element && e.closest(CUT_TEXT) !== null),
    clear: () => {
      for (const s of spies) s.mockClear()
    },
    restore: () => {
      for (const s of spies) s.mockRestore()
    },
  }
}

/** A real hover `x` px in from `el`'s left, at its middle height: a new `position`, as the call scales it in place. */
async function hover(el: Element, x: number): Promise<void> {
  await userEvent.hover(el, { position: { x, y: el.getBoundingClientRect().height / 2 } })
}

/**
 * How wide a view the frame case uses: narrow enough to cut a clif frame, which reads its function's name and label and
 * holds no word a case can make long.
 */
const FRAME_CUT = 90

/** A frame whose value 0 is `LONG`, cut, and whose value 1 is `1`, whole, each clif value naming two registers. */
const ONE_LONG: Counts = {
  depth: 1,
  cells: 1,
  boxes: 0,
  rows: { stack: 0, values: 4 },
  words: (i) => (i === 0 ? LONG : String(i)),
  regs: ['rr', 'a0'],
}

describe.each(VIEWS)('in the $kind view', (view) => {
  /** Value 0's whole text: its word, and in clif the registers it names. */
  const longText = view.kind === 'rxm' ? '18446744073709551615' : '18446744073709551615 rr, a0'

  it('gives a cut value its whole text as its tooltip when the pointer arrives on it', async () => {
    const { host, draw } = mount(view, view.wide + 300)
    draw(ONE_LONG)
    await frames()
    const v = value(host, view, 0)
    expect(whole(v), 'precondition: value 0 is cut').toBe(false)
    expect(v.hasAttribute('title'), 'precondition: value 0 has no title before the pointer arrives').toBe(false)
    await hover(v, 4)
    expect(v.title, 'value 0').toBe(longText)
    expect(titled(document.body), 'the texts with a title').toEqual([v])
  })

  it('gives a value that fits no tooltip', async () => {
    const { host, draw } = mount(view, view.wide + 300)
    draw(ONE_LONG)
    await frames()
    const v = value(host, view, 1)
    expect(whole(v), 'precondition: value 1 is whole').toBe(true)
    await hover(v, 2)
    expect(v.hasAttribute('title'), 'value 1 has a title').toBe(false)
    expect(titled(document.body), 'the texts with a title').toEqual([])
  })

  it('keeps one tooltip, the one under the pointer', async () => {
    const { host, draw } = mount(view, view.wide + 300)
    draw({ ...ONE_LONG, words: (i) => (i < 2 ? LONG : String(i)) })
    await frames()
    const [first, second] = [value(host, view, 0), value(host, view, 1)]
    for (const v of [first, second]) expect(whole(v), 'precondition: values 0 and 1 are cut').toBe(false)
    await hover(first, 4)
    await hover(second, 4)
    expect(first.hasAttribute('title'), 'value 0 keeps a title once the pointer has moved to value 1').toBe(false)
    expect(second.title, 'value 1').toBe(second.textContent)
    await hover(valueName(host, view, 1), 2)
    expect(titled(document.body), 'the texts with a title, the pointer on a name').toEqual([])
  })

  it('shows no value from a step before when a step changes the value under a still pointer', async () => {
    const { host, draw } = mount(view, view.wide + 300)
    draw(ONE_LONG)
    await frames()
    await hover(value(host, view, 0), 4)
    expect(value(host, view, 0).title, 'value 0, the pointer on it').toBe(longText)
    draw({ ...ONE_LONG, words: (i) => (i === 0 ? OTHER : String(i)) })
    // READ BEFORE THE NEXT FRAME, where an engine may report an arrival on the text under the pointer and so title it
    // afresh: what is held here is that a changed text is in a new element, which carries no title.
    for (const t of titled(host)) {
      expect(t.title, 'before the next frame, a title holds the value from the step before').not.toContain(LONG)
    }
    await frames()
    const v = value(host, view, 0)
    expect(v.textContent?.startsWith(OTHER), 'precondition: the step changed value 0').toBe(true)
    expect(whole(v), 'precondition: value 0 is cut').toBe(false)
    for (const t of titled(host)) {
      expect(t.title, 'a title holds the value from the step before').not.toContain(LONG)
      expect(t.title, 'a title is not its own text').toBe(t.textContent)
    }
    await hover(v, 6)
    expect(v.title, 'value 0, the pointer moved on it').toBe(longText.replace(LONG, OTHER))
  })

  it('decides at each arrival, so a title a wider view makes whole has no tooltip and a narrower one has one again', async () => {
    const { host, draw } = mount(view, 110)
    draw({ depth: 1234, cells: 1234, boxes: 12 })
    await frames()
    const t = title(host, 'stack')
    expect(whole(t), "precondition: the call stack's title is cut at 110 px").toBe(false)
    await hover(t, 2)
    expect(t.title, 'at 110 px').toBe('call stack')
    await userEvent.hover(maximise(host, 'stack'))
    await resize(host, 200)
    expect(whole(t), "precondition: the call stack's title is whole at 200 px").toBe(true)
    await hover(t, 2)
    expect(t.hasAttribute('title'), 'at 200 px, the title has a tooltip').toBe(false)
    await userEvent.hover(maximise(host, 'stack'))
    await resize(host, 110)
    expect(whole(t), "precondition: the call stack's title is cut at 110 px again").toBe(false)
    await hover(t, 2)
    expect(t.title, 'at 110 px again').toBe('call stack')
  })

  it('gives a text cut by less than a pixel its tooltip, where its scroll width reads it whole', async () => {
    const { host, draw } = mount(view, 110)
    draw({ depth: 1234, cells: 1234, boxes: 12 })
    await frames()
    const t = title(host, 'stack')
    await cutUnderAPixel(host, t, 200)
    expect(pastEnd(t), "precondition: the call stack's title runs past its box").toBeGreaterThan(0)
    expect(pastEnd(t), 'precondition: by less than a pixel').toBeLessThan(1)
    expect(t.scrollWidth, 'precondition: its scroll width reads it whole').toBe(t.clientWidth)
    await hover(t, 2)
    expect(t.title, 'the title cut by less than a pixel').toBe('call stack')
  })

  it('gives a cut frame and a cut heap line their whole line, from any part of it', async () => {
    const { host, draw } = mount(view, FRAME_CUT)
    draw({
      depth: 2,
      cells: 1,
      boxes: 0,
      rows: { stack: 2, values: 0 },
      lines: 1,
      words: () => LONG,
      saved: LONG,
    })
    await frames()
    const frame = host.querySelector('.rxm-frame') as HTMLElement
    const line = host.querySelector('.rxm-cell-line') as HTMLElement
    expect(whole(frame), 'precondition: the frame is cut').toBe(false)
    expect(whole(line), 'precondition: the heap line is cut').toBe(false)
    const callee = frame.querySelector('.rxm-callee') as HTMLElement
    await hover(callee, 2)
    expect(frame.title, 'the frame, the pointer on its callee').toBe(frame.textContent)
    expect(frame.title.length, "the frame's title is longer than its callee").toBeGreaterThan(
      callee.textContent?.length ?? 0,
    )
    if (view.kind === 'rxm') expect(frame.title.endsWith(LONG), 'the frame ends with its saved word').toBe(true)
    await hover(line.querySelector('b') as HTMLElement, 2)
    expect(line.title, 'the heap line, the pointer on its address').toBe(line.textContent)
    expect(line.title, 'the heap line holds its head').toContain(LONG)
  })

  it('gives a cut listing row its text, and no row an old one when the listing scrolls under a still pointer', async () => {
    const { host, draw } = mount(view, 110)
    draw({ depth: 1, cells: 1, boxes: 0 })
    await frames()
    const listing = host.querySelector(`.${view.kind}-listing`) as HTMLElement
    expect(
      listing.scrollHeight - listing.clientHeight,
      'precondition: the listing scrolls by OVERSCAN + 5 rows',
    ).toBeGreaterThanOrEqual((OVERSCAN + 5) * ROW_HEIGHT)
    listing.scrollTop = (OVERSCAN + 2) * ROW_HEIGHT
    await frames()
    const box = listing.getBoundingClientRect()
    const middle = box.top + listing.clientHeight / 2
    const c = [...listing.querySelectorAll<HTMLElement>(`.${view.kind}-cell`)].find((e) => {
      const r = e.getBoundingClientRect()
      return r.top <= middle && r.bottom > middle
    }) as HTMLElement
    expect(c, 'precondition: a row is drawn at the middle of the listing').toBeDefined()
    expect(whole(c), 'precondition: the row at the middle is cut').toBe(false)
    const cBox = c.getBoundingClientRect()
    const p = { x: cBox.left + 4, y: cBox.top + cBox.height / 2 }
    const was = c.textContent ?? ''
    await hover(c, 4)
    expect(bare(c.title), 'the row under the pointer').toBe(bare(was))
    const wasTitle = c.title
    listing.scrollTop += 3 * ROW_HEIGHT
    const scrolled = listing.scrollTop
    // DRAWN AT ONCE AND READ BEFORE THE NEXT FRAME, for the reason the step case gives.
    draw({ depth: 1, cells: 1, boxes: 0 })
    expect(listing.scrollTop, 'precondition: the draw kept the scroll').toBe(scrolled)
    const under = document.elementFromPoint(p.x, p.y)?.closest(CUT_TEXT) ?? null
    expect(under, 'precondition: a watched text is at the point at once').not.toBeNull()
    expect(under?.textContent, 'precondition: the draw put another row under the pointer at once').not.toBe(was)
    for (const t of titled(host)) {
      expect(t.title, 'before the next frame, a title holds the text of the row the scroll moved on').not.toBe(wasTitle)
    }
    await frames()
    const now = document.elementFromPoint(p.x, p.y)?.closest<HTMLElement>(CUT_TEXT) ?? null
    expect(now, 'precondition: a watched text is at the point').not.toBeNull()
    const at = now as HTMLElement
    expect(at.textContent, 'precondition: the scroll put another row under the pointer').not.toBe(was)
    expect(whole(at), 'precondition: the row now under the pointer is cut').toBe(false)
    for (const t of titled(host)) {
      expect(t.title, 'a title holds the text of the row the scroll moved on').not.toBe(wasTitle)
      expect(bare(t.title), 'a title is not its own text').toBe(bare(t.textContent))
    }
    await hover(at, 6)
    expect(bare(at.title), 'the row under the pointer, the pointer moved on it').toBe(bare(at.textContent))
  })

  it('reads a cut listing row with its pc column apart from the text after it, as the row is drawn', async () => {
    const { host, pane } = mount(view, 300)
    // A CLIF INSTRUCTION MEETS ITS PC COLUMN WITH NO SPACE ONLY WHERE CRANELIFT PRINTS IT AT ITS BARE INDENT, AND IN
    // THE EXACT LAYOUT, which the view's menu chooses: this listing is fact.rxt's with every instruction put there.
    let first = 0
    if (view.kind === 'clif') {
      const l = factClif()
      const rows = l.rows.map((r) => (r.kind === 'Inst' ? { ...r, indent: 4 } : r))
      ;(pane as ClifPane).setProgram({ listing: { ...l, rows }, level: 'as-built' })
      await pick(host, 'clif-compact')
      if (menuOf(moreOf(host)).matches(':popover-open')) await userEvent.keyboard('{Escape}')
      first = rows.findIndex((r) => r.kind === 'Inst' && r.pc !== null)
    }
    await resize(host, 110)
    const listing = host.querySelector(`.${view.kind}-listing`) as HTMLElement
    listing.scrollTop = first * ROW_HEIGHT
    await frames()
    const shown = listing.getBoundingClientRect()
    /** The text after a row's pc column. */
    const pastPc = (c: HTMLElement) => (c.textContent ?? '').slice(c.querySelector('.rxm-pc')?.textContent?.length ?? 0)
    const row = [...listing.querySelectorAll<HTMLElement>(`.${view.kind}-cell`)].find((c) => {
      const box = c.getBoundingClientRect()
      return (
        c.querySelector('.rxm-pc') !== null &&
        /^\S/.test(pastPc(c)) &&
        box.top >= shown.top &&
        box.bottom <= shown.bottom
      )
    })
    if (row === undefined) throw new Error('precondition: a row in view whose pc column meets its text with no space')
    expect(whole(row), 'precondition: the row is cut').toBe(false)
    const pc = row.querySelector('.rxm-pc')?.textContent ?? ''
    await hover(row, 4)
    expect(row.title, 'the row, its pc column and its text a space apart').toBe(`${pc} ${pastPc(row)}`)
  })

  it('measures nothing while the run steps', async () => {
    const { host, draw } = mount(view, view.wide + 300)
    draw(ONE_LONG)
    await frames()
    expect(whole(value(host, view, 0)), 'precondition: value 0 is cut').toBe(false)
    await hover(valueName(host, view, 1), 2)
    const read = measures()
    try {
      for (let step = 0; step < 10; step += 1) {
        draw({ ...ONE_LONG, words: (i) => (i === 0 ? (step % 2 === 0 ? OTHER : LONG) : String(i)) })
        await frames()
      }
      expect(read.watched(), 'the watched texts measured while the run stepped').toEqual([])
      const v = value(host, view, 0)
      const position = { x: 4, y: v.getBoundingClientRect().height / 2 }
      read.clear()
      await userEvent.hover(v, { position })
      expect(
        read.watched().length,
        'the instrument: the texts measured when the pointer arrived on value 0',
      ).toBeGreaterThan(0)
    } finally {
      read.restore()
    }
  })
})

/** A machine of one state, an accept state, whose row reads its name and then ` · accept`. */
const ACCEPTS: TmProgram = {
  states: [{ name: 'accepts_at_once', accept: true, rules: [], instr: null }],
  alphabet: ['_'],
  tapes: 1,
  width: 4,
  start: 0,
  listing: [],
  labels: [],
}

describe('in the TM rule table', () => {
  it("gives an accept state its name where the ellipsis its ` · accept` runs past draws over the name's end", async () => {
    const host = document.createElement('section')
    host.className = 'pane'
    host.style.height = '600px'
    host.style.width = '120px'
    document.body.append(host)
    new TmPane(host, inertEvents()).setProgram(ACCEPTS, ['t'])
    await frames()
    // THE TABLE DRAWS ITS ROWS ANEW WHEN IT IS RESIZED, so the cell is found again after each frame.
    const cell = () => host.querySelector('.state-row.is-accept > .state-cell') as HTMLElement
    const name = ACCEPTS.states[0]?.name ?? ''
    expect(cell().textContent, 'precondition: the row reads the state').toBe(name)
    const range = document.createRange()
    range.selectNodeContents(cell())
    const character = range.getBoundingClientRect().width / name.length
    widthFor(host, cell(), -character / 4, 600)
    await frames()
    const c = cell()
    expect(pastEnd(c), 'precondition: the name ends inside its box').toBeLessThanOrEqual(0)
    expect(pastEnd(c), "precondition: within half a character of the box's end").toBeGreaterThan(-character / 2)
    expect(c.scrollWidth, 'precondition: its ` · accept` runs past its box').toBeGreaterThan(c.clientWidth)
    await hover(c, 2)
    expect(c.title, 'the accept state').toBe(name)
  })
})
