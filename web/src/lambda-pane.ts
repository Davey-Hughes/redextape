import type { ControlState } from './controls'
import { LambdaEditor } from './lambda-editor'
import type { LambdaWindow } from './lambda-window'
import {
  bindingSelect,
  claimEditorButton,
  collapseButton,
  controlStrip,
  detachButton,
  detachedBadge,
  layoutControls,
  type PaneEvents,
} from './pane-chrome'
import type { SessionId } from './session-client'
import type { BindingOption } from './sessions'
import { byteIndexAt, byteToIndex, decorationRanges, indexToByte } from './spans'
import type { Diagnostic, LambdaState } from './types'

export type { PaneEvents }

/**
 * `main.ts`'s own `DEBOUNCE_MS` (300), duplicated rather than imported — the same argument
 * `LambdaEditor`'s own doc records for why it takes this as a constructor argument instead of
 * importing it: `main.ts` mounts the app, and a widget module reaching back into it would make the
 * app a dependency of one of its own panes. Same gesture, same speed, second name.
 */
const EDITOR_DEBOUNCE_MS = 300

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
export class LambdaPane {
  #text: HTMLElement
  #strip: ReturnType<typeof controlStrip>
  #badge: ReturnType<typeof detachedBadge>
  #select: ReturnType<typeof bindingSelect>
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
   * The mounted `LambdaEditor`, or `null` on an attached pane. NEVER `null` merely because the editor
   * is collapsed away — `collapseButton`'s callback (constructor, below) toggles `.is-collapsed` on
   * `#editorHost`, not on this field, so a collapsed editor is a live CodeMirror instance sitting
   * behind a `display: none` parent, with its debounce still running exactly as it was before the
   * click. `setDetached` is what makes "attached" and "`#editor === null`" the same fact — see its own
   * doc for the review finding that made that true rather than merely intended.
   */
  #editor: LambdaEditor | null = null
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

