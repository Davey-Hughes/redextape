# View layouts — design

Header toggles that choose which views are on screen, an arrangement remembered for each combination of them, keys
that cycle and rearrange, drag and drop, and panels inside a view that can be resized. The user's request
(2026-10-11): the default layout "is interesting but it's cluttered"; make it easy to cycle through layouts or to
choose exactly which views show, most often the source beside one of the TM, λ or asm views.

Code facts in §2 were read at `7cbac7d` (#140). §15 gives the command behind every figure.

**This is the design as amended on 2026-10-12**, after a prototype of §4 to §8 was built and the user tried it. §16
lists every change from the version approved at `ba4514b`, with what caused it, and §17 what the reviews of the first
pull request changed after the approval at `fed6e37`. Five points are still the user's to decide, and two he has
answered. They are gathered in §16.3, and the first and the third are marked **OPEN** where they stand; §16.4 has
what he decided with the pull request open.

## §1 Scope

In:

- An arrangement remembered for each combination of view kinds, in the workspace (§4).
- Views that a switch takes off the screen stay alive, off the page (§5).
- Four header toggles, one a kind (§6).
- *View keys*: a prefix chord, then one key. They are the app's first page-level keys (§7).
- A first load on the source and the TM view (§8).
- *Move view left*, *right*, *up* and *down*, in a view's `⋯` menu and on the view keys (§9).
- Dragging a view by its header onto an edge of another view, or of the workspace (§10).
- Boundaries between the panels inside a view that can be dragged, and a maximise button on each panel (§11).

Out:

- Pop-out windows. They get their own design after this one, and §5's off-page views are what it builds on.
- Named or numbered layouts (§3, row 4).
- A keyboard way to dock a view on a chosen edge of a chosen view (§10.4).
- A setting that rebinds the prefix chord.
- Reordering Stage tabs. In Stage the move items and the drag are not offered (§9.4).
- The width of the two panels the asm view draws side by side, the registers and the call stack (§11.1).
- WebKit, which is unmeasured, as before.

Four pull requests, in this order, each with its own plan and its own roadmap entry: §4 to §8; then §11; then §9;
then §10.

## §2 What exists

### §2.1 The tree

`layout.ts`'s `LayoutNode` is a leaf (an id and a `PaneKind`: `source`, `lambda`, `asm` or `tm`) or a split (a
direction, children and sizes). `parseTree` holds its invariants: a split has two children or more, its sizes sum to 1,
no id appears twice, at most one leaf is the source and its id is `SOURCE_LEAF`, and the tree has at most
`MAX_TREE_LEAVES` (64) leaves. A split may hold a split of its own direction; nothing refuses that.

`defaultLayout()` is a column of two rows: `source` and `lambda-0` over `asm-0` and `tm-0`.

### §2.2 What changes the tree today

| Gesture | Operation |
|---|---|
| dragging a divider | `resize` |
| `split right`, `split down` in a view's `⋯` menu | `splitLeaf` |
| `+ view` | `insertBeside` |
| a pick in a view's title | `setLeafKind` |
| `✕` | `closeLeaf` |
| *reset preset* | `defaultLayout()` |
| opening a link whole, and its undo | `main.ts`'s `showWorkspace` |

No operation moves a leaf. To put the TM view on the left of the source, a user closes one and adds it again.

### §2.3 A preset is not a layout

`workspace.ts`'s `PRESETS` are three values of the three switches: where the step controls are, tiles or a stage, a
strip or an inspector. None of them names a view, so choosing a preset shows the same views.

### §2.4 The Stage already keeps views off the page

`layout-view.ts`'s `renderStage` draws one tab a leaf and mounts the focused leaf's host. Every other host stays in
`pane-host.ts`'s map, off the page, with its pane still in the `PaneCollection`. `panes.ts`'s `onPage` is the test a
reader uses to tell the two apart, and `PaneCollection.shown`'s doc records that `draw()` hands a pin and a tree only
to views on the page.

### §2.5 What a view loses when it leaves the tree

`pane-host.ts`'s `applyLayout` drops the `PaneCollection` entry of a leaf the tree no longer holds. A λ copy's editor
goes into custody; a TM or asm copy's editor is destroyed, sending what was typed. `hostFor` keeps the host element,
and a leaf that returns under the same id has a new pane built into it. `main.ts`'s `normaliseWorkspace` drops the
leaf's panel state and display, and `serializeWorkspace` does not write them.

The source view differs in kind: `main.ts` seeds its host, and its editor survives a close and a return.

### §2.6 Leaf ids

The default tree's ids are literals. Every other id is `pane-N` from `main.ts`'s `nextLeafId`, whose counter
`seedLeafCounter` sets past every number in the tree in force.

### §2.7 The 160 px floor

`MIN_VIEW_PX` is 160. `addRefusal` holds the add gestures to it, in tiles only. A stored layout, a link's layout, an
undo and a narrower window can each show a view under it, and the Stage is held to the leaf bound alone.

### §2.8 Keys

The app has no page-level key handler. The one listener on `window` is for `hashchange`. Every key the app answers is
bound inside an editor or on a focused control.

The editors bind `defaultKeymap` and `historyKeymap`, 64 bindings. They include `Alt` with each arrow,
`Shift-Alt-ArrowUp` and `Shift-Alt-ArrowDown`, and `Mod-Alt-ArrowUp` and `Mod-Alt-ArrowDown`. The app adds `F12`,
`Shift-F12`, `F2` and `Mod-'`. With the vim keymap, a `keydown` handler of the vim extension runs ahead of all of
those (`editor-keymap.ts`).

### §2.9 Storage and links

The workspace is stored under `redextape.layout` as a version 2 envelope. Three of its fields (`inspector`, `display`,
`tmDisplay`) arrived after version 2 shipped, each as a field that may be absent. A share link carries
`serializeWorkspace`'s string, and `share-link.ts`'s `decodeLink` reads it through `parseWorkspace`. A link that opens
whole replaces the tree and the rest of the workspace (`showWorkspace`), and its undo puts both back.

### §2.10 Tests

`web/tests/browser` holds 174 test files. 96 name `lambda-0`, `asm-0` or `tm-0`, and 80 name `lambda-0` or `asm-0`.
`setup.ts` gives each file a `Storage` of its own and stores the old start-up program in it, "as a returning visitor's
would be"; `first-load.test.ts` removes it before it mounts.

### §2.11 Panels inside a view

A panel is `panel.ts`'s `createPanel`: a header with a disclosure button, and a body the view owns. A user can open and
close one. Nothing resizes one.

- **The TM and asm views share their height between their open panels**, by fixed shares in `style.css`. In a TM view
  the rules take two shares and the state diagram and the outline one each. In an asm view the listing takes two, the
  row of registers and call stack one, and the heap and the outline one each. Each body keeps a floor of five rows, and
  a closed panel keeps only its header.
- **The λ view does not.** Its term is capped at `60vh`, sixty hundredths of the window's height whatever the view's
  own height is, and its term map is a canvas 120 px tall.
- **The source view does not.** Its outline is capped at `40vh`.

### §2.12 A rebuild resets every scroll position

`renderLayout` and `renderStage` take every host off the page and put back the ones they show, which in tiles is every
one the tree names and on the Stage the focused view's alone, and an element that leaves the document comes back
scrolled to its start. Measured on the prototype before it held them (§5.2), at 1280 × 896 on `let x = 40; x + 2`:
the TM view's rule table, scrolled to 120 px, was at 0 after the toggle of another view was pressed, and so was its
program level. The rebuild is `main`'s own, so a split, a close and a preset reset them there
today.

## §3 Decisions

The user's, 2026-10-11:

| # | Question | Decision | Not taken |
|---|---|---|---|
| 1 | How views are chosen | Four toggles, and a key that cycles | Named layouts only; the source pinned beside tabs |
| 2 | How a pair is arranged | Side by side to start with, and rearrangeable | A fixed rule in the renderer |
| 3 | How a view is rearranged | Move in four directions, and drag and drop | Swap and flip only |
| 4 | What a layout is | One arrangement for each combination of shown views | Numbered slots; one arrangement with views hidden in place |
| 5 | What a fresh page opens on | The source and the TM view | The source and λ; all four |
| 6 | The shape of the keys | A prefix, then one key | Direct chords; a cycle key alone |
| 7 | The order of the header's toggles | source, asm, λ, TM | source, λ, asm, TM |
| 8 | What a wide window's layouts are built from | Columns side by side, each with its own stack: no divider and no view runs the whole width | A column of rows |
| 9 | How a panel inside a view is resized | A boundary to drag, and a maximise button on each panel | Boundaries alone; a fixed height and a grip for each panel |
| 10 | Which views get that | All four, in one pull request | The TM and asm views first; those two alone |

