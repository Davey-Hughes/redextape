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
 * BOTH DEPENDENCIES ARE TAKEN AS VALUES RATHER THAN THUNKS, unlike `createLinkWiring`'s `view`/`draw`:
 * `main.ts` constructs `PaneCollection` and `SessionRegistry` before this call and never reassigns
 * either, and both are read live through their own methods, so there is no late-binding problem of the
 * kind the thunks there exist to solve. `panes` is handed over EMPTY — `applyLayout` is the only thing
 * that ever populates it — and nothing here reads it before the first `applyLayout()` has run.
 */
export function createEditorCustody(deps: { panes: PaneCollection; sessions: SessionRegistry }): EditorCustody {
  const { panes, sessions } = deps

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
   * SET IN TWO PLACES ONLY: `paneEvents`'s wrapped `detach` (the first mount, at the moment a fork
   * succeeds) and its `showEditor` (every later move). Nothing else ever writes this map — a rebind
   * away from the scratch leaves the entry stale on purpose, per the paragraph above.
   */
  const editorOwner = new Map<SessionId, LeafId>()

  /**
   * A session's `LambdaEditor` while NO pane holds it — custody between the close of the pane that had
   * it and the claim of the pane that asks for it next.
   *
   * **IMPORTANT FINDING, WHOLE-BRANCH REVIEW BEFORE MERGE: WITHOUT THIS, CLOSING THE HOLDER STRANDED
   * THE EDITOR AND THE CONTROL TO RETRIEVE IT STAYED OFFERED.** `applyLayout` drops a closed pane from
   * `panes` before anything asks it for its editor, and `reconcileEditors` only ever iterates
   * `panes.of('lambda')` — so the `LambdaEditor` was left mounted in a host no longer in the tree, with
   * nothing holding a reference that could reach it. Meanwhile the surviving pane, still bound to the
   * scratch and still holding no editor, kept offering "bring the term editor to this pane"
   * (`LambdaPane.#refreshClaim`'s `#detached && #editor === null`), and clicking it did nothing —
   * forever. **That is the exact failure this slice's own standard names first: a control that provably
   * cannot work must not be offered.** Rather than withdraw the control, the editor is taken into
   * custody so the control works — which is what design §4.3 promises in as many words: "the next pane
   * to ask for the editor re-mounts the same view with its text, cursor and undo intact".
   *
   * KEYED BY SESSION, NOT BY THE CLOSED `LeafId`, because that is the key the next claim arrives under:
   * `showEditor` writes `editorOwner.set(slot.binding.session, id)` and `reconcileEditors` asks per
   * session. Keying by the closed leaf would be keying by something no claim ever mentions.
   *
   * **THE PREMISE THIS USED TO ARGUE FROM IS FALSE, AND THE CORRECTED ONE POINTS THE SAME WAY — Minor
   * finding, re-review of this fix.** It read "the closed leaf's id is never reused (`nextLeafId` only
   * counts up), so keying by it would be keying by something nothing can ask for again". `nextLeafId`
   * does only count up, but it is not the only source of ids: `defaultLayout()` writes `source`,
   * `lambda-0` and `tm-0` down as literals and `reset layout` re-mints all three, so a closed `lambda-0`
   * comes back — and `parseLayout` can restore any id a stored tree holds. A leaf id is therefore a
   * WEAKER key than a session, not merely a differently-shaped one: it can be inherited by a pane that
   * has nothing to do with the one that claimed the editor. `applyLayout`'s pane-creation loop drops
   * exactly that inheritance for `editorOwner` (which IS keyed by leaf) where it happens.
   *
   * NOT A SECOND HOME. Nothing renders from here and nothing reads through it — it is exactly the "one
   * instance, unmounted, not destroyed" state design §4.3 describes, made addressable. An entry lives
   * only from the close that produced it to the next `reconcileEditors` that finds a home for it, or to
   * the retirement of its session, whichever comes first — and BOTH ENDINGS ARE REACHED BY THE SAME
   * FUNCTION, which they were not when this sentence was first written: retiring used to happen on a
   * path that never reconciled, so the second ending never arrived. **The second ending went briefly
   * unreachable for a different reason and is reachable again** — 5d-ii-c decision 2 left nothing in
   * `src/` calling `ScratchBuffers.retire` at all, which did not weaken the arrangement so much as leave
   * it idle, and §4.2's header list supplied the trigger: `main.ts`'s retire handler calls `retire` and
   * then `reconcile`, in that order. See `reconcileEditors`' own doc.
   *
   * **AND "THE SAME FUNCTION" WAS NOT ENOUGH ON ITS OWN — IMPORTANT FINDING, THIRD REVIEW ROUND.** That
   * function ran both its passes inside one loop over `editorOwner.keys()`, so it could only reach an
   * entry HERE for a session that also held a claim — and the Minor fix beside this one (`applyLayout`'s
   * pane-creation loop, which drops a claim recorded against an arriving leaf id) deletes exactly that
   * claim while the entry stays. The two endings then both went missing for the same entry: no home was
   * ever found for it, and its session's retirement swept nothing. `reconcileEditors` now iterates THIS
   * MAP for its custody pass rather than the claim map, which is what makes the sentence above a fact
   * about the code rather than about the common case.
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
   * un-collapses an editor this pane ALREADY owns, and moves nothing. The two carried the same label
   * until a review pointed out that a screen-reader user heard one name for both.
   * `replies.ts`'s `scratch-compiled` case is the other way ownership takes
   * effect, and it needs no such sweep — `editorOwner` already names the right pane by the time a reply
   * can arrive (`paneEvents`'s wrapped `detach` sets it synchronously, before the worker round trip that
   * produces one), so `setEditor` there lands directly.
   *
   * **TWO PASSES OVER TWO DOMAINS, AND THE SECOND DOMAIN IS AN IMPORTANT FINDING OF THE THIRD REVIEW
   * ROUND.** The sweep is a statement about CLAIMS, so it iterates `editorOwner`; custody is a statement
   * about an editor with nowhere to be, so it iterates `heldEditors`. Both passes used to live inside
   * ONE loop over `editorOwner.keys()`, which made this function's opening sentence — then, as now, a
   * claim about EVERY editor — false of any held editor whose session held no claim. That is not a
   * hypothetical state: the Minor fix in the same commit as the custody one has `applyLayout`'s
   * pane-creation loop DROP the claim recorded against an arriving leaf id, and `reset layout` re-mints
   * `defaultLayout()`'s literal ids, so dropping it is exactly what `reset layout` does after a close.
   * **Six clicks, and both fixes are individually correct**: fork `lambda-0`, close it, `reset layout`
   * (drops the claim, leaves the entry), type in the SOURCE editor (retires the scratch — and the sweep
   * this retire calls could not see the entry, so the editor over the terminated worker survived), fork
   * again on the fresh `lambda-0` (a second, live editor, mounted legitimately), then split any pane.
   * The custody pass then handed the live pane the dead editor and `receiveEditor` threw. What caught
   * it was concatenating the two tests those two fixes shipped with — neither sequence reaches it alone;
   * `tests/browser/two-lambda-panes.test.ts`'s concatenation test is the result. **THOSE SIX CLICKS NO
   * LONGER REPRODUCE IT, AND THE FIX THEY ARGUE FOR IS UNCHANGED**: 5d-ii-c decision 2 makes the fourth
   * of them — typing in the source editor — retire nothing, so the sequence stops one step short of the
   * destroy branch. See (1) below for where the retire went.
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
   * **WHICH LINE PERFORMS THAT DESTRUCTION MOVED, AND THE OUTCOME DID NOT.** It read "an editor TAKEN
   * OFF a pane… is destroyed", meaning the `held.destroy()` below; a rebound-away pane no longer names
   * the session, so the binding predicate on the loop skips it now. `LambdaPane.setDetached`'s own
   * teardown is what tears that editor down — it fires from `PaneSlot.render` on the very next `draw()`,
   * which is the same tick, and `scratch-rebind-editor.test.ts` is the test that pins it. The branch
   * below still answers the case it was written for: a pane that IS on the session while the session
   * holds no home for it, which is what a claim pointing at a closed leaf leaves behind.
   *
   * **AND THAT HANDOVER COVERS ONLY THE REBIND TO SOURCE — A SCRATCH→SCRATCH REBIND LEAKS THE EDITOR,
   * WHICH IS A LIVE DEFECT RECORDED HERE AND NOT FIXED HERE (Important finding, review of the
   * deferred-a11y item 11 fix; filed on the roadmap's 5d-ii-c entry).** `setDetached` tears down only on
   * `!detached`, and both sides of a scratch→scratch rebind are detached, so it does not fire.
   * `scratch-rebind-editor.test.ts` — the test named above as pinning this — drives the rebind back to
   * SOURCE and only that, so the gap has never been under a test. The binding predicate on the sweep's
   * loop then skips the pane for the session it still holds an editor for, and the custody pass never
   * sees the editor because nothing ever handed it over. **Result: pane P shows buffer B's frames with
   * buffer A's live CodeMirror mounted above them, permanently** — and `transport.ts`'s `editScratch`
   * reads `slot.binding.session` at EDIT time, so a keystroke in that stale editor calls
   * `recompile(B, <A's text>)`. The shape of the fix is the wrapped `detach` in `pane-host.ts`: that
   * handler already compares the binding before and after and tells this file what happened, and a
   * wrapped `rebind` that hands the outgoing editor to `hold(oldSession, …)` is the same move — an
   * editor whose pane navigated away is exactly the "unmounted, not destroyed, waiting for the next pane
   * to ask" state `heldEditors` exists for. It is left undone deliberately rather than folded into an
   * a11y fix it has nothing to do with.
   *
   * THE CUSTODY PASS IS SECOND, AND THE ORDER IS LOAD-BEARING. It mounts a `heldEditors` entry onto the
   * home if there now is one, and it runs AFTER the sweep so that a home which has just been handed an
   * editor by the sweep is not handed a second one. Splitting the two passes apart (above) STRENGTHENED
   * that ordering rather than weakening it: every sweep now runs before any custody mount, where before
   * only the sweep for the same session did.
   *
   * **WHAT THAT ORDER DOES AND DOES NOT BUY, CORRECTED — IMPORTANT FINDING, RE-REVIEW OF THIS FIX.**
   * This paragraph used to assert that "the two can never both fire for one session (there is one editor
   * per session, so if a pane holds it, custody does not)". **That was false across a retire, and the
   * six-step sequence in `tests/browser/two-lambda-panes.test.ts` is the falsification.** The λ scratch's
   * session id is a CONSTANT that the next fork re-registers, so a custody entry keyed by it survived
   * its session's death — the retire path called `draw()` and never `applyLayout()`, so the
   * `!sessions.has(session)` branch below never ran — and a later fork then mounted a SECOND editor for
   * the same id on the pane the stale entry named. Both did fire, `receiveEditor` overwrote a live
   * `#editor`, and design §4.3's structurally impossible state was on screen: two `.cm-editor`s in one
   * pane, the pane pointing at the one over the terminated worker and the live one orphaned in the DOM.
   *
   * **WHAT IS TRUE NOW IS A CONJUNCTION OF THREE THINGS, AND THE ORDER OF THE TWO PASSES IS ONLY THE
   * WEAKEST OF THEM.** (1) EVERY RETIRE SWEEPS EVERY HELD EDITOR: a retire calls this function, AND its
   * custody pass iterates `heldEditors` itself, so no custody entry can outlive the incarnation of the
   * session it is keyed by. **THAT CLAUSE USED TO NAME TWO CALLERS — "`replies.ts`'s phantom-fork
   * `no-session`, and until 5d-ii-c decision 2 `compile.ts`'s recompile-from-source beside it" — AND IT
   * NAMES ONE NOW.** Decision 2 deleted the second of those two as well, leaving nothing in `src/`
   * retiring at all; design §4.4's header list is what supplies the retire today, and the obligation is
   * discharged in that list's own handler (`main.ts`), which calls `ScratchBuffers.retire` and then this
   * function. **The branch was unreachable in between and is unchanged**, and the gesture that drives it
   * is the list's retire control. **The second half of that sentence is the third round's correction and it is
   * not a detail**: while both passes shared one loop over `editorOwner.keys()`, "every retire sweeps"
   * described a function whose body could not see an entry no claim named, and one existed after every
   * `reset layout`. (2) `receiveEditor` THROWS rather than overwriting, so if the two ever do both fire,
   * the app says so at the moment of the mistake instead of silently orphaning a live view — and the
   * throw now costs the caller its gesture and nothing more (see `applyLayout`'s `try`/`finally`).
   * (3) The order below then means that even a case satisfying both — a session with an editor mounted
   * on a pane AND an entry in custody — hands the sweep's editor over first, so custody's throw names
   * the sweep as the arrival that got there first. WITHIN one page-load incarnation the old sentence is
   * still true and still worth keeping for that reason: there is one editor per session, so if a pane
   * holds it, custody does not.
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
   * **TWO THINGS THE SWEEP DID NOT SAY UNTIL BUFFERS WENT PLURAL, BOTH ON THE LOOP BELOW AND BOTH WITH
   * THEIR OWN COMMENTS THERE.** Its outer walk skips a claim whose SESSION the registry no longer holds,
   * and its inner walk skips a pane whose own BINDING names a different session. Neither was a
   * distinction 5d-i could draw: with one fixed scratch id there was one claim at a time and one editor
   * at a time, so "every claim" and "the live one", "every λ pane" and "the panes that could be holding
   * this session's editor", were the same sets. A fork that mints its own buffer (5d-ii-c decision 1)
   * separates both pairs, and each was a live defect on the day it did — a retired buffer's claim
   * destroying a live buffer's editor, and one buffer's editor being handed to another buffer's home
   * where `receiveEditor` throws.
   *
   * A HELD EDITOR WHOSE SESSION IS GONE IS DESTROYED HERE. `ScratchBuffers.retire` removes the entry
   * from the registry and rebinds the panes that were on THAT BUFFER back to source (it rebinds no
   * others — the sentence here said "every pane", which was the singleton's arithmetic rather than
   * `retire`'s rule), so no pane will ever ask for that editor again — and `replies.ts`'s
   * `editorHome(session)?.setEditor(null)`, the call that would normally tear an editor down, resolves
   * to `undefined` for a session whose owning pane is closed and is therefore a no-op. Without this line
   * a retirement during custody would leak one live `EditorView` with its own pending debounce over a
   * terminated worker.
   *
   * **NO CALLER IN `src/` REACHED THIS BRANCH FOR THREE TASKS, AND THE DEBT THAT LEFT IS PAID HERE.**
   * It is guarded by `!sessions.has(session)`, and only `retire` removes a session — 5d-ii-c decision 2
   * deleted both of the app's implicit retires (`compile.ts`'s recompile-from-source, then `replies.ts`'s
   * phantom-fork `no-session`), and design §4.4's header list then supplied the explicit one. **The
   * regression guard was lost rather than moved in between**, which `tests/browser/two-lambda-panes.test.ts`
   * recorded from the layout side. `tests/browser/editor-custody.test.ts` is what pays it back, and it
   * does so by constructing THIS factory rather than a stand-in: the test that appeared to drive this arm
   * before was counting a STUBBED `reconcileEditors` and measured its call site, never the destroy. It
   * covers this branch and the two beside it — the claim drop above and the `held.destroy()` in the
   * sweep — because all three went dark for the same reason and only one of them had a paragraph.
   * (This paragraph's parenthesis used to add that the narrow `editorHome` thunk `compile.ts` held was a
   * no-op on every path that reached it — a fact about a file that has held no retire branch since
   * decision 2.)
   */
  const reconcileEditors = (): void => {
    for (const session of editorOwner.keys()) {
      // **A CLAIM FOR A SESSION THAT NO LONGER EXISTS IS DROPPED HERE, AND WITHOUT THIS LINE ONE
      // BUFFER'S RETIREMENT DESTROYED ANOTHER BUFFER'S LIVE EDITOR.** Nothing else ever erases an entry
      // for a retired session: `dropClaimsOn` is keyed by LEAF and only fires for a leaf arriving
      // without a pane, so a claim whose pane simply stayed put outlives the session it names forever.
      // That was harmless while `main()` had ONE scratch id — the next fork re-registered the same key,
      // so the stale entry and the live one were the same entry — and it stopped being harmless the
      // moment a fork minted a fresh id per call (5d-ii-c decision 1): `editorHomeFor` answers
      // `undefined` for the dead session, and the loop below then takes the editor off EVERY λ pane and
      // destroys it, including the one a later fork had just legitimately mounted for a different
      // buffer. Measured as two λ panes both reading `[detached]` with no `.term-editor` between them.
      //
      // THE MOUNTED EDITOR OF THE RETIRED SESSION STILL COMES DOWN, WHICH IS WHY SKIPPING IS SAFE
      // RATHER THAN MERELY NARROWER: `ScratchBuffers.retire` rebinds the panes on that buffer — and no
      // others, which is its rule rather than the singleton's arithmetic — back to `home`, and the
      // `draw()` that follows drives `PaneSlot.render` -> `LambdaPane.setDetached(false)`, whose own
      // teardown calls `setEditor(null)`.
      //
      // **THE RETIRE SITE IS WHAT CALLS THIS FUNCTION, AND THIS SENTENCE USED TO READ AS THOUGH
      // SOMETHING ELSE DID.** It said the rebinding happened "before the retire site calls this
      // ('either retire site' until 5d-ii-c decision 2 deleted `compile.ts`'s)" — an enumeration left
      // over from the two implicit retires, kept alive past the deletion of both, and contradicting the
      // two paragraphs this slice added above. There is one retire in the app: `main.ts`'s header-list
      // handler, which calls `ScratchBuffers.retire`, then this, then `draw()`, in that order. The
      // ordering above is a fact about that handler, and the obligation to call this at all is stated
      // there rather than inferred here.
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
        // **THAT IS TRUE OF THE REBIND TO SOURCE AND FALSE OF A SCRATCH→SCRATCH ONE, WHERE THIS `continue`
        // IS THE LINE THAT LETS THE EDITOR LEAK.** `setDetached` does not fire its teardown when both
        // bindings are detached, so nothing takes the editor down and this skip means nothing here does
        // either. Recorded in full in this function's own doc above, with the shape of the fix; not
        // fixed on the branch that found it.
        if (p.slot.binding.session !== session) continue
        const pane = p.pane as LambdaPane
        if (pane === home) continue
        const held = pane.takeEditor()
        if (held === null) continue
        if (home !== undefined) home.receiveEditor(held)
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
        home.receiveEditor(waiting)
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
     * offered in, since claiming it is how the user gets the editor back (`heldEditors`' own doc, and
     * the whole-branch finding recorded there).
     *
     * **AN EDITOR MOUNTED ON A PANE WHOSE BINDING HAS MOVED AWAY IS NOT COUNTED, AND THIS PARAGRAPH USED
     * TO JUSTIFY THAT WITH A CLAIM THAT IS FALSE — Important finding, review of this fix.** It read that
     * such an editor "is an ORPHAN by this file's own definition — `reconcileEditors` takes it down on
     * the next sweep". The sweep does no such thing: its inner loop opens with `if (p.slot.binding.session
     * !== session) continue`, which skips exactly the rebound-away pane, and `LambdaPane.setDetached`
     * tears down only on `!detached`, which a scratch→scratch rebind never reaches because both bindings
     * are detached. So the editor stays mounted, indefinitely. **That is a live defect and it is not this
     * one** — see the standing note at the top of `reconcileEditors`, where it is recorded in full.
     *
     * NOT COUNTING IT IS STILL RIGHT, AND FOR A REASON THAT DOES NOT DEPEND ON THE FALSE CLAIM: the
     * question this method answers is "would the click work", and there it would not. Claiming records
     * `editorOwner.set(session, myLeaf)` and waits for the sweep — which skips the holder for the same
     * binding reason, so nothing arrives. Withdrawing the control there is item 1's standard applied
     * correctly to a control that provably cannot work, and it is what the old gate got wrong by
     * offering it. The stale editor is a separate wrong that a `true` here would not have fixed.
     */
    hasEditor(session: SessionId): boolean {
      return heldEditors.has(session) || editorHomeFor(session)?.holdsEditor() === true
    },
    reconcile: reconcileEditors,
  }
}
