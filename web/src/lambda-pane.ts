import type { ControlState } from './controls'
import type { EditablePane } from './editor-custody'
import { EDITOR_DEBOUNCE_MS } from './editor-debounce'
import type { LambdaWindow } from './lambda-window'
import {
  claimEditorButton,
  collapseButton,
  controlStrip,
  detachButton,
  detachedBadge,
  layoutControls,
  type PaneEvents,
  paneSelect,
  type SplitChoices,
} from './pane-chrome'
import type { Leg } from './protocol'
import { ScratchEditor } from './scratch-editor'
import type { Binding, PaneOption } from './sessions'
import { byteIndexAt, byteToIndex, decorationRanges, indexToByte } from './spans'
import type { Diagnostic, LambdaState } from './types'

export type { PaneEvents }

function ellipsis(): HTMLElement {
  const el = document.createElement('span')
  el.className = 'truncated'
  el.textContent = ' … '
  return el
}

/**
 * The λ pane: the term as text, syntax-coloured by the same token classes the source pane uses.
 *
 * TRUNCATION IS SHOWN, NOT HIDDEN. `frame_cost_probe` measured a history frame's budget at 512
 * bytes, two orders below the readout's, so most non-trivial terms WILL truncate here. A BYTE cut's
 * text is a prefix of the real term; a DEPTH cut's is not — see `results.ts`'s note on `Cut` for why —
 * but showing either beats hiding it, which is why both are marked the same way here (`… truncated` /
 * `… too deep`) rather than one being suppressed. `results.ts` still prints the full normal form at
 * 64 KiB.
 */
export class LambdaPane implements EditablePane {
  #text: HTMLElement
  #strip: ReturnType<typeof controlStrip>
  #badge: ReturnType<typeof detachedBadge>
  #select: ReturnType<typeof paneSelect>
  /**
   * The fork control, or `null` on a pane whose events carry no `detach` handler — design §4.3's
   * trigger; see `detachButton` for why it is a button at all.
   *
   * BUILT ONLY WHEN THE HANDLER EXISTS, rather than built always and calling `on.detach?.()`. That is
   * the same standard §4.5 states and the `linkLambda` handler below does NOT need: a click that goes
   * nowhere is invisible, but a control that cannot work is on screen. A caller with no `detach` — a
   * test fixture, or any future pane that renders λ frames it does not own — gets a pane with no fork
   * offered rather than one that offers a fork and swallows it.
   */
  #detach: ReturnType<typeof detachButton> | null = null
  #frame: LambdaState | null = null
  #link: LambdaWindow | null = null
  /**
   * The upper half of design §4.2's split body — a stable parent that outlives any editor mounted or
   * unmounted inside it, so `setEditor` can do both without touching the pane's own child order.
   *
   * CARRIES NO CLASS UNTIL `setEditor` GIVES IT ONE. An empty class means `.term-editor` selects
   * nothing on a pane that has never had an editor, which is what `lambda-pane-editor.test.ts`'s
   * "no editor region until one is set" pins — the class, not the element's mere presence, is what
   * "is there an editor" answers.
   */
  #editorHost: HTMLElement
  /**
   * The mounted `ScratchEditor`, or `null` on an attached pane. NEVER `null` merely because the editor
   * is collapsed away — `collapseButton`'s callback (constructor, below) toggles `.is-collapsed` on
   * `#editorHost`, not on this field, so a collapsed editor is a live CodeMirror instance sitting
   * behind a `display: none` parent, with its debounce still running exactly as it was before the
   * click. `setDetached` is what makes "attached" and "`#editor === null`" the same fact — see its own
   * doc for the review finding that made that true rather than merely intended.
   */
  #editor: ScratchEditor | null = null
  #collapse: ReturnType<typeof collapseButton>
  /**
   * The "bring the term editor to this pane" control, or `null` on a pane whose events carry no `showEditor` handler
   * — the same "built only when the handler exists" idiom `#detach` states above, and for the same
   * reason: a caller with no `showEditor` gets a pane that never offers to claim an editor rather than
   * one that offers to and swallows the click.
   */
  #claim: ReturnType<typeof claimEditorButton> | null = null
  #layout: ReturnType<typeof layoutControls>
  /**
   * What this pane's split menus offer, last pushed by `setLayoutControls` — see `SplitChoices` for why
   * the starting value is "nothing on offer, and no pair in force" rather than an invented binding, and
   * `PaneView.setLayoutControls` for why the whole list arrives on the call that mounts the control.
   *
   * A FIELD READ THROUGH A THUNK RATHER THAN A LIST HANDED TO `layoutControls` ONCE. The menu is built
   * when it opens (`splitControl`'s doc), so what it needs is the CURRENT value at that moment; a list
   * passed at construction would be the one thing a build-on-open cannot fix.
   */
  #choices: SplitChoices = { options: [], sourceAvailable: false, current: null }
  /**
   * `on.editScratch`, captured once at construction — `setEditor` reads it per mount rather than
   * closing over `on` directly, so a pane built with no handler mounts an editor that simply drops
   * its edits, the same "control that cannot work is still absent, an edit that goes nowhere is
   * invisible" split `PaneEvents.detach`'s doc draws for the fork button.
   */
  #onEdit: ((src: string) => void) | undefined
  /**
   * Whether the session this pane is bound to is outside the source correspondence — §4.5's fact,
   * kept because the fork control needs it and `setDetached` is not the only thing that moves it.
   *
   * A FIELD RATHER THAN A READ OF THE BADGE'S OWN STATE. The fork control's availability is a
   * function of TWO inputs that arrive through two different calls — the binding (`setDetached`) and
   * the frame (`render`) — so whichever arrives second has to see the first. `detachedBadge` holds an
   * equivalent boolean privately for its own no-op guard; asking it would make one widget's internal
   * state another's input.
   */
  #detached = false
  /**
   * Whether this pane's session has an editor to bring here at all — `#refreshClaim`'s THIRD input, and
   * the one whose absence made "bring the term editor to this pane" a control that provably could not
   * work (deferred-a11y item 11, fixed here).
   *
   * **THE TWO INPUTS IT JOINS ONLY APPROXIMATED THIS, AND 5d-ii-c's DECISION 2 IS WHAT SEPARATED THEM.**
   * `#detached && #editor === null` was read as "this session has an editor, mounted elsewhere" — true
   * while a detached pane with no editor anywhere was a state the app cleaned up rather than one it
   * left. A fork whose build failed used to END the buffer, putting `#detached` back to `false` within
   * the same reply. Nothing ends a buffer implicitly now, so a pane stranded on a phantom fork sits with
   * both conjuncts permanently true and no editor in existence: the control was offered forever and the
   * click recorded a claim `reconcileEditors` could find nothing for.
   *
   * **TWO ROUTES REACH THAT STATE, NOT ONE — this paragraph said "the one path" and the paragraph's own
   * last sentence contradicted it (Minor finding, review of this fix).** `replies.ts`'s `worker-error`
   * arm calls `editorHome(session)?.setEditor(null)`, which DESTROYS the editor and retires nothing, so
   * a pane whose worker died is left in exactly the same shape as one whose fork never built. That route
   * has existed since 5d-ii-a and was never covered by the retire the sentence above rests on, so the
   * approximation was already imperfect before decision 2 widened the gap.
   *
   * PUSHED PER FRAME BY `draw()`, NOT ASKED FOR ON THE FOUR TRANSITIONS `#refreshClaim` ALREADY RUNS ON.
   * The other two inputs are facts about THIS pane and change only when this pane is called; this one is
   * a fact about a session that other panes and the reply switch move — `scratch-compiled` on a buffer
   * that finally built mounts an editor through `editorHome`, and a close hands one to custody — so a
   * value read at those four moments would be stale in exactly the cases the field exists for.
   * `setDetached` is driven the same way and for the same reason (`PaneSlot.render`).
   *
   * FALSE UNTIL TOLD OTHERWISE, which is what makes a pane built outside `main.ts` — every direct-layer
   * test in `tests/browser/` — withhold the control rather than offer one nothing behind it can answer.
   */
  #editorAvailable = false

