# Remove `+ view` — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app header loses `+ view` and the code that exists only for it, and in a window 40rem wide or narrower
the view toggles show in the workspace menu as its first group, named `show`, acting there as they do in the
header, a toggle that holds the focus as the window narrows handing it to the workspace button (the design's G1-G5).

**Architecture:** One set of toggles, moved. `main.ts`'s `placeToggles` puts `#views-shown` first in
`#workspace-menu` where `NARROW_WINDOW` matches, and back after the menu in the header where it does not, so the
buttons, their pressed state, tooltips, `aria-disabled` and the CLIF intent listener are the header's own elements
wherever they stand; `workspaceItems` rebuilds the menu around the group and never detaches it. The tests that press
`+ view` then move to a split or a toggle, file group by file group, while `+ view` still exists, so every commit is
green. Only then do the button, its menu, `addViewItems`, `PaneHost.addView`, the `'view'` gesture, `insertBeside`
and `insert`'s equal share go, with their node tests.

**Tech Stack:** TypeScript, Vite, Vitest 4 (browser on Playwright, Chromium and Firefox), Biome. No Rust changes.

**Spec:** `docs/superpowers/specs/2026-11-23-remove-plus-view-design.md` (*the design*). `$R/survey.md` (*the
survey*) is the inventory it rests on; its line numbers were leads, and every line this plan cites was read at
`798fa38`.

## Execution notes

- **Paths.** `W=/home/davey/temp/redextape-remove-plus-view` (branch `remove-plus-view` on `b32af3d`, this plan's
  commit the first on it, not pushed); `R=/home/davey/temp/redextape-remove-plus-view-record` (ledger
  `progress.md`); `L=$R/impl` (every log, probe, sabotage driver and saved copy, commit message file and report;
  never the worktree); `T=/home/davey/.cache/redextape-remove-plus-view-target` (`export CARGO_TARGET_DIR=$T` in
  every shell that runs cargo, wasm-pack, `pnpm run typecheck` or `git commit`). The main checkout,
  `/home/davey/projects/redextape`, is read and never written.
- **The worktree.** `web/node_modules` is a copy, not a symlink, and stays one. `pkg/`, `pkg-lsp/`, `pkg-clif/` and
  `web/bindings/` are built from `main`'s Rust, which this lane does not change; a task rebuilds one only if it is
  missing or a symlink.
- **No dev server serves `$W`**, since the sabotages edit it, and no task starts one (`ss -ltnp | grep 5173` and
  that process's cwd say which checkout one serves).
- **One committing agent in `$W` at a time** (the pre-commit hook runs over the whole tree). No task pushes or opens
  a pull request: Davey gives that word, after Task 11.
- **Line references are at `798fa38`.** Once an earlier task or step has edited a file, find the place by name.
- **`$R/plan-common.md` is this plan's head**, from the title to the rule before Task 1. A task's dispatch is that
  file and the task.

## Global Constraints

- **The design, verbatim.** G1: "`+ view` is gone: the button and its menu, and the code that exists only for it
  (survey §2): `addViewItems`, `PaneHost.addView`, the `'view'` member of `AddRefused.gesture` and its notice,
  `insertBeside`, `insert`'s equal-share branch, its CSS, and the comments that describe it. Code it shares with
  splits and the other menus stays." G2: "In a window 40rem wide or narrower, the view toggles show in the workspace
  menu (`#workspace-menu`) as a group named "show" instead of being hidden. They act exactly as the header's
  toggles do: the same press, the same pressed state, the same intent load of the clif package on the clif toggle.
  In a wider window the toggles stay in the header and the workspace menu does not show them. The menu's
  `tiles`/`stage` row keeps its name, "views". The group's name is its one `aria-label`, so it is "show" in the
  header as well." G3: "A toggle that holds the focus when the window narrows hands the focus to the workspace
  menu's button (`#workspace`)". G4: "Share
  links, stored workspaces and remembered arrangements that hold duplicate views load as they do today." G5:
  "`help.html` and the view-layouts spec (§6.1, and §16.3 item 1 marked answered by the user on 2026-11-23)
  describe what changed; the roadmap entry says what was removed and what it cost."
- **Its non-goals.** Splits (still halving, still off on the Stage and on the source view), the view keys, the
  toggles in a wide window, a view's title menu and `copies ▾` do not change. Nothing replaces a duplicate view on
  the Stage, a copy as an extra Stage tab, or an add beside the source view; the equal-share add goes. The toggles
  do not move into the workspace menu in a wide window.
- **What the design left to the builder, settled here** (the plan's rulings; the roadmap entry says each):
  - **One set of buttons, moved**, not a second set kept in step: the elements are the header's, so G2's "exactly
    as" holds by identity, and the CLIF intent listener (`watchIntent`, `main.ts:1835`) goes with its button.
  - **First in the menu**, above the presets, as the group follows the workspace button in the header. `wireMenu`
    (`app-header.ts:20-30`) then autofocuses the `source` toggle when the menu opens in a narrow window.
  - **A press on a toggle in the menu leaves it open**, as a pick of a preset or a switch does (the menu is filled
    again under the user's hand, `main.ts:1706-1710`); *reset preset*, which rebuilds the page, is the one item
    that closes it. Confirmed by the user on 2026-11-23 (the design's *Decided*).
  - **A toggle holding the focus in the menu when the window widens keeps it**: the same button, now in the
    header, is focused again after the move. Chromium blurs an element as it is disconnected and Firefox does not
    (the design's *Left to the builder*), so the re-focus is explicit and holds in both.
  - **A Stage test that needs a second view of a kind, or a copy's view as a second tab, builds it in tiles with a
    split and then switches to the Stage** (a preset or the `views` switch in the workspace menu). A toggle cannot
    build either: it shows its combination's remembered arrangement, or a default of one view a kind
    (`main.ts:1801-1813`). Confirmed by the user on 2026-11-23 (the design's *Decided*).
  - **`admit`'s Stage line (`pane-host.ts:786`) stays**: `admit` is shared with the split, and the design keeps
    shared code. **`insert` stays `splitLeaf`'s body**, without its `share` parameter and without the subject check
    `splitLeaf` makes before calling it.
  - **The other specs that name `+ view` are records and stay as written**; the view-layouts spec gains a section
    saying which of its own lines describe the app before this change (Task 7).
- **Commands** (notation used below). Each run writes `>| $L/<task>-<what>.log 2>&1` and is followed by `print $?`;
  tallies are read with `grep -aE 'Test Files|Tests |FAIL|×'`. zsh has `noclobber`, hence `>|`. Never pipe a run
  through `tail`: it hides the exit status. All from `$W/web` unless said.
  - `BROWSER files…`: `flock /home/davey/temp/redextape-browser.lock zsh -c 'until ! ss -ltn | grep -q ":63315 ";
    do sleep 5; done; VITEST_MAX_WORKERS=4 pnpm exec vitest run --project browser "$@"' _ <paths>`. The wait for
    port 63315 (another project's vitest uses it) runs inside the lock. Paths are positional
    (`tests/browser/x.test.ts`): `pnpm test:browser -- name` does not scope, and `--maxWorkers` does not reach the
    browser projects.
  - `FIREFOX files…`: the same with `REDEXTAPE_FIREFOX=1` and `--project firefox --project firefox-capture`.
  - `NODE files…`: `pnpm exec vitest run --project node <paths>` (no paths: the whole node tier); no lock.
  - `TSC`: `CARGO_TARGET_DIR=$T pnpm run typecheck`. `LINT`: `pnpm exec biome ci --error-on-warnings`. `COMMENTS`:
    `node scripts/check-comments.mjs --base 798fa38` from `$W`.
- **Chromium is the gate; Firefox is compared against a baseline.** Each task's Step 0 runs its files in both
  engines at the commit the task starts from. A Firefox failure in that baseline that the task did not cause is
  reported, not fixed; one the task caused is fixed.
- **Test first.** A task writes its new cases, runs them to see them fail for the reason it names, then builds. **A
  moved case cannot fail first**: it holds behaviour that is there. It runs green at the task's start on its old
  setup and green after on its new one, and its sabotage, run on the new setup, shows the setup still reaches what
  the case holds. Where a task's table says *from its doc*, the implementer picks the one `web/src` edit that takes
  away what the case's doc says it holds, and the driver and the report name the edit and the assertion it fired at.
- **Sabotage.** Save a copy (`cp <file> $L/sab/<id>.orig`), make the one edit named, run the named files into
  `$L/<task>-sab-<id>.log`, copy the file back, `cmp` it. **Never `git checkout`**. One driver script a task, kept in
  `$L` (`/home/davey/temp/redextape-panels-row-record/impl2/08-sab-driver.mjs` is the model), one browser run a
  sabotage, in Chromium unless its line names Firefox. Each names the cases that must fail and where; **a sabotage
  that does not fire, or fires at another assertion, is a finding: stop and report**. A case stops at its first
  failed hard assertion, so the log is read for the assertion it failed at.
- **Commits.** One per task: `cd $W && export CARGO_TARGET_DIR=$T && git add <the task's files> && git commit -F
  $L/<task>-commit-msg.txt`. The hook runs the tree-wide scans (the comment guard and the licences check among
  them), and `biome ci` and `pnpm run typecheck` when `web/` files are staged. Never `--no-verify`, never
  `--amend`. The message is one long plain sentence saying what the commit holds, as `git log --oneline -5` shows.
  If the comment guard reports a budget, cut the comment to its why first; only if it is still over, write the value
  it prints into `scripts/comment-budget.json` in that commit and say so.
- **Copy and code.** "redextape" is lowercase in prose; spelling is British; no attribution to a person or a tool
  anywhere in the tree. Doc comments are `/** */`. **A comment says why**: the reason, the invariant, what breaks if
  it changes. No history (what the code did before, that `+ view` existed, a decision's date or who made it), no
  measurement, no `file:line`; a comment may point at the design. A comment this plan edits that carries such a
  clause loses it. Wrapped at 120 columns. No test's name or message says whose decision a behaviour was. **Each
  task puts right the `+ view` words in every file it edits**; Task 7 sweeps what is left.
- **Browser tests.** A claim about what a person sees asserts geometry or computed style; an attribute
  (`aria-pressed`, `aria-disabled`, `:popover-open`) may be asserted; never `textContent` alone. A new case presses
  with `userEvent` (`.click`, `.keyboard`, `.hover`). **A moved case splits as its file arranges**: a file that
  pressed `+ view` with `userEvent` or `press` splits with `userSplit` (Task 2), and one that pressed it with
  `.click()` splits with `splitVia` (`harness.ts:900-923`). A probe prints with `console.error` and is gone before
  the commit.

## Review Focus

Inputs the design implies and no case of today exercises, most likely first. Each has its case in the task named.

1. **A phone on the Stage, or with the source view alone.** They were the two states where `+ view` was the one
   pointer road (the survey §1); the menu's toggles must bring views back in both. Task 1, M3 and M4.
2. **The window crossing 40rem with the workspace menu open.** The toggles join or leave an open menu, inside its
   box, and the rest of it stays. Task 1, M7.
3. **A focused toggle as the window narrows or widens, in both engines.** The focus lands on `#workspace` going
   narrow and stays on the toggle going wide. Task 1, F1 and M6, each run in Firefox too.
4. **A keyboard user in the narrow menu.** `Enter` on a toggle there changes the views, and the focus and the menu
   stay. Task 1, M2's keyboard half.
5. **A stored workspace, arrangement or link holding duplicates or `+ view`'s equal-share row.** Nothing in the
   parse changes (the survey §5); a node case holds such a tree read back as stored. Task 6, R2 and R3.

## Verified facts (at `798fa38`)

- **The narrow window.** `placeToggles` (`main.ts:1844-1851`) hands a focused toggle to `nearest(header,
  viewsShown)`, which walks forward first (`focus-handoff.ts:105-112`) and so reaches `+ view`, and sets
  `viewsShown.hidden`. `style.css:318-336` honours the attribute and hides `.views-shown` at `(max-width: 40rem)`
  for the paint before `main.ts` runs. `NARROW_WINDOW_REM` and `NARROW_WINDOW` (`app-header.ts:249-260`) are the
  width; `tests/node/app-header.test.ts:91-111` holds the rule's text and the help page's sentence
  (`web/help.html:49-51`) to it; `view-toggles-narrow.test.ts`, `view-toggles-first-paint.test.ts:114-119` and
  `view-keys-focus.test.ts:37`, `:139-160` hold the attribute.
- **The group.** `#views-shown` (`index.html:26-28`) is `div.views-shown`, `role="group"`, `aria-label="views"`,
  right after `#workspace-menu` (`:23-25`). `view-toggle-markup.ts` writes its buttons into the page and
  `viewToggles` (`app-header.ts:290-318`) adopts them and updates them in place; the harness's `toggle(kind)`
  (`harness.ts:499-500`) finds them by `#views-shown` wherever the group is.
- **The workspace menu.** `wireMenu` fills it on `beforetoggle` and autofocuses its first `a[href],
  button:not([disabled]), select`. `workspaceItems` (`app-header.ts:146-247`) runs on open and again on each pick
  with the menu open (`main.ts:1688-1703`, `:1706-1710`): it `replaceChildren`s the presets and the switches,
  appends `#reset-preset` while the workspace is a preset, and puts the focus back by `data-preset`,
  `data-switch`/`data-value` or id, else on the first button. Its groups are `.menu-group` rows whose label is drawn
  from `aria-label` (`style.css:405-447`), wrapping in `#workspace-menu` (`:452-458`). It already holds a row named
  `views`, the `tiles`/`stage` switch (`SWITCH_ROWS`, `app-header.ts:128-135`), which is why the toggles' group
  is named `show` (the design's G2).
- **The split.** `pane-host.ts`'s `split` (`:854-879`) asks `admit` (`:774-795`), mints an id, records the pick's
  binding, applies the layout, focuses the new view and says `view added — …`. `splitLeaf` (`layout.ts:337-342`)
  puts the new leaf right after its subject in `leaves()` order, as `insertBeside` did, and halves the subject; it
  refuses the source view as its subject, and the Stage offers no split (`draw.ts:277-285`).
- **The controls gate** runs in the runner's 414 px window, so its *with each header menu open*
  (`controls-gate.test.ts:240`) opens the workspace menu where the toggles will be.

## The deleted-symbol sweep (at `798fa38`)

Every reference to a symbol the removal deletes, and the task that takes it. `rg` over `web/`, `scripts/` and
`.forgejo/`; `docs/` holds records only (Task 7 and the rulings above).

| Symbol | References | Task |
|---|---|---|
| `#new-view`, `#new-view-menu` | `index.html:29-30`; `style.css:245`, `:516-527`; `main.ts:248-249`, `:300-301`, `:1528`, `:2030`; `harness.ts:49-50` (`SHELL`), `:1183`; `user-event-fixture.ts:38-40`; node `harness.test.ts:14`, `:33`, `:36-37`; `edge-spacing.test.ts:429`, `:614`; `controls-gate.test.ts:243`; `view-toggles-first-paint.test.ts:44` | 6 |
| the same, pressed or read by a case | `view-keys-focus.test.ts:142` | 1 |
| | `add-view-floor.test.ts:177` | 2 |
| | `parked-copy-editor` `:95-96`, `parked-copy-editor-mount` `:57-59`, `parked-copy-undo` `:125-126`, `parked-view-replaced` `:61`, `one-id-two-kinds` `:268`, `one-id-two-kinds-stored` `:182`, `bindings-stored` `:141-142`, `copy-editor-mount` `:68-69`, `scroll-kept-moved-editor` `:38-39`, `share-open-hashchange` `:87-89`, `:170-173` | 3 |
| | `stage` `:263-264`, `stage-gestures` `:64-68`, `stage-copy-editor` `:94-95` | 4 |
| | `app-header` `:30-31`, `:69-74`; `menu-focus` `:94`, `:139`, `:158`; `view-keys-popovers` `:79`, `:191`, `:210`; `first-load-views` `:156`, `:164`, `:192-193`; `clif-shown` `:133-135`; `scroll-kept` `:159-160`; `share-positions` `:209-212`; `source-close-remembered` `:42-43`; `view-toggles-two-of-a-kind` `:36-37` | 5 |
| `addViewItems` | `app-header.ts:38-66`; `main.ts:7`, `:2021`; `pane-chrome.ts:317` (comment) | 6 |
| `addViewButton`, `addViewMenu`, `fillAddViewMenu` | `main.ts` only (the lines of the first row) | 6 |
| `PaneHost.addView` | `pane-host.ts:128-134`, `:1817-1828`; `main.ts:2026-2027`; comments `pane-host.ts:632`, `:744`, `:912`; `live-views-bound.test.ts:155` (Task 2) | 6 |
| the `'view'` gesture and its notice | `pane-host.ts:147-152`, `:1821`; `main.ts:1147`; `add-view-floor.test.ts:67` (Task 2) | 6 |
| `insertBeside` and `insert`'s `share` | `layout.ts:236-293`, `:330`, `:341`, `:598`, `:640`; `pane-host.ts:11`, `:129`, `:1821`, `:1824`; `harness.ts:6`, `:1203`; node `layout.test.ts:9` and its cases, `arrangements.test.ts:20`, `:58`, `:115`, `:412`; comments `workspace-bound.test.ts:11`, `view-menu.test.ts:89` | 6 |
| `pressedLayout` | `harness.ts:1198-1207`; node `layout.test.ts:29`, `:1054-1062`; `workspace-bound.test.ts:4`, `:20` | 6 |
| `newLambdaViewItem` | `harness.ts:1181-1185`; its three callers (Task 3) | 6 |
| `plusView` | `user-event-fixture.ts:33-43`; `add-view-floor`, `live-views-bound` (Task 2) | 6 |
| `+ view` in `web/src` comments and pages | `main.ts:198`, `:1083`, `:1100`, `:1399`, `:1521-1528`, `:1829`, `:2018`, `:2193`; `app-header.ts:9`, `:39-40`; `pane-host.ts:129`, `:149`, `:445`, `:1198`, `:1465`, `:1689-1690`; `draw.ts:279`; `layout.ts:277`, `:333`, `:509`, `:603` | 6 |
| | `main.ts:1836-1843`; `help.html:51` | 1 |

**Stays** (shared, the survey §2 checked): `wireMenu`, `pairLabel`, `bindingKey`, `PaneChoice`, `SplitChoices` (its
`current: null` is the panes' first value), `admit`, `addRefusal`, `holdsMostLeaves`, the `added` event and its
notice, `nextLeafId`, `seedLeafCounter`, `MAX_TREE_LEAVES`, `splitLeaf`, `DIVIDER_PX` (`layout-view.ts:22`'s claim
stays true: Task 2 keeps `add-view-floor`'s divider measurement). `controls-gate.test.ts`'s `+` exception stays for
the example titled `let x = 40; x + 2`; only its reason changes.

## File structure

| File | Change |
|---|---|
| `web/src/main.ts` | Task 1: `placeToggles` moves the group, `fillWorkspaceMenu` hands it over. Task 6: `+ view`'s wiring, its refill in `applied`, the `'view'` notice, comments |
| `web/src/app-header.ts` | Task 1: `workspaceItems` keeps the group; `NARROW_WINDOW`'s doc. Task 6: `addViewItems`, the module doc |
| `web/src/style.css` | Task 1: the narrow rules; the menu row. Task 6: `#new-view`'s chrome and gutter |
| `web/help.html` | Task 1: the narrow window's sentence |
| `web/index.html` | Task 1: the group's `aria-label`. Task 6: `+ view`'s markup |
| `web/src/pane-host.ts`, `layout.ts`, `draw.ts`, `pane-chrome.ts` | Task 6 |
| `web/tests/browser/user-event-fixture.ts` | Task 2: `userSplit`. Task 6: `plusView` out |
| `web/tests/browser/harness.ts` | Task 1: `SHELL`'s `aria-label`, a comment. Task 6: `SHELL`, `newLambdaViewItem`, `pressedLayout`, the `insertBeside` import |
| `web/tests/browser/clif-fetch-menu.test.ts` | Task 1: new |
| other test files | as each task's table says |
| `docs/superpowers/specs/2026-10-11-view-layouts-design.md` | Task 7 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | Task 9 |

## Design coverage

| The design | Where |
|---|---|
| G1: the button, its menu and the code only it used | Task 6, after Tasks 2-5 have moved every case off it; Task 7's words |
| G2: the toggles in the workspace menu at 40rem or narrower, acting as in the header; none in a wider menu | Task 1: E1, M1-M5, M7, C1, G1 |
| G3: a focused toggle hands the focus to `#workspace` | Task 1: F1 (and M6, the widening the plan rules on) |
| G4: stored and linked duplicates load as today | Task 6: R2, R3; no parse code changes |
| G5: help page, spec, roadmap | Task 1 (`help.html`), Task 7 (the spec), Task 9 (the roadmap) |
| Non-goals | the split's cases kept and moved onto (Tasks 2-5); the wide toggles' files run in Task 1's `AFFECTED-1` |
| Left to the builder | *Global Constraints*' rulings; which press closes the menu is M2 |

## Open, for Davey

None. Decided by the user on 2026-11-23: the toggles' group is named `show`, so the narrow menu has no two rows named
`views`; the `tiles`/`stage` row (`SWITCH_ROWS`) keeps `views` (the design's G2, Task 1).

---

### Task 1: The toggles in the workspace menu in a narrow window, and the focus they hand on

**Files:**
- Modify: `web/src/main.ts:1688-1703` (`fillWorkspaceMenu`), `:1836-1851` (the comment and `placeToggles`);
  `web/src/app-header.ts:146-247` (`workspaceItems` and its doc), `:249-258` (`NARROW_WINDOW`'s doc);
  `web/src/style.css:318-336` (the narrow rules and their comment), `:405-458` (the menu rows); `web/help.html:49-51`;
  `web/index.html:26` (the group's `aria-label`); `web/tests/browser/harness.ts:46` (`SHELL`'s copy of it),
  `:1345-1347` (a comment)
- Create: `web/tests/browser/clif-fetch-menu.test.ts`
- Test: `web/tests/browser/view-toggles-narrow.test.ts` (rewritten), `view-keys-focus.test.ts`,
  `view-toggles-first-paint.test.ts`, `controls-gate.test.ts`; `web/tests/node/app-header.test.ts`

**Interfaces:**
- Produces: `workspaceItems(menu, state: { switches: Switches; reset: HTMLButtonElement; views: HTMLElement }, on)`.
  `views` is the toggles' group, `#views-shown`. The rebuild removes every child of `menu` but `views` and
  appends the presets, the
  switches and *reset preset* after it; it takes the focus's identity only from an item it removed, so a focus inside
  `views` stays where it is. It never puts `views` into the menu: `placeToggles` alone moves it.

**`AFFECTED-1`**: `BROWSER` on `view-toggles-narrow`, `view-keys-focus`, `view-toggles-first-paint`, `clif-fetch-menu`
(from Step 1), `clif-fetch`, `clif-fetch-rest`, `clif-fetch-focus`, `controls-gate`, `header-menus-narrow`,
`edge-spacing`, `inspector-phone`, `first-load-views`, `first-load-views-tall`, `menu-focus`, `view-keys-popovers`,
`view-keys`, `focus-press`, `view-toggle-tooltips`, `view-toggle-focus-ring`, `clif-header`, `app-header`,
`live-views-bound`, `live-views-bound-switch` (each `tests/browser/<name>.test.ts`), and the files that open the
workspace menu in the runner's 414 px window and no task edits: `parked-view-surfaces`, `hidden`, `workspace-boot`,
`record-cost`, `share-open-latest`, `readout-history-full`, `default-views-gestures`, `focus-scroll`,
`stage-copy-clause`, `base16-remove`, `notice-float`, `share-open-alone`, `share-popover`, `share-open-unreadable`,
`first-load`, `reset-preset-copies`, `inspector`, `link-hold`, `share-open`, `hidden-views`, `stage-tab-titles`,
`copy-pin`, `follow-kept`, `workspace-switches`, `copy-header`, `step-bar` (each `tests/browser/<name>.test.ts`), and
`NODE tests/node/app-header.test.ts tests/node/harness.test.ts`.
**`AFFECTED-1-FF`**: `FIREFOX` on the same browser files.

- [ ] **Step 0: Baselines at `798fa38`.** `AFFECTED-1` less `clif-fetch-menu` into `$L/01-base-chromium.log` and
  `$L/01-base-node.log`, `AFFECTED-1-FF` into `$L/01-base-firefox.log`, `TSC` and `LINT` into theirs. Expected:
  Chromium and node pass; the Firefox failures listed in the report.
- [ ] **Step 1: Write the cases.** In `view-toggles-narrow.test.ts`, whose doc says what the width decides now (where
  the group is, and the stylesheet's rule for a group still in the header before `main.ts` runs), the file's mount
  as it is (`mountAt(1280, 896)`); each M case starts from `resetToFourViews()` at 1280 and sets its own width:
  - **E1** (replaces `:33-45`) *at %i px: in the workspace menu %s, and a group in the header drawn %s by the
    stylesheet*: at 641, 640 and 641, `until` the group's parent is `#workspace-menu` at 640 and `header.bar` at
    641; the rule read on a probe, a `div.views-shown` appended to `header.bar`, its computed `display` `none` at 640
    and not at 641, then removed.
  - **M1** *are the workspace menu's first group, named show, drawn inside it, and the header holds none*: at 600,
    the menu opened with a real click on `#workspace`: the group is the menu's `firstElementChild`, its `role`
    `group` and `aria-label` `show`, its `::before`'s computed `content` `"show"`; the group holding
    `[data-switch="views"]` still has `aria-label` `views`; each of the five toggles has a box over 0 px wide and
    tall, inside the menu's box; `header.bar > .views-shown` is null. At 1280, the menu shut
    and opened again: the group's parent is `header.bar` and its `previousElementSibling` `#workspace-menu`, and the
    open menu holds no `.view-toggle`.
  - **M2** *show and hide views as the header's do, with the pressed look, and leave the menu open*: at 600, open; a
    real click on the λ toggle: `mounted()` without `lambda-0`, its `aria-pressed` `false`, its computed `box-shadow`
    `none`, the menu `:popover-open`; a second click: `lambda-0` back, `true`, a `box-shadow` holding `inset`, the
    menu open. Then the keyboard: the focus put on the TM toggle and `{Enter}`: `tm-0` gone, `document.activeElement`
    the TM toggle, the menu open.
  - **M3** *bring views back to a page left with the source view alone*: at 600, real clicks in the open menu on the
    λ, rxm and TM toggles until `mounted()` is `['source']` and the source toggle's `aria-disabled` is `true`
    (preconditions); a click on TM: `mounted()` holds `tm-0`.
  - **M4** *choose the Stage's tabs*: at 600, the Stage preset picked in the open menu with a real click, the menu
    still open (precondition); a click on the λ toggle: `tabLeaves()` without `lambda-0`; another: with it. The
    Explorer preset picked again at the end.
  - **M5** *stay first in the menu across a pick that repaints it*: at 600, open; a real click on the Debugger
    preset: the menu open, the group its `firstElementChild` with five toggles, the Debugger item `aria-current` and
    `document.activeElement`. Explorer picked again at the end.
  - **M6** *keep a toggle's focus when the window widens with it in the menu*: at 600, open; the focus put on the λ
    toggle (precondition: `activeElement`, inside the menu); `page.viewport(1280, 896)` and `until` the group is in
    the header: `activeElement` is still the λ toggle, not inside `#workspace-menu`.
  - **M7** *follow the window across 40rem with the menu open*: at 641, open (precondition: no `.view-toggle` in
    it); at 640, `until` the group is in the open menu, the group its `firstElementChild` (no rebuild has run, so
    the order is `placeToggles`' own), each toggle inside its box, the menu still open; at 641, the group in the
    header, the menu open with its presets.
  - **W1** *workspaceItems rebuilds the menu around the toggles' group, and leaves a focus inside it*: a `div` appended
    to the body holding a `div` group of two buttons, the SECOND focused (the identity rule's fallback focuses the
    first, which would hide the fault); `workspaceItems(menu, { switches: PRESETS.explorer, reset: <a new button>,
    views: group }, { preset() {}, flip() {} })`: the same group element is `menu.firstElementChild`, the second
    button still `document.activeElement`, the presets' group next. Removed at the end.

  In `view-keys-focus.test.ts`: `togglesHidden` (`:37`) becomes `togglesInMenu` (the group inside
  `#workspace-menu`), with the precondition at `:56` and the waits at `:146-149`, `:158`. **F1** replaces `:139-151`,
  *goes to the workspace menu's button when the window is narrowed past 40rem, and is there when it is widened
  again*: as the case does now, `#workspace` where it reads `#new-view`, and its doc says why the focus goes there.

  New `clif-fetch-menu.test.ts`, on `clif-fetch-rest.test.ts`'s model and a file alone for `clif-fetch.test.ts`'s
  reason: **C1** *fetches once the pointer rests on the CLIF toggle in the workspace menu*: `watchRequests('start',
  CLIF_MATCH)`, then `mountAt(600, 896)`; nothing fetched (precondition); the menu opened with a real click and
  `toggle('clif')` inside it (precondition); `userEvent.hover(toggle('clif'))`; `clifFetched()` not empty.

  In `view-toggles-first-paint.test.ts`: **P1** replaces *are hidden by the attribute in a narrow window*
  (`:114-119`): at 390, `until` the group's parent is `#workspace-menu`, and `header.bar > .views-shown` is null.
  The doc's narrow-window paragraph (`:23-29`) says the group moves into the menu; *are not drawn in a narrow window,
  by the stylesheet and with no attribute set* stands.

  In `controls-gate.test.ts`: **G1**, in *with each header menu open* (`:240`): with `#workspace`'s menu open, the
  controls the walk read include every `#views-shown button`. The doc over the wide describe (`:449-454`) says the
  414 px walks meet the toggles inside the workspace menu, and this describe meets them in the header.

  In `tests/node/app-header.test.ts` (`:91-111`): the rule's pattern is `.bar > .views-shown`, its doc and message
  saying it keeps a group still in the header off the page; the help sentence held ends `has no room for the
  buttons; the workspace menu holds them there, in its <strong>show</strong> row.`
- [ ] **Step 2: Run them red.** `BROWSER` on the five browser files into `$L/01-red.log`, `NODE
  tests/node/app-header.test.ts` into `$L/01-red-node.log`. Expected FAIL: E1 at 640's place; M1-M7 at their first
  read of the group's place (M2-M5 at that precondition); W1 at `firstElementChild`; F1 at `#workspace` (the focus is
  on `+ view`); C1 at its precondition; P1; G1; the node pattern and sentence. A case failing anywhere else is
  reported before going on.
- [ ] **Step 3: Build.**
  - `placeToggles`: where `NARROW_WINDOW` matches, `handOff(viewsShown, [workspaceButton])`, then
    `workspaceMenu.prepend(viewsShown)`; where it does not, note the toggle that holds the focus (`focusHolder`,
    `focus-handoff.ts:61-64`), `workspaceMenu.after(viewsShown)`, and focus that toggle again. It sets no `hidden`.
    The comment over it says why the group moves rather than hides (a pointer on a phone keeps the toggles), why the
    focus goes to `#workspace` (the button that now opens them), and why it is given back on widening (one engine
    blurs a moved element and the other does not).
  - `index.html:26`: the group's `aria-label` `show`, and `SHELL`'s copy (`harness.ts:46`) with it, which
    `tests/node/harness.test.ts` holds to the page's body. The one attribute names the group in the header and in
    the menu, whose label is drawn from it (`style.css:405-419`).
  - `fillWorkspaceMenu` hands `views: viewsShown`; `workspaceItems` as its *Interfaces* line says, its doc saying
    why the group is never rebuilt (its buttons are the header's, with their listeners, state and focus).
  - `style.css`: the media rule's selector `.bar > .views-shown`; `.views-shown[hidden]` and the comment's
    attribute paragraph go; `#workspace-menu > .views-shown` joins the selectors of `.menu-group`,
    `.menu-group::before` and `#workspace-menu .menu-group`, so the row is laid out, labelled and wrapped as a switch
    row is, and its buttons keep `.view-toggle`'s look. The comments say what each rule is for.
  - `NARROW_WINDOW`'s doc: `main.ts` places the group by the query, `style.css` keeps a group still in the header
    off the page before `main.ts` runs, `help.html` gives the width; it names the tests Step 1 left holding them.
  - `help.html:49-51`: the sentence's tail after its semicolon becomes `the workspace menu holds them there, in its
    <strong>show</strong> row.`
  - `harness.ts:1345-1347`: the toggles are in the workspace menu in a window this narrow, and `.click()` reaches
    them there all the same.
- [ ] **Step 4: Run green.** `BROWSER` and `FIREFOX` on the five files, `NODE` on the two node files, into
  `$L/01-green-*.log`. Expected: all pass in Chromium; in Firefox every new or changed case passes, M6 and F1 among
  them, and only Step 0's failures fail.
- [ ] **Step 5: Sabotage**, one driver `$L/01-sab-driver.mjs`:

| Id | The one edit | Must fail |
|---|---|---|
| S1 | `placeToggles` sets `viewsShown.hidden` as at `798fa38` and moves nothing | E1 at 640's place; M1 at the group's parent; C1 at its precondition; G1 |
| S2 | the hand-off's candidates `nearest(header, viewsShown)` again | F1 at the narrow window's focus (it lands on `+ view`) |
| S3 | the toggle not focused again after the move to the header | M6 at `activeElement`, in Chromium and in Firefox |
| S4 | `workspaceItems` `replaceChildren`s the whole menu | M5 at `firstElementChild`; W1 |
| S5 | `workspaceItems` takes its identity from a focus inside `views` | W1 at `activeElement` |
| S6 | the media rule's selector `.views-shown` again | M1 at a toggle's box |
| S7 | the media rule taken out | E1's rule at 640; first-paint's *are not drawn in a narrow window…* |
| S8 | `#workspace-menu > .views-shown` out of the `::before` rule | M1 at the label |
| S9 | `prepend` made `append` | M7 at `firstElementChild` at 640 |
| S10 | `toggleView` calls `workspaceMenu.hidePopover()` | M2 at `:popover-open` |
| S11 | `#workspace-menu > .views-shown` out of the wrap rule | `header-menus-narrow`'s *lies inside its gutter…* at a toggle's right, at 320 px or the widest width that fails; where no width fails, the rule is not needed, and the report says so before it is kept or dropped |

- [ ] **Step 6: Gates and the commit.** `AFFECTED-1` (Step 0's count and the new cases, all passing) into
  `$L/01-affected.log`, `AFFECTED-1-FF` into `$L/01-firefox.log` (Step 0's failures and no other), `NODE` (the whole
  tier), `TSC`, `LINT`, `COMMENTS` into theirs; the message in `$L/01-commit-msg.txt`.
- [ ] **Step 7: Report** in `$L/task-1-report.md`: the tallies of Steps 0, 2, 4 and 6; each sabotage, the case and
  assertion it failed at, its log; S11's answer.

### Task 2: `userSplit`, and the bound and the floor off `+ view`

**Files:**
- Modify: `web/tests/browser/user-event-fixture.ts` (after `plusView`, `:33-43`)
- Test: `web/tests/browser/add-view-floor.test.ts`, `web/tests/browser/live-views-bound.test.ts`

**Interfaces:**
- Produces: `userSplit(leaf: string, pick: string, dir: 'row' | 'column' = 'row'): Promise<string | null>`, with the
  pointer: a click on `[data-leaf="<leaf>"] button.view-more`, on its menu's `button.view-split[data-dir="<dir>"]`,
  and on the `.view-menu-pairs` item `pick` names (`'same'` `[data-same]`, `'source'` `[data-source]`, else
  `[data-binding="<pick>"]`), each awaited with `until`. It throws naming the pairs on offer where the item is not
  there, and answers the id of the view the split made (the `#views [data-leaf]:not([role="tab"])` id not there
  before), or `null` where it made none, a refused split. Tasks 3 to 5 use it.

- [ ] **Step 0: Baselines** at Task 1's commit: `BROWSER` and `FIREFOX` on the two files.
- [ ] **Step 1: `userSplit`, and the cases moved**, as the tables say. Each file's doc says a split is what the
  bound and the floor are held on; what no case uses any more goes (`plusView`'s import, `ROOM_BESIDE`, `added` where
  unused, `resetPreset`'s Stage branch where unused).

| `add-view-floor.test.ts` at `798fa38` | Ruling |
|---|---|
| `:198` *refuses a 65th view in the cap's words, from + view and from a split, and on the Stage* | kept as *refuses a 65th view in the cap's words, from a split*: the two `+ view` presses and the Stage half go |
| `:227` *gives the row an equal share for each of five presses…* | deleted; its divider measurement (`:233-238`) moves to the start of `:272` |
| `:254` *refuses a sixth press…* | deleted |
| `:272` *refuses split right on a view narrower than 332 px, and still halves a wide one* | kept: one split right of λ (`'same'`) makes the focused view 311 px wide, in place of two presses; the counts follow (5 views, then 6) |
| `:303`, `:368` (split down) | kept; `refused()` loses its `#new-view` line (`:177`) |
| `:331`, `:349` *refuses + view where…* | deleted |
| `:389` *adds on the Stage past the floor tiles would hold…* | deleted: nothing adds a view on the Stage |

| `live-views-bound.test.ts` at `798fa38` | Ruling |
|---|---|
| `:79` *adds a view at 63 live views, which makes 64* | `userSplit('lambda-0', 'same')`; the precondition on the focused view goes |
| `:97` *refuses the next at 64…* | `userSplit('rxm-0', 'same')`; the room precondition reads `rxm-0`'s width against `2 * MIN_VIEW_PX + DIVIDER_PX` |
| `:111` *adds once a ✕ has made room…* | `userSplit('lambda-0', 'same')`; the `.focus()` line goes |
| `:122` *is refused again after a ✕ that made no room…* | `userSplit('rxm-0', 'same')`; the `.focus()` line goes |
| `:142` *adds the source view at 64, where a remembered arrangement holds it already* | deleted: it is `+ view`'s source; `:158` holds the split's |
| `:158` *adds the source view at 64 from a split as well* | kept as *adds the source view at 64 from a split, where a remembered arrangement holds it already*, on `userSplit('lambda-0', 'source')`; its doc says why `split` hands `admit` the source's id |
| `:180` *names choosing a preset first in a custom workspace…* | `userSplit('rxm-0', 'same')` |
| `:200` *has room for another once a preset is chosen…* | `userSplit('tm-0', 'same')`; its notice `view added — TM · program` |

- [ ] **Step 2: Run.** `BROWSER` on the two files at the task's start (green, the old setups) and after the edit
  (green), and `FIREFOX` after: Step 0's failures and no other.
- [ ] **Step 3: Sabotage**, `$L/02-sab-driver.mjs`:

| Id | The one edit | Must fail |
|---|---|---|
| S1 | `admit` refuses at `live.size >= MAX_TREE_LEAVES + 1` | floor's *refuses a 65th view…* at the notice; bound's *refuses the next at 64…* at its notice |
| S2 | `admit` refuses at `live.size >= MAX_TREE_LEAVES - 1` | bound's *adds a view at 63…* at `mounted()` |
| S3 | `addRefusal`'s floor read as `MIN_VIEW_PX - 20` | floor's *refuses split right on a view narrower than 332 px…* at the notice |
| S4 | `DIVIDER_PX` 13 (`layout-view.ts`) | floor's *refuses split right…* at the moved divider measurement |
| S5 | `split` hands `admit` `null` for the source's id | bound's *adds the source view at 64 from a split…* at its notice |
| S6 | `customWorkspace` answers `false` | bound's *names choosing a preset first…* at its notice |

- [ ] **Step 4: Gates and the commit**: `LINT`, `TSC`, `COMMENTS`; the three files. Report `$L/task-2-report.md`.

### Task 3: The copies' and parked views' files off `+ view`

**Files:** `web/tests/browser/` `parked-copy-editor`, `parked-copy-editor-mount`, `parked-copy-undo`,
`parked-view-replaced`, `one-id-two-kinds`, `one-id-two-kinds-stored`, `bindings-stored`, `copy-editor-mount`,
`scroll-kept-moved-editor`, `share-open-hashchange` (each `.test.ts`).

**Interfaces:** consumes `userSplit` (Task 2) and `splitVia`. Unless the table names another view, the split is of
the view `+ view` was pressed beside, and the `.focus()` that chose it goes; the split puts its view where `+ view` did, right after
the view, so `mounted()` orders hold. A precondition that read `+ view`'s equal shares reads the split's halves.

| File and case at `798fa38` | Ruling | Sabotage, and where it must fail |
|---|---|---|
| `parked-copy-editor` `parkTheHolder` (`:79`, its press `:95-96`), its 6 cases | `splitVia(leg.view, 'row', 'same')`, the view on the copy | `reseedingSlots` (`pane-host.ts:1756`) passes over a view that is not on the page: each case at *…still holds the editor of the copy it left* |
| `parked-copy-editor-mount` `:45` | `userSplit('tm-0', 'same')` | from its doc |
| `parked-copy-undo` `:114`, one case a leg | `splitVia(kept.view, 'row', binding)` (the source view cannot be split) | `moveBack` (`pane-host.ts:1785`) answers `[]`: each at the view of the copy back |
| `parked-view-replaced` `:54` | `userSplit('lambda-0', 'same')` | `applyLayout` keeps a parked view whose arrangement an edit replaced (the line its doc names): at the copies menu's words |
| `one-id-two-kinds` `:261` | `userSplit('tm-0', bindingKey('lambda', 'source'))`: the edit that replaces the arrangement the copy's view is parked in; its doc says a split | the same edit: at the copies menu's words |
| `one-id-two-kinds-stored` `:178` | `userSplit('tm-0', 'same')`; named *…the view a split adds is pane-62* | `switchTo`'s trial mints with `nextLeafId` (`main.ts:1782-1788`): at `['pane-62']` |
| `bindings-stored` `:136` | `userSplit('lambda-0', 'same')` with λ on the copy; named *gain a view that a split adds on a copy* | from its doc |
| `copy-editor-mount` `:159` | deleted with its `addView` helper (`:65-73`): `:151` *mounts one in a view split onto the copy* holds the same through a split | — |
| `scroll-kept-moved-editor` `:29` | `userSplit('lambda-0', 'same')` | from its doc |
| `share-open-hashchange` `beforeAll` (`:82-93`) | the copy's view by `userSplit('lambda-0', 'same')`; the window stays 1600 px if the split is admitted there (its notice `view added — …`, asserted), else the narrowest width that admits it, and the comment over it (`:75-77`) says why | `moveBack` answers `[]`: the first case that undoes an open, at the copy's view |
| `share-open-hashchange` `:164` | `userSplit` of a λ view of the link's tree with `bindingKey('lambda', 'source')` | `showWorkspace` without `seedLeafCounter` (`main.ts:2266`): at the id |

- [ ] **Step 0: Baselines** at Task 2's commit: `BROWSER` and `FIREFOX` on the ten files.
- [ ] **Step 1: The moves**, as the table says; the harness's `newLambdaViewItem` is left for Task 6 with no caller.
- [ ] **Step 2: Run** as Task 2's Step 2, on the ten files.
- [ ] **Step 3: Sabotage** as the table says, `$L/03-sab-driver.mjs`; `reseedingSlots` and `moveBack` once each, over
  every file they name.
- [ ] **Step 4: Gates and the commit**: `LINT`, `TSC`, `COMMENTS`; the ten files. Report `$L/task-3-report.md`.

### Task 4: The Stage's files off `+ view`

**Files:** `web/tests/browser/stage.test.ts`, `stage-gestures.test.ts`, `stage-copy-editor.test.ts`.

| File and case at `798fa38` | Ruling | Sabotage, and where it must fail |
|---|---|---|
| `stage-gestures` `:62` *shows the view that + view creates* | deleted with its doc (`:57-61`): it tests `+ view` alone, and nothing adds a view on the Stage | — |
| `stage` `:219` *takes the λ half of the link status from the λ view on the page…* | at its *TWO λ VIEWS* step (`:258`): the `views` switch to tiles (`clickWorkspaceItem`), `splitVia('lambda-0', 'row', 'same')`, the switch back to the Stage, and the made view's tab (the one not there before) pressed with `.click()`, in place of the press; the rest as it is | from its doc (*selecting a tab records the focused leaf and marks no pane active*) |
| `stage-copy-editor` `hideTheHolder` (`:81`, its press `:94-95`), its 6 cases | the Explorer preset (`clickWorkspaceItem('[data-preset="explorer"]')`), the copy, `splitVia(leg.view, 'row', 'same')`, the editor claimed in the second view, the Stage preset, `tab(leg.view)`; `beforeEach` picks the Stage preset before `resetToFourViews()`, so a case that failed in tiles leaves the next where every case starts; the file doc's sentence on what is arranged with `.click()` names the split and the presets | `reseedingSlots` passes over a view that is not on the page: each case at *…still holds the editor of the copy it left* |

- [ ] **Step 0: Baselines** at Task 3's commit: `BROWSER` and `FIREFOX` on the three files.
- [ ] **Step 1: The moves**, as the table says; the files' `+ view` words with them (the viewport comments of
  `stage` and `stage-gestures`).
- [ ] **Step 2: Run** as Task 2's Step 2; **Step 3: Sabotage**, `$L/04-sab-driver.mjs`; **Step 4: Gates and the
  commit** as Task 2's. Report `$L/task-4-report.md`.

### Task 5: The header's, the menus' and the other files off `+ view`

**Files:** `web/tests/browser/` `app-header`, `menu-focus`, `view-keys-popovers`, `first-load-views`, `clif-shown`,
`scroll-kept`, `share-positions`, `source-close-remembered`, `view-toggles-two-of-a-kind` (each `.test.ts`).

| File and case at `798fa38` | Ruling | Sabotage, and where it must fail |
|---|---|---|
| `app-header` `:28` *adds a view beside the focused one…* and `:66` *offers source to + view only while…* | deleted | — |
| `app-header` `:46` *resets the preset…* | its precondition (`:47-48`) made by a `.click()` on the λ toggle first, as the file presses; the viewport comment (`:10-11`) names a split | — (its subject is unchanged) |
| `menu-focus` `:132` | the second λ view on the program by `userSplit('lambda-0', bindingKey('lambda', 'source'))`; the comment at `:94` names `#share` | — (its doc: it passes with no handler doing anything) |
| `menu-focus` `:157` *+ view, adding a view* | becomes *a view's split, adding a view*: `userSplit('lambda-0', bindingKey('tm', 'source'))`, then `where()` not `<body>` | `split`'s `focusPane(created)` taken out: at `where()` |
| `view-keys-popovers` | the `['+ view', '#new-view']` row (`:79`), `:187` and `:207` deleted; the describe's doc (`:183`) names the split's list alone; *Six of the seven* (`:89`) counts six | — |
| `first-load-views` `:152` | `#buffers` is the reference button whose edge is *a button's* (`:156`, `:164`), and the wait's message says copies | the `.view-toggle` rules in `@media (forced-colors: active)` (`style.css:301`) taken out: at the edges |
| `first-load-views` `:190` *adds the next view beside the TM view…* | becomes *shows the TM view on the Stage, which is where the focus is*: the Stage preset picked with real clicks; `selectedTab()` `tm-0`, `mounted()` `['tm-0']`; its doc says the record is seen where the Stage uses it. If the Stage shows another view, the case is deleted and the report says so | `defaultFocus` answers the source's leaf: at `selectedTab()` |
| `clif-shown` `:123` | *a split's clif item shows and records it*: `userSplit('lambda-0', bindingKey('clif', 'source'))` | `clifSync.want(clifWanted())` out of `applied` (`main.ts:1523`): at the clif request |
| `scroll-kept` `:156` | `userSplit` (`'same'`) of a view `heldTiles` does not read; the message says the split | `keepScroll(fresh)` (`pane-host.ts:1641`) taken out: at `heldTiles` |
| `share-positions` `:203` (`n` 3) | `userSplit` (`'same'`) of a view other than λ; its wait as it is | from its doc |
| `source-close-remembered` `:39` | `userSplit('tm-0', bindingKey('lambda', 'source'))` | `enter` (`arrangements.ts`) remembers nothing: at `remembered()` |
| `view-toggles-two-of-a-kind` `:34` | `userSplit('tm-0', 'same')`; named *…once a split has added a second…* | `viewsOfKind` answers 1: at *hide the 2 TM views* |

- [ ] **Step 0: Baselines** at Task 4's commit: `BROWSER` and `FIREFOX` on the nine files.
- [ ] **Step 1: The moves**, as the table says, and the files' `+ view` words.
- [ ] **Step 2: Run** as Task 2's Step 2; **Step 3: Sabotage**, `$L/05-sab-driver.mjs`; **Step 4: Gates and the
  commit** as Task 2's. Report `$L/task-5-report.md`, with `rg -n "new-view|plusView|newLambdaViewItem"
  web/tests/browser` into `$L/05-presses-left.log`: only the rows Task 6 owns in the sweep.

### Task 6: Remove `+ view`, and the code and node tests that were only its

**Files:**
- Modify: `web/index.html:29-30`; `web/src/main.ts`, `pane-host.ts`, `layout.ts`, `app-header.ts`, `draw.ts:279`,
  `pane-chrome.ts:317`, `style.css:245` and `:516-527`, at the lines the sweep's rows for Task 6 give;
  `web/tests/browser/harness.ts` (`:6`, `:49-50`, `:1181-1185`, `:1198-1207`, `:1361-1362`);
  `web/tests/browser/user-event-fixture.ts:33-43`; `web/tests/browser/view-menu.test.ts:89` (a comment)
- Test: node `web/tests/node/layout.test.ts`, `arrangements.test.ts`, `harness.test.ts`; browser
  `edge-spacing.test.ts`, `controls-gate.test.ts`, `view-toggles-first-paint.test.ts`, `workspace-bound.test.ts`

**Interfaces:**
- Produces: `AddRefused = { leaf: LeafId; gesture: Dir; why: AddRefusal }`; `insert(root, id, dir, newId, kind)` in
  `layout.ts`, `splitLeaf`'s body; no `insertBeside`, `PaneHost.addView`, `addViewItems`, `plusView`,
  `newLambdaViewItem` or `pressedLayout`.

**`AFFECTED-6`**: `BROWSER` on every browser test file this branch has edited (`git diff --name-only 798fa38 --
web/tests/browser | rg '\.test\.ts$'`, run after the edit) and `layout-notices`, `pane-picker`, `layout-app`,
`view-menu`, `two-lambda-panes`, `layout-view`, `header-menus-narrow`, `copy-beside-program`; `NODE` on the whole
tier. **`AFFECTED-6-FF`**: `FIREFOX` on the same browser files.

- [ ] **Step 0: Baselines** at Task 5's commit: `AFFECTED-6` (its list taken from Task 5's diff and the eight named,
  plus `workspace-bound`), `AFFECTED-6-FF`.
- [ ] **Step 1: The cases.**
  - **R1**, in `edge-spacing.test.ts`: `HEADER_MENUS` (`:429`) without `'new-view'`, so *are every popover a header
    button opens through `aria-controls`* (`:433`) holds the header to six menus.
  - **R2**, in `layout.test.ts`'s `parseTree` describe (`:968`): *reads back a tree with two views of a kind in one
    row of equal shares, as stored*: a row of `source`, `lambda-0` and `pane-1` (λ) at a third each, in a column
    over `rxm-0` and `tm-0`; `parseTree` answers it equal.
  - **R3**, beside it: *reads back a workspace whose tree and remembered arrangement hold it*: that tree as
    `fourViewWorkspace()`'s tree, and a row of `source`, `lambda-0` and `pane-1` (λ) at a third each as its
    `source+lambda` arrangement (`parseArrangements` refuses a tree filed under another combination's key), through
    `serializeWorkspace` and `parseWorkspace`, equal.
- [ ] **Step 2: Run red.** `BROWSER tests/browser/edge-spacing.test.ts` and `NODE tests/node/layout.test.ts` into
  `$L/06-red*.log`. Expected: R1 FAILS at the list (the page has `new-view`); R2 and R3 pass (the parse changes
  nothing; S2 proves them).
- [ ] **Step 3: The removal**, the sweep's rows for Task 6:
  - the markup, `SHELL` with it, `#new-view`'s chrome (`style.css:245`) and its gutter rule (`:525-527`), the
    gutter comment (`:516-520`) saying settings and about take theirs on the start side and the two one gutter;
  - `main.ts`: the import, the two queries and their guards, the refill in `applied` (`:1524-1528`) and the
    `+ view` clause of the comment over the CLIF line (`:1521-1522`), the block at `:2018-2030`, `refused`'s
    `what` (`:1147`) the split's words alone; the comments at `:198`, `:1083`, `:1100`, `:1399`, `:1828-1829`,
    `:2193` without `+ view`;
  - `pane-host.ts`: the import, `addView` (`:128-134`, `:1817-1828`), `AddRefused`'s `gesture` `Dir` and its doc
    (`:147-152`) without `+ view` and without the decision's date, and the comments at `:445`, `:632`, `:744`,
    `:912`, `:1198`, `:1465`, `:1689-1690`;
  - `layout.ts`: `insertBeside` (`:272-293`); `insert` without `share`, its equal-share branch (`:259-267`) and its
    subject check (`:249`), which `splitLeaf` makes first, its doc (`:236-247`) `splitLeaf`'s body's; `splitLeaf`'s
    doc (`:330-335`), `MAX_TREE_LEAVES`'s (`:509`), `addRefusal`'s (`:598-603`) and `leafNumber`'s bound's (`:640`)
    without `+ view` or `insertBeside`;
  - `app-header.ts`: `addViewItems` and the imports only it used; the module doc (`:8-13`) without `+ view`;
  - `draw.ts:278-279`: on the Stage the toggles choose the tabs, and nothing adds a view beside the focused one;
    `pane-chrome.ts:317` without `addViewItems`;
  - `harness.ts`: `newLambdaViewItem`, `pressedLayout`, the `insertBeside` import; the comment at `:1361-1362`;
    `user-event-fixture.ts`: `plusView`; `view-menu.test.ts:89`'s comment names `splitLeaf` alone;
  - node `layout.test.ts`: the `insertBeside` describe (`:725-744`) goes, `:735` moving to `splitLeaf`'s describe
    (`:248`) as *puts the new leaf right after its subject in leaves() order*, and of `:740-743`'s refusals the one
    no `splitLeaf` case holds yet, a subject not in the tree; the equal-share describe (`:760-830`) and `rowOf` and
    `sum` (`:746-758`) where nothing else uses them; in *the floor on an add*, `view` (`:833`) and `:843` go, `:855`
    builds its narrow view by one `splitLeaf` of λ (`p2`, 311 px, as now), `:903` and `:922` go (no add the app
    makes shrinks a view but the one it halves), and `:936`, `:950` and `:959` use `split(…, 'row')` and
    `splitLeaf` where they use `view` and `insertBeside`, `:950`'s `wide` made wide enough that a 63rd of it
    is at least 332 px (`63 * 400`), since a split halves the view it is chosen on; `:1049-1063` goes (`:1006`
    holds the leaf bound and `:950` `addRefusal`'s); the imports;
  - node `arrangements.test.ts`: `:58` and `:115` `splitLeaf`; the sequences' `add` (`:400-413`) splits a shown leaf
    that is not the source (none: `break`) with `splitLeaf`; the doc (`:200`) names a split. Where *reached every
    gesture…*'s floor for `add` then fails, the floor goes to about half of what the seeds now reach, and the report
    gives both numbers;
  - node `harness.test.ts`: the two ids out; the comment's example (`:36-37`) `#share` by `id="share-menu"`;
  - `workspace-bound.test.ts`: the tree `rowOfLeaves(65)`, focused `pane-65`; its doc: 65 leaves in one row, past
    the leaf bound and not the depth bound, which no add the app makes can write;
  - `controls-gate.test.ts`: `:243` without `'new-view'`; the `+` exception's reason (`:90-92`) is the example's
    program text, as `=`'s is;
  - `edge-spacing.test.ts`: `GUTTER_SCANS`' `new-view` row (`:614`);
  - `view-toggles-first-paint.test.ts`: `newView` out of `places()` (`:44`); the doc (`:11-16`) names copies,
    examples and encoding, three controls after the group.
- [ ] **Step 4: The sweep**, into `$L/06-sweep.log`: `rg -n "new-view|addViewItems|addViewButton|addViewMenu|
  fillAddViewMenu|\baddView\b|insertBeside|pressedLayout|newLambdaViewItem|plusView|another view beside|gesture ===
  'view'" web scripts`: nothing. `rg -nP '\+ (view|VIEW)(?![\w.])' web/src web/index.html web/help.html`: nothing.
  `rg -nP '\+ (view|VIEW)(?![\w.])' web/tests`: Task 7's files alone (its list). The pattern leaves out
  `+ viewport` and `+ view.wide`, which are arithmetic. Anything else is put right in this task.
- [ ] **Step 5: Run green.** `AFFECTED-6` and `AFFECTED-6-FF` into `$L/06-green-*.log`, `TSC`, `LINT`, `COMMENTS`.
  Expected: Chromium and node pass (Step 0's counts less the deleted cases, plus R2 and R3); Firefox, Step 0's
  failures and no other.
- [ ] **Step 6: Sabotage**, `$L/06-sab-driver.mjs`:

| Id | The one edit | Must fail |
|---|---|---|
| S1 | `#new-view` and its menu back in `index.html` and `SHELL` | R1 at the list |
| S2 | `parseTree` refuses a tree with two leaves of one kind | R2, R3 |
| S3 | `insert` puts the new leaf before its subject | the moved *puts the new leaf right after its subject…* |
| S4 | `splitLeaf`'s subject check taken out | the moved refusal of a subject not in the tree |

- [ ] **Step 7: The commit and the report** (`$L/task-6-report.md`): the sweep's log, the tallies, the sabotages,
  `git diff --stat` of the commit.

### Task 7: The words left: test comments, and the view-layouts spec

**Files:** the comments naming `+ view` in `web/tests/browser/` `active-pane`, `layout-app`, `layout-notices`,
`pane-kind-switch`, `pane-picker`, `scratch-rebind-editor`, `two-lambda-panes` (the viewport comment *a split or a
`+ view`*), `live-views-bound-switch` (`:27`, `:43`) (each `.test.ts`), and
`web/tests/node/share-link.test.ts:496`; `docs/superpowers/specs/2026-10-11-view-layouts-design.md`.

- [ ] **Step 1: The comments**: each says what it says of a split, or loses the clause; no code line changes.
- [ ] **Step 2: The spec.** §4.1's *The header's group is named `views`* (`:185`) and §6's first sentence
  (`:479-480`) name it `show`, and §6 has it sit *before `copies ▾`*; the paragraph on `+ view`, `✕` and
  the split items (`:506-508`) names `✕` and the split items alone. §6.1's narrow-window paragraph (`:532-543`)
  describes the build: the group moved into the workspace menu, first, named `show` apart from the menu's `views`
  row, by `placeToggles` from `NARROW_WINDOW`; the
  focus handed to `#workspace`; given back on widening; a press leaving the menu open; the stylesheet's rule for a
  group in the header before `main.ts` runs. Its *OPEN* (`:548-549`) says it was answered by the user on 2026-11-23:
  moved into the workspace menu. §16.3: item 1 (`:1027`) answered so, item 3 (`:1030`) closed by `+ view`'s
  removal. A new last section, *§20 `+ view` removed (2026-11-23)*: the design's path; what went and what was lost
  (the design's non-goals); that §2.2 (`:63`), §4.5 (`:297`), §5.6 (`:467`) and §12 (`:886-888`) describe the app
  before it.
- [ ] **Step 3: Checks.** `rg -nP '\+ (view|VIEW)(?![\w.])' web` into `$L/07-words.log`: nothing. `git diff -U0`
  shows only comment lines in the test files (`$L/07-comment-only.log`). `LINT`, `TSC`, `COMMENTS`, `NODE
  tests/node/share-link.test.ts`, and from `$W` `scripts/check-doc-figures.sh`. No browser run: no code changed.
- [ ] **Step 4: The commit and the report** (`$L/task-7-report.md`).

### Task 8: The full gate, Firefox, and the pass by hand

**Files:** none unless a leg fails. One agent, with no other browser run on the machine.

- [ ] **The web job as CI runs it**, from `$W/web` with `CARGO_TARGET_DIR=$T`: `pnpm run build:wasm`,
  `build:lsp-wasm`, `build:clif-wasm`, `build:bindings`, `../scripts/check-licences.sh --self-test` and then alone,
  `LINT`, `TSC`, `pnpm run test:coverage` (the coverage thresholds met), `pnpm run build:app`, each into
  `$L/08-<leg>.log`. `test:coverage` runs under the browser lock, the port wait inside it, in a transient unit with
  a memory cap: `systemd-run --user --wait -p MemoryMax=16G -p MemorySwapMax=0` with `--setenv` for `PATH`, `HOME`,
  `CARGO_HOME`, `RUSTUP_HOME`, `CARGO_TARGET_DIR` and `VITEST_MAX_WORKERS=4`
  (`/home/davey/temp/redextape-panels-row-record/impl2/08g-gate-run.zsh` is the model; the exits into
  `$L/08-gate-exits.txt`). Expected: exit 0 each.
- [ ] **From `$W`**: `scripts/check-all.sh`; `cargo llvm-cov nextest --workspace --fail-under-lines 90`;
  `scripts/check-slow.sh`; each scan `rg -o 'scripts/check-[a-z-]+\.(sh|mjs)' .forgejo/workflows/ci.yml | sort -u`
  lists, with `--self-test` and then alone; `COMMENTS`. The Rust legs prove the toolchain, not this change; they run
  all the same.
- [ ] **Firefox** on every browser test file the branch edited or created into `$L/08-firefox.log`: the failures of
  the tasks' Step 0 baselines and no other.
- [ ] **By hand in Firefox**, driven as the last lane's pass was
  (`/home/davey/temp/redextape-panels-row-record/impl2/08g-hand.zsh`: `vite build` into `$L/hand/dist`, `vite
  preview` on a free port from 4391 to 4399 under the browser lock; `…/impl2/hand-8/drive.mjs` the model for
  `$L/hand/drive.mjs`), screenshots in `$L/hand/`. At 390 by 844: the header holds no `+ view` and no toggles;
  `Explorer ▾` opens a menu whose first row is the toggles, labelled `show`, on screen, its `tiles`/`stage` row still
  labelled `views`; a tap on `TM` hides the TM
  view and the menu stays open; with only the source view left, a tap brings TM back; with the Stage preset, the
  toggles choose the tabs. At 1280 by 896: the toggles in the header, the menu without them; the λ toggle focused
  and the window narrowed to 600: the focus ring on `Explorer ▾`. Expected: no page error. Davey tries the branch
  in Firefox before giving the word to push.
- [ ] A leg that fails is fixed in a commit of its own, test first, and the legs its files feed run again.
- [ ] **Report** in `$L/task-8-report.md`: each leg's exit, the tallies, the pass's findings.

### Task 9: The roadmap entry

**Files:** `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, appended after the last entry (the `clif`
lowercase one, from `:40222`), in its shape.

- [ ] **The heading**: a `####` line in capitals saying what the branch does, with the dates, the branch
  `remove-plus-view`, the code commits' SHAs on `b32af3d` and the docs commits.
- [ ] **The paragraphs**: what changed for a person (no `+ view`; at 40rem or narrower the toggles are the workspace
  menu's first row, named `show`, a press leaves the menu open, a focused toggle hands the focus to `Explorer ▾` as
  the window
  narrows and keeps it as the window widens); what it cost (G5: a second view of a kind on the Stage, a copy's view
  as an extra Stage tab, an add beside the source view, the equal-share add); the rulings of *Global Constraints*;
  what it did not close (the other specs left as records; *Open, for Davey* where unanswered; §16.3's other items);
  the tests (cases deleted, cases moved, cases added, each counted by command); the lines `web/src` lost and gained
  (`git diff --numstat 798fa38 -- web/src`); the sabotages and their logs; the gate and the pass by hand.
- [ ] **Every count this entry quotes, with what produces it**: a table in the last entry's shape (`:40317`), every
  row run after the last code commit into `$L/09-figures.log`. Values and SHAs, not "the only" or "all".
- [ ] **Commit** the entry; the hook's scans, `check-doc-figures` among them, pass. Report `$L/task-9-report.md`.

### Task 10: A review of `798fa38..HEAD`

- [ ] A fresh reviewer (opus) reads the design, this plan and `git diff 798fa38..HEAD`, and writes `$L/review.md`:
  findings by severity, each with its file and line and the input that shows it. It asks in particular: does any
  code that only `+ view` used remain, and did any code the split, the title menu or the other header menus use go
  (`admit`, `addRefusal`, the `added` notice, `wireMenu`, `SplitChoices`); can the toggles' move lose a listener, a
  pressed state or the focus in either engine, at a resize with the menu open or shut; does a moved case pass
  without reaching what it holds (a sabotage that failed elsewhere, or a *from its doc* sabotage that is weak); does
  a comment hold history or a measurement; is the help page's sentence true at 640 and at 641 px.

### Task 11: The review's fixes

- [ ] Each finding is checked before it is acted on: a finding is a claim. One that holds is fixed test first, in a
  commit of its own, with a sabotage where it adds a test, and its class is searched for siblings. One that does
  not hold is answered in `$L/review.md` with the evidence.
- [ ] Then Task 8's legs for every file the fixes touch (all of the web job if a file under `web/` changed), Firefox
  on the browser files they touch, and a commit that brings the roadmap entry up to the fixes, its figures run
  again.
- [ ] **Report** the head SHA and the tallies in `$L/task-11-report.md`. **Stop there**: pushing and opening the pull
  request wait for Davey's word.
