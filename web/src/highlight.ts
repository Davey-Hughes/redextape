import { StateEffect, StateField } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { Decoration, EditorView } from '@codemirror/view'
import { byteIndexAt, byteToIndex } from './spans'
import type { Span } from './types'

/**
 * THE THREE MARKS, AND THE `highlighting` FIELD THAT USED TO SIT ABOVE THEM IS GONE.
 *
 * It was a `StateField` fed a `setSpans` effect carrying `classify_source`'s byte-offset spans, pushed
 * from `main.ts`'s update listener in the same frame as every keystroke. Plan 7 part 3b replaced it
 * with `colour.ts`'s `treeSitterColour` — a `ViewPlugin` over a committed tree-sitter grammar, which
 * needs no effect because it reads the same `ViewUpdate` the editor already hands it, and which serves
 * the λ and TM copies as well as this one. One mechanism across four languages, at the cost of the
 * synchrony: a grammar arrives over a fetch, so the first frame after a mount is uncoloured.
 *
 * WHAT STAYS HERE IS EVERYTHING THAT IS NOT SYNTAX. The three fields below are three other facts about
 * the SOURCE document on three other clocks — a backend's refusal, a click's link, the running focus —
 * and none of them is derivable from a parse tree. They keep the BYTE-offset contract — the one the
 * deleted field shared with them — because they read spans a Rust backend produced, not offsets a
 * parser read back.
 */

/** The source range a backend's refusal names, or `null` to clear it. */
export const setDecline = StateEffect.define<Span | null>()

/**
 * A backend's refusal, marked where it happened.
 *
 * A SEPARATE FIELD FROM THE COLOURER because it changes on a different clock — colouring on every
 * keystroke, this only when a compile comes back. Folding them together would mean recomputing one
 * whenever the other moved. (The colourer is `colour.ts`'s `treeSitterColour` now rather than a field
 * in this file; the clocks are what the argument was ever about.)
 */
export const declineMark = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setDecline)) continue
      const span = e.value
      if (!span) return Decoration.none
      // `sourceSpan` is the same BYTE-offset contract `classify_source` had — see `spans.ts`'s
      // `byteToIndex` doc. Converted before clamping, same as there;
      // the map's own last entry is the document's UTF-16 length, so clamping into the map already
      // clamps into the document.
      const map = byteToIndex(tr.state.doc.toString())
      const from = byteIndexAt(map, span.start)
      const to = byteIndexAt(map, span.end)
      if (from >= to) return Decoration.none
      return Decoration.set([Decoration.mark({ class: 'decline' }).range(from, to)])
    }
    return tr.docChanged ? deco.map(tr.changes) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** The source range a link resolved to, or `null` to clear it. */
export const setLink = StateEffect.define<Span | null>()

/**
 * The construct a click linked, echoed in the source pane.
 *
 * THE ECHO IS WHAT MAKES THE RESOLUTION POLICY LEGIBLE. A click resolves to the innermost node whose
 * span contains it and never walks outward, so the user has to be able to see whether they hit the
 * `x` or the statement containing it. Without this mark the other two panes would light up for a
 * construct the user cannot identify.
 *
 * A SECOND FIELD RATHER THAN A BRANCH IN `declineMark`, for the reason that field states about the
 * colourer: these change on different clocks. A decline changes when a compile comes back; a
 * link changes on a click.
 */
export const linkMark = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setLink)) continue
      const span = e.value
      if (!span) return Decoration.none
      // Byte offsets, converted before clamping — the same contract as `setDecline` above, and the
      // same reason: the map's last entry is the document's UTF-16 length, so clamping into the map
      // already clamps into the document.
      const map = byteToIndex(tr.state.doc.toString())
      const from = byteIndexAt(map, span.start)
      const to = byteIndexAt(map, span.end)
      if (from >= to) return Decoration.none
      return Decoration.set([Decoration.mark({ class: 'linked' }).range(from, to)])
    }
    // A DOCUMENT CHANGE CLEARS THE LINK RATHER THAN MAPPING IT. `declineMark` maps, because a decline
    // is still true about the text it named until the next compile contradicts it. A link is a claim
    // about the OTHER two panes, and those are showing the previous compile's term and table — so a
    // mapped link would keep pointing at a highlight that no longer corresponds to anything.
    return tr.docChanged ? Decoration.none : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * The source span the running focus names, tagged with which class to paint, or `null` to clear it.
 * `'coincident'` is not one of `runningFocus`'s two claims (`link.ts`) — it is what `main.ts`'s
 * `draw()` substitutes when the focus names the same node as the pin (`link`), so the two states get
 * one combined look instead of two independently-coloured marks stacked on the same span.
 */
export const setFocus = StateEffect.define<{ span: Span; claim: 'exact' | 'within' | 'coincident' } | null>()

const FOCUS_CLASS: Record<'exact' | 'within' | 'coincident', string> = {
  exact: 'is-focus-exact',
  within: 'is-focus-within',
  coincident: 'is-focus-coincident',
}

/**
 * The construct the CURRENT β-step belongs to, painted as a SECOND LAYER beside `linkMark`'s pin.
 *
 * THE THIRD FIELD, ON THE FOURTH CLOCK — there is one more clock than there are fields here, because
 * the colourer is no longer one of them. It moves on every keystroke, `declineMark` on every compile,
 * `linkMark` on every click; this one moves on every β-step, which is why it is not folded into either
 * of the other two rather than repeating their own "different clocks, different fields" reasoning for
 * a third time.
 *
 * INDEPENDENT OF `linkMark`, NOT GATED ON IT. 5b's own precedent: a direct gesture (a click) does not
 * stop the run, so this field keeps updating on every `draw()` call whether or not a pin is set —
 * suppressing it while a pin is active would turn the highlight off exactly when it is most wanted,
 * when a construct is pinned and the user is waiting for the run to reach it. Both `.linked` and
 * `.is-focus-*` can be painted at once, on different spans or — via `'coincident'` above — the same one.
 */
export const focusMark = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setFocus)) continue
      const value = e.value
      if (!value) return Decoration.none
      // Same byte-offset contract as `linkMark`/`setDecline` above.
      const map = byteToIndex(tr.state.doc.toString())
      const from = byteIndexAt(map, value.span.start)
      const to = byteIndexAt(map, value.span.end)
      if (from >= to) return Decoration.none
      return Decoration.set([Decoration.mark({ class: FOCUS_CLASS[value.claim] }).range(from, to)])
    }
    // SAME RULE AS `linkMark`, same reason: this span is a claim tied to the CURRENT λ frame, which a
    // document edit invalidates immediately (well before the next compile lands) — mapping it through
    // the edit would keep it pointing at text that no longer corresponds to the frame it named.
    return tr.docChanged ? Decoration.none : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
