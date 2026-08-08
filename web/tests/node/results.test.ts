import { describe, expect, it } from 'vitest'
import type { LambdaLeg, TmLeg } from '../../src/protocol'
import { noSessionRows, resultRows } from '../../src/results'
import type { Diagnostic } from '../../src/types'

const okState = { text: 'λf. λx. f (f x)', spans: [], truncated: false, step: 7 }

const lambdaOk: LambdaLeg = {
  status: { available: true, reason: '', node: null, run: 'Ended' },
  state: okState,
  value: { Value: { text: '42' } },
  declinedSpan: null,
}

const tmOk: TmLeg = {
  status: { available: true, reason: '', width: 8, run: 'Running', total_steps: 2870 },
  value: { Value: { text: '42' } },
}

const find = (rows: ReturnType<typeof resultRows>, leg: string, label: string) =>
  rows.find((r) => r.leg === leg && r.label === label)

describe('resultRows — the happy path', () => {
  const rows = resultRows(lambdaOk, tmOk)

  it('shows the λ normal form, step count and value', () => {
    expect(find(rows, 'λ', 'normal form')?.value).toBe('λf. λx. f (f x)')
    expect(find(rows, 'λ', 'steps')?.value).toBe('7 β-steps')
    expect(find(rows, 'λ', 'value')?.value).toBe('42')
  })

  it('shows the TM fitted width, step count and value', () => {
    expect(find(rows, 'TM', 'width')?.value).toBe('8 cells')
    expect(find(rows, 'TM', 'steps')?.value).toBe('2,870 δ-steps')
    expect(find(rows, 'TM', 'value')?.value).toBe('42')
  })
})

describe('resultRows — truncation', () => {
  it('shows the text AND says it was cut, rather than choosing one', () => {
    const rows = resultRows({ ...lambdaOk, state: { ...okState, truncated: true } }, tmOk)
    const row = find(rows, 'λ', 'normal form')
    expect(row?.value).toBe('λf. λx. f (f x)')
    expect(row?.note).toBe('… truncated at 64 KiB')
  })
})

describe('resultRows — total_steps is read against tmValue, not against run', () => {
  // The pair `browser.rs` pins: a finished run reports run: "Running" because the CURSOR has not moved.
  it('calls it a length when a final configuration exists', () => {
    expect(find(resultRows(lambdaOk, tmOk), 'TM', 'steps')?.value).toBe('2,870 δ-steps')
  })

  it('calls it a cap when tmValue is Unfinished, even though run is identical', () => {
    const capped: TmLeg = { status: { ...tmOk.status }, value: 'Unfinished' }
    expect(find(resultRows(lambdaOk, capped), 'TM', 'steps')?.value).toBe('stopped after 2,870 δ-steps at a cap')
  })

  it('does not name which cap it hit', () => {
    const capped: TmLeg = { status: { ...tmOk.status }, value: 'Unfinished' }
    expect(find(resultRows(lambdaOk, capped), 'TM', 'steps')?.value).not.toContain('step cap')
  })
})

describe('resultRows — refusals', () => {
  it('shows the λ reason instead of the leg when the backend declines', () => {
    const declined: LambdaLeg = {
      status: {
        available: false,
        reason: 'a closure assigns a variable captured from an outer scope',
        node: 12,
        run: null,
      },
      state: null,
      value: null,
      declinedSpan: { start: 44, end: 45 },
    }
    const rows = resultRows(declined, tmOk)
    expect(find(rows, 'λ', 'declined')?.value).toBe('a closure assigns a variable captured from an outer scope')
    expect(find(rows, 'λ', 'normal form')).toBeUndefined()
    // The TM leg still answers — a declined backend is not a failed compile.
    expect(find(rows, 'TM', 'value')?.value).toBe('42')
  })

  it('shows the TM reason and no width when that backend declines', () => {
    const declined: TmLeg = {
      status: {
        available: false,
        reason: 'the machine this program needs is too large to build',
        width: null,
        run: null,
        total_steps: null,
      },
      value: null,
    }
    const rows = resultRows(lambdaOk, declined)
    expect(find(rows, 'TM', 'declined')?.value).toBe('the machine this program needs is too large to build')
    expect(find(rows, 'TM', 'width')).toBeUndefined()
  })

  // Capped and DepthRefused are worded differently because raising the cap helps only one of them,
  // and this slice has no button to offer — so the words are the whole distinction.
  it('distinguishes a spent budget from a depth refusal', () => {
    const capped: LambdaLeg = { ...lambdaOk, status: { ...lambdaOk.status, run: 'Capped' }, value: 'Unfinished' }
    expect(find(resultRows(capped, tmOk), 'λ', 'run')?.value).toBe('spent its step budget')

    const deep: LambdaLeg = { ...lambdaOk, status: { ...lambdaOk.status, run: 'DepthRefused' }, value: 'Unfinished' }
    expect(find(resultRows(deep, tmOk), 'λ', 'run')?.value).toBe('the term is deeper than the reducer allows')
  })

  it('reports a fault as a fault rather than as an empty value', () => {
    const faulted: LambdaLeg = { ...lambdaOk, value: { Fault: { message: 'budget exhausted' } } }
    expect(find(resultRows(faulted, tmOk), 'λ', 'value')?.value).toBe('fault: budget exhausted')
  })

  it('reports an undecodable normal form as an answer', () => {
    const undec: LambdaLeg = { ...lambdaOk, value: 'Undecodable' }
    expect(find(resultRows(undec, tmOk), 'λ', 'value')?.value).toBe('no encoding for this type')
  })
})

// `onRun` posts `result` after a `budget` stop (the recording ring filled), and `lambdaStatus().run`
// is still `Running` when it does — the old doc comment's "the worker only replies once the run ended"
// is false for this case. `resultRows` must not call a term still `Running` a normal form, and must
// say why recording stopped instead of staying silent (the old `runNote` default case).
describe('resultRows — a run stopped by the recording budget, not by ending', () => {
  const running: LambdaLeg = { ...lambdaOk, status: { ...lambdaOk.status, run: 'Running' } }

  it('does not call the term a normal form', () => {
    expect(find(resultRows(running, tmOk), 'λ', 'normal form')).toBeUndefined()
  })

  it('labels it "term so far" instead, still showing the text', () => {
    expect(find(resultRows(running, tmOk), 'λ', 'term so far')?.value).toBe(okState.text)
  })

  it('explains that recording stopped, not that the run ended', () => {
    const note = find(resultRows(running, tmOk), 'λ', 'run')?.value
    expect(note).toBeTruthy()
    expect(note).not.toMatch(/\bended\b/i)
    expect(note).toContain('recording stopped')
  })
})

describe('noSessionRows', () => {
  const err = (message: string): Diagnostic => ({ span: { start: 0, end: 1 }, severity: 'Error', message })
  const warn = (message: string): Diagnostic => ({ span: { start: 0, end: 1 }, severity: 'Warning', message })

  it('says the program did not compile and how many errors there were', () => {
    expect(noSessionRows([err('a'), err('b')])).toEqual([{ leg: '', label: '', value: 'not compiled — 2 errors' }])
  })

  it('does not pluralize a single error', () => {
    expect(noSessionRows([err('a')])[0]?.value).toBe('not compiled — 1 error')
  })

  // `analyze` returns warnings too, and only an ERROR withholds the session. Counting the whole array
  // would report a number the user cannot reconcile with the markers in the gutter.
  it('counts only error-severity diagnostics', () => {
    expect(noSessionRows([err('a'), warn('b'), warn('c')])[0]?.value).toBe('not compiled — 1 error')
  })
})
