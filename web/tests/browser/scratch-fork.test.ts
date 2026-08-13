import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { History } from '../../src/history'
import { LambdaPane } from '../../src/lambda-pane'
import { linkStatus } from '../../src/link-status'
import { createLinkWiring } from '../../src/link-wiring'
import { PaneCollection } from '../../src/panes'
import type { RunReply } from '../../src/protocol'
import { HISTORY_BYTES, lambdaFrameBytes, tmFrameBytes } from '../../src/protocol'
import { createReplies } from '../../src/replies'
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
      pad.detach(slot, '(λx. x) (λy. y)', 0)

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

      pad.detach(new PaneSlot('lambda', SOURCE), '(λx. x) (λy. y)', 0)
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

      pad.detach(slot, 'λx. x', 0)
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
 * **THE `no-session` REMEDY — CRITICAL finding, plan 5d-iii's ninth task.** `detach` rebinds a pane to
 * the λ scratchpad SYNCHRONOUSLY, before the worker has answered (`scratch.ts`'s own doc: "supersede
 * then post"), so a build that fails used to strand the pane there forever: `scratch-compiled` never
 * fires, so `LambdaPane.setEditor` is never called and `setDiagnostics` is a silent no-op against
 * `#editor === null`; the step readout is stuck on the `'building…'` placeholder `detach` seeds; and
 * `#refreshDetach`'s `!this.#detached` gate hides the only control that could recover it, because the
 * session the pane is stuck on IS the one that never works. Design §4.1a promises the opposite: "the
 * pane keeps offering ✎ — the user can scrub to a smaller step and fork there". `LambdaScratchpad.
 * noSessionReply` is the fix, and this is the test that would have failed before it existed.
 *
 * **AN UNPARSEABLE SEED, DELIBERATELY, NOT A GENUINELY OVER-BUDGET TERM.** Both reach the identical
 * `scratch === null` branch of `session-worker.ts`'s `onLambdaScratch` (`ForkedAt`'s doc in
 * `session.rs`: "`scratch` and `text` are null together"), but a real term over `LAMBDA_BYTE_BUDGET`
 * (65,536 bytes) needs a genuinely large fixture to construct and would make this test slow; garbage
 * text is one string literal and fails in the same place for a different reason `lambda_scratch_at`
 * already tests directly in Rust (`lambda_scratch_at_refuses_unparseable_text`).
 *
 * **DRIVEN AT THE `LambdaScratchpad`/`PaneSlot`/`LambdaPane` LAYER, NOT THROUGH `main.ts`'s `ready`
 * APP, AND THAT IS A DELIBERATE CHOICE RATHER THAN A SHORTCUT.** `main.ts`'s own `detach` handler
 * always sends `index.lambdaText` — the SOURCE compile's own step-0 print, which round-trips by
 * construction (`lambda/syntax.rs`'s guarantee) unless it is itself cut at `LAMBDA_BYTE_BUDGET`, which
 * only a genuinely enormous program reaches. There is no seam in the mounted app to hand `detach` a
 * deliberately broken string instead, and ~~`onScratchReply` is a closure with no export~~ — so a test
 * that needed BOTH a cheap unparseable seed AND the exact production code path had nowhere to go
 * through `main.ts` at all.
 *
 * **THE STRUCK CLAUSE EXPIRED IN WAVE 1 AND NOBODY NOTICED FOR TWENTY-SEVEN COMMITS.** `replies.ts`
 * now exports `createReplies`, whose return type includes `onScratchReply`, so the seam this paragraph
 * says does not exist has existed since the extraction. **The counterexample is in this very file**, 130
 * lines below: the third-round test drives that exact production path. The reasoning above still holds
 * for the *seed* half — there is genuinely no way to hand `detach` a broken string — and only the
 * no-export half is dead.
 *
 * Recorded struck-through rather than deleted because this is the third instance on this branch of an
 * impossibility claim outliving the change that falsified it, and the pattern is worth more than the
 * sentence. This file's own siblings already establish the alternative this test
 * follows: `PaneSlot.render` is written to be "the SAME resolution the app's `draw()` does rather than
 * a re-implementation of it" (`sessions.ts`'s own doc), and the `describe` above drives
 * `LambdaScratchpad` directly over real `session-worker.ts` threads for the identical reason. Nothing
 * here re-implements `noSessionReply`; it is the exact method `main.ts`'s `onScratchReply` calls.
 */
describe('the no-session remedy for a failed fork', () => {
  it('retires a phantom scratchpad, restores the fork control, and hands back a diagnostic to show — but leaves an already-live scratch alone', {
    timeout: 120_000,
  }, async () => {
    const { pool } = realPool()
    const reg = new SessionRegistry()
    const slot = new PaneSlot('lambda', SOURCE)
    const seen: RunReply[] = []
    const pad = new LambdaScratchpad({
      registry: reg,
      pool,
      id: SCRATCH,
      label: 'λ scratchpad',
      historyBytes: HISTORY_BYTES,
      onReply: (r) => {
        seen.push(r)
        if (r.kind === 'lambda-frames') {
          const l = reg.legOf({ session: SCRATCH, leg: 'lambda' })
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
        play: () => undefined,
        restart: () => undefined,
        extend: () => undefined,
        rebind: (session) => slot.rebind(session),
        detach: () => undefined,
      })
      slot.render(reg, pane, slot.resolve(reg))
      expect(host.querySelector('.controls .detach')).not.toBeNull()

      // THE PHANTOM BUILD. `detach` has already rebound the slot by the time this call returns —
      // the CRITICAL finding's own bug, reproduced here before it is fixed by what comes next.
      pad.detach(slot, 'not a valid lambda term (((', 0)
      slot.render(reg, pane, slot.resolve(reg))
      expect(slot.binding.session).toBe(SCRATCH)

      await until(() => seen.some((r) => r.kind === 'no-session'), 'the failed build to answer')
      const failReply = seen.find((r) => r.kind === 'no-session')
      if (failReply === undefined || failReply.kind !== 'no-session') throw new Error('expected a no-session reply')
      expect(failReply.diagnostics.length).toBeGreaterThan(0)

      // THE FIX, CALLED EXACTLY AS `main.ts`'s `onScratchReply` CALLS IT.
      const failed = pad.noSessionReply(failReply.diagnostics, SOURCE, [slot])
      slot.render(reg, pane, slot.resolve(reg))

      // NOT LEFT DETACHED.
      expect(failed).not.toBeNull()
      expect(slot.binding.session).toBe(SOURCE)
      expect(reg.has(SCRATCH)).toBe(false)
      // THE FORK CONTROL IS BACK IN THE DOM.
      expect(host.querySelector('.controls .detach')).not.toBeNull()
      // THE DIAGNOSTIC IS VISIBLE — composed exactly as `main.ts`'s `drawLink` composes `#link-status`.
      const message = (failed ?? []).map((d) => d.message).join(' · ')
      const line = linkStatus({ state: 'none', forkFailed: message })
      expect(line).toContain('fork failed')
      for (const d of failReply.diagnostics) expect(line).toContain(d.message)

      // THE LIVE-EDIT CASE, FOR CONTRAST, ON THE SAME SCRATCHPAD OBJECT. Design §4.4: "an edit that
      // does not parse leaves the frames region showing the last good run" — a `no-session` for a
      // scratch that already has a good build must NOT retire it, which is the regression
      // `scratch-edit.test.ts`'s STAGE 3 already pins through the app; this asserts the same rule at
      // the method `main.ts` actually calls.
      pad.detach(slot, '(λx. x) (λy. y)', 0)
      await until(() => seen.some((r) => r.kind === 'lambda-frames' && r.done !== null), "the scratchpad's frames")
      expect(reg.has(SCRATCH)).toBe(true)
      expect(reg.legOf({ session: SCRATCH, leg: 'lambda' }).hist.current).not.toBeUndefined()

      const stillLive = pad.noSessionReply(
        [{ span: { start: 0, end: 0 }, severity: 'Error', message: 'a fabricated parse failure' }],
        SOURCE,
        [slot],
      )
      expect(stillLive).toBeNull()
      expect(reg.has(SCRATCH)).toBe(true)
      expect(slot.binding.session).toBe(SCRATCH)
    } finally {
      pool.unbind(SOURCE)
      pool.unbind(SCRATCH)
      host.remove()
    }
  })

  /**
   * **MINOR FINDING, THIRD REVIEW ROUND — THE APP'S SECOND RETIRE PATH WAS DEFENDED BY ARGUMENT ALONE.**
   *
   * Four doc comments assert that BOTH retire sites call `reconcileEditors`, so "a custody entry cannot
   * outlive its session's incarnation" is a property of the retire rather than of which caller happened
   * to trigger it. `pnpm test:coverage` reported the whole phantom-fork arm of `onScratchReply` — the
   * arm that fires when a scratch compile returns no session, `reconcileEditors()` included — as never
   * executed: **deleting that line could not fail a test**,
   * which is the shape this branch has now produced four times. `compile.ts`'s half is driven by
   * `two-lambda-panes.test.ts`; this is the other half, and it is the half the app's own comments claim
   * hardest.
   *
   * **IT DRIVES `createReplies` RATHER THAN `main()`, AND THAT SEAM DID NOT EXIST WHEN THE `describe`
   * ABOVE EXPLAINED WHY IT COULD NOT.** That test's doc says a test needing both a cheap unparseable
   * seed and the production code path "had nowhere to go through `main.ts` at all", because
   * `onScratchReply` was a closure with no export. Wave 1 moved it into `replies.ts` behind an exported
   * factory, so the production switch is now constructible over the same hand-built registry, pool and
   * pane the tests above use. Everything here except three injected dependencies is the app's own
   * object: the reply comes off a REAL `session-worker.ts` thread that really failed to build, and the
   * retire, the rebind and the fork-failed report are the production ones.
   *
   * **THE THREE STUBS ARE THE THREE DEPENDENCIES `main.ts` INJECTS, AND `reconcileEditors` IS THE
   * ASSERTION.** It is a `() => void` closed over `main()`'s own maps, so nothing outside that function
   * can build the real one — which is exactly why it is a parameter. Counting its calls is what makes
   * the deleted-line mutation fail, and `expect(swept).toBe(0)` before the reply is what stops the
   * count from being satisfied by anything earlier in the sequence.
   */
  it('sweeps editors on the phantom no-session, through `createReplies` rather than around it', {
    timeout: 120_000,
  }, async () => {
    const { pool } = realPool()
    const reg = new SessionRegistry()
    const seen: RunReply[] = []
    const pad = new LambdaScratchpad({
      registry: reg,
      pool,
      id: SCRATCH,
      label: 'λ scratchpad',
      historyBytes: HISTORY_BYTES,
      onReply: (r) => seen.push(r),
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
        play: () => undefined,
        restart: () => undefined,
        extend: () => undefined,
        rebind: (session) => slot.rebind(session),
        detach: () => undefined,
      })
      // IN THE COLLECTION, BECAUSE THAT IS WHERE THE PRODUCTION ARM LOOKS FOR SLOTS TO REBIND
      // (`panes.all().map((p) => p.slot)`). A registry entry alone would leave the retire nothing to
      // move, and the rebind assertion below would pass vacuously.
      panes.add({ id: 'lambda-0', kind: 'lambda', slot, pane, host })

      let drawn = 0
      let swept = 0
      const links = createLinkWiring({
        view: () => view,
        statusHost,
        sessions: reg,
        panes,
        draw: () => {
          drawn += 1
        },
      })
      const replies = createReplies({
        sessions: reg,
        scratchpad: pad,
        results,
        view: () => view,
        panes,
        links,
        draw: () => {
          drawn += 1
        },
        sourceSession: SOURCE,
        // `undefined` IS THE HONEST ANSWER HERE AND THE REASON THIS ARM NEEDS THE SWEEP AT ALL: after a
        // retire, `main.ts`'s `editorHomeFor` can no longer resolve any pane to the dead session, so the
        // narrow dependency is a no-op on exactly this path (`compile.ts`'s own doc has the measurement).
        editorHome: () => undefined,
        reconcileEditors: () => {
          swept += 1
        },
      })

      // THE PHANTOM BUILD — an unparseable seed, for the reason the test above records: it reaches the
      // identical `scratch === null` branch of `onLambdaScratch` as a genuinely over-budget term without
      // needing an enormous fixture.
      pad.detach(slot, 'not a valid lambda term (((', 0)
      expect(slot.binding.session).toBe(SCRATCH)
      await until(() => seen.some((r) => r.kind === 'no-session'), 'the failed build to answer')
      const failReply = seen.find((r) => r.kind === 'no-session')
      if (failReply === undefined || failReply.kind !== 'no-session') throw new Error('expected a no-session reply')

      expect(swept).toBe(0)
      replies.onScratchReply(SCRATCH, failReply)

      // THE ASSERTION THE UNCOVERED LINE OWNS.
      expect(swept).toBe(1)
      // AND THE REST OF THE ARM RAN, so a green `swept` is not a green test over a switch that fell
      // through somewhere else: the session is retired, the pane is home, and the reason is on the
      // surface built to carry it.
      expect(reg.has(SCRATCH)).toBe(false)
      expect(slot.binding.session).toBe(SOURCE)
      expect(links.forkFailed).not.toBeNull()
      for (const d of failReply.diagnostics) expect(links.forkFailed ?? '').toContain(d.message)
      expect(drawn).toBeGreaterThan(0)
    } finally {
      view.destroy()
      pool.unbind(SOURCE)
      pool.unbind(SCRATCH)
      host.remove()
    }
  })
})

