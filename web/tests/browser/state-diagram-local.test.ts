import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * The state diagram's local level and its switch (Plan 7 part 4, spec §7, §8 and amendment 10): the current state
 * and every state within two rules of it, in signed columns; *show states*; and a machine with no program level.
 */

let view: EditorView

const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'
/** A machine whose names carry no dots and whose states no instruction built: §7's third tier. */
const FLAT = 'tapes 1\nstart q0\n\nstate q0:\n  [*] -> write [*], move [R], goto q1\nstate q1: accept\n'
/** `FLAT` with dotted names, so it groups by name (§7's second tier) and has a program level. */
const DOTTED = 'tapes 1\nstart a.q0\n\nstate a.q0:\n  [*] -> write [*], move [R], goto b.q1\nstate b.q1: accept\n'

const pane = () => document.querySelector('[data-leaf="tm-0"]') as HTMLElement
const diagram = () => pane().querySelector('[data-panel="diagram"]') as HTMLElement
const nodes = () => [...diagram().querySelectorAll<HTMLElement>('.local-node')]
const choice = (value: string) =>
  [...diagram().querySelectorAll<HTMLButtonElement>('.diagram-mode')].find((b) => b.dataset.value === value)
const status = () => pane().querySelector('.tm-status')?.textContent ?? ''
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
/** Whether an element is drawn: `hidden` is not enough, since an author `display` can outrank it. */
const drawn = (sel: string) => getComputedStyle(diagram().querySelector(sel) as HTMLElement).display !== 'none'
async function stepUntilStateChanges(): Promise<void> {
  const at = status()
  for (let i = 0; i < 200 && status() === at; i += 1) control('▶')?.click()
  await until(() => status() !== at, 'the state to change')
}
const control = (label: string) =>
  [...pane().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
/**
 * From step 0 to the first step inside `cmpeq` — 1,732 steps forward, where stepping back from the frontier took
 * about 9,000, one redraw each, and ran past the test's time under a full suite's load.
 */
async function intoCmpeq(): Promise<void> {
  control('↺')?.click()
  for (let i = 0; i < 20_000 && !/^cmp/.test(status()); i += 1) control('▶')?.click()
  await until(() => /^cmp/.test(status()), 'the machine to be inside cmpeq')
}

beforeAll(async () => {
  await page.viewport(1280, 2400)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FACT3 } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the app to settle')
  pane().querySelector<HTMLButtonElement>('[data-panel="rules"] .panel-toggle')?.click()
  // Inside `cmpeq`, where the current instruction opens onto its sub-steps and its states run in a line.
  await intoCmpeq()
})

