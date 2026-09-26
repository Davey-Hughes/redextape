import { ruleCount } from './protocol'
import type { TmCompiled, TmScratchReading } from './sessions'
import type { TmPane } from './tm-pane'

/**
 * Tell a TM view everything its session holds — the machine, whether it may be forked, a copy's status and
 * value reading — and that it holds nothing where it does not.
 *
 * **ONE FUNCTION FOR EVERY MOMENT A VIEW NEEDS IT**: created or rebound (`pane-host.ts`'s `seedTmPane`, whose
 * doc has why each fact is pushed, `null`s included), and shown after compiles it missed while it was off the
 * page (`draw.ts`, Plan 7 part 4a). Two copies of these four calls would be two chances for one to forget a fact.
 */
export function seedTm(pane: TmPane, compiled: TmCompiled | null, reading: TmScratchReading | null): void {
  pane.setProgram(compiled?.program ?? null, compiled?.tapeNames ?? [])
  pane.setForkAvailable(compiled?.tmText ?? null, compiled === null ? 0 : ruleCount(compiled.program))
  pane.setScratchStatus(reading?.status ?? null)
  pane.setScratchValue(reading?.value ?? null)
}
