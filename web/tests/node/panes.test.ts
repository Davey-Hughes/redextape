import { describe, expect, it } from 'vitest'
import type { ControlState } from '../../src/controls'
import { PaneCollection, type PaneEntry } from '../../src/panes'
import type { Leg } from '../../src/protocol'
import type { SessionId } from '../../src/session-client'
import type { Binding, PaneOption, PaneView } from '../../src/sessions'
import { PaneSlot } from '../../src/sessions'
import type { LambdaState, TmState } from '../../src/types'

/**
 * THE COLLECTION, DRIVEN WITHOUT A DOM — the container that replaces `main.ts`'s two pane consts.
 *
 * The claim under test is that `of` and `ofSession` select by leg AND by binding, because that is
 * what turns `tmPane.setProgram(x)` into a loop that reaches every TM pane on the session whose
 * worker sent the reply and no others. A collection that returned everything would still make the
 * app work today, with two panes, and would silently repaint the wrong session's pane the moment a
 * third existed.
 */

function fakePane<T>(): PaneView<T> & { frames: (T | null)[] } {
  const frames: (T | null)[] = []
  return {
    frames,
    render(frame: T | null, _c: ControlState) {
      frames.push(frame)
    },
    setBindings(_o: PaneOption[], _c: Binding<Leg>) {},
    setDetached(_d: boolean) {},
    setLayoutControls(_canClose: boolean, _canSplit: boolean) {},
  }
}

/** A host with no document behind it — the collection stores the reference and never touches it. */
const fakeHost = () => ({}) as HTMLElement

function lambdaEntry(id: string, session: SessionId): PaneEntry<'lambda'> {
  return { id, kind: 'lambda', slot: new PaneSlot('lambda', session), pane: fakePane<LambdaState>(), host: fakeHost() }
}

function tmEntry(id: string, session: SessionId): PaneEntry<'tm'> {
  return { id, kind: 'tm', slot: new PaneSlot('tm', session), pane: fakePane<TmState>(), host: fakeHost() }
}

describe('PaneCollection', () => {
  it('selects by leg', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    panes.add(tmEntry('c', 'source'))

    expect(panes.of('lambda').map((p) => p.id)).toEqual(['a', 'b'])
    expect(panes.of('tm').map((p) => p.id)).toEqual(['c'])
  })

  it('selects by leg AND session, which is what stops one session repainting another', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'lambda-scratch'))

    expect(panes.ofSession('lambda', 'source').map((p) => p.id)).toEqual(['a'])
    expect(panes.ofSession('lambda', 'lambda-scratch').map((p) => p.id)).toEqual(['b'])
  })

  it('follows a rebind rather than caching the binding it was added with', () => {
    const panes = new PaneCollection()
    const entry = lambdaEntry('a', 'source')
    panes.add(entry)
    expect(panes.ofSession('lambda', 'lambda-scratch')).toEqual([])

    entry.slot.rebind('lambda-scratch')

    expect(panes.ofSession('lambda', 'source')).toEqual([])
    expect(panes.ofSession('lambda', 'lambda-scratch').map((p) => p.id)).toEqual(['a'])
  })

  // `active` IS THE ONE PLACE "THE λ PANE" IS ANSWERED, and the answer it has to give is `undefined`.
  // Four modules used to ask this question privately and three of them threw, on an invariant that
  // expired when panes started being derived from the layout tree — see the method's own doc.
  it('answers undefined for a leg with no pane rather than throwing', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    expect(panes.active('tm')).toBeUndefined()
    panes.remove('a')
    expect(panes.active('lambda')).toBeUndefined()
  })

  it('answers first-in-insertion-order for a leg holding several', () => {
    const panes = new PaneCollection()
    panes.add(tmEntry('c', 'source'))
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    expect(panes.active('lambda')?.id).toBe('a')
    expect(panes.active('tm')?.id).toBe('c')
  })

  it('throws on a duplicate id, mirroring SessionRegistry.add', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    expect(() => panes.add(lambdaEntry('a', 'source'))).toThrow(/already/)
  })

  it('is idempotent on remove, mirroring SessionRegistry.remove', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.remove('a')
    expect(() => panes.remove('a')).not.toThrow()
    expect(panes.size).toBe(0)
  })

  it('iterates in insertion order', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('c', 'source'))
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    expect(panes.all().map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })

  it('returns a registered pane by its id', () => {
    const panes = new PaneCollection()
    const entry = lambdaEntry('a', 'source')
    panes.add(entry)
    expect(panes.get('a')).toBe(entry)
  })

  it('returns undefined for an unknown id', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    expect(panes.get('unknown')).toBeUndefined()
  })

  it('stops returning a pane after remove', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    expect(panes.get('a')).toBeDefined()
    panes.remove('a')
    expect(panes.get('a')).toBeUndefined()
  })
})

describe('active', () => {
  it('falls back to insertion order when nothing is marked', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    expect(panes.active('lambda')?.id).toBe('a')
  })

  it('returns the marked pane', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    panes.markActive('b')
    expect(panes.active('lambda')?.id).toBe('b')
  })

  it('falls back when the marked pane was removed', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    panes.markActive('b')
    panes.remove('b')
    expect(panes.active('lambda')?.id).toBe('a')
  })

  it('falls back when the marked leaf changed leg', () => {
    // THE KIND CHANGE. `markActive` recorded lambda -> 'b'; 'b' is now a TM pane under the same id,
    // so it is no longer an answer to "which lambda pane is active". Design §4.2c.
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.add(lambdaEntry('b', 'source'))
    panes.markActive('b')
    panes.remove('b')
    panes.add(tmEntry('b', 'source'))
    expect(panes.active('lambda')?.id).toBe('a')
    expect(panes.active('tm')?.id).toBe('b')
  })

  it('is undefined for a leg with no pane', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    expect(panes.active('tm')).toBeUndefined()
  })

  it('ignores a mark for an id it does not hold', () => {
    const panes = new PaneCollection()
    panes.add(lambdaEntry('a', 'source'))
    panes.markActive('ghost')
    expect(panes.active('lambda')?.id).toBe('a')
  })
})
