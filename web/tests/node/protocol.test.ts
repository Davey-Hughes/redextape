import { describe, expect, it } from 'vitest'
import { LEGS, mapLegs } from '../../src/legs'
import {
  CLIF_ABSENT,
  clifCompileStatus,
  clifFrameBytes,
  endOf,
  FRAME_OVERHEAD_BYTES,
  type HeldLegs,
  keepDecided,
  keepInFlight,
  type LambdaLeg,
  LEG_FRAME_BYTES,
  type Leg,
  lambdaFrameBytes,
  OWNER_BYTES,
  REDEX_SPAN_BYTES,
  type ResultLegs,
  RXM_WORD_BYTES,
  type RxmLeg,
  rxmFrameBytes,
  rxmRecordEnd,
  SPAN_BYTES,
  type TmLeg,
  tmFrameBytes,
} from '../../src/protocol'
import type { Classified, ClifState, Decoded, LambdaState, RxmStatus, TmState } from '../../src/types'
import { frameOf } from './rxm-fixtures'
import { spanBytes } from './span-bytes'

const lam = (text: string, spans: number): LambdaState => ({
  text,
  spans: spanBytes(Array.from({ length: spans }, (_, i) => [{ start: i, end: i + 1 }, 'Ident'] as Classified[number])),
  cut: null,
  step: 0,
  redex_span: null,
  owner: 'None',
})

const tm = (tapes: number, cells: number): TmState => ({
  state: 0,
  step: 0,
  heads: Array.from({ length: tapes }, () => 0),
  window_start: Array.from({ length: tapes }, () => 0),
  window: Array.from({ length: tapes }, () => '_'.repeat(cells)),
  source_node: null,
  rule: null,
})

describe('frame sizers', () => {
  // SPANS DOMINATE A λ FRAME at every text budget (`frame_cost_probe`'s figures are in
  // `lambdaFrameBytes`'s doc), so a sizer that counted only `text` would under-report and the ring
  // would evict far too late.
  it('counts spans, which dominate a λ frame', () => {
    const textOnly = lambdaFrameBytes(lam('x'.repeat(100), 0))
    const withSpans = lambdaFrameBytes(lam('x'.repeat(100), 50))
    expect(withSpans - textOnly).toBe(50 * SPAN_BYTES)
    expect(withSpans).toBeGreaterThan(textOnly * 10)
  })

  it('scales a λ frame with its text', () => {
    expect(lambdaFrameBytes(lam('x'.repeat(200), 0)) - lambdaFrameBytes(lam('x'.repeat(100), 0))).toBe(100)
  })

  it('counts a TM frame by its cells across every tape', () => {
    // Five tapes at radius 40 is at most 5 x 81 cells; `frame_cost_probe` measured ~550 bytes a frame there.
    const small = tmFrameBytes(tm(5, 10))
    const large = tmFrameBytes(tm(5, 20))
    expect(large).toBeGreaterThan(small)
    expect(tmFrameBytes(tm(5, 81))).toBeLessThan(2_000)
    // Pin the per-cell weight, not just monotonicity: `cells * 1` instead of `cells * 2` would pass
    // a bigger-input-bigger-number check and silently halve every TM frame's budgeted size.
    expect(tmFrameBytes(tm(5, 20)) - tmFrameBytes(tm(5, 10))).toBe(5 * 10 * 2)
  })

  it('counts a tape’s window in UTF-16 units, so a symbol outside the basic plane is four bytes', () => {
    // A TAPE IS ONE STRING, AND ITS LENGTH IS ITS COST: `𝟙` is one cell and two units. Counting cells instead would
    // give the same answer for every symbol in the basic plane and under-count this one.
    const one = (tape: string): TmState => ({ ...tm(1, 0), window: [tape] })
    expect(tmFrameBytes(one('1𝟙')) - tmFrameBytes(one('1'))).toBe(4)
  })

  it('never reports a frame as free', () => {
    expect(lambdaFrameBytes(lam('', 0))).toBeGreaterThan(0)
    expect(tmFrameBytes(tm(0, 0))).toBeGreaterThan(0)
  })
})

