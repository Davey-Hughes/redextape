import type { EditorView } from '@codemirror/view'
import type { ClifPane } from './clif-pane'
import { setDecline, setLink } from './highlight'
import type { LambdaTrees } from './lambda-trees'
import { LEGS, unhandled } from './legs'
import { LinkIndex } from './link'
import type { LinkWiring } from './link-wiring'
import type { PaneCollection } from './panes'
import {
  type ClifCompiled,
  type FramesReply,
  LEG_FRAME_BYTES,
  type Leg,
  type LegFrame,
  type LegProgram,
  type McTarget,
  type RunReply,
} from './protocol'
import type { ProgramResult } from './readout'
import type { RxmPane } from './rxm-pane'
import { seedRxm } from './rxm-seed'
import type { SessionId } from './session-client'
import { type PaneView, resetLegs, type SessionRegistry } from './sessions'
import type { TmPane } from './tm-pane'
import { seedTm } from './tm-seed'

/**
 * Views `draw()` seeds from their session, and removes, when it next draws them on the page: those a compile reached
 * while they were off the page, which `storeAndSetProgram` adds, and every CLIF view when a CLIF listing lands. Over
 * every program leg's views, so a view is put in without a cast and seeded because it is in the set, whatever its leg.
 */
export type UnseenViews = WeakSet<PaneView<LegFrame[keyof LegProgram]>>

/**
 * `onReply`, the reply switch. See its own doc below for what it does; this one is only about the dependencies.
 *
 * `view` IS A THUNK, NOT A VALUE, SAME REASON AS `link-wiring.ts` AND `draw.ts`. `main.ts` declares
 * `let view: EditorView` and does not assign it until the `EditorView` construction runs, after this
 * factory is called — so a value parameter would capture `undefined` forever. `links` (`LinkWiring`)
 * and `draw`, by contrast, are real values here, not thunks: both are already-assigned by the point
 * this factory is called, unlike the `let`s `link-wiring.ts` and `draw.ts` themselves close over
 * earlier in construction.
 *
 * `panes: PaneCollection`: `setProgram`, reached through `setLegProgram` below, which retains what it
 * pushes, is PER-SESSION: it belongs to the session whose worker sent the reply, routed through
 * `panes.ofSession(leg, session)`.
 *
 * **THE PROGRAM'S RESULT IS STORED, NOT RENDERED HERE** (Plan 7 part 2 spec §9): `setProgram` hands it to
 * `main.ts`, and `draw()` renders it into the strip with the frame's other facts, so a frame with no reply
 * behind it, a switch of the readout among them, draws it again.
 *
 * **NO `root: HTMLElement`.** The handler does not read it — `showBanner(root, ...)` is `main.ts`'s wasm-load
 * and worker-spawn failure surface (`banner.ts`'s own doc has the split), and both of those failures
 * happen before or outside a reply ever exists. The failure surface a reply handler DOES use is
 * `showWorkerError`, reached through `setProgram`'s `error` kind and `readout.ts`, which renders it
 * into `#results`.
 *
 * Section citations here are the 5d-i design's unless they name another.
 */
