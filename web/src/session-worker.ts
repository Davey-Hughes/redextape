/**
 * The worker that owns the `Session`.
 *
 * THE HANDLE CANNOT LEAVE THIS THREAD. `Session` is an opaque wasm-bindgen object with no serialized
 * form, so the worker owns it and answers questions about it rather than handing it over. That is
 * also why the module's FREE functions are not here: they take no session, so there is nothing for a
 * worker to own, and a round trip to reach one would be lag bought for nothing. This paragraph named
 * `classifySource` and `analyze` as the pair and said the editor called them on every keystroke.
 * Neither half survives: `analyze` has had no web caller since diagnostics became a push from the LSP
 * worker, and `classifySource` was deleted with the decoration path it fed (Plan 7 part 3b — the
 * editors colour from tree-sitter grammars now, on the main thread, out of `colour.ts`). What the main
 * thread still calls straight through is `captureClasses`, `encodings` and `tokenClasses`, each once at
 * start-up rather than per keystroke.
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
 * PLAN T5 SAID THIS FILE WAS NOT TO BE EDITED AND T8 LIFTS THAT, for the reason T7 recorded
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
import init, { asmScratch, compile, lambdaScratchAt, tapeNames, tmScratch } from '../../pkg/redextape_wasm.js'
import { LEGS, perLeg, unhandled } from './legs'
import type { LinkIndexWire } from './link'
import type { AsmLeg, LambdaLeg, LambdaTreeWire, Leg, RunReply, RunRequest, TmLeg } from './protocol'
import {
  ASM_WINDOW,
  asmFrameBytes,
  asmRecordEnd,
  EXTEND_CELLS,
  EXTEND_STEPS,
  endOf,
  FRAME_BYTES,
  forkable,
  HISTORY_BYTES,
  LAMBDA_BYTE_BUDGET,
  lambdaFrameBytes,
  TM_RADIUS,
  tmFrameBytes,
  VALUE_CHUNK,
} from './protocol'
import { type RecordLeg, type RecordWorker, recordLeg } from './record-loop'
import type {
  AsmProgram,
  AsmState,
  AsmStatus,
  AsmWindow,
  Decoded,
  Diagnostic,
  LambdaState,
  LambdaStatus,
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
  tmStatus(): TmStatus
  tmProgram(): TmProgram
  tmState(radius: number): TmState
  stepTm(): boolean
  raiseTmCap(extraSteps: number, extraCells: number): void
  tmValue(): Decoded
  asmStatus(): AsmStatus
  asmProgram(): AsmProgram
  asmState(window: AsmWindow): AsmState
  stepAsm(): boolean
  raiseAsmCap(extraSteps: number): void
  asmValue(): Decoded
  sourceSpan(node: number): Span | null
  linkIndex(byteBudget: number): LinkIndexWire
  /**
   * `null` is load-bearing here, unlike every other claim in this type: it is how the app learns a
   * machine is over `MAX_FORK_RULES` or its TM leg declined, not a stand-in for "value not yet known".
   * A caller that coalesced it away with `??` would silently paper over that boundary regression — so
   * `onRun` below reads it and passes it through unchanged, never through `??`.
   */
  tmText(): string | null
  /**
   * Whether `tmText` would ever be non-`null` for this session — `false` only for a function-valued
   * program. Read unconditionally, like `asmText`, not behind `forkable`'s guard: it answers a question
   * about the program's TYPE, not about `tmProgram`'s size, so it holds even when `tmText` itself was
   * never asked for.
   */
  tmResultDecodable(): boolean
  /**
   * `null` for a program with no asm leg, and for one whose text is longer than `session.rs`'s
   * `MAX_SCRATCH_ASM_BYTES`, which no copy could build. Never a throw: `onRun` reads it unguarded and passes it
   * through unchanged, as it does `tmText`.
   */
  asmText(): string | null
  free(): void
}

