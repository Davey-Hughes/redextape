import type { LeafId, PaneCollection } from './panes'
import type { ScratchEditor } from './scratch-editor'
import type { SessionId } from './session-client'
import type { SessionRegistry } from './sessions'

/**
 * What custody needs a pane to be able to do — **a shape rather than a class, so the panes satisfy it
 * without importing one another.**
 *
 * `LambdaPane`, `TmPane` and `AsmPane` implement it, the two machine views through the `CopyEditor` they share. A
 * union of the classes would make this module import all of them, and a change to any one's constructor would reach a
 * file that only ever calls these methods.
 *
 * `receiveEditor` TAKES THE SAME `collapsed` SECOND PARAMETER `setEditor` DOES, AND `holdsEditor` IS A
 * MEMBER BESIDE `setEditor`, `takeEditor` AND `receiveEditor`. Both are load-bearing on the two
 * call sites below (`reconcileEditors`'s two `receiveEditor` calls thread `collapsedOf(session)` through
 * so a collapsed buffer remounts collapsed, and `hasEditor` below answers "is a pane already showing
 * one" without unmounting it to find out, which `holdsEditor` alone can do). `flushEditor` is `flush`'s, below.
 */
export type EditablePane = {
  setEditor(text: string | null, collapsed?: boolean): void
  takeEditor(): ScratchEditor | null
  receiveEditor(editor: ScratchEditor, collapsed?: boolean): void
  holdsEditor(): boolean
  /** Send the mounted editor's pending edit now — `ScratchEditor.flush` — and do nothing when none is mounted. */
  flushEditor(): void
}

/**
 * WHERE EVERY SCRATCH `ScratchEditor` IS AND WHERE IT BELONGS.
 *
 * `editorOwner` and `heldEditors` (inside the factory below) are one fact in two containers: which pane
 * each session's editor is claimed by, and where an editor waits while no pane holds it. **NEITHER MAP
 * LEAVES THIS MODULE**, because which domain a loop runs over is where custody goes wrong — a custody
 * entry outliving its session, a re-minted leaf id inheriting a claim, a sweep missing what
 * `reset preset` orphans — and a `Map` any of `main()`'s lines can iterate is a `Map` any of them can
 * iterate over the wrong domain.
 *
 * `panes` AND `sessions` ARE THE ONLY DEPENDENCIES, which is what makes this a module at all: `homeFor`
 * resolves a claim through `panes.get` and checks the pane's own binding, and `reconcile` asks
 * `sessions.has` whether a held editor's session still exists. Nothing here reads the layout tree, the
 * DOM, or the wire — `applyLayout` (`pane-host.ts`'s) is what calls this at the moments the tree
 * changes, and it stays the only thing that knows a tree exists.
 *
 * `reconcile` THROWS, DELIBERATELY, AND ITS CALLER PAYS FOR THAT. `LambdaPane.receiveEditor` refuses a
 * second editor rather than absorbing the mistake; `applyLayout`'s `try`/`finally` (`pane-host.ts`) is what
 * keeps the tree, the DOM and `localStorage` from disagreeing when it fires.
 *
 * **ONE CUSTODY INSTANCE COVERS EVERY LEG, NOT ONE PER LEG.** `hold`/`homeFor` take and return
 * `ScratchEditor`/`EditablePane`, the shapes every editing pane satisfies (see `EditablePane`'s own doc
 * above). `editorOwner` and `heldEditors` are keyed by `SessionId`, and a session has exactly one leg —
 * `SessionRegistry.legOf` throws for the leg a session lacks, so no session can ever have two editors to
 * keep straight. A second instance, one per leg, would put that single fact in two containers for no
 * session to ever disagree between — exactly the split the **NEITHER MAP LEAVES THIS MODULE** paragraph
 * above guards against: a `Map` any of `main()`'s lines can iterate is a `Map` any of them can iterate
 * over the wrong domain, and a second `EditorCustody` would just be a second such `Map` per leg instead
 * of per call site.
 */
export type EditorCustody = {
  /** Take an unmounted editor into custody under the session it belongs to. */
  hold(session: SessionId, editor: ScratchEditor): void
  /** Record that `leaf` is where `session`'s editor should live. */
  claim(session: SessionId, leaf: LeafId): void
  /** Drop any claim naming `leaf` — called when a fresh pane arrives at that id. */
  dropClaimsOn(leaf: LeafId): void
  /** The pane currently showing `session`'s editor, or `undefined`. */
  homeFor(session: SessionId): EditablePane | undefined
  /** Whether `session` has a `ScratchEditor` at all — mounted on its home pane, or waiting here. */
  hasEditor(session: SessionId): boolean
  /** Move held editors onto their claimed homes and retire orphans. Throws, as the doc above says. */
  reconcile(): void
  /**
   * Send the pending edit of `session`'s editor now, wherever it is — held here, or mounted on a view of the copy.
   *
   * **FOR A GESTURE THAT READS A COPY'S RECORD OR PUTS IT TO SLEEP BEFORE ANY EDITOR COMES DOWN.** An editor that
   * comes down sends what it held (`ScratchEditor.destroy`), but a delete reads the record its undo restores before
   * the delete takes the copy's views away, and a pause stores the copy before the frame that takes its editor down —
   * so typing in the editor's debounce would miss both. `main.ts`'s copies-menu handlers call this first.
   */
  flush(session: SessionId): void
}

