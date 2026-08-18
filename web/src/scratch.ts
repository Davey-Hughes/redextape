import type { PersistedBuffers } from './buffers-store'
import { History } from './history'
import type { LeafId } from './panes'
import type { Leg, RunReply } from './protocol'
import type { SessionId, SessionPool } from './session-client'
import { resetLegs, type SessionRegistry } from './sessions'
import type { Diagnostic, LambdaState, TmState } from './types'

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
export type BufferInfo = {
  readonly id: SessionId
  readonly label: string
  readonly warm: boolean
  readonly leg: Leg
}

/**
 * What this class holds per buffer — `BufferInfo` plus the facts no surface outside renders.
 *
 * **`collapsed` HAS A WRITER AND A READER NOW — `setCollapsed`/`collapsedOf` BELOW — WHICH REVERSES
 * WHAT THIS PARAGRAPH USED TO SAY.** `PersistedBuffer` carries the field (design §4.1), so `snapshot`
 * reads it and `restore` writes it exactly as before; what changed is that something now writes it
 * BETWEEN those two moments — `transport.ts`'s `collapse` handler, reached from `pane-chrome.ts`'s
 * `collapseButton` — and something reads it back to seed a remount — `replies.ts`'s `scratch-compiled`
 * arm, through `LambdaPane.setEditor`'s second parameter. `fork` still seeds it `false`: a freshly
 * forked buffer has never been collapsed by anyone.
 *
 * For what this doc used to claim and why it changed, see the history note under `BufferState`.
 */
