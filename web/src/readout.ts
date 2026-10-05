import { showWorkerError } from './banner'
import { counted, n } from './format'
import { LEG_NAME, LEGS } from './legs'
import type { AsmLeg, LambdaLeg, RecordEnd, TmLeg } from './protocol'
import { endedLine, noSessionRows, type Row, resultRows, valueLine } from './results'
import type { AsmScratchReading, TmScratchReading } from './sessions'
import type { Diagnostic } from './types'
import type { ReadoutSwitch } from './workspace'

/**
 * THE READOUT — Plan 7 part 2 spec §9: value and steps for the focused view's session, as one line (the
 * strip). The inspector (2b) will show the same facts one per line.
 *
 * **THE PROGRAM'S RESULT IS STORED, NOT RENDERED ON ARRIVAL.** `replies.ts` used to write the rows into
 * `#results` when a `result` reply landed; the strip now shows whichever session the focused view shows, so a
 * focus change has to be able to put the program back without a recompile. `replies.ts` hands the result
 * here and `draw()` renders it.
 *
 * **`#results[data-state]` IS STILL THE PROGRAM'S COMPILE STATE** — `running` while a compile is in flight,
 * `idle` after — whatever the strip is describing; the browser tests wait on it.
 *
 * **NO NORMAL-FORM TEXT.** A normal form can be 64 KiB; the λ view shows it, and the inspector will.
 */

export type ProgramResult =
  | {
      readonly kind: 'result'
      /**
       * The generation whose compile this is: the `result` reply's own `gen`. The legs may be recording a later one,
       * and a recording's fact is drawn only beside a result of the generation it records (`programResultRows`).
       */
      readonly gen: number
      readonly lambda: LambdaLeg
      readonly asm: AsmLeg
      readonly tm: TmLeg
    }
  | { readonly kind: 'no-session'; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: 'error'; readonly error: unknown }

/**
 * What the program's readout reads of one leg's live recording: how far it has got, how it stopped, and the step a
 * link's position is taking it to (`LegState.pending`), absent when no link is.
 */
export type RecordingLeg = {
  readonly hist: { readonly newestStep: number }
  readonly done: RecordEnd | null
  readonly pending?: number
}

/**
 * The program's two machine legs as they are recording, and the generation the session client last claimed, which the
 * legs record from its `compiled` reply on; from a supersede to that reply they still hold the earlier one's frames.
 *
 * **EVERY FIELD IS REQUIRED.** The program's session has every leg (`main.ts` builds it so), and a caller that could
 * pass `{}` would draw the readout with no fact and a type checker satisfied. λ's leg is not here: nothing reads it
 * (`programResultRows`' doc).
 */
export type ProgramRecording = { readonly gen: number; readonly asm: RecordingLeg; readonly tm: RecordingLeg }

/**
 * `results.ts`'s rows for the program, with a row saying where a machine leg's recording filled its history.
 *
 * **THE RESULT IS THE COMPILE'S RUN AND THE FACT IS THE RECORDING'S, SO THEY ARE TWO INPUTS.** `compile` runs the asm
 * and TM legs to their end, so the result counts the whole run; the recording the views step through can stop on its
 * history budget well before that end (on `fact(12)` the TM's run is 481,964 transitions and its history fills at
 * 75,850). Read off the result alone, the readout said nothing of it while the TM view's step line said `history is
 * full`. The step named is `hist.newestStep`, which is that step line's `of N`, and the words are `STOPPED`'s.
 *
 * **IT FOLLOWS THE RECORDING, WHICH `draw.ts` HANDS OVER ON EVERY FRAME.** While *keep recording* runs a leg on, its
 * `done` is `null` and the row is gone; it comes back, further on, only if the history fills again, and not once the
 * run ends.
 *
 * **ONLY BESIDE A RESULT OF THE GENERATION THE CLIENT LAST CLAIMED.** The worker posts `result` once every leg has
 * recorded (`onRun`), and a recompile's `compiled` reply resets the legs well before that, so for the whole recording
 * the result on hand is the previous program's: `map and fold`'s `TM 9 · 91,785 transitions` was drawn with
 * `fact(12)`'s `history is full at 75,850`. The result carries its reply's `gen` and the client holds the generation it
 * last claimed, so the comparison needs no state kept in step across the reply arms that could change it, where a flag
 * set at `compiled` and cleared at `result` would. It also leaves no fact from a supersede to the first reply, the
 * window in which the step line says `— recompiling`.
 *
 * **NOT AT A STOP A LINK IS TAKING THE LEG PAST.** While a link's position is pending, the step line says `— going to
 * step N from the link` where it would say `— history is full` (`controls.ts`'s `controlState`): the link continues
 * the recording from that stop, so the readout leaves it unsaid too.
 *
 * **λ GETS NO SUCH ROW.** Its `run` row already says that recording stopped before the run did (`results.ts`'s
 * `runNote`), read off the result, which the worker posts once every leg has recorded (`onRun`) and again after a
 * continue of any leg (`onExtend`); a second sentence would say it twice.
 *
 * **AFTER THE LEG'S `steps` ROW**, so the strip reads it after the leg's count (`programSegments` puts the width last)
 * and the inspector between the count and the value, where λ's `run` row sits. A declined leg has no `steps` row and
 * records nothing, so it gets none.
 */
