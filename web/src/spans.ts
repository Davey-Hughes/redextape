import { SPAN_WIRE_BYTES } from './protocol'
import { tokenClassName } from './theme'
import { TOKEN_CLASSES } from './types'

export type DecorationRange = { from: number; to: number; className: string }

/**
 * A byte offset into `text` (as Rust's `str` positions it) mapped to the UTF-16 index CodeMirror and
 * JavaScript strings use.
 *
 * `Span` IS A BYTE RANGE AND JAVASCRIPT STRINGS ARE NOT BYTES. `print_lambda_capped` and `sourceSpan`
 * write offsets from Rust's `str` position, where `λ` is 2 bytes and one UTF-16 code unit — so slicing
 * a JS string by a byte offset silently mis-colours every term that contains a binder, and clamps the
 * tail span away. `decorationRanges` converts through this map rather than trusting
 * `span.start`/`span.end` as JS indices directly.
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
 * ONE HOME, FOR EVERY CALLER. `decorationRanges` below, `highlight.ts`'s marks and `lambda-body.ts`'s
 * flat frame all need exactly this — a byte offset can come in negative, past the map's end, or (its
 * intended case) mid-character, and all of them must resolve it the same way rather than risk drifting
 * apart one clamp expression at a time.
 */
export function byteIndexAt(map: Uint32Array, byteOffset: number): number {
  return map[Math.min(Math.max(byteOffset, 0), map.length - 1)] as number
}

/**
 * `print_lambda_capped`'s output as ordered, in-bounds decoration ranges, converted from byte offsets
 * to the UTF-16 indices JS strings need.
 *
 * **THE λ PANE'S RENDERED FRAME IS THE ONLY CALLER**: the λ view's flat text (`lambda-body.ts`'s `flatText`,
 * shown until a step's tree arrives), whose spans the worker computes per frame from a term it holds, in bytes.
 * The source and copy editors take `colour.ts`'s `treeSitterColour`, whose offsets are already UTF-16 code units
 * and must NOT come through here.
 *
 * **THE SPANS ARRIVE AS ONE BYTE STRING, THREE LITTLE-ENDIAN `u32`S A SPAN** (`viewmodel.rs`'s `LambdaState.spans`):
 * its start and end, byte offsets into `text`, and its class's index in `TOKEN_CLASSES`. Read with a `DataView`, so
 * the byte order is the wire's and not the platform's. A class index past the last class is dropped rather than
 * coloured, and a trailing part of a span is not read.
 *
 * TWO RULES THAT LOOK LIKE PARANOIA AND ARE NOT. The spans' ordering is an assumption this module
 * cannot verify — so it sorts: `flatText` walks the ranges in one pass and skips a range that starts
 * before the last one ended, so a span out of order would lose its colour. And a span past the end is
 * dropped or clamped rather than trusted, because a read past the end of the byte-to-index map is
 * `undefined`, not an index — clamped against that map's own length, not `text.length`, since those
 * two lengths disagree the moment the text is non-ASCII.
 */
export function decorationRanges(spans: Uint8Array, text: string): DecorationRange[] {
  const map = byteToIndex(text)
  const out: DecorationRange[] = []
  const words = new DataView(spans.buffer, spans.byteOffset, spans.byteLength)
  for (let i = 0; i + SPAN_WIRE_BYTES <= spans.byteLength; i += SPAN_WIRE_BYTES) {
    const cls = TOKEN_CLASSES[words.getUint32(i + 8, true)]
    if (cls === undefined) continue
    const from = byteIndexAt(map, words.getUint32(i, true))
    const to = byteIndexAt(map, words.getUint32(i + 4, true))
    if (from >= to) continue
    out.push({ from, to, className: tokenClassName(cls) })
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to)
  return out
}
