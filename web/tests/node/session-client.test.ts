import { describe, expect, it, vi } from 'vitest'
import type { RunReply, RunRequest } from '../../src/protocol'
import type { ClientPort } from '../../src/session-client'
import { SessionClient } from '../../src/session-client'

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
