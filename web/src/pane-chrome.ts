import { createPanel } from './panel'
import type { Leg } from './protocol'
import type { ScratchEditorConfig } from './scratch-editor'
import type { SessionId } from './session-client'
import type { Binding, PaneOption } from './sessions'
import type { LambdaDisplay, Speed } from './workspace'

export type PaneEvents = {
  /**
   * The LSP document this pane's editor is, resolved when the editor is built.
   *
   * **A THUNK, BECAUSE A SLOT'S BINDING MOVES AND THE DOCUMENT FOLLOWS THE SESSION.** A pane is
   * constructed once and rebound many times; resolving the URI at construction would pin an
   * editor built later to whichever buffer the pane happened to show first. `transport.ts` reads
   * `slot.binding` inside this, the same way `editScratch` does.
   *
   * Optional for the same reason the two members below it are: a test builds a pane with only the
   * handlers it drives, and an editor with no document simply has no language features.
   */
  lspDocument?(): ScratchEditorConfig['document']

  /**
   * The colourer this pane's editor takes — `colour.ts`'s `treeSitterColour`, for this pane's language.
   *
   * A THUNK FOR `lspDocument`'s REASON, ONE STEP WEAKER. A pane's LEG is fixed by its renderer type, so
   * the language could in principle be resolved at construction; the thunk is here so both editor
   * facts are resolved at the same moment, by the same file (`transport.ts` reads `slot.binding.leg`
   * for each), rather than one of them being pinned a rebind earlier than the other.
   *
   * Optional for `lspDocument`'s reason too: a test builds a pane with only the handlers it drives, and
   * an editor with no colourer is simply uncoloured.
   */
  colour?(): ScratchEditorConfig['colour']

  /**
   * The page's keymap setting, which this pane's editor joins when it is built.
   *
   * **A VALUE RATHER THAN A THUNK, WHICH THE TWO ABOVE ARE.** Those resolve facts about a BINDING, and
   * a slot's binding moves under a pane that was constructed once. There is one keymap for the whole
   * page: it does not depend on which buffer this pane is showing, and `main.ts` builds it before it
   * builds the transport, so there is no ordering to defer either.
   *
   * Optional for `lspDocument`'s reason: a test builds a pane with only what it drives, and an editor
   * with no setting keeps CodeMirror's own bindings.
   */
  keymap?: ScratchEditorConfig['keymap']

  back(): void
  forward(): void
  play(): void
  restart(): void
  extend(): void
  /**
   * The workspace's one playback speed, in steps a second — Plan 7 part 2 spec §8. REQUIRED, like `rebind`:
   * every view that steps shows it, and one global setting has no view that could lack it.
   */
  speed(): Speed
  /** Set the one speed; every step control on the page shows the change on the next draw. */
  setSpeed(s: Speed): void
  /**
   * The pane selector picked a `(leg, session)` pair for this pane's slot.
   *
   * REQUIRED, UNLIKE THE TWO OPTIONAL MEMBERS BELOW, and the difference is not stylistic. Those two
   * are absent on a pane that genuinely lacks the affordance — the λ pane has no δ-table to click, the
   * TM pane has no λ term — whereas every pane occupies a slot and every slot has a binding
   * (design §3.2b, decision 1). A pane whose rebind did nothing would be a pane whose selector lies.
   *
   * **IT TAKES THE WHOLE `(leg, session)` PAIR, AND THAT REVERSES WHAT THIS COMMENT USED TO SAY.** It
   * read "IT TAKES A `SessionId` AND NOT A `(session, leg)` PAIR. The leg is fixed by the slot's
   * renderer type", which was true while a slot's leg was the only leg its selector could offer. It is
   * not true of a control that offers pairs, and the pair is what a pick MEANS: a `<select>` listing
   * both legs reports which option was chosen, not the session half of it.
   *
   * **ONE CONTROL FOR BOTH AXES BECAUSE THE AXES ARE NOT INDEPENDENT (design §3.2).** A session holds
   * at most one leg per `Leg` — the source session has both, a λ scratch has only λ — and
   * `SessionRegistry.legOf` THROWS on a binding naming a leg its session lacks. Two independent
   * controls (a kind picker beside a session picker) would therefore have to answer "what happens when
   * you pick TM while bound to a λ-only scratch" with an invented fallback: silently rebind to some
   * other session, or make the option vanish and reappear as the other control moves. Both are rules a
   * user has to learn and a reader has to keep in step. One list of pairs — `SessionRegistry.pairs()`,
   * which enumerates exactly the pairs that provably resolve — makes the invalid combination
   * unrepresentable instead of merely handled.
   *
   * WHAT A HANDLER MAY DO WITH THE LEG IS NOT THIS TYPE'S BUSINESS, AND THE TWO HANDLERS IN THE APP DO
   * DIFFERENT THINGS WITH IT. `transport.ts`'s takes the session on a same-leg pick and THROWS on any
   * other, which is all a handler with no layout tree can do — it cannot answer the question, so it
   * refuses to pretend; `pane-host.ts`'s wraps it, delegates a same-leg pick there and
   * answers a cross-leg one by changing the LEAF's kind and rebuilding the pane in place — `PaneSlot<K>`'s
   * leg still has no writer anywhere in the app, so following a pick across legs is the replacement of a
   * whole `PaneEntry` rather than a field write. **The paragraph this replaces said a cross-leg pick was
   * "currently a no-op that the next paint snaps back" and that acting on one was a later slice.** That
   * slice landed, and it was the change to ONE handler this signature was widened to make possible —
   * the control, the two panes and the two types under it are untouched by it, which is the claim this
   * paragraph was making in advance.
   */
  rebind(binding: Binding<Leg>): void
  /**
   * Fork this pane's term into the λ scratchpad — design §4.3, at the step the pane is showing.
   *
   * OPTIONAL, LIKE THE TWO BELOW AND UNLIKE `rebind`, and the test is the one those two already
   * apply: a pane has this handler when it has the affordance the handler reports. The TM pane has no
   * term to fork; see §6.1 of 5d-iii's design for the slice that changes that.
   *
   * **IT CARRIES A STEP, NOT TEXT, AND THAT REVERSES WHAT THIS COMMENT USED TO SAY.** The rule was
   * "THE TEXT IS THE PANE'S, NOT A LOOKUP", and it was right for a seed that WAS the rendered frame.
   * Design §4.1 replaced that seed: the inputs are now the SOURCE session's step-0 term — which lives
   * in the `compiled` reply that `main.ts` holds, not in any pane — and the step, which `History`
   * owns. So the pane reports the one fact it owns and `main.ts` resolves the rest.
   *
   * **THE HALF OF THE OLD RULE THAT SURVIVES IS THE IMPORTANT HALF:** the pane does not go looking for
   * a term. What changed is which fact is the small one.
   *
   * **THE LINK WINDOW'S REFUSAL WENT WITH THE WINDOW (Plan 7 part 4a).** A pane showing the step-0
   * link window used to decline to fork, since its body was not the step's term. The view now shows only
   * its own step, as a tree or as text, so there is no second body a fork could be taken from.
   */
  detach?: (step: number) => void
  /**
   * A genuine edit landed in a detached pane's own scratch buffer — design §4.3's second edit
   * gesture, and `detach`'s counterpart: that one forks a new scratch from a source-derived view,
   * this one recompiles the scratch that already exists. `ScratchEditor`'s debounced `onEdit` is the
   * only caller, so it fires on a keystroke that survived the debounce — never on the seed that
   * mounted the editor (`ScratchEditor#setText`'s `#seeding` guard is what keeps a seed from reaching
   * here at all).
   *
   * OPTIONAL, FOR THE SAME REASON `detach` IS: an editor exists only on a pane whose slot owns a
   * scratch (§4.2), and this file declares the shape without deciding when a pane gets it — that is
   * `main.ts`'s wiring, same as `detach` above.
   */
  editScratch?: (src: string) => void
  /**
   * This pane asks to hold its scratch session's editor — wave 3 (5d-ii-a)'s editor-moves rule.
   *
   * OPTIONAL, FOR `detach`'s REASON: it exists only on a pane whose slot may be bound to a scratch,
   * which today means the λ leg. IT CARRIES NOTHING, same as `close` below — the pane knows it was
   * asked; it does not know its own `LeafId` or which session it is bound to.
   * `pane-host.ts`'s `paneEvents` holds both and is what makes the request into
   * `custody.claim(session, id)` followed by `applyLayout()`, which is where the actual DOM move happens
   * (`editor-custody.ts`'s `reconcileEditors`) — this handler only reports the click.
   *
   * (`splitRow`/`splitColumn` were in that "carries nothing" list until they gained a `PaneChoice`, and
   * the distinction is the one their own doc draws: what a picker produced is a fact about the PICK,
   * not about the tree — which the pane still knows nothing of.)
   */
  showEditor?: () => void
  /**
   * This pane's editor was collapsed or expanded.
   *
   * OPTIONAL, BUT NOT THE WAY `detach` AND `showEditor` ARE: `textPanel` is the editor host's own
   * container and both constructors build it unconditionally, so a pane built with no `collapse`
   * handler still shows the panel and toggles it — only the report of the gesture goes missing, an
   * `on.collapse?.(collapsed)` call with nothing on the other end.
   *
   * **NOT WITHHELD ON A TM PANE, WHICH REVERSES WHAT THIS PARAGRAPH USED TO SAY.** It read "because a
   * TM pane has no editor to collapse and a handler it can never fire is a parameter pretending to be a
   * capability" — true before Task 8 (5d-iv), false after: `TmPane` also `implements EditablePane` and
   * its constructor builds a `textPanel` that wraps `#editorHost` in the pane body exactly like
   * `LambdaPane`'s, and calls `on.collapse?.(collapsed)` from it. `transport.ts`'s `events` provides
   * this handler on both legs now — see its own doc for the review finding that caught the gap: left
   * λ-only, every `TmPane` was built with `on.collapse === undefined`, so a TM collapse hid the host but
   * never reached `scratchpad.setCollapsed`, and the buffer came back expanded on reload.
   *
   * IT REPORTS THE GESTURE AND DOES NOT PERFORM IT. The host is already hidden or shown by the time this
   * runs — `createPanel`'s own click handler (`panel.ts`) applies the new `hidden`/`aria-expanded` state
   * before calling `onToggle`. This is the app being told, so it can record the state against the
   * BUFFER (5d-ii-d §4.7) rather than against the pane the editor happens to be mounted in today.
   */
  collapse?: (collapsed: boolean) => void
  /**
   * One of this view's own panels was opened or closed — Plan 7 part 2 spec §3. `pane-host.ts` records it
   * per view in the workspace. OPTIONAL, BY `collapse`'s TEST: a pane has it when it has a panel to report,
   * and the text panel reports through `collapse` instead, because its state belongs to the copy.
   */
  panel?: (name: string, open: boolean) => void
  /** A λ view's display settings changed — recorded per view, as `panel` is (Plan 7 part 4a). */
  display?: (d: LambdaDisplay) => void
  /**
   * Fork this pane's MACHINE into a TM scratch buffer — 5d-iv design §4.3.
   *
   * **NO STEP, WHERE `detach` CARRIES ONE, AND THAT IS WHY IT IS A SECOND MEMBER RATHER THAN A REUSE.**
   * A λ fork replays the source term to the frame the pane was showing, so that handler reports the one
   * fact it owns. A machine has no step-k text: the seed is the whole `.tm` file, which lives in
   * `main.ts`'s and `replies.ts`'s retention of the last `compiled` reply, not in the pane. This handler
   * needs nothing from the pane, and a `step` parameter its handler ignored would be a parameter with no
   * reader — which this file already refuses by name for `close` above.
   *
   * OPTIONAL, LIKE `detach`, AND BY THE SAME TEST: a pane has this handler when it has the affordance
   * the handler reports.
   */
  detachMachine?(): void
  /** A state row was clicked. Absent on panes that have no table. */
  linkState?: (stateId: number) => void
  /** A token in the λ view was clicked; `node` is the construct its node belongs to (Plan 7 part 4a). */
  linkLambda?: (node: number) => void
  /**
   * This pane's split and close gestures — 5d-ii-a.
   *
   * OPTIONAL, LIKE `detach` AND UNLIKE `rebind`, and the same test applies: a pane has these handlers
   * when it has the affordance. A pane rendered outside a layout tree — which is every pane in
   * `view-title.test.ts` and in `tests/node/sessions.test.ts` — has no tree to split.
   *
   * `close` CARRIES NOTHING. A pane knows it was asked to close; it does not know its own `LeafId`, its
   * path in the tree, or whether it is the last leaf. `pane-host.ts` holds the tree and answers all
   * three, which keeps the pane classes free of the layout entirely.
   *
   * **THE TWO SPLITS CARRY A `PaneChoice`, AND THAT REVERSES WHAT THIS PARAGRAPH USED TO SAY ABOUT ALL
   * THREE.** It read "THEY CARRY NOTHING", which was true while a split could only ever duplicate the
   * pane it was performed on — there was one possible answer, so there was nothing to report. A split
   * now asks WHAT to create (`view-header.ts`'s `viewMenu`), and the answer is a `(leg, session)` pair or the
   * source pane, which is a fact about the pick rather than about the tree. **THE DIVISION IS
   * UNCHANGED, ONLY THE SIDE THIS FALLS ON**: a handler still learns nothing here about where in the
   * tree it is, because the pane still does not know — what crosses is exactly what the pane's own menu
   * produced, which is the same rule `rebind` states one paragraph up for the binding selector.
   *
   * **THE `PaneChoice` IS REQUIRED, AND THE PARAGRAPH THAT SAID OTHERWISE IS GONE RATHER THAN AMENDED.**
   * It read "THE ARGUMENT IS OPTIONAL BECAUSE THE MENU IS", and described a caller supplying no
   * `choices` getting a plain split button with no pick to report — true for exactly as long as no
   * production caller passed `choices` at all. Both panes pass one now, and `viewMenu` builds NO
   * split control without it (its own doc), so the caller the optionality existed for cannot arrive: a
   * split gesture and a pick are the same event. Left optional, every handler here and downstream would
   * branch forever on an `undefined` nothing can produce.
   */
  splitRow?: (choice: PaneChoice) => void
  splitColumn?: (choice: PaneChoice) => void
  close?: () => void
}

