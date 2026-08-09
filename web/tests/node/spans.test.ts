import { describe, expect, it } from 'vitest'
import { byteToIndex, decorationRanges, indexToByte } from '../../src/spans'
import type { Classified } from '../../src/types'

const at = (start: number, end: number, cls: Classified[number][1]): Classified[number] => [{ start, end }, cls]

// ASCII, so every byte offset is already the UTF-16 index — used to exercise `decorationRanges`'
// sorting/clamping rules without the conversion itself being the thing under test.
const ascii20 = 'a'.repeat(20)

describe('decorationRanges', () => {
  it('maps each span to its token class name', () => {
    const spans: Classified = [at(0, 3, 'Keyword'), at(4, 5, 'Ident')]
    expect(decorationRanges(spans, ascii20)).toEqual([
      { from: 0, to: 3, className: 'tok-keyword' },
      { from: 4, to: 5, className: 'tok-ident' },
    ])
  })

  it('returns nothing for an empty document', () => {
    expect(decorationRanges([], '')).toEqual([])
  })

  // A RangeSetBuilder throws on out-of-order adds, and the lexer's order is an assumption rather than
  // a guarantee this module can see. Sorting here is cheaper than a crash in a StateField.
  it('sorts by start position', () => {
    const spans: Classified = [at(4, 5, 'Ident'), at(0, 3, 'Keyword')]
    expect(decorationRanges(spans, ascii20).map((r) => r.from)).toEqual([0, 4])
  })

  it('drops empty spans', () => {
    expect(decorationRanges([at(2, 2, 'Punct')], ascii20)).toEqual([])
  })

  // The document the spans were computed from and the document CodeMirror currently holds can differ
  // by one keystroke. A stale span past the end is a crash, so it is clamped rather than trusted.
  it('drops spans that start past the end of the document', () => {
    expect(decorationRanges([at(30, 33, 'Keyword')], ascii20)).toEqual([])
  })

  it('clamps a span that overruns the end of the document', () => {
    expect(decorationRanges([at(18, 25, 'Ident')], ascii20)).toEqual([{ from: 18, to: 20, className: 'tok-ident' }])
  })

  // `λf. λx. f x` — the exact term and spans `print_lambda_capped` produces (`syntax.rs`'s `write_term`):
  // "λ" and the binder name are pushed as SEPARATE spans, "." is its own Punct span, and the space after
  // it is unspanned. 13 bytes, 11 UTF-16 code units — `λ` is 2 bytes but 1 code unit, so every span past
  // the first "λ" is shifted in bytes but not in JS-string terms, and a converter that assumed
  // byte-per-character would mis-slice all of them.
  describe('a real λ-printer span set with a multi-byte binder', () => {
    const text = 'λf. λx. f x'
    const spans: Classified = [
      at(0, 2, 'Binder'), // "λ"
      at(2, 3, 'Binder'), // "f"
      at(3, 4, 'Punct'), // "."
      at(5, 7, 'Binder'), // "λ"
      at(7, 8, 'Binder'), // "x"
      at(8, 9, 'Punct'), // "."
      at(10, 11, 'Ident'), // "f"
      at(12, 13, 'Ident'), // "x" — the END of the string; must not be dropped by a stale byteLength clamp.
    ]

    it('lands every span on the intended character rather than the byte-shifted one', () => {
      const ranges = decorationRanges(spans, text)
      const slice = (from: number, to: number) => text.slice(from, to)
      expect(ranges.map((r) => slice(r.from, r.to))).toEqual(['λ', 'f', '.', 'λ', 'x', '.', 'f', 'x'])
    })

    it('does not drop the span at the very end of the string', () => {
      const ranges = decorationRanges(spans, text)
      const last = ranges.at(-1)
      expect(last).toBeDefined()
      expect(text.slice(last?.from ?? 0, last?.to ?? 0)).toBe('x')
      expect(last?.to).toBe(text.length)
    })
  })
})

