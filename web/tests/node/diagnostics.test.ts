import { describe, expect, it } from 'vitest'
import { lintRanges } from '../../src/diagnostics'
import type { Diagnostic } from '../../src/types'

const d = (start: number, end: number, severity: Diagnostic['severity'], message: string): Diagnostic => ({
  span: { start, end },
  severity,
  message,
})

// ASCII, so every byte offset is already the UTF-16 index — used to exercise the clamping/widening
// rules on their own, without the byte→UTF-16 conversion itself being the thing under test.
const ascii20 = 'a'.repeat(20)

describe('lintRanges', () => {
  it('lower-cases both severities into CodeMirror severities', () => {
    const got = lintRanges([d(0, 3, 'Error', 'boom'), d(4, 6, 'Warning', 'hmm')], ascii20)
    expect(got.map((r) => r.severity)).toEqual(['error', 'warning'])
  })

  it('carries the message and the span through', () => {
    expect(lintRanges([d(2, 5, 'Error', 'expected an expression')], ascii20)).toEqual([
      { from: 2, to: 5, severity: 'error', message: 'expected an expression' },
    ])
  })

  it('returns nothing for a clean program', () => {
    expect(lintRanges([], ascii20)).toEqual([])
  })

  // A zero-width span is where the parser noticed something missing, and it is the common case for
  // `let x = ;`. CodeMirror renders nothing for from === to, so it is widened by one to stay visible.
  it('widens a zero-width span so the marker is visible', () => {
    expect(lintRanges([d(8, 8, 'Error', 'expected an expression')], ascii20)).toEqual([
      { from: 8, to: 9, severity: 'error', message: 'expected an expression' },
    ])
  })

  it('clamps a widened span at the end of the document', () => {
    expect(lintRanges([d(20, 20, 'Error', 'unexpected end of input')], ascii20)).toEqual([
      { from: 19, to: 20, severity: 'error', message: 'unexpected end of input' },
    ])
  })

  it('drops a diagnostic on an empty document rather than inventing a range', () => {
    expect(lintRanges([d(0, 0, 'Error', 'empty')], '')).toEqual([])
  })

  // THE REACHABLE CASE THIS MODULE USED TO MISS ENTIRELY: `analyze`'s diagnostics carry BYTE offsets
  // (`spans.ts`'s `byteToIndex` doc), and `lintRanges` used to hand them to CodeMirror as UTF-16
  // indices unconverted. `// λλλ` on its own line, then a broken second line: three 2-byte characters
  // ahead of the diagnostic push its byte offset 3 higher than its UTF-16 index, so an unconverted
  // reader lands the marker three characters to the right — on the wrong token, or (for a longer
  // comment) the wrong line entirely.
  it('lands a diagnostic after a non-ASCII comment on the character it actually names', () => {
    const text = '// λλλ\nlet x = ; let y = 1'
    const prefix = '// λλλ\nlet x = '
    const byteOffset = new TextEncoder().encode(prefix).length
    const utf16Offset = prefix.length
    expect(byteOffset).toBe(utf16Offset + 3) // sanity: the byte/UTF-16 gap this test exists to catch
    const got = lintRanges([d(byteOffset, byteOffset, 'Error', 'expected an expression')], text)
    expect(got).toEqual([
      { from: utf16Offset, to: utf16Offset + 1, severity: 'error', message: 'expected an expression' },
    ])
    expect(text.slice(got[0]?.from, got[0]?.to)).toBe(';')
  })

  // THE CAVEAT THAT MATTERS: widening a zero-width diagnostic by one UTF-16 code unit, rather than one
  // CHARACTER, would end mid-surrogate-pair on an astral character — a position CodeMirror rejects or
  // renders wrongly.
  it('widens a zero-width diagnostic on an astral character to the whole character, not half a surrogate pair', () => {
    const emoji = '\u{1F600}'
    const text = `a${emoji}b`
    const byteOffset = new TextEncoder().encode('a').length // the emoji's own byte offset
    const got = lintRanges([d(byteOffset, byteOffset, 'Error', 'boom')], text)
    expect(got).toEqual([{ from: 1, to: 3, severity: 'error', message: 'boom' }])
    expect(text.slice(got[0]?.from, got[0]?.to)).toBe(emoji)
  })
})
