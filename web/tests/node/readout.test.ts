import { describe, expect, it } from 'vitest'
import { CLIF_ABSENT, type RecordEnd } from '../../src/protocol'
import { programRows, programSegments } from '../../src/readout'
import { rxmSnapshot } from './rxm-fixtures'

const LAMBDA = {
  status: { available: true, reason: '', run: 'Ended' as const, node: null },
  state: { text: '42', step: 7, cut: null, owner: 'None' as const },
  value: { Value: { text: '42' } },
}
const RXM = rxmSnapshot('Ended')
const TM = {
  status: { available: true, reason: '', width: 8, total_steps: 2870, run: 'Halted' as const, node: null },
  value: { Value: { text: '42' } },
}

/** The generation every result and recording below is for, unless a case says otherwise. */
const GEN = 3
const leg = (newestStep: number, done: RecordEnd | null) => ({ hist: { newestStep }, done })
/** The program's compile `gen`, as `replies.ts` stores its `result` reply. */
const result = (gen = GEN, pinned = false) =>
  ({ kind: 'result', gen, legs: { lambda: LAMBDA, rxm: RXM, tm: TM, clif: CLIF_ABSENT }, pinned }) as never
/** The program's recording for `GEN` with every leg ended: what a result with no full history is drawn beside. */
const ENDED = { gen: GEN, lambda: leg(7, 'ended'), rxm: leg(55, 'ended'), tm: leg(2_870, 'ended'), clif: leg(0, null) }
/** The strip for `result()` with no full history in it. */
const PLAIN = ['λ 42 · 7 reductions', 'rxm 42 · 55 instructions', 'TM 42 · 2,870 transitions · width 8']

describe('programSegments', () => {
  it('reads value and counts per leg, with no normal-form text', () => {
    expect(programSegments(result(), ENDED)).toEqual(PLAIN)
  })

  /**
   * **A PINNED WIDTH IS MARKED, IN THE STRIP AND IN THE INSPECTOR** (the TM width design, decision 23): with no TM
   * view open, nothing else on the page says the width was chosen rather than fitted. The mark is the result's own, so
   * it holds beside a recording of a later generation too.
   */
  it('marks a pinned TM width, and not auto’s', () => {
    const widthRow = (r: never) => programRows(r, ENDED).find((row) => row.label === 'TM width')
    expect(programSegments(result(GEN, true), ENDED)[2]).toBe('TM 42 · 2,870 transitions · width 8 (pinned)')
    expect(widthRow(result(GEN, true))?.value).toBe('8 cells (pinned)')
    expect(widthRow(result(GEN - 1, true))?.value).toBe('8 cells (pinned)')
    expect(programSegments(result(GEN, false), ENDED)[2]).toBe('TM 42 · 2,870 transitions · width 8')
    expect(widthRow(result(GEN, false))?.value).toBe('8 cells')
  })

  it('says a program that does not compile, and how many errors', () => {
    const s = programSegments(
      {
        kind: 'no-session',
        diagnostics: [{ severity: 'Error' }, { severity: 'Warning' }],
      } as never,
      ENDED,
    )
    expect(s).toEqual(['not compiled — 1 error'])
  })
})

/**
 * **A MACHINE LEG WHOSE RECORDING STOPPED ON ITS HISTORY BUDGET SAYS SO, AT THE STEP IT STOPPED AT** — in the strip
 * after the leg's count and before its width, and in the inspector as a row of its own. The count beside it is the
 * compile's whole run; the step is the newest one the recording holds, the `of N` of the leg's step line, so the two
 * numbers differ and both are true. Every case passes the recording as `draw.ts` builds it: the generation the legs
 * record, and every leg.
 */
