import { n } from './format'
import type { LambdaLeg, TmLeg } from './protocol'
import type { Diagnostic, RunStatus } from './types'
import { decodedText } from './types'

export type Row = { leg: string; label: string; value: string; note?: string }

/**
 * How a λ run's end reads.
 *
 * `Running` PRODUCES A ROW, and did not used to: that was true of the old `drive()`, which replied
 * once the run ended and never otherwise. `onRun` now posts `result` after a `budget` stop too — the
 * recording ring filled before the cursor did — and `lambdaStatus().run` is still `Running` when it
 * does. `lambdaRows` below must not call that term a normal form, and this must say why recording
 * stopped rather than staying silent about it.
 *
 * `Capped` AND `DepthRefused` ARE WORDED DIFFERENTLY ON PURPOSE. Raising the cap helps the first and
 * provably cannot help the second, and this slice ships no button — so the wording carries the whole
 * distinction that `RunStatus` was split to preserve.
 */
function runNote(run: RunStatus | null): string | null {
  switch (run) {
    case 'Running':
      return 'recording stopped before the run did — the term below is not finished reducing'
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
    // ONLY `Ended` EARNS THE NAME "normal form". `Running` here means recording stopped on the history
    // budget, not that the term stopped reducing — labelling it a normal form next to "value: not
    // finished" said two contradictory things with nothing explaining the gap between them.
    const label = l.status.run === 'Ended' ? 'normal form' : 'term so far'
    const row: Row = { leg: 'λ', label, value: l.state.text }
    // The text is SHOWN as well as marked. A BYTE cut is a prefix of the real term, so showing it is
    // honest. A DEPTH cut is not — `parens` closes every open paren as the stack unwinds, so the text
    // can be well-formed λ that reparses into a DIFFERENT, shorter term — which is why the two say
    // different things rather than sharing one word.
    if (l.state.cut === 'Bytes') row.note = '… truncated at 64 KiB'
    if (l.state.cut === 'Depth') row.note = '… too deep to show in full'
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

/**
 * ONLY ERROR-SEVERITY DIAGNOSTICS ARE COUNTED. `analyze` returns warnings too, and only an error
 * withholds the session — counting the whole array would report a number the user cannot reconcile
 * with the markers in the gutter.
 */
export function noSessionRows(diagnostics: Diagnostic[]): Row[] {
  const errors = diagnostics.filter((d) => d.severity === 'Error').length
  return [{ leg: '', label: '', value: `not compiled — ${n(errors)} ${errors === 1 ? 'error' : 'errors'}` }]
}
