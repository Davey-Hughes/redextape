import { byteIndexAt, byteToIndex } from './spans'
import type { Classified, Span } from './types'

/**
 * Characters of context on each side of a linked construct.
 *
 * A LEGIBILITY NUMBER, NOT A COST ONE, and the difference is why this carries no measurement.
 * `FRAME_BYTES` and the tape radius were measured because they buy speed or memory; this buys only
 * readability, and the corpus it has to read well on runs from a 107-byte term to a 65,536-byte one.
 * Eye-checked at both ends rather than probed.
 */
export const LINK_CONTEXT = 240

export type LambdaWindow = {
  text: string
  spans: Classified
  /** The target's span, rebased into `text`'s coordinates. */
  target: Span
  /**
   * `text`'s byte offset in the FULL `lambdaText`, so a click inside the window can be resolved
   * against the index — which speaks whole-text coordinates and knows nothing about this slice.
   */
  origin: number
  clippedHead: boolean
  clippedTail: boolean
}

/**
 * A readable slice of the step-0 λ term around a linked construct.
 *
 * THE WINDOW ALWAYS BEGINS AT THE TARGET'S START (minus context) AND CLIPS THE TAIL. A target subterm
 * can be most of the term — the root node's span is the whole thing — and a window that opened in the
 * middle of the clicked construct would lie about what was clicked. Clipping the far end is the only
 * direction that cannot mislead.
 *
 * EDGES SNAP OUTWARD TO TOKEN BOUNDARIES, so no name is cut in half. Snapping outward rather than
 * inward means the window can exceed `context` by up to one token on each side, which is the right
 * trade: a fragment of an identifier reads as a different identifier.
 *
 * OFFSETS ARE BYTES throughout, matching `Span` everywhere else — INCLUDING AT THE ONE POINT THIS
 * FUNCTION SLICES `text` ITSELF. `text` is a JS string, so `text.length` is a UTF-16 count and
 * `text.slice` indexes UTF-16 units, while `target`, `spans`, and every offset this function computes
 * are UTF-8 byte offsets — `λ` is 2 bytes and 1 UTF-16 code unit, so a raw `text.slice(start, end)` on
 * byte offsets silently drifts by one index per binder before the slice, both in what it cuts and in
 * where it clamps. (An earlier version of this comment claimed the opposite — that no slicing here
 * could split a character — which was false and is why the bug survived review; see
 * `lambda-window.test.ts`'s non-ASCII fixture.) Every comparison above stays in byte space; only the
 * returned `text` field's construction converts, through `spans.ts`'s `byteToIndex`/`byteIndexAt` —
 * the same map `decorationRanges` and `declineMark`/`linkMark` already use for the same reason.
 */
export function lambdaWindow(text: string, spans: Classified, target: Span, context: number): LambdaWindow {
  if (text === '') {
    return { text: '', spans: [], target: { start: 0, end: 0 }, origin: 0, clippedHead: false, clippedTail: false }
  }
  const map = byteToIndex(text)
  const byteLength = map.length - 1
  const wantStart = Math.max(0, target.start - context)
  const wantEnd = Math.min(byteLength, Math.max(target.start, target.end) + context)

  let start = wantStart
  let end = wantEnd
  for (const [s] of spans) {
    if (s.start < wantStart && s.end > wantStart) start = Math.min(start, s.start)
    if (s.start < wantEnd && s.end > wantEnd) end = Math.max(end, s.end)
  }
  start = Math.max(0, Math.min(start, target.start))
  end = Math.min(byteLength, Math.max(end, Math.min(target.end, start + 1)))

  const out: Classified = []
  for (const [s, cls] of spans) {
    if (s.end <= start || s.start >= end) continue
    out.push([{ start: Math.max(s.start, start) - start, end: Math.min(s.end, end) - start }, cls])
  }
  return {
    text: text.slice(byteIndexAt(map, start), byteIndexAt(map, end)),
    spans: out,
    target: { start: target.start - start, end: Math.min(target.end, end) - start },
    origin: start,
    clippedHead: start > 0,
    clippedTail: end < byteLength,
  }
}
