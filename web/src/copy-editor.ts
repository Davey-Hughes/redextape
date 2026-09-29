import type { EditablePane } from './editor-custody'
import { EDITOR_DEBOUNCE_MS } from './editor-debounce'
import { n } from './format'
import { createOutlinePanel } from './outline'
import { type PaneEvents, textPanel } from './pane-chrome'
import type { ScratchEditorConfig } from './scratch-editor'
import { ScratchEditor } from './scratch-editor'
import type { ViewMenu } from './view-header'

/** What a view builds its `CopyEditor` with, beside the events it was built with. */
export type CopyEditorOptions = {
  /** The view's `⋯` menu: this part keeps its *format*, *edit a copy* and *move the editor here* in step with it. */
  readonly menu: Pick<ViewMenu, 'setFormattable' | 'setCopy' | 'setClaim'>
  /** Whether the outline starts open — the view's stored panel state, read once. */
  readonly outlineOpen: boolean
  /** What the view's program counts, in the plural — "rules", "instructions" — for *edit a copy*'s too-large reason. */
  readonly noun: string
  /**
   * Called by `setEditor(null)`, whether or not an editor was mounted — not by a take, since a view that gives its
   * editor to another view of the copy still shows the copy (`takeEditor`'s doc). `TmPane` clears its copy's status
   * line here; the asm view has nothing to clear (`AsmPane.setDetached`'s doc).
   */
  readonly onUnmount?: () => void
}

/**
 * The part of a machine view that edits a copy — the TM view's and the asm view's, which were one design written twice
 * (spec amendment 28: the asm view holds a copy's editor as the TM view does). It owns the editor's host and the text
 * panel around it, the outline, and the facts behind the view menu's *format* and *edit a copy*; the view puts
 * `textPanel` first in its body and `outline` last, and delegates `EditablePane`'s members here.
 *
 * **ONE PART, BECAUSE THE HANDOFF IS WHERE THE REVIEWS KEPT FINDING THINGS.** The comments below record several review
 * rounds' fixes to exactly this code — a control outliving the fork it performed, an editor outliving the session it
 * edits, edits following the view that built an editor rather than the one holding it — and while the two views held a
 * copy each, every such fix had to be made twice with nothing to fail if it was not. What differs between the views is
 * a parameter: the noun a too-large program is counted in, and the TM view's status clear on unmount.
 *
 * **`implements EditablePane`**, as each view does, though custody never casts to this class — it casts to the views,
 * which hand their `EditablePane` members through to this one. The clause keeps this class's members in step with
 * what the views pass through: a member renamed or retyped here fails to compile at this class rather than at a
 * view's one-line delegate. The members are ported from `LambdaPane`'s own, leg-agnostic apart from the wording
 * custody's caller never sees.
 */
