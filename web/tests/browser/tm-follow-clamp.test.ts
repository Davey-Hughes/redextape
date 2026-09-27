import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { PaneEvents } from '../../src/pane-chrome'
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
  window: [['_']],
  source_node: null,
  rule: null,
}

const CONTROLS = {
  canRestart: true,
  canBack: true,
  canForward: false,
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
  })

  it('stays following crossing from pc20 into the halt runtime box', async () => {
    const reattach = diagram().querySelector('.diagram-reattach') as HTMLElement
    expect(reattach.hidden).toBe(true)
    // Somewhere to scroll to, without closing the rules panel: the reproduction, not the other suite's shortcut.
    await until(() => grid().scrollHeight > grid().clientHeight, 'the diagram to need scrolling')
    // THE PAGE OPENS ON THE LAST STEP, already inside `halt` — too slow to reach by stepping forward from 0.
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
})
