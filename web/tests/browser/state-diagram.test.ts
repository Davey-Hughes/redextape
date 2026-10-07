import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { intoCmpeq, SHELL, tmWalk, until, walkInParts } from './harness'

/**
 * The state diagram's program level (Plan 7 part 4, spec §8 and amendments 9 and 11), on `fact(3)`: 21 instructions,
 * four labels, and a shared return handler billed to none of them.
 *
 * THE RULES PANEL IS CLOSED, so the diagram takes the view's height and the whole listing is drawn: the arc count
 * below is the program's, not a window's.
 */

let view: EditorView

const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'
/** `fact(3)`'s states, `grep -c '^state '` over its emitted machine (spec §14.1). */
const STATES = 1199

const pane = () => document.querySelector('[data-leaf="tm-0"]') as HTMLElement
const diagram = () => pane().querySelector('[data-panel="diagram"]') as HTMLElement
const grid = () => diagram().querySelector('.program-scroll') as HTMLElement
const rows = () => [...diagram().querySelectorAll<HTMLElement>('.program-row')]
const groupRows = () => rows().filter((r) => r.querySelector('.program-name') !== null)
const rowNamed = (name: string) => groupRows().find((r) => r.querySelector('.program-name')?.textContent === name)
const boxes = () => [...diagram().querySelectorAll<HTMLElement>('.program-box')]
const status = () => pane().querySelector('.tm-status')?.textContent ?? ''
const control = (label: string) =>
  [...pane().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
/**
 * From step 0 to the first step inside `cmpeq` — 1,732 steps forward, where stepping back from the frontier took
 * about 9,000, one redraw each, and ran past the test's time under a full suite's load.
 *
 * **IT RUNS IN HOOKS, THREE OF THEM, NEVER IN A TEST'S BODY.** Each click is a full redraw, so the walk's time is the
 * machine's. On the slower CI runner a body that walked here and then on to `sub` ran past Vitest's 15 s cap, and the
 * walk was moved to a hook, which has its own 30 s; on that runner's slower day the one hook ran past that too
 * (2026-10-06), where under half a CPU it takes 15 s here. So it is three hooks, each with its own 30 s
 * (`harness.ts`' `walkInParts`), and a body keeps only the steps its claim is about.
 */
const cmpeqHooks = (): (() => Promise<void>)[] => intoCmpeq(pane)
const counted = (el: Element) => Number.parseInt(el.querySelector('.program-count')?.textContent ?? '0', 10)
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
const rulesToggle = () =>
  pane().querySelector<HTMLButtonElement>('[data-panel="rules"] .panel-toggle') as HTMLButtonElement
/** Close the rules, so the diagram takes the view and draws the whole listing. */
async function wholeListing(): Promise<void> {
  if (rulesToggle().getAttribute('aria-expanded') === 'true') rulesToggle().click()
  await until(
    () => rows().length > 0 && rows().length === Number(grid().getAttribute('aria-rowcount')),
    'the diagram to draw the whole listing',
  )
}
const edgesChoice = (value: string) =>
  [...diagram().querySelectorAll<HTMLButtonElement>('.diagram-mode')].find((b) => b.dataset.value === value)

beforeAll(async () => {
  await page.viewport(1280, 2400)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FACT3 } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the app to settle')
  // The diagram grows into the rules' share and redraws on the resize that follows: every row, once it has.
  await wholeListing()
})