describe('a machine leg’s full history, in the program’s readout', () => {
  it('puts the TM leg’s full history after its count and before its width', () => {
    expect(programSegments(result(), { ...ENDED, tm: leg(75_850, 'budget') })).toEqual([
      'λ 42 · 7 reductions',
      'rxm 42 · 55 instructions',
      'TM 42 · 2,870 transitions · history is full at 75,850 · width 8',
    ])
  })

  it('puts the rxm leg’s full history after its count', () => {
    expect(programSegments(result(), { ...ENDED, rxm: leg(40_000, 'budget') })).toEqual([
      'λ 42 · 7 reductions',
      'rxm 42 · 55 instructions · history is full at 40,000',
      'TM 42 · 2,870 transitions · width 8',
    ])
  })

  it('says nothing of a recording that ended, stopped elsewhere, or is still going', () => {
    for (const done of ['ended', 'capped', 'stack-full', null] as const)
      expect(programSegments(result(), { ...ENDED, rxm: leg(55, done), tm: leg(2_870, done) }), String(done)).toEqual(
        PLAIN,
      )
  })

  /**
   * **A RESULT FROM AN EARLIER COMPILE GETS NO FACT.** The worker posts `result` once every leg has recorded, and a
   * recompile resets the legs at its `compiled` reply, so through the whole recording the result on hand is the
   * previous program's while the legs record the next generation. The same legs beside their own generation's result
   * do say it, so this is the generation and not the legs.
   */
  it('draws no fact beside a result from an earlier compile than the one the legs record', () => {
    const filling = { ...ENDED, gen: GEN + 1, rxm: leg(36_921, 'budget'), tm: leg(74_803, 'budget') }
    expect(programSegments(result(GEN), filling)).toEqual(PLAIN)
    expect(programRows(result(GEN), filling).some((r) => r.label.endsWith('recording'))).toBe(false)
    expect(programSegments(result(GEN + 1), filling)).toEqual([
      'λ 42 · 7 reductions',
      'rxm 42 · 55 instructions · history is full at 36,921',
      'TM 42 · 2,870 transitions · history is full at 74,803 · width 8',
    ])
  })

  /**
   * **NOT AT A STOP A LINK IS TAKING THE LEG PAST.** The step line says `— going to step N from the link` there in
   * place of `— history is full` (`controls.ts`'s `controlState`), and the link continues the recording from it.
   */
  it('says nothing of a full history while a link’s position is taking the leg further', () => {
    const pending = { ...leg(36_921, 'budget'), pending: 40_000 }
    expect(
      programSegments(result(), { ...ENDED, rxm: pending, tm: { ...leg(69_008, 'budget'), pending: 80_000 } }),
    ).toEqual(PLAIN)
    expect(programSegments(result(), { ...ENDED, rxm: pending, tm: leg(69_008, 'budget') })[2]).toBe(
      'TM 42 · 2,870 transitions · history is full at 69,008 · width 8',
    )
  })

  /**
   * **NOR WHILE A HELD CLIF LEG'S STEP LINE STILL SAYS A LINK'S STEP** (`ClifHold.linkStep`): the listing chosen
   * dropped the position, but the line it is in stays until the CLIF view changes, and the readout stays with it.
   */
  it('says nothing of a full CLIF history while its held step line still says the link’s step', () => {
    const r = { kind: 'result', gen: GEN, legs: { lambda: LAMBDA, rxm: RXM, tm: TM, clif: RXM }, pinned: false }
    const held = { ...leg(40_000, 'budget'), clifHold: { linkStep: 50_000 } }
    expect(programSegments(r as never, { ...ENDED, clif: held })).toEqual([...PLAIN, 'clif 42 · 55 instructions'])
  })

  /**
   * **λ KEEPS ITS OWN LINE.** Its `run` row already says a stopped recording in its own words (`results.ts`'s
   * `runNote`), from the result. A λ leg that filled, handed over beside the two machine legs, must change nothing.
   */
  it('adds nothing to the λ leg, which says it in its own words', () => {
    const legs = { ...ENDED, lambda: leg(1_406, 'budget') }
    expect(programSegments(result(), legs)[0]).toBe('λ 42 · 7 reductions')
    expect(programRows(result(), legs).filter((r) => r.label.startsWith('λ'))).toEqual(
      programRows(result(), ENDED).filter((r) => r.label.startsWith('λ')),
    )
  })

  it('gives the inspector the same fact, as the leg’s recording row after its steps', () => {
    const rows = programRows(result(), { ...ENDED, rxm: leg(40_000, 'budget'), tm: leg(75_850, 'budget') })
    expect(rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
      'λ normal form: 42',
      'λ steps: 7 reductions',
      'λ value: 42',
      'rxm steps: 55 instructions',
      'rxm recording: history is full at 40,000',
      'rxm value: 42',
      'TM width: 8 cells',
      'TM steps: 2,870 transitions',
      'TM recording: history is full at 75,850',
      'TM value: 42',
    ])
    expect(
      programRows(result(), { ...ENDED, tm: leg(91_785, 'ended') }).some((r) => r.label.endsWith('recording')),
    ).toBe(false)
  })

  /**
   * **CLIF HAS A SEGMENT ONLY WHILE ITS LEG HAS ROWS**: none while no stepper is built (`PLAIN`, beside `CLIF_ABSENT`),
   * and the rxm leg's words under CLIF's name once one runs, its history's fact among them.
   */
  it('gives the CLIF leg a segment only while it has rows, in the rxm leg’s words', () => {
    const r = {
      kind: 'result',
      gen: GEN,
      legs: { lambda: LAMBDA, rxm: RXM, tm: TM, clif: RXM },
      pinned: false,
    } as never
    expect(programSegments(r, ENDED)).toEqual([...PLAIN, 'clif 42 · 55 instructions'])
    expect(programSegments(r, { ...ENDED, clif: leg(40_000, 'budget') })).toEqual([
      ...PLAIN,
      'clif 42 · 55 instructions · history is full at 40,000',
    ])
  })

  it('says nothing for a leg that was declined', () => {
    const declined = { status: { ...TM.status, available: false, reason: 'no TM for this program' }, value: null }
    const r = { kind: 'result', gen: GEN, legs: { lambda: LAMBDA, rxm: RXM, tm: declined, clif: CLIF_ABSENT } } as never
    const full = { ...ENDED, tm: leg(10, 'budget') }
    expect(programSegments(r, full)[2]).toBe('TM declined — no TM for this program')
    expect(programRows(r, full).filter((row) => row.label.startsWith('TM'))).toEqual([
      { label: 'TM declined', value: 'no TM for this program' },
    ])
  })
})

