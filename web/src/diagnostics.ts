import type { Diagnostic } from './types'

export type LintRange = { from: number; to: number; severity: 'error' | 'warning'; message: string }

/// Core's `Diagnostic` as `@codemirror/lint`'s shape: `Span` renamed and `Severity` lower-cased.
///
/// THE ZERO-WIDTH CASE IS THE COMMON ONE, not an edge. `let x = ;` reports at the point the parser
/// noticed something missing, and CodeMirror renders nothing at all for `from === to` — so the marker
/// would silently not appear on the single most likely broken program. Widened by one, backwards at
/// the end of the document, and dropped only when there is no document to widen into.
export function lintRanges(ds: Diagnostic[], docLength: number): LintRange[] {
  const out: LintRange[] = []
  for (const d of ds) {
    let from = d.span.start
    let to = Math.min(d.span.end, docLength)
    if (from >= to) {
      if (docLength === 0) continue
      from = Math.min(from, docLength - 1)
      to = from + 1
    }
    out.push({ from, to, severity: d.severity === 'Error' ? 'error' : 'warning', message: d.message })
  }
  return out
}
