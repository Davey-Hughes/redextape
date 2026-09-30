# Plan 7 part 6a-i — examples, the stored program and the first-load example — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the header an `examples ▾` menu whose pick replaces the program with an undo, keep the program and its encoding across reloads under `redextape.program`, open a first visit on `sum_to(5)`, and hold every example to what its manifest says each leg does — the first of [Plan 7 part 6a](../specs/2026-09-29-plan7-part6a-examples-and-links-design.md)'s two PRs, its §1 6a-i row: §4, §6, and 6a-i's parts of §7 and §8.

**Architecture:** Seven `.rxt` files and `examples.ts`'s manifest declare each example's title, description, value and how each leg's first recording stops under `unary`; a browser test runs each through the real session worker and holds every declaration. `program-store.ts` reads and writes `{ version: 1, text, encoding }`. `main.ts` opens on the stored program, or on the first-load example when nothing valid is stored, where it opened on `SAMPLE`; `compile.ts` stores the program where each compile posts. A refused write is reported once the program has changed, on the notice line's one resting state, which `unsaved.ts` words for the program, the copies or both. `examples ▾` is a native popover built from the manifest, and the controls gate widens to every form control and every header menu on the page.

**Tech Stack:** TypeScript (vanilla DOM, CodeMirror), Vite `?raw` imports, Vitest (node and browser projects, Playwright Chromium). No Rust.

## Global Constraints

- The spec is `docs/superpowers/specs/2026-09-29-plan7-part6a-examples-and-links-design.md` at `444c92c`. This plan is its §1 6a-i row; §5, share links, is 6a-ii's. Where this plan and the spec disagree, stop and ask.
- The manifest declares each leg's first-recording stop under the default encoding, `unary` — ended, history full or declined — and the examples test holds every one, amending umbrella §5 (spec row 12, §4.6). A pick sets `unary`, since the declarations are that encoding's (§4.5).
- `redextape.program` is `{ version: 1, text, encoding }`. Anything `parseProgram` refuses reads as a first visit, silently (§4.3, §7).
- The program has one write site, where a compile posts (§4.3). A refused write is reported only once the program has changed from what was loaded (row 17), on the notice line's one resting state, whose sentence names the program, the copies or both; each writer's success takes back only its own half. The copies' sentence is unchanged while only the copies fail.
- The browser tier's storage shim stores `let x = 40; x + 2` under `unary` for every file (§4.4).
- Umbrella §4's rules bind every control: named by its text or its `aria-label`, `▾` hidden from the name, reachable by keyboard, a gesture's result said in the one live region (§6).
- `web/` only: no Rust, no wasm change, no new dependency, and no build output the app imports.
- Doc comments are `/** */` in TypeScript. No `file:line` citations in tracked source (the pre-commit hook rejects them); they are normal in `docs/`. A possessive citation (`` `x.ts`'s `sym` ``) names the file that declares the symbol. No plan task numbers in shipped code.
- The pre-commit hook runs `biome ci --error-on-warnings`, `pnpm run typecheck` and the hygiene scans on every commit. Never `--no-verify`.
- No colour literal outside the palette's fallback block in `web/src/style.css` (the colour gate).
- **Keep to the regions this PR needs.** `web/src/style.css`'s `:root` block and the header's button rule are also changed by the `header-select-styling` branch, and `index.html`, `SHELL` and the controls gate by 6b (spec §6, row 15). Whichever lands second rebases onto the other's version.
- **Run one browser suite at a time**, each under `flock "$BROWSER_LOCK"` (below): two started together on one machine have hung. **Do not edit files a browser run is using**: Vite reloads the modules mid-run and the failures that follow are the edit's.
- **A sabotage run can write files of its own**: a failing browser test writes a screenshot under `web/tests/browser/__screenshots__/` (gitignored). After every sabotage, `git status` shows only what the task changed.

## How to use the code in this plan

**The code below is the prototype's, verbatim, and it was rebuilt from this document's own blocks before the plan was committed** (see Pre-flight status). Every change is a patch:

- Save the block to a file **outside the repository** (the session scratchpad) and run `git apply <that file>` from the repository root. A patch that does not apply means the tree has drifted from the state this plan was built against — this plan's own commit plus the tasks before it. Stop and report; do not hand-merge.
- Each task's **tests' half** goes in first, so the red step can be observed; then its **source half**. A new file appears in its patch whole (`new file mode`).
- The patches are fenced with four backticks, because some carry a doc comment's own three.

**Setup, once per worktree**, from `web/`: `pnpm install --frozen-lockfile` (a real install: where `web/node_modules` is a symlink to another checkout's, no web font loads, `fonts.test.ts` fails its cases and every text-geometry result differs), then `pnpm run build:wasm`, `pnpm run build:lsp-wasm` and `pnpm run build:bindings`. `PATH` must hold `/usr/sbin` (Chrome) and `$CARGO_HOME/bin` (wasm-pack); `CARGO_HOME` is `~/.local/share/cargo`. No task changes the wasm, so one build serves every task.

**`BROWSER_LOCK`** names the one lock file every browser run on the machine takes (the lane rules give its path); set it in the shell before the first browser step. Every command that starts vitest's browser project — a single file, the whole project, a sabotage run — is wrapped in `flock "$BROWSER_LOCK"`. The whole project runs under a memory cap:

    cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=24G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --working-directory="$PWD" pnpm exec vitest run --project browser

**24G, NOT 16G, AND WITHOUT `-q`.** This branch raises the whole browser project's peak on this machine: under a 24G cap it peaked at 14.3G and 15.6G on the replay's last commit, against 13.4G on `444c92c`, and one of the replay's runs under 16G was killed with no summary printed. Without `-q`, a kill ends the output with `Finished with result: oom-kill` rather than stopping mid-list.

**A sabotage** is run one at a time: save a copy of the file outside the repository, make the one replacement the table gives (`⏎` is a newline in it), run the whole test files its row names — never with `-t`, which skips a shared mount's earlier cases — then restore the file from the copy, `cmp` the two, and check that `git status` shows only the task's changes. Never restore with `git checkout`, which also wipes the task's uncommitted work. The *Fails* column is what that run failed in the replay; a sabotage that fails nothing is a finding to report, not a row to drop.

**Stage before running a hygiene scan by hand.** `check-attributions` resolves a citation against *tracked* files, so a new file that is not yet `git add`ed reads as missing. The hook runs on the staged commit, where that cannot happen.

## Pre-flight status

**Every task was built, gated and sabotaged before this plan was written**, in a scratch worktree on branch `plan7-part6a-proto` off `444c92c`, the spec's head, whose head is `c79f7c0`; 6a-ii's plan builds on that head. It was then rebuilt task by task from this document's own code blocks on a fresh worktree at `444c92c`, which differs from this plan's commit only in `docs/`, as an executor would. Each task's tests' half was applied and its red steps run as written, then its source half; the tree was compared with the prototype's task commit, `docs/` aside; its green steps were run as written and it was committed through the pre-commit hook; and every sabotage in its table was run, one at a time, restored after each. Every *Expected* block below is what that run printed, and every *Fails* column is what that sabotage failed there.

| Task | Tree against the prototype | Red step | Green steps and hook | Sabotages fired |
|---|---|---|---|---|
| 1 | IDENTICAL | both files failed to load | passed | 10 of 10 |
| 2 | IDENTICAL | failed to load | passed | 6 of 6 |
| 3 | IDENTICAL | 8 of 9 tests failed | passed | 10 of 10, sabotage 10 on its second run |
| 4 | IDENTICAL | the node file failed to load; 2 of 4 browser tests failed | passed | 8 of 8 |
| 5 | IDENTICAL | 1 of 7 node tests failed; 11 of 26 browser tests failed | passed, the whole browser project on its second run | 19 of 19 |

**53 sabotages were run, one at a time; 53 fired.** Each task's table lists what each one failed.

**What replaying this plan found, before it was committed:**

1. **Two whole-project browser runs stopped short the first time.** Task 3's sabotage 10 printed no report: its output stopped while Vite re-optimized its dependencies, before a test ran. Task 5's green run, then under a 16G cap with `-q`, stopped part-way through the list with no summary, which is what a kill at the cap looks like under `-q`. Run again, sabotage 10 at Task 3's own commit failed 2 of 818, as in the prototype, and the green run passed, at 15.6G under 16G without `-q` and at 18.0G under 24G.
2. **This branch raises the whole browser project's peak, so its command is 24G and prints its end.** Under 24G, the whole project on `444c92c` peaked at 13.4G, 13.3G and 11.2G in three runs; on the replay's last commit at 14.3G and 18.0G, and at 15.6G under 16G. Run alone, each new browser file peaked at 0.97G to 1.3G, against 0.96G for `strip.test.ts`, so no one file carries the rise. The command above is 24G, without `-q`, since; Tasks 1, 3 and 4's green steps had already run under 16G with `-q` and printed the lines quoted, and Task 5's is its 24G run.
3. **The coverage run at the lane rules' 16G was killed on the replay's last commit as on the prototype's head**, and passed with `--maxWorkers=4` under the same cap. Task 6 records both.

**What the prototype found, all answered in the code below:**

1. **The widened gate refused the first example's name, and the spec did not foresee it.** An example is named `${title} ${description}` (spec §4.2), and the first title is `let x = 40; x + 2` (§4.1). `=` is Unicode's `Sm`, and the gate's `straySymbol` allowed only `+` in a name, so every state's header-menu case failed on it. The spec's title is kept and the gate lets `=` through as it lets `+` through, for program text (Task 5, sabotage 18). **This is a decision the spec did not make, and the user may prefer another** — retitling the example in words, or scoping the exemption to an example's title.
2. **The gate would have passed with `examples ▾` wired to nothing.** The button carries `aria-controls` in the markup, so the header-menu walk found it, clicked it, opened nothing and walked nothing. The case now asserts that each menu it clicks opens (Task 5, sabotage 19), which is also what makes Task 5's red step fail there.
3. **An item's `aria-label` could be removed with nothing failing.** Its two spans are `display: block`, so the name computed from its content is the same `${title} ${description}` the label gives. The label is what keeps the name from hanging on the stylesheet (§4.2), so the menu test reads the attribute itself (Task 5, sabotage 7), and the geometry test holds the two lines apart (sabotage 9).
4. **The language server's first text had no test.** Giving it the first-load example's text whatever was stored failed nothing, so `program-restore.test.ts`'s stored program has a function and the source outline must list it (Task 3, sabotage 8).
5. **A copy's editor stores what its printer writes**: `(\x. x)` is stored as `(λx. x)`. `program-quota.test.ts` writes its copy in `λ` so the write it waits for is the one it made.
6. **The shim is load-bearing for two of the suite's cases.** Without it, `colour.test.ts`'s two cases fail (Task 3, sabotage 10), of 818; the other files that type no program of their own pass on `sum_to(5)`. A file that clears storage before its mount starts on the example too: `divider-drag.test.ts` does, types no program, and passes.
7. **The changed-guard compares, rather than latching on a gesture.** Row 17 reports a refused write "once the program has changed from what was loaded: typed, a picked example, or an opened link". The writer compares the text and encoding it is given with the loaded ones, so an encoding change counts as a change, an edit undone within one pause never does, and re-picking the example already loaded does not. **This is a reading of row 17 the user may want to confirm.**
8. **Undo owes the focus somewhere, and the spec does not say where.** `notice.ts` tears the button down before running the action, as a delete's undo records, so the undo of a pick puts the focus in the source editor, where the program came back (Task 5, sabotage 6). The spec's §6 names no place.
9. **`buffers-quota-empty.test.ts` is green and blind**, outside this plan: it asserts `#link-status` is empty, but the copies' report moved to the notice line in Plan 7 part 2, so a false report would pass it. `program-quota.test.ts` reads the notice line and the live region instead. Not fixed here.
10. **The coverage run is killed at the lane rules' 16G cap, on this machine, on the base as well.** The prototype's head was killed at 16G twice — with the default workers and with `--maxWorkers=4` — and under a 24G cap peaked at 15.6G and 16.6G in two runs; the base, `444c92c`, peaked at 14.3G and 16.7G under the same cap. Task 6 records the run it gets.

**Verified fixtures**, each measured by running it — every figure below is one a test in this plan asserts:

| Fixture | Where | Measured |
|---|---|---|
| the seven examples under `unary`, through a fresh `session-worker.ts` | Task 1 | each leg stops as the spec's §2.7 table has it: `let x = 40; x + 2`, `is_even(6)` and `sum_to(5)` end on every leg; the closure's and `map`/`fold`'s TM legs fill their history; `fact(4)`'s λ fills its history; `fact(12)`'s λ fills its history and its TM leg is declined. Values 42, 42, true, 24, 9, 15, 479001600 |
| `sum_to(5)` as the first-load example | Tasks 3, 4 | the strip's three segments start `λ 15`, `asm 15` and `TM 15` |
| `fn times4(y) {…} times4(5)` stored under `binary` | Task 3 | opens under `binary`; its λ segment starts `λ 20`; the source outline lists `times4` |
| `{ version: 1, …, encoding: 'ternary' }` stored | Task 3 | refused: the page opens on `sum_to(5)` under `unary` and the notice line stays hidden |
| a λ copy `(λx. x) (λy. y)` stored and bound to `lambda-0` | Task 4 | restored with its editor; an edit to `(λz. z) (λy. y)` is written back in that form |
| `fact(4)` picked after a compile under `binary` | Task 5 | the picker reads `unary`, the strip's asm segment starts `asm 24`; undo puts back `binary` and `let x = 40; x + 2`, whose λ segment starts `λ 42` |

## File structure

**Created**

| File | Task | Responsibility |
|---|---|---|
| `web/src/examples/{arithmetic,closure,is-even,fact,map-fold,sum-to,fact-12}.rxt` | 1 | the seven examples' texts, as `redextape fmt` leaves them (spec §A.1) |
| `web/src/examples.ts` | 1 | the manifest, in menu order: id, title, description, text, value, and each leg's declared stop; `EXAMPLE_ENCODING`; `FIRST_LOAD` |
| `web/src/program-store.ts` | 2 | `redextape.program`: its key, version, writer and validating reader |
| `web/src/unsaved.ts` | 4 | the resting line's sentence for the program, the copies or both, and which is failing |
| `web/tests/node/examples.test.ts`, `web/tests/browser/examples.test.ts` | 1 | the manifest against its files; each example through the real worker |
| `web/tests/node/program-store.test.ts` | 2 | the round trip and every refusal |
| `web/tests/browser/first-load.test.ts`, `program-restore.test.ts`, `program-restore-invalid.test.ts` | 3 | a first load with nothing stored, with a program stored, and with one the app refuses |
| `web/tests/node/unsaved.test.ts`, `web/tests/browser/program-quota.test.ts` | 4 | the sentence and its halves; a refused program write in the app |
| `web/tests/browser/examples-menu.test.ts` | 5 | the menu by pointer and by keys, a pick and its undo |

**Modified**

| File | Task | What changes |
|---|---|---|
| `web/src/compile.ts` | 3 | `persist`, called where a compile posts |
| `web/src/main.ts` | 3, 4, 5 | `loaded`, the start-up program, in `SAMPLE`'s three places; `writeProgramStorage`; `unsaved` in both writers and the changed-guard; `replaceProgram`, `openExample` and the menu's wiring |
| `web/tests/browser/setup.ts` | 3 | stores `let x = 40; x + 2` for every file |
| `web/tests/browser/tm-buffer-restore.test.ts`, `scratch-fork.test.ts` | 3 | two comments that named the deleted `SAMPLE` |
| `web/index.html`, `web/tests/browser/harness.ts`, `web/tests/node/harness.test.ts` | 5 | `examples ▾` and its popover, after `copies ▾`, in the page and in `SHELL`; the two ids |
| `web/src/app-header.ts` | 5 | `exampleItems` |
| `web/src/style.css` | 5 | `#examples` joins the header buttons' rule; the menu's two-line items |
| `web/tests/browser/controls-gate.test.ts` | 5 | the widening (spec §6, row 15) |

**What 6a-ii builds on**: `examples.ts`'s `EXAMPLE_ENCODING`; `program-store.ts`'s `StoredProgram`, `parseProgram`; `main.ts`'s `loaded`, `replaceProgram(program: StoredProgram)`, `programChanged`, `unsaved`; the gate's `controls()`, `formLabel` and header-menu case, which 6a-ii's `#share` joins by being in the header.

---

### Task 1: The seven examples and their manifest, held by the examples test

**Files:**
- Create: `web/src/examples/arithmetic.rxt`, `closure.rxt`, `is-even.rxt`, `fact.rxt`, `map-fold.rxt`, `sum-to.rxt`, `fact-12.rxt` (spec §A.1's texts); `web/src/examples.ts`
- Test: `web/tests/node/examples.test.ts`, `web/tests/browser/examples.test.ts`

**Interfaces:**
- Produces `examples.ts`'s `type Outcome = 'ended' | 'history-full' | 'declined'`; `type Example = { id: string; title: string; description: string; text: string; value: string; outcomes: Readonly<Record<Leg, Outcome>> }` (all `readonly`); `EXAMPLE_ENCODING = 'unary'`; `EXAMPLES: readonly Example[]` in menu order; `FIRST_LOAD: Example`, the `sum-to` entry itself.

**EACH TEXT IS A FILE, IMPORTED WITH `?raw` AS `colour.ts` IMPORTS ITS QUERIES** (spec §4.1), so a missing file fails the build. The files are §A.1's `EXAMPLES`, byte for byte, which `redextape --no-config fmt` wrote. An example's id is its file's name.

**THE EXAMPLES TEST HOLDS WHAT A USER SEES ON PICKING ONE** (§4.6): one `run` per example under `unary` to a fresh session worker, as `worker.test.ts` asks it, every reply until `result`. A leg is *declined* when `compiled` says it is unavailable, and *ended* or *history full* by its last frames reply's `done`. Every leg that ends carries the manifest's value; so does a TM or asm leg whose history fills, since `compile` runs those two to their end; a λ leg whose history fills reads `Unfinished`. Each example is a `describe` of its own whose `beforeAll` runs it, so an outcome that fails does not hide its value.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=1
diff --git a/web/tests/browser/examples.test.ts b/web/tests/browser/examples.test.ts
new file mode 100644
index 0000000..3574d37
--- /dev/null
+++ b/web/tests/browser/examples.test.ts
@@ -0,0 +1,99 @@
+import { beforeAll, describe, expect, it } from 'vitest'
+import { EXAMPLE_ENCODING, EXAMPLES, type Example, type Outcome } from '../../src/examples'
+import { LEGS } from '../../src/legs'
+import type { Leg, RecordEnd, RunReply } from '../../src/protocol'
+
+/**
+ * **EVERY EXAMPLE DOES WHAT THE MANIFEST SAYS IT DOES** — Plan 7 part 6a spec §4.6, which amends umbrella §5's "λ and
+ * TM agree on its value within budget". Under the app's own history budget that cannot hold for `fact(4)` and
+ * `fact(12)`, whose λ legs fill their history before a value, so the manifest declares how each leg's first recording
+ * stops and this holds every declaration: an example cannot rot unnoticed, and its description cannot drift from what
+ * it does.
+ *
+ * **THE REAL WORKER, ONE `run` PER EXAMPLE**, as `worker.test.ts` asks it: a fresh `session-worker.ts`, the example's
+ * text under the default encoding, every reply until `result`. A declined leg is one `compiled` says is unavailable;
+ * an ended leg and a leg whose history fills are its last frames reply's `done`, `ended` or `budget`.
+ *
+ * **THE MARGINS ARE NARROW IN PLACES, AND A FAILURE HERE CAN BE A TRUE ONE.** The closure's unary TM records 73,958 of
+ * its 79,307 steps before its history fills (spec §2.7). A change in a TM frame's size can flip it to *ended*; the
+ * manifest's outcome and the example's description then change together.
+ */
+
+type Compiled = Extract<RunReply, { kind: 'compiled' }>
+type Result = Extract<RunReply, { kind: 'result' }>
+
+/** What one run said: whether each leg was built, how each leg's first recording stopped, and the run's values. */
+type Heard = { readonly compiled: Compiled; readonly done: Record<Leg, RecordEnd | null>; readonly result: Result }
+
+/** Bounded below vitest's 30 s hook timeout, so a run that never answers is named here rather than by vitest. */
+const RUN_MS = 20_000
+
+function run(example: Example): Promise<Heard> {
+  const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
+  const done: Record<Leg, RecordEnd | null> = { lambda: null, asm: null, tm: null }
+  let compiled: Compiled | null = null
+  return new Promise((resolve, reject) => {
+    const timer = setTimeout(() => {
+      worker.terminate()
+      reject(new Error(`${example.id}: no result after ${RUN_MS} ms`))
+    }, RUN_MS)
+    const end = (settle: () => void): void => {
+      clearTimeout(timer)
+      worker.terminate()
+      settle()
+    }
+    worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
+      const r = e.data
+      if (r.kind === 'compiled') compiled = r
+      else if (r.kind === 'lambda-frames') done.lambda = r.done
+      else if (r.kind === 'asm-frames') done.asm = r.done
+      else if (r.kind === 'tm-frames') done.tm = r.done
+      else if (r.kind === 'result') {
+        const c = compiled
+        end(() =>
+          c === null
+            ? reject(new Error(`${example.id}: a result with no compiled`))
+            : resolve({ compiled: c, done, result: r }),
+        )
+      } else if (r.kind === 'no-session' || r.kind === 'worker-error') {
+        end(() => reject(new Error(`${example.id}: ${r.kind}`)))
+      }
+    })
+    worker.postMessage({ kind: 'run', gen: 1, src: example.text, encoding: EXAMPLE_ENCODING })
+  })
+}
+
+/** How a leg's first recording stopped, in the manifest's words, or what it did instead. */
+function stopOf(heard: Heard, leg: Leg): Outcome | string {
+  if (!heard.compiled[leg].available) return 'declined'
+  const done = heard.done[leg]
+  if (done === 'ended') return 'ended'
+  if (done === 'budget') return 'history-full'
+  return `stopped on ${done}`
+}
+
+describe.each(EXAMPLES)('$title', (example) => {
+  let heard: Heard
+
+  beforeAll(async () => {
+    heard = await run(example)
+  })
+
+  it('stops each leg where the manifest says', () => {
+    expect({ lambda: stopOf(heard, 'lambda'), asm: stopOf(heard, 'asm'), tm: stopOf(heard, 'tm') }).toEqual(
+      example.outcomes,
+    )
+  })
+
+  it("carries the manifest's value on every leg with a value to carry", () => {
+    for (const leg of LEGS) {
+      const value = heard.result[leg].value
+      if (example.outcomes[leg] === 'declined') expect(value, leg).toBeNull()
+      // A λ LEG THAT FILLS ITS HISTORY HAS NOTHING TO HOLD: it has not reached its normal form.
+      else if (leg === 'lambda' && example.outcomes[leg] === 'history-full') expect(value, leg).toBe('Unfinished')
+      // AN ENDED LEG, AND A TM OR ASM LEG WHOSE HISTORY FILLS: `compile` runs those two legs to their end, so both
+      // carry the run's own value, and the legs that end agree on it.
+      else expect(value, leg).toEqual({ Value: { text: example.value } })
+    }
+  })
+})
diff --git a/web/tests/node/examples.test.ts b/web/tests/node/examples.test.ts
new file mode 100644
index 0000000..0ed32af
--- /dev/null
+++ b/web/tests/node/examples.test.ts
@@ -0,0 +1,52 @@
+import { readdirSync, readFileSync } from 'node:fs'
+import { fileURLToPath } from 'node:url'
+import { describe, expect, it } from 'vitest'
+import { EXAMPLES, FIRST_LOAD } from '../../src/examples'
+import { LEGS } from '../../src/legs'
+
+/**
+ * The examples' manifest (Plan 7 part 6a spec §8's node row): every file served and served whole, one entry per id,
+ * the first-load example among them, and an outcome for every leg. What each example DOES is the browser tier's
+ * `examples.test.ts`, which runs them.
+ */
+
+const DIR = fileURLToPath(new URL('../../src/examples/', import.meta.url))
+
+describe('the examples manifest', () => {
+  it('serves every file in src/examples, and nothing that is not one', () => {
+    const files = readdirSync(DIR)
+      .filter((f) => f.endsWith('.rxt'))
+      .map((f) => f.slice(0, -'.rxt'.length))
+    expect(files.length).toBe(7)
+    expect(EXAMPLES.map((e) => e.id).sort()).toEqual(files.sort())
+  })
+
+  it('serves each file as the file holds it', () => {
+    for (const e of EXAMPLES) expect(e.text, e.id).toBe(readFileSync(`${DIR}${e.id}.rxt`, 'utf8'))
+  })
+
+  it('names each example once, by id and by title', () => {
+    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length)
+    expect(new Set(EXAMPLES.map((e) => e.title)).size).toBe(EXAMPLES.length)
+  })
+
+  it('opens a first visit on an entry of the menu: sum_to(5)', () => {
+    expect(EXAMPLES).toContain(FIRST_LOAD)
+    expect(FIRST_LOAD.id).toBe('sum-to')
+  })
+
+  it('declares how every leg of every example stops', () => {
+    for (const e of EXAMPLES) {
+      expect(Object.keys(e.outcomes).sort(), e.id).toEqual([...LEGS].sort())
+      for (const leg of LEGS) expect(['ended', 'history-full', 'declined'], `${e.id} ${leg}`).toContain(e.outcomes[leg])
+    }
+  })
+
+  it('describes each example in one line', () => {
+    for (const e of EXAMPLES) {
+      expect(e.title, e.id).not.toBe('')
+      expect(e.description, e.id).not.toBe('')
+      expect(e.description, e.id).not.toContain('\n')
+    }
+  })
+})
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/examples.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  no tests
```

The file does not load: `Error: Cannot find module '../../src/examples' imported from tests/node/examples.test.ts`

Run: `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  no tests
```

The file does not load: `Failed to resolve import "../../src/examples" from "tests/browser/examples.test.ts". Does the file exist?`

- [ ] **Step 3: Write the code.**

````diff apply=source task=1
diff --git a/web/src/examples.ts b/web/src/examples.ts
new file mode 100644
index 0000000..1198293
--- /dev/null
+++ b/web/src/examples.ts
@@ -0,0 +1,106 @@
+import arithmetic from './examples/arithmetic.rxt?raw'
+import closure from './examples/closure.rxt?raw'
+import fact from './examples/fact.rxt?raw'
+import fact12 from './examples/fact-12.rxt?raw'
+import isEven from './examples/is-even.rxt?raw'
+import mapFold from './examples/map-fold.rxt?raw'
+import sumTo from './examples/sum-to.rxt?raw'
+import type { Leg } from './protocol'
+
+/**
+ * THE EXAMPLES — Plan 7 part 6a spec §4.1: the programs `examples ▾` offers, in its order, and what each one's legs
+ * do when it is picked.
+ *
+ * **EACH TEXT IS A FILE, IMPORTED WITH `?raw` AS `colour.ts` IMPORTS ITS QUERIES**, so a missing file fails the build
+ * rather than the menu. Each is written as `redextape fmt` leaves it.
+ *
+ * **THE OUTCOMES ARE THE DEFAULT ENCODING'S, AND A PICK SETS IT** (spec §4.5, row 12). A description says where a leg
+ * stops early, because that is what the user sees on picking it — and under `binary` several of them would say
+ * something else: `fact(12)`'s TM leg is declined under `unary` and runs under `binary`. `examples.test.ts` in the
+ * browser tier runs each example through the real session worker and holds every outcome and value declared here.
+ */
+
+/**
+ * How a leg's first recording stops under `EXAMPLE_ENCODING`: at the end of the run, with its history full
+ * (`budget`, which the readout calls *history full*), or before it starts, because the leg declined the program.
+ */
+export type Outcome = 'ended' | 'history-full' | 'declined'
+
+export type Example = {
+  /** The file's name without `.rxt`, and the menu item's `data-example`. */
+  readonly id: string
+  readonly title: string
+  /** One line, under the title: what the example shows, and where a leg stops early. */
+  readonly description: string
+  readonly text: string
+  /** The value every leg that ends agrees on, as the readout prints it. */
+  readonly value: string
+  readonly outcomes: Readonly<Record<Leg, Outcome>>
+}
+
+/** The encoding the outcomes are declared under, and the one a pick and a first visit set: the picker's first. */
+export const EXAMPLE_ENCODING = 'unary'
+
+const SUM_TO: Example = {
+  id: 'sum-to',
+  title: 'sum_to(5)',
+  description: 'a while loop adding 5 down to 1; every leg ends at 15',
+  text: sumTo,
+  value: '15',
+  outcomes: { lambda: 'ended', asm: 'ended', tm: 'ended' },
+}
+
+export const EXAMPLES: readonly Example[] = [
+  {
+    id: 'arithmetic',
+    title: 'let x = 40; x + 2',
+    description: 'a binding and a sum; every leg ends at 42',
+    text: arithmetic,
+    value: '42',
+    outcomes: { lambda: 'ended', asm: 'ended', tm: 'ended' },
+  },
+  {
+    id: 'closure',
+    title: 'a closure',
+    description: 'a function that captures n; the TM’s history fills before it halts',
+    text: closure,
+    value: '42',
+    outcomes: { lambda: 'ended', asm: 'ended', tm: 'history-full' },
+  },
+  {
+    id: 'is-even',
+    title: 'is_even(6)',
+    description: 'two functions calling each other; every leg ends at true',
+    text: isEven,
+    value: 'true',
+    outcomes: { lambda: 'ended', asm: 'ended', tm: 'ended' },
+  },
+  {
+    id: 'fact',
+    title: 'fact(4)',
+    description: 'recursion, where λ fills its history before its value',
+    text: fact,
+    value: '24',
+    outcomes: { lambda: 'history-full', asm: 'ended', tm: 'ended' },
+  },
+  {
+    id: 'map-fold',
+    title: 'map and fold',
+    description: 'functions passed as values over a list; the TM’s history fills before it halts',
+    text: mapFold,
+    value: '9',
+    outcomes: { lambda: 'ended', asm: 'ended', tm: 'history-full' },
+  },
+  SUM_TO,
+  {
+    id: 'fact-12',
+    title: 'fact(12)',
+    description: 'each leg stops differently: λ fills its history, the unary TM cannot fit the value, asm ends',
+    text: fact12,
+    value: '479001600',
+    outcomes: { lambda: 'history-full', asm: 'ended', tm: 'declined' },
+  },
+]
+
+/** The example a first visit opens on (spec row 3): every one of its legs ends under the default encoding. */
+export const FIRST_LOAD: Example = SUM_TO
diff --git a/web/src/examples/arithmetic.rxt b/web/src/examples/arithmetic.rxt
new file mode 100644
index 0000000..691b5f4
--- /dev/null
+++ b/web/src/examples/arithmetic.rxt
@@ -0,0 +1,2 @@
+let x = 40;
+x + 2
diff --git a/web/src/examples/closure.rxt b/web/src/examples/closure.rxt
new file mode 100644
index 0000000..794247d
--- /dev/null
+++ b/web/src/examples/closure.rxt
@@ -0,0 +1,3 @@
+let n = 2;
+let add_n = |x| x + n;
+add_n(40)
diff --git a/web/src/examples/fact-12.rxt b/web/src/examples/fact-12.rxt
new file mode 100644
index 0000000..4d98bda
--- /dev/null
+++ b/web/src/examples/fact-12.rxt
@@ -0,0 +1,8 @@
+fn fact(n) {
+    if n == 0 {
+        1
+    } else {
+        n * fact(n - 1)
+    }
+}
+fact(12)
diff --git a/web/src/examples/fact.rxt b/web/src/examples/fact.rxt
new file mode 100644
index 0000000..4064ba2
--- /dev/null
+++ b/web/src/examples/fact.rxt
@@ -0,0 +1,8 @@
+fn fact(n) {
+    if n == 0 {
+        1
+    } else {
+        n * fact(n - 1)
+    }
+}
+fact(4)
diff --git a/web/src/examples/is-even.rxt b/web/src/examples/is-even.rxt
new file mode 100644
index 0000000..7e54494
--- /dev/null
+++ b/web/src/examples/is-even.rxt
@@ -0,0 +1,15 @@
+fn is_even(n) {
+    if n == 0 {
+        true
+    } else {
+        is_odd(n - 1)
+    }
+}
+fn is_odd(n) {
+    if n == 0 {
+        false
+    } else {
+        is_even(n - 1)
+    }
+}
+is_even(6)
diff --git a/web/src/examples/map-fold.rxt b/web/src/examples/map-fold.rxt
new file mode 100644
index 0000000..1514c1f
--- /dev/null
+++ b/web/src/examples/map-fold.rxt
@@ -0,0 +1,21 @@
+fn map(xs, f) {
+    if is_empty(xs) {
+        nil
+    } else {
+        cons(f(head(xs)), map(tail(xs), f))
+    }
+}
+fn fold(xs, acc, f) {
+    if is_empty(xs) {
+        acc
+    } else {
+        fold(tail(xs), f(acc, head(xs)), f)
+    }
+}
+fn add(a, b) {
+    a + b
+}
+fn add1(x) {
+    x + 1
+}
+fold([3, 1, 2].map(add1), 0, add)
diff --git a/web/src/examples/sum-to.rxt b/web/src/examples/sum-to.rxt
new file mode 100644
index 0000000..72dcec5
--- /dev/null
+++ b/web/src/examples/sum-to.rxt
@@ -0,0 +1,9 @@
+fn sum_to(n) {
+    let mut acc = 0;
+    while n > 0 {
+        acc = acc + n;
+        n = n - 1;
+    }
+    acc
+}
+sum_to(5)
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  54 passed (54)
Tests  770 passed (770)
```

