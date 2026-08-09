import { describe, expect, it, vi } from 'vitest'
import type { LambdaLeg, RunReply, RunRequest, TmLeg } from '../../src/protocol'
import type { ClientPort } from '../../src/session-client'
import { SessionClient } from '../../src/session-client'
import type { LambdaStatus, TmStatus } from '../../src/types'

function fakePort() {
  const sent: RunRequest[] = []
  let handler: ((e: { data: RunReply }) => void) | null = null
  const port: ClientPort = {
    postMessage: (m) => sent.push(m),
    addEventListener: (_t, h) => {
      handler = h
    },
  }
  return { port, sent, deliver: (data: RunReply) => handler?.({ data }) }
}

const reply = (gen: number): RunReply => ({ kind: 'no-session', gen, diagnostics: [] })

describe('SessionClient', () => {
  it('stamps each request with a fresh generation', () => {
    const { port, sent } = fakePort()
    const c = new SessionClient(port, () => {})
    c.request(c.supersede(), 'a', 'unary')
    c.request(c.supersede(), 'b', 'unary')
    expect(sent.map((m) => m.gen)).toEqual([1, 2])
    expect(sent[1]).toEqual({ kind: 'run', gen: 2, src: 'b', encoding: 'unary' })
  })

  it('delivers a reply whose generation is current', () => {
    const { port, deliver } = fakePort()
    const onReply = vi.fn()
    const c = new SessionClient(port, onReply)
    c.request(c.supersede(), 'a', 'unary')
    deliver(reply(1))
    expect(onReply).toHaveBeenCalledTimes(1)
  })

  it('drops a reply from a superseded generation', () => {
    const { port, deliver } = fakePort()
    const onReply = vi.fn()
    const c = new SessionClient(port, onReply)
    c.request(c.supersede(), 'a', 'unary')
    c.request(c.supersede(), 'b', 'unary')
    deliver(reply(1))
    expect(onReply).not.toHaveBeenCalled()
    deliver(reply(2))
    expect(onReply).toHaveBeenCalledTimes(1)
  })

  // The worker abandons superseded work at a chunk boundary; a reply already in flight when the next
  // request is posted slips past that check. This is the second guard, and it is why there are two.
  it('drops an out-of-order reply that arrives after a newer one', () => {
    const { port, deliver } = fakePort()
    const onReply = vi.fn()
    const c = new SessionClient(port, onReply)
    c.request(c.supersede(), 'a', 'unary')
    c.request(c.supersede(), 'b', 'unary')
    deliver(reply(2))
    deliver(reply(1))
    expect(onReply).toHaveBeenCalledTimes(1)
    expect(onReply.mock.calls[0]?.[0]).toEqual(reply(2))
  })

  it('ignores a reply that arrives before any request', () => {
    const { port, deliver } = fakePort()
    const onReply = vi.fn()
    new SessionClient(port, onReply)
    deliver(reply(0))
    expect(onReply).not.toHaveBeenCalled()
  })
})

