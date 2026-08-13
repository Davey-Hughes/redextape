import { describe, expect, it } from 'vitest'
import { History } from '../../src/history'
import type { RunReply, RunRequest } from '../../src/protocol'
import { BufferCapReached, MAX_BUFFERS, ScratchBuffers } from '../../src/scratch'
import type { ClientPort, PoolPort, SessionId } from '../../src/session-client'
import { SessionClient, SessionPool } from '../../src/session-client'
import type { LegState, SessionEntry } from '../../src/sessions'
import { PaneSlot, SessionRegistry } from '../../src/sessions'
import type { LambdaState } from '../../src/types'

/**
 * **A FORK MINTS A BUFFER** — 5d-ii-c design decision 1, at the level where the rule is decided rather
 * than where it is rendered.
 *
 * **THIS FILE USED TO ASSERT THE OPPOSITE, AND THE AXIS DID NOT MOVE.** Its heading read "DETACH IS A
 * FORK, AND SCRATCHPADS ARE SINGLETONS", and 5d-i's plan required that claim be asserted on POOL SIZE
 * rather than on rendering, because "rendering looks right either way": two panes bound to two
 * DIFFERENT `LambdaScratch` sessions showing the same term look exactly like two panes bound to one.
 * That reasoning survives its conclusion — pool size is still the only place the difference is
 * visible, so the assertions here INVERT (`pool.size` grows per fork) rather than disappear.
 *
 * FAKE PORTS, REAL EVERYTHING ELSE. The registry, the pool, the clients, the slots and the buffers are
 * the app's own objects; only the thread is a recording fake, which is what `ClientPort` is structural
 * for (`session-client.ts:9-12`). `tests/browser/scratch-fork.test.ts` drives the same class over real
 * `session-worker.ts` threads for the two claims a fake port cannot make: that the source session goes
 * on stepping across a fork, and that a retired buffer's worker is GONE.
 */

const SOURCE: SessionId = 'source'

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

/**
 * The app's own objects over fake threads, plus every port spawned, in spawn order.
 *
 * `replies` RECORDS THE SESSION AS WELL AS THE REPLY, which is new and is not bookkeeping. One
 * `ScratchBuffers` now owns many buffers over one `onReply` dependency, so the id has to be curried in
 * per buffer at `pool.bind` — and a callback that forgot to would still deliver every reply, just
 * under the wrong name. Recording the pair is what lets a test see the difference.
 */
