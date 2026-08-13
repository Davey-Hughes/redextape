import { type ControlState, controlState } from './controls'
import type { History } from './history'
// A TYPE-ONLY IMPORT, AND THE ONE DIRECTION THAT WOULD OTHERWISE BE A CYCLE — `pane-chrome.ts` already
// imports `Binding`/`PaneOption` from here. `import type` is erased entirely at build time, so this
// names a shape rather than creating a load-order relationship between the two modules; `SplitChoices`
// is declared beside the control that reads it because it is that control's input, not the registry's
// output — this module does not supply all of it, and a count of what it does would go stale on sight.
import type { SplitChoices } from './pane-chrome'
import type { Leg, RecordEnd } from './protocol'
import type { SessionClient, SessionId } from './session-client'
import type { LambdaState, LambdaStatus, TmProgram, TmState, TmStatus } from './types'

/**
 * One leg's live state on this side of the boundary: its history, how recording ended, and what the
 * worker said about it at compile time.
 *
 * STILL NO SESSION IDENTITY IN IT, AND DELIBERATELY SO. Design §3.2b names that absence as the reason
 * decision 1 had nothing to attach to — but the fix is `SessionEntry` below OWNING a leg, not a leg
 * naming its owner. A back-pointer would write the pairing down in two places and give it two places
 * to be wrong, and nothing reaches a leg without going through its session to get there:
 * `SessionRegistry.legOf` is the only way in.
 */
export type LegState<T> = {
  hist: History<T>
  status: { available: boolean; reason: string }
  done: RecordEnd | null
  timer: ReturnType<typeof setInterval> | null
}

/**
 * The frame type each leg records, keyed by the same `Leg` the protocol already speaks.
 *
 * THIS TABLE IS WHAT MAKES ONE GENERIC RESOLVER POSSIBLE. `legOf` returns `LegState<LegFrame[K]>`, so
 * a `Binding<'lambda'>` resolves to `LegState<LambdaState>` and a `Binding<'tm'>` to
 * `LegState<TmState>` with no narrowing at either call site — the property `Binding`'s own doc below
 * is about. Two named resolvers would be the duplication design §3.1 refused one layer down.
 */
export type LegFrame = { lambda: LambdaState; tm: TmState }

/**
 * The legs one session owns — AT MOST ONE PER `Leg`, AND THAT OPTIONALITY IS THIS TASK'S DOING.
 *
 * T4 left this record with both legs REQUIRED and said why: "the only session that exists is the
 * source session and it has both. §4.1's scratch types have one leg apiece; the task that lands them
 * is the one that has to say so here." This is that task. A pane can now be pointed at a session
 * other than the source one, and the whole content of "the source session offers source/λ/TM; a
 * `LambdaScratch` offers only λ; a `TmScratch` only TM" (plan T7, design §2 decision 1) is which keys
 * an entry's `legs` record actually has.
 *
 * OPTIONAL RATHER THAN A UNION OF THREE NAMED SHAPES (`{lambda,tm} | {lambda} | {tm}`). A union would
 * make `legOf` switch on a session KIND that nothing else in this file needs, and the switch would
 * have to be re-derived at every call site that only wants one leg. The optional record answers the
 * one question anybody asks — "does this session have leg K" — as a key lookup, which is also exactly
 * what `options` below enumerates for the selector.
 *
 * UNDER `exactOptionalPropertyTypes` ABSENCE IS REAL ABSENCE: `{ lambda: undefined }` does not
 * typecheck, so "has no λ leg" cannot be spelled two ways.
 *
 * A MAPPED TYPE OVER `Leg` RATHER THAN TWO LITERAL OPTIONAL PROPERTIES, AND THE CHOICE HAS A
 * CONSEQUENCE ONE CALLER FEELS. `{ [L in Leg]?: … }[K]` is INSTANTIATED by the checker, so `legOf` can
 * declare and return `LegState<LegFrame[K]>` — a concrete `LegState<…>` a caller can infer against.
 * Two literal properties would leave `SessionLegs[K]` a DEFERRED indexed access instead: assignable to
 * `SessionLegs[Leg]`, which is what T4's `AnyLeg` wanted, but not to `LegState<LegFrame[K]>`, which is
 * what a renderer parameterised by its frame type needs. Both cannot be had — `History<T>`'s methods
 * make `LegState` invariant in `T`, so the two forms are genuinely different types and not two
 * spellings. This form is chosen because `PaneView<LegFrame[K]>` is on the render path and `AnyLeg`
 * had exactly one consumer; `main.ts`'s `play` carries the other half of this note.
 */
