import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { hearLoops, panelToggle } from './harness'
import {
  arrangement,
  type Counts,
  header,
  loadViews,
  maximise,
  mount,
  note,
  resize,
  title,
  VIEWS,
  type View,
  whole,
} from './machine-views'

/**
 * A MACHINE PANEL'S HEADER IS ONE LINE, AND GIVES WAY BY ITS COUNT (the machine panels row design §5.5 and §6.4,
 * `machine-panels.ts`): the registers or values, call stack and heap headers of an rxm view and a CLIF view built by
 * hand, in a view narrow enough that each panel is as wide as the view, with the counts a run grows to; and at each
 * view's thresholds, where its columns are their narrowest, the counts §5.1 sizes those columns to hold whole.
 */

loadViews()

hearLoops(() => {
  document.body.innerHTML = ''
})

/** The widths these cases name are where the bundled fonts cut a count or a title; another style's differ. */
function inInstrument(): void {
  expect(['instrument', undefined], 'precondition: the Instrument style').toContain(
    document.documentElement.dataset.style,
  )
}

const buttons = (host: HTMLElement, name: string) => [
  ...header(host, name).querySelectorAll<HTMLElement>('.panel-actions button'),
]

describe.each(VIEWS)('the $kind view', (view) => {
  const names = [view.values, 'stack', 'heap']

  it('gives each count its whole text as its tooltip, cut short or not', async () => {
    inInstrument()
    const { host, draw } = mount(view, view.wide + 300)
    draw({ depth: 123456, cells: 123456, boxes: 1234 })
    for (const [w, cut] of [
      [view.wide + 300, false],
      [200, true],
    ] as const) {
      await resize(host, w)
      expect(whole(note(host, 'stack')), `precondition: the call stack's count at ${w} px is cut: ${cut}`).toBe(!cut)
      expect(note(host, 'stack').title, `at ${w} px`).toBe('123,456 frames')
      expect(note(host, 'heap').title, `at ${w} px`).toBe('123,456 cells · 1,234 boxes')
      for (const n of ['stack', 'heap']) expect(note(host, n).title).toBe(note(host, n).textContent)
    }
    draw({ depth: 0, cells: 0, boxes: 0 })
    expect(note(host, 'stack').title, 'a count that changed').toBe('0 frames')
  })

  it('draws a cut count only where its first character and an ellipsis fit', async () => {
    inInstrument()
    const { host, draw } = mount(view, 300)
    draw({ depth: 1234, cells: 1234, boxes: 12 })
    const count = note(host, 'stack')
    const probe = document.createElement('span')
    probe.textContent = '1…'
    probe.style.cssText = 'position: absolute; visibility: hidden'
    count.append(probe)
    const least = probe.getBoundingClientRect().width
    probe.remove()
    const seen = { hidden: 0, cut: 0 }
    for (let w = 300; w >= 120; w -= 2) {
      await resize(host, w)
      const room = count.getBoundingClientRect().width
      const drawn = getComputedStyle(count.firstElementChild as HTMLElement).visibility === 'visible'
      if (!drawn) seen.hidden++
      else if (!whole(count)) {
        seen.cut++
        expect(room, `the count at ${w} px`).toBeGreaterThanOrEqual(least)
      }
    }
    expect(seen.hidden, 'precondition: a width with no room for the count').toBeGreaterThan(0)
    expect(seen.cut, 'precondition: a width with the count cut').toBeGreaterThan(0)
  })

  it('gives way by the count, then by the title, never by a button, in a column too narrow for its header', async () => {
    inInstrument()
    const { host, draw } = mount(view, view.wide + 300)
    draw({ depth: 1234, cells: 1234, boxes: 12 })
    const line = header(host, 'stack').getBoundingClientRect().height
    const natural = new Map(names.map((n) => [n, buttons(host, n).map((b) => b.getBoundingClientRect().width)]))
    for (const n of names) {
      expect(natural.get(n)?.length, `precondition: ${n} has a button`).toBeGreaterThan(0)
      for (const wide of natural.get(n) ?? []) expect(wide, `precondition: ${n}'s button is drawn`).toBeGreaterThan(0)
    }
    await resize(host, 200)
    expect(whole(note(host, 'stack')), 'the count gives way first').toBe(false)
    expect(whole(title(host, 'stack')), 'the title stays whole while the count can give way').toBe(true)
    await resize(host, 110)
    expect(whole(title(host, 'stack')), 'then the title gives way').toBe(false)
    for (const w of [200, 110]) {
      await resize(host, w)
      for (const n of names) {
        const h = header(host, n).getBoundingClientRect()
        expect(h.height, `${n} at ${w} px is one line`).toBeCloseTo(line, 1)
        const widths = buttons(host, n).map((b) => b.getBoundingClientRect().width)
        expect(widths, `${n} at ${w} px: its buttons whole`).toEqual(natural.get(n))
        // A BUTTON ITS ACTIONS' BOX CLIPS KEEPS ITS WIDTH AND ITS RIGHT EDGE, so its left edge is what says it is whole.
        const actions = (header(host, n).querySelector('.panel-actions') as HTMLElement).getBoundingClientRect()
        const toggle = panelToggle(host, n).getBoundingClientRect()
        for (const b of buttons(host, n)) {
          const at = b.getBoundingClientRect()
          expect(at.right, `${n} at ${w} px: its buttons inside it`).toBeLessThanOrEqual(h.right)
          expect(at.left, `${n} at ${w} px: no button clipped by its actions' box`).toBeGreaterThanOrEqual(actions.left)
          expect(at.left, `${n} at ${w} px: no button under the title`).toBeGreaterThanOrEqual(toggle.right)
        }
      }
    }
  })

  it("keeps every header one line as a run's counts grow", async () => {
    inInstrument()
    const { host, draw } = mount(view, view.wide + 300)
    const line = header(host, 'stack').getBoundingClientRect().height
    const runs: Counts[] = [
      { depth: 1, cells: 1, boxes: 0 },
      { depth: 2, cells: 57, boxes: 2 },
      { depth: 10, cells: 999, boxes: 12 },
      { depth: 1234, cells: 1234, boxes: 12 },
      { depth: 123456, cells: 123456, boxes: 1234 },
    ]
    // AT EACH THRESHOLD THE ROW'S COLUMNS ARE THEIR NARROWEST; below them every panel is as wide as the view.
    for (const w of [view.wide, view.medium, 240, 200, 110]) {
      await resize(host, w)
      for (const closed of [false, true]) {
        if (closed) for (const n of names) await userEvent.click(panelToggle(host, n))
        for (const n of names)
          expect(panelToggle(host, n).getAttribute('aria-expanded'), `precondition: ${n} at ${w} px`).toBe(
            String(!closed),
          )
        for (const c of runs) {
          draw(c)
          for (const n of names) {
            const h = header(host, n).getBoundingClientRect()
            const what = `${n} at ${w} px, ${closed ? 'closed' : 'open'}, ${c.depth} frames`
            expect(h.height, what).toBeCloseTo(line, 1)
            for (const b of buttons(host, n))
              expect(b.getBoundingClientRect().right, `${what}: its button inside it`).toBeLessThanOrEqual(h.right)
          }
        }
        if (closed) for (const n of names) await userEvent.click(panelToggle(host, n))
      }
    }
  })

  it('centres each count on its maximise button, top to bottom, open or closed, in each arrangement', async () => {
    inInstrument()
    const widths = [view.wide + 40, Math.round((view.medium + view.wide) / 2), view.medium - 40] as const
    const arrangements = ['wide', 'medium', 'narrow']
    const { host, draw } = mount(view, widths[0], { height: 1600 })
    draw({ depth: 2, cells: 57, boxes: 2 })
    const middle = (r: DOMRect) => r.top + r.height / 2
    for (const closed of [false, true]) {
      if (closed) for (const n of names) await userEvent.click(panelToggle(host, n))
      for (const [i, w] of widths.entries()) {
        await resize(host, w)
        expect(arrangement(host), `precondition: ${arrangements[i]} at ${w} px`).toBe(arrangements[i])
        for (const n of names)
          expect(panelToggle(host, n).getAttribute('aria-expanded'), `precondition: ${n} at ${w} px`).toBe(
            String(!closed),
          )
        for (const n of ['stack', 'heap']) {
          const text = note(host, n).firstElementChild as HTMLElement
          expect(getComputedStyle(text).visibility, `precondition: ${n}'s count drawn at ${w} px`).toBe('visible')
          const glyphs = document.createRange()
          glyphs.selectNodeContents(text)
          expect(glyphs.getBoundingClientRect().height, 'precondition: a line of text').toBeGreaterThan(0)
          // A LINE NO TALLER THAN ITS TEXT: a taller one splits its spare height in whole pixels, and the text sits high.
          expect(
            note(host, n).getBoundingClientRect().height,
            `${n}'s line at ${w} px${closed ? ', closed' : ''}`,
          ).toBeLessThanOrEqual(glyphs.getBoundingClientRect().height + 0.5)
          expect(
            Math.abs(middle(glyphs.getBoundingClientRect()) - middle(maximise(host, n).getBoundingClientRect())),
            `${n} at ${w} px${closed ? ', closed' : ''}`,
          ).toBeLessThanOrEqual(0.5)
        }
      }
    }
  })
})

