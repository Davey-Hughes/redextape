import { describe, expect, it } from 'vitest'
import init, { compile, tapeNames } from '../../../pkg/redextape_wasm.js'
import type { TmProgram, TmState } from '../../src/types'

/**
 * EVERY SHAPE IN `types.ts` IS MEASURED HERE, NOT DESIGNED. `pkg`'s generated declarations type each
 * method's return as `any`, so the only thing standing between a wrong TypeScript type and a runtime
 * surprise is a test that reads the value out of a real browser.
 */
type Session = {
  tmProgram(): TmProgram
  tmState(radius: number): TmState
  stepTm(): boolean
  free(): void
}

describe('wire shapes', () => {
  it('tapeNames is five strings in tape order', async () => {
    await init()
    const names = tapeNames() as string[]
    expect(names).toEqual(['REG', 'WORK', 'STACK', 'HEAP', 'BOX'])
  })

  it('tmProgram and tmState arrive in the shapes types.ts declares', async () => {
    await init()
    const { session } = compile('let x = 40; x + 2', 'unary') as { session: Session | null }
    expect(session).not.toBeNull()
    if (!session) return

    const program = session.tmProgram()
    expect(program.tapes).toBe(5)
    expect(program.width).toBe(64)
    expect(program.states.length).toBe(123)
    expect(typeof program.states[0]?.name).toBe('string')
    expect(typeof program.states[0]?.accept).toBe('boolean')
    expect(Array.isArray(program.alphabet)).toBe(true)
    expect(program.alphabet.every((a) => typeof a === 'string')).toBe(true)
    expect(typeof program.start).toBe('number')

    // A rule's `read`/`write` are `Option<Symbol>` per tape — wildcards arrive as null, NOT undefined,
    // because `to_value` sets `serialize_missing_as_null`.
    const ruled = program.states.find((s) => s.rules.length > 0)
    expect(ruled).toBeDefined()
    const rule = ruled?.rules[0]
    expect(rule?.read.length).toBe(5)
    expect(rule?.write.length).toBe(5)
    expect(rule?.moves.length).toBe(5)
    expect(rule?.read.every((r) => r === null || typeof r === 'string')).toBe(true)
    expect(rule?.write.every((w) => w === null || typeof w === 'string')).toBe(true)
    // The comment above claims a wildcard arrives as `null`. Assert one actually does, or the
    // null-or-string checks would pass on a rule that happens to touch all five tapes.
    expect(rule?.read.some((r) => r === null) || rule?.write.some((w) => w === null)).toBe(true)
    expect(rule?.moves.every((m) => m === 'L' || m === 'R' || m === 'S')).toBe(true)
    expect(typeof rule?.next).toBe('number')

    // The cursor starts at step 0 — `compile` ran the TM leg, but the CURSOR is untouched.
    const first = session.tmState(40)
    expect(typeof first.state).toBe('number')
    expect(first.step).toBe(0)
    expect(first.window.length).toBe(5)
    expect(first.heads.length).toBe(5)
    expect(first.heads.every((h) => typeof h === 'number')).toBe(true)
    expect(first.window_start.length).toBe(5)
    expect(first.window_start.every((w) => typeof w === 'number')).toBe(true)
    // snake_case survives: serde does not rename.
    expect('window_start' in first).toBe(true)
    expect('source_node' in first).toBe(true)
    expect(first.source_node === null || typeof first.source_node === 'number').toBe(true)
    // `rule` INDEXES `states[state].rules`, and a bare `typeof === 'number'` would pass on an index
    // that points nowhere. Resolve it.
    expect('rule' in first).toBe(true)
    expect(first.rule === null || typeof first.rule === 'number').toBe(true)
    if (first.rule !== null) {
      const rules = program.states[first.state]?.rules ?? []
      expect(first.rule).toBeLessThan(rules.length)
      expect(rules[first.rule]).toBeDefined()
    }

    session.stepTm()
    const second = session.tmState(40)
    expect(second.step).toBe(1)
    // The same contract Task 1 pins in Rust, re-checked across the boundary: the rule named BEFORE a
    // step is the transition that step takes. A serializer that dropped or shifted the field would
    // satisfy every type check above and fail here.
    const beforeStep = session.tmState(40)
    if (beforeStep.rule !== null) {
      // SOUND ONLY BECAUSE THIS RUN NEVER APPROACHES `TM_DEFAULT_CAPS`. `viewmodel.rs`'s doc on `rule`
      // says plainly that `Some` does not promise the cursor will step — the step/cell caps are checked
      // before the rule match, so at a spent cap this field can name a transition that never fires. `let
      // x = 40; x + 2` halts in a couple thousand δ-steps, far short of the default caps, so `stepTm()`
      // below always takes the named rule in practice. A fixture that grew toward the caps, or caps
      // tightened below its step count, could make this branch's assumption false without `rule` itself
      // being wrong.
      const expected = program.states[beforeStep.state]?.rules[beforeStep.rule]?.next
      session.stepTm()
      expect(session.tmState(40).state).toBe(expected)
    }
    // A cell is a one-character string — `Symbol` is `char` in Rust.
    for (const cell of second.window[0] ?? []) {
      expect(typeof cell).toBe('string')
      expect(cell.length).toBe(1)
    }

    session.free()
  })
})
