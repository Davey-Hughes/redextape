import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cdp, page, userEvent } from 'vitest/browser'
import init, { compile as compileSession, tapeNames } from '../../../pkg/redextape_wasm.js'
import { EXAMPLES } from '../../src/examples'
import { codeLines, type Line, lineText } from '../../src/lambda-layout'
import { Tree } from '../../src/lambda-tree'
import { heapPanel } from '../../src/machine-panels'
import { TM_RADIUS } from '../../src/protocol'
import type { TmProgram, TmState } from '../../src/types'
import { wireOf } from '../node/tree-fixture'
import { chromiumOnly } from './engine'
import {
  compile,
  controlState,
  expectStacked,
  frames,
  host,
  lambdaTerm,
  outside,
  PREFIX,
  picker,
  rowWordEnd,
  SHELL,
  segments,
  token,
  until,
} from './harness'
import { mountLambdaBody } from './lambda-body-fixture'
import { codePanelOf, codeRows } from './mc-fixture'
import { mountTmFixture } from './tm-fixture'

/**
 * A LIST RESULT IN THE VIEWS THE APP BUILDS (the list results design): at the last step of countdown(4) the rxm and
 * clif heaps light the four cells of `[4, 3, 2, 1]` as one box, the TM boxes them on HEAP with no word there, and the
 * λ view marks the list; at the step before none of it. Two of its cells with one it does not reach between them are
 * two boxes, `[]`, the tail of `[1]`, lights none of the heap's cells, and `[1, 2]`'s one λ row, in a view too narrow
 * for the word after it, drops the word. With the clif view's machine code panel open, the clif marks hold, the panel
 * marks the run's place up to the end, and the end moves nothing outside the view. Then a λ body, a heap's lines and
 * a TM view built by hand: a block, its word after its first row or dropped where that row has no room for it, and
 * each box's far edge, its right or its bottom, kept in a view at a fractional place, scrolled to its end or not.
 */

const COUNTDOWN = EXAMPLES.find((e) => e.id === 'countdown')?.text ?? ''

/** Each long case's own bound, past every wait in it. */
const CASE_MS = 60_000
/**
 * A viewport width at which the λ view lays `[1, 2]`'s one row out with too little room after it for the word; the case
 * that uses it holds that as its premise.
 */
const NO_ROOM = 1100
/** The class of the bodies built by hand, which each case removes. */
const FIXTURE = 'result-list-fixture'

let view: EditorView

