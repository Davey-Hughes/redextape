import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import type { Listing, McTarget } from '../../src/protocol'
import { compile, host, PREFIX, SHELL, scrollHeldAt, sourceLinked, until } from './harness'
import { codePanelOf, targetChoice } from './mc-fixture'

/**
 * LINKING AND THE RUN'S MARKS THROUGH THE MACHINE CODE PANEL (machine code panel design §4, *Links* and *Following*,
 * §8 *Links and following*): a machine row with a pc pins its rxm instruction, which marks the clif rows and every
 * machine row of that pc; an rxm instruction or a clif row pinned marks the machine rows of its pc, in both listings
 * and on both targets; and the machine rows of the clif instruction about to run are marked current through a step,
 * ↺, a listing switch, a target switch and a keystroke's recompile, a current row that is also linked showing both
 * marks. Read off the rows as drawn, scrolled through a box at a time, since each listing draws only the rows in view.
 */

const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
/** `FACT` with one more addition in `$main`: a program of its own, whose run starts again. */
const FACT_PLUS = `${FACT.trimEnd()} + 1\n`
/** `style.css`'s row height, which the listings' virtual grid lays its rows out by. */
const ROW = 24
/** Each long case's own bound, past every wait in it. */
const CASE_MS = 90_000
/** The setup's bound: it compiles, opens the clif view and its panel, and waits for the code to show. */
const SETUP_MS = 60_000

let view: EditorView

/** A listing row as it was drawn: its pc column and its marks. */
type Row = {
  readonly pc: string
  /** Whether it is an instruction's row, which a press links, and not a label's. */
  readonly inst: boolean
  readonly linked: boolean
  readonly current: boolean
  readonly next: boolean
}

const clif = () => host('clif-0') as HTMLElement
const rxm = () => host('rxm-0') as HTMLElement
/** The three listings, each a box of rows. */
const BOXES = {
  rxm: () => rxm().querySelector<HTMLElement>('.rxm-listing') as HTMLElement,
  clif: () => clif().querySelector<HTMLElement>('[data-panel="listing"] .clif-listing') as HTMLElement,
  code: () => codePanelOf(clif()).querySelector<HTMLElement>('.mc-listing') as HTMLElement,
}
type Box = keyof typeof BOXES
const rowAt = (box: Box, row: number) =>
  BOXES[box]().querySelector<HTMLElement>(`[aria-rowindex="${row + 1}"].${box === 'rxm' ? 'rxm' : 'clif'}-row`)
const stepOf = () => clif().querySelector('.step')?.textContent ?? ''
const control = (name: string) =>
  clif().querySelector<HTMLButtonElement>(`.controls button[aria-label="${name}"]`) as HTMLButtonElement
const title = () => codePanelOf(clif()).querySelector('.mc-title')?.textContent ?? ''
/** The pc column of the clif row about to run. */
const nextPc = () => BOXES.clif().querySelector('.clif-row.is-next .rxm-pc')?.textContent ?? null

/** Every row of `box`, by its index, read by scrolling it through from its top a box at a time. */
async function scan(box: Box): Promise<Map<number, Row>> {
  const el = BOXES[box]()
  const count = Number(el.getAttribute('aria-rowcount'))
  const step = Math.max(1, Math.floor(el.clientHeight / ROW) - 1)
  const rows = new Map<number, Row>()
  for (let top = 0; top < count; top += step) {
    const last = Math.min(top + step - 1, count - 1)
    await until(
      () => scrollHeldAt(el, top * ROW) && rowAt(box, top) !== null && rowAt(box, last) !== null,
      `the ${box} listing to draw rows ${top} to ${last}`,
    )
    for (const r of el.querySelectorAll<HTMLElement>('[aria-rowindex]')) {
      rows.set(Number(r.getAttribute('aria-rowindex')) - 1, {
        pc: r.querySelector('.rxm-pc')?.textContent ?? '',
        inst: box !== 'code' || r.querySelector('.mc-offset') !== null,
        linked: r.classList.contains('is-linked'),
        current: r.classList.contains('is-current'),
        next: r.classList.contains('is-next'),
      })
    }
  }
  expect(rows.size, `every row of the ${box} listing read`).toBe(count)
  return rows
}

