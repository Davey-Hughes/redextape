import { describe, expect, it } from 'vitest'
import { CLIF_ABSENT, type LambdaTreeWire, type RecordEnd } from '../../src/protocol'
import type { ProgramResult } from '../../src/readout'
import { lambdaEnded, type MarkedLeg, RUN_ENDED, resultMarked } from '../../src/result-mark'
import type { Decoded, TmState } from '../../src/types'
import { FACT_95 } from './clif-frames'
import { frameOf, rxmSnapshot } from './rxm-fixtures'

/**
 * WHEN A VIEW MARKS THE RUN'S RESULT (the return-value highlight design, *When the mark shows*): a value of the
 * frames' generation, at the newest step of a recording that ended, with the frame on screen proving the run's end.
 * Each case changes one condition of a leg that marks, so a test that dropped would let that one through.
 */

const GEN = 3

/** A result of generation `gen` whose rxm leg answered `value`; the other legs answer nothing this file reads. */
const resultOf = (value: Decoded | null, gen = GEN): ProgramResult => ({
  kind: 'result',
  gen,
  legs: { lambda: null, rxm: { ...rxmSnapshot('Ended'), value }, tm: null, clif: CLIF_ABSENT } as never,
  pinned: false,
})

const FIFTEEN = resultOf({ Value: { text: '15' } })

/** The rxm leg at the newest of ten frames of generation 3, its recording ended. */
const AT_END: MarkedLeg = { gen: GEN, done: 'ended', hist: { head: 9, length: 10 } }

const tm = (rule: number | null): TmState => ({
  state: 0,
  step: 0,
  heads: [0],
  window_start: [0],
  window: ['#'],
  source_node: null,
  rule,
})

const tree = (nextRedex: number | null): LambdaTreeWire => ({
  step: 0,
  refused: null,
  kind: new Uint8Array([0]),
  left: new Uint32Array([0]),
  right: new Uint32Array([0]),
  name: new Uint32Array([0]),
  hint: new Uint32Array([0]),
  link: new Uint32Array([0xffff_ffff]),
  names: ['x'],
  nextRedex,
  contractum: null,
})

describe('the result mark', () => {
  it('marks a finished value at the newest step, and nothing when any one condition fails', () => {
    expect(resultMarked(FIFTEEN, 'rxm', AT_END, true)).toBe(true)

    expect(resultMarked(null, 'rxm', AT_END, true), 'no result').toBe(false)
    expect(resultMarked({ kind: 'error', error: 'x' }, 'rxm', AT_END, true), 'an error').toBe(false)
    expect(resultMarked({ kind: 'no-session', diagnostics: [] }, 'rxm', AT_END, true), 'no session').toBe(false)
    expect(resultMarked(FIFTEEN, 'rxm', { ...AT_END, gen: 2 }, true), 'frames of another generation').toBe(false)
    const ends: (RecordEnd | null)[] = ['capped', 'depth-refused', 'budget', 'stack-full', 'heap-full', 'memory-full']
    for (const done of [...ends, null]) {
      expect(resultMarked(FIFTEEN, 'rxm', { ...AT_END, done }, true), `a recording that stopped ${done}`).toBe(false)
    }
    expect(resultMarked(FIFTEEN, 'rxm', { ...AT_END, hist: { head: 8, length: 10 } }, true), 'a step back').toBe(false)
    expect(resultMarked(FIFTEEN, 'rxm', { ...AT_END, hist: { head: 0, length: 0 } }, true), 'no frames').toBe(false)
    expect(resultMarked(FIFTEEN, 'rxm', AT_END, false), 'a frame that does not prove the end').toBe(false)
    const others: (Decoded | null)[] = [
      'TooLargeToPrint',
      'Undecodable',
      'Unfinished',
      { Fault: { message: 'head of empty list at pc1' } },
      null,
    ]
    for (const value of others) {
      expect(resultMarked(resultOf(value), 'rxm', AT_END, true), `the value ${JSON.stringify(value)}`).toBe(false)
    }
    expect(resultMarked(resultOf({ Value: { text: '()' } }), 'rxm', AT_END, true), 'a Unit value').toBe(false)
  })

  it("reads each leg's own value, never another leg's", () => {
    // A TM THAT OUTGREW ITS FIELD halts with no rule to fire and its recording ended, as one that holds the value does,
    // while the other legs end with the program's value: its own `Fault` is all that leaves it unmarked.
    const overflowed: ProgramResult = {
      kind: 'result',
      gen: GEN,
      legs: {
        lambda: null,
        rxm: { ...rxmSnapshot('Ended'), value: { Value: { text: '18' } } },
        tm: {
          status: { available: true, reason: '', width: 4, run: 'Ended', total_steps: 299 },
          value: { Fault: { message: 'a number the machine stores outgrew the 4-cell tape field' } },
        },
        clif: CLIF_ABSENT,
      } as never,
      pinned: false,
    }
    expect(resultMarked(overflowed, 'rxm', AT_END, true), 'the control: the rxm leg, which ended with 18').toBe(true)
    expect(resultMarked(overflowed, 'tm', AT_END, true), 'the TM leg, which overflowed').toBe(false)
  })

  it("reads the run's end off the frame", () => {
    expect(RUN_ENDED.rxm(frameOf({ next: null }))).toBe(true)
    expect(RUN_ENDED.rxm(frameOf({ next: 3 }))).toBe(false)
    expect(RUN_ENDED.tm(tm(null))).toBe(true)
    expect(RUN_ENDED.tm(tm(0))).toBe(false)
    expect(RUN_ENDED.clif({ ...FACT_95, next: null, returned: 8 })).toBe(true)
    expect(RUN_ENDED.clif({ ...FACT_95, next: null, returned: null }), 'a fault or a trap').toBe(false)
    expect(RUN_ENDED.clif({ ...FACT_95, returned: 8 }), 'a frame with an instruction to run').toBe(false)

    expect(lambdaEnded({ kind: 'tree', tree: tree(null) })).toBe(true)
    expect(lambdaEnded({ kind: 'tree', tree: tree(0) })).toBe(false)
    expect(lambdaEnded({ kind: 'stale', tree: tree(null) }), 'a tree of another step').toBe(false)
    expect(lambdaEnded({ kind: 'refused', nodes: 9 })).toBe(false)
    expect(lambdaEnded({ kind: 'none' })).toBe(false)
  })

  it('follows the result alone', () => {
    expect(resultMarked(null, 'rxm', AT_END, true), 'before the result').toBe(false)
    expect(resultMarked(FIFTEEN, 'rxm', AT_END, true), 'once it lands').toBe(true)
  })
})
