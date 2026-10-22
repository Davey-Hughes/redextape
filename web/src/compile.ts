import type { EditorView } from '@codemirror/view'
import type { SessionId } from './session-client'
import type { SessionRegistry } from './sessions'

/**
 * Milliseconds to wait after the last keystroke before posting a compile. The comments on `schedule`'s
 * body below have the load-bearing detail.
 */
const DEBOUNCE_MS = 300

/**
 * `schedule`, its debounce timer, and the encoding picker's `change` listener. See `schedule`'s own doc
 * below for what it does; this one is only about the dependencies. A compile is a `supersede` and a
 * `request` against the source session's own client and nothing more.
 *
 * `view` IS A THUNK, NOT A VALUE, SAME REASON AS `link-wiring.ts`, `draw.ts` AND `replies.ts`. The
 * picker's `change` listener is wired here, at construction, but `main.ts` does not assign `let view:
 * EditorView` until the `EditorView` itself is constructed — which happens AFTER this factory runs, so
 * a value parameter would capture `undefined` forever.
 *
 * `sourceSession` is the literal source-session id `main.ts` names once at construction, and is not
 * derivable from anything else this factory already takes. Named `sourceSession` here rather than
 * `SOURCE_SESSION` because every other dep in this signature is camelCase.
 */
export function createCompile(deps: {
  sessions: SessionRegistry
  results: HTMLElement
  picker: HTMLSelectElement
  view: () => EditorView
  sourceSession: SessionId
  /** Store the program as it is posted: its text, and the encoding the compile was given. */
  persist: (text: string, encoding: string) => void
}): { schedule(src: string): void } {
  const { sessions, results, picker, view, sourceSession, persist } = deps

  let timer: ReturnType<typeof setTimeout> | undefined

  /**
   * Debounce a compile of `src`, the source editor's current text.
   *
   * `supersede()` IS CALLED SYNCHRONOUSLY HERE, AT DISPATCH, BEFORE THE `setTimeout` — NOT INSIDE IT,
   * AND NOT ON THE TRAILING EDGE OF THE DEBOUNCE. With the generation bump inside the timeout (or later
   * still, in `request`), the PREVIOUS generation would stay current for the whole debounce window and
   * often longer — a `setTimeout` competes with the worker's own frame recording and can be starved for
   * seconds, so a stale `result` could land and flip `results.dataset.state` back to `'idle'` for a
   * program the user had already replaced. Browser tests poll exactly that flag (`app.test.ts`'s
   * `settled`) to mean "the program I just dispatched has finished", and would resolve against the
   * SUPERSEDED program instead. Claiming the generation here, before the timer is even armed, closes
   * that window at the instant of dispatch rather than at the end of it. See `SessionClient.supersede`.
   */
  const schedule = (src: string) => {
    clearTimeout(timer)
    results.dataset.state = 'running'
    // **A SOURCE KEYSTROKE ENDS NO BUFFER — 5d-ii-c design §4.3.** A scratch buffer is an independent λ
    // session the user edits, which nothing but an explicit retire ends.
    //
    // **THE HEADER LIST, NOT A RECOMPILE, IS THE APP'S POISON RECOVERY — 5d-ii-c design §3.4 and §4.4.** Its
    // delete is the escape, reachable whether or not a pane still shows the buffer, which is why §4.4
    // put it in the header rather than in pane chrome.
    //
    // A compile repaints the panes: `client.supersede()` below notifies the pool's `onSupersede`
    // callback, which is `() => draw()`, so a claimed generation reaches the panes synchronously on
    // every dispatch. The source's own frames arrive through `replies.ts` and drive their own.
    //
    // THE SOURCE SESSION BY NAME, NOT THROUGH A PANE'S BINDING. Recompiling is what the editor does to
    // the session it is the source of; it is not something a pane slot points at, so this stays
    // addressed to `sourceSession` however the panes end up bound. Resolved inside `schedule` rather
    // than held as a local: a client belongs to a registry entry, and a second reference to it beside
    // the registry is a second thing to keep in step.
    const client = sessions.entryOf(sourceSession).client
    // SUPERSEDE NOW, POST LATER. The generation is claimed synchronously so the previous run's
    // replies stop being current at the instant of dispatch; `request` drops the post if another
    // keystroke claimed a newer one during the debounce. See `SessionClient.supersede`.
    const gen = client.supersede()
    timer = setTimeout(() => {
      const encoding = picker.value
      client.request(gen, src, encoding)
      // **THE PROGRAM IS STORED WHERE IT IS POSTED — Plan 7 part 6a spec §4.3.** A keystroke, an encoding change, a
      // picked example and the start-up program all arrive here, so this is the one write site and there is one write
      // per pause. A keystroke in the last `DEBOUNCE_MS` before the tab closes is not stored, as a copy's is not.
      persist(src, encoding)
    }, DEBOUNCE_MS)
  }

  // The picker is otherwise inert: `schedule` only reads `picker.value` when a keystroke's update
  // listener calls it, so choosing a different encoding would sit unused until the user typed again.
  picker.addEventListener('change', () => schedule(view().state.doc.toString()))

  return { schedule }
}
