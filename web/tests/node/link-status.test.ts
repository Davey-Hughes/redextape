import { describe, expect, it } from 'vitest'
import { linkStatus } from '../../src/link-status'

describe('linkStatus', () => {
  it('says nothing when nothing is linked', () => {
    expect(linkStatus({ state: 'none' })).toBe('')
  })

  it('names the one absence that is the common case', () => {
    expect(linkStatus({ state: 'linked', tm: false, lambda: 'shown' })).toBe('this construct emits no machine states')
  })

  it('distinguishes the four reasons the lambda pane shows no link', () => {
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'truncated' })).toBe(
      'the λ term is truncated before this construct',
    )
    // `'unmapped'` IS WORDED DIFFERENTLY FROM `'truncated'` ON PURPOSE — see `LambdaLinkState`'s own
    // doc. Reporting a truncation frontier that is not there ("truncated before this construct") when
    // the real cause is that the node was never mapped at all would be checkably false.
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'unmapped' })).toBe(
      'this construct has no recorded position in the λ term',
    )
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'not-step-0' })).toBe(
      'the λ link is only defined at step 0 — restart the λ pane to see it',
    )
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'declined' })).toBe(
      'this program has no λ lowering, so no construct has a λ link',
    )
  })

  it('says nothing extra when both legs resolved', () => {
    expect(linkStatus({ state: 'linked', tm: true, lambda: 'shown' })).toBe('')
  })

  it('reports both absences together rather than picking one', () => {
    expect(linkStatus({ state: 'linked', tm: false, lambda: 'declined' })).toBe(
      'this construct emits no machine states · this program has no λ lowering, so no construct has a λ link',
    )
  })

  it('explains a stale index rather than resolving against it', () => {
    expect(linkStatus({ state: 'stale' })).toBe('linking resumes when this compiles')
  })
})
