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
 * and whose `slot` is a `PaneSlot<'lambda'>` — the property `Binding<K>` exists to protect
 * (`sessions.ts:110-124`), carried through the collection rather than lost at its boundary.
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
 * have to remember to update it — the two-places-to-be-wrong failure `sessions.ts:8-16` refuses one
 * type up. The cost is a linear scan of a collection whose size is the number of panes on screen.
 *
 * INSERTION ORDER IS ITERATION ORDER, matching `SessionRegistry`'s `Map` for the same reason: it
 * falls out without a comparator that would have to invent a rank.
 */
export class PaneCollection {
  #entries = new Map<LeafId, PaneEntry<Leg>>()

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
   * The pane rendering `leg`, if this leg has one at all — the one place that answers "the λ pane" /
   * "the TM pane" for every scalar surface that still asks.
   *
   * `undefined` RATHER THAN A THROW, AND THAT IS THE WHOLE REASON THE METHOD EXISTS. Four modules used
   * to hold their own private copy of this question — `draw.ts` destructured `of(leg)[0]` and threw,
   * `link-wiring.ts` did the same twice, and `compile.ts`/`replies.ts` each carried a `theLambdaPane`
   * helper before `editorHome` replaced them — and every one of those justified the throw with the
   * same invariant: "`main.ts` always registers one pane of each leg before this can be called". That
   * invariant expired the day `applyLayout` started deriving panes from the layout tree. `closeLeaf`
   * refuses only the last leaf in the TREE, not the last leaf on a LEG, so a user who closes the one λ
   * pane a fresh page ships reaches a legal state in which `of('lambda')` is empty — and the next
   * slice, which lets a pane change leg, makes an empty leg routine rather than reachable-if-you-try.
   * A leg with no pane is a state, not a wiring bug.
   *
   * "THE FIRST" RATHER THAN "THE ONLY", because a leg can hold any number and this deliberately does
   * not check. The callers are the surfaces with no per-pane identity yet — the one shared status
   * line, the one source editor's decoration — which need A pane on the leg rather than all of them;
   * which pane's state should win once several disagree is 5d-ii-b's question. Insertion order is the
   * answer that needs no comparator to invent a rank, for the reason `of` above gives.
   */
  first<K extends Leg>(leg: K): PaneEntry<K> | undefined {
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
