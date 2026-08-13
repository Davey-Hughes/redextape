import { canRecordFurther } from './controls'
import type { LinkWiring } from './link-wiring'
import type { PaneEvents } from './pane-chrome'
import type { Leg } from './protocol'
import type { LambdaScratchpad } from './scratch'
import type { SessionId } from './session-client'
import type { LegState, PaneSlot, SessionRegistry } from './sessions'

/**
 * Milliseconds between frames during playback (120 ms ≈ 8 fps). A main-thread `setInterval` walk over
 * recorded frames — it never touches wasm, which is the whole reason the history lives on this side.
 */
const PLAY_MS = 120

/**
 * `play`, THE INTERVAL THAT WALKS RECORDED FRAMES, AND `events`, THE PER-PANE CLICK HANDLERS — moved
 * out of `main.ts` verbatim. See the doc comment on each below for what it does; this one is only
 * about the dependencies.
 *
 * `draw` AND `linkWiring` ARE BOTH THUNKS, AND BOTH ARE FORCED RATHER THAN STYLISTIC. `events(...)`
 * builds the click handlers every pane is CONSTRUCTED with, so `transport` has to exist before either
 * pane does — but `linkWiring` (`link-wiring.ts`) takes both panes as values, and `draw` (`draw.ts`)
 * takes `linkWiring` as one, so neither has been built yet when `transport` is. `main.ts` declares
 * `let draw: () => void` and `let linkWiring: LinkWiring` and assigns both after this factory runs —
 * a value parameter for either would capture `undefined` forever. Same shape `link-wiring.ts` already
 * uses for `draw` and `draw.ts` already uses for `view`, applied one step earlier in construction.
 *
 * `linkWiring` IS NOT IN THE ORIGINAL TASK SIGNATURE THIS FACTORY WAS SPECIFIED WITH. `events(...)`'s
 * `detach`/`linkState`/`linkLambda` handlers read `linkWiring.index`/`.linkable` and call
 * `.setForkFailed`/`.setLinkTo` — in `main.ts`, before this move, that worked as an ordinary closure
 * over a same-scope `const`; across a module boundary it has to be a real dependency instead. Because
 * `linkWiring().index` is a fresh call each time it appears, TypeScript cannot narrow a null check on
 * one occurrence across to the next the way it did for `linkWiring.index` (a stable property read) —
 * the three handlers below each call `linkWiring()` once, at the top, and narrow on the result instead
 * of narrowing on repeated calls.
 */
export function createTransport(deps: {
  sessions: SessionRegistry
  scratchpad: LambdaScratchpad
  draw: () => void
  linkWiring: () => LinkWiring
}): {
  play<T>(leg: LegState<T>): void
  events<K extends Leg>(slot: PaneSlot<K>): PaneEvents
} {
  const { sessions, scratchpad, draw, linkWiring } = deps

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
  const events = <K extends Leg>(slot: PaneSlot<K>): PaneEvents => ({
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
    // and it is already what `link-wiring.ts`'s `lambdaLinkWindow` reads for the very same reason — a
    // second name for the one string this file already holds, not a second lookup.
    //
    // `index === null || index.lambdaText === ''` COVERS EVERY CASE A FORK CAN BE CLICKED FROM AND
    // NO OTHERS. `index` is `null` between a keystroke and the next `compiled`/`no-session` reply and
    // for an uncompiled page — but `#refreshDetach` already hides this control whenever the pane's
    // frame is `null`, which a `no-session`/pre-compile leg always is, so this guard is defence
    // against a call this file's own chrome should never produce, not a path a user can reach.
    // `lambdaText === ''` is `link-wiring.ts`'s `lambdaLinkState` spelling "declined" — a declined leg
    // also renders no frame, so the same defence applies. NEITHER READS THE SLOT'S SESSION: a
    // detached pane's own `#refreshDetach` already refuses (`!this.#detached`), and the only session
    // that is ever NOT detached is `SOURCE_SESSION` — the one `index` describes — so whenever this
    // handler can fire at all, `index` is already describing the right session.
    ...(slot.binding.leg === 'lambda'
      ? {
          detach: (step: number) => {
            const wiring = linkWiring()
            if (wiring.index === null || wiring.index.lambdaText === '') return
            // A FRESH ATTEMPT RETIRES YESTERDAY'S NEWS. `forkFailed` is a report about the LAST click
            // on this control; a new click means the user is trying again, and the stale message would
            // otherwise sit on `#link-status` through a successful fork (nothing on the success path
            // touches it) or, worse, read like it describes THIS attempt when this one has not even
            // answered yet. See `forkFailed`'s own doc for the other clear site.
            wiring.setForkFailed(null)
            scratchpad.detach(slot, wiring.index.lambdaText, step)
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
          // editor's own `EditorView.updateListener` in `main.ts` already declines to pay on every
          // keystroke — its comment states the reason: `hist` has not changed, so repainting is waste.
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
            const wiring = linkWiring()
            if (!wiring.linkable || wiring.index === null) return
            wiring.setLinkTo(wiring.index.nodeForState(stateId), 'tm')
          },
        }
      : {}),
    // OMITTED ENTIRELY ON THE TM LEG, mirroring `linkState` above — `PaneEvents.linkLambda` is
    // optional under `exactOptionalPropertyTypes`, and the TM pane has no λ window to click.
    ...(slot.binding.leg === 'lambda'
      ? {
          linkLambda: (byteOffset: number) => {
            const wiring = linkWiring()
            if (!wiring.linkable || wiring.index === null) return
            wiring.setLinkTo(wiring.index.nodeAtLambda(byteOffset), 'lambda')
          },
        }
      : {}),
  })

  return { play, events }
}