/**
 * Build the custody machinery over a pane collection and a session registry.
 *
 * BOTH `panes` AND `sessions` ARE TAKEN AS VALUES RATHER THAN THUNKS, unlike `createLinkWiring`'s
 * `view`/`draw`: `main.ts` constructs `PaneCollection` and `SessionRegistry` before this call and never
 * reassigns either, and both are read live through their own methods, so there is no late-binding
 * problem of the kind the thunks there exist to solve. `panes` is handed over EMPTY — `applyLayout` is
 * the only thing that ever populates it — and nothing here reads it before the first `applyLayout()`
 * has run.
 *
 * **`collapsedOf` IS A PLAIN FUNCTION, NOT A `ScratchBuffers` DEPENDENCY.** `reconcileEditors` below
 * hands every editor it (re)mounts to `receiveEditor`'s second parameter, which needs the buffer's own
 * collapsed flag the same way `replies.ts`'s `scratch-compiled` arm already reads it for `setEditor`'s —
 * 5d-ii-d design §4.7's own words are that the flag "rides with the buffer and follows it as custody
 * moves the editor between panes". A `ScratchBuffers` reader would answer the same question but would
 * also hand this module the whole class — forking, cooling, retiring, every buffer's text — where this
 * file's own module doc holds `panes` and `sessions` to be the only dependencies, which is what makes it
 * a module at all. Widening the dependency to serve one field is the mistake `pane-host.ts` argues
 * against where it says `SessionRegistry` is not a dependency, one level up and with `tmProgramOf` as
 * its example: a dependency that answers every question leaves the dependency list unable to say what
 * the module does not ask. `main.ts` supplies `(session) => scratchpad.collapsedOf(session)`.
 */
