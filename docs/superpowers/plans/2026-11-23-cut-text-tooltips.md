# Cut text reads whole in a tooltip — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every text the stylesheet cuts with an ellipsis and gives no other way to read whole (a cell of the TM rule
table or of the rxm or clif listing, an instruction's text in the state diagram, a machine panel's name, a clif value or
rxm register, a call-stack frame, a heap line, a copy's `no term yet` in the copies list) shows its whole text in the
browser's tooltip while the pointer rests on it, and only while it is cut (the design's G1-G5).

**Architecture:** One `pointerover` listener on the document (`web/src/cut-text.ts`, added once by `main()`) takes off
the title it set last, finds the watched text the pointer has arrived on by one selector list, and, where that text is
cut at that moment (`scrollWidth > clientWidth`), sets its `title` to its `textContent`. So the only element carrying
such a title is the cut text under the pointer, nothing is read while a run steps, and a new text never inherits an old
title, because every container that shows a watched text builds a new element for it at each draw. A node test holds the
stylesheet's ellipsis rules to the watched list and to a named list of texts their own code titles (one, a copy's term,
only in part: its row with no term is watched).

**Tech Stack:** TypeScript, Vite, Vitest 4 (browser on Playwright, Chromium and Firefox), Biome. No Rust or CSS changes.

**Spec:** `docs/superpowers/specs/2026-11-23-cut-text-tooltips-design.md` (*the design*), committed with this plan. The
survey it cites (`/home/davey/temp/redextape-return-value-record/survey-b.md` §1) is a lead: every fact this plan uses
is re-read under *Verified facts*.

## Execution notes

- **Paths.** `W=/home/davey/temp/redextape-cut-text-tooltips` (branch `cut-text-tooltips`, cut from `main` at
  `798fa38`; the design and this plan are its first commit; not pushed);
  `R=/home/davey/temp/redextape-return-value-record/pr1`; `L=$R/impl` (every log, probe, sabotage driver and saved copy,
  commit message file and report; never the worktree); `T=/home/davey/.cache/redextape-cut-text-tooltips-target`
  (`export CARGO_TARGET_DIR=$T` in every shell that runs cargo, wasm-pack, `pnpm run typecheck` or `git commit`).
  `$R/plan-common.md` is this plan up to Task 1, for a dispatch that reads it and one task. The lane's ledger is
  `/home/davey/temp/redextape-return-value-record/progress.md`.
- **The worktree.** `web/node_modules` is installed. `pkg/`, `pkg-lsp/`, `pkg-clif/` and `web/bindings/` are copies
  built from `main`'s Rust, which this plan does not change; a task rebuilds one only if it is missing. The main
  checkout, `/home/davey/projects/redextape`, is for reading only.
- **No dev server serves `$W`**, and no task starts one: the sabotages edit `$W`.
- **One committing agent in `$W` at a time** (the pre-commit hook runs over the whole tree). No task pushes or opens a
  pull request: Davey gives that word, after Task 6.
- **Line references are at `798fa38`.** Once an earlier step has edited a file, find the place by name.

## Global Constraints

- **The design's goals, verbatim.** "G1. Every text in the table above shows its whole text in a tooltip while the
  pointer rests on it, in the clif, rxm and TM views, on any copy's view and in the header's copies list." "G2. A
  tooltip shows only on a text that is cut at that moment. A text that fits gets none." "G3. Whether a text is cut is
  decided when the pointer arrives on it; nothing is measured while the run steps." "G4. The tooltip is the browser's
  own (the `title` attribute), as on the readout strip's segments." "G5. A tooltip never shows text other than the
  element's current text: not a recycled row's old text, not a value from a step before."
- **Its non-goals.** No styled popup and no tooltip on keyboard focus; touch gets nothing. "No change to widths,
  wrapping, layout, or what is cut." `.program-count-word` stays cut without a tooltip. "Elements that carry a `title`
  today keep it unchanged." The highlight, the result shown whole and list results are PRs 2 and 3.
- **What the design left to the builder, settled here** (not to be reopened by an implementer):
  - *Where.* One `pointerover` listener on the document, added once by `main()`. Nothing in it names a view, so every
    view, a copy's included, is covered alike. A test that builds a view by hand adds it itself;
    `cut-text-app.test.ts` proves `main()` does (S11).
  - *Which texts.* `CUT_TEXT_SELECTORS`, nine selectors and no other: the eight of the design's five rules,
    `.state-cell`, `.rxm-cell`, `.clif-cell`, `.program-text`, `.machine-panel .panel-name`, `.rxm-register dd`,
    `.rxm-frame`, `.rxm-cell-line`, and `.buffer-row-term.is-absent`, a copy's row with no term (`no term yet`), which
    Davey added on 2026-11-23. That one is narrowed by its class because `.buffer-row-term`'s rule also cuts a row's
    term, which has its own title. `.machine-panel .panel-note` shares the panel name's rule and is not watched: its
    count has its own title.
  - *The cut test.* `el.scrollWidth > el.clientWidth`, read at the arrival only. Both are whole pixels, so a text cut by
    less than about half a pixel reads as whole and gets no tooltip.
  - *The tooltip's text.* The element's `textContent` as it is: a clif value's word and then its registers
    (`479001600 rr, a0`), a frame's or a heap line's whole line, a listing cell's pc column and leading spaces.
    Generated content (`data-marks`' `fires next`, `runs next`) is not text and is not in it.
  - *When.* At each `pointerover` and at nothing else. Each first takes off the title it set last, so a move onto a text
    that fits, onto another text or off every text leaves no title behind, and every arrival measures afresh. A resize
    under a pointer that does not move keeps the arrival's decision until the pointer next arrives on a text (G3's
    words, read over G2's in that one case; Davey's ruling, 2026-11-23). An arrival is whatever the browser reports as
    one: an engine that sends a `pointerover` to a new element drawn under a still pointer has that element measured.
  - *G5.* No watched text is ever rewritten in place: `VirtualGrid` builds every row and cell anew at each draw, the
    three machine panels build their bodies anew at each `show`, a panel's name is written once, and the copies list
    builds its rows anew each time it rebuilds them (*Verified facts*). The design's "recycled" rows are rebuilt ones.
    So a title leaves with its element, and the watcher needs nothing more for G5. A container that one day rewrote a
    watched text in place would show its old text; C4 and C7 fail then (S6, S7), and `watchCutText`'s doc says so.
  - *Unchanged.* `web/src/style.css` and every container. The watcher writes `title` and nothing else.
