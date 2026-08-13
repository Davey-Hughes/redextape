# 5d-ii-a — the layout tree: panes become a structure, and 5d-i's central claim becomes testable

## §1 What is being built, and why 5d-ii is three slices rather than one

5d-ii-a makes the app's panes a **recursive split tree** — panes split horizontally and vertically,
dividers resize, panes close, and the arrangement survives a reload. Sessions stay at today's three,
`PaneSlot<K>` is untouched, and no pane changes its leg.

**5d-ii SPLITS INTO THREE, AND THE SPLIT IS THE FIRST DECISION THIS DOCUMENT RECORDS.** The roadmap
gives 5d-ii three subsystems in one line — *"the pane multiplexer — add/remove panes, layout,
persistence"* (roadmap:1501) — and brainstorming added a fourth by relaxing 5d-i's singleton
scratchpad rule. Four independent subsystems in one spec is what 5a and 5d were both split to avoid,
and the reasoning transfers verbatim: *"two independent subsystems in one spec means the layout engine
has to be settled before a single session-from-λ-text exists"* (roadmap:1503).

- **5d-ii-a — the layout tree** (this document). Split, close, resize, persist. Panes keep fixed legs;
  sessions stay ≤3.
- **5d-ii-b — the renderer multiplexer.** Widening a slot so a pane can change leg, and the
  `(leg, session)` picker that creates a pane of any kind. This is where `Binding<K>`'s type property
  is decided — see §3.1.
- **5d-ii-c — N scratch buffers.** Relaxing 5d-i decision 5's singleton rule to one scratch per fork,
  the retire control, a measured session cap, and the worker-affordability probe 5d-i left open
  (roadmap:5376).

**THE ORDER IS FORCED BY WHAT EACH SLICE MAKES POSSIBLE, NOT BY SIZE.** (a) delivers *two λ sessions
side by side* — the demo the binding model was chosen for — with no leg-switching at all, because
`split` duplicates the pane it splits and the binding selector 5d-i already shipped does the rest. That
is the whole reason (a) is first: it is the smallest slice that makes 5d-i's central claim performable
through the app, and §3.4 records that today it is not performable at all.

**THE ACCESSIBILITY PASS REMAINS GATED, AND ITS GATE MOVES TO 5d-iv.** Plan 5's deferral is on the
controls settling (roadmap:1289–1295). This slice adds four controls and one wholesale DOM rebuild, and
takes two deliberate exceptions where the gap is inoperability rather than unannounced semantics — §6.2.

## §2 The decisions

Restated in one line each, so a plan need not read two documents:

1. **The tree holds views onto the computation; results is chrome.** Source, λ and TM are leaves.
   `#results` is never a leaf (§3.2).
2. **Source is a singleton leaf**: at most one, closable, never splittable — there is no second editor
   to duplicate into (§4.2).
3. **Closing a pane detaches its editor's DOM node and never destroys the view** (§4.3). Program text
   is not persisted anywhere, so destroy-on-close would silently delete the user's program.
4. **There is one `EditorView` per scratch session, and it moves** between panes rather than being
   duplicated with a policy keeping copies in step (§4.3).
5. **Persistence stores tree shape, pane kinds and sizes — never bindings** (§3.3). A persisted binding
   naming a scratch could never resolve, so storing it would store a value with one valid possibility.
6. **`parseLayout` validates §4.1's invariants, not just the shape** (§4.4). `localStorage` is
   user-editable and a malformed tree that passes a shallow check crashes the renderer on load.
7. **`main.ts` is decomposed in three waves, and waves 1–2 add no tests** (§4.5). The existing suite is
   the assertion. An existing test may be edited only in its imports or its setup, never in an
   assertion — an assertion that has to move is the signal that behaviour did.
8. **Movement is out of scope.** Moving a pane is close-then-split-elsewhere; drag-to-reorder is a
   second interaction model on top of a layout engine that does not exist yet.

## §3 What verification established before any code was written

### 3.1 THE CRUX IS ALREADY WRITTEN DOWN IN THE TREE, AND (a) DELIBERATELY DOES NOT TOUCH IT

