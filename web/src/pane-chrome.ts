import type { ControlState } from './controls'
import type { Leg } from './protocol'
import type { SessionId } from './session-client'
import type { Binding, PaneOption } from './sessions'

export type PaneEvents = {
  back(): void
  forward(): void
  play(): void
  restart(): void
  extend(): void
  /**
   * The pane selector picked a `(leg, session)` pair for this pane's slot.
   *
   * REQUIRED, UNLIKE THE TWO OPTIONAL MEMBERS BELOW, and the difference is not stylistic. Those two
   * are absent on a pane that genuinely lacks the affordance — the λ pane has no δ-table to click, the
   * TM pane has no λ window — whereas every pane occupies a slot and every slot has a binding
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
   * **A PANE SHOWING A LINK WINDOW MUST STILL DECLINE TO FORK, AND THAT IS NOW A RULE RATHER THAN A
   * CONSEQUENCE.** It used to hold for free — the pane passed its own body text, and `LambdaPane`'s
   * handler chose the frame's text over the window's for the reason recorded there. A step carries no
   * such distinction, so `LambdaPane.#refreshDetach` checks `#link` directly, and
   * `lambda-pane-editor.test.ts`'s "offers no fork while a link window is showing" pins it.
   */
  detach?: (step: number) => void
  /**
   * A genuine edit landed in a detached pane's own scratch buffer — design §4.3's second edit
   * gesture, and `detach`'s counterpart: that one forks a new scratch from a source-derived view,
   * this one recompiles the scratch that already exists. `LambdaEditor`'s debounced `onEdit` is the
   * only caller, wired through `LambdaPane.setEditor`, so it fires on a keystroke that survived the
   * debounce — never on the seed that mounted the editor (`LambdaEditor#setText`'s `#seeding` guard
   * is what keeps a seed from reaching here at all).
   *
   * OPTIONAL, FOR THE SAME REASON `detach` IS: an editor exists only on a pane whose slot owns a
   * scratch (§4.2), and this file declares the shape without deciding when a pane gets it — that is
   * `main.ts`'s wiring, same as `detach` above.
   */
  editScratch?: (src: string) => void
  /**
   * This pane asks to hold its scratch session's editor — wave 3 (5d-ii-a)'s editor-moves rule, and
   * `claimEditorButton`'s only caller.
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
  /** A state row was clicked. Absent on panes that have no table. */
  linkState?: (stateId: number) => void
  /** A token in the λ link window was clicked, at this byte offset into the full `lambdaText`. */
  linkLambda?: (byteOffset: number) => void
  /**
   * This pane's split and close gestures — 5d-ii-a.
   *
   * OPTIONAL, LIKE `detach` AND UNLIKE `rebind`, and the same test applies: a pane has these handlers
   * when it has the affordance. A pane rendered outside a layout tree — which is every pane in
   * `binding-selector.test.ts` and in `tests/node/sessions.test.ts` — has no tree to split.
   *
   * `close` CARRIES NOTHING. A pane knows it was asked to close; it does not know its own `LeafId`, its
   * path in the tree, or whether it is the last leaf. `pane-host.ts` holds the tree and answers all
   * three, which keeps the pane classes free of the layout entirely.
   *
   * **THE TWO SPLITS CARRY A `PaneChoice`, AND THAT REVERSES WHAT THIS PARAGRAPH USED TO SAY ABOUT ALL
   * THREE.** It read "THEY CARRY NOTHING", which was true while a split could only ever duplicate the
   * pane it was performed on — there was one possible answer, so there was nothing to report. A split
   * now asks WHAT to create (`splitControl` below), and the answer is a `(leg, session)` pair or the
   * source pane, which is a fact about the pick rather than about the tree. **THE DIVISION IS
   * UNCHANGED, ONLY THE SIDE THIS FALLS ON**: a handler still learns nothing here about where in the
   * tree it is, because the pane still does not know — what crosses is exactly what the pane's own menu
   * produced, which is the same rule `rebind` states one paragraph up for the binding selector.
   *
   * **THE `PaneChoice` IS REQUIRED, AND THE PARAGRAPH THAT SAID OTHERWISE IS GONE RATHER THAN AMENDED.**
   * It read "THE ARGUMENT IS OPTIONAL BECAUSE THE MENU IS", and described a caller supplying no
   * `choices` getting a plain split button with no pick to report — true for exactly as long as no
   * production caller passed `choices` at all. Both panes pass one now, and `layoutControls` builds NO
   * split control without it (its own doc), so the caller the optionality existed for cannot arrive: a
   * split gesture and a pick are the same event. Left optional, every handler here and downstream would
   * branch forever on an `undefined` nothing can produce.
   */
  splitRow?: (choice: PaneChoice) => void
  splitColumn?: (choice: PaneChoice) => void
  close?: () => void
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.title = title
  b.addEventListener('click', onClick)
  return b
}

