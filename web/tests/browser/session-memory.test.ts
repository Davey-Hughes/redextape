import { describe, expect, it } from 'vitest'
import init, { compile, lambdaScratch, tmScratch } from '../../../pkg/redextape_wasm.js'
import { History } from '../../src/history'
import type { RunReply } from '../../src/protocol'
import { FRAME_BYTES, HISTORY_BYTES, lambdaFrameBytes, TM_RADIUS, tmFrameBytes } from '../../src/protocol'
import type { PoolPort, SessionId } from '../../src/session-client'
import { SessionPool } from '../../src/session-client'
import type { LambdaState, TmState } from '../../src/types'

/**
 * PLAN 5d-i T9 — THE MEMORY PROBE. Design §4.4.
 *
 * **A MEASUREMENT, NOT A GATE.** This file produces the numbers that pick one default — the boolean
 * `DROP_HISTORY_ON_UNFOCUS` in `protocol.ts` — and every assertion below is a loose sanity bound
 * chosen to catch a BROKEN measurement (a zero delta, a run that recorded nothing, a reading in the
 * wrong units). None of them pins a measured figure, and none of them encodes the threshold: a probe
 * that failed the build the first time a browser update moved a heap reading two percent would be
 * retired within a week, which is the same fate #28 records for a threshold quietly relaxed. The
 * console output IS the deliverable; the decision it produced is written down where the constant it
 * chose lives.
 *
 * THE THRESHOLD, PRE-REGISTERED BEFORE ANY NUMBER EXISTED (plan T9, design §4.4): *three sessions at
 * four legs must sit at or below 2x the single-session resident figure the same harness measures
 * today.* Above that, `DROP_HISTORY_ON_UNFOCUS` flips to `true`, and the threshold does not move.
 *
 * **MEASURED 2026-08-11, AND IT IS MET: 1.8160189425298086.** `protocol.ts`'s
 * `DROP_HISTORY_ON_UNFOCUS` carries every figure, and the one reading that does NOT clear 2x — the
 * wasm side, which this harness cannot see and the third test below therefore measures separately.
 *
 * THE HARNESS IS `frame-cost.test.ts`'s AND THE DEBTS IT PAID ARE NOT RE-DERIVED HERE — read that
 * file for why `performance.memory` and `globalThis.gc` are typed locally rather than in `types.ts`,
 * why `vite.config.ts:150` passes `--enable-precise-memory-info` and `--js-flags=--expose-gc`, and
 * why a reading taken without a forced collection first is "a schedule, not a size". Three
 * adaptations were forced by the size of what this file retains, and each is documented at its site:
 * the rounds RELEASE rather than accumulate, the release needs a task boundary before a collection
 * can see it, and the warm-up round is discarded rather than kept.
 */

/** See `frame-cost.test.ts`'s type of the same name for why this is local and not in `types.ts`. */
type MemoryPerformance = Performance & { memory?: { usedJSHeapSize: number } }

/** See `frame-cost.test.ts`'s type of the same name. Put here by `--js-flags=--expose-gc`. */
type GlobalWithGc = typeof globalThis & { gc?: () => void }

const heapNow = (): number => (performance as MemoryPerformance).memory?.usedJSHeapSize ?? 0

/**
 * Assert the two non-standard globals exist, and return the collector.
 *
 * IT THROWS `BLOCKED:` RATHER THAN SKIPPING, exactly as `frame-cost.test.ts` does. Without
 * `--enable-precise-memory-info` every heap delta in that file came back as exactly 0 (measured
 * 2026-08-10 by deleting the flag), so a probe that tolerated a missing flag would report a ratio of
 * 0/0 or 1.0 and call the threshold met. A probe that silently reads zeros is worse than no probe.
 */
