import { canRecordFurther } from './controls'
import type { LinkWiring } from './link-wiring'
import type { PaneEvents } from './pane-chrome'
import type { Leg } from './protocol'
import { BufferCapReached, type ScratchBuffers } from './scratch'
import type { Binding, LegState, PaneSlot, SessionRegistry } from './sessions'

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
  scratchpad: ScratchBuffers
  draw: () => void
  linkWiring: () => LinkWiring
  /**
   * A buffer has just been created — the header list's readout is stale until this returns.
   *
   * **THE FORK BELOW IS THE ONLY PLACE IN `src/` THAT MAKES A BUFFER, AND THE READOUT IS ON A DIFFERENT
   * CLOCK FROM `draw`.** `bufferList.update` takes a COUNT rather than reading its own rows, precisely
   * so the button can be current while the list is CLOSED without any repaint recomputing it (its own
   * doc); the two moments the count changes are a fork and a retire, and the retire is `main.ts`'s own
   * handler. This is the other one. Routing it through `draw` instead would put the header's readout on
   * the playback clock — a `setInterval` at 8 fps — to catch a number that changes on a click.
   *
   * `recompile` BELOW DELIBERATELY DOES NOT CALL IT: it rebuilds the term behind a buffer that already
   * exists, so the count is the one thing an edit cannot change.
   */
  onBuffersChanged: () => void
}): {
  play<T>(leg: LegState<T>): void
  events<K extends Leg>(slot: PaneSlot<K>): PaneEvents
} {
  const { sessions, scratchpad, draw, linkWiring, onBuffersChanged } = deps

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
    // THE SELECTOR'S PICK, ON THE SESSION AXIS. `PaneSlot.rebind` writes the session and nothing else —
    // the leg is fixed by `K` and has no writer anywhere in the app, which is what keeps `Binding<K>`'s
    // type property (see `PaneSlot`'s doc). `draw()` immediately afterwards because a rebind changes
    // what this pane shows, what its `[detached]` badge says, and what the status line narrates, and
    // none of those has another path to the DOM. The `<select>` is also sitting on the option the user
    // just chose, and only a repaint puts it back on the pair in force (`paneSelect.update`'s
    // `select.value = want`).
    //
    // **THE LEG COMPARISON THAT USED TO BE ON THIS LINE HAS MOVED UP TO `pane-host.ts`, AND THE ANSWER
    // MOVED WITH IT: A CROSS-LEG PICK IS NOW ACTED ON RATHER THAN DECLINED.** The history is worth
    // keeping, because the middle state was a Critical. The line began as `slot.rebind(binding.session)`
    // unguarded, under a comment claiming a cross-leg pick was "a no-op the next paint undoes": it was
    // neither. `PaneSlot.render` pushes `reg.pairs()` to EVERY pane, so a TM pane's selector genuinely
    // lists the λ-only scratch; taking the session half of `λ · λ scratchpad` on a TM slot minted
    // `{ leg: 'tm', session: 'lambda-scratch' }`, which `legOf` THROWS on — and `draw.ts`'s per-pane
    // loop has no `try`/`catch`, so the throw took every subsequent frame with it, not just the one.
    // Three clicks from a fresh page. A guard here then made such a pick a silent no-op, deliberately
    // shaped so the real branch could take its place: one condition, same-leg arm already isolated.
    //
    // **THAT BRANCH LANDED, AND IT COULD NEVER HAVE LANDED HERE.** Following a leg change means
    // replacing the pane's whole entry — a different `PaneSlot`, a different pane class, its host and
    // any editor handed to custody — which needs the layout tree, and this file has never seen one.
    // `pane-host.ts`'s `paneEvents` wraps this handler, compares the picked leg against the slot's, and
    // delegates ONLY a same-leg pick here; a cross-leg pick changes the leaf's kind and rebuilds the
    // entry through `applyLayout`. So the pair reaching this line always names this slot's own leg, and
    // the session half is all there is left to take.
    //
    // **SO THE COMPARISON BELOW IS AN ASSERTION, NOT AN ANSWER — and the distinction is what earned it
    // its place back after one commit without it (IMPORTANT finding, review of that commit).** Deleting
    // it was argued from "a branch that cannot be taken is a second answer to what a cross-leg pick
    // means". That holds against a silent refusal, which is an answer — the WRONG one, now that the app
    // has a real one — and not against a throw: a throw says this layer does not answer the question,
    // which is exactly the true statement. What deletion actually cost is that the line then PROJECTED
    // any cross-leg pick onto this slot's leg, re-minting the Critical's own binding for any caller
    // that wired a pane straight to these handlers — `new LambdaPane(host, transport.events(slot))`
    // typechecks, and `tests/browser/scratch-fork.test.ts` already writes that shape twice with
    // hand-built events. One `if` moves the invariant from comment-checked back to machine-checked.
    //
    // IT THROWS RATHER THAN DECLINING, FOR `LambdaPane.receiveEditor`'s REASON in as many words: a
    // silent repair absorbs the finding as normal operation, and this class of mistake is a wiring bug
    // in a caller rather than a state a user can reach. Unreachable from the app — `pane-host.ts`'s
    // wrapper is the only production caller and it never delegates a cross-leg pick here — so this
    // costs one comparison per pick and nothing else. `tests/node/sessions.test.ts` pins both arms.
    rebind: (binding: Binding<Leg>) => {
      if (binding.leg !== slot.binding.leg) {
        throw new Error(
          `a ${slot.binding.leg} slot cannot take a ${binding.leg} pick: a leg change replaces the pane (pane-host.ts)`,
        )
      }
      slot.rebind(binding.session)
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
            // **THE CAP'S REFUSAL IS AN ANSWER TO THE USER AND IS CAUGHT HERE** (design §4.5, and the
            // Critical this task's review raised). `ScratchBuffers.fork` refuses at `MAX_BUFFERS`
            // rather than evicting, and this click listener is the last frame before the raw DOM
            // dispatch (`pane-chrome.ts`'s `detachButton`) — there is no `window` error handler in
            // `src/` behind it, so an uncaught throw here would reach the console and nothing else.
            // `#link-status` is where it goes instead, through the same `forkFailed` field `replies.ts`
            // uses for the sibling refusal (a fork whose BUILD fails) and `link-status.ts` renders as
            // `fork failed — …`.
            //
            // **`BufferCapReached` AND NOT A BARE `catch`.** The other throws reachable from `fork` are
            // `SessionRegistry.add`'s and `SessionPool.bind`'s guards over their own invariants; those
            // are wiring bugs, and rendering one as a status line would swallow it. Anything else is
            // re-thrown unchanged.
            try {
              scratchpad.fork(slot, wiring.index.lambdaText, step)
            } catch (e) {
              if (!(e instanceof BufferCapReached)) throw e
              wiring.setForkFailed(e.message)
              // NO `onBuffersChanged()` ON THIS ARM — the header's count did not move, because that is
              // the whole content of the refusal. `draw()` still runs: the status line is the one thing
              // that DID change, and `draw()` ends in `drawLink`.
              draw()
              return
            }
            // A FRESH ATTEMPT RETIRES YESTERDAY'S NEWS, **AND IT CLEARS ON THE SUCCESS PATH RATHER THAN
            // AHEAD OF THE CALL**. `forkFailed` is a report about the LAST click on this control, and a
            // stale message must not sit on `#link-status` through a fork that worked. This line used
            // to run BEFORE the fork, on the reasoning that "a new click means the user is trying
            // again" — which was right until the fork could answer synchronously: `setForkFailed` is a
            // pure state write (`link-wiring.ts`) and nothing repaints between there and here, so a
            // clear ahead of a REFUSED fork would drop the previous failure from the model while it was
            // still on screen, and the two would disagree until some unrelated frame repainted. Clearing
            // here says the same thing about a fork that is now genuinely pending, and the arm above
            // overwrites rather than clears. See `forkFailed`'s own doc for the other clear site.
            wiring.setForkFailed(null)
            // THE HEADER GAINED A BUFFER, AND ITS READOUT IS THE ONE SURFACE `draw()` BELOW DOES NOT
            // REACH — `draw.ts` paints panes and pane chrome, and the buffer list is header chrome
            // beside `reset layout`. See this dependency's own doc for why the count travels on a click
            // rather than on the frame clock.
            onBuffersChanged()
            // IMMEDIATELY, NOT ON THE SCRATCHPAD'S FIRST REPLY. The rebind has already happened, so
            // this pane's `[detached]` badge, its selector (which gains a second option the instant a
            // second session is registered) and the status line are all stale until something paints
            // — and the first frame is a worker round trip away.
            draw()
          },
          // THE EDIT PATH — design §4.3's second gesture, `LambdaEditor`'s debounced `onEdit` wired
          // through `LambdaPane.setEditor` (`pane-chrome.ts`'s `editScratch` doc). `recompile` REBUILDS
          // THE BUFFER THIS PANE IS SHOWING rather than forking a second one, which is the whole of
          // what this handler decides. It used to say "the singleton is `scratch.ts`'s to keep, not
          // this handler's to re-derive", and there was no id to pass because there was one scratch;
          // 5d-ii-c decision 1 makes buffers plural, so the pane's own binding is what says which term
          // the keystrokes belong to. Reading it here rather than in the callee is the same rule
          // `detach` above follows: this file is handed what it needs to name, it does not go looking.
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
            scratchpad.recompile(slot.binding.session, src)
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
