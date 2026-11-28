import { type ControlState, controlState } from './controls'
import { History } from './history'
import { LEGS } from './legs'
// A TYPE-ONLY IMPORT, AND THE ONE DIRECTION THAT WOULD OTHERWISE BE A CYCLE — `pane-chrome.ts` already
// imports `Binding`/`PaneOption` from here. `import type` is erased entirely at build time, so this
// names a shape rather than creating a load-order relationship between the two modules; `SplitChoices`
// is declared beside the control that reads it because it is that control's input, not the registry's
// output — this module does not supply all of it, and a count of what it does would go stale on sight.
import type { SplitChoices } from './pane-chrome'
import type { ClifCompiled, Leg, LegFrame, LegProgram, RecordEnd, RxmLeg } from './protocol'
import type { SessionClient, SessionId } from './session-client'

/**
 * One leg's live state on this side of the boundary: its history, how recording ended, and what the
 * worker said about it at compile time.
 *
 * NO SESSION IDENTITY IN IT, AND DELIBERATELY SO. 5d-i design §3.2b names that absence as the reason
 * decision 1 had nothing to attach to — but the answer is `SessionEntry` below OWNING a leg, not a leg
 * naming its owner. A back-pointer would write the pairing down in two places and give it two places
 * to be wrong, and nothing reaches a leg without going through its session to get there.
 */
export type LegState<T> = {
  hist: History<T>
  status: { available: boolean; reason: string }
  done: RecordEnd | null
  /**
   * Whether the play button is on for this leg — `player.ts`'s flag, which the player follows and
   * `resetLegs` clears.
   */
  playing: boolean
  /**
   * How many times the leg has been rewound since its build, which set it to 0 (`resetLegs`), and the CLIF leg asked
   * for a listing: frames carrying another epoch are from a recording one of those replaced, and the requests for the
   * leg carry this one (the `rewind` request, in `protocol.ts`'s `RunRequest`).
   */
  epoch: number
  /**
   * The generation of the frames the ring holds, which `replies.ts` sets from each reply that puts frames in it (a
   * chunk's, in `pushFrames`, and a build reply's step 0, in `seedFirst`) and nothing else writes; 0 on a leg no frames
   * have reached. While it is the client's generation the worker holds
   * their recording, which `transport.ts`'s `restart` needs before it asks for a rewind (hidden-recording spec §6).
   */
  gen: number
  /**
   * The step a shared link's position is taking this leg to, while the frames have not reached it — Plan 7 part 6a
   * spec §5.4: set and spent, and dropped at a recompile, by `share-positions.ts`'s `LinkPositions`; read by the step
   * line; and taken away by a gesture on the leg's step controls. Absent on every leg no link is taking anywhere.
   */
  pending?: number
  /**
   * The CLIF leg's hold while a `clif` request replaces the recording its ring holds (`holdClifLeg`). Absent on every
   * other leg, and on the CLIF leg at every other time.
   */
  clifHold?: ClifHold
}

/**
 * What the CLIF leg keeps on the page while a `clif` request replaces its recording (`holdClifLeg`): **ITS RING, END
 * AND LISTING STAY AS THEY ARE UNTIL THE NEW RECORDING'S FIRST FRAMES COME**, which `replies.ts` shows with the
 * listing that came for them, or until a listing that says the leg has none; and these, which the page goes on saying
 * or keeps until then. Every reset and rewind of the leg drops it whole.
 */
export type ClifHold = {
  /**
   * The step a link's position was taking the leg to when a listing chosen dropped the position: **THE STEP LINE AND
   * THE READOUT GO ON SAYING IT** until the new frames replace the line it was in, so neither moves before the view
   * does. `LinkPositions` holds it no longer, so nothing seeks or continues the leg towards it.
   */
  linkStep?: number
  /**
   * The CLIF part of the result stored when the hold began, and that result's generation: a result of that generation
   * that comes during the hold keeps it (`replies.ts`), so the readout neither loses nor changes its CLIF rows before
   * the view changes. A result of another generation is a compile's, which the hold does not outlast.
   */
  readonly part?: { readonly gen: number; readonly clif: RxmLeg }
  /** The listing a `clif-listing` gave for the hold's epoch, kept until that epoch's first frames show it with them. */
  landing?: { readonly gen: number; readonly epoch: number; readonly compiled: ClifCompiled }
  /**
   * Whether a rewind had emptied the ring, its first frames not come, when the first hold began: **THE STEP LINE GOES
   * ON SAYING THE LEG RECORDS FROM STEP 0** (`ControlState.rewinding`), as it did then, where a ring a compile emptied
   * goes on reading not run. Kept, because the leg cannot tell the two apart once held: each hold raises the epoch a
   * compile put to 0, and a recompile claimed during the hold leaves neither ring's frames the client's generation.
   */
  readonly rewinding: boolean
}

