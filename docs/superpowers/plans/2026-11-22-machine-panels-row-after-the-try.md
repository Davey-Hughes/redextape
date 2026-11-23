# Machine panels row after the try — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three changes to the machine panels row from Davey's try in Firefox: in narrow a boundary between the first
panel and the call stack, stored as every other share is (G1); the row's panels 8px apart, the thresholds following
(G2); a panel header's count centred top to bottom on the header's buttons (G3).

**Architecture:** G1 gives the call stack a region of its own in the heap's pattern (`.machine-stack`, shown in narrow
alone, the panel moved by `moveInto` and `place`) and teaches `PanelStack` one thing, a region that is a part of another
(`StackRegion.partOf`): the stored `machine` stays the values and the call stack together in every arrangement, and the
call stack's region stores its part of it under `stack`, so a switch changes nothing stored. G2 is one declaration in
`style.css`, which `MachineRow` already reads at each decision, and the tests' threshold literals. G3 is `align-self:
center` on the base `.panel-note` rule.

**Tech Stack:** TypeScript, Vite, Vitest 4 (node; browser on Playwright, Chromium and Firefox), Biome. No Rust changes.

**Spec:** `docs/superpowers/specs/2026-11-22-machine-panels-row-after-the-try-design.md` (all of it; cited as *the
design*). Context, cited as *first design §n*: `docs/superpowers/specs/2026-11-21-machine-panels-row-design.md`
(§5.1-§5.3, §6, §11 As built). The first plan, `docs/superpowers/plans/2026-11-21-machine-panels-row.md`, gives this
plan its notation; its tasks are done.

## Execution notes

- **Paths.** `W=/home/davey/temp/redextape-panels-row` (branch `panels-row`, plan written at `5eed000`, not pushed);
  `R=/home/davey/temp/redextape-panels-row-record`; `L=$R/impl2` (every log, the sabotage drivers and their saved
  copies, commit message files; never the worktree); `T=/home/davey/.cache/redextape-panels-row-target` (`export
  CARGO_TARGET_DIR=$T` in every shell that runs cargo, wasm-pack, `pnpm run typecheck` or `git commit`).
- **The worktree.** `web/node_modules` is a copy, not a symlink, and stays one. `pkg/`, `pkg-lsp/`, `pkg-clif/` and
  `web/bindings/` were built by the first plan's Task 0 and no Rust has changed since; Task 0 checks them and rebuilds
  one only if it is missing or a symlink.
- **One committing agent in `$W` at a time** (the pre-commit hook runs over the whole tree). Implementers do not push
  and open no pull request: Davey gives that word, after Task 8.
- **Line references are at `5eed000`.** Once an earlier task has edited a file, find the place by name.

## Global Constraints

- **The design's values, verbatim.** G2: panels in a row stand `var(--space-2)` (8px) apart. Thresholds at a 16px root:
  rxm wide from 880px, medium from 584px; CLIF wide from 606px, medium from 362px. The app's views at a 1280px window
  (634px inside) stay CLIF wide and rxm medium, at 1024px (506px) CLIF medium and rxm narrow. G1's boundary is named
  "resize values and call stack" in CLIF, "resize registers and call stack" in rxm. G3: the drawn text's middle (a
  `Range`'s box) within half a pixel of the maximise button's middle, in Chromium and Firefox, in each view that has a
  panel count.
- **The design's anti-goals.** Nothing moves on a step. A workspace or link written before this shows the heights it
  shows today: with nothing stored for the new boundary, the first panel and the call stack split evenly. No count cut
  that is whole today: at each threshold every column is the width it is today. No panel sizes itself to its content.
  Medium and wide change only by G2.
- **Commands** (notation used below). Each run writes `>| $L/<task>-<what>.log 2>&1` and is followed by `print $?`; the
  tallies are read from the log with `grep -aE 'Test Files|Tests |FAIL|×'`. zsh has `noclobber`, hence `>|`. Never pipe
  a run through `tail`: it hides the exit status. All from `$W/web` unless said.
  - `BROWSER files…`: `flock /home/davey/temp/redextape-browser.lock zsh -c 'until ! ss -ltn | grep -q ":63315 "; do
    sleep 5; done; VITEST_MAX_WORKERS=4 pnpm exec vitest run --project browser "$@"' _ <paths>`: the wait for port 63315
    (another project's vitest uses it) runs inside the lock. Paths are positional (`tests/browser/x.test.ts`); `pnpm
    test:browser -- name` does not scope, and `--maxWorkers` does not reach the browser projects.
  - `SCROLL files…`: the same with `--project browser-scrollbars`.
  - `FIREFOX files…`: the same with `REDEXTAPE_FIREFOX=1` and `--project firefox --project firefox-capture`.
  - `NODE f`: `pnpm exec vitest run --project node tests/node/f.test.ts` (no lock).
  - `TSC`: `CARGO_TARGET_DIR=$T pnpm run typecheck`. `LINT`: `pnpm exec biome ci --error-on-warnings`. `COMMENTS`: `node
    scripts/check-comments.mjs` from `$W`.
- **`AFFECTED`**, run before every commit: `BROWSER` on `machine-row`, `machine-panel-headers`, `machine-row-app`,
  `panel-stack-place`, `hear-loops`, `clif-switch-frames`, `panel`, `panel-boundaries`, `panel-maximise`,
  `panel-regions`, `panel-sizes-stored`, `panel-sizes-restore`, `panel-sizes-restore-lambda`, `stored-panels-restore`,
  `rxm-pane`, `clif-pane`, `clif-layout`, `clif-shown`, `machine-view-chrome`, `edge-spacing`, `hidden`, `hidden-views`,
  `tm-view-narrow` (each `tests/browser/<name>.test.ts`); `SCROLL tests/browser/machine-row-scrollbars.test.ts`; `NODE
  machine-row`. **`AFFECTED-FF`**: `FIREFOX` on `machine-row`, `machine-panel-headers`, `machine-row-app`,
  `panel-stack-place`, `hear-loops`, `clif-switch-frames`, `panel-boundaries` (it is on `CAPTURE_FILES` and runs in
  `firefox-capture`), `panel-maximise`, `rxm-pane`, `clif-pane`, `clif-layout`, `edge-spacing`, `hidden`. The scroll-bar
  file is on `SCROLLBAR_FILES`, which no Firefox project runs (`web/vite.config.ts:93-117`, `:575`). **Chromium is the
  gate. Firefox is compared against Task 0's baseline**, the 3 `panel-boundaries` drag cases the first plan names.
- **Test first.** Each task writes its tests, runs them to see them fail for the reason the task names, then builds. A
  case that cannot fail first is proven by its sabotage instead, and the task's report says which.
- **Sabotage.** Save a copy (`cp <file> $L/sab/<id>.orig`), make the one edit named, run the named files into
  `$L/<task>-sab-<id>.log`, copy the file back, `cmp` it. **Never `git checkout`**. One driver script a task, kept in
  `$L`, one browser run a sabotage. Each names the cases that must fail; **a sabotage that does not fire is a finding:
  stop and report**. A case stops at its first failed assertion, so a case named for two sabotages must fail under each
  alone. `$W` serves no dev server.
- **Commits.** One per task: `cd $W && export CARGO_TARGET_DIR=$T && git add <the task's files> && git commit -F
  $L/<task>-commit-msg.txt`. The hook runs nine tree-wide scans, the comment guard and the licences check among them,
  and `biome ci` and `pnpm run typecheck` when `web/` files are staged. Never `--no-verify`, never `--amend`. The
  message is one long plain sentence saying what the commit holds, as `git log --oneline -5` shows. If the comment guard
  reports a budget, cut the comment to its why first; only if it is still over, write the value it prints into
  `scripts/comment-budget.json` in that commit and say so.
- **Copy and code.** "redextape" is lowercase in prose; spelling is British; no attribution to a person or a tool
  anywhere in the tree. Doc comments are `/** */`. **A comment says why**: the reason, the invariant, what breaks if it
  changes. No history, no measurement, no `file:line`; a comment may point at a design section. Wrapped at 120 columns.
- **Browser tests.** A claim about what a person sees asserts geometry or computed style, never `textContent` (an
  accessible name is an attribute and may be asserted). Presses use `userEvent`, never `.click()`. A probe prints with
  `console.error`. A test that goes on after a `ResizeObserver` callback does so in a `setTimeout`. Every file named
  here already calls `hearLoops` (`harness.ts`), which fails a case for any error the page reports. A pointer drag goes
  in `panel-boundaries.test.ts`; the other files make gestures with the keyboard. A case that reads text metrics asserts
  first that `document.documentElement.dataset.style` is unset or `instrument`. A G1 case mounts its view 1600px tall,
  so every region is over its floor and a boundary has room to move.
- **Settled, not to be reopened.** The first plan's settled list stands except where this one changes it: the row is
  built in narrow, not medium, and narrow is no longer a column inside the row. New here: G1 is a region of the call
  stack's own, `.machine-stack`, shown in narrow alone, with `partOf: 'machine'` (G1's mechanism, below); the stored
  name is `stack` and holds a part, a fraction; `machine` stays the values and the call stack together; either of the
  two open alone takes their whole share; a switch stores nothing; in narrow the boundaries are named "resize listing
  and *values*", "resize *values* and call stack" and "resize call stack and heap"; a focused boundary a switch removes
  hands the focus to the call stack's toggle where the call stack's region was below it, and to the heap's toggle
  otherwise. G2 is `column-gap: var(--space-2)` and nothing else: the columns' rem lists do not change. G3 is
  `align-self: center` on the base `.panel-note` rule, not `align-items` on `.panel-actions`, which would change the
  height of every header's buttons and selects.

## Review Focus

Inputs the design implies that its own text does not test, most likely first. Each has its test in the task named.

1. **A workspace or link written before this**, with `machine` stored and no `stack`, opened in each arrangement: in
   narrow the values and the call stack the same height and the two together the row's share; in medium and wide the
   heights the base draws, the hidden region counting for nothing. Task 4, *shows a workspace stored before the call
   stack had a region as it did*.
2. **A stored part outside 0 to 1**, from a link edited by hand: `parsePanelSizes` (`workspace.ts:405`) takes any finite
   number above 0, and a part of 1.5 would give the values a share under nothing. It reads as the built part. Task 3.
3. **One of the two closed in narrow.** The open one takes the row's whole share, as the narrow column does today (first
   design §5.2), with no boundary between them and the closed one its header's height. Tasks 3 and 4.
4. **A focused boundary above the call stack that a switch removes**, including narrow to wide in one step and the
   boundary between the listing and the call stack while the values are closed: the focus goes to the call stack's
   toggle, never the page's body. Task 4.
5. **An rxm copy in narrow**, its text above and its outline below: six regions, five under its text, and each region
   begins right under the boundary above it in every arrangement, across the hidden regions between them (the class
   `8bea67c` closed for the heap's region). Task 4.

## Verified facts (at `5eed000`, read while writing this plan)

- **G2.** `.rxm-machine` has `column-gap: 1rem` and `row-gap: var(--space-2)` (`style.css:3017-3023`); `--space-2:
  0.5rem` (`:34`). `MachineRow.#chosen` reads the root's font size and the row's computed `columnGap` at each decision
  (`machine-row.ts:181-184`). Threshold literals: `tests/browser/machine-views.ts:64-65, 79-80` (`VIEWS`, from which
  `machine-row`, `machine-row-scrollbars` and `machine-panel-headers` derive their widths);
  `machine-panel-headers.test.ts:166-175` (`WHOLE`); `machine-row.test.ts:121-122` (`WIDE_AT_20 = { rxm: 1120, clif: 778
  }`); `tests/node/machine-row.test.ts:4-23` (`GAP = 16` and ten widths). No other browser test puts a machine view
  between an old and a new threshold: the fixtures are 800, 1000 and 420px (`panel-boundaries`), 400 and 620px
  (`rxm-pane`), the app's 634 and 506px beside the source, and a Stage view's `window - 288` (the inspector's `18rem`,
  `style.css:2388`; 992, 736 and 512px at 1280, 1024 and 800, read at 992 in `$R/impl/06-probe-app.log`), so
  `machine-row-app.test.ts`'s `MACHINES` table holds as it is. Docs naming the old values: the first design §5.1 (dated,
  stays) and the branch's roadmap entry (`2026-07-19-redextape-roadmap.md` from line 39160).
