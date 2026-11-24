import { EditorView } from '@codemirror/view'
import { ClifPane } from './clif-pane'
import { keepFocusOn } from './focus-handoff'
import { LambdaPane } from './lambda-pane'
import {
  type AddRefusal,
  addRefusal,
  closeLeaf,
  type Dir,
  type LayoutNode,
  leaves,
  MAX_TREE_LEAVES,
  resize,
  SOURCE_LEAF,
  setLeafKind,
  splitLeaf,
} from './layout'
import { DIVIDER_PX, renderLayout, renderStage, syncSizes } from './layout-view'
import type { PaneChoice, PaneEvents } from './pane-chrome'
import type { Shares } from './panel-stack'
import { LEG_PANELS, type LeafId, type PaneCollection, type PaneEntry, type PaneKind, storedPanels } from './panes'
import type { Leg, LegFrame, LegProgram } from './protocol'
import { RxmPane } from './rxm-pane'
import { seedRxm } from './rxm-seed'
import type { SessionId } from './session-client'
import { type Binding, PaneSlot, type PaneView } from './sessions'
import { restoreScroll } from './state-table'
import { TmPane } from './tm-pane'
import { seedTm } from './tm-seed'
import {
  type ClifDisplay,
  type DisplayLeg,
  type LambdaDisplay,
  LEG_DISPLAY,
  type LegDisplay,
  type TmDisplay,
} from './workspace'

/**
 * THE PANE LIFECYCLE — which panes exist, what element each one lives in, and what its controls do.
 *
 * `pendingBinding` (inside the factory below) never leaves this module, and that is this module's
 * point rather than a housekeeping preference: it answers "what session does a leaf with no pane yet
 * start on" — asked by a split or an add and, since panes can change leg, by a cross-leg pick on the
 * binding selector — and every reader of it is inside this module. `hosts` answers the sibling
 * question — "what element is the pane at this leaf mounted in", which outlives the pane so a closed
 * leaf comes back with its editor intact — but it is not private the same way: `applyLayout` hands it
 * to `layout-view.ts`'s `renderLayout` or `renderStage` on every call. Each only reads it, via `.get()`,
 * to place a leaf's host in what it paints; every write to `hosts` happens in exactly two
 * places, both in this module — `hostFor`'s generic branch below, and `seedHost`, which `main.ts` calls
 * once to seed the source pane's pre-built host before `applyLayout` first runs — and nowhere
 * else. A `Map` any of `main()`'s lines could write is a `Map` any of them could answer that question
 * differently, which is the property both preserve even though only `pendingBinding` stays unnamed
 * outside this module.
 *
 * **`applyLayout` IS THE ONLY THING IN THE APP THAT CREATES OR REMOVES A PANE** — it is why
 * `PaneCollection` can be handed to `link-wiring.ts`, `draw.ts` and `replies.ts` empty and read live by
 * all three.
 *
 * THE LAYOUT TREE IS NOT A FIELD HERE. It stays a `let` in `main()` and crosses as the `getTree`/
 * `setTree` pair below: a second place the current tree lives is a second answer to what the current tree is.
 * This module reads it on every use and writes it through the setter, so `main.ts` remains the one owner.
 *
 * ITS MEMBERS ARE WHAT `main.ts` ACTUALLY CALLS — and the shorter list is a decision rather
 * than an oversight. No caller outside this module reaches `hostFor` or `paneEvents`, because both are
 * used only from inside `applyLayout`.
 *
 * IT IS THE SAME ARGUMENT `deps` MAKES BELOW, POINTED THE OTHER WAY. That doc refuses a `SessionRegistry`
 * because a parameter carries the authority of its type: taking one would say this module could ask every
 * question a registry answers, a claim about this module's REACH that its body does not make. A member no
 * call site reaches is the mirror of it: a claim about this module's SURFACE that no call site makes.
 * Keeping one and refusing the other would be the inconsistency.
 *
 * `hostFor` AND `paneEvents` ARE CLOSURES IN SCOPE, and later work is free to modify either: a task
 * editing `hostFor`'s body is not a caller needing `hostFor` exported.
 */
export type PaneHost = {
  /** Reconcile panes to leaves, re-render the tree, persist it, and draw. */
  applyLayout(): void
  /**
   * Record `id` as the focused view, rebuild the layout around it, and move the focus into it — the three
   * steps a tree-changing gesture owes, in the one order that works on the stage. See the implementation.
   */
  focusView(id: LeafId | null): void
  /**
   * Record `id` as the focused view and rebuild the layout around it, leaving the keyboard focus where it was unless
   * the view that held it left the page — a switch to another combination of views. See the implementation.
   */
  switchViews(id: LeafId): void
  /**
   * `focusView`, with every view the tree keeps built again, on the program, from the workspace in force — an opened
   * link's, or the one its *undo* puts back (Plan 7 part 6a spec §5.3, §5.5). See the implementation.
   */
  rebuildViews(id: LeafId): void
  /** Pre-seed the source pane's host, which `main.ts` owns the contents of. */
  seedHost(id: LeafId, host: HTMLElement): void
  /** Tell `entry`'s view what `session` holds for it, as `SEED` does every view this module moves or builds. */
  seedPane(entry: PaneEntry<Leg>, session: SessionId): void
}

/**
 * A layout change worth a notice (Plan 7 part 2 spec §11): a view added, closed, or switched to show something
 * else. `main.ts` words it.
 */
export type LayoutEvent =
  | { readonly kind: 'added' | 'switched'; readonly leaf: LeafId; readonly shows: PaneChoice }
  | { readonly kind: 'closed'; readonly leaf: LeafId; readonly showed: PaneChoice }

/**
 * A split the tree had no room for, or no leaf left for — `main.ts` words it on the notice line: `leaf` is the view
 * the split was chosen on, `gesture` the split's direction, and `why` is `layout.ts`'s `addRefusal`.
 */
export type AddRefused = { readonly leaf: LeafId; readonly gesture: Dir; readonly why: AddRefusal }

/** The class of a view on each leg: what `SEED`'s entries are handed. */
type LegPane = { lambda: LambdaPane; rxm: RxmPane; tm: TmPane; clif: ClifPane }

/**
 * Build the pane lifecycle over the collection and the app's layout tree.
 *
 * `root`, `panes` AND `transport` ARE TAKEN AS VALUES, `draw` AS A THUNK — the same split
 * `createLinkWiring` already draws, and forced by the same fact: `main.ts` builds all three of the first group
 * before this call and never reassigns any of them, while `draw` is a `let` that `createDraw` does not fill in
 * until after the panes exist. `panes` is handed over EMPTY, and `applyLayout` below is what fills it.
 *
 * **`getTree`/`setTree` RATHER THAN A `tree` FIELD, AND RATHER THAN A MUTABLE EXPORT.** `main()`'s
 * `let tree` has writers in `main()` — the source view's own close among them, `sourceMenu`'s handler,
 * built directly in `main()` because it has no `PaneSlot` and therefore no `paneEvents` to route a
 * `close` gesture through — beside this module's split/close/resize (through `setTree`). A copy here
 * would have to be pushed back on each of `main()`'s writers; an exported binding would put the current
 * tree in two modules at once. A getter read at every use is the shape with one answer.
 *
 * **`sourceSession`, `sourceLayout`, `persist`, `nextLeafId` AND `neighbourOf` ARE `main.ts`'S OWN
 * VALUES AND FUNCTIONS, LENT TO THIS MODULE.** `sourceSession` is `main()`'s one session-id constant;
 * `sourceLayout` sets whether the source view's menu offers its close, and `applyLayout` drives it
 * because `canClose` changes only at a structural change and the source leaf has no `PaneEntry` for
 * `draw()` to find; `persist` is `main.ts`'s `persistWorkspace`, which writes through the guarded
 * `localStorage` writer kept beside the guarded reader that restores the workspace rather than split
 * from it; and `nextLeafId`/`neighbourOf` are module-level in `main.ts` because `leafCounter` is
 * per-module rather than per-`main()` call and `main.ts`'s own source-pane close control is
 * `neighbourOf`'s other caller.
 *
 * `SessionRegistry` IS NOT A DEPENDENCY, AND THE ABSENCE IS EVIDENCE RATHER THAN AN OVERSIGHT. **NOT
 * BECAUSE NOTHING HERE WOULD READ ONE — `programOf` below is precisely a read a registry would
 * serve.** Because a registry serves EVERY read: handed one, this module could ask whether a session
 * exists, what legs it has and what it is called, and its dependency list would stop being able to say
 * that it does not. A parameter carries the authority of its TYPE, not of the call sites that happen to
 * exist today, so the absence is only evidence while the thing absent is the general instrument rather
 * than the one answer.
 *
 * **WHICH IS WHY EACH QUESTION THE MODULE ASKS ABOUT A SESSION IS A DEPENDENCY OF ITS OWN —
 * `programOf` AND ITS TWINS BELOW — RATHER THAN A WAY TO ASK OTHERS.** Each is a function from a
 * `SessionId` (and a leg) to one retained value, so the body can ask nothing those functions do not answer.
 *
 * (Phrased as "this module" rather than as a count of MEMBERS, deliberately: a doc that restates an
 * arity has to be re-read every time the arity moves. The claim is about the body, not the list, and
 * the paragraph above counts no session questions for the same reason. What it keeps is the rule: a
 * session question is the thing that has to argue for itself, and each one's doc gives its reason or
 * names the twin whose reason it shares.)
 */