export class CopyEditor implements EditablePane {
  /** The text panel around the editor's host — first in the view's body. */
  readonly textPanel: HTMLElement
  /** The outline panel — last in the view's body, and shown only while an editor is mounted. */
  readonly outline: HTMLElement
  /**
   * The upper half of design §4.2's split body, ported to the machine views — a stable parent that outlives any
   * editor mounted or unmounted inside it, so `setEditor` can do both without touching the view's own child order.
   * Same contract as `LambdaPane`'s own `#editorHost`; that field's doc carries the argument for why it carries no
   * class until `setEditor` gives it one, and is not repeated here.
   */
  #editorHost: HTMLElement
  /**
   * The mounted `ScratchEditor`, or `null` on a view of the program. Same contract as `LambdaPane`'s own `#editor` —
   * never `null` merely because the editor is collapsed away, since collapsing sets `hidden` on `#editorHost` through
   * the text panel (below), not on this field.
   */
  #editor: ScratchEditor | null = null
  #collapse: ReturnType<typeof textPanel>
  #outline: ReturnType<typeof createOutlinePanel>
  /**
   * `on.editSink`, captured once at construction — `setEditor` calls it per mount, so each editor it builds sends its
   * edits to the copy the view showed when it was built. Same idiom as `LambdaPane.#editSink`; that field's doc
   * carries the argument.
   */
  #editSink: (() => (src: string) => void) | undefined
  /** Resolves the view's current binding to an LSP document — see `PaneEvents.lspDocument`. */
  #lspDocument: (() => ScratchEditorConfig['document']) | undefined
  /** Resolves the view's language to its colourer — see `PaneEvents.colour`. */
  #colour: (() => ScratchEditorConfig['colour']) | undefined
  /** The page's keymap setting, which the view's editor joins — see `PaneEvents.keymap`. */
  #keymap: ScratchEditorConfig['keymap']
  #menu: CopyEditorOptions['menu']
  #noun: string
  #onUnmount: (() => void) | undefined
  /**
   * The last `setForkAvailable` call's facts, kept so `#refreshDetach` can re-evaluate them on every frame rather
   * than only at the moment they arrived — a Critical fix, in a review round of the TM view's fork.
   *
   * **WITHOUT THIS SET, THE CONTROL COULD OUTLIVE THE FORK IT JUST PERFORMED.** `replies.ts`'s `setTmProgram` calls
   * `setForkAvailable` over `panes.ofSession('tm', session)` for the SOURCE session, and `pane-host.ts`'s `seedTmPane`
   * calls it when a view is created or moved by a pick, a cool or a retire, which a fork is not. `scratchpad.fork`
   * rebinds the view's slot to the new copy SYNCHRONOUSLY, so the view leaves that set on the very click that forked
   * it — nothing calls `setForkAvailable` again to say the new session has nothing to fork. Storing the facts here
   * is what lets a LATER call that has nothing to do with forking — `setDetached`, driven every frame by
   * `PaneSlot.render` regardless of which session the view is bound to — still re-derive the right answer. Same idiom
   * `LambdaPane.#menu`'s own doc states for `#detached` itself: a fact two different calls both need has to be
   * readable by whichever one runs second. The asm view's facts arrive the same ways (`asm-seed.ts`'s `seedAsm`).
   */
  #forkText: string | null = null
  #count = 0
  /**
   * Whether `#forkText === null`'s reason is NOT the result type — the TM view's third `setForkAvailable` argument,
   * `true` by default for the asm view's own two-argument calls (`AsmPane.setForkAvailable`), which never have a
   * second reason to distinguish (the asm leg's header is optional, so a function-valued program still gets text —
   * `AsmHeader::for_type`'s doc). `#refreshDetach` reads it only when `#forkText` is `null`, and before it looks at
   * `#count` at all: `false` here means the control is disabled with the function-valued reason regardless of
   * `#count`, since a function-valued program's own machine can have as few rules as a declined leg has (zero) —
   * `#refreshDetach`'s own doc carries the argument for why `#count` cannot be asked first.
   */
  #resultDecodable = true
  /**
   * Whether the view's own session is outside the source correspondence — `LambdaPane`'s field of the same name,
   * ported for the identical reason: `#refreshDetach` needs it alongside `#forkText`/`#count`, and it arrives through a
   * different call (`setDetached`) than either of those two do.
   */
  #detached = false
  /**
   * Whether another view holds this copy's editor — *move the editor here*'s third input, pushed every frame by
   * `draw.ts` from custody, as `LambdaPane.#editorAvailable` is; that field's doc has why it is pushed rather than
   * asked. `false` until told otherwise, so a view built outside the app offers nothing it cannot answer.
   */
  #editorAvailable = false

