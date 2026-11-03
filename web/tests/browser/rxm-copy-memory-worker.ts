// A worker that builds ONE rxm copy under the caps it is sent, records it as the session worker would, and reports
// how large its wasm memory has grown — for `rxm-copy-memory.test.ts`. One copy per worker, because a wasm memory only
// grows: a second build in the same worker would read the first one's peak.
//
// THE PROBE BUILD, BY GLOB, NOT `pkg/`: `rxmScratchWithCaps` exists only under `probe-rxm-copy`, and a glob that
// matches nothing leaves `tsc` and every other run able to load this file's siblings without the build.
import type * as Wasm from '../../../pkg/redextape_wasm.js'
import { HISTORY_BYTES, RXM_WINDOW, rxmFrameBytes } from '../../src/protocol'
import type { RxmState, RxmStatus } from '../../src/types'

const PROBE_WASM = import.meta.glob<typeof Wasm>('../../../target/probe-rxm-copy-wasm/redextape_wasm.js')

type Copy = { rxmStatus(): RxmStatus; rxmState(w: typeof RXM_WINDOW): RxmState; stepRxm(): boolean; free(): void }
type ProbeWasm = typeof Wasm & {
  rxmScratchWithCaps(src: string, steps: number, stack: number, heap: number, mem: number): { scratch: Copy | null }
}
export type MemoryRequest = { src: string; caps: [number, number, number, number] }
export type MemoryReply =
  | { ok: true; mib: number; status: RxmStatus; frames: number; buildMs: number }
  | { ok: false; message: string }

self.addEventListener('message', async (e: MessageEvent<MemoryRequest>) => {
  const post = (r: MemoryReply) => (self as unknown as Worker).postMessage(r)
  try {
    const load = Object.values(PROBE_WASM)[0]
    if (load === undefined) throw new Error('BLOCKED: no probe wasm build; run `pnpm run test:probe:rxm-copy`')
    const wasm = (await load()) as ProbeWasm
    const exports = (await wasm.default()) as { memory: WebAssembly.Memory }
    const t0 = performance.now()
    const { scratch } = wasm.rxmScratchWithCaps(e.data.src, ...e.data.caps)
    const buildMs = performance.now() - t0
    if (scratch === null) throw new Error('the probe program did not build')
    // THE RECORDING, AS `record-loop.ts` SPENDS IT: a frame per step until the leg stops or the history budget is spent.
    let bytes = 0
    let frames = 0
    for (;;) {
      const f = scratch.rxmState(RXM_WINDOW)
      bytes += rxmFrameBytes(f)
      frames += 1
      if (bytes >= HISTORY_BYTES || !scratch.stepRxm()) break
    }
    post({ ok: true, mib: exports.memory.buffer.byteLength / 2 ** 20, status: scratch.rxmStatus(), frames, buildMs })
  } catch (err) {
    post({ ok: false, message: err instanceof Error ? err.message : String(err) })
  }
})
