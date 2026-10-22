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
  /** `editor-debounce.ts`'s `EDITOR_DEBOUNCE_MS` in the app, passed in rather than imported — see the class doc. */
  debounceMs: number
  /**
   * Where this editor's edits go — for the app, a rebuild of the copy it was built for (`PaneEvents.editSink`).
   *
   * **FIXED FOR THE EDITOR'S LIFE, BECAUSE AN EDITOR IS ONE COPY'S.** It moves between views, and the view it was
   * built on moves between copies, but it only ever holds one copy's text — `document` below is keyed the same way
   * for the same reason. A sink that resolved "the copy the view shows now" when it fired would send typing into the
   * copy a view had just moved to.
   */
  onEdit: (src: string) => void
  /**
   * The colourer for this editor's language — `colour.ts`'s `treeSitterColour`, already built.
   *
   * **PASSED IN RATHER THAN BUILT HERE, BECAUSE THE GRAMMAR REGISTRY BELONGS TO THE APP.** One registry
   * loads each grammar once for the whole page (`colour.ts`'s `createGrammarRegistry`); a
   * `ScratchEditor` reaching for a module-level singleton would make every test that mounts one fetch
   * four `.wasm` files, and would put the app's failure policy — which notice, on which surface —
   * inside a widget.
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
         * CodeMirror gives its content a `textbox` role and no name, so without one every editor on
         * the page would announce identically — which on a tiled workspace showing three of them is
         * the difference between navigable and not (deferred-accessibility item 16).
         */
        label: string
      }
    // `exactOptionalPropertyTypes` is on, so absent and explicitly-undefined are different types.
    // `PaneEvents.lspDocument` is optional, so its call site produces the second.
    | undefined
}

/**
 * **THE SCRATCH TEXT EDITOR — 5d-iii design §4.2's upper region and §4.3's recompile trigger, for any
 * leg a scratch buffer can hold.**
 *
 * A CodeMirror 6 instance over a scratch session's text: `ScratchBuffers` gives a scratch a life of
 * its own, and this is the thing that can change its text.
 *
 * **ITS OWN MODULE.** `lambda-pane.ts`'s job is `(frame, controls) -> DOM`; a document surface, a
 * debounce timer and a diagnostics channel mixed into it would put three concerns behind one name. It
 * is also where the coverage gate can see it, which `session-worker.ts` is not.
 *
 * **TWO COLOURING PATHS ON ONE PANE, ON DIFFERENT CLOCKS.** The λ view's flat text colours tokens from
 * `spans`, which the worker computes per frame from a term it holds — its frame is a printed term, so
 * its colouring is a fact about what the worker last sent. (A drawn tree colours by token kind instead;
 * `lambda-body.ts`.) An editor's buffer is text the user is halfway through typing, there is no frame
 * for it, and a colouring computed from printed output is stale the instant the user types, which is
 * why the frame's spans are not reused here. `colour.ts` parses the BUFFER rather than printed output,
 * with a committed grammar per language (`grammars/`): the `colour` config field above is that parser,
 * arriving per editor for whichever language this one holds. So this class colours from a tree over
 * the text on screen, while the pane beside it colours a frame from the term the worker holds, and
 * neither is derived from the other.
 *
 * **`debounceMs` IS INJECTED RATHER THAN IMPORTED.** It is the source pane's own speed, `compile.ts`'s
 * `DEBOUNCE_MS` (300), because it is the same gesture at the same speed; the panes pass
 * `editor-debounce.ts`'s `EDITOR_DEBOUNCE_MS`, and a test drives the editor at a speed of its own.
 */
