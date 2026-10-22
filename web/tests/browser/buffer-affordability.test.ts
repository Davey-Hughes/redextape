import { describe, expect, it } from 'vitest'
import init, { compile } from '../../../pkg/redextape_wasm.js'
import { EXAMPLE_ENCODING, EXAMPLES } from '../../src/examples'
import { History } from '../../src/history'
import { asmFrameBytes, FRAME_BYTES, HISTORY_BYTES, lambdaFrameBytes, tmFrameBytes } from '../../src/protocol'
import { MAX_WARM_BUFFERS } from '../../src/scratch'
import type { AsmState, LambdaState, TmProgram, TmState } from '../../src/types'
import { heapNow, requireHeapHarness } from './probe-fixture'

/**
 * THE WORKER-AFFORDABILITY PROBE — 5d-ii-d design §4.6.
 *
 * **THE THRESHOLD, PRE-REGISTERED BEFORE ANY NUMBER EXISTED** (design §4.6): *a page at the cap, with
 * every warm buffer holding a real term and its ring driven to exhaustion, must sit at or below
 * 512 MiB — main-thread resident heap plus summed per-thread wasm linear memory. The cap is the largest
 * count that satisfies it. The threshold does not move.*
 *
 * **A MEASUREMENT, NOT A GATE**, exactly as `session-memory.test.ts` says of itself: every assertion
 * below is a loose sanity bound chosen to catch a BROKEN measurement — a zero delta, a run that
 * recorded nothing, a reading in the wrong units — and none of them pins a measured figure or encodes
 * the threshold. A probe that fails the build the first time a browser update moves a heap reading two
 * percent is retired within a week, which is the fate #28 records for a threshold quietly relaxed.
 * The console output IS the deliverable; the number it chose is written where the constant lives.
 *
 * **EACH RING IS FILLED FROM REAL FRAMES**: `affordability-worker.ts` posts back the frames it builds while
 * stepping the divergent term, capped at `HISTORY_BYTES` charged (~3,200 frames per worker — `protocol.ts`'s
 * `HISTORY_BYTES` doc's own figure for a real λ ring), and `buildRings` pushes those. **THE INTERCEPT IS NOT
 * ZERO**: a real page at the cap also carries a DOM/CodeMirror/main-thread-wasm baseline and a source session
 * with its own module, arena and rings (λ, asm and TM) — none of which any buffer's cost ever included. The
 * intercept below is measured and printed as SEPARATE components, and two derived caps are printed from it —
 * see "THE TWO READINGS" below for what each includes.
 *
 * **A FOURTH SWEEP POINT AT THE CAP ITSELF, TO VERIFY RATHER THAN ONLY EXTRAPOLATE.** Both derived caps come
 * from a two-point marginal fit through n=1 and n=4, projected forward to the cap — an extrapolation, not a
 * reading, and exactly the range where a non-linearity (GC pressure, allocator fragmentation, scheduler
 * contention across a page's worth of concurrent workers) would first show. The sweep below is
 * `[1, 2, 4, MAX_WARM_BUFFERS]`, logged in the same per-round format as the other three; `marginal` and both
 * derived caps are a fit through n=1 and n=4 specifically, found by `n ===`, not by array position, so the
 * fourth point does not quietly move what "derived" means. The at-cap round's OWN `total` — a real reading,
 * not a projection — is then checked directly against the 512 MiB budget under intercept (a), printed
 * alongside what the n=1/n=4 fit would have predicted, so agreement or disagreement between the derived
 * figure and the verified one is stated rather than left for a reader to compute.
 *
 * **HOW TO RUN IT: `pnpm test:probe`. IT IS NOT IN THE DEFAULT SUITE, AND THAT IS DELIBERATE.**
 * `vite.config.ts`'s browser project excludes this file unless `REDEXTAPE_PROBE` is set (`PROBE_FILES`' own
 * doc there has the full argument), so neither `pnpm test` nor `pnpm test:browser` runs it. The reason is
 * this file's own position, in "A MEASUREMENT, NOT A GATE" above: the console output IS the deliverable,
 * and a deliverable nobody reads on every push is pure cost — a cost measured in `MAX_WARM_BUFFERS` real
 * wasm workers and `MAX_WARM_BUFFERS` 32 MiB rings deserialised onto one main thread, roughly half a
 * gigabyte at peak, in a browser project with no `fileParallelism: false` and two other memory-sensitive
 * files (`session-memory.test.ts`, `frame-cost.test.ts`) that could land in the same origin at the same
 * moment. **RUN IT WHENEVER THE CAP, the threshold, the ring budget or the frame accounting changes**,
 * and paste the `n=…` lines into whatever moves the constant — it is the only thing that keeps the cap
 * a measurement.
 */
const BUDGET_BYTES = 512 * 1024 * 1024

/** A term that reduces for a long time — the ring is what is being priced, so it has to be spent. */
const TERM = '(\\f. (\\x. f (x x)) (\\x. f (x x))) (\\g. \\n. g n)'

/**
 * A program whose loop never ends, as `TERM` never ends: the source asm ring is priced full, so its recording has
 * to stop on its allowance and not at its end. The ring is bounded by the bytes it is charged, not the heap its frames
 * hold, so the program priced is the one whose frames held the most heap per charged byte of the programs tried (the
 * roadmap entry on reading (b)'s asm ring lists them).
 */
const ASM_PROGRAM = 'fn main() { let mut i = 0; while true { i = i + 1; } i } main()'

/**
 * **BOTH CASES PRINT THE CAP READING (b) DERIVES UNDER THIS ONE LABEL**, so the two say the same thing: the cap is an
 * upper bound for two reasons, `pageBaseline` being a floor and each source ring being one program's, and it is
 * reference only, since `MAX_WARM_BUFFERS`' doc records that reading (a) is the one that ships.
 */
const READING_B_LABEL =
  "[UPPER BOUND — pageBaseline is a floor, each source ring one program's; REFERENCE ONLY, NOT WHAT SHIPS]"

type WorkerResult = { wasmBytes: number; steps: number; frames: LambdaState[]; held: boolean }

