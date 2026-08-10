import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lintGutter } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import init, { analyze, classifySource, encodings, tokenClasses } from '../../pkg/redextape_wasm.js'
import { APPEARANCE_LABEL, applyAppearance, nextAppearance, readStored, STORAGE_KEY } from './appearance'
import { showBanner, showWorkerError } from './banner'
import { canRecordFurther, controlState } from './controls'
import { declineMark, focusMark, highlighting, linkMark, setDecline, setFocus, setLink, setSpans } from './highlight'
import { History } from './history'
import { LambdaPane } from './lambda-pane'
import type { LambdaWindow } from './lambda-window'
import { LINK_CONTEXT, lambdaWindow } from './lambda-window'
import { isCoincident, type Link, LinkIndex, type Pin, runningFocus, sourceNodeOwner } from './link'
import { type LambdaLinkState, linkStatus } from './link-status'
import { lintFromAnalyze } from './lint'
import type { Leg, RecordEnd, RunReply } from './protocol'
import { HISTORY_BYTES, lambdaFrameBytes, tmFrameBytes } from './protocol'
import type { Row } from './results'
import { noSessionRows, resultRows } from './results'
import { SessionClient } from './session-client'
import { TmPane } from './tm-pane'
import type { Classified, Diagnostic, LambdaState, LambdaStatus, Span, TmState, TmStatus } from './types'
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

/**
 * One leg's live state on this side of the boundary: its history, how recording ended, and what the
 * worker said about it at compile time.
 */
