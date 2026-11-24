import { canRecordFurther } from './controls'
import type { FieldWidth } from './field-width'
import type { LinkWiring } from './link-wiring'
import { isLinkedLeg, LINKED } from './linked-legs'
import type { PaneEvents } from './pane-chrome'
import { createPlayer } from './player'
import type { Leg, LegFrame } from './protocol'
import { type Binding, type LegState, type PaneSlot, rewindLeg, type SessionRegistry } from './sessions'
import type { Speed } from './workspace'

/**
 * `play`, WHICH HANDS A LEG TO THE PLAYER THAT WALKS RECORDED FRAMES, AND `events`, THE PER-PANE CLICK HANDLERS. See
 * the doc comment on each below for what it does; this one is only about the dependencies.
 *
 * `draw` AND `linkWiring` ARE BOTH THUNKS, AND BOTH ARE FORCED RATHER THAN STYLISTIC. `events(...)` builds the click
 * handlers every pane is CONSTRUCTED with, so `transport` has to exist before any pane does — but `linkWiring`
 * (`link-wiring.ts`) takes `main.ts`'s `panes` as a value, built after this factory runs, and `draw` (`draw.ts`) takes
 * `linkWiring` as one, so neither has been built yet when `transport` is. `main.ts` declares `let draw: () => void` and
 * `let linkWiring: LinkWiring` and assigns both after this factory runs — a value parameter for either would capture
 * `undefined` forever. Same shape `link-wiring.ts` already uses for `draw` and `draw.ts` already uses for `view`,
 * applied one step earlier in construction.
 *
 * Because `linkWiring().index` is a fresh call each time it appears, TypeScript cannot narrow a null check on one
 * occurrence across to the next — the handlers below that read it each call `linkWiring()` once, at the top, and
 * narrow on the result instead of narrowing on repeated calls.
 */
