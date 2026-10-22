import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { createEditorCustody } from '../../src/editor-custody'
import { LambdaPane } from '../../src/lambda-pane'
import { LambdaTrees } from '../../src/lambda-trees'
import { createLinkWiring } from '../../src/link-wiring'
import { PaneCollection } from '../../src/panes'
import type { RunReply } from '../../src/protocol'
import { FRAME_BYTES, HISTORY_BYTES, lambdaFrameBytes, tmFrameBytes } from '../../src/protocol'
import { createReplies } from '../../src/replies'
import { ScratchBuffers } from '../../src/scratch'
import type { PoolPort, SessionId } from '../../src/session-client'
import { SessionPool } from '../../src/session-client'
import type { SessionEntry } from '../../src/sessions'
import { PaneSlot, SessionRegistry } from '../../src/sessions'
import type { LambdaState, TmState } from '../../src/types'
import { legState } from '../node/leg-fixture'
import { clickLambda, idle, lambdaStepText, SHELL, until } from './harness'
import { lambdaSettled } from './lambda-text'

/**
 * **THE TWO CLAIMS A FAKE PORT CANNOT ANSWER**, over real `session-worker.ts` threads.
 *
 *   1. **The source session is untouched and KEEPS RUNNING across a detach** (5d-i design §4.3),
 *      which is the reason the copy and the source are two sessions, not one mutable one.
 *      `tests/node/scratch.test.ts` asserts the structural half — same entry, same client, same
 *      frames — and that half passes on an implementation that reuses the source's own thread and
 *      merely happens not to have touched the objects yet. Only a thread mid-recording can show the
 *      difference: the step count has to keep MOVING while the fork happens.
 *   2. **Retiring a scratchpad TERMINATES ITS WORKER** (5d-ii-c design §3.3), not merely forgets
 *      it. Asserting that the panes rebound lets the leak pass: `pool.size`, `pool.has` and every
 *      binding stay correct on an implementation that never calls `terminate`, while a wasm module
 *      and its thread run on forever.
 *
 * NEITHER IS DRIVEN THROUGH THE APP: neither `pool.size` nor a worker's liveness is reachable from the
 * DOM. `scratch-app.test.ts` drives the control and the app wiring; this file's first `describe` drives
 * the mechanism.
 */

const SOURCE: SessionId = 'source'
/**
 * The ids `ScratchBuffers.fork` mints for the first and second buffers of a fresh collection.
 *
 * WRITTEN DOWN RATHER THAN CAPTURED FROM `fork`'s RETURN because both are also needed in `finally`,
 * outside the scope each `fork` call sits in. `tests/node/scratch.test.ts` is where the minting rule
 * itself is asserted — against the returned id.
 */
const SCRATCH: SessionId = 'scratch-1'
const SCRATCH_2: SessionId = 'scratch-2'

/**
 * `map`/`fold` over three elements — chosen because its TM leg is enormous (25,852 rows,
 * 5a-ii design §3.1; 266,863 δ-steps against 555 β-steps, 5c design §0).
 *
 * THE ASYMMETRY IS THE POINT AND NOT A COINCIDENCE. The claim under test is that the source session
 * goes on recording WHILE a fork happens, so the fixture has to still be recording when the main
 * thread gets its turn: `session-worker.ts` posts `compiled` BEFORE it steps anything, then records
 * in `RECORD_CHUNK`-sized chunks with a macrotask yield between each. At ~58,000 retained TM frames
 * (`HISTORY_BYTES` / ~550 B) that is ~227 yields and seconds of wall clock, against the
 * sub-millisecond it takes the main thread to dequeue one message. A short program would finish
 * before the detach and prove nothing.
 */
const BIG = `fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }
fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }
fn add(a, b) { a + b }
fn add1(x) { x + 1 }
fold([3, 1, 2].map(add1), 0, add)`

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
  const pool = new SessionPool(
    (): PoolPort => {
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
    },
    () => {},
  )
  return { pool, spawned }
}

