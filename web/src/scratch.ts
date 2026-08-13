import { History } from './history'
import type { RunReply } from './protocol'
import type { SessionId, SessionPool } from './session-client'
import { resetLegs, type SessionRegistry } from './sessions'
import type { Diagnostic, LambdaState } from './types'

/**
 * What retiring a buffer needs from a pane slot: which session it is on, and the ability to move it
 * off.
 *
 * A STRUCTURAL TYPE RATHER THAN `PaneSlot<Leg>`, and the reason is variance rather than taste.
 * `PaneSlot<K>`'s `render` takes a `PaneView<LegFrame[K]>` in PARAMETER position, so a
 * `PaneSlot<'lambda'>` and a `PaneSlot<'tm'>` are not two instantiations one signature can name
 * without either a union or method bivariance — and leaning on bivariance to pass a heterogeneous
 * array would be exactly the "the cast a mutation needs is the evidence the types hold" property T4
 * recorded, quietly spent. This type asks for the two members retirement actually uses, both slots
 * satisfy it for free, and `Binding<K>`'s leg parameter is untouched because nothing here can see it.
 *
 * `binding` IS READ-ONLY HERE AND `rebind` IS THE ONLY WRITER, which is `PaneSlot`'s own contract
 * restated at the smallest surface that needs it.
 */
export type Detachable = {
  readonly binding: { readonly session: SessionId }
  rebind(session: SessionId): void
}

/**
 * One live scratch buffer, as the surfaces outside this module see it: the session it is, and what a
 * user calls it.
 *
 * NOT `SessionEntry`, AND NOT A SUPERSET OF IT. A buffer's entry holds a history, a client and a play
 * timer; a caller asking "what buffers are there" is asking for a menu, and handing it the machinery
 * would make every reader of that menu a reader of the session model. `SessionEntry.label`'s doc draws
 * the same line from the other side — the label is UI text, the id is a map key.
 */
export type BufferInfo = { readonly id: SessionId; readonly label: string }

/**
 * How many buffers may be live at once. **EIGHT IS A CHOICE, NOT A MEASUREMENT, and is recorded as
 * such** — design §4.5, which takes that sentence from `layout.ts`'s `MIN_PANE_FRACTION` and asks for
 * the same honesty here.
 *
 * **THE ARITHMETIC IS THE WHOLE OF WHAT IS BEHIND THE FIGURE.** `protocol.ts`'s `HISTORY_BYTES` is the
 * ring's cap PER LEG, at 32 MiB. The source session holds two legs and each buffer holds one, so eight
 * buffers is ten legs — 320 MiB of ring budget, against the 64 MiB a page that has never forked can
 * reach. Each buffer is also a thread, and a thread costs a wasm module baseline of 8,454,144 bytes
 * before it holds a term at all (`DROP_HISTORY_ON_UNFOCUS`'s measurement, `protocol.ts`), so the cap
 * admits nine of those as well. **CONSERVATIVE RATHER THAN CORRECT**: no page reaches ten full rings
 * without ten legs recording to exhaustion, and nothing here claims the app is comfortable at eight
 * buffers or unusable at nine.
 *
 * **THE ONE DATUM IN EVIDENCE IS NOT A MEASUREMENT OF THIS, AND IT IS WEAKER THAN ITS SHAPE SUGGESTS.**
 * 5d-i's T9 probe read three workers' wasm memory at 2.4153× one worker's — 28,966,912 bytes against
 * 11,993,088 (`protocol.ts` again, `DROP_HISTORY_ON_UNFOCUS`). **BOTH FIGURES ARE PER-WORKER TOTALS
 * RATHER THAN BASELINES**, which is what a ratio under 3× is actually reporting: the first worker held
 * the probe's whole `Session` and the other two held a `LambdaScratch` of 65,536 bytes and nothing at
 * all, so the sum is one loaded worker plus two nearly empty ones — `11,993,088 + 8,454,144 + 65,536 +
 * 8,454,144`, the measured figure exactly. Against the bare module baseline the same three totals are
 * 3.43×, and three BARE baselines against one would of course be 3×. Nothing there is shared
 * between threads, and a buffer a user made holds a term and a ring where the probe's second and third
 * workers held neither. So the datum makes "a thread is not free" a fact instead of an intuition and
 * says nothing about where eight should be. **Nothing has measured where the trade actually turns for
 * buffers**, and this constant is not that measurement. (This paragraph read "three threads at 2.4153×
 * one thread's wasm baseline", inherited verbatim from design §4.5 — corrected in both places, and the
 * point it was making is sharper for it, not softer.)
 *
 * **A LATER SLICE REPLACES IT WITH A MEASURED CAP.** Design §6.1 files 5d-ii-d for exactly that — the
 * worker-affordability probe 5d-i left open, and "the measured cap that replaces §4.5's provisional
 * eight" — positioned after this slice and before 5d-iv. Until then the figure moves the way
 * `MIN_PANE_FRACTION` moves: if a user runs into it doing something reasonable, the number changes.
 *
 * **WHAT RIDES ON THE FIGURE, SO THAT MOVING IT IS A DECISION AND NOT A DISCOVERY.** The tests that
 * exercise the cap import this constant rather than spelling eight, so they follow it wherever it goes.
 * One thing does not follow: `tests/browser/two-lambda-panes.test.ts` needs the cap to be **at least
 * two**, because several of its tests fork twice inside a single test — its reset reclaims buffers between
 * tests (`retireEveryBuffer`) precisely so that it needs no more than that. Nothing else in `src/`
 * reads this constant except `fork` below.
 */
