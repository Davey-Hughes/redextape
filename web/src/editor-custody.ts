import type { LambdaEditor } from './lambda-editor'
import type { LambdaPane } from './lambda-pane'
import type { LeafId, PaneCollection } from './panes'
import type { SessionId } from './session-client'
import type { SessionRegistry } from './sessions'

/**
 * WHERE EVERY SCRATCH `LambdaEditor` IS AND WHERE IT BELONGS — the cluster `main.ts` held as two `Map`s
 * and two closures visible to a thousand lines.
 *
 * `editorOwner` and `heldEditors` (inside the factory below) are one fact in two containers: which pane
 * each session's editor is claimed by, and where an editor waits while no pane holds it. **NEITHER MAP
 * LEAVES THIS MODULE, AND THAT IS THE WHOLE POINT OF THE EXTRACTION RATHER THAN A HOUSEKEEPING
 * PREFERENCE.** Every one of the three review rounds recorded in the doc comments below was a question
 * about WHICH DOMAIN A LOOP RAN OVER — a custody entry outliving its session, a re-minted leaf id
 * inheriting a claim, and a sweep whose loop could not reach what `reset layout` had orphaned — and a
 * `Map` any of `main()`'s lines can iterate is a `Map` any of them can iterate over the wrong domain.
 * The five members below are the entire surface those call sites actually used: two writes, one erase,
 * one read, and the sweep.
 *
 * `panes` AND `sessions` ARE THE ONLY DEPENDENCIES, which is what makes this a module at all rather than
 * a closure that had to stay where it was: `homeFor` resolves a claim through `panes.get` and checks the
 * pane's own binding, and `reconcile` asks `sessions.has` whether a held editor's session still exists.
 * Nothing here reads the layout tree, the DOM, or the wire — `applyLayout` (now `pane-host.ts`'s) is what
 * calls this at the moments the tree changes, and it stays the only thing that knows a tree exists.
 *
 * `reconcile` THROWS, DELIBERATELY, AND ITS CALLER PAYS FOR THAT. `LambdaPane.receiveEditor` refuses a
 * second editor rather than absorbing the mistake; `applyLayout`'s `try`/`finally` (`pane-host.ts`) is what
 * keeps the tree, the DOM and `localStorage` from disagreeing when it fires. Both halves are unchanged
 * by the move.
 */
export type EditorCustody = {
  /** Take an unmounted editor into custody under the session it belongs to. */
  hold(session: SessionId, editor: LambdaEditor): void
  /** Record that `leaf` is where `session`'s editor should live. */
  claim(session: SessionId, leaf: LeafId): void
  /** Drop any claim naming `leaf` — called when a fresh pane arrives at that id. */
  dropClaimsOn(leaf: LeafId): void
  /** The pane currently showing `session`'s editor, or `undefined`. */
  homeFor(session: SessionId): LambdaPane | undefined
  /** Whether `session` has a `LambdaEditor` at all — mounted on its home pane, or waiting here. */
  hasEditor(session: SessionId): boolean
  /** Move held editors onto their claimed homes and retire orphans. Throws as it does today. */
  reconcile(): void
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
 * **`collapsedOf` IS A PLAIN FUNCTION, NOT A `ScratchBuffers` DEPENDENCY — 5d-ii-d T9 fix round 1.**
 * `reconcileEditors` below hands every editor it (re)mounts to `LambdaPane.receiveEditor`'s second
 * parameter, which needs the buffer's own collapsed flag the same way `replies.ts`'s `scratch-compiled`
 * arm already reads it for `setEditor`'s — the design's own words are that the flag "rides with the
 * buffer and follows it as custody moves the editor between panes" (`pane-chrome.ts`'s `collapseButton`
 * doc), and until this fix nothing here fed the mount site the sweep and custody passes use at all. A
 * `ScratchBuffers` reader would answer the same question but would also hand this module the whole
 * class — forking, cooling, retiring, every buffer's text — where this file's own module doc argues that
 * `panes` and `sessions` are "the ONLY dependencies" for a reason: every read here is a question this
 * module's callers already need answered elsewhere, and widening the dependency to serve one field is
 * the same mistake `pane-host.ts`'s `tmProgramOf` doc argues against for the identical reason, one level
 * up. `main.ts` supplies `(session) => scratchpad.collapsedOf(session)`.
 */
