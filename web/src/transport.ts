import type { Extension } from '@codemirror/state'
import { canRecordFurther } from './controls'
import type { KeymapSetting } from './editor-keymap'
import type { LinkWiring } from './link-wiring'
import type { LspClient } from './lsp-client'
import type { LanguageId } from './lsp-protocol'
import { documentUri, LANGUAGE_OF_PANE } from './lsp-protocol'
import type { PaneEvents } from './pane-chrome'
import { createPlayer } from './player'
import type { Leg } from './protocol'
import { BufferCapReached, type ScratchBuffers } from './scratch'
import type { SessionId } from './session-client'
import type { Binding, LegFrame, LegState, PaneSlot, SessionRegistry } from './sessions'
import { pairLabel } from './view-header'
import type { Speed } from './workspace'

/**
 * What `forkCopy` throws when a handler reaches it with no text — a wiring bug on every leg, named by the handler, so
 * a leg added to `Leg` is a type error here until it says which handler forks it.
 */
const NO_TEXT: Record<Leg, string> = {
  lambda: 'detach reached with no term text',
  tm: 'detachMachine reached with no machine text',
  asm: 'detachAsm reached with no asm text',
}

/**
 * `play`, WHICH HANDS A LEG TO THE PLAYER THAT WALKS RECORDED FRAMES, AND `events`, THE PER-PANE CLICK HANDLERS. See
 * the doc comment on each below for what it does; this one is only about the dependencies.
 *
 * `draw` AND `linkWiring` ARE BOTH THUNKS, AND BOTH ARE FORCED RATHER THAN STYLISTIC. `events(...)`
 * builds the click handlers every pane is CONSTRUCTED with, so `transport` has to exist before any
 * pane does — but `linkWiring` (`link-wiring.ts`) takes `main.ts`'s `panes`, `arranged` and `viewTitle`
 * as values, all built after this factory runs, and `draw` (`draw.ts`) takes `linkWiring` as one, so
 * neither has been built yet when `transport` is. `main.ts` declares `let draw: () => void` and
 * `let linkWiring: LinkWiring` and assigns both after this factory runs — a value parameter for either
 * would capture `undefined` forever. Same shape `link-wiring.ts` already uses for `draw` and `draw.ts`
 * already uses for `view`, applied one step earlier in construction.
 *
 * Because `linkWiring().index` is a fresh call each time it appears, TypeScript cannot narrow a null check on one
 * occurrence across to the next — the handlers below that read it each call `linkWiring()` once, at the top, and
 * narrow on the result instead of narrowing on repeated calls.
 */