describe('the program level, drawn as arcs', () => {
  it('lists the program: a row per instruction under its labels, and the runtime routines beside it', () => {
    expect(diagram().querySelector('.panel-toggle')?.getAttribute('aria-expanded')).toBe('true')
    expect(grid().getAttribute('role')).toBe('grid')
    expect(Number(grid().getAttribute('aria-rowcount'))).toBe(rows().length)
    expect(groupRows().map((r) => r.querySelector('.program-name')?.textContent)).toEqual(
      Array.from({ length: 21 }, (_, i) => `pc${i}`),
    )
    expect(
      rows()
        .filter((r) => r.classList.contains('is-label'))
        .map((r) => r.textContent),
    ).toEqual(['fact.0:', 'else2:', 'endif3:', 'skip1:'])
    // A label sits above the instruction it names: `fact.0` above the function's first, `pc1`.
    const at = rows().findIndex((r) => r.textContent === 'fact.0:')
    expect(rows()[at + 1]?.querySelector('.program-name')?.textContent).toBe('pc1')
    expect(rowNamed('pc4')?.querySelector('.program-text')?.textContent).toBe('cmpeq r1, r2, r3')
    expect(boxes().map((b) => b.firstElementChild?.textContent)).toEqual(['halt', 'ret', 'se23', 'rf24', 'dt25'])
    // At the frontier the machine is in `halt`, a routine with no row in *arcs*: its box is what is marked.
    expect(boxes()[0]?.getAttribute('aria-current')).toBe('step')
    expect(diagram().querySelector('.program-row[aria-current]')).toBeNull()
    // Every state is in exactly one row or box, but the overflow guard, which is a badge.
    const total = groupRows().reduce((n, r) => n + counted(r), 0) + boxes().reduce((n, b) => n + counted(b), 0)
    expect(total).toBe(STATES - 1)
  })

  it('draws each jump and call as an arc, and a rule into overflow as a ⚠', () => {
    // `jmp skip1`, `jz r1, else2`, `jmp endif3` and the two `call fact.0`s; every other edge falls through.
    expect(diagram().querySelectorAll('.program-arc')).toHaveLength(5)
    expect(rowNamed('pc0')?.querySelector('.program-warn')).toBeNull()
    const warn = rowNamed('pc4')?.querySelector('.program-warn')
    expect(warn?.getAttribute('aria-label')).toBe('reaches overflow')
  })

  it("keeps the arcs' words on each row for a screen reader, unseen", () => {
    const chips = rowNamed('pc0')?.querySelector('.program-chips') as HTMLElement
    expect(chips.textContent).toBe('→ skip1')
    expect(chips.classList.contains('visually-hidden')).toBe(true)
  })

  it('names each label row by a row header, and every other row by a grid cell', () => {
    const role = (r: HTMLElement) => r.querySelector('.program-cell')?.getAttribute('role')
    const labels = rows().filter((r) => r.classList.contains('is-label'))
    expect(labels).toHaveLength(4)
    expect(labels.map(role)).toEqual(Array(4).fill('rowheader'))
    expect(new Set(groupRows().map(role))).toEqual(new Set(['gridcell']))
  })

  /**
   * THE GUTTER IS DRAWN AGAINST THE ROWS' OWN WINDOW, beside them in the grid's scrolled content: its top and bottom
   * are the drawn rows', and the rows start where it ends, so no arc runs under a row's text.
   */
  it('draws the arcs beside the rows, over the rows it draws, and the rows clear it', () => {
    const gutter = (diagram().querySelector('.program-gutter') as SVGSVGElement).getBoundingClientRect()
    const drawn = rows().map((r) => r.getBoundingClientRect())
    const rowsBox = (diagram().querySelector('.program-rows') as HTMLElement).getBoundingClientRect()
    expect(gutter.width).toBeGreaterThan(0)
    expect(gutter.top).toBe(drawn[0]?.top)
    expect(gutter.bottom).toBe(drawn.at(-1)?.bottom)
    expect(rowsBox.left).toBe(gutter.right)
  })

  describe('inside cmpeq', () => {
    // A step inside `cmpeq`, the first instruction whose gadget has named sub-steps.
    for (const part of cmpeqHooks()) beforeAll(part)

    it('opens the current instruction onto its sub-steps, and follows the run', () => {
      const current = diagram().querySelector('.program-row[aria-current="step"]')
      expect(current?.querySelector('.program-name')?.textContent).toBe('pc4')
      const steps = current?.nextElementSibling
      expect(steps?.classList.contains('is-steps')).toBe(true)
      const now = steps?.querySelector('.program-step.is-now')?.textContent
      // The sub-step marked is the current state's second name segment.
      expect(now).toBe(status().split(' ')[0]?.split('.')[1])
    })
  })

  it("links a row's construct, as a click on the rule table does", async () => {
    rowNamed('pc4')?.click()
    await until(() => document.querySelector('.cm-editor .linked') !== null, 'the source to be linked')
    expect(rowNamed('pc4')?.classList.contains('is-linked')).toBe(true)
  })

  it("moves the grid's active row by key, and links on Enter", async () => {
    grid().focus()
    await userEvent.keyboard('{End}')
    const named = () => document.getElementById(grid().getAttribute('aria-activedescendant') ?? '')
    expect(named()?.closest('.program-row')?.querySelector('.program-name')?.textContent).toBe('pc20')
    await userEvent.keyboard('{Home}')
    expect(named()?.closest('.program-row')?.querySelector('.program-name')?.textContent).toBe('pc0')
    await userEvent.keyboard('{Enter}')
    await until(() => rowNamed('pc0')?.classList.contains('is-linked') === true, 'pc0 to be linked')
  })

  it('detaches following on a scroll, and its header action re-attaches it', async () => {
    const reattach = diagram().querySelector('.diagram-reattach') as HTMLElement
    // Still following after everything above — the rules closing, which grew the diagram and clamped its scroll,
    // and every step back: none of it was the user scrolling.
    expect(reattach.hidden).toBe(true)
    // The rules open again, so the listing is taller than the diagram and there is somewhere to scroll to. Two
    // frames on, the resize has been drawn — a user's scroll cannot land sooner — and was not read as a scroll.
    rulesToggle().click()
    await until(() => grid().scrollHeight > grid().clientHeight, 'the diagram to shrink under its listing')
    await frame()
    await frame()
    expect(reattach.hidden).toBe(true)
    grid().scrollTop = grid().scrollTop === 0 ? grid().scrollHeight : 0
    await until(() => !reattach.hidden, 'following to detach')
    reattach.click()
    expect(reattach.hidden).toBe(true)
  })
})