describe('lambdaFrameBytes', () => {
  const base: LambdaState = { text: 'ab', spans: new Uint8Array(), cut: null, step: 1, redex_span: null, owner: 'None' }

  // This alone cannot tell OWNER_BYTES from a dropped term: the surcharge is flat, so both sides move
  // together and a missing `+ OWNER_BYTES` would still pass. See the computed-total test below for
  // that guarantee.
  it('charges the same for every owner variant, since they are one tagged value', () => {
    const exact: LambdaState = { ...base, owner: { Exact: 3 } }
    const within: LambdaState = { ...base, owner: { Within: 3 } }
    expect(lambdaFrameBytes(exact)).toBe(lambdaFrameBytes(within))
  })

  // THE ONLY REDEX TERM IN THE SUM. The `Path` behind this span is not on the wire
  // (`LambdaState.redex`'s `serde(skip)`), so there is no per-entry term to charge and no sibling test
  // for one. The computed-total test below cannot stand in for this one: its reference formula is
  // built from the terms the implementation is documented to have, so a term missing from both passes
  // it. Charged only when there IS a span — most frames early in a run have none.
  it('charges for redex_span when the frame has one, and nothing when it does not', () => {
    const withSpan: LambdaState = { ...base, redex_span: { start: 3, end: 9 } }
    expect(lambdaFrameBytes(withSpan) - lambdaFrameBytes(base)).toBe(REDEX_SPAN_BYTES)
    expect(lambdaFrameBytes({ ...base, redex_span: null })).toBe(lambdaFrameBytes(base))
  })

  // A zero-width span is still a span the frame retains — `{ start: 0, end: 0 }` is one object on the
  // heap exactly like any other. A charge derived from the span's WIDTH rather than its existence
  // would pass every assertion above and report this frame as free.
  it('charges by the span existing, not by how wide it is', () => {
    const empty: LambdaState = { ...base, redex_span: { start: 0, end: 0 } }
    const wide: LambdaState = { ...base, redex_span: { start: 0, end: 4096 } }
    expect(lambdaFrameBytes(empty) - lambdaFrameBytes(base)).toBe(REDEX_SPAN_BYTES)
    expect(lambdaFrameBytes(wide)).toBe(lambdaFrameBytes(empty))
  })

  // Asserts against the constants, not a magic number, so a retuned constant does not break this test
  // — but a *term* dropped from the sum (e.g. `+ OWNER_BYTES` silently deleted) does, because the
  // right-hand side is built the same way `lambdaFrameBytes` is documented to compute it.
  //
  // THE FRAME CARRIES EVERY OPTIONAL COMPONENT: a test whose fixture omits a field can only ever be
  // tautological about that field.
  it('charges every component, so a dropped term is visible', () => {
    const f: LambdaState = {
      text: 'ab',
      spans: new Uint8Array(),
      cut: null,
      step: 1,
      redex_span: { start: 0, end: 2 },
      owner: { Exact: 3 },
    }
    expect(lambdaFrameBytes(f)).toBe(FRAME_OVERHEAD_BYTES + 2 + REDEX_SPAN_BYTES + OWNER_BYTES)
  })
})

describe('rxmFrameBytes', () => {
  const v = { word: '7', tag: 'Value' as const }

  it('charges every word a frame carries, and a byte per written bit', () => {
    expect(rxmFrameBytes(frameOf())).toBe(FRAME_OVERHEAD_BYTES + RXM_WORD_BYTES)
    const f = frameOf({
      locals: [v, v, v],
      written: [true, false, true],
      args: [v],
      frames: [{ ret_pc: 4, saved: [v, v], saved_len: 2 }],
      cells: [{ cell: 1, head: v, tail: v }],
      boxes: [{ handle: 1, content: v }],
    })
    // rr, three locals, one argument, two saved words, a cell's two halves and a box's content: ten words.
    expect(rxmFrameBytes(f)).toBe(FRAME_OVERHEAD_BYTES + 10 * RXM_WORD_BYTES + 3)
  })
})

/**
 * Two frames as `ClifSession.state` returned them under `CLIF_WINDOW`, both of programs as built. The first is
 * `let xs = cons(1, cons(2, nil)); let mut v = 2; let get = |x| v + x; get(head(xs))` at step 64: three values, two
 * call-stack entries, four cells and a box. The second is `fact.rxt` at step 95: seventeen values, four entries and
 * no heap, so a charge that drops the call stack is told apart from one that drops the heap.
 */