function programResultRows(r: Extract<ProgramResult, { kind: 'result' }>, recording: ProgramRecording): Row[] {
  const rows = resultRows(r.lambda, r.asm, r.tm)
  if (r.gen !== recording.gen) return rows
  const full = new Map<string, string>()
  for (const l of ['asm', 'tm'] as const) {
    const leg = recording[l]
    if (leg.done === 'budget' && leg.pending === undefined)
      full.set(LEG_NAME[l], `${STOPPED.budget} at ${n(leg.hist.newestStep)}`)
  }
  return rows.flatMap((row) => {
    const fact = row.label === 'steps' ? full.get(row.leg) : undefined
    return fact === undefined ? [row] : [row, { leg: row.leg, label: 'recording', value: fact }]
  })
}

/**
 * One segment per leg: its value, its count and why it stopped, from `results.ts`'s own rows, and where a machine
 * leg's recording filled its history (`programResultRows`).
 */
export function programSegments(r: ProgramResult | null, recording: ProgramRecording): string[] {
  if (r === null) return []
  if (r.kind === 'error') return []
  if (r.kind === 'no-session') return noSessionRows([...r.diagnostics]).map((row) => row.value)
  const rows = programResultRows(r, recording)
  const leg = (name: string): string => {
    const own = rows.filter((row) => row.leg === name)
    const declined = own.find((row) => row.label === 'declined')
    if (declined !== undefined) return `${name} declined — ${declined.value}`
    const value = own.find((row) => row.label === 'value')?.value
    // THE WIDTH GOES LAST, AS `width N` (spec §9's `TM 42 · 18,574 transitions · width 8`): `results.ts`
    // lists it first, as `N cells`, for a table where each row has its label beside it.
    const rest = own.filter((row) => !['value', 'normal form', 'term so far', 'width'].includes(row.label))
    const width = name === 'TM' && r.tm.status.width !== null ? [`width ${n(r.tm.status.width)}`] : []
    return [value === undefined ? name : `${name} ${value}`, ...rest.map((row) => row.value), ...width].join(' · ')
  }
  // ONE SEGMENT PER LEG, IN `LEGS`' ORDER — λ, asm, TM — named as `LEG_NAME` names them, which is what `results.ts`'s
  // rows are labelled with.
  return LEGS.map((l) => leg(LEG_NAME[l]))
}

const STOPPED: Readonly<Record<RecordEnd, string>> = {
  ended: '',
  capped: 'spent its step budget',
  'depth-refused': 'the term is deeper than the reducer allows',
  budget: 'history is full',
  'stack-full': 'the call stack is full',
  'heap-full': 'the heap is full',
  'memory-full': 'its saved call frames are full',
}

export type LambdaCopyLeg = {
  readonly newestStep: number
  readonly done: RecordEnd | null
  readonly status: { readonly available: boolean; readonly reason: string }
}

/**
 * A λ copy's facts, one per element, the copy's name first.
 *
 * **THE PARTS ARE THE SOURCE AND THE JOINED LINE IS DERIVED, NOT THE OTHER WAY ROUND.** The strip wants one
 * line and the inspector wants one row per fact (spec §9), and the obvious shortcut — split the strip's
 * line back on its own ` · ` — is wrong: a TM copy's reduced-file sentence CONTAINS a ` · `
 * (`reduced: <stages> · <n> steps`), so the round trip cuts it in half. One list, two renderings.
 */
export function lambdaCopyParts(name: string, leg: LambdaCopyLeg): string[] {
  if (!leg.status.available) return [name, leg.status.reason]
  const why = leg.done === null ? '' : STOPPED[leg.done]
  return [name, counted(leg.newestStep, 'reduction'), ...(why === '' ? [] : [why])]
}

