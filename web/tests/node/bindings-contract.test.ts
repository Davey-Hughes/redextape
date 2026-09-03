import { describe, expect, it } from 'vitest'
import type { LambdaState, LambdaStatus, RuleView, TmState, TmStatus } from '../../src/types'

/**
 * The eleven places the wire carries a null, pinned against the GENERATED types rather than against
 * a hand-written declaration.
 *
 * WHAT THIS IS FOR. `pnpm run typecheck` runs `build:bindings` and then `tsc --noEmit`, so the
 * annotations below are checked against the file each Rust declaration actually produces. A ts-rs
 * override that dropped a `| null` — the defect the sibling gate in
 * `redextape_test_support::ts_derive_scan` refuses at the derive site — reddens `tsc` here.
 *
 * **`pnpm run test` DOES NOT ENFORCE THEM, AND AN EARLIER VERSION OF THIS COMMENT SAID IT DID.**
 * `web/vite.config.ts` sets no `test.typecheck`, so vitest transpiles the annotations away and every
 * assertion below becomes `expect(null).toBeNull()` — true whatever the generated types say. The
 * `expect` calls are here so this reads as a test rather than as a file of unused bindings somebody
 * deletes; `tsc` is what actually holds the pin, via `pnpm run typecheck` locally and the `web` job
 * in CI. Sabotaging a binding and running only `pnpm run test` proves nothing about this file.
 *
 * WHY IT IS NOT ENOUGH TO LEAVE THIS TO THE FIXTURES. Before this file existed, the whole check was
 * that a few tests happened to construct objects with a literal `null` in them. None of them existed
 * to check nullability, so a refactor that stopped building fixtures that way would have removed the
 * last thing watching this class with nothing firing to say so.
 *
 * WHAT THIS DOES NOT COVER. The list is written by hand. A twelfth nullable field added to a
 * generated type later will not be in it, and nothing here will say so — the derive-site rule is
 * what watches the override that would cause it, and neither watches an `Option` field that never
 * had an override at all.
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
    const ruleViewRead: RuleView['read'][number] = null
    const ruleViewWrite: RuleView['write'][number] = null

    expect(lambdaStatusNode).toBeNull()
    expect(lambdaStatusRun).toBeNull()
    expect(lambdaStateCut).toBeNull()
    expect(lambdaStateRedexSpan).toBeNull()
    expect(tmStateSourceNode).toBeNull()
    expect(tmStateRule).toBeNull()
    expect(tmStatusWidth).toBeNull()
    expect(tmStatusRun).toBeNull()
    expect(tmStatusTotalSteps).toBeNull()
    expect(ruleViewRead).toBeNull()
    expect(ruleViewWrite).toBeNull()
  })
})
