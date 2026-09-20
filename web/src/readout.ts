import { showWorkerError } from './banner'
import { n } from './format'
import type { LambdaLeg, RecordEnd, TmLeg } from './protocol'
import { noSessionRows, resultRows, valueLine } from './results'
import type { TmScratchReading } from './sessions'
import type { Diagnostic } from './types'

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
  | { readonly kind: 'result'; readonly lambda: LambdaLeg; readonly tm: TmLeg }
  | { readonly kind: 'no-session'; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: 'error'; readonly error: unknown }

/** One segment per leg: its value, its count and why it stopped, from `results.ts`'s own rows. */
export function programSegments(r: ProgramResult | null): string[] {
  if (r === null) return []
  if (r.kind === 'error') return []
  if (r.kind === 'no-session') return noSessionRows([...r.diagnostics]).map((row) => row.value)
  const rows = resultRows(r.lambda, r.tm)
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
  return [leg('λ'), leg('TM')]
}

const STOPPED: Readonly<Record<RecordEnd, string>> = {
  ended: '',
  capped: 'spent its step budget',
  'depth-refused': 'the term is deeper than the reducer allows',
  budget: 'history is full',
}

export function lambdaCopySegments(
  name: string,
  leg: {
    readonly newestStep: number
    readonly done: RecordEnd | null
    readonly status: { readonly available: boolean; readonly reason: string }
  },
): string[] {
  if (!leg.status.available) return [`${name} · ${leg.status.reason}`]
  const why = leg.done === null ? '' : STOPPED[leg.done]
  return [[name, `${n(leg.newestStep)} reductions`, ...(why === '' ? [] : [why])].join(' · ')]
}

/**
 * A TM copy's line: its name, how far it has run, its value, and the reduced-file sentence if it has one.
 *
 * **IT TAKES THE LEG, AS THE λ ONE DOES, AND THAT IS NOT SYMMETRY FOR ITS OWN SAKE.** Without it this
 * read only what the worker's last `tm-scratch-compiled` reply retained — so a copy that was still
 * building said nothing but its name where a λ copy says `building…`, a stepping copy reported no count
 * at all, and a copy whose thread threw read as a bare name for the rest of the page load: the
 * `worker-error` arm clears the retained reading and writes the reason onto the LEG, which only the λ
 * half was reading (spec §13).
 */
export function tmCopySegments(
  name: string,
  reading: TmScratchReading | null,
  leg: {
    readonly newestStep: number
    readonly status: { readonly available: boolean; readonly reason: string }
  },
): string[] {
  if (!leg.status.available) return [`${name} · ${leg.status.reason}`]
  const parts = [name, `${n(leg.newestStep)} transitions`]
  const value = valueLine(reading?.value ?? null)
  if (value !== null) parts.push(value)
  const reduction = reading?.status.reduction ?? null
  if (reduction !== null) parts.push(`reduced: ${reduction.stages.join(', ')} · ${n(reduction.steps)} steps`)
  return [parts.join(' · ')]
}

/**
 * The strip's readout half. `show` rewrites the element only when what it would show changed — it runs on
 * every frame during playback.
 */
export function createReadout(host: HTMLElement): {
  show(program: ProgramResult | null, segments: readonly string[]): void
} {
  let rendered = ''
  return {
    show(program, segments) {
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
      const key = segments.join('\x01')
      if (key === rendered) return
      rendered = key
      host.replaceChildren(
        ...segments.map((s) => {
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
