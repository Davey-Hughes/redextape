import { describe, expect, it } from 'vitest'
import { History } from '../../src/history'
import type { RunReply } from '../../src/protocol'
import { HISTORY_BYTES, lambdaFrameBytes, tmFrameBytes } from '../../src/protocol'
import { LambdaScratchpad } from '../../src/scratch'
import type { PoolPort, SessionId } from '../../src/session-client'
import { SessionPool } from '../../src/session-client'
import type { LegState, SessionEntry } from '../../src/sessions'
import { PaneSlot, SessionRegistry } from '../../src/sessions'
import type { LambdaState, TmState } from '../../src/types'

/**
 * **THE TWO CLAIMS PLAN T8 MAKES THAT A FAKE PORT CANNOT ANSWER** — design §4.3, over real
 * `session-worker.ts` threads.
 *
 *   1. **The source session is untouched and KEEPS RUNNING across a detach**, which is "the entire
 *      reason three sessions exist rather than one mutable one". `tests/node/scratch.test.ts` asserts
 *      the structural half — same entry, same client, same frames, nothing posted to its port — and
 *      that half passes on an implementation that reuses the source's own thread and merely happens
 *      not to have touched the objects yet. Only a thread mid-recording can show the difference: the
 *      step count has to keep MOVING while the fork happens.
 *   2. **Retiring a scratchpad TERMINATES ITS WORKER**, not merely forgets it. The plan says outright
 *      that asserting the panes rebound lets the leak pass; `pool.size`, `pool.has` and every binding
 *      stay correct on an implementation that never calls `terminate`, while an 8.45 MB wasm module
 *      (T9's measurement) and its thread run on forever.
 *
 * NEITHER IS DRIVEN THROUGH THE APP, and that is T7's finding still holding one task later: the app
 * has ONE λ pane, so it cannot show two panes on one scratchpad, and neither `pool.size` nor a
 * worker's liveness is reachable from the DOM. `scratch-app.test.ts` drives the control and the app
 * wiring; this file drives the mechanism.
 */

const SOURCE: SessionId = 'source'
const SCRATCH: SessionId = 'lambda-scratch'

/**
 * `map`/`fold` over three elements — chosen because its TM leg is enormous (design §3.1: 25,852 rows,
 * 266,863 δ-steps against 555 β-steps).
 *
 * THE ASYMMETRY IS THE POINT AND NOT A COINCIDENCE. The claim under test is that the source session
 * goes on recording WHILE a fork happens, so the fixture has to still be recording when the main
 * thread gets its turn: `session-worker.ts` posts `compiled` BEFORE it steps anything, then records
 * in `RECORD_CHUNK`-sized chunks with a macrotask yield between each. At ~58,000 retained TM frames
 * (`HISTORY_BYTES` / ~550 B) that is ~227 yields and seconds of wall clock — measured at ~2.1 s by
 * `session-worker.ts`'s own `MessageChannel` note — against the sub-millisecond it takes the main
 * thread to dequeue one message. A short program would finish before the detach and prove nothing.
 */
const BIG = `fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }
fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }
fn add(a, b) { a + b }
fn add1(x) { x + 1 }
fold([3, 1, 2].map(add1), 0, add)`

