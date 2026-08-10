import { describe, expect, it } from 'vitest'

// Mirrors `redextape_wasm::session::MAX_PRINT_DEPTH` (`crates/redextape-wasm/src/session.rs`).
// Keep this in sync with that constant and with `depth-cap.test.ts`'s own mirror.
const MAX_PRINT_DEPTH = 1_000

type Reply = { outcome: string; cut?: string | null; second?: string }

/**
 * ONE WORKER, MANY PRINTS — deliberately unlike `depth-cap.test.ts`'s `print()`, which spins up a
 * fresh worker per call. The cap in `session.rs` is sized against the worker's STEADY-STATE stack
 * ceiling, not its first-print ceiling: a fresh worker's first deep print has more headroom than
 * the SAME worker's second, third, or later one, and that gap only shows up by reusing one worker
 * across repeated prints. A fresh-worker-per-call test cannot see it — every sample would be a
 * first print, which is exactly the wrong ceiling to calibrate against (see `session.rs`'s doc
 * comment on `MAX_PRINT_DEPTH`).
 */
function printOnce(w: Worker, n: number, timeoutMs = 60_000): Promise<Reply> {
  return new Promise<Reply>((resolve) => {
    const cleanup = () => {
      clearTimeout(timer)
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
    }
    const onMessage = (e: MessageEvent<Reply>) => {
      cleanup()
      resolve(e.data)
    }
    const onError = (e: ErrorEvent) => {
      cleanup()
      resolve({ outcome: `error event: ${e.message ?? 'unknown'}` })
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve({ outcome: `TIMEOUT after ${timeoutMs}ms` })
    }, timeoutMs)
    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    w.postMessage({ n, budget: 65_536 })
  })
}

const REPS = 5
// Headroom over `REPS * printOnce`'s default 60 s per rep: at REPS * 60_000 = 300_000 exactly, an
// all-timeout run fails as an unnamed vitest timeout on the `it` itself instead of surfacing the
// `rep N of REPS` message below — the one thing this file exists to report. `it`'s own timeout must
// exceed the sum of per-print timeouts, not equal it.
const IT_TIMEOUT_MS = REPS * 60_000 + 60_000

describe('the print-depth cap, under repetition', () => {
  it('keeps succeeding across repeated prints in the same worker', { timeout: IT_TIMEOUT_MS }, async () => {
    // JUST UNDER THE CAP, same margin `depth-cap.test.ts` uses for its single-print tripwire.
    // `let x = N; x + 1` has term depth N + 3, so this walks the cap itself without a depth cut.
    const n = MAX_PRINT_DEPTH - 3
    const w = new Worker(new URL('./depth-cap-worker.ts', import.meta.url), { type: 'module' })
    try {
      const outcomes: Reply[] = []
      for (let i = 0; i < REPS; i++) {
        outcomes.push(await printOnce(w, n))
      }
      outcomes.forEach((r, i) => {
        // A worker whose stack ceiling has degraded fails partway through this loop, not on the
        // first rep — that is the whole point of driving one worker repeatedly instead of a fresh
        // one per call. Each assertion names its own rep so a failure shows exactly where.
        expect(r.outcome, `rep ${i + 1} of ${REPS}`).toBe('ok')
        // Not just 'ok' — a walk that bailed early on a since-lowered cap also reports 'ok'. `cut`
        // must be `null` on every rep, proving each walk reached the end of the term rather than
        // hitting a depth cap — the property this whole file exists to drive repeatedly, which
        // `outcome === 'ok'` alone cannot distinguish from a shallow cut walk. The wire emits `null`
        // (not `undefined`): `lib.rs` writes `JsValue::NULL` for an absent cut.
        expect(r.cut, `rep ${i + 1} of ${REPS}`).toBe(null)
      })
    } finally {
      w.terminate()
    }
  })
})
