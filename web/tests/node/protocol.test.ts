import { describe, expect, it } from 'vitest'
import { lambdaFrameBytes, SPAN_BYTES, tmFrameBytes } from '../../src/protocol'
import type { LambdaState, TmState } from '../../src/types'

const lam = (text: string, spans: number): LambdaState => ({
  text,
  spans: Array.from({ length: spans }, (_, i) => [{ start: i, end: i + 1 }, 'Ident'] as const) as LambdaState['spans'],
  truncated: false,
  step: 0,
})

const tm = (tapes: number, cells: number): TmState => ({
  state: 0,
  step: 0,
  heads: Array.from({ length: tapes }, () => 0),
  window_start: Array.from({ length: tapes }, () => 0),
  window: Array.from({ length: tapes }, () => Array.from({ length: cells }, () => '_')),
  source_node: null,
  rule: null,
})

describe('frame sizers', () => {
  // `frame_cost_probe` measured ~95% of a λ frame as SPANS, at every text budget: 261 bytes of text
  // serialized to 5,621. A sizer that counted only `text` would under-report by ~20x and the ring
  // would evict far too late.
  it('counts spans, which dominate a λ frame', () => {
    const textOnly = lambdaFrameBytes(lam('x'.repeat(100), 0))
    const withSpans = lambdaFrameBytes(lam('x'.repeat(100), 50))
    expect(withSpans - textOnly).toBe(50 * SPAN_BYTES)
    expect(withSpans).toBeGreaterThan(textOnly * 10)
  })

  it('scales a λ frame with its text', () => {
    expect(lambdaFrameBytes(lam('x'.repeat(200), 0)) - lambdaFrameBytes(lam('x'.repeat(100), 0))).toBe(100)
  })

  it('counts a TM frame by its cells across every tape', () => {
    // Five tapes at radius 40 is at most 5 x 81 cells; the probe measured ~550 bytes a frame there.
    const small = tmFrameBytes(tm(5, 10))
    const large = tmFrameBytes(tm(5, 20))
    expect(large).toBeGreaterThan(small)
    expect(tmFrameBytes(tm(5, 81))).toBeLessThan(2_000)
    // Pin the per-cell weight, not just monotonicity: `cells * 1` instead of `cells * 2` would pass
    // a bigger-input-bigger-number check and silently halve every TM frame's budgeted size.
    expect(tmFrameBytes(tm(5, 20)) - tmFrameBytes(tm(5, 10))).toBe(5 * 10 * 2)
  })

  it('never reports a frame as free', () => {
    expect(lambdaFrameBytes(lam('', 0))).toBeGreaterThan(0)
    expect(tmFrameBytes(tm(0, 0))).toBeGreaterThan(0)
  })
})
