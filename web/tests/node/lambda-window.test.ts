import { describe, expect, it } from 'vitest'
import { lambdaWindow } from '../../src/lambda-window'
import type { Classified } from '../../src/types'

// `0123456789abcdefghij` — 20 bytes, one span per 5.
const TEXT = '0123456789abcdefghij'
const SPANS: Classified = [
  [{ start: 0, end: 5 }, 'Ident'],
  [{ start: 5, end: 10 }, 'Nat'],
  [{ start: 10, end: 15 }, 'Ident'],
  [{ start: 15, end: 20 }, 'Nat'],
]

describe('lambdaWindow', () => {
  it('shows the whole text when the context covers it', () => {
    const w = lambdaWindow(TEXT, SPANS, { start: 5, end: 10 }, 100)
    expect(w.text).toBe(TEXT)
    expect(w.target).toEqual({ start: 5, end: 10 })
    expect(w.clippedHead).toBe(false)
    expect(w.clippedTail).toBe(false)
  })

  it('clips both sides and reports it, with the target rebased into window coordinates', () => {
    const w = lambdaWindow(TEXT, SPANS, { start: 10, end: 15 }, 2)
    // Context 2 wants [8,17); both edges snap OUTWARD to token boundaries, giving [5,20).
    expect(w.text).toBe('56789abcdefghij')
    expect(w.target).toEqual({ start: 5, end: 10 })
    expect(w.origin).toBe(5)
    expect(w.clippedHead).toBe(true)
    expect(w.clippedTail).toBe(false)
  })

  it('origin is what lets a click inside the window resolve against the whole-text index', () => {
    const w = lambdaWindow(TEXT, SPANS, { start: 10, end: 15 }, 2)
    // A token at window byte 7 is whole-text byte 12 — which is what `nodeAtLambda` must be asked.
    expect(w.origin + 7).toBe(12)
    expect(lambdaWindow(TEXT, SPANS, { start: 5, end: 10 }, 100).origin).toBe(0)
  })

  it('never hides the start of the target — it clips the TAIL when the target is huge', () => {
    // The target is the whole text and the context is tiny. The window must still begin at the
    // target's start; a window that opened in the middle of the clicked construct would lie about
    // what was clicked.
    const w = lambdaWindow(TEXT, SPANS, { start: 0, end: 20 }, 0)
    expect(w.target.start).toBe(0)
    expect(w.text.startsWith('0')).toBe(true)
  })

  it('rebases every overlapping span into window coordinates and drops the rest', () => {
    const w = lambdaWindow(TEXT, SPANS, { start: 10, end: 15 }, 2)
    expect(w.spans).toEqual([
      [{ start: 0, end: 5 }, 'Nat'],
      [{ start: 5, end: 10 }, 'Ident'],
      [{ start: 10, end: 15 }, 'Nat'],
    ])
  })

  it('an empty text yields an empty window rather than throwing', () => {
    const w = lambdaWindow('', [], { start: 0, end: 0 }, 10)
    expect(w.text).toBe('')
    expect(w.spans).toEqual([])
    expect(w.clippedHead).toBe(false)
    expect(w.clippedTail).toBe(false)
  })

  // AN EMPTY `lambdaText`, PASSED WITH NON-TRIVIAL SPANS/TARGET/CONTEXT — not just the all-zero
  // degenerate call above. `lambdaWindow` short-circuits on `text === ''` before it ever looks at its
  // other three arguments (see the function body), so this pins that the short-circuit really does
  // ignore them rather than, say, indexing an out-of-range target against an empty byte map. Defensive
  // coverage: `main.ts` never calls this with an empty `lambdaText` in practice (`lambdaLinkState`
  // reports `'declined'` before `lambdaWindow` would ever run), but the pure function itself makes no
  // such promise, and a future caller should be able to trust it either way.
  it('yields the empty window regardless of spans/target/context when lambdaText is empty', () => {
    const spans: Classified = [[{ start: 0, end: 5 }, 'Ident']]
    const w = lambdaWindow('', spans, { start: 3, end: 9 }, 50)
    expect(w.text).toBe('')
    expect(w.spans).toEqual([])
    expect(w.target).toEqual({ start: 0, end: 0 })
    expect(w.origin).toBe(0)
    expect(w.clippedHead).toBe(false)
    expect(w.clippedTail).toBe(false)
  })

  // A WINDOW OF LENGTH 1 — the narrowest window this function can produce, and distinct from the
  // empty-text case above: one single-byte token IS the whole text, clicked in full, with no context
  // needed to read it and nothing on either side to clip. Nothing above exercises a window this small;
  // the narrowest elsewhere in this file ("clips only the tail...") is still five bytes wide.
  it('renders a window of length 1 for a single-byte token with no surrounding text', () => {
    const spans: Classified = [[{ start: 0, end: 1 }, 'Ident']]
    const w = lambdaWindow('x', spans, { start: 0, end: 1 }, 0)
    expect(w.text).toBe('x')
    expect(w.spans).toEqual(spans)
    expect(w.target).toEqual({ start: 0, end: 1 })
    expect(w.origin).toBe(0)
    expect(w.clippedHead).toBe(false)
    expect(w.clippedTail).toBe(false)
  })

  // THE TAIL-CLIPPING CASE THE ABOVE TESTS DO NOT EXERCISE: a target near the FRONT of a text too long
  // for the context to cover, so only the tail end is clipped and the head is not. A suite where every
  // clipping test also clips the head would pass even if tail-clipping were deleted outright.
  it('clips only the tail when the target sits at the front of a text longer than the context can cover', () => {
    const w = lambdaWindow(TEXT, SPANS, { start: 0, end: 5 }, 2)
    // wantEnd = 5 + 2 = 7, which lands inside the [5,10) span, so it snaps outward to 10.
    expect(w.clippedHead).toBe(false)
    expect(w.clippedTail).toBe(true)
    expect(w.text).toBe('0123456789')
    expect(w.target).toEqual({ start: 0, end: 5 })
  })
})

