# A panel's title drags its boundary — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A press on a panel's title, its open-and-close toggle, that moves more than 4px in any direction drags the
boundary above the panel as a press on the header's empty part does, by the vertical part of its movement, and one that
moves less stays the title's click, in every panel header that is a handle (the design's G1-G3).

**Architecture:** `pointerDrag` (`separator.ts`), the pointer half of every handle, learns a press that becomes its
gesture only once the pointer has moved past `DRAG_THRESHOLD` on either axis: until then the press is the element's own,
neither prevented nor captured, so a click stays a click. `PanelStack`'s header filter answers that for the panel's own
toggle and for no other control, and `style.css` gives the title the open hand where its header is a handle. Where the
click a drag's release makes lands, and whether a drag from a button leaves a selection, is measured in both engines in
Task 1 before anything is built for either.

**Tech Stack:** TypeScript, Vite, Vitest 4 (browser on Playwright, Chromium and Firefox), Biome. No Rust changes.

**Spec:** `docs/superpowers/specs/2026-11-22-panel-title-drag-design.md` (all of it; *the design*). The plan executed
before this one on the branch, `docs/superpowers/plans/2026-11-22-machine-panels-row-after-the-try.md`, gives this one
its notation; its tasks are done.

## Execution notes

- **Paths.** `W=/home/davey/temp/redextape-panels-row` (branch `panels-row`, plan written at `0283d85`, not pushed);
  `R=/home/davey/temp/redextape-panels-row-record`; `L=$R/impl3` (every log, probe, sabotage driver and saved copy,
  commit message file and report; never the worktree); `T=/home/davey/.cache/redextape-panels-row-target` (`export
  CARGO_TARGET_DIR=$T` in every shell that runs cargo, wasm-pack, `pnpm run typecheck` or `git commit`).
- **The worktree.** `web/node_modules` is a copy, not a symlink, and stays one. `pkg/`, `pkg-lsp/`, `pkg-clif/` and
  `web/bindings/` are built and no Rust changes; a task rebuilds one only if it is missing or a symlink.
- **The dev server on port 5173 serves `$W`.** The controller stopped it for this plan (ledger, 11:44 UTC), since the
  sabotages edit `$W`, and restarts it after Task 4. No task starts one.
- **One committing agent in `$W` at a time** (the pre-commit hook runs over the whole tree). Implementers do not push
  and open no pull request: Davey gives that word, after Task 4.
- **Line references are at `0283d85`.** Once an earlier step has edited a file, find the place by name.

## Global Constraints

- **The design, verbatim.** G1: "A pointer press on a panel's toggle that moves more than a few pixels before it is
  released drags the boundary above the panel, as a press on the header's empty space does; the toggle's click is then
  not acted on." G2: "A press on the toggle released without that movement is a click, as today: the panel opens or
  closes." G3: "The open hand (`grab`, `grabbing` while dragging) shows over the toggle wherever a press there would
  drag." And: "In every panel header that is a handle, in every view, not only the CLIF and rxm views'."
- **Its non-goals and anti-goal, verbatim.** "The header's other controls (maximise, choices, links) stay their own: a
  press on them never drags." "A double click on the toggle stays two clicks of the toggle (open, close); the reset by
  double click stays the header's empty space's and the boundary's." "The keyboard and touch are unchanged: a finger's
  press on a header is left alone (a header is what a narrow view offers to scroll by), and the toggle keeps its focus
  and Enter/Space." "**Anti-goal: a click that opens or closes a panel never moves a boundary**, and a drag never opens
  or closes one."
- **What the design left to the builder, settled here.** The threshold is `DRAG_THRESHOLD = 4` CSS px, exported from
  `separator.ts`, measured from the point of the press on either axis, the same in every direction: a press becomes a
  drag once the pointer is more than 4px from where it was pressed, across the axis or along it (the larger of the two
  distances), and its frames move the boundary by the part along the axis alone, so a press that armed sideways moves
  nothing and commits nothing, as a press on the bar does. Either axis, because of the design's anti-goal, a drag never
  opens or closes a panel: read along the axis alone, a press slid sideways along the title would never arm, and where
  it was let go would decide whether it toggles the panel (slid 44px along the heap's title and released on it, the heap
  closes; slid onto the bar, nothing: `$L/preflight.md`, F7), which a press on the bar never does. The toggle is the
  panel's own `p.toggle` (`Panel.toggle`, `panel.ts:35`), which `#handle` is given: never any button in the header.
