# Remove copies — design

**Date:** 2026-11-23. **Status:** approved 2026-11-23. **Base:** branch `remove-plus-view` at `5b5ef1f`
(`main` at `b32af3d` plus PR #195, which merges before this work starts). Every `file:line` below was read at
`5b5ef1f`, in the worktree `~/temp/redextape-remove-plus-view`.
**Surveys:** `~/temp/redextape-remove-plus-view-record/copies-extent-survey.md` (the whole feature, its §8 split and
its §9 decisions D1-D6) and `copies-survey.md` (the `copies ▾` menu), both taken at `f3b2bd3`. Every fact used here
was checked again at `5b5ef1f`; what had changed is under *Survey facts corrected*.

## Intent

On 2026-11-23 the user said: "I don't really want copies anymore as things stand. maybe they can be introduced later
again, however the site is pretty cluttered as is, and I think the main usage of the site right now is just explore
the different compilations of the source code. copies only really makes sense if the site is a better editor of these
other things, and would need essentially an entirely second page/view to do this." Earlier, of the feature: "it's
kinda confusing what it does".

The aim is a site that shows the program's compilations and has nothing in it for editing them. The whole copies
feature goes, not only `copies ▾`. Nothing is kept so that copies can come back; the history holds them.

## Today

A copy is the λ term, Turing machine or rxm program of the program's view, taken out as text, edited in an editor
inside the view and run in a session of its own.

- **Made** by ⋯ *edit a copy* on a λ, TM or rxm view (`web/src/view-header.ts:560`; `transport.ts:203` `forkCopy`,
  `:248` `programFork`): λ from the step shown, TM and rxm from the whole program at step 0, disabled for a TM over
  `MAX_FORK_RULES` (`protocol.ts:479`). Blank, by *new TM copy* and *new rxm copy* in `copies ▾` (`index.html:29`,
  `buffer-list.ts`).
- **Edited** in a CodeMirror editor (`scratch-editor.ts`, which the TM and rxm views reach through `copy-editor.ts`),
  coloured by its own grammar and served by the browser LSP in `redextape_lambda`, `redextape_tm` or `redextape_rxm`
  (`lsp-protocol.ts:79`, `:94-100`). The editor sits in a *text* panel, and a TM or rxm view adds an *outline*
  panel; both exist only while the view holds a copy (`machine-view-chrome.ts:89-111`, `lambda-pane.ts:336-352`,
  `pane-chrome.ts:269` `textPanel`). The view's ⋯ *format* and *move the editor here* serve that editor
  (`view-header.ts:569`, `:578`; `lambda-pane.ts:251`, `machine-view-chrome.ts:65`).
- **Run** in a session and worker of its own: `ScratchBuffers` (`scratch.ts`, 1,045 lines) adds a registry entry
  with `detached: true` (`scratch.ts:699`); at most `MAX_WARM_BUFFERS = 8` run at once (`scratch.ts:153`).
- **Shown as a copy**: `copy · not linked` in the view's title (`view-header.ts:114`), title-menu pairs such as
  `λ · copy 1` (`view-header.ts:28` `pairLabel`), a copy row in the readout (`readout.ts:258` `copyRow`), the link
  line's "shows a copy" sentences (`link-status.ts`), the share popover's "copies are not included"
  (`share-popover.ts:43-53`), the storage line's "copies are not being saved" (`unsaved.ts:33`), and notices.
- **Listed, deleted with an undo, paused and resumed** only in `copies ▾`.
- **Stored** in `localStorage` under `redextape.buffers` (`buffers-store.ts:23`, version 2 at `:33`), with every view's
  binding to a copy (`layout.ts:13-16`), and restored at start-up (`main.ts:1614`). `privacy.html:51` lists the key
  as "your copies' text".

Copies are also why the app has more than one session. `SessionRegistry` (`sessions.ts:340`), `SessionPool`
(`session-client.ts:243`), `Binding.session` (`sessions.ts:221`) and the title menu's (leg, session) pairs exist so
that a second session can be reached (`main.ts:857-858`).

Size, from the extent survey: about 7,000 of `web/src`'s 41,204 lines (an estimate), 70 test files that go whole
(15,854 lines, counted at `5b5ef1f`) and about 70 more that lose cases, and about 2,600 lines of Rust (an estimate).

## Goals

- **G1.** No copy can be made, edited, seen, stored or restored. Every piece under *Today* goes: ⋯ *edit a copy*;
  `copies ▾` with its *new TM copy* and *new rxm copy*, delete, undo, pause and resume; the copy editors; the *text*
  and *outline* panels of the λ, TM and rxm views; those views' ⋯ *format* and *move the editor here*;
  `copy · not linked`; the copy pairs, rows, sentences and notices; the warm-copy cap.
- **G2.** The app removes `redextape.buffers` from `localStorage` at start-up, and `privacy.html` says that it does.
- **G3.** A share link, stored workspace, remembered arrangement or stored program made before the change loads,
  including a workspace that holds state for the panels that went, and its views open on the program, as a link's
  views open today.
- **G4.** Code that only copies reach goes in the PR that removes its last caller, with its tests: the web code in
  PR 1, the Rust and wasm code in PR 2. PR 3 narrows the multi-session code that the one program session still runs
  through.
- **G5.** The web app loads only the `redextape` grammar and opens LSP documents only in `redextape`.
- **G6.** `help.html`, `privacy.html`, `README.md`, `docs/architecture.md` and the four grammar READMEs say what the
  site does now, and each PR has its roadmap entry. After PR 1 merges, the README's `demo.webp` and the portfolio's
  `full.webp` and `card.webp` are retaken (they still show `+ view` and `copies ▾`); the upload to the NAS waits for the
  user's go-ahead (Q2). PR 1's roadmap entry records that the IR views' CLIF copies and LLVM copies are withdrawn (Q3).

## Non-goals

- **The grammars, the native LSP and the Rust core stay.** The grammars are shipped for Neovim, Helix and Zed
  (`grammars/README.md`), held by the `redextape-grammar-check` crate and `grammars/capture-golden.json`, and checked
  in the browser by `web/tests/browser/grammar-differential.test.ts`, which imports the four `.wasm` itself
  (`:5-11`). `redextape-lsp` keeps all four languages (`crates/redextape-lsp/src/language.rs:39-41`), and
  `redextape-lsp-wasm` serves what it serves today. The core's parsers and printers stay (the CLI's `fmt`, `emit` and
  `run` and the LSP use them), and so does `TmProgram::of`'s `Option<&SourceMap>`
  (`crates/redextape-core/src/viewmodel.rs:533`), library behaviour its own tests use.
