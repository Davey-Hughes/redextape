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
 * `globalThis.gc`, put there by `--js-flags=--expose-gc` in `vite.config.ts`. Not in TS's DOM lib for
 * the same reason `performance.memory` is not: it does not exist in a browser nobody launched with
 * that flag, and this file is the only place in the tree that wants it.
 */
type GlobalWithGc = typeof globalThis & { gc?: () => void }

/**
 * Picked to produce many spans over many steps, so the per-span signal is large relative to array
 * quantization: 470 β-steps at ~283 spans/frame is 132,882 spans total, which at any plausible
 * per-span cost is megabytes — comfortably above the noise floor of a single heap reading.
 */
const SRC = 'let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc'

/**
 * The frames dropped from the slimmed run: same frame, `spans` removed. `step`/`text`/`cut` stay, so
 * array length, string data and object-shape overhead are present in BOTH runs and cancel out of the
 * differential.
 *
 * NOT ONLY `spans` DIFFERS, AND THE OVER-ATTRIBUTION IS MEASURED RATHER THAN WAVED AT. `redex`,
 * `redex_span` and `owner` are dropped here too, so the differential charges them to spans as well.
 * Measured 2026-08-10 against a third arm that keeps all three and drops only `spans`: 74.08
 * bytes/span with them dropped against 73.63 with them kept — 0.45 bytes, 0.6% of the figure, on a
 * constant that is then rounded up. Dropping them is what keeps this arm a plain object literal with
 * no `LambdaState` shape behind it; paying 0.6% for that is the trade.
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

    // THE READINGS ARE TAKEN AFTER A FULL COLLECTION, AND THAT IS WHAT MAKES THEM A SIZE RATHER THAN A
    // SCHEDULE. `usedJSHeapSize` counts live objects AND garbage the collector has not got to yet, so
    // an uncollected delta across a window is "bytes allocated minus whatever the collector happened
    // to do meanwhile". Both arms allocate the same ~11 MB per round; the whole signal is that arm B's
    // spans become garbage and arm A's do not — which only shows up if the collector runs INSIDE the
    // arm-B window. It is not obliged to.
    //
    // WHEN IT DOES NOT, THE DIFFERENTIAL CAN GO EITHER WAY — this is schedule luck, not a fixed sign.
    // A "nothing collected in either window" model predicts a small, one-directional effect: arm B
    // allocates everything arm A does and then the slim frames on top, so the differential would be
    // -(arm B's slim frames) ≈ -13,607 B / 132,882 spans ≈ -0.1 bytes/span. Observed failures ran
    // 40-55x that magnitude and did not agree on sign. Three runs read -3.955, -4.192 and -5.746
    // bytes/span (500-760 KB of asymmetry) — negative, as the naive model predicts, but far too large
    // for it. A fourth run, paired correctly, does not even agree on sign: 2026-08-10 under
    // `--js-flags=--min-semi-space-size=64` recorded A = [11,339,541, 11,030,920, 11,032,092] and
    // B = [11,058,932, 11,045,332, -25,166,368] (a large collection landing inside arm B's third
    // window) — mean(A) - mean(B) over those matched triples is +91.4 bytes/span, not negative. The
    // same build measured 51.9, 74.6 and 91.4 bytes/span purely by varying V8's GC flags. None of this
    // is "nothing collected" — it is PARTIAL collection landing asymmetrically between the two windows,
    // a regime the model above does not bound and that carries no guaranteed sign. Collecting first
    // removes the variable: every reading below is retained heap, and the figure reproduces TO THE BYTE
    // across browser restarts (9,857,539 for arm A, twice, in the calibration run).
    const collect = (globalThis as GlobalWithGc).gc
    if (typeof collect !== 'function') {
      throw new Error('BLOCKED: globalThis.gc is unavailable — launch Chromium with --js-flags=--expose-gc')
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

    const roundA = (): number => {
      collect()
      const before = heapNow()
      const a = stepAll<LambdaState>((st) => st)
      collect()
      const after = heapNow()
      retainedFull.push(a.frames)
      totalSpansA = a.totalSpans
      return after - before
    }
    const roundB = (): number => {
      collect()
      const before = heapNow()
      const b = stepAll<SlimFrame>((st) => ({ step: st.step, text: st.text, cut: st.cut }))
      collect()
      const after = heapNow()
      retainedSlim.push(b.frames)
      totalSpansB = b.totalSpans
      return after - before
    }

    // ONE DISCARDED PAIR FIRST, and it is not superstition: the first pair pays one-time costs the
    // steady state does not, and it reads 1.5 bytes/span high because of them (75.66 against 74.08,
    // 74.12, 74.08, 74.08 for the four rounds after it — measured 2026-08-10). Its frames are RETAINED
    // rather than dropped, because that is what puts the heap in the state the measured rounds then
    // hold constant; a warm-up whose output is collected would leave the first measured round paying
    // exactly the costs this one exists to absorb.
    roundA()
    roundB()

    for (let round = 0; round < 3; round++) {
      readingsA.push(roundA())
      readingsB.push(roundB())
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

    // THE ONE DIRECTION WITH A CONSEQUENCE, AND IT IS GATED RATHER THAN LEFT TO THE CONSOLE. The two
    // bounds above are symmetric sanity; this one is not. `SPAN_BYTES` is what `lambdaFrameBytes`
    // charges the ring per span, so a real cost ABOVE it means the sizer UNDER-reports and the ring
    // retains more than `HISTORY_BYTES` claims — the failure `protocol.ts`'s "IT WAS 60, AND 60
    // UNDER-REPORTED THE RING BY ~19%" records as having actually happened. Over-reporting merely
    // evicts early, which is why there is no matching floor at `SPAN_BYTES`.
    //
    // NO MORE MACHINE-FRAGILE THAN THE BOUNDS ABOVE. `SPAN_BYTES` is 80 against a measurement of
    // 74.08289058462897, reproducible to the byte across browser restarts under the two Chromium
    // flags `vite.config.ts` sets — an ~8% margin, wider than either the reproducibility of the
    // reading or the rounding that produced the constant.
    expect(bytesPerSpan).toBeLessThanOrEqual(SPAN_BYTES)
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
