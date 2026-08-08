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
    c.request('a', 'unary')
    c.request('b', 'unary')
    expect(sent.map((m) => m.gen)).toEqual([1, 2])
    expect(sent[1]).toEqual({ kind: 'run', gen: 2, src: 'b', encoding: 'unary' })
  })

  it('delivers a reply whose generation is current', () => {
    const { port, deliver } = fakePort()
    const onReply = vi.fn()
    const c = new SessionClient(port, onReply)
    c.request('a', 'unary')
    deliver(reply(1))
    expect(onReply).toHaveBeenCalledTimes(1)
  })

  it('drops a reply from a superseded generation', () => {
    const { port, deliver } = fakePort()
    const onReply = vi.fn()
    const c = new SessionClient(port, onReply)
    c.request('a', 'unary')
    c.request('b', 'unary')
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
    c.request('a', 'unary')
    c.request('b', 'unary')
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
    client.request('x', 'unary')
    deliver({
      kind: 'compiled',
      gen: 1,
      lambda: LAMBDA_OK,
      tm: TM_OK,
      declinedSpan: null,
      tmProgram: null,
      tapeNames: [],
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
    client.request('x', 'unary')
    client.request('y', 'unary')
    deliver({ kind: 'lambda-frames', gen: 1, frames: [], done: null })
    deliver({ kind: 'lambda-frames', gen: 2, frames: [], done: null })
    expect(seen).toEqual(['lambda-frames'])
  })

  it('extend addresses the current generation without advancing it', () => {
    const { port, sent } = fakePort()
    const client = new SessionClient(port, () => {})
    client.request('x', 'unary')
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
