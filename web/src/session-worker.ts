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
 * **`claimLive` (`claim.ts`) RUNS AT THE TOP OF EVERY REQUEST THAT BUILDS ANYTHING**, so this thread owns one
 * wasm handle at a time (design §4.2): the property §4.2 names as the reason decision 3 (one worker per session) is
 * safe, and the property `tests/browser/pool-isolation.test.ts` asserts a shared worker cannot have.
 *
 * **ONE SESSION, PLUS AT MOST ONE CLIF STEPPER BUILT FROM IT AND DROPPED WITH IT.** The stepper lives on `live`, is
 * freed with the session or by a `clif` request, and is built only while a CLIF view is shown, once the run's other
 * legs have posted their `result`. `pkg-clif` is loaded when the page asks, for a stepper or on intent, and never
 * before.
 *
 * **LOGIC PUT HERE IS INVISIBLE TO THE COVERAGE GATE** — `vite.config.ts` excludes this module from
 * the `include` set for a measured instrumentation reason (v8 coverage does not attach to a dedicated
 * worker's context), so a new untested branch in this file moves none of the four numbers. That is
 * why the order a build runs in is `claim.ts`'s and `record-loop.ts`'s, and only the wasm calls and the
 * state they touch live here.
 *
 * Section and decision citations here are the 5d-i design's unless they name another.
 */
import init, { compile, tapeNames } from '../../pkg/redextape_wasm.js'
import { type Claim, claimLive, liveHandle } from './claim'
import { type ClifHandle, type ClifModule, clifLoader, type McModule } from './clif-loader'
import { LEGS, perLeg, unhandled } from './legs'
import type { LinkIndexWire } from './link'
import type {
  CopyLeg,
  HeldLegs,
  LambdaLeg,
  LambdaTreeWire,
  Leg,
  Listing,
  McTarget,
  ResultLegs,
  RunReply,
  RunRequest,
  RxmLeg,
  TmLeg,
} from './protocol'
import {
  CLIF_ABSENT,
  CLIF_WINDOW,
  clifCompileStatus,
  clifPart,
  EXTEND_CELLS,
  EXTEND_STEPS,
  endOf,
  FRAME_BYTES,
  HISTORY_BYTES,
  keepDecided,
  keepInFlight,
  LAMBDA_BYTE_BUDGET,
  LAMBDA_TREE_NODES,
  LEG_FRAME_BYTES,
  RXM_WINDOW,
  rxmRecordEnd,
  TM_RADIUS,
} from './protocol'
import { extendLeg, type RecordLeg, type RecordWorker, recordBuild, recordFresh, rewindAndRecord } from './record-loop'
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
   * What a CLIF stepper is built from, the rxm program, its type and compile's rxm caps, or `null` for a program the
   * rxm leg declined. **`unknown`**: only `ClifSession`'s constructor reads it.
   */
  clifInput(): unknown
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

/**
 * `pkg-clif`, loaded the first time the page asks for it, for a stepper or on intent, and kept once it loads. **A
 * LITERAL SPECIFIER**, which the licence scan reads to find the package's licences.
 */
const loadClif = clifLoader<ClifModule>(async () => {
  const clif = await import('../../pkg-clif/redextape_clif_wasm.js')
  await clif.default()
  return clif
})

/**
 * Each target's machine code package, loaded the first time the page asks for that target, and kept once it loads.
 * **LITERAL SPECIFIERS**, one per package, for `loadClif`'s reason.
 */
const loadMc: { readonly [T in McTarget]: () => Promise<McModule> } = {
  'x86-64': clifLoader<McModule>(async () => {
    const mc = await import('../../pkg-mc-x86-64/redextape_mc_wasm.js')
    await mc.default()
    return mc
  }),
  arm64: clifLoader<McModule>(async () => {
    const mc = await import('../../pkg-mc-arm64/redextape_mc_wasm.js')
    await mc.default()
    return mc
  }),
}

/** The targets whose package is in, after which a load fetches nothing and says nothing of loading. */
const mcIn = new Set<McTarget>()

/** `target`'s package, loaded or already in, said to the page as an `mc-load`: `loadClifAndSay`'s twin. */
async function loadMcAndSay(target: McTarget): Promise<McModule | null> {
  if (!mcIn.has(target)) ctx.postMessage({ kind: 'mc-load', target, state: 'loading' })
  let mc: McModule
  try {
    mc = await loadMc[target]()
  } catch (e) {
    ctx.postMessage({ kind: 'mc-load', target, state: 'failed', error: String(e) })
    return null
  }
  mcIn.add(target)
  ctx.postMessage({ kind: 'mc-load', target, state: 'ready' })
  return mc
}

/**
 * The `mc` requests of generation `gen` taken so far whose package was in, settled once each has answered or been
 * dropped: what a `clif` request of `gen` taken after them waits on before it builds (`onClif`). **ONE GENERATION'S
 * ALONE**: a request waits on its run's `result`, which a superseded run never posts, so an older generation's would
 * hold a newer `clif` for good. **NONE WHOSE PACKAGE IS STILL TO LOAD**: the listing must never wait on a download.
 */
let mcTaken: { readonly gen: number; readonly done: Promise<void> } = { gen: 0, done: Promise.resolve() }

/**
 * Answer an `mc` request from the live session's `clifInput()`. **AFTER THE RUN'S `result`**, as a CLIF pass is, so a
 * compile never waits on it, **AND, ITS PACKAGE IN, BEFORE A `clif` REQUEST TAKEN AFTER IT BUILDS**, so that the code
 * of a listing switched to lands before the listing (machine code panel design §6, *Building*); the page asks only
 * once a package is in, and a request whose package is still to load holds no listing back. **EVERY AWAIT IS
 * FOLLOWED BY A CHECK THAT THE GENERATION IS STILL LIVE**, and a request for one that is not gets no answer, since the
 * page asks again for the generation it now shows.
 */
function onMc(req: Extract<RunRequest, { kind: 'mc' }>): Promise<void> {
  const loaded = mcIn.has(req.target)
  const answered = answerMc(req)
  if (!loaded) return answered
  const before = mcTaken.gen === req.gen ? mcTaken.done : Promise.resolve()
  // A THROW IS THE LISTENER'S TO REPORT, through `answered`; the wait only needs to know it ended.
  mcTaken = { gen: req.gen, done: Promise.all([before, answered]).then(nothing, nothing) }
  return answered
}

const nothing = (): void => {}

async function answerMc(req: Extract<RunRequest, { kind: 'mc' }>): Promise<void> {
  if (live?.gen !== req.gen) return
  await runResult.posted
  const mc = await loadMcAndSay(req.target)
  if (mc === null) return
  const held = live?.gen === req.gen ? live : null
  if (held === null) return
  const { gen, target, listing } = req
  const input = held.session.clifInput()
  if (input === null) {
    const error = held.session.rxmStatus().reason
    ctx.postMessage({ kind: 'mc', gen, target, listing, code: null, error, trapped: false })
    return
  }
  try {
    const code = mc.machineCode(input, listing)
    ctx.postMessage({ kind: 'mc', gen, target, listing, code, error: null, trapped: false })
  } catch (e) {
    // A DECLINE IS THROWN AS ITS SENTENCE, A STRING; A TRAP IS AN `Error` (`WebAssembly.RuntimeError`), whose message
    // ("unreachable") says nothing of the program, so it must not read as the program's decline.
    const trapped = e instanceof Error
    const error = trapped ? e.message : String(e)
    ctx.postMessage({ kind: 'mc', gen, target, listing, code: null, error, trapped })
  }
}

/** The newest generation this worker has been asked for. */
let latest = 0

/** A run's `result` to come: a promise, and what settles it once `onRun` has posted that `result`. */
type ResultToCome = { readonly gen: number; readonly posted: Promise<void>; readonly settle: () => void }

function resultToCome(gen: number): ResultToCome {
  let settle: () => void = () => {}
  const posted = new Promise<void>((resolve) => {
    settle = resolve
  })
  return { gen, posted, settle }
}

/**
 * The newest `run`'s `result` to come: what a `clif` request waits on before it builds, so that a stepper asked for at
 * `compiled` records neither beside the run's first fills nor ahead of its `result`. **EACH `run` REPLACES IT AS IT
 * STARTS**, so a superseded run, which posts no `result`, never holds a newer generation's request.
 */
let runResult = resultToCome(0)

/**
 * The ONE live session, with the generation that owns it: `claim.ts`'s `Occupant`, and what the worker keeps
 * beside it.
 *
 * EVERY SESSION TOUCH GOES THROUGH THIS BINDING, never through a captured reference. A record loop
 * suspended at a yield can resume after its session has been freed; reading `live` each time means
 * it sees `null` (or a newer generation) and returns, instead of calling into a dangling handle and
 * raising "null pointer passed to rust" from a place no caller can see.
 *
 * The invariant §4.2 rests on is about the CARDINALITY of this binding, which is one: `claimLive` empties it before
 * anything else is built.
 */
type Live = {
  gen: number
  session: Session
  pinned: boolean
  /**
   * The CLIF stepper built from this session, with the listing it was built for, `null` while none is built: part of
   * this occupant, not a second one, since `dropLive` frees it with the session.
   */
  clif: { session: ClifHandle; listing: Listing } | null
}

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
 * Each leg's epoch: 0 at a build and set by each `rewind`, and each `clif` request for the CLIF leg, to the page's
 * count of them, so that a reply or a request of an older epoch is told apart from the leg's now (the `rewind`
 * request, in `protocol.ts`'s `RunRequest`).
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

/** Each leg's part of a session's `result`, read off its cursor, or for CLIF off the stepper beside it. */
const PART: { readonly [K in Leg]: (held: Live) => ResultLegs[K] } = {
  lambda: (held) => lambdaLeg(held.session),
  rxm: (held) => rxmLeg(held.session),
  tm: (held) => tmLeg(held.session),
  clif: (held) => (held.clif === null ? CLIF_ABSENT : clifPart(held.clif.session.status(), held.clif.session.value())),
}

/** `rewoundFrom`'s part for `leg`, read as `postResult` reads it. */
function holdPart<K extends Leg>(leg: K, held: Live): void {
  rewoundFrom[leg] = PART[leg](held)
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
  // A SESSION'S CLIF STEPPER IS A SECOND HANDLE, FREED AFTER IT UNDER THE SAME RULE AND IN ITS OWN `try`, so a session
  // that cannot be freed does not leak the stepper beside it.
  try {
    held?.clif?.session.free()
  } catch {
    /* As above. */
  }
}

/** Drop the live session's CLIF stepper, if it has one: nulled before freed, and freed in its own `try`, as above. */
function dropClif(): void {
  if (live === null) return
  const held = live.clif
  live.clif = null
  try {
    held?.session.free()
  } catch {
    /* As in `dropLive`: a stepper that cannot be freed is already unusable. */
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
  post: (reply, transfer = []) => ctx.postMessage(reply, transfer),
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

/** What each leg's recording steps: the session, and for CLIF the session's CLIF stepper. */
type HandleOf = { [K in CopyLeg]: Session } & { clif: ClifHandle }

/**
 * Each leg's pieces for `record-loop.ts`: a `Session`'s leg. Reached only through `onRun`'s `recordBuild`, `extend`
 * and `rewind` below (`extend`'s doc).
 */
const RECORDINGS: { readonly [K in Leg]: RecordLeg<K, HandleOf[K]> } = {
  // The λ leg's recording is what decides its value, where TM's and rxm's replay a run `compile` already finished,
  // whose allowance costs history alone.
  lambda: {
    leg: 'lambda',
    handle: (gen) => liveHandle(live, gen),
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
    handle: (gen) => liveHandle(live, gen),
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
    handle: (gen) => liveHandle(live, gen),
    available: (s) => s.tmStatus().available,
    frame: (s) => s.tmState(TM_RADIUS),
    bytes: LEG_FRAME_BYTES.tm,
    step: (s) => s.stepTm(),
    end: (s) => endOf(s.tmStatus().run),
    raise: (s) => s.raiseTmCap(EXTEND_STEPS, EXTEND_CELLS),
    rewind: (s) => s.rewindTm(),
  },
  // A STEPPER IS BUILT ONLY FROM A PROGRAM THE CLIF LEG CAN RUN, so a built one is available. Its cap counts
  // `EXTEND_STEPS` loop ticks rather than instructions, as the compiled program's own step cap does.
  clif: {
    leg: 'clif',
    handle: (gen) => (live?.gen === gen ? (live.clif?.session ?? null) : null),
    available: () => true,
    frame: (s) => s.state(CLIF_WINDOW),
    bytes: LEG_FRAME_BYTES.clif,
    step: (s) => s.step(),
    end: (s) => rxmRecordEnd(s.status()),
    raise: (s) => s.raiseCap(EXTEND_STEPS),
    rewind: (s) => s.rewind(),
  },
}

/**
 * `extendLeg` for `leg`, through its entry in `RECORDINGS`. **GENERIC IN THE LEG, AS `rewind` IS**, so the entry is
 * typed by the one leg `K` and handed on as such: no call passes a `RecordLeg` of the whole union, whose `leg` and
 * frames `tsc` would not tie together.
 */
function extend<K extends Leg>(leg: K, gen: number): Promise<boolean> {
  return extendLeg(RECORDINGS[leg], worker, gen)
}

/** `rewindAndRecord` for `leg`, holding a session's part first when its generation has posted no `result`. */
function rewind<K extends Leg>(leg: K, gen: number, toEpoch: number): Promise<void> {
  return rewindAndRecord(RECORDINGS[leg], worker, gen, toEpoch, () => {
    if (posted === null && live !== null) holdPart(leg, live)
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
 * `Unfinished`, and keep what it posted as `posted`. `onRun`, `onExtend` and the CLIF pass post here, `pinned` as the
 * session's `run` request carried a width.
 */
function postResult(gen: number, held: Live): void {
  const read: ResultLegs = {
    lambda: PART.lambda(held),
    rxm: PART.rxm(held),
    tm: PART.tm(held),
    // A STEPPER THAT THROWS AS IT IS READ COSTS THE `result` ITS CLIF PART ALONE: the other legs' parts are the
    // session's, which ran.
    clif: clifRead(gen, () => PART.clif(held)) ?? CLIF_ABSENT,
  }
  posted = keepDecided(posted, keepInFlight(posted ?? rewoundFrom, read, recording))
  ctx.postMessage({ kind: 'result', gen, legs: posted, pinned: held.pinned })
}

async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
  const result = resultToCome(req.gen)
  runResult = result
  await claimLive(claim, worker)

  // `compile` RUNS THE WHOLE TM LEG and is one uninterruptible call. Off the main thread that can only
  // delay the next result; it can never block input, highlighting or linting.
  const { diagnostics, session } = compile(req.src, req.encoding, req.width ?? null) as CompileResult
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
  live = { gen: req.gen, session, pinned: req.width !== undefined, clif: null }

  const lambda = session.lambdaStatus()
  const rxm = session.rxmStatus()
  const tm = session.tmStatus()
  const index = session.linkIndex(LAMBDA_BYTE_BUDGET)
  // GUARDED FOR `tmProgram`'s REASON BELOW: `rxmProgram` throws `RxmAbsent` for a program that does not lower.
  const rxmProgram = rxm.available ? session.rxmProgram() : null
  // GUARDED: `tmProgram` throws `TmAbsent` for a declined leg, and a throw lands in the listener's
  // `catch`, which drops the whole session.
  const tmProgram = tm.available ? session.tmProgram() : null
  // GUARDED FOR `tmProgram`'s REASON: `lambdaTree` throws for a declined λ leg.
  const lambdaTree = lambda.available ? session.lambdaTree(0, LAMBDA_TREE_NODES) : null
  // λ, THEN RXM, THEN TM (Plan 7 part 5 spec §5.4), `COPY_LEGS`' order, which is `LEG_NAME`'s less CLIF, which records
  // only while a CLIF view is shown. rxm is the cheapest leg per step, and TM's recording can run to its whole
  // `HISTORY_BYTES` before a leg after it starts; the λ leg stays first, since its recording is what decides its value.
  // `compiled` goes out with every leg's step 0 before any of them.
  await recordBuild(RECORDINGS, worker, req.gen, (first) =>
    ctx.postMessage(
      {
        kind: 'compiled',
        gen: req.gen,
        statuses: { lambda, rxm, tm, clif: clifCompileStatus(rxm, req.clif) },
        programs: {
          rxm: rxmProgram === null ? null : { program: rxmProgram },
          // A COMPILE BUILDS NO CLIF LISTING: a CLIF view is handed one once its stepper is built.
          clif: null,
          tm: tmProgram === null ? null : { program: tmProgram, tapeNames: tapeNames() as string[] },
        },
        declinedSpan: declinedSourceSpan(session, lambda),
        linkIndex: index,
        first,
        lambdaTree,
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
        ...(lambdaTree === null ? [] : treeBuffers(lambdaTree)),
      ],
    ),
  )

  // Deliberate silence: superseded while recording ran. The generation that wanted this result is gone.
  if (live?.gen !== req.gen) return
  postResult(req.gen, live)
  result.settle()
  // AFTER THE RESULT, NOT BESIDE THE OTHER LEGS: nothing the other legs or the result do waits on the CLIF pass.
  if (req.clif !== null) await recordClif(req.gen, 0, req.clif)
}

/**
 * The live session, when it is still `gen`'s and the CLIF leg still at `epoch`; else `null`, and the CLIF pass that
 * asks has been replaced: by a newer run, which dropped this session, or by a newer CLIF request.
 */
function clifOwner(gen: number, epoch: number): Live | null {
  return live?.gen === gen && worker.epoch.clif === epoch ? live : null
}

/**
 * The CLIF pass: load `pkg-clif`, build a stepper of `listing` from the live session's `clifInput()`, post the
 * listing, record the leg from step 0 under `epoch`, then post a `result` that carries its part.
 *
 * **EVERY AWAIT IS FOLLOWED BY `clifOwner`**, since a newer run or CLIF request can be dispatched at any of them: a
 * pass that went on would build from, and record into, a generation it does not own. **A LOAD OR A BUILD THAT FAILS
 * POSTS ITS TEXT, NOT A `worker-error`**, which would drop a session whose other legs ran.
 */
async function recordClif(gen: number, epoch: number, listing: Listing): Promise<void> {
  const clif = await loadClifAndSay()
  if (clif === null) return
  const held = clifOwner(gen, epoch)
  if (held === null) return
  const input = held.session.clifInput()
  if (input === null) {
    ctx.postMessage({ kind: 'clif-listing', gen, epoch, listing: null, error: held.session.rxmStatus().reason })
    return
  }
  let stepper: ClifHandle
  try {
    stepper = new clif.ClifSession(input, listing)
  } catch (e) {
    // `ClifSession` throws its sentence as a string, not an `Error`.
    ctx.postMessage({ kind: 'clif-listing', gen, epoch, listing: null, error: String(e) })
    return
  }
  held.clif = { session: stepper, listing }
  const rows = clifRead(gen, () => stepper.listing())
  if (rows === null) return
  ctx.postMessage({ kind: 'clif-listing', gen, epoch, listing: rows, level: listing, error: null })
  if ((await clifRecorded(gen, () => recordFresh(RECORDINGS.clif, worker, gen, epoch))) === null) return
  const after = clifOwner(gen, epoch)
  if (after === null) return
  postResult(gen, after)
}

/**
 * `record`, a recording of generation `gen`'s CLIF leg, or `null` once its stepper has thrown, which `clifThrew` is
 * then told.
 */
async function clifRecorded<T>(gen: number, record: () => Promise<T>): Promise<T | null> {
  try {
    return await record()
  } catch (e) {
    clifThrew(gen, e)
    return null
  }
}

/** `clifRecorded` for a `read` of generation `gen`'s CLIF stepper that records nothing: its listing, or its part. */
function clifRead<T>(gen: number, read: () => T): T | null {
  try {
    return read()
  } catch (e) {
    clifThrew(gen, e)
    return null
  }
}

/**
 * Generation `gen`'s CLIF stepper threw `thrown`. **A STEPPER THAT THROWS IS DROPPED, AND THE CLIF VIEW SAYS WHY**, as
 * for a build that fails: left to the listener's `catch`, the throw would be a `worker-error`, which drops a session
 * whose other legs ran. **EVERY CALL ON A STEPPER BUT ITS `free` IS MADE UNDER `clifRecorded` OR `clifRead`**, so no
 * call on one reaches that `catch`. **ITS PART OF THE LAST `result` GOES WITH IT**, as for a `clif` request: a
 * `result` read while a loop is still in flight on the stepper keeps the leg's last part (`keepInFlight`), which
 * would say the stepper dropped here is still running.
 */
function clifThrew(gen: number, thrown: unknown): void {
  dropClif()
  if (posted !== null) posted = { ...posted, clif: CLIF_ABSENT }
  const error = thrown instanceof Error ? thrown.message : String(thrown)
  ctx.postMessage({ kind: 'clif-listing', gen, epoch: epoch.clif, listing: null, error })
}

/**
 * `pkg-clif`, loaded or already in, said to the page as a `clif-load`; `null` once a failure is said. **A FAILURE IS
 * CAUGHT HERE, NEVER THROWN**: the listener's `catch` would make it a `worker-error`, which drops the session.
 */
async function loadClifAndSay(): Promise<ClifModule | null> {
  // **A LOAD THAT FETCHES SAYS SO AS IT STARTS**, so the page says it is loading only while one is under way.
  if (!clifIn) ctx.postMessage({ kind: 'clif-load', state: 'loading' })
  let clif: ClifModule
  try {
    clif = await loadClif()
  } catch (e) {
    ctx.postMessage({ kind: 'clif-load', state: 'failed', error: String(e) })
    return null
  }
  clifIn = true
  ctx.postMessage({ kind: 'clif-load', state: 'ready' })
  return clif
}

/** Whether `pkg-clif` is in, after which a load fetches nothing and says nothing of loading. */
let clifIn = false

/**
 * Build generation `gen`'s CLIF stepper again for another listing, or drop it (the request's doc in `protocol.ts`).
 * **THE EPOCH IS RAISED AND THE STEPPER DROPPED AT ONCE**, so a loop in flight on the old stepper stops at its next
 * chunk and an `extend` of the new epoch finds nothing to step; the flag is cleared for the new loop, as a rewind
 * clears it. **THE BUILD WAITS FOR THE RUN'S `result`**, and `runResult` is that run's while its session is live: the
 * next `run` replaces it and drops the session before this thread reads another request. **AND FOR THE GENERATION'S
 * `mc` REQUESTS TAKEN BEFORE IT** (`onMc`).
 */
async function onClif(req: Extract<RunRequest, { kind: 'clif' }>): Promise<void> {
  if (live?.gen !== req.gen || req.epoch <= epoch.clif) return
  epoch.clif = req.epoch
  recording.clif = false
  dropClif()
  // THE PART THE LAST `result` POSTED IS THE OLD STEPPER'S, and `keepDecided` would answer the new stepper's unfinished
  // fill with it: another listing's end, and its count of steps.
  if (posted !== null) posted = { ...posted, clif: CLIF_ABSENT }
  if (req.listing === null) return
  // READ NOW, as the request is taken: the `mc` requests the page posted before this one, ahead of a listing switch.
  const mcBefore = mcTaken.gen === req.gen ? mcTaken.done : null
  await runResult.posted
  if (mcBefore !== null) await mcBefore
  await recordClif(req.gen, req.epoch, req.listing)
}

async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<void> {
  // Deliberate silence: the generation being extended is not the live one anymore (superseded by a
  // later `run`, or there was never a session for it).
  if (live?.gen !== req.gen) return
  // Deliberate silence, and a state the page cannot reach: it raises a leg's epoch only as it posts a `rewind` or a
  // `clif` request, and this thread takes messages in order, so no `extend` of an older epoch arrives after the
  // request that replaced it. Checked as the generation is, so that a stale request records nothing whoever posts
  // it, as `tests/browser/worker.test.ts` does.
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

  // Written before `extend` asks whether the leg can record: harmless for a leg that never records, and asking first
  // would ask `extend`'s question twice.
  const ran =
    req.leg === 'clif'
      ? ((await clifRecorded(req.gen, () => extend('clif', req.gen))) ?? false)
      : await extend(req.leg, req.gen)
  // A SUPPRESSED CALL MUST NOT POST A RESULT. `ran === false` is a CLIF leg with no stepper, a leg that did not
  // compile, or a loop already in flight for this leg, which owns it — that loop posts its own frames, and its caller
  // any `result`, when it finishes. Posting one here too would answer with whatever partial state that other loop had
  // reached at this instant, then let the real loop's caller post a second, later `result` for the same generation
  // (the two rapid `extend`s, e.g. a double-click before the UI disables the affordance, this exists to guard).
  // `true` from a loop a rewind cut short posts one, which keeps the rewound leg's last part (`keepInFlight`).
  if (!ran) return

  // Deliberate silence: superseded while recording ran, same as `onRun`'s post-record check.
  if (live?.gen !== req.gen) return
  postResult(req.gen, live)
}

/**
 * Take one leg back to step 0 and record its first fill again, under the epoch the request carries (hidden-recording
 * spec §5.4): the `rewind` the page posts when ↺ finds the leg's step 0 dropped from its ring.
 *
 * **A STALE GENERATION, A CLIF LEG WITH NO STEPPER, OR A LEG THAT DID NOT COMPILE ANSWERS NOTHING**, the questions
 * the leg's `handle` and `available` ask: a `Session`'s rewind throws for an absent leg, and a throw drops the session.
 * **NOR DOES AN EPOCH NO NEWER THAN THE LEG'S**: the loop in flight would not stop, and two loops would step a cursor.
 *
 * **THE LOOP IN FLIGHT IS LEFT TO RETURN, NOT AWAITED.** The raised epoch stops it at its next chunk, and it leaves
 * the flag, cleared here, to the new loop. **NO `result` OF ITS OWN** (spec §5.2): one posted while this fill records
 * keeps the leg's last part, read here first if none was posted (`keepInFlight`), and later its decided value.
 */
async function onRewind(req: Extract<RunRequest, { kind: 'rewind' }>): Promise<void> {
  if (req.leg === 'clif') await clifRecorded(req.gen, () => rewind('clif', req.gen, req.epoch))
  else await rewind(req.leg, req.gen, req.epoch)
}

/**
 * Answer one `lambda-tree` request, synchronously, between record chunks (Plan 7 part 4 spec §4.1).
 *
 * **NOT A CLAIM ON `latest`.** A tree is a question about what a `run` built, not a new build, so it supersedes
 * nothing; a request for a generation that is no longer live is dropped, as a stale record loop's frames are.
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
  const held = liveHandle(live, req.gen)
  if (held === null || !held.lambdaStatus().available) return
  const tree = held.lambdaTree(req.step, req.budget)
  ctx.postMessage({ kind: 'lambda-tree', gen: req.gen, tree }, treeBuffers(tree))
}

/** A tree's columns, which a post transfers: `tree_to_js` copies each into its own buffer, which nothing here reads. */
function treeBuffers(tree: LambdaTreeWire): Transferable[] {
  return [tree.kind.buffer, tree.left.buffer, tree.right.buffer, tree.name.buffer, tree.hint.buffer, tree.link.buffer]
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
      case 'extend':
        await onExtend(req)
        break
      case 'rewind':
        await onRewind(req)
        break
      case 'lambda-tree':
        onLambdaTree(req)
        break
      case 'clif-load':
        await loadClifAndSay()
        break
      case 'clif':
        await onClif(req)
        break
      case 'mc-load':
        await loadMcAndSay(req.target)
        break
      case 'mc':
        await onMc(req)
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
