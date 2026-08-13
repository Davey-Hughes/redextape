import type { EditorView } from '@codemirror/view'
import { showWorkerError } from './banner'
import { setDecline, setLink } from './highlight'
import type { LambdaPane } from './lambda-pane'
import { LinkIndex } from './link'
import type { LinkWiring } from './link-wiring'
import type { PaneCollection } from './panes'
import { lambdaFrameBytes, type RunReply, tmFrameBytes } from './protocol'
import { noSessionRows, type Row, resultRows } from './results'
import type { LambdaScratchpad } from './scratch'
import type { SessionId } from './session-client'
import { resetLegs, type SessionRegistry } from './sessions'
import type { TmPane } from './tm-pane'

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
 * `onReply` AND `onScratchReply`, MOVED OUT OF `main.ts` WHOLE — the two reply switches, every inline
 * comment included. See each function's own doc below for what it does; this one is only about the
 * dependencies.
 *
 * `view` IS A THUNK, NOT A VALUE, SAME REASON AS `link-wiring.ts` AND `draw.ts`. `main.ts` declares
 * `let view: EditorView` and does not assign it until the `EditorView` construction runs, well after
 * this factory is called (it is built right after `draw` is assigned, per that file's construction-
 * order comment) — so a value parameter would capture `undefined` forever. `links` (`LinkWiring`) and
 * `draw`, by contrast, are real values here, not thunks: both are already-assigned by the point this
 * factory is called, unlike the `let`s `link-wiring.ts` and `draw.ts` themselves close over earlier in
 * construction.
 *
 * `panes: PaneCollection` REPLACES `lambdaSlot`/`tmSlot`/`lambdaPane`/`tmPane` (T7). `setProgram` below
 * is PER-SESSION — it belongs to the session whose worker sent the reply, routed through
 * `panes.ofSession('tm', session)` — while `setEditor` keeps exactly one target; see that call's own
 * comment for why generalising it to "every pane bound to this session" is not the same move.
 *
 * `renderRows` IS NOT A DEPENDENCY. `main.ts` used to define it locally over `results.ts`'s `Row` type;
 * grepping its call sites (`renderRows(results, noSessionRows(...))`, `renderRows(results,
 * resultRows(...))`) shows both live inside `onReply` and neither lives in `onScratchReply` — one
 * caller, not two, so it moved here as a private function instead of threading through the deps object.
 * An injected function with exactly one implementation is a parameter pretending to be a choice.
 *
 * `sourceSession: SessionId` IS NOT IN THE TASK BRIEF'S SIGNATURE, AND IS NEEDED ANYWAY.
 * `onScratchReply`'s `no-session` arm calls `scratchpad.noSessionReply(reply.diagnostics,
 * SOURCE_SESSION, ...)` — the literal source-session id `main.ts` names once at construction
 * (`const SOURCE_SESSION: SessionId = 'source'`) and passes to `noSessionReply` as the session a
 * retiring scratchpad rebinds its slots back to. That is not something either handler can derive from
 * `session`, which names whichever session actually sent THIS reply (that is `onReply`'s whole point —
 * see its own doc). Renamed to `sourceSession` here for the same reason every other dep in this
 * signature is camelCase.
 *
 * `root: HTMLElement` IS IN THE BRIEF'S SIGNATURE AND IS NOT HERE. Neither handler reads it —
 * `showBanner(root, ...)` is `main.ts`'s wasm-load and worker-spawn failure surface (`banner.ts`'s own
 * doc has the split), and both of those failures happen before or outside a reply ever exists. The
 * failure surface a reply handler DOES use is `showWorkerError(results, ...)`, which needs `results`,
 * already in this signature. Grepping the moved bodies for `root` turns up nothing but a comment that
 * happens to contain the word "root" in an unrelated sentence.
 */
export function createReplies(deps: {
  sessions: SessionRegistry
  scratchpad: LambdaScratchpad
  results: HTMLElement
  view: () => EditorView
  panes: PaneCollection
  links: LinkWiring
  draw: () => void
  sourceSession: SessionId
  /**
   * The pane currently holding the λ scratchpad's editor, or `undefined` if none currently is —
   * replaces a local "THE λ pane" helper this file used to define. `setEditor`'s target was a fact
   * about there being exactly one editor to mount, not about which pane's binding currently names which
   * session (see the `scratch-compiled` and `worker-error` arms below) — true only until wave 3
   * (5d-ii-a)'s editor-moves rule, which is what turns "which pane" into a real question with more than
   * one candidate answer. `main.ts`'s `editorHomeFor` is the one place that answers it, since only it
   * holds `editorOwner`; `undefined` here replaces the old helper's throw, because the recorded owner
   * can be stale (its pane closed, or rebound away) rather than a wiring bug — a reply landing on a
   * session with nowhere to mount its editor has nothing to do, not an invariant to raise about.
   */
  editorHome: () => LambdaPane | undefined
  /**
   * Make every `LambdaEditor` agree with where `main.ts` says it belongs — called on the ONE arm below
   * that retires a session (`no-session`'s phantom-fork path), for the reason `compile.ts`'s identical
   * dependency records at length: a retire has to leave no editor behind for a session that no longer
   * exists, and `editorHome()` above can only ever reach one a pane is still HOLDING, never one in
   * custody. Both retire paths in the app therefore call this, so "a custody entry cannot outlive its
   * session's incarnation" is a property of the retire, not of which caller happened to trigger it.
   *
   * **THAT SENTENCE NEEDED A SECOND HALF, ADDED BY THE THIRD REVIEW ROUND: BOTH CALLERS CALLING IT WAS
   * NOT SUFFICIENT.** `reconcileEditors` swept the sessions `main.ts`'s `editorOwner` named, and a
   * custody entry whose claim had been dropped (which is what `reset layout` does to a closed pane's
   * claim) appeared in neither pass — so the property held of the CALLERS and not of the app. Its
   * custody pass now iterates `heldEditors` itself. Nothing changed here, which is the point worth
   * recording at a dependency: this file's obligation was already discharged, and the invariant was
   * still false.
   *
   * **AND THIS CALL SITE WAS ITSELF UNCOVERED WHEN THE CLAIM ABOVE WAS WRITTEN** — a Minor from the same
   * round: `replies.ts:314-330` was reported uncovered by `pnpm test:coverage`, so deleting the call
   * below could not fail a test, and "both retire paths call this" was defended by argument on exactly
   * the path this file owns. `tests/browser/scratch-fork.test.ts`'s "drives the phantom `no-session`
   * through `createReplies`" case now executes it against a real failed fork on a real worker thread.
   */
  reconcileEditors: () => void
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
    draw,
    sourceSession,
    editorHome,
    reconcileEditors,
  } = deps

  /**
   * One session's replies, applied to that session's legs.
   *
   * THE SESSION IS A PARAMETER, NOT A CLOSED-OVER CONST, even though exactly one exists. A reply
   * belongs to the session whose worker sent it and to nothing else — §3.2's "the port is the id" is
   * precisely the claim that this pairing is established at the port and cannot be recovered from the
   * message. Resolving it here keeps this function from quietly being *the source session's* reply
   * handler under a name that says otherwise.
   *
   * `index`/`linkable`/`link` ARE NOT PER SESSION EITHER, and now live behind `linkWiring` rather than
   * as closed-over `let`s in this scope — see `link-wiring.ts`'s own doc for why the four are one
   * module. The `results`/`view` writes below are still closed over directly: they are the app's one
   * results pane and one editor.
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
        // PER-SESSION — belongs to the session whose worker sent this reply. `session` is this
        // function's own parameter, which is exactly the tell T7's own doc gives for this class of
        // call: `panes.ofSession('tm', session)`, not `panes.of('tm')`, so a scratch session's TM pane
        // (there is none today, but the collection does not know that) is never repainted with the
        // SOURCE session's "not compiled".
        for (const p of panes.ofSession('tm', session)) (p.pane as TmPane).setProgram(null, [])
        linkWiring.setIndex(null)
        view().dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
        // `draw()` calls `drawLink()` at its end now — see that function's doc.
        draw()
        return
      case 'compiled':
        resetLegs(legs, reply.lambda, reply.tm)
        // PER-SESSION, same reason as the `no-session` arm above.
        for (const p of panes.ofSession('tm', session)) (p.pane as TmPane).setProgram(reply.tmProgram, reply.tapeNames)
        linkWiring.setIndex(reply.linkIndex === null ? null : new LinkIndex(reply.linkIndex))
        // `setLink.of(null)` HERE TOO, NOT ONLY `setDecline`. `linkMark` clears its own decoration on
        // `docChanged`, which covers the ordinary typing path — but the `#encoding` picker's `change`
        // listener below calls `schedule` with NO document edit at all, so a `compiled` reply from
        // switching encodings can land with the `.linked` mark still painted from the PREVIOUS compile's
        // index. `link` is already cleared above; this is what makes the source pane agree. Combined
        // into one dispatch with `setDecline` so the two decorations never appear half-updated for a
        // frame.
        view().dispatch({ effects: [setDecline.of(reply.declinedSpan), setLink.of(null)] })
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
        // PER-SESSION, same reason as the two arms above.
        for (const p of panes.ofSession('tm', session)) (p.pane as TmPane).setProgram(null, [])
        linkWiring.setIndex(null)
        view().dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
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
        //
        // `setEditor` KEEPS EXACTLY ONE TARGET — `editorHome()` above, NOT
        // `panes.ofSession('lambda', session)` fanned out. Two panes bound to the SAME lambda-scratch
        // session would still mean one buffer; mounting a second live `CodeMirror` instance over it is
        // the desync design §4.3 rejects, and generalising this call in a commit that claims to be
        // behaviour-preserving would ship it silently. Wave 3's editor-moves rule is what makes "which
        // pane" a real question and `editorOwner` is the answer, resolved by the ONE dependency this
        // file now takes instead of picking "the only one there is" for itself.
        if (reply.text !== null) editorHome()?.setEditor(reply.text)
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
        //
        // EVERY SLOT IN THE COLLECTION, NOT JUST TWO — `panes.all().map((p) => p.slot)` replaces the
        // literal `[lambdaSlot, tmSlot]`. `retire` (called inside `noSessionReply`) only rebinds a slot
        // whose OWN binding names this scratchpad's session, so a tm-kind slot — which can never be
        // bound to a λ-only scratch — is a no-op scan, not a wrong rebind; passing every slot is what
        // stays correct the day a second λ pane exists to also be homed.
        const failed = scratchpad.noSessionReply(
          reply.diagnostics,
          sourceSession,
          panes.all().map((p) => p.slot),
        )
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
          linkWiring.setForkFailed(failed.map((d) => d.message).join(' · '))
          // THE SECOND RETIRE SITE, AND IT SWEEPS EDITORS FOR THE SAME REASON THE FIRST DOES —
          // `noSessionReply` calls `retire` internally, so this arm kills a session exactly as
          // `compile.ts`'s recompile-from-source does, and like it reaches for `draw()` rather than
          // `applyLayout()`. A MOUNTED editor comes down either way, through the `setDetached(false)`
          // the `draw()` below drives once `retire` has rebound the pane; a HELD one — `main.ts`'s
          // `heldEditors`, a closed pane's editor in custody — is what nothing here could reach, and it
          // is narrow rather than unreachable. Custody needs an editor to have been mounted, which needs
          // `scratch-compiled` above to have landed; this branch needs the λ leg to hold no FRAME, and
          // `session-worker.ts` posts `scratch-compiled` BEFORE it records any (`onLambdaScratch`'s
          // final two lines). Close the holding pane inside that window and a `no-session` arriving
          // after it retires a session with an editor in custody. Sweeping unconditionally costs a
          // method call; reasoning about whether the window is currently reachable is exactly what left
          // the OTHER retire path unswept, and that one was reachable in six clicks.
          reconcileEditors()
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
        // PROGRAM" for the SOURCE (this file's own `no-session` and `worker-error` arms, which say it
        // in those words) — and deliberately so. A source recompile that fails to
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
        //
        // PER-SESSION, UNLIKE `setEditor` ABOVE — `setDiagnostics` only annotates gutters on an
        // ALREADY-mounted editor; it creates no new instance, so fanning it out over
        // `panes.ofSession('lambda', session)` carries none of `setEditor`'s desync risk.
        for (const p of panes.ofSession('lambda', session)) (p.pane as LambdaPane).setDiagnostics(reply.diagnostics)
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
        // already-unmounted editor costs nothing). ONE TARGET, same as the `scratch-compiled` arm's
        // own comment above — `undefined` here means the owning pane already closed, in which case
        // there is nothing left mounted to unmount.
        editorHome()?.setEditor(null)
        showWorkerError(results, new Error(reply.message))
        draw()
        return
    }
  }

  return { onReply, onScratchReply }
}