/**
 * The legs one session owns — AT MOST ONE PER `Leg`. Which keys an entry's `legs` record has is what the session
 * offers: `options` and `pairs` below list a session under a leg exactly when it has that key.
 *
 * OPTIONAL RATHER THAN A UNION OF NAMED SHAPES. A union would make `legOf` switch on a session KIND
 * that nothing else in this file needs, and the switch would have to be re-derived at every call site
 * that only wants one leg. The optional record answers the one question anybody asks — "does this
 * session have leg K" — as a key lookup, which is also exactly what `options` below enumerates for
 * the selector.
 *
 * UNDER `exactOptionalPropertyTypes` ABSENCE IS REAL ABSENCE: `{ lambda: undefined }` does not
 * typecheck, so "has no λ leg" cannot be spelled two ways.
 *
 * A MAPPED TYPE OVER `Leg` RATHER THAN A LITERAL OPTIONAL PROPERTY PER LEG, AND THE CHOICE HAS A
 * CONSEQUENCE ONE CALLER FEELS. `{ [L in Leg]?: … }[K]` is INSTANTIATED by the checker, so `legOf` can
 * declare and return `LegState<LegFrame[K]>` — a concrete `LegState<…>` a caller can infer against.
 * Literal properties would leave `SessionLegs[K]` a DEFERRED indexed access instead: assignable to
 * `SessionLegs[Leg]`, but not to `LegState<LegFrame[K]>`, which is what a renderer parameterised by
 * its frame type needs. Both cannot be had — `History<T>`'s methods make `LegState` invariant in `T`,
 * so the two forms are genuinely different types and not two spellings. This form is chosen because
 * `PaneView<LegFrame[K]>` is on the render path; `transport.ts`'s `play` carries the other half of
 * this note.
 */
export type SessionLegs = { [L in Leg]?: LegState<LegFrame[L]> }

/**
 * One session: what it is called, the legs it records into, the machine its last compile produced, and the client
 * that talks to its worker.
 *
 * THE CLIENT IS PER ENTRY BECAUSE THE GENERATION ALREADY IS. `SessionClient`'s `#gen`
 * (`session-client.ts`) is private and per instance, and generations are per session (5d-i design §3.2).
 *
 * THE ENTRY HOLDS THE CLIENT; `SessionPool` OWNS ITS WORKER'S LIFE. There is exactly one
 * `SessionClient` per session and both names refer to it — `client` here is the reference `pool.bind`
 * returned, not a second object. The split is which questions each container answers: this one is
 * asked "what does the λ pane's session record into", the pool is asked "may this session's
 * thread exist".
 */
export type SessionEntry = {
  readonly id: SessionId
  /**
   * What the binding selector calls this session, in words.
   *
   * A FIELD RATHER THAN A FUNCTION OF `id`, because the id is a map key and the label is UI text, and
   * a `Record<SessionId, string>` beside the registry would be a second place for the pairing to be
   * wrong — the failure `LegState`'s doc refuses. It also keeps `sessions.ts` free of the app's session
   * names: a name is decided where its session is CREATED, which is `main.ts`, and is never decided here.
   */
  readonly label: string
  readonly client: SessionClient
  readonly legs: SessionLegs
  /**
   * Each leg's program as this session's views were last told it, or `null` where it has none: every session at
   * construction, and a leg that is unavailable.
   *
   * **IT EXISTS BECAUSE A VIEW CAN BE CREATED AT ANY TIME AND A REPLY ARRIVES ONCE.** A view that comes to show the
   * session after the reply that told the others is seeded from here (`pane-host.ts`'s `SEED`, which `draw.ts` uses
   * for one shown after a compile it missed). Without it, a view built by a split, a pick or a layout restore, or
   * moved by its selector, would show no program until something recompiled.
   *
   * **WRITABLE, BECAUSE IT IS WHAT IS NOT KNOWN AT CONSTRUCTION.** `id`, `label` and `client` are decided by whoever
   * registers the session, and `legs` is a record whose contents move under a reference that does not; each entry here
   * is a fact the worker sends back later, replaced whole each time. Kept here rather than on the leg's `LegState`,
   * because a program is not a frame: it is set once per compile and does not change as the head moves.
   *
   * **WRITTEN WHEREVER THE VIEWS ARE TOLD, WHICH IS WHY IT CANNOT GO STALE.** `replies.ts` stores and fans out in one
   * call, so every arm that clears the views (`no-session`, `worker-error`) or replaces their program (`compiled`)
   * leaves this holding what a view on screen shows. A retention that only ever grew would seed a
   * view created during an outage with a program no other view is displaying.
   *
   * **EVERY LEG'S KEY IS REQUIRED, `null` WHERE THERE IS NONE**, so "none" has one spelling: an absent key beside a
   * `null` one would be a third state, and a reader testing `!== null` would take it for a value.
   */
  programs: { [K in keyof LegProgram]: LegProgram[K] | null }
}

