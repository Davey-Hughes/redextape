import type { EditorView } from '@codemirror/view'
import type { AsmPane } from './asm-pane'
import { seedAsm } from './asm-seed'
import { setFocus } from './highlight'
import type { LambdaPane } from './lambda-pane'
import type { LambdaTrees } from './lambda-trees'
import { unhandled } from './legs'
import { isCoincident, type Link, runningFocus, sourceNodeOwner } from './link'
import type { LambdaLinkState } from './link-status'
import type { LinkWiring } from './link-wiring'
import { type LeafId, onPage, type PaneCollection } from './panes'
import {
  asmCopyParts,
  asmCopySegments,
  copyLegOf,
  copyRows,
  type Lines,
  lambdaCopyParts,
  lambdaCopySegments,
  type ProgramResult,
  programRows,
  programSegments,
  tmCopyParts,
  tmCopySegments,
} from './readout'
import type { SessionId } from './session-client'
import type { SessionRegistry } from './sessions'
import type { TmPane } from './tm-pane'
import { seedTm } from './tm-seed'

/**
 * ONE FRAME, PAINTED ONCE — the per-frame pass that runs on every recorded frame during playback.
 *
 * THE ORDER INSIDE IT IS LOAD-BEARING AND THE COMMENTS SAYING SO MOVED WITH IT. The tm-kind branch of
 * the render loop below calls `setFocus` before `PaneSlot.render` because `TmPane`'s `#drawTable` runs
 * unconditionally on every render, so a focus handed over afterwards would build every row against the
 * previous frame's value and rebuild them all on the next call. Read the inline notes before reordering
 * anything here.
 *
 * `view` IS A THUNK, NOT A VALUE, AND NOT IN THE TASK'S ORIGINAL SIGNATURE — `main.ts` declares
 * `let view: EditorView` and does not assign it until the `EditorView` construction runs, well after
 * this factory is called, so a value parameter would capture `undefined` forever. Same shape
 * `link-wiring.ts` already uses for the same variable and the same reason.
 *
 * `panes: PaneCollection` REPLACES `lambdaSlot`/`tmSlot`/`lambdaPane`/`tmPane` (T7). No longer "still
 * two panes, still the same two hosts" as of T12 (5d-ii-a): `pane-host.ts`'s `applyLayout` derives which
 * panes exist from the layout tree, so a leg can now hold any number of panes — only the route to them
 * (through the collection rather than a fixed pair of consts) stayed the same. See `PaneCollection`'s
 * own doc for why `of`/`ofSession` read the binding through the slot on every call rather than caching
 * it.
 *
 * `leaves: () => number` IS T12's OWN ADDITION, AND A THUNK RATHER THAN A NUMBER FOR THE SAME REASON
 * `view` IS ONE: the leaf count changes under a split or a close, and `draw()` runs on every recorded
 * frame during playback, so a value captured once at construction would go stale the first time either
 * happened. `draw.ts` DOES NOT IMPORT `layout.ts` TO COMPUTE THIS ITSELF — `main.ts` holds the one
 * `LayoutNode` this app has; a second way to ask "how many leaves" here would be a second opinion about
 * a tree this module has no other reason to know exists.
 *
 * `sourceAvailable: () => boolean` IS `leaves`' SIBLING IN EVERY RESPECT — another fact about the one
 * tree `main.ts` holds, asked live because a split or a close moves it, and phrased as a thunk over that
 * tree rather than as a `layout.ts` import here for the reason above. It is the one input the split
 * picker needs that this module cannot already see: `SessionRegistry.pairs()` and each pane's own
 * binding, which are the rest of a `SplitChoices`, are both already in the loop below's hands.
 *
 * `hasEditor: (session) => boolean` IS THE SAME SHAPE AGAIN, over the OTHER thing `main.ts` owns and
 * this module has no other route to: `editor-custody.ts`'s two maps. A view cannot work out whether
 * its session has an editor anywhere — that is a fact about other panes and about the editors waiting
 * between them — so `LambdaPane.setEditorAvailable` is fed from here, per frame, alongside `renderTree`,
 * and the TM and asm views' `setEditorAvailable` in the pass over every view.
 * A thunk for the same reason as its two siblings: custody moves under a `draw()` that did not cause it.
 */
