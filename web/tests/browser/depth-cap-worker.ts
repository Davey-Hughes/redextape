// A worker that does ONLY the print. Driving the real session-worker cannot measure this: for a
// large unary literal its TM leg dominates and every case times out before the print is reached.
import init, { compile } from '../../../pkg/redextape_wasm.js'

type Session = { linkIndex(b: number): { lambdaCut: string | null }; free(): void }

let ready: Promise<unknown> | null = null

self.addEventListener('message', async (e: MessageEvent<{ n: number; budget: number }>) => {
  const { n, budget } = e.data
  if (!ready) ready = init()
  await ready
  let msg: { outcome: string; cut?: string | null; second?: string }
  let session: Session | null = null
  try {
    ;({ session } = compile(`let x = ${n}; x + 1`, 'unary') as { session: Session | null })
    if (!session) {
      ;(self as unknown as Worker).postMessage({ outcome: 'no-session' })
      return
    }
    msg = { outcome: 'ok', cut: session.linkIndex(budget).lambdaCut }
    // A call AFTER the one under test: if the first aborted mid-flight, wasm-bindgen's reentrancy
    // borrow is still held and this throws "already borrowed" forever.
    session.linkIndex(budget)
    msg.second = 'ok'
  } catch (err) {
    msg = { outcome: err instanceof Error ? err.message : String(err) }
  }
  if (session) {
    try {
      session.free()
    } catch {
      /* poisoned */
    }
  }
  ;(self as unknown as Worker).postMessage(msg)
})
