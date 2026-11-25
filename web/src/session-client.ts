import type { Leg, Listing, RunReply, RunRequest } from './protocol'

/**
 * What the client needs from a `Worker`, and nothing more.
 *
 * AN INTERFACE RATHER THAN `Worker` SO THE RULE BELOW IS TESTABLE. The staleness check does not need
 * a thread to exercise — it needs an object with two methods.
 */
export type ClientPort = {
  postMessage(m: RunRequest): void
  addEventListener(type: 'message', handler: (e: { data: RunReply }) => void): void
}

export class SessionClient {
  #gen = 0
  #awaitingRun = false
  /** The encoding each generation's run was posted under: `encodingOf`. */
  #encodings = new Map<number, string>()
  #port: ClientPort
  #onSupersede: () => void

  constructor(port: ClientPort, onReply: (r: RunReply) => void, onSupersede: () => void = () => {}) {
    this.#port = port
    this.#onSupersede = onSupersede
    port.addEventListener('message', (e) => {
      // A `clif-load` HAS NO GENERATION TO MATCH: it says whether the worker holds `pkg-clif`, which outlives every
      // run. NOR IS IT A RUN'S ANSWER, so it ends no wait for one.
      if (e.data.kind === 'clif-load') {
        onReply(e.data)
        return
      }
      // THE SECOND OF TWO GUARDS AGAINST THE SAME HAZARD, and both are needed. The worker abandons
      // superseded work at a chunk boundary so it does not compute results nobody wants; this drops
      // a reply that was already in flight when the next request was posted, which the worker's own
      // check cannot see. Generation 0 is "no request yet" and matches nothing.
      //
      // A GENERATION PRODUCES MANY REPLIES — `compiled`, then frame batches, then `result` — so
      // this fires repeatedly and nothing here may treat any one of them as terminal.
      if (this.#gen !== 0 && e.data.gen === this.#gen) {
        // CLEARED BEFORE `onReply`, NOT AFTER. `replies.ts` drives the repaint off that call, and a
        // repaint reading the flag while it was still set would paint the withdrawal one frame after
        // the window it describes had already closed. Idempotent after the first reply of a generation.
        // A TREE IS NOT A RUN'S ANSWER. It arrives between record chunks, often while the run is still
        // in flight, and letting it clear the flag would end "running…" before the run said anything.
        if (e.data.kind !== 'lambda-tree') this.#awaitingRun = false
        onReply(e.data)
      }
    })
  }

  /**
   * Whether a generation has been claimed that no reply has answered yet — which is when the worker's
   * `onExtend` drops a request addressed to the current generation, because `live.gen` is still the
   * previous one or there is no session at all.
   *
   * A SUPERSET OF THE WORKER'S DROP CONDITION RATHER THAN AN EQUALITY, and the difference is stated
   * rather than glossed. The worker sets `live.gen` when it STARTS a run and its first reply follows,
   * so between those two moments the worker would accept an extend this still answers `true` for.
   * That gap is a message queued behind a run already in flight on a single-threaded worker, so being
   * conservative there costs nothing — but the two predicates are not the same one.
   *
   * A WEDGED WORKER HOLDS THIS TRUE FOREVER, AND THAT IS THE HONEST ANSWER: an extend posted to a
   * worker that never answers would not be serviced either.
   */
  get awaitingRun(): boolean {
    return this.#awaitingRun
  }

  /**
   * Claim the next generation, and return it. CALLED AT DISPATCH, NOT AT POST — that separation is
   * the whole point of this method existing.
   *
   * `compile.ts` debounces by `DEBOUNCE_MS` before posting, and `#gen` is the filter that drops replies
   * from a superseded run. A bump in `request` would leave the previous generation current for the
   * entire debounce — and far longer in practice, because a `setTimeout` competes with the worker's
   * frame recording and can be starved for seconds — and a stale `result` arriving in that window would
   * set the UI back to `'idle'` for a program the user had already replaced. Bumping here closes the
   * window at the instant of dispatch instead.
   */
  supersede(): number {
    this.#gen += 1
    // SET AND ANNOUNCED IN THAT ORDER, because the callback repaints and must read the new value.
    this.#awaitingRun = true
    this.#onSupersede()
    return this.#gen
  }

