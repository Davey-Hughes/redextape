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
 *
 * **A WORKER CAN NOW HOLD A `LambdaScratch` INSTEAD OF A `Session`, AND THE ONE-LIVE-SESSION
 * INVARIANT IS UNCHANGED BY IT** (design §4.2, plan T8). What `live` holds gained a second SHAPE; it
 * did not gain a second OCCUPANT. `dropLive` still runs at the top of every request that builds
 * anything, so this thread owns exactly one wasm handle at a time, whichever kind it is — which is
 * the property §4.2 names as the reason decision 3 (one worker per session) is safe, and the property
 * `tests/browser/pool-isolation.test.ts` asserts a shared worker cannot have. A scratchpad is a
 * DIFFERENT WORKER holding a different single handle, not a second handle in this one.
 *
 * PLAN T5 SAID THIS FILE WAS NOT TO BE EDITED AND T8's BRIEF LIFTS THAT, for the reason T7 recorded
 * from the other side: nothing up to T7 could put a second session in the registry because the worker
 * had no message that builds a scratch. That message is `lambda-scratch`; see `onLambdaScratch`.
 *
 * **LOGIC PUT HERE IS INVISIBLE TO THE COVERAGE GATE** — `vite.config.ts` excludes this module from
 * the `include` set for a measured instrumentation reason (v8 coverage does not attach to a dedicated
 * worker's context), so a new untested branch in this file moves none of the four numbers. That is
 * why the fork's POLICY — how many buffers a fork makes, which pane rebinds, when a buffer is
 * retired — lives in `scratch.ts` and only the wasm call it cannot make from the main thread lives
 * here. (It read "singleton" for the first of those until 5d-ii-c decision 1 made a fork mint a buffer
 * per call; what did not change is that this file has no opinion either way.)
 */
import init, { compile, lambdaScratchAt, tapeNames } from '../../pkg/redextape_wasm.js'
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

/**
 * The wasm-bindgen `LambdaScratch`, described structurally for the reason `Session` above is — and it
 * is a STRICT SUBSET of `Session`'s λ half, which is design §3.3's table as a type.
 *
 * THE SIX λ METHODS TRANSPLANT UNCHANGED (§3.3: "nothing but the λ cursor"), so `recordLambda` below
 * needs no second implementation and no cast: it reads `lambdaStatus`, `lambdaState` and `stepLambda`,
 * all three identical in name and signature on both kinds, and a `Session` satisfies this type
 * structurally. Four are named here because four are what this file calls.
 *
 * `lambdaValue`, `sourceSpan` AND `linkIndex` ARE ABSENT AND THAT IS THE POINT. They do not exist on
 * the generated class (`pkg/redextape_wasm.d.ts` — plan T2 pins the absence at compile time on the
 * Rust side), so a handler that reached for one would not compile here either. `lambdaLeg` and
 * `tmLeg` below are exactly the two functions that reach for them, which is why neither is called for
 * a scratch — see `onLambdaScratch` and `onExtend`.
 */
type LambdaScratchHandle = {
  lambdaStatus(): LambdaStatus
  lambdaState(byteBudget: number): LambdaState
  stepLambda(): boolean
  raiseLambdaCap(extra: number): void
  free(): void
}

type CompileResult = { diagnostics: Diagnostic[]; session: Session | null }

/**
 * `lambdaScratchAt(src, step, byteBudget)`'s hand-built object — a handle and plain data, which
 * `lib.rs` assembles with `js_sys::Object` for the reason `compile`'s own doc gives.
 *
 * `scratch` AND `text` ARE NULL TOGETHER OR NEITHER (`session::ForkedAt`) — see `scratch-compiled`'s
 * doc in `protocol.ts`. `scratch: null` covers both text that did not parse and a term too large to
 * print at `LAMBDA_BYTE_BUDGET`; `onLambdaScratch` answers either with `no-session`, the same claim
 * about a different producer.
 */
type ForkedAtResult = { diagnostics: Diagnostic[]; scratch: LambdaScratchHandle | null; text: string | null }

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
 *
 * **A DISCRIMINATED UNION NOW, AND IT IS STILL ONE OCCUPANT.** `kind` says which wasm type this
 * thread is holding; the field is `session` in both arms because both are what a λ record loop steps
 * (§3.3). The invariant §4.2 rests on is about the CARDINALITY of this binding, which is one, not
 * about the type of what is in it — `dropLive` empties it before anything else is built, exactly as
 * before.
 *
 * `kind` RATHER THAN A `tm`-SHAPED DUCK TEST (`'tmStatus' in live.session`). A tag is what makes the
 * checker refuse `live.session.tmStatus()` on the scratch arm at every call site rather than only at
 * the ones somebody remembered to guard, and §3.3's whole method split is a compile-time claim — a
 * runtime probe would restate it as a convention.
 */
type Live =
  | { gen: number; kind: 'session'; session: Session }
  | { gen: number; kind: 'lambda-scratch'; session: LambdaScratchHandle }

let live: Live | null = null

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
  // `free()` ITSELF MUST NOT BE ALLOWED TO THROW PAST THIS FUNCTION. Nulling `live` above already
  // does this function's whole job; a handle that cannot be freed is already unusable to every
  // caller, and the process-lifetime leak of one wasm session is bounded, not the kind of thing
  // worth trading for a throw here.
  //
  // THIS IS DEFENCE-IN-DEPTH, against a mechanism observed (2026-08-09) turning a thrown session
  // call into permanent silence: a `&self` wasm call that aborts mid-flight (a stack overflow, at
  // the time) leaves wasm-bindgen's reentrancy borrow taken, so `free()` on that same session throws
  // "attempted to take ownership of Rust value while it was borrowed" — and this function used to
  // call `free()` unguarded. The message handler's `catch` block (below) calls `dropLive()` first
  // thing on ANY thrown session call, specifically so a poisoned session cannot stay live; an
  // unguarded `free()` there threw a second time, before the `worker-error` postMessage on the next
  // line ever ran, and the client heard nothing — the exact silence that handler's own comment says
  // must not happen. See `MAX_PRINT_DEPTH` in `session.rs` for the mechanism that used to reach this;
  // that cap now keeps ordinary input from poisoning a session at all, which is what makes this path
  // untested rather than merely defensive — there is no longer an honest way to make `free()` throw
  // through normal input, and this function must still not amplify the next mechanism that does.
  try {
    held?.session.free()
  } catch {
    /* See the comment above: a session that cannot be freed is already unusable. */
  }
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

/**
 * See `recordLambda`'s doc comment — same contract, mirrored for the TM leg.
 *
 * IT ALSO ASKS WHAT KIND OF THING IS LIVE, WHICH `recordLambda` DOES NOT HAVE TO. §3.3's table is the
 * whole reason for the asymmetry: the λ methods exist on both wasm types and the TM ones exist only on
 * `Session`, so the λ loop is genuinely kind-agnostic and this one is not.
 */
async function recordTm(gen: number, emitInitial: boolean): Promise<boolean> {
  // Deliberate silence: the caller's generation is already stale, so there is nothing to record for
  // it — not the accidental kind this file shipped once before.
  if (live?.gen !== gen) return false
  // Deliberate silence, and a state no caller can currently reach: a `LambdaScratch` has no TM leg to
  // record (§4.1 — one leg apiece), and each session has its own worker, so nothing posts a `run` and
  // a `lambda-scratch` to the SAME thread. Written as a guard rather than an assertion because the
  // one-live-session invariant is a property of this file and must not become a property of who calls
  // it: the day a caller does mix them, the honest answer is "there is no TM leg here", not a throw
  // from wasm about a method that does not exist.
  if (live.kind !== 'session') return false
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
      //
      // THE `kind` HALF IS THE TYPE RESTATING THE `gen` HALF. Replacing what is live always claims a
      // new generation (`onRun` and `onLambdaScratch` both set `latest` before building), so a live
      // thing that is no longer a `Session` is already a live thing with a different `gen` — the
      // checker cannot see that implication, and this is where it is written down rather than cast
      // away.
      if (live?.gen !== gen || live.kind !== 'session') return true
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
  live = { gen: req.gen, kind: 'session', session }

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
  // The `kind` half is the type restating the `gen` half — see `recordTm`'s loop for the argument.
  if (live?.gen !== req.gen || live.kind !== 'session') return
  ctx.postMessage({ kind: 'result', gen: req.gen, lambda: lambdaLeg(live.session), tm: tmLeg(live.session) })
}

/**
 * Build a λ scratchpad from λ TEXT and record its reduction — design §4.3's fork, arriving on this
 * thread as `lambda-scratch`.
 *
 * **THE SAME PROLOGUE AS `onRun`, AND THAT IS THE INVARIANT RATHER THAN A COPY.** `dropLive` first,
 * then the byte counters, then the `recording` flags: whatever this thread was holding is freed
 * BEFORE anything new is built, so the two-handle window stays strictly zero for a scratch exactly as
 * it does for a session (§4.2, and this module's own doc). Factoring the six lines into a shared
 * `reset()` was considered and refused — it would read as bookkeeping, when what it actually is is
 * the one place the invariant is enforced, and the two callers must be seen to enforce it.
 *
 * NO `linkIndex`, NO `tmProgram`, NO `tapeNames` IN THE REPLY, and no `result` after it. All four read
 * something §3.3 puts off this type (`self.map`, the TM leg, `self.ty`), which is why the reply is
 * `scratch-compiled` and not `compiled` — see that variant's doc for why five nulls would have been
 * the wrong shape.
 *
 * IT DOES NOT `await recordTm`. A `LambdaScratch` has one leg; `recordTm` would answer `false` at its
 * own `kind` guard, and calling it to be told so would be a line asserting the absence rather than
 * respecting it.
 *
 * **THE REPLAY HAPPENS INSIDE `lambdaScratchAt`, NOT HERE, AND THAT IS DELIBERATE.** Every method the
 * loop needs is on `LambdaScratchHandle`, so ~8 lines of TypeScript here would have worked and needed
 * no new export. It is in Rust because this file is excluded from the coverage include set and is
 * reachable only from the browser tier, which needs Chrome and is skippable — and 5d-i recorded a
 * fabricated status that left the native suite 894/894 green and was caught only there. The rule this
 * file already states is that it holds the wasm call and not the logic.
 */
async function onLambdaScratch(req: Extract<RunRequest, { kind: 'lambda-scratch' }>): Promise<void> {
  await ready
  dropLive()
  recorded.lambda = 0
  recorded.tm = 0
  allowance.lambda = HISTORY_BYTES
  allowance.tm = HISTORY_BYTES
  recording.lambda = false
  recording.tm = false

  const { diagnostics, scratch, text } = lambdaScratchAt(req.src, req.step, LAMBDA_BYTE_BUDGET) as ForkedAtResult
  if (scratch === null) {
    ctx.postMessage({ kind: 'no-session', gen: req.gen, diagnostics })
    return
  }
  // Deliberate silence: a newer request landed while `lambdaScratchAt` (uninterruptible) was in
  // flight. This scratch was never posted anywhere, so freeing it and returning is the whole cleanup
  // — the same reasoning `onRun` gives for the `Session` it discards on the same race.
  if (latest !== req.gen) {
    scratch.free()
    return
  }
  live = { gen: req.gen, kind: 'lambda-scratch', session: scratch }

  // DIAGNOSTICS ARE DROPPED ON THE SUCCESS PATH, and there is nothing to drop: `lambda_scratch_at`'s
  // `diagnostics` on a non-null `scratch` come from REPARSING ITS OWN PRINTED OUTPUT
  // (`lambda/syntax.rs`'s round-trip guarantee), so they are always empty there — the case that
  // genuinely carries them is the `scratch: null` arm above. Posting an always-empty array on a
  // message the app receives per fork would be a field with no reader.
  ctx.postMessage({ kind: 'scratch-compiled', gen: req.gen, lambda: scratch.lambdaStatus(), text })
  await recordLambda(req.gen, true)
}

async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<void> {
  // Deliberate silence: the generation being extended is not the live one anymore (superseded by a
  // later `run`, or there was never a session for it).
  if (live?.gen !== req.gen) return
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
    // BOTH KINDS TAKE THIS BRANCH, which is §3.3's "six methods transplant unchanged" doing its work:
    // `[continue]` on a λ scratchpad's pane is the same two calls as on a session's, against the same
    // method names on a different wasm type. That is the whole reason the pane needs no per-kind
    // control strip.
    const s = live.session
    // Raising a cap that was not hit is harmless — `raise_cap` is additive — but calling it on a
    // DEPTH-refused cursor is pointless by contract, and this branch is never reached for one:
    // `controls.ts` ships no continue affordance for `depth-refused`, which is why that state has no
    // case here rather than a no-op one.
    if (s.lambdaStatus().run === 'Capped') s.raiseLambdaCap(EXTEND_STEPS)
    ran = await recordLambda(req.gen, false)
  } else {
    // Deliberate silence, for `recordTm`'s reason one function up: a scratchpad has no TM leg, so
    // there is no cap to raise and nothing to record. Returning before `allowance` is spent would be
    // tidier still, but the allowance write above is harmless for a leg that never records and
    // hoisting this check above it would put a `kind` test in front of the ordinary path.
    if (live.kind !== 'session') return
    const s = live.session
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
  // A SCRATCHPAD GETS NO `result`, AND THAT IS NOT AN OMISSION. `lambdaLeg` reads `lambdaValue` and
  // `tmLeg` reads `tmValue`; §3.3 puts both off the scratch types because decoding is type-directed
  // and there is no `ty` to decode against. The frames this call just recorded, and their `RecordEnd`,
  // are the whole answer — see `scratch-compiled`'s doc in `protocol.ts`.
  if (live.kind !== 'session') return
  ctx.postMessage({ kind: 'result', gen: req.gen, lambda: lambdaLeg(live.session), tm: tmLeg(live.session) })
}

ctx.addEventListener('message', async (e: MessageEvent<RunRequest>) => {
  const req = e.data
  try {
    if (req.kind === 'run') {
      latest = req.gen
      await onRun(req)
    } else if (req.kind === 'lambda-scratch') {
      // `latest` IS CLAIMED HERE TOO, AND THE ABANDON CHECK INSIDE `onLambdaScratch` DEPENDS ON IT.
      // `latest` is what a build compares itself against after its uninterruptible wasm call returns;
      // a build that never recorded itself as the newest request would free its own scratch every
      // time, since `latest !== req.gen` would still name whatever ran before it.
      latest = req.gen
      await onLambdaScratch(req)
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
