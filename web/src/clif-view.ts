import { n } from './format'
import type { Labels } from './label-rows'
import type { HeapView, StackView, ValuesView } from './machine-panels'
import type { ClifCompiled, ClifLoad } from './protocol'
import { frames, heapView, resultFirst, wordText } from './rxm-view'
import type { ClifAt, ClifListing, ClifRow, ClifRowKind, ClifState } from './types'
import type { ClifDisplay } from './workspace'

/**
 * The CLIF view as data: its listing's rows, what its values, call stack and heap panels say, and what its listing
 * area says while it has no listing. Pure, as `rxm-view.ts` is for the rxm view, so a node test reads every word the
 * view draws.
 */

/** A CLIF listing as the view's listing panel takes it, and the maps between its rows and the run's instructions. */
export type ClifRows = {
  /** `ListingPanel.setSource`'s input: each Inst row's text, and every other row as a label named by its row index. */
  readonly source: { readonly listing: readonly string[]; readonly labels: Labels }
  /** The listing row of each instruction ordinal. */
  readonly rowOf: readonly number[]
  /** The ordinal of the instruction `at`, or `null` for one the listing does not show. */
  ordinalOf(at: ClifAt): number | null
  /** The ordinals of the instructions lowered from the rxm pc `pc`, in listing order. */
  ordinalsOfPc(pc: number): readonly number[]
}

/**
 * `l`'s rows, built once per listing: the Inst rows are the panel's instructions, by ordinal, and every other row
 * (a function's header and close, a declaration, a block header, an alias, a blank) a label.
 *
 * **A LABEL STANDS BEFORE THE INST ROW AFTER IT**, so `placeLabels` draws every row where Cranelift prints it; the rows
 * after a listing's last Inst row stand at the count, which `placeLabels` draws after it.
 *
 * **AN INSTRUCTION IS ITS FUNCTION AND ITS `inst` TOGETHER**: every function numbers its instructions from 0.
 */
export function clifRows(l: ClifListing): ClifRows {
  const listing: string[] = []
  const labels: [string, number][] = []
  const rowOf: number[] = []
  const ordinals = new Map<string, number>()
  const byPc = new Map<number, number[]>()
  for (const [row, r] of l.rows.entries()) {
    if (!hasPcColumn(r)) {
      labels.push([String(row), listing.length])
      continue
    }
    const ordinal = listing.length
    listing.push(r.text)
    rowOf.push(row)
    ordinals.set(atKey(r.at), ordinal)
    if (r.pc !== null) byPc.set(r.pc, [...(byPc.get(r.pc) ?? []), ordinal])
  }
  return {
    source: { listing, labels },
    rowOf,
    ordinalOf: (at) => ordinals.get(atKey(at)) ?? null,
    ordinalsOfPc: (pc) => byPc.get(pc) ?? [],
  }
}

function atKey(at: ClifAt): string {
  return `${at.function}:${at.inst}`
}

/** A row's rxm pc as the listing's column shows it, `pc13`; `''` for a row with no srcloc. */
export function pcColumn(pc: number | null): string {
  return pc === null ? '' : `pc${pc}`
}

/** Whether the view draws `r` with a pc column: an Inst row, which the panel takes as an instruction. */
function hasPcColumn(r: ClifRow): r is ClifRow & { readonly at: ClifAt } {
  return r.kind === 'Inst' && r.at !== null
}

/**
 * The columns an Inst row's pc column takes at least, `.rxm-pc`'s `min-width` in `style.css`; a longer label widens
 * it. **IN EXACT, AN INST ROW'S INDENT COUNTS THE PC COLUMN'S WIDTH**, as Cranelift's counts the srcloc it prints there
 * and pads to the indent, so its text starts in the column Cranelift's does whatever the label's width, four to the
 * right of its block's header.
 */
export const PC_COLUMNS = 5

/** The columns `r`'s pc column takes: `PC_COLUMNS`, or its label's where that is wider. */
function pcWidth(r: ClifRow): number {
  return Math.max(PC_COLUMNS, pcColumn(r.pc).length)
}

/** The columns Cranelift indents a function's instructions by when the function has no source locations. */
const BARE_INSTRUCTION_INDENT = 4

/**
 * The rows Cranelift places by their function's instruction indent: a block header 4 columns left of it, an
 * instruction and an alias at it. The function line, the preamble and the brace have columns of their own, which do
 * not move with it, and a blank line has none.
 */
const AT_INSTRUCTION_INDENT: ReadonlySet<ClifRowKind> = new Set(['Block', 'Inst', 'Alias'])

/**
 * How a CLIF view lays out its listing (`ClifDisplay`): `exact`, each row at the columns Cranelift prints it at, or
 * `compact`, each function as Cranelift prints one with no source locations, right of a gutter that holds the pc
 * column.
 */
export type ClifLayout = ClifDisplay['layout']

/**
 * The spaces before each of `l`'s rows' text in `layout`, after the pc column on a row that has one. **A ROW'S TEXT
 * IS THE SAME IN BOTH**, and so is its index, so a layout changes nothing a link, a mark or a step names.
 *
 * **EXACT**: each row's `indent`, less the pc column's width on a row that has one.
 *
 * **COMPACT**: Cranelift indents a function's instructions 4 columns when the function has no source locations, and
 * further when it has them, to leave room for the srcloc the pc column stands in for. So each row placed by the
 * instruction indent moves left by its function's own instruction indent, which every Inst row of it is printed at,
 * less 4. The gutter every row then moves right by is the pc column, as wide as the listing's widest label, and the
 * one column Cranelift leaves after a srcloc, so no label meets the text after it.
 */
