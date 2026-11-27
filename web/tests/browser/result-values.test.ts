import { afterEach, describe, expect, it } from 'vitest'
import { frames, hearLoops, token } from './harness'
import { type Counts, loadViews, mount, resize, VIEWS, whole } from './machine-views'

/**
 * THE RESULT'S ROW IN THE RXM AND CLIF VIEWS' VALUES PANEL (the return-value highlight design, goals 1-3): at the run's
 * end the row of the returned value comes first, spans the whole row of the grid, carries the tint, the edge and the
 * word `result`, and wraps only when even the whole row is too narrow. Views built by hand, so a case names the frame
 * and the width it draws at; `result-app.test.ts` holds the views the app builds.
 */

loadViews()

afterEach(() => document.documentElement.removeAttribute('data-theme'))

hearLoops(() => {
  document.body.innerHTML = ''
})

/** The largest word, 20 digits: wider than a values row at the narrowest width V4 draws. */
const LONG = '18446744073709551615'

/** A frame with six values or locals and one call frame, as the step before the end draws it. */
const BEFORE: Counts = { depth: 1, cells: 1, boxes: 0, rows: { stack: 1, values: 6 } }

/**
 * The host widths V1, V3 and V4 draw at. At `ROOM`, each view's, the values run in more than one column and the row
 * has room for `LONG result` on one line. `FITS` and `UNDER` are below either view's medium width, where the values
 * panel is the view's whole width: at `FITS` `LONG` fits the row and `LONG result` does not, and at `UNDER` the row is
 * narrower than `LONG` alone.
 */
const ROOM = { rxm: 1180, clif: 1400 } as const
const FITS = 220
const UNDER = 170

const list = (host: HTMLElement) => host.querySelector('.rxm-register-list') as HTMLElement
/** The row the view marks as the result, if any. */
const marked = (host: HTMLElement) => host.querySelector<HTMLElement>('.rxm-register.is-result')
/** The row the view marks as the result. */
function result(host: HTMLElement): HTMLElement {
  const row = marked(host)
  if (row === null) throw new Error('no row is marked as the result')
  return row
}
const ddOf = (row: HTMLElement) => row.querySelector('dd') as HTMLElement
const wordOf = (dd: HTMLElement) => dd.querySelector('.result-word') as HTMLElement

/** A Range over the dd's first text node: the value, without the registers or the word after it. */
function valueRange(dd: HTMLElement): Range {
  const range = document.createRange()
  range.selectNodeContents(dd.firstChild as Text)
  return range
}

/** Whether `b` is set on the line `a` is on: their boxes share some height. */
const sameLine = (a: DOMRect, b: DOMRect) => b.top < a.bottom && b.bottom > a.top

