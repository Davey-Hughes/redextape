# Plan 7, part 2 — Workspace shell: presets, switches, step controls, readout, copies — design

Part 2 of [Plan 7](2026-09-17-frontend-overhaul-design.md). It builds the frame every view sits in: the
workspace state and its presets, the app header and settings menu, a view's header, one step-control
component and one player, the readout, the copies menu, one notice surface and one live region, and the
umbrella's §4 vocabulary. It answers the question the umbrella's §6 left for this part — how Stage's
tabbed stage sits in the layout tree, and how persisted layouts cross the version change — in §3 and §5.

Code facts below were read at `13db3b7` (#98, part 1's squash merge). §17 gives the command behind each
figure.

## §1 Scope, and the two PRs

One design, two PRs, each with its own plan and roadmap entry. 2a is designed knowing what 2b needs, so
no shape it ships has to change for 2b.

**2a — view chrome and vocabulary.** The app stays Explorer-shaped. In: `workspace.ts` with the whole
version 2 envelope and the version 1 migration, switches held at Explorer's values (§3); the app header,
the settings menu, and a workspace menu holding only the current preset's name and *reset preset* (§6);
a view's header — title-selector, status, `⋯`, `✕` — and the icons Hack lacks (§7); `step-controls.ts`
with `⏸` and the speed setting, and the one player (§8), mounted in each view; the strip (§9); the
copies menu with pause, resume, and delete with undo (§10); `notice.ts`, the live region and the focus
rules (§11); every rename (§12).

**2b — presets and switches.** In: the three presets, the three switches and *custom* in the workspace
menu (§4); the bottom step bar and its target (§8); the inspector (§9); Stage (§5).

**Out, and where it goes:** keymap and format-on-blur in the settings menu, and *format* in the `⋯` menu
(part 3); any redesign of what the λ or TM view draws, including the TM rules panel's sizing (part 4);
share links serialising the workspace (part 6); the accessibility items part 2 does not own (§15).

## §2 What exists

- **The header is six controls in `index.html`**: the appearance button, the `style` and `palette`
  selects part 1 added, `reset layout` (accessible name "restore the default pane layout"), `buffers`,
  and the `encoding` select. `#results` and `#link-status` sit outside `<main>`, below the tiled layout.
- **The layout tree is persisted under `redextape.layout` at `LAYOUT_VERSION = 1`**, validated on
  restore by `parseLayout`, which returns `null` for anything invalid; any version mismatch falls back
  to `defaultLayout()` rather than migrating. Panel open state is not persisted (part 1's roadmap entry
  lists it as open, waiting on this part).
- **Every pane host lives in `pane-host.ts`'s map and outlives the DOM.** `renderLayout` detaches every
  child and re-appends hosts from the map on each commit, so a host can leave the page and come back
  with its pane and editor intact.
- **Focus is tracked per leg.** A `focusin` listener on each host calls `PaneCollection.markActive`, and
  `active(leg)` answers "which λ pane" and "which TM pane" for the link decorations and the status line.
  There is no single focused view.
- **Playback is per leg.** `transport.ts`'s `play` parks a `setInterval` of `PLAY_MS = 120` (about 8
  steps a second) on the `LegState`, walks recorded frames with `hist.forward()`, stops at the recorded
  frontier, and never asks the worker for more. A second click clears the timer; nothing on screen
  changes to say it is playing. For `fact(3)`, 1,319 reductions take about 165 s at that rate and 18,574
  transitions about 39 minutes.
- **`controlStrip`** renders `controls.ts`'s `ControlState` as `↺ ◀ ▶ ⏵`, a step readout, and a
  continue button that is added and removed, never disabled.
- **A pane's chrome** is an `h2` title (`lambda`, `turing machine`, `source`), the `shows` select
  (`paneSelect`, listing `SessionRegistry.pairs()` in two optgroups), the detached badge `[detached]`,
  `✎ fork`, the claim button (an icon since part 1, accessible name *bring the term editor to this
  pane*), and `layoutControls`' two split popovers (`⇥`, `⤓`) and `×` (*close this pane*). The split
  menus are native popovers built on open; their first item is the pane's own pair, labelled `(same)`.
  The source session's pairs are labelled `source` (`λ · source`).
