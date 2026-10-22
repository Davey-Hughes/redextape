import { type ControlState, controlState } from './controls'
import type { History } from './history'
import { LEGS } from './legs'
// A TYPE-ONLY IMPORT, AND THE ONE DIRECTION THAT WOULD OTHERWISE BE A CYCLE — `pane-chrome.ts` already
// imports `Binding`/`PaneOption` from here. `import type` is erased entirely at build time, so this
// names a shape rather than creating a load-order relationship between the two modules; `SplitChoices`
// is declared beside the control that reads it because it is that control's input, not the registry's
// output — this module does not supply all of it, and a count of what it does would go stale on sight.
import type { SplitChoices } from './pane-chrome'
import type { Leg, RecordEnd } from './protocol'
import type { SessionClient, SessionId } from './session-client'
import type {
  AsmProgram,
  AsmState,
  AsmStatus,
  Decoded,
  LambdaState,
  TmProgram,
  TmScratchStatus,
  TmState,
  ValueReading,
} from './types'

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
   * The step a shared link's position is taking this leg to, while the frames have not reached it — Plan 7 part 6a
   * spec §5.4: set and spent, and dropped at a recompile, by `share-positions.ts`'s `LinkPositions`; read by the step
   * line; and taken away by a gesture on the leg's step controls. Absent on every leg no link is taking anywhere.
   */
  pending?: number
}

/**
 * The frame type each leg records, keyed by the same `Leg` the protocol already speaks.
 *
 * THIS TABLE IS WHAT MAKES ONE GENERIC RESOLVER POSSIBLE. `legOf` returns `LegState<LegFrame[K]>`, so
 * a `Binding<'lambda'>` resolves to `LegState<LambdaState>` and a `Binding<'tm'>` to
 * `LegState<TmState>` with no narrowing at either call site — the property `Binding`'s own doc below
 * is about. Two named resolvers would be the duplication 5d-i design §3.1 refused one layer down.
 */
export type LegFrame = { lambda: LambdaState; asm: AsmState; tm: TmState }

/**
 * The legs one session owns — AT MOST ONE PER `Leg`.
 *
 * The content of "the source session offers source/λ/TM; a `LambdaScratch` offers only λ; a
 * `TmScratch` only TM" (5d-i design §2's decision 1, in the words of 5d-i's plan, T7), with the program
 * session's asm leg and an asm copy that offers only asm, is which keys an entry's `legs` record has.
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
 * The machine a session's last `compiled` reply carried, in the form a TM pane is handed one.
 *
 * **`program` AND `tapeNames` ARE `TmPane.setProgram`'s TWO ARGUMENTS, AND THEY ARE ONE VALUE BECAUSE
 * THEY ARE ONLY MEANINGFUL TOGETHER.** `TmProgram` says `tapes: 5` and nothing about what any of them is
 * called; `tapeNames` is what `tapeRows` labels them with. Two nullable fields side by side on the entry
 * would make "a program with no names" and "names with no program" representable states that no producer
 * can produce and no consumer could render — one nullable envelope has exactly the two states the wire has.
 *
 * `tapeNames` RATHER THAN `setProgram`'s OWN PARAMETER NAME (`names`), because on the entry the pair is
 * read a long way from that method: `protocol.ts` spells it `tapeNames`, and so does the reply this is
 * retained from.
 *
 * **`tmText`, RIDING BESIDE THEM.** `TmPane.setForkAvailable`'s decision (5d-iv design §4.3) needs it the
 * moment a TM pane exists: a pane created after the reply must still be seeded, the argument
 * `SessionEntry.tmProgram`'s doc makes for `program` and `tapeNames` — see `replies.ts`'s `setTmProgram`,
 * which pushes them all together. **INDEPENDENT OF `program` BEING NON-NULL, WHICH IS WHY IT IS NOT A SECOND
 * NULLABLE ENVELOPE ON THE ENTRY.** A machine can exist and still have `tmText: null` — over `MAX_FORK_RULES`,
 * or for a function-valued program (`protocol.ts`'s `compiled` reply, `tmText`'s own doc) —  check-attributions: allow
 * so this field carries a fact `program`'s own nullability cannot stand in for.
 *
 * **`tmResultDecodable` RIDES BESIDE `tmText` FOR THE IDENTICAL REASON**, and is `TmPane.setForkAvailable`'s
 * own third argument: `tmText: null` alone cannot say which of those two causes it is, and
 * `CopyEditor.#refreshDetach` needs to know which one to word.
 */
