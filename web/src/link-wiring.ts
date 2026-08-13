import type { EditorView } from '@codemirror/view'
import { setLink } from './highlight'
import { type LambdaWindow, LINK_CONTEXT, lambdaWindow } from './lambda-window'
import type { Link, LinkIndex, Pin } from './link'
import { type DetachedPanes, type LambdaLinkState, linkStatus } from './link-status'
import type { PaneCollection } from './panes'
import type { PaneSlot, SessionRegistry } from './sessions'
import type { TmPane } from './tm-pane'
import type { Span } from './types'

/**
 * THE LINK STATE AND EVERYTHING THAT READS IT — the cluster `main.ts` held as four `let`s visible to a
 * thousand lines.
 *
 * `index`, `linkable`, `link` and `forkFailed` are one fact in four variables: what the current
 * compile's link index is, whether it exists, what is pinned, and why a fork was refused. Nothing
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
   * THE ONE STATE FIELD WITH A READ ACCESSOR AS WELL AS A WRITER, unlike `linkable`/`link`/`forkFailed`
   * below, which are only ever read through the narrower questions the other accessors answer.
   * `draw.ts` and the click handlers `transport.ts`'s `events(...)` builds resolve nodes straight
   * through the index (`index.linkFor`, `index.nodeForState`, `index.nodeAtLambda`, `index.lambdaText`)
   * for the same per-frame cost reasons `draw()`'s own comments give for resolving a `Link` once and
   * sharing it — wrapping every one of those call sites in a forwarding method here would be a second
   * name for the same call, not an encapsulation of it.
   *
   * **HANDING THE INDEX OUT LEAKS NO AUTHORITY, AND THAT IS A PROPERTY OF `LinkIndex` RATHER THAN OF
   * WHO HAPPENS TO CALL THIS.** This doc used to rest its case on where the callers lived — "`main.ts`'s
   * `draw()` and the click handlers" — an argument that dissolved the moment `draw` and `events` moved
   * into modules of their own, without the conclusion changing at all. The real reason is that
   * `LinkIndex` (`link.ts`) exposes NOTHING that can change it: `lambdaText` and `lambdaCut` are
   * `readonly`, every method (`nodeAtSource`, `nodeAtLambda`, `nodeForState`, `linkFor`) is a pure read,
   * and the wire arrays it reads them out of are `#`-private. The one write anywhere in the class is
   * `lambdaSpans`' own memo of a value it just derived — a cache, not a state a caller can set. So a
   * holder of this reference can ask it questions and nothing else, whoever they are and wherever they
   * live. WRITES to the FIELD stay confined to this module (`setIndex` is the only one); this getter is
   * what keeps reads legitimate everywhere else.
   */
  get index(): LinkIndex | null
  get linkable(): boolean
  get link(): Pin | null
  clearLink(): void
  setForkFailed(reason: string | null): void
  get forkFailed(): string | null
  lambdaLinkState(lambdaSpan: Span | null): LambdaLinkState
  lambdaLinkWindow(l: Link | null): LambdaWindow | null
  drawLink(l: Link | null, focusCoincident: boolean): void
  setLinkTo(node: number | null, origin: 'source' | 'lambda' | 'tm'): void
  linkAtSourceOffset(byteOffset: number): void
}