type LegState<T> = {
  hist: History<T>
  status: { available: boolean; reason: string }
  done: RecordEnd | null
  timer: ReturnType<typeof setInterval> | null
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

  const lam: LegState<LambdaState> = {
    hist: new History<LambdaState>(HISTORY_BYTES),
    status: { available: false, reason: '' },
    done: null,
    timer: null,
  }
  const tm: LegState<TmState> = {
    hist: new History<TmState>(HISTORY_BYTES),
    status: { available: false, reason: '' },
    done: null,
    timer: null,
  }

  /**
   * The current compile's link index, and the construct the user has linked.
   *
   * `linkable` IS NOT `index !== null`. An index is from the last compile, so the first keystroke
   * after it shifts every source span it holds; linking is disabled from that keystroke until the
   * next `compiled` lands. Resolving against a stale index is the silently-wrong answer this whole
   * slice refuses elsewhere.
   */
  let index: LinkIndex | null = null
  let linkable = false
  let link: Pin | null = null

  const draw = () => {
    lambdaPane.render(
      lam.hist.current ?? null,
      controlState({
        available: lam.status.available,
        reason: lam.status.reason,
        head: lam.hist.head,
        length: lam.hist.length,
        oldestStep: lam.hist.oldestStep,
        currentStep: lam.hist.currentStep,
        newestStep: lam.hist.newestStep,
        evicted: lam.hist.evicted,
        done: lam.done,
      }),
    )
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
    tmPane.render(
      tm.hist.current ?? null,
      controlState({
        available: tm.status.available,
        reason: tm.status.reason,
        head: tm.hist.head,
        length: tm.hist.length,
        oldestStep: tm.hist.oldestStep,
        currentStep: tm.hist.currentStep,
        newestStep: tm.hist.newestStep,
        evicted: tm.hist.evicted,
        done: tm.done,
      }),
    )
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
    if (lam.hist.currentStep !== 0) return 'not-step-0'
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
   */
  const drawLink = (l: Link | null, focusCoincident: boolean) => {
    if (!linkable) {
      linkStatusHost.textContent = linkStatus({ state: 'stale' })
      return
    }
    if (l === null) {
      linkStatusHost.textContent = linkStatus({ state: 'none' })
      return
    }
    linkStatusHost.textContent = linkStatus({
      state: 'linked',
      tm: l.states.length > 0,
      lambda: lambdaLinkState(l.lambda),
      focus: focusCoincident,
    })
  }

  /**
   * The λ pane's link view, or `null` when there is nothing to show.
   *
   * GATED ON `lam.hist.currentStep === 0`, and ONLY on the λ leg's own head. `main.ts` holds two
   * independent histories with two heads; the TM leg runs at wildly different step counts (the `map`
   * demo is 344,999 δ-steps against a few hundred β-steps), so gating on a shared condition would make
   * the λ link vanish almost immediately for reasons that have nothing to do with λ.
   *
   * `l` IS `draw()`'S RESOLUTION, PASSED IN — the same one `drawLink` got. A second
   * `index.linkFor(link.node)` call here for the same node in the same tick is exactly the double
   * resolution `draw()`'s doc describes fixing; `index` is still read directly below for `lambdaText`/
   * `lambdaSpans`, which are not part of `Link` and were never duplicated.
   */
  const lambdaLinkWindow = (l: Link | null): LambdaWindow | null => {
    if (l === null || index === null) return null
    if (lam.hist.currentStep !== 0) return null
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

  const events = <T>(leg: LegState<T>, which: Leg) => ({
    back: () => {
      leg.hist.back()
      draw()
    },
    forward: () => {
      // At the frontier `▶` means "record one more", which is the same operation as `[continue]`.
      // `canRecordFurther` is `controls.ts`'s call, not re-derived here — see its doc comment.
      if (!leg.hist.forward() && canRecordFurther(leg.done)) {
        client.extend(which)
      }
      draw()
    },
    play: () => play(leg),
    restart: () => {
      leg.hist.seek(0)
      draw()
    },
    extend: () => client.extend(which),
    // OMITTED ENTIRELY ON THE λ LEG, not set to `undefined` — `PaneEvents.linkState` is optional
    // under `exactOptionalPropertyTypes`, which distinguishes "absent" from "present and undefined".
    // The λ pane has no table to click.
    ...(which === 'tm'
      ? {
          linkState: (stateId: number) => {
            if (!linkable || index === null) return
            setLinkTo(index.nodeForState(stateId), 'tm')
          },
        }
      : {}),
    // OMITTED ENTIRELY ON THE TM LEG, mirroring `linkState` above — `PaneEvents.linkLambda` is
    // optional under `exactOptionalPropertyTypes`, and the TM pane has no λ window to click.
    ...(which === 'lambda'
      ? {
          linkLambda: (byteOffset: number) => {
            if (!linkable || index === null) return
            setLinkTo(index.nodeAtLambda(byteOffset), 'lambda')
          },
        }
      : {}),
  })

  const worker = new Worker(new URL('./session-worker.ts', import.meta.url), { type: 'module' })
  // THE SECOND HALF OF §6's LOAD-FAILURE ROW, and it is not the same failure as `init()`'s. A worker
  // whose module fails to load does not throw from the constructor — it fires `error` on the handle,
  // asynchronously, and nothing else in this file would ever hear it. Without this the pane sits on
  // "running…" forever, which is the same blank-page problem one layer in.
  worker.addEventListener('error', (e) => showBanner(root, e instanceof ErrorEvent ? (e.error ?? e.message) : e))
  const client = new SessionClient(worker, (reply: RunReply) => onReply(reply))
  const lambdaPane = new LambdaPane(lambdaHost, events(lam, 'lambda'))
  const tmPane = new TmPane(tmHost, events(tm, 'tm'))

  // `reason` is what a leg's control strip reads (`controls.ts`'s `controlState` returns it straight
  // as `stepText` while `!available`) when there is no per-leg `LambdaStatus`/`TmStatus` to read one
  // from — i.e. when neither leg compiled at all. Design §6's error table says the panes "read 'not
  // compiled'" for that case; leaving it as `''` left them reading nothing.
  const resetLegs = (lambda: LambdaStatus | null, tmStatus: TmStatus | null, reason = '') => {
    for (const leg of [lam, tm]) {
      leg.hist.clear()
      leg.done = null
      if (leg.timer !== null) clearInterval(leg.timer)
      leg.timer = null
    }
    lam.status = { available: lambda?.available ?? false, reason: lambda?.reason ?? reason }
    tm.status = { available: tmStatus?.available ?? false, reason: tmStatus?.reason ?? reason }
  }

  const onReply = (reply: RunReply): void => {
    switch (reply.kind) {
      case 'no-session':
        results.dataset.state = 'idle'
        renderRows(results, noSessionRows(reply.diagnostics))
        // STALE FRAMES MUST NOT SURVIVE A BROKEN PROGRAM. A pane still showing the last good run
        // under source that does not compile is the worst of both answers.
        resetLegs(null, null, 'not compiled')
        tmPane.setProgram(null, [])
        index = null
        linkable = false
        link = null
        view.dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
        // `draw()` calls `drawLink()` at its end now — see that function's doc.
        draw()
        return
      case 'compiled':
        resetLegs(reply.lambda, reply.tm)
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
      case 'lambda-frames':
        for (const f of reply.frames) lam.hist.push(f, lambdaFrameBytes(f))
        lam.done = reply.done
        draw()
        return
      case 'tm-frames':
        for (const f of reply.frames) tm.hist.push(f, tmFrameBytes(f))
        tm.done = reply.done
        draw()
        return
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
        resetLegs(null, null, 'not compiled')
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

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (src: string) => {
    clearTimeout(timer)
    results.dataset.state = 'running'
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