/**
 * The **text** panel: a copy's editable text — a λ term or a machine — as a collapsible region (Plan 7
 * part 1, spec §8). It replaces the `⌃/⌄` collapse button both views put in their control strips, and
 * gives what was one control with two nouns ("term editor", "machine source") one name.
 *
 * THE STATE IS `aria-expanded`, NOT A RELABEL — accessibility items 2 and 15 — and hiding is the panel
 * setting `hidden` on the body, which is the view's own editor host. The views keep no collapse class.
 *
 * SHOWN ONLY WHILE AN EDITOR IS MOUNTED, the "a control that provably cannot work should not be offered"
 * standard `viewMenu` and the title-selector apply: `update(false)` hides the whole panel.
 *
 * **THE STATE IS PERSISTED PER BUFFER, NOT PER PANE**, because the editor MOVES: a collapse remembered
 * against a pane would describe whichever buffer landed there next. `scratch.ts`'s `setCollapsed` records
 * the gesture `onToggle` reports, and `update`'s `initial` is how the record reaches this closure: it is
 * read only on the unavailable → available transition, and every mount the app makes passes the
 * buffer's own recorded flag.
 *
 * **AN UNMOUNT RESETS TO OPEN.** A reviewer once caught the predecessor coming back from an unmount and
 * remount still reading the PREVIOUS buffer's state over an editor that was showing; a hidden control
 * has no state left to survive with, so the next mount starts from its own record. The reset lives in
 * `update`, behind its no-op guard: a repeated same-state call is a no-op.
 */