- **Part 1 already closed three rows of the umbrella's §4 table**: the rules table is a panel labelled
  `rules` where `hide δ` was, its reattach button reads `follow current rule`, and the editor's `⌄`/`⌃`
  collapse is the `text` panel.
- **The buffer list** (`buffer-list.ts`) lists each buffer as `scratch N — orphan — asleep` or with a
  pane count and a term line, and offers `retire` and `warm`/`cool`. At most `MAX_WARM_BUFFERS = 11`
  buffers hold a worker. `cool` rebinds every slot naming the buffer to its home session, as `retire`
  does, so **no view ever shows a cold buffer**. Refusals at the cap are written to `#link-status`.
- **`MAX_FORK_RULES = 50_000`** is the size over which the TM fork control is disabled with its reason.

## §3 Workspace state

`workspace.ts` owns everything persisted about the workspace; `layout.ts`'s tree operations are
unchanged and `workspace.ts` wraps them.

```ts
type Switches = { steps: 'view' | 'bar'; views: 'tiles' | 'stage'; readout: 'strip' | 'inspector' }
type Workspace = {
  version: 2
  tree: LayoutNode           // layout.ts's, unchanged
  switches: Switches
  speed: Speed               // one of §8's ladder values; default 8
  focused: LeafId            // any leaf, the source view included
  panels: Record<LeafId, Record<string, boolean>>   // panel name -> open
}
```

- **The preset is derived, never stored.** `presetOf(switches)` returns `'explorer'`, `'debugger'`,
  `'stage'` or `null` for *custom* (§4). A stored preset would be a second copy of the switches that
  could disagree with them.
- **Same key, new version.** The envelope stays under `redextape.layout`. `parseWorkspace` accepts
  version 2 and **migrates version 1**: the stored tree kept, Explorer's switches, speed 8, `focused` the
  first λ or TM leaf in `leaves()` order (the source leaf if there is none), no panel state. The tree
  shape did not change, so nobody's layout resets on upgrade. Any other version, and any invalid
  envelope, returns `null` and the caller uses the default, as today: `defaultLayout()`, Explorer's
  switches, speed 8, `focused` chosen by the migration's rule (on a fresh page, the λ view), no panel
  state.
- **Validation is `parseLayout`'s standard applied to the new fields**: an unknown switch value, a speed
  off the ladder, a `focused` naming no leaf in the tree, or a panel map keyed by a leaf not in the tree
  makes the whole envelope invalid. A `panels` entry for a leaf that has since closed is dropped on
  write, not carried.
- **`focused`** is set by the same `focusin` listener that calls `markActive`, and by selecting a Stage
  tab. It drives the readout (§9) and, when it can step, the bar (§8). `PaneCollection.active(leg)` stays
  as it is: it answers a per-leg question the link decorations still ask.
- **Panel state becomes per view.** `createPanel`'s initial `open` comes from `panels[leaf][name]`, and
  its `onToggle` writes back. In part 2 that is the TM view's `rules` panel, the one panel a view owns.
  The `text` panel's state keeps living on the copy, as it does today (5d-ii-d §4.7), because it
  describes the copy's editor rather than the view it is mounted in.

## §4 Presets and switches (2b)

| Preset | step controls | views | readout |
|---|---|---|---|
| Explorer | in each view | tiles | strip |
| Debugger | one bar | tiles | inspector |
| Stage | one bar | stage | inspector |

- **One tree for all three.** Choosing a preset sets the three switches and leaves the tree alone.
  *Reset preset* restores `defaultLayout()` — source and λ side by side over TM — and the preset's
  switches, and keeps speed and copies. The default tree is the same for every preset; Stage draws it as
  three tabs.
