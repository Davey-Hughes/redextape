import { byteIndexAt, byteToIndex } from './spans'
import type { Diagnostic } from './types'

export type LintRange = { from: number; to: number; severity: 'error' | 'warning'; message: string }

/**
 * Core's `Diagnostic` as `@codemirror/lint`'s shape: `Span` renamed and `Severity` lower-cased.
 *
 * `d.span` IS THE SAME BYTE-OFFSET CONTRACT AS `classify_source`'s spans — see `spans.ts`'s
 * `byteToIndex` doc. `analyze` writes offsets from Rust's `str` position, so a non-ASCII `//` comment
 * (or any non-ASCII text before the diagnostic) shifts the byte offset away from the UTF-16 index by
 * exactly the gap between the two units — converted here before the clamp and the widening below,
 * the same shape `decorationRanges` uses, rather than trusting `span.start`/`span.end` as JS indices
 * directly.
 *
 * THE ZERO-WIDTH CASE IS THE COMMON ONE, not an edge. `let x = ;` reports at the point the parser
 * noticed something missing, and CodeMirror renders nothing at all for `from === to` — so the marker
 * would silently not appear on the single most likely broken program. Widened by one CHARACTER — not
 * one UTF-16 code unit — backwards at the end of the document, and dropped only when there is no
 * document to widen into. Widening by a code unit would, for a zero-width diagnostic that lands on an
 * astral character, produce a position inside its surrogate pair, which CodeMirror rejects or renders
 * wrongly.
 */
export function lintRanges(ds: Diagnostic[], text: string): LintRange[] {
  const map = byteToIndex(text)
  const docLength = text.length
  const out: LintRange[] = []
  for (const d of ds) {
    let from = byteIndexAt(map, d.span.start)
    let to = Math.min(byteIndexAt(map, d.span.end), docLength)
    if (from >= to) {
      if (docLength === 0) continue
      from = Math.min(from, docLength - 1)
      // `byteToIndex` only ever resolves TO a character's own start, but this clamp is raw UTF-16
      // arithmetic and can land on the second half of a surrogate pair when the document's very last
      // character is astral — back up to that character's start so the widening below sees a whole
      // code point rather than half of one.
      if (from > 0 && (text.charCodeAt(from) & 0xfc00) === 0xdc00) from -= 1
      const codePoint = text.codePointAt(from) ?? 0
      to = from + (codePoint > 0xffff ? 2 : 1)
    }
    out.push({ from, to, severity: d.severity === 'Error' ? 'error' : 'warning', message: d.message })
  }
  return out
}
