import { showWorkerError } from './banner'
import { n } from './format'
import { LEG_NAME, LEGS } from './legs'
import type { Leg, RecordEnd, ResultLegs } from './protocol'
import { noSessionRows, type Row, resultRows } from './results'
import type { Diagnostic } from './types'
import type { ReadoutSwitch } from './workspace'

/**
 * THE READOUT — Plan 7 part 2 spec §9: the program's value and steps, as one line (the strip). The inspector
 * shows the same facts one per line.
 *
 * **THE PROGRAM'S RESULT IS STORED, NOT RENDERED ON ARRIVAL.** `draw()` renders it with the frame's other facts,
 * so a frame with no reply behind it, a switch between the strip and the inspector among them, draws it again
 * without a recompile. `replies.ts` hands the result to `main.ts` and `draw()` renders it.
 *
 * **`#results[data-state]` IS THE PROGRAM'S COMPILE STATE** — `running` while a compile is in flight,
 * `idle` after — whatever the strip is describing; the browser tests wait on it.
 *
 * **NO NORMAL-FORM TEXT.** A normal form can be 64 KiB; the λ view shows it, and so does the inspector.
 */

export type ProgramResult =
  | {
      readonly kind: 'result'
      /**
       * The generation whose compile this is: the `result` reply's own `gen`. The legs may be recording a later one,
       * and a recording's fact is drawn only beside a result of the generation it records (`programResultRows`).
       */
      readonly gen: number
      readonly legs: Readonly<ResultLegs>
      /** The reply's own `pinned`: whether the TM leg's width is the user's choice, which its rows mark. */
      readonly pinned: boolean
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
  /** The CLIF leg's hold, whose link step the step line still says (`ClifHold.linkStep`). */
  readonly clifHold?: { readonly linkStep?: number }
}

/**
 * The program's legs as they are recording, and the generation the session client last claimed, which the legs record
 * from its `compiled` reply on; from a supersede to that reply they still hold the earlier one's frames.
 *
 * **EVERY FIELD IS REQUIRED.** The program's session has every leg (`main.ts` builds it so), and a caller that could
 * pass `{}` would draw the readout with no fact and a type checker satisfied. λ's leg is here though no row is read
 * off it (`HISTORY_FULL_ROW`), so that one loop over `LEGS` reads every leg's.
 */
export type ProgramRecording = { readonly gen: number } & { readonly [K in Leg]: RecordingLeg }

/** Whether a leg whose recording filled its history gets a row saying so (`programResultRows`). */
const HISTORY_FULL_ROW: Readonly<Record<Leg, boolean>> = {
  // λ GETS NO SUCH ROW. Its `run` row already says that recording stopped before the run did (`results.ts`'s
  // `runNote`), read off the result, which the worker posts once every leg has recorded (`onRun`) and again after a
  // continue of any leg (`onExtend`); a second sentence would say it twice.
  lambda: false,
  rxm: true,
  tm: true,
  clif: true,
}

/**
 * What follows a pinned TM width, in the strip and the inspector (the TM width design, decision 23). With no TM view
 * open there is no width box, so without it a pinned width would read as auto's fit, and a pinned run's overflow
 * fault would point at a control the page does not show.
 */
const PINNED = '(pinned)'

/**
 * `results.ts`'s rows for the program, with a row saying where a machine leg's recording filled its history.
 *
 * **THE RESULT IS THE COMPILE'S RUN AND THE FACT IS THE RECORDING'S, SO THEY ARE TWO INPUTS.** `compile` runs the rxm
 * and TM legs to their end, so the result counts the whole run; the recording the views step through can stop on its
 * history budget well before that end. Read off the result alone, the readout would say nothing of it while the TM
 * view's step line says `history is full`. The step named is `hist.newestStep`, which is that step line's `of N`,
 * and its words are `HISTORY_FULL_WORDS`.
 *
 * **IT FOLLOWS THE RECORDING, WHICH `draw.ts` HANDS OVER ON EVERY FRAME.** While *keep recording* runs a leg on, its
 * `done` is `null` and the row is gone; it comes back, further on, only if the history fills again, and not once the
 * run ends.
 *
 * **ONLY BESIDE A RESULT OF THE GENERATION THE CLIENT LAST CLAIMED.** The worker posts `result` once every leg has
 * recorded (`onRun`), and a recompile's `compiled` reply resets the legs well before that, so for the whole recording
 * the result on hand is the previous program's, and the readout would draw that program's count beside the new
 * program's `history is full at N`. The result carries its reply's `gen` and the client holds the generation
 * it last claimed, so the comparison needs no state kept in step across the reply arms that could change it, where a
 * flag set at `compiled` and cleared at `result` would. It also leaves no fact from a supersede to the first reply,
 * the window in which the step line says `— recompiling`.
 *
 * **NOT AT A STOP A LINK IS TAKING THE LEG PAST.** While a link's position is pending, the step line says `— going to
 * step N from the link` where it would say `— history is full` (`controls.ts`'s `controlState`): the link continues
 * the recording from that stop, so the readout leaves it unsaid too.
 *
 * **AFTER THE LEG'S `steps` ROW**, so the strip reads it after the leg's count (`programSegments` puts the width last)
 * and the inspector between the count and the value, where λ's `run` row sits. A declined leg has no `steps` row and
 * records nothing, so it gets none.
 */