- **Custom.** Any combination matching no row above is *custom*. It persists as it is, and the workspace
  menu names it. *Reset preset* is removed while the workspace is custom, because there is no preset for
  it to restore; choosing a preset is the way back.
- **First load is Explorer.** Part 6 adds the example it opens with.

## §5 Stage (2b)

**Stage is a way of drawing the tile tree, not a node in it.** The `views` switch changes only what
`renderLayout` builds:

- **`tiles`** is today's rendering.
- **`stage`** is a tab strip over `leaves(tree)` in depth-first order, above the host of the `focused`
  leaf alone. Every other host stays in `pane-host.ts`'s map, off the page, exactly as a host between
  two commits is today. Flipping back to `tiles` shows the arrangement the user left.
- **The tab strip** is `role="tablist"`; each tab is `role="tab"` with `aria-selected` and
  `aria-controls` naming the shown host, labelled with the view's title (§7). Arrow keys move between
  tabs with a roving `tabindex`; Enter or Space selects. A tab has no close control of its own: the
  view's header still carries `✕`.
- **Hidden views cost nothing during playback.** `draw()` skips any pane whose host is not connected, and
  selecting a tab calls `draw()` once so the shown view is current.
- **`+ view` adds the pick beside the focused view**, whether the switch is `tiles` or `stage`, so in
  Stage the new tab sits after the focused one and in tiles it sits to its right. It cannot use
  `splitLeaf`, which refuses the source leaf as its subject — and the source view can be the focused
  view, or the only one. `layout.ts` gains `insertBeside(root, id, dir, newId, kind)`: `splitLeaf`
  without that one refusal, keeping the others (at most one source leaf, no duplicate id). `splitLeaf`
  and its refusal stay as they are for the `⋯` split items, which the source view does not offer.
- In Stage the `⋯` menu's split items are **removed** (the umbrella's §4 rule 4: they can never apply
  there); `+ view` remains.

This answers the umbrella's §6 question. A tab-group node was declined because switching between tiles
and tabs would have to convert the tree and keep the tile arrangement somewhere else; a leaf holding a
set of views was declined because it re-keys everything keyed by `LeafId` — the pane collection, editor
custody, focus and panel state — for tabs inside tiles, which nothing asks for.

## §6 The app header and settings menu

`redextape · Explorer · + view · copies 2 ▾ · encoding unary ▾ ··· ◐ dark · ⚙ settings`

The workspace button carries no `▾`, where the sketch above first gave it one and `copies 2 ▾` keeps
its. That is an inconsistency rather than a decision — both buttons open a menu — and it is left for 2b,
which reworks this menu to hold the presets and the switches. Adding one is not only a character: a bare
`▾` reaches the accessible name (the controls gate caught exactly that on `copies`), so it has to go in
an `aria-hidden` span in the markup, the test harness's shell, and both assertions on the button's text.

- **The workspace menu** is named after the current preset, or *custom*. In 2a it holds the preset name
  and *reset preset — restores the default views*. In 2b it lists the three presets as a single choice,
  then the three switches, each a two-way choice with the value in force marked, then *reset preset*.
- **`+ view`** opens the menu a split opens (§7) and adds the pick beside, or after, the focused view
  (§5).
- **`copies N ▾`** is today's `buffers` button renamed; §10.
- **`encoding`** is unchanged.
- **`◐ dark`** is today's appearance button with its state in words beside the glyph, cycling system,
  light, dark as today. Its accessible name is its visible WORD: the `◐` glyph is `aria-hidden`, so the
  button reads `◐ dark` and is named `dark`.
- **`⚙ settings`** holds style, palette and appearance — the two selects part 1 added, moved, and the
  appearance choice as three options. Part 3 adds keymap and format-on-blur.
- All menus are native popovers, built on open, with the first item `autofocus`, as `splitControl`
  already does. Each menu button carries `aria-haspopup`, `aria-controls` and `aria-expanded` from
  construction.

## §7 A view's header