/**
 * The `[detached]` badge on a pane's own `<h2>`, shared by both panes — design §4.5's second surface.
 *
 * REAL TEXT, NOT A COLOUR AND NOT AN ICON, and that is the decision rather than a default. §4.5
 * rejected a whole-pane visual treatment because hue is already the sole discriminator for five states
 * (the accessibility list's item 7 and its two aggravations) and this slice's own §6 forbids adding a
 * sixth. Text is also the interim mitigation for the a11y hole §4.5 records: `#link-status` is a plain
 * `<div>` that announces nothing, so the status line's sentence is unreachable to a screen reader,
 * while this sits in the heading of the pane the user is actually on.
 *
 * THE BRACKETS ARE PART OF THE SIGNAL. `.pane h2` is `text-transform: lowercase` with wide tracking, so
 * an unbracketed word would read as a second half of the pane's name ("lambda detached") rather than as
 * a status attached to it. They also survive every stylesheet failure, which a border does not.
 *
 * ADDED AND REMOVED, NEVER HIDDEN — the idiom this file already states for the continue button, taken
 * one step further for a reason specific to this element. `hidden` leaves the text in `textContent` and
 * in the DOM, so "the badge is gone" would mean "gone if you query it the way that respects `hidden`";
 * §5 asks for a test that a badge is REMOVED when a pane reattaches, and removal is what makes that
 * question have one answer. It is also why nothing here is a `disabled` control: the badge is not a
 * control at all.
 *
 * THE PANE OWNS THE `<h2>`, SO THIS TAKES IT AS A PARAMETER rather than building one. Both panes build
 * their own title in their constructor (`lambda-pane.ts`, `tm-pane.ts`) and there is no shared chrome
 * owner to route through — §4.5's own verification of the surface.
 */
export function detachedBadge(title: HTMLElement): { update(detached: boolean): void } {
  const el = document.createElement('span')
  el.className = 'detached-badge'
  el.textContent = '[detached]'
  // The word the badge is short for, said in full — the same reason every control above carries a
  // `title`. `link-status.ts`'s sentence is the authoritative narration and this is the glanceable
  // one (§4.5); the tooltip is what closes the gap for a reader who never sees the status line.
  el.title = 'this pane is bound to a scratch session and is not linked to the source'
  // MIRRORS `LambdaPane.renderLink`'S NO-OP GUARD, for the same reason: once `main.ts` drives this it
  // is on the per-frame path (`draw()` repaints every pane on every recorded frame during playback),
  // and appending or removing the same node sixty times a second is churn nobody asked for. Without
  // it, `append` on an already-appended node is a move rather than a duplicate, so the bug this
  // prevents is cost, not a second badge.
  let on = false
  return {
    update(detached: boolean) {
      if (detached === on) return
      on = detached
      if (detached) title.append(el)
      else el.remove()
    },
  }
}

/**
 * The fork control — design §4.3's trigger, and the only new control plan T8 adds.
 *
 * **§4.3's TRIGGER IS "EDITING A SOURCE-DERIVED λ VIEW", AND THERE IS NOTHING IN THIS APP TO EDIT ONE
 * IN. THAT GAP IS THIS BUTTON, AND IT IS A DEVIATION WORTH READING BEFORE IT IS COPIED.** The λ pane's
 * body is a `<pre>` of span-decorated tokens carrying 5b/5c's `data-at` link offsets and `.is-redex`
 * marks; it is a rendering of a recorded frame, not a document. Making it a text surface is a change
 * to the pane's SHAPE, and design §1 says the pane set "does not change shape" in this slice and puts
 * the multiplexer in 5d-ii — §1 also budgets 5d-i exactly "one control per pane (the binding selector)
 * and one status affordance". So the edit gesture the design names has no surface to happen on, and
 * this button is the smallest thing that means the same event: fork the term I am looking at.
 *
 * **THE SCRATCHPAD CAN NOW BE TYPED INTO, AND THAT REVERSES WHAT THIS PARAGRAPH USED TO SAY** —
 * inherited from 5d-i, where this button was all that shipped: it ran the term the pane was showing,
 * independently, with the source session still going, and nothing more — every claim §4.3 made about
 * the FORK, and none of what a user would eventually do with one. **5d-iii shipped exactly that**: a
 * detached pane's body gained a second region, a `LambdaEditor` mounted over the frame renderer
 * (`LambdaPane`'s `#editorHost`, design §4.2), and this button is still how a user reaches it — the
 * click still forks, the editor is what the fork now lands on. What has not changed, and could not
 * have: an ATTACHED pane still has no editor and this button still does not add one, because the
 * paragraph above still holds — there is nothing in an attached λ view to edit, and forking is still
 * how a user reaches the pane shape that can hold one.
 *
 * REAL TEXT, NOT A GLYPH ALONE, unlike the four transport buttons beside it. `↺ ◀ ▶ ⏵` are a
 * transport idiom a user has seen before; "fork this into a scratchpad" is not, and the accessible
 * name of a glyph-only button is the glyph — `title` does not replace text content for a screen
 * reader on an element that has some. Same reasoning as `detachedBadge` above, which chose text over a
 * colour and over an icon for §4.5's a11y interim.
 *
 * ADDED AND REMOVED, NEVER DISABLED — this file's stated idiom, and it now carries ONE fact rather
 * than two:
 *
 *   * A DETACHED PANE HAS NOTHING TO FORK. It is already showing the scratchpad; §4.3's second edit
 *     "rebinds to the existing scratch", which is what the binding selector beside it already does.
 *
 * **A TRUNCATED 512-BYTE FRAME NO LONGER DISQUALIFIES THIS BUTTON, AND THAT REVERSES WHAT THIS
 * PARAGRAPH USED TO SAY — corrected in T8 (plan 5d-iii) alongside `LambdaPane.#refreshDetach`, which
 * carried the matching `frame.cut === null` check.** It was true while `detach` sent the FRAME's own
 * text: `FRAME_BYTES` (512) prints two orders below the readout's budget, so most non-trivial terms
 * truncated there, a `Bytes` cut was a prefix that would not parse, and a `Depth` cut was not even
 * that. Design §4.1 changed what `detach` sends — a STEP, not text — and `main.ts` re-derives the
 * term from the SOURCE compile's step-0 print at `LAMBDA_BYTE_BUDGET` (128× `FRAME_BYTES`), which
 * this frame's own truncation says nothing about. §4.1a: "the refusal moved rather than vanished...
 * the worker answers `scratch: null` with a diagnostic saying so, and the pane keeps offering ✎" —
 * the remaining refusal (the source's OWN step-0 term cut at `LAMBDA_BYTE_BUDGET`) cannot be told
 * from a `LambdaState` frame at all, so it surfaces after the click — **NOT as a diagnostic in an
 * editor this fork mounts, because this refusal is exactly the one case where no editor ever gets
 * mounted at all.** That was this paragraph's own claim once, and it was wrong: a build this refusal
 * answers never reaches `scratch-compiled`, so `LambdaPane.setEditor` is never called and there is no
 * editor to put anything in — found in code review against a real worker, alongside the matching claim
 * on `LambdaPane.#refreshDetach`'s doc. `LambdaScratchpad.noSessionReply` (`scratch.ts`) retires the
 * failed attempt instead, which is what makes THIS control reappear, and `main.ts` puts the diagnostic
 * on `#link-status` (`link-status.ts`'s `forkFailed`) — the surface that survives a rebind rather than
 * one this refusal never gets to create. §4.5's standard — a thing that provably cannot work should not
 * be presented as though it might, the same one that deleted `node_to_lambda` — now cuts the other way
 * here: hiding this button for a truncated FRAME was presenting a working control as broken.
 *
 * THE PARENT IS PASSED IN AND IS THE CONTROL STRIP, which is why this takes an element like
 * `detachedBadge` does rather than returning one to place. The strip is already a flex row of
 * `.controls button`, so the control inherits every rule it needs and `style.css` gains nothing — one
 * control in a pane, not a new style, which is the treatment `.pane-binding`'s own comment records
 * for the selector. Nothing here carries state in colour (§6): the button is present or it is not,
 * and what it says is words.
 */
