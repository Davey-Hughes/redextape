import { counted, n } from './format'
import type { AsmLeg, LambdaLeg, TmLeg } from './protocol'
import type { AsmCap, Decoded, Diagnostic, RunStatus, ValueReading } from './types'
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
      return 'recording stopped before the run did — the term is not finished reducing'
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
    rows.push({ leg: 'λ', label: 'steps', value: counted(l.state.step, 'reduction') })
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
        ? counted(t.status.total_steps, 'transition')
        : `stopped after ${counted(t.status.total_steps, 'transition')} at a cap`,
    })
  }

  if (t.value) rows.push({ leg: 'TM', label: 'value', value: decodedText(t.value) })
  return rows
}

/** A full cap in words: what the machine ran out of. The step cap is not here — raising it resumes the run. */
const FULL: Readonly<Record<Exclude<AsmCap, 'Steps'>, string>> = {
  Stack: 'the call stack is full',
  Heap: 'the heap is full',
  Mem: 'its saved call frames are full',
}

/**
 * The asm leg's rows (Plan 7 part 5 spec §5.5): its steps as instructions, and its value.
 *
 * **`total_steps` IS `compile`'S OWN RUN**, which drove the asm cursor to its end (amendment 13), so it is a length
 * once that run finished and the count it stopped at otherwise — `tmRows`' distinction, read the same way, off
 * whether the value is `Unfinished`. A fault is an end: it has a length, and its value says what faulted where.
 *
 * **A CAP IS NAMED ONLY WHEN THE RECORDED RUN HAS REACHED IT.** `cap` is the recording cursor's, and a recording that
 * stopped on its history budget first has none; "at a cap" is then all that is known, as for TM.
 */
function asmRows(a: AsmLeg): Row[] {
  if (!a.status.available) return [{ leg: 'asm', label: 'declined', value: a.status.reason }]
  const rows: Row[] = []
  if (a.status.total_steps !== null) {
    const steps = counted(a.status.total_steps, 'instruction')
    const finished = a.value !== null && a.value !== 'Unfinished'
    const cap = a.status.run === 'Capped' ? a.status.cap : null
    rows.push({
      leg: 'asm',
      label: 'steps',
      value: finished
        ? steps
        : cap === null || cap === 'Steps'
          ? `stopped after ${steps} at a cap`
          : `stopped after ${steps} — ${FULL[cap]}`,
    })
  }
  if (a.value) rows.push({ leg: 'asm', label: 'value', value: decodedText(a.value) })
  return rows
}

/** Every leg's rows, in the order the legs are listed: λ, asm, TM. */
export function resultRows(lambda: LambdaLeg, asm: AsmLeg, tm: TmLeg): Row[] {
  return [...lambdaRows(lambda), ...asmRows(asm), ...tmRows(tm)]
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

/**
 * The line a TM buffer's pane shows for its value run, or `null` for no line: a buffer with no header has no value
 * run, and one that has not reported yet has nothing to say.
 *
 * **THE ENDED TEXT IS `decodedText`'s, THE FORMATTER `#results` USES,** so a value reads the same on both surfaces.
 * Only a real value takes the `value: ` prefix; every other ending already says what it is.
 */
export function valueLine(reading: ValueReading | null): string | null {
  if (reading === null) return null
  const { run, value } = reading
  if (run.run === 'Running') return `value: running · ${n(run.steps)} of ${n(run.cap)} steps`
  return endedLine(value)
}

/**
 * The line an ended run's value shows, by `valueLine`'s rule: a real value takes the `value: ` prefix, and every other
 * ending already says what it is. An asm copy's value line is this, since its value arrives ended, with its build.
 */
export function endedLine(value: Decoded): string {
  if (typeof value === 'object' && 'Value' in value) return `value: ${value.Value.text}`
  return decodedText(value)
}
