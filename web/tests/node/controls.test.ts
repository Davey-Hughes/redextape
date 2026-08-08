import { describe, expect, it } from 'vitest'
import { canRecordFurther, controlState, type LegView } from '../../src/controls'

const view = (over: Partial<LegView> = {}): LegView => ({
  available: true,
  reason: '',
  head: 0,
  length: 1,
  oldestStep: 0,
  currentStep: 0,
  newestStep: 0,
  evicted: false,
  done: null,
  ...over,
})

describe('controlState', () => {
  it('disables everything for a declined leg and shows the reason', () => {
    const c = controlState(view({ available: false, reason: 'the λ backend does not support unbound `n`', length: 0 }))
    expect(c.canBack).toBe(false)
    expect(c.canForward).toBe(false)
    expect(c.canPlay).toBe(false)
    expect(c.continueLabel).toBeNull()
    expect(c.stepText).toBe('the λ backend does not support unbound `n`')
  })

  it('offers back only once there is somewhere to go back to', () => {
    expect(controlState(view()).canBack).toBe(false)
    expect(controlState(view({ length: 3, head: 1 })).canBack).toBe(true)
    // {length:3, head:2} is where the two formulas disagree: `head > 0` is true, `head < length-1`
    // is false. Without it, canBack and canForward could be swapped and no test would notice.
    expect(controlState(view({ length: 3, head: 2 })).canBack).toBe(true)
  })

  it('offers forward while frames remain ahead of the head', () => {
    expect(controlState(view({ length: 3, head: 1 })).canForward).toBe(true)
    expect(controlState(view({ length: 3, head: 2 })).canForward).toBe(false)
  })

  it('keeps forward live at the frontier when there is more to record', () => {
    expect(controlState(view({ length: 3, head: 2, done: 'capped' })).canForward).toBe(true)
    expect(controlState(view({ length: 3, head: 2, done: 'budget' })).canForward).toBe(true)
    expect(controlState(view({ length: 3, head: 2, done: 'ended' })).canForward).toBe(false)
    expect(controlState(view({ length: 3, head: 2, done: 'depth-refused' })).canForward).toBe(false)
    expect(controlState(view({ available: false, length: 0, head: 0, done: 'budget' })).canForward).toBe(false)
  })

  // `session.rs:415` names this trap one layer in: exhausting a BUDGET leaves the run Running, and
  // only the cursor's own cap yields Capped. Three stop reasons, three different sentences.
  it('words a spent recording budget as free to continue', () => {
    const c = controlState(view({ done: 'budget', length: 500, head: 499, newestStep: 499 }))
    expect(c.continueLabel).toBe('keep recording')
  })

  it('words a spent cursor cap as a cap raise', () => {
    const c = controlState(view({ done: 'capped', length: 500, head: 499, newestStep: 499 }))
    expect(c.continueLabel).toBe('continue — raise the step cap')
  })

  // THE TRAP. `LambdaCursor::raise_cap` refuses to clear `depth_capped` (trace.rs:98,
  // session.rs:76-77), so raising the cap provably cannot help. An affordance here would be a lie
  // the UI tells on the backend's behalf — so there is no affordance at all, not a disabled one.
  it('offers NO continue affordance for a depth refusal', () => {
    const c = controlState(view({ done: 'depth-refused', length: 9, head: 8, newestStep: 8 }))
    expect(c.continueLabel).toBeNull()
    expect(c.stepText).toContain('deeper than')
  })

  it('offers nothing to continue once the run ended', () => {
    const c = controlState(view({ done: 'ended', length: 8, head: 7, newestStep: 7 }))
    expect(c.continueLabel).toBeNull()
  })

  it('reads step N of M while recording is still in flight', () => {
    expect(controlState(view({ length: 5, head: 2, currentStep: 2, newestStep: 4 })).stepText).toBe('step 2 of 4…')
  })

  it('drops the ellipsis once recording finished', () => {
    expect(controlState(view({ done: 'ended', length: 5, head: 2, currentStep: 2, newestStep: 4 })).stepText).toBe(
      'step 2 of 4',
    )
  })

  // Scrubbing past the eviction point must SAY where history begins. The alternatives are lying
  // about where you are, or silently re-deriving at a cost nobody asked for.
  it('names the oldest retained step once frames have been evicted', () => {
    const c = controlState(
      view({ evicted: true, length: 100, head: 7, oldestStep: 412, currentStep: 419, newestStep: 511 }),
    )
    expect(c.canBack).toBe(true)
    expect(c.stepText).toContain('oldest kept: step 412')
    expect(c.stepText).toContain('step 419 of 511')
  })

  it('allows play whenever more than one frame exists', () => {
    expect(controlState(view({ length: 1 })).canPlay).toBe(false)
    expect(controlState(view({ length: 2 })).canPlay).toBe(true)
  })

  it('allows restart whenever any frame exists', () => {
    expect(controlState(view({ length: 0 })).canRestart).toBe(false)
    expect(controlState(view({ length: 1 })).canRestart).toBe(true)
  })
})

// THE ONE PLACE THIS IS DECIDED — see `canRecordFurther`'s doc comment. Both `controlState` (via
// `continueLabel`) and `main.ts`'s `▶`-at-frontier path call this same function now; a second copy
// of the list would be how one of the two ends up offering `depth-refused` a continue anyway.
describe('canRecordFurther', () => {
  it('is true only for capped and budget, false for ended, depth-refused, and null', () => {
    expect(canRecordFurther('capped')).toBe(true)
    expect(canRecordFurther('budget')).toBe(true)
    expect(canRecordFurther('ended')).toBe(false)
    expect(canRecordFurther('depth-refused')).toBe(false)
    expect(canRecordFurther(null)).toBe(false)
  })
})
