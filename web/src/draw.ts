import type { EditorView } from '@codemirror/view'
import { setFocus } from './highlight'
import type { LambdaPane } from './lambda-pane'
import { isCoincident, type Link, runningFocus, sourceNodeOwner } from './link'
import type { LinkWiring } from './link-wiring'
import type { PaneCollection } from './panes'
import type { SessionRegistry } from './sessions'
import type { TmPane } from './tm-pane'

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
 */
export function createDraw(deps: {
  view: () => EditorView
  sessions: SessionRegistry
  panes: PaneCollection
  links: LinkWiring
  leaves: () => number
  sourceAvailable: () => boolean
}): () => void {
  const { view, sessions, panes, links: linkWiring, leaves, sourceAvailable } = deps
  return () => {
    // "THE" λ AND TM PANES, RESOLVED THROUGH THE COLLECTION RATHER THAN CLOSED OVER — AND EITHER MAY
    // BE ABSENT. This block used to destructure `of(leg)[0]` and throw when it came back `undefined`,
    // on the strength of "`main.ts` always registers one pane of each leg before `draw` can be called".
    // That was true while panes were two consts and false from the moment `applyLayout` began deriving
    // them from the layout tree: `closeLeaf` refuses only the last leaf in the TREE, so `leaves() > 1`
    // offers `close` on the single λ pane a fresh page ships, and clicking it left this throwing on
    // every subsequent frame. Worse, `applyLayout` persists the new tree BEFORE calling `draw()`, so
    // the λ-less arrangement was already committed to `localStorage` and the dead app came back on
    // reload — only `reset layout` escaped it. `PaneCollection.active` is now the one place that
    // answers this question, and it answers `undefined` when the leg is empty; see its own doc for why
    // all four consumers were once holding the same expired invariant privately, and for how it now
    // picks among several panes on the same leg — the pane the user last focused, per leg, falling back
    // to insertion order (5d-ii-b).
    //
    // A LEG WITH NO PANE CONTRIBUTES NOTHING, RATHER THAN BEING FAKED WITH A DEFAULT. The scalar reads
    // below (`tmFocus`'s `tm.hist...`, the source editor's `lam.hist...`) feed the ONE shared status
    // line and the ONE source editor's decoration, neither of which has a per-pane identity yet — which
    // pane's state should win once a leg holds more than one is answered by `active` itself now, not
    // here. What a leg with NO pane should contribute has an answer today, and it is `null` at both
    // sites: there is no running focus on a leg nobody is looking at.
    const lam = panes.active('lambda')?.slot.resolve(sessions)
    const tm = panes.active('tm')?.slot.resolve(sessions)
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
    // no TM pane on screen there is no TM leg being watched, so there is nothing for a running focus to
    // mark — and feeding `sourceNodeOwner(null)` through anyway would report a definite "the machine is
    // nowhere" where the honest answer is "no one is asking".
    const tmFocus =
      linkWiring.linkable && linkWiring.index !== null && tm !== undefined
        ? runningFocus(linkWiring.index, sourceNodeOwner(tm.hist.current?.source_node ?? null))
        : null
    const tmFocusLink: Link | null =
      tmFocus !== null && linkWiring.index !== null ? linkWiring.index.linkFor(tmFocus.node) : null

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
      const leg = p.slot.resolve(sessions)
      if (p.slot.binding.leg === 'tm') (p.pane as TmPane).setFocus(tmFocusLink?.states ?? [])
      p.slot.render(sessions, p.pane, leg)
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
      p.pane.setLayoutControls(leaves() > 1, p.kind !== 'source', {
        options: pairs,
        sourceAvailable: canCreateSource,
        current: p.slot.binding,
      })
    }

    // RESOLVED ONCE, HERE, AND SHARED BY BOTH CONSUMERS BELOW. `draw()` runs on every recorded frame
    // during playback, and `index.linkFor` walks `#spanOf`/`#statesOf` over the wire's parallel
    // arrays — not free. `drawLink` wants `states.length > 0` and the λ span (to tell `truncated` from
    // `shown`); `lambdaLinkWindow` wants only the λ span. A separate `index.linkFor(link.node)` call in
    // each would resolve the SAME node twice on every tick.
    const l: Link | null =
      linkWiring.linkable && linkWiring.link !== null && linkWiring.index !== null
        ? linkWiring.index.linkFor(linkWiring.link.node)
        : null
    // PER-LEG, NOT PER-PANE — every λ pane follows the same link window, resolved once and fanned out.
    // SAME REASON AS `drawLink()` BELOW, AND NOT ONLY IN `setLinkTo`: scrubbing the λ history must
    // withdraw the window without a click, and every stepping control routes through `draw()` rather
    // than through `setLinkTo`.
    const lambdaWin = linkWiring.lambdaLinkWindow(l)
    for (const p of panes.of('lambda')) (p.pane as LambdaPane).renderLink(lambdaWin)

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
    linkWiring.drawLink(l, isCoincident(linkWiring.link, tmFocus))
  }
}