/**
 * The counts each view's headers hold whole where the design says (§5.1): a CLIF view's at its two thresholds and in
 * the 634 px a 1280 px window gives a view beside the source, medium there since the squeezed values design widened its
 * values, and an rxm view's largest at its thresholds. Each case's `arrangement` is the one the view is in at its
 * `width`.
 */
type Whole = Counts & { readonly width: number; readonly arrangement: string }

/** The width from which a view of `kind` is drawn `arrangement`: `VIEWS`', so the cases follow a moved threshold. */
const from = (kind: View['kind'], arrangement: 'wide' | 'medium'): number =>
  VIEWS.find((v) => v.kind === kind)?.[arrangement] ?? Number.NaN

const WHOLE: Record<View['kind'], readonly Whole[]> = {
  rxm: [
    { width: from('rxm', 'wide'), arrangement: 'wide', depth: 123456, cells: 123456, boxes: 1234 },
    { width: from('rxm', 'medium'), arrangement: 'medium', depth: 123456, cells: 123456, boxes: 1234 },
  ],
  clif: [
    { width: from('clif', 'wide'), arrangement: 'wide', depth: 2, cells: 57, boxes: 2 },
    { width: 634, arrangement: 'medium', depth: 1234, cells: 57, boxes: 2 },
    { width: from('clif', 'medium'), arrangement: 'medium', depth: 2, cells: 57, boxes: 2 },
  ],
}

