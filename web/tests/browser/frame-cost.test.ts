import { describe, expect, it } from 'vitest'
import init, { compile } from '../../../pkg/redextape_wasm.js'
import { FRAME_BYTES, lambdaFrameBytes, SPAN_BYTES } from '../../src/protocol'
import type { Cut, LambdaState } from '../../src/types'

/**
 * `SPAN_BYTES` in `protocol.ts` used to be an estimate — ~76 bytes/span AS JSON, rounded up. The real
 * path is not JSON: `serde_wasm_bindgen` builds a JS object per span, which costs more than its JSON
 * serialization. This file measures THAT cost, in a real browser, the only place it can be measured.
 *
 * `pkg`'s generated declarations type every method's return as `any` — same reason `shapes.test.ts`
 * declares `Session` structurally rather than trusting the import.
 */
type Session = {
  stepLambda(): boolean
  lambdaState(byteBudget: number): LambdaState
  free(): void
}

/**
 * `performance.memory` is Chromium-only and non-standard, so it is not in TS's DOM lib. The cast is
 * kept local to this file rather than becoming a global declaration in `types.ts`.
 */
type MemoryPerformance = Performance & { memory?: { usedJSHeapSize: number } }

/**
 * Picked to produce many spans over many steps, so the per-span signal is large relative to GC and
 * array-quantization noise: 470 β-steps at ~130 spans/frame is ~61,000 spans total, which at any
 * plausible per-span cost is megabytes — comfortably above the noise floor of a single heap reading.
 */
const SRC = 'let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc'

/**
 * The frames dropped from the slimmed run: same frame, `spans` removed. `step`/`text`/`cut`
 * stay, so array length, string data and object-shape overhead are present in BOTH runs and cancel
 * out of the differential — only `spans` differs.
 */
type SlimFrame = { step: number; text: string; cut: Cut | null }

/**
 * Steps a fresh session to completion AT `FRAME_BYTES` — the budget frames actually render at, not
 * `LAMBDA_BYTE_BUDGET` — recording every frame with `pick`. Returns the recorded frames and the total
 * span count, counted from the full state regardless of what `pick` keeps, so run A and run B report
 * the identical total.
 */
function stepAll<T>(pick: (st: LambdaState) => T): { frames: T[]; totalSpans: number } {
  const { session } = compile(SRC, 'unary') as { session: Session | null }
  if (!session) throw new Error('compile declined the λ leg for the probe program')
  const frames: T[] = []
  let totalSpans = 0
  let st = session.lambdaState(FRAME_BYTES)
  for (;;) {
    totalSpans += st.spans.length
    frames.push(pick(st))
    if (!session.stepLambda()) break
    st = session.lambdaState(FRAME_BYTES)
  }
  session.free()
  return { frames, totalSpans }
}

