import { describe, expect, it } from 'vitest'
import { frames, hearLoops } from './harness'
import { type Counts, loadViews, mount, resize, VIEWS, type View, whole } from './machine-views'

/**
 * THE VALUES' ROOM UNDER CLASSIC SCROLL BARS, which take their width out of the box they scroll: `SCROLLBAR_FILES` in
 * vite.config.ts runs this file in a Chromium that draws them. A values panel too short for its rows scrolls, its bar
 * narrows the grid, and each track's room is no wider than the grid (the squeezed values design): so a value is whole
 * wherever the grid beside the bar is as wide as its row, and the panel never scrolls sideways.
 * `machine-room.test.ts` holds the room under bars that take no width.
 */

loadViews()

hearLoops(() => {
  document.body.innerHTML = ''
})

/** fact(12)'s result, nine digits: a row of it with a short name needs every character of the grid's least track. */
const NINE = '479001600'

/** Far more values than a short panel holds, value 0 `NINE`. */
const MANY: Counts = {
  depth: 1,
  cells: 1,
  boxes: 0,
  rows: { stack: 0, values: 64 },
  words: (i) => (i === 0 ? NINE : String(i)),
}

/** The values panel's body, which scrolls. */
const body = (host: HTMLElement) => host.querySelector('.rxm-registers') as HTMLElement
const list = (host: HTMLElement) => host.querySelector('.rxm-register-list') as HTMLElement

/** The word of value 0: a local's in rxm, a value's in clif. */
function first(host: HTMLElement, view: View): HTMLElement {
  const name = view.kind === 'rxm' ? 'r0' : 'v0'
  const row = [...host.querySelectorAll<HTMLElement>('.rxm-register')].find(
    (r) => r.querySelector('dt')?.textContent === name,
  )
  if (row === undefined) throw new Error(`no row reads ${name}`)
  return row.querySelector('dd') as HTMLElement
}

/** How wide `dd`'s row is with its word whole: its padding, its name, the gap and the whole word. */
function rowNeeds(dd: HTMLElement): number {
  const row = dd.parentElement as HTMLElement
  return row.getBoundingClientRect().width - dd.getBoundingClientRect().width + dd.scrollWidth
}

describe.each(VIEWS)('the $kind view’s values under classic scroll bars', (view) => {
  it('draw a value whole wherever the grid beside the bar fits its row, and never scroll sideways', async () => {
    const { host, draw } = mount(view, 100, { height: 420 })
    draw(MANY)
    await frames()
    let barred = 0
    for (let w = 100; w <= view.wide + 300; w += 10) {
      await resize(host, w)
      const b = body(host)
      if (b.offsetWidth - b.clientWidth >= 10) barred += 1
      expect(b.scrollWidth, `at ${w} px, the panel scrolls sideways`).toBeLessThanOrEqual(b.clientWidth)
      const dd = first(host, view)
      const needs = rowNeeds(dd)
      const room = list(host).clientWidth
      if (room >= needs + 1) expect(whole(dd), `at ${w} px, value 0, its row ${needs} px in ${room}`).toBe(true)
      else if (room < needs - 1) expect(whole(dd), `at ${w} px, value 0, its row ${needs} px in ${room}`).toBe(false)
    }
    expect(barred, 'precondition: widths at which the values panel draws a bar').toBeGreaterThan(0)
  })
})
