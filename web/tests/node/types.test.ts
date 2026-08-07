import { describe, expect, it } from 'vitest'
import type { Decoded } from '../../src/types'
import { decodedText } from '../../src/types'

describe('Decoded', () => {
  it('reads a struct variant as a one-key object', () => {
    const d: Decoded = { Value: { text: '42' } }
    expect(decodedText(d)).toBe('42')
  })

  it('reads a unit variant as a bare string', () => {
    expect(decodedText('Unfinished')).toBe('not finished')
    expect(decodedText('Undecodable')).toBe('no encoding for this type')
  })

  it('reads a fault as a tagged object carrying its message', () => {
    expect(decodedText({ Fault: { message: 'budget exhausted' } })).toBe('fault: budget exhausted')
  })
})
