/**
 * The session worker's one-occupant rule: what the worker does before it builds anything, and what a recording may
 * step. **HERE AND NOT IN `session-worker.ts`**, for the reason `record-loop.ts`'s module doc gives: the coverage gate
 * cannot see the worker. What touches the worker's state or a wasm handle stays there and is passed in.
 * `tests/node/claim.test.ts` holds the order.
 */
import { type RecordWorker, resetRecording } from './record-loop'

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
 * **THE OCCUPANT IS DROPPED BEFORE ANYTHING NEW IS BUILT**, so the window with two wasm handles alive on this thread
 * is zero rather than bounded (5d-i design §4.2): the property that makes one worker per session safe. Every build
 * calls this first; the books are reset after the drop, for `resetRecording`'s reason.
 *
 * **THE OCCUPANT IS ONE SESSION, PLUS AT MOST ONE CLIF STEPPER BUILT FROM IT**, which is dropped with it: the stepper
 * is built from that session's `clifInput()` and lives no longer than the session does.
 */
export async function claimLive(claim: Claim, worker: RecordWorker): Promise<void> {
  await claim.ready
  claim.dropLive()
  resetRecording(worker)
  claim.forgetResult()
}

/** The worker's one occupant: its session, with the generation that built it (a worker's own type may add fields). */
export type Occupant<S> = { gen: number; session: S }

/**
 * What a recording may step for `gen`: the session `gen` built, else `null`. **A STALE GENERATION ANSWERS `null`**:
 * a record loop suspended at a yield can resume after a newer build replaced its session, and it must stop rather than
 * step the new one.
 */
export function liveHandle<S>(live: Occupant<S> | null, gen: number): S | null {
  return live?.gen === gen ? live.session : null
}
