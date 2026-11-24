/**
 * WHAT IS NOT BEING SAVED — Plan 7 part 6a spec §4.3 and row 17: the notice line's one resting state, said for the
 * program's writer (`main.ts`'s `writeProgramStorage`), which reports a refused write only when it has something to
 * lose, and whose success takes the sentence back. It also says why: the storage is full, or the browser is blocking it
 * (`refusalOf`).
 */

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

/** The resting sentence for the program failing, and why. */
export function unsavedLine(why: Refusal): string {
  return `the program is not being saved — this browser’s storage for this site is ${why}`
}

export type Unsaved = {
  /** A write of the program was refused, for `why`, and the writer has something to lose. */
  refused(why: Refusal): void
  /**
   * The program has nothing to lose now — a write went through, or what a refused one held is what a reload restores
   * anyway: the sentence goes.
   */
  saved(): void
}

/**
 * Whether the program is failing, handing the whole sentence to `rest` — the app's `Notices.rest` — at every call,
 * whether or not the call changed it: `rest` does nothing with the sentence it already rests on.
 *
 * **ONE CAUSE FOR THE LINE, THE LATEST REFUSAL'S.** Storage is full or blocked for the whole site, and the condition
 * can change between two writes, so the latest refusal is the one that says what holds now.
 */
export function createUnsaved(rest: (line: string | null) => void): Unsaved {
  return {
    refused: (why) => rest(unsavedLine(why)),
    saved: () => rest(null),
  }
}