function harness(): {
  reg: SessionRegistry
  pool: SessionPool
  buffers: ScratchBuffers
  ports: FakePort[]
  replies: { session: SessionId; reply: RunReply }[]
} {
  const ports: FakePort[] = []
  const replies: { session: SessionId; reply: RunReply }[] = []
  const reg = new SessionRegistry()
  const pool = new SessionPool(() => {
    const p = fakePort()
    ports.push(p)
    return p
  })
  const buffers = new ScratchBuffers({
    registry: reg,
    pool,
    historyBytes: 1_000_000,
    onReply: (session, reply) => replies.push({ session, reply }),
  })
  return { reg, pool, buffers, ports, replies }
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
 * below read one higher for a reason that has nothing to do with any buffer. The browser tier binds it
 * for real.
 */
function sourceEntry(text = 'from source'): SessionEntry {
  const hist = new History<LambdaState>(1_000_000)
  hist.push(lambdaFrame(text), 1)
  const lambda: LegState<LambdaState> = { hist, status: { available: true, reason: '' }, done: null, timer: null }
  // NO MACHINE — nothing here sends a `compiled` reply, which is the only thing that retains one.
  return { id: SOURCE, label: 'source', detached: false, client: fakeClient(), legs: { lambda }, tmProgram: null }
}

describe('ScratchBuffers.fork', () => {
  it('creates a buffer on the first fork, seeded with the text the pane passed', () => {
    const { reg, pool, buffers, ports } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)

    expect(pool.size).toBe(0)
    expect(reg.size).toBe(1)
    const id = buffers.fork(slot, '(λx. x) 1', 0)

    expect(pool.has(id)).toBe(true)
    expect(reg.has(id)).toBe(true)
    expect(pool.size).toBe(1)
    expect(ports.length).toBe(1)
    // THE SEED IS ON THE WIRE, and it is the pane's text rather than anything re-derived from the leg
    // — the source leg's frame says `'from source'`. `gen: 1` is `supersede` claiming the fresh
    // client's first generation before the post, without which `scratch` would drop its own message
    // (generation 0 matches nothing).
    expect(ports[0]?.sent).toEqual([{ kind: 'lambda-scratch', gen: 1, src: '(λx. x) 1', step: 0 }])
    // The pane moved, and it moved to the buffer `fork` MINTED rather than to a session that merely
    // exists. `detach` returned `void` and this test used to name the id from a module constant; the
    // returned id is now the only place that name is written down (design §4.1).
    expect(slot.binding).toEqual({ session: id, leg: 'lambda' })
  })

  // T4 — design §4.1: `step` says how far the worker replays `src` before forking
  // (`session-worker.ts`'s `onLambdaScratch`), and `fork` is handed it rather than resolving it — see
  // `fork`'s own doc. A hard-coded `step: 0` here would pass every OTHER assertion in this file, since
  // every other call site happens to pass `0`; this is the one that pins the real value.
  it('posts the step it was forked at', () => {
    const { reg, buffers, ports } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)

    buffers.fork(slot, '(λx. x) 1', 7)

    expect(ports[0]?.sent).toEqual([{ kind: 'lambda-scratch', gen: 1, src: '(λx. x) 1', step: 7 }])
  })

  /**
   * **THE SOURCE SESSION IS UNTOUCHED, WHICH IS THE ENTIRE REASON THREE SESSIONS EXIST** (5d-i §4.3).
   * Here that is asserted structurally — its entry, its client and its history are the same objects,
   * nothing was posted to its port, and its frames are still there. The browser tier asserts the
   * behavioural half a fake port cannot: that it goes on STEPPING across a fork.
   */
  it('leaves the source session entirely alone', () => {
    const { reg, buffers } = harness()
    const source = sourceEntry()
    reg.add(source)
    const slot = new PaneSlot('lambda', SOURCE)

    buffers.fork(slot, 'λy. y', 0)

    expect(reg.entryOf(SOURCE)).toBe(source)
    expect(reg.entryOf(SOURCE).client).toBe(source.client)
    expect(reg.legOf({ session: SOURCE, leg: 'lambda' }).hist.current?.text).toBe('from source')
    expect(reg.entryOf(SOURCE).detached).toBe(false)
  })

  /**
   * **THE SINGLETON'S OWN ASSERTION, INVERTED.** This test used to be called "rebinds a second pane to
   * the existing scratchpad instead of making a second one" and asserted `pool.size` was 1 after two
   * detaches. 5d-i's plan chose that axis because rendering looks right either way; decision 1 changes
   * the expected number on it, not the axis.
   *
   * BOTH CONTAINERS, BECAUSE THE OLD RULE WAS THAT NEITHER MAY BE ASKED TWICE. `SessionRegistry.add`
   * and `SessionPool.bind` both throw on an id they already hold, and `fork`'s removed `has` branch was
   * what kept them from being asked; a `fork` that reused a name would now throw rather than quietly
   * rebind, so registering both ids is the claim that the minted names really are fresh.
   *
   * THE SELECTOR SEES BOTH WITH NO NEW CODE — design §3.2. `options('lambda')` is the list every pane's
   * binding picker is built from, and this is where a buffer's LABEL becomes user-visible text.
   */
  it('mints a new buffer per fork rather than rebinding to one', () => {
    const { reg, pool, buffers } = harness()
    reg.add(sourceEntry())
    const a = new PaneSlot('lambda', SOURCE)
    const b = new PaneSlot('lambda', SOURCE)

    const first = buffers.fork(a, 'x', 0)
    const second = buffers.fork(b, 'y', 0)

    expect(first).not.toBe(second)
    expect(pool.size).toBe(2)
    expect(reg.has(first)).toBe(true)
    expect(reg.has(second)).toBe(true)
    expect(a.binding.session).toBe(first)
    expect(b.binding.session).toBe(second)
    expect(reg.options('lambda')).toEqual([
      { id: SOURCE, label: 'source' },
      { id: first, label: 'scratch 1' },
      { id: second, label: 'scratch 2' },
    ])
  })

  /**
   * **EACH BUFFER CARRIES THE TEXT IT WAS FORKED WITH, AND THIS IS THE TEST THAT DISTINGUISHES ONE
   * BUFFER PER FORK FROM TWO NAMES FOR ONE SEED.** The singleton deliberately did NOT re-seed on a
   * second detach — 5d-i §4.3, "a second edit REBINDS TO THE EXISTING SCRATCH" — so a second pane
   * joined the term the first one built. With one buffer per fork there is nothing for that rule to
   * apply to.
   *
   * ASSERTED PER PORT RATHER THAN OVER A FLATTENED LIST, which is what makes it fail for the right
   * reason. An implementation that minted two ids and posted both seeds down the FIRST buffer's client
   * would produce the same two messages in the same order on a flat list; requiring one message on each
   * of two ports says the seeds went to two different threads.
   *
   * TWO DIFFERENT STEPS AS WELL AS TWO DIFFERENT TEXTS, which is the other half the singleton file
   * asserted separately ("keeps ONE scratch across two forks at two different steps"): a second fork at
   * a different step is a different fork, not a different reading of the same one.
   */
  it('seeds each buffer from its own fork rather than sharing the first seed', () => {
    const { reg, buffers, ports } = harness()
    reg.add(sourceEntry())

    buffers.fork(new PaneSlot('lambda', SOURCE), 'let a = 1; a', 0)
    buffers.fork(new PaneSlot('lambda', SOURCE), 'let b = 2; b', 3)

    expect(ports.map((p) => p.sent)).toEqual([
      [{ kind: 'lambda-scratch', gen: 1, src: 'let a = 1; a', step: 0 }],
      [{ kind: 'lambda-scratch', gen: 1, src: 'let b = 2; b', step: 3 }],
    ])
  })

  /**
   * **EVERY LIVE BUFFER, WITH THE NAME A USER READS.** `list()` is what the header control of design
   * §4.2 is built over, and it exists for the case no pane can answer: a buffer outlives the panes
   * bound to it, so "which buffers are there" cannot be asked of the panes.
   *
   * ID AND LABEL ASSERTED AS A PAIR rather than as two lists. The label is UI text and the id is a map
   * key (`SessionEntry.label`'s own doc draws that line), and the failure worth catching is them coming
   * apart — a `list()` that returned the right names against the wrong ids would pass two separate
   * assertions and retire the wrong buffer.
   */
  it('lists every live buffer with a distinct label', () => {
    const { reg, buffers } = harness()
    reg.add(sourceEntry())

    const first = buffers.fork(new PaneSlot('lambda', SOURCE), 'x', 0)
    const second = buffers.fork(new PaneSlot('lambda', SOURCE), 'y', 0)

    expect(buffers.list()).toEqual([
      { id: first, label: 'scratch 1' },
      { id: second, label: 'scratch 2' },
    ])
  })

  /**
   * Forking from a pane that is ALREADY on a buffer is the degenerate case of the two tests above, and
   * it used to be the singleton's clearest statement: "is a no-op for a pane already bound to the
   * scratchpad". It is not a no-op any more — the gesture means "fork this view", and a view of a
   * buffer is a view like any other — so the assertion that used to say "nothing happened" says what
   * happens instead.
   *
   * THE FIRST BUFFER IS NOT DISTURBED, which is the half worth keeping from the old test: it is still
   * live, still on its own thread, and its seed was not overwritten by the second fork's text.
   */
  it('forks a pane that is already on a buffer onto a second buffer, leaving the first alone', () => {
    const { reg, pool, buffers, ports } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)

    const first = buffers.fork(slot, 'first', 0)
    const second = buffers.fork(slot, 'again', 0)

    expect(second).not.toBe(first)
    expect(slot.binding.session).toBe(second)
    expect(pool.size).toBe(2)
    expect(pool.has(first)).toBe(true)
    expect(ports[0]?.sent).toEqual([{ kind: 'lambda-scratch', gen: 1, src: 'first', step: 0 }])
    expect(ports[0]?.terminated).toBe(0)
  })

  // A buffer's entry is `detached: true` BY CONSTRUCTION (5d-i §3.3: no `linkIndex`, no `sourceSpan` on
  // either scratch type), which is what makes §4.5's two surfaces one lookup — `PaneSlot.render` reads
  // this field for the badge and `main.ts`'s `detachedPanes` reads it for the sentence.
  it('registers a buffer detached, under its minted label, with one leg and no TM leg', () => {
    const { reg, buffers } = harness()
    reg.add(sourceEntry())
    const id = buffers.fork(new PaneSlot('lambda', SOURCE), 'λx. x', 0)

    const entry = reg.entryOf(id)
    expect(entry.detached).toBe(true)
    expect(entry.label).toBe('scratch 1')
    expect(entry.legs.tm).toBeUndefined()
    expect(entry.legs.lambda?.status).toEqual({ available: false, reason: 'building…' })
    // A λ-only session must not be offered to a TM slot: `legOf` throws for a leg a session lacks, and
    // `options` is what keeps a selector from producing such a binding in the first place.
    expect(reg.options('tm')).toEqual([])
  })

  /**
   * The frames a buffer's worker posts land in that buffer's own leg, which is what the client the pool
   * handed back is for. Delivered through the fake port so the whole path — port listener, generation
   * filter, `onReply` — is the app's.
   *
   * **TWO BUFFERS, BECAUSE ONE CANNOT SEE THE FAILURE THIS GUARDS.** `ScratchBuffers` takes ONE
   * `onReply` and binds it to MANY workers, so the id has to be curried in per buffer at `pool.bind`.
   * A callback that closed over the newest id, or over none at all, would deliver this reply just the
   * same and file it under the wrong buffer — which is a wrong pane painted, not a dropped message. One
   * buffer cannot tell those apart; the second port is what makes the attribution observable.
   */
  it('routes each buffer’s replies under that buffer’s own id', () => {
    const { reg, buffers, ports, replies } = harness()
    reg.add(sourceEntry())
    const first = buffers.fork(new PaneSlot('lambda', SOURCE), 'λx. x', 0)
    const second = buffers.fork(new PaneSlot('lambda', SOURCE), 'λy. y', 0)

    const compiled = (text: string): RunReply => ({
      kind: 'scratch-compiled',
      gen: 1,
      lambda: { available: true, reason: '', node: null, run: 'Running' },
      text,
    })
    ports[1]?.deliver(compiled('λy. y'))
    ports[0]?.deliver(compiled('λx. x'))

    expect(replies).toEqual([
      { session: second, reply: compiled('λy. y') },
      { session: first, reply: compiled('λx. x') },
    ])
  })

  /**
   * **THE CAP REFUSES, AND THE DISCRIMINATOR IS THAT NOTHING WAS EVICTED** — design §4.5, and decision
   * 2's governing rule read from the one direction it is easiest to break: an eviction is something
   * ending a buffer implicitly, wearing the name of a limit. A cap that quietly retired the oldest
   * buffer to make room would satisfy a throw-only test just as well, so the list is asserted at full
   * length WITH ITS OLDEST MEMBER STILL IN IT — dropping the newest instead would keep the length.
   *
   * NOTHING WAS SPAWNED EITHER. `pool.size` and `ports.length` are what say the refusal happened before
   * `SessionPool.bind`, not after it: a guard placed one line too low would leave a worker running for a
   * buffer the collection never recorded, which is the leak `retire` exists to prevent and which no
   * count of `list()` can see. The refused slot is still on the source session for the same reason —
   * `fork` rebinds last, and a pane moved onto a buffer that was never made is a pane bound to nothing.
   *
   * THE MESSAGE IS ASSERTED, NOT JUST THE THROW. It reaches a user (`transport.ts`'s detach handler
   * catches this and puts it on `#link-status`), and what it has to tell them is that the cap is real
   * and that retiring one is the way to make room — so the cap's own figure and the instruction are read
   * back out of it. `tests/browser/scratch-cap.test.ts` is where the same message is asserted on the
   * surface a user actually reads it from.
   *
   * **AND A FOURTH LINE ASSERTED A LIVE BUFFER'S NAME (`/scratch 1/`) UNTIL THE MESSAGE STOPPED CARRYING
   * ONE.** That sentence read "what it has to tell them is where the buffers ARE"; read on a real page,
   * the enumeration is sixty characters of `scratch 1, scratch 2, …` — a counter's output, identical in
   * shape for every buffer — between the diagnosis and the only clause the user can act on. `fork`'s own
   * doc carries the reversal in full. The assertion is INVERTED rather than deleted, because a message
   * that quietly grew the list back would otherwise pass everything left here.
   *
   * **THE ERROR'S TYPE IS ASSERTED TOO, AND IT IS NOT DECORATION.** `transport.ts` catches
   * `BufferCapReached` and RE-THROWS anything else, because the other throws reachable from `fork` are
   * `SessionRegistry.add`'s and `SessionPool.bind`'s invariant guards, which must stay loud rather than
   * become a status line. A refusal raised as a plain `Error` would fall through that `instanceof` and
   * go back to being invisible — the exact Critical this test's file was extended to close.
   */
  it('refuses a fork at the cap rather than evicting a buffer to make room', () => {
    const { reg, pool, buffers, ports } = harness()
    reg.add(sourceEntry())
    const oldest = buffers.fork(new PaneSlot('lambda', SOURCE), 'x0', 0)
    for (let i = 1; i < MAX_BUFFERS; i++) buffers.fork(new PaneSlot('lambda', SOURCE), `x${i}`, 0)
    const refused = new PaneSlot('lambda', SOURCE)

    expect(() => buffers.fork(refused, 'one too many', 0)).toThrow(BufferCapReached)
    expect(() => buffers.fork(refused, 'one too many', 0)).toThrow(/retire/)
    expect(() => buffers.fork(refused, 'one too many', 0)).toThrow(new RegExp(`${MAX_BUFFERS}`))
    expect(() => buffers.fork(refused, 'one too many', 0)).not.toThrow(/scratch 1/)

    expect(buffers.list()).toHaveLength(MAX_BUFFERS)
    expect(buffers.list()[0]?.id).toBe(oldest)
    expect(pool.size).toBe(MAX_BUFFERS)
    expect(ports.length).toBe(MAX_BUFFERS)
    expect(reg.size).toBe(MAX_BUFFERS + 1)
    expect(refused.binding).toEqual({ session: SOURCE, leg: 'lambda' })
  })

  /**
   * **THE CAP COUNTS LIVE BUFFERS, AND `#minted` COUNTS SOMETHING ELSE.** A guard written against the
   * mint counter passes the test above and makes the refusal permanent: retiring every buffer in the
   * app would still leave a fork refused, which turns a limit into a lifetime quota and makes the
   * diagnostic's advice — retire one — a lie.
   *
   * THE NAME IS STILL NOT REISSUED. `#minted`'s own doc is why the fork that fits in the reclaimed room
   * is `scratch-9` rather than `scratch-1`, and asserting it here is what keeps "the cap reads the map"
   * from being implemented by winding the counter back.
   */
  it('takes a fork again after a retire, because the cap counts live buffers rather than minted ones', () => {
    const { reg, buffers } = harness()
    reg.add(sourceEntry())
    const oldest = buffers.fork(new PaneSlot('lambda', SOURCE), 'x0', 0)
    for (let i = 1; i < MAX_BUFFERS; i++) buffers.fork(new PaneSlot('lambda', SOURCE), `x${i}`, 0)

    expect(buffers.retire(oldest, SOURCE, [])).toBe(true)
    const again = buffers.fork(new PaneSlot('lambda', SOURCE), 'room now', 0)

    expect(again).toBe(`scratch-${MAX_BUFFERS + 1}`)
    expect(buffers.list()).toHaveLength(MAX_BUFFERS)
    expect(buffers.list().map((b) => b.id)).toContain(again)
    expect(buffers.list().map((b) => b.id)).not.toContain(oldest)
  })
})