export function detachButton(parent: HTMLElement, onDetach: () => void): { update(available: boolean): void } {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'detach'
  el.textContent = '✎ fork'
  el.title = 'fork this term into a λ scratchpad — the source session keeps running'
  el.addEventListener('click', onDetach)
  // The same no-op guard `detachedBadge` and `paneSelect` state, for the same reason: this runs on
  // every recorded frame during playback (`main.ts`'s `draw()` -> `PaneSlot.render` -> the pane's
  // `render`), and appending or removing an unchanged node sixty times a second is churn nobody asked
  // for. It starts absent, so a pane that has never rendered offers no fork.
  let on = false
  return {
    update(available: boolean) {
      if (available === on) return
      on = available
      if (available) parent.append(el)
      else el.remove()
    },
  }
}

/**
 * The editor-collapse control on a detached λ pane — design §4.2.
 *
 * IT TOGGLES A CLASS AND NOTHING ELSE. The frame renderer below never learns it has more room, so
 * there is no second body state for `#redraw` and `renderLink` to disagree about — one code path, and
 * the collapse is presentation.
 *
 * ADDED AND REMOVED, NEVER DISABLED — this file's stated idiom. It is absent on an attached pane
 * because there is no editor to collapse, which is the same "a control that provably cannot work
 * should not be offered" standard `detachButton` and `paneSelect` both apply.
 *
 * THE LABEL NAMES THE CURRENT STATE, WHICH IS PR #20's `aria-label` TREATMENT and the mitigation the
 * accessibility list's item 2 asks for on the δ-table toggle. Nothing here carries state in colour:
 * the glyph changes and the accessible name changes with it.
 *
 * **THE "CURRENT STATE" SURVIVES A REMOVAL, WHICH MEANS IT RESETS ON ONE — found and fixed after a
 * reviewer walked the exact cycle this note now pins.** Mount an editor, click collapse (label ->
 * "show the term editor", host gains `.is-collapsed`), `setEditor(null)` to unmount, `setEditor(text)`
 * to remount: the fresh mount is expanded (`LambdaPane.setEditor` sets `#editorHost.className =
 * 'term-editor'` with no `.is-collapsed`, and calls `update(true)` here), but the button that used to
 * only detach `el` from `parent` on `update(false)` left the closure's `collapsed` flag untouched, so
 * it came back still reading "show the term editor" over an editor that was already showing. The label
 * named the PREVIOUS pane's state, not the one on screen — exactly what the paragraph above forbids.
 * Design §4.2 is explicit that this cannot be read as a feature: "THE STATE IS NOT PERSISTED... a
 * persisted collapse preference would outlive every session it described" — a scratch is retired and
 * replaced, not resumed, so there is no session for a remembered collapse to describe.
 *
 * THE RESET LIVES INSIDE `update`, NOT A SEPARATE METHOD, because `available` going false already IS
 * the unmount signal — this control's only caller ever hides it for that one reason
 * (`LambdaPane.setEditor`'s `text === null` branch) — and the existing no-op guard above (`available
 * === on`) already fires exactly once per real transition. Piggybacking on that guard is what keeps
 * this safe on the per-frame path every control here is written for: the reset cannot fire twice for
 * one unmount, and cannot fire at all while the control sits hidden across repeated calls with the same
 * `available`. A second exported method would have needed that same guard rebuilt beside this one
 * instead of reusing it.
 */