/**
 * **THE DOM HALF OF §4.1A'S CLAIM, DRIVEN THROUGH THE REAL APP.** Every test above builds
 * `LambdaScratchpad` over a hand-built `SessionRegistry`, with no `LambdaPane` anywhere in reach —
 * right for the mechanism (`scratch()`/`retire()`/the singleton), wrong for "the CONTROL forks a
 * frame the OLD gate would have hidden", which is a fact about `LambdaPane.#refreshDetach` and the
 * DOM it drives, not about the session underneath it. This block mounts the real app, the same
 * `SHELL` `scratch-app.test.ts` uses and for the same "one page per test FILE" reason its own comment
 * states.
 *
 * `WHILE4` IS THE FIXTURE, AND IT WAS MEASURED TO TRUNCATE BEFORE BEING TRUSTED TO — the brief's own
 * instruction, followed literally: a probe run against this exact string during this task's
 * development (`compile(WHILE4, 'unary')`, then `lambdaState(FRAME_BYTES)` and
 * `lambdaState(LAMBDA_BYTE_BUDGET)` at each step) found `cut === 'Bytes'` at the 512-byte budget on
 * EVERY one of steps 0 through 9, while the 65,536-byte budget stayed `cut === null` throughout
 * (777-2,095 bytes printed, nowhere near that budget) — truncated at the frame's own print, whole at
 * the readout's, exactly the pairing this test needs. `frame-cost.test.ts` uses the same source for
 * an unrelated reason (span cost, not truncation) and never checks `cut`; this file's own `BIG` was
 * picked for its TM leg's size and was never measured for λ truncation at all; `SAMPLE`-sized
 * programs (`scratch-app.test.ts`) never truncate at either budget. None of the existing fixtures
 * would have proven anything here.
 */
