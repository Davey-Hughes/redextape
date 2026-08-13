# 5d-ii-b — the renderer multiplexer: a pane changes what it shows, and §3.1's filed decision is answered

## §1 What is being built, and why the two filed capabilities are one

The second of the three slices 5d-ii-a's §1 splits 5d-ii into. Its filing
(`2026-08-12-plan5d-ii-a-layout-tree-design.md` §6.1, roadmap:5865-5868) names two capabilities:

> **5d-ii-b — the renderer multiplexer.** Widening a slot so a pane can change leg, and the
> `(leg, session)` picker that creates a pane of any kind rather than duplicating one. §3.1 is the
> decision it owns.

**THEY ARE ONE MECHANISM SEEN FROM TWO ENDS, AND THAT IS WHY THEY ARE ONE SLICE RATHER THAN TWO.** Both
require the app to construct a pane whose kind is chosen rather than inherited — one at a leaf that
already exists, one at a leaf being minted. `applyLayout`'s creation pass (`main.ts:687-724`) is the
single place that decides which class to build, and both capabilities are that decision taking a
parameter.

A third question is filed against this slice by the code rather than by the roadmap.
`PaneCollection.first`'s doc (`panes.ts:101-105`) defers it in as many words:

> The callers are the surfaces with no per-pane identity yet — the one shared status line, the one
> source editor's decoration — which need A pane on the leg rather than all of them; **which pane's
> state should win once several disagree is 5d-ii-b's question.**

It is answered here (§4.2c, §4.7) because this is the slice that makes several panes on one leg the
normal case rather than something a user reaches by trying.

**AND ONE SCOPE CALL THE ROADMAP LEFT OPEN IS TAKEN.** roadmap:5834 records *"whether 1,115 lines in
one file is a problem for 5d-ii-b or -c to inherit is not answered here."* It is answered here, as
wave 1: the pane-lifecycle and editor-custody machinery leaves `main.ts` before the feature is built on
top of it (§4.1).

## §2 The decisions

1. **`PaneSlot<K extends Leg>` is never widened.** A leg change replaces the whole `PaneEntry` — slot
   and view together — in the same host under the same `LeafId`. §3.1.
2. **Leg and session are chosen together, in one control.** The pane's binding selector widens from a
   session list to a list of `(leg, session)` pairs. §3.2, §4.3.
3. **The split controls become the picker.** `split →` / `split ↓` open a menu of pairs instead of
   duplicating the leaf's kind. No third layout control, and no new placement rule. §4.4.
4. **The source pane is re-creatable but never switchable.** The picker offers `source` exactly when no
   source leaf is in the tree; no pane switches into or out of `source` in place. §4.6.
5. **The shared surfaces follow the last-focused pane per leg**, falling back to insertion order. §4.7.
6. **A `LeafId` stops naming a kind.** New leaves mint `pane-${n}`; `dataset.kind` becomes the one
   truthful statement of what a leaf renders. §3.6.
7. **Wave 1 is an extraction that changes no behaviour**, and the feature is built on top of it. §4.1.
8. **No movement, no persisted binding, no second scratch.** Unchanged from 5d-ii-a's decisions 8 and
   §3.3, and from 5d-i decision 5. §6.

## §3 What verification established before any code was written

### 3.1 THE FILED DECISION RESOLVES AS "NEVER WIDEN", AND THE REASON IS THAT WIDENING SAVES NOTHING

`PaneSlot`'s doc (`sessions.ts:337-344`) states the decision this slice owns and prices one side of it:

> A SELECTOR THAT COULD WRITE `leg` WOULD HAVE DESTROYED IT, and cheaply: `Binding<K>` would collapse
> to `Binding<Leg>`, `legOf` would return `LegState<LambdaState> | LegState<TmState>`, and every
> render would narrow a union that the pane's own renderer type had already decided… **Widening `K` to
> `Leg` here is where 5d-ii starts, and it is a decision with the property above at stake, not a field
> write.**

What that paragraph does not say, and what decides the question, is the fact on the other side:

**A `LambdaPane` CANNOT RENDER `TmState` UNDER ANY IMPLEMENTATION, SO THE VIEW IS TORN DOWN AND REBUILT
NO MATTER WHICH IS CHOSEN.** `PaneView<T>` is generic in the frame type and `LambdaPane`'s render path
reads `LambdaState` fields throughout. The only question a leg change poses is whether the *slot* is
torn down alongside the view — and if it is not, the teardown has been paid and `Binding<K>`'s property
spent for no saving at all.

Two alternatives were considered and rejected for that reason:

- **Widening `K` to `Leg`.** Costs exactly what the doc above prices — including that aliasing two legs
  becomes writable without the `as unknown as LegState<TmState>` cast that `tests/node/sessions.test.ts`
  currently uses as the evidence the types hold — and still rebuilds the view.
- **One `MultiPane` class holding both renderers.** Avoids the rebuild, but a class rendering both legs
  is a `PaneView<LambdaState | TmState>`: the same union arriving from the other side, plus every pane
  carrying a δ-table it is not showing.

**SO THE MULTIPLEXER IS BUILT AS `sessions.ts:337-344` ITSELF DEFINES IT** — *"a pane MULTIPLEXER — a
slot that mounts a different pane class per leg"*. That doc comment is rewritten by this slice from a
prediction into a decision, in place, rather than deleted.

### 3.2 A SESSION HAS AT MOST ONE LEG PER `Leg`, SO LEG AND SESSION ARE NOT INDEPENDENT AXES

`SessionLegs` is `{ [L in Leg]?: LegState<LegFrame[L]> }` (`sessions.ts:63`), and its own doc records
what the optionality means: *"the source session offers source/λ/TM; a `LambdaScratch` offers only λ; a
`TmScratch` only TM"*. `legOf` throws when the named leg is absent (`sessions.ts:277-281`), deliberately:

> `options` below is what a selector offers, and it offers only sessions that HAVE the leg, so a
> binding that names a missing one did not come from the selector.

**THEREFORE A λ PANE BOUND TO A SCRATCH CANNOT SIMPLY "BECOME A TM PANE" KEEPING ITS SESSION** — there
is no TM leg there to resolve, and constructing that binding is the one way to make `legOf` throw from
a user gesture rather than from a wiring bug.

This is what forces decision 2. A kind selector sitting beside a session selector would have to answer
"what happens when you pick TM while bound to a scratch" with either a silent rebind to the source
session or a vanishing option — both rules someone has to remember, where a single list of pairs makes
the invalid combination unrepresentable. §4.3.

### 3.3 BOTH PANE CONSTRUCTORS ALREADY `replaceChildren`, SO THE KIND CHANGE HAS NO TEARDOWN TO WRITE

`lambda-pane.ts:157` and `tm-pane.ts:144` both end their constructors with `host.replaceChildren(…)`.
Constructing a pane against a host that already holds another pane's DOM therefore clears it as a
consequence of construction, with no window in which both are mounted.

**THIS IS WHY §4.5's KIND CHANGE IS TWO PREDICATE CHANGES RATHER THAN A NEW CODE PATH.** A teardown
step written by hand would be a second place that has to know what a pane put in its host, which is the
duplication `PaneView`'s structural type exists to avoid one layer up.

What the constructors do NOT clear is `dataset.kind`, which `hostFor` sets once at creation
(`main.ts:455`). That one line is the whole of the new work. §4.5.

### 3.4 `first(leg)` HAS EXACTLY TWO CONSUMERS AND BOTH DRIVE GENUINELY SHARED SURFACES

`draw.ts:65-66` resolves `lam` and `tm` to feed the source editor's running-focus decoration and the
δ-table's focus. `link-wiring.ts:92-93` resolves the same two slots for `detachedPanes()`, which drives
the one status line's *"λ pane detached — not linked to source"*.

Both were converted to `first` by 5d-ii-a, and `draw.ts:59-64` records what was deliberately left open:

> The scalar reads below … feed the ONE shared status line and the ONE source editor's decoration,
> neither of which has a per-pane identity yet — which pane's state should win once a leg holds more
> than one is 5d-ii-b's question.