export function createPaneHost(deps: {
  root: HTMLElement
  panes: PaneCollection
  transport: { events<K extends Leg>(slot: PaneSlot<K>): PaneEvents }
  sourceSession: SessionId
  sourceLayout: { update(canClose: boolean, canSplit: boolean): void }
  nextLeafId(): LeafId
  neighbourOf(tree: LayoutNode, id: LeafId): LeafId | null
  getTree(): LayoutNode
  setTree(next: LayoutNode): void
  /**
   * Every live view and the kind it is: the leaves of the tree on screen and of every arrangement the workspace
   * remembers (`arrangements.ts`'s `liveLeaves`; the view layouts spec §5.1).
   */
  liveLeaves(): ReadonlyMap<LeafId, PaneKind>
  /**
   * Told each time a tree has been put on the page, after its views are rendered and before it is stored — where the
   * header's `views` toggles are brought up to the tree, since this is the one place every change to it arrives.
   */
  applied(): void
  /**
   * Run `rebuild`, a rebuild that gives the keyboard focus back to the element it takes it from: `keepingFocus` below
   * calls it, for a switch of views and for a divider's gesture alike. An editor that has the focus is sent a `blur`
   * as its view leaves the page, and that blur is not the user leaving the editor: `main.ts` has no editor format at
   * one sent while this runs (`focusKept`'s doc).
   */
  rebuilding(rebuild: () => void): void
  /** Whether the workspace draws its views as a tabbed stage — spec §5's `views` switch. */
  stage(): boolean
  /** The focused leaf, repaired against the tree — in Stage it is the one view on the page. */
  focusedLeaf(): LeafId
  /** A view's title, in the title-selector's own spelling — a Stage tab's label (spec §5, §7). */
  viewTitle(id: LeafId): string
  /**
   * Write the whole workspace to storage — every field of `Workspace`, each λ view's display among them
   * (`main.ts`'s `persistWorkspace`).
   */
  persist(): void
  /** Record that `id` is the view the user is in. */
  setFocused(id: LeafId): void
  /** A view's stored state for one of its panels, or `undefined` for none. */
  panelOpen(leaf: LeafId, name: string): boolean | undefined
  /** Record a view's panel state; `persist` is the caller's to make. */
  setPanel(leaf: LeafId, name: string, open: boolean): void
  /** A view's stored shares for its regions, or `undefined` for none (the view layouts spec §11.4). */
  panelSizesOf(leaf: LeafId): Shares | undefined
  /** Record a view's shares; `persist` is the caller's to make. */
  setPanelSizes(leaf: LeafId, sizes: Shares): void
  /** A view's stored display settings, or `undefined` for none (Plan 7 part 4 spec §5.1, §6 and §8). */
  displayOf<K extends DisplayLeg>(leg: K, leaf: LeafId): LegDisplay[K] | undefined
  /** Record a view's display settings; `persist` is the caller's to make. */
  setLegDisplay<K extends DisplayLeg>(leg: K, leaf: LeafId, d: LegDisplay[K]): void
  /** A view was added, closed, or switched to show something else — `main.ts` says it as a notice (spec §11). */
  layoutChanged(e: LayoutEvent): void
  /** An add was refused, and nothing changed — `main.ts` says why as a notice. */
  refused(r: AddRefused): void
  draw(): void
  /**
   * The program `session` last compiled for `leg`, or `null` if it has none — what a view built or moved here is
   * seeded with, because the reply that told the others has already been and gone.
   *
   * **A QUESTION, NOT A REGISTRY** — `createPaneHost`'s doc has the argument in full, and this signature
   * is what makes it hold: one `SessionId` and a leg in, one retained value out, no way to ask anything else.
   * `main.ts` answers it from `SessionEntry.programs`, through `entryOf`, which throws for a session the
   * registry does not hold — the policy `SessionRegistry.entryOf` states — and that is unreachable from
   * here: the id this is called with is the one a view is about to show, so a missing entry is a
   * wiring bug that `PaneSlot.render` would raise on the very next frame anyway.
   *
   * NULLABLE RATHER THAN A PANE-SHAPED CALLBACK. "Seed this pane" would put the pane class in
   * `main.ts`'s call and give this module a dependency that DOES something rather than one that answers
   * something; the pane is built here, so the push belongs here too.
   */
  programOf<K extends keyof LegProgram>(session: SessionId, leg: K): LegProgram[K] | null
}): PaneHost {
  // THE SOURCE SESSION ID KEEPS ITS `main.ts` SPELLING THROUGH A RENAMING DESTRUCTURE: `SOURCE_SESSION` is the
  // name the bodies below and their comments use for it.
  const {
    root,
    panes,
    transport,
    sourceSession: SOURCE_SESSION,
    sourceLayout,
    nextLeafId,
    neighbourOf,
    getTree,
    setTree,
    liveLeaves,
    applied,
    rebuilding,
    stage,
    focusedLeaf,
    viewTitle,
    persist,
    setFocused,
    panelOpen,
    setPanel,
    panelSizesOf,
    setPanelSizes,
    displayOf,
    setLegDisplay,
    layoutChanged,
    refused,
    draw,
    programOf,
  } = deps

  /**
   * Tell a view everything `session` holds for its leg, and that it holds nothing where it does not; `seedTm` and
   * `seedRxm` list what. λ's entry does nothing: a λ view is told nothing of a session's program.
   *
   * **A VIEW COMES TO SHOW A SESSION IN THREE WAYS AFTER THE REPLIES HAVE GONE, AND EACH CALLER IS ONE OF THEM:** it
   * is created (`applyLayout`'s creation pass), it is picked through its own selector (the same-leg `rebind` arm), or
   * it is shown after compiles it missed off the page (`draw.ts`). A pick is what needs the `null`s: without them, a
   * view picked onto a session with nothing compiled would keep the δ table it showed.
   */
  const SEED: { readonly [K in Leg]: (pane: LegPane[K], session: SessionId) => void } = {
    lambda: () => {},
    rxm: (pane, session) => seedRxm(pane, programOf(session, 'rxm')),
    tm: (pane, session) => seedTm(pane, programOf(session, 'tm')),
    // THE CLIF THE SESSION KEPT, `null` until its listing or its reason came: the view says it is loading until then.
    clif: (pane, session) => pane.setProgram(programOf(session, 'clif')),
  }

  /**
   * `SEED`'s entry for `entry`'s view, taken whole so that its kind and its pane come from one entry. **THE ONE CAST
   * CLAIMS THE PANE IS THE CLASS OF THE LEG ITS KIND NAMES.** For an entry `panes` holds, `buildPane` took the pane from
   * `PANE_BUILD`'s entry for that kind, and no field changes after. An entry assembled by hand has no such tie, so every
   * caller passes one from `panes`.
   */
  const seedPane = (entry: PaneEntry<Leg>, session: SessionId): void => seedLeg(entry.kind, entry.pane, session)
  const seedLeg = <K extends Leg>(kind: K, pane: PaneView<LegFrame[K]>, session: SessionId): void =>
    SEED[kind](pane as unknown as LegPane[K], session)

  /**
   * What builds a view of each leg from its host, its events and its leaf. **A MAPPED TYPE, SO A NEW LEG WITH NO VIEW
   * IS A TYPE ERROR HERE.** A view's stored panels are read by the names in `LEG_PANELS`.
   */
  const PANE_BUILD: { readonly [K in Leg]: (host: HTMLElement, on: PaneEvents, leaf: LeafId) => LegPane[K] } = {
    lambda: (host, on, leaf) =>
      // ITS DISPLAY IS READ BACK LIKE A TM VIEW'S PANELS BELOW — stored per leaf, defaulted when absent.
      new LambdaPane(host, on, {
        display: displayOf('lambda', leaf) ?? LEG_DISPLAY.lambda.fallback,
        ...storedPanels(LEG_PANELS.lambda, (name) => panelOpen(leaf, name)),
        sizes: panelSizesOf(leaf) ?? {},
      }),
    rxm: (host, on, leaf) =>
      new RxmPane(
        host,
        on,
        storedPanels(LEG_PANELS.rxm, (name) => panelOpen(leaf, name)),
        panelSizesOf(leaf) ?? {},
      ),
    tm: (host, on, leaf) =>
      // **EVERY PANEL A VIEW OWNS HAS TO BE READ BACK, NOT JUST THE FIRST ONE.** A panel that writes
      // its state through `on.panel` and is not read here would persist correctly and restore to its
      // default every time. An entry is passed only when it is stored, so each panel keeps its own
      // default.
      new TmPane(
        host,
        on,
        storedPanels(LEG_PANELS.tm, (name) => panelOpen(leaf, name)),
        displayOf('tm', leaf) ?? LEG_DISPLAY.tm.fallback,
        panelSizesOf(leaf) ?? {},
      ),
    clif: (host, on, leaf) =>
      new ClifPane(
        host,
        on,
        storedPanels(LEG_PANELS.clif, (name) => panelOpen(leaf, name)),
        panelSizesOf(leaf) ?? {},
        displayOf('clif', leaf) ?? LEG_DISPLAY.clif.fallback,
      ),
  }

  /**
   * Build `leaf`'s view of `kind` in `host`, bound to `session`, and enter it in `panes`: what `applyLayout`'s creation
   * pass does for each leaf that has no view.
   *
   * **THE ONE CAST CLAIMS THE VIEW `PANE_BUILD` MADE IS THE ONE `K`'S ENTRY HOLDS**, `seedLeg`'s claim in the other
   * direction, and that this `K`'s entry is one `PaneCollection.add` takes. Both follow from one class per leg, which
   * `tsc` cannot follow through a generic `K`. The `satisfies` before it checks every other field of the entry.
   */
  const buildPane = <K extends Leg>(kind: K, leaf: LeafId, session: SessionId, host: HTMLElement): void => {
    const slot = new PaneSlot(kind, session)
    const pane = PANE_BUILD[kind](host, paneEvents(leaf, slot), leaf)
    // **A NEW TM PANE IS SEEDED FROM ITS SESSION, BECAUSE THE REPLY THAT WOULD HAVE TOLD IT HAS
    // ALREADY BEEN AND GONE.** Unseeded, a pane created after its session's last `compiled` reply would
    // render no tapes, no status line and no δ-rows until something recompiled — the whole machine
    // missing from a pane the user just asked for. Seeded here rather than at the gesture because every
    // route to a new pane comes through this function — a split, a cross-leg pick (which drops the entry in
    // pass 1 and arrives back here under the same leaf id), and `reset preset`. Seeding at one route
    // instead would leave the others blank for no reason a reader could infer.
    //
    // **`reset preset` IS A ROUTE ONLY WHERE THE TREE ACTUALLY LOST A TM PANE, WHICH IS NARROWER THAN "it
    // rebuilds the panes".** Pass 1 drops an entry when `live.get(p.id) !== p.kind`, so a `tm-0` that is still a
    // live TM pane survives the reset untouched and never reaches this line. Close that pane or point its leaf at
    // another leg, and the reset re-mints `tm-0` — a leaf with no entry, arriving here long after the session's
    // `compiled` reply, which is the same stale-blank state a split produces.
    //
    // A LAYOUT RESTORED FROM `localStorage` COMES THROUGH THIS FUNCTION TOO AND IS NOT ONE OF THOSE
    // ROUTES, WHICH IS WORTH SAYING BECAUSE IT LOOKS LIKE ONE. It runs at page load, before anything
    // has compiled, so the session holds nothing and the seed tells a fresh pane the `null`s it already
    // holds, rather than repairing anything.
    //
    // **A SESSION WITH NOTHING COMPILED PUSHES `null`.** A pane one statement old is already in that
    // state, so here the pushes redraw an empty table and change nothing. They are made anyway because
    // `SEED.tm` is also the same-leg `rebind` arm's seed, where the pane is NOT fresh and a skipped
    // `null` would leave the previous session's machine on screen; one function for every route is what keeps them
    // from disagreeing about what a pane is told.
    SEED[kind](pane, session)
    panes.add({ id: leaf, kind, slot, pane, host } satisfies Omit<PaneEntry<K>, 'pane'> & {
      readonly pane: LegPane[K]
    } as unknown as Parameters<PaneCollection['add']>[0])
  }

  /**
   * The session a leaf with no pane yet should be bound to, consulted once by `applyLayout`'s
   * pane-creation loop and then discarded.
   *
   * **THE GESTURES THAT ASK THIS ASK THE SAME THING**: a SPLIT, about an id that did not exist a statement
   * ago, and a cross-leg REBIND, about an id that did — the leaf survives a kind
   * change, but its `PaneEntry` does not (`applyLayout`'s pass 1), so pass 2 reaches a leaf with no pane
   * and no way to know which pair the user picked. Without an entry here the rebind would land on
   * `SOURCE_SESSION`, which is the session the user was on only by coincidence.
   *
   * **A SPLIT CARRIES THE SESSION THAT WAS PICKED.** The control is a menu of `(leg, session)` pairs, so `split` below
   * writes `choice.session`, and the inherited case is the menu's first entry. The map exists because the layout tree
   * does not carry a binding (`layout.ts`'s own doc: "the runtime pairing lives in `panes.ts`, keyed by `LeafId`"), so
   * this is what lets a gesture name a session before `applyLayout` constructs the `PaneSlot` that holds that fact for
   * real. Without it every split would land on `SOURCE_SESSION` regardless of what was asked for.
   *
   * A `'source'` SPLIT WRITES NOTHING HERE, and `split`'s own doc says why: that leaf has no `PaneSlot`
   * for a session to belong to.
   */
  const pendingBinding = new Map<LeafId, SessionId>()

  /**
   * The host element for `id`, created on first request and kept forever after.
   *
   * KEPT RATHER THAN REBUILT, WHICH IS DESIGN §4.3's DETACH-NOT-DESTROY RULE AT THE APP LAYER: a host
   * rebuilt on close would take the CodeMirror instance with it. `renderLayout` only ever appends, so a
   * host that leaves the tree is simply not appended and its live view waits in this map.
   *
   * **`kind` IS READ ONLY ON THE CREATING CALL, AND THAT IS WHY `applyLayout` WRITES `dataset.kind`
   * ITSELF.** A leaf that changes leg arrives here with a different kind and gets the SAME element back
   * — returning the existing host is the whole point of this function — so an attribute set only in the
   * branch below would go on describing the pane this host used to hold.
   *
   * **IT IS ALSO WHERE "WHICH PANE IS THE USER WORKING IN" GETS ITS ONE ANSWER.** `PaneCollection.active`
   * — the view each leg's running focus is read from once a leg holds more than one view of the program
   * (`draw.ts`) — reads the mark the listener below writes, and that listener is the mark's only writer;
   * with no mark, `active` falls back to insertion order, and the surfaces it drives narrate whichever
   * pane happened to exist earliest.
   */
  const hosts = new Map<LeafId, HTMLElement>()
  const hostFor = (id: LeafId, kind: PaneKind): HTMLElement => {
    const existing = hosts.get(id)
    if (existing !== undefined) return existing
    const el = document.createElement('section')
    el.className = 'pane'
    el.dataset.leaf = id
    el.dataset.kind = kind
    // **`focusin` RATHER THAN `focus`, BECAUSE IT BUBBLES.** One listener on the section catches focus
    // landing anywhere inside the pane — including inside a CodeMirror instance, whose focusable
    // descendants this module never sees — where `focus` would need a listener per descendant and a new
    // one every time a pane's contents changed (which is every leg change: the incoming pane's
    // constructor ends in `host.replaceChildren(…)`).
    //
    // **ON THE CREATION BRANCH, NOT BELOW THE EARLY RETURN.** Hosts are kept forever and `hostFor` is called for every
    // leaf on every `applyLayout` — after the creation pass, for every leaf, and from the creation pass for the leaves
    // that have no pane yet, so a leaf that already has one is reached once per gesture and a leaf being built is
    // reached twice. Wiring here rather than after that `return` is what makes it one listener per pane instead of one
    // per layout gesture.
    //
    // THE SOURCE PANE NEVER GETS ONE, AND THAT IS THE RIGHT ABSENCE RATHER THAN AN ACCIDENT OF
    // `seedHost` RUNNING FIRST. Clicking into the source editor must not blank out which λ pane the
    // source editor's focus mark is read from — `active` is per leg precisely so it cannot, and the source
    // pane is on no leg. (`markActive` would ignore the id anyway: `applyLayout` never builds a `PaneEntry`
    // for it.)
    //
    // `markActive` TAKES THE `LeafId` AND LEAVES THE LEG TO THE COLLECTION, which is what keeps `panes.ts`
    // free of the DOM: this listener knows only which host fired, and the collection already holds the
    // entry that says which leg that is.
    //
    // THE DRAW IS WHAT REPAINTS THE RUNNING FOCUSES FROM THE NEWLY ACTIVE PANE. It is a full frame for a
    // focus click, which is the same cost every transport click already pays; `active`'s fallback makes
    // the whole listener a no-op in outcome for a leg holding one pane.
    //
    // **THE DRAW CAN MOVE THE FOCUS.** `step-controls.ts`'s `update()` hands the focus on (`focus-handoff.ts`'s
    // `handOff`), and it runs from `PaneSlot.render` and so from `draw()` itself, so that a control that
    // disappears under the keyboard does not take the focus with it (umbrella rule 5, Plan 7 part 2 spec §11).
    //
    // **THE DRAW RUNS INSIDE ITS `focusin`, AND THAT RE-ENTRANCY IS BOUNDED BY THE HANDOFF'S OWN GUARD.** It fires
    // only when `focusHolder` names the departing control, in that same view: the control has the
    // focus, or a rebuild that gives it the focus back has left the focus on `<body>`. So the `focusin` it provokes
    // names the leaf the focus was already on: `markActive` and `setFocused` are both no-ops, and the nested draw
    // terminates at depth 2 because the departing control no longer has the focus and the guard is false on the way
    // back through. A handoff that moved focus to a DIFFERENT leaf would not have that argument, which is why the guard
    // is the thing to keep.
    el.addEventListener('focusin', () => {
      panes.markActive(id)
      setFocused(id)
      draw()
    })
    hosts.set(id, el)
    return el
  }

  /**
   * Whether the add `build` makes may go ahead: `true`, or `false` with the refusal reported and nothing changed — the
   * first statement of `split`, and so asked in tiles alone, since the Stage offers no split (`draw.ts`).
   *
   * **THE TREE ON SCREEN IS NOT COUNTED APART FROM THE LIVE VIEWS.** Every leaf of it is a live view, so a tree of 64
   * leaves is 64 live views or more and is refused by the first line. The one add that line lets through at the
   * bound is the source view's while the source view is live, which is offered only where the tree on screen does not
   * hold it: a remembered arrangement does, and the tree is a leaf or more short of the live views. `addRefusal`
   * asks `layout.ts`'s `holdsMostLeaves` first, as that module's own refusal, and answers `'full'` to no call made
   * from here.
   *
   * **IN TILES THE ONE PIXEL IS `root`'s BOX, AND NO VIEW IS MEASURED.** `layout.ts`'s `addRefusal` works the add out on
   * the tree's fractions drawn into `#views`, with `DIVIDER_PX` between siblings. Every view is on the page in tiles, so
   * measuring each would answer the same; the arithmetic is kept because it needs no element but one, and is a value
   * a node test can hold.
   *
   * **EVERY ADD IS HELD TO THE FLOOR ON WIDTH, AND `'column'`, A SPLIT DOWN, ON HEIGHT TOO** (`addRefusal`'s doc): a
   * split down makes a view as narrow as the one it halves, which the floor is about, and is the one add that
   * makes a view shorter.
   *
   * **A REFUSAL CHANGES NOTHING BUT THE NOTICE LINE**: the tree, storage, the focused view and the leaf counter are as
   * they were (`addRefusal` hands `build` an id of its own), and no `added` is said.
   *
   * **`takes` IS THE ID THE ADD GIVES ITS LEAF WHERE THAT IS KNOWN BEFORE ONE IS MINTED**: `SOURCE_LEAF` for the source
   * view, and `null` for every other, whose id is a new one. The source view's id is live wherever an arrangement
   * remembers it, and adding it to the tree on screen then adds no view to the workspace. Asked only how many were
   * live, the bound would refuse the source view at 64 with the source view among them.
   */
  const admit = (
    leaf: LeafId,
    gesture: AddRefused['gesture'],
    build: (newId: LeafId) => LayoutNode,
    takes: LeafId | null,
  ): boolean => {
    let why: AddRefusal | null
    // **THE BOUND IS ON EVERY LIVE VIEW** (the view layouts spec §5.6): a view a remembered arrangement holds is kept
    // alive off the page, and a stored workspace is refused past the bound on all of them together.
    const live = liveLeaves()
    const adds = takes === null || !live.has(takes)
    if (adds && live.size >= MAX_TREE_LEAVES) why = 'full'
    else {
      const area = root.getBoundingClientRect()
      const divides = gesture === 'column' ? 'height' : 'width'
      why = addRefusal(getTree(), build, divides, { width: area.width, height: area.height }, DIVIDER_PX)
    }
    if (why === null) return true
    refused({ leaf, gesture, why })
    return false
  }

  /**
   * A pane's events, including the layout gestures the pane itself cannot answer.
   *
   * THE LEAF ID IS CLOSED OVER HERE RATHER THAN PASSED THROUGH THE PANE, which is why `PaneEvents`'s
   * members below take no `LeafId`. A pane does not know its place in the tree and does not need to;
   * this closure is the one place that pairs a pane with its leaf.
   */
  const paneEvents = <K extends Leg>(id: LeafId, slot: PaneSlot<K>): PaneEvents => {
    const base = transport.events(slot)

    /**
     * Split `id` and create the pane `choice` names — the sibling of `rebind`'s cross-leg arm below, and
     * the same statements in the same order: record what the new leaf starts on, rewrite the tree, let
     * `applyLayout` build the pane the tree now names.
     *
     * **IT ENDS IN `focusPane` TOO.** A split's own controls survive it — `viewMenu` builds its buttons once
     * and `renderLayout` MOVES hosts rather than rebuilding them — but surviving the gesture is not the same
     * as answering it.
     *
     * Every other gesture in this closure ends with focus somewhere the user asked to be: `close` names the
     * view `neighbourOf` answers, `rebind`'s cross-leg arm names the leaf itself. Without its `focusPane`, a
     * split would drop the user on `<body>`, one Tab from the top of the document, having just asked for a pane.
     *
     * **IT NAMES WHAT IT CREATED, WHICHEVER ARM RAN.** The minting arm passes `newId`; the source arm
     * passes `SOURCE_LEAF`, which is the same literal it just put in the tree and therefore the host
     * `main.ts` seeded — see the paragraph below for why reusing that id is what makes the program come
     * back at all. Called AFTER `applyLayout`, because `focusPane` resolves through `hosts` and the leaf
     * has no host until that call has run.
     *
     * **A `'source'` CHOICE RECORDS NO PENDING BINDING, because the source leaf has no `PaneSlot`** — it
     * is chrome around the one editor `main.ts` owns, which is the same statement `applyLayout`'s
     * creation pass makes with `if (l.pane === 'source') continue`. An entry written for it would name a
     * leaf that pass never reaches, and would sit in the map until some later leaf happened to be minted
     * under the same id.
     *
     * **AND IT REUSES THE LITERAL LEAF ID `'source'` RATHER THAN MINTING ONE, WHICH IS WHAT MAKES THE
     * PROGRAM COME BACK.** `hostFor` returns the host already held under an id and builds a fresh empty
     * `<section>` for one it has not seen, and the source pane's host is `main.ts`'s own: it holds
     * `#editor`, the live CodeMirror instance, and the close control, seeded into `hosts` under `'source'`
     * before `applyLayout` ever ran (`seedHost`). A `pane-${n}` leaf would therefore have come back as an
     * EMPTY pane while the user's program sat in a detached host nothing could reach again — `hostFor`'s
     * detach-not-destroy rule kept for a key nobody would ask for. The id is a constant everywhere else for
     * the same reason (a default arrangement's leaf, `main.ts`'s close handler, `seedHost`'s key), so this
     * is that constant being honoured rather than a new one invented here. `splitLeaf` refuses a `newId`
     * already in the tree, and `sourceAvailable` — the condition the menu offers this choice under — is
     * exactly "no source leaf in the tree", so the two agree by construction.
     *
     * NO `draw()`: `applyLayout` ends in one, after the panes and the tree agree. Same as every other
     * handler here.
     */
    const split = (dir: Dir, choice: PaneChoice): void => {
      // A HALF UNDER THE FLOOR, OR A 65TH LIVE VIEW, IS REFUSED BEFORE ANYTHING IS RECORDED — `admit`'s doc.
      //
      // **AND THE FOCUS GOES BACK INTO THE VIEW IT WAS CHOSEN ON, OR IT FALLS TO `<body>`**: the pair the focus is
      // on leaves with the menu, and `hidePopover()` hands it back to nothing, so a successful split is saved only
      // by its own `focusPane(created)` below. A refused one creates nothing, and the view the user was working in
      // is where it still is.
      const kind = choice.kind
      const takes = kind === 'source' ? SOURCE_LEAF : null
      if (!admit(id, dir, (newId) => splitLeaf(getTree(), id, dir, newId, kind), takes)) {
        focusPane(id)
        return
      }
      let created: LeafId
      if (choice.kind === 'source') {
        created = SOURCE_LEAF
        setTree(splitLeaf(getTree(), id, dir, SOURCE_LEAF, 'source'))
      } else {
        created = nextLeafId()
        pendingBinding.set(created, choice.session)
        setTree(splitLeaf(getTree(), id, dir, created, choice.kind))
      }
      applyLayout()
      focusPane(created)
      layoutChanged({ kind: 'added', leaf: created, shows: choice })
    }

    return {
      ...base,
      // **EVERY GESTURE HERE THAT REBUILDS THE LAYOUT PUTS THE FOCUS BACK.** `renderLayout`'s
      // `root.replaceChildren()` detaches every child of `root`, and detaching the subtree holding
      // `document.activeElement` drops focus to `<body>`; its one rescue matches `.layout-divider` by
      // `data-path`/`data-index`, which no control inside a host has. That is why `split`, `close`, the cross-leg
      // rebind arm and `main.ts`'s source-view close all end by moving the focus into a view (`focusPane`, or
      // `focusView`, which ends in it). Spec §11's "Focus never falls to `<body>`" is categorical.
      //
      // **WHAT `shut()` LEAVES BEHIND IS THE PRE-OPEN ELEMENT, NOT THE INVOKER AND NOT THE ITEM.**
      // `hidePopover()` restores focus to whatever held it before the popover opened, so a menu item never strands
      // the focus by itself; what strands it is a handler rebuilding the tree underneath the element that restoration
      // just targeted. That is also why the same-leg arm of `rebind` below needs no such call: it rebuilds no layout,
      // so nothing detaches what the restoration targeted.
      //
      // **THE PICK, SPLIT BY ITS LEG — and the cross-leg arm is what makes a pane able to change what
      // it shows at all.** The selector offers `pairs()`, every `(leg, session)` pair in the registry,
      // to every pane (`PaneSlot.render`), so a pick can name the leg this pane does not render. The
      // same-leg arm is `transport.ts`'s handler untouched: one field write on the slot and a draw,
      // which is where that draw's own argument lives.
      //
      // **THE CROSS-LEG ARM REPLACES THE ENTRY RATHER THAN WIDENING THE SLOT, WHICH IS DECISION 1 AND
      // NOT AN IMPLEMENTATION CHOICE MADE HERE.** `PaneSlot<K>`'s leg has no writer anywhere in the app
      // (see its own doc for what `Binding<K>`'s type property buys and what a writer would cost), and
      // a `LambdaPane` cannot render `TmState` under any implementation — so the view is torn down and
      // rebuilt whichever way this is done. `setLeafKind` keeps the leaf's id, its place among its
      // siblings and every size (its own doc: that is what makes a leg change different from
      // close-then-split), and `applyLayout`'s two passes below do the rest: pass 1 drops the entry
      // whose kind no longer matches its leaf, as a close does, and pass 2 builds the pane the leaf now names.
      //
      // `pendingBinding` ANSWERS THE SAME QUESTION IT WAS BUILT FOR, ONE GESTURE EARLIER. It exists to
      // tell a freshly SPLIT leaf which session to start on; a leaf whose kind just changed is asking
      // the identical question about an id that already exists, and without it pass 2's
      // `?? SOURCE_SESSION` would land the new pane on the source session rather than on the session
      // the user picked. Written and consumed by the very next pass, like every other entry in it.
      //
      // NO `draw()` ON THIS ARM: `applyLayout` ends in one, after the panes and the tree agree.
      //
      // **`focusPane` FOR THE REASON `close` TAKES IT, AND THIS ARM IS THE WORSE CASE OF THE TWO.**
      // `focusPane`'s own doc argues that a control which removes the clicked element UNCONDITIONALLY must
      // not be left stranding focus on `<body>`, "the list's worst instance". A cross-leg pick
      // is exactly that shape: `applyLayout` reaches the new pane's `host.replaceChildren(…)`, which
      // destroys the title the user is picking with, and its menu — a keyboard user who arrows to a TM pair
      // and presses Enter loses the page. `renderLayout`'s own focus rescue does not cover it: that one
      // restores `.layout-divider` elements by `data-path`/`data-index` and nothing else.
      //
      // IT TARGETS `id`, NOT A NEIGHBOUR, and that is the difference from `close`. The pane is still
      // there — same leaf, same place, same size — so the thing the user was pointing at has not moved;
      // it is showing something else. `focusPane` takes the first enabled control in the host, which
      // for every view's pane class is the title-selector itself (first in the view's header, ahead of
      // every other button), so focus lands back on the control the pick was made with.
      rebind: (choice: Binding<Leg>) => {
        if (choice.leg === slot.binding.leg) {
          // **THE VIEW IS RESEEDED FROM THE SESSION IT IS PICKED ONTO**, for `SEED`'s reason, BEFORE `base.rebind`: the
          // `draw()` inside it then renders the session's frame against the session's program. `panes.get(id)` rather
          // than a captured pane, because `paneEvents` is built during `applyLayout`'s creation pass, before
          // `panes.add` for this leaf has run.
          const entry = panes.get(id)
          if (entry !== undefined) seedPane(entry, choice.session)
          base.rebind(choice)
          return
        }
        pendingBinding.set(id, choice.session)
        setTree(setLeafKind(getTree(), id, choice.leg))
        applyLayout()
        focusPane(id)
        layoutChanged({ kind: 'switched', leaf: id, shows: { kind: choice.leg, session: choice.session } })
      },
      splitRow: (choice: PaneChoice) => split('row', choice),
      splitColumn: (choice: PaneChoice) => split('column', choice),
      close: () => {
        const neighbour = neighbourOf(getTree(), id)
        const showed: PaneChoice = { kind: slot.binding.leg, session: slot.binding.session }
        setTree(closeLeaf(getTree(), id))
        focusView(neighbour)
        layoutChanged({ kind: 'closed', leaf: id, showed })
      },
      panel: (name: string, open: boolean) => {
        setPanel(id, name, open)
        persist()
      },
      panelSizes: (sizes: Shares) => {
        setPanelSizes(id, sizes)
        persist()
      },
      display: (d: LambdaDisplay) => {
        setLegDisplay('lambda', id, d)
        persist()
      },
      tmDisplay: (d: TmDisplay) => {
        setLegDisplay('tm', id, d)
        persist()
      },
      clifDisplay: (d: ClifDisplay) => {
        setLegDisplay('clif', id, d)
        persist()
      },
    }
  }

  /**
   * Give `el` the keyboard focus after a rebuild that left it nowhere or took it from `el` — every focus this module
   * moves, each the consequence of a gesture and none the gesture itself.
   *
   * **A POINTER'S GESTURE SCROLLS NOTHING, AND A KEY'S BRINGS WHAT IT FOCUSED INTO SIGHT** (the view layouts spec
   * §4.5). A pointer user was reading the view the focus goes to, and is shown no focus ring that could be out
   * of sight; a keyboard user has to see where the focus is. A bare `focus()` scrolls its element into sight for
   * both, and the first control of a view is in its header, which scrolls with the view.
   * `tests/browser/focus-scroll.test.ts` holds both halves.
   *
   * **`:focus-visible` SAYS WHICH GESTURE IT WAS.** In Chromium a button focused from here matches it after
   * `Ctrl+.` and a view key, and does not after a pointer press, one that followed a click in an editor and one
   * that followed typing in it included.
   *
   * **AN EDITOR IS IN SIGHT WHERE ITS CARET IS, AND ITS BOX IS NOT WHAT IS ASKED FOR.** An editor is as tall as its
   * text, taller than its view where the view scrolls, and `scrollIntoView` on a box that does not fit brings an edge
   * of it to the view's. So an editor is asked to bring its selection into sight, which moves nothing while the
   * caret shows.
   *
   * **AN EDITOR MATCHES `:focus-visible` WHATEVER GAVE IT THE FOCUS, SO A CALLER THAT KNOWS ITS GESTURE WAS A
   * POINTER'S SAYS SO** (`pointer`). A pressed button has taken the focus by the time its gesture runs, so a press
   * reaches here with a button; a divider's press moves no focus (`layout-view.ts`'s `divider` prevents it, so a drag
   * selects no text), and its drag reaches here with whatever had the focus, an editor among them. Left to
   * `:focus-visible`, a pointer's drag of the divider beside an editor would scroll that editor's view to its caret.
   *
   * **AN EDITOR IS FOCUSED BY ITS OWN `focus()`, WHICH WRITES ITS SELECTION BACK AS IT FOCUSES, AND SCROLLS NOTHING.**
   * An editor that left the document comes back with no selection in it, and the browser puts one at the start of its
   * text when the DOM's `focus()` focuses it. CodeMirror puts back the one its state holds only where it hears of the
   * change within 200 ms of the focus (`@codemirror/view` 6.43.15, `readSelectionRange`), and takes the start of the
   * text for the user's caret after that. With the DOM's `focus()`, a key's gesture would be saved by the `dispatch`
   * below, which writes the selection too, and a pointer's, which returns before it, would leave the caret at the
   * start of the text.
   */
  const moveFocus = (el: HTMLElement, pointer = false): void => {
    const editor = el.isContentEditable ? EditorView.findFromDOM(el) : null
    if (editor === null) el.focus({ preventScroll: true })
    else editor.focus()
    if (pointer || !el.matches(':focus-visible')) return
    if (editor === null) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    else editor.dispatch({ scrollIntoView: true })
  }

  /**
   * Move focus into `id`'s pane after a layout gesture that left it nowhere: onto its first control, by `moveFocus`,
   * which has what becomes of the view's scroll.
   *
   * **EVERY CALLER NAMES A DIFFERENT LEAF, FOR THE SAME REASON.** `close` passes the view BEFORE the closed one in the
   * tree's order, or the one after it where the closed one was the first (`main.ts`'s `neighbourOf`, whose doc has
   * where that is not the view that took its space), because the pane the user clicked in is gone; `rebind`'s
   * cross-leg arm passes the leaf ITSELF, because that pane is still exactly where it was and only its contents were
   * replaced; `split` passes what it CREATED, which is the thing the gesture was asking for — or, refused, the view
   * it was chosen on, since nothing was created and that view did not move. Each is resolved from what the gesture
   * did to the tree. (Stated without a count of callers, deliberately, per this module's own rule above.)
   *
   * THE ACCESSIBILITY LIST'S ITEM 1, AGGRAVATED PAST EVERYTHING ON IT AND THEREFORE FIXED HERE RATHER
   * THAN FILED. That item is focus stranded on `<body>` after a click. A close control removes the
   * clicked element UNCONDITIONALLY, every time, so leaving this would add the list's worst instance.
   *
   * IT TARGETS A NAMED LEAF, NOT THE FIRST FOCUSABLE THING ON THE PAGE — for a close, the view next to the closed
   * one in the order `Tab` goes through the views, which is often the one that took its space, and not always.
   *
   * `:not([disabled])` CHANGES NO OUTCOME, AND IT STAYS. `viewHeader`'s `frame()` appends `heading, steps,
   * actions`, so the TITLE button — never disabled, and present on every view but the source's — precedes `↺` in
   * DOM order. So the exclusions below are belt-and-braces rather than load-bearing.
   * They stay because what they guard against is a property of the step controls, not of the header's
   * running order: `↺`/`◀`/`▶`/`⏵` are disabled
   * (`controls.ts`'s `canRestart`/`canBack`/`canForward`/`canPlay`) whenever the leg they belong to has
   * no history yet, which is exactly the state a pane can be in the moment this fires. `.focus()` on a
   * disabled control is a silent no-op per the HTML spec, not a thrown error, so without this
   * `document.activeElement` would stay `<body>` even though the call ran. `[hidden]` gets the same treatment
   * for the same reason — the continue button (`step-controls.ts`'s `extend`) is hidden rather than disabled
   * when there is nothing to continue, and a hidden element cannot take focus either.
   */
  const focusPane = (id: LeafId | null): void => {
    if (id === null) return
    const host = hosts.get(id)
    const target = host?.querySelector<HTMLElement>('button:not([disabled]):not([hidden]), select, [tabindex]')
    if (target != null) moveFocus(target)
  }

  /**
   * The whole of "this gesture changed the tree, and THIS is the view it means": record the focus, rebuild,
   * then put the focus there.
   *
   * **THE ORDER IS THE POINT: GOT WRONG, IT STRANDS THE FOCUS ON `<body>`.** `applyLayout()` and then
   * `focusPane(id)` works in tiles: `.focus()` fires `focusin`, `hostFor`'s listener calls `setFocused`, and the
   * workspace catches up with the DOM afterwards. **The stage has no such side channel.** It mounts the host
   * of `focusedLeaf()` and detaches every other, so a layout built before the focus was recorded is built
   * around the OLD leaf — and `.focus()` on the resulting detached host is a spec-defined no-op, so the
   * workspace never catches up either.
   *
   * **IT EXISTS SO THE ORDER CANNOT BE GOT WRONG.** A rule written at each gesture is a rule with a chance to
   * be forgotten at each. `tests/browser/stage-gestures.test.ts` drives one of them, a close of the shown
   * view.
   */
  const focusView = (id: LeafId | null): void => {
    if (id !== null) setFocused(id)
    applyLayout()
    focusPane(id)
  }

  /**
   * Run `rebuild`, **WHICH MUST DEFER NOTHING** (`focus-handoff.ts`'s `keepFocusOn` says why), and give the keyboard
   * focus back to the element under `root` that had it, where the rebuild took it and left the element on the page: by
   * `moveFocus`, told whether the gesture was a `pointer`'s. Answers whether the focus was under `root` to begin with.
   *
   * **A REBUILD TAKES THE FOCUS FROM ANYTHING INSIDE `root`, WHETHER OR NOT ITS VIEW STAYS**: `renderLayout` and
   * `renderStage` take every host off the page and put back the ones they show, which in tiles is every one the tree
   * names and on the Stage the focused view's alone, and an element that leaves the document loses the focus though
   * it comes straight back. A switch's rebuild and a divider's go through here (`switchViews`, `resized`).
   *
   * **NOTHING IS GIVEN BACK TO AN ELEMENT THE RENDER BUILT AGAIN**, a divider or a Stage tab, which is not under
   * `root` once the rebuild is done: the render focuses the new one itself (`switchViews`'s doc).
   * **NOR TO ONE THAT NEVER LOST THE FOCUS**, as in a divider's frames, which rebuild nothing.
   *
   * **THE REBUILD IS RUN BY `rebuilding`, SO THE `blur` IT SENDS AN EDITOR FORMATS NOTHING** (`main.ts`'s
   * `focusKept`): the focus is back in the editor when this returns, and the user did not leave it. Here, for every
   * rebuild that gives the focus back, and in no caller: said by one caller, it would leave another's rebuild — a
   * divider's drag — formatting the editor it gave the focus back to.
   *
   * **IN A `finally`, SO A REBUILD THAT THROWS GIVES THE FOCUS BACK TOO**, to an element still on the page.
   */
  const keepingFocus = (rebuild: () => void, pointer = false): boolean => {
    const held = document.activeElement
    const within = held instanceof HTMLElement && root.contains(held) ? held : null
    try {
      // THE FOCUS IS `within`'s FOR THE REBUILD'S LENGTH (`focus-handoff.ts`'s `keepFocusOn`), so that a step button
      // waiting on a recording is still waiting, and still takes the focus, when it is given it back.
      rebuilding(() => keepFocusOn(within, rebuild))
    } finally {
      if (within !== null && root.contains(within) && document.activeElement !== within) moveFocus(within, pointer)
    }
    return within !== null
  }

  /**
   * A divider's gesture, its frames and its end alike: `act`, with the focus kept where it was.
   *
   * **WITHOUT THIS, A DIVIDER DRAGGED WITH THE POINTER WOULD LEAVE THE FOCUS ON `<body>`.** Its press moves no
   * focus, so the caret stays in the editor it was in for the length of the drag; its end is an `applyLayout`, whose
   * render detaches every host. The frames rebuild nothing and take no focus, and come through here so that the
   * gesture has one answer.
   *
   * **ALWAYS THE POINTER'S HALF OF `moveFocus`'S RULE.** A divider moved with its keys has the focus itself, and is
   * built again by the render, which focuses the new one: nothing is given back here. So whatever is given back was
   * in a view while the pointer dragged, and the view is not scrolled to it.
   */
  const resized = (act: () => void): void => {
    keepingFocus(act, true)
  }

  /**
   * A switch to another combination of views (the view layouts spec §4.5): record the focused view, rebuild, and
   * leave the keyboard focus where it was.
   *
   * **`focusView` MOVES THE FOCUS INTO THE VIEW, AND A SWITCH MUST NOT.** A toggle pressed in the header keeps the
   * focus, so a second toggle is one more press; and a view key pressed from an editor must leave the caret in it.
   *
   * **THE REBUILD TAKES THE FOCUS FROM ANYTHING INSIDE `root`, WHETHER OR NOT ITS VIEW STAYS** (`keepingFocus` has
   * why). So the element is remembered and focused again where its view is still on the page, which is
   * `keepingFocus`, and the focused view takes the focus, as after a close, where it is not.
   *
   * **EACH BY `moveFocus`, SO THE VIEW THE FOCUS COMES BACK IN STAYS WHERE `giveScrollBack` PUT IT WHILE WHAT HAS THE
   * FOCUS IS IN SIGHT**, and is scrolled to it where it is not, which is `moveFocus`'s rule for a key: a view key
   * pressed from an editor whose caret is out of sight brings the caret into sight.
   *
   * **A DIVIDER AND A STAGE TAB ARE BUILT AGAIN BY THE RENDER, WHICH PUTS THE FOCUS BACK ON THE NEW ONE ITSELF**
   * (`layout-view.ts`'s `renderLayout` and `renderStage`, by the divider's path and the tab's leaf). The element that
   * was remembered is then gone for good, and that alone would send the focus into the focused view, off the tab or
   * divider the render has just focused. So the focused view takes the focus only where nothing under `root` has it
   * once the render and `keepingFocus` are done: the view that held it left the page, or the divider or tab did.
   */
  const switchViews = (id: LeafId): void => {
    setFocused(id)
    const within = keepingFocus(() => applyLayout('none', true))
    if (within && !root.contains(document.activeElement)) focusPane(id)
  }

  /**
   * An opened link's rebuild, and its *undo*'s: `focusView`, with every view the tree keeps dropped and built again on
   * the program (Plan 7 part 6a spec §5.3, §5.5).
   *
   * **A NEW WORKSPACE NEEDS EVERY VIEW DROPPED.** A view reads the workspace when it is built — its display, and which
   * of its panels are open — and never again, so a view kept under an id and a kind the new tree shares would go on
   * showing the opener's display and panels under the link's workspace: a λ view left drawn as code where the link's
   * is an outline.
   */
  const rebuildViews = (id: LeafId): void => {
    setFocused(id)
    applyLayout('every')
    focusPane(id)
  }

  /**
   * WHERE EACH VIEW WAS SCROLLED TO, ACROSS A REBUILD — the view layouts spec §5.2.
   *
   * **A REBUILD RESETS EVERY SCROLLER IN EVERY VIEW, ON THE PAGE OR OFF IT.** `layout-view.ts`'s `renderLayout` and
   * `renderStage` take every host off the page and put back the ones they show, which in tiles is every one the tree
   * names and on the Stage the focused view's alone, and an element that leaves the document comes back scrolled to
   * its start.
   *
   * `keepScroll` is called before the hosts are detached and records, for each view on the page, its host and every
   * element inside it that is scrolled; `giveScrollBack` is called once they are appended and puts back each one whose
   * host is on the page again. A host that is not keeps its record until it is, so a view a switch takes off the
   * screen comes back where it was.
   *
   * **THE HOST IS ONE OF ITS OWN SCROLLERS** (`style.css`'s `.pane` is `overflow: auto`): the source view's only
   * vertical one, and any view's whose tile is shorter than what it shows. A walk of what is INSIDE the host would
   * leave it out.
   *
   * **A VIEW BUILT IN THIS REBUILD STARTS AT THE TOP, AND `fresh` IS WHAT SAYS SO.** A new pane is built into the host
   * the view before it had, and the host is not new: it is still at the old view's offset when `keepScroll` reads it,
   * or it still has the record that view left when it went off the page. Given back, either would scroll a view that
   * was never scrolled. So a host in `fresh` is not recorded, and what a record already held for it is dropped. The
   * elements inside the host need no such care: they are new, and the old ones left with the pane that held them.
   *
   * **A PICK IN A VIEW'S TITLE BUILDS A VIEW IN ITS OWN HOST, AND `fresh` COVERS IT WITH THE REST**: `moveFocus`
   * scrolls nothing after a pointer's press, so without `fresh` the new view would open at the old one's offset.
   *
   * **AN OPENED LINK HOLDS NOTHING.** It builds every view again, and it gives the source view, which nothing builds,
   * another program: the source view's host is in `fresh` with the rest, so the link's program opens at its top.
   *
   * **A RECORD IS GIVEN BACK ONCE, TO THE VIEW IT WAS TAKEN FROM.** It is deleted as it is given back, and dropped
   * when a pane is built into its host. `hosts` keeps every host for good (`hostFor`'s doc), so nothing is dropped
   * with one: a view closed with `✕` leaves its record until its leaf is built on again, and until then the record
   * holds elements of a host that is itself kept, with what is in it.
   *
   * **ONLY ELEMENTS STILL IN THE HOST ARE WRITTEN**: a record kept while its host is off the page can name an element
   * the view has since taken out. Each write is `state-table.ts`'s `restoreScroll`, which tells a box that follows
   * the run that the write is not the user's.
   *
   * **IT COSTS ONE WALK OF EVERY ELEMENT OF EVERY VIEW ON THE PAGE, A REBUILD**: 0.9 to 1.4 ms a call on `map-fold`,
   * the costliest shipped example, with all four views shown (1,002 elements under four hosts).
   */
  const scrolled = new Map<HTMLElement, [el: Element, top: number, left: number][]>()
  const keepScroll = (fresh: ReadonlySet<HTMLElement>): void => {
    for (const host of hosts.values()) {
      if (fresh.has(host)) {
        scrolled.delete(host)
        continue
      }
      if (!host.isConnected) continue
      const held: [Element, number, number][] = []
      const keep = (el: Element): void => {
        if (el.scrollTop !== 0 || el.scrollLeft !== 0) held.push([el, el.scrollTop, el.scrollLeft])
      }
      keep(host)
      for (const el of host.querySelectorAll('*')) keep(el)
      scrolled.set(host, held)
    }
  }
  const giveScrollBack = (): void => {
    for (const host of hosts.values()) {
      const held = scrolled.get(host)
      if (held === undefined || !host.isConnected) continue
      scrolled.delete(host)
      for (const [el, top, left] of held) {
        if (!host.contains(el)) continue
        restoreScroll(el, top, left)
      }
    }
  }
  /**
   * Tell the source editor, if this rebuild built its view, that it is at its start.
   *
   * **AN EDITOR REMEMBERS WHERE IT WAS SCROLLED TO, AND PUTS ITSELF BACK THERE WHEN IT IS FOCUSED AT 0**
   * (`@codemirror/view` 6.43.15, `observers.focus`: "When focusing reset the scroll position, move it back to where it
   * was"). It learns its position from the `scroll` events of its own scroll box. For a view that is kept that is
   * harmless, since `giveScrollBack` writes the position it remembers. For one that starts at its top it is not,
   * where a focus reaches the editor before any event has told it of its new position: the source editor is one
   * editor for the page's life, it scrolls a long program inside its own box because it takes a share of its view (the
   * view layouts spec §11.1), and a link's *undo* builds every view again and focuses it in the same task.
   *
   * `tests/browser/focus-scroll.test.ts` has the undo. The event is what the editor listens for, so it is the one
   * way to tell it that needs none of its internals.
   */
  const startEditorsAtTop = (fresh: ReadonlySet<HTMLElement>): void => {
    for (const host of fresh) {
      if (!host.isConnected) continue
      for (const box of host.querySelectorAll('.cm-scroller')) box.dispatchEvent(new Event('scroll'))
    }
  }

  /**
   * The leaves of the tree `applyLayout` last put on the page — what tells a view that has come back from a remembered
   * arrangement from one that was on screen all along. Inside `applyLayout` it is the tree of the call before, until
   * the line that writes it. `main.ts`'s `arranged` asks the tree as it is now.
   */
  let laidOut: ReadonlySet<LeafId> = new Set()

  /**
   * Bring the panes into step with the tree, draw the tree, and store it. `panes.add` and `panes.remove` are called
   * here and nowhere else.
   *
   * **WHICH PANES EXIST IS DECIDED BY FOUR THINGS, AND THE TREE ON SCREEN IS ONE OF THEM.** A pane exists for every
   * leaf of the tree on screen but the source's, which is chrome around `main.ts`'s editor and has no entry. One
   * exists too for a view a switch took off the screen, for as long as `arrangements.ts`'s `liveLeaves` has its leaf
   * as the kind it is (the view layouts spec §5.1). So the passes below read the tree (`getTree`), every live leaf
   * with the kind it is live as (`liveLeaves`), whether this call is a switch's (`parks`), and `laidOut`, the leaves
   * the call before this one drew. `rebuild` set to `'every'` drops each pane those four would keep
   * (`rebuildViews`).
   *
   * **IN THIS ORDER, EACH STEP WHERE IT IS FOR A REASON:**
   *
   * 1. **Every popover open under `root` is closed**, while the view it belongs to is still in the document and
   *    still holds it, so it closes with its events: pass 2 replaces what a host holds, and the render detaches every
   *    host.
   * 2. **Pass 1 drops each pane these rules do not keep**, before pass 2, which can build a pane into the host a
   *    dropped one had, and empties the host as it does.
   *    - A pane whose leaf is in the tree on screen as the pane's own kind is kept, unless `rebuild` drops it.
   *    - A pane whose leaf is not in the tree on screen is kept where `liveLeaves` has the leaf as the pane's kind,
   *      `rebuild` does not drop it, and either the call is a switch's or `laidOut` does not hold the leaf. So a
   *      switch parks the views it takes off the screen, and a view that was already off it stays parked through a
   *      call that is not a switch's.
   *    - Every other pane is dropped: one whose leaf left the tree in this call where the call is not a switch's,
   *      as a `✕` takes one out; one whose leaf is in the tree as another kind; a parked one whose leaf `liveLeaves`
   *      no longer has as its kind; and each one `rebuild` names.
   * 3. **The source view's `✕` is offered where the tree has more than one leaf**, and withdrawn where it has one.
   * 4. **`laidOut` becomes the leaves of this tree.**
   * 5. **Pass 2 builds a pane for each leaf of the tree that has none**, the source's apart. The host is put in
   *    `fresh` and given its kind, and the pane starts on the session `pendingBinding` holds for the leaf, or on the
   *    program. A TM or rxm pane is told what that session has compiled. The source view's host, which no pass builds
   *    a pane into, is in `fresh` from before pass 1 where `rebuild` is `'every'`: an opened link gives that view
   *    another program (`keepScroll`'s doc).
   * 6. **Every leaf of the tree is given its host** (`hostFor`), **each scrolled element of each view on the page is
   *    recorded, the tree is drawn, and the positions are put back** (`keepScroll`, then `renderStage` or
   *    `renderLayout`, then `giveScrollBack`; §5.2). The render takes every host off the page and puts back the ones
   *    it shows, every one the tree names in tiles and the focused view's alone on the Stage, and an element that
   *    leaves the document comes back at its start. A host in `fresh` is not recorded.
   * 7. **`applied()` tells `main.ts` the tree is on the page**, where the header's toggles are brought up to it.
   * 8. **The workspace is stored** (`persist`).
   * 9. **`draw()`**, once the panes and the tree agree and every box is scrolled where it will be shown: a grid
   *    keeps its active row among the rows on screen at each draw, so one drawn before step 6 gave its position
   *    back would move the row.
   *
   * **EVERY HOST IS KEPT** (`hostFor`), **AND WHAT COMES BACK IN IT DEPENDS ON ITS PANE.** A host off the page keeps
   * what it holds. The source view's holds `main.ts`'s editor and no pane, and comes back with it when its leaf does,
   * which is how a closed source view keeps its program. A parked view's comes back with the pane that was kept. A
   * dropped pane's does not come back as it left: its leaf returns with no pane, and the one pass 2 builds into the
   * host replaces what it holds.
   */
  const applyLayout = (rebuild: 'none' | 'every' = 'none', parks = false): void => {
    // **A POPOVER OPEN IN A VIEW IS CLOSED FIRST, WITH ITS EVENTS.** The render below detaches every host, and a
    // popover that leaves the document is shut without a `beforetoggle`: its button would keep
    // `aria-expanded="true"`, and a `⋯` menu showing a split's list would keep the list, so the next press on `⋯`
    // would open on it.
    for (const open of root.querySelectorAll<HTMLElement>(':popover-open')) open.hidePopover()
    // WHAT EACH LIVE LEAF RENDERS, NOT MERELY WHICH LEAVES ARE LIVE — a `Map`, because one reason to drop an
    // entry is about the VALUE. `sourceLayout.update(live.size > 1, ...)` below reads its size, the leaf count.
    const live = new Map(leaves(getTree()).map((l) => [l.id, l.pane]))
    // EVERY LIVE VIEW, THE ONES OFF THE SCREEN INCLUDED — the view layouts spec §5.1. A view a SWITCH took off the
    // screen keeps its entry while a remembered arrangement holds its leaf, as a Stage tab that is not selected
    // keeps its own: its pane, with what it has open, is what a switch back shows.
    const remembered = liveLeaves()
    // THE HOSTS WHOSE VIEW STARTS AT THE TOP, ITS SCROLL NOT HELD — `keepScroll`'s doc: each one pass 2 builds a pane
    // into, and the source view's when every view is built again (`rebuildViews`, for an opened link and its undo).
    const fresh = new Set<HTMLElement>()
    const sourceHost = hosts.get(SOURCE_LEAF)
    if (rebuild === 'every' && sourceHost !== undefined) fresh.add(sourceHost)
    for (const p of panes.all()) {
      // `rebuild` IS THE THIRD REASON: an entry kept by the two below is dropped, whatever it shows (`rebuildViews`).
      const dropped = rebuild === 'every'
      // **TWO REASONS TO DROP AN ENTRY, AND THEY ARE ONE SITUATION FROM HERE.** The leaf left the tree
      // (a close), or the leaf is still there and no longer renders what this entry renders (a leg
      // change through the binding selector — `paneEvents`' `rebind` above). `PaneSlot<K>`'s leg has no
      // writer and a `LambdaPane` cannot render `TmState`, so a leg change is the replacement of the
      // whole entry — slot, pane class and view — under an unchanged `LeafId`; the pane in hand is
      // about to stop existing either way, so one drop covers both without a branch. `live.get` answers `undefined`
      // for a departed leaf, and no `PaneKind` equals that.
      if (live.get(p.id) === p.kind && !dropped) continue
      // **OFF THE SCREEN AND STILL LIVE AS THE KIND IT IS: KEPT** (§5.4). An id is one view of one kind, and
      // `arrangements.ts`'s `liveLeaves` says which: for a view off the screen, the kind the arrangement left last
      // names it as, which is this pane's for as long as that arrangement is remembered. An older arrangement can
      // still name the id as the kind it was before a pick in its title. A switch enters that one under a new id
      // (`reidentified`), so it does not reach the line above holding this pane.
      //
      // **AN ID THAT IS LIVE ONLY AS ANOTHER KIND DOES NOT KEEP THE PANE.** An edit can replace the arrangement that
      // held this view while an older one still names its id as the other kind. No tree holds the view then. Kept
      // on the id alone, it would be a view no tree holds, with no way back to it, until a switch into the older
      // arrangement built the other kind over it.
      //
      // **ONLY A SWITCH PARKS A VIEW. A `✕` CLOSES ONE.** The tree a `✕` left is remembered too, so its leaf is "live"
      // by the same test — but the user closed that view, and a closed view is gone. So an entry leaving the tree in
      // THIS call is kept only when the call is a switch's (`parks`); one already off the screen (`laidOut` does not
      // hold it) stays kept through every other gesture. A view built later where a closed one was is a new view on the
      // program.
      if (!live.has(p.id) && remembered.get(p.id) === p.kind && !dropped && (parks || !laidOut.has(p.id))) continue
      panes.remove(p.id)
    }

    // THE SOURCE PANE'S OWN CLOSE CONTROL, DRIVEN FROM HERE RATHER THAN FROM `draw()`'s PER-FRAME LOOP.
    // That loop is `panes.all()`, and the source leaf has no `PaneEntry` (`applyLayout`'s own `if (l.pane
    // === 'source') continue` below is exactly why) — but `canClose` only changes when the leaf count
    // does, which is only ever true right here, at a structural change, never on a recorded frame during
    // playback. Driving it from `applyLayout` rather than adding a source-shaped special case to `draw()`
    // is answering the fact where it changes rather than threading it through a per-frame path that has
    // no other reason to know this pane exists.
    sourceLayout.update(live.size > 1, false)

    laidOut = new Set(live.keys())

    for (const l of leaves(getTree())) {
      if (panes.get(l.id) !== undefined) continue
      if (l.pane === 'source') continue // the source pane is chrome inside its host, not a PaneView
      const host = hostFor(l.id, l.pane)
      fresh.add(host)
      // **`hostFor` SETS THIS ONCE, AT CREATION, AND A KIND CHANGE REUSES THE HOST — so this line is the
      // only thing keeping `data-kind` truthful.** It is not decoration: a leaf id need not name a leg
      // (`main.ts`'s `nextLeafId` mints `pane-${n}` precisely because a pane can change what it renders),
      // so this attribute is the app's one statement of what a leaf actually shows, and every browser
      // test that asks what a leaf renders selects on it. (Stated without a count, deliberately —
      // `createPaneHost`'s doc makes the same argument about restating an arity.) Redundant on the creation
      // path and load-bearing on the change path, which is why it is unconditional rather than guarded
      // on a kind that "changed".
      //
      // THE HOST'S CONTENTS NEED NO CLEARING AND MUST NOT GET ANY. Each pane constructor calls
      // `host.replaceChildren(…)`, so building the new pane two lines below is what empties this host. A
      // teardown added here would run BEFORE that, against `hostFor`'s detach-not-destroy rule; nothing in the host
      // outlives its pane.
      host.dataset.kind = l.pane
      const session = pendingBinding.get(l.id) ?? SOURCE_SESSION
      pendingBinding.delete(l.id)
      buildPane(l.pane, l.id, session, host)
    }

    for (const l of leaves(getTree())) hostFor(l.id, l.pane)
    keepScroll(fresh)
    // **IF/ELSE, NOT AN EARLY `return`**: the two branches share `persist()` and `draw()` below, so the stage path
    // costs one condition rather than a second copy of the tail.
    if (stage()) {
      // **NO `ResizeHandlers`: A STAGE HAS NO DIVIDERS** (`renderStage`'s own doc). The tree's sizes
      // are untouched, which is what makes flipping back to tiles give the arrangement the user left.
      renderStage(root, getTree(), hosts, {
        focused: focusedLeaf(),
        title: viewTitle,
        // SELECTING A TAB IS A FOCUS CHANGE PLUS A RE-RENDER, and it ends in this function's own
        // `draw()` — spec §5's "selecting a tab calls `draw()` once so the shown view is current".
        select: (id) => {
          setFocused(id)
          applyLayout()
        },
      })
    } else {
      renderLayout(root, getTree(), hosts, {
        // THE CHEAP PATH — NO `renderLayout`, NO PERSIST. Nothing structural changes during a resize:
        // `resize` touches `sizes` on exactly one split node, so no pane is created, destroyed or
        // rebound as a consequence, and rebuilding would destroy the divider performing the gesture.
        // `draw()` STAYS, and it is the one thing here whose output genuinely depends on pane size —
        // the TM pane's δ-table is virtualized against a measured `clientHeight`, so dropping it would
        // show blank space below the last row for the length of the drag.
        resize: (path, index, delta) =>
          resized(() => {
            setTree(resize(getTree(), path, index, delta))
            syncSizes(root, getTree())
            draw()
          }),
        // ONE FULL RECONCILE PER GESTURE, WHICH IS WHERE THE STORAGE WRITE LIVES. Its render takes the focus
        // from whatever is in a view, and `resized` gives it back.
        commit: () => resized(() => applyLayout()),
      })
    }
    giveScrollBack()
    startEditorsAtTop(fresh)
    applied()
    persist()
    draw()
  }

  return {
    applyLayout: () => applyLayout(),
    seedPane,
    focusView,
    switchViews,
    rebuildViews,
    seedHost(id: LeafId, host: HTMLElement): void {
      hosts.set(id, host)
    },
  }
}
