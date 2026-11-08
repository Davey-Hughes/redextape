/**
 * The worker that owns the `Session`.
 *
 * THE HANDLE CANNOT LEAVE THIS THREAD. `Session` is an opaque wasm-bindgen object with no serialized
 * form, so the worker owns it and answers questions about it rather than handing it over. That is
 * also why `captureClasses`, `encodings` and `tokenClasses`, free functions that take no session, are
 * called straight through on the main thread: there is nothing for a worker to own, and a round trip
 * to reach one would be lag bought for nothing.
 *
 * THE SESSION OUTLIVES ITS MESSAGE: `[continue]` needs it alive to resume. Exactly one is live at a
 * time and it is freed BEFORE the next compile, which makes a window with two sessions alive strictly
 * zero rather than merely bounded.
 *
 * **A WORKER CAN HOLD A `LambdaScratch` INSTEAD OF A `Session`, AND THE ONE-LIVE-SESSION INVARIANT
 * HOLDS FOR IT** (design §4.2). What `live` holds has more than one SHAPE; it has one OCCUPANT.
 * `claimLive` (`copy-build.ts`) runs at the top of every request that builds anything, so this thread owns exactly
 * one wasm handle at a time, whichever kind it is — which is the property §4.2 names as the reason
 * decision 3 (one worker per session) is safe, and the property `tests/browser/pool-isolation.test.ts`
 * asserts a shared worker cannot have. A scratchpad is a DIFFERENT WORKER holding a different single
 * handle, not a second handle in this one.
 *
 * **LOGIC PUT HERE IS INVISIBLE TO THE COVERAGE GATE** — `vite.config.ts` excludes this module from
 * the `include` set for a measured instrumentation reason (v8 coverage does not attach to a dedicated
 * worker's context), so a new untested branch in this file moves none of the four numbers. That is
 * why the fork's POLICY — how many buffers a fork makes, which pane rebinds, when a buffer is
 * retired — lives in `scratch.ts` and only the wasm call it cannot make from the main thread
 * lives here.
 *
 * Section and decision citations here are the 5d-i design's unless they name another.
 */
import init, { compile, lambdaScratchAt, rxmScratch, tapeNames, tmScratch } from '../../pkg/redextape_wasm.js'
import { buildCopy, type Claim, type CopyBuild, claimLive, liveHandle } from './copy-build'
import { LEGS, mapLegs, perLeg, unhandled } from './legs'
import type { LinkIndexWire } from './link'
import type {
  HeldLegs,
  LambdaLeg,
  LambdaTreeWire,
  Leg,
  ResultLegs,
  RunReply,
  RunRequest,
  RxmLeg,
  TmLeg,
} from './protocol'
import {
  EXTEND_CELLS,
  EXTEND_STEPS,
  endOf,
  FRAME_BYTES,
  forkable,
  HISTORY_BYTES,
  keepDecided,
  keepInFlight,
  LAMBDA_BYTE_BUDGET,
  LEG_FRAME_BYTES,
  RXM_WINDOW,
  rxmRecordEnd,
  TM_RADIUS,
  VALUE_CHUNK,
} from './protocol'
import { extendLeg, type RecordLeg, type RecordWorker, recordLeg, rewindAndRecord } from './record-loop'
import type {
  Decoded,
  Diagnostic,
  LambdaState,
  LambdaStatus,
  RxmProgram,
  RxmState,
  RxmStatus,
  RxmWindow,
  Span,
  TmProgram,
  TmScratchStatus,
  TmState,
  TmStatus,
  ValueRun,
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
  lambdaTree(step: number, nodeBudget: number): LambdaTreeWire
  raiseLambdaCap(extra: number): void
  rewindLambda(): void
  tmStatus(): TmStatus
  tmProgram(): TmProgram
  tmState(radius: number): TmState
  stepTm(): boolean
  raiseTmCap(extraSteps: number, extraCells: number): void
  rewindTm(): void
  tmValue(): Decoded
  rxmStatus(): RxmStatus
  rxmProgram(): RxmProgram
  rxmState(window: RxmWindow): RxmState
  stepRxm(): boolean
  raiseRxmCap(extraSteps: number): void
  rewindRxm(): void
  rxmValue(): Decoded
  sourceSpan(node: number): Span | null
  linkIndex(byteBudget: number): LinkIndexWire
  /**
   * `null` is load-bearing here: it is how the app learns a machine is over `MAX_FORK_RULES` or its TM
   * leg declined, not a stand-in for "value not yet known". A caller that coalesced it away with `??`
   * would silently paper over that boundary regression — so `onRun` below reads it and passes it
   * through unchanged, never through `??`.
   */
  tmText(): string | null
  /**
   * Whether `tmText` would ever be non-`null` for this session — `false` only for a function-valued
   * program. Read unconditionally, like `rxmText`, not behind `forkable`'s guard: it answers a question
   * about the program's TYPE, not about `tmProgram`'s size, so it holds even when `tmText` itself was
   * never asked for.
   */
  tmResultDecodable(): boolean
  /**
   * `null` for a program with no rxm leg, and for one whose text is longer than `session.rs`'s
   * `MAX_SCRATCH_RXM_BYTES`, which no copy could build. Never a throw: `onRun` reads it unguarded and passes it
   * through unchanged, as it does `tmText`.
   */
  rxmText(): string | null
  free(): void
}

