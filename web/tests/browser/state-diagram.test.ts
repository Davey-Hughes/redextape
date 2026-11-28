import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { ECHO_TOLERANCE, ROW_HEIGHT } from '../../src/state-table'
import {
  activeProgramName,
  control,
  currentRowName,
  diagram,
  diagramBoxes,
  diagramChoice,
  enterWidth,
  frame,
  intoCmpeq,
  programRows,
  programScroll,
  SHELL,
  stateIdle,
  tmPane,
  tmStatus,
  tmStepText,
  tmWalk,
  until,
  walkInParts,
} from './harness'

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

const groupRows = () => programRows().filter((r) => r.querySelector('.program-name') !== null)
const rowNamed = (name: string) => groupRows().find((r) => r.querySelector('.program-name')?.textContent === name)
/**
 * From step 0 to the first step inside `cmpeq` — 1,732 steps forward, where stepping back from the frontier would take
 * about 9,000, one redraw each, and run past the test's time under a full suite's load.
 *
 * **IT RUNS IN HOOKS, THREE OF THEM, NEVER IN A TEST'S BODY.** Each click is a full redraw, so the walk's time is the
 * machine's. On the slower CI runner a body that walked here and then on to `sub` would run past Vitest's 15 s cap, and
 * one hook, which has its own 30 s, past that too. So it is three hooks, each with its own 30 s (`harness.ts`'
 * `walkInParts`), and a body keeps only the steps its claim is about.
 */
const cmpeqHooks = (): (() => Promise<void>)[] => intoCmpeq(tmPane)
const counted = (el: Element) => Number.parseInt(el.querySelector('.program-count')?.textContent ?? '0', 10)
const rulesToggle = () =>
  tmPane().querySelector<HTMLButtonElement>('[data-panel="rules"] .panel-toggle') as HTMLButtonElement
/** Close the rules, so the diagram takes the view and draws the whole listing. */
async function wholeListing(): Promise<void> {
  if (rulesToggle().getAttribute('aria-expanded') === 'true') rulesToggle().click()
  await until(
    () => programRows().length > 0 && programRows().length === Number(programScroll().getAttribute('aria-rowcount')),
    'the diagram to draw the whole listing',
  )
}

beforeAll(async () => {
  await page.viewport(1280, 2400)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FACT3 } })
  await until(stateIdle, 'the app to settle')
  // ON THE LAST STEP, inside `halt`, by `⏭`: a run opens on step 0 (`History`), and these cases start at the frontier.
  tmPane().querySelector<HTMLButtonElement>('.controls button.to-newest')?.click()
  // The diagram grows into the rules' share and redraws on the resize that follows: every row, once it has.
  await wholeListing()
})

