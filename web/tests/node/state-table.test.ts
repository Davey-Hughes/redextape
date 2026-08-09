import { describe, expect, it } from 'vitest'
import { centredScrollTop, Follow, highlight, linkedRows, ROW_HEIGHT, StateIndex } from '../../src/state-table'
import type { RuleView, StateView, TmProgram, TmState } from '../../src/types'

const rule = (next: number): RuleView => ({
  read: [null, 'a', null, null, null],
  write: ['b', null, null, null, null],
  moves: ['R', 'S', 'S', 'S', 'L'],
  next,
})

const st = (name: string, rules: number, accept = false): StateView => ({
  name,
  accept,
  rules: Array.from({ length: rules }, (_, i) => rule(i)),
})

// 3 rules, then 0 (a `halt`-shaped state), then 2, then 1 => rows 0..9
//   0 s0        4 s1(halt)   5 s2        8 s3
//   1 s0.r0                  6 s2.r0     9 s3.r0
//   2 s0.r1                  7 s2.r1
//   3 s0.r2
const program = (): TmProgram => ({
  states: [st('s0', 3), st('s1', 0, true), st('s2', 2), st('s3', 1)],
  alphabet: ['a', 'b'],
  tapes: 5,
  width: 64,
  start: 0,
})

const frame = (over: Partial<TmState> = {}): TmState => ({
  state: 0,
  step: 0,
  heads: [0],
  window_start: [0],
  window: [['a']],
  source_node: null,
  rule: null,
  ...over,
})

describe('StateIndex', () => {
  it('counts one row per state plus one per rule', () => {
    expect(new StateIndex(program()).rowCount).toBe(10)
  })

  it('places each state header at its prefix sum', () => {
    const i = new StateIndex(program())
    expect([0, 1, 2, 3].map((s) => i.rowOfState(s))).toEqual([0, 4, 5, 8])
  })

  // EVERY BOUNDARY, because `i === rowStart[s]` is one comparison away from rendering every state's
  // rule 0 as a header, and a spot check in the middle of a block would not see it.
  it('resolves a header row, its first rule, and its last rule', () => {
    const i = new StateIndex(program())
    expect(i.row(0)).toMatchObject({ kind: 'state', id: 0, name: 's0', accept: false })
    expect(i.row(1)).toMatchObject({ kind: 'rule', stateId: 0, ruleIndex: 0 })
    expect(i.row(3)).toMatchObject({ kind: 'rule', stateId: 0, ruleIndex: 2 })
  })

  it('resolves the row after a state block as the NEXT state header, not a fourth rule', () => {
    expect(new StateIndex(program()).row(4)).toMatchObject({ kind: 'state', id: 1, name: 's1', accept: true })
  })

  it('gives a zero-rule state exactly one row, and the next state starts immediately after', () => {
    const i = new StateIndex(program())
    expect(i.row(4)).toMatchObject({ kind: 'state', id: 1 })
    expect(i.row(5)).toMatchObject({ kind: 'state', id: 2 })
  })

  it('resolves the first and last rows of the whole table', () => {
    const i = new StateIndex(program())
    expect(i.row(0)).toMatchObject({ kind: 'state', id: 0 })
    expect(i.row(9)).toMatchObject({ kind: 'rule', stateId: 3, ruleIndex: 0 })
  })

  it('answers null outside the table rather than throwing or clamping', () => {
    const i = new StateIndex(program())
    expect(i.row(-1)).toBeNull()
    expect(i.row(10)).toBeNull()
  })

  it("carries a rule's fields through unchanged, wildcards included", () => {
    const r = new StateIndex(program()).row(1)
    expect(r).toMatchObject({
      kind: 'rule',
      read: [null, 'a', null, null, null],
      write: ['b', null, null, null, null],
      moves: ['R', 'S', 'S', 'S', 'L'],
      next: 0,
    })
  })

  it('reports an empty table for a program with no states', () => {
    const i = new StateIndex({ ...program(), states: [] })
    expect(i.rowCount).toBe(0)
    expect(i.row(0)).toBeNull()
  })

  // The binary search must be O(log n), and correct at scale is the half a test can check.
  it('resolves correctly at 33,699 states, which is list60', () => {
    const states = Array.from({ length: 33_699 }, (_, s) => st(`s${s}`, 2))
    const i = new StateIndex({ ...program(), states })
    expect(i.rowCount).toBe(33_699 * 3)
    expect(i.rowOfState(33_698)).toBe(33_698 * 3)
    expect(i.row(33_698 * 3)).toMatchObject({ kind: 'state', id: 33_698 })
    expect(i.row(33_698 * 3 + 2)).toMatchObject({ kind: 'rule', stateId: 33_698, ruleIndex: 1 })
  })
})

describe('highlight', () => {
  it('names the state header row and the rule row beneath it', () => {
    const i = new StateIndex(program())
    expect(highlight(i, frame({ state: 2, rule: 1 }))).toEqual({ stateRow: 5, ruleRow: 7 })
  })

  it('names the header alone when no rule matches', () => {
    const i = new StateIndex(program())
    expect(highlight(i, frame({ state: 1, rule: null }))).toEqual({ stateRow: 4, ruleRow: -1 })
  })

  it('highlights nothing without a frame', () => {
    expect(highlight(new StateIndex(program()), null)).toBeNull()
  })
})