/**
 * A pane's binding — the `(session, leg)` pair decision 1 (5d-i design §2) makes the unit a pane renders.
 *
 * PARAMETERISED BY THE LEG, so a pane slot carries its leg in the TYPE and not only in the value. A
 * `Binding<'lambda'>` resolves to a `LegState<LambdaState>`, so a λ pane cannot be handed TM frames by
 * a binding that merely happens to say `'tm'` at runtime.
 *
 * THAT PROPERTY IS WHAT THE SELECTOR MUST NOT DESTROY, and `PaneSlot` below is where it is
 * re-derived — read its doc before widening anything here. Aliasing two legs cannot be WRITTEN without
 * `as unknown as LegState<TmState>`, so the cast a mutation needs is itself the evidence the types
 * hold. `readonly` on both fields is the other half — a binding is replaced, never edited in place, so
 * there is no field write that could put a `'tm'` in a `Binding<'lambda'>`.
 */
export type Binding<K extends Leg> = { readonly session: SessionId; readonly leg: K }

/** One entry in a pane's binding selector: the session it names, and what to call it on screen. */
export type BindingOption = { readonly id: SessionId; readonly label: string }

/** One `(leg, session)` pair a pane may be pointed at, with the label the selector shows. */
export type PaneOption = { readonly leg: Leg; readonly id: SessionId; readonly label: string }

/**
 * Clear every leg this session has, and set each one's compile-time status.
 *
 * `reason` is what a leg's control strip reads (`controls.ts`'s `controlState` returns it straight as `stepText` while
 * `!available`) when there is no status for the leg to read one from — no `LambdaStatus`, `RxmStatus` or `TmStatus` —
 * i.e. when no leg compiled at all. 5a design §6's error table says the panes "read 'not compiled'" for that case; an
 * empty `reason` would leave them reading nothing.
 *
 * TAKES THE LEGS IT RESETS RATHER THAN A SESSION ID, and `SessionLegs` rather than the whole
 * `SessionEntry`, because a reset is exactly a statement about legs — it never touches the client. One
 * session's compile must not clear another session's histories, and the smallest parameter that makes
 * that impossible is this one.
 *
 * A STATUS FOR A LEG THE SESSION DOES NOT HAVE IS DROPPED, NOT FABRICATED: writing one so the record is square is the
 * shape `session.rs`'s `Session::tm` records the cost of. A caller passing a status for a leg the session lacks is not
 * an error either: each caller passes the statuses its one reply carries, whatever legs the entry has, so this is
 * silent rather than a throw.
 *
 * **ONE STATUS PER LEG, BY LEG, AND EACH ONLY ITS TWO FIELDS.** The body reads `available` and `reason` and nothing
 * else, so each caller passes whatever status its reply carries — a `LambdaStatus`, an `RxmStatus` or a `TmStatus` —
 * without fabricating fields this function never asks for. Keyed by `Leg`, a leg the caller has no status for is simply
 * left out.
 */
export function resetLegs(
  legs: SessionLegs,
  statuses: { readonly [L in Leg]?: LegAvailability | null },
  reason = '',
): void {
  for (const l of LEGS) {
    const leg = legs[l]
    if (leg === undefined) continue
    leg.hist.clear()
    leg.done = null
    delete leg.clifHold
    leg.playing = false
    leg.epoch = 0
    const status = statuses[l]
    leg.status = { available: status?.available ?? false, reason: status?.reason ?? reason }
  }
}

