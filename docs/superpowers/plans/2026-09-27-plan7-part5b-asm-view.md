# Plan 7 part 5b — asm as the web app's third leg, and the asm view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make asm the web app's third execution leg beside λ and TM — recorded by the session worker, stepped by the controls λ and TM already use, counted in the readout — and give it a view: a listing that follows the instruction about to run, and registers, call stack and heap panels, linked to the source by each instruction's owner. The view half of [Plan 7 part 5](../specs/2026-09-27-plan7-part5-asm-design.md), §5–§6.

**Architecture:** A refactor first makes every branch on a leg or a pane kind a switch `tsc` holds to every member (`legs.ts`), and a second extracts the TM rule table's virtualized grid into `VirtualGrid`, which the asm listing then shares; a third task fixes a bug on `main` the grid carried, a link's scroll that a following grid undid a frame later. The core's view model gains `AsmState` — the asm cursor cut to a window the renderer sets — and `AsmProgram`; the wasm session runs the program to its end at compile time and exposes six asm methods and an `asmOwner` column in its link index. The asm view (`AsmPane`, with its pure model in `asm-view.ts`) is built and tested on its own, then `Leg` gains `'asm'` and the worker, the session registry, the readout and the default tree follow `tsc`'s list; linking comes last.

**Tech Stack:** Rust (`redextape-core`, `redextape-wasm`, ts-rs bindings, wasm-bindgen), TypeScript (vanilla DOM), Vitest (node and browser projects, Playwright Chromium), bash (`scripts/build-web-bindings.sh`).

## Global Constraints

- The spec is `docs/superpowers/specs/2026-09-27-plan7-part5-asm-design.md` **as amended** — amendments 6 to 21 are 5b's. Where this plan and the spec disagree, stop and ask.
- `Leg` is `'lambda' | 'asm' | 'tm'` and `PaneKind` gains `'asm'`. A branch on either is a `switch` that returns a value, or ends in `default: unhandled(x)` (`legs.ts`); a per-leg table is a `Record<Leg, …>` or `perLeg`; a list of legs is `LEGS`, in `LEG_NAME`'s order: λ, asm, TM (amendment 8).
- A copy's leg is `CopyLeg`, λ or TM, until part 5c (amendment 20). No copy has an asm leg and no asm view shows a copy.
- A word crosses the boundary as its decimal string with its `WordTag` (§5.3, amendment 13). The window's bounds live in `protocol.ts`'s `ASM_WINDOW`: 64 locals, 16 arguments, 8 frames, 16 cells, 16 boxes (amendment 17).
- A stack, heap or memory cap ends a recording with no continue, and the step line names the cap: `RecordEnd` gains `stack-full`, `heap-full` and `memory-full` (amendment 10). Only the step cap is `capped`.
- The default tree is (source | λ) above (asm | TM), λ first (amendment 12); `LAYOUT_VERSION` and `WORKSPACE_VERSION` do not move.
- An instruction's owner travels in the link index as `asmOwner`, not in `AsmProgram` (amendment 14). An instruction `defunc` minted links to nothing, and the status line says "this instruction has no source construct" (amendments 11, 19).
- The umbrella's §4 rules bind every control: a glyph-only control takes its tooltip as its accessible name; a control that cannot apply is removed, one that could but cannot now is disabled with its reason. Every mark has a non-colour cue.
- No library path may panic: no `unwrap`, `expect`, `panic!` or unchecked indexing outside tests.
- Doc comments are `///` in Rust and `/** */` in TypeScript. No `file:line` citations in tracked source (the pre-commit hook rejects them); they are normal in `docs/`. A possessive citation (`` `x.ts`'s `sym` ``) must name the file that declares the symbol. No plan task numbers in shipped code.
- The pre-commit hook runs `cargo fmt --check`, clippy with `-D warnings` (pedantic), `biome ci --error-on-warnings`, `pnpm run typecheck` and the hygiene scans on every commit. Never `--no-verify`.
- No colour literal outside the palette's fallback block in `web/src/style.css` (the colour gate).
- Every native test and build runs under `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0`. A Rust sabotage run uses `--no-fail-fast`, and its *Summary* line is read, not only its `FAIL` lines.
- **Run one browser suite at a time.** Two started together on one machine have hung, both idle, until killed, and a browser run under another's load has timed out a wait that passes alone. **Do not edit files a browser run is using**: Vite reloads the modules mid-run and the failures that follow are the edit's, not the code's.
- **A sabotage run can write files of its own.** A failing proptest writes a `*.proptest-regressions` seed, and a failing browser test a screenshot under `web/tests/browser/__screenshots__/` (gitignored). After every sabotage, `git status` must show only what the task changed.

## How to use the code in this plan

**The code below is the prototype's, verbatim, and it was rebuilt from this document's own blocks before the plan was committed** (see Pre-flight status). Every change is a patch:

- Save the block to a file **outside the repository** (the session scratchpad) and run `git apply <that file>` from the repository root. A patch that does not apply means the tree has drifted from the state this plan was built against — this plan's own commit plus the tasks before it. Stop and report; do not hand-merge.
- Each task's **tests' half** goes in first, so the red step can be observed; then its **source half**. A new file appears in its patch whole (`new file mode`). A Rust source file whose test module changed puts the module in the tests' half and the rest in the source half.
- The patches are fenced with four backticks, because some carry a doc comment's own three.

**Build the wasm before a web task's browser tests**, from `web/`: `pnpm run build:wasm` (the release build CI uses; a dev build's deeper stack frames change what a deep test can reach) and `pnpm run build:bindings`, which `pnpm run typecheck` and `pnpm test` also run. A fresh checkout or worktree also needs the language server's package once, `pnpm run build:lsp-wasm`, or `tsc` cannot find `pkg-lsp/`.

**Stage before running a hygiene scan by hand.** `check-attributions` resolves a citation against *tracked* files, so a new file that is not yet `git add`ed reads as missing. The hook runs on the staged commit, where that cannot happen.

**Use your own `CARGO_TARGET_DIR` in a worktree.** A scratch worktree building into the main checkout's `target/` has linked the other checkout's library before; give each checkout its own directory under `target/`.

**Where `web/node_modules` is a symlink** to another checkout's, no web font loads (Vite's allow-list), `fonts.test.ts` fails its two cases, and every text-geometry result differs from a real install's. Install the checkout's own (`pnpm install --frozen-lockfile`).

## Pre-flight status

**Every task was built, gated and sabotaged before this plan was written**, in a scratch worktree off `9b7681d`. It was then rebuilt task by task from this document's own code blocks on a fresh worktree at `d403a45`, the spec's last amendment — which differs from `9b7681d` only in `docs/` — as an executor would. Each task's tests' half was applied and its red step run as written, then its source half; the tree was staged and compared with the prototype's, `docs/` aside; its green steps were run as written and it was committed through the pre-commit hook; and every sabotage in its table was run, one at a time, restored after each. Every *Expected* block below is what that run printed, and every *Fails* column is what that sabotage failed there.

| Task | Tree against the prototype | Red step | Green steps and hook | Sabotages fired |
|---|---|---|---|---|
| 1 | IDENTICAL | none: the task changes no behaviour | passed | — |
| 2 | IDENTICAL | 1 test failed | passed | 13 of 13 |
| 3 | IDENTICAL | 2 tests failed | passed | 5 of 5 |
| 4 | IDENTICAL | failed to compile | passed | 32 of 32 |
| 5 | IDENTICAL | failed to compile | passed | 28 of 28 |
| 6 | IDENTICAL | failed: its test files cannot load the modules the source half adds | passed | 29 of 29 |
| 7 | IDENTICAL | 17 tests failed | passed | 18 of 18 |
| 8 | IDENTICAL | 14 tests failed | passed | 14 of 14 |

**139 sabotages were run, one at a time; 139 fired on the test they were aimed at.** Each task lists its own.

**What replaying this plan found, before it was committed:**

1. **A fresh worktree could not typecheck.** `tsc` resolves the language server's module from `pkg-lsp/`, which no task builds and a new checkout does not have. "How to use" now says to build it once.
2. **One sabotage in Task 5's table was aimed at text amendment 15 had already replaced**: sabotage 15 edited the fault's old wording, "faulted at pc…", and its anchor was gone. Aimed at the current wording, it fails the fault test and nothing else.

**What the prototype found, all answered in the code below:**

1. **The web app's legs were two-way in more places than the spec counted, and three dispatches no compiler could check** (amendment 8). The survey at `899c8b2` found 12 two-way branches and 13 hand-written two-leg shapes, against §2.3's 14 branches; Task 1's sibling search is in its step 1. `replies.ts`'s two switches on a reply's kind and the worker's chain on a request's kind had no exhaustive end, so an `asm-frames` reply nothing handled would have been dropped with `tsc` green. With `'asm'` added to `Leg` and `PaneKind` before Task 1, `tsc` reported 13 errors, none of them at the 12 branches; after it, 31: 22 in `src/`, at the switches and tables a third leg has to fill, and 9 `DetachedPanes` literals in `tests/` (Task 1, step 4, lists them).
2. **`link-wiring.ts`'s slot lookup slipped the first probe.** Its `switch` returns a value that may be `undefined`, the one kind TS2366 does not police, so a leg with no arm read as a leg with no view. It ends in `unhandled` like a statement `switch` (Task 1).
3. **`panel.ts` overwrote a body's declared role.** Building the grid before its panel made the rule table a `region` again; a body that already says what it is now keeps its role (Task 2).
4. **The grid's closed-panel test could not fail as first written.** Hiding the box drops the scroll event, and a test that counted two frames ran before the event it was about when the whole file ran — the sabotage fired alone and not in the file. The tests now await the event itself (Task 2, sabotages 10 and 11).
5. **A type both crates emit refused the web bindings build.** The wasm crate's `AsmStatus` names core's `AsmCap`, ts-rs writes a dependency's file with its dependent, and `build-web-bindings.sh` refused any basename both crates wrote — so from Task 5 on, every web commit's hook would have failed. The script now lets through a file both crates write with the same bytes, and still refuses two different types of one name (Task 5).
6. **Spec §8's fault wording read "fault: faulted at …" on screen** (amendment 15): every reader of a fault value prints `fault: ` before it. The value is "head of empty list at pc1" (Task 5).
7. **Adding `'asm'` to `Leg` is what needs the view.** Every view's title menu offers every leg's pairs, so the leg cannot land before a view can show it; the view is built and tested alone first (Task 6) and the leg wired after (Task 7), where the approved outline had the order the other way round.
8. **The grid's standalone test clicked off the page.** A 1,000-pixel host in the default 414-pixel viewport put the row's centre past the page's edge, and a real click landed on nothing; the view's suite sets a real viewport (Task 6).
9. **A panel's own margin sat inside the shared row's share**, leaving the registers and the call stack 8 pixels shorter than the heap beside them; the row carries the spacing (Task 6).
10. **At depth 0 "left over from caller" is false** (amendment 18): a local the bank grew past was never written, and there is no caller (Task 6).
11. **The controls gate was green and blind to the asm view.** It walked a hand-written `['lambda-0', 'tm-0']`, so the new view's controls were never checked and nothing failed; it now reads the views off the page and asserts the default tree's three (Task 7).
12. **The new default tree broke tests in 16 browser test files**, every one a test's assumption rather than a defect: three leaves, the TM view's width, the strip's order, a menu read by position. Each keeps its subject; the two that measure the TM view's geometry close the asm view first and assert the width they need (Task 7).
13. **`asmRecordEnd` belongs in `protocol.ts`, not the worker**, where `forkable` already lives for the same reason: the worker is outside the coverage gate and no test reaches it (Task 7).
14. **A word costs 48.23 bytes and is charged 52** (amendment 17), measured by `frame-cost.test.ts`, which now fails if a word ever costs more than it is charged (Task 7).
15. **A construct neither lowering bills anything to would have been said twice** — "no machine states" and "no instructions" side by side on the constructs most often clicked — and is said once (amendment 19, Task 8).
16. **A link scrolled a following grid for one frame, on `main`** (amendment 21), found looking at the asm view by hand: the scroll's own event redrew the grid, which scrolled back to the run's row. `app.test.ts` had a guard for exactly this and it passed, reading the table in the link's own turn (Task 3).
17. **The asm pin's keystroke clear passed with the clear deleted.** The test waited up to ten seconds for the marks to go, and the recompile the keystroke schedules clears them anyway, through `setProgram`, once it lands. It now asserts with no `await` after the edit, as the TM focus's own test does (Task 8, sabotage 11).
18. **A sabotage that stopped the first compile reaching the asm view failed `beforeAll`, not the test it was aimed at**: the setup waited for the listing, so all seven cases were skipped and the named one never ran. The wait is now that test's own (Task 7, sabotage 11).

**Verified fixtures**, each measured by running it — every figure below is one a test in this plan asserts:

| Fixture | Where | Measured |
|---|---|---|
| `let x = 40; x + 2` | Tasks 5, 7, 8 | 5 instructions to 42; instruction 0 is `li r0, #40`, owned by `40`; `add rr, r1, r2` at pc3 is owned by `x + 2` |
| `fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)` | Tasks 5–8 | 21 instructions under 4 labels, 25 listing rows; every instruction has an owner |
| `head([])` | Task 5 | faults: "head of empty list at pc1" |
| 34 ones multiplied (33 multiplications, one past `MAX_MUL_INSTRS`) | Tasks 5, 7 | the TM refuses the machine as too large; asm runs 68 instructions to 1 |
| `let mut n = 1; while n > 0 { n = n + 1; } n` | Task 5 | the TM declines it as overflowing; compile's asm run spends the whole 5,000,000-step cap and has no value |
| `fn inc(x) { x + 1 } fn t(g) { g(3) } fn ap(h, y) { h(y) } t(inc) + ap(t, inc)` | Tasks 5, 7 | λ runs it; asm declines: "the asm backend does not support cyclic higher-order call graph through `t`" |
| a 2,048-element list literal | Task 5 | the asm lowering refuses: "the program nests deeper than the asm lowering guard allows" |
| `map` over `[3, 1, 2]` with a closure | Task 8 | has instructions `defunc` minted, read off the page's own `linkIndex` as the `-1`s in `asmOwner` |
| `upto(200)` | Task 7 | 2,814 frames holding 247,091 words; 48.23 bytes a word by heap differential in both runs measured (48.2328 and 48.2333), which the ring charges 52 |

## File structure

**Created**

| File | Task | Responsibility |
|---|---|---|
| `web/src/legs.ts` | 1, 7 | the leg vocabulary: `LEG_NAME` (the one place a leg's name lives), `LEGS`, `perLeg`, `unhandled`, and from Task 7 `CopyLeg` |
| `web/src/virtual-grid.ts` | 2, 3 | `VirtualGrid`, the virtualized roving grid the TM rule table and the asm listing share; from Task 3 a link's scroll holds it until the run moves |
| `web/src/asm-view.ts` | 6 | the asm view's pure model: listing rows, instruction parts, register rows, the unwritten-local legend, back-references, the heap summary |
| `web/src/asm-pane.ts` | 6 | `AsmPane`, the asm view: the listing on a `VirtualGrid`, and the registers, call stack and heap panels |

**Modified**

| File | Task | What changes |
|---|---|---|
| `web/src/{draw,layout,link-status,link-wiring,link,lsp-protocol,main,pane-host,panes,replies,scratch,session-worker,sessions,view-header,buffer-list}.ts` | 1 | each branch on a leg or a pane kind is a switch `tsc` holds to every member; each two-leg list reads `LEGS` or a `Record<Leg, …>` |
| `web/src/tm-pane.ts`, `web/src/panel.ts` | 2 | the rule table draws through `VirtualGrid`; a panel keeps a role its body declares |
| `web/src/{tm-pane,link-wiring,draw}.ts` | 3 | comments that described a link's scroll as lasting one draw |
| `crates/redextape-core/src/viewmodel.rs` | 4 | `AsmWindow`, `AsmWord`, `AsmCallFrame`, `AsmCell`, `AsmBox`, `AsmProgram`, `AsmState` and `AsmState::window` |
| `crates/redextape-core/src/trace/asm_cursor.rs`, `crates/redextape-core/src/tm/asm.rs` | 4, 5 | `WordTag` and `AsmCap` gain their derives; `reg_str` becomes `pub(crate)`; a doc |
| `crates/redextape-wasm/src/session.rs`, `crates/redextape-wasm/src/lib.rs` | 5 | the asm leg: `AsmStatus`, compile's run to the end, the six methods, `linkIndex`'s `asmOwner` |
| `scripts/build-web-bindings.sh` | 5 | a file both crates write with the same bytes is written once |
| `web/src/style.css`, `web/src/types.ts`, `web/src/pane-chrome.ts` | 6 | the asm view's rules; the core asm types; `PaneEvents.linkInstr` |
| `web/src/protocol.ts` | 7 | `Leg` gains `'asm'`; `ASM_WINDOW`, `ASM_WORD_BYTES`, `asmFrameBytes`, `asmRecordEnd`; the `asm-frames` reply; the new caps in `RecordEnd` |
| `web/src/{session-worker,replies,sessions,main,pane-host,draw,readout,results,controls,layout,lsp-protocol,scratch,buffer-list,buffers-store,link,link-wiring}.ts` | 7 | the asm arm of every switch; the worker records asm between λ and TM; the session keeps the listing; the readout's asm segment; the default tree; `CopyLeg` for a copy |
| `web/src/{link,link-status,link-wiring,transport,draw,main}.ts` | 8 | `nodeForInstr` and `Link.instrs`; the ownerless status; the fan-out to asm views; the asm run's focus |

---

### Task 1: Every branch on a leg or a pane kind is a switch `tsc` holds to every member

**Files:**
- Create: `web/src/legs.ts`
- Modify: `web/src/buffer-list.ts`, `web/src/draw.ts`, `web/src/layout.ts`, `web/src/link-status.ts`, `web/src/link-wiring.ts`, `web/src/link.ts`, `web/src/lsp-protocol.ts`, `web/src/main.ts`, `web/src/pane-host.ts`, `web/src/panes.ts`, `web/src/replies.ts`, `web/src/scratch.ts`, `web/src/session-worker.ts`, `web/src/sessions.ts`, `web/src/view-header.ts`
- Modify (tests): `web/tests/browser/two-lambda-panes.test.ts` — one comment, which named the two slot helpers this task folds into one

**Interfaces:**
- Produces `legs.ts`: `LEG_NAME: Readonly<Record<Leg, string>>` (λ, TM — the one place a leg's name lives), `LEGS: readonly Leg[]` (read off `LEG_NAME`'s keys; moved here from `sessions.ts`), `perLeg(value)`, and `unhandled(value: never): void`, the end of a statement `switch`.
- Produces `panes.ts`'s `legOfPane(kind: PaneKind): Leg | null`; `link.ts`'s `Pin.origin` becomes `'source' | Leg`; `link-status.ts`'s `DetachedPanes` becomes `Record<Leg, boolean>`, its sentence built from the detached legs' names.
- Changes no behaviour and no test's code.

**NO BEHAVIOUR CHANGES, AND THAT IS THE PROOF.** Every two-way branch that read "not λ" as "TM" becomes a `switch` returning a value — a missing arm is TS2366 under `strict` — or one ending in `default: unhandled(x)`; every hand-written two-leg list reads `LEGS` or a `Record<Leg, …>`. `replies.ts`'s two switches on a reply's kind and the worker's request dispatch gain arms for the kinds that cannot arrive on their path, each with its reason, and end in `unhandled`. The whole existing suite passes with no test's code touched, and step 4 shows what the task is for: with `'asm'` added to `Leg` and `PaneKind`, `tsc` names every site a third leg must decide.

**LEFT FOR TASK 7, BECAUSE A TEST CALLS THEIR SHAPE:** `resetLegs`, `resultRows`, the readout's `programSegments`, and the `compiled`/`result` messages. `buffers-store.ts` is a copy's store and part 5c's.

**`unhandled` DOES NOT THROW.** The types say no value reaches it; if one did — a reply from a worker the page did not expect — the `switch` it ends did nothing for that value before this task, and several sit in handlers where a throw would abandon the rest of the reply. `link-wiring.ts`'s slot lookup returns a value that may be `undefined`, the one kind TS2366 does not police, so it ends in `unhandled` too (what the prototype found, 2).

- [ ] **Step 1: The sibling search, then the tests' half.** Before any code, list every site that tells one leg from another. From `web/`:

```sh
for p in "'lambda'" "'tm'" "=== 'tm'" "!== 'tm'" "=== 'lambda'" "!== 'lambda'" "'λ'" "'TM'" "lambda: " "tm: "; do grep -rnF -- "$p" src; done | grep -vE '^[^:]+:[0-9]+:\s*(\*|//)' | sort -u
```

Each hit is one of four things: a two-way branch that reads "not λ" as TM, which becomes a `switch`; a hand-written list or shape of the two legs, which reads `LEGS` or a `Record<Leg, …>`; code about one leg alone — a guard such as `leg === 'lambda'` for something only λ has, a TM view's own call, a λ binder's glyph, a language id — which is right for a third leg and stays; or one of the shapes left for Task 7 above. The source half below is that search's answer. Run it again after the source half: every hit left is a `case`, a type, a `Record<Leg, …>` entry, code about one leg, or one of Task 7's. The only test change is a comment in `two-lambda-panes.test.ts` that named the two slot helpers this task folds into one:

````diff apply=tests task=1
diff --git a/web/tests/browser/two-lambda-panes.test.ts b/web/tests/browser/two-lambda-panes.test.ts
index ca332f1..b2822dd 100644
--- a/web/tests/browser/two-lambda-panes.test.ts
+++ b/web/tests/browser/two-lambda-panes.test.ts
@@ -546,7 +546,7 @@ describe('two λ panes on two λ sessions', () => {
    * IT DRIVES BOTH ENTRY POINTS, because they are reachable independently and one fix could plausibly
    * miss either. `draw()` is the per-frame path (the TM transport below); `link-wiring.ts` is reached
    * from the source editor's own `updateListener` on every keystroke, through `drawLink` ->
-   * `detachedPanes` -> `theTmSlot`/`theLambdaSlot`, with no λ pane to resolve.
+   * `detachedPanes` -> `theSlot`, per leg, with no λ pane to resolve.
    */
   it('keeps working after the last λ pane is closed, rather than throwing on every frame', async () => {
     // UNHANDLED ERRORS ARE COLLECTED, NOT INFERRED FROM A GREEN ASSERTION. A throw inside a click
````


- [ ] **Step 2: No red step.** This task changes no behaviour, so no test can go red; step 4 is its proof, and step 5 holds it to the whole existing suite.

- [ ] **Step 3: Write the code.**

````diff apply=source task=1
diff --git a/web/src/buffer-list.ts b/web/src/buffer-list.ts
index 7764d6d..281bd39 100644
--- a/web/src/buffer-list.ts
+++ b/web/src/buffer-list.ts
@@ -1,3 +1,4 @@
+import { LEG_NAME } from './legs'
 import type { Leg } from './protocol'
 import type { SessionId } from './session-client'
 
@@ -135,7 +136,7 @@ const bufferRow = (
   // `viewReadout` is a general-purpose reader with no idea `warm` exists, and branching it on a fact
   // from a field it is not passed would tangle two concerns this file otherwise keeps apart. The row
   // still reads correctly, just not minimally — and minimality is not what this comment is fixing.
-  const said = `${row.leg === 'lambda' ? 'λ' : 'TM'} ${row.label}`
+  const said = `${LEG_NAME[row.leg]} ${row.label}`
   name.textContent = `${said} · ${viewReadout(row.paneCount)} · ${row.warm ? 'running' : 'paused'}`
 
   /**
diff --git a/web/src/draw.ts b/web/src/draw.ts
index a2d1155..f2cf160 100644
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -2,6 +2,7 @@ import type { EditorView } from '@codemirror/view'
 import { setFocus } from './highlight'
 import type { LambdaPane } from './lambda-pane'
 import type { LambdaTrees } from './lambda-trees'
+import { unhandled } from './legs'
 import { isCoincident, type Link, runningFocus, sourceNodeOwner } from './link'
 import type { LambdaLinkState } from './link-status'
 import type { LinkWiring } from './link-wiring'
@@ -355,15 +356,26 @@ export function createDraw(deps: {
       const name = nameOf(session) ?? 'a copy'
       const leg = entry.slot.resolve(sessions)
       // **THE LEG FACTS ARE HOISTED OUT OF THE OLD TERNARY**, because both thunks below read them and a
-      // value built inside one branch is a value the other cannot see.
+      // value built inside one of them is a value the other cannot see.
       const lambdaLeg = { newestStep: leg.hist.newestStep, done: leg.done, status: leg.status }
       const tmLeg = { newestStep: leg.hist.newestStep, status: leg.status }
       const reading = sessions.entryOf(session).tmScratch
-      const isLambda = entry.slot.binding.leg === 'lambda'
-      readout.show(null, {
-        segments: () => (isLambda ? lambdaCopySegments(name, lambdaLeg) : tmCopySegments(name, reading, tmLeg)),
-        rows: () => copyRows(isLambda ? lambdaCopyParts(name, lambdaLeg) : tmCopyParts(name, reading, tmLeg)),
-      })
+      switch (entry.slot.binding.leg) {
+        case 'lambda':
+          readout.show(null, {
+            segments: () => lambdaCopySegments(name, lambdaLeg),
+            rows: () => copyRows(lambdaCopyParts(name, lambdaLeg)),
+          })
+          break
+        case 'tm':
+          readout.show(null, {
+            segments: () => tmCopySegments(name, reading, tmLeg),
+            rows: () => copyRows(tmCopyParts(name, reading, tmLeg)),
+          })
+          break
+        default:
+          unhandled(entry.slot.binding.leg)
+      }
     }
 
     // THE BAR (spec §8), AFTER THE READOUT AND AFTER EVERY PANE. It resolves its own target through the
diff --git a/web/src/layout.ts b/web/src/layout.ts
index a559b51..ad5ada7 100644
--- a/web/src/layout.ts
+++ b/web/src/layout.ts
@@ -379,7 +379,18 @@ export function serializeLayout(root: LayoutNode): string {
   return JSON.stringify({ version: LAYOUT_VERSION, tree: root })
 }
 
-const PANE_KINDS: readonly string[] = ['source', 'lambda', 'tm']
+/**
+ * Every `PaneKind`, as the strings a stored leaf's `pane` may hold.
+ *
+ * **KEYED BY `PaneKind` AND THEN LISTED, RATHER THAN WRITTEN AS A LIST.** It is typed `string[]` because
+ * `validate` asks it about a string not yet known to be a kind, and a list typed that way says nothing about
+ * the union; even `satisfies readonly PaneKind[]` would say only that each entry is a kind, never that each
+ * kind is an entry. A kind left out here would fail `validate` for every stored layout that shows one, and a
+ * layout that fails is replaced by the default without a word (`parseLayout`'s own doc), so a view of the new
+ * kind would be lost on every reload with `tsc` green. The `satisfies` makes a missing kind a type error, and
+ * the keys are the list (`legs.ts` has the class of bug).
+ */
+const PANE_KINDS: readonly string[] = Object.keys({ source: 0, lambda: 0, tm: 0 } satisfies Record<PaneKind, 0>)
 
 /**
  * Validate one node and collect its leaf ids, returning `false` on the first violation.
diff --git a/web/src/legs.ts b/web/src/legs.ts
new file mode 100644
index 0000000..9267705
--- /dev/null
+++ b/web/src/legs.ts
@@ -0,0 +1,78 @@
+import type { Leg } from './protocol'
+
+/**
+ * THE LEG VOCABULARY — each leg's name as a user reads it, the order the app lists legs in, a table with an
+ * entry per leg, and the end of a `switch` over one.
+ *
+ * **IT EXISTS FOR ONE CLASS OF BUG: A BRANCH THAT READS "NOT λ" AS "TM".** Through Plan 7 part 5a the app had
+ * two legs, and most of the sites that had to tell them apart asked one question — `leg === 'lambda' ? … : …`
+ * — and put TM in the else. That is correct for exactly as long as there are two legs, and no site written
+ * that way can say so: the day a third leg arrives, each one hands it TM's name, TM's request or TM's pane
+ * class, with `tsc` green. Part 5's spec §2.3 found these branches by reading and its amendment 8 found more
+ * by searching, and it says of both counts that an inventory is not a gate.
+ *
+ * **SO THE COMPILER IS THE GATE, AND THIS MODULE IS WHAT IT READS.** A branch on the leg is a `switch` with
+ * one arm per leg. One that returns a value is exhaustive already, since a missing arm is TS2366 under
+ * `strict`; one that only acts, or that may answer `undefined`, ends in `default: unhandled(leg)`. A per-leg
+ * table is a `Record<Leg, …>`, or is built by `perLeg` when every leg's entry follows one rule, and a list of
+ * the legs is `LEGS`. Adding a member to `Leg` then makes `tsc` name every site that has not decided what the
+ * new leg does, which is the inventory derived rather than trusted.
+ */
+
+/**
+ * Each leg's name as a user reads it: a view's title (`λ · program`), a copy's name (`TM copy 2`), the copies
+ * menu, and the link status line's detachment clause.
+ *
+ * **READ HERE BY EVERY SITE THAT HOLDS A `Leg` AND SAYS IT**, where each used to spell `leg === 'lambda' ?
+ * 'λ' : 'TM'` for itself — which named a third leg `TM` at every one of them.
+ *
+ * **AN ANNOTATION, NOT `as const satisfies`**, the form `editor-prefs.ts`'s `KEYMAP_LABEL` takes. Either makes
+ * a leg with no name a type error here; `satisfies` would also make it one at every lookup by a `Leg`, since
+ * the literal type it keeps has no key for the new leg, so one missing entry would be reported once per site
+ * that only reads it.
+ */
+export const LEG_NAME: Readonly<Record<Leg, string>> = { lambda: 'λ', tm: 'TM' }
+
+/**
+ * Every leg, in the order the app lists them — the title-selector's groups (`SessionRegistry.pairs`) and the
+ * detachment clause's names (`link-status.ts`'s `detachedText`).
+ *
+ * **READ OFF `LEG_NAME`'s KEYS RATHER THAN WRITTEN OUT**, the idiom `editor-prefs.ts`'s `KEYMAP_MODES` already
+ * takes. A written list only says that each entry is a leg — `['lambda'] satisfies readonly Leg[]` typechecks —
+ * so a leg left out of it would be offered by no selector and named by no clause, silently. `LEG_NAME`'s type
+ * makes a missing key an error and its literal's excess-property check refuses an extra one, so its keys are
+ * exactly `Leg`, which is what the cast restates: `Object.keys` answers `string[]` for every object, because a
+ * value may carry keys its type does not name, and this one is a literal that cannot. The order is
+ * `LEG_NAME`'s, since an object's string keys enumerate in insertion order.
+ *
+ * A VALUE RATHER THAN A KEY WALK OVER SOME ENTRY'S `legs`, because the order must not depend on which legs the
+ * first session in the registry happens to have — the reason this list gave when it lived in `sessions.ts`.
+ */
+export const LEGS: readonly Leg[] = Object.keys(LEG_NAME) as Leg[]
+
+/**
+ * A table with one entry per leg, each entry `value(leg)`.
+ *
+ * **FOR A TABLE WHOSE ENTRIES FOLLOW ONE RULE**, such as a flag every leg starts without: there a new leg has
+ * nothing to decide, so a literal that made `tsc` ask anyway would be noise in exactly the list this module
+ * exists to keep meaningful. A table whose entries differ by leg is a `Record<Leg, …>` literal instead, where
+ * a missing leg is a type error at the table.
+ */
+export function perLeg<T>(value: (leg: Leg) => T): Record<Leg, T> {
+  return Object.fromEntries(LEGS.map((leg) => [leg, value(leg)])) as Record<Leg, T>
+}
+
+/**
+ * The end of a statement `switch` over a union: `default: unhandled(value)`.
+ *
+ * **ITS WHOLE JOB IS DONE BY `tsc`.** Once every member has an arm, the value that reaches `default` has type
+ * `never`, which is the only type this accepts; a member with no arm reaches it with its own type, and the call
+ * is a type error at the `switch` that forgot it. A `switch` that returns a value needs none of this — unless
+ * `undefined` is one of the values, since TS2366 polices only a function whose return type excludes it, and a
+ * missing arm would then answer `undefined` with `tsc` green (`link-wiring.ts`'s `theSlot` is that case).
+ *
+ * **IT DOES NOTHING WHEN CALLED, AND IT DOES NOT THROW.** The types say no value gets here. If one did — a
+ * reply from a worker the page did not expect — the `switch` it ends did nothing for that value before this
+ * existed, and several of them sit in handlers where a throw would abandon the rest of the reply.
+ */
+export function unhandled(_value: never): void {}
diff --git a/web/src/link-status.ts b/web/src/link-status.ts
index e15755b..3305e30 100644
--- a/web/src/link-status.ts
+++ b/web/src/link-status.ts
@@ -1,3 +1,6 @@
+import { LEG_NAME, LEGS, perLeg } from './legs'
+import type { Leg } from './protocol'
+
 /**
  * Why a pane is not showing a link, in words.
  *
@@ -61,23 +64,26 @@ export type LambdaLinkState =
  * THAT pane; the source session keeps running and the TM pane stays bound to it. So "λ detached, TM
  * still linked" is the ordinary state, not a corner, and a single flag could not name it.
  *
- * TWO REQUIRED BOOLEANS RATHER THAN A LIST OR A THREE-WAY TAG (`'lambda' | 'tm' | 'both'`). A caller
- * holds two bindings and reads one boolean off each; a tag would make every caller encode the cross
+ * An entry is `true` when that leg's pane is bound to a copy: for `lambda` a `LambdaScratch`, which has no
+ * `SourceMap` and so no `sourceSpan`/`linkIndex` (§3.3); for `tm` a `TmScratch`, whose every `TmState`
+ * carries `source_node: null` (§3.1).
+ *
+ * ONE REQUIRED BOOLEAN PER LEG RATHER THAN A LIST OR A TAG (`'lambda' | 'tm' | 'both'`). A caller
+ * holds one binding per leg and reads one boolean off each; a tag would make every caller encode the cross
  * product, and a `Pane[]` would admit duplicates and an order that means nothing. The cost is that
  * "nothing detached" is spellable twice — this record all-false, or `LinkStatus.detached` absent —
  * and `linkStatus` collapses the two deliberately (see its own note).
  *
+ * **A `Record` OVER `Leg`, WHERE IT USED TO BE TWO NAMED FIELDS**, so a new leg is a required entry here and
+ * a type error at every literal that leaves it out, rather than a pane whose copy the status line never
+ * mentions (`legs.ts` has the class of bug).
+ *
  * NOT A `Set` OR A MAP KEYED BY PANE ID, EITHER, and that is a 5d-i/5d-ii boundary rather than an
  * oversight: 5d-i's pane set is fixed at three slots (§1), so the panes that can detach are known at
  * compile time and a fixed record is checkable where a keyed collection is not. 5d-ii's multiplexer
  * is what makes the pane set open, and it can widen this then.
  */
-export type DetachedPanes = {
-  /** The λ pane is bound to a `LambdaScratch`, which has no `SourceMap` and so no `sourceSpan`/`linkIndex` (§3.3). */
-  lambda: boolean
-  /** The TM pane is bound to a `TmScratch`, whose every `TmState` carries `source_node: null` (§3.1). */
-  tm: boolean
-}
+export type DetachedPanes = Record<Leg, boolean>
 
 export type LinkStatus = {
   /**
@@ -148,25 +154,31 @@ const LAMBDA_TEXT: Record<LambdaLinkState, string> = {
   absent: '',
 }
 
-const ATTACHED: DetachedPanes = { lambda: false, tm: false }
+const ATTACHED: DetachedPanes = perLeg(() => false)
 
 /**
- * The detachment clause, or `''` when both panes are inside the correspondence.
+ * The detachment clause, or `''` when every leg's pane is inside the correspondence.
  *
- * ONE CLAUSE FOR BOTH VIEWS, NOT THE SAME SENTENCE TWICE. "not linked to the program" is one fact about
- * one correspondence; emitting it either side of a `·` would read as two unrelated failures, and the
- * line is already carrying up to three other parts.
+ * ONE CLAUSE FOR EVERY DETACHED VIEW, NOT THE SAME SENTENCE ONCE PER VIEW. "not linked to the program" is
+ * one fact about one correspondence; emitting it either side of a `·` would read as two unrelated
+ * failures, and the line is already carrying up to three other parts.
  *
  * "shows a copy" IS SAID IN THE SAME BREATH AS WHAT IT MEANS, deliberately. `copy · not linked` in the
  * view's header is the glanceable half, with the view's own title beside it to say which view. This
  * line is the authoritative narration (§4.5), and a reader who has never made a copy cannot derive
  * "not linked to the program" from the word (Plan 7 part 2 spec §12's vocabulary).
+ *
+ * **THE NAMES ARE BUILT FROM `LEGS` AND `LEG_NAME`, WHERE THE THREE SENTENCES WERE WRITTEN OUT**, one per
+ * combination of two legs — a third leg would have been in none of them. The words for one leg and for two
+ * are the ones those sentences said: `λ view shows a copy`, `λ and TM views show copies`. More than two
+ * join as a list does, `a, b and c`.
  */
 function detachedText(d: DetachedPanes): string {
-  if (d.lambda && d.tm) return 'λ and TM views show copies — not linked to the program'
-  if (d.lambda) return 'λ view shows a copy — not linked to the program'
-  if (d.tm) return 'TM view shows a copy — not linked to the program'
-  return ''
+  const names = LEGS.filter((leg) => d[leg]).map((leg) => LEG_NAME[leg])
+  const last = names.pop()
+  if (last === undefined) return ''
+  if (names.length === 0) return `${last} view shows a copy — not linked to the program`
+  return `${names.join(', ')} and ${last} views show copies — not linked to the program`
 }
 
 /**
diff --git a/web/src/link-wiring.ts b/web/src/link-wiring.ts
index e605b3a..141d36e 100644
--- a/web/src/link-wiring.ts
+++ b/web/src/link-wiring.ts
@@ -1,8 +1,10 @@
 import type { EditorView } from '@codemirror/view'
 import { setLink } from './highlight'
+import { perLeg, unhandled } from './legs'
 import type { Link, LinkIndex, Pin } from './link'
 import { type DetachedPanes, type LambdaLinkState, linkStatus } from './link-status'
 import { onPage, type PaneCollection } from './panes'
+import type { Leg } from './protocol'
 import type { PaneSlot, SessionRegistry } from './sessions'
 import type { TmPane } from './tm-pane'
 
@@ -51,7 +53,7 @@ export type LinkWiring = {
   get link(): Pin | null
   clearLink(): void
   drawLink(l: Link | null, focusCoincident: boolean, lambda: LambdaLinkState): void
-  setLinkTo(node: number | null, origin: 'source' | 'lambda' | 'tm'): void
+  setLinkTo(node: number | null, origin: Pin['origin']): void
   linkAtSourceOffset(byteOffset: number): void
 }
 
@@ -71,37 +73,52 @@ export function createLinkWiring(deps: {
   const linkStatusHost = deps.statusHost
 
   /**
-   * "THE" λ pane's slot and "the" TM pane's slot — `undefined` when that leg holds no pane at all —
-   * resolved fresh from the collection on every read rather than cached, the same thunk idiom
-   * `view`/`draw` above already use for the same reason: the answer can change under a caller that
-   * keeps this closure around.
+   * "The" pane's slot on `leg` — `undefined` when that leg holds no pane at all — resolved fresh from the
+   * collection on every read rather than cached, the same thunk idiom `view`/`draw` above already use for
+   * the same reason: the answer can change under a caller that keeps this closure around.
    *
-   * STAND IN FOR THE `lambdaSlot`/`tmSlot` CONSTS THIS FACTORY USED TO CLOSE OVER DIRECTLY (T7). NO
-   * LONGER "still exactly one pane of each kind", which is what these two used to assert twice by
+   * **ONE LOOKUP OVER `Leg`, WHERE THERE WERE TWO NAMED ONES, `theLambdaSlot` AND `theTmSlot`**, which
+   * `detachedPanes` called each by name. A pair of per-leg functions is a list of the legs written out, and a
+   * third leg would not be on it with `tsc` green (`legs.ts` has the class of bug); with a `switch`, a leg
+   * with no arm is a type error here.
+   *
+   * STANDS IN FOR THE `lambdaSlot`/`tmSlot` CONSTS THIS FACTORY USED TO CLOSE OVER DIRECTLY (T7). NO
+   * LONGER "still exactly one pane of each kind", which is what those two used to assert twice by
    * throwing on an empty collection. That invariant expired when `pane-host.ts`'s `applyLayout` started
    * deriving panes from the layout tree — `closeLeaf` refuses only the last leaf in the TREE, so
    * closing the one λ pane a fresh page ships is an ordinary gesture, and `drawLink` ->
-   * `detachedPanes` -> `theTmSlot` runs on every `draw()`, a keystroke's included. `PaneCollection.active`
+   * `detachedPanes` -> `theSlot` runs on every `draw()`, a keystroke's included. `PaneCollection.active`
    * answers the question now, and `shown` below is built on it — the pane the user last focused on that
    * leg, falling back to insertion order when none is marked or the mark no longer resolves (5d-ii-b) —
    * and its own doc has the argument for why all four consumers were once carrying a private copy of the
    * same expired invariant.
    *
-   * **EACH MUST NAME THE VIEW ITS LEG'S OTHER CLAUSES DESCRIBE**, because `linkStatus` suppresses a
-   * detached view's own clauses. `theTmSlot` asks `active`, the pane `draw()`'s TM running focus reads, so
-   * the copy clause and the "the machine is here" clause are about one view. `theLambdaSlot` asks
-   * `PaneCollection.shown` — `active` among the panes on the page — first, because that is the view `draw()`
-   * takes the λ link clause from: in Stage the active pane can be off the page, and a hidden view's pin
-   * and tree are stale (`shown`'s own doc). **WITH NO λ VIEW ON THE PAGE IT FALLS BACK TO `active`**, as
-   * the TM clause does, so a hidden λ copy is still named: the λ link clause then reads `'absent'` and says
-   * nothing, so there is no clause about another view for the copy's to contradict.
+   * **EACH ARM MUST NAME THE VIEW ITS LEG'S OTHER CLAUSES DESCRIBE**, because `linkStatus` suppresses a
+   * detached view's own clauses; each arm says which view that is.
    *
    * `detachedPanes` BELOW GIVES AN HONEST ANSWER FOR ABSENCE RATHER THAN PROPAGATING IT: a pane that
    * does not exist is not detached. `draw()` gives the λ link state the same kind of answer, `'absent'`.
    */
-  const theLambdaSlot = (): PaneSlot<'lambda'> | undefined =>
-    (panes.shown('lambda', onPage) ?? panes.active('lambda'))?.slot
-  const theTmSlot = (): PaneSlot<'tm'> | undefined => panes.active('tm')?.slot
+  const theSlot = (leg: Leg): PaneSlot<Leg> | undefined => {
+    switch (leg) {
+      case 'lambda':
+        // `PaneCollection.shown` — `active` among the panes on the page — FIRST, because that is the view
+        // `draw()` takes the λ link clause from: in Stage the active pane can be off the page, and a hidden
+        // view's pin and tree are stale (`shown`'s own doc). **WITH NO λ VIEW ON THE PAGE IT FALLS BACK TO
+        // `active`**, as the TM arm does, so a hidden λ copy is still named: the λ link clause then reads
+        // `'absent'` and says nothing, so there is no clause about another view for the copy's to contradict.
+        return (panes.shown('lambda', onPage) ?? panes.active('lambda'))?.slot
+      case 'tm':
+        // `active`, THE PANE `draw()`'s TM RUNNING FOCUS READS, so the copy clause and the "the machine is
+        // here" clause are about one view.
+        return panes.active('tm')?.slot
+      default:
+        // `unhandled` BECAUSE THIS `switch` RETURNS A VALUE THAT MAY BE `undefined`, which is the one kind
+        // TS2366 does not police: a leg with no arm would fall off the end and read as a leg with no pane.
+        unhandled(leg)
+        return undefined
+    }
+  }
 
   /**
    * Which panes are outside the source correspondence right now — §4.5's first surface, read off the
@@ -119,16 +136,13 @@ export function createLinkWiring(deps: {
    * Detachment is a property of the SESSION a pane is BOUND to, so with no pane there is no binding to
    * read and nothing is outside the correspondence — and the clause this drives ("λ view shows a copy —
    * not linked to the program") would otherwise narrate a pane that does not exist. A λ pane OFF the page,
-   * in Stage, still reads its session's detachment, as a hidden TM pane does (`theLambdaSlot`).
+   * in Stage, still reads its session's detachment, as a hidden TM pane does (`theSlot`'s λ arm).
    */
-  const detachedPanes = (): DetachedPanes => {
-    const lambda = theLambdaSlot()
-    const tm = theTmSlot()
-    return {
-      lambda: lambda !== undefined && sessions.entryOf(lambda.binding.session).detached,
-      tm: tm !== undefined && sessions.entryOf(tm.binding.session).detached,
-    }
-  }
+  const detachedPanes = (): DetachedPanes =>
+    perLeg((leg) => {
+      const slot = theSlot(leg)
+      return slot !== undefined && sessions.entryOf(slot.binding.session).detached
+    })
 
   /**
    * The current compile's link index, and the construct the user has linked.
@@ -194,7 +208,7 @@ export function createLinkWiring(deps: {
    * looking at moves the thing under their cursor, so the table scrolls for a source click and not
    * for its own.
    */
-  const setLinkTo = (node: number | null, origin: 'source' | 'lambda' | 'tm') => {
+  const setLinkTo = (node: number | null, origin: Pin['origin']) => {
     link = node === null ? null : { node, origin }
     // ONE `linkFor` CALL, reused for both legs it drives here — see `drawLink`'s doc for why a second
     // call on a path that runs per rendered frame during playback is not free.
diff --git a/web/src/link.ts b/web/src/link.ts
index 3d4f838..9843562 100644
--- a/web/src/link.ts
+++ b/web/src/link.ts
@@ -9,6 +9,7 @@
 // eight programs was 29.4% — nowhere close. One program crossing is not "more than one", so
 // the gate did not trip: `WITHIN` RENDERS AS A HIGHLIGHT, same as `Exact`, just visibly weaker — see
 // `main.ts`'s `draw()` for the wiring and `style.css`'s `.is-focus-within` for the weaker treatment.
+import type { Leg } from './protocol'
 import type { Cut, Owner, Span } from './types'
 import { ownerNode } from './types'
 
@@ -158,8 +159,14 @@ export class LinkIndex {
 /** `runningFocus`'s return shape, named so `isCoincident` and callers can share it rather than re-typing it. */
 export type Focus = { node: number; claim: 'exact' | 'within' }
 
-/** The construct a click set — `main.ts`'s own `link` state, named so `isCoincident` can share the shape. */
-export type Pin = { node: number; origin: 'source' | 'lambda' | 'tm' }
+/**
+ * The construct a click set — `main.ts`'s own `link` state, named so `isCoincident` can share the shape.
+ *
+ * `origin` IS THE SOURCE VIEW OR A LEG, AND IS TYPED FROM `Leg` RATHER THAN SPELLED OUT, so a new leg can pin
+ * without this union being found and widened by hand (`legs.ts` has the class of bug) — and `link-wiring.ts`'s
+ * `setLinkTo` takes `Pin['origin']` rather than spelling it a second time.
+ */
+export type Pin = { node: number; origin: 'source' | Leg }
 
 /**
  * The source construct the CURRENT β-step belongs to — the source pane's running focus — as a node
diff --git a/web/src/lsp-protocol.ts b/web/src/lsp-protocol.ts
index 431254a..038377a 100644
--- a/web/src/lsp-protocol.ts
+++ b/web/src/lsp-protocol.ts
@@ -16,6 +16,8 @@
  * indistinguishable from a file with no problems in it. Every other field here fails visibly.
  */
 
+import type { PaneKind } from './panes'
+
 /** A request id. Monotonic, assigned by `LspClient`; `0` is never used, so it can mean "none". */
 export type RequestId = number
 
@@ -81,12 +83,21 @@ export const LANGUAGE_IDS = ['redextape', 'redextape_lambda', 'redextape_tm', 'r
 
 export type LanguageId = (typeof LANGUAGE_IDS)[number]
 
-/** The app's three editor kinds, and the language each one holds. `asm` has no editor until part 5. */
-export const LANGUAGE_OF_PANE = {
+/**
+ * The app's three editor kinds, and the language each one holds. `asm` has no editor until part 5.
+ *
+ * **KEYED BY `PaneKind`, WHERE IT USED TO SPELL `'source' | 'lambda' | 'tm'` OUT.** The spelled union was a
+ * second copy of `PaneKind` that nothing held to the first, so a new pane kind would have left this map
+ * without it and `transport.ts`'s lookups by leg reading `undefined` as a language. Now a kind with no language
+ * is a type error here (`legs.ts` has the class of bug) — and only here: an annotation rather than the
+ * `as const satisfies` its neighbours take, for the reason `legs.ts`'s `LEG_NAME` gives. Those neighbours are
+ * looked up by exactly the keys they have; this one is looked up by `Leg`.
+ */
+export const LANGUAGE_OF_PANE: Readonly<Record<PaneKind, LanguageId>> = {
   source: 'redextape',
   lambda: 'redextape_lambda',
   tm: 'redextape_tm',
-} as const satisfies Record<'source' | 'lambda' | 'tm', LanguageId>
+}
 
 /**
  * How each language reads in a sentence shown to a user — the colourer's failure notice is the one
@@ -94,7 +105,7 @@ export const LANGUAGE_OF_PANE = {
  *
  * **THE WORDS ARE THE APP'S EXISTING ONES, NOT NEW ONES**, per the umbrella's rule that every
  * user-visible word is the umbrella's: `source` is what `main.ts`'s `layoutChanged` calls the source
- * view, and `λ`/`TM` are `view-header.ts`'s `legLabel` — the same two glyphs every view title and
+ * view, and `λ`/`TM` are `legs.ts`'s `LEG_NAME` — the same two glyphs every view title and
  * every menu item already carries. A second vocabulary for the same three surfaces is what this map
  * exists to avoid.
  *
diff --git a/web/src/main.ts b/web/src/main.ts
index 344fbd2..b0a7ea2 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -27,6 +27,7 @@ import { History } from './history'
 import { icon } from './icons'
 import { LambdaTrees } from './lambda-trees'
 import { closeLeaf, defaultLayout, LAYOUT_STORAGE_KEY, type LayoutNode, leaves, SOURCE_LEAF } from './layout'
+import { LEG_NAME } from './legs'
 import { createLinkWiring, type LinkWiring } from './link-wiring'
 import { LspClient } from './lsp-client'
 import { lspHover } from './lsp-hover'
@@ -39,14 +40,14 @@ import { createOutlinePanel } from './outline'
 import type { PaneChoice } from './pane-chrome'
 import { createPaneHost, type LayoutEvent } from './pane-host'
 import { createPanel } from './panel'
-import { type LeafId, PaneCollection } from './panes'
-import type { RunReply } from './protocol'
+import { type LeafId, legOfPane, PaneCollection } from './panes'
+import type { Leg, RunReply } from './protocol'
 import { HISTORY_BYTES } from './protocol'
 import { createReadout, type ProgramResult } from './readout'
 import { createReplies } from './replies'
 import { BufferCapReached, type BufferRecord, MAX_WARM_BUFFERS, ScratchBuffers } from './scratch'
 import { type SessionId, SessionPool } from './session-client'
-import { legControlState, SessionRegistry } from './sessions'
+import { legControlState, type SessionLegs, SessionRegistry } from './sessions'
 import {
   applySkin,
   PALETTE_CHOICE_LABELS,
@@ -624,6 +625,10 @@ async function main(): Promise<EditorView> {
     label: 'program',
     detached: false,
     client: pool.bind(SOURCE_SESSION, (reply: RunReply) => replies.onReply(SOURCE_SESSION, reply)),
+    // EVERY LEG, AND THE `satisfies` IS WHAT SAYS SO. `SessionLegs` makes each leg optional because a copy
+    // has one (its own doc), so a leg left out of this literal would still typecheck, and the program would
+    // have no such leg to record, to bind a view to, or to offer in a selector. `Required` makes a leg with no
+    // entry here a type error instead (`legs.ts` has the class of bug).
     legs: {
       lambda: {
         hist: new History<LambdaState>(HISTORY_BYTES),
@@ -637,7 +642,7 @@ async function main(): Promise<EditorView> {
         done: null,
         playing: false,
       },
-    },
+    } satisfies Required<SessionLegs>,
     // NOTHING COMPILED YET, AND THIS SESSION IS THE ONE THAT EVER WILL — `compiled` is the reply the
     // scratch types cannot send (§4.1), so the scratchpad's own entry states the same `null` and keeps
     // it. See `SessionEntry.tmProgram` for what reads this and when.
@@ -1151,7 +1156,10 @@ async function main(): Promise<EditorView> {
   if (restoredBuffers !== null) {
     scratchpad.restore(restoredBuffers)
     const legOfLeaf = new Map(
-      leaves(tree).flatMap((l) => (l.pane === 'lambda' || l.pane === 'tm' ? [[l.id, l.pane] as const] : [])),
+      leaves(tree).flatMap((l) => {
+        const leg = legOfPane(l.pane)
+        return leg === null ? [] : [[l.id, leg] as const]
+      }),
     )
     const legOfBuffer = new Map(restoredBuffers.buffers.map((b) => [b.id, b.leg] as const))
     for (const [leaf, session] of Object.entries(restoredBuffers.bindings)) {
@@ -1395,7 +1403,7 @@ async function main(): Promise<EditorView> {
    */
   const undo = (record: BufferRecord, shown: readonly LeafId[]): void => {
     scratchpad.reinstate(record)
-    const name = scratchpad.nameOf(record.id) ?? `${record.leg === 'lambda' ? 'λ' : 'TM'} ${record.label}`
+    const name = scratchpad.nameOf(record.id) ?? `${LEG_NAME[record.leg]} ${record.label}`
     try {
       scratchpad.warm(record.id)
     } catch (e) {
@@ -1426,6 +1434,29 @@ async function main(): Promise<EditorView> {
     else buffersButton.focus()
   }
 
+  /**
+   * What a WARM copy's row says it holds — the leg's current frame, as its text, or `null` for a leg whose
+   * frame has none. The copies menu's `term` below asks this, and only for a warm buffer (that doc has why).
+   *
+   * **A BRANCH ON THE LEG IS WHAT KEEPS THIS FROM THROWING FOR A WARM TM BUFFER — 5d-iv T5 REVIEW FIX.**
+   * `legOf({ session, leg: 'lambda' })` unconditionally is a throw for any warm buffer whose entry has no
+   * `lambda` leg at all — every TM buffer, by the legs `ScratchBuffers` registers for one (`scratch.ts`) —
+   * which escaped the `beforetoggle` handler exactly the way a cold buffer's did before `term` below
+   * branched on `warm`.
+   */
+  const copyTerm = (session: SessionId, leg: Leg): string | null => {
+    switch (leg) {
+      case 'lambda':
+        return sessions.legOf({ session, leg: 'lambda' }).hist.current?.text ?? null
+      case 'tm':
+        // `TmState` (`types.ts`) carries no printable `text` field the way `LambdaState` does — a
+        // configuration is tape windows and a state index, not a term to print — so there is no equivalent
+        // string to join for a TM row today; it reads `null` (`no term yet` in the row) rather than
+        // inventing one.
+        return null
+    }
+  }
+
   /**
    * **THE HEADER'S BUFFER LIST — design §4.2's surface, and §4.4's poison recovery arriving with it.**
    * This is the call that closes the window decision 2 opened: until it existed the app could create
@@ -1500,23 +1531,13 @@ async function main(): Promise<EditorView> {
          * on purpose, so asking and catching would be treating a designed state as an exception — and
          * it would also swallow the genuine wiring bug the throw exists to report.
          *
-         * **A SECOND BRANCH, ON `b.leg`, IS WHAT KEEPS THIS FROM THROWING FOR A WARM TM BUFFER TOO —
-         * 5d-iv T5 REVIEW FIX.** `legOf({ session: b.id, leg: 'lambda' })` unconditionally is a throw for
-         * any warm buffer whose entry has no `lambda` leg at all — every TM buffer, by `#spawn`'s own
-         * construction (`scratch.ts`'s own doc) — which escaped the `beforetoggle` handler exactly the
-         * way the cold case above used to. `TmState` (`types.ts`) carries no printable `text` field the
-         * way `LambdaState` does — a configuration is tape windows and a state index, not a term to
-         * print — so there is no equivalent string to join for a TM row today; it reads `null` (`no term
-         * yet` in the row) rather than inventing one.
+         * **A SECOND BRANCH, ON `b.leg`, IS `copyTerm`'s** — see its own doc for why a warm TM buffer
+         * needs it too.
          *
          * For what this doc used to claim and why it changed, see the history note under `buffers` —
          * the row builder's `term`.
          */
-        term: b.warm
-          ? b.leg === 'lambda'
-            ? (sessions.legOf({ session: b.id, leg: 'lambda' }).hist.current?.text ?? null)
-            : null
-          : null,
+        term: b.warm ? copyTerm(b.id, b.leg) : null,
         warm: b.warm,
         leg: b.leg,
       })),
@@ -1692,7 +1713,7 @@ async function main(): Promise<EditorView> {
    * `applyLayout`'s FIRST CALL HAS RUN", AND THE `reportStorageFailure` MOVE MADE THAT FALSE — 5d-ii-d
    * review round 2, Finding 1.** `refreshBuffers()`'s start-up call (this function's own doc has the
    * full argument for where it sits) can now reach `reportStorageFailure()` reaches `draw()` reaches
-   * `linkWiring.drawLink(...)` reaches `detachedPanes()` here — `theLambdaSlot()`/`theTmSlot()` read
+   * `linkWiring.drawLink(...)` reaches `detachedPanes()` here — `theSlot(leg)` reads
    * `panes.shown(...)`/`panes.active(...)` — all before `paneHost.applyLayout()` has ever run once.
    *
    * **TWO MORE CALLS REACH `draw()` BEFORE `applyLayout()` DOES, NEITHER THROUGH
diff --git a/web/src/pane-host.ts b/web/src/pane-host.ts
index 5dbcf2d..e00d553 100644
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -12,6 +12,7 @@ import {
   splitLeaf,
 } from './layout'
 import { renderLayout, renderStage, syncSizes } from './layout-view'
+import { unhandled } from './legs'
 import type { PaneChoice, PaneEvents } from './pane-chrome'
 import type { LeafId, PaneCollection, PaneKind } from './panes'
 import type { Leg } from './protocol'
@@ -165,6 +166,34 @@ export type LayoutEvent =
   | { readonly kind: 'added' | 'switched'; readonly leaf: LeafId; readonly shows: PaneChoice }
   | { readonly kind: 'closed'; readonly leaf: LeafId; readonly showed: PaneChoice }
 
+/**
+ * Whether a pane of `kind` can hold a copy's editor — what `rebind`'s same-leg arm asks before it hands an
+ * outgoing editor to custody and mounts one on the arriving side.
+ *
+ * **A `switch`, SO THAT A NEW KIND HAS TO SAY WHETHER ITS VIEW EDITS.** This was `kind === 'lambda' || kind ===
+ * 'tm'` at its one call site, which answers `false` for a third leg's kind with `tsc` green (`legs.ts` has the
+ * class of bug) — the same shape as the defect the TM arm below records.
+ */
+function holdsEditor(kind: PaneKind): boolean {
+  switch (kind) {
+    case 'source':
+      // NO ENTRY IS EVER OF THIS KIND — `applyLayout`'s creation pass skips the source leaf — and the one
+      // editor the source view holds is the program's, which no rebind hands anywhere.
+      return false
+    case 'lambda':
+      return true
+    case 'tm':
+      // **`'tm'` TOO, WHERE THE CHECK USED TO BE `'lambda'` ALONE — 5d-iv T10.** A `ScratchBuffers.forkBlank`'d
+      // TM buffer binds no pane at mint, so the ONLY way a TM pane ever comes to show one is the same-leg
+      // rebind arm — and until this widened, that arm's condition was `false` for every TM pane, so `moved`
+      // stayed `null`, no outgoing editor was ever taken into custody (harmless for a pane that never held
+      // one) and — the real defect — `mountScratchEditor` was never called for the ARRIVING side either, so a
+      // TM pane picked onto a warm buffer through its own selector rendered that buffer's frames with no
+      // editor and no route to one.
+      return true
+  }
+}
+
 export function createPaneHost(deps: {
   root: HTMLElement
   panes: PaneCollection
@@ -721,18 +750,13 @@ export function createPaneHost(deps: {
            * makes the cast sound; `slot.binding.leg` would answer the same today, and the entry's own
            * kind is the fact the cast is actually about.
            *
-           * **BOTH `'lambda'` AND `'tm'`, WHERE THIS USED TO CHECK ONLY `'lambda'` — 5d-iv T10.** A
-           * `ScratchBuffers.forkBlank`'d TM buffer binds no pane at mint, so the ONLY way a TM pane ever
-           * comes to show one is this same-leg rebind arm — and until this widened, the condition below
-           * was `false` for every TM pane, so `moved` stayed `null`, no outgoing editor was ever taken
-           * into custody (harmless for a pane that never held one) and — the real defect —
-           * `mountScratchEditor` below was never called for the ARRIVING side either, so a TM pane picked
-           * onto a warm buffer through its own selector rendered that buffer's frames with no editor and
-           * no route to one. `entry.pane as unknown as EditablePane`, not `as LambdaPane`: `TmPane`
-           * implements `EditablePane` exactly as `LambdaPane` does (`editor-custody.ts`'s own doc), and
-           * `PaneView<LegFrame[K]>` — what `entry.pane` is actually typed as — shares no member with
-           * either concrete class, which is why the cast still needs the `unknown` step `editor-custody.
-           * ts`'s `editorHomeFor` already takes for the identical reason.
+           * **`holdsEditor` ANSWERS FOR BOTH λ AND TM PANES, WHERE THIS USED TO CHECK ONLY `'lambda'` —
+           * 5d-iv T10**, and its TM arm records what the narrower check cost this arm. `entry.pane as
+           * unknown as EditablePane`, not `as LambdaPane`: `TmPane` implements `EditablePane` exactly as
+           * `LambdaPane` does (`editor-custody.ts`'s own doc), and `PaneView<LegFrame[K]>` — what
+           * `entry.pane` is actually typed as — shares no member with either concrete class, which is why
+           * the cast still needs the `unknown` step `editor-custody.ts`'s `editorHomeFor` already takes for
+           * the identical reason.
            *
            * **RESOLVED ONCE INTO `moved` AND READ ON BOTH SIDES OF `base.rebind`** — the outgoing
            * handover above it and the arriving mount below it are the same pane under the same two
@@ -746,7 +770,7 @@ export function createPaneHost(deps: {
           const leaving = slot.binding.session
           const entry = panes.get(id)
           const moved =
-            choice.session !== leaving && (entry?.kind === 'lambda' || entry?.kind === 'tm')
+            choice.session !== leaving && entry !== undefined && holdsEditor(entry.kind)
               ? (entry.pane as unknown as EditablePane)
               : null
           if (moved !== null) {
@@ -940,24 +964,30 @@ export function createPaneHost(deps: {
       // a branch. `live.get` answers `undefined` for a departed leaf, and no `PaneKind` equals that.
       if (live.get(p.id) === p.kind) continue
       // THE CUSTODY HANDOVER, AND IT HAS TO BE ON THIS SIDE OF `panes.remove` — see this function's own
-      // doc. `takeEditor()` returns `null` for every λ pane that was not holding one, which is all of
+      // doc. `takeEditor()` returns `null` for every pane that was not holding one, which is all of
       // them on an ordinary close, so this costs a method call and a field read on the way out.
-      if (p.slot.binding.leg === 'lambda') {
-        const held = (p.pane as LambdaPane).takeEditor()
-        if (held !== null) custody.hold(p.slot.binding.session, held)
-      } else {
-        // **A TM EDITOR IS DESTROYED RATHER THAN HELD, AND SINCE PART 3a IT HAS TO BE DESTROYED AT
-        // ALL.** This branch did not exist: a `TmPane` leaving `panes` — a close, or a cross-leg
-        // pick under the same leaf — was removed with neither `takeEditor()` nor `destroy()`, and
-        // its editor simply became garbage. That is no longer harmless. `ScratchEditor.destroy()`
-        // is what sends `didClose`, so without it the document stays in `LspClient`'s map, which
-        // holds its diagnostics sink, which closes over the editor and its pending debounce — and
-        // `#died` then replays `didOpen` for a document no view holds, for the life of the page.
-        //
-        // DESTROYED, NOT HELD, BECAUSE NOTHING CAN RECLAIM IT. Custody exists to serve `move the
-        // editor here`, and a TM view does not offer it (`setClaim` has one caller, in
-        // `lambda-pane.ts`). Holding a TM editor would put it in a map nothing reads.
-        ;(p.pane as TmPane).takeEditor()?.destroy()
+      switch (p.slot.binding.leg) {
+        case 'lambda': {
+          const held = (p.pane as LambdaPane).takeEditor()
+          if (held !== null) custody.hold(p.slot.binding.session, held)
+          break
+        }
+        case 'tm':
+          // **A TM EDITOR IS DESTROYED RATHER THAN HELD, AND SINCE PART 3a IT HAS TO BE DESTROYED AT
+          // ALL.** This arm did not exist: a `TmPane` leaving `panes` — a close, or a cross-leg
+          // pick under the same leaf — was removed with neither `takeEditor()` nor `destroy()`, and
+          // its editor simply became garbage. That is no longer harmless. `ScratchEditor.destroy()`
+          // is what sends `didClose`, so without it the document stays in `LspClient`'s map, which
+          // holds its diagnostics sink, which closes over the editor and its pending debounce — and
+          // `#died` then replays `didOpen` for a document no view holds, for the life of the page.
+          //
+          // DESTROYED, NOT HELD, BECAUSE NOTHING CAN RECLAIM IT. Custody exists to serve `move the
+          // editor here`, and a TM view does not offer it (`setClaim` has one caller, in
+          // `lambda-pane.ts`). Holding a TM editor would put it in a map nothing reads.
+          ;(p.pane as TmPane).takeEditor()?.destroy()
+          break
+        default:
+          unhandled(p.slot.binding.leg)
       }
       panes.remove(p.id)
     }
@@ -1027,98 +1057,105 @@ export function createPaneHost(deps: {
       host.dataset.kind = l.pane
       const session = pendingBinding.get(l.id) ?? SOURCE_SESSION
       pendingBinding.delete(l.id)
-      if (l.pane === 'lambda') {
-        const slot = new PaneSlot('lambda', session)
-        // ITS DISPLAY IS READ BACK LIKE A TM VIEW'S PANELS BELOW — stored per leaf, defaulted when absent.
-        const map = panelOpen(l.id, 'map')
-        const pane = new LambdaPane(host, paneEvents(l.id, slot), {
-          display: displayOf(l.id) ?? DEFAULT_DISPLAY,
-          ...(map === undefined ? {} : { map }),
-        })
-        // **A NEW λ PANE IS SEEDED FROM ITS SESSION FOR THE IDENTICAL REASON THE TM BRANCH BELOW IS**,
-        // and this line is the λ half of a repair that shipped with only its TM half. `scratch-compiled`
-        // is the reply that mounts a scratch editor and it fires once per build, so a pane created after
-        // that reply — a split onto an existing buffer, a cross-leg pick back to λ, `reset preset`, or a
-        // restored layout whose buffer the warming loop above `applyLayout()` has already warmed — never
-        // gets one from that reply. ONLY THE LAST OF THOSE FOUR IS A BUFFER WITH NO EDITOR ANYWHERE: the
-        // other three name a buffer whose editor is already mounted on a sibling pane or waiting in
-        // `heldEditors`, so `mountScratchEditor` is a no-op for them (its `hasEditor` gate below), and the
-        // route to that editor is the claim control, correctly offered. `mountScratchEditor`'s own doc
-        // carries the whole finding.
-        //
-        // AFTER `dropClaimsOn(l.id)` ABOVE AND BEFORE `custody.reconcile()` BELOW, which is the only
-        // ordering it needs: the drop cannot delete a claim this line has not made yet, and the sweep
-        // finds this pane already installed as its session's home and so takes nothing off it.
-        mountScratchEditor(l.id, pane, session)
-        panes.add({ id: l.id, kind: 'lambda', slot, pane, host })
-      } else {
-        const slot = new PaneSlot('tm', session)
-        // **EVERY PANEL A VIEW OWNS HAS TO BE READ BACK, NOT JUST THE FIRST ONE.** `rules` was the
-        // only panel a TM view had when this line was written; `outline` (Plan 7 part 3a) wrote its
-        // state through `on.panel` and nothing read it, so it persisted correctly and restored
-        // closed every time. An entry is passed only when it is stored, so each panel keeps its own
-        // default — `rules` opens, `outline` does not.
-        const rules = panelOpen(l.id, 'rules')
-        const diagram = panelOpen(l.id, 'diagram')
-        const outline = panelOpen(l.id, 'outline')
-        const pane = new TmPane(
-          host,
-          paneEvents(l.id, slot),
-          {
-            ...(rules === undefined ? {} : { rules }),
-            ...(diagram === undefined ? {} : { diagram }),
-            ...(outline === undefined ? {} : { outline }),
-          },
-          tmDisplayOf(l.id) ?? DEFAULT_TM_DISPLAY,
-        )
-        // **A NEW TM PANE IS SEEDED FROM ITS SESSION, BECAUSE THE REPLY THAT WOULD HAVE TOLD IT HAS
-        // ALREADY BEEN AND GONE.** `TmPane.setProgram` was called from `replies.ts` and from nowhere
-        // else, so a pane created after its session's last `compiled` reply rendered no tapes, no status
-        // line and no δ-rows until something recompiled — the whole machine missing from a pane the user
-        // just asked for. Pre-existing rather than this slice's doing, and repaired here rather than at
-        // the gesture because every route to a new pane comes through this loop — a split, a cross-leg
-        // pick (which drops the entry in pass 1 and arrives back here under the same leaf id), and
-        // `reset preset`. Seeding at the picker instead would leave the others blank for no reason a
-        // reader could infer.
-        //
-        // **`reset preset` IS A ROUTE ONLY WHERE THE TREE ACTUALLY LOST A TM PANE, WHICH IS NARROWER THAN
-        // "it rebuilds the panes".** Pass 1 drops an entry only when `live.get(p.id) !== p.kind`, so a
-        // `tm-0` that is still a live TM pane survives the reset untouched and never reaches this line.
-        // Close that pane, or point its leaf at the other leg, and the reset re-mints `tm-0` — a leaf
-        // with no entry, arriving here long after the session's `compiled` reply, which is the same
-        // stale-blank state a split produces.
-        //
-        // A LAYOUT RESTORED FROM `localStorage` COMES THROUGH THIS LOOP TOO AND IS NOT ONE OF THOSE
-        // ROUTES, WHICH IS WORTH SAYING BECAUSE IT LOOKS LIKE ONE. It runs at page load, before anything
-        // has compiled, so the session holds nothing and the seed tells a fresh pane the `null`s it already
-        // holds, rather than repairing anything.
-        //
-        // **A SESSION WITH NOTHING COMPILED NOW PUSHES `null`, WHERE THIS PASS USED TO SEED NOTHING.** A pane one
-        // statement old is already in that state, so here the pushes redraw an empty table and change nothing. They
-        // are made anyway because `seedTmPane` is also the same-leg `rebind` arm's seed and `reseedingSlots`'
-        // seed for a buffer's cool or retire, where the pane is NOT fresh and a skipped `null` left the
-        // previous session's machine and reduced sentence on screen; one function for every route is what
-        // keeps them from disagreeing about what a pane is told.
-        //
-        // **`setForkAvailable` RIDES THE SAME SEED, AND ITS ABSENCE WAS ITS OWN GAP — Important fix,
-        // fix round on Task 9.** `TmCompiled.tmText`'s own doc names the reason this field rides beside
-        // `program`/`tapeNames` at all: `setForkAvailable`'s decision "needs it the moment a TM pane
-        // exists," which a bare `setProgram` call here never supplied — a pane split onto an already
-        // compiled session rendered the whole machine and offered no fork until the next source
-        // recompile happened to call `replies.ts`'s `setTmProgram` again. `ruleCount` is imported for
-        // the identical reason `replies.ts` computes it: `setForkAvailable`'s second argument is a
-        // count, not a boolean, and the two callers must not compute it two different ways.
-        //
-        // **SAFE TO CALL BEFORE THIS PANE'S OWN `#detached` HAS EVER BEEN SET, BECAUSE OF WHEN IT RUNS.**
-        // `TmPane`'s constructor defaults `#detached` to `false`, so a pane bound to a session that IS
-        // detached (a split onto a TM scratch) would show the control live for the instant between this
-        // line and the `draw()` inside `applyLayout`'s own `finally` — except nothing paints in that
-        // instant: `draw()` runs synchronously, later in this same call, and its `PaneSlot.render` ->
-        // `TmPane.setDetached` reaches `#refreshDetach` before the browser ever renders a frame. Calling
-        // this any earlier — before `#refreshDetach` existed to correct it — would have handed exactly
-        // that split-onto-a-scratch pane the same live-and-throwing control Critical 1 fixed.
-        seedTmPane(pane, session)
-        panes.add({ id: l.id, kind: 'tm', slot, pane, host })
+      switch (l.pane) {
+        case 'lambda': {
+          const slot = new PaneSlot('lambda', session)
+          // ITS DISPLAY IS READ BACK LIKE A TM VIEW'S PANELS BELOW — stored per leaf, defaulted when absent.
+          const map = panelOpen(l.id, 'map')
+          const pane = new LambdaPane(host, paneEvents(l.id, slot), {
+            display: displayOf(l.id) ?? DEFAULT_DISPLAY,
+            ...(map === undefined ? {} : { map }),
+          })
+          // **A NEW λ PANE IS SEEDED FROM ITS SESSION FOR THE IDENTICAL REASON THE TM ARM BELOW IS**,
+          // and this line is the λ half of a repair that shipped with only its TM half. `scratch-compiled`
+          // is the reply that mounts a scratch editor and it fires once per build, so a pane created after
+          // that reply — a split onto an existing buffer, a cross-leg pick back to λ, `reset preset`, or a
+          // restored layout whose buffer the warming loop above `applyLayout()` has already warmed — never
+          // gets one from that reply. ONLY THE LAST OF THOSE FOUR IS A BUFFER WITH NO EDITOR ANYWHERE: the
+          // other three name a buffer whose editor is already mounted on a sibling pane or waiting in
+          // `heldEditors`, so `mountScratchEditor` is a no-op for them (its `hasEditor` gate below), and the
+          // route to that editor is the claim control, correctly offered. `mountScratchEditor`'s own doc
+          // carries the whole finding.
+          //
+          // AFTER `dropClaimsOn(l.id)` ABOVE AND BEFORE `custody.reconcile()` BELOW, which is the only
+          // ordering it needs: the drop cannot delete a claim this line has not made yet, and the sweep
+          // finds this pane already installed as its session's home and so takes nothing off it.
+          mountScratchEditor(l.id, pane, session)
+          panes.add({ id: l.id, kind: 'lambda', slot, pane, host })
+          break
+        }
+        case 'tm': {
+          const slot = new PaneSlot('tm', session)
+          // **EVERY PANEL A VIEW OWNS HAS TO BE READ BACK, NOT JUST THE FIRST ONE.** `rules` was the
+          // only panel a TM view had when this line was written; `outline` (Plan 7 part 3a) wrote its
+          // state through `on.panel` and nothing read it, so it persisted correctly and restored
+          // closed every time. An entry is passed only when it is stored, so each panel keeps its own
+          // default — `rules` opens, `outline` does not.
+          const rules = panelOpen(l.id, 'rules')
+          const diagram = panelOpen(l.id, 'diagram')
+          const outline = panelOpen(l.id, 'outline')
+          const pane = new TmPane(
+            host,
+            paneEvents(l.id, slot),
+            {
+              ...(rules === undefined ? {} : { rules }),
+              ...(diagram === undefined ? {} : { diagram }),
+              ...(outline === undefined ? {} : { outline }),
+            },
+            tmDisplayOf(l.id) ?? DEFAULT_TM_DISPLAY,
+          )
+          // **A NEW TM PANE IS SEEDED FROM ITS SESSION, BECAUSE THE REPLY THAT WOULD HAVE TOLD IT HAS
+          // ALREADY BEEN AND GONE.** `TmPane.setProgram` was called from `replies.ts` and from nowhere
+          // else, so a pane created after its session's last `compiled` reply rendered no tapes, no status
+          // line and no δ-rows until something recompiled — the whole machine missing from a pane the user
+          // just asked for. Pre-existing rather than this slice's doing, and repaired here rather than at
+          // the gesture because every route to a new pane comes through this loop — a split, a cross-leg
+          // pick (which drops the entry in pass 1 and arrives back here under the same leaf id), and
+          // `reset preset`. Seeding at the picker instead would leave the others blank for no reason a
+          // reader could infer.
+          //
+          // **`reset preset` IS A ROUTE ONLY WHERE THE TREE ACTUALLY LOST A TM PANE, WHICH IS NARROWER THAN
+          // "it rebuilds the panes".** Pass 1 drops an entry only when `live.get(p.id) !== p.kind`, so a
+          // `tm-0` that is still a live TM pane survives the reset untouched and never reaches this line.
+          // Close that pane, or point its leaf at the other leg, and the reset re-mints `tm-0` — a leaf
+          // with no entry, arriving here long after the session's `compiled` reply, which is the same
+          // stale-blank state a split produces.
+          //
+          // A LAYOUT RESTORED FROM `localStorage` COMES THROUGH THIS LOOP TOO AND IS NOT ONE OF THOSE
+          // ROUTES, WHICH IS WORTH SAYING BECAUSE IT LOOKS LIKE ONE. It runs at page load, before anything
+          // has compiled, so the session holds nothing and the seed tells a fresh pane the `null`s it already
+          // holds, rather than repairing anything.
+          //
+          // **A SESSION WITH NOTHING COMPILED NOW PUSHES `null`, WHERE THIS PASS USED TO SEED NOTHING.** A pane one
+          // statement old is already in that state, so here the pushes redraw an empty table and change nothing. They
+          // are made anyway because `seedTmPane` is also the same-leg `rebind` arm's seed and `reseedingSlots`'
+          // seed for a buffer's cool or retire, where the pane is NOT fresh and a skipped `null` left the
+          // previous session's machine and reduced sentence on screen; one function for every route is what
+          // keeps them from disagreeing about what a pane is told.
+          //
+          // **`setForkAvailable` RIDES THE SAME SEED, AND ITS ABSENCE WAS ITS OWN GAP — Important fix,
+          // fix round on Task 9.** `TmCompiled.tmText`'s own doc names the reason this field rides beside
+          // `program`/`tapeNames` at all: `setForkAvailable`'s decision "needs it the moment a TM pane
+          // exists," which a bare `setProgram` call here never supplied — a pane split onto an already
+          // compiled session rendered the whole machine and offered no fork until the next source
+          // recompile happened to call `replies.ts`'s `setTmProgram` again. `ruleCount` is imported for
+          // the identical reason `replies.ts` computes it: `setForkAvailable`'s second argument is a
+          // count, not a boolean, and the two callers must not compute it two different ways.
+          //
+          // **SAFE TO CALL BEFORE THIS PANE'S OWN `#detached` HAS EVER BEEN SET, BECAUSE OF WHEN IT RUNS.**
+          // `TmPane`'s constructor defaults `#detached` to `false`, so a pane bound to a session that IS
+          // detached (a split onto a TM scratch) would show the control live for the instant between this
+          // line and the `draw()` inside `applyLayout`'s own `finally` — except nothing paints in that
+          // instant: `draw()` runs synchronously, later in this same call, and its `PaneSlot.render` ->
+          // `TmPane.setDetached` reaches `#refreshDetach` before the browser ever renders a frame. Calling
+          // this any earlier — before `#refreshDetach` existed to correct it — would have handed exactly
+          // that split-onto-a-scratch pane the same live-and-throwing control Critical 1 fixed.
+          seedTmPane(pane, session)
+          panes.add({ id: l.id, kind: 'tm', slot, pane, host })
+          break
+        }
+        default:
+          unhandled(l.pane)
       }
     }
 
diff --git a/web/src/panes.ts b/web/src/panes.ts
index 0eb0990..bbde834 100644
--- a/web/src/panes.ts
+++ b/web/src/panes.ts
@@ -15,6 +15,25 @@ export type LeafId = string
  */
 export type PaneKind = 'source' | 'lambda' | 'tm'
 
+/**
+ * The leg a pane of `kind` renders, or `null` for the source pane, which renders an editor and no leg.
+ *
+ * **A `switch`, SO THAT A NEW KIND IS A TYPE ERROR HERE RATHER THAN A SILENT ANSWER.** Because the kinds that
+ * are legs are not aliased to `Leg` (`PaneKind`'s own doc), "is this kind a leg" used to be asked by listing
+ * them — `kind === 'lambda' || kind === 'tm'` — which is `false` for a third leg's kind with `tsc` green
+ * (`legs.ts` has the class of bug). Every arm returns, so a kind with no arm is TS2366.
+ */
+export function legOfPane(kind: PaneKind): Leg | null {
+  switch (kind) {
+    case 'source':
+      return null
+    case 'lambda':
+      return 'lambda'
+    case 'tm':
+      return 'tm'
+  }
+}
+
 /**
  * One live pane: its leaf identity, what it renders, the slot that resolves its binding, the view
  * itself and the element it is mounted in.
diff --git a/web/src/replies.ts b/web/src/replies.ts
index 52dc30d..f11046e 100644
--- a/web/src/replies.ts
+++ b/web/src/replies.ts
@@ -2,6 +2,7 @@ import type { EditorView } from '@codemirror/view'
 import type { EditablePane } from './editor-custody'
 import { setDecline, setLink } from './highlight'
 import type { LambdaTrees } from './lambda-trees'
+import { unhandled } from './legs'
 import { LinkIndex } from './link'
 import type { LinkWiring } from './link-wiring'
 import type { PaneCollection } from './panes'
@@ -303,6 +304,16 @@ export function createReplies(deps: {
         setProgram({ kind: 'error', error: new Error(reply.message) })
         draw()
         return
+      // THREE KINDS THAT NEVER REACH THE PROGRAM'S SESSION, WRITTEN OUT so that a kind added to `RunReply` is a
+      // type error at `unhandled` below rather than a reply this switch drops with `tsc` green (Plan 7 part 5's
+      // spec, amendment 8). `scratch-compiled` and `tm-scratch-compiled` answer a copy's build, which only
+      // `ScratchBuffers` posts; `tm-value` is a TM copy's value run, where the program's value arrives in `result`.
+      case 'scratch-compiled':
+      case 'tm-scratch-compiled':
+      case 'tm-value':
+        return
+      default:
+        unhandled(reply)
     }
   }
 
@@ -317,17 +328,19 @@ export function createReplies(deps: {
    * `view`, none of which a detached session has any claim on (§3.3: no `linkIndex`, no `sourceSpan`,
    * no `ty`).
    *
-   * SEVEN ARMS AND NO `default`. `session-worker.ts` answers a `lambda-scratch` request with exactly
-   * `scratch-compiled`, `lambda-frames`, `no-session` or `worker-error`, and a `tm-scratch` request with
-   * `tm-scratch-compiled`, `tm-frames`, `tm-value`, `no-session` or `worker-error` (`onTmScratch`,
-   * `session-worker.ts`'s TM counterpart to `onLambdaScratch`). `tm-value` is the TM leg's one extra
-   * shape: a headered TM buffer's value run reports through it, where a compiled session's value
-   * arrives in `result`. `compiled`/`result` still need a `SourceMap`/`ty` no buffer has, on either
-   * leg. `no-session` and `worker-error` are genuinely shared, one arm apiece for both legs — a buffer's
-   * failure to build or its worker's death read the same whichever leg minted it. `lambda-frames` and
-   * `tm-frames` are not shareable in the same way (`hist.push` closes over a different `LegState`), so
-   * each gets its own arm; `scratch-compiled` and `tm-scratch-compiled` likewise, because their payloads
-   * share no field (`tm-scratch-compiled`'s own doc in `protocol.ts` has the argument).
+   * AN ARM FOR EVERY KIND, AND `unhandled` AS THE `default`. `session-worker.ts` answers a
+   * `lambda-scratch` request with exactly `scratch-compiled`, `lambda-frames`, `no-session` or
+   * `worker-error`, and a `tm-scratch` request with `tm-scratch-compiled`, `tm-frames`, `tm-value`,
+   * `no-session` or `worker-error` (`onTmScratch`, `session-worker.ts`'s TM counterpart to
+   * `onLambdaScratch`). `tm-value` is the TM leg's one extra shape: a headered TM buffer's value run
+   * reports through it, where a compiled session's value arrives in `result`. `compiled`/`result` still
+   * need a `SourceMap`/`ty` no buffer has, on either leg, so their arm does nothing — written out for the
+   * reason `onReply`'s own do-nothing arm is. `no-session` and `worker-error` are genuinely shared, one arm
+   * apiece for both legs — a buffer's failure to build or its worker's death read the same whichever leg
+   * minted it. `lambda-frames` and `tm-frames` are not shareable in the same way (`hist.push` closes over a
+   * different `LegState`), so each gets its own arm; `scratch-compiled` and `tm-scratch-compiled` likewise,
+   * because their payloads share no field (`tm-scratch-compiled`'s own doc in `protocol.ts` has the
+   * argument).
    *
    * **`tm-scratch-compiled` USED TO BE LEFT OPEN ON PURPOSE, AND THIS IS THE TASK THAT WAS ALWAYS GOING
    * TO CLOSE IT.** The paragraph used to read: "Wiring those two arms needs a TM buffer's own pane and
@@ -641,6 +654,13 @@ export function createReplies(deps: {
         notify(`${scratchpad.nameOf(session) ?? 'a copy'} stopped — ${reply.message}`)
         draw()
         return
+      // TWO KINDS A COPY'S WORKER NEVER SENDS, WRITTEN OUT for the reason `onReply`'s three are: only `onRun`
+      // posts them, for the program's session, and a copy has neither the `SourceMap` nor the `ty` they carry.
+      case 'compiled':
+      case 'result':
+        return
+      default:
+        unhandled(reply)
     }
   }
 
diff --git a/web/src/scratch.ts b/web/src/scratch.ts
index 93853dc..3deb1c8 100644
--- a/web/src/scratch.ts
+++ b/web/src/scratch.ts
@@ -1,9 +1,10 @@
 import type { PersistedBuffers } from './buffers-store'
 import { History } from './history'
+import { LEG_NAME, unhandled } from './legs'
 import type { LeafId } from './panes'
 import type { Leg, RunReply } from './protocol'
 import type { SessionId, SessionPool } from './session-client'
-import { resetLegs, type SessionRegistry } from './sessions'
+import { resetLegs, type SessionLegs, type SessionRegistry } from './sessions'
 import type { Diagnostic, LambdaState, TmState } from './types'
 
 /**
@@ -827,14 +828,6 @@ export class ScratchBuffers {
     // collection, one `onReply`, many threads — so the name is closed over HERE, per buffer, at the
     // one place that knows which thread it just made.
     const client = this.#pool.bind(state.id, (reply) => this.#onReply(state.id, reply))
-    // NOT AVAILABLE YET, WITH A REASON A PANE CAN READ — unchanged in intent from the λ-only version;
-    // what changed is WHICH leg gets it. A session holds at most one leg per `Leg`, and this is where
-    // that is decided for a buffer.
-    const pending = { available: false, reason: 'building…' }
-    const legs =
-      state.leg === 'lambda'
-        ? { lambda: { hist: new History<LambdaState>(this.#bytes), status: pending, done: null, playing: false } }
-        : { tm: { hist: new History<TmState>(this.#bytes), status: pending, done: null, playing: false } }
     this.#reg.add({
       id: state.id,
       label: state.label,
@@ -844,7 +837,7 @@ export class ScratchBuffers {
       // only one in the app that may say `false`, and its own comment says so.
       detached: true,
       client,
-      legs,
+      legs: this.#pendingLegs(state.leg),
       // **`null` AT CONSTRUCTION FOR BOTH LEGS, AND THE REASON IS NOT THE SAME FOR BOTH.** A λ buffer
       // never gets a machine at all — its worker answers `scratch-compiled`, which carries no
       // `TmProgram` (5d-i §3.3: no TM leg, no `SourceMap`), and no TM pane can ever bind to it either,
@@ -860,14 +853,38 @@ export class ScratchBuffers {
     // SUPERSEDE THEN POST, the pattern `compile.ts`'s `schedule` uses and for the same reason
     // (`SessionClient.supersede`'s doc): a fresh client is at generation 0, which matches nothing,
     // so the claim has to happen before the post or the request would drop its own message.
-    //
-    // NO STEP ON THE TM SIDE, FOR `SessionClient.tmScratch`'s OWN REASON: a machine has no step-k
-    // term to replay to, since its text IS the machine. `step` is still a parameter of this method —
-    // `warm` passes it as `0` for both legs, `#mint` forwards whatever `fork` was handed — and simply
-    // goes unread on the branch that has nothing to replay.
     const gen = client.supersede()
-    if (state.leg === 'lambda') client.scratch(gen, src, step)
-    else client.tmScratch(gen, src)
+    switch (state.leg) {
+      case 'lambda':
+        client.scratch(gen, src, step)
+        break
+      case 'tm':
+        // NO STEP ON THE TM SIDE, FOR `SessionClient.tmScratch`'s OWN REASON: a machine has no step-k
+        // term to replay to, since its text IS the machine. `step` is still a parameter of this method —
+        // `warm` passes it as `0` for both legs, `#mint` forwards whatever `fork` was handed — and simply
+        // goes unread on the arm that has nothing to replay.
+        client.tmScratch(gen, src)
+        break
+      default:
+        unhandled(state.leg)
+    }
+  }
+
+  /**
+   * A new buffer's one leg, not built yet — the `legs` record `#spawn` registers.
+   *
+   * NOT AVAILABLE YET, WITH A REASON A PANE CAN READ — unchanged in intent from the λ-only version; what
+   * changed is WHICH leg gets it. A session holds at most one leg per `Leg`, and this is where that is
+   * decided for a buffer.
+   */
+  #pendingLegs(leg: Leg): SessionLegs {
+    const status = { available: false, reason: 'building…' }
+    switch (leg) {
+      case 'lambda':
+        return { lambda: { hist: new History<LambdaState>(this.#bytes), status, done: null, playing: false } }
+      case 'tm':
+        return { tm: { hist: new History<TmState>(this.#bytes), status, done: null, playing: false } }
+    }
   }
 
   /**
@@ -877,7 +894,7 @@ export class ScratchBuffers {
    */
   nameOf(id: SessionId): string | null {
     const b = this.#buffers.get(id)
-    return b === undefined ? null : `${b.leg === 'lambda' ? 'λ' : 'TM'} ${b.label}`
+    return b === undefined ? null : `${LEG_NAME[b.leg]} ${b.label}`
   }
 
   /** What undoing a delete needs to put a copy back: its id, name, leg, text and collapse flag. */
@@ -1042,11 +1059,19 @@ export class ScratchBuffers {
     // `client.scratch` unconditionally, which is `lambda-scratch` on the wire regardless of which leg
     // the buffer was actually minted on. For a TM buffer that reaches `onLambdaScratch`, which parses
     // `.tm` TEXT as a λ TERM and answers `no-session` with a λ syntax error every time — `#spawn`'s own
-    // two-way branch is the fix already applied at mint; this is the same branch at the one other place
-    // this class posts a build to an EXISTING buffer.
+    // branch on the leg is the fix already applied at mint; this is the same branch at the one other
+    // place this class posts a build to an EXISTING buffer.
     const gen = client.supersede()
-    if (state.leg === 'lambda') client.scratch(gen, src, 0)
-    else client.tmScratch(gen, src)
+    switch (state.leg) {
+      case 'lambda':
+        client.scratch(gen, src, 0)
+        break
+      case 'tm':
+        client.tmScratch(gen, src)
+        break
+      default:
+        unhandled(state.leg)
+    }
     return true
   }
 
diff --git a/web/src/session-worker.ts b/web/src/session-worker.ts
index 535e470..b4c0767 100644
--- a/web/src/session-worker.ts
+++ b/web/src/session-worker.ts
@@ -38,6 +38,7 @@
  * per call; what did not change is that this file has no opinion either way.)
  */
 import init, { compile, lambdaScratchAt, tapeNames, tmScratch } from '../../pkg/redextape_wasm.js'
+import { LEGS, perLeg, unhandled } from './legs'
 import type { LinkIndexWire } from './link'
 import type { LambdaLeg, LambdaTreeWire, Leg, RecordEnd, RunReply, RunRequest, TmLeg } from './protocol'
 import {
@@ -231,8 +232,8 @@ let live: Live | null = null
  * stop buys another `HISTORY_BYTES`; the main thread's ring evicts, so recording further is bounded
  * per click rather than unbounded.
  */
-const recorded: Record<Leg, number> = { lambda: 0, tm: 0 }
-const allowance: Record<Leg, number> = { lambda: HISTORY_BYTES, tm: HISTORY_BYTES }
+const recorded: Record<Leg, number> = perLeg(() => 0)
+const allowance: Record<Leg, number> = perLeg(() => HISTORY_BYTES)
 
 /**
  * One record loop per leg at a time. `latest` serializes `run` requests, but two `extend`s carry the
@@ -240,7 +241,7 @@ const allowance: Record<Leg, number> = { lambda: HISTORY_BYTES, tm: HISTORY_BYTE
  * and interleave their frames. The same race reaches `onRun`: an `extend` can land while `onRun`'s
  * `await recordTm` is still in flight, once the λ leg has already posted its `budget` stop.
  */
-const recording: Record<Leg, boolean> = { lambda: false, tm: false }
+const recording: Record<Leg, boolean> = perLeg(() => false)
 
 function dropLive(): void {
   const held = live
@@ -525,18 +526,17 @@ async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
   await ready
   // FREED BEFORE THE NEXT COMPILE, not after. Two `Session` handles are never simultaneously live.
   dropLive()
-  recorded.lambda = 0
-  recorded.tm = 0
-  allowance.lambda = HISTORY_BYTES
-  allowance.tm = HISTORY_BYTES
-  // GENERATION-SCOPED BY RESET, not by the flag's own type. `recording` exists to stop two loops
-  // stepping ONE cursor; a loop belonging to a superseded generation is not competing for this
-  // session and must not hold a flag against it. Safe here because `onRun`'s synchronous prefix can
-  // only run once any prior loop has yielded, so no loop is mid-step when this executes — and a
-  // stale loop that resumes afterwards returns at its own `live?.gen !== gen` check without
-  // touching the flag it no longer owns.
-  recording.lambda = false
-  recording.tm = false
+  for (const leg of LEGS) {
+    recorded[leg] = 0
+    allowance[leg] = HISTORY_BYTES
+    // GENERATION-SCOPED BY RESET, not by the flag's own type. `recording` exists to stop two loops
+    // stepping ONE cursor; a loop belonging to a superseded generation is not competing for this
+    // session and must not hold a flag against it. Safe here because `onRun`'s synchronous prefix can
+    // only run once any prior loop has yielded, so no loop is mid-step when this executes — and a
+    // stale loop that resumes afterwards returns at its own `live?.gen !== gen` check without
+    // touching the flag it no longer owns.
+    recording[leg] = false
+  }
 
   // `compile` RUNS THE WHOLE TM LEG and is one uninterruptible call — measured at 0.21-75.44 ms
   // across the demo suite (`frame_cost_probe` section A). Off the main thread that can only delay the
@@ -610,9 +610,10 @@ async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
  * **THE SAME PROLOGUE AS `onRun`, AND THAT IS THE INVARIANT RATHER THAN A COPY.** `dropLive` first,
  * then the byte counters, then the `recording` flags: whatever this thread was holding is freed
  * BEFORE anything new is built, so the two-handle window stays strictly zero for a scratch exactly as
- * it does for a session (§4.2, and this module's own doc). Factoring the six lines into a shared
- * `reset()` was considered and refused — it would read as bookkeeping, when what it actually is is
- * the one place the invariant is enforced, and the two callers must be seen to enforce it.
+ * it does for a session (§4.2, and this module's own doc). Factoring the reset into a shared `reset()`
+ * was considered and refused while it was six lines, and a loop over `LEGS` changes nothing about why:
+ * it would read as bookkeeping, when what it actually is is the one place the invariant is enforced,
+ * and the two callers must be seen to enforce it.
  *
  * NO `linkIndex`, NO `tmProgram`, NO `tapeNames` IN THE REPLY, and no `result` after it. All four read
  * something §3.3 puts off this type (`self.map`, the TM leg, `self.ty`), which is why the reply is
@@ -633,12 +634,11 @@ async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
 async function onLambdaScratch(req: Extract<RunRequest, { kind: 'lambda-scratch' }>): Promise<void> {
   await ready
   dropLive()
-  recorded.lambda = 0
-  recorded.tm = 0
-  allowance.lambda = HISTORY_BYTES
-  allowance.tm = HISTORY_BYTES
-  recording.lambda = false
-  recording.tm = false
+  for (const leg of LEGS) {
+    recorded[leg] = 0
+    allowance[leg] = HISTORY_BYTES
+    recording[leg] = false
+  }
 
   const { diagnostics, scratch, text } = lambdaScratchAt(req.src, req.step, LAMBDA_BYTE_BUDGET) as ForkedAtResult
   if (scratch === null) {
@@ -698,12 +698,11 @@ async function onLambdaScratch(req: Extract<RunRequest, { kind: 'lambda-scratch'
 async function onTmScratch(req: Extract<RunRequest, { kind: 'tm-scratch' }>): Promise<void> {
   await ready
   dropLive()
-  recorded.lambda = 0
-  recorded.tm = 0
-  allowance.lambda = HISTORY_BYTES
-  allowance.tm = HISTORY_BYTES
-  recording.lambda = false
-  recording.tm = false
+  for (const leg of LEGS) {
+    recorded[leg] = 0
+    allowance[leg] = HISTORY_BYTES
+    recording[leg] = false
+  }
 
   const { diagnostics, scratch, value } = tmScratch(req.src) as TmScratchResult
   if (scratch === null) {
@@ -776,33 +775,43 @@ async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<v
   allowance[req.leg] = recorded[req.leg] + HISTORY_BYTES
 
   let ran: boolean
-  if (req.leg === 'lambda') {
-    // TWO OF THE THREE KINDS TAKE THIS BRANCH, which is §3.3's "six methods transplant unchanged" doing
-    // its work: `[continue]` on a λ scratchpad's pane is the same two calls as on a session's, against
-    // the same method names on a different wasm type. That is why the pane needs no per-kind control
-    // strip for THOSE two — a `TmScratch` is the one occupant of `live` with no λ leg to extend.
-    //
-    // Deliberate silence, for `recordLambda`'s reason two functions up: a `TmScratch` has no λ leg, so
-    // there is no cap to raise and nothing to record. Returning before `allowance` is spent would be
-    // tidier still, but the allowance write above is harmless for a leg that never records and hoisting
-    // this check above it would put a `kind` test in front of the ordinary path — the same trade-off
-    // the TM branch below already makes in the other direction.
-    if (live.kind === 'tm-scratch') return
-    const s = live.session
-    // Raising a cap that was not hit is harmless — `raise_cap` is additive — but calling it on a
-    // DEPTH-refused cursor is pointless by contract, and this branch is never reached for one:
-    // `controls.ts` ships no continue affordance for `depth-refused`, which is why that state has no
-    // case here rather than a no-op one.
-    if (s.lambdaStatus().run === 'Capped') s.raiseLambdaCap(EXTEND_STEPS)
-    ran = await recordLambda(req.gen, false)
-  } else {
-    // A `LambdaScratch` has no TM leg, so there is no cap to raise and nothing to record.
-    // This guard excludes it from the TM branch, mirroring the λ branch's exclusion of
-    // `TmScratch` above.
-    if (live.kind === 'lambda-scratch') return
-    const s = live.session
-    if (s.tmStatus().run === 'Capped') s.raiseTmCap(EXTEND_STEPS, EXTEND_CELLS)
-    ran = await recordTm(req.gen, false)
+  switch (req.leg) {
+    case 'lambda': {
+      // TWO OF THE THREE KINDS TAKE THIS ARM, which is §3.3's "six methods transplant unchanged" doing
+      // its work: `[continue]` on a λ scratchpad's pane is the same two calls as on a session's, against
+      // the same method names on a different wasm type. That is why the pane needs no per-kind control
+      // strip for THOSE two — a `TmScratch` is the one occupant of `live` with no λ leg to extend.
+      //
+      // Deliberate silence, for `recordLambda`'s reason two functions up: a `TmScratch` has no λ leg, so
+      // there is no cap to raise and nothing to record. Returning before `allowance` is spent would be
+      // tidier still, but the allowance write above is harmless for a leg that never records and hoisting
+      // this check above it would put a `kind` test in front of the ordinary path — the same trade-off
+      // the TM arm below already makes in the other direction.
+      if (live.kind === 'tm-scratch') return
+      const s = live.session
+      // Raising a cap that was not hit is harmless — `raise_cap` is additive — but calling it on a
+      // DEPTH-refused cursor is pointless by contract, and this arm is never reached for one:
+      // `controls.ts` ships no continue affordance for `depth-refused`, which is why that state has no
+      // case here rather than a no-op one.
+      if (s.lambdaStatus().run === 'Capped') s.raiseLambdaCap(EXTEND_STEPS)
+      ran = await recordLambda(req.gen, false)
+      break
+    }
+    case 'tm': {
+      // A `LambdaScratch` has no TM leg, so there is no cap to raise and nothing to record.
+      // This guard excludes it from the TM arm, mirroring the λ arm's exclusion of
+      // `TmScratch` above.
+      if (live.kind === 'lambda-scratch') return
+      const s = live.session
+      if (s.tmStatus().run === 'Capped') s.raiseTmCap(EXTEND_STEPS, EXTEND_CELLS)
+      ran = await recordTm(req.gen, false)
+      break
+    }
+    default:
+      // A LEG WITH NO ARM RECORDS NOTHING AND POSTS NOTHING, as a stale generation does above. `unhandled`
+      // makes such a leg a type error, and the `return` is what keeps `ran` assigned on every path below.
+      unhandled(req.leg)
+      return
   }
   // A SUPPRESSED CALL MUST NOT POST A RESULT. `ran === false` means a loop already in flight for this
   // leg owns it — that loop will post its own frames and its own `result` when it finishes. Posting
@@ -854,25 +863,36 @@ function onLambdaTree(req: Extract<RunRequest, { kind: 'lambda-tree' }>): void {
 ctx.addEventListener('message', async (e: MessageEvent<RunRequest>) => {
   const req = e.data
   try {
-    if (req.kind === 'run') {
-      latest = req.gen
-      await onRun(req)
-    } else if (req.kind === 'lambda-scratch') {
-      // `latest` IS CLAIMED HERE TOO, AND THE ABANDON CHECK INSIDE `onLambdaScratch` DEPENDS ON IT.
-      // `latest` is what a build compares itself against after its uninterruptible wasm call returns;
-      // a build that never recorded itself as the newest request would free its own scratch every
-      // time, since `latest !== req.gen` would still name whatever ran before it.
-      latest = req.gen
-      await onLambdaScratch(req)
-    } else if (req.kind === 'tm-scratch') {
-      // `latest` IS CLAIMED HERE TOO, FOR `lambda-scratch`'s OWN REASON: the abandon check inside
-      // `onTmScratch` compares against it after `tmScratch`'s uninterruptible wasm call returns.
-      latest = req.gen
-      await onTmScratch(req)
-    } else if (req.kind === 'extend') {
-      await onExtend(req)
-    } else if (req.kind === 'lambda-tree') {
-      onLambdaTree(req)
+    // A `switch` ENDING IN `unhandled`, WHERE THIS WAS AN `else if` CHAIN WITH NO END. A request kind the
+    // chain did not name would have fallen off its end and been dropped with no reply and `tsc` green, which
+    // is where a new leg's requests arrive (Plan 7 part 5's spec, amendment 8); now it is a type error here.
+    switch (req.kind) {
+      case 'run':
+        latest = req.gen
+        await onRun(req)
+        break
+      case 'lambda-scratch':
+        // `latest` IS CLAIMED HERE TOO, AND THE ABANDON CHECK INSIDE `onLambdaScratch` DEPENDS ON IT.
+        // `latest` is what a build compares itself against after its uninterruptible wasm call returns;
+        // a build that never recorded itself as the newest request would free its own scratch every
+        // time, since `latest !== req.gen` would still name whatever ran before it.
+        latest = req.gen
+        await onLambdaScratch(req)
+        break
+      case 'tm-scratch':
+        // `latest` IS CLAIMED HERE TOO, FOR `lambda-scratch`'s OWN REASON: the abandon check inside
+        // `onTmScratch` compares against it after `tmScratch`'s uninterruptible wasm call returns.
+        latest = req.gen
+        await onTmScratch(req)
+        break
+      case 'extend':
+        await onExtend(req)
+        break
+      case 'lambda-tree':
+        onLambdaTree(req)
+        break
+      default:
+        unhandled(req)
     }
   } catch (err) {
     // A THROWN SESSION CALL MUST NOT BECOME SILENCE. Every wasm entry point is fallible at the
diff --git a/web/src/sessions.ts b/web/src/sessions.ts
index 4d3da34..b4527c5 100644
--- a/web/src/sessions.ts
+++ b/web/src/sessions.ts
@@ -1,5 +1,6 @@
 import { type ControlState, controlState } from './controls'
 import type { History } from './history'
+import { LEGS } from './legs'
 // A TYPE-ONLY IMPORT, AND THE ONE DIRECTION THAT WOULD OTHERWISE BE A CYCLE — `pane-chrome.ts` already
 // imports `Binding`/`PaneOption` from here. `import type` is erased entirely at build time, so this
 // names a shape rather than creating a load-order relationship between the two modules; `SplitChoices`
@@ -205,14 +206,6 @@ export type Binding<K extends Leg> = { readonly session: SessionId; readonly leg
 /** One entry in a pane's binding selector: the session it names, and what to call it on screen. */
 export type BindingOption = { readonly id: SessionId; readonly label: string }
 
-/**
- * The two legs, in the order a selector lists them.
- *
- * A VALUE RATHER THAN A KEY WALK OVER SOME ENTRY'S `legs`, because the order must not depend on which
- * legs the first session in the registry happens to have.
- */
-const LEGS = ['lambda', 'tm'] as const satisfies readonly Leg[]
-
 /** One `(leg, session)` pair a pane may be pointed at, with the label the selector shows. */
 export type PaneOption = { readonly leg: Leg; readonly id: SessionId; readonly label: string }
 
@@ -445,7 +438,8 @@ export class SessionRegistry {
   }
 
   /**
-   * Every `(leg, session)` pair a pane may be pointed at — `options` for both legs, tagged.
+   * Every `(leg, session)` pair a pane may be pointed at — `options` for every leg, tagged, the legs in
+   * `LEGS`' order (`legs.ts`).
    *
    * IT IS BUILT FROM `options`' OWN SOURCE OF TRUTH AND NOT FROM A SECOND TABLE. `options`' doc states
    * the property this inherits: "the legs an entry was built with ARE the answer, so the selector and
diff --git a/web/src/view-header.ts b/web/src/view-header.ts
index e13aaac..93f5e27 100644
--- a/web/src/view-header.ts
+++ b/web/src/view-header.ts
@@ -1,6 +1,7 @@
 import { handOff, nearest } from './focus-handoff'
 import { type IconName, icon } from './icons'
 import type { Dir } from './layout'
+import { LEG_NAME } from './legs'
 import type { PaneChoice, SplitChoices } from './pane-chrome'
 import type { Leg } from './protocol'
 import type { SessionId } from './session-client'
@@ -25,11 +26,9 @@ import type { Binding, PaneOption } from './sessions'
  * pick across legs does (it rebuilds the view in place). This module knows nothing about the tree.
  */
 
-const legLabel = (leg: Leg): string => (leg === 'lambda' ? 'λ' : 'TM')
-
-/** How a pair reads everywhere a menu names one: `λ · program`, `TM · copy 2`. */
+/** How a pair reads everywhere a menu names one: `λ · program`, `TM · copy 2` — the leg as `LEG_NAME` says it. */
 export function pairLabel(o: { readonly leg: Leg; readonly label: string }): string {
-  return `${legLabel(o.leg)} · ${o.label}`
+  return `${LEG_NAME[o.leg]} · ${o.label}`
 }
 
 /**
````


- [ ] **Step 4: The proof: add `'asm'` to `Leg` and `PaneKind`, let `tsc` name every site, and put both back.**

Run: `cd web && sed -i "s/^export type Leg = 'lambda' | 'tm'$/export type Leg = 'lambda' | 'asm' | 'tm'/" src/protocol.ts && sed -i "s/^export type PaneKind = 'source' | 'lambda' | 'tm'$/export type PaneKind = 'source' | 'lambda' | 'asm' | 'tm'/" src/panes.ts && pnpm exec tsc --noEmit; git checkout -- src/protocol.ts src/panes.ts`

Expected: 31 errors, at exactly these sites — every one a place a third leg must decide what it does:

```text
    src/draw.ts(377,21): TS2345
    src/layout.ts(393,83): TS2741
    src/legs.ts(34,14): TS2741
    src/link-wiring.ts(118,19): TS2345
    src/lsp-protocol.ts(96,14): TS2741
    src/main.ts(645,7): TS2741
    src/main.ts(1447,52): TS2366
    src/pane-host.ts(177,39): TS2366
    src/pane-host.ts(990,21): TS2345
    src/pane-host.ts(1158,21): TS2345
    src/panes.ts(26,44): TS2366
    src/panes.ts(49,27): TS2536
    src/scratch.ts(869,19): TS2345
    src/scratch.ts(880,27): TS2366
    src/scratch.ts(1073,19): TS2345
    src/session-worker.ts(813,17): TS2345
    src/sessions.ts(74,51): TS2536
    src/sessions.ts(407,49): TS2536
    src/sessions.ts(544,17): TS2536
    src/sessions.ts(656,43): TS2536
    src/sessions.ts(674,47): TS2536
    src/sessions.ts(674,75): TS2536
    tests/node/link-status.test.ts(90,40): TS2741
    tests/node/link-status.test.ts(92,77): TS2741
    tests/node/link-status.test.ts(100,40): TS2741
    tests/node/link-status.test.ts(103,40): TS2741
    tests/node/link-status.test.ts(111,40): TS2741
    tests/node/link-status.test.ts(120,41): TS2741
    tests/node/link-status.test.ts(136,9): TS2741
    tests/node/link-status.test.ts(151,9): TS2741
    tests/node/link-status.test.ts(158,81): TS2741
```

The 9 in `tests/node/link-status.test.ts` are `DetachedPanes` literals with no `asm` key. Each of the 22 in `src/` is a `switch` arm, a table entry or a shape Task 7 fills; before this task the same command reported 13 errors, at none of the 12 two-way branches. The command restores both files; `git status` shows only this task's changes.

- [ ] **Step 5: Run them and see them pass.**

Run: `cd web && pnpm exec tsc --noEmit`

Expected: exit 0

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
    Test Files  51 passed (51)
    Tests  680 passed (680)
```

Run: `cd web && pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
    Test Files  104 passed (104)
    Tests  648 passed (648)
```

- [ ] **Step 6: No sabotage table.** This task changes no behaviour, so there is nothing to sabotage into a failing test: step 4 is its check, and step 5 holds it to the whole existing suite.

- [ ] **Step 7: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
Every branch on a leg or a pane kind is a switch `tsc` holds to every member, and the leg vocabulary is `legs.ts`

Most sites that told λ from TM asked `leg === 'lambda'` and put TM in
the else, so a third leg would have taken TM's name, request or pane
class with `tsc` green (spec §2.3, amendment 8). They are now switches
that return a value or end in `unhandled`, tables typed `Record<Leg, …>`
or built by `perLeg`, and lists read off `LEG_NAME`; `legOfPane` says
which leg a pane kind is. `replies.ts`'s two reply switches and the
worker's request dispatch end in `unhandled` too, so a reply or request
with no arm is a type error instead of being dropped.

Nothing behaves differently, and no test changed but a comment naming
the two slot helpers now folded into one. With `'asm'` added to `Leg`
and `PaneKind`, `tsc` names every site a third leg has to decide.
````


---

### Task 2: The TM rule table's grid is a module of its own, which the asm listing will share

**Files:**
- Create: `web/src/virtual-grid.ts`, `web/tests/browser/virtual-grid.test.ts`
- Modify: `web/src/tm-pane.ts`, `web/src/panel.ts`, `web/src/state-diagram.ts` (comments), `web/src/draw.ts` (a comment)
- Modify (tests): `web/tests/browser/panel.test.ts`, `web/tests/browser/app.test.ts` (a comment)

**Interfaces:**
- Produces `virtual-grid.ts`: `VirtualGrid` — `constructor(opts: GridOptions)`, `readonly el`, `get following`, `attach()`, `reset()`, `scrollToRow(row)`, `draw()` — with `GridOptions = { classes: { box, spacer, rows, row }, idPrefix, isOpen(), rows(): GridRows, activate(i), beforeDraw?() }`, `GridRows = { count: number | null, follow: number | null, fill(i, row, cell) }`, and `OVERSCAN` (4, re-exported from `tm-pane.ts` as before).
- `panel.ts`'s `createPanel` keeps a role its body already declares, and still labels it by the toggle.

**THE RULE TABLE'S COPY, MOVED UNCHANGED IN BEHAVIOUR (amendment 7).** The drawn window, the active row by index, the keys, the `mousedown` guard that keeps a real click (4b amendment 18), following, the one-shot link scroll (whose bug Task 3 fixes, in its own commit) and the clamp handling leave `TmPane` for `VirtualGrid`; `TmPane` keeps what its rows say (`#tableRows`) and what a row does (`activate`), and its `#drawTable` is now the grid's draw. The comments that carried the reasons move with the code they explain. The state diagram and the λ body keep their own copies until the PR after this one, and their comments that pointed at `TmPane`'s constructor and `#key` point at `VirtualGrid`'s.

**THE ROLE.** The grid sets `role="grid"` in its constructor, before its panel exists; `createPanel` then set `role="region"` on its body unconditionally, and the rule table became a region. `createPanel` now leaves a declared role alone — every other body it wraps is a plain container, which is the case the region role is for.

**THE GRID'S OWN TESTS.** The rule table's suites (`tm-grid`, `tm-pointer`, `tm-follow-clamp`, `app`) hold the behaviour through a real view and pass unchanged; `virtual-grid.test.ts` holds the contract where the asm listing, the grid's second user, could not quietly lean on the first's wiring. **A scroll's echo is awaited, not counted in frames**: a test that waited two frames ran before the event it was about when the whole file ran, and passed with the guard under test deleted (sabotages 10 and 11).

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=2
diff --git a/web/tests/browser/app.test.ts b/web/tests/browser/app.test.ts
index fa074ae..2c72c53 100644
--- a/web/tests/browser/app.test.ts
+++ b/web/tests/browser/app.test.ts
@@ -341,8 +341,8 @@ describe('the app, end to end', () => {
   })
 
   // THE MOST IMPORTANT TEST IN THIS FILE. `TmPane`'s δ table renders only the rows in view and offsets
-  // them with `translateY` (`tm-pane.ts`'s `#drawTable`), so a clicked row's DOM index is
-  // `firstDrawn + i`, not the row number `i` alone. Getting that wrong does not crash — it silently
+  // them with `translateY` (`VirtualGrid.draw`), so a clicked row's DOM index is not its row number: the
+  // grid reads the row number off the row's `aria-rowindex`. Getting that wrong does not crash — it silently
   // resolves a click against a DIFFERENT, plausible-looking block, and only once the table has been
   // scrolled away from its first page. A click against an UNscrolled table passes whether or not the
   // offset is right, which would make such a test worse than no test at all — so this scrolls the table
diff --git a/web/tests/browser/panel.test.ts b/web/tests/browser/panel.test.ts
index 1c074fe..541fe34 100644
--- a/web/tests/browser/panel.test.ts
+++ b/web/tests/browser/panel.test.ts
@@ -52,6 +52,14 @@ describe('createPanel', () => {
     expect(a.toggle.id).not.toBe(b.toggle.id)
   })
 
+  it('keeps a role the body already declares, and names it by its button all the same', () => {
+    const b = body()
+    b.setAttribute('role', 'grid')
+    const p = createPanel({ name: 'rules', label: 'rules', body: b })
+    expect(b.getAttribute('role')).toBe('grid')
+    expect(b.getAttribute('aria-labelledby')).toBe(p.toggle.id)
+  })
+
   it('keeps an id the body already has', () => {
     const b = body()
     b.id = 'mine'
diff --git a/web/tests/browser/virtual-grid.test.ts b/web/tests/browser/virtual-grid.test.ts
new file mode 100644
index 0000000..f900219
--- /dev/null
+++ b/web/tests/browser/virtual-grid.test.ts
@@ -0,0 +1,224 @@
+import { afterEach, describe, expect, it, vi } from 'vitest'
+import { userEvent } from 'vitest/browser'
+import { ROW_HEIGHT } from '../../src/state-table'
+import { OVERSCAN, VirtualGrid } from '../../src/virtual-grid'
+import { until } from './harness'
+
+/**
+ * `VirtualGrid` on its own, with nothing of a view around it: the contract the TM rule table and the asm listing both
+ * draw on. The rule table's own suites (`tm-grid`, `tm-pointer`, `tm-follow-clamp`, `app`) hold the same behaviour
+ * through a real view; these hold it where a second view could not quietly depend on the first view's wiring.
+ *
+ * **THE ROW CLASSES ARE THE RULE TABLE'S**, so `style.css`'s `.state-row` height — which must equal `ROW_HEIGHT` —
+ * applies here as it does there. The box's height is set inline: no view's flex layout bounds it.
+ */
+
+const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
+/**
+ * The next `scroll` event on `el`, once the grid's own listener — registered first, in its constructor — has run.
+ * **AWAITED RATHER THAN COUNTING FRAMES**: a scroll's event came later than two frames when the whole file ran, so an
+ * assertion after two frames could run before the event it was about, and pass whatever the handler would have done.
+ */
+const scrolled = (el: HTMLElement) => new Promise<void>((r) => el.addEventListener('scroll', () => r(), { once: true }))
+
+type Made = {
+  grid: VirtualGrid
+  activate: ReturnType<typeof vi.fn>
+  set(next: { count?: number | null; follow?: number | null; open?: boolean }): void
+}
+
+/** A grid of `count` rows, each reading `row N`, in a box `height` pixels tall, attached to the page and drawn once. */
+function make(count: number | null, height = 240): Made {
+  let state = { count, follow: null as number | null, open: true }
+  const activate = vi.fn()
+  const grid = new VirtualGrid({
+    classes: { box: 'state-table', spacer: 'state-spacer', rows: 'state-rows', row: 'state-row' },
+    idPrefix: 'g',
+    isOpen: () => state.open,
+    rows: () => ({
+      count: state.count,
+      follow: state.follow,
+      fill: (i, _row, cell) => {
+        cell.className = 'state-cell'
+        cell.textContent = `row ${i}`
+      },
+    }),
+    activate,
+  })
+  grid.el.style.height = `${height}px`
+  document.body.append(grid.el)
+  grid.draw()
+  return {
+    grid,
+    activate,
+    set(next) {
+      state = { ...state, ...next }
+    },
+  }
+}
+
+const drawn = (g: VirtualGrid) => [...g.el.querySelectorAll<HTMLElement>('[role="row"]')]
+const indexOf = (row: HTMLElement) => Number(row.getAttribute('aria-rowindex')) - 1
+/** The scrollTop that centres `row` in a box of `height` over `count` rows — `centredScrollTop`'s arithmetic. */
+const centred = (row: number, height: number, count: number) =>
+  Math.max(0, Math.min(row * ROW_HEIGHT - Math.floor(height / 2) + ROW_HEIGHT / 2, count * ROW_HEIGHT - height))
+
+afterEach(() => {
+  document.body.innerHTML = ''
+})
+
+describe('a virtual grid', () => {
+  it('draws only the rows in view, counts all of them, and names its active row', () => {
+    const { grid } = make(1000)
+    expect(grid.el.getAttribute('role')).toBe('grid')
+    expect(grid.el.getAttribute('aria-rowcount')).toBe('1000')
+    const rows = drawn(grid)
+    expect(rows.length).toBeLessThanOrEqual(Math.ceil(240 / ROW_HEIGHT) + 1 + 2 * OVERSCAN)
+    expect(rows[0]?.getAttribute('aria-rowindex')).toBe('1')
+    expect(rows[0]?.querySelector('[role="gridcell"]')?.id).toBe('g-0')
+    expect(grid.el.getAttribute('aria-activedescendant')).toBe('g-0')
+    expect(rows[0]?.classList.contains('is-active')).toBe(true)
+  })
+
+  it('clears itself for no content at all', () => {
+    const made = make(10)
+    made.set({ count: null })
+    made.grid.draw()
+    expect(drawn(made.grid)).toHaveLength(0)
+    expect(made.grid.el.hasAttribute('aria-rowcount')).toBe(false)
+    expect(made.grid.el.hasAttribute('aria-activedescendant')).toBe(false)
+  })
+
+  it('moves the active row by index with the keys, past the drawn window, and scrolls so it is drawn', async () => {
+    const { grid } = make(1000)
+    grid.el.focus()
+    await userEvent.keyboard('{End}')
+    expect(grid.el.getAttribute('aria-activedescendant')).toBe('g-999')
+    expect(document.getElementById('g-999')).not.toBeNull()
+    await userEvent.keyboard('{Home}')
+    expect(grid.el.getAttribute('aria-activedescendant')).toBe('g-0')
+    await userEvent.keyboard('{PageDown}')
+    // A page is the whole rows in view less one: 240 / 24 = 10, so 9.
+    expect(grid.el.getAttribute('aria-activedescendant')).toBe('g-9')
+    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
+    expect(grid.el.getAttribute('aria-activedescendant')).toBe('g-10')
+    await userEvent.keyboard('{PageUp}')
+    expect(grid.el.getAttribute('aria-activedescendant')).toBe('g-1')
+  })
+
+  it('activates the active row on Enter', async () => {
+    const { grid, activate } = make(1000)
+    grid.el.focus()
+    await userEvent.keyboard('{End}{Enter}')
+    expect(activate).toHaveBeenCalledExactlyOnceWith(999)
+  })
+
+  it('activates the row a real click lands on, once, from the focus elsewhere, and keeps the focus', async () => {
+    const { grid, activate } = make(1000)
+    // THE VIEW'S REDRAW ON TAKING THE FOCUS, which every view around a grid has (its `draw()` runs on a focus change):
+    // a draw replaces every row, so a row focused on `mousedown` would be gone before `mouseup`.
+    grid.el.addEventListener('focus', () => grid.draw())
+    const elsewhere = document.createElement('button')
+    document.body.prepend(elsewhere)
+    elsewhere.focus()
+    grid.el.scrollTop = 400 * ROW_HEIGHT
+    await until(() => indexOf(drawn(grid)[0] as HTMLElement) > 300, 'the grid to scroll')
+    const row = drawn(grid)[OVERSCAN + 2] as HTMLElement
+    const at = indexOf(row)
+    await userEvent.click(row)
+    expect(activate).toHaveBeenCalledExactlyOnceWith(at)
+    expect(document.activeElement).toBe(grid.el)
+    expect(grid.el.getAttribute('aria-activedescendant')).toBe(`g-${at}`)
+  })
+
+  it('centres the row it follows, stops at a scroll of the user’s, and follows again on attach', async () => {
+    const made = make(1000)
+    made.set({ follow: 500 })
+    made.grid.draw()
+    expect(made.grid.el.scrollTop).toBe(centred(500, 240, 1000))
+    expect(made.grid.following).toBe(true)
+    made.grid.el.scrollTop = 0
+    await until(() => !made.grid.following, 'a user scroll to detach following')
+    made.grid.draw()
+    expect(made.grid.el.scrollTop).toBe(0)
+    made.grid.attach()
+    expect(made.grid.following).toBe(true)
+    expect(made.grid.el.scrollTop).toBe(centred(500, 240, 1000))
+  })
+
+  it('stops following on a key that scrolls, before the draw that key causes', async () => {
+    const made = make(1000)
+    made.set({ follow: 500 })
+    made.grid.draw()
+    made.grid.el.focus()
+    await userEvent.keyboard('{Home}')
+    expect(made.grid.following).toBe(false)
+    expect(made.grid.el.scrollTop).toBe(0)
+    made.grid.draw()
+    expect(made.grid.el.scrollTop).toBe(0)
+  })
+
+  it("lets a link's row win over following for exactly one draw, still following", async () => {
+    const made = make(1000)
+    made.set({ follow: 500 })
+    made.grid.draw()
+    made.grid.scrollToRow(10)
+    const echo = scrolled(made.grid.el)
+    made.grid.draw()
+    expect(made.grid.el.scrollTop).toBe(centred(10, 240, 1000))
+    expect(made.grid.following).toBe(true)
+    await echo
+    // The scroll's own echo did not detach following, and the next draw is following's again.
+    expect(made.grid.following).toBe(true)
+    made.grid.draw()
+    expect(made.grid.el.scrollTop).toBe(centred(500, 240, 1000))
+  })
+
+  it('goes back to the top, following, with the first row active, on reset', async () => {
+    const made = make(1000)
+    made.grid.el.focus()
+    await userEvent.keyboard('{End}')
+    expect(made.grid.following).toBe(false)
+    const echo = scrolled(made.grid.el)
+    made.grid.reset()
+    made.grid.draw()
+    expect(made.grid.el.scrollTop).toBe(0)
+    expect(made.grid.el.getAttribute('aria-activedescendant')).toBe('g-0')
+    await echo
+    // The reset's own scroll was recorded before it was written, so its echo did not detach following.
+    expect(made.grid.following).toBe(true)
+  })
+
+  it('reads no scroll as the user’s while its panel is closed', async () => {
+    const made = make(1000)
+    made.set({ follow: 500 })
+    made.grid.draw()
+    // A SCROLL EVENT ARRIVING WHILE THE PANEL IS CLOSED. In the app it is the late echo of a draw's own write, landing
+    // on a box the panel has hidden, where `scrollTop` reads 0. A hidden box here would drop the event, so the box
+    // stays shown and only the panel says it is closed; the write below is far from what following expects, and would
+    // read as the user's if the grid listened.
+    made.set({ open: false })
+    const event = scrolled(made.grid.el)
+    made.grid.el.scrollTop = 0
+    await event
+    expect(made.grid.el.scrollTop).toBe(0)
+    expect(made.grid.following).toBe(true)
+    made.set({ open: true })
+    made.grid.draw()
+    expect(made.grid.el.scrollTop).toBe(centred(500, 240, 1000))
+  })
+
+  it('keeps following when it grows and its scroll is clamped', async () => {
+    const made = make(1000)
+    made.set({ follow: 999 })
+    made.grid.draw()
+    expect(made.grid.el.scrollTop).toBe(1000 * ROW_HEIGHT - 240)
+    const clamp = scrolled(made.grid.el)
+    made.grid.el.style.height = '600px'
+    await clamp
+    await frame()
+    await frame()
+    expect(made.grid.el.scrollTop).toBe(1000 * ROW_HEIGHT - 600)
+    expect(made.grid.following).toBe(true)
+  })
+})
````


- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts`

Expected: exit 1, printing:

```text
    × keeps a role the body already declares, and names it by its button all the same
    Test Files  2 failed (2)
    Tests  1 failed | 12 passed (13)
    FAIL  |browser (chromium)| tests/browser/virtual-grid.test.ts [ tests/browser/virtual-grid.test.ts ]
    FAIL  |browser (chromium)| tests/browser/panel.test.ts > createPanel > keeps a role the body already declares, and names it by its button all the same
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=2
diff --git a/web/src/draw.ts b/web/src/draw.ts
index f2cf160..38dbb24 100644
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -207,9 +207,9 @@ export function createDraw(deps: {
         //
         // `false` FOR `scrollTo`, NOT `origin !== 'tm'` AS THE FAN-OUT PASSES: there is no `origin` here,
         // this is a seed rather than a gesture, and a scroll asked for here would not last — `setLink`'s
-        // one-shot `#pendingScroll` is consumed by its own `#drawTable` call, and `p.slot.render` below, in
-        // this same iteration, calls `#drawTable` again and re-targets the follow point `seedTm`'s
-        // `setProgram` just re-attached (`#follow.attach()`), overwriting it. A seeded view opens on its
+        // one-shot target (`VirtualGrid.scrollToRow`) is consumed by its own `#drawTable` call, and `p.slot.render`
+        // below, in this same iteration, calls `#drawTable` again and re-targets the follow point `seedTm`'s
+        // `setProgram` just re-attached (`VirtualGrid.reset`), overwriting it. A seeded view opens on its
         // follow target, as it did before this pane was ever skipped a compile — the pin still paints, just
         // without staking a scroll claim over it.
         const pin =
diff --git a/web/src/panel.ts b/web/src/panel.ts
index 31303e1..06ff814 100644
--- a/web/src/panel.ts
+++ b/web/src/panel.ts
@@ -60,7 +60,10 @@ export function createPanel(opts: PanelOptions): Panel {
 
   const body = opts.body
   if (body.id === '') body.id = `panel-body-${n}`
-  body.setAttribute('role', 'region')
+  // A BODY THAT ALREADY SAYS WHAT IT IS KEEPS ITS ROLE: `virtual-grid.ts`'s box is a `grid`, and stays one inside its
+  // panel, labelled by the toggle all the same. Every other body is a plain container, and a region is what the
+  // toggle discloses.
+  if (!body.hasAttribute('role')) body.setAttribute('role', 'region')
   body.setAttribute('aria-labelledby', toggle.id)
   toggle.setAttribute('aria-controls', body.id)
   el.append(header, body)
diff --git a/web/src/state-diagram.ts b/web/src/state-diagram.ts
index 65c1fa8..cfc54bd 100644
--- a/web/src/state-diagram.ts
+++ b/web/src/state-diagram.ts
@@ -5,7 +5,7 @@ import { Follow, ROW_HEIGHT } from './state-table'
 import type { TmProgram, TmState } from './types'
 import { visibleWindow } from './virtual-list'
 
-/** Rows drawn beyond the viewport on each side — the rule table's `OVERSCAN`, for its reason. */
+/** Rows drawn beyond the viewport on each side — `virtual-grid.ts`'s `OVERSCAN`, for its reason. */
 const OVERSCAN = 4
 /** Pixels between two lanes of *arcs*' gutter, and the gutter's margin beside the rows. */
 const LANE = 9
@@ -203,7 +203,7 @@ export class StateDiagram {
       this.#on.moved?.()
     })
     // NOTHING IN THE ROWS TAKES THE FOCUS ON `mousedown`; THE GRID TAKES IT WHEN THE CLICK LANDS — the rule table's
-    // rows container says why (`TmPane`'s constructor): the view's draw on taking the focus replaced the row under
+    // rows container says why (`VirtualGrid`'s constructor): the view's draw on taking the focus replaced the row under
     // the pointer, and the click was lost. *Show states* lost every click, since a button out of the tab order still
     // takes the focus from a pointer. The primary button only, so a middle button still scrolls.
     this.#rowsEl.addEventListener('mousedown', (e) => {
@@ -939,7 +939,7 @@ export class StateDiagram {
   }
 
   /**
-   * The grid's keys, the rule table's (`TmPane`'s `#key`): ↑/↓, PgUp/PgDn and Home/End move the active row by
+   * The grid's keys, the rule table's (`VirtualGrid`'s `#key`): ↑/↓, PgUp/PgDn and Home/End move the active row by
    * index; Enter is `#linkRow`'s own — a group's row links it, the sub-steps row shows states instead — and a
    * key that scrolls detaches following before the draw that would undo it.
    */
diff --git a/web/src/tm-pane.ts b/web/src/tm-pane.ts
index 95f8f32..1047d2e 100644
--- a/web/src/tm-pane.ts
+++ b/web/src/tm-pane.ts
@@ -12,18 +12,16 @@ import type { ScratchEditorConfig } from './scratch-editor'
 import { ScratchEditor } from './scratch-editor'
 import type { Binding, PaneOption } from './sessions'
 import { StateDiagram } from './state-diagram'
-import { centredScrollTop, Follow, focusedRows, highlight, linkedRows, ROW_HEIGHT, StateIndex } from './state-table'
+import { focusedRows, highlight, linkedRows, StateIndex } from './state-table'
 import { stepControls } from './step-controls'
 import { tapeLabel, tapeRows } from './tape'
 import type { TmProgram, TmScratchStatus, TmState, ValueReading } from './types'
 import { radioGroup, type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
-import { visibleWindow } from './virtual-list'
+import { type GridRows, VirtualGrid } from './virtual-grid'
 import { DEFAULT_TM_DISPLAY, type TmDisplay } from './workspace'
 
 export { ROW_HEIGHT } from './state-table'
-
-/** Rows rendered beyond the viewport on each side, so a fast scroll does not show blank space. */
-export const OVERSCAN = 4
+export { OVERSCAN } from './virtual-grid'
 
 /** Mints each pane's grid a prefix for its cells' ids, which `aria-activedescendant` names. */
 let gridsMinted = 0
@@ -176,12 +174,14 @@ export class TmPane implements EditablePane {
    */
   #detached = false
 
-  #tableHost: HTMLElement
-  #spacer: HTMLElement
-  #rows: HTMLElement
   /**
-   * The rule table as a panel (Plan 7 part 1, spec §8): the body is `#tableHost`, the header action is
-   * `#reattach`. The panel hides and shows `#tableHost` and holds whether the table is open (`isOpen`);
+   * The rule table: a `VirtualGrid`, whose box is the rules panel's body. This view says what each row shows and does
+   * (`#tableRows`); the grid owns the drawn window, the active row, the keys, clicks and following.
+   */
+  #grid: VirtualGrid
+  /**
+   * The rule table as a panel (Plan 7 part 1, spec §8): the body is the grid's box, the header action is
+   * `#reattach`. The panel hides and shows the box and holds whether the table is open (`isOpen`);
    * this class keeps no copy, so a `setOpen` cannot leave one stale. Its `onToggle` redraws. Not `#rules`,
    * which is the machine's rule count.
    */
@@ -202,7 +202,6 @@ export class TmPane implements EditablePane {
   #onDisplay: ((d: TmDisplay) => void) | undefined
   #reattach: HTMLButtonElement
   #index: StateIndex | null = null
-  #follow = new Follow()
   #linked: Set<number> = new Set()
   /**
    * The running focus's own rows — a SECOND, INDEPENDENT layer from `#linked` above, mirroring the
@@ -211,24 +210,6 @@ export class TmPane implements EditablePane {
    * drives a scroll the way `setLink` can.
    */
   #focused: Set<number> = new Set()
-  /**
-   * A one-shot scroll target `#drawTable` honours in preference to `Follow`'s own target, for exactly
-   * the next draw — see `setLink`'s doc and design §5.1. `null` when there is nothing pending.
-   */
-  #pendingScroll: number | null = null
-  /** The DOM index of `this.#rows.children[0]`, within `#index`. See `#drawTable`'s doc. */
-  #firstDrawn = 0
-  /** The table's height at the last draw — how its `scroll` handler tells a clamp from a user's scroll. */
-  #drawnHeight = 0
-  /**
-   * The grid's active row (spec §9.2), **AN INDEX INTO `#index`, NOT INTO THE DRAWN WINDOW** — accessibility
-   * item 3, which found a cursor designed against the rendered rows unable to move past them. The keys move it
-   * by index and scroll so it is drawn; a scroll the user or following makes carries it along instead, so
-   * `aria-activedescendant` always names a row that is in the DOM (`#drawTable`), as the λ view's does.
-   */
-  #active = 0
-  /** This pane's prefix for its cells' ids. */
-  #gridId = `tm-grid-${gridsMinted++}`
 
   /**
    * `panels` is the view's stored panel state (`workspace.ts`'s `Panels`), read once here; each panel reports
@@ -280,8 +261,8 @@ export class TmPane implements EditablePane {
     this.#collapse = textPanel(this.#editorHost, (collapsed) => on.collapse?.(collapsed))
 
     // ADDED AND REMOVED, NEVER DISABLED — same idiom `pane-chrome.ts` states for the continue button.
-    // A reattach only does something while the table is detached, so it exists only then; `#drawTable`
-    // keeps `hidden` in sync every frame and every scroll, the one place both happen.
+    // A reattach only does something while the table is detached, so it exists only then; the grid's
+    // `beforeDraw`, below, keeps `hidden` in sync every frame and every scroll, the one place both happen.
     this.#reattach = document.createElement('button')
     this.#reattach.type = 'button'
     this.#reattach.className = 'table-reattach'
@@ -289,80 +270,52 @@ export class TmPane implements EditablePane {
     this.#reattach.hidden = true
     this.#reattach.addEventListener('click', () => {
       const had = document.activeElement === this.#reattach
-      this.#follow.attach()
-      // Redraw now, not at the next step — otherwise the current row stays wherever the manual scroll
-      // left it until the machine happens to advance.
-      this.#drawTable()
-      // THE BUTTON HIDES ITSELF — `#drawTable` sets `#reattach.hidden` once the table follows again — AND
+      // Follows and redraws now, not at the next step — otherwise the current row stays wherever the manual
+      // scroll left it until the machine happens to advance.
+      this.#grid.attach()
+      // THE BUTTON HIDES ITSELF — the draw sets `#reattach.hidden` once the table follows again — AND
       // MUST NOT TAKE THE FOCUS WITH IT (spec §11): the rules panel's toggle, beside it, takes it.
       if (had && this.#reattach.hidden) this.#rulesPanel.toggle.focus()
     })
 
-    this.#rows = document.createElement('div')
-    this.#rows.className = 'state-rows'
-    this.#spacer = document.createElement('div')
-    this.#spacer.className = 'state-spacer'
-    this.#spacer.append(this.#rows)
-    this.#tableHost = document.createElement('div')
-    this.#tableHost.className = 'state-table'
-    this.#tableHost.append(this.#spacer)
-    this.#tableHost.addEventListener('scroll', () => {
-      // A SCROLL EVENT ON A HIDDEN TABLE IS NEVER USER INTENT, and reading it as such detached a
-      // following table with no user gesture at all. `#drawTable` writes `scrollTop`, and the browser
-      // delivers that write's event at the NEXT rendering update rather than synchronously — so
-      // hiding the table in between lands the echo on a `display: none` box, where `scrollTop` reads
-      // back 0, which is further from the expected position than any tolerance. Reproduced 5/5 in
-      // Chromium: step, close the rules panel, reopen it, and the table is detached with the current row
-      // gone from the DOM. A hidden box cannot be scrolled by a person, so there is nothing here to honour.
-      if (!this.#rulesPanel.isOpen()) return
-      // A TABLE THAT CHANGED HEIGHT SINCE IT WAS DRAWN MAY HAVE HAD ITS SCROLL CLAMPED (spec §9.1 made its height
-      // the view's), and this event can come before the resize observer's — `StateDiagram`'s handler says how.
-      if (this.#tableHost.clientHeight !== this.#drawnHeight) this.#follow.onResize(this.#tableHost.scrollTop)
-      this.#follow.onScroll(this.#tableHost.scrollTop)
-      this.#drawTable()
-    })
-
-    // A ROW TAKES NO FOCUS ON `mousedown`; THE GRID TAKES IT WHEN THE CLICK LANDS (spec amendment 18). Focusing
-    // the grid draws the view, and the draw replaces every row: taken on `mousedown`, as the browser would, it
-    // removed the row under the pointer before `mouseup`, and the browser fired no `click` at all — every first
-    // click on the table from anywhere else was lost. The primary button only, so a middle button still scrolls.
-    this.#rows.addEventListener('mousedown', (event) => {
-      if (event.button === 0) event.preventDefault()
-    })
-    // CLICK A ROW, LIGHT ITS SOURCE. The table is 127,881 rows for `list60` and nothing in it says
-    // what any row is FOR; this is the answer to that. Delegated from the container rather than bound
-    // per row, because rows are recreated on every draw. The row clicked becomes the grid's active row,
-    // painted before the link's own draw so a pane with no `linkState` handler shows it too.
-    this.#rows.addEventListener('click', (event) => {
-      const target = event.target
-      const el = target instanceof HTMLElement ? target.closest('.state-row') : null
-      // READ BEFORE THE FOCUS BELOW, whose draw replaces the rows and can move the window they start at.
-      const i = el instanceof HTMLElement ? [...this.#rows.children].indexOf(el) : -1
-      const at = this.#firstDrawn + i
-      this.#tableHost.focus({ preventScroll: true })
-      if (this.#index === null || i < 0) return
-      const row = this.#index.row(at)
-      if (row === null) return
-      this.#active = at
-      this.#drawTable()
-      on.linkState?.(row.kind === 'state' ? row.id : row.stateId)
+    // THE TABLE IS A GRID (spec §9.2, accessibility item 3): one tab stop, one `gridcell` per row, and a roving active
+    // row that `aria-activedescendant` names — `VirtualGrid`, whose doc carries the scroll, focus and clamp handling
+    // this table's reviews found. CLICK A ROW, LIGHT ITS SOURCE: the table is 127,881 rows for `list60` and nothing
+    // in it says what any row is FOR; `activate` is the answer to that, for a click and for Enter alike.
+    this.#grid = new VirtualGrid({
+      classes: { box: 'state-table', spacer: 'state-spacer', rows: 'state-rows', row: 'state-row' },
+      idPrefix: `tm-grid-${gridsMinted++}`,
+      isOpen: () => this.#rulesPanel.isOpen(),
+      rows: () => this.#tableRows(),
+      activate: (i) => {
+        const row = this.#index?.row(i) ?? null
+        if (row !== null) on.linkState?.(row.kind === 'state' ? row.id : row.stateId)
+      },
+      // KEPT IN SYNC HERE, not in the click handlers, because a draw is the one thing that runs on every frame AND
+      // every scroll — the two ways following can change. Hidden with no program at all (reattaching means nothing
+      // against an empty table) and while the table is closed, where the button would offer to reposition something
+      // nobody can see — the same idiom the control itself follows, which exists so a control is present only when
+      // it does something.
+      beforeDraw: () => {
+        this.#reattach.hidden = this.#index === null || this.#grid.following || !this.#rulesPanel.isOpen()
+      },
     })
 
-    // THE RULE TABLE IS A PANEL. `panel.ts` hides `#tableHost` itself and carries the state in
-    // `aria-expanded` rather than relabelling — accessibility item 2. `follow current rule` rides in the
-    // panel's header, beside the thing it acts on.
+    // THE RULE TABLE IS A PANEL. `panel.ts` hides the grid's box itself and carries the state in
+    // `aria-expanded` rather than relabelling — accessibility item 2 — and keeps the box's `grid` role, labelled
+    // by the panel's own toggle. `follow current rule` rides in the panel's header, beside the thing it acts on.
     //
-    // REDRAW IN BOTH DIRECTIONS, and the closing one is not symmetry for its own sake. `#drawTable` is
-    // where `#reattach.hidden` is maintained, so skipping it on the way down left a live "follow" button
+    // REDRAW IN BOTH DIRECTIONS, and the closing one is not symmetry for its own sake. A draw is where
+    // `#reattach.hidden` is maintained, so skipping it on the way down left a live "follow" button
     // over a table that is not on screen — the idiom's own rule broken, and the closed-table term written
-    // for it could never fire because `#drawTable`, where it is evaluated, did not run. Reopening matters
+    // for it could never fire because the draw, where it is evaluated, did not run. Reopening matters
     // for a different reason: a hidden box has `clientHeight` 0, so any step taken while the table was
     // closed computed its scroll target against a zero-height viewport and left the head parked off
     // centre until some later step happened to recentre it.
     this.#rulesPanel = createPanel({
       name: 'rules',
       label: 'rules',
-      body: this.#tableHost,
+      body: this.#grid.el,
       open: panels.rules ?? true,
       onToggle: (open) => {
         this.#drawTable()
@@ -371,22 +324,6 @@ export class TmPane implements EditablePane {
     })
     this.#rulesPanel.actions.append(this.#reattach)
 
-    // THE TABLE IS A GRID (spec §9.2, accessibility item 3): one tab stop, one `gridcell` per row, and a
-    // roving active row that `aria-activedescendant` names. `createPanel`, just above, made `#tableHost` a labelled
-    // region; it is the grid instead, still labelled by the panel's own toggle. The two wrappers between it and
-    // the rows are layout, so they say so to the accessibility tree.
-    this.#tableHost.setAttribute('role', 'grid')
-    this.#tableHost.tabIndex = 0
-    this.#spacer.setAttribute('role', 'none')
-    this.#rows.setAttribute('role', 'rowgroup')
-    this.#tableHost.addEventListener('keydown', (e) => this.#key(e, on.linkState))
-    // THE TABLE'S HEIGHT IS THE VIEW'S NOW, NOT THE VIEWPORT'S (spec §9.1): a divider drag, a panel opening
-    // beside it or a window resize changes it with no frame or scroll to redraw the window it draws.
-    new ResizeObserver(() => {
-      this.#follow.onResize(this.#tableHost.scrollTop)
-      this.#drawTable()
-    }).observe(this.#tableHost)
-
     // THE STATE DIAGRAM (spec §8): a panel beside the rules, open by default since it is the view's map of the
     // machine, with *program | local* and *arcs | chips* (amendment 11) among its header actions and a
     // re-attach of its own, for the rule table's reason: following is per surface, and a scroll in one
@@ -505,15 +442,9 @@ export class TmPane implements EditablePane {
     // or may now name something else entirely.
     this.#linked = new Set()
     this.#focused = new Set()
-    this.#active = 0
-    this.#follow.attach()
-    // `onProgrammaticScroll` BEFORE the write, not after, and not omitted. Setting `scrollTop` fires a
-    // `scroll` event; without a pending expectation `Follow` reads it as the user taking control and
-    // detaches on the spot — so the table would never follow after a compile. Intermittent, too: no
-    // event fires when `scrollTop` was already 0, so it would work on the first program and fail on
-    // every one after a scroll. Found by Task 5's re-review before this code was written.
-    this.#follow.onProgrammaticScroll(0)
-    this.#tableHost.scrollTop = 0
+    // The first row active, following on, and the table at the top — `VirtualGrid.reset`'s doc says why its
+    // scroll is recorded before it is written.
+    this.#grid.reset()
     this.#frame = null
     this.#drawTable()
     this.#diagram.setProgram(p, names)
@@ -548,30 +479,18 @@ export class TmPane implements EditablePane {
    * in moves the row out from under their cursor; the caller knows where the gesture came from and
    * this does not have to guess.
    *
-   * THE SCROLL DOES NOT TOUCH `Follow`'S OWN FLAG. Following is about the machine's current state, and
-   * a link is about a construct — reusing `Follow` here would make a link click silently reattach a
-   * table the user had deliberately detached, or detach one they had not. But `#drawTable`, called
-   * unconditionally below, recomputes ITS OWN follow target whenever `#follow.following` is true — so
-   * writing `scrollTop` here directly used to be reverted in the very same synchronous block the
-   * instant following was on, which is the default state on every fresh compile. Design §5.1: a link
-   * scroll is a direct user gesture and wins for exactly ONE draw; recording it as a one-shot pending
-   * target rather than writing it here is what lets `#drawTable` honour it over the follow target for
-   * that one draw without `Follow` itself ever being told the table stopped following.
+   * THE SCROLL DOES NOT TOUCH FOLLOWING. Following is about the machine's current state, and a link is
+   * about a construct; `VirtualGrid.scrollToRow` records the link's row as a one-shot target the next draw
+   * honours over the follow target — design §5.1 — and its doc says why writing `scrollTop` here instead
+   * was reverted in the same synchronous block the instant following was on, which is the default state on
+   * every fresh compile.
    */
   setLink(states: number[], scrollTo: boolean): void {
     this.#linked = this.#index === null ? new Set() : linkedRows(this.#index, states)
     this.#diagram.setLinked(states)
-    if (scrollTo && this.#index !== null && this.#rulesPanel.isOpen()) {
+    if (scrollTo) {
       const first = [...this.#linked].sort((a, b) => a - b)[0]
-      if (first !== undefined) {
-        // Shared with `Follow.targetScrollTop` via `centredScrollTop` — see that function's doc.
-        this.#pendingScroll = centredScrollTop(
-          first,
-          ROW_HEIGHT,
-          this.#tableHost.clientHeight,
-          this.#index.rowCount * ROW_HEIGHT,
-        )
-      }
+      if (first !== undefined) this.#grid.scrollToRow(first)
     }
     this.#drawTable()
   }
@@ -612,7 +531,7 @@ export class TmPane implements EditablePane {
    * that method's doc carries the naming argument, which is not repeated here.
    *
    * **THIS FILE NOW HAS TWO UNRELATED MEANINGS OF "DETACHED", AND THE SPEC DID NOT NOTICE.**
-   * `Follow`'s detach — `#reattach`, `#follow.following`, `state-table.ts`'s own vocabulary — means
+   * `Follow`'s detach — `#reattach`, the grid's `following`, `state-table.ts`'s own vocabulary — means
    * THE USER SCROLLED THE δ-TABLE AWAY FROM THE CURRENT ROW, a scroll-position fact about one widget
    * inside this pane, undone by the `follow current rule` button sitting a few lines above the table. §4.5's
    * detached means THIS PANE IS BOUND TO A SCRATCH SESSION and is outside the correspondence
@@ -625,8 +544,8 @@ export class TmPane implements EditablePane {
    * SCREEN — the status sits in the header's `<h2>`, after the view's title, while the follow state
    * is a button captioned `follow current rule` in the rules panel's header. In CODE they are one word
    * apart, so the status lives in `#header` rather than in anything containing "detach", and this note
-   * exists so the next reader of `#drawTable`'s `#reattach.hidden` line does not go looking for a
-   * connection.
+   * exists so the next reader of the grid's `beforeDraw`, which sets `#reattach.hidden`, does not go looking
+   * for a connection.
    *
    * **AN EDITOR CANNOT OUTLIVE `#detached` HERE EITHER — Important finding, review of Task 8.**
    * `LambdaPane.setDetached`'s own doc records the same line ported below and the defect that made it
@@ -1011,193 +930,53 @@ export class TmPane implements EditablePane {
   }
 
   /**
-   * Draw only the rows in view. Called on every frame AND on every scroll, so it must stay O(visible)
-   * rather than O(rowCount) — 127,881 rows is the number that decides it.
+   * Draw the rule table: `VirtualGrid.draw`, with this view's rows (`#tableRows`). The grid also draws on its own for
+   * a scroll, a resize, a key and a click; this is the draw for everything the grid cannot see change — a frame, a
+   * program, a link, the panel opening.
    */
   #drawTable(): void {
-    // Kept in sync HERE, not in the click handlers, because this is the one place that runs on every
-    // frame AND every scroll — the two ways `#follow.following` can change. Hidden with no program at
-    // all (reattaching means nothing against an empty table) and while the table is closed, where the
-    // button would offer to reposition something nobody can see — the same idiom the control itself
-    // follows, which exists so a control is present only when it does something.
-    this.#reattach.hidden = this.#index === null || this.#follow.following || !this.#rulesPanel.isOpen()
-
-    if (this.#index === null) {
-      this.#rows.replaceChildren()
-      this.#spacer.style.height = '0px'
-      this.#tableHost.removeAttribute('aria-rowcount')
-      this.#tableHost.removeAttribute('aria-activedescendant')
-      return
-    }
-    this.#tableHost.setAttribute('aria-rowcount', String(this.#index.rowCount))
-
-    // THE SPACER CARRIES THE SCROLL RANGE, AND IT MUST STAY HONEST WHILE THE TABLE IS CLOSED. Setting
-    // `scrollTop` CLAMPS to the element's current scroll height, so a spacer left at a previous
-    // program's size silently truncates the next write — including the one the reopen below performs.
-    // Hence both orderings here are load-bearing: before the early return, and before the `scrollTop`
-    // write further down. `visibleWindow`'s `totalHeight` is this same product, so it is not written
-    // twice.
-    this.#spacer.style.height = `${this.#index.rowCount * ROW_HEIGHT}px`
-
-    // NOTHING BELOW THIS LINE MAY RUN AGAINST A CLOSED TABLE, because everything below reads
-    // `clientHeight`, and a non-rendered box reports 0. `targetScrollTop` against a zero viewport
-    // returns the UNCENTRED position — `floor(viewportHeight / 2)` too low — and `onProgrammaticScroll`
-    // then records that as the echo to expect. The `scrollTop` write is a harmless no-op; the poisoned
-    // expectation is not, because the reopen draw finds the correct target already equal to the
-    // restored `scrollTop` and skips the write that would have corrected it. A later real scroll
-    // landing within the tolerance of the stale value is absorbed as an echo and does not detach.
-    // The rows drawn here would be wrong too — a zero viewport spans nine rows starting at 0 — and are
-    // all discarded on reopen, so this returns before the work as well as before the harm.
-    if (!this.#rulesPanel.isOpen()) return
-
-    // THE VIEW'S FLEX LAYOUT IS THE ONLY THING BOUNDING THIS BOX (`style.css`'s `.tm-pane > .panel` rules,
-    // spec §9.1), and `clientHeight` reports what it actually laid out rather than what the stylesheet asked
-    // for. If those rules never reach the page the box grows to its full content height — measured at
-    // 271,968px for 11,332 rows — `spanned` covers the whole table, and every draw renders every row. The
-    // browser tier loads `style.css` (`tests/browser/setup.ts`) and asserts this box stays bounded, so that
-    // gap fails a test rather than silently costing O(rowCount) per frame.
-    const viewportHeight = this.#tableHost.clientHeight
-    this.#drawnHeight = viewportHeight
-    const marks = highlight(this.#index, this.#frame)
-    // A PENDING LINK SCROLL WINS OVER THE FOLLOW TARGET FOR EXACTLY THIS DRAW, then is consumed —
-    // design §5.1. Read and cleared together so a link recorded during THIS call is what the very next
-    // draw honours, never twice: `Follow`'s `#expected` is armed ONCE below, by whichever branch runs,
-    // rather than by the pending write here and then again by the follow write that used to run
-    // unconditionally after it and silently revert it in the same synchronous block.
-    const pending = this.#pendingScroll
-    this.#pendingScroll = null
-    if (pending !== null) {
-      if (pending !== this.#tableHost.scrollTop) {
-        this.#follow.onProgrammaticScroll(pending)
-        this.#tableHost.scrollTop = pending
-      }
-    } else if (marks !== null) {
-      const top = this.#follow.targetScrollTop(
-        marks.stateRow,
-        ROW_HEIGHT,
-        viewportHeight,
-        this.#index.rowCount * ROW_HEIGHT,
-      )
-      if (top !== null && top !== this.#tableHost.scrollTop) {
-        this.#follow.onProgrammaticScroll(top)
-        this.#tableHost.scrollTop = top
-      }
-    }
-
-    const w = visibleWindow(this.#index.rowCount, ROW_HEIGHT, viewportHeight, this.#tableHost.scrollTop, OVERSCAN)
-    // THE ACTIVE ROW COMES WITH THE VIEW: kept to the whole rows on screen, not the overscan, so whatever
-    // moved the view — following, a link, the user — leaves `aria-activedescendant` naming a drawn row.
-    if (viewportHeight > 0) {
-      const top = Math.ceil(this.#tableHost.scrollTop / ROW_HEIGHT)
-      const bottom = Math.max(top, Math.floor((this.#tableHost.scrollTop + viewportHeight) / ROW_HEIGHT) - 1)
-      this.#active = Math.min(Math.max(this.#active, top), bottom, this.#index.rowCount - 1)
-    }
-    // THE VIRTUALIZATION OFFSET THE CLICK HANDLER NEEDS. `this.#rows.children[i]`'s row number is
-    // `w.firstIndex + i`, not `i` — the rows array is windowed and `translateY`-offset, so recording
-    // anything else here lights a plausible-looking but wrong block the moment the table is scrolled.
-    this.#firstDrawn = w.firstIndex
-    this.#rows.style.transform = `translateY(${w.offsetY}px)`
-
-    const els: HTMLElement[] = []
-    for (let i = w.firstIndex; i <= w.lastIndex; i += 1) {
-      const row = this.#index.row(i)
-      if (row === null) continue
-      const el = document.createElement('div')
-      el.className = 'state-row'
-      el.setAttribute('role', 'row')
-      // 1-BASED, as `aria-rowindex` is, and counted over the whole table: a screen reader says "row 40,213
-      // of 127,881" for a row that is one of forty in the DOM.
-      el.setAttribute('aria-rowindex', String(i + 1))
-      const text = document.createElement('div')
-      text.className = 'state-cell'
-      text.setAttribute('role', 'gridcell')
-      text.id = `${this.#gridId}-${i}`
-      if (row.kind === 'state') {
-        el.classList.add('is-state')
-        if (row.accept) el.classList.add('is-accept')
-        text.textContent = row.name
-      } else {
-        el.classList.add('is-rule')
-        const cell = (v: string | null) => v ?? '*'
-        text.textContent = `[${row.read.map(cell).join(' ')}] → [${row.write.map(cell).join(' ')}] ${row.moves.join(' ')} → ${
-          this.#program?.states[row.next]?.name ?? row.next
-        }`
-      }
-      el.append(text)
-      // THE CURRENT STATE IS SAID, NOT ONLY SHADED (spec §9.3, accessibility item 4); the next rule's words are
-      // generated content (`style.css`'s `.state-cell[data-marks]`), so they are read and are not the row's text.
-      if (marks !== null && i === marks.stateRow) {
-        el.classList.add('is-current')
-        el.setAttribute('aria-current', 'step')
-      }
-      if (marks !== null && i === marks.ruleRow) {
-        el.classList.add('is-next')
-        text.dataset.marks = 'fires next'
-      }
-      if (this.#linked.has(i)) el.classList.add('is-linked')
-      if (this.#focused.has(i)) el.classList.add('is-focus')
-      if (i === this.#active) el.classList.add('is-active')
-      els.push(el)
-    }
-    this.#rows.replaceChildren(...els)
-    if (this.#active >= w.firstIndex && this.#active <= w.lastIndex) {
-      this.#tableHost.setAttribute('aria-activedescendant', `${this.#gridId}-${this.#active}`)
-    } else {
-      this.#tableHost.removeAttribute('aria-activedescendant')
-    }
+    this.#grid.draw()
   }
 
   /**
-   * The grid's keys (spec §9.2): ↑/↓, PgUp/PgDn and Home/End move the active row BY INDEX, and the table scrolls
-   * so it is drawn; Enter does what a click does.
-   *
-   * **A KEY THAT SCROLLS IS THE USER TAKING CONTROL**, so following is detached before the draw below — its
-   * `scroll` event comes a frame later, and a draw still following would put the view back on the current row
-   * and carry the active row with it. The λ view's keys do the same (`lambda-body.ts`).
+   * The rule table's rows for one draw: one per state and one per rule (`StateIndex`), the current state's row as
+   * the one following keeps centred, and each row's text and marks.
    */
-  #key(e: KeyboardEvent, linkState: ((state: number) => void) | undefined): void {
+  #tableRows(): GridRows {
     const index = this.#index
-    if (index === null || index.rowCount === 0) return
-    const page = Math.max(1, Math.floor(this.#tableHost.clientHeight / ROW_HEIGHT) - 1)
-    let next = this.#active
-    switch (e.key) {
-      case 'ArrowDown':
-        next += 1
-        break
-      case 'ArrowUp':
-        next -= 1
-        break
-      case 'PageDown':
-        next += page
-        break
-      case 'PageUp':
-        next -= page
-        break
-      case 'Home':
-        next = 0
-        break
-      case 'End':
-        next = index.rowCount - 1
-        break
-      case 'Enter': {
-        const row = index.row(this.#active)
+    if (index === null) return { count: null, follow: null, fill: () => {} }
+    const marks = highlight(index, this.#frame)
+    return {
+      count: index.rowCount,
+      follow: marks === null ? null : marks.stateRow,
+      fill: (i, el, text) => {
+        const row = index.row(i)
         if (row === null) return
-        e.preventDefault()
-        linkState?.(row.kind === 'state' ? row.id : row.stateId)
-        return
-      }
-      default:
-        return
-    }
-    e.preventDefault()
-    this.#active = Math.min(Math.max(next, 0), index.rowCount - 1)
-    const top = this.#active * ROW_HEIGHT
-    const from = this.#tableHost.scrollTop
-    const to = top < from ? top : Math.max(from, top + ROW_HEIGHT - this.#tableHost.clientHeight)
-    if (to !== from) {
-      this.#follow.detach()
-      this.#tableHost.scrollTop = to
+        text.className = 'state-cell'
+        if (row.kind === 'state') {
+          el.classList.add('is-state')
+          if (row.accept) el.classList.add('is-accept')
+          text.textContent = row.name
+        } else {
+          el.classList.add('is-rule')
+          const cell = (v: string | null) => v ?? '*'
+          text.textContent = `[${row.read.map(cell).join(' ')}] → [${row.write.map(cell).join(' ')}] ${row.moves.join(' ')} → ${
+            this.#program?.states[row.next]?.name ?? row.next
+          }`
+        }
+        // THE CURRENT STATE IS SAID, NOT ONLY SHADED (spec §9.3, accessibility item 4); the next rule's words are
+        // generated content (`style.css`'s `.state-cell[data-marks]`), so they are read and are not the row's text.
+        if (marks !== null && i === marks.stateRow) {
+          el.classList.add('is-current')
+          el.setAttribute('aria-current', 'step')
+        }
+        if (marks !== null && i === marks.ruleRow) {
+          el.classList.add('is-next')
+          text.dataset.marks = 'fires next'
+        }
+        if (this.#linked.has(i)) el.classList.add('is-linked')
+        if (this.#focused.has(i)) el.classList.add('is-focus')
+      },
     }
-    this.#drawTable()
   }
 }
diff --git a/web/src/virtual-grid.ts b/web/src/virtual-grid.ts
new file mode 100644
index 0000000..fb60e89
--- /dev/null
+++ b/web/src/virtual-grid.ts
@@ -0,0 +1,348 @@
+import { centredScrollTop, Follow, ROW_HEIGHT } from './state-table'
+import { visibleWindow } from './virtual-list'
+
+/** Rows drawn beyond the viewport on each side, so a fast scroll does not show blank space. */
+export const OVERSCAN = 4
+
+/**
+ * What one draw of a grid shows: how many rows there are, which one following keeps centred, and how to fill a row.
+ *
+ * **ONE SNAPSHOT PER DRAW, NOT A METHOD PER QUESTION.** A view works out its marks once for a frame — the TM rule
+ * table's `highlight` finds the current state's row and the next rule's together — and both the row following
+ * centres and each drawn row's classes read them. Asked through separate callbacks, the view would compute them
+ * once per question or cache them itself between calls it cannot see the order of.
+ */
+export type GridRows = {
+  /**
+   * The rows there are, or `null` for no content at all — which clears the grid and drops `aria-rowcount`, where
+   * `0` would announce an empty grid that is there.
+   */
+  readonly count: number | null
+  /** The row following keeps centred, or `null` for none this draw. */
+  readonly follow: number | null
+  /**
+   * Fill row `i`: `row` is its `role="row"` element and `cell` its one `role="gridcell"`, both already carrying
+   * their roles, `aria-rowindex` and the cell's id. The view adds its classes, marks and text; the grid adds
+   * `is-active` afterwards.
+   */
+  fill(i: number, row: HTMLElement, cell: HTMLElement): void
+}
+
+/** How a grid is named and styled, and what it asks of the view that owns it. */
+export type GridOptions = {
+  /** The class names of the scroll box, the spacer inside it, the rows' container and each row. */
+  readonly classes: { readonly box: string; readonly spacer: string; readonly rows: string; readonly row: string }
+  /** The prefix of each cell's id, unique to this grid: the id `aria-activedescendant` names is `${idPrefix}-${i}`. */
+  readonly idPrefix: string
+  /** Whether the panel holding the grid is open. A closed grid draws nothing that reads the layout, and takes no scroll as a user's. */
+  readonly isOpen: () => boolean
+  /** The rows to draw, asked once at every draw. */
+  readonly rows: () => GridRows
+  /** A click on row `i`, or Enter on it as the active row. */
+  readonly activate: (i: number) => void
+  /**
+   * Called first in every draw — a frame's, a scroll's, a resize's, a key's — which is where a view keeps anything
+   * that must follow the grid's `following` in sync, such as a re-attach button's `hidden`.
+   */
+  readonly beforeDraw?: () => void
+}
+
+/**
+ * A virtualized grid of fixed-height rows with one roving active row: the TM view's rule table, and the asm
+ * view's listing (Plan 7 part 5 spec, amendment 7).
+ *
+ * **ONE COPY OF THE PART THAT KEPT BREAKING.** The drawn window, the active row, the keys, a click that survives
+ * the redraw focusing causes, and following with its clamp handling were written out in the rule table, then again
+ * in the state diagram and the λ view's body; each fix to one — a lost click, a clamp read as a user's scroll —
+ * had to be found again in the others. This class is the rule table's copy, moved here unchanged in behaviour, so
+ * the asm listing is its second user rather than a fourth copy. The state diagram and the λ body move onto it in a
+ * change of their own.
+ *
+ * **ONE TAB STOP.** The box is the `role="grid"` element and takes the focus; each row has one `gridcell`, and the
+ * active row is named by `aria-activedescendant`, so a table of 127,881 rows (`list60`'s δ-table) is not 127,881
+ * tab stops. Only the rows in view are in the DOM.
+ *
+ * **WHAT THE VIEW STILL OWNS**: what a row says and what it marks (`GridRows.fill`), what a row does
+ * (`GridOptions.activate`), the panel the box sits in, and when to draw for a new frame or link. The grid draws on
+ * its own for a scroll, a resize, a key and a click.
+ */
+export class VirtualGrid {
+  /** The scroll box: the `role="grid"` element, and the panel body a view hands to `createPanel`. */
+  readonly el: HTMLElement
+  #spacer: HTMLElement
+  #rowsEl: HTMLElement
+  #opts: GridOptions
+  #follow = new Follow()
+  /**
+   * The active row (Plan 7 part 4 spec §9.2), **AN INDEX INTO THE WHOLE GRID, NOT INTO THE DRAWN WINDOW** —
+   * accessibility item 3, which found a cursor designed against the rendered rows unable to move past them. The
+   * keys move it by index and scroll so it is drawn; a scroll the user or following makes carries it along
+   * instead, so `aria-activedescendant` always names a row that is in the DOM (`draw`), as the λ view's does.
+   */
+  #active = 0
+  /**
+   * A one-shot scroll target `draw` honours in preference to `Follow`'s own, for exactly the next draw — see
+   * `scrollToRow`. `null` when there is nothing pending.
+   */
+  #pendingScroll: number | null = null
+  /** The box's height at the last draw — how its `scroll` handler tells a clamp from a user's scroll. */
+  #drawnHeight = 0
+
+  constructor(opts: GridOptions) {
+    this.#opts = opts
+    this.#rowsEl = document.createElement('div')
+    this.#rowsEl.className = opts.classes.rows
+    this.#spacer = document.createElement('div')
+    this.#spacer.className = opts.classes.spacer
+    this.#spacer.append(this.#rowsEl)
+    this.el = document.createElement('div')
+    this.el.className = opts.classes.box
+    this.el.append(this.#spacer)
+    // THE BOX IS THE GRID (spec §9.2, accessibility item 3). A `createPanel` given this box as its body makes it a
+    // labelled region; setting the role afterwards keeps the panel toggle's label and makes it the grid instead.
+    // The two wrappers between it and the rows are layout, so they say so to the accessibility tree.
+    this.el.setAttribute('role', 'grid')
+    this.el.tabIndex = 0
+    this.#spacer.setAttribute('role', 'none')
+    this.#rowsEl.setAttribute('role', 'rowgroup')
+
+    this.el.addEventListener('scroll', () => {
+      // A SCROLL EVENT ON A HIDDEN BOX IS NEVER USER INTENT, and reading it as such detached a following table with
+      // no user gesture at all. `draw` writes `scrollTop`, and the browser delivers that write's event at the NEXT
+      // rendering update rather than synchronously — so hiding the box in between lands the echo on a
+      // `display: none` box, where `scrollTop` reads back 0, which is further from the expected position than any
+      // tolerance. Reproduced 5/5 in Chromium on the rule table: step, close the rules panel, reopen it, and the
+      // table was detached with the current row gone from the DOM. A hidden box cannot be scrolled by a person, so
+      // there is nothing here to honour.
+      if (!this.#opts.isOpen()) return
+      // A BOX THAT CHANGED HEIGHT SINCE IT WAS DRAWN MAY HAVE HAD ITS SCROLL CLAMPED (Plan 7 part 4 spec §9.1 made
+      // its height the view's), and this event can come before the resize observer's: a panel beside it that closed
+      // read the layout at once, in its own toggle.
+      if (this.el.clientHeight !== this.#drawnHeight) this.#follow.onResize(this.el.scrollTop)
+      this.#follow.onScroll(this.el.scrollTop)
+      this.draw()
+    })
+
+    // A ROW TAKES NO FOCUS ON `mousedown`; THE GRID TAKES IT WHEN THE CLICK LANDS (Plan 7 part 4 spec, amendment
+    // 18). Focusing the grid draws its view, and the draw replaces every row: taken on `mousedown`, as the browser
+    // would, it removed the row under the pointer before `mouseup`, and the browser fired no `click` at all — every
+    // first click on the rule table from anywhere else was lost. The primary button only, so a middle button still
+    // scrolls.
+    this.#rowsEl.addEventListener('mousedown', (event) => {
+      if (event.button === 0) event.preventDefault()
+    })
+    // DELEGATED FROM THE CONTAINER RATHER THAN BOUND PER ROW, because rows are recreated on every draw. The row
+    // clicked becomes the active row, painted before the view's own `activate` so a view whose action draws
+    // nothing — a pane with no link handler — shows it too.
+    this.#rowsEl.addEventListener('click', (event) => {
+      const target = event.target
+      const el = target instanceof HTMLElement ? target.closest(`.${this.#opts.classes.row}`) : null
+      // READ BEFORE THE FOCUS BELOW, whose draw replaces the rows. `aria-rowindex` is 1-based and counted over the
+      // whole grid, so it is the row's own index whatever window it was drawn in.
+      const at = el instanceof HTMLElement ? Number(el.getAttribute('aria-rowindex')) - 1 : -1
+      this.el.focus({ preventScroll: true })
+      const count = this.#opts.rows().count
+      if (count === null || !(at >= 0 && at < count)) return
+      this.#active = at
+      this.draw()
+      this.#opts.activate(at)
+    })
+
+    this.el.addEventListener('keydown', (e) => this.#key(e))
+    // THE BOX'S HEIGHT IS ITS VIEW'S, NOT THE VIEWPORT'S (Plan 7 part 4 spec §9.1): a divider drag, a panel opening
+    // beside it or a window resize changes it with no frame or scroll to redraw the window it draws.
+    new ResizeObserver(() => {
+      this.#follow.onResize(this.el.scrollTop)
+      this.draw()
+    }).observe(this.el)
+  }
+
+  /** Whether the grid keeps the view's `follow` row in view; a user's scroll, or a key that scrolls, stops it. */
+  get following(): boolean {
+    return this.#follow.following
+  }
+
+  /** Follow again, and scroll there now rather than at the next frame. */
+  attach(): void {
+    this.#follow.attach()
+    this.draw()
+  }
+
+  /**
+   * New content: the first row active, following on, and the box back at the top. **DOES NOT DRAW** — the view
+   * draws once it has put its own state for the new content in place.
+   *
+   * `onProgrammaticScroll` BEFORE THE WRITE, NOT AFTER, AND NOT OMITTED. Setting `scrollTop` fires a `scroll` event;
+   * without a pending expectation `Follow` reads it as the user taking control and detaches on the spot — so the grid
+   * would never follow after new content. Intermittent, too: no event fires when `scrollTop` was already 0, so it
+   * would work on the first program and fail on every one after a scroll.
+   */
+  reset(): void {
+    this.#active = 0
+    this.#follow.attach()
+    this.#follow.onProgrammaticScroll(0)
+    this.el.scrollTop = 0
+  }
+
+  /**
+   * Centre `row` at the next draw — a link's scroll — **FOR EXACTLY ONE DRAW, AND WITHOUT TOUCHING `Follow`'S OWN
+   * FLAG** (Plan 5 design §5.1). Following is about where the run is and a link is about a construct: telling
+   * `Follow` would make a link silently re-attach a grid the user had detached, or detach one they had not. But
+   * `draw` recomputes following's target whenever it follows, so writing `scrollTop` here would be reverted by the
+   * very next draw; a pending target that `draw` prefers once is what lets the link win that draw. Nothing is
+   * recorded while the grid is closed, where its height is 0 and any target would be wrong. **DOES NOT DRAW.**
+   */
+  scrollToRow(row: number): void {
+    const count = this.#opts.rows().count
+    if (count === null || !this.#opts.isOpen()) return
+    // Shared with `Follow.targetScrollTop` via `centredScrollTop` — see that function's doc.
+    this.#pendingScroll = centredScrollTop(row, ROW_HEIGHT, this.el.clientHeight, count * ROW_HEIGHT)
+  }
+
+  /**
+   * Draw only the rows in view. Called on every frame AND on every scroll, so it must stay O(visible) rather than
+   * O(rows) — 127,881 rows is the number that decides it.
+   */
+  draw(): void {
+    this.#opts.beforeDraw?.()
+    const rows = this.#opts.rows()
+    const count = rows.count
+
+    if (count === null) {
+      this.#rowsEl.replaceChildren()
+      this.#spacer.style.height = '0px'
+      this.el.removeAttribute('aria-rowcount')
+      this.el.removeAttribute('aria-activedescendant')
+      return
+    }
+    this.el.setAttribute('aria-rowcount', String(count))
+
+    // THE SPACER CARRIES THE SCROLL RANGE, AND IT MUST STAY HONEST WHILE THE GRID IS CLOSED. Setting `scrollTop`
+    // CLAMPS to the element's current scroll height, so a spacer left at the previous content's size silently
+    // truncates the next write — including the one the reopen below performs. Hence both orderings here are
+    // load-bearing: before the early return, and before the `scrollTop` write further down. `visibleWindow`'s
+    // `totalHeight` is this same product, so it is not written twice.
+    this.#spacer.style.height = `${count * ROW_HEIGHT}px`
+
+    // NOTHING BELOW THIS LINE MAY RUN AGAINST A CLOSED GRID, because everything below reads `clientHeight`, and a
+    // non-rendered box reports 0. `targetScrollTop` against a zero viewport returns the UNCENTRED position —
+    // `floor(viewportHeight / 2)` too low — and `onProgrammaticScroll` then records that as the echo to expect. The
+    // `scrollTop` write is a harmless no-op; the poisoned expectation is not, because the reopen draw finds the
+    // correct target already equal to the restored `scrollTop` and skips the write that would have corrected it. A
+    // later real scroll landing within the tolerance of the stale value is absorbed as an echo and does not detach.
+    // The rows drawn here would be wrong too — a zero viewport spans nine rows starting at 0 — and are all
+    // discarded on reopen, so this returns before the work as well as before the harm.
+    if (!this.#opts.isOpen()) return
+
+    // THE VIEW'S FLEX LAYOUT IS THE ONLY THING BOUNDING THIS BOX (`style.css`'s panel rules for the view, Plan 7
+    // part 4 spec §9.1), and `clientHeight` reports what it actually laid out rather than what the stylesheet asked
+    // for. If those rules never reach the page the box grows to its full content height — measured at 271,968px
+    // for 11,332 rows — the window covers every row, and every draw renders every row. The browser tier loads
+    // `style.css` (`tests/browser/setup.ts`) and asserts the rule table stays bounded, so that gap fails a test
+    // rather than silently costing O(rows) per frame.
+    const viewportHeight = this.el.clientHeight
+    this.#drawnHeight = viewportHeight
+    // A PENDING LINK SCROLL WINS OVER THE FOLLOW TARGET FOR EXACTLY THIS DRAW, then is consumed — Plan 5 design
+    // §5.1. Read and cleared together so a link recorded during THIS call is what the very next draw honours, never
+    // twice: `Follow`'s expectation is armed ONCE below, by whichever branch runs, rather than by the pending write
+    // and then again by a follow write that would silently revert it in the same synchronous block.
+    const pending = this.#pendingScroll
+    this.#pendingScroll = null
+    if (pending !== null) {
+      if (pending !== this.el.scrollTop) {
+        this.#follow.onProgrammaticScroll(pending)
+        this.el.scrollTop = pending
+      }
+    } else if (rows.follow !== null) {
+      const top = this.#follow.targetScrollTop(rows.follow, ROW_HEIGHT, viewportHeight, count * ROW_HEIGHT)
+      if (top !== null && top !== this.el.scrollTop) {
+        this.#follow.onProgrammaticScroll(top)
+        this.el.scrollTop = top
+      }
+    }
+
+    const w = visibleWindow(count, ROW_HEIGHT, viewportHeight, this.el.scrollTop, OVERSCAN)
+    // THE ACTIVE ROW COMES WITH THE VIEW: kept to the whole rows on screen, not the overscan, so whatever moved the
+    // view — following, a link, the user — leaves `aria-activedescendant` naming a drawn row.
+    if (viewportHeight > 0) {
+      const top = Math.ceil(this.el.scrollTop / ROW_HEIGHT)
+      const bottom = Math.max(top, Math.floor((this.el.scrollTop + viewportHeight) / ROW_HEIGHT) - 1)
+      this.#active = Math.min(Math.max(this.#active, top), bottom, count - 1)
+    }
+    this.#rowsEl.style.transform = `translateY(${w.offsetY}px)`
+
+    const els: HTMLElement[] = []
+    for (let i = w.firstIndex; i <= w.lastIndex; i += 1) {
+      const el = document.createElement('div')
+      el.className = this.#opts.classes.row
+      el.setAttribute('role', 'row')
+      // 1-BASED, as `aria-rowindex` is, and counted over the whole grid: a screen reader says "row 40,213 of
+      // 127,881" for a row that is one of forty in the DOM.
+      el.setAttribute('aria-rowindex', String(i + 1))
+      const cell = document.createElement('div')
+      cell.setAttribute('role', 'gridcell')
+      cell.id = `${this.#opts.idPrefix}-${i}`
+      el.append(cell)
+      rows.fill(i, el, cell)
+      if (i === this.#active) el.classList.add('is-active')
+      els.push(el)
+    }
+    this.#rowsEl.replaceChildren(...els)
+    if (this.#active >= w.firstIndex && this.#active <= w.lastIndex) {
+      this.el.setAttribute('aria-activedescendant', `${this.#opts.idPrefix}-${this.#active}`)
+    } else {
+      this.el.removeAttribute('aria-activedescendant')
+    }
+  }
+
+  /**
+   * The grid's keys (Plan 7 part 4 spec §9.2): ↑/↓, PgUp/PgDn and Home/End move the active row BY INDEX, and the box
+   * scrolls so it is drawn; Enter does what a click does.
+   *
+   * **A KEY THAT SCROLLS IS THE USER TAKING CONTROL**, so following is detached before the draw below — its `scroll`
+   * event comes a frame later, and a draw still following would put the view back on the followed row and carry the
+   * active row with it. The λ view's keys do the same (`lambda-body.ts`).
+   */
+  #key(e: KeyboardEvent): void {
+    const count = this.#opts.rows().count
+    if (count === null || count === 0) return
+    const page = Math.max(1, Math.floor(this.el.clientHeight / ROW_HEIGHT) - 1)
+    let next = this.#active
+    switch (e.key) {
+      case 'ArrowDown':
+        next += 1
+        break
+      case 'ArrowUp':
+        next -= 1
+        break
+      case 'PageDown':
+        next += page
+        break
+      case 'PageUp':
+        next -= page
+        break
+      case 'Home':
+        next = 0
+        break
+      case 'End':
+        next = count - 1
+        break
+      case 'Enter':
+        e.preventDefault()
+        this.#opts.activate(this.#active)
+        return
+      default:
+        return
+    }
+    e.preventDefault()
+    this.#active = Math.min(Math.max(next, 0), count - 1)
+    const top = this.#active * ROW_HEIGHT
+    const from = this.el.scrollTop
+    const to = top < from ? top : Math.max(from, top + ROW_HEIGHT - this.el.clientHeight)
+    if (to !== from) {
+      this.#follow.detach()
+      this.el.scrollTop = to
+    }
+    this.draw()
+  }
+}
````


- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts`

Expected: exit 0, printing:

```text
    Test Files  2 passed (2)
    Tests  24 passed (24)
```

Run: `cd web && pnpm exec vitest run --project browser tests/browser/tm-grid.test.ts tests/browser/tm-pointer.test.ts tests/browser/tm-follow-clamp.test.ts tests/browser/app.test.ts tests/browser/marks.test.ts tests/browser/running-focus.test.ts tests/browser/hidden.test.ts tests/browser/state-diagram.test.ts`

Expected: exit 0, printing:

```text
    Test Files  8 passed (8)
    Tests  87 passed (87)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, from `web/`, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 13 of 13 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| S1 | draws every row — `virtual-grid.ts`: `const w = visibleWindow(count, ROW_HEIGHT, viewportHeight, this.el.scrollTop, OVERSCAN)` → `const w = visibleWindow(count, ROW_HEIGHT, count * ROW_HEIGHT, this.el.scrollTop, OVERSCAN)` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > draws only the rows in view, counts all of them, and names its active row` |
| S2 | no content keeps its row count — `virtual-grid.ts`: `this.#spacer.style.height = '0px' ⏎       this.el.removeAttribute('aria-rowcount')` → `this.#spacer.style.height = '0px'` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > clears itself for no content at all` |
| S3 | a page is one row — `virtual-grid.ts`: `case 'PageDown': ⏎         next += page` → `case 'PageDown': ⏎         next += 1` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > moves the active row by index with the keys, past the drawn window, and scrolls so it is drawn` |
| S4 | Enter activates the next row — `virtual-grid.ts`: `this.#opts.activate(this.#active) ⏎         return` → `this.#opts.activate(this.#active + 1) ⏎         return` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > activates the active row on Enter` |
| S5 | a row takes the focus on mousedown — `virtual-grid.ts`: `if (event.button === 0) event.preventDefault()` → `if (event.button === 0) void event` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > activates the row a real click lands on, once, from the focus elsewhere, and keeps the focus` |
| S6 | attach does not draw — `virtual-grid.ts`: `this.#follow.attach() ⏎     this.draw() ⏎   }` → `this.#follow.attach() ⏎   }` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > centres the row it follows, stops at a scroll of the user’s, and follows again on attach` |
| S7 | a key that scrolls keeps following — `virtual-grid.ts`: `if (to !== from) { ⏎       this.#follow.detach()` → `if (to !== from) {` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > stops following on a key that scrolls, before the draw that key causes` |
| S8 | a link's scroll is never consumed — `virtual-grid.ts`: `const pending = this.#pendingScroll ⏎     this.#pendingScroll = null` → `const pending = this.#pendingScroll` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > lets a link's row win over following for exactly one draw, still following` |
| S9 | reset writes its scroll unrecorded — `virtual-grid.ts`: `this.#follow.attach() ⏎     this.#follow.onProgrammaticScroll(0) ⏎     this.el.scrollTop = 0` → `this.#follow.attach() ⏎     this.el.scrollTop = 0` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > goes back to the top, following, with the first row active, on reset` |
| S10 | a closed grid reads a scroll as the user's — `virtual-grid.ts`: `if (!this.#opts.isOpen()) return ⏎       // A BOX THAT CHANGED HEIGHT` → `// A BOX THAT CHANGED HEIGHT` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > reads no scroll as the user’s while its panel is closed` |
| S11 | a resize does not record the clamp — `virtual-grid.ts`: `new ResizeObserver(() => { ⏎       this.#follow.onResize(this.el.scrollTop) ⏎       this.draw()` → `new ResizeObserver(() => { ⏎       this.draw()` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > keeps following when it grows and its scroll is clamped` |
| S12 | a panel overrides a declared role — `panel.ts`: `if (!body.hasAttribute('role')) body.setAttribute('role', 'region')` → `body.setAttribute('role', 'region')` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/panel.test.ts > createPanel > keeps a role the body already declares, and names it by its button all the same` |
| S13 | a click activates the row above — `virtual-grid.ts`: `const at = el instanceof HTMLElement ? Number(el.getAttribute('aria-rowindex')) - 1 : -1` → `const at = el instanceof HTMLElement ? Number(el.getAttribute('aria-rowindex')) - 2 : -1` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/panel.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > activates the row a real click lands on, once, from the focus elsewhere, and keeps the focus` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
The TM rule table's grid is a module of its own, which the asm listing will share

The virtualized roving row — the drawn window, the active row, the keys,
a click that survives the redraw focusing causes, and following with its
clamp handling — lived inside `TmPane`, and the state diagram and the λ
body each carry a copy. `VirtualGrid` is the rule table's copy, moved
unchanged in behaviour, so the asm view's listing becomes its second
user instead of a fourth copy (spec amendment 7). A panel now keeps a
role its body already declares, so the grid stays a grid inside the
rules panel.
````


---

### Task 3: A link's scroll holds a following grid until the run moves

**Files:**
- Modify: `web/src/virtual-grid.ts`; comments in `web/src/tm-pane.ts`, `web/src/link-wiring.ts`, `web/src/draw.ts`
- Modify (tests): `web/tests/browser/virtual-grid.test.ts`, `web/tests/browser/app.test.ts`

**Interfaces:**
- `VirtualGrid.scrollToRow(row)` keeps its signature. Its scroll now holds the box while the view's follow row (`GridRows.follow`) is the one it was written against, and `attach()` and `reset()` release it. Every later task that calls it — the asm view's `setLink` — gets the hold.

**A BUG ON `main`, FOUND DRAWING THE ASM VIEW (amendment 21).** A link scrolled a following grid for one frame. `scrollToRow` let the link win the draw that wrote its scroll; the write's own `scroll` event redrew the box a frame later, and that draw, still following, scrolled straight back to the run's row. On `main`, a construct linked from the source moved the rule table to its block and back again within two milliseconds, whenever the table was following — the default on every compile. The asm listing shares the grid, so a pin would never have scrolled a following listing either, and spec §6.6 says it does.

**THE GUARD WAS GREEN AND BLIND.** `app.test.ts`'s "a source-originated link scrolls the table into view even while it is still following the machine" was written for this class of bug, and read the table in the link's own turn, before the event that reverts it; it passed on `main`. It now awaits that event, and so does the grid's own test, whose last assertion had written the bug down as the contract ("wins over following for exactly one draw").

**THE HOLD, NOT A SECOND ONE-SHOT.** The scroll holds while the follow row is the one it was written against: through its own event, a redraw of the same frame, a resize. Following takes over when that row moves — the next step, in playback every frame — on `attach` (the follow button, after a scroll of the user's), or on `reset` (a new program). Following's own flag is untouched, as before (Plan 5 design §5.1), and `app.test.ts` still asserts it. The state diagram has no link scroll. The λ body met the same trap with its pin's scroll and answered it the other way, by detaching following (`LambdaBody.reveal`); the PR that moves it onto the grid has to choose between the two.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=3
diff --git a/web/tests/browser/app.test.ts b/web/tests/browser/app.test.ts
index 2c72c53..3cf35d6 100644
--- a/web/tests/browser/app.test.ts
+++ b/web/tests/browser/app.test.ts
@@ -916,8 +916,13 @@ describe('the app, end to end', () => {
       // verified directly against the running app by scanning every source offset. Position `+1` lands
       // on `(`, a byte no narrower child span (`f` alone, or `head(xs)`) covers, so it resolves to the
       // call expression itself rather than the bare callee `Var`.
+      // THE SCROLL'S OWN EVENT IS AWAITED BEFORE ANYTHING IS READ. It comes a frame after the link and redraws the
+      // table, and while this read the table in the link's own turn it passed with that redraw scrolling straight
+      // back to the machine: the link's rows were never on screen for longer than the turn that drew them.
+      const echo = new Promise<void>((r) => table().addEventListener('scroll', () => r(), { once: true }))
       linkAt(view, BIG.indexOf('f(head(xs))') + 1)
       await until(() => linkedRowCount() > 0)
+      await echo
 
       // THE BUG, DIRECTLY: a linked block must actually be ON SCREEN, which virtualization only renders
       // once the table has actually scrolled there. Under the reverted-scroll bug `scrollTop` never
@@ -926,8 +931,8 @@ describe('the app, end to end', () => {
       expect(table().scrollTop).not.toBe(followedTop)
 
       // FOLLOWING ITSELF WAS NOT DISTURBED — the other half of design §5.1 and `setLink`'s own doc: a
-      // link is a one-shot scroll, not a reattach/detach decision, so `Follow`'s own flag must read
-      // exactly as it did before the link ran.
+      // link's scroll holds until the machine moves and is not a reattach/detach decision, so `Follow`'s own
+      // flag must read exactly as it did before the link ran.
       expect(reattach.hidden).toBe(true)
 
       // Leave the buffer settled, in case a test added after this one assumes it is.
diff --git a/web/tests/browser/virtual-grid.test.ts b/web/tests/browser/virtual-grid.test.ts
index f900219..64b44f3 100644
--- a/web/tests/browser/virtual-grid.test.ts
+++ b/web/tests/browser/virtual-grid.test.ts
@@ -158,7 +158,12 @@ describe('a virtual grid', () => {
     expect(made.grid.el.scrollTop).toBe(0)
   })
 
-  it("lets a link's row win over following for exactly one draw, still following", async () => {
+  /**
+   * THE LINK'S ROW STAYS UNTIL THE RUN MOVES. The scroll's own event redraws the box, and a link that won only the
+   * draw that wrote it lost that redraw to following, a frame later: a link made while the grid followed never showed
+   * its rows. The event is awaited, so the assertions after it see what that redraw did.
+   */
+  it("holds a link's row over following through the scroll's own event, until the row it follows moves", async () => {
     const made = make(1000)
     made.set({ follow: 500 })
     made.grid.draw()
@@ -166,14 +171,39 @@ describe('a virtual grid', () => {
     const echo = scrolled(made.grid.el)
     made.grid.draw()
     expect(made.grid.el.scrollTop).toBe(centred(10, 240, 1000))
-    expect(made.grid.following).toBe(true)
     await echo
-    // The scroll's own echo did not detach following, and the next draw is following's again.
-    expect(made.grid.following).toBe(true)
+    expect(made.grid.el.scrollTop, "the scroll's own redraw keeps the link's row").toBe(centred(10, 240, 1000))
+    expect(made.grid.following, 'and following is still on').toBe(true)
+    made.grid.draw()
+    expect(made.grid.el.scrollTop, 'as does any redraw of the same frame').toBe(centred(10, 240, 1000))
+    made.set({ follow: 501 })
+    made.grid.draw()
+    expect(made.grid.el.scrollTop, 'the run moving brings following back').toBe(centred(501, 240, 1000))
+  })
+
+  it('follows the new content after reset, though a link held the box against the same follow row', () => {
+    const made = make(1000)
+    made.set({ follow: 500 })
+    made.grid.draw()
+    made.grid.scrollToRow(10)
+    made.grid.draw()
+    made.grid.reset()
     made.grid.draw()
     expect(made.grid.el.scrollTop).toBe(centred(500, 240, 1000))
   })
 
+  it('follows again on attach after a link, though the row it follows has not moved', async () => {
+    const made = make(1000)
+    made.set({ follow: 500 })
+    made.grid.draw()
+    made.grid.scrollToRow(10)
+    made.grid.draw()
+    made.grid.el.scrollTop = 0
+    await until(() => !made.grid.following, 'a user scroll to detach following')
+    made.grid.attach()
+    expect(made.grid.el.scrollTop).toBe(centred(500, 240, 1000))
+  })
+
   it('goes back to the top, following, with the first row active, on reset', async () => {
     const made = make(1000)
     made.grid.el.focus()
````


- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/app.test.ts`

Expected: exit 1, printing:

```text
    × holds a link's row over following through the scroll's own event, until the row it follows moves
    × a source-originated link scrolls the table into view even while it is still following the machine
    Test Files  2 failed (2)
    Tests  2 failed | 55 passed (57)
    FAIL  |browser (chromium)| tests/browser/app.test.ts > the app, end to end > stepping > a source-originated link scrolls the table into view even while it is still following the machine
    FAIL  |browser (chromium)| tests/browser/virtual-grid.test.ts > a virtual grid > holds a link's row over following through the scroll's own event, until the row it follows moves
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=3
diff --git a/web/src/draw.ts b/web/src/draw.ts
index 38dbb24..94486dc 100644
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -206,12 +206,9 @@ export function createDraw(deps: {
         // current against; a pane shown frames later still gets the right answer.
         //
         // `false` FOR `scrollTo`, NOT `origin !== 'tm'` AS THE FAN-OUT PASSES: there is no `origin` here,
-        // this is a seed rather than a gesture, and a scroll asked for here would not last — `setLink`'s
-        // one-shot target (`VirtualGrid.scrollToRow`) is consumed by its own `#drawTable` call, and `p.slot.render`
-        // below, in this same iteration, calls `#drawTable` again and re-targets the follow point `seedTm`'s
-        // `setProgram` just re-attached (`VirtualGrid.reset`), overwriting it. A seeded view opens on its
-        // follow target, as it did before this pane was ever skipped a compile — the pin still paints, just
-        // without staking a scroll claim over it.
+        // this is a seed rather than a gesture. A seeded view opens on its follow target, as it did before
+        // this pane was ever skipped a compile — the pin still paints, just without staking a scroll claim
+        // over it.
         const pin =
           linkWiring.linkable && linkWiring.link !== null && linkWiring.index !== null
             ? linkWiring.index.linkFor(linkWiring.link.node).states
diff --git a/web/src/link-wiring.ts b/web/src/link-wiring.ts
index 141d36e..7a10d4c 100644
--- a/web/src/link-wiring.ts
+++ b/web/src/link-wiring.ts
@@ -218,16 +218,10 @@ export function createLinkWiring(deps: {
     // set above, so this single call sees the new value; a separate `drawLink()` call here would be
     // the same read twice.
     //
-    // CALLED BEFORE THE TM FAN-OUT'S `setLink`, NOT AFTER — ORDER IS LOAD-BEARING. `draw()` calls
-    // `PaneSlot.render(...)` on every tm-kind pane, which runs `TmPane`'s `#drawTable`
-    // UNCONDITIONALLY on every call, following included. `TmPane.setLink`'s own scroll is a one-shot
-    // target `#drawTable` honours for exactly its next call (design §5.1) — so if `draw()` ran AFTER
-    // the fan-out below, its `#drawTable` pass would be the SECOND call since the target was armed,
-    // see nothing pending (already consumed), fall back to the follow target, and silently revert the
-    // link's scroll in the same synchronous turn the link itself ran in. Calling `draw()` first burns
-    // its `#drawTable` pass on the (soon-stale) previous link state — thrown away before the browser
-    // ever paints it — so the fan-out below is the LAST word and its one-shot target is still armed
-    // when it runs.
+    // CALLED BEFORE THE TM FAN-OUT'S `setLink`. `draw()` calls `PaneSlot.render(...)` on every tm-kind
+    // pane, which runs `TmPane`'s `#drawTable` on every call; the fan-out below then draws each table once
+    // more with the link's scroll pending, and that scroll holds against every later draw of the same
+    // frame (`VirtualGrid.scrollToRow`, design §5.1).
     const before = linkStatusHost.textContent ?? ''
     draw()
     // ANNOUNCED HERE AND NOWHERE ELSE (spec §11): `setLinkTo` is the link gesture — a source click or
diff --git a/web/src/tm-pane.ts b/web/src/tm-pane.ts
index 1047d2e..e75b422 100644
--- a/web/src/tm-pane.ts
+++ b/web/src/tm-pane.ts
@@ -480,10 +480,10 @@ export class TmPane implements EditablePane {
    * this does not have to guess.
    *
    * THE SCROLL DOES NOT TOUCH FOLLOWING. Following is about the machine's current state, and a link is
-   * about a construct; `VirtualGrid.scrollToRow` records the link's row as a one-shot target the next draw
-   * honours over the follow target — design §5.1 — and its doc says why writing `scrollTop` here instead
-   * was reverted in the same synchronous block the instant following was on, which is the default state on
-   * every fresh compile.
+   * about a construct; `VirtualGrid.scrollToRow` records the link's row as a target the next draw writes
+   * over the follow target and holds until the machine moves — design §5.1 — and its doc says why writing
+   * `scrollTop` here instead was reverted the instant following was on, which is the default state on every
+   * fresh compile.
    */
   setLink(states: number[], scrollTo: boolean): void {
     this.#linked = this.#index === null ? new Set() : linkedRows(this.#index, states)
diff --git a/web/src/virtual-grid.ts b/web/src/virtual-grid.ts
index fb60e89..5d6c2e2 100644
--- a/web/src/virtual-grid.ts
+++ b/web/src/virtual-grid.ts
@@ -81,10 +81,15 @@ export class VirtualGrid {
    */
   #active = 0
   /**
-   * A one-shot scroll target `draw` honours in preference to `Follow`'s own, for exactly the next draw — see
-   * `scrollToRow`. `null` when there is nothing pending.
+   * A link's scroll target, which the next draw writes in preference to `Follow`'s own — see `scrollToRow`. `null`
+   * when there is nothing pending.
    */
   #pendingScroll: number | null = null
+  /**
+   * The view's follow row when a link's scroll was written, while that scroll holds the box — see `scrollToRow`.
+   * `null` when no link holds it; `{ follow: null }` is a hold for a view with nothing to follow.
+   */
+  #hold: { follow: number | null } | null = null
   /** The box's height at the last draw — how its `scroll` handler tells a clamp from a user's scroll. */
   #drawnHeight = 0
 
@@ -162,9 +167,10 @@ export class VirtualGrid {
     return this.#follow.following
   }
 
-  /** Follow again, and scroll there now rather than at the next frame. */
+  /** Follow again, and scroll there now rather than at the next frame: a link's scroll no longer holds the box. */
   attach(): void {
     this.#follow.attach()
+    this.#hold = null
     this.draw()
   }
 
@@ -179,18 +185,25 @@ export class VirtualGrid {
    */
   reset(): void {
     this.#active = 0
+    this.#hold = null
     this.#follow.attach()
     this.#follow.onProgrammaticScroll(0)
     this.el.scrollTop = 0
   }
 
   /**
-   * Centre `row` at the next draw — a link's scroll — **FOR EXACTLY ONE DRAW, AND WITHOUT TOUCHING `Follow`'S OWN
-   * FLAG** (Plan 5 design §5.1). Following is about where the run is and a link is about a construct: telling
-   * `Follow` would make a link silently re-attach a grid the user had detached, or detach one they had not. But
-   * `draw` recomputes following's target whenever it follows, so writing `scrollTop` here would be reverted by the
-   * very next draw; a pending target that `draw` prefers once is what lets the link win that draw. Nothing is
-   * recorded while the grid is closed, where its height is 0 and any target would be wrong. **DOES NOT DRAW.**
+   * Centre `row` at the next draw — a link's scroll — **AND HOLD IT THERE UNTIL THE RUN MOVES, WITHOUT TOUCHING
+   * `Follow`'S OWN FLAG** (Plan 5 design §5.1). Following is about where the run is and a link is about a construct:
+   * telling `Follow` would make a link silently re-attach a grid the user had detached, or detach one they had not.
+   * But `draw` recomputes following's target whenever it follows, so writing `scrollTop` here would be reverted by
+   * the very next draw; a pending target that `draw` prefers is what lets the link win.
+   *
+   * **WINNING ONE DRAW WAS NOT ENOUGH.** The write's own `scroll` event redraws the box a frame later, and that draw,
+   * still following, scrolled straight back to the run's row: a link made while the grid followed showed its rows
+   * for one frame. So the scroll holds while the view's follow row is the one it was written against — through its
+   * own event, a redraw of the same frame, a resize — and following takes over when that row moves, on `attach`, or
+   * on `reset`. Nothing is recorded while the grid is closed, where its height is 0 and any target would be wrong.
+   * **DOES NOT DRAW.**
    */
   scrollToRow(row: number): void {
     const count = this.#opts.rows().count
@@ -242,22 +255,26 @@ export class VirtualGrid {
     // rather than silently costing O(rows) per frame.
     const viewportHeight = this.el.clientHeight
     this.#drawnHeight = viewportHeight
-    // A PENDING LINK SCROLL WINS OVER THE FOLLOW TARGET FOR EXACTLY THIS DRAW, then is consumed — Plan 5 design
-    // §5.1. Read and cleared together so a link recorded during THIS call is what the very next draw honours, never
-    // twice: `Follow`'s expectation is armed ONCE below, by whichever branch runs, rather than by the pending write
-    // and then again by a follow write that would silently revert it in the same synchronous block.
+    // A PENDING LINK SCROLL WINS OVER THE FOLLOW TARGET, is consumed, and then holds the box until the follow row
+    // moves — `scrollToRow`. Read and cleared together so a link recorded during THIS call is what the very next
+    // draw writes, never twice: `Follow`'s expectation is armed ONCE below, by whichever branch runs, rather than by
+    // the pending write and then again by a follow write that would silently revert it in the same synchronous block.
     const pending = this.#pendingScroll
     this.#pendingScroll = null
     if (pending !== null) {
+      this.#hold = { follow: rows.follow }
       if (pending !== this.el.scrollTop) {
         this.#follow.onProgrammaticScroll(pending)
         this.el.scrollTop = pending
       }
-    } else if (rows.follow !== null) {
-      const top = this.#follow.targetScrollTop(rows.follow, ROW_HEIGHT, viewportHeight, count * ROW_HEIGHT)
-      if (top !== null && top !== this.el.scrollTop) {
-        this.#follow.onProgrammaticScroll(top)
-        this.el.scrollTop = top
+    } else if (this.#hold === null || this.#hold.follow !== rows.follow) {
+      this.#hold = null
+      if (rows.follow !== null) {
+        const top = this.#follow.targetScrollTop(rows.follow, ROW_HEIGHT, viewportHeight, count * ROW_HEIGHT)
+        if (top !== null && top !== this.el.scrollTop) {
+          this.#follow.onProgrammaticScroll(top)
+          this.el.scrollTop = top
+        }
       }
     }
 
````


- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/app.test.ts`

Expected: exit 0, printing:

```text
    Test Files  2 passed (2)
    Tests  57 passed (57)
```

Run: `cd web && pnpm exec vitest run --project browser tests/browser/tm-grid.test.ts tests/browser/tm-pointer.test.ts tests/browser/tm-follow-clamp.test.ts tests/browser/marks.test.ts tests/browser/running-focus.test.ts tests/browser/hidden.test.ts tests/browser/hidden-views.test.ts tests/browser/state-diagram.test.ts`

Expected: exit 0, printing:

```text
    Test Files  8 passed (8)
    Tests  49 passed (49)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, from `web/`, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 5 of 5 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| S1 | the link writes no hold — `virtual-grid.ts`: `this.#hold = { follow: rows.follow }` → `(deleted)` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/app.test.ts` | `tests/browser/app.test.ts > the app, end to end > stepping > a source-originated link scrolls the table into view even while it is still following the machine`, `tests/browser/virtual-grid.test.ts > a virtual grid > holds a link's row over following through the scroll's own event, until the row it follows moves` |
| S2 | a hold outlives the run moving — `virtual-grid.ts`: `} else if (this.#hold === null || this.#hold.follow !== rows.follow) {` → `} else if (this.#hold === null) {` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/app.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > holds a link's row over following through the scroll's own event, until the row it follows moves` |
| S3 | attach keeps the hold — `virtual-grid.ts`: `this.#follow.attach() ⏎     this.#hold = null ⏎     this.draw()` → `this.#follow.attach() ⏎     this.draw()` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/app.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > follows again on attach after a link, though the row it follows has not moved` |
| S4 | reset keeps the hold — `virtual-grid.ts`: `this.#active = 0 ⏎     this.#hold = null` → `this.#active = 0` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/app.test.ts` | `tests/browser/virtual-grid.test.ts > a virtual grid > follows the new content after reset, though a link held the box against the same follow row` |
| S5 | the link wins one draw again — `virtual-grid.ts`: `} else if (this.#hold === null || this.#hold.follow !== rows.follow) { ⏎       this.#hold = null ⏎       if (rows.follow !== null) {` → `} else if (true) { ⏎       this.#hold = null ⏎       if (rows.follow !== null) {` | `pnpm exec vitest run --project browser tests/browser/virtual-grid.test.ts tests/browser/app.test.ts` | `tests/browser/app.test.ts > the app, end to end > stepping > a source-originated link scrolls the table into view even while it is still following the machine`, `tests/browser/virtual-grid.test.ts > a virtual grid > holds a link's row over following through the scroll's own event, until the row it follows moves` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
A link's scroll holds a following grid until the run moves

`VirtualGrid.scrollToRow` let a link win the one draw that wrote its
scroll, and the scroll's own event redrew the box a frame later: a grid
still following scrolled straight back to the run's row, so a link made
while the rule table followed showed its rows for one frame.
`app.test.ts`'s guard for it read the table in the link's own turn and
passed. The scroll now holds while the view's follow row is the one it
was written against, and following takes over when that row moves, on
`attach`, or on `reset`; the guard awaits the scroll's event.
````


---

### Task 4: Core's view model carries the asm machine: `AsmState`, the cursor cut to a window, and `AsmProgram`, its listing

**Files:**
- Modify: `crates/redextape-core/src/viewmodel.rs`, `crates/redextape-core/src/trace/asm_cursor.rs` (derives), `crates/redextape-core/src/tm/asm.rs` (`reg_str` becomes `pub(crate)`)
- Modify (tests): `crates/redextape-core/tests/viewmodel_contract.rs`, `crates/redextape-core/tests/ts_bindings.rs`, `crates/redextape-wasm/tests/ts_bindings.rs`

**Interfaces:**
- Produces in `redextape_core::viewmodel`, each with serde and the canonical ts derive: `AsmWindow { locals, args, frames, cells, boxes }` (also `Deserialize`: the web sends it); `AsmWord { word: String, tag: WordTag }`; `AsmCallFrame { ret_pc, saved: Vec<AsmWord>, saved_len }`; `AsmCell { cell, head, tail }`; `AsmBox { handle, content }`; `AsmProgram { listing: Vec<String>, labels: Vec<(String, usize)> }` with `AsmProgram::of(&Program)`; and `AsmState { step, pc, next, rr, locals, written, locals_len, args, args_len, wrote, depth, frames, heap_len, cells, box_len, boxes, source_node }` with `AsmState::window(&AsmCursor<P>, Option<&SourceMap>, AsmWindow)`.
- `WordTag` and `AsmCap` gain serde and the canonical ts derive. `AsmStatus` and `Reg` do not: the wasm crate reports status its own way, and a register crosses as its printed name.

**IN CORE, BESIDE `TmState`, BY THE USER'S DECISION (amendment 6).** Every per-step type that crosses to JavaScript is declared in `viewmodel.rs` with its derives, and so is the builder that windows a cursor; the bounds are the builder's parameters, set by the renderer, because the module's rule is that core never picks a number.

**WHAT A FRAME CARRIES, AND WHERE EACH LIST IS CUT.** A word is its decimal string and its tag (§5.3, amendment 13: `serde-wasm-bindgen` refuses a `u64` above `Number.MAX_SAFE_INTEGER`). The locals and arguments are cut at the window with their true lengths beside them; the frames are **top first**, so the window cuts the oldest; the cells are the newest `cells` **plus every cell a list-tagged register the frame shows names**, newest first, so the view's back-reference always has its cell; the boxes likewise. `next` is the instruction about to run — `Some(pc)` while the run can go on, a step cap included, `None` once it halted or faulted — `TmState.rule`'s semantics one leg over. `wrote` is the register's printed name, through `tm/asm.rs`'s printer rather than a second copy of it.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=4
diff --git a/crates/redextape-core/src/viewmodel.rs b/crates/redextape-core/src/viewmodel.rs
index 08b66a5..f4b535c 100644
--- a/crates/redextape-core/src/viewmodel.rs
+++ b/crates/redextape-core/src/viewmodel.rs
@@ -647,4 +647,15 @@ mod tests {
             assert!(index.asm_owner.is_empty(), "with a program: {}, got {:?}", program.is_some(), index.asm_owner);
         }
     }
+
+    /// A list word or box handle past the end names no slot, nor does `nil`'s 0, so `AsmState::window` shows
+    /// no cell for such a word rather than indexing past the heap. No real run hands `window` one — `slot`'s
+    /// doc says why — so a hand-made word is the only way to reach the refusal. Of the three named words
+    /// only 2 is in range, and it names slot 1 beside the newest, slot 2.
+    #[test]
+    fn a_word_past_the_heap_names_no_cell() {
+        assert_eq!(shown(3, 1, [0, 2, 4, u64::MAX]), BTreeSet::from([1, 2]));
+        assert_eq!((slot(3, 3), slot(4, 3), slot(0, 3)), (Some(2), None, None));
+        assert!(shown(0, 16, [1]).is_empty(), "an empty heap shows nothing, whatever a register says");
+    }
 }
diff --git a/crates/redextape-core/tests/ts_bindings.rs b/crates/redextape-core/tests/ts_bindings.rs
index 3ebf69c..fe054cd 100644
--- a/crates/redextape-core/tests/ts_bindings.rs
+++ b/crates/redextape-core/tests/ts_bindings.rs
@@ -19,7 +19,11 @@ use redextape_core::diagnostic::{Diagnostic, Severity};
 use redextape_core::lambda::{Cut, Owner};
 use redextape_core::span::Span;
 use redextape_core::tm::machine::Move;
-use redextape_core::viewmodel::{LambdaState, RuleView, StateView, TmProgram, TmState};
+use redextape_core::trace::{AsmCap, WordTag};
+use redextape_core::viewmodel::{
+    AsmBox, AsmCallFrame, AsmCell, AsmProgram, AsmState, AsmWindow, AsmWord, LambdaState, RuleView, StateView,
+    TmProgram, TmState,
+};
 use redextape_test_support::ts_derive_scan::{
     assert_overrides_match_field_nullability, ts_deriving_type_names_in_crate, without_doc_comments,
 };
@@ -28,6 +32,14 @@ use ts_rs::TS;
 /// Every type in this crate carrying `#[ts(export)]`, paired with the file it generates.
 fn generated() -> Vec<(&'static str, String)> {
     vec![
+        ("AsmBox", AsmBox::export_to_string().unwrap()),
+        ("AsmCallFrame", AsmCallFrame::export_to_string().unwrap()),
+        ("AsmCap", AsmCap::export_to_string().unwrap()),
+        ("AsmCell", AsmCell::export_to_string().unwrap()),
+        ("AsmProgram", AsmProgram::export_to_string().unwrap()),
+        ("AsmState", AsmState::export_to_string().unwrap()),
+        ("AsmWindow", AsmWindow::export_to_string().unwrap()),
+        ("AsmWord", AsmWord::export_to_string().unwrap()),
         ("Cut", Cut::export_to_string().unwrap()),
         ("Diagnostic", Diagnostic::export_to_string().unwrap()),
         ("LambdaState", LambdaState::export_to_string().unwrap()),
@@ -40,6 +52,7 @@ fn generated() -> Vec<(&'static str, String)> {
         ("TmProgram", TmProgram::export_to_string().unwrap()),
         ("TmState", TmState::export_to_string().unwrap()),
         ("TokenClass", TokenClass::export_to_string().unwrap()),
+        ("WordTag", WordTag::export_to_string().unwrap()),
     ]
 }
 
diff --git a/crates/redextape-core/tests/viewmodel_contract.rs b/crates/redextape-core/tests/viewmodel_contract.rs
index 7f7f44f..8426f61 100644
--- a/crates/redextape-core/tests/viewmodel_contract.rs
+++ b/crates/redextape-core/tests/viewmodel_contract.rs
@@ -8,9 +8,12 @@
 use std::alloc::{GlobalAlloc, Layout, System};
 use std::sync::atomic::{AtomicUsize, Ordering};
 
+use redextape_core::core::BinOp;
 use redextape_core::lambda::reduce::MAX_TERM_DEPTH;
 use redextape_core::sourcemap::SourceMap;
-use redextape_core::viewmodel::{LambdaState, LinkIndex, TmProgram, TmState};
+use redextape_core::tm::asm::{Instr, Program, Reg, print_instr};
+use redextape_core::trace::{AsmCursor, AsmStatus, WordTag};
+use redextape_core::viewmodel::{AsmProgram, AsmState, AsmWindow, AsmWord, LambdaState, LinkIndex, TmProgram, TmState};
 
 /// Counts bytes requested through the global allocator, so a test can measure what a call actually
 /// allocates instead of timing it. Scoped to this one integration test binary: each file under
@@ -902,3 +905,419 @@ fn redex_span_is_none_before_any_step() {
     assert_eq!(f.step, 0);
     assert!(f.redex_span.is_none(), "step 0 precedes any contraction; there is no redex to locate");
 }
+
+// --- the asm leg ---------------------------------------------------------------------------------------
+
+/// A window no program below reaches, so a frame built with it carries the whole machine.
+const WHOLE: AsmWindow = AsmWindow { locals: 64, args: 16, frames: 8, cells: 16, boxes: 16 };
+
+fn asm_label(name: &str) -> String {
+    name.to_string()
+}
+
+/// Each word's decimal text, in order.
+fn asm_words(ws: &[AsmWord]) -> Vec<&str> {
+    ws.iter().map(|w| w.word.as_str()).collect()
+}
+
+/// Each word's tag, in order.
+fn asm_tags(ws: &[AsmWord]) -> Vec<WordTag> {
+    ws.iter().map(|w| w.tag).collect()
+}
+
+fn asm_word(word: &str, tag: WordTag) -> AsmWord {
+    AsmWord { word: word.to_string(), tag }
+}
+
+/// `fact(3)`, the sample `sourcemap.rs`'s owner tests measure their rows on.
+const ASM_FACT: &str = "fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)";
+
+/// `ASM_FACT`'s program and the map built from its source, the program being the one `tm::lower_program`
+/// returns for the map's own `Core` — the program `SourceMap::asm_owner` indexes.
+fn asm_fact() -> (Program, SourceMap) {
+    let (p, ds) = redextape_core::parser::parse(ASM_FACT);
+    assert!(ds.is_empty(), "{ds:?}");
+    let (core, map) = SourceMap::build_from_program(&p.expect("parses"), &redextape_core::tm::Unary::default());
+    (redextape_core::tm::lower_program(&core).expect("lowers"), map)
+}
+
+/// Every list the frame carries stops at its bound and reports the length it was cut from, and each bound
+/// cuts its own list: the five are distinct (5, 3, 2, 4, 1), so a bound read from the wrong field fails. The
+/// program writes 13 locals and 7 arguments, allocates 6 cells and 4 boxes, and recurses until 6 frames are
+/// saved, then halts in the deepest. Every register it names holds a value or the newest cell or box, so no
+/// register pulls an older one in and the cells and boxes are the plain newest windows. A window larger than
+/// all of it carries all of it, so the lengths are not the bounds read back.
+#[test]
+fn every_asm_list_stops_at_its_bound_and_reports_its_length() {
+    let (loc, arg) = (Reg::Loc, Reg::Arg);
+    let mut code: Vec<Instr> = (0..12).map(|i| Instr::Li(loc(i), u64::from(i))).collect();
+    code.extend((0..6).map(|i| Instr::Li(arg(i), 100 + u64::from(i))));
+    code.push(Instr::Li(arg(6), 5)); // the recursion's counter
+    code.extend((0..6).map(|_| Instr::Cons(Reg::Rr, loc(1), loc(2))));
+    code.extend((0..4).map(|_| Instr::Box(Reg::Rr, loc(3))));
+    code.push(Instr::Li(loc(12), 1));
+    code.push(Instr::Call(asm_label("f")));
+    let f = code.len();
+    code.push(Instr::Jz(arg(6), asm_label("stop")));
+    code.push(Instr::Bin(BinOp::Sub, arg(6), arg(6), loc(12)));
+    code.push(Instr::Call(asm_label("f")));
+    let stop = code.len();
+    code.push(Instr::Halt);
+    let prog = Program { code, labels: vec![(asm_label("f"), f), (asm_label("stop"), stop)] };
+    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
+    c.by_ref().for_each(drop);
+    assert_eq!(c.status(), Some(&AsmStatus::Halted));
+
+    let narrow = AsmState::window(&c, None, AsmWindow { locals: 5, args: 3, frames: 2, cells: 4, boxes: 1 });
+    assert_eq!(
+        (asm_words(&narrow.locals), narrow.written.len(), narrow.locals_len),
+        (vec!["0", "1", "2", "3", "4"], 5, 13)
+    );
+    assert_eq!((asm_words(&narrow.args), narrow.args_len), (vec!["100", "101", "102"], 7));
+    assert_eq!((narrow.frames.len(), narrow.depth), (2, 6));
+    for frame in &narrow.frames {
+        assert_eq!((asm_words(&frame.saved), frame.saved_len), (vec!["0", "1", "2", "3", "4"], 13));
+    }
+    let cells: Vec<usize> = narrow.cells.iter().map(|c| c.cell).collect();
+    assert_eq!((cells, narrow.heap_len), (vec![6, 5, 4, 3], 6));
+    let boxes: Vec<usize> = narrow.boxes.iter().map(|b| b.handle).collect();
+    assert_eq!((boxes, narrow.box_len), (vec![4], 4));
+
+    let whole = AsmState::window(&c, None, WHOLE);
+    let lens = (whole.locals.len(), whole.written.len(), whole.args.len(), whole.frames.len());
+    assert_eq!(lens, (13, 13, 7, 6));
+    assert!(whole.frames.iter().all(|f| f.saved.len() == 13));
+    assert_eq!((whole.cells.len(), whole.boxes.len()), (6, 4));
+}
+
+/// Each word carries its tag into the frame — in the locals, an argument, `rr`, a saved frame, a cell's head
+/// and tail, and a box — and the words and tags stay paired: the program makes a value, the list word `nil`,
+/// a list and a box, copies the list to `a0` and the box to `rr`, and calls, so the frame is read inside the
+/// callee with the caller's bank saved. Every one of the three tags appears where the table says.
+#[test]
+fn every_word_in_an_asm_frame_carries_its_tag() {
+    use WordTag::{Box as B, List as L, Value as V};
+    let (r0, r1, r2, r3) = (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2), Reg::Loc(3));
+    let prog = Program {
+        code: vec![
+            Instr::Li(r0, 7),
+            Instr::Nil(r1),
+            Instr::Cons(r2, r0, r1),
+            Instr::Box(r3, r2),
+            Instr::Mov(Reg::Arg(0), r2),
+            Instr::Mov(Reg::Rr, r3),
+            Instr::Call(asm_label("f")),
+            Instr::Halt,
+        ],
+        labels: vec![(asm_label("f"), 7)],
+    };
+    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
+    c.by_ref().take(7).for_each(drop);
+    let st = AsmState::window(&c, None, WHOLE);
+    assert_eq!((asm_words(&st.locals), asm_tags(&st.locals)), (vec!["7", "0", "1", "1"], vec![V, L, L, B]));
+    assert_eq!((asm_words(&st.args), asm_tags(&st.args)), (vec!["1"], vec![L]));
+    assert_eq!(st.rr, asm_word("1", B));
+    let saved = &st.frames[0].saved;
+    assert_eq!((asm_words(saved), asm_tags(saved)), (vec!["7", "0", "1", "1"], vec![V, L, L, B]));
+    let cell = &st.cells[0];
+    assert_eq!((cell.cell, &cell.head, &cell.tail), (1, &asm_word("7", V), &asm_word("0", L)));
+    assert_eq!((st.boxes[0].handle, &st.boxes[0].content), (1, &asm_word("1", L)));
+}
+
+/// A word travels as its exact decimal text, however large: `mul` saturates 2^32 · 2^32 to `u64::MAX`, and
+/// 2^53 + 1 is the first integer a JS number cannot hold, which a conversion through `f64` would round to
+/// ...992. `AsmWord`'s doc says why the wire needs the string.
+#[test]
+fn an_asm_word_is_its_exact_decimal_text_up_to_a_saturated_u64() {
+    let (r0, r1, r2) = (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2));
+    let prog = Program {
+        code: vec![
+            Instr::Li(r0, 1 << 32),
+            Instr::Bin(BinOp::Mul, r1, r0, r0),
+            Instr::Li(r2, (1 << 53) + 1),
+            Instr::Mov(Reg::Rr, r1),
+            Instr::Halt,
+        ],
+        labels: vec![],
+    };
+    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
+    c.by_ref().for_each(drop);
+    let st = AsmState::window(&c, None, WHOLE);
+    assert_eq!(asm_words(&st.locals), ["4294967296", "18446744073709551615", "9007199254740993"]);
+    assert_eq!(st.rr.word, u64::MAX.to_string());
+}
+
+/// Frames come top first, each with the caller's locals as they stood at its `call`. `sum(5)` by recursion,
+/// the fixture `asm_cursor.rs`'s stack test uses: at its deepest the stack holds the top-level call's frame,
+/// returning to 2 with no locals yet, and five recursive ones returning to 12, each saving its activation's
+/// `n` in `r0` — so top first reads `n` 1, 2, 3, 4, 5 and then the empty bank. A window of three keeps the
+/// three nearest the running instruction, which oldest first would have dropped.
+#[test]
+fn asm_frames_come_top_first_with_the_locals_saved_at_each_call() {
+    let (r0, r1, r2, r3, a0) = (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2), Reg::Loc(3), Reg::Arg(0));
+    let sum5 = Program {
+        code: vec![
+            Instr::Li(a0, 5),
+            Instr::Call(asm_label("sum")),
+            Instr::Halt,
+            Instr::Mov(r0, a0),
+            Instr::Li(r1, 0),
+            Instr::Bin(BinOp::Eq, r2, r0, r1),
+            Instr::Jz(r2, asm_label("rec")),
+            Instr::Li(Reg::Rr, 0),
+            Instr::Ret,
+            Instr::Li(r3, 1),
+            Instr::Bin(BinOp::Sub, a0, r0, r3),
+            Instr::Call(asm_label("sum")),
+            Instr::Bin(BinOp::Add, Reg::Rr, r0, Reg::Rr),
+            Instr::Ret,
+        ],
+        labels: vec![(asm_label("sum"), 3), (asm_label("rec"), 9)],
+    };
+    let mut c = AsmCursor::new(&sum5, redextape_core::tm::asm::DEFAULT_CAPS);
+    while c.stack().len() < 6 {
+        assert!(c.next().is_some(), "sum(5) saves six frames before it returns");
+    }
+    let saved_n = |st: &AsmState| -> Vec<Option<String>> {
+        st.frames.iter().map(|f| f.saved.first().map(|w| w.word.clone())).collect()
+    };
+    let whole = AsmState::window(&c, None, WHOLE);
+    let rets: Vec<usize> = whole.frames.iter().map(|f| f.ret_pc).collect();
+    assert_eq!(rets, [12, 12, 12, 12, 12, 2]);
+    let n = |s: &str| Some(s.to_string());
+    assert_eq!(saved_n(&whole), [n("1"), n("2"), n("3"), n("4"), n("5"), None]);
+
+    let top3 = AsmState::window(&c, None, AsmWindow { frames: 3, ..WHOLE });
+    assert_eq!((saved_n(&top3), top3.depth), (vec![n("1"), n("2"), n("3")], 6));
+}
+
+/// Cells come newest first, with every cell a list register on screen points at, once. The program builds
+/// six cells: `r1` keeps the first, `a0` the third, `r3` ends on the sixth, and `r6` holds the second but sits
+/// past a five-local window; `r4` holds the VALUE 2 and `r0` is `nil`. So a window of the two newest shows
+/// cells 6 and 5, plus 3 and 1 for `a0` and `r1` — not 2, which only a value and an off-screen register
+/// name — and with no arguments on screen, not 3 either.
+#[test]
+fn asm_cells_come_newest_first_with_every_cell_a_list_register_names() {
+    use WordTag::{List as L, Value as V};
+    let (r0, r1, r2, r3, r4, r6, a0) =
+        (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2), Reg::Loc(3), Reg::Loc(4), Reg::Loc(6), Reg::Arg(0));
+    let prog = Program {
+        code: vec![
+            Instr::Nil(r0),
+            Instr::Li(r2, 5),
+            Instr::Cons(r1, r2, r0),
+            Instr::Cons(r3, r2, r1),
+            Instr::Mov(r6, r3),
+            Instr::Cons(a0, r2, r3),
+            Instr::Cons(r3, r2, a0),
+            Instr::Cons(r3, r2, r3),
+            Instr::Cons(r3, r2, r3),
+            Instr::Li(r4, 2),
+            Instr::Halt,
+        ],
+        labels: vec![],
+    };
+    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
+    c.by_ref().for_each(drop);
+    let window = AsmWindow { locals: 5, args: 1, frames: 0, cells: 2, boxes: 0 };
+    let st = AsmState::window(&c, None, window);
+    let cells: Vec<usize> = st.cells.iter().map(|c| c.cell).collect();
+    assert_eq!((cells, st.heap_len), (vec![6, 5, 3, 1], 6));
+    let first = st.cells.last().expect("cell 1 is shown");
+    assert_eq!((&first.head, &first.tail), (&asm_word("5", V), &asm_word("0", L)));
+
+    let no_args = AsmState::window(&c, None, AsmWindow { args: 0, ..window });
+    assert_eq!(no_args.cells.iter().map(|c| c.cell).collect::<Vec<_>>(), [6, 5, 1]);
+}
+
+/// Boxes by the same rule: newest first, with every box a box register on screen names. `r1` keeps box 1 and
+/// `rr` box 2, `r2` ends on box 4, and `r3` holds the VALUE 1. A window of the newest box shows 4, plus 2
+/// and 1 for `rr` and `r1`.
+#[test]
+fn asm_boxes_come_newest_first_with_every_box_a_box_register_names() {
+    let (r0, r1, r2, r3) = (Reg::Loc(0), Reg::Loc(1), Reg::Loc(2), Reg::Loc(3));
+    let prog = Program {
+        code: vec![
+            Instr::Li(r0, 7),
+            Instr::Box(r1, r0),
+            Instr::Box(r2, r0),
+            Instr::Mov(Reg::Rr, r2),
+            Instr::Box(r2, r0),
+            Instr::Box(r2, r0),
+            Instr::Li(r3, 1),
+            Instr::Halt,
+        ],
+        labels: vec![],
+    };
+    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
+    c.by_ref().for_each(drop);
+    let st = AsmState::window(&c, None, AsmWindow { boxes: 1, ..WHOLE });
+    let boxes: Vec<usize> = st.boxes.iter().map(|b| b.handle).collect();
+    assert_eq!((boxes, st.box_len), (vec![4, 2, 1], 4));
+    assert!(st.boxes.iter().all(|b| b.content == asm_word("7", WordTag::Value)));
+}
+
+/// `wrote` names the register each step wrote, spelled as the listing spells it, and `None` before the first
+/// step and after one that wrote none; `written` is the current frame's bits, cleared by `call` and restored
+/// by `ret`; `step` and `pc` follow the cursor. One row per frame, from step 0 to the halt.
+#[test]
+fn an_asm_frame_names_the_register_its_step_wrote_and_the_locals_its_frame_wrote() {
+    let prog = Program {
+        code: vec![
+            Instr::Li(Reg::Loc(0), 1),
+            Instr::Li(Reg::Arg(0), 2),
+            Instr::Call(asm_label("f")),
+            Instr::Li(Reg::Rr, 3),
+            Instr::Halt,
+            Instr::Li(Reg::Loc(1), 9),
+            Instr::Ret,
+        ],
+        labels: vec![(asm_label("f"), 5)],
+    };
+    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
+    let mut rows = Vec::new();
+    loop {
+        let st = AsmState::window(&c, None, WHOLE);
+        rows.push((st.step, st.pc, st.wrote, st.written));
+        if c.next().is_none() {
+            break;
+        }
+    }
+    let name = |s: &str| Some(s.to_string());
+    let (t, f) = (true, false);
+    assert_eq!(
+        rows,
+        [
+            (0, 0, None, vec![]),
+            (1, 1, name("r0"), vec![t]),
+            (2, 2, name("a0"), vec![t]),
+            (3, 5, None, vec![f]),
+            (4, 6, name("r1"), vec![f, t]),
+            (5, 3, None, vec![t]),
+            (6, 4, name("rr"), vec![t]),
+            (7, 4, None, vec![t]),
+        ]
+    );
+}
+
+/// `next` is the instruction about to run while the run can go on and `None` once it has ended. A taken
+/// `jz` moves it past the `li` it skips; after `halt` it is `None` though `pc` stays on the `halt`; at a step
+/// cap it is the instruction the raised cap will run, and so at a stack cap, which no raise will move; and
+/// after a fault — `head` of `nil` — it is `None` though `pc` names the `head`.
+#[test]
+fn an_asm_frames_next_is_the_instruction_about_to_run_until_the_run_ends() {
+    use redextape_core::tm::asm::{Caps, DEFAULT_CAPS};
+    let skip = Program {
+        code: vec![
+            Instr::Li(Reg::Loc(0), 0),
+            Instr::Jz(Reg::Loc(0), asm_label("end")),
+            Instr::Li(Reg::Rr, 9),
+            Instr::Halt,
+        ],
+        labels: vec![(asm_label("end"), 3)],
+    };
+    let mut c = AsmCursor::new(&skip, DEFAULT_CAPS);
+    let mut rows = Vec::new();
+    loop {
+        let st = AsmState::window(&c, None, WHOLE);
+        rows.push((st.pc, st.next));
+        if c.next().is_none() {
+            break;
+        }
+    }
+    assert_eq!(rows, [(0, Some(0)), (1, Some(1)), (3, Some(3)), (3, None)]);
+
+    let mut capped = AsmCursor::new(&skip, Caps { steps: 2, ..DEFAULT_CAPS });
+    capped.by_ref().for_each(drop);
+    assert_eq!(capped.status(), Some(&AsmStatus::Capped(redextape_core::trace::AsmCap::Steps)));
+    let st = AsmState::window(&capped, None, WHOLE);
+    assert_eq!((st.pc, st.next), (3, Some(3)), "a paused run's next instruction is the one a raise runs");
+
+    let call = Program { code: vec![Instr::Call(asm_label("f"))], labels: vec![(asm_label("f"), 0)] };
+    let mut refused = AsmCursor::new(&call, Caps { stack: 0, ..DEFAULT_CAPS });
+    refused.by_ref().for_each(drop);
+    assert_eq!(refused.status(), Some(&AsmStatus::Capped(redextape_core::trace::AsmCap::Stack)));
+    assert_eq!(AsmState::window(&refused, None, WHOLE).next, Some(0), "the call the stack cap refused");
+
+    let faults =
+        Program { code: vec![Instr::Nil(Reg::Loc(0)), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt], labels: vec![] };
+    let mut c = AsmCursor::new(&faults, DEFAULT_CAPS);
+    c.by_ref().for_each(drop);
+    assert_eq!(c.status(), Some(&AsmStatus::Faulted("head of empty list".to_string())));
+    let st = AsmState::window(&c, None, WHOLE);
+    assert_eq!((st.pc, st.next), (1, None), "the faulting `head` will never run");
+}
+
+/// `source_node` is the owner of the instruction about to run, through a real map built from the program's
+/// source, and the assertions compare the owner's SOURCE TEXT, not the map's answer read back: `ASM_FACT`'s
+/// instruction 4 is its `n == 0`, 11 its `n - 1` and 17 its literal `3`, the rows `sourcemap.rs`'s
+/// `each_instruction_is_owned_by_the_construct_that_emitted_it` measured. With no map the owner is `None` and
+/// nothing else in the frame changes; a `pc` past the program's end, where a fetch faulted, has no owner
+/// rather than an index out of bounds.
+#[test]
+fn an_asm_frames_source_node_is_the_owner_of_the_instruction_about_to_run() {
+    let (prog, map) = asm_fact();
+    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
+    let mut seen = std::collections::BTreeMap::new();
+    loop {
+        let st = AsmState::window(&c, Some(&map), WHOLE);
+        let text = st.source_node.and_then(|n| map.source_span(n)).map(|s| &ASM_FACT[s.start..s.end]);
+        seen.entry(st.pc).or_insert(text);
+        if st.pc == 11 {
+            assert!(st.source_node.is_some(), "the loop is at an owned instruction, or the next line proves nothing");
+            let unmapped = AsmState::window(&c, None, WHOLE);
+            assert_eq!(unmapped, AsmState { source_node: None, ..st }, "the map decides `source_node` alone");
+        }
+        if c.next().is_none() {
+            break;
+        }
+    }
+    let at = |pc: usize| seen.get(&pc).copied().flatten();
+    assert_eq!((at(4), at(11), at(17)), (Some("n == 0"), Some("n - 1"), Some("3")));
+
+    let falls_off = Program { code: vec![Instr::Li(Reg::Loc(0), 0)], labels: vec![] };
+    let owns_one = SourceMap { asm_owner: vec![Some(7)], ..SourceMap::default() };
+    let mut c = AsmCursor::new(&falls_off, redextape_core::tm::asm::DEFAULT_CAPS);
+    assert_eq!(AsmState::window(&c, Some(&owns_one), WHOLE).source_node, Some(7));
+    c.by_ref().for_each(drop);
+    assert_eq!(c.status(), Some(&AsmStatus::Faulted("ran past end of program".to_string())));
+    let past = AsmState::window(&c, Some(&owns_one), WHOLE);
+    assert_eq!((past.pc, past.source_node), (1, None));
+}
+
+/// `AsmProgram` is `print_instr`'s line for every instruction and the program's own labels — the same text
+/// the TM view's `TmProgram.listing` is built from, which the map's `tm_listing` holds for this program. Line
+/// 4 is pinned as text, so a listing that disagreed with the printer in every line alike still fails.
+#[test]
+fn asm_program_is_the_printers_listing_and_the_programs_labels() {
+    let (prog, map) = asm_fact();
+    let p = AsmProgram::of(&prog);
+    assert_eq!(p.listing, prog.code.iter().map(print_instr).collect::<Vec<_>>());
+    assert_eq!(p.listing.get(4).map(String::as_str), Some("cmpeq\tr1, r2, r3"));
+    assert!(!prog.labels.is_empty(), "`fact` has labels, or the next line compares two empty lists");
+    assert_eq!(p.labels, prog.labels);
+    assert_eq!((&p.listing, &p.labels), (&map.tm_listing, &map.tm_labels), "the two views list one program");
+}
+
+/// A word crosses as a JSON string and a tag as its variant's name — the wire form `AsmWord`'s doc argues
+/// for, in the serializer this crate controls; `redextape-wasm`'s browser tests read it through the one the
+/// app uses. The frame, the program and the window each round-trip.
+#[cfg(feature = "serde")]
+#[test]
+fn an_asm_frame_crosses_as_json_with_words_as_strings() {
+    let (prog, map) = asm_fact();
+    let mut c = AsmCursor::new(&prog, redextape_core::tm::asm::DEFAULT_CAPS);
+    c.by_ref().take(30).for_each(drop);
+    let st = AsmState::window(&c, Some(&map), WHOLE);
+    let json = serde_json::to_value(&st).expect("serialize");
+    assert_eq!(json["rr"]["word"], serde_json::Value::String(st.rr.word.clone()), "a word is a string");
+    assert_eq!(json["rr"]["tag"], serde_json::Value::String("Value".to_string()), "a tag is its variant's name");
+    let back: AsmState = serde_json::from_value(json).expect("deserialize");
+    assert_eq!(back, st);
+
+    let p = AsmProgram::of(&prog);
+    let back: AsmProgram = serde_json::from_str(&serde_json::to_string(&p).expect("serialize")).expect("deserialize");
+    assert_eq!(back, p);
+    let w: AsmWindow = serde_json::from_str(r#"{"locals":1,"args":2,"frames":3,"cells":4,"boxes":5}"#).expect("parse");
+    assert_eq!(w, AsmWindow { locals: 1, args: 2, frames: 3, cells: 4, boxes: 5 });
+}
diff --git a/crates/redextape-wasm/tests/ts_bindings.rs b/crates/redextape-wasm/tests/ts_bindings.rs
index 52fe898..0a9c338 100644
--- a/crates/redextape-wasm/tests/ts_bindings.rs
+++ b/crates/redextape-wasm/tests/ts_bindings.rs
@@ -29,7 +29,7 @@ use ts_rs::TS;
 
 /// Every type in this crate carrying `#[ts(export)]`, paired with the file it generates.
 ///
-/// **SEVEN, AND `redextape-core`'s TWELVE ARE NOT AMONG THEM.** Each crate's gate covers its own
+/// **SEVEN, AND NONE OF CORE'S ARE AMONG THEM.** Each crate's gate covers its own
 /// derive sites, because `ts_deriving_type_names_in_crate` scans one crate root and a type declared
 /// in the other one is invisible to it from here. That is the correct division: a core type added
 /// without an entry in core's `generated()` fails core's gate, not this one.
````


- [ ] **Step 2: Run them and see them fail.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'binary(viewmodel_contract)'`

Expected: exit 101, printing:

```text
    error[E0433]: cannot find type `BTreeSet` in this scope
    error[E0432]: unresolved imports `redextape_core::viewmodel::AsmProgram`, `redextape_core::viewmodel::AsmState`, `redextape_core::viewmodel::AsmWindow`, `redextape_core::viewmodel::AsmWord`
    error: could not compile `redextape-core` (test "viewmodel_contract") due to 1 previous error
    error[E0425]: cannot find function `shown` in this scope
    error[E0425]: cannot find function `slot` in this scope
    error[E0425]: cannot find function `slot` in this scope
    error[E0425]: cannot find function `slot` in this scope
    error[E0425]: cannot find function `shown` in this scope
    error: could not compile `redextape-core` (lib test) due to 6 previous errors
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=4
diff --git a/crates/redextape-core/src/tm/asm.rs b/crates/redextape-core/src/tm/asm.rs
index 0552e6b..c2a955c 100644
--- a/crates/redextape-core/src/tm/asm.rs
+++ b/crates/redextape-core/src/tm/asm.rs
@@ -153,7 +153,12 @@ fn label_name_representable(name: &str) -> bool {
     !name.is_empty() && !name.chars().any(|c| c.is_whitespace() || matches!(c, ';' | ':' | ','))
 }
 
-fn reg_str(r: Reg) -> String {
+/// A register as the listing spells it: `r3`, `a0`, `rr`.
+///
+/// `pub(crate)` FOR ONE OTHER READER, `viewmodel::AsmState::window`, which names the register the last
+/// step wrote in the same spelling, so the asm view can find the register a frame calls changed by the
+/// name the listing prints for it. A second spelling there would agree with this one until either moved.
+pub(crate) fn reg_str(r: Reg) -> String {
     match r {
         Reg::Loc(n) => format!("r{n}"),
         Reg::Arg(n) => format!("a{n}"),
diff --git a/crates/redextape-core/src/trace/asm_cursor.rs b/crates/redextape-core/src/trace/asm_cursor.rs
index 670d08d..88e068c 100644
--- a/crates/redextape-core/src/trace/asm_cursor.rs
+++ b/crates/redextape-core/src/trace/asm_cursor.rs
@@ -31,7 +31,14 @@ pub struct AsmStep {
 
 /// Which cap stopped a run. A UI needs the distinction: raising the step cap resumes a run capped on
 /// steps and cannot help one capped on its stack, heap or saved-frame memory.
+///
+/// **IT TAKES THE SERDE AND TS DERIVES, AND `AsmStatus` BELOW DOES NOT.** `redextape-wasm` reports how a
+/// leg's run stands in its own `RunStatus`, one vocabulary across legs; the one fact about an asm run that
+/// vocabulary cannot carry is which cap stopped it, so this crosses beside it. `AsmStatus` stays a Rust
+/// type: its `Faulted` text is an answer, which a boundary reports as the run's value.
 #[derive(Clone, Copy, Debug, PartialEq, Eq)]
+#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
+#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
 pub enum AsmCap {
     Steps,
     Stack,
@@ -62,7 +69,12 @@ pub enum AsmStatus {
 /// For a compiled program this is exact: every word starts at one making instruction and every other
 /// instruction copies. A hand-written program can use a value as a pointer; the tag then says value,
 /// which is true of how the word was made.
+///
+/// It crosses to JavaScript on every word of `viewmodel::AsmState`, which is how the asm view decides
+/// whether `3` reads as `3`, `#3` or `box #3`.
 #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
+#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
+#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
 pub enum WordTag {
     #[default]
     Value,
diff --git a/crates/redextape-core/src/viewmodel.rs b/crates/redextape-core/src/viewmodel.rs
index f4b535c..cddc6d1 100644
--- a/crates/redextape-core/src/viewmodel.rs
+++ b/crates/redextape-core/src/viewmodel.rs
@@ -10,17 +10,24 @@
 //! 3,203 states and 344,999 steps, so that would re-send 3,203 states 344,999 times. `TmProgram` is
 //! built once per compile and `TmState` carries a bounded window instead — the same reasoning that made
 //! `trace.rs` refuse to materialize tapes per step (3,488 bytes/step, 592.9 MB for `sum(5)`).
+//!
+//! THE ASM LEG IS SPLIT THE SAME WAY, AND ITS FRAME'S BOUNDS ARE PARAMETERS TOO. `AsmProgram` is built once
+//! per compile; `AsmState` carries at most `AsmWindow`'s count of locals, arguments, call frames, cells and
+//! boxes, each beside the length it was cut from. The spec's `sum(1000)` reaches 1,001 frames and its
+//! `upto(200)` 200 cells (§2.5), so a frame that carried the whole machine would grow with the run; how
+//! much of it a view shows is the renderer's call, made where `TM_RADIUS` is, in `web/src/protocol.ts`.
 
 use std::borrow::Borrow;
-use std::collections::BTreeMap;
+use std::collections::{BTreeMap, BTreeSet};
 
 use crate::analysis::TokenClass;
 use crate::core::NodeId;
 use crate::lambda::{Cut, LambdaTerm, Owner, Path, print_lambda_linked};
 use crate::sourcemap::SourceMap;
 use crate::span::Span;
+use crate::tm::asm::{Program, print_instr, reg_str};
 use crate::tm::machine::{Machine, Move, StateId, Symbol};
-use crate::trace::{LambdaCursor, TmCursor};
+use crate::trace::{AsmCursor, AsmStatus, LambdaCursor, TmCursor, WordTag};
 
 pub mod tree;
 
@@ -255,6 +262,215 @@ pub struct TmState {
     pub rule: Option<usize>,
 }
 
+/// How much of the asm machine one `AsmState` carries: the first `locals` locals, the first `args`
+/// arguments, the top `frames` call frames, the newest `cells` cons cells and the newest `boxes` boxes.
+///
+/// **FIVE BOUNDS, ALL THE RENDERER'S** — the module doc's rule that core picks no number. Each one bounds a
+/// list the run can grow without limit: a register bank to `MAX_REGISTERS`, the stack to `Caps::stack`
+/// frames, the heap and the boxes to `Caps::heap` each. `locals` also bounds each frame's saved locals,
+/// since a frame's saved bank is the caller's locals as they stood at the `call`, and a view that shows
+/// five of the current frame's registers has no use for fifty of a caller's.
+///
+/// **`Deserialize` IS LOAD-BEARING HERE, WHERE IT IS NOT FOR ANY OTHER TYPE IN THIS FILE.** Every other type
+/// derives it and nothing reads it back; this one travels the other way, as the argument JavaScript passes
+/// to the asm leg's frame request, so a renderer states its window in one object rather than five
+/// positional numbers it could transpose.
+#[derive(Clone, Copy, Debug, PartialEq, Eq)]
+#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
+#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
+pub struct AsmWindow {
+    pub locals: usize,
+    pub args: usize,
+    pub frames: usize,
+    pub cells: usize,
+    pub boxes: usize,
+}
+
+/// One machine word and the tag saying which kind of instruction made it.
+///
+/// **`word` IS THE `u64` IN DECIMAL, A STRING FOR EVERY WORD, NOT ONLY THE LARGE ONES** (spec §5.3, amendment
+/// 13). Saturating `mul` reaches `u64::MAX`, which a JS number cannot hold exactly — 2^53 + 1 already rounds —
+/// and `serde-wasm-bindgen` 0.6.5, the serializer `redextape-wasm` puts every frame through, refuses a `u64`
+/// above `Number.MAX_SAFE_INTEGER` with an error rather than rounding it, so one saturated register would
+/// fail the whole frame. A number for small words and a string for large ones would put a branch in every
+/// reader for a case no corpus program reaches; one form puts none. `ts-rs`'s `u64`-to-`bigint` default
+/// never arises, since there is no `u64` here to map.
+///
+/// **THE TAG TRAVELS WITH THE WORD, NOT BESIDE THE LIST IT SITS IN**, because it is what the view reads the
+/// word by: `3` as a value, `#3` or `nil` as a list, `box #3` as a box handle (spec §6.3). A parallel list
+/// of tags could be windowed differently from its words; a field cannot.
+#[derive(Clone, Debug, PartialEq, Eq)]
+#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
+#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
+pub struct AsmWord {
+    pub word: String,
+    pub tag: WordTag,
+}
+
+/// One saved call frame: where `ret` resumes, and the first of the caller's locals as they stood at the
+/// `call`, with the length of the whole saved bank.
+///
+/// **NO CALLEE.** The instruction before `ret_pc` is the `call` that pushed this frame, and it names the
+/// label it jumped to, so a renderer holding `AsmProgram.listing` reads the callee off line `ret_pc - 1`.
+/// Carrying it here would send, per frame per step, a name the listing already holds once (spec §5.3).
+///
+/// **NO WRITTEN BITS EITHER.** The view marks a local "left over from caller" in the CURRENT frame (§6.3); a
+/// saved frame's bits come back into play only when `ret` restores them, at which point they are the
+/// current frame's and `AsmState.written` carries them.
+#[derive(Clone, Debug, PartialEq, Eq)]
+#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
+#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
+pub struct AsmCallFrame {
+    pub ret_pc: usize,
+    /// The first `AsmWindow::locals` of the caller's saved locals.
+    pub saved: Vec<AsmWord>,
+    /// How many locals the frame saved, however many `saved` shows.
+    pub saved_len: usize,
+}
+
+/// One cons cell, named by the list word that points at it.
+///
+/// **`cell` IS 1-BASED, BECAUSE THAT IS THE WORD A REGISTER HOLDS.** `cons` returns the heap's length after
+/// its push, and `nil` is the list word 0, so a register reading `#3` points at the cell with `cell: 3`.
+/// A 0-based index here would make every register-to-cell match an off-by-one the renderer had to know.
+#[derive(Clone, Debug, PartialEq, Eq)]
+#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
+#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
+pub struct AsmCell {
+    pub cell: usize,
+    pub head: AsmWord,
+    pub tail: AsmWord,
+}
+
+/// One box, named by the 1-based handle `box` returned for it, for `AsmCell::cell`'s reason: it is the word
+/// a register holds.
+#[derive(Clone, Debug, PartialEq, Eq)]
+#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
+#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
+pub struct AsmBox {
+    pub handle: usize,
+    pub content: AsmWord,
+}
+
+/// The asm program, projected ONCE per compile and never per step, as `TmProgram` is.
+///
+/// **THE LISTING IS `print_instr`'S TEXT, AND SO IS `TmProgram.listing`.** Both views show the same program
+/// from one printer — `SourceMap::tm_listing` is built the same way — so the asm view's line `pc5` and the
+/// TM view's instruction 5 cannot read differently (spec §5.2).
+///
+/// **NO OWNERS.** Each instruction's Core node reaches JavaScript in `LinkIndex::asm_owner`, beside
+/// `tm_owner`, for the reason `LinkIndex`'s own doc gives for one struct rather than an accessor per leg:
+/// every leg's owners must come from one compile. `TmProgram` carries no owners for the same reason.
+#[derive(Clone, Debug, PartialEq, Eq)]
+#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
+#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
+pub struct AsmProgram {
+    /// One line per `Program::code` index, as `print_instr` writes it: `cmpeq\tr1, r2, r3`.
+    pub listing: Vec<String>,
+    /// `Program::labels`: each label with the `listing` line it precedes.
+    pub labels: Vec<(String, usize)>,
+}
+
+/// One step of the asm run, BOUNDED BY CONSTRUCTION: every list the run can grow is cut at a bound
+/// `AsmWindow` supplies, and beside each cut list is the length it was cut from, so a view can say "+N
+/// more" without the rest crossing (spec §5.3). `cells` and `boxes` are the one exception to "cut at the
+/// bound", and they are bounded too — see their docs.
+///
+/// **`pc` IS WHERE THE MACHINE STANDS, `next` IS WHAT RUNS THERE, AND `source_node` IS ITS OWNER.** A frame
+/// is built between two steps, after `step` instructions have completed. While the run can go on, `pc` is
+/// the instruction about to run and `next` says so; once it has ended, `pc` is the instruction that halted
+/// or faulted — `AsmCursor::pc` says which two faults leave it elsewhere — and `next` is `None`.
+///
+/// **ALL THREE REGISTER KINDS KEEP THEIR TAGS, AND THE LOCALS KEEP THEIR WRITTEN BITS.** A local whose bit is
+/// clear holds a word the current frame did not write: the caller's, which `call` leaves in place, or a `0`
+/// the bank grew past (`AsmCursor::written`). The view dims it as "left over from caller" (§6.3).
+#[derive(Clone, Debug, PartialEq, Eq)]
+#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
+#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
+pub struct AsmState {
+    /// Instructions completed — `AsmCursor::steps_taken`.
+    #[cfg_attr(feature = "ts", ts(type = "number"))]
+    pub step: u64,
+    pub pc: usize,
+    /// The instruction ABOUT TO RUN, `Some(pc)`, or `None` once the run has halted or faulted.
+    ///
+    /// IT NAMES WHAT HAPPENS NEXT, NOT WHAT PRODUCED THIS FRAME. A frame is built after a step, so the
+    /// instruction at `pc` is the one the FOLLOWING step executes, and the listing marks that row "runs
+    /// next" and follows it (spec §6.2). `None` after `halt` — `pc` stays on the `halt`, which has already
+    /// run — and after a fault, whose instruction at `pc` did not complete and never will, is a real answer
+    /// about why the run stopped, not a missing one.
+    ///
+    /// **NOT A SECOND COPY OF `pc`.** The two agree while the run can move and part once it has ended, which
+    /// is the case a view must not mark "runs next": a halted program's last row did run, and a faulted
+    /// program's last row never will.
+    ///
+    /// `Some` DOES NOT PROMISE THE CURSOR WILL STEP, `TmState::rule`'s caveat one leg over: at a spent cap
+    /// `AsmCursor::next` refuses before it runs anything, so this names an instruction the very next
+    /// `next()` will not execute.
+    ///
+    /// THAT IS DELIBERATE, AND ANSWERING `None` THERE WOULD BE WORSE. A step cap is raiseable, so a run
+    /// sitting at one is PAUSED, not finished, and the instruction at `pc` is exactly what runs once the cap
+    /// moves; `None` would make a paused run read as a halted one, the conflation `TmState::rule`'s doc
+    /// refuses for the same reason. A stack, heap or memory cap cannot be raised, and it answers `Some` all
+    /// the same: the instruction at `pc` is the one the cap refused, which is where the run stands. Whether
+    /// the cursor may step is the status's question, and a consumer that needs both asks both.
+    pub next: Option<usize>,
+    pub rr: AsmWord,
+    /// The first `AsmWindow::locals` locals.
+    pub locals: Vec<AsmWord>,
+    /// Parallel to `locals`: whether the current frame has written each one.
+    pub written: Vec<bool>,
+    /// How many locals the cursor holds, however many `locals` shows.
+    pub locals_len: usize,
+    /// The first `AsmWindow::args` argument registers.
+    pub args: Vec<AsmWord>,
+    pub args_len: usize,
+    /// The register the step that produced this frame wrote, spelled as the listing spells registers —
+    /// `r3`, `a0`, `rr` — or `None` for a step that wrote none, and before the first step.
+    ///
+    /// **A NAME, NOT A `Reg`**, because a register crosses as the text the view matches it by, and
+    /// `tm::asm`'s printer is the one place that text is made. `Reg` has no serde form and needs none.
+    pub wrote: Option<String>,
+    /// How many frames the stack holds, however many `frames` shows.
+    pub depth: usize,
+    /// The top `AsmWindow::frames` call frames, TOP FIRST.
+    ///
+    /// **TOP FIRST, SO THE WINDOW CUTS THE OLDEST.** The frame nearest the running instruction is the one
+    /// its `ret` returns to, and the view reads the stack from there down (§6.4). `AsmCursor::stack` is
+    /// oldest first, which in a window of 8 over `sum(1000)`'s 1,001 frames would show the program's first
+    /// seven calls and nothing of where it is now.
+    pub frames: Vec<AsmCallFrame>,
+    /// How many cons cells the heap holds.
+    pub heap_len: usize,
+    /// The newest `AsmWindow::cells` cells, PLUS every cell a list-tagged word in `rr`, `locals` or `args`
+    /// points at, each once, NEWEST FIRST — descending `cell`.
+    ///
+    /// **THE REGISTER-NAMED CELLS ARE WHAT MAKE THE VIEW'S BACK-REFERENCE WHOLE.** The heap panel writes
+    /// `#57  57 → #56  ← r5`: cell 57, its head, its tail, and the list registers whose word is 57 (§6.5).
+    /// A window of the newest cells alone drops a list a register built long ago and still holds — the list
+    /// a loop walks, a callee's argument — so the register would read `#3` with no cell 3 to read. For a
+    /// compiled program the tags are exact (`WordTag`'s doc), so every list register's cell is here and every
+    /// back-reference the view draws is true.
+    ///
+    /// **ONLY THE REGISTERS THIS FRAME SHOWS NAME CELLS.** A list word in a local past `AsmWindow::locals`, or
+    /// in a saved frame, is not on screen to be a back-reference, so it pulls in nothing, and the list stays
+    /// bounded: at most `cells + locals + args + 1` entries. A value-tagged word pulls in nothing either,
+    /// even when it equals some cell's number — that is the ambiguity the tags exist to resolve.
+    pub cells: Vec<AsmCell>,
+    /// How many boxes the machine holds.
+    pub box_len: usize,
+    /// The newest `AsmWindow::boxes` boxes, plus every box a box-tagged word in `rr`, `locals` or `args`
+    /// names, each once, newest first — by `cells`' rule and for its reason.
+    pub boxes: Vec<AsmBox>,
+    /// The Core node whose lowering emitted instruction `pc`, through `SourceMap::asm_owner`. `None` with no
+    /// map, for an instruction `defunc` minted, and for a `pc` past the program's end, where a fetch faulted.
+    ///
+    /// **A MAP MUST INDEX THE PROGRAM THE CURSOR RUNS**, which `SourceMap`'s asm half does for the program
+    /// `tm::lower_program` returns — `sourcemap.rs`'s `asm_owner_covers_the_program_lower_program_returns`
+    /// holds it — so a caller steps that program, or passes no map.
+    pub source_node: Option<NodeId>,
+}
+
 impl LambdaState {
     /// Render the term the cursor currently holds, bounded by `byte_budget` and `depth_cap`.
     ///
@@ -430,6 +646,132 @@ impl TmState {
     }
 }
 
+impl AsmProgram {
+    /// Project `p` once — see the module doc; this is built per compile, never per step.
+    #[must_use]
+    pub fn of(p: &Program) -> AsmProgram {
+        AsmProgram { listing: p.code.iter().map(print_instr).collect(), labels: p.labels.clone() }
+    }
+}
+
+impl AsmWord {
+    fn of(word: u64, tag: WordTag) -> AsmWord {
+        AsmWord { word: word.to_string(), tag }
+    }
+}
+
+/// The first `n` of `words`, each with the tag at its index. `get`, never `[]`: the cursor keeps the two
+/// parallel, and a tag it did not have reads as `WordTag`'s default, as the cursor's own reads do.
+fn tagged(words: &[u64], tags: &[WordTag], n: usize) -> Vec<(u64, WordTag)> {
+    words.iter().take(n).enumerate().map(|(i, w)| (*w, tags.get(i).copied().unwrap_or_default())).collect()
+}
+
+/// The 0-based slot a 1-based list word or box handle names among `len`, or `None` for the null word 0 and
+/// for a word past the end.
+///
+/// **UNREACHABLE PAST THE END FROM A REAL RUN, AND REFUSED RATHER THAN INDEXED ANYWAY.** A list-tagged word
+/// comes from `cons`, which returns the heap's new length, from `nil`, or from an instruction that copies
+/// one; the heap never shrinks; so every list word names a cell that exists, and boxes likewise. The check
+/// stays because `window` is a library path a renderer calls per step, and `TmState::window`'s rule holds
+/// here: no word it could be handed may abort the process. `usize::try_from` routes a word a 32-bit target
+/// cannot index to the same `None`, as `AsmCursor`'s own cell lookup does.
+fn slot(word: u64, len: usize) -> Option<usize> {
+    let i = usize::try_from(word.checked_sub(1)?).ok()?;
+    (i < len).then_some(i)
+}
+
+/// The slots a heap or box window shows, ascending: the newest `newest` of `len`, plus the slot each of
+/// `named` points at. A set, so a cell both new and named appears once.
+fn shown(len: usize, newest: usize, named: impl IntoIterator<Item = u64>) -> BTreeSet<usize> {
+    let mut out: BTreeSet<usize> = (len.saturating_sub(newest)..len).collect();
+    out.extend(named.into_iter().filter_map(|w| slot(w, len)));
+    out
+}
+
+impl AsmState {
+    /// The cursor's machine between two steps, cut to `window` — never the whole machine (see the struct
+    /// doc for what each field carries and why each list is cut where it is).
+    ///
+    /// `map` RESOLVES `source_node` AND IS USED FOR NOTHING ELSE, as in `TmState::window`, and `Option` for
+    /// that function's reason: a program no lowering produced — one written or edited by hand — has no map,
+    /// and `source_node` becomes `None` on exactly the path where it has no meaning.
+    ///
+    /// **THE COST IS THE WINDOW'S, NOT THE MACHINE'S.** Each register list, each frame and each saved bank is
+    /// read through `take`, and the heap and boxes are indexed only at the slots `shown` picks, so a frame of
+    /// `sum(1000)` at its deepest reads eight of its 1,001 saved banks.
+    pub fn window<P: Borrow<Program>>(c: &AsmCursor<P>, map: Option<&SourceMap>, window: AsmWindow) -> AsmState {
+        let locals = tagged(c.locals(), c.local_tags(), window.locals);
+        let args = tagged(c.args(), c.arg_tags(), window.args);
+        let rr = (c.rr(), c.rr_tag());
+        // The registers this frame shows, which are the only ones whose words pull a cell or a box into
+        // it — see `cells`' doc.
+        let shown_regs = || locals.iter().chain(&args).chain([&rr]).copied();
+        let named = |tag: WordTag| shown_regs().filter(move |(_, t)| *t == tag).map(|(w, _)| w);
+
+        let frames = c
+            .stack()
+            .iter()
+            .rev()
+            .take(window.frames)
+            .map(|f| AsmCallFrame {
+                ret_pc: f.ret_pc,
+                saved: words(&tagged(&f.saved_locals, &f.saved_tags, window.locals)),
+                saved_len: f.saved_locals.len(),
+            })
+            .collect();
+
+        // Descending, so newest first; `get` again, so a slot `shown` picked cannot index past the end.
+        let conses = c.heap();
+        let cells = shown(conses.len(), window.cells, named(WordTag::List))
+            .into_iter()
+            .rev()
+            .filter_map(|i| {
+                let (head, tail) = *conses.get(i)?;
+                let (head_tag, tail_tag) = c.heap_tags().get(i).copied().unwrap_or_default();
+                Some(AsmCell { cell: i + 1, head: AsmWord::of(head, head_tag), tail: AsmWord::of(tail, tail_tag) })
+            })
+            .collect();
+        let held = c.boxes();
+        let boxes = shown(held.len(), window.boxes, named(WordTag::Box))
+            .into_iter()
+            .rev()
+            .filter_map(|i| {
+                let content = *held.get(i)?;
+                let tag = c.box_tags().get(i).copied().unwrap_or_default();
+                Some(AsmBox { handle: i + 1, content: AsmWord::of(content, tag) })
+            })
+            .collect();
+
+        AsmState {
+            step: c.steps_taken(),
+            pc: c.pc(),
+            next: match c.status() {
+                None | Some(AsmStatus::Capped(_)) => Some(c.pc()),
+                Some(AsmStatus::Halted | AsmStatus::Faulted(_)) => None,
+            },
+            rr: AsmWord::of(rr.0, rr.1),
+            written: c.written().iter().take(window.locals).copied().collect(),
+            locals: words(&locals),
+            locals_len: c.locals().len(),
+            args: words(&args),
+            args_len: c.args().len(),
+            wrote: c.wrote().map(reg_str),
+            depth: c.stack().len(),
+            frames,
+            heap_len: conses.len(),
+            cells,
+            box_len: held.len(),
+            boxes,
+            source_node: map.and_then(|m| m.asm_owner(c.pc())),
+        }
+    }
+}
+
+/// `tagged`'s pairs as the words a frame carries.
+fn words(pairs: &[(u64, WordTag)]) -> Vec<AsmWord> {
+    pairs.iter().map(|(w, t)| AsmWord::of(*w, *t)).collect()
+}
+
 /// The step-0 half of linking one construct across the panes, built ONCE PER COMPILE.
 ///
 /// **THE λ VIEW NO LONGER LINKS THROUGH THIS (Plan 7 part 4a).** It links through the tree it draws,
````


- [ ] **Step 4: Run them and see them pass.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast`

Expected: exit 0, printing:

```text
    Summary: 1307 tests run: 1307 passed, 32 skipped
```

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features ts --no-fail-fast -E 'binary(ts_bindings)'`

Expected: exit 0, printing:

```text
    Summary: 3 tests run: 3 passed, 0 skipped
```

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --features ts --no-fail-fast -E 'binary(ts_bindings)'`

Expected: exit 0, printing:

```text
    Summary: 3 tests run: 3 passed, 0 skipped
```

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo clippy -p redextape-core -p redextape-wasm --all-targets --features ts -- -D warnings`

Expected: exit 0

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, from the repository root, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 32 of 32 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| A1 | `viewmodel.rs`: `let locals = tagged(c.locals(), c.local_tags(), window.locals);` → `let locals = tagged(c.locals(), c.local_tags(), window.args);` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract asm_cells_come_newest_first_with_every_cell_a_list_register_names`, `redextape-core::viewmodel_contract every_asm_list_stops_at_its_bound_and_reports_its_length` |
| A2 | `viewmodel.rs`: `locals_len: c.locals().len(),` → `locals_len: locals.len(),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract every_asm_list_stops_at_its_bound_and_reports_its_length` |
| A3 | `viewmodel.rs`: `let args = tagged(c.args(), c.arg_tags(), window.args);` → `let args = tagged(c.args(), c.arg_tags(), window.locals);` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract asm_cells_come_newest_first_with_every_cell_a_list_register_names`, `redextape-core::viewmodel_contract every_asm_list_stops_at_its_bound_and_reports_its_length` |
| A4 | `viewmodel.rs`: `.take(window.frames)` → `.take(window.cells)` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract every_asm_list_stops_at_its_bound_and_reports_its_length`, `redextape-core::viewmodel_contract asm_frames_come_top_first_with_the_locals_saved_at_each_call` |
| A5 | `viewmodel.rs`: `saved: words(&tagged(&f.saved_locals, &f.saved_tags, window.locals)),` → `saved: words(&tagged(&f.saved_locals, &f.saved_tags, window.args)),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract every_asm_list_stops_at_its_bound_and_reports_its_length` |
| A6 | `viewmodel.rs`: `let cells = shown(conses.len(), window.cells, named(WordTag::List))` → `let cells = shown(conses.len(), window.boxes, named(WordTag::List))` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract every_asm_list_stops_at_its_bound_and_reports_its_length`, `redextape-core::viewmodel_contract asm_cells_come_newest_first_with_every_cell_a_list_register_names` |
| A7 | `viewmodel.rs`: `let boxes = shown(held.len(), window.boxes, named(WordTag::Box))` → `let boxes = shown(held.len(), window.cells, named(WordTag::Box))` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract asm_boxes_come_newest_first_with_every_box_a_box_register_names`, `redextape-core::viewmodel_contract every_asm_list_stops_at_its_bound_and_reports_its_length` |
| A8 | `viewmodel.rs`: `words.iter().take(n).enumerate().map(|(i, w)| (*w, tags.get(i).copied().unwrap_or_default())).collect()` → `words.iter().take(n).map(|w| (*w, WordTag::Value)).collect()` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract every_word_in_an_asm_frame_carries_its_tag`, `redextape-core::viewmodel_contract asm_boxes_come_newest_first_with_every_box_a_box_register_names`, `redextape-core::viewmodel_contract asm_cells_come_newest_first_with_every_cell_a_list_register_names` |
| A9 | `viewmodel.rs`: `let (head_tag, tail_tag) = c.heap_tags().get(i).copied().unwrap_or_default();` → `let (tail_tag, head_tag) = c.heap_tags().get(i).copied().unwrap_or_default();` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract every_word_in_an_asm_frame_carries_its_tag`, `redextape-core::viewmodel_contract asm_cells_come_newest_first_with_every_cell_a_list_register_names` |
| A10 | `viewmodel.rs`: `saved: words(&tagged(&f.saved_locals, &f.saved_tags, window.locals)),` → `saved: words(&tagged(&f.saved_locals, &[], window.locals)),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract every_word_in_an_asm_frame_carries_its_tag` |
| A11 | `viewmodel.rs`: `AsmWord { word: word.to_string(), tag }` → `AsmWord { word: (word as f64).to_string(), tag }` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract an_asm_word_is_its_exact_decimal_text_up_to_a_saturated_u64` |
| A12 | `viewmodel.rs`: `.iter() ⏎             .rev() ⏎             .take(window.frames)` → `.iter() ⏎             .take(window.frames)` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract asm_frames_come_top_first_with_the_locals_saved_at_each_call` |
| A13 | `viewmodel.rs`: `named(WordTag::List)) ⏎             .into_iter() ⏎             .rev()` → `named(WordTag::List)) ⏎             .into_iter()` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract asm_cells_come_newest_first_with_every_cell_a_list_register_names`, `redextape-core::viewmodel_contract every_asm_list_stops_at_its_bound_and_reports_its_length` |
| A14 | `viewmodel.rs`: `let cells = shown(conses.len(), window.cells, named(WordTag::List))` → `let cells = shown(conses.len(), window.cells, named(WordTag::Box))` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract asm_cells_come_newest_first_with_every_cell_a_list_register_names` |
| A15 | `viewmodel.rs`: `let shown_regs = || locals.iter().chain(&args).chain([&rr]).copied();` → `let shown_regs = || locals.iter().chain([&rr]).copied();` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract asm_cells_come_newest_first_with_every_cell_a_list_register_names` |
| A16 | `viewmodel.rs`: `let named = |tag: WordTag| shown_regs().filter(move |(_, t)| *t == tag).map(|(w, _)| w);` → `let named = |_tag: WordTag| shown_regs().map(|(w, _)| w);` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract every_asm_list_stops_at_its_bound_and_reports_its_length`, `redextape-core::viewmodel_contract asm_cells_come_newest_first_with_every_cell_a_list_register_names` |
| A17 | `viewmodel.rs`: `let boxes = shown(held.len(), window.boxes, named(WordTag::Box))` → `let boxes = shown(held.len(), window.boxes, named(WordTag::List))` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract asm_boxes_come_newest_first_with_every_box_a_box_register_names` |
| A18 | `viewmodel.rs`: `Some(AsmBox { handle: i + 1, content: AsmWord::of(content, tag) })` → `Some(AsmBox { handle: i, content: AsmWord::of(content, tag) })` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract every_asm_list_stops_at_its_bound_and_reports_its_length`, `redextape-core::viewmodel_contract every_word_in_an_asm_frame_carries_its_tag`, `redextape-core::viewmodel_contract asm_boxes_come_newest_first_with_every_box_a_box_register_names` |
| A19 | `viewmodel.rs`: `wrote: c.wrote().map(reg_str),` → `wrote: c.wrote().map(|r| format!("{r:?}")),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract an_asm_frame_names_the_register_its_step_wrote_and_the_locals_its_frame_wrote` |
| A20 | `viewmodel.rs`: `written: c.written().iter().take(window.locals).copied().collect(),` → `written: c.locals().iter().take(window.locals).map(|_| true).collect(),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract an_asm_frame_names_the_register_its_step_wrote_and_the_locals_its_frame_wrote` |
| A21 | `viewmodel.rs`: `step: c.steps_taken(), ⏎             pc: c.pc(),` → `step: c.steps_taken().saturating_sub(1), ⏎             pc: c.pc(),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract an_asm_frame_names_the_register_its_step_wrote_and_the_locals_its_frame_wrote` |
| A22 | `viewmodel.rs`: `source_node: map.and_then(|m| m.asm_owner(c.pc())),` → `source_node: map.and_then(|m| m.asm_owner(c.pc() + 1)),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract an_asm_frames_source_node_is_the_owner_of_the_instruction_about_to_run` |
| A23 | `viewmodel.rs`: `source_node: map.and_then(|m| m.asm_owner(c.pc())),` → `source_node: map.and_then(|m| m.asm_owner[c.pc()]),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract an_asm_frames_source_node_is_the_owner_of_the_instruction_about_to_run` |
| A24 | `viewmodel.rs`: `AsmProgram { listing: p.code.iter().map(print_instr).collect(), labels: p.labels.clone() }` → `AsmProgram { listing: p.code.iter().map(|i| format!("{i:?}")).collect(), labels: p.labels.clone() }` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract asm_program_is_the_printers_listing_and_the_programs_labels` |
| A25 | `viewmodel.rs`: `AsmProgram { listing: p.code.iter().map(print_instr).collect(), labels: p.labels.clone() }` → `AsmProgram { listing: p.code.iter().map(print_instr).collect(), labels: Vec::new() }` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract asm_program_is_the_printers_listing_and_the_programs_labels` |
| A26 | `viewmodel.rs`: `pub struct AsmWord { ⏎     pub word: String,` → `pub struct AsmWord { ⏎     #[cfg_attr(feature = "serde", serde(rename = "text"))] ⏎     pub word: String,` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract an_asm_frame_crosses_as_json_with_words_as_strings` |
| A27 | `asm_cursor.rs`: `#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))] ⏎ pub enum WordTag {` → `#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))] ⏎ #[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))] ⏎ pub enum WordTag {` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract an_asm_frame_crosses_as_json_with_words_as_strings` |
| A28 | `viewmodel.rs`: `(i < len).then_some(i)` → `Some(i)` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core viewmodel::tests::a_word_past_the_heap_names_no_cell` |
| A29 | `viewmodel.rs`: `let i = usize::try_from(word.checked_sub(1)?).ok()?;` → `let i = usize::try_from(word.saturating_sub(1)).ok()?;` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core viewmodel::tests::a_word_past_the_heap_names_no_cell` |
| A30 | `viewmodel.rs`: `` /// Instructions completed — `AsmCursor::steps_taken`. ⏎     #[cfg_attr(feature = "ts", ts(type = "number"))] `` → `` /// Instructions completed — `AsmCursor::steps_taken`. `` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features ts --no-fail-fast -E 'binary(ts_bindings)'` | `redextape-core::ts_bindings no_generated_type_carries_bigint` |
| A31 | `viewmodel.rs`: `None | Some(AsmStatus::Capped(_)) => Some(c.pc()),` → `None => Some(c.pc()), ⏎                 Some(AsmStatus::Capped(_)) => None,` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract an_asm_frames_next_is_the_instruction_about_to_run_until_the_run_ends` |
| A32 | `viewmodel.rs`: `Some(AsmStatus::Halted | AsmStatus::Faulted(_)) => None,` → `Some(AsmStatus::Halted | AsmStatus::Faulted(_)) => Some(c.pc()),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --features serde --no-fail-fast` | `redextape-core::viewmodel_contract an_asm_frames_next_is_the_instruction_about_to_run_until_the_run_ends` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
Core's view model carries the asm machine: `AsmState` is the asm cursor cut to a window the renderer sets, and `AsmProgram` its listing

Every per-step type that crosses to JavaScript is declared in
`viewmodel.rs`, so the asm frame is too (spec amendment 6). Each list a
run can grow stops at a bound `AsmWindow` supplies and reports the
length it was cut from: locals, arguments, top-first call frames, and
the newest cells and boxes, plus every cell or box a register on screen
names, so the heap panel's back-reference is whole. A word crosses as
its decimal text, since `serde-wasm-bindgen` refuses a `u64` past 2^53,
and `next` names the instruction about to run until the run halts or
faults. `WordTag` and `AsmCap` take the serde and ts derives, and
`reg_str` becomes `pub(crate)` so `wrote` spells a register as the
listing does.
````


---

### Task 5: The wasm session runs asm as a third leg: `compile` runs the program to its end, and six methods read and drive a cursor over it

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs`, `crates/redextape-wasm/src/lib.rs`, `crates/redextape-wasm/Cargo.toml` (a note), `crates/redextape-core/src/tm/asm.rs` (a doc), `scripts/build-web-bindings.sh`, `README.md` (the browser-test count)
- Modify (tests): `crates/redextape-wasm/tests/browser.rs`, `crates/redextape-wasm/tests/ts_bindings.rs`

**Interfaces:**
- Produces on `Session`: `asm_status() -> AsmStatus` (`asmStatus`), `asm_program()` (`asmProgram`), `step_asm()` (`stepAsm`), `asm_state(AsmWindow)` (`asmState(window)`, a JS object), `raise_asm_cap(u64)` (`raiseAsmCap(u32)`), `asm_value() -> Decoded` (`asmValue`); `SessionError::AsmAbsent`.
- Produces the wire type `AsmStatus { available, reason, run: Option<RunStatus>, cap: Option<AsmCap>, total_steps: Option<u64> }`, generated as `web/bindings/AsmStatus.ts`. `run` is `Ended` for a halt and for a fault; `cap` names the cap when `run` is `Capped`.
- `linkIndex(budget)` gains `asmOwner: Int32Array`, `-1` for an instruction `defunc` minted.
- A fault's value is `Decoded::Fault { message: "head of empty list at pc1" }` (amendment 15).

**ONE LOWERING FOR THE LEG, AND `compile` RUNS IT TO ITS END (amendment 13).** `compile` lowers with `tm::lower_program` — a third lowering per compile, and `sourcemap.rs`'s `asm_owner_covers_the_program_lower_program_returns` holds that the map's `asm_owner` indexes this program — drives a cursor over it under `DEFAULT_CAPS`, and keeps how that run ended: its outcome, its fault, or its cap. The recorded leg is a fresh cursor at step 0, as TM's is. `asm_value` answers from compile's run, and after a raised step cap from the cursor, whose heap it copies to decode. asm is absent only when lowering fails: a program the TM declines — too large, or overflowing — still has an asm leg.

**THE BINDINGS BUILD HAD TO LEARN THAT ONE TYPE CAN COME FROM TWO CRATES.** `AsmStatus` names core's `AsmCap`, and ts-rs writes a dependency's file with its dependent, so `AsmCap.ts` comes out of both crates; `build-web-bindings.sh` refused any basename both wrote, and every web commit's hook runs it. It now drops the wasm crate's copy when the two files agree to the byte, and still refuses two different types of one name (what the prototype found, 5).

**THE RUNAWAY FIXTURE COSTS A WHOLE STEP CAP.** `let mut n = 1; while n > 0 { n = n + 1; } n` never halts, so compile's asm run spends all 5,000,000 steps, which made a compile of it 34.6 ms slower in the browser (14.2 → 48.8 ms, amendment 16; the appendix has the probe).

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=5
diff --git a/crates/redextape-wasm/src/session.rs b/crates/redextape-wasm/src/session.rs
index a012330..d733435 100644
--- a/crates/redextape-wasm/src/session.rs
+++ b/crates/redextape-wasm/src/session.rs
@@ -1778,6 +1778,7 @@ mod tests {
     fn every_session_error_says_what_went_wrong() {
         assert!(SessionError::LambdaAbsent.to_string().contains("lambdaStatus"), "point the caller at the reason");
         assert!(SessionError::TmAbsent.to_string().contains("tmStatus"));
+        assert!(SessionError::AsmAbsent.to_string().contains("asmStatus"));
         let msg = SessionError::NoSuchTape { tape: 9, tapes: 5 }.to_string();
         assert!(msg.contains('9') && msg.contains('5'), "name both the index asked for and the count: {msg}");
     }
@@ -2470,7 +2471,7 @@ mod tests {
     #[test]
     fn a_raised_tm_cap_driven_to_a_halt_answers_what_the_status_claims() {
         let caps = tm::TmCaps { steps: 10, cells: tm::TM_DEFAULT_CAPS.cells };
-        let mut s = Session::compile_with_caps("[1, 2, 3]", EncodingKind::Unary, caps)
+        let mut s = Session::compile_with_caps("[1, 2, 3]", EncodingKind::Unary, caps, tm::asm::DEFAULT_CAPS)
             .session
             .expect("a capped run yields a working session, which is the point of the HitCap arm");
         assert!(s.final_tapes.is_none(), "a capped compile reached no final configuration to record");
@@ -2505,6 +2506,249 @@ mod tests {
         assert_eq!(s.tm_value(), Err(SessionError::TmAbsent));
     }
 
+    // --- the asm leg --------------------------------------------------------------------------
+
+    /// The window every asm test reads through: larger than any program below, so a frame is the whole
+    /// machine unless a test says otherwise.
+    const ASM_WHOLE: AsmWindow = AsmWindow { locals: 64, args: 16, frames: 8, cells: 16, boxes: 16 };
+
+    /// A runaway counter: it never halts, the TM declines it as overflowing every width, and the asm leg
+    /// spends its whole step cap on it at compile time.
+    const RUNAWAY: &str = "let mut n = 1; while n > 0 { n = n + 1; } n";
+
+    /// `compile` with `asm_caps` for the asm run and the TM's default for the TM run.
+    fn compile_asm_capped(src: &str, asm_caps: tm::asm::Caps) -> Session {
+        Session::compile_with_caps(src, EncodingKind::Unary, tm::TM_DEFAULT_CAPS, asm_caps).session.expect("compiles")
+    }
+
+    /// Step the asm cursor until it stops, and say how many steps it took.
+    fn run_asm_out(s: &mut Session) -> u64 {
+        let mut steps = 0;
+        while s.step_asm().expect("asm available") {
+            steps += 1;
+        }
+        steps
+    }
+
+    /// `total_steps` is the whole run's length and `run` is where the cursor stands, as on the TM leg: the
+    /// sample's 5 instructions are known before the cursor moves, the cursor reaches exactly that many,
+    /// and the total does not move with it. No cap is named beside a running or ended cursor.
+    #[test]
+    fn the_asm_status_reports_the_whole_runs_length_alongside_the_cursors_position() {
+        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
+        let before = AsmStatus {
+            available: true,
+            reason: String::new(),
+            run: Some(RunStatus::Running),
+            cap: None,
+            total_steps: Some(5),
+        };
+        assert_eq!(s.asm_status(), before, "the whole run's length, and a cursor that has not moved");
+        assert_eq!(run_asm_out(&mut s), 5, "the cursor reaches the length compile's run reported");
+        assert_eq!(s.asm_status(), AsmStatus { run: Some(RunStatus::Ended), ..before }, "a halt is an end");
+    }
+
+    /// The asm leg's answer is known at step 0, from the run `compile` performed, and stays the same once
+    /// the cursor has run out — `tm_value`'s arrangement, not `lambda_value`'s.
+    #[test]
+    fn asm_value_answers_from_the_run_compile_already_performed() {
+        let mut s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
+        assert_eq!(s.asm_state(ASM_WHOLE).expect("asm available").step, 0, "the cursor has not moved");
+        assert_eq!(s.asm_value(), Ok(Decoded::Value { text: "42".to_string() }));
+        run_asm_out(&mut s);
+        assert_eq!(s.asm_value(), Ok(Decoded::Value { text: "42".to_string() }));
+    }
+
+    /// The asm leg agrees with the reference over the programs `all_three_legs_agree` runs, a list among
+    /// them, so the decode reads the heap as well as `rr`.
+    #[test]
+    fn the_asm_leg_agrees_with_the_reference() {
+        for src in ["let x = 40; x + 2", "[1, 2, 3]", "true", "1 + 2 * 3"] {
+            let s = Session::compile(src, EncodingKind::Unary).session.unwrap_or_else(|| panic!("{src} compiles"));
+            assert_eq!(s.asm_value(), Ok(s.evaluate()), "{src}: asm disagrees with the reference");
+        }
+    }
+
+    /// A program the TM declines as overflowing every width still lowers, so it has an asm leg, and a
+    /// program that never halts spends the whole step cap in `compile`: the total is the cap, 5,000,000,
+    /// and there is no value. The cursor runs to the same wall, where the status names the step cap, and a
+    /// raise lets it go on.
+    #[test]
+    fn a_runaway_loop_caps_the_asm_leg_on_steps_where_the_tm_declines() {
+        let mut s = Session::compile(RUNAWAY, EncodingKind::Unary).session.expect("compiles");
+        assert_eq!(s.tm.as_ref().err(), Some(&TmDecline::Overflow), "the TM declines this program");
+        let st = s.asm_status();
+        assert_eq!((st.available, st.run, st.cap), (true, Some(RunStatus::Running), None));
+        assert_eq!(st.total_steps, Some(tm::asm::DEFAULT_CAPS.steps), "compile's run spent the whole step cap");
+        assert_eq!(s.asm_value(), Ok(Decoded::Unfinished), "a capped compile has no value");
+
+        assert_eq!(run_asm_out(&mut s), tm::asm::DEFAULT_CAPS.steps, "the cursor stops at the same wall");
+        assert_eq!((s.asm_status().run, s.asm_status().cap), (Some(RunStatus::Capped), Some(AsmCap::Steps)));
+        s.raise_asm_cap(1).expect("asm available");
+        assert_eq!(s.step_asm(), Ok(true), "a step cap is the one a raise resumes");
+    }
+
+    /// A program the TM refuses to build — 33 multiplications, one past `MAX_MUL_INSTRS`, the fixture
+    /// `sourcemap.rs`'s `the_asm_half_survives_a_machine_the_tm_refuses` uses — still lowers, and runs.
+    #[test]
+    fn a_program_the_tm_refuses_to_build_keeps_its_asm_leg() {
+        let src = vec!["1"; 34].join(" * ");
+        let s = Session::compile(&src, EncodingKind::Unary).session.expect("compiles");
+        assert_eq!(s.tm.as_ref().err(), Some(&TmDecline::TooLarge), "the TM refuses this machine");
+        let st = s.asm_status();
+        assert_eq!((st.available, st.total_steps), (true, Some(68)));
+        assert_eq!(s.asm_value(), Ok(Decoded::Value { text: "1".to_string() }));
+    }
+
+    /// A program `tm::lower_program` refuses has no asm leg: the status says why and nothing else, and
+    /// every asm method answers `AsmAbsent`. A 2,048-element list literal nests past the lowering's depth
+    /// guard — the fixture `a_declined_tm_leg_reports_why_and_refuses_its_methods` uses — and the link
+    /// index has no asm column for it.
+    #[test]
+    fn a_program_that_does_not_lower_declines_the_asm_leg_and_refuses_its_methods() {
+        let src = format!("[{}]", (0..2048).map(|i| i.to_string()).collect::<Vec<_>>().join(", "));
+        let mut s = Session::compile(&src, EncodingKind::Unary).session.expect("a declined leg is still a session");
+        let reason = "the program nests deeper than the asm lowering guard allows".to_string();
+        assert_eq!(s.asm_status(), AsmStatus { available: false, reason, run: None, cap: None, total_steps: None });
+        assert_eq!(s.asm_program(), Err(SessionError::AsmAbsent));
+        assert_eq!(s.asm_state(ASM_WHOLE), Err(SessionError::AsmAbsent));
+        assert_eq!(s.step_asm(), Err(SessionError::AsmAbsent));
+        assert_eq!(s.raise_asm_cap(1), Err(SessionError::AsmAbsent));
+        assert_eq!(s.asm_value(), Err(SessionError::AsmAbsent));
+        assert!(s.link_index(65_536).asm_owner.is_empty(), "no program, no owners");
+    }
+
+    /// `defunc`'s refusal declines the asm leg too, in its own words: `t` is both called by name and passed as
+    /// a value, and its body applies its parameter at its own arity, closing a cycle through `t`'s dispatcher
+    /// — the shape `defunc.rs`'s module doc names first. The reference and λ legs run it; asm and TM cannot.
+    #[test]
+    fn a_program_defunc_refuses_declines_the_asm_leg_with_its_reason() {
+        let src = "fn inc(x) { x + 1 } fn t(g) { g(3) } fn ap(h, y) { h(y) } t(inc) + ap(t, inc)";
+        let s = Session::compile(src, EncodingKind::Unary).session.expect("compiles");
+        let st = s.asm_status();
+        assert_eq!(
+            (st.available, st.reason.as_str()),
+            (false, "the asm backend does not support cyclic higher-order call graph through `t`")
+        );
+        assert!(s.lambda_status().available, "the λ leg runs it, so the refusal is the asm lowering's own");
+    }
+
+    /// A stack, heap or memory cap ends the run as a cap that NAMES ITSELF, and no raise resumes it: `fact(3)`
+    /// under a two-frame stack, `[1, 2, 3]` under a one-cell heap, and `fact(3)` with no memory for a saved
+    /// frame. The cursor stops where `compile`'s run did, and the value stays `Unfinished` because there is
+    /// no end anywhere.
+    #[test]
+    fn a_hard_cap_names_itself_and_does_not_resume() {
+        let d = tm::asm::DEFAULT_CAPS;
+        let cases = [
+            (FACT3, tm::asm::Caps { stack: 2, ..d }, AsmCap::Stack),
+            ("[1, 2, 3]", tm::asm::Caps { heap: 1, ..d }, AsmCap::Heap),
+            (FACT3, tm::asm::Caps { mem: 0, ..d }, AsmCap::Mem),
+        ];
+        for (src, caps, cap) in cases {
+            let mut s = compile_asm_capped(src, caps);
+            let total = s.asm_status().total_steps;
+            assert_eq!(Some(run_asm_out(&mut s)), total, "{cap:?}: the cursor stops where compile's run did");
+            let capped = (Some(RunStatus::Capped), Some(cap));
+            assert_eq!((s.asm_status().run, s.asm_status().cap), capped, "{cap:?}");
+            s.raise_asm_cap(1_000_000).expect("asm available");
+            assert_eq!(s.step_asm(), Ok(false), "{cap:?}: more steps cannot resume it");
+            assert_eq!((s.asm_status().run, s.asm_status().cap), capped, "{cap:?}");
+            assert_eq!(s.asm_value(), Ok(Decoded::Unfinished), "{cap:?}");
+        }
+    }
+
+    /// A compile the step cap stopped has no value; the cursor reaches the same cap, a raise carries it to
+    /// the halt, and the value is then decoded from the CURSOR — including the heap, which `[1, 2, 3]`
+    /// needs and `compile`'s capped run never kept.
+    #[test]
+    fn a_raised_step_cap_carries_the_asm_cursor_to_a_value() {
+        let mut s = compile_asm_capped("[1, 2, 3]", tm::asm::Caps { steps: 3, ..tm::asm::DEFAULT_CAPS });
+        assert_eq!(s.asm_status().total_steps, Some(3), "a capped run's total is where the cap fired");
+        assert_eq!(s.asm_value(), Ok(Decoded::Unfinished));
+        assert_eq!(run_asm_out(&mut s), 3);
+        assert_eq!((s.asm_status().run, s.asm_status().cap), (Some(RunStatus::Capped), Some(AsmCap::Steps)));
+
+        s.raise_asm_cap(1_000_000).expect("asm available");
+        run_asm_out(&mut s);
+        assert_eq!((s.asm_status().run, s.asm_status().cap), (Some(RunStatus::Ended), None));
+        assert_eq!(s.asm_value(), Ok(Decoded::Value { text: "[1, 2, 3]".to_string() }));
+    }
+
+    /// A fault is an end and the leg's value, in spec §8's words: `head([])` types, and its `head` meets
+    /// `nil` at instruction 1. From `compile`'s run the value is there at step 0; the cursor ends
+    /// on the same fault; and a compile the step cap stopped short of it reaches it through a raise, with
+    /// the fault then read off the cursor.
+    #[test]
+    fn a_fault_ends_the_asm_run_and_is_its_value() {
+        let fault = Decoded::Fault { message: "head of empty list at pc1".to_string() };
+        let mut s = Session::compile("head([])", EncodingKind::Unary).session.expect("compiles");
+        assert_eq!(s.asm_value(), Ok(fault.clone()), "compile's run faulted");
+        run_asm_out(&mut s);
+        assert_eq!((s.asm_status().run, s.asm_status().cap), (Some(RunStatus::Ended), None), "a fault is an end");
+        assert_eq!(s.asm_value(), Ok(fault.clone()));
+
+        let mut s = compile_asm_capped("head([])", tm::asm::Caps { steps: 1, ..tm::asm::DEFAULT_CAPS });
+        assert_eq!(s.asm_value(), Ok(Decoded::Unfinished), "the cap stopped compile's run before the fault");
+        run_asm_out(&mut s);
+        s.raise_asm_cap(1_000_000).expect("asm available");
+        run_asm_out(&mut s);
+        assert_eq!(s.asm_value(), Ok(fault), "the cursor's own fault, in the same words");
+    }
+
+    /// `|x| x + 1` types as a function, which `decode_asm_ty` has no value for, and the asm leg lowers and
+    /// runs it to a halt — so its value is `Undecodable`, the fixture `a_function_valued_program_decodes_as
+    /// _undecodable_on_both_legs` uses for the other two.
+    #[test]
+    fn a_function_valued_program_decodes_as_undecodable_on_the_asm_leg() {
+        let s = Session::compile("|x| x + 1", EncodingKind::Unary).session.expect("compiles");
+        assert!(s.asm_status().available, "the asm lowering accepts this — against a decline this proves nothing");
+        assert_eq!(s.asm_value(), Ok(Decoded::Undecodable));
+    }
+
+    /// A value `decode_asm_ty` builds but `decoded_value` refuses to print: every suffix of a 5,000-element
+    /// list shares its cells, so the decode is small in memory and about 25 million nodes printed, past
+    /// `MAX_PRINT_NODES`. The TM run is capped at ten steps, since the TM would otherwise simulate this for
+    /// its whole budget; the asm run is not.
+    #[test]
+    fn asm_value_reports_too_large_to_print_for_a_logically_enormous_decode() {
+        let src = "fn upto(n) { if n == 0 { nil } else { cons(n, upto(n - 1)) } } \
+                   fn tails(xs) { if is_empty(xs) { nil } else { cons(xs, tails(tail(xs))) } } tails(upto(5000))";
+        let tm_caps = tm::TmCaps { steps: 10, ..tm::TM_DEFAULT_CAPS };
+        let s = Session::compile_with_caps(src, EncodingKind::Unary, tm_caps, tm::asm::DEFAULT_CAPS)
+            .session
+            .expect("compiles");
+        assert_eq!(s.asm_status().run, Some(RunStatus::Running), "the leg is there");
+        assert_eq!(s.asm_value(), Ok(Decoded::TooLargeToPrint));
+    }
+
+    /// The frame at step 0 and at the end, through the session: nothing written, instruction 0 about to run
+    /// and owned by the literal `40`; then `rr` holding 42 and nothing left to run.
+    #[test]
+    fn the_asm_state_windows_the_cursor_and_names_its_owner() {
+        let src = "let x = 40; x + 2";
+        let mut s = Session::compile(src, EncodingKind::Unary).session.expect("compiles");
+        let st = s.asm_state(ASM_WHOLE).expect("asm available");
+        assert_eq!((st.step, st.pc, st.next, st.wrote), (0, 0, Some(0), None));
+        let owner = st.source_node.and_then(|n| s.source_span(n)).map(|sp| &src[sp.start..sp.end]);
+        assert_eq!(owner, Some("40"), "instruction 0's owner, through the session's own map");
+
+        run_asm_out(&mut s);
+        let end = s.asm_state(ASM_WHOLE).expect("asm available");
+        assert_eq!((end.step, end.rr.word.as_str(), end.next), (5, "42", None));
+    }
+
+    /// The link index carries one asm owner per instruction the listing prints, and every instruction of a
+    /// first-order program has one.
+    #[test]
+    fn the_link_index_carries_one_owner_per_listed_instruction() {
+        let s = Session::compile(FACT3, EncodingKind::Unary).session.expect("compiles");
+        let listing = s.asm_program().expect("asm available").listing;
+        let owners = s.link_index(65_536).asm_owner;
+        assert_eq!(owners.len(), listing.len());
+        assert!(owners.iter().all(|o| *o >= 0), "a first-order program owns every instruction: {owners:?}");
+    }
+
     // --- the TM scratchpad -----------------------------------------------------------------------
 
     /// A hand-written unary incrementer with NO header — δ and a start state and nothing else, which is
@@ -3241,7 +3485,7 @@ state halt: accept
             ("let x = 40; x + 2", EncodingKind::Unary, capped, false),
             (higher, EncodingKind::Unary, tm::TM_DEFAULT_CAPS, true),
         ] {
-            let s = Session::compile_with_caps(src, kind, caps).session.expect("compiles");
+            let s = Session::compile_with_caps(src, kind, caps, tm::asm::DEFAULT_CAPS).session.expect("compiles");
             let program = s.tm_program().expect("the TM leg runs this");
             if widens {
                 assert!(program.width > tm::MIN_FIELD_WIDTH, "{src} {kind:?}: fits at the narrowest width");
diff --git a/crates/redextape-wasm/tests/browser.rs b/crates/redextape-wasm/tests/browser.rs
index 7d9c96a..2a607c2 100644
--- a/crates/redextape-wasm/tests/browser.rs
+++ b/crates/redextape-wasm/tests/browser.rs
@@ -31,8 +31,8 @@
 //!
 //! THE EXPECTED VALUES ARE PINNED IN `session.rs`'s NATIVE TESTS TOO, deliberately: "the values that
 //! come back are the ones a native run produces" is only a claim if both sides name the same numbers.
-//! `let x = 40; x + 2` reduces in 7 β-steps to Church 42 and runs 2,870 δ-steps on a 5-tape machine of
-//! 123 states fitted to width 64.
+//! `let x = 40; x + 2` reduces in 7 β-steps to Church 42, runs 2,870 δ-steps on a 5-tape machine of
+//! 123 states fitted to width 64, and runs 5 asm instructions.
 
 // Test target: `wasm_bindgen_test` functions are not `#[test]` functions, so `clippy.toml`'s
 // `allow-expect-in-tests` does not reach them, and neither it nor `allow-panic-in-tests` reaches the
@@ -922,7 +922,7 @@ fn tape_names_are_five_strings_in_tape_order() {
     assert_eq!(names.get(4).as_string().as_deref(), Some("BOX"));
 }
 
-/// Task 6: `linkIndex(byteBudget)` must cross as one string, one boolean, and TEN TYPED ARRAYS — never
+/// Task 6: `linkIndex(byteBudget)` must cross as one string, one nullable cut, and ELEVEN TYPED ARRAYS — never
 /// as serde's arrays-of-objects. That trade is measured, not stylistic: `list60`'s index is 552 KB as
 /// objects against ~220 KB as typed arrays, and `prog200`'s is 1.9 MB against ~689 KB. A plain JS
 /// `Array` would still satisfy a naive length check, which is why every field below is checked with
@@ -957,6 +957,7 @@ fn link_index_crosses_as_typed_arrays() {
         "lambdaSpanClass must be a Uint8Array"
     );
     assert!(get(&index, "tmOwner").is_instance_of::<js_sys::Int32Array>(), "tmOwner must be an Int32Array");
+    assert!(get(&index, "asmOwner").is_instance_of::<js_sys::Int32Array>(), "asmOwner must be an Int32Array");
 
     // The three legs must be internally consistent: every triad's three columns share one length, and
     // `tmOwner`'s length is checked against a count obtained INDEPENDENTLY rather than merely positive
@@ -984,6 +985,13 @@ fn link_index_crosses_as_typed_arrays() {
         f64::from(states.length()),
         "tmOwner must have exactly one entry per state tmProgram reports, obtained independently"
     );
+    let asm_program = call(&session, "asmProgram", &[]);
+    let listing: Array = get(&asm_program, "listing").unchecked_into();
+    assert_eq!(
+        len("asmOwner"),
+        f64::from(listing.length()),
+        "asmOwner must have exactly one entry per instruction asmProgram lists, obtained independently"
+    );
 }
 
 /// Task 6, Fix 2: `Session::link_index`'s own doc calls it "total over either absence" -- a declined λ
@@ -1026,6 +1034,7 @@ fn link_index_survives_a_declined_lambda_leg() {
     }
     assert!(len("sourceNodeStart") > 0.0, "the source leg does not depend on the λ backend");
     assert!(len("tmOwner") > 0.0, "the TM leg compiled fine and owns at least one state");
+    assert!(len("asmOwner") > 0.0, "the program lowers to asm, so its instructions have owners too");
 }
 
 /// n=2,900 rather than the investigation's 2,690, because THIS test runs on the page thread, whose
@@ -1329,3 +1338,124 @@ mod scratch_methods_that_must_not_exist {
     }
     const _: fn(&redextape_wasm::TmScratch) -> (Absent, Absent, Absent) = tm_scratch_has_none_of_them;
 }
+
+/// An `AsmWindow` as a renderer builds one: a plain JS object with five named counts.
+fn asm_window(locals: u32, args: u32, frames: u32, cells: u32, boxes: u32) -> JsValue {
+    let w = Object::new();
+    for (k, v) in [("locals", locals), ("args", args), ("frames", frames), ("cells", cells), ("boxes", boxes)] {
+        Reflect::set(&w, &JsValue::from_str(k), &JsValue::from_f64(f64::from(v))).unwrap();
+    }
+    w.into()
+}
+
+/// The asm leg through the glue, every method a renderer calls, on the sample `session.rs` pins natively:
+/// 5 instructions over a 5-line listing, ending with 42 in `rr`.
+///
+/// **THE WIRE SHAPES, MEASURED RATHER THAN DESIGNED**: counts cross as numbers and a missing one as `null`
+/// (`cap`, `wrote`, `next` at the end); a word crosses as a STRING and its tag as the variant's name, which
+/// is `AsmWord`'s whole argument; the value is `Decoded`'s tagged object; `raiseAsmCap` takes a plain
+/// number, so the call succeeding is that assertion (a `u64` parameter would throw converting it to a
+/// `BigInt`); and `asmState` takes the window as a JS object, which a malformed one makes it throw.
+#[wasm_bindgen_test]
+fn the_asm_leg_crosses_the_boundary() {
+    let (_, session) = compile("let x = 40; x + 2");
+
+    let status = call(&session, "asmStatus", &[]);
+    assert_eq!(get(&status, "available"), JsValue::TRUE);
+    assert_eq!(get(&status, "reason").as_string().as_deref(), Some(""));
+    assert_eq!(get(&status, "run").as_string().as_deref(), Some("Running"), "a fresh cursor has not ended");
+    assert!(get(&status, "cap").is_null(), "no cap beside a running cursor, and `None` crosses as null");
+    assert_eq!(num(&status, "total_steps"), 5.0, "the whole run's length, from compile's own run");
+
+    let program = call(&session, "asmProgram", &[]);
+    let listing: Array = get(&program, "listing").unchecked_into();
+    assert_eq!(listing.length(), 5, "one line per instruction");
+    assert_eq!(listing.get(0).as_string().as_deref(), Some("li\tr0, #40"), "`print_instr`'s text, tab and all");
+    assert!(get(&program, "labels").is_instance_of::<Array>(), "no labels still crosses as an array");
+
+    let window = asm_window(64, 16, 8, 16, 16);
+    let first = call(&session, "asmState", std::slice::from_ref(&window));
+    assert_eq!((num(&first, "step"), num(&first, "pc"), num(&first, "next")), (0.0, 0.0, 0.0));
+    assert!(get(&first, "wrote").is_null(), "nothing written before the first step");
+    assert!(get(&first, "source_node").as_f64().is_some(), "instruction 0's owner crosses as a number");
+    let rr = get(&first, "rr");
+    assert_eq!(get(&rr, "word").as_string().as_deref(), Some("0"), "a word is a string");
+    assert_eq!(get(&rr, "tag").as_string().as_deref(), Some("Value"), "a tag is its variant's name");
+    for list in ["locals", "written", "args", "frames", "cells", "boxes"] {
+        assert!(get(&first, list).is_instance_of::<Array>(), "{list} crosses as an array");
+    }
+
+    let mut steps = 0;
+    while call(&session, "stepAsm", &[]) == JsValue::TRUE {
+        steps += 1;
+        assert!(steps <= 100, "this program halts in 5 instructions");
+    }
+    assert_eq!(steps, 5, "the instruction count crosses the boundary intact");
+    let ended = call(&session, "asmStatus", &[]);
+    assert_eq!(get(&ended, "run").as_string().as_deref(), Some("Ended"), "halted, not capped");
+
+    let last = call(&session, "asmState", &[window]);
+    assert_eq!(num(&last, "step"), 5.0);
+    assert_eq!(get(&get(&last, "rr"), "word").as_string().as_deref(), Some("42"));
+    assert!(get(&last, "next").is_null(), "a halted run has nothing left to run, and says so as null");
+
+    let value = call(&session, "asmValue", &[]);
+    assert_eq!(get(&get(&value, "Value"), "text").as_string().as_deref(), Some("42"), "got {value:?}");
+    call(&session, "raiseAsmCap", &[JsValue::from_f64(1000.0)]);
+
+    let no_boxes = asm_window(1, 1, 1, 1, 1);
+    Reflect::delete_property(no_boxes.unchecked_ref::<Object>(), &JsValue::from_str("boxes")).unwrap();
+    let f: Function = get(&session, "asmState").unchecked_into();
+    for bad in [JsValue::from_str("64"), no_boxes] {
+        let args = Array::new();
+        args.push(&bad);
+        assert!(Reflect::apply(&f, &session, &args).is_err(), "asmState must refuse {bad:?}");
+    }
+}
+
+/// `x` squared seven times: 2^128, which `mul` saturates to `u64::MAX` on its seventh square.
+const SATURATES: &str = "let mut x = 2; let mut i = 0; while i < 7 { x = x * x; i = i + 1; } x";
+
+/// A saturated register crosses whole. `x` squares itself seven times, past 2^64, where `mul` saturates at
+/// `u64::MAX`; as a JS number that word would not survive `serde-wasm-bindgen`, which refuses a `u64` above
+/// `Number.MAX_SAFE_INTEGER` (spec amendment 13), so this frame reaching JavaScript at all is half the
+/// assertion and the exact twenty digits are the other half.
+#[wasm_bindgen_test]
+fn a_saturated_word_crosses_as_its_exact_decimal_text() {
+    let (_, session) = compile(SATURATES);
+    while call(&session, "stepAsm", &[]) == JsValue::TRUE {}
+    let st = call(&session, "asmState", &[asm_window(64, 16, 8, 16, 16)]);
+    assert_eq!(get(&get(&st, "rr"), "word").as_string().as_deref(), Some("18446744073709551615"));
+    let value = call(&session, "asmValue", &[]);
+    assert_eq!(get(&get(&value, "Value"), "text").as_string().as_deref(), Some("18446744073709551615"));
+}
+
+/// A program the asm lowering refuses: the status says why with every other field `null`, and every asm
+/// method throws rather than aborting the module. A 2,048-element list literal nests past the lowering's
+/// depth guard.
+#[wasm_bindgen_test]
+fn a_declined_asm_leg_reports_why_and_its_methods_throw() {
+    let src = format!("[{}]", (0..2048).map(|i| i.to_string()).collect::<Vec<_>>().join(", "));
+    let (diagnostics, session) = compile(&src);
+    assert_eq!(diagnostics.length(), 0, "well-formed; only the backends refuse it");
+    let status = call(&session, "asmStatus", &[]);
+    assert_eq!(get(&status, "available"), JsValue::FALSE);
+    assert!(get(&status, "reason").as_string().is_some_and(|r| !r.is_empty()), "the reason survives the crossing");
+    for field in ["run", "cap", "total_steps"] {
+        assert!(get(&status, field).is_null(), "{field} is null for an absent leg, got {:?}", get(&status, field));
+    }
+    for (method, arg) in [
+        ("asmProgram", None),
+        ("stepAsm", None),
+        ("asmState", Some(asm_window(64, 16, 8, 16, 16))),
+        ("raiseAsmCap", Some(JsValue::from_f64(1.0))),
+        ("asmValue", None),
+    ] {
+        let f: Function = get(&session, method).unchecked_into();
+        let args = Array::new();
+        if let Some(a) = arg {
+            args.push(&a);
+        }
+        assert!(Reflect::apply(&f, &session, &args).is_err(), "{method} must throw for an absent leg");
+    }
+}
diff --git a/crates/redextape-wasm/tests/ts_bindings.rs b/crates/redextape-wasm/tests/ts_bindings.rs
index 0a9c338..ecfd427 100644
--- a/crates/redextape-wasm/tests/ts_bindings.rs
+++ b/crates/redextape-wasm/tests/ts_bindings.rs
@@ -24,17 +24,20 @@ use std::path::Path;
 use redextape_test_support::ts_derive_scan::{
     assert_overrides_match_field_nullability, ts_deriving_type_names_in_crate, without_doc_comments,
 };
-use redextape_wasm::{Decoded, LambdaStatus, ReductionStatus, RunStatus, TmScratchStatus, TmStatus, ValueRun};
+use redextape_wasm::{
+    AsmStatus, Decoded, LambdaStatus, ReductionStatus, RunStatus, TmScratchStatus, TmStatus, ValueRun,
+};
 use ts_rs::TS;
 
 /// Every type in this crate carrying `#[ts(export)]`, paired with the file it generates.
 ///
-/// **SEVEN, AND NONE OF CORE'S ARE AMONG THEM.** Each crate's gate covers its own
+/// **EIGHT, AND NONE OF CORE'S ARE AMONG THEM.** Each crate's gate covers its own
 /// derive sites, because `ts_deriving_type_names_in_crate` scans one crate root and a type declared
 /// in the other one is invisible to it from here. That is the correct division: a core type added
 /// without an entry in core's `generated()` fails core's gate, not this one.
 fn generated() -> Vec<(&'static str, String)> {
     vec![
+        ("AsmStatus", AsmStatus::export_to_string().unwrap()),
         ("Decoded", Decoded::export_to_string().unwrap()),
         ("LambdaStatus", LambdaStatus::export_to_string().unwrap()),
         ("ReductionStatus", ReductionStatus::export_to_string().unwrap()),
````


- [ ] **Step 2: Run them and see them fail.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast`

Expected: exit 101, printing:

```text
    error[E0425]: cannot find type `AsmWindow` in this scope
    error[E0422]: cannot find struct, variant or union type `AsmWindow` in this scope
    error[E0422]: cannot find struct, variant or union type `AsmStatus` in this scope
    error[E0422]: cannot find struct, variant or union type `AsmStatus` in this scope
    error[E0422]: cannot find struct, variant or union type `AsmStatus` in this scope
    error[E0599]: no variant, associated function, or constant named `AsmAbsent` found for enum `session::SessionError` in the current scope
    error[E0061]: this function takes 3 arguments but 4 arguments were supplied
    error[E0061]: this function takes 3 arguments but 4 arguments were supplied
    error[E0599]: no method named `step_asm` found for mutable reference `&mut session::Session` in the current scope
    error[E0599]: no method named `asm_status` found for struct `session::Session` in the current scope
    error[E0599]: no method named `asm_status` found for struct `session::Session` in the current scope
    error[E0599]: no method named `asm_state` found for struct `session::Session` in the current scope
    … and 28 more lines
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=5
diff --git a/README.md b/README.md
index 707d2e9..dfc8a8c 100644
--- a/README.md
+++ b/README.md
@@ -286,7 +286,7 @@ figures above read 841/716/48 until 2026-08-24, having drifted by 315 tests and
 from the breakdown entirely. Recount rather than trust them.
 
 **Two tiers sit outside that count**, because neither runs under `cargo nextest`. The wasm boundary
-has **27** browser tests (`wasm-pack test --headless --chrome crates/redextape-wasm`), run by CI's
+has **30** browser tests (`wasm-pack test --headless --chrome crates/redextape-wasm`), run by CI's
 `rust-browser` job. `web/` has **246** of its own across two Vitest projects — 187 in Node for the
 pure modules, 59 in real Chromium for the worker and the app end to end — run by CI's `web` job
 under the coverage gate. Recount with `pnpm test`.
diff --git a/crates/redextape-core/src/tm/asm.rs b/crates/redextape-core/src/tm/asm.rs
index c2a955c..e2e1345 100644
--- a/crates/redextape-core/src/tm/asm.rs
+++ b/crates/redextape-core/src/tm/asm.rs
@@ -729,8 +729,8 @@ fn spend(budget: &mut usize) -> Result<(), DecodeFailure> {
 /// value-directed). Drives off the static `Ty` instead of a reference `Value`, so the standalone
 /// binary can decode without a reference run. Returns `None` on a representation mismatch, a
 /// non-value type (`Fun`/`Var`), or an exhausted `MAX_DECODE_NODES` budget — `decode_asm_ty_reason`'s
-/// `.ok()`, for the many existing callers (`redextape-wasm`, `redextape-native-rt`, the `.asm`
-/// example, and this module's own tests) that only need to know THAT it failed, not why.
+/// `.ok()`, for the callers (`redextape-wasm`'s asm value, `redextape-native-rt`, and this module's own
+/// tests) that only need to know THAT it failed, not why.
 #[must_use]
 pub fn decode_asm_ty(outcome: &AsmOutcome, ty: &Ty) -> Option<Value> {
     decode_asm_ty_reason(outcome, ty).ok()
diff --git a/crates/redextape-wasm/Cargo.toml b/crates/redextape-wasm/Cargo.toml
index 789d6ba..d0ddaf4 100644
--- a/crates/redextape-wasm/Cargo.toml
+++ b/crates/redextape-wasm/Cargo.toml
@@ -33,14 +33,15 @@ ts-rs = { version = "10", optional = true }
 
 [features]
 # Forwards to core's so `ts` is ONE switch: without it, a run that enabled the feature only here would
-# compile derives for this crate's seven wire types and silently leave core's out of that run.
+# compile derives for this crate's eight wire types and silently leave core's out of that run.
 #
-# IT IS NOT LOAD-BEARING FOR IMPORTS TODAY, AND SAYING SO IS THE POINT. Across all seven types declared
-# here, every field's type is `bool`, `String`, `Vec<String>`, `usize`, `u64`, the wasm-local `RunStatus` or
-# `ReductionStatus`, or `NodeId` — each of those bare or under one `Option` — and `NodeId` is a transparent
-# alias for `u32`, so it inlines as a TypeScript `number` and generates no import at all. The first field here that names a core STRUCT or ENUM is what would make this line
-# load-bearing for imports; until then it keeps the feature switch coherent. An earlier draft of this
-# comment asserted the dangling-import hazard as the reason, and a review found no instance of it.
+# IT IS LOAD-BEARING FOR IMPORTS NOW, AND `AsmStatus::cap` IS WHY. That field is an `Option<AsmCap>`, core's
+# enum, so the generated `AsmStatus.ts` imports `./AsmCap` — and without core's `ts` switched on by this
+# line `AsmCap` has no `TS` impl and this crate's `ts` build does not compile. Every other field across the
+# eight types is `bool`, `String`, `Vec<String>`, `usize`, `u64`, the wasm-local `RunStatus` or
+# `ReductionStatus`, or `NodeId` — each bare or under one `Option` — and `NodeId` is a transparent alias for
+# `u32`, which inlines as a TypeScript `number`. An earlier version of this comment said no field named a
+# core type yet, which was true until the asm leg.
 ts = ["dep:ts-rs", "redextape-core/ts"]
 # SWITCHES OFF THE SIZE CHECK IN `tm_scratch_with_caps` (`src/session.rs`), SO A TM SCRATCH PARSES TEXT OF ANY
 # LENGTH. It exists for one caller: `web`'s `test:probe:tm-buffer` script, which builds this crate with it into
diff --git a/crates/redextape-wasm/src/lib.rs b/crates/redextape-wasm/src/lib.rs
index a5aea85..9153c7a 100644
--- a/crates/redextape-wasm/src/lib.rs
+++ b/crates/redextape-wasm/src/lib.rs
@@ -15,9 +15,9 @@
 
 mod session;
 
-/// The seven wire types this crate declares, re-exported for `tests/ts_bindings.rs`.
+/// The eight wire types this crate declares, re-exported for `tests/ts_bindings.rs`.
 ///
-/// **FEATURE-GATED, AND NARROWED TO SEVEN NAMES, BECAUSE IT EXISTS FOR A GATE.** `mod session` is
+/// **FEATURE-GATED, AND NARROWED TO EIGHT NAMES, BECAUSE IT EXISTS FOR A GATE.** `mod session` is
 /// private and stays private: `Session`, `Compiled`, `TmScratch` and the rest are this crate's
 /// internals, reached from JavaScript through `#[wasm_bindgen]` rather than from Rust. But the two
 /// fidelity gates are integration tests, and an integration test links against this crate the way any
@@ -27,7 +27,7 @@ mod session;
 /// canonical-line check. Under default features — which is every browser build — this line does not
 /// exist.
 #[cfg(feature = "ts")]
-pub use session::{Decoded, LambdaStatus, ReductionStatus, RunStatus, TmScratchStatus, TmStatus, ValueRun};
+pub use session::{AsmStatus, Decoded, LambdaStatus, ReductionStatus, RunStatus, TmScratchStatus, TmStatus, ValueRun};
 
 use redextape_core::tm::EncodingKind;
 use serde::Serialize;
@@ -38,7 +38,7 @@ pub fn init() {
     console_error_panic_hook::set_once();
 }
 
-/// A compiled program with both legs already built. Owns the cursors; every method below reads or
+/// A compiled program with every leg already built. Owns the cursors; every method below reads or
 /// advances them.
 #[wasm_bindgen]
 pub struct Session(session::Session);
@@ -326,11 +326,11 @@ pub fn tape_names() -> Result<JsValue, JsValue> {
 /// below shares, so no method invents its own wording and none of them can panic instead.
 ///
 /// TAKES `SessionError` BY VALUE, AND NOT BECAUSE IT NEEDS TO CONSUME IT: this is used as a bare
-/// function item at every one of its twelve call sites below (`.map_err(err)`), which requires
+/// function item at every one of its call sites below (`.map_err(err)`), which requires
 /// `FnOnce(SessionError) -> JsValue` — a `&SessionError`-taking version does not satisfy that and
-/// would force a closure (`.map_err(|e| err(&e))`) at all twelve. `SessionError` is a small,
-/// cheap-to-copy enum (two unit variants and one `{ usize, usize }`), so there is no cost this would
-/// actually save; the twelve-site churn for a private helper is not worth it.
+/// would force a closure (`.map_err(|e| err(&e))`) at every one. `SessionError` is a small,
+/// cheap-to-copy enum (unit variants and one `{ usize, usize }`), so there is no cost this would
+/// actually save; the churn at every site for a private helper is not worth it.
 #[allow(clippy::needless_pass_by_value)]
 fn err(e: session::SessionError) -> JsValue {
     JsValue::from_str(&e.to_string())
@@ -562,6 +562,75 @@ impl Session {
         to_value(&self.0.tm_value().map_err(err)?)
     }
 
+    // --- the asm leg --------------------------------------------------------------------------
+
+    /// # Errors
+    ///
+    /// Returns `Err` only if `to_value` cannot marshal the status to a JS value; not expected for this
+    /// crate's own types.
+    #[wasm_bindgen(js_name = asmStatus)]
+    pub fn asm_status(&self) -> Result<JsValue, JsValue> {
+        to_value(&self.0.asm_status())
+    }
+
+    /// # Errors
+    ///
+    /// Returns `Err` when this session's asm leg is absent — check `asmStatus().available` first.
+    #[wasm_bindgen(js_name = asmProgram)]
+    pub fn asm_program(&self) -> Result<JsValue, JsValue> {
+        let p = self.0.asm_program().map_err(err)?;
+        to_value(&p)
+    }
+
+    /// # Errors
+    ///
+    /// Returns `Err` when this session's asm leg is absent — check `asmStatus().available` first. No
+    /// `to_value` call is involved: the return type is a bare `bool`.
+    #[wasm_bindgen(js_name = stepAsm)]
+    pub fn step_asm(&mut self) -> Result<bool, JsValue> {
+        self.0.step_asm().map_err(err)
+    }
+
+    /// `asmState(window)` -> `AsmState`, where `window` is an `AsmWindow` — `{ locals, args, frames, cells,
+    /// boxes }`, each a count.
+    ///
+    /// **ONE OBJECT RATHER THAN FIVE NUMBERS**, read with `serde_wasm_bindgen::from_value`: five positional
+    /// counts are five chances to transpose two, and the names say which bound is which at the call site.
+    /// Deserializing it is marshalling, which is why it happens here and not in `session.rs`.
+    ///
+    /// # Errors
+    ///
+    /// Returns `Err` when this session's asm leg is absent, and when `window` is not an `AsmWindow` — a
+    /// missing field, or a count that is not a non-negative integer — with the deserializer's message.
+    #[wasm_bindgen(js_name = asmState)]
+    pub fn asm_state(&self, window: JsValue) -> Result<JsValue, JsValue> {
+        let window: redextape_core::viewmodel::AsmWindow = serde_wasm_bindgen::from_value(window)
+            .map_err(|e| JsValue::from_str(&format!("asmState: not an AsmWindow: {e}")))?;
+        let st = self.0.asm_state(window).map_err(err)?;
+        to_value(&st)
+    }
+
+    /// `u32` and widened, for the reason `raiseLambdaCap` above records.
+    ///
+    /// # Errors
+    ///
+    /// Returns `Err` when this session's asm leg is absent. Raising the cap on a run it cannot resume is
+    /// harmless, so this only ever fires for a session with no asm leg at all.
+    #[wasm_bindgen(js_name = raiseAsmCap)]
+    pub fn raise_asm_cap(&mut self, extra_steps: u32) -> Result<(), JsValue> {
+        self.0.raise_asm_cap(u64::from(extra_steps)).map_err(err)
+    }
+
+    /// # Errors
+    ///
+    /// Returns `Err` when this session's asm leg is absent — check `asmStatus().available` first. A run
+    /// with no end yet is NOT an error, and neither is a fault: they decode as `Decoded::Unfinished` and
+    /// `Decoded::Fault`.
+    #[wasm_bindgen(js_name = asmValue)]
+    pub fn asm_value(&self) -> Result<JsValue, JsValue> {
+        to_value(&self.0.asm_value().map_err(err)?)
+    }
+
     // --- the reference leg --------------------------------------------------------------------
 
     /// BLOCKS THE MAIN THREAD FOR UP TO 5,000,000 INTERPRETER STEPS, and cannot be chunked — see
@@ -611,7 +680,8 @@ impl Session {
     /// clone of 48,332 objects is not.
     ///
     /// This is 5a-ii's row-index trade — one `Int32Array` rather than 127,881 row objects — applied
-    /// to all three legs at once.
+    /// to every leg at once. `tmOwner` and `asmOwner` are two columns of one kind, an owner per state and
+    /// an owner per instruction, `-1` for none, and one closure builds both.
     ///
     /// # Errors
     ///
@@ -633,7 +703,7 @@ impl Session {
     // `.forgejo/workflows/ci.yml`'s browser job says it again ("`#[wasm_bindgen]`'s generated glue ...
     // only execute[s] in a browser"). The lint still fires because clippy also lints the `rlib` build,
     // which targets the host's 64-bit `usize` — a target this function is never actually run compiled
-    // for. The lengths cast here (span/node counts, tape-owner counts) carry no separate numeric bound
+    // for. The lengths cast here (span and node counts, the two owner columns) carry no separate numeric bound
     // of their own; the bound that matters is this one, on the target, not on the value.
     #[allow(clippy::cast_possible_truncation)]
     #[wasm_bindgen(js_name = linkIndex)]
@@ -666,10 +736,13 @@ impl Session {
         let (lam_start, lam_end, lam_id) = pairs(&index.lambda_nodes);
         let (src_start, src_end, src_id) = pairs(&index.source_nodes);
 
-        let owner = js_sys::Int32Array::new_with_length(index.tm_owner.len() as u32);
-        for (i, o) in index.tm_owner.iter().enumerate() {
-            owner.set_index(i as u32, *o);
-        }
+        let owners = |v: &[i32]| {
+            let column = js_sys::Int32Array::new_with_length(v.len() as u32);
+            for (i, o) in v.iter().enumerate() {
+                column.set_index(i as u32, *o);
+            }
+            column
+        };
 
         let out = js_sys::Object::new();
         let set = |k: &str, v: &JsValue| js_sys::Reflect::set(&out, &JsValue::from_str(k), v);
@@ -691,7 +764,8 @@ impl Session {
         set("sourceNodeStart", &src_start)?;
         set("sourceNodeEnd", &src_end)?;
         set("sourceNodeId", &src_id)?;
-        set("tmOwner", &owner)?;
+        set("tmOwner", &owners(&index.tm_owner))?;
+        set("asmOwner", &owners(&index.asm_owner))?;
         Ok(out.into())
     }
 }
diff --git a/crates/redextape-wasm/src/session.rs b/crates/redextape-wasm/src/session.rs
index d733435..91c3f6f 100644
--- a/crates/redextape-wasm/src/session.rs
+++ b/crates/redextape-wasm/src/session.rs
@@ -8,13 +8,16 @@
 use std::collections::BTreeMap;
 use std::rc::Rc;
 
-use redextape_core::core::NodeId;
+use redextape_core::core::{Core, NodeId};
 use redextape_core::lambda::{self, LambdaTerm, LowerError};
 use redextape_core::sourcemap::SourceMap;
+use redextape_core::tm::asm::{AsmOutcome, Program};
 use redextape_core::tm::machine::Machine;
 use redextape_core::tm::{self, EncodingKind, Symbol, Tape, TmRun};
-use redextape_core::trace::{LambdaCheckpoints, LambdaCursor, TmCursor};
-use redextape_core::viewmodel::{LambdaState, LambdaTree, LinkIndex, TmProgram, TmState, TreeAnswer};
+use redextape_core::trace::{self, AsmCap, AsmCursor, LambdaCheckpoints, LambdaCursor, TmCursor};
+use redextape_core::viewmodel::{
+    AsmProgram, AsmState, AsmWindow, LambdaState, LambdaTree, LinkIndex, TmProgram, TmState, TreeAnswer,
+};
 use redextape_core::{Diagnostic, Severity, Span, lints, parser, typeck};
 
 /// The deepest term any print through the session may walk — the two big-budget prints
@@ -81,6 +84,8 @@ pub enum SessionError {
     LambdaAbsent,
     /// A TM-leg method on a session whose TM backend declined. `tm_status()` says why.
     TmAbsent,
+    /// An asm-leg method on a session whose program did not lower to asm. `asm_status()` says why.
+    AsmAbsent,
     /// `tape_slice` named a tape the machine does not have.
     NoSuchTape { tape: usize, tapes: usize },
 }
@@ -90,6 +95,7 @@ impl std::fmt::Display for SessionError {
         match self {
             SessionError::LambdaAbsent => write!(f, "this program has no λ leg — see lambdaStatus()"),
             SessionError::TmAbsent => write!(f, "this program has no TM leg — see tmStatus()"),
+            SessionError::AsmAbsent => write!(f, "this program has no asm leg — see asmStatus()"),
             SessionError::NoSuchTape { tape, tapes } => {
                 write!(f, "no tape {tape}: this machine has {tapes}")
             }
@@ -136,6 +142,7 @@ pub enum RunStatus {
 /// | --- | --- | --- | --- | --- | --- |
 /// | `lambda_value` | ✅ | ✅ | ✅ | the cursor has not reached `Ended` | — |
 /// | `tm_value` | ✅ | ✅ | ✅ | a capped compile whose cursor has not since halted | — |
+/// | `asm_value` | ✅ | ✅ | ✅ | a capped compile whose cursor has not since ended | ✅ |
 /// | `evaluate` | ✅ | ✅ | — | — | ✅ |
 ///
 /// `tm_value`'s `Unfinished` is NOT λ-specific: `compile` gives both `Ran` and `HitCap` a working
@@ -143,6 +150,13 @@ pub enum RunStatus {
 /// a raised cap can drive that cursor to a halt, and `tm_value` decodes the configuration it stopped
 /// on. There is no state in which the TM leg reports `Ended` and `Unfinished` together.
 ///
+/// **`asm_value` IS `tm_value`'S SHAPE WITH A FAULT ADDED.** It answers from the run `compile` performed and
+/// falls back on the cursor after a raised cap, so its `Unfinished` is the TM's; and an asm program can
+/// fault — `head([])` types, and its `head` meets `nil` — which the cursor reports with the instruction and
+/// the reason. That run has ENDED (`asm_status().run` is `Ended`), so the fault is the leg's answer,
+/// "head of empty list at pc1", and not a status. Each ✅ in its row has a test of
+/// its own below, by the program that reaches it.
+///
 /// **BOTH `Undecodable` MARKS ARE A FIXTURE, NOT AN ARGUMENT.**
 /// `a_function_valued_program_decodes_as_undecodable_on_both_legs` pins them against `|x| x + 1`,
 /// which types as `Fun([Nat], Nat)` — a type `decode_lambda_ty` and `decode_tape_ty` both bottom out
@@ -184,7 +198,7 @@ pub enum Decoded {
 
 /// Whether the λ leg is there, why not when it is not, and how far its run has got.
 ///
-/// `reason` IS THE PAYLOAD, which is why both legs answer a struct rather than an `Option`. A UI that
+/// `reason` IS THE PAYLOAD, which is why every leg answers a struct rather than an `Option`. A UI that
 /// only knows a leg is missing has nothing to tell the user; "the λ backend refuses a closure that
 /// assigns a captured variable" is the whole point of showing the pane at all. `node` is the Core node
 /// the refusal names, so the source pane can highlight it. `run` is `None` exactly when the leg is
@@ -277,10 +291,70 @@ pub struct TmStatus {
     pub total_steps: Option<u64>,
 }
 
+/// Whether the asm leg is there, why not when it is not, how far its cursor has got, which cap stopped it,
+/// and how long the whole run is.
+///
+/// **`TmStatus`'S SHAPE, LESS `width` AND PLUS `cap`.** An asm program has no encoding to fit, so it has no
+/// width. And `RunStatus::Capped` cannot say by itself whether "continue" is an honest offer, which on the TM
+/// it always is: the asm cursor has four caps and only the step cap resumes — `AsmCursor::raise_cap` leaves a
+/// run its stack, heap or saved-frame memory stopped where it is, since more steps cannot deepen a stack —
+/// so a renderer that offered "continue" on `Capped` alone would offer it to three runs that cannot take it.
+/// `cap` says which cap it was, and the step line names it (spec amendment 10).
+///
+/// **A FIELD, NOT MORE `RunStatus` VARIANTS.** λ's depth refusal is `RunStatus::DepthRefused` because it is
+/// one fact with one sentence. Three hard caps each need a sentence of their own, and a variant apiece would
+/// put three asm-only states into the vocabulary every leg's `run` shares, for the λ and TM renderers to
+/// match and never meet. The TM's `Capped` needs no cap beside it: both of its caps, steps and live cells,
+/// are ones `raise_tm_cap` raises.
+///
+/// **A FAULT IS AN END.** `run` is `Ended` for a run that halted and for one that faulted, and `asm_value`
+/// carries the difference: the program's value, or `Decoded::Fault` naming the instruction and the reason
+/// (spec §8). A fault is the program's answer — `head([])` faults in the reference interpreter too — not a
+/// limit of this tool, so nothing about it invites continuing.
+#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
+#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
+pub struct AsmStatus {
+    pub available: bool,
+    /// Why the leg is absent — which way `tm::lower_program` refused the program — or empty when it is not.
+    ///
+    /// **NO `node`, AS `TmStatus` HAS NONE.** The TM leg lowers through the same function, so a program the
+    /// asm lowering refuses declines the TM leg too, with the same refusal behind it, and neither status
+    /// names a construct; `LambdaStatus::node` exists because the λ backend refuses things of its own.
+    pub reason: String,
+    /// Where the CURSOR stands: `Running`, `Ended` for a halt or a fault, or `Capped`. `None` exactly when
+    /// the leg is absent. `DepthRefused` is λ's and never appears here.
+    pub run: Option<RunStatus>,
+    /// Which cap stopped the cursor. `Some` exactly when `run` is `Capped` — a cap beside `Running` or
+    /// `Ended` would name a stop that did not happen — and only `Some(AsmCap::Steps)` names one that
+    /// `raise_asm_cap` resumes.
+    pub cap: Option<AsmCap>,
+    /// How long the WHOLE run is, in instructions, from the run `compile` performed (spec amendment 13).
+    ///
+    /// **`compile` RUNS THE PROGRAM TO ITS END TO KNOW THIS, AS IT RUNS THE TM.** `run_asm` returns no step
+    /// count, so `compile` drives an `AsmCursor` to the end and keeps the count and the outcome, and the
+    /// cursor a view records is a fresh one. It is a different number about a different thing than `run`,
+    /// for `TmStatus::total_steps`'s reason: "instruction 23 of 55" reads the cursor for the first number
+    /// and this for the second, and this does not move as the cursor does.
+    ///
+    /// **FOR A CAPPED RUN IT IS WHERE THE CAP FIRED, NOT THE LENGTH OF A COMPLETED RUN**: 5,000,000 under
+    /// `DEFAULT_CAPS`' step cap, and the instructions completed before the refused one under a stack, heap or
+    /// memory cap. A raised step cap can drive the cursor past it, so a renderer reads `run` before it takes
+    /// this for a length — `TmStatus::total_steps`'s caveat, word for word.
+    ///
+    /// **`Some` EXACTLY WHEN THE LEG IS AVAILABLE.** The only decline is a lowering that failed, and a program
+    /// that never lowered never ran a step, so there is no count to withhold, unlike the TM's `Overflow`.
+    ///
+    /// `ts(type = "number | null")`, for the reason `TmStatus::total_steps`'s doc records at length: `ts-rs`
+    /// maps `u64` to `bigint`, the wire carries a JS number, and `ts(type = ...)` replaces the whole field
+    /// type, `Option` and all.
+    #[cfg_attr(feature = "ts", ts(type = "number | null"))]
+    pub total_steps: Option<u64>,
+}
+
 /// The result of `Session::compile`. `diagnostics` is non-empty for a program the front end objected
 /// to; `session` is `None` only when nothing could be built at all.
 ///
-/// A SESSION WITH BOTH LEGS DECLINED IS STILL A SESSION. Declining is a backend's answer about a
+/// A SESSION WITH EVERY LEG DECLINED IS STILL A SESSION. Declining is a backend's answer about a
 /// program, not a failure to process it, and the UI's job is to say which backend declined and why.
 pub struct Compiled {
     pub diagnostics: Vec<Diagnostic>,
@@ -289,8 +363,9 @@ pub struct Compiled {
 
 /// Static diagnostics — parse and typecheck — with no backend and no session.
 ///
-/// **SEPARATE FROM `compile` BECAUSE OF WHAT `compile` COSTS.** `compile` lowers both backends and
-/// runs the TM to a halt (`run_tm_described`), which is 344,999 δ-steps on the `map` demo. An editor
+/// **SEPARATE FROM `compile` BECAUSE OF WHAT `compile` COSTS.** `compile` lowers every backend, runs
+/// the TM to a halt (`run_tm_described`), which is 344,999 δ-steps on the `map` demo, and runs the asm
+/// program to its end, which for a program that never halts is the whole five-million-step cap. An editor
 /// linting on every keystroke cannot go through that path, and this is the one it goes through
 /// instead. `Analysis.core` is dropped: a `Core` has no boundary representation and no consumer here.
 pub fn analyze(src: &str) -> Vec<Diagnostic> {
@@ -368,6 +443,10 @@ pub struct Session {
     /// is where that is withheld: a declined leg reports `None` however this field reads, because a
     /// length beside `available: false` describes a run the caller has no cursor to reach.
     pub(crate) total_steps: Option<u64>,
+    /// The asm leg, or the lowering's refusal. Absent ONLY when `tm::lower_program` fails: a program the TM
+    /// declines as too large to build or as overflowing every width still lowered, so it still runs here
+    /// (spec §5.2). See `AsmLeg` for what travels together inside it.
+    pub(crate) asm: Result<AsmLeg, tm::LowerError>,
 }
 
 /// The shared tail of `compile`'s two non-declining arms. `Ran` and `HitCap` build the same cursor
@@ -432,6 +511,86 @@ fn tm_leg_at(
     (program, cursor)
 }
 
+/// The asm leg: the listing, the cursor a view records, and how `compile`'s own run of the program ended,
+/// TRAVELLING TOGETHER in one `Result`, for the reason the `tm` field's doc gives for its pair — a cursor with
+/// no listing, or a total with no run behind it, is then a state the type cannot spell.
+pub(crate) struct AsmLeg {
+    /// Projected once, by `build_asm_leg`, and cloned per `asm_program` — never printed again.
+    program: AsmProgram,
+    /// A FRESH cursor, at step 0, over the program `compile`'s run stepped and under the caps it ran with —
+    /// `build_tm_leg`'s rule: a cursor budgeted differently from the run whose outcome the session reports
+    /// would stop somewhere that outcome never mentions.
+    cursor: AsmCursor<Rc<Program>>,
+    /// Instructions `compile`'s run completed. `AsmStatus::total_steps` says what it means for a capped run.
+    total_steps: u64,
+    /// How `compile`'s run ended.
+    end: AsmEnd,
+}
+
+/// How the run `compile` performed ended: what `asm_value` answers from, until a raised cap lets the recording
+/// cursor get further than that run did.
+///
+/// **THE HALT KEEPS THE OUTCOME AND NOTHING ELSE.** `AsmCursor::into_outcome` consumes the cursor, keeping the
+/// result word and the heap, which is exactly what `tm::decode_asm_ty` reads; the rest of the machine is
+/// dropped with it rather than held for the session's life.
+enum AsmEnd {
+    Halted(AsmOutcome),
+    /// The instruction that faulted — or the index a fetch past the end tried — and the fault's text.
+    Faulted {
+        pc: usize,
+        why: String,
+    },
+    /// A cap stopped it. WHICH cap is the recording cursor's to say, once it reaches the same wall under
+    /// the same caps; until then that cursor is running and no cap is named.
+    Capped,
+}
+
+/// Lower `core` for the asm leg, run the program to its end under `caps`, and open the cursor a view records.
+///
+/// **A THIRD LOWERING OF ONE `Core` PER COMPILE**, after `SourceMap`'s asm half and `run_tm_described`, and
+/// safe because all three go through one dispatch: `tm::lower_program` is a pure function of its `Core`, and
+/// `sourcemap.rs`'s `asm_owner_covers_the_program_lower_program_returns` holds that `SourceMap::asm_owner`
+/// indexes the program it returns, first-order and through `defunc` alike. So `asm_state`'s `source_node`
+/// and `link_index`'s asm column name this cursor's instructions. Sharing one lowering would mean the map
+/// handing its `Program` back out, for this one caller.
+///
+/// **THE WHOLE RUN HAPPENS HERE, ONCE** (spec amendment 13): the step total and the value both come from it,
+/// and a program that never halts spends the whole step cap here, before `compile` returns.
+fn build_asm_leg(core: &Core, caps: tm::asm::Caps) -> Result<AsmLeg, tm::LowerError> {
+    let program = Rc::new(tm::lower_program(core)?);
+    let mut run = AsmCursor::new(Rc::clone(&program), caps);
+    for _ in run.by_ref() {}
+    let total_steps = run.steps_taken();
+    let end = match run.status().cloned() {
+        Some(trace::AsmStatus::Halted) => AsmEnd::Halted(run.into_outcome()),
+        Some(trace::AsmStatus::Faulted(why)) => AsmEnd::Faulted { pc: run.pc(), why },
+        // `None` cannot be reached: a cursor stops only by latching a status. It answers as a cap, as
+        // `run_asm` does for the same arm, rather than panicking, since a panic under wasm aborts the module.
+        Some(trace::AsmStatus::Capped(_)) | None => AsmEnd::Capped,
+    };
+    Ok(AsmLeg { program: AsmProgram::of(&program), cursor: AsmCursor::new(program, caps), total_steps, end })
+}
+
+/// What `asm_status().reason` says for each way `tm::lower_program` refuses a program. One arm per variant,
+/// so a third refusal is a compile error here rather than a blank reason.
+fn asm_decline_reason(e: &tm::LowerError) -> String {
+    match e {
+        tm::LowerError::Unsupported { what, .. } => format!("the asm backend does not support {what}"),
+        tm::LowerError::TooDeep { .. } => "the program nests deeper than the asm lowering guard allows".to_string(),
+    }
+}
+
+/// A fault as the asm leg's value, "head of empty list at pc1" — the one wording for the two places a run can
+/// fault, `compile`'s run and the recording cursor after a raised cap.
+///
+/// **WHAT FAULTED, THEN WHERE, AND NO "FAULTED".** Spec §8 wrote "faulted at pc12: head of empty list", but every
+/// reader of a `Decoded::Fault` already says it is one — `web/src/types.ts`'s `decodedText` prints `fault: ` before
+/// the message — so the spec's words would read "fault: faulted at pc12: …". The message carries the fault and the
+/// instruction, and the readout reads "fault: head of empty list at pc12".
+fn asm_fault(pc: usize, why: &str) -> Decoded {
+    Decoded::Fault { message: format!("{why} at pc{pc}") }
+}
+
 /// How many β-steps apart the λ leg's checkpoints sit: a tree for any past step is rebuilt by replaying
 /// at most this many minus one. Spec §4.2: a whole `fact(4)` run re-reduces in about 13 ms natively,
 /// so 255 steps of it cost well under a millisecond.
@@ -598,20 +757,28 @@ impl Session {
     /// them. The run desugars the program on its own, since the map's constructor is what pairs a `Core`
     /// with its spans and it cannot be called until the width is known; `desugar` mints the same ids
     /// every time, and only the machine leaves the run.
+    ///
+    /// **THE ASM PROGRAM RUNS TO ITS END TOO**, from the map's own `Core` — see `build_asm_leg` for why that
+    /// program is the one the map's `asm_owner` indexes, and for what the run costs a program that never halts.
     pub fn compile(src: &str, kind: EncodingKind) -> Compiled {
-        Session::compile_with_caps(src, kind, tm::TM_DEFAULT_CAPS)
+        Session::compile_with_caps(src, kind, tm::TM_DEFAULT_CAPS, tm::asm::DEFAULT_CAPS)
     }
 
-    /// `compile` with the TM run's budget as a parameter rather than a constant.
+    /// `compile` with the TM run's and the asm run's budgets as parameters rather than constants.
+    ///
+    /// PRIVATE, AND EVERY PRODUCT CALLER PASSES `TM_DEFAULT_CAPS` AND `tm::asm::DEFAULT_CAPS` — the
+    /// boundary exposes no way to choose. They are parameters because `TM_DEFAULT_CAPS` is 5,000,000
+    /// δ-steps, so the `HitCap` arm below is otherwise only reachable by simulating five million steps and
+    /// then five million more through the cursor to reach the same wall. A test that cannot afford that is
+    /// a test that never runs, and the arm it cannot reach is the one where `final_tapes` is `None` and
+    /// every question about a continued run is decided. With a budget of ten the same arm is reached in
+    /// milliseconds, by the same code, from the same source program.
     ///
-    /// PRIVATE, AND EVERY PRODUCT CALLER PASSES `TM_DEFAULT_CAPS` — the boundary exposes no way to
-    /// choose. It is a parameter because `TM_DEFAULT_CAPS` is 5,000,000 δ-steps, so the `HitCap` arm
-    /// below is otherwise only reachable by simulating five million steps and then five million more
-    /// through the cursor to reach the same wall. A test that cannot afford that is a test that never
-    /// runs, and the arm it cannot reach is the one where `final_tapes` is `None` and every question
-    /// about a continued run is decided. With a budget of ten the same arm is reached in milliseconds,
-    /// by the same code, from the same source program.
-    fn compile_with_caps(src: &str, kind: EncodingKind, caps: tm::TmCaps) -> Compiled {
+    /// **THE ASM BUDGET IS THE SAME HOOK FOR THE SAME REASON, FOUR TIMES OVER.** Each of the asm cursor's
+    /// caps — steps, stack, heap and saved-frame memory — ends the run its own way, and at `DEFAULT_CAPS`
+    /// reaching the stack cap takes 100,000 frames and the heap and memory caps millions of cells and words.
+    /// A small budget reaches each in a few instructions of an ordinary program.
+    fn compile_with_caps(src: &str, kind: EncodingKind, caps: tm::TmCaps, asm_caps: tm::asm::Caps) -> Compiled {
         let (program, mut diagnostics) = parser::parse(src);
         let Some(program) = program else {
             return Compiled { diagnostics, session: None };
@@ -646,6 +813,7 @@ impl Session {
             _ => tm::MIN_FIELD_WIDTH,
         };
         let (core, map) = SourceMap::build_from_program(&program, &*kind.at(width));
+        let asm = build_asm_leg(&core, asm_caps);
 
         let (lambda, initial_lambda) = match lambda::lower(&core) {
             Ok(t) => (Ok(LambdaLeg::new(&t, lambda::MAX_REDUCTION_STEPS)), Some(t)),
@@ -701,7 +869,7 @@ impl Session {
 
         Compiled {
             diagnostics,
-            session: Some(Session { core, ty, lambda, initial_lambda, tm, map, final_tapes, kind, total_steps }),
+            session: Some(Session { core, ty, lambda, initial_lambda, tm, map, final_tapes, kind, total_steps, asm }),
         }
     }
 
@@ -954,6 +1122,100 @@ impl Session {
         Ok(decoded_or_undecodable(tm::decode_tape_ty(tapes, &self.ty, &*enc)))
     }
 
+    // --- the asm leg --------------------------------------------------------------------------
+
+    /// Whether the asm leg is there, how its cursor stands and which cap stopped it — see `AsmStatus`. `run`
+    /// and `cap` are read off the CURSOR, and `total_steps` off `compile`'s run, the split `tm_status` makes.
+    pub fn asm_status(&self) -> AsmStatus {
+        match &self.asm {
+            Ok(leg) => {
+                let (run, cap) = match leg.cursor.status() {
+                    None => (RunStatus::Running, None),
+                    Some(trace::AsmStatus::Halted | trace::AsmStatus::Faulted(_)) => (RunStatus::Ended, None),
+                    Some(trace::AsmStatus::Capped(cap)) => (RunStatus::Capped, Some(*cap)),
+                };
+                AsmStatus {
+                    available: true,
+                    reason: String::new(),
+                    run: Some(run),
+                    cap,
+                    total_steps: Some(leg.total_steps),
+                }
+            }
+            Err(e) => {
+                AsmStatus { available: false, reason: asm_decline_reason(e), run: None, cap: None, total_steps: None }
+            }
+        }
+    }
+
+    /// The cached listing, cloned — never printed again. Built once per compile, as `tm_program`'s
+    /// projection is, and read off `asm`, the same place `asm_status` reads availability.
+    pub fn asm_program(&self) -> Result<AsmProgram, SessionError> {
+        let leg = self.asm.as_ref().map_err(|_| SessionError::AsmAbsent)?;
+        Ok(leg.program.clone())
+    }
+
+    /// Advance one instruction. `false` once the run has halted, faulted or been capped — `asm_status().run`
+    /// and `.cap` say which, and are the only thing that can.
+    pub fn step_asm(&mut self) -> Result<bool, SessionError> {
+        let leg = self.asm.as_mut().map_err(|_| SessionError::AsmAbsent)?;
+        Ok(leg.cursor.next().is_some())
+    }
+
+    /// The cursor's machine cut to `window` — `AsmState::window` and nothing else, with the session's map, so
+    /// `source_node` resolves (`build_asm_leg` says why this map indexes this cursor's program).
+    pub fn asm_state(&self, window: AsmWindow) -> Result<AsmState, SessionError> {
+        let leg = self.asm.as_ref().map_err(|_| SessionError::AsmAbsent)?;
+        Ok(AsmState::window(&leg.cursor, Some(&self.map), window))
+    }
+
+    /// Extend the step budget, additively and saturating. It resumes a run the STEP cap stopped and nothing
+    /// else — `AsmCursor::raise_cap`'s rule — so raising it on a run a stack, heap or memory cap stopped, or
+    /// on one that ended, is harmless and changes nothing a caller can see.
+    pub fn raise_asm_cap(&mut self, extra_steps: u64) -> Result<(), SessionError> {
+        let leg = self.asm.as_mut().map_err(|_| SessionError::AsmAbsent)?;
+        leg.cursor.raise_cap(extra_steps);
+        Ok(())
+    }
+
+    /// The asm leg's answer: `rr` decoded by the program's type (`tm::decode_asm_ty`), from the run `compile`
+    /// performed.
+    ///
+    /// **AVAILABLE AT STEP 0, NOT ONLY AT THE END, BECAUSE THE ANSWER IS NOT THE CURSOR'S.** `compile` ran the
+    /// program to its end, so a halted or faulted run has its answer before the cursor takes a step — as
+    /// `tm_value` has, and unlike `lambda_value`, whose compile never reduces. Waiting for the cursor would
+    /// withhold a known answer and invite a caller to step five million instructions to get it.
+    ///
+    /// **THE CURSOR IS THE FALLBACK, AND ONLY THE FALLBACK**, for `tm_value`'s reason: a compile the step cap
+    /// stopped has no answer, and `raise_asm_cap` can then carry the cursor to a halt or a fault that
+    /// `compile`'s run never reached. The fallback decodes what the cursor already holds — no second run —
+    /// but it COPIES THE HEAP: `decode_asm_ty` reads an `AsmOutcome`, which owns its heap, and the cursor
+    /// cannot give its heap away without being consumed (`AsmCursor::into_outcome`). The copy is paid per
+    /// call, only on this path, and only for a run that outlasted its compile.
+    ///
+    /// `Unfinished` therefore means there is no end ANYWHERE: `compile`'s run was capped and the cursor has not
+    /// since ended. For a run a stack, heap or memory cap stopped that is permanent, since no raise resumes it,
+    /// and `asm_status().cap` is how a renderer tells that apart from a step cap it can raise.
+    ///
+    /// `Fault` is a run that ended in a fault, in `asm_fault`'s wording; `Undecodable` a halt whose `rr` has no
+    /// value of the program's type, which is every function-typed program; `TooLargeToPrint` a decode that
+    /// succeeded and a value too large for `decoded_value`'s capped print. See `Decoded`'s table.
+    pub fn asm_value(&self) -> Result<Decoded, SessionError> {
+        let leg = self.asm.as_ref().map_err(|_| SessionError::AsmAbsent)?;
+        Ok(match &leg.end {
+            AsmEnd::Halted(outcome) => decoded_or_undecodable(tm::decode_asm_ty(outcome, &self.ty)),
+            AsmEnd::Faulted { pc, why } => asm_fault(*pc, why),
+            AsmEnd::Capped => match leg.cursor.status() {
+                Some(trace::AsmStatus::Halted) => {
+                    let outcome = AsmOutcome { result: leg.cursor.rr(), heap: leg.cursor.heap().to_vec() };
+                    decoded_or_undecodable(tm::decode_asm_ty(&outcome, &self.ty))
+                }
+                Some(trace::AsmStatus::Faulted(why)) => asm_fault(leg.cursor.pc(), why),
+                None | Some(trace::AsmStatus::Capped(_)) => Decoded::Unfinished,
+            },
+        })
+    }
+
     // --- the reference leg --------------------------------------------------------------------
 
     /// The reference interpreter's answer — the ground truth `three_way_oracle.rs` checks both
@@ -1045,7 +1307,7 @@ impl Session {
 /// is named `session` and nothing is gained by renaming it. See the design's §4.1.
 ///
 /// **A `None` HERE IS "THE TEXT DID NOT PARSE", NOT "A BACKEND DECLINED"** — the distinction `Compiled`
-/// draws in the other direction. A `Session` with both legs declined is still a session, because
+/// draws in the other direction. A `Session` with every leg declined is still a session, because
 /// declining is a backend's answer about a program; a scratchpad IS its parsed artifact, so text that
 /// does not parse leaves nothing to hold.
 pub struct Scratched<T> {
diff --git a/scripts/build-web-bindings.sh b/scripts/build-web-bindings.sh
index 18a091c..1cf09f7 100755
--- a/scripts/build-web-bindings.sh
+++ b/scripts/build-web-bindings.sh
@@ -214,12 +214,22 @@ check_leg_produced_files "$WASM_DIR" "redextape-wasm"
 # OTHER crate never enters the comparison — both gates pass, and the wrong file ships to every
 # TypeScript consumer. Checked here, before the merge and before anything under $BINDINGS_DIR is
 # touched, so a collision refuses loudly instead of being resolved by mv's last-write-wins.
+#
+# A BASENAME BOTH LEGS WROTE WITH THE SAME BYTES IS NOT A COLLISION, and it is dropped from the wasm leg. ts-rs
+# exports a type's dependencies with it, so a redextape-wasm type that names a redextape-core type — the asm leg's
+# `AsmStatus` and its `cap: AsmCap` — writes that core type's file into the wasm leg too. Both files come from the
+# one Rust declaration, so they agree to the byte, and keeping either is keeping both. Two DIFFERENT types of one
+# name print different declarations and still refuse below.
 check_no_leg_collisions() {
   local name collisions=""
   for path in "$CORE_DIR"/*.ts; do
     name="$(basename "$path")"
     if [ -e "$WASM_DIR/$name" ]; then
-      collisions="$collisions $name"
+      if cmp -s "$path" "$WASM_DIR/$name"; then
+        rm -f "${WASM_DIR:?}/$name"
+      else
+        collisions="$collisions $name"
+      fi
     fi
   done
   if [ -n "$collisions" ]; then
````


- [ ] **Step 4: Run them and see them pass.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast`

Expected: exit 0, printing:

```text
    Summary: 106 tests run: 106 passed, 0 skipped
```

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --features ts --no-fail-fast -E 'binary(ts_bindings)'`

Expected: exit 0, printing:

```text
    Summary: 3 tests run: 3 passed, 0 skipped
```

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo clippy -p redextape-wasm --all-targets --features ts -- -D warnings`

Expected: exit 0

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 env PATH=/usr/sbin:$PATH scripts/check-all.sh --browser-only`

Expected: exit 0, printing:

```text
    test result: ok. 30 passed; 0 failed; 0 ignored; 0 filtered out
```

Run: `cd web && pnpm run build:wasm`

Expected: exit 0

Run: `cd web && pnpm run build:bindings`

Expected: exit 0, printing:

```text
    test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 971 filtered out
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, from the repository root, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 28 of 28 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| B1 | `session.rs`: `let total_steps = run.steps_taken();` → `let total_steps = run.steps_taken().saturating_sub(1);` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_raised_step_cap_carries_the_asm_cursor_to_a_value`, `redextape-wasm session::tests::the_asm_status_reports_the_whole_runs_length_alongside_the_cursors_position`, `redextape-wasm session::tests::a_program_the_tm_refuses_to_build_keeps_its_asm_leg`, `redextape-wasm session::tests::a_hard_cap_names_itself_and_does_not_resume`, `redextape-wasm session::tests::a_runaway_loop_caps_the_asm_leg_on_steps_where_the_tm_declines` |
| B2 | `session.rs`: `for _ in run.by_ref() {}` → `for _ in run.by_ref().take(0) {}` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_raised_step_cap_carries_the_asm_cursor_to_a_value`, `redextape-wasm session::tests::the_asm_leg_agrees_with_the_reference`, `redextape-wasm session::tests::the_asm_status_reports_the_whole_runs_length_alongside_the_cursors_position`, `redextape-wasm session::tests::asm_value_answers_from_the_run_compile_already_performed`, `redextape-wasm session::tests::a_function_valued_program_decodes_as_undecodable_on_the_asm_leg`, `redextape-wasm session::tests::a_program_the_tm_refuses_to_build_keeps_its_asm_leg`, `redextape-wasm session::tests::asm_value_reports_too_large_to_print_for_a_logically_enormous_decode`, `redextape-wasm session::tests::a_hard_cap_names_itself_and_does_not_resume`, and 2 more |
| B3 | `session.rs`: `AsmEnd::Halted(outcome) => decoded_or_undecodable(tm::decode_asm_ty(outcome, &self.ty)),` → `AsmEnd::Halted(_) => Decoded::Unfinished,` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_program_the_tm_refuses_to_build_keeps_its_asm_leg`, `redextape-wasm session::tests::the_asm_leg_agrees_with_the_reference`, `redextape-wasm session::tests::asm_value_answers_from_the_run_compile_already_performed`, `redextape-wasm session::tests::a_function_valued_program_decodes_as_undecodable_on_the_asm_leg`, `redextape-wasm session::tests::asm_value_reports_too_large_to_print_for_a_logically_enormous_decode` |
| B4 | `session.rs`: `AsmEnd::Halted(outcome) => decoded_or_undecodable(tm::decode_asm_ty(outcome, &self.ty)),` → `AsmEnd::Halted(outcome) => tm::decode_asm_ty(outcome, &self.ty) ⏎                 .map_or(Decoded::Undecodable, |v| Decoded::Value { text: redextape_core::value::format_value(&v) }),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::asm_value_reports_too_large_to_print_for_a_logically_enormous_decode` |
| B5 | `session.rs`: `Ok(AsmLeg { program: AsmProgram::of(&program), cursor: AsmCursor::new(program, caps), total_steps, end })` → `Ok(AsmLeg { program: AsmProgram::of(&program), cursor: AsmCursor::new(program, tm::asm::DEFAULT_CAPS), total_steps, end })` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_raised_step_cap_carries_the_asm_cursor_to_a_value`, `redextape-wasm session::tests::a_hard_cap_names_itself_and_does_not_resume` |
| B6 | `session.rs`: `Some(trace::AsmStatus::Halted | trace::AsmStatus::Faulted(_)) => (RunStatus::Ended, None),` → `Some(trace::AsmStatus::Halted) => (RunStatus::Ended, None), ⏎                     Some(trace::AsmStatus::Faulted(_)) => (RunStatus::Running, None),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_fault_ends_the_asm_run_and_is_its_value` |
| B7 | `session.rs`: `Some(trace::AsmStatus::Capped(cap)) => (RunStatus::Capped, Some(*cap)),` → `Some(trace::AsmStatus::Capped(_)) => (RunStatus::Capped, Some(AsmCap::Steps)),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_hard_cap_names_itself_and_does_not_resume` |
| B8 | `session.rs`: `total_steps: Some(leg.total_steps),` → `total_steps: None,` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::the_asm_status_reports_the_whole_runs_length_alongside_the_cursors_position`, `redextape-wasm session::tests::a_program_the_tm_refuses_to_build_keeps_its_asm_leg`, `redextape-wasm session::tests::a_raised_step_cap_carries_the_asm_cursor_to_a_value`, `redextape-wasm session::tests::a_hard_cap_names_itself_and_does_not_resume`, `redextape-wasm session::tests::a_runaway_loop_caps_the_asm_leg_on_steps_where_the_tm_declines` |
| B9 | `session.rs`: `let asm = build_asm_leg(&core, asm_caps);` → `let asm = match &described { ⏎             Ok(d) if matches!(d.run, TmRun::Ran { .. } | TmRun::HitCap) => build_asm_leg(&core, asm_caps), ⏎             _ => Err(tm::LowerError::TooDeep { node: 0 }), ⏎         };` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_program_defunc_refuses_declines_the_asm_leg_with_its_reason`, `redextape-wasm session::tests::a_program_the_tm_refuses_to_build_keeps_its_asm_leg`, `redextape-wasm session::tests::asm_value_reports_too_large_to_print_for_a_logically_enormous_decode`, `redextape-wasm session::tests::a_runaway_loop_caps_the_asm_leg_on_steps_where_the_tm_declines` |
| B10 | `session.rs`: `tm::LowerError::Unsupported { what, .. } => format!("the asm backend does not support {what}"),` → `tm::LowerError::Unsupported { .. } => "the asm backend does not support it".to_string(),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_program_defunc_refuses_declines_the_asm_leg_with_its_reason` |
| B11 | `session.rs`: `tm::LowerError::TooDeep { .. } => "the program nests deeper than the asm lowering guard allows".to_string(),` → `tm::LowerError::TooDeep { .. } => "the program does not lower".to_string(),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_program_that_does_not_lower_declines_the_asm_leg_and_refuses_its_methods` |
| B12 | `session.rs`: `leg.cursor.raise_cap(extra_steps); ⏎         Ok(())` → `let _ = (&leg, extra_steps); ⏎         Ok(())` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_raised_step_cap_carries_the_asm_cursor_to_a_value`, `redextape-wasm session::tests::a_runaway_loop_caps_the_asm_leg_on_steps_where_the_tm_declines`, `redextape-wasm session::tests::a_fault_ends_the_asm_run_and_is_its_value` |
| B13 | `session.rs`: `heap: leg.cursor.heap().to_vec()` → `heap: Vec::new()` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_raised_step_cap_carries_the_asm_cursor_to_a_value` |
| B14 | `session.rs`: `Some(trace::AsmStatus::Faulted(why)) => asm_fault(leg.cursor.pc(), why),` → `Some(trace::AsmStatus::Faulted(_)) => Decoded::Unfinished,` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_fault_ends_the_asm_run_and_is_its_value` |
| B15 | `session.rs`: `Decoded::Fault { message: format!("{why} at pc{pc}") }` → `Decoded::Fault { message: format!("{why} at {pc}") }` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_fault_ends_the_asm_run_and_is_its_value` |
| B16 | `session.rs`: `Some(trace::AsmStatus::Faulted(why)) => AsmEnd::Faulted { pc: run.pc(), why },` → `Some(trace::AsmStatus::Faulted(why)) => AsmEnd::Faulted { pc: run.pc() + 1, why },` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_fault_ends_the_asm_run_and_is_its_value` |
| B17 | `session.rs`: `Ok(AsmState::window(&leg.cursor, Some(&self.map), window))` → `Ok(AsmState::window(&leg.cursor, None, window))` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::the_asm_state_windows_the_cursor_and_names_its_owner` |
| B18 | `session.rs`: `let leg = self.asm.as_mut().map_err(|_| SessionError::AsmAbsent)?; ⏎         Ok(leg.cursor.next().is_some())` → `let leg = self.asm.as_mut().map_err(|_| SessionError::AsmAbsent)?; ⏎         Ok(leg.cursor.nth(1).is_some())` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::the_asm_status_reports_the_whole_runs_length_alongside_the_cursors_position`, `redextape-wasm session::tests::a_raised_step_cap_carries_the_asm_cursor_to_a_value`, `redextape-wasm session::tests::a_hard_cap_names_itself_and_does_not_resume`, `redextape-wasm session::tests::a_runaway_loop_caps_the_asm_leg_on_steps_where_the_tm_declines` |
| B19 | `session.rs`: `Ok(leg.program.clone())` → `Ok(AsmProgram { listing: leg.program.listing.iter().skip(1).cloned().collect(), labels: Vec::new() })` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::the_link_index_carries_one_owner_per_listed_instruction` |
| B20 | `session.rs`: `SessionError::AsmAbsent => write!(f, "this program has no asm leg — see asmStatus()"),` → `SessionError::AsmAbsent => write!(f, "this program has no asm leg — see tmStatus()"),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::every_session_error_says_what_went_wrong` |
| B21 | `session.rs`: `pub fn asm_program(&self) -> Result<AsmProgram, SessionError> { ⏎         let leg = self.asm.as_ref().map_err(|_| SessionError::AsmAbsent)?;` → `pub fn asm_program(&self) -> Result<AsmProgram, SessionError> { ⏎         let leg = self.asm.as_ref().map_err(|_| SessionError::TmAbsent)?;` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::a_program_that_does_not_lower_declines_the_asm_leg_and_refuses_its_methods` |
| B22 | `sourcemap.rs`: `let asm_owner: Vec<Option<NodeId>> = asm.map(|a| a.owners()).unwrap_or_default();` → `let asm_owner: Vec<Option<NodeId>> = asm.map(|a| a.owners()).unwrap_or_default().into_iter().skip(1).collect();` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast` | `redextape-wasm session::tests::the_asm_state_windows_the_cursor_and_names_its_owner`, `redextape-wasm session::tests::the_link_index_carries_one_owner_per_listed_instruction` |
| B23 | `session.rs`: `` #[cfg_attr(feature = "ts", ts(type = "number | null"))] ⏎     pub total_steps: Option<u64>, ⏎ } ⏎  ⏎ /// The result of `Session::compile`. `` → `` #[cfg_attr(feature = "ts", ts(type = "number"))] ⏎     pub total_steps: Option<u64>, ⏎ } ⏎  ⏎ /// The result of `Session::compile`. `` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --features ts --no-fail-fast -E 'binary(ts_bindings)'` | `redextape-wasm::ts_bindings no_override_misstates_a_field_s_nullability` |
| BW1 | `lib.rs`: `let window: redextape_core::viewmodel::AsmWindow = serde_wasm_bindgen::from_value(window) ⏎             .map_err(|e| JsValue::from_str(&format!("asmState: not an AsmWindow: {e}")))?;` → `let window: redextape_core::viewmodel::AsmWindow = serde_wasm_bindgen::from_value(window) ⏎             .unwrap_or(redextape_core::viewmodel::AsmWindow { locals: 64, args: 16, frames: 8, cells: 16, boxes: 16 });` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 env PATH=/usr/sbin:$PATH scripts/check-all.sh --browser-only` | `browser the_asm_leg_crosses_the_boundary` |
| BW2 | `lib.rs`: `set("asmOwner", &owners(&index.asm_owner))?;` → `set("asmOwner", &owners(&index.asm_owner[..0]))?;` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 env PATH=/usr/sbin:$PATH scripts/check-all.sh --browser-only` | `browser link_index_crosses_as_typed_arrays`, `browser link_index_survives_a_declined_lambda_leg` |
| BW3 | `viewmodel.rs`: `AsmWord { word: word.to_string(), tag }` → `AsmWord { word: (word as f64).to_string(), tag }` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 env PATH=/usr/sbin:$PATH scripts/check-all.sh --browser-only` | `browser a_saturated_word_crosses_as_its_exact_decimal_text` |
| BW4 | `lib.rs`: `to_value(&self.0.asm_value().map_err(err)?)` → `to_value(&self.0.asm_value().ok())` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 env PATH=/usr/sbin:$PATH scripts/check-all.sh --browser-only` | `browser a_declined_asm_leg_reports_why_and_its_methods_throw` |
| BW5 | `lib.rs`: `pub fn raise_asm_cap(&mut self, extra_steps: u32) -> Result<(), JsValue> {` → `pub fn raise_asm_cap(&mut self, extra_steps: u64) -> Result<(), JsValue> {` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 env PATH=/usr/sbin:$PATH scripts/check-all.sh --browser-only` | `browser the_asm_leg_crosses_the_boundary` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
The wasm session runs asm as a third leg: `compile` runs the program to its end, and six methods read and drive a cursor over it

`compile` lowers the program with `tm::lower_program` from the map's own
`Core`, so `asm_owner` indexes it, drives a cursor to the end for the
step total and the value (spec amendment 13), and opens a fresh cursor
to record. The leg is absent only when lowering fails; a program the TM
declines as too large or overflowing still runs. `asmStatus` names the
cap that stopped the cursor, since only the step cap resumes; a fault is
an end, and its value names the instruction. `asmValue` answers from
`compile`'s run and falls back on the cursor after a raised cap.
`linkIndex` carries `asmOwner` beside `tmOwner`.

`AsmStatus` names core's `AsmCap`, so both crates write `AsmCap.ts`;
`build-web-bindings.sh` now writes a file both crates produce with the
same bytes once, and still refuses two different types of one name.
````


---

### Task 6: The asm view: a listing that follows the instruction about to run, and registers, call stack and heap panels sharing the view's height

**Files:**
- Create: `web/src/asm-view.ts`, `web/src/asm-pane.ts`
- Modify: `web/src/style.css`, `web/src/types.ts` (the core asm types), `web/src/pane-chrome.ts` (`PaneEvents.linkInstr`)
- Create (tests): `web/tests/node/asm-fixtures.ts`, `web/tests/node/asm-view.test.ts`, `web/tests/browser/asm-pane.test.ts`

**Interfaces:**
- Produces `asm-view.ts` (pure): `ListingRow`, `listingRows(p)`, `rowsOfPcs(rows)`, `instrParts(line)`, `wordText(w)`, `calleeOf(p, retPc)`, `RegisterRow`, `registerRows(s)`, `unwrittenMeaning(s)`, `unwrittenLegend(s, rows)`, `backRefs(s, at, tag)`, `frames(n)`, `heapSummary(s)`.
- Produces `asm-pane.ts`: `AsmPane` — `constructor(host, on: PaneEvents, panels: AsmPanels = {})`, `setProgram(p: AsmProgram | null)`, `render(frame: AsmState | null, controls)`, `setLink(instrs, scrollTo)`, `setFocus(instrs)` (a pure setter, before `render`), `setBindings`, `setDetached`, `setLayoutControls`, `setStepsShown` — satisfying `PaneView<AsmState>`. `AsmPanels = { listing?, registers?, stack?, heap? }`, the names panels are stored under.
- `PaneEvents` gains `linkInstr?: (pc: number) => void`, which Task 8 wires.

**BUILT AND TESTED ON ITS OWN, BEFORE THE LEG REACHES IT.** Adding `'asm'` to `Leg` makes every view's title menu offer `asm · program`, so the view must exist first (what the prototype found, 7). `asm-pane.test.ts` builds it as `tm-follow-clamp.test.ts` builds a TM view: a host sized by hand, stubbed events, frames written in `AsmState::window`'s shape.

**THE LAYOUT (spec §6.1, amendment 9).** A flex column whose open panels share the height: the listing two shares, the registers and call stack side by side in one (`.asm-machine`, a wrapping row, so they stack when the view is narrow), the heap one; each body keeps five rows. Each panel's toggle and actions are in its own header; `follow current instruction` rides in the listing's. The row carries the panels' top spacing, since a panel's own margin inside it would sit inside the row's share (what the prototype found, 9).

**THE LISTING (§6.2)** is a `VirtualGrid` with the rule table's CSS rules extended to its rows: labels above the instructions they name, as `print_asm` prints them; an instruction reads `pc5 jz r1, else2`; the instruction `AsmState.next` names is `.is-next` with `aria-current="step"` and says "runs next" as generated content, and it is the row following keeps in view. After a halt or a fault `next` is `null` and nothing is marked.

**THE PANELS (§6.3–§6.5)** are drawn whole: each shows a window core already bounded. A register reads by its tag (`42`, `#3`, `nil`, `box #2`); the one the last step wrote is outlined and says "changed by the last instruction"; a local the call has not written is dimmed behind a `·` and says "left over from caller" — "not written yet" at depth 0 (amendment 18). The call stack is top first, each frame its callee (read off the `call` before its return pc), `→ pc14` and its saved locals; the heap is newest first, each cell with the *list* registers whose word it is.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=6
diff --git a/web/tests/browser/asm-pane.test.ts b/web/tests/browser/asm-pane.test.ts
new file mode 100644
index 0000000..eb15b87
--- /dev/null
+++ b/web/tests/browser/asm-pane.test.ts
@@ -0,0 +1,323 @@
+import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
+import { page, userEvent } from 'vitest/browser'
+import { AsmPane } from '../../src/asm-pane'
+import type { PaneEvents } from '../../src/pane-chrome'
+import type { AsmProgram, AsmWord } from '../../src/types'
+import { FACT3, frameOf } from '../node/asm-fixtures'
+import { until } from './harness'
+
+/**
+ * The asm view on its own (Plan 7 part 5 spec §6), built as `tm-follow-clamp.test.ts` builds a TM view: a host sized by
+ * hand, the pane's events stubbed, and frames written by hand in the shape `AsmState::window` produces. The app-level
+ * suite drives the same view from a real compile.
+ */
+
+const CONTROLS = {
+  canRestart: true,
+  canBack: true,
+  canForward: true,
+  canPlay: true,
+  playing: false,
+  stepText: 'step 3 of 55',
+  continueLabel: null,
+}
+
+const v = (word: string): AsmWord => ({ word, tag: 'Value' })
+const l = (word: string): AsmWord => ({ word, tag: 'List' })
+const b = (word: string): AsmWord => ({ word, tag: 'Box' })
+
+function events(over: Partial<PaneEvents> = {}): PaneEvents {
+  return {
+    back: vi.fn(),
+    forward: vi.fn(),
+    play: vi.fn(),
+    restart: vi.fn(),
+    extend: vi.fn(),
+    speed: () => 8,
+    setSpeed: vi.fn(),
+    rebind: vi.fn(),
+    ...over,
+  }
+}
+
+/** A view in a host `height` pixels tall and `width` wide, attached to the page, with `program` set. */
+function mount(program: AsmProgram | null, on: PaneEvents = events(), height = 900, width = 1000) {
+  const host = document.createElement('section')
+  host.className = 'pane'
+  host.dataset.kind = 'asm'
+  host.style.height = `${height}px`
+  host.style.width = `${width}px`
+  document.body.append(host)
+  const pane = new AsmPane(host, on)
+  pane.setProgram(program)
+  return { host, pane }
+}
+
+const listing = (host: HTMLElement) => host.querySelector('.asm-listing') as HTMLElement
+const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.asm-row')]
+const rowText = (r: HTMLElement) => (r.querySelector('.asm-cell') as HTMLElement).textContent
+/** The drawn row showing instruction `pc`, found by its text since rows are rebuilt on every draw. */
+const rowOfPc = (host: HTMLElement, pc: number) => rows(host).find((r) => rowText(r)?.startsWith(`pc${pc}`) === true)
+const panel = (host: HTMLElement, name: string) => host.querySelector(`[data-panel="${name}"]`) as HTMLElement
+const registers = (host: HTMLElement) =>
+  [...host.querySelectorAll<HTMLElement>('.asm-register')].map((r) => ({
+    name: r.querySelector('dt')?.textContent,
+    value: r.querySelector('dd')?.textContent,
+    said: r.querySelector('dd')?.getAttribute('aria-description') ?? null,
+    changed: r.classList.contains('is-changed'),
+    unwritten: r.classList.contains('is-unwritten'),
+  }))
+const lines = (host: HTMLElement, selector: string) =>
+  [...host.querySelectorAll<HTMLElement>(`${selector} > li`)].map((li) => li.textContent)
+
+/** A long straight-line program, so the listing has somewhere to scroll: `li r0, #i` 400 times, then `halt`. */
+const LONG: AsmProgram = {
+  listing: [...Array.from({ length: 400 }, (_, i) => `li\tr0, #${i}`), 'halt'],
+  labels: [],
+}
+
+// A VIEWPORT AS WIDE AS A VIEW: the default is 414 pixels, narrower than the hosts below, and a real click aimed at the
+// middle of a row that runs past the page's edge lands on nothing.
+beforeAll(async () => {
+  await page.viewport(1280, 1000)
+})
+
+afterEach(() => {
+  document.body.innerHTML = ''
+})
+
+describe('the asm listing', () => {
+  it('draws each label above the instruction it names, and each instruction as pc, mnemonic and operands', () => {
+    const { host } = mount(FACT3)
+    expect(listing(host).getAttribute('role')).toBe('grid')
+    expect(listing(host).getAttribute('aria-rowcount')).toBe('25')
+    const drawn = rows(host).map(rowText)
+    expect(drawn.slice(0, 3)).toEqual(['pc0jmp skip1', 'fact.0:', 'pc1mov r0, a0'])
+    expect(rows(host)[1]?.classList.contains('is-label')).toBe(true)
+    expect(rowOfPc(host, 5)?.querySelector('.asm-mnemonic')?.textContent).toBe('jz')
+  })
+
+  it('marks the instruction about to run, and says "runs next" in words, not colour alone', () => {
+    const { host, pane } = mount(FACT3)
+    pane.render(frameOf({ pc: 13, next: 13 }), CONTROLS)
+    const next = rowOfPc(host, 13) as HTMLElement
+    expect(next.classList.contains('is-next')).toBe(true)
+    expect(next.getAttribute('aria-current')).toBe('step')
+    const cell = next.querySelector('.asm-cell') as HTMLElement
+    expect(getComputedStyle(cell, '::before').content).toBe('"runs next"')
+    expect(host.querySelectorAll('.asm-row.is-next')).toHaveLength(1)
+  })
+
+  it('marks nothing as running next once the run has ended', () => {
+    const { host, pane } = mount(FACT3)
+    pane.render(frameOf({ pc: 20, next: null }), CONTROLS)
+    expect(host.querySelector('.asm-row.is-next')).toBeNull()
+  })
+
+  it('follows the instruction about to run, stops at a user scroll, and follows again on "follow current instruction"', async () => {
+    const { host, pane } = mount(LONG)
+    const reattach = () => panel(host, 'listing').querySelector('.table-reattach') as HTMLButtonElement
+    pane.render(frameOf({ pc: 300, next: 300 }), CONTROLS)
+    expect(rowOfPc(host, 300)).toBeDefined()
+    expect(reattach().hidden).toBe(true)
+    listing(host).scrollTop = 0
+    await until(() => !reattach().hidden, 'a user scroll to stop following')
+    pane.render(frameOf({ pc: 301, next: 301 }), CONTROLS)
+    expect(rowOfPc(host, 301)).toBeUndefined()
+    await userEvent.click(reattach())
+    expect(reattach().hidden).toBe(true)
+    expect(rowOfPc(host, 301)).toBeDefined()
+  })
+
+  it('links the instruction a real click lands on, from the focus elsewhere, and a label row links nothing', async () => {
+    const linkInstr = vi.fn()
+    const { host, pane } = mount(FACT3, events({ linkInstr }))
+    pane.render(frameOf({ pc: 0, next: 0 }), CONTROLS)
+    const elsewhere = document.createElement('button')
+    document.body.prepend(elsewhere)
+    elsewhere.focus()
+    await userEvent.click(rowOfPc(host, 4) as HTMLElement)
+    expect(linkInstr).toHaveBeenCalledExactlyOnceWith(4)
+    expect(document.activeElement).toBe(listing(host))
+    const label = rows(host).find((r) => rowText(r) === 'else2:') as HTMLElement
+    await userEvent.click(label)
+    expect(linkInstr).toHaveBeenCalledTimes(1)
+  })
+
+  it('links the active instruction on Enter', async () => {
+    const linkInstr = vi.fn()
+    const { host } = mount(FACT3, events({ linkInstr }))
+    listing(host).focus()
+    // Row 2 is pc1, under `fact.0`.
+    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
+    expect(linkInstr).toHaveBeenCalledExactlyOnceWith(1)
+  })
+
+  it('marks a link and the running focus on their instructions, and holds a link made elsewhere until the run moves', () => {
+    const { host, pane } = mount(LONG)
+    pane.render(frameOf({ pc: 0, next: 0 }), CONTROLS)
+    pane.setLink([350, 351], true)
+    expect(rowOfPc(host, 350)?.classList.contains('is-linked')).toBe(true)
+    expect(rowOfPc(host, 351)?.classList.contains('is-linked')).toBe(true)
+    pane.render(frameOf({ pc: 0, next: 0 }), CONTROLS)
+    expect(rowOfPc(host, 350), 'a redraw of the same step keeps the link in view').toBeDefined()
+    pane.setFocus([2])
+    pane.render(frameOf({ step: 1, pc: 1, next: 1 }), CONTROLS)
+    // The run moved: following the running instruction brought the listing back to the top.
+    expect(rowOfPc(host, 2)?.classList.contains('is-focus')).toBe(true)
+    expect(rowOfPc(host, 350)).toBeUndefined()
+  })
+
+  it('clears on a program that is not there', () => {
+    const { host, pane } = mount(FACT3)
+    pane.setProgram(null)
+    expect(rows(host)).toHaveLength(0)
+    expect(listing(host).hasAttribute('aria-rowcount')).toBe(false)
+  })
+})
+
+describe('the registers', () => {
+  it('show pc, rr, the arguments and the locals, each word read by its tag', () => {
+    const { host, pane } = mount(FACT3)
+    pane.render(
+      frameOf({
+        pc: 7,
+        rr: l('2'),
+        args: [v('18446744073709551615')],
+        locals: [l('0'), b('1')],
+        written: [true, true],
+      }),
+      CONTROLS,
+    )
+    expect(registers(host).map((r) => [r.name, r.value])).toEqual([
+      ['pc', '7'],
+      ['rr', '#2'],
+      ['a0', '18446744073709551615'],
+      ['r0', 'nil'],
+      ['r1', 'box #1'],
+    ])
+  })
+
+  it('mark the register the last instruction wrote, in words as well as by shape', () => {
+    const { host, pane } = mount(FACT3)
+    pane.render(frameOf({ locals: [v('1'), v('2')], written: [true, true], wrote: 'r1' }), CONTROLS)
+    const r1 = registers(host).find((r) => r.name === 'r1')
+    expect(r1).toMatchObject({ changed: true, said: 'changed by the last instruction' })
+    expect(registers(host).filter((r) => r.changed)).toHaveLength(1)
+  })
+
+  it('dim a local the call has not written, mark it ·, and say it is left over from the caller', () => {
+    const { host, pane } = mount(FACT3)
+    pane.render(frameOf({ depth: 1, locals: [v('3'), v('9')], written: [true, false] }), CONTROLS)
+    const r1 = registers(host).find((r) => r.name === '· r1')
+    expect(r1).toMatchObject({ unwritten: true, said: 'left over from caller' })
+    expect(host.querySelector('.asm-legend')?.textContent).toBe('· left over from caller')
+    const r0 = registers(host).find((r) => r.name === 'r0')
+    expect(r0).toMatchObject({ unwritten: false, said: null })
+  })
+
+  it('say how many registers are past the window', () => {
+    const { host, pane } = mount(FACT3)
+    pane.render(frameOf({ locals: [v('1')], written: [true], locals_len: 70, args: [v('1')], args_len: 17 }), CONTROLS)
+    const notes = [...panel(host, 'registers').querySelectorAll('.asm-note')].map((n) => n.textContent)
+    expect(notes).toContain('+69 more locals')
+    expect(notes).toContain('+16 more arguments')
+  })
+})
+
+describe('the call stack', () => {
+  it('lists the frames top first, each its function, its return pc and its saved locals, with a count', () => {
+    const { host, pane } = mount(FACT3)
+    pane.render(
+      frameOf({
+        depth: 2,
+        frames: [
+          { ret_pc: 14, saved: [v('2'), v('0')], saved_len: 2 },
+          { ret_pc: 20, saved: [v('3')], saved_len: 1 },
+        ],
+      }),
+      CONTROLS,
+    )
+    expect(panel(host, 'stack').querySelector('.panel-note')?.textContent).toBe('2 frames')
+    expect(lines(host, '.asm-stack')).toEqual(['fact.0 → pc14 r0 2 · r1 0', 'fact.0 → pc20 r0 3'])
+  })
+
+  it('says how many frames are past the window, and when the run is inside no call', () => {
+    const { host, pane } = mount(FACT3)
+    pane.render(frameOf({ depth: 12, frames: [{ ret_pc: 14, saved: [], saved_len: 0 }] }), CONTROLS)
+    expect(lines(host, '.asm-stack').at(-1)).toBe('+11 more')
+    pane.render(frameOf({ depth: 0 }), CONTROLS)
+    expect(lines(host, '.asm-stack')).toEqual(['not inside a call'])
+    expect(panel(host, 'stack').querySelector('.panel-note')?.textContent).toBe('0 frames')
+  })
+})
+
+describe('the heap', () => {
+  it('lists the cells newest first with the list registers that name them, then the boxes, with a count', () => {
+    const { host, pane } = mount(FACT3)
+    pane.render(
+      frameOf({
+        locals: [l('3'), b('1')],
+        written: [true, true],
+        heap_len: 3,
+        cells: [
+          { cell: 3, head: v('1'), tail: l('2') },
+          { cell: 2, head: v('2'), tail: l('0') },
+        ],
+        box_len: 1,
+        boxes: [{ handle: 1, content: v('7') }],
+      }),
+      CONTROLS,
+    )
+    expect(panel(host, 'heap').querySelector('.panel-note')?.textContent).toBe('3 cells · 1 box')
+    expect(lines(host, '.asm-heap')).toEqual(['#3 1 → #2 ← r0', '#2 2 → nil', '+1 older', 'box #1 7 ← r1'])
+  })
+
+  it('says when it is empty', () => {
+    const { host, pane } = mount(FACT3)
+    pane.render(frameOf(), CONTROLS)
+    expect(lines(host, '.asm-heap')).toEqual(['empty'])
+  })
+})
+
+describe('the panels', () => {
+  it('share the view: the listing two shares, the registers and call stack one side by side, the heap one', () => {
+    const { host, pane } = mount(FACT3)
+    pane.render(frameOf(), CONTROLS)
+    const h = (name: string) => panel(host, name).getBoundingClientRect()
+    expect(h('listing').height / h('heap').height).toBeCloseTo(2, 0)
+    expect(h('registers').top).toBe(h('stack').top)
+    expect(h('registers').height).toBe(h('heap').height)
+  })
+
+  it('stack the registers and the call stack when the view is too narrow for both', () => {
+    const { host, pane } = mount(FACT3, events(), 900, 400)
+    pane.render(frameOf(), CONTROLS)
+    expect(panel(host, 'stack').getBoundingClientRect().top).toBeGreaterThan(
+      panel(host, 'registers').getBoundingClientRect().top,
+    )
+  })
+
+  it('report each toggle by name, and open as stored', async () => {
+    const panelEvent = vi.fn()
+    const host = document.createElement('section')
+    host.className = 'pane'
+    host.dataset.kind = 'asm'
+    host.style.height = '900px'
+    document.body.append(host)
+    new AsmPane(host, events({ panel: panelEvent }), { heap: false })
+    expect(panel(host, 'heap').dataset.open).toBe('false')
+    expect(panel(host, 'listing').dataset.open).toBe('true')
+    await userEvent.click(panel(host, 'registers').querySelector('.panel-toggle') as HTMLElement)
+    expect(panelEvent).toHaveBeenCalledExactlyOnceWith('registers', false)
+  })
+})
+
+describe('at the width of a real view', () => {
+  it('lays out at 1280 by 800 without a horizontal scroll', async () => {
+    await page.viewport(1280, 800)
+    const { host, pane } = mount(FACT3, events(), 780, 620)
+    pane.render(frameOf({ depth: 1, locals: [v('1'), v('2')], written: [true, false], pc: 4, next: 4 }), CONTROLS)
+    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth)
+  })
+})
diff --git a/web/tests/node/asm-fixtures.ts b/web/tests/node/asm-fixtures.ts
new file mode 100644
index 0000000..7ce285e
--- /dev/null
+++ b/web/tests/node/asm-fixtures.ts
@@ -0,0 +1,70 @@
+import type { AsmProgram, AsmState } from '../../src/types'
+
+/**
+ * `fact(3)`'s asm listing and labels, as `redextape --no-config emit fact.rxt --lang asm` prints them for
+ * `fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)` — 21 instructions and 4 labels (spec §2.5). Each
+ * line is `print_instr`'s, a tab between mnemonic and operands.
+ */
+export const FACT3: AsmProgram = {
+  listing: [
+    'jmp\tskip1',
+    'mov\tr0, a0',
+    'mov\tr2, r0',
+    'li\tr3, #0',
+    'cmpeq\tr1, r2, r3',
+    'jz\tr1, else2',
+    'li\trr, #1',
+    'jmp\tendif3',
+    'mov\tr4, r0',
+    'mov\tr7, r0',
+    'li\tr8, #1',
+    'sub\tr6, r7, r8',
+    'mov\ta0, r6',
+    'call\tfact.0',
+    'mov\tr5, rr',
+    'mul\trr, r4, r5',
+    'ret',
+    'li\tr0, #3',
+    'mov\ta0, r0',
+    'call\tfact.0',
+    'halt',
+  ],
+  labels: [
+    ['fact.0', 1],
+    ['else2', 8],
+    ['endif3', 16],
+    ['skip1', 17],
+  ],
+}
+
+/**
+ * A frame with nothing in it but what `over` says: step 0, `pc` 0, `rr` the value 0, no registers, no frames, an empty
+ * heap. `locals_len`, `args_len`, `heap_len` and `box_len` default to what the window shows, so a fixture that windows
+ * nothing need not say them.
+ */
+export function frameOf(over: Partial<AsmState> = {}): AsmState {
+  const locals = over.locals ?? []
+  const args = over.args ?? []
+  const cells = over.cells ?? []
+  const boxes = over.boxes ?? []
+  return {
+    step: 0,
+    pc: 0,
+    next: 0,
+    rr: { word: '0', tag: 'Value' },
+    written: locals.map(() => true),
+    locals_len: locals.length,
+    args_len: args.length,
+    wrote: null,
+    depth: 0,
+    frames: [],
+    heap_len: cells.length,
+    box_len: boxes.length,
+    source_node: null,
+    ...over,
+    locals,
+    args,
+    cells,
+    boxes,
+  }
+}
diff --git a/web/tests/node/asm-view.test.ts b/web/tests/node/asm-view.test.ts
new file mode 100644
index 0000000..9c6df23
--- /dev/null
+++ b/web/tests/node/asm-view.test.ts
@@ -0,0 +1,172 @@
+import { describe, expect, it } from 'vitest'
+import {
+  backRefs,
+  calleeOf,
+  frames,
+  heapSummary,
+  instrParts,
+  listingRows,
+  registerRows,
+  rowsOfPcs,
+  unwrittenLegend,
+  unwrittenMeaning,
+  wordText,
+} from '../../src/asm-view'
+import type { AsmProgram, AsmState, AsmWord } from '../../src/types'
+import { FACT3, frameOf } from './asm-fixtures'
+
+const v = (word: string): AsmWord => ({ word, tag: 'Value' })
+const l = (word: string): AsmWord => ({ word, tag: 'List' })
+const b = (word: string): AsmWord => ({ word, tag: 'Box' })
+
+describe('the listing', () => {
+  it('puts each instruction under its labels, as print_asm prints them', () => {
+    const rows = listingRows(FACT3)
+    // 21 instructions and 4 labels: `fact.0` above pc1, `else2` above pc8, `endif3` above pc16, `skip1` above pc17.
+    expect(rows).toHaveLength(25)
+    expect(rows.slice(0, 3)).toEqual([
+      { kind: 'instr', pc: 0 },
+      { kind: 'label', name: 'fact.0' },
+      { kind: 'instr', pc: 1 },
+    ])
+    expect(rows.slice(18, 22)).toEqual([
+      { kind: 'label', name: 'endif3' },
+      { kind: 'instr', pc: 16 },
+      { kind: 'label', name: 'skip1' },
+      { kind: 'instr', pc: 17 },
+    ])
+  })
+
+  it('draws a label past the last instruction after it, and two labels on one instruction in labels order', () => {
+    const p: AsmProgram = {
+      listing: ['halt'],
+      labels: [
+        ['b', 0],
+        ['a', 0],
+        ['end', 1],
+      ],
+    }
+    expect(listingRows(p)).toEqual([
+      { kind: 'label', name: 'b' },
+      { kind: 'label', name: 'a' },
+      { kind: 'instr', pc: 0 },
+      { kind: 'label', name: 'end' },
+    ])
+  })
+
+  it("finds each instruction's row", () => {
+    const rowOf = rowsOfPcs(listingRows(FACT3))
+    expect(rowOf[0]).toBe(0)
+    expect(rowOf[1]).toBe(2)
+    expect(rowOf[20]).toBe(24)
+    expect(rowOf).toHaveLength(21)
+  })
+
+  it("splits an instruction at the listing's tab, and leaves one with no operands whole", () => {
+    expect(instrParts('jz\tr1, else2')).toEqual({ mnemonic: 'jz', operands: 'r1, else2' })
+    expect(instrParts('halt')).toEqual({ mnemonic: 'halt', operands: '' })
+  })
+})
+
+describe('a word', () => {
+  it('reads by its tag: a value in decimal, a list as its cell or nil, a box as its handle', () => {
+    expect(wordText(v('42'))).toBe('42')
+    expect(wordText(l('3'))).toBe('#3')
+    expect(wordText(l('0'))).toBe('nil')
+    expect(wordText(b('2'))).toBe('box #2')
+  })
+
+  it('keeps a saturated value exact, as the decimal string it came as', () => {
+    expect(wordText(v('18446744073709551615'))).toBe('18446744073709551615')
+  })
+})
+
+describe('a call frame', () => {
+  it('names the function the call before its return pc named', () => {
+    // pc13 is `call fact.0`, so a frame returning to pc14 was called by it.
+    expect(calleeOf(FACT3, 14)).toBe('fact.0')
+    expect(calleeOf(FACT3, 20)).toBe('fact.0')
+  })
+
+  it('names nothing when the instruction before its return pc is not a call', () => {
+    expect(calleeOf(FACT3, 15)).toBeNull()
+    expect(calleeOf(FACT3, 0)).toBeNull()
+  })
+})
+
+describe('the registers', () => {
+  it('list pc, rr, the arguments and the locals in that order, each read by its tag', () => {
+    const s = frameOf({ pc: 7, rr: l('2'), args: [v('3')], locals: [v('1'), b('1')], written: [true, true] })
+    expect(registerRows(s).map((r) => [r.name, r.text])).toEqual([
+      ['pc', '7'],
+      ['rr', '#2'],
+      ['a0', '3'],
+      ['r0', '1'],
+      ['r1', 'box #1'],
+    ])
+  })
+
+  it('mark the register the last instruction wrote, and only that one', () => {
+    const s = frameOf({ locals: [v('1'), v('2')], written: [true, true], args: [v('0')], wrote: 'r1' })
+    expect(
+      registerRows(s)
+        .filter((r) => r.changed)
+        .map((r) => r.name),
+    ).toEqual(['r1'])
+    expect(
+      registerRows(frameOf({ wrote: 'rr' }))
+        .filter((r) => r.changed)
+        .map((r) => r.name),
+    ).toEqual(['rr'])
+    expect(
+      registerRows(frameOf({ args: [v('0')], wrote: 'a0' }))
+        .filter((r) => r.changed)
+        .map((r) => r.name),
+    ).toEqual(['a0'])
+  })
+
+  it('mark a local the current call has not written, and never an argument or rr', () => {
+    const s = frameOf({ depth: 1, args: [v('2')], locals: [v('5'), v('6')], written: [true, false] })
+    expect(
+      registerRows(s)
+        .filter((r) => r.unwritten)
+        .map((r) => r.name),
+    ).toEqual(['r1'])
+  })
+
+  it('say an unwritten local is left over from the caller only inside a call', () => {
+    const inside = frameOf({ depth: 2, locals: [v('5')], written: [false] })
+    const top = frameOf({ depth: 0, locals: [v('0')], written: [false] })
+    expect(unwrittenMeaning(inside)).toBe('left over from caller')
+    expect(unwrittenLegend(inside, registerRows(inside))).toBe('· left over from caller')
+    expect(unwrittenMeaning(top)).toBe('not written yet')
+    expect(unwrittenLegend(top, registerRows(top))).toBe('· not written yet')
+    const written = frameOf({ depth: 2, locals: [v('5')], written: [true] })
+    expect(unwrittenLegend(written, registerRows(written))).toBeNull()
+  })
+})
+
+describe('the heap', () => {
+  it("names the registers of a cell's own tag whose word is that cell", () => {
+    const s: AsmState = frameOf({
+      rr: l('3'),
+      args: [l('3')],
+      locals: [v('3'), l('3'), l('2')],
+      written: [true, true, true],
+    })
+    expect(backRefs(s, 3, 'List')).toEqual(['rr', 'a0', 'r1'])
+    expect(backRefs(s, 2, 'List')).toEqual(['r2'])
+    expect(backRefs(s, 3, 'Box')).toEqual([])
+  })
+
+  it('counts cells, and boxes only when there are some', () => {
+    expect(heapSummary(frameOf({ heap_len: 57, box_len: 2 }))).toBe('57 cells · 2 boxes')
+    expect(heapSummary(frameOf({ heap_len: 1, box_len: 1 }))).toBe('1 cell · 1 box')
+    expect(heapSummary(frameOf({ heap_len: 0, box_len: 0 }))).toBe('0 cells')
+  })
+
+  it('counts frames', () => {
+    expect(frames(1)).toBe('1 frame')
+    expect(frames(1001)).toBe('1,001 frames')
+  })
+})
````


- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts`

Expected: exit 1, printing:

```text
    Test Files  2 failed (2)
    Tests  no tests
    FAIL  |node| tests/node/asm-view.test.ts [ tests/node/asm-view.test.ts ]
    FAIL  |browser (chromium)| tests/browser/asm-pane.test.ts [ tests/browser/asm-pane.test.ts ]
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=6
diff --git a/web/src/asm-pane.ts b/web/src/asm-pane.ts
new file mode 100644
index 0000000..56bc81f
--- /dev/null
+++ b/web/src/asm-pane.ts
@@ -0,0 +1,455 @@
+import {
+  backRefs,
+  calleeOf,
+  frames,
+  heapSummary,
+  instrParts,
+  type ListingRow,
+  listingRows,
+  registerRows,
+  rowsOfPcs,
+  unwrittenLegend,
+  unwrittenMeaning,
+  wordText,
+} from './asm-view'
+import type { ControlState } from './controls'
+import { n } from './format'
+import type { Dir } from './layout'
+import type { PaneChoice, PaneEvents, SplitChoices } from './pane-chrome'
+import { createPanel, type Panel } from './panel'
+import type { Leg } from './protocol'
+import type { Binding, PaneOption } from './sessions'
+import { stepControls } from './step-controls'
+import type { AsmProgram, AsmState } from './types'
+import { type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
+import { type GridRows, VirtualGrid } from './virtual-grid'
+
+/** Mints each view's listing a prefix for its cells' ids, which `aria-activedescendant` names. */
+let listingsMinted = 0
+
+/** Which panels a view has, by the name each is stored under in the workspace (`workspace.ts`'s `Panels`). */
+export type AsmPanels = {
+  readonly listing?: boolean
+  readonly registers?: boolean
+  readonly stack?: boolean
+  readonly heap?: boolean
+}
+
+/**
+ * The asm view (Plan 7 part 5 spec §6): the program's listing, and the machine's registers, call stack and heap as it
+ * stands at the displayed step.
+ *
+ * **A PAGE OF PANELS SHARING THE VIEW'S HEIGHT, AS THE TM VIEW'S ARE** (spec §6.1; `style.css`'s `.asm-pane` rules):
+ * the listing two shares, the registers and call stack side by side in one share, the heap one. Each panel's toggle and
+ * actions sit in its own header, not the view's (amendment 9), and its open state is saved per view.
+ *
+ * **THE LISTING IS A `VirtualGrid`**, the rule table's (amendment 7): one tab stop, a roving active row, a click that
+ * survives the redraw focusing causes, and following the instruction about to run until the user scrolls away.
+ *
+ * **THE PANELS ARE DRAWN WHOLE, NOT VIRTUALIZED.** Each shows a window core already bounded (`AsmState`'s: 64 locals, 16
+ * arguments, 8 frames, 16 cells and 16 boxes, set in `protocol.ts`), so a frame's panels are at most a few hundred short
+ * lines however long the run.
+ *
+ * `AsmPane` SATISFIES `PaneView<AsmState>`, as the λ and TM views satisfy theirs, with no `implements` clause —
+ * `sessions.ts`'s `PaneView` doc says why the parameterisation is the check.
+ */
+export class AsmPane {
+  #header: ViewHeader
+  #steps: ReturnType<typeof stepControls>
+  #menu: ViewMenu
+  /** What this view's split menus offer — `TmPane.#choices`'s twin. */
+  #choices: SplitChoices = { options: [], sourceAvailable: false, current: null }
+  #body: HTMLElement
+  #program: AsmProgram | null = null
+  #rows: readonly ListingRow[] = []
+  /** Each instruction's row in `#rows`, so following and the marks find an instruction's row in one lookup. */
+  #rowOf: number[] = []
+  #frame: AsmState | null = null
+  /** The instructions a link pinned, by index — marked `is-linked` (spec §6.6). */
+  #linked: ReadonlySet<number> = new Set()
+  /** The instructions the running focus names — marked `is-focus`, a second layer beside the pin, as the TM view's. */
+  #focused: ReadonlySet<number> = new Set()
+  #grid: VirtualGrid
+  #listingPanel: Panel
+  /** Re-attaches following — `follow current instruction`, in the listing panel's header (amendment 9). */
+  #reattach: HTMLButtonElement
+  #registersPanel: Panel
+  #registers: HTMLElement
+  #stackPanel: Panel
+  #stack: HTMLElement
+  #stackCount: HTMLElement
+  #heapPanel: Panel
+  #heap: HTMLElement
+  #heapCount: HTMLElement
+
+  /**
+   * `panels` is the view's stored panel state, read once here; each panel reports every later toggle through
+   * `on.panel`. Every panel opens by default.
+   */
+  constructor(host: HTMLElement, on: PaneEvents, panels: AsmPanels = {}) {
+    this.#header = viewHeader(on.rebind)
+    this.#steps = stepControls(on)
+    // NO `format` AND NO `edit a copy`: a view showing a running leg has no document to format, and a copy of the asm is
+    // part 5c's. Removed, not disabled — the umbrella's rule for a control that cannot apply here.
+    this.#menu = viewMenu(this.#header.actions, {
+      ...(on.splitRow !== undefined && on.splitColumn !== undefined
+        ? { split: (dir: Dir, c: PaneChoice) => (dir === 'row' ? on.splitRow?.(c) : on.splitColumn?.(c)) }
+        : {}),
+      ...(on.close !== undefined ? { close: on.close } : {}),
+      choices: () => this.#choices,
+    })
+
+    // ADDED AND REMOVED, NEVER DISABLED — the rule table's `follow current rule`, for the same reason: a re-attach does
+    // something only while the listing has stopped following. The grid's `beforeDraw` keeps `hidden` in step.
+    this.#reattach = document.createElement('button')
+    this.#reattach.type = 'button'
+    this.#reattach.className = 'table-reattach'
+    this.#reattach.textContent = 'follow current instruction'
+    this.#reattach.hidden = true
+    this.#reattach.addEventListener('click', () => {
+      const had = document.activeElement === this.#reattach
+      this.#grid.attach()
+      // THE BUTTON HIDES ITSELF AND MUST NOT TAKE THE FOCUS WITH IT: the panel's own toggle, beside it, takes it.
+      if (had && this.#reattach.hidden) this.#listingPanel.toggle.focus()
+    })
+
+    // THE LISTING (spec §6.2). A row links the construct its instruction was lowered from (spec §6.6); a label row names
+    // no instruction and links nothing.
+    this.#grid = new VirtualGrid({
+      classes: { box: 'asm-listing', spacer: 'asm-spacer', rows: 'asm-rows', row: 'asm-row' },
+      idPrefix: `asm-grid-${listingsMinted++}`,
+      isOpen: () => this.#listingPanel.isOpen(),
+      rows: () => this.#listingRows(),
+      activate: (i) => {
+        const row = this.#rows[i]
+        if (row?.kind === 'instr') on.linkInstr?.(row.pc)
+      },
+      beforeDraw: () => {
+        this.#reattach.hidden = this.#program === null || this.#grid.following || !this.#listingPanel.isOpen()
+      },
+    })
+    // REDRAWN ON THE WAY UP AND DOWN, for the rule table's reasons: the draw keeps the re-attach's `hidden` true while
+    // the listing is closed, and a listing reopened after steps taken while it was closed has to follow again.
+    this.#listingPanel = createPanel({
+      name: 'listing',
+      label: 'listing',
+      body: this.#grid.el,
+      open: panels.listing ?? true,
+      onToggle: (open) => {
+        this.#grid.draw()
+        on.panel?.('listing', open)
+      },
+    })
+    this.#listingPanel.actions.append(this.#reattach)
+
+    this.#registers = document.createElement('div')
+    this.#registers.className = 'asm-registers'
+    this.#registersPanel = createPanel({
+      name: 'registers',
+      label: 'registers',
+      body: this.#registers,
+      open: panels.registers ?? true,
+      onToggle: (open) => on.panel?.('registers', open),
+    })
+
+    this.#stack = document.createElement('ol')
+    this.#stack.className = 'asm-stack'
+    this.#stackCount = document.createElement('span')
+    this.#stackCount.className = 'panel-note'
+    this.#stackPanel = createPanel({
+      name: 'stack',
+      label: 'call stack',
+      body: this.#stack,
+      open: panels.stack ?? true,
+      onToggle: (open) => on.panel?.('stack', open),
+    })
+    this.#stackPanel.actions.append(this.#stackCount)
+
+    this.#heap = document.createElement('ul')
+    this.#heap.className = 'asm-heap'
+    this.#heapCount = document.createElement('span')
+    this.#heapCount.className = 'panel-note'
+    this.#heapPanel = createPanel({
+      name: 'heap',
+      label: 'heap',
+      body: this.#heap,
+      open: panels.heap ?? true,
+      onToggle: (open) => on.panel?.('heap', open),
+    })
+    this.#heapPanel.actions.append(this.#heapCount)
+
+    // THE REGISTERS AND THE CALL STACK SHARE ONE ROW, side by side, and stack when the view is too narrow for both
+    // (spec §6.1) — a wrapping flex row, `style.css`'s `.asm-machine`.
+    const machine = document.createElement('div')
+    machine.className = 'asm-machine'
+    machine.append(this.#registersPanel.el, this.#stackPanel.el)
+
+    this.#body = document.createElement('div')
+    this.#body.className = 'asm-pane'
+    this.#body.append(this.#listingPanel.el, machine, this.#heapPanel.el)
+    this.#header.steps.append(this.#steps.el)
+    host.replaceChildren(this.#header.el, this.#body)
+  }
+
+  /**
+   * Set once per compile: the listing and its labels, which do not change as the run moves. `null` for a session with
+   * no asm leg, which clears the view.
+   */
+  setProgram(p: AsmProgram | null): void {
+    this.#program = p
+    this.#rows = p === null ? [] : listingRows(p)
+    this.#rowOf = rowsOfPcs(this.#rows)
+    // A new compile invalidates every instruction index a link or the running focus named.
+    this.#linked = new Set()
+    this.#focused = new Set()
+    this.#grid.reset()
+    this.#frame = null
+    this.#draw()
+  }
+
+  /**
+   * Mark the instructions a link pinned, scrolling the listing to the first of them unless the click came from this
+   * view (`scrollTo`): scrolling a list the user just clicked in moves the row out from under the pointer. The
+   * scroll holds over following until the run moves and leaves following as it was — `VirtualGrid.scrollToRow`.
+   */
+  setLink(instrs: readonly number[], scrollTo: boolean): void {
+    this.#linked = new Set(instrs)
+    if (scrollTo) {
+      const first = [...instrs].sort((a, b) => a - b)[0]
+      const row = first === undefined ? undefined : this.#rowOf[first]
+      if (row !== undefined) this.#grid.scrollToRow(row)
+    }
+    this.#grid.draw()
+  }
+
+  /**
+   * Mark the instructions the running focus names. **A PURE SETTER, CALLED BEFORE `render`**, for `TmPane.setFocus`'s
+   * reason: `render` draws anyway, and drawing here too would build every row twice a frame.
+   */
+  setFocus(instrs: readonly number[]): void {
+    this.#focused = new Set(instrs)
+  }
+
+  /** `copy · not linked`, in the title. The asm leg has no copies until part 5c, so today it is always `false`. */
+  setDetached(detached: boolean): void {
+    this.#header.setDetached(detached)
+  }
+
+  /** The `steps` switch, per `PaneView.setStepsShown` — the view's header owns the slot. */
+  setStepsShown(shown: boolean): void {
+    this.#header.setStepsShown(shown)
+  }
+
+  /** Offer `options` in the title and show `current` as the pair in force — `TmPane.setBindings`'s contract. */
+  setBindings(options: PaneOption[], current: Binding<Leg>): void {
+    this.#header.setBindings(options, current)
+  }
+
+  /** Which layout gestures this view offers, and what a split may create — `TmPane.setLayoutControls`'s contract. */
+  setLayoutControls(canClose: boolean, canSplit: boolean, choices: SplitChoices): void {
+    this.#choices = choices
+    this.#menu.setLayout(canClose, canSplit)
+  }
+
+  render(frame: AsmState | null, controls: ControlState): void {
+    this.#frame = frame
+    this.#steps.update(controls)
+    this.#draw()
+  }
+
+  #draw(): void {
+    this.#grid.draw()
+    this.#drawRegisters()
+    this.#drawStack()
+    this.#drawHeap()
+  }
+
+  /**
+   * The listing's rows for one draw: a label row names its label; an instruction row reads `pc5  jz  r1, else2`. The
+   * instruction about to run is `.is-next` and says "runs next" in words, as generated content — the not-colour cue
+   * the TM view's "fires next" has (spec §6.2) — and it is the row following keeps in view.
+   */
+  #listingRows(): GridRows {
+    if (this.#program === null) return { count: null, follow: null, fill: () => {} }
+    const program = this.#program
+    const next = this.#frame?.next ?? null
+    const nextRow = next === null ? null : (this.#rowOf[next] ?? null)
+    return {
+      count: this.#rows.length,
+      follow: nextRow,
+      fill: (i, el, cell) => {
+        const row = this.#rows[i]
+        if (row === undefined) return
+        cell.className = 'asm-cell'
+        if (row.kind === 'label') {
+          el.classList.add('is-label')
+          cell.textContent = `${row.name}:`
+          return
+        }
+        const { mnemonic, operands } = instrParts(program.listing[row.pc] ?? '')
+        const pc = document.createElement('span')
+        pc.className = 'asm-pc'
+        pc.textContent = `pc${row.pc}`
+        const m = document.createElement('b')
+        m.className = 'asm-mnemonic'
+        m.textContent = mnemonic
+        cell.append(pc, m)
+        if (operands !== '') cell.append(` ${operands}`)
+        if (i === nextRow) {
+          el.classList.add('is-next')
+          el.setAttribute('aria-current', 'step')
+          cell.dataset.marks = 'runs next'
+        }
+        if (this.#linked.has(row.pc)) el.classList.add('is-linked')
+        if (this.#focused.has(row.pc)) el.classList.add('is-focus')
+      },
+    }
+  }
+
+  /**
+   * The registers (spec §6.3): each name and word, the register the last step wrote marked *changed*, and each local
+   * the current call has not written dimmed and marked `·`, with a legend saying what that means. Every mark also says
+   * itself in an `aria-description`, so none is colour alone.
+   */
+  #drawRegisters(): void {
+    const frame = this.#frame
+    if (frame === null) {
+      this.#registers.replaceChildren()
+      return
+    }
+    const rows = registerRows(frame)
+    const legend = unwrittenLegend(frame, rows)
+    const list = document.createElement('dl')
+    list.className = 'asm-register-list'
+    for (const r of rows) {
+      const item = document.createElement('div')
+      item.className = 'asm-register'
+      const name = document.createElement('dt')
+      name.textContent = r.unwritten ? `· ${r.name}` : r.name
+      const value = document.createElement('dd')
+      value.textContent = r.text
+      const said: string[] = []
+      if (r.changed) {
+        item.classList.add('is-changed')
+        said.push('changed by the last instruction')
+      }
+      if (r.unwritten) {
+        item.classList.add('is-unwritten')
+        said.push(unwrittenMeaning(frame))
+      }
+      if (said.length > 0) value.setAttribute('aria-description', said.join('; '))
+      item.append(name, value)
+      list.append(item)
+    }
+    const notes: HTMLElement[] = []
+    const more = (hidden: number, what: string) => {
+      if (hidden <= 0) return
+      const p = document.createElement('p')
+      p.className = 'asm-note'
+      p.textContent = `+${n(hidden)} more ${what}`
+      notes.push(p)
+    }
+    more(frame.args_len - frame.args.length, frame.args_len - frame.args.length === 1 ? 'argument' : 'arguments')
+    more(frame.locals_len - frame.locals.length, frame.locals_len - frame.locals.length === 1 ? 'local' : 'locals')
+    if (legend !== null) {
+      const p = document.createElement('p')
+      p.className = 'asm-note asm-legend'
+      p.textContent = legend
+      notes.push(p)
+    }
+    this.#registers.replaceChildren(list, ...notes)
+  }
+
+  /**
+   * The call stack (spec §6.4), top first: each frame the function it called, `→ pc14` where `ret` resumes, and the
+   * caller's locals as they were at the call. Past the window, `+N more`.
+   */
+  #drawStack(): void {
+    const frame = this.#frame
+    const program = this.#program
+    if (frame === null || program === null) {
+      this.#stackCount.textContent = ''
+      this.#stack.replaceChildren()
+      return
+    }
+    this.#stackCount.textContent = frames(frame.depth)
+    if (frame.depth === 0) {
+      const li = document.createElement('li')
+      li.className = 'asm-note'
+      li.textContent = 'not inside a call'
+      this.#stack.replaceChildren(li)
+      return
+    }
+    const items = frame.frames.map((f) => {
+      const li = document.createElement('li')
+      li.className = 'asm-frame'
+      const callee = document.createElement('b')
+      callee.className = 'asm-callee'
+      callee.textContent = calleeOf(program, f.ret_pc) ?? '?'
+      const ret = document.createElement('span')
+      ret.className = 'asm-ret'
+      ret.textContent = `→ pc${f.ret_pc}`
+      const saved = document.createElement('span')
+      saved.className = 'asm-saved'
+      const words = f.saved.map((w, i) => `r${i} ${wordText(w)}`)
+      if (f.saved_len > f.saved.length) words.push(`+${n(f.saved_len - f.saved.length)} more`)
+      saved.textContent = words.join(' · ')
+      li.append(callee, ' ', ret, ' ', saved)
+      return li
+    })
+    const hidden = frame.depth - frame.frames.length
+    if (hidden > 0) {
+      const li = document.createElement('li')
+      li.className = 'asm-note'
+      li.textContent = `+${n(hidden)} more`
+      items.push(li)
+    }
+    this.#stack.replaceChildren(...items)
+  }
+
+  /**
+   * The heap (spec §6.5), newest first: `#57  57 → #56  ← r5` — the cell, its head and tail, and the *list* registers
+   * that name it — then the boxes. Past the window, `+N older`.
+   */
+  #drawHeap(): void {
+    const frame = this.#frame
+    if (frame === null) {
+      this.#heapCount.textContent = ''
+      this.#heap.replaceChildren()
+      return
+    }
+    this.#heapCount.textContent = heapSummary(frame)
+    const items: HTMLElement[] = []
+    const line = (lead: string, body: string, refs: readonly string[]) => {
+      const li = document.createElement('li')
+      li.className = 'asm-cell-line'
+      const at = document.createElement('b')
+      at.textContent = lead
+      li.append(at, ` ${body}`)
+      if (refs.length > 0) {
+        const r = document.createElement('span')
+        r.className = 'asm-refs'
+        r.textContent = `← ${refs.join(', ')}`
+        li.append(' ', r)
+      }
+      items.push(li)
+    }
+    for (const c of frame.cells) {
+      line(`#${c.cell}`, `${wordText(c.head)} → ${wordText(c.tail)}`, backRefs(frame, c.cell, 'List'))
+    }
+    const olderCells = frame.heap_len - frame.cells.length
+    if (olderCells > 0) items.push(note(`+${n(olderCells)} older`))
+    for (const b of frame.boxes) line(`box #${b.handle}`, wordText(b.content), backRefs(frame, b.handle, 'Box'))
+    const olderBoxes = frame.box_len - frame.boxes.length
+    if (olderBoxes > 0) items.push(note(`+${n(olderBoxes)} older ${olderBoxes === 1 ? 'box' : 'boxes'}`))
+    if (items.length === 0) items.push(note('empty'))
+    this.#heap.replaceChildren(...items)
+  }
+}
+
+function note(text: string): HTMLElement {
+  const li = document.createElement('li')
+  li.className = 'asm-note'
+  li.textContent = text
+  return li
+}
diff --git a/web/src/asm-view.ts b/web/src/asm-view.ts
new file mode 100644
index 0000000..74dcc0b
--- /dev/null
+++ b/web/src/asm-view.ts
@@ -0,0 +1,154 @@
+import { n } from './format'
+import type { AsmProgram, AsmState, AsmWord, WordTag } from './types'
+
+/**
+ * The asm view as data (Plan 7 part 5 spec §6): the listing's rows, how a word reads, and what the registers, call
+ * stack and heap panels say. Pure, so the DOM that draws them (`asm-pane.ts`) holds nothing a node test cannot
+ * reach — `program-level.ts`'s arrangement for the TM view's state diagram.
+ */
+
+/** One row of the listing: a label, above the instruction it names, or an instruction. Every row is one grid row. */
+export type ListingRow =
+  | { readonly kind: 'label'; readonly name: string }
+  | { readonly kind: 'instr'; readonly pc: number }
+
+/**
+ * The listing's rows. **AN INSTRUCTION'S LABELS COME FIRST, IN `labels` ORDER, AS `print_asm` PRINTS THEM** (spec
+ * §6.2); a label one past the last instruction is printed after it, and so drawn after it — `program-level.ts`'s
+ * `programRows` places the TM view's labels by the same rule.
+ */
+export function listingRows(p: AsmProgram): ListingRow[] {
+  const at = new Map<number, string[]>()
+  for (const [name, index] of p.labels) at.set(index, [...(at.get(index) ?? []), name])
+  const rows: ListingRow[] = []
+  for (let pc = 0; pc <= p.listing.length; pc += 1) {
+    for (const name of at.get(pc) ?? []) rows.push({ kind: 'label', name })
+    if (pc < p.listing.length) rows.push({ kind: 'instr', pc })
+  }
+  return rows
+}
+
+/** Each instruction's row among `rows`: `rowOf[pc]`. */
+export function rowsOfPcs(rows: readonly ListingRow[]): number[] {
+  const out: number[] = []
+  for (const [row, r] of rows.entries()) if (r.kind === 'instr') out[r.pc] = row
+  return out
+}
+
+/**
+ * An instruction's mnemonic and operands. The listing is `print_instr`'s text, which puts a tab between the two
+ * (`li\tr0, #40`); an instruction with no operands (`halt`, `ret`) has no tab.
+ */
+export function instrParts(line: string): { readonly mnemonic: string; readonly operands: string } {
+  const tab = line.indexOf('\t')
+  return tab < 0 ? { mnemonic: line, operands: '' } : { mnemonic: line.slice(0, tab), operands: line.slice(tab + 1) }
+}
+
+/**
+ * A word as the view reads it, by its tag (spec §6.3): a value in decimal; a list pointer as `#3`, the cell it names,
+ * or `nil` for the empty list; a box handle as `box #2`.
+ *
+ * **THE WORD IS A DECIMAL STRING ON THE WIRE AND STAYS ONE HERE** (spec §5.3, amendment 13): a saturated `mul`
+ * reaches `u64::MAX`, which a JS number cannot hold exactly. Grouping it with `n` would parse it first, so a value is
+ * printed as it came.
+ */
+export function wordText(w: AsmWord): string {
+  switch (w.tag) {
+    case 'Value':
+      return w.word
+    case 'List':
+      return w.word === '0' ? 'nil' : `#${w.word}`
+    case 'Box':
+      return `box #${w.word}`
+  }
+}
+
+/**
+ * The label a saved frame's function was called by: the operand of the `call` just before its return `pc`.
+ *
+ * **NOT CARRIED BY THE FRAME** (spec §5.3): the instruction before `ret_pc` is the `call` that pushed it, so the
+ * listing already says it. `null` when that instruction is not a `call` — which no program `ret` can return through
+ * produces, but a hand-written one could.
+ */
+export function calleeOf(p: AsmProgram, retPc: number): string | null {
+  const line = p.listing[retPc - 1]
+  if (line === undefined) return null
+  const { mnemonic, operands } = instrParts(line)
+  return mnemonic === 'call' && operands !== '' ? operands : null
+}
+
+/**
+ * One register as the registers panel shows it (spec §6.3). `changed` marks the register the last step wrote.
+ * `unwritten` marks a local the current call has not written: its word is whatever was there when the call began.
+ */
+export type RegisterRow = {
+  readonly name: string
+  readonly text: string
+  readonly changed: boolean
+  readonly unwritten: boolean
+}
+
+/**
+ * The registers panel's rows, in the spec's order: `pc`, `rr`, the arguments `a0…`, then the locals `r0…` — each as
+ * far as the frame's window carries them.
+ *
+ * **ONLY A LOCAL HAS A WRITTEN BIT.** `call` clears them all and `ret` restores the caller's (5a's written bits), so an
+ * unwritten local inside a call still holds its caller's word — the view's "left over from caller". An argument is
+ * written by the caller for the callee, and `rr` by whichever instruction last wrote it; neither is ever left over.
+ */
+export function registerRows(s: AsmState): RegisterRow[] {
+  const rows: RegisterRow[] = [
+    { name: 'pc', text: String(s.pc), changed: false, unwritten: false },
+    { name: 'rr', text: wordText(s.rr), changed: s.wrote === 'rr', unwritten: false },
+  ]
+  for (const [i, w] of s.args.entries()) {
+    const name = `a${i}`
+    rows.push({ name, text: wordText(w), changed: s.wrote === name, unwritten: false })
+  }
+  for (const [i, w] of s.locals.entries()) {
+    const name = `r${i}`
+    rows.push({ name, text: wordText(w), changed: s.wrote === name, unwritten: s.written[i] !== true })
+  }
+  return rows
+}
+
+/**
+ * What an unwritten local is, in words: the dimmed `·`'s meaning, and each such register's `aria-description`.
+ *
+ * **"LEFT OVER FROM CALLER" ONLY WHERE THERE IS A CALLER** (spec §6.3). At depth 0 an unwritten local was never written
+ * by anything — it exists because a write to a higher register grew the bank, and it reads 0 — so it says that instead.
+ */
+export function unwrittenMeaning(s: AsmState): string {
+  return s.depth > 0 ? 'left over from caller' : 'not written yet'
+}
+
+/** The legend under the registers, `· left over from caller`, or `null` when no register is unwritten. */
+export function unwrittenLegend(s: AsmState, rows: readonly RegisterRow[]): string | null {
+  return rows.some((r) => r.unwritten) ? `· ${unwrittenMeaning(s)}` : null
+}
+
+/**
+ * The registers a heap cell's or a box's back-reference names (spec §6.5): every register of `tag` whose word is the
+ * cell's or box's own number. **EXACT FOR A COMPILED PROGRAM**, whose every list word was made by `cons` or `nil` and
+ * copied since (5a's tag rules), so a `#57` in a *list* register is cell 57. A register past the frame's window is not
+ * here to name.
+ */
+export function backRefs(s: AsmState, at: number, tag: WordTag): string[] {
+  const word = String(at)
+  const out: string[] = []
+  if (s.rr.tag === tag && s.rr.word === word) out.push('rr')
+  for (const [i, w] of s.args.entries()) if (w.tag === tag && w.word === word) out.push(`a${i}`)
+  for (const [i, w] of s.locals.entries()) if (w.tag === tag && w.word === word) out.push(`r${i}`)
+  return out
+}
+
+/** How many frames a count names: `1 frame`, `4 frames`. */
+export function frames(count: number): string {
+  return `${n(count)} ${count === 1 ? 'frame' : 'frames'}`
+}
+
+/** The heap panel's count: `57 cells · 2 boxes`, with no boxes clause while there are none. */
+export function heapSummary(s: AsmState): string {
+  const cells = `${n(s.heap_len)} ${s.heap_len === 1 ? 'cell' : 'cells'}`
+  return s.box_len === 0 ? cells : `${cells} · ${n(s.box_len)} ${s.box_len === 1 ? 'box' : 'boxes'}`
+}
diff --git a/web/src/pane-chrome.ts b/web/src/pane-chrome.ts
index 0025a21..54e18c1 100644
--- a/web/src/pane-chrome.ts
+++ b/web/src/pane-chrome.ts
@@ -192,6 +192,8 @@ export type PaneEvents = {
   detachMachine?(): void
   /** A state row was clicked. Absent on panes that have no table. */
   linkState?: (stateId: number) => void
+  /** An instruction row in the asm view's listing was clicked, or Enter pressed on it; `pc` is its index. */
+  linkInstr?: (pc: number) => void
   /** A token in the λ view was clicked; `node` is the construct its node belongs to (Plan 7 part 4a). */
   linkLambda?: (node: number) => void
   /**
diff --git a/web/src/style.css b/web/src/style.css
index 71eb3dc..0dac4cb 100644
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -1175,17 +1175,20 @@ button.view-title[aria-expanded="true"] {
    panel rules (`.tm-pane > .panel`) give it two shares of whatever the tapes leave. Its height is still
    bounded, and has to be — unbounded, it grows to its full 3,069,144px and every draw renders every row —
    but by the view, which the layout sizes. */
-.state-table {
+.state-table,
+.asm-listing {
   overflow-y: auto;
   font-family: var(--font-mono);
   font-size: var(--step--2);
 }
 
-.state-spacer {
+.state-spacer,
+.asm-spacer {
   position: relative;
 }
 
-.state-rows {
+.state-rows,
+.asm-rows {
   position: absolute;
   inset-inline: 0;
   top: 0;
@@ -1194,8 +1197,10 @@ button.view-title[aria-expanded="true"] {
 
 /* MUST equal ROW_HEIGHT in state-table.ts. virtual-list.ts's offset arithmetic assumes it exactly, and
    a mismatch drifts the rows out from under the scrollbar without any test noticing. `tm-pane.ts`
-   re-exports the constant; it does not define it. */
-.state-row {
+   re-exports the constant; it does not define it. The asm listing's rows are the same grid's (`virtual-grid.ts`),
+   so the same height and the same marks. */
+.state-row,
+.asm-row {
   height: 24px;
   line-height: 24px;
   padding-inline: 0.5rem;
@@ -1214,17 +1219,20 @@ button.view-title[aria-expanded="true"] {
   border-inline-start: 3px solid transparent;
 }
 /* A row's one grid cell holds its text, so the text's clipping lives here and not on the row. */
-.state-cell {
+.state-cell,
+.asm-cell {
   white-space: pre;
   overflow: hidden;
   text-overflow: ellipsis;
 }
-.state-table:focus-visible .state-row.is-active {
+.state-table:focus-visible .state-row.is-active,
+.asm-listing:focus-visible .asm-row.is-active {
   --row-active: 0 0 0 2px var(--focus-ring);
 }
 /* A mark's words for a screen reader — "fires next" — as generated content, so they are read and are not the
    row's text; clipped away, so they are not seen. The λ view's marks do the same (`.term [data-marks]`). */
-.state-cell[data-marks]::before {
+.state-cell[data-marks]::before,
+.asm-cell[data-marks]::before {
   content: attr(data-marks);
   position: absolute;
   width: 1px;
@@ -1253,7 +1261,8 @@ button.view-title[aria-expanded="true"] {
    rather than about the selection — a row can legitimately be both, and equal specificity means
    SOURCE ORDER decides which background shows: this rule has to come first so those two, declared
    after it, are the ones that win. */
-.state-row.is-linked {
+.state-row.is-linked,
+.asm-row.is-linked {
   background: var(--link-bg);
   border-inline-start-style: dashed;
   border-inline-start-color: var(--link-edge);
@@ -1270,12 +1279,14 @@ button.view-title[aria-expanded="true"] {
    `.is-next` — the run's literal position — must still win, so they stay declared after this.
 
    ITS CUE IS THE BOTTOM EDGE, composed through `--row-edge` so it survives beside the current row's bar. */
-.state-row.is-focus {
+.state-row.is-focus,
+.asm-row.is-focus {
   background: color-mix(in oklab, var(--tok-operator) 22%, var(--bg));
   --row-edge: 0 -2px 0 var(--tok-operator);
 }
 
-.state-row {
+.state-row,
+.asm-row {
   cursor: pointer;
 }
 
@@ -1955,3 +1966,138 @@ main {
 .state-diagram[hidden] {
   display: none;
 }
+
+/* THE ASM VIEW (Plan 7 part 5 spec §6.1): the TM view's mechanism, with its own shares. The listing takes two, the
+   registers and call stack one between them, side by side, and the heap one; a closed panel keeps only its header, and
+   each body keeps a floor of five rows. `.asm-machine` is the row the registers and the call stack share: it wraps, so
+   the two stack when the view is too narrow for both, and it takes no share of its own while both are closed. */
+.pane[data-kind="asm"] {
+  display: flex;
+  flex-direction: column;
+}
+.asm-pane {
+  flex: 1 0 auto;
+  display: flex;
+  flex-direction: column;
+}
+.asm-pane > * {
+  flex: none;
+}
+.asm-pane > .panel[data-open="true"],
+.asm-machine > .panel[data-open="true"] {
+  display: flex;
+  flex-direction: column;
+}
+.asm-pane > .panel[data-panel="listing"][data-open="true"] {
+  flex: 2 1 0;
+}
+.asm-pane > .panel[data-panel="heap"][data-open="true"],
+.asm-pane > .asm-machine:has(> .panel[data-open="true"]) {
+  flex: 1 1 0;
+}
+.asm-machine {
+  display: flex;
+  flex-wrap: wrap;
+  align-items: stretch;
+  column-gap: 1rem;
+  row-gap: var(--space-2);
+  margin-block-start: var(--space-2);
+}
+/* THE ROW CARRIES THE PANELS' SPACING, NOT THE PANELS: a panel's own `margin-block-start` inside the row would sit
+   within the row's share, leaving the registers and the call stack a margin shorter than the heap beside them. */
+.asm-machine > .panel {
+  flex: 1 1 18rem;
+  min-width: 0;
+  margin-block-start: 0;
+}
+.asm-pane > .panel[data-open="true"] > .asm-listing {
+  flex: 1 1 0;
+  min-height: calc(5 * 24px);
+}
+.asm-registers,
+.asm-stack,
+.asm-heap {
+  flex: 1 1 0;
+  min-height: 5lh;
+  overflow-y: auto;
+  margin: 0;
+  padding-inline: 0.5rem;
+  font-family: var(--font-mono);
+  font-size: var(--step--2);
+  list-style: none;
+}
+.panel-note {
+  font-size: var(--step--2);
+  color: var(--fg-dim);
+}
+
+/* An instruction row: its `pc`, its mnemonic, its operands. A label row sits above the instruction it names. */
+.asm-pc {
+  display: inline-block;
+  min-width: 5ch;
+  color: var(--fg-dim);
+}
+.asm-mnemonic {
+  display: inline-block;
+  min-width: 7ch;
+}
+.asm-row.is-label {
+  color: var(--fg-dim);
+  font-weight: 600;
+}
+/* THE INSTRUCTION ABOUT TO RUN: the rule table's current-row bar and next-rule outline together, since for asm the
+   two are one row. Its words, "runs next", are the cell's generated content. */
+.asm-row.is-next {
+  background: color-mix(in oklab, var(--accent) 24%, var(--bg));
+  outline: 1px solid var(--accent);
+  outline-offset: -1px;
+  --row-bar: 3px 0 0 var(--accent);
+}
+
+/* THE REGISTERS (spec §6.3): name and word in a wrapping grid. The register the last instruction wrote is outlined —
+   a shape, not a colour — and a local the current call has not written is dimmed behind its `·`. */
+.asm-register-list {
+  display: grid;
+  grid-template-columns: repeat(auto-fill, minmax(14ch, 1fr));
+  gap: 0 1ch;
+  margin: 0;
+}
+.asm-register {
+  display: flex;
+  gap: 1ch;
+  padding-inline: 0.25rem;
+}
+.asm-register dt {
+  min-width: 4ch;
+  color: var(--fg-dim);
+}
+.asm-register dd {
+  margin: 0;
+  overflow: hidden;
+  text-overflow: ellipsis;
+  white-space: nowrap;
+}
+.asm-register.is-changed {
+  outline: 1px solid var(--accent);
+  outline-offset: -1px;
+  font-weight: 600;
+}
+.asm-register.is-unwritten {
+  opacity: 0.55;
+}
+.asm-note {
+  margin: 0;
+  color: var(--fg-dim);
+}
+
+/* THE CALL STACK AND THE HEAP (spec §6.4, §6.5): a line each, newest or top first. */
+.asm-frame,
+.asm-cell-line {
+  white-space: nowrap;
+  overflow: hidden;
+  text-overflow: ellipsis;
+}
+.asm-ret,
+.asm-refs {
+  color: var(--fg-dim);
+}
diff --git a/web/src/types.ts b/web/src/types.ts
index 5962035..62cc38e 100644
--- a/web/src/types.ts
+++ b/web/src/types.ts
@@ -31,6 +31,13 @@ import type { Span } from '../bindings/Span'
 import type { TokenClass } from '../bindings/TokenClass'
 import type { ValueRun } from '../bindings/ValueRun'
 
+export type { AsmBox } from '../bindings/AsmBox'
+export type { AsmCallFrame } from '../bindings/AsmCallFrame'
+export type { AsmCell } from '../bindings/AsmCell'
+export type { AsmProgram } from '../bindings/AsmProgram'
+export type { AsmState } from '../bindings/AsmState'
+export type { AsmWindow } from '../bindings/AsmWindow'
+export type { AsmWord } from '../bindings/AsmWord'
 export type { Cut } from '../bindings/Cut'
 export type { Diagnostic } from '../bindings/Diagnostic'
 export type { LambdaState } from '../bindings/LambdaState'
@@ -45,6 +52,7 @@ export type { TmProgram } from '../bindings/TmProgram'
 export type { TmScratchStatus } from '../bindings/TmScratchStatus'
 export type { TmState } from '../bindings/TmState'
 export type { TmStatus } from '../bindings/TmStatus'
+export type { WordTag } from '../bindings/WordTag'
 export type { Decoded, Owner, Span, TokenClass, ValueRun }
 
 /**
````


- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts`

Expected: exit 0, printing:

```text
    Test Files  2 passed (2)
    Tests  35 passed (35)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, from `web/`, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 29 of 29 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| S1 | labels drawn after their instruction — `asm-view.ts`: `for (const name of at.get(pc) ?? []) rows.push({ kind: 'label', name }) ⏎     if (pc < p.listing.length) rows.push({ kind: 'instr', pc })` → `if (pc < p.listing.length) rows.push({ kind: 'instr', pc }) ⏎     for (const name of at.get(pc) ?? []) rows.push({ kind: 'label', name })` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the asm listing > draws each label above the instruction it names, and each instruction as pc, mnemonic and operands`, `tests/browser/asm-pane.test.ts > the asm listing > links the active instruction on Enter`, `tests/node/asm-view.test.ts > the listing > draws a label past the last instruction after it, and two labels on one instruction in labels order`, `tests/node/asm-view.test.ts > the listing > finds each instruction's row`, `tests/node/asm-view.test.ts > the listing > puts each instruction under its labels, as print_asm prints them` |
| S2 | an instruction's row is one off — `asm-view.ts`: `if (r.kind === 'instr') out[r.pc] = row` → `if (r.kind === 'instr') out[r.pc] = row + 1` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the asm listing > marks the instruction about to run, and says "runs next" in words, not colour alone`, `tests/node/asm-view.test.ts > the listing > finds each instruction's row` |
| S3 | no split at the tab — `asm-view.ts`: `return tab < 0 ? { mnemonic: line, operands: '' } : { mnemonic: line.slice(0, tab), operands: line.slice(tab + 1) }` → `return { mnemonic: line, operands: '' }` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the asm listing > draws each label above the instruction it names, and each instruction as pc, mnemonic and operands`, `tests/browser/asm-pane.test.ts > the call stack > lists the frames top first, each its function, its return pc and its saved locals, with a count`, `tests/node/asm-view.test.ts > a call frame > names the function the call before its return pc named`, `tests/node/asm-view.test.ts > the listing > splits an instruction at the listing's tab, and leaves one with no operands whole` |
| S4 | the empty list reads #0 — `asm-view.ts`: `` return w.word === '0' ? 'nil' : `#${w.word}` `` → `` return `#${w.word}` `` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the heap > lists the cells newest first with the list registers that name them, then the boxes, with a count`, `tests/browser/asm-pane.test.ts > the registers > show pc, rr, the arguments and the locals, each word read by its tag`, `tests/node/asm-view.test.ts > a word > reads by its tag: a value in decimal, a list as its cell or nil, a box as its handle` |
| S5 | any instruction before a return names a callee — `asm-view.ts`: `return mnemonic === 'call' && operands !== '' ? operands : null` → `return operands !== '' ? operands : null` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/node/asm-view.test.ts > a call frame > names nothing when the instruction before its return pc is not a call` |
| S6 | arguments listed after the locals — `asm-view.ts`: `` for (const [i, w] of s.args.entries()) { ⏎     const name = `a${i}` ⏎     rows.push({ name, text: wordText(w), changed: s.wrote === name, unwritten: false })… `` → `` for (const [i, w] of s.locals.entries()) { ⏎     const name = `r${i}` ⏎     rows.push({ name, text: wordText(w), changed: s.wrote === name, unwritten: s.writ… `` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the registers > show pc, rr, the arguments and the locals, each word read by its tag`, `tests/node/asm-view.test.ts > the registers > list pc, rr, the arguments and the locals in that order, each read by its tag` |
| S7 | every written local marked changed — `asm-view.ts`: `rows.push({ name, text: wordText(w), changed: s.wrote === name, unwritten: s.written[i] !== true })` → `rows.push({ name, text: wordText(w), changed: s.written[i] === true, unwritten: s.written[i] !== true })` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the registers > dim a local the call has not written, mark it ·, and say it is left over from the caller`, `tests/browser/asm-pane.test.ts > the registers > mark the register the last instruction wrote, in words as well as by shape`, `tests/node/asm-view.test.ts > the registers > mark the register the last instruction wrote, and only that one` |
| S8 | arguments marked unwritten too — `asm-view.ts`: `rows.push({ name, text: wordText(w), changed: s.wrote === name, unwritten: false }) ⏎   } ⏎   for (const [i, w] of s.locals` → `rows.push({ name, text: wordText(w), changed: s.wrote === name, unwritten: true }) ⏎   } ⏎   for (const [i, w] of s.locals` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the registers > show pc, rr, the arguments and the locals, each word read by its tag`, `tests/node/asm-view.test.ts > the registers > mark a local the current call has not written, and never an argument or rr` |
| S9 | left over from a caller at depth 0 — `asm-view.ts`: `return s.depth > 0 ? 'left over from caller' : 'not written yet'` → `return 'left over from caller'` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/node/asm-view.test.ts > the registers > say an unwritten local is left over from the caller only inside a call` |
| S10 | back-references ignore the tag — `asm-view.ts`: `if (s.rr.tag === tag && s.rr.word === word) out.push('rr')` → `if (s.rr.word === word) out.push('rr')` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/node/asm-view.test.ts > the heap > names the registers of a cell's own tag whose word is that cell` |
| S11 | a boxes clause with no boxes — `asm-view.ts`: `return s.box_len === 0 ? cells :` → `return false ? cells :` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/node/asm-view.test.ts > the heap > counts cells, and boxes only when there are some` |
| S12 | runs next marked on pc, not next — `asm-pane.ts`: `const next = this.#frame?.next ?? null` → `const next = this.#frame?.pc ?? null` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the asm listing > marks nothing as running next once the run has ended` |
| S13 | runs next only in colour — `asm-pane.ts`: `cell.dataset.marks = 'runs next'` → `(deleted)` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the asm listing > marks the instruction about to run, and says "runs next" in words, not colour alone` |
| S14 | the listing follows nothing — `asm-pane.ts`: `follow: nextRow,` → `follow: null,` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the asm listing > follows the instruction about to run, stops at a user scroll, and follows again on "follow current instruction"`, `tests/browser/asm-pane.test.ts > the asm listing > marks a link and the running focus on their instructions, and holds a link made elsewhere until the run moves` |
| S15 | a label row links — `asm-pane.ts`: `if (row?.kind === 'instr') on.linkInstr?.(row.pc)` → `if (row !== undefined) on.linkInstr?.(row.kind === 'instr' ? row.pc : -1)` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the asm listing > links the instruction a real click lands on, from the focus elsewhere, and a label row links nothing` |
| S16 | a link made elsewhere does not scroll — `asm-pane.ts`: `if (row !== undefined) this.#grid.scrollToRow(row)` → `if (row !== undefined) void row` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the asm listing > marks a link and the running focus on their instructions, and holds a link made elsewhere until the run moves` |
| S17 | the running focus is dropped — `asm-pane.ts`: `this.#focused = new Set(instrs)` → `this.#focused = new Set()` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the asm listing > marks a link and the running focus on their instructions, and holds a link made elsewhere until the run moves` |
| S18 | a mark said only by shape — `asm-pane.ts`: `if (said.length > 0) value.setAttribute('aria-description', said.join('; '))` → `if (said.length > 0) void said` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the registers > dim a local the call has not written, mark it ·, and say it is left over from the caller`, `tests/browser/asm-pane.test.ts > the registers > mark the register the last instruction wrote, in words as well as by shape` |
| S19 | an unwritten local carries no dot — `asm-pane.ts`: `` name.textContent = r.unwritten ? `· ${r.name}` : r.name `` → `name.textContent = r.name` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the registers > dim a local the call has not written, mark it ·, and say it is left over from the caller` |
| S20 | locals past the window unsaid — `asm-pane.ts`: `more(frame.locals_len - frame.locals.length, frame.locals_len - frame.locals.length === 1 ? 'local' : 'locals')` → `more(0, 'locals')` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the registers > say how many registers are past the window` |
| S21 | the stack drawn bottom first — `asm-pane.ts`: `const items = frame.frames.map((f) => {` → `const items = [...frame.frames].reverse().map((f) => {` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the call stack > lists the frames top first, each its function, its return pc and its saved locals, with a count` |
| S22 | frames past the window unsaid — `asm-pane.ts`: `const hidden = frame.depth - frame.frames.length` → `const hidden = 0` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the call stack > says how many frames are past the window, and when the run is inside no call` |
| S23 | a cell's back-reference reads box registers — `asm-pane.ts`: `backRefs(frame, c.cell, 'List')` → `backRefs(frame, c.cell, 'Box')` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the heap > lists the cells newest first with the list registers that name them, then the boxes, with a count` |
| S24 | older cells unsaid — `asm-pane.ts`: `const olderCells = frame.heap_len - frame.cells.length` → `const olderCells = 0` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the heap > lists the cells newest first with the list registers that name them, then the boxes, with a count` |
| S25 | the listing takes one share — `style.css`: `.asm-pane > .panel[data-panel="listing"][data-open="true"] { ⏎   flex: 2 1 0;` → `.asm-pane > .panel[data-panel="listing"][data-open="true"] { ⏎   flex: 1 1 0;` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the panels > share the view: the listing two shares, the registers and call stack one side by side, the heap one` |
| S26 | registers and call stack never stack — `style.css`: `.asm-machine { ⏎   display: flex; ⏎   flex-wrap: wrap;` → `.asm-machine { ⏎   display: flex; ⏎   flex-wrap: nowrap;` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the panels > stack the registers and the call stack when the view is too narrow for both` |
| S27 | the panels keep their own margin in the row — `style.css`: `min-width: 0; ⏎   margin-block-start: 0; ⏎ }` → `min-width: 0; ⏎ }` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the panels > share the view: the listing two shares, the registers and call stack one side by side, the heap one` |
| S28 | a toggle reported under another name — `asm-pane.ts`: `onToggle: (open) => on.panel?.('registers', open),` → `onToggle: (open) => on.panel?.('stack', open),` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the panels > report each toggle by name, and open as stored` |
| S29 | follow current instruction does not follow — `asm-pane.ts`: `this.#grid.attach()` → `this.#grid.draw()` | `pnpm exec vitest run tests/node/asm-view.test.ts tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > the asm listing > follows the instruction about to run, stops at a user scroll, and follows again on "follow current instruction"` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
The asm view: a listing that follows the instruction about to run, and registers, call stack and heap panels sharing the view's height

`AsmPane` draws an `AsmProgram` and the `AsmState` of the displayed
step: the listing on the grid the TM rule table shares, labels above the
instructions they name and the next instruction marked "runs next"; the
registers read by their tags, with the last write marked and a local the
call has not written dimmed, as left over from the caller or, at depth
0, not written yet; the call stack top first; and the heap newest first,
each cell with the list registers that name it. The view is built and
tested on its own here; the leg that feeds it is wired next.
````


---

### Task 7: asm is the web app's third leg: the worker records it, the session keeps its listing, the readout counts its instructions, and the default tree shows it beside TM

**Files:**
- Modify: `web/src/protocol.ts`, `web/src/legs.ts`, `web/src/panes.ts`, `web/src/layout.ts`, `web/src/lsp-protocol.ts`, `web/src/types.ts`, `web/src/session-worker.ts`, `web/src/replies.ts`, `web/src/sessions.ts`, `web/src/main.ts`, `web/src/pane-host.ts`, `web/src/draw.ts`, `web/src/readout.ts`, `web/src/results.ts`, `web/src/controls.ts`, `web/src/scratch.ts`, `web/src/buffer-list.ts`, `web/src/buffers-store.ts`, `web/src/link.ts` (the wire field), `web/src/link-wiring.ts` (the asm slot), and comments in `web/src/banner.ts`, `web/src/editor-custody.ts`, `web/src/pane-chrome.ts`
- Create (tests): `web/tests/browser/asm-app.test.ts`
- Modify (tests): the node tier's fixtures and expectations for the new shapes and the new default tree (`controls`, `layout`, `link`, `link-status`, `lsp-protocol`, `protocol`, `readout`, `replies`, `results`, `scratch`, `session-client`, `sessions`, `workspace`); `frame-cost.test.ts` (the asm word measurement); `controls-gate.test.ts` (the views read off the page); and the browser tests the new default tree broke (what the prototype found, 12)

**Interfaces:**
- `Leg = 'lambda' | 'asm' | 'tm'`, `PaneKind` gains `'asm'`, `LEG_NAME` gains `asm: 'asm'` between λ and TM; `CopyLeg = Exclude<Leg, 'asm'>` (amendment 20).
- `protocol.ts`: `ASM_WINDOW`, `ASM_WORD_BYTES` (52), `asmFrameBytes(f)`, `asmRecordEnd(status)`; `RecordEnd` gains `stack-full`, `heap-full`, `memory-full`; `compiled` gains `asm: AsmStatus` and `asmProgram: AsmProgram | null`; a new `asm-frames` reply; `result` gains `asm: AsmLeg`.
- `sessions.ts`: `LegFrame.asm = AsmState`; `SessionEntry.asmProgram`; `resetLegs(legs, statuses: { [L in Leg]?: LegAvailability | null }, reason?)`.
- `results.ts`: `resultRows(lambda, asm, tm)`; `readout.ts`: `ProgramResult` gains `asm`, one segment per leg in `LEGS` order.
- `layout.ts`: `defaultLayout()` is (source | λ) above (asm | TM).

**`tsc` IS THE WORK LIST.** Adding `'asm'` to `Leg` and `PaneKind` makes every switch Task 1 wrote name itself; each gets its asm arm. A copy's switches get none: they take `CopyLeg`.

**THE WORKER** records λ, then asm, then TM (§5.4): asm is the cheapest leg a step, and TM's recording can spend its whole budget before a leg after it starts. `recordAsm` has `recordTm`'s shape and admits only a `Session`, the one kind with an asm leg; its end comes from `asmRecordEnd`, which lives in `protocol.ts` where a test can reach it (what the prototype found, 13): only the step cap is `capped`, and `extend` raises only that one. The `compiled` reply carries the asm status and listing and transfers the link index's `asmOwner` with the rest.

**THE SESSION AND THE VIEWS.** `replies.ts` stores the listing on the entry and tells every asm view on the page, putting one off the page in `unseen`, which `draw()` seeds when it is shown; `pane-host.ts` builds an `AsmPane` for an asm leaf, reads its four panels back from the workspace, and seeds it from the entry — so a view made by a split, a pick or `reset preset` shows the listing the session kept.

**THE READOUT** gains `asm 42 · 5 instructions`; a run compile could not finish reads "stopped after N instructions at a cap", naming a full cap once recording has reached it; a fault is an end, its value the fault. The step line names a full cap and offers no continue (amendment 10).

**`ASM_WORD_BYTES` IS MEASURED, AND GATED.** `frame-cost.test.ts`'s new case keeps every frame of `upto(200)` and the same frames with the words dropped: 48.23 bytes a word, in both runs measured. It is charged 52, and the case fails if a word ever costs more (amendment 17).

**THE NEW DEFAULT TREE** puts four views on a fresh page. The browser tests that assumed three are updated to what each is about; the two that measure the TM view's geometry close the asm view first and assert the width they need. The controls gate walked a hand-written list of two views and was blind to the third; it reads the views off the page and asserts the default tree's three (what the prototype found, 11).

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=7
diff --git a/web/tests/browser/active-pane.test.ts b/web/tests/browser/active-pane.test.ts
index f5b7f77..dd13ce6 100644
--- a/web/tests/browser/active-pane.test.ts
+++ b/web/tests/browser/active-pane.test.ts
@@ -152,7 +152,8 @@ beforeEach(async () => {
   await until(
     () =>
       document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
-      leafIds().length === 3 &&
+      // THE DEFAULT TREE'S FOUR VIEWS: source, λ, asm and TM.
+      leafIds().length === 4 &&
       lambdaLeaves().length === 1,
     'the default layout on a settled source program',
   )
diff --git a/web/tests/browser/app-header.test.ts b/web/tests/browser/app-header.test.ts
index 2be67a0..a4c1721 100644
--- a/web/tests/browser/app-header.test.ts
+++ b/web/tests/browser/app-header.test.ts
@@ -27,10 +27,11 @@ describe('the app header', () => {
     document.querySelector<HTMLElement>('[data-leaf="lambda-0"] button.view-title')?.focus()
     document.querySelector<HTMLButtonElement>('#new-view')?.click()
     const items = [...document.querySelectorAll<HTMLButtonElement>('#new-view-menu button')]
-    expect(items.map((b) => b.textContent)).toEqual(['λ · program', 'TM · program'])
-    items[1]?.click()
-    await until(() => leafIds().length === 4, 'a fourth view')
-    expect(leafIds()).toEqual(['source', 'lambda-0', 'pane-1', 'tm-0'])
+    expect(items.map((b) => b.textContent)).toEqual(['λ · program', 'asm · program', 'TM · program'])
+    // BY ITS LABEL, NOT ITS INDEX: the asm pair sits between the other two now, so `items[1]` adds an asm view.
+    items.find((b) => b.textContent === 'TM · program')?.click()
+    await until(() => leafIds().length === 5, 'a fifth view')
+    expect(leafIds()).toEqual(['source', 'lambda-0', 'pane-1', 'asm-0', 'tm-0'])
     expect(document.querySelector('[data-leaf="pane-1"]')?.contains(document.activeElement)).toBe(true)
     expect(document.querySelector('#notice .notice-text')?.textContent).toBe('view added — TM · program')
     // **BESIDE MEANS TO ITS RIGHT** (spec §5). `leaves()` walks a row split and a column split in the
@@ -42,8 +43,8 @@ describe('the app header', () => {
 
   it('resets the preset: the default views back, and says so', async () => {
     document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
-    await until(() => leafIds().length === 3, 'the default views')
-    expect(leafIds()).toEqual(['source', 'lambda-0', 'tm-0'])
+    await until(() => leafIds().length === 4, 'the default views')
+    expect(leafIds()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
     expect(document.querySelector('#notice .notice-text')?.textContent).toBe(
       'Explorer reset — the default views are back',
     )
diff --git a/web/tests/browser/asm-app.test.ts b/web/tests/browser/asm-app.test.ts
new file mode 100644
index 0000000..4de842a
--- /dev/null
+++ b/web/tests/browser/asm-app.test.ts
@@ -0,0 +1,141 @@
+import type { EditorView } from '@codemirror/view'
+import { beforeAll, describe, expect, it } from 'vitest'
+import { page } from 'vitest/browser'
+import { bindingKey } from '../../src/view-header'
+import { SHELL, until } from './harness'
+
+/**
+ * The asm leg through the whole app (Plan 7 part 5 spec §5–§6): a compile reaches the asm view in the default tree,
+ * the step controls drive it, the readout carries its segment, and a program one backend declines is still run by the
+ * others. `asm-pane.test.ts` holds the view on its own; this holds the wiring that feeds it.
+ */
+
+const SAMPLE = 'let x = 40; x + 2'
+/** 34 ones multiplied: one multiplication past `MAX_MUL_INSTRS`, so the TM refuses the machine; asm runs 68 instructions. */
+const TOO_LARGE_FOR_TM = Array.from({ length: 34 }, () => '1').join(' * ')
+/** A function passed where the first-order backends cannot follow it: λ runs it, asm and TM decline. */
+const HIGHER_ORDER = 'fn inc(x) { x + 1 } fn t(g) { g(3) } fn ap(h, y) { h(y) } t(inc) + ap(t, inc)'
+const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'
+
+let view: EditorView
+
+/** A view's host — `.pane`, since in the stage each tab carries the leaf id too. */
+const host = (leaf: string) => document.querySelector<HTMLElement>(`.pane[data-leaf="${leaf}"]`) as HTMLElement
+const rows = (leaf = 'asm-0') => [...host(leaf).querySelectorAll<HTMLElement>('.asm-row')]
+const rowText = (r: HTMLElement) => r.querySelector('.asm-cell')?.textContent ?? ''
+const listing = (leaf = 'asm-0') => host(leaf).querySelector<HTMLElement>('.asm-listing') as HTMLElement
+const stepOf = (leaf: string) => host(leaf).querySelector('.step')?.textContent ?? ''
+const control = (label: string, leaf = 'asm-0') =>
+  [...host(leaf).querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
+const register = (name: string) =>
+  [...host('asm-0').querySelectorAll<HTMLElement>('.asm-register')].find(
+    (r) => r.querySelector('dt')?.textContent === name,
+  )
+const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+
+/** Put `src` in the editor and wait for its compile to finish recording. */
+async function compile(src: string): Promise<void> {
+  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
+  await until(() => !idle(), 'the compile to start')
+  await until(idle, 'the compile to finish')
+}
+
+/** Pick `key` (`bindingKey(leg, session)`) through `leaf`'s title menu, as `pane-kind-switch.test.ts`'s `pick` does. */
+function pick(leaf: string, key: string): void {
+  const title = host(leaf).querySelector<HTMLButtonElement>('button.view-title')
+  if (title === null) throw new Error(`no title-selector on [data-leaf="${leaf}"]`)
+  title.click()
+  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
+  const item = menu?.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
+  if (item == null) throw new Error(`[data-leaf="${leaf}"] offers no ${key}`)
+  item.click()
+}
+
+/** Choose a workspace preset through the workspace menu, as `hidden-views.test.ts` does. */
+function preset(name: 'explorer' | 'stage'): void {
+  document.querySelector<HTMLButtonElement>('#workspace')?.click()
+  document.querySelector<HTMLButtonElement>(`#workspace-menu [data-preset="${name}"]`)?.click()
+  const m = document.querySelector<HTMLElement>('#workspace-menu')
+  if (m?.matches(':popover-open')) m.hidePopover()
+}
+
+beforeAll(async () => {
+  await page.viewport(1280, 1600)
+  document.body.innerHTML = SHELL
+  view = await (await import('../../src/main')).ready
+  await compile(SAMPLE)
+})
+
+describe('the asm leg in the app', () => {
+  it('is a view of its own in the default tree, showing the program’s listing', async () => {
+    await until(() => rows().length > 0, 'the asm listing to draw')
+    expect(host('asm-0').dataset.kind).toBe('asm')
+    expect(host('asm-0').querySelector('.view-title')?.textContent).toBe('asm · program')
+    expect(rows().map(rowText)).toEqual([
+      'pc0li r0, #40',
+      'pc1mov r1, r0',
+      'pc2li r2, #2',
+      'pc3add rr, r1, r2',
+      'pc4halt',
+    ])
+  })
+
+  it('records every instruction, and the readout counts them in its own segment', () => {
+    expect(stepOf('asm-0')).toBe('step 5 of 5')
+    expect(segments()).toContain('asm 42 · 5 instructions')
+    expect(segments().map((s) => s.split(' ')[0])).toEqual(['λ', 'asm', 'TM'])
+  })
+
+  it('steps from the start, the listing marking what runs next and the registers what changed', async () => {
+    control('↺')?.click()
+    await until(() => stepOf('asm-0').startsWith('step 0 of'), 'the asm view to restart')
+    expect(listing().querySelector('.asm-row.is-next')?.textContent).toContain('pc0')
+    control('▶')?.click()
+    await until(() => stepOf('asm-0').startsWith('step 1 of'), 'one step')
+    expect(listing().querySelector('.asm-row.is-next')?.textContent).toContain('pc1')
+    const r0 = register('r0')
+    expect(r0?.querySelector('dd')?.textContent).toBe('40')
+    expect(r0?.classList.contains('is-changed')).toBe(true)
+  })
+
+  it('runs a program the TM refuses to build, and says why the TM declined', async () => {
+    await compile(TOO_LARGE_FOR_TM)
+    await until(() => stepOf('asm-0') === 'step 68 of 68', 'the asm leg to record its 68 instructions')
+    expect(stepOf('tm-0')).toBe('the machine this program needs is too large to build')
+    expect(segments()).toContain('asm 1 · 68 instructions')
+  })
+
+  it('declines a program asm cannot lower, with the reason, while λ runs it', async () => {
+    await compile(HIGHER_ORDER)
+    await until(() => stepOf('asm-0').startsWith('the asm backend does not support'), 'the asm leg to decline')
+    expect(rows()).toHaveLength(0)
+    const asm = segments().find((s) => s.startsWith('asm '))
+    expect(asm).toMatch(/^asm declined — the asm backend does not support /)
+    expect(segments().find((s) => s.startsWith('λ '))).toMatch(/^λ 8 · /)
+  })
+})
+
+describe('an asm view made after the compile', () => {
+  it('is told the listing the session kept, when a view is picked onto asm from its title', async () => {
+    await compile(SAMPLE)
+    pick('lambda-0', bindingKey('asm', 'source'))
+    await until(() => host('lambda-0').dataset.kind === 'asm', 'the λ view to become an asm view')
+    await until(() => rows('lambda-0').length > 0, 'the new asm view to draw')
+    expect(rows('lambda-0').map(rowText)).toEqual(rows('asm-0').map(rowText))
+    pick('lambda-0', bindingKey('lambda', 'source'))
+    await until(() => host('lambda-0').dataset.kind === 'lambda', 'the view to go back to λ')
+  })
+
+  it('is told the listing it missed while off the page, when the stage shows it', async () => {
+    preset('stage')
+    const tab = (leaf: string) => document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`)
+    tab('lambda-0')?.click()
+    await until(() => document.querySelector('.pane[data-leaf="asm-0"]') === null, 'the asm view to leave the page')
+    await compile(FACT3)
+    tab('asm-0')?.click()
+    // fact(3): 21 instructions under 4 labels.
+    await until(() => listing().getAttribute('aria-rowcount') === '25', 'the asm view to show the new listing')
+    preset('explorer')
+  })
+})
diff --git a/web/tests/browser/controls-gate.test.ts b/web/tests/browser/controls-gate.test.ts
index a180f91..4323405 100644
--- a/web/tests/browser/controls-gate.test.ts
+++ b/web/tests/browser/controls-gate.test.ts
@@ -165,8 +165,8 @@ beforeAll(async () => {
  * The four workspace states spec §14 item 5 names: the three presets, and one *custom* combination.
  *
  * **`views` IS WHAT CHANGES THE SELECTORS**, not `steps` or `readout`: in Stage one view is on the page,
- * so the per-view cases are driven from whichever view the stage is showing rather than from two named
- * leaves. The `custom` row is Explorer with one switch moved, and it is deliberately the switch that
+ * so the per-view cases are driven from whichever view the stage is showing rather than from every view on
+ * the page. The `custom` row is Explorer with one switch moved, and it is deliberately the switch that
  * changes the page most — a `custom` that looked like Explorer would walk the same controls twice.
  */
 const STATES = [
@@ -185,9 +185,21 @@ function enter(picks: readonly string[]): void {
   if (menu?.matches(':popover-open')) menu.hidePopover()
 }
 
-/** The leaves a per-view case can be driven from in this state. */
+/**
+ * The leaves a per-view case can be driven from in this state: tiled, every view on the page but the source's; in the
+ * stage, the one it shows.
+ *
+ * **READ OFF THE PAGE, NOT LISTED.** This was `['lambda-0', 'tm-0']`, and when the asm view joined the default tree
+ * (Plan 7 part 5) the gate stayed green while walking none of its controls — a list of the views there were is a
+ * list that misses the next one. Every view host is a `.pane` with its leaf id; the source's is the one leaf with no
+ * title menu to open.
+ */
 function viewLeaves(tiled: boolean): string[] {
-  if (tiled) return ['lambda-0', 'tm-0']
+  if (tiled) {
+    return [...document.querySelectorAll<HTMLElement>('.pane[data-leaf]')]
+      .map((host) => host.dataset.leaf ?? '')
+      .filter((leaf) => leaf !== '' && leaf !== 'source')
+  }
   const shown = document.querySelector<HTMLElement>('#views [role="tab"][aria-selected="true"]')
   return shown?.dataset.leaf === undefined ? [] : [shown.dataset.leaf]
 }
@@ -210,6 +222,8 @@ describe.each(STATES)('every control in $name', ({ name, picks, tiled }) => {
   it("with every view's title and ⋯ menu open", () => {
     const leaves = viewLeaves(tiled)
     expect(leaves.length, `${name}: no view to walk`).toBeGreaterThan(0)
+    // THE WALK REACHES EVERY KIND OF VIEW THE DEFAULT TREE HAS: a tiled state shows all of them, the asm view included.
+    if (tiled) expect(leaves, `${name}: the views walked`).toEqual(['lambda-0', 'asm-0', 'tm-0'])
     for (const leaf of leaves) {
       for (const sel of [`[data-leaf="${leaf}"] button.view-title`, `[data-leaf="${leaf}"] button.view-more`]) {
         const button = document.querySelector<HTMLButtonElement>(sel)
diff --git a/web/tests/browser/editor-custody.test.ts b/web/tests/browser/editor-custody.test.ts
index 2da4d3b..c63048e 100644
--- a/web/tests/browser/editor-custody.test.ts
+++ b/web/tests/browser/editor-custody.test.ts
@@ -69,6 +69,7 @@ function lambdaSession(id: SessionId): SessionEntry {
     legs: { lambda: leg },
     tmProgram: null,
     tmScratch: null,
+    asmProgram: null,
   }
 }
 
diff --git a/web/tests/browser/frame-cost.test.ts b/web/tests/browser/frame-cost.test.ts
index 090b008..96a386c 100644
--- a/web/tests/browser/frame-cost.test.ts
+++ b/web/tests/browser/frame-cost.test.ts
@@ -1,7 +1,7 @@
 import { describe, expect, it } from 'vitest'
 import init, { compile } from '../../../pkg/redextape_wasm.js'
-import { FRAME_BYTES, lambdaFrameBytes, SPAN_BYTES } from '../../src/protocol'
-import type { Cut, LambdaState } from '../../src/types'
+import { ASM_WINDOW, ASM_WORD_BYTES, FRAME_BYTES, lambdaFrameBytes, SPAN_BYTES } from '../../src/protocol'
+import type { AsmState, AsmWindow, Cut, LambdaState } from '../../src/types'
 
 /**
  * `SPAN_BYTES` in `protocol.ts` used to be an estimate — ~76 bytes/span AS JSON, rounded up. The real
@@ -14,6 +14,8 @@ import type { Cut, LambdaState } from '../../src/types'
 type Session = {
   stepLambda(): boolean
   lambdaState(byteBudget: number): LambdaState
+  stepAsm(): boolean
+  asmState(window: AsmWindow): AsmState
   free(): void
 }
 
@@ -203,6 +205,108 @@ describe('frame cost', () => {
   })
 })
 
+/**
+ * An asm frame's words, counted as `asmFrameBytes` counts them: `rr`, the windowed locals and arguments, each shown
+ * frame's saved locals, both halves of each cell, and each box's content.
+ */
+function asmWords(f: AsmState): number {
+  let words = 1 + f.locals.length + f.args.length + 2 * f.cells.length + f.boxes.length
+  for (const frame of f.frames) words += frame.saved.length
+  return words
+}
+
+/**
+ * `upto(200)`: 2,813 steps, a call depth of 201 and 200 heap cells (Plan 7 part 5 spec §2.5), so its frames carry
+ * every kind of word the window holds — nine locals, eight saved frames of nine locals each, and up to sixteen cells.
+ */
+const ASM_SRC = 'fn upto(n) { if n == 0 { nil } else { cons(n, upto(n - 1)) } } upto(200)'
+
+/** Steps a fresh session's asm leg to its end at `ASM_WINDOW`, recording every frame with `pick`. */
+function stepAsmAll<T>(pick: (st: AsmState) => T): { frames: T[]; totalWords: number } {
+  const { session } = compile(ASM_SRC, 'unary') as { session: Session | null }
+  if (!session) throw new Error('compile produced no session for the asm probe program')
+  const frames: T[] = []
+  let totalWords = 0
+  let st = session.asmState(ASM_WINDOW)
+  for (;;) {
+    totalWords += asmWords(st)
+    frames.push(pick(st))
+    if (!session.stepAsm()) break
+    st = session.asmState(ASM_WINDOW)
+  }
+  session.free()
+  return { frames, totalWords }
+}
+
+describe('asm frame cost', () => {
+  /**
+   * `ASM_WORD_BYTES`, MEASURED THE WAY `SPAN_BYTES` IS: by heap differential after a full collection, full frames
+   * against the same frames with every word dropped, three alternating rounds after a discarded pair. The first
+   * `frame cost` case's comments carry the reasons for each of those choices and are not repeated here.
+   *
+   * **THE DIFFERENTIAL CHARGES THE ARRAYS TO THE WORDS**, as the λ case charges `redex_span` to spans: the slim arm
+   * drops the locals, arguments, frames, cells and boxes arrays along with the words in them. The over-attribution
+   * errs high, which is the safe direction for a charge the ring's budget depends on.
+   */
+  it('measures bytes per asm word by heap differential, and the ring charges at least that', async () => {
+    await init()
+    const heapNow = () => (performance as MemoryPerformance).memory?.usedJSHeapSize ?? 0
+    if (heapNow() === 0)
+      throw new Error('BLOCKED: performance.memory.usedJSHeapSize reads 0 — cannot measure heap size')
+    const collect = (globalThis as GlobalWithGc).gc
+    if (typeof collect !== 'function') {
+      throw new Error('BLOCKED: globalThis.gc is unavailable — launch Chromium with --js-flags=--expose-gc')
+    }
+
+    const retainedFull: AsmState[][] = []
+    const retainedSlim: { step: number; pc: number }[][] = []
+    const readingsA: number[] = []
+    const readingsB: number[] = []
+    let totalWords = 0
+    const roundA = (): number => {
+      collect()
+      const before = heapNow()
+      const a = stepAsmAll<AsmState>((st) => st)
+      collect()
+      const after = heapNow()
+      retainedFull.push(a.frames)
+      totalWords = a.totalWords
+      return after - before
+    }
+    const roundB = (): number => {
+      collect()
+      const before = heapNow()
+      const b = stepAsmAll((st) => ({ step: st.step, pc: st.pc }))
+      collect()
+      const after = heapNow()
+      retainedSlim.push(b.frames)
+      return after - before
+    }
+    roundA()
+    roundB()
+    for (let round = 0; round < 3; round++) {
+      readingsA.push(roundA())
+      readingsB.push(roundB())
+    }
+    for (const frames of retainedFull) expect(frames.length).toBeGreaterThan(0)
+    for (const frames of retainedSlim) expect(frames.length).toBeGreaterThan(0)
+
+    console.log('asm run A (full AsmState) heap deltas, bytes:', readingsA)
+    console.log('asm run B (words dropped) heap deltas, bytes:', readingsB)
+    console.log('asm words per run:', totalWords, 'frames per run:', retainedFull[0]?.length)
+    const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length
+    const bytesPerWord = (mean(readingsA) - mean(readingsB)) / totalWords
+    console.log('asm bytes/word:', bytesPerWord)
+
+    // Sanity bounds, for the λ case's reason: they catch a broken measurement, not a machine.
+    expect(bytesPerWord).toBeGreaterThan(8)
+    expect(bytesPerWord).toBeLessThan(2000)
+    // THE ONE DIRECTION WITH A CONSEQUENCE: a word costing more than `asmFrameBytes` charges it means the ring keeps
+    // more than `HISTORY_BYTES` says, `SPAN_BYTES`' failure one leg over.
+    expect(bytesPerWord).toBeLessThanOrEqual(ASM_WORD_BYTES)
+  })
+})
+
 /**
  * THE HALF `frame_cost_probe` COULD NOT MEASURE. That probe timed the Rust: `print_lambda_capped`
  * plus classification, 4-7 us/step at `FRAME_BYTES`. The real path adds `serde_wasm_bindgen`
diff --git a/web/tests/browser/layout-app.test.ts b/web/tests/browser/layout-app.test.ts
index d85d1f3..8158615 100644
--- a/web/tests/browser/layout-app.test.ts
+++ b/web/tests/browser/layout-app.test.ts
@@ -85,8 +85,9 @@ beforeEach(() => {
 })
 
 describe('the layout tree in the app', () => {
-  it('starts in the arrangement index.html used to ship', () => {
-    expect(panes()).toEqual(['source', 'lambda-0', 'tm-0'])
+  // (source | λ) above (asm | TM) since the asm view (Plan 7 part 5 spec §3, row 4).
+  it('starts in the default arrangement', () => {
+    expect(panes()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
     expect($('#results')).not.toBeNull()
   })
 
diff --git a/web/tests/browser/layout-notices.test.ts b/web/tests/browser/layout-notices.test.ts
index ce6796e..d52a792 100644
--- a/web/tests/browser/layout-notices.test.ts
+++ b/web/tests/browser/layout-notices.test.ts
@@ -26,7 +26,8 @@ beforeAll(async () => {
 describe('layout notices', () => {
   it('says a view was added', async () => {
     splitVia('lambda-0', 'row', bindingKey('tm', 'source'))
-    await until(() => leafIds().length === 4, 'the split')
+    // THE DEFAULT'S FOUR VIEWS AND THE ONE THE SPLIT ADDED.
+    await until(() => leafIds().length === 5, 'the split')
     expect(noticeText()).toBe('view added — TM · program')
   })
 
@@ -47,7 +48,7 @@ describe('layout notices', () => {
 
   it('says a view closed, and puts focus on the title of the view that grew', async () => {
     document.querySelector<HTMLButtonElement>('[data-leaf="pane-1"] button.view-close')?.click()
-    await until(() => leafIds().length === 3, 'the close')
+    await until(() => leafIds().length === 4, 'the close')
     expect(noticeText()).toBe('view closed — λ · program')
     expect(document.activeElement?.matches('[data-leaf="lambda-0"] .view-title')).toBe(true)
   })
diff --git a/web/tests/browser/layout-restore.test.ts b/web/tests/browser/layout-restore.test.ts
index 1f706c4..90d8a4e 100644
--- a/web/tests/browser/layout-restore.test.ts
+++ b/web/tests/browser/layout-restore.test.ts
@@ -1,5 +1,5 @@
 import { beforeAll, describe, expect, it } from 'vitest'
-import { defaultLayout, LAYOUT_STORAGE_KEY, serializeLayout, splitLeaf } from '../../src/layout'
+import { LAYOUT_STORAGE_KEY, type LayoutNode, serializeLayout, splitLeaf } from '../../src/layout'
 import { parseWorkspace } from '../../src/workspace'
 import { SHELL } from './harness'
 
@@ -28,6 +28,35 @@ import { SHELL } from './harness'
  * straight through `localStorage`, which is that per-file shim by the time this line runs.
  */
 
+/**
+ * The tree `defaultLayout()` returned before the asm view joined it (Plan 7 part 5 spec §3, row 4): source and
+ * λ side by side above TM.
+ *
+ * **SPELLED OUT RATHER THAN TAKEN FROM `defaultLayout()`, BECAUSE THE ENTRY IT STANDS IN FOR IS OLDER THAN THE
+ * ASM VIEW.** `STORED` below is a version 1 layout, which only a build from before the version 2 workspace could
+ * have written, and no such build had an asm leaf to write. Built from today's default, the fixture would be a
+ * stored tree no real page ever held. Spelled this way it also carries the spec's own claim about stored
+ * layouts — still valid, arrangement kept, not migrated to the new default — which the first case below reads
+ * off the page.
+ */
+const PRE_ASM_DEFAULT: LayoutNode = {
+  kind: 'split',
+  dir: 'column',
+  sizes: [0.5, 0.5],
+  children: [
+    {
+      kind: 'split',
+      dir: 'row',
+      sizes: [0.5, 0.5],
+      children: [
+        { kind: 'leaf', id: 'source', pane: 'source' },
+        { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
+      ],
+    },
+    { kind: 'leaf', id: 'tm-0', pane: 'tm' },
+  ],
+}
+
 /**
  * A once-split tree, built with the app's OWN `splitLeaf` and `serializeLayout` rather than a
  * hand-written literal.
@@ -45,7 +74,7 @@ import { SHELL } from './harness'
  * it is the one place in this file that exercises `seedLeafCounter` against both at once — see its own
  * doc.
  */
-const STORED = serializeLayout(splitLeaf(defaultLayout(), 'lambda-0', 'row', 'lambda-1', 'lambda'))
+const STORED = serializeLayout(splitLeaf(PRE_ASM_DEFAULT, 'lambda-0', 'row', 'lambda-1', 'lambda'))
 
 const leafIds = () => [...document.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf ?? '')
 /**
@@ -101,6 +130,7 @@ beforeAll(async () => {
 
 describe('a layout restored from storage', () => {
   it('mounts the stored arrangement rather than falling back to the default', () => {
+    // NO `asm-0`: the default has one and the stored tree does not, so a fallback would show here too.
     expect(leafIds()).toEqual(['source', 'lambda-0', 'lambda-1', 'tm-0'])
   })
 
@@ -124,7 +154,7 @@ describe('a layout restored from storage', () => {
    * at all. What an under-seed produces instead is a WRONG NUMBER: `seedLeafCounter` reads the digits
    * after a leaf id's last `-` regardless of which word precedes them (`main.ts`'s own doc on
    * `nextLeafId`), specifically so a restored `lambda-1` still advances the counter the way a `pane-1`
-   * would. `defaultLayout()`'s own `lambda-0`/`tm-0` contribute suffix `0` and would leave the counter
+   * would. `PRE_ASM_DEFAULT`'s own `lambda-0`/`tm-0` contribute suffix `0` and would leave the counter
    * at 1 by themselves; only seeing `lambda-1`'s `1` pushes it to 2. So `pane-2` is the one id that
    * proves the stored leaf's suffix was actually seen — `pane-1` would mean it was not, and would still
    * pass a uniqueness check today only because nothing else in this small tree happens to want `pane-1`
diff --git a/web/tests/browser/layout-view.test.ts b/web/tests/browser/layout-view.test.ts
index 26082d8..210e739 100644
--- a/web/tests/browser/layout-view.test.ts
+++ b/web/tests/browser/layout-view.test.ts
@@ -1,5 +1,5 @@
 import { beforeEach, describe, expect, it } from 'vitest'
-import { defaultLayout, type LayoutNode, resize } from '../../src/layout'
+import { type LayoutNode, resize } from '../../src/layout'
 import { KEY_STEP, type ResizeHandlers, renderLayout, syncSizes } from '../../src/layout-view'
 
 /**
@@ -10,6 +10,34 @@ import { KEY_STEP, type ResizeHandlers, renderLayout, syncSizes } from '../../sr
  * accessibility list.
  */
 
+/**
+ * The tree every case here renders: source and λ side by side above TM, the shape `defaultLayout()` had
+ * until the asm view joined it (Plan 7 part 5 spec §3, row 4).
+ *
+ * **THIS FILE'S OWN, NOT `defaultLayout()`, BECAUSE ITS SUBJECT IS THE MACHINERY AND NOT THE PRESET.** Every
+ * case asks what `renderLayout` and `syncSizes` do with a tree — how many dividers, which path a nested one
+ * answers to, which flex a resize moves — and the numbers below are facts about this particular nesting. Borrowed
+ * from the preset, they changed meaning the day the preset gained a leaf, with nothing about the machinery
+ * having moved. The preset itself is `layout-app.test.ts`'s to check, through the app.
+ */
+const tree = (): LayoutNode => ({
+  kind: 'split',
+  dir: 'column',
+  sizes: [0.5, 0.5],
+  children: [
+    {
+      kind: 'split',
+      dir: 'row',
+      sizes: [0.5, 0.5],
+      children: [
+        { kind: 'leaf', id: 'source', pane: 'source' },
+        { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
+      ],
+    },
+    { kind: 'leaf', id: 'tm-0', pane: 'tm' },
+  ],
+})
+
 let root: HTMLElement
 const hosts = new Map<string, HTMLElement>()
 
@@ -35,26 +63,26 @@ beforeEach(() => {
 
 describe('renderLayout', () => {
   it('mounts every leaf host in tree order', () => {
-    renderLayout(root, defaultLayout(), hosts, inert())
+    renderLayout(root, tree(), hosts, inert())
     const mounted = [...root.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf)
     expect(mounted).toEqual(['source', 'lambda-0', 'tm-0'])
   })
 
   it('mounts the same host element rather than a copy, so pane state survives a re-render', () => {
-    renderLayout(root, defaultLayout(), hosts, inert())
+    renderLayout(root, tree(), hosts, inert())
     const first = root.querySelector('[data-leaf="lambda-0"]')
-    renderLayout(root, defaultLayout(), hosts, inert())
+    renderLayout(root, tree(), hosts, inert())
     expect(root.querySelector('[data-leaf="lambda-0"]')).toBe(first)
   })
 
   it('puts one divider between each pair of siblings', () => {
-    renderLayout(root, defaultLayout(), hosts, inert())
+    renderLayout(root, tree(), hosts, inert())
     // column[ row[source, lambda], tm ] -> one divider inside the row, one in the column.
     expect(root.querySelectorAll('[role="separator"]').length).toBe(2)
   })
 
   it('gives every divider the separator semantics a keyboard user needs', () => {
-    renderLayout(root, defaultLayout(), hosts, inert())
+    renderLayout(root, tree(), hosts, inert())
     for (const d of root.querySelectorAll('[role="separator"]')) {
       expect(d.getAttribute('aria-orientation')).toMatch(/^(horizontal|vertical)$/)
       expect(d.getAttribute('aria-valuenow')).not.toBeNull()
@@ -66,7 +94,7 @@ describe('renderLayout', () => {
 
   it('reports a resize when a divider is dragged, as a FRACTION of the split — not raw pixels', () => {
     const calls: { path: number[]; index: number; delta: number }[] = []
-    renderLayout(root, defaultLayout(), hosts, {
+    renderLayout(root, tree(), hosts, {
       resize: (path, index, delta) => calls.push({ path, index, delta }),
       commit: () => {},
     })
@@ -86,7 +114,7 @@ describe('renderLayout', () => {
 
   it('reports a resize from the arrow keys, so the layout is not mouse-only', () => {
     const calls: { path: number[]; index: number; delta: number }[] = []
-    renderLayout(root, defaultLayout(), hosts, {
+    renderLayout(root, tree(), hosts, {
       resize: (path, index, delta) => calls.push({ path, index, delta }),
       commit: () => {},
     })
@@ -103,7 +131,7 @@ describe('renderLayout', () => {
 
   it('addresses a nested divider by its path', () => {
     const calls: { path: number[]; index: number }[] = []
-    renderLayout(root, defaultLayout(), hosts, {
+    renderLayout(root, tree(), hosts, {
       resize: (path, index) => calls.push({ path, index }),
       commit: () => {},
     })
@@ -126,7 +154,7 @@ describe('renderLayout', () => {
   })
 
   it('keeps focus on the same divider across a re-render, so a second arrow-key press still works', () => {
-    renderLayout(root, defaultLayout(), hosts, inert())
+    renderLayout(root, tree(), hosts, inert())
     const before = root.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement
     const path = before.dataset.path
     const index = before.dataset.index
@@ -145,7 +173,7 @@ describe('renderLayout', () => {
     // what changed is how often a resize reaches it — once per gesture instead of once per frame — not
     // whether it does.
     before.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
-    renderLayout(root, defaultLayout(), hosts, inert())
+    renderLayout(root, tree(), hosts, inert())
 
     const after = document.activeElement
     expect(after).not.toBe(document.body)
@@ -162,12 +190,12 @@ describe('renderLayout', () => {
 
 describe('syncSizes', () => {
   it('moves flex on both neighbours of the addressed divider and leaves the rest alone', () => {
-    renderLayout(root, defaultLayout(), hosts, inert())
-    const moved = resize(defaultLayout(), [0], 0, 0.2)
+    renderLayout(root, tree(), hosts, inert())
+    const moved = resize(tree(), [0], 0, 0.2)
 
     syncSizes(root, moved)
 
-    // `defaultLayout()`'s inner row split is source | lambda-0 at 0.5/0.5; +0.2 makes it 0.7/0.3.
+    // `tree()`'s inner row split is source | lambda-0 at 0.5/0.5; +0.2 makes it 0.7/0.3.
     const source = root.querySelector<HTMLElement>('[data-leaf="source"]')
     const lambda = root.querySelector<HTMLElement>('[data-leaf="lambda-0"]')
     const tm = root.querySelector<HTMLElement>('[data-leaf="tm-0"]')
@@ -181,21 +209,21 @@ describe('syncSizes', () => {
   })
 
   it('updates aria-valuenow on the divider, which would otherwise freeze at its build-time value', () => {
-    renderLayout(root, defaultLayout(), hosts, inert())
+    renderLayout(root, tree(), hosts, inert())
     const divider = root.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]')
     expect(divider?.getAttribute('aria-valuenow')).toBe('50')
 
-    syncSizes(root, resize(defaultLayout(), [0], 0, 0.2))
+    syncSizes(root, resize(tree(), [0], 0, 0.2))
 
     expect(divider?.getAttribute('aria-valuenow')).toBe('70')
   })
 
   it('does not replace a single element — the identity a drag depends on survives', () => {
-    renderLayout(root, defaultLayout(), hosts, inert())
+    renderLayout(root, tree(), hosts, inert())
     const divider = root.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]')
     const source = root.querySelector<HTMLElement>('[data-leaf="source"]')
 
-    syncSizes(root, resize(defaultLayout(), [0], 0, 0.2))
+    syncSizes(root, resize(tree(), [0], 0, 0.2))
 
     // Object identity, not equality. This is the whole point of `syncSizes` existing: `renderLayout`
     // would have built a NEW divider with the same path/index, and the drag's own closure would have
@@ -205,7 +233,7 @@ describe('syncSizes', () => {
   })
 
   it('throws rather than repairing when the DOM does not match the model', () => {
-    renderLayout(root, defaultLayout(), hosts, inert())
+    renderLayout(root, tree(), hosts, inert())
     // A three-way split against a DOM built for a two-way one: the caller took the cheap path when a
     // rebuild was required, which is a programming error and not a state to paper over.
     const wider: LayoutNode = {
@@ -227,11 +255,11 @@ describe('syncSizes', () => {
     // arm from the DOM/model mismatch above: that one fires inside `syncNode`, once there is at least a
     // rendered tree to compare against; this one fires in `syncSizes` itself, before `syncNode` is ever
     // called.
-    expect(() => syncSizes(root, defaultLayout())).toThrow(/nothing is rendered under root/)
+    expect(() => syncSizes(root, tree())).toThrow(/nothing is rendered under root/)
   })
 
   it('throws when the position after a child holds no divider', () => {
-    renderLayout(root, defaultLayout(), hosts, inert())
+    renderLayout(root, tree(), hosts, inert())
     const divider = root.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]')
     if (divider === null) throw new Error('no vertical divider')
     // Strip the class that marks this element as a divider WITHOUT touching child count, so the
@@ -239,7 +267,7 @@ describe('syncSizes', () => {
     // that fires — the sibling-count mismatch test above exercises the other arm instead.
     divider.classList.remove('layout-divider')
 
-    expect(() => syncSizes(root, defaultLayout())).toThrow(/no divider after child/)
+    expect(() => syncSizes(root, tree())).toThrow(/no divider after child/)
   })
 
   it('accepts a single-leaf tree, which has no split to walk', () => {
diff --git a/web/tests/browser/lsp-hover.test.ts b/web/tests/browser/lsp-hover.test.ts
index cac16ff..07900bf 100644
--- a/web/tests/browser/lsp-hover.test.ts
+++ b/web/tests/browser/lsp-hover.test.ts
@@ -314,7 +314,19 @@ describe('hover, through the app', () => {
     await until(() => tooltipTextOf(view) === null, 'the pointer tooltip to close')
   })
 
+  /**
+   * **THE TM VIEW GETS THE WHOLE ROW, AND THE HOVER'S TARGET IS ASSERTED ON SCREEN BEFORE THE POINTER MOVES.**
+   * The default tree puts asm beside TM (Plan 7 part 5 spec §3, row 4), and in half of this suite's 414px viewport
+   * `MACHINE`'s first rule runs past the copy's editor: `q1` sat at x 556–574, right of the viewport, where
+   * nothing answers a hit test. `userEvent.hover` then scrolls it into view as part of the gesture — the editor
+   * scrolled 162px sideways and the span moved up a line with it — and the pointer landed on the second rule, whose
+   * tooltip reads `goto q0`. So `asm-0` is closed through its own `✕` first, which gives TM the row the default
+   * used to give it, and the precondition is the fact the gesture needs: the point at the centre of `q1` hits
+   * `q1`.
+   */
   it('pointer hover over a TM rule names the goto target', async () => {
+    document.querySelector<HTMLButtonElement>('[data-leaf="asm-0"] button.view-close')?.click()
+    await until(() => document.querySelector('[data-leaf="asm-0"]') === null, 'the asm view to close')
     const pane = paneHost('tm-0')
     const editor = await makeCopy(pane)
     retype(editor, MACHINE)
@@ -329,6 +341,11 @@ describe('hover, through the app', () => {
     await until(() => gotoTarget() !== undefined, "the rule's goto target to be coloured")
     const span = gotoTarget()
     if (span === undefined) throw new Error('no .tok-statename span reading q1')
+    const at = span.getBoundingClientRect()
+    const hit = document.elementFromPoint((at.left + at.right) / 2, (at.top + at.bottom) / 2)
+    expect(hit !== null && span.contains(hit), `q1 is not on screen to hover: its box is ${JSON.stringify(at)}`).toBe(
+      true,
+    )
 
     await retryUntilTooltipOpens(editor, () => userEvent.hover(span))
     expect(tooltipTextOf(editor)).toContain('q1')
diff --git a/web/tests/browser/menu-focus.test.ts b/web/tests/browser/menu-focus.test.ts
index 8490660..3dea0b2 100644
--- a/web/tests/browser/menu-focus.test.ts
+++ b/web/tests/browser/menu-focus.test.ts
@@ -83,13 +83,13 @@ beforeAll(async () => {
   await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
 })
 
-// Back to the default three views before each gesture, since several of these change the tree.
+// Back to the default four views before each gesture, since several of these change the tree.
 beforeEach(async () => {
   document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
   view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
   await until(
     () =>
-      document.querySelectorAll('[data-leaf]').length === 3 &&
+      document.querySelectorAll('[data-leaf]').length === 4 &&
       document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle',
     'the default views',
   )
diff --git a/web/tests/browser/pane-kind-switch.test.ts b/web/tests/browser/pane-kind-switch.test.ts
index a9ee0a9..c361909 100644
--- a/web/tests/browser/pane-kind-switch.test.ts
+++ b/web/tests/browser/pane-kind-switch.test.ts
@@ -133,7 +133,8 @@ beforeEach(async () => {
   await until(
     () =>
       document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
-      leafIds().length === 3 &&
+      // THE DEFAULT TREE'S FOUR VIEWS: source, λ, asm and TM.
+      leafIds().length === 4 &&
       lambdaLeaves().length === 1,
     'the default layout on a settled source program',
   )
diff --git a/web/tests/browser/pane-picker.test.ts b/web/tests/browser/pane-picker.test.ts
index f8cbbf6..afa6ad9 100644
--- a/web/tests/browser/pane-picker.test.ts
+++ b/web/tests/browser/pane-picker.test.ts
@@ -102,7 +102,8 @@ beforeEach(async () => {
   await until(
     () =>
       document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
-      leafIds().length === 3 &&
+      // THE DEFAULT TREE'S FOUR VIEWS: source, λ, asm and TM.
+      leafIds().length === 4 &&
       lambdaLeaves().length === 1,
     'the default layout on a settled source program',
   )
@@ -273,7 +274,7 @@ describe('the closed source pane comes back through the picker', () => {
    * **THIS IS THE CAPABILITY `reset preset` DOES NOT PROVIDE, AND THE ASSERTIONS ARE CHOSEN TO TELL THE
    * TWO APART.** Restoring the default layout also brings the source pane back — so a test that only
    * asked whether a source leaf exists afterwards would pass against a picker that quietly called
-   * `defaultLayout()`. The layout is therefore made one the default cannot produce (a fourth leaf, from a
+   * `defaultLayout()`. The layout is therefore made one the default cannot produce (a fifth leaf, from a
    * split of the TM pane) before the source pane is closed, and the whole leaf list is asserted after it
    * returns: the extra pane is still there, in its place, at the size it had.
    *
@@ -289,7 +290,7 @@ describe('the closed source pane comes back through the picker', () => {
     const onError = (e: ErrorEvent) => errors.push(e.message)
     window.addEventListener('error', onError)
     try {
-      // A LAYOUT THE DEFAULT CANNOT PRODUCE — four leaves, the fourth split off the TM pane.
+      // A LAYOUT THE DEFAULT CANNOT PRODUCE — five leaves, the fifth split off the TM pane.
       const before = leafIds()
       splitVia('tm-0', 'column', 'same')
       await until(() => leafIds().length === before.length + 1, 'the TM pane to split')
@@ -316,8 +317,8 @@ describe('the closed source pane comes back through the picker', () => {
       expect(document.querySelector('[data-leaf="source"] #editor')).not.toBeNull()
       expect(document.querySelector('[data-leaf="source"] .cm-content')?.textContent).toContain('let z = 9')
       // WHERE IT CAME BACK, AND THAT NOTHING ELSE MOVED: `reset preset` would answer
-      // `['source', 'lambda-0', 'tm-0']` here, which is what this line is chosen to fail against.
-      expect(leafIds()).toEqual(['lambda-0', 'source', 'tm-0', extra])
+      // `['source', 'lambda-0', 'asm-0', 'tm-0']` here, which is what this line is chosen to fail against.
+      expect(leafIds()).toEqual(['lambda-0', 'source', 'asm-0', 'tm-0', extra])
       expect(places().find((p) => p.startsWith(`${extra}@`))).toBe(extraPlace)
       expect(errors).toEqual([])
     } finally {
diff --git a/web/tests/browser/scratch-fork.test.ts b/web/tests/browser/scratch-fork.test.ts
index 1d68fbd..a0cd458 100644
--- a/web/tests/browser/scratch-fork.test.ts
+++ b/web/tests/browser/scratch-fork.test.ts
@@ -125,7 +125,16 @@ function sourceSession(pool: SessionPool, seen: RunReply[]): SessionEntry {
       for (const f of reply.frames) legs.tm.hist.push(f, tmFrameBytes(f))
     }
   })
-  return { id: SOURCE, label: 'source', detached: false, client, legs, tmProgram: null, tmScratch: null }
+  return {
+    id: SOURCE,
+    label: 'source',
+    detached: false,
+    client,
+    legs,
+    tmProgram: null,
+    tmScratch: null,
+    asmProgram: null,
+  }
 }
 
 describe('detach is a fork', () => {
diff --git a/web/tests/browser/stage-gestures.test.ts b/web/tests/browser/stage-gestures.test.ts
index b94ed9b..d005c27 100644
--- a/web/tests/browser/stage-gestures.test.ts
+++ b/web/tests/browser/stage-gestures.test.ts
@@ -51,12 +51,12 @@ describe('the stage, under the gestures that add and remove views', () => {
    * **THE DEFAULT ARRANGEMENT IS THE ONE THAT BREAKS IT, WHICH IS WHY THE PRECONDITIONS ARE ASSERTED.**
    * `close` targets the neighbour that GREW and the stage mounts the view that becomes FOCUSED, and on
    * `defaultLayout()` those are two different leaves: closing `lambda-0` grows `source` and focuses
-   * `tm-0`. Closing `tm-0` instead makes them agree, so a version of this case that picked the other view
-   * would pass against the same bug.
+   * `asm-0`. Closing `asm-0` instead makes them agree — both are `lambda-0`, the leaf before it and the first
+   * view left — so a version of this case that picked that view would pass against the same bug.
    */
   it('does not strand the focus when the shown view is closed', () => {
     pick('[data-preset="stage"]')
-    expect(tabs(), 'the stage is not showing the default three views').toEqual(['source', 'lambda-0', 'tm-0'])
+    expect(tabs(), 'the stage is not showing the default four views').toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
     expect(shown(), 'the precondition is that lambda-0 is the shown view').toBe('lambda-0')
 
     const close = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-close')
@@ -65,7 +65,7 @@ describe('the stage, under the gestures that add and remove views', () => {
     expect(document.activeElement, 'the ✕ did not take the focus').toBe(close)
     close?.click()
 
-    expect(tabs()).toEqual(['source', 'tm-0'])
+    expect(tabs()).toEqual(['source', 'asm-0', 'tm-0'])
     expect(document.activeElement, 'focus fell to <body> when the shown view was closed').not.toBe(document.body)
     // AND IT IS IN THE VIEW THAT BECAME FOCUSED, which is what spec §11 actually promises — not merely
     // somewhere other than `<body>`.
diff --git a/web/tests/browser/stage.test.ts b/web/tests/browser/stage.test.ts
index 3908b9b..809ebab 100644
--- a/web/tests/browser/stage.test.ts
+++ b/web/tests/browser/stage.test.ts
@@ -38,10 +38,10 @@ describe('stage', () => {
   })
 
   it('draws one tab per leaf, in leaves() order, over the focused view alone', () => {
-    expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
+    expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
     pick('[data-switch="views"][data-value="stage"]')
-    expect(tabs().map((t) => t.dataset.leaf)).toEqual(['source', 'lambda-0', 'tm-0'])
-    expect(tabs().map((t) => t.textContent)).toEqual(['source', 'λ · program', 'TM · program'])
+    expect(tabs().map((t) => t.dataset.leaf)).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
+    expect(tabs().map((t) => t.textContent)).toEqual(['source', 'λ · program', 'asm · program', 'TM · program'])
     // EXACTLY ONE HOST IS ON THE PAGE; the others are in `pane-host.ts`'s map, off it.
     expect(mounted()).toEqual(['lambda-0'])
   })
@@ -53,28 +53,29 @@ describe('stage', () => {
     expect(document.getElementById(controls ?? '')?.dataset.leaf).toBe('lambda-0')
   })
 
-  // §5: arrow keys move with a roving tabindex; Enter or Space selects.
+  // §5: arrow keys move with a roving tabindex; Enter or Space selects. The tab after λ's is asm's in the
+  // default tree (Plan 7 part 5 spec §3, row 4).
   it('moves between tabs with the arrow keys and selects with Enter, keeping the focus', () => {
     expect(tab('lambda-0').tabIndex).toBe(0)
-    expect(tab('tm-0').tabIndex).toBe(-1)
+    expect(tab('asm-0').tabIndex).toBe(-1)
     tab('lambda-0').focus()
     tab('lambda-0').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
-    expect(document.activeElement).toBe(tab('tm-0'))
+    expect(document.activeElement).toBe(tab('asm-0'))
     // **THE TAB STOP MOVES WITH THE FOCUS — a roving `tabindex` that does not rove is not one.** Without
     // this, `Tab` out of the strip and `Shift+Tab` back returns to the SELECTED tab rather than the one
     // the user arrowed to. Selection is manual here, so the stop follows focus, not selection.
-    expect(tab('tm-0').tabIndex, 'the arrowed-to tab is not the tab stop').toBe(0)
+    expect(tab('asm-0').tabIndex, 'the arrowed-to tab is not the tab stop').toBe(0)
     expect(tab('lambda-0').tabIndex, 'the tab stop was left behind on the selected tab').toBe(-1)
     // MOVING IS NOT SELECTING — manual activation, which is what §5's "Enter or Space selects" means.
     expect(selected()).toBe('lambda-0')
     ;(document.activeElement as HTMLElement).dispatchEvent(
       new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
     )
-    expect(selected()).toBe('tm-0')
-    expect(mounted()).toEqual(['tm-0'])
+    expect(selected()).toBe('asm-0')
+    expect(mounted()).toEqual(['asm-0'])
     // THE REBUILD DOES NOT DROP THE FOCUS: `renderStage` restores it by `data-leaf`, as `renderLayout`
     // restores a divider by `data-path`/`data-index`.
-    expect(document.activeElement).toBe(tab('tm-0'))
+    expect(document.activeElement).toBe(tab('asm-0'))
   })
 
   // §5: "In Stage the ⋯ menu's split items are removed" (umbrella §4 rule 4 — they can never apply
@@ -154,7 +155,7 @@ describe('stage', () => {
   it('gives back the arrangement when the switch goes to tiles', () => {
     pick('[data-switch="views"][data-value="tiles"]')
     expect(tabs()).toHaveLength(0)
-    expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
+    expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
     expect(document.querySelectorAll('#views .layout-divider').length).toBeGreaterThan(0)
     // **THE SIZES, NOT JUST THE LEAVES.** `renderStage` writes nothing to the tree, which is what makes
     // the arrangement survive — but a version that renormalised `sizes` on the way through would pass a
diff --git a/web/tests/browser/state-diagram-local.test.ts b/web/tests/browser/state-diagram-local.test.ts
index 706ee1c..f9aab4a 100644
--- a/web/tests/browser/state-diagram-local.test.ts
+++ b/web/tests/browser/state-diagram-local.test.ts
@@ -46,6 +46,17 @@ beforeAll(async () => {
   await page.viewport(1280, 2400)
   document.body.innerHTML = SHELL
   view = await (await import('../../src/main')).ready
+  // **THE TM VIEW TAKES THE WHOLE ROW, AS IT DID WHEN EVERY WIDTH IN THIS FILE WAS CHOSEN.** The default tree
+  // puts asm beside TM (Plan 7 part 5 spec §3, row 4), which halves the view at any viewport: at 1280px the
+  // program row's sub-steps no longer fit, and the local level is already under its 750px floor, so narrowing
+  // to 1000px cannot shrink it — neither the fits-case nor the narrows-case would be the case it names. Closed
+  // through the asm view's own `✕`, and the width asserted rather than assumed, since every viewport below stands
+  // for the view's width.
+  document.querySelector<HTMLButtonElement>('[data-leaf="asm-0"] button.view-close')?.click()
+  await until(() => document.querySelector('[data-leaf="asm-0"]') === null, 'the asm view to close')
+  expect(pane().getBoundingClientRect().width, 'the TM view does not span the row').toBe(
+    document.querySelector('main')?.getBoundingClientRect().width,
+  )
   view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FACT3 } })
   await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the app to settle')
   pane().querySelector<HTMLButtonElement>('[data-panel="rules"] .panel-toggle')?.click()
diff --git a/web/tests/browser/strip.test.ts b/web/tests/browser/strip.test.ts
index 162a155..ed97b20 100644
--- a/web/tests/browser/strip.test.ts
+++ b/web/tests/browser/strip.test.ts
@@ -30,8 +30,9 @@ const strip = (segments: readonly string[]) => ({ segments: () => segments, rows
 
 describe('the strip', () => {
   it("reads the program's value and counts in one line, without the normal form", () => {
-    const [lambda, tm, ...rest] = segments()
+    const [lambda, asm, tm, ...rest] = segments()
     expect(lambda).toBe('λ 42 · 7 reductions')
+    expect(asm).toBe('asm 42 · 5 instructions')
     expect(tm).toMatch(/^TM 42 · 2,870 transitions · width \d+$/)
     expect(rest).toEqual([])
     expect(document.querySelector('.strip #results + #link-status')).not.toBeNull()
diff --git a/web/tests/browser/two-lambda-panes.test.ts b/web/tests/browser/two-lambda-panes.test.ts
index b2822dd..216f2b7 100644
--- a/web/tests/browser/two-lambda-panes.test.ts
+++ b/web/tests/browser/two-lambda-panes.test.ts
@@ -313,7 +313,8 @@ beforeEach(async () => {
   await until(
     () =>
       document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
-      leafIds().length === 3 &&
+      // THE DEFAULT TREE'S FOUR VIEWS: source, λ, asm and TM.
+      leafIds().length === 4 &&
       lambdaLeaves().length === 1 &&
       // THE λ PANE IS ATTACHED AGAIN, which is the precondition every test's first click depends on and
       // the one this block used to get for free from the retire. `button.detach` is offered only on
@@ -536,7 +537,7 @@ describe('two λ panes on two λ sessions', () => {
    * CRITICAL FINDING, WHOLE-BRANCH REVIEW BEFORE MERGE — A LEG WITH NO PANE IS A LEGAL STATE.
    *
    * `closeLeaf` refuses only the last leaf in the TREE, and `draw()` offers `close` on `leaves() > 1`,
-   * so `close` is on the single λ pane a fresh page ships from the first frame — three leaves, nothing
+   * so `close` is on the single λ pane a fresh page ships from the first frame — four leaves, nothing
    * to click through to reach it. `draw.ts` and `link-wiring.ts` nonetheless threw on an empty λ or TM
    * leg, each justifying it with "`main.ts` always registers one pane of each leg before this can be
    * called" — true through wave 1, false from the moment `applyLayout` began deriving panes from the
@@ -559,7 +560,7 @@ describe('two λ panes on two λ sessions', () => {
     try {
       btn('lambda-0', 'close this view')?.click()
       await until(() => lambdaLeaves().length === 0)
-      expect(leafIds()).toEqual(['source', 'tm-0'])
+      expect(leafIds()).toEqual(['source', 'asm-0', 'tm-0'])
 
       // THE PER-FRAME PATH, DRIVEN ON PURPOSE AND ASSERTED ON ITS OUTPUT. Scrubbing the δ leg runs
       // `draw()` — the function that threw — and `.step` is painted by that same pass, so a changed
@@ -755,7 +756,7 @@ describe('two λ panes on two λ sessions', () => {
    * The two docs that justified keying custody by session argued from "the closed leaf's id is never
    * reused (`nextLeafId` only counts up)" — the history note under `heldEditors` and under `applyLayout`
    * holds that premise now, since both docs state the corrected one — and it is true of the ids
-   * `nextLeafId` mints and false of the three `defaultLayout` writes down. A pane that merely INHERITED the id was resolved as the editor's
+   * `nextLeafId` mints and false of the four `defaultLayout` writes down. A pane that merely INHERITED the id was resolved as the editor's
    * home the moment it was rebound to the scratch, and the next layout gesture delivered the held editor
    * onto it — the silent relocation §4.2 and §4.3 both refuse, with the claim control withdrawing itself
    * as the editor appeared where nobody had asked for it.
diff --git a/web/tests/browser/view-title.test.ts b/web/tests/browser/view-title.test.ts
index 9340960..ff3a924 100644
--- a/web/tests/browser/view-title.test.ts
+++ b/web/tests/browser/view-title.test.ts
@@ -54,7 +54,16 @@ function lambdaSession(id: SessionId, label: string, text: string, detached: boo
   const hist = new History<LambdaState>(1_000_000)
   hist.push({ text, spans: [], cut: null, step: 0, redex_span: null, owner: 'None' }, 1)
   const leg: LegState<LambdaState> = { hist, status: { available: true, reason: '' }, done: null, playing: false }
-  return { id, label, detached, client: fakeClient(), legs: { lambda: leg }, tmProgram: null, tmScratch: null }
+  return {
+    id,
+    label,
+    detached,
+    client: fakeClient(),
+    legs: { lambda: leg },
+    tmProgram: null,
+    tmScratch: null,
+    asmProgram: null,
+  }
 }
 
 /**
@@ -82,6 +91,7 @@ function bothLegs(id: SessionId, label: string, text: string): SessionEntry {
     // `pane-host.ts`, so nothing in this file reads it.
     tmProgram: null,
     tmScratch: null,
+    asmProgram: null,
   }
 }
 
diff --git a/web/tests/browser/workspace-restore.test.ts b/web/tests/browser/workspace-restore.test.ts
index 814607e..5f611c6 100644
--- a/web/tests/browser/workspace-restore.test.ts
+++ b/web/tests/browser/workspace-restore.test.ts
@@ -28,18 +28,19 @@ describe('a restored workspace', () => {
   })
 
   /**
-   * **ONE SPEED, IN EVERY VIEW THAT STEPS** — spec §8. The stored 250/s has to reach both views' selects,
+   * **ONE SPEED, IN EVERY VIEW THAT STEPS** — spec §8. The stored 250/s has to reach every view's select,
    * which is the restore and the fan-out in one assertion: `main.ts`'s `setSpeed` draws so every step
    * control repaints, and `step-controls.ts` reads the workspace's speed on every update.
    */
   // **SCOPED TO `.view-steps`, WHERE IT USED TO SWEEP THE PAGE.** Part 2b's step bar is a second
-  // `stepControls` instance (`step-bar.ts`), so a page-wide `.controls select.speed` now finds three —
-  // and this case's own name says "every view that steps", which is the two. The bar's copy is asserted
+  // `stepControls` instance (`step-bar.ts`), so a page-wide `.controls select.speed` now finds four —
+  // and this case's own name says "every view that steps", which is the λ, asm and TM views of the default
+  // tree (three since the asm view, Plan 7 part 5 spec §3, row 4). The bar's copy is asserted
   // on its own line below rather than dropped: one global speed means the bar shows it too (spec §8).
   it('shows the restored speed in every view that steps', () => {
     expect(
       [...document.querySelectorAll<HTMLSelectElement>('.view-steps .controls select.speed')].map((el) => el.value),
-    ).toEqual(['250', '250'])
+    ).toEqual(['250', '250', '250'])
     expect(document.querySelector<HTMLSelectElement>('#step-bar select.speed')?.value).toBe('250')
   })
 
@@ -48,6 +49,7 @@ describe('a restored workspace', () => {
     if (first === null) throw new Error('no speed control on the λ view')
     first.value = '1000'
     first.dispatchEvent(new Event('change'))
+    expect(document.querySelector<HTMLSelectElement>('[data-leaf="asm-0"] select.speed')?.value).toBe('1000')
     expect(document.querySelector<HTMLSelectElement>('[data-leaf="tm-0"] select.speed')?.value).toBe('1000')
     // THE BAR IS A STEP CONTROL ON THE PAGE TOO, so "every step control reflects a change at once"
     // (spec §8) includes it — even while the `steps` switch has it hidden.
@@ -72,7 +74,7 @@ describe('a restored workspace', () => {
 
   /**
    * **A LEAF ID COMES BACK, AND ITS OLD PANEL STATE MUST NOT COME WITH IT.** `defaultLayout()` re-mints
-   * `source`, `lambda-0` and `tm-0` as literals, so *reset preset* after closing the TM view hands the
+   * `source`, `lambda-0`, `asm-0` and `tm-0` as literals, so *reset preset* after closing the TM view hands the
    * id to a new view. Until `main.ts` normalised the workspace against the live tree, the write dropped
    * the closed view's panel state and MEMORY kept it — so this same sequence opened the rules panel
    * closed, and opened it open after a reload, from the same clicks.
diff --git a/web/tests/node/controls.test.ts b/web/tests/node/controls.test.ts
index 2876d09..59b6a00 100644
--- a/web/tests/node/controls.test.ts
+++ b/web/tests/node/controls.test.ts
@@ -70,6 +70,19 @@ describe('controlState', () => {
     expect(c.stepText).toContain('deeper than')
   })
 
+  // THE ASM LEG'S FULL CAPS ARE THE DEPTH REFUSAL'S KIND (Plan 7 part 5 spec amendment 10): raising the step cap
+  // leaves the stack, the heap or the saved frames exactly as full, so there is no continue — and the line says which.
+  it.each([
+    ['stack-full', 'the call stack is full'],
+    ['heap-full', 'the heap is full'],
+    ['memory-full', 'its saved call frames are full'],
+  ] as const)('offers NO continue for %s, and names the cap', (done, words) => {
+    const c = controlState(view({ done, length: 9, head: 8, currentStep: 8, newestStep: 8 }))
+    expect(c.continueLabel).toBeNull()
+    expect(c.canForward).toBe(false)
+    expect(c.stepText).toBe(`step 8 of 8 — ${words}`)
+  })
+
   it('offers nothing to continue once the run ended', () => {
     const c = controlState(view({ done: 'ended', length: 8, head: 7, newestStep: 7 }))
     expect(c.continueLabel).toBeNull()
@@ -161,6 +174,9 @@ describe('canRecordFurther', () => {
     expect(canRecordFurther('budget', false)).toBe(true)
     expect(canRecordFurther('ended', false)).toBe(false)
     expect(canRecordFurther('depth-refused', false)).toBe(false)
+    expect(canRecordFurther('stack-full', false)).toBe(false)
+    expect(canRecordFurther('heap-full', false)).toBe(false)
+    expect(canRecordFurther('memory-full', false)).toBe(false)
     expect(canRecordFurther(null, false)).toBe(false)
   })
 
diff --git a/web/tests/node/layout.test.ts b/web/tests/node/layout.test.ts
index 7873b35..a8031a7 100644
--- a/web/tests/node/layout.test.ts
+++ b/web/tests/node/layout.test.ts
@@ -16,6 +16,7 @@ import {
   setLeafKind,
   splitLeaf,
 } from '../../src/layout'
+import type { PaneKind } from '../../src/panes'
 
 /**
  * THE TREE MODEL, WITH NO DOM ANYWHERE — every invariant design §4.1 states, asserted as a value.
@@ -25,10 +26,10 @@ import {
  * not sum to 1 render as a gap. Both are values here.
  */
 
-const leaf = (id: string, pane: 'source' | 'lambda' | 'tm'): LayoutNode => ({ kind: 'leaf', id, pane })
+const leaf = (id: string, pane: PaneKind): LayoutNode => ({ kind: 'leaf', id, pane })
 
 describe('defaultLayout', () => {
-  it('reproduces the arrangement index.html ships', () => {
+  it('puts source and λ above asm and TM, two rows of two', () => {
     expect(defaultLayout()).toEqual({
       kind: 'split',
       dir: 'column',
@@ -40,7 +41,12 @@ describe('defaultLayout', () => {
           sizes: [0.5, 0.5],
           children: [leaf('source', 'source'), leaf('lambda-0', 'lambda')],
         },
-        leaf('tm-0', 'tm'),
+        {
+          kind: 'split',
+          dir: 'row',
+          sizes: [0.5, 0.5],
+          children: [leaf('asm-0', 'asm'), leaf('tm-0', 'tm')],
+        },
       ],
     })
   })
@@ -59,7 +65,7 @@ describe('splitLeaf', () => {
 
   it('splits a nested leaf without disturbing its siblings', () => {
     const tree = splitLeaf(defaultLayout(), 'tm-0', 'column', 'tm-1', 'tm')
-    expect(leaves(tree).map((l) => l.id)).toEqual(['source', 'lambda-0', 'tm-0', 'tm-1'])
+    expect(leaves(tree).map((l) => l.id)).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0', 'tm-1'])
   })
 
   it('refuses to split the source leaf, because there is no second editor to duplicate', () => {
@@ -88,15 +94,21 @@ describe('closeLeaf', () => {
   })
 
   it('collapses recursively so no single-child spine survives', () => {
-    // column[ row[source, lambda-0], tm-0 ] -> close source, close lambda-0 -> leaf(tm-0)
+    // column[ row[source, lambda-0], row[asm-0, tm-0] ] -> close source, close lambda-0 -> row[asm-0, tm-0]
+    const lower: LayoutNode = {
+      kind: 'split',
+      dir: 'row',
+      sizes: [0.5, 0.5],
+      children: [leaf('asm-0', 'asm'), leaf('tm-0', 'tm')],
+    }
     const afterSource = closeLeaf(defaultLayout(), 'source')
     expect(afterSource).toEqual({
       kind: 'split',
       dir: 'column',
       sizes: [0.5, 0.5],
-      children: [leaf('lambda-0', 'lambda'), leaf('tm-0', 'tm')],
+      children: [leaf('lambda-0', 'lambda'), lower],
     })
-    expect(closeLeaf(afterSource, 'lambda-0')).toEqual(leaf('tm-0', 'tm'))
+    expect(closeLeaf(afterSource, 'lambda-0')).toEqual(lower)
   })
 
   it('refuses to close the last leaf', () => {
@@ -350,6 +362,24 @@ describe('parseLayout', () => {
     ).not.toBeNull()
   })
 
+  /**
+   * A STORED ASM VIEW SURVIVES A RELOAD. A kind `validate` does not know fails the whole layout, and a layout that
+   * fails is replaced by the default without a word, so an asm view would be lost on every reload with nothing red.
+   * Written out by hand rather than read off `defaultLayout()`, so a later default without an asm view keeps the case.
+   */
+  it('accepts an asm view in a stored tree', () => {
+    const tree = {
+      kind: 'split',
+      dir: 'row',
+      children: [
+        { kind: 'leaf', id: SOURCE_LEAF, pane: 'source' },
+        { kind: 'leaf', id: 'asm-3', pane: 'asm' },
+      ],
+      sizes: [0.5, 0.5],
+    }
+    expect(parseLayout(wrap(tree))).toEqual(tree)
+  })
+
   /**
    * AND THE CONVERSE: `SOURCE_LEAF` IS RESERVED FOR THE SOURCE KIND. The id and the kind have to agree
    * in BOTH directions, because `pane-host.ts` keys the editor's pre-seeded host on this id — a
@@ -486,7 +516,7 @@ describe('insertBeside', () => {
 
   it('puts the new leaf after its subject in leaves() order', () => {
     const next = insertBeside(defaultLayout(), 'lambda-0', 'row', 'pane-1', 'tm')
-    expect(leaves(next).map((l) => l.id)).toEqual(['source', 'lambda-0', 'pane-1', 'tm-0'])
+    expect(leaves(next).map((l) => l.id)).toEqual(['source', 'lambda-0', 'pane-1', 'asm-0', 'tm-0'])
   })
 
   it('still refuses a second source leaf and a duplicate id', () => {
diff --git a/web/tests/node/link-status.test.ts b/web/tests/node/link-status.test.ts
index 8c25f80..a9a3502 100644
--- a/web/tests/node/link-status.test.ts
+++ b/web/tests/node/link-status.test.ts
@@ -87,9 +87,15 @@ describe('linkStatus · detachment', () => {
   // not `undefined` leaking into the output.
   it('says nothing about detachment when both panes are attached', () => {
     expect(linkStatus({ state: 'none' })).toBe('')
-    expect(linkStatus({ state: 'none', detached: { lambda: false, tm: false } })).toBe('')
+    expect(linkStatus({ state: 'none', detached: { lambda: false, asm: false, tm: false } })).toBe('')
     expect(
-      linkStatus({ state: 'linked', tm: true, lambda: 'shown', focus: true, detached: { lambda: false, tm: false } }),
+      linkStatus({
+        state: 'linked',
+        tm: true,
+        lambda: 'shown',
+        focus: true,
+        detached: { lambda: false, asm: false, tm: false },
+      }),
     ).toBe('the machine is here right now')
   })
 
@@ -97,10 +103,10 @@ describe('linkStatus · detachment', () => {
   // the other pane bound to it), which is why `detached` is a record and not a boolean. A shape that
   // could only say "something is detached" passes every other case here and fails these two.
   it('names only the pane that is detached', () => {
-    expect(linkStatus({ state: 'none', detached: { lambda: true, tm: false } })).toBe(
+    expect(linkStatus({ state: 'none', detached: { lambda: true, asm: false, tm: false } })).toBe(
       'λ view shows a copy — not linked to the program',
     )
-    expect(linkStatus({ state: 'none', detached: { lambda: false, tm: true } })).toBe(
+    expect(linkStatus({ state: 'none', detached: { lambda: false, asm: false, tm: true } })).toBe(
       'TM view shows a copy — not linked to the program',
     )
   })
@@ -108,7 +114,7 @@ describe('linkStatus · detachment', () => {
   // ONE CLAUSE, NOT THE SAME SENTENCE TWICE. "not linked to source" is one fact about one
   // correspondence; repeating it verbatim either side of a `·` reads as two unrelated failures.
   it('names both panes in one clause when both are detached', () => {
-    expect(linkStatus({ state: 'none', detached: { lambda: true, tm: true } })).toBe(
+    expect(linkStatus({ state: 'none', detached: { lambda: true, asm: false, tm: true } })).toBe(
       'λ and TM views show copies — not linked to the program',
     )
   })
@@ -117,7 +123,7 @@ describe('linkStatus · detachment', () => {
   // outside the correspondence entirely is a bigger fact than anything about what resolved inside it, and
   // every clause after it is about the panes still inside.
   it('reports detachment ahead of the pin narration', () => {
-    expect(linkStatus({ state: 'stale', detached: { lambda: true, tm: false } })).toBe(
+    expect(linkStatus({ state: 'stale', detached: { lambda: true, asm: false, tm: false } })).toBe(
       'λ view shows a copy — not linked to the program · linking resumes when this compiles',
     )
   })
@@ -133,7 +139,7 @@ describe('linkStatus · detachment', () => {
         tm: false,
         lambda: 'none-here',
         focus: false,
-        detached: { lambda: true, tm: false },
+        detached: { lambda: true, asm: false, tm: false },
       }),
     ).toBe('λ view shows a copy — not linked to the program · this construct emits no machine states')
   })
@@ -148,14 +154,20 @@ describe('linkStatus · detachment', () => {
         tm: false,
         lambda: 'none-here',
         focus: true,
-        detached: { lambda: false, tm: true },
+        detached: { lambda: false, asm: false, tm: true },
       }),
     ).toBe('TM view shows a copy — not linked to the program · this construct has no node in the λ term at this step')
   })
 
   it('leaves only the detachment clause when both panes are detached', () => {
     expect(
-      linkStatus({ state: 'linked', tm: false, lambda: 'declined', focus: true, detached: { lambda: true, tm: true } }),
+      linkStatus({
+        state: 'linked',
+        tm: false,
+        lambda: 'declined',
+        focus: true,
+        detached: { lambda: true, asm: false, tm: true },
+      }),
     ).toBe('λ and TM views show copies — not linked to the program')
   })
 })
diff --git a/web/tests/node/link.test.ts b/web/tests/node/link.test.ts
index a130627..3b068f7 100644
--- a/web/tests/node/link.test.ts
+++ b/web/tests/node/link.test.ts
@@ -19,6 +19,7 @@ function wire(over: Partial<LinkIndexWire> = {}): LinkIndexWire {
     sourceNodeEnd: new Uint32Array([17, 5, 17]),
     sourceNodeId: new Uint32Array([100, 101, 102]),
     tmOwner: new Int32Array([-1, 100, 101, 100, -1]),
+    asmOwner: new Int32Array([]),
     ...over,
   }
 }
diff --git a/web/tests/node/lsp-protocol.test.ts b/web/tests/node/lsp-protocol.test.ts
index e3d23f4..ba14302 100644
--- a/web/tests/node/lsp-protocol.test.ts
+++ b/web/tests/node/lsp-protocol.test.ts
@@ -27,9 +27,9 @@ describe('the language ids the client sends', () => {
   })
 
   it('cover every pane kind that has an editor, and every id has an extension', () => {
-    // `PaneKind` is 'source' | 'lambda' | 'tm'. asm has no editor until part 5, so it is in
-    // LANGUAGE_IDS (the server serves it) but not in LANGUAGE_OF_PANE (nothing mounts it).
-    expect(Object.keys(LANGUAGE_OF_PANE).sort()).toEqual(['lambda', 'source', 'tm'])
+    // EVERY `PaneKind`, asm included: its editor is part 5c's asm copies, and they take their language from here.
+    expect(Object.keys(LANGUAGE_OF_PANE).sort()).toEqual(['asm', 'lambda', 'source', 'tm'])
+    expect(LANGUAGE_OF_PANE.asm).toBe('redextape_asm')
     for (const id of Object.values(LANGUAGE_OF_PANE)) expect(LANGUAGE_IDS).toContain(id)
     for (const id of LANGUAGE_IDS) expect(EXTENSION_OF_LANGUAGE[id]).toBeTruthy()
   })
diff --git a/web/tests/node/protocol.test.ts b/web/tests/node/protocol.test.ts
index 25f5366..9d0f407 100644
--- a/web/tests/node/protocol.test.ts
+++ b/web/tests/node/protocol.test.ts
@@ -1,5 +1,8 @@
 import { describe, expect, it } from 'vitest'
 import {
+  ASM_WORD_BYTES,
+  asmFrameBytes,
+  asmRecordEnd,
   FRAME_OVERHEAD_BYTES,
   forkable,
   lambdaFrameBytes,
@@ -11,6 +14,7 @@ import {
   tmFrameBytes,
 } from '../../src/protocol'
 import type { LambdaState, TmProgram, TmState } from '../../src/types'
+import { frameOf } from './asm-fixtures'
 
 const lam = (text: string, spans: number): LambdaState => ({
   text,
@@ -167,3 +171,35 @@ describe('the fork cap', () => {
     expect(MAX_FORK_RULES).toBeLessThan(94_182) // list60's rules — must be refused
   })
 })
+
+describe('asmFrameBytes', () => {
+  const v = { word: '7', tag: 'Value' as const }
+
+  it('charges every word a frame carries, and a byte per written bit', () => {
+    expect(asmFrameBytes(frameOf())).toBe(FRAME_OVERHEAD_BYTES + ASM_WORD_BYTES)
+    const f = frameOf({
+      locals: [v, v, v],
+      written: [true, false, true],
+      args: [v],
+      frames: [{ ret_pc: 4, saved: [v, v], saved_len: 2 }],
+      cells: [{ cell: 1, head: v, tail: v }],
+      boxes: [{ handle: 1, content: v }],
+    })
+    // rr, three locals, one argument, two saved words, a cell's two halves and a box's content: ten words.
+    expect(asmFrameBytes(f)).toBe(FRAME_OVERHEAD_BYTES + 10 * ASM_WORD_BYTES + 3)
+  })
+})
+
+describe('asmRecordEnd', () => {
+  it('ends a halt or a fault, and names each full cap, and calls only the step cap capped', () => {
+    expect(asmRecordEnd({ run: 'Ended', cap: null })).toBe('ended')
+    expect(asmRecordEnd({ run: 'Capped', cap: 'Steps' })).toBe('capped')
+    expect(asmRecordEnd({ run: 'Capped', cap: 'Stack' })).toBe('stack-full')
+    expect(asmRecordEnd({ run: 'Capped', cap: 'Heap' })).toBe('heap-full')
+    expect(asmRecordEnd({ run: 'Capped', cap: 'Mem' })).toBe('memory-full')
+  })
+
+  it('reads a run that is still going as ended, since it is only asked once stepping has stopped', () => {
+    expect(asmRecordEnd({ run: 'Running', cap: null })).toBe('ended')
+  })
+})
diff --git a/web/tests/node/readout.test.ts b/web/tests/node/readout.test.ts
index 7eecf39..6eb72f5 100644
--- a/web/tests/node/readout.test.ts
+++ b/web/tests/node/readout.test.ts
@@ -14,6 +14,10 @@ const LAMBDA = {
   state: { text: '42', step: 7, cut: null, owner: 'None' as const },
   value: { Value: { text: '42' } },
 }
+const ASM = {
+  status: { available: true, reason: '', run: 'Ended' as const, cap: null, total_steps: 55 },
+  value: { Value: { text: '42' } },
+}
 const TM = {
   status: { available: true, reason: '', width: 8, total_steps: 2870, run: 'Halted' as const, node: null },
   value: { Value: { text: '42' } },
@@ -21,8 +25,8 @@ const TM = {
 
 describe('programSegments', () => {
   it('reads value and counts per leg, in the new vocabulary, with no normal-form text', () => {
-    const s = programSegments({ kind: 'result', lambda: LAMBDA, tm: TM } as never)
-    expect(s).toEqual(['λ 42 · 7 reductions', 'TM 42 · 2,870 transitions · width 8'])
+    const s = programSegments({ kind: 'result', lambda: LAMBDA, asm: ASM, tm: TM } as never)
+    expect(s).toEqual(['λ 42 · 7 reductions', 'asm 42 · 55 instructions', 'TM 42 · 2,870 transitions · width 8'])
   })
 
   it('says a program that does not compile, and how many errors', () => {
@@ -87,12 +91,14 @@ describe('programRows', () => {
   // §9: "Every row on its own line, the normal-form text included" — which is exactly what the strip
   // leaves out, and the one difference between the two readouts' content.
   it('keeps the normal-form text the strip drops, one row per fact', () => {
-    const rows = programRows({ kind: 'result', lambda: LAMBDA, tm: TM } as never)
+    const rows = programRows({ kind: 'result', lambda: LAMBDA, asm: ASM, tm: TM } as never)
     expect(rows.map((r) => r.label)).toContain('λ normal form')
     expect(rows.every((r) => r.value !== '')).toBe(true)
     // THE STRIP'S OWN BUILDER IS THE CONTRAST, asserted rather than assumed: a claim that the inspector
     // keeps what the strip drops is only worth making beside the thing that drops it.
-    expect(programSegments({ kind: 'result', lambda: LAMBDA, tm: TM } as never).join(' ')).not.toContain('normal form')
+    expect(programSegments({ kind: 'result', lambda: LAMBDA, asm: ASM, tm: TM } as never).join(' ')).not.toContain(
+      'normal form',
+    )
   })
 
   /**
@@ -103,7 +109,7 @@ describe('programRows', () => {
    */
   it('carries the note on a cut normal form, which the strip never had to', () => {
     const deep = { ...LAMBDA, state: { ...LAMBDA.state, cut: 'Depth' as const } }
-    const rows = programRows({ kind: 'result', lambda: deep, tm: TM } as never)
+    const rows = programRows({ kind: 'result', lambda: deep, asm: ASM, tm: TM } as never)
     const nf = rows.find((r) => r.label.includes('normal form') || r.label.includes('term so far'))
     expect(nf, 'no normal-form row to carry a note').toBeDefined()
     expect(nf?.note, 'the cut mark was dropped on the way to the inspector').toBeTruthy()
diff --git a/web/tests/node/replies.test.ts b/web/tests/node/replies.test.ts
index c54eac0..43e3855 100644
--- a/web/tests/node/replies.test.ts
+++ b/web/tests/node/replies.test.ts
@@ -82,6 +82,7 @@ function sourceEntry(): SessionEntry {
     legs: { lambda: leg<LambdaState>(), tm: leg<TmState>() },
     tmProgram: null,
     tmScratch: null,
+    asmProgram: null,
   }
 }
 
@@ -100,9 +101,11 @@ const compiled = (tmProgram: TmProgram | null, tapeNames: string[]): RunReply =>
   kind: 'compiled',
   gen: 1,
   lambda: { available: true, reason: '', node: null, run: null },
+  asm: { available: false, reason: 'no asm leg', run: null, cap: null, total_steps: null },
   tm: { available: true, reason: '', width: 8, run: null, total_steps: null },
   declinedSpan: null,
   tmProgram,
+  asmProgram: null,
   tapeNames,
   linkIndex: null,
   tmText: null,
diff --git a/web/tests/node/results.test.ts b/web/tests/node/results.test.ts
index 22b6c58..99eb72f 100644
--- a/web/tests/node/results.test.ts
+++ b/web/tests/node/results.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest'
-import type { LambdaLeg, TmLeg } from '../../src/protocol'
+import type { AsmLeg, LambdaLeg, TmLeg } from '../../src/protocol'
 import { noSessionRows, resultRows, valueLine } from '../../src/results'
 import type { Diagnostic, LambdaState } from '../../src/types'
 
@@ -19,6 +19,11 @@ const lambdaOk: LambdaLeg = {
   declinedSpan: null,
 }
 
+const asmOk: AsmLeg = {
+  status: { available: true, reason: '', run: 'Running', cap: null, total_steps: 55 },
+  value: { Value: { text: '42' } },
+}
+
 const tmOk: TmLeg = {
   status: { available: true, reason: '', width: 8, run: 'Running', total_steps: 2870 },
   value: { Value: { text: '42' } },
@@ -28,7 +33,7 @@ const find = (rows: ReturnType<typeof resultRows>, leg: string, label: string) =
   rows.find((r) => r.leg === leg && r.label === label)
 
 describe('resultRows — the happy path', () => {
-  const rows = resultRows(lambdaOk, tmOk)
+  const rows = resultRows(lambdaOk, asmOk, tmOk)
 
   it('shows the λ normal form, step count and value', () => {
     expect(find(rows, 'λ', 'normal form')?.value).toBe('λf. λx. f (f x)')
@@ -45,7 +50,7 @@ describe('resultRows — the happy path', () => {
 
 describe('resultRows — a cut names its cause', () => {
   it('shows the text AND says it was cut, rather than choosing one', () => {
-    const rows = resultRows({ ...lambdaOk, state: { ...okState, cut: 'Bytes' } }, tmOk)
+    const rows = resultRows({ ...lambdaOk, state: { ...okState, cut: 'Bytes' } }, asmOk, tmOk)
     const row = find(rows, 'λ', 'normal form')
     expect(row?.value).toBe('λf. λx. f (f x)')
     expect(row?.note).toBe('… truncated at 64 KiB')
@@ -55,29 +60,31 @@ describe('resultRows — a cut names its cause', () => {
   // unwinds, so the text can be well-formed λ that reparses into a DIFFERENT, shorter term. Saying
   // "truncated at 64 KiB" about a 6 KB term would be false twice over.
   it('names depth separately, because that text is not a prefix', () => {
-    const rows = resultRows({ ...lambdaOk, state: { ...okState, cut: 'Depth' } }, tmOk)
+    const rows = resultRows({ ...lambdaOk, state: { ...okState, cut: 'Depth' } }, asmOk, tmOk)
     expect(find(rows, 'λ', 'normal form')?.note).toBe('… too deep to show in full')
   })
 
   it('says nothing when the walk ran to completion', () => {
-    expect(find(resultRows(lambdaOk, tmOk), 'λ', 'normal form')?.note).toBeUndefined()
+    expect(find(resultRows(lambdaOk, asmOk, tmOk), 'λ', 'normal form')?.note).toBeUndefined()
   })
 })
 
 describe('resultRows — total_steps is read against tmValue, not against run', () => {
   // The pair `browser.rs` pins: a finished run reports run: "Running" because the CURSOR has not moved.
   it('calls it a length when a final configuration exists', () => {
-    expect(find(resultRows(lambdaOk, tmOk), 'TM', 'steps')?.value).toBe('2,870 transitions')
+    expect(find(resultRows(lambdaOk, asmOk, tmOk), 'TM', 'steps')?.value).toBe('2,870 transitions')
   })
 
   it('calls it a cap when tmValue is Unfinished, even though run is identical', () => {
     const capped: TmLeg = { status: { ...tmOk.status }, value: 'Unfinished' }
-    expect(find(resultRows(lambdaOk, capped), 'TM', 'steps')?.value).toBe('stopped after 2,870 transitions at a cap')
+    expect(find(resultRows(lambdaOk, asmOk, capped), 'TM', 'steps')?.value).toBe(
+      'stopped after 2,870 transitions at a cap',
+    )
   })
 
   it('does not name which cap it hit', () => {
     const capped: TmLeg = { status: { ...tmOk.status }, value: 'Unfinished' }
-    expect(find(resultRows(lambdaOk, capped), 'TM', 'steps')?.value).not.toContain('step cap')
+    expect(find(resultRows(lambdaOk, asmOk, capped), 'TM', 'steps')?.value).not.toContain('step cap')
   })
 })
 
@@ -94,13 +101,30 @@ describe('resultRows — refusals', () => {
       value: null,
       declinedSpan: { start: 44, end: 45 },
     }
-    const rows = resultRows(declined, tmOk)
+    const rows = resultRows(declined, asmOk, tmOk)
     expect(find(rows, 'λ', 'declined')?.value).toBe('a closure assigns a variable captured from an outer scope')
     expect(find(rows, 'λ', 'normal form')).toBeUndefined()
     // The TM leg still answers — a declined backend is not a failed compile.
     expect(find(rows, 'TM', 'value')?.value).toBe('42')
   })
 
+  it('shows the asm reason when that backend declines, and nothing else for it', () => {
+    const declined: AsmLeg = {
+      status: {
+        available: false,
+        reason: 'the program nests deeper than the asm lowering allows',
+        run: null,
+        cap: null,
+        total_steps: null,
+      },
+      value: null,
+    }
+    const rows = resultRows(lambdaOk, declined, tmOk).filter((r) => r.leg === 'asm')
+    expect(rows).toEqual([
+      { leg: 'asm', label: 'declined', value: 'the program nests deeper than the asm lowering allows' },
+    ])
+  })
+
   it('shows the TM reason and no width when that backend declines', () => {
     const declined: TmLeg = {
       status: {
@@ -112,7 +136,7 @@ describe('resultRows — refusals', () => {
       },
       value: null,
     }
-    const rows = resultRows(lambdaOk, declined)
+    const rows = resultRows(lambdaOk, asmOk, declined)
     expect(find(rows, 'TM', 'declined')?.value).toBe('the machine this program needs is too large to build')
     expect(find(rows, 'TM', 'width')).toBeUndefined()
   })
@@ -121,20 +145,20 @@ describe('resultRows — refusals', () => {
   // and this slice has no button to offer — so the words are the whole distinction.
   it('distinguishes a spent budget from a depth refusal', () => {
     const capped: LambdaLeg = { ...lambdaOk, status: { ...lambdaOk.status, run: 'Capped' }, value: 'Unfinished' }
-    expect(find(resultRows(capped, tmOk), 'λ', 'run')?.value).toBe('spent its step budget')
+    expect(find(resultRows(capped, asmOk, tmOk), 'λ', 'run')?.value).toBe('spent its step budget')
 
     const deep: LambdaLeg = { ...lambdaOk, status: { ...lambdaOk.status, run: 'DepthRefused' }, value: 'Unfinished' }
-    expect(find(resultRows(deep, tmOk), 'λ', 'run')?.value).toBe('the term is deeper than the reducer allows')
+    expect(find(resultRows(deep, asmOk, tmOk), 'λ', 'run')?.value).toBe('the term is deeper than the reducer allows')
   })
 
   it('reports a fault as a fault rather than as an empty value', () => {
     const faulted: LambdaLeg = { ...lambdaOk, value: { Fault: { message: 'budget exhausted' } } }
-    expect(find(resultRows(faulted, tmOk), 'λ', 'value')?.value).toBe('fault: budget exhausted')
+    expect(find(resultRows(faulted, asmOk, tmOk), 'λ', 'value')?.value).toBe('fault: budget exhausted')
   })
 
   it('reports an undecodable normal form as an answer', () => {
     const undec: LambdaLeg = { ...lambdaOk, value: 'Undecodable' }
-    expect(find(resultRows(undec, tmOk), 'λ', 'value')?.value).toBe('no encoding for this type')
+    expect(find(resultRows(undec, asmOk, tmOk), 'λ', 'value')?.value).toBe('no encoding for this type')
   })
 })
 
@@ -146,15 +170,15 @@ describe('resultRows — a run stopped by the recording budget, not by ending',
   const running: LambdaLeg = { ...lambdaOk, status: { ...lambdaOk.status, run: 'Running' } }
 
   it('does not call the term a normal form', () => {
-    expect(find(resultRows(running, tmOk), 'λ', 'normal form')).toBeUndefined()
+    expect(find(resultRows(running, asmOk, tmOk), 'λ', 'normal form')).toBeUndefined()
   })
 
   it('labels it "term so far" instead, still showing the text', () => {
-    expect(find(resultRows(running, tmOk), 'λ', 'term so far')?.value).toBe(okState.text)
+    expect(find(resultRows(running, asmOk, tmOk), 'λ', 'term so far')?.value).toBe(okState.text)
   })
 
   it('explains that recording stopped, not that the run ended', () => {
-    const note = find(resultRows(running, tmOk), 'λ', 'run')?.value
+    const note = find(resultRows(running, asmOk, tmOk), 'λ', 'run')?.value
     expect(note).toBeTruthy()
     expect(note).not.toMatch(/\bended\b/i)
     expect(note).toContain('recording stopped')
@@ -203,3 +227,38 @@ describe('valueLine', () => {
     )
   })
 })
+
+describe('resultRows — the asm leg', () => {
+  const asm = (over: Partial<AsmLeg['status']>, value: AsmLeg['value']): AsmLeg => ({
+    status: { ...asmOk.status, ...over },
+    value,
+  })
+  const steps = (a: AsmLeg) => find(resultRows(lambdaOk, a, tmOk), 'asm', 'steps')?.value
+
+  it('counts a finished run in instructions and shows its value', () => {
+    const rows = resultRows(lambdaOk, asmOk, tmOk)
+    expect(find(rows, 'asm', 'steps')?.value).toBe('55 instructions')
+    expect(find(rows, 'asm', 'value')?.value).toBe('42')
+  })
+
+  it('says a run compile could not finish stopped at a cap, and names a full one once recording reached it', () => {
+    expect(steps(asm({ total_steps: 5_000_000 }, 'Unfinished'))).toBe('stopped after 5,000,000 instructions at a cap')
+    expect(steps(asm({ total_steps: 5_000_000, run: 'Capped', cap: 'Steps' }, 'Unfinished'))).toBe(
+      'stopped after 5,000,000 instructions at a cap',
+    )
+    expect(steps(asm({ total_steps: 1_100_009, run: 'Capped', cap: 'Stack' }, 'Unfinished'))).toBe(
+      'stopped after 1,100,009 instructions — the call stack is full',
+    )
+  })
+
+  it('counts a faulted run as an end, and its value says what faulted where', () => {
+    const faulted = asm({ run: 'Ended', total_steps: 12 }, { Fault: { message: 'head of empty list at pc5' } })
+    expect(steps(faulted)).toBe('12 instructions')
+    expect(find(resultRows(lambdaOk, faulted, tmOk), 'asm', 'value')?.value).toBe('fault: head of empty list at pc5')
+  })
+
+  it('lists the legs in order, λ then asm then TM', () => {
+    const legs = resultRows(lambdaOk, asmOk, tmOk).map((r) => r.leg)
+    expect([...new Set(legs)]).toEqual(['λ', 'asm', 'TM'])
+  })
+})
diff --git a/web/tests/node/scratch.test.ts b/web/tests/node/scratch.test.ts
index ca5e987..84dac98 100644
--- a/web/tests/node/scratch.test.ts
+++ b/web/tests/node/scratch.test.ts
@@ -157,6 +157,7 @@ function sourceEntry(text = 'from source'): SessionEntry {
     legs: { lambda },
     tmProgram: null,
     tmScratch: null,
+    asmProgram: null,
   }
 }
 
diff --git a/web/tests/node/session-client.test.ts b/web/tests/node/session-client.test.ts
index 6c8d371..12691a2 100644
--- a/web/tests/node/session-client.test.ts
+++ b/web/tests/node/session-client.test.ts
@@ -180,16 +180,24 @@ describe('SessionClient streaming', () => {
       kind: 'compiled',
       gen: 1,
       lambda: LAMBDA_OK,
+      asm: { available: false, reason: 'no asm leg', run: null, cap: null, total_steps: null },
       tm: TM_OK,
       declinedSpan: null,
       tmProgram: null,
+      asmProgram: null,
       tapeNames: [],
       linkIndex: null,
       tmText: null,
     })
     deliver({ kind: 'lambda-frames', gen: 1, frames: [], done: null })
     deliver({ kind: 'lambda-frames', gen: 1, frames: [], done: 'ended' })
-    deliver({ kind: 'result', gen: 1, lambda: LEG_OK, tm: TM_LEG_OK })
+    deliver({
+      kind: 'result',
+      gen: 1,
+      lambda: LEG_OK,
+      asm: { status: { available: false, reason: 'no asm leg', run: null, cap: null, total_steps: null }, value: null },
+      tm: TM_LEG_OK,
+    })
     expect(seen).toEqual(['compiled', 'lambda-frames', 'lambda-frames', 'result'])
   })
 
@@ -242,9 +250,11 @@ const compiled = (gen: number): RunReply => ({
   kind: 'compiled',
   gen,
   lambda: { available: true, reason: '', node: null, run: 'Running' },
+  asm: { available: false, reason: 'no asm leg', run: null, cap: null, total_steps: null },
   tm: { available: true, reason: '', width: null, run: 'Running', total_steps: null },
   declinedSpan: null,
   tmProgram: null,
+  asmProgram: null,
   tapeNames: [],
   linkIndex: null,
   tmText: null,
diff --git a/web/tests/node/sessions.test.ts b/web/tests/node/sessions.test.ts
index 58498b3..9bee1af 100644
--- a/web/tests/node/sessions.test.ts
+++ b/web/tests/node/sessions.test.ts
@@ -10,7 +10,8 @@ import { SessionClient } from '../../src/session-client'
 import type { Binding, LegState, PaneOption, PaneView, SessionEntry } from '../../src/sessions'
 import { PaneSlot, resetLegs, SessionRegistry } from '../../src/sessions'
 import { createTransport } from '../../src/transport'
-import type { LambdaState, TmProgram, TmState } from '../../src/types'
+import type { AsmState, LambdaState, TmProgram, TmState } from '../../src/types'
+import { frameOf } from './asm-fixtures'
 
 /**
  * THE BINDING MODEL, DRIVEN WITHOUT A BROWSER — plan T7's claim at the level where it is decided.
@@ -78,14 +79,19 @@ const tmFrame = (state: number): TmState => ({
  */
 function entry(
   id: SessionId,
-  opts: { label?: string; detached?: boolean; lambda?: string[]; tm?: number[] } = {},
+  opts: { label?: string; detached?: boolean; lambda?: string[]; asm?: number[]; tm?: number[] } = {},
 ): SessionEntry {
-  const legs: { lambda?: LegState<LambdaState>; tm?: LegState<TmState> } = {}
+  const legs: { lambda?: LegState<LambdaState>; asm?: LegState<AsmState>; tm?: LegState<TmState> } = {}
   if (opts.lambda !== undefined) {
     const l = leg<LambdaState>()
     for (const [i, text] of opts.lambda.entries()) l.hist.push(lambdaFrame(text, i), 1)
     legs.lambda = l
   }
+  if (opts.asm !== undefined) {
+    const a = leg<AsmState>()
+    for (const [i, pc] of opts.asm.entries()) a.hist.push(frameOf({ step: i, pc }), 1)
+    legs.asm = a
+  }
   if (opts.tm !== undefined) {
     const t = leg<TmState>()
     for (const s of opts.tm) t.hist.push(tmFrame(s), 1)
@@ -102,6 +108,7 @@ function entry(
     legs,
     tmProgram: null,
     tmScratch: null,
+    asmProgram: null,
   }
 }
 
@@ -693,7 +700,7 @@ describe('resetLegs', () => {
     lambdaLeg.done = 'ended'
     lambdaLeg.playing = true
 
-    resetLegs(e.legs, null, null, 'not compiled')
+    resetLegs(e.legs, {}, 'not compiled')
 
     expect(lambdaLeg.hist.length).toBe(0)
     expect(tmLeg.hist.length).toBe(0)
@@ -703,6 +710,26 @@ describe('resetLegs', () => {
     expect(tmLeg.status).toEqual({ available: false, reason: 'not compiled' })
   })
 
+  /**
+   * THE THIRD LEG TOO. A recompile that left the asm leg's frames would step through a program the editor no longer
+   * holds; the loop reads `LEGS`, and this holds it to the leg the list gained last.
+   */
+  it('clears every leg, asm included, and gives each the status its reply sent', () => {
+    const e = entry('source', { lambda: ['a'], asm: [0, 1, 2], tm: [0] })
+    const asmLeg = e.legs.asm
+    if (asmLeg === undefined) throw new Error('the fixture built the asm leg')
+    asmLeg.done = 'capped'
+    asmLeg.playing = true
+
+    resetLegs(e.legs, { asm: { available: false, reason: 'lowering failed' } }, 'not compiled')
+
+    expect(asmLeg.hist.length).toBe(0)
+    expect(asmLeg.done).toBe(null)
+    expect(asmLeg.playing).toBe(false)
+    expect(asmLeg.status).toEqual({ available: false, reason: 'lowering failed' })
+    expect(e.legs.lambda?.status).toEqual({ available: false, reason: 'not compiled' })
+  })
+
   /**
    * A `LambdaScratch` has no TM leg to be "not compiled", and writing one so the record is square is
    * the shape `session.rs`'s `Session::tm` records the cost of. The caller passes one reply's worth of
@@ -722,8 +749,8 @@ describe('resetLegs', () => {
 
     const lambda = { available: true, reason: 'ok', node: null, run: 'Running' } as const
     const tm = { available: true, reason: 'ok', width: 4, run: 'Running', total_steps: null } as const
-    resetLegs(lambdaOnly.legs, lambda, tm)
-    resetLegs(tmOnly.legs, lambda, tm)
+    resetLegs(lambdaOnly.legs, { lambda, tm })
+    resetLegs(tmOnly.legs, { lambda, tm })
 
     expect(lambdaOnly.legs.tm).toBeUndefined()
     expect(lambdaLeg.status).toEqual({ available: true, reason: 'ok' })
diff --git a/web/tests/node/workspace.test.ts b/web/tests/node/workspace.test.ts
index faa6c41..2d7c3b9 100644
--- a/web/tests/node/workspace.test.ts
+++ b/web/tests/node/workspace.test.ts
@@ -244,7 +244,7 @@ describe('withPanel', () => {
 describe('defaultWorkspace', () => {
   it('is the default tree, Explorer, speed 8, focused on the λ view', () => {
     const ws = defaultWorkspace()
-    expect(leaves(ws.tree).map((l) => l.id)).toEqual(['source', 'lambda-0', 'tm-0'])
+    expect(leaves(ws.tree).map((l) => l.id)).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
     expect(ws.switches).toEqual(PRESETS.explorer)
     expect(ws.speed).toBe(8)
     expect(ws.focused).toBe('lambda-0')
````


- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 1, printing:

```text
    × puts source and λ above asm and TM, two rows of two
    × splits a nested leaf without disturbing its siblings
    × collapses recursively so no single-child spine survives
    × accepts an asm view in a stored tree
    × puts the new leaf after its subject in leaves() order
    × is the default tree, Explorer, speed 8, focused on the λ view
    × offers NO continue for stack-full, and names the cap
    × offers NO continue for heap-full, and names the cap
    × offers NO continue for memory-full, and names the cap
    × charges every word a frame carries, and a byte per written bit
    × ends a halt or a fault, and names each full cap, and calls only the step cap capped
    × reads a run that is still going as ended, since it is only asked once stepping has stopped
    … and 25 more lines
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=7
diff --git a/web/src/banner.ts b/web/src/banner.ts
index e7c7853..ae8d1bb 100644
--- a/web/src/banner.ts
+++ b/web/src/banner.ts
@@ -39,7 +39,7 @@ export function showBanner(host: HTMLElement, e: unknown): void {
 /**
  * The wording for a `worker-error` — the app started fine; one request to it threw. Unlike
  * `bannerText`, there is no "run this command" fix to name: the remedy is already underway (the
- * caller resets both legs' history and clears the decline mark before this ever renders), so this
+ * caller resets every leg's history and clears the decline mark before this ever renders), so this
  * says that plainly instead of pointing at a rebuild that would not help.
  */
 export function workerErrorText(e: unknown): string {
@@ -51,7 +51,7 @@ export function workerErrorText(e: unknown): string {
  * Report a `worker-error` INTO `#results`, not over the page. `showBanner`'s `replaceChildren` is
  * right for "the app did not start" because nothing under `<main>` works yet; it is wrong here
  * because everything under `<main>` still does. `replies.ts`'s `worker-error` arm records the failure
- * with `setProgram` instead of calling `showBanner`, after resetting both legs and clearing the decline
+ * with `setProgram` instead of calling `showBanner`, after resetting every leg and clearing the decline
  * mark, and `readout.ts`'s `createReadout` is what calls this — so this only has to render the message,
  * not decide the rest of the response.
  */
diff --git a/web/src/buffer-list.ts b/web/src/buffer-list.ts
index 281bd39..c5ada4d 100644
--- a/web/src/buffer-list.ts
+++ b/web/src/buffer-list.ts
@@ -1,5 +1,4 @@
-import { LEG_NAME } from './legs'
-import type { Leg } from './protocol'
+import { type CopyLeg, LEG_NAME } from './legs'
 import type { SessionId } from './session-client'
 
 /**
@@ -62,7 +61,7 @@ export type BufferRow = {
    */
   readonly warm: boolean
   /** The copy's leg, which its name is said with. */
-  readonly leg: Leg
+  readonly leg: CopyLeg
 }
 
 /**
diff --git a/web/src/buffers-store.ts b/web/src/buffers-store.ts
index 2ccec81..97dd446 100644
--- a/web/src/buffers-store.ts
+++ b/web/src/buffers-store.ts
@@ -1,5 +1,5 @@
+import type { CopyLeg } from './legs'
 import type { LeafId } from './panes'
-import type { Leg } from './protocol'
 import type { SessionId } from './session-client'
 
 /**
@@ -46,7 +46,7 @@ export type PersistedBuffer = {
   label: string
   text: string
   collapsed: boolean
-  leg: Leg
+  leg: CopyLeg
 }
 
 /**
diff --git a/web/src/controls.ts b/web/src/controls.ts
index 29badcb..477dc91 100644
--- a/web/src/controls.ts
+++ b/web/src/controls.ts
@@ -43,11 +43,12 @@ export type ControlState = {
 /**
  * How the recording stopped, as one line the user can act on.
  *
- * THREE STOP REASONS AND THREE SENTENCES, because they are three different facts. A spent recording
- * budget leaves the run `Running` and costs nothing to continue; a spent cursor cap needs the cap
- * raised; and a depth refusal cannot be continued at all. `session.rs`'s `run_lambda` records the first
- * distinction one layer in ("A SPENT `budget` IS NOT A SPENT CAP"), and `trace.rs`'s
- * `LambdaCursor::raise_cap` records the second.
+ * A SENTENCE PER STOP REASON, because they are different facts. A spent recording budget leaves the run
+ * `Running` and costs nothing to continue; a spent cursor cap needs the cap raised; and a depth refusal
+ * cannot be continued at all. `session.rs`'s `run_lambda` records the first distinction one layer in ("A
+ * SPENT `budget` IS NOT A SPENT CAP"), and `trace.rs`'s `LambdaCursor::raise_cap` records the second. The
+ * asm leg's three full caps are the depth refusal's kind — no continue — and each names its cap
+ * (`RecordEnd`'s doc, Plan 7 part 5 spec amendment 10).
  */
 function doneText(done: RecordEnd): string {
   switch (done) {
@@ -59,6 +60,12 @@ function doneText(done: RecordEnd): string {
       return ' — the term is deeper than the reducer allows'
     case 'budget':
       return ' — history is full'
+    case 'stack-full':
+      return ' — the call stack is full'
+    case 'heap-full':
+      return ' — the heap is full'
+    case 'memory-full':
+      return ' — its saved call frames are full'
   }
 }
 
diff --git a/web/src/draw.ts b/web/src/draw.ts
index 94486dc..89cb00b 100644
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -1,4 +1,6 @@
 import type { EditorView } from '@codemirror/view'
+import type { AsmPane } from './asm-pane'
+import { n } from './format'
 import { setFocus } from './highlight'
 import type { LambdaPane } from './lambda-pane'
 import type { LambdaTrees } from './lambda-trees'
@@ -71,7 +73,7 @@ export function createDraw(deps: {
   /** The λ trees the views draw — asked here for each connected view's displayed step (spec §4). */
   trees: LambdaTrees
   /** TM views a machine reached while they were off the page (`replies.ts`); each is seeded when next shown. */
-  unseen: WeakSet<TmPane>
+  unseen: WeakSet<TmPane | AsmPane>
   leaves: () => number
   sourceAvailable: () => boolean
   hasEditor: (session: SessionId) => boolean
@@ -215,6 +217,13 @@ export function createDraw(deps: {
             : []
         tmPane.setLink(pin, false)
       }
+      // AN ASM VIEW THAT MISSED ITS SESSION'S LISTING, by being off the page when it came, is seeded from what the
+      // session kept — `seedTm`'s arrangement above, for the one fact an asm view is told once per compile.
+      const asmPane = p.slot.binding.leg === 'asm' ? (p.pane as AsmPane) : null
+      if (asmPane !== null && unseen.has(asmPane)) {
+        asmPane.setProgram(sessions.entryOf(p.slot.binding.session).asmProgram)
+        unseen.delete(asmPane)
+      }
       const leg = p.slot.resolve(sessions)
       if (tmPane !== null) tmPane.setFocus(tmFocusLink?.states ?? [])
       p.slot.render(sessions, p.pane, leg)
@@ -370,6 +379,13 @@ export function createDraw(deps: {
             rows: () => copyRows(tmCopyParts(name, reading, tmLeg)),
           })
           break
+        case 'asm': {
+          // NO COPY HAS AN ASM LEG UNTIL PART 5c (`legs.ts`'s `CopyLeg`), so an asm view is always on the program and
+          // the branch above answers it. Were one on another session, this is what it would say: whose, and how far.
+          const parts = [name, `${n(leg.hist.newestStep)} instructions`]
+          readout.show(null, { segments: () => [parts.join(' · ')], rows: () => copyRows(parts) })
+          break
+        }
         default:
           unhandled(entry.slot.binding.leg)
       }
diff --git a/web/src/editor-custody.ts b/web/src/editor-custody.ts
index 5f0de44..3a6f1c8 100644
--- a/web/src/editor-custody.ts
+++ b/web/src/editor-custody.ts
@@ -158,8 +158,8 @@ export function createEditorCustody(deps: {
    * session. Keying by the closed leaf would be keying by something no claim ever mentions.
    *
    * **A LEAF ID IS A WEAKER KEY THAN A SESSION, NOT MERELY A DIFFERENTLY-SHAPED ONE.** `nextLeafId`
-   * only counts up, but it is not the only source of ids: `defaultLayout()` writes `source`, `lambda-0`
-   * and `tm-0` down as literals and `reset preset` re-mints all three, so a closed `lambda-0` comes
+   * only counts up, but it is not the only source of ids: `defaultLayout()` writes `source`, `lambda-0`,
+   * `asm-0` and `tm-0` down as literals and `reset preset` re-mints all four, so a closed `lambda-0` comes
    * back — and `parseLayout` can restore any id a stored tree holds. A leaf id can therefore be
    * inherited by a pane that has nothing to do with the one that claimed the editor. `applyLayout`'s
    * pane-creation loop drops exactly that inheritance for `editorOwner` (which IS keyed by leaf) where
diff --git a/web/src/layout.ts b/web/src/layout.ts
index ad5ada7..1c47f5f 100644
--- a/web/src/layout.ts
+++ b/web/src/layout.ts
@@ -107,15 +107,16 @@ export const MIN_PANE_FRACTION = 0.1
 export const SOURCE_LEAF: LeafId = 'source'
 
 /**
- * The arrangement `index.html` ships, as a tree — design §4.1.
- *
- * Two columns holding source and λ, with TM spanning beneath them — the same visual shape a two-column
- * CSS grid with a spanning `.pane.wide` row once produced, before the layout tree replaced both. Nothing
- * in `style.css` names this arrangement anymore: `main`'s one remaining rule just sets up a flex column
- * for whatever tree is mounted, and the shape here comes entirely from this tree's own nesting (an outer
- * column split holding a row split of source/λ above the TM leaf) and its `sizes`, which `layout-view.ts`
- * turns into each host's `flex-grow`. A user who never touches a divider sees no change, which is why
- * this exact shape rather than a tidier one.
+ * The arrangement a first load and `reset preset` build, as a tree — design §4.1.
+ *
+ * **SOURCE AND λ ABOVE, ASM AND TM BELOW** (Plan 7 part 5 spec §3, row 4, and amendment 12): two rows of two, the
+ * program's two lowerings side by side under the program and its λ term. It was source and λ above TM alone until the
+ * asm view existed. The shape comes entirely from this tree's nesting and its `sizes`, which `layout-view.ts` turns into
+ * each host's `flex-grow`; nothing in `style.css` names it.
+ *
+ * **λ STAYS THE FIRST VIEW LEAF**, so a first load still focuses it: `workspace.ts`'s `defaultFocus` takes the first
+ * leaf that is not the source. **A STORED LAYOUT IS NOT MIGRATED** — it is still valid, keeps its arrangement, and
+ * reaches the asm view through `+ view`, a split or a view's title (spec §3), so `LAYOUT_VERSION` does not move.
  */
 export function defaultLayout(): LayoutNode {
   return {
@@ -132,7 +133,15 @@ export function defaultLayout(): LayoutNode {
           { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
         ],
       },
-      { kind: 'leaf', id: 'tm-0', pane: 'tm' },
+      {
+        kind: 'split',
+        dir: 'row',
+        sizes: [0.5, 0.5],
+        children: [
+          { kind: 'leaf', id: 'asm-0', pane: 'asm' },
+          { kind: 'leaf', id: 'tm-0', pane: 'tm' },
+        ],
+      },
     ],
   }
 }
@@ -390,7 +399,7 @@ export function serializeLayout(root: LayoutNode): string {
  * kind would be lost on every reload with `tsc` green. The `satisfies` makes a missing kind a type error, and
  * the keys are the list (`legs.ts` has the class of bug).
  */
-const PANE_KINDS: readonly string[] = Object.keys({ source: 0, lambda: 0, tm: 0 } satisfies Record<PaneKind, 0>)
+const PANE_KINDS: readonly string[] = Object.keys({ source: 0, lambda: 0, asm: 0, tm: 0 } satisfies Record<PaneKind, 0>)
 
 /**
  * Validate one node and collect its leaf ids, returning `false` on the first violation.
diff --git a/web/src/legs.ts b/web/src/legs.ts
index 9267705..decf966 100644
--- a/web/src/legs.ts
+++ b/web/src/legs.ts
@@ -31,7 +31,15 @@ import type { Leg } from './protocol'
  * the literal type it keeps has no key for the new leg, so one missing entry would be reported once per site
  * that only reads it.
  */
-export const LEG_NAME: Readonly<Record<Leg, string>> = { lambda: 'λ', tm: 'TM' }
+export const LEG_NAME: Readonly<Record<Leg, string>> = { lambda: 'λ', asm: 'asm', tm: 'TM' }
+
+/**
+ * A leg a copy can be made on: λ and TM. **ASM IS LEFT OUT UNTIL PART 5c**, which adds asm copies and widens this
+ * (Plan 7 part 5 spec §7). Every place a copy's leg is held — a copy's record, the copies menu, the store — takes
+ * this rather than `Leg`, so the switches over a copy's leg have no asm arm to write, and 5c's widening makes `tsc`
+ * name each one it has to fill.
+ */
+export type CopyLeg = Exclude<Leg, 'asm'>
 
 /**
  * Every leg, in the order the app lists them — the title-selector's groups (`SessionRegistry.pairs`) and the
diff --git a/web/src/link-wiring.ts b/web/src/link-wiring.ts
index 7a10d4c..09c43d9 100644
--- a/web/src/link-wiring.ts
+++ b/web/src/link-wiring.ts
@@ -112,6 +112,10 @@ export function createLinkWiring(deps: {
         // `active`, THE PANE `draw()`'s TM RUNNING FOCUS READS, so the copy clause and the "the machine is
         // here" clause are about one view.
         return panes.active('tm')?.slot
+      case 'asm':
+        // `active`, AS FOR TM: the asm view `draw()`'s asm running focus reads. No asm view shows a copy until
+        // part 5c, so today its clause is always "linked".
+        return panes.active('asm')?.slot
       default:
         // `unhandled` BECAUSE THIS `switch` RETURNS A VALUE THAT MAY BE `undefined`, which is the one kind
         // TS2366 does not police: a leg with no arm would fall off the end and read as a leg with no pane.
diff --git a/web/src/link.ts b/web/src/link.ts
index 9843562..606e990 100644
--- a/web/src/link.ts
+++ b/web/src/link.ts
@@ -14,7 +14,7 @@ import type { Cut, Owner, Span } from './types'
 import { ownerNode } from './types'
 
 /**
- * `linkIndex(byteBudget)`'s wire shape: one string, one nullable cut, and ten typed arrays.
+ * `linkIndex(byteBudget)`'s wire shape: one string, one nullable cut, and eleven typed arrays.
  *
  * COLUMNAR BECAUSE THE OBJECT FORM DOES NOT FIT. `list60` is 552 KB as arrays of objects against
  * ~220 KB this way, and `prog200` is 1.9 MB against ~689 KB — and the app rebuilds this on every
@@ -33,6 +33,8 @@ export type LinkIndexWire = {
   sourceNodeEnd: Uint32Array
   sourceNodeId: Uint32Array
   tmOwner: Int32Array
+  /** Each asm instruction's owning construct, `-1` for an instruction `defunc` minted — `LinkIndex::asm_owner`. */
+  asmOwner: Int32Array
 }
 
 /**
diff --git a/web/src/lsp-protocol.ts b/web/src/lsp-protocol.ts
index 038377a..fbaf0c7 100644
--- a/web/src/lsp-protocol.ts
+++ b/web/src/lsp-protocol.ts
@@ -84,7 +84,8 @@ export const LANGUAGE_IDS = ['redextape', 'redextape_lambda', 'redextape_tm', 'r
 export type LanguageId = (typeof LANGUAGE_IDS)[number]
 
 /**
- * The app's three editor kinds, and the language each one holds. `asm` has no editor until part 5.
+ * The language each kind of view's editor holds. An asm view has no editor until part 5c's asm copies, whose editor
+ * takes `redextape_asm` from here (Plan 7 part 5 spec §5.5).
  *
  * **KEYED BY `PaneKind`, WHERE IT USED TO SPELL `'source' | 'lambda' | 'tm'` OUT.** The spelled union was a
  * second copy of `PaneKind` that nothing held to the first, so a new pane kind would have left this map
@@ -96,6 +97,7 @@ export type LanguageId = (typeof LANGUAGE_IDS)[number]
 export const LANGUAGE_OF_PANE: Readonly<Record<PaneKind, LanguageId>> = {
   source: 'redextape',
   lambda: 'redextape_lambda',
+  asm: 'redextape_asm',
   tm: 'redextape_tm',
 }
 
diff --git a/web/src/main.ts b/web/src/main.ts
index b0a7ea2..a76e8ec 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -12,6 +12,7 @@ import {
   readStored,
   STORAGE_KEY,
 } from './appearance'
+import type { AsmPane } from './asm-pane'
 import { showBanner } from './banner'
 import { bufferList } from './buffer-list'
 import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from './buffers-store'
@@ -27,7 +28,7 @@ import { History } from './history'
 import { icon } from './icons'
 import { LambdaTrees } from './lambda-trees'
 import { closeLeaf, defaultLayout, LAYOUT_STORAGE_KEY, type LayoutNode, leaves, SOURCE_LEAF } from './layout'
-import { LEG_NAME } from './legs'
+import { type CopyLeg, LEG_NAME } from './legs'
 import { createLinkWiring, type LinkWiring } from './link-wiring'
 import { LspClient } from './lsp-client'
 import { lspHover } from './lsp-hover'
@@ -41,7 +42,7 @@ import type { PaneChoice } from './pane-chrome'
 import { createPaneHost, type LayoutEvent } from './pane-host'
 import { createPanel } from './panel'
 import { type LeafId, legOfPane, PaneCollection } from './panes'
-import type { Leg, RunReply } from './protocol'
+import type { RunReply } from './protocol'
 import { HISTORY_BYTES } from './protocol'
 import { createReadout, type ProgramResult } from './readout'
 import { createReplies } from './replies'
@@ -63,7 +64,7 @@ import {
 import { type BarTarget, barTarget, createStepBar } from './step-bar'
 import type { TmPane } from './tm-pane'
 import { createTransport } from './transport'
-import type { LambdaState, TmState } from './types'
+import type { AsmState, LambdaState, TmState } from './types'
 import { assertTokenClasses } from './types'
 import { pairLabel, sourceViewHeader, viewMenu } from './view-header'
 import {
@@ -87,10 +88,10 @@ import {
 const SAMPLE = 'let x = 40; x + 2'
 
 /**
- * The counter behind every `LeafId` a split mints, shared across both legs — module-level rather than
+ * The counter behind every `LeafId` a split mints, shared across every leg — module-level rather than
  * per call to `main()`, though `main()` only ever runs once (`ready` below is computed on import).
  *
- * STARTS AT 1 ONLY FOR THE TREE A FRESH PAGE SHIPS, whose leaves are already `lambda-0` and `tm-0`.
+ * STARTS AT 1 ONLY FOR THE TREE A FRESH PAGE SHIPS, whose leaves are already `lambda-0`, `asm-0` and `tm-0`.
  * **REASONING ONLY ABOUT `defaultLayout()` COSTS THE FIRST SPLIT AFTER EVERY RELOAD**: `main()` restores a
  * tree from `localStorage` when there is one, that tree can already contain `pane-1` from a split in an
  * earlier page load, and `splitLeaf`'s collision guard then refuses the id `nextLeafId` mints — an uncaught
@@ -135,7 +136,7 @@ function seedLeafCounter(tree: LayoutNode): void {
  * `LeafId` already declares the id opaque ("a leaf's stable identity"), so the prefix was a convenience rather
  * than a fact, and a pane that can change leg is what falsifies it.
  *
- * `defaultLayout()`'s LITERAL `lambda-0` / `tm-0` ARE LEFT ALONE, for three reasons and none of them
+ * `defaultLayout()`'s LITERAL `lambda-0` / `asm-0` / `tm-0` ARE LEFT ALONE, for three reasons and none of them
  * is inertia: browser tests select on them, `reset preset`'s re-minting of exactly those ids is what
  * `applyLayout`'s claim-dropping line reasons about, and `seedLeafCounter` reads the digits after the
  * last `-` and does not care which word precedes them. `dataset.kind` is the truthful statement of
@@ -636,6 +637,12 @@ async function main(): Promise<EditorView> {
         done: null,
         playing: false,
       },
+      asm: {
+        hist: new History<AsmState>(HISTORY_BYTES),
+        status: { available: false, reason: '' },
+        done: null,
+        playing: false,
+      },
       tm: {
         hist: new History<TmState>(HISTORY_BYTES),
         status: { available: false, reason: '' },
@@ -648,11 +655,14 @@ async function main(): Promise<EditorView> {
     // it. See `SessionEntry.tmProgram` for what reads this and when.
     tmProgram: null,
     tmScratch: null,
+    asmProgram: null,
   })
   /** The λ trees the views draw (spec §4) — one cache, asked through each session's own client. */
   const trees = new LambdaTrees((id) => (sessions.has(id) ? sessions.entryOf(id).client : undefined))
-  /** TM views a machine reached while they were off the page — `replies.ts` adds, `draw()` seeds and removes. */
-  const unseenTm = new WeakSet<TmPane>()
+  /**
+   * TM and asm views a program reached while they were off the page — `replies.ts` adds, `draw()` seeds and removes.
+   */
+  const unseen = new WeakSet<TmPane | AsmPane>()
   /**
    * TRANSPORT, BEFORE EITHER PANE — its `events(...)` is what each pane is constructed with, so it has
    * to exist first. `scratchpad` is a real value (constructed above, and nothing later reassigns it);
@@ -995,7 +1005,7 @@ async function main(): Promise<EditorView> {
    * Drop what the tree no longer holds — the panel state and the display of a closed view, and a focus
    * on one.
    *
-   * **`defaultLayout()` RE-MINTS `source`, `lambda-0` AND `tm-0` AS LITERALS**, so a leaf id genuinely
+   * **`defaultLayout()` RE-MINTS `source`, `lambda-0`, `asm-0` AND `tm-0` AS LITERALS**, so a leaf id genuinely
    * comes back: close the TM view with its rules panel shut, then *reset preset*, and the new `tm-0`
    * would inherit the closed view's panel state — from memory, since the write had already dropped it.
    * The same clicks then behaved differently depending on whether the page had been reloaded in
@@ -1090,6 +1100,7 @@ async function main(): Promise<EditorView> {
     // for the same class of wiring bug.
     tmProgramOf: (session: SessionId) => sessions.entryOf(session).tmProgram,
     tmScratchOf: (session: SessionId) => sessions.entryOf(session).tmScratch,
+    asmProgramOf: (session: SessionId) => sessions.entryOf(session).asmProgram,
     // THE SECOND SESSION QUESTION `pane-host.ts` ASKS, ANSWERED HERE FOR THE SAME REASON AS THE FIRST —
     // this file is where `ScratchBuffers` is, and that module takes a function from a `SessionId` to one
     // value rather than the class itself. `editorSeed` answers `null` for everything that is not a warm
@@ -1444,7 +1455,7 @@ async function main(): Promise<EditorView> {
    * which escaped the `beforetoggle` handler exactly the way a cold buffer's did before `term` below
    * branched on `warm`.
    */
-  const copyTerm = (session: SessionId, leg: Leg): string | null => {
+  const copyTerm = (session: SessionId, leg: CopyLeg): string | null => {
     switch (leg) {
       case 'lambda':
         return sessions.legOf({ session, leg: 'lambda' }).hist.current?.text ?? null
@@ -1772,7 +1783,7 @@ async function main(): Promise<EditorView> {
     panes,
     links: linkWiring,
     trees,
-    unseen: unseenTm,
+    unseen,
     leaves: () => leaves(tree).length,
     sourceAvailable: () => !leaves(tree).some((l) => l.pane === 'source'),
     // WRAPPED RATHER THAN PASSED AS `custody.hasEditor`, the same shape `editorHome` below uses for
@@ -1847,7 +1858,7 @@ async function main(): Promise<EditorView> {
     panes,
     links: linkWiring,
     trees,
-    unseen: unseenTm,
+    unseen,
     draw,
     notify: (text: string) => notices.notify(text),
     setProgram: (r: ProgramResult) => {
@@ -2115,7 +2126,7 @@ async function main(): Promise<EditorView> {
   }
 
   // THE FIRST RECONCILE, REPLACING THE BARE `draw()` THIS USED TO BE. `applyLayout()` builds the
-  // lambda-0/tm-0 panes the default tree names, attaches every host (including `sourceHost`, built
+  // lambda-0/asm-0/tm-0 panes the default tree names, attaches every host (including `sourceHost`, built
   // above) into `<main>`, persists the tree, and calls `draw()` itself at its own end — so this is
   // still "one call, at the very end of `main()`, after everything else is wired" (`view` included:
   // `linkWiring`/`draw`/`compile`/`replies` all close over it as a thunk; `draw()`'s own body reads
diff --git a/web/src/pane-chrome.ts b/web/src/pane-chrome.ts
index 54e18c1..eebac21 100644
--- a/web/src/pane-chrome.ts
+++ b/web/src/pane-chrome.ts
@@ -72,7 +72,7 @@ export type PaneEvents = {
    * both legs reports which option was chosen, not the session half of it.
    *
    * **ONE CONTROL FOR BOTH AXES BECAUSE THE AXES ARE NOT INDEPENDENT (design §3.2).** A session holds
-   * at most one leg per `Leg` — the source session has both, a λ scratch has only λ — and
+   * at most one leg per `Leg` — the source session has all three, a λ scratch has only λ — and
    * `SessionRegistry.legOf` THROWS on a binding naming a leg its session lacks. Two independent
    * controls (a kind picker beside a session picker) would therefore have to answer "what happens when
    * you pick TM while bound to a λ-only scratch" with an invented fallback: silently rebind to some
diff --git a/web/src/pane-host.ts b/web/src/pane-host.ts
index e00d553..fbebb78 100644
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1,3 +1,4 @@
+import { AsmPane } from './asm-pane'
 import type { EditablePane, EditorCustody } from './editor-custody'
 import { LambdaPane } from './lambda-pane'
 import {
@@ -21,6 +22,7 @@ import type { SessionId } from './session-client'
 import { type Binding, PaneSlot, type TmCompiled, type TmScratchReading } from './sessions'
 import { TmPane } from './tm-pane'
 import { seedTm } from './tm-seed'
+import type { AsmProgram } from './types'
 import { DEFAULT_DISPLAY, DEFAULT_TM_DISPLAY, type LambdaDisplay, type TmDisplay } from './workspace'
 
 /**
@@ -182,6 +184,9 @@ function holdsEditor(kind: PaneKind): boolean {
       return false
     case 'lambda':
       return true
+    case 'asm':
+      // AN ASM VIEW HAS NO EDITOR UNTIL PART 5c'S ASM COPIES, which are the only thing it could edit.
+      return false
     case 'tm':
       // **`'tm'` TOO, WHERE THE CHECK USED TO BE `'lambda'` ALONE — 5d-iv T10.** A `ScratchBuffers.forkBlank`'d
       // TM buffer binds no pane at mint, so the ONLY way a TM pane ever comes to show one is the same-leg
@@ -255,6 +260,11 @@ export function createPaneHost(deps: {
    * in the same creation pass for the same reason: the replies that carried both have already been and gone.
    */
   tmScratchOf(session: SessionId): TmScratchReading | null
+  /**
+   * The asm listing `session` last compiled, or `null` — `tmProgramOf`'s twin for an asm view, asked for its reason: a
+   * view built after the `compiled` reply that told the others has to be told from what the session kept.
+   */
+  asmProgramOf(session: SessionId): AsmProgram | null
   /**
    * The text and collapse flag a λ pane newly bound to `session` should mount its editor from, or
    * `null` when `session` is not a warm scratch buffer — `mountScratchEditor` below is the one caller.
@@ -301,6 +311,7 @@ export function createPaneHost(deps: {
     draw,
     tmProgramOf,
     tmScratchOf,
+    asmProgramOf,
     scratchSeedOf,
   } = deps
 
@@ -390,6 +401,15 @@ export function createPaneHost(deps: {
     seedTm(pane, tmProgramOf(session), tmScratchOf(session))
   }
 
+  /**
+   * Tell an asm view the listing `session` holds, or that it holds none — `seedTmPane`'s twin, and for its reason: a
+   * view comes to show a session after the reply that told the others, by being built or by being moved. Only the
+   * program has an asm leg until part 5c, so today every asm view is seeded from it.
+   */
+  const seedAsmPane = (pane: AsmPane, session: SessionId): void => {
+    pane.setProgram(asmProgramOf(session))
+  }
+
   /**
    * The session a leaf with no pane yet should be bound to, consulted once by `applyLayout`'s
    * pane-creation loop and then discarded.
@@ -781,6 +801,7 @@ export function createPaneHost(deps: {
           // `seedTmPane`'s doc has the finding. BEFORE `base.rebind`, for the reason the handover above is: the
           // `draw()` inside it then renders the new session's frame against the new session's machine.
           if (entry?.kind === 'tm') seedTmPane(entry.pane as unknown as TmPane, choice.session)
+          if (entry?.kind === 'asm') seedAsmPane(entry.pane as unknown as AsmPane, choice.session)
           base.rebind(choice)
           // **AND THE ARRIVING SIDE GETS AN EDITOR IF ITS BUFFER HAS NONE — the flow design §4.5 names
           // ("warm from the header list, then bind a pane through the selector"), which until this line
@@ -852,7 +873,7 @@ export function createPaneHost(deps: {
    * `:not([disabled])` NO LONGER CHANGES THE OUTCOME ANYWHERE, AND IT STAYS — whole-branch review, M4.
    * This paragraph argued that `↺` is the first button in the host, which it was when the argument was
    * written. `viewHeader`'s `frame()` appends `heading, steps, actions`, so the TITLE button — never
-   * disabled, and present on every λ and TM view — precedes `↺` in DOM order now, and the source view's
+   * disabled, and present on every view but the source's — precedes `↺` in DOM order now, and the source view's
    * first button is its `✕`. So the exclusions below are belt-and-braces rather than load-bearing today.
    * They stay because what they guard against is a property of the step controls, not of the header's
    * running order: `↺`/`◀`/`▶`/`⏵` are disabled
@@ -885,8 +906,9 @@ export function createPaneHost(deps: {
    * around the OLD leaf — and `.focus()` on the resulting detached host is a spec-defined no-op, so the
    * workspace never catches up either.
    *
-   * Measured on the default tree: choose Stage, close the λ view, and `neighbourOf` names `source` while
-   * `defaultFocus` names `tm-0`. The stage mounted `tm-0`, `focusPane('source')` did nothing, and the
+   * Measured on the default tree as it was then: choose Stage, close the λ view, and `neighbourOf` names `source`
+   * while `defaultFocus` names `tm-0` (on today's tree, `asm-0`). The stage mounted `tm-0`, `focusPane('source')` did
+   * nothing, and the
    * focus was on `<body>` — which spec §11 forbids categorically and names this gesture for.
    *
    * **IT EXISTS SO THE ORDER CANNOT BE GOT WRONG AGAIN.** Four gestures needed it; a rule written in four
@@ -986,6 +1008,9 @@ export function createPaneHost(deps: {
           // `lambda-pane.ts`). Holding a TM editor would put it in a map nothing reads.
           ;(p.pane as TmPane).takeEditor()?.destroy()
           break
+        case 'asm':
+          // NOTHING TO HAND OVER: an asm view holds no editor (`holdsEditor`'s own arm).
+          break
         default:
           unhandled(p.slot.binding.leg)
       }
@@ -1154,6 +1179,25 @@ export function createPaneHost(deps: {
           panes.add({ id: l.id, kind: 'tm', slot, pane, host })
           break
         }
+        case 'asm': {
+          const slot = new PaneSlot('asm', session)
+          // EVERY PANEL READ BACK, each passed only when stored so it keeps its own default — the TM arm's rule.
+          const listing = panelOpen(l.id, 'listing')
+          const registers = panelOpen(l.id, 'registers')
+          const stack = panelOpen(l.id, 'stack')
+          const heap = panelOpen(l.id, 'heap')
+          const pane = new AsmPane(host, paneEvents(l.id, slot), {
+            ...(listing === undefined ? {} : { listing }),
+            ...(registers === undefined ? {} : { registers }),
+            ...(stack === undefined ? {} : { stack }),
+            ...(heap === undefined ? {} : { heap }),
+          })
+          // SEEDED FROM ITS SESSION, for the TM arm's reason just above: the `compiled` reply that told the other
+          // asm views has already been and gone for a view built by a split, a pick or `reset preset`.
+          seedAsmPane(pane, session)
+          panes.add({ id: l.id, kind: 'asm', slot, pane, host })
+          break
+        }
         default:
           unhandled(l.pane)
       }
diff --git a/web/src/panes.ts b/web/src/panes.ts
index bbde834..39842f0 100644
--- a/web/src/panes.ts
+++ b/web/src/panes.ts
@@ -13,7 +13,7 @@ export type LeafId = string
  * members and are deliberately not aliased to it — the day a pane kind exists that is not a leg, this
  * type extends and `Leg` does not.
  */
-export type PaneKind = 'source' | 'lambda' | 'tm'
+export type PaneKind = 'source' | 'lambda' | 'asm' | 'tm'
 
 /**
  * The leg a pane of `kind` renders, or `null` for the source pane, which renders an editor and no leg.
@@ -29,6 +29,8 @@ export function legOfPane(kind: PaneKind): Leg | null {
       return null
     case 'lambda':
       return 'lambda'
+    case 'asm':
+      return 'asm'
     case 'tm':
       return 'tm'
   }
diff --git a/web/src/protocol.ts b/web/src/protocol.ts
index 62984db..ad148a3 100644
--- a/web/src/protocol.ts
+++ b/web/src/protocol.ts
@@ -1,5 +1,9 @@
 import type { LinkIndexWire } from './link'
 import type {
+  AsmProgram,
+  AsmState,
+  AsmStatus,
+  AsmWindow,
   Decoded,
   Diagnostic,
   LambdaState,
@@ -40,6 +44,20 @@ export const FRAME_BYTES = 512
  */
 export const TM_RADIUS = 40
 
+/**
+ * How much of the asm machine one frame carries (Plan 7 part 5 spec §5.3): the first 64 locals and 16 arguments, the
+ * top 8 call frames, and the newest 16 heap cells and 16 boxes — plus every cell or box a register the frame shows
+ * points at, which `AsmState::window` adds so a back-reference always has its cell.
+ *
+ * **HERE, NOT IN THE CORE**, for `TM_RADIUS`'s reason: how much of the machine fits on screen is a fact about the
+ * view, and the core's view model takes it as a parameter (`viewmodel.rs`'s module doc: core never picks a number).
+ *
+ * **EVERY CORPUS PROGRAM FITS WHOLE** (spec §2.5: at most 23 locals, 3 arguments, a call depth of 7 and 11 heap
+ * cells), so the window only cuts a deep or a list-heavy run. The frame sizes these bounds produce are
+ * `asmFrameBytes`'s to charge.
+ */
+export const ASM_WINDOW: AsmWindow = { locals: 64, args: 16, frames: 8, cells: 16, boxes: 16 }
+
 /**
  * The ring's cap, PER LEG. ~3,200 λ frames at ~10 KB, or ~58,000 TM frames at ~550 B.
  *
@@ -53,10 +71,10 @@ export const TM_RADIUS = 40
  *
  * IT BOUNDS TWO DIFFERENT THINGS AT TWO DIFFERENT SITES, AND ONLY ONE OF THEM IS MEMORY.
  * `session-worker.ts`'s `allowance` bounds bytes PRODUCED — the worker posts each batch and clears
- * it, so it retains none of them. The `sessions.add` call in `main.ts` constructs the two `History` rings
- * that bound bytes RETAINED. They happen to be the same constant, which is why the plan's "one session
- * is already 64 MB" is true, but it is `main.ts`'s two rings and not the worker's `allowance` that make
- * it true. The two come apart on `[continue]`: `onExtend` (`session-worker.ts`) raises the allowance
+ * it, so it retains none of them. The `sessions.add` call in `main.ts` constructs the `History` rings,
+ * one per leg, that bound bytes RETAINED. They happen to be the same constant, which is why the plan's "one
+ * session is already 64 MB" was true of its two legs — 96 MB since the asm leg made three — but it is
+ * `main.ts`'s rings and not the worker's `allowance` that make it true. The two come apart on `[continue]`: `onExtend` (`session-worker.ts`) raises the allowance
  * to `recorded + HISTORY_BYTES` every click, so production is unbounded across clicks — while the
  * ring's budget never moves, so retention stays at one `HISTORY_BYTES` per leg however many times the
  * user continues.
@@ -257,7 +275,7 @@ export const EXTEND_CELLS = 100_000
  */
 export const VALUE_CHUNK = 500_000
 
-export type Leg = 'lambda' | 'tm'
+export type Leg = 'lambda' | 'asm' | 'tm'
 
 /**
  * Why recording stopped. FOUR OUTCOMES, NOT THREE, and conflating any two of them is the trap
@@ -267,8 +285,18 @@ export type Leg = 'lambda' | 'tm'
  *   * `capped`       — the cursor's own cap. `[continue]` raises it.
  *   * `depth-refused`— the depth guard. `raise_cap` REFUSES to clear it, so there is no continue.
  *   * `budget`       — `HISTORY_BYTES`. The run is still `Running` and continuing costs nothing.
+ *
+ * **AND THREE MORE FOR THE ASM LEG, ONE PER CAP A STEP CAP CANNOT HELP** (Plan 7 part 5 spec §8, amendment 10):
+ *
+ *   * `stack-full`   — the call stack reached its frame cap.
+ *   * `heap-full`    — the heap reached its cell cap, or the boxes did.
+ *   * `memory-full`  — the words saved across call frames reached their cap.
+ *
+ * Each is `depth-refused`'s case, not `capped`'s: raising the step cap leaves the machine exactly as full, so there
+ * is no continue. A value of its own each, rather than one `refused` with the cap beside it, so the sentences that
+ * say which cap — `controls.ts`'s `doneText`, `readout.ts`'s `STOPPED` — are switches `tsc` holds to every one.
  */
-export type RecordEnd = 'ended' | 'capped' | 'depth-refused' | 'budget'
+export type RecordEnd = 'ended' | 'capped' | 'depth-refused' | 'budget' | 'stack-full' | 'heap-full' | 'memory-full'
 
 /**
  * A λ frame's size in bytes.
@@ -294,6 +322,54 @@ export function tmFrameBytes(f: TmState): number {
   return FRAME_OVERHEAD_BYTES + cells * 2 + f.heads.length * 8 + f.window_start.length * 8
 }
 
+/**
+ * A finished asm cursor's status as a `RecordEnd`: `ended` for a halt or a fault, and a cap named.
+ *
+ * **ONLY THE STEP CAP IS `capped`.** Raising the step cap resumes a run it stopped and does nothing for one the stack,
+ * the heap or the saved frames stopped, so each of those is its own end with no continue (Plan 7 part 5 spec §8,
+ * amendment 10). A fault is `Ended`, since the run is over, and its text is the leg's value.
+ *
+ * **HERE AND NOT IN `session-worker.ts`**, where its one caller is, for `forkable`'s reason: the worker is outside the
+ * coverage gate and no test reaches it, so a decision written there is a decision nothing holds. `Running` cannot
+ * occur, since this is asked once `stepAsm` has answered `false`; it maps to `ended`, as `endOf` maps it, rather than
+ * throwing.
+ */
+export function asmRecordEnd(status: Pick<AsmStatus, 'run' | 'cap'>): RecordEnd {
+  if (status.run !== 'Capped') return 'ended'
+  switch (status.cap) {
+    case 'Stack':
+      return 'stack-full'
+    case 'Heap':
+      return 'heap-full'
+    case 'Mem':
+      return 'memory-full'
+    default:
+      return 'capped'
+  }
+}
+
+/**
+ * What one word of an asm frame is charged: an `AsmWord` object, its decimal string and its tag.
+ *
+ * **MEASURED, AS `SPAN_BYTES` IS, AND ROUNDED UP.** `frame-cost.test.ts`'s `asm frame cost` case keeps every frame of
+ * `upto(200)` — 2,814 frames, 247,091 words — and the same frames with the words dropped, and reads the difference in
+ * retained heap after a full collection: 48.23 bytes a word, the same to four places across runs. The difference
+ * charges the arrays that hold the words to the words too, which errs high. 52 leaves the margin `SPAN_BYTES`
+ * leaves over its own figure, and that case fails if a word ever costs more than this charges, which is the direction
+ * that would let the ring keep more than `HISTORY_BYTES`.
+ */
+export const ASM_WORD_BYTES = 52
+
+/**
+ * An asm frame's size in bytes. **WORDS DOMINATE** — `rr`, the windowed locals and arguments, each shown frame's
+ * saved locals, both halves of each cell and each box's content — and a written bit is charged a byte.
+ */
+export function asmFrameBytes(f: AsmState): number {
+  let words = 1 + f.locals.length + f.args.length + 2 * f.cells.length + f.boxes.length
+  for (const frame of f.frames) words += frame.saved.length
+  return FRAME_OVERHEAD_BYTES + words * ASM_WORD_BYTES + f.written.length
+}
+
 /**
  * The largest machine, in δ rules, that may be opened in an editor.
  *
@@ -433,6 +509,8 @@ export type LambdaLeg = {
   declinedSpan: Span | null
 }
 export type TmLeg = { status: TmStatus; value: Decoded | null }
+/** The asm leg's answer after recording: its status and its value — `null` for an absent leg, as TM's. */
+export type AsmLeg = { status: AsmStatus; value: Decoded | null }
 
 export type RunReply =
   /**
@@ -513,9 +591,13 @@ export type RunReply =
       kind: 'compiled'
       gen: number
       lambda: LambdaStatus
+      /** The asm leg: absent only when the program does not lower, including where TM declines it (spec §5.2). */
+      asm: AsmStatus
       tm: TmStatus
       declinedSpan: Span | null
       tmProgram: TmProgram | null
+      /** The asm listing and its labels, sent once for `tmProgram`'s reason; `null` when there is no asm leg. */
+      asmProgram: AsmProgram | null
       tapeNames: string[]
       /**
        * The link index for this compile.
@@ -532,7 +614,7 @@ export type RunReply =
        * round trip into a worker measured starved for 4,679 ms during recording, and recording starts
        * the instant this message is posted. See design §4.1.
        *
-       * The ten typed arrays inside are TRANSFERRED, not cloned; see the worker's `postMessage`.
+       * The eleven typed arrays inside are TRANSFERRED, not cloned; see the worker's `postMessage`.
        */
       linkIndex: LinkIndexWire | null
       /**
@@ -554,11 +636,9 @@ export type RunReply =
     }
   | { kind: 'lambda-frames'; gen: number; frames: LambdaState[]; done: RecordEnd | null }
   | { kind: 'tm-frames'; gen: number; frames: TmState[]; done: RecordEnd | null }
-  /**
-   * Both legs interrogated after recording finished — what `results.ts` renders. Unchanged in shape
-   * from PR 3c so that module needs no edit.
-   */
-  | { kind: 'result'; gen: number; lambda: LambdaLeg; tm: TmLeg }
+  | { kind: 'asm-frames'; gen: number; frames: AsmState[]; done: RecordEnd | null }
+  /** Every leg interrogated after recording finished — what `results.ts` renders. */
+  | { kind: 'result'; gen: number; lambda: LambdaLeg; asm: AsmLeg; tm: TmLeg }
   /** The answer to `lambda-tree`; `tree.step` is the step it answers, clamped to the run. */
   | { kind: 'lambda-tree'; gen: number; tree: LambdaTreeWire }
   /**
diff --git a/web/src/readout.ts b/web/src/readout.ts
index abe8964..4d04af4 100644
--- a/web/src/readout.ts
+++ b/web/src/readout.ts
@@ -1,6 +1,7 @@
 import { showWorkerError } from './banner'
 import { n } from './format'
-import type { LambdaLeg, RecordEnd, TmLeg } from './protocol'
+import { LEG_NAME, LEGS } from './legs'
+import type { AsmLeg, LambdaLeg, RecordEnd, TmLeg } from './protocol'
 import { noSessionRows, resultRows, valueLine } from './results'
 import type { TmScratchReading } from './sessions'
 import type { Diagnostic } from './types'
@@ -22,7 +23,7 @@ import type { ReadoutSwitch } from './workspace'
  */
 
 export type ProgramResult =
-  | { readonly kind: 'result'; readonly lambda: LambdaLeg; readonly tm: TmLeg }
+  | { readonly kind: 'result'; readonly lambda: LambdaLeg; readonly asm: AsmLeg; readonly tm: TmLeg }
   | { readonly kind: 'no-session'; readonly diagnostics: readonly Diagnostic[] }
   | { readonly kind: 'error'; readonly error: unknown }
 
@@ -31,7 +32,7 @@ export function programSegments(r: ProgramResult | null): string[] {
   if (r === null) return []
   if (r.kind === 'error') return []
   if (r.kind === 'no-session') return noSessionRows([...r.diagnostics]).map((row) => row.value)
-  const rows = resultRows(r.lambda, r.tm)
+  const rows = resultRows(r.lambda, r.asm, r.tm)
   const leg = (name: string): string => {
     const own = rows.filter((row) => row.leg === name)
     const declined = own.find((row) => row.label === 'declined')
@@ -43,7 +44,9 @@ export function programSegments(r: ProgramResult | null): string[] {
     const width = name === 'TM' && r.tm.status.width !== null ? [`width ${n(r.tm.status.width)}`] : []
     return [value === undefined ? name : `${name} ${value}`, ...rest.map((row) => row.value), ...width].join(' · ')
   }
-  return [leg('λ'), leg('TM')]
+  // ONE SEGMENT PER LEG, IN `LEGS`' ORDER — λ, asm, TM — named as `LEG_NAME` names them, which is what `results.ts`'s
+  // rows are labelled with.
+  return LEGS.map((l) => leg(LEG_NAME[l]))
 }
 
 const STOPPED: Readonly<Record<RecordEnd, string>> = {
@@ -51,6 +54,9 @@ const STOPPED: Readonly<Record<RecordEnd, string>> = {
   capped: 'spent its step budget',
   'depth-refused': 'the term is deeper than the reducer allows',
   budget: 'history is full',
+  'stack-full': 'the call stack is full',
+  'heap-full': 'the heap is full',
+  'memory-full': 'its saved call frames are full',
 }
 
 export type LambdaCopyLeg = {
@@ -142,7 +148,7 @@ export function programRows(r: ProgramResult | null): InspectorRow[] {
   if (r === null || r.kind === 'error') return []
   if (r.kind === 'no-session')
     return noSessionRows([...r.diagnostics]).map((row) => ({ label: row.label, value: row.value }))
-  return resultRows(r.lambda, r.tm).map((row) => ({
+  return resultRows(r.lambda, r.asm, r.tm).map((row) => ({
     label: `${row.leg} ${row.label}`,
     value: row.value,
     ...(row.note === undefined ? {} : { note: row.note }),
diff --git a/web/src/replies.ts b/web/src/replies.ts
index f11046e..251c9f5 100644
--- a/web/src/replies.ts
+++ b/web/src/replies.ts
@@ -1,4 +1,5 @@
 import type { EditorView } from '@codemirror/view'
+import type { AsmPane } from './asm-pane'
 import type { EditablePane } from './editor-custody'
 import { setDecline, setLink } from './highlight'
 import type { LambdaTrees } from './lambda-trees'
@@ -6,12 +7,13 @@ import { unhandled } from './legs'
 import { LinkIndex } from './link'
 import type { LinkWiring } from './link-wiring'
 import type { PaneCollection } from './panes'
-import { lambdaFrameBytes, type RunReply, ruleCount, tmFrameBytes } from './protocol'
+import { asmFrameBytes, lambdaFrameBytes, type RunReply, ruleCount, tmFrameBytes } from './protocol'
 import type { ProgramResult } from './readout'
 import type { ScratchBuffers } from './scratch'
 import type { SessionId } from './session-client'
 import { resetLegs, type SessionRegistry, type TmCompiled } from './sessions'
 import type { TmPane } from './tm-pane'
+import type { AsmProgram } from './types'
 
 /**
  * `onReply` AND `onScratchReply`, MOVED OUT OF `main.ts` WHOLE — the two reply switches, every inline
@@ -82,7 +84,7 @@ export function createReplies(deps: {
    * TM views a machine reached while they were off the page — `draw()` seeds each when it is next shown. Optional:
    * a caller that never hides a view (every direct test of this module) needs none, and gets a set nothing reads.
    */
-  unseen?: WeakSet<TmPane>
+  unseen?: WeakSet<TmPane | AsmPane>
   draw: () => void
   /**
    * The pane currently holding `session`'s editor, or `undefined` if none currently is — replaces a
@@ -132,7 +134,7 @@ export function createReplies(deps: {
     panes,
     links: linkWiring,
     trees,
-    unseen = new WeakSet<TmPane>(),
+    unseen = new WeakSet<TmPane | AsmPane>(),
     draw,
     editorHome,
     onBuffersPersist,
@@ -198,6 +200,23 @@ export function createReplies(deps: {
     storeAndSetProgram(session, compiled, (pane, rules) => pane.setForkAvailable(compiled?.tmText ?? null, rules))
   }
 
+  /**
+   * Store `session`'s asm listing on its entry and tell every asm view bound to it that is on the page, by
+   * `storeAndSetProgram`'s rule: a view off the page goes in `unseen`, and `draw()` seeds it from the entry when it is
+   * shown. One call, so the entry always agrees with what the views were told.
+   */
+  const setAsmProgram = (session: SessionId, program: AsmProgram | null): void => {
+    sessions.entryOf(session).asmProgram = program
+    for (const p of panes.ofSession('asm', session)) {
+      const pane = p.pane as AsmPane
+      if (!p.host.isConnected) {
+        unseen.add(pane)
+        continue
+      }
+      pane.setProgram(program)
+    }
+  }
+
   /**
    * One session's replies, applied to that session's legs.
    *
@@ -224,17 +243,19 @@ export function createReplies(deps: {
         setProgram({ kind: 'no-session', diagnostics: reply.diagnostics })
         // STALE FRAMES MUST NOT SURVIVE A BROKEN PROGRAM. A pane still showing the last good run
         // under source that does not compile is the worst of both answers.
-        resetLegs(legs, null, null, 'not compiled')
+        resetLegs(legs, {}, 'not compiled')
         // NOTHING TO SHOW, AND THE SESSION IS LEFT HOLDING NOTHING EITHER — see `setTmProgram` above for
         // why those are one call. The per-session argument this line used to carry lives there now.
         setTmProgram(session, null)
+        setAsmProgram(session, null)
         linkWiring.setIndex(null)
         view().dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
         // `draw()` calls `drawLink()` at its end now — see that function's doc.
         draw()
         return
       case 'compiled':
-        resetLegs(legs, reply.lambda, reply.tm)
+        resetLegs(legs, { lambda: reply.lambda, asm: reply.asm, tm: reply.tm })
+        setAsmProgram(session, reply.asmProgram)
         // THE ONE REPLY THAT CARRIES A MACHINE, RETAINED AS IT IS FANNED OUT. `tmProgram` is nullable on
         // the wire defensively rather than reachably (`protocol.ts`'s own doc), so a reply with no machine
         // in it leaves the session holding nothing rather than an envelope around a `null`.
@@ -274,9 +295,16 @@ export function createReplies(deps: {
         draw()
         return
       }
+      case 'asm-frames': {
+        const leg = sessions.legOf({ session, leg: 'asm' })
+        for (const f of reply.frames) leg.hist.push(f, asmFrameBytes(f))
+        leg.done = reply.done
+        draw()
+        return
+      }
       case 'result':
         results.dataset.state = 'idle'
-        setProgram({ kind: 'result', lambda: reply.lambda, tm: reply.tm })
+        setProgram({ kind: 'result', lambda: reply.lambda, asm: reply.asm, tm: reply.tm })
         draw()
         return
       case 'worker-error':
@@ -296,9 +324,10 @@ export function createReplies(deps: {
         // all, and the panes are still showing the PREVIOUS program's frames under a message saying the
         // app broke. Either way there is no session, which is what "not compiled" means — the same
         // reason `no-session` above passes, since a `compile()` that threw never produced one.
-        resetLegs(legs, null, null, 'not compiled')
+        resetLegs(legs, {}, 'not compiled')
         // NOTHING TO SHOW AND NOTHING RETAINED, same as the `no-session` arm above.
         setTmProgram(session, null)
+        setAsmProgram(session, null)
         linkWiring.setIndex(null)
         view().dispatch({ effects: [setDecline.of(null), setLink.of(null)] })
         setProgram({ kind: 'error', error: new Error(reply.message) })
@@ -375,7 +404,7 @@ export function createReplies(deps: {
         // before `cool` returns. `ScratchBuffers.noSessionReply` carries the full argument, including
         // why its own `warm` check is belt-and-braces rather than the guarantee its doc used to claim —
         // it is stated once, there, rather than three times across this switch.
-        resetLegs(sessions.entryOf(session).legs, reply.lambda, null)
+        resetLegs(sessions.entryOf(session).legs, { lambda: reply.lambda })
         // THE EDITOR IS SEEDED FROM THE REPLY'S OWN TEXT, NOT FROM THE FRAME THAT ARRIVES NEXT
         // (design §4.1: `text` "travels back so `main.ts` can seed the editor from the same string
         // that created the scratch, rather than from a second print that could disagree with it").
@@ -441,7 +470,7 @@ export function createReplies(deps: {
         // own doc above. This is that arm's mirror: there the λ status is real and TM is `null`; here
         // it is the reverse. `reply.tm` is a `TmScratchStatus`, not a `TmStatus` — `resetLegs`'s own
         // doc has the argument for why its `tm` parameter was widened to accept it.
-        resetLegs(sessions.entryOf(session).legs, null, reply.tm)
+        resetLegs(sessions.entryOf(session).legs, { tm: reply.tm })
         // THE MACHINE IS STORED ON THE ENTRY AND FANNED OUT TO `setProgram`, THE SAME PAIRING
         // `setTmProgram` MAKES FOR THE `compiled` ARM — so a pane bound to this session later
         // (`pane-host.ts`'s `tmProgramOf`) is seeded from the entry rather than left blank. THROUGH
@@ -627,7 +656,7 @@ export function createReplies(deps: {
         //
         // `resetLegs` first, for `onReply`'s reason — stale frames must not survive under a message
         // saying it broke. Its reason, `the copy failed`, is what this copy's own readout then reads.
-        resetLegs(sessions.entryOf(session).legs, null, null, 'the copy failed')
+        resetLegs(sessions.entryOf(session).legs, {}, 'the copy failed')
         // THE RETAINED READING GOES, AND SO DOES WHAT EVERY TM PANE ON THE BUFFER WAS TOLD OF IT — not only the pane
         // holding the editor, which `setEditor(null)` below reaches. A split pane showing the same buffer would
         // otherwise go on reading `running` over a thread that will never answer again. Whole-branch review of the
@@ -654,10 +683,12 @@ export function createReplies(deps: {
         notify(`${scratchpad.nameOf(session) ?? 'a copy'} stopped — ${reply.message}`)
         draw()
         return
-      // TWO KINDS A COPY'S WORKER NEVER SENDS, WRITTEN OUT for the reason `onReply`'s three are: only `onRun`
-      // posts them, for the program's session, and a copy has neither the `SourceMap` nor the `ty` they carry.
+      // THREE KINDS A COPY'S WORKER NEVER SENDS, WRITTEN OUT for the reason `onReply`'s three are: only `onRun`
+      // posts them, for the program's session. A copy has neither the `SourceMap` nor the `ty` `compiled` and `result`
+      // carry, and no copy has an asm leg to send `asm-frames` for until part 5c.
       case 'compiled':
       case 'result':
+      case 'asm-frames':
         return
       default:
         unhandled(reply)
diff --git a/web/src/results.ts b/web/src/results.ts
index c01e2a8..19fda36 100644
--- a/web/src/results.ts
+++ b/web/src/results.ts
@@ -1,6 +1,6 @@
 import { n } from './format'
-import type { LambdaLeg, TmLeg } from './protocol'
-import type { Diagnostic, RunStatus, ValueReading } from './types'
+import type { AsmLeg, LambdaLeg, TmLeg } from './protocol'
+import type { AsmCap, Diagnostic, RunStatus, ValueReading } from './types'
 import { decodedText } from './types'
 
 export type Row = { leg: string; label: string; value: string; note?: string }
@@ -85,8 +85,47 @@ function tmRows(t: TmLeg): Row[] {
   return rows
 }
 
-export function resultRows(lambda: LambdaLeg, tm: TmLeg): Row[] {
-  return [...lambdaRows(lambda), ...tmRows(tm)]
+/** A full cap in words: what the machine ran out of. The step cap is not here — raising it resumes the run. */
+const FULL: Readonly<Record<Exclude<AsmCap, 'Steps'>, string>> = {
+  Stack: 'the call stack is full',
+  Heap: 'the heap is full',
+  Mem: 'its saved call frames are full',
+}
+
+/**
+ * The asm leg's rows (Plan 7 part 5 spec §5.5): its steps as instructions, and its value.
+ *
+ * **`total_steps` IS `compile`'S OWN RUN**, which drove the asm cursor to its end (amendment 13), so it is a length
+ * once that run finished and the count it stopped at otherwise — `tmRows`' distinction, read the same way, off
+ * whether the value is `Unfinished`. A fault is an end: it has a length, and its value says what faulted where.
+ *
+ * **A CAP IS NAMED ONLY WHEN THE RECORDED RUN HAS REACHED IT.** `cap` is the recording cursor's, and a recording that
+ * stopped on its history budget first has none; "at a cap" is then all that is known, as for TM.
+ */
+function asmRows(a: AsmLeg): Row[] {
+  if (!a.status.available) return [{ leg: 'asm', label: 'declined', value: a.status.reason }]
+  const rows: Row[] = []
+  if (a.status.total_steps !== null) {
+    const steps = n(a.status.total_steps)
+    const finished = a.value !== null && a.value !== 'Unfinished'
+    const cap = a.status.run === 'Capped' ? a.status.cap : null
+    rows.push({
+      leg: 'asm',
+      label: 'steps',
+      value: finished
+        ? `${steps} instructions`
+        : cap === null || cap === 'Steps'
+          ? `stopped after ${steps} instructions at a cap`
+          : `stopped after ${steps} instructions — ${FULL[cap]}`,
+    })
+  }
+  if (a.value) rows.push({ leg: 'asm', label: 'value', value: decodedText(a.value) })
+  return rows
+}
+
+/** Every leg's rows, in the order the legs are listed: λ, asm, TM. */
+export function resultRows(lambda: LambdaLeg, asm: AsmLeg, tm: TmLeg): Row[] {
+  return [...lambdaRows(lambda), ...asmRows(asm), ...tmRows(tm)]
 }
 
 /**
diff --git a/web/src/scratch.ts b/web/src/scratch.ts
index 3deb1c8..f58df83 100644
--- a/web/src/scratch.ts
+++ b/web/src/scratch.ts
@@ -1,8 +1,8 @@
 import type { PersistedBuffers } from './buffers-store'
 import { History } from './history'
-import { LEG_NAME, unhandled } from './legs'
+import { type CopyLeg, LEG_NAME, unhandled } from './legs'
 import type { LeafId } from './panes'
-import type { Leg, RunReply } from './protocol'
+import type { RunReply } from './protocol'
 import type { SessionId, SessionPool } from './session-client'
 import { resetLegs, type SessionLegs, type SessionRegistry } from './sessions'
 import type { Diagnostic, LambdaState, TmState } from './types'
@@ -40,14 +40,14 @@ export type BufferInfo = {
   readonly id: SessionId
   readonly label: string
   readonly warm: boolean
-  readonly leg: Leg
+  readonly leg: CopyLeg
 }
 
 /** What undoing a delete needs to put a copy back: its id, name, leg, text and collapse flag. */
 export type BufferRecord = {
   readonly id: SessionId
   readonly label: string
-  readonly leg: Leg
+  readonly leg: CopyLeg
   readonly text: string
   readonly collapsed: boolean
 }
@@ -82,7 +82,7 @@ type BufferState = {
    * binding must agree with — `SessionRegistry.legOf` throws on a binding naming a leg its session
    * lacks, and this is the field that decides which leg the session was built with.
    */
-  readonly leg: Leg
+  readonly leg: CopyLeg
   text: string
   collapsed: boolean
   warm: boolean
@@ -117,11 +117,11 @@ type BufferState = {
  * `protocol.ts`'s own measured λ retention ratio to within ~0.1%).
  *
  * **TWO READINGS, ONE INTERCEPT COMPONENT APART — THE PROJECT OWNER PICKED THE LITERAL ONE.** The
- * threshold's own words are "every warm BUFFER"; the source session's two rings are not a buffer's, so
+ * threshold's own words are "every warm BUFFER"; the source session's rings are not a buffer's, so
  * whether they count is a reading of the sentence, not a fact the probe can settle on its own:
  *
  *   * **(a) buffers-only-at-exhaustion — GOVERNS, and SHIPS.** The literal reading: the source
- *     session's fixed thread cost counts (module + arena, 11,993,088 bytes) but its two rings do not,
+ *     session's fixed thread cost counts (module + arena, 11,993,088 bytes) but its rings do not,
  *     because they are not simultaneously exhausted the instant every buffer's is — the source session
  *     is ordinarily mid-recording or idle, not pinned at its own ring cap at the same moment N buffers
  *     are all pinned at theirs. Intercept = page/app baseline (17,825,792 bytes, a FLOOR — see below) +
@@ -517,7 +517,7 @@ export class ScratchBuffers {
    *
    * For what this doc used to claim and why it changed, see the history note under `fork`.
    */
-  fork(slot: Detachable, src: string, step: number, leg: Leg): SessionId {
+  fork(slot: Detachable, src: string, step: number, leg: CopyLeg): SessionId {
     // `'cannot make a copy — '` — THIS CALL IS THE ONE OF THE TWO CALLERS FOR WHICH THAT IS TRUE. See
     // `#refuseAtCap`'s own doc for why the prefix is a call-site argument rather than baked into the
     // shared message.
@@ -536,7 +536,7 @@ export class ScratchBuffers {
    * NO PREFIX ON THE REFUSAL — this is not a fork, so `#refuseAtCap`'s call-site prefix argument puts
    * it in the same class as `warm`.
    */
-  forkBlank(leg: Leg): SessionId {
+  forkBlank(leg: CopyLeg): SessionId {
     if (this.warmCount() >= MAX_WARM_BUFFERS) this.#refuseAtCap('')
     return this.#mint('', 0, leg, null)
   }
@@ -548,7 +548,7 @@ export class ScratchBuffers {
    * from a `Detachable` it must then rebind, `forkBlank` from nothing at all. `slot?.rebind(id)` below
    * is the whole of that fork — a `null` here is `forkBlank`'s own claim that no pane is owed a move.
    */
-  #mint(src: string, step: number, leg: Leg, slot: Detachable | null): SessionId {
+  #mint(src: string, step: number, leg: CopyLeg, slot: Detachable | null): SessionId {
     this.#minted += 1
     const id: SessionId = `scratch-${this.#minted}`
     // `copy N` — THE LEG IS SAID WHEREVER THE LABEL IS SHOWN (`nameOf`, `view-header.ts`'s `pairLabel`),
@@ -660,7 +660,7 @@ export class ScratchBuffers {
     // 'not compiled' IS THE REASON THE PANE READS FOR THE INSTANT BETWEEN THIS AND THE REBOUND
     // SESSION'S NEXT FRAME — the same wording `main.ts` gives a source session with no program, and
     // true here for the same reason: there is nothing behind this leg any more.
-    resetLegs(this.#reg.entryOf(id).legs, null, null, 'not compiled')
+    resetLegs(this.#reg.entryOf(id).legs, {}, 'not compiled')
     this.#reg.remove(id)
     this.#pool.unbind(id)
     state.warm = false
@@ -848,6 +848,8 @@ export class ScratchBuffers {
       // that is permanent.
       tmProgram: null,
       tmScratch: null,
+      // NO COPY HAS AN ASM LEG UNTIL PART 5c (`legs.ts`'s `CopyLeg`), so nothing will ever write here either.
+      asmProgram: null,
     })
     state.warm = true
     // SUPERSEDE THEN POST, the pattern `compile.ts`'s `schedule` uses and for the same reason
@@ -877,7 +879,7 @@ export class ScratchBuffers {
    * changed is WHICH leg gets it. A session holds at most one leg per `Leg`, and this is where that is
    * decided for a buffer.
    */
-  #pendingLegs(leg: Leg): SessionLegs {
+  #pendingLegs(leg: CopyLeg): SessionLegs {
     const status = { available: false, reason: 'building…' }
     switch (leg) {
       case 'lambda':
diff --git a/web/src/session-worker.ts b/web/src/session-worker.ts
index b4c0767..c06440a 100644
--- a/web/src/session-worker.ts
+++ b/web/src/session-worker.ts
@@ -40,8 +40,11 @@
 import init, { compile, lambdaScratchAt, tapeNames, tmScratch } from '../../pkg/redextape_wasm.js'
 import { LEGS, perLeg, unhandled } from './legs'
 import type { LinkIndexWire } from './link'
-import type { LambdaLeg, LambdaTreeWire, Leg, RecordEnd, RunReply, RunRequest, TmLeg } from './protocol'
+import type { AsmLeg, LambdaLeg, LambdaTreeWire, Leg, RecordEnd, RunReply, RunRequest, TmLeg } from './protocol'
 import {
+  ASM_WINDOW,
+  asmFrameBytes,
+  asmRecordEnd,
   EXTEND_CELLS,
   EXTEND_STEPS,
   FRAME_BYTES,
@@ -55,6 +58,10 @@ import {
   VALUE_CHUNK,
 } from './protocol'
 import type {
+  AsmProgram,
+  AsmState,
+  AsmStatus,
+  AsmWindow,
   Decoded,
   Diagnostic,
   LambdaState,
@@ -85,6 +92,12 @@ type Session = {
   stepTm(): boolean
   raiseTmCap(extraSteps: number, extraCells: number): void
   tmValue(): Decoded
+  asmStatus(): AsmStatus
+  asmProgram(): AsmProgram
+  asmState(window: AsmWindow): AsmState
+  stepAsm(): boolean
+  raiseAsmCap(extraSteps: number): void
+  asmValue(): Decoded
   sourceSpan(node: number): Span | null
   linkIndex(byteBudget: number): LinkIndexWire
   /**
@@ -489,6 +502,60 @@ async function recordTm(gen: number, emitInitial: boolean): Promise<boolean> {
   }
 }
 
+/**
+ * See `recordLambda`'s doc comment — same contract, mirrored for the asm leg.
+ *
+ * **ONLY A `Session` HAS AN ASM LEG.** Neither copy kind carries one until part 5c, so the guard names the one kind
+ * that does rather than excluding the two that do not — which also keeps the loop's own check a comparison `tsc`
+ * accepts after the `await` below, the trap `recordTm`'s loop guard records.
+ *
+ * **LIKE TM'S, A REPLAY OF A RUN WHOSE ANSWER IS KNOWN.** `compile` drove a cursor over the program to its end
+ * (spec amendment 13), so exhausting this leg's allowance costs history, not the value.
+ */
+async function recordAsm(gen: number, emitInitial: boolean): Promise<boolean> {
+  if (live?.gen !== gen || live.kind !== 'session') return false
+  if (!live.session.asmStatus().available) return false
+  if (recording.asm) return false
+  recording.asm = true
+  try {
+    let batch: AsmState[] = []
+    if (emitInitial) {
+      const first = live.session.asmState(ASM_WINDOW)
+      batch.push(first)
+      recorded.asm += asmFrameBytes(first)
+    }
+
+    for (;;) {
+      // Deliberate silence: superseded mid-loop. The caller who wanted these frames is gone.
+      if (live?.gen !== gen || live.kind !== 'session') return true
+      const s = live.session
+      let done: RecordEnd | null = null
+      let n = 0
+      while (n < RECORD_CHUNK) {
+        if (recorded.asm >= allowance.asm) {
+          done = 'budget'
+          break
+        }
+        if (!s.stepAsm()) {
+          done = asmRecordEnd(s.asmStatus())
+          break
+        }
+        const f = s.asmState(ASM_WINDOW)
+        batch.push(f)
+        recorded.asm += asmFrameBytes(f)
+        n += 1
+      }
+      ctx.postMessage({ kind: 'asm-frames', gen, frames: batch, done })
+      batch = []
+      if (done !== null) return true
+      await yieldToEventLoop()
+    }
+  } finally {
+    // Same ownership check as `recordLambda`'s — see that comment.
+    if (live?.gen === gen) recording.asm = false
+  }
+}
+
 /**
  * A declined λ leg's refusal, named as a source range — `null` for an available leg or one whose
  * refusal names no node. `sourceSpan` IS RESOLVED HERE because the handle cannot leave this thread; a
@@ -522,6 +589,12 @@ function tmLeg(session: Session): TmLeg {
   return { status, value: session.tmValue() }
 }
 
+function asmLeg(session: Session): AsmLeg {
+  const status = session.asmStatus()
+  if (!status.available) return { status, value: null }
+  return { status, value: session.asmValue() }
+}
+
 async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
   await ready
   // FREED BEFORE THE NEXT COMPILE, not after. Two `Session` handles are never simultaneously live.
@@ -555,8 +628,11 @@ async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
   live = { gen: req.gen, kind: 'session', session }
 
   const lambda = session.lambdaStatus()
+  const asm = session.asmStatus()
   const tm = session.tmStatus()
   const index = session.linkIndex(LAMBDA_BYTE_BUDGET)
+  // GUARDED FOR `tmProgram`'s REASON BELOW: `asmProgram` throws `AsmAbsent` for a program that does not lower.
+  const asmProgram = asm.available ? session.asmProgram() : null
   // GUARDED: `tmProgram` throws `TmAbsent` for a declined leg, and a thrown error inside this
   // async handler rejects it with nothing catching — no reply, and a caller that waits forever.
   // That is exactly the shape of the defect PR 3c's browser tier caught in `drive`.
@@ -569,9 +645,11 @@ async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
       kind: 'compiled',
       gen: req.gen,
       lambda,
+      asm,
       tm,
       declinedSpan: declinedSourceSpan(session, lambda),
       tmProgram,
+      asmProgram,
       tapeNames: tapeNames() as string[],
       linkIndex: index,
       tmText,
@@ -591,16 +669,26 @@ async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
       index.sourceNodeEnd.buffer,
       index.sourceNodeId.buffer,
       index.tmOwner.buffer,
+      index.asmOwner.buffer,
     ],
   )
 
+  // λ, THEN ASM, THEN TM (spec §5.4). asm is the cheapest leg per step, and TM's recording can run to its whole
+  // `HISTORY_BYTES` before a leg after it starts; the λ leg stays first, since its recording is what decides its value.
   await recordLambda(req.gen, true)
+  await recordAsm(req.gen, true)
   await recordTm(req.gen, true)
 
   // Deliberate silence: superseded while recording ran. The generation that wanted this result is gone.
   // The `kind` half is the type restating the `gen` half — see `recordTm`'s loop for the argument.
   if (live?.gen !== req.gen || live.kind !== 'session') return
-  ctx.postMessage({ kind: 'result', gen: req.gen, lambda: lambdaLeg(live.session), tm: tmLeg(live.session) })
+  ctx.postMessage({
+    kind: 'result',
+    gen: req.gen,
+    lambda: lambdaLeg(live.session),
+    asm: asmLeg(live.session),
+    tm: tmLeg(live.session),
+  })
 }
 
 /**
@@ -807,6 +895,18 @@ async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<v
       ran = await recordTm(req.gen, false)
       break
     }
+    case 'asm': {
+      // ONLY A `Session` HAS AN ASM LEG (`recordAsm`'s doc), so a copy has no cap to raise and nothing to record.
+      if (live.kind !== 'session') return
+      const s = live.session
+      // THE STEP CAP ONLY. A run the stack, heap or saved frames stopped cannot be continued, and `controls.ts` offers
+      // no continue for one (`asmRecordEnd`'s ends), so this arm is never reached for it — and `raise_asm_cap` would not
+      // resume it if it were.
+      const status = s.asmStatus()
+      if (status.run === 'Capped' && status.cap === 'Steps') s.raiseAsmCap(EXTEND_STEPS)
+      ran = await recordAsm(req.gen, false)
+      break
+    }
     default:
       // A LEG WITH NO ARM RECORDS NOTHING AND POSTS NOTHING, as a stale generation does above. `unhandled`
       // makes such a leg a type error, and the `return` is what keeps `ran` assigned on every path below.
@@ -828,7 +928,13 @@ async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<v
   // `RecordEnd`, are its whole answer; a headered TM buffer's value arrives separately, as the
   // `tm-value` replies `runValueLoop` posts, which `[continue]` neither starts nor extends.
   if (live.kind !== 'session') return
-  ctx.postMessage({ kind: 'result', gen: req.gen, lambda: lambdaLeg(live.session), tm: tmLeg(live.session) })
+  ctx.postMessage({
+    kind: 'result',
+    gen: req.gen,
+    lambda: lambdaLeg(live.session),
+    asm: asmLeg(live.session),
+    tm: tmLeg(live.session),
+  })
 }
 
 /**
diff --git a/web/src/sessions.ts b/web/src/sessions.ts
index b4527c5..267b18f 100644
--- a/web/src/sessions.ts
+++ b/web/src/sessions.ts
@@ -9,7 +9,7 @@ import { LEGS } from './legs'
 import type { SplitChoices } from './pane-chrome'
 import type { Leg, RecordEnd } from './protocol'
 import type { SessionClient, SessionId } from './session-client'
-import type { LambdaState, LambdaStatus, TmProgram, TmScratchStatus, TmState, TmStatus, ValueReading } from './types'
+import type { AsmProgram, AsmState, LambdaState, TmProgram, TmScratchStatus, TmState, ValueReading } from './types'
 
 /**
  * One leg's live state on this side of the boundary: its history, how recording ended, and what the
@@ -40,7 +40,7 @@ export type LegState<T> = {
  * `LegState<TmState>` with no narrowing at either call site — the property `Binding`'s own doc below
  * is about. Two named resolvers would be the duplication design §3.1 refused one layer down.
  */
-export type LegFrame = { lambda: LambdaState; tm: TmState }
+export type LegFrame = { lambda: LambdaState; asm: AsmState; tm: TmState }
 
 /**
  * The legs one session owns — AT MOST ONE PER `Leg`, AND THAT OPTIONALITY IS THIS TASK'S DOING.
@@ -169,7 +169,7 @@ export type SessionEntry = {
    * `label`, `detached` and `client` are decided by whoever registers the session; `legs` is a record
    * whose CONTENTS move (that is what `resetLegs` is) under a reference that does not. This is neither:
    * it is a fact the worker sends back later, replaced whole each time it does. Retaining it here rather
-   * than beside the TM `LegState` is deliberate — `LegState<T>` is the frame-generic both legs share, and
+   * than beside the TM `LegState` is deliberate — `LegState<T>` is the frame-generic every leg shares, and
    * a machine is not a frame; it is set once per compile and does not change as the head moves, which is
    * the whole point of the `TmProgram`/`TmState` split one layer in.
    *
@@ -185,6 +185,12 @@ export type SessionEntry = {
    * the reply that told the others is seeded from here. `null` for every session that is not a TM buffer.
    */
   tmScratch: TmScratchReading | null
+  /**
+   * The asm listing a session's last `compiled` reply carried, retained for `tmProgram`'s reason: an asm view created
+   * after that reply is seeded from here (`pane-host.ts`'s `seedAsmPane`). `null` for a session with no asm leg — a
+   * program that does not lower, and every copy, since no copy has an asm leg until part 5c.
+   */
+  asmProgram: AsmProgram | null
 }
 
 /**
@@ -228,34 +234,31 @@ export type PaneOption = { readonly leg: Leg; readonly id: SessionId; readonly l
  * it is what a caller with one reply shape and three session shapes will naturally do — so this is
  * silent rather than a throw.
  *
- * **`tm` WIDENED TO `Pick<TmStatus, 'available' | 'reason'>`, WHERE IT USED TO READ `TmStatus | null` —
- * 5d-iv Task 9.** The body below reads only those two fields; the full `TmStatus` shape was never
- * needed, and `replies.ts`'s new `tm-scratch-compiled` arm has a `TmScratchStatus` to pass here rather
- * than a `TmStatus` — a different wire shape (`width`/`run` non-nullable, no `total_steps`,
- * `TmScratchStatus`'s own doc in `types.ts`) that shares exactly the two fields this function reads and
- * none of the ones it does not. Naming the narrower shape is what lets both callers pass their own
- * status without one of them fabricating fields the other's type demands and this function never asked
- * for.
+ * **ONE STATUS PER LEG, BY LEG, AND EACH ONLY ITS TWO FIELDS.** The body reads `available` and `reason` and nothing
+ * else, so each caller passes whatever status its reply carries — a `LambdaStatus`, an `AsmStatus`, a `TmStatus`, or a
+ * TM copy's `TmScratchStatus`, which shares those two fields with `TmStatus` and none of the others — without
+ * fabricating fields this function never asks for. It took the λ and TM statuses as two parameters until the asm leg
+ * made a third; keyed by `Leg`, a leg the caller has no status for is simply left out.
  */
 export function resetLegs(
   legs: SessionLegs,
-  lambda: LambdaStatus | null,
-  tm: Pick<TmStatus, 'available' | 'reason'> | null,
+  statuses: { readonly [L in Leg]?: LegAvailability | null },
   reason = '',
 ): void {
-  const lambdaLeg = legs.lambda
-  const tmLeg = legs.tm
-  for (const leg of [lambdaLeg, tmLeg]) {
+  for (const l of LEGS) {
+    const leg = legs[l]
     if (leg === undefined) continue
     leg.hist.clear()
     leg.done = null
     leg.playing = false
+    const status = statuses[l]
+    leg.status = { available: status?.available ?? false, reason: status?.reason ?? reason }
   }
-  if (lambdaLeg !== undefined)
-    lambdaLeg.status = { available: lambda?.available ?? false, reason: lambda?.reason ?? reason }
-  if (tmLeg !== undefined) tmLeg.status = { available: tm?.available ?? false, reason: tm?.reason ?? reason }
 }
 
+/** Whether a leg is there and, when it is not, why — all of a leg's status that `resetLegs` reads. */
+export type LegAvailability = { readonly available: boolean; readonly reason: string }
+
 /**
  * THE SESSION REGISTRY — the container design §3.2b says decision 1 presupposes and `main.ts` did not
  * have.
@@ -534,8 +537,8 @@ export type PaneView<T> = {
  * slot it owns, so it cannot go through `render` — and a second copy of this argument list is the
  * two-places-to-be-wrong failure `LegState`'s own doc refuses one type up.
  *
- * **THE `awaitingRun` READ IS PER SESSION AND NOT PER LEG** — the generation is the client's, and both legs
- * of one session share it. That is exactly the subtlety a hand-copied second version would lose, and it is
+ * **THE `awaitingRun` READ IS PER SESSION AND NOT PER LEG** — the generation is the client's, and every leg
+ * of one session shares it. That is exactly the subtlety a hand-copied second version would lose, and it is
  * why this moved rather than being written twice.
  */
 export function legControlState<K extends Leg>(
diff --git a/web/src/types.ts b/web/src/types.ts
index 62cc38e..4cd303b 100644
--- a/web/src/types.ts
+++ b/web/src/types.ts
@@ -33,9 +33,11 @@ import type { ValueRun } from '../bindings/ValueRun'
 
 export type { AsmBox } from '../bindings/AsmBox'
 export type { AsmCallFrame } from '../bindings/AsmCallFrame'
+export type { AsmCap } from '../bindings/AsmCap'
 export type { AsmCell } from '../bindings/AsmCell'
 export type { AsmProgram } from '../bindings/AsmProgram'
 export type { AsmState } from '../bindings/AsmState'
+export type { AsmStatus } from '../bindings/AsmStatus'
 export type { AsmWindow } from '../bindings/AsmWindow'
 export type { AsmWord } from '../bindings/AsmWord'
 export type { Cut } from '../bindings/Cut'
````


- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec tsc --noEmit`

Expected: exit 0

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
    Test Files  52 passed (52)
    Tests  708 passed (708)
```

Run: `cd web && pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
    Test Files  107 passed (107)
    Tests  690 passed (690)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, from `web/`, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 18 of 18 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| S1 | a full stack reads as a step cap — `protocol.ts`: `case 'Stack': ⏎       return 'stack-full'` → `case 'Stack': ⏎       return 'capped'` | `pnpm exec vitest run tests/node/protocol.test.ts` | `tests/node/protocol.test.ts > asmRecordEnd > ends a halt or a fault, and names each full cap, and calls only the step cap capped` |
| S2 | saved words go uncharged — `protocol.ts`: `for (const frame of f.frames) words += frame.saved.length` → `(deleted)` | `pnpm exec vitest run tests/node/protocol.test.ts` | `tests/node/protocol.test.ts > asmFrameBytes > charges every word a frame carries, and a byte per written bit` |
| S3 | a word charged less than it costs — `protocol.ts`: `export const ASM_WORD_BYTES = 52` → `export const ASM_WORD_BYTES = 40` | `pnpm exec vitest run tests/browser/frame-cost.test.ts` | `tests/browser/frame-cost.test.ts > asm frame cost > measures bytes per asm word by heap differential, and the ring charges at least that` |
| S4 | a full stack said as a spent budget — `controls.ts`: `return ' — the call stack is full'` → `return ' — spent its step budget'` | `pnpm exec vitest run tests/node/controls.test.ts` | `tests/node/controls.test.ts > controlState > offers NO continue for stack-full, and names the cap` |
| S5 | a finished asm run read as unfinished — `results.ts`: `const finished = a.value !== null && a.value !== 'Unfinished'` → `const finished = a.value === 'Unfinished'` | `pnpm exec vitest run tests/node/results.test.ts` | `tests/node/results.test.ts > resultRows — the asm leg > counts a faulted run as an end, and its value says what faulted where`, `tests/node/results.test.ts > resultRows — the asm leg > counts a finished run in instructions and shows its value`, `tests/node/results.test.ts > resultRows — the asm leg > says a run compile could not finish stopped at a cap, and names a full one once recording reached it` |
| S6 | a full cap never named — `results.ts`: `: cap === null || cap === 'Steps'` → `: true` | `pnpm exec vitest run tests/node/results.test.ts` | `tests/node/results.test.ts > resultRows — the asm leg > says a run compile could not finish stopped at a cap, and names a full one once recording reached it` |
| S7 | asm listed after TM — `legs.ts`: `= { lambda: 'λ', asm: 'asm', tm: 'TM' }` → `= { lambda: 'λ', tm: 'TM', asm: 'asm' }` | `pnpm exec vitest run tests/node/readout.test.ts` | `tests/node/readout.test.ts > programSegments > reads value and counts per leg, in the new vocabulary, with no normal-form text` |
| S8 | asm and TM swapped in the default tree — `layout.ts`: `{ kind: 'leaf', id: 'asm-0', pane: 'asm' }, ⏎           { kind: 'leaf', id: 'tm-0', pane: 'tm' },` → `{ kind: 'leaf', id: 'tm-0', pane: 'tm' }, ⏎           { kind: 'leaf', id: 'asm-0', pane: 'asm' },` | `pnpm exec vitest run tests/node/layout.test.ts` | `tests/node/layout.test.ts > closeLeaf > collapses recursively so no single-child spine survives`, `tests/node/layout.test.ts > defaultLayout > puts source and λ above asm and TM, two rows of two`, `tests/node/layout.test.ts > insertBeside > puts the new leaf after its subject in leaves() order`, `tests/node/layout.test.ts > splitLeaf > splits a nested leaf without disturbing its siblings` |
| S9 | a stored asm leaf fails validation — `layout.ts`: `{ source: 0, lambda: 0, asm: 0, tm: 0 } satisfies Record<PaneKind, 0>` → `{ source: 0, lambda: 0, tm: 0 } as Record<PaneKind, 0>` | `pnpm exec vitest run tests/node/layout.test.ts` | `tests/node/layout.test.ts > parseLayout > accepts an asm view in a stored tree`, `tests/node/layout.test.ts > parseLayout > round-trips a tree it serialized`, `tests/node/layout.test.ts > parseTree > validates a bare tree the way parseLayout validates an envelope` |
| S10 | the asm editor would get TM's language — `lsp-protocol.ts`: `asm: 'redextape_asm',` → `asm: 'redextape_tm',` | `pnpm exec vitest run tests/node/lsp-protocol.test.ts` | `tests/node/lsp-protocol.test.ts > the language ids the client sends > cover every pane kind that has an editor, and every id has an extension` |
| S11 | a compile does not tell the asm views — `replies.ts`: `setAsmProgram(session, reply.asmProgram)` → `void reply.asmProgram` | `pnpm exec vitest run tests/browser/asm-app.test.ts` | `tests/browser/asm-app.test.ts > an asm view made after the compile > is told the listing it missed while off the page, when the stage shows it`, `tests/browser/asm-app.test.ts > an asm view made after the compile > is told the listing the session kept, when a view is picked onto asm from its title`, `tests/browser/asm-app.test.ts > the asm leg in the app > is a view of its own in the default tree, showing the program’s listing`, `tests/browser/asm-app.test.ts > the asm leg in the app > steps from the start, the listing marking what runs next and the registers what changed` |
| S12 | a view made later is not seeded — `pane-host.ts`: `seedAsmPane(pane, session)` → `void seedAsmPane` | `pnpm exec vitest run tests/browser/asm-app.test.ts` | `tests/browser/asm-app.test.ts > an asm view made after the compile > is told the listing the session kept, when a view is picked onto asm from its title` |
| S13 | a view off the page is not seeded when shown — `draw.ts`: `asmPane.setProgram(sessions.entryOf(p.slot.binding.session).asmProgram)` → `(deleted)` | `pnpm exec vitest run tests/browser/asm-app.test.ts` | `tests/browser/asm-app.test.ts > an asm view made after the compile > is told the listing it missed while off the page, when the stage shows it` |
| S14 | a recompile leaves the asm leg's frames — `sessions.ts`: `for (const l of LEGS) { ⏎     const leg = legs[l]` → `for (const l of LEGS.filter((x) => x !== 'asm')) { ⏎     const leg = legs[l]` | `pnpm exec vitest run tests/node/sessions.test.ts` | `tests/node/sessions.test.ts > resetLegs > clears every leg, asm included, and gives each the status its reply sent` |
| S15 | a copy may be made on asm — `legs.ts`: `export type CopyLeg = Exclude<Leg, 'asm'>` → `export type CopyLeg = Leg` | `pnpm exec tsc --noEmit` | `main.ts(1458,56): TS2366: Function lacks ending return statement and return type does not include `; `scratch.ts(871,19): TS2345: Argument of type '"asm"' is not assignable to parameter of type 'never'.`; `scratch.ts(882,31): TS2366: Function lacks ending return statement and return type does not include ` |
| S16 | the gate walks a list of views — `controls-gate.test.ts`: `if (tiled) { ⏎     return [...document.querySelectorAll<HTMLElement>('.pane[data-leaf]')] ⏎       .map((host) => host.dataset.leaf ?? '') ⏎       .filter((le…` → `if (tiled) return ['lambda-0', 'tm-0']` | `pnpm exec vitest run tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with every view's title and ⋯ menu open`, `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with every view's title and ⋯ menu open` |
| S17 | a type both crates emit refuses — `build-web-bindings.sh`: `if cmp -s "$path" "$WASM_DIR/$name"; then` → `if false; then` | `pnpm run build:bindings` | `pnpm run build:bindings` exits 1 |
| S18 | the worker does not record asm — `session-worker.ts`: `await recordAsm(req.gen, true)` → `(deleted)` | `pnpm exec vitest run tests/browser/asm-app.test.ts` | `tests/browser/asm-app.test.ts > the asm leg in the app > records every instruction, and the readout counts them in its own segment`, `tests/browser/asm-app.test.ts > the asm leg in the app > runs a program the TM refuses to build, and says why the TM declined`, `tests/browser/asm-app.test.ts > the asm leg in the app > steps from the start, the listing marking what runs next and the registers what changed` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
asm is the web app's third leg: the worker records it, the session keeps its listing, the readout counts its instructions, and the default tree shows it beside TM

`Leg` gains `asm`, and every switch over a leg now says what the asm leg
does. The worker records it between λ and TM and ends a run the stack,
heap or memory cap stopped with no continue, naming the cap; the session
keeps the listing so a view made or shown later is told it; the readout
gains an `asm N · M instructions` segment; and the default tree is
(source | λ) above (asm | TM). A copy's leg is `CopyLeg`, λ or TM, until
part 5c.

`ASM_WORD_BYTES` is measured: 48.23 bytes a word, charged 52, and
`frame-cost.test.ts` fails if a word ever costs more. The controls gate
reads the views off the page, where it walked a hand-written list of
two.
````


---

### Task 8: The asm view links: an instruction pins the construct it came from, a pin marks the instructions billed to it, and one defunc minted says it has none

**Files:**
- Modify: `web/src/link.ts`, `web/src/link-status.ts`, `web/src/link-wiring.ts`, `web/src/transport.ts`, `web/src/draw.ts`, `web/src/main.ts`
- Create (tests): `web/tests/browser/asm-link.test.ts`
- Modify (tests): `web/tests/node/link.test.ts`, `web/tests/node/link-status.test.ts`, `web/tests/browser/app.test.ts`

**Interfaces:**
- `LinkIndex.nodeForInstr(pc): number | null`; `Link` gains `instrs: number[]`, derived from `asmOwner` by the one `#ownedBy` that also derives `states`.
- `LinkStatus` gains the arm `{ state: 'ownerless' }` and, on `linked`, `instrs: boolean` and `asmFocus: boolean`; `LinkWiring.drawLink(l, focusCoincident, asmCoincident, lambda)`.
- `transport.ts` gives an asm view's events `linkInstr`.

**THE TM VIEW'S MECHANISM, ONE LEG OVER (spec §6.6).** A click or Enter on an instruction row resolves its owner through the link index and pins it in every view; a pin made anywhere marks the rows billed to it in every asm view — hidden ones included, as the TM fan-out does — and scrolls to the first unless the click came from an asm listing; a keystroke in the source clears them; and a view seeded off the page takes the pin with its listing, resolved against the frame's index.

**AN INSTRUCTION WITH NO OWNER SAYS SO (amendments 11, 19).** `setLinkTo` with no node from an asm origin sets a flag the next gesture, keystroke or compile clears, and the status line says "this instruction has no source construct"; a TM state with no owner still clears the pin silently.

**THE RUNNING FOCUS AND THE LINE.** `draw()` resolves the asm leg's running focus from `AsmState.source_node` on the asm view the user last focused, marks that view's rows `.is-focus` before it renders, and hands the status line its coincidence with the pin: "the asm run is here right now". The source editor's focus mark stays λ's. A construct neither lowering bills anything to is one clause, "this construct emits no instructions or machine states" — the machine is built from the instructions, so a construct with none has no states either (what the prototype found, 15).

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=8
diff --git a/web/tests/browser/app.test.ts b/web/tests/browser/app.test.ts
index 3cf35d6..3e92aa2 100644
--- a/web/tests/browser/app.test.ts
+++ b/web/tests/browser/app.test.ts
@@ -299,7 +299,9 @@ describe('the app, end to end', () => {
     await settled(view, BIG)
     linkAt(view, 0)
     await until(() => linkStatusText() !== '')
-    expect(linkStatusText()).toContain('no machine states')
+    // A construct the machine bills no state to is one the asm lowering bills no instruction to — the machine is built
+    // from those instructions — and the line says both in one clause (Plan 7 part 5).
+    expect(linkStatusText()).toContain('no instructions or machine states')
     // No block can light for a construct that owns none.
     expect(linkedRowCount()).toBe(0)
 
diff --git a/web/tests/browser/asm-link.test.ts b/web/tests/browser/asm-link.test.ts
new file mode 100644
index 0000000..d4cd942
--- /dev/null
+++ b/web/tests/browser/asm-link.test.ts
@@ -0,0 +1,173 @@
+import type { EditorView } from '@codemirror/view'
+import { beforeAll, describe, expect, it } from 'vitest'
+import { page, userEvent } from 'vitest/browser'
+import init, { compile as compileInPage } from '../../../pkg/redextape_wasm.js'
+import type { LinkIndexWire } from '../../src/link'
+import { SHELL, until } from './harness'
+
+/**
+ * Linking through the asm view (Plan 7 part 5 spec §6.6): an instruction pins the construct its lowering came from,
+ * in every view; a construct pinned elsewhere marks the instructions billed to it; an instruction `defunc` minted
+ * links to nothing and the status line says so; and the asm run's own focus marks its view and meets the pin.
+ */
+
+const SAMPLE = 'let x = 40; x + 2'
+/** `map` with a closure: `defunc` rewrites it, and the instructions its dispatch mints have no owner (5a's fixture). */
+const MAP =
+  'fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } map([3, 1, 2], |x| x + 1)'
+
+let view: EditorView
+
+const asmHost = () => document.querySelector<HTMLElement>('.pane[data-leaf="asm-0"]') as HTMLElement
+const listing = () => asmHost().querySelector<HTMLElement>('.asm-listing') as HTMLElement
+const rowOf = (pc: number) =>
+  [...asmHost().querySelectorAll<HTMLElement>('.asm-row')].find(
+    (r) => r.querySelector('.asm-pc')?.textContent === `pc${pc}`,
+  )
+const linkedPcs = () =>
+  [...asmHost().querySelectorAll<HTMLElement>('.asm-row.is-linked .asm-pc')].map((e) => e.textContent)
+const focusPcs = () =>
+  [...asmHost().querySelectorAll<HTMLElement>('.asm-row.is-focus .asm-pc')].map((e) => e.textContent)
+const sourceLinked = () => document.querySelector('.cm-editor .linked')?.textContent ?? null
+const linkStatus = () => document.querySelector('#link-status')?.textContent ?? ''
+const stepOf = () => asmHost().querySelector('.step')?.textContent ?? ''
+const control = (label: string) =>
+  [...asmHost().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+
+async function compile(src: string): Promise<void> {
+  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
+  await until(() => !idle(), 'the compile to start')
+  await until(idle, 'the compile to finish')
+  await until(() => rowOf(0) !== undefined, 'the asm listing to draw')
+}
+
+/** Link the source construct at `pos`, as `Mod-'` does. */
+function linkAt(pos: number): void {
+  view.dispatch({ selection: { anchor: pos } })
+  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: "'", ctrlKey: true, cancelable: true }))
+}
+
+beforeAll(async () => {
+  await page.viewport(1280, 1600)
+  document.body.innerHTML = SHELL
+  view = await (await import('../../src/main')).ready
+  await compile(SAMPLE)
+})
+
+describe('linking through the asm view', () => {
+  it('pins the construct an instruction came from, in the source and on the machine, from a real click', async () => {
+    // pc3 is `add rr, r1, r2`, which `x + 2` lowered to. The focus starts in the source editor, as a user's would.
+    view.focus()
+    await userEvent.click(rowOf(3) as HTMLElement)
+    await until(() => sourceLinked() !== null, 'the source to be linked')
+    expect(sourceLinked()).toBe('x + 2')
+    expect(linkedPcs()).toEqual(['pc3'])
+    expect(document.activeElement).toBe(listing())
+    await until(
+      () => document.querySelector('.pane[data-leaf="tm-0"] .state-row.is-linked') !== null,
+      'the TM view to mark the construct',
+    )
+  })
+
+  it('marks the instructions a construct pinned in the source was lowered to', async () => {
+    linkAt(SAMPLE.indexOf('40'))
+    await until(() => linkedPcs().length > 0, 'the asm view to mark the pin')
+    expect(linkedPcs()).toEqual(['pc0'])
+  })
+
+  it('marks the construct the asm run is working on, and says when the pin is that construct', async () => {
+    control('↺')?.click()
+    await until(() => stepOf().startsWith('step 0 of'), 'the asm view to restart')
+    // pc0, about to run, is `li r0, #40`: the literal `40`, which the test above pinned.
+    await until(() => focusPcs().includes('pc0'), 'the running focus to mark pc0')
+    await until(() => linkStatus().includes('the asm run is here right now'), 'the coincidence to be said')
+  })
+
+  // ON THE KEYSTROKE ITSELF, not when the next compile lands, whose `setProgram` clears every mark anyway: asserted
+  // with no `await` after the edit, as `running-focus.test.ts`'s clears-the-δ-table-focus case is.
+  it("clears the asm view's pin on the keystroke that edits the program", () => {
+    expect(linkedPcs(), 'the pin the tests above made, still there to clear').toEqual(['pc0'])
+    view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
+    expect(linkedPcs()).toEqual([])
+  })
+})
+
+describe('an instruction with no owner', () => {
+  it('links to nothing, and the status line says the instruction has no source construct', async () => {
+    await compile(MAP)
+    // WHICH INSTRUCTIONS `defunc` MINTED IS READ OFF THE SAME LOWERING THE APP RAN, in the page, rather than written
+    // down: the index is the one `compile` builds, and `asmOwner` is -1 exactly where no construct owns an instruction.
+    await init()
+    const { session } = compileInPage(MAP, 'unary') as {
+      session: { linkIndex(budget: number): LinkIndexWire; free(): void } | null
+    }
+    const owners = session?.linkIndex(65_536).asmOwner
+    session?.free()
+    const minted = owners === undefined ? -1 : owners.indexOf(-1)
+    expect(minted, 'the fixture has an instruction defunc minted').toBeGreaterThanOrEqual(0)
+    listing().scrollTop = Math.max(0, (minted - 2) * 24)
+    await until(() => rowOf(minted) !== undefined, `pc${minted} to be drawn`)
+    await userEvent.click(rowOf(minted) as HTMLElement)
+    await until(() => linkStatus() === 'this instruction has no source construct', 'the status line to say why')
+    expect(sourceLinked()).toBeNull()
+    expect(linkedPcs()).toEqual([])
+  })
+})
+
+describe('a following listing', () => {
+  /**
+   * THE PIN'S ROWS STAY IN VIEW AFTER THE SCROLL'S OWN EVENT. The listing follows the instruction about to run, and a
+   * link's scroll that won only the draw writing it lost the redraw that event causes, a frame later, to following.
+   * `map`'s listing is long enough that the literal `3`, lowered after every function, is off the screen at pc0.
+   */
+  it('scrolls to a construct pinned in the source, and keeps it there past the scroll', async () => {
+    control('↺')?.click()
+    await until(() => stepOf().startsWith('step 0 of'), 'the asm view to restart')
+    // The case above scrolled the listing by hand, which stopped following.
+    asmHost().querySelector<HTMLButtonElement>('.table-reattach')?.click()
+    await until(() => listing().scrollTop === 0, 'the listing to follow pc0')
+    const echo = new Promise<void>((r) => listing().addEventListener('scroll', () => r(), { once: true }))
+    const late = new Promise<never>((_, reject) =>
+      setTimeout(() => reject(new Error('the pin needed no scroll, so this case cannot see the hold')), 5_000),
+    )
+    linkAt(MAP.indexOf('[3') + 1)
+    await Promise.race([echo, late])
+    expect(listing().scrollTop, 'the listing is still where the link scrolled it').toBeGreaterThan(0)
+    expect(linkedPcs().length, "the pin's instructions are on screen").toBeGreaterThan(0)
+  })
+})
+
+describe('an asm view off the page', () => {
+  /** Choose a workspace preset through the workspace menu, as `hidden-views.test.ts` does. */
+  function preset(name: 'explorer' | 'stage'): void {
+    document.querySelector<HTMLButtonElement>('#workspace')?.click()
+    document.querySelector<HTMLButtonElement>(`#workspace-menu [data-preset="${name}"]`)?.click()
+    const m = document.querySelector<HTMLElement>('#workspace-menu')
+    if (m?.matches(':popover-open')) m.hidePopover()
+  }
+  const tab = (leaf: string) => document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`)
+
+  /**
+   * THE LISTING IT MISSED CLEARS ITS PIN, SO THE SEED PUTS THE PIN BACK. A view off the page for a compile is seeded
+   * with the new listing when it is shown, and `setProgram` drops every instruction a link named; the pin made while
+   * it was away is resolved against the index that listing came with.
+   */
+  it('takes the pin it missed with the listing, once the stage shows it', async () => {
+    preset('stage')
+    tab('lambda-0')?.click()
+    await until(() => document.querySelector('.pane[data-leaf="asm-0"]') === null, 'the asm view to leave the page')
+    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SAMPLE } })
+    await until(() => !idle(), 'the compile to start')
+    await until(idle, 'the compile to finish')
+    // The source editor is off the page in the stage too, so the pin is read off the status line.
+    expect(linkStatus(), 'no pin before the gesture').toBe('')
+    linkAt(SAMPLE.indexOf('40'))
+    await until(() => linkStatus() !== '', 'the pin to be made')
+    tab('asm-0')?.click()
+    await until(() => rowOf(0) !== undefined, 'the shown asm view to draw its listing')
+    await until(() => linkedPcs().length > 0, 'the shown asm view to mark the pin')
+    expect(linkedPcs()).toEqual(['pc0'])
+    preset('explorer')
+  })
+})
diff --git a/web/tests/node/link-status.test.ts b/web/tests/node/link-status.test.ts
index a9a3502..c6dea1c 100644
--- a/web/tests/node/link-status.test.ts
+++ b/web/tests/node/link-status.test.ts
@@ -7,23 +7,25 @@ describe('linkStatus', () => {
   })
 
   it('names the one absence that is the common case', () => {
-    expect(linkStatus({ state: 'linked', tm: false, lambda: 'shown', focus: false })).toBe(
-      'this construct emits no machine states',
-    )
+    expect(
+      linkStatus({ state: 'linked', tm: false, instrs: true, lambda: 'shown', focus: false, asmFocus: false }),
+    ).toBe('this construct emits no machine states')
   })
 
   it('distinguishes the reasons the λ view shows no link', () => {
-    expect(linkStatus({ state: 'linked', tm: true, lambda: 'none-here', focus: false })).toBe(
-      'this construct has no node in the λ term at this step',
-    )
-    expect(linkStatus({ state: 'linked', tm: true, lambda: 'too-large', focus: false })).toBe(
-      'the λ term at this step is too large to lay out',
-    )
+    expect(
+      linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'none-here', focus: false, asmFocus: false }),
+    ).toBe('this construct has no node in the λ term at this step')
+    expect(
+      linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'too-large', focus: false, asmFocus: false }),
+    ).toBe('the λ term at this step is too large to lay out')
     // `'waiting'` SAYS NOTHING: a tree one round trip away is a moment, not a state to explain.
-    expect(linkStatus({ state: 'linked', tm: true, lambda: 'waiting', focus: false })).toBe('')
-    expect(linkStatus({ state: 'linked', tm: true, lambda: 'declined', focus: false })).toBe(
-      'this program has no λ lowering, so no construct has a λ link',
-    )
+    expect(
+      linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'waiting', focus: false, asmFocus: false }),
+    ).toBe('')
+    expect(
+      linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'declined', focus: false, asmFocus: false }),
+    ).toBe('this program has no λ lowering, so no construct has a λ link')
   })
 
   // `'absent'` SAYS NOTHING ABOUT λ, AS `'shown'` AND `'waiting'` DO, BUT FOR ITS OWN REASON: there is no
@@ -31,20 +33,47 @@ describe('linkStatus', () => {
   // `'declined'` along with the rest. Checked against both TM answers, so it is seen to drop the λ clause
   // alone: the TM leg's absence still speaks.
   it('says nothing about λ when there is no λ pane to say it about', () => {
-    expect(linkStatus({ state: 'linked', tm: true, lambda: 'absent', focus: false })).toBe('')
-    expect(linkStatus({ state: 'linked', tm: false, lambda: 'absent', focus: false })).toBe(
-      'this construct emits no machine states',
-    )
+    expect(
+      linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'absent', focus: false, asmFocus: false }),
+    ).toBe('')
+    expect(
+      linkStatus({ state: 'linked', tm: false, instrs: true, lambda: 'absent', focus: false, asmFocus: false }),
+    ).toBe('this construct emits no machine states')
   })
 
   it('says nothing extra when both legs resolved and the focus is elsewhere', () => {
-    expect(linkStatus({ state: 'linked', tm: true, lambda: 'shown', focus: false })).toBe('')
+    expect(
+      linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'shown', focus: false, asmFocus: false }),
+    ).toBe('')
   })
 
   it('reports both absences together rather than picking one', () => {
-    expect(linkStatus({ state: 'linked', tm: false, lambda: 'declined', focus: false })).toBe(
-      'this construct emits no machine states · this program has no λ lowering, so no construct has a λ link',
+    expect(
+      linkStatus({ state: 'linked', tm: false, instrs: true, lambda: 'declined', focus: false, asmFocus: false }),
+    ).toBe('this construct emits no machine states · this program has no λ lowering, so no construct has a λ link')
+  })
+
+  // ONE CLAUSE FOR A CONSTRUCT NEITHER LOWERING BILLS ANYTHING TO — the common case among clicks, since a
+  // transparent `let` or a `Lambda` emits no instruction and so no state — and each alone otherwise.
+  it('says what the construct emits no instructions of, and no machine states of, in one clause', () => {
+    const linked = { state: 'linked', lambda: 'shown', focus: false, asmFocus: false } as const
+    expect(linkStatus({ ...linked, tm: false, instrs: false })).toBe(
+      'this construct emits no instructions or machine states',
     )
+    expect(linkStatus({ ...linked, tm: true, instrs: false })).toBe('this construct emits no instructions')
+    expect(linkStatus({ ...linked, tm: false, instrs: true })).toBe('this construct emits no machine states')
+  })
+
+  it('reports the asm run reaching the pin, ahead of the machine and of any absence', () => {
+    expect(linkStatus({ state: 'linked', tm: false, instrs: true, lambda: 'shown', focus: true, asmFocus: true })).toBe(
+      'the asm run is here right now · the machine is here right now · this construct emits no machine states',
+    )
+  })
+
+  // AMENDMENT 11: an asm instruction `defunc` minted links to nothing, and the line says so, where a click that
+  // cleared the pin with no word would read as a click that missed.
+  it('says an instruction with no owner has no source construct', () => {
+    expect(linkStatus({ state: 'ownerless' })).toBe('this instruction has no source construct')
   })
 
   it('explains a stale index rather than resolving against it', () => {
@@ -55,7 +84,7 @@ describe('linkStatus', () => {
   // test — the only one that sets it `true` against an otherwise-silent link — would still report ''
   // and fail.
   it('reports the running focus when it coincides with the pin', () => {
-    expect(linkStatus({ state: 'linked', tm: true, lambda: 'shown', focus: true })).toBe(
+    expect(linkStatus({ state: 'linked', tm: true, instrs: true, lambda: 'shown', focus: true, asmFocus: false })).toBe(
       'the machine is here right now',
     )
   })
@@ -64,9 +93,9 @@ describe('linkStatus', () => {
   // absence rather than after it. A version that pushed `tm`'s absence first would produce the same
   // TWO PARTS but in the wrong order, and `toBe` (not a set/array comparison) catches that.
   it('reports the focus ahead of an absence, not after it', () => {
-    expect(linkStatus({ state: 'linked', tm: false, lambda: 'shown', focus: true })).toBe(
-      'the machine is here right now · this construct emits no machine states',
-    )
+    expect(
+      linkStatus({ state: 'linked', tm: false, instrs: true, lambda: 'shown', focus: true, asmFocus: false }),
+    ).toBe('the machine is here right now · this construct emits no machine states')
   })
 })
 
@@ -92,8 +121,10 @@ describe('linkStatus · detachment', () => {
       linkStatus({
         state: 'linked',
         tm: true,
+        instrs: true,
         lambda: 'shown',
         focus: true,
+        asmFocus: false,
         detached: { lambda: false, asm: false, tm: false },
       }),
     ).toBe('the machine is here right now')
@@ -137,8 +168,10 @@ describe('linkStatus · detachment', () => {
       linkStatus({
         state: 'linked',
         tm: false,
+        instrs: true,
         lambda: 'none-here',
         focus: false,
+        asmFocus: false,
         detached: { lambda: true, asm: false, tm: false },
       }),
     ).toBe('λ view shows a copy — not linked to the program · this construct emits no machine states')
@@ -152,20 +185,40 @@ describe('linkStatus · detachment', () => {
       linkStatus({
         state: 'linked',
         tm: false,
+        instrs: true,
         lambda: 'none-here',
         focus: true,
+        asmFocus: false,
         detached: { lambda: false, asm: false, tm: true },
       }),
     ).toBe('TM view shows a copy — not linked to the program · this construct has no node in the λ term at this step')
   })
 
+  // THE ASM LEG'S CLAUSES FOLLOW ITS OWN VIEW'S BINDING, as each leg's do: no asm view shows a copy until part 5c, but a
+  // detached one would be showing a copy's run, which no construct of the program's owns.
+  it('suppresses the asm clauses for a detached asm view and keeps the others', () => {
+    expect(
+      linkStatus({
+        state: 'linked',
+        tm: true,
+        instrs: false,
+        lambda: 'shown',
+        focus: true,
+        asmFocus: true,
+        detached: { lambda: false, asm: true, tm: false },
+      }),
+    ).toBe('asm view shows a copy — not linked to the program · the machine is here right now')
+  })
+
   it('leaves only the detachment clause when both panes are detached', () => {
     expect(
       linkStatus({
         state: 'linked',
         tm: false,
+        instrs: true,
         lambda: 'declined',
         focus: true,
+        asmFocus: false,
         detached: { lambda: true, asm: false, tm: true },
       }),
     ).toBe('λ and TM views show copies — not linked to the program')
diff --git a/web/tests/node/link.test.ts b/web/tests/node/link.test.ts
index 3b068f7..0818daf 100644
--- a/web/tests/node/link.test.ts
+++ b/web/tests/node/link.test.ts
@@ -19,7 +19,7 @@ function wire(over: Partial<LinkIndexWire> = {}): LinkIndexWire {
     sourceNodeEnd: new Uint32Array([17, 5, 17]),
     sourceNodeId: new Uint32Array([100, 101, 102]),
     tmOwner: new Int32Array([-1, 100, 101, 100, -1]),
-    asmOwner: new Int32Array([]),
+    asmOwner: new Int32Array([100, -1, 101, 100]),
     ...over,
   }
 }
@@ -82,12 +82,28 @@ describe('LinkIndex.nodeForState', () => {
   })
 })
 
+describe('LinkIndex.nodeForInstr', () => {
+  it('resolves an instruction to the construct that emitted it, and one defunc minted to null', () => {
+    const ix = new LinkIndex(wire())
+    expect(ix.nodeForInstr(0)).toBe(100)
+    expect(ix.nodeForInstr(2)).toBe(101)
+    expect(ix.nodeForInstr(1)).toBeNull()
+  })
+
+  it('an index outside the program is null, never a wrap or a throw', () => {
+    const ix = new LinkIndex(wire())
+    expect(ix.nodeForInstr(4)).toBeNull()
+    expect(ix.nodeForInstr(-1)).toBeNull()
+  })
+})
+
 describe('LinkIndex.linkFor', () => {
-  it('gathers both legs, and states are ascending', () => {
+  it('gathers every leg, states and instructions ascending', () => {
     const ix = new LinkIndex(wire())
     expect(ix.linkFor(100)).toEqual({
       source: { start: 0, end: 17 },
       states: [1, 3],
+      instrs: [0, 3],
     })
   })
 
@@ -95,9 +111,12 @@ describe('LinkIndex.linkFor', () => {
     const ix = new LinkIndex(wire())
     // 102 owns no state.
     expect(ix.linkFor(102).states).toEqual([])
+    expect(ix.linkFor(102).instrs).toEqual([])
     expect(ix.linkFor(102).source).toEqual({ start: 12, end: 17 })
+    // 101 owns a state and an instruction of its own, and no other construct's.
+    expect(ix.linkFor(101)).toEqual({ source: { start: 4, end: 5 }, states: [2], instrs: [2] })
     // A node nobody has heard of.
-    expect(ix.linkFor(999)).toEqual({ source: null, states: [] })
+    expect(ix.linkFor(999)).toEqual({ source: null, states: [], instrs: [] })
   })
 })
 
````


- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run tests/node/link.test.ts tests/node/link-status.test.ts tests/browser/asm-link.test.ts`

Expected: exit 1, printing:

```text
    × says what the construct emits no instructions of, and no machine states of, in one clause
    × reports the asm run reaching the pin, ahead of the machine and of any absence
    × says an instruction with no owner has no source construct
    × resolves an instruction to the construct that emitted it, and one defunc minted to null
    × an index outside the program is null, never a wrap or a throw
    × gathers every leg, states and instructions ascending
    × reports each leg absent independently
    × pins the construct an instruction came from, in the source and on the machine, from a real click
    × marks the instructions a construct pinned in the source was lowered to
    × marks the construct the asm run is working on, and says when the pin is that construct
    × clears the asm view's pin on the keystroke that edits the program
    × links to nothing, and the status line says the instruction has no source construct
    … and 18 more lines
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=8
diff --git a/web/src/draw.ts b/web/src/draw.ts
index 89cb00b..d3a9e6a 100644
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -167,6 +167,17 @@ export function createDraw(deps: {
         : null
     const tmFocusLink: Link | null =
       tmFocus !== null && linkWiring.index !== null ? linkWiring.index.linkFor(tmFocus.node) : null
+    // THE ASM LEG'S OWN RUNNING FOCUS, BY THE TM LEG'S RULES (Plan 7 part 5 spec §6.6): `AsmState.source_node`, the owner
+    // of the instruction about to run, read off the asm view the user last focused, and nothing when no asm view is
+    // asking. It marks that view's rows and feeds the status line's coincidence; the source editor's focus mark stays
+    // λ's, as Plan 5c's dual-focus design settled.
+    const asm = panes.active('asm')?.slot.resolve(sessions)
+    const asmFocus =
+      linkWiring.linkable && linkWiring.index !== null && asm !== undefined
+        ? runningFocus(linkWiring.index, sourceNodeOwner(asm.hist.current?.source_node ?? null))
+        : null
+    const asmFocusLink: Link | null =
+      asmFocus !== null && linkWiring.index !== null ? linkWiring.index.linkFor(asmFocus.node) : null
 
     // THE PICKER'S TWO SHARED INPUTS, RESOLVED ONCE PER FRAME RATHER THAN ONCE PER PANE. Both answers
     // are app-wide — every pane may be pointed at the same set of pairs, and "is there a source leaf" is
@@ -223,9 +234,17 @@ export function createDraw(deps: {
       if (asmPane !== null && unseen.has(asmPane)) {
         asmPane.setProgram(sessions.entryOf(p.slot.binding.session).asmProgram)
         unseen.delete(asmPane)
+        // THE PIN, RESOLVED AGAINST THIS FRAME'S INDEX, and no scroll: the TM seed's two reasons above.
+        asmPane.setLink(
+          linkWiring.linkable && linkWiring.link !== null && linkWiring.index !== null
+            ? linkWiring.index.linkFor(linkWiring.link.node).instrs
+            : [],
+          false,
+        )
       }
       const leg = p.slot.resolve(sessions)
       if (tmPane !== null) tmPane.setFocus(tmFocusLink?.states ?? [])
+      if (asmPane !== null) asmPane.setFocus(asmFocusLink?.instrs ?? [])
       p.slot.render(sessions, p.pane, leg)
       // WHICH LAYOUT GESTURES THIS PANE OFFERS — T12's own addition, driven from here for the same
       // reason `setBindings` already is (`PaneSlot.render`'s doc): both are facts about something
@@ -257,7 +276,7 @@ export function createDraw(deps: {
     }
 
     // RESOLVED ONCE, HERE, FOR `drawLink` AT THE END. `draw()` runs on every recorded frame during
-    // playback, and `index.linkFor` walks `#spanOf`/`#statesOf` over the wire's parallel arrays — not
+    // playback, and `index.linkFor` walks `#spanOf`/`#ownedBy` over the wire's parallel arrays — not
     // free. The λ views need none of it: each marks the pinned construct's nodes in the tree it draws.
     const l: Link | null =
       linkWiring.linkable && linkWiring.link !== null && linkWiring.index !== null
@@ -343,7 +362,7 @@ export function createDraw(deps: {
         : linkWiring.index === null || linkWiring.index.lambdaText === ''
           ? 'declined'
           : (drewLambda.pane as LambdaPane).linkState()
-    linkWiring.drawLink(l, isCoincident(linkWiring.link, tmFocus), lambdaLink)
+    linkWiring.drawLink(l, isCoincident(linkWiring.link, tmFocus), isCoincident(linkWiring.link, asmFocus), lambdaLink)
 
     // THE READOUT (spec §9): the focused view's session. A focused source view has no pane entry
     // (`panes.get('source')` is `undefined`) and shows the program, as does any view bound to it.
diff --git a/web/src/link-status.ts b/web/src/link-status.ts
index 3305e30..9619892 100644
--- a/web/src/link-status.ts
+++ b/web/src/link-status.ts
@@ -119,9 +119,18 @@ export type LinkStatus = {
 } & (
   | { state: 'none' }
   | { state: 'stale' }
+  /**
+   * An asm instruction with no owner was clicked (Plan 7 part 5 spec §6.6, amendment 11): one `defunc` minted, which
+   * no construct of the program wrote. Nothing is pinned, and unlike `none` the line says why — the click did
+   * something, and a line left blank would read as a click that missed. A TM state with no owner still clears the pin
+   * silently, which amendment 11 keeps.
+   */
+  | { state: 'ownerless' }
   | {
       state: 'linked'
       tm: boolean
+      /** Whether the pinned construct emits any asm instruction — `Link.instrs` is not empty. */
+      instrs: boolean
       lambda: LambdaLinkState
       /**
        * Whether the TM leg's running focus — the construct its CURRENT δ-step belongs to,
@@ -142,6 +151,13 @@ export type LinkStatus = {
        * this project's accessibility pass rather than fixed here; see the roadmap's deferred-a11y list.
        */
       focus: boolean
+      /**
+       * Whether the asm leg's running focus — the construct its CURRENT instruction belongs to, `AsmState.source_node`
+       * — names this same pinned construct right now: `focus` one leg over (spec §6.6). The asm view marks its focus
+       * rows beside its linked ones, so unlike the TM table's this is not the leg's only signal, but it is the only one
+       * a user watching another view hears of.
+       */
+      asmFocus: boolean
     }
 )
 
@@ -227,14 +243,22 @@ export function linkStatus(s: LinkStatus): string {
     // when this compiles, for whichever pane is showing that session then, and a detached pane is one
     // rebind away from being one.
     parts.push('linking resumes when this compiles')
+  } else if (s.state === 'ownerless') {
+    parts.push('this instruction has no source construct')
   } else if (s.state === 'linked') {
-    if (!detached.tm) {
-      // REPORTED FIRST OF THE PIN'S OWN PARTS, AHEAD OF EITHER ABSENCE BELOW — coincidence is live,
-      // present-tense news ("the run just reached what you pinned"), not a reason something is
-      // missing, and it is the state 5c exists to surface.
-      if (s.focus) parts.push('the machine is here right now')
-      if (!s.tm) parts.push('this construct emits no machine states')
-    }
+    // REPORTED FIRST OF THE PIN'S OWN PARTS, AHEAD OF ANY ABSENCE BELOW — coincidence is live, present-tense news
+    // ("the run just reached what you pinned"), not a reason something is missing, and it is the state 5c exists to
+    // surface. A detached view's own clauses are suppressed, each leg by its own flag (this function's doc).
+    if (!detached.asm && s.asmFocus) parts.push('the asm run is here right now')
+    if (!detached.tm && s.focus) parts.push('the machine is here right now')
+    // ONE ABSENCE CLAUSE FOR THE TWO LOWERINGS, NOT TWO SIDE BY SIDE. A construct the asm lowering bills nothing to —
+    // a transparent `let`, a `Lambda` — bills nothing to the machine built from it either, so two clauses would say
+    // one fact twice on the constructs that are most often clicked.
+    const noInstrs = !detached.asm && !s.instrs
+    const noStates = !detached.tm && !s.tm
+    if (noInstrs && noStates) parts.push('this construct emits no instructions or machine states')
+    else if (noInstrs) parts.push('this construct emits no instructions')
+    else if (noStates) parts.push('this construct emits no machine states')
     if (!detached.lambda) {
       const lambda = LAMBDA_TEXT[s.lambda]
       if (lambda !== '') parts.push(lambda)
diff --git a/web/src/link-wiring.ts b/web/src/link-wiring.ts
index 09c43d9..58fc871 100644
--- a/web/src/link-wiring.ts
+++ b/web/src/link-wiring.ts
@@ -1,4 +1,5 @@
 import type { EditorView } from '@codemirror/view'
+import type { AsmPane } from './asm-pane'
 import { setLink } from './highlight'
 import { perLeg, unhandled } from './legs'
 import type { Link, LinkIndex, Pin } from './link'
@@ -41,9 +42,9 @@ export type LinkWiring = {
    * `draw()` and the click handlers" — an argument that dissolved the moment `draw` and `events` moved
    * into modules of their own, without the conclusion changing at all. The real reason is that
    * `LinkIndex` (`link.ts`) exposes NOTHING that can change it: `lambdaText` and `lambdaCut` are
-   * `readonly`, every method (`nodeAtSource`, `nodeForState`, `linkFor`) is a pure read, and the wire
-   * arrays it reads them out of are `#`-private. The one write anywhere in the class is `#statesOf`'s
-   * own memo of a value it just derived — a cache, not a state a caller can set. So a
+   * `readonly`, every method (`nodeAtSource`, `nodeForState`, `nodeForInstr`, `linkFor`) is a pure read, and the
+   * wire arrays it reads them out of are `#`-private. The one write anywhere in the class is `#ownedBy`'s
+   * memo of a value it just derived — a cache, not a state a caller can set. So a
    * holder of this reference can ask it questions and nothing else, whoever they are and wherever they
    * live. WRITES to the FIELD stay confined to this module (`setIndex` is the only one); this getter is
    * what keeps reads legitimate everywhere else.
@@ -52,7 +53,7 @@ export type LinkWiring = {
   get linkable(): boolean
   get link(): Pin | null
   clearLink(): void
-  drawLink(l: Link | null, focusCoincident: boolean, lambda: LambdaLinkState): void
+  drawLink(l: Link | null, focusCoincident: boolean, asmCoincident: boolean, lambda: LambdaLinkState): void
   setLinkTo(node: number | null, origin: Pin['origin']): void
   linkAtSourceOffset(byteOffset: number): void
 }
@@ -166,6 +167,12 @@ export function createLinkWiring(deps: {
   let index: LinkIndex | null = null
   let linkable = false
   let link: Pin | null = null
+  /**
+   * The last link gesture was a click on an asm instruction with no owner (Plan 7 part 5 spec §6.6, amendment 11): it
+   * pinned nothing, and the status line says why until the next gesture, keystroke or compile replaces it. A TM state
+   * with no owner does not set it — that click clears the pin silently, which the amendment keeps.
+   */
+  let ownerless = false
 
   /**
    * Paint the link status line from `draw()`'s already-resolved link, or `null` when there is nothing
@@ -180,27 +187,30 @@ export function createLinkWiring(deps: {
    * running focus against `link` (`isCoincident`) once, and re-deriving it here would need `tmFocus`
    * threaded in anyway — passing the boolean it produces is the smaller surface. Meaningless when
    * `l === null` (nothing is pinned to coincide with) or `!linkable` (both return before reading it).
+   * `asmCoincident` is the same boolean for the asm leg's running focus.
    *
    * `detached` IS ON ALL THREE ARMS, NOT ONLY `'linked'`, and that is §4.5's obligation rather than
    * symmetry: `{state:'none'}` with a detached λ pane is precisely the case where this line goes from
    * blank to speaking. `linkStatus` is the one function that reads the field and it suppresses a
    * detached pane's own clauses itself, so nothing here has to know which clauses those are.
    */
-  const drawLink = (l: Link | null, focusCoincident: boolean, lambda: LambdaLinkState) => {
+  const drawLink = (l: Link | null, focusCoincident: boolean, asmCoincident: boolean, lambda: LambdaLinkState) => {
     const detached = detachedPanes()
     if (!linkable) {
       linkStatusHost.textContent = linkStatus({ state: 'stale', detached })
       return
     }
     if (l === null) {
-      linkStatusHost.textContent = linkStatus({ state: 'none', detached })
+      linkStatusHost.textContent = linkStatus({ state: ownerless ? 'ownerless' : 'none', detached })
       return
     }
     linkStatusHost.textContent = linkStatus({
       state: 'linked',
       tm: l.states.length > 0,
+      instrs: l.instrs.length > 0,
       lambda,
       focus: focusCoincident,
+      asmFocus: asmCoincident,
       detached,
     })
   }
@@ -214,6 +224,9 @@ export function createLinkWiring(deps: {
    */
   const setLinkTo = (node: number | null, origin: Pin['origin']) => {
     link = node === null ? null : { node, origin }
+    // AN ASM INSTRUCTION THAT RESOLVED TO NO CONSTRUCT IS THE ONE CLICK THE LINE EXPLAINS (amendment 11); any other
+    // gesture, a resolved asm click included, replaces that explanation.
+    ownerless = node === null && origin === 'asm'
     // ONE `linkFor` CALL, reused for both legs it drives here — see `drawLink`'s doc for why a second
     // call on a path that runs per rendered frame during playback is not free.
     const l = node === null || index === null ? null : index.linkFor(node)
@@ -260,6 +273,9 @@ export function createLinkWiring(deps: {
     // before it is next shown, and `draw.ts`'s seed block re-applies the CURRENT pin once it is, so a
     // wrong answer written here never reaches the screen.
     for (const p of panes.of('tm')) (p.pane as TmPane).setLink(l?.states ?? [], origin !== 'tm')
+    // AND EVERY ASM VIEW, BY THE TM FAN-OUT'S RULES AND FOR ITS REASONS: hidden ones included, and scrolled to the
+    // construct's first instruction unless the click came from an asm listing (spec §6.6).
+    for (const p of panes.of('asm')) (p.pane as AsmPane).setLink(l?.instrs ?? [], origin !== 'asm')
   }
 
   /** Link at a byte offset into the source document, or clear if nothing contains it. */
@@ -273,6 +289,7 @@ export function createLinkWiring(deps: {
       index = newIndex
       linkable = index !== null
       link = null
+      ownerless = false
     },
     get index(): LinkIndex | null {
       return index
@@ -286,6 +303,7 @@ export function createLinkWiring(deps: {
     clearLink(): void {
       linkable = false
       link = null
+      ownerless = false
     },
     drawLink,
     setLinkTo,
diff --git a/web/src/link.ts b/web/src/link.ts
index 606e990..8a42516 100644
--- a/web/src/link.ts
+++ b/web/src/link.ts
@@ -38,11 +38,11 @@ export type LinkIndexWire = {
 }
 
 /**
- * Where one Core node shows up: its source span and its machine states. Either may be absent, each for its
- * own reason. **NO λ LEG SINCE PLAN 7 PART 4A** — the λ view finds a construct's nodes in the tree it draws
- * (`Tree.nodesLinkedTo`), at whatever step is on screen, where this index knew only step 0's text.
+ * Where one Core node shows up: its source span, its machine states and its asm instructions. Any may be absent,
+ * each for its own reason. **NO λ LEG SINCE PLAN 7 PART 4A** — the λ view finds a construct's nodes in the tree it
+ * draws (`Tree.nodesLinkedTo`), at whatever step is on screen, where this index knew only step 0's text.
  */
-export type Link = { source: Span | null; states: number[] }
+export type Link = { source: Span | null; states: number[]; instrs: number[] }
 
 /**
  * The smallest span containing `byteOffset`, as an index into the three parallel arrays, or `-1`.
@@ -98,6 +98,8 @@ export class LinkIndex {
   #w: LinkIndexWire
   /** `node -> its ascending state ids`, derived on first ask and cached. */
   #states = new Map<number, number[]>()
+  /** `node -> its ascending instruction indices`, derived on first ask and cached, as `#states` is. */
+  #instrs = new Map<number, number[]>()
 
   constructor(wire: LinkIndexWire) {
     this.#w = wire
@@ -119,7 +121,17 @@ export class LinkIndex {
   }
 
   /**
-   * Where `node` shows up on the index's two legs: its source span and its machine states.
+   * The Core node whose lowering emitted asm instruction `pc`, or `null` for an instruction `defunc` minted and for
+   * an index past the program (Plan 7 part 5 spec §6.6) — `nodeForState`'s rule, over `asmOwner`.
+   */
+  nodeForInstr(pc: number): number | null {
+    if (pc < 0 || pc >= this.#w.asmOwner.length) return null
+    const owner = this.#w.asmOwner[pc] as number
+    return owner < 0 ? null : owner
+  }
+
+  /**
+   * Where `node` shows up: its source span, its machine states and its asm instructions.
    *
    * NO OUTWARD WALK WHEN A LEG IS ABSENT. `sourcemap.rs` refuses to fall back to a surrounding block
    * and so does this: the walk from a transparent `let` goes Let -> Seq -> root, so "nearest enclosing
@@ -128,7 +140,11 @@ export class LinkIndex {
    * must say so rather than show nothing.
    */
   linkFor(node: number): Link {
-    return { source: this.#spanOf(node), states: this.#statesOf(node) }
+    return {
+      source: this.#spanOf(node),
+      states: this.#ownedBy(node, this.#w.tmOwner, this.#states),
+      instrs: this.#ownedBy(node, this.#w.asmOwner, this.#instrs),
+    }
   }
 
   #spanOf(node: number): Span | null {
@@ -142,18 +158,22 @@ export class LinkIndex {
   }
 
   /**
+   * The ascending indices `owner` bills to `node` — a construct's states from `tmOwner`, its instructions from
+   * `asmOwner` — derived on first ask and kept in `cache`.
+   *
    * DERIVED, NOT SHIPPED. Shipping node -> states alongside state -> node would be a second
    * representation of one association with nothing checking the two came from one lowering — the
-   * object `sourcemap.rs`'s module doc refuses to create, reintroduced at the boundary.
+   * object `sourcemap.rs`'s module doc refuses to create, reintroduced at the boundary. The asm column is the same
+   * association one lowering earlier, and gets the same treatment rather than a second copy of the loop.
    */
-  #statesOf(node: number): number[] {
-    const cached = this.#states.get(node)
+  #ownedBy(node: number, owner: Int32Array, cache: Map<number, number[]>): number[] {
+    const cached = cache.get(node)
     if (cached !== undefined) return cached
     const out: number[] = []
-    for (let s = 0; s < this.#w.tmOwner.length; s += 1) {
-      if (this.#w.tmOwner[s] === node) out.push(s)
+    for (let i = 0; i < owner.length; i += 1) {
+      if (owner[i] === node) out.push(i)
     }
-    this.#states.set(node, out)
+    cache.set(node, out)
     return out
   }
 }
diff --git a/web/src/main.ts b/web/src/main.ts
index a76e8ec..b2a73aa 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -2004,6 +2004,7 @@ async function main(): Promise<EditorView> {
           // is the one route every consumer of this rule shares.
           linkWiring.clearLink()
           for (const p of panes.of('tm')) (p.pane as TmPane).setLink([], false)
+          for (const p of panes.of('asm')) (p.pane as AsmPane).setLink([], false)
           compile.schedule(src)
         }),
       ],
diff --git a/web/src/transport.ts b/web/src/transport.ts
index 263f2b4..a605b81 100644
--- a/web/src/transport.ts
+++ b/web/src/transport.ts
@@ -456,6 +456,17 @@ export function createTransport(deps: {
     // held by the pane for the life of the page, so there is no later moment at which a spread could
     // take effect anyway. The second reason is `PaneSlot`'s: a slot's leg cannot change, so a fact
     // decided from it at construction cannot go stale the way one decided from its session would.
+    // THE ASM VIEW'S ROWS LINK THE SAME WAY, BY THE INSTRUCTION'S OWNER (Plan 7 part 5 spec §6.6) — an instruction
+    // `defunc` minted has none, and `setLinkTo` says so on the status line rather than leaving it blank.
+    ...(slot.binding.leg === 'asm'
+      ? {
+          linkInstr: (pc: number) => {
+            const wiring = linkWiring()
+            if (!wiring.linkable || wiring.index === null) return
+            wiring.setLinkTo(wiring.index.nodeForInstr(pc), 'asm')
+          },
+        }
+      : {}),
     ...(slot.binding.leg === 'tm'
       ? {
           linkState: (stateId: number) => {
````


- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run tests/node/link.test.ts tests/node/link-status.test.ts tests/browser/asm-link.test.ts`

Expected: exit 0, printing:

```text
    Test Files  3 passed (3)
    Tests  51 passed (51)
```

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
    Test Files  52 passed (52)
    Tests  714 passed (714)
```

Run: `cd web && pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
    Test Files  108 passed (108)
    Tests  697 passed (697)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, from `web/`, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 14 of 14 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| S1 | a minted instruction reads as owned — `link.ts`: `if (pc < 0 || pc >= this.#w.asmOwner.length) return null ⏎     const owner = this.#w.asmOwner[pc] as number ⏎     return owner < 0 ? null : owner` → `if (pc < 0 || pc >= this.#w.asmOwner.length) return null ⏎     return this.#w.asmOwner[pc] as number` | `pnpm exec vitest run tests/node/link.test.ts` | `tests/node/link.test.ts > LinkIndex.nodeForInstr > resolves an instruction to the construct that emitted it, and one defunc minted to null` |
| S2 | instructions read off the state column — `link.ts`: `instrs: this.#ownedBy(node, this.#w.asmOwner, this.#instrs)` → `instrs: this.#ownedBy(node, this.#w.tmOwner, this.#instrs)` | `pnpm exec vitest run tests/node/link.test.ts` | `tests/node/link.test.ts > LinkIndex.linkFor > gathers every leg, states and instructions ascending` |
| S3 | two absence clauses for one fact — `link-status.ts`: `if (noInstrs && noStates) parts.push('this construct emits no instructions or machine states') ⏎     else if (noInstrs)` → `if (noInstrs)` | `pnpm exec vitest run tests/node/link-status.test.ts` | `tests/node/link-status.test.ts > linkStatus > says what the construct emits no instructions of, and no machine states of, in one clause` |
| S4 | the asm run's coincidence unsaid — `link-status.ts`: `if (!detached.asm && s.asmFocus) parts.push('the asm run is here right now')` → `if (false) parts.push('the asm run is here right now')` | `pnpm exec vitest run tests/node/link-status.test.ts` | `tests/node/link-status.test.ts > linkStatus > reports the asm run reaching the pin, ahead of the machine and of any absence` |
| S5 | a detached asm view's clauses kept — `link-status.ts`: `if (!detached.asm && s.asmFocus) parts.push` → `if (s.asmFocus) parts.push` | `pnpm exec vitest run tests/node/link-status.test.ts` | `tests/node/link-status.test.ts > linkStatus · detachment > suppresses the asm clauses for a detached asm view and keeps the others` |
| S6 | an ownerless click says nothing — `link-wiring.ts`: `ownerless = node === null && origin === 'asm'` → `ownerless = false` | `pnpm exec vitest run tests/browser/asm-link.test.ts` | `tests/browser/asm-link.test.ts > an instruction with no owner > links to nothing, and the status line says the instruction has no source construct` |
| S7 | a pin made elsewhere does not reach asm views — `link-wiring.ts`: `for (const p of panes.of('asm')) (p.pane as AsmPane).setLink(l?.instrs ?? [], origin !== 'asm')` → `(deleted)` | `pnpm exec vitest run tests/browser/asm-link.test.ts` | `tests/browser/asm-link.test.ts > a following listing > scrolls to a construct pinned in the source, and keeps it there past the scroll`, `tests/browser/asm-link.test.ts > linking through the asm view > clears the asm view's pin on the keystroke that edits the program`, `tests/browser/asm-link.test.ts > linking through the asm view > marks the instructions a construct pinned in the source was lowered to`, `tests/browser/asm-link.test.ts > linking through the asm view > pins the construct an instruction came from, in the source and on the machine, from a real click` |
| S8 | a row links nothing — `transport.ts`: `wiring.setLinkTo(wiring.index.nodeForInstr(pc), 'asm')` → `wiring.setLinkTo(null, 'source')` | `pnpm exec vitest run tests/browser/asm-link.test.ts` | `tests/browser/asm-link.test.ts > an instruction with no owner > links to nothing, and the status line says the instruction has no source construct`, `tests/browser/asm-link.test.ts > linking through the asm view > pins the construct an instruction came from, in the source and on the machine, from a real click` |
| S9 | the asm run's focus marks nothing — `draw.ts`: `if (asmPane !== null) asmPane.setFocus(asmFocusLink?.instrs ?? [])` → `if (asmPane !== null) asmPane.setFocus([])` | `pnpm exec vitest run tests/browser/asm-link.test.ts` | `tests/browser/asm-link.test.ts > linking through the asm view > marks the construct the asm run is working on, and says when the pin is that construct` |
| S10 | the asm coincidence never reaches the line — `draw.ts`: `isCoincident(linkWiring.link, asmFocus), lambdaLink)` → `false, lambdaLink)` | `pnpm exec vitest run tests/browser/asm-link.test.ts` | `tests/browser/asm-link.test.ts > linking through the asm view > marks the construct the asm run is working on, and says when the pin is that construct` |
| S11 | a keystroke leaves the asm pin — `main.ts`: `for (const p of panes.of('asm')) (p.pane as AsmPane).setLink([], false)` → `(deleted)` | `pnpm exec vitest run tests/browser/asm-link.test.ts` | `tests/browser/asm-link.test.ts > linking through the asm view > clears the asm view's pin on the keystroke that edits the program` |
| S12 | a seeded view forgets the pin — `draw.ts`: `asmPane.setLink( ⏎           linkWiring.linkable && linkWiring.link !== null && linkWiring.index !== null ⏎             ? linkWiring.index.linkFor(linkWiring…` → `(deleted)` | `pnpm exec vitest run tests/browser/asm-link.test.ts` | `tests/browser/asm-link.test.ts > an asm view off the page > takes the pin it missed with the listing, once the stage shows it` |
| S13 | the ownerless sentence — `link-status.ts`: `parts.push('this instruction has no source construct')` → `parts.push('')` | `pnpm exec vitest run tests/node/link-status.test.ts` | `tests/node/link-status.test.ts > linkStatus > says an instruction with no owner has no source construct` |
| S14 | a link wins one draw of a following listing — `virtual-grid.ts`: `} else if (this.#hold === null || this.#hold.follow !== rows.follow) { ⏎       this.#hold = null ⏎       if (rows.follow !== null) {` → `} else if (true) { ⏎       this.#hold = null ⏎       if (rows.follow !== null) {` | `pnpm exec vitest run tests/browser/asm-link.test.ts` | `tests/browser/asm-link.test.ts > a following listing > scrolls to a construct pinned in the source, and keeps it there past the scroll` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
The asm view links: an instruction pins the construct it came from, a pin marks the instructions billed to it, and one defunc minted says it has none

The asm view joins linking as the TM view does: a click or Enter on a
row pins its owner in every view, a pin made anywhere marks the asm rows
billed to it and scrolls to them, a keystroke clears them, and a view
seeded off the page takes the pin with its listing. An instruction
`defunc` minted links to nothing and the status line says so. The asm
run's own focus marks its view and reaches the status line when it meets
the pin, and a construct neither lowering bills anything to is said
once, not twice.
````


---

### Task 9: Verification, the check by hand, and the roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` — the entry for this PR, appended at the end

**Nothing here changes code.** Every gate CI runs, the Docker image no PR job builds, a look at the app in the three presets, and the entry.

- [ ] **Step 1: Run every gate, one after another, in one detached unit** capped at 16G with no swap, with `PATH` (`/usr/sbin` and `$CARGO_HOME/bin` first), `CARGO_HOME`, `RUSTUP_HOME`, `HOME` and the checkout's own `CARGO_TARGET_DIR` set:
  - `TREE_SITTER=$PWD/.tools/tree-sitter scripts/check-all.sh` — expected last line `all configs green — base, LLVM and browser` (`.tools/` is untracked: in a worktree, point `TREE_SITTER` at the main checkout's);
  - `scripts/check-slow.sh` — expected `slow tier green`;
  - `cargo llvm-cov nextest --workspace --fail-under-lines 90`;
  - the six hygiene scans, each `--self-test` and then alone: `scripts/check-{text-bytes,citations,attributions,doc-figures,shared-docs,lua}.sh`;
  - the web CI sequence: `cd web && pnpm run build:wasm && pnpm exec biome ci --error-on-warnings && pnpm run typecheck && pnpm run test:coverage && pnpm run build:app`, whose floors are statements 95, branches 89, functions 97, lines 97;
  - the Docker image, built and started: `docker build -t redextape-check .`, `docker run -d --name c -p 8099:80 redextape-check`, then `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8099/` answers `200` and `docker inspect --format '{{.State.Health.Status}}' c` answers `healthy`.

  Expected: every one exits 0. **The prototype's run of this step:** every one exited 0 on the prototype's last commit, in this order: `check-all.sh` (169 s), `check-slow.sh` (512 s), the llvm-cov floor (65 s), each hygiene scan and its self-test, and the web CI sequence (55 s) — 160 test files, 1,411 tests, coverage statements 96.64, branches 90.09, functions 97.31, lines 98.27 against floors of 95, 89, 97 and 97; the image built, answered `200` and reported `healthy`. Branches and functions have the least headroom, 1.09 and 0.31 points: a fix round that adds untested branches can fail the floor before it fails a test.

- [ ] **Step 2: Look at the app, by hand**, from `cd web && pnpm run dev`, at 1280×800, in each preset (Explorer, Debugger, Stage), light and dark, with `fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)` compiled: the default tree's four views; the asm listing following the instruction about to run as the step controls move; the registers, call stack and heap at a step early in a recursive call, with the locals that call has not yet written dimmed and marked `·` as left over from its caller; a click on `mul rr, r4, r5` marking `n * fact(n - 1)` in the source and its states in the TM view; with the asm view restarted (`↺`) so its listing follows the run, a construct pinned in the source (`Mod-'`) bringing its instructions into view and keeping them there; and in Stage, the asm tab. A browser that has used the app before keeps its stored layout, which has no asm view: choose `reset preset` in the workspace menu first. Record what was looked at and anything that reads wrong; a finding goes to the whole-branch review, not into this task.

- [ ] **Step 3: Write the roadmap entry.** Append it at the end of the roadmap, as the entries before it are: a heading that says what the PR did and what its review found, what it built, what the prototype found, what the reviews found, what it did not close, and a VERIFICATION table in which every figure names the command that produced it — each run before the entry is committed. What it did not close includes, at least: the state diagram and the λ body moving onto `VirtualGrid` (the PR after this one; the λ body has neither the `ResizeObserver` nor the `mousedown` guard the other two grids carry, and its pin's scroll detaches following where the grid's holds it until the run moves — that PR decides each); a stored layout keeping no asm view, so a returning user sees one only after `reset preset` or `+ view` (§5.5 keeps every stored layout valid); the asm run's focus staying on the `halt`'s owner once a run has halted, where the TM view shows none; asm copies (part 5c, which widens `CopyLeg`); the running instruction's line in a copy's editor (§10); the source editor's focus mark following the focused view (§10); and the cost of compile's asm run on a program that never halts (amendment 16).

- [ ] **Step 4: Commit the entry**, as the last commit before the PR opens:

````text
Roadmap: Plan 7 part 5b — asm is the web app's third leg, with a view of its own
````

## Appendix: the probe behind amendment 16's timings

Spec amendment 16's figures — `compile` with and without the asm leg's run to the end, in the browser — came from this throwaway browser test, run once on the prototype and deleted. It is not part of any task. To repeat it: in a checkout of the commit before Task 5, run `cd web && pnpm run build:wasm` and copy the `pkg/` it writes at that checkout's root to this checkout's `web/pkg-base-probe/`; build this branch's into `pkg/` the same way; save the file below as `web/tests/browser/zz-compile-probe.test.ts`, and run `pnpm exec vitest run --project browser tests/browser/zz-compile-probe.test.ts`. The test fails on purpose, with its measurements as the message; delete it and `web/pkg-base-probe/` afterwards.

````ts
import { it } from 'vitest'
import initBase, { compile as compileBase } from '../../pkg-base-probe/redextape_wasm.js'
import initHead, { compile as compileHead } from '../../../pkg/redextape_wasm.js'

const PROGRAMS: [string, string][] = [
  ['sample', 'let x = 40; x + 2'],
  ['fact3', 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'],
  ['upto200', 'fn upto(n) { if n == 0 { nil } else { cons(n, upto(n - 1)) } } upto(200)'],
  ['overflow', 'let mut n = 1; while n > 0 { n = n + 1; } n'],
  ['loop100k', 'let mut n = 100000; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc'],
]
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number

it('probe: compile time, base against head', async () => {
  await initBase()
  await initHead()
  const out: Record<string, { base: number; head: number }> = {}
  for (const [name, src] of PROGRAMS) {
    const times = { base: [] as number[], head: [] as number[] }
    for (let round = 0; round < 7; round++) {
      for (const [arm, fn] of [['base', compileBase], ['head', compileHead]] as const) {
        const t0 = performance.now()
        const r = fn(src, 'unary') as { session: { free(): void } | null }
        times[arm].push(performance.now() - t0)
        r.session?.free()
      }
    }
    out[name] = { base: median(times.base), head: median(times.head) }
  }
  throw new Error(`PROBE ${JSON.stringify(out)}`)
}, 600_000)
````

The prototype's run, median of 7 alternating rounds, in milliseconds (`performance.now()`, whose readings came in steps of 0.1 ms):

| Program | Without the asm run | With it |
|---|---|---|
| `let x = 40; x + 2` | 0.4 | 0.3 |
| `fact(3)` | 1.9 | 1.9 |
| `upto(200)` | 1.8 | 1.8 |
| the runaway loop, 5,000,000 asm steps | 14.2 | 48.8 |
| a 100,000-iteration loop | 5.0 | 14.8 |