/**
 * The source session, wired to a real thread, with the frame-landing rules of `replies.ts`'s `onReply`.
 *
 * THE REPLY HANDLER IS `onReply`'s λ AND TM FRAME ARMS AND NOTHING ELSE. What is under test is whether
 * the legs go on filling, so the arms that touch `#results`, the link index and the panes are not
 * reproduced — reproducing them would put a copy of the app in a test file, which is the failure
 * `tests/node/sessions.test.ts` avoids by sharing `PaneSlot.render` instead.
 */
function sourceSession(pool: SessionPool, seen: RunReply[]): SessionEntry {
  const legs = { lambda: legState<LambdaState>(false, HISTORY_BYTES), tm: legState<TmState>(false, HISTORY_BYTES) }
  const client = pool.bind(SOURCE, (reply) => {
    seen.push(reply)
    if (reply.kind === 'lambda-frames') {
      for (const f of reply.frames) legs.lambda.hist.push(f, lambdaFrameBytes(f))
    } else if (reply.kind === 'tm-frames') {
      for (const f of reply.frames) legs.tm.hist.push(f, tmFrameBytes(f))
    }
  })
  return {
    id: SOURCE,
    label: 'source',
    detached: false,
    client,
    legs,
    tmProgram: null,
    tmScratch: null,
    asmProgram: null,
    asmScratch: null,
  }
}

