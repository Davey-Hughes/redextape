import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lintGutter } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import init, { analyze, classifySource, encodings, tokenClasses } from '../../pkg/redextape_wasm.js'
import { APPEARANCE_LABEL, applyAppearance, nextAppearance, readStored, STORAGE_KEY } from './appearance'
import { showBanner, showWorkerError } from './banner'
import { canRecordFurther } from './controls'
import { declineMark, focusMark, highlighting, linkMark, setDecline, setFocus, setLink, setSpans } from './highlight'
import { History } from './history'
import { LambdaPane } from './lambda-pane'
import type { LambdaWindow } from './lambda-window'
import { LINK_CONTEXT, lambdaWindow } from './lambda-window'
import { isCoincident, type Link, LinkIndex, type Pin, runningFocus, sourceNodeOwner } from './link'
import { type DetachedPanes, type LambdaLinkState, linkStatus } from './link-status'
import { lintFromAnalyze } from './lint'
import type { Leg, RunReply } from './protocol'
import { HISTORY_BYTES, lambdaFrameBytes, tmFrameBytes } from './protocol'
import type { Row } from './results'
import { noSessionRows, resultRows } from './results'
import { LambdaScratchpad } from './scratch'
import { type SessionId, SessionPool } from './session-client'
import { type LegState, PaneSlot, resetLegs, SessionRegistry } from './sessions'
import { TmPane } from './tm-pane'
import type { Classified, Diagnostic, LambdaState, Span, TmState } from './types'
import { assertTokenClasses } from './types'

const DEBOUNCE_MS = 300
const SAMPLE = 'let x = 40; x + 2'
/**
 * Milliseconds between frames during playback (120 ms ≈ 8 fps). A main-thread `setInterval` walk over
 * recorded frames — it never touches wasm, which is the whole reason the history lives on this side.
 */
const PLAY_MS = 120

function renderRows(host: HTMLElement, rows: Row[]): void {
  host.replaceChildren(
    ...rows.map((r) => {
      const el = document.createElement('div')
      el.className = 'row'
      const leg = document.createElement('span')
      leg.className = 'leg'
      leg.textContent = r.leg
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = r.label
      const value = document.createElement('span')
      value.className = 'value'
      value.textContent = r.value
      if (r.note) {
        const note = document.createElement('div')
        note.className = 'note'
        note.textContent = r.note
        value.append(note)
      }
      el.append(leg, label, value)
      return el
    }),
  )
}

