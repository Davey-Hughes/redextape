# Machine panels row — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The CLIF and rxm views lay their values (registers), call stack and heap out in one of three arrangements
chosen from the view's width, a closed panel keeps its column in all three, and a machine panel's header stays one line
at any width.

**Architecture:** One new module, `web/src/machine-row.ts`, owns the row for both views: it holds one `columns` list in
rem per view, derives both thresholds and each panel's `--column` from it, reads the view's border box less padding and
border, and moves the heap between the row and a `.machine-heap` region of its own. `PanelStack` learns that a panel can
change region (`place`), that a region's label can change, and how to tell a caller when it holds no gesture
(`whenFree`). The stylesheet lays each arrangement out without wrapping. `machine-panels.ts` gives the three panels a
header that gives way by its count, then its title, never a button.

**Tech Stack:** TypeScript, Vite, Vitest 4 (node; browser on Playwright, Chromium and Firefox), Biome. No Rust changes.

**Spec:** `docs/superpowers/specs/2026-11-21-machine-panels-row-design.md` (all of it; cited below as §n). The prototype
of the whole design is `$R/proto/prototype.patch` (cited as *the patch*): a draft that proved the design, to read beside
each task, not to paste. **Departures from the prototype** below says where the build differs from it.

## Execution notes

- **Paths.** `W=/home/davey/temp/redextape-panels-row` (branch `panels-row`, plan written at `fc8f480`, not pushed);
  `R=/home/davey/temp/redextape-panels-row-record`; `L=$R/impl` (every log, the sabotage driver and its saved copies;
  Task 0 makes it); `T=/home/davey/.cache/redextape-panels-row-target` (`export CARGO_TARGET_DIR=$T` in every shell that
  runs cargo, wasm-pack, `pnpm run typecheck` or `git commit`); `B=/home/davey/temp/redextape-panels-row-base` (the base
  worktree at `2c1c7e6`, the same code as `fc8f480`, read only). The prototype's tree,
  `/home/davey/temp/redextape-panels-row-proto`, is **read only**: no edit, stash, commit or run that writes there.
- **The worktree.** `web/node_modules` is a copy, not a symlink, and stays one. `pkg/`, `pkg-lsp/`, `pkg-clif/`,
  `web/bindings/` and `$T` are Task 0's to build, as real directories; its build logs are in `$L`.
- **One committing agent in `$W` at a time.** The pre-commit hook runs over the whole tree, so two agents break each
  other's commits. Implementers do not push and open no pull request: Davey gives that word, after Task 10.
- **Line references are at `fc8f480`.** Once an earlier task has edited a file, find the place by name.

## Global Constraints

