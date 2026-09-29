import { describe, expect, it } from 'vitest'
import { linkStatus } from '../../src/link-status'

describe('linkStatus', () => {
  it('says nothing when nothing is linked', () => {
    expect(linkStatus({ state: 'none' })).toBe('')
  })

  it('names the one absence that is the common case', () => {
    expect(
      linkStatus({ state: 'linked', tm: false, instrs: true, lambda: 'shown', focus: false, asmFocus: false }),
    ).toBe('this construct emits no machine states')
  })

  it('distinguishes the reasons the λ view shows no link', () => {
    expect(
      linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'none-here', focus: false, asmFocus: false }),
    ).toBe('this construct has no node in the λ term at this step')
    expect(
      linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'too-large', focus: false, asmFocus: false }),
    ).toBe('the λ term at this step is too large to lay out')
    // `'waiting'` SAYS NOTHING: a tree one round trip away is a moment, not a state to explain.
    expect(
      linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'waiting', focus: false, asmFocus: false }),
    ).toBe('')
    expect(
      linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'declined', focus: false, asmFocus: false }),
    ).toBe('this program has no λ lowering, so no construct has a λ link')
  })

  // `'absent'` SAYS NOTHING ABOUT λ, AS `'shown'` AND `'waiting'` DO, BUT FOR ITS OWN REASON: there is no
  // λ pane on screen to say anything about — see `LambdaLinkState`'s own doc for why that suppresses
  // `'declined'` along with the rest. Checked against both TM answers, so it is seen to drop the λ clause
  // alone: the TM leg's absence still speaks.
  it('says nothing about λ when there is no λ pane to say it about', () => {
    expect(
      linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'absent', focus: false, asmFocus: false }),
    ).toBe('')
    expect(
      linkStatus({ state: 'linked', tm: false, instrs: true, lambda: 'absent', focus: false, asmFocus: false }),
    ).toBe('this construct emits no machine states')
  })

  it('says nothing extra when both legs resolved and the focus is elsewhere', () => {
    expect(
      linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'shown', focus: false, asmFocus: false }),
    ).toBe('')
  })

  it('reports both absences together rather than picking one', () => {
    expect(
      linkStatus({ state: 'linked', tm: false, instrs: true, lambda: 'declined', focus: false, asmFocus: false }),
    ).toBe('this construct emits no machine states · this program has no λ lowering, so no construct has a λ link')
  })

  // ONE CLAUSE FOR A CONSTRUCT NEITHER LOWERING BILLS ANYTHING TO — the common case among clicks, since a
  // transparent `let` or a `Lambda` emits no instruction and so no state — and each alone otherwise.
  it('says what the construct emits no instructions of, and no machine states of, in one clause', () => {
    const linked = { state: 'linked', lambda: 'shown', focus: false, asmFocus: false } as const
    expect(linkStatus({ ...linked, tm: false, instrs: false })).toBe(
      'this construct emits no instructions or machine states',
    )
    expect(linkStatus({ ...linked, tm: true, instrs: false })).toBe('this construct emits no instructions')
    expect(linkStatus({ ...linked, tm: false, instrs: true })).toBe('this construct emits no machine states')
  })

  it('reports the asm run reaching the pin, ahead of the machine and of any absence', () => {
    expect(linkStatus({ state: 'linked', tm: false, instrs: true, lambda: 'shown', focus: true, asmFocus: true })).toBe(
      'the asm run is here right now · the machine is here right now · this construct emits no machine states',
    )
  })

  // AMENDMENT 11: an asm instruction `defunc` minted links to nothing, and the line says so, where a click that
  // cleared the pin with no word would read as a click that missed.
  it('says an instruction with no owner has no source construct', () => {
    expect(linkStatus({ state: 'ownerless' })).toBe('this instruction has no source construct')
  })

  it('explains a stale index rather than resolving against it', () => {
    expect(linkStatus({ state: 'stale' })).toBe('linking resumes when this compiles')
  })

  // THE COINCIDENCE THIS SLICE EXISTS TO SURFACE. If `focus` regressed to being read nowhere, this
  // test — the only one that sets it `true` against an otherwise-silent link — would still report ''
  // and fail.
  it('reports the running focus when it coincides with the pin', () => {
    expect(linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'shown', focus: true, asmFocus: false })).toBe(
      'the machine is here right now',
    )
  })

  // ORDER IS PART OF THE CONTRACT: coincidence is live, present-tense news, reported AHEAD of an
  // absence rather than after it. A version that pushed `tm`'s absence first would produce the same
  // TWO PARTS but in the wrong order, and `toBe` (not a set/array comparison) catches that.
  it('reports the focus ahead of an absence, not after it', () => {
    expect(
      linkStatus({ state: 'linked', tm: false, instrs: true, lambda: 'shown', focus: true, asmFocus: false }),
    ).toBe('the machine is here right now · this construct emits no machine states')
  })
})