export type SessionLegs = { [L in Leg]?: LegState<LegFrame[L]> }

/**
 * The machine a session's last `compiled` reply carried, in the form a TM pane is handed one.
 *
 * **THE TWO FIELDS ARE `TmPane.setProgram`'s TWO ARGUMENTS, AND THEY ARE ONE VALUE BECAUSE THEY ARE ONLY
 * MEANINGFUL TOGETHER.** `TmProgram` says `tapes: 5` and nothing about what any of them is called;
 * `tapeNames` is what `tapeRows` labels them with. Two nullable fields side by side on the entry would
 * make "a program with no names" and "names with no program" representable states that no producer can
 * produce and no consumer could render — one nullable envelope has exactly the two states the wire has.
 *
 * `tapeNames` RATHER THAN `setProgram`'s OWN PARAMETER NAME (`names`), because on the entry the pair is
 * read a long way from that method: `protocol.ts` spells it `tapeNames`, and so does the reply this is
 * retained from.
 */
export type TmCompiled = { readonly program: TmProgram; readonly tapeNames: string[] }

/**
 * One session: what it is called, whether it is inside the source correspondence, the legs it records
 * into, the machine its last compile produced, and the client that talks to its worker.
 *
 * THE CLIENT IS PER ENTRY BECAUSE THE GENERATION ALREADY IS. `SessionClient`'s `#gen`
 * (`session-client.ts:15`) is private and per instance, and design §3.2 records that this was always
 * right — generations are per session, and there was only ever one session to be per.
 *
 * THE ENTRY HOLDS THE CLIENT; `SessionPool` OWNS ITS WORKER'S LIFE. There is exactly one
 * `SessionClient` per session and both names refer to it — `client` here is the reference `pool.bind`
 * returned, not a second object. The split is which questions each container answers: this one is
 * asked "what does the λ pane's session record into", the pool is asked "may this session's thread
 * exist".
 */
export type SessionEntry = {
  readonly id: SessionId
  /**
   * What the binding selector calls this session, in words.
   *
   * A FIELD RATHER THAN A FUNCTION OF `id`, because the id is a map key and the label is UI text, and
   * a `Record<SessionId, string>` beside the registry would be a second place for the pairing to be
   * wrong — the failure `LegState`'s doc refuses one type up. It also keeps `sessions.ts` free of the
   * app's session names, which is the part of this sentence that is load-bearing. The part that was
   * not: it used to end "`main.ts` names its own sessions, here and nowhere else", true while every
   * session in the app was written down before it existed. A λ scratch buffer's name is minted with
   * its id, per fork, by `ScratchBuffers.fork` — so a name is decided where its session is CREATED,
   * which is `main.ts` for the source session and `scratch.ts` for a buffer, and is never decided
   * here.
   */
  readonly label: string
  /**
   * Whether this session is OUTSIDE the source correspondence — design §4.5's "detached".
   *
   * A PROPERTY OF THE SESSION, NOT OF THE PANE, which is why it lives here and not on `PaneSlot`. §3.3
   * is the reason it is knowable at all: `linkIndex` and `sourceSpan` exist on neither scratch type
   * and §3.1 makes `source_node` `null` for every state a `TmScratch` renders, so "can this session
   * participate in the sync anchor" is decided when the session is created and never changes. A pane
   * is detached exactly when the session it is bound to is — which is what makes both §4.5 surfaces
   * (the `[detached]` badge and `link-status.ts`'s sentence) one lookup rather than a second flag to
   * keep in step.
   *
   * NOT DERIVED FROM `id !== 'source'`. That comparison would put the app's naming convention inside
   * the registry, and a registry that decides detachment by string-matching an id is one rename away
   * from calling the source session detached.
   */
  readonly detached: boolean
  readonly client: SessionClient
  readonly legs: SessionLegs
  /**
   * The machine this session's TM panes were last told about, or `null` for a session that has not
   * compiled one — which every session is at construction, and which a `LambdaScratch` stays forever.
   *
   * **IT EXISTS BECAUSE A TM PANE CAN BE CREATED AT ANY TIME AND A `compiled` REPLY ARRIVES ONCE.**
   * `TmPane.setProgram` is called from the reply switch and from nowhere else, so a pane built after
   * that reply had no route to a program at all: it rendered no tapes, no status line and no δ-rows until
   * something recompiled. `pane-host.ts`'s creation pass seeds a new pane from this field, which covers
   * a split, a cross-leg pick and a layout restore alike, because all three create panes there.
   *
   * **THE ONE WRITABLE FIELD ON THIS TYPE, AND THE ONE THAT IS NOT KNOWN AT CONSTRUCTION.** `id`,
   * `label`, `detached` and `client` are decided by whoever registers the session; `legs` is a record
   * whose CONTENTS move (that is what `resetLegs` is) under a reference that does not. This is neither:
   * it is a fact the worker sends back later, replaced whole each time it does. Retaining it here rather
   * than beside the TM `LegState` is deliberate — `LegState<T>` is the frame-generic both legs share, and
   * a machine is not a frame; it is set once per compile and does not change as the head moves, which is
   * the whole point of the `TmProgram`/`TmState` split one layer in.
   *
   * **IT IS WRITTEN WHEREVER THE PANES ARE PUSHED TO, WHICH IS WHY IT CANNOT GO STALE.** `replies.ts`
   * stores and fans out in one call, so every arm that clears the panes (`no-session`, `worker-error`)
   * or replaces their program (`compiled`) leaves this holding exactly what a pane on screen is showing.
   * A retention that only ever grew would seed a pane created during an outage with a machine no other
   * pane is displaying.
   */
  tmProgram: TmCompiled | null
}