const CELLS_AND_BOX: ClifState = {
  step: 64,
  at: { function: 1, inst: 0 },
  next: { function: 1, inst: 0 },
  pc: null,
  values: [
    { value: 0, word: { word: '0', tag: 'Value' }, regs: [] },
    { value: 1, word: { word: '4', tag: 'List' }, regs: ['a0'] },
    { value: 2, word: { word: '1', tag: 'Value' }, regs: ['a1'] },
  ],
  values_len: 3,
  depth: 2,
  frames: [
    { function: 1, inst: 0 },
    { function: 0, inst: 63 },
  ],
  heap_len: 4,
  cells: [
    { cell: 4, head: { word: '0', tag: 'Value' }, tail: { word: '3', tag: 'List' } },
    { cell: 3, head: { word: '1', tag: 'Box' }, tail: { word: '0', tag: 'Value' } },
    { cell: 2, head: { word: '1', tag: 'Value' }, tail: { word: '1', tag: 'List' } },
    { cell: 1, head: { word: '2', tag: 'Value' }, tail: { word: '0', tag: 'Value' } },
  ],
  box_len: 1,
  boxes: [{ handle: 1, content: { word: '2', tag: 'Value' } }],
}
const DEEP: ClifState = {
  step: 95,
  at: { function: 1, inst: 27 },
  next: { function: 1, inst: 27 },
  pc: 11,
  values: [
    { value: 0, word: { word: '0', tag: 'Value' }, regs: [] },
    { value: 1, word: { word: '2', tag: 'Value' }, regs: ['a0'] },
    { value: 2, word: { word: '0', tag: 'Value' }, regs: ['r0'] },
    { value: 3, word: { word: '0', tag: 'Value' }, regs: ['r1'] },
    { value: 4, word: { word: '0', tag: 'Value' }, regs: ['r2'] },
    { value: 5, word: { word: '0', tag: 'Value' }, regs: ['r3'] },
    { value: 6, word: { word: '0', tag: 'Value' }, regs: ['r4'] },
    { value: 7, word: { word: '0', tag: 'Value' }, regs: ['r5'] },
    { value: 8, word: { word: '0', tag: 'Value' }, regs: ['r6'] },
    { value: 9, word: { word: '0', tag: 'Value' }, regs: ['r7'] },
    { value: 10, word: { word: '0', tag: 'Value' }, regs: ['r8'] },
    { value: 11, word: { word: '0', tag: 'Value' }, regs: ['rr'] },
    { value: 14, word: { word: '0', tag: 'Value' }, regs: ['r3'] },
    { value: 17, word: { word: '0', tag: 'Value' }, regs: [] },
    { value: 18, word: { word: '0', tag: 'Value' }, regs: ['r1'] },
    { value: 23, word: { word: '1', tag: 'Value' }, regs: ['r8'] },
    { value: 26, word: { word: '1', tag: 'Value' }, regs: [] },
  ],
  values_len: 17,
  depth: 4,
  frames: [
    { function: 1, inst: 27 },
    { function: 1, inst: 32 },
    { function: 1, inst: 32 },
    { function: 0, inst: 10 },
  ],
  heap_len: 0,
  cells: [],
  box_len: 0,
  boxes: [],
}

describe('clifFrameBytes', () => {
  it('is the charge LEG_FRAME_BYTES gives a CLIF frame', () => {
    expect(LEG_FRAME_BYTES.clif).toBe(clifFrameBytes)
  })

  it('charges each value’s word and register names, each call-stack entry, both halves of each cell and each box’s content', () => {
    // 3 values, 2 register names, 2 entries, 4 cells' 8 halves and 1 box: 16 words, at CLIF_WORD_BYTES 60, beside
    // FRAME_OVERHEAD_BYTES 64 and CLIF_FRAME_BYTES 236.
    expect(clifFrameBytes(CELLS_AND_BOX)).toBe(1260)
  })

  it('charges a deep frame’s call stack with no heap', () => {
    // 17 values, 14 register names and 4 entries: 35 words, at CLIF_WORD_BYTES 60, beside the 300 bytes above.
    expect(clifFrameBytes(DEEP)).toBe(2400)
  })
})

