import { describe, expect, it } from 'vitest'
import {
  FRAME_OVERHEAD_BYTES,
  lambdaFrameBytes,
  OWNER_BYTES,
  PATH_ENTRY_BYTES,
  REDEX_SPAN_BYTES,
  SPAN_BYTES,
  tmFrameBytes,
} from '../../src/protocol'
import type { LambdaState, TmState } from '../../src/types'

const lam = (text: string, spans: number): LambdaState => ({
  text,
  spans: Array.from({ length: spans }, (_, i) => [{ start: i, end: i + 1 }, 'Ident'] as const) as LambdaState['spans'],
  cut: null,
  step: 0,
  redex: null,
  redex_span: null,
  owner: 'None',
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

describe('lambdaFrameBytes', () => {
  const base: LambdaState = { text: 'ab', spans: [], cut: null, step: 1, redex: null, redex_span: null, owner: 'None' }

  it('charges for the redex path, or the ring under-reports', () => {
    const withPath: LambdaState = { ...base, redex: ['AppL', 'AppR', 'AbsBody'] }
    expect(lambdaFrameBytes(withPath)).toBeGreaterThan(lambdaFrameBytes(base))
  })

  // Stronger than the sibling test above: a flat "some path present" surcharge would also pass a
  // bare `toBeGreaterThan` check. Pinning the delta to `PATH_ENTRY_BYTES` per entry, and checking it
  // doubles when the path doubles, is what catches a charge that does not scale with path length —
  // exactly the kind of miss `SPAN_BYTES`'s sibling test above already guards against for spans.
  it('charges PATH_ENTRY_BYTES per entry, not a flat per-path surcharge', () => {
    const path3: LambdaState = { ...base, redex: ['AppL', 'AppR', 'AbsBody'] }
    const path6: LambdaState = { ...base, redex: ['AppL', 'AppR', 'AbsBody', 'AppL', 'AppR', 'AbsBody'] }
    expect(lambdaFrameBytes(path3) - lambdaFrameBytes(base)).toBe(3 * PATH_ENTRY_BYTES)
    expect(lambdaFrameBytes(path6) - lambdaFrameBytes(path3)).toBe(3 * PATH_ENTRY_BYTES)
  })

  // This alone cannot tell OWNER_BYTES from a dropped term: the surcharge is flat, so both sides move
  // together and a missing `+ OWNER_BYTES` would still pass. See the computed-total test below for
  // that guarantee.
  it('charges the same for every owner variant, since they are one tagged value', () => {
    const exact: LambdaState = { ...base, owner: { Exact: 3 } }
    const within: LambdaState = { ...base, owner: { Within: 3 } }
    expect(lambdaFrameBytes(exact)).toBe(lambdaFrameBytes(within))
  })

  // The mirror of the redex-path test above, for the SPAN that path resolves to. `redex_span` shipped
  // with no term in `lambdaFrameBytes` at all, and the computed-total test below could not catch that:
  // its reference formula listed the same terms the implementation did, so it agreed with a sum that
  // was missing one. Charged only when there IS a span — most frames early in a run have none.
  it('charges for redex_span when the frame has one, and nothing when it does not', () => {
    const withSpan: LambdaState = { ...base, redex_span: { start: 3, end: 9 } }
    expect(lambdaFrameBytes(withSpan) - lambdaFrameBytes(base)).toBe(REDEX_SPAN_BYTES)
    expect(lambdaFrameBytes({ ...base, redex_span: null })).toBe(lambdaFrameBytes(base))
  })

  // A zero-width span is still a span the frame retains — `{ start: 0, end: 0 }` is one object on the
  // heap exactly like any other. A charge derived from the span's WIDTH rather than its existence
  // would pass every assertion above and report this frame as free.
  it('charges by the span existing, not by how wide it is', () => {
    const empty: LambdaState = { ...base, redex_span: { start: 0, end: 0 } }
    const wide: LambdaState = { ...base, redex_span: { start: 0, end: 4096 } }
    expect(lambdaFrameBytes(empty) - lambdaFrameBytes(base)).toBe(REDEX_SPAN_BYTES)
    expect(lambdaFrameBytes(wide)).toBe(lambdaFrameBytes(empty))
  })

  // Asserts against the constants, not a magic number, so a retuned constant does not break this test
  // — but a *term* dropped from the sum (e.g. `+ OWNER_BYTES` silently deleted) does, because the
  // right-hand side is built the same way `lambdaFrameBytes` is documented to compute it.
  //
  // THE FRAME CARRIES EVERY OPTIONAL COMPONENT, which it did not before: `redex_span` was `null` here,
  // so the reference formula had no term for it and could not have noticed that the implementation had
  // none either. A test whose fixture omits a field can only ever be tautological about that field.
  it('charges every component, so a dropped term is visible', () => {
    const f: LambdaState = {
      text: 'ab',
      spans: [],
      cut: null,
      step: 1,
      redex: ['AppL', 'AppR'],
      redex_span: { start: 0, end: 2 },
      owner: { Exact: 3 },
    }
    expect(lambdaFrameBytes(f)).toBe(FRAME_OVERHEAD_BYTES + 2 + 2 * PATH_ENTRY_BYTES + REDEX_SPAN_BYTES + OWNER_BYTES)
  })
})