describe.each(VIEWS)('the result in the $kind view', (view) => {
  it('puts the result first, across every column, its word after the value', async () => {
    const { host, draw } = mount(view, ROOM[view.kind])
    draw({ ...BEFORE, result: '15' })
    await frames()
    const columns = getComputedStyle(list(host)).gridTemplateColumns.split(' ')
    expect(columns.length, 'precondition: the values in more than one column').toBeGreaterThan(1)
    const row = result(host)
    expect(list(host).firstElementChild, 'the first row').toBe(row)
    const l = list(host).getBoundingClientRect()
    const r = row.getBoundingClientRect()
    expect(Math.abs(r.left - l.left), 'its left edge').toBeLessThanOrEqual(1)
    expect(Math.abs(r.right - l.right), 'its right edge').toBeLessThanOrEqual(1)
    const others = [...list(host).children].slice(1)
    expect(others.length, 'precondition: rows after it').toBeGreaterThan(0)
    for (const o of others)
      expect(o.getBoundingClientRect().top, 'a row after it').toBeGreaterThanOrEqual(r.bottom - 0.5)

    const dd = ddOf(row)
    const word = wordOf(dd)
    expect(word.textContent).toBe('result')
    const after = document.createRange()
    after.setStartAfter(word)
    after.setEnd(dd, dd.childNodes.length)
    expect(after.toString(), 'what the dd draws after the word').toBe('')
    const value = valueRange(dd).getBoundingClientRect()
    const w = word.getBoundingClientRect()
    expect(w.left, 'the word starts after the value').toBeGreaterThan(value.right)
    expect(sameLine(value, w), 'the word is on the line of the value').toBe(true)

    // EACH THEME AS `appearance.ts` SETS IT, ON THE ROOT; the two edges differ, so the second is not the first again.
    const edges: string[] = []
    for (const theme of ['light', 'dark']) {
      document.documentElement.setAttribute('data-theme', theme)
      edges.push(token('--result'))
      expect(getComputedStyle(row).boxShadow, `${theme}: the edge`).toContain(token('--result'))
      expect(getComputedStyle(row).backgroundColor, `${theme}: the ground`).toBe(
        token('--result-bg', 'background-color'),
      )
      expect(getComputedStyle(word).color, `${theme}: the word`).toBe(token('--result-word'))
    }
    expect(new Set(edges).size, 'the two themes draw two edges').toBe(2)
  })

  it('draws today’s rows at the step before', async () => {
    const { host, draw } = mount(view, view.wide + 300)
    draw({ ...BEFORE, result: '15' })
    expect(marked(host), 'precondition: the result marked at the end').not.toBeNull()
    draw(BEFORE)
    await frames()
    expect(marked(host), 'a row marked').toBeNull()
    expect(host.querySelector('.result-word'), 'the word').toBeNull()
    const rows = [...list(host).querySelectorAll<HTMLElement>('.rxm-register')]
    if (view.kind === 'rxm')
      expect(rows.map((r) => r.querySelector('dt')?.textContent).slice(0, 2)).toEqual(['pc', 'rr'])
    for (const r of rows) expect(getComputedStyle(ddOf(r)).whiteSpace, 'a value').toBe('nowrap')
  })

  it('shows a long result whole on one line where the row has room', async () => {
    const { host, draw } = mount(view, ROOM[view.kind])
    draw({ ...BEFORE, result: LONG })
    await frames()
    const dd = ddOf(result(host))
    expect(valueRange(dd).getClientRects(), 'the value').toHaveLength(1)
    expect(sameLine(valueRange(dd).getBoundingClientRect(), wordOf(dd).getBoundingClientRect()), 'the word').toBe(true)
    expect(whole(dd), 'the result is cut').toBe(true)
  })

  it('wraps only when the whole row is too narrow', async () => {
    const { host, draw } = mount(view, ROOM[view.kind])
    draw({ ...BEFORE, result: LONG })
    await frames()
    const dd = ddOf(result(host))
    const one = valueRange(dd).getBoundingClientRect()
    expect(valueRange(dd).getClientRects(), 'precondition: the value on one line').toHaveLength(1)
    // THE TWO WIDTHS THE PRECONDITIONS READ, ON ONE LINE: the value's, and the value's with the space and the word.
    const valueWidth = one.width
    const withWord = wordOf(dd).getBoundingClientRect().right - one.left

    await resize(host, FITS)
    expect(dd.clientWidth, `precondition: at ${FITS} px the value fits the row`).toBeGreaterThanOrEqual(valueWidth)
    expect(dd.clientWidth, 'precondition: the value and the word do not').toBeLessThan(withWord)
    expect(valueRange(dd).getClientRects(), 'the value').toHaveLength(1)
    expect(wordOf(dd).getBoundingClientRect().top, 'the word, on the next line').toBeGreaterThanOrEqual(
      valueRange(dd).getBoundingClientRect().bottom - 0.5,
    )

    await resize(host, UNDER)
    expect(dd.clientWidth, `precondition: at ${UNDER} px the value is wider than the row`).toBeLessThan(valueWidth)
    expect(dd.scrollWidth, 'a character clipped').toBeLessThanOrEqual(dd.clientWidth)
    expect(valueRange(dd).getClientRects().length, 'the value, over lines').toBeGreaterThanOrEqual(2)

    await resize(host, ROOM[view.kind])
    expect(valueRange(dd).getClientRects(), 'the value, with no new frame').toHaveLength(1)
    expect(sameLine(valueRange(dd).getBoundingClientRect(), wordOf(dd).getBoundingClientRect()), 'the word').toBe(true)
  })
})

describe('the result in the clif view', () => {
  const clif = VIEWS[1]

  it('marks the returned value, not a value labelled rr', async () => {
    const { host, draw } = mount(clif, clif.wide + 300)
    draw({ ...BEFORE, rows: { stack: 1, values: 2 }, regs: ['rr'], result: '15' })
    await frames()
    const rows = [...list(host).querySelectorAll<HTMLElement>('.rxm-register')]
    expect(
      rows.map((r) => ddOf(r).querySelector('.value-regs')?.textContent),
      'precondition: both say rr',
    ).toEqual(['rr', 'rr'])
    expect(
      rows.filter((r) => r.classList.contains('is-result')).map((r) => r.querySelector('dt')?.textContent),
    ).toEqual(['v1'])
  })
})

describe('the result in the rxm view', () => {
  const rxm = VIEWS[0]

  it('keeps the changed register’s outline on the result', async () => {
    const { host, draw } = mount(rxm, rxm.wide + 300)
    draw({ ...BEFORE, result: '15', wrote: 'rr' })
    await frames()
    const row = result(host)
    expect(row.classList.contains('is-changed'), 'the row changed').toBe(true)
    expect(getComputedStyle(row).outlineColor, 'the outline').toBe(token('--accent'))
    expect(getComputedStyle(row).boxShadow, 'the edge').toContain(token('--result'))
  })
})