/**
 * The wasm-bindgen `LambdaScratch`, described structurally for the reason `Session` above is — and it
 * is a STRICT SUBSET of `Session`'s λ part, which is design §3.3's table as a type.
 *
 * THE λ METHODS ARE `Session`'S, UNCHANGED, a λ copy being a λ cursor and nothing else, so `RECORDINGS.lambda` below
 * needs no second implementation and no cast: each λ method it calls is identical in name and signature on both
 * kinds, and a `Session` satisfies this type structurally. The ones named here are the ones this file calls.
 *
 * `lambdaValue`, `sourceSpan` AND `linkIndex` ARE ABSENT AND THAT IS THE POINT. They do not exist on
 * the generated class (`pkg/redextape_wasm.d.ts`), and on the Rust side `redextape-wasm`'s
 * `tests/browser.rs` pins their absence at compile time (`scratch_methods_that_must_not_exist`), so a
 * handler that reached for one would not compile here either. `lambdaLeg` below reaches for the first
 * two, which is why it is never called for a copy — see `onExtend`.
 */
type LambdaScratchHandle = {
  lambdaStatus(): LambdaStatus
  lambdaState(byteBudget: number): LambdaState
  stepLambda(): boolean
  lambdaTree(step: number, nodeBudget: number): LambdaTreeWire
  raiseLambdaCap(extra: number): void
  rewindLambda(): void
  free(): void
}

/**
 * The wasm-bindgen `TmScratch`, described structurally for the reason `Session` above is — and it is
 * `Session`'s TM part with `tmValue` gone, mirroring `LambdaScratchHandle` one type up.
 *
 * `tmStatus` RETURNS `TmScratchStatus`, NOT `TmStatus` — a different wire shape, not a narrower read of
 * the same one; see that type's own doc, on its Rust declaration in `redextape-wire`. `tmProgram` HAS NO
 * ABSENT-LEG CASE HERE, UNLIKE `Session.tmProgram`'s caller-side guard in `onRun`: `session.rs`'s
 * own doc on `TmScratch::tm_program` says so directly — there is no declined leg for a scratch to
 * have declined.
 *
 * NO `tmValue`, `sourceSpan`, OR `linkIndex`, for decision 2's reason: a `TmScratch` has no `ty`, no
 * lowering and no `SourceMap`. `tmLeg` below is exactly the function that reaches for the first of
 * those, which is why it is never called for a copy.
 */
type TmScratchHandle = {
  tmStatus(): TmScratchStatus
  tmProgram(): TmProgram
  tapeNames(): string[]
  stepTm(): boolean
  tmState(radius: number): TmState
  raiseTmCap(extraSteps: number, extraCells: number): void
  rewindTm(): void
  free(): void
}

/**
 * The wasm-bindgen `TmValueRun`, described structurally for the reason `Session` above is: the run that reads a
 * headered TM buffer's value, beside the scratch rather than on it, for decision 2's reason (`session.rs`'s
 * `TmValueRun` doc).
 */
type TmValueRunHandle = {
  run(budget: number): ValueRun
  value(): Decoded
  free(): void
}

/**
 * The wasm-bindgen `RxmScratch`, described structurally for the reason `Session` above is: the rxm leg's seven methods.
 * A copy's rxm leg answers every one of them as a session's does (`session.rs`'s `RxmScratch`), so `RECORDINGS.rxm`
 * calls it as it calls a session. No `rxmText`, since a copy offers no copy of itself, and no `sourceSpan` or
 * `linkIndex`: a copy has no `SourceMap`.
 */
type RxmScratchHandle = {
  rxmStatus(): RxmStatus
  rxmProgram(): RxmProgram
  rxmState(window: RxmWindow): RxmState
  stepRxm(): boolean
  raiseRxmCap(extraSteps: number): void
  rewindRxm(): void
  rxmValue(): Decoded
  free(): void
}

/** Each leg's copy, the wasm type that holds that leg alone. */
type ScratchOf = { lambda: LambdaScratchHandle; rxm: RxmScratchHandle; tm: TmScratchHandle }

type CompileResult = { diagnostics: Diagnostic[]; session: Session | null }

/**
 * `lambdaScratchAt(src, step, byteBudget)`'s hand-built object — a handle and plain data, which
 * `lib.rs` assembles with `js_sys::Object` for the reason `compile`'s own doc gives.
 *
 * `scratch` AND `text` ARE NULL TOGETHER OR NEITHER (`session::ForkedAt`) — see `scratch-compiled`'s
 * doc in `protocol.ts`. `scratch: null` covers both text that did not parse and a term too large to
 * print at `LAMBDA_BYTE_BUDGET`; `buildCopy` answers either with `no-session`, the same claim
 * about a different producer.
 */