  constructor(on: PaneEvents, opts: CopyEditorOptions) {
    this.#menu = opts.menu
    this.#noun = opts.noun
    this.#onUnmount = opts.onUnmount
    // THE HOST IS IN THE DOM FROM CONSTRUCTION AND CARRIES NO CLASS UNTIL AN EDITOR IS MOUNTED — same rule as
    // `LambdaPane`'s own `#editorHost`, and that field's doc carries the argument.
    this.#editorHost = document.createElement('div')
    this.#editorHost.className = ''
    this.#editSink = on.editSink
    this.#lspDocument = on.lspDocument
    this.#colour = on.colour
    this.#keymap = on.keymap
    // THE TEXT PANEL — the same control `LambdaPane` builds, with the same name ("text") where the views used to say
    // "term editor" and "machine source". It wraps `#editorHost` and hides it itself; this callback only reports the
    // gesture, for the copy's record.
    this.#collapse = textPanel(this.#editorHost, (collapsed) => on.collapse?.(collapsed))
    this.textPanel = this.#collapse.el
    // THE OUTLINE IS WHAT THE SERVER LISTS FOR THE COPY'S DOCUMENT — a TM copy's states, an asm copy's labels; each
    // view's constructor says why its own starts closed.
    this.#outline = createOutlinePanel({
      open: opts.outlineOpen,
      onToggle: (open) => on.panel?.('outline', open),
      symbols: async () => {
        const doc = this.#lspDocument?.()
        return doc === undefined ? [] : doc.client.documentSymbols(doc.uri)
      },
      reveal: (range) => this.#editor?.reveal(range),
    })
    this.outline = this.#outline.panel.el
    // The view starts on the program, with no editor — so the controls that need one start withdrawn rather than
    // waiting for the first assignment to withdraw them.
    this.#syncEditorControls()
  }

  /** Reformat the copy's text — the view menu's *format*, which is removed while there is no editor. */
  format(): void {
    void this.#editor?.format()
  }

  /**
   * Mount an editor over the view seeded with `text`, or unmount it with `null` — design §4.2's upper region, ported
   * to the machine views. Same contract and same guards as `LambdaPane.setEditor`; that method's doc carries the full
   * argument (mounted-and-unmounted, the re-seed no-op inside `ScratchEditor.setText`, `collapsed` seeding the mount
   * and only the mount) and is not repeated here.
   *
   * **THE COLLAPSE FLAG LANDS THE SAME WAY `LambdaPane`'S DOES.** It used to be that the TM view put it on a
   * `.collapsed` class on its body where `LambdaPane` put it on `#editorHost`'s own class, while agreeing on WHETHER it
   * did. Plan 7 part 1 ended that difference: every view hands `collapsed` to the text panel (`textPanel`,
   * constructor above), which hides `#editorHost` itself with `hidden`, so `#editorHost` here only ever carries the
   * bare `'term-editor'` class or none at all.
   *
   * ***MOVE THE EDITOR HERE* FOLLOWS THE MOUNT AND THE UNMOUNT**, through `#syncEditorControls`, as
   * `LambdaPane.setEditor` refreshes its own claim control.
   *
   * **AN UNMOUNT CALLS `onUnmount`, MOUNTED OR NOT** — the TM view's status clear, which it made on every
   * `setEditor(null)` before this part existed.
   */
  setEditor(text: string | null, collapsed = false): void {
    if (text === null) {
      this.#editor?.destroy()
      this.#editor = null
      this.#syncEditorControls()
      this.#editorHost.className = ''
      this.#collapse.update(false)
      this.#onUnmount?.()
      return
    }
    if (this.#editor === null) {
      this.#editorHost.className = 'term-editor'
      // RESOLVED HERE, NOT AT CONSTRUCTION — the binding the view shows now is the copy the editor being built
      // belongs to, for its edits as for its document.
      const sink = this.#editSink?.()
      this.#editor = new ScratchEditor({
        host: this.#editorHost,
        initial: text,
        debounceMs: EDITOR_DEBOUNCE_MS,
        onEdit: (src) => sink?.(src),
        onServerUpdate: () => this.#outline.refresh(),
        document: this.#lspDocument?.(),
        colour: this.#colour?.(),
        keymap: this.#keymap,
      })
      this.#collapse.update(true, collapsed)
      this.#syncEditorControls()
      return
    }
    this.#editor.setText(text)
  }

  /**
   * Keep the controls that need an editor — or its absence, for *move the editor here* — in step with whether the view
   * has one.
   *
   * **CALLED FROM EVERY SITE THAT ASSIGNS `#editor`, WHICH IS WHY IT IS A METHOD AND NOT A BOOLEAN PASSED AROUND.**
   * Four of those: the mount, the unmount, `takeEditor` and `receiveEditor` — plus the constructor's last statement,
   * so a view starts with the controls an editorless view should have rather than waiting for the first assignment to
   * withdraw them. A control offered on a view with no editor would do nothing when clicked.
   */
  #syncEditorControls(): void {
    this.#menu.setFormattable(this.#editor !== null)
    this.#refreshClaim()
    // **THE OUTLINE GOES WITH THE EDITOR, NOT WITH THE VIEW.** A view showing the program has no document for the
    // server to outline; a list that could never fill is removed rather than shown empty, which is the umbrella's §4
    // rule 4.
    this.#outline.panel.el.hidden = this.#editor === null
    if (this.#editor !== null) this.#outline.refresh()
  }

  /**
   * Detach the mounted editor WITHOUT DESTROYING IT, for a caller about to remount it on a different view. Same
   * contract as `LambdaPane.takeEditor`; that method's doc carries the full argument for why the node itself is
   * removed rather than merely dereferenced (a `LeafId` handover that survives, where the whole host does not leave
   * with it), and is not repeated here.
   *
   * **NO `onUnmount`, WHERE A TAKE USED TO CALL IT — the TM view's status clear.** A take stood for the view leaving
   * the copy, and the view stopped describing a copy it no longer showed. It stands for nothing of the kind now: a
   * view leaving its copy destroys its editor through `pane-host.ts`, which then tells the view what the session it
   * moves onto holds, and a view that gives its editor to another view of the copy through *move the editor here*
   * (custody's `reconcileEditors`) still shows the copy — clearing its status there blanked the value line of a view
   * still showing the copy's run.
   */
  takeEditor(): ScratchEditor | null {
    const editor = this.#editor
    if (editor === null) return null
    this.#editor = null
    this.#syncEditorControls()
    editor.dom.remove()
    this.#editorHost.className = ''
    this.#collapse.update(false)
    return editor
  }

  /**
   * Mount an editor this view did not build — `takeEditor`'s other half. Same contract and same guard as
   * `LambdaPane.receiveEditor`, including the throw on a view already holding one; that method's doc carries the full
   * argument (the two review findings that made the throw and the `collapsed` seeding necessary) and is not repeated
   * here.
   *
   * **ONE GESTURE HANDS A MACHINE VIEW AN EDITOR: *move the editor here*, from another view of the same copy.** Custody
   * calls this from `reconcileEditors`' sweep, which takes the editor off the view holding it. Nothing HOLDS a machine
   * view's editor for later, as custody holds a λ view's: a TM or asm view destroys the editor it leaves (spec
   * amendment 33, `pane-host.ts`'s drop pass and its same-leg rebind arm), and a view still showing the copy mounts a
   * fresh one.
   *
   * **`onServerUpdate` IS RE-POINTED, AND THE EDITS ARE NOT.** A server update refreshes the outline, and the outline
   * that lists this document is this view's now; built for the view that built the editor, it went on refreshing an
   * outline hidden with that view's editor. The edits need nothing here: an editor's sink is its copy's, bound when it
   * is built (`PaneEvents.editSink`), and this view shows that copy.
   */
  receiveEditor(editor: ScratchEditor, collapsed = false): void {
    if (this.#editor !== null) throw new Error('a machine view was handed a second editor while still holding one')
    this.#editorHost.className = 'term-editor'
    this.#editorHost.append(editor.dom)
    editor.onServerUpdate = () => this.#outline.refresh()
    this.#editor = editor
    this.#syncEditorControls()
    this.#collapse.update(true, collapsed)
  }

  /**
   * Whether the view is currently showing an editor. `takeEditor`'s question without `takeEditor`'s answer — same
   * contract as `LambdaPane.holdsEditor`; that method's doc carries the argument.
   */
  holdsEditor(): boolean {
    return this.#editor !== null
  }

  /** Send the mounted editor's pending edit now — `EditablePane.flushEditor`, for `EditorCustody.flush`. */
  flushEditor(): void {
    this.#editor?.flush()
  }

  /**
   * Record whether the view's session is a copy, and give up its editor when it is not.
   *
   * **AN EDITOR CANNOT OUTLIVE `#detached` — Important finding, review of the TM view's editor.**
   * `LambdaPane.setDetached`'s own doc records the same line and the defect that made it necessary: driving the app in
   * a browser, picking `source` in a forked view's selector dropped the `[detached]` badge and repainted the body from
   * the newly-bound leg, but left a live `contenteditable` editor mounted on the copy the view had just left.
   * `PaneSlot.render` calls the view's `setDetached` on every frame, so the invariant lives here rather than waiting
   * for whichever route first leaves a copy.
   *
   * **THE FORK CONTROL IS THE OTHER THING THAT MOVES WHEN `#detached` DOES — a Critical fix, in a review round of
   * the TM view's fork.** `LambdaPane.setDetached`'s own call to `#refreshDetach` is the model: this is what makes the
   * control withdraw the instant this method's own input changes, on the very frame the view's session becomes the
   * copy a fork just made, rather than waiting for a `setForkAvailable` call that a rebound view will never receive
   * again.
   */
  setDetached(detached: boolean): void {
    this.#detached = detached
    if (!detached && this.#editor !== null) this.setEditor(null)
    this.#refreshDetach()
    this.#refreshClaim()
  }

  /**
   * Report whether another view holds this copy's editor — see `#editorAvailable`. A no-op when unchanged, since
   * `draw.ts` calls it every frame.
   */
  setEditorAvailable(available: boolean): void {
    if (available === this.#editorAvailable) return
    this.#editorAvailable = available
    this.#refreshClaim()
  }

  /**
   * *Move the editor here* — offered on a view showing a copy, holding no editor, while another view holds one, and
   * removed everywhere else (the umbrella's §4 rule for a control that cannot apply): a view of the program has no
   * copy's editor to hold, a view holding it has nothing to move, and with no editor anywhere there is nothing to
   * bring. `LambdaPane.#refreshClaim`'s three inputs, for the machine views.
   *
   * **WITH NO EDITOR ANYWHERE, A VIEW OF A COPY MOUNTS ONE RATHER THAN OFFERING THIS** (`pane-host.ts`'s
   * `mountScratchEditor`), so the state is brief — a fork's view until its build lands — or deliberate: a copy whose
   * worker threw loses its editor (`replies.ts`'s `worker-error` arm), as a λ copy's does, and the way out is the
   * copies menu.
   */
  #refreshClaim(): void {
    this.#menu.setClaim(this.#detached && this.#editor === null && this.#editorAvailable)
  }

  /**
   * Record the program a fork would carry, the count a refusal would name, and — for the TM view only —
   * whether the result type is the reason `text` is withheld — `viewMenu`'s `CopyState` rule, as a data
   * dependency rather than a convention — design §4.3. `text` is the program's text, or `null` when there
   * is none to copy; `count` is how many rules or instructions it has; `resultDecodable` defaults to
   * `true`, which is every asm call's own answer (`#resultDecodable`'s own doc — the asm leg's header is
   * optional, so it has no second reason to distinguish). Stores the facts and defers to `#refreshDetach`,
   * the same split `setDetached` above and `LambdaPane.setEditor`/`setDetached` already use: a setter that only ever
   * WROTE the control from here would go stale the moment the view stopped being one `replies.ts`'s fan-out still
   * calls it on — see `#forkText`'s own doc.
   */
  setForkAvailable(text: string | null, count: number, resultDecodable = true): void {
    this.#forkText = text
    this.#count = count
    this.#resultDecodable = resultDecodable
    this.#refreshDetach()
  }

  /**
   * The one writer of the fork control's state — a Critical fix, in a review round of the TM view's fork. Composes
   * three independent facts that arrive through two different calls (`setForkAvailable` and `setDetached`), the same
   * shape `LambdaPane.#refreshDetach` already uses and for the identical reason: whichever call runs second has to see
   * what the other one left.
   *
   * **`!this.#detached` GATES PRESENCE, AND ITS ABSENCE WAS THE WHOLE BUG.** `setForkAvailable` alone cannot express
   * "this view's OWN session just became the thing it would fork" — that fact arrives through `setDetached`, driven
   * every frame by `PaneSlot.render` regardless of which session the view is bound to, which is exactly why it is the
   * one call `LambdaPane`'s own `#refreshDetach` checks first. Left out (as it shipped), the TM view's control kept
   * whatever rules and text the SOURCE session last reported, forever, on a view that had since rebound onto its own
   * new copy — the button stayed present and enabled, and a second click reached `transport.ts`'s fork handler with
   * no text (a copy's own `tmProgram.tmText` is always `null`, `replies.ts`'s `tm-scratch-compiled` arm builds it that
   * way) and threw. The rule this enforces: A VIEW ALREADY SHOWING A COPY HAS NOTHING LEFT TO COPY.
   *
   * **`this.#forkText !== null || !this.#resultDecodable || this.#count > 0` IS WHETHER THE CONTROL SHOWS AT ALL —
   * widened from a bare `count > 0`, Minor fix in the same round; widened again this round to add
   * `!this.#resultDecodable` (below).** A `TmCompiled` whose program parsed to zero δ rules (`ruleCount(program) === 0`)
   * still has non-`null` `tmText` and is genuinely forkable — `tests/node/sessions.test.ts`'s own fixture for the
   * machine-fork handler constructs exactly that shape (one accept state, no rules). `count > 0` alone withdrew the
   * control for it though nothing about the machine made it unforkable; `text !== null` is the worker's own decision
   * (`forkable` for a machine, the byte ceiling for asm text) — a count disagrees with it only in the direction
   * count-but-no-text, which `text === null` below still catches — and is the fact that actually decides presence.
   *
   * `text === null` IS STILL WHETHER IT IS DISABLED, ONCE `#resultDecodable` HAS BEEN CHECKED. A session WITH a
   * program whose text was withheld (`text === null`) for a reason that is not "there is no program at all" — a
   * machine over `MAX_FORK_RULES`, a function-valued program's TM text, or asm text over `MAX_SCRATCH_ASM_BYTES` —
   * is the one case the view presents disabled rather than absent: the program exists, the refusal is not an
   * absence, and `CopyState`'s own doc has the argument for why that distinction is worth a visible control.
   * Guarded by `!this.#detached` too, for the same reason presence is: a view that has just withdrawn the control
   * entirely has nothing left to disable.
   *
   * **`#resultDecodable` IS CHECKED BEFORE `#count` CAN MAKE THE CONTROL ABSENT — fixed this round; it used to be
   * the other way around, and that was the bug.** The absence check used to be `#forkText === null && #count === 0`
   * on its own, on the assumption that a `null` text with a zero count could only be a declined leg (no `TmProgram`
   * at all, where `#count` defaults to `0` — `replies.ts`'s `storeAndSetProgram`). It cannot be assumed: `#count` is
   * `ruleCount(program)` (`protocol.ts`), a real machine's own rule count, and this file's `#resultDecodable` doc
   * already said a function-valued program sits well within `MAX_FORK_RULES` — nothing about being function-valued
   * keeps ITS machine's rule count from being zero too. Measured against every small function-valued program tried
   * (`|x| x`, `|x| x + 1`, a let-bound function, a two-argument curry): each compiles to a real, non-zero machine
   * today (135 or 204 δ rules) — but that is this compiler's current lowering, not a guarantee `#refreshDetach` may
   * lean on, and the umbrella's §4 rule does not have an exception for "not reachable yet". A zero-rule
   * function-valued program hit the identical `null`/`0` shape a declined leg does and the control vanished instead
   * of disabling with its reason — the wrong one of the umbrella's two outcomes for a control that could apply but
   * cannot right now. Checking `!#resultDecodable` first decides the function-valued case by the fact that actually
   * distinguishes it (the result type), before the absence check — which knows nothing about result types — ever
   * runs.
   *
   * **BY THE TIME `#count === 0` IS CHECKED, `#resultDecodable` IS ALREADY KNOWN `true`,** so `#count === 0` here
   * really does mean "no program at all": the only other cause of `text === null` left is a machine over
   * `MAX_FORK_RULES`, and `#count` cannot be `0` there (a rule count over a five-figure ceiling does not round down
   * to nothing). `#count` still picks only the WORDING of the size refusal below, never the decision to disable —
   * the worker already made that decision, encoded in whether `text` is `null`.
   */
  #refreshDetach(): void {
    if (this.#detached) {
      this.#menu.setCopy(null)
      return
    }
    if (this.#forkText !== null) {
      this.#menu.setCopy('ready')
      return
    }
    if (!this.#resultDecodable) {
      this.#menu.setCopy({ reason: 'a function-valued program has no TM file a copy can run' })
      return
    }
    if (this.#count === 0) {
      this.#menu.setCopy(null)
      return
    }
    this.#menu.setCopy({ reason: `${n(this.#count)} ${this.#noun} — too large to open in an editor` })
  }
}