- **G3.** `.panel-note` is built only by `countNote` (`machine-panels.ts:188-206`), appended to the call stack's and the
  heap's actions (`:105`, `:143`): the CLIF and rxm views are every view with a panel count. Its base rule
  (`style.css:3072-3075`) sets no `align-self`; `.panel-actions` (`:1649-1657`) is a flex row with the default
  `stretch`; `.machine-panel .panel-note` (`:3094-3104`) adds `flex`, `container-type` and overflow. Other actions hold
  buttons and selects (`tm-pane.ts:300`, `lambda-pane.ts:241`, `followed-grid-panel.ts:81`).
- **`PanelStack`** (`panel-stack.ts`). A panel belongs to the region whose `panels` list it is built in, until `place`
  (`:96`, `:109`, `:150-160`), and each panel gets its handle and maximise button once per list it is in (`:116-127`),
  so a panel may be in one list only. `#isOpen` reads `hidden` and the members (`:186-189`); a region with no panels
  counts as open. `#share` is the stored share or the built one (`:196-198`). `#commit` stores the two regions' names
  (`:492-516`); `#reset` deletes both (`:406-414`). A `ResizeObserver` per region built with more than one panel
  (`:112-115`) and `#atTop` (`:300-304`) exist only for the narrow column; `machine` is the only region built with two
  panels (`rg 'panels: \[' web/src`).