describe('the program level, drawn as chips', () => {
  it('writes each row its edges and gives the runtime routines rows of their own, and keeps the choice', async () => {
    await wholeListing()
    edgesChoice('chips')?.click()
    await wholeListing()
    expect(edgesChoice('chips')?.getAttribute('aria-checked')).toBe('true')
    expect(diagram().querySelector('.program-side')?.hasAttribute('hidden')).toBe(true)
    expect(diagram().querySelectorAll('.program-arc')).toHaveLength(0)
    const chips = rowNamed('pc0')?.querySelector('.program-chips') as HTMLElement
    expect(chips.classList.contains('visually-hidden')).toBe(false)
    expect(rows().some((r) => r.classList.contains('is-heading') && r.textContent === 'runtime')).toBe(true)
    // The return dispatch goes back to the instruction after each call, and only `ret` reaches it.
    const dt25 = [...(rowNamed('dt25')?.querySelectorAll('.program-chip') ?? [])].map((c) => c.textContent)
    expect(dt25).toEqual(['→ pc14 pc20', '← ret'])
    const stored = JSON.parse(localStorage.getItem('redextape.layout') ?? '{}')
    expect(stored.tmDisplay?.['tm-0']).toEqual({ level: 'program', edges: 'chips' })
    edgesChoice('arcs')?.click()
    expect(diagram().querySelectorAll('.program-arc').length).toBeGreaterThan(0)
  })

  it('names the runtime heading by a row header', async () => {
    edgesChoice('chips')?.click()
    // *ARCS* AGAIN WHATEVER THIS CASE FINDS: the cases after it are about *arcs*' runtime column.
    try {
      await wholeListing()
      const heading = rows().find((r) => r.classList.contains('is-heading')) as HTMLElement
      expect(heading.textContent).toBe('runtime')
      expect(heading.querySelector('.program-cell')?.getAttribute('role')).toBe('rowheader')
    } finally {
      edgesChoice('arcs')?.click()
      await wholeListing()
    }
  })
})