  constructor(host: HTMLElement, on: PaneEvents) {
    const title = document.createElement('h2')
    title.textContent = 'lambda'
    this.#badge = detachedBadge(title)
    // ANCHORED TO THE TITLE, NOT PLACED IN `replaceChildren` BELOW, because the control removes itself
    // whenever the slot has fewer than two PAIRS to offer (see `paneSelect`) and has to know
    // where to go back. `title.after` is a no-op until the title has a parent, which it gets on the
    // `host.replaceChildren` line below — and nothing calls `setBindings` before then.
    this.#select = paneSelect(title, on.rebind)
    this.#text = document.createElement('pre')
    this.#text.className = 'term'
    this.#strip = controlStrip(on)
    this.#layout = layoutControls(this.#strip.el, on, () => this.#choices)
    // IN THE CONTROL STRIP, NOT ON THE `<h2>`'s ROW BESIDE THE SELECTOR. The heading already carries
    // two things — the pane's name and §4.5's `[detached]` badge — and both are STATEMENTS about the
    // pane; the strip is where its verbs live. It is also why no stylesheet rule was needed: the
    // button is a `.controls button` like the four beside it. `detachedBadge` and `paneSelect` take
    // the title for the same kind of reason in the other direction.
    const detach = on.detach
    if (detach !== undefined) {
      // THE FRAME'S STEP, NOT THE WINDOW'S. This line supplies the step of the frame this leg is
      // actually at, which is what design §4.1's replay reduces to.
      //
      // **A PANE SHOWING A LINK WINDOW MUST NOT FORK, AND `#refreshDetach` NOW ENFORCES IT.** This
      // used to hold for free: the handler passed the pane's own body text, and the frame's text was
      // chosen over the window's for the reason recorded above. A step carries no such distinction —
      // it says nothing about which of the two bodies is on screen — so the guard is an explicit
      // condition in `#refreshDetach`, which checks `#link` alongside `#detached` and the presence of
      // a frame. It does NOT check the frame's cut: §4.1a moved that refusal to the worker, which
      // answers a diagnostic while this control stays offered. `pane-chrome.ts`'s `detach` doc and
      // `#refreshDetach`'s own doc both carry the full argument.
      this.#detach = detachButton(this.#strip.el, () => detach(this.#frame?.step ?? 0))
    }
    // THE HOST IS IN THE DOM FROM CONSTRUCTION AND CARRIES NO CLASS UNTIL AN EDITOR IS MOUNTED.
    // A stable parent is what lets `setEditor` mount and unmount without touching the pane's child
    // order; the class is what `.term-editor` selects, so an empty host matches nothing and "is there
    // an editor" has one answer in the DOM as well as in the field.
    this.#editorHost = document.createElement('div')
    this.#onEdit = on.editScratch
    this.#collapse = collapseButton(this.#strip.el, (collapsed) => {
      this.#editorHost.classList.toggle('is-collapsed', collapsed)
      // REPORTS THE GESTURE ONLY — the class toggle above is the whole of what this control performs;
      // see `PaneEvents.collapse`'s own doc for why the app needs telling on top of that (5d-ii-d §4.7:
      // the state is recorded against the buffer, not the pane).
      on.collapse?.(collapsed)
    })
    const showEditor = on.showEditor
    if (showEditor !== undefined) {
      this.#claim = claimEditorButton(this.#strip.el, showEditor)
    }
    host.replaceChildren(title, this.#editorHost, this.#text, this.#strip.el)

    // λ TEXT -> SOURCE, the third direction. Delegated from the `<pre>` rather than bound per token,
    // because tokens are recreated on every draw. `data-at` carries the token's byte offset in the
    // FULL `lambdaText` (see `#redraw`), so the handler needs no knowledge of the window's slice.
    //
    // ONLY THE WINDOW IS CLICKABLE. A frame view has no `data-at` on anything — its text is printed at
    // `FRAME_BYTES` from a term the index's coordinates do not describe — so a click there finds no
    // attribute and does nothing, which is the correct answer rather than a guard.
    this.#text.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const at = target.dataset.at
      if (at === undefined) return
      const byteOffset = Number.parseInt(at, 10)
      if (Number.isNaN(byteOffset)) return
      on.linkLambda?.(byteOffset)
    })
  }

  render(frame: LambdaState | null, controls: ControlState): void {
    this.#strip.update(controls)
    this.#frame = frame
    this.#redraw()
    // THE FRAME IS HALF OF WHETHER A FORK IS POSSIBLE — see `#refreshDetach`. Driven from here and
    // from `setDetached`, which are the two calls that move either half, rather than from a third
    // setter the slot would have to remember to call.
    this.#refreshDetach()
  }

  /**
   * Mount an editor over this pane's term seeded with `text`, or unmount it with `null` — design
   * §4.2's upper region.
   *
   * MOUNTED AND UNMOUNTED, NEVER HIDDEN, for `detachedBadge`'s reason taken one step further: a hidden
   * CodeMirror instance is a live instance with a live debounce, and §5 asks for a test that
   * reattaching a pane REMOVES the editor. Removal is what makes that question have one answer.
   *
   * A RE-SEED WITH THE SAME TEXT IS A NO-OP INSIDE `ScratchEditor.setText`, so this is safe on the
   * per-frame path — which, since the whole-branch review before merge, it genuinely sits on:
   * `setDetached` below now calls `setEditor(null)` itself whenever the pane it reports for stops
   * being detached, and `setDetached` is driven every frame by `PaneSlot.render`. `replies.ts` still
   * calls this method directly for the two things only a caller outside this class can know — the
   * text a freshly-built scratch replied with (`scratch-compiled`) and a scratch whose worker just
   * died with nothing left to recompile against (`worker-error`). **IT ALSO SAID "and still explicitly
   * at retire, ahead of the draw", AND THAT CALL SITE IS GONE**: it was `compile.ts`'s
   * `editorHome()?.setEditor(null)`, already a no-op on every path that reached it (a retire rebinds
   * its panes first, so nothing resolves), and 5d-ii-c decision 2 deleted the branch around it. A
   * retire's editors come down through the sweep instead (`editor-custody.ts`'s `reconcileEditors`).
   * What no caller has to remember is every OTHER way a pane can stop being detached: that used to
   * require a matching `setEditor(null)` at each one, and was found missing at a third exit with no click
   * handler of its own to add one to (the binding selector) and briefly at a fourth that has one but
   * had not called it (`worker-error`, fixed alongside this) — see `setDetached`'s own doc.
   *
   * **`collapsed` SEEDS THE MOUNT, AND ONLY THE MOUNT — 5d-ii-d T9, design §4.7.** Defaults to `false`
   * for every caller but one: `replies.ts`'s `scratch-compiled` arm passes `scratchpad.collapsedOf(session)`,
   * which is `false` for a fresh fork (nobody has collapsed a buffer that has never had an editor) and
   * whatever a restored buffer's own record says otherwise. The RE-SEED branch below
   * (`this.#editor.setText(text)`) ignores it, because a live editor's collapse state is the user's own
   * click, not something a later reply gets to overwrite.
   *
   * **`#editorHost.className` HAS FOUR WRITERS IN THIS FILE, NOT ONE — a claim this paragraph used to
   * make and which was false the day it was written (Important finding, 5d-ii-d T9 fix round 1).** It
   * read "the class assignment stays in ONE place — this is the only line that ever writes
   * `#editorHost.className`". Two of the four CLEAR it (this method's own `text === null` branch, and
   * `takeEditor`), because an unmounted host carries no class at all. The other two are MOUNT sites, and
   * both need the same seed: this line, and `receiveEditor`'s — the one custody's sweep and custody
   * passes use to remount an editor on a different pane, which a reader trusting the old sentence would
   * have concluded needed no seeding of its own. It did, and did not have one; see `receiveEditor`'s own
   * doc for the finding and the fix.
   */
  setEditor(text: string | null, collapsed = false): void {
    if (text === null) {
      this.#editor?.destroy()
      this.#editor = null
      this.#editorHost.className = ''
      this.#collapse.update(false)
      this.#refreshClaim()
      return
    }
    const onEdit = this.#onEdit
    if (this.#editor === null) {
      this.#editorHost.className = collapsed ? 'term-editor is-collapsed' : 'term-editor'
      this.#editor = new ScratchEditor({
        host: this.#editorHost,
        initial: text,
        debounceMs: EDITOR_DEBOUNCE_MS,
        onEdit: (src) => onEdit?.(src),
      })
      this.#collapse.update(true, collapsed)
      this.#refreshClaim()
      return
    }
    this.#editor.setText(text)
  }

  /**
   * Detach this pane's mounted editor WITHOUT DESTROYING IT, for a caller about to remount it on a
   * different pane — the editor-moves rule's other half of `receiveEditor`, and together the two are
   * what `editor-custody.ts`'s `reconcileEditors` uses to answer the "bring the term editor to this pane" control. `null` if
   * this pane holds none, so a caller can call this on every lambda pane and only act on the one that
   * says yes.
   *
   * LEAVES `#detached` UNTOUCHED. This pane may still be bound to the scratch session that just lost
   * its editor — the binding did not change, only which pane renders the editor for it — so the fork
   * control's own refusal (`#refreshDetach`'s `!this.#detached`) must not flip, and `#refreshClaim`
   * below is what re-offers "bring the term editor to this pane" here the instant this method makes `#editor === null`
   * true while `#detached` is still true.
   */
  takeEditor(): ScratchEditor | null {
    const editor = this.#editor
    if (editor === null) return null
    this.#editor = null
    // **THE NODE LEAVES TOO, AND FOR TWO CALLERS IT NEVER USED TO HAVE TO — found by driving the app in
    // a browser, which is the only thing that could have found it.** This method dropped the reference
    // and stripped the host's class and left `editor.dom` parented where it was, because both original
    // callers made that invisible: `applyLayout`'s drop loop takes the whole host out of the document
    // with the pane, and `reconcileEditors`' sweep hands the view straight to `receiveEditor`, whose
    // `append` RELOCATES the node. The `rebind` handover in `pane-host.ts` is the first caller where the
    // pane SURVIVES and nothing re-parents — and without this line the view stayed mounted, visible and
    // `contenteditable`, in a pane now bound to a different buffer, with only the `.term-editor` class
    // gone. Measured in Chromium: 458x44 px, showing the OLD buffer's term, accepting keystrokes.
    //
    // WORSE THAN COSMETIC, WHICH IS WHY IT IS A `remove()` AND NOT A `display: none`. The view keeps the
    // `onEdit` it was constructed with, so a keystroke in that stray editor still reached
    // `ScratchBuffers.recompile` — the parse error from a half-edited term was painted as a diagnostic
    // on a DIFFERENT pane's editor, one buffer over. That is the same class of defect the handover
    // exists to prevent, reintroduced by the handover itself.
    //
    // SAFE FOR THE OTHER TWO CALLERS AND FOR CODEMIRROR. Removing a node then appending it elsewhere is
    // what `receiveEditor` already does in one step (its doc: "appending an already-mounted node
    // relocates it"), and a view whose `dom` is out of the document is the state custody already puts
    // every closed pane's editor in. `destroy()` is the only thing that ends a view, and this is not it.
    editor.dom.remove()
    this.#editorHost.className = ''
    this.#collapse.update(false)
    this.#refreshClaim()
    return editor
  }

  /**
   * Mount an editor this pane did not build — `takeEditor`'s other half, and what makes "the editor
   * moves" true rather than "a new one seeded with the same text appears here". `editor.dom` is
   * CodeMirror's own node (`ScratchEditor.dom`'s doc); appending an already-mounted node relocates it
   * rather than duplicating it, so the SAME `EditorView` — cursor, selection and undo history included —
   * is what ends up inside this pane's host.
   *
   * **IT THROWS ON A PANE THAT ALREADY HOLDS ONE, AND THE UNCONDITIONAL OVERWRITE IT REPLACES IS HALF
   * OF AN IMPORTANT FINDING (re-review of the whole-branch review's own custody fix).** Assigning
   * `#editor` over a live value dropped the only reference to the previous view WITHOUT removing its
   * node: the pane went on rendering two `.cm-editor`s stacked in one host, `#editor` named whichever
   * arrived last, and the other was unreachable for `setEditor`, `takeEditor` and `destroy` alike —
   * design §4.3's "two uncoordinated CodeMirror instances over one buffer", reached by the very
   * mechanism §4.3 introduces to make it impossible. `editor-custody.ts`'s `reconcileEditors` is what must never
   * ask for that; this is the check that the invariant is a fact rather than an argument.
   *
   * **AND IT ASKED FOR IT AGAIN, ONE ROUND LATER — WHICH IS WHY THIS PARAGRAPH NO LONGER CLAIMS IT
   * "CANNOT".** That sentence read "and it no longer can (see its doc for the root fix)". A third review
   * round then reached this throw in six clicks (`fork`, `close`, `reset layout`, type in the source,
   * fork again, split), because the root fix's sweep ran over the CLAIM map while the entry that
   * outlived its session sat in the CUSTODY map with no claim naming it — see `reconcileEditors`' own
   * doc for the interaction. The fix is there, in the caller's domains, and it is a better fix than a
   * promise here would have been: **this throw is not a backstop for an argument, it is the only reason
   * either round's defect announced itself at all.** A method that cannot state an invariant about its
   * callers should not try to; it should refuse, loudly, and let the caller be the thing that is
   * corrected. THROWING RATHER THAN QUIETLY DESTROYING THE INCUMBENT:
   * a silent repair would have absorbed the finding as normal operation, and the choice between the two
   * editors — which text, whose cursor, whose undo — is not one this class has any basis to make.
   * `PaneCollection.add` and `SessionRegistry.add` refuse a duplicate id in exactly the same words for
   * exactly the same reason.
   *
   * **`collapsed` SEEDS THIS MOUNT TOO, AND UNTIL THIS FIX IT DID NOT — Important finding, review of
   * 5d-ii-d T9.** `setEditor`'s doc states the design in full: the flag "rides with the buffer and
   * follows it as custody moves the editor between panes". This is the OTHER mount — the one custody's
   * own sweep and custody passes use (`editor-custody.ts`'s `reconcileEditors`), not the one a fresh
   * build takes — and it was seeded nowhere: the host's class was written unconditionally and
   * `#collapse.update(true)` ran with `initial` defaulting to `false`, so a collapsed buffer claimed
   * onto another pane, or re-claimed out of custody after its holder closed, remounted EXPANDED. Nothing
   * in either sweep pass calls `on.collapse`, so `redextape.buffers` went on reading the buffer as
   * collapsed while the screen showed otherwise, and the next reload silently collapsed what the user had
   * just expanded by moving it. `editor-custody.ts`'s two `receiveEditor` call sites now read the
   * buffer's own flag through the `collapsedOf` reader threaded into `createEditorCustody` for exactly
   * this call, the same way `replies.ts`'s `scratch-compiled` arm already does for `setEditor`.
   */
  receiveEditor(editor: ScratchEditor, collapsed = false): void {
    if (this.#editor !== null) throw new Error('a λ pane was handed a second editor while still holding one')
    this.#editorHost.className = collapsed ? 'term-editor is-collapsed' : 'term-editor'
    this.#editorHost.append(editor.dom)
    // **THE EDITS FOLLOW THE VIEW, AND THIS LINE IS WHY — found by driving the app, not by the suite.**
    // A `ScratchEditor` is built by the pane that FORKS (`setEditor`'s mount branch), closing over THAT
    // pane's `editScratch`; moving `editor.dom` here does not move the callback. So a claimed editor
    // went on reporting through the pane that made it, and `transport.ts` resolves
    // `slot.binding.session` at edit time — meaning the instant that pane was rebound elsewhere,
    // keystrokes in the moved editor recompiled whatever IT was showing. `ScratchEditor.onEdit`'s own doc
    // carries the measurement. `this.#onEdit` may be `undefined` on a pane built without the handler,
    // which is the same "an edit that goes nowhere is invisible" split `#onEdit` already documents — and
    // is why this assigns the same wrapper `setEditor` does rather than the field itself.
    const onEdit = this.#onEdit
    editor.onEdit = (src) => onEdit?.(src)
    this.#editor = editor
    this.#collapse.update(true, collapsed)
    this.#refreshClaim()
  }

  /**
   * Whether this pane is currently showing an editor.
   *
   * `takeEditor`'s QUESTION WITHOUT `takeEditor`'s ANSWER — that method reports the same fact by handing
   * the editor over, which is exactly what a caller only asking cannot afford. `editor-custody.ts`'s
   * `hasEditor` is the caller: it resolves a session's home pane and needs to know whether that pane is
   * holding anything, and a `takeEditor()` there would unmount the editor to find out.
   */
  holdsEditor(): boolean {
    return this.#editor !== null
  }

  /**
   * Report whether this pane's session has an editor anywhere — see `#editorAvailable` for why this is a
   * third input rather than something this class could work out for itself.
   *
   * THE NO-OP GUARD IS THE SAME ONE EVERY PER-FRAME SETTER IN THIS FILE STATES, and here it also keeps
   * `#refreshClaim` — and so `claimEditorButton.update`'s DOM write — off the hot path on the frames
   * where nothing moved, which is most of them during playback.
   */
  setEditorAvailable(available: boolean): void {
    if (available === this.#editorAvailable) return
    this.#editorAvailable = available
    this.#refreshClaim()
  }

  /** Diagnostics for the editor's own buffer — design §4.4. A no-op with no editor mounted. */
  setDiagnostics(ds: Diagnostic[]): void {
    this.#editor?.setDiagnostics(ds)
  }

  /**
   * Offer `options` in the pane selector and show `current` as the pair in force.
   *
   * A PUSH FROM THE SLOT RATHER THAN A PULL FROM A REGISTRY, which is what keeps design §3.2b's
   * "neither pane knows what it is bound to" true of the pane's TYPE while making it false of its
   * chrome. This pane still renders `(frame, controls) -> DOM`; what it gained is a control it reports
   * a click from (`PaneEvents.rebind`) and a list it displays. It does not resolve a binding, hold a
   * `Binding` of its own, or know that a registry exists — `PaneSlot.render` in `sessions.ts` is the
   * one place those live.
   *
   * `Binding<Leg>` RATHER THAN `Binding<'lambda'>`, THOUGH THIS IS THE λ PANE. The list is pairs for
   * BOTH legs now (`SessionRegistry.pairs()`), so the pair in force has to be spelled in the same
   * vocabulary the list is — a `Binding<'lambda'>` here would say the current pair can only ever name
   * this pane's own leg, which is the claim the widened control exists to stop making. The pane's
   * frame type is what pins its renderer; this parameter pins nothing.
   *
   * A PURE SETTER, LIKE `setDetached` BELOW: the selector is chrome on the `<h2>`'s row and is
   * unaffected by which text the body is showing.
   */
  setBindings(options: PaneOption[], current: Binding<Leg>): void {
    this.#select.update(options, current)
  }

  /**
   * Which layout gestures this pane currently offers, and what a split may create.
   *
   * DRIVEN FROM `main.ts`'s DRAW PASS, not from the pane, because every answer is a fact about
   * something the pane does not hold — whether this is the last leaf, whether this pane's kind may be
   * duplicated, and which `(leg, session)` pairs exist to create. Same division as `setBindings`, which
   * takes the options rather than computing them.
   *
   * `choices` IS STORED AND NOT PASSED ON, because `layoutControls` reads it through the thunk this
   * pane gave it at construction — see `#choices`, and `PaneView.setLayoutControls` for why the list
   * arrives here rather than through a setter of its own.
   */
  setLayoutControls(canClose: boolean, canSplit: boolean, choices: SplitChoices): void {
    this.#choices = choices
    this.#layout.update(canClose, canSplit)
  }

  /**
   * Show or hide the `[detached]` badge — design §4.5's second surface, paired with the sentence
   * `link-status.ts` puts in `#link-status`.
   *
   * `setDetached`, NOT `renderDetached`, THOUGH §4.5 CALLS IT "analogous to `renderLink`". The
   * analogy is about the shape of the call, not about what it does: `renderLink` swaps the pane's
   * BODY between two texts in two different coordinate systems, and a `render*` name here would
   * suggest this participates in that redraw. It does not touch `#redraw` at all — the badge is
   * chrome, it lives on the `<h2>`, and it is unaffected by which text the body is showing. `TmPane`
   * spells its chrome-and-highlight setters `setLink`/`setFocus`/`setProgram` for the same reason,
   * and this pane's counterpart is named to match across the two.
   *
   * A PURE SETTER, LIKE `TmPane.setFocus` AND UNLIKE `renderLink`: nothing here needs a redraw,
   * because `detachedBadge` mutates the title directly and the body is the caller's separate
   * decision — a detached λ pane shows its scratch's own term, which arrives through `render` like
   * any other frame.
   *
   * DEFAULTS TO ATTACHED AND IS NOW DRIVEN EVERY FRAME. It was "never called today" when the badge
   * landed, because no pane had a binding to report (§3.2b); `PaneSlot.render` calls it with
   * `SessionEntry.detached` for whichever session the slot is bound to, so the badge follows a rebind
   * without a second fact to keep in step. The default still matters: a pane that has never been
   * rendered shows no badge.
   *
   * **AN EDITOR CANNOT OUTLIVE `#detached`, AND THIS IS WHERE THAT IS ENFORCED — IMPORTANT finding,
   * whole-branch review before merge.** `setEditor` used to be reachable from exactly two places in
   * `main.ts` (the scratch's first build, and recompile-from-source's retire), and this method — the
   * one `PaneSlot.render` actually calls every frame — was not one of them. So the THIRD way a pane
   * stops being detached, the binding selector, unmounted nothing: picking `source` in a forked λ
   * pane's selector dropped the `[detached]` badge and repainted `#text` from the newly-bound leg, but
   * left `#editor` mounted on the scratch it had just left — a text input whose keystrokes reached a
   * session no longer on screen, which is exactly `pane-chrome.ts`'s "a control that provably cannot
   * work should not be presented as though it might" turned inside out (the control LOOKED live and
   * quietly wasn't). Rather than add a third external call site `main.ts` would have to remember at
   * every future exit — the fix the review rejected — the invariant lives here instead: an editor can
   * only be showing while its pane is detached, so the one setter that reports `#detached` is the one
   * place that tears it down, and no future way of leaving `#detached` needs its own reminder.
   *
   * GUARDED ON `#editor !== null` RATHER THAN CALLING `setEditor(null)` UNCONDITIONALLY, for the
   * no-op-cost reason every control in this file and `pane-chrome.ts` states: an ATTACHED pane is the
   * common case and is repainted every recorded frame during playback, so an unguarded call would pay
   * `setEditor`'s own work — a destroy check, a class assignment, a collapse-button update — sixty
   * times a second for a pane that has never been forked at all.
   *
   * WHAT THIS DOES NOT COVER: a scratch whose WORKER DIES without the pane ever leaving it. Its
   * registry entry keeps `detached: true` (nothing here retires it — only `ScratchBuffers.retire`
   * does, and a dead worker is not that), so this method's own input never changes and this branch
   * never fires. `main.ts`'s `worker-error` arm for a scratch calls `setEditor(null)` directly for
   * exactly that reason — see its own comment there.
   */
  setDetached(detached: boolean): void {
    this.#detached = detached
    this.#badge.update(detached)
    if (!detached && this.#editor !== null) this.setEditor(null)
    this.#refreshDetach()
    // `setEditor(null)` ABOVE ALREADY CALLS `#refreshClaim` WHEN IT FIRES, but that branch is
    // conditional on `#editor !== null` and this call is not: a pane freshly bound to a scratch (still
    // `#editor === null`, never having held one) needs "bring the term editor to this pane" offered the first time
    // `#detached` turns true, which is a transition `setEditor(null)` never sees because there was
    // never an editor here to unmount.
    this.#refreshClaim()
  }

  /**
   * Offer "bring the term editor to this pane" exactly when this pane's session has one to show and this pane is not
   * already showing it — wave 3 (5d-ii-a)'s editor-moves rule.
   *
   * THE SAME "PAIR OF INPUTS ARRIVE THROUGH TWO DIFFERENT CALLS" SHAPE AS `#refreshDetach`: `#detached`
   * moves through `setDetached`, `#editor` through `setEditor`/`takeEditor`/`receiveEditor`, and
   * whichever arrives second has to see the first — so this is called from all four.
   *
   * **THERE ARE THREE INPUTS NOW, AND THE THIRD IS THE ONLY ONE THAT IS NOT ABOUT THIS PANE** —
   * `#editorAvailable`, arriving through `setEditorAvailable` on the per-frame path, with the whole
   * argument for its existence on the field's own doc. The first two say "I am on a scratch and I am not
   * the one showing its editor"; without the third that sentence quietly assumes the editor exists.
   */
  #refreshClaim(): void {
    this.#claim?.update(this.#detached && this.#editor === null && this.#editorAvailable)
  }

  /**
   * Offer the fork control exactly when a fork would work.
   *
   * `frame.cut` NO LONGER GATES THIS, AND THAT REVERSES WHAT THIS METHOD USED TO CHECK — found and
   * fixed in T8 (plan 5d-iii), because the check it replaces silently disabled this whole slice's
   * headline capability. `detachButton`'s doc used to say a TRUNCATED frame "cannot be forked at
   * all" — true while the seed WAS the frame's own 512-byte print (`FRAME_BYTES`, "most non-trivial
   * terms WILL truncate here", this file's own module doc), so a `Bytes` cut was a prefix that would
   * not parse and a `Depth` cut was not even that. Design §4.1 replaced that seed: `detach` now sends
   * a STEP, and `main.ts` re-derives the term from the SOURCE compile's step-0 print at
   * `LAMBDA_BYTE_BUDGET` (65,536 — 128× `FRAME_BYTES`), which this frame's own 512-byte truncation
   * says nothing about. §4.1a states the consequence outright: "a term can still be too large to
   * fork, and the refusal moved rather than vanished... the worker answers `scratch: null` with a
   * diagnostic saying so, and **the pane keeps offering ✎**" — checking `frame.cut` here was
   * therefore refusing a control that provably CAN work, which is the opposite of what §4.5's own
   * standard asks for. The one refusal that survives is a source step-0 term that is ITSELF cut at
   * `LAMBDA_BYTE_BUDGET`; that cannot be seen from a `LambdaState` frame at all (a different budget,
   * a different print), so it is reported after the click — **not by routing a diagnostic into this
   * pane's own editor, which this paragraph used to claim and which was found wrong in code review
   * against a real worker.** The refusal this method exists to keep offering a fork for is exactly the
   * refusal that never mounts an editor at all: a failed build never reaches `scratch-compiled`, so
   * `setEditor` is never called and `#editor` stays `null` — `setDiagnostics`'s own doc already says
   * that call is a no-op with no editor mounted, which is what a diagnostic routed there would have
   * silently hit. `onScratchReply`'s `no-session` arm puts the diagnostic on `#link-status`
   * (`link-status.ts`'s `forkFailed`) instead, which is a surface this pane does not have to be able to
   * show anything for.
   *
   * **AND THE CONTROL DOES NOT COME BACK AFTERWARDS, WHICH THIS PARAGRAPH USED TO PROMISE.** It said
   * the arm "asks `ScratchBuffers.noSessionReply` (`scratch.ts`) to retire the failed attempt — which is
   * what actually keeps this control offered, by putting `#detached` back to `false` rather than by
   * anything in this method". 5d-ii-c decision 2 deleted that retire: nothing ends a buffer implicitly,
   * so a pane whose fork failed stays bound to the buffer that failed, `#detached` stays `true`, and the
   * gate below withholds ✎ — correctly, since that buffer has no term to fork. §4.1a's "the pane keeps
   * offering ✎" is therefore unmet at this pane, and design §4.4 relocates the way out to the header
   * list, which can reach a buffer no pane is showing and is wired in `main.ts`. Retiring that buffer
   * rebinds this pane to source, which is what makes `#detached` false again and this control offered
   * again — through the binding, exactly as the deleted retire did, and never through this method.
   * Nothing in this method changes either way.
   *
   * WHAT STILL GATES IT: a detached pane is already on the scratchpad and has nothing to fork, and an
   * absent frame — `render(null, …)`, what a declined or not-yet-compiled leg produces — has no term
   * at all to report a step against. Reading `ControlState` for the second of those would be a second
   * source for the same fact.
   *
   * **AND IT STILL REFUSES WHILE A LINK WINDOW IS SHOWING, WHICH IS A RULE RATHER THAN A
   * CONSEQUENCE.** The window's body is a slice of the SOURCE COMPILE's step-0 term in a different
   * coordinate system; forking used to be safe here because the handler passed `#frame`'s text rather
   * than the window's, and design §4.1 replaced that text with a step. A step says nothing about
   * which of the pane's two bodies is on screen, so the refusal is stated explicitly below rather
   * than inherited for free — this one `frame.cut` never covered and does not touch.
   */
  #refreshDetach(): void {
    const frame = this.#frame
    this.#detach?.update(!this.#detached && this.#link === null && frame !== null)
  }

  /**
   * Show a window onto the step-0 term around a linked construct, or `null` to go back to the frame.
   *
   * THE LINK VIEW REPLACES THE FRAME VIEW RATHER THAN OVERLAYING IT, because they are two different
   * texts: a frame is printed at `FRAME_BYTES` (512) and this at `LAMBDA_BYTE_BUDGET` (65,536). A
   * highlight computed against one and drawn on the other would land on arbitrary characters.
   */
  renderLink(win: LambdaWindow | null): void {
    /**
     * GUARDS THE NO-OP CASE: when no link was active and none becomes active, both the state
     * assignment and the redraw are unnecessary. This skips the redundant per-frame rebuild that
     * occurs on every playback tick (because `draw()` calls both `render()` and `renderLink()`,
     * each of which rebuilds the DOM). The remaining duplicate rebuild happens once per click,
     * when a link IS set and then cleared, and is left for a future API revision that merges the
     * two methods.
     */
    if (win === null && this.#link === null) return
    this.#link = win
    this.#redraw()
    // THE FORK CONTROL IS THE OTHER THING THAT MOVES WHEN `#link` DOES — see `#refreshDetach`'s "AND
    // IT REFUSES WHILE A LINK WINDOW IS SHOWING" arm. Skipped on the no-op path above along with the
    // redraw, since neither `#link` nor the fork control's answer changed there.
    this.#refreshDetach()
  }

  #redraw(): void {
    if (this.#link !== null) {
      const w = this.#link
      const ranges = decorationRanges(w.spans, w.text)
      const map = byteToIndex(w.text)
      // The INVERSE map, built once per render rather than per token. Encoding `text.slice(0, i)` per
      // token would be O(n^2) over a window that can be tens of kilobytes.
      const back = indexToByte(w.text)
      const targetFrom = byteIndexAt(map, w.target.start)
      const targetTo = byteIndexAt(map, w.target.end)
      const out: Node[] = []
      if (w.clippedHead) out.push(ellipsis())
      let at = 0
      for (const r of ranges) {
        if (r.from < at) continue
        if (r.from > at) out.push(document.createTextNode(w.text.slice(at, r.from)))
        const el = document.createElement('span')
        // FLAT, NOT NESTED. Every token inside the target range also carries `is-linked`; a wrapper
        // element would have to handle spans straddling the target's edges, and there is no need —
        // the edges are token boundaries by construction (see `lambdaWindow`).
        el.className = r.from >= targetFrom && r.to <= targetTo ? `${r.className} is-linked` : r.className
        // THE THIRD DIRECTION'S ONLY REQUIREMENT. `nodeAtLambda` speaks BYTE offsets into the full
        // `lambdaText`, and a click gives a DOM element — so each token carries the byte offset it
        // began at, in whole-text coordinates. Computed here rather than derived from the DOM at click
        // time, because the window is a slice and the offsets are not the ones on screen.
        el.dataset.at = String(w.origin + (back[r.from] ?? 0))
        el.textContent = w.text.slice(r.from, r.to)
        out.push(el)
        at = r.to
      }
      if (at < w.text.length) out.push(document.createTextNode(w.text.slice(at)))
      if (w.clippedTail) out.push(ellipsis())
      this.#text.replaceChildren(...out)
      return
    }

    const frame = this.#frame
    if (frame === null) {
      this.#text.replaceChildren()
      return
    }
    // Spans arrive as byte offsets into THIS frame's own text, so nothing here can be a keystroke
    // behind the way the source pane's can be — but `decorationRanges` sorts, clamps, and converts
    // byte offsets to UTF-16 indices anyway, and reusing it means one implementation of those rules
    // rather than two. `λ` is 2 bytes and 1 UTF-16 code unit, so the conversion is not optional here:
    // it fires on every term with a binder, not only on non-ASCII source.
    const ranges = decorationRanges(frame.spans, frame.text)
    // THE REDEX THIS FRAME'S OWN STEP CONTRACTED, resolved through the SAME byte-to-UTF-16 map as
    // `ranges` above — and the range it produces stands on the CONTRACTUM, not on the redex: the path
    // behind `redex_span` named the redex `App` in the PRE-step term, β consumed it, and what occupies
    // that path in the term this frame prints is the subterm the step produced (see `types.ts`'s
    // `redex_span` doc). So `.is-redex` marks up "what just changed", which is what the pane wants.
    // `frame.redex_span` is bytes, exactly like `frame.spans`, so converting it any other way (or not
    // at all) is the identical mistake `decorationRanges` exists to rule out here.
    // Built only when there is a span to convert: most frames at step 0 or past the truncation cut
    // carry `null`, and `byteToIndex` walking the text for nothing would be wasted on every one of them.
    let redexFrom = -1
    let redexTo = -1
    if (frame.redex_span !== null) {
      const map = byteToIndex(frame.text)
      redexFrom = byteIndexAt(map, frame.redex_span.start)
      redexTo = byteIndexAt(map, frame.redex_span.end)
    }
    const out: Node[] = []
    let at = 0
    for (const r of ranges) {
      if (r.from < at) continue
      if (r.from > at) out.push(document.createTextNode(frame.text.slice(at, r.from)))
      const el = document.createElement('span')
      // FLAT, NOT NESTED — the same reason `renderLink`'s `is-linked` is flat: every token inside the
      // redex also carries `is-redex`, rather than a wrapper element that would have to handle a token
      // straddling the redex's edges. `redexTo > redexFrom` guards the degenerate `redexFrom === redexTo`
      // case the same way `decorationRanges` itself does for a zero-width span.
      el.className =
        redexTo > redexFrom && r.from >= redexFrom && r.to <= redexTo ? `${r.className} is-redex` : r.className
      el.textContent = frame.text.slice(r.from, r.to)
      out.push(el)
      at = r.to
    }
    if (at < frame.text.length) out.push(document.createTextNode(frame.text.slice(at)))
    if (frame.cut !== null) {
      const more = document.createElement('span')
      more.className = 'truncated'
      more.textContent = frame.cut === 'Depth' ? ' … too deep' : ' … truncated'
      out.push(more)
    }
    this.#text.replaceChildren(...out)
  }
}