- **Stored shares.** `parsePanelSizes` accepts any name with a finite number above 0 (`workspace.ts:405-420`); a link
  carries the workspace as `serializeWorkspace`'s string (`share-link.ts:13`); `pane-host.ts` hands each view
  `panelSizesOf(leaf)` and stores what `panelSizes` reports (`:524-550`, `:1086-1089`). The machine panes read `sizes`
  once, at construction (`rxm-pane.ts:146-163`, `clif-pane.ts:165-180`), and nothing calls their stack's `setSizes`. So
  a new name round-trips through workspaces and links as `machine` does, with no code per name.
- **The panes** append `row.el, row.heapRegion` (`rxm-pane.ts:141`, `clif-pane.ts:161`) and spread `row.regions` into
  their stack. Region floors: `.rxm-registers, .rxm-stack, .rxm-heap` keep `min-height: 5lh` (`style.css:3060-3064`),
  which a 900px view in narrow does not clear: hence the 1600px G1 mounts.
- **Tests that hold today's narrow** and change in Task 4: in `machine-row.test.ts`, *draws the regions and boundaries
  of each arrangement* (`:148`), *names the boundary above the row for what the row holds* (`:184`), *keeps a closed
  panel at its column…* (`:256`), *gives a maximised panel in narrow all the spare height…* (`:309`); `drawnAs` in
  `machine-views.ts:173`; and `panel-boundaries.test.ts`'s *is not a handle on a panel that has wrapped under the one
  beside it* (`:619`).

## G1's mechanism: the call stack's region, a part of the row's share

The call stack gets a region of its own in the heap's pattern: `MachineRow.stackRegion` (`.machine-stack`), between the
row and the heap's region, holding the call stack in narrow and `hidden` in medium and wide, the panel moved by
`moveInto` and `place`. The pattern alone cannot give the share: a hidden region's share waits (first design §5.3), so
in medium the row would lose the call stack's part and the listing and the heap would grow, and an old workspace's
`machine`, the two together today, would go to the values alone in narrow. So `PanelStack` learns that a region can be a
part of another (`StackRegion.partOf`). `machine` stays the two together in every arrangement; the call stack's region
stores under `stack` its part of that share, 0.5 when none is stored; while both are open they divide it; either one
open alone, or the row while the part is hidden, takes all of it. A switch then stores nothing and asks the stack for
nothing but `place`: hiding the region is what gives the row the height the two had together. Translating the shares in
`MachineRow` instead, which would leave `PanelStack` as it is, was turned down: both panes would route every read and
write of the shares through it, the stack's `setSizes` would be called at each switch, and the stack's fallback to a
region's built share would have to change with the arrangement.

The rules, for a region `P` with `partOf` naming `W` (`own(r)` is the stored share or the built one; `part(P)` is the
stored value where it is above 0 and under 1, else `P.share`; *open* is `#isOpen`, which a hidden region is not):

- `#share(W)` = `own(W) × (open(P) ? 1 − part(P) : 1)`; `#share(P)` = `own(W) × (open(W) ? part(P) : 1)`. Every other
  region as today.
- At a commit, `d(r)` is the share drawn for each of the gesture's two regions (pixels × `scale`, as today). Where
  either is `W` or `P` and both are open: `v = d(W)` or `#share(W)`, `s = d(P)` or `#share(P)`; store `W.name: v + s`
  and `P.name: s / (v + s)`, each to six figures. `P` open alone stores its `d` under `W.name`. Otherwise as today. So a
  drag between the two leaves `machine` as it was, and a drag beside one of them keeps the other's height and stores
  three entries.
- `#reset` puts back the two sides of its boundary and leaves the split between `W` and `P` alone unless the boundary is
  the one between them (controller rulings, 2026-11-22). On the boundary between `W` and `P` it deletes `P.name` alone:
  Enter or a double click there puts the split back as built and keeps the row's share, so the listing and the heap stay
  where they are. On a boundary with `W` or `P` on one side and a region outside the pair on the other, it deletes the
  outside region's name and `W.name`, never `P.name`, whichever of `W` or `P` is the open one beside it: with the values
  closed, Enter on `listing|stack` deletes `listing` and `machine`; on `stack|heap` it deletes `heap` and `machine`, and
  the values keep their part of the row. On every other boundary it deletes both of its regions' names, as today.
- The constructor throws where `partOf` names no region of the stack, as `place` does for an unknown name.

Two consequences. **The row is built in narrow**: `PanelStack` reads a panel as drawn in the region it is built in, so
the constructor builds every panel in its own region and `follow` makes the first switch at once, before the first frame
(first design §6.1). **The row is never a column**: in narrow it holds the values alone, so its column rules, its
`row-gap`, `PanelStack`'s per-region `ResizeObserver` and `#atTop` lose their only use and go; a header is a handle
wherever its region has a boundary above it.

## File structure

| File | Change | Task |
|---|---|---|
| `web/src/style.css` | `.rxm-machine`'s gap; `.panel-note`'s `align-self`; `.machine-stack`'s rules, the boundary rules across hidden regions, the narrow column's rules gone | 1, 2, 4 |
| `web/src/panel-stack.ts` | `StackRegion.partOf`, `#share`, `#commit`, the constructor's check; the per-region observer and `#atTop` gone | 3, 4 |
| `web/src/machine-row.ts` | `stackRegion`, three regions, built in narrow, `#apply` moves both panels, the focus rule, the row's label | 4 |
| `web/src/rxm-pane.ts`, `web/src/clif-pane.ts` | append `row.stackRegion`; their region comments | 4 |
| `web/tests/node/machine-row.test.ts` | the gap and the widths | 1 |
| `web/tests/browser/machine-views.ts` | `VIEWS`' thresholds; `drawnAs` holds the call stack's region; `underBoundaries` | 1, 4 |
| `web/tests/browser/machine-row.test.ts` | `WIDE_AT_20`; the narrow cases; G1's cases | 1, 4 |
| `web/tests/browser/machine-panel-headers.test.ts` | `WHOLE`'s widths; G3's case | 1, 2 |
| `web/tests/browser/panel-stack-place.test.ts` | a stack with a part region | 3 |
| `web/tests/browser/panel-boundaries.test.ts` | the wrapped-panel case becomes the call stack header's drag | 4 |
| `web/tests/browser/machine-row-app.test.ts` | the rxm view's split in the workspace | 4 |
| the first design's §11, the roadmap entry | brought up to these commits | 6 |

