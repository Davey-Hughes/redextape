import type { EditorCustody } from './editor-custody'
import { LambdaPane } from './lambda-pane'
import {
  closeLeaf,
  type Dir,
  type LayoutNode,
  leaves,
  resize,
  SOURCE_LEAF,
  serializeLayout,
  setLeafKind,
  splitLeaf,
} from './layout'
import { renderLayout } from './layout-view'
import type { PaneChoice, PaneEvents } from './pane-chrome'
import type { LeafId, PaneCollection, PaneKind } from './panes'
import type { Leg } from './protocol'
import type { SessionId } from './session-client'
import { type Binding, PaneSlot, type TmCompiled } from './sessions'
import { TmPane } from './tm-pane'

/**
 * THE PANE LIFECYCLE — which panes exist, what element each one lives in, and what its controls do —
 * the cluster `main.ts` held as two `Map`s and four closures visible to nine hundred lines.
 *
 * `pendingBinding` (inside the factory below) never leaves this module, and that is the extraction's
 * point rather than a housekeeping preference: it answers "what session does a leaf with no pane yet
 * start on" — asked by a split and, since panes can change leg, by a cross-leg pick on the binding
 * selector — and every reader of it is inside this module. `hosts` answers the sibling
 * question — "what element is the pane at this leaf mounted in", which outlives the pane so a closed
 * leaf comes back with its editor intact — but it is not private the same way: `applyLayout` hands it
 * to `layout-view.ts`'s `renderLayout` on every call. `renderLayout` only reads it, via `.get()`, to
 * place each leaf's host in the tree it paints; every write to `hosts` still happens in exactly two
 * places, both in this module — `hostFor`'s generic branch below, and `seedHost`, which `main.ts` calls
 * once to seed the source pane's pre-built host before `applyLayout` first runs (`main.ts`'s own
 * `hosts.set('source', sourceHost)` comment at that call is the fact this replaced) — and nowhere
 * else. A `Map` any of `main()`'s lines could write is a `Map` any of them could answer that question
 * differently, which is the property both preserve even though only `pendingBinding` stays unnamed
 * outside this module.
 *
 * **`applyLayout` IS THE ONLY THING IN THE APP THAT CREATES OR REMOVES A PANE**, and moving it did not
 * change that — it is why `PaneCollection` can be handed to `link-wiring.ts`, `draw.ts` and
 * `replies.ts` empty and read live by all three. (`compile.ts` was a fourth until 5d-ii-c decision 2
 * deleted the retire it held; a compile touches no pane at all now.) Its `try`/`finally` is a fix rather than a style
 * (see its own doc): an exception escaping `custody.reconcile()` used to take `renderLayout`,
 * `writeLayoutStorage` and `draw()` with it, leaving the tree, the DOM and `localStorage` disagreeing.
 * It crosses the boundary exactly as it was.
 *
 * THE LAYOUT TREE IS NOT A FIELD HERE. It stays a `let` in `main()` and crosses as the `getTree`/
 * `setTree` pair below, for the reason `pendingBinding` exists at all: a second place the current tree
 * lives is a second answer to what the current tree is. This module reads it on every use and writes it
 * through the setter, so `main.ts` remains the one owner even though nothing else there mutates it.
 *
 * THREE MEMBERS, WHICH IS WHAT `main.ts` ACTUALLY CALLS — and the shorter list is a decision rather
 * than an oversight. The extraction first exported five, adding `hostFor` and `paneEvents`; no caller
 * outside this module ever reached either, because both are used only from inside `applyLayout`.
 *
 * IT IS THE SAME ARGUMENT `deps` MAKES BELOW, POINTED THE OTHER WAY. That doc refuses an unread
 * `SessionRegistry` on the grounds that a dependency taken and never read is a claim about this
 * module's REACH that its body does not make. A member no call site reaches is the mirror of it: a
 * claim about this module's SURFACE that no call site makes. Keeping one and refusing the other would
 * have been the inconsistency, so the review that found it was right to insist they be ruled together.
 *
 * BOTH REMAIN IN SCOPE AS CLOSURES, so nothing inside this file changed and later work is free to
 * modify either. A task editing `hostFor`'s body is not a caller needing `hostFor` exported.
 */
export type PaneHost = {
  /** Reconcile panes to leaves, re-render the tree, persist it, and draw. */
  applyLayout(): void
  /**
   * Move focus into `id`'s pane after a layout gesture that left it nowhere — a close (`main.ts`'s
   * source-pane close is this member's caller from outside the module), a leg change or a split (the
   * module's own `rebind` and `split`). See the implementation for which leaf each passes and why.
   */
  focusPane(id: LeafId | null): void
  /** Pre-seed the source pane's host, which `main.ts` owns the contents of. */
  seedHost(id: LeafId, host: HTMLElement): void
}