describe('the local level (spec §8)', () => {
  it("is what the current instruction's show states opens, and the focus goes with it", async () => {
    // The button comes first in its row, so a long list of sub-steps cannot push it past the row's clipped end —
    // forced here by narrowing the view rather than assumed: at the file's own 1280px default this row's 9
    // sub-steps fit with room to spare (measured: cell.scrollWidth === cell.clientWidth), so the position
    // assertion below would hold regardless of DOM order unless the row is actually made to overflow. Restored
    // in a `finally`, since every later case in this file expects the 1280px layout.
    try {
      await page.viewport(400, 2400)
      await frame()
      await frame()
      const show = diagram().querySelector<HTMLButtonElement>('.program-show') as HTMLButtonElement
      const cell = show.closest('.program-cell') as HTMLElement
      // THE PRECONDITION, MEASURED: without it, a DOM-order regression (show states moved to the end of its row)
      // could pass this test vacuously whenever the row happens to fit.
      expect(cell.scrollWidth).toBeGreaterThan(cell.clientWidth)
      expect(show.getBoundingClientRect().right).toBeLessThanOrEqual(cell.getBoundingClientRect().right)
    } finally {
      await page.viewport(1280, 2400)
      await frame()
    }
    // A click on a sub-step is a click on a row: it shows nothing and switches nothing. Re-queried at the
    // restored width — the resize just above rebuilt the row, so any element from inside the `try` is stale.
    const show = diagram().querySelector<HTMLButtonElement>('.program-show') as HTMLButtonElement
    const cell = show.closest('.program-cell') as HTMLElement
    ;(cell.querySelector('.program-step') as HTMLElement).click()
    expect(drawn('.program-level')).toBe(true)
    expect(choice('program')?.getAttribute('aria-checked')).toBe('true')
    // From the keyboard: Enter on the sub-steps row, whose grid holds the focus.
    const grid = diagram().querySelector('.program-scroll') as HTMLElement
    grid.focus()
    const steps = show.closest('.program-row') as HTMLElement
    const index = Number(steps.getAttribute('aria-rowindex')) - 1
    await userEvent.keyboard('{Home}')
    for (let i = 0; i < index; i += 1) await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')
    await until(() => nodes().length > 0, 'the local level to draw')
    expect(drawn('.program-level')).toBe(false)
    expect(drawn('.local-level')).toBe(true)
    expect(choice('local')?.getAttribute('aria-checked')).toBe('true')
    // The grid it was in is hidden, so the focus is on the local level's tab stop rather than on the page.
    expect((document.activeElement as HTMLElement).classList.contains('local-node')).toBe(true)
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0)
    const stored = JSON.parse(localStorage.getItem('redextape.layout') ?? '{}')
    expect(stored.tmDisplay?.['tm-0']).toEqual({ level: 'local', edges: 'arcs' })
  })

  it('sits at the start of its row at the width the row actually has, not pushed to its end', () => {
    // THE CASE BEFORE THIS ONE ENDS ON THE LOCAL LEVEL, which this needs off: the program level is
    // `.program-level[hidden]` there (`display: none`), so its row, cell and every measured value on
    // them would read 0 — `0 <= 0`, `0 <= 0`, `0 < <indent>` all holding trivially, proving nothing.
    // Switched back to local in a `finally`, since every case after this one expects it shown again —
    // including when an assertion below fails, so that failure stays this case's alone.
    try {
      choice('program')?.click()
      expect(drawn('.program-level')).toBe(true)
      const show = diagram().querySelector<HTMLButtonElement>('.program-show') as HTMLButtonElement
      const cell = show.closest('.program-cell') as HTMLElement
      const step = cell.querySelector('.program-step') as HTMLElement
      // THE PRECONDITION: at the file's own 1280px width this row's sub-steps fit, so nothing here forces
      // it to overflow — an `auto` margin pushing the button to the row's end would draw it flush right,
      // past every step, rather than before the first one.
      expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth)
      expect(show.getBoundingClientRect().right).toBeLessThanOrEqual(step.getBoundingClientRect().left)
      // Inside the cell's own `padding-inline-start: 5ch` indent, not out past it — read from the computed
      // style rather than a hardcoded pixel count, since 5ch is a font-metric-dependent width.
      const indent = Number.parseFloat(getComputedStyle(cell).paddingInlineStart)
      expect(show.getBoundingClientRect().left - cell.getBoundingClientRect().left).toBeLessThan(indent + 10)
    } finally {
      choice('local')?.click()
    }
  })

  it('draws the current state in column 0 and its neighbours at signed distances', () => {
    const current = nodes().filter((n) => n.getAttribute('aria-current') === 'step')
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toBe(status().split(' ')[0])
    expect(current[0]?.dataset.column).toBe('0')
    const columns = new Set(nodes().map((n) => Number(n.dataset.column)))
    expect([...columns].every((c) => c >= -2 && c <= 2)).toBe(true)
    // A state inside a gadget has a way in and a way on.
    expect([...columns].some((c) => c < 0)).toBe(true)
    expect([...columns].some((c) => c > 0)).toBe(true)
  })

  it("labels its edges with the tapes their rules touch, and marks the next rule's", () => {
    const labels = [...diagram().querySelectorAll('.local-label')].map((l) => l.textContent ?? '')
    expect(labels.length).toBeGreaterThan(0)
    // Each label is a list of `tape:read…` or `*`, never a tape the rule leaves alone.
    for (const label of labels) {
      for (const part of label.split(', ')) expect(part).toMatch(/^(\*|([A-Z]+:\S+( [LR])?)( [A-Z]+:\S+( [LR])?)*)$/)
    }
    expect(diagram().querySelectorAll('.local-edge.is-next')).toHaveLength(1)
  })

  it("says each node's distance and edges, since the drawing of them is hidden from a reader", () => {
    const current = nodes().find((n) => n.getAttribute('aria-current') === 'step') as HTMLElement
    const said = current.getAttribute('aria-description') ?? ''
    expect(said).toMatch(/^the current state; to /)
    expect(said).toMatch(/, fires next/)
    const behind = nodes().find((n) => Number(n.dataset.column) === -1) as HTMLElement
    expect(behind.getAttribute('aria-description')).toMatch(/^1 rule behind/)
  })

  it('keeps the focus on a node while the run moves the level', async () => {
    nodes()
      .find((n) => n.tabIndex === 0)
      ?.focus()
    await stepUntilStateChanges()
    await frame()
    expect((document.activeElement as HTMLElement).classList.contains('local-node')).toBe(true)
  })

  it('lays out nothing while its panel is closed, and lays out for its width once it opens', async () => {
    const toggle = diagram().querySelector('.panel-toggle') as HTMLButtonElement
    toggle.click()
    let mutations = 0
    const watch = new MutationObserver((records) => {
      mutations += records.length
    })
    watch.observe(diagram().querySelector('.local-nodes') as HTMLElement, { childList: true, subtree: true })
    for (let i = 0; i < 3; i += 1) await stepUntilStateChanges()
    await frame()
    watch.disconnect()
    expect(mutations).toBe(0)
    toggle.click()
    await until(() => nodes().some((n) => n.textContent === status().split(' ')[0]), 'the level at the current state')
    const level = diagram().querySelector('.local-level') as HTMLElement
    const svg = diagram().querySelector('.local-edges') as SVGSVGElement
    expect(Number(svg.getAttribute('width'))).toBe(Math.max(level.clientWidth, 750))
  })

  it('lays out again for a width it was not laid out for, with the state unchanged', async () => {
    const level = diagram().querySelector('.local-level') as HTMLElement
    const svg = diagram().querySelector('.local-edges') as SVGSVGElement
    const before = Number(svg.getAttribute('width'))
    await page.viewport(1000, 2400)
    await until(() => level.clientWidth < before, 'the view to narrow')
    await frame()
    await frame()
    expect(Number(svg.getAttribute('width'))).toBe(Math.max(level.clientWidth, 750))
    expect(Number(svg.getAttribute('width'))).toBeLessThan(before)
    await page.viewport(1280, 2400)
  })

  it('is one tab stop whose arrows move between states, and links the one Enter is on', async () => {
    const stops = nodes().filter((n) => n.tabIndex === 0)
    expect(stops).toHaveLength(1)
    stops[0]?.focus()
    await userEvent.keyboard('{ArrowLeft}')
    const moved = document.activeElement as HTMLElement
    expect(moved.classList.contains('local-node')).toBe(true)
    expect(Number(moved.dataset.column)).toBeLessThan(0)
    expect(nodes().filter((n) => n.tabIndex === 0)).toEqual([moved])
    await userEvent.keyboard('{Enter}')
    await until(() => moved.classList.contains('is-linked'), 'the state to be linked')
  })

  it('disables arcs | chips there, and says why', () => {
    for (const value of ['arcs', 'chips']) {
      expect(choice(value)?.disabled).toBe(true)
      expect(choice(value)?.getAttribute('aria-description')).toBe('arcs and chips draw the program level')
    }
    choice('program')?.click()
    expect(drawn('.local-level')).toBe(false)
    expect(drawn('.program-level')).toBe(true)
    expect(choice('arcs')?.disabled).toBe(false)
  })

  it('repaints the next-rule mark every frame, even while the state does not change', async () => {
    // A REAL SELF-LOOP WITH AN EXIT, found two steps after a reset: `wl1s19.s.sk0` scans a register
    // rightward, matching either of its two symbols and marking ITSELF as the rule about to fire, for as
    // long as the register holds one of them — the raw state stays `wl1s19.s.sk0` the whole time, so
    // nothing here re-lays out the level, which lays out when the state changes — until the
    // register's `#` terminator comes under the head, where the OTHER rule becomes the one about to fire,
    // one frame before the state itself finally changes to `wl1s19.s.sk1`.
    choice('local')?.click()
    control('↺')?.click()
    for (let i = 0; i < 2; i += 1) control('▶')?.click()
    await until(() => status().split(' ')[0] === 'wl1s19.s.sk0', 'the scan to begin')
    const current = () => nodes().find((n) => n.getAttribute('aria-current') === 'step') as HTMLElement
    const first = current()
    expect(first.getAttribute('aria-description')).toMatch(/to wl1s19\.s\.sk0 on [^;]*, fires next/)
    for (let i = 0; i < 8; i += 1) {
      control('▶')?.click()
      // Still scanning: a relayout here would mean the level rebuilds every frame, not only on a state
      // change (`localLevel` is not free — §2.3's own measurement is why it is guarded at all).
      expect(status().split(' ')[0]).toBe('wl1s19.s.sk0')
    }
    // THE SAME NODE, NOT A REBUILT ONE — proving the mark below changed by repainting, not by laying out
    // the level again from a `localLevel` that finally saw a different rule.
    const last = current()
    expect(last).toBe(first)
    expect(last.getAttribute('aria-description')).toMatch(/to wl1s19\.s\.sk1 on [^;]*, fires next/)
    expect(last.getAttribute('aria-description')).not.toMatch(/to wl1s19\.s\.sk0 on [^;]*, fires next/)
    // WHICH PATH IS MARKED, NOT ONLY HOW MANY: a mark frozen at the first layout also leaves exactly one
    // path with `is-next` — the stale self-loop, never joined by a second — so a bare length check cannot
    // tell a repaint from a freeze. Its target is the exit state's own id, not the self-loop's.
    const exit = nodes().find((n) => n.textContent === 'wl1s19.s.sk1') as HTMLElement
    const marked = [...diagram().querySelectorAll<SVGPathElement>('.local-edge.is-next')]
    expect(marked).toHaveLength(1)
    expect(marked[0]?.dataset.to).toBe(exit.dataset.state)
    expect(marked[0]?.dataset.from).not.toBe(marked[0]?.dataset.to)
  })
})