export function lambdaCopySegments(name: string, leg: LambdaCopyLeg): string[] {
  return [lambdaCopyParts(name, leg).join(' · ')]
}

/**
 * A TM copy's line: its name, how far it has run, why its recording stopped, its value, and the reduced-file sentence
 * if it has one.
 *
 * **IT TAKES THE LEG, AS THE λ ONE DOES, AND THAT IS NOT SYMMETRY FOR ITS OWN SAKE.** Without it this
 * read only what the worker's last `tm-scratch-compiled` reply retained — so a copy that was still
 * building said nothing but its name where a λ copy says `building…`, a stepping copy reported no count
 * at all, and a copy whose thread threw read as a bare name for the rest of the page load: the
 * `worker-error` arm clears the retained reading and writes the reason onto the LEG, which only the λ
 * half was reading (spec §13).
 *
 * **`done` IS READ AS THE λ AND ASM COPIES READ IT, AND IT WAS NOT.** A TM copy records into the same history budget
 * the program's TM leg does: a copy of `map and fold`'s TM view stops at `step 69,008 of 69,008 — history is full`
 * and offers *keep recording*, while this line read `TM copy 1 · 69,008 transitions · value: 9` and said nothing of
 * it. It names no step where the program's readout names one: a copy's count already is the newest step its recording
 * holds.
 */
export type TmCopyLeg = {
  readonly newestStep: number
  readonly done: RecordEnd | null
  readonly status: { readonly available: boolean; readonly reason: string }
}

/**
 * A TM copy's facts after its name, one per element: how far it has run, why its recording stopped if something
 * stopped it short, its value line and its reduced-file sentence.
 */
export function tmCopyFacts(reading: TmScratchReading | null, leg: TmCopyLeg): string[] {
  if (!leg.status.available) return [leg.status.reason]
  const why = leg.done === null ? '' : STOPPED[leg.done]
  const facts = [counted(leg.newestStep, 'transition'), ...(why === '' ? [] : [why])]
  const value = valueLine(reading?.value ?? null)
  if (value !== null) facts.push(value)
  const reduction = reading?.status.reduction ?? null
  if (reduction !== null) facts.push(`reduced: ${reduction.stages.join(', ')} · ${n(reduction.steps)} steps`)
  return facts
}

/** A TM copy's facts, one per element, by `lambdaCopyParts`' rule. */
export function tmCopyParts(name: string, reading: TmScratchReading | null, leg: TmCopyLeg): string[] {
  return [name, ...tmCopyFacts(reading, leg)]
}

export function tmCopySegments(name: string, reading: TmScratchReading | null, leg: TmCopyLeg): string[] {
  return [tmCopyParts(name, reading, leg).join(' · ')]
}

/** What an asm copy's line reads of its leg: how far its recording has got, and whether it has a status yet. */
export type AsmCopyLeg = {
  readonly newestStep: number
  readonly done: RecordEnd | null
  readonly status: { readonly available: boolean; readonly reason: string }
}

/**
 * An asm copy's facts after its name, one per element: how far its recording has got, why it stopped if a cap stopped
 * it, and its value, which came with its build (spec amendment 26) and reads as its view's value line reads.
 */
export function asmCopyFacts(reading: AsmScratchReading | null, leg: AsmCopyLeg): string[] {
  if (!leg.status.available) return [leg.status.reason]
  const why = leg.done === null ? '' : STOPPED[leg.done]
  return [
    counted(leg.newestStep, 'instruction'),
    ...(why === '' ? [] : [why]),
    ...(reading === null ? [] : [endedLine(reading.value)]),
  ]
}

/** An asm copy's facts, by `lambdaCopyParts`' rule: its name, then `asmCopyFacts`. */
export function asmCopyParts(name: string, reading: AsmScratchReading | null, leg: AsmCopyLeg): string[] {
  return [name, ...asmCopyFacts(reading, leg)]
}

export function asmCopySegments(name: string, reading: AsmScratchReading | null, leg: AsmCopyLeg): string[] {
  return [asmCopyParts(name, reading, leg).join(' · ')]
}

