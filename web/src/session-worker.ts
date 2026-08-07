/// The worker that owns the `Session`.
///
/// THE HANDLE CANNOT LEAVE THIS THREAD. `Session` is an opaque wasm-bindgen object with no serialized
/// form, so the worker owns it and answers questions about it rather than handing it over. That is
/// also why `classifySource` and `analyze` are NOT here: they are free functions, they are what the
/// editor calls on every keystroke, and a round trip per keystroke is exactly the lag this split
/// exists to avoid.
import init, { compile } from '../../pkg/redextape_wasm.js'
import type { LambdaLeg, RunReply, RunRequest, TmLeg } from './protocol'
import { CHUNK_STEPS, LAMBDA_BYTE_BUDGET } from './protocol'
import type { Decoded, Diagnostic, LambdaState, LambdaStatus, RunStatus, Span, TmStatus } from './types'

/// The wasm-bindgen `Session`, described structurally — `pkg`'s generated declarations type every
/// method's return as `any`, so the shapes have to be asserted somewhere, and once is here.
type Session = {
  lambdaStatus(): LambdaStatus
  lambdaState(byteBudget: number): LambdaState
  lambdaValue(): Decoded
  runLambda(budget: number): RunStatus
  tmStatus(): TmStatus
  tmValue(): Decoded
  sourceSpan(node: number): Span | null
  free(): void
}

type CompileResult = { diagnostics: Diagnostic[]; session: Session | null }

/// Exactly what this worker uses of its global scope.
///
/// DECLARED RATHER THAN PULLED FROM THE `WebWorker` LIB, because that lib and `DOM` declare `self` and
/// `postMessage` incompatibly and `skipLibCheck` does not reconcile two libs.
type WorkerScope = {
  addEventListener(type: 'message', handler: (e: MessageEvent<RunRequest>) => void): void
  postMessage(message: RunReply): void
}
const ctx = self as unknown as WorkerScope

const ready = init()

/// The newest generation this worker has been asked for. A run whose generation is no longer this one
/// is abandoned at the next chunk boundary — see `drive`.
let latest = 0

/// One macrotask. `queueMicrotask` would NOT do: a microtask runs before the message queue is drained,
/// so a newer request would never be seen and the abandon check could not fire.
const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0))

/// Advance the λ leg in chunks, abandoning if a newer request has landed.
///
/// Returns `null` when abandoned. `false` from a status check is not enough to decide anything here —
/// the loop watches for `Running`, which is the only status that means "there is more to do".
async function drive(session: Session, gen: number): Promise<RunStatus | null> {
  for (;;) {
    const status = session.runLambda(CHUNK_STEPS)
    if (status !== 'Running') return status
    await yieldToEventLoop()
    if (latest !== gen) return null
  }
}

function lambdaLeg(session: Session): LambdaLeg {
  const status = session.lambdaStatus()
  if (!status.available) {
    // `sourceSpan` IS RESOLVED HERE because the handle cannot leave this thread. A refusal that names
    // a node the main thread cannot look up would highlight nothing.
    const declinedSpan = status.node === null ? null : session.sourceSpan(status.node)
    return { status, state: null, value: null, declinedSpan }
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

ctx.addEventListener('message', async (e: MessageEvent<RunRequest>) => {
  const req = e.data
  if (req.kind !== 'run') return
  latest = req.gen
  await ready

  // `compile` RUNS THE WHOLE TM LEG and is one uninterruptible call. Off the main thread that can only
  // delay the next result — it can never block input, highlighting or linting, which is the entire
  // reason the Session lives here.
  const { diagnostics, session } = compile(req.src, req.encoding) as CompileResult

  if (session === null) {
    ctx.postMessage({ kind: 'no-session', gen: req.gen, diagnostics })
    return
  }

  // GUARDED, NOT REDUNDANT WITH `lambdaLeg`'S OWN `status.available` CHECK BELOW: `runLambda` doesn't
  // return a `RunStatus` when the λ leg has declined — the Rust side's `run_lambda` returns
  // `Err(SessionError::LambdaAbsent)`, which the wasm binding raises as a THROWN JS exception. Calling
  // `drive` unconditionally would throw inside this `async` handler with nothing catching it, so no reply
  // is ever posted and the caller hangs until its own timeout. Checking availability first is the only
  // way to reach `tmLeg` (and the declined `lambdaLeg`) for a program the λ backend has refused.
  if (session.lambdaStatus().available) {
    const outcome = await drive(session, req.gen)
    if (outcome === null) {
      // Superseded. Free the handle and say nothing — a newer request is already in flight, and the
      // client would drop this reply anyway.
      session.free()
      return
    }
  }

  ctx.postMessage({ kind: 'result', gen: req.gen, lambda: lambdaLeg(session), tm: tmLeg(session) })
  session.free()
})