**THE AMBIGUITY IS ALREADY REACHABLE TODAY** — split the λ pane, rebind one copy to a scratch, and the
status line describes whichever was inserted first. What changes here is that arbitrary pane
composition stops being something a user reaches by trying and becomes the slice's whole point, which
is what makes an arbitrary winner harder to defend. §4.7.

### 3.5 `pendingBinding` WAS BUILT FOR SPLITS AND SERVES THE KIND CHANGE UNCHANGED

`main.ts:438`'s side map exists because the layout tree cannot carry a session (`layout.ts:8-13`), so a
split needs somewhere to say "the new leaf starts on the session I am showing" before `applyLayout`
constructs the `PaneSlot` that holds that fact for real.

A kind change asks the identical question about the identical leaf id, one gesture earlier. **NO NEW
STATE IS INTRODUCED FOR IT**, and that is worth recording rather than discovering: a second map would
have been a second thing `applyLayout`'s creation pass has to consult and a second thing that could be
left stale.

### 3.6 A `LeafId` MINTED AS `${leg}-${n}` BECOMES A LIE THE MOMENT A PANE CHANGES LEG

`nextLeafId` mints `${leg}-${leafCounter++}` (`main.ts:83-86`). A leaf minted as `lambda-3` that later
renders a δ-table carries a name describing something it is not — in the tree, in `localStorage`, and
in `data-leaf`, which browser tests select on.

`panes.ts:6` already declares the id opaque — *"a leaf's stable identity — the key shared by the layout
tree, the DOM and persistence"* — so the prefix was never load-bearing; it was a convenience that this
slice falsifies.

**NEW LEAVES MINT `pane-${n}`. `defaultLayout()`'s LITERAL `lambda-0` / `tm-0` STAY.** Three reasons,
all of them about not moving something this slice has no need to move: browser tests select on them,
`reset layout`'s re-minting of exactly those ids is reasoned about at `main.ts:690-697`, and
`seedLeafCounter` (`main.ts:76-81`) parses the digits after the last `-` and is unaffected by either
spelling. `dataset.kind` (`main.ts:455`) becomes the one truthful statement of what a leaf renders, and
§4.5 keeps it true.

## §4 The design

### 4.1 WAVE 1 — THE EXTRACTION, WHICH CHANGES NO BEHAVIOUR

roadmap:5834 left `main.ts`'s size an open question for this slice to inherit. It is answered by
extraction rather than by a measurement, because this slice edits `hostFor`, `pendingBinding`,
`heldEditors`, `editorOwner`, `paneEvents`, `applyLayout` and `reconcileEditors` — which are not seven
scattered functions but one subsystem with one job.

**TWO MODULES, NOT ONE, AND THE BOUNDARY IS THE DEPENDENCY DIRECTION:**

- **`editor-custody.ts`** — `heldEditors`, `editorOwner`, `reconcileEditors`, `editorHomeFor`, and the
  claim/drop operations. It knows about `LeafId`, `SessionId` and `LambdaEditor`, and nothing about
  the layout tree.
- **`pane-host.ts`** — `hosts`/`hostFor`, `pendingBinding`, `paneEvents`, `applyLayout`. It calls into
  custody; custody never calls back.

**THE CUSTODY MACHINERY IS ISOLATED BECAUSE IT IS THE PART THAT NEEDED THREE REVIEW ROUNDS**, not
because it is large. 5d-ii-a's entry records all three (roadmap:5542): a custody entry outliving its
session, a re-minted leaf id inheriting a claim, and a sweep whose domain could not see what `reset
layout` had orphaned. A module with a named surface is what makes the fourth such finding a question
about an API rather than about a closure.

**THE SHAPE IS `link-wiring.ts`'s, NOT A NEW ONE.** `createLinkWiring(deps: {…}): LinkWiring`
(`link-wiring.ts:63-69`) is already a factory taking its dependencies and returning an API, extracted
from `main.ts` for the same reason. Both new modules follow it.

