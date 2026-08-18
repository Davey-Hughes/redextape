import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { lintGutter, setDiagnostics as setCmDiagnostics } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { lintRanges } from './diagnostics'
import type { Diagnostic } from './types'

/**
 * What a scratch editor needs: where to mount, what to start with, how long to wait, and where edits
 * go.
 */
export type ScratchEditorConfig = {
  host: HTMLElement
  initial: string
  /** `main.ts`'s `DEBOUNCE_MS`, passed in rather than imported — see the class doc. */
  debounceMs: number
  onEdit: (src: string) => void
}

/**
 * **THE SCRATCH TEXT EDITOR — design §4.2's upper region and §4.3's recompile trigger, for either leg
 * a scratch buffer can hold.**
 *
 * A CodeMirror 6 instance over a scratch session's text. It is the surface 5d-i's §6 said had no
 * home: `ScratchBuffers` gave a scratch a life of its own, and this is the thing that can change
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
 * stale colouring on a buffer being typed into is worse than none. The same argument is why `.tm` text
 * stays uncoloured here too: `print_tm_mapped` exists in `redextape-core` but is not exported to wasm,
 * because a colouring computed from a printed machine is stale the instant the user types.
 *
 * **`debounceMs` IS INJECTED RATHER THAN IMPORTED FROM `main.ts`.** It is `DEBOUNCE_MS` (300), the
 * source pane's own constant, because it is the same gesture at the same speed — but importing from
 * `main.ts` would make a module that mounts the app a dependency of one of its widgets, and the test
 * above needs to drive it without one.
 */
export class ScratchEditor {
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

  constructor(config: ScratchEditorConfig) {
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

  /**
   * Re-point where this editor's debounced edits go — `LambdaPane.receiveEditor`'s other half, and the
   * half that was missing.
   *
   * **THE VIEW MOVES AND ITS CALLBACK DID NOT, WHICH ROUTED KEYSTROKES TO ANOTHER BUFFER — found by
   * driving the app in a browser.** `dom` above is the whole of what a relocation used to move: a
   * `ScratchEditor` is constructed by the pane that FORKS, closing over that pane's `editScratch`, and
   * `receiveEditor` re-parents the node without touching this field. So an editor claimed by a second
   * pane still reported its edits through the FIRST pane's handler — and `transport.ts` resolves
   * `slot.binding.session` at edit time, so the moment that first pane was rebound anywhere else, typing
   * in the moved editor recompiled whatever the first pane happened to be showing. Measured in Chromium:
   * three characters typed into a pane showing `scratch 1` put the parse error on a different pane's
   * editor, over `scratch 2`.
   *
   * A SETTER RATHER THAN A SESSION ID CARRIED ON THIS CLASS. The alternative is to make the editor name
   * its own buffer and have `recompile` read that — truer in the abstract, and a bigger change than the
   * defect warrants: it would give this class a second identity to keep in step with custody's, which
   * already keys editors by session. What is actually wrong is narrower and is exactly what this fixes:
   * the ONE field a relocation has to carry across was not being carried.
   *
   * A PENDING DEBOUNCE FROM BEFORE THE MOVE FIRES THROUGH THE NEW HANDLER, which is correct rather than
   * merely tolerable: `#schedule` reads this field when the timer expires, and the text it will send is
   * this editor's text, which belongs to the buffer whichever pane is showing it.
   */
  set onEdit(fn: (src: string) => void) {
    this.#onEdit = fn
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
   * THE CANCEL IS THE POINT. A retirement destroys this while a debounce may be in flight; firing it
   * afterwards would post a `lambda-scratch` to a session the pool has already unbound. (The
   * retirement in question was §4.3's recompile-from-source until 5d-ii-c decision 2 deleted it; a
   * rebind away from the buffer destroys this on the same terms, and the retire control §4.4 puts in
   * the header list is the other.) `SessionClient.scratch` guards on generation, so the message would be
   * dropped rather than misdelivered — but a message sent to be dropped is a race left in on purpose.
   */
  destroy(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    this.#view.destroy()
  }
}