/** Spawn `n` probe workers, drive each, and answer each worker's own wasm bytes, step count and frames. */
async function runWorkers(n: number): Promise<WorkerResult[]> {
  const workers = Array.from(
    { length: n },
    () => new Worker(new URL('./affordability-worker.ts', import.meta.url), { type: 'module' }),
  )
  try {
    return await Promise.all(
      workers.map(
        (w) =>
          new Promise<WorkerResult>((resolve, reject) => {
            w.addEventListener(
              'message',
              (
                e: MessageEvent<{
                  outcome: string
                  message?: string
                  wasmBytes?: number
                  steps?: number
                  frames?: LambdaState[]
                  held?: boolean
                }>,
              ) => {
                if (e.data.outcome !== 'ok') {
                  reject(
                    new Error(
                      `BLOCKED: probe worker answered ${e.data.outcome}${e.data.message ? `: ${e.data.message}` : ''}`,
                    ),
                  )
                  return
                }
                resolve({
                  wasmBytes: e.data.wasmBytes ?? 0,
                  steps: e.data.steps ?? 0,
                  frames: e.data.frames ?? [],
                  held: e.data.held ?? false,
                })
              },
            )
            w.addEventListener('error', () => reject(new Error('BLOCKED: probe worker failed to load')))
            // `messageerror` AS WELL AS `error`: `error` catches a worker that fails to load or throws
            // synchronously; it does NOT fire for a main-thread deserialization failure on the reply
            // itself. A worker-side clone failure posts an `outcome` (the `catch` in
            // `affordability-worker.ts`), but a payload that fails to deserialize on ITS WAY IN — plausible
            // for a large `frames` array — fires `messageerror` here instead, and with nothing listening
            // this test would hang for its whole 300 s timeout.
            w.addEventListener('messageerror', () =>
              reject(new Error('BLOCKED: probe worker reply failed to deserialize (messageerror)')),
            )
            w.postMessage({ src: TERM, steps: 20_000, frameBytes: FRAME_BYTES })
          }),
      ),
    )
  } finally {
    for (const w of workers) w.terminate()
  }
}

/**
 * Build `framesByWorker.length` rings from REAL frames — one worker's own reduction per ring — to
 * `HISTORY_BYTES`, and answer them. No heap reading here: `round` takes it, and its own doc says why.
 *
 * `framesByWorker[i]` are frames worker `i` actually produced stepping the SAME divergent term the wasm
 * reading is measured against, already capped at `HISTORY_BYTES` charged by the worker itself (see
 * `affordability-worker.ts`). Pushing all of them drives this ring to the same exhaustion a real ring
 * reaches — `History#push`'s own eviction trims to the budget as frames land, exactly as it would for a
 * session's real ring.
 *
 * **RETURNS PER-RING `charged` BYTES ALONGSIDE THE RINGS THEMSELVES**, so the caller can print them per ring
 * and, jointly with `frames.length` on the worker side, tell a real λ ring apart from one of featherweight
 * fixture frames — which would still satisfy the 90% guard below (it is a BYTE bound, indifferent to how
 * many frames pay it).
 */
function buildRings(framesByWorker: LambdaState[][]): { rings: History<LambdaState>[]; charged: number[] } {
  const rings: History<LambdaState>[] = []
  const charged: number[] = []
  for (let i = 0; i < framesByWorker.length; i += 1) {
    const frames = framesByWorker[i] ?? []
    const ring = new History<LambdaState>(HISTORY_BYTES)
    let ringCharged = 0
    for (const frame of frames) {
      const bytes = lambdaFrameBytes(frame)
      ring.push(frame, bytes)
      ringCharged += bytes
    }
    // A worker's own stopping rule already targets `HISTORY_BYTES`; a ring left well short of it is
    // not "driven to exhaustion", the pre-registered threshold's own words — so a shortfall here is a
    // broken measurement (e.g. the term stopped reducing before enough frames existed), not merely a
    // smaller one. 90% leaves room for the last frame before the stopping check to overshoot rather
    // than land exactly on the boundary, without tolerating a run that fell meaningfully short.
    if (ringCharged < HISTORY_BYTES * 0.9) {
      throw new Error(
        `BLOCKED: ring ${i} charged only ${ringCharged} of ${HISTORY_BYTES} bytes — not driven to exhaustion`,
      )
    }
    rings.push(ring)
    charged.push(ringCharged)
  }
  return { rings, charged }
}

/**
 * One round's readings: what `n` workers plus their `n` rings cost together, how far each worker
 * actually stepped, and whether each still held its scratch when it answered.
 *
 * **THE "BEFORE" READING IS TAKEN BEFORE `runWorkers` IS EVEN CALLED, AND THAT ORDERING IS
 * LOAD-BEARING, NOT COSMETIC.** `runWorkers` returns only once every worker's `frames` array has already
 * been structured-cloned onto the main thread — that IS the expensive step — so a "before" taken after it
 * would find the frame data it is trying to price already fully resident and already counted in it, and
 * building the ring afterward just copies references into `History`'s own arrays, which costs next to
 * nothing on top of memory that is already live. `session-memory.test.ts`'s own `record()` never has this
 * problem because it pushes each frame into the ring the INSTANT it arrives off the wire, so there is never
 * a separate "received but not yet retained" array for a `before` reading to land after. Reading `before`
 * ahead of `runWorkers` here reproduces that property for a bulk transfer instead of a stream: nothing
 * this round measures exists yet when "before" is taken.
 *
 * **THE TASK BOUNDARY AND DOUBLE COLLECTION LIVE HERE.** The previous round's rings and frame arrays go
 * out of scope the instant `round` returns (nothing outside this function retains them), so they need
 * exactly the boundary `session-memory.test.ts`'s `round` says is necessary before a collection can see
 * them as garbage.
 *
 * `held` IS READ HERE: a worker that answered without holding its scratch is reporting a wasm reading for
 * a buffer that may already be eligible for finalization, which is not "a warm buffer" either.
 */
async function round(
  n: number,
  collect: () => void,
): Promise<{
  wasm: number
  rings: number
  steps: number[]
  held: boolean[]
  ringCharged: number[]
  ringFrames: number[]
  ringRetained: number[]
}> {
  // `setTimeout(100)`, MATCHING `session-memory.test.ts`'s `round` OWN FIGURE. That function's own comment
  // on the same call explains what a task boundary buys here (letting `unbind`'s `terminate()` actually
  // run before a collection tries to see its wreckage as garbage).
  await new Promise((r) => setTimeout(r, 100))
  collect()
  collect()
  const before = heapNow()

  const results = await runWorkers(n)
  const wasm = results.reduce((a, r) => a + r.wasmBytes, 0)
  const steps = results.map((r) => r.steps)
  const held = results.map((r) => r.held)
  const ringFrames = results.map((r) => r.frames.length)
  const { rings: builtRings, charged: ringCharged } = buildRings(results.map((r) => r.frames))

  // TWICE, NOT ONCE, SINCE A λ FRAME'S SPANS ARE A `Uint8Array`: a frame a ring evicted leaves its spans as
  // garbage that one forced collection still counts.
  collect()
  collect()
  const after = heapNow()
  // HELD ACROSS THE READING (the array reference keeps every ring — and therefore every frame it
  // holds — reachable through the `collect()` call above), then released when `round` returns. Reading
  // it AFTER `collect()` (rather than before) is what keeps V8's liveness analysis from proving
  // `builtRings` dead — and therefore collectible — one statement early.
  //
  // **WHAT IT CHECKS IS RETAINED FRAME COUNT, BECAUSE A RING COUNT COULD NOT FAIL.** `runWorkers(n)`
  // answers an `n`-element array (`Promise.all` over an `n`-array), and `buildRings` pushes exactly one
  // ring per element and throws before pushing a short one, so `builtRings.length === n` by construction.
  // RETAINED FRAME COUNT is the falsifiable quantity in the same place: it is what survives
  // `History#push`'s eviction, which the 90%-exhaustion gate inside `buildRings` cannot see (that gate
  // counts bytes CHARGED, before eviction), and it is the number that decides whether the `rings` heap
  // delta above is pricing anything at all. A ring that charged to budget and then evicted everything
  // would pass every other check in this file and read as a collapsed `rings` figure with no explanation.
  const ringRetained = builtRings.map((r) => r.length)
  const retainedTotal = ringRetained.reduce((a, b) => a + b, 0)
  if (retainedTotal < n) {
    throw new Error(`BLOCKED: ${n} rings retained ${retainedTotal} frames between them after eviction`)
  }
  return { wasm, rings: after - before, steps, held, ringCharged, ringFrames, ringRetained }
}