export const MAX_BUFFERS = 8

/**
 * The refusal `fork` raises at `MAX_BUFFERS` — design §4.5's "refused with a diagnostic naming the
 * list", as a type its caller can act on.
 *
 * **A CLASS RATHER THAN A PLAIN `Error`, BECAUSE THE CALLER HAS TO TELL THIS FROM A BUG.**
 * `transport.ts`'s detach handler catches this one and puts its message on `#link-status`; the other
 * things `fork` can raise are `SessionRegistry.add`'s and `SessionPool.bind`'s guards over their own
 * invariants (a replaced entry strands a running `setInterval`; a replaced client misdelivers frames),
 * and those are wiring bugs rather than answers to a user. A bare `catch` at that call site would
 * render one of them as a status line and swallow it. `instanceof` is what keeps a refusal a refusal
 * and lets everything else go on being loud.
 *
 * **THE MESSAGE IS THE PAYLOAD AND THERE IS NO SECOND FIELD.** It is composed here because this is the
 * only place that holds both the cap and the labels, and it is rendered verbatim after
 * `link-status.ts`'s `fork failed — ` prefix. A `live: BufferInfo[]` field would let the caller compose
 * a second wording of the same fact, which is the fan-out `BufferInfo`'s own doc exists to prevent.
 */
export class BufferCapReached extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BufferCapReached'
  }
}

/**
 * What the buffer collection needs to exist: the two containers its buffers live in, and where their
 * replies go.
 *
 * **NO `id` AND NO `label`, AND THIS PARAGRAPH USED TO ARGUE THE OPPOSITE.** It read: *"THE ID AND THE
 * LABEL ARE PASSED IN, NOT DECLARED HERE, because `SessionEntry.label`'s doc puts the app's session
 * names in `main.ts` 'here and nowhere else' — a module that named its own session would be the second
 * place a name could be wrong"*. That held while there was one buffer with one fixed name, which
 * `main.ts` could write down before the session existed. A fork mints a name per call now (`fork`
 * below), so the name is a function of the counter that mints the id and the two cannot be written in
 * different places without being able to disagree. What that sentence was actually protecting survives
 * unchanged: a session's name is decided where the session is CREATED — `main.ts` for the source
 * session, here for a buffer — and never in `sessions.ts`, which holds no name of the app's at all.
 *
 * `onReply` NAMES ITS SESSION, WHERE IT USED TO BE BOUND TO ONE. One collection binds many workers
 * through one dependency, so the id is curried in per buffer at `pool.bind` and arrives with the
 * reply; a callback that closed over "the" scratch would deliver every buffer's frames under one name.
 */
export type ScratchBuffersConfig = {
  registry: SessionRegistry
  pool: SessionPool
  /** The ring's cap for each buffer's one leg. `HISTORY_BYTES`, per 5d-i design §4.4's one knob. */
  historyBytes: number
  onReply: (session: SessionId, reply: RunReply) => void
}

/**
 * **THE λ SCRATCH BUFFERS — 5d-ii-c design decision 1, and the policy half of 5d-i's plan T8.**
 *
 * Editing a source-derived λ view creates a `LambdaScratch` seeded with the source's step-0 text plus
 * a step — not that pane's own current text; `fork`'s own doc below has the full argument for why —
 * and rebinds THAT pane to it. **The source session is untouched and keeps running** — which is the
 * entire reason more than one session exists rather than one mutable one, and the property
 * `tests/browser/scratch-fork.test.ts` asserts by watching the source's step count advance across a
 * fork. Nothing in this class reads or writes the source session's entry, its client or its legs;
 * `fork` touches the registry, the pool and ONE slot.
 *
 * **A FORK MAKES A BUFFER, WHERE 5d-i's DECISION 5 MADE AT MOST ONE.** This class was
 * `LambdaScratchpad` and held one fixed id: a second fork rebound the second pane to the scratch the
 * first one built, so two panes shared one term and the second pane's seed was discarded. 5d-ii-c
 * decision 1 removes that — the `has` branch that implemented it is gone from `fork`, and what
 * replaces it is a map keyed by the ids this class mints. **A buffer also stops dying by accident**
 * (decision 2), but that is a change to the CALLERS, and the tasks are split so that "what is a
 * buffer" and "what ends one" are reviewable apart.
 *
 * **A CLASS IN ITS OWN MODULE RATHER THAN CLOSURES IN `main()`, AND THE REASON IS THE TEST.** The
 * claim under test is now "two forks produce two buffers" where it was "two forks produce one", and
 * 5d-i's plan is explicit that the axis must be POOL SIZE rather than rendering, because rendering
 * looks right either way. Pool size is not reachable from the DOM, so a test driven entirely through
 * the app cannot make that assertion however many panes it can reach — the same wall T7 hit and
 * answered by moving the registry out of `main()`. `tests/node/scratch.test.ts` drives this class over
 * a real `SessionRegistry` and a real `SessionPool` with fake ports, which is the whole mechanism
 * minus the thread.
 *
 * **IT IS ALSO WHERE THE COVERAGE GATE CAN SEE IT.** `vite.config.ts` excludes `session-worker.ts`
 * from the include set for a measured instrumentation reason, so logic placed there moves none of the
 * four numbers; the worker therefore holds only the wasm call, and the minting, the rebinding and the
 * retirement order live here.
 *
 * **λ ONLY, AND THE `TmScratch` HALF OF 5d-i §4.3 IS NOT BUILT — SAID PLAINLY RATHER THAN LEFT TO BE
 * NOTICED.** Nothing can create one: a `TmScratch` is built from `.tm` TEXT, and no surface in this
 * app holds any — the TM pane renders a δ-table projected from a compiled program, never the machine
 * source that would have produced one. A second class here, or a `leg` parameter on this one, would be
 * a knob whose only setting is the one it already has. 5d-ii-c design §3.5 records the same fact from
 * the other end: `options('tm')` still returns exactly the source session after this slice, which is
 * why the TM half of the pair list cannot be exercised here. `protocol.ts`'s `lambda-scratch` request
 * carries the same line on the wire.
 */