describe.each(VIEWS)('the $kind view at its thresholds', (view) => {
  it.each(WHOLE[view.kind])('holds each count whole in its header $width px wide', async (c) => {
    inInstrument()
    const { host, draw } = mount(view, c.width)
    draw(c)
    await resize(host, c.width)
    expect(arrangement(host), `precondition: ${c.arrangement} at ${c.width} px`).toBe(c.arrangement)
    const line = header(host, 'listing').getBoundingClientRect().height
    expect(line, 'precondition: the listing has a header to measure a line by').toBeGreaterThan(0)
    const frames = c.depth === 1 ? '1 frame' : `${c.depth.toLocaleString('en')} frames`
    expect(note(host, 'stack').textContent, "precondition: the call stack's count").toBe(frames)
    expect(note(host, 'heap').textContent, "precondition: the heap's count").toBe(
      `${c.cells.toLocaleString('en')} cells · ${c.boxes.toLocaleString('en')} boxes`,
    )
    for (const n of [view.values, 'stack', 'heap']) {
      expect(header(host, n).getBoundingClientRect().height, `${n}: one line`).toBeCloseTo(line, 1)
      expect(whole(title(host, n)), `${n}: its title whole`).toBe(true)
      const count = header(host, n).querySelector<HTMLElement>('.panel-note')
      if (count === null) continue
      expect(getComputedStyle(count.firstElementChild as HTMLElement).visibility, `${n}: its count drawn`).toBe(
        'visible',
      )
      expect(whole(count), `${n}: its count, ${count.textContent}, whole`).toBe(true)
    }
  })
})