/**
 * The source session's asm ring driven to exhaustion: `affordability-asm-worker.ts` records `ASM_PROGRAM`'s asm leg to
 * `HISTORY_BYTES` charged, and the ring is built from its frames and read as `round` reads a λ ring, after two
 * collections, with the reply's frame array dropped first because the page keeps no array of a reply's frames.
 *
 * **THE RING IS REFUSED BEFORE THE READING UNLESS IT IS FULL**: a recording charged under `HISTORY_BYTES` ended before
 * its allowance, so its ring is not the exhausted one reading (b) prices, and the reading would price a smaller one.
 */
async function sourceAsmRing(
  collect: () => void,
): Promise<{ ring: number; steps: number; run: string; charged: number; retained: number }> {
  await new Promise((r) => setTimeout(r, 100))
  collect()
  collect()
  const before = heapNow()
  type Reply = { outcome: string; message?: string; steps: number; run: string; frames: AsmState[] | null }
  const worker = new Worker(new URL('./affordability-asm-worker.ts', import.meta.url), { type: 'module' })
  let reply: Reply
  try {
    reply = await new Promise<Reply>((resolve, reject) => {
      worker.addEventListener('message', (e: MessageEvent<Reply>) =>
        e.data.outcome === 'ok'
          ? resolve(e.data)
          : reject(new Error(`BLOCKED: asm probe worker answered ${e.data.outcome}: ${e.data.message ?? ''}`)),
      )
      worker.addEventListener('error', () => reject(new Error('BLOCKED: asm probe worker failed to load')))
      worker.addEventListener('messageerror', () =>
        reject(new Error('BLOCKED: asm probe worker reply failed to clone')),
      )
      worker.postMessage({ src: ASM_PROGRAM, encoding: EXAMPLE_ENCODING })
    })
  } finally {
    worker.terminate()
  }
  const ring = new History<AsmState>(HISTORY_BYTES)
  let charged = 0
  for (const f of reply.frames ?? []) {
    const bytes = asmFrameBytes(f)
    ring.push(f, bytes)
    charged += bytes
  }
  reply.frames = null
  expect(
    charged,
    'precondition: the source asm ring is full, its recording stopped on `HISTORY_BYTES`',
  ).toBeGreaterThanOrEqual(HISTORY_BYTES)
  collect()
  collect()
  const after = heapNow()
  // Read after the reading, as `round`'s `ringRetained` is, so the ring is not dead before it.
  const retained = ring.length
  return { ring: after - before, steps: reply.steps, run: reply.run, charged, retained }
}

/**
 * The shipped app's page baseline (DOM, CodeMirror), as a floor: the harness page's baseline that
 * `session-memory.test.ts`'s three-sessions test gives in its `THE DELIVERABLE` block. Not re-measurable
 * here: this file's harness is a bare Vitest browser test page with no CodeMirror and no app DOM, so a live
 * reading of THIS page under-states the real app's. Used as a floor against this file's own live reading
 * below, whichever is larger.
 *
 * **DOES NOT COVER THE MAIN-THREAD WASM MODULE**, and could not: `MAIN_THREAD_WASM_MODULE_BASELINE_BYTES`
 * below is that missing component, counted separately because this figure — a `usedJSHeapSize` reading —
 * structurally cannot include it.
 *
 * **A FLOOR, NOT A MEASURED CEILING.** This is a byte-conversion of the prose figure in
 * `session-memory.test.ts`'s three-sessions test ("~17.0 MB"), not a value this file or that one ever
 * recorded to the byte, and that file says outright which direction the true figure runs: "the shipped
 * app's baseline (CodeMirror, the main-thread wasm module, the DOM) is larger still." Every derived cap
 * below that includes this component is therefore an upper bound on what the page can actually
 * afford — the true safe count can only be at or below it, never above.
 */
const APP_PAGE_BASELINE_FLOOR_BYTES = 17_825_792

/**
 * The module part of the source session's wasm-side fixed cost (`sourceFixedCost` below adds the arena,
 * the next constant), paid once per thread and invisible to `heapNow()` (a worker's own linear memory, per
 * `protocol.ts`'s `DROP_HISTORY_ON_UNFOCUS` doc, which gives the direct measurement this harness cannot
 * take). Not re-derived here: reproducing it needs a real `Session`, not a scratch, read the way
 * `session-memory.test.ts`'s third test reads wasm linear memory.
 */
const SOURCE_WASM_MODULE_BASELINE_BYTES = 8_454_144
/**
 * One worker holding a `Session` for `session-memory.test.ts`'s fixture is 11,993,088 bytes of wasm memory in
 * all; this is that figure less the module floor above.
 */
const SOURCE_SESSION_ARENA_BYTES = 3_538_944

/**
 * AN INTERCEPT COMPONENT OF ITS OWN. The main thread's OWN wasm module instance, paid once per PAGE rather
 * than once per worker thread: `main.ts` calls its own `await init()` on the main thread and uses
 * `captureClasses`/`encodings`/`tokenClasses` from that instance — a full module, distinct from the source
 * worker's and every buffer worker's own instances, each of which already pays this same baseline (the
 * source worker's is folded into `sourceFixedCost` below; a buffer's is inside `marginal`, one per buffer).
 * Same wasm binary, same baseline as `SOURCE_WASM_MODULE_BASELINE_BYTES` — one module, instantiated fresh
 * per thread — so the figure is identical, but it is a SEPARATE thread (the page's own) and therefore a
 * separate line item, not a rename of the constant above.
 *
 * INVISIBLE TO `heapNow()`: `usedJSHeapSize` is one V8 isolate's JS/DOM heap, and `WebAssembly.Memory`'s
 * linear memory is not part of it, on the main thread any more than inside a worker.
 */
