import type { PersistedBuffers } from './buffers-store'
import { History } from './history'
import { LEG_NAME, unhandled } from './legs'
import type { LeafId } from './panes'
import type { Leg, RunReply } from './protocol'
import type { SessionId, SessionPool } from './session-client'
import { resetLegs, type SessionLegs, type SessionRegistry } from './sessions'
import type { AsmState, Diagnostic, LambdaState, TmState } from './types'

/**
 * What retiring a buffer needs from a pane slot: which session it is on, and the ability to move it
 * off.
 *
 * A STRUCTURAL TYPE RATHER THAN `PaneSlot<Leg>`, and the reason is variance rather than taste.
 * `PaneSlot<K>`'s `render` takes a `PaneView<LegFrame[K]>` in PARAMETER position, so a
 * `PaneSlot<'lambda'>` and a `PaneSlot<'tm'>` are not two instantiations one signature can name
 * without either a union or method bivariance — and leaning on bivariance to pass a heterogeneous
 * array would be exactly the property `PaneSlot`'s doc in `sessions.ts` states, "the cast a mutation
 * needs is the evidence the types hold", quietly spent. This type asks for the two members retirement
 * actually uses, every `PaneSlot` satisfies it for free, and `Binding<K>`'s leg parameter is untouched
 * because nothing here can see it.
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
 * NOT `SessionEntry`, AND NOT A SUPERSET OF IT. A buffer's entry holds a history, a client and a playback
 * flag; a caller asking "what buffers are there" is asking for a menu, and handing it the machinery
 * would make every reader of that menu a reader of the session model. `SessionEntry.label`'s doc draws
 * the same line from the other side — the label is UI text, the id is a map key.
 */
export type BufferInfo = {
  readonly id: SessionId
  readonly label: string
  readonly warm: boolean
  readonly leg: Leg
}

/** What undoing a delete needs to put a copy back: its id, name, leg, text and collapse flag. */
export type BufferRecord = {
  readonly id: SessionId
  readonly label: string
  readonly leg: Leg
  readonly text: string
  readonly collapsed: boolean
}

/**
 * What this class holds per buffer — `BufferInfo` plus the facts no surface outside renders.
 *
 * **`collapsed` IS WRITTEN AND READ BETWEEN A SNAPSHOT AND A RESTORE — `setCollapsed`/`collapsedOf`
 * BELOW.** `PersistedBuffer` carries the field (5d-ii-d design §4.1), so `snapshot` reads it and
 * `restore` writes it; between those two moments `transport.ts`'s `collapse` handler, reached from
 * `pane-chrome.ts`'s `textPanel`, writes it, and `replies.ts`'s `scratch-compiled` arm reads it back
 * to seed a remount, through `LambdaPane.setEditor`'s second parameter. `fork` seeds it `false`: a
 * freshly forked buffer has never been collapsed by anyone.
 */
type BufferState = {
  readonly id: SessionId
  readonly label: string
  /**
   * Which leg this buffer's session has — 5d-iv design §4.5.
   *
   * IT SELECTS THE REQUEST KIND IN `#spawn` AND THE LEG RECORD BESIDE IT, and it is what a pane's
   * binding must agree with — `SessionRegistry.legOf` throws on a binding naming a leg its session
   * lacks, and this is the field that decides which leg the session was built with.
   */
  readonly leg: Leg
  text: string
  collapsed: boolean
  warm: boolean
}

/**
 * How many buffers may be WARM at once — hold a worker, not merely a record. 5d-ii-d design §4.4/§4.6.
 *
 * **A COLD buffer costs no thread and is UNBOUNDED BY THIS CONSTANT**: `warmCount()` below counts
 * warm buffers, not `#buffers.size`, so `#buffers` can hold as many cooled, retired-in-all-but-name
 * records as a user leaves lying around; only forking a new buffer, or `warm`-ing a cold one back up,
 * spends a seat here.
 *
 * **THE THRESHOLD, PRE-REGISTERED BEFORE ANY NUMBER EXISTED** (5d-ii-d design §4.6): *a page at the cap,
 * with every warm buffer holding a real term and its ring driven to exhaustion, must sit at or
 * below 512 MiB — main-thread resident heap plus summed per-thread wasm linear memory. The cap is
 * the largest count that satisfies it. The threshold does not move.*
 *
 * **8, SET BY A TM COPY, THE COSTLIEST COPY THE APP SHIPS.** `buffer-affordability.test.ts`'s TM
 * case prices a copy of `map-fold` under `binary`, the costliest of the shipped examples' TM
 * copies, and reading (a)'s intercept below derives 8: eight copies came to 485.70 MiB and nine to
 * 541.53 MiB, against 512. Copies of the other kinds cost less. So 8 is the largest count a page of
 * the costliest copy the app ships fits in, AT REST: each copy built and recorded once, to
 * `HISTORY_BYTES` charged, as a copy stops by itself, and shown in no view.
 *
 * **A COPY A VIEW SHOWS ALSO HOLDS ITS VIEW'S TABLES AND ITS EDITOR, WHICH WERE NOT MEASURED.**
 *
 * **TWO COPIES COST MORE, AND NO COUNT PRICES THEM**: a λ copy whose recording is continued, which
 * grows each time it is, and a copy a user writes, which can be larger than any shipped one
 * (`asm-copy-memory.test.ts`).
 *
 * **TWO READINGS, THREE INTERCEPT COMPONENTS APART — THE PROJECT OWNER PICKED THE LITERAL ONE.** The
 * threshold's own words are "every warm BUFFER"; the source session's rings are not a buffer's, so
 * whether they count is a reading of the sentence, not a fact the probe can settle on its own:
 *
 *   * **(a) buffers-only-at-exhaustion — GOVERNS, and SHIPS.** The literal reading: the source
 *     session's fixed thread cost counts (module + arena) but its rings do not, because they are not
 *     simultaneously exhausted the instant every buffer's is — the source session is ordinarily
 *     mid-recording or idle, not pinned at its own ring cap at the same moment N buffers are all pinned
 *     at theirs. Intercept = page/app baseline (a FLOOR — see below), plus the main thread's own wasm
 *     module (the `init()` call in `main.ts`, invisible to a heap reading the same way every worker's
 *     module is), plus that source fixed cost.
 *   * **(b) everything-at-exhaustion — reference only, NOT what ships.** The stricter reading: the
 *     source session's own λ, asm and TM rings ALSO driven to exhaustion at the same instant every
 *     buffer's is, which the threshold's words do not require, since the source session's legs are
 *     not "buffers". Each of those rings is priced for one program, and a ring is bounded by the
 *     bytes it is charged, not the heap it holds, so a program whose frames hold more derives less.
 *
 * **THE CAP IS AN UPPER BOUND, NEVER A MEASURED CEILING.** `pageBaseline` is a FLOOR — a
 * byte-conversion of the page baseline `session-memory.test.ts`'s three-sessions test gives in prose
 * for its own harness page, not a reading either probe ever took of the real app (CodeMirror, the
 * DOM), and that file says outright the real app's figure "is larger still". A floor on one intercept
 * component can only push the TRUE intercept UP and the true safe cap DOWN from what is derived here —
 * never the reverse. The cap is the most this budget can be SHOWN to afford, not a guarantee that it
 * affords exactly that many.
 *
 * **THE REFUSAL'S OWN WORDING UNDERSTATES ITS SCOPE.** `#refuseAtCap`'s message reads "all
 * `MAX_WARM_BUFFERS` copies are running" — true of every WARM buffer, the only kind this constant
 * prices, but readable as a claim about every buffer on the page. A page can hold more buffers than
 * that: a cold buffer costs nothing (see above), so a page with, say, 15 buffers total and 8 of
 * them warm sits exactly at the cap, and `warm` below (asking for one of the seven cold ones back)
 * refuses on a page whose copies menu visibly lists seven that are paused.
 *
 * **WHAT RIDES ON THE FIGURE.** The tests that exercise the cap import this constant rather than
 * spelling a number, so they follow it wherever it goes. `tests/browser/two-lambda-panes.test.ts`
 * needs the cap to be **at least two** — several of its tests fork twice inside a single test, and
 * its reset reclaims buffers between tests (`retireEveryBuffer`) precisely so it needs no more than
 * that. **TWO FILES NEED MORE, THOUGH NONE EXERCISES THE CAP**: their copies outlive their tests,
 * so `copy-edit-leaving.test.ts` has seven on its page by its end and `stage-tab-titles.test.ts`
 * six, and a cap under 7 fails them. `tests/browser/scratch-cap.test.ts` exercises the refusal AT
 * the cap, so it forks as many times as the cap.
 */
