import { describe, expect, it, vi } from 'vitest'
import type { RunReply, RunRequest } from '../../src/protocol'
import type { PoolPort } from '../../src/session-client'
import { SessionPool } from '../../src/session-client'

/**
 * A `PoolPort` with no thread behind it.
 *
 * THE WHOLE POINT OF `ClientPort` BEING STRUCTURAL (`session-client.ts:9-12`), one type up: the pool
 * is a map, a spawn on first bind and a `terminate` on unbind, and none of that needs a worker to
 * exercise. `terminated` is a COUNT rather than a boolean so a double-terminate is visible — the
 * failure a `has`-then-`delete` written in the wrong order would produce.
 */
type FakePort = PoolPort & { sent: RunRequest[]; terminated: number; deliver: (r: RunReply) => void }

function fakePort(): FakePort {
  let handler: ((e: { data: RunReply }) => void) | null = null
  const p: FakePort = {
    sent: [],
    terminated: 0,
    postMessage: (m: RunRequest) => p.sent.push(m),
    addEventListener: (_t: 'message', h: (e: { data: RunReply }) => void) => {
      handler = h
    },
    terminate: () => {
      p.terminated += 1
    },
    deliver: (r: RunReply) => handler?.({ data: r }),
  }
  return p
}

/**
 * A pool over recording fakes, plus every port it has ever spawned IN SPAWN ORDER.
 *
 * `ports` IS APPEND-ONLY AND IS NEVER PRUNED ON UNBIND, deliberately: a terminated port has to stay
 * reachable for the assertions that a later bind spawned a NEW one rather than handing back the dead
 * one, and for the assertions that unbinding one session left the others' ports alone.
 */
function harness(): { pool: SessionPool; ports: FakePort[] } {
  const ports: FakePort[] = []
  const pool = new SessionPool(() => {
    const p = fakePort()
    ports.push(p)
    return p
  })
  return { pool, ports }
}

const reply = (gen: number): RunReply => ({ kind: 'no-session', gen, diagnostics: [] })