export function createReplies(deps: {
  sessions: SessionRegistry
  results: HTMLElement
  view: () => EditorView
  panes: PaneCollection
  links: LinkWiring
  trees: LambdaTrees
  /**
   * `UnseenViews`' set. Optional: a caller that never hides a view and has none a `clif-listing` could leave unseen
   * (every direct test of this module) needs none, and gets a set nothing reads.
   */
  unseen?: UnseenViews
  draw: () => void
  /**
   * Schedule a callback for the next paint — `requestAnimationFrame`, injectable so a node test can drive
   * the schedule by hand instead of waiting on a real display. Optional: the app passes none and gets the
   * real one, `player.ts`'s own dependency, for the identical reason. Used only to coalesce the redraws of
   * the replies that arrive in a stream — `scheduleDraw` below names them and says why the rest still call
   * `draw()` straight.
   */
  frame?: (cb: () => void) => void
  /** Store the program's result, or its failure, for the readout (`readout.ts`'s `ProgramResult`). */
  setProgram: (r: ProgramResult) => void
  /**
   * The page's CLIF state beside the program's legs: `loaded` takes where the `pkg-clif` load stands from each
   * `clif-load`, and `settled` tells the page's `ClifSync` (`clif-sync.ts`) that the program's run has answered, so
   * that a `clif` request may go. `absent` says the leg has no stepper, so that the result the page stored loses its
   * CLIF part. Optional, for `unseen`'s reason: a caller that shows no CLIF view needs none of them.
   */
  clif?: { loaded(state: 'loading' | 'ready' | 'failed'): void; settled(): void; absent(): void }
  /**
   * The page's machine code (`machine-code.ts`'s `MachineCode`): each `compiled`'s generation, where each target's
   * package load stands, from each `mc-load`, and each `mc` answer. Optional, for `clif`'s reason.
   */
  mc?: {
    compiled(gen: number): void
    loaded(target: McTarget, state: 'loading' | 'ready' | 'failed'): void
    answered(reply: Extract<RunReply, { kind: 'mc' }>): void
  }
}): {
  onReply(session: SessionId, reply: RunReply): void
} {
  const {
    sessions,
    results,
    view,
    panes,
    links: linkWiring,
    trees,
    unseen = new WeakSet(),
    draw,
    frame = (cb: () => void) => void requestAnimationFrame(cb),
    setProgram,
    clif,
    mc,
  } = deps

  /**
   * Store `compiled` as `session`'s `leg` program and hand `tell` every `leg` view bound to it that is on the page;
   * one off it goes in `unseen` instead, and `draw()` seeds it from the entry when it is shown. **THE STORE AND THE
   * FAN-OUT ARE ONE CALL** because `draw()` seeds a view shown later from the entry, so an entry written apart from
   * the fan-out could seed it with a program the views on the page were never told. **`tell` IS ALL A VIEW ON THE
   * PAGE HEARS, ITS PROGRAM INCLUDED**, in this one pass over the views rather than a second: this call tells no view
   * `compiled`, so each caller's `tell` pushes it, or adds the view to `unseen` for `draw()`'s seed to push.
   */
  const storeAndSetProgram = <K extends keyof LegProgram>(
    session: SessionId,
    leg: K,
    compiled: LegProgram[K] | null,
    tell: (pane: PaneView<LegFrame[K]>) => void,
  ): void => {
    sessions.entryOf(session).programs[leg] = compiled
    for (const p of panes.ofSession(leg, session)) {
      // **A VIEW OFF THE PAGE IS NOT TOLD NOW** (Plan 7 part 4 spec §5.5): the session keeps what it was told,
      // above, and `draw()` seeds the view from it when its tab is next shown. Building a hidden view's δ table
      // on every compile is the cost this skips.
      if (!p.host.isConnected) {
        unseen.add(p.pane)
        continue
      }
      tell(p.pane)
    }
  }

  /**
   * What a view on the page hears when a compile gives or clears its session's program: `seedTm` and `seedRxm` tell
   * the machine views, and a CLIF view takes its listing.
   */
  const TELL: {
    readonly [K in keyof LegProgram]: (
      session: SessionId,
      compiled: LegProgram[K] | null,
    ) => (pane: PaneView<LegFrame[K]>) => void
  } = {
    rxm: (_session, compiled) => (pane) => seedRxm(pane as RxmPane, compiled),
    tm: (_session, compiled) => (pane) => seedTm(pane as TmPane, compiled),
    // `null` FROM A COMPILE, WHICH CARRIES NO CLIF: a `clif-listing` leaves its views to `draw()`'s seed.
    clif: (_session, compiled) => (pane) => (pane as ClifPane).setProgram(compiled),
  }

  /** Store `session`'s `leg` program and tell its views on the page, as `TELL` says: a compile's, or `null`. */
  const setLegProgram = <K extends keyof LegProgram>(
    session: SessionId,
    leg: K,
    compiled: LegProgram[K] | null,
  ): void => storeAndSetProgram(session, leg, compiled, TELL[leg](session, compiled))

  /** `TELL`'s keys, so every leg `LegProgram` names; the cast restates them, for `LEGS`' reason (`legs.ts`). */
  const PROGRAM_LEGS = Object.keys(TELL) as (keyof LegProgram)[]

  /** `setLegProgram` for every program leg, each given its program from `programs`, or `null` for none. */
  const setLegPrograms = (
    session: SessionId,
    programs: { readonly [K in keyof LegProgram]: LegProgram[K] | null } | null,
  ): void => {
    PROGRAM_LEGS.forEach(<K extends keyof LegProgram>(leg: K) => {
      setLegProgram(session, leg, programs === null ? null : programs[leg])
    })
  }

  /**
   * Coalesce a redraw to at most one per animation frame, for the reply that arrives in a stream: every `frames` chunk,
   * whichever leg it carries, that does not end its recording, which `record-loop.ts`'s `recordLeg` posts
   * once per `RECORD_CHUNK` while any leg records. It comes far more often than a display paints, and a `draw()`
   * per reply is a full, synchronous redraw the browser cannot skip, even behind a hidden tab.
   *
   * `drawPending` IS SHARED ACROSS EVERY ARM AND EVERY SESSION, not kept per arm or per session: `draw()` repaints the
   * whole app from live state, whichever reply asked for it, so one pending frame already covers every reply that
   * lands before it fires — the same way one `draw()` call always has. Each reply applies its own state at once;
   * only the paint waits.
   *
   * `scheduleDraw` is what such a reply calls: the first one in a burst schedules a frame and flips the flag, and
   * every reply that lands before that frame fires is absorbed (the flag is already set, so the call is a no-op)
   * rather than scheduling a second one. When the frame fires it checks the flag again before drawing, because
   * `flushDraw` may have cleared it first — see below.
   *
   * `flushDraw` is what the reply that ends a recording calls: it clears the flag and draws right away, without waiting
   * on whatever frame is already scheduled — a hidden tab may never paint one, and a rewound leg's recording is
   * followed by no `result` reply that would paint its last frame and its `ended` or `budget` instead. Clearing the
   * flag first, rather than leaving it set, is what stops that earlier frame from drawing a second time once it fires —
   * a browser's own `requestAnimationFrame` cannot be uncalled, so the guard is the flag, not the callback.
   *
   * **EVERY OTHER ARM STILL CALLS `draw()` STRAIGHT.** Each arrives once per build, gesture or step rather than in a
   * stream, and several rely on painting in the same task: `result` flips `#results` to idle, and the readout must
   * say the same thing at the same moment; `compiled`, `no-session` and `worker-error` dispatch the source editor's
   * decorations, which must not appear half-updated beside the running focus `draw()` sets; and `lambda-tree`'s
   * `draw()` is what asks the worker for the next tree a view wants.
   */
  let drawPending = false
  const scheduleDraw = (): void => {
    if (drawPending) return
    drawPending = true
    frame(() => {
      if (!drawPending) return
      drawPending = false
      draw()
    })
  }
  const flushDraw = (): void => {
    drawPending = false
    draw()
  }

  /**
   * One `frames` chunk applied to its session's leg: its frames pushed, each sized by its leg's `LEG_FRAME_BYTES`,
   * its end and generation set, and a draw asked for as `scheduleDraw`'s doc says. **A CHUNK OF ANOTHER EPOCH THAN THE
   * LEG'S IS DROPPED WHOLE**: it is from a recording a rewind replaced, posted before the worker took the rewind, and
   * the page emptied the ring for the rewound recording at the press.
   */
  const pushFrames = <K extends Leg>(session: SessionId, reply: FramesReply<K>): void => {
    const leg = sessions.legOf({ session, leg: reply.leg })
    if (reply.epoch !== leg.epoch) return
    if (leg.clifHold !== undefined && !takeHeld(session, reply.gen, reply.epoch)) return
    leg.gen = reply.gen
    const bytes = LEG_FRAME_BYTES[reply.leg]
    for (const f of reply.frames) leg.hist.push(f, bytes(f))
    leg.done = reply.done
    if (reply.done === null) scheduleDraw()
    else flushDraw()
  }

  /**
   * `compiled` as `session`'s CLIF program, which sets the leg's status, as `compiled` sets every leg's: a run that
   * carried no listing left the leg unavailable, which would hold every step control of a view shown since off, and a
   * program with no CLIF gives the leg its reason. **EVERY CLIF VIEW IS LEFT TO `draw()`'S SEED, NOT TOLD HERE**: a
   * listing lands without a compile, so a pin can stand when it does, and the seed gives the pin back after the view's
   * render, as for a view shown after compiles it missed. Told here, the view's `setProgram` would drop the pin's marks
   * with nothing to restore them.
   */
  const showClif = (session: SessionId, compiled: ClifCompiled): void => {
    sessions.legOf({ session, leg: 'clif' }).status =
      'listing' in compiled ? { available: true, reason: '' } : { available: false, reason: compiled.error }
    storeAndSetProgram(session, 'clif', compiled, (pane) => unseen.add(pane))
  }

  /**
   * The first chunk of epoch `epoch` on `session`'s held CLIF leg (`ClifHold`): the ring is emptied of the recording
   * it replaces and the listing that came for the epoch shown, **IN THE TASK THAT PUSHES THE CHUNK**, so the next draw
   * goes from the old listing's frames to the new one's step 0 at once. Says whether the chunk may be pushed.
   *
   * **WITH NO LISTING FOR ITS GENERATION AND EPOCH, THE CHUNK IS DROPPED AND THE HOLD STAYS.** The worker posts the
   * listing before it records, so this is a page out of step with it; pushed, the frames would be drawn under the rows
   * of the listing the hold keeps, which they were not recorded against. Held, the view shows that listing as it was,
   * frames and all, until a reset, a hide or another request ends the hold.
   */
  const takeHeld = (session: SessionId, gen: number, epoch: number): boolean => {
    const leg = sessions.legOf({ session, leg: 'clif' })
    const landing = leg.clifHold?.landing
    if (landing === undefined || landing.gen !== gen || landing.epoch !== epoch) return false
    leg.hist.clear()
    leg.done = null
    delete leg.clifHold
    showClif(session, landing.compiled)
    return true
  }

  /** `leg`'s step-0 frame from a build reply into its emptied ring, sized as `pushFrames` sizes a chunk's. */
  const seedFirst = <K extends Leg>(session: SessionId, leg: K, first: LegFrame[K] | null, gen: number): void => {
    if (first === null) return
    const state = sessions.legOf({ session, leg })
    state.gen = gen
    state.hist.push(first, LEG_FRAME_BYTES[leg](first))
  }

  /**
   * One session's replies, applied to that session's legs.
   *
   * THE SESSION IS A PARAMETER, NOT A CLOSED-OVER CONST, even though exactly one exists. A reply
   * belongs to the session whose worker sent it and to nothing else — §3.2's "the port is the id" is
   * precisely the claim that this pairing is established at the port and cannot be recovered from the
   * message. Resolving it here keeps this function from quietly being *the source session's* reply
   * handler under a name that says otherwise.
   *
   * `index`/`linkable`/`link` ARE NOT PER SESSION EITHER, and live behind `linkWiring` — see
   * `LinkWiring`'s own doc (`link-wiring.ts`) for why the three live in one module. The `results`/`view`
   * writes below are closed over directly: they are the app's one results pane and one editor.
   */
  const onReply = (session: SessionId, reply: RunReply): void => {
    const { legs } = sessions.entryOf(session)
    switch (reply.kind) {
      case 'lambda-tree':
        trees.store(session, reply.gen, reply.tree)
        draw()
        return
      case 'no-session':
        results.dataset.state = 'idle'
        setProgram({ kind: 'no-session', diagnostics: reply.diagnostics })
        // STALE FRAMES MUST NOT SURVIVE A BROKEN PROGRAM. A pane still showing the last good run
        // under source that does not compile is the worst of both answers.
        resetLegs(legs, {}, 'not compiled')
        // NOTHING TO SHOW, AND THE SESSION IS LEFT HOLDING NOTHING EITHER — one call, so a view shown
        // later, which `draw()` seeds from the entry, reads what the views on the page were just told.
        setLegPrograms(session, null)
        linkWiring.setIndex(null)
        view().dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
        // `draw()` calls `drawLink()` itself, after its render loop and before its readout pass.
        draw()
        // THE RUN HAS ANSWERED, so the sync may post again. With no session the worker drops a `clif` request, and the
        // next run carries the listing.
        clif?.settled()
        return
      case 'compiled':
        mc?.compiled(reply.gen)
        resetLegs(legs, reply.statuses)
        // THE NEW PROGRAM'S STEP 0 GOES IN WITH THE RESET, before the one `draw()` below, so every view goes from the
        // old program's picture to the new one's in one frame: drawn from the emptied rings, it would be blank first.
        for (const leg of LEGS) seedFirst(session, leg, reply.first[leg], reply.gen)
        if (reply.lambdaTree !== null) trees.seed(session, reply.gen, reply.lambdaTree)
        // THE ONE REPLY THAT CARRIES A MACHINE, RETAINED AS IT IS FANNED OUT.
        setLegPrograms(session, reply.programs)
        linkWiring.setIndex(reply.linkIndex === null ? null : new LinkIndex(reply.linkIndex))
        // `setLink.of(null)` HERE TOO, NOT ONLY `setDecline`. `linkMark` clears its own decoration on
        // `docChanged`, which covers the ordinary typing path — but the `#encoding` picker's `change`
        // listener (`compile.ts`) calls `schedule` with NO document edit at all, so a `compiled` reply from
        // switching encodings can land with the `.linked` mark still painted from the PREVIOUS compile's
        // index. `link` is already cleared above; this is what makes the source pane agree. Combined
        // into one dispatch with `setDecline` so the two decorations never appear half-updated for a
        // frame.
        view().dispatch({ effects: [setDecline.of(reply.declinedSpan), setLink.of(null)] })
        draw()
        // AFTER THE RESET, which put the CLIF leg's epoch back to 0: a request posted now raises it from there, and the
        // worker has taken this run's session, so it hears the request rather than dropping it.
        clif?.settled()
        return
      // RESOLVED THROUGH `legOf`, NOT READ OFF `legs` DIRECTLY, because a session's legs are optional and a reply
      // naming a leg its session does not have is a wiring bug rather than a state to render. `legOf`'s throw is the
      // one policy for that whole class — see its doc — and reusing it here is what keeps this file from inventing a
      // second answer (a silent drop) for the same question.
      case 'frames':
        pushFrames(session, reply)
        return
      case 'result': {
        results.dataset.state = 'idle'
        // **DURING A CLIF HOLD, A RESULT OF THE HOLD'S GENERATION KEEPS THE CLIF PART THE PAGE HELD**
        // (`ClifHold.part`): one of another request, a TM `[continue]`'s, carries no CLIF part once the worker has
        // dropped the stepper the hold replaces, and the readout would lose its CLIF rows and move every view before
        // the CLIF view changed.
        const part = sessions.legOf({ session, leg: 'clif' }).clifHold?.part
        const kept = part !== undefined && part.gen === reply.gen ? { ...reply.legs, clif: part.clif } : reply.legs
        setProgram({ kind: 'result', gen: reply.gen, legs: kept, pinned: reply.pinned })
        draw()
        return
      }
      case 'worker-error':
        // See `main.ts`'s constructor-time `worker.addEventListener('error', ...)` for the sibling
        // failure this answers: that one is a module that never loaded, this one is a session call
        // that threw after it did. Both would otherwise leave a pane on "running…" forever — but
        // unlike that one, the app itself is still alive here, so the response renders INTO `#results`
        // (`showWorkerError`, through `setProgram` and the readout) rather than replacing `#views`
        // (`showBanner`'s job is the other case; see `banner.ts`'s doc for the split).
        // `resetLegs`/`setProgram`/`setDecline`/`draw` below all run against the live nodes, which
        // nothing here replaces.
        results.dataset.state = 'idle'
        // STALE FRAMES MUST NOT SURVIVE A BROKEN PROGRAM, same as `no-session` above. `compile()`
        // throws by design for an unknown encoding (`redextape-wasm`'s `compile` doc) from inside
        // `onRun`, before any session exists — so a `worker-error` from a fresh `client.request()` is
        // not only a call that threw mid-record on top of a live session; it can also mean there was
        // never a new session at all, and the panes are still showing the PREVIOUS program's frames
        // under a message saying the app broke. Either way there is no session, which is what "not
        // compiled" means, since a `compile()` that threw never produced one.
        resetLegs(legs, {}, 'not compiled')
        // NOTHING TO SHOW AND NOTHING RETAINED, same as the `no-session` arm above.
        setLegPrograms(session, null)
        linkWiring.setIndex(null)
        view().dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
        setProgram({ kind: 'error', error: new Error(reply.message) })
        draw()
        return
      // **IDEMPOTENT**: every CLIF pass says the load again, so two passes that overlap say `ready` twice.
      case 'clif-load':
        clif?.loaded(reply.state)
        draw()
        return
      case 'mc-load':
        mc?.loaded(reply.target, reply.state)
        draw()
        return
      // ANOTHER GENERATION'S NEVER GETS HERE (`SessionClient` drops it), so an answer is the program's as it now stands.
      case 'mc':
        mc?.answered(reply)
        draw()
        return
      // ANOTHER GENERATION'S NEVER GETS HERE (`SessionClient` drops it). ONE OF ANOTHER EPOCH IS DROPPED: it answers a
      // request a newer one replaced, and the page emptied the leg, or held it, for the newer one as it posted it.
      case 'clif-listing': {
        const leg = sessions.legOf({ session, leg: 'clif' })
        if (reply.epoch !== leg.epoch) return
        const compiled: ClifCompiled =
          reply.listing === null ? { error: reply.error } : { listing: reply.listing, level: reply.level }
        // **A LISTING FOR A HELD RING WAITS FOR ITS FIRST FRAMES** (`ClifHold.landing`), and the ring keeps the frames
        // of the listing it replaces on the page until they come. A reason has no frames to wait for, and empties the
        // ring.
        if (reply.listing !== null && leg.clifHold !== undefined) {
          leg.clifHold.landing = { gen: reply.gen, epoch: reply.epoch, compiled }
          return
        }
        if (leg.clifHold !== undefined) {
          leg.hist.clear()
          leg.done = null
          delete leg.clifHold
        }
        showClif(session, compiled)
        // **A LEG TOLD WHY IT HAS NO LISTING HAS NO STEPPER**, and a stepper dropped for what it threw as a
        // `[continue]` or a rewind began is followed by no `result` to say so: the readout would keep its rows beside
        // the view's reason.
        if (reply.listing === null) clif?.absent()
        draw()
        return
      }
      default:
        unhandled(reply)
    }
  }
  return { onReply }
}
