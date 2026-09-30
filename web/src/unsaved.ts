/**
 * WHAT IS NOT BEING SAVED — Plan 7 part 6a spec §4.3 and row 17: the notice line's one resting state, now said for two
 * writers. The copies' writer (`main.ts`'s `writeBuffersStorage`) and the program's each report a refused write only
 * when they have something to lose, and the line has one resting sentence, so the sentence names whichever of the two
 * is failing — the program, the copies, or both — and each writer's success takes back only its own half. It also
 * says why: the storage is full, or the browser is blocking it (`refusalOf`).
 */

/** A store whose refused writes are reported: the one holding the program, or the one holding the copies. */
export type UnsavedStore = 'program' | 'copies'

/**
 * Why storage refused a write, in the words the line says it with: this site's storage is full, or this browser is not
 * letting the site store at all.
 */
export type Refusal = 'full' | 'blocked'

/**
 * Why a write was refused, from what it threw. A `QuotaExceededError` is storage that is full. Anything else is storage
 * the browser withholds: where site data is blocked, `localStorage` throws a `SecurityError`, from the write or from
 * its own getter before the write is reached, and telling that visitor their storage is full would send them to free
 * space that is not the problem.
 */
export function refusalOf(thrown: unknown): Refusal {
  return thrown instanceof DOMException && thrown.name === 'QuotaExceededError' ? 'full' : 'blocked'
}

/**
 * The resting sentence for what is failing and why, or `null` when nothing is. The copies' alone, refused for space, is
 * the sentence `buffers-quota.test.ts` has always pinned.
 */
export function unsavedLine(program: boolean, copies: boolean, why: Refusal): string | null {
  const what = program ? (copies ? 'the program and copies are' : 'the program is') : copies ? 'copies are' : null
  return what === null ? null : `${what} not being saved — this browser’s storage for this site is ${why}`
}

export type Unsaved = {
  /** A write to `store` was refused, for `why`, and the writer has something to lose. */
  refused(store: UnsavedStore, why: Refusal): void
  /**
   * `store` has nothing to lose now — a write went through, or what a refused one held is what a reload restores
   * anyway: its half of the sentence goes, and the other's stays.
   */
  saved(store: UnsavedStore): void
}

/**
 * Which stores are failing, handing the whole sentence to `rest` — the app's `Notices.rest` — at every call, whether
 * or not the call changed it: `rest` does nothing with the sentence it already rests on.
 *
 * **ONE CAUSE FOR THE LINE, THE LATEST REFUSAL'S.** Storage is full or blocked for the whole site, not for one key, so
 * the two writers meet different causes only when the condition itself has changed between their writes, and the
 * latest refusal is the one that says what holds now.
 */
export function createUnsaved(rest: (line: string | null) => void): Unsaved {
  const failing: Record<UnsavedStore, boolean> = { program: false, copies: false }
  let cause: Refusal = 'full'
  const set = (store: UnsavedStore, value: boolean): void => {
    failing[store] = value
    rest(unsavedLine(failing.program, failing.copies, cause))
  }
  return {
    refused: (store, why) => {
      cause = why
      set(store, true)
    },
    saved: (store) => set(store, false),
  }
}