function requireHeapHarness(): () => void {
  if (!(performance as MemoryPerformance).memory) {
    throw new Error('BLOCKED: performance.memory is unavailable in this browser — cannot measure heap size')
  }
  if (heapNow() === 0) {
    throw new Error('BLOCKED: performance.memory.usedJSHeapSize reads 0 — cannot measure heap size')
  }
  const collect = (globalThis as GlobalWithGc).gc
  if (typeof collect !== 'function') {
    throw new Error('BLOCKED: globalThis.gc is unavailable — launch Chromium with --js-flags=--expose-gc')
  }
  return collect
}

/**
 * THE ONE PROGRAM EVERY SESSION IN THIS FILE RUNS, and it is `app.test.ts`'s history-budget fixture
 * rather than a new one.
 *
 * IT IS THE FIXTURE BECAUSE ITS TM LEG ACTUALLY FILLS THE RING. The measurement is about what
 * `HISTORY_BYTES` costs when it is spent, and almost no program spends it: `frame-cost.test.ts`'s
 * `while4` retains ~6 MB of λ frames and stops. This one reaches the `budget` stop at 75,025 TM
 * frames — the count `app.test.ts:637` records from a worker-only probe, reproduced to the frame by
 * the runs below, which is worth more as a cross-check than a fresh fixture would be worth as
 * novelty. Its λ leg ends naturally at 253 frames and ~6.3 MB, well under the budget, and that
 * asymmetry is itself reported by the second test.
 */
const MAP =
  'fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2, 4].map(add1)'

/** One session's retained history, and what the ring was told each frame cost. */
type Rings = {
  lambda: History<LambdaState> | null
  tm: History<TmState> | null
  /** Bytes the sizers charged, summed over every frame PUSHED — the units `HISTORY_BYTES` is spent in. */
  accounted: { lambda: number; tm: number }
  frames: { lambda: number; tm: number }
}

/** A round's loaded sessions, and the one way to give their memory back. */
type Loaded = {
  rings: Rings[]
  release(): void
}

/** One session slot in a round: which legs it retains, under which id. */
type Slot = { id: SessionId; legs: { lambda: boolean; tm: boolean } }

function realPool(): SessionPool {
  return new SessionPool(
    (): PoolPort => new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' }),
  )
}

/**
 * Bind `id`, run `MAP` on it, and retain the frames for the legs `legs` names — through the REAL
 * `SessionPool`, the REAL `session-worker.ts`, and the REAL `History`, sized and pushed exactly as
 * `main.ts`'s `onReply` does it.
 *
 * A LEG THE SLOT DOES NOT NAME IS RECEIVED AND DROPPED, WHICH IS WHAT MAKES A SCRATCH SIMULABLE.
 * §4.1's `LambdaScratch` has a λ leg and no TM leg; `session-worker.ts` only knows `Session`, and the
 * worker module that would drive a scratch belongs to T7/T8, so this file cannot spawn one. What it
 * can do is retain exactly what a scratch would retain — one ring of the same frame type, filled from
 * the same program — because the quantity this harness measures lives entirely on THIS side of the
 * boundary. The simulation is pessimistic on the far side and exact on the near one: the third test
 * measures what a real `LambdaScratch`/`TmScratch` costs in the worker (65,536 and 0 bytes of wasm
 * against a `Session`'s 3,538,944), so the substitution is quantified rather than waved at.
 */