export function textPanel(
  body: HTMLElement,
  onToggle: (collapsed: boolean) => void,
): { readonly el: HTMLElement; update(available: boolean, initial?: boolean): void } {
  const panel = createPanel({ name: 'text', label: 'text', body, onToggle: (open) => onToggle(!open) })
  panel.el.hidden = true
  let on = false
  return {
    el: panel.el,
    update(available: boolean, initial = false) {
      if (available === on) return
      on = available
      if (available) {
        panel.setOpen(!initial)
        panel.el.hidden = false
        return
      }
      panel.el.hidden = true
      panel.setOpen(true)
    },
  }
}

/**
 * What a split is asked to create: a `(leg, session)` PAIR, or the source pane when the tree has none.
 *
 * **`{ kind: 'source' }` IS NOT A THIRD LEG AND CARRIES NO SESSION, WHICH IS THE WHOLE SHAPE OF THIS
 * TYPE.** The source pane is chrome around the one editor `main.ts` owns — `pane-host.ts`'s
 * `applyLayout` says so directly with `if (l.pane === 'source') continue` — so it has no `PaneSlot`, no
 * `Binding`, and nothing for a `SessionId` here to name. A `{ kind: Leg; session }` shape stretched to
 * cover it would have needed an invented session for a leaf that resolves none, which is the same
 * unrepresentable-invalid-combination standard `PaneEvents.rebind` states for the axes a pick names.
 *
 * IT IS OFFERED ONLY WHILE NO SOURCE LEAF IS IN THE TREE (`viewMenu`'s `sourceAvailable`), because
 * a second source pane would be a second view of one editor rather than a second editor — and that is
 * the design's own reason source is refused a SPLIT (`viewMenu`'s doc). What this makes possible
 * is the way back: a closed source pane returns through any other pane's picker, with the layout the
 * user built still standing, rather than only through `reset preset`.
 */