**WAVE 1 CHANGES NO BEHAVIOUR AND ITS COMMITS SAY SO.** The rule 5d-ii-a's §4.5 used for its three
waves holds here: the extraction lands and the suite passes unchanged before any new capability is
built on it. A wave-1 commit that also changes what the app does is the commit that makes a later
bisect useless.

### 4.2 THE MODEL

**(a) `layout.ts` — one new operation, one widened one.**

```ts
export function setLeafKind(root: LayoutNode, id: LeafId, kind: PaneKind): LayoutNode
export function splitLeaf(root: LayoutNode, id: LeafId, dir: Dir, newId: LeafId, kind: PaneKind): LayoutNode
```

`setLeafKind` returns a new tree with that leaf's `pane` field replaced, keeping every size and every
structural relationship — which is the whole point of decision 1: the pane keeps its position.

It refuses `'source'` **as a target and as a subject**, and both refusals are `splitLeaf`'s existing
one (`layout.ts:106`) restated: there is one editor, so a leaf cannot become a second source pane, and
a source leaf that stopped being one would leave the editor with no host in the tree. §4.6.

`splitLeaf` takes the new leaf's kind instead of copying `node.pane`. Its three existing guards survive
— the unknown-id refusal, the refusal to split a *source leaf* (`layout.ts:106`), and the
duplicate-`newId` refusal whose doc (`layout.ts:97-101`) explains that a colliding id would silently
make a leaf unreachable rather than error — and it gains a fourth.

**THE FOURTH GUARD IS NOT THE THIRD ONE RESTATED, AND CONFLATING THEM IS THE EASY MISTAKE HERE.**
`splitLeaf` must now be able to CREATE a `'source'` leaf — that is §4.6's whole capability — while
still refusing to SPLIT one. The two `'source'` refusals are about different arguments:

| argument | refusal | why |
| --- | --- | --- |
| the leaf being split (`id`) | always, if it is `'source'` | one editor, nothing to duplicate — `layout.ts:106` unchanged |
| the kind being created (`kind`) | only if a `'source'` leaf is already in the tree | at most one source leaf |

`setLeafKind` is the asymmetric one by contrast: it refuses `'source'` as a target **unconditionally**,
even when no source leaf exists. A pane never becomes the source pane in place (decision 4), so the
absence of a source leaf is not a reason to allow it — the picker is where that gap is filled.

**(b) `sessions.ts` — one new method, and `PaneSlot` untouched.**

```ts
export type PaneOption = { readonly leg: Leg; readonly id: SessionId; readonly label: string }

pairs(): PaneOption[]
```

**IT RETURNS A LABELLED PAIR RATHER THAN A `Binding<Leg>`, AND THIS SENTENCE IS A CORRECTION.** This
block first read `pairs(): Binding<Leg>[]`, which cannot work and was caught by Task 4's review rather
than by writing it: `Binding<Leg>` is `{ session, leg }` and carries no label, so it cannot supply the
`<option>` text §4.3 requires two subsections later. `PaneOption` is `options`' `BindingOption`
(`sessions.ts:127`) with the leg added — the same enrichment, arriving from the same place.

Every `(leg, session)` pair a pane may be pointed at, built from the same source of truth `options`
uses — which keys an entry's `legs` record actually has. `options`' own doc states why that matters:
*"There is no second table of which kind offers what — the legs an entry was built with ARE the
answer, so the selector and the resolver cannot disagree about what is bindable."* `pairs` inherits
that property rather than restating it; it is `options('lambda')` and `options('tm')` tagged with their
legs, in registration order within each.

**`PaneSlot<K extends Leg>` gains nothing and loses nothing.** §3.1.

**(c) `panes.ts` — `first(leg)` becomes `active(leg)`.**

A `Map<Leg, LeafId>` written by `markActive(id)`, which derives the leg from the entry the collection
already holds. `active(leg)` returns the marked leaf when it is still present **and still on that
leg**, and otherwise falls back to insertion order — which is exactly today's `first`, so the
single-pane case and the empty-leg case behave identically, including the `undefined` that
`panes.ts:90-99` argues for at length.

