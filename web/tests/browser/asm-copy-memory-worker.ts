// A worker that builds ONE asm copy under the caps it is sent, records it as the session worker would, and reports
// how large its wasm memory has grown — for `asm-copy-memory.test.ts`. One copy per worker, because a wasm memory only
// grows: a second build in the same worker would read the first one's peak.
//
// THE PROBE BUILD, BY GLOB, NOT `pkg/`: `asmScratchWithCaps` exists only under `probe-asm-copy`, and a glob that
// matches nothing leaves `tsc` and every other run able to load this file's siblings without the build.
import type * as Wasm from '../../../pkg/redextape_wasm.js'
import { ASM_WINDOW, asmFrameBytes, HISTORY_BYTES } from '../../src/protocol'
import type { AsmState, AsmStatus } from '../../src/types'

const PROBE_WASM = import.meta.glob<typeof Wasm>('../../../target/probe-asm-copy-wasm/redextape_wasm.js')

type Copy = { asmStatus(): AsmStatus; asmState(w: typeof ASM_WINDOW): AsmState; stepAsm(): boolean; free(): void }
type ProbeWasm = typeof Wasm & {
  asmScratchWithCaps(src: string, steps: number, stack: number, heap: number, mem: number): { scratch: Copy | null }
}
export type MemoryRequest = { src: string; caps: [number, number, number, number] }
export type MemoryReply =
  | { ok: true; mib: number; status: AsmStatus; frames: number; buildMs: number }
  | { ok: false; message: string }

self.addEventListener('message', async (e: MessageEvent<MemoryRequest>) => {
  const post = (r: MemoryReply) => (self as unknown as Worker).postMessage(r)
  try {
    const load = Object.values(PROBE_WASM)[0]
    if (load === undefined) throw new Error('BLOCKED: no probe wasm build; run `pnpm run test:probe:asm-copy`')
    const wasm = (await load()) as ProbeWasm
    const exports = (await wasm.default()) as { memory: WebAssembly.Memory }
    const t0 = performance.now()
    const { scratch } = wasm.asmScratchWithCaps(e.data.src, ...e.data.caps)
    const buildMs = performance.now() - t0
    if (scratch === null) throw new Error('the probe program did not build')
    // THE RECORDING, AS `record-loop.ts` SPENDS IT: a frame per step until the leg stops or the history budget is spent.
    let bytes = 0
    let frames = 0
    for (;;) {
      const f = scratch.asmState(ASM_WINDOW)
      bytes += asmFrameBytes(f)
      frames += 1
      if (bytes >= HISTORY_BYTES || !scratch.stepAsm()) break
    }
    post({ ok: true, mib: exports.memory.buffer.byteLength / 2 ** 20, status: scratch.asmStatus(), frames, buildMs })
  } catch (err) {
    post({ ok: false, message: err instanceof Error ? err.message : String(err) })
  }
})
