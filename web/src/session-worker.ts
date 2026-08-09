/**
 * The worker that owns the `Session`.
 *
 * THE HANDLE CANNOT LEAVE THIS THREAD. `Session` is an opaque wasm-bindgen object with no serialized
 * form, so the worker owns it and answers questions about it rather than handing it over. That is
 * also why `classifySource` and `analyze` are NOT here: they are free functions, they are what the
 * editor calls on every keystroke, and a round trip per keystroke is exactly the lag this split
 * exists to avoid.
 *
 * THE SESSION NOW OUTLIVES ITS MESSAGE, which is the one structural change in this file. PR 3c freed
 * the handle at the end of every request; `[continue]` needs it alive to resume. Exactly one is live
 * at a time and it is freed BEFORE the next compile, which makes the transient two-session window PR
 * 3c's review flagged strictly zero rather than merely bounded.
 */
import init, { compile, tapeNames } from '../../pkg/redextape_wasm.js'
import type { LinkIndexWire } from './link'
import type { LambdaLeg, Leg, RecordEnd, RunReply, RunRequest, TmLeg } from './protocol'
import {
  EXTEND_CELLS,
  EXTEND_STEPS,
  FRAME_BYTES,
  HISTORY_BYTES,
  LAMBDA_BYTE_BUDGET,
  lambdaFrameBytes,
  RECORD_CHUNK,
  TM_RADIUS,
  tmFrameBytes,
} from './protocol'
import type {
  Decoded,
  Diagnostic,
  LambdaState,
  LambdaStatus,
  RunStatus,
  Span,
  TmProgram,
  TmState,
  TmStatus,
} from './types'

/**
 * The wasm-bindgen `Session`, described structurally — `pkg`'s generated declarations type every
 * method's return as `any`, so the shapes have to be asserted somewhere, and once is here.
 */
type Session = {
  lambdaStatus(): LambdaStatus
  lambdaState(byteBudget: number): LambdaState
  lambdaValue(): Decoded
  stepLambda(): boolean
  raiseLambdaCap(extra: number): void
  tmStatus(): TmStatus
  tmProgram(): TmProgram
  tmState(radius: number): TmState
  stepTm(): boolean
  raiseTmCap(extraSteps: number, extraCells: number): void
  tmValue(): Decoded
  sourceSpan(node: number): Span | null
  linkIndex(byteBudget: number): LinkIndexWire
  free(): void
}

type CompileResult = { diagnostics: Diagnostic[]; session: Session | null }

/**
 * Exactly what this worker uses of its global scope.
 *
 * DECLARED RATHER THAN PULLED FROM THE `WebWorker` LIB, because that lib and `DOM` declare `self` and
 * `postMessage` incompatibly and `skipLibCheck` does not reconcile two libs.
 */
type WorkerScope = {
  addEventListener(type: 'message', handler: (e: MessageEvent<RunRequest>) => void): void
  postMessage(message: RunReply, transfer?: Transferable[]): void
}
const ctx = self as unknown as WorkerScope

const ready = init()

/** The newest generation this worker has been asked for. */
let latest = 0

/**
 * The ONE live session, with the generation that owns it.
 *
 * EVERY SESSION TOUCH GOES THROUGH THIS BINDING, never through a captured reference. A record loop
 * suspended at a yield can resume after its session has been freed; reading `live` each time means
 * it sees `null` (or a newer generation) and returns, instead of calling into a dangling handle and
 * raising "null pointer passed to rust" from a place no caller can see.
 */
let live: { gen: number; session: Session } | null = null

/**
 * Bytes recorded per leg, and the allowance each is spending against. `[continue]` on a `budget`
 * stop buys another `HISTORY_BYTES`; the main thread's ring evicts, so recording further is bounded
 * per click rather than unbounded.
 */
const recorded: Record<Leg, number> = { lambda: 0, tm: 0 }
const allowance: Record<Leg, number> = { lambda: HISTORY_BYTES, tm: HISTORY_BYTES }

