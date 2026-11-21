import { n } from './format'
import { type Labels, placeLabels } from './label-rows'
import type { HeapView, StackView, ValuesView } from './machine-panels'
import type { RxmProgram, RxmState, RxmWord, WordTag } from './types'

/**
 * The rxm view as data (Plan 7 part 5 spec §6): the listing's rows, how a word reads, and what the registers, call
 * stack and heap panels say. Pure, so the DOM that draws them (`rxm-pane.ts`, `machine-panels.ts`) holds nothing a
 * node test cannot reach — `program-level.ts`'s arrangement for the TM view's state diagram.
 */

/** One row of the listing: a label, above the instruction it names, or an instruction. Every row is one grid row. */
export type ListingRow =
  | { readonly kind: 'label'; readonly name: string }
  | { readonly kind: 'instr'; readonly pc: number }

/** The listing's rows, with the labels where `placeLabels` puts them (spec §6.2). */
export function listingRows(p: { readonly listing: readonly string[]; readonly labels: Labels }): ListingRow[] {
  const rows: ListingRow[] = []
  placeLabels(
    p.listing.length,
    p.labels,
    (name) => rows.push({ kind: 'label', name }),
    (pc) => rows.push({ kind: 'instr', pc }),
  )
  return rows
}

/** Each instruction's row among `rows`: `rowOf[pc]`. */
export function rowsOfPcs(rows: readonly ListingRow[]): number[] {
  const out: number[] = []
  for (const [row, r] of rows.entries()) if (r.kind === 'instr') out[r.pc] = row
  return out
}

/**
 * An instruction's mnemonic and operands. The listing is `print_instr`'s text, which puts a tab between the two
 * (`li\tr0, #40`); an instruction with no operands (`halt`, `ret`) has no tab.
 */
export function instrParts(line: string): { readonly mnemonic: string; readonly operands: string } {
  const tab = line.indexOf('\t')
  return tab < 0 ? { mnemonic: line, operands: '' } : { mnemonic: line.slice(0, tab), operands: line.slice(tab + 1) }
}

/**
 * A word as the view reads it, by its tag (spec §6.3): a value in decimal; a list pointer as `#3`, the cell it names,
 * or `nil` for the empty list; a box handle as `box #2`.
 *
 * **THE WORD IS A DECIMAL STRING ON THE WIRE AND STAYS ONE HERE** (spec §5.3, amendment 13): a saturated `mul`
 * reaches `u64::MAX`, which a JS number cannot hold exactly. Grouping it with `n` would parse it first, so a value is
 * printed as it came.
 */
export function wordText(w: RxmWord): string {
  switch (w.tag) {
    case 'Value':
      return w.word
    case 'List':
      return w.word === '0' ? 'nil' : `#${w.word}`
    case 'Box':
      return `box #${w.word}`
  }
}

/**
 * The label a saved frame's function was called by: the operand of the `call` just before its return `pc`.
 *
 * **NOT CARRIED BY THE FRAME** (spec §5.3): the instruction before `ret_pc` is the `call` that pushed it, so the
 * listing already says it. `null` when that instruction is not a `call` — which no program `ret` can return through
 * produces, but a hand-written one could.
 */
export function calleeOf(p: RxmProgram, retPc: number): string | null {
  const line = p.listing[retPc - 1]
  if (line === undefined) return null
  const { mnemonic, operands } = instrParts(line)
  return mnemonic === 'call' && operands !== '' ? operands : null
}

/**
 * One register as the registers panel shows it (spec §6.3). `changed` marks the register the last step wrote.
 * `unwritten` marks a local the current call has not written: its word is whatever was there when the call began.
 */
export type RegisterRow = {
  readonly name: string
  readonly text: string
  readonly changed: boolean
  readonly unwritten: boolean
}

/**
 * The registers panel's rows, in the spec's order: `pc`, `rr`, the arguments `a0…`, then the locals `r0…` — each as
 * far as the frame's window carries them.
 *
 * **ONLY A LOCAL HAS A WRITTEN BIT.** `call` clears them all and `ret` restores the caller's (spec §4.3), so an
 * unwritten local inside a call still holds its caller's word — the view's "left over from caller". An argument is
 * written by the caller for the callee, and `rr` by whichever instruction last wrote it; neither is ever left over.
 */
export function registerRows(s: RxmState): RegisterRow[] {
  const rows: RegisterRow[] = [
    { name: 'pc', text: String(s.pc), changed: false, unwritten: false },
    { name: 'rr', text: wordText(s.rr), changed: s.wrote === 'rr', unwritten: false },
  ]
  for (const [i, w] of s.args.entries()) {
    const name = `a${i}`
    rows.push({ name, text: wordText(w), changed: s.wrote === name, unwritten: false })
  }
  for (const [i, w] of s.locals.entries()) {
    const name = `r${i}`
    rows.push({ name, text: wordText(w), changed: s.wrote === name, unwritten: s.written[i] !== true })
  }
  return rows
}

/**
 * What an unwritten local is, in words: the dimmed `·`'s meaning, and each such register's `aria-description`.
 *
 * **"LEFT OVER FROM CALLER" ONLY WHERE THERE IS A CALLER** (spec §6.3). At depth 0 an unwritten local was never written
 * by anything — it exists because a write to a higher register grew the bank, and it reads 0 — so it says that instead.
 */
