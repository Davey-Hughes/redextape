# LLVM IR view PR 2: the view — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the LLVM IR view design's two pull requests (§7): PR 2a, the pure `llvm-view.ts` with its node test, and
PR 2b, a sixth view kind, `llvm`, listing the module the LLVM backend builds, fetched only on intent, following the rxm
leg with rxm's step bar, linked both ways at the rxm pc, with the header and help naming six views, and a Firefox run.

**Architecture:** `llvm` is a `PaneKind` that is not a `Leg` (§3.1): its pane draws the rxm leg's `RxmState` frames, so
it has no history, recording or share link position of its own. The session worker loads `pkg-llvm/` through one
memoised literal `import()` the first time the page asks (intent on the toggle, or a view shown by a stored workspace or
link), and answers an `llvm` request with the live session's `llvmIr(clifInput())` or its refusal, one answer per
generation, as it answers `mc`. An `LlvmPane` built from `MachineViewChrome` and one `ListingPanel` draws `llvmRows`'
items and labels, marks `ordinalsOfPc(next)` and keeps `followOf(next)` in view, and once the run has ended keeps
`followOf(pc)` in view with no row marked, as `main`'s rxm listing does since #214; it links through a `LINKED.llvm`
entry.

**Tech Stack:** TypeScript, Vite, Vitest 4 (node; browser on Playwright, Chromium and Firefox), Biome; Rust 1.100,
wasm-bindgen; `pkg-llvm/` as #209 (`llvm-ir-text`, `b08753d`) built it.

**Spec:** `docs/superpowers/specs/2026-11-27-llvm-ir-view-design.md` (§4 what the user sees, §5 the pure view, §6 web,
§8 verification). Rulings: the spec's §3 (Q1 to Q5, `1a 2a 3a 4a 5b`) and §10 (the designer's calls). Evidence:
**Verified facts** below.

## Global Constraints

- **Base.** 2a on `main` at `9e7c493`, where #214 merged, rebased from `llvm-ir-text` (`b08753d`) onto `860571d`,
  where #209 merged, and then onto `9e7c493`. 2b on `main` once hidden-recording-b and move-a-view have merged; every
  line number in §6 and below is `main`'s at `9e7c493`, so find the place by name.
- **Commands.** `NODE f`: `cd web && pnpm exec vitest run --project node tests/node/f.test.ts`. `BROWSER f`:
  `VITEST_MAX_WORKERS=2 pnpm exec vitest run --project browser tests/browser/f.test.ts`, scoped by path. `FIREFOX f`:
  `BROWSER f` with `REDEXTAPE_FIREFOX=1` and `--project firefox`. `TSC`: `pnpm run typecheck`; `LINT`: `pnpm exec biome
  ci --error-on-warnings`. Long runs go into a log, never through `tail`.
- **Commits.** The pre-commit hook runs clippy `-D warnings`, `check-comments.mjs` and the scans. Never `--no-verify` or
  `--amend`; a fix is a new commit.
- **Sabotage.** Copy the file, make the one edit named, run the named test into a log, copy back, `cmp`. Never `git
  checkout`. **A sabotage that does not fire is a finding: stop and report.**
