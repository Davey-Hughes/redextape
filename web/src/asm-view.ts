import { n } from './format'
import type { AsmProgram, AsmState, AsmWord, WordTag } from './types'

/**
 * The asm view as data (Plan 7 part 5 spec §6): the listing's rows, how a word reads, and what the registers, call
 * stack and heap panels say. Pure, so the DOM that draws them (`asm-pane.ts`) holds nothing a node test cannot
 * reach — `program-level.ts`'s arrangement for the TM view's state diagram.
 */

/** One row of the listing: a label, above the instruction it names, or an instruction. Every row is one grid row. */
export type ListingRow =
  | { readonly kind: 'label'; readonly name: string }
  | { readonly kind: 'instr'; readonly pc: number }

/**
 * The listing's rows. **AN INSTRUCTION'S LABELS COME FIRST, IN `labels` ORDER, AS `print_asm` PRINTS THEM** (spec
 * §6.2); a label one past the last instruction is printed after it, and so drawn after it — `program-level.ts`'s
 * `programRows` places the TM view's labels by the same rule.
 */
export function listingRows(p: AsmProgram): ListingRow[] {
  const at = new Map<number, string[]>()
  for (const [name, index] of p.labels) at.set(index, [...(at.get(index) ?? []), name])
  const rows: ListingRow[] = []
  for (let pc = 0; pc <= p.listing.length; pc += 1) {
    for (const name of at.get(pc) ?? []) rows.push({ kind: 'label', name })
    if (pc < p.listing.length) rows.push({ kind: 'instr', pc })
  }
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
export function wordText(w: AsmWord): string {
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
export function calleeOf(p: AsmProgram, retPc: number): string | null {
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
 * **ONLY A LOCAL HAS A WRITTEN BIT.** `call` clears them all and `ret` restores the caller's (5a's written bits), so an
 * unwritten local inside a call still holds its caller's word — the view's "left over from caller". An argument is
 * written by the caller for the callee, and `rr` by whichever instruction last wrote it; neither is ever left over.
 */
export function registerRows(s: AsmState): RegisterRow[] {
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
export function unwrittenMeaning(s: AsmState): string {
  return s.depth > 0 ? 'left over from caller' : 'not written yet'
}

/** The legend under the registers, `· left over from caller`, or `null` when no register is unwritten. */
export function unwrittenLegend(s: AsmState, rows: readonly RegisterRow[]): string | null {
  return rows.some((r) => r.unwritten) ? `· ${unwrittenMeaning(s)}` : null
}

/**
 * The registers a heap cell's or a box's back-reference names (spec §6.5): every register of `tag` whose word is the
 * cell's or box's own number. **EXACT FOR A COMPILED PROGRAM**, whose every list word was made by `cons` or `nil` and
 * copied since (5a's tag rules), so a `#57` in a *list* register is cell 57. A register past the frame's window is not
 * here to name.
 */
export function backRefs(s: AsmState, at: number, tag: WordTag): string[] {
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

/** The heap panel's count: `57 cells · 2 boxes`, with no boxes clause while there are none. */
export function heapSummary(s: AsmState): string {
  const cells = `${n(s.heap_len)} ${s.heap_len === 1 ? 'cell' : 'cells'}`
  return s.box_len === 0 ? cells : `${cells} · ${n(s.box_len)} ${s.box_len === 1 ? 'box' : 'boxes'}`
}
