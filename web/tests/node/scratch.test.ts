import { describe, expect, it } from 'vitest'
import { History } from '../../src/history'
import type { RunReply, RunRequest } from '../../src/protocol'
import { LambdaScratchpad } from '../../src/scratch'
import type { ClientPort, PoolPort, SessionId } from '../../src/session-client'
import { SessionClient, SessionPool } from '../../src/session-client'
import type { LegState, SessionEntry } from '../../src/sessions'
import { PaneSlot, SessionRegistry } from '../../src/sessions'
import type { LambdaState } from '../../src/types'

/**
 * **DETACH IS A FORK, AND SCRATCHPADS ARE SINGLETONS** — design §4.3, plan T8, at the level where the
 * rule is decided rather than where it is rendered.
 *
 * THE PLAN IS EXPLICIT THAT THE SINGLETON MUST BE ASSERTED ON POOL SIZE AND NOT ON RENDERING, because
 * "rendering looks right either way": two panes bound to two DIFFERENT `LambdaScratch` sessions
 * showing the same term look exactly like two panes bound to one. Pool size is not reachable from the
 * DOM, and the app has one λ pane, so "two source-derived λ panes edited in turn" cannot be performed
 * through the app at all — the same wall T7 hit and answered by making the registry a module.
 *
 * FAKE PORTS, REAL EVERYTHING ELSE. The registry, the pool, the clients, the slots and the scratchpad
 * are the app's own objects; only the thread is a recording fake, which is what `ClientPort` is
 * structural for (`session-client.ts:9-12`). `tests/browser/scratch-fork.test.ts` drives the same
 * class over real `session-worker.ts` threads for the two claims a fake port cannot make: that the
 * source session goes on stepping across a detach, and that a retired scratchpad's worker is GONE.
 */

const SOURCE: SessionId = 'source'
const SCRATCH: SessionId = 'lambda-scratch'

/**
 * A `PoolPort` with no thread behind it, recording what was posted and how often it was killed.
 *
 * `terminated` IS A COUNT, NOT A BOOLEAN, for `session-pool.test.ts`'s reason: a double-terminate is
 * a real failure mode and a boolean cannot see one.
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

/** The app's own objects over fake threads, plus every port spawned, in spawn order. */
function harness(): {
  reg: SessionRegistry
  pool: SessionPool
  pad: LambdaScratchpad
  ports: FakePort[]
  replies: RunReply[]
} {
  const ports: FakePort[] = []
  const replies: RunReply[] = []
  const reg = new SessionRegistry()
  const pool = new SessionPool(() => {
    const p = fakePort()
    ports.push(p)
    return p
  })
  const pad = new LambdaScratchpad({
    registry: reg,
    pool,
    id: SCRATCH,
    label: 'λ scratchpad',
    historyBytes: 1_000_000,
    onReply: (r) => replies.push(r),
  })
  return { reg, pool, pad, ports, replies }
}

const lambdaFrame = (text: string, step = 0): LambdaState => ({
  text,
  spans: [],
  cut: null,
  step,
  redex_span: null,
  owner: 'None',
})

/** A `ClientPort` with no thread behind it — the source entry needs a client and nothing posts to it. */
function fakeClient(): SessionClient {
  const port: ClientPort = { postMessage: () => undefined, addEventListener: () => undefined }
  return new SessionClient(port, () => undefined)
}

/**
 * The source session, with both legs and one recorded λ frame.
 *
 * ITS CLIENT IS NOT THE POOL'S. Nothing in this file drives the source session's thread, and giving it
 * one through `pool.bind` would put a second entry in the pool and make every `pool.size` assertion
 * below read one higher for a reason that has nothing to do with the scratchpad. The browser tier
 * binds it for real.
 */
function sourceEntry(text = 'from source'): SessionEntry {
  const hist = new History<LambdaState>(1_000_000)
  hist.push(lambdaFrame(text), 1)
  const lambda: LegState<LambdaState> = { hist, status: { available: true, reason: '' }, done: null, timer: null }
  return { id: SOURCE, label: 'source', detached: false, client: fakeClient(), legs: { lambda } }
}

