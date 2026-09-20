import { describe, expect, it } from 'vitest'
import {
  copyRows,
  lambdaCopyParts,
  lambdaCopySegments,
  programRows,
  programSegments,
  tmCopyParts,
  tmCopySegments,
} from '../../src/readout'

const LAMBDA = {
  status: { available: true, reason: '', run: 'Ended' as const, node: null },
  state: { text: '42', step: 7, cut: null, owner: 'None' as const },
  value: { Value: { text: '42' } },
}
const TM = {
  status: { available: true, reason: '', width: 8, total_steps: 2870, run: 'Halted' as const, node: null },
  value: { Value: { text: '42' } },
}

describe('programSegments', () => {
  it('reads value and counts per leg, in the new vocabulary, with no normal-form text', () => {
    const s = programSegments({ kind: 'result', lambda: LAMBDA, tm: TM } as never)
    expect(s).toEqual(['λ 42 · 7 reductions', 'TM 42 · 2,870 transitions · width 8'])
  })

  it('says a program that does not compile, and how many errors', () => {
    const s = programSegments({
      kind: 'no-session',
      diagnostics: [{ severity: 'Error' }, { severity: 'Warning' }],
    } as never)
    expect(s).toEqual(['not compiled — 1 error'])
  })
})

describe('lambdaCopySegments', () => {
  it('names the copy and says how far it has run and why it stopped', () => {
    expect(
      lambdaCopySegments('λ copy 1', { newestStep: 12, done: 'ended', status: { available: true, reason: '' } }),
    ).toEqual(['λ copy 1 · 12 reductions'])
    expect(
      lambdaCopySegments('λ copy 1', { newestStep: 5000, done: 'capped', status: { available: true, reason: '' } }),
    ).toEqual(['λ copy 1 · 5,000 reductions · spent its step budget'])
    expect(
      lambdaCopySegments('λ copy 1', { newestStep: 0, done: null, status: { available: false, reason: 'building…' } }),
    ).toEqual(['λ copy 1 · building…'])
  })
})

describe('tmCopySegments', () => {
  const running = { newestStep: 241_666, status: { available: true, reason: '' } }

  it('names the copy and carries its count, value line and reduced-file sentence', () => {
    const reading = {
      status: { header: true, width: 4, reduction: { stages: ['single-tape'], steps: 241666 } },
      value: { run: { run: 'Ended', steps: 241666, cap: 1000000000 }, value: { Value: { text: '2' } } },
    }
    expect(tmCopySegments('TM copy 1', reading as never, running)).toEqual([
      'TM copy 1 · 241,666 transitions · value: 2 · reduced: single-tape · 241,666 steps',
    ])
  })

  /**
   * **A COPY WHOSE THREAD THREW READS ITS LEG, NOT ITS RETAINED READING** — spec §13. `replies.ts`'s
   * `worker-error` arm clears `tmScratch` and writes the reason onto the leg, so a version of this that
   * took only the reading reported a bare name for the rest of the page load, where the λ half of the
   * same arm reported `λ copy 1 · the copy failed`.
   */
  it('says why a copy stopped, and does not need a reading to say it', () => {
    expect(
      tmCopySegments('TM copy 1', null, { newestStep: 0, status: { available: false, reason: 'the copy failed' } }),
    ).toEqual(['TM copy 1 · the copy failed'])
    expect(
      tmCopySegments('TM copy 2', null, { newestStep: 0, status: { available: false, reason: 'building…' } }),
    ).toEqual(['TM copy 2 · building…'])
  })

  it('counts transitions for a copy that has run but retains nothing yet', () => {
    expect(tmCopySegments('TM copy 1', null, { newestStep: 12, status: { available: true, reason: '' } })).toEqual([
      'TM copy 1 · 12 transitions',
    ])
  })
})

describe('programRows', () => {
  // §9: "Every row on its own line, the normal-form text included" — which is exactly what the strip
  // leaves out, and the one difference between the two readouts' content.
  it('keeps the normal-form text the strip drops, one row per fact', () => {
    const rows = programRows({ kind: 'result', lambda: LAMBDA, tm: TM } as never)
    expect(rows.map((r) => r.label)).toContain('λ normal form')
    expect(rows.every((r) => r.value !== '')).toBe(true)
    // THE STRIP'S OWN BUILDER IS THE CONTRAST, asserted rather than assumed: a claim that the inspector
    // keeps what the strip drops is only worth making beside the thing that drops it.
    expect(programSegments({ kind: 'result', lambda: LAMBDA, tm: TM } as never).join(' ')).not.toContain('normal form')
  })

  /**
   * **A CUT NORMAL FORM CARRIES ITS MARK.** `results.ts` sets `note` on exactly one row, and the inspector
   * is the first surface since part 2a to print that row at all — the strip drops it. A DEPTH cut is not a
   * prefix of the real term: closing every open paren as the stack unwinds yields well-formed λ that
   * reparses into a different, shorter term, so an unmarked one reads as the answer.
   */
  it('carries the note on a cut normal form, which the strip never had to', () => {
    const deep = { ...LAMBDA, state: { ...LAMBDA.state, cut: 'Depth' as const } }
    const rows = programRows({ kind: 'result', lambda: deep, tm: TM } as never)
    const nf = rows.find((r) => r.label.includes('normal form') || r.label.includes('term so far'))
    expect(nf, 'no normal-form row to carry a note').toBeDefined()
    expect(nf?.note, 'the cut mark was dropped on the way to the inspector').toBeTruthy()
  })

  it('says a program that does not compile, with the error count', () => {
    expect(
      programRows({ kind: 'no-session', diagnostics: [] } as never)
        .map((r) => r.value)
        .join(' '),
    ).toContain('not compiled')
  })

  it('has no rows for a worker error, which the banner shows instead, nor for no result at all', () => {
    expect(programRows({ kind: 'error', error: new Error('x') } as never)).toEqual([])
    expect(programRows(null)).toEqual([])
  })
})

describe('copyRows', () => {
  it('makes the copy’s name the first row’s label and every other fact a row', () => {
    const rows = copyRows(
      lambdaCopyParts('λ copy 1', { newestStep: 3, done: null, status: { available: true, reason: '' } }),
    )
    expect(rows).toEqual([{ label: 'λ copy 1', value: '3 reductions' }])
  })

  // THE CASE THE "split the strip's line" SHORTCUT GETS WRONG: a reduced-file sentence carries its own
  // ` · `, so a split on that separator would cut one fact into two rows.
  it('keeps a reduced-file sentence whole', () => {
    const reading = {
      status: { header: true, width: 4, reduction: { stages: ['single-tape'], steps: 241666 } },
      value: { run: { run: 'Ended', steps: 241666, cap: 1000000000 }, value: { Value: { text: '2' } } },
    }
    const leg = { newestStep: 241_666, status: { available: true, reason: '' } }
    const rows = copyRows(tmCopyParts('TM copy 1', reading as never, leg))
    expect(rows).toEqual([
      { label: 'TM copy 1', value: '241,666 transitions' },
      { label: '', value: 'value: 2' },
      { label: '', value: 'reduced: single-tape · 241,666 steps' },
    ])
    // THE EVIDENCE THAT THE SHORTCUT WOULD HAVE BEEN WRONG: the joined line the strip shows has FIVE
    // ` · `-separated pieces for these THREE facts, so splitting it back apart cuts the last one in two.
    expect(tmCopySegments('TM copy 1', reading as never, leg)[0]?.split(' · ')).toHaveLength(5)
  })
})