/**
 * One record loop per leg at a time. `latest` serializes `run` requests, but two `extend`s carry the
 * SAME generation, so nothing in `live.gen` can distinguish them — two loops would step one cursor
 * and interleave their frames. The same race reaches `onRun`: an `extend` can land while `onRun`'s
 * `await recordTm` is still in flight, once the λ leg has already posted its `budget` stop.
 */
const recording: Record<Leg, boolean> = { lambda: false, tm: false }

function dropLive(): void {
  const held = live
  // NULLED BEFORE FREED, in that order. A suspended loop that wakes between the two must see `null`
  // rather than a freed handle.
  live = null
  held?.session.free()
}

/**
 * One macrotask, via `MessageChannel` rather than `setTimeout`.
 *
 * `queueMicrotask` would NOT do: a microtask runs before the message queue is drained, so a newer
 * request would never be seen and the abandon check could not fire — this needs a real macrotask.
 *
 * `setTimeout(r, 0)` IS A MACROTASK, BUT A CLAMPED ONE, and that is not a hypothetical cost here. HTML's
 * timer-nesting rule floors any `setTimeout` past nesting depth 5 to ~4 ms — in workers too — and a
 * yield happens every `RECORD_CHUNK` (256) steps, so a recording of any real length spends almost all
 * of it past depth 5. This branch's own `map`-fixture browser test reaches the TM history budget at
 * 75,025 frames, `75,025 / 256 ≈ 293` yields — MEASURED, not estimated from that count alone:
 * `app.test.ts`'s "records further once the TM leg spends its history budget" (real Chromium, four
 * runs each) averaged **~2,814 ms with `setTimeout`, ~2,097 ms with `MessageChannel`** below — about
 * 25% faster, materially less than a naive "4 ms × 293 yields ≈ 1.17 s" estimate would suggest, because
 * most of that budget is real step/render work interleaved with the clamped yields, not idle time
 * alone. `MessageChannel`'s `postMessage` is a macrotask with no such floor — same abandon-check
 * semantics (the message queue still has to drain for it to fire), without paying HTML's timer tax.
 */
const yieldToEventLoop = (): Promise<void> =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => resolve()
    channel.port2.postMessage(undefined)
  })

/**
 * A finished cursor's `RunStatus` as a `RecordEnd`.
 *
 * `Running` maps to `ended` and cannot occur: this is only called once `stepLambda`/`stepTm` has
 * answered `false`, which means the cursor is finished. Mapped rather than thrown so a future
 * `RunStatus` variant degrades to a legible label instead of aborting the worker.
 */
function endOf(run: RunStatus | null): RecordEnd {
  switch (run) {
    case 'Capped':
      return 'capped'
    case 'DepthRefused':
      return 'depth-refused'
    default:
      return 'ended'
  }
}

/**
 * Step-and-record the λ leg until it finishes, its allowance runs out, or a newer request lands.
 *
 * WRITTEN TWICE RATHER THAN GENERICALLY, and that is a judgement worth recording because it looks
 * like duplication. A generic version needs six callbacks (`available`, `initial`, `step`, `render`,
 * `size`, `status`) plus a `LambdaState | TmState` union that every caller then casts back out of —
 * more machinery than the twenty lines it removes, and it hides the one thing worth seeing: the two
 * loops have the same SHAPE and different MEANINGS. The TM run finished during `compile`, so
 * recording it replays a run whose answer is already known and exhausting its allowance costs
 * history alone. On the λ leg it costs the answer.
 * Returns whether this call actually recorded (or determined there was nothing to record) rather
 * than being turned away at the door. `false` means a loop already in flight for this generation
 * owns the leg and will post its own frames and its own `result` — the caller must not post one
 * of its own on top of that.
 */