export function createTransport(deps: {
  sessions: SessionRegistry
  scratchpad: ScratchBuffers
  draw: () => void
  /** The workspace's speed, in steps a second — read by the player on every frame. */
  speed: () => Speed
  /** Set the workspace's one speed — `main.ts` writes the workspace and draws. */
  setSpeed: (s: Speed) => void
  /** Say a refusal — `notice.ts`'s `notify`. */
  notify: (text: string) => void
  linkWiring: () => LinkWiring
  /**
   * The language server, for the documents this transport's editors are. A value: `main.ts` builds it
   * before this call, and a pane can ask for it while it is still being constructed (`main.ts`'s doc on
   * `lspClient` has the case, a panel restored open).
   */
  lspClient: Pick<
    LspClient,
    | 'openDocument'
    | 'changeDocument'
    | 'closeDocument'
    | 'format'
    | 'documentSymbols'
    | 'definition'
    | 'references'
    | 'hover'
  >
  /** Whether an editor losing focus should reformat — the settings menu's `format on blur`. */
  formatOnBlur: () => boolean
  /**
   * The page's keymap setting — the settings menu's *keymap*, which every editor this factory builds
   * joins.
   *
   * **A VALUE, WHERE `formatOnBlur` ABOVE IS A THUNK, AND THE DIFFERENCE IS FORCED BY THE MECHANISM.**
   * A blur asks that thunk and acts on the answer, so nothing has to be told when it changes. A keymap
   * lives in a CodeMirror `Compartment`, which only changes when a transaction carrying `reconfigure`
   * is dispatched into each view — so the setting has to be an object the editors can join, not a
   * value they can read. `editor-keymap.ts`'s own doc has the argument in full.
   */
  keymap: KeymapSetting
  /**
   * The colourer for one language — `main.ts`'s one grammar registry, curried.
   *
   * **A FUNCTION OF THE LANGUAGE RATHER THAN A READY EXTENSION, BECAUSE THIS FACTORY SERVES EVERY LEG.**
   * `events` below is called once per pane and a pane's leg decides its language; handing the transport
   * a single extension would colour a TM copy with the λ grammar. It is not a thunk, for `lspClient`'s
   * reason above: `main.ts` builds the registry before this call.
   */
  colour: (languageId: LanguageId) => Extension
  /**
   * A buffer has just been created — the header list's readout is stale until this returns.
   *
   * **THE READOUT IS ON A DIFFERENT CLOCK FROM `draw`.** `bufferList.update` takes a COUNT rather than reading its
   * own rows, precisely so the button can be current while the list is CLOSED without any repaint recomputing it
   * (`bufferList`'s doc); a fork is one of the moments the count changes. Routing it through `draw` instead would put
   * the header's readout on the playback clock — every animation frame while a leg plays — to catch a number that
   * changes on a click.
   *
   * `recompile` BELOW DELIBERATELY DOES NOT CALL IT: it rebuilds the term behind a buffer that already
   * exists, so the count is the one thing an edit cannot change.
   */
  onBuffersChanged: () => void
  /**
   * A pane has moved between sessions — the stored `bindings` are stale until this returns.
   *
   * **THE PAYLOAD CHANGES HERE WITHOUT ANY BUFFER CHANGING**, which is why it is a second
   * dependency and not a second caller of `onBuffersChanged` above. That one is about the header's
   * COUNT, and a rebind moves no count: it takes a pane off one session and puts it on another, so the
   * `bindings` half of `PersistedBuffers` is different and the `buffers` half is identical. Routing a
   * rebind through `onBuffersChanged` would repaint the header for a number that did not move, and
   * naming this separately is what keeps "what changed" readable at the call site (`main.ts`'s
   * `persistBuffers` / `refreshBuffers` pair).
   */
  onBuffersPersist: () => void
}): {
  play<T>(leg: LegState<T>): void
  events<K extends Leg>(slot: PaneSlot<K>): PaneEvents
} {
  const {
    sessions,
    scratchpad,
    draw,
    linkWiring,
    onBuffersChanged,
    onBuffersPersist,
    notify,
    lspClient,
    formatOnBlur,
    keymap,
    colour,
  } = deps
  const player = createPlayer({ speed: deps.speed, draw })

  /**
   * Start or stop `leg` playing — playback is `player.ts`'s one animation-frame loop, which walks
   * recorded frames and stops at the frontier, never asking the worker for more.
   *
   * `<T>(leg: LegState<T>)`, because this function toggles a leg and never looks at a frame: `T` is
   * unused in the body, which is that claim written in the type.
   *
   * **IT DRAWS, BECAUSE THE PLAYER ONLY DRAWS WHEN A STEP IS TAKEN.** The play button shows `⏸` from
   * `LegState.playing`, and the first step at 8/s is ~125 ms away (a full second at 1/s); a pause takes no
   * step at all, so without this the button would go on saying `pause` after the click that paused it.
   */
  const play = <T>(leg: LegState<T>) => {
    player.toggle(leg)
    draw()
  }

  /**
   * Make a copy on `slot`'s leg from `text` at `step`, move `slot`'s view onto it, and say what happened — the one body
   * behind every *edit a copy*: `detach` on the λ leg, from the source's term at the step the view shows, and
   * `detachMachine` and `detachAsm` on the TM and asm legs, from the program's whole text at step 0. Each handler
   * resolves its own text and hands it here, so the three cannot drift apart in what follows.
   *
   * **`null` TEXT IS A WIRING BUG, NOT A USER ACTION — LOUD, NOT SWALLOWED.** Each view withdraws or disables its
   * control whenever its handler would pass none (`CopyEditor.#refreshDetach` for the machine views), so a click that
   * reaches here with none is a handler firing on a button that should never have been clickable — a defect in the
   * wiring between the two, not a state a user chose. The λ handler returns before it can pass none (its own guard),
   * so its entry in `NO_TEXT` names the rule rather than a route.
   *
   * **THE CAP'S REFUSAL IS AN ANSWER TO THE USER AND IS CAUGHT HERE** (5d-ii-c design §4.5). `ScratchBuffers.fork`
   * refuses at `MAX_WARM_BUFFERS` rather than evicting, and a click listener is the last frame before the raw DOM
   * dispatch (`view-header.ts`'s `viewMenu`) — there is no `window` error handler in `src/` behind it, so an uncaught
   * throw here would reach the console and nothing else. A notice is where it goes instead (`notice.ts`, Plan 7 part 2
   * spec §11), as `replies.ts` does for the sibling refusal (a fork whose BUILD fails). `e.message` already carries its
   * own prefix by the time it gets here — `scratch.ts`'s `fork` passes it to `#refuseAtCap` itself — so this hands
   * the message through unchanged.
   *
   * **`BufferCapReached` AND NOT A BARE `catch`.** The other throws reachable from `fork` are `SessionRegistry.add`'s
   * and `SessionPool.bind`'s guards over their own invariants; those are wiring bugs, and rendering one as a status
   * line would swallow it. Anything else is re-thrown unchanged. `tests/node/sessions.test.ts` holds both arms, for
   * the λ, TM and asm handlers.
   */
  const forkCopy = (slot: PaneSlot<Leg>, text: string | null, step: number): void => {
    // THE SLOT'S OWN LEG — a slot's leg has no writer (`PaneSlot`'s doc), so the copy is made on the leg the view
    // shows.
    const leg = slot.binding.leg
    if (text === null) throw new Error(NO_TEXT[leg])
    let id: SessionId
    try {
      id = scratchpad.fork(slot, text, step, leg)
    } catch (e) {
      if (!(e instanceof BufferCapReached)) throw e
      notify(e.message)
      // NO `onBuffersChanged()` ON THIS ARM — the header's count did not move, because that is the whole content of
      // the refusal.
      draw()
      return
    }
    // SAY WHAT IT MADE — and that notice is what replaces any refusal still on screen.
    notify(`${scratchpad.nameOf(id) ?? 'a copy'} created — this view shows it`)
    // THE HEADER GAINED A BUFFER, AND ITS READOUT IS A SURFACE `draw()` BELOW DOES NOT REACH — `draw.ts` paints
    // panes and pane chrome, and the buffer list is header chrome beside the workspace menu. See this dependency's own
    // doc for why the count travels on a click rather than on the frame clock.
    onBuffersChanged()
    // IMMEDIATELY, NOT ON THE COPY'S FIRST REPLY. The rebind has already happened, so this view's `copy · not linked`
    // status, its selector (which gains a second option the instant a second session is registered) and the status
    // line are all stale until something paints — and the first frame is a worker round trip away.
    draw()
  }

  /**
   * The leg a step-control gesture acts on, taken from any shared link's position it was pending towards — Plan 7 part
   * 6a spec §5.4: a user stepping, playing, restarting or continuing a leg has taken it from the link, and the link
   * neither moves it nor continues it again.
   */
  const taken = <K extends Leg>(slot: PaneSlot<K>): LegState<LegFrame[K]> => {
    const leg = slot.resolve(sessions)
    delete leg.pending
    return leg
  }

  /**
   * One pane's control handlers, resolved through its slot's binding on every click.
   *
   * TAKES THE SLOT, NOT THE BINDING AND NOT THE `LegState`. A pane is handed this object once, when it is
   * constructed, and keeps it for as long as it lives — `step-controls.ts`'s `stepControls` wires each
   * `addEventListener` exactly once, at construction — and a same-leg pick moves the pane to another
   * session without rebuilding it. A handler that closed over an already-resolved leg would go on driving
   * the leg this pane was bound to WHEN IT WAS BUILT; a handler that closed over a `Binding` VALUE would do
   * the same thing one level up, because `rebind` replaces the binding rather than editing it. The slot is
   * the thing that is still current after a rebind, so the slot is what gets captured and `slot.binding`
   * is read inside each body.
   *
   * THE LEG COMES FROM `slot.binding.leg`, NOT FROM A SEPARATE PARAMETER. A `LegState` carries no
   * identity (5d-i design §3.2b); a binding carries both, so passing the leg apart from it would be a
   * way for the two to disagree.
   */
  const events = <K extends Leg>(slot: PaneSlot<K>): PaneEvents => ({
    // ONE SPEED FOR THE WORKSPACE, NOT PER VIEW — every view's step controls read and set the same value.
    speed: deps.speed,
    setSpeed: deps.setSpeed,
    back: () => {
      taken(slot).hist.back()
      draw()
    },
    forward: () => {
      // At the frontier `▶` means "record one more", which is the same operation as `[continue]`.
      // `canRecordFurther` is `controls.ts`'s call, not re-derived here — see its doc comment.
      const leg = taken(slot)
      const entry = sessions.entryOf(slot.binding.session)
      if (!leg.hist.forward() && canRecordFurther(leg.done, entry.client.awaitingRun)) {
        entry.client.extend(slot.binding.leg)
      }
      draw()
    },
    // ONTO THE NEWEST FRAME, WHICH IS ALSO WHAT FOLLOWING IS: frames still arriving carry the head on (`History.seek`).
    toNewest: () => {
      const { hist } = taken(slot)
      hist.seek(hist.length - 1)
      draw()
    },
    // RESOLVED AT THE CLICK LIKE EVERY OTHER HANDLER HERE, AND THE PLAYER THEN HOLDS THE LEG IT
    // RESOLVED TO — `play` sets the flag ON that `LegState` (`LegState.playing`), which is what makes a
    // second click a stop rather than a second run.
    //
    // PLAYBACK STAYS WITH THE LEG, NOT THE PANE. A play head is a property of a history, and a pane
    // looking away is not the user un-pressing play; more concretely, two slots may be bound to the same
    // leg, so stopping playback on rebind would let one pane's selector silently stop the other pane's
    // playback. The player stops at the frontier, so an unwatched run is bounded rather than forever. See
    // `PaneSlot.rebind` for the same decision stated where the rebind happens.
    play: () => play(taken(slot)),
    restart: () => {
      taken(slot).hist.seek(0)
      draw()
    },
    extend: () => {
      taken(slot)
      sessions.entryOf(slot.binding.session).client.extend(slot.binding.leg)
    },
    // THE SELECTOR'S PICK, ON THE SESSION AXIS. `PaneSlot.rebind` writes the session and nothing else —
    // the leg is fixed by `K` and has no writer anywhere in the app, which is what keeps `Binding<K>`'s
    // type property (see `PaneSlot`'s doc). `draw()` immediately afterwards because a rebind changes
    // what this pane shows, what its `copy · not linked` status says, and what the status line narrates,
    // and none of those has another path to the DOM. The title-selector reads the pair in force only
    // once a repaint hands it over (`ViewHeader.setBindings`).
    //
    // **A CROSS-LEG PICK IS ACTED ON IN `pane-host.ts`, NOT HERE.** Following a leg change means
    // replacing the pane's whole entry — a different `PaneSlot`, a different pane class, its host, and
    // its editor taken off (a λ copy's into custody, a TM or asm copy's destroyed) — which needs the
    // layout tree, and this file has none.
    // `pane-host.ts`'s `paneEvents` wraps this handler, compares the picked leg against the slot's, and
    // delegates ONLY a same-leg pick here; a cross-leg pick changes the leaf's kind and rebuilds the
    // entry through `applyLayout`. So the pair reaching this line always names this slot's own leg, and
    // the session half is all there is left to take.
    //
    // **SO THE COMPARISON BELOW IS AN ASSERTION, NOT AN ANSWER.** A silent refusal would be an answer —
    // the wrong one, since the app has a real one — where a throw says this layer does not answer the
    // question, which is exactly the true statement. Without the comparison, the line would PROJECT any
    // cross-leg pick onto this slot's leg for any caller that wired a pane straight to these handlers
    // (`new LambdaPane(host, transport.events(slot))` typechecks, and `tests/browser/scratch-fork.test.ts`
    // writes that shape twice with hand-built events). `PaneSlot.render` pushes `reg.pairs()` to EVERY
    // pane, so a TM pane's selector lists the λ-only scratch, and taking the session half of that pick on
    // a TM slot mints a TM binding on a session with no TM leg, which `legOf` THROWS on — and `draw.ts`'s
    // per-pane loop has no `try`/`catch`, so the throw would take every later frame with it. One `if`
    // keeps the invariant machine-checked rather than comment-checked.
    //
    // IT THROWS RATHER THAN DECLINING, FOR `LambdaPane.receiveEditor`'s REASON in as many words: a
    // silent repair would absorb a caller's defect as normal operation, and this class of mistake is a
    // wiring bug in a caller rather than a state a user can reach. Unreachable from the app —
    // `pane-host.ts`'s wrapper is the only production caller of this handler and it never delegates a
    // cross-leg pick here — so this costs one comparison per pick and nothing else.
    // `tests/node/sessions.test.ts` pins both arms.
    rebind: (binding: Binding<Leg>) => {
      if (binding.leg !== slot.binding.leg) {
        throw new Error(
          `a ${slot.binding.leg} slot cannot take a ${binding.leg} pick: a leg change replaces the pane (pane-host.ts)`,
        )
      }
      slot.rebind(binding.session)
      // THE STORED BINDINGS ARE READ OFF THE PANES, so the write has to happen after the slot moves and
      // not before (`main.ts`'s `persistBuffers`). AFTER `slot.rebind` AND BEFORE `draw()` for no reason
      // beyond reading in the order the two facts become true; neither call reads the other's work.
      onBuffersPersist()
      draw()
    },
    // THE FORK — 5d-i design §4.3.
    //
    // **`detach` IS λ-ONLY BECAUSE** it forks a TERM at a step, replaying the source's step-0 text to
    // the frame the pane was showing (`forkCopy(slot, wiring.index.lambdaText, step)` below) — a shape
    // with no TM equivalent, since a machine has no per-step text to replay. `detachMachine` is the TM
    // leg's own handler for the same gesture, seeded from the whole `.tm` file instead of a step (its own
    // doc, below, has the argument), which is why this is a second handler rather than one function gated
    // by leg.
    //
    // THE PANE SENDS A STEP, NOT TEXT, AND THIS HANDLER RESOLVES IT — see `PaneEvents.detach`'s doc for
    // why (5d-iii design §4.1).
    //
    // **THE TEXT AND THE STEP GO TOGETHER.** §4.1's seed is the SOURCE session's step-0 term AT
    // `LAMBDA_BYTE_BUDGET`, plus the REAL step, so the worker does the one reduction this text has not
    // had yet (`lambdaScratchAt`). Passing the real step alongside already-reduced text (`hist.current`'s,
    // already at the step on screen) would double-apply the reduction; passing `0` with step-0 text would
    // fork the wrong term.
    //
    // `index.lambdaText`, WHICH THE `compiled` REPLY CARRIES INSIDE `linkIndex`, NOT IN ITS `lambda`. That
    // field is `LambdaStatus` (`available`/`reason`/`node`/`run`), which carries no term text at
    // all; the leg shape that DOES carry one, `LambdaLeg` (`state: LambdaState | null`), only ever rides
    // the LATER `result` reply — after the whole run has finished, which is not usable to seed a fork
    // taken mid-run, and `null` outright for a declined leg. `index.lambdaText` is the SOURCE
    // compile's step-0 term printed at `LAMBDA_BYTE_BUDGET` (`session-worker.ts`'s `onRun`:
    // `session.linkIndex(LAMBDA_BYTE_BUDGET)`, built for every session that exists, decline or not),
    // and it is already what `draw.ts`'s `createDraw` reads to tell a declined λ leg from a live one — a
    // second name for the one string this file already holds, not a second lookup.
    //
    // `index === null || index.lambdaText === ''` COVERS EVERY CASE A FORK CAN BE CLICKED FROM AND
    // NO OTHERS. `index` is `null` between a keystroke and the next `compiled`/`no-session` reply and
    // for an uncompiled page — but `#refreshDetach` already hides this control whenever the pane's
    // frame is `null`, which a `no-session`/pre-compile leg always is, so this guard is defence
    // against a call the pane's own chrome should never produce, not a path a user can reach.
    // `lambdaText === ''` is how `draw.ts`'s `createDraw` spells "declined" — a declined leg
    // also renders no frame, so the same defence applies. NEITHER READS THE SLOT'S SESSION: a
    // detached pane's own `#refreshDetach` already refuses (`!this.#detached`), and the only session
    // that is ever NOT detached is `SOURCE_SESSION` — the one `index` describes — so whenever this
    // handler can fire at all, `index` is already describing the right session.
    ...(slot.binding.leg === 'lambda'
      ? {
          detach: (step: number) => {
            const wiring = linkWiring()
            if (wiring.index === null || wiring.index.lambdaText === '') return
            // THE CAP'S REFUSAL, THE NARROW CATCH AND WHAT IS SAID AND PAINTED AFTER: `forkCopy`, every leg's.
            forkCopy(slot, wiring.index.lambdaText, step)
          },
        }
      : {}),
    // THE EDIT PATH — 5d-iii design §4.3's second gesture: the sink `editSink` returns is the `onEdit` of the
    // editor a view builds (`LambdaPane.setEditor`, `CopyEditor.setEditor`), and it stays that editor's when
    // custody or *move the editor here* moves the editor to another view. `recompile` REBUILDS THE BUFFER THE
    // VIEW SHOWED WHEN IT BUILT THE EDITOR rather than forking a second one, which is the whole of what this
    // handler decides. Buffers are plural (5d-ii-c decision 1), so the pane's own binding is what says which
    // term the keystrokes belong to — read once, when the editor is built (the handler below). Reading it here
    // rather than in the callee follows the division `PaneEvents.detach`'s doc draws for `detach` above: this
    // file resolves what the callee needs to name, and the callee does not go looking.
    //
    // NO `draw()`, UNLIKE `detach` ABOVE, and the asymmetry is the point rather than an
    // oversight. `detach` draws because it REBINDS the slot synchronously — the `copy · not linked`
    // status, the selector and the status line are stale the instant the click returns. `recompile` posts a
    // message and changes nothing else synchronously: the pane is already on this session and
    // stays on it (`scratch.ts`'s own doc: "does not rebind and does not touch the registry"),
    // so there is no fact for a draw to catch up on until the worker's `scratch-compiled` reply
    // arrives and `onScratchReply` paints it. A frame is drawn on the way regardless:
    // `ScratchBuffers.recompile` claims a generation with `client.supersede()`, and the pool's
    // `onSupersede` repaints through `draw()`, as it does for a source keystroke's compile.
    //
    // **PROVIDED ON EVERY LEG, NOT ONLY λ.** `TmPane` also `implements EditablePane`, and the `CopyEditor`
    // its constructor builds reads this handler exactly the way `LambdaPane` does, unconditional on leg.
    // `slot.binding.session` resolves identically on any leg, so there is nothing leg-specific in this
    // handler's body.
    // ONE EXTENSION PER EDITOR, BUILT FROM THE ONE REGISTRY — the grammar is fetched once for the page
    // however many editors ask for it (`colour.ts`'s `createGrammarRegistry` caches per language,
    // including a failure), so building a plugin here costs nothing beyond the plugin.
    colour: () => colour(LANGUAGE_OF_PANE[slot.binding.leg]),
    // A VALUE, NOT A THUNK — one keymap serves the page, so there is no binding to resolve. See the
    // dependency's own doc for why it is an object rather than a getter.
    keymap,
    // **THE DOCUMENT FOLLOWS THE SESSION, NOT THE SLOT.** `editor-custody.ts` holds editors under
    // `SessionId` and a session has exactly one leg, so this pair is the editor's identity even
    // as it moves between panes. Read inside the thunk, like `editSink` below, because a
    // slot's binding changes under a pane that was constructed once.
    lspDocument: () => ({
      uri: documentUri(slot.binding.session, LANGUAGE_OF_PANE[slot.binding.leg]),
      languageId: LANGUAGE_OF_PANE[slot.binding.leg],
      client: lspClient,
      formatOnBlur,
      notify,
      // The same words the view's own title uses, so the two cannot drift apart.
      label: pairLabel({
        leg: slot.binding.leg,
        label: sessions.has(slot.binding.session) ? sessions.entryOf(slot.binding.session).label : 'a copy',
      }),
    }),
    // **THE SESSION IS READ WHEN THE EDITOR IS BUILT, NOT WHEN AN EDIT FIRES** — `PaneEvents.editSink`'s doc
    // has the reason: read at fire time, typing a view had not yet sent when it moved to another copy would
    // rebuild that copy.
    editSink: () => {
      const session = slot.binding.session
      return (src: string) => {
        scratchpad.recompile(session, src)
      }
    },
    // THE COLLAPSE REPORT — 5d-ii-d design §4.7.
    //
    // **PROVIDED ON EVERY LEG, NOT ONLY λ.** `TmPane`'s `CopyEditor` builds a `textPanel` that wraps the
    // editor's host in the pane body and calls `on.collapse?.(collapsed)` from it, exactly like
    // `LambdaPane`'s. Inside the λ-only spread, every `TmPane` would be constructed with
    // `on.collapse === undefined`, so a TM collapse would toggle the class but never reach
    // `scratchpad.setCollapsed` or `redextape.buffers` — collapse a TM scratch, reload, and it would come
    // back expanded, the screen-disagrees-with-storage defect the collapse-seeding rules exist to prevent.
    // THE SESSION IS ALREADY IN SCOPE HERE, which is the whole
    // reason this lives in `transport.ts` rather than behind a callback threaded through `pane-host.ts`
    // the way `detach`/`showEditor` are — those two need a `LeafId` this file does not have (`editorOwner`
    // is keyed by one); this handler needs nothing beyond `slot.binding.session`, which every
    // other handler above already resolves the same way, on any leg.
    //
    // **`slot.binding.session` NAMES THE BUFFER WHOSE EDITOR IS ON SCREEN**, because `pane-host.ts`'s
    // rebind wrapper takes the outgoing editor off the view before the binding moves (a λ view's into
    // custody, a TM or asm view's destroyed). Without that, a pane could go on showing buffer A's live
    // editor above buffer B's frames once its binding had moved to B, and clicking collapse would record
    // the flag against B while the editor on screen was A's.
    // The edit handler has a second hazard this one does not: a debounce still pending when the binding
    // moves would fire after it, so it binds the session when the editor is built (`editSink` above). A
    // collapse is a click, read when it lands.
    collapse: (collapsed: boolean) => {
      // NO `draw()`. The host is already hidden or shown by the time this runs — `createPanel`'s own
      // click handler (`panel.ts`) applies that state before calling `onToggle` — and nothing else on
      // screen depends on this flag.
      // `onBuffersPersist()` is the entire consequence: the collapsed flag is part of what `main.ts`'s
      // `persistBuffers` stores, as a moved binding is for `rebind` above.
      scratchpad.setCollapsed(slot.binding.session, collapsed)
      onBuffersPersist()
    },
    // OMITTED ENTIRELY ON THE λ LEG, not set to `undefined` — `PaneEvents.linkState` is optional
    // under `exactOptionalPropertyTypes`, which distinguishes "absent" from "present and undefined".
    // The λ pane has no table to click.
    //
    // DECIDED FROM THE SLOT'S LEG, ONCE, AT CONSTRUCTION — not per click like the handlers above, and
    // sound for two reasons. Which handlers a pane HAS is a fact about the pane's shape (the λ pane has
    // no δ-table to click), and this object is built once and then held by the pane for the life of the
    // page, so there is no later moment at which a spread could take effect anyway. The second reason is
    // `PaneSlot`'s: a slot's leg cannot change, so a fact decided from it at construction cannot go stale
    // the way one decided from its session would.
    // THE ASM VIEW'S ROWS LINK THE SAME WAY, BY THE INSTRUCTION'S OWNER (Plan 7 part 5 spec §6.6) — an instruction
    // `defunc` minted has none, and `setLinkTo` says so on the status line rather than leaving it blank.
    //
    // **A ROW IN A COPY LINKS NOTHING AND SAYS NOTHING** (spec amendment 28), in either view that numbers its rows by
    // the machine it shows. The link index describes the PROGRAM, so an instruction or state index read in a copy names
    // whatever the program has at that index: an unedited copy would line up with the program and pin its constructs,
    // and an edited one would pin whatever the program happens to have there. `detached` is the session's own fact,
    // read at click time since the view's binding moves.
    ...(slot.binding.leg === 'asm'
      ? {
          linkInstr: (pc: number) => {
            const wiring = linkWiring()
            if (!wiring.linkable || wiring.index === null) return
            if (sessions.entryOf(slot.binding.session).detached) return
            wiring.setLinkTo(wiring.index.nodeForInstr(pc), 'asm')
          },
          // `detachMachine`'s handler below, for an asm copy: the program's text, as its session kept it from the
          // `compiled` reply (`replies.ts`'s `setAsmProgram`), `null` only where the control is withdrawn or disabled.
          detachAsm: () => forkCopy(slot, sessions.entryOf(slot.binding.session).asmProgram?.asmText ?? null, 0),
        }
      : {}),
    ...(slot.binding.leg === 'tm'
      ? {
          linkState: (stateId: number) => {
            const wiring = linkWiring()
            if (!wiring.linkable || wiring.index === null) return
            if (sessions.entryOf(slot.binding.session).detached) return
            wiring.setLinkTo(wiring.index.nodeForState(stateId), 'tm')
          },
          // THE MACHINE FORK — 5d-iv design §4.3, `detach`'s counterpart for this leg. **NO STEP TO RESOLVE,
          // WHERE `detach` ABOVE RESOLVES ONE** — `PaneEvents.detachMachine`'s own doc has the argument:
          // a machine's seed is the whole `.tm` file, not a replay to a frame.
          //
          // `sessions.entryOf(...).tmProgram?.tmText` IS THE TEXT THIS FORKS — `replies.ts`'s
          // `setTmProgram` is what writes it, from the `compiled` reply's own `tmText` field, every time
          // this session's TM leg recompiles. Reading it off the SLOT's OWN SESSION, not a fixed
          // `SOURCE_SESSION` this file does not have: whichever session a TM pane is currently bound to is
          // the one its fork control forks FROM, same as `detach` above resolves `slot.binding.session`
          // rather than assuming which session it is.
          //
          // **`null` REACHING HERE IS A WIRING BUG, NOT A USER ACTION — `forkCopy` throws it.** The
          // control is withdrawn or disabled (`CopyEditor.#refreshDetach`) whenever this would be `null` —
          // over the cap (`tmText === null` with a machine present, disabled) or on a pane already
          // showing the scratch it would fork (`#detached`, removed entirely: `setForkAvailable`'s own call
          // site fans out over the SOURCE session only, so a pane that has just rebound onto its own new
          // scratch needs `#refreshDetach` driven from `setDetached`, not another `setForkAvailable` call it
          // will never receive).
          detachMachine: () => forkCopy(slot, sessions.entryOf(slot.binding.session).tmProgram?.tmText ?? null, 0),
        }
      : {}),
    // OMITTED ENTIRELY ON THE TM LEG, mirroring `linkState` above — `PaneEvents.linkLambda` is
    // optional under `exactOptionalPropertyTypes`, and the TM pane has no λ term to click.
    ...(slot.binding.leg === 'lambda'
      ? {
          linkLambda: (node: number) => {
            const wiring = linkWiring()
            if (!wiring.linkable) return
            wiring.setLinkTo(node, 'lambda')
          },
        }
      : {}),
  })

  return { play, events }
}