describe('the fork control forks a truncated frame, through the app', () => {
  const WHILE4 = 'let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc'

  const SHELL = `
    <header class="bar"><span class="wordmark">redextape</span>
      <button type="button" id="appearance"></button>
      <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
      <label class="encoding">encoding <select id="encoding"></select></label>
    </header>
    <main></main>
    <div id="editor"></div>
    <div id="link-status" class="link-status"></div>
    <section id="results" class="pane results"></section>`

  let view: EditorView

  const resultsText = () => document.querySelector('#results')?.textContent ?? ''
  const stepText = () => document.querySelector('[data-leaf="lambda-0"] .step')?.textContent ?? ''

  const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' && resultsText() !== ''

  const clickLambda = (label: string) => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')].find(
      (x) => x.textContent === label,
    )
    if (b === undefined) throw new Error(`no \`${label}\` button in the λ pane`)
    b.click()
  }

  // ONE MOUNT FOR THE FILE — `scratch-app.test.ts`'s own reason: ES module imports are cached, so
  // `main()` runs once per page. The three `describe` blocks above never import `../../src/main` at
  // all, so this is the first and only mount in this file; nothing above shares a page with it.
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(idle, 'the first compile')
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: WHILE4 } })
    await until(idle, 'the truncating program to compile')
  }, 60_000)

  it('forks a TRUNCATED frame and seeds the editor with the whole term', async () => {
    // `↺` FIRST: a settled pane sits at the frontier, not step 0 (`scratch-app.test.ts`'s own note).
    // Two steps forward from there is not the free `step === 0` case §4.1a calls out — the worker has
    // to do the replay, not skip it.
    clickLambda('↺')
    clickLambda('▶')
    clickLambda('▶')
    expect(stepText()).toContain('step 2 of')

    // THE CAPABILITY THIS SLICE EXISTS FOR. Before T8's fix to `#refreshDetach`, a frame this
    // truncated hid the fork control outright — `lambda-pane.ts`'s own module doc calls this shape
    // "most non-trivial terms".
    expect(document.querySelector('[data-leaf="lambda-0"] .truncated')).not.toBeNull()
    const fork = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .controls .detach')
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

    // AND THE SOURCE SESSION IS STILL THE ONE THE PANE LEFT — the scratch is a second session, not a
    // mutation of the first (§4.3, and this file's first `describe` proves the mechanism directly).
    // `[detached]` is the DOM's own witness that a second session now exists at all.
    expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('[detached]')
  })
})