describe('a machine with no program level (spec §7)', () => {
  it('shows the local level alone, with program disabled and its reason stated', async () => {
    pane().querySelector<HTMLButtonElement>('button.detach')?.click()
    const editor = await (async () => {
      await until(() => pane().querySelector('.term-editor .cm-editor') !== null, 'the copy to mount its editor')
      return pane().querySelector('.term-editor .cm-content') as HTMLElement
    })()
    const copy = (await import('@codemirror/view')).EditorView.findFromDOM(editor)
    copy?.dispatch({ changes: { from: 0, to: copy.state.doc.length, insert: FLAT } })
    await until(() => nodes().some((n) => n.textContent === 'q0'), 'the copy to compile and draw q0')
    expect(choice('program')?.disabled).toBe(true)
    expect(choice('program')?.getAttribute('aria-description')).toMatch(/no program level/)
    expect(choice('local')?.getAttribute('aria-checked')).toBe('true')
    expect(drawn('.program-level')).toBe(false)
    // The keys pass over the choice that cannot be made: an arrow from `local` finds nothing to move to, and the
    // stored level is not changed behind the reader's back. Chosen first, so the level stored is `local` and a key
    // that landed on `program` would show.
    choice('local')?.click()
    const before = JSON.parse(localStorage.getItem('redextape.layout') ?? '{}').tmDisplay?.['tm-0']
    expect(before?.level).toBe('local')
    choice('local')?.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(choice('local'))
    expect(JSON.parse(localStorage.getItem('redextape.layout') ?? '{}').tmDisplay?.['tm-0']).toEqual(before)
  })
})