describe('ScratchBuffers.retire', () => {
  /**
   * **RETIRING TERMINATES THE BUFFER'S WORKER AND REBINDS ITS PANES BACK** (5d-i §4.3, carried forward
   * as 5d-ii-c decision 4), deliberately the same mechanism as §4.2's poison recovery.
   *
   * `terminated` IS THE ASSERTION THAT MATTERS AND `pool.size` IS NOT. 5d-i's plan says so in as many
   * words — "assert the worker is gone, not merely that panes rebound. Otherwise the leak passes" —
   * and a `retire` that forgot `pool.unbind` would satisfy the registry, the bindings and the panes
   * while leaving a wasm module and its 8.45 MB baseline running forever.
   *
   * **TWO PANES ON ONE BUFFER IS NOW A REBIND, NOT A SECOND FORK.** This test used to reach that state
   * by detaching twice, which the singleton collapsed onto one scratch; a second fork would now mint a
   * second buffer, so the second pane is pointed at the first buffer the way the binding selector
   * points it — `PaneSlot.rebind`, the app's own writer.
   */
  it('terminates the worker, forgets the session, and brings its panes home', () => {
    const { reg, pool, buffers, ports } = harness()
    reg.add(sourceEntry())
    const a = new PaneSlot('lambda', SOURCE)
    const b = new PaneSlot('lambda', SOURCE)
    const id = buffers.fork(a, 'λx. x', 0)
    b.rebind(id)

    expect(buffers.retire(id, SOURCE, [a, b])).toBe(true)

    expect(ports[0]?.terminated).toBe(1)
    expect(pool.size).toBe(0)
    expect(pool.has(id)).toBe(false)
    expect(reg.size).toBe(1)
    expect(reg.has(id)).toBe(false)
    expect(buffers.list()).toEqual([])
    expect(a.binding).toEqual({ session: SOURCE, leg: 'lambda' })
    expect(b.binding).toEqual({ session: SOURCE, leg: 'lambda' })
  })

  // A slot that was never on the buffer must not be dragged home by someone else's retirement — the TM
  // pane is bound to the source session's TM leg throughout, and `retire` is handed both slots by
  // `main.ts` because it cannot know which of them forked.
  it('moves only the panes that were on the buffer', () => {
    const { reg, buffers } = harness()
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
    const id = buffers.fork(lambda, 'λx. x', 0)

    buffers.retire(id, SOURCE, [lambda, tm])
    expect(lambda.binding).toEqual({ session: SOURCE, leg: 'lambda' })
    expect(tm.binding).toEqual({ session: SOURCE, leg: 'tm' })
  })

  /**
   * **`retire` ENDS THE BUFFER IT IS HANDED, AND THE TEST THIS REPLACES SAID THE OPPOSITE ON PURPOSE.**
   * It was called "ends only the newest buffer while it has no id to name one" and asserted that a
   * `retire(SOURCE, [a, b])` naming NO buffer ended the most recently forked one — the singleton's
   * exact behaviour, kept as a placeholder while "what is the key" and "what triggers a retire" were
   * split across two tasks. The signature takes the id now, so the newest reading is gone: the OLDER
   * buffer is retired here and the newer one is the sibling left running, which is the case the
   * placeholder could not express at all.
   *
   * **THE SIBLING SURVIVING WAS NEVER TRANSITIONAL AND IS ASSERTED THE SAME WAY.** Decision 2's
   * governing rule is that nothing ends a buffer implicitly, so a call naming one buffer may not end
   * the others; "retire them all" would be exactly that under another name. `ports[1].terminated` is
   * what stops this from being written as a sweep — a `retire` that unbound every buffer would satisfy
   * `pool.size` alone only by accident of there being two.
   */
  it('retires one buffer and leaves its siblings running', () => {
    const { reg, pool, buffers, ports } = harness()
    reg.add(sourceEntry())
    const slotA = new PaneSlot('lambda', SOURCE)
    const slotB = new PaneSlot('lambda', SOURCE)
    const a = buffers.fork(slotA, 'x', 0)
    const b = buffers.fork(slotB, 'y', 0)

    expect(buffers.retire(a, SOURCE, [slotA, slotB])).toBe(true)

    expect(reg.has(a)).toBe(false)
    expect(reg.has(b)).toBe(true)
    expect(pool.size).toBe(1)
    expect(ports[0]?.terminated).toBe(1)
    expect(ports[1]?.terminated).toBe(0)
    expect(buffers.list().map((x) => x.id)).toEqual([b])
  })

  /**
   * **THE DISCRIMINATOR: A `retire` THAT REBOUND EVERY SLOT WOULD PASS THE TEST ABOVE.** Pool size,
   * registry membership and `list()` all describe the buffer that ended; none of them can see a pane
   * dragged home from a buffer nobody retired. Under the newest-buffer placeholder there was no state
   * in which the two came apart — the retired buffer was always the last one forked, so "every slot"
   * and "the slots on it" agreed whenever a test had only one buffer to look at.
   *
   * `slotB.binding.session` IS ASSERTED AS `b` RATHER THAN "NOT `SOURCE`", because a rebind to the
   * wrong buffer and a rebind home are two different bugs and only the identity check tells them apart.
   */
  it('rebinds only the slots bound to the retired buffer', () => {
    const { reg, buffers } = harness()
    reg.add(sourceEntry())
    const slotA = new PaneSlot('lambda', SOURCE)
    const slotB = new PaneSlot('lambda', SOURCE)
    const a = buffers.fork(slotA, 'x', 0)
    const b = buffers.fork(slotB, 'y', 0)

    buffers.retire(a, SOURCE, [slotA, slotB])

    expect(slotA.binding.session).toBe(SOURCE)
    expect(slotB.binding.session).toBe(b)
  })

  /**
   * AN ID NO FORK EVER MINTED IS NOT A BUFFER, AND THE ANSWER IS `false` RATHER THAN A THROW. The
   * registry's own `entryOf` throws for an id it does not hold, and `retire` resolves one — so without
   * the membership check this call would raise instead of answering, on the one path a caller holding a
   * stale name reaches. Distinct from the idempotency case below, which is about a name this collection
   * DID mint and has since spent.
   */
  it('returns false for a buffer that is not live', () => {
    const { reg, buffers, ports } = harness()
    reg.add(sourceEntry())

    expect(buffers.retire('scratch-9', SOURCE, [])).toBe(false)
    expect(ports.length).toBe(0)
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
  it('stops the retired buffer’s playback rather than stranding it', () => {
    const { reg, buffers } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)
    const id = buffers.fork(slot, 'λx. x', 0)

    const leg = reg.legOf({ session: id, leg: 'lambda' })
    leg.hist.push(lambdaFrame('λx. x'), 1)
    leg.done = 'ended'
    leg.timer = setInterval(() => undefined, 1_000)

    buffers.retire(id, SOURCE, [slot])

    expect(leg.timer).toBe(null)
    expect(leg.done).toBe(null)
    expect(leg.hist.length).toBe(0)
  })

  /**
   * IDEMPOTENT AND CHEAP. **THAT USED TO BE JUSTIFIED BY THE CALLER — "`main.ts` calls this from
   * `schedule`, which runs on every keystroke, and most recompiles happen with no buffer in existence
   * at all" — AND 5d-ii-c DECISION 2 DELETED THAT CALLER.** A source keystroke ends no buffer now, so
   * the case this pins is the one the second half of this test names: a name outliving the buffer it
   * used to reach.
   *
   * THE RETURN VALUE IS THE WHOLE REASON IT IS NOT `void`. `false` used to be what kept `schedule` from
   * repainting both panes on a keystroke that changed nothing; it is what a retire control has to read
   * before it repaints a list around a row that ended nothing (design §4.4).
   *
   * **THE SECOND CALL NAMES THE BUFFER THE FIRST ONE SPENT, WHERE IT USED TO NAME NOTHING.** This test
   * asserted `retire(SOURCE, [slot])` twice and read the second `false` as "there is no newest buffer
   * any more". The id makes that a sharper claim: a caller holding the name of a buffer it already
   * retired gets `false` rather than a second termination of a thread that is already gone.
   */
  it('answers false and touches nothing when there is no buffer', () => {
    const { reg, pool, buffers, ports } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)

    expect(buffers.retire('scratch-1', SOURCE, [slot])).toBe(false)
    expect(ports.length).toBe(0)
    expect(pool.size).toBe(0)
    expect(slot.binding.session).toBe(SOURCE)

    const id = buffers.fork(slot, 'λx. x', 0)
    expect(buffers.retire(id, SOURCE, [slot])).toBe(true)
    expect(buffers.retire(id, SOURCE, [slot])).toBe(false)
    expect(ports[0]?.terminated).toBe(1)
  })

  // 5d-i §4.3's cycle in full: fork, retire, fork again. The second fork must get a NEW thread rather
  // than the terminated one — `terminate` + respawn is §4.2's "resets both", and a pool that handed
  // back the dead port would satisfy every count above and answer nothing ever again. The second fork
  // also mints a name of its own, which is the difference from the singleton: the id a retired buffer
  // gave up is not reissued.
  it('lets a later fork build a fresh buffer on a new thread, under a new name', () => {
    const { reg, buffers, ports } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)

    const first = buffers.fork(slot, 'first', 0)
    buffers.retire(first, SOURCE, [slot])
    const second = buffers.fork(slot, 'second', 0)

    expect(second).not.toBe(first)
    expect(ports.length).toBe(2)
    expect(ports[0]).not.toBe(ports[1])
    expect(ports[1]?.sent).toEqual([{ kind: 'lambda-scratch', gen: 1, src: 'second', step: 0 }])
    expect(ports[1]?.terminated).toBe(0)
    expect(slot.binding.session).toBe(second)
    expect(buffers.list()).toEqual([{ id: second, label: 'scratch 2' }])
  })
})