/** The indices of `rows` that `keep` keeps, in listing order. */
const where = (rows: ReadonlyMap<number, Row>, keep: (r: Row) => boolean): number[] =>
  [...rows]
    .filter(([, r]) => keep(r))
    .map(([i]) => i)
    .sort((a, b) => a - b)

/** Scroll `box` to `row`, two rows below its top, and press it as a user does. */
async function press(box: Box, row: number): Promise<void> {
  await until(
    () => scrollHeldAt(BOXES[box](), Math.max(0, (row - 2) * ROW)) && rowAt(box, row) !== null,
    `the ${box} listing to draw row ${row}`,
  )
  await userEvent.click(rowAt(box, row) as HTMLElement)
}

/** The first row of `box` whose pc column reads `pc`. */
async function rowOf(box: Box, pc: number): Promise<number> {
  const [row] = where(await scan(box), (r) => r.pc === `pc${pc}`)
  if (row === undefined) throw new Error(`no ${box} row reads pc${pc}`)
  return row
}

/** Put the panel back on the run, where a scan scrolled it away. */
async function follow(): Promise<void> {
  for (const panel of ['listing', 'code']) {
    const reattach = clif().querySelector<HTMLButtonElement>(`.panel[data-panel="${panel}"] .table-reattach`)
    if (reattach !== null && !reattach.hidden) await userEvent.click(reattach)
  }
}

/**
 * Clear the pin by pressing a machine instruction with no pc, as a clif row with no srcloc clears it, so that the next
 * press is seen to pin: a press of a row of the pc already pinned would leave the marks as they were.
 */
async function clear(): Promise<void> {
  const row = where(await scan('code'), (r) => r.inst && r.pc === '')[0]
  if (row === undefined) throw new Error('no machine instruction without a pc')
  await press('code', row)
  await until(() => sourceLinked() === null, 'a press of a machine row with no pc to clear the pin')
  expect(BOXES.code().querySelectorAll('.clif-row.is-linked').length, 'precondition: no machine row linked').toBe(0)
}

/** The four listings the panel shows: each listing on each target. */
const SHOWN = [
  ['as-built', 'x86-64'],
  ['as-built', 'arm64'],
  ['optimised', 'x86-64'],
  ['optimised', 'arm64'],
] as const

/** Show `listing` on `target`, and wait until the panel shows its rows. */
async function show(listing: Listing, target: McTarget): Promise<void> {
  const choice = clif().querySelector<HTMLButtonElement>(
    `.view-actions [role="radiogroup"] button[data-value="${listing}"]`,
  ) as HTMLButtonElement
  if (choice.getAttribute('aria-checked') !== 'true') await userEvent.click(choice)
  if (targetChoice(clif(), target).getAttribute('aria-checked') !== 'true')
    await userEvent.click(targetChoice(clif(), target))
  const words = `${target} · ${listing === 'as-built' ? 'as built' : 'optimised'}`
  await until(() => title() === words && BOXES.code().querySelector('.clif-row') !== null, `the panel to show ${words}`)
  // BACK ON THE RUN, where a scan scrolled either box away, ONCE THE NEW ROWS ARE IN: rows of a new listing or target
  // put the panel back on the run themselves, taking the re-attach away under a press already aimed at it.
  await follow()
}

/**
 * Whether the drawn machine rows marked current are exactly the drawn rows of the pc of the clif instruction about to
 * run, at least one of them drawn when that pc has machine code: `null` when so, else what is wrong.
 */
function currentWrong(): string | null {
  const pc = nextPc()
  if (pc === null) return 'no clif row about to run'
  const drawn = [...BOXES.code().querySelectorAll<HTMLElement>('.clif-row')]
  const ofPc = drawn.filter((r) => pc !== '' && r.querySelector('.rxm-pc')?.textContent === pc)
  const current = drawn.filter((r) => r.classList.contains('is-current'))
  if (current.some((r) => !ofPc.includes(r))) return `a current row not of ${pc}`
  if (ofPc.some((r) => !r.classList.contains('is-current'))) return `a row of ${pc} not current`
  return null
}