export class ScratchBuffers {
  #reg: SessionRegistry
  #pool: SessionPool
  #bytes: number
  #onReply: (session: SessionId, reply: RunReply) => void

  /**
   * Every live buffer, in the order it was forked — the `#id`/`#label` pair this class used to hold,
   * made plural.
   *
   * A `Map` KEYED BY THE SESSION ID, because that is what every caller has: a pane holds a binding, a
   * reply names a session, and the header list retires by id. INSERTION ORDER IS THE LIST'S ORDER for
   * `SessionRegistry`'s own reason — `Map` iterates in insertion order and buffers are created one at
   * a time, so "oldest first" falls out without a comparator that would have to invent a rank for a
   * name.
   *
   * IT IS NOT A SECOND REGISTRY. The entry, the legs, the client and the thread all live where they
   * already did; this holds the two facts the registry cannot answer as a set — WHICH of its sessions
   * are buffers, and in what order they were made. `detached` is a property of a session and cannot
   * distinguish a λ buffer from a future `TmScratch`; nothing else in an entry records provenance.
   */
  #buffers = new Map<SessionId, BufferInfo>()

  /**
   * How many buffers have EVER been minted, which is deliberately not how many are live.
   *
   * A RETIRED BUFFER'S NAME IS NOT REISSUED. Reusing `scratch 1` for the buffer forked after the first
   * one was retired would put two different terms under one name inside a single session — and the
   * name is the only handle a user has on a buffer no pane is showing (design §4.2's list). A counter
   * that only goes up costs nothing and cannot produce that.
   */
  #minted = 0

  constructor(config: ScratchBuffersConfig) {
    this.#reg = config.registry
    this.#pool = config.pool
    this.#bytes = config.historyBytes
    this.#onReply = config.onReply
  }