/** A leg's entry in `detached`: how many views it has, and the title of each one showing a copy. */
const views = (count: number, ...copies: string[]) => ({ views: count, copies })
/** Every leg with one view, on the program. */
const ON_PROGRAM = { lambda: views(1), asm: views(1), tm: views(1) }

/**
 * Design §4.5's first surface: the line that already narrates the correspondence states which views
 * are OUTSIDE it. The badge — the second surface — is `tests/browser/view-status.test.ts`, because
 * this module is pure logic and that one needs a DOM; §4.5's own note that the both-surfaces test
 * splits by runner.
 *
 * EVERY CASE HERE HAS AN ATTACHED COUNTERPART, per §5: "a test that only checks the badge appears
 * would pass an implementation that never removes it" is equally true of the sentence, and the
 * first `it` below is the one that fails such an implementation.
 */
describe('linkStatus · detachment', () => {
  // THE ABSENT-FIELD CASE IS NOT REDUNDANT WITH THE ALL-ON-THE-PROGRAM ONE. `detached` is optional, and this
  // asserts that the default that silence rests on is "attached", not `undefined` leaking into the output.
  it('says nothing about detachment when every view shows the program', () => {
    expect(linkStatus({ state: 'none' })).toBe('')
    expect(linkStatus({ state: 'none', detached: ON_PROGRAM })).toBe('')
    expect(
      linkStatus({
        state: 'linked',
        tm: true,
        instrs: true,
        lambda: 'shown',
        focus: true,
        asmFocus: false,
        detached: ON_PROGRAM,
      }),
    ).toBe('the machine is here right now')
  })

  // VIEWS DETACH INDEPENDENTLY (§4.3: detaching one view leaves the program running and the others bound to
  // it), which is why `detached` is a record and not a boolean. A shape that could only say "something is
  // detached" passes every other case here and fails these two.
  it('names only the leg whose view shows a copy', () => {
    expect(linkStatus({ state: 'none', detached: { ...ON_PROGRAM, lambda: views(1, 'λ · copy 1') } })).toBe(
      'λ view shows a copy — not linked to the program',
    )
    expect(linkStatus({ state: 'none', detached: { ...ON_PROGRAM, tm: views(1, 'TM · copy 2') } })).toBe(
      'TM view shows a copy — not linked to the program',
    )
  })

  // ONE CLAUSE, NOT THE SAME SENTENCE TWICE. "not linked to source" is one fact about one
  // correspondence; repeating it verbatim either side of a `·` reads as two unrelated failures.
  it('names both legs in one clause when both show copies', () => {
    expect(
      linkStatus({
        state: 'none',
        detached: { ...ON_PROGRAM, lambda: views(1, 'λ · copy 1'), tm: views(1, 'TM · copy 2') },
      }),
    ).toBe('λ and TM views show copies — not linked to the program')
  })

  // THE CHECK BY HAND'S FIRST CASE: an asm view on the program and a second on a copy. The line read off each leg's
  // view focused last, so with the program's view focused last it said "λ and TM views show copies" while
  // `asm · copy 10` was on screen. Every view counts now, and a leg with more than one names its copy by title.
  it('names a leg’s view on a copy by its title when the leg has more than one view', () => {
    expect(
      linkStatus({
        state: 'none',
        detached: { lambda: views(1, 'λ · copy 8'), asm: views(2, 'asm · copy 10'), tm: views(1, 'TM · copy 7') },
      }),
    ).toBe('λ, asm · copy 10 and TM views show copies — not linked to the program')
  })

  // THE SECOND CASE, THE REVERSE: with two asm views, one on a copy, "asm view shows a copy" did not say which.
  it('says which of a leg’s views shows a copy, never the leg alone, when the leg has two', () => {
    expect(linkStatus({ state: 'none', detached: { ...ON_PROGRAM, asm: views(2, 'asm · copy 1') } })).toBe(
      'asm · copy 1 view shows a copy — not linked to the program',
    )
    expect(
      linkStatus({ state: 'none', detached: { ...ON_PROGRAM, asm: views(3, 'asm · copy 1', 'asm · copy 2') } }),
    ).toBe('asm · copy 1 and asm · copy 2 views show copies — not linked to the program')
  })

  it('says a copy two views show once', () => {
    expect(
      linkStatus({ state: 'none', detached: { ...ON_PROGRAM, asm: views(3, 'asm · copy 1', 'asm · copy 1') } }),
    ).toBe('asm · copy 1 view shows a copy — not linked to the program')
  })

  // ORDERED MOST-GLOBAL FIRST, the rule `draw.ts`'s `createDraw` follows for the λ state: a view being
  // outside the correspondence entirely is a bigger fact than anything about what resolved inside it, and
  // every clause after it is about the views still inside.
  it('reports detachment ahead of the pin narration', () => {
    expect(linkStatus({ state: 'stale', detached: { ...ON_PROGRAM, lambda: views(1, 'λ · copy 1') } })).toBe(
      'λ view shows a copy — not linked to the program · linking resumes when this compiles',
    )
  })

  // §4.5's standard, applied to the clauses themselves: "a thing that provably cannot work should not
  // be presented as though it might". A λ view on a copy is showing a scratch term, so
  // `LAMBDA_TEXT['none-here']` would describe a term that is not on screen — while
  // the TM clause, whose view is still bound to the program, stays.
  it('suppresses the λ clause when the λ view shows a copy and keeps the TM one', () => {
    expect(
      linkStatus({
        state: 'linked',
        tm: false,
        instrs: true,
        lambda: 'none-here',
        focus: false,
        asmFocus: false,
        detached: { ...ON_PROGRAM, lambda: views(1, 'λ · copy 1') },
      }),
    ).toBe('λ view shows a copy — not linked to the program · this construct emits no machine states')
  })

  // The mirror, and `focus: true` is the load-bearing half: `TmState.source_node` is `None` for every
  // state a `TmScratch` renders (§3.1), so "the machine is here right now" about a TM view on a copy
  // is a claim no scratch can make. Suppressed rather than trusted from the caller.
  it('suppresses the TM clauses when the TM view shows a copy and keeps the λ one', () => {
    expect(
      linkStatus({
        state: 'linked',
        tm: false,
        instrs: true,
        lambda: 'none-here',
        focus: true,
        asmFocus: false,
        detached: { ...ON_PROGRAM, tm: views(1, 'TM · copy 2') },
      }),
    ).toBe('TM view shows a copy — not linked to the program · this construct has no node in the λ term at this step')
  })

  // THE ASM LEG'S CLAUSES FOLLOW ITS OWN VIEWS' BINDINGS, as each leg's do: an asm view on a copy is showing an asm
  // copy's run, which no construct of the program's owns.
  it('suppresses the asm clauses when the asm view shows a copy and keeps the others', () => {
    expect(
      linkStatus({
        state: 'linked',
        tm: true,
        instrs: false,
        lambda: 'shown',
        focus: true,
        asmFocus: true,
        detached: { ...ON_PROGRAM, asm: views(1, 'asm · copy 1') },
      }),
    ).toBe('asm view shows a copy — not linked to the program · the machine is here right now')
  })

  // A LEG WITH A VIEW OF THE PROGRAM KEEPS ITS CLAUSES BESIDE ITS VIEW ON A COPY: `draw.ts` reads the running focus
  // and the λ link state off a view of the program, so they are about that view. Every view on a copy suppresses them.
  it('keeps a leg’s clauses while one of its views shows the program, and suppresses them when none does', () => {
    const linked = {
      state: 'linked',
      tm: true,
      instrs: false,
      lambda: 'shown',
      focus: false,
      asmFocus: true,
    } as const
    expect(linkStatus({ ...linked, detached: { ...ON_PROGRAM, asm: views(2, 'asm · copy 1') } })).toBe(
      'asm · copy 1 view shows a copy — not linked to the program · the asm run is here right now · this construct emits no instructions',
    )
    expect(linkStatus({ ...linked, detached: { ...ON_PROGRAM, asm: views(2, 'asm · copy 1', 'asm · copy 2') } })).toBe(
      'asm · copy 1 and asm · copy 2 views show copies — not linked to the program',
    )
  })

  // A LEG WITH NO VIEW IS NOT DETACHED: there is no binding to read, so its clauses stand as they did.
  it('reads a leg with no view as attached', () => {
    expect(
      linkStatus({
        state: 'linked',
        tm: false,
        instrs: true,
        lambda: 'shown',
        focus: false,
        asmFocus: false,
        detached: { ...ON_PROGRAM, tm: views(0) },
      }),
    ).toBe('this construct emits no machine states')
  })

  it('leaves only the detachment clause when both legs show copies', () => {
    expect(
      linkStatus({
        state: 'linked',
        tm: false,
        instrs: true,
        lambda: 'declined',
        focus: true,
        asmFocus: false,
        detached: { ...ON_PROGRAM, lambda: views(1, 'λ · copy 1'), tm: views(1, 'TM · copy 2') },
      }),
    ).toBe('λ and TM views show copies — not linked to the program')
  })
})