export type TmCompiled = {
  readonly program: TmProgram
  readonly tapeNames: string[]
  readonly tmText: string | null
  readonly tmResultDecodable: boolean
}

/**
 * The asm listing a session compiled, and the text *edit a copy* seeds a copy from — `TmCompiled`'s shape for the asm
 * leg, and for its reason: the view that offers a copy needs both, and a view built after the reply is seeded from
 * here. `asmText` is `null` on a copy, which offers no copy of itself, and for a program whose text is longer than
 * `session.rs`'s `MAX_SCRATCH_ASM_BYTES`, which no copy could build.
 */
export type AsmCompiled = { readonly program: AsmProgram; readonly asmText: string | null }

/**
 * What an asm copy's views were last told about its run: the status and value its build reply carried, the value
 * replaced by any `asm-value` a `[continue]` brings. `null` on every session that is not an asm copy.
 */
export type AsmScratchReading = { readonly status: AsmStatus; readonly value: Decoded }

/**
 * What a TM buffer's panes were last told about the FILE rather than the machine: its status, and its value run's
 * latest reading, or `null` before the first `tm-value` reply and for a file with no header.
 */
export type TmScratchReading = {
  readonly status: TmScratchStatus
  readonly value: ValueReading | null
}

/**
 * One session: what it is called, whether it is inside the source correspondence, the legs it records
 * into, the machine its last compile produced, and the client that talks to its worker.
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
   * names: a name is decided where its session is CREATED, which is `main.ts` for the source session
   * and `scratch.ts` for a buffer, and is never decided here.
   */
  readonly label: string
  /**
   * Whether this session is OUTSIDE the source correspondence — 5d-i design §4.5's "detached".
   *
   * A PROPERTY OF THE SESSION, NOT OF THE PANE, which is why it lives here and not on `PaneSlot`. §3.3
   * is the reason it is knowable at all: `linkIndex` and `sourceSpan` exist on no scratch type
   * and §3.1 makes `source_node` `null` for every state a `TmScratch` renders, so "can this session
   * participate in the sync anchor" is decided when the session is created and never changes. A pane
   * is detached exactly when the session it is bound to is — which is what makes both §4.5 surfaces
   * (the `copy · not linked` status and `link-status.ts`'s sentence) one lookup rather than a second flag to
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
   * Without this field a pane built after that reply would have no route to a program at all: it would
   * render no tapes, no status line and no δ-rows until something recompiled. `pane-host.ts`'s
   * `seedTmPane` tells a pane from this field when it comes to show the session without a reply: at
   * creation, which covers a split, a cross-leg pick and a layout restore alike, and when a pick
   * through its selector, a cool or a retire moves it onto the session.
   *
   * **ONE OF THE WRITABLE FIELDS ON THIS TYPE, AND THE WRITABLE FIELDS ARE WHAT IS NOT KNOWN AT
   * CONSTRUCTION.** `id`, `label`, `detached` and `client` are decided by whoever registers the session;
   * `legs` is a record whose CONTENTS move (that is what `resetLegs` is) under a reference that does
   * not. The writable fields are neither: each is a fact the worker sends back later, replaced whole
   * each time it does. Retaining this one here rather than beside the TM `LegState` is deliberate —
   * `LegState<T>` is the frame-generic every leg shares, and a machine is not a frame; it is set once
   * per compile and does not change as the head moves, which is the whole point of the
   * `TmProgram`/`TmState` split one layer in.
   *
   * **IT IS WRITTEN WHEREVER THE PANES ARE PUSHED TO, WHICH IS WHY IT CANNOT GO STALE.** `replies.ts`
   * stores and fans out in one call, so every arm that clears the panes (`no-session`, `worker-error`)
   * or replaces their program (`compiled`, `tm-scratch-compiled`) leaves this holding exactly what a
   * pane on screen is showing. A retention that only ever grew would seed a pane created during an
   * outage with a machine no other pane is displaying.
   */
  tmProgram: TmCompiled | null
  /**
   * A TM buffer's status and value reading, retained for the reason `tmProgram` above is: a TM pane created after
   * the reply that told the others is seeded from here. `null` for every session that is not a TM buffer.
   */
  tmScratch: TmScratchReading | null
  /**
   * The asm listing a session's last `compiled` or `asm-scratch-compiled` reply carried, and the program's text,
   * retained for `tmProgram`'s reason: an asm view created after that reply is seeded from here (`pane-host.ts`'s
   * `seedAsmPane`). `null` for a session with no asm leg — a program that does not lower, and a λ or TM copy.
   */
  asmProgram: AsmCompiled | null
  /** An asm copy's status and value, retained for `tmScratch`'s reason. `null` for every other session. */
  asmScratch: AsmScratchReading | null
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
 * `reason` is what a leg's control strip reads (`controls.ts`'s `controlState` returns it straight as
 * `stepText` while `!available`) when there is no status for the leg to read one from — no
 * `LambdaStatus`, `AsmStatus`, `TmStatus` or TM copy's `TmScratchStatus` — i.e. when no leg compiled at
 * all. 5a design §6's error table says the panes "read 'not compiled'" for that case; an empty `reason`
 * would leave them reading nothing.
 *
 * TAKES THE LEGS IT RESETS RATHER THAN A SESSION ID, and `SessionLegs` rather than the whole
 * `SessionEntry`, because a reset is exactly a statement about legs — it never touches the client. One
 * session's compile must not clear another session's histories, and the smallest parameter that makes
 * that impossible is this one.
 *
 * A STATUS FOR A LEG THE SESSION DOES NOT HAVE IS DROPPED, NOT FABRICATED. A `LambdaScratch` has no TM
 * leg to be "not compiled", and writing one so the record is square is the shape `session.rs`'s
 * `Session::tm` records the cost of. The caller passing a `TmStatus` for a λ-only session is not an error either —
 * it is what a caller with one reply shape and four session shapes will naturally do — so this is
 * silent rather than a throw.
 *
 * **ONE STATUS PER LEG, BY LEG, AND EACH ONLY ITS TWO FIELDS.** The body reads `available` and `reason` and nothing
 * else, so each caller passes whatever status its reply carries — a `LambdaStatus`, an `AsmStatus`, a `TmStatus`, or a
 * TM copy's `TmScratchStatus`, which shares those two fields with `TmStatus` and none of the others — without
 * fabricating fields this function never asks for. Keyed by `Leg`, a leg the caller has no status for is simply
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
    leg.playing = false
    const status = statuses[l]
    leg.status = { available: status?.available ?? false, reason: status?.reason ?? reason }
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
 * How many sessions a fork produces must be asserted on POOL SIZE, which no DOM carries, so a test
 * driven entirely through the app cannot make that assertion however many panes it can reach: two
 * panes on two buffers showing the same term look exactly like two panes on one.
 *
 * TWO MAPS KEYED BY `SessionId` — THIS ONE AND `SessionPool`'s — AND THEY ARE NOT THE SAME FACT
 * WRITTEN TWICE. `SessionPool`'s own doc states the split from its side: the pool says what a session
 * RUNS ON and is the only thing allowed to change it; this says what a session HAS.
 */
