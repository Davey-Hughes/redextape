import init, { tmScratch } from '../../../pkg/redextape_wasm.js'
import { HISTORY_BYTES, TM_RADIUS, tmFrameBytes, VALUE_CHUNK } from '../../src/protocol'
import type { TmState, ValueRun } from '../../src/types'

/**
 * `buffer-affordability.test.ts`'s TM copy: one worker builds a `TmScratch` from machine text, records its TM leg to
 * `HISTORY_BYTES` charged and runs its value run to its end, as `session-worker.ts`'s `onTmScratch` does for a copy,
 * then answers its own wasm bytes, the frames it recorded, and what a copy's `tm-scratch-compiled` and last `tm-value`
 * replies hand the page: the machine, its status, its tape names, and the value run's end with its value. The page
 * keeps those on the copy's session entry whether or not a view shows it (`replies.ts`), so they are part of a copy.
 *
 * **WHAT A TM COPY'S WORKER DOES, IN ITS ORDER**: the build, the three calls the copy's first reply is made from, the
 * recording (`recordLeg` checks the allowance before each step, so it stops at the first frame that reaches it), then
 * the value run in `VALUE_CHUNK` chunks. The text arrives from the page, which compiled the program: a copy's worker
 * never compiles, and wasm linear memory never shrinks, so compiling here would price a thread no copy has.
 *
 * **THE SCRATCH IS HELD, NOT FREED**, for `affordability-worker.ts`'s reason: a warm copy holds its machine.
 */
type Scratch = {
  stepTm(): boolean
  tmState(radius: number): TmState
  tmProgram(): unknown
  tmStatus(): unknown
  tapeNames(): unknown
}
type Value = { run(budget: number): ValueRun; value(): unknown }

let ready: Promise<{ memory: WebAssembly.Memory }> | null = null
/** The copies this worker holds, so none is collectable while the page reads: a warm copy holds its machine. */
const held: unknown[] = []

self.addEventListener('message', async (e: MessageEvent<{ src: string }>) => {
  try {
    if (!ready) ready = init() as Promise<{ memory: WebAssembly.Memory }>
    const out = await ready
    const { scratch, value } = tmScratch(e.data.src) as { scratch: Scratch | null; value: Value | null }
    if (!scratch) {
      ;(self as unknown as Worker).postMessage({ outcome: 'no-scratch' })
      return
    }
    const tmProgram = scratch.tmProgram()
    const tm = scratch.tmStatus()
    const tapeNames = scratch.tapeNames()
    const frames: TmState[] = [scratch.tmState(TM_RADIUS)]
    let charged = tmFrameBytes(frames[0] as TmState)
    while (charged < HISTORY_BYTES && scratch.stepTm()) {
      const f = scratch.tmState(TM_RADIUS)
      frames.push(f)
      charged += tmFrameBytes(f)
    }
    let valueRun = 'none'
    let valueSteps = 0
    let lastRun: ValueRun | null = null
    let decoded: unknown = null
    while (value !== null) {
      const r = value.run(VALUE_CHUNK)
      lastRun = r
      decoded = value.value()
      valueRun = r.run
      valueSteps = r.steps
      if (r.run !== 'Running') break
    }
    held.push(scratch, value)
    ;(self as unknown as Worker).postMessage({
      outcome: 'ok',
      steps: frames.length - 1,
      valueRun,
      valueSteps,
      wasmBytes: out.memory.buffer.byteLength,
      frames,
      tmProgram,
      tm,
      tapeNames,
      value: lastRun === null ? null : { run: lastRun, value: decoded },
    })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      outcome: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
})