- **Copy and code.** "redextape" and "llvm" (the view's word) are lowercase in prose; LLVM, the project, is not. Copy is
  British. Doc comments are `/** */`; comments say why, never history, measurements or a `file:line`.
- **Browser tests.** Presses use `userEvent`; a claim about what a user sees asserts geometry or computed style, not
  `textContent` alone. `pkg-llvm/` is a real directory, never a symlink.
- **The import is a literal**, `import('../../pkg-llvm/redextape_llvm_wasm.js')`: `licences-scan.test.ts` reads it and
  throws on a template literal.
- **The anti-goals are constraints** (spec §1): `pkg/` does not change; nothing of `pkg-llvm/` is fetched without
  intent; the λ, TM, rxm and clif views do not change but to mark the instruction an `llvm` row pins; the rxm leg's
  recording and share link position do not change for a session no `llvm` view shows.

## Review Focus

Failure modes the design implies that no task's main test reaches, most likely first.

1. **A pc's `cont` rows after `exit`.** Following must keep the `i<pc>` block in view and still mark the `cont` rows; a
   pane that follows `ordinalsOfPc(pc)` from first to last scrolls a whole function. Task 7.
2. **The run's end.** `RxmState.next` is `null` once the run has ended; the pane marks no row current, reads no *runs
   next* and keeps `followOf(pc)` in view, as `main`'s rxm listing follows `next ?? pc` unmarked, by the user's
   ruling. A pane that marks `pc`'s rows at the end, or follows only `next` and so nothing at the end, passes every
   mid-run test. Task 7.
3. **`of('rxm')` handing an `llvm` view out as an `RxmPane`.** Whatever carries a kind whose leg is another's (§9) must
   keep the rxm views' own code, and `draw.ts`'s lookup of a pane's `LINKED` entry, from seeing an `LlvmPane`. Tasks 4
   and 8.
4. **A recompile while the module is on its way.** The old generation's answer is dropped, as `mc`'s is. Task 5.
5. **⏵ with only an `llvm` view of a session open.** It plays past the step cap, since the view counts as showing rxm.
   Task 7.

## Verified facts

Seen in a sandbox at `b08753d` with Node 22, rustc 1.100 and wasm-pack 0.15.1, every package built `--release --no-opt`
(binaryen could not be fetched).

- `llvmIr(clifInput())` answers `{ functions: [{ name, label, first_line }], lines: [{ text, pc }] }`; a refusal throws
  a string. `fn llvm(n) { n + 1 }\nllvm(41)\n` is refused with a sentence naming the intrinsic prefix `llvm.`
  (`llvm-package.test.ts`). On llvm-prefix-names it writes a module, so Task 9 stubs the refusal and Task 5 uses
  `fn llvm` only while #209's writer refuses it.
- The examples' modules: arithmetic 77 lines, closure 308, is-even 273, fact 200, map-fold 889, sum-to 214, fact-12 200;
  one to five `define`s; 112 columns at the widest.
- The examples' rxm runs end in 5 (arithmetic), 30 (closure), 79 (is-even), 69 (fact), 260 (map-fold), 84 (sum-to) and
  181 (fact-12) steps.
- pcs whose lines stand in two runs: 0, 7, 3, 2, 20, 2 and 2 in that order.
- At `860571d`, where #209 merged: the seven examples' modules, runs and split pcs as above; `fn llvm`
  refused with a sentence naming `llvm.`; and countdown, which #207 added to the examples, 226 lines, two `define`s, 112
  columns at the widest, a run that ends in 71 steps, and 3 pcs whose lines stand in two runs.
- `pkg-llvm/`'s wasm: 71,014 B gzip -9 without `wasm-opt`; `pkg/`'s 343,473 B built the same way.
- 12 browser tests and the harness name `data-shows`, `KIND_ORDER` or `HEADER_ORDER` on `main`: `controls-gate`,
  `first-load-views-tall`, `four-views-fixture`, `harness.ts`, `lambda-display-restore`, `one-id-two-kinds`,
  `restart-rewind`, `view-keys`, `view-names-rendered`, `view-toggle-focus-ring`, `view-toggles-first-paint`,
  `view-toggles-narrow`, `workspace-stored-views-order`.
- `app-header.test.ts` checks the rxm and clif glosses against `help.html`, each in its own case; `arrangements.test.ts`
  enumerates every combination of `KIND_ORDER`.

## File structure

| File | PR | What |
|---|---|---|
| `web/src/llvm-view.ts` | 2a, new | `llvmRows`, `LlvmAnswer`, `llvmNotice`, `LLVM_COPY` |
| `web/src/types.ts` | 2a | re-exports `LlvmFunction`, `LlvmLine`, `LlvmListing` |
| `web/tests/node/llvm-view.test.ts` | 2a, new | the pure view over a written module and every example |
| `web/src/panes.ts`, `layout.ts`, `app-header.ts`, `arrangements.ts`, `view-keys.ts` | 2b | the kind |
| `web/src/llvm-pane.ts` | 2b, new | the pane |
| `web/src/pane-host.ts`, `sessions.ts` | 2b | building and binding it |
| `web/src/link.ts`, `linked-legs.ts`, `draw.ts`, `link-status.ts` | 2b | links |
| `web/src/protocol.ts`, `session-worker.ts`, `session-client.ts`, `clif-loader.ts`, `machine-code.ts` or a sibling | 2b | the worker request and the answer store |
| `web/src/main.ts`, `clif-intent.ts` | 2b | fetch on intent |
| `web/help.html` | 2b | the words |

## PR 2a

### Task 1: The design and this plan

- [x] Spec and plan written; committed as `The LLVM IR view's design and plan: a sixth view, llvm, that lists the module
  as built and follows the rxm leg, fetched on intent`.

### Task 2: The LLVM IR shapes reach the page, and the view's rows, follow block and words are pure data

Spec §5. Done on `llvm-ir-view-2a`.

**Files:** Create `web/src/llvm-view.ts`, `web/tests/node/llvm-view.test.ts`; modify `web/src/types.ts`.

**Interfaces** (produces):

```ts
export type LlvmAnswer = { readonly ir: LlvmListing } | { readonly declined: string } | { readonly trapped: string }
export type LlvmFollow = { readonly first: number; readonly last: number }
export type LlvmRows = {
  readonly source: { readonly listing: readonly string[]; readonly labels: Labels }
  readonly lineOf: readonly number[]
  pcOf(ordinal: number): number | null
  ordinalsOfPc(pc: number): readonly number[]
  followOf(pc: number): LlvmFollow | null
}
export function llvmRows(ir: LlvmListing): LlvmRows
export const LLVM_COPY: { loading; writing; failed; retry; retryName; declined(why: string): string; trapped }
export function llvmNotice(load: ClifLoad, answer: LlvmAnswer | null, reason: string): LlvmNotice | null
```

- [x] **Step 1: Failing tests.** A module written in the test, two functions over 17 lines with a pc split into an `i0`
  run and a `cont` run after `exit`: the items, labels and `lineOf`; `pcOf` over every ordinal and past each end;
  `ordinalsOfPc` of a split pc, a whole pc and an absent one; `followOf` of each; a `define` taken from its function's
  `first_line`, so a line no function names is an item; a module with no function. The notice in each state and its
  order, and `LLVM_COPY` whole. Then for each example, through `pkg/` and `pkg-llvm/`: the layout reproduces the text,
  the labels sit at `first_line` and every line that starts `define ` is one; each rxm pc has items, all of its pc, and
  a follow block that starts at `i<pc>:`, holds only that pc, ends where it stops and is the first run; the marked items
  are every item with a pc; the run, stepped to its end, stands only on pcs with items, and each `next` has a block.
- [x] **Step 2: Run** `NODE llvm-view`. Seen: FAIL, `llvm-view` does not exist.
- [x] **Step 3: Implement** as Interfaces says.
- [x] **Step 4: Run** `NODE llvm-view` (32 passed; 35 at `860571d`, whose countdown example adds three cases), `TSC`,
  `LINT`, the comment check.
- [x] **Step 5: Sabotage.** Each fired; the table below lists them.

| Edit | Must fail |
|---|---|
| no labels: every line an item | the fixture's items and labels, and each example's layout |
| `followOf` spans first to last | the fixture's split pc, and each example's first run |
| `ordinalsOfPc` keeps the first run | the fixture's split pc, and each example's marked items |
| `pcOf(n)` reads item `n + 1` | `pcOf` over every ordinal |
| the leg's reason before the answer | the answer comes first |
| no `writing` notice | the package in, nothing answered |
| `LLVM_COPY` says `LLVM` | the copy |
| `retryName` reads `Retry` | the copy |
| every pc numbered one higher | each example's pcs and its run |
| pc 0 dropped | each example's pcs and its run |
| a notice over the rows | the rows say nothing |
| a `define` found by its text | a line no function names is an item |

- [x] **Commit:** `The LLVM IR view's rows, the block following keeps in view and its words are pure data, tested over
  every example's module`.

### Task 3: A fresh review of the whole diff, its findings fixed, the roadmap entry last

- [x] A reviewer with no part in the work reads `b08753d..HEAD`; each finding is fixed in a new commit or listed in the
  roadmap entry with the reason.
- [x] The roadmap entry, appended last.

## PR 2b

On a machine with a browser, after hidden-recording-b and move-a-view merge. Before
Task 4: rebuild `pkg/` and `pkg-llvm/`, and rerun `NODE llvm-view`.

### Task 4: `'llvm'` joins the kinds and every table keyed by them, with a pane that says it is loading

Spec §4 *The toggle*, §6 *The kind*, *The pane*. Review Focus 3.

**Files:** `panes.ts` (`PaneKind`, `PaneEntry`); `layout.ts` (`KIND_ORDER`, `HEADER_ORDER`, `KIND_WORD`, `DEFAULT_LEAF`,
the stored layout check); `app-header.ts` (`KIND_GLOSS`); `arrangements.ts` (`CYCLE`); `view-keys.ts`; `sessions.ts`
(`Binding`, `PaneOption`, `pairs()`); `view-header.ts` (`pairLabel`, `bindingKey`, the current pair, *another view of
this*); `pane-host.ts` (`LegPane`, `PANE_BUILD`, `SEED`, the `rebind` arm), as spec §9 lists them; new `llvm-pane.ts`.
Tests: `arrangements.test.ts`, `app-header.test.ts`, the layout tests, `view-title.test.ts`; the 12 browser tests and
the harness in Verified facts.

- [ ] **Step 1: Failing tests.** `KIND_ORDER` and `HEADER_ORDER` end `…, 'clif', 'llvm'`; `KIND_WORD.llvm` is `'llvm'`;
  `KIND_GLOSS.llvm`'s clauses are in `help.html`; `CYCLE` has no combination with `llvm`; a stored layout with an `llvm`
  leaf validates; key `6` toggles it (`view-keys`). An `llvm` view is titled `llvm · program` (`view-names-rendered`'s
  `TITLES`); its title's menu offers an `llvm` pair for each session with an rxm leg and marks the view's own pair
  current, as `view-title.test.ts`'s *lists both legs, grouped, and omits a pair the session has no leg for* holds the
  λ and TM pairs; `llvm · program` picked in an rxm view's title makes that view an `llvm` view, and `rxm · program`
  picked in an `llvm` view's makes it an rxm view.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Give `PaneEntry` and `Binding` the leg a kind draws (§9); `LlvmPane` shows
  `LLVM_COPY.loading` and nothing else yet. Read each of the 13 browser files and change each count, order or list of
  kinds it holds.
- [ ] **Step 4: Run** the node files, `TSC`, `LINT`, then `BROWSER` each of the 13.
- [ ] **Step 5: Sabotage.** `KIND_WORD.llvm` is `'LLVM'`: `app-header` or `view-names-rendered` fails. `CYCLE` keeps
  `llvm`: `arrangements` fails. `pairLabel` names the binding's leg: the title case fails. The `rebind` arm compares
  legs: the pick from the rxm view fails.
- [ ] **Commit:** `A sixth view, llvm, toggles on key 6 and says it is loading`.

### Task 5: The worker loads `pkg-llvm/` on request and answers the module or its refusal

Spec §6 *The worker*. Review Focus 4.

**Files:** `protocol.ts` (`llvm-load` and `llvm` beside `mc-load` and `mc`, their replies); `session-worker.ts` (a
`clifLoader` for `pkg-llvm/`, a literal `import()`); `session-client.ts` (methods beside `machineCode`); the answer
store. Tests: new `tests/browser/llvm-worker.test.ts` (as `mc-worker`); `licences-scan.test.ts`.

- [ ] Failing test: a request before load answers after it; a recompile drops the old generation's answer; a refused
  program answers `declined` with the writer's sentence (`fn llvm` while #209's writer refuses it; once
  llvm-prefix-names lands it writes a module, and the case needs another program the writer refuses, or goes, leaving
  the refusal to `llvm-package.test.ts` and Task 9, a call 2b makes and its roadmap entry records); a program whose rxm
  leg cannot run (no `clifInput()`) answers neither a module nor a refusal, so the view says nothing over the step
  bar's reason; a load that fails answers `failed` and a retry loads.