**THE RE-CHECK IS NOT DEFENSIVE, IT IS THE KIND CHANGE.** `markActive` may have recorded
`lambda → 'pane-3'` before `pane-3` became a TM pane; the entry under that id is now a different pane
on a different leg. Removal is the other case and 5d-ii-a already reaches it.

**`panes.ts` STAYS FREE OF THE DOM**, which is the property that made `first` node-tier testable.
`markActive` takes a `LeafId`; `main.ts` is what listens for focus. §4.7.

### 4.3 THE COMBINED `(leg, session)` SELECTOR

`bindingSelect` (`pane-chrome.ts:389`) becomes `paneSelect`: the same `<select>`, with an `<optgroup>`
per leg and options valued as an encoded pair.

**FOUR PROPERTIES OF THE EXISTING CONTROL ARE PRESERVED DELIBERATELY, AND EACH ALREADY CARRIES ITS OWN
ARGUMENT IN PLACE:**

1. `change`, not `input` (`pane-chrome.ts:399-402`) — a keyboard user arrowing the list would
   otherwise rebind and repaint on every option they pass.
2. The rendered-key comparison (`:404-408`) — `update` runs on every recorded frame during playback, and
   rebuilding the options would also destroy the open dropdown of a user mid-choice. The key gains the
   leg alongside the id and label.
3. The `\x00`/`\x01` escapes (`:419-429`) — and that comment stays exactly where it is. Two control
   bytes once made this file invisible to `rg` and `grep`, which is how a stale doc survived; the
   escapes produce the identical string and must not be "tidied" back into literals. The encoded value
   this slice adds uses the same idiom for the same reason.
4. Self-removal below two options (`:412-418`) — generalizing from "fewer than two sessions" to "fewer
   than two pairs", which is the same statement about the same control being useless.

**`PaneEvents.rebind` WIDENS FROM `SessionId` TO `Binding<Leg>`.** Its doc (`pane-chrome.ts:19-22`)
currently reads *"IT TAKES A `SessionId` AND NOT A `(session, leg)` PAIR. The leg is fixed by the
slot's renderer type"* — a comment that named this slice as the thing that would change it. It is
rewritten in place.

**`PaneSlot.render` CALLS IT WITH `reg.pairs()` RATHER THAN `reg.options(b.leg)`** (`sessions.ts:426`),
and the reason that line lives there is unchanged: both the selector and the badge are functions of the
binding AND of the registry, so driving them from the one per-frame call is what keeps a selector from
listing a session that no longer exists.

### 4.4 THE SPLIT PICKER

`layoutControls`'s `splitRow` / `splitColumn` buttons (`pane-chrome.ts:526-527`) each get
`popovertarget` onto a menu.

**NATIVE `popover`, NOT A HAND-ROLLED DROPDOWN.** It provides light-dismiss, top-layer placement and
Escape without a click-outside listener or a z-index negotiation, and the browser tier is Chromium-only
(`vite.config.ts:186`), so it is fully drivable in test. The buttons carry `aria-haspopup="menu"` and
`aria-expanded`.