Left to right: **title-selector · status · step controls** (when `steps` is `view`) **· `⋯` · `✕`**.
The umbrella's list puts panel toggles here too; they stay where part 1 built them, as each panel's own
`▸`/`▾` header inside the view's body (`panel.ts`), so a panel's disclosure sits on the region it opens.

- **The title is the selector.** It replaces the `shows` select: a button reading `λ · program ▾`, or
  `TM · copy 2 ▾`, opening a popover of `SessionRegistry.pairs()` in that spelling. When only one pair
  exists it is plain text, never removed. A pick goes through today's `rebind` and, across legs,
  `setLeafKind`, unchanged. The source view's title is `source`, always plain text.
- **Status** carries `copy · not linked` where `[detached]` was. A view never shows a paused copy (§2),
  so "paused" never appears here; it appears in the copies menu and in the notice that pausing raises.
  A TM copy's value line stays where it is, with its own `role="status"`.
- **`⋯`** holds *split right*, *split down*, *✎ edit a copy*, and *move the editor here*:
  - choosing *split right* or *split down* replaces the menu's items with the pair list the split
    popovers show today, the view's own pair first and reading *another view of this* where `(same)` was.
    A split is still two choices, now made inside one menu, and the `⇥` and `⤓` buttons are retired;
  - *✎ edit a copy* is `✎ fork` renamed. A second line says what is copied: *the term at this step* on
    λ, *the whole machine* on TM. Over `MAX_FORK_RULES` it is disabled with that reason stated;
  - *move the editor here* is the claim button, offered exactly when the claim button is today.
  The source view has no `⋯` in part 2: its chrome today offers no split, no copy and no claim, so its
  header is its title and `✕`. In Stage the two split items are removed (§5). Part 3 adds *format*, which
  gives the source view a `⋯` too.
- **`✕`** closes the view, and is removed on the last view, as `×` is today.
- **Icons.** The glyphs Hack lacks that this part's controls still draw — `⏵`, `⏸`, `✎`, `☀` and `☾` —
  come from `icons.ts`, part 1's registry, rather than an OS symbol face; `⤓`, the other one part 1
  listed, goes with the split buttons. Every icon-only button's accessible name is its tooltip (umbrella
  §4, rule 1).

## §8 Step controls and the player

**`step-controls.ts`** is one component that renders `ControlState`:
`↺ ◀ ▶ ⏵  8/s ▾  step 212 of 1,319  [continue]`.

- **`ControlState` gains `playing`**, from `LegView.playing`. While playing, the play button shows `⏸`
  and its accessible name is *pause*; stopped, `⏵` and *play* (umbrella rule 3). The other buttons keep
  today's names: *back to the oldest kept step*, *one step back*, *one step forward*.
- **Speed** is a `<select>` whose options read `1/s 2/s 4/s 8/s 15/s 30/s 60/s 250/s 1,000/s 5,000/s`,
  named *playback speed*. It shows and sets the one global `speed` (§3); every step control on the page
  reflects a change at once.
- **Where it mounts.** With `steps` at `view`, in each λ and TM view's header, in place of today's
  strip. With `steps` at `bar` (2b), once, in a bar along the bottom of the workspace, prefixed with the
  target's title — `λ · program` — so it always says which view it drives.
- **The bar's target (2b)** is `focused` when that view can step (λ or TM), and otherwise the last view
  that could. With no λ or TM view on screen, its buttons are disabled and its readout says *no view can
  step* — it could apply, so it is disabled with its reason rather than removed (umbrella rule 4).
  Closing the target retargets to `focused` if it can step, else the first λ or TM leaf.

**The player.** `transport.ts`'s per-leg `setInterval` becomes one `requestAnimationFrame` loop over
every playing leg.

- Each frame adds `speed × elapsed` to the leg's fractional carry, advances `floor(carry)` steps with
  `hist.forward()`, keeps the remainder, and calls `draw()` once if anything moved. Up to 60/s that is at
  most one step per frame; above it, several — `fact(3)`'s 18,574 transitions take about 3.7 s at
  5,000/s. `elapsed` is clamped to 100 ms, so a tab returning from the background does not jump.