async function main(): Promise<EditorView> {
  const results = document.querySelector<HTMLElement>('#results')
  const editorHost = document.querySelector<HTMLElement>('#editor')
  const lambdaHost = document.querySelector<HTMLElement>('#lambda')
  const tmHost = document.querySelector<HTMLElement>('#tm')
  const linkStatusHost = document.querySelector<HTMLElement>('#link-status')
  const picker = document.querySelector<HTMLSelectElement>('#encoding')
  const appearanceButton = document.querySelector<HTMLButtonElement>('#appearance')
  const root = document.querySelector<HTMLElement>('main')
  if (!results || !editorHost || !lambdaHost || !tmHost || !linkStatusHost || !picker || !appearanceButton || !root) {
    throw new Error('the page is missing a mount point')
  }

  // Wired BEFORE `init()`, unlike everything below it. The toggle has nothing to do with wasm — it
  // reads and writes `localStorage` and flips an attribute on `<html>` — so it stays live even on the
  // one failure path (`showBanner` below) that replaces `<main>` and leaves the header bar standing.
  //
  // `localStorage` ACCESS IS GUARDED, same as `index.html`'s inline script and for the same reason:
  // it throws in some privacy modes. Unguarded here it would be worse than in that script, not the
  // same — this runs before the `init()` try/catch below, so an uncaught throw would reject `ready`
  // itself and blank the page before any banner could report why.
  const readAppearanceStorage = (): string | null => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  }
  const writeAppearanceStorage = (a: string): void => {
    try {
      localStorage.setItem(STORAGE_KEY, a)
    } catch {
      // Nothing to do — the toggle still works for the rest of this page load, it just will not
      // survive a reload. The same tradeoff the inline script in `index.html` makes.
    }
  }

  let appearance = readStored(readAppearanceStorage())
  const relabelAppearance = () => {
    const { glyph, label } = APPEARANCE_LABEL[appearance]
    appearanceButton.textContent = glyph
    appearanceButton.setAttribute('aria-label', label)
  }
  applyAppearance(document.documentElement, appearance)
  relabelAppearance()
  appearanceButton.addEventListener('click', () => {
    appearance = nextAppearance(appearance)
    applyAppearance(document.documentElement, appearance)
    writeAppearanceStorage(appearance)
    relabelAppearance()
  })

  // THE ONE PLACE THE APP CAN FAIL TO START. `init()` fetches the wasm; a worker constructed against
  // a missing module fails the same way. PR 3c had no surface for either and the failure was a blank
  // page.
  try {
    await init()
  } catch (e) {
    showBanner(root, e)
    throw e
  }

  // Checked once, here, immediately after the module is live. See `assertTokenClasses`.
  assertTokenClasses(tokenClasses() as string[])

  for (const name of encodings() as string[]) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    picker.append(opt)
  }

  let view: EditorView

  /**
   * THE SESSION REGISTRY — the container design §3.2b says decision 1 presupposes.
   *
   * IT IS A `SessionRegistry` FROM `sessions.ts` NOW, NOT A `Map` DECLARED HERE, and the move is what
   * this task's test costs rather than a tidy-up. T7's claim is that two panes bound to two different
   * λ sessions show two different terms at the same time, and nothing in this slice can put a second
   * session in this registry: a `LambdaScratch` needs a worker message `session-worker.ts` does not
   * have, and creating one on edit is §4.3, which is T8. A registry that is a module is a registry a
   * test can put two sessions in. `SessionRegistry`'s own doc carries the argument in full.
   *
   * **T8 HAS LANDED AND THE APP CAN NOW HOLD TWO, WHICH RETIRES THE SECOND HALF OF THE PARAGRAPH
   * ABOVE BUT NOT THE FIRST.** The λ pane's fork control registers a second entry (`scratchpad`
   * below, `scratch.ts`), so the selector this app draws is no longer hypothetical. The reason the
   * registry is a module survives it: the singleton must be asserted on POOL SIZE, which is not
   * reachable from the DOM, and this app has ONE λ pane — so "two panes on two λ sessions" still
   * cannot be performed here, whatever the registry can hold.
   */
  const sessions = new SessionRegistry()

  /**
   * The session compiled from the editor's text — the only one that exists today, and the only one
   * that will ever have a `SourceMap` behind it (§3.3: `linkIndex` and `sourceSpan` exist on neither
   * scratch type).
   */
  const SOURCE_SESSION: SessionId = 'source'

  /**
   * The one λ scratchpad — design §4.3's singleton, named here for the reason `SessionEntry.label`'s
   * doc gives: `main.ts` names the app's sessions, `sessions.ts` and `scratch.ts` never do.
   *
   * THE LABEL IS WHAT THE BINDING SELECTOR PUTS IN FRONT OF A USER, so it is words rather than the id
   * — `tests/browser/binding-selector.test.ts` already asserts the options are told apart by their
   * labels and not by colour or position (§6).
   */
  const LAMBDA_SCRATCH: SessionId = 'lambda-scratch'
  const LAMBDA_SCRATCH_LABEL = 'λ scratchpad'

  /**
   * What the two panes are bound to, and the only writers of a `Binding` in the app.
   *
   * `PaneSlot`s NOW, AND `let` DID NOT BECOME THE ANSWER. T4 left these as `const` bindings and said
   * "the task that adds the binding selector is the one that makes these mutable" — a reassignable
   * local would have been the smaller diff and it is the wrong shape, because a pane's handlers are
   * wired once at mount and would then close over whichever `Binding` value was current AT MOUNT.
   * `events(...)` below takes the SLOT and reads `slot.binding` inside each handler, so a rebind is
   * seen by handlers that were built before it happened. The slot is also where the leg is pinned:
   * `rebind` takes a `SessionId` and there is no writer for the leg, which is what keeps `Binding<K>`
   * a type-level fact (see `PaneSlot`'s doc for the constraint and for what it gives up).
   */
  const lambdaSlot = new PaneSlot('lambda', SOURCE_SESSION)
  const tmSlot = new PaneSlot('tm', SOURCE_SESSION)

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
   */
  const detachedPanes = (): DetachedPanes => ({
    lambda: sessions.entryOf(lambdaSlot.binding.session).detached,
    tm: sessions.entryOf(tmSlot.binding.session).detached,
  })

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
   * CLEARED ON THE NEXT FORK ATTEMPT (`events(...)`'s `detach` handler) AND ON THE NEXT SOURCE
   * KEYSTROKE (`schedule`), NOT LEFT TO ACCUMULATE. Neither event means the message stopped being
   * true — it means it stopped being NEWS: a stale failure from three edits ago sitting on the one
   * line design §4.5 already uses for live, current-tick narration would be the same silent-wrongness
   * standard this file refuses everywhere else (`draw()`'s own comments), just aimed at a message
   * instead of a highlight.
   */
  let forkFailed: string | null = null

  const draw = () => {
    // RESOLVED THROUGH THE PANES' BINDINGS, NOT CLOSED OVER. This is the read path: `lam` and `tm`
    // used to be two `const`s in the enclosing scope, so this function rendered whatever was lexically
    // in scope and a pane could not be pointed anywhere else (§3.2b). They are now two resolutions
    // through the slots, and every read below keeps its exact spelling — the names still mean "the leg
    // the λ pane shows" and "the leg the TM pane shows"; WHICH leg that is is a fact about the
    // registry and the slot's binding, not about this closure.
    //
    // ONCE PER FRAME, NOT ONCE PER READ, AND `PaneSlot.render` TAKES THE RESULT RATHER THAN RESOLVING
    // AGAIN. `draw()` runs on every recorded frame during playback, so resolving at each read would
    // put a `Map.get` on the per-frame path for nothing. Safe because nothing between here and the end
    // of this function can rebind a pane: every call below is a pane render, a `view.dispatch` of a
    // decoration effect, or an `index` read, and none of them writes the registry or a slot.
    const lam = lambdaSlot.resolve(sessions)
    const tm = tmSlot.resolve(sessions)
    // THE CONTROL STRIP, THE SELECTOR AND THE `[detached]` BADGE ALL MOVED INTO `PaneSlot.render`,
    // because all three are functions of the binding and of the registry and none of them is a
    // function of anything else in this closure. Keeping the `controlState(...)` block here would have
    // meant the test that drives two slots over two sessions had to re-implement it, and a test that
    // re-implements the thing it is testing does not test it.
    lambdaSlot.render(sessions, lambdaPane, lam)
    // THE TM LEG'S OWN RUNNING FOCUS — `TmState.source_node`, NOT `lam.hist.current?.owner` below.
    // Design table (`2026-08-10-plan5c-dual-focus-design.md` §4.2): "TM: TmState.source_node,
    // resolved through SourceMap::tm_owner ... none; shipped 2026-07-30." Each pane reports what ITS
    // OWN leg is doing right now — the two clocks never synchronize (§0: `map_fold` is 555 β-steps
    // against 266,863 δ-steps), so feeding the δ-table from the λ leg's owner would show it whatever
    // the OTHER model was doing, not its own. `sourceNodeOwner` wraps the already-resolved node id as
    // an `Owner` so it goes through the same `runningFocus` every other leg does.
    //
    // RESOLVED AND HANDED OVER BEFORE `tmPane.render`, NOT AFTER — ONE `#drawTable` PER FRAME, NOT TWO.
    // `render` draws unconditionally and `TmPane.setFocus` is a pure setter (see its doc), so this
    // order lets the one draw paint both layers. Reversed, the render pass would build every row
    // against the PREVIOUS frame's focus and a second pass would immediately rebuild them — ~40
    // elements created and discarded on every recorded frame of playback, which is a larger per-frame
    // cost than the duplicate `index.linkFor` the comment below refuses. Nothing here reads anything
    // `render` writes: `runningFocus` wants `linkable`/`index`/`tm.hist`, none of which it touches.
    const tmFocus =
      linkable && index !== null ? runningFocus(index, sourceNodeOwner(tm.hist.current?.source_node ?? null)) : null
    const tmFocusLink: Link | null = tmFocus !== null && index !== null ? index.linkFor(tmFocus.node) : null
    // NO SCROLL ARGUMENT — `TmPane.setFocus`'s own doc says why: the running focus is not a gesture,
    // and scrolling to it on every δ-step would fight `Follow`'s own scroll for the CURRENT row.
    tmPane.setFocus(tmFocusLink?.states ?? [])
    tmSlot.render(sessions, tmPane, tm)
    // EVERY RE-RENDER REFRESHES THE STATUS LINE, NOT JUST THE PANES THEMSELVES. `drawLink` reads
    // `lam.hist.currentStep` (via `lambdaLinkState`), and `back`/`forward`/`play`/`restart`/history
    // scrubbing all route through this function without calling `drawLink` on their own — so its call,
    // now at the true end of this function (see the comment there), has to run AFTER the history
    // mutation those callers already made before calling `draw()`. A copy anywhere earlier in this
    // function would still be reading the PREVIOUS step.
    //
    // RESOLVED ONCE, HERE, AND SHARED BY BOTH CONSUMERS BELOW. `draw()` runs on every recorded frame
    // during playback, and `index.linkFor` walks `#spanOf`/`#statesOf` over the wire's parallel
    // arrays — not free. `drawLink` wants `states.length > 0` and the λ span (to tell `truncated` from
    // `shown`); `lambdaLinkWindow` wants only the λ span. A separate `index.linkFor(link.node)` call in
    // each would resolve the SAME node twice on every tick — exactly the double resolution an earlier
    // fix pass on this branch removed from `drawLink` alone, before `lambdaLinkWindow` reintroduced the
    // second call here.
    const l: Link | null = linkable && link !== null && index !== null ? index.linkFor(link.node) : null
    // SAME REASON AS `drawLink()` BELOW, AND NOT ONLY IN `setLinkTo`: scrubbing the λ history must
    // withdraw the window without a click, and every stepping control routes through `draw()` rather
    // than through `setLinkTo`.
    lambdaPane.renderLink(lambdaLinkWindow(l))
    // THE RUNNING FOCUS: a SECOND, INDEPENDENT layer from `l`/`link` above, computed here rather than
    // fed by `l` — `link` is the pin a click set, `focus` is the marker that moves every β-step, and
    // `runningFocus` deliberately knows nothing about `link` (see its own doc). GATED ON `linkable`,
    // NOT ONLY `index !== null` — the same distinction `linkAtSourceOffset` already draws: `index` can
    // be non-null and still stale (see `linkable`'s own doc above), and `runningFocus` only ever sees
    // `null` for the case where `index` itself is null.
    const focus = linkable && index !== null ? runningFocus(index, lam.hist.current?.owner ?? 'None') : null
    // ONE MORE `linkFor` CALL, ACCEPTED RATHER THAN AVOIDED — `runningFocus` already resolved (and
    // discarded) a span internally just to answer "does the index carry this node"; see its own doc for
    // why its return type carries no span for a caller that only wants the claim. This walk is over the
    // same small index `l` above already walks per frame, not the `frame_cost_probe`-scale cost that
    // motivated resolving `l` exactly once and sharing it.
    const focusLink: Link | null = focus !== null && index !== null ? index.linkFor(focus.node) : null
    if (focus === null || focusLink === null || focusLink.source === null) {
      view.dispatch({ effects: setFocus.of(null) })
    } else {
      // THE ONE COINCIDENCE THIS APP EXISTS TO SHOW: the pin and the running focus naming the SAME
      // node. Not two overlapping highlights on one span — its own class (`.is-focus-coincident`,
      // `style.css`), so a user reads "the run just reached what you pinned" as one signal.
      const claim = isCoincident(link, focus) ? 'coincident' : focus.claim
      view.dispatch({ effects: setFocus.of({ span: focusLink.source, claim }) })
    }
    // `drawLink` NOW RUNS HERE, AT THE END, NOT AT THE TOP OF THIS FUNCTION — `link-status.ts`'s
    // SECOND job needs `tmFocus` (resolved above `tmPane.render`) to answer whether it coincides with
    // the pin. Still "at the end" in the sense the original comment meant: everything above it is a
    // `history`/`index` read, nothing below reads `drawLink`'s output.
    drawLink(l, isCoincident(link, tmFocus))
  }

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
   */
  const lambdaLinkState = (lambdaSpan: Span | null): LambdaLinkState => {
    if (index === null || index.lambdaText === '') return 'declined'
    if (lambdaSlot.resolve(sessions).hist.currentStep !== 0) return 'not-step-0'
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
    if (sessions.entryOf(lambdaSlot.binding.session).detached) return null
    if (lambdaSlot.resolve(sessions).hist.currentStep !== 0) return null
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
    view.dispatch({ effects: setLink.of(l?.source ?? null) })
    // `draw()` NOW CALLS `drawLink()` itself, at its end — see that function's doc. `link` is already
    // set above, so this single call sees the new value; a separate `drawLink()` call here would be
    // the same read twice.
    //
    // CALLED BEFORE `tmPane.setLink`, NOT AFTER — ORDER IS LOAD-BEARING. `draw()` calls
    // `tmPane.render(...)`, which runs `TmPane`'s `#drawTable` UNCONDITIONALLY on every call, following
    // included. `TmPane.setLink`'s own scroll is a one-shot target `#drawTable` honours for exactly its
    // next call (design §5.1) — so if `draw()` ran AFTER `tmPane.setLink`, its `#drawTable` pass would
    // be the SECOND call since the target was armed, see nothing pending (already consumed), fall back
    // to the follow target, and silently revert the link's scroll in the same synchronous turn the link
    // itself ran in. Calling `draw()` first burns its `#drawTable` pass on the (soon-stale) previous
    // link state — thrown away before the browser ever paints it — so `tmPane.setLink`'s own call is
    // the LAST word and its one-shot target is still armed when it runs.
    draw()
    // `scrollTo` is `origin !== 'tm'`: a click that came from the table itself must not scroll the
    // table it was just clicked in out from under the cursor; a click from source or λ should bring
    // the state block into view.
    tmPane.setLink(l?.states ?? [], origin !== 'tm')
  }

  /** Link at a byte offset into the source document, or clear if nothing contains it. */
  const linkAtSourceOffset = (byteOffset: number) => {
    if (!linkable || index === null) return
    setLinkTo(index.nodeAtSource(byteOffset), 'source')
  }

  /**
   * Playback is an interval over recorded frames and stops at the frontier. It never asks the worker
   * for more — `▶` at the frontier does that, deliberately, so play cannot run away with a cap raise
   * nobody clicked.
   *
   * BACK TO `<T>(leg: LegState<T>)` FROM T4's `(leg: AnyLeg)`, AND THE CONSTRAINT FLIPPED RATHER THAN
   * THE TASTE. T4 changed it because `T` could not be inferred from `SessionLegs[K]` — a DEFERRED
   * indexed access is not syntactically `LegState<T>` (TS2345). This task made `SessionLegs` a mapped
   * type so `legOf` could return an INSTANTIATED `LegState<LegFrame[K]>` for `PaneView<LegFrame[K]>`
   * to consume (see `SessionLegs`'s own doc for why both forms cannot be had at once), and that is
   * exactly the shape `T` infers from — while `AnyLeg`, a union of two instantiations, is now the one
   * that fails. Both spellings say the same thing: this function walks a history and parks a timer,
   * and never looks at a frame. `T` is unused in the body, which is that claim written in the type.
   */
  const play = <T>(leg: LegState<T>) => {
    if (leg.timer !== null) {
      clearInterval(leg.timer)
      leg.timer = null
      return
    }
    leg.timer = setInterval(() => {
      if (!leg.hist.forward()) {
        if (leg.timer !== null) clearInterval(leg.timer)
        leg.timer = null
      }
      draw()
    }, PLAY_MS)
  }

  /**
   * One pane's control handlers, resolved through its slot's binding on every click.
   *
   * TAKES THE SLOT, NOT THE BINDING AND NOT THE `LegState`. Both panes are constructed once, at mount,
   * and keep the handler object they were given for the life of the page — `pane-chrome.ts`'s
   * `controlStrip` wires each `addEventListener` exactly once, in `button()`. A handler that closed
   * over an already-resolved leg would go on driving the leg this pane was bound to AT MOUNT; a
   * handler that closed over a `Binding` VALUE would do the same thing one level up, because `rebind`
   * replaces the binding rather than editing it. The slot is the thing that is still current after a
   * rebind, so the slot is what gets captured and `slot.binding` is read inside each body.
   *
   * `which` IS GONE, and the leg comes from `slot.binding.leg` instead. It was always the same value
   * as the leg of the `LegState` beside it, passed separately only because a `LegState` carries no
   * identity (§3.2b); a binding carries both, so passing them apart is a way for them to disagree.
   */
  const events = <K extends Leg>(slot: PaneSlot<K>) => ({
    back: () => {
      slot.resolve(sessions).hist.back()
      draw()
    },
    forward: () => {
      // At the frontier `▶` means "record one more", which is the same operation as `[continue]`.
      // `canRecordFurther` is `controls.ts`'s call, not re-derived here — see its doc comment.
      const leg = slot.resolve(sessions)
      if (!leg.hist.forward() && canRecordFurther(leg.done)) {
        sessions.entryOf(slot.binding.session).client.extend(slot.binding.leg)
      }
      draw()
    },
    // RESOLVED AT THE CLICK LIKE EVERY OTHER HANDLER HERE, AND THE INTERVAL THEN HOLDS THE LEG IT
    // RESOLVED TO — `play` parks its timer ON that `LegState` (`leg.timer`), which is what makes a
    // second click a stop rather than a second interval.
    //
    // T4 ASKED THIS TASK TO DECIDE WHETHER PLAYBACK FOLLOWS THE PANE OR STAYS WITH THE LEG, AND IT
    // STAYS WITH THE LEG. A play head is a property of a history, and a pane looking away is not the
    // user un-pressing play; more concretely, two slots may now be bound to the same leg, so stopping
    // the timer on rebind would let one pane's selector silently stop the other pane's playback. The
    // interval clears itself at the frontier, so an unwatched run is bounded rather than forever. See
    // `PaneSlot.rebind` for the same decision stated where the rebind happens.
    play: () => play(slot.resolve(sessions)),
    restart: () => {
      slot.resolve(sessions).hist.seek(0)
      draw()
    },
    extend: () => sessions.entryOf(slot.binding.session).client.extend(slot.binding.leg),
    // THE SELECTOR'S PICK. `PaneSlot.rebind` writes the session and nothing else — the leg is fixed by
    // `K` and has no writer anywhere in the app, which is what keeps `Binding<K>`'s type property
    // (see `PaneSlot`'s doc). `draw()` immediately afterwards because a rebind changes what this pane
    // shows, what its `[detached]` badge says, and what the status line narrates, and none of those
    // has another path to the DOM.
    rebind: (session: SessionId) => {
      slot.rebind(session)
      draw()
    },
    // THE FORK — design §4.3, and the handler that finally puts a second session in the registry
    // (T7's own doc names its absence as the reason this slice's tests could not be driven through
    // the app). OMITTED ON THE TM LEG for the reason the two handlers below are, and one more: §4.1's
    // `TmScratch` is built from `.tm` text and nothing in this app holds any — see `scratch.ts`.
    //
    // THE PANE NOW SENDS A STEP, NOT TEXT, AND THIS HANDLER RESOLVES IT — see `PaneEvents.detach`'s
    // doc for why (design §4.1 moved the seed off the frame's own printed text).
    //
    // **THE STOPGAP IS GONE, AND BOTH HALVES OF IT MOVED TOGETHER, NOT ONE.** The old body read
    // `hist.current`'s text — ALREADY reduced to the step on screen — and paired it with a literal
    // `0` ("parse this text and stop"), because forwarding the real step on top of an
    // already-reduced text would have reduced it twice. §4.1's real seed is the other pairing: the
    // SOURCE session's step-0 term AT `LAMBDA_BYTE_BUDGET`, plus the REAL step, so the worker does
    // the one reduction this text has not had yet (`lambdaScratchAt`, T1/T2's wasm boundary). Passing
    // the real step alongside already-reduced text double-applies the reduction; passing `0` with
    // step-0 text forks the wrong term. Both changed in this commit, together, for exactly that
    // reason.
    //
    // `index.lambdaText`, NOT A `compiled` REPLY FIELD — THERE ISN'T ONE TO READ. A `compiled` reply's
    // `lambda` is `LambdaStatus` (`available`/`reason`/`node`/`run`), which carries no term text at
    // all; the shape that DOES carry one, `LambdaLeg` (`state: LambdaState | null`), only ever rides
    // the LATER `result` reply — after the whole run has finished, which is not usable to seed a fork
    // taken mid-run, and `null` outright for a declined leg. `index.lambdaText` is the SOURCE
    // compile's step-0 term printed at `LAMBDA_BYTE_BUDGET` (`session-worker.ts`'s `onRun`:
    // `session.linkIndex(LAMBDA_BYTE_BUDGET)`, built for every session that exists, decline or not),
    // and it is already what `lambdaLinkWindow` above reads for the very same reason (`:405`) — a
    // second name for the one string this file already holds, not a second lookup.
    //
    // `index === null || index.lambdaText === ''` COVERS EVERY CASE A FORK CAN BE CLICKED FROM AND
    // NO OTHERS. `index` is `null` between a keystroke and the next `compiled`/`no-session` reply and
    // for an uncompiled page — but `#refreshDetach` already hides this control whenever the pane's
    // frame is `null`, which a `no-session`/pre-compile leg always is, so this guard is defence
    // against a call this file's own chrome should never produce, not a path a user can reach.
    // `lambdaText === ''` is `lambdaLinkState`'s own spelling of "declined" (`:334`) — a declined leg
    // also renders no frame, so the same defence applies. NEITHER READS THE SLOT'S SESSION: a
    // detached pane's own `#refreshDetach` already refuses (`!this.#detached`), and the only session
    // that is ever NOT detached is `SOURCE_SESSION` — the one `index` describes — so whenever this
    // handler can fire at all, `index` is already describing the right session.
    ...(slot.binding.leg === 'lambda'
      ? {
          detach: (step: number) => {
            if (index === null || index.lambdaText === '') return
            // A FRESH ATTEMPT RETIRES YESTERDAY'S NEWS. `forkFailed` is a report about the LAST click
            // on this control; a new click means the user is trying again, and the stale message would
            // otherwise sit on `#link-status` through a successful fork (nothing on the success path
            // touches it) or, worse, read like it describes THIS attempt when this one has not even
            // answered yet. See `forkFailed`'s own doc for the other clear site.
            forkFailed = null
            scratchpad.detach(slot, index.lambdaText, step)
            // IMMEDIATELY, NOT ON THE SCRATCHPAD'S FIRST REPLY. The rebind has already happened, so
            // this pane's `[detached]` badge, its selector (which gains a second option the instant a
            // second session is registered) and the status line are all stale until something paints
            // — and the first frame is a worker round trip away.
            draw()
          },
          // THE EDIT PATH — design §4.3's second gesture, `LambdaEditor`'s debounced `onEdit` wired
          // through `LambdaPane.setEditor` (`pane-chrome.ts`'s `editScratch` doc). `recompile` REUSES
          // the existing scratch rather than forking a second one — the singleton is `scratch.ts`'s
          // to keep, not this handler's to re-derive — so there is nothing else here to decide.
          //
          // NO `draw()`, UNLIKE `detach` ABOVE, and the asymmetry is the point rather than an
          // oversight. `detach` draws because it REBINDS the slot synchronously — the badge, the
          // selector and the status line are stale the instant the click returns. `recompile` posts a
          // message and changes nothing else synchronously: the pane is already on this session and
          // stays on it (`scratch.ts`'s own doc: "does not rebind and does not touch the registry"),
          // so there is no fact for a draw to catch up on until the worker's `scratch-compiled` reply
          // arrives and `onScratchReply` paints it. Drawing here would be the same waste the source
          // editor's own `updateListener` already declines to pay on every keystroke (`:941-982`).
          editScratch: (src: string) => {
            scratchpad.recompile(src)
          },
        }
      : {}),
    // OMITTED ENTIRELY ON THE λ LEG, not set to `undefined` — `PaneEvents.linkState` is optional
    // under `exactOptionalPropertyTypes`, which distinguishes "absent" from "present and undefined".
    // The λ pane has no table to click.
    //
    // DECIDED FROM THE SLOT'S LEG, ONCE, AT CONSTRUCTION — not per click like the handlers above, and
    // now sound for a second reason as well as the first. Which handlers a pane HAS is a fact about
    // the pane's shape (the λ pane has no δ-table to click), and this object is built once and then
    // held by the pane for the life of the page, so there is no later moment at which a spread could
    // take effect anyway. The second reason is `PaneSlot`'s: a slot's leg cannot change, so a fact
    // decided from it at construction cannot go stale the way one decided from its session would.
    ...(slot.binding.leg === 'tm'
      ? {
          linkState: (stateId: number) => {
            if (!linkable || index === null) return
            setLinkTo(index.nodeForState(stateId), 'tm')
          },
        }
      : {}),
    // OMITTED ENTIRELY ON THE TM LEG, mirroring `linkState` above — `PaneEvents.linkLambda` is
    // optional under `exactOptionalPropertyTypes`, and the TM pane has no λ window to click.
    ...(slot.binding.leg === 'lambda'
      ? {
          linkLambda: (byteOffset: number) => {
            if (!linkable || index === null) return
            setLinkTo(index.nodeAtLambda(byteOffset), 'lambda')
          },
        }
      : {}),
  })

  /**
   * ONE WORKER PER SESSION (design §4.2), AND THE ONLY THING HERE THAT MAY SPAWN OR TERMINATE ONE.
   *
   * THE `worker` LOCAL IS GONE, AND IT WAS THE LAST PIECE OF A SESSION LIVING OUTSIDE ITS ENTRY. The
   * task before this one gave an entry its own legs and its own client but left `main()` holding a
   * `Worker` handle and its `error` listener beside them, because spawning is this task's. A
   * session's thread is now created where its client is and dies where its client does.
   *
   * WHY IT IS WORTH A CLASS AT ALL, since there is still exactly one session: the pool's reason is
   * damage containment, not tidiness. A wasm call that aborts leaves a wasm-bindgen borrow taken and
   * poisons the module permanently, and a worker's print-stack ceiling drops after its first deep
   * print and stays down — both are properties of the THREAD, so one worker holding three sessions
   * shares both. `SessionPool`'s own doc carries the measurements; this call site is just where the
   * policy lands.
   *
   * THE FACTORY IS THIS FILE'S HALF OF THE SPLIT, and it is exactly the two decisions the pool must
   * not make: which module a session's worker runs — `session-worker.ts`, resolved against
   * `import.meta.url` so the bundler rewrites the URL — and what a load failure looks like, which
   * needs `root`. §4.2 puts the pool in `session-client.ts`, and a module with no DOM cannot own the
   * second of those.
   */
  const pool = new SessionPool(() => {
    const worker = new Worker(new URL('./session-worker.ts', import.meta.url), { type: 'module' })
    // THE SECOND HALF OF §6's LOAD-FAILURE ROW, and it is not the same failure as `init()`'s. A worker
    // whose module fails to load does not throw from the constructor — it fires `error` on the handle,
    // asynchronously, and nothing else in this file would ever hear it. Without this the pane sits on
    // "running…" forever, which is the same blank-page problem one layer in.
    worker.addEventListener('error', (e) => showBanner(root, e instanceof ErrorEvent ? (e.error ?? e.message) : e))
    return worker
  })

  /**
   * THE λ SCRATCHPAD — design §4.3's fork, and the thing that makes a second session reachable.
   *
   * ONE OBJECT RATHER THAN A `detach`/`retire` PAIR OF CLOSURES HERE, and the reason is the test the
   * plan names: the singleton claim has to be asserted on POOL SIZE, which is not reachable from the
   * DOM, and this app has ONE λ pane so "two source-derived λ panes edited in turn" cannot be
   * performed through it at all. `scratch.ts` is a module a test can drive with two slots and fake
   * ports; this line is the app taking the same object.
   *
   * THE REPLY HANDLER IS THE SCRATCHPAD'S OWN, NOT `onReply`. A scratchpad has one leg, no results
   * pane, no link index and no `tmProgram`, so every branch of `onReply` below except `lambda-frames`
   * is about state it does not have — routing it there would mean five `if (session === …)` guards
   * inside a function whose whole point (see its doc) is that a reply belongs to the session whose
   * worker sent it. Two handlers, one per session kind, is the same split §3.2 draws at the port.
   */
  const scratchpad = new LambdaScratchpad({
    registry: sessions,
    pool,
    id: LAMBDA_SCRATCH,
    label: LAMBDA_SCRATCH_LABEL,
    historyBytes: HISTORY_BYTES,
    onReply: (reply: RunReply) => onScratchReply(LAMBDA_SCRATCH, reply),
  })

  // THE SOURCE SESSION, AND NO LONGER THE ONLY ENTRY THE APP EVER HOLDS. It is the only one created
  // at start-up: §4.3's scratchpad is created by a click (`scratchpad` above) and retired by the next
  // recompile, so the selector has one option to offer until someone forks — which is why
  // `bindingSelect` renders nothing on a fresh page and appears the moment there are two. That is the
  // control's stated idiom, not a gap: see its doc.
  //
  // ASSEMBLED HERE RATHER THAN WHERE `lam`/`tm` USED TO BE DECLARED, because an entry owns its client
  // and the client cannot exist before its worker does. The legs are initialised inline for the same
  // reason the entry exists at all: a session's legs and its client are one thing now, and splitting
  // them across two hundred lines is what let them drift apart into unrelated locals in the first
  // place. Registered before either pane is constructed — `events(...)` below resolves through the
  // registry, and although every handler it builds runs later, `entryOf` would throw if one somehow
  // fired first.
  //
  // `detached: false`, AND IT IS THE ONLY ENTRY THAT MAY SAY SO. This is the session with a
  // `SourceMap` behind it; §3.3 puts `linkIndex` and `sourceSpan` on neither scratch type, so the
  // scratchpad entry is `detached: true` by construction — `LambdaScratchpad.detach` writes the
  // literal and nothing derives it, for the reason `SessionEntry.detached`'s own doc gives.
  //
  // THE REPLY HANDLER NAMES ITS SESSION. Nothing on the wire does (§3.2 — the port is the id), so the
  // binding between a client and the legs its frames land in is made here, at the one place that
  // knows both. `pool.bind` is what pairs that handler with a thread; this file never sees the port.
  sessions.add({
    id: SOURCE_SESSION,
    label: 'source',
    detached: false,
    client: pool.bind(SOURCE_SESSION, (reply: RunReply) => onReply(SOURCE_SESSION, reply)),
    legs: {
      lambda: {
        hist: new History<LambdaState>(HISTORY_BYTES),
        status: { available: false, reason: '' },
        done: null,
        timer: null,
      },
      tm: {
        hist: new History<TmState>(HISTORY_BYTES),
        status: { available: false, reason: '' },
        done: null,
        timer: null,
      },
    },
  })
  const lambdaPane = new LambdaPane(lambdaHost, events(lambdaSlot))
  const tmPane = new TmPane(tmHost, events(tmSlot))

  /**
   * One session's replies, applied to that session's legs.
   *
   * THE SESSION IS A PARAMETER, NOT A CLOSED-OVER CONST, even though exactly one exists. A reply
   * belongs to the session whose worker sent it and to nothing else — §3.2's "the port is the id" is
   * precisely the claim that this pairing is established at the port and cannot be recovered from the
   * message. Resolving it here keeps this function from quietly being *the source session's* reply
   * handler under a name that says otherwise.
   *
   * `index`/`linkable`/`link` AND THE `results`/`view` WRITES BELOW ARE NOT PER SESSION and stay
   * closed over: they are the app's one editor, one status line and one results pane. See `index`'s
   * own doc for why the link index in particular is not in the registry.
   */
  const onReply = (session: SessionId, reply: RunReply): void => {
    const { legs } = sessions.entryOf(session)
    switch (reply.kind) {
      case 'no-session':
        results.dataset.state = 'idle'
        renderRows(results, noSessionRows(reply.diagnostics))
        // STALE FRAMES MUST NOT SURVIVE A BROKEN PROGRAM. A pane still showing the last good run
        // under source that does not compile is the worst of both answers.
        resetLegs(legs, null, null, 'not compiled')
        tmPane.setProgram(null, [])
        index = null
        linkable = false
        link = null
        view.dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
        // `draw()` calls `drawLink()` at its end now — see that function's doc.
        draw()
        return
      case 'compiled':
        resetLegs(legs, reply.lambda, reply.tm)
        tmPane.setProgram(reply.tmProgram, reply.tapeNames)
        index = reply.linkIndex === null ? null : new LinkIndex(reply.linkIndex)
        linkable = index !== null
        link = null
        // `setLink.of(null)` HERE TOO, NOT ONLY `setDecline`. `linkMark` clears its own decoration on
        // `docChanged`, which covers the ordinary typing path — but the `#encoding` picker's `change`
        // listener below calls `schedule` with NO document edit at all, so a `compiled` reply from
        // switching encodings can land with the `.linked` mark still painted from the PREVIOUS compile's
        // index. `link` is already cleared above; this is what makes the source pane agree. Combined
        // into one dispatch with `setDecline` so the two decorations never appear half-updated for a
        // frame.
        view.dispatch({ effects: [setDecline.of(reply.declinedSpan), setLink.of(null)] })
        draw()
        return
      // RESOLVED THROUGH `legOf`, NOT READ OFF `legs` DIRECTLY, because a session's legs are optional
      // now (§4.1: a `LambdaScratch` has one leg) and a reply naming a leg its session does not have
      // is a wiring bug rather than a state to render. `legOf`'s throw is the one policy for that
      // whole class — see its doc — and reusing it here is what keeps this file from inventing a
      // second answer (a silent drop) for the same question.
      case 'lambda-frames': {
        const leg = sessions.legOf({ session, leg: 'lambda' })
        for (const f of reply.frames) leg.hist.push(f, lambdaFrameBytes(f))
        leg.done = reply.done
        draw()
        return
      }
      case 'tm-frames': {
        const leg = sessions.legOf({ session, leg: 'tm' })
        for (const f of reply.frames) leg.hist.push(f, tmFrameBytes(f))
        leg.done = reply.done
        draw()
        return
      }
      case 'result':
        results.dataset.state = 'idle'
        renderRows(results, resultRows(reply.lambda, reply.tm))
        return
      case 'worker-error':
        // See the constructor-time `worker.addEventListener('error', ...)` above for the sibling
        // failure this answers: that one is a module that never loaded, this one is a session call
        // that threw after it did. Both would otherwise leave a pane on "running…" forever — but
        // unlike that one, the app itself is still alive here, so the response renders INTO `#results`
        // (`showWorkerError`) rather than replacing `<main>` (`showBanner`'s job is the other case; see
        // `banner.ts`'s doc for the split). `resetLegs`/`setProgram`/`setDecline`/`draw` below all run
        // against the SAME live nodes they always did — nothing here was ever the problem.
        results.dataset.state = 'idle'
        // STALE FRAMES MUST NOT SURVIVE A BROKEN PROGRAM, same as `no-session` above. `compile()`
        // throws by design for an unknown encoding (`lib.rs:36-38`) from inside `onRun`, before any
        // session exists — so a `worker-error` from a fresh `client.request()` is not only a call that
        // threw mid-record on top of a live session; it can also mean there was never a new session at
        // all, and the panes are still showing the PREVIOUS program's frames under a message saying the
        // app broke. Either way there is no session, which is what "not compiled" means — the same
        // reason `no-session` above passes, since a `compile()` that threw never produced one.
        resetLegs(legs, null, null, 'not compiled')
        tmPane.setProgram(null, [])
        index = null
        linkable = false
        link = null
        view.dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
        showWorkerError(results, new Error(reply.message))
        draw()
        return
    }
  }

  /**
   * One λ scratchpad reply, applied to the scratchpad's one leg.
   *
   * A SECOND HANDLER RATHER THAN BRANCHES IN `onReply`, for the reason the `scratchpad` construction
   * above gives. What the two share is `lambda-frames`, which is fifteen characters of `hist.push`
   * loop; what they do not share is everything `onReply` does with `index`, `results`, `tmPane` and
   * `view`, none of which a detached session has any claim on (§3.3: no `linkIndex`, no `sourceSpan`,
   * no `ty`).
   *
   * FOUR ARMS AND NO `default`, WHICH IS NOT AN OVERSIGHT. `session-worker.ts` answers a
   * `lambda-scratch` request with exactly `scratch-compiled`, `lambda-frames`, `no-session` or
   * `worker-error` — `compiled`, `tm-frames` and `result` need a TM leg, a `SourceMap` or a `ty`, and
   * `onLambdaScratch`/`onExtend` are where each is refused. A reply this switch does not name is a
   * reply this session's worker cannot send, and falling through is the honest answer: there is
   * nothing on a scratchpad for a TM frame to land in, and inventing somewhere is the shape
   * `session.rs:257-273` prices.
   *
   * IT NEVER TOUCHES `results.dataset.state` EXCEPT ON A THROW. That flag is the source compile's
   * "running…" indicator and `app.test.ts`'s `settled` waits on it; a scratchpad's traffic is not a
   * compile and must not be seen as one finishing.
   */
  const onScratchReply = (session: SessionId, reply: RunReply): void => {
    switch (reply.kind) {
      case 'scratch-compiled':
        // ONE STATUS, AND THE `null` IS NOT A FABRICATION. `resetLegs` drops a status for a leg the
        // session does not have rather than writing one so the record is square — its own doc, and
        // this is the caller it was written for.
        resetLegs(sessions.entryOf(session).legs, reply.lambda, null)
        // THE EDITOR IS SEEDED FROM THE REPLY'S OWN TEXT, NOT FROM THE FRAME THAT ARRIVES NEXT
        // (design §4.1: `text` "travels back so `main.ts` can seed the editor from the same string
        // that created the scratch, rather than from a second print that could disagree with it").
        // `null` HERE MEANS NO SCRATCH WAS BUILT — unparseable text and a term over
        // `LAMBDA_BYTE_BUDGET` both land there (§4.1a) — and the `no-session` reply that carries the
        // diagnostic is what routes to the pane below; there is nothing to seed with, and calling
        // `setEditor(null)` here on the strength of an unrelated `no-session` would tear down an
        // editor this reply never touched. `text: string | null` on the wire type is nullable
        // DEFENSIVELY here rather than reachably — `onLambdaScratch` never posts `scratch-compiled`
        // at all when its own `scratch` came back `null` (`session-worker.ts:531-535`) — the same
        // "nullable defensively, not reachably" shape `protocol.ts`'s `linkIndex` field states for
        // itself, and the guard costs one `if` against a wire contract that should not assume today's
        // producer forever.
        if (reply.text !== null) lambdaPane.setEditor(reply.text)
        draw()
        return
      case 'lambda-frames': {
        const leg = sessions.legOf({ session, leg: 'lambda' })
        for (const f of reply.frames) leg.hist.push(f, lambdaFrameBytes(f))
        leg.done = reply.done
        draw()
        return
      }
      case 'no-session': {
        // WHICH OF TWO REASONS THIS FIRES IS `LambdaScratchpad.noSessionReply`'s QUESTION, NOT THIS
        // FILE'S — see that method's doc for the discriminator (has this session's λ leg ever recorded
        // a frame) and why retiring is required for one reason and wrong for the other. Everything
        // below is what THIS reply still has to do once that question is answered.
        const failed = scratchpad.noSessionReply(reply.diagnostics, SOURCE_SESSION, [lambdaSlot, tmSlot])
        if (failed !== null) {
          // THE PHANTOM PATH — CRITICAL finding, plan 5d-iii's ninth task. `detach`'s OWN build never
          // landed a single frame, so `scratch-compiled` never fired, `lambdaPane.setEditor` was never
          // called, and `#editor` is still `null` — `lambdaPane.setDiagnostics` below
          // (`this.#editor?.setDiagnostics(ds)`) would be exactly the silent no-op the finding names.
          // `noSessionReply` has already retired the scratchpad: the pane is back on `SOURCE_SESSION`,
          // `SessionEntry.detached` reads `false` for it again, and `#refreshDetach`'s `!this.#detached`
          // gate offers the fork control once more — which is design §4.1a's promised remedy ("the pane
          // keeps offering ✎ — the user can scrub to a smaller step and fork there") actually happening
          // rather than merely documented. What retiring does NOT do is say why — `#link-status` is the
          // surface built for exactly that (`link-status.ts`'s `forkFailed`, its own doc has the case
          // for this surface over the pane).
          forkFailed = failed.map((d) => d.message).join(' · ')
          draw()
          return
        }
        // THE LIVE-EDIT PATH — THE TEXT DID NOT PARSE ON A SCRATCH THAT ALREADY HAS A GOOD BUILD
        // BEHIND IT, AND THIS ARM IS REACHABLE NOW, WHICH IS WHY THE COMMENT IT USED TO CARRY IS
        // AMENDED HERE RATHER THAN LEFT BESIDE THE CODE THAT CONTRADICTS IT. It read "unreachable
        // through the fork control as it stands... `lambda/syntax.rs` round-trips a whole printed
        // term", true of `detach`'s own src (always the worker's own re-print of the source's step-0
        // term, `index.lambdaText` above) — but T8 is what gives this session's worker a SECOND way to
        // be asked to parse text, `editScratch`'s `recompile`, which posts whatever the user just
        // typed. Most keystrokes mid-identifier do not parse; this is now the ordinary path, not the
        // defensive one. (`detach` itself can still fail too, on the same two reasons `noSessionReply`
        // names — but every one of those lands in the branch above, on a session with no frame yet,
        // never here.)
        //
        // THE FRAMES ARE LEFT ALONE — NOT `resetLegs` — WHICH IS THE OTHER HALF OF WHY THIS ARM
        // CHANGED. Design §4.4: "an edit that does not parse leaves the frames region showing the
        // last good run", the opposite of `onReply`'s "STALE FRAMES MUST NOT SURVIVE A BROKEN
        // PROGRAM" for the SOURCE (`:722`) — and deliberately so. A source recompile that fails to
        // compile has no program behind it at all; a scratch mid-edit still has the term it had a
        // keystroke ago, and blanking the reduction under a user who has not finished typing is worse
        // than leaving last frame on screen for one more keystroke. `leg.hist`/`leg.status` are
        // whatever the last successful build left them — this arm does not touch either.
        //
        // THE DIAGNOSTICS ARE NOW RENDERED. There is a pane that can be typed into (`LambdaPane`'s
        // split body, T7) and `setDiagnostics` puts them in its own gutter — the push-based path
        // design §4.4 gives a scratch, as against `lint.ts`'s pull-based linter, which has no worker
        // reply to pull from. The comment this replaces said "a scratchpad has no pane of its own to
        // put them in until one can be typed into" — one can now, so the claim is amended in the
        // commit that makes it false, matching this branch's own standard (5d-i's decision 6, and T5
        // and T7 both did the same to earlier claims this slice outgrew).
        lambdaPane.setDiagnostics(reply.diagnostics)
        draw()
        return
      }
      case 'worker-error':
        // THE SAME SURFACE AS THE SOURCE SESSION'S, AND DELIBERATELY. `showWorkerError` renders into
        // `#results` rather than replacing `<main>` (`banner.ts`'s split), which is right here for the
        // same reason it is there: the app is alive, one session's thread threw. `resetLegs` first
        // for `onReply`'s reason — stale frames must not survive under a message saying it broke.
        results.dataset.state = 'idle'
        resetLegs(sessions.entryOf(session).legs, null, null, 'the scratchpad failed')
        // `setEditor(null)` TOO — Important finding, whole-branch review before merge, second instance
        // of the same root as the binding-selector one `LambdaPane.setDetached`'s doc now covers. This
        // thread is dead and nothing here retires the scratchpad (only `LambdaScratchpad.retire` does
        // that, and a worker throwing is not a call to it), so the registry entry keeps
        // `detached: true`, the pane's binding does not move, and `setDetached`'s own new teardown
        // never fires — its input never changes. But the editor `main.ts` mounted from an earlier
        // `scratch-compiled` is now sitting over a worker that will never answer another message, so
        // it has to come down explicitly, here, rather than by that invariant. A no-op if the pane had
        // already moved on before this reply arrived (`setEditor`'s own doc: unmounting an
        // already-unmounted editor costs nothing).
        lambdaPane.setEditor(null)
        showWorkerError(results, new Error(reply.message))
        draw()
        return
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (src: string) => {
    clearTimeout(timer)
    results.dataset.state = 'running'
    // A SOURCE KEYSTROKE IS ALSO THE OTHER CLEAR SITE FOR `forkFailed` — see its own doc. `schedule`
    // runs on every keystroke, unconditionally, which is what makes this the right place: a report
    // about a click on the OLD program is not news about whatever the user is typing now, whether or
    // not this particular keystroke happens to retire a scratchpad.
    forkFailed = null
    // RECOMPILE-FROM-SOURCE RETIRES THE SCRATCHPAD AND TERMINATES ITS WORKER — design §4.3,
    // deliberately the same mechanism as §4.2's poison recovery so the app has ONE recovery path.
    //
    // AT DISPATCH, NOT ON THE `compiled` REPLY, and the difference is a second of stale screen. This
    // runs synchronously on the keystroke that invalidates the scratchpad's provenance, so the pane
    // is back on the source session immediately; waiting for the reply would leave a detached pane
    // showing a scratch term for `DEBOUNCE_MS` plus a compile — and `no-session` and `worker-error`
    // are recompiles too, so the reply-side version is three call sites where this is one.
    //
    // GUARDED BY ITS OWN RETURN VALUE RATHER THAN BY A `has` HERE. `schedule` runs on EVERY keystroke
    // while the post itself is debounced, and the editor's update listener says why it does not call
    // `draw()` on a keystroke: `hist` has not changed, so repainting both panes is pure waste.
    // `retire` answers whether anything moved, so the repaint happens on the one keystroke that
    // retired a scratchpad.
    //
    // `setEditor(null)` IN THE SAME BRANCH, BEFORE `draw()`. A retired scratchpad has no term left to
    // show in the box that was editing it — `retire`'s own doc: "the text in the box is lost" (design
    // §4.3) — and `LambdaPane.setEditor(null)` is what UNMOUNTS it rather than leaving a live
    // CodeMirror instance, and its own pending debounce, over a session `pool.unbind` just terminated
    // (`setEditor`'s doc: "mounted and unmounted, never hidden"). Guarded by the same boolean as
    // `draw()`, for the same reason: most recompiles retire nothing, and calling this on every
    // keystroke would be `#editor?.destroy()` finding `null` every time it already was.
    if (scratchpad.retire(SOURCE_SESSION, [lambdaSlot, tmSlot])) {
      lambdaPane.setEditor(null)
      draw()
    }
    // THE SOURCE SESSION BY NAME, NOT THROUGH A PANE'S BINDING. Recompiling is what the editor does to
    // the session it is the source of; it is not something a pane slot points at, so this stays
    // addressed to `SOURCE_SESSION` however the three panes end up bound. Resolved inside `schedule`
    // rather than held as a local for the reason `draw()` gives: a client belongs to a registry entry
    // now, and a second reference to it beside the registry is a second thing to keep in step.
    const client = sessions.entryOf(SOURCE_SESSION).client
    // SUPERSEDE NOW, POST LATER. The generation is claimed synchronously so the previous run's
    // replies stop being current at the instant of dispatch; `request` drops the post if another
    // keystroke claimed a newer one during the debounce. See `SessionClient.supersede`.
    const gen = client.supersede()
    timer = setTimeout(() => client.request(gen, src, picker.value), DEBOUNCE_MS)
  }

  // The picker is otherwise inert: `schedule` only reads `picker.value` when a keystroke's update
  // listener calls it, so choosing a different encoding would sit unused until the user typed again.
  picker.addEventListener('change', () => schedule(view.state.doc.toString()))

  view = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: SAMPLE,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        highlighting,
        declineMark,
        linkMark,
        focusMark,
        // AN EXPLICIT CLICK, NOT A CARET MOVE. Clicking an editor already means "place the caret", and
        // linking on every arrow key would fire constantly while navigating — and, worse, would have
        // to be airtight about the stale-index rule on every keystroke rather than only on clicks.
        // `mouseup` rather than `mousedown`, so a drag that selects text does not also link.
        EditorView.domEventHandlers({
          mouseup: (event, v) => {
            const pos = v.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos === null) return false
            // CodeMirror positions are UTF-16 indices; the index speaks bytes. `Buffer` is not
            // available in a browser, so the conversion goes through the same `TextEncoder` the
            // byte/UTF-16 split already forces everywhere else in this app.
            linkAtSourceOffset(new TextEncoder().encode(v.state.doc.sliceString(0, pos)).length)
            return false
          },
        }),
        // The keyboard route to the same thing. `Mod-'` is unbound in `defaultKeymap` and in
        // `historyKeymap`; verify that before changing it. Reachability without a mouse is the whole
        // point — the roadmap defers the rest of accessibility to one pass at the end of Plan 5, but a
        // mouse-only primary interaction would have to be retrofitted by that pass rather than
        // adjusted.
        keymap.of([
          {
            key: "Mod-'",
            run: (v) => {
              const pos = v.state.selection.main.head
              linkAtSourceOffset(new TextEncoder().encode(v.state.doc.sliceString(0, pos)).length)
              return true
            },
          },
        ]),
        lintGutter(),
        lintFromAnalyze((src) => analyze(src) as Diagnostic[]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          const src = u.state.doc.toString()
          // Synchronous, in the same frame as the keystroke. This is the whole reason `classifySource`
          // is not behind the worker.
          u.view.dispatch({ effects: setSpans.of(classifySource(src) as Classified) })
          // STALE FROM THIS KEYSTROKE UNTIL THE NEXT COMPILE. `linkMark` clears its own decoration on
          // `docChanged`; this clears the state behind it, the status line, AND THE OTHER TWO PANES —
          // design §6 case 4 requires all three cleared, not only the source echo. Before this, the λ
          // window and the δ-table's `.is-linked` rows stayed painted from the PREVIOUS index until the
          // next `compiled` reply landed — up to `DEBOUNCE_MS` plus a compile, seconds on a larger
          // program — while the status line already said "linking resumes when this compiles".
          //
          // A SECOND `drawLink()`/`renderLink()`/`setLink()` CALL SITE, DELIBERATELY — none of this is
          // redundant with `draw()`'s. Nothing here calls `draw()`: `lam.hist`/`tm.hist` have not
          // changed, so repainting both panes on every keystroke would be pure waste. But all three
          // panes still have to go stale THIS keystroke, not 300 ms from now when `schedule`'s debounce
          // finally lands a `compiled`/`no-session` reply — so each gets its own direct, targeted call
          // rather than waiting for `draw()` to earn one. Passed `null`/`[]`/`false` rather than
          // resolving anything: `linkable` is already false on the line above, and every one of these
          // reads that (`drawLink` directly; `renderLink`/`setLink`/`setFocus` take the already-cleared
          // view) before it would ever look at what is linked or focused.
          //
          // `tmPane.setFocus([])` TOO, NOT ONLY `setLink` — the running focus is the δ-table's own
          // second highlight layer (`TmPane`'s own doc) and goes stale on this same keystroke, for the
          // same reason `.is-linked` does: `tm.hist` is untouched by a keystroke, so without this call
          // the previous program's focused rows would stay painted until the next `compiled` reply.
          // `focusMark` (the CodeMirror decoration) needs no matching call — it clears itself on
          // `docChanged`, same as `linkMark`.
          //
          // AND IT RUNS BEFORE `setLink`, WHICH IS THE ONE THAT DRAWS. `setFocus` is a pure setter (its
          // own doc says why); `setLink` is what calls `#drawTable`, so it has to be the LAST of the two
          // or the cleared focus would not reach the DOM until some later draw. Same rule `draw()`
          // follows by putting its own `setFocus` ahead of `tmPane.render`.
          linkable = false
          link = null
          drawLink(null, false)
          lambdaPane.renderLink(null)
          tmPane.setFocus([])
          tmPane.setLink([], false)
          schedule(src)
        }),
      ],
    }),
  })

  view.dispatch({ effects: setSpans.of(classifySource(SAMPLE) as Classified) })
  schedule(SAMPLE)
  draw()
  return view
}

/**
 * The app starts on import — `index.html` loads this module and nothing else.
 *
 * THE VIEW IS EXPORTED AS A PROMISE so the browser tests can drive the editor through CodeMirror's own
 * API rather than synthesizing key events into a contenteditable. Nothing in the product reads it.
 */
export const ready = main()
