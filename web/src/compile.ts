import type { EditorView } from '@codemirror/view'
import type { LinkWiring } from './link-wiring'
import type { PaneCollection } from './panes'
import type { LambdaScratchpad } from './scratch'
import type { SessionId } from './session-client'
import type { SessionRegistry } from './sessions'

/**
 * Milliseconds to wait after the last keystroke before posting a compile. `main.ts`'s own comments on
 * `schedule`'s body have the load-bearing detail — see `supersede`'s doc below for the one that made
 * this file exist rather than being folded into `session-client.ts`.
 */
const DEBOUNCE_MS = 300

/**
 * `schedule`, its debounce timer, and the encoding picker's `change` listener — moved out of `main.ts`
 * whole, the last of the five extractions. See `schedule`'s own doc below for what it does; this one is
 * only about the dependencies.
 *
 * `view` IS A THUNK, NOT A VALUE, SAME REASON AS `link-wiring.ts`, `draw.ts` AND `replies.ts`. The
 * picker's `change` listener is wired here, at construction, but `main.ts` does not assign `let view:
 * EditorView` until the `EditorView` itself is constructed — which happens AFTER this factory runs, so
 * a value parameter would capture `undefined` forever. `links` and `draw`, by contrast, are real values
 * by the point `main.ts` calls this factory: both are already-assigned, same as they are for
 * `createReplies`.
 *
 * `panes: PaneCollection` REPLACES `lambdaPane`/`lambdaSlot`/`tmSlot` (T7). `schedule`'s body calls
 * `scratchpad.retire(sourceSession, panes.all().map((p) => p.slot))` — every slot in the collection,
 * not the literal `[lambdaSlot, tmSlot]`; `retire` only rebinds a slot whose own binding names the
 * scratchpad's session, so passing every slot stays correct once a second λ pane exists to also be
 * homed, same as `replies.ts`'s identical conversion of the sibling call in `noSessionReply`.
 *
 * `sourceSession` IS NOT IN THE TASK BRIEF'S SIGNATURE, AND IS NEEDED ANYWAY. It is the literal
 * source-session id `main.ts` names once at construction, and is not derivable from anything else this
 * factory already takes. Named `sourceSession` here rather than `SOURCE_SESSION`, matching
 * `createReplies`'s own dependency of the same name and for the same reason: every other dep in this
 * signature is camelCase.
 *
 * `tmPane` IS IN THE BRIEF'S SIGNATURE AND IS NOT HERE. `schedule` never reads it — the only pane it
 * touches is `setEditor(null)`, on the branch where a scratchpad retires; the TM leg has no scratchpad
 * to reflect and nothing in this file's moved body ever mentions a TM pane. Grepping the moved code for
 * it turns up nothing.
 *
 * `reconcileEditors: () => void` REPLACES AN `editorHome: () => LambdaPane | undefined` THUNK THIS FILE
 * USED TO CALL `setEditor(null)` THROUGH — IMPORTANT finding, re-review of the whole-branch review's own
 * custody fix. Both spellings are about the same moment (a retire has to leave no `LambdaEditor` behind
 * for a session that no longer exists), and the narrow one could only ever reach an editor a pane was
 * still HOLDING. It could not reach one in CUSTODY — `main.ts`'s `heldEditors`, where a closed pane's
 * editor waits — and a custody entry is keyed by SESSION while the scratch session's id is a constant
 * the next fork re-registers, so the entry outlived the incarnation that produced it and was handed to
 * the next pane to legitimately hold one. See `main.ts`'s `reconcileEditors` for the fix's own account
 * — INCLUDING THE THIRD ROUND'S CORRECTION TO IT: that sweep visited the sessions `editorOwner` named,
 * so it could not see a custody entry with no CLAIM against it either, until its custody pass was given
 * `heldEditors` as its own domain. That is a fact about the callee, not about this call site, and the
 * dependency was already the right one — a narrower reading of "what could this call not reach" is
 * exactly what left the second gap open. What matters here is that unmounting is not a thing this file
 * should be describing pane by pane.
 * `undefined` HAD ALREADY MADE THE OLD CALL DEAD, WHICH IS WORTH SAYING BECAUSE IT IS WHY NOTHING
 * NOTICED: `retire` rebinds every slot in the collection back to `home` SYNCHRONOUSLY, before it
 * returns, so by the line below `editorHomeFor` could no longer resolve any pane to the retiring session
 * and `editorHome()?.setEditor(null)` was `undefined?.` on every path that reached it. The mounted
 * editor came down one tick later through `LambdaPane.setDetached`'s teardown instead — which is exactly
 * why a broken line here reported nothing.
 */