const MAIN_THREAD_WASM_MODULE_BASELINE_BYTES = SOURCE_WASM_MODULE_BASELINE_BYTES

/**
 * The λ leg's real-retained-heap-per-charged-byte ratio, the λ row of `protocol.ts`'s `HISTORY_BYTES` doc. The
 * intercept uses the probe's own reading, not this.
 */
const LAMBDA_LEG_RETENTION_RATIO = 0.19451407924488462
/**
 * The TM leg's equivalent, the same doc's TM row.
 */
const TM_LEG_RETENTION_RATIO = 0.8744705880483015

describe('worker affordability', () => {
  it('measures what a warm buffer costs, and derives the cap from the pre-registered budget', {
    timeout: 300_000,
  }, async () => {
    const collect = requireHeapHarness()

    // THE PAGE'S OWN BASELINE, MEASURED. Taken before this file spawns a single worker, after its own
    // task boundary and double collection, for the same reason every other reading in this file gets
    // one. `setTimeout(100)`: see `round`'s own comment on the same call.
    await new Promise((r) => setTimeout(r, 100))
    collect()
    collect()
    const harnessBaseline = heapNow()
    const pageBaseline = Math.max(harnessBaseline, APP_PAGE_BASELINE_FLOOR_BYTES)
    console.log(
      `page baseline — this harness's bare page: ${harnessBaseline}, shipped-app floor: ${APP_PAGE_BASELINE_FLOOR_BYTES}, used: ${pageBaseline}`,
    )

    // ONE DISCARDED WARM-UP ROUND — `session-memory.test.ts`'s warm-up pair gives the reason: the
    // first worker pays a one-time module fetch/compile and V8's first-run tiering the steady state
    // does not, and the first ring-fill pays a JIT warm-up the later ones don't. Discarded rather
    // than kept, because keeping it would let a one-time cost sit inside the very reading (`n=1`)
    // this file's formula reads its marginal cost from.
    console.log('warm-up (n=1), discarded:', JSON.stringify(await round(1, collect)))

    // A MONOTONIC SWEEP, NOT AN ALTERNATING ONE, AND THAT IS THE SHAPE OF THIS MEASUREMENT RATHER
    // THAN A DEPARTURE FROM `session-memory.test.ts`'s DISCIPLINE. A reversed sweep (or any
    // non-monotonic order) would detect exactly the drift `session-memory.test.ts`'s alternation exists
    // to catch, the same way that file's A/B/A/B/A/B does; its concern does not transfer because each
    // round here is SELF-BASELINED — `round`'s own `before` is taken fresh, inside `round`, immediately
    // before that round's workers spawn — so a monotonic absolute-heap drift across the run cannot
    // accumulate into the SLOPE this file fits, the way it can when two ARMS are each read as one
    // absolute `resident` figure and compared directly (`session-memory.test.ts`'s own case). What a
    // residual PER-ROUND drift does instead is inflate that round's own `rings` reading, which moves
    // `marginal` UP and every derived cap DOWN — the conservative direction, never the one that would
    // hide an affordability problem. The printed per-`n` ring readings below are the evidence: `n=2`'s
    // and `n=4`'s ring cost checked against `n=1`'s by division, where near-linearity is what a
    // monotonic sweep free of drift-driven slope error looks like.
    const points: {
      n: number
      wasm: number
      rings: number
      total: number
      steps: number[]
      held: boolean[]
      ringCharged: number[]
      ringFrames: number[]
      ringRetained: number[]
    }[] = []
    for (const n of [1, 2, 4, MAX_WARM_BUFFERS]) {
      const { wasm, rings, steps, held, ringCharged, ringFrames, ringRetained } = await round(n, collect)
      // NEVER RESIDENT SIMULTANEOUSLY, SO SUMMING THEM IS ARITHMETIC. `runWorkers` terminates every
      // worker (`finally` clause) before `buildRings` ever fills a ring, so the wasm reading and
      // the ring reading are never true of the page at the same instant — `total` below is the same
      // kind of arithmetic this probe exists to replace for the intercept, applied honestly to the
      // one place a real N-thread-plus-N-ring reading is not available from a single process. It is
      // the same substitution `DROP_HISTORY_ON_UNFOCUS`'s own probe makes for its wasm side, stated
      // here rather than left for a reader to notice on their own.
      const total = wasm + rings
      points.push({ n, wasm, rings, total, steps, held, ringCharged, ringFrames, ringRetained })
      // `ringRetained` BESIDE `ringFrames` — pushed and survived, printed together, because the gap
      // between them IS `History#push`'s eviction and nothing else in this file's output shows it.
      console.log(
        `n=${n}  wasm=${wasm}  rings=${rings}  total=${total}  steps=${JSON.stringify(steps)}  held=${JSON.stringify(held)}  ringCharged=${JSON.stringify(ringCharged)}  ringFrames=${JSON.stringify(ringFrames)}  ringRetained=${JSON.stringify(ringRetained)}`,
      )
    }

    const first = points[0]
    // `fourth` FOUND BY `n ===`, NOT `points[points.length - 1]`. The sweep's point at `MAX_WARM_BUFFERS`
    // (see this file's header) is there purely to VERIFY the derived cap by direct measurement; letting it
    // silently become `last` here would fold that verification INTO the derivation instead of keeping the
    // two comparable, and the point of the exercise is to compare them. `marginal` and both derived caps
    // below are a fit through n=1 and n=4.
    const fourth = points.find((p) => p.n === 4)
    if (first === undefined || fourth === undefined) throw new Error('BLOCKED: no points measured')

    // MARGINAL COST FROM n=1 AND n=4 rather than a regression, because the three points below the cap do
    // not earn one and the honest question is what each ADDITIONAL buffer costs.
    //
    // WHAT `marginal` DOES NOT CHARGE. Each buffer is also a `Worker` handle plus client that live on the
    // MAIN thread, not inside the worker this probe spawns — measured elsewhere (`protocol.ts`'s
    // `DROP_HISTORY_ON_UNFOCUS` doc, whose own words are "the `Worker` handle and its client and nothing
    // else") at ~11,395 bytes per extra worker bound and driven. A play state and a pane-state entry are
    // real per-buffer main-thread costs too, but neither is inside the 11,395-byte reading. Only the play
    // state lives in `main.ts`'s session registry (`sessions.ts`'s `LegState.playing`), per
    // `session-client.ts`'s `SessionPool` doc's own distinction between what the pool tracks and what the
    // registry does — the pane-state entry does not, it lives in `panes.ts`'s `PaneCollection` instead,
    // not in a `SessionEntry` (`sessions.ts`'s `SessionEntry` has no pane field), and that citation says
    // nothing about it. Neither figure is quantified anywhere in this repo. That is immaterial against
    // `marginal`, but it is real.
    const marginal = (fourth.total - first.total) / (fourth.n - first.n)

    // SOURCE λ RING AT EXHAUSTION — MEASURED DIRECTLY, NOT EXTRAPOLATED.
    // `LAMBDA_LEG_RETENTION_RATIO * HISTORY_BYTES` extrapolates a ratio `protocol.ts`'s `HISTORY_BYTES`
    // doc measured at only 19% of `HISTORY_BYTES` charged up to a full ring — an assumption that
    // retained-bytes-per-charged-byte holds constant across fill level. `first.rings` is a BETTER
    // reading of the same quantity: the n=1 round above drives exactly one worker's ring to exhaustion
    // directly, no extrapolation, no linearity assumption. Both are printed so the agreement is a
    // stated cross-check rather than a hidden assumption.
    const sourceFixedCost = SOURCE_WASM_MODULE_BASELINE_BYTES + SOURCE_SESSION_ARENA_BYTES
    const sourceLambdaRingAtExhaustion = first.rings
    const sourceLambdaRingExtrapolated = LAMBDA_LEG_RETENTION_RATIO * HISTORY_BYTES
    const lambdaRingAgreementPct =
      (Math.abs(sourceLambdaRingAtExhaustion - sourceLambdaRingExtrapolated) / sourceLambdaRingExtrapolated) * 100
    const sourceTmRingAtExhaustion = TM_LEG_RETENTION_RATIO * HISTORY_BYTES
    console.log(
      `source λ ring at exhaustion — measured directly (n=1 round): ${sourceLambdaRingAtExhaustion}, extrapolated from protocol.ts's 19%-fill ratio: ${sourceLambdaRingExtrapolated}, agreement: ${lambdaRingAgreementPct.toFixed(3)}%`,
    )
    // THE RETENTION RATIO, DERIVABLE FROM THIS FILE'S OWN OUTPUT: printed here directly, from the same
    // n=1 round's own `charged` figure, against `protocol.ts`'s recorded constant.
    const firstRingChargedTotal = first.ringCharged.reduce((a, b) => a + b, 0)
    console.log(
      `λ retention ratio (this probe, n=1 round): ${sourceLambdaRingAtExhaustion / firstRingChargedTotal} against protocol.ts's recorded ${LAMBDA_LEG_RETENTION_RATIO}`,
    )

    // SOURCE ASM RING AT EXHAUSTION — MEASURED DIRECTLY, as the λ ring is: no buffer in this file is an asm copy,
    // so no round prices one, and `sourceAsmRing` drives one ring of its own.
    const asm = await sourceAsmRing(collect)
    const sourceAsmRingAtExhaustion = asm.ring
    console.log(
      `source asm ring at exhaustion — measured directly: ${sourceAsmRingAtExhaustion} bytes for ${asm.retained} frames kept of ${asm.steps} steps recorded (run ${asm.run}), ${asm.charged} charged, ${sourceAsmRingAtExhaustion / asm.charged} retained per charged byte`,
    )

    // THE SIX INTERCEPT COMPONENTS. `first.total` alone is a page with ZERO fixed cost: no DOM, no
    // CodeMirror, no main-thread wasm module, and no source session at all, which is not what "a page
    // at the cap" (the threshold's own words) is ever true of. Printed separately rather than folded
    // into one number:
    console.log(`intercept component — page/app baseline: ${pageBaseline}`)
    console.log(`intercept component — main-thread wasm module: ${MAIN_THREAD_WASM_MODULE_BASELINE_BYTES}`)
    console.log(`intercept component — source session fixed cost (module+arena): ${sourceFixedCost}`)
    console.log(`intercept component — source λ ring at exhaustion: ${sourceLambdaRingAtExhaustion}`)
    console.log(`intercept component — source asm ring at exhaustion: ${sourceAsmRingAtExhaustion}`)
    console.log(`intercept component — source TM ring at exhaustion: ${sourceTmRingAtExhaustion}`)

    // THE TWO READINGS. Which one governs `MAX_WARM_BUFFERS` is the project owner's decision; this
    // file prints both, labelled.
    //
    // (a) BUFFERS-ONLY-AT-EXHAUSTION — the literal reading of the threshold's own words, "every warm
    // BUFFER holding a real term and its ring driven to exhaustion". The source session's λ, asm and TM
    // legs are on every page, regardless of how many buffers exist, but they are not SIMULTANEOUSLY
    // exhausted the instant a buffer's rings are — the source session is ordinarily mid-recording or
    // idle, not pinned at its own ring cap at the same moment N buffers are all pinned at theirs. This
    // intercept excludes the source session's rings and keeps only its fixed thread cost — but the
    // main-thread wasm module IS included, because that module is paid by the PAGE itself, not by the
    // source session, and is on every page exactly as unconditionally as the DOM and CodeMirror already
    // counted in `pageBaseline`.
    const interceptBuffersOnly = pageBaseline + MAIN_THREAD_WASM_MODULE_BASELINE_BYTES + sourceFixedCost
    // (b) EVERYTHING-AT-EXHAUSTION — the source session's λ, asm and TM rings ALSO driven to exhaustion at
    // the same instant every buffer's ring is, on top of reading (a). The λ and asm rings are read here (the
    // n=1 round's ring and `sourceAsmRing`'s), the TM ring is `TM_LEG_RETENTION_RATIO` of `HISTORY_BYTES`.
    // This is the more conservative reading and the one the pre-registered threshold's wording does not
    // literally require, since the source session's legs are not "buffers". **EACH SOURCE RING IS ONE
    // PROGRAM'S**: a ring is bounded by the bytes it is CHARGED, and how much heap a charged byte holds
    // depends on the program's frames, so a program whose frames hold more would lower this cap — on top
    // of `pageBaseline` being a floor (below), the second reason it is an upper bound.
    const interceptEverything =
      interceptBuffersOnly + sourceLambdaRingAtExhaustion + sourceAsmRingAtExhaustion + sourceTmRingAtExhaustion

    const derivedBuffersOnly = Math.floor((BUDGET_BYTES - interceptBuffersOnly) / marginal)
    const derivedEverything = Math.floor((BUDGET_BYTES - interceptEverything) / marginal)

    console.log(`marginal per buffer: ${marginal}`)
    // BOTH CAPS ARE UPPER BOUNDS, NOT MEASURED CEILINGS. `APP_PAGE_BASELINE_FLOOR_BYTES`'s own doc says
    // which direction `pageBaseline` is wrong in: it is a FLOOR (`APP_PAGE_BASELINE_FLOOR_BYTES` is a
    // byte-conversion of a PROSE figure, not a recorded reading, and `session-memory.test.ts` states
    // outright that the real app's baseline "is larger still"). A floor on one intercept component can
    // only push the TRUE intercept up and the true safe cap DOWN from what is printed below, never up —
    // so both numbers below are upper bounds on what the page can actually afford.
    console.log(
      `derived cap (a) buffers-only-at-exhaustion [UPPER BOUND — pageBaseline is a floor, see above] — intercept=${interceptBuffersOnly}: ${derivedBuffersOnly}`,
    )
    console.log(
      `derived cap (b) everything-at-exhaustion ${READING_B_LABEL} — intercept=${interceptEverything}: ${derivedEverything}`,
    )

    // VERIFICATION AT n = `MAX_WARM_BUFFERS`, THE DERIVED CAP, BY DIRECT MEASUREMENT RATHER THAN
    // EXTRAPOLATION. `atCap.total` is a REAL reading — `MAX_WARM_BUFFERS` wasm workers, each stepping the same
    // divergent term 20,000 times, each ring driven to the same exhaustion every other point's ring
    // was — not a projection of the n=1/n=4 marginal forward to the cap. `predictedTotalAtCap` is
    // what that marginal WOULD have predicted, printed alongside the measurement so agreement (linearity
    // held out to the cap) or disagreement (it didn't) is stated rather than left for a reader to compute
    // by hand. `verifiedGrandTotal` is intercept (a) — the reading that governs, as `MAX_WARM_BUFFERS`'s
    // doc in `scratch.ts` records — plus the at-cap round's own measured total, and `verifiedFitsBudget`
    // compares it to the 512 MiB budget. THIS IS A `console.log`, NOT AN `expect`, for the same reason
    // nothing else in this file gates the build on the 512 MiB figure (see the loose-bounds note below).
    //
    // **THE COUNT IN THIS BLOCK IS INTERPOLATED FROM `MAX_WARM_BUFFERS`, INCLUDING IN THE OUTPUT.**
    // Were the count spelled out, the console output — the thing this file's own header calls THE
    // DELIVERABLE — would start lying the first time the constant moved, which is exactly the gesture
    // this measurement exists to authorise. A report that describes the run it did not do is worse than
    // no report.
    const atCap = points.find((p) => p.n === MAX_WARM_BUFFERS)
    if (atCap === undefined) throw new Error(`BLOCKED: no n=${MAX_WARM_BUFFERS} point measured`)
    // NO INTERCEPT ROUND-TRIP — `predictedTotalAtCap` is what the n=1/n=4 marginal alone predicts for
    // `atCap.n` MORE buffers over the n=1 baseline's own total, which is exactly `marginal * atCap.n`.
    const predictedTotalAtCap = marginal * atCap.n
    const verifiedGrandTotal = interceptBuffersOnly + atCap.total
    const verifiedFitsBudget = verifiedGrandTotal <= BUDGET_BYTES
    console.log(
      `n=${atCap.n} verification — measured total: ${atCap.total} bytes, predicted from n=1/n=4 marginal: ${predictedTotalAtCap.toFixed(2)} bytes, agreement: ${((Math.abs(atCap.total - predictedTotalAtCap) / atCap.total) * 100).toFixed(3)}%`,
    )
    console.log(
      `n=${atCap.n} verification — intercept (a) + measured total: ${verifiedGrandTotal.toFixed(2)} bytes (${(verifiedGrandTotal / (1024 * 1024)).toFixed(2)} MiB), budget: ${BUDGET_BYTES} bytes (512 MiB), fits: ${verifiedFitsBudget}`,
    )

    // THE WASM READING'S NEAR-TOTAL INSENSITIVITY TO THE TERM — worth surfacing rather than leaving
    // to be noticed. `first.wasm` (one worker) sits this many bytes above the bare module baseline
    // after 20,000 divergent β-steps; the module baseline dominates almost completely.
    console.log(
      `wasm growth over module baseline at n=1: ${first.wasm - SOURCE_WASM_MODULE_BASELINE_BYTES} bytes, for a 20,000-step divergent reduction`,
    )

    // LOOSE SANITY BOUNDS ONLY — these catch a measurement that did not happen, never the threshold.
    //
    // THIS FILE ASSERTS NOTHING ABOUT THE 512 MiB BUDGET ABOVE, DELIBERATELY, on `session-memory.test.ts`'s
    // precedent: that file's own header explains why a probe that pins a measured figure — or worse,
    // encodes the threshold it exists to inform — dies the first time a browser update moves a heap
    // reading by a couple of percent, and #28 records what happens when a threshold is quietly relaxed
    // rather than left to bind. Every figure below is checked only for the shape a broken run would
    // fail to have (a zero reading, a non-positive marginal, a non-positive cap, a term that never
    // reduced) — never for the number a correct run happens to produce. The console output above is
    // the deliverable; `MAX_WARM_BUFFERS` is moved by hand.
    expect(first.wasm).toBeGreaterThan(1_000_000)
    expect(marginal).toBeGreaterThan(0)
    expect(derivedBuffersOnly).toBeGreaterThan(0)
    expect(derivedEverything).toBeGreaterThan(0)

    // A SANITY BOUND ON THE RING READING ITSELF: a zero ring delta at every `n` would pass every
    // assertion above (`marginal` stays positive off the wasm term alone). `n` MB is a small fraction of
    // the ring this file measures — loose enough to survive a different Chromium build, but not
    // satisfiable by "nothing was retained".
    for (const p of points) {
      expect(p.rings).toBeGreaterThan(p.n * 1_000_000)
    }
    // The same for the source asm ring, which charged a full `HISTORY_BYTES`: a reading taken after the ring was
    // collected would price nothing and still pass `sourceAsmRing`'s precondition.
    expect(sourceAsmRingAtExhaustion).toBeGreaterThan(HISTORY_BYTES / 10)

    // A LOOSE BOUND ON FRAME COUNT. A ring of featherweight fixture frames (~88 bytes each, ~381,000 of
    // them to reach `HISTORY_BYTES`) would still charge to budget, still pass the ring-bytes bound just
    // above (a BYTE bound, indifferent to frame count), and would show up nowhere but an unwatched shift
    // in `rings`. A real λ ring is ~3,200 frames (`protocol.ts`'s `HISTORY_BYTES`); 50,000 is an order of
    // magnitude above that and an order of magnitude below the fixture's ~381,000 — wide enough to survive
    // term/browser variance, tight enough to catch a ring of fixture frames, and it encodes nothing about
    // the 512 MiB threshold.
    for (const p of points) {
      for (const f of p.ringFrames) {
        expect(f).toBeLessThan(50_000)
      }
    }

    // `steps` IS ASSERTED NON-ZERO: a worker whose term stopped reducing at step 0 — not "holding a real
    // term" — would still shift the wasm reading under 1% and pass every check above.
    for (const p of points) {
      for (const s of p.steps) {
        expect(s).toBeGreaterThan(0)
      }
    }

    // `held` IS PRINTED, NOT ASSERTED. Every worker must have held its scratch at the moment it answered,
    // or its wasm reading is not the reading of a buffer this file can call "warm" — but
    // `expect(h).toBe(true)` CANNOT FAIL: `affordability-worker.ts`'s handler returns early, posting
    // `{ outcome: 'no-scratch' }`, whenever `scratch` is falsy, and `runWorkers` turns any non-`'ok'`
    // outcome into a rejection this test never reaches — so every `held` value that gets here was set by
    // `held = scratch` (truthy) just before it was read back as `held !== null`. `held` is `true` on every
    // reply that gets here BY CONSTRUCTION, not by evidence, so no `expect` on it can ever be red. It is
    // printed per round above (`ringFrames`/`held` inside the `n=…` line) so a future change that
    // decouples the reply from the assignment stays visible in the console output instead of silently
    // reverting to an assertion that cannot fail either way.
  })

  /**
   * **THE COSTLIEST COPY IS A TM COPY, AND THE CASE ABOVE PRICES ONLY λ COPIES.** With a λ frame's spans
   * crossing as bytes, a full λ ring holds 7.9 MB (the source λ ring at exhaustion the case above prints) and a
   * full TM ring 29.3 MB (`protocol.ts`'s `HISTORY_BYTES`), so the marginal above under-prices a page of TM
   * copies. This case prices one the same way: `n` workers, each building a TM copy of `map-fold`'s machine and
   * recording it as `affordability-tm-worker.ts` says, then `n` TM rings from their frames, the wasm and ring
   * readings summed as above, a marginal from n=1 and n=4, the cap reading (a) derives, and the page at
   * `MAX_WARM_BUFFERS` and at one past it printed against the budget; then the cap reading (b) derives, with the
   * source session's rings read as the case above reads them.
   * **PRINTED, NOT ASSERTED**, for this file's header's reason: `MAX_WARM_BUFFERS`' doc reads those two lines
   * and the cap reading (a) derives.
   *
   * **`map-fold` UNDER `binary`, THE COSTLIEST TM COPY OF THE SHIPPED EXAMPLES**, ahead of `map-fold` under
   * `unary` and `fact-12` under `binary`, of one copy of each example under each encoding. Its copy fills a TM
   * history and runs its value run to the end. A copy of a user's own larger machine could cost more: the cap
   * is set by the shipped examples' costliest, and says so.
   */
  it('measures what a warm TM copy costs, and the cap a page of them affords', { timeout: 600_000 }, async () => {
    const collect = requireHeapHarness()
    await init()
    const mapFold = EXAMPLES.find((e) => e.id === 'map-fold')
    if (mapFold === undefined) throw new Error('BLOCKED: no `map-fold` example')
    const made = compile(mapFold.text, 'binary') as { session: { tmText(): string | null; free(): void } | null }
    const src = made.session?.tmText() ?? null
    made.session?.free()
    if (src === null) throw new Error('BLOCKED: the program has no machine text to copy')
    expect(src.length, "precondition: `map-fold`'s machine under `binary`, 1,906,914 units").toBeGreaterThan(1_000_000)

    await new Promise((r) => setTimeout(r, 100))
    collect()
    collect()
    const tmHarnessBaseline = heapNow()
    const pageBaseline = Math.max(tmHarnessBaseline, APP_PAGE_BASELINE_FLOOR_BYTES)
    console.log(
      `TM copy page baseline — this harness after compiling the machine: ${tmHarnessBaseline}, shipped-app floor: ${APP_PAGE_BASELINE_FLOOR_BYTES}, used: ${pageBaseline}`,
    )
    console.log('TM copy warm-up (n=1), discarded:', JSON.stringify(await tmRound(1, collect, src)))
    const points: TmPoint[] = []
    for (const n of [1, 2, 4, MAX_WARM_BUFFERS, MAX_WARM_BUFFERS + 1]) {
      const point = await tmRound(n, collect, src)
      points.push(point)
      console.log(
        `TM n=${n}  wasm=${point.wasm}  rings=${point.rings}  total=${point.total}  steps=${JSON.stringify(point.steps)}  valueRun=${JSON.stringify(point.valueRun)}  valueSteps=${JSON.stringify(point.valueSteps)}  ringRetained=${JSON.stringify(point.ringRetained)}`,
      )
    }
    const first = points.find((p) => p.n === 1)
    const fourth = points.find((p) => p.n === 4)
    const atCap = points.find((p) => p.n === MAX_WARM_BUFFERS)
    const pastCap = points.find((p) => p.n === MAX_WARM_BUFFERS + 1)
    if (first === undefined || fourth === undefined || atCap === undefined || pastCap === undefined) {
      throw new Error('BLOCKED: no points')
    }
    const marginal = (fourth.total - first.total) / (fourth.n - first.n)
    const intercept =
      pageBaseline +
      MAIN_THREAD_WASM_MODULE_BASELINE_BYTES +
      SOURCE_WASM_MODULE_BASELINE_BYTES +
      SOURCE_SESSION_ARENA_BYTES
    const derived = Math.floor((BUDGET_BYTES - intercept) / marginal)
    console.log(`TM copy marginal: ${marginal}`)
    console.log(`TM copy derived cap (a) [UPPER BOUND — pageBaseline is a floor] — intercept=${intercept}: ${derived}`)
    for (const p of [atCap, pastCap]) {
      const total = intercept + p.total
      console.log(
        `TM copy n=${p.n} — intercept (a) + measured total: ${total} bytes (${(total / (1024 * 1024)).toFixed(2)} MiB), budget: ${BUDGET_BYTES} bytes (512 MiB), fits: ${total <= BUDGET_BYTES}`,
      )
    }

    // READING (b), AS THE CASE ABOVE DERIVES IT FOR λ COPIES: intercept (a) plus the source session's λ, asm and TM
    // rings at exhaustion, over this case's marginal. NO ROUND HERE BUILDS A λ RING, so one λ round reads the source
    // λ ring as the case above's n=1 round does; the asm ring is `sourceAsmRing`'s and the TM ring
    // `TM_LEG_RETENTION_RATIO` of `HISTORY_BYTES`, as there. Its cap is an upper bound for the two reasons reading (b)
    // gives there.
    const sourceLambdaRingAtExhaustion = (await round(1, collect)).rings
    const sourceAsmRingAtExhaustion = (await sourceAsmRing(collect)).ring
    const sourceTmRingAtExhaustion = TM_LEG_RETENTION_RATIO * HISTORY_BYTES
    const interceptEverything =
      intercept + sourceLambdaRingAtExhaustion + sourceAsmRingAtExhaustion + sourceTmRingAtExhaustion
    const derivedEverything = Math.floor((BUDGET_BYTES - interceptEverything) / marginal)
    console.log(`TM copy intercept component — page/app baseline: ${pageBaseline}`)
    console.log(`TM copy intercept component — main-thread wasm module: ${MAIN_THREAD_WASM_MODULE_BASELINE_BYTES}`)
    console.log(
      `TM copy intercept component — source session fixed cost (module+arena): ${SOURCE_WASM_MODULE_BASELINE_BYTES + SOURCE_SESSION_ARENA_BYTES}`,
    )
    console.log(`TM copy intercept component — source λ ring at exhaustion: ${sourceLambdaRingAtExhaustion}`)
    console.log(`TM copy intercept component — source asm ring at exhaustion: ${sourceAsmRingAtExhaustion}`)
    console.log(`TM copy intercept component — source TM ring at exhaustion: ${sourceTmRingAtExhaustion}`)
    console.log(`TM copy derived cap (b) ${READING_B_LABEL} — intercept=${interceptEverything}: ${derivedEverything}`)

    // LOOSE SANITY BOUNDS ONLY, for the case above's reasons: a run that did not happen fails them, a correct one of
    // any size passes. Each round's rings hold at least a tenth of `HISTORY_BYTES` a copy, each value run ended, and
    // the source rings reading (b) adds are bounded as the case above bounds them.
    expect(marginal).toBeGreaterThan(0)
    expect(derived).toBeGreaterThan(0)
    expect(derivedEverything).toBeGreaterThan(0)
    expect(sourceLambdaRingAtExhaustion).toBeGreaterThan(1_000_000)
    expect(sourceAsmRingAtExhaustion).toBeGreaterThan(HISTORY_BYTES / 10)
    for (const p of points) {
      expect(p.rings).toBeGreaterThan((p.n * HISTORY_BYTES) / 10)
      for (const r of p.valueRun) expect(r).toBe('Ended')
    }
  })
})