describe('frame cost', () => {
  it('measures bytes per (Span, TokenClass) entry by heap differential, not JSON size', async () => {
    await init()

    const memory = (performance as MemoryPerformance).memory
    if (!memory) {
      throw new Error('BLOCKED: performance.memory is unavailable in this browser — cannot measure heap size')
    }
    const heapNow = () => (performance as MemoryPerformance).memory?.usedJSHeapSize ?? 0
    if (heapNow() === 0) {
      throw new Error('BLOCKED: performance.memory.usedJSHeapSize reads 0 — cannot measure heap size')
    }

    // Run A: full `LambdaState`, spans included. Run B: the same frames with `spans` dropped. Three of
    // each, ALTERNATING A,B,A,B,A,B — a monotonic drift from unrelated allocation would otherwise be
    // attributed to whichever run went last rather than showing up as noise in both.
    //
    // Every retained array is kept in this outer scope for the whole test, so none of them can be
    // collected before the heap readings that depend on them being alive are taken.
    const retainedFull: LambdaState[][] = []
    const retainedSlim: SlimFrame[][] = []
    const readingsA: number[] = []
    const readingsB: number[] = []
    let totalSpansA = 0
    let totalSpansB = 0

    for (let round = 0; round < 3; round++) {
      const beforeA = heapNow()
      const a = stepAll<LambdaState>((st) => st)
      const afterA = heapNow()
      retainedFull.push(a.frames)
      readingsA.push(afterA - beforeA)
      totalSpansA = a.totalSpans

      const beforeB = heapNow()
      const b = stepAll<SlimFrame>((st) => ({ step: st.step, text: st.text, cut: st.cut }))
      const afterB = heapNow()
      retainedSlim.push(b.frames)
      readingsB.push(afterB - beforeB)
      totalSpansB = b.totalSpans
    }

    // Keep every retained array alive PAST the heap readings above — asserting on `.length` here
    // forces the reference to survive to a point the optimizer cannot prove is dead before the reads.
    for (const frames of retainedFull) expect(frames.length).toBeGreaterThan(0)
    for (const frames of retainedSlim) expect(frames.length).toBeGreaterThan(0)

    expect(totalSpansA).toBe(totalSpansB)

    // The deliverable: every raw reading, visible in test output, not just the derived figure.
    console.log('run A (full LambdaState) heap deltas, bytes:', readingsA)
    console.log('run B (spans dropped) heap deltas, bytes:', readingsB)
    console.log('total spans per run:', totalSpansA)

    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
    const meanA = mean(readingsA)
    const meanB = mean(readingsB)
    const bytesPerSpan = (meanA - meanB) / totalSpansA
    console.log('mean(A):', meanA, 'mean(B):', meanB, 'bytes/span:', bytesPerSpan)

    // A LOOSE SANITY FLOOR, NOT THE MEASURED FIGURE. Pinning this assertion to the number this
    // machine produced would make the test flaky on any other machine; this only catches a broken
    // measurement (a zero or negative delta, a reading in the wrong units). The console output above,
    // not this assertion, is what `SPAN_BYTES` in `protocol.ts` is set from.
    expect(bytesPerSpan).toBeGreaterThan(16)
    expect(bytesPerSpan).toBeLessThan(2000)
  })
})

/**
 * THE HALF `frame_cost_probe` COULD NOT MEASURE. That probe timed the Rust: `print_lambda_capped`
 * plus classification, 4-7 us/step at `FRAME_BYTES`. The real path adds `serde_wasm_bindgen`
 * building a JS object per frame AND PER SPAN, and the probe's headline finding was that spans are
 * ~95% of a frame — so this is where that finding either holds or does not.
 *
 * IT ASSERTS A CEILING, NOT A FIGURE. A timing assertion pinned to one machine is a flaky test; what
 * this protects is the design decision — that recording a frame per step is affordable at all.
 */
describe('frame cost at the boundary', () => {
  it('renders a λ frame in well under a millisecond', async () => {
    await init()
    const { session } = compile(
      'let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc',
      'unary',
    ) as {
      session: Session | null
    }
    expect(session).not.toBeNull()
    if (!session) return

    let frames = 0
    let bytes = 0
    const t0 = performance.now()
    while (session.stepLambda() && frames < 400) {
      const f = session.lambdaState(FRAME_BYTES)
      bytes += lambdaFrameBytes(f)
      frames += 1
    }
    const perFrame = (performance.now() - t0) / Math.max(frames, 1)
    session.free()

    // The number is the point; the assertions below are only a sanity floor.
    console.log(`boundary: ${frames} frames, ${perFrame.toFixed(3)} ms/frame, ${Math.round(bytes / frames)} B/frame`)
    expect(frames).toBeGreaterThan(100)
    expect(perFrame).toBeLessThan(1)
    // `SPAN_BYTES` is the one estimate in `protocol.ts` that is not measured in the units it is spent
    // in. If a frame's real size is wildly under our estimate the ring evicts far too early.
    expect(bytes / frames).toBeGreaterThan(SPAN_BYTES)
  })
})