describe('programRows', () => {
  // §9: "Every row on its own line, the normal-form text included" — which is exactly what the strip
  // leaves out, and the one difference between the two readouts' content.
  it('keeps the normal-form text the strip drops, one row per fact', () => {
    const rows = programRows(result(), ENDED)
    expect(rows.map((r) => r.label)).toContain('λ normal form')
    expect(rows.every((r) => r.value !== '')).toBe(true)
    // THE STRIP'S OWN BUILDER IS THE CONTRAST, asserted rather than assumed: a claim that the inspector
    // keeps what the strip drops is only worth making beside the thing that drops it.
    expect(programSegments(result(), ENDED).join(' ')).not.toContain('normal form')
  })

  /**
   * **A CUT NORMAL FORM CARRIES ITS MARK.** `results.ts` sets `note` on exactly one row, and the strip drops
   * that row, so the inspector is where it is printed. A DEPTH cut is not a prefix of the real term: closing
   * every open paren as the stack unwinds yields well-formed λ that reparses into a different, shorter term,
   * so an unmarked one reads as the answer.
   */
  it('carries the note on a cut normal form, the row the strip drops', () => {
    const deep = { ...LAMBDA, state: { ...LAMBDA.state, cut: 'Depth' as const } }
    const rows = programRows(
      { kind: 'result', gen: GEN, legs: { lambda: deep, rxm: RXM, tm: TM, clif: CLIF_ABSENT } } as never,
      ENDED,
    )
    const nf = rows.find((r) => r.label.includes('normal form') || r.label.includes('term so far'))
    expect(nf, 'no normal-form row to carry a note').toBeDefined()
    expect(nf?.note, 'the cut mark was dropped on the way to the inspector').toBeTruthy()
  })

  it('says a program that does not compile, with the error count', () => {
    expect(
      programRows({ kind: 'no-session', diagnostics: [] } as never, ENDED)
        .map((r) => r.value)
        .join(' '),
    ).toContain('not compiled')
  })

  it('has no rows for a worker error, which the banner shows instead, nor for no result at all', () => {
    expect(programRows({ kind: 'error', error: new Error('x') } as never, ENDED)).toEqual([])
    expect(programRows(null, ENDED)).toEqual([])
  })
})