export type PaneChoice = { kind: 'source' } | { kind: Leg; session: SessionId }

/**
 * What a split may be asked to create, as the menu reads it: every `(leg, session)` pair on offer,
 * whether the tree is currently without a source leaf, and which pair the pane doing the asking already
 * shows.
 *
 * NAMED, RATHER THAN INLINED AT EVERY SIGNATURE THAT CARRIES IT — `view-header.ts`'s `viewMenu`,
 * `app-header.ts`'s `addViewItems`, and `PaneView.setLayoutControls` (`sessions.ts`), which is the
 * per-frame push that fills it in.
 * It was spelled out as an object type at the two split pickers in this file while they were its only carriers, and
 * `setLayoutControls` is what makes it a shape crossing a module boundary — worth a single spelling.
 *
 * **`current` IS NULLABLE AND THE OTHER TWO ARE NOT, WHICH IS A STATEMENT ABOUT A PANE THAT HAS NEVER
 * BEEN PAINTED.** Both pane classes hold their latest `SplitChoices` in a field and hand `viewMenu`
 * a thunk that reads it, so the field needs a value from construction — and the honest one for a pane
 * `draw()` has not reached yet is "nothing on offer, and no pair in force". `options: []` says the first
 * half without inventing anything; a non-null `current` could only have been a `SessionId` the pane was
 * never told, since design §3.2b keeps a pane ignorant of its own binding except through what is pushed
 * to it. Nothing downstream branches on the null — `view-header.ts`'s `viewMenu` `find`s over the empty
 * list at the same moment — and no menu can be opened in that state anyway: the same `update` call that
 * mounts a split button is the one that delivers the real value.
 */
export type SplitChoices = {
  readonly options: readonly PaneOption[]
  readonly sourceAvailable: boolean
  readonly current: Binding<Leg> | null
}
