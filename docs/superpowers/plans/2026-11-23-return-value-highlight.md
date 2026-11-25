# The result marked at a run's end — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the last step of a run that finished with a value, the λ, TM, rxm and clif views of the program mark where
the result is, an emerald tint and edge and the word `result`, the rxm and clif views show it whole in their first row,
and the TM status line says `little-endian` for a binary field when it has room (the design's goals 1-4).

**Architecture:** One pure decision, `resultMarked` in a new `web/src/result-mark.ts`, read by `draw.ts` for each view
of the program before it renders: the program's stored result is of the frames' generation and a decoded `Value`, the
recording `ended`, the view stands on its newest frame, and what is on screen proves the run's end (the frame's own
field, or for λ the tree's). `draw.ts` hands each view a flag (and the TM view the run's bit order); each view draws its
own mark. The clif view's returned value crosses from Rust as a new `ClifState::returned`, which the values window
always holds. Two palette tokens, `result` and `result-word`, carry the colour in every palette and import, held by
`contrast.ts`'s floors against the mark's own tinted ground.

**Tech Stack:** Rust (`redextape-clif`, ts-rs bindings, wasm-pack for `pkg-clif/`); TypeScript, Vite, Vitest 4 (node,
and browser on Playwright: Chromium and Firefox), Biome; CSS.

**Spec:** `docs/superpowers/specs/2026-11-23-return-value-highlight-design.md` (*the design*, committed as `7ffb556`).
The surveys it cites (`/home/davey/temp/redextape-return-value-record/survey-a.md`, `survey-b.md`, line numbers at
`b32af3d`) are leads: every fact this plan uses is re-read at `b627fe3` under *Verified facts*, and every fixture value
under *Verified fixtures* was measured.

## Execution notes

- **Paths.** `W=/home/davey/temp/redextape-return-value-highlight` (branch `return-value-highlight`, cut from `main`
  at `b627fe3`; the design is `7ffb556` and this plan the commit after it; not pushed);
  `R=/home/davey/temp/redextape-return-value-record/pr2`; `L=$R/impl` (every log, probe, sabotage driver and saved
  copy, commit message file and report; never the worktree);
  `T=/home/davey/.cache/redextape-return-value-highlight-target` (`export CARGO_TARGET_DIR=$T` in every shell that runs
  cargo, wasm-pack, `pnpm run typecheck`, `pnpm run build:bindings` or `git commit`; never the main checkout's
  `target/`). `CARGO_HOME` is `~/.local/share/cargo`. `$R/plan-common.md` is this plan up to Task 1, for a dispatch that
  reads it and one task. The lane's ledger is `/home/davey/temp/redextape-return-value-record/progress.md`; the plan's
  probes and notes are in `$R/plan/`.
- **The worktree's build outputs** (gitignored; copies, never symlinks). `pkg/` and `pkg-lsp/` are copies of the main
  checkout's, built 2026-11-20 23:28-23:29 PST, after `1ac4fc4` (23:20), the last commit to touch `crates/`, and
  `git diff --stat 1ac4fc4 b627fe3 -- crates grammars Cargo.toml Cargo.lock rust-toolchain.toml` is empty; this branch
  changes neither crate. `pkg-clif/` and `web/bindings/` were built in `$W` at `b627fe3` into `$T` by the plan's probe
  (`$R/plan/build-clif-wasm.log`, 28 s; `build-bindings.log`). **Task 1 rebuilds both after its Rust change**; Task 7
  rebuilds all three packages from `$W`. A task that finds one missing rebuilds it the same way, never copies
  `pkg-clif/` from main.
- **No dev server serves `$W`**, and no task starts one: the sabotages edit `$W`. The dev server on
  `http://localhost:5175/` serves the main checkout; leave it alone.
- **One committing agent in `$W` at a time** (the pre-commit hook runs over the whole tree and stashes unstaged files).
  No task pushes or opens a pull request: Davey gives that word, after Task 10.
