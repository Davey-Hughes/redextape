import type { EditorView } from '@codemirror/view'
import type { AsmPane } from './asm-pane'
import { seedAsm } from './asm-seed'
import type { EditablePane } from './editor-custody'
import { setDecline, setLink } from './highlight'
import type { LambdaTrees } from './lambda-trees'
import { unhandled } from './legs'
import { LinkIndex } from './link'
import type { LinkWiring } from './link-wiring'
import type { Notice } from './notice'
import type { PaneCollection } from './panes'
import { asmFrameBytes, lambdaFrameBytes, type RunReply, ruleCount, tmFrameBytes } from './protocol'
import type { ProgramResult } from './readout'
import type { ScratchBuffers } from './scratch'
import type { SessionId } from './session-client'
import { type AsmCompiled, resetLegs, type SessionRegistry, type TmCompiled } from './sessions'
import type { TmPane } from './tm-pane'

/**
 * `onReply` AND `onScratchReply` — the two reply switches. See each function's own doc below for what it
 * does; this one is only about the dependencies.
 *
 * `view` IS A THUNK, NOT A VALUE, SAME REASON AS `link-wiring.ts` AND `draw.ts`. `main.ts` declares
 * `let view: EditorView` and does not assign it until the `EditorView` construction runs, after this
 * factory is called — so a value parameter would capture `undefined` forever. `links` (`LinkWiring`)
 * and `draw`, by contrast, are real values here, not thunks: both are already-assigned by the point
 * this factory is called, unlike the `let`s `link-wiring.ts` and `draw.ts` themselves close over
 * earlier in construction.
 *
 * `panes: PaneCollection`: `setProgram`, reached through `setTmProgram` below, which retains what it
 * pushes, is PER-SESSION: it belongs to the session whose worker sent the reply, routed through
 * `panes.ofSession('tm', session)`, while `setEditor` keeps exactly one target; see that call's own
 * comment for why generalising it to "every pane bound to this session" is not the same move.
 *
 * **THE PROGRAM'S RESULT IS STORED, NOT RENDERED HERE** (Plan 7 part 2 spec §9): `setProgram` hands it to
 * `main.ts`, and `draw()` renders it into the strip when the focused view shows the program. Rows written
 * straight into `#results` would be wrong the moment a copy's view held the focus.
 *
 * `editorHome` is read by each copy build's arm — `scratch-compiled`, `tm-scratch-compiled` and
 * `asm-scratch-compiled` — which mounts text onto the home pane, and by `worker-error`, which unmounts from
 * a pane whose session is still live and still bound.
 *
 * **NO `root: HTMLElement`.** Neither handler reads it — `showBanner(root, ...)` is `main.ts`'s wasm-load
 * and worker-spawn failure surface (`banner.ts`'s own doc has the split), and both of those failures
 * happen before or outside a reply ever exists. The failure surface a reply handler DOES use is
 * `showWorkerError`, reached through `setProgram`'s `error` kind and `readout.ts`, which renders it
 * into `#results`.
 *
 * Section citations here are the 5d-i design's unless they name another.
 */