Run: `cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=24G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --working-directory="$PWD" pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  122 passed (122)
Tests  809 passed (809)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command; after each, `git status` shows only this task's changes). In the replay, 10 of 10 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | the closure's unary TM declared *ended* (spec §8's own) — `examples.ts`: `outcomes: { lambda: 'ended', asm: 'ended', tm: 'history-full' },` → `outcomes: { lambda: 'ended', asm: 'ended', tm: 'ended' },` (its first occurrence of two) | `cd web && pnpm exec vitest run --project node tests/node/examples.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples.test.ts` | `tests/browser/examples.test.ts > 'a closure' > stops each leg where the manifest says` |
| 2 | `sum_to(5)`'s value declared wrong — `examples.ts`: `value: '15',` → `value: '14',` | `cd web && pnpm exec vitest run --project node tests/node/examples.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples.test.ts` | `tests/browser/examples.test.ts > 'sum_to(5)' > carries the manifest's value on every leg with a value to carry` |
| 3 | `fact(4)`'s file runs `fact(3)`, whose λ ends — `examples/fact.rxt`: `fact(4)` → `fact(3)` | `cd web && pnpm exec vitest run --project node tests/node/examples.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples.test.ts` | `tests/browser/examples.test.ts > 'fact(4)' > stops each leg where the manifest says`, `tests/browser/examples.test.ts > 'fact(4)' > carries the manifest's value on every leg with a value to carry` |
| 4 | `fact(12)`'s unary TM declared *ended* — `examples.ts`: `tm: 'declined'` → `tm: 'ended'` | `cd web && pnpm exec vitest run --project node tests/node/examples.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples.test.ts` | `tests/browser/examples.test.ts > 'fact(12)' > stops each leg where the manifest says`, `tests/browser/examples.test.ts > 'fact(12)' > carries the manifest's value on every leg with a value to carry` |
| 5 | an example missing from the menu — `examples.ts`: `  SUM_TO, ⏎ ` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/examples.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples.test.ts` | `tests/node/examples.test.ts > the examples manifest > serves every file in src/examples, and nothing that is not one`, `tests/node/examples.test.ts > the examples manifest > opens a first visit on an entry of the menu: sum_to(5)` |
| 6 | an entry served another file's text — `examples.ts`: `import closure from './examples/closure.rxt?raw'` → `import closure from './examples/arithmetic.rxt?raw'` | `cd web && pnpm exec vitest run --project node tests/node/examples.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples.test.ts` | `tests/node/examples.test.ts > the examples manifest > serves each file as the file holds it`, `tests/browser/examples.test.ts > 'a closure' > stops each leg where the manifest says` |
| 7 | the first-load example not an entry of the menu — `examples.ts`: `export const FIRST_LOAD: Example = SUM_TO` → `export const FIRST_LOAD: Example = { ...SUM_TO }` | `cd web && pnpm exec vitest run --project node tests/node/examples.test.ts` | `tests/node/examples.test.ts > the examples manifest > opens a first visit on an entry of the menu: sum_to(5)` |
| 8 | two entries share an id — `examples.ts`: `id: 'is-even',` → `id: 'fact',` | `cd web && pnpm exec vitest run --project node tests/node/examples.test.ts` | `tests/node/examples.test.ts > the examples manifest > serves every file in src/examples, and nothing that is not one`, `tests/node/examples.test.ts > the examples manifest > serves each file as the file holds it`, `tests/node/examples.test.ts > the examples manifest > names each example once, by id and by title` |
| 9 | an example with no outcome for one leg — `examples.ts`: `outcomes: { lambda: 'history-full', asm: 'ended', tm: 'ended' },` → `outcomes: { lambda: 'history-full', tm: 'ended' } as Example['outcomes'],` | `cd web && pnpm exec vitest run --project node tests/node/examples.test.ts` | `tests/node/examples.test.ts > the examples manifest > declares how every leg of every example stops` |
| 10 | a description on two lines — `examples.ts`: `'a binding and a sum; every leg ends at 42'` → `'a binding and a sum;\nevery leg ends at 42'` | `cd web && pnpm exec vitest run --project node tests/node/examples.test.ts` | `tests/node/examples.test.ts > the examples manifest > describes each example in one line` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
The seven examples and their manifest, held by the examples test

Seven programs in `web/src/examples/`, each as `redextape fmt` leaves
it, and `examples.ts`'s manifest in menu order: per example its id,
title, one-line description, text, value, and how each leg's first
recording stops under the default encoding — ended, history full, or
declined. `FIRST_LOAD` is `sum_to(5)`. The browser tier's examples test
runs each through the real session worker and holds every declared
stop and value (spec §4.6, amending umbrella §5); the node test holds
the manifest to the files.
````

---

### Task 2: `redextape.program`: the program's store, versioned and validated

**Files:**
- Create: `web/src/program-store.ts`
- Test: `web/tests/node/program-store.test.ts`

**Interfaces:**
- Produces `program-store.ts`'s `PROGRAM_STORAGE_KEY = 'redextape.program'`; `PROGRAM_VERSION = 1`; `type StoredProgram = { readonly text: string; readonly encoding: string }`; `serializeProgram(program: StoredProgram): string`; `parseProgram(raw: string | null, encodings: readonly string[]): StoredProgram | null`.

**THE ENCODINGS ARE A PARAMETER** (spec §4.3), so the reader needs no wasm and its tests run in node; `main.ts` hands in `encodings()` in Task 3. `parseProgram` answers `null` for a missing key, text that is not JSON or JSON that is not an object, another version, a `text` that is not a string, and an `encoding` not among those handed in — the refusals `buffers-store.ts`'s `parseBuffers` makes, on its terms.

- [ ] **Step 1: Write the failing test.**

````diff apply=tests task=2
diff --git a/web/tests/node/program-store.test.ts b/web/tests/node/program-store.test.ts
new file mode 100644
index 0000000..b54743c
--- /dev/null
+++ b/web/tests/node/program-store.test.ts
@@ -0,0 +1,52 @@
+import { describe, expect, it } from 'vitest'
+import { PROGRAM_VERSION, parseProgram, type StoredProgram, serializeProgram } from '../../src/program-store'
+
+/** The encodings `main.ts` hands in, as `encodings()` lists them today. */
+const ENCODINGS = ['unary', 'binary']
+
+const PROGRAM: StoredProgram = { text: 'let x = 40;\nx + 2\n', encoding: 'binary' }
+
+/** A raw value with `fields` merged over a valid one — the shape a hand-edit produces. */
+const raw = (fields: Record<string, unknown>): string =>
+  JSON.stringify({ version: PROGRAM_VERSION, ...PROGRAM, ...fields })
+
+describe('parseProgram', () => {
+  it('round-trips a program: its text, whatever it holds, and its encoding', () => {
+    expect(parseProgram(serializeProgram(PROGRAM), ENCODINGS)).toEqual(PROGRAM)
+    const odd: StoredProgram = { text: '', encoding: 'unary' }
+    expect(parseProgram(serializeProgram(odd), ENCODINGS)).toEqual(odd)
+  })
+
+  it('writes version 1, the text and the encoding, and nothing else', () => {
+    expect(JSON.parse(serializeProgram(PROGRAM))).toEqual({ version: 1, text: PROGRAM.text, encoding: 'binary' })
+  })
+
+  it('answers null for nothing stored', () => {
+    expect(parseProgram(null, ENCODINGS)).toBeNull()
+  })
+
+  it('answers null for text that is not JSON, or JSON that is not an object', () => {
+    expect(parseProgram('{"version": 1, "text"', ENCODINGS)).toBeNull()
+    expect(parseProgram('null', ENCODINGS)).toBeNull()
+    expect(parseProgram('"let x = 1"', ENCODINGS)).toBeNull()
+  })
+
+  it('answers null for another version, or none', () => {
+    expect(parseProgram(raw({ version: 2 }), ENCODINGS)).toBeNull()
+    expect(parseProgram(raw({ version: '1' }), ENCODINGS)).toBeNull()
+    expect(parseProgram(JSON.stringify(PROGRAM), ENCODINGS)).toBeNull()
+  })
+
+  it('answers null for a text that is not a string', () => {
+    expect(parseProgram(raw({ text: 42 }), ENCODINGS)).toBeNull()
+    expect(parseProgram(raw({ text: null }), ENCODINGS)).toBeNull()
+  })
+
+  it('answers null for an encoding the build does not offer', () => {
+    expect(parseProgram(raw({ encoding: 'ternary' }), ENCODINGS)).toBeNull()
+    expect(parseProgram(raw({ encoding: 1 }), ENCODINGS)).toBeNull()
+    expect(parseProgram(raw({ encoding: undefined }), ENCODINGS)).toBeNull()
+    // THE LIST IS THE ONE HANDED IN, NOT A LIST OF ITS OWN: an encoding a build stops offering is refused.
+    expect(parseProgram(raw({}), ['unary'])).toBeNull()
+  })
+})
````

- [ ] **Step 2: Run it and see it fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/program-store.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  no tests
```

