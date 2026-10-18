import { History } from '../../src/history'
import type { LegState } from '../../src/sessions'

/**
 * A leg with an empty history of budget `budgetBytes`, nothing recorded and not playing, whose status says `available`.
 * It is kept out of `session-fixtures.ts` because it needs `History` at run time.
 */
export function legState<T>(available: boolean, budgetBytes: number): LegState<T> {
  return { hist: new History<T>(budgetBytes), status: { available, reason: '' }, done: null, playing: false }
}