/**
 * Build the pane lifecycle over the collection, the custody machinery and the app's layout tree.
 *
 * `root`, `panes`, `custody` AND `transport` ARE TAKEN AS VALUES, `draw` AS A THUNK — the same split
 * `createEditorCustody` and `createLinkWiring` already draw, and forced by the same fact: `main.ts`
 * builds all four of the first group before this call and never reassigns any of them, while `draw` is
 * a `let` that `createDraw` does not fill in until after the panes exist. `panes` is handed over EMPTY,
 * and `applyLayout` below is what fills it.
 *
 * **`getTree`/`setTree` RATHER THAN A `tree` FIELD, AND RATHER THAN A MUTABLE EXPORT.** `main()`'s
 * `let tree` is written by four things — `parseLayout`'s restore, the `reset layout` button, this
 * module's split/close/resize (through `setTree`), and `sourceLayout`'s own close handler, built
 * directly in `main()` because it has no `PaneSlot` and therefore no `paneEvents` to route a `close`
 * gesture through — and nothing else, and only the third group moved. A copy here would have to be
 * pushed back on the other three; an exported binding would put the current tree in two modules at
 * once. A getter read at every use is the shape with one answer.
 *
 * **`sourceSession`, `sourceLayout`, `writeLayoutStorage`, `nextLeafId` AND
 * `neighbourOf` ARE WHAT THE MOVED BODIES REACHED FOR ACROSS THE NEW BOUNDARY, and naming them is the
 * point of listing them separately.** (Named rather than positioned as "the last six", which is what
 * this said until `tmProgramOf` was added below them. That one is not one of them: it answers a
 * question this module asks on its own account rather than restoring a reference `main()`'s scope used
 * to supply for free, and its own doc carries the argument for its shape.) `sourceSession` is
 * `main()`'s one remaining session-id constant — `lambdaScratch` stood beside it until 5d-ii-c decision
 * 1 made a fork mint its own buffer id, and a session named where it is created is not a constant any
 * scope can hand over;
 * `sourceLayout` is the source pane's own close control, which `applyLayout` drives because `canClose`
 * changes only at a structural change and the source leaf has no `PaneEntry` for `draw()` to find;
 * `writeLayoutStorage` is `main.ts`'s guarded `localStorage` writer, kept beside the guarded reader
 * that restores the tree rather than split from it; and `nextLeafId`/`neighbourOf` are module-level in
 * `main.ts` because `leafCounter` is deliberately per-module rather than per-`main()` call and
 * `main.ts`'s own source-pane close control is `neighbourOf`'s other caller.
 *
 * `SessionRegistry` IS NOT A DEPENDENCY, AND THE ABSENCE IS EVIDENCE RATHER THAN AN OVERSIGHT. **NOT
 * BECAUSE NOTHING HERE WOULD READ ONE — `tmProgramOf` below is precisely a read a registry would serve,
 * and this sentence used to rest on the counterfactual that no read existed at all.** Because a
 * registry serves EVERY read: handed one, this module could ask whether a session exists, what legs it
 * has and what it is called, and its dependency list would stop being able to say that it does not. A
 * parameter carries the authority of its TYPE, not of the call sites that happen to exist today, so the
 * absence is only evidence while the thing absent is the general instrument rather than the one answer.
 *
 * **WHICH IS WHY THE MODULE ASKS EXACTLY ONE QUESTION ABOUT A SESSION, AND `tmProgramOf` IS THAT
 * QUESTION RATHER THAN A WAY TO ASK OTHERS.** The paragraph above used to open "Nothing in this module
 * asks a question about a session — a slot carries the binding, `custody` answers the editor questions,
 * and `sessions.has` is `editor-custody.ts`'s call", which stopped being true the moment a newly built
 * `TmPane` had to be seeded with the machine its session already compiled. What did NOT change is the
 * conclusion: the dependency is a function from a `SessionId` to that one retained value, so the body
 * still cannot ask anything else.
 *
 * (Phrased as "this module" rather than as a count of MEMBERS, deliberately: this sentence said "the
 * five members below" until the exported surface became three, and a doc that restates an arity has to
 * be re-read every time the arity moves. The claim is about the body, not the list. **"Exactly one
 * session question" one paragraph up is the exception that shows the rule, and the two only look like a
 * contradiction until the difference is named**: that number is not a description of what happens to be
 * here, it is the CLAIM — the second such question is the thing that has to argue for itself, and a
 * reader who finds the number stale has found a decision rather than a drifted description.)
 */
