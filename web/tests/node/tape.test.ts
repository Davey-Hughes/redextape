import { describe, expect, it } from 'vitest'
import { tapeLabel, tapeRows } from '../../src/tape'
import type { TmState } from '../../src/types'

const NAMES = ['REG', 'WORK', 'STACK', 'HEAP', 'BOX']

const state = (over: Partial<TmState> = {}): TmState => ({
  state: 0,
  step: 0,
  heads: [5],
  window_start: [3],
  window: [['a', 'b', 'c', 'd', 'e']],
  source_node: null,
  rule: null,
  ...over,
})

describe('tapeRows', () => {
  // THE ONE PIECE OF ARITHMETIC IN THE TM PANE. `heads` and `window_start` are both
  // MATERIALIZED-TAPE coordinates (`viewmodel.rs`'s `TmState` struct doc), so the head's position
  // inside the window is their difference. Getting it wrong draws the marker on the wrong cell,
  // silently.
  it('places the head at heads[i] - window_start[i]', () => {
    const [row] = tapeRows(state(), NAMES)
    expect(row?.headIndex).toBe(2)
    expect(row?.cells[row.headIndex]).toBe('c')
    expect(row?.headInWindow).toBe(true)
  })

  it('places the head at 0 when the window starts at the head', () => {
    const [row] = tapeRows(state({ heads: [0], window_start: [0] }), NAMES)
    expect(row?.headIndex).toBe(0)
    expect(row?.headInWindow).toBe(true)
  })

  it('reports a head outside the window rather than clamping it', () => {
    // Not expected from `Tape::window`, which centres on the head — but a clamp would HIDE a
    // coordinate bug, and the pane can simply draw no marker.
    const [row] = tapeRows(state({ heads: [99], window_start: [3] }), NAMES)
    expect(row?.headIndex).toBe(96)
    expect(row?.headInWindow).toBe(false)
  })

  it('reports a head before the window as a negative index, not a clamped one', () => {
    const [row] = tapeRows(state({ heads: [1], window_start: [3] }), NAMES)
    expect(row?.headIndex).toBe(-2)
    expect(row?.headInWindow).toBe(false)
  })

  it('labels each tape from the names it was given', () => {
    const s = state({
      heads: [0, 0, 0, 0, 0],
      window_start: [0, 0, 0, 0, 0],
      window: [['a'], ['b'], ['c'], ['d'], ['e']],
    })
    expect(tapeRows(s, NAMES).map((r) => r.label)).toEqual(NAMES)
  })

  // `tapeNames()` describes machines THIS compiler produced. A hand-written machine (Plan 5d) may
  // declare up to MAX_TAPES, and a positional label is the honest answer past the array's end.
  it('falls back to a positional label past the end of the names', () => {
    const s = state({ heads: [0, 0], window_start: [0, 0], window: [['a'], ['b']] })
    expect(tapeRows(s, ['ONLY']).map((r) => r.label)).toEqual(['ONLY', 'tape 1'])
  })

  it('returns one row per tape in the window, and no rows for none', () => {
    expect(tapeRows(state({ heads: [], window_start: [], window: [] }), NAMES)).toEqual([])
  })
})

describe('tapeLabel', () => {
  it("says the tape, the head's cell on the whole tape, and what it reads", () => {
    // The head is at cell 5 of the tape and index 2 of the window: the label says 5, and reads the window's 2.
    const [row] = tapeRows(state(), NAMES)
    expect(row === undefined ? '' : tapeLabel(row)).toBe('tape REG, head at cell 5, reading c')
  })

  it('says the blank symbol as a word', () => {
    const [row] = tapeRows(state({ window: [['a', 'b', '_', 'd', 'e']] }), NAMES)
    expect(row === undefined ? '' : tapeLabel(row)).toBe('tape REG, head at cell 5, reading blank')
  })

  it('says a head outside the window rather than reading a cell it is not on', () => {
    const [row] = tapeRows(state({ heads: [99], window_start: [3] }), NAMES)
    expect(row === undefined ? '' : tapeLabel(row)).toBe('tape REG, head at cell 99, outside the window')
  })

  it('names an unnamed tape once, not twice', () => {
    const [row] = tapeRows(state(), [])
    expect(row === undefined ? '' : tapeLabel(row)).toBe('tape 0, head at cell 5, reading c')
  })
})
