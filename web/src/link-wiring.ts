import type { EditorView } from '@codemirror/view'
import { setLink } from './highlight'
import type { Link, LinkIndex, Pin } from './link'
import { type DetachedPanes, type LambdaLinkState, linkStatus } from './link-status'
import { onPage, type PaneCollection } from './panes'
import type { PaneSlot, SessionRegistry } from './sessions'
import type { TmPane } from './tm-pane'

/**
 * THE LINK STATE AND EVERYTHING THAT READS IT — the cluster `main.ts` held as four `let`s visible to a
 * thousand lines.
 *
 * `index`, `linkable` and `link` are one fact in three variables: what the current compile's link
 * index is, whether it exists, and what is pinned. (A fourth, the fork-failure field, carried refusals onto
 * `#link-status` until Plan 7 part 2 made refusals notices — `notice.ts`.) Nothing
 * outside this module writes any of them now, which is the whole point of the extraction — the
 * previous shape let any of `main()`'s thousand lines assign `link` and left the reader to find out
 * which ones did.
 *
 * `view` AND `draw` ARE THUNKS, NOT VALUES, AND THAT IS FORCED RATHER THAN STYLISTIC. `main.ts`
 * declares `let view: EditorView` and assigns it after this module is constructed, so a value
 * parameter would capture `undefined`; and `draw()` calls `drawLink` while `setLinkTo` calls `draw`,
 * so one of the two directions has to be late-bound. This is the same shape `SessionPool` already
 * uses for its worker factory.
 */
export type LinkWiring = {
  setIndex(index: LinkIndex | null): void
  /**
   * THE ONE STATE FIELD WITH A READ ACCESSOR AS WELL AS A WRITER, unlike `linkable`/`link`
   * below, which are only ever read through the narrower questions the other accessors answer.
   * `draw.ts` and the click handlers `transport.ts`'s `events(...)` builds resolve nodes straight
   * through the index (`index.linkFor`, `index.nodeForState`, `index.lambdaText`)
   * for the same per-frame cost reasons `draw()`'s own comments give for resolving a `Link` once and
   * sharing it — wrapping every one of those call sites in a forwarding method here would be a second
   * name for the same call, not an encapsulation of it.
   *
   * **HANDING THE INDEX OUT LEAKS NO AUTHORITY, AND THAT IS A PROPERTY OF `LinkIndex` RATHER THAN OF
   * WHO HAPPENS TO CALL THIS.** This doc used to rest its case on where the callers lived — "`main.ts`'s
   * `draw()` and the click handlers" — an argument that dissolved the moment `draw` and `events` moved
   * into modules of their own, without the conclusion changing at all. The real reason is that
   * `LinkIndex` (`link.ts`) exposes NOTHING that can change it: `lambdaText` and `lambdaCut` are
   * `readonly`, every method (`nodeAtSource`, `nodeForState`, `linkFor`) is a pure read, and the wire
   * arrays it reads them out of are `#`-private. The one write anywhere in the class is `#statesOf`'s
   * own memo of a value it just derived — a cache, not a state a caller can set. So a
   * holder of this reference can ask it questions and nothing else, whoever they are and wherever they
   * live. WRITES to the FIELD stay confined to this module (`setIndex` is the only one); this getter is
   * what keeps reads legitimate everywhere else.
   */
  get index(): LinkIndex | null
  get linkable(): boolean
  get link(): Pin | null
  clearLink(): void
  drawLink(l: Link | null, focusCoincident: boolean, lambda: LambdaLinkState): void
  setLinkTo(node: number | null, origin: 'source' | 'lambda' | 'tm'): void
  linkAtSourceOffset(byteOffset: number): void
}