export function unwrittenMeaning(s: RxmState): string {
  return s.depth > 0 ? 'left over from caller' : 'not written yet'
}

/** The legend under the registers, `· left over from caller`, or `null` when no register is unwritten. */
export function unwrittenLegend(s: RxmState, rows: readonly RegisterRow[]): string | null {
  return rows.some((r) => r.unwritten) ? `· ${unwrittenMeaning(s)}` : null
}

/**
 * The registers a heap cell's or a box's back-reference names (spec §6.5): every register of `tag` whose word is the
 * cell's or box's own number. **EXACT FOR A COMPILED PROGRAM**, whose every list word was made by `cons` or `nil` and
 * copied since (spec §4.3), so a `#57` in a *list* register is cell 57. A register past the frame's window is not
 * here to name.
 */
export function backRefs(s: RxmState, at: number, tag: WordTag): string[] {
  const word = String(at)
  const out: string[] = []
  if (s.rr.tag === tag && s.rr.word === word) out.push('rr')
  for (const [i, w] of s.args.entries()) if (w.tag === tag && w.word === word) out.push(`a${i}`)
  for (const [i, w] of s.locals.entries()) if (w.tag === tag && w.word === word) out.push(`r${i}`)
  return out
}

/** How many frames a count names: `1 frame`, `4 frames`. */
export function frames(count: number): string {
  return `${n(count)} ${count === 1 ? 'frame' : 'frames'}`
}

/** What the heap panel reads of a frame: the heap's sizes and its window, which an rxm and a CLIF frame both carry. */
export type HeapWindow = Pick<RxmState, 'heap_len' | 'cells' | 'box_len' | 'boxes'>

/** The heap panel's count: `57 cells · 2 boxes`, with no boxes clause while there are none. */
export function heapSummary(s: HeapWindow): string {
  const cells = `${n(s.heap_len)} ${s.heap_len === 1 ? 'cell' : 'cells'}`
  return s.box_len === 0 ? cells : `${cells} · ${n(s.box_len)} ${s.box_len === 1 ? 'box' : 'boxes'}`
}

/** The registers panel at `s`: its rows, then how many arguments and locals the window hides, then the legend. */
export function rxmValues(s: RxmState): ValuesView {
  const rows = registerRows(s)
  const notes: { text: string; legend: boolean }[] = []
  const more = (hidden: number, what: string) => {
    if (hidden > 0) notes.push({ text: `+${n(hidden)} more ${what}`, legend: false })
  }
  const hiddenArgs = s.args_len - s.args.length
  const hiddenLocals = s.locals_len - s.locals.length
  more(hiddenArgs, hiddenArgs === 1 ? 'argument' : 'arguments')
  more(hiddenLocals, hiddenLocals === 1 ? 'local' : 'locals')
  const legend = unwrittenLegend(s, rows)
  if (legend !== null) notes.push({ text: legend, legend: true })
  return {
    rows: rows.map((r) => {
      const says: string[] = []
      if (r.changed) says.push('changed by the last instruction')
      if (r.unwritten) says.push(unwrittenMeaning(s))
      return { ...r, says }
    }),
    notes,
  }
}

/** The call stack panel at `s`, top first. `program` names each frame's function: `calleeOf`. */
export function rxmStack(s: RxmState, program: RxmProgram): StackView {
  const count = frames(s.depth)
  if (s.depth === 0) return { count, frames: [], notes: ['not inside a call'] }
  const hidden = s.depth - s.frames.length
  return {
    count,
    frames: s.frames.map((f) => {
      const words = f.saved.map((w, i) => `r${i} ${wordText(w)}`)
      if (f.saved_len > f.saved.length) words.push(`+${n(f.saved_len - f.saved.length)} more`)
      return { callee: calleeOf(program, f.ret_pc) ?? '?', ret: `→ pc${f.ret_pc}`, saved: words.join(' · ') }
    }),
    notes: hidden > 0 ? [`+${n(hidden)} more`] : [],
  }
}

/** The heap panel at `s`: `heapView` with the registers that name each cell and box. */
export function rxmHeap(s: RxmState): HeapView {
  return heapView(s, (at, tag) => backRefs(s, at, tag))
}

/**
 * The heap panel at `s`: the cells, how many older ones the window hides, then the same for the boxes. `refs` names
 * what holds the cell or box `at`, a word of `tag`, which each machine reads from its own frame.
 */
export function heapView(s: HeapWindow, refs: (at: number, tag: WordTag) => string[]): HeapView {
  const items: HeapView['items'][number][] = []
  const note = (text: string) => items.push({ kind: 'note', text })
  for (const c of s.cells) {
    items.push({
      kind: 'line',
      lead: `#${c.cell}`,
      body: `${wordText(c.head)} → ${wordText(c.tail)}`,
      refs: refs(c.cell, 'List'),
    })
  }
  const olderCells = s.heap_len - s.cells.length
  if (olderCells > 0) note(`+${n(olderCells)} older`)
  for (const b of s.boxes) {
    items.push({
      kind: 'line',
      lead: `box #${b.handle}`,
      body: wordText(b.content),
      refs: refs(b.handle, 'Box'),
    })
  }
  const olderBoxes = s.box_len - s.boxes.length
  if (olderBoxes > 0) note(`+${n(olderBoxes)} older ${olderBoxes === 1 ? 'box' : 'boxes'}`)
  if (items.length === 0) note('empty')
  return { count: heapSummary(s), items }
}
