import { describe, expect, it } from 'vitest'
import { visibleWindow } from '../../src/virtual-list'

// 20 rows of 24px in a 120px viewport: five rows fit exactly.
const w = (scrollTop: number, overscan = 0) => visibleWindow(20, 24, 120, scrollTop, overscan)

describe('visibleWindow', () => {
  it('starts at row 0 at the top, and reports the full scrollable height', () => {
    expect(w(0)).toEqual({ firstIndex: 0, lastIndex: 5, offsetY: 0, totalHeight: 480 })
  })

  it('advances one row per rowHeight of scroll, and offsetY tracks firstIndex', () => {
    expect(w(24)).toEqual({ firstIndex: 1, lastIndex: 6, offsetY: 24, totalHeight: 480 })
    expect(w(48)).toEqual({ firstIndex: 2, lastIndex: 7, offsetY: 48, totalHeight: 480 })
  })

  // A partial scroll must not skip the row it is halfway through.
  it('floors a partial scroll rather than rounding it', () => {
    expect(w(23).firstIndex).toBe(0)
    expect(w(25).firstIndex).toBe(1)
  })

  it('clamps lastIndex at the final row rather than running past the end', () => {
    const end = w(9_999)
    expect(end.lastIndex).toBe(19)
    expect(end.firstIndex).toBeLessThanOrEqual(19)
  })

  it('widens the range by overscan on both sides, clamped at both ends', () => {
    expect(w(0, 3).firstIndex).toBe(0)
    // Baseline window at scrollTop=240 is rows [10, 15] (5 rows exactly fill the 120px viewport,
    // plus the +1 sliver row). Widened by 3 on each side: [7, 18] — 12 rows, matching spanned + 2*overscan.
    expect(w(240, 3)).toMatchObject({ firstIndex: 7, lastIndex: 18 })
  })

  // offsetY must be the top of firstIndex, INCLUDING the overscan rows — a translate computed from
  // the un-overscanned index shifts every row up by overscan * rowHeight.
  it('offsetY is the top of firstIndex after overscan is applied', () => {
    const o = w(240, 3)
    expect(o.offsetY).toBe(o.firstIndex * 24)
  })

  it('reports an empty range for an empty list rather than row 0', () => {
    expect(visibleWindow(0, 24, 120, 0, 0)).toEqual({ firstIndex: 0, lastIndex: -1, offsetY: 0, totalHeight: 0 })
  })

  it('reports exactly one row for a one-row list', () => {
    expect(visibleWindow(1, 24, 120, 0, 4)).toMatchObject({ firstIndex: 0, lastIndex: 0, totalHeight: 24 })
  })

  it('holds at 127,881 rows, which is list60 and the reason this file exists', () => {
    const big = visibleWindow(127_881, 24, 600, 1_000_000, 2)
    expect(big.totalHeight).toBe(3_069_144)
    expect(big.firstIndex).toBe(41_664)
    // EXACT, not `< 40`. A loose bound here would survive an off-by-one in `spanned` — including
    // dropping the `+ 1` sliver row — and pass while describing a different window than the one the
    // formula produces. 26 spanned + 2*2 overscan = 30 rows, so the last index is 29 beyond the first.
    expect(big.lastIndex - big.firstIndex).toBe(29)
  })
})