`PaneSlot<K extends Leg>` fixes its leg at construction and varies only the session, which is what keeps
`Binding<'lambda'>` from ever resolving to a `LegState<TmState>`. Its own doc names the boundary in as
many words (`sessions.ts:337-344`):

> a slot cannot be pointed at the OTHER leg… Plan T7's "the renderer follows the leg" is a pane
> MULTIPLEXER — a slot that mounts a different pane class per leg — and design §1 puts the multiplexer
> in 5d-ii. **Widening `K` to `Leg` here is where 5d-ii starts, and it is a decision with the property
> above at stake, not a field write.**

**That decision belongs to 5d-ii-b and this slice must not pre-empt it.** A layout tree needs to create
and destroy panes; it does not need a pane to change kind. `split` duplicates the leaf's `PaneKind`, so
every pane this slice creates is constructed with its leg fixed exactly as `main.ts:185-186` does today.

### 3.2 THREE SINGLETONS DECIDE WHAT CAN BE A TILE, AND ONE OF THEM IS LOAD-BEARING FOR THE TEST SUITE

`main.ts:764` records them together: `index`/`linkable`/`link` and the `results`/`view` writes *"are
not per session and stay closed over: they are the app's one editor, one status line and one results
pane."*

`#results` is the one that cannot become a leaf. It is where `showWorkerError` renders, and
`results.dataset.state` is what `settled(view, src)` polls in roughly twenty browser tests — a helper
the roadmap already documents as fragile, with the explicit warning that *"changing a helper 20 tests
depend on, at the end of a 30-commit branch, is how a green suite becomes a mystery"* (roadmap:1651).
A results pane that can be absent from the DOM makes `settled` poll an element that may not exist and
gives `showWorkerError` no guaranteed surface. **Results stays chrome, below the tree.**

The editor and `#link-status` are different: they are singletons *inside* the source pane, and the
source pane is one leaf. They move with it and are subject to §4.3's detach-not-destroy rule.

### 3.3 A PERSISTED BINDING COULD NEVER RESOLVE, SO STORING ONE WOULD STORE A KNOWN-FALSE FACT

Only appearance is persisted today (`main.ts:83-95`, `appearance.ts:10-12`); program text is not, so a
reload yields `SAMPLE` and a fresh source session. **No scratch session survives a reload**, because
nothing anywhere persists a scratch's text.

`SessionRegistry.entryOf` throws on an unknown id, deliberately (`sessions.ts:250-254`): a binding
naming a session the registry does not hold *"is a wiring bug, not a state the UI has an honest
rendering for"*. So a persisted binding has exactly one value that could ever resolve — `source` — and
persisting a field with one legal value is the fabricated-state shape `session.rs:257-273` prices.

**Persistence therefore stores no session at all**, and every restored pane starts on the source
session. 5d-ii-c may extend the format if it makes scratches restorable; until something can persist a
scratch's text, there is nothing for a stored binding to name.

### 3.4 "TWO PANES ON TWO λ SESSIONS" IS UNPERFORMABLE THROUGH THE APP TODAY, AND THIS SLICE IS WHAT FIXES THAT

`SessionRegistry`'s own doc says so (`sessions.ts:180-184`), after recording that T8 built the scratch
message the earlier paragraph said did not exist:

> What did not change is why the container lives here: the app has ONE λ pane, so "two panes on two λ
> sessions" is still unperformable through it.

5d-i asserts the property in the node tier, over two `PaneSlot`s and recording fakes, because the DOM
could not carry it. **This slice makes the browser tier able to assert it**, which is why §5's headline
test is the one that matters most in this document.

### 3.5 THE MACHINERY FOR "EDITOR PRESENT BUT NOT SHOWN" ALREADY EXISTS

`collapseButton` (`pane-chrome.ts:246`) is per-pane and toggles `.is-collapsed` on the editor host, and
`lambda-pane.ts:74-76` records that this leaves *"a live CodeMirror instance sitting"* rather than
unmounting one. §4.3 generalizes exactly this, and adds nothing new to the pane's chrome vocabulary.