- [ ] Implement; `licences-scan` reads the new import. Sabotage: drop the generation check, and the recompile case
  fails.
- [ ] **Commit:** `The session worker writes a program's LLVM IR on request, loading the writer the first time`.

### Task 6: The page fetches `pkg-llvm/` on intent and never before

Spec §4, §6 *Intent*, anti-goals.

**Files:** `main.ts` (`watchIntent` on the `llvm` toggle and in the workspace menu); a stored workspace or link showing
an `llvm` view. Tests: new `llvm-fetch`, `llvm-fetch-rest`, `llvm-fetch-focus`, `llvm-fetch-toggle`,
`llvm-fetch-stored`, `llvm-fetch-menu` (as the `mc-fetch-*` and `clif-fetch-*` tests).

- [ ] Failing tests: no request for `pkg-llvm/` on load, or on opening, stepping or linking any other view; one on rest,
  press, focus, the menu, and a stored layout showing the view.
- [ ] Sabotage: watch nothing, and rest fails; fetch on load, and the first fails.
- [ ] **Commit:** `The llvm view's package is fetched when the pointer rests on its toggle, or it is pressed or
  focused`.

### Task 7: The view lists the module, follows the rxm run with rxm's step bar, and counts as showing rxm

Spec §4 *The listing*, *Following the run*, *The step bar*, §6 *Shown*. Review Focus 1, 2, 5.