- **Commands** (notation used below). Each run writes `>| $L/<task>-<what>.log 2>&1` and is followed by `print $?`; the
  tallies are read from the log with `grep -aE 'Test Files|Tests |FAIL|×'`. zsh has `noclobber`, hence `>|`. Never pipe
  a run through `tail`: it hides the exit status. All from `$W/web` unless said.
  - `BROWSER files…`: `flock /home/davey/temp/redextape-browser.lock zsh -c 'until ! ss -ltn | grep -q ":63315 "; do
    sleep 5; done; VITEST_MAX_WORKERS=4 pnpm exec vitest run --project browser "$@"' _ <paths>`: the wait for port 63315
    (another project's vitest uses it) runs inside the lock. Paths are positional (`tests/browser/x.test.ts`); `pnpm
    test:browser -- name` does not scope, and `--maxWorkers` does not reach the browser projects.
  - `FIREFOX files…`: the same with `REDEXTAPE_FIREFOX=1` and `--project firefox --project firefox-capture`, the
    projects `pnpm run test:firefox` runs.
  - `SCROLLBARS`: the same as `BROWSER` with `--project browser-scrollbars tests/browser/machine-row-scrollbars.test.ts`
    in place of `--project browser` (it imports `machine-views.ts`, which Task 1 changes).
  - `NODE files…`: `pnpm exec vitest run --project node <paths>`.
  - `TSC`: `CARGO_TARGET_DIR=$T pnpm run typecheck`. `LINT`: `pnpm exec biome ci --error-on-warnings`. `COMMENTS`: `node
    scripts/check-comments.mjs --base 798fa38` from `$W`, as CI's `linear-history` job runs it against its base.
- **`AFFECTED`**, run before every commit: `NODE tests/node/cut-text.test.ts`; `BROWSER` on `cut-text` (from Task 2 also
  `cut-text-app`), `machine-panel-headers`, `machine-row`, `machine-row-app`, `panel-boundaries`, `rxm-pane`,
  `clif-pane`, `virtual-grid`, `tm-grid`, `state-diagram`, `buffer-list`, `clif-app`, `rxm-app`, `link-clear` (each
  `tests/browser/<name>.test.ts`); then `SCROLLBARS`. These are the new files, those that import `machine-views.ts`,
  those that hold the grids, panels and list whose texts are watched, and the one with the app's other document-wide
  pointer listeners. A `title` appears only under a hovering pointer, so no other file should change; Task 3 runs every
  one. **`AFFECTED-FF`**: `FIREFOX` on `cut-text` (from Task 2 also `cut-text-app`), `machine-panel-headers`,
  `machine-row`, `rxm-pane`, `clif-pane`. **Chromium is the gate; Firefox is read against Task 1 Step 0's baseline**,
  and a new file passes there whole.
- **`GATE`** (Task 3): each leg into `$L/03-<leg>.log`, its exit and seconds into `$L/03-gate-exits.txt`, by a script
  modelled on `/home/davey/temp/redextape-panels-row-record/impl3/02-gate-run.zsh` (its `web1` and `coverage` phases
  and `rest`'s `build-app` and Firefox legs; not its wasm builds, `check-all` or `rust`: no Rust changes, and the
  `pkg*/` copies are `main`'s):
  1. From `$W/web`: `pnpm run build:bindings`; `../scripts/check-licences.sh --self-test`, then alone; `LINT`; `TSC`.
  2. From `$W`, each with `--self-test` and then alone: `scripts/check-text-bytes.sh`, `check-citations.sh`,
     `check-attributions.sh`, `check-doc-figures.sh`, `check-shared-docs.sh`, `check-colours.sh`,
     `check-grammar-wasm.sh`, `check-lua.sh`, `check-licence-editions.sh`; `node scripts/check-comments.mjs
     --self-test`, then `COMMENTS`. (`rg -o 'scripts/check-[a-z-]+\.(sh|mjs)' .forgejo/workflows/ci.yml | sort -u` lists
     them with `check-all`, `check-slow`, `check-scoped` and `check-licences`.)
  3. `pnpm run test:coverage` (the node and Chromium tiers, and the coverage thresholds), under the browser lock with
     the port wait inside it, in a transient unit: `systemd-run --user --wait -p MemoryMax=16G -p MemorySwapMax=0` with
     `--setenv` for `PATH`, `HOME`, `CARGO_HOME`, `RUSTUP_HOME`, `CARGO_TARGET_DIR` and `VITEST_MAX_WORKERS=4`.
  4. `pnpm run build:app`; `SCROLLBARS`; `AFFECTED-FF`.
- **Test first.** A task writes its cases, runs them to see them fail for the reason it names, then builds. A case that
  cannot fail first is proven by its sabotage instead, and the report says which.
- **Sabotage.** Save a copy (`cp <file> $L/sab/<id>.orig`), make the one edit named, run the named files into
  `$L/<task>-sab-<id>.log`, copy the file back, `cmp` it. **Never `git checkout`**. One driver script a task, kept in
  `$L` (`/home/davey/temp/redextape-panels-row-record/impl3/01-sab-driver.mjs` is the model; this plan's drivers also
  run `NODE` for a row that names N1 or N2), one run a sabotage, in Chromium. Each row names the cases that must fail;
  **a sabotage that does not fire is a finding: stop and report**. A case stops at its first failed assertion, so a case
  named for two sabotages must fail under each alone, and the log is read for the assertion it failed at.
- **Commits.** One per task: `cd $W && export CARGO_TARGET_DIR=$T && git add <the task's files> && git commit -F
  $L/<task>-commit-msg.txt`. The hook runs the tree-wide scans, the comment guard and the licences check among them, and
  `biome ci` and `pnpm run typecheck` when `web/` files are staged. Never `--no-verify`, never `--amend`. The message is
  one long plain sentence saying what the commit holds, as `git log --oneline -5` shows. If the comment guard reports a
  budget, cut the comment to its why first; only if it is still over, write the value it prints into
  `scripts/comment-budget.json` in that commit and say so.
- **Copy and code.** "redextape" is lowercase in prose; spelling is British; no attribution to a person or a tool
  anywhere in the tree, and no test name or comment says who decided what. Doc comments are `/** */`. **A comment says
  why**: the reason, the invariant, what breaks if it changes. No history, no measurement, no `file:line`; a comment may
  point at the design. Wrapped at 120 columns.
- **Browser tests.** Real input only: a hover is `userEvent.hover(el, { position })` with **a new `position` object for
  every call** (it scales the one it is given in place), at a point inside the element's drawn part; no new case makes
  its own `PointerEvent` or calls `.click()`. A native tooltip cannot be seen by a test: a case reads the `title`
  attribute after a real hover, and first asserts the text cut (`whole(el)` false, `machine-views.ts:164`, which reads
  the glyphs' box against the clip) or whole, so no case passes because a text happened to fit. A text is made long (a
  20-digit word) or its view narrow; never by a style rule. A probe prints with `console.error` and is gone before the
  commit.

## Review Focus

Inputs the design implies and no line of it tests, most likely first. Each has its case.

1. **The pointer on a child of a cut text** (a frame's callee, a heap line's address): the whole line's text, set on the
   line. C6, by S5.
2. **The pointer moving straight from one cut text to the next** (two values side by side): the new one's title only.
   C3, by S3.
3. **The text under a still pointer changed by a step or a scroll**: no title anywhere holds the old text, and the next
   move gives the new one's. C4, C7, by S6, S7.
4. **A text that is cut at one width and fits at another**: decided again at each arrival, both ways. C5, by S1, S3.
5. **A run stepping with the pointer resting off every cut text**: nothing measured. C8, by S8.
6. **A view the app builds** (the TM rule table, the diagram's instruction text, fact(12)'s result in the clif view):
   the same tooltip as in a view a test builds. A1-A3, by S11.
7. **A copy's row with a term**, which `.buffer-row-term`'s rule cuts as it cuts `no term yet`: it keeps its own title
   after the pointer has rested on it and left. C9, by S15.

## Verified facts (at `798fa38`, read while writing this plan)

- **The rules.** The design's five, in `web/src/style.css`: `.state-cell, .rxm-cell, .clif-cell` (:1834-1840),
  `.program-text` (:2588-2592), `.machine-panel .panel-name, .machine-panel .panel-note` (:3109-3114), `.rxm-register
  dd` (:3185-3190), `.rxm-frame, .rxm-cell-line` (:3209-3214). The others cut with a title from their own code, or by
  design: `.results .segment` (:656-662; `readout.ts:423`), `span.view-title, .view-title-text` (:871-876;
  `view-header.ts:173`, `:177`), `.tm-line > .tm-state` (:1129-1136; `tm-pane.ts:671`), `.buffer-row-term` (:1540-1547;
  `buffer-list.ts:178`, only where the row has a term: a row with none reads `no term yet`, with the class `is-absent`
  and no title, :176-178), `.program-count-word` (:2655-2661; by design), `.local-node` (:2833-2847;
  `state-diagram.ts:882`), and `.machine-panel .panel-note` (`machine-panels.ts:193-206`). Two more hits, :1475 and
  :1523, are in comments.
- **No watched element has a title** (`rg -n "\.title = |setAttribute\('title'" web/src` hits none of them), and **no
  app code reads `scrollWidth`** (`rg -n scrollWidth web/src`: none), so a spy on it counts the watcher's reads alone.
- **Each watched text is written into a new element.**
  - `VirtualGrid.draw` (`virtual-grid.ts:327`) builds every drawn row and its one cell anew (:417-433) and swaps them
    in (:434), at every draw: a frame, a scroll, a resize, a key. It draws from `OVERSCAN = 4` rows above the first in
    view (:5). Its users: the rxm and clif listings (`listing-panel.ts:48`, through `followed-grid-panel.ts:43`; cells
    `rxm-cell`, `rxm-pane.ts:99`, and `clif-cell`, `clif-pane.ts:121`, the latter a `span.rxm-pc` then the text,
    :275-282), the TM rule table (`tm-pane.ts:194`; `state-cell`, :716) and the diagram's program level
    (`state-diagram.ts:226`; `program-text`, a `b` mnemonic then the operands, :672-678).
  - The machine panels build their bodies anew at each `show` (`machine-panels.ts:91`, :129, :167): `.rxm-register dd`
    holds the word and, for a clif value, `' '` and `span.value-regs` (:71-78); `.rxm-frame` holds `b.rxm-callee`, the
    return and the saved words (:115-126); `.rxm-cell-line` holds a `b` (the address), the body and `span.rxm-refs`
    (:154-163). `RxmPane.render` and `ClifPane.render` call every `show` at every frame (`rxm-pane.ts:209-212`,
    `clif-pane.ts:237-240`).
  - A panel's name is written once, by `createPanel` (`panel.ts:60-62`).
  - The copies list (`bufferList`, `buffer-list.ts:297`) builds every row anew in `rebuildRows` (:337-360), which swaps
    them in (:358) at the list's `beforetoggle` (:421-425), a delete (:370) and a pause or resume (:408); its `update`
    (:448) writes only the button. The list is at most `90vw` wide (`.buffer-list`, `style.css:1483-1484`).
    `buffer-list.test.ts` builds a header and its button (:25-32) and the rows `THREE` (:47-51).
- **Names.** The rxm registers' rows are `pc`, `rr`, `a0…`, then `r0…` (`rxm-view.ts:97-111`); a clif value's row is
  `v<k>` (`clif-view.ts:141-155`). The panels are `registers` or `values`, `call stack` and `heap`
  (`rxm-pane.ts:109-121`, `clif-pane.ts:130-147`).
- **The install site.** `main()` (`main.ts:238`; `export const ready = main()` at :3216) wires the app's document-wide
  gestures where it calls `wireLinkClear(root, …)` (:1892).
- **The test scaffolding.** `machine-views.ts`: `loadViews` (:28; a 1280 by 1000 viewport, `fact.rxt`'s clif listing),
  `Counts` (:48), `VIEWS` (:73; the rxm view's `draw` at :83 draws `FACT3`, the clif view's at :110), `mount` (:139; a
  900px-tall host), `resize` (:155), `whole` (:164), `title` (:237), `maximise` (:238). `harness.ts`: `SHELL` (:39),
  `PREFIX` (:884), `frames` (:995), `hearLoops` (:1012), `compile` (:1553), `tmPane` (:622), `stateTable` (:693),
  `diagram` (:696). `machine-panel-headers.test.ts:90-104` holds each view's call-stack title cut at 110px and whole at
  200px. `clif-app.test.ts:67-76` boots the app and shows the clif view by `PREFIX` then `5`. `fact-12`'s value is
  `'479001600'` and its clif leg ends (`examples.ts:100-107`).
- **User docs.** `web/help.html`'s *Getting around* (:23-64) says nothing of a cut text or a tooltip.

## The mechanism

- `watchCutText(doc)` adds one `pointerover` listener to `doc` and keeps one element, the last it titled. At each event
  it takes that element's `title` off and forgets it; finds the watched text the event's target is in
  (`closest(CUT_TEXT)`, the target an `Element`); and where there is one and its `scrollWidth > clientWidth`, sets its
  `title` to its `textContent` and keeps it. Nothing else listens, observes or reads the layout.
- Its doc says why it is built so: decided at the arrival, so a step costs nothing; one title at a time, so none
  outlives the pointer; and that it relies on no container rewriting a watched text in place (a rewritten element would
  keep its old title), which `cut-text.test.ts` holds.

## File structure

| File | Change |
|---|---|
| `web/src/cut-text.ts` | new: `CUT_TEXT_SELECTORS`, `CUT_TEXT`, `watchCutText` (Task 1) |
| `web/tests/node/cut-text.test.ts` | new: N1, N2, the class guard (Task 1) |
| `web/tests/browser/machine-views.ts` | `Counts` gains `words`, `regs`, `lines`, `saved`; each view's `draw` reads them (Task 1) |
| `web/tests/browser/cut-text.test.ts` | new: C1-C8 in each machine view, C9 in the copies list (Task 1) |
| `web/src/main.ts` | `watchCutText(document)` beside `wireLinkClear` (Task 2) |
| `web/tests/browser/cut-text-app.test.ts` | new: A1-A3 (Task 2) |
| `web/help.html` | one sentence (Task 2) |
| the design; the roadmap | Task 4 |

No CSS change and no change to any container.

## Design coverage

| The design | Where |
|---|---|
| G1: every text of the five rules, in the clif, rxm and TM views and on a copy's, and `no term yet` in the copies list | C1, C5, C6, C7 (values, a panel's name, frame and heap lines, listing cells, in both machine views); C9 (`no term yet`); A1-A3 (the clif value, the TM rule table, the diagram's text, through `main()`); a copy's view by construction (one listener on the document) |
| G2: only a cut text, none on one that fits | C2, C3, C5 |
| G3: decided at the arrival; nothing measured while the run steps | C5 (afresh at each arrival), C8 |
| G4: the browser's own `title` | every case reads `title` |
| G5: never another text | C3, C4, C7 |
| Non-goals | nothing added for focus, touch or a popup; no CSS change (Task 5 reads the diff) |
| `.program-count-word` stays cut; titled elements keep their titles | N1's named lists; N2; no watched element has a title; C9 (a copy's term keeps its own) |
| Left to the builder | *Settled here* |
| Both engines | Tasks 1 and 2 run their files in Firefox; Task 3 drives the built app in both |

## Decided after planning (Davey, 2026-11-23)

- **A resize under a still pointer** keeps the arrival's decision until the pointer next arrives on a text: a value made
  whole by a resize keeps its tooltip, and one a resize cuts gets none, until the pointer moves off it and back. Left
  so, as G3's "decided when the pointer arrives" reads; the design's *Decided* records it.
- **`no term yet`**, the sentence on a copy's row without a term, is watched like the rest: `.buffer-row-term.is-absent`
  (*Settled here*), the class guard's `PART_WATCHED`, C9, S14 and S15.
- **Whether the browser shows the tooltip** a `title` asks for is seen only by a person: Davey checks it by hand when he
  tries the branch, in Firefox, with the pointer resting on fact(12)'s cut result in the clif view (Task 3's drive reads
  the `title` only).

---

### Task 1: The watcher, its class guard, and the machine views' cases

**Files:**
- Create: `web/src/cut-text.ts`, `web/tests/node/cut-text.test.ts`, `web/tests/browser/cut-text.test.ts`
- Modify: `web/tests/browser/machine-views.ts` (`Counts` :48; the two `draw`s, :83 and :110)

**Interfaces:**
- Consumes: `whole`, `mount`, `resize`, `title`, `maximise`, `loadViews`, `VIEWS` (`machine-views.ts`); `hearLoops`,
  `frames` (`harness.ts`); `OVERSCAN` (`virtual-grid.ts`), `ROW_HEIGHT` (`state-table.ts`) and `bufferList`
  (`buffer-list.ts`).
- Produces: in `cut-text.ts`, `export const CUT_TEXT_SELECTORS: readonly string[]` (the nine, in *Settled here*'s
  order), `export const CUT_TEXT: string` (them joined by `', '`) and `export function watchCutText(doc: Document):
  void`. In `machine-views.ts`, `Counts` gains `words?: (i: number) => string` (the word of value or local `i`, and the
  head of heap cell `i + 1`; `String(i)` without it), `regs?: readonly string[]` (the rxm registers every clif value
  names), `lines?: number` (how many heap cells the window draws as lines, each with `nil` for its tail) and `saved?:
  string` (the word every rxm frame saved, as its one saved register); a caller that passes none draws as today.

- [ ] **Step 0: Baselines** at the plan's commit: `AFFECTED` without the new files into `$L/00-base-affected.log`,
  `AFFECTED-FF` likewise into `$L/00-base-firefox.log`, `TSC` and `LINT` into theirs. Expected: Chromium all pass; the
  report lists each Firefox failure by case, and every later Firefox run is read against that list.
- [ ] **Step 1: Write the cases.** `cut-text.ts` first holds the three exports as stubs (no selectors, and `CUT_TEXT`
  the selector `':not(*)'`, which matches nothing, until Step 3, since the empty join is no selector and every query on
  it throws; a `watchCutText` that adds nothing), so every file loads; `machine-views.ts` gains the four `Counts`
  fields.

  In `tests/node/cut-text.test.ts`: the stylesheet read from `../../src/style.css` with its comments taken out, each
  innermost rule read as its selector list and its declarations; the *ellipsis selectors* are the selectors (split at
  commas, each run of whitespace made one space) of every rule that declares `text-overflow: ellipsis`.
  - **N1** *names every text the stylesheet cuts with an ellipsis, as watched, as titled by its own code, or as both in
    part*: each ellipsis selector is in `CUT_TEXT_SELECTORS`; or is a key of the file's `TITLED` record (selector to
    reason): `.results .segment` (its segment's title, `readout.ts`), `span.view-title` and `.view-title-text` (the view
    title's, `view-header.ts`), `.tm-line > .tm-state` (`tm-pane.ts`), `.program-count-word` (only the unit word is cut,
    by design), `.local-node` (`state-diagram.ts`), `.machine-panel .panel-note` (the count's, `machine-panels.ts`); or
    is a key of its `PART_WATCHED` record (selector to the watched selector for the part its code leaves untitled) whose
    value is in `CUT_TEXT_SELECTORS`: `.buffer-row-term` to `.buffer-row-term.is-absent` (a row's term has its own
    title, `buffer-list.ts`; a row with no term reads `no term yet` and has none). The failure names each selector that
    is in none.
  - **N2** *watches no text the stylesheet does not cut, and none its own code titles*: each of `CUT_TEXT_SELECTORS` is
    an ellipsis selector or a value of `PART_WATCHED`, and none is a key of `TITLED` or of `PART_WATCHED`.

  In `tests/browser/cut-text.test.ts`: `loadViews()`; `beforeAll(() => watchCutText(document))`; `hearLoops(() => {
  document.body.innerHTML = '' })`; `LONG = '18446744073709551615'` (the largest word, 20 digits) and `OTHER =
  '12345678901234567890'`; `value(host, i)`, the `dd` beside the `dt` reading `r<i>` in rxm and `v<i>` in clif;
  `titled(root)`, the watched elements under `root` that have a `title`; `hover(el, x)`, a real hover `x` px in from
  `el`'s left at its middle height. `describe.each(VIEWS)('in the $kind view', …)`:
  - **C1** *gives a cut value its whole text as its tooltip when the pointer arrives on it*: `mount(view, view.wide +
    300)`; `draw({ depth: 1, cells: 1, boxes: 0, rows: { stack: 0, values: 4 }, words: (i) => (i === 0 ? LONG :
    String(i)), regs: ['rr', 'a0'] })`; `v = value(host, 0)`, cut, with no `title` attribute; `hover(v, 4)`: `v.title`
    is `LONG` in rxm and `LONG` followed by `' rr, a0'` in clif, written out, and `titled(document.body)` is `[v]`.
  - **C2** *gives a value that fits no tooltip*: C1's frame; `value(host, 1)` whole; `hover(…, 2)`: it has no `title`
    attribute, and `titled(document.body)` is empty.
  - **C3** *keeps one tooltip, the one under the pointer*: C1's frame with `words: (i) => (i < 2 ? LONG : String(i))`;
    `hover(value(host, 0), 4)`, then `hover(value(host, 1), 4)`: the first has no `title` attribute and the second's is
    its text; then a hover on the `dt` of `r1` or `v1`: `titled(document.body)` is empty.
  - **C4** *shows no value from a step before when a step changes the value under a still pointer*: C1's frame;
    `hover(value(host, 0), 4)`; a step: `draw` again with `words: (i) => (i === 0 ? OTHER : String(i))`, then
    `frames()`; precondition: `value(host, 0)` reads `OTHER` and is cut. Every element of `titled(host)` has its `title`
    equal to its `textContent`, and none holds `LONG`; then `hover(value(host, 0), 6)`: its `title` is `OTHER` (with
    `' rr, a0'` in clif).
  - **C5** *decides at each arrival, so a title a wider view makes whole has no tooltip and a narrower one has one
    again*: `mount(view, 110)` and `draw({ depth: 1234, cells: 1234, boxes: 12 })`, as
    `machine-panel-headers.test.ts:90-104` does; `t = title(host, 'stack')`, cut; `hover(t, 2)`: `t.title` is `'call
    stack'`; a hover on `maximise(host, 'stack')` (drawn at every width, not watched); `resize(host, 200)`; precondition
    `t` whole; `hover(t, 2)`: no `title` attribute; a hover on the maximise button; `resize(host, 110)`; precondition
    `t` cut; `hover(t, 2)`: `'call stack'` again.
  - **C6** *gives a cut frame and a cut heap line their whole line, from any part of it*: `mount(view, 110)`;
    `draw({ depth: 2, cells: 1, boxes: 0, rows: { stack: 2, values: 0 }, lines: 1, words: () => LONG, saved: LONG })`;
    the first `.rxm-frame` and the first `.rxm-cell-line`, each cut. A hover on the frame's `.rxm-callee`: the frame's
    `title` equals its `textContent`, which is longer than the callee's (and ends with `LONG` in rxm). A hover on the
    heap line's `b`: the line's `title` equals its `textContent`, which holds `LONG`.
  - **C7** *gives a cut listing row its text, and no row an old one when the listing scrolls under a still pointer*:
    `mount(view, 110)`, `draw({ depth: 1, cells: 1, boxes: 0 })`; the listing (`.rxm-listing` or `.clif-listing`)
    scrolled `(OVERSCAN + 2) * ROW_HEIGHT` down and `frames()`, so that the next scroll moves the drawn window's first
    row by as many rows as it moves the view, and the cell under a point keeps its place among the drawn rows
    (precondition: the listing's scroll range holds `OVERSCAN + 5` rows; where the rxm listing's 25 rows do not give
    it, a shorter host does); `c`, the cell drawn at the listing's middle height, cut, and `p`, a point 4px in from its
    left at its middle; `hover(c, 4)`: its `title` is its `textContent`. The listing scrolled 3 rows more and
    `frames()`; precondition: the watched text at `p` (`document.elementFromPoint`, then `closest(CUT_TEXT)`) reads
    otherwise than `c` did, and is cut. Every element of `titled(host)` has its `title` equal to its `textContent`, and
    none holds `c`'s text; then a hover 6px in on the text at `p`: its `title` is its `textContent`.
  - **C8** *measures nothing while the run steps*: C1's frame; precondition `value(host, 0)` cut; a hover on the `dt` of
    `r1` or `v1`; then `vi.spyOn(Element.prototype, 'scrollWidth', 'get')`, which reads through; 10 `draw`s, value 0's
    word `LONG` and `OTHER` in turn, each followed by `frames()`: none of the spy's `mock.contexts` is a watched element
    (`matches(CUT_TEXT)`). Then, the instrument's own check, `hover(value(host, 0), 4)`: at least one is. The spy is
    restored in a `finally`.

  Then `describe('in the copies list', …)`, outside `VIEWS`:
  - **C9** *gives a copy's cut `no term yet` its text, and leaves a cut term's own title as its code set it*: the page
    narrowed until the sentence is cut (the file names the width, and the viewport goes back to 1280 by 1000 in a
    `finally`); a header holding a button, as `buffer-list.test.ts` builds them; `bufferList(button, () => ROWS, noop,
    noop, noop)`, `ROWS` two warm λ copies, the first's term `LONG` and the second's `null`; the list opened by
    `userEvent.click` on its button. Preconditions: the second row's `.buffer-row-term` (`absent`) reads `no term yet`
    and is cut, with no `title` attribute, and the first row's is cut with its `title` `LONG`. `hover(absent, 4)`: its
    `title` is `'no term yet'`. Then a hover on the first row's term and one on its `.buffer-row-name`: the term's
    `title` is still `LONG`, and `titled(document.body)` is empty.
- [ ] **Step 2: Run red.** `NODE tests/node/cut-text.test.ts` into `$L/01-red-node.log` and `BROWSER
  tests/browser/cut-text.test.ts` into `$L/01-red.log`. Expected FAIL: N1, naming the eight and `.buffer-row-term`; C1,
  C3, C5, C6, C7 and C9 at their first `title`; C4 at its last hover; C8 at its instrument check. N2 and C2 pass
  (nothing is watched yet); N-b, S15 and S1 prove them. A case that fails at a precondition is a width or a test to fix
  before the build, not a red.
- [ ] **Step 3: Build** `cut-text.ts` as *The mechanism* says, its module and function docs saying the why.
- [ ] **Step 4: Run green.** The two runs again into `$L/01-green-node.log` and `$L/01-green.log`, and `FIREFOX
  tests/browser/cut-text.test.ts` into `$L/01-green-firefox.log`. Expected: all pass, in both engines.
- [ ] **Step 5: Sabotage**, one driver `$L/01-sab-driver.mjs`, each into `$L/01-sab-<id>.log`:

| Id | The one edit | Must fail |
|---|---|---|
| S1 | the cut test answers `true` | C2 (its `title`); C5 (at 200px) |
| S2 | the cut test answers `false` | C1, C3, C5, C6, C7, C9 (each at its first `title`); C4 (its last hover); C8 (its instrument check) |
| S3 | the last titled element is forgotten without its `title` being taken off | C3 (the first value's `title`); C5 (at 200px) |
| S4 | the `title` is the text of the element's first child node | C1 in clif (its registers); C6 (each line) |
| S5 | the watched text is the target itself (`matches` in place of `closest`) | C6 (the frame, hovered on its callee) |
| S6 | `valuesPanel`'s `show`, where its list already has as many rows, sets each row's word and registers in the `dd` it drew last instead of building a new list | C4 (no `title` holds `LONG`) |
| S7 | `VirtualGrid.draw` takes, for the row at each place of the drawn window, the cell of the row drawn at that place last time, emptied of its children, classes and `data-marks`, in place of a new `div` | C7 (no `title` holds `c`'s text) |
| S8 | `valuesPanel`'s `show` reads each new `dd`'s `scrollWidth` | C8 (nothing measured while stepping) |
| S9 | `.machine-panel .panel-name` out of `CUT_TEXT_SELECTORS` | C5 (at 110px); N1 |
| S10 | `.rxm-frame` out of `CUT_TEXT_SELECTORS` | C6 (the frame); N1 |
| S14 | `.buffer-row-term.is-absent` out of `CUT_TEXT_SELECTORS` | C9 (its first `title`); N1, naming `.buffer-row-term` |
| S15 | `.buffer-row-term` in place of `.buffer-row-term.is-absent` in `CUT_TEXT_SELECTORS` | C9 (the term's own `title`); N2 |
| N-a | `style.css` gains `.cut-probe { overflow: hidden; text-overflow: ellipsis; }` | N1, naming `.cut-probe` |
| N-b | `CUT_TEXT_SELECTORS` gains `.rxm-frames` | N2 |

- [ ] **Step 6: Gates and the commit.** `AFFECTED` into `$L/01-affected.log` (Step 0's tallies and the new cases, all
  passing), `AFFECTED-FF` into `$L/01-firefox.log` (Step 0's failures and no other), `TSC`, `LINT` and `COMMENTS` into
  theirs; the message in `$L/01-commit-msg.txt`; the commit holds the four files.
- [ ] **Step 7: Report** in `$L/task-1-report.md`: Step 0's Firefox list; any width or host a case uses other than the
  plan's, and why; each sabotage, the cases and assertions it failed at, its log; the tallies of Steps 2, 4 and 6.

### Task 2: The app adds the watcher: the TM view's texts and fact(12)'s result

**Files:**
- Modify: `web/src/main.ts` (beside `wireLinkClear`, :1892); `web/help.html` (*Getting around*'s item on the views,
  :39-50)
- Create: `web/tests/browser/cut-text-app.test.ts`

**Interfaces:**
- Consumes: `watchCutText`, `CUT_TEXT` (Task 1); `whole` (`machine-views.ts`); `SHELL`, `PREFIX`, `compile`, `host`,
  `stateTable`, `diagram`, `until` (`harness.ts`); `EXAMPLES` (`examples.ts`).
- Produces: nothing new.

- [ ] **Step 1: Write the cases.** One boot for the file, as `clif-app.test.ts:67-76` does: `page.viewport(1280, 1600)`,
  `SHELL`, `main`'s `ready`, `compile` of `fact-12`'s text, `PREFIX` then `5` for the clif view, its run recorded, then
  its `.to-newest` pressed and the run's end awaited (a hook of up to 60s). Each case finds its text, asserts it cut,
  hovers it as Task 1's cases do, and reads its `title`:
  - **A1** *gives fact(12)'s result its whole text in the clif view*: the clif view's value `dd` whose word is
    `479001600`; its `title` is its `textContent`, which starts with `479001600`. If no value reads `479001600` at the
    run's end, stop and report: the case the design was asked for is not where the survey put it.
  - **A2** *gives a cut rule of the TM view's rule table its text*: the first drawn `.state-cell` that is cut.
  - **A3** *gives a cut instruction of the TM view's diagram its text*: the first drawn `.program-text` that is cut, at
    the diagram's program level.

  Where a text is whole at 1280px, the file's viewport is narrowed until it is cut, and the file says so with the width;
  never a style rule.
- [ ] **Step 2: Run red.** `BROWSER tests/browser/cut-text-app.test.ts` into `$L/02-red.log`. Expected FAIL: A1-A3 at
  their `title`, after their preconditions pass.
- [ ] **Step 3: Build.** `main()` calls `watchCutText(document)` beside `wireLinkClear(root, …)`. In `help.html`, the
  item on the views gains, after its sentence on the clif view's step cap: "In the TM, rxm and clif views, a value, an
  instruction or a line cut short reads whole in a tooltip while the pointer rests on it."
- [ ] **Step 4: Run green.** `BROWSER` and `FIREFOX` on `tests/browser/cut-text-app.test.ts` into `$L/02-green.log`
  and `$L/02-green-firefox.log`. Expected: all pass, in both.
- [ ] **Step 5: Sabotage**, one driver `$L/02-sab-driver.mjs`:

| Id | The one edit | Must fail |
|---|---|---|
| S11 | `main()` without `watchCutText(document)` | A1, A2, A3 (each at its `title`) |
| S12 | `.state-cell` out of `CUT_TEXT_SELECTORS` | A2; N1 |
| S13 | `.program-text` out of `CUT_TEXT_SELECTORS` | A3; N1 |

- [ ] **Step 6: Gates and the commit.** `AFFECTED` and `AFFECTED-FF`, now with `cut-text-app`, `TSC`, `LINT` and
  `COMMENTS`; the commit holds the three files.
- [ ] **Step 7: Report** in `$L/task-2-report.md`: the viewport the file uses and why; each sabotage's result; the
  tallies.

### Task 3: The full gate, and the built app driven in both engines

**Files:** none unless a leg fails. One agent, and no other browser run of this lane on the machine meanwhile.

- [ ] **`GATE`** at the head, every leg. Expected: exit 0 each; the coverage thresholds met; Firefox, Step 0's failures
  and no other.
- [ ] **The built app, driven** as `/home/davey/temp/redextape-panels-row-record/impl3/02-hand.zsh` drives it (`vite
  build` into `$L/hand/dist`, `vite preview` on a free port of 4391-4399 under the browser lock), by
  `$L/hand/drive.mjs`, in Playwright's Chromium and then its Firefox, at a 1412 by 896 window: open fact(12) from
  *examples ▾*, show the clif view by its toggle, press ⏭; with the real mouse on the cut `479001600` value, read its
  `title` and take a screenshot of the values panel into `$L/hand/`; the same for the first cut rule of the TM view's
  rule table; then the mouse on a value that fits, its `title` read. Where no rule of the TM view's rule table is cut at
  1412 by 896, the window is narrowed as Task 2's file narrows its viewport, until one is, and the report gives the
  width. Expected: the titles A1 and A2 read, none on the value that fits, no page error. The tooltip itself is in no
  screenshot: Davey checks the native one by hand when he tries the branch, in Firefox, with the pointer resting on
  fact(12)'s result in the clif view.
- [ ] A leg that fails is fixed in a commit of its own, test first, and the legs its files feed run again.
- [ ] **Report** in `$L/task-3-report.md`: each leg's exit and tally, the drive's readings.

### Task 4: The design's as-built lines, and the roadmap entry

**Files:** `docs/superpowers/specs/2026-11-23-cut-text-tooltips-design.md` (a new `## As built` section);
`docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (an entry appended after the last, which starts at :40222).

- [ ] **The design's `## As built`**, a line each, only where the build differs from its text or settles a premise it
  stated: `VirtualGrid`'s rows are rebuilt at each draw, not recycled, and G5 rests on that (C4, C7). Where the code
  lives and the cut test were left to the builder, and a resize under a still pointer and `no term yet` are in its
  *Decided*: they are not differences.
- [ ] **User docs.** Search `web/*.html`, `README.md` and `docs/*.md` for what a person reads about a cut value or a
  tooltip; change a line only where it has become false; report what the search found (Task 2 added help's sentence).
- [ ] **The roadmap entry**, appended, in the shape of the entries above it: a `####` heading saying what a person now
  sees, then ``(2026-11-23, branch `cut-text-tooltips`, `798fa38..<last code commit>`, N commits, plus this entry)``;
  what changed (the five rules' texts in the clif, rxm and TM views and `no term yet` in the copies list read whole in a
  tooltip, on the pointer's arrival, only where cut; one listener on the document; the class guard); the rulings under
  *Settled here*; `##### WHAT THIS DID NOT CLOSE`: PR 2 (the highlight, and the result shown whole at a run's end) and
  PR 3 (list results), keyboard and touch (non-goals), a resize under a still pointer, a cut of less than half a pixel,
  and that the tooltip's showing is seen by hand only; `##### VERIFICATION`: the gate's legs and tallies, each sabotage
  and the cases it failed with their logs in `$L`, and the drive; ending with *Every count this entry quotes, with what
  produces it*, a row per figure (its value, what it counts, the command). Every one of those commands is run after the
  last code commit into `$L/04-figures.log`, and the entry quotes values and SHAs, not "all" or "the only".
- [ ] **Commit** the two docs; the hook's scans, `check-doc-figures` among them, pass. Report in `$L/task-4-report.md`.

### Task 5: A review of `798fa38..HEAD`

**Files:** `$L/review.md` only.

- [ ] A fresh reviewer (opus) reads the design, this plan and `git diff 798fa38..HEAD`, edits nothing in `$W`, and
  writes `$L/review.md`: findings by severity, each with its file and line and the input that shows it. It asks in
  particular: can a `title` stay on an element the pointer has left, or be set on one that fits; is anything measured
  outside the `pointerover` handler; does a watched selector reach an element with a title of its own; is any watched
  text written in place anywhere; did `style.css` or any container change; is any case blind (a sabotage that failed at
  another assertion than the one named, or a precondition a fitting text could pass); does a comment hold history or a
  measurement; does the roadmap entry quote a figure its table does not produce.
- [ ] **Report** the findings' count by severity in `$L/task-5-report.md`.

### Task 6: The review's fixes

**Files:** as the findings need.

- [ ] Each finding is checked before it is acted on: a finding is a claim. One that holds is fixed test first, in a
  commit of its own, with a sabotage where it adds a test, and its class is searched for siblings. One that does not
  hold is answered in `$L/review.md` with the evidence.
- [ ] Then `GATE`'s legs for every file the fixes touch (all of it if a file under `web/` changed) and `AFFECTED-FF`,
  and a commit that brings the roadmap entry up to the fixes, its range, counts and figures run again into
  `$L/06-figures.log`.
- [ ] **Report** the head SHA and the tallies in `$L/task-6-report.md`. **Stop there**: pushing and opening the pull
  request wait for Davey's word.
