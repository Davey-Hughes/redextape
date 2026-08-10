import { describe, expect, it } from 'vitest'

// Mirrors `redextape_wasm::session::MAX_PRINT_DEPTH` (`crates/redextape-wasm/src/session.rs`).
// `let x = N; x + 1` has term depth N + 3. Keep this in sync with that constant by hand.
const MAX_PRINT_DEPTH = 1_000

type Reply = { outcome: string; cut?: string | null; second?: string }

/**
 * ON A WORKER THREAD, AND THAT IS THE WHOLE POINT. A worker's V8 call stack died mid-print, on its
 * FIRST deep print, at term depth 1,930 where the page thread reached 2,833 — 47% more generous —
 * and the app prints in a worker (`session-worker.ts` calls `lambdaState` and `linkIndex` on every
 * compile). A page-thread test passes at any cap below 2,833 and proves nothing about the stack the
 * app lives on.
 */
function print(n: number, timeoutMs = 60_000): Promise<Reply> {
  const w = new Worker(new URL('./depth-cap-worker.ts', import.meta.url), { type: 'module' })
  return new Promise<Reply>((resolve) => {
    const done = (r: Reply) => {
      clearTimeout(timer)
      w.terminate()
      resolve(r)
    }
    const timer = setTimeout(() => done({ outcome: `TIMEOUT after ${timeoutMs}ms` }), timeoutMs)
    w.addEventListener('message', (e: MessageEvent<Reply>) => done(e.data))
    w.addEventListener('error', (e) => done({ outcome: `error event: ${e.message ?? 'unknown'}` }))
    w.postMessage({ n, budget: 65_536 })
  })
}

describe('the print-depth cap', () => {
  it('walks a term AT the cap without exhausting the worker stack', { timeout: 120_000 }, async () => {
    // THE TRIPWIRE. It fails if a future engine's call stack drops to meet the cap, which is the one
    // risk a cap calibrated on one browser cannot design away. Same role as browser.rs's
    // `a_deep_but_legal_program_needs_the_raised_shadow_stack`, one stack up.
    const r = await print(MAX_PRINT_DEPTH - 3)
    expect(r.outcome).toBe('ok')
    // Not just 'ok' — a walk that bailed early also reports 'ok'. `cut` must be `null`, proving the
    // walk reached the end of the term rather than hitting a stale (too-shallow) depth cap.
    expect(r.cut).toBe(null)
  })

  it('reports a depth cut instead of destroying the session', { timeout: 120_000 }, async () => {
    // The original repro from the 2026-08-09 investigation: this exact program destroyed the session
    // unrecoverably, and every later call threw "attempted to take ownership of Rust value while it
    // was borrowed" because the abort left wasm-bindgen's guard taken.
    const r = await print(2690)
    expect(r.outcome).toBe('ok')
    expect(r.cut).toBe('Depth')
    expect(r.second).toBe('ok')
  })
})