**Files:** `llvm-pane.ts` (`MachineViewChrome`, one `ListingPanel` with a label hook, `llvmRows`, `llvmNotice`); where
hidden-recording-b asks whether a view shows a leg. Following the run's end uses `ListingPanel.show`'s block, on `main`
since #214, which follows a block apart from the row it marks, as `next` is `null` once the run has ended. `followOf`'s
`{ first, last }` goes to it as `{ follow: first, last }`: mid-run `followOf(next)`, with `show`'s `next` its `first`,
the `i<pc>` row that reads *runs next*; at the end `followOf(pc)` with `next` `null`, and `{ follow: null }` where
`followOf` is `null`. `LlvmFollow` keeps its names: the node test holds them, and this call is the one place that reads
them. `pane-host.ts`'s `SEED.llvm` gives the pane its session's answer. Tests: new `llvm-pane`, `llvm-frames`,
`llvm-shown`; `view-title.test.ts`.

- [ ] Failing tests: `define` rows are labels drawn as the clif function row is; stepping `fact` marks every row of
  `next`, `cont` rows too, reads *runs next* on its `i<pc>` row and keeps that block in view (geometry); at the end no
  row is marked current, none reads *runs next*, and the `i<pc>` block of the frame's `pc`, the `halt`, is in view
  (geometry), having been out of view before the end (the precondition), as the end cases #214 added to
  `rxm-pane.test.ts` and `mc-panel-layout.test.ts` hold; the step bar's step equals the rxm view's; with only an `llvm`
  view of a session open, ⏵ plays past the cap; an `llvm` view picked onto a second session lists that session's module
  and is titled `llvm · second`, and picked back lists the first's, as `view-title.test.ts`'s *rebinds the pane when a
  session is picked, and follows it back* holds a λ view's.
