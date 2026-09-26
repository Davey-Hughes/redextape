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
 * THE PANE COLLECTION — what replaces `main.ts`'s `lambdaPane` and `tmPane` consts.  check-attributions: allow
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
   *
   * **THE λ LINK CLAUSE ASKS `shown` INSTEAD (Plan 7 part 4a)**, and the λ copy clause asks it first —
   * this answer among the panes on the page, for a reason that holds only for them; `shown`'s own doc has
   * it. The running focuses and the TM copy clause ask this, and so does the λ copy clause when no λ view
   * is on the page.
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

  /**
   * `active(leg)` among the panes `onPage` says are on the page: the active pane if it is one of them,
   * else the first of them, else `undefined`.
   *
   * **A READER OF A VIEW'S OWN STATE ASKS THIS, NOT `active`.** In Stage one host is on the page and the
   * rest are off it, and selecting a tab records the focused leaf without marking a pane active, so
   * `active(leg)` can name a hidden pane. `draw()` hands a pin and a tree only to views on the page, so a
   * hidden λ view's `linkState` answered for an earlier pin: the λ link clause asks this, and so does the
   * λ copy clause, which must name the same view because `linkStatus` suppresses a copy's own clauses.
   * `undefined` is the link clause's honest absence: no λ view on screen, so no term to explain. The copy
   * clause then falls back to `active`, as the TM copy clause does, since a copy off the page is still one.
   *
   * **A READER OF A LEG'S LIVE HISTORY ASKS `active`.** The running focuses read the session a pane is
   * bound to, which is current whether or not the pane is drawn, and part 2's spec §8 keeps the step bar
   * on "the last view that could" step — in Stage, a view off the page — so that leg can still move.
   *
   * `onPage` IS THE CALLER'S, which keeps the collection free of the DOM: the app passes the `onPage`
   * below, and a node test passes its own.
   */
  shown<K extends Leg>(leg: K, onPage: (e: PaneEntry<K>) => boolean): PaneEntry<K> | undefined {
    const active = this.active(leg)
    if (active !== undefined && onPage(active)) return active
    return this.of(leg).find(onPage)
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

/**
 * Whether a pane is on the page — `PaneCollection.shown`'s test as the app runs it. In Stage every host but
 * the shown one is kept off the page (`pane-host.ts`). A free function rather than a method, so the
 * collection itself never reads the DOM.
 */
export function onPage(e: { readonly host: HTMLElement }): boolean {
  return e.host.isConnected
}