No new file. The TM, λ and source views do not change: no region of theirs sets `partOf` or is built with two panels,
and `panel-regions`, the `panel-sizes-*` files and `tm-view-narrow` in `AFFECTED` hold that.

## Design coverage

| The design | Task |
|---|---|
| G1: the boundary, its handle, its names, the keyboard's step | 4 (3 for the share) |
| G1: stored under a name of its own, in workspaces and links, kept across switches; the row gets the two's height | 3, 4 |
| G1: closed and maximised; focus across a switch | 3, 4 |
| G2 and its thresholds; the app's views at 1280 and 1024px | 1 (4 re-runs `machine-row-app`) |
| G3, measured in Chromium and Firefox | 2 |
| Anti-goals: nothing moves on a step; an old workspace; no count cut | 4; 4; 1 |
| Constraints: sabotages, geometry, real input; moved thresholds; Firefox; by hand; docs | every task; 1; 0, 5; 5; 6 |

## Open, for Davey

- **Closing the values or the call stack in narrow** gives the row's whole share to the other, as today's narrow column
  does, rather than spreading the room over the listing and the heap as a closed heap does. The plan reads that from the
  design's "as the first design's §5.2"; Davey may want it the other way.
- **Enter or a double click on a boundary** puts back the two sides of that boundary and leaves the split between the
  first panel and the call stack alone unless the boundary is the one between them: there it puts the split back as
  built and keeps the row's height; on a boundary beside the pair it deletes the outside region's share and the row's
  (`machine`), never the split (`stack`) (controller rulings: a reset of the split that also moved the listing would
  surprise, and so would a reset beside the pair that moved the other of the two; the `#reset` rules in *G1's mechanism*
  to revert).

---

### Task 0: Set up and take the baselines

**Files:** none tracked. **No commit.**

- [ ] `mkdir -p $L/sab`. `ls -ld $W/pkg $W/pkg-lsp $W/pkg-clif $W/web/bindings $W/web/node_modules $T` into
  `$L/00-dirs.log`: each a directory, none a symlink. A missing one is rebuilt with its `pnpm run build:*` script into
  `$L/00-build-<name>.log`.
- [ ] `TSC` and `LINT` into `$L/00-tsc.log` and `$L/00-lint.log`: exit 0 each.
- [ ] `AFFECTED` into `$L/00-base-affected.log`, `00-base-scrollbars.log` and `00-base-node.log`; `AFFECTED-FF` into
  `$L/00-base-firefox.log`. Expected: Chromium, scroll bars and node exit 0; Firefox exit 1 with exactly the 3
  `panel-boundaries` cases under *a drag of a boundary*: *stops where a neighbour would go under its floor of five
  rows*; *stores a share for the two regions it parts and for no other, one on its floor among them*; *leaves a region
  over its floor exactly where it was, where one of the two it parts began on its floor*. Anything else: stop and
  report.

### Task 1: G2, the row's gap is `var(--space-2)` and the thresholds follow

**Files:** modify `web/src/style.css:3020`; `web/tests/browser/machine-views.ts:56-80`;
`web/tests/browser/machine-row.test.ts:121-122`; `web/tests/browser/machine-panel-headers.test.ts:160-175`;
`web/tests/node/machine-row.test.ts:4-23`.

**Interfaces:** Produces `VIEWS` with rxm `wide: 880, medium: 584` and CLIF `wide: 606, medium: 362`, which Task 4's
cases derive their widths from.

- [ ] **Step 1: The tests at the new thresholds.** `VIEWS`: rxm `wide: 880, medium: 584`, CLIF `wide: 606, medium: 362`,
  its doc saying the gap is the after-the-try design's 8px. `WIDE_AT_20 = { rxm: 1100, clif: 758 }` (three least widths
  and two gaps of 0.5rem, by 20: 1100 and 757.5). `WHOLE`: rxm at 880 (wide) and 584 (medium); CLIF at 606 (wide), 634
  (wide) and 362 (medium), counts as they are; its doc names the new widths. The node file: `GAP = 8`, CLIF rows at 606
  / 605.99 / 362 / 361.99, rxm at 880 / 879 / 584 / 583, and its doc comment.
- [ ] **Step 2: See them fail.** `BROWSER` `machine-row` `machine-panel-headers` `machine-row-app` and `SCROLL` into
  `$L/01-red.log`. Expected, in both views, because the row's 16px gap still puts each threshold 16px or 8px higher: in
  `machine-row`, *switches at each threshold…* (medium at 880 or 606px), *reads its host's width less its padding and
  border*, *takes its thresholds from the root's font size*, *draws its columns in their parts of the row at each
  threshold and wider…*; in `machine-panel-headers`, *holds each count whole…* at 880, 584, 606 and 362px (its
  arrangement precondition); in `machine-row-scrollbars`, all three cases (not wide a pixel over the threshold).
  `machine-row-app` passes, its widths being the app's. The node file passes before the build and after it:
  `arrangementFor` is a pure function of the gap the file passes it and reads no CSS, so its edit keeps its rows and doc
  true to G2, and A3 proves the rows. Record the failing names in the report.
- [ ] **Step 3: Build.** `.rxm-machine { column-gap: var(--space-2) }`. Nothing else: `#chosen` reads it.
- [ ] **Step 4: Green.** `AFFECTED` into `$L/01-affected*.log`: exit 0. `AFFECTED-FF` into `$L/01-firefox.log`: Task 0's
  failures and no other.
- [ ] **Step 5: Sabotages.** A1 and A2 each on `machine-row` and `machine-panel-headers`. **A1**, `column-gap: 1rem`
  again: Step 2's `machine-row` and `machine-panel-headers` cases fail. **A2**, `#chosen` takes `const gap = 16` in
  place of the read: *switches at each threshold…* and *takes its thresholds from the root's font size* fail in both
  views. **A3**, `arrangementFor`'s `2 * gap` becomes `gap`, on `NODE machine-row`: the rows at 879 and 605.99 fail.
- [ ] **Step 6: Commit.** `TSC`, `LINT`, `COMMENTS`: exit 0. Commit the five files.

### Task 2: G3, a count centred on its header's buttons

**Files:** modify `web/src/style.css:3072-3075` (the base `.panel-note`);
`web/tests/browser/machine-panel-headers.test.ts` (a case in the first `describe.each(VIEWS)`).

- [ ] **Step 1: The case.** *centres each count on its maximise button, top to bottom, open or closed, in each
  arrangement*:

