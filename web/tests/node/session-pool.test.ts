import { describe, expect, it, vi } from 'vitest'
import { SessionPool } from '../../src/session-client'
import { type FakePort, fakePort, noSessionReply } from './session-fixtures'

/**
 * A pool over recording fakes, plus every port it has ever spawned IN SPAWN ORDER.
 */
function harness(): { pool: SessionPool; ports: FakePort[] } {
  const ports: FakePort[] = []
  const pool = new SessionPool(
    () => {
      const p = fakePort()
      ports.push(p)
      return p
    },
    () => {},
  )
  return { pool, ports }
}

describe('SessionPool', () => {
  it('spawns nothing until the first bind', () => {
    const { pool, ports } = harness()
    expect(ports).toEqual([])
    expect(pool.size).toBe(0)
    expect(pool.has('source')).toBe(false)
  })

  // DECISION 3 AT ITS SMALLEST (5d-i design §4.2): one worker per session, so two sessions is two
  // threads. A shared-worker implementation fails right here, before any of the containment assertions
  // below get a chance to.
  it('spawns one worker per session', () => {
    const { pool, ports } = harness()
    pool.bind('source', () => {})
    pool.bind('second', () => {})
    expect(ports.length).toBe(2)
    expect(ports[0]).not.toBe(ports[1])
    expect(pool.size).toBe(2)
    expect(pool.has('source')).toBe(true)
    expect(pool.has('second')).toBe(true)
  })

  it("a session's client posts to that session's port and to no other", () => {
    const { pool, ports } = harness()
    const source = pool.bind('source', () => {})
    pool.bind('second', () => {})
    source.request(source.supersede(), 'let x = 1; x', 'unary')
    expect(ports[0]?.sent).toEqual([{ kind: 'run', gen: 1, src: 'let x = 1; x', encoding: 'unary', clif: null }])
    expect(ports[1]?.sent).toEqual([])
  })

  // 5d-i design §3.2 — "the protocol needs no session id, because the port IS the id". Nothing posted
  // above carries an id, so this is the only thing that routes a reply, and it has to be shown routing.
  it('delivers a reply to the session whose port carried it', () => {
    const { pool, ports } = harness()
    const onSource = vi.fn()
    const onSecond = vi.fn()
    const source = pool.bind('source', onSource)
    const second = pool.bind('second', onSecond)
    source.request(source.supersede(), 'a', 'unary')
    second.request(second.supersede(), 'b', 'unary')

    ports[1]?.deliver(noSessionReply(1))
    expect(onSecond).toHaveBeenCalledTimes(1)
    expect(onSource).not.toHaveBeenCalled()
  })

  // GENERATIONS ARE PER SESSION (5d-i design §3.2): `SessionClient`'s `#gen` is private and per
  // instance, so two sessions BOTH sitting on generation 1 is correct and must not be mistaken for a
  // collision. Asserting the equal numbers as well as the independent delivery is the point — a pool
  // that "fixed" this by stamping ids into the protocol would fail the first line.
  it('gives each session its own generation counter, starting over at 1', () => {
    const { pool, ports } = harness()
    const source = pool.bind('source', () => {})
    const second = pool.bind('second', () => {})
    expect(source.supersede()).toBe(1)
    expect(second.supersede()).toBe(1)
    source.request(1, 'a', 'unary')
    second.request(1, 'b', 'unary')
    expect(ports[0]?.sent.at(-1)).toEqual({ kind: 'run', gen: 1, src: 'a', encoding: 'unary', clif: null })
    expect(ports[1]?.sent.at(-1)).toEqual({ kind: 'run', gen: 1, src: 'b', encoding: 'unary', clif: null })
  })

  // A `SessionClient` takes exactly one `onReply` at construction, so a second bind cannot be
  // honoured — see `bind`'s doc for why that is a throw rather than a silent hand-back.
  it('refuses to bind a session that already has a worker', () => {
    const { pool, ports } = harness()
    pool.bind('source', () => {})
    expect(() => pool.bind('source', () => {})).toThrow(/already has a worker/)
    expect(ports.length).toBe(1)
    expect(pool.size).toBe(1)
  })
})