describe('detach is a fork', () => {
  /**
   * **THE SOURCE SESSION'S STEP COUNT ADVANCES ACROSS A DETACH** — a detach that mutated the source
   * session in place instead of forking would leave it frozen.
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
      const pad = new ScratchBuffers({
        registry: reg,
        pool,
        historyBytes: HISTORY_BYTES,
        onReply: () => undefined,
      })

      source.client.request(source.client.supersede(), BIG, 'unary')
      await until(() => seen.some((r) => r.kind === 'compiled'), "the source session's compile")

      const tm = reg.legOf({ session: SOURCE, leg: 'tm' })
      const before = tm.hist.newestStep
      pad.fork(slot, '(λx. x) (λy. y)', 0, 'lambda')

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
   * parser round-trip, and `viewMenu` leans on that promise to decide a fork is possible — this
   * seeds the scratchpad with a term in exactly the printer's own output form (`λ`, application by
   * juxtaposition) and asserts it reduced rather than answering `no-session`.
   */
  it('builds a scratchpad that reduces its seed on its own thread', { timeout: 120_000 }, async () => {
    const { pool } = realPool()
    const reg = new SessionRegistry()
    const seen: RunReply[] = []
    try {
      reg.add(sourceSession(pool, []))
      const pad = new ScratchBuffers({
        registry: reg,
        pool,
        historyBytes: HISTORY_BYTES,
        onReply: (_session, reply) => {
          seen.push(reply)
          if (reply.kind === 'lambda-frames') {
            const l = reg.legOf({ session: SCRATCH, leg: 'lambda' })
            for (const f of reply.frames) l.hist.push(f, lambdaFrameBytes(f))
            l.done = reply.done
          }
        },
      })

      pad.fork(new PaneSlot('lambda', SOURCE), '(λx. x) (λy. y)', 0, 'lambda')
      await until(() => seen.some((r) => r.kind === 'lambda-frames' && r.done !== null), "the scratchpad's frames")

      // `scratch-compiled`, NOT `compiled`, and never a `result`: 5d-i §3.3 puts `lambdaValue`,
      // `linkIndex` and the TM leg off this type, so the messages that carry them cannot be sent for it.
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
   * **RETIRING TERMINATES THE WORKER — ASSERTED ON THE THREAD, NOT ON THE MAP.**
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
      const pad = new ScratchBuffers({
        registry: reg,
        pool,
        historyBytes: HISTORY_BYTES,
        onReply: (_session, r) => seen.push(r),
      })

      pad.fork(slot, 'λx. x', 0, 'lambda')
      await until(() => seen.some((r) => r.kind === 'scratch-compiled'), "the scratchpad's thread to answer")
      const thread = spawned[1]
      if (thread === undefined) throw new Error('the fork should have spawned a second thread')

      // Everything a `retire` that forgot `pool.unbind` would also satisfy.
      expect(pad.retire(SCRATCH, SOURCE, [slot])).toBe(true)
      expect(slot.binding.session).toBe(SOURCE)
      expect(reg.has(SCRATCH)).toBe(false)
      expect(pool.has(SCRATCH)).toBe(false)
      expect(pool.size).toBe(1)

      // And the thing it would not: the thread itself.
      expect(thread.terminated).toBe(1)
      const afterDeath: RunReply[] = []
      thread.worker.addEventListener('message', (e: MessageEvent<RunReply>) => afterDeath.push(e.data))
      thread.worker.postMessage({ kind: 'lambda-scratch', gen: 99, src: 'λz. z', step: 0 })
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

/**
 * **THE `no-session` REPORT.** `fork` rebinds a pane to a new λ buffer SYNCHRONOUSLY, before the worker
 * has answered (`ScratchBuffers.noSessionReply`'s doc: "`fork` has ALREADY rebound the pane
 * synchronously"), so a build that fails strands the pane there: `scratch-compiled` never fires, so
 * `LambdaPane.setEditor` is never called; the step readout is stuck on the `'building…'` placeholder
 * `fork` seeds; and `#refreshDetach`'s `!this.#detached` gate hides the control that would fork again,
 * because the session the pane is stuck on IS the one that never works. `ScratchBuffers.noSessionReply`
 * is what reports it. Nothing ends a buffer implicitly (5d-ii-c §4.3), so the stranding is the state a
 * failed fork LEAVES; 5d-ii-c §4.4 makes the header list the way out, which can reach a wedged buffer
 * whether or not a pane still shows it, and the first test below drives that way out at this layer, one
 * assertion after the one that pins the stranding. This method reports, and something the user aims at
 * is what repairs.
 *
 * **AN UNPARSEABLE SEED, DELIBERATELY, NOT A GENUINELY OVER-BUDGET TERM.** Both reach the identical
 * `scratch === null` branch of `session-worker.ts`'s `onLambdaScratch` (`ForkedAt`'s doc in
 * `session.rs`: "`text` IS `None` FOR EXACTLY THE CASES `scratch` IS"), but a real term over
 * `LAMBDA_BYTE_BUDGET` (65,536 bytes) needs a genuinely large fixture to construct and would make this
 * test slow; garbage text is one string literal and fails in the same place for a different reason
 * `lambda_scratch_at` already tests directly in Rust (`lambda_scratch_at_refuses_unparseable_text`).
 *
 * **DRIVEN AT THE `ScratchBuffers`/`PaneSlot`/`LambdaPane` LAYER, NOT THROUGH `main.ts`'s `ready`
 * APP, AND THAT IS A DELIBERATE CHOICE RATHER THAN A SHORTCUT.** `transport.ts`'s `detach` handler
 * always sends `index.lambdaText` — the SOURCE compile's own step-0 print, which round-trips by
 * construction (`lambda/syntax.rs`'s guarantee) unless it is itself cut at `LAMBDA_BYTE_BUDGET`, which
 * only a genuinely enormous program reaches. There is no seam in the mounted app to hand `detach` a
 * deliberately broken string instead. `PaneSlot.render` is written to be "the SAME resolution the app's
 * `draw()` does rather than a re-implementation of it" (`sessions.ts`'s own doc), and the `describe`
 * above drives `ScratchBuffers` directly over real `session-worker.ts` threads for the identical
 * reason. Nothing here re-implements `noSessionReply`; it is the exact method `replies.ts`'s
 * `onScratchReply` calls.
 */
describe('the no-session report for a failed fork', () => {
  it('keeps a phantom buffer and its pane and hands back a diagnostic to show — but answers null for an already-live scratch', {
    timeout: 120_000,
  }, async () => {
    const { pool } = realPool()
    const reg = new SessionRegistry()
    const slot = new PaneSlot('lambda', SOURCE)
    const seen: RunReply[] = []
    const pad = new ScratchBuffers({
      registry: reg,
      pool,
      historyBytes: HISTORY_BYTES,
      // **FRAMES LAND IN THE LEG OF THE BUFFER THAT SENT THEM.** This test has two buffers: the phantom
      // is retired half way through, and the live-edit buffer below is a SECOND session whose frames
      // arrive after `SCRATCH` has left the registry, so a handler naming `SCRATCH` as a constant would
      // make `legOf` throw on the reply that proves the second buffer works. Routing by the reply's own
      // session is what `ScratchBuffersConfig.onReply` curries the id in for, and it is the same
      // resolution `replies.ts`'s `onScratchReply` performs.
      onReply: (session, r) => {
        seen.push(r)
        if (r.kind === 'lambda-frames') {
          const l = reg.legOf({ session, leg: 'lambda' })
          for (const f of r.frames) l.hist.push(f, lambdaFrameBytes(f))
          l.done = r.done
        }
      },
    })

    const host = document.createElement('div')
    document.body.append(host)
    try {
      reg.add(sourceSession(pool, []))
      // A REAL, COMPILED SOURCE LEG — `#refreshDetach` refuses the fork control with no frame to
      // report a step against (`render(null, …)`), same as an uncompiled page, so the source session
      // needs one real frame before the button this test starts by checking can exist at all.
      const srcLeg = reg.legOf({ session: SOURCE, leg: 'lambda' })
      const srcClient = reg.entryOf(SOURCE).client
      srcClient.request(srcClient.supersede(), 'let x = 40; x + 2', 'unary')
      await until(() => srcLeg.hist.current !== undefined, 'the source session to compile')

      // A REAL `LambdaPane`, WIRED THE WAY `main.ts` WIRES ONE — `slot.render` is the same call
      // `draw()` makes, so "the fork control is back in the DOM" is asserted on the real chrome
      // rather than on a fact about the registry alone.
      const pane = new LambdaPane(host, {
        back: () => undefined,
        forward: () => undefined,
        toNewest: () => undefined,
        play: () => undefined,
        restart: () => undefined,
        extend: () => undefined,
        speed: () => 8,
        setSpeed: () => undefined,
        rebind: (binding) => slot.rebind(binding.session),
        detach: () => undefined,
      })
      slot.render(reg, pane, slot.resolve(reg))
      expect(host.querySelector('button.detach')).not.toBeNull()

      // THE PHANTOM BUILD. `detach` has already rebound the slot by the time this call returns.
      pad.fork(slot, 'not a valid lambda term (((', 0, 'lambda')
      slot.render(reg, pane, slot.resolve(reg))
      expect(slot.binding.session).toBe(SCRATCH)

      await until(() => seen.some((r) => r.kind === 'no-session'), 'the failed build to answer')
      const failReply = seen.find((r) => r.kind === 'no-session')
      if (failReply === undefined || failReply.kind !== 'no-session') throw new Error('expected a no-session reply')
      expect(failReply.diagnostics.length).toBeGreaterThan(0)

      // CALLED EXACTLY AS `replies.ts`'s `onScratchReply` CALLS IT — including the session, which that
      // handler takes as its own first parameter.
      const failed = pad.noSessionReply(SCRATCH, failReply.diagnostics)
      slot.render(reg, pane, slot.resolve(reg))

      // **THE BUFFER SURVIVES ITS OWN FAILED BUILD** — 5d-ii-c §4.3's table puts poison under *survives*.
      expect(failed).not.toBeNull()
      expect(slot.binding.session).toBe(SCRATCH)
      expect(reg.has(SCRATCH)).toBe(true)
      // **AND THE FORK CONTROL IS NOT BACK, WHICH IS WHAT THAT COSTS THE USER.** The pane is still on the
      // buffer that will never build, so `#refreshDetach`'s gate hides ✎, and the header list is what
      // has to reach the buffer instead (5d-ii-c §4.4).
      expect(host.querySelector('button.detach')).toBeNull()

      // **AND THAT IS NOT A DEAD END: THE WAY OUT IS ONE GESTURE**, retiring the row from 5d-ii-c §4.2's
      // header list, and the rebind happens because the user asked for it. **DRIVEN AS THE CALL THE
      // LIST'S HANDLER MAKES**, at the layer this whole `describe` drives — `retire`, then the render
      // that any `draw()` performs — so what is asserted is the chrome the user gets back and not a fact
      // about the registry.
      expect(pad.retire(SCRATCH, SOURCE, [slot])).toBe(true)
      slot.render(reg, pane, slot.resolve(reg))
      expect(slot.binding.session).toBe(SOURCE)
      expect(host.querySelector('button.detach')).not.toBeNull()

      // THE DIAGNOSTIC'S SURFACE IS A NOTICE (Plan 7 part 2 spec §11), so what is visible is asserted
      // where the notice is raised: the `createReplies` test below reads what the production switch hands
      // its `notify`.
      expect(failed).not.toBeNull()

      // THE LIVE-EDIT CASE, FOR CONTRAST, ON THE SAME `ScratchBuffers` OBJECT. 5d-iii §4.4: "an edit
      // that does not parse leaves the frames region showing the last good run" — and since both buffers
      // survive, the contrast is in the answer: `null` here is the live-edit path, whose gutter
      // `scratch-edit.test.ts`'s STAGE 3 pins through the app; this asserts the same rule at the method
      // `replies.ts`'s `onScratchReply` calls.
      //
      // A SECOND NAME, BECAUSE THIS IS A SECOND BUFFER: 5d-ii-c decision 1 mints per fork and never
      // reissues a retired name, so this line's buffer is `scratch 2`.
      expect(reg.has(SCRATCH_2)).toBe(false)
      pad.fork(slot, '(λx. x) (λy. y)', 0, 'lambda')
      await until(() => seen.some((r) => r.kind === 'lambda-frames' && r.done !== null), "the buffer's frames")
      expect(reg.has(SCRATCH_2)).toBe(true)
      expect(reg.legOf({ session: SCRATCH_2, leg: 'lambda' }).hist.current).not.toBeUndefined()

      const stillLive = pad.noSessionReply(SCRATCH_2, [
        { span: { start: 0, end: 0 }, severity: 'Error', message: 'a fabricated parse failure' },
      ])
      expect(stillLive).toBeNull()
      expect(reg.has(SCRATCH_2)).toBe(true)
      expect(slot.binding.session).toBe(SCRATCH_2)

      // **AND A RETIRED BUFFER'S NAME REACHES NOTHING.** A `no-session` addressed to `SCRATCH` arrives
      // after that buffer ended, and the answer is `null` with the live buffer untouched; answered
      // on behalf of the newest buffer, it would be answered for `SCRATCH_2` — a different buffer,
      // still healthy.
      //
      // **THE `retire` HERE IS A SECOND ONE ON A SPENT NAME.** The first is made above, where reclaiming
      // the wedged pane is what it is for, and this one is `retire`'s own idempotence and exactly the
      // state the paragraph above needs: a name held across the retire that spent it. `false` rather than
      // a second termination of a thread that is already gone.
      //
      // THE MEMBERSHIP CHECK IS THE PRECONDITION AND IS READ FIRST: the name in hand no longer resolves,
      // which is what makes the two calls after it interesting at all.
      expect(reg.has(SCRATCH)).toBe(false)
      expect(pad.retire(SCRATCH, SOURCE, [slot])).toBe(false)
      expect(pad.noSessionReply(SCRATCH, failReply.diagnostics)).toBeNull()
      expect(reg.has(SCRATCH_2)).toBe(true)
      expect(slot.binding.session).toBe(SCRATCH_2)
    } finally {
      pool.unbind(SOURCE)
      pool.unbind(SCRATCH)
      pool.unbind(SCRATCH_2)
      host.remove()
    }
  })

  /**
   * **THE PRODUCTION ARM, DRIVEN AGAINST A REAL FAILED FORK.** The production switch, handed a `no-session`
   * for a fork that really failed to build, leaves the buffer registered, pooled and listed, leaves the pane
   * on it, and hands the reason to `notify`: 5d-ii-c §4.3's rule that nothing ends a buffer implicitly,
   * executed rather than argued. A call that ends no session has no editors to sweep, so this arm sweeps
   * none; `tests/browser/editor-custody.test.ts` executes the sweep's destroy branch, over the real
   * `createEditorCustody` rather than a stub.
   *
   * **IT DRIVES `createReplies` RATHER THAN `main()`.** The `describe` above says a test needing both a
   * cheap unparseable seed and the production code path has no seam in the mounted app; `replies.ts`
   * exports the production switch behind a factory, so it is constructible over the same hand-built
   * registry, pool and pane the tests above use. Everything here but the injected dependencies is the
   * app's own object: the reply comes off a REAL `session-worker.ts` thread that really failed to build,
   * and the survival and the fork-failed report are the production ones.
   *
   * `notify` IS A RECORDER, AND THAT IS ALL THE REPORT NEEDS: the switch hands the notice to it, and the
   * notice line is `notice.ts`'s own concern (`tests/browser/notice.test.ts`).
   */
  it('leaves the buffer live on the phantom no-session, through `createReplies` rather than around it', {
    timeout: 120_000,
  }, async () => {
    const { pool } = realPool()
    const reg = new SessionRegistry()
    const seen: RunReply[] = []
    const pad = new ScratchBuffers({
      registry: reg,
      pool,
      historyBytes: HISTORY_BYTES,
      onReply: (_session, r) => seen.push(r),
    })

    const host = document.createElement('div')
    document.body.append(host)
    const statusHost = document.createElement('div')
    const results = document.createElement('div')
    // A REAL `EditorView` WITH NO PARENT — `createReplies` takes it as a thunk and the arm under test
    // never calls it, but a stub would be a cast, and this costs one unattached DOM node.
    const view = new EditorView()
    const panes = new PaneCollection()
    try {
      reg.add(sourceSession(pool, []))
      const slot = new PaneSlot('lambda', SOURCE)
      const pane = new LambdaPane(host, {
        back: () => undefined,
        forward: () => undefined,
        toNewest: () => undefined,
        play: () => undefined,
        restart: () => undefined,
        extend: () => undefined,
        speed: () => 8,
        setSpeed: () => undefined,
        rebind: (binding) => slot.rebind(binding.session),
        detach: () => undefined,
        // PRESENT SO THE CLAIM CONTROL IS BUILT AT ALL — `LambdaPane`'s `#claim` is `null` on a pane
        // whose events carry no `showEditor`, so without this the item-11 assertions below would be
        // asserting the absence of a button that was never constructible. The handler itself is never
        // called: what is under test is whether the control is OFFERED.
        showEditor: () => undefined,
      })
      // IN THE COLLECTION, because "the pane did not move" is the claim, and it is vacuous without a pane
      // the arm could have reached.
      panes.add({ id: 'lambda-0', kind: 'lambda', slot, pane, host })

      let drawn = 0
      const links = createLinkWiring({
        announce: () => undefined,
        view: () => view,
        statusHost,
        sessions: reg,
        panes,
        draw: () => {
          drawn += 1
        },
        viewTitle: () => '',
        arranged: () => true,
      })
      const notified: string[] = []
      const editorAsked: SessionId[] = []
      const replies = createReplies({
        setProgram: () => undefined,
        trees: new LambdaTrees(() => undefined),
        sessions: reg,
        scratchpad: pad,
        results,
        view: () => view,
        panes,
        links,
        notify: (t: string) => {
          notified.push(t)
        },
        draw: () => {
          drawn += 1
        },
        // NO EDITOR WAS EVER MOUNTED FOR THIS FORK, whose build never reached `scratch-compiled`, so the
        // failed fork's arm has none to reach. This arm performs no retire and sweeps nothing;
        // `editor-custody.ts`'s own doc holds the sweep's argument, and none of the sweep's callers is this
        // file. IT RECORDS WHO ASKS, and the assertion is on the asking, not on this `undefined`: the app's
        // `editorHome`, `editor-custody.ts`'s `editorHomeFor`, would answer this pane, through the claim
        // `pane-host.ts`'s wrapped `detach` records (restated below). A call recorded here means the arm
        // has started reaching for an editor.
        editorHome: (session) => {
          editorAsked.push(session)
          return undefined
        },
        // A NO-OP: the reply this test drives is a `no-session` for a fork whose build never reached
        // `scratch-compiled`, and the `no-session` arm does not persist, so nothing here would fire it.
        onBuffersPersist: () => undefined,
      })

      // THE PHANTOM BUILD — an unparseable seed, for the reason this `describe`'s doc gives: it reaches the
      // identical `scratch === null` branch of `onLambdaScratch` as a genuinely over-budget term without
      // needing an enormous fixture.
      pad.fork(slot, 'not a valid lambda term (((', 0, 'lambda')
      expect(slot.binding.session).toBe(SCRATCH)
      await until(() => seen.some((r) => r.kind === 'no-session'), 'the failed build to answer')
      const failReply = seen.find((r) => r.kind === 'no-session')
      if (failReply === undefined || failReply.kind !== 'no-session') throw new Error('expected a no-session reply')

      expect(notified).toEqual([])
      replies.onScratchReply(SCRATCH, failReply)

      // **THE BUFFER SURVIVES THE PRODUCTION SWITCH.** It is still registered, still on its own thread,
      // still listed, and the pane the fork moved is still showing it — 5d-ii-c §4.3's rule, executed
      // through the production switch.
      expect(reg.has(SCRATCH)).toBe(true)
      expect(pool.has(SCRATCH)).toBe(true)
      expect(pad.list().map((b) => b.id)).toEqual([SCRATCH])
      expect(slot.binding.session).toBe(SCRATCH)
      // AND THE REPORT STILL LANDS, so a green survival is not a green test over a switch that fell
      // through somewhere else: nothing was notified a line above the call, and the notice carries the
      // worker's own diagnostics after it.
      expect(notified).toHaveLength(1)
      expect(notified[0]).toContain('the copy did not build')
      for (const d of failReply.diagnostics) expect(notified[0] ?? '').toContain(d.message)
      expect(drawn).toBeGreaterThan(0)
      expect(editorAsked).toEqual([])

      // **DEFERRED-A11Y ITEM 11, OVER THE BUILD THAT REALLY FAILED.** Everything above pins what the
      // stranding LEAVES; this pins what the chrome does about it, and it is here rather than only in
      // `editor-custody.test.ts` because that file reconstructs the state (`takeEditor` off a holder)
      // while this one arrives at it the way a user does — a real seed, a real thread, a real
      // `no-session`. `setEditor` was never called on this path, so no editor for `SCRATCH`
      // exists anywhere.
      //
      // THE CLAIM IS RECORDED FIRST, BECAUSE `pane-host.ts`'s WRAPPED `detach` RECORDS ONE. It fires the
      // moment the binding moves — before the worker has answered, therefore also on the fork that never
      // builds — so a test that omitted it would delete the whole difficulty: `homeFor` would answer
      // `undefined` and a `hasEditor` written the wrong way would pass. `main.ts` is not driven here, so
      // the line that handler runs is restated rather than reached.
      // `collapsedOf` IS NEVER ASKED — this reconstruction never reaches a `receiveEditor` call (the
      // fork failed, so there is no editor to move), so a stub that would fail loudly if it ever were
      // called is more honest than a real reader over a buffer this test never collapses.
      const custody = createEditorCustody({
        panes,
        sessions: reg,
        collapsedOf: () => {
          throw new Error('collapsedOf should not be read: no editor ever mounts on this path')
        },
      })
      custody.claim(SCRATCH, 'lambda-0')
      expect(custody.homeFor(SCRATCH)).toBe(pane)
      expect(custody.hasEditor(SCRATCH)).toBe(false)

      // AND THE CONTROL IS WITHDRAWN — the one line `draw()` adds, run by hand for want of a `draw()`.
      // `setDetached(true)` is what `PaneSlot.render` would have pushed for a pane on a detached
      // session; both are needed because the gate reads both.
      pane.setDetached(true)
      pane.setEditorAvailable(custody.hasEditor(SCRATCH))
      expect(host.querySelector('button.claim-editor')).toBeNull()
    } finally {
      view.destroy()
      pool.unbind(SOURCE)
      pool.unbind(SCRATCH)
      host.remove()
    }
  })
})

/**
 * **THE DOM HALF OF 5d-iii §4.1A'S CLAIM, DRIVEN THROUGH THE REAL APP.** That the CONTROL forks a
 * truncated frame is a fact about `LambdaPane.#refreshDetach` and the DOM it drives, not about the
 * session underneath it, so this block mounts the real app, the same `SHELL` `scratch-app.test.ts` uses
 * and for the same "one page per test FILE" reason its own comment states.
 *
 * `WHILE4` IS THE FIXTURE BECAUSE IT TRUNCATES AT THE FRAME'S OWN PRINT AND STAYS WHOLE AT THE
 * READOUT'S: `cut === 'Bytes'` at the 512-byte budget on every one of steps 0 through 9, and
 * `cut === null` at the 65,536-byte budget throughout. Programs the size of `let x = 40; x + 2`
 * (`scratch-app.test.ts`) never truncate at either budget.
 */
describe('the fork control forks a truncated frame, through the app', () => {
  const WHILE4 = 'let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc'

  let view: EditorView

  // ONE MOUNT FOR THE FILE, for the reason `app.test.ts` gives: ES module imports are cached, so
  // `main()` runs once per page. The two `describe` blocks above never import `../../src/main` at
  // all, so this is the first and only mount in this file; nothing above shares a page with it.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(idle, 'the first compile')
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: WHILE4 } })
    await until(idle, 'the truncating program to compile')
  }, 60_000)

  it('forks a TRUNCATED frame and seeds the editor with the whole term', async () => {
    // `↺` FIRST, so the walk starts at step 0 (`scratch-app.test.ts`'s own note).
    // Two steps forward from there is not the free `step === 0` case 5d-iii §4.1a calls out — the
    // worker has to do the replay, not skip it.
    clickLambda('↺')
    clickLambda('▶')
    clickLambda('▶')
    expect(lambdaStepText()).toContain('step 2 of')

    // THE CAPABILITY UNDER TEST: the fork control is offered on a frame this truncated — `lambda-pane.ts`'s
    // own module doc: "most non-trivial frames WILL truncate".
    //
    // **THE TRUNCATION IS ASSERTED ON THE SEED BELOW, NOT ON SCREEN.** The λ view draws the step's tree,
    // which is the whole term, and shows the 512-byte frame only until the tree arrives, so reading the
    // screen would race the tree.
    await lambdaSettled()
    const fork = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')
    expect(fork).not.toBeNull()

    fork?.click()

    await until(() => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null, 'the editor to mount')
    const editorText = document.querySelector('[data-leaf="lambda-0"] .term-editor')?.textContent ?? ''
    expect(editorText).not.toBe('')
    // NOT A PREFIX. A truncated frame's own text ends mid-token, with no closing paren or binder; the
    // editor's seed is the worker's full-fidelity re-print (`index.lambdaText`, replayed to step 2
    // and re-printed at `LAMBDA_BYTE_BUDGET`), a WHOLE, parseable term — `lambda/syntax.rs`'s
    // round-trip guarantee holds over it, which is not a promise `while4`'s 512-byte frame ever made.
    expect(editorText).not.toContain('…')
    // AND THE FRAME THIS FORKED FROM WAS CUT. The seed is the whole step-2 term as the printer writes it, and
    // it is longer than the frame's budget, so the frame's own print at `FRAME_BYTES` could not have held
    // it. Read off CodeMirror's document, not the DOM's text, which carries only what the editor renders.
    const host = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor')
    const seed = host === null ? '' : (EditorView.findFromDOM(host)?.state.doc.toString() ?? '')
    expect(new TextEncoder().encode(seed).length).toBeGreaterThan(FRAME_BYTES)

    // AND THE SOURCE SESSION IS STILL THE ONE THE PANE LEFT — the scratch is a second session, not a
    // mutation of the first (5d-i §4.3, and this file's first `describe` proves the mechanism directly).
    // `copy · not linked` is the DOM's own witness that a second session now exists at all.
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('copy · not linked')
  })
})