export class ScratchEditor {
  #view: EditorView
  #timer: ReturnType<typeof setTimeout> | null = null
  /**
   * The pre-format text `format()` took off `#timer`, still owed to `onEdit` — or `null` when nothing is owed.
   *
   * **SET BY `format()`, DISCHARGED BY WHICHEVER OF `flush()` OR `format()`'S OWN CONTINUATION GETS THERE
   * FIRST.** `format()` clears `#timer` at its start and carries the pending edit inside its own async closure
   * until the server answers — so a `flush()` that looked at `#timer` alone would see nothing pending for the
   * whole time a format is in flight. A delete or a pause reads a copy's record before any editor comes down
   * (`EditorCustody.flush`), which is BEFORE that closure can ever run; without this field the record would be
   * read stale and undo would restore text missing the keystrokes typed before *format*.
   *
   * **AND DROPPED BY `#send`, WHICH SENDS EVERYTHING THE EDITOR HOLDS.** Typing that overtakes the format sets a
   * debounce of its own, and once that has sent the editor's text this field holds nothing the copy lacks: it
   * holds an older text. Kept, `flush()` would send it after the newer one.
   *
   * **`setText` READS IT TOO**, as it reads `#timer`: while either holds an edit, the editor is ahead of whatever
   * a build's reply carries.
   */
  #formatPending: string | null = null
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
          // BEFORE the default keymap, so a binding here wins — neither key is in it, so this is order
          // for its own sake rather than a conflict.
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
              // `window.onunhandledrejection` and prints as an uncaught error. The `initialize`
              // request in `LspClient.start` carries the same note, for the same reason.
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
   * EXPOSED SO A CALLER CAN RELOCATE IT — `LambdaPane.receiveEditor` (the editor-moves rule, 5d-ii-a
   * design §4.3) and `CopyEditor.receiveEditor` are the callers, and they exist precisely because
   * moving `dom` into a different parent element is what CodeMirror already supports for free:
   * `Node.append` on a node already in the document MOVES it rather than duplicating it — the DOM
   * removes a node from its old parent before inserting it, so there is never a moment with two copies
   * and never a detach call to write. No CodeMirror API is needed beyond that, so `#view` stays private.
   */
  get dom(): HTMLElement {
    return this.#view.dom
  }

  /**
   * Re-point what refreshes when the server publishes for this document — the outline of the view the editor is
   * mounted in, which changes when *move the editor here* moves it (`CopyEditor.receiveEditor`).
   *
   * **ONLY THIS ONE MOVES WITH THE EDITOR, AND `onEdit` DOES NOT.** An edit belongs to the copy the editor was built
   * for, wherever it is shown (`ScratchEditorConfig.onEdit`); a server update is news for the view showing it, whose
   * outline lists the document.
   */
  set onServerUpdate(fn: (() => void) | undefined) {
    this.#onServerUpdate = fn
  }