describe('centredScrollTop', () => {
  // Same numbers as `Follow`'s "centres the current row" test below, so the two are visibly answering
  // the same question: row 100 of 24px, 240px viewport: centre puts its top at 2400 - 120 + 12 = 2292.
  it('centres a row, not the top of a row', () => {
    expect(centredScrollTop(100, 24, 240, 10_000)).toBe(2292)
  })

  // THE TERM `setLink` WAS MISSING. Without `+ Math.floor(rowHeight / 2)` this would be 2280 — the
  // row's top edge at the viewport's centre, not the row's own centre. An odd row height makes the
  // `Math.floor` in that term load-bearing too: 24 -> 12 exactly, 25 -> 12 (not 12.5).
  it('the middle-of-row term is not the row height itself', () => {
    expect(centredScrollTop(100, 24, 240, 10_000)).not.toBe(100 * 24 - 120)
    expect(centredScrollTop(100, 25, 240, 10_000)).toBe(100 * 25 - 120 + 12)
  })

  it('clamps the target at both ends rather than scrolling out of the document', () => {
    expect(centredScrollTop(0, 24, 240, 10_000)).toBe(0)
    expect(centredScrollTop(416, 24, 240, 10_000)).toBe(10_000 - 240)
  })

  // A LINK SCROLL AND A FOLLOW SCROLL MUST AGREE. This is the property the two call sites drifted on
  // once already — `TmPane.setLink` centred a row's top edge while `Follow.targetScrollTop` centred its
  // middle, about 12px apart on the same gesture. Sharing this function is what makes them the same
  // number now, checked here directly rather than only through each caller's own test.
  it('agrees with a following `Follow.targetScrollTop` for the same row', () => {
    const f = new Follow()
    expect(f.targetScrollTop(250, 24, 300, 50_000)).toBe(centredScrollTop(250, 24, 300, 50_000))
  })
})

describe('Follow', () => {
  it('follows by default and centres the current row', () => {
    const f = new Follow()
    expect(f.following).toBe(true)
    // row 100 of 24px, 240px viewport: centre puts its top at 2400 - 120 + 12 = 2292.
    expect(f.targetScrollTop(100, 24, 240, 10_000)).toBe(2292)
  })

  it('clamps the target at both ends rather than scrolling out of the document', () => {
    const f = new Follow()
    expect(f.targetScrollTop(0, 24, 240, 10_000)).toBe(0)
    expect(f.targetScrollTop(416, 24, 240, 10_000)).toBe(10_000 - 240)
  })

  it('proposes nothing once detached', () => {
    const f = new Follow()
    f.onScroll(500)
    expect(f.following).toBe(false)
    expect(f.targetScrollTop(100, 24, 240, 10_000)).toBeNull()
  })

  // THE TRAP IN THIS FILE. Following SETS scrollTop, the browser fires `scroll` for it, and a naive
  // handler reads its own write as the user taking control — so following detaches on the first frame
  // and never works again. Nothing about it looks broken; the table simply stops following.
  it('does not detach on the scroll event its own write caused', () => {
    const f = new Follow()
    const top = f.targetScrollTop(100, 24, 240, 10_000)
    expect(top).not.toBeNull()
    if (top === null) return
    f.onProgrammaticScroll(top)
    f.onScroll(top)
    expect(f.following).toBe(true)
  })

  it('still detaches on a real scroll that follows a programmatic one', () => {
    const f = new Follow()
    f.onProgrammaticScroll(2292)
    f.onScroll(2292)
    f.onScroll(40)
    expect(f.following).toBe(false)
  })

  // THE TOLERANCE'S MAGNITUDE, tested directly. A trap test that only ever checks an exact echo (diff
  // 0) passes even with a tolerance of 0 — this is the test that makes "half a row" load-bearing.
  it('does not detach on an echo that lands a few pixels off the requested position', () => {
    const f = new Follow()
    f.onProgrammaticScroll(1000)
    f.onScroll(1005)
    expect(f.following).toBe(true)
  })

  it('detaches on a scroll that lands more than half a row from the requested position', () => {
    const f = new Follow()
    f.onProgrammaticScroll(1000)
    f.onScroll(1000 + ROW_HEIGHT / 2 + 1)
    expect(f.following).toBe(false)
  })

  // A second `scroll` event for the SAME write is plausible under smooth scrolling, layout reflow, or a
  // browser that does not coalesce. The first echo must not clear `#expected` and leave the second to
  // fall into the detach branch — that is the exact failure this class exists to prevent, one layer down.
  it('absorbs a second echo for the same programmatic write', () => {
    const f = new Follow()
    f.onProgrammaticScroll(1000)
    f.onScroll(1000)
    f.onScroll(1000)
    expect(f.following).toBe(true)
  })

  it('reattaches on demand', () => {
    const f = new Follow()
    f.onScroll(500)
    f.attach()
    expect(f.following).toBe(true)
    expect(f.targetScrollTop(100, 24, 240, 10_000)).toBe(2292)
  })
})

describe('linkedRows', () => {
  // s2's block (rows 5-7) is NOT contiguous with row 0 — s0's block (0-3) sits ahead of it and s1's
  // single header row (4) sits between. A `linkedRows` that ignored `rowOfState` and always started
  // scanning at row 0 would still pass a test that only ever linked s0.
  it('covers each linked state header and every one of its rule rows', () => {
    const i = new StateIndex(program())
    expect([...linkedRows(i, [0])].sort((x, y) => x - y)).toEqual([0, 1, 2, 3])
    expect([...linkedRows(i, [2])].sort((x, y) => x - y)).toEqual([5, 6, 7])
    expect([...linkedRows(i, [0, 3])].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 8, 9])
  })

  it('is a single row for a state with no rules', () => {
    const i = new StateIndex(program())
    expect([...linkedRows(i, [1])]).toEqual([4])
  })

  it('is empty for no states, and ignores a state id past the end', () => {
    const i = new StateIndex(program())
    expect(linkedRows(i, []).size).toBe(0)
    expect(linkedRows(i, [99]).size).toBe(0)
  })
})