export function createLinkWiring(deps: {
  view: () => EditorView
  statusHost: HTMLElement
  sessions: SessionRegistry
  panes: PaneCollection
  draw: () => void
  /**
   * Put a sentence in the live region only — `notice.ts`'s `announce`. A link GESTURE announces the
   * link sentence (Plan 7 part 2 spec §11); a keystroke never does.
   */
  announce: (text: string) => void
}): LinkWiring {
  const { view, sessions, panes, draw, announce } = deps
  const linkStatusHost = deps.statusHost

  /**
   * "THE" λ pane's slot and "the" TM pane's slot — `undefined` when that leg holds no pane at all —
   * resolved fresh from the collection on every read rather than cached, the same thunk idiom
   * `view`/`draw` above already use for the same reason: the answer can change under a caller that
   * keeps this closure around.
   *
   * STAND IN FOR THE `lambdaSlot`/`tmSlot` CONSTS THIS FACTORY USED TO CLOSE OVER DIRECTLY (T7). NO
   * LONGER "still exactly one pane of each kind", which is what these two used to assert twice by
   * throwing on an empty collection. That invariant expired when `pane-host.ts`'s `applyLayout` started
   * deriving panes from the layout tree — `closeLeaf` refuses only the last leaf in the TREE, so
   * closing the one λ pane a fresh page ships is an ordinary gesture, and `drawLink` ->
   * `detachedPanes` -> `theTmSlot` runs on every `draw()`, a keystroke's included. `PaneCollection.active`
   * answers the question now, and `shown` below is built on it — the pane the user last focused on that
   * leg, falling back to insertion order when none is marked or the mark no longer resolves (5d-ii-b) —
   * and its own doc has the argument for why all four consumers were once carrying a private copy of the
   * same expired invariant.
   *
   * **EACH MUST NAME THE VIEW ITS LEG'S OTHER CLAUSES DESCRIBE**, because `linkStatus` suppresses a
   * detached view's own clauses. `theTmSlot` asks `active`, the pane `draw()`'s TM running focus reads, so
   * the copy clause and the "the machine is here" clause are about one view. `theLambdaSlot` asks
   * `PaneCollection.shown` — `active` among the panes on the page — first, because that is the view `draw()`
   * takes the λ link clause from: in Stage the active pane can be off the page, and a hidden view's pin
   * and tree are stale (`shown`'s own doc). **WITH NO λ VIEW ON THE PAGE IT FALLS BACK TO `active`**, as
   * the TM clause does, so a hidden λ copy is still named: the λ link clause then reads `'absent'` and says
   * nothing, so there is no clause about another view for the copy's to contradict.
   *
   * `detachedPanes` BELOW GIVES AN HONEST ANSWER FOR ABSENCE RATHER THAN PROPAGATING IT: a pane that
   * does not exist is not detached. `draw()` gives the λ link state the same kind of answer, `'absent'`.
   */
  const theLambdaSlot = (): PaneSlot<'lambda'> | undefined =>
    (panes.shown('lambda', onPage) ?? panes.active('lambda'))?.slot
  const theTmSlot = (): PaneSlot<'tm'> | undefined => panes.active('tm')?.slot

  /**
   * Which panes are outside the source correspondence right now — §4.5's first surface, read off the
   * bindings.
   *
   * TWO LOOKUPS RATHER THAN A FLAG, and that is what makes §4.5's pairing cheap: detachment is a
   * property of the SESSION (`SessionEntry.detached`), so a pane is detached exactly when the session
   * it is bound to is, and both surfaces — this sentence and the view's own `copy · not linked` status, which
   * `PaneSlot.render` sets from the same field — cannot disagree.
   *
   * §5 OWED THE JOINT CASE TO "THE TASK THAT WIRES `main.ts`", which is this one: T6 shipped both
   * surfaces with no binding to drive them, and this is the call that drives them.
   *
   * A LEG WITH NO PANE READS `false`, WHICH IS THE HONEST ANSWER RATHER THAN A CONVENIENT ONE.
   * Detachment is a property of the SESSION a pane is BOUND to, so with no pane there is no binding to
   * read and nothing is outside the correspondence — and the clause this drives ("λ view shows a copy —
   * not linked to the program") would otherwise narrate a pane that does not exist. A λ pane OFF the page,
   * in Stage, still reads its session's detachment, as a hidden TM pane does (`theLambdaSlot`).
   */
  const detachedPanes = (): DetachedPanes => {
    const lambda = theLambdaSlot()
    const tm = theTmSlot()
    return {
      lambda: lambda !== undefined && sessions.entryOf(lambda.binding.session).detached,
      tm: tm !== undefined && sessions.entryOf(tm.binding.session).detached,
    }
  }

  /**
   * The current compile's link index, and the construct the user has linked.
   *
   * `linkable` IS NOT `index !== null`. An index is from the last compile, so the first keystroke
   * after it shifts every source span it holds; linking is disabled from that keystroke until the
   * next `compiled` lands. Resolving against a stale index is the silently-wrong answer this whole
   * slice refuses elsewhere.
   *
   * NOT IN THE REGISTRY, AND THAT IS THIS TASK'S SCOPE LINE. §3.2b asks for an entry owning "its own
   * `LegState`s and its own `SessionClient`", which is what `SessionEntry` holds — and no more. An
   * index is a property of a COMPILE, and §3.3 puts `linkIndex` and `sourceSpan` on neither scratch
   * type, so a per-entry `index` would be `null` for every entry that is not the source one. Moving
   * it is therefore not a mechanical extension of this refactor: it changes what the field means, and
   * it belongs to whichever task first has a second session for it to be wrong about.
   */
  let index: LinkIndex | null = null
  let linkable = false
  let link: Pin | null = null

  /**
   * Paint the link status line from `draw()`'s already-resolved link, or `null` when there is nothing
   * to resolve.
   *
   * `l` IS A PARAMETER, NOT A CALL TO `index.linkFor` HERE — `draw()` resolves it once per tick; see
   * `draw()`'s doc. `l === null` covers both "nothing is
   * linked" and "linking is stale", but those still report DIFFERENT statuses (`none` vs `stale`), so
   * `linkable` is consulted directly rather than folded into what made `l` null.
   *
   * `focusCoincident` IS A PARAMETER TOO, for the same reason: `draw()` already resolved the TM leg's
   * running focus against `link` (`isCoincident`) once, and re-deriving it here would need `tmFocus`
   * threaded in anyway — passing the boolean it produces is the smaller surface. Meaningless when
   * `l === null` (nothing is pinned to coincide with) or `!linkable` (both return before reading it).
   *
   * `detached` IS ON ALL THREE ARMS, NOT ONLY `'linked'`, and that is §4.5's obligation rather than
   * symmetry: `{state:'none'}` with a detached λ pane is precisely the case where this line goes from
   * blank to speaking. `linkStatus` is the one function that reads the field and it suppresses a
   * detached pane's own clauses itself, so nothing here has to know which clauses those are.
   */
  const drawLink = (l: Link | null, focusCoincident: boolean, lambda: LambdaLinkState) => {
    const detached = detachedPanes()
    if (!linkable) {
      linkStatusHost.textContent = linkStatus({ state: 'stale', detached })
      return
    }
    if (l === null) {
      linkStatusHost.textContent = linkStatus({ state: 'none', detached })
      return
    }
    linkStatusHost.textContent = linkStatus({
      state: 'linked',
      tm: l.states.length > 0,
      lambda,
      focus: focusCoincident,
      detached,
    })
  }

  /**
   * Resolve a link and paint all three panes.
   *
   * `origin` DRIVES SCROLLING ONLY. A scroll-into-view triggered by the pane the user is already
   * looking at moves the thing under their cursor, so the table scrolls for a source click and not
   * for its own.
   */
  const setLinkTo = (node: number | null, origin: 'source' | 'lambda' | 'tm') => {
    link = node === null ? null : { node, origin }
    // ONE `linkFor` CALL, reused for both legs it drives here — see `drawLink`'s doc for why a second
    // call on a path that runs per rendered frame during playback is not free.
    const l = node === null || index === null ? null : index.linkFor(node)
    view().dispatch({ effects: setLink.of(l?.source ?? null) })
    // `draw()` NOW CALLS `drawLink()` itself, at its end — see that function's doc. `link` is already
    // set above, so this single call sees the new value; a separate `drawLink()` call here would be
    // the same read twice.
    //
    // CALLED BEFORE THE TM FAN-OUT'S `setLink`, NOT AFTER — ORDER IS LOAD-BEARING. `draw()` calls
    // `PaneSlot.render(...)` on every tm-kind pane, which runs `TmPane`'s `#drawTable`
    // UNCONDITIONALLY on every call, following included. `TmPane.setLink`'s own scroll is a one-shot
    // target `#drawTable` honours for exactly its next call (design §5.1) — so if `draw()` ran AFTER
    // the fan-out below, its `#drawTable` pass would be the SECOND call since the target was armed,
    // see nothing pending (already consumed), fall back to the follow target, and silently revert the
    // link's scroll in the same synchronous turn the link itself ran in. Calling `draw()` first burns
    // its `#drawTable` pass on the (soon-stale) previous link state — thrown away before the browser
    // ever paints it — so the fan-out below is the LAST word and its one-shot target is still armed
    // when it runs.
    const before = linkStatusHost.textContent ?? ''
    draw()
    // ANNOUNCED HERE AND NOWHERE ELSE (spec §11): `setLinkTo` is the link gesture — a source click or
    // `Mod-'`, a λ token, a rule row. `draw()` just wrote the sentence; a keystroke reaches `drawLink`
    // through `draw()` alone and says nothing.
    //
    // **WHAT CHANGED IS MEASURED AGAINST THE LINE, NOT AGAINST THE LAST THING ANNOUNCED.** A memo of the
    // last announcement goes stale the moment anything else writes the line — and something does, on
    // every keystroke: the source editor's `updateListener` clears the link, so the line reads "linking
    // resumes when this compiles" and then empties when the compile lands, both unannounced and
    // correctly so. With a memo, clicking the same construct again after an edit produced the same
    // sentence as last time and was therefore silent, though the line had just changed from nothing to
    // that sentence — which is the accessibility item this announcement exists to close.
    const sentence = linkStatusHost.textContent ?? ''
    if (sentence !== before) announce(sentence)
    // PER-LEG, NOT PER-PANE — every TM pane follows the same link, resolved once above and fanned out
    // here, HIDDEN ONES INCLUDED. `p.pane` NEEDS THE CAST for the reason `draw.ts`'s identical loop
    // documents: `PaneView<T>` is deliberately narrow and does not carry `setLink`, which is a fact
    // about the concrete `TmPane` class. `scrollTo` is `origin !== 'tm'`: a click that came from the
    // table itself must not scroll the table it was just clicked in out from under the cursor; a click
    // from source or λ should bring the state block into view.
    //
    // **NOT SKIPPED FOR A HIDDEN PANE, UNLIKE `draw()`'S OWN RENDER LOOP.** A pane that saw the last
    // compile is not in `replies.ts`'s `unseen` set, so `draw()`'s seed block never runs for it —
    // this fan-out is the ONLY place anything ever tells it the pin, hidden or not, and skipping a
    // hidden one here left it painting whatever pin it had before it was hidden, unable to hear a
    // later one made while it was off the page (found in review: linking while a view that saw the
    // compile sits behind another tab left it showing no link at all, and moving the pin while it is
    // hidden left it showing the pin from before it went off the page). A pane that MISSED the
    // compile (in `unseen`) has a stale `#index`, so the states this call resolves against the
    // CURRENT index can name the wrong rows there, or none — but that pane is about to be reseeded
    // before it is next shown, and `draw.ts`'s seed block re-applies the CURRENT pin once it is, so a
    // wrong answer written here never reaches the screen.
    for (const p of panes.of('tm')) (p.pane as TmPane).setLink(l?.states ?? [], origin !== 'tm')
  }

  /** Link at a byte offset into the source document, or clear if nothing contains it. */
  const linkAtSourceOffset = (byteOffset: number) => {
    if (!linkable || index === null) return
    setLinkTo(index.nodeAtSource(byteOffset), 'source')
  }

  return {
    setIndex(newIndex: LinkIndex | null): void {
      index = newIndex
      linkable = index !== null
      link = null
    },
    get index(): LinkIndex | null {
      return index
    },
    get linkable(): boolean {
      return linkable
    },
    get link(): Pin | null {
      return link
    },
    clearLink(): void {
      linkable = false
      link = null
    },
    drawLink,
    setLinkTo,
    linkAtSourceOffset,
  }
}