The file does not load: `Error: Cannot find module '../../src/program-store' imported from tests/node/program-store.test.ts`

- [ ] **Step 3: Write the code.**

````diff apply=source task=2
diff --git a/web/src/program-store.ts b/web/src/program-store.ts
new file mode 100644
index 0000000..344a59a
--- /dev/null
+++ b/web/src/program-store.ts
@@ -0,0 +1,46 @@
+/**
+ * THE PROGRAM, KEPT ACROSS RELOADS — Plan 7 part 6a spec §4.3: the source editor's text and the encoding it compiles
+ * under, stored as the workspace and the copies are, under a key of their own.
+ *
+ * **VERSIONED AND VALIDATED AS THE OTHER STORES ARE, AND A REFUSAL IS SILENT.** `parseProgram` answers `null` for
+ * anything it will not take, and `null` reads exactly as a first visit does: the app opens on the first-load example.
+ * A stored program cannot be told from a hand-edited one or one a later version wrote, and a banner on every load
+ * after a format change would be worse than what it reports — `buffers-store.ts`'s `parseBuffers` refuses on the same
+ * terms.
+ *
+ * **THE ENCODINGS ARE A PARAMETER** rather than read from the wasm module, so this file needs no wasm and its node
+ * tests none either. `main.ts` hands in `encodings()`.
+ */
+
+/** The `localStorage` key, namespaced for the reason `buffers-store.ts`'s `BUFFERS_STORAGE_KEY` gives. */
+export const PROGRAM_STORAGE_KEY = 'redextape.program'
+
+/** Bumped when the stored shape changes. A mismatch falls back to the first-load example rather than migrating. */
+export const PROGRAM_VERSION = 1
+
+/** What survives a reload of the program: its text, and the encoding it compiles under. */
+export type StoredProgram = { readonly text: string; readonly encoding: string }
+
+export function serializeProgram(program: StoredProgram): string {
+  return JSON.stringify({ version: PROGRAM_VERSION, text: program.text, encoding: program.encoding })
+}
+
+/**
+ * The stored program, or `null` for a missing key, text that is not JSON, another version, a `text` that is not a
+ * string, or an `encoding` that is not one of `encodings`.
+ */
+export function parseProgram(raw: string | null, encodings: readonly string[]): StoredProgram | null {
+  if (raw === null) return null
+  let parsed: unknown
+  try {
+    parsed = JSON.parse(raw)
+  } catch {
+    return null
+  }
+  if (typeof parsed !== 'object' || parsed === null) return null
+  const stored = parsed as Record<string, unknown>
+  if (stored.version !== PROGRAM_VERSION) return null
+  if (typeof stored.text !== 'string') return null
+  if (typeof stored.encoding !== 'string' || !encodings.includes(stored.encoding)) return null
+  return { text: stored.text, encoding: stored.encoding }
+}
````

- [ ] **Step 4: Run it and see it pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  55 passed (55)
Tests  777 passed (777)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each.** In the replay, 6 of 6 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | another version read — `program-store.ts`: `  if (stored.version !== PROGRAM_VERSION) return null ⏎ ` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/program-store.test.ts` | `tests/node/program-store.test.ts > parseProgram > answers null for another version, or none` |
| 2 | a text that is not a string read — `program-store.ts`: `  if (typeof stored.text !== 'string') return null ⏎ ` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/program-store.test.ts` | `tests/node/program-store.test.ts > parseProgram > answers null for a text that is not a string` |
| 3 | an encoding the build does not offer read — `program-store.ts`: ` \|\| !encodings.includes(stored.encoding)` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/program-store.test.ts` | `tests/node/program-store.test.ts > parseProgram > answers null for an encoding the build does not offer` |
| 4 | text that is not JSON thrown on — `program-store.ts`: `  try { ⏎     parsed = JSON.parse(raw) ⏎   } catch { ⏎     return null ⏎   }` → `  parsed = JSON.parse(raw)` | `cd web && pnpm exec vitest run --project node tests/node/program-store.test.ts` | `tests/node/program-store.test.ts > parseProgram > answers null for text that is not JSON, or JSON that is not an object` |
| 5 | JSON that is not an object read — `program-store.ts`: `  if (typeof parsed !== 'object' \|\| parsed === null) return null ⏎ ` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/program-store.test.ts` | `tests/node/program-store.test.ts > parseProgram > answers null for text that is not JSON, or JSON that is not an object` |
| 6 | a field beyond the three written — `program-store.ts`: `encoding: program.encoding })` → `encoding: program.encoding, at: 0 })` | `cd web && pnpm exec vitest run --project node tests/node/program-store.test.ts` | `tests/node/program-store.test.ts > parseProgram > writes version 1, the text and the encoding, and nothing else` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
`redextape.program`: the program's store, versioned and validated

`program-store.ts` writes the source editor's text and its encoding as
`{ version: 1, text, encoding }` under a key of its own, and reads it
back only if the version is 1, the text is a string and the encoding is
one of those handed in — `null` otherwise, which reads as a first visit
(spec §4.3). The encodings are a parameter, so the parser needs no wasm.
````

---

### Task 3: The program is kept across reloads, and a first visit opens on `sum_to(5)`

