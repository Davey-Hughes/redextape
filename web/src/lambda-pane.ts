import type { ControlState } from './controls'
import type { LambdaWindow } from './lambda-window'
import { bindingSelect, controlStrip, detachButton, detachedBadge, type PaneEvents } from './pane-chrome'
import type { SessionId } from './session-client'
import type { BindingOption } from './sessions'
import { byteIndexAt, byteToIndex, decorationRanges, indexToByte } from './spans'
import type { LambdaState } from './types'

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
    // IN THE CONTROL STRIP, NOT ON THE `<h2>`'s ROW BESIDE THE SELECTOR. The heading already carries
    // two things — the pane's name and §4.5's `[detached]` badge — and both are STATEMENTS about the
    // pane; the strip is where its verbs live. It is also why no stylesheet rule was needed: the
    // button is a `.controls button` like the four beside it. `detachedBadge` and `bindingSelect` take
    // the title for the same kind of reason in the other direction.
    const detach = on.detach
    if (detach !== undefined) {
      // THE FRAME'S TEXT, NOT THE `<pre>`'s. When a link window is showing, this pane's body is a
      // slice of the SOURCE COMPILE's step-0 term printed at `LAMBDA_BYTE_BUDGET` — a different
      // program's text in a different coordinate system (`renderLink`'s own doc), and clipped at both
      // ends besides. Forking from it would seed the scratchpad with something the pane's own leg
      // never produced, which is §5's standard for a detached pane's clauses applied to the fork.
      // `#frame` is this leg's term at its current step, which is what "that pane's current text"
      // means.
      this.#detach = detachButton(this.#strip.el, () => detach(this.#frame?.text ?? ''))
    }
    host.replaceChildren(title, this.#text, this.#strip.el)

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
   */
  setDetached(detached: boolean): void {
    this.#detached = detached
    this.#badge.update(detached)
    this.#refreshDetach()
  }

  /**
   * Offer the fork control exactly when a fork would work.
   *
   * BOTH CONDITIONS ARE `detachButton`'s DOC, EVALUATED WHERE THE TWO INPUTS MEET: a detached pane is
   * already on the scratchpad and has nothing to fork, and a frame that is absent or TRUNCATED has no
   * whole term to seed one with — `lambda/syntax.rs` round-trips a printed term, not a prefix of one,
   * and a `Depth` cut is not even a prefix. §4.5's standard is that a thing which provably cannot work
   * must not be presented as though it might.
   *
   * IT DOES NOT ASK WHETHER THE LEG IS AVAILABLE. `render(null, …)` is what a declined or
   * not-yet-compiled leg produces, so the `frame === null` arm already covers it, and reading
   * `ControlState` here would be a second source for the same fact.
   */
  #refreshDetach(): void {
    const frame = this.#frame
    this.#detach?.update(!this.#detached && frame !== null && frame.cut === null)
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
