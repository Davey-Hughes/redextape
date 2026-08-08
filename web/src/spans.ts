import { tokenClassName } from './theme'
import type { Classified } from './types'

export type DecorationRange = { from: number; to: number; className: string }

/**
 * A byte offset into `text` (as Rust's `str` positions it) mapped to the UTF-16 index CodeMirror and
 * JavaScript strings use.
 *
 * `Span` IS A BYTE RANGE AND JAVASCRIPT STRINGS ARE NOT BYTES. `print_lambda_capped` and
 * `classify_source` both write offsets from Rust's `str` position, where `λ` is 2 bytes and one
 * UTF-16 code unit — so slicing a JS string by a byte offset silently mis-colours every term that
 * contains a binder, and clamps the tail span away. `decorationRanges` converts through this map
 * rather than trusting `span.start`/`span.end` as JS indices directly.
 *
 * `map[b]` is the UTF-16 index at byte offset `b`, for every `b` in `0..=byteLength` — including a
 * `b` that lands mid-character (the character's own starting index, so a stale or malformed span
 * resolves sensibly instead of splitting a code unit) and `b === byteLength` (so an end offset at the
 * very end of the text still maps, rather than reading past the array).
 */
export function byteToIndex(text: string): Uint32Array {
  const map: number[] = []
  let utf16Index = 0
  // `for...of` walks CODE POINTS, not UTF-16 code units — a surrogate pair is one iteration here, with
  // `ch.length === 2`, which is what lets `utf16Index` advance by 2 for it.
  for (const ch of text) {
    const codePoint = ch.codePointAt(0) ?? 0
    const byteLen = codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4
    for (let i = 0; i < byteLen; i++) map.push(utf16Index)
    utf16Index += ch.length
  }
  map.push(utf16Index)
  return new Uint32Array(map)
}

/**
 * A single byte offset, looked up in a `byteToIndex` map and clamped into it.
 *
 * ONE HOME, not three. `decorationRanges` below, `highlight.ts`'s `declineMark`, and
 * `diagnostics.ts`'s `lintRanges` each need exactly this lookup — a byte offset can come in negative,
 * past the map's end, or (its intended case) mid-character, and all three must resolve it the same
 * way rather than risk drifting apart one clamp expression at a time.
 */
export function byteIndexAt(map: Uint32Array, byteOffset: number): number {
  return map[Math.min(Math.max(byteOffset, 0), map.length - 1)] as number
}

/**
 * `classify_source`'s (or `print_lambda_capped`'s) output as ordered, in-bounds decoration ranges,
 * converted from byte offsets to the UTF-16 indices CodeMirror and JS strings need.
 *
 * TWO RULES THAT LOOK LIKE PARANOIA AND ARE NOT. `RangeSetBuilder` throws on an out-of-order add, and
 * the lexer's ordering is an assumption this module cannot verify — so it sorts. And the document the
 * spans were computed from can be one keystroke behind the document CodeMirror holds, so a span past
 * the end is dropped or clamped rather than trusted — clamped against the byte-to-index map's own
 * length, not `text.length`, since those two lengths disagree the moment the text is non-ASCII.
 */
export function decorationRanges(spans: Classified, text: string): DecorationRange[] {
  const map = byteToIndex(text)
  const out: DecorationRange[] = []
  for (const [span, cls] of spans) {
    const from = byteIndexAt(map, span.start)
    const to = byteIndexAt(map, span.end)
    if (from >= to) continue
    out.push({ from, to, className: tokenClassName(cls) })
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to)
  return out
}
