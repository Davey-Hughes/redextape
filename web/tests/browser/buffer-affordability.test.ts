import { describe, expect, it } from 'vitest'
import { History } from '../../src/history'
import { FRAME_BYTES, HISTORY_BYTES, lambdaFrameBytes } from '../../src/protocol'
import { MAX_WARM_BUFFERS } from '../../src/scratch'
import type { LambdaState } from '../../src/types'

/**
 * 5d-ii-d — THE WORKER-AFFORDABILITY PROBE. Design §4.6.
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
 * **FIX ROUND 1 — TWO ERRORS THAT BOTH INFLATED THE FIRST DERIVATION (13), FIXED HERE:**
 *
 * 1. **CRITICAL 1 — the ring is now filled from REAL frames.** The first cut pushed a `fixtureFrame`
 *    (`spans: []`, `owner: 'None'`, ~88 bytes) into the ring instead of using the frames
 *    `affordability-worker.ts` was already building and discarding while stepping the divergent term.
 *    The worker now posts those frames back (capped at `HISTORY_BYTES` charged, so this stays ~3,200
 *    frames per worker — `protocol.ts`'s `HISTORY_BYTES` doc's own figure for a real λ ring — never the ~381,000 the
 *    fixture needed), and `buildRings` pushes those instead of a synthetic stand-in.
 * 2. **CRITICAL 2 — the intercept is no longer zero.** The first cut modelled a page with zero buffers
 *    as costing nothing (`first.total`, the n=1 reading, doubled as both the marginal-cost anchor AND
 *    the fixed cost). A real page at the cap also carries a DOM/CodeMirror/main-thread-wasm baseline
 *    and a source session with its own module, arena and two rings — none of which any buffer's cost
 *    ever included. The intercept below is measured and printed as four SEPARATE components, and two
 *    derived caps are printed from it — see "THE TWO READINGS" below for what each includes and why
 *    this file does not pick between them.
 *
 * Important-severity fixes carried in the same pass: a sanity bound on the ring reading itself (a zero
 * ring delta at every `n` used to pass); `steps` is now logged and asserted non-zero (a term that
 * stopped reducing at step 0 used to pass silently); the forced-collection discipline
 * `session-memory.test.ts`'s `round` established — a task boundary before the double collection that
 * gates the "before" reading (that file's own `round` never puts one before its second, "after"
 * collection either), one discarded warm-up round — is now explicit here instead
 * of borrowed by accident from call order; and the worker's message handler is now exception-safe (see
 * `affordability-worker.ts`'s own header).
 *
 * **FIX ROUND 2 — THE RING HALF WAS CONFIRMED VALID; THESE FIX THE INTERCEPT AND MAKE THE MEASUREMENT
 * SELF-EVIDENT:**
 *
 * 1. **CRITICAL 1 — a fifth intercept component: the main thread's OWN wasm module.** Fix round 1's
 *    "four separate components" counted the source worker's module (`sourceFixedCost`) and each
 *    buffer's module (inside `marginal`), but never the main thread's — `main.ts` calls its own
 *    `await init()` and uses `analyze`/`classifySource`/`encodings`/`tokenClasses` from it, a full
 *    module instance at the same 8,454,144-byte baseline as every other thread's, and `heapNow()`
 *    cannot see it: `usedJSHeapSize` is JS/DOM heap, not wasm linear memory, and
 *    `session-memory.test.ts`'s three-sessions test proves the gap directly (its own `init()` moved that file's page
 *    baseline by ~0.6 MB against this module's 8.06 MiB). `MAIN_THREAD_WASM_MODULE_BASELINE_BYTES`
 *    below is that fifth component, and `APP_PAGE_BASELINE_FLOOR_BYTES`'s doc no longer claims the page
 *    baseline covers it.
 * 2. **IMPORTANT 2 — both derived caps are now printed as explicit upper bounds, not measured
 *    ceilings.** `APP_PAGE_BASELINE_FLOOR_BYTES` is a FLOOR by its own name and `session-memory.test.ts`'s
 *    own words ("the shipped app's baseline... is larger still") — a floor on one intercept component
 *    can only make the true intercept larger and the true safe cap smaller, never the reverse, so a cap
 *    derived from it is an upper bound on what the page can actually afford.
 * 3. **IMPORTANT 3 — per-ring `charged` bytes and frame count are now printed and frame count is
 *    bounded.** Fix round 1 computed `charged` only to gate the 90%-exhaustion guard and never counted
 *    frames at all, so a regression back to featherweight fixture frames (fix round 1's own Critical 1)
 *    would still charge to budget, still pass every existing assertion, and show up only as an
 *    unwatched ~4 MB shift in `rings`. Both are now printed per round and frame count is bounded well
 *    below the fixture's ~381,000 and well above a real ring's ~3,200, closing that regression without
 *    encoding the threshold. This also makes the λ retention ratio (fix round 1's report cross-check
 *    against `protocol.ts`'s recorded figure) printable directly from this file's own output.
 *
 * Minor fixes carried in the same pass (reasoning lives at each site): `sourceLambdaRingAtExhaustion`
 * now uses this probe's own n=1 at-exhaustion reading instead of extrapolating `protocol.ts`'s ratio
 * (measured at 19% fill) up to 100% — the two are printed together as a cross-check; the alternating-
 * rounds comment's stated reason was wrong and is rewritten below; `setTimeout(0)` is now `setTimeout(100)`
 * to match `session-memory.test.ts`'s own figure; a `messageerror` listener now catches a main-thread
 * deserialization failure the same way `error` catches a load failure; `held`'s per-worker `expect` is
 * dropped to a comment because it cannot fail by construction; and the marginal's exclusion of a
 * per-buffer `Worker` handle and its client is now stated (~11,395 bytes/buffer — `protocol.ts`'s `DROP_HISTORY_ON_UNFOCUS` doc's
 * own figure, and ONLY that: that doc's own words are "the `Worker` handle and its client and nothing
 * else", not the play timer or the pane-state entry a prior revision of this comment also named. Only
 * the play timer lives in `main.ts`'s session registry (`sessions.ts`'s `LegState.timer`), per
 * `session-client.ts`'s `SessionPool` doc's own distinction between what the pool tracks and what the registry
 * does; the pane-state entry does not — it lives in `panes.ts`'s `PaneCollection` instead, not in a
 * `SessionEntry` (`sessions.ts`'s `SessionEntry` fields are `id`, `label`, `detached`, `client`, `legs`,
 * `tmProgram` — no pane), and that same `SessionPool` doc says nothing about it. Neither figure is
 * quantified here or anywhere else in this repo.
 *
 * **5d-ii-d T8 — A FOURTH SWEEP POINT AT THE CAP ITSELF, TO VERIFY RATHER THAN ONLY EXTRAPOLATE.** Fix
 * round 2's sweep was `[1, 2, 4]`, and both derived caps came from a two-point marginal fit through n=1
 * and n=4, projected forward to the cap — an extrapolation, not a reading, and exactly the range where a
 * non-linearity (GC pressure, allocator fragmentation, scheduler contention across a page's worth of
 * concurrent workers) would first show. The sweep below is now `[1, 2, 4, MAX_WARM_BUFFERS]`, logged in
 * the same per-round format
 * as the other three; `marginal` and both derived caps are UNCHANGED in how they are computed — still a
 * fit through n=1 and n=4 specifically, found by `n ===`, not by array position, so adding a fourth point
 * does not quietly move what "derived" means. The at-cap round's OWN `total` — a real reading, not a
 * projection — is then checked directly against the 512 MiB budget under intercept (a), printed
 * alongside what the n=1/n=4 fit would have predicted, so agreement or disagreement between the
 * derived figure and the verified one is stated rather than left for a reader to compute.
 * `MAX_WARM_BUFFERS`'s own doc in `scratch.ts` carries the verdict.
 *
 * **HOW TO RUN IT: `pnpm test:probe`. IT IS NOT IN THE DEFAULT SUITE, AND THAT IS DELIBERATE —
 * whole-branch review before merge, finding 5.** `vite.config.ts`'s browser project excludes this file
 * unless `REDEXTAPE_PROBE` is set (that constant's own doc has the full argument), so neither
 * `pnpm test` nor `pnpm test:browser` runs it. The reason is this file's own position, two paragraphs up:
 * the console output IS the deliverable, and a deliverable nobody reads on every push is pure cost — a
 * cost measured in `MAX_WARM_BUFFERS` real wasm workers and `MAX_WARM_BUFFERS` 32 MiB rings deserialised
 * onto one main thread, roughly half a gigabyte at peak, in a browser project with no
 * `fileParallelism: false` and two other memory-sensitive files (`session-memory.test.ts`,
 * `frame-cost.test.ts`) that could land in the same origin at the same moment. This repo's history
 * records a λ probe taking 60 GiB of RAM and all of swap. **RUN IT WHENEVER THE CAP, the threshold, the
 * ring budget or the frame accounting changes**, and paste the `n=…` lines into whatever moves the
 * constant — that is what Task 8 did, and it is the only thing that keeps the cap a measurement.
 */
