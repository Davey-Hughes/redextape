/**
 * Fixed-row-height windowing: a scroll offset in, a row range out.
 *
 * NO LIBRARY AND NO DOM. Design §9 recorded that this ~40-line piece is the same work under any
 * framework, and keeping it as arithmetic is what lets it be tested without a browser — which matters
 * because it IS arithmetic under a shifting offset, the shape 5a-i's reviews found five surviving
 * mutants in.
 *
 * `list60` is 127,881 rows (design §3.1). Nothing here may be linear in `rowCount`.
 */
export type VisibleWindow = {
  firstIndex: number
  /** Inclusive. **`lastIndex < firstIndex` means the range is empty**, which is how an empty list reports. */
  lastIndex: number
  /** The pixel offset of `firstIndex`'s top edge — what the row container is translated by. */
  offsetY: number
  totalHeight: number
}

export function visibleWindow(
  rowCount: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
  overscan: number,
): VisibleWindow {
  if (rowCount <= 0) return { firstIndex: 0, lastIndex: -1, offsetY: 0, totalHeight: 0 }

  const totalHeight = rowCount * rowHeight
  // `+ 1` because a viewport that is an exact multiple of `rowHeight` still shows a sliver of the next
  // row the moment it is scrolled by one pixel.
  const spanned = Math.ceil(viewportHeight / rowHeight) + 1
  // Clamped at BOTH ends: a scrollTop past the content must not put `first` past the last row —
  // there is no row 416 in a 20-row list, and an unclamped `first` there would exceed `lastIndex`,
  // which the type's own convention reads as an empty range when that isn't what's happening.
  const first = Math.min(rowCount - 1, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan))
  const last = Math.min(rowCount - 1, first + spanned + 2 * overscan - 1)
  return { firstIndex: first, lastIndex: last, offsetY: first * rowHeight, totalHeight }
}
