import type { ControlState } from './controls'
import type { SessionId } from './session-client'
import type { BindingOption } from './sessions'

export type PaneEvents = {
  back(): void
  forward(): void
  play(): void
  restart(): void
  extend(): void
  /**
   * The binding selector picked a different session for this pane's slot.
   *
   * REQUIRED, UNLIKE THE TWO OPTIONAL MEMBERS BELOW, and the difference is not stylistic. Those two
   * are absent on a pane that genuinely lacks the affordance — the λ pane has no δ-table to click, the
   * TM pane has no λ window — whereas every pane occupies a slot and every slot has a binding
   * (design §3.2b, decision 1). A pane whose rebind did nothing would be a pane whose selector lies.
   *
   * IT TAKES A `SessionId` AND NOT A `(session, leg)` PAIR. The leg is fixed by the slot's renderer
   * type; see `PaneSlot`'s doc in `sessions.ts` for the constraint that forces it and for what is
   * given up.
   */
  rebind(session: SessionId): void
  /**
   * Fork this pane's term into the λ scratchpad — design §4.3, carrying the text the pane is showing.
   *
   * OPTIONAL, LIKE THE TWO BELOW AND UNLIKE `rebind`, and the test is the one those two already
   * apply: a pane has this handler when it has the affordance the handler reports. The TM pane has no
   * term to fork — it renders a δ-table projected from a compiled program, and §4.1's `TmScratch` is
   * built from `.tm` TEXT that no surface in this app holds (see `protocol.ts`'s `lambda-scratch`).
   *
   * THE TEXT IS THE PANE'S, NOT A LOOKUP. §4.3 seeds the scratchpad with "that pane's current text",
   * and the pane is what has it; see `LambdaPane`'s detach handler for which of its two texts that is
   * and why.
   */
  detach?: (text: string) => void
  /** A state row was clicked. Absent on panes that have no table. */
  linkState?: (stateId: number) => void
  /** A token in the λ link window was clicked, at this byte offset into the full `lambdaText`. */
  linkLambda?: (byteOffset: number) => void
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
 * **WHAT THAT COSTS, SAID PLAINLY: the scratchpad cannot be typed into yet.** It runs the term the
 * pane was showing, independently, with the source session still going — which is every claim §4.3
 * makes about the FORK, and none of what a user would eventually do with one. A term box belongs with
 * the pane shape that can hold it.
 *
 * REAL TEXT, NOT A GLYPH ALONE, unlike the four transport buttons beside it. `↺ ◀ ▶ ⏵` are a
 * transport idiom a user has seen before; "fork this into a scratchpad" is not, and the accessible
 * name of a glyph-only button is the glyph — `title` does not replace text content for a screen
 * reader on an element that has some. Same reasoning as `detachedBadge` above, which chose text over a
 * colour and over an icon for §4.5's a11y interim.
 *
 * ADDED AND REMOVED, NEVER DISABLED — this file's stated idiom, and here it carries two facts rather
 * than one:
 *
 *   * A DETACHED PANE HAS NOTHING TO FORK. It is already showing the scratchpad; §4.3's second edit
 *     "rebinds to the existing scratch", which is what the binding selector beside it already does.
 *   * A TRUNCATED TERM CANNOT BE FORKED AT ALL, and this is the correctness half. A frame prints at
 *     `FRAME_BYTES` (512), two orders below the readout's budget, so most non-trivial terms truncate
 *     — and `lambda/syntax.rs`'s round-trip guarantee is about a WHOLE printed term. A `Bytes` cut is
 *     a prefix that will not parse; a `Depth` cut is not even a prefix. Seeding a scratchpad from one
 *     would answer `no-session` with a parse diagnostic, or worse, parse into a different term.
 *     §4.5's standard — a thing that provably cannot work should not be presented as though it might
 *     — is the same one that deleted `node_to_lambda`.
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
  // The same no-op guard `detachedBadge` and `bindingSelect` state, for the same reason: this runs on
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
 * The binding selector: which session this pane's slot is showing — decision 1's control (design §2,
 * plan T7), shared by both panes.
 *
 * ONLY THE SESSION IS ON OFFER, NOT THE LEG. The options are `SessionRegistry.options(leg)` for the
 * slot's own leg, so what varies is which session's λ (or TM) leg is on screen. `PaneSlot`'s doc in
 * `sessions.ts` carries the constraint that forces this — `Binding<K>`'s leg is a type parameter and a
 * writable `leg` would collapse it — and says plainly what is given up.
 *
 * ADDED AND REMOVED, NEVER DISABLED, AND NOT SHOWN AT ALL BELOW TWO OPTIONS. That is this file's
 * stated idiom (the continue button, and `detachedBadge` above) applied to a control whose option
 * list genuinely comes and goes: `main.ts` registers one session at start-up, §4.3's scratchpad
 * arrives when a user forks (`detachButton` above) and leaves again on the next recompile, so a
 * selector rendered on a fresh page would be a `<select>` a user can open and change nothing with.
 * §4.5's standard is the one that deleted `node_to_lambda` — a thing that provably cannot work
 * should not be presented as though it might — and one option is that case exactly. It reappears the
 * moment a second session with this leg is registered, which is what
 * `tests/browser/binding-selector.test.ts` asserts.
 *
 * THE ANCHOR IS THE PANE'S `<h2>`, TAKEN AS A PARAMETER, exactly like `detachedBadge` above: both
 * panes build their own title in their constructor and there is no shared chrome owner to route
 * through (§4.5's verification of the surface). `title.after` puts the control between the heading and
 * the pane body, so the two facts about a pane's identity — what it is, and which session it is
 * showing — read together with the `[detached]` badge that sits in the heading itself.
 *
 * NO COLOUR CARRIES ANYTHING HERE, which §6 requires of every control this slice adds: the current
 * binding is the `<select>`'s own value, which is text, and the sessions are told apart by their
 * labels. The `<label>` wrapping is the same implicit-label idiom `index.html` uses for the encoding
 * picker, so the control is named to a screen reader without an `aria-label` to keep in step.
 */
export function bindingSelect(
  title: HTMLElement,
  onPick: (session: SessionId) => void,
): { update(options: readonly BindingOption[], current: SessionId): void } {
  const el = document.createElement('label')
  el.className = 'pane-binding'
  const caption = document.createElement('span')
  caption.className = 'pane-binding-caption'
  caption.textContent = 'session'
  const select = document.createElement('select')
  // `change`, NOT `input`. A keyboard user arrowing through a `<select>` fires `input` on every option
  // they pass, and each one would rebind the pane and repaint it — so browsing the list would run the
  // whole slot render for sessions the user is only looking at. `change` fires when they commit.
  select.addEventListener('change', () => onPick(select.value))
  el.append(caption, select)
  // The option list currently in the DOM, as one string. `update` runs on every recorded frame during
  // playback (`main.ts`'s `draw()`), and rebuilding three `<option>` nodes per frame would also blow
  // away the open dropdown of a user in the middle of choosing. Comparing the list is what makes the
  // repeat call free; `select.value` is compared separately below because the binding can change
  // without the list changing.
  let rendered = ''
  return {
    update(options: readonly BindingOption[], current: SessionId) {
      if (options.length < 2) {
        el.remove()
        // Reset, so a list that shrinks below two and grows back is rebuilt rather than trusted: the
        // second list may name entirely different sessions.
        rendered = ''
        return
      }
      const key = options.map((o) => `${o.id} ${o.label}`).join('')
      if (key !== rendered) {
        rendered = key
        select.replaceChildren(
          ...options.map((o) => {
            const opt = document.createElement('option')
            opt.value = o.id
            opt.textContent = o.label
            return opt
          }),
        )
      }
      if (select.value !== current) select.value = current
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
