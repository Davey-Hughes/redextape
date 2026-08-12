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
   * Post the λ scratchpad build for `gen`, or do nothing if a later `supersede` has already replaced
   * it — design §4.3's fork, seeded with the text a pane was showing.
   *
   * THE SAME GUARD AS `request` AND FOR THE SAME REASON, spelled out rather than shared: both are
   * "post this generation's work if it is still the current one", and the two differ only in the
   * message they build. Folding them into one method taking a `RunRequest` would move the choice of
   * message to every call site and put the `kind` string in `main.ts`, which is the one place design
   * §3.2 keeps free of the wire.
   *
   * IT DOES NOT CLAIM A GENERATION EITHER, mirroring `request`: a scratchpad is seeded by a caller who
   * has just decided to supersede whatever that session was doing, and `SessionClient.supersede`'s own
   * doc is the argument for keeping the claim at the dispatch site.
   */
  scratch(gen: number, src: string): void {
    if (gen !== this.#gen) return
    this.#port.postMessage({ kind: 'lambda-scratch', gen, src })
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

/**
 * Identifies one session: the key into the pool below, and into `main.ts`'s registry of what each
 * session owns.
 *
 * A KEY ON THIS SIDE OF THE BOUNDARY ONLY — NOTHING EVER POSTS IT. Design §3.2: with one worker per
 * session the port a reply arrives on already identifies the session, so `RunRequest`/`RunReply` need
 * no routing field and `protocol.ts` does not change. If a session id ever appears on the wire,
 * something else is wrong. `SessionClient`'s `#gen` (`:15`) is the same claim seen from the other
 * side — a counter that is private and per instance is already per session, and there was only ever
 * one session for it to be per.
 *
 * A plain alias rather than a branded string: the only producers of an id are the constants in
 * `main.ts`, so a brand would cost a cast at every literal to rule out a confusion nothing can
 * currently make.
 *
 * IT MOVED HERE FROM `main.ts`, where it was declared, because a session id is now a key into two
 * containers in two modules and the shared key belongs in the lower one. `main.ts` keeps its own
 * registry under the same key — see `SessionPool`'s doc for why those two maps are two layers rather
 * than two copies.
 */
export type SessionId = string

/**
 * What the POOL needs from a worker: everything a client needs, plus the ability to kill it.
 *
 * `terminate` IS DELIBERATELY NOT ON `ClientPort`. That type's doc is "what the client needs from a
 * `Worker`, and nothing more", and its point is that the staleness rule can be exercised by an object
 * with two methods. A client never kills its worker — that is a lifecycle decision, and lifecycle is
 * what the pool owns and the client does not. Widening `ClientPort` instead would put a lifecycle
 * method on the one interface whose whole job is to keep a rule testable without a thread.
 *
 * CONSEQUENCE FOR §3.2'S SKETCH, which says the pool is a `Map<SessionId, SessionClient>`: it cannot
 * literally be one, because a `SessionClient` holds its port privately (`#port`, `:16`) and offers no
 * way to terminate it. `#live` below carries the port beside the client instead. Nothing in the
 * design rests on the map's value type — §3.2's claim is "one client per session id", and that holds
 * — but the sketch is not the type.
 */
export type PoolPort = ClientPort & { terminate(): void }

/** One session's worker and the client that talks to it. Created together, destroyed together. */
type Pooled = { readonly client: SessionClient; readonly port: PoolPort }

/**
 * One worker per session (design decision 3, §4.2), and the only thing in the app that may spawn or
 * terminate one.
 *
 * THE ARGUMENT IS DAMAGE CONTAINMENT, NOT TIDINESS, and it rests on two findings the print-depth-cap
 * slice (PR #25) already paid for:
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
 * holding three sessions shares both: a borrow left taken by the λ scratchpad poisons the source
 * session with it, and a ceiling pulled down by the scratchpad's deep print stays down for every
 * session on that thread. Separate workers keep each local, and `terminate` + respawn resets both —
 * which is also the mechanism §4.3 reuses for recompile-from-source, so there is ONE recovery path
 * and not two.
 *
 * `session-worker.ts` IS UNTOUCHED, AND ITS ONE-LIVE-SESSION INVARIANT IS WHAT MAKES THIS SAFE
 * (§4.2). It frees the live handle at the top of every `run` (`dropLive`, called before `compile`),
 * so two sessions sharing one worker would not merely share damage — they could not coexist at all:
 * the second compile would free the first session's handle out from under a record loop still posting
 * frames for it. That invariant is the reason the pool goes here and not in the worker.
 *
 * TWO MAPS KEYED BY `SessionId` — THIS ONE AND `main.ts`'s REGISTRY — AND THEY ARE NOT THE SAME FACT
 * WRITTEN TWICE. This one says what a session RUNS ON and is the only thing allowed to change it; the
 * registry says what a session HAS (its histories, its play timer), which are a renderer's nouns in a
 * module that owns the DOM. Merging them would either drag `History` and `setInterval` into this file
 * or put `new Worker` back in `main.ts`, and §4.2 places the pool here precisely to stop the second.
 */
export class SessionPool {
  #spawn: () => PoolPort
  #live = new Map<SessionId, Pooled>()

  /**
   * @param spawn Makes the worker for a session that does not have one yet.
   *
   * INJECTED RATHER THAN HARD-CODED, for the reason `ClientPort` exists one type up: everything in
   * this class is a map, a spawn on first bind and a `terminate` on unbind, and none of it needs a
   * thread to exercise. `tests/node/session-pool.test.ts` passes a factory returning a recording
   * fake and drives the whole lifecycle in the node tier.
   *
   * IT IS ALSO WHERE THE FAILURE POLICY LIVES, which is the reason it is a constructor argument and
   * not a hard-coded `new Worker(new URL('./session-worker.ts', import.meta.url))` right here.
   * `main.ts`'s factory attaches the `error` listener that raises the load-failure banner (design
   * §6's second load-failure row), and a banner needs the app's root element — a decision about DOM,
   * taken in a module that has none.
   *
   * IT TAKES NO `SessionId`, AND THAT IS A CHOICE RATHER THAN AN OVERSIGHT. §4.1's scratch types are
   * a different wasm shape (`LambdaScratch`/`TmScratch`, not `Session`), so the task that lands them
   * will need a session's KIND to pick its worker module — but nothing can pick today, there is one
   * kind, and a parameter every call site ignores is a design decision taken without its evidence.
   * The extension point is this signature, and widening it is a one-line diff in the task that first
   * has a second kind to widen it for.
   *
   * **THAT TASK WAS T8 AND IT DID NOT WIDEN THIS, WHICH MAKES THE PARAGRAPH ABOVE A PREDICTION WORTH
   * MARKING AS WRONG RATHER THAN QUIETLY LEAVING TRUE-LOOKING.** A λ scratchpad runs the SAME
   * `session-worker.ts` module a source session does; what differs is the first message it is sent
   * (`protocol.ts`'s `lambda-scratch` against `run`), because the module's job is "hold one wasm
   * handle and answer about it" and both kinds of handle are that. So the kind is a fact about the
   * CONVERSATION and not about the thread, there is still nothing for a `SessionId` here to select,
   * and the extension point never bound. Refusing the parameter without its evidence is the call that
   * held up; the reason given for why it would eventually be needed is the part that did not.
   */
  constructor(spawn: () => PoolPort) {
    this.#spawn = spawn
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
   * `SessionClient` is constructed with exactly one `onReply` (`:18`) and there is no way to honour a
   * second one — returning the existing client would silently land this caller's frames in the
   * previous caller's legs, which is the same "two places to be wrong" failure `main.ts`'s `LegState`
   * doc refuses one layer up. §4.3's singleton rebinding ("a second edit rebinds to the EXISTING
   * scratch") is served by asking `has` first: one branch at the call site, against a misdelivery
   * here that nothing would report.
   */
  bind(id: SessionId, onReply: (r: RunReply) => void): SessionClient {
    if (this.#live.has(id)) throw new Error(`session already has a worker: ${id}`)
    const port = this.#spawn()
    const client = new SessionClient(port, onReply)
    this.#live.set(id, { client, port })
    return client
  }

  /**
   * Terminate `id`'s worker and forget it. A no-op for a session that has none.
   *
   * IDEMPOTENT WHERE `bind` THROWS, AND THE ASYMMETRY IS DELIBERATE. A second `bind` asks for
   * something that cannot be honoured; a second `unbind` asks for a state that is already true.
   * §4.3's recompile-from-source is the caller that makes this matter — it terminates the scratch's
   * worker on every recompile, and most recompiles happen when no scratch exists at all. Throwing
   * there would force every caller to ask first, and a guard every caller must write is a guard the
   * callee should have.
   *
   * DELETED BEFORE TERMINATED, in that order, mirroring `session-worker.ts`'s `dropLive` ("NULLED
   * BEFORE FREED"): no caller may reach a client whose worker is gone, not even on the path where
   * `terminate` throws on the way out.
   *
   * `terminate()` IS THE CURE THE POISON CANNOT REFUSE, which is what makes this method the whole
   * recovery story for both findings in this class's doc. It kills the thread rather than asking the
   * damaged module to clean up after itself — unlike `Session::free`, which throws on a poisoned
   * handle and so cannot be relied on by the code recovering from the poisoning.
   */
  unbind(id: SessionId): void {
    const held = this.#live.get(id)
    if (held === undefined) return
    this.#live.delete(id)
    held.port.terminate()
  }
}
