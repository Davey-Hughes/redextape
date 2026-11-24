# Remove copies, PR 1: copies out of the web app — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No copy can be made, edited, seen, stored or restored in the web app: ⋯ *edit a copy*, `copies ▾` with
*new TM copy*, *new rxm copy*, delete, undo, pause and resume, the copy editors, the λ, TM and rxm views' *text* and
*outline* panels and their ⋯ *format* and *move the editor here*, `copy · not linked`, the copy pairs, rows,
sentences and notices, the warm-copy cap and the `redextape.buffers` store all go, with the web code only copies
reached and its tests; the app removes `redextape.buffers` at every start-up; links, workspaces, arrangements and
programs stored before the change load; the web app loads only the `redextape` grammar and LSP language (the
design's G1-G6 as they fall to PR 1).

**Architecture:** Tests that borrow a copy for their content or for a second view move onto the program or a
component fixture first, while copies still exist (Tasks 1-2). Then the copies' stored state goes (Task 3), so no
later commit restores a copy it cannot end; then each way in, a leg at a time (rxm, TM, λ: Tasks 4, 5, 9), each with
its view's copy parts, and between them what a removed way in leaves unreached: the state diagram's tiers only a
hand-written machine reached (6), the TM and rxm views' editor panels (7), `copies ▾` (8). After the last way in go
the editors and custody (10), what showed a copy (11) and the copies' sessions in the registry, worker, protocol and
replies (12). The languages (13) and the pages and docs (14) close the code. Each task deletes the tests of what it
removes, keeps the coverage floors and leaves a working app that passes the pre-commit gate.

**Tech Stack:** TypeScript, Vite, Vitest 4 (browser on Playwright: Chromium the gate, Firefox compared), Biome,
CodeMirror 6, web-tree-sitter. No Rust code change: the wasm exports only copies used stay, unused by the app, until
PR 2; three Rust comments that cite web code PR 1 removes are re-said (ruling 15).

**Spec:** `docs/superpowers/specs/2026-11-23-remove-copies-design.md` (*the design*), its PR 1 alone. Its
`file:line` facts are at `5b5ef1f`, whose tree equals `b627fe3`; what planning found wrong is under *Verified facts*.
The seven read-only surveys behind this plan are `$R/pr1/survey-*.md` (at `b627fe3`; their `T1`-`T8` are the
provisional tasks of `$R/pr1/survey-rubric.md`, mapped in *Execution notes*).

## Execution notes

- **Paths.** `W=/home/davey/temp/redextape-remove-copies` (branch `remove-copies` on `b627fe3`, this plan's commit the
  first on it, not pushed); `R=/home/davey/temp/redextape-remove-copies-record` (ledger `progress.md`);
  `L=$R/pr1/impl` (every log, probe, sabotage driver and saved copy, commit message file and report; never the
  worktree); `T=/home/davey/.cache/redextape-remove-copies-target` (`export CARGO_TARGET_DIR=$T` in every shell that
  runs cargo, wasm-pack, `pnpm run typecheck` or `git commit`). The main checkout, `/home/davey/projects/redextape`,
  is read and never written.
- **The worktree.** `web/node_modules` is a copy, not a symlink, and stays one. `pkg/`, `pkg-lsp/`, `pkg-clif/` and
  `web/bindings/` are built from `main`'s Rust, whose code PR 1 does not change; a task rebuilds one only if it is
  missing or a symlink.
- **No dev server serves `$W`**, since the sabotages edit it, and no task starts one (`ss -ltnp | grep 5173` and that
  process's cwd say which checkout one serves).
- **One committing agent in `$W` at a time** (the pre-commit hook runs over the whole tree). No task pushes or opens a
  pull request: Davey gives that word, after Task 18.
- **Line references are at `b627fe3`.** Once an earlier task has edited a file, find the place by name.
- **`$R/pr1/plan-common.md` is this plan's head**, from the title to the rule before Task 1. A task's dispatch is that
  file and the task.
- **The surveys' tags.** A task that cites "the survey's rows" reads them in `$R/pr1/survey-<name>.md` with this map;
  where a task's own table disagrees with a survey row, the task wins.

| Survey tag | Plan task |
|---|---|
| `T1` STORE | 3 |
| `T2` RESEAT | 1 (the state diagram's files, `link-clear`, `tm-grid`, `tm-status-line`) and 2 (the rest) |
| `T3` RXM | 4, except what is total over `CopyLeg` (ruling 2): 12 |
| `T4` TM | 5 (the ways in, the value run, the TM view's copy status), 6 (the tiers), 7 (the text and outline panels, `copy-editor.ts`, `LEG_PANELS`' `outline`), except what is total over `CopyLeg`: 12 |
| `T5` λ + PAGE | 8 (`copies ▾` and what only it reaches), 9 (the λ way in and the page code only a copy reaches), 10 (the editors and custody) |
| `T6` REST | 11 (what showed a copy) and 12 (the copies' sessions) |
| `T7` LANG | 13 |
| `T8` DOCS | 14 |

- **Size.** Each task is sized for one implementer dispatch under about 150 tool calls. A task that reaches 120 calls
  with work left commits nothing, writes `$L/task-<N>-handoff.md` (what is done, what is left, the failing runs) and
  stops; the controller splits it.
- **The design's six steps and these tasks.** The user asked for about six tasks; the design's steps are kept in
  order and each is split where one dispatch could not finish it: step 1 is Task 3; step 2 is Task 4; step 3 is Tasks
  5-7, with Task 1's moves; step 4 is Tasks 9-10; step 5 is Tasks 8, 11 and 12, with Task 2's moves; step 6 is Tasks
  13-14 and 16. The two moving tasks come first because a removal cannot move a case whose way in it has just
  taken; the two rules the design orders by (stored copies before any way in; each task deletes the tests of what
  it removes) hold.

## Global Constraints

- **The design, verbatim, as it falls to PR 1.** G1: "No copy can be made, edited, seen, stored or restored. Every
  piece under *Today* goes: ⋯ *edit a copy*; `copies ▾` with its *new TM copy* and *new rxm copy*, delete, undo, pause
  and resume; the copy editors; the *text* and *outline* panels of the λ, TM and rxm views; those views' ⋯ *format*
  and *move the editor here*; `copy · not linked`; the copy pairs, rows, sentences and notices; the warm-copy cap."
  G2: "The app removes `redextape.buffers` from `localStorage` at start-up, and `privacy.html` says that it does." G3:
  "A share link, stored workspace, remembered arrangement or stored program made before the change loads, including
  a workspace that holds state for the panels that went, and its views open on the program, as a link's views open
  today." G4: "Code that only copies reach goes in the PR that removes its last caller, with its tests: the web code
  in PR 1". G5: "The web app loads only the `redextape` grammar and opens LSP documents only in `redextape`." G6:
  "`help.html`, `privacy.html`, `README.md`, `docs/architecture.md` and the four grammar READMEs say what the site does
  now, and each PR has its roadmap entry. […] PR 1's roadmap entry records that the IR views' CLIF copies and LLVM
  copies are withdrawn (Q3)."
- **Its anti-goals.** "A visible change to the program's own views beyond removing copy UI"; "A share link, workspace
  or stored program from before the change failing to load"; "Unreachable or untested code on `main` after a PR. The
  user's split allows two kinds between PRs and no others: the copy-only Rust exports PR 1 stops calling, still
  tested in Rust until PR 2 removes them; and the multi-session generality (a registry, a pool, bindings and caches
  that hold one session) that runs until PR 3 narrows it. A function, field or branch whose every caller, reader or
  taker is a copy path is not generality: it goes in PR 1."; "A PR, or a commit inside PR 1, that leaves stored copies
  the UI restores but cannot end."
- **Its non-goals.** The grammars, the native LSP and the Rust core stay; no change to the program's views beyond
  removing what serves copies (steps, links, the other panels, splits, the Stage, the toggles, the keys, the presets,
  the source editor and its own ⋯ *format*); nothing replaces copies; history documents under `docs/` stay as written.
  `· program` stays in titles until PR 3 (Q1). The return-value-highlight lane conflicts in view code; whichever
  merges second rebases.
- **The design's calls, kept:** `SessionEntry.detached`, `SessionRegistry.remove` and `SessionPool.unbind` go in PR 1
  (Tasks 11-12); `scripts/emit-probe-reduced-files.sh` goes in PR 1 (Task 4); the `privacy.html` row for
  `redextape.buffers` stays, reworded (Task 3); the removal runs at every start-up, silent on failure (Task 3);
  `COLOUR_CEILING_UNITS` keeps 6,100,000 with a reason that holds for the source editor (Task 13); the λ, TM and rxm
  grammars and the three non-source LSP languages leave the web app (Task 13).
- **What the design left to the builder, settled here** (the roadmap entry says each):
  1. **Task boundaries** as *Execution notes* says.
  2. **What is total over `CopyLeg` stays until Task 12.** `CopyLeg` and `COPY_LEGS` also type the program's recording
     (`record-loop.ts:191-203`, `session-worker.ts:501`), so a leg task does not narrow them: the worker's `BUILD`,
     `ScratchOf`, `HandleOf`, `copy-build.ts`'s `Occupant`, `transport.ts`'s `NO_TEXT`, `pane-host.ts`'s
     `EDITOR_ON_LEAVE`, `buffer-list.ts`'s `BLANK_COPY`, `readout.ts`'s `COPY_FACTS`, the `scratch` request's `leg` and
     the replies' per-leg scratch arms keep every leg until the task that deletes their table. A leg task takes that
     leg's way in, its view's copy parts, and what only that leg's way in reads (the program text a fork reads, the
     fork cap, the value run).
  3. **The start-up removal** is `forgetCopies(store?: Storage): void` in `web/src/program-store.ts` (the module that
     owns the program's key, whose comments cite `buffers-store.ts` and are re-said anyway), called once at every
     start-up beside `readProgramStorage` (`main.ts:693-705`). It reads `localStorage` inside its `try`, as
     `editor-prefs.ts:31-43` explains, and its failure is silent, as a failed read of the program is.
  4. **The notice line's default fallback is `#settings`** (`index.html:51`), a header control shown at every width.
     The default is still needed: the resting sentence's `hide` (`notice.ts:177-184`) has no fallback of its own. The
     actions that name their own (a palette's removal, an example's pick, a link's open) keep them.
  5. **`MachineViewChrome` stays, shrunk** to the header, step strip, menu, choices, `mount`, `setStepsShown`,
     `setBindings` and `setLayoutControls`, with `super(on)`: `ClifPane` extends it too (`clif-pane.ts:59`, `:97`), so a
     fold would copy it three times.
  6. **↺ and the custody's flush.** ↺ calls `flushEdit` for the program's session (`transport.ts:359` → `main.ts:1021`),
     and `editor-custody.ts:501-505` calls `flushEditor` on every view of that session through an unchecked cast. Task 7,
     which takes `flushEditor` off the machine chrome, narrows the flush in the same commit to views that hold an
     editor; Task 10 removes it with custody.
  7. **`isGuard` tests the name alone** (`state-groups.ts:54-61`), with the reason that holds: the core reserves
     `overflow` for its guard (`Builder::overflow`, `crates/redextape-core/src/tm/build.rs:82-85`, `:203`) and no
     lowering names a state so.
  8. **`readout.ts`'s `data-describes` keeps its two values, the non-program one renamed `none`** (`readout.ts:372`): it is
     written `copy` whenever `show` gets no program, which the program's own first frames do, and the dim on a running
     compile (`style.css:644-649`) must keep not applying there; nothing visible changes.
  9. **A test that put hand-written content in a view through a copy** is moved onto a compiled program where one has
     the shape; otherwise onto a component fixture (`new TmPane(host, inertEvents())`, `setProgram`, `render`, as
     `tm-follow-clamp.test.ts:71-73`), whose every state carries an `instr` and whose program a `listing`, so it sits
     in the one tier that survives Task 6. No product code exists for a test.
  10. **`focus-draw.ts`.** Its stated reason (`focus-draw.ts:1-8`: a focus move redraws the readout or the inspector at
      another height) may hold only through a copy's view (`draw.ts:387-403` gives every program view one readout).
      Task 2 measures it on the program. If a program focus move changes the layout, `focus-press.test.ts` moves onto
      it there and the module stays. If none does, Task 5 deletes `focus-press.test.ts` (its way in is a TM copy) and
      Task 9 removes `focus-draw.ts`, its wiring (`main.ts:60`, `:1174-1182`, `:1557`; `pane-host.ts:311`, `:379`, `:704-727`) going
      with it, a focus move drawing at once: no focus move is left whose frame moves a control. Task 2's report says which.
  11. **Kept, not deleted, of the design's 70 whole files**: `tests/node/copy-build.test.ts` (its `claimLive` and
      `liveHandle` cases hold code that stays), `one-id-two-kinds.test.ts`, `one-id-two-kinds-stored.test.ts` and
      `parked-view-replaced.test.ts` (their subject is layout; the copy only marked a view). **Deleted beyond the
      70**: `pane-chrome-text-panel.test.ts` (Task 10), `editor-view-fixture.ts` (Task 10), `copy-header.test.ts` (Task 4,
      after Task 2 moves its one lasting case).
  12. **Cases that made a copy only to reach a second session** (`menu-focus.test.ts:128-152`,
      `pane-picker.test.ts:187-222`, `pane-kind-switch.test.ts:283-362`) go with the λ way in (Task 9), and so does
      what only they took: `rebind`'s same-leg branch for a session other than the view's (`pane-host.ts:1008-1050`, its
      `choice.session !== leaving` path), cut to its one-session answer, since the design's anti-goal puts a branch
      whose every taker is a copy path in PR 1. `split`'s `choice.session` and the other reads of a binding's session
      are the multi-session generality PR 3 narrows; the roadmap entry lists them.
  13. **The colour registry's key is generic**: `createGrammarRegistry<K extends string = LanguageId>(opts)`, whose
      `sources`, when given, replaces `SOURCES` (`Record<K, GrammarSource>`) rather than overlaying it, so the tests that
      load the four grammars (`grammar-differential`, `colour-slices`, node `colour`) name their own ids and the app's
      `LanguageId` is `'redextape'` (Task 13).
  14. **`wasm-vocabulary.test.ts`** goes in Task 12 (the words it checks are shown only through the copies' replies);
      **`session-memory.test.ts`**'s scratch-session case (`:488-574`'s scratch arms) is cut there too.
  15. **Rust comments that cite web files PR 1 deletes** stay for PR 2 (the design's PR 2 list); Task 16's entry names
      each (the sweep's last two rows). **Except three the attribution gate fails**, possessive citations of a file or
      symbol a task removes, which that task re-says, comment only: `crates/redextape-wasm/src/session.rs:1331`
      (`rxm-copy-corpus.ts`'s `CASES`, Task 4), `:915` and `:947` (`protocol.ts`'s `forkable`, Task 5). So the branch
      changes Rust, and Task 15 runs the Rust legs.
  16. **CSS goes with the markup it styles**, in the task that removes the markup; Task 14 sweeps what is left.
  17. **`state-diagram-local-layout.test.ts`'s TWO case (`:325`) is deleted, not moved**: no compiled machine has two
      two-tape rules from one state to one other, and `tests/node/local-layout.test.ts:555` holds the rule.
  18. **`lsp-hover.test.ts`'s TM-rule case (`:267-303`) is deleted**: only a copy's editor opens a `redextape_tm`
      document; the native LSP and the Rust tests keep TM hover.
- **R-G1. Every commit passes typecheck, the attribution check and the tests.** A task that deletes or narrows an
  export, a file or a way in also fixes, in the same commit, every importer, caller, citation and test case that uses
  it, in any file, a file a later task deletes included; there the edit is the least that holds: drop the case, the
  citation or the clause. Each task's *R-G1 sites* name what the pre-flight scan found outside its other lists (at
  `b627fe3`); `TSC`, `ATTR` and the runs find the rest, which the task puts right the same way and its report names.
- **R-G2. A commit that deletes comments lowers any budget the comment guard reports stale.** The guard fails an area
  whose share falls more than 50 units below its budget while the branch removed comment lines
  (`scripts/check-comments.mjs:522-527`); the task writes the value the report prints into
  `scripts/comment-budget.json` in that commit, and its report says so.
- **Commands** (notation used below). Each run writes `>| $L/<task>-<what>.log 2>&1` and is followed by `print $?`;
  tallies are read with `grep -aE 'Test Files|Tests |FAIL|×'`. zsh has `noclobber`, hence `>|`. Never pipe a run
  through `tail`: it hides the exit status. All from `$W/web` unless said.
  - `BROWSER files…`: `flock /home/davey/temp/redextape-browser.lock zsh -c 'until ! ss -ltn | grep -q ":63315 ";
    do sleep 5; done; VITEST_MAX_WORKERS=4 pnpm exec vitest run --project browser --project browser-scrollbars "$@"'
    _ <paths>`. Paths are positional (`tests/browser/x.test.ts`); `pnpm test:browser -- name` does not scope, and
    `--maxWorkers` does not reach the browser projects. `browser-scrollbars` is in the list for the two
    `SCROLLBAR_FILES` (`vite.config.ts:114-117`).
  - `FIREFOX files…`: the same with `REDEXTAPE_FIREFOX=1` and `--project firefox --project firefox-capture`.
  - `NODE files…`: `pnpm exec vitest run --project node <paths>` (no paths: the whole node tier); no lock.
  - `TSC`: `CARGO_TARGET_DIR=$T pnpm run typecheck`. `LINT`: `pnpm exec biome ci --error-on-warnings`. `COMMENTS`:
    `node scripts/check-comments.mjs --base b627fe3` from `$W`. `ATTR`: `scripts/check-attributions.sh` from `$W`.
  - `COVERAGE`: `pnpm run test:coverage` under the browser lock, the port wait inside it, in a transient unit with a
    memory cap, as `/home/davey/temp/redextape-panels-row-record/impl2/08g-gate-run.zsh` runs it
    (`systemd-run --user --wait -p MemoryMax=16G -p MemorySwapMax=0`, `--setenv` for `PATH`, `HOME`, `CARGO_HOME`,
    `RUSTUP_HOME`, `CARGO_TARGET_DIR` and `VITEST_MAX_WORKERS=4`). About five minutes. Expected: exit 0, and the
    `All files` row at or over the floors (`vite.config.ts:524`: statements 95, branches 89, functions 97, lines 97).
  - `SWEEP-N`: the `rg` of each row of *The deleted-symbol sweep* whose task is `N`, and of its *by module* and *by
    file* rows narrowed to the files task `N` deletes, over `web/ scripts/ crates/ README.md docs/architecture.md
    grammars/` (`--glob '!*.wasm' --glob '!*.json'`), into `$L/<N>-sweep.log`. Task `N` clears the mentions of the
    files it deletes, prose included (a mention in a file a later task deletes is that task's).
- **Coverage after every task.** Task 1's Step 0 runs `COVERAGE` at `b627fe3` into `$L/00-coverage.log`; every task
  runs it once after its last code edit. The report quotes the `All files` row beside the previous task's. A file of
  `web/src` the task touched whose lines fall below 90 % is named in the report with the reason: what is left of it
  is a later task's, by this plan, or the task removes it now.
- **Chromium is the gate; Firefox is compared against one baseline.** Task 1's Step 0 runs `FIREFOX` at `b627fe3` on
  every surviving browser file any task edits, the 80 of `$R/pr1/ff-files.txt` (each `web/tests/browser/<name>.test.ts`:
  `app-header`, `app`, `base16-remove`, `clif-app`, `clif-switch`, `colour-slices`, `colour`, `controls-gate`, `copy-header`, `custom-palette-load`, `cut-text`, `divider-drag-format-on-blur`, `divider-drag`, `edge-spacing`, `examples-menu`, `field-width`, `first-load-views`, `focus-press`, `grammar-differential`, `header-selects`, `hidden`, `keystrokes-in-flight`, `lambda-display`, `link-clear`, `link-hold`, `lsp-diagnostics`, `lsp-editor-names`, `lsp-hover`, `lsp-outline`, `lsp-restored-panel`, `machine-row-scrollbars`, `machine-row`, `machine-view-chrome`, `menu-focus`, `notice`, `one-id-two-kinds-stored`, `one-id-two-kinds`, `pane-kind-switch`, `pane-picker`, `panel-maximise`, `panel-regions`, `parked-view-replaced`, `parked-view-surfaces`, `pool-isolation`, `program-blocked`, `program-quota`, `recompile-swap`, `restart-rewind`, `rxm-pane`, `session-memory`, `share-open-hashchange`, `share-open`, `share-popover`, `stage-tab-titles`, `state-diagram-local-fan-row`, `state-diagram-local-fans`, `state-diagram-local-layout`, `state-diagram-local-pan`, `state-diagram-local-scrollbars`, `state-diagram-local`, `state-diagram-no-machine`, `step-controls`, `storage-blocked`, `stored-panels-restore`, `strip`, `tm-follow-clamp`, `tm-grid`, `tm-status-line`, `tm-view-narrow`, `view-header`, `view-keys-focus`, `view-keys-format-on-blur`, `view-keys-popovers`, `view-keys`, `view-menu`, `view-title`, `view-toggles-first-paint`, `vim-keymap`, `worker`, `workspace-switches`), into `$L/00-firefox.log`, and lists
  its failures in `$L/00-firefox-fails.txt`. Each task runs `FIREFOX` on the browser files it edited or created:
  the baseline's failures in those files and no other. A Firefox failure the task did not cause is reported, not
  fixed; one it caused is fixed. A new file has no baseline: it passes in Firefox, or the report says why not.
- **Test first.** A task writes its new cases, runs them to see them fail for the reason it names, then builds. **A
  moved case cannot fail first**: it holds behaviour that is there. It runs green at the task's start on its old
  setup and green after on its new one, and its sabotage, run on the new setup, shows the setup still reaches what
  the case holds. Where a table says *from its doc*, the implementer picks the one `web/src` edit that takes away what
  the case's doc says it holds, and the driver and the report name the edit and the assertion it fired at. **A
  deleted case is read first**: a case whose subject outlives copies is moved (the tables name every one the
  surveys found), not dropped; one the tables missed is moved too, and the report says so.
- **Sabotage.** Save a copy (`cp <file> $L/sab/<id>.orig`), make the one edit named, run the named files into
  `$L/<task>-sab-<id>.log`, copy the file back, `cmp` it. **Never `git checkout`**. One driver script a task, kept in
  `$L` (`/home/davey/temp/redextape-panels-row-record/impl2/08-sab-driver.mjs` is the model), one run a sabotage, in
  Chromium unless its line names Firefox. Each names the cases that must fail and where; **a sabotage that does not
  fire, or fires at another assertion, is a finding: stop and report**. A case stops at its first failed hard
  assertion, so the log is read for the assertion it failed at.
- **Commits.** One per task: `cd $W && export CARGO_TARGET_DIR=$T && git add -A web scripts <the task's other paths>
  && git commit -F $L/<task>-commit-msg.txt`, after `git status --short` shows nothing outside the task's files. The
  hook runs the tree-wide scans (the comment guard, the attribution check and the licences check among them),
  `cargo fmt`, `clippy`, and `biome ci` and `pnpm run typecheck` when `web/` files are staged. Never `--no-verify`,
  never `--amend`. The message is one long plain sentence saying what the commit holds, as `git log --oneline -5`
  shows. If the comment guard reports a budget over, cut the comment to its why first; only if it is still over, write
  the value it prints into `scripts/comment-budget.json` in that commit and say so. A budget reported stale is R-G2's.
- **The attribution gate catches part of the sweep**: a possessive citation (`file`'s `symbol`) of a file the index no
  longer tracks fails `ATTR` with "which is not a tracked file" (*Verified facts*); a file or symbol named without the
  possessive passes it. So `SWEEP-N` runs in every task, and `ATTR` after `git add`.
- **Copy and code.** "redextape" is lowercase in prose; spelling is British; no attribution to a person or a tool
  anywhere in the tree. Doc comments are `/** */`. **A comment says why**: the reason, the invariant, what breaks if
  it changes. No history (that copies existed, what the code did before, a decision's date or who made it), no
  measurement, no `file:line`; a comment may point at the design. **A comment whose reason was copies is re-said with a
  reason that holds, or goes**; the tables name those the surveys found (*re-say*). Wrapped at 120 columns. No test's
  name or message says whose decision a behaviour was. **Each task puts right the copy words in every file it
  edits**; Task 14 sweeps what is left.
- **Browser tests.** A claim about what a person sees asserts geometry or computed style; an attribute
  (`aria-pressed`, `aria-disabled`, `data-open`, `:popover-open`) may be asserted; never `textContent` alone. A new case
  presses with `userEvent` (`.click`, `.keyboard`, `.hover`). A probe prints with `console.error` and is gone before
  the commit. `main()` runs once per test file (module cache), so a case that needs storage seeded differently at
  mount is a file of its own.
- **Deletes.** A whole-file delete is a shell call of its own: `git -C /home/davey/temp/redextape-remove-copies rm`
  followed by every path written out, no variable, no loop, no `cd` in the call.

## Review Focus

Inputs the design implies and no case of today exercises, most likely first. Each has its case in the task named.

1. **A reload with `redextape.buffers` present**: copies and bindings (version 2), a binding on a leaf parked in a
   remembered arrangement or on a Stage tab, a malformed value, or a storage that throws. Expected: the page loads on
   the program, every view's title reads `· program`, the key is gone, other keys are untouched, the storage line says
   nothing about copies. Task 3, K1-K3.
2. **A stored workspace or a share link holding the panels that went**: `outline` under the TM and rxm leaves'
   `panels`, `text` and `outline` shares under their `panelSizes`, `text` under the λ leaf's. Expected: it loads, every
   panel that stays opens and sizes as stored, no text or outline panel shows. Task 2, O1-O2, run again by every task
   after.
3. **The notice line's default focus target, which was `#buffers`**: a resting storage sentence put away with *hide*
   from the keyboard. Expected: the focus lands on `#settings`, drawn, at 390 and at 1280 px. Task 8, N1.
4. **The menus that listed copies**: the ⋯ menu of a λ, TM and rxm view (no *edit a copy*, no *move the editor
   here*, no *format*, no hint line, no empty group), and the source view's, which keeps *format*. Expected: each menu
   holds what its view still does. Tasks 4, 5 and 9, M1; Task 10, M2; the help page's keys table, Task 14.
5. **↺ on the program's TM, rxm or clif view once the machine views hold no editor** (the custody's flush, ruling 6).
   Expected: the view restarts at step 0 and the page throws nothing. Task 7, R1.

## Verified facts (at `b627fe3`)

- **The design's facts that do not hold at `b627fe3`** (the surveys found them; each is used as corrected):
  - `stored-panels-restore.test.ts:151` does not exist (the file has 82 lines); the `['rules', 'text']` assertion is
    `panel-regions.test.ts:151`. `stored-panels-restore.test.ts:76-81` is the case that expects `LEG_PANELS` plus
    `text`.
  - `tests/browser/cut-text.test.ts`'s copies-list block is `:439-482`, not `:440-476`.
  - `session-worker.ts`'s reads are `:663-669`; `protocol.ts`'s fork cap is `:461-495`; the restore spans `main.ts:1571-1644`,
    `:3036-3042`, `:3044-3095`, `:3097-3118`, `:3126-3181` and `:3189`; `grammars/README.md`'s lines are `:19-21`;
    `vite.config.ts`'s probe comment is `:38-48` and `:62-65`; `view-header.ts:569` is *move the editor here* and `:578`
    *format*.
  - The notice's default cannot simply go (the design's "if none is left the default goes"): `hide` uses it.
  - Missing from the design and in PR 1: `pane-chrome-text-panel.test.ts`; `LspClient.closeDocument` (its one caller is
    `scratch-editor.ts:453`); `viewMenu`'s hint line and `.view-menu-hint` (only *edit a copy* passes a hint); the icons
    `edit` and `move-editor-here` (`icons.ts:16`, `:19`); `link-wiring.ts`'s `viewTitle` and `arranged` deps (read only at
    `:134`, `:137`); `draw.ts`'s `hasEditor` and `nameOf` deps; `SessionEntry.readings`; `types.ts`'s `ReductionStatus`,
    `TmScratchStatus` and `ValueRun` re-exports; `session-memory.test.ts:2`, `:496-524` (calls `lambdaScratch` and
    `tmScratch`); `colour-slices.test.ts:89-91`, `:106` (loads `redextape_tm`); `lsp-protocol.test.ts:42-53`,
    `lsp-client.test.ts:148`, `:235` and `tests/node/colour.test.ts:371-863`, `:917-958` (the TM grammar's id);
    `README.md:29-31` ("the same server and grammars"); `record-cost.test.ts:47` imports `rxm-copy-corpus.ts`, and
    `share-open.test.ts:9` and `share-open-hashchange.test.ts:9` import `copy-text-fixture.ts`; `focus-draw.ts` (ruling 10).
  - The hand-written-machine list is longer than the design's: `state-diagram-local-pan` (`:18-21`, `:930`),
    `-scrollbars` (`:13-50`), `-layout` (`:296-299`, `:323`), `-fans` (`:48-53`), `-fan-row` (`:45-50`), `tm-status-line`
    (`:48-50`) and `lsp-restored-panel` (`:47-62`, stored) put content in through a copy; `tm-grid` (`:157-162`) and
    `hidden` (`:36-40`) paste nothing, they fork to reach the copy-only panels.
  - The fixtures the design names as models (`panel-regions.test.ts:72`, `tests/node/tm-machines.ts:87`) carry
    `instr: null` on every state, the `none` tier Task 6 removes; so do `tm-follow-clamp.test.ts:40` and
    `rxm-pane.test.ts:65`.
  - `SessionRegistry.remove` is also called by `view-title.test.ts:262` and `editor-custody.test.ts`; `SessionPool.unbind`
    by `session-pool.test.ts:108-190`, `scratch-fork.test.ts`, `pool-isolation.test.ts:159`, `:182`, `:197` and
    `session-memory.test.ts:164`. Their product callers are `scratch.ts:545-546` alone, as the design says.
- **`check-attributions.sh` fails a possessive citation of an untracked file.** Sabotage, 2026-11-23: appending
  ``// `buffers-store-gone.ts`'s `parseBuffers` reads it.`` to `web/src/rxm-seed.ts` made it exit 1 with
  ``web/src/rxm-seed.ts:17: cites `buffers-store-gone.ts`, which is not a tracked file``; restored and `cmp`-equal. Its
  file list is `git ls-files` (`check-attributions.sh:869`), so a staged deletion counts.
- **Coverage before the change**: the last full run (`remove-plus-view`'s rebase, 2026-11-23, 350 files, 290 s) read
  statements 97.93, branches 92.25, functions 98.7, lines 99.15; Task 1's Step 0 measures `b627fe3` itself.
  `session-worker.ts` and `lsp-worker.ts` are excluded (`coverage.exclude` in `vite.config.ts`): the worker's copy code moves no figure.
- **The build emits the three grammars today**: `/home/davey/projects/redextape/web/dist/assets/` holds
  `tree-sitter-redextape-lambda-*.wasm`, `-rxm-*` and `-tm-*` beside `tree-sitter-redextape-*`; `colour.ts:11`, `:13`, `:15`
  import them with `?url`.
- **`CopyLeg` types the program's recording** (`record-loop.ts:191-203`, `session-worker.ts:501`, `:672`), so it stays
  past PR 1 as the recorded legs' type, its copy doc re-said (Task 12).
- **The custody's flush reaches every view of the program's session** (`editor-custody.ts:501-505`, through an
  `unknown` cast tsc does not check), TM, rxm and clif included (ruling 6).
- **`readout.ts:372`** writes `data-describes="copy"` for `program === null`, which the program's first frames pass
  (ruling 8).
- **No compiled TM machine reaches the `name` or `none` tier** (the design's *Checks*), and no compiled machine names a
  state `overflow` but the guard (`build.rs:85`, `:203`, pinned by `build.rs:310`; ruling 7).

## The deleted-symbol sweep (at `b627fe3`)

Every reference to a symbol, class, id, storage key, data attribute, string or test helper PR 1 deletes, and the task
that clears it. Paths are under `web/` unless they start with `scripts/` or `crates/`; `b/` is `web/tests/browser/`,
`n/` `web/tests/node/`. A test helper goes in the task that removes its last caller, the row's task at the latest. A
file the row lists that survives keeps no hit after the row's task, except a name the plan keeps: `redextape.buffers` in
`program-store.ts`, `privacy.html` and their tests; `CopyLeg` and `COPY_LEGS`; `pairLabel`; `TmScratchStatus` in
`bindings-contract.test.ts` (Task 12 points it at the generated binding PR 2 deletes); the Rust exports and comments (PR
2, but ruling 15's three); `docs/superpowers/` (history). The rows' `rg` patterns are in `$R/pr1/sweep-patterns.txt`.

| Symbols (what the row's `rg` matches) | Files that name them at `b627fe3` (`†`: deleted whole by PR 1) | Task |
|---|---|---|
| `BUFFERS_STORAGE_KEY`, `BUFFERS_VERSION`, `PersistedBuffer(s)`, `serializeBuffers`, `parseBuffers` | src/buffers-store.ts†, src/custom-palette.ts, src/layout.ts, src/main.ts, src/program-store.ts, src/scratch.ts†, src/transport.ts, b/buffer-restore-invalid.test.ts†, b/buffer-restore.test.ts†, b/buffers-quota-empty.test.ts†, b/buffers-quota-restored.test.ts†, b/buffers-quota.test.ts†, b/copies-undo.test.ts†, b/copy-text-fixture.ts†, b/lsp-restored-panel.test.ts, b/parked-copy-restore.test.ts†, b/program-quota.test.ts, b/rxm-copy-restore.test.ts†, b/share-open-cap.test.ts†, b/share-open.test.ts, b/tm-buffer-restore.test.ts†, n/buffers-store.test.ts† | 3 |
| `persistBuffers`, `persistBindings`, `onBuffersPersist`, `seedBinding` | src/editor-custody.ts†, src/main.ts, src/pane-host.ts, src/replies.ts, src/scratch.ts†, src/transport.ts, b/buffer-restore-invalid.test.ts†, b/buffer-restore.test.ts†, b/buffers-quota-restored.test.ts†, b/buffers-quota.test.ts†, b/record-cost.test.ts, b/scratch-fork.test.ts†, b/tm-buffer-restore.test.ts†, b/tm-pane-follows-session.test.ts†, n/replies.test.ts, n/sessions.test.ts | 3 |
| `buffers-store` (module), `copy-text-fixture` (helper) | src/custom-palette.ts, src/layout.ts, src/main.ts, src/program-store.ts, src/scratch.ts†, b/bindings-stored.test.ts†, b/buffer-restore-invalid.test.ts†, b/buffer-restore.test.ts†, b/buffers-quota-empty.test.ts†, b/buffers-quota-restored.test.ts†, b/buffers-quota.test.ts†, b/copies-undo.test.ts†, b/copy-edit-leaving.test.ts†, b/copy-editor-mount.test.ts†, b/copy-text-fixture.ts†, b/lambda-copy-typed-text.test.ts†, b/lsp-restored-panel.test.ts, b/parked-copy-restore.test.ts†, b/program-quota.test.ts, b/rxm-copy-restore.test.ts†, b/share-open-cap.test.ts†, b/share-open-hashchange.test.ts, b/share-open.test.ts, b/tm-buffer-restore.test.ts†, n/buffers-store.test.ts† | 3 |
| `setScratch` (rxm), `rxm-value`, `retypeRxm`, `probeRxmCopyRun`, `test:probe:rxm-copy`, `rxm-copy-corpus`, `build-reply-fixture` | crates/redextape-wasm/Cargo.toml, crates/redextape-wasm/src/session.rs, package.json, src/protocol.ts, src/replies.ts, src/rxm-pane.ts, src/rxm-seed.ts, src/session-worker.ts, src/sessions.ts, src/style.css, b/copy-editor-mount.test.ts†, b/copy-pin.test.ts†, b/edge-spacing.test.ts, b/editor-view-fixture.ts†, b/harness.ts, b/lambda-copy-typed-text.test.ts†, b/machine-row-scrollbars.test.ts, b/provided-context.d.ts, b/record-cost.test.ts, b/rxm-blank-copy.test.ts†, b/rxm-copy-cost.test.ts†, b/rxm-copy-memory-worker.ts†, b/rxm-copy-memory.test.ts†, b/rxm-copy-restore.test.ts†, b/rxm-copy.test.ts†, b/tm-buffer-restore.test.ts†, b/worker.test.ts, n/replies.test.ts, vite.config.ts | 4 |
| probes: `probeTmBufferRun`, `test:probe(:tm|:tm-buffer)`, `emit-probe-reduced-files`, `affordability-(tm-|rxm-)?worker` | crates/redextape-wasm/Cargo.toml, crates/redextape-wasm/src/session.rs, package.json, scripts/emit-probe-reduced-files.sh, src/protocol.ts, b/buffer-affordability.test.ts†, b/provided-context.d.ts, b/tm-buffer-cost.test.ts†, b/tm-fork-cost.test.ts†, vite.config.ts | 4 |
| test helpers `termEditorsIn`, `copiesMenu`, `inCopiesMenu`, `shutCopiesMenu`, `deleteEveryCopy`, `deleteEveryCopyInline`, `copyNames` | b/bindings-stored.test.ts†, b/harness.ts, b/one-id-two-kinds-stored.test.ts, b/one-id-two-kinds.test.ts, b/parked-copy-editor.test.ts†, b/parked-copy-undo.test.ts†, b/parked-view-replaced.test.ts, b/record-cost.test.ts, b/stage-copy-editor.test.ts† | 4 |
| `MAX_FORK_RULES`, `ruleCount`, `forkable`, `tmResultDecodable`, `VALUE_CHUNK`, `ValueRun` (its `types.ts` re-export: Task 12) | crates/redextape-wasm/src/lib.rs, crates/redextape-wasm/src/session.rs, crates/redextape-wire/src/lib.rs, crates/redextape-wire/tests/ts_bindings.rs, src/buffer-list.ts†, src/copy-editor.ts†, src/pane-host.ts, src/protocol.ts, src/replies.ts, src/session-worker.ts, src/tm-pane.ts, src/tm-seed.ts, src/types.ts, b/affordability-tm-worker.ts†, b/buffer-affordability.test.ts†, b/controls-gate.test.ts, b/copy-editor.test.ts†, b/hidden-views.test.ts, b/scratch-cap.test.ts†, b/tm-blank-buffer.test.ts†, b/tm-buffer-cost.test.ts†, b/tm-fork-cost.test.ts†, b/tm-reduced-buffer.test.ts†, b/tm-scratch-fork.test.ts†, b/two-lambda-panes.test.ts†, n/protocol.test.ts, n/replies.test.ts, n/sessions.test.ts | 5 |
| `setScratchStatus`, `setScratchValue`, `tm-value`, `has-value-run`, `programFork`, `detachProgram`, `setForkAvailable`, `readingOf` | src/clif-pane.ts, src/copy-editor.ts†, src/editor-custody.ts†, src/machine-view-chrome.ts, src/main.ts, src/pane-chrome.ts, src/pane-host.ts, src/protocol.ts, src/replies.ts, src/rxm-seed.ts, src/session-worker.ts, src/sessions.ts, src/style.css, src/tm-pane.ts, src/tm-seed.ts, src/transport.ts, src/types.ts, b/affordability-tm-worker.ts†, b/buffer-affordability.test.ts†, b/copy-edit-leaving.test.ts†, b/copy-editor-mount.test.ts†, b/copy-editor.test.ts†, b/edge-spacing.test.ts, b/machine-view-chrome.test.ts, b/rxm-pane.test.ts, b/tm-copy-value-readout.test.ts†, b/tm-pane-editor.test.ts†, b/tm-pane-follows-session.test.ts†, b/tm-reduced-buffer.test.ts†, b/tm-scratch-fork.test.ts†, n/replies.test.ts, n/sessions.test.ts | 5 |
| test helpers `tmPaneHost`, `editedToHaltImmediately`, `startStateGoesToHalt`, `buffersButton`, `buffersMenu`, `bufferRows`, `copyShown`, `pickInViewMenu` | src/main.ts, b/copy-beside-program.test.ts†, b/copy-pin.test.ts†, b/harness.ts, b/record-cost.test.ts, b/scratch-buffers.test.ts†, b/tm-blank-buffer.test.ts†, b/tm-buffer-restore.test.ts†, b/tm-copy-value-readout.test.ts†, b/tm-scratch-fork.test.ts†, b/tm-status-line.test.ts | 5 |
| `tierOf`'s `name`/`none`, `reorderByReach`, `StateDiagram.tier`, `COPY` (tm-machines), "this machine has no program level" | src/state-diagram.ts, src/state-groups.ts, src/tm-pane.ts, n/program-level.test.ts, n/state-groups.test.ts | 6 |
| `CopyEditor`, `CopyEditorOptions`, `copy-editor` (module), `textRegion`, `outlineRegion`, `editorUnmounted`, `mountOnViewOf`, `outlineOpen` | src/clif-pane.ts, src/copy-editor.ts†, src/draw.ts, src/editor-custody.ts†, src/machine-view-chrome.ts, src/pane-chrome.ts, src/pane-host.ts, src/protocol.ts, src/rxm-pane.ts, src/scratch-editor.ts†, src/tm-pane.ts, src/transport.ts, src/view-header.ts, b/copy-edit-leaving.test.ts†, b/copy-editor.test.ts†, b/lsp-restored-panel.test.ts, b/parked-copy-editor-mount.test.ts†, b/parked-copy-editor.test.ts†, b/parked-copy-undo.test.ts†, b/rxm-copy.test.ts†, b/stage-copy-editor.test.ts†, b/tm-pane-follows-session.test.ts†, b/tm-scratch-fork.test.ts†, n/sessions.test.ts | 7 |
| `bufferList`, `BufferRow`, `buffer-list` (module, id, class), `buffer-row*`, `buffer-new`, `buffer-delete`, `buffer-temperature`, `#buffers` | index.html, scripts/check-attributions.sh, src/buffer-list.ts†, src/cut-text.ts, src/main.ts, src/replies.ts, src/scratch.ts†, src/style.css, src/transport.ts, b/buffer-cool-warm.test.ts†, b/buffer-list.test.ts†, b/buffer-restore-invalid.test.ts†, b/buffer-restore.test.ts†, b/controls-gate.test.ts, b/copies-undo.test.ts†, b/copy-beside-program.test.ts†, b/copy-edit-leaving.test.ts†, b/copy-editor-mount.test.ts†, b/copy-header.test.ts, b/cut-text.test.ts, b/edge-spacing.test.ts, b/examples-menu.test.ts, b/first-load-views.test.ts, b/harness.ts, b/header-selects.test.ts, b/menu-focus.test.ts, b/parked-copy-restore.test.ts†, b/parked-copy-undo.test.ts†, b/reset-preset-copies.test.ts†, b/rxm-blank-copy.test.ts†, b/rxm-copy.test.ts†, b/scratch-buffers.test.ts†, b/scratch-cap.test.ts†, b/share-open-cap.test.ts†, b/share-open-hashchange.test.ts, b/share-open.test.ts, b/stage-tab-titles.test.ts, b/tm-blank-buffer-cap.test.ts†, b/tm-blank-buffer.test.ts†, b/tm-buffer-restore.test.ts†, b/tm-pane-follows-session.test.ts†, b/tm-reduced-buffer.test.ts†, b/tm-status-line.test.ts, b/two-lambda-panes.test.ts†, b/view-keys-popovers.test.ts, b/view-toggles-first-paint.test.ts, n/cut-text.test.ts, n/harness.test.ts, n/replies.test.ts, n/scratch.test.ts† | 8 |
| `reseedingSlots`, `onBuffersChanged`, `refreshBuffers`, test helpers `rowNames`, `asShown` | src/buffer-list.ts†, src/copy-editor.ts†, src/editor-custody.ts†, src/lambda-pane.ts, src/main.ts, src/pane-host.ts, src/replies.ts, src/scratch.ts†, src/tm-pane.ts, src/transport.ts, b/buffer-cool-warm.test.ts†, b/buffer-restore-invalid.test.ts†, b/buffer-restore.test.ts†, b/buffers-quota-empty.test.ts†, b/buffers-quota-restored.test.ts†, b/buffers-quota.test.ts†, b/harness.ts, b/lambda-text.ts, b/parked-copy-editor.test.ts†, b/parked-copy-restore.test.ts†, b/stage-copy-editor.test.ts†, n/sessions.test.ts | 8 |
| `forkCopy`, `editCopy`, `CopyState`, `setCopy`, `view-menu-hint`, icon `edit`, "edit a copy", "the term at this step" | crates/redextape-core/src/tm/rxm.rs, crates/redextape-core/tests/rxm_roundtrip.rs, crates/redextape-wasm/src/session.rs, help.html, src/app-header.ts, src/base16-dialog.ts, src/buffer-list.ts†, src/clif-pane.ts, src/copy-editor.ts†, src/icons.ts, src/lambda-pane.ts, src/link-status.ts, src/machine-view-chrome.ts, src/pane-host.ts, src/protocol.ts, src/scratch.ts†, src/style.css, src/transport.ts, src/view-header.ts, b/active-pane.test.ts†, b/buffer-cool-warm.test.ts†, b/buffers-quota.test.ts†, b/clif-app.test.ts, b/colour.test.ts, b/controls-gate.test.ts, b/copy-edit-leaving.test.ts†, b/copy-editor.test.ts†, b/editor-view-fixture.ts†, b/lambda-display.test.ts, b/machine-view-chrome.test.ts, b/one-id-two-kinds.test.ts, b/parked-copy-editor-mount.test.ts†, b/parked-view-replaced.test.ts, b/rxm-copy.test.ts†, b/rxm-pane.test.ts, b/stage-tab-titles.test.ts, b/storage-blocked.test.ts, b/tm-blank-buffer-cap.test.ts†, b/tm-scratch-fork.test.ts†, b/two-lambda-panes.test.ts†, b/view-keys-format-on-blur.test.ts, b/view-menu.test.ts, n/replies.test.ts, n/scratch.test.ts†, n/sessions.test.ts | 9 |
| test helpers `claim`, `editorsOf`, `editorsInLeaf`, `forkButton`, `markersIn`, `buffersControl`; `scratch-editor-fixture` | b/active-pane.test.ts†, b/bindings-stored.test.ts†, b/buffer-cool-warm.test.ts†, b/buffer-restore.test.ts†, b/buffers-quota.test.ts†, b/harness.ts, b/keystrokes-in-flight.test.ts, b/lsp-copy-diagnostics.test.ts†, b/lsp-hover.test.ts, b/one-id-two-kinds-stored.test.ts, b/one-id-two-kinds.test.ts, b/pane-kind-switch.test.ts, b/pane-picker.test.ts, b/parked-copy-editor-mount.test.ts†, b/parked-copy-editor.test.ts†, b/parked-copy-undo.test.ts†, b/parked-view-replaced.test.ts, b/parked-view-surfaces.test.ts, b/scratch-app.test.ts†, b/scratch-buffers.test.ts†, b/scratch-cap.test.ts†, b/scratch-edit.test.ts†, b/scratch-rebind-editor.test.ts†, b/scroll-kept-moved-editor.test.ts†, b/stage-copy-editor.test.ts†, b/tm-blank-buffer-cap.test.ts†, b/two-lambda-panes.test.ts† | 9 |
| `detach`: the λ view's *edit a copy* event (`PaneEvents.detach`, `transport.ts`'s and `pane-host.ts`'s handlers, `button.detach`, the citations of them); not the state diagram's or the grid's `detach()`, nor *detach following* | scripts/check-attributions.sh, src/editor-custody.ts†, src/lambda-pane.ts, src/main.ts, src/pane-chrome.ts, src/pane-host.ts, src/session-client.ts, src/transport.ts, b/active-pane.test.ts†, b/bindings-stored.test.ts†, b/buffer-cool-warm.test.ts†, b/buffers-quota.test.ts†, b/clif-app.test.ts, b/colour-slices-fork.test.ts†, b/colour.test.ts, b/controls-gate.test.ts, b/copies-undo.test.ts†, b/copy-header.test.ts, b/divider-drag-format-on-blur.test.ts, b/editor-custody.test.ts†, b/editor-view-fixture.ts†, b/field-width.test.ts, b/focus-press.test.ts, b/harness.ts, b/hidden.test.ts, b/keystrokes-in-flight.test.ts, b/lambda-copy-typed-text.test.ts†, b/lambda-pane-editor.test.ts†, b/link-clear.test.ts, b/lsp-editor-names.test.ts, b/lsp-outline.test.ts, b/machine-view-chrome.test.ts, b/menu-focus.test.ts, b/one-id-two-kinds-stored.test.ts, b/one-id-two-kinds.test.ts, b/pane-kind-switch.test.ts, b/pane-picker.test.ts, b/parked-copy-editor-mount.test.ts†, b/parked-copy-editor.test.ts†, b/parked-copy-undo.test.ts†, b/parked-view-replaced.test.ts, b/parked-view-surfaces.test.ts, b/program-blocked.test.ts, b/recompile-swap.test.ts, b/reset-preset-copies.test.ts†, b/rxm-copy-restore.test.ts†, b/rxm-pane.test.ts, b/scratch-app.test.ts†, b/scratch-buffers.test.ts†, b/scratch-edit.test.ts†, b/scratch-fork.test.ts†, b/scratch-rebind-editor.test.ts†, b/scroll-kept-moved-editor.test.ts†, b/share-open-editor.test.ts†, b/share-open-hashchange.test.ts, b/share-popover.test.ts, b/stage-copy-clause.test.ts†, b/stage-copy-editor.test.ts†, b/stage-tab-titles.test.ts, b/state-diagram-local-fan-row.test.ts, b/state-diagram-local-fans.test.ts, b/state-diagram-local-layout.test.ts, b/state-diagram-local-pan.test.ts, b/state-diagram-local-scrollbars.test.ts, b/state-diagram-local.test.ts, b/storage-blocked.test.ts, b/strip.test.ts, b/tm-buffer-restore.test.ts†, b/tm-grid.test.ts, b/tm-pane-follows-session.test.ts†, b/tm-scratch-fork.test.ts†, b/two-lambda-panes.test.ts†, b/view-keys-focus.test.ts, b/view-keys-format-on-blur.test.ts, b/view-keys.test.ts, b/view-menu.test.ts, b/vim-keymap.test.ts, n/sessions.test.ts (`scripts/check-attributions.sh`: its self-test fixture, Task 14) | 9 |
| `EditablePane`, `EditorCustody`, `createEditorCustody`, `ScratchEditor(Config)`, `EDITOR_DEBOUNCE_MS`, `editor-custody`, `scratch-editor`, `editor-debounce` | src/colour.ts, src/copy-editor.ts†, src/draw.ts, src/editor-custody.ts†, src/editor-debounce.ts†, src/editor-keymap.ts, src/lambda-pane.ts, src/layout.ts, src/machine-view-chrome.ts, src/main.ts, src/pane-chrome.ts, src/pane-host.ts, src/replies.ts, src/rxm-pane.ts, src/scratch-editor.ts†, src/scratch.ts†, src/tm-pane.ts, src/transport.ts, b/buffer-cool-warm.test.ts†, b/copies-undo.test.ts†, b/copy-edit-leaving.test.ts†, b/editor-custody.test.ts†, b/editor-view-fixture.ts†, b/lsp-copy-diagnostics.test.ts†, b/lsp-outline.test.ts, b/menu-focus.test.ts, b/reset-preset-copies.test.ts†, b/restart-rewind.test.ts, b/rxm-copy-cost.test.ts†, b/scratch-buffers.test.ts†, b/scratch-edit.test.ts†, b/scratch-editor-fixture.ts†, b/scratch-editor.test.ts†, b/scratch-fork.test.ts†, b/scratch-rebind-editor.test.ts†, b/tm-buffer-cost.test.ts†, b/tm-fork-cost.test.ts†, b/tm-pane-editor.test.ts†, b/two-lambda-panes.test.ts†, n/scratch.test.ts† | 10 |
| `textPanel`, `setEditor`, `takeEditor`, `receiveEditor`, `holdsEditor`, `flushEditor`, `setEditorAvailable`, `hasEditor`, `showEditor`, `mountScratchEditor`, `scratchSeedOf`, `editorSeed`, `EDITOR_ON_LEAVE`, `holdsOnLeave`, `editSink`, `lspDocument`, `flushEdit`, `editorLanguage`, `editorHome`, `closeDocument`, `setClaim`, `claim-editor`, `move-editor-here`, `term-editor` | scripts/check-attributions.sh, src/clif-pane.ts, src/copy-editor.ts†, src/draw.ts, src/editor-custody.ts†, src/icons.ts, src/lambda-pane.ts, src/layout-view.ts, src/linked-legs.ts, src/lsp-client.ts, src/lsp-hover.ts, src/machine-view-chrome.ts, src/main.ts, src/pane-chrome.ts, src/pane-host.ts, src/replies.ts, src/rxm-pane.ts, src/scratch-editor.ts†, src/scratch.ts†, src/style.css, src/tm-pane.ts, src/transport.ts, src/view-header.ts, b/buffer-cool-warm.test.ts†, b/buffer-restore.test.ts†, b/buffers-quota.test.ts†, b/colour-slices-fork.test.ts†, b/controls-gate.test.ts, b/copies-undo.test.ts†, b/copy-editor-mount.test.ts†, b/copy-editor.test.ts†, b/editor-custody.test.ts†, b/editor-view-fixture.ts†, b/focus-press.test.ts, b/harness.ts, b/hidden.test.ts, b/keystrokes-in-flight.test.ts, b/lambda-copy-typed-text.test.ts†, b/lambda-pane-editor.test.ts†, b/link-clear.test.ts, b/lsp-editor-names.test.ts, b/lsp-outline.test.ts, b/lsp-restored-panel.test.ts, b/machine-row.test.ts, b/menu-focus.test.ts, b/one-id-two-kinds-stored.test.ts, b/one-id-two-kinds.test.ts, b/pane-chrome-text-panel.test.ts†, b/pane-kind-switch.test.ts, b/panel-maximise.test.ts, b/panel-regions.test.ts, b/panel.test.ts, b/parked-copy-editor-mount.test.ts†, b/parked-copy-editor.test.ts†, b/parked-copy-undo.test.ts†, b/program-blocked.test.ts, b/program-quota.test.ts, b/recompile-swap.test.ts, b/record-cost.test.ts, b/reset-preset-copies.test.ts†, b/rxm-copy-restore.test.ts†, b/rxm-copy.test.ts†, b/scratch-buffers.test.ts†, b/scratch-edit.test.ts†, b/scratch-editor.test.ts†, b/scratch-fork.test.ts†, b/scratch-rebind-editor.test.ts†, b/scroll-kept-moved-editor.test.ts†, b/share-open-editor.test.ts†, b/stage-copy-editor.test.ts†, b/state-diagram-local-fan-row.test.ts, b/state-diagram-local-fans.test.ts, b/state-diagram-local-layout.test.ts, b/state-diagram-local-pan.test.ts, b/state-diagram-local-scrollbars.test.ts, b/state-diagram-local.test.ts, b/storage-blocked.test.ts, b/tm-buffer-restore.test.ts†, b/tm-copy-value-readout.test.ts†, b/tm-grid.test.ts, b/tm-pane-editor.test.ts†, b/tm-pane-follows-session.test.ts†, b/two-lambda-panes.test.ts†, b/view-keys-focus.test.ts, b/view-keys.test.ts, b/view-menu.test.ts, n/lsp-client.test.ts, n/replies.test.ts, n/scratch.test.ts†, n/sessions.test.ts | 10 |
| test helpers `editorHost`, `editorViewOf`, `editorOf`, `typeIn`, `lambdaEditorDoc`, `makeCopy`; `editor-view-fixture` | src/copy-editor.ts†, src/lambda-pane.ts, src/main.ts, b/buffer-cool-warm.test.ts†, b/buffer-restore.test.ts†, b/copy-beside-program.test.ts†, b/copy-edit-leaving.test.ts†, b/copy-editor-mount.test.ts†, b/copy-pin.test.ts†, b/edge-spacing.test.ts, b/editor-custody.test.ts†, b/editor-view-fixture.ts†, b/harness.ts, b/lambda-pane-editor.test.ts†, b/lsp-copy-diagnostics.test.ts†, b/lsp-hover.test.ts, b/lsp-outline.test.ts, b/one-id-two-kinds.test.ts, b/pane-kind-switch.test.ts, b/panel-sizes-stored.test.ts, b/restart-rewind.test.ts, b/rxm-blank-copy.test.ts†, b/rxm-copy.test.ts†, b/scratch-buffers.test.ts†, b/scratch-edit.test.ts†, b/scratch-editor-fixture.ts†, b/scratch-editor.test.ts†, b/scratch-rebind-editor.test.ts†, b/share-open-editor.test.ts†, b/tm-buffer-restore.test.ts†, b/tm-pane-editor.test.ts†, b/tm-scratch-fork.test.ts†, b/two-lambda-panes.test.ts†, b/vim-keymap.test.ts | 10 |
| `setDetached`, `view-status`, "copy · not linked", `DetachedPanes`, `detachedPanes`, `copiesLine`, `share-copies`, "not linked to the program", "copies are not included" | scripts/check-attributions.sh, src/copy-editor.ts†, src/editor-custody.ts†, src/lambda-pane.ts, src/link-status.ts, src/link-wiring.ts, src/machine-view-chrome.ts, src/main.ts, src/pane-host.ts, src/replies.ts, src/rxm-pane.ts, src/scratch.ts†, src/sessions.ts, src/share-popover.ts, src/style.css, src/tm-pane.ts, src/transport.ts, src/view-header.ts, b/active-pane.test.ts†, b/buffer-cool-warm.test.ts†, b/buffer-restore-invalid.test.ts†, b/buffer-restore.test.ts†, b/colour-slices-fork.test.ts†, b/copy-beside-program.test.ts†, b/copy-editor.test.ts†, b/copy-header.test.ts, b/editor-custody.test.ts†, b/field-width.test.ts, b/harness.ts, b/lambda-display.test.ts, b/lambda-pane-editor.test.ts†, b/link-clear.test.ts, b/machine-view-chrome.test.ts, b/pane-kind-switch.test.ts, b/pane-picker.test.ts, b/parked-view-surfaces.test.ts, b/reset-preset-copies.test.ts†, b/rxm-blank-copy.test.ts†, b/rxm-copy-restore.test.ts†, b/rxm-copy.test.ts†, b/rxm-pane.test.ts, b/scratch-app.test.ts†, b/scratch-buffers.test.ts†, b/scratch-cap.test.ts†, b/scratch-edit.test.ts†, b/scratch-fork.test.ts†, b/scratch-rebind-editor.test.ts†, b/share-popover.test.ts, b/stage-copy-clause.test.ts†, b/tm-buffer-restore.test.ts†, b/tm-pane-editor.test.ts†, b/tm-pane-follows-session.test.ts†, b/tm-scratch-fork.test.ts†, b/two-lambda-panes.test.ts†, b/view-header.test.ts, b/view-status.test.ts†, b/view-title.test.ts, n/link-status.test.ts, n/panes.test.ts, n/replies.test.ts, n/scratch.test.ts†, n/sessions.test.ts, n/share-popover.test.ts | 11 |
| `CopyReadings`, `copyParts`, `copySegments`, `copyRow`, `copyRows`, `copyLegOf`, `nameOf`, `data-describes` value `copy` | src/buffer-list.ts†, src/draw.ts, src/local-layout.ts, src/main.ts, src/readout.ts, src/replies.ts, src/scratch.ts†, src/state-diagram.ts, src/style.css, src/transport.ts, b/app.test.ts, b/controls-gate.test.ts, b/cut-text.test.ts, b/step-bar-narrow.test.ts, b/strip.test.ts, b/tm-status-line.test.ts, b/tm-view-narrow.test.ts, b/view-strip-narrow.test.ts, n/readout.test.ts, n/replies.test.ts, n/scratch.test.ts† | 11 |
| `ScratchBuffers`, `ScratchBuffersConfig`, `Detachable`, `BufferInfo`, `BufferRecord`, `MAX_WARM_BUFFERS`, `BufferCapReached`, `scratchpad` | crates/redextape-core/examples/tm_emit.rs, crates/redextape-wasm/src/lib.rs, crates/redextape-wasm/src/session.rs, scripts/check-attributions.sh, src/buffer-list.ts†, src/buffers-store.ts†, src/copy-editor.ts†, src/editor-custody.ts†, src/lambda-pane.ts, src/main.ts, src/pane-chrome.ts, src/pane-host.ts, src/protocol.ts, src/replies.ts, src/scratch-editor.ts†, src/scratch.ts†, src/session-client.ts, src/session-worker.ts, src/transport.ts, b/active-pane.test.ts†, b/buffer-affordability.test.ts†, b/buffer-cool-warm.test.ts†, b/buffer-restore.test.ts†, b/buffers-quota-restored.test.ts†, b/build-reply-fixture.ts†, b/copies-undo.test.ts†, b/copy-editor-mount.test.ts†, b/editor-custody.test.ts†, b/pool-isolation.test.ts, b/record-cost.test.ts, b/scratch-app.test.ts†, b/scratch-cap.test.ts†, b/scratch-edit.test.ts†, b/scratch-fork.test.ts†, b/session-memory.test.ts, b/share-open-cap.test.ts†, b/tm-blank-buffer-cap.test.ts†, b/tm-blank-buffer.test.ts†, b/tm-buffer-restore.test.ts†, b/tm-pane-follows-session.test.ts†, b/tm-scratch-fork.test.ts†, b/two-lambda-panes.test.ts†, b/view-title.test.ts, n/replies.test.ts, n/scratch.test.ts†, n/sessions.test.ts, vite.config.ts | 12 |
| `onScratchReply`, `CopyCompiled`, `CopyBuild`, `buildCopy`, `RxmScratchReading`, `TmScratchReading`, `LegReading`, `TmScratchStatus`, `ReductionStatus`, `lambdaScratchAt`, `tmScratch`, `rxmScratch`, `lambdaScratch`, `unbind`, `ValueRun` (the `types.ts` re-export) | crates/redextape-wasm/src/lib.rs, crates/redextape-wasm/src/probe.rs, crates/redextape-wasm/src/session.rs, crates/redextape-wasm/tests/browser.rs, crates/redextape-wire/Cargo.toml, crates/redextape-wire/src/lib.rs, crates/redextape-wire/tests/ts_bindings.rs, src/copy-build.ts, src/lambda-pane.ts, src/main.ts, src/pane-host.ts, src/protocol.ts, src/replies.ts, src/rxm-pane.ts, src/rxm-seed.ts, src/scratch.ts†, src/session-client.ts, src/session-worker.ts, src/sessions.ts, src/tm-pane.ts, src/tm-seed.ts, src/transport.ts, src/types.ts, b/affordability-tm-worker.ts†, b/affordability-worker.ts†, b/buffer-affordability.test.ts†, b/buffer-cool-warm.test.ts†, b/buffers-quota.test.ts†, b/pool-isolation.test.ts, b/rxm-copy-cost.test.ts†, b/scratch-edit.test.ts†, b/scratch-fork.test.ts†, b/session-memory.test.ts, b/tm-buffer-cost.test.ts†, b/tm-buffer-restore.test.ts†, b/tm-copy-value-readout.test.ts†, b/tm-fork-cost.test.ts†, b/tm-pane-follows-session.test.ts†, b/worker.test.ts, n/bindings-contract.test.ts, n/copy-build.test.ts, n/replies.test.ts, n/scratch.test.ts†, n/session-fixtures.ts, n/session-pool.test.ts | 12 |
| reply kinds `scratch-compiled`, `tm-scratch-compiled`, `rxm-scratch-compiled`, `tm-value`, `rxm-value`; request `scratch` (`tm-value`: Task 5) | crates/redextape-wasm/src/session.rs, src/copy-build.ts, src/copy-editor.ts†, src/editor-custody.ts†, src/lambda-pane.ts, src/main.ts, src/pane-host.ts, src/protocol.ts, src/replies.ts, src/rxm-pane.ts, src/scratch.ts†, src/session-client.ts, src/session-worker.ts, src/tm-pane.ts, src/transport.ts, b/affordability-tm-worker.ts†, b/buffer-affordability.test.ts†, b/buffer-cool-warm.test.ts†, b/buffer-restore.test.ts†, b/buffers-quota.test.ts†, b/build-reply-fixture.ts†, b/copies-undo.test.ts†, b/copy-pin.test.ts†, b/editor-custody.test.ts†, b/keystrokes-in-flight.test.ts, b/lambda-copy-typed-text.test.ts†, b/recompile-swap.test.ts, b/record-cost.test.ts, b/reset-preset-copies.test.ts†, b/rxm-copy-cost.test.ts†, b/rxm-copy-restore.test.ts†, b/scratch-fork.test.ts†, b/share-open-editor.test.ts†, b/tm-buffer-cost.test.ts†, b/tm-buffer-restore.test.ts†, b/tm-copy-value-readout.test.ts†, b/tm-fork-cost.test.ts†, b/tm-pane-editor.test.ts†, b/tm-pane-follows-session.test.ts†, b/tm-scratch-fork.test.ts†, b/two-lambda-panes.test.ts†, b/worker.test.ts, n/copy-build.test.ts, n/replies.test.ts, n/scratch.test.ts†, n/session-client.test.ts, n/session-pool.test.ts | 12 |
| `LANGUAGE_OF_PANE`, `redextape_lambda`, `redextape_tm`, `redextape_rxm`, grammar urls | crates/redextape-core/src/capture_map.rs, crates/redextape-grammar-check/src/lambda.rs, crates/redextape-grammar-check/src/rxm.rs, crates/redextape-grammar-check/src/tm.rs, crates/redextape-grammar-check/tests/golden.rs, crates/redextape-lsp-wasm/src/lib.rs, crates/redextape-lsp/src/document.rs, crates/redextape-lsp/src/language.rs, crates/redextape-lsp/src/lib.rs, crates/redextape-lsp/tests/protocol.rs, crates/redextape-wasm/src/lib.rs, docs/architecture.md, grammars/README.md, grammars/shared/filetype-autocmd.md, grammars/shared/neovim-intro.md, grammars/tree-sitter-redextape-lambda/README.md, grammars/tree-sitter-redextape-lambda/grammar.js, grammars/tree-sitter-redextape-lambda/src/parser.c, grammars/tree-sitter-redextape-rxm/README.md, grammars/tree-sitter-redextape-rxm/grammar.js, grammars/tree-sitter-redextape-rxm/src/parser.c, grammars/tree-sitter-redextape-tm/README.md, grammars/tree-sitter-redextape-tm/grammar.js, grammars/tree-sitter-redextape-tm/src/parser.c, grammars/tree-sitter-redextape/README.md, scripts/check-lua.sh, src/colour.ts, src/lsp-protocol.ts, src/outline.ts, src/transport.ts, b/colour-slices.test.ts, b/editor-custody.test.ts†, b/grammar-differential.test.ts, b/scratch-editor.test.ts†, n/colour.test.ts, n/lsp-client.test.ts, n/lsp-protocol.test.ts | 13 |
| the data attribute values `data-panel="text"` and `data-panel="outline"` on the λ, TM and rxm views (the source view's `outline` stays) | src/style.css, b/buffer-restore.test.ts†, b/copy-editor-mount.test.ts†, b/editor-custody.test.ts†, b/focus-press.test.ts, b/lambda-pane-editor.test.ts†, b/lsp-outline.test.ts, b/lsp-restored-panel.test.ts, b/panel-maximise.test.ts, b/panel-regions.test.ts, b/panel-sizes-stored.test.ts, b/program-restore.test.ts, b/rxm-copy.test.ts†, b/tm-grid.test.ts, b/tm-pane-editor.test.ts†, b/tm-status-line.test.ts | 7 (TM, rxm), 10 (λ) |
| the storage key `redextape.buffers` (kept as `forgetCopies`' literal, in `privacy.html`'s row and in their tests) | privacy.html, src/buffers-store.ts†, src/editor-custody.ts†, src/lambda-pane.ts, src/layout.ts, src/main.ts, src/pane-host.ts, src/scratch.ts†, src/transport.ts, b/bindings-stored.test.ts†, b/buffer-restore-invalid.test.ts†, b/scratch-buffers.test.ts† | 3 |
| the seven deleted `web/src` modules named by file (`scratch.ts`, `buffer-list.ts`, `editor-custody.ts`, `scratch-editor.ts`, `copy-editor.ts`, `buffers-store.ts`, `editor-debounce.ts`) | scripts/check-attributions.sh, src/custom-palette.ts, src/draw.ts, src/editor-keymap.ts, src/lambda-pane.ts, src/layout.ts, src/machine-view-chrome.ts, src/main.ts, src/pane-chrome.ts, src/pane-host.ts, src/program-store.ts, src/replies.ts, src/rxm-pane.ts, src/session-worker.ts, src/sessions.ts, src/style.css, src/tm-pane.ts, src/transport.ts, b/controls-gate.test.ts, b/edge-spacing.test.ts, b/harness.ts, b/stage-tab-titles.test.ts, n/cut-text.test.ts, n/replies.test.ts | the task that deletes the module; a Rust comment: PR 2 (Task 16 lists it) |
| the deleted test files named by file | crates/redextape-lsp-wasm/src/lib.rs, crates/redextape-wasm/Cargo.toml, crates/redextape-wasm/src/probe.rs, crates/redextape-wasm/src/session.rs, package.json, scripts/emit-probe-reduced-files.sh, src/lambda-pane.ts, src/main.ts, src/pane-host.ts, src/protocol.ts, src/sessions.ts, src/style.css, src/transport.ts, src/unsaved.ts, b/clif-switch.test.ts, b/colour-slices.test.ts, b/custom-palette-load.test.ts, b/divider-drag.test.ts, b/harness.ts, b/lsp-diagnostics.test.ts, b/menu-focus.test.ts, b/pane-kind-switch.test.ts, b/pane-picker.test.ts, b/program-blocked.test.ts, b/program-quota.test.ts, b/provided-context.d.ts, b/record-cost.test.ts, b/restart-rewind.test.ts, b/tm-status-line.test.ts, b/view-title.test.ts, n/link-status.test.ts, n/replies.test.ts, n/sessions.test.ts, vite.config.ts | the task that deletes the named file; a Rust comment: PR 2 (Task 16 lists it) |

## File structure

| File | Change |
|---|---|
| `web/src/program-store.ts` | Task 3: `forgetCopies`; comments that cited `buffers-store.ts` |
| `web/src/main.ts` | every task 3-13, at the regions each names (`$R/pr1/survey-srcCore.md`, *main.ts*) |
| `web/src/pane-host.ts`, `transport.ts`, `replies.ts` | 3 (the persist deps), 4-5 (the leg's seeds and fork), 7 (`mountOnViewOf`), 8 (`reseedingSlots`), 9 (`forkCopy`, `detach`, `moveBack`), 10 (the editor hooks and deps), 12 (the copy replies, the scratchpad) |
| `web/src/session-worker.ts`, `protocol.ts`, `copy-build.ts`, `session-client.ts`, `sessions.ts`, `types.ts` | 4-5 (what only a leg's way in reads; the value run), 11 (`setDetached`), 12 (the rest) |
| `web/src/rxm-pane.ts`, `tm-pane.ts`, `machine-view-chrome.ts`, `clif-pane.ts`, `panes.ts` | 4, 5, 6 (`tm-pane.ts`'s tier reason), 7 |
| `web/src/lambda-pane.ts`, `pane-chrome.ts`, `view-header.ts`, `icons.ts`, `draw.ts` | 9, 10, 11 |
| `web/src/state-groups.ts`, `program-level.ts`, `state-diagram.ts` | 6 |
| `web/src/readout.ts`, `link-status.ts`, `link-wiring.ts`, `share-popover.ts`, `unsaved.ts`, `notice.ts`, `lsp-client.ts` | 3 (`unsaved.ts`), 8 (`notice.ts`'s docs), 10 (`closeDocument`), 11 (the rest) |
| `web/src/cut-text.ts` | 8 |
| `web/src/colour.ts`, `lsp-protocol.ts`, `outline.ts`, `lsp-worker.ts` | 13 |
| `web/src/focus-draw.ts` | 9, if Task 2 finds no focus move on the program that moves the layout (ruling 10) |
| `crates/redextape-wasm/src/session.rs` | 4 (`:1328-1332`), 5 (`:912-917`, `:944-950`): comments only (ruling 15) |
| deleted whole | `buffers-store.ts` (3), `copy-editor.ts` (7), `buffer-list.ts` (8), `scratch-editor.ts`, `editor-custody.ts`, `editor-debounce.ts` (10), `scratch.ts` (12); `scripts/emit-probe-reduced-files.sh` (4) |
| `web/src/style.css`, `web/index.html` | with the markup each task removes (ruling 16) |
| `web/help.html`, `README.md`, `docs/architecture.md`, `scripts/check-attributions.sh` | 14; `web/privacy.html` 3 and 14 |
| the grammar READMEs' paragraphs on what `colour.ts` loads | 13 |
| `web/vite.config.ts`, `web/package.json`, `web/tests/browser/provided-context.d.ts` | 4 |
| `web/tests/browser/tm-fixture.ts` | Task 1: new |
| `web/tests/browser/stored-old-panels.test.ts`, `stored-old-panels-link.test.ts`, `stored-old-panels-fixture.ts` | Task 2: new |
| `web/tests/browser/copies-key-removed.test.ts` | Task 3: new |
| `web/tests/browser/harness.ts` | the helper rows of the sweep, by task |
| other test files | as each task's tables say |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, the design's *As built* | 16 |

## Design coverage

| The design | Where |
|---|---|
| G1, every piece under *Today* | ways in: 4 (rxm), 5 (TM), 9 (λ); `copies ▾` and the warm cap's controls: 8; editors, *text*/*outline* panels, *format*, *move the editor here*: 7, 10; `copy · not linked`, pairs, rows, sentences, notices: 11; the warm-copy cap and the sessions: 12 |
| G2 | 3 (K1-K3, `privacy.html`) |
| G3 | 2 (O1-O2), 3 (K1-K2) |
| G4 (PR 1's half) | every task deletes what only its removal reached, by the coverage run and the sweep; 12 leaves the wasm exports for PR 2 |
| G5 and call d | 13 |
| G6 (PR 1's half) | 14 (pages and docs), 16 (the roadmap entry, Q3); the retake of the images is after the merge (Q2) |
| *Checks*: the tiers | 6; the moved cases 1 |
| *Checks*: old panels' state | 2 (O1-O2) |
| Constraints: coverage, gate, roadmap, sweep, docs | every task; 15; 16; the sweep table; 14 |
| *Left to the builder* | the rulings of *Global Constraints*; `check-attributions.sh` settled in *Verified facts* |

## Open, for Davey

None. The design's questions were settled by the user on 2026-11-23 (Q1-Q3); every builder call is a ruling above.

---

### Task 1: The state diagram's tests, `link-clear`, `tm-grid` and `tm-status-line` off copies

**Files:**
- Create: `web/tests/browser/tm-fixture.ts`
- Modify (tests only): `web/tests/browser/` `state-diagram-local-pan`, `state-diagram-local-scrollbars`,
  `state-diagram-local-layout`, `state-diagram-local-fans`, `state-diagram-local-fan-row`, `link-clear`, `tm-grid`,
  `tm-status-line` (each `.test.ts`)

**Interfaces:**
- Produces: `mountTmFixture(program: TmProgram, tapes: string[], box: { width: number; height: number }): { host:
  HTMLElement; pane: TmPane }` in `tm-fixture.ts`: a host of the box's size appended to `document.body`, `new
  TmPane(host, inertEvents())`, `setProgram(program, tapes)`. The caller renders (`pane.render(frame, controls)`, as
  `tm-follow-clamp.test.ts:71-73`). A fixture program is a `TmProgram` literal (`states`, `alphabet`, `tapes`, `width`,
  `start`, `listing`, `labels`, as `tm-follow-clamp.test.ts:35-47`) whose every state has a numeric `instr` and whose
  `listing` has a line for each `instr` used (ruling 9). Tasks 6 and 7 rely on these files holding no copy.

**`AFFECTED-1`**: `BROWSER` on the eight files and `state-diagram-local`, `state-diagram-no-machine`.

- [ ] **Step 0: The PR's baselines at `b627fe3`.** `COVERAGE` into `$L/00-coverage.log`; `FIREFOX` on
  `$R/pr1/ff-files.txt` into `$L/00-firefox.log`, its failures by file into `$L/00-firefox-fails.txt`; `AFFECTED-1`
  into `$L/01-base.log`; `TSC`, `LINT`. Expected: Chromium, node and coverage pass; Firefox's failures listed.
- [ ] **Step 1: The fixture and the moves.**

| File and cases at `b627fe3` | Ruling | Sabotage, and where it must fail |
|---|---|---|
| `state-diagram-local-pan`: all 26 cases (`:181`-`:899`, `:942`), the `beforeAll` (`:158-172`), `FIRST` (`:930-939`) | `mountTmFixture` at the file's panel box (`panel()`, `:102-108`, 300 × 160) with `MACHINE` (`:18-21`) and `FIRST` as fixture programs; each ▶ press (`:411-413`, `:884-886`, `:908-910`, `:952-953`) a `render` of the frame it reached; the focus's source at `:277` and `:290-302` a plain `<input>`, not the copy's editor | from its doc, one a describe |
| `state-diagram-local-scrollbars` `:114`, `:145`, `:153` (setup `:85-104`) | the fixture with `MACHINE` (`:13-50`) as a fixture program; the file stays in `SCROLLBAR_FILES` | from its doc |
| `state-diagram-local-layout` HUB `:302` | the file's own `is_even` level (`:116-137`), its height forced short; `copyEditor` (`:91-98`) goes | from its doc |
| `state-diagram-local-layout` TWO `:325` | deleted (ruling 17) | — |
| `state-diagram-local-fans` `:64`, `:69` | the program itself walked to `bdt35.q1.s.sk0` (`walkInParts(tmWalk(tmPane, /^bdt35\.q1\.s\.sk0 /, …, true), shares)`, as `-layout` `:130-132`); the fork and the `start` edit (`:22-29`, `:48-53`) go; the timeout fits the walk | from its doc |
| `state-diagram-local-fan-row` `:61`, `:68` | the same, to `bmul17.s9.up31` (`:7-12`, `:19-26`, `:45-50`) | from its doc |
| `link-clear` `:510`, `:534`, `:552`, `:562` | a describe of their own whose `beforeAll` picks *local* on the program (`diagramChoice('local')` on `SAMPLE`) | the clear on an empty-space press skipped (the line their doc names): each at its first link assertion |
| `link-clear` `:516`, `:522`, `:528`, their describe `:497-506` | stay on the copy for Task 5 | — |
| `tm-grid` `:155` | the diagram toggled, not the outline (`:157-174`), so the table's rows follow its resize; `:36-37` re-said | from its doc |
| `tm-status-line` `:277` (375 and 320 px) | the fixture, page-wide: one state named `LONG` (`:45`) with an `instr`, 5 tapes, width 4, rendered at `step 0 of 1`; the imports `:1`, `:5`, `:10`, `:16` as they fall | from its doc |
| `tm-status-line` `:225`; `state-diagram-local` `:312`, `:345`, `:360` | stay, for Task 5, which cuts them with the TM fork they press | — |

- [ ] **Step 2: Run.** `AFFECTED-1` into `$L/01-green.log`. Expected: pass; Step 0's count less TWO.
- [ ] **Step 3: Sabotage** as the table says, `$L/01-sab-driver.mjs`.
- [ ] **Step 4: Gates and the commit.** `TSC`, `LINT`, `COMMENTS`, `COVERAGE` (tests only: the figures move little),
  `FIREFOX` on the eight files. Report `$L/task-1-report.md`: the walks' times, the tallies, the sabotages.

### Task 2: The other tests that borrow a copy, the old panels' guard, and the focus premise

**Files:**
- Create: `web/tests/browser/stored-old-panels.test.ts`, `stored-old-panels-link.test.ts` and their one setup,
  `stored-old-panels-fixture.ts`
- Modify (tests only): `web/tests/browser/` `one-id-two-kinds`, `one-id-two-kinds-stored`, `parked-view-replaced`,
  `two-lambda-panes` (`:435` out), `pane-picker` (`:435` in), `stage-tab-titles`, `copy-header` (`:140-158` out),
  `view-title` (it in), `controls-gate`, `share-open-hashchange`, `lsp-restored-panel`, and `focus-press` if Step 1
  finds a premise (each `.test.ts`)

**Interfaces:**
- Consumes: `userSplit(leaf, pick, dir?)` (`user-event-fixture.ts:41`), `liveViewCount()` (`harness.ts:1170`),
  `fourViewWorkspace()`, `inertEvents()`, `encodeLink`.
- Produces: O1 and O2, which Tasks 3-14 run in their `AFFECTED` list; Step 1's finding, which Tasks 5 and 9 read.

**`AFFECTED-2`**: `BROWSER` on the twelve files, the two new ones, `stored-panels-restore`, `pane-kind-switch`.

- [ ] **Step 0: Baselines** at Task 1's commit: `AFFECTED-2` less the new files into `$L/02-base.log`.
- [ ] **Step 1: The focus premise (ruling 10).** A probe file in `web/tests/browser/`, gone before the commit: at
  each setup `focus-press.test.ts` uses (`:155-163`, and Debugger at 390 by 844 with the inspector stacked,
  `:204-218`), with no copy, focus each program view in turn from the keyboard and print with `console.error` the
  boxes of `#results`, the inspector and the lowest control of each view. A premise is a focus move between two
  program views that changes one of those boxes by 1 px or more. Record it in `$L/02-premise.md`. **If one exists**,
  `focus-press.test.ts`'s nine cases move onto it (its helpers `copy()`, the outline helpers, `copyReadout` and
  `focusCopy`, `:85-112`, replaced), sabotage: `createFocusDraw`'s returned function draws at once, every case at its
  press. **If none exists**, the file is left for Task 5, and Task 9 removes `focus-draw.ts`.
- [ ] **Step 2: The moves.**

| File and cases at `b627fe3` | Ruling | Sabotage, and where it must fail |
|---|---|---|
| `one-id-two-kinds` `:163`, `:219`, `:261` | the TM view picked at `rxm-0` (`:120`) recognised by its element (`inner`, `:125`) and title, not by a copy; on return, element identity replaces `copyNames`; `:261` a fresh element or `liveViewCount()`; the fork goes | from its doc |
| `one-id-two-kinds-stored` `:111`, `:140` | the parked view recognised by `inner` and its title `rxm · program`; `:112-118`, `:120`, `:122-124`, `:147`, `:149-151` go; `:102`, `:158`, `:178` as they are | from its doc |
| `parked-view-replaced` `:54` | the second λ view on the program by `userSplit('lambda-0', 'same')`; the close shown by a fresh element on return or `liveViewCount()`, not the copies menu's words | `applyLayout` keeps a parked view whose arrangement an edit replaced: at the element |
| `two-lambda-panes` `:435` | into `pane-picker.test.ts` as *keeps working after the last λ view is closed*, on the program; `:821` is held by `pane-picker.test.ts:241` and is not moved | from its doc |
| `stage-tab-titles` `:69-95`, `:97-135` | a tab's view changed by a pick of another leg's `· program` pair in its title menu and a pick back (as `pane-kind-switch.test.ts:100`), not by *edit a copy*; `editACopy` (`:31-37`) and `:10` go | from its doc |
| `copy-header` `:140-158` | into `view-title.test.ts`, a describe of its own: Debugger, ⋯ *split right* → `rxm:source`; widths (`:137-138`) measured again | from its doc |
| `controls-gate` `:346-354` | the notice offering *undo* from an example's pick (`main.ts:2171`), not a copy's delete; the walk of `button.notice-action` (`:340-345`) kept | from its doc |
| `share-open-hashchange` setup `:84-98`, `:131-145` | the extra view a split on the program the link's tree lacks (`userSplit('lambda-0', 'same')`, its `view added — …` notice asserted); `:136` asserts that view back after the undo; `:103`, `:106-107`, `:113` go with the copy, and `:127` (`#buffers` reads `copies 1 ▾`; with no copy made it reads `copies ▾`) | the open's undo puts no view back (`moveBack` answers `[]`): at the view back |
| `lsp-restored-panel` `:84-89`, `:91-96` | onto the source view's outline seeded at `:45` (`[data-leaf="source"] .outline`); the stored copy (`:47-62`) and import `:2` go; the `tm-0` outline entry at `:45` stays (old panel state); `:9-25`, `:36-41`, `:73-82` re-said | from its doc |

- [ ] **Step 3: The guard of old panel state (Review Focus 2), new.** One setup, `stored-old-panels-fixture.ts`, and
  the two files that load it:

```ts
import { expect, it } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import { LEG_PANELS } from '../../src/panes'
import { RxmPane } from '../../src/rxm-pane'
import { TmPane } from '../../src/tm-pane'
import { fourViewWorkspace, heightOf, host, inertEvents, region } from './harness'

/**
 * **A WORKSPACE THAT HOLDS STATE FOR PANELS NO VIEW DRAWS LOADS, AND EVERY PANEL A VIEW DRAWS READS ITS OWN.** The
 * parse keeps any panel name under a leaf the tree holds, and a view reads its panels by the names `LEG_PANELS` lists,
 * so a `text` or `outline` entry is carried and read by nothing. Each drawn panel is stored as the opposite of what a
 * bare view draws, and one pair of regions a view, stored open, at shares of 2 and 1, so a load that dropped the
 * workspace fails whichever way a default falls, for open state and for size.
 */
const GONE = {
  'lambda-0': { leg: 'lambda', open: [], shares: ['text'], pair: ['map', 'term'] },
  'tm-0': { leg: 'tm', open: ['outline'], shares: ['text', 'outline'], pair: ['diagram', 'rules'] },
  'rxm-0': { leg: 'rxm', open: ['outline'], shares: ['text', 'outline'], pair: ['listing', 'registers'] },
} as const
const BARE = {
  lambda: (el: HTMLElement) => new LambdaPane(el, inertEvents()),
  tm: (el: HTMLElement) => new TmPane(el, inertEvents()),
  rxm: (el: HTMLElement) => new RxmPane(el, inertEvents()),
}
const drawsOpen = (view: ParentNode, name: string): boolean =>
  view.querySelector<HTMLElement>(`[data-panel="${name}"]`)?.dataset.open === 'true'

/** The workspace O1 stores and O2 links, and the open state each drawn panel must come back with. */
export function oldPanels() {
  const panels: Record<string, Record<string, boolean>> = {}
  const panelSizes: Record<string, Record<string, number>> = {}
  const own = new Map<string, Record<string, boolean>>()
  for (const [leaf, gone] of Object.entries(GONE)) {
    const bare = document.createElement('div')
    BARE[gone.leg](bare)
    const flipped = Object.fromEntries(LEG_PANELS[gone.leg].map((name) => [name, !drawsOpen(bare, name)]))
    const drawn = { ...flipped, ...Object.fromEntries(gone.pair.filter((n) => n in flipped).map((n) => [n, true])) }
    own.set(leaf, drawn)
    panels[leaf] = { ...Object.fromEntries(gone.open.map((name) => [name, true])), ...drawn }
    const gonePanels = Object.fromEntries(gone.shares.map((name) => [name, 3]))
    panelSizes[leaf] = { ...gonePanels, [gone.pair[0]]: 2, [gone.pair[1]]: 1 }
  }
  return { workspace: { ...fourViewWorkspace(), panels, panelSizes }, own }
}

/** O1's and O2's cases, under the `describe` each file names. */
export function holdsOldPanels(own: Map<string, Record<string, boolean>>): void {
  it('opens every panel the views draw as the workspace stored it', () => {
    for (const [leaf, state] of own)
      for (const [name, open] of Object.entries(state))
        expect(drawsOpen(host(leaf) as HTMLElement, name), `${leaf}'s ${name}`).toBe(open)
  })

  it('sizes the panels that stay as stored, and draws no text or outline panel in the λ, TM or rxm view', () => {
    for (const [leaf, gone] of Object.entries(GONE)) {
      const [big, small] = gone.pair.map((name) => heightOf(region(leaf, name)))
      expect(big / small, `${leaf}'s ${gone.pair.join(' over ')}`).toBeCloseTo(2, 1)
      const left = (host(leaf) as HTMLElement).querySelectorAll<HTMLElement>('[data-panel="text"], [data-panel="outline"]')
      for (const el of left) {
        const box = el.getBoundingClientRect()
        expect(box.width * box.height, `${leaf}'s ${el.dataset.panel}`).toBe(0)
      }
    }
  })
}
```

  `stored-old-panels.test.ts` (O1) takes `oldPanels()` at module scope, and in its `beforeAll` sets the viewport to 1280
  by 896, stores `serializeWorkspace(workspace)` under `LAYOUT_STORAGE_KEY`, writes `SHELL`, imports `main` and waits on
  `stateIdle`; its `describe`, *a stored workspace holding state for the text and outline panels*, calls
  `holdsOldPanels(own)`. `stored-old-panels-link.test.ts` (O2) hands the same `workspace` to `encodeLink` as
  `share-open-deep.test.ts:58` does (its program, `encoding: 'unary'`, `positions: {}`), sets `location.hash` before
  importing `main`, and holds the same cases under *a share link holding state for the text and outline panels*. Each
  pair is two regions of one view's stack, sized as `panel-sizes-restore.test.ts:40-45` reads a load; a pair that
  cannot reach 2 to 1 over its floors at that viewport is changed for one that can, and the report says which. The
  cases pass at once (they hold what is there; the design's *Checks*). While Tasks 3-6 run, the TM and rxm views still
  list `outline` in `LEG_PANELS`; from Task 7 the `open` entries are the only ones naming it. The second case's size
  assertion holds it after Tasks 7 and 10, when its loop finds no text or outline panel to measure.
- [ ] **Step 4: Run.** `AFFECTED-2` into `$L/02-green.log`. Expected: pass.
- [ ] **Step 5: Sabotage**, `$L/02-sab-driver.mjs`: the table's, and **O-S1** `parsePanels` refuses a panel name the
  leaf's view does not list: O1 and O2 at *opens every panel…* (the workspace dropped, the defaults drawn); **O-S2**
  the TM view's `PanelStack` gives a share to a region it does not draw (the `outline` share read for `rules`): O1 and
  O2 at *sizes the panels that stay…*, at the TM pair's proportion.
- [ ] **Step 6: Gates and the commit.** `TSC`, `LINT`, `COMMENTS`, `COVERAGE`, `FIREFOX` on the files. Report
  `$L/task-2-report.md` with the premise's finding.

### Task 3: Stored copies, and the key removed at every start-up

**Files:**
- Modify: `web/src/program-store.ts` (`forgetCopies`; comments `:3`, `:9`, `:19`); `web/src/main.ts` (the import `:39`;
  the storage `:1205-1315`; the restore `:1571-1644`; `onBuffersPersist` `:1015-1017`; `persistBindings` `:1536`; the
  replies' dep `:2841-2843`; `refreshBuffers`' persist half `:2658-2687`; the warming loop `:3044-3095`; the claiming
  loop `:3126-3181`; `copies: droppedBindings` `:3189` to `[]`; re-say `:692`, `:882-887`, `:1328-1329`, `:2696-2701`,
  `:3036-3041`, `:3097-3118`; the call of `forgetCopies`); `web/src/unsaved.ts` (the `'copies'` half: `:1-10`, `:28-35`,
  `:55-61`); `web/src/transport.ts` (`onBuffersPersist` `:124-136`, `:152`, `:419`, `:531`, `:563`);
  `web/src/pane-host.ts` (`persistBindings` `:283-287`, `:1669-1681`; `seedBinding` `:106-107`, `:1696-1719`; doc
  `:629-634`, step 11 of `applyLayout`'s doc); `web/src/replies.ts` (`onBuffersPersist` `:107-119`, `:150`, `:626`,
  `:682`, `:730`, each call with the comment above it, `:618-625`, `:675-681`, `:727-729`); `web/src/scratch.ts` (the
  import `:1`, `snapshot` and `restore`, docs `:58-62`, `:283-289`, `:566`, which cites `main.ts`'s `persistBuffers`);
  `web/src/layout.ts:13-16` and `custom-palette.ts` (comments); `web/privacy.html:51`
- Delete: `web/src/buffers-store.ts`; `web/tests/node/buffers-store.test.ts`; `web/tests/browser/` `tm-buffer-restore`,
  `buffer-restore`, `rxm-copy-restore`, `buffer-restore-invalid`, `buffers-quota`, `share-open-cap`,
  `parked-copy-restore`, `buffers-quota-restored`, `copy-edit-leaving`, `lambda-copy-typed-text`, `copy-editor-mount`,
  `buffers-quota-empty`, `bindings-stored` (each `.test.ts`) and `copy-text-fixture.ts` (16 files; their subjects are
  the store and the restore, or they read a copy's text out of it; none outlives copies)
- Create: `web/tests/browser/copies-key-removed.test.ts`, `copies-key-removed-stage.test.ts`
- Test (cut): node `program-store.test.ts` (new cases), `unsaved.test.ts` (`:11`; `:14-18` out; `:22-23`; `:47`, `:49-50`;
  `:53-60` out; `:66`, `:71-72`), `replies.test.ts` (`:156-159`, `:759`, `:770-784` out), `sessions.test.ts` (`:285-289`,
  `:293`, `:301-305`, `:321-324`, `:365`, `:375`, `:860`), `scratch.test.ts` (the `snapshot`/`restore` cases `:1168-1240`,
  `:1341`, `:1399`); browser `program-quota` (`:3`, `:11`, `:14`, `:16-17`, `:22-29`, `:44-47`, `:50`, `:69`; `:84-94` out),
  `storage-blocked` (`:169-204` out, with `:5`, `:24`, `:55-56`, `:77`), `program-blocked` (`:56-77` out, with `:4`; `:10`, `:12`
  re-said), `share-open` (the seed `:4`, `:40`, `:61-68`; `:106-109` out; `:116-129` cut to the program's binding, the
  title's copy clause and `:24-27` re-said; the import `:9`), `share-open-hashchange` (`:9` if Task 2 left it),
  `copies-undo` (`:104` out, with the import `:3` and `storedText` `:93-98` it leaves unused), `record-cost` (`:411`),
  `custom-palette-load` (`:12-13`); the mentions of files this task deletes: `clif-switch` (`:31-32`,
  `rxm-copy-restore`), `divider-drag` (`:28`, `tm-buffer-restore`)
- R-G1 sites: `scratch-fork.test.ts:586` and `tm-pane-follows-session.test.ts:99` (`onBuffersPersist` in
  `createReplies`' deps: the line out); `buffer-cool-warm.test.ts:66` (cites `buffer-restore.test.ts`'s
  `termsAfterReopen`)

**Interfaces:**
- Produces: `forgetCopies(store?: Storage): void` in `program-store.ts`. `unsavedLine` without its `copies` parameter;
  `UnsavedStore` without `'copies'`. No `persistBindings`, `onBuffersPersist`, `seedBinding` deps; `recompile`'s boolean
  goes if nothing reads it.

**`AFFECTED-3`**: `BROWSER` on the browser files above, the two new ones, `stored-old-panels`,
`stored-old-panels-link`, `storage-blocked`, `program-store`-reading files (`rg -l PROGRAM_STORAGE_KEY tests/browser`);
`NODE` on the whole tier.

- [ ] **Step 0: Baselines** at Task 2's commit: `AFFECTED-3` less the new files into `$L/03-base*.log`. And the seed:
  run `serializeBuffers` (`buffers-store.ts:72`) once in a node probe for a λ copy of the default program's term bound to
  `lambda-0` and a TM copy of its machine bound to `tm-0`, and keep the string it writes in `$L/03-seed.txt`: the new files seed
  that literal, since the module goes.
- [ ] **Step 1: The cases, new.**
  - **F1, F2** in `tests/node/program-store.test.ts`, with a memory storage and a storage whose every method throws,
    built as `editor-prefs.test.ts:13-49` builds them:

```ts
describe('forgetCopies', () => {
  it('removes redextape.buffers and leaves every other key', () => {
    const store = memoryStorage({ 'redextape.buffers': '{}', 'redextape.program': 'p', 'redextape.layout': 'l' })
    forgetCopies(store)
    expect(store.getItem('redextape.buffers')).toBeNull()
    expect([store.getItem('redextape.program'), store.getItem('redextape.layout')]).toEqual(['p', 'l'])
  })

  it('returns quietly when the storage refuses', () => {
    expect(() => forgetCopies(hostileStorage())).not.toThrow()
  })
})
```

  - **K1** `copies-key-removed.test.ts` (Review Focus 1): `localStorage` seeded before `main` is imported with the
    four-view layout, a stored program and `redextape.buffers` set to `$L/03-seed.txt`'s literal. Cases: *removes
    redextape.buffers at start-up and leaves the program's key* (the key `null`, the program's key as seeded); *opens
    the views a stored copy was bound to on the program* (`lambda-0`'s and `tm-0`'s titles read `λ · program` and
    `TM · program` and are drawn, a box over 0 px; each view's ⋯ shows no `copy · not linked` status).
  - **K2** `copies-key-removed-stage.test.ts`: the same seed with the stored workspace on the Stage (the Stage preset's
    workspace), bindings for `lambda-0` and `tm-0`: *opens every Stage tab on the program*: each tab's title reads
    `· program`; the key is gone.
  - **K3**: a storage that throws. `storage-blocked.test.ts` already mounts on a throwing `localStorage` getter
    (`:26-32`, `:96-105`); its load case holds K3 once `forgetCopies` is on the start-up path (sabotage S2).
- [ ] **Step 2: Run red.** `NODE tests/node/program-store.test.ts` and `BROWSER` on K1, K2 into `$L/03-red*.log`.
  Expected: F1, F2 fail (`forgetCopies` is not exported); K1's first case fails at the key, its second fails at a
  title (the copy is restored); K2 fails at a tab's title.
- [ ] **Step 3: The removal.**
  - `forgetCopies`, called first thing in the start-up beside `readProgramStorage`:

```ts
/**
 * **THE KEY NO PART OF THE APP READS, REMOVED AT EVERY START-UP.** A tab still running an older build can write it
 * again, so a removal made once behind a flag would leave it. Silent when the storage refuses, as a failed read of the
 * program is: a key left behind costs its bytes and nothing else.
 */
export function forgetCopies(store?: Storage): void {
  try {
    ;(store ?? localStorage).removeItem('redextape.buffers')
  } catch {
    // Nothing reads the key, so a storage that refuses leaves nothing to put right.
  }
}
```

  - The rest of the Files list: the copies' writes, reads, restore and persist plumbing out of `main.ts`,
    `transport.ts`, `pane-host.ts`, `replies.ts`, `scratch.ts` and `unsaved.ts` (`$R/pr1/survey-srcCore.md` Q5 is the
    full list); copies still work within a page load. The storage line keeps the program's half alone.
  - `privacy.html:51`, the `redextape.buffers` row: *Nothing. The app deletes this key each time it starts; earlier
    versions kept the text of copies under it.* (`pages.test.ts:179-187` holds the row to the literal in `src/`.) It is
    the one sentence in the tree that says what copies were, since a privacy page describes the data a key held;
    Task 14's rule names it.
  - The deletions and the cuts of the Files list.
- [ ] **Step 4: `SWEEP-3`.** Nothing outside the plan's kept names, and the rows' files the later tasks own.
- [ ] **Step 5: Run green.** `AFFECTED-3` into `$L/03-green*.log`, `TSC`, `LINT`, `COMMENTS`, `ATTR`, `COVERAGE`,
  `FIREFOX` on the browser files edited or created. Expected: Chromium and node pass (Step 0's counts less the deleted
  cases, plus F1, F2, K1, K2); Firefox, the baseline's failures and no other.
- [ ] **Step 6: Sabotage**, `$L/03-sab-driver.mjs`:

| Id | The one edit | Must fail |
|---|---|---|
| S1 | the start-up call of `forgetCopies` taken out | K1 at the key; K2 at the key |
| S2 | `forgetCopies`' `catch` rethrows | `storage-blocked.test.ts`'s load case (`:96-105`), at the mount |
| S3 | `forgetCopies` also removes `redextape.program` | F1 at the other keys; K1 at the program's key |

- [ ] **Step 7: The commit and the report** (`$L/task-3-report.md`): the sweep's log, the tallies, the coverage row, the
  sabotages.

### Task 4: rxm copies, and every copy probe

**Files:**
- Modify: `web/src/transport.ts` (`programFork`'s rxm arm, `:255-260`: the fork serves TM alone);
  `web/src/buffer-list.ts` (the *new rxm copy* button: the blank row offers TM alone); `web/src/protocol.ts`
  (`RxmCompiled.text` `:738-754`; docs `:641`, `:696-706`, `:888`); `web/src/session-worker.ts` (the `rxmText` read
  `:667-669`, its field `:689`, `Session.rxmText` `:136-140`); `web/src/rxm-pane.ts` (`#value` `:66-77`, `:87-89`,
  `:143`; `setScratch` `:195-198`; imports `:17`, `:19`; the ctor comment's value half `:84-86`); `web/src/rxm-seed.ts`
  (the `reading` parameter and `setScratch`; `setForkAvailable` with the rxm fork; doc `:5-10`); `web/src/replies.ts`
  (`TELL.rxm`'s reading `:214-217`; `setLegProgram`'s rxm literal `:722` without `text`) and `web/src/pane-host.ts`
  (`SEED`'s rxm reading `:489`); `web/src/machine-view-chrome.ts` (`setForkAvailable`'s rxm doc); `web/src/style.css`
  (`.rxm-value` in `:1103-1104` and `:1152-1158`, `:3227`); `web/package.json:21-24` (`test:probe`, `test:probe:tm`,
  `test:probe:tm-buffer`, `test:probe:rxm-copy`; `:28` stays); `web/vite.config.ts` (`PROBE_FILES`' five entries `:68`,
  `:69`, `:71`, `:74`, `:75`, their comment `:38-48`, `:62-65`; `provide` `:377-383`'s `probeTmBufferRun` and
  `probeRxmCopyRun`); `web/tests/browser/provided-context.d.ts:9-15`; `web/src/protocol.ts:102-103` (quotes a figure the
  deleted probe printed: re-said or cut); `crates/redextape-wasm/src/session.rs` (the doc `:1328-1332`, whose `:1331`
  cites `rxm-copy-corpus.ts`'s `CASES`: re-said without the citation, comment only, ruling 15)
- Delete: `scripts/emit-probe-reduced-files.sh`; `web/tests/browser/` `stage-copy-editor`, `parked-copy-editor`,
  `parked-copy-undo`, `reset-preset-copies`, `rxm-blank-copy`, `rxm-copy`, `copy-beside-program`, `copy-pin`,
  `copy-header` (each `.test.ts`; their way in is an rxm copy, and `copy-header`'s one lasting case moved in Task 2),
  the probes `buffer-affordability`, `tm-fork-cost`, `tm-buffer-cost`, `rxm-copy-cost`, `rxm-copy-memory` (each `.test.ts`)
  and the helpers `affordability-worker`, `affordability-tm-worker`, `affordability-rxm-worker`,
  `rxm-copy-memory-worker`, `rxm-copy-corpus`, `build-reply-fixture` (each `.ts`)
- Test (cut): `record-cost` (cases (c) `:341-347`, (d) `:348-354`, (g) `:355-360` and (f) `:603-627` out, with `rxmUnreached`
  `:81-93`, `tmUnreached` `:95-107`, `rxmCopy` `:298-304`, `rxmTotal` `:305-306`, `tmCopyText` `:310-323`, the `CASES` import `:47`,
  `:307-308`, `Case.totalSteps`, the `copyShown`/`deleteEveryCopy` imports `:30`, `:32`; (e) `expectReadout`'s copy parameter
  `:498`, `:503-507`, `:518`, `:529`, `:594`; comments `:124`, `:486`); `keystrokes-in-flight` (`:292-307` out, the fork `:199`);
  `colour` (`:116-125` out); `edge-spacing` (`:666-681`'s rxm half: `:668`, `:675`, `:678`); `recompile-swap` (the `rxm-0` row of
  `:366-370`); `worker` (`:346-348` cut and the case moved from describe `:339` into `:76`; `:357-408` out with `FORTY_TWO`
  `:340` and `recorded` `:336`; the rxm row `:532` of `:515-548`); `machine-row-scrollbars` (`:38`: the view grown by one
  line another way, a render with one more row or the host one line shorter, not `setScratch` `:47-51`); `rxm-pane`
  (`:452-473` out); `machine-view-chrome` (`:24-32`'s rxm half); `replies.test` (the `TELL.rxm` reading's assertions;
  the rxm copy's reply arms and their cases stay for Task 12, ruling 2, but `:1201` expects `programs.rxm` without
  `text`); `editor-view-fixture.ts` (`retypeRxm` `:45-50`);
  `harness.ts` (`termEditorsIn`, `copiesMenu`, `inCopiesMenu`, `shutCopiesMenu`, `deleteEveryCopy` where no caller is left);
  node `sessions.test` (`:557-625` out, *re-throws a non-cap error out of the rxm-fork handler…*: it seeds
  `programs.rxm` with the `text` this task removes and drives the rxm fork)
- R-G1 sites: `record-cost.test.ts:230` (cites `rxm-copy-cost.test.ts`'s `RUN`)

**Interfaces:**
- Produces: `RxmPane` without `setScratch`; `seedRxm(pane: RxmPane, compiled: RxmCompiled | null): void`; `RxmCompiled`
  without `text`; `programFork` for the TM leg alone. `RxmScratchReading`, the rxm copy's build and value replies and
  `readings.rxm` stay for Tasks 11-12.

**`AFFECTED-4`**: `BROWSER` on every browser file this task edits, `rxm-pane`, `machine-row`, `copy-header`'s moved case in
`view-title`, O1, O2; `NODE` on the whole tier.

- [ ] **Step 0: Baselines** at Task 3's commit.
- [ ] **Step 1: The case, new.** **M1-rxm** in `view-menu.test.ts` or the rxm view's own file: *the rxm view's ⋯ menu
  offers no edit a copy*: on the program's `rxm-0`, the ⋯ menu opened with a real click holds no `button.detach` and no
  `.view-menu-hint`, and each item it holds has a box over 0 px. Run red: fails at `button.detach`.
- [ ] **Step 2: The removal**, as the Files list says. The *new rxm copy* button and its CSS go; `copies ▾` stays,
  offering *new TM copy*.
- [ ] **Step 3: `SWEEP-4`**, and the cut probes' files gone from `PROBE_FILES` and `package.json`:
  `rg -n 'buffer-affordability|tm-fork-cost|tm-buffer-cost|rxm-copy-(cost|memory)|probeTmBufferRun|probeRxmCopyRun|emit-probe' web scripts`:
  nothing (the Rust features and `check-all.sh:168-176`'s legs are PR 2's; Task 16 lists them).
- [ ] **Step 4: Run green** (`AFFECTED-4`, `TSC`, `LINT`, `COMMENTS`, `ATTR`, `COVERAGE`, `FIREFOX` on the edited files), as
  Task 3's Step 5. `REDEXTAPE_PROBE=1 pnpm exec vitest run --project browser tests/browser/record-cost.test.ts` into
  `$L/04-record-cost.log`: passes (a probe the default run excludes).
- [ ] **Step 5: Sabotage**, `$L/04-sab-driver.mjs`: **S1** the rxm view's *edit a copy* given back, in one hunk of
  `MachineViewChrome`'s constructor: the `editCopy` option passed whatever `on.detachProgram` is, and the copy state
  made ready (`this.copy.setForkAvailable` with a text and a count of 1, the facts `seedRxm` no longer sends): M1-rxm
  at `button.detach`. The `programFork` arm put back alone draws nothing: the item shows only once `setCopy` is given
  a state (`view-header.ts:635`, `:643`). **S2** `machine-row-scrollbars`' moved case, from its doc.
- [ ] **Step 6: The commit and the report** (`$L/task-4-report.md`). The commit adds
  `crates/redextape-wasm/src/session.rs`, so the hook's `cargo fmt` and `clippy` run on it.

### Task 5: TM copies: the ways in, the fork cap, the value run and the TM view's copy status

**Files:**
- Modify: `web/src/transport.ts` (`programFork` `:241-262`, whole); `web/src/pane-chrome.ts` (`detachProgram`
  `:200-213`); `web/src/pane-host.ts` (`detachProgram` `:920`; `SEED`'s tm reading `:490`; the `readingOf` dep
  `:328-329`); `web/src/machine-view-chrome.ts` (the `editCopy` option `:70`, `setForkAvailable` `:154-163`);
  `web/src/tm-pane.ts` (`#scratch`, `#reading`, `#value` `:77-118`, `:181-183`; `setScratchStatus`, `setScratchValue`,
  `#drawValue` `:510-567`; `setForkAvailable` `:569-579`; the headerless and reduced sentences `:677-685` and
  `#drawStatus`' doc `:632-639`; the `setDetached` override's scratch half `:453-490`; class doc `:25-31`; imports
  `:10`, `:14`); `web/src/tm-seed.ts` (fork facts `:23-27`, scratch `:28-29`, the `ruleCount` import);
  `web/src/protocol.ts` (`MAX_FORK_RULES`, `ruleCount`, `forkable` `:461-495`; `VALUE_CHUNK` `:242-253`;
  `TmCompiled.text` and `tmResultDecodable` `:717-734`; the `tm-value` reply `:838-846`; imports `:19`, `:22` as they
  fall; doc `:380`); `web/src/session-worker.ts` (reads `:663-666`, field `:683`; `Session.tmText`/`tmResultDecodable`
  `:124-134`; `TmValueRunHandle` `:199-208`; `runValueLoop` `:946-973`; `dropLive`'s value free `:426-430`; the
  `VALUE_CHUNK` and `ValueRun` imports); `web/src/replies.ts` (`TELL.tm`'s fork facts `:218-225`; the `tm-value` arm
  `:686-713`; the TM literal's `text: null` and `tmResultDecodable: true` `:650-656`, with its comment);
  `web/src/buffer-list.ts` (*new TM copy*: the blank row goes); `web/src/main.ts` (the `readingOf` dep `:1563`; `onNew`
  `:2600-2633`); `web/src/style.css` (`.tm-value`, `.has-value-run`: `:1103-1104`, `:1152-1164`);
  `crates/redextape-wasm/src/session.rs` (the docs `:912-917` and `:944-950`, which cite `protocol.ts`'s `forkable` at
  `:915` and `:947`, and its `ruleCount` across `:913-914`: re-said without them, comment only, ruling 15)
- Delete: `web/tests/browser/` `tm-blank-buffer-cap`, `tm-blank-buffer`, `tm-scratch-fork`, `lsp-copy-diagnostics`,
  `tm-copy-value-readout`, `tm-pane-follows-session`, `tm-reduced-buffer`, `colour-slices-fork`, `parked-copy-editor-mount`
  (each `.test.ts`); `focus-press.test.ts` if Task 2 found no premise
- Test (cut): `link-clear` (`:497-506`, `:516`, `:522`, `:528`; `tmShowsCopy` `:48` and its use `:52`; `:26`, `:36-37`, `:55-56`,
  `:239-240`); `tm-status-line` (`:225` out); `keystrokes-in-flight` (`:213-228`, `:257-273`, `:311-317` out; the fork `:197`);
  `colour` (`:105-114`, `:127-143` out); `view-keys` (row `:674`); `lsp-hover` (`:267-303` and `MACHINE` `:58-63` out, ruling
  18); `view-keys-format-on-blur` (`:75-96` out); `divider-drag-format-on-blur` (`:113-127` out, `:24-25`); `edge-spacing`
  (`:666-681` out, with `:25`, `editorOf` `:4`, `pick` `:15` if unused); `lsp-editor-names` (`:28-38` out; `:41`'s `>1` to `1`,
  `:46-48` out); `recompile-swap` (the `tm-0` row); `view-keys-focus` (row `:322`); `field-width` (`:741-760` out); `worker` (row
  `:531`); `hidden` (the TM fork of `:36-41` and its words `:10`, `:30`); `view-menu` (`:102-111` out; `:123-126`, `:177-183`);
  `machine-view-chrome` (`:24-41` out); `tm-pane-editor` (its `setScratch*` and `setForkAvailable` cases out; the file goes
  in Task 7); `controls-gate` (`:155-158` re-said); node `protocol` (`:158-192` out; `programOf` `:143-156` and imports `:9`,
  `:17`, `:23` as they fall), `replies` (`:105`; the value run's cases in *a TM buffer retains…* `:807-958` and `:1112-1121`;
  the TM arm `:1325-1335`), `sessions` (`:481-555`, `:635-664` out); `harness.ts` (`tmPaneHost`, `editedToHaltImmediately`,
  `startStateGoesToHalt`, `buffersButton`, `buffersMenu`, `bufferRows`, `copyShown`, `pickInViewMenu`);
  `hidden-views` (the `ruleCount` import `:4`, `:52`, `:72`: the case fingerprints the seeded program itself, its
  states' and rules' count summed in the test; its subject, a hidden TM view not seeded each compile, outlives copies);
  `state-diagram-local` (`:311-371` out with `FLAT` and `DOTTED` `:27-30`: both describes edit a TM copy; the `name`
  and `none` tiers stay held by `state-groups.test.ts`' node cases until Task 6); `lsp-outline` (`:97-138` out: both
  cases press `tm-0`'s *edit a copy*; Task 7 writes the absence case); the mentions of files this task deletes:
  `lsp-diagnostics` (`:20`, `lsp-copy-diagnostics`), `colour-slices` (`:18`, `colour-slices-fork`)
- R-G1 sites: `clif-pane.ts:56`, `pane-host.ts:195` (cite `transport.ts`'s `programFork`)

**Interfaces:**
- Produces: no `programFork`, `detachProgram`, `setForkAvailable`, `MAX_FORK_RULES`, `ruleCount`, `forkable`,
  `VALUE_CHUNK`, `tm-value` reply; `TmCompiled` without `text` and `tmResultDecodable`; `seedTm(pane: TmPane, compiled:
  TmCompiled | null): void`; `TmPane` without its copy status and value line. The TM copy's build reply, `TmScratchHandle`,
  `TmScratchReading` and `readings.tm` stay for Tasks 11-12 (ruling 2). After this task only the λ view offers *edit a
  copy*; `copies ▾` lists copies and offers nothing new.

**`AFFECTED-5`**: `BROWSER` on every browser file this task edits, `tm-pane`'s other files (`rg -l "TmPane|tm-0"
tests/browser` narrowed to the files this task does not delete), O1, O2; `NODE` on the whole tier.

- [ ] **Step 0: Baselines** at Task 4's commit.
- [ ] **Step 1: The case, new.** **M1-tm**, beside M1-rxm: *the TM view's ⋯ menu offers no edit a copy*, as M1-rxm on
  `tm-0`. Run red: fails at `button.detach`.
- [ ] **Step 2: The removal**, as the Files list says.
- [ ] **Step 3: `SWEEP-5`.**
- [ ] **Step 4: Run green**, as Task 3's Step 5.
- [ ] **Step 5: Sabotage**, `$L/05-sab-driver.mjs`: **S1** the TM and rxm views' *edit a copy* given back, in one hunk
  of `MachineViewChrome`'s constructor: the `editCopy` option put back, run by a no-op, and the copy state made ready
  (`CopyEditor.setForkAvailable` with a text and a count of 1, as `seedTm` sent them; the driver names the hunk):
  M1-tm and M1-rxm at `button.detach`. The option alone draws nothing: the item shows only once `setCopy` is given a
  state (`view-header.ts:635`, `:643`). **S2** a hidden TM view handed each compile: `hidden-views`' first case at the
  spy (`:65`).
- [ ] **Step 6: The commit and the report** (`$L/task-5-report.md`). The commit adds
  `crates/redextape-wasm/src/session.rs`, so the hook's `cargo fmt` and `clippy` run on it.

### Task 6: The state diagram's `name` and `none` tiers

**Files:**
- Modify: `web/src/state-groups.ts` (doc `:3-11`; `Tier` `:12`; `Group`'s docs `:18`, `:20-24`; `Groups.tier` `:41` and its doc
  `:42-45`; `tierOf` `:75-80`; `groupStates`' doc `:92-100` and its tier branches `:103`, `:105`, `:111`, `:120`, `:131`,
  `:135-136`; `reorderByReach` `:182-219`; `isGuard` `:54-61` to the name alone, ruling 7); `web/src/program-level.ts`
  (doc `:17`, branch `:39-42`); `web/src/tm-pane.ts` (the *program* choice's reason, `:240-253`); `web/src/state-diagram.ts`
  (the `Tier` import `:5`; docs `:115`, `:120-121`, `:366-368`; `tier` `:348-351`; `shown` `:353-362` to the level itself, the
  no-machine case `:356-358` kept)
- Test: node `state-groups.test.ts` (`:15-29`, `:78-113` out; `:69-76` out, the guard held by the name in the compiled
  cases; imports `:4`), `program-level.test.ts` (`:57-60` out; `COPY` import `:5`), `label-rows.test.ts` (`:71`),
  `tm-machines.ts` (`COPY` `:77-83` out; `go` unexported); browser `state-diagram-no-machine` (`:78-81` re-said;
  `state-diagram-local`'s copy cases went in Task 5), `tm-view-narrow` (`:66` re-said), and every fixture with `instr:
  null` on every state whose diagram assertions change once the tiers go (`panel-regions.test.ts:66-79`,
  `tests/node/tm-machines.ts`' `ONE_RULE_PROGRAM` as `machine-view-chrome.test.ts` uses it,
  `tm-follow-clamp.test.ts:35-47`, `rxm-pane.test.ts:63-71`): each gets numeric `instr`s and a `listing` where a case
  fails for its grouping, and is left as it is where none does

**Interfaces:**
- Produces: `groupStates` grouping by instruction alone, its states without an instruction as runtime routines
  (`segmentOf`, `stepOf` unchanged); no `Tier`, `tierOf`, `Groups.tier`, `StateDiagram.tier`; `isGuard(s)` true for the
  name `overflow` (its doc: the core reserves the name for the guard). `setProgram(null)`'s no-machine case unchanged.

**`AFFECTED-6`**: `BROWSER` on O1, O2, `tests/browser/state-diagram*.test.ts`, `label-rows`' browser files if any, `tm-grid`,
`tm-follow-clamp`, `panel-regions`, `machine-view-chrome`, `rxm-pane`, `tm-status-line`, `link-clear`, `tm-view-narrow`; `NODE` on
the whole tier.

- [ ] **Step 0: Baselines** at Task 5's commit.
- [ ] **Step 1: The removal**, as the Files list says. No case is new: every machine the app can show carries an
  instruction (the design's *Checks*), and the cases that stay hold the `instr` tier.
- [ ] **Step 2: `SWEEP-6`.**
- [ ] **Step 3: Run green**, as Task 3's Step 5. Expected: the cases that stay pass unchanged, but for the fixtures the
  Files list allows to gain `instr` (the report names each and the assertion that needed it).
- [ ] **Step 4: Sabotage**, `$L/06-sab-driver.mjs`: **S1** `groupStates` puts a state with no instruction into the group
  of the instruction before it: the compiled runtime-routine cases of `state-groups.test.ts`, at the group; **S2** the
  *program* choice disabled with its old reason whenever a machine is shown (`this.#program !== null` alone, the test
  the tier stood beside): the `state-diagram-local*` case that picks *program* on the program, at the choice. A guard
  on fewer than two groups would not fire: the compiled machine has many.
- [ ] **Step 5: The commit and the report** (`$L/task-6-report.md`).

### Task 7: The TM and rxm views' editor, text and outline panels

**Files:**
- Modify: `web/src/machine-view-chrome.ts` (ruling 5: the `CopyEditor` import and field `:1`, `:41-45`, `:74-79`;
  `MachineViewOptions` `:12-20`; `implements EditablePane` `:30`; `format` `:63-65`, `claim` `:71`; `textRegion`, `outlineRegion`,
  `editorUnmounted` `:88-113`; `setDetached`'s copy half `:115-122`; the editor methods `:124-152`; docs `:22-29`, `:34-39`,
  `:56-61`); `web/src/tm-pane.ts` (`panels.outline` `:163`; `:167-172`; the appends `:311`, `:316`; the regions `:319-342`;
  `editorUnmounted` `:500-508`; `implements EditablePane` `:35-43`; `:64-72`, `:302-306` re-said); `web/src/rxm-pane.ts`
  (`RxmPanels.outline` `:31`; `:86`; `:136-166`; `implements EditablePane` and its docs `:2`, `:49-58`); `web/src/clif-pane.ts`
  (`:55-57`; `super(on)` `:97`); `web/src/panes.ts` (`LEG_PANELS`' `outline` `:45-46`, doc `:39-42`);
  `web/src/pane-host.ts` (`mountOnViewOf` `:450-465` and its call `:1609-1611`; the `unmounted` destroy path `:1016-1046`,
  `:1478`, `:1525`; `EDITOR_ON_LEAVE`'s rxm and tm entries; `buildPane`'s comments `:565-571`); `web/src/editor-custody.ts`
  (`flush` `:501-505` narrowed to views that hold an editor, ruling 6; its casts for machine views; the citation of
  `pane-host.ts`'s `mountOnViewOf` at `:130`, an R-G1 site);
  `web/src/draw.ts:290-292` and `web/src/linked-legs.ts:19` (the machine views' `setEditorAvailable`); `web/src/style.css`
  (`:2914`, `:2922`, `:2930-2937`, `:2947`, `:2954-2956`, `:2993`, `:3006`, `:3020-3023`, the text rule's TM and rxm halves,
  comments `:2892-2897`, `:2910-2911`, `:2943-2944`, `:2971-2973`, `:2989-2991`)
- Delete: `web/src/copy-editor.ts`; `web/tests/browser/copy-editor.test.ts`, `tm-pane-editor.test.ts`
- Test (cut): `panel-regions` (`:103`, `:127`, `:156`, `:175` out; `:200` on a mount without `setEditor`; doc `:17`);
  `machine-row` (`:922-960` out); `lsp-outline` (Step 1's OUT, where Task 5 cut
  `:97-138`); `recompile-swap` (the outline filter `:221-229`);
  `stored-panels-restore` (`'text'` out of `:79`'s TM and rxm lists, the title `:76` per leg); `panes.test` (`:280-282`, a
  name other than `outline`); `machine-view-chrome` (`:57-61` stay; the rest as it falls); `hidden` (what is left of the
  TM half); `focus-press` (its outline helpers, if Task 2 moved it)

**Interfaces:**
- Produces: `MachineViewChrome` constructed `super(on)`, without `copy`, the regions or the editor methods; `TmPane`,
  `RxmPane`, `ClifPane` not `EditablePane`; `LEG_PANELS.tm` and `.rxm` without `outline`; `EditorCustody.flush` visits only
  views that hold an editor. `EditablePane` and custody stay for the λ view until Task 10.

**`AFFECTED-7`**: `BROWSER` on every browser file this task edits, O1, O2, `restart-rewind`, `clif-app`, `clif-switch`,
`panel-sizes-stored`, `panel-maximise`, `machine-row-scrollbars`; `NODE` on the whole tier.

- [ ] **Step 0: Baselines** at Task 6's commit.
- [ ] **Step 1: The case, new.** **R1** in `restart-rewind.test.ts` (Review Focus 5): *↺ on the program's TM, rxm and
  clif views restarts each at step 0 and throws nothing*: for each of `tm-0`, `rxm-0` and the clif view, step it once,
  press its ↺ with a real click, and read its step line at 0; a `pageerror`/`error` listener installed before the
  presses holds no entry. It passes at the task's start (the chrome still has `flushEditor`) and is held by S1.
  **OUT** in `lsp-outline.test.ts`, beside `:93-95`: *is absent from a TM or rxm view*: no outline panel in `tm-0` or
  `rxm-0`. Run red: fails at `tm-0`, whose withdrawn panel is in its DOM.
- [ ] **Step 2: The removal**, as the Files list says, `custody.flush` narrowed in the same edit as the chrome's
  `flushEditor`.
- [ ] **Step 3: `SWEEP-7`.**
- [ ] **Step 4: Run green**, as Task 3's Step 5. O1 and O2 pass with `outline` now named only by their `open` entries.
- [ ] **Step 5: Sabotage**, `$L/07-sab-driver.mjs`: **S1** `custody.flush` visits every view of the session again: R1 at
  the error listener (a `TypeError` on `flushEditor`); **S2** `LEG_PANELS.tm` given `outline` back: O1's first case at
  `tm-0`'s `outline` (the list builds no panel, so OUT cannot see it); **S3** the TM view's stack given its `outline`
  region back (an empty region appended where `tm-pane.ts:316` appended it): OUT at `tm-0`, and O1's second case if the
  region draws a box, the report says which.
- [ ] **Step 6: The commit and the report** (`$L/task-7-report.md`).

### Task 8: `copies ▾`

**Files:**
- Modify: `web/index.html:29` (`#buffers`); `web/src/main.ts` (`#buffers` `:255-269` and `:305`; the notice fallback `:327-333`
  to `#settings`, ruling 4, its comment re-said; the delete's undo `:2390-2428`; `copyHolds` `:2430-2460`; the list
  `:2462-2634`; `refreshBuffers` `:2636-2688` and its start-up call `:3036-3042`; `:1659`, `:2009-2016`, `:2153-2154`
  re-said); `web/src/transport.ts` (`onBuffersChanged` `:111-123`); `web/src/pane-host.ts` (`reseedingSlots` `:108-113`,
  `:1720-1769`); `web/src/notice.ts` (docs `:4`, `:31-35`, `:46-48`, `:72-79`, `:189-197`, `:305-315`: the line's actions
  and its fallback without copies); `web/src/cut-text.ts` (the selector `:21`, words `:4`, `:9-10`, `:31`);
  `web/src/style.css` (`#buffers` `:245`; the shared rule's `.buffer-*` `:594-607`; `:1435-1567`: `.buffer-list`, its
  `@position-try --buffer-list-to-end` and `@supports`, `.buffer-row*`, `.buffer-new`, `.buffer-delete`,
  `.buffer-temperature`)
- Delete: `web/src/buffer-list.ts`; `web/tests/browser/buffer-list.test.ts`, `copies-undo.test.ts`,
  `buffer-cool-warm.test.ts`, `scratch-buffers.test.ts`, `scratch-cap.test.ts`, `two-lambda-panes.test.ts` (each presses
  `copies ▾`; `two-lambda-panes`' lasting case moved in Task 2)
- Test (cut): `harness.ts` (`SHELL`'s `#buffers` `:49`; `rowNames`), node `harness.test.ts` (`:14`), `lambda-text.ts` (`asShown`
  `:29-32`); `cut-text` (browser `:439-482` out with `:3`, `:27`, `NARROW`/`noop`/`ROWS` `:443-451`; node `:40-46`, `:51-55`,
  `:61-64`); `edge-spacing` (`'buffers'` out of `HEADER_MENUS` `:426-429`, `GUTTER_SCANS`' row `:614`, `MENU_WINDOWS`' doc
  `:483` and the windows kept for the list); `header-selects` (`:14-16`, `:84-85`, `:100`, `:104`: another header button);
  `view-keys-popovers` (row `:78`, `:87-89`); `first-load-views` (`:157`, `:159`, `:165`); `view-toggles-first-paint` (`copies`
  `:44`; `:11`, `:14`); `examples-menu` (`:45-60` against another header button, retitled; `:214-219`); `controls-gate`
  (`'buffers'` `:243`; `:360-368` out; the setup's λ copy `:178-183` out if nothing left needs it; `:25`, `:74`, `:98-99`,
  `:119`, `:178`, `:331-345`, `:372` re-said); `notice` (`:126-130`, `:149`, `:168`, `:279-297`, `:316-368`: the resting
  sentence the program's, `unsaved.ts`'s); `stage-tab-titles` and `menu-focus` (what
  reads `copies ▾`, `:29-33`); comments `app-header:19-20`, `workspace-switches:23`, `base16-remove:165-166`
  (`share-open`'s and `share-open-hashchange`'s `copies 1 ▾` reads went in Tasks 3 and 2)
- R-G1 sites: `lambda-pane.ts:781`, `editor-custody.ts:278`, `:360`, `scratch.ts:501` (cite `pane-host.ts`'s
  `reseedingSlots`); `scratch.ts:391` and node `sessions.test.ts:437` (cite `main.ts`'s `refreshBuffers`)

**Interfaces:**
- Produces: no `#buffers`, `bufferList`, `BufferRow`, `reseedingSlots`, `onBuffersChanged`, `refreshBuffers`; `createNotices`
  given `() => settingsButton`. `ScratchBuffers`' `cool`, `warm` and `retire` have no app caller after this task; they go
  with `scratch.ts` in Task 12 (`scratch.test.ts` covers them until then). A λ copy made by *edit a copy* lasts until its
  page closes.

**`AFFECTED-8`**: `BROWSER` on every browser file this task edits, the header files (`header-menus-narrow`, `app-header`,
`menu-focus`, `view-keys`, `focus-press` if moved), `storage-blocked`, `program-quota`, O1, O2; `NODE` on the whole tier.

- [ ] **Step 0: Baselines** at Task 7's commit.
- [ ] **Step 1: The case, new.** **N1** in `storage-blocked.test.ts`, or `program-quota.test.ts` if that is the file whose page shows the
  resting storage sentence with *hide* (Review Focus 3): *puts the focus on settings when
  the storage sentence is hidden from the keyboard*: the resting sentence's *hide* focused from the keyboard and
  pressed with `{Enter}`: the line is `hidden`, `document.activeElement` is `#settings` and its box is over 0 px; at the
  file's width and again at 390 px (`page.viewport`). Run red: fails at `activeElement` (it is `#buffers`).
- [ ] **Step 2: The removal**, as the Files list says.
- [ ] **Step 3: `SWEEP-8`.**
- [ ] **Step 4: Run green**, as Task 3's Step 5.
- [ ] **Step 5: Sabotage**, `$L/08-sab-driver.mjs`: **S1** `createNotices` given no fallback: N1 at `activeElement`;
  **S2** the fallback `#workspace`: N1 at `activeElement`.
- [ ] **Step 6: The commit and the report** (`$L/task-8-report.md`).

### Task 9: The λ copy, the last way in

**Files:**
- Modify: `web/src/view-header.ts` (*edit a copy* `:560-567`; `CopyState` `:242-248`; `setCopy` `:253`, `:712-717`;
  `ViewMenuOptions.editCopy` `:381-382`; `item`'s hint `:399-422`; the state and sync for it `:635-658`; docs `:451-452`,
  `:663`); `web/src/icons.ts` (`'edit'` `:19`, its path); `web/src/lambda-pane.ts` (the `detach`/`editCopy` options `:243-247`,
  `:256-258`; "the term at this step" `:257`); `web/src/pane-chrome.ts` (`detach` `:94-106`; docs `:66-70`, `:214`, `:226`);
  `web/src/transport.ts` (`forkCopy` `:178-228`, `NO_TEXT` `:19-27` with it, `detach` `:422-469`); `web/src/pane-host.ts` (`detach`
  `:890`; `moveBack` `:114-126`, `:1770-1801`; docs `:49`, `:61-62`, `:203-212`; `rebind`'s same-leg branch cut to its
  one-session answer, ruling 12: `leaving`, `moved` and the editor's move `:1008-1028`, `:1043` and the `switched`
  change `:1048-1050` go, `seedPane` and `base.rebind` `:1032-1033` stay, the docs `:961-1007` re-said, and
  `holdsEditor` `:175` with its last caller); `web/src/main.ts` (`Replaced.copies` `:2236-2244`,
  `showWorkspace`'s doc `:2249` and `:2262`; `undoOpen`'s copies half `:2266-2268`, `:2283-2302`, `:2307`; `openLink`'s copies
  `:2370-2374`, `:2386`; `compile`'s doc `:2786-2789`); `web/src/draw.ts` (the readout's copy branch `:405-425` and the
  `nameOf` dep `:100`, `:118`, with `main.ts:2770`); `web/src/style.css` (`.view-menu .view-menu-hint` `:1418-1422`); and,
  if Task 2 found no premise, `web/src/focus-draw.ts` (deleted) with its wiring (ruling 10) and the reason that leans on
  it, `web/src/virtual-grid.ts:167-171`
- Delete: `web/tests/browser/` `scratch-fork`, `scratch-app`, `scratch-edit`, `scratch-rebind-editor`, `stage-copy-clause`,
  `scroll-kept-moved-editor`, `share-open-editor`, `active-pane` (each `.test.ts`) and `scratch-editor-fixture.ts`
- Test (cut): `pane-kind-switch` (`:179-245`, `:283-362` out, ruling 12; `:33-39`; the `editorsInLeaf` import `:8`);
  `menu-focus` (`:128-152` out); `pane-picker` (`:187-222` out; `:33-38`; `:7`); `colour` (`:97-103` out with `fork`
  `:60-65`; `:4-26` re-said for one editor); `view-keys` (`:671-692` out); `vim-keymap` (`:133-137` out; `:143`, `:158`,
  `:162`; `:12`, `copyView` `:42-49`, `:5`); `lsp-hover` (`:305-352` out, with `:4`, `:12-14`, `:65-108`, `:126-127`,
  `assertNeverOpens` `:185-202`; comments `:378-379`, `:414-420`); `keystrokes-in-flight` (`:230-242`, `:275-290` out;
  the fork `:198`; the copy helpers `:36-41`, `:62-97`, `:135-175`; doc `:6-12`); `recompile-swap` (the `lambda-0` row,
  with `copyOf` `:337-354`, `typeInCopy` `:356-363`, `SMALL` `:32-33`, `copyBuilt` `:122-123`, `recompile`'s `copy`
  option `:128-160`, doc `:22-23`); `parked-view-surfaces` (`:239-255` out, with `:50-53`, `sharedCopies` `:95-103`, the
  import `:9`; docs `:26-33`, `:42`, `:66-67`); `share-popover` (`:249-260` out); `strip` (`:91-116` out);
  `restart-rewind` (`:403-469` out, `:4`, `:22`); `view-keys-focus` (`:319-357` out); `hidden` (the λ half of `:36-41`);
  `view-menu` (`:118-127` out; `build`'s `editCopy` `:31`; `:51-52`, `:54-56`, `:60`; `:132-133`, `:135`, `:137`;
  `setCopy` at `:162`, `:174-175`, `:185`); `worker` (`:515-548` out); `controls-gate` (the setup's λ copy, if Task 8
  left it); node `sessions.test` (`:402-471` out); `harness.ts` (`claim`, `editorsOf`, `editorsInLeaf`, `forkButton`,
  `markersIn` where no caller is left); `lambda-pane-editor` (`:92-100` out, *offers a fork once a frame is on screen*;
  the file goes in Task 10); and in Step 6, `clif-app` (`:128-134` out, *offers no edit a copy*) and M1's
  `button.detach` and `.view-menu-hint` assertions
- R-G1 sites: `session-client.ts:108` (cites `transport.ts`'s `detach`); `scratch.ts:160`, `:373`, `:390` and node
  `scratch.test.ts:352` (cite `transport.ts`'s `forkCopy`)

**Interfaces:**
- Produces: no way to make a copy: no `forkCopy`, `detach` event, `editCopy`, `CopyState`, `setCopy`, `moveBack`; `viewMenu`'s
  `item` without a hint; `Replaced` without `copies`; `rebind`'s same-leg branch answering for the view's own session
  alone. The editors, custody, `setDetached`, the copy readout functions and
  the sessions stay for Tasks 10-12, reached by their own component and node tests.

**`AFFECTED-9`**: `BROWSER` on every browser file this task edits, `share-open`, `share-open-hashchange`,
`stage-tab-titles`, `lambda-display`, `view-title`, O1, O2, K1; `NODE` on the whole tier.

- [ ] **Step 0: Baselines** at Task 8's commit.
- [ ] **Step 1: The case, new.** **M1-λ**, beside M1-rxm and M1-tm: *the λ view's ⋯ menu offers no edit a copy*, as they
  do on `lambda-0`, and its items' boxes over 0 px with no `.view-menu-hint`. Run red: fails at `button.detach`.
- [ ] **Step 2: The removal**, as the Files list says.
- [ ] **Step 3: `SWEEP-9`.**
- [ ] **Step 4: Run green**, as Task 3's Step 5.
- [ ] **Step 5: Sabotage**, `$L/09-sab-driver.mjs`: **S1** `viewMenu` builds an *edit a copy* item whenever it is given
  no `editCopy` (a disabled stub): M1-λ, M1-tm and M1-rxm at `button.detach`; **S2** `undoOpen` (`main.ts`) puts back
  nothing: `share-open-hashchange`'s undo case (Task 2's move), at the view back.
- [ ] **Step 6: The absence checks no code can fail.** With *edit a copy*'s item and its hint line gone from
  `view-header.ts`, no code builds a `button.detach` or a `.view-menu-hint`. Once S1 has fired, M1-λ, M1-tm and M1-rxm
  drop those assertions and keep what a menu still holds (each item drawn, no group or separator with no item after
  it), and `clif-app`'s *offers no edit a copy* goes. `BROWSER` on the edited files, `TSC`, `LINT`.
- [ ] **Step 7: The commit and the report** (`$L/task-9-report.md`).

### Task 10: The copy editors and custody

**Files:**
- Modify: `web/src/lambda-pane.ts` (the imports `:2`, `:3`, `:11`, `:15-16`; `implements EditablePane` `:38`;
  `#editorHost`, `#editor`, `#collapse` `:91-109`; `#editSink`, `#lspDocument`, `#colour`, `#keymap` `:120-149`;
  `#editorAvailable` `:162-185`; the `format` and `claim` options `:249-251`, `:259`; the editor host and sinks
  `:297-305`; the text panel `:333-352`; `setEditor` through `setEditorAvailable` `:496-685`; `#refreshClaim`
  `:815-830`; docs `:74-88`, `:339-341`, `:709-711`); `web/src/pane-chrome.ts` (`textPanel` `:249-291`; `PaneEvents`'
  `lspDocument` `:11-22`, `colour` `:24-35`, `keymap` `:37-48`, `editSink` `:107-126`, `showEditor` `:127-142`,
  `collapse` `:143-163`; docs `:75-83`, `:164-169`; the import `:5`); `web/src/pane-host.ts` (the `custody` dep `:247`;
  `EDITOR_ON_LEAVE`, `holdsOnLeave` `:148-198` (`holdsEditor` went in Task 9); `scratchSeedOf` `:330-346`;
  `mountScratchEditor` `:384-448`; the claiming wrapper `:866-886`; `showEditor` `:891-918` (`rebind`'s editor arm went
  in Task 9); `applyLayout`'s handover, mount, `dropClaimsOn` and reconcile `:1513-1527`, `:1540-1551`, `:1557-1586`,
  `:1612-1624`; docs `:94-98`, `:921-958`, `:1338-1340`, `:1405-1463`; `resetViews`' `'copies'` `:1271-1287`, `:1464`,
  `:1485-1487`); `web/src/transport.ts` (`editorLanguage` `:29-37`; the editor deps `~:72-110`; `flushEdit` `:137-141`
  and `:359`; `:472-564`); `web/src/main.ts` (custody `:1032-1048`; the transport deps `:973-1022` that were the
  editors'; the pane host's `custody` `:1505` and `scratchSeedOf` `:1564-1568`; `hasEditor` `:2759-2764`; `editorHome`
  `:2840`; comments `:421`, `:437-440`, `:597-598`, `:1146-1147`, `:2884-2885`, `:3022-3023`); `web/src/replies.ts` (the
  `editorHome` dep `:94-105`, `:149` and every call of it, `:844` and the three in `onScratchReply`'s copy arms, `:610`,
  `:673-674`, `:725-726`, with the comments that explain them, around `:588-609`, `:665-672`, `:723-724`; the
  `EditablePane` import `:3`: so the commit typechecks with `editor-custody.ts` gone, and the arms keep their other work
  for Task 12); `web/src/view-header.ts` (*move the editor here* `:568-576`; `setClaim` `:254-255`, `:718-722`;
  `ViewMenuOptions.claim` `:383`); `web/src/icons.ts` (`'move-editor-here'` `:16`); `web/src/draw.ts` (`hasEditor`
  `:56-61`, `:81`, `:113`; `:306-309`, `:325`); `web/src/lsp-client.ts` (`closeDocument` `:333-343`);
  `web/src/layout.ts:35-39` (comment); `web/src/style.css` (`.term-editor` `:1087-1093`; the text panel's rules
  `:2925-2942`, `:3288`; comments `:702-706`, `:818-823`); `web/src/editor-keymap.ts:100` (names `editor-custody.ts`:
  re-said)
- Delete: `web/src/scratch-editor.ts`, `editor-custody.ts`, `editor-debounce.ts`; `web/tests/browser/editor-custody.test.ts`,
  `scratch-editor.test.ts`, `lambda-pane-editor.test.ts`, `pane-chrome-text-panel.test.ts`, `editor-view-fixture.ts`
- Test (cut): `panel-maximise` (`:300-347` out); `stored-panels-restore` (`'text'` out of `:79`, the title `:76` *draws exactly
  the panels the table names*); `harness.ts` (`editorHost`; `paneEvents`' `editSink`/`collapse` `:1433-1434`; docs `:517-520`,
  `:917-922`); `view-menu` (`build`'s `claim` `:32`; `:143-150` out); node `sessions.test` (the editor deps `:263-284`;
  `:336-380` out; `stepTransport`'s `:846`, `:849-861`; the ↺ *pending* branch `:1011-1034`, `:1083-1099` out; `:1065` relabelled),
  `lsp-client.test` (`closeDocument`'s cases), `lambda-tree.test` (`:77`), `replies.test` (`editorHome` `:154`); `app.test`
  (`:143-144`); and in Step 6, M2's `.claim-editor` assertion
- R-G1 sites: `scratch.ts:61` (cites `pane-chrome.ts`'s `textPanel`), `:502` (`pane-host.ts`'s `mountScratchEditor`),
  `:526` (`editor-debounce.ts`'s `EDITOR_DEBOUNCE_MS`), `:565`, `:569`, `:864`, `:872`, `:880` and node
  `scratch.test.ts:836` (`transport.ts`'s `editSink`)

**Interfaces:**
- Produces: `LambdaPane` without an editor, a text panel or `EditablePane`; `PaneEvents` without `lspDocument`, `colour`,
  `keymap`, `editSink`, `showEditor`, `collapse`; no custody; `LspClient` without `closeDocument`. The source editor is the
  only editor on the page.

**`AFFECTED-10`**: `BROWSER` on every browser file this task edits, `restart-rewind` (R1), `lsp-diagnostics`, `lsp-hover`,
`vim-keymap`, `view-keys`, `view-keys-focus`, `view-keys-format-on-blur`, `divider-drag-format-on-blur`, `panel-sizes-stored`,
O1, O2; `NODE` on the whole tier.

- [ ] **Step 0: Baselines** at Task 9's commit.
- [ ] **Step 1: The case, new.** **M2** in `view-menu.test.ts`'s app half, or the file M1 lives in (Review Focus 4): *the
  λ, TM and rxm views' ⋯ menus hold no move the editor here and no format, and the source view's keeps format*: on
  each program view, the ⋯ menu opened with a real click holds no `.claim-editor` and no format item, and no group or
  separator with no item after it; the source view's ⋯ holds format, drawn. Run red: fails at the λ view's format item.
- [ ] **Step 2: The removal**, as the Files list says.
- [ ] **Step 3: `SWEEP-10`.**
- [ ] **Step 4: Run green**, as Task 3's Step 5.
- [ ] **Step 5: Sabotage**, `$L/10-sab-driver.mjs`: **S1** the λ view passes a `format` option again: M2 at the λ menu;
  **S2** the source view's ⋯ built without `format`: M2 at the source menu.
- [ ] **Step 6: The absence check no code can fail.** Once S1 and S2 have fired, M2 drops its `.claim-editor`
  assertion: no code builds *move the editor here* now. M2 keeps the format item's absence from the λ, TM and rxm menus
  (the source view builds one) and its presence in the source view's. `BROWSER` on the edited files, `TSC`, `LINT`.
- [ ] **Step 7: The commit and the report** (`$L/task-10-report.md`).

### Task 11: What showed a copy

**Files:**
- Modify: `web/src/lambda-pane.ts` (`#detached` `:150-161`; render's `#refreshDetach` `:491-494`; `setDetached` `:750-806`;
  `#refreshDetach` `:832-863`); `web/src/view-header.ts` (`ViewHeader.setDetached` `:53-54`, `:208-212`; the status `:112-115`,
  `:120`, `:182-186`; docs `:14`, `:19-21`, `:27`, `:155-156`: `pairLabel` stays, its examples `· program` pairs);
  `web/src/machine-view-chrome.ts` and `tm-pane.ts` (what is left of `setDetached`); `web/src/sessions.ts`
  (`PaneView.setDetached` `:529`; `PaneSlot`'s render `:677-689`; doc `:626-627`); `web/src/draw.ts` (`onProgram`/`watched`
  `:138-161` to `arranged`; `unlinked` `:230-237`; the pin guards `:254-259`, `:319-320`; the copy imports `:13-17`; `:370-373`);
  `web/src/readout.ts` (`CopyLeg` `:162-176` through `copyLegOf` `:262-272` and `copyRows` `:315-326`; the import `:4`;
  `data-describes`' `'copy'` to `'none'` `:361-373`, ruling 8, its comment re-said); `web/src/link-status.ts` (`DetachedPanes`
  `:62-84`; `LinkStatus.detached` `:87-112`; `ATTACHED`, `allCopies`, `detachedText` `:143-185`; `linkStatus`' doc and body
  `:190-252`; `'absent'`'s doc `:50-58`); `web/src/link-wiring.ts` (`detachedPanes` `:82-86`, `:108-139`, `:367`; the `viewTitle`
  and `arranged` deps `:100-103` with `main.ts:1531-1534`; `drawLink`'s detached clauses `:180-199`; the fan-out guard
  `:246-254`; `:71`); `web/src/transport.ts` (the `linkedRowClick` guard `:290`, its doc `:276-283`);
  `web/src/share-popover.ts` (`ShareDeps.copies` `:23-24`, `listed` `:33-35`, `copiesLine` `:37-54`, the line `:117`,
  `:123-124`, `:132`, doc `:7-9`) with `main.ts:2229`; `web/src/main.ts` (`layoutChanged`'s `'a copy'` `:1102`; `sourceHost`'s
  doc `:1059-1065`); `web/src/panes.ts` (comments `:103`, `:183-184`); `web/src/style.css` (`.view-status` `:892-918`; the
  dim's comment `:644-646`)
- Delete: `web/tests/browser/view-status.test.ts`
- Test (cut): node `readout.test` (the `copySegments`, `copyRow`, `copyRows`, `copyLegOf` describes `:191-502`; the import
  `:3`), `link-status.test` (`:149-350` out; `:2`, `:22`), `link-wiring.test` (`COPY` `:16`, the stub `:27`; `:128-188` on program
  views or a split), `share-popover.test` (`:9-51` out; `:2`), `panes.test` (the fake's `setDetached` `:29`; `:101`; `:190-194`
  re-said with `arranged`; `:254-266` out if `shown`'s `accept` goes with `draw.ts:374`), `sessions.test` (the `recorder`'s
  `setDetached` `:83-99`; `:667-687` out); browser `view-title` (`:192-219` out; the `detached` parameter `:37`, `:51`, `:73`,
  `:159-160` and arguments; `'λ scratchpad'` and `'copy 1'` relabelled; `:22`), `lambda-display` (`:69`; `:63-68`), `strip`
  (`:126-132` expects `none`; `:134-143` out; `:7-8`), `view-header` (`COPY` `:8` and the pair `:42-48` another program pair;
  `:72-83` out; `:96`), `view-menu` (`:13`; `'λ · copy 1'` `:79`, `:98`), `notice` (the copy sample strings `:24-28`, `:41-46`,
  `:52-54`, `:77`, `:86-88`, `:181-184`, `:217-219`, `:261-267`, `:305`, `:324-337` re-said with sentences the app says;
  comments `:92`, `:357`), `machine-view-chrome` (`:63-65`), `record-cost` ((h)'s `detached` `:381`), `link-hold` (`:75`)
- R-G1 sites: browser `app.test.ts:193` and node `replies.test.ts:635` (cite `readout.ts`'s `copyParts`); node
  `scratch.test.ts:287` (cites `link-wiring.ts`'s `detachedPanes`)

**Interfaces:**
- Produces: no `setDetached` on any view, the header or `PaneView`; no `DetachedPanes`, `detachedPanes`, `copiesLine`,
  `ShareDeps.copies`, `CopyReadings` or `copy*` readout functions; `readout`'s `data-describes` `'program' | 'none'`;
  `createLinkWiring` without `viewTitle` and `arranged`. `SessionEntry.detached` is now read by nothing; Task 12 removes
  it with its writers.

**`AFFECTED-11`**: `BROWSER` on every browser file this task edits, `share-popover`, `share-open`, `link-clear`, `link-hold`,
`inspector`, `readout-history-full`, `focus-press` if moved, O1, O2; `NODE` on the whole tier.

- [ ] **Step 0: Baselines** at Task 10's commit.
- [ ] **Step 1: The case's edit first.** `strip.test.ts` `:126-132` expects `none` where it expected `copy`. Run red: fails
  at that value.
- [ ] **Step 2: The removal**, as the Files list says.
- [ ] **Step 3: `SWEEP-11`.**
- [ ] **Step 4: Run green**, as Task 3's Step 5.
- [ ] **Step 5: Sabotage**, `$L/11-sab-driver.mjs`: **S1** `describes` always `'program'`: `strip.test.ts`'s first-call case at
  `none`; **S2** `style.css`'s dim without its `[data-describes="program"]` qualifier: the `strip` or `inspector` case that
  reads the readout's opacity before the first result, from its doc (if none reads it, the report says so and adds
  one: the opacity is 1 while `data-describes` is `none` and a compile runs).
- [ ] **Step 6: The commit and the report** (`$L/task-11-report.md`).

### Task 12: The copies' sessions: registry, worker, protocol and replies

**Files:**
- Modify: `web/src/main.ts` (the scratchpad `:856-880`; `SOURCE_SESSION`'s doc and the block `:788-805`, labels kept for
  PR 3; `detached: false` `:910`; `readings` `:930`; the transport's and replies' `scratchpad` `:984`, `:2819`;
  `:2810-2839` re-said); `web/src/transport.ts` (`scratchpad` `:58`; imports); `web/src/replies.ts` (`onScratchReply`
  `:524-862`; `scratchpad` `:73`; `:156-173`; `CLEAR_READING`/`READING_LEGS` `:250-264`; the copy cases of `onReply`
  `:477-486`; docs `:40-60`, `:266-296`; the import `:26`, `:3` having gone in Task 10); `web/src/session-worker.ts`
  (doc `:14-25`; imports `:36`, `:38`, `:87`, `:90`; the scratch handles and results `:150-255`; `Live`'s scratch arms
  and doc `:302-339`; `handleOf`/`HandleOf` `:495-507`; `Made`, `BUILD`, `onScratch` `:850-944`; `onExtend`'s rxm value
  `:1010-1021`; `:1059`; the `'scratch'` dispatch `:1082-1089`; `:672` re-said); `web/src/protocol.ts` (`RunRequest`'s
  `scratch` `:537-546`; the `scratch-compiled`, `tm-scratch-compiled`, `rxm-scratch-compiled` and `rxm-value` replies
  `:769-870`; docs `:145`, `:257-262` (`CopyLeg` stays, the recorded legs' type), `:760-767`); `web/src/copy-build.ts`
  (`CopyCompiled`, `CopyBuild`, `buildCopy` `:66-124`; `Occupant`'s scratch arm `:45`; `liveHandle`'s copy branch
  `:62-63`; docs `:1-6`, `:21-31`, `:47-54`); `web/src/session-client.ts` (`scratch()` `:105-118`; `unbind` `:318-339`;
  docs `:186`, `:226-227`, `:262-263`, `:306`); `web/src/sessions.ts` (`RxmScratchReading`, `TmScratchReading`,
  `LegReading` `:116-132`; `detached` `:160-174`; `readings` `:201-205`; `remove` `:378-391`; the import `:12`; docs
  `:91-93`, `:177-200`, `:234-251`, `:330-350`, `:447-462`); `web/src/types.ts` (`ReductionStatus` `:48`,
  `TmScratchStatus` `:63`, `ValueRun` `:32`, `:67`, and `ValueReading` `:124-130` if nothing reads it);
  `web/src/legs.ts` (docs `:22-23`, `:37`, `:52-55`; `COPY_LEGS` stays)
- Delete: `web/src/scratch.ts`; `web/tests/node/scratch.test.ts`, `wasm-vocabulary.test.ts` (ruling 14)
- Test (cut): node `replies.test` (`scratchDriver` `:403-549` and the import `:10`; `:552-726`, `:737-760` and what is left of
  `:807-958` out; `CASES`' `onScratchReply` half `:973`, `:1015-1024`; `:1128-1142` on the program's rxm chunk through
  `driver`; `:1162-1176` one switch; `:1178-1267` out; `:1269-1289` without `text`; `:1292-1349` out; `:82`, `:90`, `:143`;
  docs `:54-63`, `:117`), `sessions.test` (the imports `:7`; `:51`, `:75`, `:79`; `:137-146`'s `remove`; the `detached` flags),
  `session-pool.test` (`:89-98`, `:108-196` out), `session-client.test` (`:322-365` out), `copy-build.test` (to the `claimLive`
  case `:143` and `liveHandle`'s `:222` without its copy rows, ruling 11); browser `pool-isolation` (`:158-160` terminate the
  workers; `:163-199` out; `:30-32`, `:38-39`), `session-memory` (`:2`, `:481-486`, `:496-524`, `:556-560`, `:573`: 3 becomes 1;
  `:97-103`, `:175-187`), `worker` (`COPY_BUILT` `:7-12`, `builtFirst`'s scratch arm `:15-22`, `:62-63`, `:474`), `record-cost`
  (`Compiled`'s copy kinds `:109-112`, `COMPILED_KINDS` `:139-144`, `firstLegs` `:151-156`; (h)'s `scratchpad` `:402`, `:19`,
  `:374-375`; `COPY_LEGS` uses stay), `view-title` (`:262-264`, `reg.remove`; `:232-234`), `step-controls` (`'the copy failed'`
  `:119-120`, `:364-365`, if `replies.ts:828`'s sentence goes); node `bindings-contract.test` (the `TmScratchStatus`
  import `:12` from `../../bindings/TmScratchStatus`, the generated type, since `types.ts` no longer re-exports it; the
  row `:57` stays for PR 2, which deletes the type)

**Interfaces:**
- Produces: one kind of session, the program's; no `ScratchBuffers`, `SessionClient.scratch`, `SessionPool.unbind`,
  `SessionRegistry.remove`, `SessionEntry.detached` or `.readings`, `onScratchReply`, scratch request or replies,
  `buildCopy`. `SessionRegistry`, `SessionPool`, `Binding.session`, `pairs()` and labels run over that one session until
  PR 3. The wasm's `lambdaScratchAt`, `tmScratch`, `rxmScratch`, `tmText`, `rxmText` and `tmResultDecodable` have no web caller.

**`AFFECTED-12`**: `BROWSER` on every browser file this task edits, `worker`, `recompile-swap`, `restart-rewind`,
`keystrokes-in-flight`, `view-title`, O1, O2, K1; `REDEXTAPE_PROBE=1` `record-cost` as Task 4's Step 4; `NODE` on the whole tier.

- [ ] **Step 0: Baselines** at Task 11's commit.
- [ ] **Step 1: The removal**, as the Files list says. No case is new: what goes has no caller in the app, and the
  program's session is held by every surviving file.
- [ ] **Step 2: `SWEEP-12`.** And `rg -n "lambdaScratch|tmScratch|rxmScratch|tmText|rxmText|tmResultDecodable" web/src web/tests`:
  nothing.
- [ ] **Step 3: Run green**, as Task 3's Step 5.
- [ ] **Step 4: Sabotage**, `$L/12-sab-driver.mjs`: **S1** `SessionPool` spawns a second worker for the program's session
  on its first rebind (the pool's one-session path): `pool-isolation`'s and `session-pool.test`'s surviving cases, from
  their docs; **S2** `claimLive` lets a second occupant in: `copy-build.test.ts`'s `claimLive` case.
- [ ] **Step 5: The commit and the report** (`$L/task-12-report.md`).

### Task 13: The languages: one grammar and one LSP language in the web app

**Files:**
- Modify: `web/src/colour.ts` (the λ, rxm and TM grammar imports `:10-15`; `SOURCES` `:87-92` to `redextape`'s; `createGrammarRegistry`
  generic in its key, ruling 13, `:117-150`; `COLOUR_CEILING_UNITS`' doc `:59-77` re-said for the source editor, its value
  6,100,000 kept (call d); docs `:20-27`, `:105-106`, `:111-112`, `:298-300`, `:306-309`; `ColourOptions.languageId` `:329` and
  `onCeiling` `:340` as `LanguageId` falls); `web/src/lsp-protocol.ts` (`LANGUAGE_IDS` `:79` to `['redextape']`; `LANGUAGE_OF_PANE`
  `:83-100` out; `LANGUAGE_LABEL` `:116-121` and `EXTENSION_OF_LANGUAGE` `:124-129` to `redextape`'s; the `PaneKind` import `:17`;
  docs `:11-14` (the contract's direction: every id the app sends is one the server matches), `:112-114`, `:134-135`);
  `web/src/outline.ts:8-15` (the table to `redextape`); `web/src/lsp-worker.ts:13-16`; `web/src/lsp-client.ts` (docs `:302-305`,
  `:370-371`); `web/src/main.ts:651` (the capture tables to `redextape`'s; the wasm's `captureClasses` stays);
  the grammar READMEs' paragraphs that say `colour.ts` loads them, so that no commit has them say what the site no
  longer does: `grammars/README.md:19-21`, `grammars/tree-sitter-redextape-tm/README.md:12-15` and
  `tree-sitter-redextape-rxm/README.md:14-17` (they colour external editors only),
  `grammars/tree-sitter-redextape-lambda/README.md:70-75` (the λ copy editor and its lane's reasons out, `:75-78` kept)
- Test: node `lsp-protocol.test` (`:18-27` to *every id the app sends is a language the server matches*,
  `arrayContaining` over the server's arms; `:29-38` without `LANGUAGE_OF_PANE` and the `KIND_ORDER` import `:4`, the extension
  check kept; `:41-53` on `redextape`), `colour.test` (the import `:19`; `:47-49`'s title (call d); the TM-grammar suite
  `:371-863` and the broken-grammar case `:917-958` through the generic registry with their own ids; `:960-982` its own
  list), `lsp-client.test` (`:148`, `:235`: the second document `redextape`); browser `grammar-differential` (its own four ids
  and type for `:14`, `:87`; `SOURCES` `:62-75` and `load` `:119` through the generic registry `:105-111`; `:178-188` *covers every
  grammar the repo ships*; the `.wasm` imports `:4-11` and `captureClasses` `:12` stay), `colour-slices` (`:89-91`, `:106`: the TM
  grammar through `sources`; `:16-18` as Task 5 left them); browser `lsp-diagnostics` (L1)

**Interfaces:**
- Produces: `LanguageId = 'redextape'`; `createGrammarRegistry<K extends string = LanguageId>(opts: { onFailure: (id: K,
  reason: string) => void; onRuntimeFailure: (reason: string) => void; sources?: Record<K, GrammarSource>; initRuntime?:
  () => Promise<void> }): GrammarRegistry<K>`, whose `load(id: K)` reads `opts.sources` when given and `SOURCES` otherwise; no
  `LANGUAGE_OF_PANE`.

**`AFFECTED-13`**: `BROWSER` on `grammar-differential`, `colour-slices`, `colour`, `lsp-diagnostics`, `lsp-hover`, `lsp-outline`,
`lsp-restored-panel`, `outline`'s files (`rg -l "outline" tests/browser` narrowed to the source outline), O1; `NODE` on the
whole tier.

- [ ] **Step 0: Baselines** at Task 12's commit; and `pnpm run build:app` into `$L/13-build-base.log` with
  `ls dist/assets | rg 'tree-sitter'` into `$L/13-assets-base.txt` (expected: four `tree-sitter-redextape*` grammars).
- [ ] **Step 1: The case, new.** **L1** in `lsp-diagnostics.test.ts`, or a browser file of its own that mounts the app
  (G5): *the app opens LSP documents only in redextape*: a spy on `LspClient.prototype.openDocument`, set before `main`
  is imported, records at least one call, each with the `languageId` `redextape`, once the first compile is in and the
  λ, TM, rxm and clif views have each been shown. It asserts what the app does, not `LANGUAGE_IDS`. It passes at the
  task's start, Task 10 having taken the last editor in another language; S1 shows it can fail.
- [ ] **Step 2: The change**, as the Files list says.
- [ ] **Step 3: `SWEEP-13`**, and the build: `pnpm run build:app` into `$L/13-build.log`, `ls dist/assets | rg 'tree-sitter'`
  into `$L/13-assets.txt`. Expected: the `redextape` grammar and the `web-tree-sitter` runtime, no `-lambda`, `-rxm` or `-tm`
  grammar (the design's inference, settled here). `dist/` is the build's own output and stays untracked.
- [ ] **Step 4: Run green**, as Task 3's Step 5.
- [ ] **Step 5: Sabotage**, `$L/13-sab-driver.mjs`: **S1** the source document opened in another language (`main.ts`'s
  `openDocument` call given `'redextape_tm'`): L1 at the `languageId`; **S2** `LANGUAGE_IDS` given an id the server does
  not match (`'redextape_x'`): the subset case at the id; **S3** `SOURCES` given the TM grammar back, its `?url` import
  and its entry in one hunk: Step 3's asset list holds `-tm` (a build, not a test: the driver runs `build:app` and the
  `ls`).
- [ ] **Step 6: The commit and the report** (`$L/task-13-report.md`).

### Task 14: The pages, the docs, the scripts' examples and the last words

**Files:**
- Modify: `web/help.html` (the `<li>` `:54-57` out; `:66` the source editor's keys; `:72-74`'s third cell *the source
  editor*; `:79-80` without the λ copy's editor, the sentence after it re-said; `:145` if it reads wrong);
  `web/privacy.html` (`:24`, `:58`, `:59`: the editor, singular); `README.md` (`:24` out; `:29-31` the server and the
  `.rxt` grammar); `docs/architecture.md` (`:12-14`, `:22-24`); the grammar READMEs, re-read after Task 13's paragraphs;
  `scripts/check-attributions.sh` (the examples `:101-102`, `:118-130`, `:286-287`, `:292-294`, `:309`, `:330` re-said
  on code that survives, `$R/pr1/survey-srcViews.md` Q5's table); `scripts/comment-budget.json` if the guard asks; any
  file the last sweep finds
- Test: node `pages.test.ts` where it reads a changed line (the keys `:58-78`)

- [ ] **Step 0: Baselines** at Task 13's commit: `NODE` on the whole tier; `scripts/check-attributions.sh --self-test`.
- [ ] **Step 1: The pages and docs**, as the Files list says. The words say what the site does; no sentence says that
  copies existed, but one: `privacy.html`'s `redextape.buffers` row says what the key held in earlier versions (Task 3),
  since a privacy page describes the data a key held. `README.md` keeps Davey's style (*README as a project page*): no
  new section.
- [ ] **Step 2: `check-attributions.sh`'s examples** re-said; `--self-test` and then alone: exit 0.
- [ ] **Step 3: The last sweep**, into `$L/14-sweep.log`: every row of the sweep table (all tasks), and `rg -n -i
  '\bcop(y|ies)\b|scratch|detach' web/src web/index.html web/help.html web/privacy.html web/about.html scripts README.md
  docs/architecture.md grammars --glob '!*.wasm' --glob '!*.json'`: each hit left is the *copy link* button, a clipboard
  copy, a plain-sense copy (a value copied, a second instance), `CopyLeg`/`COPY_LEGS`, the λ view's *detach following*,
  Step 1's `privacy.html` row or a Rust comment PR 2 owns; the log lists each with its reason. Any other is put right
  here.
- [ ] **Step 4: Run.** `NODE` whole tier, `COVERAGE` and `BROWSER` on the files edited if a `web/src` or `web/tests` file
  changed, `LINT`, `TSC`, `COMMENTS` (the whole branch's budgets: each area's figure beside its
  budget; a budget written down says so), `ATTR`, and every pre-commit scan with `--self-test` and then alone.
- [ ] **Step 5: The commit and the report** (`$L/task-14-report.md`).

### Task 15: The full gate, Firefox, and the pass by hand

**Files:** none unless a leg fails. One agent, with no other browser run on the machine.

- [ ] **The web job as CI runs it**, from `$W/web` with `CARGO_TARGET_DIR=$T`: `pnpm run build:wasm`, `build:lsp-wasm`,
  `build:clif-wasm`, `build:bindings`, `../scripts/check-licences.sh --self-test` and then alone, `LINT`, `TSC`, `COVERAGE`,
  `pnpm run build:app`, each into `$L/15-<leg>.log`. Expected: exit 0 each.
- [ ] **The scans**, from `$W`: each `rg -o 'scripts/check-[a-z-]+\.(sh|mjs)' .forgejo/workflows/ci.yml | sort -u` lists, with
  `--self-test` and then alone; `COMMENTS`.
- [ ] **The Rust legs, since the branch changes Rust** (ruling 15): `git diff --name-only b627fe3..HEAD -- crates
  Cargo.toml Cargo.lock` into `$L/15-rust-diff.txt`. Expected: `crates/redextape-wasm/src/session.rs` alone, and its
  `git diff -U0` holding comment lines only; any other path or line is a finding. The Rust legs run, all of them:
  `cargo llvm-cov nextest --workspace --fail-under-lines 90`, `scripts/check-slow.sh` and `scripts/check-all.sh`'s
  cargo legs, beside its web and scan legs.
- [ ] **Firefox** on every browser test file the branch edited or created (`git diff --name-only --diff-filter=AM
  b627fe3..HEAD -- web/tests/browser | rg '\.test\.ts$'`) into `$L/15-firefox.log`: the baseline's failures in those files
  and no other.
- [ ] **By hand in Firefox**, driven as the last lane's pass was (`/home/davey/temp/redextape-panels-row-record/impl2/08g-hand.zsh`:
  `vite build` into `$L/hand/dist`, `vite preview` on a free port from 4391 to 4399 under the browser lock;
  `…/impl2/hand-8/drive.mjs` the model for `$L/hand/drive.mjs`), screenshots in `$L/hand/`. At 1280 by 896 and at 390 by
  844: the header holds no `copies ▾`; the ⋯ menus of the λ, TM and rxm views hold no *edit a copy*, *move the editor
  here* or *format*, and the source view's holds *format*; the TM and rxm views show no text or outline panel; with
  `redextape.buffers` seeded and the page reloaded, the key is gone and every view reads `· program`; with storage
  refused, *hide* on the storage sentence puts the focus on *settings*. Expected: no page error. Davey tries the branch
  in Firefox before giving the word to push.
- [ ] A leg that fails is fixed in a commit of its own, test first, and the legs its files feed run again.
- [ ] **Report** in `$L/task-15-report.md`: each leg's exit, the tallies, the coverage row against `$L/00-coverage.log`,
  the pass's findings.

### Task 16: The roadmap entry, and the design's *As built*

**Files:** `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, appended after the last entry (`remove-plus-view`'s,
from `:40644`), in its shape; `docs/superpowers/specs/2026-11-23-remove-copies-design.md`, a closing section *As built*.

- [ ] **The heading**: a `####` line in capitals saying what the branch does, with the dates, the branch `remove-copies`,
  the code commits' SHAs on `b627fe3` and the docs commits.
- [ ] **The paragraphs**: what changed for a person (no copies: no `copies ▾`, no *edit a copy*, no copy editors, no
  text or outline panel in the λ, TM and rxm views, no ⋯ *format* or *move the editor here* there, no `copy · not
  linked`; the key removed at start-up; the notice line's focus falls to *settings*); **the IR views' CLIF copies and
  LLVM copies are withdrawn with copies, and the next IR piece is machine code** (Q3;
  `2026-10-27-ir-views-groundwork-design.md` §9, `2026-11-18-clif-view-design.md:28`); the rulings of *Global
  Constraints*; what PR 2 takes (the Rust exports and `session.rs` code, `probe.rs`, the features
  `probe-no-tm-scratch-ceiling` and `probe-rxm-copy` with `check-all.sh:168-176`'s legs, the three wire types and their
  bindings, and every Rust comment that cites a web file this branch deleted: the sweep's last two rows' `crates/`
  files, re-run and listed, but the three ruling 15 re-said); what PR 3 takes (the one session: the registry, pool,
  `Binding.session`, `pairs()`, labels and `· program`, and `split`'s `choice.session`; `rebind`'s same-leg branch for a
  second session went in Task 9, ruling 12); the images retaken after the merge, and the NAS upload waiting for Davey's
  word (Q2); the tests (files deleted, cases deleted, moved, added, each counted by command); the lines `web/src` lost
  and gained (`git diff --numstat b627fe3 -- web/src`); the coverage rows at `b627fe3` and at the head; the sabotages
  and their logs; the gate and the pass by hand.
- [ ] **Every count this entry quotes, with what produces it**: a table in the last entry's shape, every row run after
  the last code commit into `$L/16-figures.log`. Values and SHAs, not "the only" or "all".
- [ ] **The design's *As built***: what was built otherwise than the design says, each a line pointing at the plan's
  ruling or *Verified facts* (the task split, `focus-draw.ts`, the four files kept and the three added to the deletions,
  `data-describes`, `#settings`, the three Rust comments re-said, `rebind`'s same-leg branch, the corrected facts).
- [ ] **Commit** both; the hook's scans, `check-doc-figures` among them, pass. Report `$L/task-16-report.md`.

### Task 17: A review of `b627fe3..HEAD`

- [ ] A fresh reviewer (opus) reads the design, this plan and `git diff b627fe3..HEAD`, and writes `$L/review.md`: findings
  by severity, each with its file and line and the input that shows it. It asks in particular: does any code only
  copies reached remain in `web/` (the sweep's rows, `rg -i 'cop(y|ies)|scratch|detach'`), and did any code the program's
  views use go (the source editor's *format*, splits, the Stage, the title menu, the notice line's actions, the
  recording's `CopyLeg`); can a share link, stored workspace, remembered arrangement or stored program from before the
  change fail to load or open a view on anything but the program; can ↺, a focus move or a press on a TM, rxm or clif
  view throw now that they hold no editor; does a moved case pass without reaching what it holds (a sabotage that
  fired elsewhere, a *from its doc* sabotage that is weak); does a comment hold history or a measurement; is every
  page's sentence true.

### Task 18: The review's fixes

- [ ] Each finding is checked before it is acted on: a finding is a claim. One that holds is fixed test first, in a
  commit of its own, with a sabotage where it adds a test, and its class is searched for siblings. One that does not
  hold is answered in `$L/review.md` with the evidence.
- [ ] Then Task 15's legs for every file the fixes touch (all of the web job if a file under `web/` changed), Firefox on
  the browser files they touch, and a commit that brings the roadmap entry up to the fixes, its figures run again.
- [ ] **Report** the head SHA and the tallies in `$L/task-18-report.md`. **Stop there**: pushing and opening the pull
  request wait for Davey's word.