/**
 * Take a leg back to step 0 for a rewind of its recording: a new epoch, so that frames from the recording it replaces
 * are dropped (`pushFrames`), and an empty ring with no end, which the leg's first frames under that epoch fill
 * (hidden-recording spec §5.4). The `rewind` request is the caller's, as a reset's request is.
 */
export function rewindLeg(leg: LegState<unknown>): void {
  leg.epoch += 1
  leg.hist.clear()
  leg.done = null
  delete leg.clifHold
}

/**
 * Raise the CLIF leg's epoch for a `clif` request that replaces the recording its ring holds, as `rewindLeg` does, but
 * keep the ring and its end (`ClifHold`): **A VIEW OF THE LEG GOES STRAIGHT FROM THE RECORDING REPLACED TO THE NEW
 * ONE'S FIRST FRAMES**, with no draw of an empty ring between them. Frames of the recording replaced are still dropped
 * by their epoch (`replies.ts`'s `pushFrames`). **A HOLD BEGUN DURING A HOLD KEEPS ITS LINK STEP AND ITS REWINDING**,
 * which the line it is in still says, and lets go of the listing that came for the epoch it replaces.
 */
export function holdClifLeg(leg: LegState<LegFrame['clif']>, part: ClifHold['part']): void {
  const rewinding = legRewinding(leg)
  leg.epoch += 1
  const linkStep = leg.clifHold?.linkStep
  leg.clifHold = { ...(linkStep === undefined ? {} : { linkStep }), ...(part === undefined ? {} : { part }), rewinding }
}

/**
 * Whether `leg`'s ring is one a rewind emptied and its first frames have not come (`ControlState.rewinding`): empty at
 * an epoch above 0, which a compile's reset puts to 0, or while held what that said when the hold began.
 */
function legRewinding(leg: LegState<unknown>): boolean {
  return leg.clifHold?.rewinding ?? (leg.epoch > 0 && leg.hist.length === 0)
}

/**
 * A leg nothing has recorded yet: an empty ring of `bytes`, no end, not playing, epoch and generation 0, with
 * `status`. **`_leg` IS READ BY `tsc` ALONE**: it picks `K`, so that the ring holds that leg's own frames
 * (`SessionLegs`' doc). The status is copied, so legs built from one status share no object.
 */
export function freshLeg<K extends Leg>(_leg: K, bytes: number, status: LegAvailability): LegState<LegFrame[K]> {
  return {
    hist: new History<LegFrame[K]>(bytes),
    status: { available: status.available, reason: status.reason },
    done: null,
    playing: false,
    epoch: 0,
    gen: 0,
  }
}

/** Whether a leg is there and, when it is not, why — all of a leg's status that `resetLegs` reads. */
export type LegAvailability = { readonly available: boolean; readonly reason: string }

/**
 * THE SESSION REGISTRY — the container 5d-i design §3.2b says decision 1 presupposes.
 *
 * A MODULE RATHER THAN STATE IN `main.ts`, AND THE REASON IS THE TEST RATHER THAN TIDINESS. A registry
 * that is a module is a registry a test can put two sessions in, and `PaneSlot` below is what makes
 * that test drive the SAME resolution the app's `draw()` does rather than a re-implementation of it.
 *
 * TWO MAPS KEYED BY `SessionId` — THIS ONE AND `SessionPool`'s — AND THEY ARE NOT THE SAME FACT
 * WRITTEN TWICE. `SessionPool`'s own doc states the split from its side: the pool says what a session
 * RUNS ON and is the only thing allowed to change it; this says what a session HAS.
 */
export class SessionRegistry {
  /**
   * A `Map` RATHER THAN A FIELD PER SESSION, because the key is what the pool already holds (5d-i
   * design §3.2: `Map<SessionId, SessionClient>`) and because a registry with the sessions spelled out
   * as named fields would have to be rewritten rather than extended for a second one.
   *
   * INSERTION ORDER IS THE SELECTOR'S ORDER, which is why nothing here sorts: `Map` iterates in insertion order, so
   * the sessions are listed as they were registered, without a comparator that would have to invent a rank for a name.
   */
  #entries = new Map<SessionId, SessionEntry>()

  /** How many sessions the registry holds. */
  get size(): number {
    return this.#entries.size
  }

