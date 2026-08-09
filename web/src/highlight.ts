import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { Decoration, EditorView } from '@codemirror/view'
import { byteIndexAt, byteToIndex, decorationRanges } from './spans'
import type { Classified, Span } from './types'

/** Carries a fresh classification into the editor's state. */
export const setSpans = StateEffect.define<Classified>()

function build(spans: Classified, text: string): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  for (const { from, to, className } of decorationRanges(spans, text)) {
    b.add(from, to, Decoration.mark({ class: className }))
  }
  return b.finish()
}

/**
 * Highlighting via DECORATIONS, not a Lezer grammar.
 *
 * A grammar would be a second authoritative grammar for this language, which the roadmap forbids
 * outright — and it would be redundant, because `classify_source` already ships and already returns
 * the spans. What a grammar would additionally buy (incremental re-parse, bracket matching,
 * structural folding) is not in v1 scope.
 */
export const highlighting = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      // `classify_source` returns BYTE offsets; `decorationRanges` converts them to UTF-16 indices
      // against the actual document text, which is why the whole doc — not just its length — is read
      // here. Passing `tr.state.doc.length` (a UTF-16 count) straight through as if it were a byte
      // budget under-clamped every non-ASCII document by exactly the gap between the two units.
      if (e.is(setSpans)) return build(e.value, tr.state.doc.toString())
    }
    // No fresh classification this transaction: move what we have so it stays attached to its text.
    return tr.docChanged ? deco.map(tr.changes) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** The source range a backend's refusal names, or `null` to clear it. */
export const setDecline = StateEffect.define<Span | null>()

/**
 * A backend's refusal, marked where it happened.
 *
 * A SEPARATE FIELD FROM `highlighting` because it changes on a different clock — highlighting on every
 * keystroke, this only when a compile comes back. Folding them together would mean recomputing one
 * whenever the other moved.
 */
export const declineMark = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setDecline)) continue
      const span = e.value
      if (!span) return Decoration.none
      // `sourceSpan` is the same BYTE-offset contract as `classify_source` — see `highlighting`'s
      // comment above and `spans.ts`'s `byteToIndex` doc. Converted before clamping, same as there;
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
 * A THIRD FIELD RATHER THAN A BRANCH IN `declineMark`, for the reason that field states about
 * `highlighting`: these change on different clocks. A decline changes when a compile comes back; a
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