describe('a recompile that changes the level shown', () => {
  /** The copy's editor, which the case above mounted. A dispatch to it is an edit that leaves the focus where it is. */
  const copy = async () => {
    const { EditorView } = await import('@codemirror/view')
    return EditorView.findFromDOM(pane().querySelector('.term-editor .cm-content') as HTMLElement) as EditorView
  }
  const grid = () => diagram().querySelector('.program-scroll') as HTMLElement

  it('hands the focus from the program level to the local one when the new machine has no program level', async () => {
    ;(await copy()).dispatch({ changes: { from: 0, to: (await copy()).state.doc.length, insert: DOTTED } })
    await until(() => choice('program')?.disabled === false, 'the dotted copy to compile, with a program level')
    choice('program')?.click()
    await until(() => drawn('.program-level') && diagram().querySelector('.program-row') !== null, 'its rows')
    grid().focus()
    expect(document.activeElement).toBe(grid())
    ;(await copy()).dispatch({ changes: { from: 0, to: (await copy()).state.doc.length, insert: FLAT } })
    await until(() => nodes().some((n) => n.textContent === 'q0'), 'the flat copy to compile and draw q0')
    expect(drawn('.program-level')).toBe(false)
    // The grid is hidden under it, and a hidden element's focus falls to the page.
    expect(document.activeElement).not.toBe(document.body)
    expect((document.activeElement as HTMLElement).classList.contains('local-node')).toBe(true)
  })

  it('hands it back to the grid when the next machine has one again', async () => {
    // Still `program` as stored — the flat machine showed the local level without choosing it.
    const node = nodes().find((n) => n.tabIndex === 0) as HTMLElement
    node.focus()
    expect(document.activeElement).toBe(node)
    ;(await copy()).dispatch({ changes: { from: 0, to: (await copy()).state.doc.length, insert: DOTTED } })
    // NOT BY ITS ROWS: the flat machine left the dotted one's in the hidden level, where nothing draws.
    await until(() => drawn('.program-level'), 'the dotted copy to compile and show its program level')
    expect(drawn('.local-level')).toBe(false)
    expect(document.activeElement).toBe(grid())
  })
})