```ts
inInstrument()
const widths = [view.wide + 40, Math.round((view.medium + view.wide) / 2), view.medium - 40]
const { host, draw } = mount(view, widths[0], { height: 1600 })
draw({ depth: 2, cells: 57, boxes: 2 })
const middle = (r: DOMRect) => r.top + r.height / 2
// for closed of [false, true] (closing all three by userEvent.click(panelToggle(...)) between the passes),
// for w of widths (await resize(host, w)), for n of ['stack', 'heap']:
const text = note(host, n).firstElementChild as HTMLElement
expect(getComputedStyle(text).visibility, `precondition: ${n}'s count drawn at ${w} px`).toBe('visible')
const glyphs = document.createRange()
glyphs.selectNodeContents(text)
expect(glyphs.getBoundingClientRect().height, 'precondition: a line of text').toBeGreaterThan(0)
expect(
  Math.abs(middle(glyphs.getBoundingClientRect()) - middle(maximise(host, n).getBoundingClientRect())),
  `${n} at ${w} px${closed ? ', closed' : ''}`,
).toBeLessThanOrEqual(0.5)
```

- [ ] **Step 2: See it fail** in both views, `BROWSER machine-panel-headers` into `$L/02-red.log`: the count's text sits
  at the top of a box stretched to the actions' height, about 2px above the button's middle. A pass at the base in any
  view is a finding: stop and report.
- [ ] **Step 3: Build.** `align-self: center` in the base `.panel-note` rule, with a comment saying why: stretched to
  the actions' height, a count draws its line at the top of its box. Not in `.machine-panel .panel-note`: a count in any
  header is to match.
- [ ] **Step 4: Green.** `AFFECTED` (`tm-view-narrow` and `edge-spacing` read every header) and `AFFECTED-FF` into
  `$L/02-*.log`: Chromium exit 0; Firefox Task 0's failures and no other, the new case passing in both views.
- [ ] **Step 5: Sabotage C1**, the declaration removed: the new case fails in both views (`machine-panel-headers`).
- [ ] **Step 6: Commit** the two files, after `TSC`, `LINT`, `COMMENTS`.

### Task 3: `PanelStack` learns a region that is a part of another

**Files:** modify `web/src/panel-stack.ts` (the module doc's paragraph on what a drag stores, `:30-36`; `StackRegion`,
`:38-58`; the constructor, `:103-130`; `#share`, `:196-198`; `#reset`, `:406-414`; `#commit`, `:492-516`); test
`web/tests/browser/panel-stack-place.test.ts` (a fixture and a `describe` of its own).

**Interfaces:** Produces `StackRegion.partOf?: string`: the name of the region this one is a part of; with it, `share`
is the part with nothing stored and the stored value is the part, as *G1's mechanism* says. The constructor throws
`Error` naming the missing region where `partOf` names none. Nothing else of the API changes.

- [ ] **Step 1: The fixture and the cases.** `mountPart(sizes: Shares = {})`, built as the file's `mount` is (600 ×
  600px column, `SHARED` inline): regions `top` (share 2, panel `t`), `whole` (share 1, panel `a` in a div), `part`
  (`partOf: 'whole'`, share 0.5, panel `b` in a div) and `last` (share 1, panel `m`); `hide()` moves `b`'s element into
  `whole`'s, sets `part`'s element `hidden` and calls `place(b, 'whole')`, as a machine view does. `h(name)` is the
  region's height. In `describe('a region that is a part of another')`:
  1. *divides the share of the region it is a part of by the part it is built with, and by a stored part*: with `{}`,
     `h('whole')` and `h('part')` within 0.5px, `(h('whole') + h('part')) / h('top')` close to 0.5 (2 places); with `{
     whole: 2, part: 0.25 }`, `h('whole') / h('part')` close to 3 and `(h('whole') + h('part')) / h('top')` to 1.
  2. *leaves the whole share to the region it is a part of while it is hidden*: after `hide()` with `{ whole: 1, part:
     0.25 }`, `h('whole') / h('top')` close to 0.5 and the boundaries `['top|whole', 'whole|last']`.
  3. *gives the whole share to either of the two open alone*: `b` closed (`userEvent.click(b.toggle)`), then `h('whole')
     / h('top')` close to 0.5; `b` opened and `a` closed, then `h('part') / h('top')` close to 0.5.
  4. *stores the sum and the part at a key on the boundary between the two*: `boundary(host, 'whole', 'part')` focused,
     `{ArrowDown}`; the last share stored has the keys `['part', 'whole']`, `whole` close to 1 (2 places), `part` above
     0, under 0.5 and close to `h('part') / (h('whole') + h('part'))` (2 places).
  5. *puts the split back as built at Enter on that boundary, keeping the whole's share*: a stack built with `{ whole: 2
     }`, `{ArrowDown}` on `boundary(host, 'whole', 'part')`, then `{Enter}`; the last share stored has `whole` close to 2
     (2 places) and no `part`, `h('whole')` and `h('part')` within 0.5px, and `(h('whole') + h('part')) / h('top')` close
     to 1 (2 places).
  6. *keeps the part's height at a key on a boundary beside one of the two, storing their sum and part*: `{ArrowDown}`
     on `boundary(host, 'top', 'whole')`; `h('part')` and `h('last')` within 0.5px of where they were; keys `['part',
     'top', 'whole']`; `whole × part` close to 0.5, the part's share before (2 places).
  7. *reads a stored part that is not between 0 and 1 as the part it is built with*: `{ part: 1.5 }` and `{ part: 1 }`,
     each with `h('whole')` and `h('part')` within 0.5px.
  8. *throws for a part of a region the stack does not hold*: a stack whose region has `partOf: 'nowhere'` throws with
     `nowhere` in its message.
  9. *puts back the region beside the part and the whole's share at Enter where the part is open alone, keeping the
     stored part*: a stack built with `{ part: 0.25 }`, `a` closed, `{ArrowDown}` on `boundary(host, 'top', 'part')`
     (precondition: the share it stored has the keys `['part', 'top', 'whole']` and `part` 0.25), then `{Enter}`; the
     last share stored is `{ part: 0.25 }`, and `h('part') / h('top')` close to 0.5 (2 places).
  10. *puts back the region beside the part and the whole's share at Enter on a boundary beside the part, keeping the
      split*: `{ArrowDown}` on `boundary(host, 'part', 'last')`, then `{Enter}`; the last share stored has the keys
      `['part']` and `part` as the key's commit stored it (above 0.5), `h('part') / (h('whole') + h('part'))` close to
      that part, and `(h('whole') + h('part')) / h('top')` and `h('last') / h('top')` close to 0.5 (2 places each).
- [ ] **Step 2: See them fail.** `BROWSER panel-stack-place` into `$L/03-red.log`: cases 1 and 3 to 10 fail (a part
  region is a region with a share of its own, 0.5, the two are not drawn even, a commit stores no part, nothing throws,
  and a reset deletes its two regions' names); case 2 passes at the base (the whole is all the region has) and is proven
  by P2.
- [ ] **Step 3: Build** `partOf` and the rules of *G1's mechanism* in `#share`, `#commit` and `#reset`, and the
  constructor's check. `StackRegion.partOf`'s doc says what it is and that `share` is then the part; the module doc's
  paragraph on what a drag stores says a pair stores its sum and part. `#reset` deletes the part's name alone on the
  boundary between a part and its whole (case 5), and on a boundary beside the pair the outside region's name and the
  whole's, never the part's (cases 9 and 10); `#begin`, `sync` and the maximise read `#share` and need no change.
