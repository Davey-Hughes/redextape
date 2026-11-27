import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { compile, host, hosts, outside, PREFIX, panelOf, SHELL, segments, until } from './harness'

/**
 * THE RESULT'S ROW IN THE VIEWS THE APP BUILDS (the return-value highlight design, goals 1-3): at the last step of
 * sum_to(5) the rxm view marks `rr` and the clif view the value `main` returns, first in their values panels, and
 * neither at the step before, with nothing outside the view moved; after a listing switch the clif view marks the new
 * listing's own value; fact(12)'s result reads whole in both, and in the rxm view at the step before (the squeezed
 * values design); and a view split from the rxm view after its run has ended marks the result too.
 * `result-values.test.ts` holds the row in views built by hand.
 */

const SUM_TO = EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? ''
const FACT_12 = EXAMPLES.find((e) => e.id === 'fact-12')?.text ?? ''

/** Each long case's own bound, past every wait in it. */
const CASE_MS = 60_000

let view: EditorView

const rxm = () => host('rxm-0') as HTMLElement
const rxmViews = () => hosts().filter((h) => h.dataset.kind === 'rxm')
const clif = () => host('clif-0') as HTMLElement
const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''
const control = (pane: HTMLElement, label: string) =>
  [...pane.querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
const registers = (pane: HTMLElement) => [...pane.querySelectorAll<HTMLElement>('.rxm-register')]
const nameOf = (row: HTMLElement | undefined) => row?.querySelector('dt')?.textContent ?? ''
const ddOf = (row: HTMLElement) => row.querySelector('dd') as HTMLElement
const register = (pane: HTMLElement, name: string) => registers(pane).find((r) => nameOf(r) === name)
const marked = (pane: HTMLElement) => registers(pane).filter((r) => r.classList.contains('is-result'))
/** Anything in the listing a result mark draws. */
const listingMarks = (pane: HTMLElement) => panelOf(pane, 'listing').querySelectorAll('.is-result, .result-word')
/** `pane`'s choice of `listing` on its bar. */
const choice = (pane: HTMLElement, listing: string) =>
  pane.querySelector<HTMLButtonElement>(`.view-actions [role="radiogroup"] button[data-value="${listing}"]`)

/** Whether the step line says the last step. */
const atEnd = (pane: HTMLElement) => /^step ([\d,]+) of \1$/.test(stepOf(pane))

/** Press `⏭`, which a view at its last step disables, and wait for the step line to say the last step. */
async function toEnd(pane: HTMLElement): Promise<void> {
  if (!atEnd(pane)) await userEvent.click(pane.querySelector('.controls .to-newest') as HTMLButtonElement)
  await until(() => atEnd(pane), "the view to reach its run's end")
}

/** Press `◀` and wait for the step line to say the step before the one it said. */
async function back(pane: HTMLElement): Promise<void> {
  const from = Number((/^step ([\d,]+)/.exec(stepOf(pane))?.[1] ?? '').replaceAll(',', ''))
  await userEvent.click(control(pane, '◀') as HTMLButtonElement)
  await until(() => stepOf(pane).startsWith(`step ${(from - 1).toLocaleString('en')} of`), 'the view to step back')
}

/** A Range over the dd's first text node: the value, without the registers or the word after it. */
function valueRangeOf(dd: HTMLElement): Range {
  const range = document.createRange()
  range.selectNodeContents(dd.firstChild as Text)
  return range
}

/** Whether the value, the dd's first text, is drawn whole: inside the dd's box, which clips nothing. */
function valueWhole(dd: HTMLElement): boolean {
  const glyphs = valueRangeOf(dd).getBoundingClientRect()
  const clip = dd.getBoundingClientRect()
  return dd.scrollWidth <= dd.clientWidth && glyphs.left >= clip.left - 0.5 && glyphs.right <= clip.right + 0.5
}

/** Split `pane` into another view of it through its `⋯` menu, pressed as a user presses. */
async function splitSame(pane: HTMLElement): Promise<void> {
  const more = pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
  await userEvent.click(more)
  const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement
  await userEvent.click(menu.querySelector('button.view-split[data-dir="row"]') as HTMLElement)
  await userEvent.click(menu.querySelector('.view-menu-pairs button[data-same]') as HTMLElement)
}

/** Show a listing in the clif view and wait for its run to be recorded, from step 0. */
async function showListing(listing: string): Promise<void> {
  await userEvent.click(choice(clif(), listing) as HTMLButtonElement)
  await until(
    () => choice(clif(), listing)?.getAttribute('aria-checked') === 'true' && /^step 0 of [\d,]+$/.test(stepOf(clif())),
    `the clif view to record the ${listing} listing`,
  )
}

beforeAll(async () => {
  await page.viewport(1400, 1000)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(view, SUM_TO)
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a clif view')
  await until(() => segments().some((s) => s.startsWith('rxm 15')), "the readout's value")
  await until(() => /^step 0 of [\d,]+$/.test(stepOf(clif())), 'the clif view to record its run')
}, CASE_MS)

describe('the result in the app', () => {
  it("marks rr at the rxm view's last step, and not at the step before", async () => {
    await toEnd(rxm())
    expect(stepOf(rxm())).toBe('step 84 of 84')
    const first = registers(rxm())[0] as HTMLElement
    expect(nameOf(first), 'the first row').toBe('rr')
    expect(marked(rxm()), 'the rows marked').toEqual([first])
    expect(ddOf(first).textContent).toBe('15 result')
    const atEnd = outside('rxm-0')

    await back(rxm())
    expect(marked(rxm()), 'the rows marked at the step before').toEqual([])
    expect(outside('rxm-0'), 'what is outside the view').toEqual(atEnd)

    await toEnd(rxm())
    expect(marked(rxm()).map(nameOf), 'the rows marked at the end again').toEqual(['rr'])
    expect(listingMarks(rxm()), 'a mark in the listing').toHaveLength(0)
  })

  it("marks the returned value, not v3, at the clif view's last step", async () => {
    await toEnd(clif())
    expect(stepOf(clif())).toBe('step 183 of 183')
    const v3 = register(clif(), 'v3') as HTMLElement
    expect(ddOf(v3).firstChild?.textContent, 'precondition: v3 reads 0').toBe('0')
    expect(v3.querySelector('.value-regs')?.textContent, 'precondition: v3 stands for rr').toBe('rr')
    expect(marked(clif()).map(nameOf), 'the rows marked').toEqual(['v8'])
    const v8 = marked(clif())[0] as HTMLElement
    expect(registers(clif())[0], 'the first row').toBe(v8)
    expect(ddOf(v8).textContent).toBe('15 rr result')
    const atEnd = outside('clif-0')

    await back(clif())
    expect(marked(clif()), 'the rows marked at the step before').toEqual([])
    expect(outside('clif-0'), 'what is outside the view').toEqual(atEnd)

    await toEnd(clif())
    expect(marked(clif()).map(nameOf), 'the rows marked at the end again').toEqual(['v8'])
    expect(listingMarks(clif()), 'a mark in the listing').toHaveLength(0)
  })

  it(
    "marks the new listing's returned value after a switch",
    async () => {
      await toEnd(clif())
      expect(stepOf(clif()), 'precondition: as built at its end').toBe('step 183 of 183')
      await showListing('optimised')
      try {
        await toEnd(clif())
        // BOTH LISTINGS RETURN v8, so the row marked does not tell them apart: the run's own total and values do.
        expect(stepOf(clif()), "precondition: the optimised run's own end").toBe('step 134 of 134')
        expect(registers(clif()).length, 'precondition: the optimised values').toBe(4)
        expect(marked(clif()).map(nameOf), 'the rows marked').toEqual(['v8'])
      } finally {
        await showListing('as-built')
      }
    },
    CASE_MS,
  )

  it(
    "shows fact(12)'s result whole, and at the step before",
    async () => {
      await page.viewport(1400, 896)
      await compile(view, FACT_12)
      await until(() => segments().some((s) => s.startsWith('rxm 479001600')), "the readout's value")
      await until(() => /^step 0 of [\d,]+$/.test(stepOf(clif())), 'the clif view to record its run')
      // ONE STEP BEFORE THE END rr is one cell of the registers grid, whose tracks keep the room the run's widest value
      // has needed (the squeezed values design): the grid's least track alone cut it.
      await toEnd(rxm())
      await back(rxm())
      const rr = ddOf(register(rxm(), 'rr') as HTMLElement)
      expect(rr.firstChild?.textContent, 'precondition: rr reads the value at the step before').toBe('479001600')
      expect(valueWhole(rr), 'the value at the step before').toBe(true)
      for (const pane of [rxm(), clif()]) {
        await toEnd(pane)
        const row = marked(pane)[0]
        if (row === undefined) throw new Error('no row is marked as the result')
        expect(ddOf(row).firstChild?.textContent, 'the value').toBe('479001600')
        expect(valueRangeOf(ddOf(row)).getClientRects(), 'the value, on one line').toHaveLength(1)
        expect(valueWhole(ddOf(row)), 'the value, whole').toBe(true)
      }
      const dd = ddOf(marked(clif())[0] as HTMLElement)
      const value = valueRangeOf(dd).getBoundingClientRect()
      const regs = (dd.querySelector('.value-regs') as HTMLElement).getBoundingClientRect()
      const word = (dd.querySelector('.result-word') as HTMLElement).getBoundingClientRect()
      // THE VALUE, THEN rr AND THE WORD TOGETHER: on the value's line where the row has room for them, which the clif
      // view's wider values give it at most widths (the squeezed values design), and under it where it has not, as the
      // row breaks between the value and them first (`result-values.test.ts`).
      const onValue = regs.top < value.bottom && regs.bottom > value.top
      expect(onValue ? regs.left >= value.right : regs.top >= value.bottom - 0.5, 'rr, after the value').toBe(true)
      expect(word.top < regs.bottom && word.bottom > regs.top, 'the word, on the line of rr').toBe(true)
    },
    CASE_MS,
  )

  it(
    'marks the result in a view split from the rxm view after its run has ended',
    async () => {
      await page.viewport(1400, 896)
      await compile(view, FACT_12)
      await until(() => /^step 0 of [\d,]+$/.test(stepOf(rxm())), 'the rxm view to record its run')
      await toEnd(rxm())
      expect(marked(rxm()).map(nameOf), "precondition: the rxm view marks rr at its run's end").toEqual(['rr'])
      const before = new Set(rxmViews())
      await splitSame(rxm())
      await until(() => rxmViews().length === 2, 'a second rxm view')
      const second = rxmViews().find((v) => !before.has(v)) as HTMLElement
      expect(second, 'precondition: a second rxm view').toBeDefined()
      await until(() => /^step [\d,]+ of [\d,]+$/.test(stepOf(second)), 'the second rxm view to show the run')
      await toEnd(second)
      expect(stepOf(second), 'precondition: the second view at its newest step').toBe('step 181 of 181')
      expect(marked(second).map(nameOf), 'the rows marked').toEqual(['rr'])
      const row = marked(second)[0] as HTMLElement
      expect(registers(second)[0], 'the first row').toBe(row)
      expect(ddOf(row).textContent).toBe('479001600 result')
      const l = (second.querySelector('.rxm-register-list') as HTMLElement).getBoundingClientRect()
      const r = row.getBoundingClientRect()
      expect(Math.abs(r.left - l.left), 'its left edge').toBeLessThanOrEqual(1)
      expect(Math.abs(r.right - l.right), 'its right edge').toBeLessThanOrEqual(1)
    },
    CASE_MS,
  )
})