export function collapseButton(
  parent: HTMLElement,
  onToggle: (collapsed: boolean) => void,
): { update(available: boolean): void } {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'collapse'
  let collapsed = false
  const relabel = () => {
    el.textContent = collapsed ? '⌄' : '⌃'
    el.setAttribute('aria-label', collapsed ? 'show the term editor' : 'hide the term editor')
    el.title = collapsed ? 'show the term editor' : 'hide the term editor'
  }
  relabel()
  el.addEventListener('click', () => {
    collapsed = !collapsed
    relabel()
    onToggle(collapsed)
  })
  // The same no-op guard every control in this file states, for the same reason: this runs on every
  // recorded frame during playback.
  let on = false
  return {
    update(available: boolean) {
      if (available === on) return
      on = available
      if (available) {
        parent.append(el)
        return
      }
      el.remove()
      // See "THE 'CURRENT STATE' SURVIVES A REMOVAL" above: a removed control has no state left to
      // survive with, so the next mount must not inherit this one's click history.
      if (collapsed) {
        collapsed = false
        relabel()
      }
    },
  }
}

/**
 * The "bring the term editor to this pane" control on a pane bound to a scratch WHOSE editor is mounted somewhere
 * else — wave 3 (5d-ii-a)'s editor-moves rule, and the control that makes moving it a user gesture
 * rather than only a reply-driven side effect.
 *
 * A SEPARATE BUTTON FROM `collapseButton`, NOT A THIRD STATE BOLTED ONTO IT, though the two glyphs
 * (`⌄`) match while both could apply. `collapseButton` toggles the LOCAL host's visibility and is
 * offered only while THIS pane already holds the mounted editor (`LambdaPane.setEditor`'s mount branch
 * is its only caller that shows it); this button is offered only while the pane's session is detached
 * and this pane does NOT hold the editor (`LambdaPane`'s `#refreshClaim`). The two conditions are
 * mutually exclusive — holding it is exactly what disqualifies this one — so a pane never offers both
 * controls at once, and there is no selector ambiguity between them.
 *
 * `aria-label` DELIBERATELY DOES NOT REUSE `collapseButton`'s "show the term editor" — IMPORTANT
 * finding, whole-branch review before merge: the two controls are mutually exclusive by construction
 * (above), so no SELECTOR is ever ambiguous, but a screen-reader user hears one spoken name for two
 * semantically different actions — "uncollapse THIS pane's own editor" versus "pull the editor here
 * FROM ANOTHER pane" — which is exactly the ambiguity `aria-label`'s whole job is to prevent, selector
 * clashes or not. This button's name states what it does: bring the editor here.
 *
 * ADDED AND REMOVED, NEVER DISABLED, this file's stated idiom. IT CARRIES NO LOCAL STATE, unlike
 * `collapseButton`: a click here is always the same request ("bring the editor to this pane"), so there
 * is no toggle to relabel and no "current state survives a removal" hazard to guard against.
 */
export function claimEditorButton(parent: HTMLElement, onClaim: () => void): { update(available: boolean): void } {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'claim-editor'
  el.textContent = '⌄'
  el.setAttribute('aria-label', 'bring the term editor to this pane')
  el.title = 'bring the term editor to this pane — it is currently mounted on another pane'
  el.addEventListener('click', onClaim)
  // The same no-op guard every control in this file states, for the same reason: this runs on every
  // recorded frame during playback.
  let on = false
  return {
    update(available: boolean) {
      if (available === on) return
      on = available
      if (available) parent.append(el)
      else el.remove()
    },
  }
}