const BUDGET_BYTES = 512 * 1024 * 1024

/** See `frame-cost.test.ts`'s type of the same name for why this is local and not in `types.ts`. */
type MemoryPerformance = Performance & { memory?: { usedJSHeapSize: number } }
type GlobalWithGc = typeof globalThis & { gc?: () => void }

const heapNow = (): number => (performance as MemoryPerformance).memory?.usedJSHeapSize ?? 0

/** `session-memory.test.ts`'s guard, verbatim in intent: a probe that silently reads zeros is worse than no probe. */
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

/** A term that reduces for a long time — the ring is what is being priced, so it has to be spent. */
const TERM = '(\\f. (\\x. f (x x)) (\\x. f (x x))) (\\g. \\n. g n)'

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
            // MINOR, FIX ROUND 2 — `messageerror` WAS UNHANDLED. `error` catches a worker that fails
            // to load or throws synchronously; it does NOT fire for a main-thread deserialization
            // failure on the reply itself. A worker-side clone failure already posts an `outcome`
            // (`affordability-worker.ts`'s `catch`), but a payload that fails to deserialize on ITS
            // WAY IN — plausible for a ~36 MB `frames` array — fires `messageerror` here instead, and
            // with nothing listening this reproduces the exact 300 s hang Important 4 (fix round 1)
            // closed for the worker side only.
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
 * `HISTORY_BYTES`, and answer them. No heap reading here; see `round`'s own doc for why the timing
 * moved out of this function.
 *
 * **CRITICAL 1's FIX LIVES HERE ON THE BUILDING SIDE.** `framesByWorker[i]` are frames worker `i`
 * actually produced stepping the SAME divergent term the wasm reading is measured against, already
 * capped at `HISTORY_BYTES` charged by the worker itself (see `affordability-worker.ts`). Pushing all
 * of them drives this ring to the same exhaustion a real ring reaches — `History#push`'s own eviction
 * still trims to the budget as frames land, exactly as it would for a session's real ring — rather than
 * the fixture's ~381,000 featherweight frames landing at ~0.93x the byte budget they were charged
 * against.
 *
 * **RETURNS PER-RING `charged` BYTES ALONGSIDE THE RINGS THEMSELVES — Important 3, fix round 2.** Fix
 * round 1 computed `charged` only to gate the 90%-exhaustion throw below and then discarded it; nothing
 * anywhere counted the frames going into a ring. Both numbers are handed back now so the caller can
 * print them per ring and, jointly with `frames.length` on the worker side, tell a real λ ring apart
 * from a regression back to the featherweight fixture this file's fix round 1 replaced — which would
 * still satisfy the 90% guard below (it is a BYTE bound, indifferent to how many frames pay it) and
 * would previously have shown up nowhere.
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
 * LOAD-BEARING, NOT COSMETIC — fix round 1, second pass.** A first version of this fix called
 * `runWorkers` first, then took "before" and built the rings from the frames it got back. That
 * measured almost nothing: `runWorkers` returns only once every worker's `frames` array has already
 * been structured-cloned onto the main thread — that IS the expensive step, and by the time "before"
 * ran, the frame data it was trying to price was already fully resident and already counted in it.
 * Building the ring afterward just copies references into `History`'s own arrays, which costs next to
 * nothing on top of memory that was already live — the observed symptom was a ~90 KB delta for a ring
 * that should cost tens of megabytes. `session-memory.test.ts`'s own `record()` never has this problem
 * because it pushes each frame into the ring the INSTANT it arrives off the wire, so there is never a
 * separate "received but not yet retained" array for a `before` reading to land after. Reading `before`
 * ahead of `runWorkers` here reproduces that property for a bulk transfer instead of a stream: nothing
 * this round measures exists yet when "before" is taken.
 *
 * **THE TASK BOUNDARY AND DOUBLE COLLECTION LIVE HERE FOR THE SAME REASON THEY DID ON THE OLD
 * `ringBytesFor`** — Important 3. The previous round's rings and frame arrays go out of scope the
 * instant `round` returns (nothing outside this function retains them), so they need exactly the
 * boundary `session-memory.test.ts`'s `round` measured as necessary before a collection can see them as
 * garbage: without one, that file's own experiment read a delta of −75,368,894.
 *
 * `held` IS READ HERE, WHERE THE FIRST CUT POSTED IT AND NEVER READ IT BACK — Minor. It folds into the
 * same per-worker structural check `steps` gets in the sweep below: a worker that answered without
 * holding its scratch is reporting a wasm reading for a buffer that may already be eligible for
 * finalization, which is not "a warm buffer" either.
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
  // `setTimeout(100)`, MATCHING `session-memory.test.ts`'s `round` OWN FIGURE — Minor, fix round 2. This
  // used to read `setTimeout(0)`, a weaker boundary than the reference discipline this file's header
  // cites by name; that function's own comment on the same call explains what a task boundary
  // buys here (letting `unbind`'s `terminate()` actually run before a collection tries to see its
  // wreckage as garbage) and nothing in that reasoning is specific to the delay being zero.
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

  collect()
  const after = heapNow()
  // HELD ACROSS THE READING (the array reference keeps every ring — and therefore every frame it
  // holds — reachable through the `collect()` call above), then released when `round` returns. Reading
  // it AFTER `collect()` (rather than before) is what keeps V8's liveness analysis from proving
  // `builtRings` dead — and therefore collectible — one statement early.
  //
  // **THE STATEMENT STAYS AND WHAT IT CHECKS CHANGED, BECAUSE THE OLD CHECK COULD NOT FAIL — whole-branch
  // review before merge, finding 3d.** It read `if (builtRings.length !== n) throw …("round filled … of
  // … rings")`, which is structural: `runWorkers(n)` answers an `n`-element array (`Promise.all` over an
  // `n`-array), `buildRings` pushes exactly one ring per element and throws before pushing a short one,
  // so `builtRings.length === n` by construction and the throw named a state this code cannot be in.
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
 * The shipped app's page baseline (DOM, CodeMirror) — measured by `session-memory.test.ts` (its own
 * third case, and its three-sessions test's `THE DELIVERABLE` block: "the shipped app's baseline... is
 * larger still"), not
 * re-measurable here: this file's harness is a bare Vitest browser test page with no CodeMirror and no
 * app DOM, so a live reading of THIS page under-states the real app's. Used as a floor against this
 * file's own live reading below, whichever is larger.
 *
 * **DOES NOT COVER THE MAIN-THREAD WASM MODULE — CORRECTED, CRITICAL 1, FIX ROUND 2.** This doc used to
 * list "the main-thread wasm module" as part of what this figure covers; it does not, and could not:
 * `session-memory.test.ts`'s three-sessions test is the proof — its own `init()` raised THAT file's page baseline
 * by ~0.6 MB (16.41 MB -> 17.0 MB) against the SAME module's 8,454,144-byte (8.06 MiB) linear-memory
 * baseline, so what `usedJSHeapSize` sees from `init()` is the JS glue around it, not the wasm memory
 * `init()` allocates. `MAIN_THREAD_WASM_MODULE_BASELINE_BYTES` below is that missing component, counted
 * separately because this figure — a `usedJSHeapSize` reading — structurally cannot include it.
 *
 * **A FLOOR, NOT A MEASURED CEILING — Important 2, fix round 2.** This is a byte-conversion of the
 * prose figure in `session-memory.test.ts`'s three-sessions test ("~17.0 MB"), not a value this file or that one ever
 * recorded to the byte, and that file says outright which direction the true figure runs: "the shipped
 * app's baseline (CodeMirror, the main-thread wasm module, the DOM) is larger still." Every derived cap
 * below that includes this component is therefore an upper bound on what the page can actually
 * afford — the true safe count can only be at or below it, never above.
 */