/**
 * What a TM copy's row in the copies menu says below its name: its readout line without the name, so a copy that
 * halted with a value, is still running its value run, filled its history, or has not built yet reads there as it
 * reads in the strip, in the strip's words. `asmCopyRow` is the asm copy's. Both say what stopped a copy's recording
 * short after its count, in `STOPPED`'s words, and the asm copy's value can be a fault.
 *
 * **A MACHINE COPY HAS NO TERM, AND ITS ROW USED TO SAY SO IN WORDS THAT WERE NOT TRUE.** The row's second line is a
 * λ copy's current term; `main.ts` answered `null` for a TM or asm copy, which has none, and `null` reads
 * `no term yet` — "nothing has come back" — under a copy that had run to `value: 6`. What such a copy holds is its
 * run, and its readout already says what became of it.
 */
export function tmCopyRow(reading: TmScratchReading | null, leg: TmCopyLeg): string {
  return tmCopyFacts(reading, leg).join(' · ')
}

/** What an asm copy's row in the copies menu says below its name — `tmCopyRow`'s rule, one leg over. */
export function asmCopyRow(reading: AsmScratchReading | null, leg: AsmCopyLeg): string {
  return asmCopyFacts(reading, leg).join(' · ')
}

/**
 * A leg's live state as a copy's readout reads it — how far its recording has got, how it ended, and whether it has a
 * status yet. One shape for every leg, and every copy's line reads all of it.
 */
export function copyLegOf(leg: {
  readonly hist: { readonly newestStep: number }
  readonly done: RecordEnd | null
  readonly status: { readonly available: boolean; readonly reason: string }
}): LambdaCopyLeg & AsmCopyLeg & TmCopyLeg {
  return { newestStep: leg.hist.newestStep, done: leg.done, status: leg.status }
}

/**
 * One line of the inspector: what it is, and what it says.
 *
 * **A LABEL AND A VALUE, WHERE THE STRIP HAS ONLY A VALUE.** The strip joins facts with ` · ` on one line,
 * so each has to carry its own noun (`width 8`); the inspector has a line per fact and a column for the
 * noun, which is what makes the normal form — the one fact the strip cannot hold — fit.
 *
 * **`InspectorRow`, NOT `Row`**: `results.ts` already exports a `Row`, with a `leg` and an optional `note`,
 * and two types called `Row` in one import graph is the kind of collision a reader resolves by guessing.
 */
export type InspectorRow = {
  readonly label: string
  readonly value: string
  /**
   * `results.ts`'s own `note`, on the one row that has one: the λ normal form, when it was cut.
   *
   * **IT IS CARRIED BECAUSE THE INSPECTOR IS THE FIRST SURFACE SINCE PART 2a TO PRINT THAT ROW.** The strip
   * drops the normal form entirely (spec §9), so nothing rendered a `note` and dropping it cost nothing.
   * The inspector prints the row, and `results.ts` says why the mark has to come with it: a BYTE cut is a
   * prefix of the real term and honest to show, but a DEPTH cut is not — closing every open paren as the
   * stack unwinds yields well-formed λ that reparses into a DIFFERENT, shorter term. Unmarked, a user
   * reads a wrong answer as the answer. `lambda-pane.ts` marks both cuts for the same reason.
   */
  readonly note?: string
}

/**
 * The program's rows for the inspector (spec §9) — `results.ts`'s own rows, which is the whole point: the
 * inspector is the readout `#results` always wanted to be, and the compression into segments is the STRIP's
 * special case rather than the other way round. The normal-form text the strip leaves out is here, and so is a
 * machine leg's full history, as the row the strip's segment is built from (`programResultRows`).
 */
export function programRows(r: ProgramResult | null, recording: ProgramRecording): InspectorRow[] {
  if (r === null || r.kind === 'error') return []
  if (r.kind === 'no-session')
    return noSessionRows([...r.diagnostics]).map((row) => ({ label: row.label, value: row.value }))
  return programResultRows(r, recording).map((row) => ({
    label: `${row.leg} ${row.label}`,
    value: row.value,
    ...(row.note === undefined ? {} : { note: row.note }),
  }))
}

/**
 * A copy's rows: its name is the first row's label, and every other fact is a row of its own.
 *
 * **BUILT FROM THE SAME PARTS LIST THE SEGMENT IS** (`lambdaCopyParts`' doc), so the two readouts cannot
 * disagree about a copy and no ` · ` inside a fact is mistaken for a separator between two.
 */
export function copyRows(parts: readonly string[]): InspectorRow[] {
  const [name, first, ...rest] = parts
  if (name === undefined) return []
  if (first === undefined) return [{ label: name, value: '' }]
  return [{ label: name, value: first }, ...rest.map((value) => ({ label: '', value }))]
}

