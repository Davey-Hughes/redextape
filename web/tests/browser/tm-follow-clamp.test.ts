import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { PaneEvents } from '../../src/pane-chrome'
import { ROW_HEIGHT } from '../../src/state-table'
import { TmPane } from '../../src/tm-pane'
import type { TmProgram, TmState } from '../../src/types'
import { SHELL, until } from './harness'

/**
 * **A FOLLOWING TABLE THAT GROWS STAYS FOLLOWING** (Plan 7 part 4, spec §9.1). Its height is the view's now, so a
 * panel closing beside it grows it; a table following a row near its end then has its scroll clamped, and the
 * browser reports the clamp as a `scroll`. Here the resize observer's callback comes first, so it is
 * `Follow.onResize` there that holds following. The other order — the `scroll` first, which `TmPane`'s scroll
 * handler answers by comparing heights — was seen in the state diagram (`state-diagram.test.ts`) and could not be
 * produced for the table.
 */

const events = (): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  toNewest: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
})

const STATES = 200
/** A chain of states, each with one rule to the next — a table of 400 rows. */
const PROGRAM: TmProgram = {
  states: Array.from({ length: STATES }, (_, i) => ({
    name: `q${i}`,
    accept: i === STATES - 1,
    rules: i === STATES - 1 ? [] : [{ read: [null], write: [null], moves: ['S' as const], next: i + 1 }],
    instr: null,
  })),
  alphabet: ['_'],
  tapes: 1,
  width: 4,
  start: 0,
  listing: [],
  labels: [],
}

/** The last state: the row the table follows sits at its very end, where growing clamps the scroll. */
const FRAME: TmState = {
  state: STATES - 1,
  step: STATES - 1,
  heads: [0],
  window_start: [0],
  window: ['_'],
  source_node: null,
  rule: null,
}

