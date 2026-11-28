/**
 * The LLVM view as data (LLVM IR view design §5): the module's lines as the view's listing takes them, the lines of an
 * rxm pc and the block following keeps in view, and what the view says while it has no lines. Pure, as `mc-view.ts`
 * is, so a node test reads every row the view marks and every word it draws, over every example's module.
 */
import type { Labels } from './label-rows'
import type { ClifLoad } from './protocol'
import type { LlvmListing } from './types'

/**
 * The module's lines, or why there are none: the writer's refusal in its own words, or a package that trapped on the
 * program, which says nothing of the program.
 */
export type LlvmAnswer = { readonly ir: LlvmListing } | { readonly declined: string } | { readonly trapped: string }

/** The first and last item of the block following keeps in view. */
export type LlvmFollow = { readonly first: number; readonly last: number }

/** The lines of an `LlvmListing` as `ListingPanel` takes them, and the maps between its items and the rxm pcs. */
export type LlvmRows = {
  /** `ListingPanel.setSource`'s input: each line an item, but a `define`, a label named by its line's index. */
  readonly source: { readonly listing: readonly string[]; readonly labels: Labels }
  /** The line of each item. */
  readonly lineOf: readonly number[]
  /** The rxm pc of item `ordinal`: what a click on it links. `null` for a line with no pc, or no such item. */
  pcOf(ordinal: number): number | null
  /** The items of the rxm pc `pc`, in listing order: what the run's instruction and a link to it mark. */
  ordinalsOfPc(pc: number): readonly number[]
  /**
   * The block following keeps in view while `pc` is about to run or once the run has ended on it, or `null` for a pc
   * with no line: **THE PC'S FIRST UNBROKEN RUN OF ITEMS, ITS `i<pc>` BLOCK, NOT ALL OF THEM.** The writer puts each
   * `cont` block a guard opens after its function's `exit`, so a block from a pc's first item to its last could take
   * the whole function in; its `cont` items are marked all the same.
   */
  followOf(pc: number): LlvmFollow | null
}

/**
 * `ir`'s lines as `LlvmRows`. **A `define` IS A LABEL**, found by the package's `first_line` and not by reading the
 * text, because it heads a function and carries no pc, as a clif view's function row does: drawn as a heading, it is
 * no row a click links or a step marks. **EVERY OTHER LINE IS AN ITEM, ONE WITH NO PC TOO**, so the listing reads line
 * for line as LLVM prints the module, and a line no instruction wrote is one nothing marks.
 */
export function llvmRows(ir: LlvmListing): LlvmRows {
  const listing: string[] = []
  const labels: [string, number][] = []
  const lineOf: number[] = []
  const pcs: (number | null)[] = []
  const byPc = new Map<number, number[]>()
  const defines = new Set(ir.functions.map((f) => f.first_line))
  for (const [n, l] of ir.lines.entries()) {
    if (defines.has(n)) {
      labels.push([String(n), listing.length])
      continue
    }
    const ordinal = listing.length
    listing.push(l.text)
    lineOf.push(n)
    pcs.push(l.pc)
    if (l.pc !== null) byPc.set(l.pc, [...(byPc.get(l.pc) ?? []), ordinal])
  }
  return {
    source: { listing, labels },
    lineOf,
    pcOf: (ordinal) => pcs[ordinal] ?? null,
    ordinalsOfPc: (pc) => byPc.get(pc) ?? [],
    followOf: (pc) => {
      const ordinals = byPc.get(pc)
      const first = ordinals?.[0]
      if (ordinals === undefined || first === undefined) return null
      let last = first
      while (ordinals[last - first + 1] === last + 1) last += 1
      return { first, last }
    },
  }
}

/** The view's own copy: what it says while it has no lines. */
export const LLVM_COPY = {
  loading: 'Loading llvm…',
  writing: 'Writing llvm…',
  failed: 'llvm could not be loaded.',
  retry: 'Retry',
  /**
   * The Retry's name and tooltip. **NAMED FOR WHAT IT LOADS**, so a reader's list of buttons tells it from another
   * view's Retry on the page; **STARTING WITH THE WORD IT SHOWS**, so a spoken "click Retry" still finds it.
   */
  retryName: 'Retry loading llvm',
  declined: (why: string): string => `No llvm for this program: ${why}`,
  trapped: 'llvm could not be written: the package stopped with an error.',
} as const

export type LlvmNotice =
  | { readonly kind: 'loading' }
  | { readonly kind: 'writing' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'declined'; readonly text: string }
  | { readonly kind: 'trapped' }

/**
 * What the view says instead of its lines, or `null` when it shows them or says nothing.
 *
 * **THE ANSWER COMES FIRST**, as the clif view's listing does: lines or a refusal already received are what the view
 * shows. **NOTHING WHILE THE RXM LEG CANNOT RUN**: `reason`, the leg's, is `''` while nothing stops it, and otherwise
 * says why no module is coming, as the view's step bar does, every view's way. Until an answer comes, a failed load
 * says so, a package not yet in says it loads, and one in says the module is being written.
 */
export function llvmNotice(load: ClifLoad, answer: LlvmAnswer | null, reason: string): LlvmNotice | null {
  if (answer !== null) {
    if ('ir' in answer) return null
    return 'declined' in answer ? { kind: 'declined', text: answer.declined } : { kind: 'trapped' }
  }
  if (reason !== '') return null
  if (load === 'failed') return { kind: 'failed' }
  return load === 'ready' ? { kind: 'writing' } : { kind: 'loading' }
}