- **Line references are at `b627fe3`.** Once an earlier step has edited a file, find the place by name.
- **zsh**: `noclobber` refuses `>` onto a file and `>>` onto a missing one, so logs are written with `>|` and appended
  with `>>|` (the plan's own probe lost its exit file to a bare `>>`).
- **The remove-copies lane** (`/home/davey/temp/redextape-remove-copies`) changes the same panes. Whichever of the two
  merges second rebases onto the other; this plan marks nothing on a copy and adds one guard and one case for copies
  (Task 6), which go with the copies feature if that lane lands first.

## Global Constraints

- **The design's goals, verbatim.** "1. At the last step of a run that finished with a value, the λ, TM, rxm and clif
  views each mark where the result is: rxm the `rr` register, clif the returned value, the TM REG tape's field 0, λ the
  root node." "2. The mark is an emerald tint with a thin emerald edge and the word "result"." "3. In rxm and clif the
  result is never cut at the last step: its cell moves to the panel's first row, spans the whole row, and wraps only
  when even the whole row is too narrow." "4. The TM status line says "little-endian" for a binary field when it has
  room."
- **Its non-goals.** No change to values cut mid-run (squeezed values, its own PR). A list result marks only its
  pointer word (rxm `rr`, the clif value, TM field 0), and a λ list result no mark (PR 3). Function results: no mark.
  Copies: no mark. No listing row marked or scrolled to at the end. A TM field wider than the frame's window: the part
  on screen.
- **Its anti-goals.** No mark at any step but the last, or on a run that did not finish with a value (step cap,
  history full, overflow, fault, trap). Nothing outside a view moves; the layout changes stay inside the view and only
  at the last step. The TM status line's added words are dropped, never wrapped. No mark told by colour alone.
- **What the design left to the builder, settled here** (not to be reopened by an implementer):
  - *When the mark shows* (Task 3). `resultMarked(r, leg, state, ended)` is true exactly when `r` is a
    `{ kind: 'result' }` whose `gen` is the leg's `LegState.gen` (the generation of the frames in its ring), the
    leg's `done` is `'ended'`, its history is not empty and its `hist.head` is `hist.length - 1`, `ended` holds, and
    `r.legs[leg].value` is `{ Value: { text } }` with `text !== '()'` (Unit: no mark). **`ended` IS WHAT IS ON
    SCREEN PROVING THE RUN'S END**, never `done` alone (`endOf` maps `Running` to `'ended'`): `RUN_ENDED.tm(f)` is
    `f.rule === null`, `.rxm(f)` is `f.next === null`, `.clif(f)` is `f.next === null && f.returned !== null`, and
    for λ `lambdaEnded(t)` is `t.kind === 'tree' && t.tree.nextRedex === null` (a stale tree proves nothing).
    `draw.ts` asks it for every view on the page that shows the program and passes `false` to a view of a copy
    (`sessions.entryOf(session).detached`). Every condition is recomputed at every `draw()`, and `replies.ts`'s
    `result` arm calls `draw()`, so a result that lands after the frames shows the mark then, and a step back takes it
    away.
  - *clif's returned value* (Task 1). `ClifState::returned: Option<u32>`, set by `Stepper::state` only when the
    status is `ClifEnd::Ran`: the operand of the `return` at `at` in the running frame's function (main's, kept at the
    end), through `func.dfg.resolve_aliases` (`return v9` with `v9 -> v8` names 8). **THE WINDOW HOLDS IT**: where it
    is not among the first `window.values` set values, `values` is the first `window.values - 1` and then its row, which
    keeps value order (its number is the larger). ts-rs gives `returned: number | null`.
  - *The palette tokens* (Task 2). `result` (the tint's colour and the edge) and `result-word` (the word), appended to
    `COLOUR_TOKENS` after `tok-binder`, with the values in *Verified fixtures*. The ground is
    `--result-bg: color-mix(in oklab, var(--result) 20%, transparent)` beside `--link-bg`, and `contrast.ts`'s
    `RESULT_TINT = 0.2` is that 20%: a floor may name a `tint` token, measured on `tinted(v[tint], v[bg])`, the colour
    the browser composites (per sRGB channel, `round(0.2·tint + 0.8·over)`, which reproduces the design's 3.96 and
    5.54). Floors added: `result` on `bg` and `bg-raised` at 3 (a non-text edge); `result-word` on `result`'s tint over
    `bg` and over `bg-raised` at 4.5: 39 in all. `binderClashes` leaves `result` and `result-word` out (an import gives
    all three base0B). A built-in's `result` stands `BINDER_APART` from every token but `result-word`, except in
    Grayscale, whose result is a grey of its own ramp where the edge and the word carry it. An import maps both tokens
    to `base0B`; `apply adjusted` walks `result-word` after the surfaces' foregrounds, against the `result` the first
    pass left. A stored import lacking a token is completed from the `colours` it stored (every stored half has them:
    `readHalf` refuses one without its sixteen), mapped and, for an `adjusted` half, adjusted; its stored tokens are
    never changed.
  - *rxm and clif* (Task 3). At the result the row builders put the result row first (`rr` in rxm, the `returned` value
    in clif, found by number and never by an `rr` label), the others after it in their order. `.rxm-register.is-result`
    spans `grid-column: 1 / -1`, takes the ground and an inset 1px edge (a box-shadow: `is-changed` owns the outline),
    and its `dd` wraps (`white-space: normal`, `overflow-wrap: anywhere`): at the space before the word first, inside
    the value only when the value alone is wider than the row. The word is `span.result-word`, text `result`, after a
    space at the `dd`'s end (after `span.value-regs` in clif), 0.75em, colour `--result-word`.
  - *TM* (Task 4). `resultField(state)` in `tape.ts` gives REG field 0's window cells: from 1 to the next `#` or the
    window's end, and `null` unless REG's `window_start` is 0 and its first cell is `#` (measured so at every halt
    probed). The REG row wraps them in one `span.tm-result` box, then `span.result-word`. The status line's part
    `little-endian` (after its own ` · `) is drawn when the run's encoding is `binary`, read from
    `SessionClient.encodingOf(leg.gen)`, the encoding the client posted for that generation; it stays only where it
    adds no row to the line and leaves the state name no more cut, decided at each status draw and again when the
    status line's width changes.
  - *λ* (Task 5). `MARKS` gains `'is-result': 'result:'`; the result marks node 0 only when it is a chip
    (`tree.chip(0) !== null`: a Nat or a Bool) drawn on one row, so a list result or an opened chip over several rows
    has none (no bar lane). The edge is an `outline` (the next redex's, which never shares a node with it at a normal
    form), so it composes with the contractum's and the link's box-shadows; pair rules layer the grounds. The visible
    word is `::after { content: "result" / "" }`, empty alternative text, since `data-marks` already says it.
- **Commands** (notation used below). Each run writes `>| $L/<task>-<what>.log 2>&1` and is followed by `print $?`; the
  tallies are read from the log with `grep -aE 'Test Files|Tests |FAIL|×'` (vitest) or `grep -aE 'Summary|FAIL'`
  (nextest). Never pipe a run through `tail`. From `$W/web` unless said.
  - `BROWSER files…`: `flock /home/davey/temp/redextape-browser.lock zsh -c 'until ! ss -ltn | grep -q ":63315 "; do
    sleep 5; done; VITEST_MAX_WORKERS=4 pnpm exec vitest run --project browser "$@"' _ <paths>`. Paths positional;
    `pnpm test:browser -- name` does not scope, and `--maxWorkers` does not reach the browser projects.
  - `FIREFOX files…`: the same with `REDEXTAPE_FIREFOX=1` and `--project firefox --project firefox-capture`.
  - `SCROLLBARS`: as `BROWSER` with `--project browser-scrollbars tests/browser/machine-row-scrollbars.test.ts`.
  - `NODE files…`: `pnpm exec vitest run --project node <paths>`.
  - `RUST`: from `$W`, `cargo nextest run -p redextape-clif --features ts --no-fail-fast` (the plan's probe ran its
    `state` and `ts_bindings` targets at the base: 11 passed, `$R/plan/base-clif-tests.log`).
  - `TSC`: `pnpm run typecheck`. `LINT`: `pnpm exec biome ci --error-on-warnings`. `COMMENTS`: `node
    scripts/check-comments.mjs --base b627fe3` from `$W`.
- **`AFFECTED`**, run before every commit, is the task's own list (each task names its files) plus `NODE` on
  `tests/node/result-mark.test.ts` once it exists, and `BROWSER` on every `tests/browser/result-*.test.ts` that
  exists. **`AFFECTED-FF`** is `FIREFOX` on the task's new browser files and `marks`, `rxm-pane`, `clif-pane`.
  **Chromium is the gate; Firefox is read against Task 1 Step 0's baseline**, and a new file passes there whole.
  Under load a case can time out where it passes alone (the plan's base run: `clif-app.test.ts`'s first case timed
  out among ten files, `$R/plan/base-browser.log`, and passed alone, `base-clif-app-rerun.log`): such a failure is
  re-run alone once before it counts, and the report says so.
- **`GATE`** (Task 7): each leg into `$L/07-<leg>.log`, its exit and seconds into `$L/07-gate-exits.txt`, by a script
  modelled on PR 1's `/home/davey/temp/redextape-return-value-record/pr1/impl/03-gate-run.zsh` (its `leg`, `capped`
  and `locked` helpers) and, for the Rust legs, on `/home/davey/temp/redextape-panels-row-record/impl3/02-gate-run.zsh`:
  1. Rust, from `$W` in a 16G transient unit (`PATH` with `/home/davey/.local/share/cargo/bin`, `HOME`, `CARGO_HOME`,
     `RUSTUP_HOME`, `CARGO_TARGET_DIR=$T`, `TREE_SITTER=/home/davey/projects/redextape/.tools/tree-sitter`, the pinned
     0.25.10): `scripts/check-all.sh` (base, LLVM and browser tiers); `cargo llvm-cov nextest --workspace
     --fail-under-lines 90`; `scripts/check-slow.sh`. Before believing a failure, grep its log for `not found`.
  2. From `$W/web`: `pnpm run build:wasm`, `build:lsp-wasm`, `build:clif-wasm` (replacing the copies), `build:bindings`;
     `../scripts/check-licences.sh --self-test`, then alone; `LINT`; `TSC`.
  3. From `$W`, each with `--self-test` and then alone: `scripts/check-text-bytes.sh`, `check-citations.sh`,
     `check-attributions.sh`, `check-doc-figures.sh`, `check-shared-docs.sh`, `check-colours.sh`,
     `check-grammar-wasm.sh`, `check-lua.sh`, `check-licence-editions.sh`; `node scripts/check-comments.mjs
     --self-test`, then `COMMENTS`.
  4. `pnpm run test:coverage` under the browser lock with the port wait inside it, in a 16G unit with
     `VITEST_MAX_WORKERS=4`; `pnpm run build:app`; `SCROLLBARS`; `AFFECTED-FF` over every `result-*` file.
  No Docker build: this branch adds no build output the app imports (the Dockerfile's packages are unchanged in kind).
- **Test first.** A task writes its cases, runs them to see them fail for the reason it names, then builds. A case that
  cannot fail first is proven by its sabotage instead, and the report says which.
- **Sabotage.** Save a copy (`cp <file> $L/sab/<id>.orig`), make the one edit named, run the named files into
  `$L/<task>-sab-<id>.log`, copy the file back, `cmp` it. **Never `git checkout`**. One driver a task, in `$L`
  (`/home/davey/temp/redextape-return-value-record/pr1/impl/01-sab-driver.mjs` is the model; a Rust row runs `RUST` on
  its test target). Each row names the cases that must fail and the assertion they fail at; **a sabotage that does not
  fire is a finding: stop and report**. Every sabotage runs the whole file, in order, never `-t`. A case named for two
  sabotages must fail under each alone.
- **Commits.** One per task: `cd $W && export CARGO_TARGET_DIR=$T && git add <the task's files> && git commit -F
  $L/<task>-commit-msg.txt`. The hook runs the tree-wide scans, the comment guard and the licences check, `cargo fmt`
  and `clippy -D warnings` when `.rs` files are staged, and `biome ci` and `pnpm run typecheck` when `web/` files are.
  Never `--no-verify`, never `--amend`. `git status` after each commit. The message is one long plain sentence saying
  what the commit holds, as `git log --oneline -5` shows. If the comment guard reports a budget, cut the comment to
  its why first; only if it is still over, write the value it prints into `scripts/comment-budget.json` in that commit
  and say so.
- **Copy and code.** "redextape" and "clif" are lowercase in prose; spelling is British; no attribution to a person or a
  tool anywhere in the tree, and no test name or comment says who decided what. Doc comments are `///` in Rust and
  `/** */` in TypeScript. **A comment says why**: the reason, the invariant, what breaks if it changes; no history, no
  measurement, no `file:line` (the hook refuses one in a `.rs` or `.ts` file); a comment may point at the design.
  Wrapped at 120 columns. Colours only through tokens: `scripts/check-colours.sh` refuses a literal outside
  `palettes.ts` and the fallback copy.
- **Browser tests.** Real input only: `userEvent.click`, `userEvent.keyboard`, `userEvent.hover(el, { position })` with
  a new `position` object every call; no `.click()` and no hand-made events. A claim about place is asserted as geometry
  (`getBoundingClientRect`, a `Range`'s client rects), a claim about drawing as computed style; never `textContent`
  alone. A case first asserts its precondition (the frame at the step it names, the text cut or whole, the width that
  makes a row too narrow), so no case passes because a layout happened to fit. A width is made by the host or the
  viewport, never by a style rule. A probe prints with `console.error` and is gone before the commit.

## Review Focus

Inputs the design implies and no line of it pins, most likely first. Each has its case.

1. **The result reply landing after a view already stands at its end**, no step taken: the mark appears with that
   reply's draw. N3 holds it (the decision flips with the result alone); the app cannot order a result after the last
   frame on demand, so no app case does, and the review reads `replies.ts`'s `result` arm.
2. **A new program while a view stands at its end** (an example picked): no mark on the new program's frames until its
   own end, never the old value's. X4.
3. **The clif listing switched at the end** (as built ↔ optimised): the returned value is the new listing's own (as
   built `return v9` is an alias of v8; optimised `return v8`), marked once the new recording reaches its end. A-clif-2.
4. **A view resized at its last step**: the result row re-wraps only as the width demands, and the TM's `little-endian`
   comes and goes with the room, with no step. V4, T6.
5. **A value labelled `rr` that is not the returned one** (sum_to(5) as built has `v3 0 [rr]` beside `v8 15 [rr]`):
   only the returned value is marked. V5 and A-clif-1.

## Verified facts (at `b627fe3`, read while writing this plan)

- **The frames.** `RxmState.next` is `null` once the run has halted or faulted; `TmState.rule` is `null` at an accept
  state, at `halt` or stuck; `ClifState.next` is `None` after `Ran`, `Fault`, `Trap` and `Broken`
  (`crates/redextape-clif/src/state.rs` :102-105). The λ tree's `nextRedex` (`protocol.ts` :522) is `null` at a
  normal form; `TreeFor` (`lambda-trees.ts` :5-13) is `tree`, `stale`, `refused` or `none`.
- **The leg's facts.** `LegState` (`sessions.ts` :23-62) holds `hist`, `done` and `gen`, the generation of the frames
  in its ring. `endOf` (`protocol.ts` :357-366) maps `Running` to `'ended'`. `ProgramResult`'s `result` kind carries
  the reply's `gen` and `legs` (`readout.ts` :24-37); `ResultLegs` is `LegResult` per leg, each with
  `value: Decoded | null` (`protocol.ts` :585-621). `replies.ts`'s `result` arm stores it and calls `draw()`
  (:439-449). `main.ts` holds it (:823) and gives `draw` the thunk `program()`.
- **The draw pass.** `createDraw` (`draw.ts` :63). Its loop over every pane on the page (:210-293) calls a linked
  leg's `machine.setFocus` before `p.slot.render(sessions, p.pane, leg)` (:235-239), where `leg` is the pane's
  `LegState` and `unlinked` says the view shows a copy (:234). The λ pass (:311-326) calls
  `pane.renderTree(treeFor, pinned)` with `trees.want(session, leg.hist.currentStep)`. `LinkedPane`
  (`linked-legs.ts` :16-20) is `setLink`, `setFocus`, `setEditorAvailable`; `LINKED[leg].pane(p)` casts to it.
- **The encoding.** `compile.ts` :88-91 posts `client.request(gen, src, picker.value, width, clif)`;
  `SessionClient.request` (`session-client.ts` :97-103) posts `{ kind: 'run', gen, src, encoding, … }` and keeps
  nothing of it. The TM pane is told no encoding. Binary fields are least significant bit first, the leftmost cell
  2⁰ (`crates/redextape-core/src/tm/encoding/binary.rs`'s module doc).
- **The views.** `registerRows` (`rxm-view.ts` :97-111) orders `pc`, `rr`, `a…`, `r…`; `rxmValues` (:158-179) and
  `clifValues` (`clif-view.ts` :142-155) build `ValuesView` (`machine-panels.ts` :19-31), which `valuesPanel`'s
  `show` (:53-94) draws as `dl.rxm-register-list > div.rxm-register > dt + dd`, anew each frame; `RxmPane.render`
  (`rxm-pane.ts` :200-210) and `ClifPane.render` (`clif-pane.ts` :213-238) call it. `.rxm-register-list` is
  `repeat(auto-fill, minmax(14ch, 1fr))`; `.rxm-register dd` is `nowrap` with an ellipsis; `.is-changed` is an
  `--accent` outline (`style.css` :3167-3199). `TmPane.render` (`tm-pane.ts` :581-622) builds each tape row's
  `span.cell`s from `tapeRows` (`tape.ts` :27-42); `#drawStatus` (:641-687) builds `.tm-line`'s parts with `part()`,
  each after the first leading with ` · `; `.tm-line` is `inline-flex` and wraps (`style.css` :1117-1133). TmPane has
  no ResizeObserver. `MARKS` (`lambda-body.ts` :67-71), `markSpans` (:95-136), a one-row node's `span.term-mark` and
  a taller node's `term-bar` lane (:620-650), and `showTree`'s unchanged test (:444-457), which `LambdaPane.#redraw`
  calls (`lambda-pane.ts` :906). `Tree.chip(i)` (`lambda-tree.ts` :171) answers a numeral or a bool.
- **The palette.** `COLOUR_TOKENS`, five palettes (Material the default, `skin.ts` :35), `paletteDeclarations`
  (`palettes.ts`); the fallback copy (`style.css` :46-66) and `--link-bg`'s mix (:73-74); `CONTRAST_FLOORS` (35),
  `BINDER_APART`, `binderClashes` (`contrast.ts` :50-106); `BASE16_MAPPING` (`base16.ts` :172-192);
  `floorFailures`, `WORDS`, `summaryLines`, `failureLines` (`base16-check.ts`); `adjustVariant` with `SURFACES` and
  its two passes (`base16-adjust.ts` :171-230); `CustomHalf` stores `colours` and `tokens` (`custom-palette.ts`
  :20-29), and `resolvePalette` fills a missing token from the default palette (`skin.ts` :100-108). Tests pinning the
  count: `contrast.test.ts` :37 (35) and the Ember summary (`base16-check.test.ts` :33, `base16-import.test.ts`
  :188-191, "17 of 35").
- **User docs.** `web/help.html`'s *Getting around* item 2 (:29-34) is the step controls; no doc outside
  `docs/superpowers/` lists the λ marks (`rg -l 'just produced|next redex' docs web README.md`).

## Verified fixtures (measured: `$R/plan/probe-1.log`, `probe-2.log`, `probe-3.log`, by `$R/plan/probe.mjs` over
`pkg/` and `pkg-clif/` at the base, and by hand with the tint formula)

- **At each run's end** (binary unless said): sum_to(5) `15`: TM REG `#1111#1010#…`, `window_start` 0, head 0,
  `rule` `null`, width 4; rxm `rr 15`, `next null`; λ `Ended`; clif as built `return v9` (aliases `v5 -> v4`,
  `v7 -> v4`, `v9 -> v8`), values `v1 0 [a0]`, `v2 0 [r0]`, `v3 0 [rr]`, `v4 5 [r0]`, `v6 0`, `v8 15 [rr]` (7 set);
  optimised `return v8`, 4 set. fact(12) `479001600`: TM width 32, field 0 `00000000001111110011000100111000`; rxm and
  clif end (as built `return v9` → v8); λ stops at its history (value `Unfinished` at 200,000 steps); TM 481,964
  steps (the app fills its history first: `examples.ts`'s outcomes). is_even(6) `true`: λ root a bool, rxm `rr 1`.
  `[1, 2]`: value `[1, 2]` on every leg, rxm `rr #2` (List), λ root not a chip. `|x| x + 1`: every leg ends,
  `Undecodable`. `head([])`: rxm and clif end in a fault (clif returns the sentinel `v8 ; v8 = 0`), TM runs on.
  Unary: sum_to(5) width 16, REG `#111111111111111_#…`; `let x = 40; x + 2` width 64, REG 41 cells, all after the
  `#` field 0 (the field runs past the window). No program the probe tried ends with a Unit value (`()` is not an
  expression): the Unit rule is held by N1 alone.
- **The palette values** (light result, light word; dark result, dark word), with the edge on `bg` / `bg-raised` and
  the word on the tint over `bg` / `bg-raised`:

| Palette | light | ratios | dark | ratios |
|---|---|---|---|---|
| Material | `#047857`, `#065f46` | 5.25 / 4.54; 5.54 / 4.87 | `#34d399`, `#34d399` | 8.38 / 6.87; 5.49 / 4.56 |
| Paper | `#1f7a4d`, `#17603c` | 4.85 / 5.23; 5.30 / 5.66 | `#62d394`, `#62d394` | 9.60 / 8.90; 6.27 / 5.80 |
| Terminal | `#0b7a5a`, `#065f46` | 4.89 / 5.20; 5.37 / 5.68 | `#34d399`, `#34d399` | 10.05 / 9.67; 6.92 / 6.55 |
| Instrument | `#15803d`, `#166534` | 4.27 / 5.02; 4.69 / 5.43 | `#4ade80`, `#4ade80` | 10.27 / 9.46; 6.58 / 6.02 |
| Grayscale | `#464646`, `#2e2e2e` | 8.81 / 7.35; 9.16 / 7.79 | `#b9b9b9`, `#d1d1d1` | 9.70 / 7.81; 8.40 / 6.48 |

  Each colour palette's `result` is `BINDER_APART` or more from every token but `result-word` (`tok-binder` and
  Terminal's green `accent` included); Grayscale's are its `fg` and `tok-binder` greys. `tinted('#047857',
  '#fafafa')` is `#c9e0d9` and `tinted('#34d399', '#212121')` `#254539`; on the first, `#047857` reads 3.95:1 (cut to
  two places) and `#065f46` 5.54:1. The design's 5.52:1 for the dark word was the mockup's; the formula gives 5.49.
- **The base16 fixtures against the four new floors** (base0B's edge and word): Night, Ember and Twins pass all four
  (Ember stays at 17 failures, now `17 of 39`); Day fails the word on its tint (4.25:1 over base00, 3.84:1 over
  base01), so **Task 2 moves Day's base0B from `#2e6e2e` to `#2a602a`** (bare 6.81 / 6.07, on its tint 5.00 / 4.52, 52
  or more from every other Day colour) and Day stays a scheme that passes every check; Closing fails the word (4.31,
  3.75); Neon and Narrow fail all four on base01; Boxed and Stuck fail the word (3.91, 3.57). Any other change to an
  existing base16 expectation is a finding.

## File structure

| File | Change |
|---|---|
| `crates/redextape-clif/src/state.rs` | `ClifState::returned`; `state()` sets it and keeps it in the window (Task 1) |
| `crates/redextape-clif/tests/state.rs` | two new tests; the every-step test's window comparison at a `Ran` end (Task 1) |
| `web/tests/node/clif-frames.ts`, `web/tests/browser/machine-views.ts`, the tests that build a `ClifState` | `returned` (Task 1) |
| `web/src/palettes.ts`, `contrast.ts`, `base16.ts`, `base16-check.ts`, `base16-adjust.ts`, `custom-palette.ts`, `skin.ts`, `style.css` | the two tokens and their checks (Task 2) |
| `web/src/result-mark.ts` (new), `draw.ts`, `linked-legs.ts` | the decision and its wiring (Task 3; λ's call Task 5, TM's bit order Task 4) |
| `web/src/rxm-view.ts`, `clif-view.ts`, `machine-panels.ts`, `rxm-pane.ts`, `clif-pane.ts`, `style.css` | rxm and clif (Task 3) |
| `web/src/tape.ts`, `tm-pane.ts`, `session-client.ts`, `style.css` | TM (Task 4) |
| `web/src/lambda-body.ts`, `lambda-pane.ts`, `style.css` | λ (Task 5) |
| `web/help.html` | one paragraph (Task 6) |
| tests | node: `result-mark` (new), `contrast`, `palettes`, `base16*`, `custom-palette`, `skin`, `rxm-view`, `clif-view`, `tape`, `session-client`; browser (new): `result-values`, `result-app`, `result-tm`, `result-lambda`, `result-stopped` |
| the design; the roadmap | Task 8 |

## Design coverage

| The design | Where |
|---|---|
| G1, each view's place | rxm/clif Task 3 (V1, A-rxm, A-clif-1), TM Task 4 (T1-T3), λ Task 5 (L1-L2) |
| G2, tint, edge and word | Task 2's tokens; each view's computed-style case; X2 in both themes |
| G3, first row, whole row, wrap only when needed | V1-V4, A-rxm-2, A-clif-3 (fact(12) at 1400 px) |
| G4, little-endian with room | T4-T6 |
| *When the mark shows*: last step only, of a value, of this generation, proven from the recording | N1-N4; every view's step-before case; X1 (stopped legs with a value), X3 (function), X4 (new program) |
| Unit gets no mark | N1 |
| The colour in every palette, imports, stored imports | Task 2 (P1-P9) |
| clif alias followed; window holds it | Task 1 (C1, C2); V5 |
| TM field partly off-window | T3 |
| λ Nat chip, Bool root, data-marks words | L1-L3 |
| Nothing outside the view moves | each app case's geometry check; X5 |
| Non-goals: copies, list results, function results, no listing row | X6, L4, X3, A-rxm/A-clif read no listing mark |
| help, roadmap, as built | Tasks 6, 8 |

---

### Task 1: clif's returned value crosses from Rust, and the values window holds it

**Files:**
- Modify: `crates/redextape-clif/src/state.rs` (`ClifState` :49-79; `Stepper::state` :92-123)
- Test: `crates/redextape-clif/tests/state.rs` (new tests; `the_state_reads_only_set_values_at_every_step`'s `narrow`
  comparison)
- Modify: every TypeScript literal of a `ClifState` (`rg -l 'values_len' web/src web/tests`:
  `tests/node/clif-frames.ts`, `clif-view.test.ts`, `protocol.test.ts`, `tests/browser/machine-views.ts`) gains
  `returned: null`
- Rebuild: `pkg-clif/` (`pnpm run build:clif-wasm`) and `web/bindings/` (`pnpm run build:bindings`)

**Interfaces:**
- Produces: `pub returned: Option<u32>` on `ClifState`, its `///` doc saying what *Settled here* says (main's
  `return` operand, aliases followed, set only at a `Ran` end, and always in `values`); in TypeScript
  `ClifState.returned: number | null`.

- [ ] **Step 0: Baselines** at the plan's commit, before any edit: `RUST` into `$L/00-base-rust.log`; `BROWSER` on
  `rxm-pane`, `clif-pane`, `clif-app`, `rxm-app`, `marks`, `lambda-body`, `tm-status-line`, `tm-view-narrow`,
  `machine-panel-headers`, `examples`, `frame-cost`, `base16-import`, `base16-remove`, `skin-switcher` into
  `$L/00-base-browser.log`; `FIREFOX` on `marks`, `rxm-pane`, `clif-pane`, `tm-status-line` into
  `$L/00-base-firefox.log`; `TSC`, `LINT`. Expected: Rust all pass; Chromium all pass (a load timeout re-run alone);
  the report lists each Firefox failure by case, and every later Firefox run is read against that list.
- [ ] **Step 1: Write the tests** in `tests/state.rs`, using its `build`, `ran`, `LISTINGS`, `WINDOW` and `NARROW`:
  - **C1** `the_returned_value_is_main_s_return_operand_with_aliases_followed`: for sum_to(5)
    (`include_str!` of `web/src/examples/sum-to.rxt`), fact(12), is_even(6) and `[1, 2]` in both listings, at the
    `Ran` end: `returned` is `Some(v)` where `v` is `funcs[0].dfg.resolve_aliases(inst_args(at)[0])`, read from the
    listing's own `at` instruction, and `values` holds a row numbered `v` whose word is the readout's value (`15`,
    `479001600`, `1`, the list word `2`); the instrument's own check: at least one of those runs has an operand that is
    an alias (sum_to(5) as built, `return v9`, `v9 -> v8`), so the case reads `Some(8)` there and the alias path is
    exercised. At every step before the end, `returned` is `None`; at `head([])`'s `Fault` end `None`.
  - **C2** `the_values_window_holds_the_returned_value`: for each corpus program (as the every-step test walks them)
    that ends `Ran`, in both listings, under `NARROW` (two values) and `WINDOW`: `values` holds the returned row; its
    numbers ascend; it is no longer than the window; and where the returned value is not among the first
    `window.values` set values, `values` is those first `window.values - 1` and then the returned row. The instrument's
    check: under `NARROW` at least one run's returned value lies past the first two (sum_to(5) as built has 7 set).
  - In `the_state_reads_only_set_values_at_every_step`, the `narrow.values` comparison holds at a `Ran` end in C2's
    form; before the end and at every other end, as today.
- [ ] **Step 2: Run red.** `RUST` into `$L/01-red.log`. Expected: a compile error naming `returned` (no such field);
  then, with the field added as `None` everywhere (the stub), C1 fails at sum_to(5)'s `Some(8)` and C2 at the first
  run whose returned value is past `NARROW`'s two, into `$L/01-red-stub.log`.
- [ ] **Step 3: Build** `returned` and the window rule in `Stepper::state` as *Settled here* says; the field's doc and
  the window rule's comment say why (a values panel that cut the answer off would mark nothing). Then from `$W/web`:
  `pnpm run build:clif-wasm` into `$L/01-build-clif-wasm.log` and `pnpm run build:bindings` into
  `$L/01-build-bindings.log`; `web/bindings/ClifState.ts` now has `returned: number | null`. Add `returned: null` to
  each TypeScript `ClifState` literal.
- [ ] **Step 4: Run green.** `RUST` into `$L/01-green.log` (expected: all pass, two more than Step 0's); `NODE` on
  `clif-view`, `protocol`, `bindings-contract`; `BROWSER` on `clif-pane`, `clif-app`, `frame-cost` (its clif cases hold
  `CLIF_FRAME_BYTES` against what a frame keeps; a failure there is a finding, not a constant to raise unmeasured);
  `TSC`, `LINT`.
- [ ] **Step 5: Sabotage** (Rust rows run `RUST`; `$L/01-sab-driver.mjs`):

| Id | The one edit | Must fail |
|---|---|---|
| R1 | `returned` is the `return`'s operand without `resolve_aliases` | C1 (sum_to(5) as built: 9, not 8) |
| R2 | `returned` is set at every end, the `Fault` one included | C1 (`head([])`) |
| R3 | the window is the first `window.values` values, as before | C2 (`NARROW`) |
| R4 | the returned row goes first in `values` rather than last | C2 (value order) |

- [ ] **Step 6: Gates and the commit.** `RUST`, `TSC`, `LINT`, `COMMENTS` and the Step 4 runs, all green; the commit
  holds the two Rust files and the TypeScript fixtures (`pkg-clif/` and `web/bindings/` are not tracked). The hook
  runs `cargo fmt` and `clippy -D warnings`.
- [ ] **Step 7: Report** in `$L/task-1-report.md`: Step 0's Firefox list; the red and green tallies; each sabotage, the
  test and assertion it failed at, its log; the frame-cost result.

### Task 2: The result tokens in every palette, held by the contrast floors on their own ground

**Files:**
- Modify: `web/src/palettes.ts` (`COLOUR_TOKENS`, five palettes, the module doc), `web/src/style.css` (the fallback
  copy :46-66; `--result-bg` beside `--link-bg` :73-74; the shared `.result-word` rule), `web/src/contrast.ts`,
  `web/src/base16.ts` (`BASE16_MAPPING`), `web/src/base16-check.ts` (`floorFailures`, `WORDS`, `failureLines`),
  `web/src/base16-adjust.ts` (`adjustVariant`), `web/src/custom-palette.ts`, `web/src/skin.ts` (`resolvePalette`)
- Test: `web/tests/node/contrast.test.ts`, `palettes.test.ts`, `base16.test.ts`, `base16-check.test.ts`,
  `base16-adjust.test.ts`, `custom-palette.test.ts`, `skin.test.ts`, `prepaint.test.ts`, `base16-fixtures.ts` (Day's
  base0B); `web/tests/browser/base16-import.test.ts` (the Ember summary)

**Interfaces:**
- Produces, in `contrast.ts`: `export const RESULT_TINT = 0.2`; `export function tinted(tint: string, over: string,
  share = RESULT_TINT): string`; `export type Floor = readonly [fg: ColourToken, bg: ColourToken, floor: number,
  tint?: ColourToken]` (`CONTRAST_FLOORS: readonly Floor[]`, 39 entries); `export function groundOf(v: Variant, floor:
  Floor): string` (`v[bg]`, or `tinted(v[tint], v[bg])`); `export function tooClose(v: Variant, token: ColourToken,
  except: readonly ColourToken[]): BinderClash[]`, with `binderClashes(v)` = `tooClose(v, 'tok-binder', ['result',
  'result-word'])`. `FloorFailure` gains `tint?: ColourToken`. In `custom-palette.ts`: `export function
  halfTokens(half: CustomHalf): Variant` (every token: the stored ones as stored, each missing one derived from
  `colours` by `mapScheme` and, for an `adjusted` half, `adjustVariant({ ...mapScheme(colours), ...tokens })`).
  Tokens `--result`, `--result-word`, `--result-bg` and the class `.result-word` (0.75em, `--result-word`) for the
  view tasks.

- [ ] **Step 1: Write the cases.**
  - In `contrast.test.ts`: **P1** *composites a share of a colour over another as the browser draws it*:
    `tinted('#047857', '#fafafa')` is `'#c9e0d9'`, `tinted('#34d399', '#212121')` `'#254539'`, a share of 0 is `over`
    and of 1 is `tint`; **P2** *measures a tinted floor on its ground*: in Material light with `result-word` set to
    `#047857`, the floor `['result-word', 'bg', 4.5, 'result']`'s ratio (on `groundOf`) is below 4.5 (3.96) while
    `contrastRatio('#047857', '#fafafa')` is above it; *holds 35 pairs* becomes **holds 39 floors, none twice** (a
    floor keyed by its fg, bg and tint); **P3** *leaves the result tokens out of the binder rule*: a variant whose
    `result` and `result-word` equal `tok-binder` has no binder clash.
  - In `palettes.test.ts`: *meets every contrast floor* reads `groundOf`; **P4** *carries the result colours*: the
    table under *Verified fixtures*, all ten pairs, written out; **P5** *keeps result apart from every token but
    result-word in every palette but Grayscale*: `tooClose(v, 'result', ['result-word'])` is empty for the four colour
    palettes' variants; **P6** *mixes --result-bg at RESULT_TINT*: `style.css`'s `--result-bg` is
    `color-mix(in oklab, var(--result) 20%, transparent)` with 20 = `RESULT_TINT * 100`. The fallback-copy and the
    no-undefined-property cases cover the new properties unchanged.
  - In `base16.test.ts`: **P7** *maps result and result-word to base0B*. In `base16-check.test.ts`: the Ember summary
    reads `17 of 39`; **P8** *says a result word that fails on its own ground*: Closing's `failureLines` hold
    `base0B on base0B over base00: the result word on the result mark over the page — 4.31:1, needs 4.5` and the same
    over base01 and panels at 3.75 (`WORDS`: `result` "the result mark", `result-word` "the result word"; a tinted pair
    reads `<fg> on <tint> over <bg>`). In `base16-adjust.test.ts`: **P9** *walks the result word against the result
    its first pass left*: Closing adjusted meets both tinted floors, its `result-word` moved and `result` not; the
    table at :345 takes each fixture's new outcome as *Verified fixtures* forecasts, and the report explains each line
    that changed.
  - In `custom-palette.test.ts`: **P10** *completes a half stored before the result tokens from its colours*: a Day half
    and an adjusted Closing half, each with `result` and `result-word` deleted from `tokens`: `halfTokens` gives Day's
    base0B for both, and for Closing the adjusted values (the word meeting 4.5 on its tint over the stored `bg` and
    `bg-raised`), every stored token unchanged. In `skin.test.ts`: `resolvePalette('custom', …)` of such a store
    carries those values, not the default palette's.
  - Day's base0B becomes `#2a602a` in `base16-fixtures.ts`, its doc saying it passes every check.
- [ ] **Step 2: Run red.** `NODE` on the eight node files into `$L/02-red.log`. Expected FAIL: P1, P2, P4-P10 and the
  39 and Ember counts, each at its first assertion on a missing export or token; P3 passes (nothing is mapped yet) and
  is proven by S-P3. `BROWSER tests/browser/base16-import.test.ts` fails at `17 of 39`.
- [ ] **Step 3: Build** what *Interfaces* names, with the values of *Verified fixtures*; `adjustVariant`'s `meets`,
  surface test and luminance pre-check read `groundOf`, and a floor with a `tint` is not on surfaces, so it is walked
  in the second pass; `resolvePalette` uses `halfTokens` for a present half. Docs say why: the ground is the mark's,
  where the word is read; the binder rule leaves out tokens an import gives the binder's own colour; a stored half is
  completed, never repainted.
- [ ] **Step 4: Run green.** The node files and `BROWSER` on `base16-import`, `base16-remove`, `base16-prepaint`,
  `custom-palette-load`, `skin-switcher`, `skin-restore`, `controls-gate`, `term-map` (it reads tokens), into
  `$L/02-green*.log`; `scripts/check-colours.sh` from `$W`.
- [ ] **Step 5: Sabotage** (`$L/02-sab-driver.mjs`):

| Id | The one edit | Must fail |
|---|---|---|
| S-P1 | Material light `result-word` is `#047857` | *meets every contrast floor* (result-word over bg, 3.96); P4 |
| S-P2 | `tinted` returns `over` | P1; P2 |
| S-P3 | `binderClashes` without its two exceptions | P3; P10's adjusted Closing, or the adjust table (binders clash with result) |
| S-P4 | Terminal light `result` is `#136c2e` (its accent) | P5; P4 |
| S-P5 | `BASE16_MAPPING.result` is `base0C` | P7 |
| S-P6 | `adjustVariant`'s `meets` reads `v[bg]` | P9 |
| S-P7 | `halfTokens` returns the stored tokens over the default palette | P10; the skin case |
| S-P8 | the fallback copy's `--result-word` line removed | *holds the default palette as its fallback* |
| S-P9 | `--result-bg` mixed at 25% | P6 |

- [ ] **Step 6: Gates and the commit**: `AFFECTED` (the node files, Step 4's browser files), `TSC`, `LINT`, `COMMENTS`;
  the commit holds the Task's files.
- [ ] **Step 7: Report** in `$L/task-2-report.md`: each base16 expectation that changed and the floor that changed it;
  the sabotages; the tallies.

### Task 3: When the mark shows, and the rxm and clif views' result row

**Files:**
- Create: `web/src/result-mark.ts`, `web/tests/node/result-mark.test.ts`, `web/tests/browser/result-values.test.ts`,
  `web/tests/browser/result-app.test.ts`
- Modify: `web/src/draw.ts` (the render loop, :234-239), `web/src/linked-legs.ts` (`LinkedPane`), `web/src/rxm-view.ts`
  (`rxmValues`), `web/src/clif-view.ts` (`clifValues`), `web/src/machine-panels.ts` (`ValuesView`, `valuesPanel`),
  `web/src/rxm-pane.ts`, `web/src/clif-pane.ts`, `web/src/tm-pane.ts` (an empty `setResult`, which Task 4 fills),
  `web/src/style.css` (the registers rules, :3167-3199), `web/tests/browser/machine-views.ts` (`Counts.result`),
  `web/tests/browser/harness.ts` (`outside`),
  `web/tests/node/rxm-view.test.ts`, `clif-view.test.ts`

**Interfaces:**
- Consumes: `ClifState.returned` (Task 1); `--result`, `--result-bg`, `.result-word` (Task 2).
- Produces, in `result-mark.ts`: `export type MarkedLeg = { readonly gen: number; readonly done: RecordEnd | null;
  readonly hist: { readonly head: number; readonly length: number } }`; `export function resultMarked(r: ProgramResult |
  null, leg: Leg, state: MarkedLeg, ended: boolean): boolean`; `export const RUN_ENDED: { readonly [K in LinkedLeg]:
  (frame: LegFrame[K]) => boolean }`; `export function lambdaEnded(t: TreeFor): boolean`. `LinkedPane.setResult(on:
  boolean): void` (Task 4 widens it). `rxmValues(s, result: boolean)`, `clifValues(s, result: boolean)`; each
  `ValuesView` row gains `result: boolean`. In `machine-views.ts`, `Counts.result?: string`: the run has ended (rxm:
  `next: null` and `rr` that word; clif: `next: null` and `returned` the last drawn value, holding that word) and the
  view is told to mark it.

- [ ] **Step 1: Write the cases.**
  - `result-mark.test.ts` (node), with a `ProgramResult` of generation 3 whose rxm value is `{ Value: { text: '15' } }`
    and a leg `{ gen: 3, done: 'ended', hist: { head: 9, length: 10 } }`: **N1** *marks a finished value at the newest
    step, and nothing when any one condition fails*: true as given, and false, one change at a time, for: `r` `null`,
    an `error` and a `no-session` result; `gen` 2; each `RecordEnd` but `ended` and `null`; `head` 8; an empty history;
    `ended` false; each other `Decoded` (`TooLargeToPrint`, `Undecodable`, `Unfinished`, a `Fault`, `null`); the text
    `()`. **N2** *reads the run's end off the frame*: `RUN_ENDED` on `frameOf({ next: null })` and `{ next: 3 }`, a
    `TmState` with `rule` `null` and `0`, a `ClifState` with `next` `null` and `returned` `8`, `null`, and with
    `next` set; `lambdaEnded` on a `tree` with `nextRedex` `null` (true), with `0`, a `stale` tree with `null`,
    `refused` and `none` (false). **N3** *follows the result alone*: the same leg is false with `r` `null` and true once
    `r` is the result.
  - `rxm-view.test.ts`: *puts rr first and marks it at the result* (rows `rr, pc, a0, …`, only `rr` with `result`);
    *keeps today's order otherwise*. `clif-view.test.ts`: *puts the returned value first by its number* (from
    `FACT_95` with `next: null` and `returned` set to a value that is not the first, two values carrying `rr` in
    `regs`: only the returned one marked).
  - `result-values.test.ts` (browser): `loadViews()`, `describe.each(VIEWS)`, `LONG = '18446744073709551615'`, readers
    `result(host)` (the `.rxm-register.is-result`) and `valueRange(dd)` (a `Range` over the dd's first text node, the
    value):
    - **V1** *puts the result first, across every column, its word after the value*: `mount(view, view.wide + 300)`,
      draw `{ depth: 1, cells: 1, boxes: 0, rows: { stack: 1, values: 6 }, result: '15' }`: the result is the list's
      first child; its left and right are the list's ±1px; every other row's top is at or below its bottom; the
      `.result-word` reads `result`, is the dd's last element and starts right of the value's end on the same line;
      computed: the row's `box-shadow` holds `--result`'s colour, the word's `color` `--result-word`'s (`token()` in the
      harness), in the light theme and again with the page in the dark one, set as `appearance.ts` sets it.
    - **V2** *draws today's rows at the step before*: the same counts without `result`: no `.is-result`, no word; in
      rxm `rr` is the second row; every `dd` `nowrap`.
    - **V3** *shows a long result whole on one line where the row has room*: `result: LONG` at the wide width:
      `valueRange` has one client rect and the dd is not cut (`whole()`).
    - **V4** *wraps only when the whole row is too narrow*: at a width where `LONG` fits the row and `LONG result` does
      not (the file names it, and asserts it first): the value is one rect, the word on the next line; at a width
      narrower than `LONG` alone: the value spans two or more rects and no character is clipped (the dd's
      `scrollWidth <= clientWidth`); then `resize(host, wide)` with no new frame: one line again.
    - **V5** (clif) *marks the returned value, not a value labelled rr*: two values with `regs: ['rr']`, `returned` the
      second: only it is `.is-result`.
    - **V6** (rxm) *keeps the changed register's outline on the result*: `wrote: 'rr'` with the result: the row is
      `is-changed` and `is-result`, its `outline-color` `--accent`'s and its `box-shadow` `--result`'s.
  - `result-app.test.ts` (browser), one boot, as `clif-app.test.ts` :67-76 boots: viewport 1400 by 1000, `SHELL`,
    `main`'s `ready`, `compile(view, sum_to(5))`, `PREFIX` then `5` for the clif view, the readout's value `15`
    awaited. `outside(leaf)`, added to `harness.ts` for every `result-*` file, reads the rects of every view host,
    `leaf`'s own included, the header and `#results`, and the document's scroll size.
    - **A-rxm-1** *marks rr at the rxm view's last step, and not at the step before*: `⏭` in the rxm view, its step line
      `step 84 of 84`: `rr` is the first row, `.is-result`, its dd `15 result`; `◀`: none, and `outside('rxm-0')` is
      equal at the two steps; `⏭`: the mark again. No listing row carries a new mark.
    - **A-clif-1** *marks the returned value, not v3, at the clif view's last step*: as A-rxm-1 for `clif-0`, the
      marked row `v8` (`15 rr result`) while `v3` (`0 rr`) is not.
    - **A-clif-2** *marks the new listing's returned value after a switch*: at the end, *optimised*, `⏭`: the marked row
      is the optimised run's `v8` and the step line its own total; back to *as built*.
    - **A-rxm-2** / **A-clif-3** *shows fact(12)'s result whole*: `compile(view, fact(12))`, viewport 1400 by 896 as the
      design measured; at each view's end the value `479001600` is whole (`whole()` on a `Range` over it); the clif
      values panel is one column (the file asserts it) and its dd is two lines, `479001600` then `rr result`.
- [ ] **Step 2: Run red.** `NODE` on `result-mark`, `rxm-view`, `clif-view` into `$L/03-red-node.log` (N1-N3 fail at the
  missing module; the view cases at their first row); `BROWSER` on `result-values`, `result-app` into
  `$L/03-red.log`: V1, V3-V6 and the app cases at their first `.is-result`; V2 passes (today's layout) and is proven
  by V-1.
- [ ] **Step 3: Build.** `result-mark.ts` as *Settled here*, its module doc saying why each condition is there (a value
  of another generation, a stop that is not the end, a recording `ended` while its run was not); `draw.ts` calls
  `machine.setResult(!unlinked && resultMarked(program(), boundLeg, leg, ended))` beside `setFocus`, before `render`,
  `ended` being `RUN_ENDED[boundLeg]` of `leg.hist.current` (false with no frame); the panes keep the flag and pass it
  to their row builders; `valuesPanel` draws `is-result` and the word; the CSS as *Settled here*. `TmPane.setResult` is
  an empty method whose doc says the TM view marks nothing yet; Task 4 gives it its body and its doc.
- [ ] **Step 4: Run green**, and `FIREFOX` on `result-values` and `result-app`.
- [ ] **Step 5: Sabotage** (`$L/03-sab-driver.mjs`):

| Id | The one edit | Must fail |
|---|---|---|
| D-1 | `resultMarked` skips the `gen` test | N1 (gen 2) |
| D-2 | skips the `done` test | N1 (each other end) |
| D-3 | skips the newest-step test | N1 (head 8); A-rxm-1 and A-clif-1 at the step before |
| D-4 | skips the `Value` test | N1 (each other `Decoded`) |
| D-5 | skips the Unit test | N1 (`()`) |
| D-6 | `RUN_ENDED.clif` ignores `returned` | N2 |
| V-1 | `rxmValues` leaves `rr` in its place | V1 (rxm, first child); A-rxm-1 |
| V-2 | no `grid-column: 1 / -1` on `.is-result` | V1 (right edge) |
| V-3 | the result dd keeps `white-space: nowrap` | V4 (word on the next line) |
| V-4 | the result dd's `overflow-wrap` is `normal` | V4 (narrower than LONG: clipped) |
| V-5 | `clifValues` marks the first value whose `regs` hold `rr` | V5; A-clif-1 (v3 marked) |
| V-6 | the word is put before the value | V1 (word after the value) |
| V-7 | `draw.ts` passes `false` | A-rxm-1, A-clif-1 at the end |

  `draw.ts` passing `true` for the frame's proof is not a row: every `ended` recording the app makes stops at its
  run's end, so no app case can see it; N2 holds `RUN_ENDED`, and the review reads the call.
- [ ] **Step 6: Gates and the commit**: `AFFECTED` (the new files, `rxm-pane`, `clif-pane`, `rxm-app`, `clif-app`,
  `machine-panel-headers`, `machine-row`, `cut-text`, `panel-boundaries`), `SCROLLBARS`, `AFFECTED-FF`, `TSC`,
  `LINT`, `COMMENTS`.
- [ ] **Step 7: Report** in `$L/task-3-report.md`: the widths V4 uses and why; the sabotages; the tallies.

### Task 4: The TM view's field 0, its word, and little-endian on the status line

**Files:**
- Modify: `web/src/tape.ts` (`resultField`), `web/src/tm-pane.ts` (`setResult`, `render` :597-620, `#drawStatus`
  :641-687, a ResizeObserver on the status line), `web/src/session-client.ts` (`encodingOf`), `web/src/linked-legs.ts`,
  `web/src/draw.ts`, `web/src/result-mark.ts` (`BINARY`), `web/src/style.css` (`.tm-result`)
- Test: `web/tests/node/tape.test.ts`, `session-client.test.ts`; create `web/tests/browser/result-tm.test.ts`

**Interfaces:**
- Consumes: `resultMarked`, `RUN_ENDED.tm` (Task 3); the tokens (Task 2).
- Produces: `export function resultField(state: TmState): { readonly from: number; readonly to: number } | null` (REG
  window indices, `to` exclusive); `SessionClient.encodingOf(gen: number): string | null`; `LinkedPane.setResult(on:
  boolean, littleEndian: boolean): void` (rxm's and clif's take the first argument); in `result-mark.ts`
  `export const BINARY = 'binary'`, the encoding whose fields read least significant digit first.

- [ ] **Step 1: Write the cases.**
  - `tape.test.ts`: **T1** *finds REG field 0 on screen*: the windows of *Verified fixtures*: sum_to(5) binary
    `#1111#1010#…` is `{ from: 1, to: 5 }`; fact(12) `{ from: 1, to: 33 }`; the 41-cell unary `#111…` `{ from: 1, to: 41
    }`; `window_start` 3 or a first cell `1`: `null`.
  - `session-client.test.ts`: **T7** *remembers the encoding posted for a generation*: after `supersede()` and
    `request(gen, src, 'binary')`, `encodingOf(gen)` is `'binary'`, `encodingOf(gen - 1)` `null`; a request refused for
    an old generation changes nothing.
  - `result-tm.test.ts` (browser), one boot as `result-app.test.ts`'s, viewport 1280 by 1000, sum_to(5) under binary:
    - **T2** *boxes field 0 and puts the word after it at the TM view's last step*: `⏭` in `tm-0` (`step 12,976 of
      12,976`): one `.tm-result` in the REG row, its cells reading `1111`; `.result-word` right after it; the cell after
      the box (the second `#`) starts at or right of the word's end; the other tapes' rows (WORK, STACK, HEAP, BOX)
      have the rects they had at the step before. `◀`: no box, no word, and `outside('tm-0')` equal at the two steps.
    - **T4** *says little-endian at the end of the status line when it has room*: at the end `.tm-status`'s text ends
      ` · little-endian` and the line is one row (its parts share a top); at the step before no `little-endian`.
    - **T5** *drops the words rather than wrap*: the TM view narrowed (the Explorer arrangement at a phone's width, as
      `tm-status-line.test.ts` :249 sets it, or a narrower viewport the file names and asserts): at the end no
      `.tm-endian`, and the status line's height and row count equal the step before's; the state name no more cut.
    - **T6** *takes the words back when the line widens*: then the viewport widened back with no step: the words return.
    - **T3** *says nothing of bit order under unary, and boxes the part on screen*: the picker set to `unary` and
      `let x = 40; x + 2` compiled: at the end no `little-endian`; the box holds the window's 40 cells after the `#`.
- [ ] **Step 2: Run red** (`$L/04-red*.log`): T1, T7 at the missing exports; T2-T6 at the first box or word.
- [ ] **Step 3: Build** as *Settled here*; `draw.ts` passes `encodingOf(leg.gen) === BINARY` for a TM view of the
  program; the drop is measured only while the result shows, at each status draw and on the status line's width
  change; docs say why (a line that wrapped would move the tapes under it).
- [ ] **Step 4: Run green**, and `FIREFOX tests/browser/result-tm.test.ts`.
- [ ] **Step 5: Sabotage** (`$L/04-sab-driver.mjs`):

| Id | The one edit | Must fail |
|---|---|---|
| T-1 | `resultField` returns field 1's cells | T1; T2 (`1010`) |
| T-2 | `resultField` without its `window_start` test | T1 (null cases) |
| T-3 | `draw.ts` passes `true` for the bit order | T3 |
| T-4 | the words are kept whatever the room | T5 |
| T-5 | no re-decision on a width change | T6 |
| T-6 | the word before the box | T2 |
| T-7 | `encodingOf` answers the last posted encoding for any generation | T7 |

- [ ] **Step 6: Gates and the commit**: `AFFECTED` (the new file, `tape`, `session-client`, `tm-status-line`,
  `tm-view-narrow`, `tm-grid`, `tm-pane-editor`, `field-width`, `strip-pinned-width`), `AFFECTED-FF`, `TSC`, `LINT`,
  `COMMENTS`.
- [ ] **Step 7: Report** in `$L/task-4-report.md`: T5's width and why; the sabotages; the tallies.

### Task 5: The λ view's root

**Files:**
- Modify: `web/src/lambda-body.ts` (`MARKS` :67-71, `markSpans` :95, `showTree` :444), `web/src/lambda-pane.ts`
  (`renderTree` :376, `#redraw` :906), `web/src/draw.ts` (the λ pass, :311-326), `web/src/style.css` (after the λ marks'
  rules, :1996-2040), `web/tests/browser/harness.ts` (`LambdaMark` gains `'result'`)
- Create: `web/tests/browser/result-lambda.test.ts`

**Interfaces:**
- Consumes: `resultMarked`, `lambdaEnded` (Task 3).
- Produces: `LambdaPane.renderTree(treeFor: TreeFor, pin: number | null = null, result = false): void`;
  `LambdaBody.showTree(tree, lines, outline, linked, stale, result: boolean)`.

- [ ] **Step 1: Write the cases** in `result-lambda.test.ts`, one boot as `result-app.test.ts`'s:
  - **L1** *marks the root chip at the λ view's last step*: sum_to(5), `⏭` in `lambda-0` (`step 951 of 951`): one
    `.term-mark.is-result`, holding the chip `15`; its first token's `data-marks` holds `result:`; its `::after` content
    holds `result` (read in Chromium and in Firefox, so an engine that refuses the alternative-text form fails here);
    computed outline colour `--result`'s, background not `transparent`; `.term`'s `textContent` unchanged from the step
    before but for the step's own term. `◀`: none, `outside('lambda-0')` equal.
  - **L2** *marks a Bool root*: is_even(6): the mark holds `true`.
  - **L3** *keeps the link's box when the root is pinned*: a click on the chip pins it: the run is `is-linked` and
    `is-result`, its `box-shadow` the link edge's colour and its outline the result's, and its `background-image` two
    layers (as `.is-linked.is-contractum`'s).
  - **L4** *marks no list root*: `[1, 2]`: at the end, the readout's value `[1, 2]`, and no `.is-result` and no
    `term-bar[data-lane="result"]`.
  - **L5** *draws the mark when only the result changes*: by hand with `mountLambdaBody` (`lambda-body-fixture.ts`): a
    numeral tree shown with `result` false then the same tree, lines and links with `result` true: the mark appears.
- [ ] **Step 2: Run red** into `$L/05-red.log`: L1-L3, L5 at the first `.is-result`; L4 passes (nothing marked yet),
  proven by L-1.
- [ ] **Step 3: Build** as *Settled here*; `draw.ts`'s λ pass computes `treeFor` once and passes `!detached &&
  resultMarked(program(), 'lambda', leg, lambdaEnded(treeFor))`; pair rules for `is-result` with `is-contractum` and
  `is-linked` layer the grounds.
- [ ] **Step 4: Run green**, `FIREFOX` on `result-lambda` and `marks`.
- [ ] **Step 5: Sabotage** (`$L/05-sab-driver.mjs`):

| Id | The one edit | Must fail |
|---|---|---|
| L-1 | the result marks node 0 whatever it is | L4 |
| L-2 | `showTree`'s unchanged test ignores `result` | L5 |
| L-3 | `MARKS` without `is-result`'s words | L1 (data-marks) |
| L-4 | no `::after` word | L1 (content) |
| L-5 | no `.is-result.is-linked` pair rule | L3 (two layers) |
| L-6 | `draw.ts` passes `result` `false` | L1, L2 |

- [ ] **Step 6: Gates and the commit**: `AFFECTED` (the new file, `marks`, `lambda-body`, `lambda-tree-app`,
  `lambda-follow`, `lambda-link-state`, `two-lambda-panes`, `term-map`), `AFFECTED-FF`, `TSC`, `LINT`, `COMMENTS`.
- [ ] **Step 7: Report** in `$L/task-5-report.md`.

### Task 6: The runs that end without a mark, nothing outside a view moving, and help

**Files:**
- Create: `web/tests/browser/result-stopped.test.ts`
- Modify: `web/help.html` (*Getting around*, item 2, :29-34); `web/src/draw.ts` only if a case finds a gap

**Interfaces:**
- Consumes: every view's mark (Tasks 3-5).

- [ ] **Step 1: Write the cases** in `result-stopped.test.ts`, one boot, viewport 1400 by 1000, the clif view shown:
  - **X1** *marks no view whose leg stopped short with a known value*: fact(12): the readout's TM and λ segments read
    their history full while the readout's value is `479001600`; at the λ and TM views' newest recorded steps no
    `.is-result`, `.tm-result` or `little-endian`; the rxm and clif views at their ends are marked. The app makes no
    step-cap stop with a decoded value (a TM run at its cap answers `Unfinished`: `head([])` in *Verified fixtures*), so
    a `capped` end is held by N1 alone, and these history-full stops are the app's stops with a value.
  - **X2** *draws the mark in both themes in every palette*: sum_to(5), every view at its end; for each palette in
    `#palette` and each appearance: each mark's edge colour is `--result`'s and each word's `--result-word`'s, as
    *Verified fixtures* tabulates (`rgb()` of the hex).
  - **X3** *marks nothing for a function result*: `|x| x + 1`: every view at its end, the readout `no encoding for this
    type`: no mark in any view.
  - **X4** *marks no old value on a new program*: at sum_to(5)'s end in every view, pick is_even(6) from
    *examples ▾*: until each leg's recording ends no mark anywhere; then ⏭ in each view: the marks read `true` (λ),
    `1` (rxm, clif) and field 0 `1000` (TM).
  - **X5** *moves nothing outside the view*: for each view, `outside(leaf)` at the step before and at the end are
    equal, rects to the pixel, in Explorer and in Stage with the view's tab selected.
  - **X6** *marks nothing on a copy*: an rxm copy (*edit a copy*, as `rxm-copy.test.ts` makes one) run to its end: its
    view has no `.is-result`, while the program's rxm view at its end has one.
- [ ] **Step 2: Run** into `$L/06-run.log`. Expected: all pass (the mechanism is built); each is proven by its sabotage.
- [ ] **Step 3: Sabotage** (`$L/06-sab-driver.mjs`):

| Id | The one edit | Must fail |
|---|---|---|
| X-1 | `resultMarked` is true for any `Value` at the newest step (no `done`, no `ended`) | X1 (TM) |
| X-2 | `resultMarked` skips the `Value` test | X3 |
| X-3 | `resultMarked` skips the `gen` test | X4, or report that the reset's empty history hides it (then N1 alone holds it) |
| X-4 | `.pane:has(.is-result) { margin-block-start: 1px }` | X5 |
| X-5 | `draw.ts` without the copy guard | X6 |
| X-6 | Instrument dark `result-word` is its light value | X2 |

- [ ] **Step 4: help.html.** Item 2 gains, after its last sentence: "At the last step of a run that ends with a value,
  each view marks the result with a tinted box and the word result: the term in the λ view, the first field of the REG
  tape in the TM view, the register rr in the rxm view and the value main returns in the clif view, which the rxm and
  clif views show whole in their first row. Under the binary encoding the TM view's status line adds little-endian when
  it has room: a field's leftmost cell is its least significant digit." `BROWSER` on `pages` and `NODE` on `pages` (they
  read the help page).
- [ ] **Step 5: Gates and the commit**: `AFFECTED` (every `result-*` file, `pages`, `examples`, `rxm-copy`),
  `AFFECTED-FF`, `TSC`, `LINT`, `COMMENTS`.
- [ ] **Step 6: Report** in `$L/task-6-report.md`.

### Task 7: The full gate, and the built app driven in both engines

**Files:** none unless a leg fails. One agent, and no other browser run of this lane on the machine meanwhile.

- [ ] **`GATE`** at the head, every leg. Expected: exit 0 each; line coverage over 90 and the web thresholds met;
  Firefox, Step 0's failures and no other.
- [ ] **The built app, driven** as `/home/davey/temp/redextape-return-value-record/pr1/impl/hand/` drives it
  (`vite build` into `$L/hand/dist`, `vite preview` on a free port of 4391-4399 under the browser lock), by
  `$L/hand/drive.mjs`, in Playwright's Chromium and then its Firefox, at 1412 by 896: sum_to(5) from *examples ▾*, the
  clif view shown by its toggle, ⏭ in each view; a screenshot of each view in light and in dark into `$L/hand/`; then
  fact(12), the rxm and clif views at their ends. Expected: every mark A-, T- and L- name, the words whole, no page
  error. Davey looks at the shots, and at the branch in Firefox.
- [ ] A leg that fails is fixed in a commit of its own, test first, and the legs its files feed run again.
- [ ] **Report** in `$L/task-7-report.md`: each leg's exit, seconds and tally, the coverage figures, the drive.

### Task 8: The design's as-built lines, and the roadmap entry

**Files:** `docs/superpowers/specs/2026-11-23-return-value-highlight-design.md` (a new `## As built`);
`docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (appended after the last entry, which starts at :40644).

- [ ] **The design's `## As built`**, a line each, only where the build differs from its text or settles a premise it
  stated: the dark word's 5.49:1 (the design says 5.52); Day's base0B moved; `returned`'s name; the λ chip-only rule
  (a list root is not a chip); that no program ends with a Unit value.
- [ ] **User docs.** Search `web/*.html`, `README.md` and `docs/*.md` for what a person reads about a run's end, the
  marks, the palette tokens or the endianness; change a line only where it has become false; report what the search
  found.
- [ ] **The roadmap entry**, appended in the shape of the entries above it: a `####` heading saying what a person now
  sees, then `(2026-11-23, branch `return-value-highlight`, `b627fe3..<last code commit>`, N commits, plus this entry)`;
  what changed; the rulings of *Settled here*; `##### WHAT THIS DID NOT CLOSE` (squeezed values mid-run, list results
  and the λ list mark (PR 3), function results, the final `halt`/`return` listing row, a TM field wider than the
  window, the remove-copies merge order); `##### VERIFICATION`: the gate's legs and tallies, each sabotage and the case
  it failed at with its log in `$L`, and the drive; ending with *Every count this entry quotes, with what produces it*,
  a row per figure (value, what it counts, the command). Every command is run after the last code commit into
  `$L/08-figures.log`; the entry quotes values and SHAs, not "all" or "the only".
- [ ] **Commit** the two docs; the hook's scans, `check-doc-figures` among them, pass. Report in `$L/task-8-report.md`.

### Task 9: A review of `b627fe3..HEAD`

**Files:** `$L/review.md` only.

- [ ] A fresh reviewer (opus) reads the design, this plan and `git diff b627fe3..HEAD`, edits nothing in `$W`, may run
  probes in `$L/review-probes/`, and writes `$L/review.md`: findings by severity, each with its file and line and the
  input that shows it. It asks in particular: can a mark show at a step but the last, for a value of another
  generation, a stop that is not the end, a copy, or a function or list result in λ; is the clif returned value ever
  missing from the window or guessed from a label; does any palette or import miss a floor on the mark's own ground,
  or a stored import repaint a stored token; does anything outside a view move, or the TM status line wrap; is a mark
  told by colour alone; is any case blind (a sabotage that failed at another assertion than the one named, a
  precondition a fitting layout could pass); the deleted-symbol sweep over the files the branch touched; a comment
  with history, a measurement or a task number; a roadmap figure its table does not produce.
- [ ] **Report** the findings' count by severity in `$L/task-9-report.md`.

### Task 10: The review's fixes

**Files:** as the findings need.

- [ ] Each finding is checked before it is acted on: a finding is a claim. One that holds is fixed test first, in a
  commit of its own, with a sabotage where it adds a test, and its class is searched for siblings. One that does not
  hold is answered in `$L/review.md` with the evidence.
- [ ] Then `GATE`'s legs for every file the fixes touch (all of it if a `.rs` file or a file under `web/` changed) and
  `AFFECTED-FF`, and a commit that brings the roadmap entry up to the fixes, its range, counts and figures run again
  into `$L/10-figures.log`.
- [ ] **Report** the head SHA and the tallies in `$L/task-10-report.md`. **Stop there**: pushing and opening the pull
  request wait for Davey's word.