Rows 7 to 10 were decided with the prototype open. The user's words for row 8: "the horizontal bar should not be forced
across the whole screen if possible", and "I'd rather the vertical bar be the one that spans the whole screen".

The controller's, shown to the user and accepted: one action a prefix (§7.3); a fixed default on a combination's first
visit (§4.4); views kept alive off the page (§5); a link carries the arrangement on screen alone (§4.7); *reset preset*
forgets every arrangement (§4.6); the cycle keys `]` and `[`, answered with `Ctrl` held or not (§7.3); panel
resizing's details (§11); four pull requests (§1).

## §4 The model

### §4.1 Words

- A **kind** is a `PaneKind`.
- **`KIND_ORDER`** is source, λ, asm, TM. A combination's key spells its kinds in it, and a default arrangement places
  them by it.
- **`HEADER_ORDER`** is source, asm, λ, TM (§3, row 7). The toggles stand in it, the toggle keys `1` to `4` count along
  it, the cycle walks it, and the live region's sentence says the kinds in it.
- A **combination** is a set of kinds that is not empty. There are 15.
- A combination's **key** is its kinds in `KIND_ORDER`, joined by `+`: `source+tm`, `source+lambda+asm+tm`.
- An **arrangement** is a tree. Its combination is the set of its leaves' kinds.

A user meets none of these words. The header's group is named `views`.

The two orders are two decisions: where a view sits in the default grid, and where its toggle sits in the header. A
test holds `HEADER_ORDER` to the kinds of `KIND_ORDER`, each once.

### §4.2 What is stored

`Workspace` gains `arrangements`: a record from a key to the tree last seen for that combination, for every combination
visited **except the one on screen**. The tree on screen stays where it is, in `tree`.

**The combination on screen is not stored.** It is read from `tree`, for the reason `PRESETS`' doc gives for the
preset: a stored copy could disagree with what it copies.

`parseWorkspace` reads the field by the rules the other fields have:

- Absent, it is `{}`. `WORKSPACE_VERSION` stays 2, and a workspace stored today opens as it is.
- Present, every key is a combination's key, every value passes `parseTree`, every value's combination is its key, no
  entry is under the key of `tree`, and `tree` and the values together name at most `MAX_TREE_LEAVES` ids.
- A field that breaks any of those makes the envelope `null`, and the caller falls back to the default workspace.

**It is written only while it holds an entry**, so a workspace that remembers nothing is stored as the string it was
before the field existed.

`focused` names a leaf of `tree`, as today. `panels`, `display`, `tmDisplay` and §11's `panelSizes` may name any live
view (§5.1).

### §4.3 One function writes the tree

Every gesture's write of the tree goes through one function, `arrangements.ts`'s `enter`:

1. Read the key of `tree` (`before`) and the key of the new tree (`after`).
2. Where they differ, store `tree` under `before` and delete the entry under `after`.
3. Put the new tree in `tree`.

What each gesture then does:

| Gesture | The new tree | What is remembered |
|---|---|---|
| A switch: a toggle, or a cycle key | the entry under the target's key, or its default (§4.4) | the arrangement left, under its key |
| An edit that keeps the combination: a divider, a move, a dock, a second view of a kind | the edited tree | nothing changes |
| An edit that changes the combination: `✕` on a kind's last view, an add or a title pick that brings or removes a kind | the edited tree | the tree before the edit, under its key; the entry under the new key is replaced by the edit |

Two properties follow, and §14 tests both:

- **A switch away and back shows the tree that was left.**
- **`✕` on a kind's last view, then that kind's toggle, shows the tree before the `✕`.**

The third row has a cost, stated here so it is not found later: closing λ out of source, λ and TM replaces whatever was
remembered for the source and TM alone. The user asked for the three-view arrangement less one view, and that is what
they are left in.

**The second property is about the tree, and not about the view.** A `✕` closes its view (§5.1). The tree before it
still names the closed view's place, and the view its toggle brings back there is a new one, on the program.

*Reset preset* and an opened link do not go through `enter`. Each replaces the workspace whole, what it remembers
included (§4.6, §4.7).

### §4.4 A combination's default

`layout.ts`'s `defaultArrangement(kinds, shape)` is the tree a combination shows on its first visit. Its leaves are the
default ids: `source`, `lambda-0`, `asm-0`, `tm-0`.

A switch that shows a default gives a new id to each of its leaves whose default id is live as a view of another kind
(§5.4). With *TM · program* picked in the asm view's title, `asm-0` is a TM view, and the first visit of a combination
with asm in it builds its asm view under an id `nextLeafId` mints.

| Kinds | In a `wide` area | In a `tall` area |
|---|---|---|
| 1 | the leaf | the leaf |
| 2 | a row of the two, a half each | a column of the two |
| 3 | a row: the first, beside a column of the other two | a column: the first, over a row of the other two |
| 4 | a row of two columns: source over asm, beside λ over TM | a column of two rows: source and λ, over asm and TM |

**In a wide area no divider and no view runs the whole width** (§3, row 8). The views are columns side by side, each
with its own stack, so the one divider that spans the area is the vertical one, and each side's views are resized on
their own. A tall area gets the same trees turned on their side: there, a view across the width is the only view wide
enough to read.

All four views sit in the same corners in both shapes, and where `main`'s default has them: source top left, λ top
right, asm bottom left, TM bottom right. A tall area's tree for all four is `main`'s default tree.

`shape` is `tall` where the views area is taller than it is wide, measured by the caller when the default is built, and
`wide` otherwise or where the area has no size yet. The shape is read once. The tree it gave is remembered like any
other, so a window made wider later does not turn a column into a row.

### §4.5 A switch

A switch to a combination:

1. Does nothing where the target is the combination on screen.
2. Is refused where the tree it would enter (step 3) would take the live views (§5.1) past `MAX_TREE_LEAVES`, with a
   notice of its own that says how many views the workspace holds, how many the switch would take it to and how many
   it can keep: *showing asm and λ would take the workspace from 63 views to 65, and it can keep 64 — reset preset
   makes room*. A refused switch mints no id.
3. Calls `enter` with the remembered tree or the default, each of its leaves whose id is live as a view of another
   kind given a new id first (§5.4).
4. Records the focused view: the one that was focused where the new tree holds it, and `defaultFocus` of the new tree
   otherwise. A leaf entered under a new id is another view than the one that held the old id, so it is not the
   focused one.
5. Leaves the keyboard focus where it was, unless the view that held it left the page; then the focused view takes
   it, as after a close. A toggle keeps the focus, so a second toggle is one more press, and a view key pressed from
   an editor leaves the caret in it and the view where it was scrolled to. A divider and a Stage tab are built again
   by the render, and the focus is on the one built in its place where the new tree has a divider at the same path,
   or a tab for the same view; where it has neither, the focused view takes it. With *format on blur* on, no editor
   formats at the blur a switch's rebuild sends it.
6. Says what is shown in the live region, in `HEADER_ORDER`: "showing source and TM".

Step 5 is `pane-host.ts`'s `switchViews`, and not `focusView`, which moves the focus into the view on every call.

**A focus the app moves as the consequence of a gesture scrolls nothing where the gesture was a pointer's, and brings
what it focused into sight where it was a key's.** A pointer user was reading the view the focus goes to and is shown
no focus ring; a keyboard user has to see where the focus is. It holds for every such focus: a switch's, a `✕`'s,
`+ view`'s, a split's, a title pick's, *move the editor here*'s, *reset preset*'s and an opened link's.
`pane-host.ts`'s `moveFocus` is the one place it is done: `focus({ preventScroll: true })`, and then, where the
element matches `:focus-visible`, `scrollIntoView` to the nearest edge. A view's first control is in its header,
which scrolls with the view, so a key that gives a scrolled view the focus leaves that view at its top. An editor is
brought into sight by its caret and not by its box, which is taller than its view: a view key pressed from an editor
leaves the view where it was while the caret shows, and a key that makes the view shorter scrolls it to the caret.
An editor is focused by its own `focus()`, which scrolls nothing and writes its caret back from its state as it
focuses: focused by the DOM's, its caret was kept only where CodeMirror heard of the browser's selection within
200 ms, and a divider's drag that ended in a slower frame left it at the start of the text. The rule was chosen in
the whole-branch review (§17) and is the user's to overrule (§16.3).