describe('byteToIndex', () => {
  it('is the identity map for ASCII text', () => {
    const map = byteToIndex('abc')
    expect(Array.from(map)).toEqual([0, 1, 2, 3])
  })

  it('maps every byte of a multi-byte character to that character’s own UTF-16 index', () => {
    // "λf. λx. f x" — see above for the byte/UTF-16 breakdown.
    const map = byteToIndex('λf. λx. f x')
    expect(Array.from(map)).toEqual([0, 0, 1, 2, 3, 4, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('sizes the map so an end offset at the very end of the text still resolves', () => {
    const text = 'λf. λx. f x'
    const byteLength = new TextEncoder().encode(text).length
    const map = byteToIndex(text)
    expect(map.length).toBe(byteLength + 1)
    expect(map[byteLength]).toBe(text.length)
  })

  // U+1F600 (an emoji) is outside the BMP: 4 UTF-8 bytes, but a JS surrogate PAIR — 2 UTF-16 code
  // units, not 1. A converter that assumed `ch.length === 1` for every code point would advance the
  // UTF-16 index by only 1 here and mis-map everything after it.
  it('advances the UTF-16 index by 2 for a surrogate pair', () => {
    const emoji = '\u{1F600}'
    expect(emoji.length).toBe(2) // sanity: this really is a surrogate pair in JS terms.
    const text = `a${emoji}b`
    const map = byteToIndex(text)
    // byte 0: 'a' (1 byte) -> utf16 index 0
    // bytes 1-4: the emoji (4 bytes) -> utf16 index 1
    // byte 5: 'b' (1 byte) -> utf16 index 3 (the emoji occupied indices 1 AND 2)
    // byte 6: end -> utf16 index 4
    expect(Array.from(map)).toEqual([0, 1, 1, 1, 1, 3, 4])
    expect(text.length).toBe(4)
  })

  // THE REACHABLE GAP: the λ tests above pin the 0x80 boundary (1 vs 2 bytes) and the emoji test pins
  // 0x10000 (3 vs 4 bytes), but nothing pinned 0x800 — so `codePoint < 0x800 ? 2 : …` could mutate to
  // `< 0x8000` and every test here would still pass. '€' (U+20AC) is a realistic case a converter
  // actually meets: any non-ASCII `//` comment is a 2- or 3-byte character, not an emoji.
  it('advances the UTF-16 index by 3 bytes for a character in [U+0800, U+10000)', () => {
    const text = 'a€b'
    expect(new TextEncoder().encode('€').length).toBe(3) // sanity: '€' really is a 3-byte character.
    const map = byteToIndex(text)
    // byte 0: 'a' (1 byte) -> utf16 index 0
    // bytes 1-3: '€' (3 bytes) -> utf16 index 1
    // byte 4: 'b' (1 byte) -> utf16 index 2
    // byte 5: end -> utf16 index 3
    expect(Array.from(map)).toEqual([0, 1, 1, 1, 2, 3])
  })

  // The doc above promises a byte offset landing MID-CHARACTER resolves to that character's own start
  // — not an interpolated index, not the next character's start. The multi-byte tests above establish
  // this only by bundling it into a whole-string array equality; asserted directly here against '€'
  // (byte offsets 1, 2 and 3 all name the same 3-byte character starting at byte 1).
  it('resolves a mid-character byte offset to the character’s own starting index', () => {
    const map = byteToIndex('a€b')
    expect(map[1]).toBe(1) // byte 1: '€''s own first byte
    expect(map[2]).toBe(1) // byte 2: mid-character — still '€''s start
    expect(map[3]).toBe(1) // byte 3: mid-character — still '€''s start
    expect(map[4]).toBe(2) // byte 4: 'b', past '€' entirely
  })

  // An unpaired surrogate is not a valid Unicode scalar value, but `classifySource`'s callers hand
  // whatever `TextEncoder` did with the actual document text — which is what a JS string can contain
  // if, say, an edit splits a surrogate pair mid-keystroke. The converter is right here BY COINCIDENCE,
  // and the coincidence is worth recording so a future rewrite does not break it silently.
  it('agrees with TextEncoder on a lone surrogate, and the two agree by coincidence', () => {
    const lone = '\uD800' // an unpaired high surrogate.
    const text = `a${lone}b`
    // `for...of` yields the lone surrogate as ONE code unit (it cannot pair with anything), and
    // `codePointAt(0)` on it returns its raw code unit value, 0xD800 — which falls under this
    // module's `< 0x10000` branch, so the converter emits 3 bytes for it.
    //
    // Separately, `TextEncoder` — what actually turns this string into the bytes Rust receives — has
    // no valid UTF-8 encoding for a lone surrogate and substitutes U+FFFD (the replacement character)
    // instead. U+FFFD is ALSO under 0x10000, so it ALSO encodes to 3 bytes. The two 3s agree because
    // both values happen to land in the same bucket, not because this converter modeled the
    // substitution — a rewrite of the byte-length ternary that moves the 0x10000 boundary would break
    // this agreement without either side noticing.
    const byteLength = new TextEncoder().encode(text).length
    expect(byteLength).toBe(1 + 3 + 1) // 'a' + U+FFFD (3 bytes) + 'b'
    const map = byteToIndex(text)
    expect(Array.from(map)).toEqual([0, 1, 1, 1, 2, 3])
  })
})

describe('indexToByte', () => {
  it('round-trips with byteToIndex on a term with binders', () => {
    // `λ` is 2 bytes and 1 UTF-16 unit, which is the case that makes this non-trivial.
    const text = '(λx. λy. x y) z'
    const fwd = byteToIndex(text)
    const back = indexToByte(text)
    for (let i = 0; i <= text.length; i += 1) {
      expect(fwd[back[i] as number]).toBe(i)
    }
    expect(back[back.length - 1]).toBe(new TextEncoder().encode(text).length)
  })

  // A ROUND TRIP AGAINST `byteToIndex` IS NOT ENOUGH ON ITS OWN: a converter that made the same
  // mistake in both directions (e.g. treating every character as 1 byte) would still round-trip. This
  // pins `indexToByte` against byte offsets counted BY HAND for a real λ-printer term, independent of
  // `byteToIndex`'s own implementation.
  it('matches a hand-counted byte offset for every UTF-16 index of a λ term', () => {
    // '(λx. λy. x y) z' — 15 UTF-16 units (λ is 1 unit each). Byte lengths: '(' 1, 'λ' 2, everything
    // else ASCII at 1 byte. Cumulative byte offset at the START of each character:
    //   ( λ x  .  _  λ  y  .  _  x  _  y  )  _  z  <end>
    //   0 1 3  4  5  6  8  9 10 11 12 13 14 15 16  17
    const text = '(λx. λy. x y) z'
    expect(text.length).toBe(15)
    const back = indexToByte(text)
    expect([...back]).toEqual([0, 1, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
  })

  it('maps both units of a surrogate pair to the character start', () => {
    const text = 'a\u{1F600}b'
    const back = indexToByte(text)
    expect([...back]).toEqual([0, 1, 1, 5, 6])
  })

  // THE ROUND TRIP ABOVE DOES NOT HOLD HERE, AND THIS PINS THE ACTUAL BEHAVIOUR RATHER THAN ASSERTING A
  // ROUND TRIP THAT DOES NOT EXIST — see `indexToByte`'s doc. UTF-16 index 2 is the LOW half of
  // `'a\u{1F600}b'`'s surrogate pair; `indexToByte` reports the astral character's own start byte for
  // it (1, matching `byteToIndex`'s mid-character convention), but running that byte back through
  // `byteToIndex` resolves to index 1 — the pair's HIGH half — not 2. Unreachable through the app's only
  // caller (`lambda-pane.ts`'s `#redraw` only ever looks up a token's start byte, never a byte that
  // lands mid-character), but a real fact about this function that a future change should have to break
  // on purpose, visibly, rather than by accident.
  it('does not round-trip a surrogate pair’s low half — pinned as-is, not asserted as a round trip', () => {
    const text = 'a\u{1F600}b'
    const fwd = byteToIndex(text)
    const back = indexToByte(text)
    expect(back[2]).toBe(1)
    expect(fwd[back[2] as number]).toBe(1)
  })
})