const rxm = () => host('rxm-0') as HTMLElement
const clif = () => host('clif-0') as HTMLElement
const tm = () => host('tm-0') as HTMLElement
const lam = () => host('lambda-0') as HTMLElement
const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''
const control = (pane: HTMLElement, label: string) =>
  [...pane.querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
const cellLines = (pane: HTMLElement) => [...pane.querySelectorAll<HTMLElement>('.rxm-cell-line')]
const lit = (pane: HTMLElement) => cellLines(pane).filter((l) => l.classList.contains('is-result'))
const heap = () => tm().querySelectorAll<HTMLElement>('.tape')[3] as HTMLElement
const labelOf = (row: HTMLElement) => row.querySelector('.tape-label')?.textContent ?? ''
/** Each of HEAP's cells' symbol and where it sits, plain values to compare at two steps. */
const heapCells = () =>
  [...heap().querySelectorAll<HTMLElement>('.cell')].map((c) => {
    const r = c.getBoundingClientRect()
    return [c.textContent, r.left, r.top]
  })
/** The right edge of what `term` shows without scrolling sideways. */
const shownRight = (term: HTMLElement) => term.getBoundingClientRect().left + term.clientLeft + term.clientWidth
/** What the λ view marks as the result: a run on one row, or the rows of a block. */
const lambdaMarks = (where: Element | null) => [
  ...(where?.querySelectorAll<HTMLElement>('.term-mark.is-result, .term-line.is-result-row') ?? []),
]

/** A root over five rows at width 20: a two-cell list's λ form, built by hand. */
const BLOCK = '\\n. \\c. c a (\\n. \\c. c b (\\n. \\c. n))'

/**
 * A root over three rows at `width`, built by hand, whose first row has too little room after it for the word: an
 * application's first row is its head, here one that fills the row to within less than the word's columns.
 */
const crowded = (width: number) => new Tree(wireOf(`${'f'.repeat(width - 3)} a b`))
/** A root on one row at `width` with too little room after it for the word. */
const crowdedRow = (width: number) => new Tree(wireOf('f'.repeat(width - 2)))

/** The box of a λ row's glyphs, the gutter's among them, by a `Range` from the strip to the row's end. */
function rowGlyphs(row: HTMLElement): DOMRect {
  const range = document.createRange()
  range.setStartAfter(row.querySelector('.term-lanes') as Element)
  range.setEnd(row, row.childNodes.length)
  return range.getBoundingClientRect()
}

/**
 * `el`'s pixels, read off a screenshot of it: a reader of the colour at a point of the page, as `[r, g, b]`. `el` sits
 * on whole pixels, so the screenshot's columns are the page's.
 */
async function pixelsOf(el: HTMLElement): Promise<(x: number, y: number) => number[]> {
  const base64 = await page.screenshot({ element: el, save: false })
  const bytes = Uint8Array.from(atob(base64.replace(/^data:image\/png;base64,/, '')), (c) => c.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  const box = el.getBoundingClientRect()
  expect(bitmap.width, 'precondition: the screenshot is a pixel to a CSS pixel').toBe(Math.round(box.width))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('no 2d context to read the screenshot with')
  context.drawImage(bitmap, 0, 0)
  const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data
  return (x, y) => {
    const at = (Math.floor(y - box.top) * bitmap.width + Math.floor(x - box.left)) * 4
    return [data[at] as number, data[at + 1] as number, data[at + 2] as number]
  }
}

/** The last four pixel rows or columns before `end`, a box's bottom or right side: the ones it draws its edge in. */
const lastPixels = (end: number): number[] => [3, 2, 1, 0].map((d) => Math.ceil(end) - 1 - d)

/**
 * Whether one of the pixel `lines`, rows or (`down`) columns, is `colour` as the edge cases weigh it at every point
 * `along` it: an edge drawn there.
 */
const edgeAlong = (
  px: (x: number, y: number) => number[],
  lines: number[],
  along: number[],
  colour: number[],
  down = false,
): boolean =>
  lines.some((l) =>
    along.every(
      (a) => (down ? px(l, a) : px(a, l)).reduce((sum, c, i) => sum + Math.abs(c - (colour[i] as number)), 0) <= 24,
    ),
  )

/** Whether the step line says the last step. */
const atEnd = (pane: HTMLElement) => /^step ([\d,]+) of \1$/.test(stepOf(pane))
/** The step number the step line says. */
const stepNumber = (pane: HTMLElement) => Number((/^step ([\d,]+)/.exec(stepOf(pane))?.[1] ?? '').replaceAll(',', ''))

/** Press `⏭`, which a view at its last step disables, and wait for the step line to say the last step. */
async function toEnd(pane: HTMLElement): Promise<void> {
  if (!atEnd(pane)) await userEvent.click(pane.querySelector('.controls .to-newest') as HTMLButtonElement)
  await until(() => atEnd(pane), "the view to reach its run's end")
}

/** Press `◀` and wait for the step line to say the step before the one it said. */
async function back(pane: HTMLElement): Promise<void> {
  const from = stepNumber(pane)
  await userEvent.click(control(pane, '◀') as HTMLButtonElement)
  await until(() => stepOf(pane).startsWith(`step ${(from - 1).toLocaleString('en')} of`), 'the view to step back')
}

/** Wait for the λ view to draw the tree of the step its line says, its own and not another step's. */
async function treeShown(): Promise<void> {
  await until(
    () => lambdaTerm()?.dataset.step === String(stepNumber(lam())) && lambdaTerm()?.dataset.stale === undefined,
    'the λ view to draw the tree of its step',
  )
}

/** The two methods of `pkg`'s session `tmHalt` calls, which its declarations type as returning `any`. */
type TmSession = { stepTm(): boolean; tmState(radius: number): TmState; free(): void }

/**
 * `src`'s binary TM state at its halt, from a session of its own stepped to its end and read at `TM_RADIUS` as the app
 * reads its frames: what the view's cells do not say, where HEAP's window starts against the result's cells.
 */
async function tmHalt(src: string): Promise<TmState> {
  await init()
  const { session } = compileSession(src, 'binary') as { session: TmSession | null }
  if (session === null) throw new Error(`no session for ${src}`)
  try {
    let steps = 0
    while (session.stepTm()) {
      steps += 1
      if (steps > 1_000_000) throw new Error(`${src}: no halt after ${steps} TM steps`)
    }
    return session.tmState(TM_RADIUS)
  } finally {
    session.free()
  }
}

/** Put `src` in the editor and wait for every view to record its run, from step 0. */
async function run(src: string, value: string): Promise<void> {
  await compile(view, src)
  await until(() => segments().some((s) => s.startsWith(`λ ${value} `)), "the readout's λ value")
  for (const pane of [rxm(), clif(), tm(), lam()])
    await until(() => /^step 0 of [\d,]+$/.test(stepOf(pane)), 'each view to record its run')
}

/** The room a heap line leaves either side of its glyphs: a `Range` over them against the line's box. */
function clearance(line: HTMLElement): number[] {
  const range = document.createRange()
  range.selectNodeContents(line)
  const glyphs = range.getBoundingClientRect()
  const box = line.getBoundingClientRect()
  return [glyphs.left - box.left, box.right - glyphs.right]
}

/** Where the glyphs of each heap line `leads` names start, by a `Range` over them; `undefined` for a line not drawn. */
function glyphStarts(pane: HTMLElement, leads: readonly string[]): (number | undefined)[] {
  const byLead = new Map(cellLines(pane).map((l) => [l.querySelector('b')?.textContent, l]))
  return leads.map((lead) => {
    const line = byLead.get(lead)
    if (line === undefined) return undefined
    const range = document.createRange()
    range.selectNodeContents(line)
    return range.getBoundingClientRect().left
  })
}

/** The edges the box draws on a lit line: its top where a run starts, its bottom where it ends. */
const top = (line: HTMLElement) => getComputedStyle(line).boxShadow.includes('0px 1px 0px 0px inset')
const bottom = (line: HTMLElement) => getComputedStyle(line).boxShadow.includes('0px -1px 0px 0px inset')

afterEach(() => {
  for (const el of document.querySelectorAll(`.${FIXTURE}`)) el.remove()
})

beforeAll(async () => {
  await page.viewport(1400, 1000)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await userEvent.selectOptions(picker(), 'binary')
  await userEvent.keyboard(PREFIX)
  await userEvent.keyboard('5')
  await until(() => host('clif-0') !== null, 'the view keys and 5 to show a clif view')
  await run(COUNTDOWN, '[4, 3, 2, 1]')
}, CASE_MS)

describe('a list result in the app', () => {
  it.each(['rxm-0', 'clif-0'])(
    "lights the list's cells in %s's heap as one box, and not at the step before",
    async (leaf) => {
      const pane = () => host(leaf) as HTMLElement
      await toEnd(pane())
      const lines = lit(pane())
      expect(lines, 'the cells lit').toHaveLength(4)
      const all = cellLines(pane())
      const from = all.indexOf(lines[0] as HTMLElement)
      expect(all.slice(from, from + 4), 'one run of lines').toEqual(lines)
      expect(
        lines.map((l) => [l.classList.contains('is-result-first'), l.classList.contains('is-result-last')]),
        'where the box starts and ends',
      ).toEqual([
        [true, false],
        [false, false],
        [false, false],
        [false, true],
      ])
      expect(
        lines.map((l) => [top(l), bottom(l)]),
        'the edges drawn',
      ).toEqual([
        [true, false],
        [false, false],
        [false, false],
        [false, true],
      ])
      expectStacked(
        lines.map((l) => l.getBoundingClientRect()),
        'line',
      )
      for (const l of lines) {
        const s = getComputedStyle(l)
        expect(s.backgroundColor, 'the ground').toBe(token('--result-bg', 'background-color'))
        expect(s.boxShadow, 'the edge').toContain(token('--result'))
        expect(l.getAttribute('aria-description')).toBe('part of the result')
      }
      expect(pane().querySelectorAll('.rxm-cell-line .result-word'), 'a word on a cell').toHaveLength(0)
      for (const l of lines)
        expect(Math.min(...clearance(l)), "the glyphs' room inside the box's side edges").toBeGreaterThanOrEqual(2)
      const leads = lines.map((l) => l.querySelector('b')?.textContent ?? '')
      const glyphs = glyphStarts(pane(), leads)
      const end = outside(leaf)

      await back(pane())
      expect(lit(pane()), 'the cells lit at the step before').toEqual([])
      expect(glyphStarts(pane(), leads), "where the lit lines' glyphs start, at the step before").toEqual(glyphs)
      expect(outside(leaf), 'what is outside the view').toEqual(end)
    },
  )

  it(
    "boxes the list's cells on HEAP, the word on REG alone, and not at the step before",
    async () => {
      await toEnd(tm())
      expect(labelOf(heap()), 'precondition: the fourth tape').toBe('HEAP')
      // THE BOX STARTS AT A CELL ONLY WHILE HEAP'S WINDOW REACHES BACK TO THE LIST'S FIRST CELL: the window runs
      // TM_RADIUS cells either side of the head, which halts on the blank after the last cell, and countdown(4)'s binary
      // cells fill exactly TM_RADIUS. A longer list or a smaller radius cuts the first cell, and fails here.
      const halt = await tmHalt(COUNTDOWN)
      expect(halt.step, 'precondition: the halt of the run the view stepped').toBe(stepNumber(tm()))
      const at = (tapeNames() as string[]).indexOf('HEAP')
      expect(
        halt.result?.[0]?.from,
        "premise: HEAP's window at the halt reaches back to the list's first cell",
      ).toBeGreaterThanOrEqual(halt.window_start[at] as number)
      const boxes = [...heap().querySelectorAll<HTMLElement>('.tm-result')]
      expect(boxes, 'one box: the cells sit side by side').toHaveLength(1)
      const cells = [...(boxes[0] as HTMLElement).children].map((c) => c.textContent)
      expect(cells[0], 'the box starts at a cell').toBe('@')
      expect(
        cells.filter((c) => c === '@'),
        'the cells it holds',
      ).toHaveLength(4)
      expect(heap().querySelector('.result-word'), 'a word on HEAP').toBeNull()
      expect(heap().getAttribute('aria-description')).toBe('the result’s cells marked')
      expect(tm().querySelectorAll('.result-word'), 'the word, once, after REG’s field 0').toHaveLength(1)
      const box = getComputedStyle(boxes[0] as HTMLElement)
      expect(box.backgroundColor, 'the ground').toBe(token('--result-bg', 'background-color'))
      expect(box.boxShadow, 'the edge').toContain(token('--result'))
      const cellsAt = heapCells()
      const end = outside('tm-0')

      await back(tm())
      expect(tm().querySelectorAll('.tm-result, .result-word'), 'a box or a word at the step before').toHaveLength(0)
      expect(heap().hasAttribute('aria-description'), 'what HEAP says at the step before').toBe(false)
      expect(heapCells(), "where HEAP's cells sit at the step before").toEqual(cellsAt)
      expect(outside('tm-0'), 'what is outside the view').toEqual(end)
    },
    CASE_MS,
  )

  it(
    'marks the list in the λ view as one block, and not at the step before',
    async () => {
      await toEnd(lam())
      await treeShown()
      const marks = lambdaMarks(lambdaTerm())
      expect(marks.length, 'the list marked').toBeGreaterThan(0)
      const said = lambdaTerm()?.querySelectorAll<HTMLElement>('[data-marks*="result:"]') ?? []
      expect(
        [...said].map((t) => t.closest('.term-line')),
        'said where it starts, on the first row',
      ).toEqual([lambdaTerm()?.querySelector('.term-line')])
      const term = lambdaTerm() as HTMLElement
      const rows = [...term.querySelectorAll<HTMLElement>('.term-line')]
      expect(rows.length, "countdown(4)'s list over several rows").toBeGreaterThan(1)
      expect(marks, 'every row of the term in the block').toEqual(rows)
      expect(getComputedStyle(marks[0] as HTMLElement, '::after').content, 'the word on the first row').toContain(
        '"result"',
      )
      expect(rowWordEnd(marks[0] as HTMLElement), "the word's end, in the view").toBeLessThanOrEqual(shownRight(term))
      const end = outside('lambda-0')

      await back(lam())
      await treeShown()
      expect(lambdaMarks(lambdaTerm()), 'the marks at the step before').toEqual([])
      expect(outside('lambda-0'), 'what is outside the view').toEqual(end)
    },
    CASE_MS,
  )

  it(
    "drops the word where a list's one λ row has no room for it, keeping the ground, the edge and the words said",
    async () => {
      // LAID OUT AT THE RUN'S START: the λ view lays a term out when it draws a step, not when the window resizes.
      await page.viewport(NO_ROOM, 1000)
      try {
        await run('[1, 2]', '[1, 2]')
        await toEnd(lam())
        await treeShown()
        const term = lambdaTerm() as HTMLElement
        expect(term.querySelectorAll('.term-line'), 'precondition: the root on one row').toHaveLength(1)
        const marks = lambdaMarks(term)
        expect(marks, 'the runs marked').toHaveLength(1)
        const mark = marks[0] as HTMLElement
        expect(mark.textContent, 'precondition: the run holds the term, all of it').toBe(term.textContent)
        // READ WITH THE WORD PUT BACK: a row with no room for the word scrolls the term sideways once it is drawn.
        const dropped = mark.classList.contains('is-wordless')
        mark.classList.remove('is-wordless')
        const over = term.scrollWidth - term.clientWidth
        mark.classList.toggle('is-wordless', dropped)
        expect(over, 'premise: with its word, the row scrolls the term sideways').toBeGreaterThan(0)
        expect.soft(term.scrollWidth, "the term's width, past the view").toBe(term.clientWidth)
        expect.soft(getComputedStyle(mark, '::after').content, 'the word after it').toBe('none')
        const s = getComputedStyle(mark)
        expect.soft(s.backgroundColor, 'the ground').toBe(token('--result-bg', 'background-color'))
        expect.soft([s.outlineStyle, s.outlineColor], 'the edge').toEqual(['solid', token('--result')])
        expect
          .soft((mark.querySelector('[data-node]') as HTMLElement).dataset.marks, 'the words where it starts')
          .toContain('result:')
        const end = outside('lambda-0')

        await back(lam())
        await treeShown()
        expect(lambdaMarks(lambdaTerm()), 'the marks at the step before').toEqual([])
        const before = lambdaTerm() as HTMLElement
        expect(before.scrollWidth, "the term's width at the step before, past the view").toBe(before.clientWidth)
        expect(outside('lambda-0'), 'what is outside the view').toEqual(end)
      } finally {
        await page.viewport(1400, 1000)
        await run(COUNTDOWN, '[4, 3, 2, 1]')
      }
    },
    CASE_MS,
  )

  it(
    'outlines the lit heap lines and the boxes on HEAP in forced colours, the marks with no word beside them',
    async (ctx) => {
      chromiumOnly(ctx, 'forced colours are CDP’s Emulation.setEmulatedMedia, which only Chromium has')
      for (const pane of [rxm(), clif(), tm()]) await toEnd(pane)
      const marks = [...lit(rxm()), ...lit(clif()), ...heap().querySelectorAll<HTMLElement>('.tm-result')]
      expect(marks, 'precondition: four lines in each heap, one box on HEAP').toHaveLength(9)
      const regRow = tm().querySelector<HTMLElement>('.tape') as HTMLElement
      expect(labelOf(regRow), 'precondition: the first tape').toBe('REG')
      const reg = regRow.querySelector<HTMLElement>('.tm-result') as HTMLElement
      const style = (el: HTMLElement) => getComputedStyle(el).outlineStyle
      expect([...marks, reg].map(style), 'precondition: no outline outside forced colours').toEqual(
        [...marks, reg].map(() => 'none'),
      )
      await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
      try {
        expect(matchMedia('(forced-colors: active)').matches, 'precondition: forced colours').toBe(true)
        const highlight = token('Highlight')
        for (const [i, m] of marks.entries()) {
          const s = getComputedStyle(m)
          expect(
            [s.outlineStyle, s.outlineWidth, s.outlineOffset, s.outlineColor],
            `a mark with no word, ${i} of ${marks.length}: its outline`,
          ).toEqual(['solid', '1px', '-1px', highlight])
        }
        expect(style(reg), "REG's box, which keeps its word").toBe('none')
      } finally {
        await cdp().send('Emulation.setEmulatedMedia', { features: [] })
      }
    },
    CASE_MS,
  )

  it(
    'boxes the result’s cells apart where a cell it does not reach sits between them',
    async () => {
      try {
        await run('let xs = [1]; let g = [5]; cons(head(g), xs)', '[5, 1]')
        for (const pane of [rxm(), clif()]) {
          await toEnd(pane)
          const lines = cellLines(pane)
          expect(
            lines.map((l) => l.classList.contains('is-result')),
            'the cells lit, newest first',
          ).toEqual([true, false, true])
          for (const l of lit(pane))
            expect([top(l), bottom(l)], 'a box of its own, closed at both ends').toEqual([true, true])
        }
        await toEnd(tm())
        const boxes = [...heap().querySelectorAll<HTMLElement>('.tm-result')]
        expect(boxes, 'two boxes on HEAP').toHaveLength(2)
        for (const box of boxes)
          expect(
            [...box.children].filter((c) => c.textContent === '@'),
            'the cells each holds',
          ).toHaveLength(1)
        expect(boxes[0]?.nextElementSibling, 'the boxes apart').not.toBe(boxes[1])
        expect(heap().querySelector('.result-word'), 'a word on HEAP').toBeNull()
      } finally {
        await run(COUNTDOWN, '[4, 3, 2, 1]')
      }
    },
    CASE_MS,
  )

  it(
    'lights no cell for [] beside a cell on the heap, and marks its pointer and its λ term',
    async () => {
      try {
        await run('tail([1])', '[]')
        for (const pane of [rxm(), clif()]) {
          await toEnd(pane)
          expect(cellLines(pane), 'precondition: a cell on the heap').not.toHaveLength(0)
          expect(lit(pane), 'the cells lit').toEqual([])
          expect(pane.querySelectorAll('.rxm-register.is-result'), 'the result’s row').toHaveLength(1)
        }
        await toEnd(tm())
        expect(
          heapCells().filter(([symbol]) => symbol === '@'),
          'precondition: a cell on HEAP',
        ).not.toHaveLength(0)
        expect(heap().querySelector('.tm-result'), 'a box on HEAP').toBeNull()
        expect(tm().querySelectorAll('.tm-result'), 'the box round field 0').toHaveLength(1)
        await toEnd(lam())
        await treeShown()
        const marks = lambdaMarks(lambdaTerm())
        expect(marks, 'one run, on one row').toHaveLength(1)
        expect(marks[0]?.classList.contains('term-mark'), 'a run').toBe(true)
        expect(marks[0]?.textContent, 'the term it holds').toBe(lambdaTerm()?.textContent)
      } finally {
        await run(COUNTDOWN, '[4, 3, 2, 1]')
      }
    },
    CASE_MS,
  )
  it(
    "keeps the clif view's marks with its machine code panel open, the panel following the run to its end, and moves nothing outside the view",
    async () => {
      const toggle = codePanelOf(clif()).querySelector('.panel-toggle') as HTMLElement
      const current = () => codeRows(clif()).filter((r) => r.classList.contains('is-current'))
      const pcOf = (r: HTMLElement) => r.querySelector('.rxm-pc')?.textContent ?? ''
      await userEvent.click(toggle)
      try {
        await until(() => codeRows(clif()).length > 0, "the machine code panel's rows")
        await toEnd(clif())
        await back(clif())
        const next = clif().querySelector<HTMLElement>('.panel[data-panel="listing"] .clif-row.is-next')
        const pc = next === null ? '' : pcOf(next)
        expect(pc, 'precondition: the clif instruction about to run has a pc').not.toBe('')
        const box = codePanelOf(clif()).querySelector('.mc-listing') as HTMLElement
        const shown = (r: HTMLElement) => {
          const [row, room] = [r.getBoundingClientRect(), box.getBoundingClientRect()]
          return row.top >= room.top - 1 && row.bottom <= room.bottom + 1
        }
        // MORE ROWS THAN THE BOX SHOWS START AT ITS TOP, as `clif-pane.ts` follows the run: the first is in view.
        await until(
          () => current().length > 0 && shown(current()[0] as HTMLElement),
          "the machine code panel to mark the run's place in view",
        )
        expect(current().map(pcOf), 'the rows marked: the instruction about to run').toEqual(current().map(() => pc))
        expect(
          codeRows(clif()).filter((r) => pcOf(r) === pc && !r.classList.contains('is-current')),
          'a row of that instruction not marked',
        ).toEqual([])
        const before = outside('clif-0')

        await toEnd(clif())
        expect(lit(clif()), 'the heap lines lit').toHaveLength(4)
        expect(clif().querySelectorAll('.rxm-register.is-result'), "the result's value").toHaveLength(1)
        expect(current(), 'machine rows marked at the end, where nothing is about to run').toEqual([])
        expect(outside('clif-0'), 'what is outside the view').toEqual(before)
      } finally {
        await userEvent.click(toggle)
      }
    },
    CASE_MS,
  )
})

/**
 * `BLOCK` as the result in a λ view shorter than its five rows whose top and height each lie half a pixel past a whole
 * one, in a frame on whole pixels for `pixelsOf`; the cases that use it hold that as their premise.
 */
async function halfPixelBlock() {
  const { body } = mountLambdaBody(FIXTURE)
  const host = body.el.parentElement as HTMLElement
  const frame = document.createElement('div')
  frame.className = FIXTURE
  frame.style.cssText = 'position: fixed; left: 0; top: 0; z-index: 1; width: 600px; background: var(--bg)'
  host.style.width = '300px'
  host.style.marginBlockStart = '10.5px'
  // SHORTER THAN THE BLOCK'S FIVE ROWS, at a height of its own: `.term`'s floor and cap would set it.
  body.el.style.minHeight = '0'
  body.el.style.maxHeight = 'none'
  body.el.style.height = '60.5px'
  frame.append(host)
  document.body.append(frame)
  const tree = new Tree(wireOf(BLOCK))
  body.showTree(tree, codeLines(tree, { width: 20, vars: 'names', open: () => true }), false, [], false, true)
  await frames()
  return { body, frame }
}

/** Whether the block's bottom edge is drawn in one of `term`'s last four pixel rows, past its last row's glyphs. */
async function blockBottomDrawn(term: HTMLElement, frame: HTMLElement): Promise<boolean> {
  const edge = (token('--result').match(/\d+/g) ?? []).slice(0, 3).map(Number)
  const last = term.querySelector<HTMLElement>('.term-line.is-result-last')
  expect(last, 'precondition: the block’s last row drawn').not.toBeNull()
  const row = (last as HTMLElement).getBoundingClientRect()
  return edgeAlong(
    await pixelsOf(frame),
    lastPixels(term.getBoundingClientRect().bottom),
    [40, 30, 20, 10].map((d) => row.right - d),
    edge,
  )
}

describe('a result over several rows in a λ body built by hand', () => {
  it('tints every row of the root as one block, the word after the first row alone', () => {
    const { body } = mountLambdaBody(FIXTURE)
    const tree = new Tree(wireOf(BLOCK))
    const lines = codeLines(tree, { width: 20, vars: 'names', open: () => true })
    expect(lines, 'precondition: the root over five rows').toHaveLength(5)
    body.showTree(tree, lines, false, [], false, true)
    const rows = [...body.el.querySelectorAll<HTMLElement>('.term-line')]
    expect(
      rows.map((r) => r.classList.contains('is-result-row')),
      'the rows in the block',
    ).toEqual(rows.map(() => true))
    expect(
      rows.map((r) => [r.classList.contains('is-result-first'), r.classList.contains('is-result-last')]),
      'where it starts and ends',
    ).toEqual([
      [true, false],
      [false, false],
      [false, false],
      [false, false],
      [false, true],
    ])
    expect(body.el.querySelectorAll('.term-mark.is-result, .term-bar'), 'a run or a bar').toHaveLength(0)
    expect(getComputedStyle(rows[0] as HTMLElement, '::after').content, 'the word on the first row').toContain(
      '"result"',
    )
    for (const row of rows.slice(1))
      expect(getComputedStyle(row, '::after').content, 'a word on a later row').not.toContain('result')
    expect(rowWordEnd(rows[0] as HTMLElement), "the word's end, in the body").toBeLessThanOrEqual(shownRight(body.el))
    expectStacked(
      rows.map((r) => r.getBoundingClientRect()),
      'row',
    )
    for (const row of rows) {
      expect(getComputedStyle(row).backgroundColor, 'the ground').toBe(token('--result-bg', 'background-color'))
      const lanes = row.querySelector('.term-lanes') as HTMLElement
      expect(getComputedStyle(lanes).boxShadow, 'the left edge, off the strip').toContain(token('--result'))
    }
    expect(top(rows[0] as HTMLElement), 'the top edge on the first row').toBe(true)
    expect(bottom(rows[4] as HTMLElement), 'the bottom edge on the last row').toBe(true)
    expect([top(rows[2] as HTMLElement), bottom(rows[2] as HTMLElement)], 'edges across a middle row').toEqual([
      false,
      false,
    ])
    const said = [...body.el.querySelectorAll<HTMLElement>('[data-marks*="result:"]')]
    expect(
      said.map((t) => t.closest('.term-line')),
      'said once, where it starts on the first row',
    ).toEqual([rows[0]])
  })

  it('draws the block’s left edge off the strip’s right side and its right edge clear of the widest row’s last glyph, moving no glyph from where an unmarked row has it', () => {
    const { body } = mountLambdaBody(FIXTURE)
    // A BODY NARROWER THAN THE TERM, so the block's right edge is the widest row's end.
    ;(body.el.parentElement as HTMLElement).style.width = '150px'
    const tree = new Tree(wireOf(BLOCK))
    const lines = codeLines(tree, { width: 20, vars: 'names', open: () => true })
    const glyphs = () => [...body.el.querySelectorAll<HTMLElement>('.term-line')].map(rowGlyphs)
    body.showTree(tree, lines, false, [], false, false)
    const unmarked = glyphs().map((g) => [g.left, g.right])
    body.showTree(tree, lines, false, [], false, true)
    expect(body.el.scrollWidth, 'precondition: the term wider than the body').toBeGreaterThan(body.el.clientWidth)
    const rows = [...body.el.querySelectorAll<HTMLElement>('.term-line')]
    expect(
      rows.map((r) => r.classList.contains('is-result-row')),
      'precondition: every row in the block',
    ).toEqual(rows.map(() => true))
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
    ctx.font = getComputedStyle(body.el).font
    const ch = ctx.measureText('0000000000').width / 10
    for (const [i, row] of rows.entries()) {
      const g = rowGlyphs(row)
      const lanes = row.querySelector('.term-lanes') as HTMLElement
      const strip = lanes.getBoundingClientRect()
      const gutter = row.querySelector('.term-gutter') as HTMLElement
      const fold = gutter.getBoundingClientRect()
      const text = (row.querySelector('[data-node]:not(.term-gutter)') as HTMLElement).getBoundingClientRect()
      const indent = Number.parseFloat(gutter.style.marginInlineStart)
      expect
        .soft(fold.left - strip.right - indent * ch, `row ${i}'s ▸/▾ on the strip's right side, past its indent`)
        .toBeCloseTo(0, 0)
      expect.soft(text.left - fold.left, `row ${i}'s text 2ch past its ▸/▾`).toBeCloseTo(2 * ch, 0)
      expect
        .soft(getComputedStyle(lanes).boxShadow, `row ${i}'s left edge, a pixel off the strip's right side`)
        .toBe(`${token('--result')} 1px 0px 0px 0px`)
      expect
        .soft(row.getBoundingClientRect().right - g.right, `row ${i}'s room inside the right edge`)
        .toBeGreaterThanOrEqual(2)
    }
    const root = rows[0] as HTMLElement
    const edge = (root.querySelector('.term-lanes') as HTMLElement).getBoundingClientRect().right + 1
    const first = rowGlyphs(root)
    // THE LEFT EDGE TAKES A PIXEL OF THE ROOT ROW'S ▾ BOX: room for it past the strip would move every row's glyphs.
    expect.soft(edge - first.left, "the left edge's pixel inside row 0's ▾ box").toBeCloseTo(1, 1)
    expect(
      glyphs().map((g) => [g.left, g.right]),
      "where each row's glyphs lie, against the body unmarked",
    ).toEqual(unmarked)
  })

  it('draws the block’s right edge inside a view at a fractional place, where the term fits the view and where the view is scrolled to the term’s end', async () => {
    // A SCREENSHOT A PIXEL TO A CSS PIXEL: the tester draws its page scaled where it is larger than the browser's window.
    await page.viewport(1000, 700)
    try {
      const edge = (token('--result').match(/\d+/g) ?? []).slice(0, 3).map(Number)
      // 462.67 px: the term fits the view, as at countdown(4)'s last step; 150.67 px: it is wider, scrolled to its end.
      for (const [width, wide] of [
        [462.67, false],
        [150.67, true],
      ] as const) {
        const { body } = mountLambdaBody(FIXTURE)
        const host = body.el.parentElement as HTMLElement
        // THE SCREENSHOT'S FRAME ON WHOLE PIXELS, the view at a fractional place inside it.
        const frame = document.createElement('div')
        frame.className = FIXTURE
        frame.style.cssText = 'position: fixed; left: 0; top: 0; z-index: 1; width: 600px; background: var(--bg)'
        host.style.width = `${width}px`
        host.style.marginInlineStart = '0.67px'
        frame.append(host)
        document.body.append(frame)
        const tree = new Tree(wireOf(BLOCK))
        body.showTree(tree, codeLines(tree, { width: 20, vars: 'names', open: () => true }), false, [], false, true)
        body.el.scrollLeft = body.el.scrollWidth
        await frames()
        const right = body.el.getBoundingClientRect().right
        expect(
          [body.el.scrollWidth > body.el.clientWidth, right % 1 > 0.25 && right % 1 < 0.75],
          `precondition: the view ${width} px wide, the term wider than it or not, its right side between two pixels`,
        ).toEqual([wide, true])
        if (wide)
          expect(body.el.scrollLeft, 'precondition: scrolled to the end').toBe(
            body.el.scrollWidth - body.el.clientWidth,
          )
        const px = await pixelsOf(frame)
        const rows = [...body.el.querySelectorAll<HTMLElement>('.term-line')]
        const last = Math.floor(right)
        const drawn = rows.map((row) => {
          const r = row.getBoundingClientRect()
          return [last - 3, last - 2, last - 1, last].some((x) => {
            const p = px(x, r.top + r.height / 2)
            return p.reduce((sum, c, i) => sum + Math.abs(c - (edge[i] as number)), 0) <= 24
          })
        })
        expect
          .soft(drawn, `each row's right edge in the view's last four pixels, the view ${width} px wide`)
          .toEqual(rows.map(() => true))
      }
    } finally {
      await page.viewport(1400, 1000)
    }
  })

  it('draws the block’s bottom edge in a view scrolled to the term’s end whose top and height both round up', async () => {
    // A SCREENSHOT A PIXEL TO A CSS PIXEL, as the right edge's case says.
    await page.viewport(1000, 700)
    try {
      const { body, frame } = await halfPixelBlock()
      body.el.scrollTop = body.el.scrollHeight
      await frames()
      const box = body.el.getBoundingClientRect()
      expect(
        [
          box.top % 1 >= 0.5,
          box.height % 1 >= 0.5,
          body.el.scrollTop > 0,
          body.el.scrollTop === body.el.scrollHeight - body.el.clientHeight,
        ],
        'precondition: the view’s top and height each half a pixel or more past a whole one, scrolled to the end',
      ).toEqual([true, true, true, true])
      expect(
        await blockBottomDrawn(body.el, frame),
        'the block’s bottom edge in one of the view’s last four pixel rows, past the last row’s glyphs',
      ).toBe(true)
    } finally {
      await page.viewport(1400, 1000)
    }
  })

  it('draws the block’s bottom edge in a view whose top and height both round up, taken from its first row to its last by End, ↓ or PageDown', async () => {
    // A SCREENSHOT A PIXEL TO A CSS PIXEL, as the right edge's case says.
    await page.viewport(1000, 700)
    try {
      // ↓ FOUR TIMES AND PAGEDOWN TWICE, a page being two rows in a view three rows tall: each from the first row to
      // the fifth.
      for (const [gesture, keys] of [
        ['End', '{End}'],
        ['↓', '{ArrowDown}'.repeat(4)],
        ['PageDown', '{PageDown}'.repeat(2)],
      ] as const) {
        const { body, frame } = await halfPixelBlock()
        expect(body.el.scrollTop, 'precondition: the view at its top').toBe(0)
        body.el.focus()
        await userEvent.keyboard(keys)
        await frames()
        const box = body.el.getBoundingClientRect()
        const last = body.el.querySelector<HTMLElement>('.term-line.is-result-last')
        expect(
          [box.top % 1 >= 0.5, box.height % 1 >= 0.5, body.el.scrollTop > 0, last?.classList.contains('is-active')],
          `precondition: the view’s top and height each half a pixel or more past a whole one, ${gesture} onto the last row`,
        ).toEqual([true, true, true, true])
        expect
          .soft(
            await blockBottomDrawn(body.el, frame),
            `the block’s bottom edge in one of the view’s last four pixel rows after ${gesture}, past the last row’s glyphs`,
          )
          .toBe(true)
        // THE SPACER'S END, NOT THE VIEW'S SCROLL END: Firefox's can lie a pixel past it, at a place where it draws the
        // edge either way.
        const spacer = body.el.querySelector('.term-spacer') as HTMLElement
        expect
          .soft(
            body.el.scrollTop + body.el.clientHeight,
            `the view down to the spacer's end after ${gesture}, the pixel below the rows included, as following takes it`,
          )
          .toBeGreaterThanOrEqual(spacer.offsetHeight)
        frame.remove()
      }
    } finally {
      await page.viewport(1400, 1000)
    }
  })

  it('draws no block when the root is not the result', () => {
    const { body } = mountLambdaBody(FIXTURE)
    const tree = new Tree(wireOf(BLOCK))
    const lines = codeLines(tree, { width: 20, vars: 'names', open: () => true })
    body.showTree(tree, lines, false, [], false, false)
    expect(body.el.querySelectorAll('.is-result-row, .is-result'), 'a result mark').toHaveLength(0)
  })

  it('drops the word where the block’s first row has no room for it, keeping the ground, the edges and the words said', () => {
    const { body } = mountLambdaBody(FIXTURE)
    // LAID OUT TO THE BODY'S OWN WIDTH, as the pane lays a term out.
    const width = body.columns()
    const tree = crowded(width)
    const lines = codeLines(tree, { width, vars: 'names', open: () => true })
    expect(lines, 'precondition: the root over three rows').toHaveLength(3)
    body.showTree(tree, lines, false, [], false, true)
    const rows = [...body.el.querySelectorAll<HTMLElement>('.term-line')]
    expect(
      rows.map((r) => r.classList.contains('is-result-row')),
      'precondition: every row in the block',
    ).toEqual(rows.map(() => true))
    expect.soft(getComputedStyle(rows[0] as HTMLElement, '::after').content, 'the word on the first row').toBe('none')
    for (const [i, row] of rows.entries()) {
      expect
        .soft(getComputedStyle(row).backgroundColor, `row ${i}'s ground`)
        .toBe(token('--result-bg', 'background-color'))
      const lanes = row.querySelector('.term-lanes') as HTMLElement
      expect.soft(getComputedStyle(lanes).boxShadow, `row ${i}'s left edge, off the strip`).toContain(token('--result'))
    }
    expect.soft(top(rows[0] as HTMLElement), 'the top edge on the first row').toBe(true)
    expect.soft(bottom(rows[2] as HTMLElement), 'the bottom edge on the last row').toBe(true)
    const said = [...body.el.querySelectorAll<HTMLElement>('[data-marks*="result:"]')]
    expect
      .soft(
        said.map((t) => t.closest('.term-line')),
        'said once, where it starts on the first row',
      )
      .toEqual([rows[0]])
  })

  it('drops the word in a body narrower than the layout’s floor, where the row and the word fit the layout but not the body', () => {
    const { body } = mountLambdaBody(FIXTURE)
    // A PHONE'S λ VIEW: the layout lays every row out to its floor of 24 columns, more than this body shows.
    ;(body.el.parentElement as HTMLElement).style.width = '189px'
    const width = body.columns()
    const tree = new Tree(wireOf('\\f. \\x. f (f (f x))'))
    const lines = codeLines(tree, { width, vars: 'names', open: () => true })
    expect(lines.map(lineText), 'precondition: the root on one row').toEqual(['λf x. f (f (f x))'])
    expect(
      lineText(lines[0] as Line).length + 6,
      'premise: the row and the word within the columns the layout lays out to',
    ).toBeLessThanOrEqual(width)
    body.showTree(tree, lines, false, [], false, true)
    const run = body.el.querySelector<HTMLElement>('.term-mark.is-result') as HTMLElement
    expect(run.textContent, 'precondition: the run holds the term, all of it').toBe(body.el.textContent)
    // READ WITH THE WORD PUT BACK: a row with no room for the word scrolls the term sideways once it is drawn.
    const dropped = run.classList.contains('is-wordless')
    run.classList.remove('is-wordless')
    const over = body.el.scrollWidth - body.el.clientWidth
    run.classList.toggle('is-wordless', dropped)
    expect(over, 'premise: with its word, the row scrolls the term sideways').toBeGreaterThan(0)
    expect.soft(body.el.scrollWidth, "the term's width, past the body").toBe(body.el.clientWidth)
    expect.soft(getComputedStyle(run, '::after').content, 'the word after it').toBe('none')
    const s = getComputedStyle(run)
    expect.soft(s.backgroundColor, 'the ground').toBe(token('--result-bg', 'background-color'))
    expect.soft([s.outlineStyle, s.outlineColor], 'the edge').toEqual(['solid', token('--result')])
    expect
      .soft((run.querySelector('[data-node]') as HTMLElement).dataset.marks, 'the words where it starts')
      .toContain('result:')
  })

  it('outlines a result whose word is dropped in Highlight in forced colours, on one row or over several, a block’s left edge on the strip’s right side', async (ctx) => {
    chromiumOnly(ctx, 'forced colours are CDP’s Emulation.setEmulatedMedia, which only Chromium has')
    const show = (tree: (width: number) => Tree) => {
      const { body } = mountLambdaBody(FIXTURE)
      const width = body.columns()
      const t = tree(width)
      body.showTree(t, codeLines(t, { width, vars: 'names', open: () => true }), false, [], false, true)
      return body.el
    }
    const [row, block, roomy] = [show(crowdedRow), show(crowded), show(() => new Tree(wireOf('f')))]
    const run = row.querySelector<HTMLElement>('.term-mark.is-result') as HTMLElement
    const rows = [...block.querySelectorAll<HTMLElement>('.term-line')]
    const shown = roomy.querySelector<HTMLElement>('.term-mark.is-result') as HTMLElement
    expect(
      [run, rows[0] as HTMLElement, shown].map((e) => getComputedStyle(e, '::after').content !== 'none'),
      'precondition: the word dropped on one row and over several, and drawn where it has room',
    ).toEqual([false, false, true])
    expect(
      rows.map((r) => getComputedStyle(r).outlineStyle),
      'precondition: no outline on the block outside forced colours',
    ).toEqual(rows.map(() => 'none'))
    const lanes = rows.map((r) => r.querySelector('.term-lanes') as HTMLElement)
    const where = () => rows.map((r, i) => [rowGlyphs(r).left, (lanes[i] as HTMLElement).clientWidth])
    const unforced = where()
    await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
    try {
      expect(matchMedia('(forced-colors: active)').matches, 'precondition: forced colours').toBe(true)
      const highlight = token('Highlight')
      expect(
        getComputedStyle(shown).outlineColor,
        'precondition: Highlight is not the edge forced colours give a result with its word',
      ).not.toBe(highlight)
      const outline = (e: HTMLElement) => {
        const s = getComputedStyle(e)
        return [s.outlineStyle, s.outlineWidth, s.outlineOffset, s.outlineColor]
      }
      expect([run, ...rows].map(outline), 'the run and each row of the block: their outline').toEqual(
        [run, ...rows].map(() => ['solid', '1px', '-1px', highlight]),
      )
      // THE ROW'S OUTLINE RUNS UNDER THE STRIP, so the block's left edge is the strip's own column of pixels past its
      // lanes, which nothing lies over.
      for (const [i, l] of lanes.entries()) {
        const box = l.getBoundingClientRect()
        const y = box.top + box.height / 2
        expect(
          [
            box.width - l.clientWidth,
            document.elementFromPoint(box.right - 0.5, y),
            getComputedStyle(l).borderInlineEndColor,
          ],
          `row ${i}'s left edge: a pixel past the lanes, on top, in Highlight`,
        ).toEqual([1, l, highlight])
      }
      expect(where(), 'each row’s glyphs and lanes where they lie outside forced colours').toEqual(unforced)
    } finally {
      await cdp().send('Emulation.setEmulatedMedia', { features: [] })
    }
  })

  it('outlines a result whose word is dropped in Highlight in forced colours when it is also linked and the contractum', async (ctx) => {
    chromiumOnly(ctx, 'forced colours are CDP’s Emulation.setEmulatedMedia, which only Chromium has')
    const { body } = mountLambdaBody(FIXTURE)
    const width = body.columns()
    // `crowdedRow`'s root, the contractum too, and linked.
    const t = new Tree(wireOf('f'.repeat(width - 2), { contractum: 0 }))
    body.showTree(t, codeLines(t, { width, vars: 'names', open: () => true }), false, [0], false, true)
    const run = body.el.querySelector<HTMLElement>('.term-mark.is-result') as HTMLElement
    expect(
      ['is-wordless', 'is-linked', 'is-contractum'].map((c) => run.classList.contains(c)),
      'precondition: the root on one row, its word dropped, linked and the contractum',
    ).toEqual([true, true, true])
    await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
    try {
      expect(matchMedia('(forced-colors: active)').matches, 'precondition: forced colours').toBe(true)
      const s = getComputedStyle(run)
      expect([s.outlineStyle, s.outlineWidth, s.outlineOffset, s.outlineColor], 'its outline').toEqual([
        'solid',
        '1px',
        '-1px',
        token('Highlight'),
      ])
    } finally {
      await cdp().send('Emulation.setEmulatedMedia', { features: [] })
    }
  })
})

describe('a heap panel’s lines built by hand', () => {
  it('draws a list result’s bottom edge on its last line in a heap scrolled to its end whose top and height both round up', async () => {
    // A SCREENSHOT A PIXEL TO A CSS PIXEL, as the λ block's right edge's case says.
    await page.viewport(1000, 700)
    try {
      const edge = (token('--result').match(/\d+/g) ?? []).slice(0, 3).map(Number)
      const heap = heapPanel({ name: 'heap', label: 'heap', open: true, onToggle: () => {} })
      heap.show({
        count: '',
        items: Array.from({ length: 8 }, (_, i) => ({
          kind: 'line' as const,
          lead: `#${57 - i}`,
          body: `${57 - i} → #${56 - i}`,
          refs: [],
          result: i >= 4,
        })),
      })
      // THE LINES' LIST ALONE, out of its panel, so its own top is the place set here.
      const list = heap.panel.el.querySelector('.rxm-heap') as HTMLElement
      const frame = document.createElement('div')
      frame.className = FIXTURE
      frame.style.cssText = 'position: fixed; left: 0; top: 0; z-index: 1; width: 600px; background: var(--bg)'
      list.style.cssText = 'flex: none; min-height: 0; width: 300px; margin-block-start: 10.5px; height: 50.5px'
      frame.append(list)
      document.body.append(frame)
      await frames()
      list.scrollTop = list.scrollHeight
      await frames()
      const box = list.getBoundingClientRect()
      expect(
        [
          box.top % 1 >= 0.5,
          box.height % 1 >= 0.5,
          list.scrollTop > 0,
          list.scrollTop === list.scrollHeight - list.clientHeight,
        ],
        'precondition: the list’s top and height each half a pixel or more past a whole one, scrolled to the end',
      ).toEqual([true, true, true, true])
      const lines = [...list.querySelectorAll<HTMLElement>('.rxm-cell-line')]
      expect(
        lines.map((l) => l.classList.contains('is-result-last')),
        'precondition: the run ends on the last line',
      ).toEqual([false, false, false, false, false, false, false, true])
      const line = (lines[7] as HTMLElement).getBoundingClientRect()
      const px = await pixelsOf(frame)
      expect(
        edgeAlong(
          px,
          lastPixels(box.bottom),
          [40, 30, 20, 10].map((d) => line.right - d),
          edge,
        ),
        'the box’s bottom edge in one of the list’s last four pixel rows, past the last line’s glyphs',
      ).toBe(true)
    } finally {
      await page.viewport(1400, 1000)
    }
  })
})

/** A TM program of one accept state, for a TM view built by hand to draw a halt's frame of its own. */
const HALTED: TmProgram = {
  states: [{ name: 'done', accept: true, rules: [], instr: null }],
  alphabet: ['_', '#', '0', '1'],
  tapes: 5,
  width: 4,
  start: 0,
  listing: [],
  labels: [],
}

describe('a TM view built by hand', () => {
  it('draws a HEAP box’s right edge where the result runs to the row’s end, in a row scrolled to it whose start and width fall between two pixels', async () => {
    // A SCREENSHOT A PIXEL TO A CSS PIXEL, as the λ block's right edge's case says.
    await page.viewport(1000, 700)
    try {
      const edge = (token('--result').match(/\d+/g) ?? []).slice(0, 3).map(Number)
      const { host, pane } = mountTmFixture(HALTED, ['REG', 'WORK', 'STACK', 'HEAP', 'BOX'], {
        width: 300,
        height: 300,
      })
      const frame = document.createElement('div')
      frame.className = FIXTURE
      frame.style.cssText = 'position: fixed; left: 0; top: 0; z-index: 1; width: 600px; background: var(--bg)'
      frame.append(host)
      document.body.append(frame)
      // LONGER THAN THE ROW SHOWS, the list's six cells at the window's end.
      const tape = '#1101#0110#1011#0001#1110#0111#10#0110#1'
      pane.setResult(true, false)
      pane.render(
        {
          state: 0,
          step: 1,
          heads: [0, 0, 0, 0, 0],
          window_start: [0, 0, 0, 0, 0],
          window: ['_', '_', '_', tape, '_'],
          source_node: null,
          rule: null,
          result: [{ from: tape.length - 6, to: tape.length }],
        },
        controlState(true, 'step 1 of 1', false, false, false),
      )
      const cells = host.querySelectorAll<HTMLElement>('.tape .cells')[3] as HTMLElement
      const first = cells.getBoundingClientRect()
      const drawn: [number, number, boolean][] = []
      // THE ROW'S START AND WIDTH EACH SO FAR PAST A WHOLE PIXEL, both half a pixel or more: the host's place and width
      // move them by as much.
      for (const [start, width] of [
        [0.5, 0.5],
        [0.5, 0.67],
        [0.67, 0.5],
        [0.67, 0.67],
        [0.75, 0.5],
        [0.75, 0.67],
        [0.9, 0.5],
        [0.9, 0.67],
      ] as const) {
        host.style.marginInlineStart = `${(1 + start - (first.left % 1)) % 1}px`
        host.style.width = `${300 + ((1 + width - (first.width % 1)) % 1)}px`
        await frames()
        cells.scrollLeft = cells.scrollWidth
        await frames()
        const box = cells.getBoundingClientRect()
        expect(
          [
            Math.abs((box.left % 1) - start) < 0.02,
            Math.abs((box.width % 1) - width) < 0.02,
            cells.scrollLeft > 0,
            cells.scrollLeft === cells.scrollWidth - cells.clientWidth,
          ],
          `precondition: the row's start ${start} and its width ${width} past a whole pixel, scrolled to the end`,
        ).toEqual([true, true, true, true])
        const marked = cells.querySelector<HTMLElement>('.tm-result')
        expect([marked !== null, marked?.nextElementSibling ?? null], 'precondition: the box ends the row').toEqual([
          true,
          null,
        ])
        const r = (marked as HTMLElement).getBoundingClientRect()
        const px = await pixelsOf(frame)
        drawn.push([
          start,
          width,
          edgeAlong(px, lastPixels(box.right), [r.top + 2, r.top + 3, r.bottom - 4, r.bottom - 3], edge, true),
        ])
      }
      expect(
        drawn,
        'the box’s right edge in one of the row’s last four pixel columns, above and below its last cell’s glyph',
      ).toEqual(drawn.map(([start, width]) => [start, width, true]))
    } finally {
      await page.viewport(1400, 1000)
    }
  })
})
