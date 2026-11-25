/**
 * The session worker's loader for `pkg-clif/`, and for `pkg-mc-x86-64/` and `pkg-mc-arm64/`: one load at a time, made
 * the first time it is asked for.
 * **HERE AND NOT IN `session-worker.ts`**, for the reason `record-loop.ts`'s module doc gives: the coverage gate cannot
 * see the worker. The `import()` itself stays there, a literal specifier, since the licence scan reads it.
 */
import type { Listing } from './protocol'
import type { ClifListing, ClifState, ClifStatus, ClifWindow, Decoded, McListing } from './types'

/**
 * The wasm-bindgen `ClifSession`, described structurally for the reason the worker's `Session` is: `pkg-clif`'s
 * generated declarations type every method's return as `any`. **NO `findEnd`**: the worker reports a run's end when
 * its recording reaches it, and never runs ahead to find one.
 */
export type ClifHandle = {
  listing(): ClifListing
  status(): ClifStatus
  step(): boolean
  state(w: ClifWindow): ClifState
  value(): Decoded
  rewind(): void
  raiseCap(extra: number): void
  free(): void
}

/** What the worker uses of `pkg-clif` once its `init` has run. */
export type ClifModule = { readonly ClifSession: new (input: unknown, listing: Listing) => ClifHandle }

/**
 * What the worker uses of a `pkg-mc-*` package once its `init` has run: `machineCode`, which throws a decline as its
 * sentence, a string, and traps as an `Error`.
 */
export type McModule = { readonly machineCode: (input: unknown, listing: Listing) => McListing }

/**
 * One load at a time, kept once it succeeds; a failure is forgotten, so the next call loads again.
 *
 * **A CALL MADE WHILE A LOAD IS PENDING SHARES IT**, so a recompile during a slow fetch does not fetch twice. **A
 * REJECTION KEPT WOULD ANSWER EVERY LATER CALL**, a retry included, with the same failure until the page reloads.
 */
export function clifLoader<M>(load: () => Promise<M>): () => Promise<M> {
  let pending: Promise<M> | null = null
  return () => {
    if (pending === null) {
      const attempt = load()
      pending = attempt
      attempt.catch(() => {
        if (pending === attempt) pending = null
      })
    }
    return pending
  }
}