- **Commands** (notation used below). Each run writes `>| $L/<task>-<what>.log 2>&1` and is followed by `print $?`; the
  tallies are read from the log with `grep -aE 'Test Files|Tests |FAIL|×'`. zsh has `noclobber`, hence `>|`. Never pipe
  a run through `tail`: it hides the exit status. All from `$W/web` unless said.
  - `BROWSER files…`: `flock /home/davey/temp/redextape-browser.lock zsh -c 'until ! ss -ltn | grep -q ":63315 "; do
    sleep 5; done; VITEST_MAX_WORKERS=4 pnpm exec vitest run --project browser "$@"' _ <paths>`: the wait for port 63315
    (another project's vitest uses it) runs inside the lock. Paths are positional (`tests/browser/x.test.ts`); `pnpm
    test:browser -- name` does not scope, and `--maxWorkers` does not reach the browser projects.
  - `FIREFOX files…`: the same with `REDEXTAPE_FIREFOX=1` and `--project firefox --project firefox-capture`.
  - `TSC`: `CARGO_TARGET_DIR=$T pnpm run typecheck`. `LINT`: `pnpm exec biome ci --error-on-warnings`. `COMMENTS`: `node
    scripts/check-comments.mjs` from `$W`.
- **`AFFECTED`**, run before every commit: `BROWSER` on `panel-boundaries`, `panel-regions`, `panel`, `panel-maximise`,
  `panel-sizes-stored`, `panel-sizes-restore`, `panel-sizes-restore-lambda`, `stored-panels-restore`,
  `panel-stack-place`, `machine-row`, `machine-panel-headers`, `pane-chrome-text-panel`, `tm-view-narrow`, `term-map`,
  `rxm-pane`, `clif-pane`, `edge-spacing`, `hear-loops`, `focus-press`, `link-clear`, `view-keys`, `divider-drag`,
  `divider-drag-focus`, `divider-drag-format-on-blur`, `default-views-gestures`, `layout-view` (each
  `tests/browser/<name>.test.ts`): the files nearest the change, among them those that hold `#handle` and those that
  drag a layout divider, the other user of `separator.ts` (`layout-view.ts:243`). Other files click a panel's title (`rg
  -l "panelToggle\(|\.panel-toggle" tests/browser` lists 39 test files); a click that does not move is unchanged by this
  plan, and Task 2 runs every file. **`AFFECTED-FF`**: `FIREFOX` on `panel-boundaries`, `panel-regions`,
  `panel-sizes-stored`, `link-clear`, `view-keys`, `default-views-gestures`, `divider-drag-focus`,
  `divider-drag-format-on-blur` (each on `CAPTURE_FILES`, `web/vite.config.ts:93-106`, so each runs in
  `firefox-capture`), `panel`, `panel-maximise`, `divider-drag`, `layout-view`, `focus-press`. **Chromium is the gate;
  Firefox is compared against Task 1's baseline**, which the last run predicts as the 3 `panel-boundaries` cases under
  *a drag of a boundary* that make their own pointer events (`$R/impl2/08b-firefox.log`).
- **Test first.** A task writes its cases, runs them to see them fail for the reason it names, then builds. A case that
  cannot fail first is proven by its sabotage instead, and the report says which.
- **Sabotage.** Save a copy (`cp <file> $L/sab/<id>.orig`), make the one edit named, run the named files into
  `$L/<task>-sab-<id>.log`, copy the file back, `cmp` it. **Never `git checkout`**. One driver script a task, kept in
  `$L` (`$R/impl2/08-sab-driver.mjs` is the model), one browser run a sabotage, in Chromium unless its line names
  Firefox. Each names the cases that must fail; **a sabotage that does not fire is a finding: stop and report**. A case
  stops at its first failed assertion, so a case named for two sabotages must fail under each alone, and the log is read
  for the assertion it failed at.
- **Commits.** One per task: `cd $W && export CARGO_TARGET_DIR=$T && git add <the task's files> && git commit -F
  $L/<task>-commit-msg.txt`. The hook runs nine tree-wide scans, the comment guard and the licences check among them,
  and `biome ci` and `pnpm run typecheck` when `web/` files are staged. Never `--no-verify`, never `--amend`. The
  message is one long plain sentence saying what the commit holds, as `git log --oneline -5` shows. If the comment guard
  reports a budget, cut the comment to its why first; only if it is still over, write the value it prints into
  `scripts/comment-budget.json` in that commit and say so.
- **Copy and code.** "redextape" is lowercase in prose; spelling is British; no attribution to a person or a tool
  anywhere in the tree. Doc comments are `/** */`. **A comment says why**: the reason, the invariant, what breaks if it
  changes. No history, no measurement, no `file:line`; a comment may point at the design. Wrapped at 120 columns.
- **Browser tests.** Real input only: a press, drag or double click is `userEvent` (the harness's `drag`, the driver's
  one-move drag at a handle's centre, `harness.ts:1470-1477`; `userEvent.dragAndDrop`, `.dblClick`, `.click`,
  `.keyboard`) or, for a press held across assertions, `commands.mouse` (Playwright's own mouse,
  `vite.config.ts:190-200`) placed by `pageCentreOf` (`harness.ts:229-234`), a move of k frame px being k times the
  frame's scale in page px. Never `.click()`, and no new case makes its own `PointerEvent`. A claim about what a person
  sees asserts geometry or computed style, never `textContent`; an attribute (`aria-expanded`, `aria-pressed`,
  `data-dragging`) may be asserted. A probe prints with `console.error` and is gone before the commit.
- **Settled, not to be reopened.** The threshold, its measure on either axis and the toggle's identity (above). A press
  on the bar's empty part is armed at the press as today, prevented and captured; only the title waits for the movement.
  A double click resets only where the filter answers `true` for it. The filter's touch test stays before its title
  test, so a finger on the title is left alone as on the bar. Every other control keeps `false`. `Panel` (`panel.ts`),
  `separatorGesture`'s keys and the boundaries' own presses do not change. The source view has no header that is a
  handle (its outline is its first region and its editor has no header, `main.ts:3007-3023`), so it has no case.

## Review Focus

Inputs the design implies and its text does not test, most likely first. Each has its case in Task 1.

1. **A drag from the title released over the title.** The header follows the boundary, so at the release the pointer is
   over the title again: whatever click the release makes must not close the panel. C3.
2. **One pointer move that leaves the header before the threshold is heard.** The driver's drag is one move; a pending
   press that listens for moves on the header alone never hears a move of 60px, which lands on the panel above. C3, by
   S4.
3. **A click or Enter on the title after a drag that ended away from it**: the title's, as before the drag; nothing a
   drag leaves behind eats it. C7, where a swallow is built.
4. **A double click on the title of a view whose shares are stored**: two clicks, the shares and heights as stored, no
   reset. C6.
5. **A finger on the title**: left alone, as on the bar. C8.
6. **A press on the title slid sideways and released on it**: a drag that moves nothing, not a click; the panel stays
   open. C4b, by S17.
7. **A press on the title whose release lands off its header with no move** (the header moved away under it): nothing is
   left pending, so a later move with no button pressed drags nothing. C9, by S16.

## Verified facts (at `0283d85`, read while writing this plan)

- **The drag machinery.** `pointerDrag(el, axis, handlers, accept)` (`separator.ts:38-112`) is every handle's pointer
  half: the layout's dividers through `separatorGesture` (`:114`; `layout-view.ts:243`) with the default `accept`, and a
  panel's header through `PanelStack.#handle` (`panel-stack.ts:357-385`). At an accepted `pointerdown` (`:50-71`) it
  sets `data-dragging`, adds the document's `pointerup` and `pointercancel` listeners, calls `preventDefault` and takes
  the capture; `pointermove` (`:73-89`) is heard on `el` alone and calls `drag(now - last)`; `stop` (`:93-104`) commits
  if anything moved; `dblclick` (`:106-111`) calls `reset` where `accept(e)` is truthy.
- **The filter** (`panel-stack.ts:375-384`): `false` for a button other than the first and for a touch; `false` where
  `e.target.closest('button, select, input, a')` is not null (`:377`); then the region `p` is drawn in,
  `header.dataset.resizes === 'true'` and `#above(r)`, and `pair` is set. `#alive` (`:263-266`) reads `data-dragging`,
  or the focus a key gave the handle, to know a gesture is still being made.
- **The title.** `createPanel` builds `toggle` (`panel.ts:56-63`), a `button.panel-toggle` holding the chevron and
  `span.panel-name`, which opens or closes the panel on its `click` (`:92-98`). The maximise button is a
  `button.panel-maximise` with `aria-pressed` among the actions (`panel-stack.ts:596`).
- **The cursor.** `.panel-toggle` sets `cursor: pointer` (`style.css:1608-1621`), so the title does not inherit
  `.panel-header[data-resizes]`'s `grab` or `[data-dragging]`'s `grabbing` (`:1683-1689`); `.panel-actions button` sets
  `pointer` (`:612-620`); `.machine-panel > .panel-header > .panel-toggle` (`:3093-3097`) sets no cursor.
- **The views whose headers are handles** (`rg -n 'new PanelStack' web/src`): rxm and CLIF (each panel below the
  listing); TM (`tm-pane.ts:323-345`: the rules' header where a copy's text is above it, the diagram's, the outline's);
  λ (`lambda-pane.ts:343-364`: the map's, under the term). The source view's two regions give no header a boundary above
  it.
- **The cases that hold today's title, and change.** In `panel-boundaries.test.ts`: *says so with the pointer where a
  boundary lies above it, and nowhere else* (`:492-506`) holds each handle header's title at `pointer`; *leaves a press
  on one of its controls to the control* (`:546-563`) holds that a real drag begun on the title moves nothing; *leaves a
  finger’s press alone, which the boundary itself takes* (`:565-589`) holds the bar and the boundary.
- **The test files.** `panel-boundaries.test.ts` builds an rxm view directly (`mount`, `:40-55`: 800px wide, medium,
  three regions, `sizes` and `panel` mocks) and imports `VIEWS`, `loadViews` and `mount as mountView`
  (`machine-views.ts`), `drag`, `pageCentreOf`, `panelToggle`, `region`, `boundary` and `frame`; its `beforeAll` sets a
  1280 by 1000 viewport; its `finger` (`:91`) is a real touch through CDP. `panel-regions.test.ts` builds a TM view with
  a copy's text (`:93-101`: regions text, rules, diagram) and a λ view with its map (`:206-217`), each with a `sizes`
  mock. Both are on `CAPTURE_FILES`.
- **User docs.** `web/help.html:157-158`, "With a pointer, drag the lower panel's header, and double-click it to put
  them back", stays true: the title is part of the header that drags.
- **Measured by the pre-flight's probe** (Chromium, today's code, `$L/probe/probe.log`; `$L/preflight.md`). In the
  file's `mount()` the heap's title is at top 694.8 (centre 707.8) of a 900px host in a 1000px window, and a close moves
  it to top 870.5, so a double click's second click lands on the registers' body; in a 1000px view (the heap in the row)
  a close leaves it at top 271.3 and a double click is two clicks of the title. A finger moved 60px up from the title
  sends the document a `pointermove` before its `pointercancel`. A mouse press on the title released on the bar sends
  its `click` to the header, and one slid 44px along the title and released on it sends it to the title.

## The mechanism

- **`accept` may answer `'past-threshold'`** (its type `(e: MouseEvent) => boolean | 'past-threshold'`): the press is
  the gesture's only once the pointer has moved more than `DRAG_THRESHOLD` px from where it was pressed, across the axis
  or along it (the larger of the two distances). Until then nothing of the press is touched (no `preventDefault`, no
  capture, no `data-dragging`), so the element under the pointer keeps its press, its focus and its click. The pending
  press hears that pointer's moves and its release **on the document**, since one move can leave the header before the
  threshold is heard. Past the threshold it arms as a press accepted with `true` does at its press (`data-dragging`, the
  capture, the document's release listeners, `ready` asked), and its first frame is the whole distance along the axis
  from the press (none where it armed sideways), so the boundary keeps the offset from the pointer that a press on the
  bar keeps. A release or a cancel before that, heard on the document wherever it lands, ends the pending press with
  nothing done, so none outlives its button. `true` and `false` behave as today.
- **A double click resets only where `accept` answers `true` for it**, so the title's double click is two clicks.
- **`#handle`'s filter** answers `'past-threshold'` where the control the press is in is `p.toggle` and the header is a
  handle (the region, `data-resizes` and `#above` as today, `pair` set), `false` for every other control and every
  touch, and `true` on the bar's empty part as today.
- **The title's hand.** `.panel-header[data-resizes] > .panel-toggle` takes `grab`, and with the header's
  `[data-dragging]` `grabbing`; nothing else in the header changes its cursor.
- **The release's click and a selection are measured before anything is built for them** (Task 1, Step 4). The release
  ends a gesture whose capture the header holds, and whether the browser then sends the click to the header or to the
  title is the engine's. Where the title hears it in either engine, `pointerDrag` swallows that one click and no other:
  only after a press that armed through `'past-threshold'`, and nothing after the release's own task, so a later click
  or Enter on the title is the title's. Where neither engine sends it to the title, nothing swallows: the capture keeps
  it off, which S5 proves. In the same way, where a drag begun on the title leaves a text selection in either engine,
  the build stops it (`user-select: none` on the title where its header is a handle is the likely means), and where
  neither does, nothing is added.

## File structure

| File | Change |
|---|---|
| `web/src/separator.ts` | `DRAG_THRESHOLD`; `accept`'s `'past-threshold'` and the pending press; the double click's `=== true`; the swallow if Step 4 needs one; `pointerDrag`'s doc |
| `web/src/panel-stack.ts` | `#handle`'s filter; the module doc's paragraph on the header (`:24-28`) |
| `web/src/style.css` | the title's `grab` and `grabbing` where its header is a handle; the comment over them (`:1681-1682`); a selection rule if Step 4 needs one |
| `web/tests/browser/panel-boundaries.test.ts` | C1-C9 and C4b; the case per machine view |
| `web/tests/browser/panel-regions.test.ts` | the TM and λ cases |
| the roadmap entry; the design | Task 3 |

No new file, and no change to `panel.ts`, `layout-view.ts` or any pane.

## Design coverage

| The design | Where |
|---|---|
| G1: a press on the title that moves drags, its click not acted on | Task 1: C3, C4, C4b, C5, the four views' cases |
| G2: without the movement, a click | Task 1: C2, C4 |
| G3: the open hand over the title, closed while dragging | Task 1: C1, C5, the four views' cases |
| Every header that is a handle, every view | Task 1: rxm and CLIF (`VIEWS`), TM, λ; the source view has none |
| The other controls stay their own | Task 1: C2 (the maximise button) |
| A double click two clicks; the reset the bar's and the boundary's | Task 1: C6; the existing *puts the two regions back to the shares they are built with at a double click on the bar* (`:605`) and *and at a double click on the boundary itself* (`:718`) |
| Keyboard and touch unchanged | Task 1: C7 (Enter after a drag), C8 (a finger); `AFFECTED`'s key cases |
| Anti-goal | Task 1: C3, C4, C4b, C6, C9 |
| Left to the builder | Global Constraints; Task 1, Step 4 |
| Real input, geometry and style, sabotages; Firefox; by hand; docs | Task 1; Tasks 1 and 2; Task 2; Task 3 |

## Open, for Davey

- **Whether anything swallows the release's click is the engines' answer** (Task 1, Step 4): where neither engine sends
  it to the title there is no swallow and no C7, and the report and the roadmap paragraph say so.

---

### Task 1: The title's press, its hand, and their cases

**Files:**
- Modify: `web/src/separator.ts:31-112`, `web/src/panel-stack.ts:24-28` and `:357-385`, `web/src/style.css:1681-1689`
- Test: `web/tests/browser/panel-boundaries.test.ts`, `web/tests/browser/panel-regions.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: in `separator.ts`, `export const DRAG_THRESHOLD = 4` and `pointerDrag(el: HTMLElement, axis: SeparatorAxis,
  handlers: Pick<SeparatorHandlers, 'ready' | 'drag' | 'commit' | 'reset'>, accept?: (e: MouseEvent) => boolean |
  'past-threshold'): void`. `panel-boundaries.test.ts` imports `DRAG_THRESHOLD`; `panel-regions.test.ts` does not, since
  its cases never read it and an unused import fails `LINT`.

- [ ] **Step 0: Baselines at `0283d85`.** `AFFECTED` into `$L/00-base-affected.log`, `AFFECTED-FF` into
  `$L/00-base-firefox.log`, `TSC` and `LINT` into their logs. Expected: Chromium all pass; Firefox the 3 drag cases
  named above and no other. Another Firefox list is reported before going on.
- [ ] **Step 1: Write the cases.** `separator.ts` first gains `export const DRAG_THRESHOLD = 4` alone, so the files
  load. In `panel-boundaries.test.ts`, under *a panel’s header, as the handle for the boundary above it*, on the file's
  `mount()` unless said, with `t = panelToggle(host, 'heap')`:
  - **C1** (replaces `:492-506`) *says so with the pointer where a boundary lies above it, on its title too, and nowhere
    else*: for `registers`, `stack` and `heap` the header's and the title's computed `cursor` are `grab` and the
    maximise button's `pointer`; the listing's title `pointer`; with the heap closed by a real click, its header without
    `data-resizes`, as now (its title's `pointer` there rests on the same `[data-resizes]` as the listing's, and no
    sabotage would reach it).
  - **C2** (replaces `:546-563`) *leaves a press on its other controls to the control, and a click on its title to the
    title*: the click half as today (`panel` once with `('heap', false)`; reopened, the heights as before); then a real
    drag 60px up begun on the heap's maximise button (`userEvent.dragAndDrop` as the case does now): the heights as
    before, its `aria-pressed` as before, `sizes` not called.
  - **C3** *drags that boundary by a press on its title that moves, and leaves the panel open*: `drag(host, t, -60)`;
    first `panel` not called and `t`'s `aria-expanded` `'true'` (a release whose click reached the title closes the
    heap, and read first it fails here, not at the heights, which a drag that never armed fails too: S5, S11); then the
    heap 60px taller and the row 60px shorter (`toBeCloseTo(…, 0)`), the listing within 0.1px; `sizes` called once; the
    heap's body over 0px tall; with a selection guard (Step 4), `getSelection()?.isCollapsed` true.
  - **C4** *takes a press on its title that moves DRAG_THRESHOLD − 1 px for a click, and one that moves DRAG_THRESHOLD +
    2 px for a drag*: `drag(host, t, -(DRAG_THRESHOLD - 1))` gives `panel` once with `('heap', false)` and no `sizes`
    call; a real click reopens it and the heights are as before; `drag(host, t, -(DRAG_THRESHOLD + 2))` makes the heap
    `DRAG_THRESHOLD + 2` px taller (`toBeCloseTo(…, 0)`) and `panel` is not called again.
  - **C4b** *takes a press on its title slid sideways for a drag that moves nothing, not for a click*:
    `commands.mouse('down', …)` 3px in from the title's left edge at its middle, then `'up'` `DRAG_THRESHOLD + 2` frame
    px to the right at the same height, still on the title (precondition: the title is wider than `DRAG_THRESHOLD + 6`
    px); first `panel` not called and `aria-expanded` `'true'`, then the heights as before and `sizes` not called.
  - **C5** *is held from the moment a press on its title passes the threshold, and not before*: `commands.mouse('down',
    …)` at `pageCentreOf(t)`; a `'move'` `DRAG_THRESHOLD - 1` frame px up: the header has no `data-dragging` and `t`'s
    cursor is `grab`; a `'move'` to `DRAG_THRESHOLD + 2` px up: `data-dragging` `'true'` and `t`'s cursor `grabbing`;
    the `'up'`, in a `finally`: no `data-dragging`, `t`'s cursor `grab`, its `aria-expanded` `'true'`.
  - **C6** *keeps a double click on its title two clicks of the title, and the shares as they are stored*: `mount({
    width: 1000, sizes: { listing: 1, machine: 3, heap: 0.8 } })`, the heap in the row, whose title a close leaves under
    the pointer (in the medium mount a close moves the heap's title 176px down and the second click lands on the
    registers: `$L/probe/probe.log`), with the two preconditions of *and a double click on it puts the listing and the
    row back* (`:534-538`: the heap in the row, the row about 3 times the listing's height); `userEvent.dblClick(t)`,
    `frame()`: `panel` called twice, `('heap', false)` then `('heap', true)`; the listing's and the row's heights as
    before (`toBeCloseTo(…, 0)`); `sizes` not called.
  - **C7**, written only where Step 4 builds a swallow, *answers Enter and a click on its title after a drag that ended
    away from it*: `drag(host, t, d)`, `d` the host's bottom less the title's centre less 20px (about 172px in the
    file's mount: past the heap's floor and inside the host, where 300px would aim past the host and the window);
    precondition: the release point, the title's centre before the drag plus `d`, lies below the title's box after it;
    `t.focus()` and `userEvent.keyboard('{Enter}')` give `panel` `('heap', false)`; a real click `('heap', true)`.
  - **C8** (in `:565-589`, Chromium only) the case's first check is the title: `finger(t, -60, …)` as for the bar, no
    `data-dragging` at the press and the heights as before after the move; then the bar and the boundary as now.
  - **C9** *leaves nothing pending after a press on its title whose release lands off its header*:
    `commands.mouse('down', …)` at `pageCentreOf(t)`; the host made 700px tall and a `frame()`, which takes the title up
    from under the pointer (precondition: `document.elementFromPoint` at the press is not in the header); `'up'` there;
    the heights read; a `'move'` 60 frame px up with no button pressed: no `data-dragging`, the heights as read, `sizes`
    and `panel` not called.
  - **The machine views.** `describe.each(VIEWS)('in a $kind view, the heap’s title', …)`, *drags the boundary above the
    heap, and leaves it open*: `mountView(view, view.medium + 40)` (medium); the title's cursor `grab`; `drag(host, t,
    -60)`: the heap 60px taller, `aria-expanded` `'true'`, `sizes` called once.

  In `panel-regions.test.ts`, in *a copy’s text, in a TM view*: *drags the boundary between the rules and the diagram by
  the diagram’s title, and leaves it open* (the title is `region(host, 'diagram')`'s `.panel-toggle`; precondition: the
  diagram's header has `data-resizes`; its cursor `grab`; `drag(…, -60)`: the diagram 60px taller, the rules 60px
  shorter, `aria-expanded` `'true'`, the last shares' keys `['diagram', 'rules']`). In *the λ view’s term and its map*:
  *drags the boundary over the map by its title, and leaves it open* (`mount(700)`; the map's title cursor `grab`;
  `drag(…, -100)`: the map 100px taller, the term 100px shorter, `aria-expanded` `'true'`).
- [ ] **Step 2: Run them red.** `BROWSER tests/browser/panel-boundaries.test.ts tests/browser/panel-regions.test.ts`
  into `$L/01-red.log`. Expected FAIL: C1, C5, the machine views', the TM and the λ cases at the title's cursor,
  `pointer`; C3 at the heights and C4's drag half, because the press is the button's, so nothing moves and C4's second
  press closes the heap; C4b at `panel`, the sideways press being the title's click. C2, C6, C8 and C9 hold what does
  not change and may pass; S14, S6, S13 and S16 prove them, and the report says which passed.
- [ ] **Step 3: Build the press.** *The mechanism*'s first four points, in `separator.ts`, `panel-stack.ts` and
  `style.css`. `pointerDrag`'s doc, the module doc's header paragraph and the stylesheet's comment over the header's
  hands say that a press on the title is the title's until it moves past the threshold, and why: the title is most of
  what a pointer finds on the bar, and a click there must stay a click.
- [ ] **Step 4: Measure the release's click and the selection, in both engines.** With Step 3 built and nothing for
  either, a probe in C3 (a capture-phase `click` listener on the document that prints `e.target`'s class, and
  `getSelection()?.isCollapsed` after the drag); `BROWSER` and `FIREFOX` on `tests/browser/panel-boundaries.test.ts`
  into `$L/01-probe-chromium.log` and `$L/01-probe-firefox.log`. Where the title heard the click in an engine (C3 or C4b
  fails there on `panel` or `aria-expanded`), build the swallow (*The mechanism*) and write C7. Where a selection was
  left, build its guard and add C3's selection assertion. Where neither engine shows the one or the other, build nothing
  for it, and the report says so with the two logs.
- [ ] **Step 5: Run green.** `BROWSER` and `FIREFOX` on the two files into `$L/01-green-chromium.log` and
  `$L/01-green-firefox.log`. Expected: Chromium all pass; in Firefox every new or changed case passes, and the
  baseline's 3 fail and no other.
- [ ] **Step 6: Sabotage**, one driver `$L/01-sab-driver.mjs`, each into `$L/01-sab-<id>.log`; a row in brackets runs
  only where Step 4 built what it names.

| Id | The one edit | Must fail |
|---|---|---|
| S1 | the filter answers `true` for the title: armed at the press | C5 (held before the threshold); C4's click half |
| S2 | the filter's `false` for every control back, the title's too | C3 (at the heap's height); C4's drag half; C5; the machine views' (both); the TM and λ cases |
| S3 | the threshold compared against `DRAG_THRESHOLD * 10` | C4's drag half |
| S4 | the pending press hears moves on `el` alone, not on the document | C3 (at the heap's height) |
| S5 | [no swallow] the arm takes no capture | C3 (at `panel`); C4b |
| S6 | the double click resets wherever `accept` answers anything but `false` | C6 |
| S7 | the title's `grab` rule taken out | C1; the machine views', the TM and λ cases |
| S8 | the title's `grab` rule without its `[data-resizes]` | C1 (the listing's title) |
| S9 | the title's `grabbing` rule taken out | C5 |
| S10 | the arm moves nothing, only the moves after it do | C4's drag half (at the heap's height) |
| S11 | [swallow] the swallow taken out, in the engine Step 4 named | C3 (at `panel`) |
| S12 | [swallow] the swallow kept for a second, every click in it swallowed | C7 |
| S13 | the filter's title test moved above its touch test | C8 |
| S14 | the filter answers `'past-threshold'` for every control | C2 |
| S15 | [guard] the selection guard taken out, in the engine Step 4 named | C3 |
| S16 | the pending press hears its release on `el` alone, and nothing else ends it | C9 (at `data-dragging`) |
| S17 | the threshold read along the axis alone | C4b (at `panel`) |

- [ ] **Step 7: Gates and the commit.** `AFFECTED` into `$L/01-affected.log` (Step 0's count and the new cases, all
  passing), `AFFECTED-FF` into `$L/01-firefox.log` (the baseline's failures and no other), `TSC`, `LINT` and `COMMENTS`
  into their logs; the message in `$L/01-commit-msg.txt`; the commit holds the five files.
- [ ] **Step 8: Report** in `$L/task-1-report.md`: Step 4's two answers in each engine and what was built for them; each
  sabotage, the cases and assertions it failed at, its log; the tallies of Steps 0, 5 and 7.

### Task 2: The full gate, and the pass by hand in Firefox

**Files:** none unless a leg fails. One agent, with no other browser run on the machine.

- [ ] **The web job as CI runs it**, from `$W/web` with `CARGO_TARGET_DIR=$T`: `pnpm run build:wasm`, `build:lsp-wasm`,
  `build:clif-wasm`, `build:bindings`, `../scripts/check-licences.sh --self-test` and then alone, `LINT`, `TSC`, `pnpm
  run test:coverage`, `pnpm run build:app`, each into `$L/02-<leg>.log`. `test:coverage` runs under the browser lock,
  the port wait inside it, and a memory cap, in a transient unit: `flock /home/davey/temp/redextape-browser.lock
  systemd-run --user --wait -p MemoryMax=16G -p MemorySwapMax=0` with `--setenv` for `PATH`, `HOME`, `CARGO_HOME`,
  `RUSTUP_HOME`, `CARGO_TARGET_DIR` and `VITEST_MAX_WORKERS=4` (`$R/impl2/08g-gate-run.zsh` is the model, its exits
  written to `$L/02-gate-exits.txt`). Expected: exit 0 each, the coverage thresholds met.
- [ ] **From `$W`**: `scripts/check-all.sh`; `cargo llvm-cov nextest --workspace --fail-under-lines 90`;
  `scripts/check-slow.sh`; each scan `rg -o 'scripts/check-[a-z-]+\.(sh|mjs)' .forgejo/workflows/ci.yml | sort -u`
  lists, with `--self-test` and then alone. The Rust legs prove the toolchain, not this change; they run all the same.
- [ ] **`AFFECTED-FF` once more at the head** into `$L/02-firefox-affected.log`: the baseline's failures and no other.
- [ ] **By hand in Firefox**, driven as the last pass was (`$R/impl2/08g-hand.zsh`: `vite build` into `$L/hand/dist` and
  `vite preview` on a free port from 4391 to 4399 under the browser lock; `$R/impl2/hand-8/drive.mjs` the model for
  `$L/hand/drive.mjs`), screenshots in `$L/hand/`, at a 1412 by 896 window, in the CLIF, rxm, TM and λ views (the TM
  view's diagram and the λ view's map shown through their menus where they are off), on one title each whose header is a
  handle (the heap's in CLIF and rxm, the diagram's in TM, the map's in λ): its computed cursor `grab`; a press moved
  60px up, the region below 60px taller, the panel open, the cursor `grabbing` while held; a press slid 6px sideways
  along the title and released on it, the panel open and nothing moved; a click, the panel closed and, reopened, the
  boundary where it was. A double click on a title a close leaves in place, the call stack's in CLIF and rxm where it is
  in the row: the panel closed and open again and the heights as before (the titles above move when their panel closes
  wherever theirs is a region of the view's own, the heap's in a medium or narrow view, the diagram's and the map's, so
  there a double click's second click lands on whatever slides under the pointer, as before this change). Expected: no
  page error. Davey tries the branch in Firefox before giving the word to push.
- [ ] A leg that fails is fixed in a commit of its own, test first, and the legs its files feed run again.
- [ ] **Report** in `$L/task-2-report.md`: each leg's exit, the tallies, the pass's findings.

### Task 3: The roadmap entry, and the design where the build differs

**Files:** modify `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the `panels-row` entry from `:39160`);
`docs/superpowers/specs/2026-11-22-panel-title-drag-design.md` only as below.

- [ ] **The entry's paragraph.** After the paragraph on the changes after Davey's try (`:39177-39189`), one paragraph:
  what changed for a person using the views (a press on a panel's title that moves more than 4px drags the boundary
  above, a click stays a click, the open hand over the title, in the CLIF, rxm, TM and λ views); the design (`0283d85`),
  this plan's commit and the build's; what Step 4 found in each engine and what was built for it; the sabotages that
  ran, the cases each failed and their logs in `$L3`; the gate's tallies and the pass by hand.
- [ ] **The heading and VERIFICATION.** The heading's range runs to the last code commit, and its count and its list of
  docs commits follow. In *VERIFICATION*: `L3=$R/impl3` joins the table's paths sentence (`:39800-39802`); a row for
  each figure the new paragraph quotes; the rows whose figure changed (the heading's count) re-pointed; every row run
  again after the last code commit into `$L/03-figures.log`, in `$R/impl2/08d-figures.log`'s shape. Values and SHAs, not
  "the only" or "all".
- [ ] **The design** gains an `## As built` section, a line each, only where the build differs from its text. The
  threshold and what swallows the click were left to the builder: they are not differences. One line says a double click
  is two clicks of the title only where closing the panel leaves its title under the pointer; where the close moves it,
  the second click is whatever is then under the pointer, as before this change (`$L/preflight.md`, F6).
- [ ] **User docs.** Search `web/*.html`, `README.md` and `docs/*.md` for a header's or a title's press or drag; change
  a line only where it has become false (`web/help.html:157-158` has not), and report what the search found.
- [ ] **Commit** the entry, with the design if it changed; the hook's scans, `check-doc-figures` among them, pass.
  Report in `$L/task-3-report.md`.

### Task 4: A review of `0283d85..HEAD`, and its fixes

**Files:** as the findings need.

- [ ] **The review.** A fresh reviewer (opus) reads the design, this plan and `git diff 0283d85..HEAD`, and writes
  `$L/review.md`: findings by severity, each with its file and line and the input that shows it. It asks in particular:
  is any click swallowed but the one a drag's release makes; does any press change but the title's (the bar's, a
  boundary's, a layout divider's, another control's, a finger's, a key's); does a comment hold history or a measurement;
  is any case blind (a sabotage that failed at an assertion other than the one it was named for).
- [ ] **The fixes.** Each finding is checked before it is acted on: a finding is a claim. One that holds is fixed test
  first, in a commit of its own, with a sabotage where it adds a test, and its class is searched for siblings. One that
  does not hold is answered in `$L/review.md` with the evidence.
- [ ] **Then** Task 2's legs for every file the fixes touch (all of the web job if a file under `web/` changed) and
  `AFFECTED-FF`, and a commit that brings the roadmap paragraph up to the fixes, its figures run again.
- [ ] **Report** the head SHA and the tallies in `$L/task-4-report.md`. **Stop there**: pushing and opening the pull
  request wait for Davey's word.