export function createReplies(deps: {
  sessions: SessionRegistry
  scratchpad: ScratchBuffers
  results: HTMLElement
  view: () => EditorView
  panes: PaneCollection
  links: LinkWiring
  trees: LambdaTrees
  /**
   * TM and asm views a machine reached while they were off the page — `draw()` seeds each when it is next shown. Optional:
   * a caller that never hides a view (every direct test of this module) needs none, and gets a set nothing reads.
   */
  unseen?: WeakSet<TmPane | AsmPane>
  draw: () => void
  /**
   * Schedule a callback for the next paint — `requestAnimationFrame`, injectable so a node test can drive
   * the schedule by hand instead of waiting on a real display. Optional: the app passes none and gets the
   * real one, `player.ts`'s own dependency, for the identical reason. Used only to coalesce the redraws of
   * the replies that arrive in a stream — `scheduleDraw` below names them and says why the rest still call
   * `draw()` straight.
   */
  frame?: (cb: () => void) => void
  /**
   * The pane currently holding `session`'s editor, or `undefined` if none currently is. The
   * editor-moves rule (5d-ii-a design §4.3) is what makes "which pane" a real question with more than
   * one candidate answer, and `editor-custody.ts`'s `editorHomeFor` is the one place that answers it,
   * since only it holds `editorOwner`. `undefined` rather than a throw, because the recorded owner can
   * be stale (its pane closed, or rebound away) rather than a wiring bug — a reply landing on a session
   * with nowhere to mount its editor has nothing to do, not an invariant to raise about.
   *
   * **IT TAKES THE SESSION.** 5d-ii-c decision 1 leaves no fixed scratch id, and every arm below already
   * has the reply's own session in scope, so the id travels with the reply rather than being assumed by
   * the wiring.
   */
  editorHome: (session: SessionId) => EditablePane | undefined
  /**
   * A buffer's text of record has just changed — the stored payload is stale until this returns.
   *
   * **THE `scratch-compiled` ARM IS WHERE A FORKED BUFFER'S TEXT FIRST EXISTS AT ALL**, so without this
   * dependency a term the user forked would live in `ScratchBuffers` and never reach `localStorage`.
   * `ScratchBuffers.setText`'s own doc names its two writers: `recompile`, which the user reaches by
   * typing, and this arm, which the worker reaches by answering. Both store what they write: `recompile`'s
   * caller, `transport.ts`'s `editSink`, through its own `onBuffersPersist`, and this arm through this one.
   *
   * A CALLBACK RATHER THAN THIS FILE WRITING STORAGE. `main.ts` holds the guarded writer and the
   * `PaneCollection` the `bindings` are read off; a `localStorage` call here would be a second place
   * the key, the envelope and the quota-failure policy are decided.
   */
  onBuffersPersist: () => void
  /**
   * Say a refusal or a failure — `notice.ts`'s `notify`. The `Notice` it answers is what lets the notice that a copy
   * did not build end when a build of that copy lands.
   */
  notify: (text: string) => Notice
  /** Store the program's result, or its failure, for the readout (`readout.ts`'s `ProgramResult`). */
  setProgram: (r: ProgramResult) => void
}): {
  onReply(session: SessionId, reply: RunReply): void
  onScratchReply(session: SessionId, reply: RunReply): void
} {
  const {
    sessions,
    scratchpad,
    results,
    view,
    panes,
    links: linkWiring,
    trees,
    unseen = new WeakSet<TmPane | AsmPane>(),
    draw,
    frame = (cb: () => void) => void requestAnimationFrame(cb),
    editorHome,
    onBuffersPersist,
    notify,
    setProgram,
  } = deps

  /**
   * The notice saying a copy did not build, with the copy it names, until a build of that copy lands — `built` below.
   *
   * **ONE, NOT ONE PER COPY: THE LINE SHOWS ONE NOTICE AT A TIME** (`notice.ts`), so only the newest can still be on
   * it. An older copy's was drawn over when a newer notice was said, and a `Notice`'s `dismiss` does nothing once
   * its notice is no longer the one on the line, so a stale one can never end what another gesture has said since.
   */
  let failure: { readonly session: SessionId; readonly notice: Notice } | null = null

  /**
   * A build of `session` landed: end the notice saying it did not build, if that is still the one on the line. Left
   * up, it would go on saying the copy did not build over a copy that now runs, for the rest of its eight seconds.
   */
  const built = (session: SessionId): void => {
    if (failure?.session !== session) return
    failure.notice.dismiss()
    failure = null
  }

  /**
   * Store `compiled` on `session`'s entry and fan `setProgram` out to every TM pane bound to it that is
   * on the page — one off it goes in `unseen` instead, and `draw()` seeds it from the entry when it is
   * shown. The half `setTmProgram` and the `tm-scratch-compiled` arm below share. Both callers need "the
   * entry agrees with what the panes were just told", and that is why the store and the fan-out are one
   * call: `draw()` seeds a view shown later from the entry, so an entry written apart from the fan-out
   * could seed it with a machine the views on the page were never told. Both callers also need it on the
   * SAME per-pane pass a second per-pane fact rides on — `then`, run immediately after `setProgram` for
   * each pane in turn, is that second fact:
   * `setForkAvailable` for `setTmProgram` below, `setScratchStatus` for `tm-scratch-compiled`. Passing
   * it in rather than duplicating the loop is what keeps each caller's own second concern off a SECOND
   * pass over `panes.ofSession('tm', session)`.
   */
  const storeAndSetProgram = (
    session: SessionId,
    compiled: TmCompiled | null,
    then?: (pane: TmPane, rules: number) => void,
  ): void => {
    sessions.entryOf(session).tmProgram = compiled
    const rules = compiled === null ? 0 : ruleCount(compiled.program)
    for (const p of panes.ofSession('tm', session)) {
      const pane = p.pane as TmPane
      // **A VIEW OFF THE PAGE IS NOT TOLD NOW** (Plan 7 part 4 spec §5.5): the session keeps what it was told,
      // above, and `draw()` seeds the view from it when its tab is next shown. Building a hidden view's δ table
      // on every compile is the cost this skips.
      if (!p.host.isConnected) {
        unseen.add(pane)
        continue
      }
      pane.setProgram(compiled?.program ?? null, compiled?.tapeNames ?? [])
      then?.(pane, rules)
    }
  }

  /**
   * Tell every TM pane on `session` that is on the page what machine it is showing AND whether it may be
   * forked, leaving both on the session's entry — `storeAndSetProgram` above plus the one fact only THIS
   * caller adds. A pane off the page hears both when it is shown, from `draw()`'s seed.
   *
   * **`setForkAvailable` RIDES THE SAME FAN-OUT, NOT A SECOND LOOP.** A pane seeded with a machine is
   * exactly a pane that needs to be told whether that machine may be forked; splitting the two into
   * separate passes over `panes.ofSession('tm', session)` would be two chances for one to run and the
   * other not to. `compiled?.tmText ?? null`, the rule count, and `compiled?.tmResultDecodable`
   * all fall out of the SAME `compiled` this call already stores — see `TmCompiled.tmText`'s own doc for
   * why the fields ride beside `program` rather than on a second envelope.
   *
   * **ONLY THIS CALLER PASSES A `tmText` THAT MEANS ANYTHING.** `tm-scratch-compiled` (below) calls
   * `storeAndSetProgram` directly, with no `then` for fork availability at all, precisely because that
   * reply carries no `tmText` (its own doc: "no text echo" — the main thread already holds what built
   * the scratch) — routing a bare `null` through THIS function would read as "over the cap", which is
   * a lie for a scratch that was never offered a fork control in the first place. See that arm's own
   * comment.
   */
  const setTmProgram = (session: SessionId, compiled: TmCompiled | null): void => {
    storeAndSetProgram(session, compiled, (pane, rules) =>
      pane.setForkAvailable(compiled?.tmText ?? null, rules, compiled?.tmResultDecodable ?? true),
    )
  }

  /**
   * Store `session`'s asm listing on its entry and tell every asm view bound to it that is on the page, by
   * `storeAndSetProgram`'s rule: a view off the page goes in `unseen`, and `draw()` seeds it from the entry when it is
   * shown. One call, so the entry always agrees with what the views were told.
   */
  const setAsmProgram = (session: SessionId, compiled: AsmCompiled | null): void => {
    const entry = sessions.entryOf(session)
    entry.asmProgram = compiled
    for (const p of panes.ofSession('asm', session)) {
      const pane = p.pane as AsmPane
      if (!p.host.isConnected) {
        unseen.add(pane)
        continue
      }
      // EVERYTHING THE SESSION KEEPS, THROUGH THE ONE SEED A VIEW BUILT LATER GETS: the listing, whether it can be
      // copied, and a copy's value, which its build reply writes on the entry before this runs.
      seedAsm(pane, compiled, entry.asmScratch)
    }
  }

  /**
   * Coalesce a redraw to at most one per animation frame, for the replies that arrive in a stream: a TM copy's
   * `tm-value` while its run is `Running`, which the worker posts once per `VALUE_CHUNK`, and every `lambda-frames`,
   * `tm-frames` and `asm-frames` chunk that does not end its recording, which `record-loop.ts`'s `recordLeg` posts
   * once per `RECORD_CHUNK` while any leg records. Either comes far more often than a display paints, and a `draw()`
   * per reply is a full, synchronous redraw the browser cannot skip, even behind a hidden tab.
   *
   * `drawPending` IS SHARED ACROSS EVERY ARM AND EVERY SESSION, not kept per arm or per copy: `draw()` repaints the
   * whole app from live state, whichever reply asked for it, so one pending frame already covers every reply that
   * lands before it fires — the same way one `draw()` call always has. Each reply applies its own state at once;
   * only the paint waits.
   *
   * `scheduleDraw` is what such a reply calls: the first one in a burst schedules a frame and flips the flag, and
   * every reply that lands before that frame fires is absorbed (the flag is already set, so the call is a no-op)
   * rather than scheduling a second one. When the frame fires it checks the flag again before drawing, because
   * `flushDraw` may have cleared it first — see below.
   *
   * `flushDraw` is what the reply that ends a value run or a recording calls: it clears the flag and draws right
   * away, without waiting on whatever frame is already scheduled — a hidden tab may never paint one, and a copy's
   * recording is followed by no `result` reply that would paint its last frame and its `ended` or `budget` instead.
   * Clearing the flag first, rather than leaving it set, is what stops that earlier frame from drawing a second time
   * once it fires — a browser's own `requestAnimationFrame` cannot be uncalled, so the guard is the flag, not the
   * callback.
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
        setTmProgram(session, null)
        setAsmProgram(session, null)
        linkWiring.setIndex(null)
        view().dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
        // `draw()` calls `drawLink()` itself, after its render loop and before its readout pass.
        draw()
        return
      case 'compiled':
        resetLegs(legs, { lambda: reply.lambda, asm: reply.asm, tm: reply.tm })
        setAsmProgram(session, reply.asmProgram === null ? null : { program: reply.asmProgram, asmText: reply.asmText })
        // THE ONE REPLY THAT CARRIES A MACHINE, RETAINED AS IT IS FANNED OUT. `tmProgram` is `null` on the
        // wire for a program with no TM leg, so a reply with no machine in it leaves the session holding
        // nothing rather than an envelope around a `null`.
        setTmProgram(
          session,
          reply.tmProgram === null
            ? null
            : {
                program: reply.tmProgram,
                tapeNames: reply.tapeNames,
                tmText: reply.tmText,
                tmResultDecodable: reply.tmResultDecodable,
              },
        )
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
        return
      // RESOLVED THROUGH `legOf`, NOT READ OFF `legs` DIRECTLY, because a session's legs are optional
      // (§4.1: a `LambdaScratch` has one leg) and a reply naming a leg its session does not have
      // is a wiring bug rather than a state to render. `legOf`'s throw is the one policy for that
      // whole class — see its doc — and reusing it here is what keeps this file from inventing a
      // second answer (a silent drop) for the same question.
      case 'lambda-frames': {
        const leg = sessions.legOf({ session, leg: 'lambda' })
        for (const f of reply.frames) leg.hist.push(f, lambdaFrameBytes(f))
        leg.done = reply.done
        if (reply.done === null) scheduleDraw()
        else flushDraw()
        return
      }
      case 'tm-frames': {
        const leg = sessions.legOf({ session, leg: 'tm' })
        for (const f of reply.frames) leg.hist.push(f, tmFrameBytes(f))
        leg.done = reply.done
        if (reply.done === null) scheduleDraw()
        else flushDraw()
        return
      }
      case 'asm-frames': {
        const leg = sessions.legOf({ session, leg: 'asm' })
        for (const f of reply.frames) leg.hist.push(f, asmFrameBytes(f))
        leg.done = reply.done
        if (reply.done === null) scheduleDraw()
        else flushDraw()
        return
      }
      case 'result':
        results.dataset.state = 'idle'
        setProgram({ kind: 'result', gen: reply.gen, lambda: reply.lambda, asm: reply.asm, tm: reply.tm })
        draw()
        return
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
        setTmProgram(session, null)
        setAsmProgram(session, null)
        linkWiring.setIndex(null)
        view().dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
        setProgram({ kind: 'error', error: new Error(reply.message) })
        draw()
        return
      // FIVE KINDS THAT NEVER REACH THE PROGRAM'S SESSION, WRITTEN OUT so that a kind added to `RunReply` is a
      // type error at `unhandled` below rather than a reply this switch drops with `tsc` green (Plan 7 part 5's
      // spec, amendment 8). `scratch-compiled`, `tm-scratch-compiled` and `asm-scratch-compiled` answer a copy's
      // build, which only `ScratchBuffers` posts; `tm-value` is a TM copy's value run and `asm-value` an asm copy's
      // value after a `[continue]`, where the program's value arrives in `result`.
      case 'scratch-compiled':
      case 'tm-scratch-compiled':
      case 'tm-value':
      case 'asm-scratch-compiled':
      case 'asm-value':
        return
      default:
        unhandled(reply)
    }
  }

  /**
   * One scratch BUFFER's reply, applied to that buffer's one leg; the `session` parameter says
   * which buffer.
   *
   * A SECOND HANDLER RATHER THAN BRANCHES IN `onReply`: what the two do not share is everything `onReply`
   * does with the link index, `results` and `view`, none of which a detached session has any claim on
   * (§3.3: no `linkIndex`, no `sourceSpan`, no `ty`).
   *
   * AN ARM FOR EVERY KIND, AND `unhandled` AS THE `default`. `session-worker.ts` answers a
   * `lambda-scratch` request with exactly `scratch-compiled`, `lambda-frames`, `no-session` or
   * `worker-error`; a `tm-scratch` request with `tm-scratch-compiled`, `tm-frames`, `tm-value`,
   * `no-session` or `worker-error` (`onTmScratch`, `session-worker.ts`'s TM counterpart to
   * `onLambdaScratch`); and an `asm-scratch` request with `asm-scratch-compiled`, `asm-frames`, `no-session` or
   * `worker-error` (`onAsmScratch`), and its `[continue]` with `asm-value`. `tm-value` and `asm-value` are the
   * machine legs' extra shapes: a headered TM buffer's value run reports through the first, and an asm copy's
   * value read again once `[continue]` carries it past its build's cap through the second, where a compiled
   * session's value arrives in `result`. A λ copy's views ask for `lambda-tree` too. `compiled`/`result`
   * need a `SourceMap`/`ty` no buffer has, on any leg, so their arm does nothing — written out for the reason
   * `onReply`'s own do-nothing arm is. `no-session` and `worker-error` are genuinely shared, one arm apiece for
   * every leg — a buffer's failure to build or its worker's death read the same whichever leg minted it.
   * `lambda-frames`, `tm-frames` and `asm-frames` are not shareable in the same way (`hist.push` closes over a
   * different `LegState`), so each gets its own arm; `scratch-compiled`, `tm-scratch-compiled` and
   * `asm-scratch-compiled` likewise, because their payloads share no field (`tm-scratch-compiled`'s own doc in
   * `protocol.ts` has the argument).
   *
   * IT NEVER TOUCHES `results.dataset.state` AT ALL — `onReply` above holds this file's writes of it. That
   * flag is the program compile's "running…" indicator and `app.test.ts`'s `settled` waits on it; a copy's
   * traffic is not a compile and must not be seen as one finishing.
   */
  const onScratchReply = (session: SessionId, reply: RunReply): void => {
    switch (reply.kind) {
      case 'lambda-tree':
        trees.store(session, reply.gen, reply.tree)
        draw()
        return
      case 'scratch-compiled':
        // ONE STATUS, AND THE `null` IS NOT A FABRICATION. `resetLegs` drops a status for a leg the
        // session does not have rather than writing one so the record is square — its own doc, and
        // this is the caller it was written for.
        //
        // **`entryOf` IS UNGUARDED HERE AND SO IS `legOf` IN THE ARM BELOW, AND A COOLED BUFFER CANNOT
        // REACH EITHER.** `ScratchBuffers.cool` drops the registry entry, so both calls would throw for a
        // reply that arrived after one; what makes that unreachable is that `cool` also calls
        // `SessionPool.unbind`, whose `port.terminate()` empties the parent side of the message port (the
        // HTML spec's *terminate a worker* algorithm empties the port message queue of the port a
        // dedicated worker is entangled with), synchronously, before `cool` returns.
        // `ScratchBuffers.noSessionReply` carries the full argument, including why its own `warm` check
        // is belt-and-braces — it is stated once, there, rather than three times across this switch.
        resetLegs(sessions.entryOf(session).legs, { lambda: reply.lambda })
        built(session)
        // THE EDITOR IS SEEDED FROM THE REPLY'S OWN TEXT, NOT FROM THE FRAME THAT ARRIVES NEXT
        // (5d-iii design §4.1: `text` "travels back so `main.ts` can seed the editor from the same
        // string that created the scratch, rather than from a second print that could disagree with
        // it"). `text: string | null` on the wire type is nullable DEFENSIVELY here rather than
        // reachably — `onLambdaScratch` never posts `scratch-compiled` at all when its own `scratch`
        // came back `null` (`session-worker.ts`'s `onLambdaScratch`, its `scratch === null` arm, which
        // posts `no-session` and returns) — the same "nullable defensively, not reachably" shape
        // `protocol.ts`'s `linkIndex` field states for itself, and the guard costs one `if` against a
        // wire contract that should not hard-code what its producer sends.
        //
        // `setEditor` KEEPS EXACTLY ONE TARGET — `editorHome` above, NOT
        // `panes.ofSession('lambda', session)` fanned out. Two panes bound to the SAME lambda-scratch
        // session would still mean one buffer; mounting a second live `CodeMirror` instance over it is
        // the desync 5d-ii-a design §4.3 rejects. That section's editor-moves rule is what makes
        // "which pane" a real question and `editorOwner` is the answer, resolved by the
        // `editorHome` dependency.
        //
        // **THE SECOND ARGUMENT IS THE COLLAPSE SEED — 5d-ii-d design §4.7.** This arm is where a
        // build's own reply mounts an editor: a fresh `fork` reaches it with a buffer `collapsedOf` has
        // never seen written (answers `false`, `fork`'s own seed), and a restored buffer's `warm`
        // reaches it too — `#spawn` posts a build at step 0 for both callers alike, so this is also
        // where a buffer that came back cold and collapsed gets its editor mounted already collapsed,
        // rather than expanded for one frame and then corrected.
        //
        // **IT IS NOT THE ONE PLACE `LambdaPane.setEditor`'s MOUNT BRANCH RUNS.** `pane-host.ts`'s
        // `mountScratchEditor` is the second, and the reason it has to exist is the limit of this one: a
        // reply fires ONCE per build, so a pane that comes to be bound to the buffer afterwards has no
        // reply left to mount from. A `cool` (which destroys the editor) followed by a `warm` (whose
        // build lands with no pane claiming a leaf, so `editorHome` answers `undefined` right here) and
        // then a bind through the selector would otherwise leave a buffer whose text could never be edited
        // again. That site makes the pairing this line makes from `ScratchBuffers.editorSeed`, which
        // returns the text and the flag together precisely so the two mount sites cannot drift apart on it.
        if (reply.text !== null) editorHome(session)?.setEditor(reply.text, scratchpad.collapsedOf(session))
        // **THE BUFFER'S TEXT OF RECORD (5d-ii-d design §4.3), AND IT IS NOT `setEditor`'s ARGUMENT BY
        // COINCIDENCE.** For a fork, the term the worker derived at the requested step is the first
        // moment this app knows what the buffer holds — `ScratchBuffers.fork` posts the SOURCE's
        // step-0 text and a step, and the worker re-derives between them. Recording it here rather
        // than reading it back off the `ScratchEditor` later is what lets a buffer whose editor was
        // never mounted, or was retired by custody, still be persisted.
        if (reply.text !== null) scratchpad.setText(session, reply.text)
        // AND THEN INTO STORAGE — 5d-ii-d design §4.3. The paragraph above ends "still be persisted",
        // and this is the line that makes that true rather than merely possible. A THIRD SIBLING UNDER
        // THE SAME GUARD rather than an unconditional call: the guard is defensive (`text` is never
        // `null` on this reply, as `protocol.ts`'s `scratch-compiled` doc says), and when it skips the
        // line above, a write here would carry nothing new. The fork that created this buffer was
        // persisted by its own path — `transport.ts`'s `onBuffersChanged` reaches `main.ts`'s
        // `refreshBuffers`, which persists — so the record already exists in storage with the seed
        // text; what this arm adds is the term the worker derived.
        if (reply.text !== null) onBuffersPersist()
        draw()
        return
      case 'tm-scratch-compiled': {
        // ONE STATUS, AND THE `null` IS NOT A FABRICATION — `resetLegs` drops a status for a leg the
        // session does not have rather than writing one so the record is square, `scratch-compiled`'s
        // own doc above. This is that arm's mirror: there the λ status is real and TM is `null`; here
        // it is the reverse. `reply.tm` is a `TmScratchStatus`, not a `TmStatus` — `resetLegs`'s own
        // doc has the argument for why its `statuses` record accepts it.
        resetLegs(sessions.entryOf(session).legs, { tm: reply.tm })
        built(session)
        // THE MACHINE IS STORED ON THE ENTRY AND FANNED OUT TO `setProgram`, THE SAME PAIRING
        // `setTmProgram` MAKES FOR THE `compiled` ARM — so a pane bound to this session later
        // (`pane-host.ts`'s `tmProgramOf`) is seeded from the entry rather than left blank. THROUGH
        // `storeAndSetProgram` RATHER THAN `setTmProgram` ITSELF: `setTmProgram` also pushes fork
        // AVAILABILITY from a `tmText` this reply does not carry, and routing a bare `null` through it
        // would read as "this machine is over the cap", which is false for a scratch that was never
        // offered a fork control in the first place.
        // `setScratchStatus` rides the SAME pass as `then` rather than a second loop over
        // `panes.ofSession('tm', session)` below — `storeAndSetProgram`'s own doc has the argument.
        // `tapeNames` RIDES THIS REPLY, PER SCRATCH, rather than being the fixed `tapeNames()` export
        // `onRun` posts: a reduced file's single-tape stage leaves one tape that the lowered bank names
        // would mislabel, and only the scratch knows its own stage list.
        // `tmResultDecodable: true` IS INERT FOR THE SAME REASON `tmText: null` IS: this path never calls
        // `setForkAvailable` (no `then` below), so neither field is ever read off this value.
        const compiled: TmCompiled = {
          program: reply.tmProgram,
          tapeNames: reply.tapeNames,
          tmText: null,
          tmResultDecodable: true,
        }
        sessions.entryOf(session).tmScratch = { status: reply.tm, value: null }
        storeAndSetProgram(session, compiled, (pane) => {
          pane.setScratchStatus(reply.tm)
          pane.setScratchValue(null)
        })
        // THE EDITOR IS SEEDED FROM THE BUFFER'S OWN TEXT OF RECORD, NOT FROM THIS REPLY — there is
        // none to seed from (`tm-scratch-compiled` carries no `text`, unlike `scratch-compiled`).
        // `ScratchBuffers.editorSeed` is also the seed `pane-host.ts`'s `mountScratchEditor` mounts a
        // pane from when it arrives after this reply, the editor's half of the repair `tmProgramOf`
        // performs. `ScratchBuffers.fork` and `.recompile` both write `BufferState.text` BEFORE posting
        // a build — the mint's own `src` argument, or the just-typed text — so by the time this reply
        // lands the buffer already holds its own correct text; there is nothing here to derive, only
        // to mount.
        const seed = scratchpad.editorSeed(session)
        if (seed !== null) editorHome(session)?.setEditor(seed.text, seed.collapsed)
        // **AND THEN INTO STORAGE, UNCONDITIONALLY AND DEFENSIVELY: TODAY THIS WRITE STORES NOTHING NEW.** The λ
        // arm above stores because its reply carries a term, under the guard its `setText` shares. This reply
        // carries no text, and every route that posts a TM build has stored the buffer's text already: an edit by
        // the sink that sent it (`transport.ts`'s `editSink`), a fork or a blank copy when it was made (each
        // reaches `main.ts`'s `refreshBuffers`), and `warm`'s build from the text of record, which is what is
        // stored. The write is kept so that a build that landed stays stored if a route that posts a build
        // without storing its text is ever added.
        onBuffersPersist()
        draw()
        return
      }
      case 'tm-value': {
        // RETAINED ON THE ENTRY, AS `tm-scratch-compiled` RETAINS THE STATUS, for a TM pane created after this reply.
        // A reading with no status before it cannot happen: the worker posts this only after `tm-scratch-compiled`
        // for the same generation, and a stale generation never reaches this switch (`SessionClient`'s filter).
        const entry = sessions.entryOf(session)
        if (entry.tmScratch !== null)
          entry.tmScratch = { ...entry.tmScratch, value: { run: reply.run, value: reply.value } }
        for (const p of panes.ofSession('tm', session))
          (p.pane as TmPane).setScratchValue(entry.tmScratch?.value ?? null)
        // **`draw()` REPAINTS THE FOOTER READOUT'S TM COPY LINE** (`readout.ts`'s `tmCopyFacts`, which reads
        // `reading.value`), which reads this same entry — nothing else repaints it once the copy's own pane
        // has taken its `setScratchValue`. Without it, `value: running · N of M steps` would stay on screen
        // long after the value run ended, waiting on an unrelated event to redraw. **The copies menu's TM
        // row is a different case, not this one's**: it is not repainted by `draw()` at all —
        // `buffer-list.ts`'s popover rebuilds its rows only when it opens, on a temperature click and on a
        // delete — so the readout follows the value as it arrives, and the menu row reads this same entry
        // the next time something rebuilds it.
        //
        // **COALESCED TO ONE DRAW PER FRAME WHILE THE RUN IS `Running`.** The worker posts this once per
        // `VALUE_CHUNK` (500,000 steps) while the run is `Running` (`session-worker.ts`'s `runValueLoop`),
        // so a `draw()` per chunk would be a full, synchronous redraw the browser could not skip even
        // behind a hidden tab, on a session that may be posting several chunks a second. `scheduleDraw`
        // (above) is that coalescing, shared with the `*-frames` arms: at most one redraw is pending at a
        // time, and every reply that lands before it fires is absorbed into the one that is already
        // scheduled. The reply that ends the run (`run.run !== 'Running'`) calls `flushDraw` instead, so
        // the final value is drawn at once rather than left waiting on a frame a hidden tab may never paint.
        if (reply.run.run === 'Running') scheduleDraw()
        else flushDraw()
        return
      }
      case 'asm-scratch-compiled': {
        // `tm-scratch-compiled`'s arm for an asm copy: one status, the listing stored and fanned out, and the copy's
        // status and value retained on the entry for a view built after this reply. The value comes with the build
        // (`protocol.ts`'s own doc on this reply). No `asmText`: a copy offers no copy of itself.
        resetLegs(sessions.entryOf(session).legs, { asm: reply.asm })
        built(session)
        sessions.entryOf(session).asmScratch = { status: reply.asm, value: reply.value }
        setAsmProgram(session, { program: reply.asmProgram, asmText: null })
        // THE EDITOR FROM THE BUFFER'S OWN TEXT OF RECORD, as `tm-scratch-compiled`'s arm mounts a TM copy's, and for
        // its reason: a fork and an edit both write the text before posting the build.
        const asmSeed = scratchpad.editorSeed(session)
        if (asmSeed !== null) editorHome(session)?.setEditor(asmSeed.text, asmSeed.collapsed)
        // INTO STORAGE UNCONDITIONALLY AND DEFENSIVELY, as `tm-scratch-compiled`'s arm stores and for its reason: this
        // reply carries no text either, every route that posts an asm build has stored the text already, and the write
        // keeps a build that landed stored if a route that posts without storing is ever added.
        onBuffersPersist()
        draw()
        return
      }
      case 'asm-value': {
        // A `[continue]` carried the copy's cursor past its build's cap. Retained over the build's value, which it
        // replaces; a reading with no build before it cannot happen, for `tm-value`'s reason.
        const entry = sessions.entryOf(session)
        if (entry.asmScratch !== null) entry.asmScratch = { ...entry.asmScratch, value: reply.value }
        for (const p of panes.ofSession('asm', session)) (p.pane as AsmPane).setScratch(entry.asmScratch)
        draw()
        return
      }
      case 'asm-frames': {
        // The asm counterpart of `lambda-frames` below, unguarded for the identical reason.
        const leg = sessions.legOf({ session, leg: 'asm' })
        for (const f of reply.frames) leg.hist.push(f, asmFrameBytes(f))
        leg.done = reply.done
        if (reply.done === null) scheduleDraw()
        else flushDraw()
        return
      }
      case 'lambda-frames': {
        // UNGUARDED FOR THE REASON THE `scratch-compiled` ARM ABOVE STATES: `legOf` throws for a session
        // the registry no longer holds, and a cooled buffer's worker cannot deliver a reply at all
        // because `cool`'s `terminate()` empties the parent side of the port. See
        // `ScratchBuffers.noSessionReply` for the argument in full.
        const leg = sessions.legOf({ session, leg: 'lambda' })
        for (const f of reply.frames) leg.hist.push(f, lambdaFrameBytes(f))
        leg.done = reply.done
        if (reply.done === null) scheduleDraw()
        else flushDraw()
        return
      }
      case 'tm-frames': {
        // THE TM COUNTERPART OF `lambda-frames` ABOVE, UNGUARDED FOR THE IDENTICAL REASON — a cooled
        // buffer's worker cannot deliver this reply at all.
        const leg = sessions.legOf({ session, leg: 'tm' })
        for (const f of reply.frames) leg.hist.push(f, tmFrameBytes(f))
        leg.done = reply.done
        if (reply.done === null) scheduleDraw()
        else flushDraw()
        return
      }
      case 'no-session': {
        // A VALUE RUN THAT WAS STILL GOING IS GONE. The worker drops a scratch, and the value run beside it, before
        // it parses the next text, so nothing will report on that run again, and a reading left at `Running` would
        // go on saying otherwise for as long as the text does not build. A finished reading still describes the
        // last text that built, like the frames this arm leaves on screen, so it stays.
        const retained = sessions.entryOf(session).tmScratch
        if (retained?.value?.run.run === 'Running') {
          sessions.entryOf(session).tmScratch = { ...retained, value: null }
          for (const p of panes.ofSession('tm', session)) (p.pane as TmPane).setScratchValue(null)
        }
        // WHICH OF TWO REASONS THIS FIRES IS `ScratchBuffers.noSessionReply`'s QUESTION, NOT THIS
        // FILE'S — see that method's doc for the discriminator (the first failure on the copy's worker,
        // while its own leg has recorded no frame) and why the two demand different surfaces. Everything
        // below is what THIS reply still has to do once that question is answered.
        //
        // **`session` IS THE FIRST ARGUMENT, AND IT IS THE ONE FACT THIS ARM HAS THAT THE CALLEE COULD
        // NOT DERIVE.** A reply belongs to the session whose worker sent it (§3.2: the port is the id),
        // and this handler has that session in scope. Passing it is what makes a failed fork answer for
        // the buffer that failed rather than for whichever one was forked last.
        //
        // The buffer survives its own failed build, keeps its worker, stays in `list()`, and keeps the
        // pane the fork moved onto it.
        const failed = scratchpad.noSessionReply(session, reply.diagnostics)
        if (failed !== null) {
          // THE PHANTOM PATH: THE FIRST BUILD ON A COPY'S WORKER FAILED, AND ITS LEG HAS NEVER RECORDED A
          // FRAME. The build answers a gesture — a fork, a blank copy, a resume, an undone delete or a page's
          // restore — whose copy may be in no view, or in one with no editor yet, so a notice is the surface:
          // it exists whether or not a view can show anything (`notice.ts`, Plan 7 part 2 spec §11). It is
          // said once per worker; the copy's later failures are edits, which `noSessionReply` sends below.
          //
          // **THE LEG SAYS `did not build`**, the reason the copy's step line and its readout read while
          // the leg is not available; the `building…` a new copy's leg starts with (`ScratchBuffers`'
          // `#pendingLegs`) would go on saying a build is coming after this one has answered. A build that
          // lands replaces it through its own arm's `resetLegs`. The reset clears no frame, because a leg on
          // this path holds none.
          resetLegs(sessions.entryOf(session).legs, {}, 'did not build')
          // `the copy did not build — ` IS COMPOSED HERE, the one place that knows a copy's build failed
          // with no run behind it; `scratch.ts`'s `BufferCapReached`/`#refuseAtCap` doc has the argument for
          // composing a failure's words at its call site.
          failure = { session, notice: notify(`the copy did not build — ${failed.map((d) => d.message).join(' · ')}`) }
          // `draw()` REPAINTS WHAT ELSE THE REPLY CHANGED. It ends no session, so there is no editor to
          // sweep, and `draw()` rather than `applyLayout()` because no leaf changes here.
          draw()
          return
        }
        // THE LIVE-EDIT PATH — AN EDIT'S TEXT DID NOT PARSE. An editor's edit (`transport.ts`'s
        // `editSink`) posts whatever the user just typed, and most keystrokes mid-identifier do not parse,
        // so this is the ordinary path, not the defensive one. The editor shows the edit's diagnostics, and
        // the copy's leg is left as it was: on a copy that has built, its last good run; on one that has
        // not, the `did not build` the branch above gave it when its worker's first build failed.
        //
        // THE FRAMES ARE LEFT ALONE — NOT `resetLegs`. 5d-iii design §4.4: "an edit that does not parse
        // leaves the frames region showing the last good run", the opposite of `onReply`'s "STALE FRAMES
        // MUST NOT SURVIVE A BROKEN PROGRAM" for the SOURCE (this file's own `no-session` and
        // `worker-error` arms, which say it in those words) — and deliberately so. A source recompile
        // that fails to compile has no program behind it at all; a scratch mid-edit still has the term it
        // had a keystroke ago, and blanking the reduction under a user who has not finished typing is
        // worse than leaving last frame on screen for one more keystroke. `leg.hist`/`leg.status` are
        // whatever the last successful build left them — this arm does not touch either.
        //
        // **THE DIAGNOSTICS DO NOT COME FROM HERE.** Every editor is an LSP document, and its
        // diagnostics arrive on that document's own sink.
        draw()
        return
      }
      case 'worker-error':
        // **A COPY'S THREAD THREW, AND THE PROGRAM'S READOUT IS NOT WHERE THAT GOES.** The strip reads
        // the FOCUSED view's session (Plan 7 part 2 spec §9), so storing a copy's failure as the
        // program's result would replace a program result that is still valid, and show it only while
        // the program is focused — the message would appear nowhere while the copy's own view is on
        // screen. So the copy's failure is a notice that names the copy (Plan 7 part 2 spec §13; umbrella
        // §7: each failure leaves a working app and one notice), and the program's result is left alone.
        // `#results`'s `data-state` is the program's compile state and is not touched here for
        // the same reason.
        //
        // `resetLegs` first, for `onReply`'s reason — stale frames must not survive under a message
        // saying it broke. Its reason, `the copy failed`, is what this copy's own readout then reads.
        resetLegs(sessions.entryOf(session).legs, {}, 'the copy failed')
        // THE RETAINED READING GOES, AND SO DOES WHAT EVERY TM PANE ON THE BUFFER WAS TOLD OF IT — not only the pane
        // holding the editor, which `setEditor(null)` below reaches. A split pane showing the same buffer would
        // otherwise go on reading `running` over a thread that will never answer again.
        sessions.entryOf(session).tmScratch = null
        sessions.entryOf(session).asmScratch = null
        for (const p of panes.ofSession('asm', session)) (p.pane as AsmPane).setScratch(null)
        for (const p of panes.ofSession('tm', session)) {
          const pane = p.pane as TmPane
          pane.setScratchStatus(null)
          pane.setScratchValue(null)
        }
        // `setEditor(null)` TOO. This thread is dead and a worker throwing is not a call to
        // `ScratchBuffers.retire`, so the registry entry keeps `detached: true`, the pane's binding does
        // not move, and `LambdaPane.setDetached`'s teardown never fires — its input never changes. But the
        // editor this file's own `scratch-compiled` arm mounted is now sitting over a worker that will
        // never answer another message, so it has to come down explicitly, here. A no-op if the pane had
        // already moved on before this reply arrived: unmounting an already-unmounted editor costs
        // nothing. ONE TARGET, same as the `scratch-compiled` arm's own comment above — `undefined` here
        // means the owning pane already closed, in which case there is nothing left mounted to unmount.
        editorHome(session)?.setEditor(null)
        notify(`${scratchpad.nameOf(session) ?? 'a copy'} stopped — ${reply.message}`)
        draw()
        return
      // TWO KINDS A COPY'S WORKER NEVER SENDS, WRITTEN OUT for the reason `onReply`'s are: `onRun` posts both and
      // `onExtend` posts `result`, each only for the program's session. A copy has neither the `SourceMap` nor the
      // `ty` `compiled` and `result` carry.
      case 'compiled':
      case 'result':
        return
      default:
        unhandled(reply)
    }
  }

  return { onReply, onScratchReply }
}