/**
 * A pane's binding — the `(session, leg)` pair decision 1 (design §2) makes the unit a pane renders.
 *
 * PARAMETERISED BY THE LEG, so a pane slot carries its leg in the TYPE and not only in the value. A
 * `Binding<'lambda'>` resolves to a `LegState<LambdaState>`, so a λ pane cannot be handed TM frames by
 * a binding that merely happens to say `'tm'` at runtime.
 *
 * THAT PROPERTY IS WHAT THE SELECTOR HAD TO NOT DESTROY, and `PaneSlot` below is where it is
 * re-derived — read its doc before widening anything here. Executing T4 (commit `18976ed`) recorded
 * the property in the form that matters: aliasing two legs cannot be WRITTEN without
 * `as unknown as LegState<TmState>`, so the cast a mutation needs is itself the evidence the types
 * hold. `readonly` on both fields is the other half — a binding is replaced, never edited in place, so
 * there is no field write that could put a `'tm'` in a `Binding<'lambda'>`.
 */
export type Binding<K extends Leg> = { readonly session: SessionId; readonly leg: K }

/** One entry in a pane's binding selector: the session it names, and what to call it on screen. */
export type BindingOption = { readonly id: SessionId; readonly label: string }

/**
 * The two legs, in the order a selector lists them.
 *
 * A VALUE RATHER THAN A KEY WALK OVER SOME ENTRY'S `legs`, because the order must not depend on which
 * legs the first session in the registry happens to have.
 */
const LEGS = ['lambda', 'tm'] as const satisfies readonly Leg[]

/** One `(leg, session)` pair a pane may be pointed at, with the label the selector shows. */
export type PaneOption = { readonly leg: Leg; readonly id: SessionId; readonly label: string }

/**
 * Clear every leg this session has, and set each one's compile-time status.
 *
 * `reason` is what a leg's control strip reads (`controls.ts`'s `controlState` returns it straight as
 * `stepText` while `!available`) when there is no per-leg `LambdaStatus`/`TmStatus` to read one from —
 * i.e. when neither leg compiled at all. Design §6's error table says the panes "read 'not compiled'"
 * for that case; leaving it as `''` left them reading nothing.
 *
 * TAKES THE LEGS IT RESETS RATHER THAN A SESSION ID, and `SessionLegs` rather than the whole
 * `SessionEntry`, because a reset is exactly a statement about legs — it never touches the client. One
 * session's compile must not clear another session's histories, and the smallest parameter that makes
 * that impossible is this one.
 *
 * A STATUS FOR A LEG THE SESSION DOES NOT HAVE IS DROPPED, NOT FABRICATED. A `LambdaScratch` has no TM
 * leg to be "not compiled", and writing one so the record is square is the shape `session.rs:257-273`
 * records the cost of. The caller passing a `TmStatus` for a λ-only session is not an error either —
 * it is what a caller with one reply shape and three session shapes will naturally do — so this is
 * silent rather than a throw.
 */
