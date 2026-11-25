import type { TmState } from './types'

export type TapeRow = {
  label: string
  cells: string[]
  /** The head's index INTO `cells`. May fall outside `cells` — see `headInWindow`. */
  headIndex: number
  headInWindow: boolean
  /** The head's cell on the whole tape — `heads[i]`, a materialized-tape coordinate. */
  head: number
  /** Whether `label` is the tape's own name, or the `tape i` stand-in for a tape the header did not name. */
  named: boolean
}

/**
 * A `TmState`'s windows as labelled rows with the head located in each.
 *
 * `headIndex = heads[i] - window_start[i]` IS THE WHOLE JOB, and it is here rather than inline in
 * the pane so it can be tested without a DOM. Both quantities are materialized-tape coordinates
 * (`viewmodel.rs`'s `TmState` struct doc); neither is window-relative, and treating either as if it
 * were puts the marker on the wrong cell with nothing to notice it.
 *
 * AN OUT-OF-WINDOW HEAD IS REPORTED, NOT CLAMPED. `Tape::window` centres on the head so it should
 * not happen; clamping would convert a coordinate bug into a marker that is merely in the wrong
 * place, which is the failure mode this codebase's conventions treat as worse than a visible gap.
 */
export function tapeRows(state: TmState, names: string[]): TapeRow[] {
  return state.window.map((tape, i) => {
    // A TAPE'S WINDOW ARRIVES AS ONE STRING, A CELL A CHARACTER (`viewmodel.rs`'s `TmState.window`), AND IS TAKEN APART
    // BY CHARACTER, NOT BY UTF-16 UNIT: a symbol outside the basic plane is one cell and two units. Once a frame drawn,
    // not once a frame recorded, which is why the string is what crosses from the worker.
    const cells = Array.from(tape)
    const headIndex = (state.heads[i] ?? 0) - (state.window_start[i] ?? 0)
    return {
      label: names[i] ?? `tape ${i}`,
      cells,
      headIndex,
      headInWindow: headIndex >= 0 && headIndex < cells.length,
      head: state.heads[i] ?? 0,
      named: names[i] !== undefined,
    }
  })
}

/**
 * The run's result on the TM: REG's field 0 as indices into tape 0's window cells, `to` exclusive, from the cell after
 * the `#` that opens the tape to the next `#` or the window's end, so a field wider than the window is the part of it
 * on screen. Indices into `tapeRows`' cells, so taken apart by character as those are.
 *
 * **`null` UNLESS REG'S WINDOW STARTS AT THE TAPE'S CELL 0 AND THAT CELL IS THE `#`.** The encoding's gadgets enter
 * and leave with REG's head on that leading `#`, its home, so a run that halts there has REG's window from cell 0;
 * from anywhere else the first `#` in the window would open some later field.
 */
export function resultField(state: TmState): { readonly from: number; readonly to: number } | null {
  if (state.window_start[0] !== 0) return null
  const cells = Array.from(state.window[0] ?? '')
  if (cells[0] !== '#') return null
  const end = cells.indexOf('#', 1)
  return { from: 1, to: end === -1 ? cells.length : end }
}

/**
 * What a tape row says to a screen reader, where a sighted reader sees a bordered cell — accessibility item 4
 * (spec §9.3): `tape reg, head at cell 12, reading 1`. The blank symbol is said as `blank`, since `_` is a
 * glyph and not a word.
 *
 * **SAID ON DEMAND, NOT ANNOUNCED.** It is the row's label, read when a reader moves to the row; no live region
 * repeats it per step, since at 5,000 steps a second that would be noise (spec §9.3).
 *
 * A HEAD OUTSIDE THE WINDOW IS SAID, NOT GUESSED AT, for `tapeRows`' reason: the pane draws no marker for it.
 */
export function tapeLabel(row: TapeRow): string {
  const read = row.headInWindow ? row.cells[row.headIndex] : undefined
  const reading = read === undefined ? 'outside the window' : `reading ${read === '_' ? 'blank' : read}`
  return `${row.named ? `tape ${row.label}` : row.label}, head at cell ${row.head}, ${reading}`
}
