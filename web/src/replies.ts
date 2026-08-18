import type { EditorView } from '@codemirror/view'
import { showWorkerError } from './banner'
import { setDecline, setLink } from './highlight'
import type { LambdaPane } from './lambda-pane'
import { LinkIndex } from './link'
import type { LinkWiring } from './link-wiring'
import type { PaneCollection } from './panes'
import { lambdaFrameBytes, type RunReply, tmFrameBytes } from './protocol'
import { noSessionRows, type Row, resultRows } from './results'
import type { ScratchBuffers } from './scratch'
import type { SessionId } from './session-client'
import { resetLegs, type SessionRegistry, type TmCompiled } from './sessions'
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
 * `panes: PaneCollection` REPLACES `lambdaSlot`/`tmSlot`/`lambdaPane`/`tmPane` (T7). `setProgram` — now
 * reached through `setTmProgram` below, which retains what it pushes — is PER-SESSION: it belongs to the
 * session whose worker sent the reply, routed through `panes.ofSession('tm', session)`, while
 * `setEditor` keeps exactly one target; see that call's own comment for why generalising it to "every
 * pane bound to this session" is not the same move.
 *
 * `renderRows` IS NOT A DEPENDENCY. `main.ts` used to define it locally over `results.ts`'s `Row` type;
 * grepping its call sites (`renderRows(results, noSessionRows(...))`, `renderRows(results,
 * resultRows(...))`) shows both live inside `onReply` and neither lives in `onScratchReply` — one
 * caller, not two, so it moved here as a private function instead of threading through the deps object.
 * An injected function with exactly one implementation is a parameter pretending to be a choice.
 *
 * **`sourceSession: SessionId` LEFT WITH THE RETIRE, AND THIS PARAGRAPH IS WHERE IT WAS ARGUED FOR.**
 * It read: *"IS NOT IN THE TASK BRIEF'S SIGNATURE, AND IS NEEDED ANYWAY. `onScratchReply`'s
 * `no-session` arm calls `scratchpad.noSessionReply(session, reply.diagnostics, SOURCE_SESSION, ...)` —
 * the literal source-session id `main.ts` names once at construction and passes to `noSessionReply` as
 * the session a retiring scratchpad rebinds its slots back to."* Nothing retires here now (5d-ii-c
 * decision 2), so there is no home for a pane to be sent to and no slots to send; the arm's own comment
 * below carries what the deletion cost. `panes` stays — two other arms fan out over it — but it is no
 * longer read as "every slot a retire might have to move".
 *
 * **`reconcileEditors: () => void` LEFT WITH IT, FOR THE SAME REASON AND ONE TASK AFTER `compile.ts`
 * SHED THE IDENTICAL DEPENDENCY.** It made every `LambdaEditor` — mounted on a pane, or waiting in
 * `editor-custody.ts`'s `heldEditors` — agree with where custody said it belonged, and it was called on
 * the one arm that retired a session, because a retire must leave no editor behind for a session that
 * no longer exists. No arm retires. The property it enforced is unchanged and now has no trigger here
 * at all: its argument, the third review round's correction to it, and the ordering it depends on all
 * live in `editor-custody.ts`'s `reconcileEditors`, which `pane-host.ts`'s `applyLayout` still calls on
 * every layout gesture. **WHAT THIS CALL CARRIED WAS ITS OWN EXECUTION; THE BRANCH'S GUARD WENT WITH THE
 * RECOMPILE DELETION** — and the distinction matters, because "the coverage it carried is lost rather
 * than moved" (what this read) invites the reading that deleting this line stopped covering
 * `reconcileEditors`' destroy branch. It never did: that branch is guarded by `!sessions.has(session)`,
 * which needs a session actually removed, and `tests/browser/scratch-fork.test.ts` was counting a
 * STUBBED `reconcileEditors` here — a call, not a destroy. What the deletion cost was the producer of
 * `!sessions.has`, and `tests/browser/editor-custody.test.ts` is what covers the branch now that
 * `main.ts`'s header-list retire supplies one again. `editorHome` STAYS, because two arms
 * that are not retires read it: `scratch-compiled` mounts text onto the home pane, and `worker-error`
 * unmounts from a pane whose session is still live and still bound.
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
  scratchpad: ScratchBuffers
  results: HTMLElement
  view: () => EditorView
  panes: PaneCollection
  links: LinkWiring
  draw: () => void
  /**
   * The pane currently holding `session`'s editor, or `undefined` if none currently is — replaces a
   * local "THE λ pane" helper this file used to define. `setEditor`'s target was a fact
   * about there being exactly one editor to mount, not about which pane's binding currently names which
   * session (see the `scratch-compiled` and `worker-error` arms below) — true only until wave 3
   * (5d-ii-a)'s editor-moves rule, which is what turns "which pane" into a real question with more than
   * one candidate answer. `editor-custody.ts`'s `editorHomeFor` is the one place that answers it, since only it
   * holds `editorOwner`; `undefined` here replaces the old helper's throw, because the recorded owner
   * can be stale (its pane closed, or rebound away) rather than a wiring bug — a reply landing on a
   * session with nowhere to mount its editor has nothing to do, not an invariant to raise about.
   *
   * **IT TAKES THE SESSION NOW, WHERE `main.ts` USED TO BIND IT TO ONE.** The binding read
   * `custody.homeFor(LAMBDA_SCRATCH)` and its comment said `onScratchReply` "is only ever invoked with
   * `LAMBDA_SCRATCH`". 5d-ii-c decision 1 makes that false — there is no fixed scratch id, and every
   * arm below already has the reply's own session in scope — so the id travels with the reply rather
   * than being assumed by the wiring.
   */
  editorHome: (session: SessionId) => LambdaPane | undefined
  /**
   * A buffer's text of record has just changed — the stored payload is stale until this returns.
   *
   * **THE `scratch-compiled` ARM IS WHERE A FORKED BUFFER'S TEXT FIRST EXISTS AT ALL**, so without this
   * dependency a term the user forked would live in `ScratchBuffers` and never reach `localStorage`.
   * `ScratchBuffers.setText`'s own doc names its two writers: `recompile`, which the user reaches by
   * typing, and this arm, which the worker reaches by answering. Both must persist, and this is the one
   * of the two that `main.ts` cannot see from a call site it already owns.
   *
   * A CALLBACK RATHER THAN THIS FILE WRITING STORAGE. `main.ts` holds the guarded writer and the
   * `PaneCollection` the `bindings` are read off; a `localStorage` call here would be a second place
   * the key, the envelope and the quota-failure policy are decided.
   */
  onBuffersPersist: () => void
}): {
  onReply(session: SessionId, reply: RunReply): void
  onScratchReply(session: SessionId, reply: RunReply): void
} {
  const { sessions, scratchpad, results, view, panes, links: linkWiring, draw, editorHome, onBuffersPersist } = deps

  /**
   * Tell every TM pane on `session` what machine it is showing, and leave that on the session's entry.
   *
   * **THE STORE AND THE PUSH ARE ONE CALL SO THEY CANNOT DISAGREE.** `SessionEntry.tmProgram` exists to
   * seed a TM pane created later (see its own doc), which is only correct while it holds what the panes
   * on screen were actually told — and the arms below tell them different things, one of which is
   * "nothing". Storing beside each `setProgram` loop instead would be one chance per arm to update one
   * and not the other, and the failure that produces is a pane created during an outage showing a
   * machine nobody else is showing, which nothing on screen would report.
   *
   * PER-SESSION, WHICH IS WHAT `panes.ofSession('tm', session)` SAYS AND `panes.of('tm')` WOULD NOT — the
   * fan-out this replaces carried that argument at every one of its sites, and it is the same one: a
   * reply belongs to the session whose worker sent it, so a scratch session's TM pane (there is none
   * today, but the collection does not know that) is never repainted with the source session's answer.
   *
   * THE `as TmPane` CAST IS THE ONE THE LOOPS ALREADY CARRIED. `PaneView<TmState>` is what the collection
   * is parameterised by and `setProgram` is not on it — deliberately, since `PaneSlot` never calls it —
   * so this is the same narrowing at one site instead of at every arm.
   */
  const setTmProgram = (session: SessionId, compiled: TmCompiled | null): void => {
    sessions.entryOf(session).tmProgram = compiled
    for (const p of panes.ofSession('tm', session)) {
      ;(p.pane as TmPane).setProgram(compiled?.program ?? null, compiled?.tapeNames ?? [])
    }
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
        // NOTHING TO SHOW, AND THE SESSION IS LEFT HOLDING NOTHING EITHER — see `setTmProgram` above for
        // why those are one call. The per-session argument this line used to carry lives there now.
        setTmProgram(session, null)
        linkWiring.setIndex(null)
        view().dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
        // `draw()` calls `drawLink()` at its end now — see that function's doc.
        draw()
        return
      case 'compiled':
        resetLegs(legs, reply.lambda, reply.tm)
        // THE ONE REPLY THAT CARRIES A MACHINE, RETAINED AS IT IS FANNED OUT. `tmProgram` is nullable on
        // the wire defensively rather than reachably (`protocol.ts`'s own doc), so a reply with no machine
        // in it leaves the session holding nothing rather than an envelope around a `null`.
        setTmProgram(
          session,
          reply.tmProgram === null ? null : { program: reply.tmProgram, tapeNames: reply.tapeNames },
        )
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
        // throws by design for an unknown encoding (`redextape-wasm`'s `compile` doc) from inside
        // `onRun`, before any session exists — so a `worker-error` from a fresh `client.request()` is
        // not only a call that
        // threw mid-record on top of a live session; it can also mean there was never a new session at
        // all, and the panes are still showing the PREVIOUS program's frames under a message saying the
        // app broke. Either way there is no session, which is what "not compiled" means — the same
        // reason `no-session` above passes, since a `compile()` that threw never produced one.
        resetLegs(legs, null, null, 'not compiled')
        // NOTHING TO SHOW AND NOTHING RETAINED, same as the `no-session` arm above.
        setTmProgram(session, null)
        linkWiring.setIndex(null)
        view().dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
        showWorkerError(results, new Error(reply.message))
        draw()
        return
    }
  }

  /**
   * One scratch BUFFER's reply, applied to that buffer's one leg — "the scratchpad's", singular and
   * definite, until 5d-ii-c decision 1 made a fork mint one buffer per call. The `session` parameter has
   * always been what says which; the noun is what had not caught up.
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
   * `session.rs`'s `Session::tm` prices.
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
        //
        // **`entryOf` IS UNGUARDED HERE AND SO IS `legOf` IN THE ARM BELOW, AND A COOLED BUFFER CANNOT
        // REACH EITHER — 5d-ii-d whole-branch review, finding 8.** `ScratchBuffers.cool` drops the
        // registry entry, so both calls would throw for a reply that arrived after one; what makes that
        // unreachable is that `cool` also calls `SessionPool.unbind`, whose `port.terminate()` empties
        // the parent side of the message port (the HTML spec's *terminate a worker* algorithm empties
        // the port message queue of the port a dedicated worker is entangled with), synchronously,
        // before `cool` returns. `ScratchBuffers.noSessionReply` carries the full argument, including
        // why its own `warm` check is belt-and-braces rather than the guarantee its doc used to claim —
        // it is stated once, there, rather than three times across this switch.
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
        // at all when its own `scratch` came back `null` (`session-worker.ts`'s `onLambdaScratch`, its
        // `scratch === null` arm, which posts `no-session` and returns) — the same
        // "nullable defensively, not reachably" shape `protocol.ts`'s `linkIndex` field states for
        // itself, and the guard costs one `if` against a wire contract that should not assume today's
        // producer forever.
        //
        // `setEditor` KEEPS EXACTLY ONE TARGET — `editorHome` above, NOT
        // `panes.ofSession('lambda', session)` fanned out. Two panes bound to the SAME lambda-scratch
        // session would still mean one buffer; mounting a second live `CodeMirror` instance over it is
        // the desync design §4.3 rejects, and generalising this call in a commit that claims to be
        // behaviour-preserving would ship it silently. Wave 3's editor-moves rule is what makes "which
        // pane" a real question and `editorOwner` is the answer, resolved by the ONE dependency this
        // file now takes instead of picking "the only one there is" for itself.
        //
        // **THE SECOND ARGUMENT IS THE COLLAPSE SEED — 5d-ii-d T9, design §4.7.** This arm is where a
        // build's own reply mounts an editor: a fresh `fork` reaches it with a buffer `collapsedOf` has
        // never seen written (answers `false`, `fork`'s own seed), and a restored buffer's `warm`
        // reaches it too — `#spawn` posts a build at step 0 for both callers alike, so this is also
        // where a buffer that came back cold and collapsed gets its editor mounted already collapsed,
        // rather than expanded for one frame and then corrected.
        //
        // **IT IS NO LONGER THE ONE PLACE `LambdaPane.setEditor`'s MOUNT BRANCH RUNS, WHICH IS WHAT THIS
        // PARAGRAPH USED TO CLAIM — whole-branch review before merge.** `pane-host.ts`'s
        // `mountScratchEditor` is the second, and the reason it had to exist is the limit of this one: a
        // reply fires ONCE per build, so a pane that comes to be bound to the buffer afterwards has no
        // reply left to mount from. A `cool` (which destroys the editor) followed by a `warm` (whose
        // build lands with no pane claiming a leaf, so `editorHome` answers `undefined` right here) and
        // then a bind through the selector produced a buffer whose text could never be edited again. The
        // pairing this line makes is unchanged and that site makes the identical one from
        // `ScratchBuffers.editorSeed`, which returns the text and the flag together precisely so the two
        // mount sites cannot drift apart on it.
        if (reply.text !== null) editorHome(session)?.setEditor(reply.text, scratchpad.collapsedOf(session))
        // **THE BUFFER'S TEXT OF RECORD (design §4.3), AND IT IS NOT `setEditor`'s ARGUMENT BY
        // COINCIDENCE.** For a fork, the term the worker derived at the requested step is the first
        // moment this app knows what the buffer holds — `ScratchBuffers.fork` posts the SOURCE's
        // step-0 text and a step, and the worker re-derives between them. Recording it here rather
        // than reading it back off the `LambdaEditor` later is what lets a buffer whose editor was
        // never mounted — a fork whose build failed, or one custody retired — still be persisted.
        if (reply.text !== null) scratchpad.setText(session, reply.text)
        // AND THEN INTO STORAGE — 5d-ii-d design §4.9. The paragraph above ends "still be persisted",
        // and this is the line that makes that true rather than merely possible. A THIRD SIBLING UNDER
        // THE SAME GUARD rather than an unconditional call: `text: null` means no scratch was built
        // (§4.1a), so the line above wrote nothing and there is nothing here for a write to carry. The
        // fork that created this buffer was persisted by its own path — `transport.ts`'s
        // `onBuffersChanged` reaches `main.ts`'s `refreshBuffers`, which persists — so the record
        // already exists in storage with the seed text; what this arm adds is the term the worker
        // derived.
        if (reply.text !== null) onBuffersPersist()
        draw()
        return
      case 'lambda-frames': {
        // UNGUARDED FOR THE REASON THE `scratch-compiled` ARM ABOVE STATES: `legOf` throws for a session
        // the registry no longer holds, and a cooled buffer's worker cannot deliver a reply at all
        // because `cool`'s `terminate()` empties the parent side of the port. See
        // `ScratchBuffers.noSessionReply` for the argument in full.
        const leg = sessions.legOf({ session, leg: 'lambda' })
        for (const f of reply.frames) leg.hist.push(f, lambdaFrameBytes(f))
        leg.done = reply.done
        draw()
        return
      }
      case 'no-session': {
        // WHICH OF TWO REASONS THIS FIRES IS `ScratchBuffers.noSessionReply`'s QUESTION, NOT THIS
        // FILE'S — see that method's doc for the discriminator (has this session's λ leg ever recorded
        // a frame) and why the two demand different surfaces. Everything below is what THIS reply still
        // has to do once that question is answered.
        //
        // **`session` IS THE FIRST ARGUMENT, AND IT IS THE ONE FACT THIS ARM HAS THAT THE CALLEE COULD
        // NOT DERIVE.** `noSessionReply` used to read the newest live buffer for itself; a reply belongs
        // to the session whose worker sent it (§3.2: the port is the id) and this handler has had that
        // session in scope since wave 1. Passing it is what makes a failed fork answer for the buffer
        // that failed rather than for whichever one was forked last — see the callee's own doc for why
        // the newest reading was backwards for exactly this arm.
        //
        // **TWO ARGUMENTS WENT WITH THE RETIRE — 5d-ii-c DECISION 2, DESIGN §4.3 — AND THIS IS WHERE
        // THEY WERE ARGUED FOR.** The call read `noSessionReply(session, reply.diagnostics,
        // sourceSession, panes.all().map((p) => p.slot))`: a home to send the failed buffer's panes
        // back to, and every slot in the collection to scan for them, with a comment explaining that
        // passing every slot rather than the literal `[lambdaSlot, tmSlot]` "stays correct the day a
        // second λ pane exists to also be homed". Nothing is homed now. The buffer survives its own
        // failed build, keeps its worker, stays in `list()`, and keeps the pane the fork moved onto it.
        const failed = scratchpad.noSessionReply(session, reply.diagnostics)
        if (failed !== null) {
          // THE PHANTOM PATH — CRITICAL finding, plan 5d-iii's ninth task. The fork's OWN build never
          // landed a single frame, so `scratch-compiled` never fired, `setEditor` was never called, and
          // `#editor` is still `null` — `LambdaPane.setDiagnostics` below
          // (`this.#editor?.setDiagnostics(ds)`) would be exactly the silent no-op the finding names.
          // `#link-status` is the surface built for that case (`link-status.ts`'s `forkFailed`, whose
          // own doc has the argument for this surface over the pane), and it is the ONLY reason this
          // branch still exists.
          //
          // **WHAT THIS BRANCH USED TO DO BESIDES REPORTING, AND WHAT ITS LOSS COSTS THE USER.**
          // `noSessionReply` retired the buffer here: the pane went back on the source session,
          // `SessionEntry.detached` read `false` for it again, and `#refreshDetach`'s `!this.#detached`
          // gate offered `✎ fork` once more — 5d-i design §4.1a's promised remedy ("the pane keeps
          // offering ✎ — the user can scrub to a smaller step and fork there") actually happening. The
          // pane now stays on a buffer that will never produce a frame, reading `building…`, and the
          // line below is the only thing that says why. **THE ESCAPE MOVED TO DESIGN §4.4's HEADER
          // LIST**, which is where it has to live anyway: a wedged buffer must be reachable whether or
          // not a pane is still showing it. `compile.ts`'s `schedule` records the first half of this gap
          // (a recompile stopped ending buffers); this is the second and last, and between them the app
          // could create buffers and end none — for three tasks, until `main.ts` built that list.
          // Retiring the row from it rebinds this pane home and the ✎ control comes back with the
          // binding, which is §4.1a's remedy reached from the header rather than from a stuck pane.
          // `fork failed — ` IS COMPOSED HERE, NOT SUPPLIED BY `link-status.ts` — 5d-ii-d review round
          // 2, Finding 3. This IS a fork failing (the build the fork posted never landed), so this call
          // site is one of the two places in `src/` that earns the words; `scratch.ts`'s
          // `BufferCapReached`/`#refuseAtCap` doc has the argument for the other, and `link-wiring.ts`'s
          // `forkFailed` field doc has the argument for why the renderer stopped adding this on every
          // caller's behalf.
          linkWiring.setForkFailed(`fork failed — ${failed.map((d) => d.message).join(' · ')}`)
          // `draw()` REPAINTS THE STATUS LINE, WHICH IS ALL THAT CHANGED. **IT USED TO BE PRECEDED BY
          // `reconcileEditors()`**, because this was the app's one remaining retire site and a retire
          // must leave no `LambdaEditor` behind — mounted, or waiting in `editor-custody.ts`'s
          // `heldEditors` — for a session that no longer exists. It ends no session, so it sweeps
          // nothing: the factory's own doc above records where that argument lives and what coverage
          // went with the call. `draw()` rather than `applyLayout()` for the reason it always was — no
          // leaf changes here — and that reason is now the whole of it rather than the narrower half.
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
        // thread is dead and nothing here retires the scratchpad (only `ScratchBuffers.retire` does
        // that, and a worker throwing is not a call to it), so the registry entry keeps
        // `detached: true`, the pane's binding does not move, and `setDetached`'s own new teardown
        // never fires — its input never changes. But the editor this file's own `scratch-compiled` arm
        // mounted is now sitting over a worker that will never answer another message, so it has to
        // come down explicitly, here, rather than by that invariant. A no-op if the pane had
        // already moved on before this reply arrived (`setEditor`'s own doc: unmounting an
        // already-unmounted editor costs nothing). ONE TARGET, same as the `scratch-compiled` arm's
        // own comment above — `undefined` here means the owning pane already closed, in which case
        // there is nothing left mounted to unmount.
        editorHome(session)?.setEditor(null)
        showWorkerError(results, new Error(reply.message))
        draw()
        return
    }
  }

  return { onReply, onScratchReply }
}