/**
 * **THIS BLOCK USED TO ASSERT THAT A FAILED FORK ENDED ITS BUFFER, AND 5d-ii-c DECISION 2 REVERSES
 * EXACTLY THAT.** Design §4.3's table: worker error / poison went from *ended it* to **survives; retire
 * is the escape**. `noSessionReply` called `retire` on the phantom path — terminating the worker,
 * dropping the buffer from both containers, and rebinding its panes home — and the three cases below
 * were written around that. The DISCRIMINATOR is untouched and is what they assert now: which SURFACE
 * the diagnostics belong on, `#link-status` or the buffer's own editor gutter.
 *
 * WHAT ENDS A BUFFER IS NOW `retire` AND NOTHING ELSE, and `describe('ScratchBuffers.retire')` above is
 * where that is asserted. Its one caller in `src/` is the retire handler behind design §4.2's header
 * list (`main.ts`); this sentence read "Nothing in `src/` calls it until design §4.4's header list is
 * wired", which was true for three tasks.
 */
describe('ScratchBuffers.noSessionReply', () => {
  /**
   * **THE DISCRIMINATOR FOR THE RE-KEY, AND THE STATE THE UNKEYED VERSION ANSWERED BACKWARDS IN.**
   * `noSessionReply` used to read the most recently forked buffer for itself, which agreed with the
   * reply whenever the failing fork was the newest one — every state a single pane could reach. Fork a
   * phantom, then fork a buffer that BUILDS, and the two come apart: the newest buffer holds a frame, so
   * the unkeyed method answered `null` for the phantom's own reply and left its pane with no report of
   * why it was showing nothing. That is the CRITICAL finding this method exists to close, reopened by a
   * second fork.
   *
   * **THE PHANTOM IS THE OLDER BUFFER ON PURPOSE.** With the phantom newest, both readings agree and
   * this test would pass against the code it was written to reject.
   *
   * **IT WAS CALLED "retires the buffer the reply names rather than the newest one" AND ASSERTED
   * `reg.has(phantom) === false`, `slotA` HOME AND `pool.size === 1`.** Every one of those was the
   * retire, and every one is inverted here: BOTH buffers are still registered, BOTH panes are still on
   * the buffers they were forked onto, and both threads are still bound. The claim that survives is the
   * one about keying — this answers for the buffer the reply names — and it is now asserted on the
   * ANSWER alone, which is the only thing this method produces.
   *
   * `slotB` IS STILL ASSERTED UNMOVED, and it is no longer the same claim: it used to say a healthy
   * buffer's pane must not be dragged home by another buffer's retirement. It now says this method moves
   * NO pane at all, which is what "nothing ends a buffer implicitly" reduces to at this layer.
   */
  it('answers for the buffer the reply names rather than the newest one, and ends neither', () => {
    const { reg, pool, buffers, ports } = harness()
    reg.add(sourceEntry())
    const slotA = new PaneSlot('lambda', SOURCE)
    const slotB = new PaneSlot('lambda', SOURCE)
    const phantom = buffers.fork(slotA, 'not a term (((', 0)
    const live = buffers.fork(slotB, 'λx. x', 0)
    // THE ONE FACT THAT DISTINGUISHES THE TWO BUFFERS — `noSessionReply`'s discriminator is whether the
    // λ leg has ever recorded a frame, and the worker that would have recorded one is a fake port here.
    reg.legOf({ session: live, leg: 'lambda' }).hist.push(lambdaFrame('λx. x'), 1)

    const diagnostics = [{ span: { start: 0, end: 0 }, severity: 'Error' as const, message: 'unexpected `(`' }]
    expect(buffers.noSessionReply(phantom, diagnostics)).toEqual(diagnostics)

    expect(reg.has(phantom)).toBe(true)
    expect(slotA.binding.session).toBe(phantom)
    expect(reg.has(live)).toBe(true)
    expect(slotB.binding.session).toBe(live)
    expect(pool.size).toBe(2)
    expect(buffers.list().map((b) => b.id)).toEqual([phantom, live])
    // ON THE THREAD, NOT ONLY ON THE MAPS — `retire`'s own tests use `terminated` for the same reason
    // (5d-i's plan: "assert the worker is gone, not merely that panes rebound"), and the inverse claim
    // has to be made on the same axis or a `terminate` left behind by a half-removed retire would pass.
    expect(ports.map((p) => p.terminated)).toEqual([0, 0])
  })

  /**
   * THE LIVE-EDIT PATH, WHICH IS THE ORDINARY ONE: design §4.4 promises "an edit that does not parse
   * leaves the frames region showing the last good run", and most keystrokes mid-identifier do not
   * parse. **THIS TEST WAS CALLED "leaves a buffer that has already built a frame alone" AND THAT NAME
   * NO LONGER DISTINGUISHES IT FROM ANYTHING** — the phantom path leaves its buffer alone too now. What
   * it pins is the ANSWER: `null` routes the caller to the buffer's own editor gutter, where a mid-edit
   * parse failure belongs, rather than reporting it as a fork that failed.
   */
  it('answers null for a buffer that has already built a frame', () => {
    const { reg, buffers } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)
    const id = buffers.fork(slot, 'λx. x', 0)
    reg.legOf({ session: id, leg: 'lambda' }).hist.push(lambdaFrame('λx. x'), 1)

    expect(buffers.noSessionReply(id, [])).toBe(null)

    expect(reg.has(id)).toBe(true)
    expect(slot.binding.session).toBe(id)
  })

  // A REPLY THAT OUTLIVED ITS BUFFER — the one way this can be handed an id that is not live, since
  // `replies.ts` routes the source session's own `no-session` to `onReply` instead. There is no fork
  // left to report a failure for, and `entryOf` would THROW rather than answer without the membership
  // guard. **THE BUFFER IS SPENT BY AN EXPLICIT `retire` HERE, WHICH IS NOW THE ONLY WAY TO REACH THIS
  // STATE AT ALL** — the reply arriving after the user ended the buffer from §4.4's header list.
  it('answers null for a buffer that is not live', () => {
    const { reg, buffers } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)
    const id = buffers.fork(slot, 'λx. x', 0)
    buffers.retire(id, SOURCE, [slot])

    expect(buffers.noSessionReply(id, [])).toBe(null)
    expect(slot.binding.session).toBe(SOURCE)
  })
})

