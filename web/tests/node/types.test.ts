import { describe, expect, it } from 'vitest'
import type { Decoded } from '../../src/types'
import { assertTokenClasses, decodedText, ownerNode, TOKEN_CLASSES } from '../../src/types'

describe('Decoded', () => {
  it('reads a struct variant as a one-key object', () => {
    const d: Decoded = { Value: { text: '42' } }
    expect(decodedText(d)).toBe('42')
  })

  it('reads a unit variant as a bare string', () => {
    expect(decodedText('Unfinished')).toBe('not finished')
    expect(decodedText('Undecodable')).toBe('no encoding for this type')
  })

  // `TooLargeToPrint` says the decode SUCCEEDED and the rendering did not, so it must not read as
  // `Undecodable` — that would blame the program for a limit of the printer.
  //
  // This case would have THROWN before the union learned the variant, rather than falling back to
  // anything: `decodedText` reaches `'Value' in d` once the bare-string checks miss, and `in` raises
  // a TypeError on a string primitive. The Rust side gained the variant first, so the crash was
  // reachable from the playground in between.
  it('reads the too-large-to-print refusal without confusing it for an undecodable type', () => {
    expect(decodedText('TooLargeToPrint')).toBe('value too large to print')
    expect(decodedText('TooLargeToPrint')).not.toBe(decodedText('Undecodable'))
    expect(() => decodedText('TooLargeToPrint')).not.toThrow()
  })

  it('reads a fault as a tagged object carrying its message', () => {
    expect(decodedText({ Fault: { message: 'budget exhausted' } })).toBe('fault: budget exhausted')
  })
})

describe('ownerNode', () => {
  it('reads the node out of either claim', () => {
    // 7 and 5 are deliberately distinct: an implementation that read the wrong field (e.g. always
    // `Exact` regardless of which key is present) would fail one of these two, not silently agree.
    expect(ownerNode({ Exact: 7 })).toBe(7)
    expect(ownerNode({ Within: 5 })).toBe(5)
  })

  it('is null for None, which is a common and correct answer', () => {
    expect(ownerNode('None')).toBeNull()
  })
})

describe('assertTokenClasses', () => {
  it('accepts the real list', () => {
    expect(() => assertTokenClasses([...TOKEN_CLASSES])).not.toThrow()
  })

  it('throws when a variant is missing, added, or reordered', () => {
    /** The throw path has never been exercised: the browser tier only ever runs the agree branch, so
     * until now a mistake in this function would have been indistinguishable from agreement.
     */
    expect(() => assertTokenClasses(['Ident'])).toThrow(/drifted/)
    expect(() => assertTokenClasses([...TOKEN_CLASSES, 'Extra'])).toThrow(/drifted/)
    const swapped = [...TOKEN_CLASSES] as string[]
    ;[swapped[4], swapped[5]] = [swapped[5] as string, swapped[4] as string]
    expect(() => assertTokenClasses(swapped)).toThrow(/drifted/)
  })
})
