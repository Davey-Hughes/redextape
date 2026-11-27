import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLE_ENCODING, EXAMPLES } from '../../src/examples'
import { compile, diagram, diagramChoice, frames, host, PREFIX, panelOf, SHELL, stateTable, until } from './harness'
import { whole } from './machine-views'

/**
 * THE APP ADDS THE CUT-TEXT WATCHER ITSELF (the cut-text tooltips design, `cut-text.ts`): in views the app builds, a cut
 * text reads whole in its `title` after a real hover, with no test adding the watcher. Its texts are a row of fact(12)'s
 * clif listing, a rule of the TM view's rule table and an instruction of the TM view's diagram. Each case first holds
 * its text cut, so that none passes because a text happened to fit. `cut-text.test.ts` holds the watcher in views
 * built by hand. fact(12)'s result is no longer one of them: the clif view's values keep the room it needs (the
 * squeezed values design).
 */

const FACT_12 = EXAMPLES.find((e) => e.id === 'fact-12')

/**
 * How wide the page is: narrow enough that the TM view cuts some of fact(12)'s rules, and wide enough that a cut
 * instruction keeps part of its text drawn to hover. The clif view cuts some rows of its listing at this width too.
 */
const WIDTH = 760

/** How far in from a text's left edge a hover lands. */
const HOVER_X = 4

const picker = () => document.querySelector('#encoding') as HTMLSelectElement
const clif = () => host('clif-0') as HTMLElement
const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''

/** A real hover at `HOVER_X`, at `el`'s middle height: a new `position`, as the call scales it in place. */
async function hover(el: Element): Promise<void> {
  await userEvent.hover(el, { position: { x: HOVER_X, y: el.getBoundingClientRect().height / 2 } })
}

/** Whether the point a hover lands on shows `el` where it is drawn now. */
function reachable(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect()
  return el.contains(document.elementFromPoint(box.left + HOVER_X, box.top + box.height / 2))
}

/**
 * The first of `texts()` that is cut and that a hover reaches where it is drawn, once the first cut one is scrolled
 * into view. A hover that scrolled a grid itself would have the grid draw new rows first, and the pointer would arrive
 * on a new element in place of the one found.
 */
async function firstCut(texts: () => HTMLElement[]): Promise<HTMLElement | undefined> {
  const cut = () => texts().filter((t) => !whole(t))
  const first = cut()[0]
  const grid = first?.closest<HTMLElement>('[role="grid"]')
  const topWas = grid?.scrollTop
  const leftWas = grid?.scrollLeft
  first?.scrollIntoView({ block: 'nearest' })
  // THE GRID'S `scroll` AT ONCE, as a wheel's comes: a grid still following the run would otherwise be put back on its
  // row by a reply drawn before the browser's own event, which then reads as that draw's echo. ONLY WHEN THE GRID MOVED,
  // as a wheel that moves nothing sends none: an event with nothing scrolled detaches a grid whose follow has not
  // written yet, which no user's scroll does.
  if (grid && (grid.scrollTop !== topWas || grid.scrollLeft !== leftWas)) grid.dispatchEvent(new Event('scroll'))
  await frames()
  return cut().find(reachable)
}

beforeAll(async () => {
  await page.viewport(WIDTH, 1600)
  document.body.innerHTML = SHELL
  const view = await (await import('../../src/main')).ready
  // FACT(12)'S TM LEG IS DECLINED UNDER UNARY: its result does not fit. Its outcomes are declared under this encoding.
  if (picker().value !== EXAMPLE_ENCODING) await userEvent.selectOptions(picker(), EXAMPLE_ENCODING)
  await compile(view, FACT_12?.text ?? '')
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a clif view')
  await until(() => /^step 0 of \d/.test(stepOf(clif())), 'the clif view to record its run')
  await userEvent.click(clif().querySelector('.controls .to-newest') as HTMLButtonElement)
  await until(() => /^step ([\d,]+) of \1$/.test(stepOf(clif())), "the clif view to reach its run's end")
}, 60_000)

describe('the cut-text watcher in the app', () => {
  it("gives a cut row of fact(12)'s clif listing its text", async () => {
    const row = await firstCut(() => [...panelOf(clif(), 'listing').querySelectorAll<HTMLElement>('.clif-cell')])
    if (row === undefined) throw new Error('precondition: no drawn row of the listing is cut where a hover reaches it')
    await hover(row)
    // THE TITLE SETS THE ROW'S COLUMNS A SPACE APART, which its text runs together (`cut-text.ts`'s `reads`).
    expect(row.title.replaceAll(' ', ''), 'the row').toBe((row.textContent ?? '').replaceAll(' ', ''))
    expect(row.title.length, 'the row, all of it').toBeGreaterThanOrEqual(row.textContent?.length ?? 0)
  })

  it("gives a cut rule of the TM view's rule table its text", async () => {
    await until(() => stateTable().querySelector('.state-cell') !== null, 'the rule table to draw')
    const cell = await firstCut(() => [...stateTable().querySelectorAll<HTMLElement>('.state-cell')])
    if (cell === undefined) throw new Error('precondition: no drawn rule is cut where a hover reaches it')
    await hover(cell)
    expect(cell.title, 'the rule').toBe(cell.textContent)
  })

  it("gives a cut instruction of the TM view's diagram its text", async () => {
    expect(diagramChoice('program')?.getAttribute('aria-checked'), 'precondition: the program level').toBe('true')
    await until(() => diagram().querySelector('.program-text') !== null, "the diagram's program level to draw")
    const text = await firstCut(() => [...diagram().querySelectorAll<HTMLElement>('.program-text')])
    if (text === undefined) throw new Error('precondition: no drawn instruction is cut where a hover reaches it')
    await hover(text)
    expect(text.title, 'the instruction').toBe(text.textContent)
  })
})