  /**
   * Fork `slot` onto a NEW λ scratch buffer seeded with `src`, and answer the buffer's id.
   *
   * **THERE IS NO `has` BRANCH, AND ITS ABSENCE IS THE WHOLE OF DECISION 1.** This method used to open
   * with `if (!this.#reg.has(this.#id))` and its doc called that "THE SINGLETON... AND BOTH CONTAINERS
   * ANSWER IT AT ONCE": a second fork rebound to the EXISTING scratch rather than making another, so
   * nothing here spawned a second worker or overwrote the first seed. Every line of that is now
   * false — a fork that happens spawns, seeds, and names its own buffer. (That sentence read "a fork
   * ALWAYS spawns, always seeds, and always names its own buffer", and the cap below is what took the
   * word back: there is a state in which a fork does none of the three. It is not the branch this
   * paragraph is about — the singleton's branch chose between two things a fork could mean, and this one
   * chooses between doing all of it and doing none of it.)
   *
   * **THE TWO THROWS THAT BRANCH EXISTED FOR ARE STILL THERE, AND NO LONGER NAME THIS CALL SITE.**
   * `SessionRegistry.add` and `SessionPool.bind` both refuse an id they already hold, and both of their
   * docs used to justify that by pointing here — *"§4.3's singleton rebinding is served by asking `has`
   * first, which is one branch at the call site against a leak here that nothing would report"*. There
   * is no rebinding for a branch to serve: `#minted` only ever goes up, so the id below is one neither
   * container has seen. Both throws stay as guards over their own invariants (a replaced entry strands
   * a running `setInterval`; a replaced client misdelivers frames), and both docs now say so on their
   * own account rather than on this one's.
   *
   * **THE SEED IS THE SOURCE'S STEP-0 TEXT PLUS A STEP, AND THIS FUNCTION DOES NOT GO LOOKING FOR
   * EITHER.** It was "that pane's current text" when the pane's own 512-byte frame was the seed; 5d-i
   * design §4.1 replaced that because most non-trivial terms truncate there. The caller supplies the
   * source session's step-0 term (from the `compiled` reply, at `LAMBDA_BYTE_BUDGET`) and the step the
   * pane was showing, and the worker re-derives the term between them. The rule is that this function
   * is handed its inputs rather than resolving them, so the seed and the screen cannot disagree without
   * something reporting it.
   *
   * **IT RETURNS THE ID IT MINTED, WHERE `detach` RETURNED NOTHING** (design §4.1). The caller needs
   * the name to record what the pane is now on — `pane-host.ts` claims custody of the editor for it —
   * and returning it is what keeps minting in ONE place rather than having a caller derive the next
   * name and be wrong the first time two of them run.
   *
   * **THE ONE CONDITIONAL IS A REFUSAL, WHICH IS WHERE THE OLD "REBINDING IS UNCONDITIONAL AND CREATION
   * IS NOT" PARAGRAPH ENDS UP.** Its point was that a pane already bound to the scratchpad rebinding to
   * it is a harmless no-op, and that branching to avoid it would be a SECOND place the singleton rule was
   * written down. There is no rule left to write down twice; what survives is the shape it was
   * protecting, and the cap below does not spend it. **This paragraph opened "NOTHING HERE IS
   * CONDITIONAL" and ended "there is no state in which a fork means something else"**, which the cap
   * makes false as written and true as intended: every call that returns does the same things in the same
   * order, and the added branch decides whether this method runs at all rather than what a fork means
   * when it does. A second outcome that returned an id would be the thing the sentence was guarding
   * against; a throw is not one, because no caller can mistake it for a fork.
   *
   * **AT `MAX_BUFFERS` IT REFUSES, AND REFUSING IS THE ONLY THING A CAP MAY DO HERE** (design §4.5).
   * Making room by retiring the oldest buffer would end a buffer nobody named, which is precisely what
   * decision 2 forbids — an eviction is that rule broken under the name of a limit, and the work it
   * would throw away is a term the user typed. So the count is a refusal and never a policy about which
   * buffer dies. `tests/node/scratch.test.ts` asserts the list is still full AFTER the refusal, because
   * a version that evicted would pass a test that only checked the throw.
   *
   * **THE REFUSAL IS THE FIRST THING IN THE BODY, WHICH IS WHERE IT HAS TO BE.** Everything below
   * mutates something outside this object — the counter, the pool, the registry, the slot — and each of
   * those is a container the collection would then be out of step with. A guard placed after
   * `SessionPool.bind` in particular would leave a running worker for a buffer `#buffers` never
   * recorded, so nothing could ever retire it: the leak the cap exists to bound, created by the cap.
   *
   * **THE MESSAGE NAMES THE CONTROL THAT ENDS ONE**, because "no" on its own would leave a user holding
   * a pane with no account of how to get the room back.
   *
   * **IT USED TO NAME THE BUFFERS TOO, AND THAT WAS WORSE THAN SAYING NOTHING — changed after reading
   * the line on a real page.** It read `all 8 scratch buffers are live (scratch 1, scratch 2, scratch 3,
   * scratch 4, scratch 5, scratch 6, scratch 7, scratch 8); retire one from…`, on the argument that
   * "the buffers it lists are exactly the rows design §4.2's header list offers a retire on, so the
   * sentence and the gesture name the same things". Both halves of that hold and neither helps: the
   * names are `scratch 1` through `scratch 8` BY CONSTRUCTION — a counter's output, carrying nothing
   * that distinguishes one buffer from another — so the enumeration is sixty characters of noise
   * standing between the diagnosis and the only actionable clause in the sentence, on a one-line dim
   * status readout with no wrap. The user has to read past every name to reach the instruction, and the
   * names tell them nothing they could act on when they get there.
   *
   * **WHAT REPLACED IT IS THE LIST ITSELF, WHICH NOW ANSWERS THE QUESTION THE ENUMERATION WAS PRETENDING
   * TO.** `buffer-list.ts` gives every row its buffer's current TERM, so "what is using the room" is a
   * glance at the surface this sentence already points at — and it is answered with the one fact that
   * differs between buffers rather than with eight copies of a counter. Naming them here as well would
   * be the fan-out `BufferInfo`'s own doc exists to prevent, now that there is something real to fan out.
   *
   * THE COUNT STAYS, because it is the thing the user cannot see from the button (`buffers 8 ▾` says how
   * many exist, not that eight is the limit) and it is what makes the refusal a rule rather than a
   * malfunction.
   *
   * **AND IT REACHES A SURFACE, WHICH IS THE HALF OF §4.5 A THROW ON ITS OWN DOES NOT DELIVER.** The
   * only caller in `src/` is `transport.ts`'s detach handler, running inside the `✎ fork` button's own
   * click listener (`pane-chrome.ts`'s `detachButton`); it catches `BufferCapReached`, hands the message
   * to `link-wiring.ts`'s `setForkFailed` and repaints, so `link-status.ts` renders it as
   * `fork failed — …` on `#link-status`. That is the same field `replies.ts` writes for the SIBLING
   * refusal — a fork whose build fails — which is what makes this a wire being connected rather than a
   * surface being invented. **Uncaught, it would have reached nothing**: there is no `window` error
   * handler in `src/` (`main.ts`'s is a WORKER `error` listener, which a main-thread click never
   * reaches), so the message would have gone to the console and the user would have seen no answer at
   * all. That is how this shipped in the first commit and it was the review's Critical.
   *
   * **NOTHING IS LEFT HALF-DONE ON THE REFUSED PATH**, which is what makes the catch a report rather
   * than a repair: this method mutates nothing before it refuses, the slot is still on the session it
   * was on, `pane-host.ts`'s wrapper claims custody only when the binding actually moved, and the
   * handler's `setForkFailed(null)` sits on the SUCCESS path so a refusal cannot clear a previous
   * failure out of the model while leaving it on screen. That last one is a fix rather than a
   * description — the clear ran before the call in the first commit, and this sentence was untrue by a
   * frame until it moved.
   */
  fork(slot: Detachable, src: string, step: number): SessionId {
    if (this.#buffers.size >= MAX_BUFFERS) {
      // READS AS A SENTENCE AFTER `fork failed — `, which is the only way it is ever shown
      // (`link-status.ts`). Hence a semicolon rather than a second dash, and no "the fork was refused"
      // clause: the prefix already says which gesture this is about.
      throw new BufferCapReached(
        `all ${MAX_BUFFERS} scratch buffers are live; retire one from the buffers list in the header to make room`,
      )
    }
    this.#minted += 1
    const id: SessionId = `scratch-${this.#minted}`
    const label = `scratch ${this.#minted}`
    // THE REPLY CARRIES THE ID BECAUSE THE WIRE DOES NOT (5d-i §3.2: the port is the id). One
    // collection, one `onReply`, many threads — so the name is closed over HERE, per buffer, at the
    // one place that knows which thread it just made.
    const client = this.#pool.bind(id, (reply) => this.#onReply(id, reply))
    this.#reg.add({
      id,
      label,
      // `detached: true` BY CONSTRUCTION, AND NOTHING CAN SET IT OTHERWISE. 5d-i §3.3 is why it is
      // knowable at creation: `linkIndex` and `sourceSpan` exist on neither scratch type, so a
      // scratch session can never participate in the sync anchor. `main.ts`'s source entry is the
      // only one in the app that may say `false`, and its own comment says so.
      detached: true,
      client,
      legs: {
        lambda: {
          hist: new History<LambdaState>(this.#bytes),
          // NOT AVAILABLE YET, WITH A REASON A PANE CAN READ. `controlState` renders `reason` as the
          // step readout while `!available`, and the worker's `scratch-compiled` reply is one
          // message away — so this is what the pane says for the frame or two between the fork and
          // the first batch. Leaving it `''` is what `resetLegs`'s doc records as having left the
          // panes reading nothing.
          status: { available: false, reason: 'building…' },
          done: null,
          timer: null,
        },
      },
      // NO MACHINE, EVER — `SessionEntry.tmProgram` is retained from a `compiled` reply, and a λ
      // buffer's worker answers `scratch-compiled` instead (5d-i §3.3: no TM leg, no `SourceMap`). A
      // TM pane cannot be bound to this session either, so nothing will ever read it; stating the
      // `null` is what makes that a fact the type carries rather than one the reader has to derive.
      tmProgram: null,
    })
    this.#buffers.set(id, { id, label })
    // SUPERSEDE THEN POST, the pattern `main.ts`'s `schedule` uses and for the same reason
    // (`SessionClient.supersede`'s doc): a fresh client is at generation 0, which matches nothing,
    // so the claim has to happen before the post or `scratch` would drop its own message.
    client.scratch(client.supersede(), src, step)
    slot.rebind(id)
    return id
  }

  /**
   * Every live buffer, oldest first — design §4.2's header list is the caller this exists for.
   *
   * **THE ACCESSOR THIS CLASS SPENT A TASK REFUSING, ARRIVING WHEN IT HAD SOMETHING TO ANSWER.** The
   * paragraph here read "NO `id` OR `live` ACCESSOR, AND THE ABSENCE IS DELIBERATE. Both were written
   * and both had exactly one caller: a test... a getter here would be a third spelling of a fact two
   * containers already hold". That argument was correct and it was about a SINGLETON: `reg.has(id)`
   * and `pool.has(id)` answered "does the scratchpad exist" because the id was a constant the caller
   * already had. Neither container answers THIS question — the registry holds sessions of every kind
   * and the pool holds threads, and neither records which of its keys are buffers or in what order
   * they were forked. The refusal stands as written for the accessor it refused.
   *
   * `BufferInfo`, NOT `SessionEntry`, and not `SessionId[]` either: a list keyed only by id would send
   * every caller back to the registry for the label, which is the fan-out the type exists to prevent.
   * A COPY RATHER THAN THE MAP'S OWN ITERATOR, so a caller cannot hold a view that changes underneath
   * it between the moment the list is built and the moment a row is clicked.
   */
  list(): readonly BufferInfo[] {
    return [...this.#buffers.values()]
  }

  /**
   * Rebuild buffer `id` from `src` — 5d-i design §4.3's edit path. Answers whether that buffer exists.
   *
   * **IT IS `fork` WITH `step: 0` AND NO CREATION, WHICH IS WHY THERE IS NO SECOND MESSAGE.** The text
   * in the editor IS the term, so there is nothing to replay to; `lambda-scratch` already means "build
   * a scratch from this text at this step" and 0 is its identity value. A `scratch-edit` variant would
   * be a second name for one request.
   *
   * **IT TAKES THE BUFFER IT REBUILDS, AND THAT IS A CHANGE THIS TASK MADE RATHER THAN INHERITED.**
   * Under the singleton there was nothing to name. Its caller is `transport.ts`'s `editScratch`, one
   * per λ pane, and the pane knows which buffer it is showing — so passing `slot.binding.session` costs
   * one argument and removes the only reading under which typing into one pane could rebuild a term
   * another pane is showing. `retire` and `noSessionReply` below arrived here one task later and are
   * keyed the same way now; this method's doc used to say they were "deliberately NOT keyed yet", which
   * is the sentence that task deleted.
   *
   * **IT DOES NOT REBIND AND DOES NOT TOUCH THE REGISTRY.** The pane is already on this session and
   * stays on it; what changes is the term behind the leg. `resetLegs` is NOT called here either — the
   * worker's reply drives the leg through the same path a first fork does, and clearing the ring
   * ahead of it would blank the pane for the round trip rather than at the end of it.
   *
   * ANSWERS A BOOLEAN FOR `retire`'s REASON, INVERTED: `retire` returns one because it can be handed
   * the name of a buffer that has already ended, and this returns one because an editor cannot exist
   * without the buffer behind it — so `false` is a caller bug rather than the common case, and a caller
   * that ignores it has a pane bound to nothing. (`retire`'s half of that sentence read "because most
   * recompiles happen with no buffer at all" while a source keystroke called it on every keystroke;
   * decision 2 deleted that caller, and `retire`'s own doc records what is left.)
   */
  recompile(id: SessionId, src: string): boolean {
    if (!this.#buffers.has(id)) return false
    const client = this.#reg.entryOf(id).client
    client.scratch(client.supersede(), src, 0)
    return true
  }

  /**
   * Retire buffer `id`: rebind its panes to `home`, stop its playback, forget it, and **terminate its
   * worker**. Answers whether that buffer was live.
   *
   * **IT TAKES THE BUFFER IT ENDS, AND THE PARAGRAPH HERE USED TO EXPLAIN WHY IT COULD NOT.** That
   * paragraph read: *"WHICH BUFFER, WHEN THE SIGNATURE NAMES NONE — TRANSITIONAL... It means the
   * buffer forked most recently, which is the singleton's exact behaviour in every state a caller
   * reaches with one fork, and a placeholder in every other."* Every word of it is now spent. The
   * newest-buffer reading is gone from this class entirely — the `#newest()` helper that held it is
   * deleted — and with it the state it warned about, where a second fork followed by a recompile left
   * the older buffer running with nothing pointing at it. **What the two tasks bought by splitting is
   * still worth stating**: this one changes only the KEY, and the two callers below go on firing at
   * exactly the moments they fired before, so a review of the trigger (Task 3 for recompile, Task 4 for
   * poison) reads a diff that changes nothing else.
   *
   * **IT DOES NOT SWEEP, AND THAT NEVER WAS TRANSITIONAL.** Retiring every buffer would end buffers the
   * caller never named, and design decision 2's governing rule is that nothing ends a buffer implicitly
   * — an eviction wearing another name is the shape that rule exists to refuse. The id makes that
   * enforceable rather than merely intended: there is now a name to disagree with.
   *
   * **THE CALLER WAS RECOMPILE-FROM-SOURCE, AND 5d-i §4.3 MADE THAT DELIBERATELY THE SAME MECHANISM AS
   * POISON RECOVERY.** `SessionPool.unbind` is the cure 5d-i §4.2 names for both findings the
   * print-depth-cap slice paid for — a borrow left taken poisons a module permanently, and a worker's
   * print-stack ceiling drops after its first deep print — because `terminate()` kills a thread that
   * cannot be asked to clean up after itself. **That caller is gone (decision 2), and `compile.ts`
   * records the gap it opened**: design §4.4 is where the recovery goes instead — the header list,
   * because a wedged buffer has to be reachable whether or not a pane is still showing it.
   *
   * **ONE CALLER IN `src/`, AND THE SENTENCE ABOVE USED TO END "…EXCEPT `noSessionReply`'s PHANTOM-FORK
   * PATH".** That was the second of decision 2's two deletions and it closed the table in design §4.3: a
   * recompile no longer ends a buffer, a failed build no longer ends a buffer, and the only row left
   * with "ends it" in it is the explicit retire. **The window where the app could create buffers and end
   * none was TOTAL for three tasks** — deliberately, so that "what ends a buffer" was reviewable as one
   * change rather than as a residue of two — and §4.2's header list closed it. That caller is
   * `main.ts`'s retire handler, which hands over every pane's slot and then sweeps custody itself; this
   * method is unchanged and did not need to change, since `buffer-list.ts`'s rows already called an
   * `onRetire: (id: SessionId) => void` this was written to be the argument for. `tests/node/scratch.test.ts`
   * and `tests/browser/scratch-fork.test.ts` drive it directly as well, at the layer the list drives it
   * from.
   *
   * **THE ORDER IS LOAD-BEARING AND IT IS PANES, LEGS, REGISTRY, POOL.** Panes first: `legOf` and
   * `entryOf` throw for a session the registry does not hold, and `draw()` resolves through both, so a
   * slot still pointing at a removed entry is an exception on the next frame rather than a blank pane.
   * Legs second, through `resetLegs`, and that call is the one that is easy to leave out —
   * `SessionRegistry.remove` deletes a map key and cannot see a running `setInterval`, and `add`'s doc
   * names exactly this leak ("a stranded `setInterval` on a `LegState` nothing can reach any more").
   * Registry third and pool last, because `remove`'s own doc says a caller retiring a session calls
   * both and that terminating a thread is never the registry's job. The collection's own entry goes
   * last of all: it is what `list()` reads, and a buffer must not be listed after its thread is gone.
   *
   * **IT RETURNS A BOOLEAN BECAUSE ITS CALLER RAN ON EVERY KEYSTROKE, AND THAT CALLER IS THE ONE
   * DECISION 2 DELETED.** `compile.ts`'s `schedule` fired this per keystroke while the post itself was
   * debounced, and a repaint per keystroke is the waste the editor's update listener explicitly
   * declines to pay — so "did anything move" told it which single keystroke had retired a buffer. There
   * is no caller in `src/` to read the answer today (the sentence here named `noSessionReply` below as
   * the one that discarded it, and that call is gone too). **THIS PARAGRAPH SAID §4.4's RETIRE CONTROL
   * WOULD BE "THE READER IT IS KEPT FOR"; THAT CONTROL IS WIRED NOW, AND IT DISCARDS THE ANSWER.** The
   * reason offered — "a list rebuilt around a row that ended nothing would be reporting a gesture that
   * did not happen" — describes a list that KEEPS its rows. `bufferList` builds them on `beforetoggle`,
   * so a row could name a spent buffer only if something had retired it between the open and the click,
   * and there is exactly one retire in the app: that click. A guard on this answer at that call site
   * would be a branch nothing can take. **What the answer is genuinely kept for is the stale-name
   * contract below**, and the tests are what read it: `tests/node/scratch.test.ts` asserts both arms and
   * `tests/browser/scratch-fork.test.ts` asserts the `true` at the layer the list drives this from.
   *
   * IDEMPOTENT, MIRRORING `SessionPool.unbind` AND `SessionRegistry.remove`: a guard every caller must
   * write is a guard the callee should have. **THE MEMBERSHIP CHECK IS ALSO WHAT KEEPS A STALE NAME
   * FROM THROWING** — `entryOf` below raises for an id the registry does not hold, and a caller that
   * kept a buffer's name across the retire that spent it is exactly the caller `false` is the answer
   * for. (That was justified by "most recompiles happen when no buffer exists at all" while a source
   * keystroke was the caller; the stale-name case is what remains, and it was always the sharper one.)
   */
  retire(id: SessionId, home: SessionId, slots: readonly Detachable[]): boolean {
    if (!this.#buffers.has(id)) return false
    for (const slot of slots) {
      if (slot.binding.session === id) slot.rebind(home)
    }
    // 'not compiled' IS THE REASON THE PANE READS FOR THE INSTANT BETWEEN THIS AND THE REBOUND
    // SESSION'S NEXT FRAME — the same wording `main.ts` gives a source session with no program, and
    // true here for the same reason: there is nothing behind this leg any more.
    resetLegs(this.#reg.entryOf(id).legs, null, null, 'not compiled')
    this.#reg.remove(id)
    this.#pool.unbind(id)
    this.#buffers.delete(id)
    return true
  }

  /**
   * A `no-session` reply naming a buffer: the diagnostics to report as a FAILED FORK, or `null` when
   * this buffer's own editor is the right place for them — CRITICAL finding, plan 5d-iii's ninth task.
   *
   * **THIS LINE ENDED "…AND 5d-i DESIGN §4.1a's REMEDY MADE REAL RATHER THAN MERELY PROMISED", AND
   * 5d-ii-c DECISION 2 TOOK THAT BACK.** §4.1a's remedy is "the pane keeps offering ✎ — the user can
   * scrub to a smaller step and fork there", and it was the RETIRE below that delivered it, by putting
   * the pane back on a session it was not stuck on. Reporting the reason is what survives; the way out
   * moves to §4.4's header list, and the paragraph two below is where that debt is recorded.
   *
   * **IT TAKES THE BUFFER THE REPLY NAMED, WHERE IT USED TO READ WHATEVER `retire` WOULD HAVE ENDED.**
   * Its doc said "UNKEYED FOR THE SAME REASON `retire` IS, AND IT READS THE SAME BUFFER `retire`
   * WOULD" — the most recently forked one. That reading was not merely imprecise, it was backwards for
   * the case this method exists to serve: a fork that fails to build is answered by a `no-session` for
   * a buffer with NO frame, and any buffer forked after it has one, so the newest reading looked at a
   * healthy buffer, returned `null`, and left the pane stranded on the phantom — the CRITICAL finding
   * this method was written to close, reopened by a second fork. The reply arrives with its session
   * (`ScratchBuffersConfig.onReply` curries it in per buffer) and that is the buffer this answers for.
   *
   * **AND THE NEXT TASK TOOK THE RETIRE AWAY, WHICH THE PARAGRAPH ABOVE PROMISED IN THESE WORDS**:
   * *"WHAT DOES NOT MOVE IS WHEN THIS FIRES: Task 4 is where this arm stops retiring at all (decision 2:
   * a buffer that failed to build is still a buffer), and doing that here would fold the key and the
   * trigger back into one diff."* The key landed in one task and the trigger in the next; what remains
   * below is the discriminator and the answer. `home: SessionId` and `slots: readonly Detachable[]` went
   * with the call that used them — nothing here moves a pane or ends a session any more, so a signature
   * that still asked for somewhere to send panes would be describing a job this method no longer has.
   *
   * **WHAT THE RETIRE WAS ALSO DOING, SAID PLAINLY RATHER THAN LEFT TO BE MISSED.** It terminated the
   * phantom's worker, forgot the buffer, and rebound the pane back to `home` — and that rebind is what
   * made `SessionEntry.detached` read `false` for that pane again, so `LambdaPane.#refreshDetach`
   * offered `✎ fork` once more, which is 5d-i §4.1a's promised remedy actually happening. **The pane now stays
   * on a buffer that will never produce a frame**, reading the `building…` placeholder `fork` seeded,
   * with the reason on `#link-status` and no PANE-LOCAL way out. That is the same gap `compile.ts`'s
   * `schedule` records for the recompile path, widened to cover every way a buffer can end up wedged:
   * design §4.4 puts poison recovery in the header list precisely because a wedged buffer has to be
   * reachable whether or not a pane is still showing it. **THAT LIST IS WIRED, AND THIS SENTENCE USED TO
   * END "…until that list is wired there is no way to reclaim one at all".** The way out is one gesture
   * away from any state: open `buffers` and retire the row, which rebinds this pane home and offers
   * `✎ fork` again — the remedy 5d-i §4.1a promises, delivered from the header instead of from the pane
   * that is stuck. `tests/browser/scratch-fork.test.ts` asserts exactly that sequence, on the line that
   * used to assert the dead end.
   *
   * `null` FOR AN ID THAT IS NOT A LIVE BUFFER, which is the same answer the no-buffer case always
   * gave. A `no-session` for the SOURCE session never reaches this method (`replies.ts` routes source
   * replies to `onReply`), so the reachable case is a reply landing after its own buffer was retired by
   * the control §4.4 gives the user — nothing to report about a buffer they have already ended.
   *
   * **A `no-session` REACHES A BUFFER FOR TWO REASONS THAT DEMAND OPPOSITE ANSWERS, AND THE WIRE
   * CANNOT TELL THEM APART.** `fork`'s OWN build can fail — the term at the requested step is over
   * `LAMBDA_BYTE_BUDGET`, or (rarely, 5d-i §4.1a) the source's own step-0 print was itself cut, so the
   * replay's first parse fails — and `fork` has ALREADY rebound the pane synchronously, before either
   * of those was knowable (`fork`'s own doc). Left alone, that strands the pane forever: no
   * `scratch-compiled` ever fires, so `main.ts`'s `lambdaPane.setEditor` is never called, `#editor`
   * stays `null`, and `LambdaPane.setDiagnostics` (`this.#editor?.setDiagnostics(ds)`) is a silent
   * no-op — the pane reads the `'building…'` placeholder `fork` seeded forever, and `#refreshDetach`'s
   * `!this.#detached` gate hides the only control that could recover it, because this session IS the
   * one the pane is stuck on. `editScratch`'s recompile can ALSO fail, on a buffer that already has a
   * good build behind it — the ordinary case a user hits on nearly every mid-identifier keystroke —
   * and there 5d-i design §4.4 is explicit: "an edit that does not parse leaves the frames region
   * showing the last good run". Retiring on THAT path would erase the very term that sentence promises
   * to keep, on nearly every keystroke of ordinary editing.
   *
   * **THE TWO REASONS STILL DEMAND OPPOSITE ANSWERS EVEN THOUGH NEITHER ENDS A BUFFER NOW**, which is
   * why the discriminator below survives the deletion of the retire it used to gate. What differs is
   * WHERE THE DIAGNOSTICS GO: a build that never reached `scratch-compiled` mounted no editor, so
   * `setDiagnostics` is the silent no-op this paragraph already describes and `#link-status` is the only
   * surface left; a buffer mid-edit has a mounted editor with a gutter built for exactly this. Reporting
   * a mid-edit parse failure as a failed FORK would also be a lie about which gesture failed.
   *
   * **THE DISCRIMINATOR IS WHETHER THE λ LEG HAS EVER RECORDED A FRAME, AND ITS ARGUMENT CHANGED
   * SHAPE WITH THE SINGLETON.** It used to run: `detach` posts a build only when the scratch does not
   * already exist, so a session with no frame yet can only be mid-`detach`'s first and only build. The
   * premise is gone — every fork posts a build — but the conclusion holds for a simpler reason: a fork
   * posts exactly one build per buffer and posts it at creation, so a buffer with no frame yet has had
   * nothing but that build addressed to it. A buffer that already holds a frame can only be
   * mid-`recompile`, because that is the only other message this class ever posts to an existing
   * buffer. The two cases are still exhaustive and mutually exclusive by construction, not by
   * inspecting which caller happened to trigger this reply.
   *
   * RETURNS THE DIAGNOSTICS ON THE PHANTOM PATH, so the caller has the reason to put on the surface
   * built for it. **THAT SENTENCE OPENED "RETIRES AND RETURNS"**, and the clause it lost is the whole
   * of this task: `retire` did the job (panes home, legs reset, registry and pool forgotten) and no
   * longer runs, so what is handed back is a routing decision rather than a report on something that
   * has already happened. `null` ON THE LIVE-EDIT PATH, where the caller's existing
   * `setDiagnostics`-into-the-editor handling is exactly what 5d-i design §4.4 asks for and this method
   * has nothing to add to it. `null` ALSO WHEN THERE IS NO BUFFER AT ALL, where the singleton's
   * `entryOf` threw: there is no fork to report a failure for, and the caller's editor path is a no-op
   * on a pane holding no editor.
   *
   * **IT ANSWERS WITH THE DIAGNOSTICS RATHER THAN A BOOLEAN, AND THAT IS A CHOICE WORTH ONE LINE NOW
   * THAT NOTHING ELSE HAPPENS HERE.** A `boolean` would make the caller re-derive nothing and read
   * exactly the same — but the caller would then hold two things that must agree (which branch it is on,
   * and which diagnostics belong to it) where it now holds one. The parameter is what the answer is made
   * of, not decoration on a flag.
   */
  noSessionReply(id: SessionId, diagnostics: readonly Diagnostic[]): readonly Diagnostic[] | null {
    if (!this.#buffers.has(id)) return null
    const leg = this.#reg.entryOf(id).legs.lambda
    if (leg !== undefined && leg.hist.current !== undefined) return null
    return diagnostics
  }
}
