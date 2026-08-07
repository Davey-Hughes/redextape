import type { Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { linter } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import { lintRanges } from './diagnostics'
import type { Diagnostic } from './types'

/// `analyze()` as a CodeMirror lint source.
///
/// SYNCHRONOUS AND ON THE MAIN THREAD, for the same reason as highlighting: markers must appear while
/// the program is mid-edit and unparseable, which is exactly when a compile has nothing to say.
///
/// `delay: 100` IS LOAD-BEARING, not a tuning knob. `@codemirror/lint`'s own default is 750 ms,
/// re-armed on every document change — that default is sized for a linter that means a network call or
/// a language-server round trip, where 750 ms hides genuine latency behind a debounce. This source is
/// neither: it is a pure synchronous function over a document already in memory, called straight from
/// the main thread. Left at the default, the marker explaining a broken program would land 450 ms after
/// the results pane already says "not compiled" (`main.ts`'s 300 ms debounce) — the two error surfaces
/// visibly disagreeing on screen. 100 ms reads as live without re-linting mid-keystroke.
export function lintFromAnalyze(analyze: (src: string) => Diagnostic[]): Extension {
  return linter(
    (view) => {
      const doc = view.state.doc.toString()
      return lintRanges(analyze(doc), doc.length).map(
        (r): CmDiagnostic => ({ from: r.from, to: r.to, severity: r.severity, message: r.message }),
      )
    },
    { delay: 100 },
  )
}