type ForkedAtResult = { diagnostics: Diagnostic[]; scratch: LambdaScratchHandle | null; text: string | null }

/**
 * `tmScratch(src)`'s hand-built object — a handle and plain data, the same assembly `lib.rs` gives
 * `compile` and `lambdaScratchAt` and for the identical reason.
 *
 * NO `text` FIELD, UNLIKE `ForkedAtResult`. `tmScratch` never echoes the source: the main thread SENT
 * `src` and already holds it — see `tm-scratch-compiled`'s doc in `protocol.ts`.
 */
type TmScratchResult = { diagnostics: Diagnostic[]; scratch: TmScratchHandle | null; value: TmValueRunHandle | null }

/**
 * `rxmScratch(src)`'s hand-built object: `scratch` is `null` for text that does not parse, is over
 * `MAX_SCRATCH_RXM_BYTES`, or has a label mistake, and the diagnostics name which.
 */
type RxmScratchResult = { diagnostics: Diagnostic[]; scratch: RxmScratchHandle | null }

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
 * The ONE live session, with the generation that owns it: `copy-build.ts`'s `Occupant`, with a TM copy's value run.
 *
 * EVERY SESSION TOUCH GOES THROUGH THIS BINDING, never through a captured reference. A record loop
 * suspended at a yield can resume after its session has been freed; reading `live` each time means
 * it sees `null` (or a newer generation) and returns, instead of calling into a dangling handle and
 * raising "null pointer passed to rust" from a place no caller can see.
 *
 * **A DISCRIMINATED UNION, AND IT IS ONE OCCUPANT.** `kind` and a copy's `leg` say which wasm type this thread is
 * holding; the field is `session` in every arm because that is what a record loop steps, λ, TM or rxm
 * (§3.3; 5d-iv design §4.4). The invariant §4.2 rests on is about the CARDINALITY of this binding, which
 * is one, not about the type of what is in it — `claimLive` empties it before anything else is built.
 *
 * A TAG RATHER THAN A `tm`-SHAPED DUCK TEST (`'tmStatus' in live.session`). A tag is what makes the
 * checker refuse `live.session.tmStatus()` on a λ copy's arm at every call site rather than
 * only at the ones somebody remembered to guard — and the mirror image on a TM copy's arm for
 * `live.session.lambdaStatus()` — and §3.3's whole method split is a compile-time claim, a runtime
 * probe would restate it as a convention.
 *
 * **EVERY LEG ASKS WHAT KIND OF THING IS LIVE.** `TmScratchHandle` carries the TM methods the TM leg's
 * recording calls but none of the λ ones the λ leg's does — the reverse of `LambdaScratchHandle` — and
 * `RxmScratchHandle` carries the rxm leg's alone. See `liveHandle`.
 */
type Live =
  | { gen: number; kind: 'session'; session: Session }
  | { gen: number; kind: 'scratch'; leg: 'lambda'; session: LambdaScratchHandle }
  | { gen: number; kind: 'scratch'; leg: 'tm'; session: TmScratchHandle; value: TmValueRunHandle | null }
  | { gen: number; kind: 'scratch'; leg: 'rxm'; session: RxmScratchHandle }

let live: Live | null = null

/**
 * Bytes recorded per leg, and the allowance each is spending against. `[continue]` on a `budget`
 * stop buys another `HISTORY_BYTES`; the main thread's ring evicts, so recording further is bounded
 * per click rather than unbounded.
 */
const recorded: Record<Leg, number> = perLeg(() => 0)
const allowance: Record<Leg, number> = perLeg(() => HISTORY_BYTES)

/**
 * One record loop per leg at a time. `latest` serializes `run` requests, but two `extend`s carry the
 * SAME generation, so nothing in `live.gen` can distinguish them — two loops would step one cursor
 * and interleave their frames. The same race reaches `onRun`: an `extend` can land while `onRun`'s
 * recording of the TM leg is still in flight, once the λ leg has already posted its `budget` stop.
 *
 * **`postResult` READS IT TOO, AS "THIS LEG MAY BE MID-FILL"**: a `result` keeps a recording leg's last part
 * (`keepInFlight`), so a flag cleared before its loop stops would let a rewound fill be read mid-way.
 */
const recording: Record<Leg, boolean> = perLeg(() => false)

/**
 * Each leg's epoch: 0 at a build and set by each `rewind` to the page's count of that leg's rewinds, so that a reply
 * or a request of an older epoch is told apart from the rewound leg's (the `rewind` request, in `protocol.ts`'s
 * `RunRequest`).
 */
const epoch: Record<Leg, number> = perLeg(() => 0)

/**
 * The legs the live generation's last `result` posted, `null` before its first: what `keepDecided` keeps a decided
 * value from, across a rewind, and `keepInFlight` a leg still recording, which takes `rewoundFrom`'s before the first.
 */
