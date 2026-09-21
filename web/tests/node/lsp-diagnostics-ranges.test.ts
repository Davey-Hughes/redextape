import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { lspLintRanges } from '../../src/diagnostics'
import type { LspDiagnostic, LspSeverity } from '../../src/lsp-protocol'

const d = (
  startLine: number,
  startCh: number,
  endLine: number,
  endCh: number,
  severity: LspSeverity = 1,
): LspDiagnostic => ({
  range: { start: { line: startLine, character: startCh }, end: { line: endLine, character: endCh } },
  severity,
  message: 'boom',
})

describe('lspLintRanges', () => {
  it('converts line/character to a document offset', () => {
    const doc = Text.of(['let a = 1;', 'let b = 2;', 'let c = 3;'])
    // Line 2 (0-based) character 4 is `c`; line starts are 0, 11, 22.
    expect(lspLintRanges([d(2, 4, 2, 5)], doc)).toEqual([{ from: 26, to: 27, severity: 'error', message: 'boom' }])
  })

  /**
   * **THE WIDENING IS REACHABLE AND COMMON, WHICH WAS MEASURED RATHER THAN ASSUMED.** Driving the
   * real server over fifteen broken programs produced ten zero-width ranges: `let x = ` reports
   * `0:8-0:8` twice, `1 +` and `(` and `if` and `let` each once, `(\x. x` once, and a `.tm` file
   * missing its `tapes` line once. CodeMirror renders NOTHING for `from === to`, so without this
   * the gutter would mark those and the text would not.
   *
   * `let x = ;` is NOT one of them — it reports `0:8-0:9`. A browser test named for the zero-width
   * case while using that program tests the ordinary path under a misleading name, which is what
   * this file was written to stop.
   */
  it('widens a zero-width diagnostic forwards so CodeMirror renders it', () => {
    const doc = Text.of(['let x = '])
    expect(lspLintRanges([d(0, 8, 0, 8)], doc)).toEqual([{ from: 7, to: 8, severity: 'error', message: 'boom' }])
  })

  it('widens backwards at the very end of the document', () => {
    const doc = Text.of(['ab'])
    // Position 2 is past the last character, so there is nothing forward to widen into.
    expect(lspLintRanges([d(0, 2, 0, 2)], doc)).toEqual([{ from: 1, to: 2, severity: 'error', message: 'boom' }])
  })

  /**
   * Widening by one UTF-16 CODE UNIT onto an astral character produces a position inside its
   * surrogate pair, which CodeMirror rejects or renders wrongly. `𝒙` is U+1D499 — two code units.
   */
  it('widens by a whole character, not half a surrogate pair', () => {
    const doc = Text.of(['𝒙'])
    expect(lspLintRanges([d(0, 2, 0, 2)], doc)).toEqual([{ from: 0, to: 2, severity: 'error', message: 'boom' }])
  })

  it('drops a zero-width diagnostic when there is no document to widen into', () => {
    expect(lspLintRanges([d(0, 0, 0, 0)], Text.of(['']))).toEqual([])
  })

  /**
   * **THE SERVER CAN BE AHEAD OF THE DOCUMENT, AND `doc.line` THROWS RATHER THAN CLAMPING.**
   * `didChange` goes out from the update listener and `publishDiagnostics` comes back
   * asynchronously, so a fast typist can delete the line a diagnostic in flight refers to. An
   * unclamped conversion takes out the whole worker message handler.
   */
  it('clamps a diagnostic that names a line past the end of the document', () => {
    const doc = Text.of(['one line'])
    expect(() => lspLintRanges([d(99, 3, 99, 5)], doc)).not.toThrow()
    const [r] = lspLintRanges([d(99, 3, 99, 5)], doc)
    expect(r?.to).toBeLessThanOrEqual(doc.length)
  })

  it('clamps a character past the end of its line rather than running into the next', () => {
    const doc = Text.of(['ab', 'cdef'])
    // Line 0 has 2 characters; character 99 must stop at the line end, not reach line 1.
    expect(lspLintRanges([d(0, 0, 0, 99)], doc)).toEqual([{ from: 0, to: 2, severity: 'error', message: 'boom' }])
  })

  it('maps severity 2 to a warning and everything else to an error', () => {
    const doc = Text.of(['abcdef'])
    expect(lspLintRanges([d(0, 0, 0, 3, 2)], doc)[0]?.severity).toBe('warning')
    expect(lspLintRanges([d(0, 0, 0, 3, 1)], doc)[0]?.severity).toBe('error')
    expect(lspLintRanges([d(0, 0, 0, 3, 3)], doc)[0]?.severity).toBe('error')
    // The server omitting severity is the protocol leaving it to the client. An unmarked problem is
    // still a problem, so it shows as the stronger of the gutter's two levels.
    const noSeverity: LspDiagnostic = { range: d(0, 0, 0, 3).range, message: 'boom' }
    expect(lspLintRanges([noSeverity], doc)[0]?.severity).toBe('error')
  })

  /**
   * **SWAPPED, NOT COLLAPSED** — the same policy `lsp-text.ts`'s `rangeOf` applies. The previous
   * assertion was only `from <= to`, which both policies satisfy, so it could not tell them apart.
   */
  it('swaps an inverted range, preserving its extent', () => {
    const doc = Text.of(['abcdef'])
    expect(lspLintRanges([d(0, 4, 0, 1)], doc)).toEqual([{ from: 1, to: 4, severity: 'error', message: 'boom' }])
  })
})