  constructor(host: HTMLElement, on: PaneEvents) {
    const title = document.createElement('h2')
    title.textContent = 'lambda'
    this.#badge = detachedBadge(title)
    // ANCHORED TO THE TITLE, NOT PLACED IN `replaceChildren` BELOW, because the control removes itself
    // whenever the slot has fewer than two sessions to offer (see `bindingSelect`) and has to know
    // where to go back. `title.after` is a no-op until the title has a parent, which it gets on the
    // `host.replaceChildren` line below — and nothing calls `setBindings` before then.
    this.#select = bindingSelect(title, on.rebind)
    this.#text = document.createElement('pre')
    this.#text.className = 'term'
    this.#strip = controlStrip(on)
    this.#layout = layoutControls(this.#strip.el, on)
    // IN THE CONTROL STRIP, NOT ON THE `<h2>`'s ROW BESIDE THE SELECTOR. The heading already carries
    // two things — the pane's name and §4.5's `[detached]` badge — and both are STATEMENTS about the
    // pane; the strip is where its verbs live. It is also why no stylesheet rule was needed: the
    // button is a `.controls button` like the four beside it. `detachedBadge` and `bindingSelect` take
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
   * A RE-SEED WITH THE SAME TEXT IS A NO-OP INSIDE `LambdaEditor.setText`, so this is safe on the
   * per-frame path — which, since the whole-branch review before merge, it genuinely sits on:
   * `setDetached` below now calls `setEditor(null)` itself whenever the pane it reports for stops
   * being detached, and `setDetached` is driven every frame by `PaneSlot.render`. `main.ts` still
   * calls this method directly for the two things only a caller outside this class can know — the
   * text a freshly-built scratch replied with (`scratch-compiled`) and a scratch whose worker just
   * died with nothing left to recompile against (`worker-error`) — and still explicitly at retire,
   * ahead of the draw that would reach the same answer one tick later anyway. What `main.ts` no
   * longer has to remember is every OTHER way a pane can stop being detached: that used to require a
   * matching `setEditor(null)` at each one, and was found missing at a third exit with no click
   * handler of its own to add one to (the binding selector) and briefly at a fourth that has one but
   * had not called it (`worker-error`, fixed alongside this) — see `setDetached`'s own doc.
   */
  setEditor(text: string | null): void {
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
      this.#editorHost.className = 'term-editor'
      this.#editor = new LambdaEditor({
        host: this.#editorHost,
        initial: text,
        debounceMs: EDITOR_DEBOUNCE_MS,
        onEdit: (src) => onEdit?.(src),
      })
      this.#collapse.update(true)
      this.#refreshClaim()
      return
    }
    this.#editor.setText(text)
  }

  /**
   * Detach this pane's mounted editor WITHOUT DESTROYING IT, for a caller about to remount it on a
   * different pane — the editor-moves rule's other half of `receiveEditor`, and together the two are
   * what `main.ts`'s `reconcileEditors` uses to answer the "bring the term editor to this pane" control. `null` if
   * this pane holds none, so a caller can call this on every lambda pane and only act on the one that
   * says yes.
   *
   * LEAVES `#detached` UNTOUCHED. This pane may still be bound to the scratch session that just lost
   * its editor — the binding did not change, only which pane renders the editor for it — so the fork
   * control's own refusal (`#refreshDetach`'s `!this.#detached`) must not flip, and `#refreshClaim`
   * below is what re-offers "bring the term editor to this pane" here the instant this method makes `#editor === null`
   * true while `#detached` is still true.
   */
  takeEditor(): LambdaEditor | null {
    const editor = this.#editor
    if (editor === null) return null
    this.#editor = null
    this.#editorHost.className = ''
    this.#collapse.update(false)
    this.#refreshClaim()
    return editor
  }

  /**
   * Mount an editor this pane did not build — `takeEditor`'s other half, and what makes "the editor
   * moves" true rather than "a new one seeded with the same text appears here". `editor.dom` is
   * CodeMirror's own node (`LambdaEditor.dom`'s doc); appending an already-mounted node relocates it
   * rather than duplicating it, so the SAME `EditorView` — cursor, selection and undo history included —
   * is what ends up inside this pane's host.
   *
   * **IT THROWS ON A PANE THAT ALREADY HOLDS ONE, AND THE UNCONDITIONAL OVERWRITE IT REPLACES IS HALF
   * OF AN IMPORTANT FINDING (re-review of the whole-branch review's own custody fix).** Assigning
   * `#editor` over a live value dropped the only reference to the previous view WITHOUT removing its
   * node: the pane went on rendering two `.cm-editor`s stacked in one host, `#editor` named whichever
   * arrived last, and the other was unreachable for `setEditor`, `takeEditor` and `destroy` alike —
   * design §4.3's "two uncoordinated CodeMirror instances over one buffer", reached by the very
   * mechanism §4.3 introduces to make it impossible. `main.ts`'s `reconcileEditors` is what must never
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
   */
  receiveEditor(editor: LambdaEditor): void {
    if (this.#editor !== null) throw new Error('a λ pane was handed a second editor while still holding one')
    this.#editorHost.className = 'term-editor'
    this.#editorHost.append(editor.dom)
    this.#editor = editor
    this.#collapse.update(true)
    this.#refreshClaim()
  }

  /** Diagnostics for the editor's own buffer — design §4.4. A no-op with no editor mounted. */
  setDiagnostics(ds: Diagnostic[]): void {
    this.#editor?.setDiagnostics(ds)
  }

  /**
   * Offer `options` in the binding selector and show `current` as the one in force.
   *
   * A PUSH FROM THE SLOT RATHER THAN A PULL FROM A REGISTRY, which is what keeps design §3.2b's
   * "neither pane knows what it is bound to" true of the pane's TYPE while making it false of its
   * chrome. This pane still renders `(frame, controls) -> DOM`; what it gained is a control it reports
   * a click from (`PaneEvents.rebind`) and a list it displays. It does not resolve a binding, hold a
   * `SessionId` of its own, or know that a registry exists — `PaneSlot.render` in `sessions.ts` is the
   * one place those live.
   *
   * A PURE SETTER, LIKE `setDetached` BELOW: the selector is chrome on the `<h2>`'s row and is
   * unaffected by which text the body is showing.
   */
  setBindings(options: BindingOption[], current: SessionId): void {
    this.#select.update(options, current)
  }

  /**
   * Which layout gestures this pane currently offers.
   *
   * DRIVEN FROM `main.ts`'s DRAW PASS, not from the pane, because both answers are facts about the
   * TREE — whether this is the last leaf, and whether this pane's kind may be duplicated — and the
   * pane holds neither. Same division as `setBindings`, which takes the options rather than computing
   * them.
   */
  setLayoutControls(canClose: boolean, canSplit: boolean): void {
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
   * registry entry keeps `detached: true` (nothing here retires it — only `LambdaScratchpad.retire`
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
   */
  #refreshClaim(): void {
    this.#claim?.update(this.#detached && this.#editor === null)
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
   * silently hit. `onScratchReply`'s `no-session` arm instead asks `LambdaScratchpad.noSessionReply`
   * (`scratch.ts`) to retire the failed attempt — which is what actually keeps this control offered,
   * by putting `#detached` back to `false` rather than by anything in this method — and `main.ts` puts
   * the diagnostic on `#link-status` (`link-status.ts`'s `forkFailed`), the surface built to survive
   * exactly this rebind.
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
