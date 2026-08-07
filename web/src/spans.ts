import { tokenClassName } from './theme'
import type { Classified } from './types'

export type DecorationRange = { from: number; to: number; className: string }

/// `classify_source`'s output as ordered, in-bounds decoration ranges.
///
/// TWO RULES THAT LOOK LIKE PARANOIA AND ARE NOT. `RangeSetBuilder` throws on an out-of-order add, and
/// the lexer's ordering is an assumption this module cannot verify — so it sorts. And the document the
/// spans were computed from can be one keystroke behind the document CodeMirror holds, so a span past
/// the end is dropped or clamped rather than trusted.
export function decorationRanges(spans: Classified, docLength: number): DecorationRange[] {
  const out: DecorationRange[] = []
  for (const [span, cls] of spans) {
    const from = span.start
    const to = Math.min(span.end, docLength)
    if (from >= to) continue
    out.push({ from, to, className: tokenClassName(cls) })
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to)
  return out
}