- [ ] **Step 4: Green.** `AFFECTED` and `AFFECTED-FF` into `$L/03-*.log`: as Task 2's (no view sets `partOf` yet).
- [ ] **Step 5: Sabotages**, each on `panel-stack-place`. **P1**, `#share(P)` is `part(P)`, a share of its own: case 1
  fails. **P2**, `#share(W)` takes `1 − part(P)` whether `P` is open or not: cases 2 and 3 fail. **P3**, `#commit`
  stores `d` under the two names as before: cases 4 and 6 fail. **P4**, `part` without its range check: case 7 fails.
  **P5**, `#share(P)` is `own(W) × part(P)` with `W` closed too: case 3 fails. **P6**, a commit beside the pair stores
  `W.name: d(W) / (1 − part(P))` and keeps the stored part: case 6 fails. **P7**, `#reset` deletes both names on the
  boundary between the pair: case 5 fails. **P8**, `#reset` on a boundary beside the pair where the part is open alone
  deletes the part's name in place of the whole's: case 9 fails. **P9**, `#reset` on a boundary beside the part with the
  whole open deletes the part's name with the outside region's, as before: case 10 fails.
- [ ] **Step 6: Commit** the two files, after `TSC`, `LINT`, `COMMENTS`.

### Task 4: G1, the call stack's region in a narrow machine view

**Files:** modify `web/src/machine-row.ts` (all of it); `web/src/rxm-pane.ts:126-163`; `web/src/clif-pane.ts:149-180`;
`web/src/style.css` (`:2962-3054` and `:3203-3213`); `web/src/panel-stack.ts` (`:112-115`, `:279-304`); tests
`web/tests/browser/machine-views.ts`, `machine-row.test.ts`, `panel-boundaries.test.ts:615-631`,
`machine-row-app.test.ts`.

