# Machine views' panels row — design

2026-11-21. A follow-up to the CLIF view (#190): the CLIF and rxm views put their values (registers), call stack and
heap on one row when the view is wide enough for three, and a closed panel keeps its width. Lane record:
`~/temp/redextape-panels-row-record/`; the recon (`recon/notes.md`, `recon/geometry.json`) measured `1ac4fc4` in
Chromium with the map-and-fold example, each view beside the source. A prototype of the whole design
(`proto/prototype.patch`, `proto/`, `proto2/`) measured §5.1's and §5.5's numbers and settled the calls §10 lists.

## §1 Intent

Davey, 2026-11-21, trying the CLIF view:

- "when I do the expand button for the listing for CLIR, the 'values' and 'call stack' panels get narrowed when they
  should just keep taking up the full width"; "let's do this as a follow up since it probably applies to other places".
- "maybe by default 'values' 'call stack' and 'heap' could actually fit in the same row"; "this could probably go for
  rxm too".
- Davey asked "is it possible to use 1 or 2 rows depending on how much size the rxm or clir panels get?", and said why
  one row: "one row is just tidier if there's room I think".

The narrowing Davey saw: a maximise draws every other panel closed (view layouts spec §11.3), and a closed panel in the
row shrinks to its header (`style.css:3028-3031`). With the CLIF listing maximised in a 634px view, the closed values
header is 114px wide and the call stack's 200.6px (recon, clif@w1280 max-listing).

Davey approved the controller's playback of §5 ("looks good") and chose approach B of §4.

## §2 Goals, non-goals, anti-goals

**Goals.**

- G1. A closed panel keeps its width. Opening, closing or maximising a panel changes heights only, never a
  neighbour's width, in every arrangement.
- G2. The CLIF and rxm views each choose one of three arrangements (§5.1) from the width their row has.
- G3. The middle arrangement is exactly today's layout: the heap in a region of its own, with its own boundary,
  header handle and stored share.
- G4. Each view switches at its own width, set by a minimum panel width chosen for its content.

**Non-goals.**

- The TM view. Its rules and state diagram are each a region of their own, stacked (`tm-pane.ts:323-346`), and a
  closed one already keeps the view's full width (recon, tm@w1280 and tm@w1024 max-rules). It has no row of panels.
- Any other view. No other row of panels wraps: the only `data-open="false"` layout rule is `style.css:3028`, the
  other (`:1025`) being the λ gutter's glyph (recon §3).
- A setting or a stored value for the arrangement. It is derived from the width and never stored; workspaces and
  share links keep their shape.
- Panels resized sideways (still out, view layouts spec `:40`).

**Anti-goals** — it fails even if it works if:

- Anything shifts the page by itself (Davey, 2026-11-17: nothing may shift the page unexpectedly). A step, a compile
  or a run's end changes neither the arrangement nor a header's height.
- A view flickers between two arrangements at a threshold, or paints its first frame in one arrangement and its next
  in another (a page load, a parked view shown, a Stage tab chosen, a view added).
- The page reports a "ResizeObserver loop" error; the project treats one as a defect
  (`state-diagram-local-scrollbars.test.ts:60-63`, `:101-110`).
- The middle arrangement differs from today's layout at the same width, beyond closed panels keeping their width.

## §3 What exists

- **The row.** `.rxm-machine` is a wrapping flex row (`style.css:3010-3017`), each panel `flex: 1 1 18rem`
  (`:3020-3024`) with a 1rem column gap: two panels sit side by side from 592px of row width, three would need 896px.
  Both views build it with the same class (`rxm-pane.ts:127-129`, `clif-pane.ts:150-152`).
- **A closed panel in the row** is `flex: none` and `align-self: flex-start` (`style.css:3028-3031`): it is its
  header's width and its open neighbour takes the rest.
- **Regions.** `PanelStack` shares a view's height between regions fixed at construction: the listing (two shares),
  `machine`, the row (one), and `heap` (one) (`rxm-pane.ts:149-180`, `clif-pane.ts:159-188`); an rxm copy adds its
  text above and its outline below. Boundaries are drawn only between regions (`panel-stack.ts:195-220`), never inside
  the row (`rxm-pane.ts:145-147`). A header is a handle for the boundary above its region only along the region's top
  edge (`panel-stack.ts:246-250`).
- **A panel cannot change region.** `#regions` is set once (`panel-stack.ts:85`, `:97`); each header's drag is bound
  to the region it was built in (`:253-280`, reading `r` at `:274`); a maximise grows `r.panels.includes(max)`
  (`:192`); `#isOpen` reads `r.panels` (`:140-143`). Drags and gesture hearers cannot be removed (`separator.ts:37-42`,
  `panel.ts:118-120`), so building the stack again would duplicate them.
- **Stored.** `panelSizes`, per view per region name (`workspace.ts:153-157`), accepts any name with a share above 0
  (`workspace.ts:404-419`); open and closed are per panel name (`workspace.ts:61-62`, `panes.ts:43-48`). A maximise is
  not stored (view layouts spec §11.3).
- **Widths.** Beside the source, a 1280px window gives the view 634px and a 1024px one 506px. Today both views show
  values or registers beside the call stack over the heap at 634px, and one panel a line at 506px.
- **Content** (recon, widest in the first 300 steps at 634px): CLIF's values row 72px, call-stack frame 116px, heap
  line 94px; rxm's registers row 65px, frame up to 860px (cut by ellipsis, `style.css:3134-3139`), heap line 231px.

## §4 Approaches

- **A. The heap always in the wrapping row**, the CSS wrap giving 3, 2+1 or 1+1+1. Rejected: a wrapped row is one
  region, so the heap loses its boundary, its handle (`panel-stack.ts:246-250`) and its stored share, and in 2+1 every
  panel sits at its five-line floor (rxm at 634px: a heap about 124px tall against 190px today, recon follow-up §1).
- **B. Code decides one row or two from the width and moves the heap** between its own region and the row. About
  120 to 180 lines, `panel-stack.ts` included (recon follow-up §4). **Chosen**: the middle arrangement is exactly
  today's, and there the heap keeps its boundary, handle and share.
- **Dropped: a CSS grid or container queries** rearranging the regions. `PanelStack`'s boundaries and header handles
  assume regions stacked in one column (`panel-stack.ts:20-28`).

## §5 The decided behaviour

### §5.1 Three arrangements

```
wide      listing                              'listing', 2 shares
          values | call stack | heap           'machine', 1 share

medium    listing                              'listing', 2 shares
          values | call stack                  'machine', 1 share
          heap                                 'heap', 1 share

narrow    listing                              'listing', 2 shares
          values                               'machine', 1 share, two lines
          call stack
          heap                                 'heap', 1 share
```

In the rxm view *registers* stands for *values*. The code decides the arrangement from the view's width and lays each
out explicitly: the heap in the row or in its own region, and in narrow the row as a column (§5.2). With every panel
open, medium and narrow look as they do today. Each panel has a least width: the row is wide where all three fit with
their 1rem gaps, medium where the first two do, and its columns keep those widths' proportions at every width, open or
closed, so nothing moves sideways when a count grows.

| View | Least widths | Columns | wide from | medium | narrow below |
|---|---|---|---|---|---|
| CLIF | 7.375, 14.75, 14.75rem (118, 236, 236px) | 1 : 2 : 2, in medium 1 : 2 | 622px | 370 to 622px | 370px |
| rxm | 18rem each (288px), today's | equal | 896px | 592 to 896px | 592px |

Pixels at a 16px root. Each width is the view's content width, the width the decision reads (§5.4). rxm's numbers
are the controller's, approved by Davey; CLIF's follow Davey's header decision (§5.5), measured.

| Window, view beside the source | CLIF, today → after | rxm, today → after |
|---|---|---|
| 1280px (view 634px) | medium → wide | medium → medium |
| 1024px (view 506px) | narrow → medium | narrow → narrow |

Two consequences. CLIF's medium holds values and call stack side by side down to 370px, where today they wrap
below 592px (as at 506px): the controller's call, in keeping with "tidier if there's room". And in wide the row is one
region beside the listing, so at the built shares the listing takes two thirds of their height where today it takes
half: CLIF at 634px, the listing from about 362px to about 489px and the three panels from 181px to about 244px
(recon follow-up §1, estimated, not measured).

### §5.2 Closed and maximised panels

- The rule at `style.css:3028-3031` goes. A closed panel in the row has the same basis as an open one, so it keeps its
  column's width in every arrangement, and stays its header's height (it is not stretched to the row's). Three closed
  panels read as three bars, each its column.
- A maximise is otherwise as the view layouts spec §11.3 has it: its panel's region takes the spare height and every
  other panel is drawn closed. In wide that region is the row.
- Accepted side effect: a maximised panel in the row keeps its column. In rxm maximised registers are half the row in
  medium (today 417px of 634px, recon) and a third in wide, as is a maximised heap there, which today takes the full
  width; in CLIF maximised values are a third of the row in medium and a fifth in wide, and a maximised heap two fifths.
- **Narrow is a column, not a wrap.** With closed panels keeping their width, a wrapped row would give a closed
  panel's line half the region's height, flex lines sharing a row's height equally. The builder check measured it in
  Chromium (rxm, a 506px row, a 620px region): a closed registers header with a 233px gap under it, and a maximised
  call stack 346px tall where it should be about 579px. So in narrow the row stacks its panels in a column: a closed
  panel is its header's height at the full width, the open ones share the rest, and a maximised one takes it all.

### §5.3 Regions, boundaries and stored shares

- **Wide**: two regions, the listing and the row of three, one boundary between them. The heap has no region of
  its own, and its header, on the row's top edge, is a handle for that boundary as the other two are.
- **Medium and narrow**: today's regions, boundaries and handles.
- **The boundary's name says what the row holds**: today's "resize listing and registers and call stack" in medium
  and narrow (`panel-boundaries.test.ts:140-143`), one naming the heap too in wide.
- **Stored shares keep their names.** `machine` is the row: of three in wide, of two otherwise. `heap` is kept while
  the heap is in the row and applies again when it has its own region. A drag in one arrangement carries into the
  other. A workspace or link written before this change shows the same shares wherever the view is medium or narrow
  now; in wide its `machine` share applies to the row of three.

### §5.4 What switches it

Only the view's width crossing a threshold. The decision reads the view's border box less its padding and border, not
the row's, which only the user changes: the window's size, a divider drag, a view added, closed or moved, the layout
cycle. Content changes no width (bodies scroll inside their floors, `style.css:3037-3042`; frames and heap lines are
cut, `:3134-3139`; headers give way, §5.5), and a classic scroll bar in the view (`style.css:623-625`) narrows the
row, not the width read (§6.3).

### §5.5 Headers

Davey, 2026-11-21: in the CLIF view the values column is narrower and the call stack and heap columns wider, in fixed
proportions that never change with content; a count longer than its column is cut with "…" and shows whole on hover;
CLIF's threshold moves up a little; rxm keeps equal 18rem columns.

A header's one-line width (title, count, buttons, open or closed), the wider of Chromium and Firefox, which agree within
3px, is widest in Terminal for the counts: "2 frames" 204.8px, "1,234 frames" 233.6px, "57 cells · 2 boxes" 232.2px
(Instrument 201.6, 224.6, 204.9), and in Instrument for values, 114.1px; Paper is the narrowest throughout
(`proto2/probe-*.log`). Terminal's fonts are the system's (`style.css:86-88`), so its widths are this machine's; the
tests hold Instrument's, whose fonts are bundled. CLIF's 1 : 2 : 2 at 118px a part leaves 3.8px or more over the widest
style for the values header, "2 frames" and "57 cells · 2 boxes" at its threshold; for "1,234 frames" too at 634px, 12px
above it; for "2 frames" wherever values and call stack share the row; and for values' 72px rows (recon). At 622px and
634px those counts are whole in every style and both browsers; Instrument cuts only the 123,456 counts, Terminal heap
counts from "999 cells · 12 boxes". rxm's 288px columns cut only Terminal's "123,456 cells · 1,234 boxes", below
923px.

A header gives way by its count, then by its title (in Instrument from about 140px, where the prototype's wrapped),
each cut with "…", and never by a button, so it stays one line. A count with less room than two characters and the
ellipsis is not drawn: Chromium draws a line's first character whatever its room and clips the ellipsis, so
"1,234 frames" would read "1". The whole count is its `title`, the app's tooltip (the view toggles', the TM state
name's), set cut or not as the state name's is: a count that fits shows the same words on hover, and no step measures
a header.

## §6 Constraints the build meets, each with a test

1. **First paint.** A view is first drawn in its arrangement: on page load, a parked view shown, a Stage tab chosen,
   a view added or moved.
2. **No ResizeObserver loop error.** The move changes the row's height, which `PanelStack`'s observer watches
   (`panel-stack.ts:107`), so the decision observes the view, a box the move cannot resize. A frame drawn in the old
   arrangement inside a resize the user is making is acceptable; on a first paint it is not (1).
3. **No oscillation.** The decision reads the view's border box less its padding and border (§5.4), which neither
   moving the heap nor a scroll bar inside the view changes, so no threshold needs a margin. Read from the row it
   could switch on its own: the prototype found an rxm copy's value line bringing a 10px bar in at 897px. Near a
   threshold a bar narrows the row instead, each column by its part: at CLIF's threshold a 10px bar takes the heap's
   column to 232px, cutting Terminal's "57 cells · 2 boxes" by 0.2px. Tested in the `browser-scrollbars` project
   (`SCROLLBAR_FILES`, `web/vite.config.ts:114`).
4. **Headers stay one line.** `.panel-header` and `.panel-actions` wrap (`style.css:1599-1601`, `:1649-1651`), and
   the counts grow as a run does ("10 frames", "1,234 cells · 12 boxes", `rxm-view.ts:143-155`). A header that
   wraps as its count grows moves the bodies under it on a step. So a machine panel's header is one line at every
   width, whatever its count, giving way as §5.5 says; the columns are set so the counts a run usually reaches fit.
5. **A maximise across a switch** stays in force, and the region its panel is in now takes the spare height:
   `panel-stack.ts:192` reads the current membership, or a maximised heap in wide grows the region it has left.
6. **Focus across a move.** A control in the heap (its toggle, its maximise button) keeps the focus when the heap
   moves; a DOM remove and insert drops it. `Element.moveBefore`, the DOM's state-preserving move, is in Chrome from
   133 and Firefox from 144 and not in Safari (MDN browser-compat-data, read 2026-11-21). WebKit is unmeasured here
   (view layouts spec `:41`), so a browser without it gets a fallback that moves the heap and puts the focus back.
   That `moveBefore` keeps the focus in Firefox is tested, not assumed. A focused boundary that a switch removes
   (`sync` removes it, `panel-stack.ts:203-207`) hands the focus to the heap's toggle, never to the page's body.
7. **A gesture across a switch.** No switch while `PanelStack` holds a gesture, which already writes nothing and
   draws no boundary then (`panel-stack.ts:149-170`); the arrangement catches up when it ends.
8. **Stored shares both sides.** A drag in wide, then a narrowing to medium: the listing and the row at the dragged
   ratio, the heap at its stored or built share. Widened again, the heap's share is unchanged.
9. **What wide hides stays hidden**: no `display` rule outranks the `hidden` of an element the build hides, such as
   the heap's `.machine-heap` region (`style.css:2984-2985`, `hidden.test.ts`).
10. **Firefox.** Davey tries branches in Firefox; the tests run in Chromium. The changed browser files run in the
    `firefox` project too (`pnpm test:firefox`, `web/package.json:20`), and the branch is tried by hand in Firefox
    before it is handed over: a resize across both thresholds, a maximise, the focus in the heap across a switch.

## §7 Tests

- **Fixtures.** `panel-boundaries.test.ts:45`, `panel-maximise.test.ts:30` and `rxm-pane.test.ts:23` mount rxm views
  1000px wide, above rxm's 896px. They move to 800px, medium, which keeps every existing assertion but those below,
  and one case stays at 1000px for the heap's header as a handle in wide (§10).
- **Changed on purpose**, as they contradict G1: `rxm-pane.test.ts:392` holds the open call stack beside closed
  registers over 0.8 of the row, and `:412-416` each closed panel under 0.3 of it; both now hold its column's width.
- **The CLIF view's files** read only the listing's geometry, not the row's or the heap's (`clif-pane.test.ts:65-69`,
  `clif-layout.test.ts:77`, `:162-167`).
- **New**, for both views: the switch both ways at each threshold, one pixel either side; first paint in each
  arrangement (§6.1); no loop error over a resize sweep, listened for as
  `state-diagram-local-scrollbars.test.ts:101-110` does; a run stepped through lengthening counts changes no header's
  height; closed panels keep their column in all three arrangements, and in narrow leave no gap under their header, a
  maximised panel taking the spare height; the heap's header as a handle in wide; the boundary's name in each; §6.5 to
  §6.8; §6.3 in `browser-scrollbars`; each column at its part; §5.5's counts whole at CLIF's thresholds, at 634px and at
  rxm's; the tooltip; the give-way order.

## §8 Docs and comments

- **Dated specs stay as written**: the view layouts spec's §2.11 (`:129-132`), §11.1 (`:770`, `:789-790`), §11.2
  (`:826`), §11.3 (`:839`) and its "Out" item at `:40`, and the asm spec's §6.1
  (`2026-09-27-plan7-part5-asm-design.md:628-630`). This doc supersedes them for the machine views' row. The CLIF
  spec's §4 already drew one row (`2026-11-18-clif-view-design.md:129`).
- **Comments that would turn false are rewritten with the code**: `style.css:2962-2968`, `:3025-3027` (with its rule),
  `rxm-pane.ts:125-126`, `:145-147`, `clif-pane.ts:148-149`, `panel-stack.ts:51`, `:104-106`.
- **No user-facing doc needs a line.** `help.html:155-159` says a boundary between two panels is dragged by the lower
  panel's header, which stays true in every arrangement; `help.html:43` and `README.md:51` are about the TM's tapes;
  `about.html`, `docs/architecture.md` and `docs/development.md` describe no panel.

## §9 Left to the builder

- One source per view for its least widths (§5.1), from which the code derives both thresholds and the stylesheet
  the columns' proportions (the prototype sets each panel's `--column` from them), so the decision and the layout
  cannot drift; CSS that lays out each arrangement without wrapping.
- `PanelStack`'s API for a panel that changes region. The recon's workable shape: the stack tracks each panel's region
  now; the heap's region becomes a wrapper hidden in wide, so the existing observer's `sync` drops the machine|heap
  boundary (`panel-stack.ts:100-109`, `:203-207`). The row's `bodies` and its boundary's name follow the arrangement.
- Where the decision lives (one place for both views) and the deferral, within §6.1 to §6.3. The prototype is one way
  to build all of this; the plan may take it or change it.

## §10 Designer's calls

Davey approved the three arrangements, rxm's widths, closed panels keeping their width, the maximise side effect
and approach B, and chose §5.5's header rule. These are the designer's, open to Davey's correction:

- A maximised heap in wide keeps its column, a third of the row in rxm and two fifths in CLIF, the approved side
  effect followed through (§5.2).
- No switch during a gesture; the arrangement catches up at its end (§6.7).
- A frame of the old arrangement inside a user's resize is acceptable; on a first paint it is not (§6.2).
- A focused boundary that a switch removes hands the focus to the heap's toggle, the panel that moved (§6.6).
- The dated specs are left as written, this doc superseding them (§8).
- Narrow is laid out by the code as a column, not by the row's wrap, so a closed panel leaves no gap and a maximised
  one takes the spare height (§5.2; the builder check's finding).
- No scroll bar margin: the decision reads a width no bar changes (§6.3).
- Test fixtures at 800px, medium, and one 1000px case for the heap's header as a handle in wide; `rxm-pane.test.ts:392`
  and `:412-416` change, as they contradict G1 (§7).
- The heap's region is a `.machine-heap` wrapper, `hidden` in wide, which `PanelStack` reads as closed (§9); in wide
  the boundary above the row is "resize listing and registers, call stack and heap" ("values" in CLIF).
- Without `moveBefore`, the fallback shows the heap's region before moving the heap back, so the focus it gives back
  lands on a shown element (§6.6).
- A test goes on after a `ResizeObserver` callback in a `setTimeout`: a loop error a test causes is the test's.
- A title gives way after the count and the buttons never; a count is hidden in less room than a character and its
  ellipsis; its tooltip is set cut or not (§5.5).

## §11 As built

The plan is `docs/superpowers/plans/2026-11-21-machine-panels-row.md` (`72399a4`, with its pre-flight scan's edits in
`d583e9f`), and the build is the 11 commits `d583e9f..30cb2e9`, which follow this doc's three and the plan's two on
`2cc48da`, and the branch review's fixes are the 5 commits `8e40675..c6e03ee`. The roadmap's entry for the branch
`panels-row` gives the build's figures, its sabotages and what it did not close. Where the build differs from the
sections above:

- **§2, G3 and the last anti-goal, for CLIF.** The middle arrangement is today's layout in the rxm view alone, beyond
  closed panels keeping their column. CLIF's is §5.1's: values and call stack in columns of 1 : 2 where today's are
  equal, and side by side down to 370px (362px since `48c3702`, below) where today they wrap below 592px.
- **§5.3, an rxm copy's regions.** Each region begins right under the boundary above it, across what draws nothing
  between them (`8bea67c`): the outline under the boundary that parts it from the row in wide, past the heap's hidden
  region, and the listing under the boundary that parts it from the copy's text while the value line between them is
  empty, where the base drew it 8px lower. A value line with text keeps its margin, so at each build of the copy,
  which empties the value line and fills it again, the listing moves by the line's height and 16px, where at the base
  it moved by the line's height and 8px (read from the style sheet, not measured). Kept so; open for Davey.
- **§5.5 and §10, a count's least room.** A count is not drawn in a box narrower than `3ch` (`style.css`'s
  `@container (width < 3ch)`), §5.5's two characters and the ellipsis; §10's last call says a character and its
  ellipsis.
- **§5.5 and §6.4, at a phone's width.** Where Explorer gives a view 154px (a 320px window) the call stack's
  count is not drawn, whatever it says, and at 189px (a 390px window) it is cut with "…"; before this build those
  headers wrapped and showed each count whole. The `title` holds the whole count, and a touch screen has no hover to
  read it by. Open for Davey.
- **§6.1, a view with no width.** A view off the page, parked or on a Stage tab not shown measures 0 wide and keeps the
  arrangement it had, and takes the one its width gives in the first frame it has a width. `MachineRow.follow` decides
  at once with no `isConnected` test, and reads the root's font size and the row's gap with no fallback value.
- **§6.6, the fallback.** `moveInto` appends where a browser has `moveBefore` and refuses the move, as both browsers do
  by throwing for a parent off the page, as well as where it has none; it asks no element whether it is connected.
- **§6.7, a gesture whose handle left the page.** While a switch waits, each further change of the view's width asks the
  `PanelStack` to `sync`, which ends a gesture whose boundary left the page with no commit (Firefox sends a removed
  boundary no `blur`), and the switch is then made from the width the view has (`3c382b7`). One wait at a time still.
- **§9, a switch that moves no heap**, medium to narrow and back, called `PanelStack.sync()` in this build, so that
  which headers are handles was read again: the stack's own observer read them again only where the row's box changed
  too. Since `4a8bd6d` every switch moves the call stack or the heap and calls `PanelStack.place` for it, and that
  observer is gone (below).
- **§7, the cases in a view wide enough for one row** are two in `panel-boundaries.test.ts`, where §7 says one: the
  heap's header in the row drags the boundary above the row, and a double click on it puts the listing and the row back.
- **§7, the CLIF view's files.** `clif-switch-frames.test.ts` runs in a 1280px window, where the CLIF view beside the
  source is now wide, and changed: its two cases that press on a listing whose recording then stops name each frame by
  its listing (`3d44b2d`), and its case of a listing switch from a link holds every step line written from the press to
  the swap (`173ebcd`). The plan's lists of files to run, `AFFECTED` and `AFFECTED-FF`, do not name it; it ran with both
  from Task 4's fixes on.
- **§7, the loop listener.** Every new browser file calls `hearLoops(teardown)` in `web/tests/browser/harness.ts`, not a
  listener of its own: it fails a case for any error the page reports, not for loop errors alone, waits two frames
  before the file's teardown and checks after it. `hear-loops.test.ts` holds it with cases that must fail.
- **§7 and §6.4, `tm-view-narrow.test.ts`**, which asks every header box in Explorer to hide no text, exempts a machine
  panel's count from its scroll-width check at a phone's width alone, and asks there for the count's `title` equal to
  its text instead; at 1280px each count is whole.
- **§6.10, by hand.** The pass in Firefox was driven by a script, Playwright's Firefox 157.0 with the mouse and the
  window's size on the built app (`~/temp/redextape-panels-row-record/impl/hand/drive.mjs`), not by a person. It found
  the loss `30cb2e9` closes.
- **Outside this design, `web/src/main.ts`** (`173ebcd`): `chooseClifListing` posts the listing's request, whose answer
  draws, before it forgets the link's CLIF position. It forgot first, so that draw wrote the step line without the link
  step, a row shorter, and the listing's scroll for the taller box, and the next draw wrote both back; Firefox did not
  bring the scroll back to the same fraction of a pixel, and in the CLIF view's wide arrangement at 1280px the rows
  stood 0.67px lower for the frame before the swap. A bug of the base that the wide arrangement made visible.
- **Outside this design, `web/src/virtual-grid.ts`** (`30cb2e9`): its resize observer hands `Follow` no scroll position
  while the box has no height. In Firefox the CLIF and rxm listings stopped following the run when a panel of the wide
  row was maximised and put back: the hidden box's 0 was kept as the scroll to expect, and Firefox's scroll putting the
  position back read as a person's. The base lost following the same way through the listing's own toggle, which the
  same line closes; `lambda-body.ts` was probed and does not lose it.
- **Outside this design's text, a host outlives its views.** `pane-host.ts` keeps each view's host for the session and
  builds every new view into it, and a view has no teardown, so `MachineRow.follow` keeps one observer per host and lets
  the host go itself (`4e28ddf`): at once when the next machine view built into the host follows it, and at the host's
  next change of size where another kind of view was built there. Until then one replaced row per host at most is
  kept.
- **The plan's text drifted in two places.** Its Task 1 case for a gesture whose boundary has left the page stops the
  boundary's `blur` before removing it, since the tests' Chromium blurs a boundary still on the page and commits the
  gesture there; and the rxm copy case stayed in Task 5's `machine-row.test.ts`, where the plan let it move to Task 6.

The changes after Davey's try are designed in
`docs/superpowers/specs/2026-11-22-machine-panels-row-after-the-try-design.md` (`5eed000`), planned in
`docs/superpowers/plans/2026-11-22-machine-panels-row-after-the-try.md` (`2843713`, with a ruling in `e223cb5` and its
pre-flight scan's findings in `af779e2`) and built in the 4 commits `af779e2..4a8bd6d`, with the review's fixes in the 7
commits `a9b75ad..a01463c` and a floor of two rows in `05eaa28`. The roadmap's entry gives their figures and sabotages
too. Where they leave the sections above:

- **§5.1, the gap and the thresholds.** The row's panels stand `var(--space-2)`, 8px, apart, where they stood `1rem`
  (`48c3702`), so at a 16px root rxm is wide from 880px and medium from 584px, and CLIF wide from 606px and medium from
  362px. The table of the app's views holds as it is: in a 1280px window, 634px inside, CLIF is wide and rxm medium; in
  a 1024px one, 506px, CLIF medium and rxm narrow.
- **§5.2 and §5.3, narrow.** Narrow has four regions, the listing, the values (registers in rxm), the call stack and the
  heap, with a boundary between each two (`4a8bd6d`). The call stack has a region of its own, `.machine-stack`, shown in
  narrow alone, and its panel moves between it and the row as the heap's does, the call stack before the heap. That
  region is a part of the row's (`StackRegion.partOf`, `5be4e10`): `machine` stays the values' and the call stack's
  share together in every arrangement, and `stack` stores the call stack's part of it, read as an even split where none
  is stored or the stored one is not between 0 and 1, so a switch stores nothing. Either of the two open alone takes
  their whole share. The boundary between them is named "resize values and call stack" in CLIF and "resize registers and
  call stack" in rxm, and the call stack's header is its handle.
- **§5.3, a reset beside the two.** Enter or a double click on the boundary between the values and the call stack
  deletes `stack` alone: the split goes back to even, and the listing and the heap keep their heights. On a boundary
  between one of the two and a region outside them it deletes the outside region's share and `machine`, never `stack`
  (the ruling on the pre-flight scan's F4).
- **§6.1 and §6.2, the row built in narrow.** The constructor builds each panel in its own region, since `PanelStack`
  reads a panel as drawn in the region it is built in, and `follow` makes the first switch before the first frame. The
  row is never a column: in narrow it holds the values alone. Its column rules, its `row-gap`, and `PanelStack`'s
  observer of a region built with more than one panel and its top-edge check served that column alone, and are gone.
- **§6.1, the first switch's values.** `PanelStack.place` has each drawn boundary say its value again (`4a8bd6d`): a
  view built on the page in medium or wide, switched at once from narrow, said narrow's values until a boundary was
  focused, as under the first build a view built in wide said medium's, the row then built in medium.
- **§6.6, focus across a switch.** A focused boundary that a switch takes off the page hands the focus to the call
  stack's toggle where the boundary was above the call stack's region, the values open or closed, and to the heap's
  toggle otherwise. So a switch into narrow, which takes the boundary above the heap away, gives it to the heap's
  toggle, though the call stack is the panel that moved: the plan's rule, which a `machine-row` case holds into narrow
  and out of it (`3f23e8b`).
- **§5.5, a count centred.** A header's count is centred top to bottom on its maximise button by `align-self: center`
  and `line-height: normal` on the base `.panel-note` rule (`2634fab`): centred alone, a line taller than its text split
  the spare height into whole pixels in Chromium, and the text sat half a pixel high. The count's box is now its text's
  height, 15px in Instrument, where it was the actions', so the `title` that holds a cut count whole answers over that
  height alone.
- **§7, the cases for the new boundary** mount their view 1600px tall, where every region clears its floor, and those
  for the floor of two rows 900px tall (`05eaa28`), where a floor of five would hold the boundary still. The case that
  gives the row the two's height in medium shortens its host there: the CLIF view's own header wraps where the view is
  322px wide, so the regions have less room in narrow than in medium.
- **A floor of two rows in narrow.** In a window 896px tall the values and the call stack each sat on their floor of
  five rows in narrow, 123px, so the new boundary moved neither (the pass by hand at `4a8bd6d`). Davey chose a floor of
  two rows for those two bodies in narrow alone (2026-11-22, the after-the-try design's G1, `05eaa28`). In that window
  the boundary now moves, but not far: 5.6px from one floor to the other in CLIF and 6.7px in rxm (the pass by hand at
  `ba09cb8`).
- **§6.10, by hand.** The pass in Firefox was driven by a script again, Playwright's Firefox 157.0 with the mouse and
  the keys on the built app (`~/temp/redextape-panels-row-record/impl2/hand/drive.mjs`), not by a person.
