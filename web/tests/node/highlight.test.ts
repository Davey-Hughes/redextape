import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { declineMark, linkMark, setDecline, setLink } from '../../src/highlight'

/**
 * `declineMark` converts a byte offset to UTF-16 with `spans.ts`'s `byteIndexAt`, as `decorationRanges`
 * does, and `spans.test.ts` reaches `byteIndexAt` only through `decorationRanges`, so nothing there
 * checks `declineMark`'s own use of it. `EditorState` needs no DOM, so that use is checked here the
 * same way `decorationRanges` is checked in `spans.test.ts`, without a browser.
 */
describe('declineMark', () => {
  it('marks the non-ASCII character a decline span names, not the byte-shifted one', () => {
    // 'λf. λx. f x' — see `spans.test.ts`'s comment on its real λ-printer span set for the byte/UTF-16
    // breakdown. Byte offsets 5..7 are the SECOND 'λ', two bytes long; its UTF-16 index is 4, one code
    // unit — the first 'λ' shifts every following byte offset by one without moving the UTF-16 index
    // at all, so an unconverted reader would mark the wrong character.
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

/**
 * `linkMark` SHARES `declineMark`'s CONVERSION CODE VERBATIM, and shares no test with it — over a
 * pure-ASCII program, a regression that dropped the `byteToIndex`/`byteIndexAt` call entirely would
 * still pass. This is the case that would catch it, and the second checks the one place `linkMark`
 * behaves DIFFERENTLY from `declineMark`: clearing outright on a document change rather than mapping
 * through it (the comment inside `linkMark` in `highlight.ts` explains why).
 */
describe('linkMark', () => {
  it('marks the non-ASCII character a link span names, not the byte-shifted one', () => {
    // Same text and byte/UTF-16 breakdown as the `declineMark` case above: byte offsets 5..7 are the
    // second 'λ', whose UTF-16 index is 4.
    const text = 'λf. λx. f x'
    let state = EditorState.create({ doc: text, extensions: [linkMark] })
    state = state.update({ effects: setLink.of({ start: 5, end: 7 }) }).state

    const ranges: { from: number; to: number }[] = []
    state.field(linkMark).between(0, text.length, (from, to) => {
      ranges.push({ from, to })
    })

    expect(ranges).toEqual([{ from: 4, to: 5 }])
    expect(text.slice(4, 5)).toBe('λ')
  })

  it('clears on a document change rather than mapping through it, unlike declineMark', () => {
    const text = 'let x = 1'
    let state = EditorState.create({ doc: text, extensions: [linkMark] })
    state = state.update({ effects: setLink.of({ start: 4, end: 5 }) }).state
    expect(state.field(linkMark).size).toBeGreaterThan(0)

    state = state.update({ changes: { from: 0, to: 0, insert: ' ' } }).state
    expect(state.field(linkMark).size).toBe(0)
  })
})