describe('clifCompileStatus', () => {
  const AVAILABLE: RxmStatus = { available: true, reason: '', run: 'Ended', cap: null, total_steps: 4 }
  // The rxm leg's TooDeep sentence (`session.rs`).
  const REASON = 'the program nests deeper than the rxm lowering guard allows'
  const DECLINED: RxmStatus = { available: false, reason: REASON, run: null, cap: null, total_steps: null }
  const NOTHING_RUN = { run: null, cap: null, total_steps: null }

  it('is available, with nothing run, when the rxm leg is and a CLIF view is shown', () => {
    expect(clifCompileStatus(AVAILABLE, 'as-built')).toEqual({ available: true, reason: '', ...NOTHING_RUN })
  })

  it('is unavailable, with no reason, when no CLIF view is shown', () => {
    expect(clifCompileStatus(AVAILABLE, null)).toEqual({ available: false, reason: '', ...NOTHING_RUN })
  })

  it("is unavailable with the rxm leg's reason when the rxm leg declined", () => {
    expect(clifCompileStatus(DECLINED, 'as-built')).toEqual({ available: false, reason: REASON, ...NOTHING_RUN })
    expect(clifCompileStatus(DECLINED, null)).toEqual({ available: false, reason: REASON, ...NOTHING_RUN })
  })
})

describe('rxmRecordEnd', () => {
  it('ends a halt or a fault, and names each full cap, and calls only the step cap capped', () => {
    expect(rxmRecordEnd({ run: 'Ended', cap: null })).toBe('ended')
    expect(rxmRecordEnd({ run: 'Capped', cap: 'Steps' })).toBe('capped')
    expect(rxmRecordEnd({ run: 'Capped', cap: 'Stack' })).toBe('stack-full')
    expect(rxmRecordEnd({ run: 'Capped', cap: 'Heap' })).toBe('heap-full')
    expect(rxmRecordEnd({ run: 'Capped', cap: 'Mem' })).toBe('memory-full')
  })

  it('reads a capped run naming no cap as the step cap, a case that cannot occur', () => {
    expect(rxmRecordEnd({ run: 'Capped', cap: null })).toBe('capped')
  })

  it('reads a run that is still going as ended, so that `extendLeg` raises no cap at a `budget` stop', () => {
    expect(rxmRecordEnd({ run: 'Running', cap: null })).toBe('ended')
  })
})

describe('endOf', () => {
  it('calls a capped λ or TM run capped, and a depth refusal depth-refused', () => {
    expect(endOf('Capped')).toBe('capped')
    expect(endOf('DepthRefused')).toBe('depth-refused')
  })

  it('ends a finished run, a running one and an absent leg alike, so that `extendLeg` raises no cap at a `budget` stop', () => {
    expect(endOf('Ended')).toBe('ended')
    expect(endOf('Running')).toBe('ended')
    expect(endOf(null)).toBe('ended')
  })
})

/** One leg's part of a `result`, decided or not, at a step that tells the parts apart. */
const lambda = (value: Decoded | null, step: number): LambdaLeg => ({
  status: { available: true, reason: '', node: null, run: value === 'Unfinished' ? 'Capped' : 'Ended' },
  state: { ...lam(`t${step}`, 0), step },
  value,
  declinedSpan: null,
})
const rxm = (value: Decoded | null): RxmLeg => ({
  status: { available: true, reason: '', run: 'Ended', cap: null, total_steps: 4 },
  value,
})
const tmLeg = (value: Decoded | null): TmLeg => ({
  status: { available: true, reason: '', width: 4, run: 'Ended', total_steps: 9 },
  value,
})
const TWO: Decoded = { Value: { text: '2' } }
const legs = (l: LambdaLeg, r: RxmLeg, t: TmLeg): ResultLegs => ({ lambda: l, rxm: r, tm: t, clif: CLIF_ABSENT })

describe('mapLegs', () => {
  it('builds one entry per leg, in `LEGS` order, calling `value` once for each', () => {
    const called: Leg[] = []
    const table = mapLegs<Record<Leg, string>>((leg) => {
      called.push(leg)
      return `${leg} entry`
    })
    expect(called).toEqual(LEGS)
    expect(Object.entries(table)).toEqual(LEGS.map((leg) => [leg, `${leg} entry`]))
  })
})

