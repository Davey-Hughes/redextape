# IR views groundwork PR 4: panes, layout and links — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the design's PR 4 (§6): pane building blocks (§5.2), layout for N view kinds (§5.3) and links that can
name one rxm instruction (§5.4), with no change to what any existing view shows or does.

**Architecture:** Three web workstreams on one branch, each commit leaving the app unchanged. Layout generalises the
default grid and generates the header toggles from the tables at build time. Links put the linked legs in one table
and let a pin carry a pc. Panes extract the chrome, the followed grid and the machine panels out of `RxmPane` and
`TmPane`, and build views from tables in `applyLayout`.

**Tech Stack:** TypeScript 7 (`tsc`), Vite 8, Vitest 4 browser mode on Playwright (Chromium and Firefox), biome.

**Spec:** `docs/superpowers/specs/2026-10-27-ir-views-groundwork-design.md` (§1, §5.2 to §5.4, §6, §7.2, §7.3, §8, §10,
§11). Evidence: `survey-panes.md`, `survey-layout.md` and `survey-links.md` in `$R` (below). Each task names the survey
task it traces to.

## Global Constraints

- **Paths.** `W=/home/davey/temp/redextape-ir-panes` (branch `ir-panes`, base `6b77731`),
  `R=/home/davey/temp/redextape-ir-panes-record`. Commands run from `$W/web` unless they say otherwise. Logs go in
  `$R/logs/`, written with `>|` (the shell has `noclobber`), and the summary is read from the log: piping a run through
  `tail` hides its exit status.
- **Line references.** Every `file:line` in this plan is at `6b77731`. After an earlier task has edited a file, find the
  place by its name.
- **Cargo.** Every cargo or wasm-pack run sets `CARGO_TARGET_DIR=/home/davey/.cache/redextape-ir-panes-target`.
- **Nothing changes for a user** (§1 non-goals, §8). No new view, pane kind, leg, stored key or workspace version.
  `WORKSPACE_VERSION` stays 2. No `crates/` file changes.
- **Node tier:** `pnpm exec vitest run --project node <files>`.
- **Browser tier, Chromium:** `flock /home/davey/temp/redextape-browser.lock env VITEST_MAX_WORKERS=6 pnpm exec vitest
  run --project browser <files>`.
- **Browser tier, Firefox:** every browser file a task lists runs here too, as they are all UI-facing:
  `flock /home/davey/temp/redextape-browser.lock env REDEXTAPE_FIREFOX=1 VITEST_MAX_WORKERS=6 pnpm exec vitest run
  --project firefox --project firefox-capture <files>`. Both project names are always given, because a file in
  `CAPTURE_FILES` (`web/vite.config.ts`) runs only in `firefox-capture`. A Firefox failure is run again on the base
  worktree from Task 1: one that also fails at `6b77731` is recorded in the task's report and is not this branch's.
- **Sabotage.** `cp <file> $R/sab/<name>`, make the change, run the named test, `cp $R/sab/<name> <file>`, then
  `cmp $R/sab/<name> <file>`. Never `git checkout` to restore. A sabotage that does not fire is a finding: stop and
  report it.
- **Comments say why** (`CLAUDE.md`): no history, no measurements, no PR stories. `file:line` references are banned in
  tracked source (`scripts/check-citations.sh`) and allowed in `docs/`. **Move a comment verbatim**: the guard carries a
  moved line only when its exact text is removed elsewhere, and a reworded block over 8 counted lines can fail its
  Rule 2.
- **Commit protocol, every task.** `pnpm exec biome ci --error-on-warnings`, `pnpm exec tsc --noEmit`, the whole node
  tier and the task's browser files pass, then `git commit` through the pre-commit hook. Never `--no-verify`.
- **The comment budget moves during the branch, not only at its end.** The hook runs `node scripts/check-comments.mjs`
  on every commit, and `web/src` already sits 0.0129 under its budget (0.4707 against 0.4836), past the guard's 0.0050
  stale margin. So the first commit with fewer `web/src` comment lines than `6b77731`'s 16,618 is refused (measured on a
  scratch clone: one comment line removed fails with `Lock the gain in: write "web/src": 0.4707`). When the hook refuses
  a commit on Rule 3, in either direction, write the value it prints into `scripts/comment-budget.json` in that same
  commit. Task 18 writes the final value.
- **TypeScript settings that bite here:** `noImplicitOverride` and `exactOptionalPropertyTypes` are on (`web/tsconfig.json`).

## Review Focus

Failure modes the design implies and no existing test exercises, most likely first. Each has its test in the task named.

1. **A row of an rxm copy, clicked with a pin held, must clear the program's pin**, as a TM copy's row does. If the
   gesture count moves ahead of transport's `detached` guard, the click keeps the pin. Task 7.
2. **The built page must carry the toggles.** Vitest serves its own HTML (`web/tests/browser/setup.ts`), so the whole
   browser tier stays green on a page shipped with an empty `#views-shown`. Task 4.
3. **Every stored panel must come back after a reload.** Through `applyLayout` the tests seed only rxm `heap`, TM `rules`
   and `outline` and λ `map`, so a table that lost rxm `registers` or TM `diagram` would pass today. Task 14.
4. **A view's per-frame setters must stay cheap.** `TmPane.setStepsShown` and `TmPane.setDetached` run every frame behind
   guards. Without the guards the screen looks the same and every frame does more work. Task 11.
5. **The rxm re-attach must hand the focus on, and grid cell ids must stay distinct.** Only TM's hand-off is asserted
   today (`web/tests/browser/app.test.ts:1186-1209`), and no test names `rxm-grid-` or `tm-grid-`, though
   `aria-activedescendant` reads those ids. Task 12.

## Decisions the user made

The user accepted the assumed answer to each on 2026-11-18.