A divider's drag is such a gesture, and a pointer's. Its press moves no focus, so the caret stays in its editor while
the pointer drags; its end rebuilds the views, and the focus is given back to the element that had it
(`pane-host.ts`'s `resized`, by the `keepingFocus` a switch uses). `moveFocus` is told the gesture was a pointer's
there, since an editor reads as `:focus-visible` whatever focused it: left to say, a drag moved the source view from
500 px to 80 to show a caret that was out of sight. A divider moved with its keys has the focus itself, and the
render focuses the one it builds. On `main` a drag left the focus on `<body>`, and a key typed after it went nowhere.

With *format on blur* on, no editor formats at the blur a drag's rebuild sends it, as none does at a switch's:
`keepingFocus` runs every rebuild that gives the focus back through one dependency, `rebuilding`, and `main.ts`
formats nothing at a blur sent while it runs.

A switch is not held to `MIN_VIEW_PX`. It shows a remembered tree, and a stored tree is not held to it either (§2.7).

### §4.6 *Reset preset*

*Reset preset* empties `arrangements`, puts the first-load tree (§8) in `tree`, and rebuilds the views on the program
as it does today. Its notice keeps its words. The tree is the one §8 gives the views area as it is when the item is
pressed: the source over the TM view in a tall area.

### §4.7 Links

A link carries `tree` and no `arrangements`. A reader needs what the sender saw, and a link has a size warning.
That is held where a link is read as well as where one is made: once a link's workspace has passed `parseWorkspace`,
`decodeLink` drops any `arrangements` it carries and what it stores for the views only they held, so a link written
by hand puts none in force. One whose `arrangements` do not pass is refused as any malformed workspace is: its
program opens, and its workspace and step positions are left out.

Opening a link whole puts its workspace in force, so the reader's remembered arrangements are replaced by none. The
undo an open already offers puts them back with the rest of the workspace it kept. A view that was parked (§5.1) on a
copy when the link opened comes back on the program after that undo, as after a reload (§5.2).

A link made before this design opens as it does today: its tree is the arrangement on screen, whatever combination that
is.

A link carries a step for each leg with frames, whichever views its page showed. A leg that stops short of its step
is said in the open's notice only where the tree has a view of that leg; the leg goes to its last step either way.

## §5 Views off the page

### §5.1 A switch parks a view; a `✕` closes one

A view is **live** where `tree` or any remembered arrangement holds its leaf as the kind the view is. One id is one
view, of one kind (§5.4).

- **A view a switch takes off the screen is parked.** `applyLayout` keeps its `PaneCollection` entry, with its pane,
  off the page, as a Stage tab that is not selected keeps its own. It stays parked through every later gesture, for as
  long as it is live. An edit that replaces the arrangement it is parked in (§4.3) closes it, though an older
  arrangement may still name its id as another kind.
- **A view an edit takes out of the tree is closed, as it is today**, though the tree before the edit is remembered and
  still names its leaf. Its entry is dropped, its copy's editor is handed on as a close hands it, it stops counting as
  a view of its copy, and its panel state, display and panel sizes are dropped. A view built later where it was is a
  new one, on the program.
- `applyLayout` builds a pane only for a leaf of `tree`. A view that storage remembers in another arrangement has no
  pane until that arrangement is entered, so a reload builds what it builds today.
- `normaliseWorkspace`, `serializeWorkspace` and `parseWorkspace` keep panel state, display and panel sizes for every
  live view.
- `seedLeafCounter` steps past every live id, so an id minted in one arrangement cannot be one another holds.

The version approved at `ba4514b` parked both. The prototype showed what that did to a `✕`: the copies menu went on
counting a closed view as a view of its copy, and *reset preset* gave the closed view's panel state to the view built
in its place (`scratch-buffers.test.ts`, `workspace-restore.test.ts`).

### §5.2 What a switch away and back keeps

- **The pane itself**, so its selections and what it has open.
- **Where each of its scrollers was scrolled to, its own scroll box among them.** `pane-host.ts` records the host of
  every view on the page and every scrolled element inside it before a rebuild and puts each back after it, and keeps
  a parked view's until it returns (§2.12 has what a rebuild did without it). This holds for every rebuild, so a
  split, a close and a preset stop resetting the views that stay on the page. The view a rebuild gives the focus to
  is one of them where the gesture was a pointer's (§4.5): with a bare `focus()` on its first control, the source
  view at 120 px was at 0 once the `✕` of the TM view beside it had been pressed. Where the gesture was a key's, that
  view is scrolled to show the control the focus is on.
  - **A box that follows the run comes back following.** The rule table, the state diagram, the asm listing and the λ
    body each scroll themselves to the current row until the user scrolls. A position is put back through
    `state-table.ts`'s `restoreScroll`, which tells the box's `Follow` before the write, and again where the browser
    clamped it, so the write is not read as the user taking control. A box the user had scrolled comes back where
    they left it, still not following.
  - **A view built in the rebuild starts at its top**: one a toggle builds where a closed view was, and every view of
    an opened link, the source view among them, since the link gives it another program.
- **The source editor**, which already survives leaving the tree (§2.5).
- A run's step position was never the view's: it is its session's.

**After a reload**, a view off the page is rebuilt from the workspace when its arrangement is entered. It keeps what
the workspace stores for it: its panel state, display and panel sizes. It does not keep a copy: a parked view that
showed a copy comes back on the program, and the copy is in the copies menu. A view on the page keeps its copy across
a reload, as today. Which view shows which copy is stored each time the layout is applied, and not only at a fork, a
pause and a delete: stored at those alone, a copy's view closed with `✕` left its binding behind, and a reload gave
the copy to the view its toggle had built on the program.

### §5.3 Who reads which views

A parked view's entry is in the `PaneCollection`, so everything that keeps a view true goes on reaching it: a deleted
or paused copy moves it onto the program, a reply about its session reaches it, and an edit is flushed from it.

**The surfaces the views share read the views of the tree on screen, and never a parked one**: the step bar's target,
the link status line's count and names, the share popover's line about copies, and the running focuses. A parked
view has no tab and no place on the page, where a Stage tab that is not selected has a tab that names it. So with the λ
view toggled off, the source editor carries no running focus of a term no view shows, and the step bar never drives a
view no one can see.

The first plan carries a census that makes this true: every reader of `PaneCollection` and every reader of
`leaves(tree)` in `web/src`, each recorded as wanting the views on the page, the views of the tree, or every entry. The
census is an enumeration of the readers, not a search for the names this design expects. One was run on `ba4514b` for
the prototype; it listed 11 places that write the tree, and the readers the paragraph above names came from it.

### §5.4 One id, two kinds

A title pick changes a leaf's kind and keeps its id (§2.2), so an arrangement off the screen can remember an id under
the kind it used to have.

**One id is one view, of one kind.** Where two trees name an id as two kinds, the view is what the tree on screen
says; for an id the tree on screen does not hold, it is what the arrangement left last says, since that tree is the
last one that had the view on the page. `enter` puts the tree it leaves after every entry it keeps, so the order of
`arrangements` is the order its trees were left in, and `liveLeaves` reads it.

**A switch enters a leaf whose id is live as another kind under a new id** (`arrangements.ts`'s `reidentified`,
called by `main.ts`'s `switchTo` before `enter`, for a remembered tree and for a default alike). The view that leaf
named no longer exists, and a new one is built in its place either way; under an id of its own it is built beside
the view that holds the old id, which stays parked like any other. Entered under the old id, it had `applyLayout`
build its kind over that view: a TM view of a copy, picked in the asm view's title and parked, was destroyed by the
switch that next showed an asm view. A pick in a title still keeps its id. The source leaf is never given another.

Only the tree a switch enters is given new ids, so an id can stay under two kinds in `arrangements` until the tree
that names it as what it was is entered. What the workspace stores under an id — panel state, display, panel sizes —
stays with the view that holds it; the view built under the new id starts from the defaults. Each leaf entered
under a new id is one more live view, and the bound (§5.6) is asked of the tree as it is entered.

The version approved at `fed6e37` had the tree on screen win and the other arrangement's view rebuilt as the kind it
said. §17 has what that did.

### §5.5 Copies and their editors

A parked view still shows the copy it showed, and keeps the copy's editor if it held it. A view on the page showing
the same copy offers *move the editor here*, which takes it from the parked view as it takes it from a Stage tab that
is not selected.

Three defects were in the way, and the first pull request fixes all three:

- **A view off the page went on holding the editor of a copy it no longer showed.** The editor comes down in the
  `draw()` after a view is moved onto the program, and `draw()` passes over a view that is not on the page. So when a
  copy was deleted and its *undo* pressed, the first view moved back got a second editor, and the next sweep handed
  it the stale one and threw `a λ pane was handed a second editor while still holding one`. Reproduced on the
  prototype for a parked view and for a Stage tab that is not selected, the second with gestures `main` has.
  `pane-host.ts`'s `reseedingSlots` takes the editor down as it moves a view off the page onto the program. A paused
  copy leaves the same editor behind and throws nothing. The tests hold both routes for λ, TM and asm copies, by
  counting the editors in the host of the view that is off the page: one before the delete or the pause, none after.
- **A parked view could come back showing a copy with no editor on the page and nothing offering one.** While it was
  off the screen, the view that held its copy's editor could be closed: a machine copy's editor is destroyed then, and
  `mountOnViewOf` looks for a view of the copy in the tree. A view that returns from a remembered arrangement showing a
  copy no view holds an editor for now mounts one, as a new view does.
- **A delete's undo could put the copy's editor in a parked view**, with a view on screen showing the copy and holding
  none. `pane-host.ts`'s `moveBack` took the first view it moved back. It takes the views of the tree on screen first,
  so the editor and the focus land where the user can see them, and a parked view gets them only where no view on
  screen shows the copy. A Stage tab that is not selected is a view of the tree, so the Stage still mounts the editor
  on the older view of the copy whether or not its tab is the one shown: `main`'s behaviour, left as it is.

### §5.6 The bound

`MAX_TREE_LEAVES` bounds the live views, not the tree on screen alone. `pane-host.ts`'s `admit` asks it of all of them,
so `+ view` and a split are refused at 64 live views — except the source view where an arrangement holds it already,
which adds no view. On the Stage that is the only test an add meets: every leaf of the tree on screen is a live view,
so nothing asks `layout.ts`'s `holdsMostLeaves` of that tree apart from it.

A `✕` does not always make room: on a kind's last view it leaves the tree before it remembered, with the closed
view's leaf in it. So the notice counts the views that are not on screen and names *reset preset* for a close that
makes none: *the workspace holds 64 views, 60 of them not on screen, the most it can keep — close one to add another,
or reset preset if that makes no room*. In a custom workspace, whose menu has no *reset preset*, the notice says to
choose a preset first. A switch past the bound has a notice of its own (§4.5).

## §6 The toggles

A group named `views` sits in the header after the workspace menu's button and before `+ view`. It holds four joined
buttons in `HEADER_ORDER`: `source`, `asm`, `λ`, `TM`.

- A button is pressed where the tree on screen holds a view of its kind, and `aria-pressed` says so. A pressed button
  is solid, raised and underlined, and one that is not is dim and dashed: never colour alone.
- Pressing one switches (§4.5) to the combination with that kind added or removed.
- **A button's accessible name is its own word**, which the umbrella design's rule 1 asks for, and its tooltip says
  what a press does: *hide the TM view*, *show the TM view*. A toggle acts on every view of its kind, so where that
  is more than one the tooltip counts them: *hide the 2 TM views*, and *show the 2 TM views* of a press that brings
  back an arrangement holding two. `controls-gate.test.ts` takes `λ` as a name: it is a letter.
- **The last pressed button is disabled, and its tooltip is the reason**, by rule 4: *the TM view is the only one shown
  — one view stays*, or of two TM views with no other kind on screen, *the 2 TM views are the only ones shown — one
  kind of view stays*. The tooltip, `aria-description` and the notice line are one function's words,
  `app-header.ts`'s `toggleSentence`. It is disabled by `aria-disabled` and not by the `disabled` attribute, so that
  it keeps the focus when a view key leaves it the only one pressed. A press on it switches nothing, and the notice
  line says the same words.
- The focus stays on the button. The header is outside `<main>` and no layout rebuilds it.
- The four buttons are `index.html`'s own markup, not pressed, and `viewToggles` adopts them, so they hold their
  place from the first paint. Built by `main.ts` after the wasm had loaded, they moved `+ view`, `copies`, `examples`
  and `encoding` right by their own width (§6.1) in a header already on the page.
- The toggle that has the focus is drawn over its neighbours, so its ring is whole where a pressed one is beside it.

`+ view`, `✕` and the split items keep their behaviour. They edit the arrangement on screen (§4.3). `+ view`'s menu
is filled again where the tree changes while it is open, and a rebuild closes a view's `⋯` menu and its title's with
their events, so neither menu offers `source` once a view shows it.

In Stage the toggles choose which tabs there are.

### §6.1 What the toggles cost the header

The four are 147.5 px wide in Paper, 149.1 in Terminal and 154.0 in Instrument. Measured at 1280 px:

| Style | Workspace button | The header needs | Rows |
|---|---|---|---|
| Paper | `Debugger ▾`, its widest | 1,258.1 px | one |
| Instrument | `Stage ▾` to `Debugger ▾` | 1,244.0 to 1,274.0 px | one, with 6.0 px to spare at its widest |
| Terminal, at the full gap | `Stage ▾` to `Debugger ▾` | 1,315.1 to 1,342.1 px | two |
| Terminal, at half the gap | `Stage ▾` to `Debugger ▾` | 1,227.1 to 1,254.1 px | one, with 25.9 px to spare at its widest |

**Terminal's header has half the column gap in a window 85rem wide or narrower**, so that it is one row at 1280 px
as `main`'s is (the user's decision, 2026-10-12). At the full gap `settings` went to a second row there, and the
header from 46 px to 91 as the page loaded. Terminal draws the header in the machine's monospace, so these are this
machine's figures; a test holds the gap and not the row it buys. Above 85rem the header fits at the full gap.

In each style there is a band of window widths, as wide as the toggles and one 16 px gap, so 164 to 170 px, where the
header fitted one row without the toggles and takes two with them; in Terminal the half gap takes 88 px off it.

**In a window 40rem wide or narrower the toggles are hidden**, by a `hidden` attribute `main.ts` sets from that media
query. The query is `app-header.ts`'s `NARROW_WINDOW`; the stylesheet's rule and the help page, which gives the width
as about 640 px, cannot read it, and a node test holds each to it. At 390 px the toggles cost the header a row,
181 px where `style.css` records 136 without them, and at 320 × 568 the page no longer fits its window; at 481 px
they cost it a row too, which `inspector-phone.test.ts` measures. A view's
`✕`, `+ view` and the view keys still choose the views there. A toggle that has the focus when the window is narrowed
hands it to `+ view`, the nearest control left in the header. `style.css` has a media rule of the same width beside
the attribute, for the paint before `main.ts` runs: with the buttons in the markup and no rule, a 390 px header was
181 px until then and 136 after. The attribute as well as the rule, so that `controls-gate.test.ts` does not walk a
control no one can reach.

**Left as it is:** `main.ts` fills the `encoding` select and `#appearance` late, as on `main`, so `share`, `about` and
`settings` move left when they arrive, and in a window narrow enough that the filled header needs a row more than
the markup alone, the header grows as the page loads. In Terminal at 1280 px that was 46 px to 91; with the half gap
it is 46 px before and after.

**OPEN:** hiding them is the prototype's choice. The other is to move the group into the workspace menu at that width,
which keeps the toggles within reach of a pointer on a phone for a little more code.

## §7 View keys

### §7.1 One listener

`view-keys.ts` holds a two-state machine, idle and armed, and one `keydown` listener on `window` in the capture phase,
so it runs before an editor's handlers and before the vim extension's. The machine takes a key and returns an action
or nothing, and has no DOM in it.

### §7.2 The prefix chord

The prefix is `Ctrl+.`. It is not among the 64 bindings (§2.8).

- In Chromium under Playwright it arms the mode from the source editor, a λ copy's editor and a machine copy's
  editor, and under the vim keymap from the source editor, and the key after it reaches the listener ahead of vim.
- The user's own browser delivered it to the page (2026-10-11).
- Firefox is not measured.

The prefix is ignored while a modal dialog is open, and while a key event is part of a composition. An armed mode a
modal dialog opens over is left by the next key, which is the dialog's.

### §7.3 One action, then idle

Armed, the next key acts and the machine is idle again:

| Key | Action | Pull request |
|---|---|---|
| `]`, `[` | the next or the previous stop of the cycle (§7.4) | first |
| `1` `2` `3` `4` | the toggle for source, asm, λ, TM | first |
| `h` `j` `k` `l`, or the arrows | move the focused view left, down, up, right (§9) | third |
| `Escape` with no `Alt` or `Meta` down, or the prefix again | nothing | first |

- A key the table names is consumed: the editor under the focus does not see it.
- **`Ctrl` may still be down for the second key or not.** Holding the prefix's modifier through it is the natural
  motion.
- **A key held down is one press.** A repeat of a press the listener consumed is consumed and does nothing, and a
  repeat of one it let through is let through; none reaches the machine. So the prefix held leaves the mode armed,
  and a table key held acts once. A repeat is told by its key's `code`, whatever was pressed or released since its
  press.
- **A view key closes every open popover before it acts**, as a pointer press on the page behind one does. Where the
  focus was inside the popover it goes back to the element that had it before the popover opened, which is the
  popover's button for one opened from it. `Escape` leaves the mode, and a second one closes the popover. While the
  encoding select's list is open the browser gives the keys to the list, and the mode does not arm.
- **No key of the table is one the browser keeps under `Ctrl`.** The cycle keys were `n` and `p` in the version
  approved at `ba4514b`. The user held `Ctrl` through the second key and `Ctrl+N` opened a window, which no page can
  stop; `Ctrl+P` prints.
- **Any other key ends the mode and is handled as if the mode had never been armed.** A modifier pressed alone does
  not end it: any of the UI Events key values' modifier keys, a lock key among them.
- A pointer press, or the window losing the focus, ends it.
- Nothing ends it on a timer.

**One action a prefix, and the reason.** A mode that stayed armed would take the next `j` or `]` meant for the editor,
and under vim those are the keys a user presses next.

While the mode is armed a hint lists the keys over the foot of the page, and the live region says the hint's rows as
one sentence: "view keys: ] the next layout, [ the previous layout, 1 show or hide source, 2 show or hide asm, 3 show
or hide λ, 4 show or hide TM, Esc or Ctrl+. leave". Leaving the mode says nothing. A toggle key for the only view
shown says why on the notice line.

The help page has a table of these keys, and a test holds it to the machine's own table as `#editor-keys` is held to
the editors' bindings.

**`Ctrl+1` to `Ctrl+4` reach the page in the user's own browser.** With three tabs open and the page in the first,
`Ctrl+.` and then `Ctrl+2` toggled the asm view and the browser stayed on the page's tab (the user, 2026-10-12). The
test browser has no tab strip to switch, so no test holds it. A browser that kept those keys for its tabs would need
the toggle keys to be four others.

### §7.4 The cycle

Four stops, in order: the source beside asm; the source beside λ; the source beside TM; all four. They are the source
beside each other kind in `HEADER_ORDER`, then every kind. `]` goes to the stop after the combination on screen and `[`
to the one before, wrapping. From a combination that is not a stop, `]` goes to the first stop and `[` to the last.

## §8 The first load, and where tests start

A fresh page opens on `defaultArrangement` of the source and TM, with the focus on the TM view: side by side in a wide
window, the source above in a tall one. `defaultLayout(shape)` keeps its name and returns that tree. The shape is a
required argument of it and of `defaultWorkspace`, so a caller that means the default says for which area, and a
test that wants four views asks the harness for them.

**The tests keep starting where they were written.**

- `setup.ts` stores a workspace whose tree is the four views in two rows of two, beside the program it stores already
  and for the reason it gives there: a file written against four views starts as a returning visitor with four views
  would. A file that tests the first load removes it before it mounts.
- That tree is spelled out in the test harness, as `fourViews()`, and not taken from `defaultArrangement`: what those
  files measure is that tree's rows, paths and leaf order, and a wide window's default for all four is two columns.
- A file that reset between cases with *reset preset* calls the harness's `resetToFourViews()`. It presses *reset
  preset* and then the λ and asm toggles in a window taller than it is wide, where their default is that tree, and puts
  the window back. It throws, naming the arrangement it found, unless the page ends on that tree.
- `four-views-fixture.test.ts` holds what that leaves behind and a stored four-view page does not: two remembered
  arrangements, the live region's sentence, λ and asm views built new each time, and the focus in the λ view.

That seed lets a file written against four views pass with nothing in it changed, and a default that changes under
tests that stay green is how a test goes on passing while it checks nothing. So the first plan lists, by reading,
every test whose assertion is about the default tree itself: what *reset preset* restores, what a fresh workspace
holds, what a page shows when storage cannot be read. Those are rewritten against the new default, and each rewritten
assertion is sabotaged once to show it can fail. On the prototype, 35 of the browser files failed before any was
touched, and they are where that list starts. The list missed some, and §17 has which.

## §9 Moving a view

### §9.1 The controls

A view's `⋯` menu gains *move view left*, *right*, *up* and *down*. The source view's menu gains them too: `main.ts`
builds that view's own `viewMenu` and hands it the handlers that apply to it, as it hands it `close` today. Armed view
keys act on the focused view (§7.3).

### §9.2 `moveLeaf`

`layout.ts` gains `moveLeaf(root, id, direction)`, which returns the new tree, or `null` where the leaf has nowhere to
go that way. The axis is a row's for left and right and a column's for up and down. `G` is the nearest split above the
leaf that runs along the axis and in which the branch holding the leaf has a sibling on the side moved towards; `N` is
that sibling.

| Case | Condition | Result |
|---|---|---|
| 1 | The leaf is a child of `G` and `N` is a leaf | the two trade places; each slot keeps its size |
| 2 | The leaf is a child of `G` and `N` is a split | the leaf leaves `G` and joins `N`: first in it when moving right or down, last when moving left or up |
| 3 | The leaf is deeper than a child of `G` | the leaf leaves its split and becomes a child of `G`, between its old branch and `N` |
| 4 | There is no `G` | the leaf takes that whole side of the tree: it joins the root at that end where the root runs along the axis, and otherwise the root and the leaf become the two halves of a new split |
| — | Case 4, and the leaf is already the root's child at that end, or is the whole tree | `null` |

A leaf that joins a split takes an equal share, as `insertBeside` gives one, and the split it left closes up as
`closeLeaf` closes one. A new split in case 4 is a half each.

With S, L, A and T for the four default views:

| Tree | Move | Case | Result |
|---|---|---|---|
| `row[S, T]` | T left | 1 | `row[T, S]` |
| `row[S, T]` | T down | 4 | `col[S, T]` |
| `row[S, T]` | T right | — | `null` |
| `row[col[S, A], col[L, T]]` | A right | 3 | `row[S, A, col[L, T]]` |
| `row[S, A, col[L, T]]` | A right | 2 | `row[S, col[A, L, T]]` |
| `row[col[S, A], col[L, T]]` | A down | 4 | `col[row[S, col[L, T]], A]` |
| `col[S, row[L, T]]` | T up | 3 | `col[S, T, L]` |
| `col[S, row[L, T]]` | T down | 4 | `col[S, L, T]` |

This is how a tiling window manager moves a window. It differs in one way from the summary the user approved, which
said a view joins a row or column "at the spot nearest where it was". A view inside a row or column first leaves it
(case 3) and joins the next one on a second press (case 2), and it joins at the end nearest where it came from.

### §9.3 Refusals

A move is refused where `moveLeaf` returns `null`, and where a view the move makes narrower would come out under
`MIN_VIEW_PX` wide, or, for a move up or down, a view it makes shorter would come out under it tall. That is
`addRefusal`'s rule for an add, asked of a move.

A refused item in the menu is disabled with its reason. A refused key says the reason on the notice line.

### §9.4 The Stage

In Stage the four items are removed, as the split items are: tabs have no arrangement to move in.

### §9.5 After a move

The focus stays in the moved view, through `focusView`. The live region says what moved and which way.

## §10 Drag and drop

### §10.1 The gesture

A drag starts when a pointer that went down on a view's header has moved 6 px. A press that ends inside 6 px is the
click it always was, on whatever control it was on. The header gets no handle of its own: the roadmap's entry for #140
measured a TM header at 1280 px in Explorer with 5.9 px to spare.

It is built on pointer events with capture, as the divider's drag is, so a touch drags as a mouse does and a test can
drive it with real pointer input.

### §10.2 Where a view can be dropped

- **On another view on the page:** the pointer is in an edge's zone where it is within a quarter of the box's width of
  the left or right edge, or a quarter of its height of the top or bottom. Where two edges qualify, the zone is the
  edge the pointer is nearer, as a fraction of the box. The middle of the box has no zone.
- **On the workspace:** a band 24 px deep along each edge of the views area, which wins over a view's zone under it.

The zone under the pointer is drawn as the box the view would get, from `leafExtents` on the tree the drop would make.
`Escape`, or a release outside every zone, cancels and changes nothing.

A zone is not offered where the drop would leave the tree's shape as it is, or would break §9.3's floor.

### §10.3 `dockLeaf`

`layout.ts` gains `dockLeaf(root, id, target, edge)`.

- **On a view:** the leaf leaves its place as `closeLeaf` removes one. Where the target's split runs along the edge's
  axis, the leaf joins it beside the target on that side, and each takes half the size the target had. Otherwise the
  target becomes a split along that axis holding the two at a half each.
- **On the workspace:** `moveLeaf`'s case 4.

After a drop the focus is in the dropped view, and the live region says where it went.

### §10.4 The keyboard

**A drop has no keyboard equal.** `moveLeaf` reorders, joins and takes a side. It does not make a new split out of two
single views inside a larger tree, which is what a drop on a view's edge does: from `col[row[S, L], A, T]` no sequence
of moves puts A and T side by side under the top row.

The nearest the keyboard comes is `split right` or `split down` on one of the two views, choosing what the other
shows, a move to put the pair in order, and `✕` on the view that was to move. What that leaves is a new view where the
moved one would have been: it does not have the closed view's scroll position or open panels. The source view has no
split items and a tree holds one source view, so a pair that includes it is made by closing the source view first and
choosing `source` in the other view's split.

This is recorded for the accessibility pass (Plan 7 part 7) and not closed here.

### §10.5 The Stage

In Stage a header does not drag.

## §11 Panels inside a view

### §11.1 What is resized

Every boundary between two regions of a view that share its height:

| View | The regions that share its height, top to bottom | Keeps its own height |
|---|---|---|
| TM | a copy's text, the rules, the state diagram, a copy's outline | the tapes, the status lines |
| asm | a copy's text, the listing, the row of registers and call stack, the heap, a copy's outline | the status line |
| λ | a copy's text, the term, the term map | the status line |
| source | the outline, the editor | — |

Two of those views do not share their height today (§2.11), so they are made to, first:

- **The λ term loses its cap of `60vh` and takes the view's spare height.** The term map starts at the 120 px it has
  now and becomes a region with a share like any other. Its canvas reads its height when it draws, so it draws again
  when its boundary moves.
- **The source outline loses its cap of `40vh`** and shares the view with the editor.
- **A copy's text panel joins the stack** in the three views that have one. Today it keeps its own height above the
  panels, so an editor cannot be given room that the rules have.

The registers and the call stack, side by side in one row of the asm view, stay an even split: they wrap one under the
other in a narrow view, and a boundary between them would have no place there.

### §11.2 The boundary

A boundary is drawn between two regions of the stack that are both open, where no open region lies between them. It is
the layout divider's gesture, in one implementation: a `role="separator"` that takes the focus, dragged with a pointer
under capture, moved by `ArrowUp` and `ArrowDown` in steps, and named for the two regions it parts, as "resize rules
and state diagram".

- Dragging it gives one region more of the view and the other less. No other region changes, and the view does not
  grow, so nothing new scrolls.
- **A drag stops at a floor.** Each region's body keeps the floor it has today, five rows, and the boundary does not
  pass the point where either neighbour would go under its own.
- A double click, or `Enter` on the focused boundary, puts both regions back to their default shares.
- A closed region keeps only its header and takes no share, as today. The boundary beside it is not drawn while it is
  closed.

### §11.3 Maximise

Each panel's header has a button, after its other actions, named for its panel: "maximise rules". It is a toggle, and
`aria-pressed` carries its state.

- Pressed, its panel takes all of the view's spare height, and every other region of the stack is drawn as closed is:
  its header alone. Their stored open states are not changed.
- Pressed again, the regions are drawn as they are stored.
- Opening another region by its own disclosure ends it, and so does closing the maximised panel.
- **It is not stored.** A reload shows the panels as the workspace has them.

### §11.4 What is stored

`Workspace` gains `panelSizes`: for a view, by leaf id, a share for each of its regions by name. It is a field that
may be absent, read by `parsePanels`' rules: an entry names a live view, and a share is a finite number above 0. A
region with no entry has its default share, the one `style.css` fixes today. A view built with no entry looks as it
does now.

It follows the panel state it sits beside: a parked view keeps its sizes, a closed view's are dropped, and a link
carries the sizes of the views on screen.

### §11.5 Settled before its plan

- Whether the λ term's rows, which are drawn for the part of the term in view, are drawn right when the term's height
  comes from the view and changes under a drag.
- What the term map costs to draw again on each frame of a drag, and whether it is drawn on each or at the drag's end.
- The default share the outline has beside the source editor.

## §12 The other surfaces

- **Presets and switches** are unchanged, and apply to every arrangement alike.
- **The readout** follows the focused view, which is always a leaf of the tree on screen (§4.2).
- **The step bar** drives a view of the tree on screen (§5.3): the focused one, or the last that could step. In Stage
  that may be a tab that is not selected, as today. It is never a parked view.
- **The copies menu** counts a parked view as a view of its copy, as it counts a Stage tab that is not selected.
- **`+ view`** adds beside the focused view by joining its row, and wraps the view in a new row where its split is not
  one. In a wide window's defaults a view's split is a column, so `+ view` halves the focused view there. **OPEN:**
  whether it should add a column to the workspace instead.

## §13 Failure

- **A stored `arrangements` or `panelSizes` that does not parse** resets the workspace to the default, silently, as any
  other field of it does.
- **A switch that would pass the bound** is refused with a notice, and nothing changes.
- **A refused move or drop** changes nothing and says why.
- **A throw while a tree is applied** is met as it is today: `applyLayout`'s `finally` renders, stores and draws
  whether or not the custody sweep threw, and a switch, a move and a drop each go through it like every other gesture.

## §14 Testing

Node tier, on values:

1. `defaultArrangement` for all 15 combinations and both shapes: each passes `parseTree` and has the kinds asked; none
   has a column for its root in a wide area or a row in a tall one; all four sit in the same corners in both.
2. `enter`: the two properties of §4.3, over generated sequences of switches and edits, from the first load's two
   views and from a workspace of 60 live views, where switches and adds are refused at the bound; after every
   gesture, that the workspace reads back through `parseWorkspace` and that `liveLeaves` gives each view on screen
   the kind the tree on screen gives it; and after every switch, that no id that was on screen is back on it as
   another kind. The sequences' switch is the test's copy of `main.ts`'s `switchTo`; the app's own is held in the
   browser (item 20).
3. `moveLeaf`: §9.2's table, and for any tree and direction that the result is `null` or passes `parseTree` with the
   same leaves.
4. `dockLeaf`: the same two checks, for every target and edge.
5. `parseWorkspace`: an absent field; each rule of §4.2 broken in turn; a workspace stored before this design; and the
   same for `panelSizes`.
6. Links: one made before this design still opens, reading as remembering nothing.
7. The view keys' machine: every row of §7.3, with `Ctrl` held and without; each modifier key pressed alone, as its
   own keydown reports it; a key that is not in the table, `n` and `Ctrl+N` among them, passing through.
8. `HEADER_ORDER` is the kinds of `KIND_ORDER`, each once.
9. The help page's table of view keys is the machine's.

Browser tier, with real keys and real pointer input:

10. Each toggle; the last one disabled with its reason; a new link carrying the arrangement on screen and no other.
11. The prefix with the focus in each editor; under vim, a digit after the prefix being the mode's and no count of
    vim's; `Ctrl` held through the second key; an unknown key reaching the editor; a modal dialog blocking it; a key
    held down, and its repeats after another key is pressed or released; each modifier key the driver has, pressed
    alone; a popover of each kind open; the window losing the focus; a prefix pressed during a composition.
12. A view scrolled, kept through another view's toggle and through its own, its own scroll box among them; a box that
    follows the run still following when its view returns, by its toggle and by its Stage tab.
13. A fresh page in a wide window and in a tall one.
14. A `✕` closing its view: the copies menu saying its copy is not shown.
15. A copy deleted and restored, and paused and resumed, while the view holding its editor is parked and while it is a
    Stage tab that is not selected, for a λ, a TM and an asm copy.
16. Each move from the menu and from the keys, and each refusal's words.
17. A drag to each kind of zone, a cancelled drag, and a press that does not travel 6 px still clicking.
18. A boundary dragged and moved by keys in each of the four views; its floors; its reset; a maximise and its three
    ways out; sizes kept across a reload and across a switch away and back.
19. After every gesture above, the focus is on an element inside `<body>` and not on `<body>`, at once and two frames
    on (`harness.ts`'s `focusInPage`). A pointer press on a part of the page that takes no focus is not held to it:
    the browser leaves the focus on `<body>` there, with the view keys' mode armed or idle.
20. A view whose id another tree names as another kind, parked by a switch and returned whole: from gestures, and from
    a stored workspace that already holds the id twice.
21. Both sides of the bound, for an add and for a switch, and each notice's words in a preset and in a custom
    workspace.
22. The scroll of the view a gesture gives the focus to, for a pointer and for a key, on the two views of a first load
    and on all four in the wide default.
23. On those two trees, which are the ones a visitor is given: a `✕` on each view, *reset preset*, each view key from
    each view, and a pointer drag of each divider.
24. The source view's own `✕` going through `enter`; a toggle that stands for two views of its kind; the toggles at
    the narrow width and one pixel over it.
25. A divider dragged with the pointer and moved with its keys leaving the focus where it was, with a key typed after
    the drag landing at the caret, on those two trees; with *format on blur* on, the drag asking for no format and
    leaving the text and the caret as they were, in the source editor and in a copy's; and the caret kept where the
    frame that gives the focus back takes 250 ms.

`controls-gate.test.ts` walks the toggles in a window wide enough to show them, and asserts they are among what it
walked. It walks the menu items and the maximise buttons as it walks every control.

Measured in the first pull request, each figure with its command in the roadmap entry:

- A switch between the source with TM and all four, on the costliest shipped example, at full speed and at a quarter
  of a core.
- The header with the toggles (§6.1), again, on the branch that ships them.

A visual check in the three presets, light and dark, as each part's roadmap entry records.

## §15 Figures, and what produced them

| Value | What | Produced by |
|---|---|---|
| 174 | browser test files at `7cbac7d` | `ls web/tests/browser/*.test.ts \| wc -l` |
| 96 | of them naming a default machine view's id | `grep -l -E "lambda-0\|asm-0\|tm-0" web/tests/browser/*.test.ts \| wc -l` |
| 80 | of them naming `lambda-0` or `asm-0` | `grep -l -E "lambda-0\|asm-0" web/tests/browser/*.test.ts \| wc -l` |
| 64 | bindings in `defaultKeymap` and `historyKeymap` | in `web/`: `node --input-type=module -e "import { defaultKeymap, historyKeymap } from '@codemirror/commands'; console.log([...defaultKeymap, ...historyKeymap].length)"` |
| none | of `Ctrl-.`, `Ctrl-,`, `Alt-;` among those bindings' `key`, `linux`, `win` and `mac` | the same import, each binding's four fields collected into a set and each candidate looked up |
| none | page-level key listeners at `7cbac7d` | `grep -n -E "(document\|window\|globalThis\|body\|documentElement)\.addEventListener\(" web/src/*.ts` prints nothing; `grep -n -E "(^\|[^.A-Za-z_#])addEventListener\(" web/src/*.ts` prints `main.ts`'s `hashchange` and three type declarations |
| 15 | combinations | 2⁴ − 1 |
| 64, 160 | `MAX_TREE_LEAVES`, `MIN_VIEW_PX` | their declarations in `web/src/layout.ts` |
| 5.9 px | a TM header's spare width at 1280 px in Explorer | the roadmap's entry for #140, as measured there; not re-measured |
| 60vh, 120 px, 40vh | the λ term's cap, the term map's height, the outline's cap | `.term`, `.term-map` and `.outline` in `web/src/style.css` at `7cbac7d` |
| 120 px to 0 | the TM rule table's scroll across another view's toggle | a probe test on the prototype before it held scroll positions, not kept: the table's `scrollTop` set to 120 at 1280 × 896, read after the asm toggle's press |
| 147.5, 149.1, 154.0 px | the toggles' width in Paper, Terminal, Instrument | a probe test on the prototype at `b648ec2`, not kept: `#views-shown`'s box at 1280 × 800 in each style |
| 1,258.1; 1,244.0 to 1,274.0; 1,315.1 and 1,342.1 px | what the header needs at 1280 px | the same probe: the widths of the header's drawn children, a column gap after each, and its padding, in each style and preset named in §6.1 |
| 181 px | the header's height at 390 px with the toggles, in Paper and Instrument | the same probe at 390 × 844, taken while the toggles' padding was 0.4em; 136 is `style.css`'s own figure for the header without them |
| 35 | browser test files failing on the prototype before any was changed | `pnpm exec vitest run --project browser` in `web/`, on the prototype's first build |
| 69 and 1,327; 172 and 1,222 | node and browser test files and tests passing on the prototype at `1a0ca47` | `pnpm exec vitest run --project node` and `--project browser` in `web/` |
| 8 of 10 | cases failing at `9e98431`: a box that follows the run, returning by its view's toggle and by its Stage tab | in `web/`: `pnpm exec vitest run --project browser tests/browser/follow-kept.test.ts`, with the file as first written, before `38d9dfa`'s fix |
| 1,227.1 to 1,254.1 px; 46 px and 46 | what Terminal's header needs at 1280 px at half the gap; its height in the markup alone and with the app up | the plan's `zz-probe-header.test.ts` and a probe of the header's height before the mount and after, at `8fcc4e3`, neither kept |
| 46 px to 91; 181 px to 136 | the header's height before `main.ts` has run and after: in Terminal at 1280 px; at 390 px with the toggles in the markup and no media rule | a probe test in the fix round at `6048473`, not kept: the header's box read before the wasm had loaded and again once the page was mounted |

## §16 What changed after the approval at `ba4514b`

### §16.1 The user's decisions, made with the prototype open (2026-10-11)

| Section | Was | Is | In the user's words |
|---|---|---|---|
| §7.3, §7.4 | the cycle keys `n` and `p` | `]` and `[`, answered with `Ctrl` held or not | "ctrl+n opens a new window for me" |
| §4.1, §6, §7.3, §7.4 | toggles in the order source, λ, asm, TM | source, asm, λ, TM, as `HEADER_ORDER` | "the ordering of the toggles on the top bar should be source, asm, lambda, tm" |
| §4.4 | three views as a row of two over the third; four as two rows | columns side by side in a wide window, the same trees on their side in a tall one | "the horizontal bar should not be forced across the whole screen if possible" |
| §11, §1 | no panel resizing | boundaries and maximise, in all four views, as the second pull request | "we need to be able to resize things like rules, state diagram, etc. they can't just be fixed in place" |

### §16.2 What the prototype found

| Section | Was | Is | Found by |
|---|---|---|---|
| §5.1, §4.3 | every live view is kept alive | a switch parks a view; a `✕` closes one | `scratch-buffers.test.ts` and `workspace-restore.test.ts` failing |
| §5.2 | a parked view keeps its scroll positions, unexamined | `pane-host.ts` holds every view's across every rebuild | a probe: 120 px to 0 for a view that stayed on the page |
| §5.5 | the Stage's behaviour is the rule, to be read | two defects, one of them the Stage's own, fixed | a census of the readers, then a test that threw |
| §5.2, §4.7 | a view off the page comes back as a view on the page does | after a reload or a link's undo, a parked view that showed a copy comes back on the program | reading the restore: a binding is restored for a leaf of the stored tree only |
| §5.3 | one state for every reader | the shared surfaces read the tree on screen; what keeps a view true reads every entry | the census |
| §6 | a name and tooltip that do not change | the name is the button's word; the tooltip says what a press does, or why it cannot | `controls-gate.test.ts`'s rule that a name is the label or the tooltip |
| §6.1 | the header's width to be measured | measured; hidden at 40rem and narrower | `inspector-phone.test.ts` and `header-menus-narrow.test.ts` failing |
| §7.2 | three candidate chords and a probe | `Ctrl+.`, with what was and was not measured | the browser tests, and the user's browser |
| §8 | the seed alone | the seed, `fourViews()` spelled out, and `resetToFourViews()` | 35 failing files |

### §16.3 Still the user's to decide

1. **A narrow window's toggles (§6.1):** hidden, as the prototype has them, or moved into the workspace menu.
2. **The toggle keys (§7.3):** answered on 2026-10-12. In the user's own browser `Ctrl+.` then `2`, with `Ctrl` held,
   toggled the asm view and switched no tab.
3. **`+ view` in a layout of columns (§12):** halving the focused view, as today's rule gives, or adding a column.
4. **The keys on another keyboard layout (§7.2, §7.3):** on AZERTY `.` is typed with Shift, and the prefix is refused
   with Shift down; on a Mac's layouts that type `[` and `]` with Option, a table key is refused with Alt down, and so
   it is on Windows where AltGr types them, since AltGr reports `Ctrl` and `Alt` both down. Read from the layouts and
   from how a `keydown` reports its `key`, and not run on any of them. The smallest change takes the prefix with Shift
   down and a table key with Alt down. **Decided on 2026-10-12: left as built. The change is wanted later, and not
   soon.**
5. **An id two trees name as two kinds (§5.4):** as amended, a switch builds the incoming view under a new id and
   keeps both views. The version approved at `fed6e37` rebuilt the view in place, which is what destroyed a parked
   view of a copy. The amendment was made in the review round (§17), and the approved behaviour is one function's
   call away.
6. **A focus the app moves, and the scroll (§4.5):** as built, a pointer's gesture scrolls nothing and a key's shows
   the focused control, so a keyboard user's view goes to its top where a pointer user's stays put. The other choice
   keeps every view where it was and lets a keyboard focus land out of sight until the next key.
7. **Which view takes the focus after a `✕`:** the view before the closed one in the tree's order, as on `main`. For
   the first view of a second column that is the last view of the first column, across the divider, while the view
   under the closed one takes its space.

### §16.4 The user's decisions, made with the pull request open (2026-10-12)

| Section | Question | Decided | In the user's words |
|---|---|---|---|
| §7.3 | whether `Ctrl+.` then `Ctrl+2` switches the browser's tabs | it does not: the asm view toggled and the browser stayed on the page's tab | "yes it works" |
| §8 | a workspace stored with four views is kept, so a returning visitor sees the new first load only after *reset preset* | kept as built | "this is fine" |
| §16.3, point 4 | the keys on a layout that types `.` with Shift, or `[` and `]` with Option or AltGr | left as built; the change is wanted later, and not soon | "this is fine, though mark the fix for azerty later on, but not anytime soon" |
| §6.1 | Terminal's header at 1280 px: two rows where `main`'s is one, and one to two as the page loads | fixed in this pull request | "let's fix this" |
| §11 | panel resizing, the next pull request | not started until this one is merged | "ok we can wait for that" |

## §17 What the reviews found (2026-10-12)

Five reviews, one for each task of the first plan, read the branch at `9e98431` without running it. Each finding that
was acted on was reproduced first, by a test, a probe or a sabotage. This is what they changed in the design; the
roadmap entry has the tests.

| Section | Was | Is | Found by |
|---|---|---|---|
| §5.2 | a scroll position is put back by a write of `scrollTop` | written through `restoreScroll`, so a box that follows the run comes back following; a view's own scroll box is held; a view built again starts at its top | the scroll task's review; then 8 of 10 cases failing at `9e98431`, and none with the restore removed |
| §5.2 | which view shows which copy is stored at a fork, a pause and a delete | stored each time the layout is applied | the model task's review: a copy, a `✕`, the toggle and a reload gave the copy to the new view |
| §5.5 | the off-page teardown held by a throw, for a λ copy | held by counting editors, for λ, TM and asm copies, at a delete and at a pause; a delete's undo prefers a view on screen | the editor task's review: with the line deleted and the assertion on the throw removed, the test passed |
| §5.4, §4.4, §4.5 | the tree on screen wins, and the other arrangement's view is rebuilt | a switch enters such a leaf under a new id, and both views are kept | the model task's review: a parked TM view of a copy destroyed by the asm toggle |
| §5.1 | a view is live where any tree holds its leaf | where one holds it as the kind the view is | fixing the row above: a parked view still counted by the copies menu after `+ view` replaced its arrangement |
| §5.6, §4.5 | one notice for an add and a switch, "close one to add another" | an add's notice counts the views not on screen; a switch has its own; both are true in a custom workspace | the model task's review; a close that made no room, measured |
| §4.7 | a link is made without `arrangements` | and read without them; a leg stopping short is said only where the tree has a view of it | the model task's review, with a link written by hand; `share-open-clamps.test.ts` on the new default |
| §6 | the toggles built by `main.ts`; the last one `disabled` | the page's own markup; the last one `aria-disabled`, keeping the focus; the focused one drawn over its neighbours | the model and view-keys tasks' reviews: four controls moved 147.5 to 154.0 px at load; the focus left on `<body>` |
| §7.3 | a repeat is a press; an open popover is not looked at | a key held down is one press; a view key closes every open popover first | the view-keys task's review: `22` typed into the source; `the tree already has a source leaf` thrown |
| §4.5 | the focused view takes the focus wherever the element that had it is gone | a divider or a Stage tab built again keeps it; no editor formats at a switch's blur | the view-keys task's review |
| §8 | `defaultLayout()`; fixtures that check where they start | a required shape; fixtures that check where they end; nine test files re-aimed | the first-load task's review: two cases that could not fail, a probe that threw, three titles the seed made untrue |

Two more reviews then read the whole branch at `65c6ff9`, one the source against this design and one the tests. The
41 commits that answered the task reviews (`9e98431..cd43836`) had been read by nobody but their authors.

| Section | Was | Is | Found by |
|---|---|---|---|
| §4.5, §5.2 | a view given the focus after a rebuild is scrolled to its first control | a pointer's gesture scrolls nothing, a key's shows the focused control, and an editor is shown by its caret | the source review: the source view at 120 px was at 0 after the `✕` of the view beside it, on the first-load tree, where the tests' seeded tree gave the focus to another view |
| §6 | one view of a kind assumed in a toggle's words | the tooltip and the last toggle's sentence count the views of the kind, from one function | the source review: two TM views, "the TM view is the only one shown" |
| §6.1 | the narrow width written twice | one constant, with the stylesheet's rule and the help page held to it | the tests review: either literal changed alone passed every test |
| §5.6 | the Stage's add also asked the tree on screen | one check, of the live views | the source review: the second check made to throw, and both suites passed |
| §4.5 | a divider's drag ended in a rebuild that left the focus on `<body>`, as on `main` | the focus is given back to what had it, by the pointer's half of the focus rule | the pass on the two default trees; fixed with a real drag and a typed key that lands at the caret |
| §6 | the last toggle's sentence for several views ended *one view stays* | *one kind of view stays* | the source review, with the row above it; the words were chosen in the fix round |
| §14 | item 19 held for a minority of gestures; the generated sequences never near the bound | one helper after each gesture; twelve more sequences, from 60 live views | the tests review: the sequences' most live views was 19, and a `liveLeaves` that let a remembered tree win passed all twelve |
| §2.1 | `resize` took one of two neighbours under the floor to it and the other below nothing | two neighbours that cannot both hold the floor do not move | the generated sequences from 60 live views: a tree the loader refuses, after one drag. It is so on `main` |

A last review read the source those 27 commits changed (`33e42e0..faddece`).

| Section | Was | Is | Found by |
|---|---|---|---|
| §4.5 | the flag that stops a format at a rebuild's blur was set by `switchTo`, for a switch alone | `keepingFocus` sets it, through one dependency, for every rebuild that gives the focus back | the last review: a divider's drag sent one format request and took the caret to the start of the text, in the source editor, a machine copy's and a λ copy's |
| §4.5 | an editor given the focus back by the DOM's `focus()` | by its own, which writes its caret back from its state | the last review: with a frame of 250 ms after the focus, six drags lost the caret |