export function createDraw(deps: {
  view: () => EditorView
  sessions: SessionRegistry
  panes: PaneCollection
  links: LinkWiring
  /** The λ trees the views draw — asked here for each connected view's displayed step (spec §4). */
  trees: LambdaTrees
  /** TM and asm views a machine reached while they were off the page (`replies.ts`); each is seeded when next shown. */
  unseen: WeakSet<TmPane | AsmPane>
  leaves: () => number
  sourceAvailable: () => boolean
  hasEditor: (session: SessionId) => boolean
  /** The view the user is in — the readout describes its session (spec §9). */
  focused: () => LeafId
  /** The program's session id, `main.ts`'s `SOURCE_SESSION`, passed in rather than re-spelled here. */
  sourceSession: SessionId
  readout: { show(program: ProgramResult | null, lines: Lines): void }
  /** The program's last result, as `replies.ts` stored it. */
  program: () => ProgramResult | null
  /**
   * Whether a view draws its own step controls — spec §8's `steps` switch. A thunk, for `leaves`' reason:
   * the switch moves under a `draw()` that did not cause it.
   */
  stepsInView: () => boolean
  /** Whether the views are drawn as a stage — spec §5. A thunk, for `leaves`' reason. */
  stage: () => boolean
  /** The one bottom bar, brought up to date once per frame after every pane has been painted (spec §8). */
  stepBar: { update(): void }
  /** The stage's tabs, whose labels follow their views' titles — brought up to date once per frame in Stage (§5). */
  stageTabs: { update(): void }
  nameOf: (session: SessionId) => string | null
}): () => void {
  const {
    view,
    sessions,
    panes,
    links: linkWiring,
    trees,
    unseen,
    leaves,
    sourceAvailable,
    hasEditor,
    focused,
    sourceSession,
    readout,
    program,
    nameOf,
    stepsInView,
    stage,
    stepBar,
    stageTabs,
  } = deps
  return () => {
    // "THE" λ, ASM AND TM PANES, RESOLVED THROUGH THE COLLECTION RATHER THAN CLOSED OVER — AND ANY MAY
    // BE ABSENT. This block used to destructure `of(leg)[0]` and throw when it came back `undefined`,
    // on the strength of "`main.ts` always registers one pane of each leg before `draw` can be called".
    // That was true while panes were two consts and false from the moment `applyLayout` began deriving
    // them from the layout tree: `closeLeaf` refuses only the last leaf in the TREE, so `leaves() > 1`
    // offers `close` on the single λ pane a fresh page ships, and clicking it left this throwing on
    // every subsequent frame. Worse, `applyLayout` persists the new tree BEFORE calling `draw()`, so
    // the λ-less arrangement was already committed to `localStorage` and the dead app came back on
    // reload — only `reset preset` escaped it. `PaneCollection.active` is now the one place that
    // answers this question, and it answers `undefined` when the leg is empty; see its own doc for why
    // all four consumers were once holding the same expired invariant privately, and for how it now
    // picks among several panes on the same leg — the pane the user focused most recently, falling back
    // to insertion order (5d-ii-b).
    //
    // A LEG WITH NO PANE CONTRIBUTES NOTHING, RATHER THAN BEING FAKED WITH A DEFAULT. The scalar reads
    // below (`tmFocus`'s `tm.hist...`, the source editor's `lam.hist...`) feed the ONE shared status
    // line and the ONE source editor's decoration, neither of which has a per-pane identity yet. What a
    // leg with NO pane should contribute has an answer today, and it is `null` at both sites.
    //
    // **EACH LEG'S RUNNING FOCUS IS THE PROGRAM'S, SO IT IS READ OFF A VIEW OF THE PROGRAM — `onProgram`.** It
    // resolves against the program's link index and marks the program's rows, and a copy's frames own no construct
    // of the program's. Read off whichever view was focused last, it went blank the moment that view showed a copy:
    // the program's own view lost its marks, in Stage even while it was the view shown and being stepped. So each
    // leg asks for the most recently focused view that shows the program, and a copy's view is never the source.
    // With no view of the program on a leg, that leg has no running focus, as a leg with no view has none.
    //
    // **WHICH PANE ANSWERS DEPENDS ON WHAT THE READER READS.** `lam`, `asm` and `tm` ask `active` — in Stage
    // possibly a view off the page. They read the leg's own history through the pane's binding, which is live
    // whether or not the pane is drawn, so a hidden pane still answers truly for its session; and part 2's spec §8
    // keeps the step bar on "the last view that could" step, so a hidden view's leg can still move. The λ link
    // clause at the end of this function asks `shown` instead, because it reads a view's own pin and tree, which
    // only a view on the page has fresh (`PaneCollection.shown`'s doc).
    const onProgram = (e: { readonly slot: { readonly binding: { readonly session: SessionId } } }): boolean =>
      !sessions.entryOf(e.slot.binding.session).detached
    const lam = panes.active('lambda', onProgram)?.slot.resolve(sessions)
    const tm = panes.active('tm', onProgram)?.slot.resolve(sessions)
    // THE TM LEG'S OWN RUNNING FOCUS — `TmState.source_node`, NOT `lam.hist.current?.owner` below.
    // Design table (`2026-08-10-plan5c-dual-focus-design.md` §4.2): "TM: TmState.source_node,
    // resolved through SourceMap::tm_owner ... none; shipped 2026-07-30." Each pane reports what ITS
    // OWN leg is doing right now — the two clocks never synchronize (§0: `map_fold` is 555 β-steps
    // against 266,863 δ-steps), so feeding the δ-table from the λ leg's owner would show it whatever
    // the OTHER model was doing, not its own. `sourceNodeOwner` wraps the already-resolved node id as
    // an `Owner` so it goes through the same `runningFocus` every other leg does.
    //
    // COMPUTED BEFORE THE RENDER LOOP BELOW, NOT AFTER — ONE `#drawTable` PER FRAME, NOT TWO. Nothing
    // here reads anything a render writes (`runningFocus` wants `linkable`/`index`/`tm.hist`, none of
    // which `PaneSlot.render` touches), so hoisting this ahead of the (now leg-agnostic) render loop
    // changes nothing observable — it only has to be resolved before the loop reaches a tm-kind pane,
    // which the loop's own comment covers.
    //
    // `tm !== undefined` IS A THIRD GATE ALONGSIDE `linkable`/`index`, NOT A NULL-CHECK BOLTED ON. With
    // no TM view of the program there is no TM leg of the program's being watched, so there is nothing for a
    // running focus to mark — and feeding `sourceNodeOwner(null)` through anyway would report a definite "the
    // machine is nowhere" where the honest answer is "no one is asking".
    const tmFocus =
      linkWiring.linkable && linkWiring.index !== null && tm !== undefined
        ? runningFocus(linkWiring.index, sourceNodeOwner(tm.hist.current?.source_node ?? null))
        : null
    const tmFocusLink: Link | null =
      tmFocus !== null && linkWiring.index !== null ? linkWiring.index.linkFor(tmFocus.node) : null
    // THE ASM LEG'S OWN RUNNING FOCUS, BY THE TM LEG'S RULES (Plan 7 part 5 spec §6.6): `AsmState.source_node`, the owner
    // of the instruction about to run, read off the asm view of the program the user focused most recently, and
    // nothing when no asm view of the program is asking. It marks the program's asm views' rows and feeds the status
    // line's coincidence; the source editor's focus mark stays λ's, as Plan 5c's dual-focus design settled.
    const asm = panes.active('asm', onProgram)?.slot.resolve(sessions)
    const asmFocus =
      linkWiring.linkable && linkWiring.index !== null && asm !== undefined
        ? runningFocus(linkWiring.index, sourceNodeOwner(asm.hist.current?.source_node ?? null))
        : null
    const asmFocusLink: Link | null =
      asmFocus !== null && linkWiring.index !== null ? linkWiring.index.linkFor(asmFocus.node) : null

    // THE PICKER'S TWO SHARED INPUTS, RESOLVED ONCE PER FRAME RATHER THAN ONCE PER PANE. Both answers
    // are app-wide — every pane may be pointed at the same set of pairs, and "is there a source leaf" is
    // a question about the one tree — so this is the same fan-out `tmFocusLink` above already performs,
    // and it keeps the per-pane cost of the `setLayoutControls` call below to one small object.
    // `PaneSlot.render` calls `pairs()` again for the binding selector; hoisting THAT would mean handing
    // the slot a list it is documented to fetch for itself.
    const pairs = sessions.pairs()
    const canCreateSource = sourceAvailable()

    // THE DRAW PASS, OVER EVERY PANE RATHER THAN EXACTLY TWO (T7's conversion of the render calls).
    // `setFocus` still runs BEFORE `render` for a tm-kind pane and for the reason above; `tmFocusLink`
    // is the SAME value handed to every tm-kind pane found here, matching `setFocus`'s per-leg
    // classification — it is app-wide link state every pane on the tm leg follows, not something each
    // pane recomputes for itself. `p.pane` NEEDS THE CAST: `PaneCollection` stores it as `PaneView<T>`,
    // the narrow structural type `PaneSlot.render` needs (see that type's own doc in `sessions.ts`),
    // which does not carry `setFocus` — a fact about the CONCRETE `TmPane` class, not about what a
    // slot's render pass requires. Safe here because `p.slot.binding.leg === 'tm'` is exactly the
    // condition under which `pane-host.ts` ever constructs a `PaneEntry` with a `TmPane` in `.pane`.
    for (const p of panes.all()) {
      // **A VIEW THAT IS NOT ON THE PAGE IS NOT PAINTED** (spec §5). In Stage every host but one is in
      // `pane-host.ts`'s map and out of the document, and a `render` into a detached subtree is work whose
      // only observer is the next `innerHTML` read. Selecting a tab re-attaches the host and ends in a
      // `draw()`, so nothing comes back stale.
      if (!p.host.isConnected) continue
      // ONE LOCAL FOR THE ONE CAST THIS WHOLE PANE NEEDS — `p.pane` IS `PaneView<T>`, the narrow type
      // `PaneSlot.render` requires (see that type's own doc), which does not carry `TmPane`'s own
      // methods; `null` on a non-tm leg keeps every read below honest about which leg it is on.
      const tmPane = p.slot.binding.leg === 'tm' ? (p.pane as TmPane) : null
      const tmSeeded = tmPane !== null && unseen.has(tmPane)
      if (tmSeeded) {
        const entry = sessions.entryOf(p.slot.binding.session)
        seedTm(tmPane, entry.tmProgram, entry.tmScratch)
        unseen.delete(tmPane)
      }
      // AN ASM VIEW THAT MISSED WHAT ITS SESSION WAS TOLD, by being off the page when it came, is seeded from what the
      // session kept — `seedTm`'s arrangement above, one leg over.
      const asmPane = p.slot.binding.leg === 'asm' ? (p.pane as AsmPane) : null
      const asmSeeded = asmPane !== null && unseen.has(asmPane)
      if (asmSeeded) {
        const entry = sessions.entryOf(p.slot.binding.session)
        seedAsm(asmPane, entry.asmProgram, entry.asmScratch)
        unseen.delete(asmPane)
      }
      const leg = p.slot.resolve(sessions)
      // **A MACHINE VIEW SHOWING A COPY MARKS NOTHING OF THE PROGRAM'S** — neither its running focus here nor its pin
      // below. Both resolve to the PROGRAM's state and instruction indices, and a copy numbers its rows by itself, so
      // an index read there names whatever the copy has at it (spec amendment 32, in the inbound direction): the λ
      // loop's guard below, "A COPY IS NOT LINKED", for the machine views. Asked only of a TM or asm view.
      const unlinked = (tmPane !== null || asmPane !== null) && sessions.entryOf(p.slot.binding.session).detached
      if (tmPane !== null) tmPane.setFocus(unlinked ? [] : (tmFocusLink?.states ?? []))
      if (asmPane !== null) asmPane.setFocus(unlinked ? [] : (asmFocusLink?.instrs ?? []))
      p.slot.render(sessions, p.pane, leg)
      // **THE SEED DROPPED THE PIN AND ITS SCROLL, AND BOTH ARE GIVEN BACK AFTER THE VIEW'S RENDER.** The view missed
      // the compile, so its seed's `setProgram` dropped the pin it held and any link row still waiting in its grid —
      // rightly, since it had turned `link-wiring.ts`'s fan-out into rows of the content it held before the seed. The
      // pin is resolved here against `linkWiring.index`, the index this frame's pin is current against, so a view
      // shown frames later still gets the right rows.
      //
      // `scrollTo` IS THE FAN-OUT'S, `origin` AGAINST THIS VIEW'S LEG: a pin made in the source or in another leg's
      // view scrolls the view to it, held until the run moves, as it does a view that saw the compile and is shown
      // after the link (`VirtualGrid.scrollToRow`); a pin made in a view of this leg only paints, as it does there.
      //
      // **AFTER `render`, NOT BEFORE IT.** The seed's `setProgram` nulled the view's frame, so a scroll written before
      // `render` would be held against a `null` frame, and `render`'s own draw of this tick's frame would release it
      // at once. After it, the view shows this tick's frame, and the draw `setLink` makes holds against that.
      //
      // **A COPY IS NOT LINKED (§4.5), so it marks nothing whatever is pinned** — `unlinked` above, as
      // `link-wiring.ts`'s fan-out guards its own. Resolved once, and only for a view seeded this frame.
      const seededPin =
        (tmSeeded || asmSeeded) &&
        !unlinked &&
        linkWiring.linkable &&
        linkWiring.link !== null &&
        linkWiring.index !== null
          ? linkWiring.index.linkFor(linkWiring.link.node)
          : null
      if (tmSeeded) tmPane.setLink(seededPin?.states ?? [], linkWiring.link !== null && linkWiring.link.origin !== 'tm')
      // THE ASM VIEW'S PIN, by the TM view's rules above and for their reasons.
      if (asmSeeded) {
        asmPane.setLink(seededPin?.instrs ?? [], linkWiring.link !== null && linkWiring.link.origin !== 'asm')
      }
      // WHICH LAYOUT GESTURES THIS PANE OFFERS — T12's own addition, driven from here for the same
      // reason `setBindings` already is (`PaneSlot.render`'s doc): both are facts about something
      // OTHER than the frame just rendered, so a caller with no render loop of its own has no other
      // per-frame hook to drive them from. `leaves() > 1` is "not the last leaf on the page", not "not
      // the last leaf on THIS pane's leg" — a lone TM pane still offers close as long as source or λ
      // panes exist beside it. `p.kind !== 'source'` is the split refusal: one editor, nothing to
      // duplicate into (`splitLeaf`'s own doc).
      //
      // THE THIRD ARGUMENT IS WHAT THE SPLIT MAY CREATE, and it rides this call rather than a setter of
      // its own — `PaneView.setLayoutControls`'s own doc has that argument. `p.slot.binding` is the
      // pane's own pair, which the menu puts first and labels `(same)`; it is read here rather than
      // remembered by the pane for `PaneCollection`'s reason for reading bindings through the slot on
      // every call — a copy is a second place to be wrong.
      // `p.kind !== 'source' && !stage()` IS THE SPLIT REFUSAL, AND IT HAS TWO HALVES NOW. One editor,
      // nothing to duplicate into (`splitLeaf`'s own doc); and in Stage a split can never apply, because
      // the stage draws ONE view over a tab strip and a split of it would be invisible — umbrella §4
      // rule 4's "removed where it can never apply in that view". `+ view` is what adds a view there
      // (spec §5), and it is in the app header rather than in this menu.
      p.pane.setLayoutControls(leaves() > 1, p.kind !== 'source' && !stage(), {
        options: pairs,
        sourceAvailable: canCreateSource,
        current: p.slot.binding,
      })
      // WHICH STEP CONTROLS THIS VIEW DRAWS — driven from here for `setLayoutControls`' reason one line
      // up: it is a fact about the workspace rather than about the frame just rendered, so this per-frame
      // pass is the only hook a caller with no render loop of its own has.
      p.pane.setStepsShown(stepsInView())
      // *MOVE THE EDITOR HERE* ON A TM OR ASM VIEW, fed from custody every frame as the λ pass below feeds a λ view's:
      // whether another view holds the copy's editor is a fact about other views (`CopyEditor.#editorAvailable`).
      const machine = tmPane ?? asmPane
      if (machine !== null) machine.setEditorAvailable(hasEditor(p.slot.binding.session))
    }

    // RESOLVED ONCE, HERE, FOR `drawLink` AT THE END. `draw()` runs on every recorded frame during
    // playback, and `index.linkFor` walks `#spanOf`/`#ownedBy` over the wire's parallel arrays — not
    // free. The λ views need none of it: each marks the pinned construct's nodes in the tree it draws.
    const l: Link | null =
      linkWiring.linkable && linkWiring.link !== null && linkWiring.index !== null
        ? linkWiring.index.linkFor(linkWiring.link.node)
        : null
    // PER-LEG, NOT PER-PANE — every λ view marks the same pinned construct, read once and fanned out.
    // SAME REASON AS `drawLink()` BELOW, AND NOT ONLY IN `setLinkTo`: each step's tree must be marked as
    // it arrives, and every stepping control routes through `draw()` rather than through `setLinkTo`.
    const pin = linkWiring.linkable && linkWiring.link !== null ? linkWiring.link.node : null
    // THE λ-ONLY PER-FRAME PASS, AND IT CARRIES TWO FACTS NOW. The pin is per-leg (one construct,
    // fanned out); `setEditorAvailable` is PER PANE, because it is a question about each pane's own
    // binding — two λ panes on two different buffers get two different answers, and two on the SAME
    // buffer get the same one, which is exactly the state the control exists to resolve.
    //
    // WHY IT IS HERE AND NOT IN `PaneSlot.render` BESIDE `setDetached`, which it otherwise resembles in
    // every way: that call is leg-agnostic (`PaneView`), and an editor-availability setter on `TmPane`
    // would be a method that could only ever be ignored. The loop above is the render pass for EVERY
    // leg; this one is already the place where "λ panes, and only λ panes" is said.
    trees.prune((id) => sessions.has(id))
    for (const p of panes.of('lambda')) {
      // THE SAME SKIP THE MAIN LOOP TAKES, for the same reason (spec §5) — and a hidden view therefore asks
      // the worker for no tree until its tab is next selected (part 4's spec §5.5).
      if (!p.host.isConnected) continue
      const pane = p.pane as LambdaPane
      const session = p.slot.binding.session
      const leg = p.slot.resolve(sessions)
      pane.setBuild(trees.buildOf(session))
      // A COPY IS NOT LINKED (§4.5), so it marks nothing whatever is pinned.
      const pinned = sessions.entryOf(session).detached ? null : pin
      pane.renderTree(
        leg.hist.current === undefined ? { kind: 'none' } : trees.want(session, leg.hist.currentStep),
        pinned,
      )
      pane.setEditorAvailable(hasEditor(session))
    }

    // THE RUNNING FOCUS: a SECOND, INDEPENDENT layer from `l`/`link` above, computed here rather than
    // fed by `l` — `link` is the pin a click set, `focus` is the marker that moves every β-step, and
    // `runningFocus` deliberately knows nothing about `link` (see its own doc). GATED ON `linkable`,
    // NOT ONLY `index !== null` — the same distinction `linkAtSourceOffset` already draws: `index` can
    // be non-null and still stale (see `linkable`'s own doc above), and `runningFocus` only ever sees
    // `null` for the case where `index` itself is null.
    // `lam !== undefined` FOR THE REASON `tmFocus` ABOVE TAKES `tm !== undefined`, and here the
    // consequence is visible rather than internal: with no λ pane the source editor's focus decoration
    // is cleared by the `focus === null` branch below, which is what a user who just closed the last λ
    // pane should see — a highlight tracking a reduction nobody is watching is a claim about an empty
    // screen.
    const focus =
      linkWiring.linkable && linkWiring.index !== null && lam !== undefined
        ? runningFocus(linkWiring.index, lam.hist.current?.owner ?? 'None')
        : null
    // ONE MORE `linkFor` CALL, ACCEPTED RATHER THAN AVOIDED — `runningFocus` already resolved (and
    // discarded) a span internally just to answer "does the index carry this node"; see its own doc for
    // why its return type carries no span for a caller that only wants the claim. This walk is over the
    // same small index `l` above already walks per frame, not the `frame_cost_probe`-scale cost that
    // motivated resolving `l` exactly once and sharing it.
    const focusLink: Link | null =
      focus !== null && linkWiring.index !== null ? linkWiring.index.linkFor(focus.node) : null
    if (focus === null || focusLink === null || focusLink.source === null) {
      view().dispatch({ effects: setFocus.of(null) })
    } else {
      // THE ONE COINCIDENCE THIS APP EXISTS TO SHOW: the pin and the running focus naming the SAME
      // node. Not two overlapping highlights on one span — its own class (`.is-focus-coincident`,
      // `style.css`), so a user reads "the run just reached what you pinned" as one signal.
      const claim = isCoincident(linkWiring.link, focus) ? 'coincident' : focus.claim
      view().dispatch({ effects: setFocus.of({ span: focusLink.source, claim }) })
    }
    // `drawLink` NOW RUNS HERE, AT THE END, NOT AT THE TOP OF THIS FUNCTION — `link-status.ts`'s
    // SECOND job needs `tmFocus` (resolved above the render loop) to answer whether it coincides with
    // the pin. Still "at the end" in the sense the original comment meant: everything above it is a
    // `history`/`index` read, nothing below reads `drawLink`'s output.
    // THE λ HALF OF THE STATUS COMES FROM THE VIEW THAT DREW THE TREE (spec §5.4), after the loop above
    // has handed it this frame's pin.
    //
    // **A VIEW OFF THE PAGE DREW NOTHING.** The loop above skipped it, so its pin and its tree are whatever
    // it last drew, and asking it answered for an earlier pin. So the view is `shown`'s: of the λ views on the
    // page, the one focused most recently. With no λ view on the page there is no term on screen to explain,
    // which is `'absent'`.
    //
    // **AND A VIEW OF THE PROGRAM, `onProgram`, AS FOR THE RUNNING FOCUSES.** The clause explains why the program's
    // term does not show the pin, and a copy's view marks nothing whatever is pinned (§4.5). `linkStatus` keeps the
    // λ clause while any λ view shows the program, so a copy's view answering here would put its term's answer in a
    // sentence about the program's.
    const drewLambda = panes.shown('lambda', onPage, onProgram)
    const lambdaLink: LambdaLinkState =
      drewLambda === undefined
        ? 'absent'
        : linkWiring.index === null || linkWiring.index.lambdaText === ''
          ? 'declined'
          : (drewLambda.pane as LambdaPane).linkState()
    linkWiring.drawLink(l, isCoincident(linkWiring.link, tmFocus), isCoincident(linkWiring.link, asmFocus), lambdaLink)

    // THE READOUT (spec §9): the focused view's session. A focused source view has no pane entry
    // (`panes.get('source')` is `undefined`) and shows the program, as does any view bound to it.
    const entry = panes.get(focused())
    if (entry === undefined || entry.slot.binding.session === sourceSession) {
      // **THE PROGRAM'S MACHINE LEGS AS THEY ARE RECORDING, AND THE GENERATION THE CLIENT LAST CLAIMED**, which the
      // legs record from its `compiled` reply on, beside the last result the program's session answered: the result
      // counts a compile's whole run, and a leg's recording can fill its history before that run's end. Read on every
      // frame, so the readout follows *keep recording* as the step line does. The result may be an earlier compile's,
      // since it arrives once every leg has recorded; `readout.ts`'s `programResultRows` draws a recording's fact only
      // beside a result of the generation the client last claimed.
      const recording = {
        gen: sessions.entryOf(sourceSession).client.gen,
        asm: sessions.legOf({ session: sourceSession, leg: 'asm' }),
        tm: sessions.legOf({ session: sourceSession, leg: 'tm' }),
      }
      readout.show(program(), {
        segments: () => programSegments(program(), recording),
        rows: () => programRows(program(), recording),
      })
    } else {
      const session = entry.slot.binding.session
      // **NOT THE SESSION ID — IT IS THE ONE PLACE THE VOCABULARY SWEEP CANNOT SEE.** `nameOf` answers
      // `null` only for a session the copies store does not hold, which is a wiring bug rather than a
      // state; printing `scratch-3` at a user would ship the old words in the one form no grep for a
      // literal finds.
      const name = nameOf(session) ?? 'a copy'
      const leg = entry.slot.resolve(sessions)
      // **THE LEG FACTS ARE HOISTED OUT OF THE OLD TERNARY**, because both thunks below read them and a
      // value built inside one of them is a value the other cannot see. One value for every leg, as the copies
      // menu's rows read it (`main.ts`'s `copyHolds`).
      const copyLeg = copyLegOf(leg)
      switch (entry.slot.binding.leg) {
        case 'lambda':
          readout.show(null, {
            segments: () => lambdaCopySegments(name, copyLeg),
            rows: () => copyRows(lambdaCopyParts(name, copyLeg)),
          })
          break
        case 'tm': {
          const reading = sessions.entryOf(session).tmScratch
          readout.show(null, {
            segments: () => tmCopySegments(name, reading, copyLeg),
            rows: () => copyRows(tmCopyParts(name, reading, copyLeg)),
          })
          break
        }
        case 'asm': {
          const reading = sessions.entryOf(session).asmScratch
          readout.show(null, {
            segments: () => asmCopySegments(name, reading, copyLeg),
            rows: () => copyRows(asmCopyParts(name, reading, copyLeg)),
          })
          break
        }
        default:
          unhandled(entry.slot.binding.leg)
      }
    }

    // THE BAR (spec §8), AFTER THE READOUT AND AFTER EVERY PANE. It resolves its own target through the
    // thunks `main.ts` gave it, so this call is only "a frame has been painted, say what is true now" —
    // the same division `readout.show` above takes, and the reason `draw.ts` still needs no layout tree.
    stepBar.update()
    // THE STAGE'S TABS, AFTER EVERY VIEW'S HEADER: a view rebound in place repaints its title on this frame, and its
    // tab is the other place the stage names it (`layout-view.ts`'s `retitleStage`).
    if (stage()) stageTabs.update()
  }
}
