import type { TmState } from './types'

export type TapeRow = {
  label: string
  cells: string[]
  /** The head's index INTO `cells`. May fall outside `cells` — see `headInWindow`. */
  headIndex: number
  headInWindow: boolean
}

/**
 * A `TmState`'s windows as labelled rows with the head located in each.
 *
 * `headIndex = heads[i] - window_start[i]` IS THE WHOLE JOB, and it is here rather than inline in
 * the pane so it can be tested without a DOM. Both quantities are materialized-tape coordinates
 * (`viewmodel.rs:108-115`); neither is window-relative, and treating either as if it were puts the
 * marker on the wrong cell with nothing to notice it.
 *
 * AN OUT-OF-WINDOW HEAD IS REPORTED, NOT CLAMPED. `Tape::window` centres on the head so it should
 * not happen; clamping would convert a coordinate bug into a marker that is merely in the wrong
 * place, which is the failure mode this codebase's conventions treat as worse than a visible gap.
 */
export function tapeRows(state: TmState, names: string[]): TapeRow[] {
  return state.window.map((cells, i) => {
    const headIndex = (state.heads[i] ?? 0) - (state.window_start[i] ?? 0)
    return {
      label: names[i] ?? `tape ${i}`,
      cells,
      headIndex,
      headInWindow: headIndex >= 0 && headIndex < cells.length,
    }
  })
}
