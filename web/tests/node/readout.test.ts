import { describe, expect, it } from 'vitest'
import { lambdaCopySegments, programSegments, tmCopySegments } from '../../src/readout'

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
