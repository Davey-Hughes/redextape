import type { Leg } from './protocol'
import type { SessionId } from './session-client'
import type { LegFrame, PaneSlot, PaneView } from './sessions'

/** A leaf's stable identity — the key shared by the layout tree, the DOM and persistence. */
export type LeafId = string

/**
 * What a leaf renders.
 *
 * NOT A `Leg`, BECAUSE `'source'` IS NOT ONE. The source pane renders an editor rather than a leg's
 * frames, so a `Leg`-typed field could not name it. `'lambda'` and `'tm'` coincide with `Leg`'s
 * members and are deliberately not aliased to it — the day a pane kind exists that is not a leg, this
 * type extends and `Leg` does not.
 */
export type PaneKind = 'source' | 'lambda' | 'tm'

/**
 * One live pane: its leaf identity, what it renders, the slot that resolves its binding, the view
 * itself and the element it is mounted in.
 *
 * PARAMETERISED BY THE LEG, so `of('lambda')` yields entries whose `pane` is a `PaneView<LambdaState>`
 * and whose `slot` is a `PaneSlot<'lambda'>` — the property `Binding<K>` exists to protect (its own doc
 * in `sessions.ts`), carried through the collection rather than lost at its boundary.
 */
export type PaneEntry<K extends Leg> = {
  readonly id: LeafId
  readonly kind: PaneKind
  readonly slot: PaneSlot<K>
  readonly pane: PaneView<LegFrame[K]>
  readonly host: HTMLElement
}

/**
 * THE PANE COLLECTION — what replaces `main.ts`'s `lambdaPane` and `tmPane` consts.
 *
 * Thirty call sites assumed exactly one pane of each leg. The question every one of them was really
 * asking is "which panes should this reply repaint", and the answer is a pair: the leg the reply is
 * about, and the session whose worker sent it. `ofSession` is that question; `of` is the half of it
 * that predates sessions.
 *
 * IT READS THE BINDING THROUGH THE SLOT ON EVERY CALL RATHER THAN INDEXING BY SESSION. A
 * `Map<SessionId, …>` would be a second copy of a fact `PaneSlot` already owns, and `rebind` would
 * have to remember to update it — the two-places-to-be-wrong failure `sessions.ts`'s `LegState` doc
 * refuses one type up. The cost is a linear scan of a collection whose size is the number of panes on
 * screen.
 *
 * INSERTION ORDER IS ITERATION ORDER, matching `SessionRegistry`'s `Map` for the same reason: it
 * falls out without a comparator that would have to invent a rank.
 */
export class PaneCollection {
  #entries = new Map<LeafId, PaneEntry<Leg>>()
  #activeByLeg = new Map<Leg, LeafId>()

  get size(): number {
    return this.#entries.size
  }

  /**
   * Register a pane.
   *
   * THROWS ON AN ID ALREADY HELD, mirroring `SessionRegistry.add` and `SessionPool.bind`. A pane owns
   * a mounted DOM subtree, so replacing one silently would strand an element nothing can reach.
   */
  add<K extends Leg>(entry: PaneEntry<K>): void {
    if (this.#entries.has(entry.id)) throw new Error(`pane is already in the collection: ${entry.id}`)
    this.#entries.set(entry.id, entry as PaneEntry<Leg>)
  }

  /** Forget `id`. Idempotent, mirroring `SessionRegistry.remove`: a second call asks for a state already true. */
  remove(id: LeafId): void {
    this.#entries.delete(id)
  }

  get(id: LeafId): PaneEntry<Leg> | undefined {
    return this.#entries.get(id)
  }

  /** Every pane rendering `leg`, in insertion order. */
  of<K extends Leg>(leg: K): PaneEntry<K>[] {
    const out: PaneEntry<K>[] = []
    for (const e of this.#entries.values()) {
      if (e.slot.binding.leg === leg) out.push(e as PaneEntry<K>)
    }
    return out
  }

  /**
   * Record that `id`'s pane is the one the user is working in.
   *
   * IT TAKES A `LeafId` AND DERIVES THE LEG, WHICH IS WHAT KEEPS THIS MODULE FREE OF THE DOM. The
   * caller is a `focusin` listener in `pane-host.ts` and knows only which host fired; the collection
   * already holds the entry that says which leg that is, so asking the caller would be asking it to
   * carry a fact this class owns.
   *
   * AN UNKNOWN ID IS IGNORED RATHER THAN THROWN ON. Focus can land in a host whose entry has already
   * been removed — a close repaints and moves focus in the same tick — and that is a race, not a
   * wiring bug.
   */
  markActive(id: LeafId): void {
    const entry = this.#entries.get(id)
    if (entry === undefined) return
    this.#activeByLeg.set(entry.slot.binding.leg, id)
  }

  /**
   * The pane on `leg` whose state the app's shared surfaces should describe.
   *
   * THIS REPLACES `first`, AND IT IS THE ANSWER TO THE QUESTION `first`'s DOC DEFERRED to this slice:
   * "which pane's state should win once several disagree". The two consumers — `draw.ts`'s
   * running-focus decoration and `link-wiring.ts`'s `detachedPanes` — drive the ONE source editor and
   * the ONE status line, so with several panes on a leg they need a pane the user can CHOOSE, and
   * clicking into one is that choice.
   *
   * PER LEG RATHER THAN ONE GLOBAL ACTIVE PANE. Clicking into the source editor must not blank out
   * which λ pane the status line is describing; the source editor is on neither leg.
   *
   * THE LEG IS RE-CHECKED RATHER THAN TRUSTED, AND THAT IS THE KIND CHANGE RATHER THAN DEFENSIVE
   * STYLE. `markActive` may have recorded `lambda -> 'pane-3'` before `pane-3` became a TM pane; the
   * entry under that id is now a different pane on a different leg.
   *
   * THE FALLBACK IS EXACTLY THE OLD `first`, so the single-pane case and the empty-leg case are
   * unchanged — including the `undefined`, which four modules once each answered privately with a
   * throw. A leg with no pane is a state, not a wiring bug.
   */
  active<K extends Leg>(leg: K): PaneEntry<K> | undefined {
    const marked = this.#activeByLeg.get(leg)
    if (marked !== undefined) {
      const entry = this.#entries.get(marked)
      if (entry !== undefined && entry.slot.binding.leg === leg) return entry as PaneEntry<K>
    }
    for (const e of this.#entries.values()) {
      if (e.slot.binding.leg === leg) return e as PaneEntry<K>
    }
    return undefined
  }

  /** Every pane rendering `leg` AND bound to `session` — the question a reply handler is asking. */
  ofSession<K extends Leg>(leg: K, session: SessionId): PaneEntry<K>[] {
    const out: PaneEntry<K>[] = []
    for (const e of this.#entries.values()) {
      if (e.slot.binding.leg === leg && e.slot.binding.session === session) out.push(e as PaneEntry<K>)
    }
    return out
  }

  all(): PaneEntry<Leg>[] {
    return [...this.#entries.values()]
  }
}
