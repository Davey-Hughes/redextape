import { describe, expect, it } from 'vitest'
import {
  FRAME_OVERHEAD_BYTES,
  forkable,
  lambdaFrameBytes,
  MAX_FORK_RULES,
  OWNER_BYTES,
  REDEX_SPAN_BYTES,
  ruleCount,
  SPAN_BYTES,
  tmFrameBytes,
} from '../../src/protocol'
import type { LambdaState, TmProgram, TmState } from '../../src/types'

const lam = (text: string, spans: number): LambdaState => ({
  text,
  spans: Array.from({ length: spans }, (_, i) => [{ start: i, end: i + 1 }, 'Ident'] as const) as LambdaState['spans'],
  cut: null,
  step: 0,
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
  const base: LambdaState = { text: 'ab', spans: [], cut: null, step: 1, redex_span: null, owner: 'None' }

  // This alone cannot tell OWNER_BYTES from a dropped term: the surcharge is flat, so both sides move
  // together and a missing `+ OWNER_BYTES` would still pass. See the computed-total test below for
  // that guarantee.
  it('charges the same for every owner variant, since they are one tagged value', () => {
    const exact: LambdaState = { ...base, owner: { Exact: 3 } }
    const within: LambdaState = { ...base, owner: { Within: 3 } }
    expect(lambdaFrameBytes(exact)).toBe(lambdaFrameBytes(within))
  })

  // THE ONLY REDEX TERM IN THE SUM. The `Path` behind this span is not on the wire (`types.ts`'s
  // `redex_span` doc, and `LambdaState.redex`'s `serde(skip)`), so there is no per-entry term to charge
  // and no sibling test for one. `redex_span` shipped
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
      redex_span: { start: 0, end: 2 },
      owner: { Exact: 3 },
    }
    expect(lambdaFrameBytes(f)).toBe(FRAME_OVERHEAD_BYTES + 2 + REDEX_SPAN_BYTES + OWNER_BYTES)
  })
})

/** A program with exactly `n` rules, spread over ten states so the reduce has something to reduce. */
function programOf(n: number): TmProgram {
  const states = Array.from({ length: 10 }, (_, i) => ({
    name: `q${i}`,
    accept: false,
    rules: [] as TmProgram['states'][number]['rules'],
  }))
  for (let i = 0; i < n; i++) {
    states[i % 10]?.rules.push({ read: [null], write: [null], moves: ['S'], next: 0 })
  }
  return { states, alphabet: ['_'], tapes: 1, width: 4, start: 0 }
}

describe('the fork cap', () => {
  it('counts every rule across every state, not the states', () => {
    expect(ruleCount(programOf(0))).toBe(0)
    expect(ruleCount(programOf(1))).toBe(1)
    expect(ruleCount(programOf(37))).toBe(37)
  })

  it('admits a program at the cap and refuses one rule past it', () => {
    expect(forkable(programOf(MAX_FORK_RULES - 1))).toBe(true)
    expect(forkable(programOf(MAX_FORK_RULES))).toBe(true)
    expect(forkable(programOf(MAX_FORK_RULES + 1))).toBe(false)
  })

  /**
   * A DECLINED LEG IS NOT FORKABLE, AND THE `null` ARM IS WHY THE PREDICATE TAKES A NULLABLE.
   * `compiled` carries `tmProgram: TmProgram | null`, so every caller would otherwise write the same
   * null check beside every call — which is the second place for it to be wrong.
   */
  it('refuses a null program without the caller checking', () => {
    expect(forkable(null)).toBe(false)
  })

  /**
   * THE CAP MUST SIT BETWEEN THE TWO CORPUS PROGRAMS THE DESIGN NAMES (§3.1), AND THIS ASSERTS THE
   * PROPERTY RATHER THAN THE NUMBER. A future re-measurement may move `MAX_FORK_RULES`; moving it
   * outside this interval would silently change which demo programs can be forked at all, which is
   * the fact the figure exists to control.
   */
  it('sits between list20 and list60', () => {
    // **THESE BOUNDS WERE IN THE WRONG UNIT UNTIL TASK 2 MEASURED THEM.** They read 16,250 and 127,881 —
    // list20's LINE count and list60's δ-table ROW count. A row is a state OR a rule (list60 is 33,699
    // states + 94,182 rules = 127,881 exactly), and this constant gates on rules alone.
    expect(MAX_FORK_RULES).toBeGreaterThan(11_802) // list20's rules — must be forkable
    expect(MAX_FORK_RULES).toBeLessThan(94_182) // list60's rules — must be refused
  })
})