async function until(predicate: () => boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** One spawned thread: the raw `Worker` a liveness probe needs, and how many times it was killed. */
type Spawned = { worker: Worker; terminated: number }

/**
 * A pool over REAL `session-worker.ts` threads, wrapped so a test can see the two things a `PoolPort`
 * otherwise hides.
 *
 * THE WRAPPER EXISTS FOR THE `terminate` COUNT AND FOR THE RAW HANDLE. `pool-isolation.test.ts` hands
 * the `Worker` straight through because it only needs distinct threads; claim 2 above needs to post
 * to a thread AFTER the pool has killed it, which means keeping the handle the pool no longer has.
 */
function realPool(): { pool: SessionPool; spawned: Spawned[] } {
  const spawned: Spawned[] = []
  const pool = new SessionPool((): PoolPort => {
    const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
    const record: Spawned = { worker, terminated: 0 }
    spawned.push(record)
    return {
      postMessage: (m) => worker.postMessage(m),
      addEventListener: (_t, h) => worker.addEventListener('message', (e) => h(e as MessageEvent<RunReply>)),
      terminate: () => {
        record.terminated += 1
        worker.terminate()
      },
    }
  })
  return { pool, spawned }
}

function leg<T>(): LegState<T> {
  return { hist: new History<T>(HISTORY_BYTES), status: { available: false, reason: '' }, done: null, timer: null }
}

/**
 * The source session, wired to a real thread, with `main.ts`'s own frame-landing rules.
 *
 * THE REPLY HANDLER IS `onReply`'s TWO FRAME ARMS AND NOTHING ELSE. What is under test is whether the
 * legs go on filling, so the arms that touch `#results`, the link index and the panes are not
 * reproduced — reproducing them would put a copy of the app in a test file, which is the failure
 * `tests/node/sessions.test.ts` avoids by sharing `PaneSlot.render` instead.
 */
function sourceSession(pool: SessionPool, seen: RunReply[]): SessionEntry {
  const legs = { lambda: leg<LambdaState>(), tm: leg<TmState>() }
  const client = pool.bind(SOURCE, (reply) => {
    seen.push(reply)
    if (reply.kind === 'lambda-frames') {
      for (const f of reply.frames) legs.lambda.hist.push(f, lambdaFrameBytes(f))
    } else if (reply.kind === 'tm-frames') {
      for (const f of reply.frames) legs.tm.hist.push(f, tmFrameBytes(f))
    }
  })
  return { id: SOURCE, label: 'source', detached: false, client, legs }
}

describe('detach is a fork', () => {
  /**
   * **THE SOURCE SESSION'S STEP COUNT ADVANCES ACROSS A DETACH** — the assertion plan T8's mutation is
   * aimed at ("make detach mutate the source session in place instead of forking. Expected failure:
   * the source-keeps-running assertion, with a frozen step count").
   *
   * THE DETACH FIRES ON `compiled`, WHICH IS THE EARLIEST MOMENT A CLIENT CAN ACT AND THE LATEST ONE
   * THAT IS STILL DETERMINISTIC. `session-worker.ts` posts `compiled` before it records a single
   * frame (so the run is guaranteed to be in flight) and then spends seconds on the TM leg (so the
   * main thread is guaranteed to get its turn first) — see `BIG`'s doc for the arithmetic.
   *
   * THE READING IS THE TM LEG'S `newestStep`, WHICH IS THE FRONTIER RATHER THAN THE PLAY HEAD. A play
   * head is where a user is looking and does not move on its own; the frontier is how far the session
   * has RUN, which is the thing that must not stop.
   */
  it('leaves the source session recording while the scratchpad is built', { timeout: 180_000 }, async () => {
    const { pool, spawned } = realPool()
    const reg = new SessionRegistry()
    const seen: RunReply[] = []
    try {
      const source = sourceSession(pool, seen)
      reg.add(source)
      const slot = new PaneSlot('lambda', SOURCE)
      const pad = new LambdaScratchpad({
        registry: reg,
        pool,
        id: SCRATCH,
        label: 'λ scratchpad',
        historyBytes: HISTORY_BYTES,
        onReply: () => undefined,
      })

      source.client.request(source.client.supersede(), BIG, 'unary')
      await until(() => seen.some((r) => r.kind === 'compiled'), "the source session's compile")

      const tm = reg.legOf({ session: SOURCE, leg: 'tm' })
      const before = tm.hist.newestStep
      pad.detach(slot, '(λx. x) (λy. y)')

      // Two threads now, and the fork did not take the source's. Kept above the behavioural
      // assertion so a failure says "there is one worker" rather than leaving it to be inferred.
      expect(spawned.length).toBe(2)
      expect(pool.size).toBe(2)
      expect(slot.binding.session).toBe(SCRATCH)

      // THE ASSERTION. Under a detach that mutates the source session in place, the source worker's
      // `dropLive` frees the `Session` its record loop is stepping and the loop returns at its own
      // generation check — the frontier stops exactly here, and this wait is what reports it.
      await until(() => tm.hist.newestStep > before, `the source TM leg to pass step ${before}`)
      expect(tm.hist.newestStep).toBeGreaterThan(before)

      // AND IT RUNS TO ITS OWN ANSWER, not merely one more frame. A source session that survived the
      // fork by a chunk and then died would satisfy the line above.
      await until(() => seen.some((r) => r.kind === 'result'), "the source session's result")
      const result = seen.find((r) => r.kind === 'result')
      expect(result?.kind).toBe('result')
    } finally {
      for (const id of [SOURCE, SCRATCH]) pool.unbind(id)
    }
  })

  /**
   * THE SCRATCHPAD IS A SECOND SESSION THAT ACTUALLY REDUCES, which is what makes the fork worth
   * having and is not implied by anything above: a pool entry and a registry entry can both be right
   * while the worker answers nothing.
   *
   * IT ALSO PINS THE ROUND-TRIP THE FORK CONTROL DEPENDS ON. `lambda/syntax.rs` promises printer and
   * parser round-trip, and `detachButton` leans on that promise to decide a fork is possible — this
   * seeds the scratchpad with a term in exactly the printer's own output form (`λ`, application by
   * juxtaposition) and asserts it reduced rather than answering `no-session`.
   */
  it('builds a scratchpad that reduces its seed on its own thread', { timeout: 120_000 }, async () => {
    const { pool } = realPool()
    const reg = new SessionRegistry()
    const seen: RunReply[] = []
    try {
      reg.add(sourceSession(pool, []))
      const pad = new LambdaScratchpad({
        registry: reg,
        pool,
        id: SCRATCH,
        label: 'λ scratchpad',
        historyBytes: HISTORY_BYTES,
        onReply: (reply) => {
          seen.push(reply)
          if (reply.kind === 'lambda-frames') {
            const l = reg.legOf({ session: SCRATCH, leg: 'lambda' })
            for (const f of reply.frames) l.hist.push(f, lambdaFrameBytes(f))
            l.done = reply.done
          }
        },
      })

      pad.detach(new PaneSlot('lambda', SOURCE), '(λx. x) (λy. y)')
      await until(() => seen.some((r) => r.kind === 'lambda-frames' && r.done !== null), "the scratchpad's frames")

      // `scratch-compiled`, NOT `compiled`, and never a `result`: §3.3 puts `lambdaValue`, `linkIndex`
      // and the TM leg off this type, so the messages that carry them cannot be sent for it.
      expect(seen.filter((r) => r.kind === 'scratch-compiled').length).toBe(1)
      expect(seen.some((r) => r.kind === 'compiled')).toBe(false)
      expect(seen.some((r) => r.kind === 'result')).toBe(false)
      expect(seen.some((r) => r.kind === 'no-session')).toBe(false)

      const l = reg.legOf({ session: SCRATCH, leg: 'lambda' })
      // One β-step: `(λx. x) (λy. y)` contracts to `λy. y` and stops. Step 0 and step 1, and the
      // second is the reducer's answer rather than the seed echoed back.
      expect(l.hist.newestStep).toBe(1)
      expect(l.done).toBe('ended')
      l.hist.seek(1)
      expect(l.hist.current?.text).toBe('λy. y')
    } finally {
      for (const id of [SOURCE, SCRATCH]) pool.unbind(id)
    }
  })

  /**
   * **RETIRING TERMINATES THE WORKER — ASSERTED ON THE THREAD, NOT ON THE MAP.** Plan T8: "assert the
   * worker is gone, not merely that panes rebound. Otherwise the leak passes."
   *
   * THE PROBE IS SHOWN CAPABLE OF SUCCEEDING BEFORE IT IS USED AS EVIDENCE OF SILENCE. A test whose
   * pass condition is "no reply arrived" passes on a probe that never worked, which is the shape #30's
   * entry records ("a gate that was never shown capable of failing"). So the same thread is made to
   * answer first — the scratchpad's own `scratch-compiled` — and only then killed and asked again.
   *
   * THE PROBE GOES TO THE RAW `Worker`, BYPASSING THE POOL AND THE CLIENT, deliberately: after
   * `unbind` the pool has forgotten the port and `SessionClient` would filter the reply by generation
   * anyway. What is under test is whether the THREAD is alive, and the only honest question is one
   * posted straight at it.
   */
  it('terminates the scratchpad’s worker on retire, and the thread stops answering', { timeout: 120_000 }, async () => {
    const { pool, spawned } = realPool()
    const reg = new SessionRegistry()
    const seen: RunReply[] = []
    try {
      reg.add(sourceSession(pool, []))
      const slot = new PaneSlot('lambda', SOURCE)
      const pad = new LambdaScratchpad({
        registry: reg,
        pool,
        id: SCRATCH,
        label: 'λ scratchpad',
        historyBytes: HISTORY_BYTES,
        onReply: (r) => seen.push(r),
      })

      pad.detach(slot, 'λx. x')
      await until(() => seen.some((r) => r.kind === 'scratch-compiled'), "the scratchpad's thread to answer")
      const thread = spawned[1]
      if (thread === undefined) throw new Error('the fork should have spawned a second thread')

      // Everything a `retire` that forgot `pool.unbind` would also satisfy.
      expect(pad.retire(SOURCE, [slot])).toBe(true)
      expect(slot.binding.session).toBe(SOURCE)
      expect(reg.has(SCRATCH)).toBe(false)
      expect(pool.has(SCRATCH)).toBe(false)
      expect(pool.size).toBe(1)

      // And the thing it would not: the thread itself.
      expect(thread.terminated).toBe(1)
      const afterDeath: RunReply[] = []
      thread.worker.addEventListener('message', (e: MessageEvent<RunReply>) => afterDeath.push(e.data))
      thread.worker.postMessage({ kind: 'lambda-scratch', gen: 99, src: 'λz. z' })
      // 3 SECONDS AGAINST A THREAD THAT ANSWERED THE IDENTICAL MESSAGE IN THE `until` ABOVE, which is
      // what makes silence mean something here. A live worker's `lambdaScratch` on a two-token term is
      // one uninterruptible parse and a print; the wait above measures it at well under a second.
      await new Promise((r) => setTimeout(r, 3_000))
      expect(afterDeath).toEqual([])
    } finally {
      for (const id of [SOURCE, SCRATCH]) pool.unbind(id)
    }
  })
})