- **No change to the program's views** beyond removing what serves copies: steps, links, the other panels, splits,
  the Stage, the toggles, the keys, the presets, the source editor and its own ⋯ *format* (`main.ts:1148`).
- **Nothing replaces copies**, and nothing is kept for bringing them back.
- **The return-value highlight** is a separate lane, being brainstormed in parallel. It will conflict with PR 1 in
  view code (`lambda-pane.ts`, `tm-pane.ts`, `rxm-pane.ts`, `draw.ts`, `replies.ts`); whichever merges second rebases.
- **History documents under `docs/`** (specs, plans, notes and past roadmap entries; the extent survey counts 58 that
  name copies) stay as they were written.

## Anti-goals

- A visible change to the program's own views beyond removing copy UI, and, in PR 3, dropping `· program` from titles
  (*Settled by the user*, Q1).
- A share link, workspace or stored program from before the change failing to load.
- Unreachable or untested code on `main` after a PR. The user's split allows two kinds between PRs and no others:
  the copy-only Rust exports PR 1 stops calling, still tested in Rust until PR 2 removes them; and the multi-session
  generality (a registry, a pool, bindings and caches that hold one session) that runs until PR 3 narrows it. A
  function, field or branch whose every caller, reader or taker is a copy path is not generality: it goes in PR 1.
- A PR, or a commit inside PR 1, that leaves stored copies the UI restores but cannot end.

## Constraints

- **Coverage**: the web thresholds are `lines 97, functions 97, branches 89, statements 95` (`web/vite.config.ts:524`);
  Rust `llvm-cov` is held at 90 %. A PR that removes an entry point removes what only it reached, and that code's
  tests, in the same PR.
- **The pre-commit gate on every commit** (`.pre-commit-config.yaml`): the text, citation, attribution, doc-figure,
  shared-doc, colour, grammar-wasm, licence and comment scans, `cargo fmt`, `clippy -D warnings`, `biome ci` and the
  web typecheck. Each of PR 1's tasks leaves a working app and passes it. The comment scan makes a commit write an
  area's budget down (`scripts/comment-budget.json:12-15`) when its share falls more than `STALE_UNITS = 50` units
  below it (`scripts/check-comments.mjs:466`).