function programResultRows(r: Extract<ProgramResult, { kind: 'result' }>, recording: ProgramRecording): Row[] {
  const rows = resultRows(r.legs).map((row) =>
    r.pinned && row.leg === 'TM' && row.label === 'width' ? { ...row, value: `${row.value} ${PINNED}` } : row,
  )
  if (r.gen !== recording.gen) return rows
  const full = new Map<string, string>()
  for (const l of LEGS) {
    const leg = recording[l]
    if (HISTORY_FULL_ROW[l] && leg.done === 'budget' && (leg.pending ?? leg.clifHold?.linkStep) === undefined)
      full.set(LEG_NAME[l], `${HISTORY_FULL_WORDS} at ${n(leg.hist.newestStep)}`)
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
    const tmWidth = r.legs.tm.status.width
    const width = name === 'TM' && tmWidth !== null ? [`width ${n(tmWidth)}${r.pinned ? ` ${PINNED}` : ''}`] : []
    return [value === undefined ? name : `${name} ${value}`, ...rest.map((row) => row.value), ...width].join(' · ')
  }
  // ONE SEGMENT PER LEG, IN `LEGS`' ORDER — λ, rxm, TM, clif — named as `LEG_NAME` names them, which is what
  // `results.ts`'s rows are labelled with. **A LEG WITH NO ROWS HAS NO SEGMENT**: CLIF has none while no stepper is
  // built (`clifResultRows`), and its bare name would say nothing.
  return LEGS.filter((l) => rows.some((row) => row.leg === LEG_NAME[l])).map((l) => leg(LEG_NAME[l]))
}

/**
 * What a recording that filled its history says: the words the step line gives the same stop (`controls.ts`'s
 * `doneText`), so the readout and a machine view's step line name it alike.
 */
const HISTORY_FULL_WORDS = 'history is full'

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
   * **IT IS CARRIED BECAUSE THE INSPECTOR PRINTS THAT ROW**, where the strip drops the normal form
   * entirely (spec §9). `results.ts` says why the mark has to come with it: a BYTE cut is a
   * prefix of the real term and honest to show, but a DEPTH cut is not — closing every open paren as the
   * stack unwinds yields well-formed λ that reparses into a DIFFERENT, shorter term. Unmarked, a user
   * reads a wrong answer as the answer. `lambda-pane.ts` marks both cuts for the same reason.
   */
  readonly note?: string
}

/**
 * The program's rows for the inspector (spec §9) — `results.ts`'s own rows: the compression into segments is the
 * STRIP's special case rather than the other way round. The normal-form text the strip leaves out is here, and so is
 * a machine leg's full history, as the row the strip's segment is built from (`programResultRows`).
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
      // **NO `rendered` RESET HERE, AND THE ABSENCE IS DELIBERATE.** A switch must repaint even when the
      // facts did not change, and it cannot fail to: the key below is PREFIXED per mode (`s`/`i`), so the
      // two key spaces are disjoint and a mode change always produces a key the last render did not write.
      // A reset here would be a second mechanism for one fact.
    },
    show(program, lines) {
      // **WHETHER THIS LINE DESCRIBES A PROGRAM, SO THE STYLESHEET CAN TELL.** `#results[data-state]` is the
      // PROGRAM's compile state (spec §9), and the rule that dims a running compile hangs off the same element; a
      // call with no program yet, as the first frames of the program's own run make, has no readout for the dim to
      // grey. `style.css` scopes the dim to `[data-describes="program"]`.
      //
      // **ABOVE EVERY EARLY RETURN**, so no return can leave the attribute unwritten or stale: below the
      // `error` arm's, a `'none'` would survive into a program error, and a recompile under it would not dim.
      //
      // COMPARED BEFORE IT IS WRITTEN, because `show` runs on every frame during playback and an
      // unconditional attribute write is a style invalidation per frame for a value that almost never
      // changes.
      const describes = program === null ? 'none' : 'program'
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
