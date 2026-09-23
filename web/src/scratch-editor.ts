import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { lintGutter, setDiagnostics as setCmDiagnostics } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { lspLintRanges } from './diagnostics'
import type { KeymapSetting } from './editor-keymap'
import { keymapSlot } from './editor-keymap'
import { DEFAULT_KEYMAP } from './editor-prefs'
import type { LspClient } from './lsp-client'
import { lspHover } from './lsp-hover'
import { navKeymap } from './lsp-nav'
import type { LanguageId, LspDiagnostic, LspRange } from './lsp-protocol'
import { applyEdits, revealRange } from './lsp-text'

/**
 * What a scratch editor needs: where to mount, what to start with, how long to wait, and where edits
 * go.
 */
export type ScratchEditorConfig = {
  host: HTMLElement
  initial: string
  /** `compile.ts`'s `DEBOUNCE_MS`, passed in rather than imported — see the class doc. */
  debounceMs: number
  onEdit: (src: string) => void
  /**
   * The colourer for this editor's language — `colour.ts`'s `treeSitterColour`, already built.
   *
   * **PASSED IN RATHER THAN BUILT HERE, BECAUSE THE GRAMMAR REGISTRY BELONGS TO THE APP.** One registry
   * loads each grammar once for the whole page (`colour.ts`'s `createGrammarRegistry`); a
   * `ScratchEditor` reaching for a module-level singleton would make every test that mounts one fetch
   * four `.wasm` files, and would put the app's failure policy — which notice, on which surface —
   * inside a widget. The same argument `document.client` above is a config field for.
   *
   * Optional, and the callers that omit it are tests with no colouring to exercise.
   */
  colour?: Extension | undefined
  /**
   * The page's keymap setting — `editor-keymap.ts`'s `KeymapSetting`, which this editor joins.
   *
   * **PASSED IN FOR THE REASON `colour` ABOVE IS, AND THE CONSEQUENCE IS DIFFERENT.** One setting
   * serves the whole page, and an editor reaching for a module-level one would put the app's state
   * inside a widget. What this one also buys is the reverse direction: joining is how the setting
   * learns this editor exists, so a change made in the menu reaches an editor that was built before
   * the menu was touched.
   *
   * Optional, and the callers that omit it are tests with no keymap to exercise; such an editor starts
   * in — and stays in — CodeMirror's own bindings.
   */
  keymap?: KeymapSetting | undefined
  /**
   * The server has published for this document — one per settled edit.
   *
   * **THE CHEAPEST 'THE SERVER HAS CAUGHT UP' SIGNAL THERE IS**, because diagnostics are pushed
   * on every `didChange` whether or not there are any. The outline panel refreshes on it rather
   * than running a debounce of its own.
   */
  onServerUpdate?: (() => void) | undefined
  /**
   * The LSP document this editor IS, and the client that serves it.
   *
   * **KEYED BY SESSION, NOT BY PANE, BECAUSE THAT IS WHAT AN EDITOR IS 1:1 WITH.** `editor-custody.ts`
   * holds editors under `SessionId` and its own doc records why a session can never have two: a
   * session has exactly one leg. An editor also MOVES between panes, so a pane-keyed document would
   * change URI under a buffer nobody edited.
   *
   * Optional, and the one caller that omits it is a test with no language features to exercise. The
   * app always passes it.
   */
  document?:
    | {
        uri: string
        languageId: LanguageId
        client: Pick<
          LspClient,
          | 'openDocument'
          | 'changeDocument'
          | 'closeDocument'
          | 'format'
          | 'documentSymbols'
          | 'definition'
          | 'references'
          | 'hover'
        >
        /** Whether losing focus should reformat — read at blur, so the setting takes effect at once. */
        formatOnBlur: () => boolean
        /** `notice.ts`'s `notify`, for a jump that cannot land. */
        notify: (text: string) => void
        /**
         * How this editor reads to a screen reader — `λ · copy 1`, `TM · copy 2`.
         *
         * **DEFERRED-ACCESSIBILITY ITEM 16: "NEITHER EDITABLE TEXT REGION CARRIES AN ACCESSIBLE
         * NAME".** CodeMirror gives its content a `textbox` role and no name, so every editor on
         * the page announced identically — which on a tiled workspace showing three of them is
         * the difference between navigable and not.
         */
        label: string
      }
    // `exactOptionalPropertyTypes` is on, so absent and explicitly-undefined are different types.
    // `PaneEvents.lspDocument` is optional, so its call site produces the second.
    | undefined
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
 * **TWO COLOURING PATHS ON ONE PANE, ON DIFFERENT CLOCKS, AND THE OLDER ARGUMENT IS STILL HALF TRUE.**
 * The pane's `<pre>` colours tokens from `spans`, which the worker computes per frame from a term it
 * holds, and **that path is unchanged** — its frame is a printed term, so its colouring is a fact about
 * what the worker last sent. What this class used to carry was the conclusion drawn from that: an
 * editor's buffer is text the user is halfway through typing, there is no frame for it, and a colouring
 * computed from printed output is stale the instant the user types. That half still holds, and it is
 * exactly why the frame's spans are not reused here.
 *
 * **THE OTHER HALF WAS "λ HAS NO PARSER FOR BUFFER TEXT", AND TREE-SITTER IS THE ANSWER TO IT.** The
 * argument ran that `analyze` is the SOURCE language's parser rather than λ's, that colouring a buffer
 * would need a λ `linter`-shaped path the slice did not have, and — for `.tm` — that `print_tm_mapped`
 * exists in `redextape-core` but is not exported to wasm. There are four committed grammars now
 * (`grammars/`), one per language, and `colour.ts` parses the BUFFER rather than printed output: the
 * `colour` config field above is that parser, arriving per editor for whichever language this one
 * holds. So this class colours from a tree over the text on screen, while the pane beside it colours a
 * frame from the term the worker holds, and neither is derived from the other.
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
  #document: ScratchEditorConfig['document']
  /** Set by `destroy()`, so an in-flight format cannot recompile a buffer that is gone. */
  #destroyed = false
  #onServerUpdate: (() => void) | undefined
  #keymap: KeymapSetting | undefined

  constructor(config: ScratchEditorConfig) {
    this.#ms = config.debounceMs
    this.#onEdit = config.onEdit
    this.#document = config.document
    this.#onServerUpdate = config.onServerUpdate
    this.#keymap = config.keymap
    this.#view = new EditorView({
      parent: config.host,
      state: EditorState.create({
        doc: config.initial,
        extensions: [
          history(),
          // ABOVE BOTH KEYMAPS BELOW, NOT BETWEEN THEM — `editor-keymap.ts`'s `keymapSlot` has the
          // mechanism, which is about DOM event handlers rather than about key bindings.
          keymapSlot(config.keymap?.mode ?? DEFAULT_KEYMAP),
          // BEFORE the default keymap, so a binding here wins — neither key is in it (74 bindings
          // scanned, no F-keys), so today this is order for its own sake rather than a conflict.
          keymap.of(
            navKeymap({
              uri: () => this.#document?.uri,
              client: () => this.#document?.client,
              reveal: (range) => this.reveal(range),
              notify: (text) => this.#document?.notify(text),
            }),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          lintGutter(),
          lspHover({ uri: () => this.#document?.uri, client: () => this.#document?.client }),
          // SPREAD RATHER THAN PASSED AS A POSSIBLY-`undefined` ENTRY: CodeMirror's `Extension` union
          // does not include `undefined`, so an absent colourer has to contribute no element at all.
          ...(config.colour ? [config.colour] : []),
          // The name goes on the element CodeMirror gives the `textbox` role to, which is the one
          // a screen reader lands on — not on the wrapper.
          EditorView.contentAttributes.of({ 'aria-label': `${config.document?.label ?? 'text'} editor` }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || this.#seeding) return
            this.#schedule()
          }),
          EditorView.domEventHandlers({
            blur: () => {
              if (this.#document?.formatOnBlur() !== true) return false
              // CAUGHT, NOT `void`ed: an unhandled rejection in a browser reaches
              // `window.onunhandledrejection` and prints as an uncaught error. `LspClient`'s
              // `initialize` carries the same note, for the same reason.
              this.format().catch(() => {})
              return false
            },
          }),
        ],
      }),
    })
    // JOINED AFTER CONSTRUCTION, because `follow` takes the view and the view is what is being built
    // on the line above. The slot it filled already holds this mode; joining is what keeps it in step
    // with a LATER change, and `destroy()` is where it leaves.
    this.#keymap?.follow(this.#view)
    // OPENED WITH THE TEXT THE EDITOR WAS SEEDED WITH, not with whatever the buffer held a moment
    // ago: the server's copy and the editor's must agree from the first message, and this is the
    // only point where both are known to.
    this.#document?.client.openDocument(this.#document.uri, this.#document.languageId, config.initial, {
      diagnostics: (ds) => this.#showDiagnostics(ds),
    })
  }

  /**
   * This editor's own DOM root — CodeMirror's node, not a wrapper around it.
   *
   * EXPOSED SO A CALLER CAN RELOCATE IT — `LambdaPane.receiveEditor` (wave 3's editor-moves rule) is
   * the one caller, and it exists precisely because moving `dom` into a different parent element is
   * what CodeMirror already supports for free: `Node.append` on a node already in the document MOVES
   * it rather than duplicating it — the DOM removes a node from its old parent before inserting it, so
   * there is never a moment with two copies and never a detach call to write. No CodeMirror API is
   * needed beyond that; this getter is the only reason
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
      const text = this.#view.state.doc.toString()
      // TOLD TO THE SERVER ON THE SAME DEBOUNCE AS THE RECOMPILE, not on every keystroke. The
      // source editor posts per keystroke because nothing else there is debounced; here the
      // gesture already has a speed, and a buffer's text is the thing both consumers read.
      this.#document?.client.changeDocument(this.#document.uri, text)
      this.#onEdit(text)
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
    // **THE SERVER IS TOLD EVEN THOUGH THIS IS NOT AN EDIT, AND THAT IS THE POINT.** `#seeding`
    // exists to stop a seed being reported back as a recompile; it must NOT also stop the server
    // learning the new text. A fork seeds the editor from the worker's term, and a server still
    // holding the previous text would publish diagnostics against a document nobody is looking at.
    this.#document?.client.changeDocument(this.#document.uri, text)
  }

  /**
   * Show `ds` in the gutter — this editor's own `DiagnosticsSink`, handed to `openDocument`.
   *
   * **A PUSH, AS BEFORE, BUT FROM A DIFFERENT PUSHER.** These used to arrive on the session worker's
   * run reply, which meant a λ copy got them and a TM copy got nothing — `tm-pane.ts` never called
   * this method. They now arrive from the LSP worker for every editor alike.
   *
   * No byte conversion: the server negotiates `positionEncoding: utf-16`, which is what CodeMirror
   * counts in. `lspLintRanges` still widens a zero-width range, because rendering nothing for
   * `from === to` is a property of CodeMirror rather than of the offsets.
   */
  #showDiagnostics(ds: LspDiagnostic[]): void {
    const cm = lspLintRanges(ds, this.#view.state.doc).map(
      (r): CmDiagnostic => ({ from: r.from, to: r.to, severity: r.severity, message: r.message }),
    )
    this.#view.dispatch(setCmDiagnostics(this.#view.state, cm))
    this.#onServerUpdate?.()
  }

  /** Put the caret on `range` in this editor and focus it — the outline's jump. */
  reveal(range: LspRange): void {
    revealRange(this.#view, range)
  }

  /**
   * Reformat this editor's document.
   *
   * **IT FLUSHES THE PENDING EDIT FIRST, AND BOTH WAYS IN NEED THAT.** A copy's keystrokes reach the
   * server on a 300 ms debounce, so a format asked for inside that window is answered from the text
   * the server still holds — and `textDocumentSync` is Full, so the answer replaces the whole
   * document and those keystrokes vanish. The blur path had this guard and the `⋯` menu's *format*
   * item did not, which is the same exposure through a different door.
   *
   * **THE RECOMPILE CARRIES THE POST-FORMAT TEXT, AND THAT IS THE LOAD-BEARING PART.** `#onEdit`
   * rebuilds the buffer, the reply redraws the pane, and the pane re-seeds this editor with whatever
   * the buffer now holds. Hand it the text as typed and it overwrites the formatting a moment after
   * `applyEdits` put it there — measured while tracing it: the server returned the right edits, they
   * were applied, and `setText` undid them. An earlier fix named the ORDER as the mechanism and was
   * wrong; restoring the original order under the test left it green, and recompiling the pre-format
   * text reddens it.
   *
   * A buffer that does not parse formats to nothing rather than to an error — `Language::format`
   * answers `None`, the server sends `null`, the client turns that into no edits — which is what
   * makes *format on blur* safe to leave on. A rejection means the server is gone and `LspClient`
   * has already said so; this is one gesture that failed, not a second thing to report.
   */
  async format(): Promise<void> {
    const doc = this.#document
    if (doc === undefined) return
    const pending = this.#timer !== null
    if (this.#timer !== null) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    const before = this.#view.state.doc.toString()
    doc.client.changeDocument(doc.uri, before)
    try {
      const edits = await doc.client.format(doc.uri)
      if (this.#destroyed) return
      applyEdits(this.#view, edits)
    } catch {
      // Reported by the client, once, for the server rather than for this gesture.
    }
    // **CHECKED AFTER THE AWAIT, BECAUSE `destroy()` CANNOT CANCEL THIS.** `destroy()` clears the
    // debounce timer and its doc calls that cancel the point — but a format launched from the blur
    // handler is an async continuation with no timer to clear, and a blur is exactly what a click
    // on `retire` produces. Without this the gesture would recompile a buffer that has been
    // removed and dispatch into a destroyed view.
    if (this.#destroyed) return
    const after = this.#view.state.doc.toString()
    // Rebuilt when a recompile was owed, or when formatting changed the text. Skipped when neither
    // holds, so formatting an untouched, already-formatted editor costs nothing.
    if (pending || after !== before) this.#onEdit(after)
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
    this.#destroyed = true
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    // CLOSED WITH THE EDITOR, because the document exists to serve it. A pane rebinding away
    // destroys this editor while the buffer lives on; the next pane to show that buffer builds a
    // new editor, which opens the document again. Leaving it open would keep publishing
    // diagnostics to a sink whose editor is gone.
    this.#document?.client.closeDocument(this.#document.uri)
    // LEFT BEFORE THE VIEW GOES, so a keymap change made after this retirement does not dispatch a
    // reconfiguration into a destroyed view — and so the setting does not hold this editor alive.
    this.#keymap?.unfollow(this.#view)
    this.#view.destroy()
  }
}