- **A roadmap entry per PR** in `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, written before the PR opens.
- **The deleted-symbol sweep per PR**: every symbol and file the base declared and the PR deletes is searched for in
  `web/`, `scripts/`, `crates/`, the pages and the docs that are not history. `check-attributions.sh` catches part
  of it (a possessive citation of a symbol the cited file does not declare); `check-citations.sh` rejects only
  `file:line`; a file or test named in prose passes both. The extent survey counts 58 citations of PR 1's deleted
  files in surviving code; one example is `protocol.ts:102-103`, which quotes a figure that
  `buffer-affordability.test.ts` prints.
- **Docs**: G6. A comment that loses its reason to the removal is re-said with a reason that holds, or goes; no comment
  records what copies did (the project's rule: comments hold the why).

## Approaches

Put to the user on 2026-11-23:

1. **Three PRs in order**: the web removal; then the Rust and wasm code only copies used; then the one-session
   refactor, with no visible change (since settled: it also drops `· program`, Q1). **Picked.**
2. One web PR per view (rxm, TM, λ, then the shared machinery). Each is smaller, but each must teach stored-state
   loading to drop its leg's copies, and `copies ▾` survives to the last. More work in total. **Rejected.**
3. The web and Rust removals in one PR. **Rejected**: too large to review.

For the multi-session plumbing (the extent survey's D3), the user chose to strip it in PR 3 over keeping it with one
session.

## Decided

- **By the user, 2026-11-23**: remove the whole feature; approach 1, with PR 1 planned as about six tasks that each
  leave a working app and pass the pre-commit gate; PR 3 strips the multi-session plumbing.
- **Controller calls, stated to the user without objection:**
  - **a.** The app deletes `redextape.buffers` at start-up, and `privacy.html` says so.
  - **b.** The web app stops loading the λ, TM and rxm grammars and stops using the browser LSP's three non-source
    languages. The grammars stay in the repo and the native LSP keeps them. Where each piece goes: PR 1, under
    *Languages*.
  - **c.** The state diagram's name-only and flat groupings and the "no program level" reason go only if no compiled
    program can reach them. None can (*Checks*), so they go in PR 1.
  - **d.** `COLOUR_CEILING_UNITS` keeps its value, 6,100,000 (`colour.ts:78`). Its comment's reason, a TM copy's size
    ceiling (`colour.ts:59-77`), is re-said with one that holds for the source editor alone.
- **This design's calls**, each following from the anti-goals:
  - **`SessionEntry.detached` goes in PR 1, not PR 3.** Every reader of it is a guard that says a copy is not linked:
    `draw.ts:157`, `:234`, `:320`, `transport.ts:290`, `link-wiring.ts:137`, `:254`, `sessions.ts:688`. With the
    guards gone nothing reads the field. For the same reason `SessionRegistry.remove` (`sessions.ts:389`) and
    `SessionPool.unbind` (`session-client.ts:334`) go in PR 1: their only callers are `scratch.ts:545-546`.
  - **`scripts/emit-probe-reduced-files.sh` goes in PR 1, not PR 2.** Its only caller is `web/package.json:23`'s
    `test:probe:tm-buffer`, which PR 1 removes.
  - **The `privacy.html` row for `redextape.buffers` stays, reworded** to say the app deletes the key when it starts:
    `web/tests/node/pages.test.ts:179-187` holds the storage table to every `redextape.*` literal in `src/`, and the
    start-up removal names the key.
  - **The removal runs at every start-up**, not once behind a stored flag: a tab still running the previous build can
    write the key again. Its failure is silent, as a failed storage read is today (`main.ts:1205-1210`).

## Checks behind this design

### The state diagram's name and none tiers (call c): unreachable without copies

`tierOf` (`web/src/state-groups.ts:76-80`) groups by `instr` if any state carries an instruction, by `name` if any
state's name has a dot, and otherwise answers `none`. Every machine the TM view can show without copies carries an
instruction on its start state:

1. Without copies, the TM view's machine is the session's TM leg. `Session::compile_with_caps`, behind `compile` and
   `compile_at` (`session.rs:605-629`), projects it with `build_tm_leg(&header, …, Some(&map))`
   (`crates/redextape-wasm/src/session.rs:722`). The two other projection sites pass no map and are the scratch's
   (`session.rs:1704`, `:1711`).
2. The map is built from the same lowered program as the run (`session.rs:663`, `:709`;
   `crates/redextape-core/src/sourcemap.rs:123-127`) at the width the kept run ran at, auto-fitted or pinned
   (`session.rs:666`, `:708`). Its TM half lowers that program again with `lower_tm_mapped` (`sourcemap.rs:286`), the
   one lowering behind the run's machine (`crates/redextape-core/src/tm/lower_tm.rs:362-365`), and records an
   instruction for every state the lowering bills to one (`sourcemap.rs:299`).
3. `TmProgram::of` gives each state `map.tm_instr(name)` as its `instr` (`viewmodel.rs:533-541`).
4. Every lowered program has at least one instruction: `lower_rxm_mapped` always emits a final `Halt`
   (`crates/redextape-core/src/tm/lower_rxm.rs:152`). The TM lowering makes one entry state `pcN` per instruction
   (`lower_tm.rs:208`) and bills each to its own instruction (`lower_tm.rs:274-279`), so the start state carries
   `instr: 0` (pinned by `lower_tm.rs:1025`).
5. `session.rs:4635-4717` asserts, over a corpus at auto-fitted and pinned widths, that every state's `instr` is the
   lowering's own origin for it.

So the `name` and `none` tiers are reached only by a machine with no map: a TM copy, or a reduced file pasted into
one. `viewmodel.rs:529-530` says the same of `None`.

**PR 1 removes them**: `tierOf`'s two lower arms and the `Tier` members they return (`state-groups.ts:7-12`, `:76-80`),
`reorderByReach` (`:182-219`, used only for `name`, `:136`), `programRows`' branch for them
(`web/src/program-level.ts:39-42`), the *program* choice's disabled reason "this machine has no program level"
(`tm-pane.ts:240-253`), `StateDiagram.shown`'s arm for them (`state-diagram.ts:349-362`), and their cases, among them
the `FLAT` and `DOTTED` machines of `state-diagram-local.test.ts:28-30` and `state-groups.test.ts`' cases on the
`COPY` machine (`tests/node/tm-machines.ts`).

**What stays**: the "no machine at all" case (`setProgram(null)`), which `state-diagram.ts:356-358` already keeps
apart from the third tier and `state-diagram-no-machine.test.ts` tests; `segmentOf` and `stepOf`, which the `instr`
tier uses for the runtime routines (`state-groups.ts:124`); and the guard test `isGuard` (`:54-61`), whose stated reason
is a hand-written machine (see *Left to the builder*).

### A stored workspace holding *text* or *outline* panel state: loads

Read, not run.

- **It parses.** `parsePanels` and `parsePanelSizes` (`web/src/workspace.ts:388-402`, `:405-419`) accept any panel
  name under a leaf that is in the tree; they refuse only a value of the wrong type, a share of 0 or less, or a leaf
  the tree does not hold. A share link's workspace goes through the same `parseWorkspace` (`share-link.ts:232`).
- **Nothing asks for the old names.** A view reads its panels' open state by name, for the names `LEG_PANELS` lists
  (`pane-host.ts:521`, `:532`; `panes.ts:43-48`), through `panelOpen` (`main.ts:1542`). Once `outline` leaves the TM and
  rxm lists (`panes.ts:45-46`), a stored `outline` entry under those leaves is read by nothing. The source view's own
  outline is stored under the source leaf (`main.ts:2981-2983`) and is untouched. A view's `PanelStack` reads shares by
  its regions' names (`panel-stack.ts:238`, `:248`), so a `text` or `outline` share is read by nothing either.
- **The *text* panel's open state was never in the workspace**: its toggle sets the copy's collapsed flag
  (`pane-chrome.ts:273`), which `redextape.buffers` stores. Only its share is in the workspace
  (`stored-panels-restore.test.ts:151` expects `rules` and `text`).
- **The old entries stay in the stored workspace** until their view closes: `withPanel` keeps a leaf's other names
  (`workspace.ts:283-284`), and so does a reset of a boundary (`panel-stack.ts:471`). They are inert.

PR 1 adds the test this was read for: a stored workspace, and a share link, whose TM and rxm leaves hold `outline` in
`panels` and `text` and `outline` in `panelSizes` load and draw their views' remaining panels as stored (beside
`stored-panels-restore.test.ts`, whose `:76-79` also loses `text` from every leg's expected list).

## PR 1 — copies out of the web app

### What goes

- **Pages and header**: `#buffers` (`index.html:29`) and `buffer-list.ts`; `help.html:55-56` (*edit a copy*,
  `copies ▾`), `:72-74` (F12, Shift-F12 and F2 "the source, and machine and rxm copies") and `:79` (a λ copy's
  editor); `privacy.html:51`, reworded (*Decided*); `README.md:24`; `docs/architecture.md:12-14` and `:23-24`; the
  grammar READMEs (`grammars/README.md:20-22`, `tree-sitter-redextape-tm/README.md:12-14`,
  `tree-sitter-redextape-rxm/README.md:14-16`, and `tree-sitter-redextape-lambda/README.md:70-74`, whose *What this is
  for* opens with the λ copy editor). The CSS that styles copies (the extent survey's §2.2 list, about 300 lines).
- **Views**: ⋯ *edit a copy*, *move the editor here*, and *format* on the λ, TM and rxm views (`view-header.ts:560`,
  `:569`; `lambda-pane.ts:251`, `machine-view-chrome.ts:65`); `copy · not linked` (`view-header.ts:114`); the *text*
  and *outline* regions (`machine-view-chrome.ts:89-111`, `lambda-pane.ts:336-352`, `pane-chrome.ts:269`) and
  `outline` in `LEG_PANELS` (`panes.ts:45-46`); the TM view's copy status and value line (`tm-pane.ts:97`, `:539`,
  `:548`); the rxm view's copy value (`rxm-pane.ts:196`).
