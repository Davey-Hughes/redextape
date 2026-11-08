/**
 * The session worker's one-occupant rule and its copy build: what the worker does before it builds anything, and the
 * order a `scratch` request's build runs in. **HERE AND NOT IN `session-worker.ts`**, for the reason `record-loop.ts`'s
 * module doc gives: the coverage gate cannot see the worker. What touches the worker's state or a wasm handle stays
 * there and is passed in. `tests/node/copy-build.test.ts` holds the order.
 */
import type { Leg, RunReply } from './protocol'
import { type RecordLeg, type RecordWorker, recordLeg, resetRecording } from './record-loop'
import type { Diagnostic } from './types'

/** What claiming the thread touches in the worker. */
export type Claim = {
  /** The wasm module's `init`. */
  readonly ready: Promise<unknown>
  /** Empty the occupant, then free its handles. */
  dropLive(): void
  /** Forget the legs the last `result` posted and the parts a rewind held. */
  forgetResult(): void
}

/**
 * The one reset before a build: wait for the module, drop the occupant, reset recording, forget the result parts.
 *
 * **THE OCCUPANT IS DROPPED BEFORE ANYTHING NEW IS BUILT**, a session or a copy alike, so the window with two wasm
 * handles alive on this thread is zero rather than bounded (5d-i design §4.2): the property that makes one worker per
 * session safe. Every build calls this first; the books are reset after the drop, for `resetRecording`'s reason.
 */
export async function claimLive(claim: Claim, worker: RecordWorker): Promise<void> {
  await claim.ready
  claim.dropLive()
  resetRecording(worker)
  claim.forgetResult()
}

/** The worker's one occupant: its session, or one copy of one leg (a worker's own type may add fields). */
export type Occupant<S, C extends { [K in Leg]: unknown }> =
  | { gen: number; kind: 'session'; session: S }
  | { [K in Leg]: { gen: number; kind: 'scratch'; leg: K; session: C[K] } }[Leg]

/**
 * What `leg`'s recording may step for `gen`: the session, or this leg's copy; `null` for another leg's copy.
 *
 * **A COPY OF ANOTHER LEG ANSWERS `null`, NOT A THROW** (5d-i design §4.1, one leg apiece). No caller reaches that
 * answer, since each session has its own worker and a new occupant claims a new generation; but a caller that mixed
 * them hears "no such leg here" rather than a throw from wasm about a method the copy does not have. A copy's own leg
 * is answered: an answer that admitted only a session would make every copy record nothing.
 */
export function liveHandle<S, C extends { [K in Leg]: unknown }, K extends Leg>(
  live: Occupant<S, C> | null,
  leg: K,
  gen: number,
): S | C[K] | null {
  if (live?.gen !== gen) return null
  if (live.kind === 'session') return live.session
  // `live.leg === leg` does not narrow a generic `K`.
  return live.leg === leg ? (live.session as C[K]) : null
}

/** Each leg's reply to a copy that built: a kind of its own, since the payloads and their `replies.ts` arms differ. */
export type CopyCompiled = {
  lambda: Extract<RunReply, { kind: 'scratch-compiled' }>
  rxm: Extract<RunReply, { kind: 'rxm-scratch-compiled' }>
  tm: Extract<RunReply, { kind: 'tm-scratch-compiled' }>
}

/**
 * What differs by leg in building a copy. Each member calls wasm or sets the occupant, so the entries are the worker's.
 * **`K` IS THE LEG, AS IN A `RecordLeg`**, so that `buildCopy` takes a build and a recording of one leg.
 */
export type CopyBuild<K extends Leg, M> = {
  /** `made` is `null` for text that builds no copy, and `diagnostics` say why. */
  build(src: string, step: number): { made: M | null; diagnostics: Diagnostic[] }
  /** Free a build a newer generation superseded. */
  free(made: M): void
  occupy(gen: number, made: M): void
  compiled(gen: number, made: M): CopyCompiled[K]
  /** What runs once the first recording has. */
  after?(gen: number): Promise<void>
}

/**
 * Claim, build, refuse or drop a superseded build, occupy, post the compiled reply, record, then `after`.
 *
 * **A SUPERSEDED BUILD IS FREED IN SILENCE.** A newer request landed while the uninterruptible build ran, and this
 * copy was never posted anywhere, so freeing it is the whole cleanup. **A COPY THAT BUILT POSTS NO DIAGNOSTICS**: it
 * has none (`BUILD`'s doc, in the worker), and no reply but `no-session` carries them. **ONLY THE COPY'S OWN LEG IS
 * RECORDED**: a copy has one, and the others' `handle` would answer `null`.
 */
export async function buildCopy<K extends Leg, M, H>(
  build: CopyBuild<K, M>,
  record: RecordLeg<K, H>,
  claim: Claim,
  latest: () => number,
  worker: RecordWorker,
  req: { gen: number; src: string; step: number },
): Promise<void> {
  await claimLive(claim, worker)
  const { made, diagnostics } = build.build(req.src, req.step)
  if (made === null) {
    worker.post({ kind: 'no-session', gen: req.gen, diagnostics })
    return
  }
  if (latest() !== req.gen) {
    build.free(made)
    return
  }
  build.occupy(req.gen, made)
  worker.post(build.compiled(req.gen, made))
  await recordLeg(record, worker, req.gen, true)
  await build.after?.(req.gen)
}