  #schedule(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#send(), this.#ms)
  }

  /** Send the editor's text as an edit — the debounce's body, and `flush`'s. */
  #send(): void {
    this.#timer = null
    // WHATEVER `format()` TOOK IS SUPERSEDED BY THIS SEND, which carries the FULL current text, cumulative with
    // everything typed — the keystrokes that field was holding included. Dropped here and not only in `flush()`,
    // because the debounce reaches this on its own while a format is in flight; left set then, the next `flush()`
    // would send the older text after this one.
    this.#formatPending = null
    const text = this.#view.state.doc.toString()
    // TOLD TO THE SERVER ON THE SAME DEBOUNCE AS THE RECOMPILE, not on every keystroke. The
    // source editor posts per keystroke because nothing else there is debounced; here the
    // gesture already has a speed, and a buffer's text is the thing both consumers read.
    this.#document?.client.changeDocument(this.#document.uri, text)
    this.#onEdit(text)
  }

  /**
   * Send a pending edit now rather than when its debounce fires, and do nothing when none is pending.
   *
   * **WHAT A VIEW OWES ITS COPY BEFORE IT STOPS SHOWING IT.** A keystroke reaches its copy when the debounce fires, so
   * typing is in the editor alone for up to `debounceMs` after the last key. `destroy` below flushes, so a view that
   * destroys the editor it leaves sends that typing first; `editor-custody.ts`'s `flush` calls this where a copy's
   * record is read or put to sleep before any editor comes down — a delete, whose undo restores what it read, and a
   * pause.
   *
   * **A FORMAT IN FLIGHT HOLDS ITS OWN PENDING TEXT OUTSIDE `#timer`, AND THIS IS WHERE THAT GETS SENT TOO.**
   * `format()` clears `#timer` at its start and carries what it took off it inside its own async closure until the
   * server answers, in `#formatPending` — so a `flush()` that looked at `#timer` alone would find nothing pending for
   * the whole time a format is in flight, and a delete's undo would restore text missing the keystrokes typed before
   * *format*. `#formatPending` is cleared when it is sent, here or by `#send`, so `format()`'s own completion does not
   * send it again.
   */
  flush(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer)
      // A LATER DEBOUNCE SUPERSEDES WHATEVER `format()` TOOK, and `#send()` drops it: see there.
      this.#send()
      return
    }
    if (this.#formatPending !== null) {
      const text = this.#formatPending
      this.#formatPending = null
      this.#onEdit(text)
    }
  }

  /**
   * Replace the buffer without treating it as an edit — the fork's seed, and nothing else.
   *
   * A NO-OP WHEN THE TEXT ALREADY MATCHES, because a re-seed replaces the whole document, and a caret
   * inside the text they are working in goes to its start.
   *
   * **AND A NO-OP WHILE AN EDIT IS PENDING, because `text` is then older than the editor.** Every
   * build reply re-seeds through here, and a build carries what the editor held when its debounce
   * fired; whatever was typed after that is in the editor alone, with a debounce of its own still to
   * fire. Replacing it would lose the typing, and that debounce would then post the older text as the
   * user's. Left alone, the pending build carries the typing, and its own reply re-seeds.
   *
   * **A FORMAT IN FLIGHT HOLDS A PENDING EDIT TOO, OUTSIDE `#timer`, AND THE SAME RULE COVERS IT.**
   * `format()` takes the pending edit off `#timer` and owes it to `onEdit` in `#formatPending`, so
   * while that is set the editor holds an edit no build has carried, and no timer runs until more is
   * typed. The reply to the build posted BEFORE that edit, landing then, would re-seed the editor with
   * the older text; the format's answer would be refused as overtaken (`applyEdits`), and the older
   * text is what `format()` would then send as the edit it owed.
   */
  setText(text: string): void {
    if (this.#timer !== null || this.#formatPending !== null) return
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
   * **A PUSH, FROM THE LSP WORKER, FOR EVERY EDITOR ALIKE.**
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
   * **IT FLUSHES THE PENDING EDIT FIRST, AND BOTH WAYS IN — *FORMAT ON BLUR* AND THE VIEW MENU'S
   * *FORMAT* — NEED THAT.** A copy's keystrokes reach the server on a 300 ms debounce, so a format
   * asked for inside that window is answered from the text the server still holds — and
   * `textDocumentSync` is Full, so the answer replaces the whole document and those keystrokes vanish.
   *
   * **THE RECOMPILE CARRIES THE POST-FORMAT TEXT, AND THAT IS THE LOAD-BEARING PART.** `#onEdit`
   * rebuilds the buffer, the reply redraws the pane, and the pane re-seeds this editor with whatever
   * the buffer now holds. Hand it the text as typed and it overwrites the formatting a moment after
   * `applyEdits` put it there: the server's edits are applied, and `setText` undoes them.
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
    const asked = this.#view.state.doc
    const before = asked.toString()
    // **TAKEN OFF THE TIMER AND HELD HERE INSTEAD OF ONLY IN THIS CLOSURE**, so `flush()` still has
    // something to send while this waits on the server — see `#formatPending`'s own doc for why a
    // closure alone was not enough (a delete or a pause reads a copy's record before this can ever run).
    if (pending) this.#formatPending = before
    doc.client.changeDocument(doc.uri, before)
    try {
      const edits = await doc.client.format(doc.uri)
      if (!this.#destroyed) applyEdits(this.#view, edits, asked)
    } catch {
      // Reported by the client, once, for the server rather than for this gesture.
    }
    // **`destroy()` CAN DISCHARGE THIS BEFORE THE AWAIT EVER RETURNS.** `destroy()` calls `flush()`, and
    // `flush()` sends `#formatPending` the moment it is asked — synchronously, from a delete or a pause
    // that reads a copy's record before any editor comes down (`EditorCustody.flush`), and from
    // `destroy()` itself when a pick or a close is what ends the view.
    // `owed` is what is LEFT for this method to send once the server answers: `false` when `flush()`
    // already sent it, or when typing that overtook the format was sent by a LATER debounce (`#send`), or
    // when a format started before this one answered first; `true` otherwise.
    const owed = this.#formatPending !== null
    this.#formatPending = null
    if (this.#destroyed) {
      if (owed) this.#onEdit(this.#view.state.doc.toString())
      return
    }
    const after = this.#view.state.doc.toString()
    // Rebuilt when a recompile was owed, or when the text changed — by the format, or by typing that
    // overtook it. Skipped when neither holds, so formatting an untouched, already-formatted editor
    // costs nothing.
    if (owed || after !== before) this.#onEdit(after)
  }

  /**
   * Tear down the instance, **sending any pending edit first** (`flush`).
   *
   * **THE PENDING EDIT IS SENT, NOT CANCELLED.** A TM or asm view destroys the editor it leaves (spec amendment 33) —
   * a pick through its title, a close, a change to another leg — and a λ view destroys its editor when it moves to
   * the program, so cancelling would drop whatever was typed in the last `debounceMs` before the view moved,
   * silently. Sending after a retirement reaches no worker, because the sink an editor is built with is its
   * own copy's (`ScratchEditorConfig.onEdit`), and `ScratchBuffers.recompile` posts nothing for a copy that is
   * deleted or asleep — it records the text of one asleep, which is the pause keeping what was typed.
   *
   * **AND `flush()` REACHES A FORMAT IN FLIGHT'S OWN PENDING TEXT TOO** (`#formatPending`), not only `#timer`'s —
   * `#formatPending`'s own doc has the reason a closure alone was not enough.
   */
  destroy(): void {
    this.flush()
    this.#destroyed = true
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