let posted: ResultLegs | null = null

/**
 * Each leg's part as a rewind of a session found it before the generation's first `result`, else `null`. **READ BEFORE
 * THE CURSOR GOES BACK**, so that it is the part the leg stood at and not one of the fill the rewind records again:
 * with no `result` posted, a `result` posted while that fill records would otherwise read it mid-way.
 */
const rewoundFrom: HeldLegs = perLeg(() => null)

/** Each leg's part of a session's `result`, read off its cursor. */
const PART: { readonly [K in Leg]: (session: Session) => ResultLegs[K] } = { lambda: lambdaLeg, rxm: rxmLeg, tm: tmLeg }

/** `rewoundFrom`'s part for `leg`, read as `postResult` reads it. */
function holdPart<K extends Leg>(leg: K, session: Session): void {
  rewoundFrom[leg] = PART[leg](session)
}

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
  // THIS IS DEFENCE-IN-DEPTH, against a mechanism that turns a thrown session call into permanent
  // silence: a `&self` wasm call that aborts mid-flight (a stack overflow, say) leaves wasm-bindgen's
  // reentrancy borrow taken, so `free()` on that same session throws "attempted to take ownership of
  // Rust value while it was borrowed". The message handler's `catch` block (below) calls `dropLive()`
  // first thing on ANY thrown session call, specifically so a poisoned session cannot stay live; an
  // unguarded `free()` there would throw a second time, before the `worker-error` postMessage on the
  // next line ran, and the client would hear nothing — the exact silence that handler's own comment
  // says must not happen. `MAX_PRINT_DEPTH` in `session.rs` keeps ordinary input from poisoning a
  // session at all, which is what makes this path untested rather than merely defensive — there is
  // no honest way to make `free()` throw through normal input, and this function must still not
  // amplify the next mechanism that does.
  try {
    held?.session.free()
  } catch {
    /* See the comment above: a session that cannot be freed is already unusable. */
  }
  // THE VALUE RUN IS A SECOND HANDLE, FREED UNDER THE SAME RULE AND IN ITS OWN `try`, so a scratch that cannot be
  // freed does not leak the run beside it.
  try {
    if (held?.kind === 'scratch' && held.leg === 'tm') held.value?.free()
  } catch {
    /* As above. */
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
 * of it past depth 5. `MessageChannel`'s `postMessage` is a macrotask with no such floor — same
 * abandon-check semantics (the message queue still has to drain for it to fire), without paying HTML's
 * timer tax.
 */
const yieldToEventLoop = (): Promise<void> =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => resolve()
    channel.port2.postMessage(undefined)
  })

/**
 * What `recordLeg` needs of this thread: the books and flags above, whether a generation still owns what is live, and
 * this thread's post and yield.
 */
const worker: RecordWorker = {
  recording,
  recorded,
  allowance,
  epoch,
  owns: (gen) => live?.gen === gen,
  post: (reply) => ctx.postMessage(reply),
  yieldToEventLoop,
}

/** What `claimLive` touches on this thread: the module, the occupant, and the parts the last generation kept. */
const claim: Claim = {
  ready,
  dropLive,
  forgetResult: () => {
    for (const leg of LEGS) rewoundFrom[leg] = null
    posted = null
  },
}

/** What `leg`'s recording may step for `gen`, `liveHandle`'s answer for what is live. */
function handleOf<K extends Leg>(leg: K, gen: number): Session | ScratchOf[K] | null {
  return liveHandle<Session, ScratchOf, K>(live, leg, gen)
}

/**
 * Each leg's pieces for `record-loop.ts`: a `Session`'s leg, or a copy's (`ScratchOf`), which carries that leg's
 * methods under `Session`'s names. Reached only through `record`, `extend`, `rewind` and `onScratch` below (`record`'s
 * doc).
 */
const RECORDINGS: { readonly [K in Leg]: RecordLeg<K, Session | ScratchOf[K]> } = {
  // The λ leg's recording is what decides its value, where TM's and rxm's replay a run `compile` already finished,
  // whose allowance costs history alone.
  lambda: {
    leg: 'lambda',
    handle: (gen) => handleOf('lambda', gen),
    available: (s) => s.lambdaStatus().available,
    frame: (s) => s.lambdaState(FRAME_BYTES),
    bytes: LEG_FRAME_BYTES.lambda,
    step: (s) => s.stepLambda(),
    end: (s) => endOf(s.lambdaStatus().run),
    raise: (s) => s.raiseLambdaCap(EXTEND_STEPS),
    rewind: (s) => s.rewindLambda(),
  },
  rxm: {
    leg: 'rxm',
    handle: (gen) => handleOf('rxm', gen),
    available: (s) => s.rxmStatus().available,
    frame: (s) => s.rxmState(RXM_WINDOW),
    bytes: LEG_FRAME_BYTES.rxm,
    step: (s) => s.stepRxm(),
    end: (s) => rxmRecordEnd(s.rxmStatus()),
    raise: (s) => s.raiseRxmCap(EXTEND_STEPS),
    rewind: (s) => s.rewindRxm(),
  },
  tm: {
    leg: 'tm',
    handle: (gen) => handleOf('tm', gen),
    available: (s) => s.tmStatus().available,
    frame: (s) => s.tmState(TM_RADIUS),
    bytes: LEG_FRAME_BYTES.tm,
    step: (s) => s.stepTm(),
    end: (s) => endOf(s.tmStatus().run),
    raise: (s) => s.raiseTmCap(EXTEND_STEPS, EXTEND_CELLS),
    rewind: (s) => s.rewindTm(),
  },
}