export function resetLegs(legs: SessionLegs, lambda: LambdaStatus | null, tm: TmStatus | null, reason = ''): void {
  const lambdaLeg = legs.lambda
  const tmLeg = legs.tm
  for (const leg of [lambdaLeg, tmLeg]) {
    if (leg === undefined) continue
    leg.hist.clear()
    leg.done = null
    if (leg.timer !== null) clearInterval(leg.timer)
    leg.timer = null
  }
  if (lambdaLeg !== undefined)
    lambdaLeg.status = { available: lambda?.available ?? false, reason: lambda?.reason ?? reason }
  if (tmLeg !== undefined) tmLeg.status = { available: tm?.available ?? false, reason: tm?.reason ?? reason }
}

/**
 * THE SESSION REGISTRY — the container design §3.2b says decision 1 presupposes and `main.ts` did not
 * have.
 *
 * Before T4, `lam` and `tm` were two `const`s in `main()`'s body and `draw()` closed over them
 * directly, so "a pane binds to a `(session, leg)` pair" had nothing to attach to: there was no
 * session to name, and a leg was reachable only by being lexically in scope.
 *
 * IT MOVED OUT OF `main.ts` IN THIS TASK, AND THE REASON IS THE TEST RATHER THAN TIDINESS. T7's whole
 * claim is that two panes can be bound to two DIFFERENT λ sessions and show two different terms at the
 * same time, and the plan says outright that "anything weaker passes on a single-session
 * implementation". Nothing in this slice can put a second session in `main()`'s registry — a
 * `LambdaScratch` needs a worker message `session-worker.ts` does not have, and creating one on edit
 * is §4.3, which is T8 — so a test driven through the app could only ever see one session. A registry
 * that is a module is a registry a test can put two sessions in, and `PaneSlot` below is what makes
 * that test drive the SAME resolution the app's `draw()` does rather than a re-implementation of it.
 *
 * **T8 BUILT THAT MESSAGE, SO THE SENTENCE ABOVE IS NOW HISTORY AND THE ARGUMENT IS NOT.** `scratch.ts`
 * registers a second entry from a click, and `protocol.ts`'s `lambda-scratch` is the worker message
 * this paragraph says did not exist.
 *
 * **AND 5d-ii-a'S LAYOUT TREE RETIRED THE OTHER HALF: "the app has ONE λ pane, so two panes on two λ
 * sessions is still unperformable through it" IS NO LONGER TRUE.** A λ leaf splits, the new pane
 * inherits its session, and 5d-i's binding selector points it somewhere else — the whole route is
 * driven through the DOM by `tests/browser/two-lambda-panes.test.ts`, which is the test this paragraph
 * spent two revisions explaining could not exist. (Design §3.4 of that slice quotes these very lines as
 * the thing it fixes.) **WHAT DID NOT CHANGE IS THE REST OF THE ARGUMENT, AND IT IS WHY THE CONTAINER
 * STILL LIVES HERE**: how many sessions a fork produces must be asserted on POOL SIZE, which no DOM
 * carries, so a test driven entirely through the app still cannot make that assertion however many
 * panes it can now reach. 5d-i required that axis for the singleton it was claiming; 5d-ii-c decision
 * 1 changed the expected number on it — a fork now adds a session per call — and left the reason the
 * axis is the only honest one untouched, because two panes on two buffers showing the same term look
 * exactly like two panes on one.
 *
 * TWO MAPS KEYED BY `SessionId` — THIS ONE AND `SessionPool`'s — AND THEY ARE NOT THE SAME FACT
 * WRITTEN TWICE. `SessionPool`'s own doc states the split from its side: the pool says what a session
 * RUNS ON and is the only thing allowed to change it; this says what a session HAS.
 */
export class SessionRegistry {
  /**
   * A `Map` RATHER THAN A FIELD PER SESSION, because the key is what the pool already holds (§3.2:
   * `Map<SessionId, SessionClient>`) and because a registry with the sessions spelled out as named
   * fields would have to be rewritten rather than extended the moment a scratch exists.
   *
   * INSERTION ORDER IS THE SELECTOR'S ORDER, which is why nothing here sorts. `Map` iterates in
   * insertion order, `main.ts` registers the source session first, and a scratch is created later by
   * definition (§4.3: detaching forks an existing session), so "source, then the scratchpads in the
   * order they were made" falls out without a comparator that would have to invent a rank for a name.
   */
  #entries = new Map<SessionId, SessionEntry>()

  /** How many sessions the registry holds. */
  get size(): number {
    return this.#entries.size
  }

  /** Is `id` registered? The question `add`'s throw makes a caller ask. */
  has(id: SessionId): boolean {
    return this.#entries.has(id)
  }

