import type { LambdaLeg, TmLeg } from './protocol'
import type { Diagnostic, RunStatus } from './types'
import { decodedText } from './types'

export type Row = { leg: string; label: string; value: string; note?: string }

const n = (x: number) => x.toLocaleString('en-US')

/// How a λ run's end reads. `Running` produces no row — the worker only replies once the run ended.
///
/// `Capped` AND `DepthRefused` ARE WORDED DIFFERENTLY ON PURPOSE. Raising the cap helps the first and
/// provably cannot help the second, and this slice ships no button — so the wording carries the whole
/// distinction that `RunStatus` was split to preserve.
function runNote(run: RunStatus | null): string | null {
  switch (run) {
    case 'Capped':
      return 'spent its step budget'
    case 'DepthRefused':
      return 'the term is deeper than the reducer allows'
    default:
      return null
  }
}

function lambdaRows(l: LambdaLeg): Row[] {
  if (!l.status.available) return [{ leg: 'λ', label: 'declined', value: l.status.reason }]

  const rows: Row[] = []
  if (l.state) {
    const row: Row = { leg: 'λ', label: 'normal form', value: l.state.text }
    // The text is SHOWN as well as marked. Unlike `lambdaAst`'s `None`, a truncated printed term is a
    // prefix of the real one rather than a lie about its shape, and the value is unaffected either way.
    if (l.state.truncated) row.note = '… truncated at 64 KiB'
    rows.push(row)
    rows.push({ leg: 'λ', label: 'steps', value: `${n(l.state.step)} β-steps` })
  }
  const note = runNote(l.status.run)
  if (note) rows.push({ leg: 'λ', label: 'run', value: note })
  if (l.value) rows.push({ leg: 'λ', label: 'value', value: decodedText(l.value) })
  return rows
}

function tmRows(t: TmLeg): Row[] {
  if (!t.status.available) return [{ leg: 'TM', label: 'declined', value: t.status.reason }]

  const rows: Row[] = []
  if (t.status.width !== null) rows.push({ leg: 'TM', label: 'width', value: `${n(t.status.width)} cells` })

  if (t.status.total_steps !== null) {
    // `total_steps` IS A LENGTH ONLY WHEN A FINAL CONFIGURATION EXISTS, AND `run` DOES NOT SAY WHETHER
    // ONE DOES — it reports where the CURSOR stands, and nothing here steps the cursor, so it reads
    // "Running" for a run `compile` already finished. `tmValue()` is the signal: `Unfinished` means no
    // halted run was recorded and the cursor has not halted either.
    //
    // AND THE CAPPED WORDING DOES NOT NAME THE CAP. `TmCursor` caps on the step budget and on the
    // live-cell budget; `trace.rs` records that no test can tell those two apart, and under the cell
    // cap this count lands well below the step budget. "The 2,870-step cap" would be a guess.
    const finished = t.value !== null && t.value !== 'Unfinished'
    rows.push({
      leg: 'TM',
      label: 'steps',
      value: finished
        ? `${n(t.status.total_steps)} δ-steps`
        : `stopped after ${n(t.status.total_steps)} δ-steps at a cap`,
    })
  }

  if (t.value) rows.push({ leg: 'TM', label: 'value', value: decodedText(t.value) })
  return rows
}

export function resultRows(lambda: LambdaLeg, tm: TmLeg): Row[] {
  return [...lambdaRows(lambda), ...tmRows(tm)]
}

/// ONLY ERROR-SEVERITY DIAGNOSTICS ARE COUNTED. `analyze` returns warnings too, and only an error
/// withholds the session — counting the whole array would report a number the user cannot reconcile
/// with the markers in the gutter.
export function noSessionRows(diagnostics: Diagnostic[]): Row[] {
  const errors = diagnostics.filter((d) => d.severity === 'Error').length
  return [{ leg: '', label: '', value: `not compiled — ${n(errors)} ${errors === 1 ? 'error' : 'errors'}` }]
}