export function createEditorCustody(deps: {
  panes: PaneCollection
  sessions: SessionRegistry
  collapsedOf: (session: SessionId) => boolean
}): EditorCustody {
  const { panes, sessions, collapsedOf } = deps

  /**
   * Which pane currently holds each scratch session's editor — design §4.3's fork, extended by wave 3
   * (5d-ii-a)'s editor-moves rule.
   *
   * ONE `LambdaEditor` PER SCRATCH, MOUNTED WHEREVER IT WAS LAST ASKED FOR. Not one instance per pane
   * with a policy keeping copies in step: two uncoordinated CodeMirror instances over one buffer
   * desynchronize between debounces and resolve last-write-wins at recompile, which is a control that
   * provably cannot work, offered anyway. Moving the live view (`LambdaPane.takeEditor`/`receiveEditor`,
   * `reconcileEditors` below) makes that state unrepresentable rather than policed, and cursor,
   * selection and undo survive because nothing is destroyed.
   *
   * CLOSING THE HOLDER UNMOUNTS WITHOUT REASSIGNING. The scratch is a session and no pane's death
   * retires one; the next pane to ask (`showEditor` in `paneEvents` below) re-mounts the same view.
   * Relocating on close would put the editor somewhere the user did not put it, which is the state
   * design §4.2 refuses movement for — `editorHomeFor` below is what makes a stale entry (closed, or
   * rebound away) resolve to "no home" rather than to a fallback pane. `heldEditors` below is where
   * the unmounted view WAITS in the meantime, and without it "the next pane to ask re-mounts the same
   * view" was a sentence with nothing behind it.
   *
   * **SET IN THREE PLACES, WHERE THIS USED TO READ "TWO PLACES ONLY" — 5d-ii-d T9 ADDED THE THIRD.**
   * `paneEvents`'s wrapped `detach` (the first mount, at the moment a fork succeeds) and its
   * `showEditor` (every later move) are the two gesture-driven writers; `main.ts`'s restore sequence
   * is the third, claiming a leaf whose session came back bound from `redextape.buffers` — see that
   * call's own doc for why it runs AFTER the first `applyLayout()` rather than beside `seedBinding`,
   * which is what keeps it "a pane that already existed" like the other two rather than the
   * stale-on-arrival claim `dropClaimsOn` below exists to catch. Nothing else ever writes this map — a
   * rebind away from the scratch leaves the entry stale on purpose, per the paragraph above.
   *
   * For what this doc used to claim and why it changed, see the history note under `editorOwner`.
   */
  const editorOwner = new Map<SessionId, LeafId>()

  /**
   * A session's `LambdaEditor` while NO pane holds it — custody between the close of the pane that had
   * it and the claim of the pane that asks for it next.
   *
   * **WITHOUT THIS, CLOSING THE HOLDER STRANDS THE EDITOR AND THE CONTROL TO RETRIEVE IT STAYS
   * OFFERED.** `applyLayout` drops a closed pane from `panes` before anything asks it for its editor,
   * and `reconcileEditors` only ever iterates `panes.of('lambda')` — so the `LambdaEditor` would be left
   * mounted in a host no longer in the tree, with nothing holding a reference that could reach it.
   * Meanwhile the surviving pane, still bound to the scratch and still holding no editor, would go on
   * offering "bring the term editor to this pane" (`LambdaPane.#refreshClaim`'s `#detached && #editor
   * === null`), and clicking it would do nothing — forever. **That is the exact failure this slice's own
   * standard names first: a control that provably cannot work must not be offered.** Rather than
   * withdraw the control, the editor is taken into custody so the control works — which is what design
   * §4.3 promises in as many words: "the next pane to ask for the editor re-mounts the same view with
   * its text, cursor and undo intact".
   *
   * KEYED BY SESSION, NOT BY THE CLOSED `LeafId`, because that is the key the next claim arrives under:
   * `showEditor` writes `editorOwner.set(slot.binding.session, id)` and `reconcileEditors` asks per
   * session. Keying by the closed leaf would be keying by something no claim ever mentions.
   *
   * **A LEAF ID IS A WEAKER KEY THAN A SESSION, NOT MERELY A DIFFERENTLY-SHAPED ONE.** `nextLeafId`
   * only counts up, but it is not the only source of ids: `defaultLayout()` writes `source`, `lambda-0`
   * and `tm-0` down as literals and `reset layout` re-mints all three, so a closed `lambda-0` comes
   * back — and `parseLayout` can restore any id a stored tree holds. A leaf id can therefore be
   * inherited by a pane that has nothing to do with the one that claimed the editor. `applyLayout`'s
   * pane-creation loop drops exactly that inheritance for `editorOwner` (which IS keyed by leaf) where
   * it happens.
   *
   * NOT A SECOND HOME. Nothing renders from here and nothing reads through it — it is exactly the "one
   * instance, unmounted, not destroyed" state design §4.3 describes, made addressable. An entry lives
   * only from the close that produced it to the next `reconcileEditors` that finds a home for it, or to
   * the retirement of its session, whichever comes first — and BOTH ENDINGS ARE REACHED BY THE SAME
   * FUNCTION. §4.2's header list is what supplies the second: `main.ts`'s retire handler calls `retire`
   * and then `reconcile`, in that order. See `reconcileEditors`' own doc.
   *
   * **AND "THE SAME FUNCTION" IS NOT ENOUGH ON ITS OWN.** `reconcileEditors` iterates THIS MAP for its
   * custody pass rather than the claim map, which is what makes the sentence above a fact about the code
   * rather than about the common case: an entry here for a session that holds no claim is an ordinary
   * state — `applyLayout`'s pane-creation loop drops a claim recorded against an arriving leaf id while
   * the entry stays — and a pass driven off `editorOwner.keys()` could not reach it.
   *
   * For what this doc used to claim and why it changed, see the history note under `heldEditors`.
   */
  const heldEditors = new Map<SessionId, LambdaEditor>()

  /**
   * The pane currently showing `session`'s scratch editor, or `undefined` if no pane currently is.
   *
   * A LOOKUP THROUGH `editorOwner` GUARDED BY THE PANE'S OWN BINDING, NOT A BARE MAP READ. Closing the
   * owning pane leaves `editorOwner` pointing at a `LeafId` that `panes` no longer holds (`editorOwner`'s
   * own doc: closing unmounts without reassigning), and rebinding the owning pane away from the session
   * leaves the SAME stale entry pointing at a pane that no longer wants it. Both are "no current home",
   * not "the wrong home" — resolving them to `undefined` is what keeps `setEditor`/`receiveEditor` from
   * ever being called on a pane whose slot disagrees with the session a caller is asking about.
   */
  const editorHomeFor = (session: SessionId): LambdaPane | undefined => {
    const id = editorOwner.get(session)
    if (id === undefined) return undefined
    const entry = panes.get(id)
    if (entry === undefined || entry.slot.binding.session !== session) return undefined
    // **`as LambdaPane` ON AN ENTRY CHECKED FOR ITS SESSION AND NOT ITS KIND — SOUND, BUT ON TWO FACTS
    // THAT ARE WORTH WRITING DOWN NOW THAT A PANE CAN CHANGE LEG.** A `LeafId` naming a `LambdaPane`
    // when the claim was recorded can name a `TmPane` afterwards (`pane-host.ts`'s `paneEvents.rebind`,
    // cross-leg arm), and this cast would then hand `receiveEditor` a pane that has no such method.
    //
    // (1) NO CLAIM SURVIVES THE CHANGE. `applyLayout`'s pass 1 drops the entry whose kind no longer
    // matches its leaf, and pass 2 calls `dropClaimsOn(l.id)` for every leaf without a pane BEFORE it
    // builds one and before `reconcile()` runs at all — so by the time this function can be called, no
    // claim names that leaf. That line's own comment carries the same fact from the other side; it must
    // not be read as being only about `reset layout`'s re-minted ids.
    //
    // (2) AND THE SESSION CHECK ABOVE WOULD CATCH IT ANYWAY. Every key in `editorOwner` is a session a
    // λ pane was detached to — today only the λ scratch — and `SessionRegistry.pairs()` offers no TM
    // pair for a session with no TM leg, so no `<select>` can produce a TM slot bound to it. A pane
    // under a claimed id that has become a `TmPane` is therefore bound to some OTHER session, and
    // `entry.slot.binding.session !== session` returns `undefined` one line up.
    //
    // Either fact alone is enough; (1) is the one that holds if a TM-legged scratch ever exists.
    return entry.pane as LambdaPane
  }

  /**
   * Make every `LambdaEditor` in the app — mounted on a pane, or waiting in custody — agree with where
   * this file says it belongs. The other half of the editor-moves rule, for the one way ownership can
   * change with nothing arriving on the wire to drive it: the
   * "bring the term editor to this pane" control (`claimEditorButton`). **Not to be confused with
   * `collapseButton`'s "show the term editor"**, which is a different action on a different pane — it
   * un-collapses an editor this pane ALREADY owns, and moves nothing.
   * `replies.ts`'s `scratch-compiled` case is the other way ownership takes
   * effect, and it needs no such sweep — `editorOwner` already names the right pane by the time a reply
   * can arrive, so `setEditor` there lands directly. **TWO WRITERS HAVE THAT PROPERTY, NOT ONE — this
   * sentence used to name only the first (5d-ii-d T9 fix round 1).** `paneEvents`'s wrapped `detach` sets
   * the claim synchronously, before the worker round trip that produces a `scratch-compiled` reply at
   * all; `main.ts`'s restore sequence — `editorOwner`'s own doc names it the third writer — claims a
   * restored binding's leaf synchronously too, in the same turn as the warming loop that spawns the
   * worker and strictly before that worker can answer. It is the identical fact that makes the restored
   * mount work at all: `setEditor` is what mounts a restored buffer's editor (`main.ts`'s own comment on
   * that loop), and it can only land directly, with no sweep to find a home, because the claim is already
   * there when the reply that calls it arrives.
   *
   * **TWO PASSES OVER TWO DOMAINS, AND THE SECOND DOMAIN IS AN IMPORTANT FINDING OF THE THIRD REVIEW
   * ROUND.** The sweep is a statement about CLAIMS, so it iterates `editorOwner`; custody is a statement
   * about an editor with nowhere to be, so it iterates `heldEditors`. A single loop over
   * `editorOwner.keys()` would make this function's opening sentence — a claim about EVERY editor —
   * false of any held editor whose session holds no claim, and that is not a hypothetical state:
   * `applyLayout`'s pane-creation loop DROPS the claim recorded against an arriving leaf id, and `reset
   * layout` re-mints `defaultLayout()`'s literal ids, so dropping it is exactly what `reset layout` does
   * after a close. `tests/browser/two-lambda-panes.test.ts` is the test that reaches that state, and it
   * has to concatenate two sequences because neither reaches it alone.
   *
   * RUN ON EVERY `applyLayout()` CALL RATHER THAN ONLY WHEN `editorOwner` CHANGED. The sweep is cheap
   * (`panes.of('lambda')` is at most a handful of entries, and there is at most one scratch session to
   * iterate today) and self-correcting: a pane that already agrees with its owner costs one
   * `takeEditor()` call that returns `null` and nothing more, so there is no separate "did anything
   * change" flag for every caller that touches `editorOwner` to keep in step.
   *
   * A STALE OWNER RESOLVES TO NO HOME, NOT TO A FALLBACK PANE — `editorHomeFor`'s own doc has the two
   * ways it goes stale. Reassigning to some other pane bound to the session would be exactly the
   * "relocating on close puts the editor somewhere the user did not put it" `editorOwner`'s doc refuses.
   * An editor on a pane that is still ON SCREEN and no longer wants it (the REBIND-away case) is
   * destroyed, because the session behind it is one the user has navigated away from; an editor whose
   * pane was CLOSED is a different case and is not destroyed — see the custody pass below.
   * **IT IS NOT THE `held.destroy()` BELOW THAT PERFORMS THAT DESTRUCTION.** A rebound-away pane no
   * longer names the session, so the binding predicate on the loop skips it. `LambdaPane.setDetached`'s
   * own teardown is what tears that editor down — it fires from `PaneSlot.render` on the very next
   * `draw()`, which is the same tick, and `scratch-rebind-editor.test.ts` is the test that pins it. The
   * branch below answers a different case: a pane that IS on the session while the session holds no home
   * for it, which is what a claim pointing at a closed leaf leaves behind.
   *
   * **AND A SCRATCH→SCRATCH REBIND CANNOT LEAK THE EDITOR, THOUGH WHAT CLOSES IT IS AT THE REBIND SITE
   * RATHER THAN IN THIS FUNCTION.** `setDetached` tears down only on `!detached`, and both sides of a
   * scratch→scratch rebind are detached, so it never fires — nothing HERE takes that editor down. What
   * does is upstream: `pane-host.ts`'s same-leg `rebind` arm calls `takeEditor()` on the outgoing pane
   * and `custody.hold(leaving, held)` BEFORE `base.rebind` moves the binding, so the editor is off the
   * pane and sitting in `heldEditors` by the time this sweep could ever reach it.
   * `scratch-rebind-editor.test.ts` — the test named above as pinning this — drives the rebind both
   * ways, not only back to SOURCE. **THE BINDING PREDICATE ON THE SWEEP'S LOOP BELOW IS THEREFORE
   * BELT-AND-BRACES, NOT THE FIX**: with the upstream handover in place there is normally nothing left
   * mounted on a rebound-away pane for it to skip, but it still stands as a second line of defence
   * against any future writer of `slot.rebind` that forgets to hand the editor over first.
   *
   * THE CUSTODY PASS IS SECOND, AND THE ORDER IS LOAD-BEARING. It mounts a `heldEditors` entry onto the
   * home if there now is one, and it runs AFTER the sweep so that a home which has just been handed an
   * editor by the sweep is not handed a second one. Splitting the two passes apart (above) STRENGTHENS
   * that ordering rather than weakening it: every sweep runs before any custody mount, where one shared
   * loop would order only the sweep for the same session ahead of it.
   *
   * **A CUSTODY MOUNT AND A SWEEP MOUNT CANNOT COLLIDE FOR ONE SESSION, AND THAT RESTS ON A CONJUNCTION
   * OF THREE THINGS — THE ORDER OF THE TWO PASSES IS ONLY THE WEAKEST OF THEM.** (1) EVERY RETIRE SWEEPS
   * EVERY HELD EDITOR: a retire calls this function, AND its custody pass iterates `heldEditors` itself,
   * so no custody entry can outlive the incarnation of the session it is keyed by. Design §4.4's header
   * list is what supplies the retire, and the obligation is discharged in that list's own handler
   * (`main.ts`), which calls `ScratchBuffers.retire` and then this function; the gesture that drives it
   * is the list's retire control. **The second half of that clause is not a detail**: a body that ran
   * both passes over one loop over `editorOwner.keys()` could not see an entry no claim named, and one
   * exists after every `reset layout`. (2) `receiveEditor` THROWS rather than overwriting, so if the two
   * ever do both fire, the app says so at the moment of the mistake instead of silently orphaning a live
   * view — and the throw costs the caller its gesture and nothing more (see `applyLayout`'s
   * `try`/`finally`). (3) The order below then means that even a case satisfying both — a session with
   * an editor mounted on a pane AND an entry in custody — hands the sweep's editor over first, so
   * custody's throw names the sweep as the arrival that got there first. WITHIN one page-load
   * incarnation there is one editor per session, so if a pane holds it, custody does not.
   *
   * **THE `heldEditors` ENTRY IS DROPPED AFTER A SUCCESSFUL MOUNT, NEVER BEFORE — the leak half of the
   * third round's finding.** `heldEditors.delete(session)` used to run on the line ABOVE
   * `home.receiveEditor(waiting)`, so the throw that (2) exists to raise dropped the app's LAST
   * reference to a live `EditorView` — with its own pending debounce — before the call that would have
   * given it a new home. An invariant violation left the editor unrecoverable, which is the one outcome
   * a guard must not have; deleting after the mount leaves the entry exactly where the next
   * `reconcileEditors` can find it again. The destroy branch below is the opposite case and deletes
   * FIRST on purpose: there, losing the reference is the point.
   *
   * **TWO THINGS THE SWEEP SAYS ON THE LOOP BELOW, BOTH WITH THEIR OWN COMMENTS THERE.** Its outer walk
   * skips a claim whose SESSION the registry no longer holds, and its inner walk skips a pane whose own
   * BINDING names a different session. A fork that mints its own buffer (5d-ii-c decision 1) is what
   * makes both distinctions necessary: it separates "every claim" from "the live one", and "every λ
   * pane" from "the panes that could be holding this session's editor" — pairs that were the same sets
   * while one fixed scratch id meant one claim at a time and one editor at a time.
   *
   * A HELD EDITOR WHOSE SESSION IS GONE IS DESTROYED HERE. `ScratchBuffers.retire` removes the entry
   * from the registry and rebinds the panes that were on THAT BUFFER back to source (it rebinds no
   * others — that is `retire`'s rule), so no pane will ever ask for that editor again — and `replies.ts`'s
   * `editorHome(session)?.setEditor(null)`, the call that would normally tear an editor down, resolves
   * to `undefined` for a session whose owning pane is closed and is therefore a no-op. Without this line
   * a retirement during custody would leak one live `EditorView` with its own pending debounce over a
   * terminated worker.
   *
   * **THIS BRANCH IS COVERED BY `tests/browser/editor-custody.test.ts`, WHICH CONSTRUCTS THIS FACTORY
   * RATHER THAN A STAND-IN.** It is guarded by `!sessions.has(session)`, and only `retire` removes a
   * session — design §4.4's header list is what supplies the retire. A test that stubs
   * `reconcileEditors` measures its call site and never the destroy, which is why this one builds the
   * real thing; it covers this branch and the two beside it — the claim drop above and the
   * `held.destroy()` in the sweep.
   *
   * For what this doc used to claim and why it changed, see the history note under `reconcileEditors`.
   */
  const reconcileEditors = (): void => {
    for (const session of editorOwner.keys()) {
      // **A CLAIM FOR A SESSION THAT NO LONGER EXISTS IS DROPPED HERE, AND WITHOUT THIS LINE ONE
      // BUFFER'S RETIREMENT DESTROYED ANOTHER BUFFER'S LIVE EDITOR.** Nothing else ever erases an entry
      // for a retired session: `dropClaimsOn` is keyed by LEAF and only fires for a leaf arriving
      // without a pane, so a claim whose pane simply stayed put outlives the session it names forever.
      // Without this line `editorHomeFor` answers `undefined` for the dead session, and the loop below
      // then takes the editor off EVERY λ pane and destroys it — including one a later fork has
      // legitimately mounted for a different buffer, since a fork mints a fresh id per call (5d-ii-c
      // decision 1) rather than re-registering one key.
      //
      // THE MOUNTED EDITOR OF THE RETIRED SESSION STILL COMES DOWN, WHICH IS WHY SKIPPING IS SAFE
      // RATHER THAN MERELY NARROWER: `ScratchBuffers.retire` rebinds the panes on that buffer — and no
      // others, which is its rule rather than the singleton's arithmetic — back to `home`, and the
      // `draw()` that follows drives `PaneSlot.render` -> `LambdaPane.setDetached(false)`, whose own
      // teardown calls `setEditor(null)`.
      //
      // **THE RETIRE SITE IS WHAT CALLS THIS FUNCTION, AND THIS SENTENCE USED TO READ AS THOUGH
      // SOMETHING ELSE DID.** There is one retire in the app: `main.ts`'s header-list handler, which
      // calls `ScratchBuffers.retire`, then this, then `draw()`, in that order. The ordering above is a
      // fact about that handler, and the obligation to call this at all is stated there rather than
      // inferred here.
      //
      // The custody pass below owns the other case (an editor with no pane at all) and states the same
      // fact its own way, through `!sessions.has(session)`.
      if (!sessions.has(session)) {
        editorOwner.delete(session)
        continue
      }
      const home = editorHomeFor(session)
      for (const p of panes.of('lambda')) {
        // **THE PANE'S OWN BINDING IS THE PREDICATE THAT SAYS WHOSE EDITOR IT COULD BE HOLDING, AND
        // WITHOUT IT THIS LOOP HANDED ONE BUFFER'S EDITOR TO ANOTHER BUFFER'S HOME** — Important
        // finding, review of tasks 1+2 as a unit. A `LambdaPane` does not record which session's editor
        // it has, so this loop asked EVERY λ pane and gave whatever came back to `home`; that was
        // equivalent to what the sweep means ("S's editor lives on `home(S)`") only while the app could
        // hold one scratch editor at a time. 5d-i's singleton produced that by accident rather than by
        // design — a second fork REBOUND to the existing scratch, so `claim` overwrote one entry instead
        // of adding a second and no second `scratch-compiled` fired — and a fork that mints its own
        // buffer (5d-ii-c decision 1) makes two mounted editors ordinary. Five gestures reach it: fork,
        // split, rebind the new pane to source, fork it, then any layout gesture at all.
        //
        // SOUND BECAUSE A PANE ONLY EVER COMES TO HOLD AN EDITOR WHILE BOUND TO ITS SESSION.
        // `replies.ts`'s `scratch-compiled` arm mounts through `editorHomeFor`, which checks the
        // binding; `receiveEditor` is only ever handed one by this loop; and both are the whole set of
        // writers. THE CONTROL THIS SWEEP EXISTS FOR SATISFIES IT BY CONSTRUCTION: "bring the term
        // editor to this pane" is offered only on a pane that is already `#detached` on the session
        // (`LambdaPane.#refreshClaim`), so the pane losing the editor and the pane gaining it both name
        // S — which is why the move is unaffected while the collision becomes unrepresentable.
        //
        // AND IT DOES NOT WEAKEN THE DESTROY BRANCH BELOW, whose case is a pane REBOUND AWAY from S: the
        // rebind is what makes `home` `undefined` in the first place, and `LambdaPane.setDetached`'s own
        // teardown is what takes that editor down (`scratch-rebind-editor.test.ts` is the test), not
        // this loop — which could only ever have reached it on the frame between the two.
        //
        // **A SCRATCH→SCRATCH REBIND PRESERVES THE EDITOR IN CUSTODY INSTEAD OF DESTROYING IT, BY A
        // DIFFERENT ROUTE — AND NOT THROUGH THIS LINE.** `setDetached` does not fire its teardown when
        // both bindings are detached, so this skip means nothing HERE takes the editor down — but by
        // the time this loop runs there is normally nothing left for it to skip: `pane-host.ts`'s
        // same-leg `rebind` arm takes the outgoing editor into custody before `base.rebind` changes the
        // binding this predicate reads.
        // Stated in full, with what closes it, in this function's own doc above.
        if (p.slot.binding.session !== session) continue
        const pane = p.pane as LambdaPane
        if (pane === home) continue
        const held = pane.takeEditor()
        if (held === null) continue
        if (home !== undefined) home.receiveEditor(held, collapsedOf(session))
        else held.destroy()
      }
    }

    // ITERATED WHILE BEING DELETED FROM, WHICH IS DEFINED BEHAVIOUR FOR A `Map` — the same fact
    // `applyLayout`'s claim-dropping loop relies on, and for the same reason: the iterator walks entries
    // in insertion order and does not revisit a removed one. Nothing here ADDS an entry (only
    // `applyLayout`'s removal loop does), so the walk cannot be extended by its own work either.
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
    hold(session: SessionId, editor: LambdaEditor): void {
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
     * Whether an editor for `session` EXISTS — the fact `LambdaPane.#refreshClaim` was missing, and the
     * fix for deferred-a11y item 11. `draw()` fans it over every λ pane once a frame.
     *
     * **`homeFor(session) !== undefined` IS NOT THIS QUESTION, AND ANSWERING IT THAT WAY WOULD HAVE LEFT
     * THE DEFECT EXACTLY WHERE IT WAS.** `editorOwner` is a map of CLAIMS, and the claim for a fork is
     * recorded by `pane-host.ts`'s wrapped `detach` at the moment the binding moves — which is before
     * the worker has answered and therefore also on the fork that never builds. So the phantom buffer
     * this method exists to report `false` for has a claim, a live pane, and a matching binding: every
     * condition `editorHomeFor` checks. What it does not have is an editor, and `holdsEditor` is the
     * only thing that can say so — `takeEditor` reports the same fact destructively, and a caller that
     * unmounted the editor to find out whether it was there would break the control it is deciding to
     * offer.
     *
     * THE CUSTODY MAP FIRST, BECAUSE IT IS THE CASE WITH NO PANE TO ASK. An editor whose holder closed
     * waits in `heldEditors` with its claim pointing at a leaf `panes` no longer holds, so
     * `editorHomeFor` answers `undefined` for it — and that is precisely the state the control must stay
     * offered in, since claiming it is how the user gets the editor back (`heldEditors`' own doc has the
     * current argument; the whole-branch finding that established it moved to the history note under
     * `heldEditors`).
     *
     * **AN EDITOR MOUNTED ON A PANE WHOSE BINDING HAS MOVED AWAY IS NOT COUNTED, AND THIS PARAGRAPH USED
     * TO JUSTIFY THAT WITH A CLAIM THAT IS FALSE — Important finding, review of this fix.** The sweep
     * does not take such an editor down: its inner loop opens with `if (p.slot.binding.session
     * !== session) continue`, which skips exactly the rebound-away pane, and `LambdaPane.setDetached`
     * tears down only on `!detached`, which a scratch→scratch rebind never reaches because both bindings
     * are detached. **WHAT KEEPS ONE FROM BEING LEFT MOUNTED THERE IS UPSTREAM OF BOTH**:
     * `pane-host.ts`'s same-leg `rebind` arm takes the outgoing editor into custody before the binding
     * moves, so a pane whose binding has moved away is, in the ordinary case, holding nothing by the time
     * anyone asks. See the standing note at the top of `reconcileEditors` for what closes it.
     *
     * **A SECOND CALLER ARRIVED AND IT READS THIS THE OTHER WAY UP — 5d-ii-d, whole-branch review.**
     * `pane-host.ts`'s `mountScratchEditor` asks this before it BUILDS an editor for a pane that has just
     * come to be bound to a warm buffer, and mounts only when the answer is `false`. That is deliberately
     * the same predicate `draw()` feeds `setEditorAvailable`, so the two are complementary by
     * construction: an editor that exists is moved by the user's click on the control this gate offers,
     * and one that does not exist is built there. Between them every pane bound to a warm buffer has a
     * route to an editor — which is what withdrawing the control honestly requires, since "provably
     * cannot work" was only true of the MOVE, never of "this buffer can be edited at all".
     *
     * NOT COUNTING IT IS STILL RIGHT, AND FOR A REASON THAT DOES NOT DEPEND ON THE FALSE CLAIM: the
     * question this method answers is "would the click work", and there it would not. Claiming records
     * `editorOwner.set(session, myLeaf)` and waits for the sweep — which skips the holder for the same
     * binding reason, so nothing arrives. Withdrawing the control there is item 1's standard applied
     * correctly to a control that provably cannot work, and it is what the old gate got wrong by
     * offering it. The stale editor is a separate wrong that a `true` here would not have fixed.
     *
     * For what this doc used to claim and why it changed, see the history note under `hasEditor`.
     */
    hasEditor(session: SessionId): boolean {
      return heldEditors.has(session) || editorHomeFor(session)?.holdsEditor() === true
    },
    reconcile: reconcileEditors,
  }
}