describe('the program level through a moving run', () => {
  const named = () =>
    document
      .getElementById(grid().getAttribute('aria-activedescendant') ?? '')
      ?.closest('.program-row')
      ?.querySelector('.program-name')?.textContent
  async function stepUntil(pattern: RegExp): Promise<void> {
    for (let i = 0; i < 20_000 && !pattern.test(status()); i += 1) control('▶')?.click()
    await until(() => pattern.test(status()), `the machine to reach ${pattern}`)
  }

  describe('with the active row on pc10 and the run inside cmpeq', () => {
    /** The active row onto pc10, by the keyboard. */
    const ontoPc10 = async (): Promise<void> => {
      grid().focus()
      await userEvent.keyboard('{Home}')
      for (let i = 0; i < 30 && named() !== 'pc10'; i += 1) await userEvent.keyboard('{ArrowDown}')
    }
    // A HOOK EACH, IN THIS ORDER: the whole listing, the walk's three parts, the active row. They were one hook.
    for (const hook of [wholeListing, ...cmpeqHooks(), ontoPc10]) beforeAll(hook)

    it('starts with the active row on pc10 and the run in pc4’s gadget', () => {
      expect(named()).toBe('pc10')
      expect(diagram().querySelector('.program-row[aria-current="step"] .program-name')?.textContent).toBe('pc4')
    })

    /**
     * **THE WALK ON TO `sub` IS IN HOOKS TOO, TWO OF THEM**: 1,104 clicks, from pc4's gadget to pc11's, which as the
     * middle of one case's body took 9.9 s of its 15 under half a CPU here, and 11.1 s on CI on the day the walk into
     * `cmpeq` timed out there (2026-10-06). What the case held before the walk is the case above, and what it held
     * after is the one below; the machine and the active row are where they were for each.
     */
    describe('once the run is inside sub', () => {
      for (const part of walkInParts(tmWalk(pane, /^sub/, 'inside sub'), [552])) beforeAll(part)

      it('keeps the active row on its row when the sub-steps row moves past it', () => {
        // From pc4's gadget to pc11's: the sub-steps row moved from above pc10 to below it.
        expect(diagram().querySelector('.program-row[aria-current="step"] .program-name')?.textContent).toBe('pc11')
        expect(named()).toBe('pc10')
      })
    })
  })

  it("keeps a runtime box's focus while the run moves, and the column is one tab stop", async () => {
    expect(boxes().filter((b) => b.tabIndex === 0)).toHaveLength(1)
    boxes()[0]?.focus()
    await userEvent.keyboard('{ArrowDown}')
    const box = document.activeElement
    expect(box).toBe(boxes()[1])
    const at = status()
    await stepUntil(/^mv|^mul|^pc/)
    expect(status()).not.toBe(at)
    expect(document.activeElement).toBe(box)
    expect(boxes().filter((b) => b.tabIndex === 0)).toEqual([box])
  })

  it('scrolls to follow the current row when the listing is taller than the diagram', async () => {
    rulesToggle().click()
    await until(() => grid().scrollHeight > grid().clientHeight, 'the diagram to shrink under its listing')
    control('↺')?.click()
    // The frame push of the call at pc19, near the listing's end.
    await stepUntil(/^pf21/)
    await frame()
    const row = diagram().querySelector('.program-row[aria-current="step"]') as HTMLElement
    expect(row.querySelector('.program-name')?.textContent).toBe('pc19')
    const box = grid().getBoundingClientRect()
    const at = row.getBoundingClientRect()
    expect(at.top).toBeGreaterThanOrEqual(box.top)
    expect(at.bottom).toBeLessThanOrEqual(box.bottom)
    expect(grid().scrollTop).toBeGreaterThan(0)
  })

  it('stays following when a panel beside it closes and its scroll is clamped', async () => {
    const reattach = diagram().querySelector('.diagram-reattach') as HTMLElement
    expect(reattach.hidden).toBe(true)
    const before = grid().scrollTop
    rulesToggle().click()
    await frame()
    await frame()
    // The diagram grew past its listing, so the browser clamped its scroll; that was not the user scrolling.
    expect(grid().scrollTop).toBeLessThan(before)
    expect(reattach.hidden).toBe(true)
  })
})
