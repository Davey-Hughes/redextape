// A worker that holds ONE λ scratch and reports its own wasm linear memory, plus the REAL frames its
// own reduction produced — 5d-ii-d task 7, fix round 1, Critical 1.
//
// **IT EXISTS BECAUSE A WORKER'S MEMORY CANNOT BE READ FROM OUTSIDE IT** (5d-ii-d design §3.5).
// `usedJSHeapSize` is one V8 isolate's figure and a worker has its own;
// `performance.measureUserAgentSpecificMemory` would cross isolates and is `undefined` here because
// Vitest's server is not cross-origin isolated. `session-memory.test.ts` answered that by reading ONE
// main-thread module instance and reasoning about threads arithmetically — which is exactly the
// arithmetic a cap would be derived from, so a cap needs the real N-thread reading instead.
//
// A TEST-ONLY WORKER, ON `depth-cap-worker.ts`'s PRECEDENT, so no message kind is added to
// `protocol.ts` for a measurement's benefit — a request no surface can produce is the fabricated-state
// shape `session.rs`'s `Session::tm` prices.
import init, { lambdaScratch } from '../../../pkg/redextape_wasm.js'
import { HISTORY_BYTES, lambdaFrameBytes } from '../../src/protocol'
import type { LambdaState } from '../../src/types'

type Scratch = { stepLambda(): boolean; lambdaState(b: number): unknown }

let ready: Promise<{ memory: WebAssembly.Memory }> | null = null
/**
 * The one scratch this worker holds. Assigned once, at the end of the handler below, and read back
 * only as a presence check (`held !== null`) for the outgoing reply — its purpose is what it PREVENTS,
 * not what it produces. See the comment at the assignment.
 */
let held: Scratch | null = null

self.addEventListener('message', async (e: MessageEvent<{ src: string; steps: number; frameBytes: number }>) => {
  const { src, steps, frameBytes } = e.data
  // THE WHOLE BODY IS NOW INSIDE A `try` — 5d-ii-d task 7 fix round 1, Important 4. Before this fix, a
  // rejection from `init()` (or anything below it) fell out of this `async` listener as an unhandled
  // rejection in the worker's global scope: a worker's `error` event fires for an uncaught SYNCHRONOUS
  // exception, not for a promise an `async` message listener returns and the platform never awaits, so
  // the main thread's `error` listener never fired and `Promise.all` in `buffer-affordability.test.ts`
  // hung for the full 300 s `it()` timeout instead of reporting anything. Catching here and posting an
  // `outcome` the caller already branches on (`e.data.outcome !== 'ok'`) turns that hang into an
  // immediate `BLOCKED:` rejection.
  try {
    if (!ready) ready = init() as Promise<{ memory: WebAssembly.Memory }>
    const out = await ready

    const { scratch } = lambdaScratch(src) as { scratch: Scratch | null }
    if (!scratch) {
      ;(self as unknown as Worker).postMessage({ outcome: 'no-scratch' })
      return
    }

    // REAL FRAMES, NOT A FIXTURE — 5d-ii-d task 7 fix round 1, Critical 1. The old probe pushed a
    // `fixtureFrame` (`spans: []`, `redex_span: null`, `owner: 'None'`, ~88 bytes) into the ring on the
    // main thread instead of using what this worker was already building and discarding right here.
    // Collected ONLY up to `HISTORY_BYTES` charged — the same stopping rule a real ring itself uses —
    // so this posts on the order of the ~3,200 frames `protocol.ts`'s `HISTORY_BYTES` doc records for a real λ ring, never
    // the ~381,000 the fixture needed at its ~88 bytes/frame. Stepping continues past that point,
    // uncollected, so the wasm reading below is still driven by the full `steps` budget exactly as
    // before — only the frame POPULATION changed here, not the step budget the wasm side is measured
    // against.
    const frames: LambdaState[] = []
    let framesCharged = 0
    let n = 0
    while (n < steps && scratch.stepLambda()) {
      const state = scratch.lambdaState(frameBytes) as LambdaState
      n += 1
      if (framesCharged < HISTORY_BYTES) {
        frames.push(state)
        framesCharged += lambdaFrameBytes(state)
      }
    }

    // HELD, NOT FREED, AND NOT FOR THE REASON THIS COMMENT ONCE GAVE — 5d-ii-d task 7 fix round 1,
    // Minor. It used to say a freed handle "would report the module baseline and nothing else"; that is
    // false. `WebAssembly.Memory` has no shrink operation, so `memory.buffer.byteLength` is monotonic —
    // freeing `scratch` would not move `out.memory.buffer.byteLength` by one byte, before or after this
    // measurement. Keeping `held` is still correct, for a different reason: `pkg`'s generated
    // `LambdaScratch` wraps every instance in a `FinalizationRegistry` that calls `free()` on the Rust
    // side once its JS wrapper is collected, and this worker sits idle between answering and being
    // `terminate()`d — exactly the window a background GC pass could run in. `held` is the module-scope
    // reference that keeps that pass from reaching `scratch` during that window, which protects the
    // SCRATCH (and the `frames` array read out of it, above) from a use-after-free race, not the byte
    // count.
    held = scratch
    ;(self as unknown as Worker).postMessage({
      outcome: 'ok',
      steps: n,
      wasmBytes: out.memory.buffer.byteLength,
      frames,
      // READ ON THE OTHER END NOW, WHERE IT WAS POSTED AND IGNORED BEFORE — 5d-ii-d task 7 fix round 1,
      // Minor. `buffer-affordability.test.ts` folds this into its own per-worker structural check
      // alongside `steps`, so the field earns its place on the wire instead of being written and never
      // read.
      held: held !== null,
    })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      outcome: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
})
