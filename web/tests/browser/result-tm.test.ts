import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { EXAMPLES } from '../../src/examples'
import { compile, frames, hearLoops, host, outside, picker, SHELL, segments, stateIdle, token, until } from './harness'

/**
 * THE RESULT IN THE TM VIEW THE APP BUILDS (the return-value highlight design, goals 1, 2 and 4): at the last step of
 * sum_to(5) under binary, REG's field 0 in one box with the word `result` right after it, and ` · little-endian` at
 * the end of the status line while the line has room for it, dropped rather than wrapped where it has not and back
 * when it has again, with no step between; under unary no word of bit order, and a field that runs past REG's window
 * boxed where it is on screen. ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives.
 */

const SUM_TO = EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? ''
/** A program whose result under unary, 42 ones, runs past the 40 cells REG's window holds after its `#`. */
const PAST = 'let x = 40; x + 2'

/** Each long case's own bound, past every wait in it. */
const CASE_MS = 60_000

/** The page's width but where a case narrows it. */
const WIDE = 1280
/**
 * The page's width that leaves the TM view room for its status line at the end and not for the words after it; the
 * cases that narrow to it assert both.
 */
const NARROW = 800

let view: EditorView

const tm = () => host('tm-0') as HTMLElement
const stepOf = (pane: HTMLElement) => pane.querySelector('.step')?.textContent ?? ''
const control = (pane: HTMLElement, label: string) =>
  [...pane.querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
const tapes = () => [...tm().querySelectorAll<HTMLElement>('.tape')]
const labelOf = (row: HTMLElement) => row.querySelector('.tape-label')?.textContent ?? ''
const reg = () => tapes()[0] as HTMLElement
const status = () => tm().querySelector('.tm-status') as HTMLElement
const line = () => status().querySelector('.tm-line') as HTMLElement
const endian = () => status().querySelector<HTMLElement>('.tm-endian')
const stateName = () => status().querySelector('.tm-state') as HTMLElement

/** A box's sides as plain numbers, which `toEqual` reads, unlike a `DOMRect`'s getters. */
const sides = (el: Element): readonly number[] => {
  const r = el.getBoundingClientRect()
  return [r.left, r.top, r.width, r.height]
}

/** The rows the status line's parts are set on: one per distinct top among them. */
const rowsOf = () => new Set([...line().children].map((part) => Math.round(part.getBoundingClientRect().top))).size

/** The status line's height and rows, to compare at two steps. */
const shape = () => ({ height: status().getBoundingClientRect().height, rows: rowsOf() })

/** The width the status line sets its parts in: its own, inside its padding. */
const room = () => {
  const s = getComputedStyle(status())
  return status().clientWidth - Number.parseFloat(s.paddingLeft) - Number.parseFloat(s.paddingRight)
}

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

/** Set the page's width and wait for the frames that lay the view out at it. */
async function widthOf(width: number): Promise<void> {
  await page.viewport(width, 1000)
  await frames()
}

hearLoops(() => {})

beforeAll(async () => {
  await page.viewport(WIDE, 1000)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(stateIdle, 'the first compile')
  await userEvent.selectOptions(picker(), 'binary')
  await compile(view, SUM_TO)
  await until(() => segments().some((s) => s.startsWith('TM 15 ')), "the readout's TM value")
  await until(() => /^step 0 of 12,976$/.test(stepOf(tm())), 'the TM view to record its run')
}, CASE_MS)

describe('the result in the TM view', () => {
  it("boxes field 0 and puts the word after it at the TM view's last step", async () => {
    await toEnd(tm())
    expect(stepOf(tm())).toBe('step 12,976 of 12,976')
    expect(tapes().map(labelOf), 'precondition: the tapes').toEqual(['REG', 'WORK', 'STACK', 'HEAP', 'BOX'])
    expect(tm().querySelectorAll('.tm-result'), 'the boxes in the view').toHaveLength(1)
    const field = reg().querySelector('.tm-result') as HTMLElement
    expect(field, 'the box in REG').not.toBeNull()
    expect([...field.children].map((c) => c.textContent).join(''), 'the cells it holds').toBe('1111')
    const word = field.nextElementSibling as HTMLElement
    expect(word.className, 'right after the box').toBe('result-word')
    expect(word.textContent).toBe('result')
    const next = word.nextElementSibling as HTMLElement
    expect(next.textContent, 'precondition: the cell after the field is its #').toBe('#')
    expect(word.getBoundingClientRect().left, 'the word after the box').toBeGreaterThanOrEqual(
      field.getBoundingClientRect().right - 0.5,
    )
    expect(next.getBoundingClientRect().left, 'the # after the word').toBeGreaterThanOrEqual(
      word.getBoundingClientRect().right - 0.5,
    )
    expect(getComputedStyle(field).backgroundColor, 'the ground').toBe(token('--result-bg', 'background-color'))
    expect(getComputedStyle(field).boxShadow, 'the edge').toContain(token('--result'))
    expect(getComputedStyle(word).color, 'the word').toBe(token('--result-word'))
    const others = tapes().slice(1).map(sides)
    const atEnd = outside('tm-0')

    await back(tm())
    expect(tm().querySelectorAll('.tm-result, .result-word'), 'a box or a word at the step before').toHaveLength(0)
    expect(tapes().slice(1).map(sides), "the other tapes' rows at the step before").toEqual(others)
    expect(outside('tm-0'), 'what is outside the view').toEqual(atEnd)
  })

  it('says little-endian at the end of the status line when it has room', async () => {
    await toEnd(tm())
    expect(status().textContent).toBe('halt · step 12,976 of 12,976 · width 4 · little-endian')
    expect(endian()?.textContent, 'the words, a part of their own').toBe(' · little-endian')
    const words = endian() as HTMLElement
    expect(words.getBoundingClientRect().width, 'the words drawn').toBeGreaterThan(0)
    expect(words.scrollWidth, 'the words whole').toBeLessThanOrEqual(words.clientWidth)
    expect(rowsOf(), 'the line one row').toBe(1)

    await back(tm())
    expect(stepOf(tm()), 'precondition: the step before').toBe('step 12,975 of 12,976')
    expect(status().textContent, 'the line at the step before').not.toContain('little-endian')
  })

  it(
    'drops the words rather than wrap',
    async () => {
      await toEnd(tm())
      expect(reg().querySelector('.tm-result'), 'precondition: the result marked').not.toBeNull()
      expect(endian(), 'precondition: the words at the wide width').not.toBeNull()
      const whole = line().getBoundingClientRect().width
      const words = (endian() as HTMLElement).getBoundingClientRect().width
      expect(words, 'precondition: the words drawn').toBeGreaterThan(0)

      await widthOf(NARROW)
      expect(room(), 'precondition: too little room for the line with the words').toBeLessThan(whole)
      expect(room(), 'precondition: room for the line without them').toBeGreaterThanOrEqual(whole - words)
      expect(endian(), 'the words at the end').toBeNull()
      expect(status().textContent).toBe('halt · step 12,976 of 12,976 · width 4')
      expect(stateName().scrollWidth, 'the state name whole').toBeLessThanOrEqual(stateName().clientWidth)
      const end = shape()

      await back(tm())
      expect(shape(), 'the line at the end, as at the step before').toEqual(end)
      expect(end.rows, 'one row').toBe(1)
      await toEnd(tm())
      expect(endian(), 'the words at the end, drawn at the narrow width').toBeNull()
      expect(shape(), 'the line at the end again').toEqual(end)
    },
    CASE_MS,
  )

  it(
    'takes the words back when the line widens',
    async () => {
      await toEnd(tm())
      await widthOf(NARROW)
      await back(tm())
      await toEnd(tm())
      expect(endian(), 'precondition: the words dropped at the narrow width').toBeNull()

      await widthOf(WIDE)
      expect(stepOf(tm()), 'no step taken').toBe('step 12,976 of 12,976')
      expect(endian(), 'the words back').not.toBeNull()
      expect(status().textContent).toBe('halt · step 12,976 of 12,976 · width 4 · little-endian')
      expect(rowsOf(), 'the line one row').toBe(1)
    },
    CASE_MS,
  )

  it(
    'says nothing of bit order under unary, and boxes the part on screen',
    async () => {
      await userEvent.selectOptions(picker(), 'unary')
      await compile(view, PAST)
      await until(() => segments().some((s) => s.startsWith('TM 42 ')), "the readout's TM value")
      await until(() => /^step 0 of 2,870$/.test(stepOf(tm())), 'the TM view to record its run')
      await toEnd(tm())
      expect(stepOf(tm())).toBe('step 2,870 of 2,870')
      expect(status().textContent, 'no word of bit order').toBe('halt · step 2,870 of 2,870 · width 64')
      const cells = [...reg().querySelectorAll('.cell')]
      expect(cells.map((c) => c.textContent).join(''), 'precondition: REG ends inside field 0').toBe(
        `#${'1'.repeat(40)}`,
      )
      const field = reg().querySelector('.tm-result') as HTMLElement
      expect(field, 'the box in REG').not.toBeNull()
      expect([...field.children], 'the cells it holds').toEqual(cells.slice(1))
      expect(field.nextElementSibling?.className, 'the word after it').toBe('result-word')
    },
    CASE_MS,
  )
})
