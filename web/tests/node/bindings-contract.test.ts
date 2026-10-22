import { describe, expect, it } from 'vitest'
import type {
  AsmState,
  AsmStatus,
  LambdaState,
  LambdaStatus,
  RuleView,
  StateView,
  TmScratchStatus,
  TmState,
  TmStatus,
} from '../../src/types'

/**
 * Every place the generated bindings carry a null, pinned against those GENERATED types rather than
 * against a hand-written declaration.
 *
 * WHAT THIS IS FOR. `pnpm run typecheck` runs `build:bindings` and then `tsc --noEmit`, so the
 * annotations below are checked against the file each Rust declaration actually produces. A ts-rs
 * override that dropped a `| null` — the defect the sibling gate in
 * `redextape_test_support::ts_derive_scan` refuses at the derive site — reddens `tsc` here.
 *
 * **`pnpm run test` DOES NOT ENFORCE THEM.**
 * `web/vite.config.ts` sets no `test.typecheck`, so vitest transpiles the annotations away and every
 * assertion below becomes `expect(null).toBeNull()` — true whatever the generated types say. The
 * `expect` calls are here so this reads as a test rather than as a file of unused bindings somebody
 * deletes; `tsc` is what actually holds the pin, via `pnpm run typecheck` locally and the `web` job
 * in CI. Sabotaging a binding and running only `pnpm run test` proves nothing about this file.
 *
 * WHY IT IS NOT ENOUGH TO LEAVE THIS TO THE FIXTURES. Without this file, the whole check would be
 * that a few tests happen to construct objects with a literal `null` in them. None of them exists
 * to check nullability, so a refactor that stopped building fixtures that way would remove the
 * last thing watching this class with nothing firing to say so.
 *
 * WHAT THIS DOES NOT COVER. The list is written by hand, so a nullable field added later is not in it
 * until someone adds it, and nothing here says so — the derive-site rule is what watches an override
 * that would drop a `| null`, and neither watches an `Option` field that never had an override at all.
 *
 * The imports come from the barrel rather than from `../../bindings/` directly, deliberately: the
 * barrel's import is the condition that puts the generated files into the TypeScript program at all,
 * and a test that reached around it would be checking a different statement.
 */
describe('the generated bindings keep the nullability the wire carries', () => {
  it('admits null at every nullable site', () => {
    const lambdaStatusNode: LambdaStatus['node'] = null
    const lambdaStatusRun: LambdaStatus['run'] = null
    const lambdaStateCut: LambdaState['cut'] = null
    const lambdaStateRedexSpan: LambdaState['redex_span'] = null
    const tmStateSourceNode: TmState['source_node'] = null
    const tmStateRule: TmState['rule'] = null
    const tmStatusWidth: TmStatus['width'] = null
    const tmStatusRun: TmStatus['run'] = null
    const tmStatusTotalSteps: TmStatus['total_steps'] = null
    const tmScratchStatusReduction: TmScratchStatus['reduction'] = null
    const stateViewInstr: StateView['instr'] = null
    const ruleViewRead: RuleView['read'][number] = null
    const ruleViewWrite: RuleView['write'][number] = null
    const asmStateNext: AsmState['next'] = null
    const asmStateWrote: AsmState['wrote'] = null
    const asmStateSourceNode: AsmState['source_node'] = null
    const asmStatusRun: AsmStatus['run'] = null
    const asmStatusCap: AsmStatus['cap'] = null
    const asmStatusTotalSteps: AsmStatus['total_steps'] = null

    expect(lambdaStatusNode).toBeNull()
    expect(lambdaStatusRun).toBeNull()
    expect(lambdaStateCut).toBeNull()
    expect(lambdaStateRedexSpan).toBeNull()
    expect(tmStateSourceNode).toBeNull()
    expect(tmStateRule).toBeNull()
    expect(tmStatusWidth).toBeNull()
    expect(tmStatusRun).toBeNull()
    expect(tmStatusTotalSteps).toBeNull()
    expect(tmScratchStatusReduction).toBeNull()
    expect(stateViewInstr).toBeNull()
    expect(ruleViewRead).toBeNull()
    expect(ruleViewWrite).toBeNull()
    expect(asmStateNext).toBeNull()
    expect(asmStateWrote).toBeNull()
    expect(asmStateSourceNode).toBeNull()
    expect(asmStatusRun).toBeNull()
    expect(asmStatusCap).toBeNull()
    expect(asmStatusTotalSteps).toBeNull()
  })
})