export function createLinkWiring(deps: {
  view: () => EditorView
  statusHost: HTMLElement
  sessions: SessionRegistry
  panes: PaneCollection
  draw: () => void
}): LinkWiring {
  const { view, sessions, panes, draw } = deps
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
   * closing the one λ pane a fresh page ships is an ordinary gesture, and this module is reached from
   * it independently of `draw.ts`: `drawLink` -> `detachedPanes` -> `theTmSlot` fires from the source
   * editor's `updateListener` on every keystroke. `PaneCollection.active` is the one place that answers
   * the question now — the pane the user last focused on that leg, falling back to insertion order when
   * none is marked or the mark no longer resolves (5d-ii-b) — and its own doc has the argument for why
   * all four consumers were once carrying a private copy of the same expired invariant.
   *
   * THE THREE READERS BELOW GIVE HONEST ANSWERS FOR ABSENCE RATHER THAN PROPAGATING IT: a pane that
   * does not exist is not detached, has no link window, and contributes no λ link state.
   */
  const theLambdaSlot = (): PaneSlot<'lambda'> | undefined => panes.active('lambda')?.slot
  const theTmSlot = (): PaneSlot<'tm'> | undefined => panes.active('tm')?.slot

  /**
   * Which panes are outside the source correspondence right now — §4.5's first surface, read off the
   * bindings.
   *
   * TWO LOOKUPS RATHER THAN A FLAG, and that is what makes §4.5's pairing cheap: detachment is a
   * property of the SESSION (`SessionEntry.detached`), so a pane is detached exactly when the session
   * it is bound to is, and both surfaces — this sentence and the pane's own `[detached]` badge, which
   * `PaneSlot.render` sets from the same field — cannot disagree.
   *
   * §5 OWED THE JOINT CASE TO "THE TASK THAT WIRES `main.ts`", which is this one: T6 shipped both
   * surfaces with no binding to drive them, and this is the call that drives them.
   *
   * A LEG WITH NO PANE READS `false`, WHICH IS THE HONEST ANSWER RATHER THAN A CONVENIENT ONE.
   * Detachment is a property of the SESSION a pane is BOUND to, so with no pane there is no binding to
   * read and nothing is outside the correspondence — and the clause this drives ("λ pane detached —
   * not linked to source") would otherwise narrate a pane the user is not looking at.
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
   * The most recent fork attempt's failure, or `null` — CRITICAL finding, plan 5d-iii's ninth task.
   * `link-status.ts`'s `forkFailed` field is what this feeds; see that field's own doc for why
   * `#link-status` is the surface and not the pane `onScratchReply`'s `no-session` arm was trying to
   * reach.
   *
   * CLEARED WHEN A FORK SUCCEEDS (`events(...)`'s `detach` handler) AND ON THE NEXT SOURCE KEYSTROKE
   * (`schedule`), NOT LEFT TO ACCUMULATE. Neither event means the message stopped being true — it means
   * it stopped being NEWS: a stale failure from three edits ago sitting on the one line design §4.5
   * already uses for live, current-tick narration would be the same silent-wrongness standard this file
   * refuses everywhere else (`draw()`'s own comments), just aimed at a message instead of a highlight.
   *
   * **THAT SENTENCE SAID "ON THE NEXT FORK ATTEMPT", AND 5d-ii-c's CAP MADE THE DIFFERENCE VISIBLE.**
   * The clear ran AHEAD of `ScratchBuffers.fork` while a fork could only fail later, on a reply — every
   * attempt that got that far was pending, so clearing and waiting said something true. `MAX_BUFFERS`
   * (design §4.5) gave a fork a way to be refused on the spot, and a refused attempt must not clear the
   * previous failure first: this is a pure state write with no repaint, so between the clear and the
   * handler's `catch` the model would hold `null` while `#link-status` still showed the old message. The
   * refused arm OVERWRITES instead, which is the same "stopped being news" rule with no window in it.
   */
  let forkFailed: string | null = null

  /**
   * Which λ state the link is in — the three-way distinction `link-status.ts` exists to keep apart.
   *
   * ORDERED MOST-GLOBAL FIRST. A declined backend makes the other two questions meaningless, and a
   * play head off step 0 makes truncation irrelevant, so asking in this order never reports a
   * narrower reason than the true one.
   *
   * `lambdaSpan` IS PASSED IN RATHER THAN RE-DERIVED. The caller (`drawLink`) is itself handed the
   * already-resolved `Link` that `draw()` computed once and shares with `lambdaLinkWindow` too — see
   * `draw()`'s doc. Re-deriving it here would walk `#spanOf`/`#statesOf` over the wire's parallel
   * arrays again, on every recorded frame during playback.
   *
   * AN ABSENT SPAN IS ONLY `'truncated'` WHEN `index.lambdaCut` SAYS SO. `lambdaSpan === null`
   * is ambiguous by itself — it also fires for a node `LinkIndex.lambda_nodes` never carried a span
   * for at all, which is not a byte-budget frontier — so reporting `'truncated'` unconditionally would
   * be checkably false whenever the absence has some other cause. `'unmapped'` is the honest answer
   * for that other case.
   *
   * `'absent'` LEADS, AHEAD OF `'declined'`, AND THE "most-global first" RULE ABOVE DOES NOT SETTLE
   * THAT BY ITSELF — `'declined'` is a fact about the PROGRAM and is therefore the more global of the
   * two. It is ordered this way on `link-status.ts`'s own uniform-suppression argument instead: every
   * member of this union, `'declined'` included, is read as an explanation of the λ term on screen,
   * and with no λ pane there is no term on screen for any of them to explain. The same standard that
   * suppresses all five under a DETACHED λ pane, applied one step earlier.
   */
  const lambdaLinkState = (lambdaSpan: Span | null): LambdaLinkState => {
    const slot = theLambdaSlot()
    if (slot === undefined) return 'absent'
    if (index === null || index.lambdaText === '') return 'declined'
    if (slot.resolve(sessions).hist.currentStep !== 0) return 'not-step-0'
    if (lambdaSpan !== null) return 'shown'
    return index.lambdaCut !== null ? 'truncated' : 'unmapped'
  }

  /**
   * Paint the link status line from `draw()`'s already-resolved link, or `null` when there is nothing
   * to resolve.
   *
   * `l` IS A PARAMETER, NOT A CALL TO `index.linkFor` HERE — `draw()` resolves it once per tick and
   * shares it with `lambdaLinkWindow` too; see `draw()`'s doc. `l === null` covers both "nothing is
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
  const drawLink = (l: Link | null, focusCoincident: boolean) => {
    const detached = detachedPanes()
    // SPREAD, NOT ASSIGNED `undefined` — the same `exactOptionalPropertyTypes` idiom `events(...)`
    // already uses for `detach`/`editScratch`/`linkState`/`linkLambda` below: `LinkStatus.forkFailed`
    // is optional, and `{ forkFailed: undefined }` does not satisfy an optional property under that
    // flag.
    const failed = forkFailed === null ? {} : { forkFailed }
    if (!linkable) {
      linkStatusHost.textContent = linkStatus({ state: 'stale', detached, ...failed })
      return
    }
    if (l === null) {
      linkStatusHost.textContent = linkStatus({ state: 'none', detached, ...failed })
      return
    }
    linkStatusHost.textContent = linkStatus({
      state: 'linked',
      tm: l.states.length > 0,
      lambda: lambdaLinkState(l.lambda),
      focus: focusCoincident,
      detached,
      ...failed,
    })
  }

  /**
   * The λ pane's link view, or `null` when there is nothing to show.
   *
   * GATED ON THE λ PANE'S OWN LEG BEING AT STEP 0, and only on that leg's head — resolved through the
   * λ slot for the same reason `draw()` does. A session holds two independent histories with two
   * heads; the TM leg runs at wildly different step counts (the `map` demo is 344,999 δ-steps against
   * a few hundred β-steps), so gating on a shared condition would make the λ link vanish almost
   * immediately for reasons that have nothing to do with λ.
   *
   * AND GATED ON THE PANE BEING ATTACHED, which is the same standard §5 applies to the status line's
   * clauses, applied to the pane BODY where it bites harder. `index` describes the SOURCE session's
   * step-0 term; a detached λ pane is showing a scratch's term, so painting this window would replace
   * what the user is looking at with a different program's text and highlight a construct inside it.
   * `linkStatus` suppresses the sentence about a term that is not on screen; this suppresses putting
   * that term on screen.
   *
   * `l` IS `draw()`'S RESOLUTION, PASSED IN — the same one `drawLink` got. A second
   * `index.linkFor(link.node)` call here for the same node in the same tick is exactly the double
   * resolution `draw()`'s doc describes fixing; `index` is still read directly below for `lambdaText`/
   * `lambdaSpans`, which are not part of `Link` and were never duplicated.
   */
  const lambdaLinkWindow = (l: Link | null): LambdaWindow | null => {
    if (l === null || index === null) return null
    // NO λ PANE MEANS NO WINDOW, and there is nothing weaker to say: this value is handed to
    // `LambdaPane.renderLink` by `draw()`'s own fan-out over `panes.of('lambda')`, which iterates
    // nothing when the leg is empty. RESOLVED ONCE INTO A LOCAL rather than called for each of the two
    // guards below, which is what the two `theLambdaSlot()` calls this replaced were doing.
    const slot = theLambdaSlot()
    if (slot === undefined) return null
    if (sessions.entryOf(slot.binding.session).detached) return null
    if (slot.resolve(sessions).hist.currentStep !== 0) return null
    const span = l.lambda
    if (span === null) return null
    return lambdaWindow(index.lambdaText, index.lambdaSpans, span, LINK_CONTEXT)
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
    draw()
    // PER-LEG, NOT PER-PANE — every TM pane follows the same link, resolved once above and fanned out
    // here. `p.pane` NEEDS THE CAST for the reason `draw.ts`'s identical loop documents: `PaneView<T>`
    // is deliberately narrow and does not carry `setLink`, which is a fact about the concrete `TmPane`
    // class. `scrollTo` is `origin !== 'tm'`: a click that came from the table itself must not scroll
    // the table it was just clicked in out from under the cursor; a click from source or λ should
    // bring the state block into view.
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
    setForkFailed(reason: string | null): void {
      forkFailed = reason
    },
    get forkFailed(): string | null {
      return forkFailed
    },
    lambdaLinkState,
    lambdaLinkWindow,
    drawLink,
    setLinkTo,
    linkAtSourceOffset,
  }
}
