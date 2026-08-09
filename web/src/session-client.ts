import type { Leg, RunReply, RunRequest } from './protocol'

/**
 * What the client needs from a `Worker`, and nothing more.
 *
 * AN INTERFACE RATHER THAN `Worker` SO THE RULE BELOW IS TESTABLE. The staleness check is the only
 * logic in this file and it does not need a thread to exercise — it needs an object with two methods.
 */
export type ClientPort = {
  postMessage(m: RunRequest): void
  addEventListener(type: 'message', handler: (e: { data: RunReply }) => void): void
}

export class SessionClient {
  #gen = 0
  #port: ClientPort

  constructor(port: ClientPort, onReply: (r: RunReply) => void) {
    this.#port = port
    port.addEventListener('message', (e) => {
      // THE SECOND OF TWO GUARDS AGAINST THE SAME HAZARD, and both are needed. The worker abandons
      // superseded work at a chunk boundary so it does not compute results nobody wants; this drops
      // a reply that was already in flight when the next request was posted, which the worker's own
      // check cannot see. Generation 0 is "no request yet" and matches nothing.
      //
      // A GENERATION NOW PRODUCES MANY REPLIES — `compiled`, then frame batches, then `result` — so
      // this fires repeatedly and nothing here may treat any one of them as terminal.
      if (this.#gen !== 0 && e.data.gen === this.#gen) onReply(e.data)
    })
  }

  /**
   * Claim the next generation, and return it. CALLED AT DISPATCH, NOT AT POST — that separation is
   * the whole point of this method existing.
   *
   * `main.ts` debounces by `DEBOUNCE_MS` before posting, and `#gen` is the filter that drops replies
   * from a superseded run. While the bump lived in `request`, the previous generation stayed current
   * for the entire debounce — and far longer in practice, because a `setTimeout` competes with the
   * worker's frame recording and can be starved for seconds. A stale `result` arriving in that window
   * set the UI back to `'idle'` for a program the user had already replaced. Measured on PR 5a-ii:
   * dispatch at 2 ms, the PREVIOUS generation's `result` at 4,679 ms, the new program's `compiled` at
   * 4,710 ms. Bumping here closes the window at the instant of dispatch instead.
   */
  supersede(): number {
    this.#gen += 1
    return this.#gen
  }

  /**
   * Post the run for `gen`, or do nothing if a later `supersede` has already replaced it.
   *
   * TAKING THE GENERATION RATHER THAN CLAIMING ONE is what makes the debounce self-cancelling: two
   * keystrokes 100 ms apart claim two generations and schedule two timers — but `main.ts`'s `schedule`
   * calls `clearTimeout` on the previous timer before arming the new one, so the FIRST timer never
   * fires and this guard is unreachable from that call site today. It stays anyway, as
   * defence-in-depth: it is the post-side half of the same house pattern the receive-side guard in the
   * constructor above applies, and a future caller that posts without `schedule`'s clearTimeout
   * discipline should not get to skip the generation check just because this one call site currently
   * makes it redundant.
   */
  request(gen: number, src: string, encoding: string): void {
    if (gen !== this.#gen) return
    this.#port.postMessage({ kind: 'run', gen, src, encoding })
  }

  /**
   * Ask for more frames on one leg. ADDRESSES THE CURRENT GENERATION AND DOES NOT ADVANCE IT: this
   * continues the run already in the worker, and bumping the generation would abandon the very
   * session it is trying to extend.
   */
  extend(leg: Leg): void {
    if (this.#gen === 0) return
    this.#port.postMessage({ kind: 'extend', gen: this.#gen, leg })
  }
}
