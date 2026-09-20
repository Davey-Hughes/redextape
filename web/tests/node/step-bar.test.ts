import { describe, expect, it } from 'vitest'
import { barTarget, NO_TARGET } from '../../src/step-bar'

describe('barTarget', () => {
  it('is the focused view when that view can step', () => {
    expect(barTarget('tm-0', ['lambda-0', 'tm-0'], 'lambda-0')).toBe('tm-0')
  })

  // §8: "otherwise the last view that could". A focused SOURCE view is the ordinary way to reach this.
  it('keeps the last view that could step when the focused one cannot', () => {
    expect(barTarget('source', ['lambda-0', 'tm-0'], 'tm-0')).toBe('tm-0')
  })

  // §8: "Closing the target retargets to `focused` if it can step, else the first λ or TM leaf."
  it('falls to the first view that can step when the last one has closed', () => {
    expect(barTarget('source', ['lambda-0', 'tm-0'], 'tm-9')).toBe('lambda-0')
  })

  it('has no target when no view can step', () => {
    expect(barTarget('source', [], 'lambda-0')).toBeNull()
  })

  // **DISABLED WITH ITS REASON, NOT REMOVED** — umbrella §4 rule 4, and the reason is on the readout
  // where a step count would be.
  it('says why it is disabled when there is no target', () => {
    expect(NO_TARGET.stepText).toBe('no view can step')
    expect(NO_TARGET.canBack).toBe(false)
    expect(NO_TARGET.canForward).toBe(false)
    expect(NO_TARGET.canPlay).toBe(false)
    expect(NO_TARGET.canRestart).toBe(false)
    expect(NO_TARGET.playing).toBe(false)
    expect(NO_TARGET.continueLabel).toBeNull()
  })
})