export function createPaneHost(deps: {
  root: HTMLElement
  panes: PaneCollection
  custody: EditorCustody
  transport: { events<K extends Leg>(slot: PaneSlot<K>): PaneEvents }
  sourceSession: SessionId
  sourceLayout: { update(canClose: boolean, canSplit: boolean): void }
  nextLeafId(): LeafId
  neighbourOf(tree: LayoutNode, id: LeafId): LeafId | null
  getTree(): LayoutNode
  setTree(next: LayoutNode): void
  writeLayoutStorage(raw: string): void
  draw(): void
  /**
   * The machine `session` last compiled, or `null` if it has not compiled one — what a freshly built
   * `TmPane` is seeded with in the creation pass below.
   *
   * **A QUESTION, NOT A REGISTRY** — the module doc above has the argument in full, and this signature is
   * what makes it hold: one `SessionId` in, one retained value out, no way to ask anything else.
   * `main.ts` answers it with `sessions.entryOf(session).tmProgram`, which throws for a session the
   * registry does not hold — the same policy `legOf` states, and unreachable from here for the same
   * reason it is unreachable there: the id this is called with is the one the pane about to be built is
   * bound to, so a missing entry is a wiring bug that `PaneSlot.render` would raise on the very next
   * frame anyway.
   *
   * NULLABLE RATHER THAN A `TmPane`-SHAPED CALLBACK. "Seed this pane" would put the pane class in
   * `main.ts`'s call and give this module a dependency that DOES something rather than one that answers
   * something; the pane is built here, so the push belongs here too.
   */
  tmProgramOf(session: SessionId): TmCompiled | null
}): PaneHost {
  // THE SOURCE SESSION ID KEEPS ITS `main.ts` SPELLING THROUGH A RENAMING DESTRUCTURE, so the bodies
  // below read exactly as they did in the scope they came from — `SOURCE_SESSION` is the name every
  // comment in this file already refers to it by. `LAMBDA_SCRATCH` used to arrive the same way and is
  // gone with the singleton it named (5d-ii-c decision 1): a buffer's id is minted per fork, so there
  // is no scratch-session constant for this module to be handed.
  const {
    root,
    panes,
    custody,
    transport,
    sourceSession: SOURCE_SESSION,
    sourceLayout,
    nextLeafId,
    neighbourOf,
    getTree,
    setTree,
    writeLayoutStorage,
    draw,
    tmProgramOf,
  } = deps

  /**
   * The session a leaf with no pane yet should be bound to, consulted once by `applyLayout`'s
   * pane-creation loop and then discarded.
   *
   * **TWO GESTURES ASK THIS AND THEY ASK THE SAME THING**: a SPLIT, about an id that did not exist a
   * statement ago, and a cross-leg REBIND, about an id that did — the leaf survives a kind change, but
   * its `PaneEntry` does not (`applyLayout`'s pass 1), so pass 2 reaches a leaf with no pane and no way
   * to know which pair the user picked. Without an entry here the second case would land on
   * `SOURCE_SESSION`, which is the session the user was on only by coincidence.
   *
   * **A SPLIT CARRIES THE SESSION THAT WAS PICKED, WHICH IS A CORRECTION TO WHAT THIS PARAGRAPH USED TO
   * SAY.** It read "A SPLIT INHERITS THE SESSION OF THE PANE IT CAME FROM", true while a split had one
   * possible outcome; the control is a menu of `(leg, session)` pairs now, so `split` below writes
   * `choice.session` and the inherited case is the entry labelled `(same)` rather than the only entry
   * there is. What has not changed is why the map exists: the layout tree cannot carry a binding
   * (`layout.ts`'s own doc: "no binding is persistable... the runtime pairing lives in `panes.ts`, keyed
   * by `LeafId`"), so this is what lets a gesture name a session before `applyLayout` constructs the
   * `PaneSlot` that holds that fact for real. Without it every split would land on `SOURCE_SESSION`
   * regardless of what was asked for — which would make "split a forked λ pane" produce a SECOND pane on
   * the SOURCE session rather than a second view onto the same scratch, and
   * `tests/browser/two-lambda-panes.test.ts`'s "moves the one editor" test has no other way to reach two
   * panes bound to one scratch without an explicit rebind.
   *
   * A `'source'` SPLIT WRITES NOTHING HERE, and `split`'s own doc says why: that leaf has no `PaneSlot`
   * for a session to belong to.
   */
  const pendingBinding = new Map<LeafId, SessionId>()

  /**
   * The host element for `id`, created on first request and kept forever after.
   *
   * KEPT RATHER THAN REBUILT, WHICH IS DESIGN §4.3's DETACH-NOT-DESTROY RULE AT THE APP LAYER. Program
   * text is not persisted anywhere, so a host rebuilt on close would take the CodeMirror instance —
   * and the user's program — with it. `renderLayout` only ever appends, so a host that leaves the tree
   * is simply not appended and its live view waits in this map.
   *
   * **`kind` IS READ ONLY ON THE CREATING CALL, AND THAT IS WHY `applyLayout` WRITES `dataset.kind`
   * ITSELF.** A leaf that changes leg arrives here with a different kind and gets the SAME element back
   * — returning the existing host is the whole point of this function — so an attribute set only in the
   * branch below would go on describing the pane this host used to hold.
   *
   * **IT IS ALSO WHERE "WHICH PANE IS THE USER WORKING IN" GETS ITS ONE ANSWER.** `PaneCollection.active`
   * — the pane the ONE source-editor decoration (`draw.ts`) and the ONE status line (`link-wiring.ts`)
   * describe once a leg holds more than one — reads a mark that nothing in the app was setting, so it
   * degenerated to the insertion-order `first` it replaced and those two surfaces narrated whichever pane
   * happened to exist earliest. The listener below is that mark's only writer.
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
    // **ON THE CREATION BRANCH, NOT BELOW THE EARLY RETURN.** Hosts are kept forever and `hostFor` is
    // called for every leaf on every `applyLayout` — from the `finally`, unconditionally, and from the
    // creation pass for the leaves that have no pane yet, so a leaf that already has one is reached once
    // per gesture and a leaf being built is reached twice. (This said "twice per call, in fact" of every
    // leaf, which the creation pass's own `if (panes.get(l.id) !== undefined) continue` contradicts;
    // harmless, since the early return above makes any number of calls register one listener, but it
    // misdescribed the pattern.) Wiring here rather than after that `return` is what makes it one
    // listener per pane instead of one per layout gesture.
    //
    // THE SOURCE PANE NEVER GETS ONE, AND THAT IS THE RIGHT ABSENCE RATHER THAN AN ACCIDENT OF
    // `seedHost` RUNNING FIRST. Clicking into the source editor must not blank out which λ pane the
    // status line is describing — `active` is per leg precisely so it cannot, and the source pane is on
    // neither leg. (`markActive` would ignore the id anyway: `applyLayout` never builds a `PaneEntry`
    // for it.)
    //
    // `markActive` TAKES THE `LeafId` AND DERIVES THE LEG ITSELF, which is what keeps `panes.ts` free of
    // the DOM: this listener knows only which host fired, and the collection already holds the entry
    // that says which leg that is.
    //
    // `draw()` IS WHAT REPAINTS THE TWO SURFACES FROM THE NEWLY ACTIVE PANE. It is a full frame for a
    // focus click, which is the same cost every transport click already pays; `active`'s fallback makes
    // the whole listener a no-op in outcome for a leg holding one pane. NOT RE-ENTRANT WITH A RENDER:
    // nothing `draw()` does moves focus (it dispatches to the source `EditorView` and repaints panes;
    // the only `.focus()` calls in the app are `focusPane` and `renderLayout`'s divider rescue, and a
    // divider is a SIBLING of the hosts, never inside one — the split menu's `autofocus` is the
    // popover's own show algorithm, driven by a click rather than by a paint), so a frame painted here
    // cannot cause the event that painted it.
    el.addEventListener('focusin', () => {
      panes.markActive(id)
      draw()
    })
    hosts.set(id, el)
    return el
  }

  /**
   * A pane's events, including the layout gestures the pane itself cannot answer.
   *
   * THE LEAF ID IS CLOSED OVER HERE RATHER THAN PASSED THROUGH THE PANE, which is why `PaneEvents`'s
   * members below take no arguments. A pane does not know its place in the tree and does not need to;
   * this closure is the one place that pairs a pane with its leaf.
   *
   * `detach`/`showEditor` ARE WRAPPED RATHER THAN LEFT TO `transport.events`, AND ONLY FOR THE λ LEG —
   * `transport.ts` resolves a fork against the registry and the source index, neither of which knows a
   * `LeafId` exists; `editorOwner` is keyed by one, so pairing the two has to happen here, the same
   * division `splitRow`/`splitColumn`/`close` already draw for the layout gestures below them.
   */
  const paneEvents = <K extends Leg>(id: LeafId, slot: PaneSlot<K>): PaneEvents => {
    const base = transport.events(slot)

    /**
     * Split `id` and create the pane the picker was asked for — the sibling of `rebind`'s cross-leg arm
     * below, and the same statements in the same order: record what the new leaf starts on, rewrite the
     * tree, let `applyLayout` build the pane the tree now names.
     *
     * **IT ENDS IN `focusPane` TOO NOW, AND THIS PARAGRAPH USED TO ARGUE THE OPPOSITE — IMPORTANT
     * FINDING, REVIEW OF THE COMMIT THAT ADDED THE PICKER.** It read: a split leaves every control it was
     * performed with in the DOM (`layoutControls` builds its buttons once and `renderLayout` MOVES hosts
     * rather than rebuilding them), so there is no DESTROYED control to answer for, which is the
     * condition `focusPane`'s doc states for its other callers; the `<body>` focus a split leaves behind
     * — `renderLayout`'s `replaceChildren()` detaches the subtree the clicked button is in and the
     * browser blurs it on the way out, then re-appends the same element unfocused — predates the picker
     * and was the accessibility list's item 1 owed a rescue of its own.
     *
     * Surviving the gesture is not the same as answering it, and the distinction is the whole finding.
     * Every other gesture in this closure now ends with focus somewhere the user asked to be: `close`
     * names the pane that grew, `rebind`'s cross-leg arm names the leaf itself. A split was the one left
     * dropping the user on `<body>`, one Tab from the top of the document, having just asked for a pane —
     * and the sibling review in this slice ruled the identical defect Important on the cross-leg path,
     * where the control merely happened to be destroyed as well. `splitControl`'s own doc settles it from
     * the other side: this is a CREATION control with no other route to it, so "building the keyboard
     * path is the fix, not deferring it" — and a handler that completes that gesture by discarding focus
     * abandons the argument one call later.
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
     * PROGRAM COME BACK — found by writing the test for it.** `hostFor` returns the host already held
     * under an id and builds a fresh empty `<section>` for one it has not seen, and the source pane's
     * host is `main.ts`'s own: it holds `#editor`, the live CodeMirror instance, and the close control,
     * seeded into `hosts` under `'source'` before `applyLayout` ever ran (`seedHost`). (It held
     * `#link-status` too until deferred-a11y item 12; that element is app chrome outside every host now
     * — `main.ts` records the argument at the `append`, and the rule this paragraph is about is exactly
     * what took the status line out of the document when the source pane closed.) A
     * `pane-${n}` leaf would therefore have come back as an EMPTY pane while the user's program sat in a
     * detached host nothing could reach again — `hostFor`'s detach-not-destroy rule kept for a key nobody
     * would ask for. The id is a constant everywhere else for the same reason (`defaultLayout()`'s
     * literal, `main.ts`'s close handler, `seedHost`'s key), so this is that constant being honoured
     * rather than a new one invented here. `splitLeaf` refuses a `newId` already in the tree, and
     * `sourceAvailable` — the condition the menu offers this choice under — is exactly "no source leaf in
     * the tree", so the two agree by construction.
     *
     * NO `draw()`: `applyLayout` ends in one, after the panes and the tree agree. Same as every other
     * handler here.
     */
    const split = (dir: Dir, choice: PaneChoice): void => {
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
    }

    return {
      ...base,
      ...(slot.binding.leg === 'lambda'
        ? {
            // THE FIRST-MOUNT HALF OF `editorOwner`. `base.detach` (when it fires at all — the guards
            // inside `transport.ts`'s own handler can decline) REBINDS `slot` SYNCHRONOUSLY, before this
            // wrapper resumes, so `slot.binding.session` already names the new buffer by the time this
            // line runs — checked rather than assumed, because a declined attempt leaves the binding
            // exactly where it was (still the source session), and recording ownership for a fork that
            // never happened would point `editorOwner` at a session with no editor to come.
            //
            // **THE CHECK IS "DID THE BINDING MOVE", WHERE IT USED TO BE "IS IT THE SCRATCH".** It read
            // `if (slot.binding.session === LAMBDA_SCRATCH) custody.claim(LAMBDA_SCRATCH, id)` against
            // `main()`'s one scratch-id constant. 5d-ii-c decision 1 mints a buffer id per fork, so
            // there is no constant left to compare with — and comparing before against after is what
            // that comparison was really asking, since the only thing `detach` can do to this slot is
            // move it onto the buffer it just made.
            detach: (step: number) => {
              const before = slot.binding.session
              base.detach?.(step)
              const after = slot.binding.session
              if (after !== before) custody.claim(after, id)
            },
            // THE MOVE HALF. Only `editorOwner` changes here — `reconcileEditors` (below `applyLayout`)
            // is what actually relocates the mounted `LambdaEditor`, which is what lets this handler stay
            // as small as `PaneEvents.showEditor`'s own doc says it should be: report the click, know
            // nothing else.
            showEditor: () => {
              custody.claim(slot.binding.session, id)
              applyLayout()
            },
          }
        : {}),
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
      // whose kind no longer matches its leaf — handing any editor to `custody` on the way out, exactly
      // as a close does — and pass 2 builds the pane the leaf now names.
      //
      // `pendingBinding` ANSWERS THE SAME QUESTION IT WAS BUILT FOR, ONE GESTURE EARLIER. It exists to
      // tell a freshly SPLIT leaf which session to start on; a leaf whose kind just changed is asking
      // the identical question about an id that already exists, and without it pass 2's
      // `?? SOURCE_SESSION` would land the new pane on the source session rather than on the session
      // the user picked. Written and consumed by the very next pass, like every other entry in it.
      //
      // NO `draw()` ON THIS ARM: `applyLayout` ends in one, after the panes and the tree agree.
      //
      // **`focusPane` FOR THE REASON `close` TAKES IT, AND THIS ARM IS THE WORSE CASE OF THE TWO —
      // IMPORTANT FINDING, REVIEW OF THE COMMIT THAT ADDED IT.** `focusPane`'s own doc argues that a
      // control which removes the clicked element UNCONDITIONALLY must not be left stranding focus on
      // `<body>`, "the list's worst instance in the same slice that writes the list". A cross-leg pick
      // is exactly that shape: `applyLayout` reaches the new pane's `host.replaceChildren(…)`, which
      // destroys the `<select>` the user is operating — a keyboard user who arrows to a TM pair and
      // presses Enter loses the page. `renderLayout`'s own focus rescue does not cover it: that one
      // restores `.layout-divider` elements by `data-path`/`data-index` and nothing else.
      //
      // IT TARGETS `id`, NOT A NEIGHBOUR, and that is the difference from `close`. The pane is still
      // there — same leaf, same place, same size — so the thing the user was pointing at has not moved;
      // it is showing something else. `focusPane` takes the first enabled control in the host, which
      // for both pane classes is the binding selector itself (`paneSelect` anchors it to the `<h2>`,
      // ahead of every button), so focus lands back on the control the pick was made with.
      rebind: (choice: Binding<Leg>) => {
        if (choice.leg === slot.binding.leg) {
          /**
           * **THE SAME-LEG ARM HANDS THE OUTGOING EDITOR TO CUSTODY, AND WITHOUT THIS IT LEAKED —
           * Important finding, review of the deferred-a11y item 11/12 fix.**
           *
           * `LambdaPane.setDetached` tears an editor down only on `!detached`, so it answers the rebind
           * to SOURCE and nothing else; both sides of a scratch→scratch rebind are detached, so it never
           * fires. `reconcileEditors` then skips this pane — its inner loop opens `if
           * (p.slot.binding.session !== session) continue` and the pane no longer names the session whose
           * editor it holds — and the custody pass never sees the view because nothing put it there. The
           * pane went on rendering buffer B's frames with buffer A's live CodeMirror mounted above them,
           * permanently, and `transport.ts`'s `editScratch` reads `slot.binding.session` at EDIT time, so
           * a keystroke in it called `recompile(B, <A's text>)`.
           *
           * DECISION 1 IS WHAT MADE THE GESTURE REACHABLE. While there was one scratch id, "rebound away
           * from the scratch" and "rebound to source" were the same sentence and the teardown was a
           * complete answer. `tests/browser/scratch-rebind-editor.test.ts` drives both rebinds now; it
           * drove only the second, and two doc comments cited it as proof this state was impossible.
           *
           * THE SAME THREE LINES `applyLayout`'s DROP LOOP RUNS, for the same reason and with the same
           * verb: an editor whose pane is going away — by closing, by changing leg, or here by navigating
           * to another buffer — is unmounted and NOT destroyed, because the user may come back for it.
           * `heldEditors` is where it waits, and the claim control (`hasEditor` reads that map first) is
           * how they ask for it.
           *
           * **BEFORE `base.rebind`, WHERE `detach`'s WRAPPER ABOVE ACTS AFTER, AND THE ASYMMETRY IS
           * DELIBERATE.** `detach` checks the binding afterwards because that handler CAN decline (its
           * own guards in `transport.ts`), so "did it move" is a question only the outcome answers. The
           * same-leg rebind cannot decline: this arm has already established the legs match, which is the
           * one thing `transport.ts`'s handler refuses, and what is left is an unconditional
           * `slot.rebind(choice.session)` — so `choice.session` IS the outcome. Acting first is what
           * keeps the `draw()` inside `base.rebind` from painting one frame of the wrong pairing.
           *
           * `panes.get(id)` RATHER THAN A CAPTURED PANE, because `paneEvents` is built during
           * `applyLayout`'s creation pass — before `panes.add` for this leaf has run — and resolving at
           * click time is the only moment the entry is guaranteed to exist. The `kind` check is what
           * makes the cast sound; `slot.binding.leg` would answer the same today, and the entry's own
           * kind is the fact the cast is actually about.
           */
          const leaving = slot.binding.session
          if (choice.session !== leaving) {
            const entry = panes.get(id)
            if (entry?.kind === 'lambda') {
              const held = (entry.pane as LambdaPane).takeEditor()
              if (held !== null) custody.hold(leaving, held)
            }
          }
          base.rebind(choice)
          return
        }
        pendingBinding.set(id, choice.session)
        setTree(setLeafKind(getTree(), id, choice.leg))
        applyLayout()
        focusPane(id)
      },
      splitRow: (choice: PaneChoice) => split('row', choice),
      splitColumn: (choice: PaneChoice) => split('column', choice),
      close: () => {
        const grew = neighbourOf(getTree(), id)
        setTree(closeLeaf(getTree(), id))
        applyLayout()
        focusPane(grew)
      },
    }
  }

  /**
   * Move focus into `id`'s pane after a layout gesture that left it nowhere.
   *
   * **EVERY CALLER NAMES A DIFFERENT LEAF, FOR THE SAME REASON.** `close` passes the neighbour that
   * GREW, because the pane the user clicked in is gone; `rebind`'s cross-leg arm passes the leaf ITSELF,
   * because that pane is still exactly where it was and only its contents were replaced; `split` passes
   * what it CREATED, which is the thing the gesture was asking for. Each is "the place the user is
   * looking", resolved from what the gesture did to the tree. (This doc has been narrowed twice by its
   * own wording — first "after a close", then "after a gesture that destroyed the control it was clicked
   * with" — and the second was already too narrow for `split`, whose controls survive; see that handler's
   * own doc for why surviving the gesture is not the same as answering it. Stated without a count of
   * callers, deliberately, per this module's own rule above.)
   *
   * THE ACCESSIBILITY LIST'S ITEM 1, AGGRAVATED PAST EVERYTHING ON IT AND THEREFORE FIXED HERE RATHER
   * THAN FILED. That item's measured instance is `tm-pane.ts`'s reattach, which strands focus on
   * `<body>` after a click; `[continue]` shares the idiom but survives its own click in the common case
   * because `controls.ts` keeps the button when a run hits `budget` again. A close control removes the
   * clicked element UNCONDITIONALLY, every time, so leaving this would add the list's worst instance in
   * the same slice that writes the list.
   *
   * IT TARGETS A NAMED LEAF, NOT THE FIRST FOCUSABLE THING ON THE PAGE — for a close, the space the
   * departed pane occupied is now the neighbour's, so that is where the user is looking.
   *
   * `:not([disabled])` IS LOAD-BEARING, NOT DEFENSIVE STYLE — found by this task's own Step 8 dry run.
   * A `querySelector('button, ...')` with no exclusion matches the transport strip's `↺` FIRST, in DOM
   * order, ahead of the layout controls this close just repainted — and `↺`/`◀`/`▶`/`⏵` are disabled
   * (`controls.ts`'s `canRestart`/`canBack`/`canForward`/`canPlay`) whenever the leg they belong to has
   * no history yet, which is exactly the state a pane can be in the moment this fires. `.focus()` on a
   * disabled control is a silent no-op per the HTML spec, not a thrown error, so without this the
   * symptom is indistinguishable from the bug Step 8 exists to reproduce: `document.activeElement`
   * stays `<body>` even though the call ran. `[hidden]` gets the same treatment for the same reason —
   * the continue button (`controls.ts`'s `extend`) is hidden rather than disabled when there is nothing
   * to continue, and a hidden element cannot take focus either.
   */
  const focusPane = (id: LeafId | null): void => {
    if (id === null) return
    const host = hosts.get(id)
    const target = host?.querySelector<HTMLElement>('button:not([disabled]):not([hidden]), select, [tabindex]')
    target?.focus()
  }

  /**
   * Reconcile panes to leaves, re-render the tree, and persist it.
   *
   * PANES ARE CREATED AND REMOVED HERE AND NOWHERE ELSE, so "which panes exist" has exactly one answer
   * and it is derived from the tree rather than tracked alongside it.
   *
   * **AN ENTRY IS DROPPED FOR EITHER OF TWO REASONS NOW, AND THE SECOND IS THE LEG CHANGE.** Pass 1's
   * predicate compares what the tree says a leaf renders against what the entry in hand renders, so a
   * leaf that is still present but has changed kind is removed exactly like one that left. That is
   * decision 1's whole mechanism: `setLeafKind` (called from `paneEvents`' `rebind`) keeps the leaf's id,
   * its place and its size, and these two passes then replace the pane inside it.
   *
   * **THE TWO REASONS DIFFER IN EXACTLY ONE WAY, AND IT READS AS A CONTRADICTION UNTIL THE ORDER IS
   * NOTICED.** A close KEEPS the host's DOM — that is `hostFor`'s detach-not-destroy rule, and it is why
   * a closed source pane's program survives (`tests/browser/two-lambda-panes.test.ts`'s "keeps the
   * program"). A kind change REPLACES those contents, because the incoming pane's constructor ends in
   * `host.replaceChildren(…)`. Nothing is stranded by the difference: pass 1 has already handed any
   * editor to `custody` by the time pass 2 constructs the pane that empties the host, and the passes run
   * in that order for reasons that predate this.
   *
   * IT DOES NOT DESTROY A REMOVED PANE'S HOST — see `hostFor`. A closed pane's element leaves the DOM
   * and its entry leaves the collection; the element itself, and any CodeMirror instance inside it,
   * stays in `hosts` and is remounted intact if the leaf returns.
   *
   * **A REMOVED λ PANE'S EDITOR IS TAKEN INTO CUSTODY BEFORE THE PANE LEAVES THE COLLECTION**, which is
   * the ordering the whole fix turns on: after `panes.remove`, nothing can reach that `LambdaPane` to
   * ask it. The host being kept by `hostFor` is no help either — it is kept so that a leaf which RETURNS
   * comes back intact, and a `LambdaPane` built over a returning host rebuilds its children from scratch
   * (`replaceChildren` in the constructor), so the editor left inside the old one is unreachable
   * whichever way the id goes. See `heldEditors` for what this repaired and why the survivor's "bring
   * the term editor to this pane" control was previously offered on a promise it could not keep.
   *
   * A NEW LEAF'S SESSION COMES FROM `pendingBinding`, NOT ALWAYS `SOURCE_SESSION` — see that map's own
   * doc. Consulted and cleared in the same pass. The reason this used to give for the clearing being
   * merely belt-and-braces was "ids are minted once by `nextLeafId` and never reused within a page's
   * life", AND THAT IS FALSE: `reset layout` re-mints `defaultLayout()`'s three literal ids, so an id
   * genuinely can arrive here having been used before (`heldEditors` has the correction in full). What
   * still makes a stale entry unreachable is timing rather than uniqueness — all three writers
   * (`splitRow`, `splitColumn`, and `rebind`'s cross-leg arm) write the entry and call `applyLayout` in
   * the next statement, so every entry is consumed by the pass that follows the write. The clearing is
   * what keeps that a local fact instead of an invariant a future caller has to know. The re-minting
   * itself is answered directly, one line into the loop below: an arriving id drops any `editorOwner`
   * claim recorded against it.
   *
   * `reconcileEditors()` RUNS AFTER PANES EXIST AND BEFORE THE TREE PAINTS — after, because it needs
   * `panes.get` to resolve the panes `editorOwner` names; before painting, though the two are otherwise
   * independent (one moves a `LambdaEditor` inside a host, the other moves hosts inside `<main>`),
   * simply so a split that both creates a new pane AND moves the editor onto it settles in one pass
   * rather than a visible one-frame lag.
   */
  const applyLayout = (): void => {
    // WHAT EACH LIVE LEAF RENDERS, NOT MERELY WHICH LEAVES ARE LIVE — a `Map` where this was a `Set`,
    // because there are two reasons to drop an entry now and the second one is about the VALUE.
    // `sourceLayout.update(live.size > 1, ...)` below is unaffected: a map's size is still the leaf count.
    const live = new Map(leaves(getTree()).map((l) => [l.id, l.pane]))
    for (const p of panes.all()) {
      // **TWO REASONS TO DROP AN ENTRY, AND THEY ARE ONE SITUATION FROM HERE.** The leaf left the tree
      // (a close), or the leaf is still there and no longer renders what this entry renders (a leg
      // change through the binding selector — `paneEvents`' `rebind` above). `PaneSlot<K>`'s leg has no
      // writer and a `LambdaPane` cannot render `TmState`, so a leg change is the replacement of the
      // whole entry — slot, pane class and view — under an unchanged `LeafId`; the pane in hand is
      // about to stop existing either way, which is why the custody handover below covers both without
      // a branch. `live.get` answers `undefined` for a departed leaf, and no `PaneKind` equals that.
      if (live.get(p.id) === p.kind) continue
      // THE CUSTODY HANDOVER, AND IT HAS TO BE ON THIS SIDE OF `panes.remove` — see this function's own
      // doc. `takeEditor()` returns `null` for every λ pane that was not holding one, which is all of
      // them on an ordinary close, so this costs a method call and a field read on the way out.
      if (p.slot.binding.leg === 'lambda') {
        const held = (p.pane as LambdaPane).takeEditor()
        if (held !== null) custody.hold(p.slot.binding.session, held)
      }
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

    for (const l of leaves(getTree())) {
      if (panes.get(l.id) !== undefined) continue
      if (l.pane === 'source') continue // the source pane is chrome inside its host, not a PaneView
      // A LEAF ID ARRIVING FRESH DROPS ANY EDITOR CLAIM RECORDED AGAINST IT — Minor finding, re-review
      // of the whole-branch review's own custody fix, and the behaviour half of the correction
      // `heldEditors`' doc carries above. `reset layout` re-mints `defaultLayout()`'s three LITERAL ids,
      // so a closed `lambda-0` genuinely does come back, and `editorOwner` was still naming it: the
      // moment the user pointed the NEW `lambda-0` at the scratch, `editorHomeFor` resolved it as the
      // editor's home and the next layout gesture delivered the held editor onto a pane that never asked
      // for it — while the "bring the term editor to this pane" control withdrew itself as it arrived.
      // That is the silent relocation design §4.2 and §4.3 both refuse, performed by nobody.
      //
      // **`reset layout` IS NO LONGER THE ONLY WAY AN ID REACHES THIS LINE HOLDING A CLAIM, AND READING
      // IT THAT NARROWLY WOULD OPEN A CRASH PATH.** A leg change drops the leaf's entry in pass 1 and
      // rebuilds it here under the SAME id, so a claim can name a leaf whose next pane is a `TmPane`.
      // This line is what keeps that unrepresentable downstream: it runs for every leaf without a pane,
      // and every such leaf is visited before `custody.reconcile()` is called at all — which is the
      // first of the two facts `editor-custody.ts`'s `editorHomeFor` cites at its `as LambdaPane` cast.
      //
      // A PANE BUILT HERE IS BY DEFINITION NOT THE PANE THAT CLAIMED ANYTHING: every writer of
      // `editorOwner` (`paneEvents`'s wrapped `detach` and `showEditor`) records the id of a pane that
      // already existed when the click landed, so an id reaching this loop can only be inheriting a
      // claim, never restating one. The entry is dropped rather than repointed for the reason
      // `editorOwner`'s own doc gives for never relocating on close: the editor waits in custody, the
      // claim control stays offered on any pane bound to the session, and a click is what moves it.
      // Deleting the current key mid-iteration is defined behaviour for a `Map` — the iterator visits
      // entries in insertion order and simply does not revisit a removed one.
      //
      // AND IT LEAVES THE HELD EDITOR REACHABLE ONLY THROUGH `heldEditors` ITSELF, which is the half of
      // this line that the third review round found missing on the other side. Dropping the claim is
      // right; what was wrong is that `reconcileEditors` then had no domain in which the surviving
      // custody entry appeared, so neither a later home nor its own session's death could reach it. See
      // that function's own doc — its custody pass iterates `heldEditors` for exactly this line's sake.
      custody.dropClaimsOn(l.id)
      const host = hostFor(l.id, l.pane)
      // **`hostFor` SETS THIS ONCE, AT CREATION, AND A KIND CHANGE REUSES THE HOST — so this line is the
      // only thing keeping `data-kind` truthful.** It is not decoration: leaf ids stopped naming a leg
      // (`main.ts`'s `nextLeafId` mints `pane-${n}` precisely because a pane can change what it renders),
      // so this attribute is the app's one statement of what a leaf actually shows, and every browser
      // test that asks what a leaf renders selects on it. (Stated without a count, deliberately — this
      // said "three browser test files" and was four by the time the kind change shipped its own; the
      // module doc above makes the same argument about restating an arity.) Redundant on the creation
      // path and load-bearing on the change path, which is why it is unconditional rather than guarded
      // on a kind that "changed".
      //
      // THE HOST'S CONTENTS NEED NO CLEARING AND MUST NOT GET ANY. Both pane constructors call
      // `host.replaceChildren(…)` — `TmPane`'s is its last statement, `LambdaPane`'s is followed only by
      // a listener bound to one of its own new children — so building the new pane two lines below is
      // what empties this host. A teardown added here would run BEFORE that, on a subtree the outgoing
      // pane's editor may still be inside, and against `hostFor`'s detach-not-destroy rule. The custody
      // handover in pass 1 has already taken that editor; nothing else in the host outlives its pane.
      host.dataset.kind = l.pane
      const session = pendingBinding.get(l.id) ?? SOURCE_SESSION
      pendingBinding.delete(l.id)
      if (l.pane === 'lambda') {
        const slot = new PaneSlot('lambda', session)
        panes.add({ id: l.id, kind: 'lambda', slot, pane: new LambdaPane(host, paneEvents(l.id, slot)), host })
      } else {
        const slot = new PaneSlot('tm', session)
        const pane = new TmPane(host, paneEvents(l.id, slot))
        // **A NEW TM PANE IS SEEDED FROM ITS SESSION, BECAUSE THE REPLY THAT WOULD HAVE TOLD IT HAS
        // ALREADY BEEN AND GONE.** `TmPane.setProgram` is called from `replies.ts` and from nowhere
        // else, so a pane created after its session's last `compiled` reply rendered no tapes, no status
        // line and no δ-rows until something recompiled — the whole machine missing from a pane the user
        // just asked for. Pre-existing rather than this slice's doing, and repaired here rather than at
        // the gesture because every route to a new pane comes through this loop — a split, a cross-leg
        // pick (which drops the entry in pass 1 and arrives back here under the same leaf id), and
        // `reset layout`. Seeding at the picker instead would leave the others blank for no reason a
        // reader could infer.
        //
        // **`reset layout` IS A ROUTE ONLY WHERE THE TREE ACTUALLY LOST A TM PANE, WHICH IS NARROWER THAN
        // "it rebuilds the panes".** Pass 1 drops an entry only when `live.get(p.id) !== p.kind`, so a
        // `tm-0` that is still a live TM pane survives the reset untouched and never reaches this line.
        // Close that pane, or point its leaf at the other leg, and the reset re-mints `tm-0` — a leaf
        // with no entry, arriving here long after the session's `compiled` reply, which is the same
        // stale-blank state a split produces.
        //
        // A LAYOUT RESTORED FROM `localStorage` COMES THROUGH THIS LOOP TOO AND IS NOT ONE OF THOSE
        // ROUTES, WHICH IS WORTH SAYING BECAUSE IT LOOKS LIKE ONE. It runs at page load, before anything
        // has compiled, so the session holds nothing and the seed is a no-op — the case the `null` guard
        // below exists for, rather than a case it repairs.
        //
        // A SESSION WITH NOTHING COMPILED SEEDS NOTHING RATHER THAN PUSHING `null`. `setProgram(null, [])`
        // is what a session that HAD a machine and lost it tells its panes; a pane one statement old is
        // already in that state (`#program`, `#index` and `#frame` all start `null`), so the call would
        // be a redraw of an empty table dressed as a repair.
        const compiled = tmProgramOf(session)
        if (compiled !== null) pane.setProgram(compiled.program, compiled.tapeNames)
        panes.add({ id: l.id, kind: 'tm', slot, pane, host })
      }
    }

    // **`try`/`finally`, AND THE `finally` IS THE WHOLE POINT — IMPORTANT FINDING, THIRD REVIEW ROUND.**
    // `LambdaPane.receiveEditor` throws when it is handed a second editor, deliberately (its own doc: a
    // silent repair would absorb the finding as normal operation). It stays throwing. What changed is
    // what the throw COSTS: `reconcileEditors` is called from the middle of this function, so an
    // exception escaping it took `renderLayout`, `writeLayoutStorage` and `draw()` with it — and every
    // caller is a click handler, so the measured result was a model that had gained a leaf, a DOM that
    // had not, and a `localStorage` entry still holding the previous tree. **The tree, the DOM and
    // storage disagreeing is a worse state than the one the guard is reporting**, and it is one nothing
    // else in this app can repair. The three lines below run either way now; the exception still leaves
    // this function, still reaches `window`'s `error` event, and is still what the tests assert on.
    try {
      custody.reconcile()
    } finally {
      for (const l of leaves(getTree())) hostFor(l.id, l.pane)
      renderLayout(root, getTree(), hosts, (path, index, delta) => {
        setTree(resize(getTree(), path, index, delta))
        applyLayout()
      })
      writeLayoutStorage(serializeLayout(getTree()))
      draw()
    }
  }

  return {
    applyLayout,
    focusPane,
    seedHost(id: LeafId, host: HTMLElement): void {
      hosts.set(id, host)
    },
  }
}