/** Wait until the current rows are the run's, then say so: `what` names the moment for a failure. */
async function currentFollows(what: string, ofCode = true): Promise<void> {
  await until(() => currentWrong() === null, `the machine rows marked current to be the run's ${what}`)
  if (ofCode)
    expect(
      BOXES.code().querySelectorAll('.clif-row.is-current').length,
      `${what}: current rows drawn for ${nextPc()}`,
    ).toBeGreaterThan(0)
}

/** Step forward until the clif instruction about to run has `least` machine rows drawn, and say its pc. */
async function toCode(least = 1): Promise<string> {
  for (let n = 0; n < 60; n += 1) {
    const pc = nextPc() ?? ''
    const ofPc = [...BOXES.code().querySelectorAll<HTMLElement>('.clif-row .rxm-pc')].filter(
      (p) => p.textContent === pc,
    )
    if (pc !== '' && ofPc.length >= least) return pc
    const step = Number(/^step (\d+)/.exec(stepOf())?.[1] ?? Number.NaN)
    await userEvent.click(control('one step forward'))
    await until(() => stepOf().startsWith(`step ${step + 1} of`), `the clif view to reach step ${step + 1}`)
  }
  throw new Error('the clif run reached no instruction with machine code')
}

beforeAll(async () => {
  await page.viewport(1280, 1600)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await compile(view, FACT)
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a clif view')
  await userEvent.click(codePanelOf(clif()).querySelector('.panel-toggle') as HTMLElement)
  await show('as-built', 'x86-64')
}, SETUP_MS)

describe('linking through the machine code panel', () => {
  it.each(SHOWN)(
    'a machine row links its rxm instruction, the clif rows of its pc and every machine row of it: %s on %s',
    async (listing, target) => {
      await show(listing, target)
      await clear()
      const row = await rowOf('code', 13)
      await press('code', row)
      await until(() => sourceLinked() !== null, 'the source to be linked')
      const rxmRows = await scan('rxm')
      expect(where(rxmRows, (r) => r.linked).map((i) => rxmRows.get(i)?.pc)).toEqual(['pc13'])
      const clifRows = await scan('clif')
      expect(
        where(clifRows, (r) => r.linked),
        'the clif rows of pc 13',
      ).toEqual(where(clifRows, (r) => r.pc === 'pc13'))
      const code = await scan('code')
      const of13 = where(code, (r) => r.pc === 'pc13')
      expect(of13.length, 'precondition: machine rows of pc 13').toBeGreaterThan(0)
      expect(
        where(code, (r) => r.linked),
        'the machine rows of pc 13',
      ).toEqual(of13)
      // WHAT THE USER SEES OF THE MARK: the linked row's dashed left edge, where a row with no pc's is solid.
      const last = of13.at(-1) as number
      const unlinked = where(code, (r) => r.pc === '')[0] as number
      await until(() => scrollHeldAt(BOXES.code(), last * ROW) && rowAt('code', last) !== null, 'the last row of pc 13')
      expect(getComputedStyle(rowAt('code', last) as HTMLElement).borderInlineStartStyle).toBe('dashed')
      await until(
        () => scrollHeldAt(BOXES.code(), unlinked * ROW) && rowAt('code', unlinked) !== null,
        'a row with no pc',
      )
      expect(getComputedStyle(rowAt('code', unlinked) as HTMLElement).borderInlineStartStyle).toBe('solid')
    },
    CASE_MS,
  )

  it(
    'an rxm instruction pinned marks the machine rows of its pc, in both listings and on both targets',
    async () => {
      await show('as-built', 'x86-64')
      await clear()
      await press('rxm', await rowOf('rxm', 13))
      await until(() => sourceLinked() !== null, 'the source to be linked')
      for (const [listing, target] of [
        ['as-built', 'x86-64'],
        ['as-built', 'arm64'],
        ['optimised', 'arm64'],
        ['optimised', 'x86-64'],
      ] as const) {
        await show(listing, target)
        const code = await scan('code')
        const of13 = where(code, (r) => r.pc === 'pc13')
        expect(of13.length, `precondition: machine rows of pc 13, ${listing} on ${target}`).toBeGreaterThan(0)
        expect(
          where(code, (r) => r.linked),
          `${listing} on ${target}`,
        ).toEqual(of13)
      }
    },
    CASE_MS,
  )

  it.each(SHOWN)(
    'a clif row pinned marks the machine rows of its pc: %s on %s',
    async (listing, target) => {
      await show(listing, target)
      await clear()
      await press('clif', await rowOf('clif', 13))
      await until(() => sourceLinked() !== null, 'the source to be linked')
      const code = await scan('code')
      expect(where(code, (r) => r.linked)).toEqual(where(code, (r) => r.pc === 'pc13'))
      expect(where(code, (r) => r.linked).length).toBeGreaterThan(0)
    },
    CASE_MS,
  )
})