// A λ-BEARING FIXTURE FOR THE BYTE/UTF-16 AXIS THE SUITE ABOVE NEVER EXERCISES. `TEXT` above is pure
// ASCII, so a byte offset and a UTF-16 index coincide there and slicing `text` by a raw byte offset
// happens to work anyway — which is exactly how this function's bug survived review. `λ` is 2 bytes
// and 1 UTF-16 code unit, so prefixing the fixture with one binder glyph makes every following byte
// offset drift one UTF-16 index ahead of itself. Same shape as `TEXT`/`SPANS` above, every offset
// shifted 2 bytes to make room for the glyph — see `highlight.test.ts`'s `linkMark` case for the same
// idiom (`'λf. λx. f x'`) applied to a sibling module.
const LAMBDA_TEXT = `λ${TEXT}`
const LAMBDA_SPANS: Classified = [
  [{ start: 2, end: 7 }, 'Ident'],
  [{ start: 7, end: 12 }, 'Nat'],
  [{ start: 12, end: 17 }, 'Ident'],
  [{ start: 17, end: 22 }, 'Nat'],
]

describe('lambdaWindow, against text with a non-ASCII prefix', () => {
  it('slices a head-clipped window through the byte-to-UTF-16 map, not as a raw byte offset', () => {
    // Same target/context as the plain-ASCII "clips both sides" case above, shifted 2 bytes for the
    // leading `λ`. Slicing `text.slice(start, end)` directly on the BYTE offsets 7 and 22 — as if they
    // were UTF-16 indices — reads `LAMBDA_TEXT`'s UTF-16 units 7..21 (22 clamped to the 21-unit length)
    // and comes back `'6789abcdefghij'`: one character short at the head, because the leading `λ` ate
    // one UTF-16 slot for two bytes and nothing converted for it.
    const w = lambdaWindow(LAMBDA_TEXT, LAMBDA_SPANS, { start: 12, end: 17 }, 2)
    expect(w.text).toBe('56789abcdefghij')
    expect(w.target).toEqual({ start: 5, end: 10 })
    expect(w.origin).toBe(7)
    expect(w.clippedHead).toBe(true)
    expect(w.clippedTail).toBe(false)
  })

  // THE SECOND, INDEPENDENT MANIFESTATION: `end` clamped against the UTF-16 length instead of the byte
  // length. A target that reaches the true end of the text (byte 3 of `LAMBDA_TEXT`, which is 2 UTF-16
  // units long) must rebase to `target.end === 3`, the FULL byte length — clamping against
  // `text.length` (2) instead cuts the last byte off the target and the highlight it drives
  // under-covers, even though `w.text` itself still reads correctly here (both UTF-16 units are still
  // included either way, so this case isolates the clamp bug from the slicing bug above).
  it('does not clamp a target reaching the end of the text against the UTF-16 length', () => {
    const w = lambdaWindow('λx', [], { start: 0, end: 3 }, 100)
    expect(w.text).toBe('λx')
    expect(w.target).toEqual({ start: 0, end: 3 })
    expect(w.clippedTail).toBe(false)
  })
})