- **Editors**: `scratch-editor.ts`, `copy-editor.ts`, `editor-custody.ts` and `editor-debounce.ts`, whole; the pane
  host's editor mounting and custody hooks.
- **Sessions and storage**: `scratch.ts` and `buffers-store.ts`, whole; in `main.ts` the scratchpad (`:857`), the
  copies' storage and restore (`:1205-1314`, `:1614`), the delete's undo, `copyHolds`, `refreshBuffers`, and the copy
  half of a link open's undo; `transport.ts`'s fork, detach and recompile and the editor deps it carries;
  `replies.ts`' copy replies; `detached` and its readers, `SessionRegistry.remove` and `SessionPool.unbind`
  (*Decided*); the copy rows, sentences and notices (`readout.ts:258`, `:321`; `link-status.ts`; `share-popover.ts:24`,
  `:43-53`; `unsaved.ts`, down to the program's writer); `copy-build.ts`'s `CopyCompiled`, `CopyBuild` and
  `buildCopy` (`:67-124`), while `claimLive` and `liveHandle` stay for the program's compile
  (`session-worker.ts:497`); `rxm-seed.ts` and `tm-seed.ts` down to the program's facts.
- **Worker and protocol**: the worker's scratch handles and requests, its value loop, and its reads of `tmText`,
  `tmResultDecodable` and `rxmText` (`session-worker.ts:127-140`, `:663-665`), with the import of `lambdaScratchAt`,
  `rxmScratch` and `tmScratch` (`:36`); in `protocol.ts`, the scratch request and replies, `MAX_FORK_RULES`,
  `ruleCount` and `forkable` (`:479-500`), `VALUE_CHUNK` (`:253`, a TM copy's value-run chunk) and the compiled
  replies' `text` and `tmResultDecodable`. The wasm exports stay, unused by the app, until PR 2.
- **The state diagram's `name` and `none` tiers** (*Checks*).
- **The notice line's default fallback** is `#buffers` (`main.ts:333`). The actions with fallbacks of their own keep
  them; an action left without one gets one, and if none is left the default goes.
- **`cut-text.ts`**: the `.buffer-row-term.is-absent` selector (`:21`) and the copy words in its comments (`:4`,
  `:9-10`, `:31`).
- **Probes and config**: the five probes and their eight helpers (extent survey §5); `web/package.json:21-24`
  (`test:probe:record` stays, `:28`); `PROBE_FILES`' five entries and their comment (`vite.config.ts:43-45`,
  `:67-77`); the `provide` stamps (`:377-383`) and their types (`tests/browser/provided-context.d.ts:13`, `:15`);
  `scripts/emit-probe-reduced-files.sh`.
- **Scripts**: `check-attributions.sh`'s examples drawn from copy code (`:101`, `:118-127`, `:292-293`, `:330`), re-said
  on code that survives; the `web/src` and `web/tests` comment budgets.

### Languages (call b): in PR 1

The copy editors are the only callers of `colourFor` with a language other than `redextape` (`main.ts:982` hands it to
`transport.ts`, whose `editorLanguage` reads `LANGUAGE_OF_PANE`, `transport.ts:33-34`), and the only openers of LSP
documents in the other three. Once they go, the three grammars' imports and `SOURCES` entries (`colour.ts:10-15`,
`:87-92`), `LANGUAGE_OF_PANE` (`lsp-protocol.ts:94-100`) and the other three entries of `LANGUAGE_IDS`,
`LANGUAGE_LABEL` and `EXTENSION_OF_LANGUAGE` (`:79`, `:116-129`) are reached by no path in the app.