function record(pool: SessionPool, slot: Slot): { rings: Rings; done: Promise<void> } {
  const rings: Rings = {
    lambda: slot.legs.lambda ? new History<LambdaState>(HISTORY_BYTES) : null,
    tm: slot.legs.tm ? new History<TmState>(HISTORY_BYTES) : null,
    accounted: { lambda: 0, tm: 0 },
    frames: { lambda: 0, tm: 0 },
  }
  let settle: (() => void) | null = null
  const done = new Promise<void>((resolve) => {
    settle = resolve
  })
  const client = pool.bind(slot.id, (r: RunReply) => {
    if (r.kind === 'lambda-frames') {
      for (const f of r.frames) {
        const bytes = lambdaFrameBytes(f)
        rings.frames.lambda += 1
        rings.accounted.lambda += bytes
        rings.lambda?.push(f, bytes)
      }
    } else if (r.kind === 'tm-frames') {
      for (const f of r.frames) {
        const bytes = tmFrameBytes(f)
        rings.frames.tm += 1
        rings.accounted.tm += bytes
        rings.tm?.push(f, bytes)
      }
    } else if (r.kind === 'result' || r.kind === 'no-session' || r.kind === 'worker-error') {
      // TERMINAL IS `result`/`no-session`/`worker-error`, the same rule `pool-isolation.test.ts`'s
      // `open` follows and for the same reason: one generation produces `compiled`, then frame
      // batches, then `result`, so settling on the first reply would measure an empty ring.
      settle?.()
    }
  })
  client.request(client.supersede(), MAP, 'unary')
  return { rings, done }
}

/**
 * Spawn every slot, post every request BEFORE awaiting any of them, and resolve when all have
 * finished.
 *
 * POSTED TOGETHER RATHER THAN IN SEQUENCE, for `pool-isolation.test.ts`'s reason one layer over:
 * three sessions that each finish before the next one starts are three sessions the app never has at
 * once, and the resident figure of a session that has already been released is not the figure this
 * threshold is about.
 */
async function load(slots: Slot[]): Promise<Loaded> {
  const pool = realPool()
  const started = slots.map((s) => record(pool, s))
  await Promise.all(started.map((s) => s.done))
  return {
    rings: started.map((s) => s.rings),
    release() {
      for (const s of slots) pool.unbind(s.id)
    },
  }
}

/** Today: one session, both legs. §3.2b's `SessionLegs` requires both, and the source session has both. */
const ONE_SESSION: Slot[] = [{ id: 'source', legs: { lambda: true, tm: true } }]

/**
 * 5d-i: three sessions, FOUR legs — the source session's two, plus one leg apiece for the two
 * scratchpads (§4.1, and confirmed against the generated `pkg/redextape_wasm.d.ts`: `LambdaScratch`
 * exposes `stepLambda`/`lambdaState` and no TM method, `TmScratch` the mirror image).
 *
 * ALL THREE RUN THE SAME PROGRAM, AND THAT IS THE ONLY UNCONFOUNDED CHOICE. A scratchpad in the
 * shipped app holds whatever the user typed into it, so a "realistic" second program would be a
 * guess — and picking one makes the ratio a statement about the two programs rather than about the
 * leg count. Running `MAP` everywhere makes arm B's retained history EXACTLY twice arm A's by
 * construction (two λ rings with identical contents, two TM rings with identical contents), which is
 * precisely the plan's "four legs = 2x, not 3x" claim expressed as an experiment: if the measured
 * ratio of the retained bytes is not 2, the claim is wrong about something other than counting.
 */
const THREE_SESSIONS: Slot[] = [
  { id: 'source', legs: { lambda: true, tm: true } },
  { id: 'lambda-scratch', legs: { lambda: true, tm: false } },
  { id: 'tm-scratch', legs: { lambda: false, tm: true } },
]

/** One round's readings. `resident` is the absolute heap with the round's sessions alive. */
type Reading = { resident: number; base: number; delta: number; ms: number; kept: number }

/**
 * What a round's rings ended up holding, as plain numbers.
 *
 * NUMBERS AND NOT THE RINGS THEMSELVES, AND THAT IS NOT TIDINESS — IT IS THE MEASUREMENT. A first
 * draft kept the last arm-B round's `Loaded` in an outer variable so the assertions below could read
 * `oldestStep` off it. **`release()` UNBINDS THE WORKERS AND DOES NOT DROP THE RINGS** — only losing
 * the last reference does — so that variable carried ~150 MB of frames into every round that
 * followed, inflating their baselines and dropping the resident ratio from 1.816478530039582 to
 * 1.4135398495945761, `(base + 2C)/(base + C)` falling towards 1 exactly as this file's own model says
 * it must. Summarising to scalars is what makes that impossible to get wrong twice.
 */
