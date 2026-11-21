import type { Listing } from './protocol'

/**
 * What the session worker has been told about the CLIF leg for this generation, and when to tell it again.
 *
 * **NOTHING IS POSTED WHILE A RUN IS AWAITED**, from the moment it is scheduled to its `compiled` or `no-session`. The
 * worker drops a `clif` request until the run it names has replaced the live session, and the run's `compiled`
 * resets the CLIF leg's epoch to 0, below any epoch a request posted before it would have raised. A run carries the
 * listing shown when it is posted, so a view shown inside the debounce needs no request at all, and one shown while
 * the run is in flight is asked for once its reply has come.
 *
 * **ONE POST PER CHANGE**: `post` is called only with a listing other than the last one the worker was told, by a run
 * or by a post, except on `retry`, which asks again for what is wanted after a load that failed.
 */
export class ClifSync {
  readonly #post: (listing: Listing | null) => void
  /** The listing the worker was last told of, by the run or by a post since; `null` for none shown. */
  #sent: Listing | null = null
  /** The listing the page shows now, `null` for none. */
  #wanted: Listing | null = null
  /** Whether a run is scheduled or in flight whose `compiled` or `no-session` has not come. */
  #awaiting = false

  constructor(post: (listing: Listing | null) => void) {
    this.#post = post
  }

  /**
   * A run is scheduled: nothing is posted until its reply, since the run will carry the listing shown when it posts.
   */
  scheduled(): void {
    this.#awaiting = true
  }

  /** A run carrying `listing` was posted: nothing is posted until its reply. */
  ran(listing: Listing | null): void {
    this.#awaiting = true
    this.#sent = listing
  }

  /** The run's `compiled` or `no-session` came: posts what is wanted if the run carried something else. */
  settled(): void {
    this.#awaiting = false
    if (this.#wanted !== this.#sent) this.#send(this.#wanted)
  }

  /** Posts when `listing` differs from what was sent and no run is awaited. */
  want(listing: Listing | null): void {
    this.#wanted = listing
    if (!this.#awaiting && listing !== this.#sent) this.#send(listing)
  }

  /** Posts what is wanted again; nothing while a run is awaited or nothing is wanted. */
  retry(): void {
    if (!this.#awaiting && this.#wanted !== null) this.#send(this.#wanted)
  }

  #send(listing: Listing | null): void {
    this.#sent = listing
    this.#post(listing)
  }
}