- `leg.timer` becomes `leg.playing`. Play stays per leg — two views of one history move together, as
  they do today — and the speed is global.
- **Semantics unchanged:** play stops at the recorded frontier and never asks the worker for more; `▶`
  at the frontier and *continue* still do that.

## §9 The readout

**`readout.ts`** builds rows for one session, reusing `results.ts`'s builders, and the readout shows the
session of the `focused` view.

| Focused view's session | Rows |
|---|---|
| the program (the source view, or any view bound to the program) | λ rows and TM rows, as `#results` shows today, and the link sentence `#link-status` shows today |
| a λ copy | its λ rows |
| a TM copy | its TM rows, its reduced-file sentence, and its value line |
| none (the program does not compile) | `not compiled — N errors` |

Row wording takes §12's vocabulary: *reductions* and *transitions* for β-steps and δ-steps.

- **The strip** (2a) is one line along the bottom of the workspace, below the views:
  `λ 42 · 1,319 reductions   TM 42 · 18,574 transitions · width 8`, with a stop reason appended where
  one applies and the link sentence at its right end. It leaves out the normal-form text, which the λ
  view already shows; the full text of anything it truncates is in its `title`.
- **The inspector** (2b) is a right-hand column built with `panel.ts`: fixed width, collapsible to its
  header, its open state kept in `panels` under the key `inspector`. Every row on its own line, the
  normal-form text included, in a scrolling region.
- **Neither is a live region.** A change worth announcing goes through §11.
- **`#results` and `#link-status` become the strip's two halves and keep their ids**, inside a
  `footer.strip` below `<main>`. `#results[data-state]` is the program's compile state (`running` /
  `idle`), which browser tests wait on before they act — 24 browser test files select `#results` — and it
  stays that whatever the strip is describing.

## §10 Copies