describe("the machine code panel's current rows", () => {
  it(
    'are the run’s through a step, ↺, a listing switch, a target switch and a keystroke',
    async () => {
      await show('as-built', 'x86-64')
      await follow()
      await toCode()
      await currentFollows('at an instruction with machine code')
      for (let n = 0; n < 4; n += 1) {
        const step = Number(/^step (\d+)/.exec(stepOf())?.[1] ?? Number.NaN)
        await userEvent.click(control('one step forward'))
        await until(() => stepOf().startsWith(`step ${step + 1} of`), `step ${step + 1}`)
        await currentFollows(`at step ${step + 1}`, false)
      }
      await userEvent.click(control('back to step 0'))
      await until(() => stepOf().startsWith('step 0 of'), 'step 0')
      await currentFollows('after ↺', false)
      await toCode()
      await currentFollows('stepped again after ↺')

      await show('optimised', 'x86-64')
      await follow()
      await currentFollows('after the listing switch', false)
      await toCode()
      await currentFollows('stepped in the optimised listing')

      await show('optimised', 'arm64')
      await currentFollows('after the target switch')

      const before = Number(BOXES.code().getAttribute('aria-rowcount'))
      await compile(view, FACT_PLUS)
      await until(
        () => Number(BOXES.code().getAttribute('aria-rowcount')) !== before && /^step 0 of/.test(stepOf()),
        'the new program’s code and run',
      )
      await follow()
      await currentFollows('after a keystroke’s recompile', false)
      await toCode()
      await currentFollows('stepped in the new program')
      await compile(view, FACT)
    },
    CASE_MS,
  )

  it(
    'show the link’s mark too, on a current row that is also linked',
    async () => {
      await show('as-built', 'x86-64')
      await follow()
      const pc = await toCode(2)
      await currentFollows('at an instruction with machine code')
      await press('rxm', await rowOf('rxm', Number(pc.slice(2))))
      await until(() => BOXES.code().querySelector('.clif-row.is-current.is-linked') !== null, 'a current row linked')
      const both = BOXES.code().querySelector<HTMLElement>('.clif-row.is-current.is-linked:not(.is-next)')
      const plain = BOXES.code().querySelector<HTMLElement>('.clif-row:not(.is-current):not(.is-linked):not(.is-next)')
      if (both === null || plain === null)
        throw new Error('precondition: a current linked row and a plain machine row, both drawn')
      const bg = (el: HTMLElement) => getComputedStyle(el).backgroundColor
      /**
       * What a row of `classes` paints, read off one put beside `both` and taken away: the row with its every mark but
       * the current one (it may be the running focus's too, whose wash is not the current one), and the current mark
       * alone.
       */
      const paints = (classes: string) => {
        const probe = document.createElement('div')
        probe.className = classes
        both.after(probe)
        const painted = bg(probe)
        probe.remove()
        return painted
      }
      const others = [...both.classList].filter((c) => c !== 'is-current').join(' ')
      expect(getComputedStyle(both).borderInlineStartStyle, 'the link’s dashed edge').toBe('dashed')
      expect(bg(both), 'the current wash').toBe(paints('clif-row is-current'))
      expect(bg(both), `the wash of its other marks (${others})`).not.toBe(paints(others))
      expect(bg(both), 'a wash at all').not.toBe(bg(plain))
    },
    CASE_MS,
  )
})
