import { describe, expect, it } from 'vitest'
import { decorationRanges } from '../../src/spans'
import type { Classified } from '../../src/types'

const at = (start: number, end: number, cls: Classified[number][1]): Classified[number] => [{ start, end }, cls]

describe('decorationRanges', () => {
  it('maps each span to its token class name', () => {
    const spans: Classified = [at(0, 3, 'Keyword'), at(4, 5, 'Ident')]
    expect(decorationRanges(spans, 20)).toEqual([
      { from: 0, to: 3, className: 'tok-keyword' },
      { from: 4, to: 5, className: 'tok-ident' },
    ])
  })

  it('returns nothing for an empty document', () => {
    expect(decorationRanges([], 0)).toEqual([])
  })

  // A RangeSetBuilder throws on out-of-order adds, and the lexer's order is an assumption rather than
  // a guarantee this module can see. Sorting here is cheaper than a crash in a StateField.
  it('sorts by start position', () => {
    const spans: Classified = [at(4, 5, 'Ident'), at(0, 3, 'Keyword')]
    expect(decorationRanges(spans, 20).map((r) => r.from)).toEqual([0, 4])
  })

  it('drops empty spans', () => {
    expect(decorationRanges([at(2, 2, 'Punct')], 20)).toEqual([])
  })

  // The document the spans were computed from and the document CodeMirror currently holds can differ
  // by one keystroke. A stale span past the end is a crash, so it is clamped rather than trusted.
  it('drops spans that start past the end of the document', () => {
    expect(decorationRanges([at(30, 33, 'Keyword')], 20)).toEqual([])
  })

  it('clamps a span that overruns the end of the document', () => {
    expect(decorationRanges([at(18, 25, 'Ident')], 20)).toEqual([{ from: 18, to: 20, className: 'tok-ident' }])
  })
})