export function clifLeads(l: ClifListing, layout: ClifLayout): number[] {
  if (layout === 'exact') return l.rows.map((r) => (hasPcColumn(r) ? Math.max(0, r.indent - pcWidth(r)) : r.indent))
  let widest = PC_COLUMNS
  for (const r of l.rows) widest = Math.max(widest, pcColumn(r.pc).length)
  const gutter = widest + 1
  const left = new Array<number>(l.rows.length).fill(0)
  for (const [k, f] of l.functions.entries()) {
    const end = l.functions[k + 1]?.first_row ?? l.rows.length
    const inst = l.rows.slice(f.first_row, end).find((r) => r.kind === 'Inst')?.indent ?? BARE_INSTRUCTION_INDENT
    left.fill(inst - BARE_INSTRUCTION_INDENT, f.first_row, end)
  }
  return l.rows.map((r, i) => {
    // A BLANK LINE HAS NO LEAD: it has no text to place, and a selection copies no spaces where Cranelift prints none.
    if (r.kind === 'Blank') return 0
    const column = gutter + (AT_INSTRUCTION_INDENT.has(r.kind) ? r.indent - (left[i] ?? 0) : r.indent)
    return hasPcColumn(r) ? column - pcWidth(r) : column
  })
}

/**
 * The values panel at `s`: each value the running frame has set, with the rxm registers it stands for, then how many
 * the window hides.
 *
 * **NONE IS UNWRITTEN**: the state lists only the values the running frame has set.
 *
 * At the run's result (`result`) the row of `s.returned` is marked and put first. **FOUND BY ITS NUMBER, NEVER BY AN
 * `rr` LABEL**: a listing can leave several values standing for `rr`, and only one is returned.
 */
export function clifValues(s: ClifState, result: boolean): ValuesView {
  const hidden = s.values_len - s.values.length
  return {
    rows: resultFirst(
      s.values.map((v) => ({
        name: `v${v.value}`,
        text: wordText(v.word),
        regs: v.regs,
        changed: false,
        unwritten: false,
        result: result && v.value === s.returned,
        says: [],
      })),
    ),
    notes: hidden > 0 ? [{ text: `+${n(hidden)} more ${hidden === 1 ? 'value' : 'values'}`, legend: false }] : [],
  }
}

/**
 * The call stack panel at `s`, top first: each frame's function by its name and the rxm label it was built from, and
 * the rxm pc of the instruction it stands at, which in a caller is the call it waits on.
 *
 * **NO SAVED WORDS**: each CLIF frame holds values of its own rather than registers a call saves, so a frame carries
 * only its instruction.
 */
export function clifStack(s: ClifState, l: ClifListing): StackView {
  const hidden = s.depth - s.frames.length
  return {
    count: frames(s.depth),
    frames: s.frames.map((at) => {
      const f = l.functions[at.function]
      return {
        callee: f === undefined ? '?' : `${f.name} ${f.label}`,
        ret: pcColumn(rowAt(l, at)?.pc ?? null),
        saved: '',
      }
    }),
    notes: hidden > 0 ? [`+${n(hidden)} more`] : [],
  }
}

/** The Inst row of `at`, sought among its own function's rows, which run from its `first_row` to the next one's. */
function rowAt(l: ClifListing, at: ClifAt): ClifRow | undefined {
  const start = l.functions[at.function]?.first_row
  if (start === undefined) return undefined
  const end = l.functions[at.function + 1]?.first_row ?? l.rows.length
  for (let row = start; row < end; row += 1) if (l.rows[row]?.at?.inst === at.inst) return l.rows[row]
  return undefined
}

/**
 * The heap panel at `s`, as the rxm view's: each cell and box named by the values whose word is it, a list word for a
 * cell and a box handle for a box. A value past the frame's window is not here to name.
 */
export function clifHeap(s: ClifState): HeapView {
  return heapView(s, (at, tag) => {
    const word = String(at)
    return s.values.flatMap((v) => (v.word.tag === tag && v.word.word === word ? [`v${v.value}`] : []))
  })
}

/** The CLIF view's own copy: what its listing area says while it has no listing. */
export const CLIF_COPY = {
  loading: 'Loading clif…',
  failed: 'clif could not be loaded.',
  retry: 'Retry',
  declined: (why: string): string => `No clif for this program: ${why}`,
} as const

export type ClifNotice =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'declined'; readonly text: string }

/**
 * What the listing area says instead of the listing, or `null` when it shows the listing.
 *
 * **THE PROGRAM'S ANSWER COMES FIRST**: a listing or a reason already received is what the view shows, so the load's
 * state speaks only while the view has neither. **NOR WHILE THE LEG CANNOT RUN**: `reason`, the leg's, is `''` while
 * nothing stops it, and otherwise says why no listing is coming, as the view's step bar does, every view's way.
 */
export function clifNotice(load: ClifLoad, program: ClifCompiled | null, reason: string): ClifNotice | null {
  if (program !== null && 'listing' in program) return null
  if (program !== null) return { kind: 'declined', text: program.error }
  if (reason !== '') return null
  return load === 'failed' ? { kind: 'failed' } : { kind: 'loading' }
}