describe('SessionPool', () => {
  it('spawns nothing until the first bind', () => {
    const { pool, ports } = harness()
    expect(ports).toEqual([])
    expect(pool.size).toBe(0)
    expect(pool.has('source')).toBe(false)
  })

  // DECISION 3 AT ITS SMALLEST (design §4.2): one worker per session, so two sessions is two threads.
  // The shared-worker implementation this task's mutation installs fails right here, before any of
  // the containment assertions below get a chance to.
  it('spawns one worker per session', () => {
    const { pool, ports } = harness()
    pool.bind('source', () => {})
    pool.bind('lambda-scratch', () => {})
    expect(ports.length).toBe(2)
    expect(ports[0]).not.toBe(ports[1])
    expect(pool.size).toBe(2)
    expect(pool.has('source')).toBe(true)
    expect(pool.has('lambda-scratch')).toBe(true)
  })

  it("a session's client posts to that session's port and to no other", () => {
    const { pool, ports } = harness()
    const source = pool.bind('source', () => {})
    pool.bind('lambda-scratch', () => {})
    source.request(source.supersede(), 'let x = 1; x', 'unary')
    expect(ports[0]?.sent).toEqual([{ kind: 'run', gen: 1, src: 'let x = 1; x', encoding: 'unary' }])
    expect(ports[1]?.sent).toEqual([])
  })

  // §3.2 — "the protocol needs no session id, because the port IS the id". Nothing posted above
  // carries an id, so this is the only thing that routes a reply, and it has to be shown routing.
  it('delivers a reply to the session whose port carried it', () => {
    const { pool, ports } = harness()
    const onSource = vi.fn()
    const onScratch = vi.fn()
    const source = pool.bind('source', onSource)
    const scratch = pool.bind('lambda-scratch', onScratch)
    source.request(source.supersede(), 'a', 'unary')
    scratch.request(scratch.supersede(), 'b', 'unary')

    ports[1]?.deliver(reply(1))
    expect(onScratch).toHaveBeenCalledTimes(1)
    expect(onSource).not.toHaveBeenCalled()
  })

  // GENERATIONS ARE PER SESSION AND ALWAYS WERE (§3.2): `SessionClient`'s `#gen` is private and per
  // instance, so two sessions BOTH sitting on generation 1 is correct and must not be mistaken for a
  // collision. Asserting the equal numbers as well as the independent delivery is the point — a pool
  // that "fixed" this by stamping ids into the protocol would fail the first line.
  it('gives each session its own generation counter, starting over at 1', () => {
    const { pool, ports } = harness()
    const source = pool.bind('source', () => {})
    const scratch = pool.bind('lambda-scratch', () => {})
    expect(source.supersede()).toBe(1)
    expect(scratch.supersede()).toBe(1)
    source.request(1, 'a', 'unary')
    scratch.request(1, 'b', 'unary')
    expect(ports[0]?.sent.at(-1)).toEqual({ kind: 'run', gen: 1, src: 'a', encoding: 'unary' })
    expect(ports[1]?.sent.at(-1)).toEqual({ kind: 'run', gen: 1, src: 'b', encoding: 'unary' })
  })

  // T3 (design §4.1): the step the pane was showing rides the wire beside the seed text, so
  // `session-worker.ts`'s `onLambdaScratch` can replay to it before forking — see `RunRequest`'s
  // `lambda-scratch` doc in `protocol.ts` for what `step` means.
  it('carries the fork step on the wire', () => {
    const { pool, ports } = harness()
    const client = pool.bind('lambda-scratch', () => {})
    client.scratch(client.supersede(), '\\y. y', 7)
    expect(ports[0]?.sent).toEqual([{ kind: 'lambda-scratch', gen: 1, src: '\\y. y', step: 7 }])
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

  it('terminates the worker on unbind and forgets the session', () => {
    const { pool, ports } = harness()
    pool.bind('source', () => {})
    pool.unbind('source')
    expect(ports[0]?.terminated).toBe(1)
    expect(pool.size).toBe(0)
    expect(pool.has('source')).toBe(false)
  })

  // THE NODE-TIER HALF OF THE ISOLATION CLAIM, and the cheap half: it shows the pool holds separate
  // handles. `tests/browser/pool-isolation.test.ts` is the half that shows the separation is real at
  // the thread level, which no fake can.
  //
  // THIS IS ALSO §4.3's RECOMPILE PATH IN MINIATURE — recompile-from-source terminates the scratch's
  // worker while the source session keeps running, so "unbind one, the rest live" is not a tidiness
  // property, it is the mechanism that path is built on.
  it('unbinding one session leaves every other session running', () => {
    const { pool, ports } = harness()
    const source = pool.bind('source', () => {})
    pool.bind('lambda-scratch', () => {})
    pool.bind('tm-scratch', () => {})

    pool.unbind('lambda-scratch')

    expect(ports[1]?.terminated).toBe(1)
    expect(ports[0]?.terminated).toBe(0)
    expect(ports[2]?.terminated).toBe(0)
    expect(pool.size).toBe(2)
    expect(pool.has('source')).toBe(true)
    expect(pool.has('tm-scratch')).toBe(true)
    // Still usable, not merely still listed: a surviving entry whose port stopped accepting posts
    // would satisfy every assertion above.
    source.request(source.supersede(), 'still here', 'unary')
    expect(ports[0]?.sent.at(-1)).toEqual({ kind: 'run', gen: 1, src: 'still here', encoding: 'unary' })
  })

  // §4.3 calls `unbind` on every recompile-from-source, and most recompiles happen with no scratch
  // in the pool at all. See `unbind`'s doc for why this is idempotent where `bind` throws.
  it('unbinding a session that has no worker does nothing', () => {
    const { pool, ports } = harness()
    pool.bind('source', () => {})
    expect(() => pool.unbind('lambda-scratch')).not.toThrow()
    expect(ports[0]?.terminated).toBe(0)
    expect(pool.size).toBe(1)
  })

  it('unbinding twice terminates once', () => {
    const { pool, ports } = harness()
    pool.bind('source', () => {})
    pool.unbind('source')
    pool.unbind('source')
    expect(ports[0]?.terminated).toBe(1)
  })

  // `terminate` + RESPAWN IS THE WHOLE RECOVERY STORY (§4.2), so the respawn half has to be a fresh
  // thread and not the dead one handed back. The generation restarting at 1 is the same fact from the
  // client's side: a new `SessionClient` was built over a new port.
  it('rebinding after unbind spawns a fresh worker', () => {
    const { pool, ports } = harness()
    const first = pool.bind('source', () => {})
    first.request(first.supersede(), 'a', 'unary')
    pool.unbind('source')

    const second = pool.bind('source', () => {})
    expect(ports.length).toBe(2)
    expect(ports[1]).not.toBe(ports[0])
    expect(second).not.toBe(first)
    expect(second.supersede()).toBe(1)
    second.request(1, 'b', 'unary')
    expect(ports[1]?.sent).toEqual([{ kind: 'run', gen: 1, src: 'b', encoding: 'unary' }])
    // The dead port heard nothing after it was terminated.
    expect(ports[0]?.sent.length).toBe(1)
  })

  // A reply arriving on a terminated session's port must not reach its handler — the pool dropped the
  // entry, but the listener the client registered in its constructor is still attached to the fake.
  // A real `Worker.terminate()` stops the thread, so this cannot happen in the app; asserting it here
  // pins that the pool's own bookkeeping does not depend on that.
  it('a client whose session was unbound is unreachable from the pool', () => {
    const { pool, ports } = harness()
    const onSource = vi.fn()
    const source = pool.bind('source', onSource)
    source.request(source.supersede(), 'a', 'unary')
    pool.unbind('source')
    expect(pool.has('source')).toBe(false)
    // The handle the caller still holds is not revoked — nothing can revoke a JS reference — so this
    // documents the boundary rather than asserting silence: the POOL forgot it, the closure did not.
    ports[0]?.deliver(reply(1))
    expect(onSource).toHaveBeenCalledTimes(1)
  })
})