async function recordLambda(gen: number, emitInitial: boolean): Promise<boolean> {
  // Deliberate silence: the caller's generation is already stale, so there is nothing to record for
  // it — not the accidental kind this file shipped once before.
  if (live?.gen !== gen) return false
  if (!live.session.lambdaStatus().available) return false
  // Deliberate silence: a rejected re-entry. Two callers can reach this function for the same leg
  // (`onRun` then a concurrent `extend`, or two `extend`s) — the loop already in flight will post the
  // frames, so this one has nothing to do.
  if (recording.lambda) return false
  recording.lambda = true
  try {
    let batch: LambdaState[] = []
    if (emitInitial) {
      const first = live.session.lambdaState(FRAME_BYTES)
      batch.push(first)
      recorded.lambda += lambdaFrameBytes(first)
    }

    for (;;) {
      // Deliberate silence: superseded mid-loop. The caller who wanted these frames is gone.
      if (live?.gen !== gen) return true
      const s = live.session
      let done: RecordEnd | null = null
      let n = 0
      while (n < RECORD_CHUNK) {
        if (recorded.lambda >= allowance.lambda) {
          done = 'budget'
          break
        }
        if (!s.stepLambda()) {
          done = endOf(s.lambdaStatus().run)
          break
        }
        const f = s.lambdaState(FRAME_BYTES)
        batch.push(f)
        recorded.lambda += lambdaFrameBytes(f)
        n += 1
      }
      ctx.postMessage({ kind: 'lambda-frames', gen, frames: batch, done })
      batch = []
      if (done !== null) return true
      await yieldToEventLoop()
    }
  } finally {
    // ONLY THE CALL THAT STILL OWNS THIS GENERATION MAY CLEAR THE FLAG IT SET. A stale loop that
    // resumes here after being superseded returned via the mid-loop `live?.gen !== gen` check above,
    // with `live.gen` already pointing at a newer generation — clearing unconditionally would wipe
    // the flag that generation's `onRun` reset (fix 1) and whose own loop has since set for itself,
    // reopening the exact race `recording` exists to close. Checking `live?.gen === gen` here is
    // exactly that stale-loop check, so a superseded loop skips the clear and touches nothing.
    if (live?.gen === gen) recording.lambda = false
  }
}

/** See `recordLambda`'s doc comment — same contract, mirrored for the TM leg. */
async function recordTm(gen: number, emitInitial: boolean): Promise<boolean> {
  // Deliberate silence: the caller's generation is already stale, so there is nothing to record for
  // it — not the accidental kind this file shipped once before.
  if (live?.gen !== gen) return false
  if (!live.session.tmStatus().available) return false
  // Deliberate silence: a rejected re-entry. Two callers can reach this function for the same leg
  // (`onRun` then a concurrent `extend`, or two `extend`s) — the loop already in flight will post the
  // frames, so this one has nothing to do.
  if (recording.tm) return false
  recording.tm = true
  try {
    let batch: TmState[] = []
    if (emitInitial) {
      const first = live.session.tmState(TM_RADIUS)
      batch.push(first)
      recorded.tm += tmFrameBytes(first)
    }

    for (;;) {
      // Deliberate silence: superseded mid-loop. The caller who wanted these frames is gone.
      if (live?.gen !== gen) return true
      const s = live.session
      let done: RecordEnd | null = null
      let n = 0
      while (n < RECORD_CHUNK) {
        if (recorded.tm >= allowance.tm) {
          done = 'budget'
          break
        }
        if (!s.stepTm()) {
          done = endOf(s.tmStatus().run)
          break
        }
        const f = s.tmState(TM_RADIUS)
        batch.push(f)
        recorded.tm += tmFrameBytes(f)
        n += 1
      }
      ctx.postMessage({ kind: 'tm-frames', gen, frames: batch, done })
      batch = []
      if (done !== null) return true
      await yieldToEventLoop()
    }
  } finally {
    // Same ownership check as `recordLambda`'s — see that comment.
    if (live?.gen === gen) recording.tm = false
  }
}