/**
 * The pane selector: which `(leg, session)` PAIR this pane's slot is showing — decision 1's control
 * (design §2, plan T7), widened to both axes, shared by both panes.
 *
 * **BOTH AXES ARE ON OFFER, AND THAT REVERSES WHAT THIS DOC USED TO SAY.** It read "ONLY THE SESSION
 * IS ON OFFER, NOT THE LEG. The options are `SessionRegistry.options(leg)` for the slot's own leg."
 * The options are `SessionRegistry.pairs()` now, which is the same source of truth read for both legs
 * — see its doc for why it is built from `options`' own walk rather than from a second table.
 *
 * **ONE CONTROL RATHER THAN A KIND PICKER BESIDE A SESSION PICKER, BECAUSE THE AXES ARE NOT
 * INDEPENDENT.** A session holds at most one leg per `Leg` and `SessionRegistry.legOf` THROWS on a
 * binding naming a leg its session lacks, so two controls would need an invented rule for "pick TM
 * while bound to a λ-only scratch" — a silent rebind, or an option that vanishes as the other control
 * moves. A list of pairs makes the invalid combination unrepresentable. `PaneEvents.rebind`'s doc
 * carries the same argument from the handler's side.
 *
 * GROUPED BY LEG, WITH `<optgroup>` DOING THE WORK RATHER THAN A LABEL PREFIX. Two sessions can share
 * a label — nothing forbids it — so "λ — source" spelled into each option's text would be the only
 * thing telling two same-named options apart, and it would be doing it in a string a screen reader
 * reads out on every option. A group carries the leg once, is announced once, and leaves each option
 * reading as the session it names. There is no colour here at all, which §6 requires of every control
 * this slice adds.
 *
 * ADDED AND REMOVED, NEVER DISABLED, AND NOT SHOWN AT ALL BELOW TWO OPTIONS — this file's stated idiom
 * (the continue button, and `detachedBadge` above), and the threshold now counts PAIRS rather than
 * sessions. §4.5's standard is the one that deleted `node_to_lambda`: a thing that provably cannot
 * work should not be presented as though it might, and a one-option `<select>` is that case exactly.
 * **WHAT THE WIDENING CHANGES IS WHEN THAT THRESHOLD IS CROSSED, AND IT IS WORTH SAYING RATHER THAN
 * LEAVING TO BE DISCOVERED**: the source session alone contributes TWO pairs (its λ leg and its TM
 * leg), so a fresh page now shows this control where it used to show nothing. `main.ts`'s own note on
 * registering the source session carries the correction from that side.
 *
 * THE ANCHOR IS THE PANE'S `<h2>`, TAKEN AS A PARAMETER, exactly like `detachedBadge` above: both
 * panes build their own title in their constructor and there is no shared chrome owner to route
 * through (§4.5's verification of the surface). `title.after` puts the control between the heading and
 * the pane body, so the two facts about a pane's identity — what it is, and which pair it is showing —
 * read together with the `[detached]` badge that sits in the heading itself.
 *
 * The `<label>` wrapping is the same implicit-label idiom `index.html` uses for the encoding picker,
 * so the control is named to a screen reader without an `aria-label` to keep in step. Its caption is
 * `shows` rather than `session`, because `session` is now the name of one of the two things this
 * control picks.
 */
export function paneSelect(
  title: HTMLElement,
  onPick: (choice: Binding<Leg>) => void,
): { update(options: readonly PaneOption[], current: Binding<Leg>): void } {
  const el = document.createElement('label')
  el.className = 'pane-binding'
  const caption = document.createElement('span')
  caption.className = 'pane-binding-caption'
  caption.textContent = 'shows'
  const select = document.createElement('select')
  // `change`, NOT `input` — unchanged, and its reason is unchanged: a keyboard user arrowing the list
  // would otherwise rebind and repaint the pane for every option they pass. What widening adds is that
  // each of those repaints could now also TEAR THE PANE DOWN AND REBUILD IT, so the argument that was
  // about cost is now also about the pane vanishing under the user mid-browse.
  select.addEventListener('change', () => {
    const [leg, session] = select.value.split('\x00')
    if (leg === 'lambda' || leg === 'tm') onPick({ leg, session: session ?? '' })
  })
  el.append(caption, select)
  // The option list currently in the DOM, as one string. `update` runs on every recorded frame during
  // playback (`main.ts`'s `draw()`), and rebuilding three `<option>` nodes per frame would also blow
  // away the open dropdown of a user in the middle of choosing. Comparing the list is what makes the
  // repeat call free; `select.value` is compared separately below because the binding can change
  // without the list changing.
  let rendered = ''
  return {
    update(options: readonly PaneOption[], current: Binding<Leg>) {
      if (options.length < 2) {
        el.remove()
        // Reset, so a list that shrinks below two and grows back is rebuilt rather than trusted: the
        // second list may name entirely different pairs.
        rendered = ''
        return
      }
      // TWO DELIMITERS THAT CANNOT OCCUR IN AN ID OR A LABEL, so no two option lists can collide into
      // one key by containing each other's separators. The LEG is in the key beside them because the
      // list is a list of pairs now: two lists differing only in which leg a session was offered
      // under are two different lists, and a key that omitted the leg would call them equal and leave
      // the DOM showing the first one.
      //
      // **WRITTEN AS `\x00`/`\x01` ESCAPES, AND THAT IS LOAD-BEARING FOR THE SOURCE FILE RATHER THAN
      // FOR THE STRING.** They were literal control characters until `scripts/check-text-bytes.sh`
      // was added, and one NUL byte makes the WHOLE FILE binary to every search tool: `rg` skips it
      // and reports no match with exit 1 — silently, no warning — while `grep` says "Binary file
      // matches" and prints nothing. So every search across `web/src/` quietly omitted this file,
      // which holds four heavily-argued doc comments, one of which had gone stale and was found only
      // because a reviewer read the file instead of searching it. The escapes produce the identical
      // string at runtime; do not "tidy" them back into literals.
      //
      // THE OPTION VALUE BELOW USES `\x00` FOR THE SAME REASON THE KEY DOES: it joins two fields —
      // a leg and a session id — that must not be able to collide into one. `'lambda'`/`'tm'` cannot
      // contain it and neither can an id, so the split in the `change` handler above is exact.
      const key = options.map((o) => `${o.leg}\x00${o.id}\x00${o.label}`).join('\x01')
      if (key !== rendered) {
        rendered = key
        const groups = new Map<Leg, HTMLOptGroupElement>()
        for (const o of options) {
          let group = groups.get(o.leg)
          if (group === undefined) {
            group = document.createElement('optgroup')
            group.label = o.leg === 'lambda' ? 'λ' : 'TM'
            groups.set(o.leg, group)
          }
          const opt = document.createElement('option')
          opt.value = `${o.leg}\x00${o.id}`
          opt.textContent = o.label
          group.append(opt)
        }
        select.replaceChildren(...groups.values())
      }
      const want = `${current.leg}\x00${current.session}`
      if (select.value !== want) select.value = want
      if (el.parentNode === null) title.after(el)
    },
  }
}

