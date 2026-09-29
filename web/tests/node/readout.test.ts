import { describe, expect, it } from 'vitest'
import {
  asmCopyParts,
  asmCopyRow,
  asmCopySegments,
  copyLegOf,
  copyRows,
  lambdaCopyParts,
  lambdaCopySegments,
  programRows,
  programSegments,
  tmCopyParts,
  tmCopyRow,
  tmCopySegments,
} from '../../src/readout'

const LAMBDA = {
  status: { available: true, reason: '', run: 'Ended' as const, node: null },
  state: { text: '42', step: 7, cut: null, owner: 'None' as const },
  value: { Value: { text: '42' } },
}
const ASM = {
  status: { available: true, reason: '', run: 'Ended' as const, cap: null, total_steps: 55 },
  value: { Value: { text: '42' } },
}
const TM = {
  status: { available: true, reason: '', width: 8, total_steps: 2870, run: 'Halted' as const, node: null },
  value: { Value: { text: '42' } },
}

describe('programSegments', () => {
  it('reads value and counts per leg, in the new vocabulary, with no normal-form text', () => {
    const s = programSegments({ kind: 'result', lambda: LAMBDA, asm: ASM, tm: TM } as never)
    expect(s).toEqual(['λ 42 · 7 reductions', 'asm 42 · 55 instructions', 'TM 42 · 2,870 transitions · width 8'])
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

describe('asmCopySegments', () => {
  const STATUS = { available: true, reason: '', run: 'Ended' as const, cap: null, total_steps: 3 }
  const leg = (newestStep: number, done: 'ended' | 'capped' | 'stack-full' | null) => ({
    newestStep,
    done,
    status: { available: true, reason: '' },
  })

  it('names the copy, counts its instructions, and reads its value as its view does', () => {
    const reading = { status: STATUS, value: { Value: { text: '7' } } }
    expect(asmCopySegments('asm copy 1', reading, leg(3, 'ended'))).toEqual(['asm copy 1 · 3 instructions · value: 7'])
  })

  it('says a count of one in the singular', () => {
    const reading = { status: STATUS, value: { Value: { text: '0' } } }
    expect(asmCopySegments('asm copy 1', reading, leg(1, 'ended'))).toEqual(['asm copy 1 · 1 instruction · value: 0'])
  })

  it('says why the recording stopped, and a fault as a fault', () => {
    const fault = { status: STATUS, value: { Fault: { message: 'head of empty list at pc1' } } }
    expect(asmCopyParts('asm copy 1', fault, leg(2, 'ended'))).toEqual([
      'asm copy 1',
      '2 instructions',
      'fault: head of empty list at pc1',
    ])
    const full = { status: STATUS, value: 'Unfinished' as const }
    expect(asmCopyParts('asm copy 1', full, leg(9, 'stack-full'))).toEqual([
      'asm copy 1',
      '9 instructions',
      'the call stack is full',
      'not finished',
    ])
  })

  it('says only that it is building before its build lands', () => {
    const building = { newestStep: 0, done: null, status: { available: false, reason: 'building…' } }
    expect(asmCopySegments('asm copy 1', null, building)).toEqual(['asm copy 1 · building…'])
  })
})

/**
 * **A MACHINE COPY'S ROW IN THE COPIES MENU SAYS WHAT ITS READOUT SAYS OF ITS RUN** — the line under its name, which
 * read `no term yet` for every TM and asm copy, halted ones included, because a machine copy has no term. It is the
 * copy's readout line without the name, so each case is also checked against the strip's own segment.
 */
describe('a machine copy’s row in the copies menu', () => {
  const STATUS = { available: true, reason: '', run: 'Ended' as const, cap: null, total_steps: 55 }
  const asmLeg = (newestStep: number, done: 'ended' | 'capped' | null) => ({
    newestStep,
    done,
    status: { available: true, reason: '' },
  })
  const tmLeg = (newestStep: number) => ({ newestStep, status: { available: true, reason: '' } })

  it('reads an asm copy that halted with a value as its readout does', () => {
    const reading = { status: STATUS, value: { Value: { text: '6' } } }
    expect(asmCopyRow(reading, asmLeg(55, 'ended'))).toBe('55 instructions · value: 6')
    expect(asmCopySegments('asm copy 1', reading, asmLeg(55, 'ended'))).toEqual([
      `asm copy 1 · ${asmCopyRow(reading, asmLeg(55, 'ended'))}`,
    ])
  })

  it('reads an asm copy that faulted as a fault', () => {
    const reading = { status: STATUS, value: { Fault: { message: 'ran past end of program at pc0' } } }
    expect(asmCopyRow(reading, asmLeg(0, 'ended'))).toBe('0 instructions · fault: ran past end of program at pc0')
  })

  it('says why an asm copy’s recording stopped at a cap, and that its run is unfinished', () => {
    const reading = { status: STATUS, value: 'Unfinished' as const }
    expect(asmCopyRow(reading, asmLeg(9, 'capped'))).toBe('9 instructions · spent its step budget · not finished')
  })

  it('reads a TM copy’s value, and a value run still going, as its readout does', () => {
    const halted = {
      status: { header: true, width: 8, reduction: null },
      value: { run: { run: 'Ended', steps: 18574, cap: 1000000000 }, value: { Value: { text: '6' } } },
    }
    expect(tmCopyRow(halted as never, tmLeg(18574))).toBe('18,574 transitions · value: 6')
    const running = {
      status: { header: true, width: 8, reduction: null },
      value: { run: { run: 'Running', steps: 12, cap: 1000 }, value: 'Unfinished' },
    }
    expect(tmCopyRow(running as never, tmLeg(12))).toBe('12 transitions · value: running · 12 of 1,000 steps')
    expect(tmCopySegments('TM copy 2', running as never, tmLeg(12))).toEqual([
      `TM copy 2 · ${tmCopyRow(running as never, tmLeg(12))}`,
    ])
  })

  it('says a machine copy that has not built yet is building, as its readout does', () => {
    const building = { newestStep: 0, done: null, status: { available: false, reason: 'building…' } }
    expect(asmCopyRow(null, building)).toBe('building…')
    expect(tmCopyRow(null, building)).toBe('building…')
  })

  it('reads a leg’s live state into the one shape every copy line takes', () => {
    const leg = { hist: { newestStep: 3 }, done: 'ended' as const, status: { available: true, reason: '' } }
    expect(copyLegOf(leg)).toEqual({ newestStep: 3, done: 'ended', status: { available: true, reason: '' } })
  })
})

describe('a count of one, in every copy line', () => {
  it('reads "1 reduction" and "1 transition"', () => {
    expect(
      lambdaCopyParts('λ copy 1', { newestStep: 1, done: 'ended', status: { available: true, reason: '' } }),
    ).toEqual(['λ copy 1', '1 reduction'])
    expect(tmCopyParts('TM copy 1', null, { newestStep: 1, status: { available: true, reason: '' } })).toEqual([
      'TM copy 1',
      '1 transition',
    ])
  })
})

describe('programRows', () => {
  // §9: "Every row on its own line, the normal-form text included" — which is exactly what the strip
  // leaves out, and the one difference between the two readouts' content.
  it('keeps the normal-form text the strip drops, one row per fact', () => {
    const rows = programRows({ kind: 'result', lambda: LAMBDA, asm: ASM, tm: TM } as never)
    expect(rows.map((r) => r.label)).toContain('λ normal form')
    expect(rows.every((r) => r.value !== '')).toBe(true)
    // THE STRIP'S OWN BUILDER IS THE CONTRAST, asserted rather than assumed: a claim that the inspector
    // keeps what the strip drops is only worth making beside the thing that drops it.
    expect(programSegments({ kind: 'result', lambda: LAMBDA, asm: ASM, tm: TM } as never).join(' ')).not.toContain(
      'normal form',
    )
  })

  /**
   * **A CUT NORMAL FORM CARRIES ITS MARK.** `results.ts` sets `note` on exactly one row, and the inspector
   * is the first surface since part 2a to print that row at all — the strip drops it. A DEPTH cut is not a
   * prefix of the real term: closing every open paren as the stack unwinds yields well-formed λ that
   * reparses into a different, shorter term, so an unmarked one reads as the answer.
   */
  it('carries the note on a cut normal form, which the strip never had to', () => {
    const deep = { ...LAMBDA, state: { ...LAMBDA.state, cut: 'Depth' as const } }
    const rows = programRows({ kind: 'result', lambda: deep, asm: ASM, tm: TM } as never)
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