/**
 * Record `leg` through its entry in `RECORDINGS`; `recordLeg`'s doc has the contract, and its answer is this one's.
 * **GENERIC IN THE LEG, AS `extend` AND `rewind` ARE**, so the entry is typed by the one leg `K` and handed on as such:
 * no call passes a `RecordLeg` of the whole union, whose `leg` and frames `tsc` would not tie together.
 */
function record<K extends Leg>(leg: K, gen: number, emitInitial: boolean): Promise<boolean> {
  return recordLeg(RECORDINGS[leg], worker, gen, emitInitial)
}

/** `extendLeg` for `leg`, reached as `record` reaches `recordLeg`. */
function extend<K extends Leg>(leg: K, gen: number): Promise<boolean> {
  return extendLeg(RECORDINGS[leg], worker, gen)
}

/** `rewindAndRecord` for `leg`, holding a session's part first when its generation has posted no `result`. */
function rewind<K extends Leg>(leg: K, gen: number, toEpoch: number): Promise<void> {
  return rewindAndRecord(RECORDINGS[leg], worker, gen, toEpoch, () => {
    if (posted === null && live?.kind === 'session') holdPart(leg, live.session)
  })
}

/**
 * A declined λ leg's refusal, named as a source range — `null` for an available leg or one whose
 * refusal names no node. `sourceSpan` IS RESOLVED HERE because the handle cannot leave this thread; a
 * refusal that names a node the main thread cannot look up would highlight nothing.
 *
 * ONE EXPRESSION, not two written differently in two call sites: `onRun`'s `compiled` message and
 * `lambdaLeg` below for the `result` message both call this, and the same fact computed two ways is
 * exactly the shape a future edit changes correctly in one place and not the other.
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

function rxmLeg(session: Session): RxmLeg {
  const status = session.rxmStatus()
  if (!status.available) return { status, value: null }
  return { status, value: session.rxmValue() }
}

/**
 * Post the live session's `result`, through `keepInFlight` so that a leg a rewind is recording again is not read
 * mid-fill, and `keepDecided` so that a value decided before a rewind is not taken away by the rewound cursor's
 * `Unfinished`, and keep what it posted as `posted`. `onRun` and `onExtend` both post here.
 */
function postResult(gen: number, session: Session): void {
  const read = mapLegs<ResultLegs>((leg) => PART[leg](session))
  posted = keepDecided(posted, keepInFlight(posted ?? rewoundFrom, read, recording))
  ctx.postMessage({ kind: 'result', gen, legs: posted })
}

async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
  await claimLive(claim, worker)

  // `compile` RUNS THE WHOLE TM LEG and is one uninterruptible call. Off the main thread that can only
  // delay the next result; it can never block input, highlighting or linting.
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
  const rxm = session.rxmStatus()
  const tm = session.tmStatus()
  const index = session.linkIndex(LAMBDA_BYTE_BUDGET)
  // GUARDED FOR `tmProgram`'s REASON BELOW: `rxmProgram` throws `RxmAbsent` for a program that does not lower.
  const rxmProgram = rxm.available ? session.rxmProgram() : null
  // GUARDED: `tmProgram` throws `TmAbsent` for a declined leg, and a throw lands in the listener's
  // `catch`, which drops the whole session.
  const tmProgram = tm.available ? session.tmProgram() : null
  // THE GATE — `forkable` is imported from `protocol.ts` precisely so it is not written here, where the
  // coverage gate cannot see it.
  const tmText = forkable(tmProgram) ? session.tmText() : null
  // UNGUARDED, LIKE `rxmText` BELOW: a fact about the program's type, answerable whether or not
  // `tmText` itself was ever asked for — see this method's own doc on the worker's `Session` type.
  const tmResultDecodable = session.tmResultDecodable()
  // UNGUARDED, WHERE `rxmProgram` ABOVE IS GUARDED: `rxmText` answers `null` itself for a declined leg and for text
  // over the copy ceiling, and cannot throw. Passed through unchanged, never through `??`, for `tmText`'s reason.
  const rxmText = session.rxmText()
  ctx.postMessage(
    {
      kind: 'compiled',
      gen: req.gen,
      statuses: { lambda, rxm, tm },
      programs: {
        rxm: rxmProgram === null ? null : { program: rxmProgram, text: rxmText },
        tm:
          tmProgram === null
            ? null
            : { program: tmProgram, tapeNames: tapeNames() as string[], text: tmText, tmResultDecodable },
      },
      declinedSpan: declinedSourceSpan(session, lambda),
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
      index.rxmOwner.buffer,
    ],
  )

  // λ, THEN RXM, THEN TM (Plan 7 part 5 spec §5.4), `LEGS`' order, which is `LEG_NAME`'s. rxm is the cheapest leg per
  // step, and TM's recording can run to its whole `HISTORY_BYTES` before a leg after it starts; the λ leg stays first,
  // since its recording is what decides its value.
  for (const leg of LEGS) await record(leg, req.gen, true)

  // Deliberate silence: superseded while recording ran. The generation that wanted this result is gone.
  // The `kind` half is the type restating the `gen` half — see `liveHandle`'s doc for the argument.
  if (live?.gen !== req.gen || live.kind !== 'session') return
  postResult(req.gen, live.session)
}