export const MAX_WARM_BUFFERS = 8

/**
 * The refusal `fork`, `forkBlank` and `warm` raise at `MAX_WARM_BUFFERS` — 5d-ii-c design §4.5's
 * "refused with a diagnostic naming the list", as a type its caller can act on.
 *
 * **A CLASS RATHER THAN A PLAIN `Error`, BECAUSE THE CALLER HAS TO TELL THIS FROM A BUG.**
 * `transport.ts`'s `forkCopy` and `main.ts`'s handlers catch this one and answer it with a notice
 * (`notice.ts`, Plan 7 part 2 spec §10: refusals at the cap are notices); `SessionRegistry.add`'s and
 * `SessionPool.bind`'s guards over their own invariants (a replaced entry strands its playback; a
 * replaced client misdelivers frames), which the same three methods can raise, are wiring bugs
 * rather than answers to a user. A bare `catch` at any of those sites would answer one of them with
 * a notice and swallow it. `instanceof` is what keeps a refusal a refusal and lets everything else
 * go on being loud.
 *
 * **THE MESSAGE IS THE PAYLOAD AND THERE IS NO SECOND FIELD.** It carries no fixed prefix of its own:
 * the prefix travels with the CALLER, not with this class, so `fork`'s refusal reads as a fork failing
 * and `warm`'s reads as a plain statement of the cap (`#refuseAtCap`'s own doc has the argument). A
 * `live: BufferInfo[]` field would let a caller compose a second wording of the cap-and-labels fact —
 * a different axis from the prefix, and not what that argument is about.
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
 * **NO `id` AND NO `label`.** A fork mints a name per call (`fork` below), so the name is a function of
 * the counter that mints the id and the two cannot be written in different places without being able
 * to disagree. A session's name is decided where the session is CREATED — `main.ts` for the source
 * session, here for a buffer — and never in `sessions.ts`, which holds no name of the app's at all.
 *
 * `onReply` NAMES ITS SESSION. One collection binds many workers through one dependency, so the id is
 * curried in per buffer at `pool.bind` and arrives with the reply; a callback that closed over "the"
 * scratch would deliver every buffer's frames under one name.
 */
export type ScratchBuffersConfig = {
  registry: SessionRegistry
  pool: SessionPool
  /** The ring's cap for each buffer's one leg. `HISTORY_BYTES`, per 5d-i design §4.4's one knob. */
  historyBytes: number
  onReply: (session: SessionId, reply: RunReply) => void
}

/**
 * **THE SCRATCH BUFFERS — 5d-ii-c design decision 1.**
 *
 * Editing a source-derived λ view creates a `LambdaScratch` seeded with the source's step-0 text plus
 * a step — not that pane's own current text; `fork`'s own doc below has the full argument for why —
 * and rebinds THAT pane to it. **The source session is untouched and keeps running** — which is the
 * entire reason more than one session exists rather than one mutable one, and the property
 * `tests/browser/scratch-fork.test.ts` asserts by watching the source's step count advance across a
 * fork. Nothing in this class reads or writes the source session's entry, its client or its legs;
 * `fork` touches the registry, the pool and ONE slot.
 *
 * **A CLASS IN ITS OWN MODULE RATHER THAN CLOSURES IN `main()`, AND THE REASON IS THE TEST.** The
 * claim under test is "two forks produce two buffers", and the axis must be POOL SIZE rather than
 * rendering, because rendering looks right either way. Pool size is not reachable from the DOM, so a
 * test driven entirely through the app cannot make that assertion however many panes it can reach.
 * `tests/node/scratch.test.ts` drives this class over a real `SessionRegistry` and a real
 * `SessionPool` with fake ports, which is the whole mechanism minus the thread.
 *
 * **IT IS ALSO WHERE THE COVERAGE GATE CAN SEE IT.** `vite.config.ts` excludes `session-worker.ts`
 * from the include set for a measured instrumentation reason, so logic placed there moves none of the
 * four numbers; the worker therefore holds only the wasm call, and the minting, the rebinding and the
 * retirement order live here.
 *
 * **EVERY LEG.** A `TmScratch` is built from `.tm` TEXT, and an asm copy from asm text, the same way a
 * `LambdaScratch` is built from λ text, and `#spawn` below reads `state.leg` — set once, at mint, and
 * never written again — to pick both the request kind it posts (`client.scratch`, `client.tmScratch`
 * or `client.asmScratch`) and the one leg record it builds for the registry. One class with a field,
 * not a class per leg, because everything past that branch — the id, the cap, the retirement order,
 * the snapshot shape — is identical work for every leg.
 *
 * **`fork`'S FOURTH PARAMETER AND `forkBlank` ARE THE TWO DOORS IN, AND THEY ARE NOT THE SAME DOOR
 * NARROWED TWICE.** `fork` seeds a new buffer from a source-derived VIEW; passing `'tm'` there answers
 * "what leg is this view's text written in", not "go find some `.tm` text and fork it". `forkBlank`
 * mints a warm, empty buffer on `leg` and binds no pane to it, so its first text is whatever a user
 * types or pastes into it once it exists, not a fork of anything already on screen.
 *
 * `options('tm')` OFFERS A TM BUFFER THE MOMENT ONE IS MINTED. `SessionRegistry.options` answers from
 * `entry.legs[leg] !== undefined`, and `#spawn`'s TM branch is what sets that leg on a TM buffer's
 * entry — so the selector needs no change of its own to offer one.
 */
export class ScratchBuffers {
  #reg: SessionRegistry
  #pool: SessionPool
  #bytes: number
  #onReply: (session: SessionId, reply: RunReply) => void

  /**
   * Every live buffer, in the order it was forked.
   *
   * A `Map` KEYED BY THE SESSION ID, because that is what every caller has: a pane holds a binding, a
   * reply names a session, and the header list retires by id. INSERTION ORDER IS THE LIST'S ORDER for
   * `SessionRegistry`'s own reason — `Map` iterates in insertion order and buffers are created one at
   * a time, so "oldest first" falls out without a comparator that would have to invent a rank for a
   * name.
   *
   * IT IS NOT A SECOND REGISTRY. The entry, the legs, the client and the thread all live where they
   * already did; this holds the two facts the registry cannot answer as a set — WHICH of its sessions
   * are buffers, and in what order they were made.
   *
   * **A RECORD MAY OUTLIVE ITS SESSION.** A cold buffer is in this map and in neither container behind
   * `legOf`, by construction (5d-ii-d design §4.2), and `SessionRegistry.entryOf` throws for an id it
   * does not hold. The row builder reads `sessions.legOf(...)` only when `b.warm` is true and reads
   * `null` for a cold row otherwise, so a cold buffer's row reads *paused* (`buffer-list.ts`'s
   * `BufferRow.warm` has the argument for why that reads differently from "no term"). The copies menu's
   * pause/resume control has its own call to `cool` (`main.ts`'s temperature handler), so a buffer goes
   * cold on a gesture with no retire anywhere in it — the row builder's `warm` branch is what makes
   * that safe, not this map's record-keeping.
   *
   * **`recompile` DEPENDS ON THE SAME FACT**: it checks `warm` before `this.#reg.entryOf(id)`, which
   * would throw for a cold buffer's id. `recompile`'s own doc has the route by which an edit reaches a
   * cold buffer.
   */
  #buffers = new Map<SessionId, BufferState>()

  /**
   * How many buffers have EVER been minted, which is deliberately not how many are live.
   *
   * A RETIRED BUFFER'S NAME IS NOT REISSUED. Reusing `copy 1` for the buffer forked after the first
   * one was retired would put two different terms under one name inside a single session — and the
   * name is the only handle a user has on a buffer no pane is showing (5d-ii-c design §4.2's list). A
   * counter that only goes up costs nothing and cannot produce that.
   *
   * **`restore` BELOW WIDENS THAT CLAIM TO SPAN RELOADS.** This counter is what `snapshot` persists and
   * what `restore` sets, so the name a page mints after a reload is past every name the previous page
   * minted — including buffers that were retired before it closed and are therefore in no restored
   * record. That is why the stored payload carries the COUNTER and not the count; `buffers-store.ts`'s
   * `PersistedBuffers` has the argument from the format's side. `restore` is the one writer here that
   * does not increment, and its own doc says why assigning is safe.
   */
  #minted = 0

  constructor(config: ScratchBuffersConfig) {
    this.#reg = config.registry
    this.#pool = config.pool
    this.#bytes = config.historyBytes
    this.#onReply = config.onReply
  }

