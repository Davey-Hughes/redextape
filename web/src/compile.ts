import type { EditorView } from '@codemirror/view'
import type { LinkWiring } from './link-wiring'
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
 * a value parameter would capture `undefined` forever. `links`, by contrast, is a real value by the
 * point `main.ts` calls this factory — already assigned, same as it is for `createReplies`.
 *
 * **FOUR DEPENDENCIES LEFT WITH THE RETIRE, AND THIS PARAGRAPH IS WHERE THEY USED TO BE ARGUED FOR.**
 * `scratchpad: ScratchBuffers`, `panes: PaneCollection`, `draw: () => void` and `reconcileEditors:
 * () => void` were all here to serve ONE branch — the retire a source keystroke used to perform — and
 * 5d-ii-c decision 2 deletes it; `schedule`'s own comment has that argument and the gap it opens.
 * Nothing else in this file ever read them, because a compile is a `supersede` and a `request` against
 * the source session's own client and nothing more. What stood here justified handing `retire`
 * `panes.all().map((p) => p.slot)` rather than the literal `[lambdaSlot, tmSlot]` (T7) — **and the
 * sibling call this pointed at, "`replies.ts` makes the identical conversion for the sibling call in
 * `noSessionReply`", is gone too**: the next task took the retire out of that arm as well, so neither
 * file passes slots to anything any more. `replies.ts`'s own `no-session` arm records what went with it.
 *
 * `sourceSession` IS NOT IN THE TASK BRIEF'S SIGNATURE, AND IS NEEDED ANYWAY. It is the literal
 * source-session id `main.ts` names once at construction, and is not derivable from anything else this
 * factory already takes. Named `sourceSession` here rather than `SOURCE_SESSION`, matching
 * `createReplies`'s own dependency of the same name and for the same reason: every other dep in this
 * signature is camelCase.
 *
 * `tmPane` IS IN THE BRIEF'S SIGNATURE AND IS NOT HERE, and no pane of any leg is here now. `schedule`
 * never read it — the only pane this file ever touched was `setEditor(null)` on the branch where a
 * scratchpad retired, and that branch is gone; the TM leg never had a scratchpad to reflect and nothing
 * in this file's moved body ever mentioned a TM pane. Grepping the moved code for it turns up nothing.
 *
 * **THE EDITOR SWEEP AND THE FINDING BEHIND IT ARE RECORDED WHERE THE SWEEP STILL HAPPENS, NOT HERE.**
 * This file took `reconcileEditors: () => void` — and, before that, a narrow `editorHome: () =>
 * LambdaPane | undefined` thunk it called `setEditor(null)` through — because a retire must leave no
 * `LambdaEditor` behind for a session that no longer exists, including one in CUSTODY
 * (`editor-custody.ts`'s `heldEditors`, where a closed pane's editor waits) which the narrow thunk could
 * not reach at all. Both spellings went with the retire. The account of that IMPORTANT finding, and of
 * the third round's correction to it — the sweep visited the sessions `editorOwner` named, so a custody
 * entry with no CLAIM against it stayed invisible until `heldEditors` became its own domain — lives in
 * `editor-custody.ts`'s `reconcileEditors`. **THIS SENTENCE ALSO NAMED "`replies.ts`'s call site, which
 * is the app's remaining retire path", AND THAT PATH IS GONE TOO**: the task after this one removed that
 * arm's retire and its `reconcileEditors` dependency with it. The sweep is called from `applyLayout`, on
 * every layout gesture, and from `main.ts`'s header-list retire handler, which is the one place in
 * `src/` that ends a buffer (design §4.2/§4.4). (Written without the arity it opened with — "the sweep
 * has two callers now" — for the reason this slice has now applied twice elsewhere: a count is the part
 * of a sentence that rots first, and naming both callers says strictly more.)
 */
export function createCompile(deps: {
  sessions: SessionRegistry
  results: HTMLElement
  picker: HTMLSelectElement
  view: () => EditorView
  links: LinkWiring
  sourceSession: SessionId
}): { schedule(src: string): void } {
  const { sessions, results, picker, view, links: linkWiring, sourceSession } = deps

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
    // about a click on the OLD program is not news about whatever the user is typing now. That was the
    // argument while this keystroke could also end a buffer, and it is unchanged now that it cannot.
    linkWiring.setForkFailed(null)
    // **A SOURCE KEYSTROKE ENDS NO BUFFER, AND THIS IS WHERE THE CALL THAT ENDED ONE WAS DELETED —
    // 5d-ii-c decision 2, design §4.3.** `schedule` used to call `scratchpad.retire(...)` on this line,
    // synchronously at dispatch: it terminated the buffer's worker and rebound every pane bound to it
    // back to `sourceSession`, so the pane came home on the keystroke that invalidated the buffer's
    // provenance rather than `DEBOUNCE_MS` plus a compile later. §4.3's table is the whole change —
    // "recompile from source: ended it -> **survives**" — and a scratch buffer is now an independent λ
    // session the user edits, which nothing but an explicit retire ends.
    //
    // **IT WAS ALSO THE APP'S POISON RECOVERY, AND THE HEADER LIST HAS INHERITED THAT ROLE — design
    // §3.4 and §4.4.** 5d-i §4.3 made this call the recovery path on purpose ("the same mechanism as
    // poison recovery"), so a wedged buffer died on the next keystroke without the user ever learning it
    // was wedged. Removing it removed a safety mechanism, and **this paragraph read "until the header
    // list is mounted beside `reset layout` there is no way to reclaim a poisoned buffer at all"** while
    // `buffer-list.ts` was written, tested and imported by nobody. `main.ts` builds it now, beside
    // `reset layout`, and its retire is the escape — reachable whether or not a pane still shows the
    // buffer, which is why §4.4 put it in the header rather than in pane chrome. Recorded here rather
    // than only in a plan, because this file is where a reader asks what a recompile does to a buffer.
    //
    // THREE MORE THINGS WENT WITH THE CALL, and all three existed only to serve it. The
    // `scratchpad.list().at(-1)` placeholder that picked WHICH buffer a keystroke ended — deliberately
    // visible in a caller that could not justify the choice, rather than hidden as a rule inside a
    // collection that has ids for everything else. The `reconcileEditors()` that had to leave no
    // `LambdaEditor` behind, mounted or in custody, for the session the retire killed. And the `draw()`
    // beside it, which repainted the panes the rebind had just moved: nothing here changes a binding
    // now, so there is nothing for this path to repaint, and the source's own frames arrive through
    // `replies.ts` and drive their own.
    //
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