export function createCompile(deps: {
  sessions: SessionRegistry
  scratchpad: LambdaScratchpad
  results: HTMLElement
  picker: HTMLSelectElement
  view: () => EditorView
  panes: PaneCollection
  links: LinkWiring
  draw: () => void
  sourceSession: SessionId
  reconcileEditors: () => void
}): { schedule(src: string): void } {
  const {
    sessions,
    scratchpad,
    results,
    picker,
    view,
    panes,
    links: linkWiring,
    draw,
    sourceSession,
    reconcileEditors,
  } = deps

  let timer: ReturnType<typeof setTimeout> | undefined

  /**
   * Debounce a compile of `src`, the source editor's current text.
   *
   * `supersede()` IS CALLED SYNCHRONOUSLY HERE, AT DISPATCH, BEFORE THE `setTimeout` — NOT INSIDE IT,
   * AND NOT ON THE TRAILING EDGE OF THE DEBOUNCE. This is the one ordering in this file that must
   * survive the move unchanged. `SessionClient.supersede`'s own doc has the measurement: while the
   * generation bump lived inside the timeout (or later still, in `request`), the PREVIOUS generation
   * stayed current for the whole debounce window and often longer — a `setTimeout` competes with the
   * worker's own frame recording and can be starved for seconds, so a stale `result` could still land
   * and flip `results.dataset.state` back to `'idle'` for a program the user had already replaced.
   * Twenty-odd browser tests poll exactly that flag (`app.test.ts`'s `settled`) to mean "the program I
   * just dispatched has finished" — with the old ordering they could resolve against the SUPERSEDED
   * program instead. Claiming the generation here, before the timer is even armed, closes that window
   * at the instant of dispatch rather than at the end of it.
   */
  const schedule = (src: string) => {
    clearTimeout(timer)
    results.dataset.state = 'running'
    // A SOURCE KEYSTROKE IS ALSO THE OTHER CLEAR SITE FOR `forkFailed` — see its own doc. `schedule`
    // runs on every keystroke, unconditionally, which is what makes this the right place: a report
    // about a click on the OLD program is not news about whatever the user is typing now, whether or
    // not this particular keystroke happens to retire a scratchpad.
    linkWiring.setForkFailed(null)
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
    // `reconcileEditors()` IN THE SAME BRANCH, BEFORE `draw()`. A retired scratchpad has no term left
    // to show in the box that was editing it — `retire`'s own doc: "the text in the box is lost"
    // (design §4.3) — and no `LambdaEditor` for it may survive this line, whether it is MOUNTED on a
    // pane or WAITING in `main.ts`'s `heldEditors` after the pane holding it was closed. Both are one
    // live CodeMirror instance with its own pending debounce over a session `pool.unbind` has just
    // terminated; the second one is what a `setEditor(null)` through a single pane could not reach, and
    // is the Important finding this call replaces (see the `reconcileEditors` dependency's own doc).
    //
    // **THE WAITING HALF OF THAT SENTENCE WAS STILL FALSE FOR ONE ROUND AFTER IT WAS WRITTEN, AND THE
    // FIX IS IN THE CALLEE RATHER THAN HERE.** `reconcileEditors` swept the sessions `editorOwner`
    // named, so a held editor whose claim had been dropped — which is what `reset layout` does to a
    // closed pane's claim — was invisible to this call, and this branch retired its session while it
    // went on living. The line here did not change; its domain did. Recorded at this call site anyway,
    // because "a retire leaves no editor behind" is the claim THIS file makes and the one a reader
    // checks from here.
    //
    // THE SWEEP HAPPENS AT THE RETIRE SITE, AND NOT BY MAKING THIS PATH CALL `applyLayout()` — the
    // deliberate half of the choice, recorded because both would have worked. The asymmetry that caused
    // the finding is that this path calls `draw()` while every layout gesture calls `applyLayout()`, and
    // only the latter reconciles editors; the cheap-looking repair is to call `applyLayout()` here too.
    // It is the wrong one. `applyLayout`'s own doc opens with "panes are created and removed here and
    // nowhere else", and it also re-renders the tree and re-serialises it into `localStorage` — none of
    // which a retire has any business doing, because a retire changes no leaf. Calling
    // `reconcileEditors` directly says exactly what changed (a session died, so its editor has nowhere
    // to be) without claiming the tree moved, and keeps ONE place that decides where every editor lives
    // rather than adding a second teardown for `applyLayout`'s to be kept in step with.
    //
    // Guarded by the same boolean as `draw()`, for the same reason: most recompiles retire nothing, and
    // an unguarded sweep on every keystroke would iterate `panes.of('lambda')` finding `null` every time
    // it already did.
    if (
      scratchpad.retire(
        sourceSession,
        panes.all().map((p) => p.slot),
      )
    ) {
      reconcileEditors()
      draw()
    }
    // THE SOURCE SESSION BY NAME, NOT THROUGH A PANE'S BINDING. Recompiling is what the editor does to
    // the session it is the source of; it is not something a pane slot points at, so this stays
    // addressed to `sourceSession` however the three panes end up bound. Resolved inside `schedule`
    // rather than held as a local for the reason `draw()` gives: a client belongs to a registry entry
    // now, and a second reference to it beside the registry is a second thing to keep in step.
    const client = sessions.entryOf(sourceSession).client
    // SUPERSEDE NOW, POST LATER. The generation is claimed synchronously so the previous run's
    // replies stop being current at the instant of dispatch; `request` drops the post if another
    // keystroke claimed a newer one during the debounce. See `SessionClient.supersede`.
    const gen = client.supersede()
    timer = setTimeout(() => client.request(gen, src, picker.value), DEBOUNCE_MS)
  }

  // The picker is otherwise inert: `schedule` only reads `picker.value` when a keystroke's update
  // listener calls it, so choosing a different encoding would sit unused until the user typed again.
  picker.addEventListener('change', () => schedule(view().state.doc.toString()))

  return { schedule }
}