/**
 * The two shapes a readout can draw, as THUNKS rather than two arrays.
 *
 * **BECAUSE `show` RUNS ON EVERY RECORDED FRAME DURING PLAYBACK**, and each shape costs a walk of
 * `results.ts`'s builders. Handing over both would pay for the one the mode is not showing, on every
 * frame, forever; a thunk pair costs two closures and the renderer calls exactly one of them.
 */
export type Lines = {
  segments(): readonly string[]
  rows(): readonly InspectorRow[]
}

/**
 * The strip's readout half. `show` rewrites the element only when what it would show changed — it runs on
 * every frame during playback.
 */
export function createReadout(host: HTMLElement): {
  /** Which readout this is drawing — spec §9's `readout` switch. */
  setMode(next: ReadoutSwitch): void
  show(program: ProgramResult | null, lines: Lines): void
} {
  let rendered = ''
  let mode: ReadoutSwitch = 'strip'
  return {
    setMode(next) {
      if (next === mode) return
      mode = next
      // **NO `rendered` RESET HERE, AND THE ABSENCE IS DELIBERATE.** The draft had one, on the theory that
      // a switch must repaint even when the facts did not change. It cannot fail to: the key below is
      // PREFIXED per mode (`s`/`i`), so the two key spaces are disjoint and a mode change always produces
      // a key the last render did not write. A reset here would be a second mechanism for one fact, and
      // its sabotage reddened nothing — which is how it was found.
    },
    show(program, lines) {
      // **WHAT THIS LINE IS DESCRIBING, SO THE STYLESHEET CAN TELL.** `#results[data-state]` is the
      // PROGRAM's compile state and stays that whatever the strip shows (spec §9) — but the rule that
      // dims a running compile hangs off the same element, and a copy's readout has nothing to do with
      // the program recompiling. `style.css` scopes the dim to `[data-describes="program"]`.
      //
      // **ABOVE EVERY EARLY RETURN, WHERE IT USED TO BE BELOW THEM — whole-branch review, M2.** The
      // app's FIRST call is `show(null, [])`, whose key is `''`, which is what `rendered` starts as: the
      // unchanged-key return fired and the attribute was never written at all, so the running-compile
      // dim did not apply until the first result landed — the one compile where there is nothing else on
      // the strip to look at. The `error` arm returned early too, which let a copy's `'copy'` survive
      // into a program error.
      //
      // COMPARED BEFORE IT IS WRITTEN, because `show` runs on every frame during playback and an
      // unconditional attribute write is a style invalidation per frame for a value that almost never
      // changes.
      const describes = program === null ? 'copy' : 'program'
      if (host.dataset.describes !== describes) host.dataset.describes = describes
      if (program?.kind === 'error') {
        if (rendered === '\x00error') return
        rendered = '\x00error'
        showWorkerError(host, program.error)
        return
      }
      // RESOLVED ONCE, NOT TWICE. `Lines`' own doc argues the thunks exist so the renderer pays for one
      // shape rather than both; calling the chosen one again below to render it would pay for it twice on
      // every frame that changed.
      const rows = mode === 'inspector' ? lines.rows() : []
      const key =
        mode === 'strip'
          ? `s\x02${lines.segments().join('\x01')}`
          : `i\x02${rows.map((r) => `${r.label}\x00${r.value}\x00${r.note ?? ''}`).join('\x01')}`
      if (key === rendered) return
      rendered = key
      if (mode === 'inspector') {
        host.replaceChildren(
          ...rows.map((r) => {
            const el = document.createElement('div')
            el.className = 'row'
            const label = document.createElement('span')
            label.className = 'row-label'
            label.textContent = r.label
            const value = document.createElement('span')
            value.className = 'row-value'
            value.textContent = r.value
            el.append(label, value)
            // THE CUT IS SHOWN, NOT HIDDEN — see `InspectorRow.note`.
            if (r.note !== undefined) {
              const note = document.createElement('span')
              note.className = 'row-note'
              note.textContent = r.note
              el.append(note)
            }
            return el
          }),
        )
        return
      }
      host.replaceChildren(
        ...lines.segments().map((s) => {
          const el = document.createElement('span')
          el.className = 'segment'
          el.textContent = s
          // THE TOOLTIP IS ON THE SEGMENT, NOT ON THE STRIP. A `title` on `#results` — a `<section>` —
          // gives it an accessible name, which makes it a `region` landmark named after whatever the
          // program last computed, changing on every compile. On the segment it is what it was for:
          // the whole text of a line the stylesheet may have ellipsised.
          el.title = s
          return el
        }),
      )
    },
  }
}