export function createEditorCustody(deps: {
  panes: PaneCollection
  sessions: SessionRegistry
  collapsedOf: (session: SessionId) => boolean
}): EditorCustody {
  const { panes, sessions, collapsedOf } = deps

  /**
   * Which pane currently holds each scratch session's editor — 5d-i design §4.3's fork, extended by the
   * editor-moves rule (5d-ii-a design §4.3).
   *
   * ONE `ScratchEditor` PER SCRATCH, MOUNTED WHEREVER IT WAS LAST ASKED FOR. Not one instance per pane
   * with a policy keeping copies in step: two uncoordinated CodeMirror instances over one buffer
   * desynchronize between debounces and resolve last-write-wins at recompile, which is a control that
   * provably cannot work, offered anyway. Moving the live view (`LambdaPane.takeEditor`/`receiveEditor`,
   * `reconcileEditors` below) makes that state unrepresentable rather than policed, and cursor,
   * selection and undo survive because nothing is destroyed.
   *
   * CLOSING THE HOLDER UNMOUNTS A λ COPY'S EDITOR WITHOUT REASSIGNING IT. The scratch is a session and no
   * pane's death retires one; the next pane to ask (`showEditor` in `pane-host.ts`'s `paneEvents`)
   * re-mounts the same view. Relocating on close would put the editor somewhere the user did not put it,
   * which is the state 5d-ii-a design §4.2 refuses movement for — `editorHomeFor` below is what makes a
   * stale entry (closed, or rebound away) resolve to "no home" rather than to a fallback pane.
   * `heldEditors` below is where the unmounted view WAITS in the meantime, and without it "the next pane
   * to ask re-mounts the same view" would be a sentence with nothing behind it. A TM or asm copy's editor
   * is not held: closing its view destroys it, and `pane-host.ts`'s `mountOnViewOf` mounts a fresh one,
   * and claims it, on the first view in the tree still showing the copy.
   *
   * **SET THROUGH `claim`.** `paneEvents`'s wrapped `detach` (the first mount, at the moment a fork
   * succeeds) and its `showEditor` (every later move) are gesture-driven writers; `main.ts`'s restore
   * sequence claims a leaf whose session came back bound from `redextape.buffers` — see that call's own
   * doc for why it runs AFTER the first `applyLayout()` rather than beside `seedBinding`, which is what
   * keeps it "a pane that already existed" like those two rather than the stale-on-arrival claim
   * `dropClaimsOn` below exists to catch. A same-leg rebind away from a λ copy leaves the entry stale on
   * purpose, per the paragraph above.
   */
  const editorOwner = new Map<SessionId, LeafId>()

  /**
   * A λ copy's `ScratchEditor` while NO pane holds it — custody between the close of the pane that had
   * it and the claim of the pane that asks for it next.
   *
   * **WITHOUT THIS, CLOSING THE HOLDER STRANDS THE EDITOR.** `applyLayout` drops a closed pane from
   * `panes` before anything asks it for its editor, and `reconcileEditors` only ever iterates the views in
   * `panes` — so the `ScratchEditor` would be left mounted in a host no longer in the tree, with nothing
   * holding a reference that could reach it. Meanwhile the surviving pane, still bound to the scratch and
   * still holding no editor, would have no way to get it back: no pane in `panes` holds it, so
   * `hasEditor` would answer `false` and `LambdaPane.#refreshClaim` would withdraw "move the editor here".
   * **A control that provably cannot work must not be offered.** Rather than withdraw the control, the
   * editor is taken into custody so the control works — which is what 5d-ii-a design §4.3 promises in as
   * many words: "the next pane to ask for the editor re-mounts the same view with its text, cursor and
   * undo intact".
   *
   * KEYED BY SESSION, NOT BY THE CLOSED `LeafId`, because that is the key the next claim arrives under:
   * `showEditor` calls `custody.claim(slot.binding.session, id)` and `reconcileEditors` asks per
   * session. Keying by the closed leaf would be keying by something no claim ever mentions.
   *
   * **A LEAF ID IS A WEAKER KEY THAN A SESSION, NOT MERELY A DIFFERENTLY-SHAPED ONE.** `nextLeafId`
   * only counts up, but it is not the only source of ids: `layout.ts`'s `defaultArrangement` writes `source`,
   * `lambda-0`, `asm-0` and `tm-0` down as literals, and `reset preset` and a combination's first visit mint
   * them again, so a closed `lambda-0` comes back — and `parseWorkspace` can restore any id a stored tree holds. A
   * leaf id can therefore be inherited by a pane that has nothing to do with the one that claimed the editor.
   * `applyLayout`'s pane-creation loop drops exactly that inheritance for `editorOwner` (which IS keyed by leaf)
   * where it happens.
   *
   * NOT A SECOND HOME. Nothing renders from here and nothing reads through it — it is exactly the "one
   * instance, unmounted, not destroyed" state 5d-ii-a design §4.3 describes, made addressable. An entry
   * lives only from the close that produced it to the next `reconcileEditors` that finds a home for it, or
   * to its session leaving the registry, whichever comes first — and BOTH ENDINGS ARE REACHED BY THE SAME
   * FUNCTION. The header list (5d-ii-c design §4.2; its temperature control 5d-ii-d design §4.2) is what
   * supplies the second: `main.ts`'s retire and temperature handlers call `retire` or `cool` and then
   * `reconcile`, in that order. See `reconcileEditors`' own doc.
   *
   * **AND "THE SAME FUNCTION" IS NOT ENOUGH ON ITS OWN.** `reconcileEditors` iterates THIS MAP for its
   * custody pass rather than the claim map, which is what makes the sentence above a fact about the code
   * rather than about the common case: an entry here for a session that holds no claim is an ordinary
   * state — `applyLayout`'s pane-creation loop drops a claim recorded against an arriving leaf id while
   * the entry stays — and a pass driven off `editorOwner.keys()` could not reach it.
   */
  const heldEditors = new Map<SessionId, ScratchEditor>()

  /**
   * The pane currently showing `session`'s scratch editor, or `undefined` if no pane currently is.
   *
   * A LOOKUP THROUGH `editorOwner` GUARDED BY THE PANE'S OWN BINDING, NOT A BARE MAP READ. Closing the
   * owning pane can leave `editorOwner` pointing at a `LeafId` that `panes` no longer holds (`editorOwner`'s
   * own doc: closing unmounts a λ copy's editor without reassigning it), and rebinding the owning pane
   * away from the session can leave the SAME stale entry pointing at a pane that no longer wants it. Both
   * are "no current home", not "the wrong home" — resolving them to `undefined` is what keeps
   * `setEditor`/`receiveEditor` from ever being called on a pane whose slot disagrees with the session a
   * caller is asking about.
   */
  const editorHomeFor = (session: SessionId): EditablePane | undefined => {
    const id = editorOwner.get(session)
    if (id === undefined) return undefined
    const entry = panes.get(id)
    if (entry === undefined || entry.slot.binding.session !== session) return undefined
    // **THE CAST GOES THROUGH `unknown`.** `EditablePane` shares no member with `PaneView<LegFrame[Leg]>`
    // at all, so the narrowing needs the `unknown` step to say "trust this" rather than "this is safely
    // narrower". THE ENTRY IS CHECKED FOR ITS SESSION AND NOT ITS KIND — SOUND ON (1) BELOW, AND (2) IS
    // WHY IT NEEDS (1): A PANE CAN CHANGE LEG. A `LeafId` naming a `LambdaPane` when the claim was
    // recorded can name a `TmPane` afterwards (`pane-host.ts`'s `paneEvents.rebind`, cross-leg arm), and
    // this cast would then hand that pane the claimed session's editor.
    //
    // (1) NO CLAIM SURVIVES THE CHANGE. `applyLayout`'s pass 1 drops the entry whose kind no longer
    // matches its leaf, and pass 2 calls `dropClaimsOn(l.id)` for every leaf without a pane BEFORE it
    // builds one and before `reconcile()` runs at all — so by the time this function can be called, no
    // claim names that leaf. That line's own comment carries the same fact from the other side; it must
    // not be read as being only about `reset preset`'s re-minted ids.
    //
    // (2) THE BINDING CHECK DOES NOT CATCH IT. `pane-host.ts`'s `claiming` wraps `detachMachine` (and
    // `detachAsm`) to claim a TM or asm copy's session the same way it wraps `detach` for a λ one's, so a
    // key in `editorOwner` can name a machine-legged scratch. `SessionRegistry.pairs()` DOES offer a TM
    // pair for that session — the machine fork's own copy — so a rebind CAN produce a TM slot bound to
    // exactly the session a claim names.
    //
    // (1) IS THEREFORE THE FACT THIS CAST RESTS ON.
    //
    // NEITHER FACT MAKES THE CAST'S CONFORMANCE TRUE ON ITS OWN — THIS MODULE NEVER CHECKS IT. What
    // checks it is `implements EditablePane` on each pane class's own definition (`LambdaPane`, `TmPane`
    // and `AsmPane`, each in its own file): a `LambdaPane` missing one of its members fails to compile AT
    // THAT CLASS, not here, because nothing in this file ever assigns a `LambdaPane` value to an
    // `EditablePane`-typed position except through this `unknown` cast and its siblings in
    // `reconcileEditors` and `flush` below. That `implements` clause is the anchor a reader should trust
    // this cast against.
    return entry.pane as unknown as EditablePane
  }

  /**
   * Make every `ScratchEditor` in the app — mounted on a pane, or waiting in custody — agree with where
   * this file says it belongs. The other half of the editor-moves rule (5d-ii-a design §4.3), for the
   * one way ownership can change with nothing arriving on the wire to drive it: the
   * "move the editor here" control (`viewMenu`). **Not to be confused with the
   * text panel's own disclosure (`textPanel`)**, which is a different action on a different pane — it
   * un-collapses an editor this pane ALREADY owns, and moves nothing.
   * `replies.ts`'s `scratch-compiled` case is the other way ownership takes
   * effect, and it needs no such sweep — `editorOwner` already names the right pane by the time a reply
   * can arrive, so `setEditor` there lands directly. **THE FORK AND THE RESTORE CLAIM BEFORE THEIR BUILD
   * CAN ANSWER.** `paneEvents`'s wrapped `detach` sets the claim synchronously, before the worker round
   * trip that produces a `scratch-compiled` reply at all. A restored binding's leaf is claimed in the same
   * turn as the warming loop that spawns the worker, strictly before that worker can answer, and its
   * editor does not wait for the reply: `pane-host.ts`'s `mountScratchEditor` claims the leaf in the
   * creation pass and mounts the buffer's editor there with `setEditor`, and `main.ts`'s restore
   * sequence — `editorOwner`'s own doc names it — claims each binding whose session is still without one.
   *
   * **TWO PASSES OVER TWO DOMAINS.** The sweep is a statement about CLAIMS, so it iterates `editorOwner`;
   * custody is a statement about an editor with nowhere to be, so it iterates `heldEditors`. A single loop
   * over `editorOwner.keys()` would make this function's opening sentence — a claim about EVERY editor —
   * false of any held editor whose session holds no claim, and that is not a hypothetical state:
   * `applyLayout`'s pane-creation loop DROPS the claim recorded against an arriving leaf id, and a default
   * arrangement re-mints its literal ids, so dropping it is exactly what `reset preset` and a views toggle do
   * after a close. `tests/browser/two-lambda-panes.test.ts` is the test that reaches that state, and it
   * has to concatenate two sequences because neither reaches it alone.
   *
   * RUN ON EVERY `applyLayout()` CALL RATHER THAN ONLY WHEN `editorOwner` CHANGED. The sweep is cheap
   * (`panes.all()` is at most a handful of entries, and so is `editorOwner`) and self-correcting: a pane
   * that already agrees with its owner costs one `takeEditor()` call that returns `null` and nothing
   * more, so there is no separate "did anything change" flag for every caller that touches `editorOwner`
   * to keep in step.
   *
   * A STALE OWNER RESOLVES TO NO HOME, NOT TO A FALLBACK PANE — `editorHomeFor`'s own doc has the two
   * ways it goes stale. Reassigning to some other pane bound to the session would be exactly the
   * "relocating on close puts the editor somewhere the user did not put it" `editorOwner`'s doc refuses.
   * An editor on a pane that is still ON SCREEN and no longer wants it (the REBIND-away case) leaves
   * that pane, because the session behind it is one the user has navigated away from; an editor whose
   * pane was CLOSED is a different case — see the custody pass below.
   * **IT IS NOT THE `held.destroy()` BELOW THAT TAKES IT OFF.** A rebound-away pane no longer names the
   * session, so the binding predicate on the loop skips it. A rebind through the view's own selector hands
   * the editor over before the binding moves (`pane-host.ts`'s same-leg `rebind` arm: a λ view's into
   * custody, a TM or asm view's destroyed), and `scratch-rebind-editor.test.ts` is the test that pins it.
   * A pause or a delete moves a view onto the program instead, and the view's `setDetached` teardown
   * takes the editor down — it fires from `PaneSlot.render` on the very next `draw()`, which is the same
   * tick. **A VIEW THAT IS NOT ON THE PAGE IS NOT DRAWN**, a Stage tab that is not selected and a view a
   * switch parked: `pane-host.ts`'s `reseedingSlots` calls that teardown itself as a pause or a delete
   * moves such a view onto the program, and `stage-copy-editor.test.ts` and `parked-copy-editor.test.ts`
   * pin it. The branch below answers a different case: a pane that IS on the session while the session
   * holds no home for it, which is what a claim pointing at a closed leaf leaves behind.
   *
   * **AND A SCRATCH→SCRATCH REBIND CANNOT LEAK THE EDITOR, THOUGH WHAT CLOSES IT IS AT THE REBIND SITE
   * RATHER THAN IN THIS FUNCTION.** `setDetached` tears down only on `!detached`, and both sides of a
   * scratch→scratch rebind are detached, so it never fires — nothing HERE takes that editor down. What
   * does is upstream: `pane-host.ts`'s same-leg `rebind` arm calls `takeEditor()` on the outgoing pane
   * BEFORE `base.rebind` moves the binding, and holds a λ view's editor in `heldEditors`
   * (`custody.hold(leaving, held)`) or destroys a TM or asm view's, so the editor is off the pane by the
   * time this sweep could ever reach it.
   * `scratch-rebind-editor.test.ts` — the test named above as pinning this — drives the rebind both
   * ways, not only back to SOURCE. **THE BINDING PREDICATE ON THE SWEEP'S LOOP BELOW IS THEREFORE
   * BELT-AND-BRACES, NOT WHAT CLOSES IT**: with the upstream handover in place there is normally nothing
   * left mounted on a rebound-away pane for it to skip, but it still stands as a second line of defence
   * against any future writer of `slot.rebind` that forgets to hand the editor over first.
   *
   * THE CUSTODY PASS IS SECOND, AND THE ORDER IS LOAD-BEARING. It mounts a `heldEditors` entry onto the
   * home if there now is one, and it runs AFTER the sweep so that a home which has just been handed an
   * editor by the sweep is not handed a second one. Two separate passes (above) STRENGTHEN that ordering:
   * every sweep runs before any custody mount, where one shared loop would order only the sweep for the
   * same session ahead of it.
   *
   * **A CUSTODY MOUNT AND A SWEEP MOUNT CANNOT COLLIDE FOR ONE SESSION, AND THAT RESTS ON A CONJUNCTION
   * OF THREE THINGS — THE ORDER OF THE TWO PASSES IS ONLY THE WEAKEST OF THEM.** (1) EVERY RETIRE AND
   * EVERY COOL SWEEPS EVERY HELD EDITOR: each ends the session's incarnation and is followed by this
   * function, AND its custody pass iterates `heldEditors` itself, so no custody entry can outlive the
   * incarnation of the session it is keyed by. The header list (5d-ii-c design §4.2; its temperature
   * control 5d-ii-d design §4.2) supplies both, and the obligation is discharged in that list's own
   * handlers (`main.ts`), which call `ScratchBuffers.retire` or `cool` and then this function; the
   * gestures that drive them are the list's retire and temperature controls.
   * **The second half of that clause is not a detail**: a body that ran both passes over one loop over
   * `editorOwner.keys()` could not see an entry no claim named, and one exists once a closed view's id
   * is minted again. (2) `receiveEditor` THROWS rather than overwriting, so if the two ever do both
   * fire, the app says so at the moment of the mistake instead of silently orphaning a live view — and
   * the throw costs the caller its gesture and nothing more (see `applyLayout`'s `try`/`finally`).
   * (3) The order below then means that even a case satisfying both — a session with an editor mounted
   * on a pane AND an entry in custody — hands the sweep's editor over first, so custody's throw names
   * the sweep as the arrival that got there first. WITHIN one page-load incarnation there is one editor
   * per session, so if a pane holds it, custody does not.
   *
   * **THE `heldEditors` ENTRY IS DROPPED AFTER A SUCCESSFUL MOUNT, NEVER BEFORE.** Deleted on the line
   * ABOVE `home.receiveEditor(waiting)`, the throw that (2) exists to raise would drop the app's LAST
   * reference to a live `EditorView` — with its own pending debounce — before the call that would have
   * given it a new home, and an invariant violation would leave the editor unrecoverable, which is the one
   * outcome a guard must not have; deleting after the mount leaves the entry exactly where the next
   * `reconcileEditors` can find it again. The destroy branch below is the opposite case and deletes
   * FIRST on purpose: there, losing the reference is the point.
   *
   * **TWO THINGS THE SWEEP SAYS ON THE LOOP BELOW, BOTH WITH THEIR OWN COMMENTS THERE.** Its outer walk
   * skips a claim whose SESSION the registry no longer holds, and its inner walk skips a pane whose own
   * BINDING names a different session. A fork that mints its own buffer (5d-ii-c decision 1) is what
   * makes both distinctions necessary: it separates "every claim" from "the live one", and "every λ
   * pane" from "the panes that could be holding this session's editor".
   *
   * A HELD EDITOR WHOSE SESSION IS GONE IS DESTROYED HERE. `ScratchBuffers.cool`, on its own or from
   * `retire`, removes the entry from the registry and rebinds the panes that were on THAT BUFFER back to
   * source (it rebinds no others — that is `cool`'s rule), so no pane is left on that session — and
   * `replies.ts`'s `editorHome(session)?.setEditor(null)`, the call that would normally tear an editor
   * down, resolves to `undefined` for a session whose owning pane is closed and is therefore a no-op.
   * Without this line a cool or a retire during custody would leak one live `EditorView` with its own
   * pending debounce over a terminated worker.
   *
   * **THIS BRANCH IS COVERED BY `tests/browser/editor-custody.test.ts`, WHICH CONSTRUCTS THIS FACTORY
   * RATHER THAN A STAND-IN.** It is guarded by `!sessions.has(session)`, which `ScratchBuffers.cool`
   * makes true, called on its own or from `retire`. A test that stubs `reconcileEditors` measures its
   * call site and never the destroy, which is why this one builds the real thing; it covers this
   * branch and the two beside it — the claim drop above and the `held.destroy()` in the sweep.
   */
  const reconcileEditors = (): void => {
    for (const session of editorOwner.keys()) {
      // **A CLAIM FOR A SESSION THAT NO LONGER EXISTS IS DROPPED HERE.** Nothing else ever erases an entry
      // for a session that has left the registry: `dropClaimsOn` is keyed by LEAF and only fires for a
      // leaf arriving without a pane, so a claim whose pane simply stayed put outlives the session it
      // names forever.
      //
      // THE MOUNTED EDITOR OF A SESSION THAT HAS LEFT THE REGISTRY STILL COMES DOWN, WHICH IS WHY
      // SKIPPING IS SAFE RATHER THAN MERELY NARROWER: `ScratchBuffers.cool`, on its own or from `retire`,
      // rebinds the panes on that buffer — and no others, which is its rule — back to `home`, and the
      // `draw()` that follows drives `PaneSlot.render` -> `LambdaPane.setDetached(false)`, whose own
      // teardown calls `setEditor(null)`. That draw passes over a view that is not on the page, and for
      // one the rebind itself makes the call (`pane-host.ts`'s `reseedingSlots`).
      //
      // **THE HANDLERS THAT END A SESSION CALL THIS FUNCTION THEMSELVES.** `main.ts`'s header-list retire
      // and temperature handlers call `ScratchBuffers.retire` or `cool`, then this, then `draw()`, in that
      // order. The ordering above is a fact about those handlers, and the obligation to call this at all is
      // stated there rather than inferred here.
      //
      // The custody pass below owns the other case (an editor with no pane at all) and states the same
      // fact its own way, through `!sessions.has(session)`.
      if (!sessions.has(session)) {
        editorOwner.delete(session)
        continue
      }
      const home = editorHomeFor(session)
      // **EVERY VIEW, NOT ONLY THE λ ONES — *move the editor here* is offered on a TM or asm view too**, and this
      // sweep is what moves the editor another view of the copy holds onto the view that asked (`pane-host.ts`'s
      // `showEditor`). The predicates below are about a view's binding and which view is home, never its leg.
      for (const p of panes.all()) {
        // **THE PANE'S OWN BINDING IS THE PREDICATE THAT SAYS WHOSE EDITOR IT COULD BE HOLDING, AND
        // WITHOUT IT THIS LOOP WOULD HAND ONE BUFFER'S EDITOR TO ANOTHER BUFFER'S HOME.** A `LambdaPane`
        // does not record which session's editor it has, so this loop would ask EVERY pane and give
        // whatever came back to `home`; that is equivalent to what the sweep means ("S's editor lives on
        // `home(S)`") only while the app holds one scratch editor at a time, and a fork that mints its own
        // buffer (5d-ii-c decision 1) makes two mounted editors ordinary. Five gestures reach it: fork,
        // split, rebind the new pane to source, fork it, then any layout gesture at all.
        //
        // SOUND BECAUSE A PANE ONLY EVER COMES TO HOLD AN EDITOR WHILE BOUND TO ITS SESSION.
        // `replies.ts`'s `scratch-compiled` arm mounts through `editorHomeFor`, which checks the
        // binding, and `receiveEditor` is only ever handed one by this function. THE CONTROL THIS SWEEP
        // EXISTS FOR SATISFIES IT BY CONSTRUCTION: *move the editor here* is offered only on a pane that
        // is already `#detached` on the session (`LambdaPane.#refreshClaim`), so the pane losing the
        // editor and the pane gaining it both name S — which is why the move is unaffected while the
        // collision becomes unrepresentable.
        //
        // AND IT DOES NOT WEAKEN THE DESTROY BRANCH BELOW, whose case is a pane REBOUND AWAY from S: the
        // rebind is what makes `home` `undefined` in the first place, and the rebind's own route takes that
        // editor off the pane (this function's doc above has both routes), not this loop — which could only
        // ever have reached it on the frame between the two.
        //
        // **A REBIND THROUGH THE VIEW'S OWN SELECTOR TAKES THE EDITOR OFF BY ANOTHER ROUTE — NOT THROUGH
        // THIS LINE.** `pane-host.ts`'s same-leg `rebind` arm takes the outgoing editor off the view (a λ
        // view's into custody, a TM or asm view's destroyed) before `base.rebind` changes the binding this
        // predicate reads, whatever the destination, so by the time this loop runs there is normally
        // nothing left for it to skip — even on a scratch→scratch rebind, where `setDetached` does not
        // fire its teardown. Stated in full, with what closes it, in this function's own doc above.
        if (p.slot.binding.session !== session) continue
        // `as unknown as EditablePane`, THE SAME STEP AND FOR THE SAME REASON AS `editorHomeFor`'s OWN
        // CAST ABOVE — `p.pane` here is a `PaneView`, which shares no member with `EditablePane` for TS to
        // narrow through directly. Sound because every entry in `panes` is a λ, TM or asm view, and each
        // `implements EditablePane` (the source view has no entry).
        const pane = p.pane as unknown as EditablePane
        if (pane === home) continue
        const held = pane.takeEditor()
        if (held === null) continue
        if (home !== undefined) home.receiveEditor(held, collapsedOf(session))
        else held.destroy()
      }
    }

    // ITERATED WHILE BEING DELETED FROM, WHICH IS DEFINED BEHAVIOUR FOR A `Map` — the same fact
    // `applyLayout`'s claim-dropping loop relies on, and for the same reason: the iterator walks entries
    // in insertion order and does not revisit a removed one. Nothing here ADDS an entry, so the walk
    // cannot be extended by its own work either.
    for (const [session, waiting] of heldEditors) {
      const home = editorHomeFor(session)
      if (home !== undefined) {
        home.receiveEditor(waiting, collapsedOf(session))
        heldEditors.delete(session)
      } else if (!sessions.has(session)) {
        heldEditors.delete(session)
        waiting.destroy()
      }
    }
  }

  return {
    hold(session: SessionId, editor: ScratchEditor): void {
      heldEditors.set(session, editor)
    },
    claim(session: SessionId, leaf: LeafId): void {
      editorOwner.set(session, leaf)
    },
    dropClaimsOn(leaf: LeafId): void {
      // DELETING THE CURRENT KEY MID-ITERATION IS DEFINED BEHAVIOUR FOR A `Map` — the same fact
      // `reconcileEditors`' custody pass relies on: the iterator visits entries in insertion order and
      // simply does not revisit a removed one. The caller's own comment (`applyLayout`'s pane-creation
      // loop, `pane-host.ts`) is where the argument for dropping the claim at all lives.
      for (const [claimed, owner] of editorOwner) if (owner === leaf) editorOwner.delete(claimed)
    },
    homeFor: editorHomeFor,
    /**
     * Whether an editor for `session` EXISTS (deferred-a11y item 11). `draw()` fans it over every view
     * once a frame — a TM or asm view's *move the editor here* asks it too (`CopyEditor.#refreshClaim`).
     *
     * **`homeFor(session) !== undefined` IS NOT THIS QUESTION.** `editorOwner` is a map of CLAIMS, and the
     * claim for a fork is recorded by `pane-host.ts`'s wrapped `detach` at the moment the binding moves —
     * which is before the worker has answered and therefore also on the fork that never builds. So the
     * phantom buffer this method exists to report `false` for has a claim, a live pane, and a matching
     * binding: every condition `editorHomeFor` checks. What it does not have is an editor, and
     * `holdsEditor` is the only thing that can say so — `takeEditor` reports the same fact destructively,
     * and a caller that unmounted the editor to find out whether it was there would break the control it
     * is deciding to offer.
     *
     * THE CUSTODY MAP FIRST, BECAUSE IT IS THE CASE WITH NO PANE TO ASK. A λ copy's editor whose holder
     * closed waits in `heldEditors` with its claim pointing at a leaf `panes` no longer holds, so
     * `editorHomeFor` answers `undefined` for it — and that is precisely the state the control must stay
     * offered in, since claiming it is how the user gets the editor back (`heldEditors`' own doc has
     * the argument).
     *
     * **AN EDITOR MOUNTED ON A PANE WHOSE BINDING HAS MOVED AWAY IS NOT COUNTED.** The sweep does not take
     * such an editor down: its inner loop opens with `if (p.slot.binding.session !== session) continue`,
     * which skips exactly the rebound-away pane, and `LambdaPane.setDetached` tears down only on
     * `!detached`, which a scratch→scratch rebind never reaches because both bindings are detached.
     * **WHAT KEEPS ONE FROM BEING LEFT MOUNTED THERE IS UPSTREAM OF BOTH**: `pane-host.ts`'s same-leg
     * `rebind` arm takes the outgoing editor off the view before the binding moves (a λ view's into
     * custody, a TM or asm view's destroyed), so a pane whose binding has moved away is, in the ordinary
     * case, holding nothing by the time anyone asks. See the
     * **AND A SCRATCH→SCRATCH REBIND CANNOT LEAK THE EDITOR** paragraph in `reconcileEditors`' doc
     * for what closes it.
     *
     * **`pane-host.ts`'s `mountScratchEditor` READS THIS THE OTHER WAY UP.** It asks this before it BUILDS
     * an editor for a pane that has just come to be bound to a warm buffer, and mounts only when the
     * answer is `false`. That is deliberately the same predicate `draw()` feeds `setEditorAvailable`, so
     * the two are complementary by construction: an editor that exists is moved by the user's click on
     * the control this gate offers, and one that does not exist is built there. Between them every pane
     * bound to a warm buffer has a route to an editor — which is what withdrawing the control honestly
     * requires, since "provably cannot work" was only true of the MOVE, never of "this buffer can be
     * edited at all".
     *
     * NOT COUNTING IT IS RIGHT: the question this method answers is "would the click work", and there it
     * would not. Claiming records `editorOwner.set(session, myLeaf)` and waits for the sweep — which
     * skips the holder for the same binding reason, so nothing arrives. Withdrawing the control there is
     * item 1's standard applied correctly to a control that provably cannot work. The stale editor is a
     * separate wrong that a `true` here would not fix.
     */
    hasEditor(session: SessionId): boolean {
      return heldEditors.has(session) || editorHomeFor(session)?.holdsEditor() === true
    },
    reconcile: reconcileEditors,
    flush(session: SessionId): void {
      heldEditors.get(session)?.flush()
      // EVERY VIEW OF THE COPY, NOT ONLY ITS CLAIMED HOME: a view only holds an editor while it shows that editor's
      // copy (`reconcileEditors`' own argument), so asking each of them is exact without trusting the claim.
      for (const p of panes.all()) {
        if (p.slot.binding.session === session) (p.pane as unknown as EditablePane).flushEditor()
      }
    },
  }
}
