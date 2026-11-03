import type { RxmPane } from './rxm-pane'
import type { RxmCompiled, RxmScratchReading } from './sessions'

/**
 * Tell an rxm view what its session keeps: the listing, whether it can be copied, and a copy's value — `tm-seed.ts`'s
 * `seedTm` for the rxm view, and for its reason. A view comes to show a session after the replies that told the
 * others: by being built, by a pick, by a cool or a retire moving it, or by being shown after a compile it missed.
 * Every such route tells it here, so none can leave one of the three facts out.
 */
export function seedRxm(pane: RxmPane, compiled: RxmCompiled | null, reading: RxmScratchReading | null): void {
  pane.setProgram(compiled?.program ?? null)
  pane.setForkAvailable(compiled?.rxmText ?? null, compiled?.program.listing.length ?? 0)
  pane.setScratch(reading)
}