/**
 * A declined λ leg's refusal, named as a source range — `null` for an available leg or one whose
 * refusal names no node. `sourceSpan` IS RESOLVED HERE because the handle cannot leave this thread; a
 * refusal that names a node the main thread cannot look up would highlight nothing.
 *
 * ONE EXPRESSION, not two written differently in two call sites. This used to be inlined once in
 * `onRun`'s `compiled` message and again, with a different but equivalent condition, in `lambdaLeg`
 * below for the `result` message — the same fact computed two ways is exactly the shape a future edit
 * changes correctly in one place and not the other.
 */
function declinedSourceSpan(session: Session, status: LambdaStatus): Span | null {
  return status.available || status.node === null ? null : session.sourceSpan(status.node)
}

function lambdaLeg(session: Session): LambdaLeg {
  const status = session.lambdaStatus()
  if (!status.available) {
    return { status, state: null, value: null, declinedSpan: declinedSourceSpan(session, status) }
  }
  return {
    status,
    state: session.lambdaState(LAMBDA_BYTE_BUDGET),
    value: session.lambdaValue(),
    declinedSpan: null,
  }
}

function tmLeg(session: Session): TmLeg {
  const status = session.tmStatus()
  if (!status.available) return { status, value: null }
  return { status, value: session.tmValue() }
}

async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
  await ready
  // FREED BEFORE THE NEXT COMPILE, not after. Two `Session` handles are never simultaneously live.
  dropLive()
  recorded.lambda = 0
  recorded.tm = 0
  allowance.lambda = HISTORY_BYTES
  allowance.tm = HISTORY_BYTES
  // GENERATION-SCOPED BY RESET, not by the flag's own type. `recording` exists to stop two loops
  // stepping ONE cursor; a loop belonging to a superseded generation is not competing for this
  // session and must not hold a flag against it. Safe here because `onRun`'s synchronous prefix can
  // only run once any prior loop has yielded, so no loop is mid-step when this executes — and a
  // stale loop that resumes afterwards returns at its own `live?.gen !== gen` check without
  // touching the flag it no longer owns.
  recording.lambda = false
  recording.tm = false

  // `compile` RUNS THE WHOLE TM LEG and is one uninterruptible call — measured at 0.21-75.44 ms
  // across the demo suite (`frame_cost_probe` section A). Off the main thread that can only delay the
  // next result; it can never block input, highlighting or linting.
  const { diagnostics, session } = compile(req.src, req.encoding) as CompileResult
  if (session === null) {
    ctx.postMessage({ kind: 'no-session', gen: req.gen, diagnostics })
    return
  }
  // Deliberate silence: a newer `run` landed while `compile` (uninterruptible) was in flight. This
  // session was never posted anywhere, so freeing it and returning is the whole cleanup.
  if (latest !== req.gen) {
    session.free()
    return
  }
  live = { gen: req.gen, session }

  const lambda = session.lambdaStatus()
  const tm = session.tmStatus()
  const index = session.linkIndex(LAMBDA_BYTE_BUDGET)
  ctx.postMessage(
    {
      kind: 'compiled',
      gen: req.gen,
      lambda,
      tm,
      declinedSpan: declinedSourceSpan(session, lambda),
      // GUARDED: `tmProgram` throws `TmAbsent` for a declined leg, and a thrown error inside this
      // async handler rejects it with nothing catching — no reply, and a caller that waits forever.
      // That is exactly the shape of the defect PR 3c's browser tier caught in `drive`.
      tmProgram: tm.available ? session.tmProgram() : null,
      tapeNames: tapeNames() as string[],
      linkIndex: index,
    },
    // TRANSFERRED, NOT CLONED. `prog200`'s index is ~689 KB and the app rebuilds one on every 300 ms
    // typing pause; a structured clone would copy all of it. The buffers are dead on this side the
    // moment they are posted, which is correct — `index` is built fresh per compile and never re-read
    // here. `lambdaText` is a string and is cloned as usual; strings are not transferable.
    [
      index.lambdaSpanStart.buffer,
      index.lambdaSpanEnd.buffer,
      index.lambdaSpanClass.buffer,
      index.lambdaNodeStart.buffer,
      index.lambdaNodeEnd.buffer,
      index.lambdaNodeId.buffer,
      index.sourceNodeStart.buffer,
      index.sourceNodeEnd.buffer,
      index.sourceNodeId.buffer,
      index.tmOwner.buffer,
    ],
  )

  await recordLambda(req.gen, true)
  await recordTm(req.gen, true)

  // Deliberate silence: superseded while recording ran. The generation that wanted this result is gone.
  if (live?.gen !== req.gen) return
  ctx.postMessage({ kind: 'result', gen: req.gen, lambda: lambdaLeg(live.session), tm: tmLeg(live.session) })
}