`pane-chrome.ts:314-316` (`:234` when this was written; `:305-307` after 5d-ii-b grew the file and
5d-ii-c corrected it; `:314-316` after 5d-ii-c's own commits grew it again — **the same citation has
now rotted twice, the second time inside the slice that fixed it**) also records why collapse state is
not persisted — *"a scratch is retired and
replaced, not resumed, so there is no session for a remembered collapse to describe."* **That premise
is falsified by 5d-ii-c's buffers, not by this slice**, and it is noted in §6.1 so the question arrives
with the slice that changes the answer rather than being rediscovered.

### 3.6 TODAY'S LAYOUT IS FOUR HARDCODED SECTIONS OVER A TWO-COLUMN GRID

`index.html` declares `#source`, `#lambda`, `#tm` and `#results` as fixed `<section class="pane">`
elements; `style.css:209-211` makes `main` a two-column grid and `style.css:215-216` gives `.pane.wide`
`grid-column: 1 / -1`. `main.ts:63-70` resolves each host by `querySelector` and `main.ts:751-752`
constructs exactly one `LambdaPane` and one `TmPane` against them.

**Roughly thirty call sites in `main.ts` assume those two consts**, including `tmPane.setProgram`
(`:776`, `:786`, `:840`), `lambdaPane.setEditor` (`:892`, `:973`, `:1012`), `lambdaPane.renderLink`
(`:300`, `:1114`), `tmPane.setFocus` (`:280`, `:1115`) and `tmPane.setLink` (`:459`, `:1116`), plus
`draw()`'s per-pane work inline at `:239-330`. That count is what makes §4.5's collection forced rather
than tidy: thirty sites need something to iterate.

## §4 The design

### 4.1 THE TREE MODEL, AND THE INVARIANTS THAT ARE ENFORCED RATHER THAN ASSUMED

`layout.ts` is pure data with no DOM knowledge:

```ts
type PaneKind = 'source' | 'lambda' | 'tm'
type LeafId = string

type Node =
  | { kind: 'leaf';  id: LeafId; pane: PaneKind }
  | { kind: 'split'; dir: 'row' | 'column'; children: Node[]; sizes: number[] }
```

**A LEAF CARRIES A `PaneKind`, NOT A `Leg`, AND NOT A SESSION.** `'source'` is not a `Leg` — the source
pane renders an editor rather than a leg's frames — so a `Leg`-typed field could not name it. The
session is absent for §3.3's reason and because the runtime pairing lives in `panes.ts`, keyed by
`LeafId`. That keeps this module free of `SessionRegistry`, which is what makes it node-tier testable
in the way `sessions.ts` already is.

The invariants, each pinned by a node-tier test:

1. **A `split` has at least two children.** Closing a leaf that would leave one child **collapses the
   split into that child**, so the tree never accumulates single-child spines that render as invisible
   nesting.
2. **`sizes.length === children.length`, and entries sum to 1** within epsilon. Resize renormalizes.
3. **A drag that would take any pane below `MIN_PANE_PX` clamps** rather than shrinking further.
   Window resize is not clamped — panes scale proportionally and each is already `overflow: auto`
   (`style.css:106`), so a small viewport scrolls inside panes rather than fighting the tree.
4. **At most one `source` leaf.**
5. **`LeafId`s are unique** across the tree.

**THE DEFAULT TREE REPRODUCES TODAY'S ARRANGEMENT EXACTLY**, so a user who never touches a divider sees
no change and the first release of this slice is not also a redesign:

```
split(column, [ split(row, [leaf(source), leaf(lambda)], [0.5, 0.5]),
                leaf(tm) ],
      [0.5, 0.5])
```

