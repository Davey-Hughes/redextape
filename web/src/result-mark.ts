import type { TreeFor } from './lambda-trees'
import type { LinkedLeg } from './linked-legs'
import type { Leg, LegFrame, RecordEnd } from './protocol'
import type { ProgramResult } from './readout'

/**
 * WHEN A VIEW OF THE PROGRAM MARKS ITS RESULT (the return-value highlight design, *When the mark shows*): at the last
 * step of a run that finished with a value, and at no other. `draw.ts` asks it again at every draw, so a result that
 * lands after the frames marks the view with that draw, and a step back takes the mark away.
 */

/** What the decision reads of a leg's live state: `LegState`'s generation, end and play head. */
export type MarkedLeg = {
  readonly gen: number
  readonly done: RecordEnd | null
  readonly hist: { readonly head: number; readonly length: number }
}

/**
 * Whether a view of `leg` standing on `state`'s current frame marks the program's result `r`. `ended` is what the
 * frame on screen says: `RUN_ENDED`'s test, or for λ `lambdaEnded`'s.
 *
 * - **`r.gen` IS THE GENERATION OF THE FRAMES**, or the value is an earlier compile's, drawn over a new program's run.
 * - **THE RECORDING `ended`**: a cap, a budget or a full history stops it where the run has not finished.
 * - **THE NEWEST FRAME**: the last step is where the value is; one before it, the run has not produced it yet.
 * - **AND THE FRAME PROVES THE END.** `endOf` maps a cursor still `Running` to `ended`, so the recording's end alone
 *   could mark a frame mid-run.
 * - **A `Value`, AND NOT UNIT**: a fault, an undecodable or unfinished run has no value to mark; `()` marks nothing.
 */
export function resultMarked(r: ProgramResult | null, leg: Leg, state: MarkedLeg, ended: boolean): boolean {
  if (r === null || r.kind !== 'result' || r.gen !== state.gen) return false
  if (state.done !== 'ended') return false
  if (state.hist.length === 0 || state.hist.head !== state.hist.length - 1) return false
  if (!ended) return false
  const value = r.legs[leg].value
  return value !== null && typeof value === 'object' && 'Value' in value && value.Value.text !== '()'
}

/**
 * Whether a linked leg's frame shows its run's end: a TM with no rule to fire, an rxm run with no instruction next, and
 * a clif run that returned, since a fault or a trap also leaves it no instruction.
 */
export const RUN_ENDED: { readonly [K in LinkedLeg]: (frame: LegFrame[K]) => boolean } = {
  rxm: (f) => f.next === null,
  tm: (f) => f.rule === null,
  clif: (f) => f.next === null && f.returned !== null,
}

/** The encoding whose fields read least significant digit first, the leftmost cell `2⁰`: the TM's `little-endian`. */
export const BINARY = 'binary'

/** Whether the λ view's tree is at a normal form: the tree of the step shown, since a stale one is another step's. */
export function lambdaEnded(t: TreeFor): boolean {
  return t.kind === 'tree' && t.tree.nextRedex === null
}