/**
 * The ◀ ▶ ⏵ ↺ strip and its step readout, shared by both panes.
 *
 * ONE IMPLEMENTATION, because the two panes' controls are the same controls. `controls.ts` already
 * computed which are live; this file only reflects that, so there is nothing here to get wrong twice.
 *
 * THE CONTINUE BUTTON IS ADDED AND REMOVED, NEVER DISABLED. A `depth-refused` leg has no honest
 * continue — `raise_cap` refuses to clear `depth_capped` — and a greyed-out button still tells the
 * user the operation exists.
 */
export function controlStrip(on: PaneEvents): { el: HTMLElement; update(c: ControlState): void } {
  const el = document.createElement('div')
  el.className = 'controls'
  // `restart` IS `hist.seek(0)`, which clamps to the OLDEST RETAINED frame — step 0 exactly until
  // eviction has happened, `oldestStep` after. "back to step 0" would be wrong the moment history has
  // ever been trimmed, so the title names what the button actually does rather than a step number it
  // cannot promise.
  const restart = button('↺', 'back to the oldest kept step', on.restart)
  const back = button('◀', 'one step back', on.back)
  const forward = button('▶', 'one step forward', on.forward)
  const play = button('⏵', 'play', on.play)
  const step = document.createElement('span')
  step.className = 'step'
  const extend = button('', 'record further', on.extend)
  extend.className = 'extend'
  el.append(restart, back, forward, play, step, extend)

  return {
    el,
    update(c: ControlState) {
      restart.disabled = !c.canRestart
      back.disabled = !c.canBack
      forward.disabled = !c.canForward
      play.disabled = !c.canPlay
      step.textContent = c.stepText
      if (c.continueLabel === null) {
        extend.hidden = true
      } else {
        extend.hidden = false
        extend.textContent = c.continueLabel
      }
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
 * unrepresentable-invalid-combination standard `paneSelect` states for the axes it lists.
 *
 * IT IS OFFERED ONLY WHILE NO SOURCE LEAF IS IN THE TREE (`splitControl`'s `sourceAvailable`), because
 * a second source pane would be a second view of one editor rather than a second editor — and that is
 * the design's own reason source is refused a SPLIT (`layoutControls`' doc). What this makes possible
 * is the way back: a closed source pane returns through any other pane's picker, with the layout the
 * user built still standing, rather than only through `reset layout`.
 */
export type PaneChoice = { kind: 'source' } | { kind: Leg; session: SessionId }

/**
 * What a split may be asked to create, as the menu reads it: every `(leg, session)` pair on offer,
 * whether the tree is currently without a source leaf, and which pair the pane doing the asking already
 * shows.
 *
 * NAMED, RATHER THAN INLINED AT EVERY SIGNATURE THAT CARRIES IT — `splitControl` and `layoutControls`
 * below, and `PaneView.setLayoutControls` (`sessions.ts`), which is the per-frame push that fills it in.
 * It was spelled out as an object type at the two in this file while they were its only carriers, and
 * `setLayoutControls` is what makes it a shape crossing a module boundary — worth a single spelling.
 *
 * **`current` IS NULLABLE AND THE OTHER TWO ARE NOT, WHICH IS A STATEMENT ABOUT A PANE THAT HAS NEVER
 * BEEN PAINTED.** Both pane classes hold their latest `SplitChoices` in a field and hand `layoutControls`
 * a thunk that reads it, so the field needs a value from construction — and the honest one for a pane
 * `draw()` has not reached yet is "nothing on offer, and no pair in force". `options: []` says the first
 * half without inventing anything; a non-null `current` could only have been a `SessionId` the pane was
 * never told, since design §3.2b keeps a pane ignorant of its own binding except through what is pushed
 * to it. Nothing downstream branches on the null — `splitControl`'s `find` below misses for the empty
 * list at the same moment — and no menu can be opened in that state anyway: the same `update` call that
 * mounts a split button is the one that delivers the real value.
 */
export type SplitChoices = {
  readonly options: readonly PaneOption[]
  readonly sourceAvailable: boolean
  readonly current: Binding<Leg> | null
}

/** How a `(leg, session)` pair names its leg in the menu — `paneSelect`'s `<optgroup>` labels, verbatim. */
const legLabel = (leg: Leg): string => (leg === 'lambda' ? 'λ' : 'TM')

/**
 * Unique ids for the popovers, so `aria-controls` on each split button names exactly one menu.
 *
 * PER MODULE RATHER THAN PER `layoutControls` CALL, for `main.ts`'s `leafCounter` reason: every pane on
 * the page builds two of these, and a counter reset per pane would mint `pane-picker-0` once per pane —
 * duplicate ids in one document, which is precisely what an id reference cannot survive.
 */
let pickerSeq = 0

/**
 * One split control and the menu it opens.
 *
 * NATIVE `popover`, NOT A HAND-ROLLED DROPDOWN. Light dismiss, top-layer placement and Escape come
 * with the attribute; a hand-rolled menu would need a document-level click listener that has to be
 * removed when the pane closes, and a z-index negotiation with the dividers `layout-view.ts` draws
 * between panes. The browser tier is Chromium-only (`vite.config.ts`'s `instances`), so this is fully
 * drivable in test rather than a capability asserted from a support table.
 *
 * THE LIST IS BUILT ON OPEN, NOT ON EVERY FRAME. `layoutControls.update` below is on the per-frame path
 * — `draw()` repaints every pane on every recorded frame during playback — so building options there
 * would incur exactly the cost `paneSelect`'s rendered-key comparison exists to avoid. A menu that is
 * closed has no state to keep fresh, which is a stronger position than the selector can take: there is
 * no staleness to guard against rather than a guard that makes staleness cheap. It is also why
 * `choices` is a THUNK and not a value — a value handed over at construction would be the one thing a
 * build-on-open cannot fix.
 *
 * **THE PANE'S OWN PAIR IS FIRST AND SAYS `(same)`.** Splitting used to be one click and is now two;
 * putting the common case at the top is what keeps the second click a click rather than a hunt. The
 * label spells the leg with `legLabel` above, so a pair reads the same here as it does in the selector
 * two rows up — two controls listing one set of pairs should not name them two ways.
 *
 * **THE FIRST ITEM IS `autofocus`, NOT `.focus()`, AND THE DIFFERENCE IS THAT ONE OF THEM WORKS.** The
 * menu is built in `beforetoggle`, which fires BEFORE the popover is shown — the element is still
 * `display: none` at that point, and `.focus()` on a hidden element is a silent no-op, so a keyboard
 * user would have been left on the split button with the menu open and nothing to arrow through. The
 * popover's own show algorithm runs its focusing steps AFTER making it visible and honours `autofocus`
 * on a descendant, which is the one hook that lands inside the same synchronous show. `toggle` would
 * have worked too and is queued as a task, so a click and the focus it causes would no longer be one
 * gesture. This is a CREATION control with no other route to it, so the accessibility list's item 1
 * applies at its strongest: building the keyboard path is the fix, not deferring it.
 */
function splitControl(
  label: string,
  glyph: string,
  fire: (choice: PaneChoice) => void,
  choices: () => SplitChoices,
): { button: HTMLButtonElement; menu: HTMLElement } {
  const id = `pane-picker-${pickerSeq++}`
  const menu = document.createElement('div')
  menu.className = 'pane-picker'
  menu.id = id
  menu.popover = 'auto'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'layout-control'
  button.textContent = glyph
  button.title = label
  button.setAttribute('aria-label', label)
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-controls', id)
  // STATED AT CONSTRUCTION, NOT ONLY ON THE FIRST TOGGLE. A disclosure control with no `aria-expanded`
  // until it has been used once announces itself as a plain button to the one user who most needs to
  // know it opens something.
  button.setAttribute('aria-expanded', 'false')
  // THE INVOKER RELATIONSHIP IS WHAT MAKES THE CLICK OPEN RATHER THAN SPLIT. There is deliberately no
  // `click` listener on this button at all: the popover's own activation behaviour is the entire
  // handler, so there is no second gesture racing the first.
  button.popoverTargetElement = menu

  menu.addEventListener('beforetoggle', (e) => {
    const open = e.newState === 'open'
    button.setAttribute('aria-expanded', String(open))
    if (!open) return
    const { options, sourceAvailable, current } = choices()
    const items: HTMLButtonElement[] = []
    const add = (text: string, choice: PaneChoice) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = text
      b.addEventListener('click', () => {
        menu.hidePopover()
        fire(choice)
      })
      items.push(b)
    }
    // `?.` ON BOTH HALVES RATHER THAN A NULL BRANCH — see `SplitChoices`. A pane with no pair in force
    // has an empty `options` too, so the pair that would be labelled `(same)` is missing for two reasons
    // at once and neither needs a case of its own.
    const mine = options.find((o) => o.leg === current?.leg && o.id === current?.session)
    if (mine !== undefined) add(`${legLabel(mine.leg)} · ${mine.label} (same)`, { kind: mine.leg, session: mine.id })
    // IDENTITY AGAINST `mine`, NOT THE PREDICATE RESTATED. `mine` came out of this very array, so the
    // skip cannot drift from the match above it — which is the failure a second copy of a two-field
    // comparison invites.
    for (const o of options) {
      if (o === mine) continue
      add(`${legLabel(o.leg)} · ${o.label}`, { kind: o.leg, session: o.id })
    }
    // NO LEG IN THIS ONE'S TEXT, AND THAT IS ITS ONLY DISCRIMINATOR. The source SESSION is labelled
    // `source` too, so `λ · source` and this entry differ by the leg prefix the pairs above all carry.
    if (sourceAvailable) add('source', { kind: 'source' })
    menu.replaceChildren(...items)
    const first = items[0]
    if (first !== undefined) first.autofocus = true
  })

  return { button, menu }
}

/**
 * The split and close controls on a pane's chrome — 5d-ii-a.
 *
 * BUILT ONCE, ADDED AND REMOVED, NEVER DISABLED — the idiom `detachedBadge` and `detachButton` already
 * state, and here it carries the design's two absences. The source pane offers no split because there
 * is one editor to duplicate into, and the last remaining leaf offers no close because an empty tree
 * has no honest rendering. Both are the accessibility list's item 1: a control that provably cannot
 * work should not be offered, which is why neither is a greyed button.
 *
 * HANDLERS ARE WIRED IN THE CONSTRUCTOR AND NEVER REWIRED, because `update` is on the per-frame path —
 * `draw()` repaints every pane on every recorded frame — and re-adding a listener sixty times a second
 * is how one click becomes sixty.
 *
 * `on: Pick<PaneEvents, 'splitRow' | 'splitColumn' | 'close'>`, NOT THE FULL `PaneEvents` — T13's own
 * addition, and a narrowing rather than a new type: this function never read the other six members, so
 * the parameter only ever needed the three it uses. What it makes possible is `main.ts`'s SOURCE pane,
 * which has a close gesture (the paragraph above: source is refused only a SPLIT, not a close) but none
 * of `PaneEvents`'s transport or binding members — there is no leg to step through and no session to
 * rebind, so a caller offering only `{ close }` is a caller telling the truth about what the source pane
 * can do, rather than one padding out five no-op stubs to satisfy a type that asked for more than this
 * function reads.
 *
 * **`choices` IS WHAT TURNS THE TWO SPLIT BUTTONS INTO PICKERS, AND WITHOUT IT THERE ARE NO SPLIT
 * BUTTONS AT ALL — WHICH REVERSES WHAT THIS PARAGRAPH USED TO SAY.** It read "A caller that supplies none
 * gets exactly today's control — a button that reports the gesture and nothing else", written while
 * `PaneEvents.splitRow` still took an optional `PaneChoice`. That argument is required now (its own
 * doc), so a split control with no menu has nothing it could report: it would be a button that provably
 * cannot work, which is the one thing this file's stated idiom refuses to mount. The parameter stays
 * optional for `main.ts`'s SOURCE pane, which passes `{ close }` alone and can never split — its
 * `update` has always passed a literal `false` for `canSplit`, so the two controls this now declines to
 * build are two it never displayed.
 *
 * A THUNK RATHER THAN A LIST, because the list is read at the moment a menu OPENS rather than when this
 * function runs or when `update` does — `splitControl`'s own doc has the argument, and it is the same
 * per-frame-cost argument every control in this file states, taken to the point where the cost is zero
 * rather than merely guarded.
 */
export function layoutControls(
  parent: HTMLElement,
  on: Pick<PaneEvents, 'splitRow' | 'splitColumn' | 'close'>,
  choices?: () => SplitChoices,
): { update(canClose: boolean, canSplit: boolean): void } {
  const mk = (label: string, glyph: string, handler?: () => void) => {
    const b = button(glyph, label, () => handler?.())
    b.setAttribute('aria-label', label)
    b.className = 'layout-control'
    return b
  }

  // THE SPLIT HALF OF THE STRIP AS A LIST OF NODES RATHER THAN TWO NAMED BUTTONS, because each control
  // contributes TWO — the button and the popover that belongs to it, appended beside it so a pane that
  // leaves the DOM takes its menus with it and nothing has to be swept on close. `update` below adds and
  // removes the whole list, which is what keeps this one piece of ordering logic rather than two; the
  // empty list a caller with no `choices` gets (see this function's doc) falls through it unchanged.
  const splitNodes: HTMLElement[] =
    choices === undefined
      ? []
      : (() => {
          const row = splitControl('split left and right', '⇥', (c) => on.splitRow?.(c), choices)
          const col = splitControl('split top and bottom', '⤓', (c) => on.splitColumn?.(c), choices)
          return [row.button, row.menu, col.button, col.menu]
        })()
  const close = mk('close this pane', '×', on.close)

  let shownClose = false
  let shownSplit = false

  return {
    update(canClose: boolean, canSplit: boolean) {
      if (canSplit !== shownSplit) {
        shownSplit = canSplit
        if (canSplit) {
          parent.append(...splitNodes)
          // `Node.append` MOVES A NODE ALREADY IN THE DOM rather than duplicating it — that is the
          // whole bug this line closes. If `close` is already mounted (a prior `update` showed it)
          // and splitting turns back on, `parent.append(...splitNodes)` above drops the split
          // controls at the END of `parent`, shoving `close` in front of them: `update(true,true)
          // -> update(true,false) -> update(true,true)` produced close, split-row, split-column
          // instead of the required split-row, split-column, close. Re-appending `close` here — a
          // no-op move when it is already last — restores the order every time the splits reappear,
          // regardless of how many times close was toggled in between. `pane-layout-controls.test.ts`'s
          // "keeps split-row, split-column, close in order across a canSplit toggle" pins this.
          if (shownClose) parent.append(close)
        } else {
          for (const n of splitNodes) n.remove()
        }
      }
      if (canClose !== shownClose) {
        shownClose = canClose
        if (canClose) parent.append(close)
        else close.remove()
      }
    },
  }
}