const CONTROLS = {
  canRestart: true,
  canBack: true,
  canForward: false,
  canToNewest: false,
  canPlay: false,
  playing: false,
  stepText: `${STATES - 1}`,
  continueLabel: null,
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

describe('a following rule table that grows', () => {
  it('is still following once a panel beside it closes and its scroll is clamped', async () => {
    document.body.innerHTML = ''
    const host = document.createElement('section')
    host.className = 'pane'
    host.dataset.kind = 'tm'
    host.style.height = '600px'
    document.body.append(host)
    const pane = new TmPane(host, events())
    pane.setProgram(PROGRAM, ['t'])
    pane.render(FRAME, CONTROLS)
    await frame()
    await frame()
    const table = host.querySelector('.state-table') as HTMLElement
    const reattach = host.querySelector('.table-reattach') as HTMLElement
    // Following, and at the end: the scroll is as far down as the table goes.
    expect(reattach.hidden).toBe(true)
    expect(table.scrollTop + table.clientHeight).toBeGreaterThanOrEqual(table.scrollHeight - 1)
    const before = table.clientHeight
    host.querySelector<HTMLButtonElement>('[data-panel="diagram"] .panel-toggle')?.click()
    await frame()
    await frame()
    expect(table.clientHeight).toBeGreaterThan(before)
    expect(reattach.hidden).toBe(true)
  })
})

/**
 * **A FOLLOWING DIAGRAM DETACHES ITSELF, IN *ARCS*, WITH NO PANEL EVER CLOSING.** On `fact(3)`, one step at a
 * time, the diagram detaches exactly once: the machine's `pc20` row carries the current group's sub-steps
 * row, and stepping into `halt` — a runtime routine, with no row of its own in *arcs* — drops that row and
 * shrinks the listing (626 → 600 px measured). The current group becomes `halt`, for which `#rowOf` has no
 * row (its entry is `-1`), so the follow write that would otherwise record the new position never runs; the
 * browser clamps `scrollTop` regardless, and that clamp's own `scroll` event lands far enough from `Follow`'s
 * last recorded position (24 px, past `ECHO_TOLERANCE`'s 12) to read as the user scrolling away. *Chips*
 * never drops a runtime row, so it never shrinks this way and never detaches here.
 *
 * DRIVEN THROUGH THE WHOLE APP, RULES LEFT OPEN — the default layout, not `state-diagram.test.ts`'s
 * `wholeListing()`, which closes the rules panel to draw everything at once. At either viewport measured
 * (1280×900, used here, and 1280×2400) the diagram's listing already outgrows its own share of the view
 * without that shortcut.
 */
describe('a following state diagram, in arcs, under the whole app', () => {
  let view: EditorView

  const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'

  const pane = () => document.querySelector('[data-leaf="tm-0"]') as HTMLElement
  const diagram = () => pane().querySelector('[data-panel="diagram"]') as HTMLElement
  const grid = () => diagram().querySelector('.program-scroll') as HTMLElement
  const rows = () => [...diagram().querySelectorAll<HTMLElement>('.program-row')]
  const boxes = () => [...diagram().querySelectorAll<HTMLElement>('.program-box')]
  const control = (label: string) =>
    [...pane().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
  const currentRowName = () => diagram().querySelector('.program-row[aria-current="step"] .program-name')?.textContent

  beforeAll(async () => {
    await page.viewport(1280, 900)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FACT3 } })
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the app to settle')
    await until(() => rows().length > 0, 'the diagram to draw')
    // ON THE LAST STEP, inside `halt`, by `⏭`: a run opens on step 0 (`History`).
    pane().querySelector<HTMLButtonElement>('.controls button.to-newest')?.click()
  })

  it('stays following crossing from pc20 into the halt runtime box', async () => {
    const reattach = diagram().querySelector('.diagram-reattach') as HTMLElement
    expect(reattach.hidden).toBe(true)
    // Somewhere to scroll to, without closing the rules panel: the reproduction, not the other suite's shortcut.
    await until(() => grid().scrollHeight > grid().clientHeight, 'the diagram to need scrolling')
    // `⏭` PUT THE PAGE ON THE LAST STEP, already inside `halt` — too slow to reach by stepping forward from 0.
    expect(boxes()[0]?.getAttribute('aria-current')).toBe('step')
    control('◀')?.click()
    await until(() => currentRowName() === 'pc20', 'the machine to step back onto pc20')
    const before = grid().scrollTop
    control('▶')?.click()
    await until(() => boxes()[0]?.getAttribute('aria-current') === 'step', 'the machine to step forward into halt')
    await frame()
    await frame()
    // The listing shrank under the scroll position, so the browser clamped it — that was not the user scrolling.
    expect(grid().scrollTop).toBeLessThan(before)
    expect(reattach.hidden).toBe(true)
  })

  /**
   * **THE WINDOW GROWS AND THE DIAGRAM WITH IT**, which clamps a scroll following a row near the listing's end. To
   * 1600 px, not less: the diagram's one share of the view's height passes its five-row floor only once the rules'
   * two shares have grown past theirs — at 1300 px the table grew and the diagram did not.
   *
   * THE GRID'S RESIZE OBSERVER RUNS BEFORE THE CLAMP'S `scroll`, and the draw it makes records where the box lands:
   * following's own write, and the `shrinks` prediction. With the observer doing nothing, the scroll handler's height
   * check answers instead; the case fails only with both gone. The observer's `Follow.onResize` is never the only
   * answer here, because the browser clamps 2 px past where the listing's rows reach, so the draw after it writes.
   */
  it('stays following when the window grows and its scroll is clamped', async () => {
    const reattach = diagram().querySelector('.diagram-reattach') as HTMLElement
    // FOLLOWING FROM HERE, WHATEVER THE CASE BEFORE LEFT: a sabotage that detaches that one must not fail this one's
    // precondition and be read as failing its claim.
    if (!reattach.hidden) reattach.click()
    control('◀')?.click()
    await until(() => currentRowName() === 'pc20', 'the machine to step back onto pc20')
    await frame()
    await frame()
    // Following, and at the end: `pc20` and its sub-steps row are the listing's last two rows, so following scrolled
    // as far as the listing's rows reach.
    expect(reattach.hidden, 'following before the window grows').toBe(true)
    expect(grid().scrollTop).toBe(Number(grid().getAttribute('aria-rowcount')) * ROW_HEIGHT - grid().clientHeight)
    const before = { top: grid().scrollTop, height: grid().clientHeight }
    const clamp = new Promise<void>((r) => grid().addEventListener('scroll', () => r(), { once: true }))
    await page.viewport(1280, 1600)
    await until(() => grid().clientHeight > before.height, 'the diagram to grow with the window')
    // THE PRECONDITION: the scroll was clamped, so the browser has a `scroll` of its own to report.
    expect(grid().scrollTop).toBeLessThan(before.top)
    await clamp
    await frame()
    await frame()
    expect(reattach.hidden, 'the clamp was not the user scrolling').toBe(true)
    const row = diagram().querySelector('.program-row[aria-current="step"]') as HTMLElement
    const box = grid().getBoundingClientRect()
    expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(box.top)
    expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.bottom)
  })

  /**
   * **A SCROLL REPORTED TO THE PROGRAM LEVEL WHILE THE LOCAL LEVEL HIDES IT IS NOT THE USER'S.** Following's write is
   * reported at the next rendering update, and a level switched in the same task has hidden the box by then, where
   * its `scrollTop` reads 0. Two things answer it: the grid's `isOpen`, which is the diagram's box having a height,
   * and its scroll handler's height check, which reads a box gone to no height as a clamp. The case fails only with
   * both gone.
   */
  it('comes back following when the local level hides it before its scroll is reported', async () => {
    const reattach = diagram().querySelector('.diagram-reattach') as HTMLElement
    const choice = (value: string) =>
      [...diagram().querySelectorAll<HTMLButtonElement>('.diagram-mode')].find((b) => b.dataset.value === value)
    expect(currentRowName(), 'a row to follow').toBe('pc20')
    // Detached by a scroll of the user's, so the re-attach below writes a new position.
    grid().scrollTop = 0
    await until(() => !reattach.hidden, 'following to detach')
    const echo = new Promise<void>((r) => grid().addEventListener('scroll', () => r(), { once: true }))
    reattach.click()
    choice('local')?.click()
    await echo
    choice('program')?.click()
    await frame()
    await frame()
    expect(reattach.hidden, 'the scroll was not the user scrolling').toBe(true)
    const row = diagram().querySelector('.program-row[aria-current="step"]') as HTMLElement
    const box = grid().getBoundingClientRect()
    expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(box.top)
    expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.bottom)
  })

  /**
   * **A KEY THAT SCROLLS TELLS THE PANE AT ONCE**, so *follow current state* is offered with the key rather than with
   * the key's `scroll`, a frame later. A synthetic key, since the claim is about what has happened when its handler
   * returns: an awaited `userEvent` resolves after that `scroll` too, and could not tell the two apart.
   */
  it('offers follow current state as soon as a key scrolls the diagram', () => {
    const reattach = diagram().querySelector('.diagram-reattach') as HTMLElement
    if (!reattach.hidden) reattach.click()
    expect(reattach.hidden, 'following before the key').toBe(true)
    expect(grid().scrollTop, 'somewhere for Home to scroll from').toBeGreaterThan(0)
    grid().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))
    expect(grid().scrollTop).toBe(0)
    expect(reattach.hidden, 'offered with the key').toBe(false)
    reattach.click()
  })
})
