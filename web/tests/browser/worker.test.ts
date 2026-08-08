import { describe, expect, it } from 'vitest'
import type { RunReply, RunRequest } from '../../src/protocol'

/**
 * Collect EVERY reply for one request. PR 3c's worker answered once per generation; this one
 * answers many times, and a helper that resolved on the first message would silently test only the
 * `compiled` reply.
 */
function askAll(req: RunRequest, timeoutMs = 30_000): Promise<{ replies: RunReply[]; worker: Worker }> {
  const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const replies: RunReply[] = []
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error(`the worker did not finish in time; got ${replies.map((r) => r.kind).join(', ')}`))
    }, timeoutMs)
    worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
      replies.push(e.data)
      if (e.data.kind === 'result' || e.data.kind === 'no-session' || e.data.kind === 'worker-error') {
        clearTimeout(timer)
        resolve({ replies, worker })
      }
    })
    worker.postMessage(req)
  })
}

const run = (src: string, gen = 1, encoding = 'unary'): RunRequest => ({ kind: 'run', gen, src, encoding })

describe('session-worker', () => {
  it('drives the λ leg to a normal form and decodes both legs', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
    worker.terminate()
    const reply = replies.at(-1)
    expect(reply?.kind).toBe('result')
    if (reply?.kind !== 'result') return

    expect(reply.gen).toBe(1)
    expect(reply.lambda.status.run).toBe('Ended')
    expect(reply.lambda.state?.step).toBe(7)
    expect(reply.lambda.value).toEqual({ Value: { text: '42' } })
    expect(reply.tm.status.total_steps).toBe(2870)
    expect(reply.tm.value).toEqual({ Value: { text: '42' } })
  })

  it('answers no-session with diagnostics for a program that does not analyze', async () => {
    const { replies, worker } = await askAll(run('let x = ;'))
    worker.terminate()
    const reply = replies.at(-1)
    expect(reply?.kind).toBe('no-session')
    if (reply?.kind !== 'no-session') return
    expect(reply.diagnostics.length).toBeGreaterThan(0)
    expect(reply.diagnostics[0]?.severity).toBe('Error')
  })

  it('still answers for the TM leg when the λ backend declines', async () => {
    const src = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'
    const { replies, worker } = await askAll(run(src))
    worker.terminate()
    const reply = replies.at(-1)
    expect(reply?.kind).toBe('result')
    if (reply?.kind !== 'result') return
    expect(reply.lambda.status.available).toBe(false)
    expect(reply.lambda.status.reason).not.toBe('')
    expect(reply.tm.status.available).toBe(true)
    // The brief guessed '0' here; the actual run says '10'. The TM leg has no closures to capture `n` at
    // `f`'s creation, so `apply0(f)` reads `n`'s value at the point `g(0)` runs — after `n = 10` — giving
    // `0 + 10`. That mutable-capture ambiguity is exactly why the λ leg declines this program instead.
    expect(reply.tm.value).toEqual({ Value: { text: '10' } })
  })

  // `sourceSpan` is a Session method, so only the worker can turn `status.node` into a range. Without
  // this the refusal names a node the main thread has no way to look up.
  it('resolves the refused node to a source span', async () => {
    const src = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'
    const { replies, worker } = await askAll(run(src))
    worker.terminate()
    const reply = replies.at(-1)
    expect(reply?.kind).toBe('result')
    if (reply?.kind !== 'result') return
    expect(reply.lambda.status.node).not.toBeNull()
    expect(reply.lambda.declinedSpan).not.toBeNull()
    const span = reply.lambda.declinedSpan
    if (!span) return
    expect(span.end).toBeGreaterThan(span.start)
    expect(span.end).toBeLessThanOrEqual(src.length)
  })

  it('carries the generation back unchanged', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2', 7))
    worker.terminate()
    // Every reply carries `gen`, not only the last one — checking only `replies.at(-1)` would let a
    // mutant that hardcodes the generation in one reply kind survive.
    expect(replies.every((r) => r.gen === 7)).toBe(true)
  })

  // `compile` throws by design for a name `EncodingKind::parse` rejects (`lib.rs:36-38`) — the
  // reachable trigger for the whole class of thrown-session-call defects this variant exists to catch.
  it('reports a thrown session call instead of going silent', async () => {
    const { replies, worker } = await askAll({ kind: 'run', gen: 1, src: 'let x = 40; x + 2', encoding: 'nonsense' })
    worker.terminate()
    const err = replies.find((r) => r.kind === 'worker-error')
    expect(err).toBeDefined()
    expect(err?.kind === 'worker-error' && err.message).toContain('encoding')
  })
})