type Shape = {
  lambdaFrames: number
  tmFrames: number
  lambdaKept: number | null
  tmKept: number | null
  lambdaEvicted: number | null
  tmEvicted: number | null
  accounted: { lambda: number; tm: number }
}

const shapeOf = (loaded: Loaded): Shape[] =>
  loaded.rings.map((r) => ({
    lambdaFrames: r.frames.lambda,
    tmFrames: r.frames.tm,
    lambdaKept: r.lambda?.length ?? null,
    tmKept: r.tm?.length ?? null,
    lambdaEvicted: r.lambda?.oldestStep ?? null,
    tmEvicted: r.tm?.oldestStep ?? null,
    accounted: r.accounted,
  }))

describe('session memory', () => {
  it('measures three sessions at four legs against one session at two', { timeout: 300_000 }, async () => {
    const collect = requireHeapHarness()

    // THE ROUND'S SESSIONS ARE HELD IN THIS OUTER SCOPE — `frame-cost.test.ts`'s rule, for its
    // reason: nothing measured may be collectable before the reading that depends on it being alive.
    //
    // BUT THEY ARE RELEASED BETWEEN ROUNDS RATHER THAN ACCUMULATED, WHICH IS WHERE THIS FILE PARTS
    // COMPANY WITH THAT ONE. Its rounds retain ~11 MB each, so keeping all seven costs ~77 MB and
    // buys a steady baseline. A round here retains 75 MB (arm A) or 151 MB (arm B); seven of them is
    // ~800 MB of live JS heap, which is a probe that measures V8's behaviour near its heap limit
    // rather than the app's memory. The property that actually matters is preserved — each round's
    // data is alive at its own `resident` reading, and `kept` below reads it AFTERWARDS so no
    // optimizer can prove it dead any earlier.
    //
    // NOTHING OUTSIDE THESE TWO CLOSURES EVER READS `held`, for two reasons that happen to agree.
    // The measurement one is `Shape`'s doc: an outer reference to a round's rings survives every
    // release and poisons every later baseline. The compiler one is that `held`'s only writes are
    // inside a closure, so TS's control-flow analysis still holds the `= null` below at any outer
    // read and narrows the variable to `never` there (TS2339).
    let held: Loaded | null = null
    const releaseHeld = (): void => {
      held?.release()
      held = null
    }

    const round = async (slots: Slot[]): Promise<{ reading: Reading; shape: Shape[] }> => {
      releaseHeld()
      // THE RELEASE NEEDS A TASK BOUNDARY BEFORE A COLLECTION CAN SEE IT, AND THIS WAS MEASURED
      // RATHER THAN ASSUMED. `unbind` deletes the entry and calls `terminate`, but the previous
      // round's frames stayed reachable across two immediate `collect()` calls: with this `await`
      // removed, arm A's `base` read 167,222,632 — the whole of the preceding arm-B round — and its
      // delta came back as -75,368,894. A negative delta is the signature, and it is the same class
      // of error as reading an uncollected heap: the number is real, it just is not a size.
      await new Promise((r) => setTimeout(r, 100))
      // COLLECTED TWICE. One full collection is enough for `frame-cost.test.ts`'s ~11 MB of young
      // objects; these rounds put tens of thousands of frames into old space, and a second pass is
      // cheap insurance against a reading taken one cycle early.
      collect()
      collect()
      const base = heapNow()
      const t0 = performance.now()
      const loaded = await load(slots)
      const ms = performance.now() - t0
      held = loaded
      collect()
      const resident = heapNow()
      // READ AFTER THE READING, DELIBERATELY. This is the keepalive `frame-cost.test.ts` performs
      // with its `expect(frames.length)` loop — a use of the retained objects at a point the
      // optimizer cannot prove is dead before the two heap reads above.
      const kept = loaded.rings.reduce((n, r) => n + (r.lambda?.length ?? 0) + (r.tm?.length ?? 0), 0)
      return { reading: { resident, base, delta: resident - base, ms, kept }, shape: shapeOf(loaded) }
    }

    // ONE DISCARDED WARM-UP PAIR, for `frame-cost.test.ts`'s reason: the first pair pays one-time
    // costs (module fetch and compile in each fresh worker, V8's first-run tiering) that the steady
    // state does not. ITS OUTPUT IS RELEASED RATHER THAN RETAINED, which is the opposite of what that
    // file does — it keeps its warm-up frames precisely to hold the heap in the state its measured
    // rounds then share, and this file cannot afford to hold 151 MB of them. Releasing is consistent
    // here because every round below re-establishes its own `base` from a collected heap, so the
    // measured quantity is a delta from that round's own floor rather than from a shared one.
    console.log('warm-up (one session) :', JSON.stringify((await round(ONE_SESSION)).reading))
    console.log('warm-up (three)       :', JSON.stringify((await round(THREE_SESSIONS)).reading))

    // ALTERNATING A,B,A,B,A,B rather than all-A-then-all-B. A monotonic drift from unrelated
    // allocation would otherwise be charged entirely to whichever arm ran last, instead of appearing
    // as noise in both.
    const one: Reading[] = []
    const three: Reading[] = []
    let lastShape: Shape[] = []
    for (let r = 0; r < 3; r++) {
      const a = await round(ONE_SESSION)
      console.log(`round ${r} one session  :`, JSON.stringify(a.reading))
      one.push(a.reading)
      const b = await round(THREE_SESSIONS)
      console.log(`round ${r} three sessions:`, JSON.stringify(b.reading))
      three.push(b.reading)
      lastShape = b.shape
    }

    console.log('last round ring shape :', JSON.stringify(lastShape))

    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
    const residentOne = mean(one.map((x) => x.resident))
    const residentThree = mean(three.map((x) => x.resident))
    const deltaOne = mean(one.map((x) => x.delta))
    const deltaThree = mean(three.map((x) => x.delta))

    // THE DELIVERABLE. Two readings, and which one the threshold names is not a matter of taste:
    // it says "the single-session RESIDENT figure the same harness measures today", and what this
    // harness measures is `usedJSHeapSize` — an absolute resident heap, page baseline included.
    //
    // THE DELTA IS PRINTED ANYWAY, AND IT IS THE STRICTER OF THE TWO, because a reader is entitled to
    // ask what the answer looks like with the harness's own ~17.0 MB page baseline removed. It comes
    // out at exactly 2 AND HAS NO SIGN AT THIS PRECISION: four runs of this probe read
    // 2.000012445644004, 1.999953682804821, 1.9999763640919819 and 1.99990656956171 — ONE OF THEM
    // ABOVE 2 — straddling it by under a kilobyte in 150 MB while the round-to-round spread of the
    // single-session delta alone is ~7,700 bytes. "At or below 2x" is satisfied by "at", so the
    // verdict does not depend on which of the two readings is taken, which is the only reason it is
    // safe to name one.
    //
    // THE BASELINE IS ALSO WHY THE RESIDENT RATIO IS NOT A CONSTANT OF THE APP. `(base + 2C)/(base + C)`
    // falls towards 1 as `base` grows, and this file's own `init()` in the third test raised the page
    // baseline from ~16.41 MB to ~17.0 MB and moved the ratio from 1.8213397456344755 to
    // 1.816478530039582 and 1.8160189425298086 — the model reproducing itself to three decimals. The
    // shipped app's baseline (CodeMirror, the main-thread wasm module, the DOM) is larger still, so
    // this figure is an upper bound on the app's and the delta reading above is the floor. Both clear
    // the threshold.
    console.log('mean resident: one', residentOne, 'three', residentThree, 'ratio', residentThree / residentOne)
    console.log('mean delta   : one', deltaOne, 'three', deltaThree, 'ratio', deltaThree / deltaOne)
    console.log('threshold 2.0 met (resident):', residentThree / residentOne <= 2)
    console.log('threshold 2.0 met (delta)   :', deltaThree / deltaOne <= 2)

    // SANITY ONLY, AND WIDE ENOUGH TO SURVIVE ANOTHER MACHINE. A ratio near 1 means arm B retained
    // nothing extra — the failure a broken `record` or a settled-too-early promise would produce, and
    // the one that would silently report the threshold met. Above 2.5 means arm B retained something
    // arm A did not, which the construction above says is impossible and would therefore be a bug in
    // the probe rather than a finding about memory. Neither bound is the threshold; see this file's
    // header for why the threshold is not asserted at all.
    const residentRatio = residentThree / residentOne
    expect(residentRatio).toBeGreaterThan(1.5)
    expect(residentRatio).toBeLessThan(2.5)

    // The rounds must actually have recorded, and the TM ring must actually have FILLED — an evicting
    // ring is the only proof that `HISTORY_BYTES` was reached rather than merely allocated, and a
    // measurement of an unfilled budget answers a different question from the one asked.
    expect(deltaOne).toBeGreaterThan(20_000_000)
    for (const r of one) expect(r.kept).toBeGreaterThan(10_000)
    for (const r of three) expect(r.kept).toBeGreaterThan(20_000)
    expect(lastShape).toHaveLength(3)
    expect(lastShape[0]?.tmEvicted ?? 0).toBeGreaterThan(0)
    releaseHeld()
  })

  /**
   * WHAT THE KNOB'S UNITS ARE ACTUALLY WORTH. `HISTORY_BYTES` is spent in `lambdaFrameBytes` and
   * `tmFrameBytes`, and neither is retained heap — they are the ring's own accounting. This measures
   * the exchange rate, one leg at a time, because the two legs do not share one.
   *
   * ONE LEG PER ROUND AND THE OTHER DISCARDED, so each figure is that leg's ring and nothing else.
   * Both arms still run the whole program in the worker; only the retention differs.
   */
  it('measures what a leg of history really costs against what the ring charged it', { timeout: 300_000 }, async () => {
    const collect = requireHeapHarness()
    const LAMBDA_ONLY: Slot[] = [{ id: 'x', legs: { lambda: true, tm: false } }]
    const TM_ONLY: Slot[] = [{ id: 'x', legs: { lambda: false, tm: true } }]

    // Held, released and never read from outside the closures, for the two reasons the previous
    // test's `held` gives — and the first of them, `Shape`'s doc, is the one that would corrupt this
    // measurement rather than merely fail to compile.
    let held: Loaded | null = null
    const releaseHeld = (): void => {
      held?.release()
      held = null
    }
    const round = async (slots: Slot[]): Promise<{ real: number; accounted: number; kept: number }> => {
      releaseHeld()
      await new Promise((r) => setTimeout(r, 100))
      collect()
      collect()
      const base = heapNow()
      const loaded = await load(slots)
      held = loaded
      collect()
      const real = heapNow() - base
      const ring = loaded.rings[0]
      const accounted = (ring?.lambda ? (ring?.accounted.lambda ?? 0) : 0) + (ring?.tm ? (ring?.accounted.tm ?? 0) : 0)
      const kept = (ring?.lambda?.length ?? 0) + (ring?.tm?.length ?? 0)
      console.log(
        `leg=${ring?.lambda ? 'lambda' : 'tm'} real=${real} accounted=${accounted} kept=${kept} evicted=${(ring?.lambda?.oldestStep ?? 0) + (ring?.tm?.oldestStep ?? 0)}`,
      )
      return { real, accounted, kept }
    }

    // One discarded warm-up round per arm, then three alternating pairs — the same discipline as the
    // test above, for the same reason.
    await round(LAMBDA_ONLY)
    await round(TM_ONLY)
    const lam: { real: number; accounted: number }[] = []
    const tm: { real: number; accounted: number }[] = []
    for (let r = 0; r < 3; r++) {
      lam.push(await round(LAMBDA_ONLY))
      tm.push(await round(TM_ONLY))
    }
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
    const lamReal = mean(lam.map((x) => x.real))
    const tmReal = mean(tm.map((x) => x.real))
    const lamAcc = mean(lam.map((x) => x.accounted))
    const tmAcc = mean(tm.map((x) => x.accounted))

    // EACH FIGURE CARRIES ONE POOL, ONE `SessionClient` AND ONE `Worker` HANDLE, MEASURED AT 11,395
    // BYTES on this machine (an extra worker bound, driven to a result, and its frames discarded).
    // Left in rather than subtracted: it is 0.17% of the λ figure and 0.02% of the TM one, and a
    // correction smaller than that is not worth the chance of subtracting it in the wrong place.
    console.log('lambda leg: real', lamReal, 'accounted', lamAcc, 'real/accounted', lamReal / lamAcc)
    console.log('tm     leg: real', tmReal, 'accounted', tmAcc, 'real/accounted', tmReal / tmAcc)

    // Sanity only: a ratio at or near zero means nothing was retained, and one past 5 means the
    // sizers are not measuring the same objects the heap is. The figures themselves are the output,
    // and `HISTORY_BYTES`'s doc in `protocol.ts` is where they are written down.
    for (const ratio of [lamReal / lamAcc, tmReal / tmAcc]) {
      expect(ratio).toBeGreaterThan(0.5)
      expect(ratio).toBeLessThan(5)
    }
    releaseHeld()
  })

  /**
   * THE HALF THE HEAP HARNESS CANNOT SEE, AND IT IS THE HALF THAT CONTRADICTS THE PLAN.
   *
   * `usedJSHeapSize` is a V8 isolate's figure. A worker has its own isolate and its own wasm linear
   * memory, and neither appears in the main thread's reading — measured, not assumed: an extra worker
   * bound and driven to a result moved the main thread's heap by 11,395 bytes, which is the `Worker`
   * handle and its client and nothing else. `performance.measureUserAgentSpecificMemory` is the API
   * that would cross isolates and it is `undefined` here, because it requires cross-origin isolation
   * and `globalThis.crossOriginIsolated` is `false` under Vitest's server (both checked in the same
   * run). So the far side has to be measured in its own units, which is what this does.
   *
   * IT READS `WebAssembly.Memory.buffer.byteLength` FROM ONE MAIN-THREAD MODULE INSTANCE, not from
   * three workers, because a worker's memory cannot be read from outside it without a probe worker
   * and a second protocol. The number that matters survives that simplification: the MODULE BASELINE
   * is paid once per thread, and decision 3 (§4.2, one worker per session) makes three sessions three
   * threads. `HISTORY_BYTES` arithmetic says 2x; this says the process does not.
   *
   * THE ORDER IS DELIBERATE — scratches first, `Session` last. Linear memory grows and never shrinks,
   * so a growth measured after a large allocation can be absorbed by that allocation's slack and read
   * as 0; measuring the two small consumers before the large one keeps their figures from being
   * hidden inside it. `TmScratch` still reads 0, which is the granularity showing through rather than
   * a free lunch: wasm grows in 64 KiB pages, and the machine below fits in what `LambdaScratch`'s
   * page had left.
   */
  it('measures the wasm linear memory a session kind costs, which the heap harness cannot see', async () => {
    const out = await init()
    const bytes = (): number => out.memory.buffer.byteLength
    const held: unknown[] = []

    const baseline = bytes()
    console.log('wasm module baseline after init():', baseline)

    const { scratch: ls } = lambdaScratch('(\\x. x) (\\y. y)') as {
      scratch: { stepLambda(): boolean; lambdaState(b: number): unknown } | null
    }
    if (!ls) throw new Error('BLOCKED: lambdaScratch declined a term the wasm browser tier pins as valid')
    let lambdaSteps = 0
    while (ls.stepLambda() && lambdaSteps < 100_000) {
      ls.lambdaState(FRAME_BYTES)
      lambdaSteps += 1
    }
    const afterLambdaScratch = bytes()
    held.push(ls)
    console.log(`LambdaScratch (${lambdaSteps} steps):`, afterLambdaScratch, 'growth', afterLambdaScratch - baseline)

    // The headerless machine from `crates/redextape-wasm/tests/browser.rs`'s T3 case — one rule, blank
    // tape, `MIN_FIELD_WIDTH`. Small on purpose: this measures a scratch's FLOOR, and the ceiling is
    // whatever the user types.
    const { scratch: ts } = tmScratch(
      'tapes 1\nstart scan\n\nstate scan:\n  [1] -> write [*], move [R], goto scan\n  [*] -> write [1], move [S], goto halt\nstate halt: accept\n',
    ) as { scratch: { stepTm(): boolean; tmState(r: number): unknown } | null }
    if (!ts) throw new Error('BLOCKED: tmScratch declined a machine the wasm browser tier pins as valid')
    let tmSteps = 0
    while (ts.stepTm() && tmSteps < 100_000) {
      ts.tmState(TM_RADIUS)
      tmSteps += 1
    }
    const afterTmScratch = bytes()
    held.push(ts)
    console.log(`TmScratch (${tmSteps} steps):`, afterTmScratch, 'growth', afterTmScratch - afterLambdaScratch)

    const { session } = compile(MAP, 'unary') as {
      session: {
        stepLambda(): boolean
        stepTm(): boolean
        lambdaState(b: number): unknown
        tmState(r: number): unknown
      } | null
    }
    if (!session) throw new Error('BLOCKED: compile declined the probe program')
    const afterCompile = bytes()
    console.log('Session after compile(MAP):', afterCompile, 'growth', afterCompile - afterTmScratch)
    let sessionLambda = 0
    while (session.stepLambda() && sessionLambda < 100_000) {
      session.lambdaState(FRAME_BYTES)
      sessionLambda += 1
    }
    let sessionTm = 0
    while (session.stepTm() && sessionTm < 300_000) {
      session.tmState(TM_RADIUS)
      sessionTm += 1
    }
    const afterStepping = bytes()
    held.push(session)
    console.log(
      `Session after stepping both legs (${sessionLambda} lambda, ${sessionTm} tm):`,
      afterStepping,
      'growth',
      afterStepping - afterCompile,
    )

    const sessionCost = afterStepping - afterTmScratch
    const lambdaScratchCost = afterLambdaScratch - baseline
    const tmScratchCost = afterTmScratch - afterLambdaScratch
    const today = baseline + sessionCost
    const tomorrow = 3 * baseline + sessionCost + lambdaScratchCost + tmScratchCost
    console.log('one worker  (baseline + Session)      :', today)
    console.log('three workers (3*baseline + all three):', tomorrow)
    console.log('wasm ratio:', tomorrow / today)

    // Sanity only. The module has to cost something, a session has to cost more than nothing, and
    // three threads cannot cost less than one — an inversion in any of those means the reading is not
    // measuring what the names say. The ratio is the output and is NOT asserted: it exceeds 2, and
    // the threshold this slice pre-registered is over the heap harness's figure and not this one.
    // `DROP_HISTORY_ON_UNFOCUS`'s doc records the overshoot and why the boolean is not its remedy.
    expect(baseline).toBeGreaterThan(0)
    expect(sessionCost).toBeGreaterThan(0)
    expect(tomorrow).toBeGreaterThan(today)
    expect(held.length).toBe(3)
  })
})
