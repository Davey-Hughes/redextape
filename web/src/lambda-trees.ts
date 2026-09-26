import { LAMBDA_TREE_NODES, type LambdaTreeWire } from './protocol'
import type { SessionId } from './session-client'

/** What a view is told about the tree for the step it shows. */
export type TreeFor =
  /** The tree for exactly the step asked (or the step the worker clamped it to). */
  | { readonly kind: 'tree'; readonly tree: LambdaTreeWire }
  /** The last tree that came back, for another step — shown until the asked one arrives (spec §4.5). */
  | { readonly kind: 'stale'; readonly tree: LambdaTreeWire }
  /** The term at this step has `nodes` nodes, over `LAMBDA_TREE_NODES`. */
  | { readonly kind: 'refused'; readonly nodes: number }
  /** Nothing has come back yet. */
  | { readonly kind: 'none' }

/** The half of `SessionClient` this cache uses. */
export type TreeRequester = {
  readonly gen: number
  readonly awaitingRun: boolean
  tree(step: number, budget: number): void
}

type Entry = {
  gen: number
  latest: LambdaTreeWire | null
  /** The step `latest` was asked for — equal to `latest.step` unless the worker clamped it. */
  answered: number | null
  /** The step a request is in flight for, or `null`. At most one per session, so a fast play asks at
   * most once per reply rather than once per frame. */
  asked: number | null
}

/**
 * The λ trees the views are drawing, one per session, asked for on demand (spec §4.1).
 *
 * **ONE REQUEST IN FLIGHT PER SESSION.** `want` is called from `draw()`, once per frame per λ view; it
 * asks only when nothing is outstanding, and a reply's `draw()` asks for the then-current step. So a view
 * at rest asks once, and a view playing at 5,000 steps a second asks as fast as the worker answers — never
 * faster.
 *
 * **KEYED BY GENERATION.** A recompile makes a new session behind the same id; an entry from the old
 * generation is discarded on first sight, and a reply carrying it is ignored.
 *
 * **NOTHING IS ASKED WHILE THE CLIENT AWAITS A RUN.** `SessionClient.supersede` moves the generation
 * forward the moment a keystroke schedules a compile, and the worker learns it only when the debounced
 * `run` arrives. A tree asked for in between names a generation the worker has not reached, so the worker
 * drops it — and an entry waiting on an answer that will never come would never ask again. Until the new
 * build answers, the frames on screen are still the old build's, so the old build's tree is still theirs.
 */
export class LambdaTrees {
  #entries = new Map<SessionId, Entry>()
  #client: (session: SessionId) => TreeRequester | undefined

  constructor(client: (session: SessionId) => TreeRequester | undefined) {
    this.#client = client
  }

  want(session: SessionId, step: number): TreeFor {
    const client = this.#client(session)
    if (client === undefined) return { kind: 'none' }
    if (client.awaitingRun) return this.#held(this.#entries.get(session), step)
    let e = this.#entries.get(session)
    if (e === undefined || e.gen !== client.gen) {
      e = { gen: client.gen, latest: null, answered: null, asked: null }
      this.#entries.set(session, e)
    }
    const held = this.#held(e, step)
    if (held.kind === 'tree' || held.kind === 'refused') return held
    if (e.asked === null) {
      e.asked = step
      client.tree(step, LAMBDA_TREE_NODES)
    }
    return held
  }

  /** What `e` already holds for `step`, asking nothing. */
  #held(e: Entry | undefined, step: number): TreeFor {
    const latest = e?.latest ?? null
    if (latest === null) return { kind: 'none' }
    if (latest.step === step || e?.answered === step) {
      return latest.refused === null ? { kind: 'tree', tree: latest } : { kind: 'refused', nodes: latest.refused }
    }
    return latest.refused === null ? { kind: 'stale', tree: latest } : { kind: 'none' }
  }

  store(session: SessionId, gen: number, tree: LambdaTreeWire): void {
    const e = this.#entries.get(session)
    if (e === undefined || e.gen !== gen) return
    e.latest = tree
    e.answered = e.asked
    e.asked = null
  }

  /**
   * The build `session`'s trees come from — the generation of the entry `want` answers from — or `null`
   * before its first ask. While the client awaits a run this is still the OLD build, as the frames on
   * screen are; a view starts its folds over when it changes (spec §5.2).
   */
  buildOf(session: SessionId): number | null {
    return this.#entries.get(session)?.gen ?? null
  }

  /** Drop every session `alive` says is gone — a deleted copy's last tree is not worth keeping. */
  prune(alive: (session: SessionId) => boolean): void {
    for (const id of [...this.#entries.keys()]) if (!alive(id)) this.#entries.delete(id)
  }
}