- [ ] Sabotage: follow `ordinalsOfPc` first to last, and the follow geometry fails; mark `pc`'s rows at the end, and
  the end case fails at its marks; follow only `next`, and it fails at its geometry; omit `llvm` from what shows rxm,
  and `llvm-shown` fails; `SEED.llvm` does nothing, and the pick onto the second session fails at its rows.
- [ ] **Commit:** `The llvm view lists the module and follows the rxm run, sharing its step bar`.

### Task 8: Rows link both ways at the rxm pc

Spec §4 *Links*, §6 *Links*.

**Files:** `link.ts` (`Pin.origin`, `InstrLeg`), `linked-legs.ts` (`LINKED.llvm`, `LINKED.rxm.rows`,
`LINKED.clif.rows`; `LinkedLeg`, which keys `LINKED`, `LINKED_LEGS` and `perLinkedLeg`, widened to take `llvm`;
`LINKED.llvm.focusNode` given `RxmState`; `isLinkedLeg` asked of a kind), `draw.ts` (a pane's `LINKED` entry found
by its kind, not its binding's leg), `link-status.ts` (the `llvm` entry's clauses, and `legs` keyed with `llvm`), as
spec §9 lists them. Tests: `linked-legs.test.ts`, new `llvm-link`.

- [ ] Failing tests: a click on an `i<pc>` row pins that pc with origin `llvm`, and the rxm view marks that instruction;
  a pin on an rxm row marks every row of its pc in the `llvm` view; a construct pinned in the source marks its
  instructions' rows; a click on a row with no pc links nothing.