- **Commands** (notation used below). Each run writes `>| $L/<task>-<what>.log 2>&1` and is followed by `print $?`; the
  tallies are read from the log with `grep -aE 'Test Files|Tests  |FAIL|×'`. zsh has `noclobber`, hence `>|`. Never pipe
  a run through `tail`: it hides the exit status. All from `$W/web` unless said.
  - `BROWSER files…`: under `flock /home/davey/temp/redextape-browser.lock`, first `until ! ss -ltn | grep -q ':63315 ';
    do sleep 5; done` (another project's vitest uses that port), then `VITEST_MAX_WORKERS=4 pnpm exec vitest run
    --project browser <paths>`. Paths are positional (`tests/browser/x.test.ts`): `pnpm test:browser -- name` does not
    scope, and `--maxWorkers` does not reach the browser projects.
  - `SCROLL files…`: the same with `--project browser-scrollbars`.
  - `FIREFOX files…`: the same with `REDEXTAPE_FIREFOX=1` and `--project firefox --project firefox-capture`.
  - `NODE f`: `pnpm exec vitest run --project node tests/node/f.test.ts` (no lock).
  - `TSC`: `CARGO_TARGET_DIR=$T pnpm run typecheck`. `LINT`: `pnpm exec biome ci --error-on-warnings`. `COMMENTS`:
    `node scripts/check-comments.mjs` from `$W`.
- **`AFFECTED`**, the browser files a task runs before its commit, those that exist at the time: the new
  `panel-stack-place`, `machine-panel-headers`, `machine-row`, `machine-row-app`; and `panel`, `panel-boundaries`,
  `panel-maximise`, `panel-regions`, `panel-sizes-stored`, `panel-sizes-restore`, `panel-sizes-restore-lambda`,
  `stored-panels-restore`, `rxm-pane`, `clif-pane`, `clif-layout`, `clif-shown`, `machine-view-chrome`, `edge-spacing`,
  `hidden`, `hidden-views`, `tm-view-narrow` (each `tests/browser/<name>.test.ts`). **`AFFECTED-FF`**, for Firefox: the
  new files of that list, and `panel-boundaries`, `panel-maximise`, `rxm-pane`, `clif-pane`, `clif-layout`,
  `edge-spacing`, `hidden`. **Chromium is the gate. Firefox is compared against Task 0's baseline**, where 3
  `panel-boundaries` drag cases already fail (Verified facts).
- **Test first.** Each task writes its tests, runs them to see them fail for the reason the task names, then builds. A
  case that cannot fail first, because an earlier task already built what it holds, is proven by its sabotage instead.
- **Sabotage.** Save a copy (`cp <file> $L/sab/<id>.orig`), make the one edit named, run the named file into
  `$L/<task>-sab-<id>.log`, copy the file back, `cmp` it. **Never `git checkout`**: mid-task it wipes the task. Run a
  task's sabotages from one driver script kept in `$L`, one browser run each. Each names the cases that must fail; **a
  sabotage that does not fire is a finding: stop and report**, and do not weaken the code until it does. A case stops
  at its first failed assertion, so a case named for two sabotages must fail under each alone. `$W` serves no dev
  server; if one is ever started there, sabotage in a copy instead.
- **Commits.** One per task: `cd $W && export CARGO_TARGET_DIR=$T && git add <the task's files> && git commit`. The hook
  runs nine tree-wide scans on every commit, the comment guard and the licences check among them, and `biome ci` and
  `pnpm run typecheck` when `web/` files are staged (`.pre-commit-config.yaml`). Never `--no-verify`, never `--amend`: a
  fix is a new commit. The message is one long plain sentence saying what the commit holds, as `git log --oneline -5`
  shows. If the comment guard reports a budget, cut the comment to its why first; only if it is still over, write the
  value the guard prints into `scripts/comment-budget.json` in that commit and say so in the report.
- **Copy and code.** "redextape" is lowercase in prose; spelling is British; no attribution to a person or a tool
  anywhere in the tree. Doc comments are `/** */` in TypeScript. **A comment says why**: the reason, the invariant, what
  breaks if it changes. No history, no measurement, no `file:line`; a comment may point at a design section. The
  patch's comments are drafts under the same rule, and are wrapped at 120 columns.
- **Browser tests.** A claim about what a person sees asserts geometry or computed style, not `textContent`. Presses
  use `userEvent`, as `panel-maximise.test.ts` does, not `.click()`. A probe prints with `console.error`. A test that
  goes on after a `ResizeObserver` callback does so in a `setTimeout` (a loop error a test causes is the test's). Every
  new file listens for `ResizeObserver loop` errors and fails a case that reports one, through `harness.ts`'s
  `hearLoops()`, which Task 1 adds. Pixel
  tallies are taken in the Instrument style, whose fonts `tests/browser/setup.ts` loads; a case that tallies pixels
  asserts first that `document.documentElement.dataset.style` is unset or `instrument`. A new case that drags with a
  pointer goes in `panel-boundaries.test.ts`, which is on `CAPTURE_FILES`; the new files make gestures with the
  keyboard.
- **Settled, not to be reopened** (§10 and Davey's header decision): the decision reads the view's border box less
  padding and border, not the row's width; one `columns` list in rem per view is the single source for thresholds and
  `--column`; CLIF `[7.375, 14.75, 14.75]` (wide from 622px, medium 370 to 622, narrow below 370), rxm `[18, 18, 18]`
  (896 and 592); medium is exactly today's layout; narrow is a column the code lays out; closed panels keep their
  column; a maximise keeps its panel's column; the heap's region is a `.machine-heap` wrapper hidden in wide; the wide
  boundary is "resize listing and registers, call stack and heap" ("values" in CLIF); a focused boundary a switch
  removes hands the focus to the heap's toggle; the fallback without `moveBefore` shows the heap's region before moving
  the heap back; a count gives way first with an ellipsis, then the title, never a button; a count with less room than
  about `3ch` is not drawn; a count always carries a native `title`; fixtures move to 800px, with Task 5's 1000px cases.

## Review Focus

Inputs the design implies that the prototype's tests do not reach, most likely first. Each has its test in the task
named.

1. **A view whose host has padding or a border.** §5.4 reads the border box less both, and today's `.pane` has neither,
   so no prototype case exercises the subtraction. A border-box host with `padding: 0 10px` and a 1px border switches to
   wide at its threshold plus 22px, not at the threshold. Task 4.
2. **A root font size that is not 16px** (a person's larger default). The thresholds are rem: under a 20px root CLIF is
   wide from 778px (777.5) and rxm from 1120px. Task 4.
3. **A heap stored closed, across both switches.** In wide its bar keeps its column; in medium it is a bar the full
   width under the row and no `machine|heap` boundary is drawn; opened in wide it opens in the row. Task 5.
4. **An rxm copy**, with its text above and its outline below: in wide the row's lower neighbour is the outline, and
   the boundary under the row parts those two. Task 5, or Task 6 where the copy needs the app.
5. **The app's own views.** Every prototype case builds a bare host by hand. Through the app, beside the source, a
   1280px window draws CLIF wide and rxm medium, and a 1024px one CLIF medium and rxm narrow (§5.1's table). Task 6.

## Verified facts (at `fc8f480`, read while writing this plan)

- `fc8f480` differs from `1ac4fc4` (main, #190) by the design doc alone (`git diff --stat 1ac4fc4 fc8f480`: 1 file).
- The hooks are `.pre-commit-config.yaml`'s: nine `always_run` scans; `biome ci` for staged
  `web/**/*.{js,ts,jsx,tsx,json,css}`; `pnpm run typecheck` for staged `web/**/*.{ts,tsx}`, which runs `build:bindings`
  (cargo) and needs `pkg/`, `pkg-lsp/` and `pkg-clif/`. There is no `.githooks/` directory.
- No test builds a `PanelStack` by hand: it is built in `rxm-pane.ts`, `clif-pane.ts`, `tm-pane.ts`, `lambda-pane.ts`
  and `main.ts`, and neither machine pane keeps a reference to its own.
- `.panel-note` is built only by `countNote` in `machine-panels.ts`; `tm-view-narrow.test.ts` reads every
  `.panel-actions .panel-note` on the page at narrow widths. The prototype's brief did not list that file, and the
  prototype never ran the whole `browser` project: Tasks 0 and 4 run both.
- The `firefox` project excludes `CAPTURE_FILES` and `SCROLLBAR_FILES`; `panel-boundaries.test.ts` is on `CAPTURE_FILES`
  and runs in `firefox-capture`.
- At base, Firefox fails 3 cases of `panel-boundaries.test.ts`, all under *a drag of a boundary*: *stops where a
  neighbour would go under its floor of five rows*; *stores a share for the two regions it parts and for no other, one
  on its floor among them*; *leaves a region over its floor exactly where it was, where one of the two it parts began
  on its floor* (`$R/proto/base-firefox.log`). The `browser-scrollbars` run prints one `ResizeObserver loop` line at
  base too (`$R/proto/base-scrollbars.log`), from the one file that project has there.
- The prototype's results, for comparison and not as targets: `machine-row.test.ts` 41 cases; 12 Chromium files, 293
  passed; `browser-scrollbars` 5 passed; Firefox 8 files with the 3 base failures and no other (`$R/proto2/report.txt`).
  Its 17 and 7 sabotages and what each failed are in `$R/proto/sabotage/results.txt`, `results2.txt` and
  `$R/proto2/sabotage/results.txt`. The sabotage ids below S1 to S16 and SB1 to SB7 are theirs; N1 to N13 are new here
  and have never been run.
- User-facing text: `web/help.html`'s keys table says a boundary between two panels is dragged by "the lower panel's
  header", true in every arrangement; `help.html`'s and `README.md`'s other mentions of registers, stack and heap are
  the TM's tapes; `about.html`, `docs/architecture.md` and `docs/development.md` describe no panel. Task 8 checks this
  again at the branch's end.

## Departures from the prototype

What the build does where the patch is clumsy, mis-layered or weaker than it looks. A reviewer checks the branch
against this list as well as the patch.

1. **The header rules belong to the panels, not to their containers.** The patch writes every header rule twice, for
   `.rxm-machine > .panel` and `.machine-heap > .panel`. Here `machine-panels.ts` gives its three panels the class
   `machine-panel` and each rule is written once on it, so the headers land before the row exists (Task 2).
2. **`countNote` returns its box and a `show`**, in place of the patch's `showCount(count, text)` digging the inner span
   out with a cast (Task 2).
3. **A region's label that changes is typed as one**: `StackRegion.label` is `string | (() => string)`, read through one
   private `#name(a, b)` that both a boundary's creation and `sync` use. The patch hides a getter behind `readonly
   label: string` and writes the "resize a and b" template a second time (Task 1).
4. **`PanelStack` gains `whenFree` and not `holding`**: `whenFree` runs its callback at once when no gesture is held, so
   the row needs no second question (Tasks 1 and 5).
5. **`MachineRow.regions` is a pair built once**, not a method that makes new region objects at each call (Task 4).
6. **A switch that does not move the heap calls `sync`, not `place`.** The patch calls `place` on every switch for its
   side effect, the handles and the label read again. A case holds which headers are handles in each arrangement after
   a switch, which no prototype case does (Task 4, N6).
7. **§6.9 is tested where it can fail.** The patch asserts the heap's region computes `display: none` in wide, where the
   region holds no panel and no `display` rule matches it with or without the `:not([hidden])` guard. The case here
   hides the region while it holds the open heap (Task 4, N5).
8. **`moveInto`'s refused-move branch has a case**, a `moveBefore` that throws; the patch's `catch` is untested (Task
   3).
9. **One fixture module for the new browser files.** The patch builds its views twice, in `machine-row.test.ts` and in
   `machine-row-scrollbars.test.ts`, and its scroll-bar cases cover rxm at its wide threshold only. Here
   `tests/browser/machine-views.ts` is the one place, its `mount` taking stored panel states and returning the pane; the
   loop listener is `harness.ts`'s `hearLoops()`; and the scroll-bar sweep runs both views (Tasks 1, 2 and 6).
10. **Presses use `userEvent`**, where the patch's cases call `.click()` on toggles and maximise buttons.
11. **The focus cases hold the heap's maximise button as well as its toggle** (§6.6 names both), and the first-paint
    case also shows a view parked wide at a narrow width (Tasks 4 and 5).
12. **The value line that brings a scroll bar in is set through `RxmPane.setScratch`** if one call does it; the patch
    writes `.rxm-value`'s text by hand (Task 6).
13. **The five Review Focus cases** are new: padding and border, the root font size, a closed heap, a copy, the app.

Kept from the patch as it is: `arrangementFor`, `moveInto`'s shape, `MachineRow`'s constructor, `follow` and its reading
of the width, `place` and the `#members` map, the stylesheet's arrangement and column rules, the 800px fixtures, and
every test case not named above.

## File structure

| File | Change | Task |
|---|---|---|
| `web/src/panel-stack.ts` | `place`, `whenFree`, a label that can change, membership read where the built list was | 1; two comments in 4 |
| `web/src/machine-panels.ts` | the `machine-panel` class, `countNote`'s `show` with the tooltip | 2 |
| `web/src/machine-row.ts` (new) | `Arrangement`, `arrangementFor`, `moveInto`; then `MachineRow`; then the handoff and the deferral | 3, 4, 5 |
| `web/src/rxm-pane.ts`, `web/src/clif-pane.ts` | build a `MachineRow`, pass its regions to the stack, `follow` | 4 |
| `web/src/style.css` | the headers; then the row, the heap's region, the columns, closed panels | 2, 4 |
| `web/vite.config.ts` | `SCROLLBAR_FILES` gains the new file | 6 |
| `web/tests/browser/harness.ts` | `hearLoops()`, the loop-error listener every new browser file calls | 1 |
| `web/tests/browser/machine-views.ts` (new) | the two views' fixture and the shared readers | 2, 4 |
| `web/tests/browser/panel-stack-place.test.ts` (new) | a stack built by hand | 1 |
| `web/tests/browser/machine-panel-headers.test.ts` (new) | the headers | 2, 6 |
| `web/tests/node/machine-row.test.ts` (new) | `arrangementFor` | 3 |
| `web/tests/browser/machine-row.test.ts` (new) | `moveInto`; the arrangements; what a switch keeps | 3, 4, 5 |
| `web/tests/browser/machine-row-scrollbars.test.ts`, `machine-row-app.test.ts` (new) | §6.3; the app | 6 |
| `panel-boundaries`, `panel-maximise`, `rxm-pane` `.test.ts` | 800px fixtures and the changed cases; the 1000px cases | 4, 5 |
| the design doc, the roadmap | as built; the entry | 8 |

**The TM view does not change** (§2's non-goal): its rules and state diagram are each a region of their own, a closed
one already keeps the view's width, and no TM header holds a `.panel-note`. `tm-pane.ts` is not edited. What reaches it
is Task 1's `PanelStack`, whose changes add to its API and leave a stack that never calls them as it was;
`panel-regions`, the `panel-sizes-*` files and `tm-view-narrow` in `AFFECTED` hold that, as they do for the λ and source
views.

---

### Task 0: Set up and take the baselines

**Files:** none tracked. **No commit.**

- [ ] `mkdir -p $L/sab`. In `$W/web`, with `CARGO_TARGET_DIR=$T`: `pnpm run build:wasm`, `build:lsp-wasm`,
  `build:clif-wasm`, `build:bindings`, each into `$L/00-build-<name>.log`. Expected: exit 0 each, and `pkg/`,
  `pkg-lsp/`, `pkg-clif/` and `web/bindings/` are directories and not symlinks.
- [ ] `TSC` and `LINT`: exit 0 each.
- [ ] `BROWSER` the existing `AFFECTED` files into `$L/00-base-affected.log`; `SCROLL
  tests/browser/state-diagram-local-scrollbars.test.ts`; `FIREFOX` the existing `AFFECTED-FF` files into
  `$L/00-base-firefox.log`. Expected: Chromium and scroll bars exit 0; Firefox exit 1 with exactly the 3 cases of
  Verified facts. Anything else: stop and report before Task 1.
- [ ] The whole Chromium tier once, under the lock and the port wait: `VITEST_MAX_WORKERS=4 pnpm run test:browser` into
  `$L/00-base-browser-all.log`. Record the tallies and any failing case by name: Task 4 compares against them.

### Task 1: `PanelStack` follows a panel to another region

**Files:** modify `web/src/panel-stack.ts`, `web/tests/browser/harness.ts`; create
`web/tests/browser/panel-stack-place.test.ts`.

**Interfaces.** Produces, on `StackRegion` and `PanelStack`:

```ts
// StackRegion: what the boundary beside it calls it, asked again at each sync where it is a function.
readonly label: string | (() => string)

// PanelStack: the panel is drawn in the region of that name now, and its maximise, its header's handle and the
// region's open state follow it. Throws an Error for a name the stack has no region of. Ends with a sync.
place(panel: Panel, region: string): void

// PanelStack: run the callback once the stack holds no gesture, at once or as the one it holds ends. A gesture whose
// handle has gone counts as over and is committed first.
whenFree(then: () => void): void
```

`StackRegion.panels` stays the list a region is built with. As in the patch's `panel-stack.ts` hunks: a `#members` map
from region to the panels drawn in it now, seeded from `panels`; `#panelsOf(r)`; and every read that means *now* goes
through it: `#isOpen`'s `some`, `sync`'s `includes(max)`, `#syncHandles`, `#atTop`, and `#handle`, which takes the panel
and finds its region at the press. The reads that mean *built with no header* (`r.panels.length === 0`, twice) and the
constructor's stay on `panels`. `#free()` runs the waiting callbacks at the end of `setSizes`, `#reset` and `#commit`.
Departures 3 and 4 apply: no `holding`; `#name(a, b)` gives "resize a and b" to `#boundary` and to `sync`, which writes
`aria-label` only where it differs.

- [ ] **Step 1: the fixture and the failing cases.** `harness.ts` gains `hearLoops()`, the `ResizeObserver loop`
  listener with its `afterEach` check, which this file and every later new browser file calls. A host on the page, a
  flex column 600px tall, holding three regions built with `createPanel`: `top` (one panel, its own element, share 2),
  `row` (a `div`, a flex row, holding panels `a` and `b`, share 1, its label a function of the panels it holds), `own`
  (a `div` holding panel `m`, share 1). Each region's inline style gives it `flex: var(--share, 1) 1 0`; each panel is
  a flex column filling its region's height and each body `flex: 1 1 0` with a `min-height`, so every body stands over
  its floor and a gesture can move with no stylesheet rule for these names (`.panel` has no layout rule of its own).
  *Moving `m`* below is: append `m.el` to `row`'s element, then `stack.place(m, 'row')`. Cases:
  1. *grows the region a placed panel is in now under its maximise*: built with sizes `{ row: 0.4 }`; move `m` and press
     its maximise; `row`'s `--share` is `1`, where a stack that still read `m` in `own` would leave it `0.4`.
  2. *reads a region none of whose panels is left as closed*: move `m` without hiding `own`; the boundaries are
     `top|row` alone.
  3. *makes a placed panel's header a handle for the boundary above its new region*: move `m`; `m`'s header has
     `data-resizes="true"`; then close `top`'s panel, and none of `a`'s, `b`'s and `m`'s has it.
  4. *names a boundary by its regions' labels, a function's asked again at each sync*: `top|row`'s `aria-label` before
     and after the move.
  5. *throws for a region the stack does not hold*: matched by its message, which names the region, since `place` not
     being a function is a throw too.
  6. *runs what waits for no gesture at once*; and *runs it once, after a held gesture ends*: focus `top|row`, hold
     `{ArrowDown>}`, assert as a precondition that `top`'s height changed (the gesture began), call `whenFree(spy)`: not
     called; release the key: called once; a second gesture calls it no more.
  7. *runs it when the held gesture is dropped, not ended*, three ways, each from a held `{ArrowDown>}` with case 6's
     precondition: `whenFree(spy)` and then `Enter`, which resets the boundary: called once, the keys' release calling
     it no more; `whenFree(spy)` and then `stack.setSizes({})`: called once; and the boundary's element removed by hand
     before `whenFree(spy)`: the gesture counts as over and the spy is called at once.
- [ ] **Step 2:** `BROWSER tests/browser/panel-stack-place.test.ts`. Expected: it fails to compile, or every case fails
  on `place` or `whenFree` not being a function.
- [ ] **Step 3:** build it in `panel-stack.ts`. Rewrite `StackRegion.panels`' doc for *as built* (§8 lists it). Leave
  the constructor's comment on wrapping: it stays true until Task 4.
- [ ] **Step 4:** the new file passes; `BROWSER` `AFFECTED` exit 0, Task 0's tallies and the new file's; `TSC`, `LINT`,
  `COMMENTS` exit 0.
- [ ] **Step 5: sabotages**, each against the new file. S9, `sync` reads `r.panels.includes(max)`: case 1 fails. N1,
  `#syncHandles` iterates `r.panels`: case 3. N2, `#isOpen` reads `r.panels.some`: case 2. S3, `sync` does not write the
  label: case 4. N3, `#commit` does not call `#free`: case 6's second half. N10, `#reset` does not call `#free`: case
  7's first way. N11, `setSizes` does not call `#free`: its second. N12, `whenFree` commits no gesture whose handle has
  gone: its third.
- [ ] **Step 6: commit.** *After it the app is as it was: nothing calls the new methods.*

### Task 2: A machine panel's header is one line, and gives way by its count

**Files:** modify `web/src/machine-panels.ts`, `web/src/style.css`; create `web/tests/browser/machine-views.ts`,
`web/tests/browser/machine-panel-headers.test.ts`.

**Interfaces.** In `machine-panels.ts`: the three builders add `machine-panel` to their panel's element, through one
private helper that wraps `createPanel` for all three; `countNote(): { readonly el: HTMLElement; show(text: string):
void }`, whose `el` is the `span.panel-note` holding one `span` for the text, and whose `show` writes the text and the
same words as `title`, removing the `title` for an empty count. Produces for later tasks, from `machine-views.ts`:
`VIEWS` (for `rxm` and `clif`: `kind`, `values` the first panel's name, `wide` and `medium` in px as §5.1's table has
them, `parts`, `build`), `mount(view, width, o?)` returning `{ host, pane, draw(counts), sizes }`, the `Counts` type,
`resize`, `whole(el)`, the readers `row`, `header`, `note`, `title`, `maximise` and `box`, all as the patch's
`machine-row.test.ts` defines them above its first `describe`, but `mount`: its `o` takes the stored `panels` too and
it returns the pane, for Task 5's closed heap and Task 6's `setScratch`. The loop-error listener is `harness.ts`'s
`hearLoops()`, Task 1's.

- [ ] **Step 1: the fixture and the failing cases**, for each view, from the patch's cases of the same names: *gives
  each count its whole text as its tooltip, cut short or not*; *draws a cut count only where its first character and an
  ellipsis fit*; *gives way by the count, then by the title, never by a button, in a column too narrow for its header*;
  and *keeps every header one line as a run's counts grow*, here at host widths 240, 200 and 110 with the patch's five
  `runs`, open and closed. Today's row wraps one panel a line at those widths, so each panel is as wide as its view, as
  in the prototype's narrow. The give-way case holds one thing the patch's does not: each button's left edge is at or
  right of its `.panel-actions` box's left edge and of the toggle's right edge, since a button clipped by that box keeps
  its bounding width and its right edge.
- [ ] **Step 2:** `BROWSER` the new file. Expected: each case fails (no `title`; the title is never cut; a header at
  110px is taller than a line).
- [ ] **Step 3:** build `machine-panels.ts` as above, and in `style.css` the patch's block that begins *A MACHINE
  PANEL'S HEADER IS ONE LINE*, each selector written once on `.machine-panel` (`.machine-panel > .panel-header`, its
  `> .panel-toggle` and `> .panel-actions`, `.machine-panel .panel-name`, `.machine-panel .panel-note`), and the
  container query on the count's inner span scoped the same way.
- [ ] **Step 4:** the new file passes; `BROWSER` `AFFECTED` exit 0 (`tm-view-narrow` among them reads these counts);
  `TSC`, `LINT`, `COMMENTS` exit 0.
- [ ] **Step 5: sabotages**, against the new file. SB3, `show` sets no `title`: the tooltip case. SB4, the toggle
  `flex: none`: the give-way case, at *then the title gives way*. SB5, the count no container: the fragment case's
  precondition. SB6, no container query: the fragment case. S6, the header may wrap: the one-line case. N4, the
  actions may shrink under their buttons (`min-width: 0; overflow: hidden` on `.machine-panel .panel-actions`): the
  give-way case, at a button's left edge.
- [ ] **Step 6: commit.** *After it: in today's layout the registers or values, call stack and heap headers never
  wrap; a count too long for its header is cut with "…" and shows whole on hover. Until Task 4 a closed call stack in
  the row draws no count: `flex: none` sizes it by its content, to which a contained count adds no width (derived from
  the rules, not measured; the report says what is drawn).*

### Task 3: The decision and the move, on their own

**Files:** create `web/src/machine-row.ts`, `web/tests/node/machine-row.test.ts`,
`web/tests/browser/machine-row.test.ts`.

**Interfaces.** Produces, as the patch's `machine-row.ts` has them:

```ts
export type Arrangement = 'wide' | 'medium' | 'narrow'
// All in px: wide where the three columns and two gaps fit, medium where the first two and one gap do.
export function arrangementFor(width: number, columns: readonly [number, number, number], gap: number): Arrangement
// Put el last in parent, the focus staying where it was inside el.
export function moveInto(parent: HTMLElement, el: HTMLElement): void
```

- [ ] **Step 1: the failing cases.** Node, *arrangementFor*: with `[118, 236, 236]` and a 16px gap, 622 and 900 are
  wide, 621.99 and 370 medium, 369.99 and 0 narrow; with `[288, 288, 288]`, 896 wide, 895 and 592 medium, 591 narrow.
  Browser, *moveInto keeps the focus on a button inside what it moves*, three ways: with `moveBefore` (precondition: the
  browser has it); with `Element.prototype.moveBefore` deleted and put back in a `finally`; with a `moveBefore` that
  throws. And *appends where the parent is off the page*, without throwing.
- [ ] **Step 2:** `NODE machine-row` and `BROWSER tests/browser/machine-row.test.ts`: both fail to import.
- [ ] **Step 3:** build the two functions.
- [ ] **Step 4:** both pass; `FIREFOX tests/browser/machine-row.test.ts` exit 0 (§6.6: that `moveBefore` keeps the focus
  in Firefox is tested, not assumed); `TSC`, `LINT`, `COMMENTS` exit 0.
- [ ] **Step 5: sabotages.** S10, a plain `append` and no refocus: all three focus cases fail. S11, the fallback
  without the refocus: the second and third. S1, `>` for `>=` in `arrangementFor`: the node case, at 622 and 896. N13,
  the `isConnected` guard dropped from `moveInto`: the off-page case; if nothing fails, the `catch` alone covers a
  parent off the page, the guard goes, and the report says so.
- [ ] **Step 6: commit.** *After it the app is as Task 2 left it.*

### Task 4: The row and its three arrangements

**Files:** modify `web/src/machine-row.ts`, `rxm-pane.ts`, `clif-pane.ts`, `panel-stack.ts` (two comments), `style.css`,
`web/tests/browser/machine-views.ts`, `machine-row.test.ts`, `panel-boundaries.test.ts`, `panel-maximise.test.ts`,
`rxm-pane.test.ts`.

**Interfaces.** Consumes Task 1's `place`, `sync` and function labels, and Task 3's two functions. Produces:

```ts
export type MachineRowOptions = {
  readonly values: Panel
  readonly stack: Panel
  readonly heap: Panel
  // Each one's least width in the row, in rem: the thresholds and the columns' proportions both come from it.
  readonly columns: readonly [number, number, number]
}
export class MachineRow {
  readonly el: HTMLDivElement           // .rxm-machine, laid out by its data-arrangement
  readonly heapRegion: HTMLDivElement   // .machine-heap: holds the heap in medium and narrow, hidden in wide
  readonly regions: readonly [StackRegion, StackRegion]   // the stack's 'machine' and 'heap', built once
  constructor(o: MachineRowOptions)
  get arrangement(): Arrangement
  // Choose the arrangement from host's width from now on: at once where host is on the page, and in each frame its
  // box changes, before that frame is painted.
  follow(host: HTMLElement, stack: PanelStack): void
}
```

As the patch's `MachineRow`, with Departures 5 and 6. The `machine` region's label is a function: the three panels'
names as "a, b and c" in wide and the first two as "a and b" otherwise, from the panels' toggles; its `bodies` are the
open panels the row holds now. `follow` observes `host`'s border box; the width is that box less `host`'s computed
padding and border; rem is the root's computed font size and the gap the row's computed `column-gap`, both read at each
decision; a width of 0 keeps the arrangement. A switch sets `data-arrangement`, and where the heap changes side it shows
the heap's region before moving the heap into it, or hides it after moving the heap out, with `moveInto`, then
`stack.place`; where the heap stays, `stack.sync()`. This task does not yet defer under a gesture or hand a boundary's
focus on: Task 5.

The views: `columns: [18, 18, 18]` in `rxm-pane.ts`, `[7.375, 14.75, 14.75]` in `clif-pane.ts`; each appends `row.el`
then `row.heapRegion` where it appended the row and the heap, spreads `row.regions` where its two region literals were,
and calls `row.follow(host, stack)` after building the stack. The stylesheet: the patch's `style.css` hunks but the
header block, which Task 2 built. The comments §8 lists are rewritten with their code here: the stylesheet's block
above `.pane[data-kind="rxm"]` and the closed-panel rule's, `rxm-pane.ts`'s two and its class doc, `clif-pane.ts`'s, and
`panel-stack.ts`'s constructor comment and `#atTop`'s doc (a column, not a wrap).

- [ ] **Step 1: the fixtures.** `machine-views.ts` gains `arrangement`, `drawnAs`, `columnsOf` and `boundaryKeys`, as
  the patch defines them, for this task's cases and Task 6's. `panel-boundaries.test.ts`'s, `panel-maximise.test.ts`'s
  and `rxm-pane.test.ts`'s mounts default to 800px, and `rxm-pane.test.ts`'s *a closed machine panel* cases change as
  the patch's hunks have them: the first two in their assertions (a closed panel's width is its column's, to the pixel,
  where it was under 0.3 of the row or its neighbour over 0.8), the third in its width alone.
- [ ] **Step 2: the failing cases** in `machine-row.test.ts`, for each view, from the patch's cases of the same names:
  - *switches at each threshold one pixel either side, both ways, and draws what it chose* (`drawnAs`, by geometry).
  - *draws the regions and boundaries of each arrangement*, extended twice: which headers have `data-resizes` after
    each switch (wide: all three; medium: all three; narrow: the first panel's and the heap's, not the call stack's);
    and, in medium, the heap's region hidden by hand computes `display: none` (Departure 7).
  - *names the boundary above the row for what the row holds*.
  - *is drawn in its arrangement from the first frame, built on the page, added to it, or shown*, extended: a view
    parked while wide and shown at a narrow width is narrow in the first frame it has a width.
  - *reports no ResizeObserver loop over a resize sweep, in a view short enough to scroll*.
  - *keeps a closed panel at its column in every arrangement, with no gap under it in narrow*.
  - *draws its columns in their parts of the row at each threshold and wider, values the narrowest*.
  - *gives a maximised panel in narrow all the spare height, its closed neighbour its header*.
  - New, Review Focus 1: *reads its host's width less its padding and border*: a host with `box-sizing: border-box`,
    `padding: 0 10px` and `border: 1px solid` is medium at `wide + 21` px and wide at `wide + 22`.
  - New, Review Focus 2: *takes its thresholds from the root's font size*: with the root at 20px, put back in a
    `finally`, rxm is medium at 1119px and wide at 1120, CLIF medium at 777 and wide at 778.
- [ ] **Step 3:** `BROWSER` the four files. Expected: the new cases of `machine-row.test.ts` fail (no
  `data-arrangement`); the two `rxm-pane` cases whose assertions changed fail; the 800px fixtures' other cases pass,
  the third *closed machine panel* case among them.
- [ ] **Step 4:** build `MachineRow`, the two views and the stylesheet.
- [ ] **Step 5:** `BROWSER` `AFFECTED` exit 0; `FIREFOX` `AFFECTED-FF`: the 3 base failures and no other; `TSC`, `LINT`,
  `COMMENTS` exit 0. Then the whole Chromium tier as in Task 0, into `$L/04-browser-all.log`: every case that passed in
  `00-base-browser-all.log` passes. A case that fails is run alone in `$W` and in `$B`; one that reads the heap's region
  or a wrapped row at a width this task changed is fixed here by its fixture's width, and named in the report.
- [ ] **Step 6: sabotages**, against `machine-row.test.ts` unless said. S2, the heap's region not hidden in wide:
  *regions and boundaries*. S3, the `machine` label a fixed string: *names the boundary*. S4, no decision at build and
  the observer's deferred to a `requestAnimationFrame`: *first frame*. S5, `follow` observes the row: *no loop*. S7, the
  old closed-panel rule (`flex: none` in a row): *closed panel*, and two `rxm-pane` cases. S8, a closed panel in the
  column flexes: *closed panel* and *maximised in narrow*. SB1, CLIF's columns `[11, 11, 11]`: *columns in their parts*
  and *switches*. SB2, the stylesheet ignores `--column`: *columns in their parts* and *closed panel*. SB7, rxm's first
  column 17rem: *columns in their parts* and *switches*. N5, the `:not([hidden])` guard dropped from the heap region's
  `display` rule: *regions and boundaries*, at the hidden region. N6, no `sync` on a switch that does not move the heap:
  the same case, at the call stack's handle in narrow; if N6 does not fire because the stack's own observer reads the
  handles again, say so: the call is then redundant and goes. N7, the width read as the border box whole: *padding and
  border*. N8, rem fixed at 16: *root's font size*.
- [ ] **Step 7: commit.** *After it: both views draw the three arrangements and switch as the view is resized, and
  closed panels keep their columns. Still to come: a switch can happen under a held boundary, and a focused boundary
  that a switch removes drops the focus to the page.*

### Task 5: What a switch keeps

**Files:** modify `web/src/machine-row.ts`, `web/tests/browser/machine-row.test.ts`, `panel-boundaries.test.ts`.

**Interfaces.** Consumes Task 1's `whenFree`. `MachineRow`'s API does not change. Built here: a switch asked for while
the stack holds a gesture waits for `whenFree`, one callback at a time, and decides again from the width then (§6.7); a
focused `.panel-boundary` that the switch takes off the page hands the focus to the heap's toggle (§6.6).

- [ ] **Step 1: the cases**, for each view, from the patch's of the same names.
  - Red first: *hands a focused boundary the switch takes away to the heap's toggle*; *makes no switch while a gesture
    is held, and makes it when the gesture ends*.
  - Already built, so proven by sabotage: *keeps a maximise across a switch, the region its panel is in now taking the
    spare height* (built with `{ machine: 0.4 }`); *keeps the focus on the heap's toggle across a move*, with
    `moveBefore` and with the fallback, and the same for the heap's maximise button; *keeps the heap's stored share in
    wide, and the dragged ratio of listing and row in medium*; and in `panel-boundaries.test.ts`, at 1000px, *in a view
    wide enough for one row, is the heap's too: it drags the boundary above the row*, and a case of its own after it,
    *and a double click on it puts the listing and the row back*: the shares stored then hold neither `listing` nor
    `machine`.
  - New, Review Focus 3: *keeps a closed heap closed across both switches*: built with the heap stored closed, in wide
    its bar is its column's width and its header's height; in medium the bar is the row's full width under the row and
    the boundaries are `listing|machine` alone; opened in wide, it is as tall as the row.
  - New, Review Focus 4, rxm only: *on a copy, parts the row from the outline in wide*: the boundaries under the
    listing are `listing|machine` and `machine|outline` in wide, and `listing|machine`, `machine|heap` and
    `heap|outline` in medium; a focused `heap|outline` boundary hands the focus to the heap's toggle at the switch. Get
    the copy the way `panel-regions.test.ts` or `panel-sizes-stored.test.ts` gets an rxm copy's outline on the page; if
    neither gives one a hand-built `RxmPane` can use, the case moves to Task 6, built through the app in
    `machine-row-app.test.ts` with its S12 sabotage run there, and this task's report says so.
- [ ] **Step 2:** `BROWSER` the two files: the two red-first cases fail, at *under the held key* and at the active
  element; the rest pass.
- [ ] **Step 3:** build the deferral and the handoff.
- [ ] **Step 4:** `BROWSER` `AFFECTED` exit 0; `FIREFOX` `AFFECTED-FF`: the 3 base failures and no other; `TSC`, `LINT`,
  `COMMENTS` exit 0.
- [ ] **Step 5: sabotages.** S9 through the view, `MachineRow` never calls `place`: *maximise across a switch*. S11b,
  the heap's region shown after the heap moves back: the fallback's focus cases, at *out of it*. S12, no handoff: the
  boundary case. S13, no deferral: the gesture case. S14, `#commit` drops the shares of regions that are closed: the
  stored-share case. S15, `#handle` finds its region once, as built: both 1000px cases in `panel-boundaries`. S10
  through the view, the switch appends the heap's element itself: every focus case. And from Task 4 again: S7, the
  closed-heap case at its bar's width in wide; S12 fails the copy case too, at the focus. S2 is not run against the
  copy case: the stack reads a region with no member as closed (Task 1's case 2), so the boundaries there do not turn
  on the region being hidden.
- [ ] **Step 6: commit.** *After it the design's behaviour is whole in both views.*

### Task 6: The numbers hold: counts at the thresholds, scroll bars, the app

**Files:** modify `web/vite.config.ts`, `web/tests/browser/machine-panel-headers.test.ts`; create
`web/tests/browser/machine-row-scrollbars.test.ts`, `machine-row-app.test.ts`. No source change is expected: a case that
needs one is a finding, reported with its fix.

- [ ] **Step 1: counts.** In `machine-panel-headers.test.ts`: the patch's *holds each count whole in its header $width
  px wide* with its `WHOLE` table (rxm at 896 and 592 with the largest counts; CLIF at 622 and 370 with "2 frames" and
  "57 cells · 2 boxes", and at 634 with "1,234 frames"), each asserting its arrangement first and each title whole; and
  Task 2's one-line case gains the widths `view.wide` and `view.medium`, where the columns are their narrowest.
- [ ] **Step 2: scroll bars.** `machine-row-scrollbars.test.ts`, added to `SCROLLBAR_FILES`, from the patch's two cases
  and on `machine-views.ts`: *keeps the arrangement when a line the view shows brings a bar in at the threshold, the
  row under it* (rxm; preconditions: no bar before, a bar of 10px or more after, the row under 896px); *settles at once
  at every width across the threshold where medium scrolls and wide does not*, for both views at their wide
  thresholds, 20px either side, six frames a width with one arrangement seen.
- [ ] **Step 3: the app**, Review Focus 5. `machine-row-app.test.ts`, mounted as `clif-shown.test.ts` mounts (`mountAt`,
  the header's toggles), with the source and one machine view shown: in a 1280px window the CLIF view's row is `wide`
  and the rxm view's `medium`; in a 1024px one `medium` and `narrow`; each read as `data-arrangement` and as drawn
  (`drawnAs`), two frames after the view is shown. The case prints each view's content width with `console.error`; the
  design measured 634px and 506px, and a width more than 2px from those is reported, not adjusted to. Then one case
  each for a view shown again after its toggle hid it, and for one chosen as a Stage tab (`pickPreset('stage')`,
  `pressTab`): each is drawn in the arrangement its width gives. The first frame's timing is Task 4's, on bare hosts;
  this file holds the app's hosts and widths. If Task 5 moved the copy case here (Review Focus 4), it is built in this
  file.
- [ ] **Step 4:** `BROWSER` `AFFECTED` exit 0; `SCROLL` both scroll-bar files exit 0 (the base's one loop line may
  print; a second is a finding); `FIREFOX` `AFFECTED-FF`: the 3 base failures and no other; `TSC`, `LINT`, `COMMENTS`.
- [ ] **Step 5: sabotages.** SB1 again: the three CLIF *count whole* cases fail. S16, the decision reads the row's
  `clientWidth`: both scroll-bar cases. N9, CLIF's columns as rxm's: the app file's 1280px case. S4 again, against the
  app file: none of its cases has to fail; say in the report whether one does. S12 again, if the copy case is here: it
  fails at the focus.
- [ ] **Step 6: commit.** *After it the app is as Task 5 left it: this task adds tests alone.*

### Task 7: The full gate, before review

**Files:** none unless a leg fails. One agent, with no other browser run on the machine.

- [ ] The web job as CI runs it, from `$W/web` with `CARGO_TARGET_DIR=$T`: `pnpm run build:wasm`, `build:lsp-wasm`,
  `build:clif-wasm`, `build:bindings`, `../scripts/check-licences.sh --self-test` and then alone, `LINT`, `TSC`, `pnpm
  run test:coverage`, `pnpm run build:app`. `test:coverage` runs under the browser lock and a memory cap, in a transient
  unit that outlives the harness: `flock /home/davey/temp/redextape-browser.lock systemd-run --user --wait -p
  MemoryMax=16G -p MemorySwapMax=0` with `--setenv` for `PATH`, `HOME`, `CARGO_HOME`, `RUSTUP_HOME`, `CARGO_TARGET_DIR`
  and `VITEST_MAX_WORKERS=4`. Expected: exit 0 each, the coverage thresholds met.
- [ ] What CI runs beyond that, from `$W`: `scripts/check-all.sh`; `cargo llvm-cov nextest --workspace
  --fail-under-lines 90`; `scripts/check-slow.sh`; and each scan that `rg -o 'scripts/check-[a-z-]+\.(sh|mjs)'
  .forgejo/workflows/ci.yml | sort -u` lists, with `--self-test` and then alone. The branch changes no Rust, so the Rust
  legs prove the worktree's toolchain and nothing of this change; they run all the same.
- [ ] `FIREFOX` `AFFECTED-FF` once more at the head: the 3 base failures and no other.
- [ ] **By hand in Firefox** (§6.10), arranged by the controller from `pnpm run build:app` and `vite preview` in
  `$W/web`, screenshots into `$L/hand/`: a resize across both thresholds in each view; a maximise in each arrangement;
  the focus on the heap's toggle across a switch each way. Davey tries the branch in Firefox too before giving the word
  to push.
- [ ] A leg that fails is fixed in a commit of its own, test first, and the legs its files feed run again.

### Task 8: Docs, the design as built, the roadmap entry

**Files:** modify `docs/superpowers/specs/2026-11-21-machine-panels-row-design.md`,
`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`; `web/help.html` only if the search finds a stale line.

- [ ] **User docs.** Search `web/*.html`, `README.md` and `docs/*.md` for *panel*, *call stack*, *heap*, *registers* and
  *values*, and read each hit against the built behaviour. Verified facts says what was there at `fc8f480`: nothing
  stale. Report what the search finds now; change a line only where it has become false.
- [ ] **Comments.** Search `web/src/rxm-pane.ts`, `clif-pane.ts`, `panel-stack.ts`, `machine-row.ts` and the
      stylesheet's
  machine rules for *wrap*: no comment still says the row wraps, that a closed panel takes no share of the row, or that
  the heap is always a region of its own. Dated specs stay as written (§8).
- [ ] **The design.** Add a last section, *§11 As built*: this plan's path, the range of commits, and one line for each
  place the build differs from the doc's text (the Departures that touch what the doc says, and anything the tasks
  reported). Change no other section.
- [ ] **The roadmap entry**, appended at the end of the roadmap in the shape its last entries have: the `####` heading
  with the date, the branch `panels-row`, the commit range, which excludes the entry's own commit, and the count;
  `#####` sections in the entry's own voice, among them what changed for a person using the views, the departures from
  the prototype and the sabotage table (id, edit, cases failed, log); `##### WHAT THIS DID NOT CLOSE`, from the list
  below; `##### VERIFICATION`, ending with **Every count this entry quotes, with what produces it**, one row a figure
  with the command that prints it from `$L`'s logs or the tree. Run every one of those commands before committing;
  write values and SHAs, not "the only" or "all". The figures are taken after the last code commit.
- [ ] Commit the design and the entry together.

**What this did not close**, for the entry: a root font size changed while a view is open leaves its arrangement as it
was until the view is next resized, since the decision runs on a resize; Terminal's and Paper's header widths are this
machine's fonts and no test holds them (§5.5); WebKit is unmeasured (§6.6); the maximised heap's width in wide is the
designer's call (§10); the three Firefox drag cases that fail at base.

### Task 9: Whole-branch review

**Files:** none. A fresh reviewer, given the design, this plan and `git diff 1ac4fc4..HEAD`, not the task reports.

- [ ] Review the branch as one change. Beyond the diff: every reader of `.rxm-machine`, `[data-region="heap"]`,
  `.panel-note` and `StackRegion.label` in `web/src` and `web/tests` that no task touched; each anti-goal of §2 against
  a test that would fail if it broke; each of §6's ten constraints against its case and its sabotage log in `$L`; the
  Departures list against the code; every comment the branch adds, for why only; the roadmap entry's claims against
  the commands beside them. Findings go to `$L/review.md`, each with a severity, the file and the symbol.

### Task 10: Fix what the review found, and the gate again

**Files:** as the findings need.

- [ ] Each finding is checked before it is acted on: a finding is a claim. One that holds is fixed test first, in a
  commit of its own, with a sabotage where it adds a test, and its class is searched for siblings. One that does not
  hold is answered in `$L/review.md` with the evidence.
- [ ] Then Task 7 again for every leg the fixes' files feed (all of the web job if any file under `web/` changed) and
  `FIREFOX` `AFFECTED-FF`, and a last commit that brings the roadmap entry and the design's §11 up to the fixes, its
  figures run again.
- [ ] Report the head SHA and the tallies. **Stop there**: pushing and opening the pull request wait for Davey's word.

## Design coverage

| Design | Task |
|---|---|
| §2 G1, §5.2 closed and maximised panels, narrow a column | 4 (closed panel, maximised in narrow; S7, S8) |
| §2 G2, G4, §5.1 arrangements, thresholds, columns | 3 (`arrangementFor`), 4 (switches, columns; SB1, SB2, SB7), 6 (the app) |
| §2 G3, §5.3 regions, boundaries, names, stored shares | 1, 4 (regions, names), 5 (stored shares, the heap's handle) |
| §2 non-goals: TM, other views, nothing stored | File structure's TM paragraph; `AFFECTED`; 5 (*a switch stores nothing*) |
| §2 anti-goals | 4 (first frame, no loop), 6 (no flicker under a bar), 2 and 6 (a header's height on a step) |
| §5.4 what switches it | 4 (padding and border, root font size), 6 (scroll bars) |
| §5.5 headers | 2 (give-way, fragment, tooltip), 6 (counts whole at the thresholds) |
| §6.1 first paint | 4; 6 for the app's hosts |
| §6.2 no loop error | 4 (S5), and every new file's listener |
| §6.3 no oscillation | 6 (S16) |
| §6.4 headers one line | 2 (S6), 6 |
| §6.5 a maximise across a switch | 1 (S9), 5 |
| §6.6 focus across a move | 3 (S10, S11, N13, Firefox), 5 (S11b, S12) |
| §6.7 a gesture across a switch | 1 (`whenFree`; N3, N10 to N12), 5 (S13) |
| §6.8 stored shares both sides | 5 (S14) |
| §6.9 what wide hides stays hidden | 4 (N5); `hidden.test.ts` in `AFFECTED` |
| §6.10 Firefox | 0 and 3 to 7 (`AFFECTED-FF`); 7 by hand |
| §7 fixtures and changed cases | 4; the 1000px cases in 5 |
| §8 docs and comments | 1 and 4 (comments with their code), 8 |
| §9 left to the builder | Architecture; Departures |
| §10 the designer's calls | Global Constraints, *Settled* |

## Open, for Davey

- A root font size changing under an open view (Task 8's *did not close*) is accepted here as a limit, since the design
  switches on width alone. Say if it should be closed in this branch.
- Who makes §6.10's pass by hand in Firefox before the push: the plan has the controller drive it and Davey try it.