**Files:**
- Modify: `web/src/main.ts` (`SAMPLE` goes; `readProgramStorage`, `loaded` and the picker's value after the encodings are listed; `writeProgramStorage`; `loaded.text` in the editor, the language server and the start-up compile, and in the six places four of its comments named `compile.schedule(SAMPLE)`), `web/src/compile.ts` (`persist`)
- Modify (tests): `web/tests/browser/setup.ts` (the shim's stored program), `web/tests/browser/tm-buffer-restore.test.ts` and `web/tests/browser/scratch-fork.test.ts` (a comment each that named `SAMPLE`)
- Test: `web/tests/browser/first-load.test.ts`, `web/tests/browser/program-restore.test.ts`, `web/tests/browser/program-restore-invalid.test.ts`

**Interfaces:**
- Consumes Task 1's `EXAMPLE_ENCODING` and `FIRST_LOAD`, and Task 2's store.
- Produces `createCompile`'s new dependency `persist: (text: string, encoding: string) => void`, called in its timer with the text and `picker.value` it posts; `main.ts`'s `loaded: StoredProgram` and `writeProgramStorage(text, encoding)`, a failure swallowed until Task 4.

**ONE START-UP PROGRAM, CHOSEN AFTER `init()`** (spec §4.4): an encoding is valid only if `encodings()` lists it. It is the stored program if `parseProgram` takes it, and otherwise the first-load example under `unary`; the picker is set from it before anything schedules a compile. It replaces `SAMPLE` in its three places — the editor's document, the language server's first text and the start-up compile — and `SAMPLE` goes. The workspace path does not change.

**ONE WRITE SITE, WHERE A COMPILE POSTS** (§4.3): `compile.ts`'s timer, with the text it posts and the encoding it posts it under. A keystroke, an encoding change, the start-up program and — in Task 5 — a picked example all reach it, once per pause.

**THE BROWSER TIER KEEPS ITS STARTING PROGRAM** (§4.4): `setup.ts` stores `let x = 40; x + 2` under `unary` before any file's module body runs, and `first-load.test.ts` removes it at module scope.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=3
diff --git a/web/tests/browser/first-load.test.ts b/web/tests/browser/first-load.test.ts
new file mode 100644
index 0000000..0c01d47
--- /dev/null
+++ b/web/tests/browser/first-load.test.ts
@@ -0,0 +1,56 @@
+import type { EditorView } from '@codemirror/view'
+import { describe, expect, it } from 'vitest'
+import { FIRST_LOAD } from '../../src/examples'
+import { LAYOUT_STORAGE_KEY } from '../../src/layout'
+import { PROGRAM_STORAGE_KEY, parseProgram } from '../../src/program-store'
+import { SHELL, until } from './harness'
+
+/**
+ * **A FIRST VISIT OPENS ON `sum_to(5)`, UNDER THE DEFAULT ENCODING, IN EXPLORER** — Plan 7 part 6a spec §4.4 and
+ * row 3, where every load before opened on `let x = 40; x + 2`. `setup.ts` stores that program for every file, so this
+ * one removes it at module scope, before `main()` runs: nothing stored is what a first visit has. ONE MOUNT FOR THE
+ * FILE, for the reason every sibling gives.
+ */
+
+localStorage.removeItem(PROGRAM_STORAGE_KEY)
+
+const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+
+let view: EditorView
+
+describe('a first visit', () => {
+  it('has no program and no workspace stored', () => {
+    expect(localStorage.getItem(PROGRAM_STORAGE_KEY)).toBeNull()
+    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull()
+  })
+
+  it('opens on sum_to(5) under unary, in Explorer', async () => {
+    document.body.innerHTML = SHELL
+    view = await (await import('../../src/main')).ready
+    expect(view.state.doc.toString()).toBe(FIRST_LOAD.text)
+    expect(document.querySelector<HTMLSelectElement>('#encoding')?.value).toBe('unary')
+    expect(document.querySelector('#workspace')?.textContent?.trim()).toBe('Explorer ▾')
+    expect([...document.querySelectorAll<HTMLElement>('main [data-leaf]')].map((el) => el.dataset.leaf)).toEqual([
+      'source',
+      'lambda-0',
+      'asm-0',
+      'tm-0',
+    ])
+  })
+
+  it('compiles it, and every leg ends at 15', async () => {
+    await until(() => idle() && segments().length > 0, 'the first compile')
+    const [lambda, asm, tm] = segments()
+    expect(lambda).toMatch(/^λ 15 · /)
+    expect(asm).toMatch(/^asm 15 · /)
+    expect(tm).toMatch(/^TM 15 · /)
+  })
+
+  it('stores it as its compile posts it', () => {
+    expect(parseProgram(localStorage.getItem(PROGRAM_STORAGE_KEY), ['unary'])).toEqual({
+      text: FIRST_LOAD.text,
+      encoding: 'unary',
+    })
+  })
+})
diff --git a/web/tests/browser/program-restore-invalid.test.ts b/web/tests/browser/program-restore-invalid.test.ts
new file mode 100644
index 0000000..19648cb
--- /dev/null
+++ b/web/tests/browser/program-restore-invalid.test.ts
@@ -0,0 +1,30 @@
+import type { EditorView } from '@codemirror/view'
+import { describe, expect, it } from 'vitest'
+import { FIRST_LOAD } from '../../src/examples'
+import { PROGRAM_STORAGE_KEY } from '../../src/program-store'
+import { SHELL, until } from './harness'
+
+/**
+ * **A STORED PROGRAM THE APP REFUSES OPENS THE FIRST-LOAD EXAMPLE, AND SAYS NOTHING** — Plan 7 part 6a spec §4.3 and
+ * §7: a refusal cannot be told from a first visit. The refusal here is the one only the browser can see, an encoding
+ * `encodings()` does not list; `program-store.test.ts` holds every other. ONE MOUNT FOR THE FILE, for the reason every
+ * sibling gives.
+ */
+
+localStorage.setItem(
+  PROGRAM_STORAGE_KEY,
+  JSON.stringify({ version: 1, text: 'let y = 5;\ny * 4\n', encoding: 'ternary' }),
+)
+
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+
+describe('a stored program under an encoding the build does not offer', () => {
+  it('is set aside for sum_to(5) under unary, with nothing said', async () => {
+    document.body.innerHTML = SHELL
+    const view: EditorView = await (await import('../../src/main')).ready
+    expect(view.state.doc.toString()).toBe(FIRST_LOAD.text)
+    expect(document.querySelector<HTMLSelectElement>('#encoding')?.value).toBe('unary')
+    await until(idle, 'the first compile')
+    expect(document.querySelector<HTMLElement>('#notice')?.hidden).toBe(true)
+  })
+})
diff --git a/web/tests/browser/program-restore.test.ts b/web/tests/browser/program-restore.test.ts
new file mode 100644
index 0000000..edc5ac1
--- /dev/null
+++ b/web/tests/browser/program-restore.test.ts
@@ -0,0 +1,56 @@
+import type { EditorView } from '@codemirror/view'
+import { describe, expect, it } from 'vitest'
+import { userEvent } from 'vitest/browser'
+import { PROGRAM_STORAGE_KEY, parseProgram, serializeProgram } from '../../src/program-store'
+import { SHELL, until } from './harness'
+
+/**
+ * **A STORED PROGRAM COMES BACK UNDER ITS OWN ENCODING, AND EACH COMPILE STORES WHAT IT POSTS** — Plan 7 part 6a spec
+ * §4.3 and §4.4. The program is stored at module scope, before `main()` runs, as a previous page load would have
+ * stored it, over the one `setup.ts` stores for every file. It has a function so that the outline can say which text
+ * the language server was given. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
+ */
+
+const STORED = { text: 'fn times4(y) {\n    y * 4\n}\ntimes4(5)\n', encoding: 'binary' }
+localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram(STORED))
+
+const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
+const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+const stored = () => parseProgram(localStorage.getItem(PROGRAM_STORAGE_KEY), ['unary', 'binary'])
+const outlineRows = () =>
+  [...document.querySelectorAll<HTMLElement>('[data-leaf="source"] .outline-row')].map((r) => r.textContent)
+
+let view: EditorView
+
+describe('a stored program', () => {
+  it('opens in the editor, under the encoding it was stored with', async () => {
+    document.body.innerHTML = SHELL
+    view = await (await import('../../src/main')).ready
+    expect(view.state.doc.toString()).toBe(STORED.text)
+    expect(picker().value).toBe('binary')
+    await until(() => idle() && segments().length > 0, 'the first compile')
+    expect(segments()[0]).toMatch(/^λ 20 · /)
+  })
+
+  it('is the text the language server was given: the outline lists its function', async () => {
+    document
+      .querySelector<HTMLButtonElement>('[data-leaf="source"] [data-panel="outline"] button[aria-expanded]')
+      ?.click()
+    await until(() => outlineRows().length > 0, 'the outline to fill')
+    expect(outlineRows()).toEqual(['times4'])
+  })
+
+  it('is stored again under the encoding a change picks', async () => {
+    await userEvent.selectOptions(picker(), 'unary')
+    await until(() => stored()?.encoding === 'unary', 'the new encoding, stored')
+    expect(stored()).toEqual({ text: STORED.text, encoding: 'unary' })
+  })
+
+  it('is stored with the text an edit leaves', async () => {
+    const edited = 'fn times4(y) {\n    y * 4\n}\ntimes4(6)\n'
+    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: edited } })
+    await until(() => stored()?.text === edited, 'the edit, stored')
+    expect(stored()).toEqual({ text: edited, encoding: 'unary' })
+  })
+})
diff --git a/web/tests/browser/scratch-fork.test.ts b/web/tests/browser/scratch-fork.test.ts
index bf789c8..c42850a 100644
--- a/web/tests/browser/scratch-fork.test.ts
+++ b/web/tests/browser/scratch-fork.test.ts
@@ -749,8 +749,8 @@ describe('the no-session report for a failed fork', () => {
  * (777-2,095 bytes printed, nowhere near that budget) — truncated at the frame's own print, whole at
  * the readout's, exactly the pairing this test needs. `frame-cost.test.ts` uses the same source for
  * an unrelated reason (span cost, not truncation) and never checks `cut`; this file's own `BIG` was
- * picked for its TM leg's size and was never measured for λ truncation at all; `SAMPLE`-sized
- * programs (`scratch-app.test.ts`) never truncate at either budget. None of the existing fixtures
+ * picked for its TM leg's size and was never measured for λ truncation at all; programs the size
+ * of `let x = 40; x + 2` (`scratch-app.test.ts`) never truncate at either budget. None of the existing fixtures
  * would have proven anything here.
  */
 describe('the fork control forks a truncated frame, through the app', () => {
diff --git a/web/tests/browser/setup.ts b/web/tests/browser/setup.ts
index 3b758ce..5e7c035 100644
--- a/web/tests/browser/setup.ts
+++ b/web/tests/browser/setup.ts
@@ -17,6 +17,7 @@
  * and this is a test-harness gap, not an application one.
  */
 import '../../src/style.css'
+import { PROGRAM_STORAGE_KEY, serializeProgram } from '../../src/program-store'
 
 /**
  * Browser-tier setup, part two: give every test file its own `Storage`, not the browser's real one.
@@ -67,3 +68,14 @@ const shim: Storage = {
   },
 }
 Object.defineProperty(window, 'localStorage', { value: shim, configurable: true })
+
+/**
+ * Browser-tier setup, part three: every file starts on `let x = 40; x + 2`, the program it was written against.
+ *
+ * **A FIRST VISIT OPENS ON THE FIRST-LOAD EXAMPLE NOW** (Plan 7 part 6a spec §4.4), and every file's storage above
+ * starts empty, so every file that mounts the app would start on `sum_to(5)`: a longer first compile in all of them,
+ * and a different program in the ones that never type one of their own. The old start-up program is stored here
+ * instead, under the default encoding, as a returning visitor's would be. `first-load.test.ts` removes it before it
+ * mounts, and a file that clears storage before its mount starts on the example too.
+ */
+shim.setItem(PROGRAM_STORAGE_KEY, serializeProgram({ text: 'let x = 40; x + 2', encoding: 'unary' }))
diff --git a/web/tests/browser/tm-buffer-restore.test.ts b/web/tests/browser/tm-buffer-restore.test.ts
index 5b5b92a..5655625 100644
--- a/web/tests/browser/tm-buffer-restore.test.ts
+++ b/web/tests/browser/tm-buffer-restore.test.ts
@@ -186,7 +186,7 @@ const detachedWithNoEditorYet = (pane: HTMLElement): boolean =>
  * Neither hazard applies here: this file dispatches exactly one program per mount and both `mountApp`
  * tests that touch two panes fork them in sequence, waiting between. Watching only one leg would miss
  * the OTHER leg still mid-flight — checked directly rather than reasoned about, since `lambda-0` and
- * `tm-0` while both still bound to the small `SAMPLE`-sized source settle in well under a second either
+ * `tm-0` while both still bound to a source the size of `let x = 40; x + 2` settle in well under a second either
  * way (measured with a throwaway probe against `'let x = 40; x + 2'` before this file was written).
  */
 async function settleOn(snapshot: () => string, timeoutMs = 60_000): Promise<void> {
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/first-load.test.ts tests/browser/program-restore.test.ts tests/browser/program-restore-invalid.test.ts`

Expected: exit 1, printing:

```text
Test Files  3 failed (3)
Tests  8 failed | 1 passed (9)
```

Failing: `tests/browser/first-load.test.ts > a first visit > opens on sum_to(5) under unary, in Explorer`, `tests/browser/first-load.test.ts > a first visit > compiles it, and every leg ends at 15`, `tests/browser/first-load.test.ts > a first visit > stores it as its compile posts it`, `tests/browser/program-restore-invalid.test.ts > a stored program under an encoding the build does not offer > is set aside for sum_to(5) under unary, with nothing said`, `tests/browser/program-restore.test.ts > a stored program > opens in the editor, under the encoding it was stored with`, `tests/browser/program-restore.test.ts > a stored program > is the text the language server was given: the outline lists its function`, `tests/browser/program-restore.test.ts > a stored program > is stored again under the encoding a change picks`, `tests/browser/program-restore.test.ts > a stored program > is stored with the text an edit leaves`.

- [ ] **Step 3: Write the code.**

````diff apply=source task=3
diff --git a/web/src/compile.ts b/web/src/compile.ts
index a49cd9e..f82e9c7 100644
--- a/web/src/compile.ts
+++ b/web/src/compile.ts
@@ -67,8 +67,10 @@ export function createCompile(deps: {
   picker: HTMLSelectElement
   view: () => EditorView
   sourceSession: SessionId
+  /** Store the program as it is posted: its text, and the encoding the compile was given. */
+  persist: (text: string, encoding: string) => void
 }): { schedule(src: string): void } {
-  const { sessions, results, picker, view, sourceSession } = deps
+  const { sessions, results, picker, view, sourceSession, persist } = deps
 
   let timer: ReturnType<typeof setTimeout> | undefined
 
@@ -129,7 +131,14 @@ export function createCompile(deps: {
     // replies stop being current at the instant of dispatch; `request` drops the post if another
     // keystroke claimed a newer one during the debounce. See `SessionClient.supersede`.
     const gen = client.supersede()
-    timer = setTimeout(() => client.request(gen, src, picker.value), DEBOUNCE_MS)
+    timer = setTimeout(() => {
+      const encoding = picker.value
+      client.request(gen, src, encoding)
+      // **THE PROGRAM IS STORED WHERE IT IS POSTED — Plan 7 part 6a spec §4.3.** A keystroke, an encoding change, a
+      // picked example and the start-up program all arrive here, so this is the one write site and there is one write
+      // per pause. A keystroke in the last `DEBOUNCE_MS` before the tab closes is not stored, as a copy's is not.
+      persist(src, encoding)
+    }, DEBOUNCE_MS)
   }
 
   // The picker is otherwise inert: `schedule` only reads `picker.value` when a keystroke's update
diff --git a/web/src/main.ts b/web/src/main.ts
index 0edebd1..b6911c5 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -23,6 +23,7 @@ import { createDraw } from './draw'
 import { createEditorCustody } from './editor-custody'
 import { KeymapSetting, keymapSlot } from './editor-keymap'
 import { KEYMAP_LABEL, KEYMAP_MODES, parseKeymapMode, readFormatOnBlur, writeFormatOnBlur } from './editor-prefs'
+import { EXAMPLE_ENCODING, FIRST_LOAD } from './examples'
 import { declineMark, focusMark, linkMark } from './highlight'
 import { History } from './history'
 import { icon } from './icons'
@@ -43,6 +44,7 @@ import type { PaneChoice } from './pane-chrome'
 import { createPaneHost, type LayoutEvent } from './pane-host'
 import { createPanel } from './panel'
 import { type LeafId, legOfPane, PaneCollection } from './panes'
+import { PROGRAM_STORAGE_KEY, parseProgram, serializeProgram } from './program-store'
 import type { Leg, RunReply } from './protocol'
 import { HISTORY_BYTES } from './protocol'
 import { asmCopyRow, copyLegOf, createReadout, type ProgramResult, tmCopyRow } from './readout'
@@ -86,8 +88,6 @@ import {
   withTmDisplay,
 } from './workspace'
 
-const SAMPLE = 'let x = 40; x + 2'
-
 /**
  * The counter behind every `LeafId` a split mints, shared across every leg — module-level rather than
  * per call to `main()`, though `main()` only ever runs once (`ready` below is computed on import).
@@ -465,6 +465,29 @@ async function main(): Promise<EditorView> {
     picker.append(opt)
   }
 
+  /**
+   * THE PROGRAM THE PAGE OPENS ON — Plan 7 part 6a spec §4.4: the stored one if `parseProgram` takes it, otherwise the
+   * first-load example under the default encoding. A refusal is silent, since it cannot be told from a first visit
+   * (`program-store.ts`'s own doc).
+   *
+   * **CHOSEN HERE, AFTER `init()`, BECAUSE AN ENCODING IS VALID ONLY IF `encodings()` LISTS IT**, and before anything
+   * reads it: the editor's document, the language server's first text and the start-up compile are its three uses.
+   * The picker is set from it now, since a compile reads `picker.value` when it posts, and the encoding is kept across
+   * reloads for the first time.
+   */
+  const readProgramStorage = (): string | null => {
+    try {
+      return localStorage.getItem(PROGRAM_STORAGE_KEY)
+    } catch {
+      return null
+    }
+  }
+  const loaded = parseProgram(readProgramStorage(), encodings() as string[]) ?? {
+    text: FIRST_LOAD.text,
+    encoding: EXAMPLE_ENCODING,
+  }
+  picker.value = loaded.encoding
+
   let view: EditorView
   /** The source editor's document. Per view, never fetched, never parsed — see `documentUri`. */
   const SOURCE_URI = documentUri(SOURCE_LEAF, 'redextape')
@@ -972,6 +995,19 @@ async function main(): Promise<EditorView> {
     writeBuffersStorage(serializeBuffers(payload), payload.buffers.length > 0)
   }
 
+  /**
+   * Store the program — `compile.ts` calls this as each compile posts, with the text and the encoding it posted (Plan 7
+   * part 6a spec §4.3). A failure is swallowed, as the layout writer's is: the program still compiles for the rest of
+   * this page load, and only a reload loses it.
+   */
+  const writeProgramStorage = (text: string, encoding: string): void => {
+    try {
+      localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram({ text, encoding }))
+    } catch {
+      // Nothing to do — the same tradeoff `writeLayoutStorage` makes.
+    }
+  }
+
   /**
    * THE WORKSPACE — restored from `localStorage` if there is a usable value there (a version 1 layout is
    * migrated: `workspace.ts`'s `parseWorkspace`), the default otherwise.
@@ -1722,7 +1758,7 @@ async function main(): Promise<EditorView> {
   // `linkWiring`/`draw`/`view` are all still `undefined` at this point in `main()` — a restored page's
   // first buffers write, refused, threw a bare `TypeError` out of `main()` and killed the page. The
   // call is still made, unconditionally, on every page load; it has just moved past all three
-  // assignments and past the app's own initial `compile.schedule(SAMPLE)`. That call site, near the end
+  // assignments and past the app's own initial `compile.schedule(loaded.text)`. That call site, near the end
   // of `main()`, carries the argument — including which of those constraints Plan 7 part 2 spent.
 
   /**
@@ -1740,7 +1776,7 @@ async function main(): Promise<EditorView> {
    * `paneHost.applyLayout()` has ever run once.
    *
    * **TWO MORE CALLS REACH `draw()` BEFORE `applyLayout()` DOES, NEITHER THROUGH
-   * `reportStorageFailure()`.** `compile.schedule(SAMPLE)` — this file's own start-up compile — is now
+   * `reportStorageFailure()`.** `compile.schedule(loaded.text)` — this file's own start-up compile — is now
    * the first `draw()` of the app's life, ahead of the one inside `paneHost.applyLayout()` itself,
    * reached through `client.supersede()`'s `onSupersede` callback. The restore's warming loop reaches
    * it the same way, once per warmed session: `scratchpad.warm(session)` spawns a worker, and the spawn
@@ -1846,6 +1882,7 @@ async function main(): Promise<EditorView> {
     picker,
     view: () => view,
     sourceSession: SOURCE_SESSION,
+    persist: writeProgramStorage,
   })
 
   /**
@@ -1901,7 +1938,7 @@ async function main(): Promise<EditorView> {
   view = new EditorView({
     parent: editorHost,
     state: EditorState.create({
-      doc: SAMPLE,
+      doc: loaded.text,
       extensions: [
         lineNumbers(),
         history(),
@@ -2058,7 +2095,7 @@ async function main(): Promise<EditorView> {
   // **THE SINK IS PART OF OPENING THE DOCUMENT**, so there is no router to keep in step and no way
   // for this editor to receive another document's diagnostics. Every copy's editor opens its own the
   // same way, from inside `ScratchEditor`.
-  lspClient.openDocument(SOURCE_URI, 'redextape', SAMPLE, {
+  lspClient.openDocument(SOURCE_URI, 'redextape', loaded.text, {
     diagnostics: (ds) => {
       view.dispatch(setCmDiagnostics(view.state, lspLintRanges(ds, view.state.doc)))
       // ONE SETTLED EDIT, ONE PUBLISH — so this is the cheapest signal that the server has caught
@@ -2068,13 +2105,13 @@ async function main(): Promise<EditorView> {
   })
   sourceMenu.setFormattable(true)
 
-  compile.schedule(SAMPLE)
+  compile.schedule(loaded.text)
 
-  // **THE START-UP CALL, AFTER `compile.schedule(SAMPLE)`, AND THE ORDERING THAT FORCED IT IS SPENT.**
+  // **THE START-UP CALL, AFTER `compile.schedule(loaded.text)`, AND THE ORDERING THAT FORCED IT IS SPENT.**
   // This call sat right after `refreshBuffers`'s own definition until 5d-ii-d, and moved three times:
   // `reportStorageFailure` wrote through `linkWiring` and `draw()`, both `let`s that stay `undefined`
   // until far below that definition, so an early call threw a `TypeError` and killed the page; and a
-  // call placed after `view = new EditorView(...)` was wiped by `compile.schedule(SAMPLE)`'s own
+  // call placed after `view = new EditorView(...)` was wiped by `compile.schedule(loaded.text)`'s own
   // unconditional clear of the fork-failure line before anyone could read it.
   //
   // **NEITHER CONSTRAINT SURVIVES PLAN 7 PART 2.** The report is the notice line's resting state
@@ -2147,10 +2184,10 @@ async function main(): Promise<EditorView> {
   // still "one call, at the very end of `main()`, after everything else is wired" (`view` included:
   // `linkWiring`/`draw`/`compile`/`replies` all close over it as a thunk; `draw()`'s own body reads
   // `view()` directly, and has already done so above this line — once from
-  // `compile.schedule(SAMPLE)`, and once per warmed session from the restore loop — both through
+  // `compile.schedule(loaded.text)`, and once per warmed session from the restore loop — both through
   // `client.supersede()`). **THE RESTORE'S WARMING LOOP NOW SITS ABOVE IT, AND WHAT SURVIVES IS
   // NARROWER THAN "READS NO PANE"**: each spawn's `client.supersede()` reaches `draw()` the same way
-  // `compile.schedule(SAMPLE)` does, so the loop reads `panes` now too. `applyLayout` remains the only
+  // `compile.schedule(loaded.text)` does, so the loop reads `panes` now too. `applyLayout` remains the only
   // thing that ever populates `panes` (`THE LINK STATE` comment above), so those reads run against a
   // collection that is genuinely empty, and it remains true that nothing before this line has BUILT
   // one.
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  55 passed (55)
Tests  777 passed (777)
```

Run: `cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=24G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --working-directory="$PWD" pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  125 passed (125)
Tests  818 passed (818)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each.** In the replay, 10 of 10 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | the stored program never read — `main.ts`: `const loaded = parseProgram(readProgramStorage(), encodings() as string[]) ??` → `const loaded = parseProgram(null, encodings() as string[]) ??` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/first-load.test.ts tests/browser/program-restore.test.ts tests/browser/program-restore-invalid.test.ts` | `tests/browser/program-restore.test.ts > a stored program > opens in the editor, under the encoding it was stored with`, `tests/browser/program-restore.test.ts > a stored program > is the text the language server was given: the outline lists its function`, `tests/browser/program-restore.test.ts > a stored program > is stored again under the encoding a change picks` |
| 2 | the picker left on its first encoding — `main.ts`: `  picker.value = loaded.encoding ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/first-load.test.ts tests/browser/program-restore.test.ts tests/browser/program-restore-invalid.test.ts` | `tests/browser/program-restore.test.ts > a stored program > opens in the editor, under the encoding it was stored with` |
| 3 | a first visit opens on the old program — `main.ts`: `    text: FIRST_LOAD.text, ⏎ ` → `    text: 'let x = 40; x + 2', ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/first-load.test.ts tests/browser/program-restore.test.ts tests/browser/program-restore-invalid.test.ts` | `tests/browser/first-load.test.ts > a first visit > opens on sum_to(5) under unary, in Explorer`, `tests/browser/first-load.test.ts > a first visit > compiles it, and every leg ends at 15`, `tests/browser/first-load.test.ts > a first visit > stores it as its compile posts it`, `tests/browser/program-restore-invalid.test.ts > a stored program under an encoding the build does not offer > is set aside for sum_to(5) under unary, with nothing said` |
| 4 | the encoding not held to `encodings()` — `main.ts`: `parseProgram(readProgramStorage(), encodings() as string[])` → `parseProgram(readProgramStorage(), [...(encodings() as string[]), 'ternary'])` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/first-load.test.ts tests/browser/program-restore.test.ts tests/browser/program-restore-invalid.test.ts` | `tests/browser/program-restore-invalid.test.ts > a stored program under an encoding the build does not offer > is set aside for sum_to(5) under unary, with nothing said` |
| 5 | no write where a compile posts — `compile.ts`: `      persist(src, encoding) ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/first-load.test.ts tests/browser/program-restore.test.ts tests/browser/program-restore-invalid.test.ts` | `tests/browser/first-load.test.ts > a first visit > stores it as its compile posts it`, `tests/browser/program-restore.test.ts > a stored program > is stored again under the encoding a change picks`, `tests/browser/program-restore.test.ts > a stored program > is stored with the text an edit leaves` |
| 6 | the write carries another encoding — `compile.ts`: `      persist(src, encoding) ⏎ ` → `      persist(src, 'binary') ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/first-load.test.ts tests/browser/program-restore.test.ts tests/browser/program-restore-invalid.test.ts` | `tests/browser/first-load.test.ts > a first visit > stores it as its compile posts it`, `tests/browser/program-restore.test.ts > a stored program > is stored again under the encoding a change picks`, `tests/browser/program-restore.test.ts > a stored program > is stored with the text an edit leaves` |
| 7 | the editor opens on the example whatever is stored — `main.ts`: `      doc: loaded.text, ⏎ ` → `      doc: FIRST_LOAD.text, ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/first-load.test.ts tests/browser/program-restore.test.ts tests/browser/program-restore-invalid.test.ts` | `tests/browser/program-restore.test.ts > a stored program > opens in the editor, under the encoding it was stored with`, `tests/browser/program-restore.test.ts > a stored program > is stored again under the encoding a change picks` |
| 8 | the language server's first text is the example's — `main.ts`: `lspClient.openDocument(SOURCE_URI, 'redextape', loaded.text, {` → `lspClient.openDocument(SOURCE_URI, 'redextape', FIRST_LOAD.text, {` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/first-load.test.ts tests/browser/program-restore.test.ts tests/browser/program-restore-invalid.test.ts` | `tests/browser/program-restore.test.ts > a stored program > is the text the language server was given: the outline lists its function` |
| 9 | the start-up compile is the example's — `main.ts`: `  compile.schedule(loaded.text) ⏎  ⏎ ` → `  compile.schedule(FIRST_LOAD.text) ⏎  ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/first-load.test.ts tests/browser/program-restore.test.ts tests/browser/program-restore-invalid.test.ts` | `tests/browser/program-restore.test.ts > a stored program > opens in the editor, under the encoding it was stored with` |
| 10 | no program stored for the browser tier's files — `tests/browser/setup.ts`: `shim.setItem(PROGRAM_STORAGE_KEY, serializeProgram({ text: 'let x = 40; x + 2', encoding: 'unary' })) ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=24G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --working-directory="$PWD" pnpm exec vitest run --project browser` | `tests/browser/colour.test.ts > the editors colour from their grammars > colours an asm copy from the asm grammar, in the palette`, `tests/browser/colour.test.ts > the editors colour from their grammars > finds tok-keyword in two editors at once, which is why it is nobody’s witness` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
The program is kept across reloads, and a first visit opens on sum_to(5)

`main.ts` chooses one start-up program after `init()`: the stored one if
`parseProgram` takes it, otherwise the first-load example under the
default encoding, and sets the picker from it before the first compile
(spec §4.4). It replaces `SAMPLE` as the editor's document, the language
server's first text and the start-up compile. `compile.ts` stores the
program where each compile posts it, with the encoding it was given, so
a keystroke, an encoding change and the start-up compile all write it
once per pause (§4.3); a failed write is swallowed for now. The browser
tier's storage shim stores `let x = 40; x + 2` for every file, so the
files written against that program keep it, and the first-load test
removes it.
````

---

### Task 4: A refused program write is reported once the program has changed

**Files:**
- Create: `web/src/unsaved.ts`
- Modify: `web/src/main.ts` (`unsaved`; `reportStorageFailure` and `writeBuffersStorage` report the copies' half; `programChanged` and `writeProgramStorage` report the program's)
- Test: `web/tests/node/unsaved.test.ts`, `web/tests/browser/program-quota.test.ts`

**Interfaces:**
- Produces `unsaved.ts`'s `type UnsavedStore = 'program' | 'copies'`; `unsavedLine(program: boolean, copies: boolean): string | null`; `type Unsaved = { refused(store: UnsavedStore): void; saved(store: UnsavedStore): void }`; `createUnsaved(rest: (line: string | null) => void): Unsaved`. `main.ts`'s `unsaved` hands `notices.rest` the whole sentence at every change.

**ONLY ONCE THE PROGRAM HAS CHANGED FROM WHAT WAS LOADED** (spec row 17): a changed program is work not yet saved; the first-load example, or a stored program only looked at, is not. The writer compares the text and encoding it is given with `loaded`'s, and once they differ at a write, every refusal from then on is reported, as the copies' writer reports only when there are copies to lose.

**ONE RESTING SENTENCE FOR TWO WRITERS** (§4.3): *the program is not being saved*, *copies are not being saved*, or *the program and copies are not being saved*, each followed by today's *— this browser’s storage for this site is full*. A writer's success takes back only its own half, so the copies' write that goes through leaves the program's report standing. `program-quota.test.ts` stores a copy, bound to the λ view, so that a copies' write can be seen to go through.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=4
diff --git a/web/tests/browser/program-quota.test.ts b/web/tests/browser/program-quota.test.ts
new file mode 100644
index 0000000..92f1518
--- /dev/null
+++ b/web/tests/browser/program-quota.test.ts
@@ -0,0 +1,87 @@
+import { EditorView } from '@codemirror/view'
+import { describe, expect, it } from 'vitest'
+import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/buffers-store'
+import { PROGRAM_STORAGE_KEY } from '../../src/program-store'
+import { SHELL, until } from './harness'
+
+/**
+ * **A REFUSED PROGRAM WRITE IS REPORTED ONLY ONCE THE PROGRAM HAS CHANGED FROM WHAT WAS LOADED** — Plan 7 part 6a spec
+ * §4.3 and row 17. A visitor on blocked storage who only looks at the first-load example is told nothing; one who
+ * edits it is told from that edit's write on, on the notice line's resting state, which the copies' writer shares.
+ *
+ * **THE REFUSAL IS ARMED AT MODULE SCOPE, BEFORE `main()` RUNS**, as `buffers-quota-empty.test.ts` arms its own, so
+ * the start-up compile's write is the first one refused. The program `setup.ts` stores is removed, so the page opens
+ * on the first-load example as a first visit does; and a copy is stored, bound to the λ view, so that a write of the
+ * copies that goes through can be seen to leave the program's half of the line alone. ONE MOUNT FOR THE FILE, for the
+ * reason every sibling gives.
+ */
+
+localStorage.removeItem(PROGRAM_STORAGE_KEY)
+localStorage.setItem(
+  BUFFERS_STORAGE_KEY,
+  serializeBuffers({
+    minted: 1,
+    buffers: [{ id: 'scratch-1', label: 'copy 1', text: '(λx. x) (λy. y)', collapsed: false, leg: 'lambda' }],
+    bindings: { 'lambda-0': 'scratch-1' },
+  }),
+)
+
+/** Whether a write of the program throws, and how many have. */
+let refuse = true
+let refused = 0
+const passthroughSetItem = localStorage.setItem.bind(localStorage)
+localStorage.setItem = (key: string, value: string): void => {
+  if (refuse && key === PROGRAM_STORAGE_KEY) {
+    refused += 1
+    throw new DOMException('quota', 'QuotaExceededError')
+  }
+  passthroughSetItem(key, value)
+}
+
+const PROGRAM_LINE = 'the program is not being saved — this browser’s storage for this site is full'
+const notice = () => document.querySelector<HTMLElement>('#notice') as HTMLElement
+const noticeText = () => notice().querySelector('.notice-text')?.textContent ?? ''
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+const copyEditor = (): EditorView | null => {
+  const el = document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term-editor')
+  return el === null ? null : EditorView.findFromDOM(el)
+}
+
+let view: EditorView
+
+describe('a program write refused by storage', () => {
+  it('says nothing while the page shows the program it loaded', async () => {
+    document.body.innerHTML = SHELL
+    view = await (await import('../../src/main')).ready
+    await until(() => idle() && copyEditor() !== null, 'the first compile and the copy')
+    // THE WRITE UNDER TEST HAPPENED, AND WAS REFUSED: silence after no write would prove nothing.
+    expect(refused).toBeGreaterThan(0)
+    expect(notice().hidden).toBe(true)
+    expect(document.querySelector('#live')?.textContent ?? '').not.toContain('not being saved')
+  })
+
+  it('says the program is not being saved once an edit is refused', async () => {
+    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 1;\nx + 1\n' } })
+    await until(() => noticeText() === PROGRAM_LINE, 'the resting line')
+    expect(notice().hidden).toBe(false)
+  })
+
+  it('keeps saying so when a write of the copies goes through', async () => {
+    const copy = copyEditor()
+    if (copy === null) throw new Error('no copy editor')
+    const edited = '(λz. z) (λy. y)'
+    copy.dispatch({ changes: { from: 0, to: copy.state.doc.length, insert: edited } })
+    await until(
+      () => parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))?.buffers[0]?.text === edited,
+      'the copy, stored',
+    )
+    expect(noticeText()).toBe(PROGRAM_LINE)
+  })
+
+  it('takes it back once a write of the program goes through', async () => {
+    refuse = false
+    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 2;\nx + 1\n' } })
+    await until(() => notice().hidden === true, 'the resting line to go')
+    expect(noticeText()).toBe('')
+  })
+})
diff --git a/web/tests/node/unsaved.test.ts b/web/tests/node/unsaved.test.ts
new file mode 100644
index 0000000..548765f
--- /dev/null
+++ b/web/tests/node/unsaved.test.ts
@@ -0,0 +1,36 @@
+import { describe, expect, it } from 'vitest'
+import { createUnsaved, unsavedLine } from '../../src/unsaved'
+
+const FULL = 'not being saved — this browser’s storage for this site is full'
+
+describe('unsavedLine', () => {
+  it('names whichever store is failing, and both when both are', () => {
+    expect(unsavedLine(false, false)).toBeNull()
+    expect(unsavedLine(true, false)).toBe(`the program is ${FULL}`)
+    expect(unsavedLine(true, true)).toBe(`the program and copies are ${FULL}`)
+  })
+
+  it('says what it always said while only the copies fail', () => {
+    expect(unsavedLine(false, true)).toBe('copies are not being saved — this browser’s storage for this site is full')
+  })
+})
+
+describe('createUnsaved', () => {
+  it('hands the whole sentence on at every change, and a success takes back only its own half', () => {
+    const lines: (string | null)[] = []
+    const unsaved = createUnsaved((line) => lines.push(line))
+    unsaved.refused('program')
+    unsaved.refused('copies')
+    unsaved.saved('program')
+    unsaved.saved('copies')
+    expect(lines).toEqual([`the program is ${FULL}`, `the program and copies are ${FULL}`, `copies are ${FULL}`, null])
+  })
+
+  it('leaves a failing store failing when the other one saves', () => {
+    const lines: (string | null)[] = []
+    const unsaved = createUnsaved((line) => lines.push(line))
+    unsaved.refused('copies')
+    unsaved.saved('program')
+    expect(lines).toEqual([`copies are ${FULL}`, `copies are ${FULL}`])
+  })
+})
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/unsaved.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  no tests
```

The file does not load: `Error: Cannot find module '../../src/unsaved' imported from tests/node/unsaved.test.ts`

Run: `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/program-quota.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  2 failed | 2 passed (4)
```

Failing: `tests/browser/program-quota.test.ts > a program write refused by storage > says the program is not being saved once an edit is refused`, `tests/browser/program-quota.test.ts > a program write refused by storage > keeps saying so when a write of the copies goes through`.

- [ ] **Step 3: Write the code.**

````diff apply=source task=4
diff --git a/web/src/main.ts b/web/src/main.ts
index b6911c5..dc396d3 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -69,6 +69,7 @@ import type { TmPane } from './tm-pane'
 import { createTransport } from './transport'
 import type { AsmState, LambdaState, TmState } from './types'
 import { assertTokenClasses } from './types'
+import { createUnsaved } from './unsaved'
 import { pairLabel, sourceViewHeader, viewMenu } from './view-header'
 import {
   defaultFocus,
@@ -898,6 +899,9 @@ async function main(): Promise<EditorView> {
    * What is fixed is the pretence: this flag means "reported at most once", never "shown for as long as
    * it matters".
    */
+  /** The notice line's resting sentence about storage, in two halves: the copies' and the program's (`unsaved.ts`). */
+  const unsaved = createUnsaved((line) => notices.rest(line))
+
   /**
    * Say that copies are no longer being saved.
    *
@@ -923,9 +927,13 @@ async function main(): Promise<EditorView> {
    * be ordered after both — an ordering that cost three attempts and two `TypeError`s, and that nothing
    * here depends on any more. `refreshBuffers`'s own start-up call, near the end of `main()`, carries
    * what is left of that argument.
+   *
+   * **HALF OF ONE SENTENCE SINCE PLAN 7 PART 6a** (spec §4.3): the program's writer below reports into the same
+   * resting line, and `unsaved.ts` words whichever of the two is failing. While only the copies fail, the line reads
+   * as it always did.
    */
   const reportStorageFailure = (): void => {
-    notices.rest('copies are not being saved — this browser’s storage for this site is full')
+    unsaved.refused('copies')
   }
 
   /**
@@ -948,9 +956,9 @@ async function main(): Promise<EditorView> {
   const writeBuffersStorage = (raw: string, hasBuffers: boolean): void => {
     try {
       localStorage.setItem(BUFFERS_STORAGE_KEY, raw)
-      // THE CONDITION ENDED, SO THE WARNING DOES — `reportStorageFailure`'s own doc has the argument.
-      // `rest(null)` on a line that is not resting on anything costs a comparison.
-      notices.rest(null)
+      // THE CONDITION ENDED, SO THE WARNING DOES — its copies half: `reportStorageFailure`'s own doc has the
+      // argument, and a program that is still not being saved keeps its own half.
+      unsaved.saved('copies')
     } catch {
       if (hasBuffers) reportStorageFailure()
     }
@@ -995,16 +1003,29 @@ async function main(): Promise<EditorView> {
     writeBuffersStorage(serializeBuffers(payload), payload.buffers.length > 0)
   }
 
+  /**
+   * Whether the program has changed from the one the page loaded — typed, a picked example, another encoding — at any
+   * write so far. Once true it stays true for the rest of the page load.
+   */
+  let programChanged = false
+
   /**
    * Store the program — `compile.ts` calls this as each compile posts, with the text and the encoding it posted (Plan 7
-   * part 6a spec §4.3). A failure is swallowed, as the layout writer's is: the program still compiles for the rest of
-   * this page load, and only a reload loses it.
+   * part 6a spec §4.3).
+   *
+   * **A REFUSED WRITE IS REPORTED ONLY ONCE THE PROGRAM HAS CHANGED FROM WHAT WAS LOADED (spec row 17)**, as the
+   * copies' writer reports only when there are copies to lose (`hasBuffers`, above). A changed program is work not yet
+   * saved; the first-load example, or a stored program only looked at, is not — so a visitor on blocked storage who
+   * only looks at the example sees no resting line, and one who edits it is told from their first edit's write on.
+   * Compared with what was loaded rather than latched on a gesture, so an edit undone before its write never counts.
    */
   const writeProgramStorage = (text: string, encoding: string): void => {
+    if (text !== loaded.text || encoding !== loaded.encoding) programChanged = true
     try {
       localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram({ text, encoding }))
+      unsaved.saved('program')
     } catch {
-      // Nothing to do — the same tradeoff `writeLayoutStorage` makes.
+      if (programChanged) unsaved.refused('program')
     }
   }
 
diff --git a/web/src/unsaved.ts b/web/src/unsaved.ts
new file mode 100644
index 0000000..c97a328
--- /dev/null
+++ b/web/src/unsaved.ts
@@ -0,0 +1,35 @@
+/**
+ * WHAT IS NOT BEING SAVED — Plan 7 part 6a spec §4.3 and row 17: the notice line's one resting state, now said for two
+ * writers. The copies' writer (`main.ts`'s `writeBuffersStorage`) and the program's each report a refused write only
+ * when they have something to lose, and the line has one resting sentence, so the sentence names whichever of the two
+ * is failing — the program, the copies, or both — and each writer's success takes back only its own half.
+ */
+
+/** A store whose refused writes are reported: the one holding the program, or the one holding the copies. */
+export type UnsavedStore = 'program' | 'copies'
+
+/**
+ * The resting sentence for what is failing, or `null` when nothing is. The copies' alone is the sentence
+ * `buffers-quota.test.ts` has always pinned.
+ */
+export function unsavedLine(program: boolean, copies: boolean): string | null {
+  const what = program ? (copies ? 'the program and copies are' : 'the program is') : copies ? 'copies are' : null
+  return what === null ? null : `${what} not being saved — this browser’s storage for this site is full`
+}
+
+export type Unsaved = {
+  /** A write to `store` was refused, and the writer has something to lose. */
+  refused(store: UnsavedStore): void
+  /** A write to `store` went through: its half of the sentence goes, and the other's stays. */
+  saved(store: UnsavedStore): void
+}
+
+/** Which stores are failing, handing the whole sentence to `rest` — the app's `Notices.rest` — at every change. */
+export function createUnsaved(rest: (line: string | null) => void): Unsaved {
+  const failing: Record<UnsavedStore, boolean> = { program: false, copies: false }
+  const set = (store: UnsavedStore, value: boolean): void => {
+    failing[store] = value
+    rest(unsavedLine(failing.program, failing.copies))
+  }
+  return { refused: (store) => set(store, true), saved: (store) => set(store, false) }
+}
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  56 passed (56)
Tests  781 passed (781)
```

Run: `cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=24G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --working-directory="$PWD" pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  126 passed (126)
Tests  822 passed (822)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each.** In the replay, 8 of 8 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | a refused write reported before any change (spec §8's changed-guard) — `main.ts`: `      if (programChanged) unsaved.refused('program') ⏎ ` → `      unsaved.refused('program') ⏎ ` | `cd web && pnpm exec vitest run --project node tests/node/unsaved.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/program-quota.test.ts` | `tests/browser/program-quota.test.ts > a program write refused by storage > says nothing while the page shows the program it loaded` |
| 2 | no change ever counted — `main.ts`: `    if (text !== loaded.text \|\| encoding !== loaded.encoding) programChanged = true ⏎ ` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/unsaved.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/program-quota.test.ts` | `tests/browser/program-quota.test.ts > a program write refused by storage > says the program is not being saved once an edit is refused`, `tests/browser/program-quota.test.ts > a program write refused by storage > keeps saying so when a write of the copies goes through` |
| 3 | the copies' success clears the program's half — `main.ts`: `      unsaved.saved('copies') ⏎ ` → `      notices.rest(null) ⏎ ` | `cd web && pnpm exec vitest run --project node tests/node/unsaved.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/program-quota.test.ts tests/browser/buffers-quota.test.ts` | `tests/browser/program-quota.test.ts > a program write refused by storage > keeps saying so when a write of the copies goes through` |
| 4 | the program's success never takes its half back — `main.ts`: `      unsaved.saved('program') ⏎ ` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/unsaved.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/program-quota.test.ts` | `tests/browser/program-quota.test.ts > a program write refused by storage > takes it back once a write of the program goes through` |
| 5 | the copies' refusal reported as the program's — `main.ts`: `    unsaved.refused('copies') ⏎ ` → `    unsaved.refused('program') ⏎ ` | `cd web && pnpm exec vitest run --project node tests/node/unsaved.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/buffers-quota.test.ts tests/browser/buffers-quota-restored.test.ts` | `tests/browser/buffers-quota.test.ts > a full store > says the condition once, however many writes fail, and lets the gesture speak`, `tests/browser/buffers-quota.test.ts > a full store > returns to the storage warning when the notice over it ends`, `tests/browser/buffers-quota.test.ts > a full store > shows the warning again without saying it again`, `tests/browser/buffers-quota.test.ts > a full store > clears the warning once a write succeeds` |
| 6 | the line built from the last store alone — `unsaved.ts`: `    rest(unsavedLine(failing.program, failing.copies)) ⏎ ` → `    rest(unsavedLine(value && store === 'program', value && store === 'copies')) ⏎ ` | `cd web && pnpm exec vitest run --project node tests/node/unsaved.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/program-quota.test.ts` | `tests/node/unsaved.test.ts > createUnsaved > hands the whole sentence on at every change, and a success takes back only its own half`, `tests/node/unsaved.test.ts > createUnsaved > leaves a failing store failing when the other one saves`, `tests/browser/program-quota.test.ts > a program write refused by storage > keeps saying so when a write of the copies goes through` |
| 7 | both failing named as the program alone — `unsaved.ts`: `(copies ? 'the program and copies are' : 'the program is')` → `'the program is'` | `cd web && pnpm exec vitest run --project node tests/node/unsaved.test.ts` | `tests/node/unsaved.test.ts > unsavedLine > names whichever store is failing, and both when both are`, `tests/node/unsaved.test.ts > createUnsaved > hands the whole sentence on at every change, and a success takes back only its own half` |
| 8 | the copies' sentence reworded — `unsaved.ts`: `: copies ? 'copies are' : null` → `: copies ? 'the copies are' : null` | `cd web && pnpm exec vitest run --project node tests/node/unsaved.test.ts`; then `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/buffers-quota.test.ts` | `tests/node/unsaved.test.ts > unsavedLine > says what it always said while only the copies fail`, `tests/node/unsaved.test.ts > createUnsaved > hands the whole sentence on at every change, and a success takes back only its own half`, `tests/node/unsaved.test.ts > createUnsaved > leaves a failing store failing when the other one saves`, `tests/browser/buffers-quota.test.ts > a full store > says the condition once, however many writes fail, and lets the gesture speak`, `tests/browser/buffers-quota.test.ts > a full store > returns to the storage warning when the notice over it ends` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
A refused program write is reported once the program has changed

The program's writer reports a refused write only once the program has
changed from what the page loaded — its text or its encoding — and from
then on for the rest of the page load (spec §4.3, row 17), as the
copies' writer reports only when there are copies to lose. Both report
into the notice line's one resting state: `unsaved.ts` words whichever
store is failing, the program, the copies or both, and each writer's
success takes back only its own half. While only the copies fail, the
line reads as it always did.
````

---

### Task 5: `examples ▾`: the menu, a pick with its undo, and the controls gate walking every header menu and form control

**Files:**
- Modify: `web/index.html` (the button and its popover after `copies ▾`), `web/src/app-header.ts` (`exampleItems`), `web/src/main.ts` (the two mount points, `replaceProgram`, `openExample`, the menu's `wireMenu`), `web/src/style.css` (`#examples` in the header buttons' rule; the menu's items)
- Modify (tests): `web/tests/browser/harness.ts` (`SHELL`), `web/tests/node/harness.test.ts` (the two ids), `web/tests/browser/controls-gate.test.ts` (the widening)
- Test: `web/tests/browser/examples-menu.test.ts`

**Interfaces:**
- Consumes Task 1's `EXAMPLES`, `EXAMPLE_ENCODING` and `Example`; Task 2's `StoredProgram`.
- Produces `app-header.ts`'s `exampleItems(menu: HTMLElement, examples: readonly Example[], pick: (e: Example) => void): void`; the markup `#examples` and `#examples-menu`; `main.ts`'s `replaceProgram(program: StoredProgram): void` and `openExample(example: Example): void`; in the gate, `formLabel`, `FORM_CONTROLS` and `check()` answering the controls it walked.

**THE MENU IS THE HEADER'S OWN KIND** (spec §4.2): a native popover wired by `wireMenu`, its items rebuilt on each open from the manifest, each its title over its description in two spans, named by `aria-label` as the view menu's two-line items are. `wireMenu` puts the focus on the first item, and Escape closes it with the focus back on its button.

**A PICK REPLACES THE PROGRAM AT ONCE, UNDER `unary`** (§4.5): the picker is set and the whole document replaced in one dispatch, whose update listener schedules the compile as for any edit; the notice says `opened the example <title>` and offers `undo`, which puts back the text and encoding the pick replaced and the focus in the source editor. The workspace is untouched.

**THE GATE WALKS EVERY FORM CONTROL AND EVERY HEADER MENU ON THE PAGE** (§6, row 15): `button, select, input, textarea`, less a hidden input, and a control in a `<dialog>` only while it is open; every form control held to its wrapping `<label>`; and every `header.bar button[aria-controls]` opened in turn, each asserted to open, with `#examples` asserted among them and the settings menu's `#format-on-blur` among the controls walked. The app has no hidden input and no dialog, so a case puts one of each on the page to show the walk's two new exclusions. `=` joins `+` as a symbol a name may carry (the prototype's finding 1).

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=5
diff --git a/web/tests/browser/controls-gate.test.ts b/web/tests/browser/controls-gate.test.ts
index 4323405..caa1d75 100644
--- a/web/tests/browser/controls-gate.test.ts
+++ b/web/tests/browser/controls-gate.test.ts
@@ -5,7 +5,7 @@ import { SHELL, until } from './harness'
 
 /**
  * **EVERY CONTROL, AS A CLASS** — umbrella §8.1, Plan 7 part 2 spec §14. Rather than one test per control,
- * this walks every button and select the page holds, with every menu opened in turn, and asserts three things
+ * this walks every control the page holds, with every menu opened in turn, and asserts three things
  * of each: it has an accessible name that is not a bare glyph (rule 1), the name matches its visible label or
  * its tooltip (rule 1), and it is reachable by keyboard (rule 5). A control added later that breaks a rule
  * fails here without anyone having to remember to test it.
@@ -33,8 +33,9 @@ function nameOf(el: HTMLElement): string {
  * inside one is not a label the name has to match.
  */
 /**
- * What a sighted user reads beside a `<select>`: the text of the `<label>` wrapping it, if any, with the
- * select's own options left out.
+ * What a sighted user reads beside a form control — a `<select>`, an `<input>` or a `<textarea>`: the text of the
+ * `<label>` wrapping it, if any, with the control itself left out. A select's options and a textarea's text are its
+ * value, not its label.
  *
  * **WITHOUT THIS THE CHECK WAS A TAUTOLOGY.** It read the select's accessible NAME as its visible label
  * too, so `expect([visible, title]).toContain(name)` compared a value with itself and an `aria-label`
@@ -56,14 +57,17 @@ function nameOf(el: HTMLElement): string {
  * next person to add a select to this app should update this paragraph and should not expect a red test
  * to remind them.
  */
-function selectLabel(el: HTMLElement): string {
+function formLabel(el: HTMLElement): string {
   const label = el.closest('label')
   if (label === null) return el.title.trim()
   const copy = label.cloneNode(true) as HTMLElement
-  for (const control of copy.querySelectorAll('select, [aria-hidden="true"]')) control.remove()
+  for (const control of copy.querySelectorAll('select, input, textarea, [aria-hidden="true"]')) control.remove()
   return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
 }
 
+/** The controls whose label is a wrapping `<label>` rather than their own text. */
+const FORM_CONTROLS = 'select, input, textarea'
+
 function visibleLabel(el: HTMLElement): string {
   const copy = el.cloneNode(true) as HTMLElement
   for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
@@ -86,9 +90,9 @@ const isGlyph = (s: string) => !/[\p{L}\p{N}]/u.test(s)
  * A symbol a reader would have to name aloud, inside a name that otherwise reads as words — `◐system`,
  * where a decorative glyph sits in a text node beside the word instead of being hidden from the name.
  *
- * **`+` IS THE ONE EXCEPTION, AND IT IS THE DESIGN'S OWN**: `+ view` reads as "plus view", which is the
- * button. Every other symbol this app draws is an `icons.ts` SVG, which carries `aria-hidden` and so
- * never reaches a name at all.
+ * **`+` IS AN EXCEPTION, AND IT IS THE DESIGN'S OWN**: `+ view` reads as "plus view", which is the
+ * button. Every other symbol this app draws as decoration is an `icons.ts` SVG, which carries `aria-hidden`
+ * and so never reaches a name at all.
  *
  * **THE CHECK IS BOUNDED TO `\p{So}` AND `\p{Sm}`, AND NAMING WHAT THAT EXCLUDES IS THE POINT OF THIS
  * PARAGRAPH.** Those two are Unicode's symbol-other and symbol-math categories; `·` (U+00B7, `Po`) and
@@ -98,11 +102,20 @@ const isGlyph = (s: string) => !/[\p{L}\p{N}]/u.test(s)
  * markup — where they separate clauses a reader runs together rather than standing in for a word. So a
  * green run here says no SYMBOL reached a name. It says nothing about punctuation, and widening the
  * class to catch `·` would fail on names the design asked for rather than on a defect.
+ *
+ * **`=` IS THE SECOND EXCEPTION, AND IT IS PROGRAM TEXT (Plan 7 part 6a).** An example in `examples ▾` is named by its
+ * title, and one title is the program `let x = 40; x + 2`: its `=` is not a glyph standing in for a word but the
+ * program's own operator, which a reader says as "equals", as they say its `+`.
  */
-const straySymbol = (s: string) => /[\p{So}\p{Sm}]/u.test(s.replaceAll('+', ''))
+const straySymbol = (s: string) => /[\p{So}\p{Sm}]/u.test(s.replaceAll('+', '').replaceAll('=', ''))
 
 /**
- * Every control a user can meet right now.
+ * Every control a user can meet right now: every button, select, input and textarea (Plan 7 part 6a spec §6), but a
+ * hidden input, which no one meets.
+ *
+ * **A CONTROL IN A `<dialog>` IS MET ONLY WHILE THE DIALOG IS OPEN, AS ONE IN A POPOVER IS.** A closed dialog is
+ * neither `[hidden]` nor a popover, so without its own clause its controls would be walked, and would fail the focus
+ * check for being unreachable.
  *
  * **`closest('[hidden]')`, NOT `el.hidden` — the difference is a whole panel.** A collapsed or unmounted
  * panel hides its own element (`pane-chrome.ts`'s `textPanel` hides the panel until an editor is
@@ -112,21 +125,26 @@ const straySymbol = (s: string) => /[\p{So}\p{Sm}]/u.test(s.replaceAll('+', ''))
  * reachability check below mean what it says.
  */
 function controls(): HTMLElement[] {
-  return [...document.querySelectorAll<HTMLElement>('button, select')].filter((el) => {
+  return [...document.querySelectorAll<HTMLElement>('button, select, input, textarea')].filter((el) => {
+    if (el.matches('input[type="hidden"]')) return false
     if (el.closest('[hidden]') !== null) return false
+    const dialog = el.closest('dialog')
+    if (dialog !== null && !dialog.open) return false
     const popover = el.closest<HTMLElement>('[popover]')
     return popover === null || popover.matches(':popover-open')
   })
 }
 
-function check(where: string): void {
-  for (const el of controls()) {
+/** Hold every control on the page to the rules, and answer the ones it held. */
+function check(where: string): HTMLElement[] {
+  const walked = controls()
+  for (const el of walked) {
     const name = nameOf(el)
     const id = `${where}: <${el.tagName.toLowerCase()} class="${el.className}"> named ${JSON.stringify(name)}`
     expect(name, id).not.toBe('')
     expect(isGlyph(name), `${id} is a bare glyph`).toBe(false)
     expect(straySymbol(name), `${id} carries a symbol a reader would have to name aloud`).toBe(false)
-    const visible = el.tagName === 'SELECT' ? selectLabel(el) : visibleLabel(el)
+    const visible = el.matches(FORM_CONTROLS) ? formLabel(el) : visibleLabel(el)
     if (visible !== '' && !isGlyph(visible))
       expect([visible, el.title.trim()], `${id}: name ≠ label or tooltip`).toContain(name)
     else expect(el.title.trim(), `${id}: a glyph-only control's tooltip must be its name`).toBe(name)
@@ -146,6 +164,7 @@ function check(where: string): void {
       expect(document.activeElement, `${id} cannot take the focus`).toBe(el)
     }
   }
+  return walked
 }
 
 beforeAll(async () => {
@@ -210,13 +229,26 @@ describe.each(STATES)('every control in $name', ({ name, picks, tiled }) => {
 
   it('on the page as it stands', () => check(`${name}: page`))
 
-  it.each([['#workspace'], ['#new-view'], ['#buffers'], ['#settings']])('with %s open', (selector) => {
-    const button = document.querySelector<HTMLButtonElement>(selector)
-    expect(button, selector).not.toBeNull()
-    button?.click()
-    check(`${name}: ${selector}`)
-    const menu = document.getElementById(button?.getAttribute('aria-controls') ?? '')
-    if (menu?.matches(':popover-open')) menu.hidePopover()
+  /**
+   * **EVERY HEADER MENU, READ OFF THE PAGE RATHER THAN LISTED** — `viewLeaves`' reason: a list of the menus there were
+   * is a list that misses the next one. This was `#workspace`, `#new-view`, `#buffers` and `#settings`, and
+   * `examples ▾` joined the header without joining it (Plan 7 part 6a spec §6). The menus part 6a added are asserted
+   * among the ones walked, so the loop cannot pass by walking none.
+   */
+  it('with each header menu open', () => {
+    const openers = [...document.querySelectorAll<HTMLButtonElement>('header.bar button[aria-controls]')]
+    expect(openers.map((b) => b.id)).toEqual(expect.arrayContaining(['examples']))
+    const walked: string[] = []
+    for (const button of openers) {
+      button.click()
+      const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
+      // A MENU THAT NEVER OPENED IS A MENU WHOSE CONTROLS WERE NEVER WALKED — and a header button that opens nothing.
+      expect(menu?.matches(':popover-open'), `${name}: #${button.id} opened nothing`).toBe(true)
+      walked.push(...check(`${name}: #${button.id}`).map((el) => el.id))
+      if (menu?.matches(':popover-open')) menu.hidePopover()
+    }
+    // A FORM CONTROL THAT IS NOT A SELECT IS WALKED: the settings menu's checkbox, which `button, select` never reached.
+    expect(walked).toContain('format-on-blur')
   })
 
   it("with every view's title and ⋯ menu open", () => {
@@ -320,3 +352,33 @@ describe('every control in Explorer, with the copies menu in each of its states'
     if (menu?.matches(':popover-open')) menu.hidePopover()
   })
 })
+
+/**
+ * **WHAT THE WALK LEAVES OUT, HELD WHERE THE PAGE CANNOT SHOW IT** — Plan 7 part 6a spec §6. The app has no hidden
+ * input and no `<dialog>`, so nothing on it can say whether `controls()` skips a hidden input, or a dialog's controls
+ * while it is closed and not while it is open. These are put on the page for the case and taken off after it.
+ */
+describe('the walk itself', () => {
+  it('skips a hidden input, and a dialog’s controls while it is closed but not while it is open', () => {
+    const hidden = document.createElement('input')
+    hidden.type = 'hidden'
+    hidden.id = 'gate-hidden'
+    const dialog = document.createElement('dialog')
+    const inside = document.createElement('button')
+    inside.type = 'button'
+    inside.id = 'gate-dialog-button'
+    inside.textContent = 'close'
+    dialog.append(inside)
+    document.body.append(hidden, dialog)
+    try {
+      const ids = () => controls().map((el) => el.id)
+      expect(ids()).not.toContain('gate-hidden')
+      expect(ids()).not.toContain('gate-dialog-button')
+      dialog.show()
+      expect(ids()).toContain('gate-dialog-button')
+    } finally {
+      hidden.remove()
+      dialog.remove()
+    }
+  })
+})
diff --git a/web/tests/browser/examples-menu.test.ts b/web/tests/browser/examples-menu.test.ts
new file mode 100644
index 0000000..ee19120
--- /dev/null
+++ b/web/tests/browser/examples-menu.test.ts
@@ -0,0 +1,128 @@
+import type { EditorView } from '@codemirror/view'
+import { computeAccessibleName } from 'dom-accessibility-api'
+import { beforeAll, describe, expect, it } from 'vitest'
+import { page, userEvent } from 'vitest/browser'
+import { EXAMPLES, type Example } from '../../src/examples'
+import { SHELL, until } from './harness'
+
+/**
+ * **`examples ▾`: THE MENU, A PICK AND ITS UNDO** — Plan 7 part 6a spec §4.2, §4.5 and §6. Driven by real pointer
+ * clicks and by keys, because a synthetic `.click()` is not the gesture. The page opens on the program `setup.ts`
+ * stores, `let x = 40; x + 2`. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
+ */
+
+const example = (id: string): Example => EXAMPLES.find((e) => e.id === id) as Example
+const button = () => document.querySelector<HTMLButtonElement>('#examples') as HTMLButtonElement
+const menu = () => document.querySelector<HTMLElement>('#examples-menu') as HTMLElement
+const open = () => menu().matches(':popover-open')
+const items = () => [...menu().querySelectorAll<HTMLButtonElement>('button.example')]
+const item = (id: string) =>
+  menu().querySelector<HTMLButtonElement>(`button[data-example="${id}"]`) as HTMLButtonElement
+const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
+const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
+const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
+const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+
+let view: EditorView
+
+beforeAll(async () => {
+  await page.viewport(1280, 800)
+  document.body.innerHTML = SHELL
+  view = await (await import('../../src/main')).ready
+  await until(() => idle() && segments().length > 0, 'the first compile')
+})
+
+describe('examples ▾', () => {
+  it('sits after copies ▾, in the chrome of the header’s other buttons', () => {
+    const buffers = document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement
+    expect(buffers.compareDocumentPosition(button()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
+    const [a, b] = [buffers, button()].map((el) => el.getBoundingClientRect())
+    expect(b?.left).toBeGreaterThan(a?.right ?? Number.POSITIVE_INFINITY)
+    expect(b?.height).toBe(a?.height)
+    const [x, y] = [buffers, button()].map((el) => getComputedStyle(el))
+    for (const property of [
+      'borderTopStyle',
+      'borderTopWidth',
+      'paddingLeft',
+      'backgroundColor',
+      'fontFamily',
+    ] as const)
+      expect(y?.[property], property).toBe(x?.[property])
+  })
+
+  it('opens on a click, with every example in the manifest’s order and the focus on the first', async () => {
+    expect(computeAccessibleName(button())).toBe('examples')
+    expect(button().getAttribute('aria-expanded')).toBe('false')
+    await userEvent.click(button())
+    expect(open()).toBe(true)
+    expect(button().getAttribute('aria-expanded')).toBe('true')
+    expect(items().map((b) => b.dataset.example)).toEqual(EXAMPLES.map((e) => e.id))
+    // NAMED BY `aria-label`, SO THE NAME DOES NOT HANG ON THE TWO SPANS' `display` (spec §4.2).
+    const names = EXAMPLES.map((e) => `${e.title} ${e.description}`)
+    expect(items().map((b) => b.getAttribute('aria-label'))).toEqual(names)
+    expect(items().map((b) => computeAccessibleName(b))).toEqual(names)
+    expect(document.activeElement).toBe(items()[0])
+  })
+
+  it('draws each example as its title over a smaller, dimmer description', () => {
+    const b = item('sum-to')
+    const title = b.querySelector<HTMLElement>('.example-title') as HTMLElement
+    const description = b.querySelector<HTMLElement>('.example-description') as HTMLElement
+    expect(title.textContent).toBe('sum_to(5)')
+    expect(description.getBoundingClientRect().top).toBeGreaterThanOrEqual(title.getBoundingClientRect().bottom - 0.5)
+    expect(Number.parseFloat(getComputedStyle(description).fontSize)).toBeLessThan(
+      Number.parseFloat(getComputedStyle(title).fontSize),
+    )
+    expect(getComputedStyle(description).color).not.toBe(getComputedStyle(title).color)
+  })
+
+  it('opens a picked example under unary, and says so with an undo', async () => {
+    if (open()) menu().hidePopover()
+    // ANOTHER ENCODING FIRST, so the pick has one to replace and the undo one to put back.
+    await userEvent.selectOptions(picker(), 'binary')
+    await until(() => idle() && segments().length > 0, 'the compile under binary')
+    expect(picker().value).toBe('binary')
+
+    await userEvent.click(button())
+    await userEvent.click(item('fact'))
+    expect(open()).toBe(false)
+    expect(view.state.doc.toString()).toBe(example('fact').text)
+    expect(picker().value).toBe('unary')
+    expect(noticeText()).toBe('opened the example fact(4)')
+    expect(undoButton()?.textContent).toBe('undo')
+    await until(() => idle() && (segments()[1] ?? '').startsWith('asm 24'), 'the example’s compile')
+  })
+
+  it('puts back the text and the encoding it replaced on undo, with the focus in the editor', async () => {
+    await userEvent.click(undoButton() as HTMLButtonElement)
+    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
+    expect(picker().value).toBe('binary')
+    expect(document.activeElement).toBe(view.contentDOM)
+    await until(() => idle() && (segments()[0] ?? '').startsWith('λ 42'), 'the program’s compile')
+  })
+
+  it('opens and picks by keys: Enter opens it, Tab moves on, Enter picks', async () => {
+    button().focus()
+    await userEvent.keyboard('{Enter}')
+    expect(open()).toBe(true)
+    expect(document.activeElement).toBe(items()[0])
+    await userEvent.tab()
+    expect(document.activeElement).toBe(items()[1])
+    await userEvent.keyboard('{Enter}')
+    expect(open()).toBe(false)
+    expect(view.state.doc.toString()).toBe(example('closure').text)
+    expect(noticeText()).toBe('opened the example a closure')
+    expect(document.activeElement).toBe(button())
+  })
+
+  it('closes on Escape, with the focus back on its button', async () => {
+    button().focus()
+    await userEvent.keyboard('{Enter}')
+    expect(open()).toBe(true)
+    await userEvent.keyboard('{Escape}')
+    expect(open()).toBe(false)
+    expect(button().getAttribute('aria-expanded')).toBe('false')
+    expect(document.activeElement).toBe(button())
+  })
+})
diff --git a/web/tests/browser/harness.ts b/web/tests/browser/harness.ts
index a72e871..7bdd97d 100644
--- a/web/tests/browser/harness.ts
+++ b/web/tests/browser/harness.ts
@@ -33,6 +33,8 @@ export const SHELL = `
     <button type="button" id="new-view" aria-haspopup="menu" aria-controls="new-view-menu" aria-expanded="false">+ view</button>
     <div id="new-view-menu" class="header-menu" popover></div>
     <button type="button" id="buffers">copies <span aria-hidden="true">▾</span></button>
+    <button type="button" id="examples" aria-haspopup="menu" aria-controls="examples-menu" aria-expanded="false">examples <span aria-hidden="true">▾</span></button>
+    <div id="examples-menu" class="header-menu examples" popover></div>
     <label class="encoding">
       encoding
       <select id="encoding"></select>
diff --git a/web/tests/node/harness.test.ts b/web/tests/node/harness.test.ts
index f624e74..461d0ee 100644
--- a/web/tests/node/harness.test.ts
+++ b/web/tests/node/harness.test.ts
@@ -11,6 +11,8 @@ describe('SHELL', () => {
       '#reset-preset',
       '#new-view',
       '#buffers',
+      '#examples',
+      '#examples-menu',
       '#encoding',
       '#settings',
       '#style',
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/harness.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  1 failed | 6 passed (7)
```

Failing: `tests/node/harness.test.ts > SHELL against index.html > is the same markup the real page ships, from <header> to the end of the strip`.

Run: `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples-menu.test.ts tests/browser/controls-gate.test.ts`

Expected: exit 1, printing:

```text
Test Files  2 failed (2)
Tests  11 failed | 15 passed (26)
```

Failing: `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with each header menu open`, `tests/browser/examples-menu.test.ts > examples ▾ > sits after copies ▾, in the chrome of the header’s other buttons`, `tests/browser/examples-menu.test.ts > examples ▾ > opens on a click, with every example in the manifest’s order and the focus on the first`, `tests/browser/examples-menu.test.ts > examples ▾ > draws each example as its title over a smaller, dimmer description`, `tests/browser/examples-menu.test.ts > examples ▾ > opens a picked example under unary, and says so with an undo`, `tests/browser/examples-menu.test.ts > examples ▾ > puts back the text and the encoding it replaced on undo, with the focus in the editor`, `tests/browser/examples-menu.test.ts > examples ▾ > opens and picks by keys: Enter opens it, Tab moves on, Enter picks`, `tests/browser/examples-menu.test.ts > examples ▾ > closes on Escape, with the focus back on its button`.

- [ ] **Step 3: Write the code.**

````diff apply=source task=5
diff --git a/web/index.html b/web/index.html
index 6ea9bef..f650aca 100644
--- a/web/index.html
+++ b/web/index.html
@@ -47,6 +47,8 @@
       <button type="button" id="new-view" aria-haspopup="menu" aria-controls="new-view-menu" aria-expanded="false">+ view</button>
       <div id="new-view-menu" class="header-menu" popover></div>
       <button type="button" id="buffers">copies <span aria-hidden="true">▾</span></button>
+      <button type="button" id="examples" aria-haspopup="menu" aria-controls="examples-menu" aria-expanded="false">examples <span aria-hidden="true">▾</span></button>
+      <div id="examples-menu" class="header-menu examples" popover></div>
       <label class="encoding">
         encoding
         <select id="encoding"></select>
diff --git a/web/src/app-header.ts b/web/src/app-header.ts
index cb4cc8d..edc7ff2 100644
--- a/web/src/app-header.ts
+++ b/web/src/app-header.ts
@@ -1,11 +1,12 @@
+import type { Example } from './examples'
 import type { PaneChoice, SplitChoices } from './pane-chrome'
 import { bindingKey, pairLabel } from './view-header'
 import { PRESETS, type Preset, presetOf, type Switches } from './workspace'
 
 /**
- * THE APP HEADER'S MENUS — Plan 7 part 2 spec §6: the workspace menu, `+ view` and settings. Each is a native
- * popover beside the button that opens it, declared in `index.html` so the pre-paint script and the skin
- * selects need no change; this module wires what markup cannot.
+ * THE APP HEADER'S MENUS — Plan 7 part 2 spec §6: the workspace menu, `+ view` and settings, and `examples ▾` since
+ * part 6a. Each is a native popover beside the button that opens it, declared in `index.html` so the pre-paint script
+ * and the skin selects need no change; this module wires what markup cannot.
  */
 
 /**
@@ -61,6 +62,38 @@ export function addViewItems(menu: HTMLElement, choices: SplitChoices, pick: (c:
   menu.replaceChildren(...items)
 }
 
+/**
+ * Fill `examples ▾`'s menu: one item per example, in the manifest's order, each its title over its one-line description
+ * (Plan 7 part 6a spec §4.2). Picking one closes the menu before `pick` runs, as every header menu's item does.
+ *
+ * **NAMED BY `aria-label`, AS THE VIEW MENU'S TWO-LINE ITEMS ARE** (`view-header.ts`'s `item`): built from the content,
+ * the name would join the two spans with a space only while they are not `display: inline`, which is a rule about the
+ * stylesheet rather than about the item.
+ */
+export function exampleItems(menu: HTMLElement, examples: readonly Example[], pick: (e: Example) => void): void {
+  menu.replaceChildren(
+    ...examples.map((example) => {
+      const b = document.createElement('button')
+      b.type = 'button'
+      b.className = 'example'
+      b.dataset.example = example.id
+      b.setAttribute('aria-label', `${example.title} ${example.description}`)
+      const title = document.createElement('span')
+      title.className = 'example-title'
+      title.textContent = example.title
+      const description = document.createElement('span')
+      description.className = 'example-description'
+      description.textContent = example.description
+      b.append(title, description)
+      b.addEventListener('click', () => {
+        menu.hidePopover()
+        pick(example)
+      })
+      return b
+    }),
+  )
+}
+
 /** One switch in the workspace menu: what it is called, and the words its two values go by (spec §4). */
 export type SwitchRow = {
   readonly key: keyof Switches
diff --git a/web/src/main.ts b/web/src/main.ts
index dc396d3..605ade3 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -3,7 +3,7 @@ import { lintGutter, setDiagnostics as setCmDiagnostics } from '@codemirror/lint
 import { EditorState } from '@codemirror/state'
 import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
 import init, { captureClasses, encodings, tokenClasses } from '../../pkg/redextape_wasm.js'
-import { addViewItems, presetName, wireMenu, workspaceItems } from './app-header'
+import { addViewItems, exampleItems, presetName, wireMenu, workspaceItems } from './app-header'
 import {
   APPEARANCE_LABEL,
   type Appearance,
@@ -23,7 +23,7 @@ import { createDraw } from './draw'
 import { createEditorCustody } from './editor-custody'
 import { KeymapSetting, keymapSlot } from './editor-keymap'
 import { KEYMAP_LABEL, KEYMAP_MODES, parseKeymapMode, readFormatOnBlur, writeFormatOnBlur } from './editor-prefs'
-import { EXAMPLE_ENCODING, FIRST_LOAD } from './examples'
+import { EXAMPLE_ENCODING, EXAMPLES, type Example, FIRST_LOAD } from './examples'
 import { declineMark, focusMark, linkMark } from './highlight'
 import { History } from './history'
 import { icon } from './icons'
@@ -44,7 +44,7 @@ import type { PaneChoice } from './pane-chrome'
 import { createPaneHost, type LayoutEvent } from './pane-host'
 import { createPanel } from './panel'
 import { type LeafId, legOfPane, PaneCollection } from './panes'
-import { PROGRAM_STORAGE_KEY, parseProgram, serializeProgram } from './program-store'
+import { PROGRAM_STORAGE_KEY, parseProgram, type StoredProgram, serializeProgram } from './program-store'
 import type { Leg, RunReply } from './protocol'
 import { HISTORY_BYTES } from './protocol'
 import { asmCopyRow, copyLegOf, createReadout, type ProgramResult, tmCopyRow } from './readout'
@@ -198,6 +198,8 @@ async function main(): Promise<EditorView> {
    * opens something.
    */
   const buffersButton = document.querySelector<HTMLButtonElement>('#buffers')
+  const examplesButton = document.querySelector<HTMLButtonElement>('#examples')
+  const examplesMenu = document.querySelector<HTMLElement>('#examples-menu')
   const noticeHost = document.querySelector<HTMLElement>('#notice')
   const liveHost = document.querySelector<HTMLElement>('#live')
   // **`#views`, NOT `<main>` — spec §9.** `renderLayout` opens with `root.replaceChildren()`, so the
@@ -225,6 +227,8 @@ async function main(): Promise<EditorView> {
     !styleSelect ||
     !paletteSelect ||
     !buffersButton ||
+    !examplesButton ||
+    !examplesMenu ||
     !noticeHost ||
     !stepBarHost ||
     !inspectorHost ||
@@ -1469,6 +1473,41 @@ async function main(): Promise<EditorView> {
     ),
   )
 
+  /**
+   * Put `program` in the source editor: its encoding into the picker, and its text in one dispatch, whose update
+   * listener clears the link state and schedules the compile as it does for any edit. The compile reads the picker
+   * when it posts, `DEBOUNCE_MS` later, so it posts the two together.
+   */
+  const replaceProgram = (program: StoredProgram): void => {
+    picker.value = program.encoding
+    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: program.text } })
+  }
+
+  /**
+   * PICK AN EXAMPLE — Plan 7 part 6a spec §4.5. It replaces the program at once, under the default encoding, since the
+   * manifest's outcomes and descriptions are that encoding's; the workspace is untouched. The notice's `undo` puts back
+   * the text and the encoding it replaced, and so recompiles.
+   *
+   * **UNDO REMOVES THE CONTROL IT WAS ACTIVATED FROM, SO IT OWES THE FOCUS SOMEWHERE**, as a delete's undo does: the
+   * source editor, where the program came back.
+   */
+  const openExample = (example: Example): void => {
+    const before: StoredProgram = { text: view.state.doc.toString(), encoding: picker.value }
+    replaceProgram({ text: example.text, encoding: EXAMPLE_ENCODING })
+    notices.notify(`opened the example ${example.title}`, {
+      action: {
+        label: 'undo',
+        run: () => {
+          replaceProgram(before)
+          view.focus()
+        },
+      },
+    })
+  }
+
+  // `examples ▾` — spec §4.2: built on each open, as `+ view`'s menu is, from the manifest.
+  wireMenu(examplesButton, examplesMenu, () => exampleItems(examplesMenu, EXAMPLES, openExample))
+
   /**
    * Undo a delete — spec §10. The copy comes back under its own id and name, COLD, and is warmed; a
    * refusal at the cap leaves it paused, which is still a copy restored. The views the delete moved to
diff --git a/web/src/style.css b/web/src/style.css
index 7a97dc3..dbad1d5 100644
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -181,6 +181,7 @@ body {
 #workspace,
 #new-view,
 #buffers,
+#examples,
 #appearance,
 #settings {
   display: inline-flex;
@@ -282,6 +283,21 @@ body {
 #workspace-menu {
   min-width: 20rem;
 }
+/* AN EXAMPLE IS ITS TITLE OVER ITS ONE-LINE DESCRIPTION (Plan 7 part 6a spec §4.2), the view menu's two-line item in
+   the header menu's chrome. Wide enough for a description on one line at a desktop width, and no wider than the page
+   at a phone's, where a description wraps under its title. */
+#examples-menu {
+  min-width: 20rem;
+  max-width: min(36rem, calc(100vw - 2rem));
+}
+#examples-menu .example-title,
+#examples-menu .example-description {
+  display: block;
+}
+#examples-menu .example-description {
+  font-size: var(--step--2);
+  color: var(--fg-dim);
+}
 
 /* Same treatment as `.controls button` — chrome, not a new visual language.
 
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  56 passed (56)
Tests  781 passed (781)
```

Run: `cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=24G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --working-directory="$PWD" pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  127 passed (127)
Tests  818 passed (818)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each.** In the replay, 19 of 19 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | the menu opens empty — `main.ts`: `wireMenu(examplesButton, examplesMenu, () => exampleItems(examplesMenu, EXAMPLES, openExample))` → `wireMenu(examplesButton, examplesMenu)` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples-menu.test.ts tests/browser/controls-gate.test.ts` | `tests/browser/examples-menu.test.ts > examples ▾ > opens on a click, with every example in the manifest’s order and the focus on the first`, `tests/browser/examples-menu.test.ts > examples ▾ > draws each example as its title over a smaller, dimmer description`, `tests/browser/examples-menu.test.ts > examples ▾ > opens a picked example under unary, and says so with an undo`, `tests/browser/examples-menu.test.ts > examples ▾ > puts back the text and the encoding it replaced on undo, with the focus in the editor`, `tests/browser/examples-menu.test.ts > examples ▾ > opens and picks by keys: Enter opens it, Tab moves on, Enter picks` |
| 2 | a pick keeps the encoding in force — `main.ts`: `replaceProgram({ text: example.text, encoding: EXAMPLE_ENCODING })` → `replaceProgram({ text: example.text, encoding: picker.value })` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples-menu.test.ts` | `tests/browser/examples-menu.test.ts > examples ▾ > opens a picked example under unary, and says so with an undo` |
| 3 | undo restores the example's default encoding — `main.ts`: `const before: StoredProgram = { text: view.state.doc.toString(), encoding: picker.value }` → `const before: StoredProgram = { text: view.state.doc.toString(), encoding: EXAMPLE_ENCODING }` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples-menu.test.ts` | `tests/browser/examples-menu.test.ts > examples ▾ > puts back the text and the encoding it replaced on undo, with the focus in the editor` |
| 4 | undo restores the example's text — `main.ts`: `const before: StoredProgram = { text: view.state.doc.toString(), encoding: picker.value }` → `const before: StoredProgram = { text: example.text, encoding: picker.value }` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples-menu.test.ts` | `tests/browser/examples-menu.test.ts > examples ▾ > puts back the text and the encoding it replaced on undo, with the focus in the editor` |
| 5 | the notice offers no *undo* — `main.ts`: `        label: 'undo', ⏎         run: () => { ⏎           replaceProgram(before)` → `        label: 'back', ⏎         run: () => { ⏎           replaceProgram(before)` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples-menu.test.ts` | `tests/browser/examples-menu.test.ts > examples ▾ > opens a picked example under unary, and says so with an undo` |
| 6 | undo leaves the focus on the copies button — `main.ts`: `          replaceProgram(before) ⏎           view.focus() ⏎ ` → `          replaceProgram(before) ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples-menu.test.ts` | `tests/browser/examples-menu.test.ts > examples ▾ > puts back the text and the encoding it replaced on undo, with the focus in the editor` |
| 7 | an item named by its layout rather than its `aria-label` — `app-header.ts`: ``       b.setAttribute('aria-label', `${example.title} ${example.description}`) ⏎  `` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples-menu.test.ts tests/browser/controls-gate.test.ts` | `tests/browser/examples-menu.test.ts > examples ▾ > opens on a click, with every example in the manifest’s order and the focus on the first` |
| 8 | the description drawn at the title's size — `style.css`: `#examples-menu .example-description { ⏎   font-size: var(--step--2); ⏎ ` → `#examples-menu .example-description { ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples-menu.test.ts` | `tests/browser/examples-menu.test.ts > examples ▾ > draws each example as its title over a smaller, dimmer description` |
| 9 | the title and description drawn inline — `style.css`: `#examples-menu .example-title, ⏎ #examples-menu .example-description { ⏎   display: block; ⏎ }` → `#examples-menu .example-title, ⏎ #examples-menu .example-description { ⏎   display: inline; ⏎ }` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples-menu.test.ts tests/browser/controls-gate.test.ts` | `tests/browser/examples-menu.test.ts > examples ▾ > draws each example as its title over a smaller, dimmer description` |
| 10 | `examples ▾` without the header buttons' chrome — `style.css`: `#buffers, ⏎ #examples, ⏎ #appearance,` → `#buffers, ⏎ #appearance,` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples-menu.test.ts` | `tests/browser/examples-menu.test.ts > examples ▾ > sits after copies ▾, in the chrome of the header’s other buttons` |
| 11 | `index.html` without the menu `SHELL` carries — `index.html`: `      <div id="examples-menu" class="header-menu examples" popover></div> ⏎ ` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/harness.test.ts` | `tests/node/harness.test.ts > SHELL against index.html > is the same markup the real page ships, from <header> to the end of the strip` |
| 12 | the gate's selector back to `button, select` (spec §8's own) — `tests/browser/controls-gate.test.ts`: `document.querySelectorAll<HTMLElement>('button, select, input, textarea')` → `document.querySelectorAll<HTMLElement>('button, select')` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with each header menu open` |
| 13 | the gate misses `examples ▾` — `tests/browser/controls-gate.test.ts`: `document.querySelectorAll<HTMLButtonElement>('header.bar button[aria-controls]')` → `document.querySelectorAll<HTMLButtonElement>('header.bar button[aria-controls]:not(#examples)')` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with each header menu open` |
| 14 | the label rule for selects alone — `tests/browser/controls-gate.test.ts`: `const visible = el.matches(FORM_CONTROLS) ? formLabel(el) : visibleLabel(el)` → `const visible = el.tagName === 'SELECT' ? formLabel(el) : visibleLabel(el)` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with each header menu open` |
| 15 | the gate walks a hidden input — `tests/browser/controls-gate.test.ts`: `    if (el.matches('input[type="hidden"]')) return false ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > the walk itself > skips a hidden input, and a dialog’s controls while it is closed but not while it is open` |
| 16 | the gate walks a closed dialog — `tests/browser/controls-gate.test.ts`: `    if (dialog !== null && !dialog.open) return false ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > the walk itself > skips a hidden input, and a dialog’s controls while it is closed but not while it is open` |
| 17 | the gate skips an open dialog too — `tests/browser/controls-gate.test.ts`: `    if (dialog !== null && !dialog.open) return false ⏎ ` → `    if (dialog !== null) return false ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > the walk itself > skips a hidden input, and a dialog’s controls while it is closed but not while it is open` |
| 18 | `=` a stray symbol again — `tests/browser/controls-gate.test.ts`: `s.replaceAll('+', '').replaceAll('=', '')` → `s.replaceAll('+', '')` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with each header menu open` |
| 19 | `examples ▾` wired to nothing — `main.ts`: `  wireMenu(examplesButton, examplesMenu, () => exampleItems(examplesMenu, EXAMPLES, openExample)) ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/examples-menu.test.ts tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with each header menu open`, `tests/browser/examples-menu.test.ts > examples ▾ > opens on a click, with every example in the manifest’s order and the focus on the first`, `tests/browser/examples-menu.test.ts > examples ▾ > draws each example as its title over a smaller, dimmer description`, `tests/browser/examples-menu.test.ts > examples ▾ > opens a picked example under unary, and says so with an undo`, `tests/browser/examples-menu.test.ts > examples ▾ > puts back the text and the encoding it replaced on undo, with the focus in the editor`, `tests/browser/examples-menu.test.ts > examples ▾ > opens and picks by keys: Enter opens it, Tab moves on, Enter picks`, `tests/browser/examples-menu.test.ts > examples ▾ > closes on Escape, with the focus back on its button` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
examples ▾: the menu, a pick with its undo, and the controls gate walking every header menu and form control

`examples ▾` sits after `copies ▾`, a native popover wired by `wireMenu`
whose items are built on each open from the manifest: each its title
over its one-line description, named by `aria-label` (spec §4.2). A pick
replaces the program at once under the default encoding and says so with
an `undo`, which puts back the text and the encoding it replaced and the
focus in the editor; the workspace is untouched (§4.5). The controls
gate walks inputs, text areas and open dialogs beside buttons and
selects, holds every form control to its wrapping label, and opens every
header menu it finds on the page, asserting that each one opens and that
`examples ▾` is among them (§6, row 15). `=` joins `+` as a symbol a
name may carry, for the program text of the first example's title.
````

---

### Task 6: Verification, the check by hand, and the roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` — the entry for this PR, appended at the end

**Nothing here changes code.** The web gates, a look at the app, and the entry.

- [ ] **Step 1: Run the gates**, one after another, and record each command and its exit code:
  - `cd web && pnpm exec biome ci --error-on-warnings`
  - `cd web && pnpm run typecheck`
  - `cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --setenv=CARGO_HOME="$CARGO_HOME" --setenv=RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.local/share/rustup}" --working-directory="$PWD" pnpm run test:coverage` — the whole suite and its floors, statements 95, branches 89, functions 97, lines 97. **If it is OOM-killed** (`Finished with result: oom-kill`), run it again with `--maxWorkers=4` under the same cap, and if that is killed too, under `MemoryMax=24G`; record every run, its `Memory peak` line and its result (the prototype's finding 10).
  - `cd web && pnpm run build:app`
  - from the repository root, for each of `text-bytes citations attributions doc-figures shared-docs lua colours`: `scripts/check-<name>.sh --self-test`, then `scripts/check-<name>.sh`.

  Expected: every one exits 0 but a coverage run killed at the cap. **The replay's run of this step**, on its last commit, whose tree is the prototype's head: `biome ci`, `typecheck` and `build:app` exited 0; the seven hygiene scans, each `--self-test` and then alone, fourteen runs, exited 0; `test:coverage` under 16G was killed (`Finished with result: oom-kill`, `Memory peak: 16G`), then passed with `--maxWorkers=4` under 16G — 183 files, 1,599 tests, statements 96.84, branches 90.51, functions 97.91, lines 98.32, peak 15.7G — and under 24G at 96.91, 90.56, 97.91 and 98.39, peak 18.4G. On the prototype's head it was killed under 16G with the default workers and with `--maxWorkers=4`, and passed under 24G with 1,599 tests at 96.84, 90.48, 97.91 and 98.32. `444c92c`, the base, passed under 24G with 1,559 tests at 96.89, 90.45, 97.88 and 98.39.

  **The Rust gates, `check-slow.sh` and the Docker image are not run, and the entry says why**: the branch touches no Rust and no wasm, so `check-all`'s Rust legs, `check-slow.sh` and the llvm-cov floor test the tree `main` already passed; and the image's web stage runs `pnpm run build:app` over `web/` as copied, which the gates run, with nothing added outside `web/` and nothing `.dockerignore` leaves out (`web/src/examples/*.rxt` are sources, not build output).

- [ ] **Step 2: Look at the app, by hand**, from `cd web && pnpm run dev`, in a browser profile with no storage for the dev server's origin: at 1280×800 and at a phone's width (390×844), in each preset (Explorer, Debugger, Stage), light and dark, with `examples ▾` open. Record: the first visit opening on `sum_to(5)` in Explorer, every leg at 15; the menu's items, each title over its description, none clipped, the menu inside the viewport at a phone's width with no horizontal scroll; a pick by pointer and by keys, its notice and its `undo`; a reload keeping the program and its encoding. A finding goes to the whole-branch review, not into this task. **The prototype's look, before this plan:** at 1280×800 in Explorer, light and dark, and at 390×844 in dark, the menu drew each title over its description with none clipped, and at 390 it ran from x = 70 to x = 390, flush with the right edge, with the page's scroll width 390.

- [ ] **Step 3: Write the roadmap entry.** Read the roadmap's last two entries first and match their shape. Append it at the end: a heading `` #### PLAN 7 PART 6a-i, … (2026-09-29, branch `plan7-part6a-examples-and-links`, `18f8225..<last code commit>`, N commits, plus this entry) ``, where the range excludes the entry's own commit and N counts every commit in it, the spec's and this plan's included; `##### ` sections in the entry's own voice — what it built, what the prototype and the replay found (this plan's two lists), what the reviews found; `##### WHAT THIS DID NOT CLOSE`; and `##### VERIFICATION`, ending with a table headed **Every count this entry quotes, with what produces it**, one row per figure, each naming the command that produces it, **every one of them run before the entry is committed**. What it did not close includes, at least: 6a-ii, the share links; the prototype's findings 1, 7 and 8, each a decision the spec did not make; `buffers-quota-empty.test.ts`, green and blind (finding 9); the coverage run's peak against the 16G cap (finding 10); and the three gates not run, with the reason above. Write it last, after the final code commit, so no fix makes its range or its figures stale.

- [ ] **Step 4: Commit the entry**, as the last commit before the PR opens:

````text
Roadmap: Plan 7 part 6a-i — examples, the stored program and the first-load example
````