- **The menu** lists each copy: its name (`λ copy 1`, `TM copy 2`), what it holds (today's term line,
  on a WARM row only — a paused copy has no worker to have produced one),
  how many views show it or *not shown* (today's *orphan*), and *running* or *paused*. Actions: *pause*
  (`cool`), *resume — restarts at step 0* (`warm`), *delete* (`retire`), each with the copy's name in its
  accessible name, as today. The last row is *new TM copy*.
- **Pause** is today's `cool`: the worker stops, and every view showing the copy moves to the program.
  The notice says so: `TM copy 1 paused · 2 views now show the program`.
- **Delete** keeps the menu open, stops the worker, moves every view showing the copy to the program,
  and removes the copy from `redextape.buffers`. The notice reads `λ copy 1 deleted · undo` for 8 s.
  It keeps the menu open because §11's focus rule sends the focus to the next row, else the previous,
  else `copies ▾` — a rule that needs the rows to still be there. (This said "hides the menu first"
  until the whole-branch review; `buffer-list.ts`'s `handleDelete` has always done the other thing,
  and its own doc gives the reason: hiding the list to deal with the focus took the focus with it.)
- **Undo** recreates the copy under the same name with the same text, at step 0, and moves back each view
  the delete moved, if that view still exists and still shows the program. It is created running if
  fewer than `MAX_WARM_BUFFERS` copies are running, otherwise paused, and its notice says which:
  `λ copy 1 restored at step 0`, or `… restored, paused — 11 copies are running`. A newer notice ends the
  older one's undo.
- **Refusals** at the cap — resume, edit a copy, new TM copy — are notices, no longer lines on
  `#link-status`.

## §11 Notices, the live region, and focus

- **`notice.ts`** shows the latest notice as one visible line under the header, with at most one action
  (*undo*), for 8 s or until the next notice replaces it. It writes the same text to **one** visually
  hidden element with `role="status"` — the app's single polite live region. Every notice expires;
  there is none without a timeout.
- **One condition rests on the line rather than passing over it.** *Copies are not being saved* lasts
  until storage works again, so it is the line's **resting state** (`Notices.rest`): said in the live
  region the moment it begins, shown whenever no notice is over it, and back on the line as soon as one
  ends. A write that succeeds clears it. **A notice that never expired was tried first and does not
  work**: a notice is replaced by the next one, and nearly every gesture makes one — a copy created, a
  view closed — so the one lasting condition would have been on screen for about one gesture.
- **A resting condition is said once a page load, however often it is reported.** A write refused by size
  succeeds and fails by turns — a user typing into a copy near the quota gets one every 300 ms — so the
  line follows the condition while the live region says it once. Anything else is the per-keystroke
  chatter the link rule below exists to forbid.
- **A notice can be holding the focus.** *Undo* is a control, offered for eight seconds; when the line is
  redrawn under it — expired, replaced, or activated — focus goes to the new notice's own action if it
  has one, and otherwise to the control that lists the copies.
- **What goes to it:**
  - layout changes: a view added, closed, or switched to show something else; a preset or switch
    changed; *reset preset*;
  - copy changes: created, paused, resumed, deleted, restored, refused;
  - link changes: the readout's link sentence, when a link gesture (a click or `Mod-'` in the source,
    a λ token, a rule row) changes it — announced only, with no visible notice, since the sentence is
    already on screen. Not on every keystroke: a keystroke makes the sentence read *linking resumes when
    this compiles*, and announcing that per key would bury everything else.
  The TM value line keeps its own `role="status"`, because it describes one view's run while it runs.
- **Focus never falls to `<body>`.** When a gesture removes the control holding focus:
  - closing a view moves focus to the title of the view that becomes `focused`;
  - deleting a copy from the menu moves focus to the next row, else the previous, else `copies ▾`;
  - a menu item that closes its menu returns focus to the menu's button, as the popover already does;
  - a control removed by a state change rather than by its own click — *continue* when recording ends,
    the split items when Stage is chosen — moves focus to the nearest remaining control in the same
    header or menu.

## §12 Vocabulary

Every rename in the umbrella's §4 table that part 1 did not already make (§2) lands in 2a. Internal
names — `pane`, `session`, `leg`, `slot`, `binding`, `buffer`, `scratch` in code — stay; what a user
sees or hears changes, wherever it is written. The wording the umbrella's table does not spell out:

| Today | Becomes |
|---|---|
| `λ scratch N`, `TM scratch N` | `λ copy N`, `TM copy N` |
| the source session's label, `source` (`λ · source`) | `program` (`λ · program`); the source VIEW is still titled `source` |
| the `h2` titles `lambda`, `turing machine` | the title-selector (§7) |
| `new TM buffer` | `new TM copy` |
| `orphan`, `1 pane`, `N panes` | `not shown`, `1 view`, `N views` |
| `asleep` | `paused` |
| `close this pane`, `resize panes left and right` / `up and down` | `close this view`, `resize views …` |
| `λ pane detached — not linked to source` and its TM and two-view forms | `λ view shows a copy — not linked to the program`, and the same pattern |
| the restart hint `restart the λ pane to see it` | `restart the λ view to see it` |
| `fork failed — …`, and the cap refusal `all 11 scratch buffers are live; retire or cool one from the buffers list in the header to make room` | notices worded for *edit a copy*: `all 11 copies are running; pause or delete one from the copies menu to make room` (*the copies menu*, not `copies ▾`: a `▾` in a spoken sentence reads as "down-pointing triangle") |
| `the scratchpad failed` (a step readout) | `the copy failed` |
| `buffers are not being saved — …` | `copies are not being saved — …` |
| `shows` | removed; the title is the selector |
| `restore the default pane layout` | *reset preset — restores the default views* |

- **Two of these are written in Rust**, and reach the page through the wasm session's refusals:
  `session.rs`'s `the term at this step is too large to fork` and `a TM buffer builds files up to`.
  They are renamed too — *too large to copy*, *a TM copy builds files up to* — with their Rust tests.
- **Stored copies keep their old names unless something renames them.** Labels are persisted in
  `redextape.buffers`, so a restore rewrites a label that is exactly `λ scratch N` or `TM scratch N` to
  the `copy` spelling, once, and the next write stores it. Nothing else in a stored label is touched.
- **Tests that pin an old label change in the same commit as the label**, updated to the new control
  rather than loosened.
- **A negative assertion passes vacuously after a rename.** `not.toContain('[detached]')` stays green
  when the badge is renamed and also when the rename broke it. Each such assertion is rewritten to
  name the new wording, and paired with a positive check where it stood alone.
- **2a ends with a search for every old label** across `web/src`, `web/index.html`, `web/tests` and
  the wasm crate's user-visible strings, and its roadmap entry records what the search still finds:
  comments and history only.

§17 records the size of the change at `13db3b7`.

## §13 When things fail

- **A stored workspace is invalid or from an unknown version:** the default workspace, silently, as a
  layout is today (the umbrella's §7: a preference, not worth a banner).
- **The bar's target closes:** it retargets (§8); with nothing to step it says so.
- **Undo at the cap:** the copy comes back paused, and the notice says why (§10).
- **A view's session is paused:** the view moves to the program, as today, and the notice names how
  many views moved (`TM copy 1 paused · 2 views now show the program`). A DELETE also moves the views,
  but its notice is `λ copy 1 deleted` plus the undo action and names no count — the undo is what that
  notice is for, and §10 gives its exact wording.
- **A copy's worker throws:** a notice names the copy (`λ copy 1 stopped — …`), its frames are cleared
  and its own readout reads *the copy failed*. **It does not go to the program's readout**, which is
  where the arm wrote before the strip followed focus: a copy's failure stored as the program's result
  replaces a result that is still valid, and then shows only while the program is focused — nowhere at
  all while the copy's own view is on screen.

## §14 Tests

1. **Workspace, node.** Version 1 migrates to version 2 with its tree intact and Explorer's switches; each
   invalid field in §3 makes the envelope `null`; an unknown version is `null`; a closed leaf's panel
   entry is dropped on write.
2. **Presets and `insertBeside`, node.** `presetOf` over all eight switch combinations: three presets,
   five *custom*. `insertBeside` accepts the source leaf as its subject, including when it is the only
   leaf, and still refuses a second source leaf and a duplicate id.
3. **Player, node.** The step arithmetic: at most one step per frame at 60/s and below; at every ladder
   value, over a sequence of unclamped frame intervals, the steps taken total `floor(speed × elapsed)`;
   the 100 ms clamp; and stopping at the frontier.
4. **Readout, node.** Rows for each session kind in §9, in the new vocabulary.
5. **Controls as a class, browser** (umbrella §8.1). Walk every button and select on the page, open every
   menu, and assert each control has an accessible name that is not a bare glyph, that the name carries no
   symbol a reader would have to say aloud, that the name matches its visible label or tooltip, and that
   it is reachable by keyboard. 2a runs it in Explorer; 2b in every preset and in *custom*.
   **The name is computed with `dom-accessibility-api`, not from the element's text.** A gate that reads
   `textContent` for both halves compares a thing with itself: the first one passed a button named
   `◐system` and a menu item named `edit a copythe whole machine`. What it still cannot see is how text
   is joined, so a control whose name depends on that is pinned by its own test instead.
6. **Behaviour, browser.**
   - A title-selector pick changes the view in place, keeping its size and position.
   - A deleted copy comes back through *undo* at step 0, with its views moved back.
   - Pausing a copy moves its views and raises the notice.
   - After closing a view and after deleting a copy, `document.activeElement` is not `<body>`.
   - `⏸` shows while playing and *pause* is its name. The speed select sets the one speed and every step
     control shows it. No browser test asserts a rate: steps per second is wall-clock, and the step
     arithmetic is the node test's (item 3).
   - The live region receives the notice text.
   - Panel state and speed survive a reload; a stored version 1 layout survives the upgrade.
   - (2b) The bar drives the focused view and names it; Stage's tabs work by keyboard and flipping back
     to tiles restores the arrangement; hidden views are not painted during playback.
7. **Every new test is sabotaged once** to show it can go red, and the assertion that fired is recorded.
8. **A visual check by hand** across the presets, in light and dark, recorded in each PR's roadmap entry
   (umbrella §8).

Every existing test stays green; §12 governs the ones that pin labels.

## §15 The accessibility list

The umbrella's §9 assigns items 1, 6, 9, 10, 13 and 14 to part 2, and item 7 to parts 1 and 2.

| Item | In brief | Closed by |
|---|---|---|
| 1 | a control that hides itself strands focus | §11's focus rules |
| 6 | `#link-status` announces nothing | the link sentence moves to the readout and is announced (§9, §11) |
| 7 | link and running-focus states carried by colour | part 1 gave each a shape; part 2 states a link change in words (§11) |
| 9 | layout controls announce nothing | layout notices (§11) |
| 10 | the buffer list announces neither a retirement nor a refusal | copy notices (§10, §11) |
| 13 | temperature carried only in a row's text and its control | pause and resume raise notices (§10) |
| 14 | `cool` changes what other panes show, unannounced | the pause notice names the views it moved (§10) |

Each PR's roadmap entry records which of these it closed and how it checked.

## §16 Decisions made while designing

| Question | Chosen | Declined |
|---|---|---|
| How to ship part 2 | one spec, two PRs (2a, 2b) | one PR; two specs with 2b designed after 2a |
| Stage in the tree | a way of drawing the tile tree | a tab-group node; a leaf holding a set of views |
| Presets | three corners of the switch cube, derived, sharing one tree | Debugger keeping the strip; a tree per preset |
| What the readout describes | the focused view's session | always the program; strip for the program and inspector for focus |
| Speed | one global steps-per-second ladder, 1/s to 5,000/s | frames per second only; a speed per view |
| Header | a workspace menu holding the presets and switches | switches always visible in the header; switches in settings |

## §17 Figures, and what produced them

| Value | What | Produced by |
|---|---|---|
| six | controls in `index.html`'s header | `grep -c '<button\|<select' web/index.html` |
| 1 | `LAYOUT_VERSION` | `grep -n 'LAYOUT_VERSION = ' web/src/layout.ts` |
| 120 | `PLAY_MS` | `grep -n 'const PLAY_MS' web/src/transport.ts` |
| 11 | `MAX_WARM_BUFFERS` | `grep -n 'MAX_WARM_BUFFERS = ' web/src/scratch.ts` |
| 50,000 | `MAX_FORK_RULES` | `grep -n 'MAX_FORK_RULES = ' web/src/protocol.ts` |
| 1,319 and 18,574 | `fact(3)`'s reductions and transitions in the browser | the umbrella's §11 (a dev build at `7d1ee20`) |
| about 165 s, about 39 minutes, about 3.7 s | those counts at 8/s, 8/s and 5,000/s | arithmetic: 1,319 ÷ 8, 18,574 ÷ 8 ÷ 60, 18,574 ÷ 5,000 |
| eight, three, five | switch combinations, presets, *custom* combinations | 2 × 2 × 2, §4's table, the difference |
| 43 lines in 10 files | browser tests selecting a split button by its accessible name, which §7 retires | `grep -rEn 'split left and right\|split top and bottom' web/tests \| wc -l`, and `-l` for files |
| 36 strings; 210 lines in 35 files, 23 of them negative | user-visible strings §12 renames in `web/src` and `index.html`; test lines pinning them (30 browser files, `harness.ts`, 4 node files); assertions that pass vacuously after a rename | a read of `web/` at `13db3b7` by a search agent, each grep hit judged user-visible or not; no single command produces it. Spot-checked against plain greps where one reproduces a count: the split labels above, and `close this pane` in 7 test files || 24 | browser test files that select `#results` | `grep -rl '#results' web/tests/browser \| wc -l` |
