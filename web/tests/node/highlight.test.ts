import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { declineMark, setDecline } from '../../src/highlight'

/**
 * `declineMark` had NO TEST AT ALL before this file — the byte→UTF-16 conversion it shares with
 * `decorationRanges` (`spans.ts`'s `byteIndexAt`) was only ever exercised through `decorationRanges`'
 * own tests. `EditorState` needs no DOM, so the conversion is checked here the same way
 * `decorationRanges` is checked in `spans.test.ts`, without a browser.
 */
describe('declineMark', () => {
  it('marks the non-ASCII character a decline span names, not the byte-shifted one', () => {
    // 'λf. λx. f x' — see `spans.test.ts`'s doc comment for the byte/UTF-16 breakdown. Byte offsets
    // 5..7 are the SECOND 'λ', two bytes long; its UTF-16 index is 4, one code unit — the first 'λ'
    // and its binder name shift every following byte offset by one without moving the UTF-16 index at
    // all, so an unconverted reader would mark the wrong character.
    const text = 'λf. λx. f x'
    let state = EditorState.create({ doc: text, extensions: [declineMark] })
    state = state.update({ effects: setDecline.of({ start: 5, end: 7 }) }).state

    const ranges: { from: number; to: number }[] = []
    state.field(declineMark).between(0, text.length, (from, to) => {
      ranges.push({ from, to })
    })

    expect(ranges).toEqual([{ from: 4, to: 5 }])
    expect(text.slice(4, 5)).toBe('λ')
  })
})
