import type { RxmCompiled } from './protocol'
import type { RxmPane } from './rxm-pane'

/**
 * Tell an rxm view what its session keeps: the listing — `tm-seed.ts`'s `seedTm` for the rxm view, and for its reason.
 * A view comes to show a session after the replies that told the others: by being built, by a pick moving it, or by
 * being shown after a compile it missed. Every such route tells it here.
 */
export function seedRxm(pane: RxmPane, compiled: RxmCompiled | null): void {
  pane.setProgram(compiled?.program ?? null)
}