That is `index.html`'s `#source` and `#lambda` in the two columns of `style.css:209-211`'s grid with
`#tm` spanning both beneath them (`style.css:215-216`'s `.pane.wide`), with `#results` below as chrome
(§3.2). It is the value `parseLayout` falls back to (§4.4) and the value `restore default layout`
writes.

### 4.2 WHAT SPLITS, WHAT CLOSES, AND WHAT IS NOT OFFERED AT ALL

- **λ and TM leaves split freely.** `split` duplicates the leaf's `PaneKind` and the new pane's slot is
  constructed on the source session, exactly as `main.ts:185-186` constructs today's two.
- **The source leaf is never splittable.** There is no second editor to duplicate into, and a split
  producing something undefined is the shape §3.3 cites. **Its split controls are absent, not
  disabled** — the a11y list's item 1 principle: *a control that provably cannot work should not be
  offered* (roadmap:1300-1307).
- **The source leaf is closable**, with `restore default layout` in the header bar beside the appearance
  control as the way back. §4.3 is what makes that non-destructive.
- **The last remaining leaf cannot be closed**, and again its control is absent rather than greyed.

**Movement is deliberately absent** (decision 8). Close-then-split-elsewhere reaches every arrangement
drag-to-reorder would, without a second interaction model, a drop-target hit test, or the animation
question that follows both.

### 4.3 THE EDITOR IS ONE INSTANCE THAT MOVES, WHICH MAKES THE FAILURE STRUCTURALLY IMPOSSIBLE

Splitting a pane bound to a scratch produces **two panes over one buffer**. This slice creates that
situation, so it must answer it.

**There is exactly one `EditorView` per scratch session, mounted into whichever pane last asked for
it.** Not two instances with a policy keeping them in step — one view whose DOM node relocates.
Cursor, selection and undo history survive the move because the view is never destroyed.

- **Hidden by default.** A pane bound to a scratch offers `show the term editor`; it does not open one.
  Frames render at full height until asked. This is §3.5's existing control, generalized.
- **Forking opens it on the forking pane**, because that click *is* the request to edit.
- **Showing it elsewhere moves it**, and the pane it left returns to rendering frames.
- **Any number of panes may watch a scratch's frames**; none of that requires an editor.
- **Closing the pane that holds the editor unmounts the view without destroying it**, and does not hand
  it to another pane. The scratch is unaffected — it is a session, and no pane's death retires one. The
  next pane to ask for the editor re-mounts the same view with its text, cursor and undo intact. Silent
  relocation on close is rejected for the reason movement is: the editor appearing somewhere the user
  did not put it is a state nobody performed.

**THE REJECTED ALTERNATIVE IS AN EDITOR ON EVERY BOUND PANE.** Two uncoordinated CodeMirror instances
over one buffer desynchronize between debounces and resolve last-write-wins at recompile — a control
that provably cannot work, offered anyway. Genuine shared-buffer editing needs CodeMirror collab state
and is not this slice.

**THE SAME RULE COVERS THE SOURCE EDITOR ON CLOSE, AND THERE IT PREVENTS DATA LOSS RATHER THAN
DESYNC.** Program text is not persisted (§3.3), so destroying the view on close would silently delete
the user's program. Closing the source leaf detaches `view.dom`; restore-default re-mounts the same
live view with text, cursor and undo intact.

### 4.4 PERSISTENCE, AND THE VALIDATION THAT IS THE ACTUAL WORK

Key `redextape.layout`, namespaced for the reason `appearance.ts:10-12` gives — `localStorage` is
scoped to an origin, not to an app — and every access wrapped in `try/catch` for the reason
`main.ts:83-95` gives, that it throws outright in some privacy modes.

Payload is `{ version: 1, tree }`. Not persisted: bindings (§3.3), collapse state (§3.5), program text
(unchanged from today).

**`parseLayout` VALIDATES §4.1's INVARIANTS, NOT MERELY THE SHAPE.** `localStorage` is user-editable, so
a value that passes a shallow shape check but violates an invariant crashes inside the renderer on load
— strictly worse than falling back, and unreachable from any test that only feeds it well-formed input.
It rejects: wrong or missing `version`; non-array `children`; `sizes.length !== children.length`; sizes
not summing to 1 within epsilon; a split with fewer than two children; duplicate `LeafId`s; more than
one `source` leaf; an unknown `PaneKind`.

**Failure falls back to the default tree silently**, and the stored value is overwritten on the next
layout change. A layout is a preference rather than data, and a banner on every load after a schema bump
is worse than the thing it would report.

### 4.5 MODULE SPLIT, IN THREE WAVES, AND THE RULE THAT MAKES THE WAVES SAFE

`main()` spans `main.ts:62-1127` — one function holding the state thirty call sites depend on. The
layout cannot be built inside it, and decomposing it is therefore part of this slice rather than
adjacent to it.

**Wave 1 — behaviour-preserving extraction, panes still singletons.** Each module is a factory taking
explicit dependencies and returning its functions, following the idiom the codebase already uses for
`LambdaScratchpad` (`main.ts:700`) and `SessionPool` (`main.ts:675`).

| module | takes over | today |
|---|---|---|
| `link-wiring.ts` | `index`, `linkable`, `link`, `forkFailed`, `lambdaLinkState`, `drawLink`, `lambdaLinkWindow`, `setLinkTo`, `linkAtSourceOffset` | `:220-237`, `:348-480` |
| `transport.ts` | `play`, `events` | `:482-670` |
| `replies.ts` | `onReply`, `onScratchReply` | `:767-978` |
| `compile.ts` | `schedule`, the debounce timer, the encoding picker listener | `:980-1030` |
| `draw.ts` | `detachedPanes`, `draw` | `:200-330` |

The win is not line count. It is that `index`, `linkable`, `link` and `forkFailed` stop being four
`let`s visible to a thousand lines and become one module's private state. `main.ts` lands around 250
lines: mount points, construction, wiring.

**Wave 2 — the collection.** `panes.ts` owns `LeafId → { slot, pane, host }` and exposes `add(leaf)`,
`remove(leafId)`, `of(leg)` and `of(leg, session)`. §3.6's thirty sites — now spread across five small
modules, each reviewable alone — become iterations: `tmPane.setProgram(x)` becomes
`for (const p of panes.of('tm', session)) p.setProgram(x)`. Still no layout; the collection happens to
hold exactly two panes.

**Wave 3 — the layout.** `layout.ts` (§4.1's model, node-tier), `layout-view.ts` (DOM, dividers, drag,
keyboard resize), the pane chrome controls, `restore default layout`, and §4.4's persistence.

**THE RULE THAT MAKES THIS SAFE, AND IT IS THE WHOLE SAFETY PROPERTY: waves 1 and 2 add no tests, and
the 371-test suite (roadmap:5578-5583) is the assertion that the extraction preserved behaviour.**

An existing test may be edited during those waves, but only within a boundary that keeps the signal
intact:

| may change | may not change |
|---|---|
| **import paths** — a symbol moved from `main.ts` to `link-wiring.ts` | **any assertion** — `expect`, `toBe`, `toEqual`, the value under test |
| **setup and construction** — a thing built inline now comes from a factory | **the set of tests** — nothing deleted, skipped, or renamed away |
| | **waits and timing** — no new or lengthened `until`/`settled` calls |

**The boundary is mechanical rather than a judgement call**, which is what keeps "with justification"
from becoming a rubber stamp: an import line and a setup block carry no claim about behaviour, and an
assertion is nothing but a claim about behaviour. **A wave-1 or wave-2 commit whose test diff touches
an assertion is a commit that stopped being a refactor** — that is the moment to stop and find what
moved, not to update the number.

**Timing is called out separately because it is the one that would look reasonable.** The roadmap
records `settled()`'s invariant being false and the flakes that followed (roadmap:1602-1651); reaching
for a longer wait to make an extracted module's test pass is exactly how a real ordering change gets
absorbed into the suite instead of reported by it.

**Every such edit is named in its commit message with its category**, so the review question is "are
these all imports and setup" rather than "did anything important change in eleven files".

## §5 Testing

**Node tier.**

- `layout.test.ts` — split, close, single-child collapse, size normalization, `MIN_PANE_PX` clamping,
  and a serialize→parse round-trip. `parseLayout` gets a case per rejection listed in §4.4, driven with
  hand-written malformed values rather than mutated good ones, because the hazard is a hand-edited
  `localStorage` entry.
- `panes.test.ts` — the collection over `PaneView` fakes, the idiom `tests/node/sessions.test.ts`
  already uses to drive two slots over one registry without a browser.

**Browser tier.**

- **The headline: split the λ pane, rebind one to the scratch, assert two different terms on screen at
  once.** §3.4 records this as unperformable through the app today. It is what makes 5d-i's central
  claim assertable outside the node tier, and anything weaker passes on a single-pane implementation.
- Close the source leaf, restore default, assert the program text survived — §4.3's detach-not-destroy.
- Move the scratch editor between two panes, assert cursor position and undo survive — §4.3's
  one-instance-moves.
- Divider drag changes sizes; arrow keys on a focused divider change sizes.
- Reload restores the tree; reload restores every binding to the source session (§3.3).
- Closing a pane moves focus to the pane that grew (§6.2).

**EVERY NEW TEST IS VERIFIED BY STASHING ITS IMPLEMENTATION AND OBSERVING THE FAILURE.** 5d-iii shipped
three tests that passed vacuously and the correction is standing (roadmap:5595-5601). A test for a
layout invariant is especially prone to it, because a tree that is never malformed passes a validation
test that checks nothing.

## §6 What this does not do

### 6.1 5d-ii-b AND 5d-ii-c, NAMED WITH POSITIONS RATHER THAN LEFT AS GAPS

Filed as a requirement of this slice, for the reason 5d-iii exists at all: the last unnamed capability
fell between two slices for a whole PR (roadmap:1553-1559).

- **5d-ii-b — the renderer multiplexer.** Widening a slot so a pane can change leg, and the
  `(leg, session)` picker that creates a pane of any kind rather than duplicating one. §3.1 is the
  decision it owns. Position: after this slice, before 5d-ii-c — a picker that can create a TM pane
  wants somewhere to put it.
- **5d-ii-c — N scratch buffers.** Relaxing 5d-i decision 5's singleton rule to one scratch per fork,
  with scratches as **buffers**: they outlive the panes bound to them and are retired by an explicit
  control, so closing a pane never destroys work. It owns the measured session cap and the
  worker-affordability probe 5d-i left open — *"three threads cost 2.4153× one thread's wasm baseline,
  measured; the multiplexer makes the session count open, and nothing here says where that stops being
  a good trade"* (roadmap:5376).
- **`pane-chrome.ts:314-316`'s reason for not persisting collapse state is falsified by (c), not by this
  slice.** It argues *"a scratch is retired and replaced, not resumed, so there is no session for a
  remembered collapse to describe"*; buffers are resumed by definition. (c) inherits the question.

**5d-iv, the TM editable pane, is unaffected and keeps its filed position** — after 5d-ii, before the
accessibility pass (roadmap:1561-1565).

### 6.2 THE ACCESSIBILITY LIST — TWO DELIBERATE EXCEPTIONS, FOUR ADDITIONS

The pass stays deferred and its gate is now 5d-iv. Two items here are taken anyway, because they are
**inoperability rather than unannounced semantics**, and the list's own item 1 says the fix is to move
focus deliberately rather than to start disabling things:

1. **Dividers ship keyboard-resizable** — `role="separator"`, `aria-orientation`,
   `aria-valuenow`/`aria-valuemin`/`aria-valuemax`, arrow-key adjust. A drag-only divider makes an
   entire subsystem mouse-only, which is a different class of gap from a colour-carried state.
2. **Focus after close is set explicitly** to the pane that grew. **Item 1's hazard is aggravated here
   past anything currently on the list**: `[continue]` survives its own click in the common case
   because `controls.ts` keeps the button when a run hits `budget` again, whereas close removes the
   clicked control unconditionally, every time. Leaving it would add the list's worst instance in the
   same slice that writes the list.

**Added to the standing list**, recorded as items rather than left to be noticed — which is the failure
the list's preamble exists to prevent (roadmap:1297-1299):

- `split →`, `split ↓`, `close` and `restore default layout` announce nothing when the layout changes.
- `restore default layout` rebuilds the tree's DOM wholesale with no live-region report, which is the
  largest unannounced state change in the app.

### 6.3 The rest

- **No leg switching, no pane picker.** 5d-ii-b. `PaneSlot<K>` is untouched (§3.1).
- **No second scratch session.** 5d-ii-c. Sessions stay at today's three and the singleton rule holds.
- **No persisted bindings, no persisted program text, no persisted collapse state** (§3.3, §4.4).
- **No drag-to-reorder** (decision 8).
- **No results pane in the tree** (§3.2).
- **No new colour-carried state.** The list is at eight items with three aggravations; this slice adds
  controls, not hues.
