import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { lintGutter, setDiagnostics as setCmDiagnostics } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { lintRanges } from './diagnostics'
import type { Diagnostic } from './types'

/**
 * What a λ term editor needs: where to mount, what to start with, how long to wait, and where edits
 * go.
 */
export type LambdaEditorConfig = {
  host: HTMLElement
  initial: string
  /** `main.ts`'s `DEBOUNCE_MS`, passed in rather than imported — see the class doc. */
  debounceMs: number
  onEdit: (src: string) => void
}

/**
 * **THE λ TERM EDITOR — design §4.2's upper region and §4.3's recompile trigger.**
 *
 * A CodeMirror 6 instance over a scratch session's term. It is the surface 5d-i's §6 said had no
 * home: `LambdaScratchpad` gave a scratch a life of its own, and this is the thing that can change
 * its text.
 *
 * **ITS OWN MODULE FOR THE REASON `scratch.ts` IS.** `lambda-pane.ts` is 289 lines and its whole job
 * is `(frame, controls) -> DOM`; a document surface, a debounce timer and a diagnostics channel mixed
 * into it would put it past 450 and put three concerns behind one name. It is also where the coverage
 * gate can see it, which `session-worker.ts` is not.
 *
 * **NO SYNTAX HIGHLIGHTING, AND THAT IS NOT AN OVERSIGHT.** The pane's `<pre>` colours tokens from
 * `spans`, which the worker computes per frame from a term it holds. An editor's buffer is text the
 * user is halfway through typing — there is no frame for it and `analyze` is the SOURCE language's
 * parser, not λ's. Colouring it would need a λ `linter`-shaped path this slice does not have, and a
 * stale colouring on a buffer being typed into is worse than none.
 *
 * **`debounceMs` IS INJECTED RATHER THAN IMPORTED FROM `main.ts`.** It is `DEBOUNCE_MS` (300), the
 * source pane's own constant, because it is the same gesture at the same speed — but importing from
 * `main.ts` would make a module that mounts the app a dependency of one of its widgets, and the test
 * above needs to drive it without one.
 */
export class LambdaEditor {
  #view: EditorView
  #timer: ReturnType<typeof setTimeout> | null = null
  #ms: number
  #onEdit: (src: string) => void
  /**
   * Set while `setText` is applying a transaction the USER did not cause, so the update listener can
   * tell a seed from a keystroke.
   *
   * **WITHOUT IT, SEEDING THE EDITOR WOULD SCHEDULE A RECOMPILE OF WHAT THE WORKER JUST SENT** — an
   * echo per fork, and a permanent loop if the round trip ever re-seeded. `docChanged` cannot tell
   * the two apart; only the caller can.
   */
  #seeding = false

  constructor(config: LambdaEditorConfig) {
    this.#ms = config.debounceMs
    this.#onEdit = config.onEdit
    this.#view = new EditorView({
      parent: config.host,
      state: EditorState.create({
        doc: config.initial,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          lintGutter(),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || this.#seeding) return
            this.#schedule()
          }),
        ],
      }),
    })
  }

  /**
   * This editor's own DOM root — CodeMirror's node, not a wrapper around it.
   *
   * EXPOSED SO A CALLER CAN RELOCATE IT — `LambdaPane.receiveEditor` (wave 3's editor-moves rule) is
   * the one caller, and it exists precisely because moving `dom` into a different parent element is
   * what CodeMirror already supports for free: `Node.append` on a node already in the document MOVES
   * it rather than duplicating it (`pane-chrome.ts`'s `layoutControls` doc states the same DOM fact for
   * its own button reordering). No CodeMirror API is needed beyond that; this getter is the only reason
   * `#view` was ever private.
   */
  get dom(): HTMLElement {
    return this.#view.dom
  }

  #schedule(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.#onEdit(this.#view.state.doc.toString())
    }, this.#ms)
  }

  /**
   * Replace the buffer without treating it as an edit — the fork's seed, and nothing else.
   *
   * A NO-OP WHEN THE TEXT ALREADY MATCHES, because a re-seed would move the user's cursor to the end
   * of a document they are working in.
   */
  setText(text: string): void {
    if (this.#view.state.doc.toString() === text) return
    this.#seeding = true
    try {
      this.#view.dispatch({ changes: { from: 0, to: this.#view.state.doc.length, insert: text } })
    } finally {
      this.#seeding = false
    }
  }

  /**
   * Show `ds` in the gutter — design §4.4's push, as against the source pane's pull.
   *
   * `setDiagnostics` AND NOT A `linter` EXTENSION. `lint.ts`'s linter calls `analyze` synchronously
   * because the source pane's diagnostics are computable on the main thread; a scratch's arrive from
   * a worker reply, and a pull-based linter has nothing to pull.
   */
  setDiagnostics(ds: Diagnostic[]): void {
    const doc = this.#view.state.doc.toString()
    // The same two-step `lint.ts` uses — `lintRanges` clamps and converts byte offsets to UTF-16
    // indices, then the shape is widened to `@codemirror/lint`'s. One conversion implementation, not
    // two: `λ` is 2 bytes and 1 UTF-16 code unit, so this is not optional on a λ buffer.
    const cm = lintRanges(ds, doc).map(
      (r): CmDiagnostic => ({ from: r.from, to: r.to, severity: r.severity, message: r.message }),
    )
    this.#view.dispatch(setCmDiagnostics(this.#view.state, cm))
  }

  /**
   * Tear down the instance and **cancel any pending recompile**.
   *
   * THE CANCEL IS THE POINT. A retirement (§4.3's recompile-from-source) destroys this while a
   * debounce may be in flight; firing it afterwards would post a `lambda-scratch` to a session the
   * pool has already unbound. `SessionClient.scratch` guards on generation, so the message would be
   * dropped rather than misdelivered — but a message sent to be dropped is a race left in on purpose.
   */
  destroy(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    this.#view.destroy()
  }
}