/** Each leg's copy as its build makes it: the handle, and what its reply or its free needs beside it. */
type Made = {
  lambda: { scratch: LambdaScratchHandle; text: string | null }
  rxm: RxmScratchHandle
  tm: { scratch: TmScratchHandle; value: TmValueRunHandle | null }
}

/**
 * Each leg's copy build, for `buildCopy`. Each reply is the leg's own `*-scratch-compiled`, and no `result` follows:
 * a `result` reads what a copy does not have (a `SourceMap`, a `ty`, the other legs), as each reply's doc in
 * `protocol.ts` says.
 *
 * **A COPY THAT BUILT HAS NO DIAGNOSTICS, ON ANY LEG**, so `buildCopy` posts none beside it. A λ copy parses a term
 * (its own print past step 0, `src` at step 0), and `parse_lambda` answers a term with no diagnostic beside it.
 * `tm::parse_tm_full` makes every diagnostic an error and builds no machine once there is one; a headerless file is
 * `tm.header: false` on the status, not a diagnostic. `rxm_scratch` builds no copy unless its diagnostics are empty.
 */
const BUILD: { readonly [K in Leg]: CopyBuild<K, Made[K]> } = {
  // THE REPLAY TO THE FORKED STEP IS IN RUST, INSIDE `lambdaScratchAt`, NOT HERE: this file is reachable only from the
  // browser tier, which the coverage gate cannot see.
  lambda: {
    build: (src, step) => {
      const { diagnostics, scratch, text } = lambdaScratchAt(src, step, LAMBDA_BYTE_BUDGET) as ForkedAtResult
      return { made: scratch === null ? null : { scratch, text }, diagnostics }
    },
    free: ({ scratch }) => scratch.free(),
    occupy: (gen, { scratch }) => {
      live = { gen, kind: 'scratch', leg: 'lambda', session: scratch }
    },
    compiled: (gen, { scratch, text }) => ({ kind: 'scratch-compiled', gen, lambda: scratch.lambdaStatus(), text }),
  },
  rxm: {
    build: (src) => {
      const { diagnostics, scratch } = rxmScratch(src) as RxmScratchResult
      return { made: scratch, diagnostics }
    },
    free: (scratch) => scratch.free(),
    occupy: (gen, scratch) => {
      live = { gen, kind: 'scratch', leg: 'rxm', session: scratch }
    },
    // ITS VALUE RIDES THE BUILD REPLY: `rxmScratch` has run the program to its end (Plan 7 part 5 spec, amendment 26),
    // so no value loop follows the recording as a TM copy's does.
    compiled: (gen, scratch) => ({
      kind: 'rxm-scratch-compiled',
      gen,
      rxm: scratch.rxmStatus(),
      rxmProgram: scratch.rxmProgram(),
      value: scratch.rxmValue(),
    }),
  },
  tm: {
    build: (src) => {
      const { diagnostics, scratch, value } = tmScratch(src) as TmScratchResult
      return { made: scratch === null ? null : { scratch, value }, diagnostics }
    },
    free: ({ scratch, value }) => {
      scratch.free()
      value?.free()
    },
    occupy: (gen, { scratch, value }) => {
      live = { gen, kind: 'scratch', leg: 'tm', session: scratch, value }
    },
    // Its own `tapeNames`, not the fixed export `onRun` posts: a reduced file's single-tape stage changes what its one
    // tape is.
    compiled: (gen, { scratch }) => ({
      kind: 'tm-scratch-compiled',
      gen,
      tm: scratch.tmStatus(),
      tmProgram: scratch.tmProgram(),
      tapeNames: scratch.tapeNames(),
    }),
    // A headered file's value, as `tm-value` after every chunk, in place of a session's `result`.
    after: runValueLoop,
  },
}

/**
 * Build `leg`'s copy. **GENERIC IN THE LEG, AS `record` IS**: `tsc` checks this body with `K` abstract, so a build of
 * one leg paired with another leg's recording is refused, `buildCopy` taking both of one `K`.
 */