type TmPoint = {
  n: number
  wasm: number
  rings: number
  total: number
  steps: number[]
  valueRun: string[]
  valueSteps: number[]
  ringRetained: number[]
}

/**
 * One TM round: `n` TM-copy workers driven to their end and terminated, then `n` TM rings built from their frames,
 * read the way `round` reads λ rings, after two collections.
 *
 * **WITH WHAT THE PAGE KEEPS FOR EACH COPY BESIDE ITS RING**: `replies.ts`'s `tm-scratch-compiled` arm stores the
 * copy's machine and tape names, and its `tm-value` arm the value run's end, on the copy's session entry, whether or
 * not a view shows it; a `map-fold` machine under `binary` held that way read 4,485,864 bytes a copy, enough that
 * a round that left it out would derive one copy more than the page affords. **THE REPLIES' FRAME ARRAYS ARE
 * DROPPED BEFORE THE READING**: the page pushes a reply's frames into the ring and keeps no array of them.
 */
async function tmRound(n: number, collect: () => void, src: string): Promise<TmPoint> {
  await new Promise((r) => setTimeout(r, 100))
  collect()
  collect()
  const before = heapNow()
  const workers = Array.from(
    { length: n },
    () => new Worker(new URL('./affordability-tm-worker.ts', import.meta.url), { type: 'module' }),
  )
  type Reply = {
    outcome: string
    message?: string
    wasmBytes: number
    steps: number
    valueRun: string
    valueSteps: number
    frames: TmState[] | null
    tmProgram: unknown
    tm: unknown
    tapeNames: unknown
    value: unknown
  }
  let replies: Reply[]
  try {
    replies = await Promise.all(
      workers.map(
        (w) =>
          new Promise<Reply>((resolve, reject) => {
            w.addEventListener('message', (e: MessageEvent<Reply>) =>
              e.data.outcome === 'ok'
                ? resolve(e.data)
                : reject(new Error(`BLOCKED: TM probe worker answered ${e.data.outcome}: ${e.data.message ?? ''}`)),
            )
            w.addEventListener('error', () => reject(new Error('BLOCKED: TM probe worker failed to load')))
            w.addEventListener('messageerror', () =>
              reject(new Error('BLOCKED: TM probe worker reply failed to clone')),
            )
            w.postMessage({ src })
          }),
      ),
    )
  } finally {
    for (const w of workers) w.terminate()
  }
  const ringCharged: number[] = []
  const rings = replies.map((r) => {
    const ring = new History<TmState>(HISTORY_BYTES)
    let charged = 0
    for (const f of r.frames ?? []) {
      const bytes = tmFrameBytes(f)
      ring.push(f, bytes)
      charged += bytes
    }
    r.frames = null
    ringCharged.push(charged)
    return ring
  })
  // **EVERY COPY'S RING IS FULL, OR THE ROUND IS REFUSED BEFORE ITS READING**: the copy the cap is priced on is at
  // rest, holding the ring its recording filled. The worker stops at the first frame that reaches its allowance, so a
  // recording charged under `HISTORY_BYTES` stopped stepping before it, and its ring would price a smaller copy.
  for (const [i, charged] of ringCharged.entries()) {
    expect(
      charged,
      `precondition: TM copy ${i}'s recording stopped on \`HISTORY_BYTES\`, so its ring is full`,
    ).toBeGreaterThanOrEqual(HISTORY_BYTES)
  }
  // The copy's `SessionEntry` fields `replies.ts` sets: `tmProgram` (a `TmCompiled`) and `tmScratch`.
  const entries = replies.map((r) => ({
    tmProgram: { program: r.tmProgram, tapeNames: r.tapeNames, tmText: null, tmResultDecodable: true },
    tmScratch: { status: r.tm, value: r.value },
  }))
  collect()
  collect()
  const after = heapNow()
  // Read after the reading, as `round`'s `ringRetained` is, so neither the rings nor the entries are dead before it.
  const ringRetained = rings.map((r) => r.length)
  // A worker that stopped answering the machine would price a copy without what the page keeps for it, and every
  // other figure here would still read as a copy's.
  if (!entries.every((e) => ((e.tmProgram.program as TmProgram | null)?.states.length ?? 0) > 0)) {
    throw new Error('BLOCKED: a TM probe worker answered no machine')
  }
  const wasm = replies.reduce((a, r) => a + r.wasmBytes, 0)
  return {
    n,
    wasm,
    rings: after - before,
    total: wasm + after - before,
    steps: replies.map((r) => r.steps),
    valueRun: replies.map((r) => r.valueRun),
    valueSteps: replies.map((r) => r.valueSteps),
    ringRetained,
  }
}