describe('the program level, drawn as arcs', () => {
  it('lists the program: a row per instruction under its labels, and the runtime routines beside it', () => {
    expect(diagram().querySelector('.panel-toggle')?.getAttribute('aria-expanded')).toBe('true')
    expect(programScroll().getAttribute('role')).toBe('grid')
    expect(Number(programScroll().getAttribute('aria-rowcount'))).toBe(programRows().length)
    expect(groupRows().map((r) => r.querySelector('.program-name')?.textContent)).toEqual(
      Array.from({ length: 21 }, (_, i) => `pc${i}`),
    )
    expect(
      programRows()
        .filter((r) => r.classList.contains('is-label'))
        .map((r) => r.textContent),
    ).toEqual(['fact.0:', 'else2:', 'endif3:', 'skip1:'])
    // A label sits above the instruction it names: `fact.0` above the function's first, `pc1`.
    const at = programRows().findIndex((r) => r.textContent === 'fact.0:')
    expect(programRows()[at + 1]?.querySelector('.program-name')?.textContent).toBe('pc1')
    expect(rowNamed('pc4')?.querySelector('.program-text')?.textContent).toBe('cmpeq r1, r2, r3')
    expect(diagramBoxes().map((b) => b.firstElementChild?.textContent)).toEqual(['halt', 'ret', 'se23', 'rf24', 'dt25'])
    // At the frontier the machine is in `halt`, a routine with no row in *arcs*: its box is what is marked.
    expect(diagramBoxes()[0]?.getAttribute('aria-current')).toBe('step')
    expect(diagram().querySelector('.program-row[aria-current]')).toBeNull()
    // Every state is in exactly one row or box, but the overflow guard, which is a badge.
    const total = groupRows().reduce((n, r) => n + counted(r), 0) + diagramBoxes().reduce((n, b) => n + counted(b), 0)
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
    const labels = programRows().filter((r) => r.classList.contains('is-label'))
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
    const drawn = programRows().map((r) => r.getBoundingClientRect())
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
      expect(now).toBe(tmStatus().split(' ')[0]?.split('.')[1])
    })
  })

  it("links a row's construct, as a click on the rule table does", async () => {
    rowNamed('pc4')?.click()
    await until(() => document.querySelector('.cm-editor .linked') !== null, 'the source to be linked')
    expect(rowNamed('pc4')?.classList.contains('is-linked')).toBe(true)
  })

  it("moves the grid's active row by key, and links on Enter", async () => {
    programScroll().focus()
    await userEvent.keyboard('{End}')
    const named = () => document.getElementById(programScroll().getAttribute('aria-activedescendant') ?? '')
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
    await until(
      () => programScroll().scrollHeight > programScroll().clientHeight,
      'the diagram to shrink under its listing',
    )
    await frame()
    await frame()
    expect(reattach.hidden).toBe(true)
    // TO THE END FARTHER FROM WHERE FOLLOWING LEFT THE GRID: `Follow` reads a move within `state-table.ts`'s
    // `ECHO_TOLERANCE`, half a row, as the echo of its own write.
    const grid = programScroll()
    const end = grid.scrollHeight - grid.clientHeight
    const to = grid.scrollTop < end / 2 ? end : 0
    expect(Math.abs(to - grid.scrollTop), 'precondition: the scroll moves past the echo tolerance').toBeGreaterThan(
      ECHO_TOLERANCE,
    )
    // ITS `scroll` AT ONCE, AS A WHEEL'S SCROLL COMES, its place and its event together: the browser's own event for
    // a script's write waits for a rendering update, and a reply drawn before it would put the grid, still following,
    // back on its row and read the event as that draw's echo, so the one scroll this case makes would never reach it.
    grid.scrollTop = to
    grid.dispatchEvent(new Event('scroll'))
    await until(() => !reattach.hidden, 'following to detach')
    reattach.click()
    expect(reattach.hidden).toBe(true)
  })
})

describe('the program level, drawn as chips', () => {
  it('writes each row its edges and gives the runtime routines rows of their own, and keeps the choice', async () => {
    await wholeListing()
    diagramChoice('chips')?.click()
    await wholeListing()
    expect(diagramChoice('chips')?.getAttribute('aria-checked')).toBe('true')
    expect(diagram().querySelector('.program-side')?.hasAttribute('hidden')).toBe(true)
    expect(diagram().querySelectorAll('.program-arc')).toHaveLength(0)
    const chips = rowNamed('pc0')?.querySelector('.program-chips') as HTMLElement
    expect(chips.classList.contains('visually-hidden')).toBe(false)
    expect(programRows().some((r) => r.classList.contains('is-heading') && r.textContent === 'runtime')).toBe(true)
    // The return dispatch goes back to the instruction after each call, and only `ret` reaches it.
    const dt25 = [...(rowNamed('dt25')?.querySelectorAll('.program-chip') ?? [])].map((c) => c.textContent)
    expect(dt25).toEqual(['→ pc14 pc20', '← ret'])
    const stored = JSON.parse(localStorage.getItem('redextape.layout') ?? '{}')
    expect(stored.tmDisplay?.['tm-0']).toEqual({ level: 'program', edges: 'chips' })
    diagramChoice('arcs')?.click()
    expect(diagram().querySelectorAll('.program-arc').length).toBeGreaterThan(0)
  })

  it('names the runtime heading by a row header', async () => {
    diagramChoice('chips')?.click()
    // *ARCS* AGAIN WHATEVER THIS CASE FINDS: the cases after it start on the diagram this one leaves, and the one on
    // a runtime box's focus is about *arcs*' runtime column.
    try {
      await wholeListing()
      const heading = programRows().find((r) => r.classList.contains('is-heading')) as HTMLElement
      expect(heading.textContent).toBe('runtime')
      expect(heading.querySelector('.program-cell')?.getAttribute('role')).toBe('rowheader')
    } finally {
      diagramChoice('arcs')?.click()
      await wholeListing()
    }
  })
})

