import { describe, expect, it } from 'vitest'
import { linkStatus } from '../../src/link-status'

describe('linkStatus', () => {
  it('says nothing when nothing is linked', () => {
    expect(linkStatus({ state: 'none' })).toBe('')
  })

  it('names the one absence that is the common case', () => {
    expect(linkStatus({ state: 'linked', tm: false, lambda: 'shown', focus: false })).toBe(
      'this construct emits no machine states',
    )
  })

  it('distinguishes the four reasons the lambda pane shows no link', () => {
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'truncated', focus: false })).toBe(
      'the λ term is truncated before this construct',
    )
    // `'unmapped'` IS WORDED DIFFERENTLY FROM `'truncated'` ON PURPOSE — see `LambdaLinkState`'s own
    // doc. Reporting a truncation frontier that is not there ("truncated before this construct") when
    // the real cause is that the node was never mapped at all would be checkably false.
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'unmapped', focus: false })).toBe(
      'this construct has no recorded position in the λ term',
    )
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'not-step-0', focus: false })).toBe(
      'the λ link is only defined at step 0 — restart the λ pane to see it',
    )
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'declined', focus: false })).toBe(
      'this program has no λ lowering, so no construct has a λ link',
    )
  })

  it('says nothing extra when both legs resolved and the focus is elsewhere', () => {
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'shown', focus: false })).toBe('')
  })

  it('reports both absences together rather than picking one', () => {
    expect(linkStatus({ state: 'linked', tm: false, lambda: 'declined', focus: false })).toBe(
      'this construct emits no machine states · this program has no λ lowering, so no construct has a λ link',
    )
  })

  it('explains a stale index rather than resolving against it', () => {
    expect(linkStatus({ state: 'stale' })).toBe('linking resumes when this compiles')
  })

  // THE COINCIDENCE THIS SLICE EXISTS TO SURFACE. If `focus` regressed to being read nowhere, this
  // test — the only one that sets it `true` against an otherwise-silent link — would still report ''
  // and fail.
  it('reports the running focus when it coincides with the pin', () => {
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'shown', focus: true })).toBe(
      'the machine is here right now',
    )
  })

  // ORDER IS PART OF THE CONTRACT: coincidence is live, present-tense news, reported AHEAD of an
  // absence rather than after it. A version that pushed `tm`'s absence first would produce the same
  // TWO PARTS but in the wrong order, and `toBe` (not a set/array comparison) catches that.
  it('reports the focus ahead of an absence, not after it', () => {
    expect(linkStatus({ state: 'linked', tm: false, lambda: 'shown', focus: true })).toBe(
      'the machine is here right now · this construct emits no machine states',
    )
  })
})
