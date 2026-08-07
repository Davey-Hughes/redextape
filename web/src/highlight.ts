import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { Decoration, EditorView } from '@codemirror/view'
import { decorationRanges } from './spans'
import type { Classified, Span } from './types'

/// Carries a fresh classification into the editor's state.
export const setSpans = StateEffect.define<Classified>()

function build(spans: Classified, docLength: number): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  for (const { from, to, className } of decorationRanges(spans, docLength)) {
    b.add(from, to, Decoration.mark({ class: className }))
  }
  return b.finish()
}

/// Highlighting via DECORATIONS, not a Lezer grammar.
///
/// A grammar would be a second authoritative grammar for this language, which the roadmap forbids
/// outright — and it would be redundant, because `classify_source` already ships and already returns
/// the spans. What a grammar would additionally buy (incremental re-parse, bracket matching,
/// structural folding) is not in v1 scope.
export const highlighting = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setSpans)) return build(e.value, tr.state.doc.length)
    }
    // No fresh classification this transaction: move what we have so it stays attached to its text.
    return tr.docChanged ? deco.map(tr.changes) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

/// The source range a backend's refusal names, or `null` to clear it.
export const setDecline = StateEffect.define<Span | null>()

/// A backend's refusal, marked where it happened.
///
/// A SEPARATE FIELD FROM `highlighting` because it changes on a different clock — highlighting on every
/// keystroke, this only when a compile comes back. Folding them together would mean recomputing one
/// whenever the other moved.
export const declineMark = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setDecline)) continue
      const span = e.value
      if (!span) return Decoration.none
      const from = Math.min(span.start, tr.state.doc.length)
      const to = Math.min(span.end, tr.state.doc.length)
      if (from >= to) return Decoration.none
      return Decoration.set([Decoration.mark({ class: 'decline' }).range(from, to)])
    }
    return tr.docChanged ? deco.map(tr.changes) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