const APP_PAGE_BASELINE_FLOOR_BYTES = 17_825_792

/**
 * The source session's wasm-side fixed cost — module baseline plus arena — paid once per thread and
 * invisible to `heapNow()` (a worker's own linear memory, per `protocol.ts`'s `DROP_HISTORY_ON_UNFOCUS`
 * doc, which measured it directly because this harness cannot). Not re-derived here: reproducing it
 * needs a real `Session`, not a scratch, recorded to the same worker-memory-reading technique that
 * doc's own third test built.
 */
const SOURCE_WASM_MODULE_BASELINE_BYTES = 8_454_144
/** Same doc: one worker holding a `Session` for its probe fixture is 11,993,088 bytes total; this is that figure less the module floor above. */
const SOURCE_SESSION_ARENA_BYTES = 3_538_944

/**
 * THE FIFTH INTERCEPT COMPONENT — CRITICAL 1, FIX ROUND 2. The main thread's OWN wasm module
 * instance, paid once per PAGE rather than once per worker thread: `main.ts` calls its own
 * `await init()` on the main thread and uses `analyze`/`classifySource`/`encodings`/`tokenClasses`
 * from that instance — a full module, distinct from the source worker's and every buffer worker's own
 * instances, each of which already pays this same baseline (the source worker's is folded into
 * `sourceFixedCost` above; a buffer's is inside `marginal`, one per buffer). Same wasm binary, same
 * baseline as `SOURCE_WASM_MODULE_BASELINE_BYTES` — one module, instantiated fresh per thread — so the
 * figure is identical, but it is a SEPARATE thread (the page's own) and therefore a separate line item,
 * not a rename of the constant above.
 *
 * INVISIBLE TO `heapNow()` FOR THE SAME REASON A WORKER'S IS: `usedJSHeapSize` is one V8 isolate's
 * JS/DOM heap; `WebAssembly.Memory`'s linear memory is not part of it, on the main thread any more than
 * inside a worker. `session-memory.test.ts`'s three-sessions test is the proof on the main thread specifically — that
 * file's own `init()` call moved ITS page baseline by only ~0.6 MB (16.41 MB -> 17.0 MB) against this
 * module's 8.06 MiB, so what the heap reading sees is `init()`'s JS glue, not the memory it allocates.
 */