describe('session-worker recording', () => {
  it('sends compiled first, then frames, then the result', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
    worker.terminate()
    expect(replies[0]?.kind).toBe('compiled')
    expect(replies.at(-1)?.kind).toBe('result')
    expect(replies.some((r) => r.kind === 'lambda-frames')).toBe(true)
    expect(replies.some((r) => r.kind === 'tm-frames')).toBe(true)
  })

  it('records a frame per β-step plus the initial term', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
    worker.terminate()
    const frames = replies.flatMap((r) => (r.kind === 'lambda-frames' ? r.frames : []))
    // The run is 7 β-steps, so 8 frames: step 0 through step 7.
    expect(frames.length).toBe(8)
    expect(frames[0]?.step).toBe(0)
    expect(frames.at(-1)?.step).toBe(7)
    const last = replies.filter((r) => r.kind === 'lambda-frames').at(-1)
    expect(last?.kind === 'lambda-frames' && last.done).toBe('ended')
  })

  it('sends tmProgram and tapeNames once, on compiled', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
    worker.terminate()
    const compiled = replies.find((r) => r.kind === 'compiled')
    expect(compiled?.kind === 'compiled' && compiled.tapeNames).toEqual(['REG', 'WORK', 'STACK', 'HEAP', 'BOX'])
    expect(compiled?.kind === 'compiled' && compiled.tmProgram?.tapes).toBe(5)
    expect(replies.filter((r) => r.kind === 'compiled').length).toBe(1)
  })

  it('records TM frames from step 0 even though compile already ran the TM leg', async () => {
    const { replies, worker } = await askAll(run('[1, 2]'))
    worker.terminate()
    const frames = replies.flatMap((r) => (r.kind === 'tm-frames' ? r.frames : []))
    expect(frames[0]?.step).toBe(0)
    expect(frames[1]?.step).toBe(1)
    expect(frames.at(-1)?.step).toBeGreaterThan(100)
  })

  // THE DEFECT THAT HID IN PR 3c, one layer further in. `runLambda` threw for a declined leg and the
  // handler never replied; now there are more throwing call sites, and a declined λ leg must still
  // produce a complete TM history.
  it('still records the TM leg when the λ backend declines', async () => {
    const src = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'
    const { replies, worker } = await askAll(run(src))
    worker.terminate()
    const compiled = replies.find((r) => r.kind === 'compiled')
    expect(compiled?.kind === 'compiled' && compiled.lambda.available).toBe(false)
    expect(replies.flatMap((r) => (r.kind === 'lambda-frames' ? r.frames : [])).length).toBe(0)
    expect(replies.flatMap((r) => (r.kind === 'tm-frames' ? r.frames : [])).length).toBeGreaterThan(0)
    expect(replies.at(-1)?.kind).toBe('result')
  })

  // `num200` — found by `frame_cost_probe`. The mirror image: a live λ leg and a declined TM leg.
  it('still records the λ leg when the TM backend declines', async () => {
    const { replies, worker } = await askAll(run('let x = 200; x + 1'))
    worker.terminate()
    const compiled = replies.find((r) => r.kind === 'compiled')
    expect(compiled?.kind === 'compiled' && compiled.tm.available).toBe(false)
    expect(replies.flatMap((r) => (r.kind === 'lambda-frames' ? r.frames : [])).length).toBeGreaterThan(0)
    // The mirror of the λ-declines test above, which asserts `lambda-frames` is exactly 0. Here the TM
    // leg is the one declining, so `tm-frames` must be exactly 0 and `tmProgram` must be the specific
    // null value the decline guard produces, not merely absent from the reply.
    expect(replies.flatMap((r) => (r.kind === 'tm-frames' ? r.frames : [])).length).toBe(0)
    expect(compiled?.kind === 'compiled' && compiled.tmProgram).toBeNull()
    expect(replies.at(-1)?.kind).toBe('result')
  })

  it('frames are rendered at FRAME_BYTES, not the readout budget', async () => {
    // `[1, 2, 3]`'s λ frames max out at 141 characters — identical at `FRAME_BYTES` (512) and
    // `LAMBDA_BYTE_BUDGET` (65,536) alike, so that fixture cannot tell the two budgets apart.
    // `let x = 200; x + 1` renders all 8 of its λ frames at up to 1,050 characters untruncated, which
    // is over `FRAME_BYTES` and under `LAMBDA_BYTE_BUDGET` — a mutant that swapped the budget constant
    // in the record loop would leave frames longer than 512 and this test would catch it.
    const { replies, worker } = await askAll(run('let x = 200; x + 1'))
    worker.terminate()
    const frames = replies.flatMap((r) => (r.kind === 'lambda-frames' ? r.frames : []))
    expect(frames.length).toBeGreaterThan(0)
    for (const f of frames) expect(f.text.length).toBeLessThanOrEqual(512)
  })

  it('abandons a superseded run without replying for it', async () => {
    const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
    const seen: RunReply[] = []
    // Resolved on generation 1's FIRST `lambda-frames` reply — the moment its record loop has posted
    // one `RECORD_CHUNK` and suspended at `await yieldToEventLoop()`, still holding `recording.lambda`.
    // Posting generation 2 only after this point (not immediately, back-to-back) is what makes the
    // stale-flag race reachable: a `run` posted right away can land before the worker's wasm init
    // (`ready`) even resolves, in which case generation 1 never becomes live and never records at all —
    // a scenario this test used to accept as "abandoned" without ever exercising the race.
    let resolveGen1Recording: () => void
    const gen1Recording = new Promise<void>((resolve) => {
      resolveGen1Recording = resolve
    })
    const done = new Promise<void>((resolve) => {
      worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
        seen.push(e.data)
        if (e.data.gen === 1 && e.data.kind === 'lambda-frames') resolveGen1Recording()
        if (e.data.gen === 2 && (e.data.kind === 'result' || e.data.kind === 'no-session')) resolve()
      })
    })
    worker.postMessage({
      kind: 'run',
      gen: 1,
      // `sum(20)`: ~1,706 β-steps, seven `RECORD_CHUNK` (256) chunks — unlike `sum(5)`, which finishes
      // inside its first chunk and never reaches `await yieldToEventLoop()` at all. Seven suspension
      // points, not one, because landing generation 2 in the single window a smaller fixture offers is
      // a race against this test's own scheduling overhead; seven windows make it reliable.
      src: 'fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(20)',
      encoding: 'unary',
    })
    await gen1Recording
    worker.postMessage({ kind: 'run', gen: 2, src: 'let x = 40; x + 2', encoding: 'unary' })
    await done
    worker.terminate()
    // Generation 2 completed, so nothing from generation 1 may arrive after it — a stale reply here
    // would mean a superseded loop kept touching a session that had been freed.
    const lastGen2 = seen.findIndex((r) => r.gen === 2 && (r.kind === 'result' || r.kind === 'no-session'))
    expect(seen.slice(lastGen2).every((r) => r.gen === 2)).toBe(true)
    expect(seen.some((r) => r.gen === 2 && r.kind === 'result')).toBe(true)
    // Generation 2 must have actually RECORDED, not merely replied. Without this the test passes
    // when gen 2's record loop is suppressed by gen 1's stale flag and `result` reports the
    // unstepped initial term as the answer.
    const gen2Frames = seen.flatMap((r) => (r.kind === 'lambda-frames' && r.gen === 2 ? r.frames : []))
    expect(gen2Frames.length).toBeGreaterThan(1)
    expect(gen2Frames.at(-1)?.step).toBeGreaterThan(0)
    const gen2Result = seen.find((r) => r.gen === 2 && r.kind === 'result')
    expect(gen2Result?.kind === 'result' && gen2Result.lambda.status.run).toBe('Ended')
  })

  it('replies to extend even when the run already ended', async () => {
    const { replies: first, worker } = await askAll(run('let x = 40; x + 2'))
    const result = first.find((r) => r.kind === 'result')
    expect(result).toBeDefined()

    const replies: RunReply[] = []
    const done = new Promise<void>((resolve) => {
      worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
        replies.push(e.data)
        if (e.data.kind === 'result') resolve()
      })
    })
    // A run that ended cannot produce more frames — worth pinning in its own right — but the reply
    // must still arrive; that is the whole point of this test.
    worker.postMessage({ kind: 'extend', gen: 1, leg: 'lambda' })
    await done
    worker.terminate()
    expect(replies.some((r) => r.kind === 'lambda-frames' && r.frames.length === 0 && r.done === 'ended')).toBe(true)
    expect(replies.some((r) => r.kind === 'result')).toBe(true)
  })
})
