import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  type HeapLine,
  lineRoom,
  lineText,
  NAME_CH,
  rowRoom,
  type ValueRow,
  type ValuesView,
  valuesRoom,
} from '../../src/machine-panels'

/**
 * THE ROOM THE MACHINE PANELS KEEP (the squeezed values design): the values grid's tracks as wide as the widest row the
 * run has needed, and each heap line as tall as its longest text, each only growing until the view forgets it at a new
 * program or listing. `tests/browser/machine-room.test.ts` holds what the page draws from them.
 */

/** A row of the values panel: rxm's register `name` reading `text`, or clif's with `regs` after it. */
function row(name: string, text: string, more: Partial<ValueRow> = {}): ValueRow {
  return { name, text, changed: false, unwritten: false, result: false, says: [], ...more }
}

/** A values panel of `rows` and no notes. */
const view = (...rows: ValueRow[]): ValuesView => ({ rows, notes: [] })

describe("a values row's room", () => {
  it('is its name, at least four columns, a column of gap, and its word', () => {
    expect(rowRoom(row('rr', '12'))).toBe(4 + 1 + 2)
    expect(rowRoom(row('rr', '479001600'))).toBe(4 + 1 + 9)
    expect(rowRoom(row('v1234', '0'))).toBe(5 + 1 + 1)
  })

  it("counts an unwritten local's mark in its name", () => {
    expect(rowRoom(row('r3', '0', { unwritten: true }))).toBe(4 + 1 + 1)
    expect(rowRoom(row('r10', '0', { unwritten: true }))).toBe(5 + 1 + 1)
  })

  it('counts the rxm registers a clif value stands for, after a space', () => {
    expect(rowRoom(row('v8', '479001600', { regs: ['rr'] }))).toBe(4 + 1 + 9 + 1 + 2)
    expect(rowRoom(row('v1', '0', { regs: ['rr', 'a0'] }))).toBe(4 + 1 + 1 + 1 + 6)
    expect(rowRoom(row('v2', '7', { regs: [] }))).toBe(4 + 1 + 1)
  })
})

describe("the values grid's room", () => {
  it("is the widest row's, and stays as wide when the row narrows again", () => {
    const room = valuesRoom()
    expect(room.take(view(row('pc', '20'), row('rr', '39916800')))).toBe(4 + 1 + 8)
    expect(room.take(view(row('pc', '20'), row('rr', '479001600')))).toBe(4 + 1 + 9)
    // A STEP BACK TO THE SHORTER VALUE MOVES NOTHING.
    expect(room.take(view(row('pc', '20'), row('rr', '39916800')))).toBe(4 + 1 + 9)
    expect(room.take(view())).toBe(4 + 1 + 9)
  })

  it("leaves the result's row out, which spans the grid and wraps", () => {
    const room = valuesRoom()
    expect(room.take(view(row('rr', '479001600', { result: true }), row('a0', '0'), row('r0', '12')))).toBe(4 + 1 + 2)
  })

  it('starts again from nothing once it forgets', () => {
    const room = valuesRoom()
    room.take(view(row('rr', '18446744073709551615')))
    room.forget()
    expect(room.take(view(row('rr', '12')))).toBe(4 + 1 + 2)
  })

  it('is 0 before any row', () => {
    expect(valuesRoom().take(view())).toBe(0)
  })
})

/** Heap cell `cell`'s line, its head `head` and tail `nil`, named by `refs`. */
const cell = (cell: number, head: string, ...refs: string[]): HeapLine => ({
  kind: 'line',
  lead: `#${cell}`,
  body: `${head} → nil`,
  refs,
  result: false,
})

describe("a heap line's text", () => {
  it('is its lead, its body, and the registers that name it after an arrow', () => {
    expect(lineText(cell(57, '57'))).toBe('#57 57 → nil')
    expect(lineText(cell(57, '57', 'r5', 'a0'))).toBe('#57 57 → nil ← r5, a0')
  })
})

describe("a heap line's room", () => {
  it('answers the longest text its lead has had where that is longer than its own, and nothing where it is not', () => {
    const room = lineRoom()
    expect(room.take(cell(1, '0', 'r0', 'r1'))).toBeNull()
    // FEWER REGISTERS NAME THE CELL: the line keeps the text that had more.
    expect(room.take(cell(1, '0'))).toBe('#1 0 → nil ← r0, r1')
    expect(room.take(cell(1, '0', 'r0'))).toBe('#1 0 → nil ← r0, r1')
    expect(room.take(cell(1, '0', 'r0', 'r1', 'r2'))).toBeNull()
    expect(room.take(cell(1, '0', 'r2'))).toBe('#1 0 → nil ← r0, r1, r2')
  })

  it('keeps each lead its own', () => {
    const room = lineRoom()
    room.take(cell(1, '0', 'r0', 'r1'))
    expect(room.take(cell(2, '0'))).toBeNull()
    expect(room.take(cell(1, '0'))).toBe('#1 0 → nil ← r0, r1')
  })

  it('starts again from nothing once it forgets', () => {
    const room = lineRoom()
    room.take(cell(1, '0', 'r0', 'r1'))
    room.forget()
    expect(room.take(cell(1, '0'))).toBeNull()
  })
})

describe("the stylesheet's values row, frame and heap line", () => {
  const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8')
  /** The declarations of the rule whose selectors are exactly `selector`: not one of a list that ends with it. */
  const rule = (selector: string): string => {
    for (let at = css.indexOf(`\n${selector} {`); at >= 0; at = css.indexOf(`\n${selector} {`, at + 1))
      if (css[at - 1] !== ',') return css.slice(at, css.indexOf('}', at))
    throw new Error(`no rule ${selector}`)
  }

  it("keeps the name's least width and the gap the room counts", () => {
    expect(rule('.rxm-register dt'), "the name's least width").toContain(`min-width: ${NAME_CH}ch;`)
    expect(rule('.rxm-register'), 'the gap after the name').toContain('gap: 1ch;')
  })

  it("adds the row's padding on both sides to the room, which the room leaves out", () => {
    expect(rule('.rxm-register'), "the row's padding").toContain('padding-inline: 0.25rem;')
    expect(rule('.rxm-register-list'), 'the track').toMatch(/var\(--values-room, 0ch\) \+ 0\.5rem/)
  })

  it("keeps a clif frame's pc as wide as the listing's widest, with none of the frame's indent", () => {
    expect(rule('.clif-pane .rxm-ret'), 'a box of its own').toContain('display: inline-block;')
    expect(rule('.clif-pane .rxm-ret'), 'the room').toContain('min-width: var(--ret-room, 0);')
    expect(rule('.clif-pane .rxm-ret'), 'no indent').toContain('text-indent: 0;')
  })

  it("lays a heap line's room out hidden in the cell of its text", () => {
    expect(rule('.rxm-cell-line::after'), 'the room').toContain('content: var(--line-room, none);')
    expect(rule('.rxm-cell-line::after'), 'hidden').toContain('visibility: hidden;')
    expect(rule('.rxm-cell-line > .rxm-line,\n.rxm-cell-line::after'), 'one cell').toContain('grid-area: 1 / 1;')
  })
})