const MAIN_THREAD_WASM_MODULE_BASELINE_BYTES = SOURCE_WASM_MODULE_BASELINE_BYTES

/** The λ leg's real-retained-heap-per-charged-byte ratio, measured by `protocol.ts`'s `HISTORY_BYTES` doc (its λ-leg row). */
const LAMBDA_LEG_RETENTION_RATIO = 1.071921708710566
/** The TM leg's equivalent, from the same doc's TM row. */
const TM_LEG_RETENTION_RATIO = 2.045480413555839

describe('worker affordability', () => {
  it('measures what a warm buffer costs, and derives the cap from the pre-registered budget', {
    timeout: 300_000,
  }, async () => {
    const collect = requireHeapHarness()

    // THE PAGE'S OWN BASELINE, MEASURED — Critical 2's first component. Taken before this file
    // spawns a single worker, after its own task boundary and double collection, for the same reason
    // every other reading in this file gets one. `setTimeout(100)`, not `(0)` — Minor, fix round 2;
    // see `round`'s own comment on the same change.
    await new Promise((r) => setTimeout(r, 100))
    collect()
    collect()
    const harnessBaseline = heapNow()
    const pageBaseline = Math.max(harnessBaseline, APP_PAGE_BASELINE_FLOOR_BYTES)
    console.log(
      `page baseline — this harness's bare page: ${harnessBaseline}, shipped-app floor: ${APP_PAGE_BASELINE_FLOOR_BYTES}, used: ${pageBaseline}`,
    )

    // ONE DISCARDED WARM-UP ROUND — Important 3, `session-memory.test.ts`'s `round` gives the reason: the
    // first worker pays a one-time module fetch/compile and V8's first-run tiering the steady state
    // does not, and the first ring-fill pays a JIT warm-up the later ones don't. Discarded rather
    // than kept, because keeping it would let a one-time cost sit inside the very reading (`n=1`)
    // this file's formula reads its marginal cost from. This is also why the missing warm-up showed
    // up as `n=1`'s per-ring reading running slightly ABOVE `n=4`'s in the pre-fix report: the first
    // fill in a run pays a cost later fills don't, and `n=1` used to be the very first fill.
    console.log('warm-up (n=1), discarded:', JSON.stringify(await round(1, collect)))

    // A MONOTONIC SWEEP, NOT AN ALTERNATING ONE, AND THAT IS THE SHAPE OF THIS MEASUREMENT RATHER
    // THAN A DEPARTURE FROM `session-memory.test.ts`'s DISCIPLINE — CORRECTED, MINOR, FIX ROUND 2.
    // This comment used to argue "reordering [1, 2, 4] would not detect drift, it would just change
    // which point pays for it" — that is FALSE; a reversed sweep (or any non-monotonic order) would
    // detect exactly the drift `session-memory.test.ts`'s alternation exists to catch, the same way
    // that file's A/B/A/B/A/B does. The real reason its concern does not transfer is different: each
    // round here is SELF-BASELINED — `round`'s own `before` is taken fresh, inside `round`, immediately
    // before that round's workers spawn — so a monotonic absolute-heap drift across the run cannot
    // accumulate into the SLOPE this file fits, the way it can when two ARMS are each read as one
    // absolute `resident` figure and compared directly (`session-memory.test.ts`'s own case). What a
    // residual PER-ROUND drift does instead is inflate that round's own `rings` reading, which moves
    // `marginal` UP and every derived cap DOWN — the conservative direction, never the one that would
    // hide an affordability problem. The printed per-`n` ring readings below are the evidence this
    // held: `n=2`'s and `n=4`'s ring cost is checked in the report against `n=1`'s by division, and
    // near-linearity there is what a monotonic sweep free of drift-driven slope error looks like.
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
    // `fourth` FOUND BY `n ===`, NOT `points[points.length - 1]` — 5d-ii-d T8. The sweep grew a fourth
    // point at `MAX_WARM_BUFFERS` (see this file's header) purely to VERIFY the derived cap by direct measurement;
    // letting it silently become `last` here would fold that verification INTO the derivation instead
    // of keeping the two comparable, and the point of the exercise is to compare them. `marginal` and
    // both derived caps below are computed exactly as fix round 2 computed them — a fit through n=1 and
    // n=4 — so the number `MAX_WARM_BUFFERS`'s doc calls "derived" is the same quantity Task 7 reported,
    // not a number quietly recomputed under an unchanged label.
    const fourth = points.find((p) => p.n === 4)
    if (first === undefined || fourth === undefined) throw new Error('BLOCKED: no points measured')

    // MARGINAL COST FROM THE TWO ENDS rather than a fit, because three points do not earn a
    // regression and the honest question is what each ADDITIONAL buffer costs.
    //
    // WHAT `marginal` DOES NOT CHARGE — Minor, fix round 2, corrected 5d-ii-d T8. Each buffer is also a
    // `Worker` handle plus client that live on the MAIN thread, not inside the worker this probe spawns —
    // measured elsewhere (`protocol.ts`'s `DROP_HISTORY_ON_UNFOCUS` doc, whose own words are "the
    // `Worker` handle and its client and nothing else") at ~11,395 bytes per extra worker bound and
    // driven. A prior revision of this comment also named "play-timer and pane-state entry" as part of
    // that figure; both are real per-buffer main-thread costs but neither is inside the 11,395-byte
    // reading. Only the play timer lives in `main.ts`'s session registry (`LegState.timer`,
    // `sessions.ts`'s `LegState.timer`), per `session-client.ts`'s `SessionPool` doc's own distinction between what the pool tracks
    // and what the registry does — the pane-state entry does not, it lives in `panes.ts`'s
    // `PaneCollection` instead, not in a `SessionEntry` (`sessions.ts`'s `SessionEntry` has no pane field), and
    // that citation says nothing about it. Neither figure is quantified anywhere in this repo. That is
    // immaterial against this figure (~44.5 MB) — well under 0.03% — but it is real and this file was
    // silent about it.
    const marginal = (fourth.total - first.total) / (fourth.n - first.n)

    // SOURCE λ RING AT EXHAUSTION — MEASURED DIRECTLY, NOT EXTRAPOLATED — Minor, fix round 2.
    // `LAMBDA_LEG_RETENTION_RATIO * HISTORY_BYTES` extrapolates a ratio `protocol.ts`'s `HISTORY_BYTES` doc measured at
    // only 19% of `HISTORY_BYTES` charged (6,343,013 of 33,554,432) up to a full ring — an assumption
    // that retained-bytes-per-charged-byte holds constant across fill level. `first.rings` is a BETTER
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
    // THE RETENTION RATIO, DERIVABLE FROM THIS FILE'S OWN OUTPUT — Important 3's second effect. Fix
    // round 1's report computed this by hand outside this file, against `protocol.ts`'s recorded
    // constant; it is now printed here directly, from the same n=1 round's own `charged` figure.
    const firstRingChargedTotal = first.ringCharged.reduce((a, b) => a + b, 0)
    console.log(
      `λ retention ratio (this probe, n=1 round): ${sourceLambdaRingAtExhaustion / firstRingChargedTotal} against protocol.ts's recorded ${LAMBDA_LEG_RETENTION_RATIO}`,
    )

    // THE FIVE INTERCEPT COMPONENTS — Critical 2 (fix round 1) plus Critical 1 (fix round 2, the
    // fifth). `first.total` alone (the ORIGINAL intercept) is a page with ZERO fixed cost: no DOM, no
    // CodeMirror, no main-thread wasm module, and no source session at all, which is not what "a page
    // at the cap" (the threshold's own words) is ever true of. Printed separately rather than folded
    // into one number:
    console.log(`intercept component — page/app baseline: ${pageBaseline}`)
    console.log(`intercept component — main-thread wasm module: ${MAIN_THREAD_WASM_MODULE_BASELINE_BYTES}`)
    console.log(`intercept component — source session fixed cost (module+arena): ${sourceFixedCost}`)
    console.log(`intercept component — source λ ring at exhaustion: ${sourceLambdaRingAtExhaustion}`)
    console.log(`intercept component — source TM ring at exhaustion: ${sourceTmRingAtExhaustion}`)

    // THE TWO READINGS. Which one governs `MAX_WARM_BUFFERS` is the project owner's decision, made in
    // parallel with this fix — this file prints both, labelled, and picks neither.
    //
    // (a) BUFFERS-ONLY-AT-EXHAUSTION — the literal reading of the threshold's own words, "every warm
    // BUFFER holding a real term and its ring driven to exhaustion". The source session's two legs
    // are on every page (the source session always has a λ leg and a TM leg, regardless of how many
    // buffers exist — `MAX_WARM_BUFFERS`'s own doc in `scratch.ts` has the current arithmetic), but they
    // are not SIMULTANEOUSLY exhausted the instant a buffer's rings are — the
    // source session is ordinarily mid-recording or idle, not pinned at its own ring cap at the same
    // moment N buffers are all pinned at theirs. This intercept excludes the source session's two
    // rings and keeps only its fixed thread cost — but the main-thread wasm module IS included, because
    // that module is paid by the PAGE itself, not by the source session, and is on every page exactly
    // as unconditionally as the DOM and CodeMirror already counted in `pageBaseline`.
    const interceptBuffersOnly = pageBaseline + MAIN_THREAD_WASM_MODULE_BASELINE_BYTES + sourceFixedCost
    // (b) EVERYTHING-AT-EXHAUSTION — the source session's two rings ALSO driven to exhaustion at the
    // same instant every buffer's ring is, on top of reading (a). This is the more conservative
    // reading and the one the pre-registered threshold's wording does not literally require, since
    // the source session's legs are not "buffers".
    const interceptEverything = interceptBuffersOnly + sourceLambdaRingAtExhaustion + sourceTmRingAtExhaustion

    const derivedBuffersOnly = Math.floor((BUDGET_BYTES - interceptBuffersOnly) / marginal)
    const derivedEverything = Math.floor((BUDGET_BYTES - interceptEverything) / marginal)

    console.log(`marginal per buffer: ${marginal}`)
    // BOTH CAPS ARE UPPER BOUNDS, NOT MEASURED CEILINGS — Important 2, fix round 2. `pageBaseline`'s
    // own doc says which direction it is wrong in: it is a FLOOR (`APP_PAGE_BASELINE_FLOOR_BYTES` is a
    // byte-conversion of a PROSE figure, not a recorded reading, and `session-memory.test.ts` states
    // outright that the real app's baseline "is larger still"). A floor on one intercept component can
    // only push the TRUE intercept up and the true safe cap DOWN from what is printed below, never up —
    // so both numbers below are upper bounds on what the page can actually afford. Task 8 must not read
    // 11 as a measured ceiling.
    console.log(
      `derived cap (a) buffers-only-at-exhaustion [UPPER BOUND — pageBaseline is a floor, see above] — intercept=${interceptBuffersOnly}: ${derivedBuffersOnly}`,
    )
    console.log(
      `derived cap (b) everything-at-exhaustion [UPPER BOUND — pageBaseline is a floor, see above] — intercept=${interceptEverything}: ${derivedEverything}`,
    )

    // 5d-ii-d T8 — VERIFICATION AT n = `MAX_WARM_BUFFERS`, THE DERIVED CAP, BY DIRECT MEASUREMENT RATHER
    // THAN EXTRAPOLATION. `atCap.total` is a REAL reading — `MAX_WARM_BUFFERS` wasm workers, each stepping the same
    // divergent term 20,000 times, each ring driven to the same exhaustion every other point's ring
    // was — not a projection of the n=1/n=4 marginal forward to the cap. `predictedTotalAtCap` is
    // what that marginal WOULD have predicted, printed alongside the measurement so agreement (linearity
    // held out to the cap) or disagreement (it didn't) is stated rather than left for a reader to compute
    // by hand. `verifiedGrandTotal` is intercept (a) — the reading the project owner ruled binds, see
    // above — plus the at-cap round's own measured total, and `verifiedFitsBudget` compares it to the
    // 512 MiB budget. THIS IS A `console.log`, NOT AN `expect`, for the same reason nothing else in this
    // file gates the build on the 512 MiB figure (see the loose-bounds note below) — but it is the one
    // line `MAX_WARM_BUFFERS`'s own doc reads to decide whether the cap ships or gets lowered, which is
    // the whole reason this fourth point exists.
    //
    // **EVERY `11` IN THIS BLOCK IS INTERPOLATED FROM `MAX_WARM_BUFFERS` NOW, INCLUDING THE ONES IN THE
    // OUTPUT — whole-branch review before merge, finding 9.** The code always found the point by
    // `n === MAX_WARM_BUFFERS`; the strings around it said `n=11` and the local was called `eleven`, so
    // the console output — the thing this file's own header calls THE DELIVERABLE — would have started
    // lying the first time the constant moved, which is exactly the gesture this measurement exists to
    // authorise. A report that describes the run it did not do is worse than no report.
    const atCap = points.find((p) => p.n === MAX_WARM_BUFFERS)
    if (atCap === undefined) throw new Error(`BLOCKED: no n=${MAX_WARM_BUFFERS} point measured`)
    // NO INTERCEPT ROUND-TRIP — `predictedTotalAtCap` is what the n=1/n=4 marginal alone predicts
    // for `atCap.n` MORE buffers over the n=1 baseline's own total, which is exactly `marginal *
    // atCap.n`; a prior version added `interceptBuffersOnly` here only to subtract it straight back out
    // in the `console.log` below, which said the same thing through an extra step.
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
    // the deliverable; Task 8 reads it and moves `MAX_WARM_BUFFERS` by hand — including the at-cap
    // verification lines just above, which are the one part of this file's output written for a single
    // specific count rather than for the general fit, and which now interpolate that count rather than
    // spelling it.
    expect(first.wasm).toBeGreaterThan(1_000_000)
    expect(marginal).toBeGreaterThan(0)
    expect(derivedBuffersOnly).toBeGreaterThan(0)
    expect(derivedEverything).toBeGreaterThan(0)

    // IMPORTANT 1 — A SANITY BOUND ON THE RING READING ITSELF, which nothing here checked before: a
    // zero ring delta at every `n` used to pass every assertion above (`marginal` stayed positive off
    // the wasm term alone). `n` MB is a small fraction of the ~30 MB/ring this file actually measures
    // — loose enough to survive a different Chromium build, but not satisfiable by "nothing was
    // retained".
    for (const p of points) {
      expect(p.rings).toBeGreaterThan(p.n * 1_000_000)
    }

    // IMPORTANT 3 — A LOOSE BOUND ON FRAME COUNT, WHICH NOTHING HERE CHECKED BEFORE — fix round 2.
    // `charged` was computed inside `buildRings` only to gate the 90%-exhaustion throw above, and
    // frame counts were never computed at all: a regression back to fix round 1's own Critical 1 (the
    // ~88-byte `fixtureFrame`, needing ~381,000 of them to reach `HISTORY_BYTES`) would still charge to
    // budget, still pass the ring-bytes bound just above (a BYTE bound, indifferent to frame count),
    // and would show up nowhere but an unwatched ~4 MB shift in `rings`. A real λ ring is ~3,200 frames
    // (`protocol.ts`'s `HISTORY_BYTES`); 50,000 is an order of magnitude above that and an order of magnitude below
    // the fixture's ~381,000 — wide enough to survive term/browser variance, tight enough to catch
    // exactly the regression this round's Critical 1 fixed, and it encodes nothing about the 512 MiB
    // threshold.
    for (const p of points) {
      for (const f of p.ringFrames) {
        expect(f).toBeLessThan(50_000)
      }
    }

    // IMPORTANT 2 — `steps` IS NOW ASSERTED NON-ZERO. "Holding a real term" was previously
    // unverified: a worker whose term stopped reducing at step 0 would still shift the wasm reading
    // under 1% and pass every check above.
    for (const p of points) {
      for (const s of p.steps) {
        expect(s).toBeGreaterThan(0)
      }
    }

    // `held` READ HERE (Minor, fix round 1), STILL READ BUT NO LONGER ASSERTED (Minor, fix round 2).
    // Every worker must still have held its scratch at the moment it answered, or its wasm reading is
    // not the reading of a buffer this file can call "warm" — but `expect(h).toBe(true)` CANNOT FAIL:
    // `affordability-worker.ts`'s handler returns early, posting `{ outcome: 'no-scratch' }`, whenever
    // `scratch` is falsy, and `runWorkers` turns any non-`'ok'` outcome into a rejection this test never
    // reaches — so every `held` value that survives to this loop was set to `held = scratch` (truthy)
    // on the very line before it was read back as `held !== null`. `held` is `true` on every reply that
    // gets here BY CONSTRUCTION, not by evidence, so no `expect` on it can ever be red. It is still
    // printed per round above (`ringFrames`/`held` inside the `n=…` line) so a future change that
    // decouples the reply from the assignment stays visible in the console output instead of silently
    // reverting to an assertion that cannot fail either way.
  })
})