  /**
   * Register a session.
   *
   * THROWS ON AN ID ALREADY HELD, mirroring `SessionPool.bind` and for a related reason: an entry owns
   * histories and their playback flags, so replacing one silently would leave the player stepping a
   * `LegState` nothing can reach any more.
   *
   * **THE THROW IS A PROPERTY OF THIS METHOD, NOT OF A CALL SITE.** Whatever asked, replacing an entry
   * silently would strand its playback, and a container that answered a duplicate id by overwriting
   * would make that unreportable rather than impossible.
   */
  add(entry: SessionEntry): void {
    if (this.#entries.has(entry.id)) throw new Error(`session is already in the registry: ${entry.id}`)
    this.#entries.set(entry.id, entry)
  }

  /**
   * The registry entry for `id`.
   *
   * THROWS RATHER THAN RETURNING `undefined`, the same call the mount-point check at the top of
   * `main()` makes. A binding naming a session the registry does not hold is a wiring bug, not a state
   * the UI has an honest rendering for — and the alternative, an `?? emptyLeg` fallback at every call
   * site, is a fabricated answer for an unreachable state, which is the exact shape
   * `session.rs`'s `Session::tm` records the cost of.
   */
  entryOf(id: SessionId): SessionEntry {
    const entry = this.#entries.get(id)
    if (entry === undefined) throw new Error(`bound to a session that is not in the registry: ${id}`)
    return entry
  }

  /**
   * The `LegState` a binding names.
   *
   * ONE GENERIC RESOLVER, and `LegFrame` is what lets it be one: the return type is
   * `LegState<LegFrame[K]>`, so the λ pane's binding resolves to `LegState<LambdaState>` and the TM
   * pane's to `LegState<TmState>` with no narrowing at either call site.
   *
   * THROWS WHEN THE SESSION HAS NO SUCH LEG, for the same reason `entryOf` throws when there is no
   * such session. Returning `undefined` would push a "this pane is showing nothing, for a reason no
   * user did" branch into every renderer, and `draw.ts`'s per-pane loop has no `try`/`catch`, so a
   * throw here stops the whole render pass and every later one — which is the cost of reaching this
   * line, and the reason the invariant below is enforced rather than merely asserted.
   *
   * **WHICH BINDINGS CAN REACH THIS.** The selector offers `pairs()`, for EVERY leg, to EVERY pane — so
   * it is precisely a source of pairs a given slot cannot resolve: a handler that took the session half
   * of a cross-leg pick and kept the slot's leg would mint exactly the binding this line throws on.
   *
   * **THE INVARIANT IS ENFORCED WHERE A PICK REBINDS A SLOT.** Every pair `pairs()` emits resolves for
   * the leg it names — that is its own doc's claim, and it holds — so what has to be true is that a
   * pick only ever rebinds a slot to a session offering the slot's OWN leg. That is decided by
   * `pane-host.ts`'s `paneEvents.rebind`, which does not refuse: a same-leg pick is delegated to
   * `transport.ts` (which reaches `PaneSlot.rebind` with a session bindable at this slot's leg), and a
   * cross-leg pick never reaches a `rebind` at all — the leaf changes kind and `applyLayout` builds a
   * new entry, whose `PaneSlot` is constructed on the picked leg. Either way no slot is ever pointed at
   * a session lacking its leg. `transport.ts`'s own comparison is a THROW rather than the decision: it
   * asserts that a cross-leg pick never arrives there, so a caller wiring a pane straight to those
   * handlers is told at the mistake instead of minting the binding this line dies on.
   * `tests/browser/pane-kind-switch.test.ts` drives a cross-leg pick on the TM pane and asserts the
   * pane both follows the pick and keeps painting afterwards, which is this line not throwing.
   */
  legOf<K extends Leg>(b: Binding<K>): LegState<LegFrame[K]> {
    const leg = this.entryOf(b.session).legs[b.leg]
    if (leg === undefined) throw new Error(`session ${b.session} has no ${b.leg} leg`)
    return leg
  }

  /**
   * Every session a slot showing `leg` may be pointed at, in registration order.
   *
   * A session appears in `options('lambda')` exactly when it has a λ leg to render. There is no second table of which
   * kind offers what — the legs an entry was built with ARE the answer, so the selector and the resolver cannot
   * disagree about what is bindable.
   *
   * A FRESH ARRAY PER CALL. Accepted rather than cached: it is one array of small objects, and a cache
   * would need invalidating on `add`, which is a second fact to keep in step for a saving
   * nobody measured.
   *
   * **IT IS NOT ON THE PER-FRAME PATH.** `PaneSlot.render` pushes `pairs()` below, so `draw()` never
   * reaches here; `pairs()`'s own doc carries the allocation argument, since it is the call that IS on
   * the path. This one is a registry query with no production caller — it is kept because it is
   * `pairs()` for one leg, stated directly, and because `tests/node/sessions.test.ts` asks a registry what one leg
   * offers without building a whole render pass to find out.
   */
  options<K extends Leg>(leg: K): BindingOption[] {
    const out: BindingOption[] = []
    for (const entry of this.#entries.values()) {
      if (entry.legs[leg] !== undefined) out.push({ id: entry.id, label: entry.label })
    }
    return out
  }

  /**
   * Every `(leg, session)` pair a pane may be pointed at — `options` for every leg, tagged, the legs in
   * `LEGS`' order (`legs.ts`).
   *
   * IT IS BUILT FROM `options`' OWN SOURCE OF TRUTH AND NOT FROM A SECOND TABLE. `options`' doc states
   * the property this inherits: "the legs an entry was built with ARE the answer, so the selector and
   * the resolver cannot disagree about what is bindable." A selector over two axes is exactly where a
   * second table would be tempting, and a second table is how a selector comes to offer a pair `legOf`
   * throws on.
   *
   * GROUPED BY LEG RATHER THAN BY SESSION, because the title's menu lists the pairs in this order, one
   * item each, named leg first (`view-header.ts`'s `pairLabel`), so a leg's sessions sit together.
   * Registration order holds within each group, for `#entries`' reason: it falls out without a
   * comparator that would have to invent a rank.
   *
   * A FRESH ARRAY PER CALL, AND THIS IS THE ONE ON THE PER-FRAME PATH — `PaneSlot.render` calls it for
   * every pane on every recorded frame during playback. Accepted rather than cached: it is one array of
   * small objects against a `controlState` call that formats step counts into strings on the same tick,
   * and the title-selector (`view-header.ts`'s `viewHeader`) compares its rendered key before it touches
   * the DOM, so nothing downstream pays for the allocation.
   */
  pairs(): PaneOption[] {
    const out: PaneOption[] = []
    for (const leg of LEGS) {
      for (const entry of this.#entries.values()) {
        if (entry.legs[leg] !== undefined) out.push({ leg, id: entry.id, label: entry.label })
      }
    }
    return out
  }
}

/**
 * What a `PaneSlot` needs from a pane, and nothing more.
 *
 * A STRUCTURAL TYPE RATHER THAN `LambdaPane | TmPane | RxmPane`, for the reason `ClientPort` exists one
 * module over: everything the slot does is resolve a binding and call three methods, and none of it needs
 * a DOM. `tests/node/sessions.test.ts` drives two slots over one registry with recording fakes, which is
 * where "two panes, two λ sessions, two different frames" is asserted without a browser; the browser
 * tier then asserts the same thing reaches real text on a real `LambdaPane`.
 *
 * `LambdaPane` SATISFIES `PaneView<LambdaState>`, `TmPane` `PaneView<TmState>` AND `RxmPane`
 * `PaneView<RxmState>`, with no `implements PaneView` clause on any — the parameterisation is what makes
 * handing the wrong pane to a slot a type error rather than a runtime surprise.
 */
export type PaneView<T> = {
  /**
   * `before` is the frame one step before `frame`, `null` where the ring keeps none. **AN END FRAME CAN LACK WHERE THE
   * RUN STOPPED**: the TM's `halt` and overflow guard are each one state that several instructions can enter, and only
   * the step before says which one ran.
   */
  render(frame: T | null, controls: ControlState, before: T | null): void
  /**
   * `PaneOption[]` AND A WHOLE `Binding<Leg>`, NOT `BindingOption[]` AND A `SessionId`. The pane's
   * title-selector offers `(leg, session)` PAIRS (`pairs()` above, `view-header.ts`'s `viewHeader`), so both
   * halves of what it displays have to cross this boundary: the list of pairs, and which pair is in
   * force. `Binding<Leg>` and not `Binding<K>` — a `PaneView<T>` is parameterised by its FRAME type,
   * which is what pins its renderer, and the pair on offer is deliberately not restricted to the leg
   * the pane happens to render.
   */
  setBindings(options: PaneOption[], current: Binding<Leg>): void
  /**
   * **`choices` RIDES THE CALL THAT MOUNTS THE CONTROL, WHICH IS WHY IT IS HERE AND NOT ON A SETTER OF
   * ITS OWN.** The split control is the split menu (`view-header.ts`'s `viewMenu`), built on open from a
   * list only the app can produce — the registry's pairs, the pane's own binding, and whether the layout
   * tree is currently without a source leaf. Two routes could reach the pane from `draw()`'s per-frame
   * loop: widen this call, or add a sibling setter beside it. This one is the narrower claim: `tiled`
   * is what puts the split items in the menu at all, so a caller that can offer the gesture has, in the
   * same statement, said what the gesture may create. A sibling setter would make that two calls with
   * an ordering between them — a split item mountable while the list behind it was still whatever the
   * previous frame left, which is the class of staleness this file already refuses for `setBindings` by
   * driving it from the one per-frame pass.
   *
   * THE VALUE IS READ ON OPEN, NOT ON ARRIVAL. The panes store it in a field and hand `viewMenu` a
   * thunk over that field, so this call costs a field write on every recorded frame during playback and
   * the menu that reads it is built at most once per user gesture — `viewMenu`'s own doc has the
   * argument for why the thunk exists rather than a list handed over at construction.
   */
  setLayoutControls(canClose: boolean, tiled: boolean, choices: SplitChoices): void
  /**
   * Whether this view draws its own step controls — `false` while the
   * `steps` switch is `bar` (Plan 7 part 2 spec §8).
   *
   * **REMOVED, NOT HIDDEN** (umbrella §4 rule 4): the bar is the only step control on the page while it is
   * up, so a view's own are a control that cannot apply there.
   *
   * DRIVEN FROM `draw()`'s PER-FRAME PASS: it is a fact about the WORKSPACE rather than about the frame
   * just rendered, so the per-frame pass is the only hook a caller with no render loop of its own has.
   */
  setStepsShown(shown: boolean): void
}

/**
 * One leg's `ControlState` — what a step control shows for it.
 *
 * **ONE FUNCTION BECAUSE THERE ARE TWO STEP CONTROLS** (Plan 7 part 2 spec §8): a view's own, and the one
 * bar. The bar drives a leg it reaches through the layout rather than through a slot it owns, so it cannot
 * go through `PaneSlot.render` — and a second copy of this argument list is the two-places-to-be-wrong
 * failure `LegState`'s own doc refuses.
 *
 * **THE `awaitingRun` READ IS PER SESSION AND NOT PER LEG** — the generation is the client's, and every leg
 * of one session shares it. That is exactly the subtlety a hand-copied second version would lose, and it is
 * why this is one function rather than two copies.
 */
export function legControlState<K extends Leg>(
  reg: SessionRegistry,
  binding: Binding<K>,
  leg: LegState<LegFrame[K]>,
): ControlState {
  return controlState({
    available: leg.status.available,
    reason: leg.status.reason,
    head: leg.hist.head,
    length: leg.hist.length,
    oldestStep: leg.hist.oldestStep,
    currentStep: leg.hist.currentStep,
    newestStep: leg.hist.newestStep,
    evicted: leg.hist.evicted,
    done: leg.done,
    awaitingRun: reg.entryOf(binding.session).client.awaitingRun,
    playing: leg.playing,
    pending: leg.pending ?? leg.clifHold?.linkStep ?? null,
    rewinding: legRewinding(leg),
  })
}

/**
 * One pane slot: which `(session, leg)` pair it shows, and the resolution every render goes through.
 *
 * THE SLOT VARIES THE SESSION AND NOT THE LEG, WHICH IS HOW `Binding<K>`'S TYPE PROPERTY SURVIVES
 * HAVING A SELECTOR AT ALL:
 *
 *   * `rebind` takes a `SessionId` AND NOTHING ELSE. `K` is fixed at construction and there is no
 *     writer for the `leg` field anywhere in the app — `Binding`'s fields are `readonly`.
 *   * So `legOf(slot.binding)` returns `LegState<LegFrame[K]>` exactly, and aliasing two legs
 *     cannot be written without `as unknown as LegState<TmState>`. The cast a mutation needs is
 *     the evidence the types hold.
 *
 * A SELECTOR THAT COULD WRITE `leg` WOULD DESTROY IT, and cheaply: `Binding<K>` would collapse
 * to `Binding<Leg>`, `legOf` would return `LegState<LambdaState | RxmState | TmState>`, and every
 * render would narrow a union that the pane's own renderer type had already decided. That is the
 * duplication 5d-i design §3.1 refused one layer down, arriving from the other direction.
 *
 * WHAT IS GIVEN UP, SAID PLAINLY RATHER THAN LEFT TO BE NOTICED: a slot cannot be pointed at ANOTHER
 * leg. The λ pane cannot be made to show a TM leg, because a `LambdaPane` renders `LambdaState` and
 * there is no second renderer in the slot to swap to.
 *
 * **THE SELECTOR OFFERS EVERY LEG WHILE THIS CLASS VARIES ONLY THE SESSION, AND THE GAP IS
 * DELIBERATE RATHER THAN AN OVERSIGHT.** `render` below pushes `reg.pairs()` — every `(leg, session)`
 * pair, not `options(b.leg)` — and `PaneEvents.rebind` carries the whole pair a user picked.
 *
 * **A PICK NAMING ANOTHER LEG IS ACTED ON BY REPLACING THE PANE, NOT BY MOVING THIS SLOT.**
 * `pane-host.ts`'s `paneEvents.rebind` compares the picked leg against the slot's, delegates a
 * same-leg pick to `transport.ts` (whose own comparison is a THROW, so this class's `rebind` is only
 * ever handed a session bindable at this leg, and by a check rather than by an argument), and answers a
 * cross-leg pick by changing the LEAF's kind — `setLeafKind`, keeping its place and size — and letting
 * `applyLayout` build a fresh entry: a different `PaneSlot`, on the picked leg, a different pane class
 * and the same host. A leg change is a new slot rather than a mutated one, so `K` never has to
 * change: the pane and the slot are replaced together, and `Binding<K>`'s type property is what makes
 * that replacement checked rather than something it stands in the way of.
 */
export class PaneSlot<K extends Leg> {
  #binding: Binding<K>

