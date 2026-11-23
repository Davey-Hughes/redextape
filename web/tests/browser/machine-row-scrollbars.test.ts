import { describe, expect, it } from 'vitest'
import { RxmPane } from '../../src/rxm-pane'
import { frame, frames, hearLoops } from './harness'
import { arrangement, drawnAs, loadViews, mount, row, VIEWS } from './machine-views'

/**
 * A MACHINE VIEW'S ARRANGEMENT UNDER CLASSIC SCROLL BARS, which take their width out of the box they scroll:
 * `SCROLLBAR_FILES` in vite.config.ts runs this file in a Chromium that draws them. The arrangement is chosen from the
 * view's border box less its padding and border (`machine-row.ts`), which no scroll bar changes, so a bar that
 * something in the view brings in at a threshold neither switches it nor makes it flicker (the machine panels row
 * design §6.3).
 */

loadViews()

hearLoops(() => {
  document.body.innerHTML = ''
})

/** The width the view's own scroll bar takes out of it: none where it does not scroll. */
const bar = (host: HTMLElement) => host.offsetWidth - host.clientWidth

/** Make `host` the least height at which it does not scroll, to the pixel. */
async function fitHeight(host: HTMLElement): Promise<void> {
  let [lo, hi] = [100, 2000]
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    host.style.height = `${mid}px`
    await frame()
    if (host.scrollHeight > host.clientHeight) lo = mid
    else hi = mid
  }
  host.style.height = `${hi}px`
  await frames()
}

describe('the rxm view under classic scroll bars', () => {
  const view = VIEWS[0]

  it('keeps the arrangement when a line the view shows brings a bar in at the threshold, the row under it', async () => {
    const { host, pane } = mount(view, view.wide + 1)
    await frames()
    expect(arrangement(host), 'precondition: wide, a pixel over its threshold').toBe('wide')
    await fitHeight(host)
    expect(bar(host), 'precondition: no bar').toBe(0)
    if (!(pane instanceof RxmPane)) throw new Error('the rxm view was built on another pane')
    // A COPY'S VALUE LINE, WHICH ITS BUILD SETS: one more line in a view that had no height to spare.
    pane.setScratch({
      status: { available: true, reason: '', run: 'Ended', cap: null, total_steps: 55 },
      value: { Value: { text: '42' } },
    })
    await frames()
    expect(bar(host), 'precondition: a bar came with the line').toBeGreaterThanOrEqual(10)
    expect(row(host).clientWidth, 'precondition: the row is under the wide threshold').toBeLessThan(view.wide)
    // A DECISION MADE WHILE THE BAR IS THERE: the row decides when the view's box changes, and a line of text changes
    // no box, so without this the case could not tell which width the decision reads.
    host.style.height = `${host.offsetHeight - 1}px`
    await frames()
    expect(bar(host), 'precondition: the bar is there after the decision').toBeGreaterThanOrEqual(10)
    for (let i = 0; i < 10; i += 1) await frame()
    expect(arrangement(host), 'and stays wide').toBe('wide')
    expect(drawnAs(host, view.values)).toBe('wide')
  })
})

describe.each(VIEWS)('the $kind view under classic scroll bars', (view) => {
  it('settles at once at every width across the threshold where medium scrolls and wide does not', async () => {
    const { host } = mount(view, view.wide + 1)
    await frames()
    expect(arrangement(host), 'precondition: wide, a pixel over its threshold').toBe('wide')
    await fitHeight(host)
    for (let w = view.wide - 20; w <= view.wide + 20; w += 1) {
      const want = w >= view.wide ? 'wide' : 'medium'
      host.style.width = `${w}px`
      const seen = new Set<string | undefined>()
      for (let i = 0; i < 6; i += 1) {
        await frame()
        seen.add(arrangement(host))
      }
      expect([...seen], `in each of six frames at ${w} px`).toEqual([want])
      expect(drawnAs(host, view.values), `drawn at ${w} px`).toBe(want)
      // THE SWEEP CROSSES A WIDTH AT WHICH THE VIEW'S OWN BAR COMES AND GOES: without one, the row's width and the
      // view's would differ by nothing, and no width here could tell which of them the decision reads.
      if (want === 'medium') expect(bar(host), `precondition: a bar at ${w} px`).toBeGreaterThanOrEqual(10)
      else expect(bar(host), `precondition: no bar at ${w} px`).toBe(0)
    }
  })
})
