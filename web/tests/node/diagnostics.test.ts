import { describe, expect, it } from 'vitest'
import { lintRanges } from '../../src/diagnostics'
import type { Diagnostic } from '../../src/types'

const d = (start: number, end: number, severity: Diagnostic['severity'], message: string): Diagnostic => ({
  span: { start, end },
  severity,
  message,
})

describe('lintRanges', () => {
  it('lower-cases both severities into CodeMirror severities', () => {
    const got = lintRanges([d(0, 3, 'Error', 'boom'), d(4, 6, 'Warning', 'hmm')], 20)
    expect(got.map((r) => r.severity)).toEqual(['error', 'warning'])
  })

  it('carries the message and the span through', () => {
    expect(lintRanges([d(2, 5, 'Error', 'expected an expression')], 20)).toEqual([
      { from: 2, to: 5, severity: 'error', message: 'expected an expression' },
    ])
  })

  it('returns nothing for a clean program', () => {
    expect(lintRanges([], 20)).toEqual([])
  })

  // A zero-width span is where the parser noticed something missing, and it is the common case for
  // `let x = ;`. CodeMirror renders nothing for from === to, so it is widened by one to stay visible.
  it('widens a zero-width span so the marker is visible', () => {
    expect(lintRanges([d(8, 8, 'Error', 'expected an expression')], 20)).toEqual([
      { from: 8, to: 9, severity: 'error', message: 'expected an expression' },
    ])
  })

  it('clamps a widened span at the end of the document', () => {
    expect(lintRanges([d(20, 20, 'Error', 'unexpected end of input')], 20)).toEqual([
      { from: 19, to: 20, severity: 'error', message: 'unexpected end of input' },
    ])
  })

  it('drops a diagnostic on an empty document rather than inventing a range', () => {
    expect(lintRanges([d(0, 0, 'Error', 'empty')], 0)).toEqual([])
  })
})