export function createTransport(deps: {
  sessions: SessionRegistry
  draw: () => void
  /** The workspace's speed, in steps a second — read by the player on every frame. */
  speed: () => Speed
  /** Set the workspace's one speed — `main.ts` writes the workspace and draws. */
  setSpeed: (s: Speed) => void
  /** The program's one field width, handed to every view as `speed` is; a caller without it builds no width box. */
  fieldWidth?: FieldWidth
  /** The page's `pkg-clif` load, handed to every view as `fieldWidth` is, for a CLIF view to say. */
  clifLoad?: NonNullable<PaneEvents['clifLoad']>
  /** The program's one listing, handed to every view as `fieldWidth` is, for a CLIF view to show and switch. */
  clifListing?: NonNullable<PaneEvents['clifListing']>
  linkWiring: () => LinkWiring
}): {
  play<T>(leg: LegState<T>): void
  events<K extends Leg>(slot: PaneSlot<K>): PaneEvents
} {
  const { sessions, draw, linkWiring } = deps
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
   * A linked leg's row click, under the `PaneEvents` member its `LINKED` entry names (`linkInstr` for rxm and CLIF,
   * `linkState` for TM), and OMITTED ENTIRELY ON THE λ LEG, not set to `undefined` — both members are optional under
   * `exactOptionalPropertyTypes`, which distinguishes "absent" from "present and undefined". The λ pane has no rows to
   * click. What a row links is the entry's `click.link`: an rxm instruction by its owner (Plan 7 part 5 spec §6.6),
   * where one `defunc` minted has none and `linkInstr` says so on the status line; a TM state by its node.
   *
   * DECIDED FROM THE SLOT'S LEG, ONCE, AT CONSTRUCTION — not per click like `events`' other handlers, and sound for two
   * reasons. Which handlers a pane HAS is a fact about the pane's shape (the λ pane has no δ-table to click), and
   * `events`' object is built once and then held by the pane for the life of the page, so there is no later moment at
   * which a spread could take effect anyway. The second reason is `PaneSlot`'s: a slot's leg cannot change, so a fact
   * decided from it at construction cannot go stale the way one decided from its session would.
   */
  const linkedRowClick = (slot: PaneSlot<Leg>): Pick<PaneEvents, 'linkInstr' | 'linkState'> => {
    const leg = slot.binding.leg
    if (!isLinkedLeg(leg)) return {}
    const { click } = LINKED[leg]
    return {
      [click.event]: (row: number | null) => click.link(linkWiring(), row),
    }
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
    ...(deps.fieldWidth !== undefined ? { fieldWidth: deps.fieldWidth } : {}),
    ...(deps.clifLoad !== undefined ? { clifLoad: deps.clifLoad } : {}),
    ...(deps.clifListing !== undefined ? { clifListing: deps.clifListing } : {}),
    legReason: () => slot.resolve(sessions).status.reason,
    back: () => {
      taken(slot).hist.back()
      draw()
    },
    forward: () => {
      // At the frontier `▶` means "record one more", which is the same operation as `[continue]`.
      // `canRecordFurther` is `controls.ts`'s call, not re-derived here — see its doc comment.
      const leg = taken(slot)
      const entry = sessions.entryOf(slot.binding.session)
      // NOT ON A HELD RING, as `restart` says.
      if (!leg.hist.forward() && leg.clifHold === undefined && canRecordFurther(leg.done, entry.client.awaitingRun)) {
        entry.client.extend(slot.binding.leg, leg.epoch)
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
    // **A REWIND ONLY WHERE A SEEK CANNOT REACH STEP 0 AND THE WORKER CAN ANSWER ONE** (hidden-recording spec §6). The
    // ring keeps step 0 exactly while nothing was evicted, and the worker holds the leg's recording only while its
    // frames are the client's generation: during a recompile the new generation's `compiled` reply would reset the
    // epoch under a rewind the worker took for it, and after an edit that did not parse it holds nothing, though
    // `awaitingRun` is false. There a seek goes as far back as the ring keeps; a recompile's new generation starts
    // from 0.
    restart: () => {
      const leg = taken(slot)
      const { client } = sessions.entryOf(slot.binding.session)
      // **NOT ON A HELD RING** (`ClifHold`), nor `extend` or a frontier `▶` there: its frames are of a recording a CLIF
      // request replaced, and its end is that recording's. A rewind's epoch would drop the listing the request is
      // answered with, and a request under the new epoch would act on the listing chosen for a gesture on the other.
      if (leg.hist.evicted && leg.gen === client.gen && leg.clifHold === undefined) {
        rewindLeg(leg)
        client.rewind(slot.binding.leg, leg.epoch)
      } else leg.hist.toStart()
      draw()
    },
    extend: () => {
      const { epoch, clifHold } = taken(slot)
      // NOT ON A HELD RING, as `restart` says.
      if (clifHold === undefined) sessions.entryOf(slot.binding.session).client.extend(slot.binding.leg, epoch)
    },
    // THE SELECTOR'S PICK, ON THE SESSION AXIS. `PaneSlot.rebind` writes the session and nothing else —
    // the leg is fixed by `K` and has no writer anywhere in the app, which is what keeps `Binding<K>`'s
    // type property (see `PaneSlot`'s doc). `draw()` immediately afterwards because a rebind changes
    // what this pane shows and what the status line narrates, and neither has another path to the DOM. The
    // title-selector reads the pair in force only once a repaint hands it over (`ViewHeader.setBindings`).
    //
    // **A CROSS-LEG PICK IS ACTED ON IN `pane-host.ts`, NOT HERE.** Following a leg change means
    // replacing the pane's whole entry — a different `PaneSlot`, a different pane class and its host — which
    // needs the layout tree, and this file has none.
    // `pane-host.ts`'s `paneEvents` wraps this handler, compares the picked leg against the slot's, and
    // delegates ONLY a same-leg pick here; a cross-leg pick changes the leaf's kind and rebuilds the
    // entry through `applyLayout`. So the pair reaching this line always names this slot's own leg, and
    // the session half is all there is left to take.
    //
    // **SO THE COMPARISON BELOW IS AN ASSERTION, NOT AN ANSWER.** A silent refusal would be an answer —
    // the wrong one, since the app has a real one — where a throw says this layer does not answer the
    // question, which is exactly the true statement. Without the comparison, the line would PROJECT any
    // cross-leg pick onto this slot's leg for any caller that wired a pane straight to these handlers
    // (`new LambdaPane(host, transport.events(slot))` typechecks). `PaneSlot.render` pushes `reg.pairs()` to EVERY
    // pane, so a TM pane's selector lists the λ pair too, and taking the session half of that pick on a TM slot
    // would answer a pick of λ by staying on TM. One `if` keeps the invariant machine-checked rather than
    // comment-checked.
    //
    // IT THROWS RATHER THAN DECLINING: a silent repair would absorb a caller's defect as normal operation, and this
    // class of mistake is a wiring bug in a caller rather than a state a user can reach. Unreachable from the app —
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
      draw()
    },
    ...linkedRowClick(slot),
    // OMITTED ENTIRELY ON THE TM LEG, mirroring `linkedRowClick` above — `PaneEvents.linkLambda` is
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