| | Question | The plan assumes | If the user answers otherwise |
|---|---|---|---|
| Q1 | How are the header toggles generated? | **At build time.** `index.html` holds the container and a slot, a Vite plugin fills the slot, and the shipped page is unchanged. | **At run time:** Task 4 is rewritten (`viewToggles` builds the buttons, no slot or plugin, `view-toggles-first-paint.test.ts` goes, the harness's `SHELL` loses them), Task 5 drops that file's pins, and four header controls move 147.5 to 154.0 px when the wasm arrives. **Written by hand:** Task 4 is dropped, and G6's "generated" is not met. |
| Q2 | Does `PaneKind` derive from `Leg`? | **Yes:** `'source' \| Leg`. | Task 3 keeps the keyed `HEADER_ORDER` and drops the type change. Nothing else moves. |
| Q3 | Do the per-leg display settings move in this PR? | **Yes**, as Task 15, the last panes task and the first to cut if the PR grows. | Task 15 is dropped, and Task 20's entry names the family under WHAT THIS DID NOT CLOSE. |
| Q4 | Does a click on a TM state carry a pc? | **No.** Only an rxm click carries one, and nothing reads it yet. | Task 7 adds `pc` in transport's `linkState` handler from the state's instruction, with a test beside the rxm cases, and Task 8's fan-out test covers it. |

## Departures from the design

| Design says | This plan does | Evidence |
|---|---|---|
| §5.3: the toggles are generated and `index.html` "keeps a container only" | The source file keeps the container and one slot comment. The buttons are generated from the tables at **build time**, not at run time. | The view layouts spec moved them into the markup because building them after the wasm loaded moved four controls right by 147.5 to 154.0 px (`docs/superpowers/specs/2026-10-11-view-layouts-design.md:500-502`, `:1073`). `web/tests/browser/view-toggles-first-paint.test.ts` holds that. |
| §5.2: `ListingPanel`, with "both use the extractions" | Two layers. `followedGridPanel` (the grid, its panel and the re-attach) is used by both views. `ListingPanel` sits on it and is used by rxm alone. | TM's rule table has no listing or labels: its rows are `StateIndex`'s states and rules (`web/src/tm-pane.ts:269-286`). What the two share is `web/src/rxm-pane.ts:141-181` against `web/src/tm-pane.ts:250-310`. |
| §5.2: "The heap panel reads the heap core's tagged view", with `registerRows`, `calleeOf` and `wordText` passed in | The panels take finished text rows. Pure builders in `rxm-view.ts` call those three. | The tags reach the web only as `RxmCell` and `RxmBox` windows on `RxmState` (`crates/redextape-core/src/viewmodel.rs:804-814`). native-rt's heap is `Heap<NoTags>` (`crates/redextape-native-rt/src/lib.rs:35`), so a later native pane would have no tags to pass. |
| §5.4: `link-wiring.ts`, `draw.ts` and `link-status.ts` fan out over a table | A fourth fan-out moves too: `main.ts`'s direct `setLink([], false)` calls go into `clearLink`. | `web/src/main.ts:2836-2837`. Left alone, a new leg would keep its marks on a keystroke. |
| §5.2: "`listingRows` and `programRows` become one" | One walker, `placeLabels`, under both. The two keep their names. | `programRows` adds a tier gate, a `steps` row and a runtime tail (`web/src/program-level.ts:41-44`, `:52-55`) that a listing has no use for. |
| §5.3: unit tests of `defaultArrangement` over synthetic lists of 5 to 7 | The tests go through `gridArrangement`, over 5 to 9 views. | `defaultArrangement` takes `PaneKind[]` and filters by `KIND_ORDER` (`web/src/layout.ts:139`), so a synthetic kind would be dropped. |
| §5.3: tests that pin four "derive from the tables" | Most do. The ones that pin the user's order keep their literals. | A derived line follows the table "right or wrong" (`web/tests/node/view-keys.test.ts:49`), so deriving them would blind the tests to #186's order. |

## Order of the work

Layout, then links, then panes, then the closing tasks.

| Tasks | Workstream | Why here |
|---|---|---|
| 1 | Setup | Every later command needs `node_modules`, `pkg/` and `web/bindings/`. |
| 2 to 5 | Layout (§5.3) | The smallest and least coupled. |
| 6 to 9 | Links (§5.4) | Before panes, so `LinkedPane` pins by type the three methods the pane extractions must keep public. |
| 10 to 15 | Panes (§5.2) | The largest moves land on a stable base. Task 15 is last so it can be cut without touching the others. |
| 16 | §7.2 timing | Runs on the finished code, so a slowdown is found before the gate is spent. |
| 17 | §7.3 walkthrough | Any defect it finds is fixed before the budget is written. |
| 18 | Comment budget | The last code commit, so the value it writes describes the final tree. |
| 19 | Full gate | Runs over the last code commit, and the entry quotes its figures. |
| 20 | Roadmap entry | Docs only, last, so every figure it names can be run against the final code. |

Inside layout, Task 5 follows Tasks 3 and 4 because it rewrites pins on lines those tasks touch. Inside links, each task
builds on the previous one's types. Inside panes, Task 12 needs Task 10's `Labels` and Task 11's base class.

**Merged from the surveys' 15 tasks:** layout's task 4 (view keys, a doc line and two tests) joins its task 5 as this
plan's Task 5, since both edit `web/tests/node/view-keys.test.ts`. The other 13 keep their boundaries.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `web/src/view-toggle-markup.ts` (new) | The toggles' markup from `HEADER_ORDER` and `KIND_WORD`, and the slot it fills | 4 |
| `web/src/linked-legs.ts` (new) | The table of legs that links fan out over | 6 |
| `web/src/label-rows.ts` (new) | The one label-placement walker | 10 |
| `web/src/machine-view-chrome.ts` (new) | The base class holding header, steps, menu, copy editor and delegates | 11 |
| `web/src/followed-grid-panel.ts` (new) | A `VirtualGrid` in a panel with its re-attach button | 12 |
| `web/src/listing-panel.ts` (new) | The listing: labels, marks and the rows' fill | 12 |
| `web/src/machine-panels.ts` (new) | The values, call-stack and heap panels, and their view types | 13 |
| `web/src/layout.ts`, `panes.ts`, `view-keys.ts`, `index.html`, `vite.config.ts` | The grid rule, the kinds, the toggles' slot | 2 to 5, 14 |
| `web/src/link.ts`, `link-status.ts`, `link-wiring.ts`, `transport.ts`, `draw.ts`, `main.ts` | Pins and their fan-out | 6 to 9, 15 |
| `web/src/rxm-pane.ts`, `tm-pane.ts`, `rxm-view.ts`, `program-level.ts` | Use the extractions | 10 to 13 |
| `web/src/pane-host.ts`, `workspace.ts` | Views and display settings from tables | 14, 15 |

---

### Task 1: Set up the worktree

No survey task: every survey ran without `node_modules` or `pkg/` in the worktree.

**Files:** no tracked file changes, and no commit.

- [ ] **Step 1: Install and build**

```bash
mkdir -p $R/logs $R/sab
cd $W/web
export CARGO_TARGET_DIR=/home/davey/.cache/redextape-ir-panes-target
flock /home/davey/temp/redextape-heavy.lock zsh -c 'pnpm install --frozen-lockfile && pnpm run build:wasm && pnpm run build:lsp-wasm && pnpm run build:bindings' >| $R/logs/setup.log 2>&1
print $?
```

Expected: `0`. `build:wasm` writes `pkg/` and `build:lsp-wasm` writes `pkg-lsp/` at the worktree's root, one level above
`web/`. Install them for real: a symlinked `node_modules` or `pkg/` breaks the font tests and app mounts.

- [ ] **Step 2: Prove the setup**

Run `ls $W/pkg/redextape_wasm_bg.wasm $W/pkg-lsp/*.wasm` and `ls $W/web/bindings | wc -l`, then `pnpm exec tsc --noEmit`,
the whole node tier, and `tests/browser/first-load-views.test.ts` in Chromium and Firefox.
Expected: both `.wasm` files listed, a non-zero bindings count, and every run exits 0. Write the node tier's test count
to `$R/baseline.md`.

- [ ] **Step 3: Make the base worktree**

```bash
git -C $W worktree add --detach /home/davey/temp/redextape-ir-panes-base 6b77731
cd /home/davey/temp/redextape-ir-panes-base/web && pnpm install --frozen-lockfile
cp -r $W/pkg $W/pkg-lsp /home/davey/temp/redextape-ir-panes-base/
cp -r $W/web/bindings /home/davey/temp/redextape-ir-panes-base/web/
```

Expected: `git -C /home/davey/temp/redextape-ir-panes-base rev-parse --short HEAD` prints `6b77731`. Firefox comparisons
and Task 16 use this worktree.

### Task 2: A general rule for the default grid

Traces to survey-layout task 1.

**Files:**
- Modify: `web/src/layout.ts:111-151`
- Test: `web/tests/node/layout.test.ts`

**Interfaces:**
- Produces: `gridLines(count: number): number[]` and `gridArrangement(views: readonly LayoutNode[], shape: Shape): LayoutNode`,
  both exported from `layout.ts`. `defaultArrangement(kinds, shape)` keeps its signature.

**The rule:**
- `lines = ceil(sqrt(n))`, `long = ceil(n / lines)`, `short = lines * long - n`. The first `short` lines hold `long - 1`
  views and the rest hold `long`.
- A line is a column in a wide area and a row in a tall one.
- Views fill in reading order. A tall area fills line by line. A wide area fills one row across all the columns at a
  time, skipping a column that is already full.
- A line of one view is that leaf with no split around it, and one line is the root itself. A split of `k` children has
  sizes of `1 / k` each.
- No views throws `a default arrangement needs a kind or more`, the message the test at `layout.test.ts:179-181` matches.

- [ ] **Step 1: Write the failing tests** in `layout.test.ts`, over synthetic leaves named `'0'`, `'1'` and so on

`it.each` named `'arranges %i views by the rule, written out'` asserts each area's lines against this table, **written as
literals and never computed with `gridLines`**, because a test reading the function under test passes sabotage S5:

| n | wide (columns) | tall (rows) |
|---|---|---|
| 5 | 0 / 1 3 / 2 4 | 0 / 1 2 / 3 4 |
| 6 | 0 3 / 1 4 / 2 5 | 0 1 / 2 3 / 4 5 |
| 7 | 0 3 / 1 4 / 2 5 6 | 0 1 / 2 3 / 4 5 6 |
| 8 | 0 3 / 1 4 6 / 2 5 7 | 0 1 / 2 3 4 / 5 6 7 |
| 9 | 0 3 6 / 1 4 7 / 2 5 8 | 0 1 2 / 3 4 5 / 6 7 8 |

A second test, `'keeps every view once, along the long side, in lines one apart, in a tree parseTree takes'`, asserts for n
from 5 to 9 and both shapes: each id appears once, the root's `dir` is `row` for `wide` and `column` for `tall`, line lengths
differ by at most one, and `parseTree(JSON.parse(JSON.stringify(tree)))` equals the tree.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run --project node tests/node/layout.test.ts`. Expected: FAIL, `gridArrangement` is not exported.

- [ ] **Step 3: Implement** `gridLines` and `gridArrangement`, and have `defaultArrangement` filter by `KIND_ORDER`, build the
  leaves and call `gridArrangement`. Keep its table of one to four kinds in the doc comment.

- [ ] **Step 4: Run the tests**

Run the file again, with `tests/node/arrangements.test.ts` and `tests/node/workspace.test.ts`. Expected: PASS, with
`layout.test.ts:37-182` unedited.

- [ ] **Step 5: Sabotage, one at a time**

| | Change | Must fail |
|---|---|---|
| S1 | short lines last | existing and new tests |
| S2 | a wide area fills line by line | existing and new tests |
| S3 | floor of the square root | existing and new tests |
| S4 | every size 0.5 | the new tests only (`parseTree`) |
| S5 | two lines for any n above 4 | the new tests only (the literals) |
| S6 | kinds kept in the order handed in | `layout.test.ts:150` |

- [ ] **Step 6: Commit** with the subject `The default grid follows one rule for any number of views`.

### Task 3: `PaneKind` from `Leg`, and `HEADER_ORDER` keyed

Traces to survey-layout task 2 and decision Q2.

**Files:**
- Modify: `web/src/panes.ts:8-16` and `:21-24`, `web/src/layout.ts:79-87`

**Interfaces:**
- Produces: `export type PaneKind = 'source' | Leg`. `HEADER_ORDER` stays `readonly PaneKind[]`, read as the keys of a
  record that `satisfies Record<PaneKind, 0>`, written the way `KIND_ORDER` is.

- [ ] **Step 1: Make the two changes.** Keep the key order `source, lambda, tm, rxm`. Rewrite the docs at `panes.ts:8-15` and
  `:21-24`: `'source'` is still not a leg, and a kind that is no leg extends this union while `Leg` stays as it is. Keep
  `legOfPane`'s `switch`. Update `HEADER_ORDER`'s doc.

- [ ] **Step 2: Verify**

Run `pnpm exec tsc --noEmit` and `pnpm exec vitest run --project node tests/node/arrangements.test.ts tests/node/layout.test.ts
tests/node/workspace.test.ts`. Expected: exit 0 and PASS, with `arrangements.test.ts:498-501` still holding the order.

- [ ] **Step 3: Sabotage with `tsc`**

Drop `rxm` from the keyed record: `tsc` reports TS2741 at the record. Add a trial member to `Leg` in `web/src/protocol.ts`:
`tsc` names `HEADER_ORDER`, `KIND_ORDER`, `KIND_WORD`, `DEFAULT_LEAF`, `KIND_GLOSS`, `LANGUAGE_OF_PANE`, `legOfPane` and two sites in `pane-host.ts`.

- [ ] **Step 4: Commit** with the subject `PaneKind is the source or a leg, and the header's order names every kind`.

### Task 4: The toggles from the tables, in the page before it paints

Traces to survey-layout task 3 and decision Q1. Review Focus 2.

**Files:**
- Create: `web/src/view-toggle-markup.ts`, shaped like `web/src/prepaint.ts`
- Modify: `web/index.html:27-30`, `web/vite.config.ts:17` and `:281`, `web/src/layout.ts:1`,
  `web/tests/browser/harness.ts:46-49`, `web/tests/node/harness.test.ts:64` and `:85`
- Docs that call the buttons `index.html`'s markup: `web/src/app-header.ts:267-269`, `web/src/layout.ts:94`,
  `web/src/style.css:297-299`, `web/tests/browser/view-toggles-first-paint.test.ts:7-8`, `web/tests/node/harness.test.ts:81-83`
- Test: `web/tests/node/prepaint.test.ts` (the `the build` describe, which starts the configured server)

**Interfaces:**
- Produces, in `view-toggle-markup.ts`: `VIEW_TOGGLES_SLOT = '<!-- view-toggles -->'`, `viewToggleButtons(): string` and
  `inlineViewToggles(html: string): string`. `viewToggles` in `app-header.ts` does not change: it goes on adopting the buttons.

The markup is one button per `HEADER_ORDER` kind, each exactly
`<button type="button" class="view-toggle" data-shows="KIND" aria-pressed="false">WORD</button>`, with `WORD` from `KIND_WORD`.
`inlineViewToggles` returns `html` unchanged when it holds no slot, as `inlinePrepaint` does.

- [ ] **Step 1: Build the page as it is, for comparison**

Run `pnpm exec vite build --outDir $R/build-before --emptyOutDir >| $R/logs/build-before.log 2>&1`. Expected: exit 0.

- [ ] **Step 2: Write the failing tests** in `the build`

- `'keeps only the slot inside the source page’s #views-shown'`: `page('index.html')` matches
  `/<div id="views-shown"[^>]*>\s*<!-- view-toggles -->\s*<\/div>/`.
- `'serves one toggle per kind, in the header’s order, named by its word'`: the result of
  `server.transformIndexHtml('/index.html', page('index.html'))` holds the `data-shows` values in `HEADER_ORDER`, each with
  `KIND_WORD`'s word, and does not contain `VIEW_TOGGLES_SLOT`.

- [ ] **Step 3: Run them to verify they fail.** Run `pnpm exec vitest run --project node tests/node/prepaint.test.ts`.
  Expected: FAIL.

- [ ] **Step 4: Implement**

Put the slot in `index.html` in place of the four buttons. Add a second plugin in `vite.config.ts`,
`{ name: 'redextape-view-toggles', transformIndexHtml: { order: 'pre', handler: inlineViewToggles } }`, importing from
`'./src/view-toggle-markup.ts'`. `view-toggle-markup.ts` imports `'./layout.ts'`, and `layout.ts:1` becomes
`import type { LeafId, PaneKind } from './panes.ts'`: the config's module graph needs the explicit extensions.
`SHELL` interpolates `viewToggleButtons()`. `harness.test.ts:64` expands the slot with `inlineViewToggles`, and the title at
`:85` stops saying four. **The literal template at `harness.test.ts:93` stays a literal**: it is what still sees a wrong
button now that `SHELL` and the page share a function. Update the docs listed above.

- [ ] **Step 5: Run the tests**

Node tier: `tests/node/prepaint.test.ts tests/node/harness.test.ts tests/node/app-header.test.ts`. Browser files:
`view-toggles-first-paint`, `view-toggles-narrow`, `view-toggles`, `first-load-views`, `controls-gate`. Expected: PASS.

- [ ] **Step 6: Prove the shipped page is unchanged**

Run `pnpm exec vite build --outDir $R/build-after --emptyOutDir`. Compare `index.html` from the two builds with whitespace
between tags collapsed and asset hashes removed. Expected: identical. Start `pnpm exec vite --port 5271` for a few
seconds, logging to `$R/logs/vite-start.log`. Expected: `grep -c configLoader $R/logs/vite-start.log` prints `0`.

- [ ] **Step 7: Sabotage, one at a time**

| Change | Must fail |
|---|---|
| remove the plugin from `vite.config.ts` | `'serves one toggle per kind…'` only |
| markup in reversed order | `harness.test.ts:85` and `'serves one toggle per kind…'` |
| drop `aria-pressed` from the markup | `harness.test.ts:85` only |
| put the four buttons back in `index.html` | `'keeps only the slot…'` only |

- [ ] **Step 8: Commit** with the subject `The header's views toggles are generated from the tables when the page is built`.

### Task 5: View keys 1 to N, and the pins of four

Traces to survey-layout tasks 4 and 5, merged.

**Files:**
- Modify: `web/src/view-keys.ts:43-44` (the doc only)
- Test: `web/tests/node/view-keys.test.ts`, `arrangements.test.ts`, `layout.test.ts`, `pages.test.ts`, `lsp-protocol.test.ts`, all in
  `web/tests/node/`; `view-toggles-first-paint.test.ts`, `controls-gate.test.ts`, `view-keys.test.ts` and
  `view-toggle-focus-ring.test.ts`, all in `web/tests/browser/`

- [ ] **Step 1: Add the keys' tests** in a new describe, `'the toggle keys'`, in `web/tests/node/view-keys.test.ts`

`'are single digits, so a tenth kind is a decision'`: every toggle row's `key` matches `/^[1-9]$/`.
`'are 1 to N in the header’s order'`: the toggle rows' keys equal `HEADER_ORDER.map((_, i) => String(i + 1))`.
Change the doc at `view-keys.ts:43-44` from `1` to `4` into `1` to `N`, nine at most.

- [ ] **Step 2: Derive these pins from the tables**

| File and line | Becomes |
|---|---|
| `tests/node/arrangements.test.ts:47`, `:66-68` | `2 ** KIND_ORDER.length - 1`, and the test title and doc stop saying 15 |
| `tests/node/layout.test.ts:176` | `2 ** KIND_ORDER.length - 1` |
| `tests/node/view-keys.test.ts:46`, `:148` | the keys from `HEADER_ORDER` |
| `tests/node/pages.test.ts:142-144` | drop the length pin, and spell the last stop as `all` plus a word from a small table in the test (`{ 4: 'four' }`), so `help.html` does not change and a fifth kind still asks for its sentence to be rewritten |
| `tests/node/lsp-protocol.test.ts:30` | `[...KIND_ORDER].sort()` |
| `tests/browser/view-toggles-first-paint.test.ts:49`, `:97` | `HEADER_ORDER` and its length |
| `tests/browser/controls-gate.test.ts:466`, `:468` | `HEADER_ORDER.length`, and each kind's `KIND_WORD` |
| `tests/browser/view-keys.test.ts:130` | the keys from `HEADER_ORDER`, between `]`, `[` and `Esc` |
| `tests/browser/view-toggle-focus-ring.test.ts:191` | `HEADER_ORDER` |

- [ ] **Step 3: Leave these exactly as written**, since each pins a decision a table would follow right or wrong

The user's order: `tests/node/arrangements.test.ts:477`, `:499`; `tests/node/view-keys.test.ts:49-52`;
`tests/node/layout.test.ts:155-158`; `tests/browser/first-load-views.test.ts:59`, `:79`. A returning visitor's stored record:
`tests/browser/workspace-stored-views-order.test.ts`. The four-kind trees: `tests/node/layout.test.ts:67-110`. Fixtures of the
four-view page: the `FOUR` leaf lists in the browser files, `fourViews()` and `setup.ts`.

- [ ] **Step 4: Run the tests.** The node files above, and the four browser files above with `first-load-views` and
  `workspace-stored-views-order`. Expected: PASS.

- [ ] **Step 5: Sabotage**

1. `key: String(i + 7)` and then `key: String(i)` in `view-keys.ts`: each fails both new tests.
2. Swap `tm` and `rxm` in `HEADER_ORDER`: `arrangements.test.ts:477`, `:499`, `view-keys.test.ts:49-52` (node) and
   `first-load-views.test.ts:59`, `:79` fail.
3. Swap `rxm` and `tm` in `KIND_ORDER`: `layout.test.ts:155-158` and the trees at `:67-110` fail. Those read `KIND_ORDER`, which
   is why sabotage 2 does not reach them.

- [ ] **Step 6: Commit** with the subject `Tests of the kinds read the tables, except where they pin the user's order`.

### Task 6: The table of linked legs, and the status line over it

Traces to survey-links task 1.

**Files:**
- Create: `web/src/linked-legs.ts`, `web/tests/node/linked-legs.test.ts`
- Modify: `web/src/link-status.ts:122-152` and `:255-275`, `web/src/link-wiring.ts:185-193`
- Test: `web/tests/node/link-status.test.ts`

**Interfaces:**
- Produces, in `linked-legs.ts` (rxm first, since the table's order is the status line's clause order):

```ts
export type LinkedLeg = Exclude<Leg, 'lambda'>
export type LinkedPane = {
  setLink(rows: number[], scrollTo: boolean): void
  setFocus(rows: number[]): void
  setEditorAvailable(available: boolean): void
}
export const LINKED: {
  readonly [K in LinkedLeg]: {
    rows(l: Link): number[]
    pane(p: PaneEntry<Leg>): LinkedPane
    emits: string
    here: string
  }
} = {
  rxm: { rows: (l) => l.instrs, pane: (p) => p.pane as unknown as RxmPane, emits: 'instructions', here: 'the rxm run is here right now' },
  tm: { rows: (l) => l.states, pane: (p) => p.pane as unknown as TmPane, emits: 'machine states', here: 'the machine is here right now' },
}
export const LINKED_LEGS: readonly LinkedLeg[] // the keys of LINKED
export function isLinkedLeg(leg: Leg): leg is LinkedLeg
```

- `LinkStatus`'s `linked` arm: `legs: Readonly<Record<LinkedLeg, { emits: boolean; here: boolean }>>` replaces `tm`, `instrs`,
  `focus` and `rxmFocus`. `lambda` stays.

- [ ] **Step 1: Write the failing test** `web/tests/node/linked-legs.test.ts`

`'lists every leg but λ, in the app’s order'`: `expect(LINKED_LEGS).toEqual(LEGS.filter((leg) => leg !== 'lambda'))`.

- [ ] **Step 2: Run it to verify it fails.** Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement**

`linkStatus` loops over `LINKED_LEGS`: each leg's `here` clause in table order, then one absence clause
`this construct emits no ${nouns}`, the nouns of the legs that emit nothing, joined with ` or `. A leg whose views all show
copies says neither, by the existing `off`. `drawLink` keeps its four parameters until Task 9 and builds `legs` from them.

- [ ] **Step 4: Migrate `link-status.test.ts`**

Its 25 `linked` sites (20 literals and 5 spreads of a shared one) go through a local helper taking the old four flags.
**No expected sentence in the file changes**: `git diff` shows no `toBe(` line with a changed string.

- [ ] **Step 5: Run.** `tests/node/link-status.test.ts tests/node/linked-legs.test.ts`. Expected: PASS.

- [ ] **Step 6: Sabotage.** Swap the two entries of `LINKED`: `link-status.test.ts:68-69` and the new test fail.

- [ ] **Step 7: Commit** with the subject `The status line reads a table of the legs a link reaches`.

### Task 7: A pin can name a pc

Traces to survey-links task 2 and decision Q4. Review Focus 1.

**Files:**
- Modify: `web/src/link.ts:177-184`, `web/src/link-wiring.ts:63`, `:68-69` and `:203-210`, `web/src/transport.ts:518-533`
- Create: `web/tests/node/link-wiring.test.ts`
- Test: `web/tests/node/link.test.ts`, `web/tests/browser/copy-pin.test.ts`

**Interfaces:**
- Produces:
  - `Pin = { node: number; origin: 'source' | Leg; pc?: number }`
  - `pinAtInstr(index: LinkIndex, pc: number, origin: Pin['origin']): Pin | null` in `link.ts`, resolving through
    `LinkIndex.nodeForInstr` alone, and returning `null` for an instruction with no owner
  - `LinkWiring.linkInstr(pc: number): void`
  - `LinkWiring.setLinkTo(node: number | null, origin: Exclude<Pin['origin'], 'rxm'>): void`, so an rxm pin cannot be made
    without its pc

**Behaviour to keep:** an instruction with no owner pins nothing and sets `ownerless`. A TM state with no owner clears
silently. `linkInstr` opens with `linkAtSourceOffset`'s guard (`if (!linkable || index === null) return`), counts one gesture,
then paints as an rxm click does today. `setLinkTo` and `linkInstr` share one private function in `createLinkWiring`, which takes
the pin, the origin and `ownerless`, counts the gesture, writes the pin and `ownerless`, and paints. **Transport's `detached` guard at
`transport.ts:531` stays ahead of the call**: a row of a copy must count no gesture, which is what makes #185's clear fire on it.
`transport.ts:530` goes, since `linkInstr`'s guard is the same test.

- [ ] **Step 1: Write the failing tests**

In `link.test.ts`: `'pins an owned instruction by its node and pc'` gives `{ node, origin: 'rxm', pc }`, and
`'pins nothing for a minted, past-the-end or negative pc'` gives `null` for each.

In `link-wiring.test.ts`, with fake `panes` and `sessions` shaped like `tests/node/link-clear.test.ts`'s `wiring()`:
- `'linkInstr pins the node and the pc, and counts one gesture'`
- `'setLinkTo writes no pc'` (`toStrictEqual({ node: 7, origin: 'lambda' })`)
- `'a minted pc pins nothing, counts one gesture and says so until unpin'` (the sentence
  `this instruction has no source construct`, read by calling `drawLink` as `draw()` would, since the fake `draw` does not)
- `'a TM state with no owner says nothing'`

In `copy-pin.test.ts`, after the case ending at `:93`: `'clears the program’s pin on a click on a row of an rxm copy'`: with a
pin held, a real `userEvent.click` on an instruction row of the rxm copy clears the program's marks, shaped like the TM
case at `web/tests/browser/link-clear.test.ts:528-532`.

- [ ] **Step 2: Run them.** Expected: both `link.test.ts` cases, `'linkInstr pins…'` and `'a minted pc…'` FAIL, since `pinAtInstr` and
  `linkInstr` do not exist yet. `'setLinkTo writes no pc'`, `'a TM state with no owner…'` and the `copy-pin.test.ts` case pass today: they
  pin behaviour this task keeps, and Step 5's sabotages are their check.

- [ ] **Step 3: Implement.** `transport.ts:530` goes and `:532` becomes `wiring.linkInstr(pc)`. Correct the doc at `link.ts:180-182`, which says
  `setLinkTo` takes `Pin['origin']`, and the doc at `link-wiring.ts:63`, which says the gestures are `setLinkTo`'s alone. `pinAtInstr` is the
  only code that writes a `pc`.

- [ ] **Step 4: Run**

Node: `tests/node/link.test.ts tests/node/link-wiring.test.ts tests/node/link-clear.test.ts`. Browser files: `copy-pin`, `rxm-link`,
`rxm-pane`, `rxm-copy`, `link-clear`. Expected: PASS.

- [ ] **Step 5: Sabotage, one at a time**

| Change | Must fail |
|---|---|
| drop `pc` from `pinAtInstr`'s result | the first `link.test.ts` case |
| resolve `pc + 1` | both `link.test.ts` cases |
| skip the gesture count in the shared function | `'linkInstr pins…'` |
| `setLinkTo` writes a `pc` | `'setLinkTo writes no pc'` |
| never set `ownerless` | `'a minted pc…'` |
| set `ownerless` on `setLinkTo(null, …)` | `'a TM state with no owner…'` |
| delete transport's `detached` guard | the new `copy-pin.test.ts` case |

- [ ] **Step 6: Commit** with the subject `A click on an rxm instruction pins its node and carries its pc`.

### Task 8: The wiring's fan-out over the table

Traces to survey-links task 3.

**Files:**
- Modify: `web/src/link-wiring.ts:54`, `:203-210`, `:212-285` and `:309-324`; `web/src/main.ts:97`, `:121` and `:2823-2837`
- Test: `web/tests/node/link-wiring.test.ts`

**Interfaces:**
- Consumes: `LINKED`, `LINKED_LEGS` from Task 6.
- Produces, internal to `createLinkWiring`: `paint(from: Pin['origin'] | null)` and
  `fanOut(l: Link | null, from: Pin['origin'] | null)`. A view scrolls when `from !== null && from !== leg`. A copy gets `[]`.
  `unpin` calls `paint(null)`. `clearLink` ends in `fanOut(null, null)`.

`paint`'s order stays: the source mark, `draw()`, the announcement, then the fan-out. `main.ts:2836-2837` and its imports at
`:97` and `:121` go. Across legs the fan-out becomes rxm then TM: each `setLink` touches only its own view, so nothing can observe
the order.

**`clearLink`'s doc, on the type at `link-wiring.ts:54`, replaces the block at `main.ts:2823-2834`, and this block is exempt from moving
verbatim**, because it describes the direct calls this task removes. Write the doc in at most 8 counted lines and keep three reasons:
`draw()` never sets a view's link, so the marks would stay until the next compile lands; hidden views are cleared too, since a hidden one
shows its rows again when its tab is selected; and `setLink` redraws with the old running focus until the scheduled `draw()`.

**The comments at `link-wiring.ts:213` and `:256` name `scrollTm` or `scrollRxm`**, the parameters `paint` loses here. Reword those lines in
this commit.

- [ ] **Step 1: Write the failing tests** in `link-wiring.test.ts`, with a fake program view and copy view on each leg

- `'gives each view its leg’s rows and scrolls it unless the click came from its leg'`, for every origin, and a copy gets `[]`
- `'clears every view without scrolling on an edit'`: `clearLink` gives every view `([], false)`
- `'scrolls nothing when a pin is cleared'`: `unpin`

- [ ] **Step 2: Run them to verify they fail.** Expected: the `clearLink` case FAILS, since `main.ts` does that work today.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run**

Node: `tests/node/link-wiring.test.ts tests/node/link-clear.test.ts`. Browser files: `link-hold`, `hidden-views`, `rxm-link`, `copy-pin`,
`link-clear`. Expected: PASS.

- [ ] **Step 5: Sabotage, one at a time**

Invert the scroll rule; drop the copy guard; give rxm the TM column; remove `fanOut` from `clearLink`; `paint('source')` in
`unpin`. Each fails its case above.

- [ ] **Step 6: Commit** with the subject `A link reaches each view through one fan-out over the linked legs`.

### Task 9: `draw.ts` over the table

Traces to survey-links task 4.

**Files:**
- Modify: `web/src/draw.ts:163-198`, `:217-298` and `:387`; `web/src/link-wiring.ts:68` and `:175-194`; `web/src/transport.ts:519`;
  `web/tests/browser/running-focus.test.ts:354`; `web/tests/browser/link-hold.test.ts:435`; and `web/src/linked-legs.ts`, only if the
  `sourceNode` member below is needed
- Test: `web/tests/node/link-wiring.test.ts`, whose `'a minted pc…'` case calls the four-parameter form: the call becomes
  `drawLink(null, { rxm: false, tm: false }, 'shown')`

**Interfaces:**
- Consumes: `LINKED`, `LINKED_LEGS`, `isLinkedLeg` from Task 6.
- Produces: `drawLink(l: Link | null, here: Readonly<Record<LinkedLeg, boolean>>, lambda: LambdaLinkState): void`.

A per-frame local `running: Record<LinkedLeg, { focus: Focus | null; link: Link | null }>` is computed before the render loop,
from `panes.active(leg, watched)` as `tmFocus` and `rxmFocus` are today. The per-pane `machine` becomes
`isLinkedLeg(boundLeg) ? LINKED[boundLeg].pane(p) : null`, where `boundLeg` is `p.slot.binding.leg` (the name `leg` is taken at
`draw.ts:236`). **`setFocus` stays before `render` and the seed's `setLink` stays after it.** If `tsc` refuses the union at
`.hist.current?.source_node`, add a `sourceNode` member to `LINKED` for each leg. Do not widen a type to get past it.

- [ ] **Step 1: Implement**, then sweep the comments that name what went: `tmFocus`, `tmFocusLink`, `rxmFocus`, `rxmFocusLink`,
  `focusCoincident`, `rxmCoincident`, `origin !== 'tm'`. Known sites: `draw.ts:135`, `:202`, `:210`, `:340`, `:366`;
  `link-wiring.ts:68`, `:164-168`; `transport.ts:519`; `running-focus.test.ts:354`; `link-hold.test.ts:435`. The `rxmFocus` and `tmFocus`
  in `copy-beside-program.test.ts` are that file's own helpers and stay.

- [ ] **Step 2: Run.** Browser files: `running-focus`, `link-hold`, `parked-view-surfaces`, `copy-pin`, `rxm-link`, `hidden-views`,
  `copy-beside-program`. Expected: PASS.

- [ ] **Step 3: Sabotage, one at a time.** No new test is added: these existing tests hold the frame, and each sabotage is a
  prediction to confirm.

| Change | Must fail |
|---|---|
| `setFocus` after `render` | `running-focus.test.ts:370` |
| the seed's `setLink` before `render` | `link-hold.test.ts:387`, `:415` |
| the seed's scroll inverted | `link-hold.test.ts:441` |
| `panes.active(leg)` without `watched` | `parked-view-surfaces.test.ts:187`, `:210` |
| the `unlinked` guard dropped | `copy-pin.test.ts:143`, `:153` |
| `here` read off the TM leg for both | `rxm-link.test.ts:69` |
| focus rows from the TM column on an rxm view | `rxm-link.test.ts:69` |

- [ ] **Step 4: Commit** with the subject `Each frame marks the linked legs through the table`.

### Task 10: One label-placement walker

Traces to survey-panes task 1.

**Files:**
- Create: `web/src/label-rows.ts`, `web/tests/node/label-rows.test.ts`
- Modify: `web/src/rxm-view.ts:15-29`, `web/src/program-level.ts:26` and `:28-57`

**Interfaces:**
- Produces: `export type Labels = readonly (readonly [string, number])[]` and
  `placeLabels(count: number, labels: Labels, label: (name: string) => void, item: (index: number) => void): void`.
- `listingRows` and `programRows` keep their names and signatures. `programRows` keeps its tier gate, `steps` row and runtime tail.

- [ ] **Step 1: Write the failing tests** in `label-rows.test.ts`

`'puts an item’s labels before it, in labels order'`; `'puts a label at count after the last item'`;
`'drops a label past count'`; `'places a label at 0 when there are no items'`.
`'places labels the same way for the listing and the instruction tier’s rows'`: over a fixed table of label sets (none, two on
one index, one at `count`, one past `count`), `listingRows` and an instruction-tier `programRows` with no open group give the
same sequence of labels and items, on two fixtures: one with no runtime routines, and one with runtime routines after the listed groups and
`edges` `'arcs'`, where `listingRows` gets the listed part only and `count` is the number of listed groups. *Arcs* adds no runtime rows, so
the sequences still match, and the second fixture is the one Step 5's `listed` sabotage fails.

- [ ] **Step 2: Run them to verify they fail.** Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement** `placeLabels` and rewrite both callers over it.

- [ ] **Step 4: Run.** Node: `label-rows`, `rxm-view`, `program-level`. Browser files: `state-diagram`, `rxm-pane`. Expected: PASS.

- [ ] **Step 5: Sabotage, one at a time.** `i <= count` to `i < count`; the item before its labels; the bucket reversed;
  `programRows` passing `g.groups.length` instead of `listed` (the agreement test must fire).

- [ ] **Step 6: Commit** with the subject `The listing and the program level place labels with one walker`.

### Task 11: `MachineViewChrome`

Traces to survey-panes task 2. Review Focus 4.

**Files:**
- Create: `web/src/machine-view-chrome.ts`, `web/tests/browser/machine-view-chrome.test.ts`
- Modify: `web/src/rxm-pane.ts:116-137`, `:238-239`, `:247-253`, `:279-285`, `:343-409`; `web/src/tm-pane.ts:196-246`, `:418-419`, `:427-433`, `:451-457`,
  `:592-649`, `:715-739`

**Interfaces:**
- Produces `export abstract class MachineViewChrome implements EditablePane`, constructed with
  `(on: PaneEvents, opts: { readonly what: string; readonly noun: string; readonly outlineOpen: boolean })`:
  - protected: `header`, `steps`, `menu`, `copy`, `mount(host: HTMLElement, body: HTMLElement): void`, `textRegion(): StackRegion`,
    `outlineRegion(): StackRegion`, and `editorUnmounted(): void`, a no-op that `TmPane` overrides with today's `onUnmount` body
  - public: `setDetached`, `setEditor`, `takeEditor`, `receiveEditor`, `holdsEditor`, `setEditorAvailable`, `flushEditor`,
    `setForkAvailable(text, count, resultDecodable = true)`, `setStepsShown`, `setBindings`, `setLayoutControls`

**What stays on each view:**
- `RxmPane`: `what: 'the whole program'`, `noun: 'instructions'`.
- `TmPane`: `what: 'the whole machine'`, `noun: 'rules'`, `steps.step.remove()`, and overrides of `setDetached` and
  `setStepsShown` that call `super` and keep today's width box, `#scratch` clear and **both guards** (`tm-pane.ts:603`, `:612`).
- **Keep the literal `implements EditablePane` on `RxmPane` and `TmPane`**: `web/src/editor-custody.ts:223-229` names that clause
  on each class as what makes its casts sound.
- **The base constructor calls nothing overridable.** A subclass's private fields do not exist until `super()` returns.
- `RxmPane` and `TmPane` keep their constructor signatures, since 8 test files build them directly.

- [ ] **Step 1: Write the tests that pin today's behaviour** in `machine-view-chrome.test.ts`, mounting panes as `tm-status-line.test.ts` does

- `'words edit a copy for what each view copies'`: the `.view-menu-hint` reads `the whole machine` on a TM view and `the whole program`
  on an rxm view.
- `'words the refusal of a function-valued program'`: after `tm.setForkAvailable(null, 0, false)` the item is disabled and reads
  `a function-valued program has no TM file a copy can run`.
- `'writes nothing to the status line when told what it already shows'`: a `MutationObserver` on `.tm-status` records a change for
  a real flip of `setStepsShown` (the instrument's own precondition), then none for the same value again, and none for repeated
  `setDetached(false)` with no scratch.

- [ ] **Step 2: Run them.** The first two pass today and pin the words through the move. The third passes today too, so its
  check is the sabotage in Step 5.

- [ ] **Step 3: Extract**, moving comments verbatim.

- [ ] **Step 4: Run.** Browser files: `machine-view-chrome`, `tm-pane-editor`, `copy-editor`, `copy-editor-mount`, `rxm-copy`, `rxm-blank-copy`,
  `view-status`, `pane-picker`, `tm-status-line`, `field-width`, `tm-pane-follows-session`, `copy-header`. Expected: PASS.

- [ ] **Step 5: Sabotage, one at a time.** Give TM the rxm words; forward two arguments to `CopyEditor.setForkAvailable`; remove
  the early return from `setStepsShown`; remove the guard from `setDetached`. Each fails a case above.

- [ ] **Step 6: Commit** with the subject `The rxm and TM views share their header, menu and copy editor`.

### Task 12: `followedGridPanel` and `ListingPanel`

Traces to survey-panes task 3. Review Focus 5.

**Files:**
- Create: `web/src/followed-grid-panel.ts`, `web/src/listing-panel.ts`
- Modify: `web/src/rxm-pane.ts:139-181`, `:292-331`, `:417-468`; `web/src/tm-pane.ts:247-310`; `web/src/rxm-view.ts:20` (the parameter's type)
- Test: `web/tests/browser/rxm-pane.test.ts`

**Interfaces:**
- Consumes: `Labels` from Task 10.
- Produces:

```ts
export function followedGridPanel(o: {
  name: string; label: string; open: boolean; reattachText: string
  classes: GridOptions['classes']; idPrefix: string
  hasContent(): boolean; rows(): GridRows; activate(i: number): void; onToggle(open: boolean): void
}): { readonly panel: Panel; readonly grid: VirtualGrid; readonly reattach: HTMLButtonElement }

export class ListingPanel {
  constructor(o: {
    name: string; label: string; open: boolean; reattachText: string
    classes: GridOptions['classes']; cellClass: string; idPrefix: string
    fillInstr(pc: number, cell: HTMLElement): void
    activate(pc: number): void; onToggle(open: boolean): void
  })
  readonly panel: Panel
  setSource(s: { readonly listing: readonly string[]; readonly labels: Labels } | null): void
  setLink(pcs: readonly number[], scrollTo: boolean): void
  setFocus(pcs: readonly number[]): void
  show(next: number | null, step: number | null): void
}
```

`followedGridPanel` owns the re-attach button (added and removed, never disabled), its `beforeDraw` rule and the focus hand-off to the
panel's toggle. Its panel redraws the grid on a toggle, before `o.onToggle`, and on `onDrawn`: both views do exactly that today
(TM's `#drawTable` is `#grid.draw()`). `ListingPanel` owns the rows, `rowOf` and the `is-next`, `is-linked` and `is-focus` marks. **`idPrefix` stays the
caller's:** `rxm-grid-N` and `tm-grid-N` go on being minted per view class. `RxmPane.setLink` and `setFocus` stay public and delegate.

- [ ] **Step 1: Write the tests that pin today's behaviour** in `rxm-pane.test.ts`

- `'hands the focus to the listing panel’s toggle when follow current instruction hides itself'`
- `'gives two rxm views and a TM view on one page distinct grid cell ids'`

- [ ] **Step 2: Run them.** Both pass today: they pin the behaviour through the move, and Step 5's sabotages prove they can fail.

- [ ] **Step 3: Extract.**

- [ ] **Step 4: Run.** Browser files: `rxm-pane`, `rxm-link`, `link-hold`, `link-clear`, `follow-kept`, `tm-grid`, `tm-follow-clamp`, `virtual-grid`,
  `panel-maximise`, `app`. Expected: PASS.

- [ ] **Step 5: Sabotage, one at a time.** Remove `toggle.focus()` from `followedGridPanel`; hard-code `idPrefix`. Each fails a case above.

- [ ] **Step 6: Commit** with the subject `The rule table and the listing share one followed grid in a panel`.

### Task 13: The values, call-stack and heap panels

Traces to survey-panes task 4.

**Files:**
- Create: `web/src/machine-panels.ts`
- Modify: `web/src/rxm-view.ts`, `web/src/rxm-pane.ts:183-217` and `:470-616`
- Test: `web/tests/node/rxm-view.test.ts`

**Interfaces:**
- Produces, in `machine-panels.ts`, each panel taking `(o: { name: string; label: string; open: boolean; onToggle(open: boolean): void })`
  and returning `{ readonly panel: Panel; show(view: V | null): void }`:

```ts
export type ValuesView = {
  readonly rows: readonly { name: string; text: string; changed: boolean; unwritten: boolean; says: readonly string[] }[]
  readonly notes: readonly { text: string; legend: boolean }[]
}
export type StackView = {
  readonly count: string
  readonly frames: readonly { callee: string; ret: string; saved: string }[]
  readonly notes: readonly string[]
}
export type HeapView = {
  readonly count: string
  readonly items: readonly ({ kind: 'line'; lead: string; body: string; refs: readonly string[] } | { kind: 'note'; text: string })[]
}
export function valuesPanel(o): { readonly panel: Panel; show(view: ValuesView | null): void }
export function callStackPanel(o): { readonly panel: Panel; show(view: StackView | null): void }
export function heapPanel(o): { readonly panel: Panel; show(view: HeapView | null): void }
```

- New pure builders in `rxm-view.ts`: `rxmValues(frame: RxmState): ValuesView`, `rxmStack(frame: RxmState, program: RxmProgram): StackView` and
  `rxmHeap(frame: RxmState): HeapView`, which are where `registerRows`, `calleeOf` and `wordText` are used. No panel sees an `RxmWord`.

The `rxm-*` class names, the `registers`, `stack` and `heap` panel names and each panel's markup do not change.

- [ ] **Step 1: Write the failing tests** in `rxm-view.test.ts`, for text no test reads today

- `'adds +N more to a frame’s saved locals past the window'` (`rxm-pane.ts:556`)
- `'counts older cells and boxes, boxes in the plural only past one'` (`rxm-pane.ts:601-605`)
- `'says a hidden argument and a hidden local in the singular'` (`rxm-pane.ts:513-514`)

- [ ] **Step 2: Run them to verify they fail.** Expected: FAIL, the builders do not exist.

- [ ] **Step 3: Extract**, keeping each panel's DOM exactly as `#drawRegisters`, `#drawStack` and `#drawHeap` build it.

- [ ] **Step 4: Run.** Node: `rxm-view`. Browser files: `rxm-pane`, `rxm-app`, `panel-boundaries`, `panel-maximise`. Expected: PASS.

- [ ] **Step 5: Sabotage, one at a time.** Drop the saved-locals clause; swap the `box`/`boxes` ternary; swap the `argument`/`arguments`
  ternary. Each fails its case above.

- [ ] **Step 6: Commit** with the subject `The rxm view's panels draw finished rows from pure builders`.

### Task 14: `applyLayout` builds views from a table

Traces to survey-panes task 5. Review Focus 3.

**Files:**
- Modify: `web/src/panes.ts`, `web/src/pane-host.ts:1490-1616`
- Create: `web/tests/browser/stored-panels-restore.test.ts`
- Test: `web/tests/node/panes.test.ts`

**Interfaces:**
- Produces, in `panes.ts`: `LEG_PANELS`, written `{ lambda: ['map'], rxm: ['listing', 'registers', 'stack', 'heap', 'outline'], tm: ['rules', 'diagram', 'outline'] }
  as const satisfies { readonly [K in Leg]: readonly string[] }`, and
  `storedPanels<N extends string>(names: readonly N[], open: (name: N) => boolean | undefined): Partial<Record<N, boolean>>`, which leaves
  out what is not stored.
- Produces, in `pane-host.ts`: `PANE_BUILD: { readonly [K in Leg]: (host: HTMLElement, on: PaneEvents, leaf: LeafId) => LegPane[K] }` and
  `buildPane<K extends Leg>(kind: K, leaf: LeafId, session: SessionId, host: HTMLElement): void`, shaped like `seedLeg` (`:498`). The mapped
  type replaces `unhandled` at `:1615`, so a new leg still fails `tsc` here.

**Order inside `buildPane` is today's:** slot, pane, `SEED[kind]`, `mountScratchEditor`, `panes.add`. `SEED.lambda` is a no-op (`:486`), so
seeding every leg changes nothing. The long comments in the TM arm move with it, verbatim. If `tsc` cannot see `LegPane[K]` as `K`'s
`PaneView`, use the one cast `seedLeg` uses and keep its reason in a comment.

- [ ] **Step 1: Write the failing tests**

In `panes.test.ts`: `'storedPanels passes the stored names and leaves the rest out'`, asserting with `toStrictEqual`.

In `stored-panels-restore.test.ts`, seeded before `main.ts` is imported as `tm-display-restore.test.ts` is, **reading the names from
`LEG_PANELS` and not from a list of its own**:
- `'opens every stored panel as the workspace stored it'`: one stored workspace holds each panel in `LEG_PANELS` as the opposite of its
  default, the default read from a view built bare in the same file
- `'draws exactly the panels the table names, and the text panel'`: each view's `data-panel` names equal its `LEG_PANELS` entry plus `text`

- [ ] **Step 2: Run them to verify they fail.** Expected: FAIL, `LEG_PANELS` is not exported.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run.** Browser files: `stored-panels-restore`, `workspace-restore`, `pane-kind-switch`, `panel-sizes-restore`,
  `panel-sizes-restore-lambda`, `lambda-display-restore`, `tm-display-restore`, `rxm-copy-restore`, `parked-view-state-restore`,
  `default-views-gestures`, `lsp-restored-panel`. Expected: PASS.

- [ ] **Step 5: Sabotage, one at a time.** Drop `registers` and then `diagram` from `LEG_PANELS`, and add a panel name no view draws: each
  fails `'draws exactly the panels…'`. Make `storedPanels` return `{}`: `'opens every stored panel…'` fails.

- [ ] **Step 6: Commit** with the subject `Each view is built from a table of its leg's panels`.

### Task 15: The display settings from one table

Traces to survey-panes task 6 and decision Q3. **The first task to cut if the PR grows.**

**Files:**
- Modify: `web/src/workspace.ts:64-85`, `:158-166`, `:204-207`, `:240-270` and `:386-389`; `web/src/main.ts:1469-1476`; `web/src/pane-host.ts:290-297`,
  `:370-373` and `:963-970`
- Test: `web/tests/node/workspace.test.ts`

**Interfaces:**
- Produces, in `workspace.ts`: `LegDisplay = { lambda: LambdaDisplay; tm: TmDisplay }`, `DisplayLeg = keyof LegDisplay` and
  `LEG_DISPLAY: { readonly [K in DisplayLeg]: { field: 'display' | 'tmDisplay'; fallback: LegDisplay[K]; parse(entry: unknown): LegDisplay[K] | null } }`.
  One `parseDisplays` and one `withLegDisplay` replace the pairs.
- `pane-host.ts`'s four dependencies become `displayOf<K extends DisplayLeg>(leg: K, leaf: LeafId): LegDisplay[K] | undefined` and
  `setLegDisplay<K extends DisplayLeg>(leg: K, leaf: LeafId, d: LegDisplay[K]): void`.

**Unchanged:** the stored keys `display` and `tmDisplay`, `WORKSPACE_VERSION` 2, the `Workspace` fields (so `main.ts`'s restore, close and
normalise sites keep both), and `PaneEvents.display` and `tmDisplay`. `PANE_BUILD`'s λ and TM entries read through `displayOf`.

- [ ] **Step 1: Write the test** in `workspace.test.ts`

`'reads and writes a stored version 2 workspace’s display settings unchanged'`: a literal JSON string holding both keys, written out in
the test, parses and serialises back to the same `display` and `tmDisplay` values. It passes today, and pins the format through the move.

- [ ] **Step 2: Move the family.**

- [ ] **Step 3: Run.** Node: `workspace`, `share-link`. Browser files: `tm-display-restore`, `lambda-display-restore`, `lambda-display`,
  `parked-view-state`, `parked-view-state-restore`, `workspace-stored-views-order`. Expected: PASS.

- [ ] **Step 4: Sabotage, one at a time.** Change a `field` in `LEG_DISPLAY`; swap the two legs' `parse` entries. Each fails the new test.

- [ ] **Step 5: Commit** with the subject `The λ and TM views' display settings are stored through one table`.

### Task 16: §7.2 timing of `draw()` and `programRows`

Traces to survey-links task 4 ("Timing check"), survey-panes section 6, and the design's §7.2. `draw()` runs every shown frame and
reaches every view's `render`, and `programRows` runs each time the current group changes, so these two cover the code this PR
moves on a run's drawing path. Rxm stepping and recording are untouched: no `crates/` file and no worker file changes.

**Files:** no tracked file changes. The harness is adapted from `/home/davey/temp/redextape-ab-harness/task13/c/` into `$R/ab/`.

- [ ] **Step 1: Make the two sides**

```bash
git -C $W diff --stat 6b77731 HEAD -- crates/ web/src/session-worker.ts   # expected: prints nothing
git -C $W worktree add --detach /home/davey/temp/redextape-ir-panes-final HEAD
cd /home/davey/temp/redextape-ir-panes-final/web && pnpm install --frozen-lockfile
cp -r $W/pkg $W/pkg-lsp /home/davey/temp/redextape-ir-panes-final/
cp -r $W/web/bindings /home/davey/temp/redextape-ir-panes-final/web/
cmp /home/davey/temp/redextape-ir-panes-final/pkg/redextape_wasm_bg.wasm /home/davey/temp/redextape-ir-panes-base/pkg/redextape_wasm_bg.wasm
```

Expected: `cmp` exits 0, so the two sides differ in the web code alone. The base side is Task 1's worktree at `6b77731`.

- [ ] **Step 2: Instrument both sides the same way** (in those two worktrees only, never in `$W`, never committed)

In each side's `web/src/draw.ts`, rename `createDraw` to `createDrawInner` and add an exported `createDraw` with the same parameter that wraps
the returned function, pushing `performance.now()` deltas onto `globalThis.__drawMs`.

- [ ] **Step 3: Write the probe** `web/tests/browser/pr4-timing.test.ts`, the same bytes on both sides (`cmp` them)

1. **`programRows`:** instruction-tier `Groups` of 200, 2,000 and 20,000 rows with a label on every fifth, `edges` `'arcs'` and `open` walking
   the groups. 200 calls discarded, then 2,000 timed per size. Figures: median and p95 per call, in µs.
2. **`draw()`:** `fourViewWorkspace()` stored, `main.ts` mounted, the `map-fold` example picked, a construct pinned by a real click in the
   source, then ▶ until the TM leg ends. The first 30 frames are discarded. Figures: frames drawn, and median and p95 per frame, in ms.

Print each figure with `console.error` as `pr4-timing: <name> <value>`, since `console.log` does not reach the vitest log.

- [ ] **Step 4: Adapt the harness.** Copy `ab3.zsh`, `run-unit3.zsh` and `cmp3.py` to `$R/ab/`. Their paths name a deleted record, so point `C`
  at `$R/ab` and the two worktrees at the paths above. The run step is
  `pnpm exec vitest run --project browser --reporter=verbose tests/browser/pr4-timing.test.ts`. Drop the probe wasm build, keep the sha256
  check of `pkg/redextape_wasm_bg.wasm` around every run, and have the comparer parse the `pr4-timing:` lines. **The vmstat gate, the CPU
  pin, the port 63315 wait and the rule stay as they are.**

- [ ] **Step 5: Run 8 pairs, ABBA**, through `run-unit3.zsh` (which holds both locks) on a quiet machine.

- [ ] **Step 6: Apply the rule** (#160's)

Per figure, take the median of a side's runs. Flag a final median above base's by more than base's spread (largest less smallest). Frames
drawn must not vary. **A flag calls for a repeat round and the pooled comparison, and a figure still flagged blocks the PR until it is
explained or removed.** If `programRows` is what is flagged, compute the placement once per machine in `StateDiagram.setProgram` and splice in
only the `steps` row per change, then measure again.

- [ ] **Step 7: Record** in `$R/timing.md`: the commit measured (`git -C /home/davey/temp/redextape-ir-panes-final rev-parse HEAD`), the machine, the window, the load at each run, each command, each wasm's sha256, and each figure's
  median per side with the ratio. Task 20 quotes this file.

### Task 17: §7.3 browser walkthrough

Traces to the design's §7.3, and to each survey's review focus.

**Files:** no tracked file changes. A defect found here is fixed in its own commit before Task 18.

- [ ] **Step 1: Serve both sides.** `pnpm exec vite --port 5271 --strictPort` from `$W/web` and `pnpm exec vite --port 5272 --strictPort` from the base worktree's `web/`.

- [ ] **Step 2: Walk each item in Chromium**, driving real input, reading each expected outcome from the page, with a screenshot per item in
  `$R/walk/`. Where an item says "as base", compare with the same steps on port 5272.

1. **First load.** `curl -s http://localhost:5271/` holds the four buttons inside `#views-shown` with no slot left. The toggles read source, λ, TM,
   rxm, and the header does not move as the app comes up.
2. **Layout.** Each toggle; `Ctrl+.` then `1` to `4`, `]` and `[`; each combination's grid at a wide and a tall window, as base.
3. **The rxm view.** Listing labels, `runs next`, *follow current instruction* and the focus after it; registers, call stack and heap at a mid-run
   step of `map-fold`, whose text reads as base.
4. **The TM view.** The rule table, *follow current rule*, the diagram, the width box before `⋯`, and *edit a copy*'s words.
5. **Links.** A source click marks the λ term, TM states and rxm instructions. A click on an rxm instruction marks every instruction of its
   construct, as base. A minted instruction says `this instruction has no source construct`. A click on empty space and Escape clear the pin.
   A click on a row of a copy clears the program's pin. A keystroke in the source clears every mark.
6. **Copies.** *edit a copy* on the rxm and TM views, an edit that rebuilds, and closing a view that holds a copy's editor.
7. **Stored state.** Close a panel on each view and change a λ and a TM display setting, reload, and each comes back. Open a share link and the
   same settings arrive.

- [ ] **Step 3: Walk items 1, 2, 3 and 5 in Firefox** through a Playwright script in `$R/walk/`, because Firefox is the browser the user tries
  branches in.

- [ ] **Step 4: Record** each item's outcome in `$R/walk/report.md`. Stop both servers.

### Task 18: The comment budget, in the last code commit

Traces to survey-panes section 2, item 6, as corrected under Global Constraints.

**Files:**
- Modify: `scripts/comment-budget.json` (`web/src`, and any other area the guard names)

- [ ] **Step 1: Confirm this is the last code commit.** Tasks 16 and 17 are closed with no fix outstanding. `git -C $W diff --stat <sha> HEAD -- web/src`,
  with `<sha>` the commit `$R/timing.md` records as measured, prints nothing. If it prints anything, the timing describes older code: re-run Task 16
  on this `HEAD`, replacing its final worktree, before going on.

- [ ] **Step 2: Read the final share.** Save the budget (`cp scripts/comment-budget.json $R/sab/budget.json`), set `web/src` to `0.0001`, run
  `node scripts/check-comments.mjs` from `$W`, and read `"web/src": <share>` from the failure. Restore the file and `cmp` it.

- [ ] **Step 3: Write that share** as `web/src`'s budget. It is the lowest value the area can pass at. If the guard names another area
  in Step 4, write the value it prints for that area too.

- [ ] **Step 4: Verify**

Run `node scripts/check-comments.mjs --self-test` and `node scripts/check-comments.mjs --base 6b77731` from `$W`.
Expected: exit 0, reading `each within its comment budget`. `git diff 6b77731 -- scripts/comment-budget.json` shows `web/src` below `0.4836`.

- [ ] **Step 5: Commit** with the subject `The web source's comment budget locks in what this branch removed`. If `git -C $W diff --quiet -- scripts/comment-budget.json`
  exits 0, the hook already wrote this value on the last code commit: skip the commit, as there is nothing to commit.

### Task 19: The full gate

Traces to the design's §7.3. `scripts/check-all.sh` is not all of CI, so this runs what `.forgejo/workflows/ci.yml` adds.

**Files:** no tracked file changes.

Each step runs from `$W` in its own `systemd-run --user` unit with `-p MemoryMax=16G -p MemorySwapMax=0` and `--setenv` for `PATH`, `HOME`, `CARGO_HOME`,
`RUSTUP_HOME`, the `XDG_*` directories, `PNPM_HOME` and `CARGO_TARGET_DIR`. Heavy steps take `/home/davey/temp/redextape-heavy.lock`, browser steps
take `/home/davey/temp/redextape-browser.lock` too, and each log goes in `$R/gate/` ending in its exit status.

- [ ] **Step 1: Tree-sitter.** `check-all.sh` needs 0.25.10 and the worktree has no `.tools/`. Install it there with the commands
  `scripts/setup-dev.sh` uses, and confirm `.tools/tree-sitter --version` reads 0.25.10.

- [ ] **Step 2: `LLVM_SYS_231_PREFIX=/usr scripts/check-all.sh`.** Expected: exit 0 with all three tiers. `llvm-config` reads 23.1.5 on this machine
  (checked 2026-11-18). If it stops at `no LLVM 23 found`, run `--no-llvm` instead and say so in the entry.

- [ ] **Step 3: `cargo llvm-cov nextest --workspace --fail-under-lines 90`.** Expected: exit 0.

- [ ] **Step 4: `scripts/check-slow.sh`.** Expected: exit 0.

- [ ] **Step 5: The scans**, each `--self-test` and then alone: `check-text-bytes.sh`, `check-citations.sh`, `check-attributions.sh`, `check-doc-figures.sh`,
  `check-shared-docs.sh`, `check-colours.sh`, `check-grammar-wasm.sh`, `check-lua.sh`. Then `node scripts/check-comments.mjs --self-test` and
  `--base 6b77731`. Expected: every one exits 0.

- [ ] **Step 6: `scripts/check-licences.sh --self-test`, then alone,** from `$W/web`, as CI's `web` job runs it. Expected: exit 0.

- [ ] **Step 7: CI's `web` sequence,** from `$W/web`. `pnpm exec biome ci --error-on-warnings`, `pnpm run typecheck`, `pnpm run test:coverage` and `pnpm run build:app`.
  Expected: exit 0, with coverage at or above the floors in `web/vite.config.ts` (lines 97, functions 97, branches 89, statements 95).

- [ ] **Step 8: The Docker image, which no PR job builds.**

```bash
docker build -t redextape-ir-panes $W >| $R/gate/docker-build.log 2>&1
docker run -d --name redextape-ir-panes-check -p 8099:80 redextape-ir-panes
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8099/
docker inspect --format '{{.State.Health.Status}}' redextape-ir-panes-check
curl -s http://127.0.0.1:8099/ | grep -o 'data-shows=' | wc -l
docker rm -f redextape-ir-panes-check
```

Expected: the build exits 0, `200`, `healthy` once the health check has run, and `4`: the built page carries the toggles (Review Focus 2).

- [ ] **Step 9: Report** each step's exit status and its summary lines to `$R/gate/summary.md`. A failure stops the task and goes back to the
  controller.

### Task 20: The roadmap entry

Traces to the design's §6 and §7.2 ("recorded in the roadmap entry with the machine and the command").

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (appended at the end of the file)

- [ ] **Step 1: Write the entry**, headed with the title *IR views groundwork PR 4: panes, layout and links*, the date, the branch `ir-panes`, the range from `6b77731` to Task 18's commit (or to the last code commit, if Task 18 had nothing to commit), the
  commit count and the words *plus this entry*, in the shape the entries above it use. Its sections:
  - What each workstream changed, and the seven departures from the design with their evidence.
  - The four decisions, and the user's answer to each.
  - **`##### WHAT THIS DID NOT CLOSE`**: the header's width with a fifth toggle (the view layouts spec's §6.1 measured 6.0 px to spare), a default grid under
    `MIN_VIEW_PX` with three lines in a narrow area, `pin.pc` having no reader yet, and whatever Tasks 16, 17 and 19 left open.
  - **`##### VERIFICATION`**: Task 16's timing with the machine and commands, Task 17's walkthrough, Task 19's gate.

- [ ] **Step 2: End VERIFICATION with the block `Every count this entry quotes, with what produces it`**, one row per figure: the value, what it counts, and
  **the command that produces it**. Run every command before committing and correct the entry to what it prints.

- [ ] **Step 3: Commit** with the subject `The roadmap records the panes, layout and links groundwork`. The diff touches this file alone.

## Spec coverage

| Design | Tasks |
|---|---|
| §5.2 `MachineViewChrome`, `ListingPanel`, one row builder, panels | 11, 12, 10, 13 |
| §5.2 (PR 3's roadmap entry) pane construction and the display family | 14, 15 |
| §5.3 the general rule, generated toggles, derived pins, keys 1 to N | 2, 4, 5 |
| §5.4 a pin names a pc, the fan-out over a table | 7, 6, 8, 9 |
| §7.2 no hot path slows | 16 |
| §7.3 the gate, the browser tier, coverage floors, a walkthrough | 17, 19 |
| §6 its own plan and roadmap entry | this plan, 20 |