- [ ] Sabotage: `LINKED.rxm.rows` ignores an `llvm` pin, and the rxm side fails.
- [ ] **Commit:** `An llvm row links its rxm instruction, and a pin made elsewhere marks the rows of its pcs`.

### Task 9: The view says why it has no rows

Spec §4 *With no rows*.

**Tests:** new `llvm-app-failed` (a failed load, then Retry), `llvm-declined` (a refusal), `llvm-threw` (a trap); each
asserts `LLVM_COPY`'s words and that a module already received is shown over the leg's reason. The failed load's button
shows `LLVM_COPY.retry` and takes `LLVM_COPY.retryName` as its accessible name and its `title`, as a11y-leftovers names
the clif notice's Retry `Retry loading clif` and the machine code panel's `Retry loading machine code`. **THE REFUSAL IS
A STUBBED ANSWER, NOT A PROGRAM**: the pane is given a store whose answer is `{ declined: <sentence> }`, as
`mc-pane.test.ts`'s *a declined answer* case gives the machine code panel one. `fn llvm(n) { n + 1 }`, which #209's
writer refuses, writes a module once llvm-prefix-names lands, and that branch's own package test reaches a refusal only
through an input built by hand, `{ program: { code: [{ Call: 'missing' }, 'Halt'], labels: [] } }`, not from a program.

- [ ] **Commit:** `The llvm view says when its package failed to load, and why a program has no module`.

### Task 10: Workspaces and share links carry an `llvm` view

Spec §4 *Workspaces and links*.

**Tests:** `share-link.test.ts`, layout tests; new `llvm-layout-stored` and a share link opened with the view.

- [ ] Failing tests: a stored workspace and a share link round-trip an `llvm` leaf and fetch the package; a share link
  holds no position of its own for it.
- [ ] **Commit:** `Stored workspaces and share links keep an llvm view`.

### Task 11: The help page and the keys name the sixth view

Spec §4 *Help*, §6 *Words*.

**Files:** `help.html` (the views paragraph, its sentence naming what shows the row a run stopped on among them, a link
to `crates/redextape-native/src/ll_text.rs` on the repository's GitHub page, key `6` in the keys table). Tests:
`pages.test.ts`, `app-header.test.ts`.

- [ ] **Commit:** `The help page names the llvm view and links the writer's source`.

### Task 12: The anti-goals measured, the full gate, Firefox, the roadmap entry

- [ ] `pkg/` byte-identical to `main`'s build; no `pkg-llvm/` request on load (Task 6's test); the λ, TM, rxm and clif
  browser files unchanged and green.
- [ ] The full node and browser tiers, `FIREFOX` on every `llvm-*` file, `scripts/check-all.sh`, and every `run:` in
  `.forgejo/workflows/ci.yml` that the machine can run.
- [ ] The roadmap entry, last.

## Spec coverage

| Spec | Task |
|---|---|
| §4 The toggle | 4, 11 |
| §4 The listing, Following the run, The step bar | 2 (`llvmRows`, `followOf`), 7 |
| §4 Links | 2 (`pcOf`, `ordinalsOfPc`), 8 |
| §4 With no rows | 2 (`llvmNotice`, `LLVM_COPY`), 9 |
| §4 Workspaces and links | 10 |
| §4 Help | 11 |
| §5 | 2 |
| §6 | 4 to 11 |
| §1 anti-goals, §8 | 6, 12 |