type BufferState = {
  readonly id: SessionId
  readonly label: string
  /**
   * Which leg this buffer's session has — 5d-iv design §4.5.
   *
   * **THE FACT THIS COLLECTION HAD NO WAY TO RECORD, BEFORE THIS FIELD LET `#spawn` MINT EITHER KIND.**
   * `#buffers`' own doc states the gap this field fills: `detached` is a property of a session and
   * cannot distinguish a λ buffer from a `TmScratch`. What is no longer true of that sentence is its
   * closing clause — `entry.legs.tm !== undefined` DOES record provenance now, but only because THIS
   * field is what `#spawn` reads to decide whether to give an entry a `tm` leg at all; there was no
   * provenance for it to record until this field existed to drive that branch.
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
 * How many buffers may be WARM at once — hold a worker, not merely a record. Design §4.4/§4.6.
 *
 * **RENAMED FROM `MAX_BUFFERS`, AND THE RENAME IS THE POINT — 5d-ii-d T8.** Every reader of the old
 * name believed it bounded buffers; it has actually bounded THREADS since the cold/warm split gave
 * `warm` its own refusal at this figure (`warmCount()` below counts warm buffers, not `#buffers.size`)
 * — a name that kept meaning "buffers" while what it counted changed underneath it is exactly the
 * hazard a rename exists to close. **A COLD buffer costs no thread and is UNBOUNDED BY THIS CONSTANT**:
 * `#buffers` can hold as many cooled, retired-in-all-but-name records as a user leaves lying around;
 * only forking a new buffer, or `warm`-ing a cold one back up, spends a seat here.
 *
 * **THE THRESHOLD, PRE-REGISTERED BEFORE ANY NUMBER EXISTED, AND UNCHANGED SINCE** (design §4.6): *a
 * page at the cap, with every warm buffer holding a real term and its ring driven to exhaustion, must
 * sit at or below 512 MiB — main-thread resident heap plus summed per-thread wasm linear memory. The
 * cap is the largest count that satisfies it. The threshold does not move.*
 *
 * **MEASURED BY `tests/browser/buffer-affordability.test.ts`** (5d-ii-d T7/T8) — a real-Chromium probe
 * that spawns 1, 2, 4 and 11 wasm workers, each stepping a genuinely divergent term 20,000 times and
 * each driving a real λ ring to exhaustion, heap read via forced `gc()` around a task boundary
 * (`session-memory.test.ts`'s own discipline, cited by name in that file's header).
 *
 * **MARGINAL COST PER BUFFER: ~44.53 MB** (44,522,565–44,528,023 bytes across Task 7's three FIX
 * ROUND 2 runs — the superseding pass, not fix round 1's own now-superseded figures — spread
 * 5,457.34 bytes on a ~44.5 MB figure, ≈0.012%) — 8,585,216 bytes of wasm, exactly linear in thread
 * count with zero shared baseline, plus a real λ ring driven to exhaustion (~35.94 MB, ≈1.07112×
 * `HISTORY_BYTES` — the probe's own printed ratio against charged bytes: 1.07105 — agreeing with
 * `protocol.ts`'s own measured λ retention ratio to within ~0.1%).
 *
 * **TWO READINGS, ONE INTERCEPT COMPONENT APART — THE PROJECT OWNER PICKED THE LITERAL ONE.** The
 * threshold's own words are "every warm BUFFER"; the source session's two rings are not a buffer's, so
 * whether they count is a reading of the sentence, not a fact the probe can settle on its own:
 *
 *   * **(a) buffers-only-at-exhaustion — GOVERNS, and SHIPS.** The literal reading: the source
 *     session's fixed thread cost counts (module + arena, 11,993,088 bytes) but its two rings do not,
 *     because they are not simultaneously exhausted the instant every buffer's is — the source session
 *     is ordinarily mid-recording or idle, not pinned at its own ring cap at the same moment N buffers
 *     are all pinned at theirs. Intercept = page/app baseline (17,825,792 bytes, a FLOOR — see below) +
 *     the main thread's own wasm module (8,454,144 bytes, `main.ts`'s `init()`, invisible to a heap
 *     reading the same way every worker's module is) + that source fixed cost. **Derived cap: 11.**
 *   * **(b) everything-at-exhaustion — reference only, NOT what ships.** The stricter reading: the
 *     source session's own λ and TM rings ALSO driven to exhaustion at the same instant every buffer's
 *     is, which the threshold's words do not require, since the source session's legs are not
 *     "buffers". **Derived cap: 8** — the same number as the old provisional eight, and coincidence
 *     rather than agreement: the old eight was arithmetic over a budget nobody had measured, and this
 *     eight is what the stricter reading of a now-measured budget happens to also allow.
 *
 * **BOTH NUMBERS ARE UPPER BOUNDS, NEVER MEASURED CEILINGS.** `pageBaseline` (17,825,792 bytes) is a
 * FLOOR — a byte-conversion of `session-memory.test.ts`'s own prose figure for the real app's baseline
 * (CodeMirror, the DOM), not a reading either probe ever took of the real app, and that file says
 * outright the true figure "is larger still". A floor on one intercept component can only push the
 * TRUE intercept UP and the true safe cap DOWN from what is derived here — never the reverse. 11 is the
 * most this budget can be SHOWN to afford, not a guarantee that it affords exactly that many.
 *
 * **VERIFIED AT n = 11 DIRECTLY, NOT ONLY EXTRAPOLATED — 5d-ii-d T8.** The probe's sweep grew a fourth
 * point at exactly the derived count, `[1, 2, 4, 11]`, precisely because a two-point (n=1, n=4)
 * marginal projected seven buffers further is an extrapolation and eleven concurrent workers is exactly
 * the range where a non-linearity (GC pressure, allocator fragmentation, scheduler contention) would
 * first show. Three runs, real n=11 readings, intercept (a) plus the measured total against the 512 MiB
 * budget: all three **fit**, at ≈503.6 MiB with ≈8.4 MiB of headroom — the per-run figures are in the
 * history note under `MAX_WARM_BUFFERS` — transcript.
 *
 * All three runs land within 0.007–0.011% of what the n=1/n=4 marginal predicted for n=11 — the
 * extrapolation and the direct reading agree, so no non-linearity showed up between four buffers and
 * eleven. **11 IS THEREFORE A MEASUREMENT, NOT ONLY AN EXTRAPOLATION**: it is both the largest count
 * the pre-registered budget's arithmetic derives AND the count eleven probe workers — each holding a
 * bare `LambdaScratch`, not an app buffer with a client, a pane or a play timer — were measured to fit
 * under, with margin to spare, once their summed wasm linear memory and their eleven exhausted rings'
 * summed retained heap (two readings never simultaneously resident, so the total is arithmetic rather
 * than one reading — see `buffer-affordability.test.ts`'s "never resident simultaneously" comment in
 * its main loop) are added to a COMPUTED intercept. **NOT A READING OF A REAL APP PAGE.** The probe page has no CodeMirror, no app
 * DOM, no source session and no main-thread wasm module; all three of the last are added to the
 * intercept as constants cited from elsewhere, never observed resident on this page at once. Had any
 * run exceeded the budget, this doc would record both the derived and the verified number, with the
 * discrepancy named, and ship the lower one — it did not come to that.
 *
 * **THE CAP COUNTS THREADS, NOT BUFFER RECORDS.** `warmCount()` below, not `#buffers.size` — a cold
 * buffer holds no worker and costs nothing this constant prices, so `#buffers` can grow without bound
 * as buffers cool; only `fork` (which always warms) and `warm` (which re-warms a cold one) spend a
 * seat. This is unchanged from the provisional doc's own point, restated because it is the one fact
 * about this constant a rename cannot fix by itself — a reader still has to know it.
 *
 * **THE REFUSAL'S OWN WORDING THEREFORE UNDERSTATES ITS SCOPE, RECORDED HERE RATHER THAN FIXED.**
 * `#refuseAtCap`'s message reads "all `MAX_WARM_BUFFERS` scratch buffers are live" — true of every WARM
 * buffer, the only kind this constant prices, but readable as a claim about every buffer on the page.
 * A page can hold more buffers than that: a cold buffer costs nothing (the paragraph above), so a page
 * with, say, 15 buffers total and 11 of them warm sits exactly at the cap, and `warm` below (asking for
 * one of the four cold ones back) refuses with the identical sentence a `fork` would, on a page that is
 * visibly not "all live". `BufferCapReached` is out of scope for 5d-ii-d — design §4.4 keeps it
 * "unchanged in kind" — so this is noted rather than reworded.
 *
 * **WHAT RIDES ON THE FIGURE.** The tests that exercise the cap import this constant rather than
 * spelling a number, so they follow it wherever it goes. `tests/browser/two-lambda-panes.test.ts`
 * needs the cap to be **at least two** — several of its tests fork twice inside a single test, and its
 * reset reclaims buffers between tests (`retireEveryBuffer`) precisely so it needs no more than that;
 * 11 satisfies it with room to spare. `tests/browser/scratch-cap.test.ts` exercises the refusal AT the
 * cap, so moving from 8 to 11 means it now forks 11 times where it forked 8 — slower by a few real
 * worker spin-ups per run, not by an order of magnitude; see that file's own measured runtime.
 *
 * For what this doc used to claim and why it changed, see the history note under `MAX_WARM_BUFFERS`.
 */
export const MAX_WARM_BUFFERS = 11

/**
 * The refusal `fork` and `warm` raise at `MAX_WARM_BUFFERS` — design §4.5's "refused with a diagnostic
 * naming the list", as a type its caller can act on.
 *
 * **A CLASS RATHER THAN A PLAIN `Error`, BECAUSE THE CALLER HAS TO TELL THIS FROM A BUG.**
 * `transport.ts`'s detach handler and `main.ts`'s temperature/restore handlers catch this one and put
 * its message on `#link-status`; the other things `fork`/`warm` can raise are `SessionRegistry.add`'s
 * and `SessionPool.bind`'s guards over their own invariants (a replaced entry strands a running
 * `setInterval`; a replaced client misdelivers frames), and those are wiring bugs rather than answers
 * to a user. A bare `catch` at either call site would render one of them as a status line and swallow
 * it. `instanceof` is what keeps a refusal a refusal and lets everything else go on being loud.
 *
 * **THE MESSAGE IS THE PAYLOAD AND THERE IS NO SECOND FIELD.** It is composed here because this is the
 * only place that holds both the cap and the labels. **IT CARRIES NO FIXED PREFIX OF ITS OWN — 5d-ii-d
 * REVIEW ROUND 2, FINDING 3, AND A CHANGE FROM HOW THIS USED TO READ.** `#refuseAtCap`'s own doc has
 * the fix: the prefix now travels with the CALLER, not with this class, so `fork`'s refusal reads as a
 * fork failing and `warm`'s reads as a plain statement of the cap. A `live: BufferInfo[]` field would
 * let a caller compose a second wording of the cap-and-labels fact, which is the fan-out `BufferInfo`'s
 * own doc exists to prevent — a different axis from the prefix, and not what that argument is about.
 *
 * For what this doc used to claim and why it changed, see the history note under `BufferCapReached`.
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
 * **NO `id` AND NO `label`, AND THIS PARAGRAPH USED TO ARGUE THE OPPOSITE.** A fork mints a name per
 * call now (`fork` below), so the name is a function of the counter that mints the id and the two
 * cannot be written in different places without being able to disagree. What it was actually
 * protecting survives unchanged: a session's name is decided where the session is CREATED — `main.ts`
 * for the source session, here for a buffer — and never in `sessions.ts`, which holds no name of the
 * app's at all.
 *
 * `onReply` NAMES ITS SESSION, WHERE IT USED TO BE BOUND TO ONE. One collection binds many workers
 * through one dependency, so the id is curried in per buffer at `pool.bind` and arrives with the
 * reply; a callback that closed over "the" scratch would deliver every buffer's frames under one name.
 *
 * For what this doc used to claim and why it changed, see the history note under `ScratchBuffersConfig`.
 */
export type ScratchBuffersConfig = {
  registry: SessionRegistry
  pool: SessionPool
  /** The ring's cap for each buffer's one leg. `HISTORY_BYTES`, per 5d-i design §4.4's one knob. */
  historyBytes: number
  onReply: (session: SessionId, reply: RunReply) => void
}

/**
 * **THE SCRATCH BUFFERS — 5d-ii-c design decision 1, and the policy half of 5d-i's plan T8.**
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
 * **BOTH LEGS NOW, WHICH THIS DOC USED TO SAY WAS IMPOSSIBLE — 5d-iv T5.** A `TmScratch` is built from
 * `.tm` TEXT the same way a `LambdaScratch` is built from λ text, and `#spawn` below reads `state.leg`
 * — set once, at mint, and never written again — to pick both the request kind it posts
 * (`client.scratch` against `client.tmScratch`) and the one leg record it builds for the registry. A
 * second class was the alternative this doc used to argue for; one class with a field is what it
 * became, because everything past that one branch — the id, the cap, the retirement order, the
 * snapshot shape — is identical work for either leg.
 *
 * **`fork`'S FOURTH PARAMETER AND `forkBlank` ARE THE TWO DOORS IN, AND THEY ARE NOT THE SAME DOOR
 * NARROWED TWICE.** `fork` still seeds a new buffer from a source-derived VIEW's own text, exactly as
 * the doc below it always argued; passing `'tm'` there answers "what leg is this view's text
 * written in", not "go find some `.tm` text and fork it" — there is no view to seed a TM buffer FROM,
 * for the reason this doc used to give: the TM pane renders a δ-table projected from a compiled
 * program, never the machine source that produced one. `forkBlank` is the other door, and it exists
 * BECAUSE of that gap: it mints a warm, empty buffer on `leg` and binds no pane to it, so a TM buffer's
 * first text is whatever a user types or pastes into it once it exists, not a fork of anything already
 * on screen.
 *
 * `options('tm')` STOPS RETURNING EXACTLY THE SOURCE SESSION THE MOMENT ONE OF THESE IS MINTED, which
 * reverses 5d-ii-c design §3.5's own record of the gap from the other end. `SessionRegistry.options`
 * answers from `entry.legs[leg] !== undefined`, and `#spawn`'s TM branch is what sets that leg on a TM
 * buffer's entry — so the selector needed no change of its own to offer one once this class could mint
 * one.
 *
 * **NOTHING IN `src/` CALLS `forkBlank` OR PASSES `'tm'` TO `fork` YET.** This task is the collection
 * learning the leg, not the gesture that reaches it — that is a later task's, a control the header list
 * does not have. `protocol.ts`'s `lambda-scratch` request doc used to point here for "the same line
 * drawn on the session side"; it has been corrected alongside this one, since the line it pointed at is
 * gone.
 *
 * For what this doc used to claim and why it changed, see the history note under `ScratchBuffers`.
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
   * distinguish a λ buffer from a `TmScratch` — **NO LONGER FUTURE, AS OF 5d-iv T5.** `entry.legs.tm !==
   * undefined` now DOES record provenance for a TM buffer, which is what lets `options('tm')` below stop
   * answering exactly the source session the moment one is minted (this class's own doc has the
   * argument in full); what this map still answers that the registry cannot is WHICH of the registry's
   * sessions are buffers at all, and in what order they were forked.
   *
   * **A RECORD MAY OUTLIVE ITS SESSION NOW, WHICH FALSIFIES A SENTENCE THIS DOC USED TO RELY ON.** A
   * cold buffer is in this map and in neither container behind `legOf`, by construction (design §4.2),
   * and `SessionRegistry.entryOf` throws for an id it does not hold. **5d-ii-d T4 CLOSED THAT HAZARD.**
   * The row builder reads `sessions.legOf(...)` only when `b.warm` is true and reads `null` for a cold
   * row otherwise, so a cold buffer's row no longer throws when the header list opens — it reads
   * "asleep" (`buffer-list.ts`'s `BufferRow.warm` has the argument for why that reads differently from
   * "no term"). The header list's temperature control has its own call to `cool` (`main.ts`'s
   * `onTemperature` handler), so a buffer goes cold on a gesture with no retire anywhere in it — the row
   * builder's `warm` branch is what makes that safe, not this map's record-keeping.
   *
   * **A SECOND SITE DEPENDS ON THE SAME RETIRED INVARIANT, AND IS SAFE FOR A REASON THIS CLASS NOW
   * ENFORCES RATHER THAN ASSUMES.** `recompile`'s `if (!this.#buffers.has(id)) return false` no longer
   * implies a registry entry either, so `this.#reg.entryOf(id)` on its very next line would throw for a
   * cold buffer's id. `cool` rebinding its panes to `home` (5d-ii-d review, Finding 0) is what makes
   * that unreachable: a cold buffer has no panes bound to it, and `recompile`'s only caller reaches it
   * through a pane's own binding (`slot.binding.session`), so there is no binding left pointing at a
   * cold buffer to call it with. `recompile`'s own doc carries the argument in full.
   *
   * For what this doc used to claim and why it changed, see the history note under `#buffers`.
   */
  #buffers = new Map<SessionId, BufferState>()

  /**
   * How many buffers have EVER been minted, which is deliberately not how many are live.
   *
   * A RETIRED BUFFER'S NAME IS NOT REISSUED. Reusing `scratch 1` for the buffer forked after the first
   * one was retired would put two different terms under one name inside a single session — and the
   * name is the only handle a user has on a buffer no pane is showing (design §4.2's list). A counter
   * that only goes up costs nothing and cannot produce that.
   *
   * **"INSIDE A SINGLE SESSION" USED TO BE THE WHOLE SCOPE OF THAT CLAIM, AND `restore` BELOW WIDENS
   * IT TO SPAN RELOADS.** This counter is what `snapshot` persists and what `restore` sets, so the
   * name a page mints after a reload is past every name the previous page minted — including buffers
   * that were retired before it closed and are therefore in no restored record. That is why the stored
   * payload carries the COUNTER and not the count; `buffers-store.ts`'s `PersistedBuffers` has the
   * argument from the format's side. `restore` is the one writer here that does not increment, and its
   * own doc says why assigning is safe.
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
   * **THERE IS NO `has` BRANCH, AND ITS ABSENCE IS THE WHOLE OF DECISION 1.** A fork that happens
   * spawns, seeds, and names its own buffer. `SessionRegistry.add` and `SessionPool.bind` both refuse
   * an id they already hold, and both stay as guards over their own invariants (a replaced entry
   * strands a running `setInterval`; a replaced client misdelivers frames) rather than over anything
   * this call site does: `#minted` only ever goes up, so the id below is one neither container has seen.
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
   * **THE ONE CONDITIONAL IS A REFUSAL, AND IT DOES NOT MAKE A FORK MEAN TWO THINGS.** Every call that
   * returns does the same things in the same order; the branch decides whether this method runs at all
   * rather than what a fork means when it does. A second outcome that RETURNED AN ID would be the thing
   * to guard against; a throw is not one, because no caller can mistake it for a fork.
   *
   * **AT `MAX_WARM_BUFFERS` IT REFUSES, AND REFUSING IS THE ONLY THING A CAP MAY DO HERE** (design §4.5).
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
   * **THE RECORD IS INSERTED AFTER `#spawn` RETURNS, WHERE IT USED TO GO IN BEFORE — A REVIEW FIX.** A
   * `this.#buffers.set(id, …)` used to sit between minting `id` and calling `#spawn`, so a throw from
   * `SessionPool.bind` or `SessionRegistry.add` inside `#spawn` left a COLD record in `#buffers` for a
   * buffer that was never warm and never will be — the exact hazard this class's own invariant (a
   * record's temperature must match whether it has a thread) exists to rule out, self-inflicted by the
   * one method that is supposed to keep it true. `#spawn` now takes the `BufferState` object directly
   * (see its own doc) and mutates it in place, so this line only runs once `#spawn` has already bound
   * the client and registered the session without throwing — nothing is recorded until it is real.
   *
   * **THE NEW ORDER REINSTATES THE SHAPE OF THE OTHER HAZARD, AND THAT IS ACCEPTABLE HERE RATHER THAN
   * OVERLOOKED — 5d-ii-d review round 2, Minor 2.** Moving the record after `#spawn` returns means a
   * throw INSIDE `#spawn` — after `#pool.bind` has already bound a client but before `#reg.add` returns —
   * would leave a running worker with no `#buffers` record at all, which is exactly the hazard four
   * paragraphs up calls "the leak the cap exists to bound, created by the cap." Fixing the cold-record
   * hazard by reordering cannot also rule out this one by ordering alone; only one of the two throws this
   * class can actually reach mattered here. `SessionPool.bind` and `SessionRegistry.add` both throw on
   * exactly one condition — a duplicate id — and `#minted` only ever counts up, so the id `fork` mints on
   * this call has never been seen by either container; nothing in `#spawn` can trigger that throw for it.
   * The ordering also happens to match what this method did before cold buffers existed at all, when
   * there was only ever the one record to place and no "cold" for it to be. Trading a real, reachable
   * hazard for one neither container can raise against a freshly minted id is the trade worth making, not
   * a hazard newly created by the fix.
   *
   * **THE REFUSAL ITSELF IS ONE CALL NOW, NOT FIVE DUPLICATED LINES.** `warm` below refuses at the same
   * cap with the same message. `#refuseAtCap` is the one place the throw is written now; see its own
   * doc for the message itself.
   *
   * **THE MESSAGE NAMES THE CONTROL THAT ENDS ONE**, because "no" on its own would leave a user holding
   * a pane with no account of how to get the room back.
   *
   * **IT USED TO NAME THE BUFFERS TOO, AND THAT WAS WORSE THAN SAYING NOTHING — changed after reading
   * the line on a real page.** The names are `scratch 1` through `scratch N` BY CONSTRUCTION — a
   * counter's output, carrying nothing that distinguishes one buffer from another — so the enumeration
   * it carried ran to sixty characters of noise, and grows with the cap, standing between the diagnosis
   * and the only actionable clause in the sentence, on a one-line dim status readout with no wrap.
   *
   * **WHAT REPLACED IT IS THE LIST ITSELF, WHICH NOW ANSWERS THE QUESTION THE ENUMERATION WAS PRETENDING
   * TO.** `buffer-list.ts` gives every row its buffer's current TERM, so "what is using the room" is a
   * glance at the surface this sentence already points at — and it is answered with the one fact that
   * differs between buffers rather than with one copy of a counter per buffer. Naming them here as
   * well would be the fan-out `BufferInfo`'s own doc exists to prevent, now that there is something real to fan out.
   *
   * THE COUNT STAYS, because it is the thing the user cannot see from the button (`buffers 8 ▾` says how
   * many exist, not that eight is the limit) and it is what makes the refusal a rule rather than a
   * malfunction.
   *
   * **AND IT REACHES A SURFACE, WHICH IS THE HALF OF §4.5 A THROW ON ITS OWN DOES NOT DELIVER.** The
   * only caller in `src/` is `transport.ts`'s detach handler, running inside the `✎ fork` button's own
   * click listener (`pane-chrome.ts`'s `detachButton`); it catches `BufferCapReached`, hands the message
   * to `link-wiring.ts`'s `setForkFailed` and repaints, so `link-status.ts` renders it on
   * `#link-status`. **THE `fork failed — ` WORDS ARE PART OF THIS THROW'S OWN MESSAGE, NOT SOMETHING
   * `link-status.ts` ADDS** (5d-ii-d review round 2, Finding 3) — `this.#refuseAtCap('fork failed — ')`
   * is the call this method makes, and `#refuseAtCap`'s own doc has the argument for why the prefix
   * lives at the call site rather than in the renderer or in `BufferCapReached` itself: `warm`'s
   * refusal reaches the identical field and is not a fork, so a prefix baked into either of those two
   * would have named a gesture that did not happen for one of this class's two callers. `replies.ts`
   * writes the same field for the SIBLING refusal — a fork whose build fails — with the same words in
   * its own text for the same reason, which is what makes this a wire being connected rather than a
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
   *
   * **`text: src` BELOW IS A PROVISIONAL SEED, IT IS THE WRONG TERM, AND IT IS DURABLE BEFORE THE WORKER
   * ANSWERS — said plainly here because design §4.3's "one owner and two writers" reads as though it
   * were not (whole-branch review before merge, finding 7; §4.3 is corrected to match).** `src` is the
   * SOURCE session's step-0 term, which design §3.4 itself calls "the wrong string anyway": the worker
   * re-derives this buffer's term at `step` from it, and `replies.ts`'s `scratch-compiled` arm is what
   * replaces the seed with that. The gap between the two is not private, because the caller
   * (`transport.ts`'s `detach`) calls `onBuffersChanged` on its success path, which reaches `main.ts`'s
   * `refreshBuffers` and therefore `persistBuffers` — synchronously, in the same click, before any reply
   * can land. So the seed is written to `redextape.buffers` as this buffer's text.
   *
   * **THE CONSEQUENCE, STATED RATHER THAN LEFT TO BE DISCOVERED: A FORK WHOSE BUILD NEVER SUCCEEDS
   * PERSISTS THE SOURCE'S STEP-0 TERM, AND A RELOAD WARMS IT SUCCESSFULLY AT STEP 0.** A build can fail
   * (the term at `step` is over `LAMBDA_BYTE_BUDGET`, or the source's own step-0 print was itself cut —
   * `noSessionReply`'s doc has both), and 5d-ii-c decision 2 means nothing retires the buffer for it. Its
   * record keeps the seed forever, so the next page load restores a buffer that builds and runs while
   * holding a DIFFERENT term from the one the user forked. The buffer is still theirs and still named
   * by the counter (`λ scratch N`, for the one caller `src/` has today — `transport.ts`'s detach
   * handler forks the λ leg only); what it contains is the program they forked FROM rather than the
   * point they forked AT.
   *
   * **DEFERRING THIS PERSIST WAS CONSIDERED AND IS NOT A FIX, WHICH IS WHY THIS IS DOCUMENTED RATHER THAN
   * CHANGED.** Moving the write to the `scratch-compiled` arm that already persists would only narrow the
   * window: the RECORD carries `text: src` from this line either way, and four other sites persist the
   * whole collection (a recorded term, a rebind, a collapse, and `main()`'s own write-back), so any later
   * gesture writes the same seed out. Actually removing the consequence means not seeding `text` with
   * `src` at all — and the honest alternative, an empty seed, makes a failed fork restore as an EMPTY
   * buffer, which trades a wrong term for lost work and is a design decision rather than a repair. The
   * seed stays because it is also what makes the record non-empty for every fork that DOES build, in the
   * round trip before the arm replaces it.
   *
   * For what this doc used to claim and why it changed, see the history note under `fork`.
   */
  fork(slot: Detachable, src: string, step: number, leg: Leg): SessionId {
    // `'fork failed — '` — THIS CALL IS THE ONE OF THE TWO CALLERS FOR WHICH THAT IS TRUE. See
    // `#refuseAtCap`'s own doc for why the prefix is a call-site argument rather than baked into the
    // shared message.
    if (this.warmCount() >= MAX_WARM_BUFFERS) this.#refuseAtCap('fork failed — ')
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
   * THE THIRD PARAMETER IS THE ONE DIFFERENCE BETWEEN THE TWO CALLERS' NAMES: `fork` labels its buffer
   * from a `Detachable` it must then rebind, `forkBlank` from nothing at all. `slot?.rebind(id)` below
   * is the whole of that fork — a `null` here is `forkBlank`'s own claim that no pane is owed a move.
   */
  #mint(src: string, step: number, leg: Leg, slot: Detachable | null): SessionId {
    this.#minted += 1
    const id: SessionId = `scratch-${this.#minted}`
    const label = leg === 'lambda' ? `λ scratch ${this.#minted}` : `TM scratch ${this.#minted}`
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
   * play head was, and the ring it had is gone: that is the cost design §4.5 weighs when it declines to
   * auto-cool an orphan.
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
   * **THE NON-DESTRUCTIVE ESCAPE FROM THE CAP, AND THAT IS WHY IT EXISTS** (design §4.5). With the cap
   * counting threads, a user who reaches it would otherwise have exactly one way out — an explicit
   * retire, which ends a buffer and its text. A cap that never evicts but leaves no other exit would
   * destroy work by omission, which is 5d-ii-c decision 2 defeated rather than honoured.
   *
   * **REBINDS ITS PANES NOW, WHERE THE FIRST VERSION OF THIS METHOD NEVER DID — A DESIGN CHANGE,
   * DECIDED BY THE PROJECT OWNER, NOT A BUG FIX.** It used to leave a pane bound to the buffer it put
   * to sleep, on the argument that "a pane bound to a cooled buffer keeps naming it, which is what
   * makes warming it again put the pane back in front of its own term." That held for the term and
   * cost too much elsewhere: a pane pointed at a cold buffer sits on a session `legOf`/`entryOf` cannot
   * resolve, so every caller downstream of a binding — `draw()`, `recompile`, and `main.ts`'s row
   * builder, which grew the `warm` guard the `#buffers` map's own doc argues for in 5d-ii-d T4 — would
   * have had to special-case "cold" or crash on it. `retire` already rebound for exactly this reason;
   * `cool` now does the identical thing. Warming the buffer again no longer puts the pane back on it —
   * a user who wants that back rebinds through the selector, the same gesture that reaches any other
   * session.
   *
   * **AND THAT REBIND USED TO ARRIVE AT A BUFFER THAT COULD NEVER BE EDITED AGAIN, WHICH MADE THIS
   * METHOD'S OWN "NON-DESTRUCTIVE" DESTRUCTIVE OF EDITABILITY — whole-branch review before merge, fixed
   * rather than filed.** The rebind above is what takes the editor down (`draw()` reaches
   * `LambdaPane.setDetached(false)`, whose teardown calls `setEditor(null)`). `pane-host.ts`'s
   * `mountScratchEditor` restores editability, seeding from `editorSeed` below;
   * `tests/browser/buffer-cool-warm.test.ts` drives the whole round trip and is what fails without it.
   * WHAT THIS METHOD DOES IS UNCHANGED — the editor still comes down here, and it is the ARRIVING side
   * that now builds a new one.
   *
   * **THE INVARIANT THIS BUYS: A COLD BUFFER HAS NO PANES BOUND TO IT.** That is what turns every other
   * cold-buffer hazard unreachable rather than merely handled. `recompile`'s `this.#reg.entryOf(id)`
   * would throw for a cold id, and there is no binding left on a cold buffer to call `recompile`
   * with — see `recompile`'s own doc. It holds as long as a caller hands this method every slot that
   * MIGHT be bound to `id`: `main.ts`'s `panes.all()` is what the real app passes, the same set
   * `retire` is handed for the same reason.
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
   * THE ORDER AFTER THE REBIND IS `retire`'s ORDER, FOR `retire`'s REASON: legs before registry
   * (through `resetLegs`, ahead of the entry that owns them being deleted), registry before pool
   * (`SessionRegistry.remove`'s own doc — terminating a thread is never the registry's job).
   *
   * **"KEEP ITS TEXT" IN THE SUMMARY LINE IS ALMOST ALWAYS TRUE, NOT QUITE ALWAYS — THE REBIND ABOVE CAN
   * COST THE LAST KEYSTROKE (5d-ii-d review, Finding 7).** The text `warm` later rebuilds from is
   * whatever `setText` last wrote, and `setText`'s own doc names its callers: `recompile`, driven by
   * `ScratchEditor`'s own 300ms debounce (`editor-debounce.ts`'s `EDITOR_DEBOUNCE_MS`), not by every
   * keystroke. The rebind a few lines up is what makes `editor-custody.ts`'s `reconcileEditors` call
   * `ScratchEditor.destroy()` on the editor that just lost its pane, and `destroy()`'s whole point is to
   * CANCEL a pending debounce rather than let it fire against a session about to be unbound (its own
   * doc). A keystroke typed inside that 300ms window, immediately followed by the two gestures needed to
   * cool this buffer before the timer would have fired, never reaches `setText` and is lost. Narrow —
   * the window is 300ms and both gestures have to land inside it — and no code change is wanted for it;
   * this paragraph exists so "keep its text" stops being a claim the last keystroke can falsify silently.
   *
   * For what this doc used to claim and why it changed, see the history note under `cool`.
   */
  cool(id: SessionId, home: SessionId, slots: readonly Detachable[]): boolean {
    const state = this.#buffers.get(id)
    if (state === undefined) return false
    for (const slot of slots) {
      if (slot.binding.session === id) slot.rebind(home)
    }
    if (!state.warm) return false
    // 'not compiled' IS THE REASON THE PANE READS FOR THE INSTANT BETWEEN THIS AND THE REBOUND
    // SESSION'S NEXT FRAME — the same wording `main.ts` gives a source session with no program, and
    // true here for the same reason: there is nothing behind this leg any more.
    resetLegs(this.#reg.entryOf(id).legs, null, null, 'not compiled')
    this.#reg.remove(id)
    this.#pool.unbind(id)
    state.warm = false
    return true
  }

  /** How many buffers hold a worker — the quantity `MAX_WARM_BUFFERS` bounds (design §4.4). */
  warmCount(): number {
    let n = 0
    for (const b of this.#buffers.values()) if (b.warm) n += 1
    return n
  }

  /**
   * Record the term buffer `id` now holds — design §4.3's "text of record", read back by `warm` on
   * every restart and by `snapshot` for the field a page reload rebuilds a buffer from, PROVIDED the
   * write this method makes is followed by a `persistBuffers()`/`onBuffersPersist()`; see below. This
   * method itself only ever touches memory — it has no idea whether either caller pairs it with one.
   *
   * **TWO CALLERS, BOTH ALREADY-EXISTING CALL SITES, AND NO THIRD — AND ONLY ONE OF THEM IS A
   * DURABILITY MOMENT, NOT BOTH, A CLAIM A PRIOR REVISION OF THIS DOC GOT WRONG.** `recompile` above
   * calls it with the user's own just-typed text, at the point a rebuild is POSTED, not answered —
   * nothing persists there, and `recompile`'s own doc has the argument in full. `replies.ts`'s
   * `scratch-compiled` arm calls it with the worker's re-derived term — for a FORK, the first moment
   * this app can know what a forked buffer holds at all, since `fork` posts the SOURCE session's step-0
   * text plus a step and the worker replays between them; for a `recompile`'s own reply, the re-derived
   * term replacing the raw text `recompile` wrote above — and, under the SAME `reply.text !== null`
   * guard, immediately calls `onBuffersPersist()` (both lines are in `replies.ts`'s `scratch-compiled`
   * arm, the `setText` and the persist directly below it). That PAIRING, not the call to this method
   * alone, is what makes it a durability moment; `recompile`'s call has no such pairing anywhere in its
   * body.
   *
   * **SO A `recompile` WHOSE REPLY ANSWERS `text: null` LEAVES THIS METHOD'S WRITE STRANDED IN
   * MEMORY.** Unparseable input and a term over `LAMBDA_BYTE_BUDGET` both answer `text: null` (§4.1a);
   * when that happens the `scratch-compiled` arm's own `setText`/persist pair is skipped by the same
   * guard, so nothing ever persists the text `recompile` wrote. The typed text stays live in this
   * record — a caller reading `text` back before the next reload still sees it — but a reload restores
   * whatever WAS durable before the edit, not what the user just typed. The behaviour is correct
   * (design's persist sites do not include a bare edit); only the old sentence claiming both callers
   * were durability moments was wrong.
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
   * Remember whether buffer `id`'s editor is collapsed — design §4.7, and the answer to the question
   * `pane-chrome.ts`'s `collapseButton` doc has carried since 5d-i: PER BUFFER, because the editor
   * MOVES between panes under `editor-custody.ts`, and a flag remembered against a leaf would describe
   * whichever buffer landed there next.
   *
   * **A NO-OP FOR AN UNKNOWN `id`, LIKE `setText` ABOVE, NOT A THROW LIKE `warm`'s.** The one caller,
   * `transport.ts`'s `collapse` handler, reads `slot.binding.session` off a live pane's slot the same
   * way `setText`'s callers do — see `setText`'s own doc for why that reading can never name a buffer
   * this map does not hold.
   */
  setCollapsed(id: SessionId, collapsed: boolean): void {
    const state = this.#buffers.get(id)
    if (state !== undefined) state.collapsed = collapsed
  }

  /**
   * Whether buffer `id`'s editor was collapsed. `false` for an id that is not a buffer.
   *
   * **`false` RATHER THAN `undefined`, FOR `replies.ts`'s `scratch-compiled` ARM.** That call site hands
   * this straight to `LambdaPane.setEditor`'s second parameter, which itself defaults to `false` for
   * every OTHER caller — an `undefined` here would agree with that default by coincidence rather than
   * by the type saying so, and a caller that ever stopped relying on the default would be handed a value
   * this method never actually observed a buffer holding.
   */
  collapsedOf(id: SessionId): boolean {
    return this.#buffers.get(id)?.collapsed ?? false
  }

  /**
   * Everything a pane needs to mount buffer `id`'s editor without waiting for a worker: the text of
   * record and the collapse flag, together. `null` for anything that is not a WARM buffer.
   *
   * **THIS EXISTS BECAUSE A PANE CAN ARRIVE AT A BUFFER LONG AFTER THE REPLY THAT WOULD HAVE SEEDED IT
   * — the λ half of the repair `pane-host.ts`'s `tmProgramOf` already performs for the other leg.**
   * `replies.ts`'s `scratch-compiled` arm mounts the editor, and it fires once per build; a pane that
   * binds to the buffer afterwards has nothing to mount from, because the arm has been and gone. A
   * `cool` followed by a `warm` is the path that reaches that state: `cool` rebinds every pane away (its
   * own invariant), so the editor is destroyed by `setDetached(false)`'s teardown, and `warm` posts a
   * build that lands with no pane claiming a leaf, so `editorHome` answers `undefined` and nothing
   * mounts. Without a seed to mount from, `cool` — "the non-destructive escape from the cap" (see its
   * own doc) — would be destructive of editability.
   *
   * **BOTH FIELDS IN ONE ANSWER, NOT `textOf` PLUS `collapsedOf`.** `LambdaPane.setEditor` takes them
   * together and its mount branch reads both in the same statement, so two accessors would be two reads
   * a caller has to remember to pair — the same pairing `replies.ts`'s arm already makes by hand and the
   * one thing a second mount site could get wrong silently (design §4.7: the flag "takes effect when the
   * buffer warms and mounts an editor"). `collapsedOf` stays for the caller that genuinely has only that
   * question.
   *
   * **`null` FOR A COLD BUFFER, WHICH IS THE INVARIANT RESTATED RATHER THAN A MISSING CASE.** A cold
   * buffer has no panes bound to it (`cool`'s own doc), so no pane can ask this about one; answering
   * with text anyway would hand a caller a seed for a session `entryOf` cannot resolve, which is the
   * state `draw()` throws on. `null` is also the honest answer for the source session and for any id no
   * fork ever minted — the same answer, for the same reason: there is no buffer here to edit.
   *
   * For what this doc used to claim and why it changed, see the history note under `editorSeed`.
   */
  editorSeed(id: SessionId): { text: string; collapsed: boolean } | null {
    const state = this.#buffers.get(id)
    if (state === undefined || !state.warm) return null
    return { text: state.text, collapsed: state.collapsed }
  }

  /**
   * Refuse a fork or a warm at the cap — the one throw `fork` and `warm` share.
   *
   * **EXTRACTED AFTER REVIEW FOUND FIVE IDENTICAL LINES AT TWO CALL SITES, INCLUDING A
   * HUNDRED-CHARACTER MESSAGE.** The drift that duplication invites had already happened once: Minor 1
   * of the same review found `main.ts` quoting this message from BEFORE a wording change, because
   * nothing forced the two copies (nor the quotation) to move together. One method fixes that by
   * construction rather than by discipline — there is now exactly one string to get right and one
   * place a future wording change has to reach. `never` rather than `boolean` because both call sites
   * throw immediately and never branch on a return value; the type says what the control flow already
   * does.
   *
   * READS AS A SENTENCE ON ITS OWN, WITH ROOM FOR A CALLER'S OWN PREFIX AHEAD OF IT — no "the fork was
   * refused" clause, because the sentence itself must stay honest for a caller that never attempted one.
   *
   * **`prefix` IS THE ONE THING `fork` AND `warm` DO NOT SHARE, AND IT IS A PARAMETER RATHER THAN
   * SOMETHING BAKED IN HERE OR IN `link-status.ts` — 5d-ii-d review round 2, Finding 3.** A renderer
   * that cannot tell its callers apart has no honest way to prefix only some of them, and `warm`'s
   * refusal reaches the same field as `fork`'s over restore/header-list paths that are not forks.
   * `fork` passes `'fork failed — '`, because that call genuinely is a fork failing. `warm` passes
   * `''`: warming a cold buffer back up — whether the user
   * asked for that from the header list or a restore is doing it on their behalf — is a different
   * gesture, and the plain sentence (cap and remedy, no gesture named) is exactly what is true of it.
   * Hence a semicolon rather than a second dash in the body: the body still has to read correctly with
   * nothing in front of it.
   *
   * For what this doc used to claim and why it changed, see the history note under `#refuseAtCap`.
   */
  #refuseAtCap(prefix: string): never {
    throw new BufferCapReached(
      `${prefix}all ${MAX_WARM_BUFFERS} scratch buffers are live; retire or cool one from the buffers list in the header to make room`,
    )
  }

  /**
   * Bind a worker, register the session, and post the build. The half of `fork` a `warm` repeats.
   *
   * **TAKES THE RECORD ITSELF, NOT ITS ID — A REVIEW FIX, AND THE ORIGINAL SHAPE WAS A WIRING HAZARD
   * RATHER THAN MERELY AWKWARD.** It used to take `id` and read `this.#buffers.get(id)` twice inside
   * this method: once for the label (falling back to `?? id` when the record was missing) and once to
   * flip `warm` to `true` (a silent no-op when it was missing). Both reads assumed the caller had
   * already put the record into `#buffers` before calling this — true for `warm`, and no longer
   * guaranteed for `fork` once the record's insertion moved to AFTER this method returns (`fork`'s own
   * doc has the reason). Had this kept reading `#buffers` by id, a wiring bug that called it before the
   * record existed would not have thrown: `reg.add` would have registered the session under the
   * fallback label `id`, and `state.warm = true` would have silently done nothing — so `warmCount()`
   * would under-count a live, running thread FOREVER, with nothing anywhere to report it. Taking the
   * record removes the possibility rather than guarding against it: both lookups are gone, the `?? id`
   * fallback and the `!== undefined` check with it, and this method never reads `#buffers` at all.
   */
  #spawn(state: BufferState, src: string, step: number): void {
    // THE REPLY CARRIES THE ID BECAUSE THE WIRE DOES NOT (5d-i §3.2: the port is the id). One
    // collection, one `onReply`, many threads — so the name is closed over HERE, per buffer, at the
    // one place that knows which thread it just made.
    const client = this.#pool.bind(state.id, (reply) => this.#onReply(state.id, reply))
    // NOT AVAILABLE YET, WITH A REASON A PANE CAN READ — unchanged in intent from the λ-only version;
    // what changed is WHICH leg gets it. A session holds at most one leg per `Leg`, and this is where
    // that is decided for a buffer.
    const pending = { available: false, reason: 'building…' }
    const legs =
      state.leg === 'lambda'
        ? { lambda: { hist: new History<LambdaState>(this.#bytes), status: pending, done: null, timer: null } }
        : { tm: { hist: new History<TmState>(this.#bytes), status: pending, done: null, timer: null } }
    this.#reg.add({
      id: state.id,
      label: state.label,
      // `detached: true` BY CONSTRUCTION, AND NOTHING CAN SET IT OTHERWISE. 5d-i §3.3 is why it is
      // knowable at creation: `linkIndex` and `sourceSpan` exist on neither scratch type, so a
      // scratch session can never participate in the sync anchor. `main.ts`'s source entry is the
      // only one in the app that may say `false`, and its own comment says so.
      detached: true,
      client,
      legs,
      // **`null` AT CONSTRUCTION FOR BOTH LEGS, AND THE REASON IS NOT THE SAME FOR BOTH.** A λ buffer
      // never gets a machine at all — its worker answers `scratch-compiled`, which carries no
      // `TmProgram` (5d-i §3.3: no TM leg, no `SourceMap`), and no TM pane can ever bind to it either,
      // so nothing will ever write here. A TM buffer's worker DOES answer `tm-scratch-compiled`, which
      // DOES carry a `TmProgram` — but nothing writes it here YET. `replies.ts`'s `onScratchReply` doc
      // (rewritten in this same commit) says so directly: `tm-scratch-compiled` and `tm-frames` are not
      // cases in that switch, so a TM buffer's own compile simply vanishes today, with no pane, no
      // status line and no `#link-status` any the wiser. This field turns real for a TM buffer once a
      // later task gives that switch the two arms it is missing — not before. What is shared between
      // the two legs today is that neither has one at the moment this entry is created, and for a λ
      // buffer that is permanent.
      tmProgram: null,
    })
    state.warm = true
    // SUPERSEDE THEN POST, the pattern `main.ts`'s `schedule` uses and for the same reason
    // (`SessionClient.supersede`'s doc): a fresh client is at generation 0, which matches nothing,
    // so the claim has to happen before the post or the request would drop its own message.
    //
    // NO STEP ON THE TM SIDE, FOR `SessionClient.tmScratch`'s OWN REASON: a machine has no step-k
    // term to replay to, since its text IS the machine. `step` is still a parameter of this method —
    // `warm` passes it as `0` for both legs, `#mint` forwards whatever `fork` was handed — and simply
    // goes unread on the branch that has nothing to replay.
    const gen = client.supersede()
    if (state.leg === 'lambda') client.scratch(gen, src, step)
    else client.tmScratch(gen, src)
  }

  /**
   * Every live buffer, oldest first — design §4.2's header list is the caller this exists for.
   *
   * **THE ACCESSOR THIS CLASS SPENT A TASK REFUSING, ARRIVING WHEN IT HAD SOMETHING TO ANSWER.**
   * Neither container answers THIS question — the registry holds sessions of every kind and the pool
   * holds threads, and neither records which of its keys are buffers or in what order they were forked.
   *
   * `BufferInfo`, NOT `SessionEntry`, and not `SessionId[]` either: a list keyed only by id would send
   * every caller back to the registry for the label, which is the fan-out the type exists to prevent.
   * A COPY RATHER THAN THE MAP'S OWN ITERATOR, so a caller cannot hold a view that changes underneath
   * it between the moment the list is built and the moment a row is clicked.
   *
   * For what this doc used to claim and why it changed, see the history note under `list`.
   */
  list(): readonly BufferInfo[] {
    return [...this.#buffers.values()].map((b) => ({ id: b.id, label: b.label, warm: b.warm, leg: b.leg }))
  }

  /**
   * Everything about these buffers that survives a reload, with `bindings` supplied by the caller.
   *
   * **THE BINDINGS ARE A PARAMETER BECAUSE THIS CLASS DOES NOT KNOW WHAT A PANE IS**, which is the
   * same line `BufferInfo` draws and the reason `main.ts` computes `paneCount` rather than this file.
   * `PaneCollection` answers which leaf is on which session; this answers what the sessions hold.
   *
   * `warm` IS NOT IN THE PAYLOAD, AND ITS ABSENCE IS THE RESTORE POLICY WRITTEN INTO THE FORMAT
   * (design §4.2). A buffer's temperature on the next page load is decided by which PANES came back,
   * not by which buffers happened to hold a thread when this one was closed — so persisting it would
   * store an answer to a question the next load asks differently. `restore` below inserts everything
   * cold for the same reason.
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
   * Insert every buffer in `value` as COLD and set the mint counter — design §4.9 steps 1–2.
   *
   * **NOTHING SPAWNS HERE, AND THAT IS THE RESTORE POLICY RATHER THAN AN OPTIMISATION** (design §4.2).
   * Which buffers deserve a thread is a question about which PANES came back, which this class cannot
   * see; `main.ts` warms the ones its restored bindings name and leaves the orphans asleep.
   *
   * `#minted` TAKES THE STORED COUNTER RATHER THAN THE RESTORED COUNT. A page that forked three
   * buffers and retired two persists `minted: 3` and one buffer, and reissuing `scratch 2` for the
   * next fork would put two different terms under one name across a reload — the exact thing `#minted`
   * only ever counting up exists to prevent.
   *
   * **IT ASSIGNS RATHER THAN TAKES A MAXIMUM, AND THE VALIDATION THAT MAKES THAT SAFE IS SOMEWHERE
   * ELSE.** `parseBuffers` refuses a payload whose `minted` is below any id it carries
   * (`buffers-store.ts`'s own doc: "the counter must dominate every name it claims to have minted"),
   * so by the time a value reaches here the counter is already known to be past every restored id. The
   * one caller in `src/` is `main.ts`'s restore block, which reads through exactly that function; a
   * caller that hand-built a `PersistedBuffers` would be handing this class a state its only producer
   * cannot produce.
   *
   * **CALLED BEFORE ANY FORK, AND NOTHING ENFORCES THAT HERE.** `main.ts` restores while resolving its
   * layout, which is before a pane exists to carry the `✎ fork` control, so `#minted` cannot already
   * have moved. A guard would be this class asserting an ordering its one caller establishes by
   * construction — and the honest version of it (refusing a restore into a non-empty collection) would
   * have no caller to refuse.
   */
  restore(value: PersistedBuffers): void {
    this.#minted = value.minted
    for (const b of value.buffers) {
      this.#buffers.set(b.id, {
        id: b.id,
        label: b.label,
        leg: b.leg,
        text: b.text,
        collapsed: b.collapsed,
        warm: false,
      })
    }
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
   * another pane is showing. `retire` and `noSessionReply` below are keyed the same way.
   *
   * **`this.#reg.entryOf(id)` BELOW WOULD THROW FOR A COLD BUFFER'S ID, AND THAT IS UNREACHABLE RATHER
   * THAN GUARDED AGAINST.** `#buffers.has(id)` used to imply a registry entry — a buffer was in
   * `#buffers` and in the registry together or in neither — and that invariant is exactly what 5d-ii-d's
   * cold buffers falsified (`#buffers`'s own doc records it). What makes the throw unreachable here is a
   * narrower invariant `cool` now maintains instead: **a cold buffer has no panes bound to it**, because
   * `cool` rebinds every pane on `id` to `home` before it forgets the session (`cool`'s own doc). This
   * method's only caller, `transport.ts`'s `editScratch`, is reached from a pane's own binding —
   * `slot.binding.session` — so calling it with a cold buffer's id would require a pane still bound to
   * one to call it from, and there is none left to hold. The membership check above still answers
   * `false` for an id no fork ever minted, or a buffer already retired; it does not need to, and does
   * not, distinguish warm from cold.
   *
   * **IT DOES NOT REBIND AND DOES NOT TOUCH THE REGISTRY.** The pane is already on this session and
   * stays on it; what changes is the term behind the leg. `resetLegs` is NOT called here either — the
   * worker's reply drives the leg through the same path a first fork does, and clearing the ring
   * ahead of it would blank the pane for the round trip rather than at the end of it.
   *
   * ANSWERS A BOOLEAN FOR `retire`'s REASON, INVERTED: `retire` returns one because it can be handed
   * the name of a buffer that has already ended, and this returns one because an editor cannot exist
   * without the buffer behind it — so `false` is a caller bug rather than the common case, and a caller
   * that ignores it has a pane bound to nothing.
   *
   * For what this doc used to claim and why it changed, see the history note under `recompile`.
   */
  recompile(id: SessionId, src: string): boolean {
    const state = this.#buffers.get(id)
    if (state === undefined) return false
    // THE TEXT OF RECORD, WRITTEN AT THE POINT IT BECOMES TRUE (design §4.3). This is the user's own
    // text; the other writer is `replies.ts`'s `scratch-compiled` arm, which carries the worker's
    // answer for a fork. Two writers, both already-existing call sites, and no third.
    this.setText(id, src)
    const client = this.#reg.entryOf(id).client
    // BRANCHES ON `state.leg`, MIRRORING `#spawn` — 5d-iv T5 REVIEW FIX. This used to post
    // `client.scratch` unconditionally, which is `lambda-scratch` on the wire regardless of which leg
    // the buffer was actually minted on. For a TM buffer that reaches `onLambdaScratch`, which parses
    // `.tm` TEXT as a λ TERM and answers `no-session` with a λ syntax error every time — `#spawn`'s own
    // two-way branch is the fix already applied at mint; this is the same branch at the one other place
    // this class posts a build to an EXISTING buffer.
    const gen = client.supersede()
    if (state.leg === 'lambda') client.scratch(gen, src, 0)
    else client.tmScratch(gen, src)
    return true
  }

  /**
   * Retire buffer `id`: rebind its panes to `home`, stop its playback, forget it, and **terminate its
   * worker**. Answers whether that buffer was live.
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
   * **ONE CALLER IN `src/`, AND DESIGN §4.3's TABLE IS CLOSED AROUND IT:** a recompile does not end a
   * buffer, a failed build does not end a buffer, and the only row left with "ends it" in it is the
   * explicit retire. That caller is `main.ts`'s retire handler, which hands over every pane's slot and
   * then sweeps custody itself; this method is unchanged and did not need to change, since
   * `buffer-list.ts`'s rows already called an
   * `onRetire: (id: SessionId) => void` this was written to be the argument for. `tests/node/scratch.test.ts`
   * and `tests/browser/scratch-fork.test.ts` drive it directly as well, at the layer the list drives it
   * from.
   *
   * **IT IS `cool` PLUS FORGETTING THE RECORD NOW, WHICH IS WHERE THE ORDER ARGUMENT THAT USED TO LIVE
   * HERE WENT.** `retire` is now `this.cool(id, home, slots)` followed by
   * `this.#buffers.delete(id)`; **`cool` owns the panes/legs/registry/pool order and the reasoning for
   * it now — read it there.** Nothing here rebinds twice: a buffer that arrives warm is rebound and
   * cooled in that one call inside `cool`; a buffer that arrives already cold was rebound by whichever
   * `cool` cooled it, so THIS call's rebind pass runs again (`cool`'s doc calls it "a pass that finds
   * nothing to do") and finds nothing, by the same invariant.
   *
   * **IT RETURNS A BOOLEAN AND NOTHING IN `src/` READS THE ANSWER TODAY.** §4.4's retire control is
   * wired and DISCARDS it: `bufferList` builds its rows on `beforetoggle`, so a row could name a spent
   * buffer only if something had retired it between the open and the click, and there is exactly one
   * retire in the app: that click. A guard on this answer at that call site would be a branch nothing
   * can take. **What the answer is genuinely kept for is the stale-name contract below**, and the tests
   * are what read it: `tests/node/scratch.test.ts` asserts both arms and
   * `tests/browser/scratch-fork.test.ts` asserts the `true` at the layer the list drives this from.
   *
   * IDEMPOTENT, MIRRORING `SessionPool.unbind` AND `SessionRegistry.remove`: a guard every caller must
   * write is a guard the callee should have. **THE MEMBERSHIP CHECK STAYS, AND WHAT IT GUARDS AGAINST
   * IS NOT WHAT IT USED TO GUARD AGAINST.** `entryOf` is not below any more — it is inside `cool`,
   * behind `cool`'s own `state === undefined` guard, which
   * answers `false` rather than throwing. Delete this check today and a stale name no longer throws: it
   * falls through to `this.cool(id, home, slots)` (`false`, no record for `cool` to touch), then
   * `this.#buffers.delete(id)` (a no-op on a key that is not present), and returns `true` — a caller
   * holding a name that never existed, or was already spent, is told it just ended a buffer. The
   * guard's job moved from SAFETY (stopping a throw) to CORRECTNESS (stopping a wrong `true`); it is
   * exactly as necessary either way, and it answers for the same caller it always did — one that kept a
   * buffer's name across the retire that spent it.
   *
   * For what this doc used to claim and why it changed, see the history note under `retire`.
   */
  retire(id: SessionId, home: SessionId, slots: readonly Detachable[]): boolean {
    if (!this.#buffers.has(id)) return false
    this.cool(id, home, slots)
    this.#buffers.delete(id)
    return true
  }

  /**
   * A `no-session` reply naming a buffer: the diagnostics to report as a FAILED FORK, or `null` when
   * this buffer's own editor is the right place for them — CRITICAL finding, plan 5d-iii's ninth task.
   *
   * **IT TAKES THE BUFFER THE REPLY NAMED, WHERE IT USED TO READ WHATEVER `retire` WOULD HAVE ENDED.**
   * The reply arrives with its session (`ScratchBuffersConfig.onReply` curries it in per buffer) and
   * that is the buffer this answers for.
   *
   * **NOTHING HERE MOVES A PANE OR ENDS A SESSION**, which is why the signature carries neither
   * `home: SessionId` nor `slots: readonly Detachable[]`: they went with the call that used them, and a
   * signature that still asked for somewhere to send panes would be describing a job this method no
   * longer has. What remains below is the discriminator and the answer.
   *
   * **THE PANE STAYS ON A BUFFER THAT WILL NEVER PRODUCE A FRAME**, reading the `building…` placeholder
   * `fork` seeded, with the reason on `#link-status` and no PANE-LOCAL way out. That is the same gap
   * `compile.ts`'s `schedule` records for the recompile path, widened to cover every way a buffer can
   * end up wedged: design §4.4 puts poison recovery in the header list precisely because a wedged buffer
   * has to be reachable whether or not a pane is still showing it. **THAT LIST IS WIRED**, so the way
   * out is one gesture away from any state: open `buffers` and retire the row, which rebinds this pane
   * home and offers `✎ fork` again — the remedy 5d-i §4.1a promises, delivered from the header instead
   * of from the pane that is stuck. `tests/browser/scratch-fork.test.ts` asserts exactly that sequence.
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
   * **THE DISCRIMINATOR IS WHETHER THE λ LEG HAS EVER RECORDED A FRAME.** A fork posts exactly one
   * build per buffer and posts it at creation, so a buffer with no frame yet has had nothing but that
   * build addressed to it. A buffer that already holds a frame can only be
   * mid-`recompile`, because that is the only other message this class ever posts to an existing
   * buffer. The two cases are still exhaustive and mutually exclusive by construction, not by
   * inspecting which caller happened to trigger this reply — **FOR A λ BUFFER.** The line below reads
   * `legs.lambda` UNCONDITIONALLY, which is a λ buffer's own leg but never a TM buffer's — `#spawn`
   * gives a `'tm'` buffer's entry a `tm` leg and no `lambda` leg at all, so `leg !== undefined` is
   * `false` for one on every call, and this method takes the phantom branch every time regardless of
   * which of the two reasons actually produced the reply. **THAT DOES NOT YET DISAGREE WITH ANYTHING
   * OBSERVABLE, WHICH IS WHY IT IS RECORDED RATHER THAN FIXED HERE.** `replies.ts`'s `onScratchReply`
   * doc names the reason: nothing routes a TM buffer's `tm-scratch-compiled` or its `tm-frames`
   * anywhere yet, so a TM buffer's OWN `tm` leg never records a frame either — asking the right leg
   * would still answer `undefined` today. The day that changes — the day `onScratchReply` grows the two
   * arms that doc calls left open — this discriminator starts answering wrong for a TM buffer's
   * `recompile`, now that `recompile` reaches one at all (5d-iv T5 review round, Important 1): it will
   * report an ordinary mid-edit parse failure as a failed fork, on a buffer whose build already
   * succeeded.
   *
   * RETURNS THE DIAGNOSTICS ON THE PHANTOM PATH, so the caller has the reason to put on the surface
   * built for it — a routing decision rather than a report on something that has already happened.
   * `null` ON THE LIVE-EDIT PATH, where the caller's existing
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
   *
   * **A COLD BUFFER REACHES THIS METHOD TOO, AND THE ARGUMENT THAT MAKES `recompile` SAFE FOR THE SAME
   * SHAPE OF GUARD DOES NOT TRANSFER — 5d-ii-d review round 2, Finding 1.** `recompile`'s
   * `if (!this.#buffers.has(id)) return false` followed immediately by `this.#reg.entryOf(id)` is safe
   * because its only caller is reached through a pane's own binding (`slot.binding.session`), and the
   * invariant `cool` maintains — a cold buffer has no panes bound to it — means no binding can name one
   * (`recompile`'s own doc has the argument in full). This method's caller is not a binding at all:
   * `replies.ts`'s `no-session` arm calls it from a WORKER REPLY, routed by `session` alone, and nothing
   * about a reply's arrival is gated on any pane still pointing at the buffer it names.
   *
   * **THE RACE THAT PARAGRAPH DESCRIBES DOES NOT EXIST, AND THIS IS THE CORRECTION — whole-branch review
   * before merge, finding 8.** **The HTML specification writes down what `Worker.terminate()` does with
   * queued messages**: the *terminate a worker* algorithm, applied to a dedicated worker, empties the port
   * message queue of the port the worker is entangled with — the PARENT side — after discarding the
   * worker's own queued tasks and aborting its script. `cool` calls `#pool.unbind(id)`, which calls
   * `held.port.terminate()` (`session-client.ts`'s `unbind`), synchronously, before it returns. So a
   * reply for a cooled buffer cannot be dispatched, and the guard below is belt-and-braces after all.
   *
   * **WHICH IS WHY THIS FILE AND `replies.ts` ARE NOW CONSISTENT INSTEAD OF ONE ARM DEEP.** The same
   * switch's `scratch-compiled` arm resolves `sessions.entryOf(session).legs` and its `lambda-frames` arm
   * resolves `sessions.legOf({ session, leg: 'lambda' })`, and both throw for a session the registry no
   * longer holds. If the race were real, those two were exposed to it exactly as this method is, and
   * guarding one of three arms would have been the worst of both readings — a defence that reads as
   * necessary while two identical exposures went unmentioned. It is not real, so neither of them needs a
   * guard and this doc no longer claims one is load-bearing. `replies.ts`'s own arms carry the same fact
   * where a reader meets them.
   *
   * **THE CHECK STAYS ANYWAY, AND ON ITS OWN TERMS RATHER THAN THE RACE'S.** It is one field read on a
   * path that already does a map lookup, it makes this method total over every `BufferState` rather than
   * over the warm ones its caller happens to produce, and the answer it gives is the one this method
   * already gives for an id that was never a buffer: `null`, meaning "there is nothing here to report a
   * fork failure for." What it must NOT be read as is a guard against a state the app can reach — the
   * fake-port tier records `terminate()` as a COUNT rather than as message-discarding (`FakePort.terminated`,
   * `tests/node/scratch.test.ts`), so no node test can distinguish the two readings, and only a real
   * worker ever could. Nothing in `tests/browser/` aims at it, because there is nothing there to aim at.
   *
   * For what this doc used to claim and why it changed, see the history note under `noSessionReply`.
   */
  noSessionReply(id: SessionId, diagnostics: readonly Diagnostic[]): readonly Diagnostic[] | null {
    const state = this.#buffers.get(id)
    if (state === undefined || !state.warm) return null
    const leg = this.#reg.entryOf(id).legs.lambda
    if (leg !== undefined && leg.hist.current !== undefined) return null
    return diagnostics
  }
}