describe('ScratchBuffers.recompile', () => {
  /**
   * **5d-i §4.3's EDIT PATH, AND `recompile`'s OWN DOC IS THE CLAIM UNDER TEST: "IT IS `fork` WITH
   * `step: 0` AND NO CREATION."** `pool.size` staying put is what distinguishes reusing the existing
   * worker from spawning a second one — `ports.length` staying at 1 is the same claim from the other
   * container, since `SessionPool.bind` would either throw on the already-live id or, if that guard
   * were the thing broken, leave a second port this asserts against directly.
   */
  it('recompiles the buffer and does not create a second', () => {
    const { reg, pool, buffers, ports } = harness()
    reg.add(sourceEntry())
    const slot = new PaneSlot('lambda', SOURCE)
    const id = buffers.fork(slot, '(λx. x) (λy. y)', 0)
    const before = pool.size

    expect(buffers.recompile(id, 'λz. z')).toBe(true)

    expect(pool.size).toBe(before)
    expect(ports.length).toBe(1)
    expect(ports[0]?.sent).toContainEqual(expect.objectContaining({ kind: 'lambda-scratch', src: 'λz. z', step: 0 }))
  })

  /**
   * **THE BUFFER IT NAMES, NOT THE NEWEST ONE** — the reason `recompile` took a buffer id in the task
   * that made buffers plural rather than waiting for the task that re-keys `retire`. Its caller is
   * `transport.ts`'s `editScratch`, one per λ pane, and a pane editing an OLDER buffer while a newer
   * one exists is reachable the moment two forks are: the newest-buffer reading would rebuild a term
   * the user is not looking at and leave the one they are typing into untouched.
   */
  it('recompiles the buffer it names rather than the most recent one', () => {
    const { reg, buffers, ports } = harness()
    reg.add(sourceEntry())
    const first = buffers.fork(new PaneSlot('lambda', SOURCE), 'x', 0)
    buffers.fork(new PaneSlot('lambda', SOURCE), 'y', 0)

    expect(buffers.recompile(first, 'λz. z')).toBe(true)

    expect(ports[0]?.sent).toEqual([
      { kind: 'lambda-scratch', gen: 1, src: 'x', step: 0 },
      { kind: 'lambda-scratch', gen: 2, src: 'λz. z', step: 0 },
    ])
    expect(ports[1]?.sent).toEqual([{ kind: 'lambda-scratch', gen: 1, src: 'y', step: 0 }])
  })

  // No such buffer exists, so there is nothing to rebuild — `recompile` cannot mean "create one from
  // nothing" (`fork` owns creation), so this is the caller-bug case `recompile`'s own doc names, not
  // the common one. Nothing is posted and no worker is spawned.
  it('answers false when there is no buffer to recompile', () => {
    const { reg, pool, buffers, ports } = harness()
    reg.add(sourceEntry())

    expect(buffers.recompile('scratch-9', 'λz. z')).toBe(false)
    expect(ports.length).toBe(0)
    expect(pool.size).toBe(0)
  })
})
