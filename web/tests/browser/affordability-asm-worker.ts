import init, { compile } from '../../../pkg/redextape_wasm.js'
import { ASM_WINDOW, asmFrameBytes, HISTORY_BYTES } from '../../src/protocol'
import type { AsmState, AsmStatus } from '../../src/types'

/**
 * `buffer-affordability.test.ts`'s source asm ring: one worker compiles a program as the source session's worker
 * does, records its asm leg to `HISTORY_BYTES` charged, and answers the frames it recorded and the leg's run state
 * (`asmStatus().run`) after the last step.
 *
 * **THE RECORDING IS `session-worker.ts`'s `ASM_RECORDING` RUN BY `recordLeg`, IN ITS ORDER**: the first frame, then a
 * step and a frame while the charged bytes are under the allowance, which `recordLeg` checks before each step, so it
 * stops at the first frame that reaches `HISTORY_BYTES` or at the leg's end. A recording that reached the allowance is
 * the one that fills the page's ring; one that ended short of it does not, and the test refuses it.
 *
 * **A SESSION, NOT AN `AsmScratch`**: the ring priced is the source session's asm leg, whose frames a compiled
 * `Session` steps.
 */
type Session = {
  asmStatus(): AsmStatus
  stepAsm(): boolean
  asmState(window: typeof ASM_WINDOW): AsmState
}

let ready: Promise<unknown> | null = null

self.addEventListener('message', async (e: MessageEvent<{ src: string; encoding: string }>) => {
  try {
    if (!ready) ready = init()
    await ready
    const { session } = compile(e.data.src, e.data.encoding) as { session: Session | null }
    if (session === null || !session.asmStatus().available) {
      ;(self as unknown as Worker).postMessage({ outcome: 'no-asm-leg' })
      return
    }
    const frames: AsmState[] = [session.asmState(ASM_WINDOW)]
    let charged = asmFrameBytes(frames[0] as AsmState)
    while (charged < HISTORY_BYTES && session.stepAsm()) {
      const f = session.asmState(ASM_WINDOW)
      frames.push(f)
      charged += asmFrameBytes(f)
    }
    ;(self as unknown as Worker).postMessage({
      outcome: 'ok',
      steps: frames.length - 1,
      run: session.asmStatus().run,
      frames,
    })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      outcome: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
})