  /**
   * Post the run for `gen`, or do nothing if a later `supersede` has already replaced it.
   *
   * TAKING THE GENERATION RATHER THAN CLAIMING ONE is what makes the debounce self-cancelling: two
   * keystrokes 100 ms apart claim two generations and schedule two timers — but `compile.ts`'s `schedule`
   * calls `clearTimeout` on the previous timer before arming the new one, so the FIRST timer never
   * fires and this guard is unreachable from that call site. It stays anyway, as defence-in-depth: it
   * is the post-side half of the same house pattern the receive-side guard in the constructor above
   * applies, and a future caller that posts without `schedule`'s clearTimeout discipline should not get
   * to skip the generation check because one call site makes it redundant.
   */
  request(gen: number, src: string, encoding: string, width: number | null = null, clif: Listing | null = null): void {
    if (gen !== this.#gen) return
    this.#encodings.set(gen, encoding)
    // A `null` WIDTH IS AUTO, POSTED AS NO `width` KEY, NOT `width: undefined`: an auto request carries none.
    this.#port.postMessage(
      width === null ? { kind: 'run', gen, src, encoding, clif } : { kind: 'run', gen, src, encoding, width, clif },
    )
  }

  /**
   * The encoding the run of `gen` was posted under, `null` for a generation no run was posted for: what a view of
   * that generation's frames reads their fields in. **KEPT PER GENERATION**, not as the last one posted: a session's
   * views show the last answered generation's frames until the one posted after it answers, and a run's bit order
   * is its own encoding's.
   */
  encodingOf(gen: number): string | null {
    return this.#encodings.get(gen) ?? null
  }

