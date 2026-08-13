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
   * the retirement of its session, whichever comes first — and BOTH ENDINGS ARE NOW REACHED BY THE SAME
   * FUNCTION, which they were not when this sentence was first written: retiring used to happen on a
   * path that never reconciled, so the second ending never arrived. See `reconcileEditors`' own doc.
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
   * `tests/browser/two-lambda-panes.test.ts`'s concatenation test is the result.
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
   * An editor taken off a pane that is still ON SCREEN and no longer wants it (the REBIND-away case) is
   * destroyed, because the session behind it is one the user has navigated away from; an editor whose
   * pane was CLOSED is a different case and is not destroyed — see the custody pass below.
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
   * WEAKEST OF THEM.** (1) EVERY RETIRE SWEEPS EVERY HELD EDITOR: both retire sites — `compile.ts`'s
   * recompile-from-source and `replies.ts`'s phantom-fork `no-session` — call this function, AND its
   * custody pass iterates `heldEditors` itself, so no custody entry can outlive the incarnation of the
   * session it is keyed by. **The second half of that sentence is the third round's correction and it is
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
   * A HELD EDITOR WHOSE SESSION IS GONE IS DESTROYED HERE. `LambdaScratchpad.retire` removes the entry
   * from the registry and rebinds every pane back to source, so no pane will ever ask for that editor
   * again — and `replies.ts`'s `editorHome()?.setEditor(null)`, the call that would normally tear an
   * editor down, resolves to `undefined` for a session whose owning pane is closed and is therefore a
   * no-op. (It resolves to `undefined` after ANY retire, in fact — `retire` rebinds every slot before it
   * returns, so `editorHomeFor` can no longer match one — which is why `compile.ts` no longer calls it
   * at all; that file's own doc has the measurement.) Without this line a retirement during custody
   * would leak one live `EditorView` with its own pending debounce over a terminated worker.
   */
  const reconcileEditors = (): void => {
    for (const session of editorOwner.keys()) {
      const home = editorHomeFor(session)
      for (const p of panes.of('lambda')) {
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
    reconcile: reconcileEditors,
  }
}