/**
 * A rewind posts no `result`, so the readout keeps a leg's decided value across it (spec §11 call 6), and the next
 * `result` must not take that value away with the rewound cursor's `Unfinished`. An undecided part, a count of
 * reductions so far, is replaced, so it drops back to where the rewound recording stands.
 */
describe('keepDecided', () => {
  it('answers the new legs whole when nothing was posted before', () => {
    const next = legs(lambda('Unfinished', 5), rxm('Unfinished'), tmLeg('Unfinished'))
    expect(keepDecided(null, next)).toBe(next)
  })

  it('keeps each leg’s decided part where the new one is unfinished, a fault and an undecodable value among them', () => {
    const prev = legs(lambda(TWO, 40), rxm({ Fault: { message: 'stack' } }), tmLeg('Undecodable'))
    const next = legs(lambda('Unfinished', 5), rxm('Unfinished'), tmLeg('Unfinished'))
    expect(keepDecided(prev, next)).toEqual(prev)
  })

  it('takes the new part in the other pairings: decided twice, decided after undecided, and undecided twice', () => {
    const three: Decoded = { Value: { text: '3' } }
    expect(
      keepDecided(legs(lambda(TWO, 40), rxm(TWO), tmLeg(TWO)), legs(lambda(three, 41), rxm(three), tmLeg(three))),
    ).toEqual(legs(lambda(three, 41), rxm(three), tmLeg(three)))
    expect(
      keepDecided(legs(lambda('Unfinished', 9), rxm(null), tmLeg(null)), legs(lambda(TWO, 40), rxm(TWO), tmLeg(TWO))),
    ).toEqual(legs(lambda(TWO, 40), rxm(TWO), tmLeg(TWO)))
    // THE DROP-BACK: an unfinished λ seen at step 900 and then, after a rewind, at step 300 reads step 300.
    const after = legs(lambda('Unfinished', 300), rxm('Unfinished'), tmLeg('Unfinished'))
    expect(keepDecided(legs(lambda('Unfinished', 900), rxm(null), tmLeg('Unfinished')), after)).toEqual(after)
  })

  it('judges the legs apart: a decided λ is kept while the TM leg moves on', () => {
    const prev = legs(lambda(TWO, 40), rxm('Unfinished'), tmLeg('Unfinished'))
    const next = legs(lambda('Unfinished', 5), rxm('Unfinished'), tmLeg(TWO))
    expect(keepDecided(prev, next)).toEqual(legs(lambda(TWO, 40), rxm('Unfinished'), tmLeg(TWO)))
  })
})

/**
 * A rewind posts no `result`, so a `result` another request posts while the rewound leg's fill records must not read
 * that leg mid-way: it keeps the part last posted, or before any was the one the rewind found, as the readout kept it
 * across the rewind (spec §5.2).
 */
describe('keepInFlight', () => {
  const none = { lambda: false, rxm: false, tm: false, clif: false }
  const all = { lambda: true, rxm: true, tm: true, clif: true }

  it('reads a leg with no part held as it stands, recording or not', () => {
    const next = legs(lambda('Unfinished', 5), rxm('Unfinished'), tmLeg('Unfinished'))
    expect(keepInFlight({ lambda: null, rxm: null, tm: null, clif: null }, next, all)).toEqual(next)
  })

  it('keeps a part held for one leg alone while it records, as a rewind before the first result holds one', () => {
    const next = legs(lambda('Unfinished', 256), rxm(TWO), tmLeg('Unfinished'))
    const held: HeldLegs = { lambda: lambda('Unfinished', 1846), rxm: null, tm: null, clif: null }
    expect(keepInFlight(held, next, all)).toEqual(legs(lambda('Unfinished', 1846), rxm(TWO), tmLeg('Unfinished')))
    expect(keepInFlight(held, next, none)).toEqual(next)
  })

  it('keeps the posted part of each leg still recording, whatever either value is, and takes the rest new', () => {
    const prev = legs(lambda('Unfinished', 900), rxm('Unfinished'), tmLeg('Unfinished'))
    const next = legs(lambda('Unfinished', 256), rxm(TWO), tmLeg(TWO))
    expect(keepInFlight(prev, next, { lambda: true, rxm: true, tm: false, clif: false })).toEqual(
      legs(lambda('Unfinished', 900), rxm('Unfinished'), tmLeg(TWO)),
    )
    expect(keepInFlight(prev, next, none)).toEqual(next)
  })
})