**Interfaces:**
- Consumes: Task 3's `StackRegion.partOf`; Task 1's `VIEWS`.
- Produces: `MachineRow.stackRegion: HTMLDivElement` (class `machine-stack`); `MachineRow.regions: readonly
  [StackRegion, StackRegion, StackRegion]`, named `machine` (built with the values alone), `stack` (`partOf: 'machine'`,
  `share: 0.5`, the call stack, labelled by its toggle's text) and `heap`; a row built in narrow. In `machine-views.ts`:
  `underBoundaries(host): string[]`, each boundary as `${above}|${below} ${gap}`, the gap in whole pixels between the
  boundary's bottom and its lower region's top (the copy case's `gaps`, moved there).

- [ ] **Step 1: The fixture.** `drawnAs` also holds the call stack's region: in wide and medium the call stack's parent
  is the row and `region(host, 'stack')` is hidden; in narrow its parent is that region, which is not. `underBoundaries`
  as above; the copy case uses it. With `drawnAs` so, the existing first-frame case and resize sweep hold the first
  design's §6.1 and §6.2 for every switch that moves the call stack.
- [ ] **Step 2: The changed cases** in `machine-row.test.ts`'s `describe.each(VIEWS)`:
  - *draws the regions and boundaries of each arrangement*: narrow draws `['listing|machine', 'machine|stack',
    'stack|heap']`, the stack's region shown (hidden in medium and wide), every header a handle; its narrow precondition
    reads `(height('machine') + height('stack')) / height('listing')`; its comment (`:149-150`) stops reasoning from
    `PanelStack`'s observer of the row's box, which this task removes.
  - renamed *names each boundary for the regions either side of it*: in narrow `listing|machine` is `resize listing and
    ${view.values}`, `machine|stack` is `resize ${view.values} and call stack`, `stack|heap` is `resize call stack and
    heap`; wide and medium as today.
  - *keeps a closed panel at its column…*: in narrow with the values closed, the boundaries `['listing|stack',
    'stack|heap']`, the values' box its header's height and the row's width, and the call stack's box starting its
    region's `marginBlockStart` (8px) under the values' box; the assertions on the row's `rowGap` and bottom go.
  - *gives a maximised panel in narrow all the spare height…*: with the call stack maximised, the values', the listing's
    and the heap's boxes their headers' heights, and the heap's box ending at the pane's body's bottom (1px).
  - *keeps the focus on the heap's toggle / maximise button across a move*: run for the call stack too, across narrow to
    medium and back, with `moveBefore` and with the fallback, each move's precondition the call stack's parent (its
    region in narrow, the row in medium).
  - the copy case (`describe('the rxm view')`): in narrow too, `['listing|machine', 'machine|stack', 'stack|heap',
    'heap|outline']` under the listing, each meeting its boundary.
- [ ] **Step 3: The new cases**, in the same `describe.each(VIEWS)`, each mounted 1600px tall; `h(n)` is `region(host,
  n).getBoundingClientRect().height`:
  1. *begins each region right under the boundary above it, in each arrangement*: wide, medium, narrow, each
     `underBoundaries(host)` all `… 0`.
  2. *splits the values and the call stack evenly with nothing stored, and gives the row in medium and wide the height
     the two had*: narrow, `|h('machine') − h('stack')| ≤ 0.5`; medium and wide, `h('machine') / h('listing')` close to
     the narrow `(h('machine') + h('stack')) / h('listing')` (2 places); in medium, the listing's and the heap's heights
     within the boundary's height (8px) of narrow's (in wide the heap's region is hidden and the listing takes its share
     too).
  3. *shows a workspace stored before the call stack had a region as it did*: sizes `{ listing: 2.5, machine: 1.1, heap:
     1.3 }`; narrow, precondition the values' and the call stack's bodies each over its `min-height`, then
     `|h('machine') − h('stack')| ≤ 0.5` and `(h('machine') + h('stack')) / h('listing')` close to `1.1 / 2.5`; medium,
     `h('machine') / h('listing')` close to `1.1 / 2.5` and `h('heap') / h('listing')` to `1.3 / 2.5`; wide,
     `h('machine') / h('listing')` close to `1.1 / 2.5` (2 places each). Not `machine: 0.7`: at 1600px that draws each
     of the two at 119px in narrow, under the 123px floor of five rows they had until `05eaa28`.
  4. *stores the split a key on the boundary between the values and the call stack sets, and draws it again after medium
     and wide*: narrow, `boundary(host, 'machine', 'stack')` focused, `{ArrowDown}` twice (a third took the call stack
     to the floor of five rows it had until `05eaa28`); the last stored has the keys `['machine', 'stack']`, `machine`
     close to 1 (2 places), `stack` above 0 and under 0.5 and close to `h('stack') / (h('machine') + h('stack'))`;
     blurred, then medium, wide and narrow again: that ratio close to `stack` (2 places), and `sizes` called no more (a
     switch stores nothing).
  5. *splits a row dragged in medium by the stored part when narrow again*: medium, sizes `{ stack: 0.4 }`,
     `{ArrowDown}` on `listing|machine`; the stored `stack` still 0.4; narrow, precondition the call stack's body over
     its `min-height`, then `h('stack') / (h('machine') + h('stack'))` close to 0.4 and `(h('machine') + h('stack')) /
     h('listing')` close to `machine / listing` as stored (2 places). Not 0.25: in narrow that draws the call stack at
     88px, under the floor of five rows it had until `05eaa28`.
  6. *gives the open one of the values and the call stack the row's whole share in narrow*: narrow, sizes `{ stack: 0.25
     }`; the call stack closed, boundaries `['listing|machine', 'machine|heap']`, the call stack's box its header's
     height, `h('machine') / h('listing')` close to 0.5; opened, and the values closed, boundaries `['listing|stack',
     'stack|heap']` and `h('stack') / h('listing')` close to 0.5.
  7. *hands a focused boundary above the call stack that a switch takes away to the call stack's toggle*: from narrow,
     `machine|stack` focused, to medium; again, to wide in one resize; `stack|heap` focused, to medium, which gives the
     heap's toggle; the values closed and `listing|stack` focused, to medium. Each asserts first that the boundary has
     left the page, then `document.activeElement`.
  8. *makes no switch while the boundary between the values and the call stack is held, and stores the split once at its
     release*: narrow, `machine|stack` focused, `{ArrowDown>}`, resized to medium: narrow and drawn narrow;
     `{/ArrowDown}`, two frames: `sizes` called once, with `machine` and `stack`, and medium drawn medium.
  9. *keeps a maximised call stack across a switch out of narrow and back*: maximised in narrow; medium, still pressed,
     the values' box its header's height and the call stack's box the row's height (1px); narrow, still pressed, the
     values' box its header's height.

  In `panel-boundaries.test.ts`, the case at `:619` becomes *in a narrow view, is the call stack's: it drags the
  boundary between the registers and the call stack* (`mount({ width: 420, height: 1600 })`): the call stack's header is
  a handle; precondition, the registers' body is over its floor by more than 40px; `drag(host, header(host, 'stack'),
  -40)`; `machine` 40px shorter and `stack` 40px taller (0 places), the listing and the heap unchanged (0 places); the
  last stored has the keys `['machine', 'stack']`, `machine` close to 1 (2 places) and `stack` close to the drawn ratio.

  In `machine-row-app.test.ts`, `describe('the rxm view in the app')`: *stores the split of its registers and call stack
  in the workspace, narrow beside the source*: `sourceAlone(1024)`, `page.viewport(1024, 1600)`, `pressToggle('rxm')`,
  `holds(MACHINES[1], 'narrow', …)`; `boundary(viewOf(MACHINES[1]), 'machine', 'stack')` focused, `{ArrowDown}`;
  precondition, the call stack's region is shorter; `storedLayout<{ panelSizes?: Record<string, Record<string, number>>
  }>().panelSizes?.['rxm-0']` has `stack` above 0 and under 0.5 and `machine` close to 1 (2 places).
- [ ] **Step 4: See them fail.** `BROWSER machine-row panel-boundaries machine-row-app` into `$L/04-red.log`: every case
  that reaches narrow fails, the call stack being in the row there, among them `drawnAs`'s narrow in *switches at each
  threshold…*, the first-frame case and the call stack's runs of the focus cases (by their parent precondition), but for
  two that pass at the base and are proven by their sabotages: new case 1 (no call stack's region yet, so every boundary
  drawn already meets its region; M4a-M4c) and new case 9 (today's column keeps a maximised call stack across a switch;
  M9). M10 proves the focus the call stack's runs hold. Record the failing names.
- [ ] **Step 5: Build.**
  - `machine-row.ts`: `stackRegion` and the three regions above; the constructor builds narrow (the row holds the
    values, each other panel its region, none hidden; `#arrangement` starts `'narrow'`), its doc saying why; `#inRow` is
    the values in narrow, the values and the call stack in medium, all three in wide; the row's label names what it
    holds ("a", "a and b", "a, b and c"). `#apply` puts the call stack in the row in medium and wide and the heap in
    wide, moving into the row the call stack before the heap, showing a region before its panel moves into it and hiding
    it after its panel leaves, then `place` for each panel moved; the medium-narrow `sync`-only branch goes, every
    switch now moving a panel. A focused boundary the switch took off the page hands the focus to the call stack's
    toggle where its `data-below` was `stack`, else to the heap's. The class doc and the `regions` doc say what holds
    what.
  - The panes append `row.el, row.stackRegion, row.heapRegion` (the rxm view before `this.copy.outline`); their comments
    stop saying no boundary parts the row's panels.
  - `style.css`: `.machine-stack` takes every rule `.machine-heap` has (its display guarded by `:not([hidden])`, the
    share rule under `.rxm-pane >` and `.clif-pane >`, its margin, its panel's margin and flex). A region under a
    boundary begins at it across a hidden call stack's region, and on a copy across both hidden regions to the outline:
    beside the adjacency rules at `:3208-3213`, `.panel-boundary + .machine-stack`, a rule across a hidden
    `.machine-stack` to `.machine-heap`, and one across both hidden regions to the copy's outline, which replaces
    `:3211` (with the call stack's region between the row and the heap's, `:3211` can never match); Biome's
    `noDescendingSpecificity` decides where they sit. The narrow column's rules (`:3024-3026`, `:3044-3046`,
    `:3052-3054`) and the row's `row-gap` go; the closed-panel rule holds in every arrangement. The comments at
    `:2962-2968`, `:3014-3016` and `:3035-3038` say what is now true.
  - `panel-stack.ts`: the constructor's per-region `ResizeObserver` and `#atTop` go; `#syncHandles` marks a header a
    handle wherever its region has a boundary above it.
- [ ] **Step 6: Green.** `AFFECTED` and `AFFECTED-FF` into `$L/04-*.log`: Chromium, scroll bars and node exit 0; Firefox
  Task 0's failures and no other. A case outside this task's files that fails only because narrow has four regions now
  is changed to say so, and named in the report with the reason; any other failure is a finding.
- [ ] **Step 7: Sabotages.** **M1**, `#apply` keeps the call stack in the row in narrow: *draws the regions and
  boundaries…* and *switches at each threshold…* fail (`machine-row`). **M2**, the focus always to the heap's toggle:
  new case 7 fails. **M3**, the `stack` region without `partOf`: new cases 2, 3 and 4 fail, and the `panel-boundaries`
  and `machine-row-app` cases (run all three files). **M4a**, the rule `.panel-boundary + .machine-stack` removed: new
  case 1 (narrow) fails. **M4b**, the rule across a hidden call stack's region to the heap's removed: new case 1
  (medium) and the copy case (medium) fail. **M4c**, the rule across both hidden regions to the copy's outline removed:
  the copy case (wide) fails. **M5**, the row's label in narrow names the call stack too: the names case fails. **M6**,
  `#apply` moves the heap into the row before the call stack: the first-frame case fails (built narrow, wide at once).
  **M7**, `.machine-stack` loses its share rule: new cases 2 and 3 fail. **M8**, the `stack` region built with no
  panels: the `panel-boundaries` case fails (no handle). **M9**, `#apply` calls `stack.unmaximise()` before it moves a
  panel: new case 9 fails at the maximise still pressed. **M10**, `#apply` moves the call stack by `append` in place of
  `moveInto`: the call stack's four runs of *keeps the focus on the heap's toggle / maximise button across a move* fail.
- [ ] **Step 8: Commit** the task's files, after `TSC`, `LINT`, `COMMENTS`.

### Task 5: The full gate, before review

**Files:** none unless a leg fails. One agent, with no other browser run on the machine.

- [ ] The web job as CI runs it, from `$W/web` with `CARGO_TARGET_DIR=$T`: `pnpm run build:wasm`, `build:lsp-wasm`,
  `build:clif-wasm`, `build:bindings`, `../scripts/check-licences.sh --self-test` and then alone, `LINT`, `TSC`, `pnpm
  run test:coverage`, `pnpm run build:app`, each into `$L/05-<leg>.log`. `test:coverage` runs under the browser lock,
  the port wait inside it, and a memory cap, in a transient unit: `flock /home/davey/temp/redextape-browser.lock
  systemd-run --user --wait -p MemoryMax=16G -p MemorySwapMax=0` with `--setenv` for `PATH`, `HOME`, `CARGO_HOME`,
  `RUSTUP_HOME`, `CARGO_TARGET_DIR` and `VITEST_MAX_WORKERS=4`. Expected: exit 0 each, the coverage thresholds met.
- [ ] From `$W`: `scripts/check-all.sh`; `cargo llvm-cov nextest --workspace --fail-under-lines 90`;
  `scripts/check-slow.sh`; each scan `rg -o 'scripts/check-[a-z-]+\.(sh|mjs)' .forgejo/workflows/ci.yml | sort -u`
  lists, with `--self-test` and then alone. The Rust legs prove the toolchain, not this change; they run all the same.
- [ ] `AFFECTED-FF` once more at the head: Task 0's failures and no other.
- [ ] **By hand in Firefox** (the design's constraint), driven as the first pass was, by a Playwright Firefox script on
  the built app (`pnpm run build:app`, `vite preview` in `$W/web`; `$R/impl/hand/drive.mjs` the model), screenshots into
  `$L/hand/`: in each view, at a window that makes it narrow beside the source, a drag of the call stack's header and a
  key on the new boundary, then a window wide enough for medium and back, the split the same before and after; and the
  focus on the new boundary across a switch. Davey tries the branch in Firefox before giving the word to push.
- [ ] A leg that fails is fixed in a commit of its own, test first, and the legs its files feed run again.

### Task 6: Docs, the design as built, the roadmap entry

**Files:** modify `docs/superpowers/specs/2026-11-21-machine-panels-row-design.md` (§11),
`docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the `panels-row` entry from line 39160); `web/help.html` only
if the search finds a stale line.

- [ ] **User docs.** Search `web/*.html`, `README.md` and `docs/*.md` for *boundary*, *call stack*, *registers*,
  *values* and *panel*; `help.html`'s "the lower panel's header" is true of the new boundary too. Change a line only
  where it has become false, and report what the search found.
- [ ] **Comments.** No comment in `web/src`, `web/tests` or the stylesheet's machine rules still says the narrow row is
  a column, that the row holds the call stack in narrow, that no boundary parts the row's panels, that `PanelStack`
  observes a region's box, or that the gap is 1rem.
- [ ] **§11 As built** gains a paragraph for these commits: this plan's path and the commit range, and one line each for
  §5.1 (the thresholds now 880 and 584px, 606 and 362px, the gap 8px; the app's table unchanged), §5.2 and §5.3
  (narrow's four regions, the `stack` part, either one open alone taking the row's share, the focus rule, the row built
  in narrow, the observer and `#atTop` gone), §5.5 (a count centred on its buttons), and anything the tasks reported.
  Change no other section, and nothing in the after-the-try design unless the build differs from it, in which case it
  gains an *As built* line.
- [ ] **The roadmap entry** is brought up to these commits in its own shape: its heading's range and count; what changed
  for a person using the views; the sabotage table gains A1-A3, C1, P1-P9 and M1-M10 (M4 as M4a-M4c) with the cases each
  failed and its log; *WHAT THIS DID NOT CLOSE* updated; in *VERIFICATION*, every row whose figure changed (the
  thresholds, the gap, the headers' widths, the sabotage counts) re-pointed and every command run again after the last
  code commit. Write values and SHAs, not "the only" or "all".
- [ ] Commit the design and the entry together.

### Task 7: Whole-branch review of these commits

**Files:** none. A fresh reviewer, given the design, this plan and `git diff 5eed000..HEAD`, not the task reports.

- [ ] Review the commits as one change. Beyond the diff: every reader of `StackRegion`, `[data-region]`,
  `.machine-heap`, `.machine-stack`, `heapRegion`, `.panel-note` and `.panel-actions` in `web/src` and `web/tests` that
  no task touched; each anti-goal of the design against a test that would fail if it broke; the first design's
  §6.1-§6.10 for a switch between narrow and medium; each sabotage log in `$L`; this plan's Review Focus against its
  tests; every comment these commits add, for why only; the roadmap entry's claims against the commands beside them.
  Findings go to `$L/review.md`, each with a severity, the file and the symbol.

### Task 8: Fix what the review found, and the gate again

**Files:** as the findings need.

- [ ] Each finding is checked before it is acted on: a finding is a claim. One that holds is fixed test first, in a
  commit of its own, with a sabotage where it adds a test, and its class is searched for siblings. One that does not
  hold is answered in `$L/review.md` with the evidence.
- [ ] Then Task 5 again for every leg the fixes' files feed (all of the web job if any file under `web/` changed) and
  `AFFECTED-FF`, and a last commit that brings the roadmap entry and §11 up to the fixes, its figures run again.
- [ ] Report the head SHA and the tallies. **Stop there**: pushing and opening the pull request wait for Davey's word.