The coverage gate would not catch them left behind: the registry loads a grammar on demand (`colour.ts:133`), so its
code is covered by the source's grammar alone, and table entries count as covered when the module loads. It is the
anti-goal on unreachable code that puts them in PR 1; in PR 3 they would sit unreachable on `main` for a PR. What moves
with them:

- `lsp-protocol.test.ts:26` asserts `LANGUAGE_IDS` equals the native server's match arms. The contract becomes "every
  id the app sends is one the server matches", which is the direction whose breach is silent (`lsp-protocol.ts:11-14`);
  `:29-38` loses `LANGUAGE_OF_PANE`.
- `grammar-differential.test.ts` takes its languages from `LANGUAGE_IDS` (`:14`, `:87`) and asserts the golden covers
  "every language the app colours" (`:186-188`). It keeps checking all four grammars, so it gets its own list and its
  own sources through `createGrammarRegistry`'s `sources` option (`colour.ts:122`), whose key type must then admit
  them. `tests/node/colour.test.ts:973` likewise.
- `main.ts:651`'s capture tables need only `redextape`'s; the wasm export `captureClasses` stays, since the
  differential test reads it (`:12`).
- `outline.ts:8-15`'s table of what each language answers, and `lsp-worker.ts:13-15`'s "from the scratch editors".
- **The colour ceiling (call d)**: `colour.ts:59-77` and `tests/node/colour.test.ts:48-50`'s title stop naming a copy.
  The new reason holds for the source editor alone and records no history.