  /**
   * Ask for more frames on one leg, at `epoch`, the leg's (`LegState.epoch`). ADDRESSES THE CURRENT GENERATION AND
   * DOES NOT ADVANCE IT: this continues the run already in the worker, and bumping the generation would abandon the
   * very session it is trying to extend.
   */
  extend(leg: Leg, epoch: number): void {
    if (this.#gen === 0) return
    this.#port.postMessage({ kind: 'extend', gen: this.#gen, leg, epoch })
  }

  /**
   * Ask the worker to take one leg back to step 0 and record its first fill again, under `epoch`, the leg's raised
   * one. Not a supersede, for `extend`'s reason: the other legs keep their recordings. Never before the first build.
   */
  rewind(leg: Leg, epoch: number): void {
    if (this.#gen === 0) return
    this.#port.postMessage({ kind: 'rewind', gen: this.#gen, leg, epoch })
  }

  /**
   * Ask the worker to load `pkg-clif` and record nothing: the page's intent to show a CLIF view. Not a supersede, for
   * `extend`'s reason, and answered by a `clif-load` whatever generation is live.
   */
  clifLoad(): void {
    this.#port.postMessage({ kind: 'clif-load', gen: this.#gen })
  }

  /**
   * Ask the worker to build the live generation's CLIF stepper for `listing` and record it from step 0 under `epoch`,
   * the CLIF leg's raised one, or with `listing` `null` to drop it. Not a supersede, for `rewind`'s reason, and
   * never before the first build.
   */
  clif(listing: Listing | null, epoch: number): void {
    if (this.#gen === 0) return
    this.#port.postMessage({ kind: 'clif', gen: this.#gen, epoch, listing })
  }
  /** This client's generation — the one a `lambda-tree` request must carry to be answered. */
  get gen(): number {
    return this.#gen
  }

  /**
   * Ask for the λ tree at `step` (Plan 7 part 4 spec §4.1). Not a supersede: it names the live generation
   * and builds nothing, so it is posted as `extend` is, and never before the first build.
   */
  tree(step: number, budget: number): void {
    if (this.#gen === 0) return
    this.#port.postMessage({ kind: 'lambda-tree', gen: this.#gen, step, budget })
  }
}

/**
 * Identifies one session: the key into the pool below, and into `sessions.ts`'s registry of what each
 * session owns.
 *
 * A KEY ON THIS SIDE OF THE BOUNDARY ONLY — NOTHING EVER POSTS IT. 5d-i design §3.2: with one worker per
 * session the port a reply arrives on already identifies the session, so `RunRequest`/`RunReply` need
 * no routing field. If a session id ever appears on the wire, something else is wrong.
 * `SessionClient`'s `#gen` is the same claim seen from the other side — a counter that is private and
 * per instance is already per session.
 *
 * A plain alias rather than a branded string: a brand would cost a cast at every literal to rule out a
 * confusion nothing can currently make.
 *
 * IT IS DECLARED HERE because a session id is a key into two containers in two modules and the shared
 * key belongs in the lower one. `sessions.ts` keeps its registry under the same key — see
 * `SessionPool`'s doc for why those two maps are two layers rather than two copies.
 */
export type SessionId = string

/**
 * One worker per session (5d-i design decision 3, §4.2). The pool is the only thing in the app that spawns one, on the
 * session's first bind, and nothing ends one: a worker lasts the page's life.
 *
 * THE ARGUMENT IS DAMAGE CONTAINMENT, NOT TIDINESS, and it rests on two findings of the print-depth-cap
 * slice (PR #25):
 *
 *   * a wasm call that aborts mid-flight leaves wasm-bindgen's reentrancy borrow TAKEN, so every
 *     later call on that module throws "attempted to take ownership of Rust value while it was
 *     borrowed" — the session is **poisoned permanently**, and even `free()` throws, which is why
 *     `session-worker.ts`'s `dropLive` wraps it in a `try`;
 *   * a worker's print-stack ceiling **drops after its first deep print and stays down** — measured
 *     bracket [1400, 1497) against ~1,930 for a fresh worker on its first print, which is why
 *     `redextape_wasm::session::MAX_PRINT_DEPTH` is 1,000 and not something near 1,900.
 *
 * BOTH DAMAGES ARE PROPERTIES OF A WORKER, NOT OF A SESSION, which is the whole argument. One worker
 * holding several sessions shares both: a borrow left taken by one poisons the others with it, and a ceiling pulled
 * down by one's deep print stays down for every session on that thread. Separate workers keep each local.
 *
 * `session-worker.ts`'S ONE-LIVE-SESSION INVARIANT IS WHAT MAKES THIS SAFE (5d-i design §4.2). It frees
 * the live handle at the top of every `run` (`dropLive`, called before `compile`), so two sessions
 * sharing one worker would not merely share damage — they could not coexist at all: the second compile
 * would free the first session's handle out from under a record loop still posting frames for it. That
 * invariant is the reason the pool goes here and not in the worker.
 *
 * TWO MAPS KEYED BY `SessionId` — THIS ONE AND `sessions.ts`'s REGISTRY — AND THEY ARE NOT THE SAME
 * FACT WRITTEN TWICE. This one says what a session RUNS ON and is the only thing allowed to change it;
 * the registry says what a session HAS (its histories, its playback flags). Merging them would either
 * drag `History` and the player into this file or give `sessions.ts` the spawning that only this class may do.
 */
export class SessionPool {
  #spawn: () => ClientPort
  #onSupersede: () => void
  #live = new Map<SessionId, SessionClient>()

  /**
   * @param spawn Makes the worker for a session that does not have one yet.
   *
   * INJECTED RATHER THAN HARD-CODED, for the reason `ClientPort` exists: everything in this class is a
   * map and a spawn on first bind, and none of it needs a thread to exercise.
   * `tests/node/session-pool.test.ts` passes a factory returning a recording fake and drives every
   * bind in the node tier.
   *
   * IT IS ALSO WHERE THE FAILURE POLICY LIVES, which is the reason it is a constructor argument and
   * not a hard-coded `new Worker(new URL('./session-worker.ts', import.meta.url))` right here.
   * `main.ts`'s factory attaches the `error` listener that raises the load-failure banner (the worker
   * half of 5a design §6's "worker or wasm fails to load" row), and a banner needs the app's root
   * element — a decision about DOM, taken in a module that has none.
   *
   * IT TAKES NO `SessionId`. Every session runs the SAME `session-worker.ts` module, whose job is "hold one wasm
   * handle and answer about it", so there is nothing for a `SessionId` here to select.
   *
   * @param onSupersede Repaint the app. Called by every client this pool makes, from `supersede()`.
   *
   * REQUIRED HERE RATHER THAN ON `bind`. This pool is the only route from `src/` to a `SessionClient`, so one
   * required argument at one place is enough for no app site to be able to claim a generation without the panes
   * learning.
   *
   * IT TAKES NO SESSION, UNLIKE `bind`'s `onReply`. A reply is routed to one session's legs; a
   * repaint is routed nowhere — it paints every pane — so a `SessionId` here would be a parameter
   * nothing reads.
   */
  constructor(spawn: () => ClientPort, onSupersede: () => void) {
    this.#spawn = spawn
    this.#onSupersede = onSupersede
  }

  /** How many sessions currently have a worker. */
  get size(): number {
    return this.#live.size
  }

  /** Does `id` have a worker? The question `bind`'s throw makes a caller ask. */
  has(id: SessionId): boolean {
    return this.#live.has(id)
  }

  /**
   * Give `id` a worker and a client, and return the client.
   *
   * THROWS IF `id` IS ALREADY LIVE, rather than returning the client it already has. A
   * `SessionClient` is constructed with exactly one `onReply` and there is no way to honour a
   * second one — returning the existing client would silently land this caller's frames in the
   * previous caller's legs, which is the same "two places to be wrong" failure `sessions.ts`'s `LegState`
   * doc refuses one layer up.
   *
   * The misdelivery is a property of THIS method rather than of any caller: one client, one `onReply`, so
   * any second binding of a live id is frames landing under the wrong name whoever asked for it.
   */
  bind(id: SessionId, onReply: (r: RunReply) => void): SessionClient {
    if (this.#live.has(id)) throw new Error(`session already has a worker: ${id}`)
    const port = this.#spawn()
    const client = new SessionClient(port, onReply, this.#onSupersede)
    this.#live.set(id, client)
    return client
  }
}