function onScratch<K extends Leg>(leg: K, req: Extract<RunRequest, { kind: 'scratch' }>): Promise<void> {
  return buildCopy(BUILD[leg], RECORDINGS[leg], claim, () => latest, worker, req)
}

/**
 * Run a TM buffer's value run out in `VALUE_CHUNK` steps at a time, posting where it stands after each chunk.
 *
 * **AFTER THE FIRST RECORDING, NOT BESIDE IT.** Frames are what the pane draws first, so the first recording runs
 * before this loop starts. A `[continue]` that arrives while this loop is going is dispatched at its next yield: the
 * message listener starts `onExtend`, whose recording then takes turns with this loop, one `RECORD_CHUNK` of frames
 * against one `VALUE_CHUNK` of steps, each run whole between yields. The two step different cursors — the recording
 * the scratch's own through `stepTm`, this loop the `TmValueRun` beside it — so taking turns delays each by the
 * other's chunk and changes neither's result.
 *
 * **EVERY CHUNK STARTS WITH A GUARD LIKE THE TM LEG'S** (the TM entry's `handle`, which `recordLeg` asks before
 * every chunk), reading `live` rather than a captured handle, so an edit that replaced the scratch, or freed it, ends
 * this loop at its next chunk rather than stepping a freed run.
 *
 * **NO RE-ENTRY FLAG, BECAUSE A BUILD IS A GENERATION.** `BUILD.tm`'s `after` is the only caller and starts one loop
 * per build, and every build claims a new generation (`SessionClient.supersede` on the main thread, `latest = req.gen`
 * here), so one loop per build is one loop per run. A loop left over from an earlier build meets the guard above
 * at its next chunk and returns without stepping or posting.
 */
async function runValueLoop(gen: number): Promise<void> {
  for (;;) {
    if (live?.gen !== gen || live.kind !== 'scratch' || live.leg !== 'tm' || live.value === null) return
    const run = live.value.run(VALUE_CHUNK)
    ctx.postMessage({ kind: 'tm-value', gen, run, value: live.value.value() })
    if (run.run !== 'Running') return
    await yieldToEventLoop()
  }
}

async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<void> {
  // Deliberate silence: the generation being extended is not the live one anymore (superseded by a
  // later `run`, or there was never a session for it).
  if (live?.gen !== req.gen) return
  // Deliberate silence, and a state the page cannot reach: it raises a leg's epoch only as it posts `rewind`, and
  // this thread takes messages in order, so no `extend` of an older epoch arrives after the `rewind` that replaced
  // it. Checked as the generation is, so that a stale request records nothing whoever posts it, as
  // `tests/browser/worker.test.ts` does.
  if (req.epoch !== epoch[req.leg]) return
  // ONE MORE ALLOWANCE FROM WHERE RECORDING STOPPED, not stacked on the old allowance. On a `budget`
  // stop `recorded[leg] >= allowance[leg]`, but not necessarily equal to it: the check runs BEFORE
  // that iteration's frame is added, so `recorded` can overshoot the old `allowance` by up to one
  // frame's bytes by the time the loop actually stops. Setting `allowance[leg]` to `recorded[leg] +
  // HISTORY_BYTES` rather than `+= HISTORY_BYTES` grants HISTORY_BYTES from that (slightly later)
  // point instead. Harmless, and arguably better: it guarantees at least one more step happens after
  // `[continue]` rather than possibly none. On a `capped` stop `recorded[leg] < allowance[leg]`, and
  // `+=` would let the unspent remainder stack — a k-th extend would permit (k+1)×HISTORY_BYTES
  // instead of one more. Setting the allowance itself avoids that stacking in both cases.
  allowance[req.leg] = recorded[req.leg] + HISTORY_BYTES

  // Written before `extend` asks whether what is live has the leg: harmless for a leg that never records, where asking
  // first would put a `kind` test in front of the ordinary path.
  const ran = await extend(req.leg, req.gen)
  // A SUPPRESSED CALL MUST NOT POST A RESULT. `ran === false` is a live thing without the leg, a leg that did not
  // compile, or a loop already in flight for this leg, which owns it — that loop posts its own frames, and its caller
  // any `result`, when it finishes. Posting one here too would answer with whatever partial state that other loop had
  // reached at this instant, then let the real loop's caller post a second, later `result` for the same generation
  // (the two rapid `extend`s, e.g. a double-click before the UI disables the affordance, this exists to guard).
  // `true` from a loop a rewind cut short posts one, which keeps the rewound leg's last part (`keepInFlight`).
  if (!ran) return

  // Deliberate silence: superseded while recording ran, same as `onRun`'s post-record check.
  if (live?.gen !== req.gen) return
  // A SCRATCHPAD GETS NO `result`, AND THAT IS NOT AN OMISSION. `lambdaLeg` reads `lambdaValue` and
  // `tmLeg` reads `tmValue`; §3.3 puts both off the scratch types because decoding is type-directed
  // and a scratch has no `ty` to decode against. The frames this call just recorded, and their
  // `RecordEnd`, are its whole answer; a headered TM buffer's value arrives separately, as the
  // `tm-value` replies `runValueLoop` posts, which `[continue]` neither starts nor extends. An rxm copy's value is read
  // off its cursor where its build's cap stopped the build's run, which a raise or a rewind moves, so it is posted
  // again here, on its own.
  if (live.kind === 'scratch' && live.leg === 'rxm') {
    ctx.postMessage({ kind: 'rxm-value', gen: req.gen, value: live.session.rxmValue() })
    return
  }
  if (live.kind !== 'session') return
  postResult(req.gen, live.session)
}