  /**
   * Fork `slot` onto a NEW scratch buffer on `leg`, seeded with `src`, and answer the buffer's id.
   *
   * **THERE IS NO `has` BRANCH, AND ITS ABSENCE IS THE WHOLE OF 5d-ii-c DECISION 1.** A fork that
   * happens spawns, seeds, and names its own buffer. `SessionRegistry.add` and `SessionPool.bind` both
   * refuse an id they already hold, and both stay as guards over their own invariants (a replaced entry
   * strands its playback; a replaced client misdelivers frames) rather than over anything
   * this call site does: `#minted` only ever goes up, so the id below is one neither container has seen.
   *
   * **THE SEED IS THE SOURCE'S STEP-0 TEXT PLUS A STEP, AND THIS FUNCTION DOES NOT GO LOOKING FOR
   * EITHER.** Not "that pane's current text": the pane's own 512-byte frame is where most non-trivial
   * terms truncate (5d-iii design §3.1). The caller supplies the source session's step-0 term (from the
   * `compiled` reply, at `LAMBDA_BYTE_BUDGET`) and the step the pane was showing, and the worker
   * re-derives the term between them. The rule is that this function is handed its inputs rather than
   * resolving them, so the seed and the screen cannot disagree without something reporting it.
   *
   * **IT RETURNS THE ID IT MINTED** (5d-ii-c design §4.1). The caller needs the name to record what the
   * pane is now on — `pane-host.ts` claims custody of the editor for it — and returning it is what
   * keeps minting in ONE place rather than having a caller derive the next name and be wrong the first
   * time two of them run.
   *
   * **THE ONE CONDITIONAL IS A REFUSAL, AND IT DOES NOT MAKE A FORK MEAN TWO THINGS.** Every call that
   * returns does the same things in the same order; the branch decides whether this method runs at all
   * rather than what a fork means when it does. A second outcome that RETURNED AN ID would be the thing
   * to guard against; a throw is not one, because no caller can mistake it for a fork.
   *
   * **AT `MAX_WARM_BUFFERS` IT REFUSES, AND REFUSING IS THE ONLY THING A CAP MAY DO HERE** (5d-ii-c
   * design §4.5). Making room by retiring the oldest buffer would end a buffer nobody named, which is
   * precisely what 5d-ii-c decision 2 forbids — an eviction is that rule broken under the name of a
   * limit, and the work it would throw away is a term the user typed. So the count is a refusal and
   * never a policy about which buffer dies. `tests/node/scratch.test.ts` asserts the list is still full
   * AFTER the refusal, because a version that evicted would pass a test that only checked the throw.
   *
   * **THE REFUSAL IS THE FIRST THING IN THE BODY, WHICH IS WHERE IT HAS TO BE.** Everything below
   * mutates something outside this object — the counter, the pool, the registry, the slot — and each of
   * those is a container the collection would then be out of step with. A guard placed after
   * `SessionPool.bind` in particular would leave a running worker for a buffer `#buffers` never
   * recorded, so nothing could ever retire it: the leak the cap exists to bound, created by the cap.
   *
   * **THE RECORD IS INSERTED AFTER `#spawn` RETURNS** (in `#mint`). Inserted before it, a throw from
   * `SessionPool.bind` or `SessionRegistry.add` inside `#spawn` would leave a COLD record in `#buffers`
   * for a buffer that was never warm and never will be — a record whose temperature does not match
   * whether it has a thread. `#spawn` takes the `BufferState` object directly (see its own doc) and
   * mutates it in place, so the insertion only runs once `#spawn` has already bound the client and
   * registered the session without throwing — nothing is recorded until it is real.
   *
   * **THAT ORDER HAS THE SHAPE OF THE OTHER HAZARD, AND IT IS ACCEPTABLE HERE RATHER THAN OVERLOOKED.**
   * A throw INSIDE `#spawn` — after `#pool.bind` has already bound a client but before `#reg.add`
   * returns — would leave a running worker with no `#buffers` record at all: "the leak the cap exists to
   * bound, created by the cap." Ordering alone cannot rule out both hazards; only one of the two throws
   * this class can actually reach matters here. `SessionPool.bind` and `SessionRegistry.add` both throw
   * on exactly one condition — a duplicate id — and `#minted` only ever counts up, so the id `fork`
   * mints on this call has never been seen by either container; nothing in `#spawn` can trigger that
   * throw for it. Trading a real, reachable hazard for one neither container can raise against a
   * freshly minted id is the trade worth making.
   *
   * **THE REFUSAL IS ONE CALL.** `warm` and `forkBlank` refuse at the same cap, and `#refuseAtCap` is
   * the one place the throw is written; see its own doc for the message itself.
   *
   * **THE MESSAGE NAMES THE CONTROL THAT ENDS ONE**, because "no" on its own would leave a user holding
   * a pane with no account of how to get the room back.
   *
   * **IT DOES NOT NAME THE BUFFERS.** The names are `copy 1` through `copy N` BY CONSTRUCTION — a
   * counter's output, carrying nothing that distinguishes one buffer from another — so an enumeration
   * would be noise that grows with the cap, standing between the diagnosis and the only actionable
   * clause in the sentence. `buffer-list.ts` gives every row its buffer's current TERM, so "what is
   * using the room" is a glance at the surface this sentence already points at — answered with the one
   * fact that differs between buffers rather than with one copy of a counter per buffer.
   *
   * THE COUNT IS IN IT, because it is the thing the user cannot see from the button (`copies 8 ▾` says
   * how many exist, not that eight is the limit) and it is what makes the refusal a rule rather than a
   * malfunction.
   *
   * **AND IT REACHES A SURFACE, WHICH IS THE HALF OF 5d-ii-c §4.5 A THROW ON ITS OWN DOES NOT
   * DELIVER.** The only caller in `src/` is `transport.ts`'s `forkCopy`, running inside the
   * `edit a copy` item's own click listener (`view-header.ts`'s `viewMenu`); it catches
   * `BufferCapReached` and hands the message to its `notify` dependency, so it is shown as a notice
   * (`notice.ts`). **THE `cannot make a copy — ` WORDS ARE PART OF THIS THROW'S OWN MESSAGE, NOT
   * SOMETHING THE RENDERER ADDS** — `#refuseAtCap`'s own doc has the argument for why the prefix lives
   * at the call site. `replies.ts` composes its own prefix for the SIBLING refusal — a fork whose build
   * fails, worded `the copy did not build — ` because that is the gesture THAT call site names —
   * for the same reason. **Uncaught, it would reach nothing**: there is no `window` error handler in
   * `src/` (`main.ts`'s is a WORKER `error` listener, which a main-thread click never reaches), so the
   * message would go to the console and the user would see no answer at all.
   *
   * **NOTHING IS LEFT HALF-DONE ON THE REFUSED PATH**, which is what makes the catch a report rather
   * than a repair: this method mutates nothing before it refuses, the slot is still on the session it
   * was on, and `pane-host.ts`'s wrapper claims custody only when the binding actually moved.
   *
   * **ON THE λ LEG, `text: src` (IN `#mint`) IS A PROVISIONAL SEED, IT IS THE WRONG TERM, AND IT IS
   * DURABLE BEFORE THE WORKER ANSWERS.** `src` is the SOURCE session's step-0 term, which 5d-ii-d
   * design §3.4 itself calls "the wrong string anyway": the worker re-derives this buffer's term at
   * `step` from it, and `replies.ts`'s `scratch-compiled` arm is what replaces the seed with that. The
   * gap between the two is not private, because the caller (`transport.ts`'s `forkCopy`) calls
   * `onBuffersChanged` on its success path, which reaches `main.ts`'s `refreshBuffers` and therefore
   * `persistBuffers` — synchronously, in the same click, before any reply can land. So the seed is
   * written to `redextape.buffers` as this buffer's text.
   *
   * **THE CONSEQUENCE, STATED RATHER THAN LEFT TO BE DISCOVERED: A FORK WHOSE BUILD NEVER SUCCEEDS
   * PERSISTS THE SOURCE'S STEP-0 TERM, AND A RELOAD WARMS IT SUCCESSFULLY AT STEP 0.** A build can fail
   * (the term at `step` is over `LAMBDA_BYTE_BUDGET`, or the source's own step-0 print was itself cut —
   * `noSessionReply`'s doc has both), and 5d-ii-c decision 2 means nothing retires the buffer for it. Its
   * record keeps the seed forever, so the next page load restores a buffer that builds and runs while
   * holding a DIFFERENT term from the one the user forked. The buffer is still theirs and still named
   * by the counter (`copy N`); what it contains is the program they forked FROM rather than the point
   * they forked AT.
   *
   * **DEFERRING THIS PERSIST WAS CONSIDERED AND IS NOT A FIX, WHICH IS WHY THIS IS DOCUMENTED RATHER THAN
   * CHANGED.** Moving the write to the `scratch-compiled` arm that already persists would only narrow the
   * window: the RECORD carries `text: src` either way, and other sites persist the whole collection (a
   * recorded term, a rebind, a collapse, and `pane-host.ts`'s `applyLayout`), so any later gesture writes
   * the same seed out. Actually removing the consequence means not seeding `text` with `src` at all — and
   * the honest alternative, an empty seed, makes a failed fork restore as an EMPTY buffer, which trades a
   * wrong term for lost work and is a design decision rather than a repair. The seed stays because it is
   * also what makes the record non-empty for every fork that DOES build, in the round trip before the arm
   * replaces it.
   */
  fork(slot: Detachable, src: string, step: number, leg: Leg): SessionId {
    // `'cannot make a copy — '` — THIS IS THE ONE CALLER OF `#refuseAtCap` FOR WHICH THAT IS TRUE. See
    // `#refuseAtCap`'s own doc for why the prefix is a call-site argument rather than baked into the
    // shared message.
    if (this.warmCount() >= MAX_WARM_BUFFERS) this.#refuseAtCap('cannot make a copy — ')
    return this.#mint(src, step, leg, slot)
  }

