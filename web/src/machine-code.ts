import type { ClifLoad, Listing, McTarget, RunReply } from './protocol'
import type { McListing } from './types'

/**
 * A machine code answer: the rows; or why there are none, a decline in the lowering's words; or a package that
 * trapped on the program, which says nothing of the program.
 */
export type McAnswer = { readonly code: McListing } | { readonly declined: string } | { readonly trapped: string }

/** What the store asks the program's session worker for (`SessionClient`'s): its generation, a load, and an answer. */
export type McPort = {
  gen(): number
  load(target: McTarget): void
  ask(target: McTarget, listing: Listing): void
}

/**
 * The page's machine code (machine code panel design §6): where each target's package load stands, and the answers
 * for the program's last compiled generation, one per listing and target, shared by every clif view that shows them.
 *
 * **AN ANSWER IS SHOWN FOR THE GENERATION LAST COMPILED**, not the one a keystroke has claimed: every clif view goes on
 * showing the old program's listing until the new one's `compiled`, and the panel keeps the old code beside it.
 * **ONE ASK PER GENERATION, LISTING AND TARGET**, made the first time a view wants it, since every view draws on every
 * frame, **AND ONLY ONCE THE TARGET'S PACKAGE IS IN**: the worker then answers every ask of a live generation, so no
 * ask is left made and unanswered by a failed load, and Retry, which loads again, has no ask to make twice.
 */
export class MachineCode {
  #port: McPort
  #load: Record<McTarget, ClifLoad> = { 'x86-64': 'idle', arm64: 'idle' }
  /** The generation the program's last `compiled` was for: the one the worker holds a session of. */
  #compiled = 0
  /** By `key`, of `#compiled` alone: each ask made, and its answer, `null` until it comes. */
  #answers = new Map<string, McAnswer | null>()

  constructor(port: McPort) {
    this.#port = port
  }

  /** Where `target`'s package load stands. */
  load(target: McTarget): ClifLoad {
    return this.#load[target]
  }

  /**
   * The intent to show `target`: its package is fetched, once. **`loading` ONLY AS THE LOAD IS POSTED**, which the
   * worker always answers with an `mc-load`, so the state never waits on an answer that will not come.
   */
  intent(target: McTarget): void {
    if (this.#load[target] !== 'idle') return
    this.#load[target] = 'loading'
    this.#port.load(target)
  }

  /** The last compiled generation's answer for `target` and `listing`, or `null` while it has none. */
  code(target: McTarget, listing: Listing): McAnswer | null {
    return this.#answers.get(key(target, listing)) ?? null
  }

  /**
   * Fetch `target`'s package if it is not, and once it is in, ask for the last compiled generation's answer for
   * `target` and `listing`, unless it has been asked for. **NOT WHILE A KEYSTROKE'S GENERATION WAITS FOR ITS
   * `compiled`**: the worker, which holds no session of it yet, answers nothing for it, and the old generation's is
   * no longer live there.
   */
  want(target: McTarget, listing: Listing): void {
    this.intent(target)
    const gen = this.#compiled
    if (gen === 0 || gen !== this.#port.gen() || this.#load[target] !== 'ready') return
    if (this.#answers.has(key(target, listing))) return
    this.#answers.set(key(target, listing), null)
    this.#port.ask(target, listing)
  }

  /**
   * The program's listing is about to switch to `listing`: ask for it now, on each of the `shown` targets an open
   * panel shows, **BEFORE THE PAGE POSTS THE CLIF REQUEST**, so that the worker builds the code before the new listing
   * and the panel changes in the listing's frame (machine code panel design §4, *When there is none*). **NO OTHER
   * TARGET**: the listing waits for each build, and one no panel shows would hold it back for nothing.
   */
  switching(listing: Listing, shown: Iterable<McTarget>): void {
    for (const target of shown) this.want(target, listing)
  }

  /** After a failed load: fetch `target`'s package again. */
  retry(target: McTarget): void {
    if (this.#load[target] !== 'failed') return
    this.#load[target] = 'loading'
    this.#port.load(target)
  }

  /** The program's `compiled` for `gen`: from now the worker answers that generation's asks, and older ones go. */
  compiled(gen: number): void {
    this.#compiled = gen
    this.#answers.clear()
  }

  /** An `mc-load`'s state. */
  loaded(target: McTarget, state: 'loading' | 'ready' | 'failed'): void {
    this.#load[target] = state
  }

  /** An `mc`'s answer, kept while its generation is the last compiled. */
  answered(reply: Extract<RunReply, { kind: 'mc' }>): void {
    if (reply.gen !== this.#compiled) return
    this.#answers.set(key(reply.target, reply.listing), answerOf(reply))
  }
}

/** What an `mc` reply says, as the panel shows it. */
function answerOf(reply: Extract<RunReply, { kind: 'mc' }>): McAnswer {
  if (reply.code !== null) return { code: reply.code }
  return reply.trapped ? { trapped: reply.error ?? '' } : { declined: reply.error ?? '' }
}

function key(target: McTarget, listing: Listing): string {
  return `${target} ${listing}`
}
