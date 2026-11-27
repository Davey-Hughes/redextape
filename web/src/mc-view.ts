/**
 * The clif view's machine code panel as data (machine code panel design §4): its rows as the panel's listing takes
 * them, what each row says, and what the panel says while it has no rows. Pure, as `clif-view.ts` is, so a node test
 * reads every word the panel draws.
 */
import { pcColumn } from './clif-view'
import type { Labels } from './label-rows'
import type { McAnswer } from './machine-code'
import type { ClifCompiled, ClifLoad, Listing, McTarget } from './protocol'
import type { McListing, McRow } from './types'
import type { ClifDisplay } from './workspace'

/** An x86-64 syntax: the one Cranelift prints, or Intel's. */
export type McSyntax = NonNullable<ClifDisplay['syntax']>

/** The rows of an `McListing` as `ListingPanel` takes them, and the maps between its rows and the rxm pcs. */
export type McRows = {
  /** `ListingPanel.setSource`'s input: each Inst row an instruction, every other row a label named by its index. */
  readonly source: { readonly listing: readonly string[]; readonly labels: Labels }
  /** The listing row of each instruction ordinal. */
  readonly rowOf: readonly number[]
  /** The ordinals of the machine instructions of the rxm pc `pc`, in listing order. */
  ordinalsOfPc(pc: number): readonly number[]
}

/**
 * `code`'s rows: the Inst rows are the panel's instructions by ordinal, and a function's header and the blank before it
 * are labels, which stand before the Inst row after them, as `clifRows`' do.
 */
export function mcRows(code: McListing): McRows {
  const listing: string[] = []
  const labels: [string, number][] = []
  const rowOf: number[] = []
  const byPc = new Map<number, number[]>()
  for (const [row, r] of code.rows.entries()) {
    if (r.kind !== 'Inst') {
      labels.push([String(row), listing.length])
      continue
    }
    const ordinal = listing.length
    listing.push(r.text)
    rowOf.push(row)
    if (r.pc !== null) byPc.set(r.pc, [...(byPc.get(r.pc) ?? []), ordinal])
  }
  return { source: { listing, labels }, rowOf, ordinalsOfPc: (pc) => byPc.get(pc) ?? [] }
}

/** An instruction's offset in its function, four hex digits as the snapshots' offsets read. */
export function mcOffset(offset: number): string {
  return offset.toString(16).padStart(4, '0')
}

/** The parts of an Inst row, in the order the panel lays them out; `bytes` is `''` unless they are shown. */
export type McLine = {
  readonly offset: string
  readonly pc: string
  readonly bytes: string
  readonly text: string
  readonly callee: string
}

/**
 * What an Inst row says in `syntax`: its offset, its pc as the clif listing's column shows it, its bytes in pairs when
 * `bytes` is on, its instruction, and after `; `, an assembler's comment, the function a relocation in it is filled in
 * with. **AN ARM64 ROW HAS ONE SYNTAX**, so `intel` reads its one text.
 */
export function mcLine(r: McRow, syntax: McSyntax, bytes: boolean): McLine {
  return {
    offset: mcOffset(r.offset),
    pc: pcColumn(r.pc),
    bytes: bytes ? (r.bytes.match(/../g) ?? []).join(' ') : '',
    text: syntax === 'intel' && r.intel !== null ? r.intel : r.text,
    callee: r.callee === null ? '' : `; ${r.callee}`,
  }
}

/** A function's header row: its name and label as the call stack gives them, and its size. */
export function mcFunctionLine(code: McListing, function_: number): string {
  const f = code.functions[function_]
  return f === undefined ? '' : `${f.name} ${f.label}  ${f.size} ${f.size === 1 ? 'byte' : 'bytes'}`
}

/**
 * What the panel's header says beside its name: the target, and the listing the code is compiled from in the words of
 * the view's own choice, so the header and the choice name one level one way.
 */
export function mcTitle(target: McTarget, listing: Listing): string {
  return `${target} · ${listing === 'optimised' ? 'optimised' : 'as built'}`
}

/** The panel's own copy: what it says while it has no rows. */
export const MC_COPY = {
  loading: 'Loading machine code…',
  building: 'Building machine code…',
  failed: 'machine code could not be loaded.',
  retry: 'Retry',
  /** The Retry's name and tooltip, apart from the clif notice's Retry beside it (`CLIF_COPY.retryName`'s reasons). */
  retryName: 'Retry loading machine code',
  declined: (why: string): string => `No machine code for this program: ${why}`,
  trapped: 'machine code could not be built: the package stopped with an error.',
} as const

export type McNotice =
  | { readonly kind: 'loading' }
  | { readonly kind: 'building' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'declined'; readonly text: string }
  | { readonly kind: 'trapped' }

/**
 * What the panel says instead of its rows, or `null` when it shows them or says nothing.
 *
 * **WHERE THE VIEW HAS NO LISTING, THE PANEL SAYS WHAT THE LISTING SAYS** (design §4, *When there is none*), from the
 * `program` and `reason` `clifNotice` reads: a decline in the decline's words, and nothing where the leg cannot run,
 * whose reason the step bar gives; while the listing is still to come, its own load. **WITH A LISTING, THE ANSWER
 * COMES FIRST**, as the listing's does; while there is none, a failed load says so, a package not yet in says it loads,
 * and one in says the code is being built.
 */
export function mcNotice(
  load: ClifLoad,
  answer: McAnswer | null,
  program: ClifCompiled | null,
  reason: string,
): McNotice | null {
  if (program !== null && 'error' in program) return { kind: 'declined', text: program.error }
  if (program === null && reason !== '') return null
  if (program !== null && answer !== null) {
    if ('code' in answer) return null
    return 'declined' in answer ? { kind: 'declined', text: answer.declined } : { kind: 'trapped' }
  }
  if (load === 'failed') return { kind: 'failed' }
  return load === 'ready' ? { kind: 'building' } : { kind: 'loading' }
}