export class SessionRegistry {
  /**
   * A `Map` RATHER THAN A FIELD PER SESSION, because the key is what the pool already holds (5d-i
   * design §3.2: `Map<SessionId, SessionClient>`) and because a registry with the sessions spelled out
   * as named fields would have to be rewritten rather than extended the moment a scratch exists.
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
   * Forget `id`. A no-op for a session the registry does not hold.
   *
   * IDEMPOTENT WHERE `add` THROWS, the same asymmetry `SessionPool.unbind` documents: a second `add`
   * asks for something that cannot be honoured, a second `remove` asks for a state already true.
   *
   * IT DOES NOT TERMINATE A WORKER AND MUST NOT — that is `SessionPool.unbind`, and 5d-i design §4.2
   * puts the thread's life in exactly one place. A caller retiring a session calls both; splitting them
   * is what keeps this module free of `new Worker`.
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
   * THIS IS "THE SOURCE SESSION OFFERS source/λ/TM; A `LambdaScratch` OFFERS ONLY λ; A `TmScratch` ONLY
   * TM" (5d-i decision 1, in the words of 5d-i's plan, T7), with the program session's asm leg and an asm
   * copy that offers only asm, evaluated from the session's side: a session appears in `options('lambda')`
   * exactly when it has a λ leg to render. There is no second table of which kind offers what — the legs
   * an entry was built with ARE the answer, so the selector and the resolver cannot disagree about what
   * is bindable.
   *
   * A FRESH ARRAY PER CALL. Accepted rather than cached: it is one array of small objects, and a cache
   * would need invalidating on `add`/`remove`, which is a second fact to keep in step for a saving
   * nobody measured.
   *
   * **IT IS NOT ON THE PER-FRAME PATH.** `PaneSlot.render` pushes `pairs()` below, so `draw()` never
   * reaches here; `pairs()`'s own doc carries the allocation argument, since it is the call that IS on
   * the path. This one is a registry query with no production caller — it is kept because it is
   * `pairs()` for one leg, stated directly, and because `tests/node/sessions.test.ts` and
   * `tests/node/scratch.test.ts` ask a registry what one leg offers without building a whole render
   * pass to find out.
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
 * A STRUCTURAL TYPE RATHER THAN `LambdaPane | TmPane | AsmPane`, for the reason `ClientPort` exists one
 * module over: everything the slot does is resolve a binding and call three methods, and none of it needs
 * a DOM. `tests/node/sessions.test.ts` drives two slots over one registry with recording fakes, which is
 * where "two panes, two λ sessions, two different frames" is asserted without a browser; the browser
 * tier then asserts the same thing reaches real text on a real `LambdaPane`.
 *
 * `LambdaPane` SATISFIES `PaneView<LambdaState>`, `TmPane` `PaneView<TmState>` AND `AsmPane`
 * `PaneView<AsmState>`, with no `implements PaneView` clause on any — the parameterisation is what makes
 * handing the wrong pane to a slot a type error rather than a runtime surprise.
 */
export type PaneView<T> = {
  render(frame: T | null, controls: ControlState): void
  /**
   * `PaneOption[]` AND A WHOLE `Binding<Leg>`, NOT `BindingOption[]` AND A `SessionId`. The pane's
   * title-selector offers `(leg, session)` PAIRS (`pairs()` above, `view-header.ts`'s `viewHeader`), so both
   * halves of what it displays have to cross this boundary: the list of pairs, and which pair is in
   * force. `Binding<Leg>` and not `Binding<K>` — a `PaneView<T>` is parameterised by its FRAME type,
   * which is what pins its renderer, and the pair on offer is deliberately not restricted to the leg
   * the pane happens to render.
   */
  setBindings(options: PaneOption[], current: Binding<Leg>): void
  setDetached(detached: boolean): void
  /**
   * **`choices` RIDES THE CALL THAT MOUNTS THE CONTROL, WHICH IS WHY IT IS HERE AND NOT ON A SETTER OF
   * ITS OWN.** The split control is the split menu (`view-header.ts`'s `viewMenu`), built on open from a
   * list only the app can produce — the registry's pairs, the pane's own binding, and whether the layout
   * tree is currently without a source leaf. Two routes could reach the pane from `draw()`'s per-frame
   * loop: widen this call, or add a sibling setter beside it. This one is the narrower claim: `canSplit`
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
  setLayoutControls(canClose: boolean, canSplit: boolean, choices: SplitChoices): void
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
    pending: leg.pending ?? null,
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
 * to `Binding<Leg>`, `legOf` would return `LegState<LambdaState | AsmState | TmState>`, and every
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
 * `applyLayout` build a fresh entry: a different `PaneSlot`, on the picked leg, a different pane class,
 * the same host, and the old view's editor taken off on the way out (a λ copy's into custody, a TM or
 * asm copy's destroyed). A leg change is a new slot rather than a mutated one, so `K` never has to
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
   * computes the δ-table's running focus from `tm.hist.current?.source_node` and must hand it over
   * with `TmPane.setFocus` BEFORE `render`, or the render pass builds every row against the previous
   * frame's focus and a second pass immediately rebuilds them (see `draw()`'s own note).
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
   * THE SELECTOR AND THE `copy · not linked` STATUS ARE REFRESHED HERE, NOT AT REBIND TIME. Both are
   * functions of the binding and of the registry, and the registry changes under a slot that did not
   * move — a session added or retired elsewhere changes what this pane may be pointed at. Driving them
   * from the one per-frame call means there is no second path that could leave a selector listing a
   * session that no longer exists; both setters are no-ops when nothing changed, which is the same guard
   * `viewHeader`'s setters already state for the same path.
   */
  render(reg: SessionRegistry, pane: PaneView<LegFrame[K]>, leg: LegState<LegFrame[K]>): void {
    const b = this.#binding
    pane.render(leg.hist.current ?? null, legControlState(reg, b, leg))
    pane.setBindings(reg.pairs(), b)
    pane.setDetached(reg.entryOf(b.session).detached)
  }
}