  constructor(leg: K, session: SessionId) {
    this.#binding = { session, leg }
  }

  /** What this slot shows. A value, not a view: `rebind` REPLACES it rather than editing it. */
  get binding(): Binding<K> {
    return this.#binding
  }

  /**
   * Point this slot at a different session, keeping its leg.
   *
   * PLAYBACK STAYS WITH THE LEG IT STARTED ON, and this method is deliberately not where that is
   * decided — it is decided by `play` setting its flag on the `LegState` rather than on the slot. The
   * reason to keep it there: a play head is a property of a HISTORY, and a pane looking away is not the
   * user un-pressing play. Two slots may be bound to one leg, so the alternative — stopping playback on
   * rebind — would let one pane's selector silently stop the other pane's playback. The player clears
   * the leg's flag when it reaches the frontier (`player.ts`'s `createPlayer`), so an unwatched run is
   * bounded rather than forever.
   */
  rebind(session: SessionId): void {
    this.#binding = { session, leg: this.#binding.leg }
  }

  /**
   * The leg this slot currently shows.
   *
   * SEPARATE FROM `render` BECAUSE THE TM SLOT HAS TO LOOK AT ITS FRAME BEFORE IT PAINTS. `draw()`
   * computes the δ-table's running focus from its frame's `source_node` and must hand it over
   * with `TmPane.setFocus` BEFORE `render`, or the render pass builds every row against the previous
   * frame's focus and a second pass immediately rebuilds them (see `draw()`'s own note).
   */
  resolve(reg: SessionRegistry): LegState<LegFrame[K]> {
    return reg.legOf(this.#binding)
  }

  /**
   * Paint the pane from `leg`, and refresh the selector, which follows the binding.
   *
   * `leg` IS A PARAMETER AND IT IS `resolve`'s OWN OUTPUT — see `resolve` for why the two are split.
   * Passing the wrong session's leg is possible and passing the wrong LEG KIND is not, which is
   * `Binding<K>`'s property doing the only work it can do here.
   *
   * THE SELECTOR IS REFRESHED HERE, NOT AT REBIND TIME. It is a function of the binding and of the registry, and
   * the registry changes under a slot that did not move — a session added elsewhere changes what this pane may be
   * pointed at. Driving it from the one per-frame call means there is no second path that could leave a selector
   * listing a session that no longer exists; the setter is a no-op when nothing changed, the guard `viewHeader`'s
   * `setBindings` states for the same path.
   */
  render(reg: SessionRegistry, pane: PaneView<LegFrame[K]>, leg: LegState<LegFrame[K]>): void {
    const b = this.#binding
    pane.render(leg.hist.current ?? null, legControlState(reg, b, leg), leg.hist.previous ?? null)
    pane.setBindings(reg.pairs(), b)
  }
}
