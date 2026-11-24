import type { TmCompiled } from './protocol'
import type { TmPane } from './tm-pane'

/**
 * Tell a TM view what its session keeps: the machine and its tapes' names, or that it has none. A view comes to show a
 * session after the replies that told the others: by being built, by a pick moving it, or by being shown after
 * a compile it missed. Every such route, and `replies.ts`'s tells, tell it here, so that an argument
 * `setProgram` comes to take reaches a view by every route.
 */
export function seedTm(pane: TmPane, compiled: TmCompiled | null): void {
  pane.setProgram(compiled?.program ?? null, compiled?.tapeNames ?? [])
}