describe('LambdaScratchpad.detach', () => {
  it('creates the scratchpad on the first detach, seeded with the text the pane passed', () => {
    const { reg, pool, pad, ports } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)

    expect(pool.has(SCRATCH)).toBe(false)
    expect(reg.has(SCRATCH)).toBe(false)
    pad.detach(slot, '(λx. x) 1')

    expect(pool.has(SCRATCH)).toBe(true)
    expect(reg.has(SCRATCH)).toBe(true)
    expect(pool.size).toBe(1)
    expect(ports.length).toBe(1)
    // THE SEED IS ON THE WIRE, and it is the pane's text rather than anything re-derived from the leg
    // — the source leg's frame says `'from source'`. `gen: 1` is `supersede` claiming the fresh
    // client's first generation before the post, without which `scratch` would drop its own message
    // (generation 0 matches nothing).
    expect(ports[0]?.sent).toEqual([{ kind: 'lambda-scratch', gen: 1, src: '(λx. x) 1' }])
    // The pane moved, and it moved to the scratchpad rather than to a session that merely exists.
    expect(slot.binding).toEqual({ session: SCRATCH, leg: 'lambda' })
  })

  /**
   * **THE SOURCE SESSION IS UNTOUCHED, WHICH IS THE ENTIRE REASON THREE SESSIONS EXIST** (§4.3). Here
   * that is asserted structurally — its entry, its client and its history are the same objects,
   * nothing was posted to its port, and its frames are still there. The browser tier asserts the
   * behavioural half a fake port cannot: that it goes on STEPPING across a detach.
   */
  it('leaves the source session entirely alone', () => {
    const { reg, pad } = harness()
    const source = sourceEntry()
    reg.add(source)
    const slot = new PaneSlot('lambda', SOURCE)

    pad.detach(slot, 'λy. y')

    expect(reg.entryOf(SOURCE)).toBe(source)
    expect(reg.entryOf(SOURCE).client).toBe(source.client)
    expect(reg.legOf({ session: SOURCE, leg: 'lambda' }).hist.current?.text).toBe('from source')
    expect(reg.entryOf(SOURCE).detached).toBe(false)
  })

  /**
   * **THE SINGLETON, ON POOL SIZE.** Two source-derived λ panes detached in turn produce ONE
   * `LambdaScratch`: one worker, one registry entry, one seed on the wire.
   *
   * THE SECOND DETACH POSTS NOTHING, which is §4.3's "rebinds to the EXISTING scratch" as distinct
   * from "makes another one that happens to reuse the id". An implementation that re-seeded on every
   * detach would keep `pool.size` at 1 and pass every size assertion here while silently throwing the
   * first pane's scratchpad away — so the wire is asserted too, and it still says `'first'`.
   *
   * BOTH PANES END UP ON IT, which is the other half: a singleton nobody can join is just a session.
   */
  it('rebinds a second pane to the existing scratchpad instead of making a second one', () => {
    const { reg, pool, pad, ports } = harness()
    reg.add(sourceEntry())
    const a = new PaneSlot('lambda', SOURCE)
    const b = new PaneSlot('lambda', SOURCE)

    pad.detach(a, 'first')
    pad.detach(b, 'second')

    expect(pool.size).toBe(1)
    expect(reg.size).toBe(2)
    expect(ports.length).toBe(1)
    expect(ports[0]?.sent).toEqual([{ kind: 'lambda-scratch', gen: 1, src: 'first' }])
    expect(a.binding.session).toBe(SCRATCH)
    expect(b.binding.session).toBe(SCRATCH)
    // Neither container was asked to hold the id twice — both of them THROW on that, and this is the
    // one branch in `detach` that keeps them from being asked.
    expect(reg.options('lambda')).toEqual([
      { id: SOURCE, label: 'source' },
      { id: SCRATCH, label: 'λ scratchpad' },
    ])
  })

  // Detaching a pane already on the scratchpad is the degenerate case of the line above, and it must
  // not spawn, re-seed or throw — `pool.bind` and `SessionRegistry.add` both throw on a live id, and
  // the singleton branch is what they are relying on (both docs say so).
  it('is a no-op for a pane already bound to the scratchpad', () => {
    const { reg, pool, pad, ports } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)

    pad.detach(slot, 'first')
    expect(() => pad.detach(slot, 'again')).not.toThrow()

    expect(pool.size).toBe(1)
    expect(ports[0]?.sent.length).toBe(1)
    expect(slot.binding.session).toBe(SCRATCH)
  })

  // The scratchpad's entry is `detached: true` BY CONSTRUCTION (§3.3: no `linkIndex`, no `sourceSpan`
  // on either scratch type), which is what makes §4.5's two surfaces one lookup — `PaneSlot.render`
  // reads this field for the badge and `main.ts`'s `detachedPanes` reads it for the sentence.
  it('registers the scratchpad detached, with one leg and no TM leg', () => {
    const { reg, pad } = harness()
    reg.add(sourceEntry())
    pad.detach(new PaneSlot('lambda', SOURCE), 'λx. x')

    const entry = reg.entryOf(SCRATCH)
    expect(entry.detached).toBe(true)
    expect(entry.label).toBe('λ scratchpad')
    expect(entry.legs.tm).toBeUndefined()
    expect(entry.legs.lambda?.status).toEqual({ available: false, reason: 'building…' })
    // A λ-only session must not be offered to a TM slot: `legOf` throws for a leg a session lacks, and
    // `options` is what keeps a selector from producing such a binding in the first place.
    expect(reg.options('tm')).toEqual([])
  })

  // The frames a scratchpad's worker posts land in the scratchpad's own leg, which is what the client
  // the pool handed back is for. Delivered through the fake port so the whole path — port listener,
  // generation filter, `onReply` — is the app's.
  it('routes its own replies to the caller that asked for them', () => {
    const { reg, pad, ports, replies } = harness()
    reg.add(sourceEntry())
    pad.detach(new PaneSlot('lambda', SOURCE), 'λx. x')

    ports[0]?.deliver({
      kind: 'scratch-compiled',
      gen: 1,
      lambda: { available: true, reason: '', node: null, run: 'Running' },
    })
    expect(replies).toEqual([
      { kind: 'scratch-compiled', gen: 1, lambda: { available: true, reason: '', node: null, run: 'Running' } },
    ])
  })
})

