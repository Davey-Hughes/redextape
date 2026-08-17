import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { createEditorCustody } from '../../src/editor-custody'
import { History } from '../../src/history'
import { LambdaPane } from '../../src/lambda-pane'
import { linkStatus } from '../../src/link-status'
import { createLinkWiring } from '../../src/link-wiring'
import { PaneCollection } from '../../src/panes'
import type { RunReply } from '../../src/protocol'
import { HISTORY_BYTES, lambdaFrameBytes, tmFrameBytes } from '../../src/protocol'
import { createReplies } from '../../src/replies'
import { ScratchBuffers } from '../../src/scratch'
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
/**
 * The ids `ScratchBuffers.fork` mints for the first and second buffers of a fresh collection — where
 * this file used to hold one `'lambda-scratch'` constant, because 5d-i's singleton meant every fork
 * produced that one name.
 *
 * WRITTEN DOWN RATHER THAN CAPTURED FROM `fork`'s RETURN because both are also needed in `finally`,
 * outside the scope each `fork` call sits in. `tests/node/scratch.test.ts` is where the minting rule
 * itself is asserted — against the returned id, which is the only place the app ever reads a name
 * from.
 */
const SCRATCH: SessionId = 'scratch-1'
const SCRATCH_2: SessionId = 'scratch-2'

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
  return { id: SOURCE, label: 'source', detached: false, client, legs, tmProgram: null }
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
      pad.fork(slot, '(λx. x) (λy. y)', 0)

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

      pad.fork(new PaneSlot('lambda', SOURCE), '(λx. x) (λy. y)', 0)
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
      const pad = new ScratchBuffers({
        registry: reg,
        pool,
        historyBytes: HISTORY_BYTES,
        onReply: (_session, r) => seen.push(r),
      })

      pad.fork(slot, 'λx. x', 0)
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
 * **THE `no-session` REPORT — CRITICAL finding, plan 5d-iii's ninth task.** `fork` rebinds a pane to a
 * new λ buffer SYNCHRONOUSLY, before the worker has answered (`scratch.ts`'s own doc: "supersede
 * then post"), so a build that fails strands the pane there: `scratch-compiled` never
 * fires, so `LambdaPane.setEditor` is never called and `setDiagnostics` is a silent no-op against
 * `#editor === null`; the step readout is stuck on the `'building…'` placeholder `fork` seeds; and
 * `#refreshDetach`'s `!this.#detached` gate hides the only control that could recover it, because the
 * session the pane is stuck on IS the one that never works. `ScratchBuffers.noSessionReply` is what
 * reports it, and this is the test that would have failed before it existed.
 *
 * **THIS PARAGRAPH ENDED ON A REMEDY THAT 5d-ii-c DECISION 2 WITHDREW.** It read: *"Design §4.1a
 * promises the opposite: 'the pane keeps offering ✎ — the user can scrub to a smaller step and fork
 * there'. `ScratchBuffers.noSessionReply` is the fix"* — and the fix was the RETIRE, which put the pane
 * back on a session it was not stuck on and so let `#refreshDetach` offer the control again. Nothing
 * ends a buffer implicitly now (design §4.3), so the stranding above is the state a failed fork LEAVES,
 * and the diagnostic on `#link-status` is the whole of what this method delivers. §4.4 moved the way out
 * to the header list, which can reach a wedged buffer whether or not a pane still shows it — and the
 * first test below now drives that way out at this layer, one assertion after the one that pins the
 * stranding. The word "remedy" left this `describe`'s own name with it, and stays gone: this method
 * reports, and something the user aims at is what repairs.
 *
 * **AN UNPARSEABLE SEED, DELIBERATELY, NOT A GENUINELY OVER-BUDGET TERM.** Both reach the identical
 * `scratch === null` branch of `session-worker.ts`'s `onLambdaScratch` (`ForkedAt`'s doc in
 * `session.rs`: "`scratch` and `text` are null together"), but a real term over `LAMBDA_BYTE_BUDGET`
 * (65,536 bytes) needs a genuinely large fixture to construct and would make this test slow; garbage
 * text is one string literal and fails in the same place for a different reason `lambda_scratch_at`
 * already tests directly in Rust (`lambda_scratch_at_refuses_unparseable_text`).
 *
 * **DRIVEN AT THE `ScratchBuffers`/`PaneSlot`/`LambdaPane` LAYER, NOT THROUGH `main.ts`'s `ready`
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
 * `ScratchBuffers` directly over real `session-worker.ts` threads for the identical reason. Nothing
 * here re-implements `noSessionReply`; it is the exact method `main.ts`'s `onScratchReply` calls.
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
      // **FRAMES LAND IN THE LEG OF THE BUFFER THAT SENT THEM, WHICH THIS HANDLER USED TO NAME AS A
      // CONSTANT.** It read `reg.legOf({ session: SCRATCH, … })` — correct under the singleton, where
      // the id a retire freed was re-registered by the next fork, and correct for as long as this test
      // only ever had one buffer. It has two now: the phantom is retired half way through, and the
      // live-edit buffer below is a SECOND session whose frames arrive after `SCRATCH` has left the
      // registry — so the constant made `legOf` throw on the reply that proves the second buffer works
      // (`bound to a session that is not in the registry: scratch-1`). Routing by the reply's own
      // session is what `ScratchBuffersConfig.onReply` curries the id in for, and it is the same
      // resolution `main.ts`'s `onScratchReply` performs.
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
        play: () => undefined,
        restart: () => undefined,
        extend: () => undefined,
        rebind: (binding) => slot.rebind(binding.session),
        detach: () => undefined,
      })
      slot.render(reg, pane, slot.resolve(reg))
      expect(host.querySelector('.controls .detach')).not.toBeNull()

      // THE PHANTOM BUILD. `detach` has already rebound the slot by the time this call returns —
      // the CRITICAL finding's own bug, reproduced here before it is fixed by what comes next.
      pad.fork(slot, 'not a valid lambda term (((', 0)
      slot.render(reg, pane, slot.resolve(reg))
      expect(slot.binding.session).toBe(SCRATCH)

      await until(() => seen.some((r) => r.kind === 'no-session'), 'the failed build to answer')
      const failReply = seen.find((r) => r.kind === 'no-session')
      if (failReply === undefined || failReply.kind !== 'no-session') throw new Error('expected a no-session reply')
      expect(failReply.diagnostics.length).toBeGreaterThan(0)

      // CALLED EXACTLY AS `main.ts`'s `onScratchReply` CALLS IT — including the session, which that
      // handler takes as its own first parameter and which this call used to omit. The `home` and
      // `slots` arguments it also used to take went with the retire (5d-ii-c decision 2).
      const failed = pad.noSessionReply(SCRATCH, failReply.diagnostics)
      slot.render(reg, pane, slot.resolve(reg))

      // **THE BUFFER SURVIVES ITS OWN FAILED BUILD, AND THESE THREE LINES USED TO ASSERT THE
      // OPPOSITE** — `slot.binding.session` back on `SOURCE`, `reg.has(SCRATCH)` false, and a comment
      // reading "NOT LEFT DETACHED". Design §4.3's table moved poison from *ended it* to *survives*.
      expect(failed).not.toBeNull()
      expect(slot.binding.session).toBe(SCRATCH)
      expect(reg.has(SCRATCH)).toBe(true)
      // **AND THE FORK CONTROL IS NOT BACK, WHICH IS WHAT THAT COSTS THE USER.** This line read
      // `expect(...).not.toBeNull()` under the heading "THE FORK CONTROL IS BACK IN THE DOM": the retire
      // rebound the pane, `SessionEntry.detached` read `false` again, and `#refreshDetach` re-offered ✎
      // — 5d-i design §4.1a's promised remedy. The pane is still on the buffer that will never build, so
      // the gate hides it, and design §4.4's header list is what has to reach the buffer instead.
      expect(host.querySelector('.controls .detach')).toBeNull()

      // **AND THAT IS NO LONGER A DEAD END, WHICH IS THE REVISION THE COMMENT ABOVE ASKED FOR.** It
      // ended "Asserted rather than merely described, so the day the list lands this line has to be
      // revisited", because the state it pinned — pane stuck on `building…`, ✎ withheld, no route back —
      // was the app's final answer while nothing in `src/` retired anything. §4.2's header list is wired
      // now (`main.ts`), so the way out is one gesture: retire the row, and the rebind that used to
      // happen behind the user's back on a failed fork happens because they asked for it. **DRIVEN AS
      // THE CALL THE LIST'S HANDLER MAKES**, at the layer this whole `describe` drives — `retire`, then
      // the render that any `draw()` performs — so what is asserted is the chrome the user gets back and
      // not a fact about the registry.
      expect(pad.retire(SCRATCH, SOURCE, [slot])).toBe(true)
      slot.render(reg, pane, slot.resolve(reg))
      expect(slot.binding.session).toBe(SOURCE)
      expect(host.querySelector('.controls .detach')).not.toBeNull()

      // THE DIAGNOSTIC IS VISIBLE — composed exactly as `replies.ts`'s `onScratchReply` composes the
      // `forkFailed` field it hands `link-wiring.ts`, `fork failed — ` prefix included (5d-ii-d review
      // round 2, Finding 3: that prefix is this call's own text now, not something `linkStatus` adds —
      // see `link-status.ts`'s `forkFailed` field doc). This is the half that did not change: the
      // surface was chosen because no editor is ever mounted on this path, not because of the rebind
      // that has now gone away.
      const message = `fork failed — ${(failed ?? []).map((d) => d.message).join(' · ')}`
      const line = linkStatus({ state: 'none', forkFailed: message })
      expect(line).toContain('fork failed')
      for (const d of failReply.diagnostics) expect(line).toContain(d.message)

      // THE LIVE-EDIT CASE, FOR CONTRAST, ON THE SAME `ScratchBuffers` OBJECT. Design §4.4: "an edit
      // that does not parse leaves the frames region showing the last good run" — and the contrast is
      // now about WHERE THE DIAGNOSTICS GO rather than about what survives, since both buffers do. A
      // `null` here routes them to this buffer's own editor gutter, which is the regression
      // `scratch-edit.test.ts`'s STAGE 3 already pins through the app; this asserts the same rule at
      // the method `main.ts` actually calls.
      //
      // A SECOND NAME, BECAUSE THIS IS A SECOND BUFFER. Under the singleton the fork above and this
      // one produced the same id; 5d-ii-c decision 1 mints per fork, so this line's buffer is
      // `scratch 2` while `scratch 1` is still live above rather than spent.
      expect(reg.has(SCRATCH_2)).toBe(false)
      pad.fork(slot, '(λx. x) (λy. y)', 0)
      await until(() => seen.some((r) => r.kind === 'lambda-frames' && r.done !== null), "the buffer's frames")
      expect(reg.has(SCRATCH_2)).toBe(true)
      expect(reg.legOf({ session: SCRATCH_2, leg: 'lambda' }).hist.current).not.toBeUndefined()

      const stillLive = pad.noSessionReply(SCRATCH_2, [
        { span: { start: 0, end: 0 }, severity: 'Error', message: 'a fabricated parse failure' },
      ])
      expect(stillLive).toBeNull()
      expect(reg.has(SCRATCH_2)).toBe(true)
      expect(slot.binding.session).toBe(SCRATCH_2)

      // **AND A RETIRED BUFFER'S NAME NO LONGER REACHES ANYTHING — the half the unkeyed version could
      // not express at all.** A `no-session` addressed to `SCRATCH` arrives after that buffer ended, and
      // the answer is `null` with the live buffer untouched. Under the newest-buffer reading this call
      // would have been answered on behalf of `SCRATCH_2` — a different buffer, still healthy.
      //
      // **THE RETIRE IS EXPLICIT HERE, WHERE THIS ARM USED TO PERFORM IT.** The phantom died half way
      // up this test until 5d-ii-c decision 2, so reaching a spent name needed nothing but the failed
      // build. It now takes the one call that ends a buffer — which is also the gesture design §4.4
      // gives the user for a wedged one, and it is made ABOVE, where reclaiming the wedged pane is what
      // it is for. **THE CALL HERE IS THEREFORE A SECOND ONE ON A SPENT NAME**, which is `retire`'s own
      // idempotence and exactly the state the paragraph above needs: a name held across the retire that
      // spent it. `false` rather than a second termination of a thread that is already gone.
      //
      // THE MEMBERSHIP CHECK IS THE PRECONDITION AND IS READ FIRST, WHICH IS A REORDERING RATHER THAN AN
      // ADDITION. It sat under the `retire` below and read as that call's consequence — which it stopped
      // being the moment the reclamation above became the retire that spends this name. What it states
      // is what makes the two calls after it interesting at all: the name in hand no longer resolves.
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
   * **THE PRODUCTION ARM, DRIVEN AGAINST A REAL FAILED FORK — RE-POINTED BECAUSE 5d-ii-c DECISION 2
   * DELETED WHAT IT USED TO ASSERT.**
   *
   * **WHAT THIS TEST WAS FOR.** A Minor finding of the third review round: four doc comments asserted
   * that BOTH retire sites call `reconcileEditors`, so "a custody entry cannot outlive its session's
   * incarnation" is a property of the retire rather than of which caller happened to trigger it — while
   * `pnpm test:coverage` reported the whole phantom-fork arm of `onScratchReply`, `reconcileEditors()`
   * included, as never executed. **Deleting that line could not fail a test**, and this test was written
   * so that it could. Its name was "sweeps editors on the phantom no-session, through `createReplies`
   * rather than around it", and `swept` was its assertion.
   *
   * **THE RETIRE SITE THIS ARM HELD IS GONE, AND THE LINE THIS TEST GUARDED WITH IT.** Decision 2
   * deleted `compile.ts`'s recompile-from-source first and this arm's retire second; a call that ends no
   * session has no editors to sweep, so `reconcileEditors` left `createReplies`'s signature with it (see
   * that factory's own doc).
   *
   * **WHAT THIS CALL CARRIED WAS ITS OWN EXECUTION; THE BRANCH'S GUARD WENT WITH THE RECOMPILE
   * DELETION.** This paragraph read "THE COVERAGE THAT WENT WITH IT IS LOST RATHER THAN MOVED", which
   * invites the reading that the deleted line had been covering `reconcileEditors`' destroy branch. **It
   * never did**: the `reconcileEditors` this test passed to `createReplies` was a STUB, so what `swept`
   * counted was a call at this site and never a destroy anywhere. The destroy branch is guarded by
   * `!sessions.has(session)`, whose only producer is a retire — so what went missing was the PRODUCER,
   * and it went missing when the recompile stopped ending buffers.
   *
   * **BOTH ARE PAID BACK.** `main.ts`'s header-list retire is the producer again, and
   * `tests/browser/editor-custody.test.ts` executes the branch — over the real `createEditorCustody`
   * rather than a stub, which is the distinction this paragraph exists to keep. It covers the two arms
   * beside it as well: the claim drop, and the sweep's own `held.destroy()`, both dark for the same
   * reason and neither with a paragraph of its own until now. `two-lambda-panes.test.ts` carried the same
   * debt from the layout side and records the same discharge.
   *
   * **WHAT IT ASSERTS INSTEAD IS THE FACT THAT REPLACED THAT ONE**, at the same seam and against the
   * same real worker: the production switch, handed a `no-session` for a fork that really failed to
   * build, leaves the buffer registered, pooled and listed, leaves the pane on it, and puts the reason on
   * `#link-status`. That is decision 2's governing rule executed rather than argued, which is what this
   * test was always for.
   *
   * **IT DRIVES `createReplies` RATHER THAN `main()`, AND THAT SEAM DID NOT EXIST WHEN THE `describe`
   * ABOVE EXPLAINED WHY IT COULD NOT.** That test's doc says a test needing both a cheap unparseable
   * seed and the production code path "had nowhere to go through `main.ts` at all", because
   * `onScratchReply` was a closure with no export. Wave 1 moved it into `replies.ts` behind an exported
   * factory, so the production switch is now constructible over the same hand-built registry, pool and
   * pane the tests above use. Everything here but the injected dependencies is the app's own object: the
   * reply comes off a REAL `session-worker.ts` thread that really failed to build, and the survival and
   * the fork-failed report are the production ones. (The count that stood here — "except **two** injected
   * dependencies" — is the kind of arity this slice prefers not to restate: it was already one deletion
   * away from being wrong when it was written, and the claim does not need it.)
   *
   * `links` IS THE REAL `createLinkWiring`, NOT A RECORDER, which is what makes the report assertion a
   * statement about the app: `forkFailed` is read back through the same accessor `drawLink` composes
   * `#link-status` from.
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
        play: () => undefined,
        restart: () => undefined,
        extend: () => undefined,
        rebind: (binding) => slot.rebind(binding.session),
        detach: () => undefined,
        // PRESENT SO THE CLAIM CONTROL IS BUILT AT ALL — `LambdaPane`'s `#claim` is `null` on a pane
        // whose events carry no `showEditor`, so without this the item-11 assertions below would be
        // asserting the absence of a button that was never constructible. The handler itself is never
        // called: what is under test is whether the control is OFFERED.
        showEditor: () => undefined,
      })
      // IN THE COLLECTION, AND THE REASON HAS INVERTED WITHOUT WEAKENING. It read: "BECAUSE THAT IS
      // WHERE THE PRODUCTION ARM LOOKS FOR SLOTS TO REBIND (`panes.all().map((p) => p.slot)`) — a
      // registry entry alone would leave the retire nothing to move, and the rebind assertion below
      // would pass vacuously." The arm no longer asks for slots at all, so "the pane did not move" is
      // now the claim, and it is exactly as vacuous without a pane the arm could have reached. The
      // collection is also what the live-edit branch fans `setDiagnostics` over, so a switch that took
      // the wrong branch would be visible here rather than silent.
      panes.add({ id: 'lambda-0', kind: 'lambda', slot, pane, host })

      let drawn = 0
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
        // `undefined` IS THE HONEST ANSWER HERE: this fork's build never reached `scratch-compiled`, so
        // no editor was ever mounted for it and `editor-custody.ts`'s `editorHomeFor` has nothing to
        // resolve. **THIS COMMENT USED TO SAY "AND THE REASON THIS ARM NEEDS THE SWEEP AT ALL" — that
        // the narrow dependency was a no-op on this path AFTER A RETIRE, so a wider `reconcileEditors`
        // had to be handed over beside it.** This arm performs no retire and takes no `reconcileEditors`
        // parameter; `editor-custody.ts`'s own doc holds the sweep's argument, and its callers are
        // `applyLayout` and `main.ts`'s header-list retire handler — neither of them this file.
        editorHome: () => undefined,
        // A NO-OP FOR `editorHome`'s REASON, ONE FIELD ALONG: the reply this test drives is a
        // `no-session` for a fork whose build never reached `scratch-compiled`, and that is the only arm
        // that persists. Nothing here would fire it, and a fake that counted would be counting zero.
        onBuffersPersist: () => undefined,
      })

      // THE PHANTOM BUILD — an unparseable seed, for the reason the test above records: it reaches the
      // identical `scratch === null` branch of `onLambdaScratch` as a genuinely over-budget term without
      // needing an enormous fixture.
      pad.fork(slot, 'not a valid lambda term (((', 0)
      expect(slot.binding.session).toBe(SCRATCH)
      await until(() => seen.some((r) => r.kind === 'no-session'), 'the failed build to answer')
      const failReply = seen.find((r) => r.kind === 'no-session')
      if (failReply === undefined || failReply.kind !== 'no-session') throw new Error('expected a no-session reply')

      expect(links.forkFailed).toBeNull()
      replies.onScratchReply(SCRATCH, failReply)

      // **THE ASSERTIONS THE DELETED RETIRE OWNS, INVERTED.** These three read `reg.has(SCRATCH)` false,
      // `slot.binding.session` back on `SOURCE`, and `expect(swept).toBe(1)` above them. The buffer is
      // still registered, still on its own thread, still listed, and the pane the fork moved is still
      // showing it — decision 2's governing rule, executed through the production switch.
      expect(reg.has(SCRATCH)).toBe(true)
      expect(pool.has(SCRATCH)).toBe(true)
      expect(pad.list().map((b) => b.id)).toEqual([SCRATCH])
      expect(slot.binding.session).toBe(SCRATCH)
      // AND THE REPORT STILL LANDS, so a green survival is not a green test over a switch that fell
      // through somewhere else: `forkFailed` was `null` a line above the call and carries the worker's
      // own diagnostics after it.
      expect(links.forkFailed).not.toBeNull()
      for (const d of failReply.diagnostics) expect(links.forkFailed ?? '').toContain(d.message)
      expect(drawn).toBeGreaterThan(0)

      // **DEFERRED-A11Y ITEM 11, OVER THE BUILD THAT REALLY FAILED.** Everything above pins what the
      // stranding LEAVES; this pins what the chrome does about it, and it is here rather than only in
      // `editor-custody.test.ts` because that file reconstructs the state (`takeEditor` off a holder)
      // while this one arrives at it the way a user does — a real seed, a real thread, a real
      // `no-session`. `setEditor` was never called on this path, so no editor for `SCRATCH` exists
      // anywhere, and the old gate (`#detached && #editor === null`) was satisfied by exactly that.
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
      expect(host.querySelector('button[aria-label="bring the term editor to this pane"]')).toBeNull()
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
 * `ScratchBuffers` over a hand-built `SessionRegistry`, with no `LambdaPane` anywhere in reach —
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
      <button type="button" id="buffers">buffers</button>
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
    // Each browser test file gets its own in-memory `Storage` now, installed in `tests/browser/setup.ts`
    // before this file's own module body runs — see that file's doc for why clearing a shared key was
    // not enough. Neither key needs clearing here any more.
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
