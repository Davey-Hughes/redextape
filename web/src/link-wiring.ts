import type { EditorView } from '@codemirror/view'
import { setLink } from './highlight'
import { perLeg } from './legs'
import { type InstrLeg, type Link, type LinkIndex, type Pin, pinAtInstr } from './link'
import { type DetachedPanes, type LambdaLinkState, linkStatus } from './link-status'
import { LINKED, LINKED_LEGS, type LinkedLeg, perLinkedLeg } from './linked-legs'
import type { LeafId, PaneCollection } from './panes'
import type { SessionRegistry } from './sessions'

/**
 * The source editor's key for linking at the caret, the keyboard route to a click. `main.ts` binds it and the help
 * page's key table names it; `tests/node/pages.test.ts` holds the two together. It is unbound in `defaultKeymap` and in
 * `historyKeymap`; verify that before changing it.
 */
export const LINK_KEY = "Mod-'"

/**
 * THE LINK STATE AND EVERYTHING THAT READS IT.
 *
 * `index`, `linkable` and `link` are one fact in three variables: what the current compile's link
 * index is, whether it exists, and what is pinned. Nothing outside this module writes any of them, which
 * is the whole point of the module: no reader has to find out which lines elsewhere assign `link`.
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
   * WHO HAPPENS TO CALL THIS.** `LinkIndex` (`link.ts`) exposes NOTHING that can change it: `lambdaText`
   * and `lambdaCut` are `readonly`, every method (`nodeAtSource`, `nodeForState`, `nodeForInstr`,
   * `linkFor`) is a pure read, and the wire arrays it reads them out of are `#`-private. The one write
   * anywhere in the class is `#ownedBy`'s memo of a value it just derived — a cache, not a state a caller
   * can set. So a holder of this reference can ask it questions and nothing else, whoever they are and
   * wherever they live. WRITES to the FIELD stay confined to this module (`setIndex` is the only one);
   * this getter is what keeps reads legitimate everywhere else.
   */
  get index(): LinkIndex | null
  get linkable(): boolean
  get link(): Pin | null
  /**
   * An edit's clear: nothing is pinned, linking is off until the next compile, and every linked view drops its marks.
   * `draw()` sets a view's link only when it seeds that view: a link gesture sets it otherwise, and a compile's
   * `setProgram` clears it, so without this the marks would stay until the next compile lands. Hidden views are
   * cleared too, since a hidden one would show its rows again when its tab is selected. `setLink` redraws with the old
   * running focus still in it; the `draw()` that the edit's `compile.schedule` causes repaints it without.
   */
  clearLink(): void
  /**
   * A user's clear: a click on empty space in a view, or Escape in one (the link-clear design). Nothing is pinned and
   * everything that draws the link is redrawn, as for a source click on no construct, and linking stays on. NOT
   * `clearLink`, an edit's clear, which turns linking off until the next compile. Nothing pinned, it does nothing, so
   * a click on empty space costs no frame.
   */
  unpin(): void
  /**
   * How many link gestures `setLinkTo` and `linkInstr` have taken: read before and after a click's own handlers, it
   * tells the clear's listener whether the click linked. Only the view's handler knows whether a row links (a label
   * row, an instruction `defunc` minted, a row of a copy), and a clear after one that did would undo it.
   */
  get gestures(): number
  drawLink(l: Link | null, here: Readonly<Record<LinkedLeg, boolean>>, lambda: LambdaLinkState): void
  setLinkTo(node: number | null, origin: Exclude<Pin['origin'], InstrLeg>): void
  /**
   * Link the construct that owns instruction `pc`, or say on the status line that none does. `null`: a row lowered
   * from no rxm instruction, which clears the pin and explains nothing.
   */
  linkInstr(pc: number | null, origin: InstrLeg): void
  linkAtSourceOffset(byteOffset: number): void
  /**
   * Per leg, how many views it has and the title of each one showing a copy — what the status line's detachment clause
   * reads, and what the share popover's copies line names (Plan 7 part 6a spec §5.2).
   */
  detachedPanes(): DetachedPanes
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
  /** A view's title as its header reads it — how the detachment clause names a view showing a copy. */
  viewTitle: (id: LeafId) => string
  /** Whether the tree on screen holds this view — `draw.ts`'s dep of the same name has what it excludes. */
  arranged: (id: LeafId) => boolean
}): LinkWiring {
  const { view, sessions, panes, draw, announce, viewTitle, arranged } = deps
  const linkStatusHost = deps.statusHost

  /**
   * Which views are outside the source correspondence right now — 5d-i §4.5's first surface, read off the
   * bindings: per leg, how many views it has and the title of each one showing a copy.
   *
   * TWO LOOKUPS RATHER THAN A FLAG, and that is what makes 5d-i §4.5's pairing cheap: detachment is a
   * property of the SESSION (`SessionEntry.detached`), so a view is detached exactly when the session
   * it is bound to is, and both surfaces — this sentence and the view's own `copy · not linked` status, which
   * `PaneSlot.render` sets from the same field — cannot disagree.
   *
   * **EVERY VIEW OF EVERY LEG.** Reading only each leg's active view — the one focused last — would leave an
   * rxm copy on screen unnamed while a view of the program beside it had been focused more recently, and a
   * leg's views could not be told apart in the sentence. `linkStatus` names each view showing a copy, by its
   * title where its leg has more than one view, and suppresses a leg's own clauses only when every view of it
   * shows a copy. A view OFF the page, in Stage, is counted too: it is still a view, and its tab names it.
   * **A VIEW THE TREE ON SCREEN DOES NOT HOLD IS NOT COUNTED** (the view layouts spec §5): it is kept alive in an
   * arrangement the workspace remembers, nothing on the page names it, and a share link, whose popover reads this
   * too, does not carry it.
   *
   * A LEG WITH NO VIEW HAS NOTHING TO SAY, WHICH IS THE HONEST ANSWER RATHER THAN A CONVENIENT ONE.
   * Detachment is a property of the SESSION a view is BOUND to, so with no view there is no binding to
   * read and nothing is outside the correspondence — and the clause this drives ("λ view shows a copy —
   * not linked to the program") would otherwise narrate a view that does not exist. `draw()` gives the λ link
   * state the same kind of answer, `'absent'`.
   */
  const detachedPanes = (): DetachedPanes =>
    perLeg((leg) => {
      const views = panes.of(leg).filter((p) => arranged(p.id))
      return {
        views: views.length,
        copies: views.filter((p) => sessions.entryOf(p.slot.binding.session).detached).map((p) => viewTitle(p.id)),
      }
    })

  /**
   * The current compile's link index, and the construct the user has linked.
   *
   * `linkable` IS NOT `index !== null`. An index is from the last compile, so the first keystroke
   * after it shifts every source span it holds; linking is disabled from that keystroke until the
   * next `compiled` lands. Resolving against a stale index is a silently-wrong answer.
   *
   * NOT IN THE REGISTRY. §3.2b asks for an entry owning "its own `LegState`s and its own
   * `SessionClient`", which is what `SessionEntry` holds — and no more. An index is a property of a
   * COMPILE, and §3.3 puts `linkIndex` and `sourceSpan` on no scratch type, so a per-entry
   * `index` would be `null` for every entry that is not the source one. Moving it is therefore not a
   * mechanical change: it changes what the field means, and it belongs to whichever change first gives
   * a session other than the source one a link index.
   */
  let index: LinkIndex | null = null
  let linkable = false
  let link: Pin | null = null
  /**
   * The last link gesture was a click on an rxm instruction with no owner (Plan 7 part 5 spec §6.6, amendment 11): it
   * pinned nothing, and the status line says why until the next gesture, keystroke or compile replaces it. A TM state
   * with no owner does not set it — that click clears the pin silently, which the amendment keeps.
   */
  let ownerless = false
  let gestures = 0

  /**
   * Paint the link status line from `draw()`'s already-resolved link, or `null` when there is nothing
   * to resolve.
   *
   * `l` IS A PARAMETER, NOT A CALL TO `index.linkFor` HERE — `draw()` resolves it once per tick, and the
   * comment where it does (`draw.ts`) says why. `l === null` covers both "nothing is linked" and "linking
   * is stale", but those still report DIFFERENT statuses (`none` vs `stale`), so `linkable` is consulted
   * directly rather than folded into what made `l` null.
   *
   * `here` IS A PARAMETER TOO, for the same reason: `draw()` already resolved each linked leg's
   * running focus against `link` (`isCoincident`) once, and re-deriving it here would need `running`
   * threaded in anyway — passing the booleans it produces is the smaller surface. Meaningless when
   * `l === null` (nothing is pinned to coincide with) or `!linkable` (both return before reading it).
   *
   * `detached` IS ON EVERY ARM, NOT ONLY `'linked'`, and that is §4.5's obligation rather than
   * symmetry: `{state:'none'}` with a detached λ pane is precisely the case where this line goes from
   * blank to speaking. `linkStatus` is the one function that reads the field and it suppresses a
   * detached pane's own clauses itself, so nothing here has to know which clauses those are.
   */
  const drawLink = (l: Link | null, here: Readonly<Record<LinkedLeg, boolean>>, lambda: LambdaLinkState) => {
    const detached = detachedPanes()
    if (!linkable) {
      linkStatusHost.textContent = linkStatus({ state: 'stale', detached })
      return
    }
    if (l === null) {
      linkStatusHost.textContent = linkStatus({ state: ownerless ? 'ownerless' : 'none', detached })
      return
    }
    linkStatusHost.textContent = linkStatus({
      state: 'linked',
      legs: perLinkedLeg((leg) => ({ emits: LINKED[leg].rows(l, link).length > 0, here: here[leg] })),
      lambda,
      detached,
    })
  }

  /**
   * Take a gesture's resolved pin: count the gesture, write the pin and whether its click found no owner, and paint
   * every view: the source editor's mark, and each λ, rxm, TM and CLIF view's.
   *
   * `origin` DRIVES SCROLLING ONLY. A scroll-into-view triggered by the pane the user is already
   * looking at moves the thing under their cursor, so the table scrolls for a source click and not
   * for its own.
   */
  const commitLink = (pin: Pin | null, origin: Pin['origin'], noOwner: boolean) => {
    gestures += 1
    link = pin
    ownerless = noOwner
    paint(origin)
  }

  const setLinkTo = (node: number | null, origin: Exclude<Pin['origin'], InstrLeg>) => {
    commitLink(node === null ? null : { node, origin }, origin, false)
  }

  /**
   * Give every view of every linked leg its rows of `l`. `from` is where the click came from, `null` for no click:
   * a view scrolls to its rows, or, with none there, drops the hold an earlier link's scroll took, only for a click
   * from outside its own leg.
   */
  const fanOut = (l: Link | null, from: Pin['origin'] | null) => {
    // PER-LEG, NOT PER-PANE — every view of a leg follows the same link, resolved once by the caller and fanned out
    // here, HIDDEN ONES INCLUDED. `LINKED`'s `pane` HOLDS THE CAST: `PaneView<T>` is deliberately narrow and does not
    // carry `setLink`, which is a fact about the concrete view classes. A click that came from a view's own leg
    // must not scroll the table it was just clicked in out from under the cursor; a click
    // from elsewhere should bring the state block or the construct's first instruction (spec §6.6) into view — or, when
    // the pin names no row there, let the view follow the run again rather than stay held on the block an earlier link
    // scrolled to.
    //
    // **NOT SKIPPED FOR A HIDDEN PANE, UNLIKE `draw()`'S OWN RENDER LOOP.** A pane that saw the last
    // compile is not in `replies.ts`'s `unseen` set, so `draw()`'s seed block never runs for it —
    // this fan-out is the only place a pin made after that compile reaches it, hidden or not, and
    // skipping a hidden one here would leave it painting whatever pin it had before it was hidden,
    // unable to hear a later one made while it was off the page. A pane that MISSED the compile (in
    // `unseen`) has a stale `#index`, so the states this call resolves against the CURRENT index can
    // name the wrong rows there, or none — but that pane is about to be reseeded before it is next
    // shown, and `draw.ts`'s seed block re-applies the CURRENT pin once it is, so a wrong answer
    // written here never reaches the screen.
    //
    // **A COPY IS NOT LINKED (5d-i design §4.5), so it marks nothing whatever is pinned** — `draw.ts`'s λ guard, for
    // the machine views. `l` holds the PROGRAM's state and instruction indices, and a view showing a copy numbers its
    // rows by the copy, so an index read there names whatever the copy has at it (Plan 7 part 5 spec amendment 32, in
    // the inbound direction). `detached` is the session's own fact, read here because the view's binding moves.
    for (const leg of LINKED_LEGS) {
      const { rows, pane } = LINKED[leg]
      const scrollTo = from !== null && from !== leg
      for (const p of panes.of(leg)) {
        const marked = l === null || sessions.entryOf(p.slot.binding.session).detached ? [] : rows(l, link)
        pane(p).setLink(marked, scrollTo)
      }
    }
  }

  /**
   * Draw `link` everywhere it is drawn; `from` is where the click came from, `null` when no click made this paint, and
   * says which views `fanOut` scrolls.
   */
  const paint = (from: Pin['origin'] | null) => {
    const node = link?.node ?? null
    // ONE `linkFor` CALL, reused for the source editor's mark and the fan-out below — the comment where `draw()`
    // resolves its own link (`draw.ts`) says why a `linkFor` call is not free.
    const l = node === null || index === null ? null : index.linkFor(node)
    view().dispatch({ effects: setLink.of(l?.source ?? null) })
    // `draw()` CALLS `drawLink()` itself, after its render loop and before its readout pass. `link` is
    // already set above, so this single call sees the new value; a separate `drawLink()` call here would
    // be the same read twice.
    //
    // THE ORDER BETWEEN THIS CALL AND THE TM FAN-OUT'S `setLink` DOES NOT MATTER FOR EVERY *LATER* DRAW OF THE
    // SAME FRAME — IT DOES FOR THIS ONE. `draw()` calls `PaneSlot.render(...)` on every tm-kind pane, which sets
    // `TmPane`'s own `#frame` to this tick's frame and runs `#drawTable` — this call's own pass draws with
    // nothing pending yet. The fan-out below is what arms the link's scroll and draws it, and once armed that
    // scroll holds the box through every later draw of the SAME FRAME, whichever of the two ran first
    // (`VirtualGrid.scrollToRow`, 5b design §5.1, Plan 7 part 5 spec amendment 21). THE ORDER HERE STAYS
    // DRAW-THEN-FAN-OUT: if the fan-out ever armed the hold before this call updated `#frame` to the current
    // tick's, it would be keyed on a frame the pane had not yet drawn, and the very next draw — this tick's own —
    // would read a different `rows.frame` and release it at once. A view off the page, or with its grid's panel
    // closed, arms nothing here at all: its grid keeps the link's row until the draw that shows it, and holds
    // against the frame that draw shows (`scrollToRow`). A view that missed the compile drops that row when it is
    // seeded, and `draw.ts`'s seed gives it the pin again, with this scroll, after the render that shows it.
    const before = linkStatusHost.textContent ?? ''
    draw()
    // ANNOUNCED HERE AND NOWHERE ELSE (spec §11): this runs for a link gesture — a source click or `Mod-'`, a λ
    // token, a rule row — and for a user's clear, `unpin`. `draw()` just wrote the sentence; a keystroke reaches
    // `drawLink` through `draw()` alone and says nothing.
    //
    // **WHAT CHANGED IS MEASURED AGAINST THE LINE, NOT AGAINST THE LAST THING ANNOUNCED.** A memo of the
    // last announcement goes stale the moment anything else writes the line — and something does, on
    // every keystroke: the source editor's `updateListener` clears the link, so the line reads "linking
    // resumes when this compiles" and then empties when the compile lands, both unannounced and
    // correctly so. With a memo, clicking the same construct again after an edit would produce the same
    // sentence as last time and so be silent, though the line had just changed from nothing to that
    // sentence — which is the accessibility item this announcement exists to close.
    const sentence = linkStatusHost.textContent ?? ''
    if (sentence !== before) announce(sentence)
    fanOut(l, from)
  }

  /** Link at a byte offset into the source document, or clear if nothing contains it. */
  const linkAtSourceOffset = (byteOffset: number) => {
    if (!linkable || index === null) return
    setLinkTo(index.nodeAtSource(byteOffset), 'source')
  }

  /**
   * Link the construct that owns an rxm instruction, or clear and say why if none does; for a row lowered from no
   * instruction, clear and say nothing.
   */
  const linkInstr = (pc: number | null, origin: InstrLeg) => {
    if (!linkable || index === null) return
    // A ROW WITH NO INSTRUCTION HAS NO OWNER TO MISS: the ownerless sentence names an instruction, and there is none.
    if (pc === null) {
      commitLink(null, origin, false)
      return
    }
    const pin = pinAtInstr(index, pc, origin)
    // AN RXM INSTRUCTION THAT RESOLVED TO NO CONSTRUCT IS THE ONE CLICK THE LINE EXPLAINS (Plan 7 part 5 spec
    // amendment 11); any other gesture, a resolved rxm click included, replaces that explanation.
    commitLink(pin, origin, pin === null)
  }

  return {
    setIndex(newIndex: LinkIndex | null): void {
      index = newIndex
      linkable = index !== null
      link = null
      ownerless = false
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
      ownerless = false
      fanOut(null, null)
    },
    unpin(): void {
      // LINKING OFF IS NOTHING PINNED TOO: `clearLink` and `setIndex` empty both, and every link gesture asks
      // `linkable` first. So this one test leaves an edit's state alone as well.
      if (link === null && !ownerless) return
      link = null
      ownerless = false
      // SCROLLED NEITHER WAY: a rule table or rxm listing a link scrolled keeps the hold that scroll took
      // (`VirtualGrid.scrollToRow`), so nothing moves on the clear and the list follows the run again at its next step.
      // Dropping the hold would send it back to the run's row at once, which can be far.
      paint(null)
    },
    get gestures(): number {
      return gestures
    },
    drawLink,
    setLinkTo,
    linkInstr,
    linkAtSourceOffset,
    detachedPanes,
  }
}