  /**
   * Register a session.
   *
   * THROWS ON AN ID ALREADY HELD, mirroring `SessionPool.bind` and for a related reason: an entry owns
   * histories and a play timer, so replacing one silently would strand a running `setInterval` on a
   * `LegState` nothing can reach any more.
   *
   * **THE CALL SITE THIS THROW USED TO NAME AS ITS REASON IS GONE, AND THE THROW IS NOT.** The
   * sentence here read: *"§4.3's singleton rebinding ('a second edit rebinds to the EXISTING scratch')
   * is served by asking `has` first, which is one branch at the call site against a leak here that
   * nothing would report."* 5d-ii-c decision 1 deleted that branch — `ScratchBuffers.fork` mints a
   * name no entry can already hold, so nothing asks `has` on this method's behalf and no path in the
   * app reaches this line any more. It stays because the leak is a property of THIS method: whatever
   * asked, replacing an entry silently would strand its timer, and a container that answered a
   * duplicate id by overwriting would make that unreportable rather than impossible.
   */
  add(entry: SessionEntry): void {
    if (this.#entries.has(entry.id)) throw new Error(`session is already in the registry: ${entry.id}`)
    this.#entries.set(entry.id, entry)
  }

  /**
   * Forget `id`. A no-op for a session the registry does not hold.
   *
   * IDEMPOTENT WHERE `add` THROWS, the same asymmetry `SessionPool.unbind` documents: a second `add`
   * asks for something that cannot be honoured, a second `remove` asks for a state already true.
   *
   * IT DOES NOT TERMINATE A WORKER AND MUST NOT — that is `SessionPool.unbind`, and §4.2 puts the
   * thread's life in exactly one place. A caller retiring a session calls both; splitting them is what
   * keeps this module free of `new Worker`.
   */
  remove(id: SessionId): void {
    this.#entries.delete(id)
  }

  /**
   * The registry entry for `id`.
   *
   * THROWS RATHER THAN RETURNING `undefined`, the same call the mount-point check at the top of
   * `main()` makes. A binding naming a session the registry does not hold is a wiring bug, not a state
   * the UI has an honest rendering for — and the alternative, an `?? emptyLeg` fallback at every call
   * site, is a fabricated answer for an unreachable state, which is the exact shape
   * `session.rs:257-273` records the cost of.
   */
  entryOf(id: SessionId): SessionEntry {
    const entry = this.#entries.get(id)
    if (entry === undefined) throw new Error(`bound to a session that is not in the registry: ${id}`)
    return entry
  }

  /**
   * The `LegState` a binding names. THE ONLY WAY INTO A LEG — see `LegState`'s own doc.
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
   * **WHICH BINDINGS CAN REACH THIS, AND WHY THAT SENTENCE HAD TO BE REWRITTEN.** It read: "`options`
   * below is what a selector offers, and it offers only sessions that HAVE the leg, so a binding that
   * names a missing one did not come from the selector." The selector offers `pairs()` now, for BOTH
   * legs, to EVERY pane — so it is precisely a source of pairs a given slot cannot resolve, and that
   * sentence went from an argument to a false reassurance in the commit that widened the control. It
   * cost a Critical: `transport.ts`'s handler took the session half of a cross-leg pick and kept the
   * slot's leg, minting exactly the binding this line throws on.
   *
   * **THE INVARIANT IS ENFORCED AT THE ONE PLACE A BINDING IS CONSTRUCTED FROM A PICK, AND THAT PLACE
   * MOVED ONCE.** Every pair `pairs()` emits resolves for the leg it names — that is its own doc's
   * claim, and it holds — so what has to be true is that a slot only ever rebinds to a session offering
   * the slot's OWN leg. `transport.ts`'s `rebind` used to be where that was decided, by refusing a
   * cross-leg pick outright. It is `pane-host.ts`'s `paneEvents.rebind` now, and that one does not
   * refuse: a same-leg pick is delegated to `transport.ts` (which reaches `PaneSlot.rebind` with a
   * session bindable at this slot's leg, exactly as before), and a cross-leg pick never reaches a
   * `rebind` at all — the leaf changes kind and `applyLayout` builds a new entry, whose `PaneSlot` is
   * constructed on the picked leg. Either way no slot is ever pointed at a session lacking its leg.
   * `transport.ts`'s own comparison survives as a THROW rather than as the decision: it asserts that a
   * cross-leg pick never arrives there, so a caller wiring a pane straight to those handlers is told
   * at the mistake instead of minting the binding this line dies on.
   * `tests/browser/pane-kind-switch.test.ts` drives the three clicks that produced the Critical and
   * asserts the pane both follows the pick and keeps painting afterwards, which is this line not
   * throwing.
   */
  legOf<K extends Leg>(b: Binding<K>): LegState<LegFrame[K]> {
    const leg = this.entryOf(b.session).legs[b.leg]
    if (leg === undefined) throw new Error(`session ${b.session} has no ${b.leg} leg`)
    return leg
  }

  /**
   * Every session a slot showing `leg` may be pointed at, in registration order.
   *
   * THIS IS "THE SOURCE SESSION OFFERS source/λ/TM; A `LambdaScratch` OFFERS ONLY λ" (plan T7),
   * evaluated from the session's side: a session appears in `options('lambda')` exactly when it has a
   * λ leg to render. There is no second table of which kind offers what — the legs an entry was built
   * with ARE the answer, so the selector and the resolver cannot disagree about what is bindable.
   *
   * A FRESH ARRAY PER CALL. Accepted rather than cached: it is one array of at most three small
   * objects, and a cache would need invalidating on `add`/`remove`, which is a second fact to keep in
   * step for a saving nobody measured.
   *
   * **IT IS NO LONGER ON THE PER-FRAME PATH, WHICH THIS DOC USED TO SAY IT WAS.** `PaneSlot.render`
   * pushes `pairs()` below now, so `draw()` never reaches here; that method's own doc carries the
   * allocation argument for the call that IS on the path. This one is a registry query with no
   * production caller left — it survives because it is `pairs()`'s per-leg half stated directly, and
   * because `tests/node/sessions.test.ts` and `tests/node/scratch.test.ts` ask a registry what one leg
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
   * Every `(leg, session)` pair a pane may be pointed at — `options` for both legs, tagged.
   *
   * IT IS BUILT FROM `options`' OWN SOURCE OF TRUTH AND NOT FROM A SECOND TABLE. `options`' doc states
   * the property this inherits: "the legs an entry was built with ARE the answer, so the selector and
   * the resolver cannot disagree about what is bindable." Widening the selector from one axis to two is
   * exactly the change that would have made a second table tempting, and a second table is how a
   * selector comes to offer a pair `legOf` throws on.
   *
   * GROUPED BY LEG RATHER THAN BY SESSION, because that is how the control renders it — one `<optgroup>`
   * per leg. Registration order holds within each group, for `options`' reason: it falls out without a
   * comparator that would have to invent a rank.
   *
   * A FRESH ARRAY PER CALL, AND THIS IS THE ONE ON THE PER-FRAME PATH — `PaneSlot.render` calls it for
   * every pane on every recorded frame during playback. Accepted rather than cached, which is the
   * argument `options` above used to carry: it is one array of a handful of small objects against a
   * `controlState` call that formats step counts into strings on the same tick, and
   * `pane-chrome.ts`'s `paneSelect.update` compares its rendered key before it touches the DOM, so
   * nothing downstream pays for the allocation.
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
 * A STRUCTURAL TYPE RATHER THAN `LambdaPane | TmPane`, for the reason `ClientPort` exists one module
 * over: everything the slot does is resolve a binding and call three setters, and none of it needs a
 * DOM. `tests/node/sessions.test.ts` drives two slots over one registry with recording fakes, which is
 * where "two panes, two λ sessions, two different frames" is asserted without a browser; the browser
 * tier then asserts the same thing reaches real text on a real `LambdaPane`.
 *
 * `LambdaPane` SATISFIES `PaneView<LambdaState>` AND `TmPane` SATISFIES `PaneView<TmState>`, with no
 * `implements` clause on either — the parameterisation is what makes handing the wrong pane to a slot
 * a type error rather than a runtime surprise.
 */
export type PaneView<T> = {
  render(frame: T | null, controls: ControlState): void
  /**
   * `PaneOption[]` AND A WHOLE `Binding<Leg>`, NOT `BindingOption[]` AND A `SessionId`. The pane's
   * selector offers `(leg, session)` PAIRS (`pairs()` above, `pane-chrome.ts`'s `paneSelect`), so both
   * halves of what it displays have to cross this boundary: the list of pairs, and which pair is in
   * force. `Binding<Leg>` and not `Binding<K>` — a `PaneView<T>` is parameterised by its FRAME type,
   * which is what pins its renderer, and the pair on offer is deliberately not restricted to the leg
   * the pane happens to render.
   */
  setBindings(options: PaneOption[], current: Binding<Leg>): void
  setDetached(detached: boolean): void
  /**
   * **`choices` RIDES THE CALL THAT MOUNTS THE CONTROL, WHICH IS WHY IT IS HERE AND NOT ON A SETTER OF
   * ITS OWN.** The split control is a picker now (`pane-chrome.ts`'s `splitControl`), and its menu is
   * built on open from a list only the app can produce — the registry's pairs, the pane's own binding,
   * and whether the layout tree is currently without a source leaf. Two routes reached the pane from
   * `draw()`'s per-frame loop: widen this call, or add a sibling setter beside it. This one is the
   * narrower claim: `canSplit` is what puts the button in the DOM at all, so a caller that can offer the
   * gesture has, in the same statement, said what the gesture may create. A sibling setter would make
   * that two calls with an ordering between them — a button mountable while the list behind it was still
   * whatever the previous frame left, which is the class of staleness this file already refuses for
   * `setBindings` by driving it from the one per-frame pass.
   *
   * THE VALUE IS READ ON OPEN, NOT ON ARRIVAL. Both panes store it in a field and hand `layoutControls` a
   * thunk over that field, so this call costs a field write on every recorded frame during playback and
   * the menu that reads it is built at most once per user gesture — `splitControl`'s own doc has the
   * argument for why the thunk exists rather than a list handed over at construction.
   */
  setLayoutControls(canClose: boolean, canSplit: boolean, choices: SplitChoices): void
}

/**
 * One pane slot: which `(session, leg)` pair it shows, and the resolution every render goes through.
 *
 * THE SLOT VARIES THE SESSION AND NOT THE LEG, WHICH IS HOW `Binding<K>`'S TYPE PROPERTY SURVIVES
 * HAVING A SELECTOR AT ALL. This is the constraint T4's correction carried forward to this task, so it
 * is stated in full rather than cited:
 *
 *   * `rebind` takes a `SessionId` AND NOTHING ELSE. `K` is fixed at construction and there is no
 *     writer for the `leg` field anywhere in the app — `Binding`'s fields are `readonly`, and this
 *     class is the only thing that constructs one.
 *   * So `legOf(slot.binding)` still returns `LegState<LegFrame[K]>` exactly, and aliasing two legs
 *     still cannot be written without `as unknown as LegState<TmState>`. The cast a mutation needs is
 *     still the evidence the types hold.
 *
 * A SELECTOR THAT COULD WRITE `leg` WOULD HAVE DESTROYED IT, and cheaply: `Binding<K>` would collapse
 * to `Binding<Leg>`, `legOf` would return `LegState<LambdaState> | LegState<TmState>`, and every
 * render would narrow a union that the pane's own renderer type had already decided. That is the
 * duplication design §3.1 refused one layer down, arriving from the other direction.
 *
 * WHAT IS GIVEN UP, SAID PLAINLY RATHER THAN LEFT TO BE NOTICED: a slot cannot be pointed at the OTHER
 * leg. The λ pane cannot be made to show a TM leg, because a `LambdaPane` renders `LambdaState` and
 * there is no second renderer in the slot to swap to. Plan T7's "the renderer follows the leg" is a
 * pane MULTIPLEXER — a slot that mounts a different pane class per leg — and design §1 puts the
 * multiplexer in 5d-ii. Both the test and the mutation plan T7 specifies exercise the SESSION axis
 * ("two panes bound to two different λ sessions"; "resolve every binding to the source session"), and
 * that is the axis this builds. **THIS PARAGRAPH USED TO END "Widening `K` to `Leg` here is where 5d-ii
 * starts", AND 5d-ii ANSWERED IT THE OTHER WAY**: the multiplexer landed and `K` is still fixed at
 * construction, because a leg change replaces the pane and its slot together rather than mutating
 * either. The last paragraph below has that in full. What is given up is unchanged and still worth
 * stating: a slot cannot be pointed at the other leg, and nothing above bends to let it.
 *
 * **THE SELECTOR NOW OFFERS BOTH LEGS WHILE THIS CLASS STILL VARIES ONLY THE SESSION, AND THE GAP IS
 * DELIBERATE RATHER THAN AN OVERSIGHT.** `render` below pushes `reg.pairs()` — every `(leg, session)`
 * pair, not `options(b.leg)` — and `PaneEvents.rebind` carries the whole pair a user picked. Nothing
 * above changed: `K` is still fixed at construction, `leg` still has no writer, and every claim in the
 * three paragraphs above still holds word for word.
 *
 * **A PICK NAMING THE OTHER LEG IS ACTED ON BY REPLACING THE PANE, NOT BY MOVING THIS SLOT — AND THIS
 * PARAGRAPH HAS NOW BEEN WRONG TWICE, IN OPPOSITE DIRECTIONS.** It first read "What a pick naming the
 * OTHER leg does today is nothing — `transport.ts`'s handler takes the session half and drops the leg,
 * and the next paint snaps the `<select>` back to the pair in force." Taking the session half was not
 * nothing: it MOVED the slot to a session that may not have this leg at all, and `legOf` throws on the
 * result — the Critical that handler's comment records in full. It then read that the same handler
 * REFUSES such a pick, which was true of the guard that closed the Critical and false the moment the
 * multiplexer landed. What is true now: `pane-host.ts`'s `paneEvents.rebind` compares the picked leg
 * against the slot's, delegates a same-leg pick to `transport.ts` (whose own comparison came back as a
 * THROW — deleted and reinstated one commit apart, not carried through; see its own note — so this
 * class's `rebind` is still only ever handed a session bindable at this leg, and now by
 * a check rather than by an argument), and answers a cross-leg pick by changing the
 * LEAF's kind — `setLeafKind`, keeping its place and size — and letting `applyLayout` build a fresh
 * entry: a different `PaneSlot`, on the picked leg, a different pane class, the same host, and any
 * editor handed to custody on the way out. **Nothing above changed.** `K` is still fixed at
 * construction, `leg` still has no writer, and a leg change is a new slot rather than a mutated one —
 * which is exactly why the multiplexer could be built without widening `K`: the pane and the slot are
 * replaced together, so `Binding<K>`'s type property is what makes that replacement checked rather
 * than something it stands in the way of.
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
   * decided — it is decided by `play` parking its timer on the `LegState` rather than on the slot,
   * which T4 flagged as the choice this task would have to make. The reason to keep it there: a play
   * head is a property of a HISTORY, and a pane looking away is not the user un-pressing play. Two
   * slots may now be bound to one leg, so the alternative — stopping the timer on rebind — would let
   * one pane's selector silently stop the other pane's playback. The leg clears its own timer when it
   * reaches the frontier (`main.ts`'s `play`), so an unwatched run is bounded rather than forever.
   */
  rebind(session: SessionId): void {
    this.#binding = { session, leg: this.#binding.leg }
  }

  /**
   * The leg this slot currently shows.
   *
   * SEPARATE FROM `render` BECAUSE THE TM SLOT HAS TO LOOK AT ITS FRAME BEFORE IT PAINTS. `draw()`
   * computes the δ-table's running focus from `tm.hist.current?.source_node` and must hand it over
   * with `TmPane.setFocus` BEFORE `render`, or the render pass builds every row against the previous
   * frame's focus and a second pass immediately rebuilds them (see `draw()`'s own note). A single
   * `render` that resolved internally would force that caller to resolve a second time, and the
   * comment in `draw()` promising one resolution per frame would stop being true.
   */
  resolve(reg: SessionRegistry): LegState<LegFrame[K]> {
    return reg.legOf(this.#binding)
  }

  /**
   * Paint the pane from `leg`, and refresh the two chrome facts that follow the binding.
   *
   * `leg` IS A PARAMETER AND IT IS `resolve`'s OWN OUTPUT — see `resolve` for why the two are split.
   * Passing the wrong session's leg is possible and passing the wrong LEG KIND is not, which is
   * `Binding<K>`'s property doing the only work it can do here.
   *
   * THE SELECTOR AND THE BADGE ARE REFRESHED HERE, NOT AT REBIND TIME. Both are functions of the
   * binding and of the registry, and the registry changes under a slot that did not move — a session
   * added or retired elsewhere changes what this pane may be pointed at. Driving them from the one
   * per-frame call means there is no second path that could leave a selector listing a session that no
   * longer exists; both setters are no-ops when nothing changed, which is the same guard
   * `LambdaPane.renderLink` and `detachedBadge` already state for the same path.
   */
  render(reg: SessionRegistry, pane: PaneView<LegFrame[K]>, leg: LegState<LegFrame[K]>): void {
    const b = this.#binding
    pane.render(
      leg.hist.current ?? null,
      controlState({
        available: leg.status.available,
        reason: leg.status.reason,
        head: leg.hist.head,
        length: leg.hist.length,
        oldestStep: leg.hist.oldestStep,
        currentStep: leg.hist.currentStep,
        newestStep: leg.hist.newestStep,
        evicted: leg.hist.evicted,
        done: leg.done,
      }),
    )
    pane.setBindings(reg.pairs(), b)
    pane.setDetached(reg.entryOf(b.session).detached)
  }
}