async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<void> {
  // Deliberate silence: the generation being extended is not the live one anymore (superseded by a
  // later `run`, or there was never a session for it).
  if (live?.gen !== req.gen) return
  const s = live.session
  // ONE MORE ALLOWANCE FROM WHERE RECORDING STOPPED, not stacked on the old allowance. On a `budget`
  // stop `recorded[leg] >= allowance[leg]`, but not necessarily equal to it: the check runs BEFORE
  // that iteration's frame is added, so `recorded` can overshoot the old `allowance` by up to one
  // frame's bytes by the time the loop actually stops. Setting `allowance[leg]` to `recorded[leg] +
  // HISTORY_BYTES` is therefore not exactly the old `+= HISTORY_BYTES` — it grants HISTORY_BYTES from
  // that (slightly later) point instead. Harmless, and arguably better: it guarantees at least one
  // more step happens after `[continue]` rather than possibly none. On a `capped` stop
  // `recorded[leg] < allowance[leg]`, and the old code let the unspent remainder stack — a k-th
  // extend would permit (k+1)×HISTORY_BYTES instead of one more. Setting the allowance itself avoids
  // that stacking in both cases.
  allowance[req.leg] = recorded[req.leg] + HISTORY_BYTES

  let ran: boolean
  if (req.leg === 'lambda') {
    // Raising a cap that was not hit is harmless — `raise_cap` is additive — but calling it on a
    // DEPTH-refused cursor is pointless by contract, and this branch is never reached for one:
    // `controls.ts` ships no continue affordance for `depth-refused`, which is why that state has no
    // case here rather than a no-op one.
    if (s.lambdaStatus().run === 'Capped') s.raiseLambdaCap(EXTEND_STEPS)
    ran = await recordLambda(req.gen, false)
  } else {
    if (s.tmStatus().run === 'Capped') s.raiseTmCap(EXTEND_STEPS, EXTEND_CELLS)
    ran = await recordTm(req.gen, false)
  }
  // A SUPPRESSED CALL MUST NOT POST A RESULT. `ran === false` means a loop already in flight for this
  // leg owns it — that loop will post its own frames and its own `result` when it finishes. Posting
  // one here too would answer with whatever partial state that other loop had reached at this
  // instant, then let the real loop post a second, later `result` for the same generation (the two
  // rapid `extend`s, e.g. a double-click before the UI disables the affordance, this exists to guard).
  if (!ran) return

  // Deliberate silence: superseded while recording ran, same as `onRun`'s post-record check.
  if (live?.gen !== req.gen) return
  ctx.postMessage({ kind: 'result', gen: req.gen, lambda: lambdaLeg(live.session), tm: tmLeg(live.session) })
}

ctx.addEventListener('message', async (e: MessageEvent<RunRequest>) => {
  const req = e.data
  try {
    if (req.kind === 'run') {
      latest = req.gen
      await onRun(req)
    } else if (req.kind === 'extend') {
      await onExtend(req)
    }
  } catch (err) {
    // A THROWN SESSION CALL MUST NOT BECOME SILENCE. Every wasm entry point is fallible at the
    // binding layer (`lib.rs`'s `to_value` can fail even where `session.rs` cannot), so this is a
    // structural guarantee rather than a guard on the few call sites currently known to throw. The
    // session may have thrown mid-record, so it must not stay live.
    dropLive()
    ctx.postMessage({ kind: 'worker-error', gen: req.gen, message: err instanceof Error ? err.message : String(err) })
  }
})