/**
 * The wasm-bindgen `LambdaScratch`, described structurally for the reason `Session` above is — and it
 * is a STRICT SUBSET of `Session`'s λ half, which is design §3.3's table as a type.
 *
 * THE SIX λ METHODS TRANSPLANT UNCHANGED (§3.3: "nothing but the λ cursor"), so `LAMBDA_RECORDING` below
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
  lambdaTree(step: number, nodeBudget: number): LambdaTreeWire
  raiseLambdaCap(extra: number): void
  free(): void
}

/**
 * The wasm-bindgen `TmScratch`, described structurally for the reason `Session` above is — and it is
 * `Session`'s TM half with `tmValue` gone, mirroring `LambdaScratchHandle` one type up.
 *
 * `tmStatus` RETURNS `TmScratchStatus`, NOT `TmStatus` — a different wire shape, not a narrower read of
 * the same one; see that type's own doc in `types.ts`. `tmProgram` HAS NO ABSENT-LEG CASE HERE, UNLIKE
 * `Session.tmProgram`'s caller-side guard in `onRun`: `session.rs`'s own doc on `TmScratch::tm_program`
 * says so directly — there is no declined leg for a scratch to have declined.
 *
 * NO `tmValue`, `sourceSpan`, OR `linkIndex`, for decision 2's reason: a `TmScratch` has no `ty`, no
 * lowering and no `SourceMap`. `tmLeg` below is exactly the function that reaches for the first of
 * those, which is why it is never called for a scratch — see `onTmScratch`.
 */