/**
 * Take one leg back to step 0 and record its first fill again, under the epoch the request carries (hidden-recording
 * spec §5.4): the `rewind` the page posts when ↺ finds the leg's step 0 dropped from its ring.
 *
 * **A STALE GENERATION, A LIVE THING WITHOUT THE LEG, OR A LEG THAT DID NOT COMPILE ANSWERS NOTHING**, the questions
 * the leg's `handle` and `available` ask: a `Session`'s rewind throws for an absent leg, and a throw drops the session.
 * **NOR DOES AN EPOCH NO NEWER THAN THE LEG'S**: the loop in flight would not stop, and two loops would step a cursor.
 *
 * **THE LOOP IN FLIGHT IS LEFT TO RETURN, NOT AWAITED.** The raised epoch stops it at its next chunk, and it leaves
 * the flag, cleared here, to the new loop. **NO `result` OF ITS OWN** (spec §5.2): one posted while this fill records
 * keeps the leg's last part, read here first if none was posted (`keepInFlight`), and later its decided value.
 */
async function onRewind(req: Extract<RunRequest, { kind: 'rewind' }>): Promise<void> {
  await rewind(req.leg, req.gen, req.epoch)
}

/**
 * Answer one `lambda-tree` request, synchronously, between record chunks (Plan 7 part 4 spec §4.1).
 *
 * **NOT A CLAIM ON `latest`.** A tree is a question about what a `run` or a λ `scratch` built, not a
 * new build, so it supersedes nothing; a request for a generation that is no longer live is dropped, as a
 * stale record loop's frames are.
 *
 * **A DECLINED λ LEG IS ASKED NOTHING.** `Session.lambdaTree` throws for an absent leg, and a throw here
 * lands in the listener's `catch`, which drops the whole session — a λ view on a TM-only program would
 * kill that program's TM leg. The view never asks for such a leg, since it has no frames; this guard is
 * what makes that true rather than merely usual.
 *
 * THE COLUMNS ARE TRANSFERRED, not cloned: `tree_to_js` copies each out of wasm memory into its own
 * `ArrayBuffer`, which nothing here reads again.
 */
function onLambdaTree(req: Extract<RunRequest, { kind: 'lambda-tree' }>): void {
  // A session, or a λ copy.
  const held = handleOf('lambda', req.gen)
  if (held === null || (live?.kind === 'session' && !live.session.lambdaStatus().available)) return
  const tree = held.lambdaTree(req.step, req.budget)
  ctx.postMessage({ kind: 'lambda-tree', gen: req.gen, tree }, [
    tree.kind.buffer,
    tree.left.buffer,
    tree.right.buffer,
    tree.name.buffer,
    tree.hint.buffer,
    tree.link.buffer,
  ])
}

ctx.addEventListener('message', async (e: MessageEvent<RunRequest>) => {
  const req = e.data
  try {
    // A `switch` ENDING IN `unhandled`: a request kind with no case is a type error here, where it would
    // otherwise fall off the end and be dropped with no reply and `tsc` green — which is where a new
    // leg's requests arrive (Plan 7 part 5's spec, amendment 8).
    switch (req.kind) {
      case 'run':
        latest = req.gen
        await onRun(req)
        break
      case 'scratch':
        // `latest` IS CLAIMED HERE TOO, AND EACH BUILD'S ABANDON CHECK DEPENDS ON IT. `latest` is what a build
        // compares itself against after its uninterruptible wasm call returns; a build that never recorded itself
        // as the newest request would free its own copy every time, since `latest !== req.gen` would still name
        // whatever ran before it.
        latest = req.gen
        await onScratch(req.leg, req)
        break
      case 'extend':
        await onExtend(req)
        break
      case 'rewind':
        await onRewind(req)
        break
      case 'lambda-tree':
        onLambdaTree(req)
        break
      default:
        unhandled(req)
    }
  } catch (err) {
    // A THROWN SESSION CALL MUST NOT BECOME SILENCE. Every wasm entry point is fallible at the
    // binding layer (`to_value` can fail even where `session.rs` cannot), so this is a
    // structural guarantee rather than a guard on the few call sites currently known to throw. The
    // session may have thrown mid-record, so it must not stay live.
    dropLive()
    ctx.postMessage({ kind: 'worker-error', gen: req.gen, message: err instanceof Error ? err.message : String(err) })
  }
})