describe('LambdaScratchpad.retire', () => {
  /**
   * **RECOMPILE-FROM-SOURCE TERMINATES THE SCRATCH'S WORKER AND REBINDS ITS PANES BACK** (§4.3),
   * deliberately the same mechanism as §4.2's poison recovery.
   *
   * `terminated` IS THE ASSERTION THAT MATTERS AND `pool.size` IS NOT. The plan says so in as many
   * words — "assert the worker is gone, not merely that panes rebound. Otherwise the leak passes" —
   * and a `retire` that forgot `pool.unbind` would satisfy the registry, the bindings and the panes
   * while leaving a wasm module and its 8.45 MB baseline (T9's measurement) running forever.
   */
  it('terminates the worker, forgets the session, and brings its panes home', () => {
    const { reg, pool, pad, ports } = harness()
    reg.add(sourceEntry())
    const a = new PaneSlot('lambda', SOURCE)
    const b = new PaneSlot('lambda', SOURCE)
    pad.detach(a, 'λx. x')
    pad.detach(b, 'λx. x')

    expect(pad.retire(SOURCE, [a, b])).toBe(true)

    expect(ports[0]?.terminated).toBe(1)
    expect(pool.size).toBe(0)
    expect(pool.has(SCRATCH)).toBe(false)
    expect(reg.size).toBe(1)
    expect(reg.has(SCRATCH)).toBe(false)
    expect(a.binding).toEqual({ session: SOURCE, leg: 'lambda' })
    expect(b.binding).toEqual({ session: SOURCE, leg: 'lambda' })
  })

  // A slot that was never on the scratchpad must not be dragged home by someone else's retirement —
  // the TM pane is bound to the source session's TM leg throughout, and `retire` is handed both slots
  // by `main.ts` because it cannot know which of them detached.
  it('moves only the panes that were on the scratchpad', () => {
    const { reg, pad } = harness()
    const source = sourceEntry()
    source.legs.tm = {
      hist: new History(1_000_000),
      status: { available: true, reason: '' },
      done: null,
      timer: null,
    }
    reg.add(source)
    const lambda = new PaneSlot('lambda', SOURCE)
    const tm = new PaneSlot('tm', SOURCE)
    pad.detach(lambda, 'λx. x')

    pad.retire(SOURCE, [lambda, tm])
    expect(lambda.binding).toEqual({ session: SOURCE, leg: 'lambda' })
    expect(tm.binding).toEqual({ session: SOURCE, leg: 'tm' })
  })

  /**
   * A RETIRED SESSION'S PLAY TIMER MUST NOT SURVIVE IT. `SessionRegistry.remove` deletes a map key and
   * cannot see a running `setInterval`; `add`'s own doc names the leak ("a stranded `setInterval` on a
   * `LegState` nothing can reach any more"), and `resetLegs` inside `retire` is what pays it off.
   *
   * A REAL TIMER, NOT A SPY. The failure this guards is an interval that goes on firing, and only a
   * real one can be observed as cleared — `leg.timer === null` is `resetLegs`'s own record of having
   * called `clearInterval`, and holding the `LegState` after the entry is gone is exactly what a leaked
   * play head does.
   */
  it('stops the retired scratchpad’s playback rather than stranding it', () => {
    const { reg, pad } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)
    pad.detach(slot, 'λx. x')

    const leg = reg.legOf({ session: SCRATCH, leg: 'lambda' })
    leg.hist.push(lambdaFrame('λx. x'), 1)
    leg.done = 'ended'
    leg.timer = setInterval(() => undefined, 1_000)

    pad.retire(SOURCE, [slot])

    expect(leg.timer).toBe(null)
    expect(leg.done).toBe(null)
    expect(leg.hist.length).toBe(0)
  })

  /**
   * IDEMPOTENT AND CHEAP, WHICH IS WHAT ITS CALLER NEEDS: `main.ts` calls this from `schedule`, which
   * runs on every keystroke, and most recompiles happen with no scratchpad in existence at all.
   *
   * THE RETURN VALUE IS THE WHOLE REASON IT IS NOT `void`. `false` is what keeps `schedule` from
   * repainting both panes on a keystroke that changed nothing — the waste the editor's update listener
   * documents declining to pay.
   */
  it('answers false and touches nothing when there is no scratchpad', () => {
    const { reg, pool, pad, ports } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)

    expect(pad.retire(SOURCE, [slot])).toBe(false)
    expect(ports.length).toBe(0)
    expect(pool.size).toBe(0)
    expect(slot.binding.session).toBe(SOURCE)

    pad.detach(slot, 'λx. x')
    expect(pad.retire(SOURCE, [slot])).toBe(true)
    expect(pad.retire(SOURCE, [slot])).toBe(false)
    expect(ports[0]?.terminated).toBe(1)
  })

  // §4.3's cycle in full: fork, retire, fork again. The second fork must get a NEW thread rather than
  // the terminated one — `terminate` + respawn is §4.2's "resets both", and a pool that handed back
  // the dead port would satisfy every count above and answer nothing ever again.
  it('lets a later detach build a fresh scratchpad on a new thread', () => {
    const { reg, pad, ports } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)

    pad.detach(slot, 'first')
    pad.retire(SOURCE, [slot])
    pad.detach(slot, 'second')

    expect(ports.length).toBe(2)
    expect(ports[0]).not.toBe(ports[1])
    expect(ports[1]?.sent).toEqual([{ kind: 'lambda-scratch', gen: 1, src: 'second' }])
    expect(ports[1]?.terminated).toBe(0)
    expect(slot.binding.session).toBe(SCRATCH)
  })
})