describe('SessionClient streaming', () => {
  const LAMBDA_OK: LambdaStatus = { available: true, reason: '', node: null, run: 'Ended' }
  const TM_OK: TmStatus = { available: true, reason: '', width: 4, run: 'Ended', total_steps: 1 }
  const LEG_OK: LambdaLeg = { status: LAMBDA_OK, state: null, value: null, declinedSpan: null }
  const TM_LEG_OK: TmLeg = { status: TM_OK, value: null }

  it('delivers every reply for the current generation, not just the first', () => {
    const seen: string[] = []
    const { port, deliver } = fakePort()
    const client = new SessionClient(port, (r) => seen.push(r.kind))
    client.request(client.supersede(), 'x', 'unary')
    deliver({
      kind: 'compiled',
      gen: 1,
      lambda: LAMBDA_OK,
      tm: TM_OK,
      declinedSpan: null,
      tmProgram: null,
      tapeNames: [],
      linkIndex: null,
    })
    deliver({ kind: 'lambda-frames', gen: 1, frames: [], done: null })
    deliver({ kind: 'lambda-frames', gen: 1, frames: [], done: 'ended' })
    deliver({ kind: 'result', gen: 1, lambda: LEG_OK, tm: TM_LEG_OK })
    expect(seen).toEqual(['compiled', 'lambda-frames', 'lambda-frames', 'result'])
  })

  it('drops every reply from a superseded generation', () => {
    const seen: string[] = []
    const { port, deliver } = fakePort()
    const client = new SessionClient(port, (r) => seen.push(r.kind))
    client.request(client.supersede(), 'x', 'unary')
    client.request(client.supersede(), 'y', 'unary')
    deliver({ kind: 'lambda-frames', gen: 1, frames: [], done: null })
    deliver({ kind: 'lambda-frames', gen: 2, frames: [], done: null })
    expect(seen).toEqual(['lambda-frames'])
  })

  it('extend addresses the current generation without advancing it', () => {
    const { port, sent } = fakePort()
    const client = new SessionClient(port, () => {})
    client.request(client.supersede(), 'x', 'unary')
    client.extend('lambda')
    expect(sent.at(-1)).toEqual({ kind: 'extend', gen: 1, leg: 'lambda' })
    client.extend('tm')
    expect(sent.at(-1)).toEqual({ kind: 'extend', gen: 1, leg: 'tm' })
  })

  it('ignores extend before any request', () => {
    const { port, sent } = fakePort()
    const client = new SessionClient(port, () => {})
    client.extend('lambda')
    expect(sent).toEqual([])
  })
})

// `port()` returns a `ClientPort` with `sent`/`deliver` at the top level rather than alongside it
// (contrast `fakePort()` above) because these tests read `p.sent`/`p.deliver` off the same value
// they pass to the constructor — there is no separate `port` to thread through.
function port(): ClientPort & { sent: RunRequest[]; deliver: (r: RunReply) => void } {
  const sent: RunRequest[] = []
  let handler: ((e: { data: RunReply }) => void) | null = null
  return {
    sent,
    postMessage: (m: RunRequest) => sent.push(m),
    addEventListener: (_t: 'message', h: (e: { data: RunReply }) => void) => {
      handler = h
    },
    deliver: (r: RunReply) => handler?.({ data: r }),
  }
}

const compiled = (gen: number): RunReply => ({
  kind: 'compiled',
  gen,
  lambda: { available: true, reason: '', node: null, run: 'Running' },
  tm: { available: true, reason: '', width: null, run: 'Running', total_steps: null },
  declinedSpan: null,
  tmProgram: null,
  tapeNames: [],
  linkIndex: null,
})

describe('SessionClient generation', () => {
  it('drops the previous generation as soon as supersede is called, before request posts', () => {
    const p = port()
    const seen: number[] = []
    const c = new SessionClient(p, (r) => seen.push(r.gen))

    const g1 = c.supersede()
    c.request(g1, 'a', 'binary')
    p.deliver(compiled(g1))
    expect(seen).toEqual([g1])

    // A new dispatch. The OLD generation's reply is now stale even though `request` has not run yet —
    // this is the whole defect: the debounce used to leave a 300 ms window where it was still current.
    c.supersede()
    p.deliver(compiled(g1))
    expect(seen).toEqual([g1])
  })

  it('a request whose generation was superseded during the debounce never posts', () => {
    const p = port()
    const c = new SessionClient(p, () => {})

    const g1 = c.supersede()
    const g2 = c.supersede()
    c.request(g1, 'stale', 'binary')
    expect(p.sent).toEqual([])

    c.request(g2, 'fresh', 'binary')
    expect(p.sent).toEqual([{ kind: 'run', gen: g2, src: 'fresh', encoding: 'binary' }])
  })

  it('extend addresses the current generation and does not advance it', () => {
    const p = port()
    const c = new SessionClient(p, () => {})
    const g = c.supersede()
    c.request(g, 'a', 'binary')
    c.extend('lambda')
    expect(p.sent[1]).toEqual({ kind: 'extend', gen: g, leg: 'lambda' })
  })
})
