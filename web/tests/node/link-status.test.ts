import { describe, expect, it } from 'vitest'
import { type LambdaLinkState, type LinkStatus, linkStatus } from '../../src/link-status'

/**
 * The `linked` arm, from whether the construct emits on TM and on rxm and whether each leg's focus is on it; the CLIF
 * leg's answers are `clif`'s, by default rows marked and the focus elsewhere.
 */
function pinned({
  tm,
  instrs,
  focus,
  rxmFocus,
  clif = { emits: true, here: false },
  ...rest
}: {
  tm: boolean
  instrs: boolean
  lambda: LambdaLinkState
  focus: boolean
  rxmFocus: boolean
  clif?: { emits: boolean; here: boolean }
}): LinkStatus {
  return {
    state: 'linked',
    legs: { rxm: { emits: instrs, here: rxmFocus }, tm: { emits: tm, here: focus }, clif },
    ...rest,
  }
}

describe('linkStatus', () => {
  it('says nothing when nothing is linked', () => {
    expect(linkStatus({ state: 'none' })).toBe('')
  })

  it('names the one absence that is the common case', () => {
    expect(linkStatus(pinned({ tm: false, instrs: true, lambda: 'shown', focus: false, rxmFocus: false }))).toBe(
      'this construct emits no machine states',
    )
  })

  it('distinguishes the reasons the λ view shows no link', () => {
    expect(linkStatus(pinned({ tm: true, instrs: true, lambda: 'none-here', focus: false, rxmFocus: false }))).toBe(
      'this construct has no node in the λ term at this step',
    )
    expect(linkStatus(pinned({ tm: true, instrs: true, lambda: 'too-large', focus: false, rxmFocus: false }))).toBe(
      'the λ term at this step is too large to lay out',
    )
    // `'waiting'` SAYS NOTHING: a tree one round trip away is a moment, not a state to explain.
    expect(linkStatus(pinned({ tm: true, instrs: true, lambda: 'waiting', focus: false, rxmFocus: false }))).toBe('')
    expect(linkStatus(pinned({ tm: true, instrs: true, lambda: 'declined', focus: false, rxmFocus: false }))).toBe(
      'this program has no λ lowering, so no construct has a λ link',
    )
  })

  // `'absent'` SAYS NOTHING ABOUT λ, AS `'shown'` AND `'waiting'` DO, BUT FOR ITS OWN REASON: there is no
  // λ pane on screen to say anything about — see `LambdaLinkState`'s own doc for why that suppresses
  // `'declined'` along with the rest. Checked against both TM answers, so it is seen to drop the λ clause
  // alone: the TM leg's absence still speaks.
  it('says nothing about λ when there is no λ pane to say it about', () => {
    expect(linkStatus(pinned({ tm: true, instrs: true, lambda: 'absent', focus: false, rxmFocus: false }))).toBe('')
    expect(linkStatus(pinned({ tm: false, instrs: true, lambda: 'absent', focus: false, rxmFocus: false }))).toBe(
      'this construct emits no machine states',
    )
  })

  it('says nothing extra when every leg resolved and neither running focus is on the pinned construct', () => {
    expect(linkStatus(pinned({ tm: true, instrs: true, lambda: 'shown', focus: false, rxmFocus: false }))).toBe('')
  })

  it('reports both absences together rather than picking one', () => {
    expect(linkStatus(pinned({ tm: false, instrs: true, lambda: 'declined', focus: false, rxmFocus: false }))).toBe(
      'this construct emits no machine states · this program has no λ lowering, so no construct has a λ link',
    )
  })

  // ONE CLAUSE FOR A CONSTRUCT NEITHER LOWERING BILLS ANYTHING TO — the common case among clicks, since a
  // transparent `let` or a `Lambda` emits no instruction and so no state — and each alone otherwise.
  it('says what the construct emits no instructions of, and no machine states of, in one clause', () => {
    const linked = { lambda: 'shown', focus: false, rxmFocus: false } as const
    expect(linkStatus(pinned({ ...linked, tm: false, instrs: false }))).toBe(
      'this construct emits no instructions or machine states',
    )
    expect(linkStatus(pinned({ ...linked, tm: true, instrs: false }))).toBe('this construct emits no instructions')
    expect(linkStatus(pinned({ ...linked, tm: false, instrs: true }))).toBe('this construct emits no machine states')
  })

  it('reports the rxm run reaching the pin, ahead of the machine and of any absence', () => {
    expect(linkStatus(pinned({ tm: false, instrs: true, lambda: 'shown', focus: true, rxmFocus: true }))).toBe(
      'the rxm run is here right now · the machine is here right now · this construct emits no machine states',
    )
  })

  // AN OPTIMISER'S MERGE LEAVES SOME RXM INSTRUCTIONS NO CLIF ROW, which is expected (CLIF view design §4), so the CLIF
  // leg is named in no absence clause.
  it('names no CLIF rows a construct marks none of', () => {
    const none = { emits: false, here: false }
    expect(
      linkStatus(pinned({ tm: false, instrs: true, lambda: 'shown', focus: false, rxmFocus: false, clif: none })),
    ).toBe('this construct emits no machine states')
    expect(
      linkStatus(pinned({ tm: true, instrs: true, lambda: 'shown', focus: false, rxmFocus: false, clif: none })),
    ).toBe('')
  })

  it('reports the CLIF run reaching the pin after the rxm run and the machine', () => {
    expect(
      linkStatus(
        pinned({
          tm: true,
          instrs: true,
          lambda: 'shown',
          focus: true,
          rxmFocus: true,
          clif: { emits: true, here: true },
        }),
      ),
    ).toBe('the rxm run is here right now · the machine is here right now · the clif run is here right now')
  })

  // PLAN 7 PART 5 SPEC AMENDMENT 11: an rxm instruction `defunc` minted links to nothing, and the line says so,
  // where a click that cleared the pin with no word would read as a click that missed.
  it('says an instruction with no owner has no source construct', () => {
    expect(linkStatus({ state: 'ownerless' })).toBe('this instruction has no source construct')
  })

  it('explains a stale index rather than resolving against it', () => {
    expect(linkStatus({ state: 'stale' })).toBe('linking resumes when this compiles')
  })

  // THE COINCIDENCE OF THE RUNNING FOCUS AND THE PIN. If `focus` were read nowhere, this test, which sets
  // it `true` against an otherwise-silent link, would report '' and fail.
  it('reports the running focus when it coincides with the pin', () => {
    expect(linkStatus(pinned({ tm: true, instrs: true, lambda: 'shown', focus: true, rxmFocus: false }))).toBe(
      'the machine is here right now',
    )
  })

  // ORDER IS PART OF THE CONTRACT: coincidence is live, present-tense news, reported AHEAD of an
  // absence rather than after it. A version that pushed `tm`'s absence first would produce the same
  // TWO PARTS but in the wrong order, and `toBe` (not a set/array comparison) catches that.
  it('reports the focus ahead of an absence, not after it', () => {
    expect(linkStatus(pinned({ tm: false, instrs: true, lambda: 'shown', focus: true, rxmFocus: false }))).toBe(
      'the machine is here right now · this construct emits no machine states',
    )
  })
})