  /**
   * Mint a warm, EMPTY buffer on `leg` and bind no pane to it — 5d-iv design §4.7's second gesture.
   *
   * **A SECOND METHOD RATHER THAN A NULLABLE `slot` ON `fork`, BECAUSE THEY ARE TWO INTENTIONS.** A
   * fork detaches a pane onto a copy of what it was showing; this makes somewhere to paste a `.tm`
   * file into. Folding them would give `fork` a parameter whose null case means something the name
   * does not say.
   *
   * NO PREFIX ON THE REFUSAL — this is not a fork, so `#refuseAtCap`'s call-site prefix argument puts
   * it in the same class as `warm`.
   */
  forkBlank(leg: Leg): SessionId {
    if (this.warmCount() >= MAX_WARM_BUFFERS) this.#refuseAtCap('')
    return this.#mint('', 0, leg, null)
  }

  /**
   * What `fork` and `forkBlank` share: mint the name, spawn the thread, record it, bind if asked.
   *
   * `slot` IS WHERE THE TWO CALLERS DIFFER IN KIND: `fork` passes a `Detachable` it must then rebind,
   * `forkBlank` nothing at all. `slot?.rebind(id)` below is the whole of that fork — a `null` here is
   * `forkBlank`'s own claim that no pane is owed a move.
   */
  #mint(src: string, step: number, leg: Leg, slot: Detachable | null): SessionId {
    this.#minted += 1
    const id: SessionId = `scratch-${this.#minted}`
    // `copy N` — THE LEG IS SAID WHEREVER THE LABEL IS SHOWN (`nameOf`, `view-header.ts`'s `pairLabel`),
    // so the label carries only the number (Plan 7 part 2 spec §12).
    const label = `copy ${this.#minted}`
    const state: BufferState = { id, label, leg, text: src, collapsed: false, warm: false }
    this.#spawn(state, src, step)
    this.#buffers.set(id, state)
    slot?.rebind(id)
    return id
  }

  /**
   * Give a cold buffer a worker again and rebuild it from its text.
   *
   * **AT STEP 0, WHERE `fork` PASSES THE STEP THE PANE WAS SHOWING.** After a build the text IS the
   * term — which is exactly what `recompile` already means and why it posts 0 — so there is nothing to
   * replay to. A restored buffer therefore comes back at the head of a fresh run rather than where its
   * play head was, and the ring it had is gone: that is the cost 5d-ii-d design §4.5 weighs when it
   * declines to auto-cool an orphan.
   *
   * THROWS FOR AN UNKNOWN ID rather than answering `false` like `cool` does. A cool asks for a state
   * that may already be true; a warm names a buffer whose text this class is being asked to rebuild,
   * and there is no honest rebuild of a buffer that does not exist.
   */
  warm(id: SessionId): void {
    const state = this.#buffers.get(id)
    if (state === undefined) throw new Error(`not a buffer: ${id}`)
    if (state.warm) return
    // NO PREFIX — a warm is never a fork, whether it is asked for from the header list's warm control
    // (`main.ts`'s temperature handler) or from a restore rebuilding what a previous page left cold
    // (`main.ts`'s restore loop). `#refuseAtCap`'s own doc has the argument in full.
    if (this.warmCount() >= MAX_WARM_BUFFERS) this.#refuseAtCap('')
    this.#spawn(state, state.text, 0)
  }

  /**
   * Put buffer `id` to sleep: rebind any pane still on it to `home`, terminate its worker, forget its
   * session, keep its text. Answers whether it went from warm to cold.
   *
   * **THE NON-DESTRUCTIVE ESCAPE FROM THE CAP, AND THAT IS WHY IT EXISTS** (5d-ii-d design §4.5). With
   * the cap counting threads, a user who reaches it would otherwise have exactly one way out — an
   * explicit retire, which ends a buffer and its text. A cap that never evicts but leaves no other exit
   * would destroy work by omission, which is 5d-ii-c decision 2 defeated rather than honoured.
   *
   * **IT REBINDS ITS PANES — A DESIGN DECISION, THE PROJECT OWNER'S.** A pane left bound to the buffer
   * this put to sleep would keep naming it, which would make warming it again put the pane back in
   * front of its own term; but a pane pointed at a cold buffer sits on a session `legOf`/`entryOf`
   * cannot resolve, so every caller downstream of a binding, `draw()` among them, would have to
   * special-case "cold" or crash on it. `retire` rebinds for exactly this reason, and `cool` does the
   * identical thing. Warming the buffer again does not put the pane back on it — a user who wants that
   * back rebinds through the selector, the same gesture that reaches any other session.
   *
   * **THE REBIND TAKES THE EDITOR DOWN, AND THE ARRIVING SIDE BUILDS A NEW ONE.** `draw()` reaches
   * `LambdaPane.setDetached(false)`, whose teardown calls `setEditor(null)`; a view that is not on the
   * page is not drawn, and the slot `pane-host.ts`'s `reseedingSlots` hands this method makes that call
   * as it rebinds. `pane-host.ts`'s `mountScratchEditor` restores editability, seeding from `editorSeed`
   * below; without it a cooled buffer could never be edited again, and
   * `tests/browser/buffer-cool-warm.test.ts` drives the whole round trip.
   *
   * **THE INVARIANT THIS BUYS: A COLD BUFFER HAS NO PANES BOUND TO IT.** It holds as long as a caller
   * hands this method every slot that MIGHT be bound to `id`: the `paneHost.reseedingSlots()` call in
   * `main.ts` is what the real app passes — every pane's slot, since `reseedingSlots` wraps
   * `panes.all()` — the same set `retire` is handed for the same reason.
   *
   * **THE REBIND RUNS EVEN WHEN THE BUFFER IS ALREADY COLD, AND THE RETURN VALUE DOES NOT SAY SO.** A
   * second `cool` on an already-cold buffer still walks `slots` and still rebinds anything it finds
   * still pointing at `id` — which, by the invariant above, should be nothing, so this is a pass that
   * finds nothing to do rather than one that is skipped. `retire` relies on exactly that: it is
   * `cool(...)` followed by forgetting the record, and if `id` arrives already cold that call still
   * catches a straggling pane the invariant says should not exist. `retire`'s own doc has the argument
   * in full. The `false` this answers for an already-cold buffer is about the TEMPERATURE — nothing
   * left to warm-to-cold — not about whether any rebinding happened.
   *
   * THE ORDER AFTER THE REBIND: legs before registry (through `resetLegs`, ahead of the entry that owns
   * them being deleted), registry before pool (`SessionRegistry.remove`'s own doc — terminating a thread
   * is never the registry's job).
   *
   * **"KEEP ITS TEXT" INCLUDES THE LAST KEYSTROKE.** The text `warm` later rebuilds from is whatever
   * `setText` last wrote, and `setText`'s own doc names its callers: `recompile`, driven by
   * `ScratchEditor`'s own 300ms debounce (`editor-debounce.ts`'s `EDITOR_DEBOUNCE_MS`), not by every
   * keystroke. The rebind a few lines up is what takes the copy's editor down, so an editor that
   * cancelled its pending debounce there would lose a keystroke typed inside that window and followed by
   * a pause before the timer fired. The pause's handler in `main.ts` sends the pending edit first
   * (`EditorCustody.flush`), and an editor that comes down sends what it held (`destroy()` flushes). An
   * edit that still arrives after this method has put the buffer to sleep is recorded too
   * (`recompile`'s own doc names the route).
   */
  cool(id: SessionId, home: SessionId, slots: readonly Detachable[]): boolean {
    const state = this.#buffers.get(id)
    if (state === undefined) return false
    for (const slot of slots) {
      if (slot.binding.session === id) slot.rebind(home)
    }
    if (!state.warm) return false
    // 'not compiled' IS THE REASON THE PANE READS FOR THE INSTANT BETWEEN THIS AND THE REBOUND
    // SESSION'S NEXT FRAME — the same wording `replies.ts` gives a source session with no program, and
    // true here for the same reason: there is nothing behind this leg any more.
    resetLegs(this.#reg.entryOf(id).legs, {}, 'not compiled')
    this.#reg.remove(id)
    this.#pool.unbind(id)
    state.warm = false
    return true
  }

  /** How many buffers hold a worker — the quantity `MAX_WARM_BUFFERS` bounds (5d-ii-d design §4.4). */
  warmCount(): number {
    let n = 0
    for (const b of this.#buffers.values()) if (b.warm) n += 1
    return n
  }

  /**
   * Record the term buffer `id` now holds — 5d-ii-d design §4.3's "text of record", read back by `warm`
   * on every restart and by `snapshot` for the field a page reload rebuilds a buffer from, PROVIDED the
   * write this method makes is followed by a `persistBuffers()`/`onBuffersPersist()`; see below. This
   * method itself only ever touches memory — it has no idea whether either caller pairs it with one.
   *
   * **TWO CALLERS, AND ONLY ONE OF THEM IS A DURABILITY MOMENT.** `recompile` below calls it with the
   * user's own just-typed text, at the point a rebuild is POSTED, not answered — nothing persists
   * there. `replies.ts`'s `scratch-compiled` arm calls it with its reply's text — for a FORK, the
   * worker's re-derived term and the first moment this app can know what a forked buffer holds at all,
   * since `fork` posts the SOURCE session's step-0 text plus a step and the worker replays between
   * them; for a `recompile`'s own reply, the text `recompile` wrote, answered back as it was typed (a
   * build at step 0 is answered with the text it was given: `session.rs`'s `lambda_scratch_at`) — and,
   * under the SAME `reply.text !== null` guard, calls `onBuffersPersist()` (both lines are in
   * `replies.ts`'s `scratch-compiled` arm, the `setText` and the persist below it). That PAIRING, not
   * the call to this method alone, is what makes it a durability moment; `recompile`'s call has no such
   * pairing anywhere in its body.
   *
   * **SO A `recompile` WHOSE BUILD FAILS LEAVES THIS METHOD'S WRITE STRANDED IN MEMORY.** Unparseable
   * input and a term over `LAMBDA_BYTE_BUDGET` both answer `no-session` (5d-iii §4.1a), which carries
   * no text, so the `scratch-compiled` arm's `setText`/persist pair never runs and nothing ever
   * persists the text `recompile` wrote. The typed text stays live in this record — a caller reading
   * `text` back before the next reload still sees it — but a reload restores whatever WAS durable
   * before the edit, not what the user just typed.
   *
   * Neither writer could read the field back off the `ScratchEditor` instead: `editor-custody.ts` owns
   * that editor's lifetime and retires orphans, so a buffer whose editor was never mounted — a fork
   * whose build failed — would have no text to read.
   */
  setText(id: SessionId, text: string): void {
    const state = this.#buffers.get(id)
    if (state !== undefined) state.text = text
  }

  /**
   * Remember whether buffer `id`'s editor is collapsed — 5d-ii-d design §4.7: PER BUFFER, because the
   * editor MOVES between panes under `editor-custody.ts`, and a flag remembered against a leaf would
   * describe whichever buffer landed there next.
   *
   * **A NO-OP FOR AN UNKNOWN `id`, LIKE `setText` ABOVE, NOT A THROW LIKE `warm`'s.** The one caller,
   * `transport.ts`'s `collapse` handler, reads `slot.binding.session` off a live pane's slot.
   */
  setCollapsed(id: SessionId, collapsed: boolean): void {
    const state = this.#buffers.get(id)
    if (state !== undefined) state.collapsed = collapsed
  }

  /**
   * Whether buffer `id`'s editor was collapsed. `false` for an id that is not a buffer.
   *
   * **`false` RATHER THAN `undefined`.** Every caller hands this straight to a `collapsed` parameter that
   * itself defaults to `false` (`setEditor`'s, `receiveEditor`'s) — an `undefined` here would agree with
   * that default by coincidence rather than by the type saying so, and a caller that ever stopped relying
   * on the default would be handed a value this method never actually observed a buffer holding.
   */
  collapsedOf(id: SessionId): boolean {
    return this.#buffers.get(id)?.collapsed ?? false
  }

  /**
   * Everything a pane needs to mount buffer `id`'s editor without waiting for a worker: the text of
   * record and the collapse flag, together. `null` for anything that is not a WARM buffer.
   *
   * **THIS EXISTS BECAUSE A PANE CAN ARRIVE AT A BUFFER LONG AFTER THE REPLY THAT WOULD HAVE SEEDED IT
   * — the editor's half of the repair `pane-host.ts`'s `tmProgramOf` performs.** A copy's build reply in
   * `replies.ts` (`scratch-compiled`, `tm-scratch-compiled`, `asm-scratch-compiled`) mounts its editor,
   * and it fires once per build; a pane that binds to the buffer afterwards has nothing to mount from,
   * because the reply has been and gone. A `cool` followed by a `warm` is the path that reaches that
   * state: `cool` rebinds every pane away (its own invariant), so the editor is destroyed by
   * `setDetached(false)`'s teardown, and `warm` posts a build that lands with no pane claiming a leaf, so
   * `editorHome` answers `undefined` and nothing mounts. Without a seed to mount from, `cool` —
   * "the non-destructive escape from the cap" (see its own doc) — would be destructive of editability.
   *
   * **BOTH FIELDS IN ONE ANSWER, NOT `textOf` PLUS `collapsedOf`.** `LambdaPane.setEditor` takes them
   * together and its mount branch reads both in the same statement, so two accessors would be two reads
   * a caller has to remember to pair — the same pairing `replies.ts`'s `scratch-compiled` arm already
   * makes by hand and the one thing a second mount site could get wrong silently (5d-ii-d design §4.7:
   * the flag "takes effect when the buffer warms and mounts an editor"). `collapsedOf` stays for the
   * caller that genuinely has only that question.
   *
   * **`null` FOR A COLD BUFFER, WHICH IS THE INVARIANT RESTATED RATHER THAN A MISSING CASE.** A cold
   * buffer has no panes bound to it (`cool`'s own doc), so no pane can ask this about one; answering
   * with text anyway would hand a caller a seed for a session `entryOf` cannot resolve, which is the
   * state `draw()` throws on. `null` is also the honest answer for the source session and for any id no
   * fork ever minted — the same answer, for the same reason: there is no buffer here to edit.
   */
  editorSeed(id: SessionId): { text: string; collapsed: boolean } | null {
    const state = this.#buffers.get(id)
    if (state === undefined || !state.warm) return null
    return { text: state.text, collapsed: state.collapsed }
  }

  /**
   * Refuse a fork or a warm at the cap — the one throw `fork`, `forkBlank` and `warm` share.
   *
   * ONE METHOD, SO THERE IS ONE STRING TO GET RIGHT and one place a future wording change has to reach:
   * a copy of the message at each call site, or a quotation of it, would drift with nothing to force
   * the copies together. `never` rather than `boolean` because every call site throws immediately and
   * never branches on a return value; the type says what the control flow already does.
   *
   * READS AS A SENTENCE ON ITS OWN, WITH ROOM FOR A CALLER'S OWN PREFIX AHEAD OF IT — no "the fork was
   * refused" clause, because the sentence itself must stay honest for a caller that never attempted one.
   *
   * **`prefix` IS WHAT THE CALLERS DO NOT SHARE, AND IT IS A PARAMETER RATHER THAN SOMETHING BAKED IN
   * HERE OR IN THE RENDERER.** A renderer that cannot tell its callers apart has no honest way to prefix
   * only some of them, and `warm`'s refusal reaches the same field as `fork`'s over restore/header-list
   * paths that are not forks. `fork` passes `'cannot make a copy — '`, because that call genuinely is a
   * copy refused. `warm` passes `''`: warming a cold buffer back up — whether the user asked for that
   * from the header list or a restore is doing it on their behalf — is a different gesture, and the
   * plain sentence (cap and remedy, no gesture named) is exactly what is true of it. Hence a semicolon
   * rather than a second dash in the body: the body still has to read correctly with nothing in
   * front of it.
   */
  #refuseAtCap(prefix: string): never {
    throw new BufferCapReached(
      `${prefix}all ${MAX_WARM_BUFFERS} copies are running; pause or delete one from the copies menu to make room`,
    )
  }

  /**
   * Bind a worker, register the session, and post the build. The half of `fork` a `warm` repeats.
   *
   * **TAKES THE RECORD ITSELF, NOT ITS ID.** Reading `this.#buffers.get(id)` here would assume the
   * caller had already put the record into `#buffers` — true for `warm`, and not for `fork`, whose
   * record is inserted AFTER this method returns (`fork`'s own doc has the reason). A wiring bug that
   * called it before the record existed would then not throw: `reg.add` would register the session
   * under a fallback label, and `state.warm = true` would silently do nothing — so `warmCount()` would
   * under-count a live, running thread FOREVER, with nothing anywhere to report it. Taking the record
   * removes the possibility rather than guarding against it: this method never reads `#buffers` at all.
   */
  #spawn(state: BufferState, src: string, step: number): void {
    // THE REPLY CARRIES THE ID BECAUSE THE WIRE DOES NOT (5d-i §3.2: the port is the id). One
    // collection, one `onReply`, many threads — so the name is closed over HERE, per buffer, at the
    // one place that knows which thread it just made.
    const client = this.#pool.bind(state.id, (reply) => this.#onReply(state.id, reply))
    this.#reg.add({
      id: state.id,
      label: state.label,
      // `detached: true` BY CONSTRUCTION, AND NOTHING CAN SET IT OTHERWISE. 5d-i §3.3 is why it is
      // knowable at creation: `linkIndex` and `sourceSpan` exist on no scratch type, so a
      // scratch session can never participate in the sync anchor. `main.ts`'s source entry is the
      // only one in the app that may say `false`, and its own comment says so.
      detached: true,
      client,
      legs: this.#pendingLegs(state.leg),
      // **`null` AT CONSTRUCTION FOR EVERY LEG, AND THE REASON IS NOT THE SAME FOR EVERY ONE.** A λ buffer
      // never gets a machine at all — its worker answers `scratch-compiled`, which carries no
      // `TmProgram` (5d-i §3.3: no TM leg, no `SourceMap`), and no TM pane can ever bind to it either,
      // so nothing will ever write here; nor does an asm copy's `asm-scratch-compiled` carry one. A TM
      // buffer's worker DOES answer `tm-scratch-compiled`, which DOES carry a `TmProgram`, and
      // `replies.ts`'s `onScratchReply` stores it here, with the file's status and value reading in
      // `tmScratch`, once that reply arrives. What is shared between the legs is that none has either at
      // the moment this entry is created, and for a λ or asm buffer that is permanent.
      tmProgram: null,
      tmScratch: null,
      // AN ASM COPY'S LISTING AND READING, written by `replies.ts`'s `asm-scratch-compiled` arm as a TM copy's machine
      // is; `null` for good on a λ or TM copy, which has no asm leg.
      asmProgram: null,
      asmScratch: null,
    })
    state.warm = true
    // SUPERSEDE THEN POST, the order `compile.ts`'s `schedule` also keeps: a fresh client is at
    // generation 0, which its reply filter matches to nothing (`SessionClient`'s constructor), so the
    // claim has to happen before the post or the client would drop the request's own replies.
    const gen = client.supersede()
    switch (state.leg) {
      case 'lambda':
        client.scratch(gen, src, step)
        break
      case 'tm':
        // NO STEP ON THE TM SIDE, FOR `SessionClient.tmScratch`'s OWN REASON: a machine has no step-k
        // term to replay to, since its text IS the machine. `step` is still a parameter of this method —
        // `warm` passes it as `0` for every leg, `#mint` forwards whatever `fork` was handed — and simply
        // goes unread on the arm that has nothing to replay.
        client.tmScratch(gen, src)
        break
      case 'asm':
        // NO STEP, FOR THE TM ARM'S REASON: an asm copy's text is its program, run from its first instruction.
        client.asmScratch(gen, src)
        break
      default:
        unhandled(state.leg)
    }
  }

  /**
   * A new buffer's one leg, not built yet — the `legs` record `#spawn` registers.
   *
   * NOT AVAILABLE YET, WITH A REASON A PANE CAN READ. A session holds at most one leg per `Leg`, and
   * this is where that is decided for a buffer.
   */
  #pendingLegs(leg: Leg): SessionLegs {
    const status = { available: false, reason: 'building…' }
    switch (leg) {
      case 'lambda':
        return { lambda: { hist: new History<LambdaState>(this.#bytes), status, done: null, playing: false } }
      case 'tm':
        return { tm: { hist: new History<TmState>(this.#bytes), status, done: null, playing: false } }
      case 'asm':
        return { asm: { hist: new History<AsmState>(this.#bytes), status, done: null, playing: false } }
    }
  }

  /**
   * A copy's name as the copies menu and every notice say it — `λ copy 1`, `TM copy 2` — or `null` for an id
   * this holds no copy under. The label is `copy N`; the leg is said in front of it, because a title already
   * says the leg its own way (`λ · copy 1`) and a label carrying it would say it twice there.
   */
  nameOf(id: SessionId): string | null {
    const b = this.#buffers.get(id)
    return b === undefined ? null : `${LEG_NAME[b.leg]} ${b.label}`
  }

  /** What undoing a delete needs to put a copy back: its id, name, leg, text and collapse flag. */
  recordOf(id: SessionId): BufferRecord | null {
    const b = this.#buffers.get(id)
    return b === undefined ? null : { id: b.id, label: b.label, leg: b.leg, text: b.text, collapsed: b.collapsed }
  }

  /**
   * Put a deleted copy back, COLD, under its own id and name — Plan 7 part 2 spec §10's undo. The caller
   * warms it, and a refusal at the cap leaves it paused, which is still a copy restored.
   *
   * **THE ID CANNOT HAVE BEEN REUSED:** `#mint` only counts up, so a deleted `scratch-3` is never minted again,
   * and an id this still holds is a wiring bug — thrown, as `SessionRegistry.add` throws.
   *
   * **A RESTORED COPY GOES TO THE END OF THE MAP, SO THE COPIES MENU IS NO LONGER OLDEST-FIRST FOR IT.**
   * `Map.set` on a key the map no longer holds appends, and `list()` below is that insertion order —
   * so `λ copy 1`, deleted and undone while `λ copy 2` is still live, comes back BELOW it. The name is
   * what a user finds a row by, and it is the one this restores; the position is not, and buying it
   * back would mean rebuilding the whole map on every undo.
   */
  reinstate(record: BufferRecord): void {
    if (this.#buffers.has(record.id)) throw new Error(`a copy is already held under ${record.id}`)
    this.#buffers.set(record.id, { ...record, warm: false })
  }

  /**
   * Every live buffer, oldest first — 5d-ii-c design §4.2's header list is the caller this exists for.
   *
   * NEITHER CONTAINER ANSWERS THIS QUESTION — the registry holds sessions of every kind and the pool
   * holds threads, and neither records which of its keys are buffers or in what order they were forked.
   *
   * `BufferInfo`, NOT `SessionEntry`, and not `SessionId[]` either: a list keyed only by id would send
   * every caller back to the registry for the label, which is the fan-out the type exists to prevent.
   * A COPY RATHER THAN THE MAP'S OWN ITERATOR, so a caller cannot hold a view that changes underneath
   * it between the moment the list is built and the moment a row is clicked.
   */
  list(): readonly BufferInfo[] {
    return [...this.#buffers.values()].map((b) => ({ id: b.id, label: b.label, warm: b.warm, leg: b.leg }))
  }

  /**
   * Everything about these buffers that survives a reload, with `bindings` supplied by the caller.
   *
   * **THE BINDINGS ARE A PARAMETER BECAUSE THIS CLASS DOES NOT KNOW WHAT A PANE IS**, which is also
   * why `main.ts` computes `paneCount` rather than this file. `PaneCollection` answers which leaf is on
   * which session; this answers what the sessions hold.
   *
   * `warm` IS NOT IN THE PAYLOAD, AND ITS ABSENCE IS THE RESTORE POLICY WRITTEN INTO THE FORMAT
   * (5d-ii-d design §4.2). A buffer's temperature on the next page load is decided by which PANES came
   * back, not by which buffers happened to hold a thread when this one was closed — so persisting it
   * would store an answer to a question the next load asks differently. `restore` below inserts
   * everything cold for the same reason.
   */
  snapshot(bindings: Record<LeafId, SessionId>): PersistedBuffers {
    return {
      minted: this.#minted,
      buffers: [...this.#buffers.values()].map((b) => ({
        id: b.id,
        label: b.label,
        text: b.text,
        collapsed: b.collapsed,
        leg: b.leg,
      })),
      bindings,
    }
  }

  /**
   * Insert every buffer in `value` as COLD and set the mint counter — 5d-ii-d design §4.9 step 2.
   *
   * **NOTHING SPAWNS HERE, AND THAT IS THE RESTORE POLICY RATHER THAN AN OPTIMISATION** (5d-ii-d
   * design §4.2). Which buffers deserve a thread is a question about which PANES came back, which this
   * class cannot see; `main.ts` warms the ones its restored bindings name and leaves the orphans asleep.
   *
   * `#minted` TAKES THE STORED COUNTER RATHER THAN THE RESTORED COUNT. A page that forked three
   * buffers and retired two persists `minted: 3` and one buffer, and reissuing `copy 2` for the
   * next fork would put two different terms under one name across a reload — the exact thing `#minted`
   * only ever counting up exists to prevent.
   *
   * **IT ASSIGNS RATHER THAN TAKES A MAXIMUM, AND THE VALIDATION THAT MAKES THAT SAFE IS SOMEWHERE
   * ELSE.** `parseBuffers` refuses a payload whose `minted` is below any id it carries (the comment on
   * that check in `buffers-store.ts`: "the counter must dominate every name it claims to have minted"),
   * so by the time a value reaches here the counter is already known to be past every restored id. The
   * one caller in `src/` is `main.ts`'s restore block, which reads through exactly that function; a
   * caller that hand-built a `PersistedBuffers` would be handing this class a state its only producer
   * cannot produce.
   *
   * **CALLED BEFORE ANY FORK, AND NOTHING ENFORCES THAT HERE.** `main.ts` restores while resolving its
   * layout, which is before a pane exists to carry the `edit a copy` item, so `#minted` cannot already
   * have moved. A guard would be this class asserting an ordering its one caller establishes by
   * construction — and the honest version of it (refusing a restore into a non-empty collection) would
   * have no caller to refuse.
   */
  restore(value: PersistedBuffers): void {
    this.#minted = value.minted
    for (const b of value.buffers) {
      // A COPY STORED BEFORE PLAN 7 PART 2 IS NAMED `λ scratch N` OR `TM scratch N`; SAY IT THE NEW WAY
      // (spec §12). Only a label that is exactly that shape is touched, once; the next write stores it.
      const n = /^(?:λ|TM) scratch (\d+)$/.exec(b.label)?.[1]
      this.#buffers.set(b.id, {
        id: b.id,
        label: n === undefined ? b.label : `copy ${n}`,
        leg: b.leg,
        text: b.text,
        collapsed: b.collapsed,
        warm: false,
      })
    }
  }

  /**
   * Rebuild buffer `id` from `src` — 5d-iii design §4.3's edit path. Answers whether that buffer exists.
   *
   * **IT IS `fork` WITH `step: 0` AND NO CREATION, WHICH IS WHY THERE IS NO SECOND MESSAGE.** The text
   * in the editor IS the term, so there is nothing to replay to; `lambda-scratch` already means "build
   * a scratch from this text at this step" and 0 is its identity value. A `scratch-edit` variant would
   * be a second name for one request.
   *
   * **IT TAKES THE BUFFER IT REBUILDS.** Its caller is the sink `transport.ts`'s `editSink` builds for
   * each editor, which names the buffer the editor was built for — so passing it costs one argument and
   * removes the only reading under which typing into one pane could rebuild a term another pane is
   * showing. `retire` and `noSessionReply` below are keyed the same way.
   *
   * **A COLD BUFFER'S TEXT IS RECORDED AND NOTHING IS POSTED — `this.#reg.entryOf(id)` BELOW WOULD THROW
   * FOR ITS ID.** A buffer in `#buffers` need not be in the registry: a cold one is not (`#buffers`'s own
   * doc). `cool` rebinds every pane on `id` before it forgets the session, but this method's caller is
   * an editor's own sink, bound to its copy when the editor was built (`transport.ts`'s `editSink`), and
   * an edit can arrive after the pause that put its copy to sleep: the click on *pause* blurs the editor,
   * *format on blur* starts a format that takes the pending edit off the debounce, and when the server
   * answers after the pause the format sends the edit it owed (`ScratchEditor.format`). The text is the
   * user's, so it is kept, and `warm` builds it. The membership check answers `false` for an id no fork
   * ever minted, or a buffer already retired, which is where an edit sent after a delete goes: nowhere.
   *
   * **IT DOES NOT REBIND AND DOES NOT TOUCH THE REGISTRY.** The pane is already on this session and
   * stays on it; what changes is the term behind the leg. `resetLegs` is NOT called here either — the
   * worker's reply drives the leg through the same path a first fork does, and clearing the ring
   * ahead of it would blank the pane for the round trip rather than at the end of it.
   */
  recompile(id: SessionId, src: string): boolean {
    const state = this.#buffers.get(id)
    if (state === undefined) return false
    // THE TEXT OF RECORD, WRITTEN AT THE POINT IT BECOMES TRUE (5d-ii-d design §4.3). This is the user's
    // own text; the other `setText` caller is `replies.ts`'s `scratch-compiled` arm, which carries the
    // worker's answer for a fork.
    this.setText(id, src)
    // A SLEEPING BUFFER KEEPS THE TEXT AND BUILDS NOTHING — it has no worker to build on, and `warm` rebuilds
    // from what was just written. See this method's doc for how an edit reaches a sleeping buffer at all.
    if (!state.warm) return true
    const client = this.#reg.entryOf(id).client
    // BRANCHES ON `state.leg`, MIRRORING `#spawn`. `client.scratch` for every leg would post
    // `lambda-scratch`, which for a TM buffer reaches `onLambdaScratch`, which parses `.tm` TEXT as a λ
    // TERM and answers `no-session` with a λ syntax error every time. This is `#spawn`'s branch on the
    // leg at the one other place this class posts a build to an EXISTING buffer.
    const gen = client.supersede()
    switch (state.leg) {
      case 'lambda':
        client.scratch(gen, src, 0)
        break
      case 'tm':
        client.tmScratch(gen, src)
        break
      case 'asm':
        client.asmScratch(gen, src)
        break
      default:
        unhandled(state.leg)
    }
    return true
  }

  /**
   * Retire buffer `id`: rebind its panes to `home`, stop its playback, forget it, and **terminate its
   * worker**. Answers whether that buffer was live.
   *
   * **IT DOES NOT SWEEP.** Retiring every buffer would end buffers the caller never named, and 5d-ii-c
   * decision 2's governing rule is that nothing ends a buffer implicitly — an eviction wearing another
   * name is the shape that rule exists to refuse. The id makes that enforceable rather than merely
   * intended: there is a name to disagree with.
   *
   * **IT IS THE SAME MECHANISM AS POISON RECOVERY.** `SessionPool.unbind` is the cure 5d-i §4.2 names
   * for both damages `SessionPool`'s own doc describes — a borrow left taken poisons a module
   * permanently, and a worker's print-stack ceiling drops after its first deep print — because
   * `terminate()` kills a thread that cannot be asked to clean up after itself. 5d-ii-c design §4.4 puts
   * the recovery in the header list, because a wedged buffer has to be reachable whether or not a pane
   * is still showing it.
   *
   * **ONE CALLER IN `src/`, AND 5d-ii-c DESIGN §4.3's TABLE IS CLOSED AROUND IT:** a recompile does not
   * end a buffer, a failed build does not end a buffer, and the only row left with "ends it" in it is
   * the explicit retire. That caller is `main.ts`'s retire handler, which hands over every pane's slot
   * and then sweeps custody itself. `tests/node/scratch.test.ts` and `tests/browser/scratch-fork.test.ts`
   * drive it directly as well, at the layer the list drives it from.
   *
   * **IT IS `cool` PLUS FORGETTING THE RECORD:** `this.cool(id, home, slots)` followed by
   * `this.#buffers.delete(id)`. **`cool` owns the panes/legs/registry/pool order and the reasoning for
   * it — read it there.** Nothing here rebinds twice: a buffer that arrives warm is rebound and
   * cooled in that one call inside `cool`; a buffer that arrives already cold was rebound by whichever
   * `cool` cooled it, so THIS call's rebind pass runs again (`cool`'s doc calls it "a pass that finds
   * nothing to do") and finds nothing, by the same invariant.
   *
   * **IT RETURNS A BOOLEAN AND NOTHING IN `src/` READS THE ANSWER.** 5d-ii-c §4.4's retire control is
   * wired and DISCARDS it: `bufferList` builds its rows on `beforetoggle`, so a row could name a spent
   * buffer only if something had retired it between the open and the click, and there is exactly one
   * retire in the app: that click. A guard on this answer at that call site would be a branch nothing
   * can take. **What the answer is genuinely kept for is the stale-name contract below**, and the tests
   * are what read it: `tests/node/scratch.test.ts` asserts both arms and
   * `tests/browser/scratch-fork.test.ts` asserts the `true` at the layer the list drives this from.
   *
   * IDEMPOTENT, MIRRORING `SessionPool.unbind` AND `SessionRegistry.remove`: a guard every caller must
   * write is a guard the callee should have. **THE MEMBERSHIP CHECK IS FOR CORRECTNESS, NOT SAFETY.**
   * `entryOf` is inside `cool`, behind `cool`'s own `state === undefined` guard, which answers `false`
   * rather than throwing, so without this check a stale name would not throw: it would fall through to
   * `this.cool(id, home, slots)` (`false`, no record for `cool` to touch), then `this.#buffers.delete(id)`
   * (a no-op on a key that is not present), and return `true` — a caller holding a name that never
   * existed, or was already spent, would be told it just ended a buffer. It answers for a caller that
   * kept a buffer's name across the retire that spent it.
   */
  retire(id: SessionId, home: SessionId, slots: readonly Detachable[]): boolean {
    if (!this.#buffers.has(id)) return false
    this.cool(id, home, slots)
    this.#buffers.delete(id)
    return true
  }

  /**
   * A `no-session` reply naming a buffer: the diagnostics to report as a FAILED FORK, or `null` when
   * this buffer's own editor is the right place for them.
   *
   * **IT TAKES THE BUFFER THE REPLY NAMED.** The reply arrives with its session
   * (`ScratchBuffersConfig.onReply` curries it in per buffer) and that is the buffer this answers for.
   *
   * **NOTHING HERE MOVES A PANE OR ENDS A SESSION**, which is why the signature carries neither
   * `home: SessionId` nor `slots: readonly Detachable[]`.
   *
   * **THE PANE STAYS ON A BUFFER THAT WILL NEVER PRODUCE A FRAME**, reading the `building…` placeholder
   * `fork` seeded, with the reason in a notice and no PANE-LOCAL way out: 5d-ii-c design §4.4 puts
   * poison recovery in the header list precisely because a wedged buffer has to be reachable whether or
   * not a pane is still showing it. The way out is one gesture away from any state: open `copies ▾` and
   * delete the row, which rebinds this pane home and offers `edit a copy` again — the remedy
   * 5d-iii §4.1a promises, delivered from the header instead of from the pane that is stuck.
   * `tests/browser/scratch-fork.test.ts` asserts exactly that sequence.
   *
   * `null` FOR AN ID THAT IS NOT A LIVE BUFFER: there is nothing to report about a buffer the user has
   * already ended. A `no-session` for the SOURCE session never reaches this method (`replies.ts` routes
   * source replies to `onReply`).
   *
   * **A `no-session` REACHES A BUFFER FOR TWO REASONS THAT DEMAND OPPOSITE ANSWERS, AND THE WIRE
   * CANNOT TELL THEM APART.** `fork`'s OWN build can fail — the term at the requested step is over
   * `LAMBDA_BYTE_BUDGET` (5d-iii §4.1a), or (rarely) the source's own step-0 print was itself cut, so
   * the replay's first parse fails — and `fork` has ALREADY rebound the pane synchronously, before either
   * of those was knowable (`fork`'s own doc). Then no `scratch-compiled` ever fires, so nothing in
   * `replies.ts` ever calls `setEditor`: the pane has no editor, reads the `'building…'` placeholder
   * `fork` seeded, and `#refreshDetach`'s `!this.#detached` gate hides the only pane-local control that
   * could recover it, because this session IS the one the pane is stuck on. An edit's recompile can
   * ALSO fail, on a buffer that already has a good build behind it — the ordinary case a user hits on
   * nearly every mid-identifier keystroke — and there 5d-iii design §4.4 is explicit: "an edit that does
   * not parse leaves the frames region showing the last good run".
   *
   * **WHAT DIFFERS IS WHERE THE DIAGNOSTICS GO.** A build that never reached `scratch-compiled` mounted
   * no editor, so a notice (`notice.ts`) is the only surface left; a buffer mid-edit has a mounted
   * editor with a gutter built for exactly this. Reporting a mid-edit parse failure as a failed FORK
   * would also be a lie about which gesture failed.
   *
   * **THE DISCRIMINATOR IS WHETHER THE COPY'S OWN LEG HAS EVER RECORDED A FRAME.** A fork posts exactly
   * one build per buffer and posts it at creation, so a buffer with no frame yet has had nothing but that
   * build addressed to it. A buffer that already holds a frame can only be mid-`recompile`, because that is
   * the only other message this class ever posts to an existing buffer. The two cases are exhaustive and
   * mutually exclusive by construction, not by inspecting which caller happened to trigger this reply — on
   * every leg, because the line below reads `legs[state.leg]`: the one leg `#spawn` gave the buffer's entry
   * (Plan 7 part 5 spec amendment 27). `#spawn` gives a TM or asm buffer's entry no `lambda` leg at all,
   * so reading `legs.lambda` would take the phantom branch on every call for one, whichever of the two
   * reasons produced the reply.
   *
   * RETURNS THE DIAGNOSTICS ON THE PHANTOM PATH, so the caller has the reason to put on the surface
   * built for it — a routing decision rather than a report on something that has already happened.
   * `null` ON THE LIVE-EDIT PATH, where the editor's own diagnostics, which arrive on its LSP document's
   * sink, are what 5d-iii design §4.4 asks for and this method has nothing to add to them. `null` ALSO
   * WHEN THERE IS NO BUFFER AT ALL: there is no fork to report a failure for.
   *
   * **IT ANSWERS WITH THE DIAGNOSTICS RATHER THAN A BOOLEAN.** A `boolean` would make the caller
   * re-derive nothing and read exactly the same — but the caller would then hold two things that must
   * agree (which branch it is on, and which diagnostics belong to it) where it now holds one. The
   * parameter is what the answer is made of, not decoration on a flag.
   *
   * **THE `warm` CHECK IS BELT-AND-BRACES.** This method's caller is `replies.ts`'s `no-session` arm,
   * reached from a WORKER REPLY routed by `session` alone, and nothing about a reply's arrival is gated
   * on any pane still pointing at the buffer it names. But **the HTML specification writes down what
   * `Worker.terminate()` does with queued messages**: the *terminate a worker* algorithm, applied to a
   * dedicated worker, empties the port message queue of the port the worker is entangled with — the
   * PARENT side — after discarding the worker's own queued tasks and aborting its script. `cool` calls
   * `#pool.unbind(id)`, which calls `held.port.terminate()` (`session-client.ts`'s `unbind`),
   * synchronously, before it returns. So a reply for a cooled buffer cannot be dispatched.
   *
   * The same switch's `scratch-compiled` arm resolves `sessions.entryOf(session).legs` and its
   * `lambda-frames` arm resolves `sessions.legOf({ session, leg: 'lambda' })`, and both throw for a
   * session the registry no longer holds; neither needs a guard, for the same reason. `replies.ts`'s
   * own arms carry the same fact where a reader meets them.
   *
   * **THE CHECK STAYS ANYWAY, AND ON ITS OWN TERMS.** It is one field read on a path that already does
   * a map lookup, it makes this method total over every `BufferState` rather than over the warm ones its
   * caller happens to produce, and the answer it gives is the one this method already gives for an id
   * that was never a buffer: `null`, meaning "there is nothing here to report a fork failure for." What
   * it must NOT be read as is a guard against a state the app can reach — the fake-port tier records
   * `terminate()` as a COUNT rather than as message-discarding (`FakePort.terminated`,
   * `tests/node/session-fixtures.ts`), so no node test can distinguish the two readings, and only a real
   * worker ever could.
   */
  noSessionReply(id: SessionId, diagnostics: readonly Diagnostic[]): readonly Diagnostic[] | null {
    const state = this.#buffers.get(id)
    if (state === undefined || !state.warm) return null
    const leg = this.#reg.entryOf(id).legs[state.leg]
    if (leg !== undefined && leg.hist.current !== undefined) return null
    return diagnostics
  }
}
