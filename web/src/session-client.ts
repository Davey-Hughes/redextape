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

  request(src: string, encoding: string): void {
    this.#gen += 1
    this.#port.postMessage({ kind: 'run', gen: this.#gen, src, encoding })
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