**THE MENU POPULATES ON OPEN, NOT PER FRAME.** `layoutControls.update` is on the per-frame path for the
reason its own doc gives (`pane-chrome.ts:502-504`: *"`draw()` repaints every pane on every recorded
frame"*), so building option lists there would incur exactly the cost `bindingSelect`'s key comparison
exists to avoid. A `beforetoggle` callback means zero per-frame work and no staleness to guard —
strictly better than the selector's answer, because the selector must stay correct while visible and a
closed menu need not exist at all.

**THE PAYLOAD IS TAGGED, BECAUSE `source` HAS NO SESSION:**

```ts
export type PaneChoice = { kind: 'source' } | { kind: Leg; session: SessionId }
```

`on.splitRow` / `on.splitColumn` widen from `() => void` to `(choice: PaneChoice) => void`.

**THE PANE'S OWN CURRENT PAIR IS LISTED FIRST**, labelled as the duplicate case. Today's split is one
click and this makes it two; putting the common case at the top of the list is what keeps that a second
click rather than a hunt. The cost is accepted rather than hidden — decision 3's alternative was a
fourth layout control, against a pane chrome already carrying `split →`, `split ↓`, `close`, the
transport strip, detach, collapse, claim-editor and the selector.

**`main.ts`'s SOURCE PANE IS UNAFFECTED.** It passes `{ close }` alone (`main.ts:489-492`), and
`layoutControls`'s parameter is already `Pick<PaneEvents, 'splitRow' | 'splitColumn' | 'close'>` for
exactly that caller (`pane-chrome.ts:506-513`). Widening two members it does not pass changes nothing
for it.

### 4.5 THE KIND CHANGE THROUGH `applyLayout`'s TWO EXISTING PASSES

**IT IS TWO PREDICATE CHANGES, AND THAT IS THE DESIGN RATHER THAN A HAPPY ACCIDENT** — §3.3's
constructors are what make it so.

**Pass 1, removal (`main.ts:665-676`)** drops entries whose leaf left the tree. It gains a second
reason: the leaf is still present but its `pane` kind no longer matches the entry's `kind`. The custody
handover above it runs unchanged, because from the editor's point of view a λ pane that is about to
stop existing is the same situation whichever reason it stops.

**Pass 2, creation (`:687-724`)** then finds `panes.get(l.id) === undefined` and constructs against the
same host, which clears itself (§3.3). It adds one line: rewrite `host.dataset.kind`.

Its stale-claim line (`:713`) is already correct here without amendment. Its own comment argues that
*"a pane built here is by definition not the pane that claimed anything"*, and a pane replacing one of
a different kind satisfies that as squarely as a re-minted id does.

**CLOSE AND KIND-CHANGE DIFFER IN EXACTLY ONE WAY, AND IT IS RECORDED HERE BECAUSE IT READS AS A
CONTRADICTION.** Both drop the entry; only one clears the host. Close keeps the host's DOM — that is
`hostFor`'s detach-not-destroy rule (`main.ts:443-447`), the thing that makes a closed source pane's
program survive and `two-lambda-panes.test.ts`'s "keeps the program" test pass. A kind change replaces
it. Nothing is stranded, because pass 1's handover has already taken the editor out and put it in
custody, and the two passes run in that order for reasons that predate this slice.

**HANDLERS.** `rebind` branches on the chosen pair's leg:

- **Same leg** → `slot.rebind(session)`, one line, no teardown, exactly today's path.
- **Different leg** → `tree = setLeafKind(tree, id, choice.kind)`, `pendingBinding.set(id, choice.session)`,
  `applyLayout()`.

`splitRow` / `splitColumn` → `tree = splitLeaf(tree, id, dir, newId, choice.kind)`, plus a
`pendingBinding.set(newId, choice.session)` when the choice is not `source`.

**`applyLayout`'s `try`/`finally` (`:726-746`) COVERS THE NEW PATHS WITHOUT AMENDMENT**, and it is the
reason they are safe to add. Its own doc records what the `finally` is for: an exception escaping
`reconcileEditors` used to take `renderLayout`, `writeLayoutStorage` and `draw()` with it, leaving a
model that had gained a leaf, a DOM that had not, and a `localStorage` entry holding the previous tree.
A kind change is one more gesture routed through that same guarantee.

### 4.6 THE SOURCE PANE: RE-CREATABLE, NEVER SWITCHABLE

The picker offers `source` exactly when no source leaf is in the tree. No pane switches into or out of
`source` in place (§4.2a's two refusals).

**WHAT THIS FIXES IS A WART THIS SLICE'S OWN CONTROL WOULD OTHERWISE LEAVE.** 5d-ii-a made the source
pane closable and named `restore default layout` as the way back (§4.2). That is honest but
destructive: the editor returns and the arrangement does not. A `+`-shaped control that can create
every kind *except* the one whose loss costs the user their layout is the odd shape.

**AND IT COSTS ALMOST NOTHING, BECAUSE THE PATH ALREADY WORKS.** A source leaf appearing in the tree is
what `restore default layout` already does: `applyLayout`'s creation pass skips it (`main.ts:689`) and
`hostFor('source', 'source')` finds the pre-seeded host (`main.ts:470-473`) with `#editor` and
`#link-status` still inside. The new code is the predicate on the menu's option list.

**THE "AT MOST ONE SOURCE LEAF" INVARIANT IS ENFORCED IN THREE PLACES AND THAT IS DELIBERATE**:
`parseLayout` rejects a stored tree with two (`layout.ts:293-294`), `splitLeaf` refuses a `'source'`
kind while one is already in the tree (§4.2a's fourth guard), and the menu does not offer the option.
The last is the UI, the first two are the backstop — the same relationship `layout.ts:92-95` already
records for the split refusal.

`setLeafKind` is not in that list, because it refuses `'source'` outright rather than conditionally
(§4.2a) — it is enforcing decision 4, which is a stronger statement than the invariant and would still
refuse if the invariant were dropped tomorrow.

**THE TWO NEW CONTROLS THEREFORE HAVE DIFFERENT OPTION LISTS** — the picker offers three kinds, the
in-place selector two — and the asymmetry is decision 4 rather than an oversight. It is justified by
the sentence that already justifies source being unsplittable: there is one editor, so there is nothing
for a second pane to become.

### 4.7 FOCUS TRACKING

`hostFor` adds one `focusin` listener per host. **`focusin` RATHER THAN `focus`, BECAUSE IT BUBBLES** —
one listener on the section catches focus landing anywhere inside the pane, including inside a
CodeMirror instance, where `focus` would require a listener per focusable descendant and a new one
every time a pane's contents changed.

It calls `panes.markActive(id)`. §4.2c holds the map; this holds the DOM.

**PER LEG RATHER THAN ONE GLOBAL ACTIVE PANE.** Clicking into the source editor must not blank out
which λ pane the status line is describing — the source editor is not on either leg, and a global
"active pane" would make every source keystroke an answer to a question about λ.

`draw.ts:65-66` and `link-wiring.ts:92-93` change `first` to `active`. **NO NEW VISUAL CHROME**: the
DOM's own `:focus-within` already distinguishes the focused pane, and adding a second indicator would
be new colour-carried state in a slice that 5d-ii-a's §6.3 line ("this slice adds controls, not hues")
gives no reason to break from.

### 4.8 WAVE ORDER

1. **Extraction.** `editor-custody.ts` and `pane-host.ts` out of `main.ts`. No behaviour change; the
   suite passes unchanged.
2. **The model.** `setLeafKind`, `splitLeaf`'s kind parameter, `pairs()`, `active()`/`markActive()`,
   `pane-${n}` ids. Node-tier tests land with each. Nothing on screen changes yet.
3. **The controls.** `paneSelect`, the split picker, `PaneChoice`, the widened `PaneEvents` members.
4. **The wiring.** `applyLayout`'s two predicates, the `rebind` branch, `dataset.kind`, `focusin`.
   This is the wave where the capability becomes reachable, and where the browser tier lands.

Waves 3 and 4 are separable in principle and are not separated: a control with no handler is a control
that does nothing, and shipping one in its own commit means one commit whose tests must assert the
absence of the behaviour the next commit adds.

## §5 Testing

**Node tier.**

- `layout.test.ts` — `setLeafKind` changes the kind; refuses a `'source'` leaf as subject; refuses an
  id not in the tree; leaves every size and every structural relationship untouched (the assertion that
  decision 1 is what it claims). **And refuses `'source'` as a target even on a tree with no source
  leaf** — the condition under which the picker IS allowed to create one is exactly the condition a
  reader would expect to unlock this, and decision 4 is why it does not.
- `layout.test.ts` — `splitLeaf` with an explicit kind produces a new leaf of that kind, not of the
  split leaf's, and keeps its three existing refusals. **Plus both halves of §4.2a's asymmetry, which
  is one test each and neither is implied by the other**: splitting a `'source'` leaf is still refused
  even when the requested kind is `'lambda'`, and creating a `'source'` leaf is refused when one is in
  the tree and permitted when none is.
- `panes.test.ts` — `active(leg)` returns the marked leaf; falls back to insertion order when nothing
  is marked; falls back when the marked leaf was removed; **falls back when the marked leaf changed
  leg.** The last is §4.2c's re-check and the one a mutation would survive without.
- `sessions.test.ts` — `pairs()` over a registry holding the source session and one λ scratch yields
  three pairs, not four. **THIS IS THE TEST THAT PINS "AN INVALID PAIR IS NOT IN THE LIST"** rather
  than "is rejected on selection", which is §3.2's whole argument for decision 2.

**Browser tier.**

1. **A λ pane becomes a TM pane in place** — `data-leaf` unchanged, `data-kind` changed, the enclosing
   split's divider fractions unchanged. The headline.
2. **The editor survives a kind switch** — a λ pane holding a scratch editor switches to TM; the claim
   control appears on another λ pane bound to that scratch, and clicking it restores the text. **THE
   ONE MOST LIKELY TO CATCH A REAL BUG**, because it is the custody path (§4.5's pass 1) reached
   through a gesture that did not exist when that path was written.
3. **Split creates a TM pane from a λ pane** — the picker's whole point, and the thing `splitLeaf`'s
   old doc said this slice would be.
4. **The closed source pane comes back via the picker** — program intact, surrounding layout untouched.
   §4.6's wart fix, and the assertion that distinguishes it from `restore default layout`.
5. **The status line follows focus** — two λ panes, one bound to a detached scratch; focusing each
   changes the detached sentence. §4.7.

**Wave 1 has no tests of its own, and that is the point.** An extraction that changes no behaviour is
verified by the suite it does not change; a new test written against the extracted module in the same
commit would be a test that could not have failed before the move.

## §6 What this does not do

### 6.1 5d-ii-c AND 5d-iv KEEP THEIR POSITIONS

- **5d-ii-c — N scratch buffers.** Unchanged from 5d-ii-a §6.1 and roadmap:5869-5873. 5d-i decision 5's
  singleton rule holds, so today `options('tm')` returns only the source session and the picker's TM
  group has exactly one entry. It still owns the measured session cap and the worker-affordability
  probe.
- **5d-iv — the TM editable pane.** Unaffected, still after 5d-ii, still before the accessibility pass
  (roadmap:1463-1467, 5875-5876).
- **`pane-chrome.ts:234`'s reason for not persisting collapse state is still falsified by (c), not by
  this slice.** Carried forward unchanged from 5d-ii-a §6.1.

### 6.2 THE ACCESSIBILITY LIST — TWO ADDITIONS, ONE EXCEPTION TAKEN

**Added to the standing list** (roadmap:1297 onward): the split picker's menu and the widened selector
announce nothing when the layout changes underneath them — the same gap 5d-ii-a recorded for `split →`,
`split ↓`, `close` and `restore default layout`, extended to two controls that now also change what a
pane *is*.

**One exception is taken rather than deferred**, on the test 5d-ii-a's §6.2 established: the picker
ships keyboard-operable — native `<button>` semantics inside a `popover`, with `aria-haspopup` and
`aria-expanded`, reachable and dismissible without a pointer. A mouse-only *creation* control is
inoperability rather than unannounced semantics, which is the class the list's own item 1 says to fix
by building the control rather than by deferring it.

### 6.3 The rest

- **No movement.** Decision 8 of 5d-ii-a stands: close-then-create reaches every arrangement
  drag-to-reorder would, and the picker makes the "create" half cheaper than it was.
- **No persisted bindings and no persisted program text.** The leaf still carries a `PaneKind` and no
  session, so §3.3 of 5d-ii-a is untouched — the kind was always persisted, the binding still is not.
- **No second editor.** Decision 4, and the reason `setLeafKind` refuses `'source'` in both directions.
- **No results pane in the tree.** 5d-ii-a §3.2 is unchanged, and `settled(view, src)`'s twenty-odd
  browser tests still poll an element that is always present.
- **No new colour-carried state.** §4.7 uses `:focus-within`, which the DOM already maintains.
- **No answer to whether `pane-host.ts` should have been three modules.** Wave 1 splits custody out
  because §4.1 gives a reason for that boundary specifically; the rest is one subsystem until something
  argues otherwise.