type TmScratchHandle = {
  tmStatus(): TmScratchStatus
  tmProgram(): TmProgram
  tapeNames(): string[]
  stepTm(): boolean
  tmState(radius: number): TmState
  raiseTmCap(extraSteps: number, extraCells: number): void
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
 * The wasm-bindgen `AsmScratch`, described structurally for the reason `Session` above is: the asm leg's six methods.
 * A copy's asm leg answers every one of them as a session's does (`session.rs`'s `AsmScratch`), so `ASM_RECORDING`
 * and `onExtend`'s asm arm call it as they call a session. No `asmText`, since a copy offers no copy of itself, and
 * no `sourceSpan` or `linkIndex`: a copy has no `SourceMap`.
 */
type AsmScratchHandle = {
  asmStatus(): AsmStatus
  asmProgram(): AsmProgram
  asmState(window: AsmWindow): AsmState
  stepAsm(): boolean
  raiseAsmCap(extraSteps: number): void
  asmValue(): Decoded
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
 * `tmScratch(src)`'s hand-built object — a handle and plain data, the same assembly `lib.rs` gives
 * `compile` and `lambdaScratchAt` and for the identical reason.
 *
 * NO `text` FIELD, UNLIKE `ForkedAtResult`. `tmScratch` never echoes the source: the main thread SENT
 * `src` and already holds it — see `tm-scratch-compiled`'s doc in `protocol.ts`.
 */
type TmScratchResult = { diagnostics: Diagnostic[]; scratch: TmScratchHandle | null; value: TmValueRunHandle | null }

/**
 * `asmScratch(src)`'s hand-built object: `scratch` is `null` for text that does not parse, is over
 * `MAX_SCRATCH_ASM_BYTES`, or has a label mistake, and the diagnostics name which.
 */
type AsmScratchResult = { diagnostics: Diagnostic[]; scratch: AsmScratchHandle | null }

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
 * **A DISCRIMINATED UNION, AND IT IS STILL ONE OCCUPANT.** `kind` says which wasm type this thread is
 * holding; the field is `session` in every arm because that is what a record loop steps, λ, TM or asm
 * (§3.3, §4.4). The invariant §4.2 rests on is about the CARDINALITY of this binding, which is one, not
 * about the type of what is in it — `dropLive` empties it before anything else is built, exactly as
 * before.
 *
 * `kind` RATHER THAN A `tm`-SHAPED DUCK TEST (`'tmStatus' in live.session`). A tag is what makes the
 * checker refuse `live.session.tmStatus()` on the `lambda-scratch` arm at every call site rather than
 * only at the ones somebody remembered to guard — and, since 5d-iv T4, the mirror image on the
 * `tm-scratch` arm for `live.session.lambdaStatus()` — and §3.3's whole method split is a compile-time
 * claim, a runtime probe would restate it as a convention.
 *
 * **A THIRD ARM, THEN A FOURTH, AND EVERY LEG NOW ASKS WHAT KIND OF THING IS LIVE, WHERE ONLY THE TM
 * LEG USED TO.** `TmScratchHandle` carries the TM methods the TM leg's recording calls but none of
 * the λ ones the λ leg's does — the reverse of `LambdaScratchHandle` — so the asymmetry that used
 * to read "the λ methods exist on both wasm types and the TM ones exist only on `Session`" no longer
 * holds in either direction, and `AsmScratchHandle` carries the asm leg's alone. See each leg's `handle`
 * (`LAMBDA_RECORDING`, `TM_RECORDING`, `ASM_RECORDING`).
 */
type Live =
  | { gen: number; kind: 'session'; session: Session }
  | { gen: number; kind: 'lambda-scratch'; session: LambdaScratchHandle }
  | { gen: number; kind: 'tm-scratch'; session: TmScratchHandle; value: TmValueRunHandle | null }
  | { gen: number; kind: 'asm-scratch'; session: AsmScratchHandle }

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
 * `await recordTm` is still in flight, once the λ leg has already posted its `budget` stop.
 */
const recording: Record<Leg, boolean> = perLeg(() => false)

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
  // THE VALUE RUN IS A SECOND HANDLE, FREED UNDER THE SAME RULE AND IN ITS OWN `try`, so a scratch that cannot be
  // freed does not leak the run beside it.
  try {
    if (held?.kind === 'tm-scratch') held.value?.free()
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
 * What `recordLeg` needs of this thread: the books and flags above, whether a generation still owns what is live, and
 * this thread's post and yield.
 */
const worker: RecordWorker = {
  recording,
  recorded,
  allowance,
  owns: (gen) => live?.gen === gen,
  post: (reply) => ctx.postMessage(reply),
  yieldToEventLoop,
}

/**
 * The λ leg's pieces for `recordLeg`: a `Session`'s λ leg or a `LambdaScratch`'s, which carry the same λ methods.
 *
 * **ITS `handle` ASKS WHAT KIND OF THING IS LIVE, WHICH IT DID NOT UNTIL `TmScratchHandle` EXISTED.** The λ methods
 * used to exist on both occupants of `live`, so the union of their return types called cleanly with no guard. A
 * `TmScratch` has none of them — see `onTmScratch`, which never records this leg — and nor has an asm copy, so the
 * occupants with no λ leg need the same kind of exclusion the TM leg has always needed for the opposite reason.
 *
 * **ON THIS LEG, SPENDING THE ALLOWANCE COSTS THE ANSWER.** The λ leg's recording is what decides its value, where
 * TM's and asm's replay a run `compile` already finished, whose allowance costs history alone.
 */
const LAMBDA_RECORDING: RecordLeg<Session | LambdaScratchHandle, LambdaState> = {
  leg: 'lambda',
  handle: (gen) => {
    // Deliberate silence: the caller's generation is stale, so there is nothing to record for it — not the
    // accidental kind this file shipped once before.
    if (live?.gen !== gen) return null
    switch (live.kind) {
      case 'session':
      case 'lambda-scratch':
        return live.session
      case 'tm-scratch':
      case 'asm-scratch':
        // Deliberate silence, and a state no caller can currently reach: a TM or asm copy has no λ leg to record (§4.1 —
        // one leg apiece), and each session has its own worker, so nothing posts a `run` and a copy's build to the SAME
        // thread. Written as an arm for `TM_RECORDING`'s reason, stated there in full.
        return null
    }
  },
  available: (s) => s.lambdaStatus().available,
  frame: (s) => s.lambdaState(FRAME_BYTES),
  bytes: lambdaFrameBytes,
  step: (s) => s.stepLambda(),
  end: (s) => endOf(s.lambdaStatus().run),
  reply: (gen, frames, done) => ({ kind: 'lambda-frames', gen, frames, done }),
}

/**
 * The TM leg's pieces for `recordLeg`: a `Session`'s TM leg or a `TmScratch`'s.
 *
 * **ITS `handle` ADMITS TWO KINDS.** §3.3's table used to say the TM methods exist only on `Session`; `TmScratchHandle`
 * now carries them too, so this leg admits a second kind rather than naming exactly one — see `LAMBDA_RECORDING` for
 * the guard the λ leg gained in the same commit, for the opposite exclusion.
 */
const TM_RECORDING: RecordLeg<Session | TmScratchHandle, TmState> = {
  leg: 'tm',
  handle: (gen) => {
    if (live?.gen !== gen) return null
    // THE `kind` HALF IS THE TYPE RESTATING THE `gen` HALF. Replacing what is live always claims a new generation
    // (`onRun`, `onLambdaScratch`, `onTmScratch` and `onAsmScratch` all set `latest` before building), so a live thing
    // that has become a λ or asm copy — the kinds with no TM leg — is already a live thing with a different `gen`. The
    // checker cannot see that implication, and this is where it is written down rather than cast away.
    switch (live.kind) {
      case 'session':
      case 'tm-scratch':
        return live.session
      case 'lambda-scratch':
      case 'asm-scratch':
        // Deliberate silence, and a state no caller can currently reach: a λ or asm copy has no TM leg to record
        // (§4.1 — one leg apiece), and each session has its own worker, so nothing posts a `run` and a copy's build to
        // the SAME thread. Written as an arm rather than an assertion because the one-live-session invariant is a
        // property of this file and must not become a property of who calls it: the day a caller does mix them, the
        // honest answer is "there is no TM leg here", not a throw from wasm about a method that does not exist.
        return null
    }
  },
  available: (s) => s.tmStatus().available,
  frame: (s) => s.tmState(TM_RADIUS),
  bytes: tmFrameBytes,
  step: (s) => s.stepTm(),
  end: (s) => endOf(s.tmStatus().run),
  reply: (gen, frames, done) => ({ kind: 'tm-frames', gen, frames, done }),
}

/**
 * The asm leg's pieces for `recordLeg`: a `Session`'s asm leg or an asm copy's, which carry the same asm methods.
 *
 * **LIKE TM'S, A REPLAY OF A RUN WHOSE ANSWER IS KNOWN.** `compile` drove a cursor over the program to its end (spec
 * amendment 13), so exhausting this leg's allowance costs history, not the value. Its end is `asmRecordEnd`'s, which
 * names a full cap where `endOf` has none to name.
 */
const ASM_RECORDING: RecordLeg<Session | AsmScratchHandle, AsmState> = {
  leg: 'asm',
  handle: (gen) => {
    if (live?.gen !== gen) return null
    switch (live.kind) {
      case 'session':
      case 'asm-scratch':
        return live.session
      case 'lambda-scratch':
      case 'tm-scratch':
        // A λ or TM copy has no asm leg, for `TM_RECORDING`'s reason.
        return null
    }
  },
  available: (s) => s.asmStatus().available,
  frame: (s) => s.asmState(ASM_WINDOW),
  bytes: asmFrameBytes,
  step: (s) => s.stepAsm(),
  end: (s) => asmRecordEnd(s.asmStatus()),
  reply: (gen, frames, done) => ({ kind: 'asm-frames', gen, frames, done }),
}

/** Record the λ leg — `recordLeg`'s doc has the contract, and its answer is `recordLeg`'s. */
function recordLambda(gen: number, emitInitial: boolean): Promise<boolean> {
  return recordLeg(LAMBDA_RECORDING, worker, gen, emitInitial)
}

/** Record the TM leg, as `recordLambda` records the λ leg. */
function recordTm(gen: number, emitInitial: boolean): Promise<boolean> {
  return recordLeg(TM_RECORDING, worker, gen, emitInitial)
}

/** Record the asm leg, as `recordLambda` records the λ leg. */
function recordAsm(gen: number, emitInitial: boolean): Promise<boolean> {
  return recordLeg(ASM_RECORDING, worker, gen, emitInitial)
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

function asmLeg(session: Session): AsmLeg {
  const status = session.asmStatus()
  if (!status.available) return { status, value: null }
  return { status, value: session.asmValue() }
}

async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
  await ready
  // FREED BEFORE THE NEXT COMPILE, not after. Two `Session` handles are never simultaneously live.
  dropLive()
  for (const leg of LEGS) {
    recorded[leg] = 0
    allowance[leg] = HISTORY_BYTES
    // GENERATION-SCOPED BY RESET, not by the flag's own type. `recording` exists to stop two loops
    // stepping ONE cursor; a loop belonging to a superseded generation is not competing for this
    // session and must not hold a flag against it. Safe here because `onRun`'s synchronous prefix can
    // only run once any prior loop has yielded, so no loop is mid-step when this executes — and a
    // stale loop that resumes afterwards returns at its own `live?.gen !== gen` check without
    // touching the flag it no longer owns.
    recording[leg] = false
  }

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
  const asm = session.asmStatus()
  const tm = session.tmStatus()
  const index = session.linkIndex(LAMBDA_BYTE_BUDGET)
  // GUARDED FOR `tmProgram`'s REASON BELOW: `asmProgram` throws `AsmAbsent` for a program that does not lower.
  const asmProgram = asm.available ? session.asmProgram() : null
  // GUARDED: `tmProgram` throws `TmAbsent` for a declined leg, and a thrown error inside this
  // async handler rejects it with nothing catching — no reply, and a caller that waits forever.
  // That is exactly the shape of the defect PR 3c's browser tier caught in `drive`.
  const tmProgram = tm.available ? session.tmProgram() : null
  // THE GATE, AND THE ONLY LOGIC IN THIS FILE THAT IS NOT A WASM CALL — `forkable` is imported from
  // `protocol.ts` precisely so it is not written here, where the coverage gate cannot see it.
  const tmText = forkable(tmProgram) ? session.tmText() : null
  // UNGUARDED, LIKE `asmText` BELOW: a fact about the program's type, answerable whether or not
  // `tmText` itself was ever asked for — see this method's own doc on the worker's `Session` type.
  const tmResultDecodable = session.tmResultDecodable()
  // UNGUARDED, WHERE `asmProgram` ABOVE IS GUARDED: `asmText` answers `null` itself for a declined leg and for text
  // over the copy ceiling, and cannot throw. Passed through unchanged, never through `??`, for `tmText`'s reason.
  const asmText = session.asmText()
  ctx.postMessage(
    {
      kind: 'compiled',
      gen: req.gen,
      lambda,
      asm,
      tm,
      declinedSpan: declinedSourceSpan(session, lambda),
      tmProgram,
      asmProgram,
      tapeNames: tapeNames() as string[],
      linkIndex: index,
      tmText,
      tmResultDecodable,
      asmText,
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
      index.asmOwner.buffer,
    ],
  )

  // λ, THEN ASM, THEN TM (spec §5.4). asm is the cheapest leg per step, and TM's recording can run to its whole
  // `HISTORY_BYTES` before a leg after it starts; the λ leg stays first, since its recording is what decides its value.
  await recordLambda(req.gen, true)
  await recordAsm(req.gen, true)
  await recordTm(req.gen, true)

  // Deliberate silence: superseded while recording ran. The generation that wanted this result is gone.
  // The `kind` half is the type restating the `gen` half — see `TM_RECORDING`'s `handle` for the argument.
  if (live?.gen !== req.gen || live.kind !== 'session') return
  ctx.postMessage({
    kind: 'result',
    gen: req.gen,
    lambda: lambdaLeg(live.session),
    asm: asmLeg(live.session),
    tm: tmLeg(live.session),
  })
}

/**
 * Build a λ scratchpad from λ TEXT and record its reduction — design §4.3's fork, arriving on this
 * thread as `lambda-scratch`.
 *
 * **THE SAME PROLOGUE AS `onRun`, AND THAT IS THE INVARIANT RATHER THAN A COPY.** `dropLive` first,
 * then the byte counters, then the `recording` flags: whatever this thread was holding is freed
 * BEFORE anything new is built, so the two-handle window stays strictly zero for a scratch exactly as
 * it does for a session (§4.2, and this module's own doc). Factoring the reset into a shared `reset()`
 * was considered and refused while it was six lines, and a loop over `LEGS` changes nothing about why:
 * it would read as bookkeeping, when what it actually is is the one place the invariant is enforced,
 * and the two callers must be seen to enforce it.
 *
 * NO `linkIndex`, NO `tmProgram`, NO `tapeNames` IN THE REPLY, and no `result` after it. All four read
 * something §3.3 puts off this type (`self.map`, the TM leg, `self.ty`), which is why the reply is
 * `scratch-compiled` and not `compiled` — see that variant's doc for why five nulls would have been
 * the wrong shape.
 *
 * IT DOES NOT `await recordTm`. A `LambdaScratch` has one leg; `recordTm` would answer `false` at its
 * leg's `kind` guard (`TM_RECORDING`'s `handle`), and calling it to be told so would be a line asserting
 * the absence rather than respecting it.
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
  for (const leg of LEGS) {
    recorded[leg] = 0
    allowance[leg] = HISTORY_BYTES
    recording[leg] = false
  }

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
  // `diagnostics` on a non-null `scratch` come from a parse that built a term — of its own printed
  // output past step 0 (`lambda/syntax.rs`'s round-trip guarantee), of `src` at step 0 — and
  // `parse_lambda` answers a term with no diagnostic beside it, so they are always empty there. The
  // case that genuinely carries them is the `scratch: null` arm above. Posting an always-empty array
  // on a message the app receives per fork would be a field with no reader.
  ctx.postMessage({ kind: 'scratch-compiled', gen: req.gen, lambda: scratch.lambdaStatus(), text })
  await recordLambda(req.gen, true)
}

/**
 * Build a `TmScratch` from `.tm` text and record its run — `onLambdaScratch`'s counterpart, arriving on
 * this thread as `tm-scratch` (design §4.4, plan 5d-iv T4).
 *
 * **THE SAME PROLOGUE AS `onRun`/`onLambdaScratch`, AND THAT IS THE INVARIANT RATHER THAN A COPY** —
 * see `onLambdaScratch`'s own doc for the argument; it applies here unchanged.
 *
 * NO `linkIndex` AND NO `result` AFTER IT, for `onLambdaScratch`'s reasons: both read something a scratch type
 * does not have. It DOES post a `tmProgram`, which is where the two differ — a `TmScratch` has a machine and a
 * `LambdaScratch` has none — and its own `tapeNames`, per scratch rather than the fixed export `onRun` posts,
 * because a reduced file's single-tape stage changes what its one tape is. A file with a header then hears
 * `tm-value` after every chunk of `runValueLoop`, in place of the `result` a compiled session gets.
 *
 * IT DOES NOT `await recordLambda`. A `TmScratch` has one leg; calling it to be told so at its own
 * `kind` guard would be a line asserting the absence rather than respecting it. IT DOES `await
 * recordTm`, WHICH THE TM LEG'S WIDENED GUARD (`TM_RECORDING`'s `handle`) IS WHAT MAKES CORRECT — when
 * that guard refused every `kind` but `'session'`, this call would have silently recorded nothing.
 *
 * **DIAGNOSTICS ARE DROPPED ON THE SUCCESS PATH, LIKE `onLambdaScratch`'s — BUT CHECKED HERE RATHER
 * THAN ASSUMED, AND FOR A DIFFERENT REASON.** `onLambdaScratch`'s diagnostics on a non-null scratch are
 * always empty because `parse_lambda` answers a term with no diagnostic beside it. This scratch's come
 * from parsing text a USER typed, which looks like the ordinary case a `diagnostics` reply should ride
 * — except `redextape-core`'s `tm::parse_tm_full` pushes every diagnostic through one constructor that
 * hard-codes `Severity::Error`, and its own gate refuses to build a `Machine` at all once any diagnostic
 * exists (`if diags.iter().any(|d| d.severity == Severity::Error) { return (None, None, diags) }`) — so
 * a non-null `scratch` and a non-empty `diagnostics` list are not two independent facts of this parser;
 * the second is always empty whenever the first is true. There is also no `diagnostics` reply on the
 * wire for a success path to ride: `RunReply` names `no-session` for a failed parse and nothing else
 * carries diagnostics. A headerless file is real and ordinary, but it is not a diagnostic — it is
 * `tm.header: false` on the status this reply already carries (design decision 6), which is why the
 * pane has what it needs without one.
 */
async function onTmScratch(req: Extract<RunRequest, { kind: 'tm-scratch' }>): Promise<void> {
  await ready
  dropLive()
  for (const leg of LEGS) {
    recorded[leg] = 0
    allowance[leg] = HISTORY_BYTES
    recording[leg] = false
  }

  const { diagnostics, scratch, value } = tmScratch(req.src) as TmScratchResult
  if (scratch === null) {
    ctx.postMessage({ kind: 'no-session', gen: req.gen, diagnostics })
    return
  }
  // Deliberate silence: a newer request landed while `tmScratch` (uninterruptible) was in flight. This
  // scratch was never posted anywhere, so freeing it and returning is the whole cleanup — the same
  // reasoning `onRun` and `onLambdaScratch` give for the handle each discards on the same race.
  if (latest !== req.gen) {
    scratch.free()
    value?.free()
    return
  }
  live = { gen: req.gen, kind: 'tm-scratch', session: scratch, value }

  ctx.postMessage({
    kind: 'tm-scratch-compiled',
    gen: req.gen,
    tm: scratch.tmStatus(),
    tmProgram: scratch.tmProgram(),
    tapeNames: scratch.tapeNames(),
  })
  await recordTm(req.gen, true)
  await runValueLoop(req.gen)
}

/**
 * Run a TM buffer's value run out in `VALUE_CHUNK` steps at a time, posting where it stands after each chunk.
 *
 * **AFTER THE FIRST RECORDING, NOT BESIDE IT.** Frames are what the pane draws first, so the first recording runs
 * before this loop starts. A `[continue]` that arrives while this loop is going is dispatched at its next yield: the
 * message listener starts `onExtend`, whose `recordTm` then takes turns with this loop, one `RECORD_CHUNK` of frames
 * against one `VALUE_CHUNK` of steps, each run whole between yields. The two step different cursors — `recordTm`
 * the scratch's own through `stepTm`, this loop the `TmValueRun` beside it — so taking turns delays each by the
 * other's chunk and changes neither's result.
 *
 * **EVERY CHUNK STARTS WITH A GUARD LIKE THE TM LEG'S** (`TM_RECORDING`'s `handle`, which `recordLeg` asks before
 * every chunk), reading `live` rather than a captured handle, so an edit that replaced the scratch, or freed it, ends
 * this loop at its next chunk rather than stepping a freed run.
 *
 * **NO RE-ENTRY FLAG, BECAUSE A BUILD IS A GENERATION.** `onTmScratch` is the only caller and starts one loop per
 * build, and every build claims a new generation (`SessionClient.supersede` on the main thread, `latest = req.gen`
 * here), so one loop per build is one loop per run. A loop left over from an earlier build meets the guard above
 * at its next chunk and returns without stepping or posting.
 */
async function runValueLoop(gen: number): Promise<void> {
  for (;;) {
    if (live?.gen !== gen || live.kind !== 'tm-scratch' || live.value === null) return
    const run = live.value.run(VALUE_CHUNK)
    ctx.postMessage({ kind: 'tm-value', gen, run, value: live.value.value() })
    if (run.run !== 'Running') return
    await yieldToEventLoop()
  }
}

/**
 * Build an asm copy from `.asm` text and record its run — `onTmScratch`'s counterpart, arriving as `asm-scratch` (Plan 7
 * part 5 spec §7). The same prologue as `onRun`, for the invariant `onLambdaScratch`'s doc states.
 *
 * **ITS VALUE RIDES THE BUILD REPLY.** `asmScratch` has already run the program to its end (spec amendment 26), so
 * `asm-scratch-compiled` carries the value, and there is no value loop after the recording as a TM copy has.
 */
async function onAsmScratch(req: Extract<RunRequest, { kind: 'asm-scratch' }>): Promise<void> {
  await ready
  dropLive()
  for (const leg of LEGS) {
    recorded[leg] = 0
    allowance[leg] = HISTORY_BYTES
    recording[leg] = false
  }

  const { diagnostics, scratch } = asmScratch(req.src) as AsmScratchResult
  if (scratch === null) {
    ctx.postMessage({ kind: 'no-session', gen: req.gen, diagnostics })
    return
  }
  // Deliberate silence: a newer request landed while `asmScratch` (uninterruptible) was in flight — `onTmScratch`'s case.
  if (latest !== req.gen) {
    scratch.free()
    return
  }
  live = { gen: req.gen, kind: 'asm-scratch', session: scratch }

  ctx.postMessage({
    kind: 'asm-scratch-compiled',
    gen: req.gen,
    asm: scratch.asmStatus(),
    asmProgram: scratch.asmProgram(),
    value: scratch.asmValue(),
  })
  await recordAsm(req.gen, true)
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
  switch (req.leg) {
    case 'lambda': {
      // TWO OF THE FOUR KINDS TAKE THIS ARM, which is §3.3's "six methods transplant unchanged" doing
      // its work: `[continue]` on a λ scratchpad's pane is the same two calls as on a session's, against
      // the same method names on a different wasm type. That is why the pane needs no per-kind control
      // strip for THOSE two — a TM or asm copy is an occupant of `live` with no λ leg to extend.
      //
      // Deliberate silence, for `LAMBDA_RECORDING`'s reason: a TM or asm copy has no λ leg, so
      // there is no cap to raise and nothing to record. Returning before `allowance` is spent would be
      // tidier still, but the allowance write above is harmless for a leg that never records and hoisting
      // this check above it would put a `kind` test in front of the ordinary path — the same trade-off
      // the TM arm below already makes in the other direction.
      if (live.kind === 'tm-scratch' || live.kind === 'asm-scratch') return
      const s = live.session
      // Raising a cap that was not hit is harmless — `raise_cap` is additive — but calling it on a
      // DEPTH-refused cursor is pointless by contract, and this arm is never reached for one:
      // `controls.ts` ships no continue affordance for `depth-refused`, which is why that state has no
      // case here rather than a no-op one.
      if (s.lambdaStatus().run === 'Capped') s.raiseLambdaCap(EXTEND_STEPS)
      ran = await recordLambda(req.gen, false)
      break
    }
    case 'tm': {
      // A λ or asm copy has no TM leg, so there is no cap to raise and nothing to record.
      // This guard excludes both from the TM arm, mirroring the λ arm's exclusions above.
      if (live.kind === 'lambda-scratch' || live.kind === 'asm-scratch') return
      const s = live.session
      if (s.tmStatus().run === 'Capped') s.raiseTmCap(EXTEND_STEPS, EXTEND_CELLS)
      ran = await recordTm(req.gen, false)
      break
    }
    case 'asm': {
      // A λ or TM copy has no asm leg, so there is no cap to raise and nothing to record.
      if (live.kind === 'lambda-scratch' || live.kind === 'tm-scratch') return
      const s = live.session
      // THE STEP CAP ONLY. A run the stack, heap or saved frames stopped cannot be continued, and `controls.ts` offers
      // no continue for one (`asmRecordEnd`'s ends), so this arm is never reached for it — and `raise_asm_cap` would not
      // resume it if it were.
      const status = s.asmStatus()
      if (status.run === 'Capped' && status.cap === 'Steps') s.raiseAsmCap(EXTEND_STEPS)
      ran = await recordAsm(req.gen, false)
      break
    }
    default:
      // A LEG WITH NO ARM RECORDS NOTHING AND POSTS NOTHING, as a stale generation does above. `unhandled`
      // makes such a leg a type error, and the `return` is what keeps `ran` assigned on every path below.
      unhandled(req.leg)
      return
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
  // and a scratch has no `ty` to decode against. The frames this call just recorded, and their
  // `RecordEnd`, are its whole answer; a headered TM buffer's value arrives separately, as the
  // `tm-value` replies `runValueLoop` posts, which `[continue]` neither starts nor extends. An asm copy's value is read
  // off its cursor once a raise has carried it past its build's cap, so it is posted again here, on its own.
  if (live.kind === 'asm-scratch') {
    ctx.postMessage({ kind: 'asm-value', gen: req.gen, value: live.session.asmValue() })
    return
  }
  if (live.kind !== 'session') return
  ctx.postMessage({
    kind: 'result',
    gen: req.gen,
    lambda: lambdaLeg(live.session),
    asm: asmLeg(live.session),
    tm: tmLeg(live.session),
  })
}

/**
 * Answer one `lambda-tree` request, synchronously, between record chunks (spec §4.1).
 *
 * **NOT A CLAIM ON `latest`.** A tree is a question about what a `run` or `lambda-scratch` built, not a
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
  if (live?.gen !== req.gen || live.kind === 'tm-scratch' || live.kind === 'asm-scratch') return
  if (live.kind === 'session' && !live.session.lambdaStatus().available) return
  const tree = live.session.lambdaTree(req.step, req.budget)
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
    // A `switch` ENDING IN `unhandled`, WHERE THIS WAS AN `else if` CHAIN WITH NO END. A request kind the
    // chain did not name would have fallen off its end and been dropped with no reply and `tsc` green, which
    // is where a new leg's requests arrive (Plan 7 part 5's spec, amendment 8); now it is a type error here.
    switch (req.kind) {
      case 'run':
        latest = req.gen
        await onRun(req)
        break
      case 'lambda-scratch':
        // `latest` IS CLAIMED HERE TOO, AND THE ABANDON CHECK INSIDE `onLambdaScratch` DEPENDS ON IT.
        // `latest` is what a build compares itself against after its uninterruptible wasm call returns;
        // a build that never recorded itself as the newest request would free its own scratch every
        // time, since `latest !== req.gen` would still name whatever ran before it.
        latest = req.gen
        await onLambdaScratch(req)
        break
      case 'tm-scratch':
        // `latest` IS CLAIMED HERE TOO, FOR `lambda-scratch`'s OWN REASON: the abandon check inside
        // `onTmScratch` compares against it after `tmScratch`'s uninterruptible wasm call returns.
        latest = req.gen
        await onTmScratch(req)
        break
      case 'asm-scratch':
        // `latest` IS CLAIMED HERE TOO, FOR `lambda-scratch`'s OWN REASON.
        latest = req.gen
        await onAsmScratch(req)
        break
      case 'extend':
        await onExtend(req)
        break
      case 'lambda-tree':
        onLambdaTree(req)
        break
      default:
        unhandled(req)
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
