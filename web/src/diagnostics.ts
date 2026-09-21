import type { Text } from '@codemirror/state'
import type { LspDiagnostic, LspRange } from './lsp-protocol'
import { offsetOf } from './lsp-text'

export type LintRange = { from: number; to: number; severity: 'error' | 'warning'; message: string }

/**
 * `publishDiagnostics`' payload as `@codemirror/lint`'s shape.
 *
 * **THE ZERO-WIDTH CASE IS STILL THE COMMON ONE, AND THE WIDENING SURVIVES THE MOVE OFF BYTES.**
 * A zero-width range is not an edge case: driven against the real server, ten of fifteen broken
 * programs produce at least one. `let x = ` reports `0:8-0:8` twice. CodeMirror renders nothing at
 * all for `from === to`, so the marker would silently not appear on some of the most likely broken
 * programs there are. That is a property of CodeMirror rather than of the offsets, which is why
 * the byte arithmetic this replaced could go and this could not.
 *
 * Widened by one CHARACTER rather than one UTF-16 code unit, and backwards at the end of the
 * document: widening by a code unit onto an astral character produces a position inside its
 * surrogate pair, which CodeMirror rejects or renders wrongly.
 */
export function lspLintRanges(ds: LspDiagnostic[], doc: Text): LintRange[] {
  const out: LintRange[] = []
  for (const d of ds) {
    const range: LspRange = d.range
    // **AN INVERTED RANGE IS SWAPPED, NOT COLLAPSED**, which is `lsp-text.ts`'s `rangeOf` policy —
    // one rule for the situation rather than two. Collapsing to `end` threw away the extent and
    // then relied on the zero-width widening below to invent a new one.
    let from = Math.min(offsetOf(doc, range.start), offsetOf(doc, range.end))
    let to = Math.max(offsetOf(doc, range.start), offsetOf(doc, range.end))
    if (from === to) {
      if (doc.length === 0) continue
      if (from >= doc.length) from = doc.length - 1
      const text = doc.sliceString(from, Math.min(from + 2, doc.length))
      // A low surrogate here means the clamp landed inside a pair; back up to the character's start.
      if (from > 0 && (text.charCodeAt(0) & 0xfc00) === 0xdc00) from -= 1
      const codePoint = doc.sliceString(from, Math.min(from + 2, doc.length)).codePointAt(0) ?? 0
      to = Math.min(from + (codePoint > 0xffff ? 2 : 1), doc.length)
    }
    // Severity 1 is Error; everything else the server can send is a warning or weaker, and the
    // gutter has two levels. `undefined` means the server did not say, which LSP leaves to the
    // client — an unmarked problem is still a problem, so it shows as an error rather than silently
    // as the weaker of the two.
    out.push({ from, to, severity: d.severity === 2 ? 'warning' : 'error', message: d.message })
  }
  return out
}
