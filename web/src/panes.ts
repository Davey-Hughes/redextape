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
export type PaneKind = 'source' | 'lambda' | 'asm' | 'tm'

/**
 * The leg a pane of `kind` renders, or `null` for the source pane, which renders an editor and no leg.
 *
 * **A `switch`, SO THAT A NEW KIND IS A TYPE ERROR HERE RATHER THAN A SILENT ANSWER.** Because the kinds that
 * are legs are not aliased to `Leg` (`PaneKind`'s own doc), "is this kind a leg" used to be asked by listing
 * them — `kind === 'lambda' || kind === 'tm'` — which is `false` for a third leg's kind with `tsc` green
 * (`legs.ts` has the class of bug). Every arm returns, so a kind with no arm is TS2366.
 */
export function legOfPane(kind: PaneKind): Leg | null {
  switch (kind) {
    case 'source':
      return null
    case 'lambda':
      return 'lambda'
    case 'asm':
      return 'asm'
    case 'tm':
      return 'tm'
  }
}

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
  /**
   * The panes the user has focused, most recent first, each once — `markActive`'s record.
   *
   * **AN ORDER, NOT THE LAST PANE PER LEG**, because a reader may refuse the last one: the running focuses take the
   * most recently focused view that shows the program, and when the view focused last shows a copy the answer is the
   * one focused before it. A last-per-leg map could only fall back to insertion order there.
   */
  #recent: LeafId[] = []

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

  /**
   * Forget `id`. Idempotent, mirroring `SessionRegistry.remove`: a second call asks for a state already true.
   *
   * Its place in the focus order goes with it, so the order holds only panes that exist: a pane rebuilt under the
   * same id — a leg change, a reset — is focused afresh before it is anyone's answer.
   */
  remove(id: LeafId): void {
    this.#entries.delete(id)
    this.#recent = this.#recent.filter((r) => r !== id)
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
   * IT TAKES A `LeafId` AND NO LEG, WHICH IS WHAT KEEPS THIS MODULE FREE OF THE DOM. The caller is a
   * `focusin` listener in `pane-host.ts` and knows only which host fired; the collection already holds the
   * entry that says which leg that is, and `active` reads it when it is asked, so asking the caller would be
   * asking it to carry a fact this class owns.
   *
   * AN UNKNOWN ID IS IGNORED RATHER THAN THROWN ON. Focus can land in a host whose entry has already
   * been removed — a close repaints and moves focus in the same tick — and that is a race, not a
   * wiring bug.
   */
  markActive(id: LeafId): void {
    if (!this.#entries.has(id)) return
    this.#recent = [id, ...this.#recent.filter((r) => r !== id)]
  }

  /**
   * The pane on `leg` whose state the app's shared surfaces should describe: of the panes on `leg` that `accept`
   * admits, the one the user focused most recently, else the first in insertion order, else `undefined`.
   *
   * THIS REPLACES `first`, AND IT IS THE ANSWER TO THE QUESTION `first`'s DOC DEFERRED to this slice:
   * "which pane's state should win once several disagree". Its consumer is `draw.ts`, whose running focuses
   * drive the ONE source editor's focus mark and each machine view's, so with several panes on a leg it needs a
   * pane the user can CHOOSE, and clicking into one is that choice.
   *
   * PER LEG RATHER THAN ONE GLOBAL ACTIVE PANE. Clicking into the source editor must not blank out
   * which λ pane is being described; the source editor is on neither leg.
   *
   * THE LEG IS RE-CHECKED RATHER THAN TRUSTED, AND THAT IS THE KIND CHANGE RATHER THAN DEFENSIVE
   * STYLE. `markActive` may have recorded `pane-3` while it was a λ pane, and `pane-3` may be a TM pane now;
   * it answers for the leg it is on.
   *
   * **`accept` IS WHAT A READER REFUSES, AND THE RUNNING FOCUSES REFUSE A COPY.** A running focus is the
   * program's: it resolves against the program's link index, and a copy's frames own no construct of it. So
   * `draw.ts` asks for the most recently focused view that shows the program, and a copy's view focused last
   * is passed over rather than taken, which left the program's own view unmarked while it was the view being
   * stepped. With no `accept`, every pane on the leg is admitted.
   *
   * THE FALLBACK IS EXACTLY THE OLD `first`, so the single-pane case and the empty-leg case are
   * unchanged — including the `undefined`, which four modules once each answered privately with a
   * throw. A leg with no pane is a state, not a wiring bug.
   */
  active<K extends Leg>(leg: K, accept: (e: PaneEntry<K>) => boolean = () => true): PaneEntry<K> | undefined {
    const admitted = (e: PaneEntry<Leg> | undefined): PaneEntry<K> | undefined =>
      e !== undefined && e.slot.binding.leg === leg && accept(e as PaneEntry<K>) ? (e as PaneEntry<K>) : undefined
    for (const id of this.#recent) {
      const e = admitted(this.#entries.get(id))
      if (e !== undefined) return e
    }
    for (const e of this.#entries.values()) {
      const hit = admitted(e)
      if (hit !== undefined) return hit
    }
    return undefined
  }

  /**
   * `active(leg, accept)` among the panes `onPage` says are on the page: of those `accept` admits, the one
   * focused most recently, else the first of them, else `undefined`.
   *
   * **A READER OF A VIEW'S OWN STATE ASKS THIS, NOT `active`.** In Stage one host is on the page and the
   * rest are off it, and selecting a tab records the focused leaf without marking a pane active, so
   * `active(leg)` can name a hidden pane. `draw()` hands a pin and a tree only to views on the page, so a
   * hidden λ view's `linkState` answered for an earlier pin: the λ link clause asks this, of the views that
   * show the program. `undefined` is the link clause's honest absence: no λ view of the program on screen,
   * so no term of the program's to explain.
   *
   * **A READER OF A LEG'S LIVE HISTORY ASKS `active`.** The running focuses read the session a pane is
   * bound to, which is current whether or not the pane is drawn, and part 2's spec §8 keeps the step bar
   * on "the last view that could" step — in Stage, a view off the page — so that leg can still move.
   *
   * `onPage` IS THE CALLER'S, which keeps the collection free of the DOM: the app passes the `onPage`
   * below, and a node test passes its own.
   */
  shown<K extends Leg>(
    leg: K,
    onPage: (e: PaneEntry<K>) => boolean,
    accept: (e: PaneEntry<K>) => boolean = () => true,
  ): PaneEntry<K> | undefined {
    return this.active(leg, (e) => onPage(e) && accept(e))
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