describe('the program level through a moving run', () => {
  async function stepUntil(pattern: RegExp): Promise<void> {
    for (let i = 0; i < 20_000 && !pattern.test(tmStatus()); i += 1) control('▶')?.click()
    await until(() => pattern.test(tmStatus()), `the machine to reach ${pattern}`)
  }

  describe('with the active row on pc10 and the run inside cmpeq', () => {
    /** The active row onto pc10, by the keyboard. */
    const ontoPc10 = async (): Promise<void> => {
      programScroll().focus()
      await userEvent.keyboard('{Home}')
      for (let i = 0; i < 30 && activeProgramName() !== 'pc10'; i += 1) await userEvent.keyboard('{ArrowDown}')
    }
    // A HOOK EACH, IN THIS ORDER: the whole listing, the walk's three parts, the active row.
    for (const hook of [wholeListing, ...cmpeqHooks(), ontoPc10]) beforeAll(hook)

    it('starts with the active row on pc10 and the run in pc4’s gadget', () => {
      expect(activeProgramName()).toBe('pc10')
      expect(diagram().querySelector('.program-row[aria-current="step"] .program-name')?.textContent).toBe('pc4')
    })

    /**
     * **THE WALK ON TO `sub` IS IN HOOKS TOO, TWO OF THEM**: 1,104 clicks, from pc4's gadget to pc11's, which as the
     * middle of one case's body took 11.1 s of its 15 on CI. The case above holds what comes before the walk, and the
     * one below what comes after; the machine and the active row are where they were for each.
     */
    describe('once the run is inside sub', () => {
      for (const part of walkInParts(tmWalk(tmPane, /^sub/, 'inside sub'), [552])) beforeAll(part)

      it('keeps the active row on its row when the sub-steps row moves past it', () => {
        // From pc4's gadget to pc11's: the sub-steps row moved from above pc10 to below it.
        expect(diagram().querySelector('.program-row[aria-current="step"] .program-name')?.textContent).toBe('pc11')
        expect(activeProgramName()).toBe('pc10')
      })
    })
  })

  it("keeps a runtime box's focus while the run moves, and the column is one tab stop", async () => {
    expect(diagramBoxes().filter((b) => b.tabIndex === 0)).toHaveLength(1)
    diagramBoxes()[0]?.focus()
    await userEvent.keyboard('{ArrowDown}')
    const box = document.activeElement
    expect(box).toBe(diagramBoxes()[1])
    const at = tmStatus()
    await stepUntil(/^mv|^mul|^pc/)
    expect(tmStatus()).not.toBe(at)
    expect(document.activeElement).toBe(box)
    expect(diagramBoxes().filter((b) => b.tabIndex === 0)).toEqual([box])
  })

  it('scrolls to follow the current row when the listing is taller than the diagram', async () => {
    rulesToggle().click()
    await until(
      () => programScroll().scrollHeight > programScroll().clientHeight,
      'the diagram to shrink under its listing',
    )
    control('↺')?.click()
    // The frame push of the call at pc19, near the listing's end.
    await stepUntil(/^pf21/)
    await frame()
    const row = diagram().querySelector('.program-row[aria-current="step"]') as HTMLElement
    expect(row.querySelector('.program-name')?.textContent).toBe('pc19')
    const box = programScroll().getBoundingClientRect()
    const at = row.getBoundingClientRect()
    expect(at.top).toBeGreaterThanOrEqual(box.top)
    expect(at.bottom).toBeLessThanOrEqual(box.bottom)
    expect(programScroll().scrollTop).toBeGreaterThan(0)
  })

  it('stays following when a panel beside it closes and its scroll is clamped', async () => {
    const reattach = diagram().querySelector('.diagram-reattach') as HTMLElement
    expect(reattach.hidden).toBe(true)
    const before = programScroll().scrollTop
    rulesToggle().click()
    await frame()
    await frame()
    // The diagram grew past its listing, so the browser clamped its scroll; that was not the user scrolling.
    expect(programScroll().scrollTop).toBeLessThan(before)
    expect(reattach.hidden).toBe(true)
  })

  describe('at the end of the run', () => {
    /** `fact(3)`'s `halt` instruction, the last of its 21, which enters the machine's `halt` state. */
    const HALT = 'pc20'
    const reattach = () => diagram().querySelector('.diagram-reattach') as HTMLElement
    /**
     * Whether `name`'s row is drawn inside the program level's box, where the user sees it. **WITHIN 2 PX**: Firefox
     * lays the box out at a fractional place and gives it a whole-pixel scroll range, so its furthest scroll can leave
     * the last row, which the halt is, a part of a pixel under the box's edge.
     */
    function inView(name: string): boolean {
      const row = rowNamed(name)
      if (row === undefined) return false
      const r = row.getBoundingClientRect()
      const box = programScroll().getBoundingClientRect()
      return r.top >= box.top - 2 && r.bottom <= box.bottom + 2
    }
    const atEnd = () => {
      const m = /^step ([\d,]+) of ([\d,]+)$/.exec(tmStepText())
      return m !== null && m[1] === m[2]
    }
    /** The names on the runtime boxes marked as the current step. */
    const currentBoxes = () =>
      diagramBoxes()
        .filter((b) => b.getAttribute('aria-current') === 'step')
        .map((b) => b.firstElementChild?.textContent)
    /** The rules open, so the listing is taller than the diagram, and the run back on step 0. */
    async function tallAtStepZero(): Promise<void> {
      if (rulesToggle().getAttribute('aria-expanded') !== 'true') rulesToggle().click()
      await until(
        () => programScroll().scrollHeight > programScroll().clientHeight,
        'the diagram to shrink under its listing',
      )
      control('↺')?.click()
      await until(() => tmStepText().startsWith('step 0 of ') && currentRowName() === 'pc0', 'the run back on step 0')
      await frame()
    }
    async function toEnd(): Promise<void> {
      tmPane().querySelector<HTMLButtonElement>('.controls button.to-newest')?.click()
      await until(() => atEnd() && currentBoxes()[0] === 'halt', 'the run on its last step, in halt')
      await frame()
    }

    // ⏭ FROM STEP 0 DRAWS THE END AND NO STEP BETWEEN, and there the machine is in `halt`, a routine *arcs* draws as a
    // box beside the rows: the end's own draw must bring the instruction that entered it into view.
    it('scrolls the instruction the run halted at into view, marking it as nothing', async () => {
      await tallAtStepZero()
      expect(inView(HALT), 'precondition: the halt instruction out of view at step 0').toBe(false)
      await toEnd()
      expect(inView(HALT), 'the halt instruction in view at the end').toBe(true)
      expect(currentRowName(), 'no row current at the end').toBeUndefined()
      expect(rowNamed(HALT)?.classList.contains('is-current')).toBe(false)
      expect(currentBoxes()).toEqual(['halt'])
    })

    it('leaves a program level the user scrolled away where they left it, and "follow current state" brings the end into view', async () => {
      await tallAtStepZero()
      const grid = programScroll()
      // ITS `scroll` AT ONCE, as the case on detaching above says why.
      grid.scrollTop += 2 * ROW_HEIGHT
      grid.dispatchEvent(new Event('scroll'))
      await until(() => !reattach().hidden, 'following to detach')
      const left = grid.scrollTop
      await toEnd()
      expect(grid.scrollTop, 'the box where the user left it').toBe(left)
      expect(inView(HALT), 'the halt instruction out of view while detached').toBe(false)
      expect(reattach().hidden, 'follow current state still offered').toBe(false)
      reattach().click()
      expect(reattach().hidden).toBe(true)
      await frame()
      expect(inView(HALT), 'the halt instruction in view once following again').toBe(true)
    })

    /**
     * NOT BEFORE THE END: at the first step inside `ret`, which pc16's `ret` enters, the run is still going, and a step
     * inside a routine is followed nowhere though the step before it has a row. It is far back from the end, so the walk
     * there by `◀` runs in hooks of its own.
     */
    describe('a step into a routine before it', () => {
      const ENTERED_FROM = 'pc16'
      const intoRet = /^ret · /
      const back = (most: number) => () => {
        for (let i = 0; i < most && !intoRet.test(tmStatus()); i += 1) control('◀')?.click()
      }
      const atEndOfTall = async (): Promise<void> => {
        await tallAtStepZero()
        await toEnd()
      }
      const arrived = () =>
        until(() => intoRet.test(tmStatus()), 'the first step inside ret, walking back from the end')
      for (const hook of [atEndOfTall, back(600), back(1_000), arrived]) beforeAll(hook)

      it('follows no row there, though the step before is in one', async () => {
        expect(currentBoxes(), 'precondition: the run inside ret').toEqual(['ret'])
        control('◀')?.click()
        expect(currentRowName(), 'precondition: the step before in the instruction that entered ret').toBe(ENTERED_FROM)
        control('▶')?.click()
        expect(intoRet.test(tmStatus())).toBe(true)
        const grid = programScroll()
        grid.scrollTop = 0
        grid.dispatchEvent(new Event('scroll'))
        await until(() => !reattach().hidden, 'following to detach')
        expect(inView(ENTERED_FROM), 'precondition: the instruction out of view').toBe(false)
        reattach().click()
        await frame()
        expect(inView(ENTERED_FROM), 'the instruction still out of view once following again').toBe(false)
        expect(grid.scrollTop).toBe(0)
        expect(currentBoxes()).toEqual(['ret'])
      })
    })

    /**
     * A RUN THAT STOPS IN THE OVERFLOW GUARD: `fact(3)` at a pinned width of 4 cells outgrows its fields in pc15, whose
     * rule enters `overflow`, a state with no row or box of its own. The width goes back to auto after, so a case added
     * below this block runs on the machine the file's other cases do.
     */
    describe('in the overflow guard', () => {
      const STOPPED = 'pc15'
      beforeAll(async () => {
        await enterWidth('4')
        await until(stateIdle, 'the compile at width 4')
      })
      afterAll(async () => {
        await enterWidth('auto')
        await until(stateIdle, 'the compile at auto')
      })
      async function toGuard(): Promise<void> {
        tmPane().querySelector<HTMLButtonElement>('.controls button.to-newest')?.click()
        await until(() => atEnd() && /^overflow\b/.test(tmStatus()), 'the run on its last step, in the overflow guard')
        await frame()
      }

      it('scrolls the instruction the run stopped in into view, marking it as nothing', async () => {
        await tallAtStepZero()
        expect(inView(STOPPED), 'precondition: the instruction out of view at step 0').toBe(false)
        await toGuard()
        expect(inView(STOPPED), 'the instruction in view at the end').toBe(true)
        expect(currentRowName(), 'no row current at the end').toBeUndefined()
        expect(rowNamed(STOPPED)?.classList.contains('is-current')).toBe(false)
        expect(currentBoxes(), 'no box current at the end').toEqual([])
        const atTheEnd = programScroll().scrollTop
        // The row the step before the end is in, which `◀` marks, is the one the end followed. THE SAME PLACE, NOT ONLY
        // IN VIEW: following centres its row, so a neighbouring row followed at the end is in view too, and only the
        // scroll ◀ leaves alone tells the two apart.
        control('◀')?.click()
        await until(() => currentRowName() !== undefined, 'the step before the end')
        expect(currentRowName()).toBe(STOPPED)
        await frame()
        expect(programScroll().scrollTop, 'the box where the end left it').toBe(atTheEnd)
      })

      it('leaves a program level the user scrolled away where they left it, and "follow current state" brings the end into view', async () => {
        await tallAtStepZero()
        const grid = programScroll()
        grid.scrollTop += 2 * ROW_HEIGHT
        grid.dispatchEvent(new Event('scroll'))
        await until(() => !reattach().hidden, 'following to detach')
        const left = grid.scrollTop
        await toGuard()
        expect(grid.scrollTop, 'the box where the user left it').toBe(left)
        expect(inView(STOPPED), 'the instruction out of view while detached').toBe(false)
        expect(reattach().hidden, 'follow current state still offered').toBe(false)
        reattach().click()
        expect(reattach().hidden).toBe(true)
        await frame()
        expect(inView(STOPPED), 'the instruction in view once following again').toBe(true)
      })
    })
  })
})