The app build should stop emitting the three `.wasm` once their `?url` imports leave `colour.ts` (inferred, not
checked; the plan's pre-flight can read `dist/`).

### Tests

- **The 70 whole files** the extent survey lists in §5 go: 53 browser files, the 5 probes with their 8 helpers, and 4
  node files. All 70 are present at `5b5ef1f`. Before a file goes, each of its cases is read: a case whose subject
  outlives copies is moved to a surviving file and rebuilt on the program (a split for a second view), not dropped.
- **About 70 files lose cases** (survey §5 and §6), plus what #194 added after the surveys:
  `tests/browser/cut-text.test.ts`'s copies-list case (`:3`, `:27`, `:440-476`) and
  `tests/node/cut-text.test.ts:41-45`.
- **Tests that put a hand-written machine in the TM view through a copy**: the `FLAT` and `DOTTED` cases go with the
  tiers; `link-clear.test.ts` (`:36-37`, `:497-505`), `tm-grid.test.ts` (`:160-174`) and `hidden.test.ts` (`:30-41`)
  are reworked (*Left to the builder*).
- **New**: the start-up removal (a seeded `redextape.buffers` is gone after start-up, and start-up with storage that
  throws still loads, beside `storage-blocked.test.ts`); G3's stored workspace and share link (*Checks*).

### Order of the tasks

The plan fixes the boundaries; this order is proposed for two rules. Stored copies go first, so that no commit
restores a copy it can no longer end. Each task deletes the tests of what it removes, so the suites pass after every
task.

1. **Stored copies**: the start-up removal; nothing reads or writes `redextape.buffers` any more, bindings to copies are
   not restored, the storage line loses its copies half, and the `privacy.html` row is reworded. From here a copy lasts
   one page load.
2. **rxm copies**: the rxm view's *edit a copy*, *new rxm copy*, the rxm copy's editor, outline and value, and its
   worker path and probes.
3. **TM copies**: the TM view's *edit a copy* and its fork cap, *new TM copy*, the value run, the headerless and reduced
   sentences, the TM probes; the `name` and `none` tiers; the hand-written-machine tests re-seated.
4. **λ copies**: the λ view's *edit a copy*, the fork at a step, the *text* panel, editor custody.
5. **The rest of the machinery**: `copies ▾`, `scratch.ts`, the editors, `copy · not linked`, `detached` and its
   readers, the copy rows, sentences and notices, the share popover's line, the notice fallback, `copy-build.ts`'s copy
   half, the protocol's scratch request and replies, `cut-text.ts`'s selector, the CSS.
6. **Languages, pages and docs**: G5 and call d; the pages, README, architecture and grammar READMEs;
   `check-attributions.sh`'s examples; the comment budgets; the deleted-symbol sweep; the roadmap entry.

## PR 2 — the Rust and wasm code only copies used

- `crates/redextape-wasm/src/lib.rs`: `LambdaScratch` (`:87`), `lambdaScratch` (`:103`), `lambdaScratchAt` (`:131`),
  `TmScratch` (`:160`), `TmValueRun` (`:165`), `tmScratch` (`:207`), `RxmScratch` (`:235`), `rxmScratch` (`:248`), their
  impls (`:893-1108`), and `Session`'s `tmText` (`:552`), `tmResultDecodable` (`:564`) and `rxmText` (`:733`).
- `crates/redextape-wasm/src/session.rs`: `tm_text` (`:929`), `tm_result_decodable` (`:952`), `rxm_text` (`:1130`);
  everything from `Scratched` (`:1241`) to `TmValueRun`'s impl (`:1821-1894`), `MAX_SCRATCH_RXM_BYTES` (`:1341`),
  `COPY_CAPS` (`:1356`) and `MAX_SCRATCH_TM_BYTES` (`:1677`) among it; the scratch's calls into the TM projection
  (`:1704`, `:1711`), after which `tm_leg_at` (`:268`) has one caller, `build_tm_leg` (`:255`); the `without_map` test
  helper (`:1903`); the tests that name a scratch, a fork, a copy or a copy ceiling.
- `crates/redextape-wasm/src/probe.rs` (whole, and `mod probe` at `lib.rs:16-17`); the features
  `probe-no-tm-scratch-ceiling` and `probe-rxm-copy` with their comments (`Cargo.toml:27-45`) and their four legs in
  `scripts/check-all.sh:168-176`; the copy cases of `crates/redextape-wasm/tests/browser.rs`.
- `crates/redextape-wire/src/lib.rs`: `TmScratchStatus` (`:251`), `ReductionStatus` (`:278`), `ValueRun` (`:288`);
  their rows in `tests/ts_bindings.rs` (`:28`, `:44`, `:47`, `:49`);
  `web/bindings/{TmScratchStatus,ReductionStatus,ValueRun}.ts` and their rows in
  `web/tests/node/bindings-contract.test.ts`.
- Comments: the core's docs that name a copy or `TmScratch` as the map-less caller (`viewmodel.rs:529-530` and
  `TmState::window`'s doc) are re-said, since `None` stays as library behaviour;
  `crates/redextape-lsp-wasm/src/lib.rs:320-322` stops citing `rxm-copy.test.ts`, which PR 1 deletes, and its test
  stays. PR 1 leaves the Rust comments that cite web files it deleted to PR 2, which deletes or re-says them, and PR
  1's roadmap entry lists them.
- The `crates/redextape-wasm` and `crates/redextape-wire` comment budgets.

## PR 3 — one session

One visible change: view titles, title-menu items, split lists, Stage tabs and notices drop `· program`, so
`λ · program` reads `λ` (Q1), and the tests that read those titles (among them #193's, which reads every view's
title in all three styles) change with them. Each structure below runs, over the program's one session, after PR 1;
PR 3 narrows it to that one:

- `SessionRegistry` (`sessions.ts:340`) to the program session's state held directly; `SessionPool`
  (`session-client.ts:243`) to one worker;
- `Binding.session` (`sessions.ts:221`) and `PaneSlot`'s session (`sessions.ts:634-666`) to a leg;
- `SessionEntry.label` (`sessions.ts:158`) removed with `· program` (Q1);
- `pairs()` (`sessions.ts:494`) and the title menu's and the split lists' pairs (`view-header.ts:28`, `:133`, `:544`) to
  legs;
- the per-session `LambdaTrees` (`lambda-trees.ts:49`, `main.ts:933`) to one;
- what the pane host keeps of editor custody's shape after PR 1, if anything;
- the tests that assert those shapes (`tests/node/sessions.test.ts`, `session-pool`, `session-client`,
  `pool-isolation`) narrowed with them.

## Survey facts corrected at 5b5ef1f

- **#194 (cut-text tooltips, in `b32af3d`) added copy pieces the surveys do not list**: `cut-text.ts:21` watches
  `copies ▾`'s `.buffer-row-term.is-absent` ("no term yet"), with copy words at `:4`, `:9-10` and `:31`;
  `tests/node/cut-text.test.ts:41-45`; `tests/browser/cut-text.test.ts:3`, `:27`, `:440-476`.
- `help.html`'s lines moved down by one: `:55-56`, `:72-74`, `:79` (surveyed as `:54-55`, `:71-73`, `:78`). `main.ts`
  moved down by one past line 53 and by two past 1894 (#194's import and `watchCutText`).
- The extent survey's "of 72,634" lines and "~10 % of web/src": `web/src` holds 41,204 lines at `5b5ef1f` (all files),
  36,399 in `.ts`, so about 7,000 is about 17 %.
- The extent survey's "No gate catches a stale symbol citation" is too strong: `check-attributions.sh` holds a
  possessive citation to the file that declares the symbol. Whether it fails a citation of a file that no longer
  exists is not established here (*Left to the builder*).
- Two facts the surveys left INFERRED are now read: the `name` and `none` tiers are unreachable from a compiled
  program, and a workspace with the old panels' state loads (*Checks*).
- The extent survey's §8 puts `detached` in PR 3 and `emit-probe-reduced-files.sh` in PR 2; the anti-goals move both to
  PR 1 (*Decided*).

## Left to the builder

- **`MachineViewChrome`** (`machine-view-chrome.ts`, 191 lines) kept, shrunk to the header, the step strip and the
  bindings, or folded into `TmPane` and `RxmPane`.
- **How a test that loaded a hand-written machine through a copy gets one.** Rewriting it on a compiled program is
  preferred. A component-level fixture is allowed, as `panel-regions.test.ts:96-97` and
  `machine-view-chrome.test.ts:44-45` already build one (`new TmPane(host, events())`, then `setProgram`). No product
  code may exist only for tests.
- **`isGuard`**'s three-part test (`state-groups.ts:54-61`): its reason, a hand-written machine that names a working
  state `overflow`, no longer holds. Keep the test with a reason that does, or test the name alone.
- The notice line's fallback target, if one is still needed: a header control shown at every width.
- Where the start-up removal lives, now that `buffers-store.ts`, which holds the key's literal, goes.
- The exact boundaries of PR 1's tasks, and the wording of every re-said comment (call d included).
- Whether `check-attributions.sh` fails a citation of a deleted file: one sabotage in the plan's pre-flight settles
  how much of the sweep the gate does.

## Settled by the user (2026-11-23, every pick the controller proposed)

- **Q1. `· program` in view titles.** Every view title, title-menu item, Stage tab and view notice names the program's
  views as `λ · program`, `TM · program` and so on (`view-header.ts:28`); 23 files outside PR 1's deletions carry the
  string, 5 of them in `src/`. With no copies, `· program` tells nothing apart. **It goes, in PR 3**, where the title
  menu's (leg, session) pairs become plain legs; until PR 3 merges the titles keep it.
- **Q2. The README and portfolio images** are retaken after PR 1 merges, once for both removals (#195's `+ view` and
  this one's `copies ▾`); the controller asks before uploading to the NAS.
- **Q3. The IR views' §9 pieces "CLIF copies" and "LLVM copies"** (`docs/superpowers/specs/2026-10-27-ir-views-groundwork-design.md`
  §9, `2026-11-18-clif-view-design.md:28`) are withdrawn with copies; PR 1's roadmap entry records it, and the next IR
  piece is machine code. Copies, if they return, come back as a page of their own with a design of their own.
- **The two moves** (a controller call; the anti-goals decide it): `SessionEntry.detached` (with
  `SessionRegistry.remove` and `SessionPool.unbind`) to PR 1 from PR 3, and `emit-probe-reduced-files.sh` to PR 1 from
  PR 2. Each is code whose last caller or reader PR 1 removes.
- **Planning:** PR 1 is planned now; PRs 2 and 3 are planned after PR 1 merges, against the code it leaves.

## As built

PR 1, as built, differs from this design where the plan's rulings (*Global Constraints* in
`docs/superpowers/plans/2026-11-23-remove-copies.md`), its *Verified facts* or the controller's rulings during the build
(the lane's ledger) settled a point otherwise. PR 1's roadmap entry gives the build, its tests and its figures.

- **The task split.** The six steps under *Order of the tasks* became fourteen code tasks, mapped onto the steps out of
  order: step 1 is Task 3; step 2, Task 4; step 3, Tasks 5 to 7, with Task 1's moves; step 4, Tasks 9 and 10; step 5,
  Tasks 8, 11 and 12, with Task 2's moves; step 6, Tasks 13 and 14, and the roadmap entry. Tasks 1 and 2, which move
  tests, run before step 1, since a removal cannot move a case whose way in it has just taken, and Task 8, `copies ▾`,
  runs before step 4, between the TM and λ ways in (ruling 1, *Execution notes*). Each task was sized for one dispatch;
  from Task 9 each ran as two, the removal with its commit and then the wide runs and the sabotages, and so did Task 15,
  the full gate, while Task 16 ran as one; Task 17, the review of the whole branch, ran as four reviewers, each over a
  slice of the diff, and Task 18, its fixes, as three dispatches: the Important findings with the items the task reviews
  carried, the Minor findings, and the gate with the roadmap entry (the controller's rulings during the build).
- **`focus-draw.ts` went**, which *What goes* does not name: its reason, a focus move redrawing the readout or the
  inspector at another height, held only through a copy's view. Task 2 found no focus move on the program's views that
  changes the layout, so `focus-press.test.ts`, whose way in was a TM copy, went in Task 5 and the module with its
  wiring in Task 9 (ruling 10).
- **The 70 whole test files.** Four stay: `tests/node/copy-build.test.ts`, whose `claimLive` case holds code that stays,
  and `one-id-two-kinds.test.ts`, `one-id-two-kinds-stored.test.ts` and `parked-view-replaced.test.ts`, whose subject is
  layout. Three more go: `pane-chrome-text-panel.test.ts`, `editor-view-fixture.ts` and `copy-header.test.ts` (ruling
  11). `focus-press.test.ts` went too (ruling 10), and `copy-build.test.ts` became `claim.test.ts` when `copy-build.ts`,
  holding no copy build once the copies' sessions went, became `claim.ts` (the controller's ruling on Task 12's review).
- **`readout.ts`'s `data-describes` keeps two values**, the one that is not `program` renamed `none` rather than
  removed: it was written `copy` whenever `show` got no program, which the program's own first frames do, and the dim on
  a running compile must keep not applying there (ruling 8, *Verified facts*).
- **The notice line's default fallback is `#settings`**, not gone: *hide* on the resting sentence has no fallback of its
  own, so *What goes*' "if none is left the default goes" does not hold (ruling 4, *Verified facts*).
- **Three Rust comments were re-said in PR 1**, comment only, where *PR 2* leaves the Rust comments that cite web files
  PR 1 deletes: `crates/redextape-wasm/src/session.rs`'s possessive citations of `rxm-copy-corpus.ts`'s `CASES` and,
  twice, of `protocol.ts`'s `forkable`, which the attribution check fails once the file or the symbol is gone (ruling
  15, *Verified facts*). A fourth, `MAX_FORK_RULES` in `MAX_SCRATCH_TM_BYTES`' doc, went in Task 5's fix round. So PR 1
  changes Rust in comments, and its gate ran the Rust legs. The rest stay for PR 2, which PR 1's roadmap entry lists.
- **`rebind`'s same-leg branch for a session other than the view's went in PR 1**, in Task 9, with the cases that made a
  copy only to reach a second session, since every taker of the branch was a copy path (ruling 12, as the pre-flight
  reversed it). `split`'s `choice.session` and the other reads of a binding's session stay for *PR 3*.
- **`SessionPool`'s `PoolPort`, its `terminate` and the port each pooled entry carried went in PR 1** beside
  `SessionPool.unbind`, their only reader (the controller's ruling on Task 12's review).
- **What only a session leaving the registry, or a copy's view or editor, reached went in PR 1 too**, found by the
  review of the whole branch: `LambdaTrees.prune` with its call in each frame, `LambdaTrees.want`'s arm for a session
  with no client and `SessionRegistry.has`; `viewMenu.setFormattable` with its flag; `KeymapSetting.unfollow`; and
  `unsaved.ts`'s `UnsavedStore`, its record for each writer (the review's B-I2, A-I1 and A M3, and the controller's
  rulings on them).
- **`layout-view.ts`'s `retitleStage` went** with what showed a copy: it only retitled a Stage tab for a copy (the
  controller's ruling T2-1).
- **The builder's calls under *Left to the builder***: `MachineViewChrome` kept, shrunk to the header, the step strip
  and the menu, since `ClifPane` extends it too (ruling 5); a hand-written machine put in by a component fixture,
  `tm-fixture.ts`, whose every state carries an instruction (ruling 9); `isGuard` tests the name alone (ruling 7); the
  start-up removal is `program-store.ts`'s `forgetCopies` (ruling 3); and `check-attributions.sh` fails a possessive
  citation of a file git does not track (*Verified facts*).
- **The colour registry's key is a type parameter** that defaults to the app's `LanguageId`, so the tests that load the
  four grammars name their own ids and sources (ruling 13), which the compiler requires whenever the keys are not the
  app's.
- **The corrected facts.** The plan's *Verified facts* lists each fact of this design that did not hold at `b627fe3` and
  was used as corrected: line numbers in `stored-panels-restore.test.ts`, `tests/browser/cut-text.test.ts`,
  `session-worker.ts`, `protocol.ts`, `main.ts`'s restore, `grammars/README.md`, `vite.config.ts` and `view-header.ts`;
  the notice's default; the pieces this design missed, among them `pane-chrome-text-panel.test.ts`,
  `LspClient.closeDocument`, `viewMenu`'s hint line, the icons `edit` and `move-editor-here`, `SessionEntry.readings`,
  `types.ts`'s three re-exports and the tests that load a λ, TM or rxm grammar or language; the longer list of tests
  that put a hand-written machine in through a copy; the model fixtures' states with no instruction; and the further
  callers of `SessionRegistry.remove` and `SessionPool.unbind`.
- **A change made and taken back**: `0fa0e0d`, a fix of a Firefox caret bug older than this work, which `8c6cc4b`
  reverts, to come in a pull request of its own (the controller's ruling on Task 5).
