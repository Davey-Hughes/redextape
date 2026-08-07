import { describe, expect, it } from 'vitest'
import type { RunReply, RunRequest } from '../../src/protocol'

function ask(req: RunRequest, timeoutMs = 30_000): Promise<RunReply> {
  const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
  return new Promise<RunReply>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('the worker did not reply in time'))
    }, timeoutMs)
    worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
      clearTimeout(timer)
      worker.terminate()
      resolve(e.data)
    })
    worker.postMessage(req)
  })
}

const run = (src: string, gen = 1, encoding = 'unary'): RunRequest => ({ kind: 'run', gen, src, encoding })

describe('session-worker', () => {
  it('drives the λ leg to a normal form and decodes both legs', async () => {
    const reply = await ask(run('let x = 40; x + 2'))
    expect(reply.kind).toBe('result')
    if (reply.kind !== 'result') return

    expect(reply.gen).toBe(1)
    expect(reply.lambda.status.run).toBe('Ended')
    expect(reply.lambda.state?.step).toBe(7)
    expect(reply.lambda.value).toEqual({ Value: { text: '42' } })
    expect(reply.tm.status.total_steps).toBe(2870)
    expect(reply.tm.value).toEqual({ Value: { text: '42' } })
  })

  it('answers no-session with diagnostics for a program that does not analyze', async () => {
    const reply = await ask(run('let x = ;'))
    expect(reply.kind).toBe('no-session')
    if (reply.kind !== 'no-session') return
    expect(reply.diagnostics.length).toBeGreaterThan(0)
    expect(reply.diagnostics[0]?.severity).toBe('Error')
  })

  it('still answers for the TM leg when the λ backend declines', async () => {
    const src = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'
    const reply = await ask(run(src))
    expect(reply.kind).toBe('result')
    if (reply.kind !== 'result') return
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
    const reply = await ask(run(src))
    expect(reply.kind).toBe('result')
    if (reply.kind !== 'result') return
    expect(reply.lambda.status.node).not.toBeNull()
    expect(reply.lambda.declinedSpan).not.toBeNull()
    const span = reply.lambda.declinedSpan
    if (!span) return
    expect(span.end).toBeGreaterThan(span.start)
    expect(span.end).toBeLessThanOrEqual(src.length)
  })

  it('carries the generation back unchanged', async () => {
    const reply = await ask(run('let x = 40; x + 2', 7))
    expect(reply.gen).toBe(7)
  })
})
