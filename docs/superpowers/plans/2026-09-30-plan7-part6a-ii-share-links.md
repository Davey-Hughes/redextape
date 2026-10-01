# Plan 7 part 6a-ii — share links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the header a `share` popover holding a link to the program, its encoding, the workspace and where each leg stands; open such a link at start-up ahead of both stores and when one is pasted into an open page, with an `undo` that stays offered until it is withdrawn; and carry each leg to its link's step, continuing its recording up to ten times and clamping with a notice where the run ends first — the second of [Plan 7 part 6a](../specs/2026-09-29-plan7-part6a-examples-and-links-design.md)'s two PRs, its §1 6a-ii row: §5, and 6a-ii's parts of §6, §7 and §8.

**Architecture:** `share-link.ts` is the link's codec: `#s=` and the unpadded base64url of the deflate-raw of a version 1 JSON payload, through the browser's own `CompressionStream`, read back by a validating decoder that inflates a kilobyte at a time and refuses past `MAX_LINK_BYTES`. `share-popover.ts` builds `share`'s popover on each open from what `main.ts` hands it. `main.ts` reads a link in the fragment after `init()` and before either store, listens for `hashchange`, clears the fragment, replaces the program and the workspace, builds every view again on the program through `PaneHost.rebuildViews`, and keeps the open's `undo` apart from the notice carrying it. `share-positions.ts`'s `LinkPositions` hears the program session's replies and holds each leg's position on `LegState.pending` until the frames reach it, where the step line reads it and a step gesture takes it away.

**Tech Stack:** TypeScript (vanilla DOM, CodeMirror), the browser's `CompressionStream`, `DecompressionStream`, `history.replaceState` and `navigator.clipboard`, Vitest (node and browser projects, Playwright Chromium, CDP for clipboard permissions). No Rust.

## Global Constraints

- The spec is `docs/superpowers/specs/2026-09-29-plan7-part6a-examples-and-links-design.md` at `90d181c`. This plan is its §1 6a-ii row; 6a-i's rows are merged (#120). Where this plan and the spec disagree, stop and ask.
- A link is `#s=` and the unpadded base64url of deflate-raw of the UTF-8 of `{ version: 1, program, encoding, workspace, positions }`, through `CompressionStream('deflate-raw')`, with `workspace` as `serializeWorkspace` wrote it (§5.1, row 9). No test pins an encoder's bytes; the frozen version 1 link pins the reading (§5.1, §8).
- A link opens whole only when every field holds; with anything else and a string `program`, the program opens alone; with neither, nothing changes. The fragment is cleared either way (§5.3, §7, row 5).
- A link takes precedence over both stores at start-up, and a pasted one over the page. Opened whole, it replaces the workspace, every view is on the program, the copies stay listed and their bindings are dropped (§5.3, row 14).
- The open's `undo` puts back the program, its encoding, the workspace and each copy's view. It is withdrawn at the next edit that changes the program, the next encoding chosen, its own use, or another open; a notice about the same open carries it, however long after the open's own notice has gone (§5.5, amended twice on 2026-09-30).
- Positions are per program leg, applied as the frames reach them, continued after the run's `result` one leg at a time, λ then asm then TM, at most ten times, and clamped with a notice where the run ends first (§5.4, rows 13 and 16).
- `share` sits after the bar's spacer, before `appearance` (§5.2, amended 2026-09-30).
- Umbrella §4's rules bind every control: named by its text or its label, reachable by keyboard, a gesture's result said in the one live region (§6).
- `web/` only: no Rust, no wasm change, no new dependency, and no build output the app imports.
- Doc comments are `/** */` in TypeScript. No `file:line` citations in tracked source (the pre-commit hook rejects them); they are normal in `docs/`. A possessive citation (`` `x.ts`'s `sym` ``) names the file that declares the symbol. No plan task numbers in shipped code.
- The pre-commit hook runs `biome ci --error-on-warnings`, `pnpm run typecheck` and the hygiene scans on every commit. Never `--no-verify`.
- No colour literal outside the palette's fallback block in `web/src/style.css` (the colour gate).
- **Run one browser suite at a time**, each under `flock "$BROWSER_LOCK"` (below): two started together on one machine have hung. **Do not edit files a browser run is using**: Vite reloads the modules mid-run and the failures that follow are the edit's.
- **A sabotage run can write files of its own**: a failing browser test writes a screenshot under `web/tests/browser/__screenshots__/` and an attachment under `web/.vitest-attachments/` (both gitignored). After every sabotage, delete them, and `git status` shows only what the task changed.

## How to use the code in this plan

**The code below is the prototype's, verbatim, and it was rebuilt from this document's own blocks before the plan was committed** (see Pre-flight status). Every change is a patch:

- Save the block to a file **outside the repository** (the session scratchpad) and run `git apply <that file>` from the repository root. A patch that does not apply means the tree has drifted from the state this plan was built against — this plan's own commit plus the tasks before it. Stop and report; do not hand-merge.
- Each task's **tests' half** goes in first, so the red step can be observed; then its **source half**. A new file appears in its patch whole (`new file mode`).
- The patches are fenced with four backticks, because some carry a doc comment's own three, and each fence is tagged `apply=tests` or `apply=source` with its task number.

**Setup, once per worktree**, from `web/`: `pnpm install --frozen-lockfile` (a real install: where `web/node_modules` is a symlink to another checkout's, no web font loads, `fonts.test.ts` fails its cases and every text-geometry result differs), then `pnpm run build:wasm`, `pnpm run build:lsp-wasm` and `pnpm run build:bindings`. `PATH` must hold `/usr/sbin` (Chrome) and `$CARGO_HOME/bin` (wasm-pack); `CARGO_HOME` is `~/.local/share/cargo`. No task changes the wasm, so one build serves every task.

**`BROWSER_LOCK`** names the one lock file every browser run on the machine takes (the lane rules give its path); set it in the shell before the first browser step. Every command that starts vitest's browser project — a single file, the whole project, a sabotage run — is wrapped in `flock "$BROWSER_LOCK"`. The whole project runs under a memory cap:

    cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --working-directory="$PWD" pnpm exec vitest run --project browser

**A sabotage** is run one at a time: save a copy of the file outside the repository, make the one replacement the table gives (`⏎` is a newline in it, and `\|` a `|`), run the whole test files its row names — never with `-t`, which skips a shared mount's earlier cases; where a row names a node file and a browser file, run both, the second after the first whatever the first printed — then restore the file from the copy, `cmp` the two, delete any screenshot or attachment the run wrote, and check that `git status` shows only the task's changes. Never restore with `git checkout`, which also wipes the task's uncommitted work. The *Fails* column is what that run failed in the replay; a sabotage that fails nothing is a finding to report, not a row to drop.

**Stage before running a hygiene scan by hand.** `check-attributions` resolves a citation against *tracked* files, so a new file that is not yet `git add`ed reads as missing. The hook runs on the staged commit, where that cannot happen.

## Pre-flight status

**Every task was built, gated and sabotaged before this plan was written**, in a scratch worktree on branch `plan7-part6a-ii-proto` off `90d181c`, the spec's head, whose four commits, `a15ad2f`, `98a6c7c`, `7ddc48c` and `20cc260`, are this plan's four tasks and stay for comparison. It was then rebuilt task by task from this document's own code blocks on a fresh worktree at `90d181c`, which differs from this plan's commit only in `docs/`, as an executor would. Each task's tests' half was applied and its red steps run as written, then its source half; the tree was compared with the prototype's task commit, `docs/` aside; its green steps were run as written and it was committed through the pre-commit hook; and every sabotage in its table was run, one at a time, restored after each. Every *Expected* block below is what that run printed, and every *Fails* column is what that sabotage failed there.

| Task | Tree against the prototype | Red step | Green steps and hook | Sabotages fired |
|---|---|---|---|---|
| 1 | IDENTICAL | both files failed to load | passed | 16 of 16 |
| 2 | IDENTICAL | 1 of 7 node tests failed; 21 of 56 browser tests failed | passed | 20 of 20 |
| 3 | IDENTICAL | 19 of 24 tests failed and 2 were skipped, one file's `beforeAll` timing out | passed | 19 of 19 |
| 4 | IDENTICAL | 1 of 26 node tests failed and one node file failed to load; the browser file failed to load | passed | 16 of 16 |

**71 sabotages were run, one at a time; 71 fired**, each on the tests the prototype's own run of it failed. Each task's table lists what each one failed.

**What replaying this plan found, before it was committed:**

1. **Nothing to correct.** Every task's tests' half and source half applied as the blocks give them; every staged tree was the prototype's, `docs/` aside; every red step failed and every green step passed as printed below; every commit passed the hook; and every sabotage failed what it is aimed at — 71 of 71, one at a time, each file restored byte for byte and `git status` clean after it.
2. **Task 3's red step counts 24 tests where the prototype's first red counted 23**: `share-open-hashchange.test.ts` gained its leaf-id case after that red was taken (the prototype's finding 8). The count below is the replay's, from this plan's blocks. Its 2 skipped are `share-open-cap.test.ts`'s two cases, whose `beforeAll` waits for an open that never comes and times out.
3. **The whole browser project stays well under its 16G cap**: at Tasks 1 to 4's green steps it peaked at 7.7G, 6.9G, 7.9G and 9.6G, and the coverage run at Task 5 at 9.8G, with the default workers.

**What the prototype found, all answered in the code below:**

1. **`share` after `examples ▾`, where the spec first put it, cost a header row; before `appearance`, where the user moved it, it costs none.** Measured at 390, 360 and 320px in each preset and style, counting rows as `header-menus-narrow.test.ts` counts them: after `examples ▾`, Instrument's Debugger went from three rows to four at 390px (`copies ▾` already misses the first row there by 2px), and Terminal's Stage at 390px and Paper's Stage at 360px each gained one. Before `appearance`, every count equals the header's without `share`, and it still does with one copy or eleven, whose wider `copies N ▾` the first measurement left out. **The user's decision**, now in the spec (§5.2's amendment). Task 2's header test counts `share` among the three rows, and its sabotage 1 puts it back after `examples ▾`.
2. **The page puts no bound on a fragment, so the inflate cap is the one bound a link has.** Chrome kept a 10,000,000-character fragment set by `history.replaceState` and by assigning `location.hash`, and `hashchange` reported it whole. The cap and how it was fixed are under *What the spec left to this plan*.
3. **Node's `DecompressionStream` takes all of its input at once, whatever it is handed**, so a node test cannot hold the kilobyte-at-a-time feed: a counter in front of it saw the whole 65,232 bytes of a 64 MiB bomb. Chrome's asks for its input as its output is read, and saw 9,216 bytes; the case is a browser test of its own (Task 1, `share-link-inflate.test.ts`).
4. **Three of the codec's refusal cases were blind as first written, and are not now.** A payload that is not UTF-8 was refused by `JSON.parse` whether or not the decoder was fatal, so the bad byte now sits inside the program string; `[7]` as positions was refused for its key `'0'` with or without the array check, so the case is `[]`; and "unpadded" was checked on one payload whose deflated length needed no padding, so it is checked on every seed's. Each is a sabotage in Task 1 that fires.
5. **§5.2's "selects its text on `toggle`" does not fit: the link arrives after the popover has shown**, since `CompressionStream` is asynchronous, so a `toggle` handler selected an empty field and its removal failed nothing. The field is selected as it is filled, while it holds the focus that the popover's showing gave it (`share-popover.ts`'s `createShare`). What the user sees is the spec's: the field focused, its text selected.
6. **A clipboard permission reaches Chrome only when it names Playwright's browser context.** Sent without one, CDP granted it to the default context and every write was still refused — as it is in this setup by default — so a "refused" case passed whatever the code did. The popover test grants and denies against the page's own `browserContextId`, and denies only after a grant.
7. **`share`'s popover needs the gutter the examples and workspace menus keep, measured.** Without an end margin it lay flush with the page's right edge at 480, 600 and 700px, and at 390px in Debugger; with `1rem`, it stops `1rem` short of either edge at 320, 360, 390, 480, 600 and 700px in each preset, and at 1280px it opens leftward from its button's right edge either way. It joins `style.css`'s `@supports (position-area: block-end)` block (Task 2, sabotage 2).
8. **§5.3's "rebuilds the views through `resetViews`" does not fit `pane-host.ts`'s `applyLayout`**, whose first pass keeps an entry whose leaf id and kind survive: a view reads its display and its panels only when it is built, so a λ view kept by `resetViews` went on drawing the opener's display under the link's workspace. `PaneHost.rebuildViews` drops every view the tree keeps, and `main.ts`'s `showWorkspace` also opens or shuts the inspector and the source outline as the link's workspace says, and moves the leaf counter past the link's ids. What the user sees is what §5.3 says: the link's workspace, every view on the program.
9. **§5.4's "`seek` stops following" does not fit `history.ts`'s `History.seek`**, which goes on following when it lands on the newest frame, so a position that is the last frame of a chunk would be carried off by the next. `LinkPositions` applies a position once a frame past it has arrived, or once the recording has stopped with it as its last frame.
10. **What in the first draft changed nothing is not in the code**, each piece found by a sabotage that failed nothing: `createShare`'s `toggle` select (finding 5) and a guard against an earlier open's link arriving late, which fills that open's own field, already off the page; `undoOpen`'s `offer = null` and `announceOpen`'s own withdrawal, both done by the edit and the notice that follow; and three explicit drops of a link's positions — in `resetLegs`, at the undo and at an open of the program alone — each answered by the first reply of the recompile that follows, whose generation `LinkPositions.onReply` drops them at; and `#stop`'s seek to the last step, where the head already is.
11. **An open's `undo` meets the copies cap only at start-up, and only with more copies bound than the cap.** An open on a running page leaves every copy warm, and making copies after a start-up open draws notices over its `undo`; a stored workspace with twelve λ views, each bound to its own copy, is the one path, and `share-open-cap.test.ts` takes it.
12. **Two of the popover's cases were blind as first written**: `toMatchObject({ positions: {} })` matches any positions, and a bare button with no class passed "no `copy link`". Both read the whole now (Task 2, sabotages 9 and 15).

**Outside this lane, found while measuring:** at 320px in Debugger and Stage the page scrolls sideways by 36px — the step bar is 356px wide — with `share` in the header or not.

## What the spec left to this plan, and how it was fixed

| Left to the plan | Fixed as | Measured by |
|---|---|---|
| The inflate cap (§5.3, §10) | `MAX_LINK_BYTES`, 8 MiB (8,388,608 bytes); a payload of exactly that is read, one byte more is refused; the input is fed a kilobyte at a time | In Chrome: a link inflating to just under the cap read in 18.6 ms, and one inflating to 512 MiB — 695,771 characters of zeros — was refused in 38.2 ms; fed a kilobyte at a time its inflate read 9,216 bytes of input and took 2.3 to 4.1 ms, where one blob stream took 15.4 to 135.4 ms. The seven examples joined make a 777-character fragment of a 1,677-byte payload, about 2.2 bytes a character, so a link of such text reaches the cap at some 3,900,000 characters; the examples repeated to just under the cap make a 55,019-character link, which opens |
| The pending step line (§5.4, "the plan words it") | `step 1,386 of 1,386 — going to step 3,000 from the link`: the spec's own example, in place of the stop reason, and `— recompiling` over it while a compile is pending | `controls.test.ts`'s case, and Task 4's browser case waiting on it |
| The clamp's and the tenth continue's notices (§5.4, row 16) | `the link's λ step 5,000 is past the end of this run — showing step 951`; `the link's λ step 17,000 is further on than 10 continues went — showing step 15,695` | Task 4's browser cases |
| The program-alone notice (§7) | `opened a shared link's program — its workspace and step positions were left out`, with `encoding, ` before `workspace` where the encoding was not this build's | Task 3's cases |
| The popover's lines (§5.2) | `this link is 2,345 characters long — some chat and mail apps cut links past 2,000`; `copies are not included — the λ · copy 1 view will open on the program`, `views` and a list for more than one | Task 2's cases |
| A used undo's words and focus (§5.5) | `put back the program and the workspace`, or `put back the program` for one opened alone; the focus to the source editor, or to `share` where no view shows the source, which is also the `undo`'s `fallback` | Task 3's cases |
| `share`'s popup kind (§5.2 names none) | `aria-haspopup="menu"`, as `settings` has, though the popover is a field and a button rather than a menu: a decision the user may make otherwise | — |

**Verified fixtures**, each measured by running it — every figure below is one a test in this plan asserts:

| Fixture | Where | Measured |
|---|---|---|
| the frozen version 1 link, written by `encodeLink` in Chrome | Task 1 | `sum_to(5)` under `binary`, the Debugger preset's version 2 workspace, and positions λ 500, asm 40, TM 9,000 |
| a payload of 8,388,608 bytes, and of 8,388,609 | Task 1 | the first read, the second refused |
| a link inflating to 64 MiB | Task 1 | refused having handed Chrome's decompressor under 16 KiB of its 65,232 bytes |
| `let x = 40; x + 2`'s link, as `share` makes it | Task 2 | positions λ 7, asm 5, TM 2,870; after one step back on λ, λ 6; while a compile is pending, none |
| `sum_to(5)` under `binary` in the Debugger preset, opened at start-up | Task 3 | the inspector's rows read `λ value = 15` and `TM value = 15` |
| `fact(4)`'s λ at 3,000 | Task 4 | reached after two continues: `step 3,000 of 4,144 — history is full (oldest kept: step 2,770)` |
| `fact(4)`'s λ at 1,387 | Task 4 | one continue, landing on 1,388: `step 1,388 of 2,768 — history is full (oldest kept: step 1,388)` |
| `sum_to(5)`'s λ at 5,000 | Task 4 | clamped to `step 951 of 951`, no continue |
| `fact(12)`'s λ at 17,000, its TM leg at 5 | Task 4 | ten continues and no eleventh, `step 15,695 of 15,695 — history is full (oldest kept: step 14,273)`; its TM position dropped with nothing said |

## File structure

**Created**

| File | Task | Responsibility |
|---|---|---|
| `web/src/share-link.ts` | 1 | the link's format: `encodeLink`, `decodeLink`, `isLink`, `MAX_LINK_BYTES` |
| `web/tests/node/share-link.test.ts`, `web/tests/browser/share-link-inflate.test.ts` | 1 | the round trip, every refusal, the program-alone cases and the frozen link; the inflate's feed in Chrome |
| `web/src/share-popover.ts` | 2 | `share`'s popover: the field, `copy link`, the two lines |
| `web/tests/browser/share-popover.test.ts` | 2 | the popover by pointer and by keys, its link, the clipboard granted and refused |
| `web/tests/browser/share-open.test.ts`, `share-open-alone.test.ts`, `share-open-unreadable.test.ts`, `share-open-hashchange.test.ts`, `share-open-cap.test.ts` | 3 | a link at start-up whole, alone and unreadable; pasted into an open page; an undo past the copies cap |
| `web/src/share-positions.ts` | 4 | `LinkPositions`: a link's positions, from the open to the frames that reach them |
| `web/tests/node/share-positions.test.ts`, `web/tests/browser/share-positions.test.ts` | 4 | positions against a worker's replies; positions on the real session worker |

**Modified**

| File | Task | What changes |
|---|---|---|
| `web/index.html`, `web/tests/browser/harness.ts`, `web/tests/node/harness.test.ts` | 2 | `share` and its popover, after the spacer and before `appearance`, in the page and in `SHELL`; the two ids |
| `web/src/link-wiring.ts` | 2 | `LinkWiring.detachedPanes` |
| `web/src/main.ts` | 2, 3, 4 | `sharePayload` and the popover's wiring; the start-up link, `storedProgram`, `storedWorkspace`, `droppedBindings`, `offer`, `showWorkspace`, `undoOpen`, `announceOpen`, `openLink` and the `hashchange` listener; `sayAboutOpen`, `positions` and the program session's reply hook |
| `web/src/style.css` | 2 | `#share` joins the header buttons' rule; the popover; `#share-menu` in the gutter block |
| `web/tests/browser/controls-gate.test.ts`, `header-menus-narrow.test.ts` | 2 | `share` among the header menus and its field walked; `share` among the three rows at 390px; its popover's gutter |
| `web/src/pane-host.ts` | 3 | `rebuildViews`; `applyLayout`'s `rebuild` |
| `web/src/sessions.ts`, `web/src/controls.ts`, `web/src/transport.ts`, `web/tests/node/controls.test.ts` | 4 | `LegState.pending`; the step line's pending clause; a step gesture takes a leg from its link |

---

### Task 1: The link's codec

**Files:**
- Create: `web/src/share-link.ts`
- Test: `web/tests/node/share-link.test.ts`, `web/tests/browser/share-link-inflate.test.ts`

**Interfaces:**
- Produces `share-link.ts`'s `LINK_PREFIX = '#s='`, `LINK_VERSION = 1`, `MAX_LINK_BYTES = 8 * 1024 * 1024`; `type Positions = { readonly [L in Leg]?: number }`; `type SharePayload = { readonly program: string; readonly encoding: string; readonly workspace: string; readonly positions: Positions }`; `type OpenedLink = { kind: 'whole'; program: string; encoding: string; workspace: Workspace; positions: Positions } | { kind: 'program'; program: string; encoding: string | null } | { kind: 'unreadable' }` (all `readonly`); `isLink(fragment: string): boolean`; `encodeLink(payload: SharePayload): Promise<string>`; `decodeLink(fragment: string, encodings: readonly string[]): Promise<OpenedLink>`.

**THE LINK IS THE SPEC'S FORMAT, THROUGH THE BROWSER'S OWN ENCODER** (spec §5.1, row 9): `#s=` and the unpadded base64url of the deflate-raw of the UTF-8 of `{ version: 1, program, encoding, workspace, positions }`, with `workspace` as `serializeWorkspace` wrote it, so a link's workspace reaches `parseWorkspace` as a stored one does. `btoa` and `atob` carry the base64, so node and Chrome share one path.

**THE DECODER OPENS WHOLE ONLY WHEN EVERY FIELD HOLDS** (§5.3): version 1, a string program, an encoding among the ones handed in, a workspace `parseWorkspace` takes, and positions whose keys are legs and whose values are safe integers of 0 or more. Anything else with a string program opens the program alone, with its encoding where this build has it and `null` where not; anything without one opens nothing. The inflate is fed a kilobyte at a time, as its output is read, and refused past `MAX_LINK_BYTES` (*What the spec left to this plan*).

**THE FROZEN LINK IS CHROME'S** (§5.1, §8): written once by `encodeLink` in the browser tier and committed as a string, it pins the reading, and its `version: 2` workspace pins `parseWorkspace`'s reading of version 2. The round trip runs over generated payloads, one case per seed, since each case must stay well under a second on the slower runner.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=1
diff --git a/web/tests/browser/share-link-inflate.test.ts b/web/tests/browser/share-link-inflate.test.ts
new file mode 100644
index 0000000..abe62a6
--- /dev/null
+++ b/web/tests/browser/share-link-inflate.test.ts
@@ -0,0 +1,54 @@
+import { expect, it } from 'vitest'
+import { decodeLink, LINK_PREFIX } from '../../src/share-link'
+
+/**
+ * **THE INFLATE IS HANDED ITS INPUT A KILOBYTE AT A TIME, AS ITS OUTPUT IS READ** — `share-link.ts`'s
+ * `MAX_LINK_BYTES` and the piece size under it (Plan 7 part 6a spec §5.3). A link that inflates far past the cap is
+ * refused having handed Chrome's decompressor a few kilobytes of itself, not the whole. A browser test, because it is
+ * Chrome's decompressor this holds: node's takes all of its input at once whatever it is handed.
+ *
+ * Counted by standing a counter in front of the decompressor, which passes on what it is given as the decompressor
+ * asks for it. 64 MiB of zeros deflate to some 64 KiB.
+ */
+
+async function deflated(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
+  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
+  return new Uint8Array(await new Response(stream).arrayBuffer())
+}
+
+function base64url(bytes: Uint8Array): string {
+  let binary = ''
+  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
+  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
+}
+
+it('refuses a link inflating to 64 MiB having handed the inflate under 16 KiB of it', async () => {
+  const bomb = await deflated(new Uint8Array(64 * 1024 * 1024))
+  expect(bomb.length).toBeGreaterThan(60_000)
+  const Real = globalThis.DecompressionStream
+  let fed = 0
+  class Counted {
+    readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>
+    readonly writable: WritableStream<BufferSource>
+    constructor(format: CompressionFormat) {
+      const real = new Real(format)
+      const counter = new TransformStream<BufferSource, BufferSource>({
+        transform(chunk, controller) {
+          fed += chunk.byteLength
+          controller.enqueue(chunk)
+        },
+      })
+      counter.readable.pipeTo(real.writable).catch(() => {})
+      this.writable = counter.writable
+      this.readable = real.readable
+    }
+  }
+  globalThis.DecompressionStream = Counted as unknown as typeof DecompressionStream
+  try {
+    expect(await decodeLink(`${LINK_PREFIX}${base64url(bomb)}`, ['unary'])).toEqual({ kind: 'unreadable' })
+  } finally {
+    globalThis.DecompressionStream = Real
+  }
+  expect(fed).toBeGreaterThan(0)
+  expect(fed).toBeLessThan(16 * 1024)
+})
diff --git a/web/tests/node/share-link.test.ts b/web/tests/node/share-link.test.ts
new file mode 100644
index 0000000..04049ba
--- /dev/null
+++ b/web/tests/node/share-link.test.ts
@@ -0,0 +1,258 @@
+import { deflateRawSync } from 'node:zlib'
+import { describe, expect, it } from 'vitest'
+import { LEGS } from '../../src/legs'
+import {
+  decodeLink,
+  encodeLink,
+  isLink,
+  LINK_PREFIX,
+  MAX_LINK_BYTES,
+  type Positions,
+  type SharePayload,
+} from '../../src/share-link'
+import { defaultWorkspace, PRESETS, type Preset, parseWorkspace, SPEEDS, serializeWorkspace } from '../../src/workspace'
+
+/**
+ * The share link's codec (Plan 7 part 6a spec §5.1, §5.3, §8's node row): what `encodeLink` writes `decodeLink` reads
+ * back whole; every way a link can fail to be read, and every way it opens the program alone; and the frozen link from
+ * the format's first version, which must go on opening. `CompressionStream` and `DecompressionStream` are node globals,
+ * and node reads Chrome's links (spec §A.3).
+ */
+
+/** The encodings `main.ts` hands in, as `encodings()` lists them today. */
+const ENCODINGS = ['unary', 'binary']
+
+const WORKSPACE = serializeWorkspace(defaultWorkspace())
+
+/** A link carrying `text` as its payload's JSON, deflated by node's own encoder: any payload, valid or not. */
+const linkOf = (text: string | Uint8Array): string =>
+  `${LINK_PREFIX}${deflateRawSync(typeof text === 'string' ? Buffer.from(text) : text).toString('base64url')}`
+
+/** A link whose payload is a valid one with `fields` merged over it — the shape a hand-edit or a later version makes. */
+const payloadLink = (fields: Record<string, unknown>): string =>
+  linkOf(
+    JSON.stringify({
+      version: 1,
+      program: 'let x = 40; x + 2',
+      encoding: 'binary',
+      workspace: WORKSPACE,
+      positions: { lambda: 7 },
+      ...fields,
+    }),
+  )
+
+describe('encodeLink and decodeLink', () => {
+  /** A seeded generator, so a failure names a payload that stays the same. */
+  const random = (seed: number): (() => number) => {
+    let s = seed
+    return () => {
+      s = (s * 1103515245 + 12345) % 2147483648
+      return s / 2147483648
+    }
+  }
+  /** What a program's text can hold that JSON or UTF-8 treats specially: quotes, escapes, λ, a surrogate pair, U+2028. */
+  const PIECES = ['let x = 40;', '\n', '\t', '"', '\\', 'λx. x', '🦀', ' ', ' ', '{}', 'fn f(n) {', '}', '0']
+
+  const generated = (seed: number): SharePayload => {
+    const next = random(seed)
+    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T
+    const program = Array.from({ length: Math.floor(next() * 400) }, () => pick(PIECES)).join('')
+    const preset = pick(Object.keys(PRESETS) as Preset[])
+    const workspace = serializeWorkspace({ ...defaultWorkspace(), switches: PRESETS[preset], speed: pick(SPEEDS) })
+    const positions: { [L in (typeof LEGS)[number]]?: number } = {}
+    for (const leg of LEGS) {
+      if (next() < 0.5) continue
+      positions[leg] = pick([0, 1, Math.floor(next() * 100_000), Number.MAX_SAFE_INTEGER])
+    }
+    return { program, encoding: pick(ENCODINGS), workspace, positions }
+  }
+
+  it.each([1, 2, 3, 4, 5, 6, 7, 8])('reads back whole what it wrote, generated from seed %i', async (seed) => {
+    const payload = generated(seed)
+    const fragment = await encodeLink(payload)
+    expect(await decodeLink(fragment, ENCODINGS)).toEqual({
+      kind: 'whole',
+      program: payload.program,
+      encoding: payload.encoding,
+      workspace: parseWorkspace(payload.workspace),
+      positions: payload.positions,
+    })
+  })
+
+  /** Over every seed, since one payload's deflated length needs no padding in two of three cases. */
+  it('writes `#s=` and unpadded base64url, and nothing else', async () => {
+    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
+      const fragment = await encodeLink(generated(seed))
+      expect(fragment, `seed ${seed}`).toMatch(/^#s=[A-Za-z0-9_-]+$/)
+      expect(isLink(fragment)).toBe(true)
+    }
+  })
+
+  it('writes version 1, the program, the encoding, the workspace string and the positions', async () => {
+    const payload = generated(10)
+    const fragment = await encodeLink(payload)
+    const inflated = await new Response(
+      new Blob([Buffer.from(fragment.slice(LINK_PREFIX.length), 'base64url')])
+        .stream()
+        .pipeThrough(new DecompressionStream('deflate-raw')),
+    ).text()
+    expect(JSON.parse(inflated)).toEqual({ version: 1, ...payload })
+  })
+})
+
+/**
+ * **THE FROZEN LINK: THE FORMAT'S FIRST VERSION, AS CHROME WROTE IT, WHICH MUST GO ON OPENING** (umbrella §8.4, spec
+ * §5.1). Written once by `encodeLink` in Chrome, from `sum_to(5)` under `binary`, the Debugger preset's workspace and a
+ * position on each leg. It pins the reading, never an encoder's bytes: node and Chrome deflate one payload differently.
+ * Its workspace is `version: 2`, so it pins `parseWorkspace`'s reading of version 2 for good too: a later workspace
+ * version migrates version 2 rather than refusing it.
+ */
+describe('the frozen link from version 1', () => {
+  const FROZEN =
+    '#s=tZDRahsxEEV_ZZinhipBKTW0CulT_yJjiqwdxyLSaJG0Memy_16ktWnc0pQ-VA8SHO69czUzPnMuPgmaW4VjTo_ZRjS4FyhT_FbTO7mCmQQAIHCFOFWwzsE96LuVHg8-MAh8AX0WtrOK2v0e5O4nF7gHgWu4PbFlfaxzJAvJaejmigQVsrg0eHlEgzsvNr-gwmPKT2W0jtHgTOf6hOaDIqyZmdDMhE9eBkJDWMbgK6EiHHzuxKUwRemo-O9cCM2DvtkofbPZKkJ38GHI3CIf3g7K6fjPKYHtvpv8KTVN2XEnoxW-YIt6yxls3A32Wl96V0q4bC_d_6e9LfHXArbEvzWvv5lq7I23S-tz9NUdeqWZsFQeS9fsbO6mZ8_HlVQfmkwRZrZDmmqnXsrIrqbcarSPM7exnxThPrmp8B_WF_rEZnmVYGqeuC-tjMG-nBU1fn0FFlQ4puKrT1LQzKdsNButVVsImo9aYY1oPmutl-UH'
+
+  it('opens whole, as the program, the encoding, the workspace and the positions it was written with', async () => {
+    expect(await decodeLink(FROZEN, ENCODINGS)).toEqual({
+      kind: 'whole',
+      program:
+        'fn sum_to(n) {\n    let mut acc = 0;\n    while n > 0 {\n        acc = acc + n;\n        n = n - 1;\n    }\n    acc\n}\nsum_to(5)\n',
+      encoding: 'binary',
+      workspace: {
+        tree: {
+          kind: 'split',
+          dir: 'column',
+          sizes: [0.5, 0.5],
+          children: [
+            {
+              kind: 'split',
+              dir: 'row',
+              sizes: [0.5, 0.5],
+              children: [
+                { kind: 'leaf', id: 'source', pane: 'source' },
+                { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
+              ],
+            },
+            {
+              kind: 'split',
+              dir: 'row',
+              sizes: [0.5, 0.5],
+              children: [
+                { kind: 'leaf', id: 'asm-0', pane: 'asm' },
+                { kind: 'leaf', id: 'tm-0', pane: 'tm' },
+              ],
+            },
+          ],
+        },
+        switches: { steps: 'bar', views: 'tiles', readout: 'inspector' },
+        speed: 8,
+        focused: 'lambda-0',
+        panels: {},
+        inspector: true,
+        display: {},
+        tmDisplay: {},
+      },
+      positions: { lambda: 500, asm: 40, tm: 9000 },
+    })
+  })
+})
+
+describe('a link nothing can be read from', () => {
+  it.each([
+    ['a character base64url does not have', '#s=ab*d'],
+    ['padding', '#s=YWJj='],
+    ['a length base64 cannot end on', '#s=YWJjZ'],
+  ])('refuses %s', async (_, fragment) => {
+    expect(await decodeLink(fragment, ENCODINGS)).toEqual({ kind: 'unreadable' })
+  })
+
+  it('refuses bytes that are not a deflate stream', async () => {
+    const plain = Buffer.from(JSON.stringify({ version: 1, program: 'x' })).toString('base64url')
+    expect(await decodeLink(`${LINK_PREFIX}${plain}`, ENCODINGS)).toEqual({ kind: 'unreadable' })
+  })
+
+  it('refuses a stream cut short, and one with bytes after its end', async () => {
+    const whole = deflateRawSync(Buffer.from(JSON.stringify({ version: 1, program: 'let x = 40; x + 2' })))
+    const cut = `${LINK_PREFIX}${whole.subarray(0, whole.length - 4).toString('base64url')}`
+    const trailing = `${LINK_PREFIX}${Buffer.concat([whole, Buffer.from([0, 1, 2])]).toString('base64url')}`
+    expect(await decodeLink(cut, ENCODINGS)).toEqual({ kind: 'unreadable' })
+    expect(await decodeLink(trailing, ENCODINGS)).toEqual({ kind: 'unreadable' })
+  })
+
+  /**
+   * **NOT UTF-8 INSIDE A STRING THAT IS OTHERWISE A PROGRAM**, so what refuses it is the decoding and not the JSON: read
+   * leniently, `0xff` would become U+FFFD and the program would open. A JSON array is refused by having no `program`.
+   */
+  it('refuses a payload that is not UTF-8, or not JSON, or JSON that is not an object', async () => {
+    const bytes = new TextEncoder().encode('{"program":"let x = 40; x + 2"}')
+    bytes[13] = 0xff
+    expect(await decodeLink(linkOf(bytes), ENCODINGS)).toEqual({ kind: 'unreadable' })
+    for (const text of ['{"version": 1, "program"', 'null', '[]', '"let x = 1"', '42'])
+      expect(await decodeLink(linkOf(text), ENCODINGS), text).toEqual({ kind: 'unreadable' })
+  })
+
+  it('refuses a payload whose program is missing or not a string', async () => {
+    for (const program of [undefined, 42, null, ['let x = 1']])
+      expect(await decodeLink(payloadLink({ program }), ENCODINGS), String(program)).toEqual({ kind: 'unreadable' })
+  })
+
+  /**
+   * **THE CAP IS THE ONE BOUND A LINK HAS** (`MAX_LINK_BYTES`' own doc): a payload of exactly the cap is read, and one
+   * byte more is refused. Both are a program of `a`s, which deflate to a few kilobytes.
+   */
+  it('reads a payload of exactly MAX_LINK_BYTES, and refuses one a byte longer', async () => {
+    const around = (bytes: number): string => {
+      const shell = JSON.stringify({ program: '' })
+      return linkOf(JSON.stringify({ program: 'a'.repeat(bytes - shell.length) }))
+    }
+    expect(await decodeLink(around(MAX_LINK_BYTES), ENCODINGS)).toMatchObject({ kind: 'program' })
+    expect(await decodeLink(around(MAX_LINK_BYTES + 1), ENCODINGS)).toEqual({ kind: 'unreadable' })
+  })
+})
+
+describe('a link that opens the program alone', () => {
+  const alone = (encoding: string | null) => ({ kind: 'program', program: 'let x = 40; x + 2', encoding })
+
+  it('opens the program alone, under its encoding, for a version other than 1', async () => {
+    for (const version of [2, '1', undefined])
+      expect(await decodeLink(payloadLink({ version }), ENCODINGS), String(version)).toEqual(alone('binary'))
+  })
+
+  it('opens the program alone, with no encoding, for an encoding this build does not have', async () => {
+    for (const encoding of ['ternary', 3, undefined])
+      expect(await decodeLink(payloadLink({ encoding }), ENCODINGS), String(encoding)).toEqual(alone(null))
+  })
+
+  it("opens the program alone for a workspace that is not `serializeWorkspace`'s string, or that it refuses", async () => {
+    for (const workspace of [JSON.parse(WORKSPACE), undefined, '{}', 'not json'])
+      expect(await decodeLink(payloadLink({ workspace }), ENCODINGS), String(workspace)).toEqual(alone('binary'))
+  })
+
+  it.each([
+    ['missing', undefined],
+    ['an array, even an empty one', []],
+    ['a key that is not a leg', { lamda: 7 }],
+    ['a negative step', { lambda: -1 }],
+    ['a step that is not an integer', { asm: 1.5 }],
+    ['a step past the safe integers', { tm: 2 ** 53 }],
+    ['a step written as a string', { lambda: '7' }],
+  ])('opens the program alone for positions that are %s', async (_, positions) => {
+    expect(await decodeLink(payloadLink({ positions }), ENCODINGS)).toEqual(alone('binary'))
+  })
+
+  it('opens whole with no positions at all, and with a step of 0', async () => {
+    for (const positions of [{}, { tm: 0 }] as Positions[])
+      expect(await decodeLink(payloadLink({ positions }), ENCODINGS)).toMatchObject({ kind: 'whole', positions })
+  })
+})
+
+describe('isLink', () => {
+  it('is a fragment starting `#s=`, and no other', () => {
+    expect(isLink('#s=abc')).toBe(true)
+    for (const fragment of ['', '#', '#s', '#S=abc', '#section', 's=abc'])
+      expect(isLink(fragment), fragment).toBe(false)
+  })
+
+  it('reads a fragment that is not a link as nothing to open', async () => {
+    expect(await decodeLink('#section', ENCODINGS)).toEqual({ kind: 'unreadable' })
+  })
+})
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  no tests
```

Failing as a whole file: `tests/node/share-link.test.ts`, with `Error: Cannot find module '../../src/share-link' imported from tests/node/share-link.test.ts`.

Run: `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-link-inflate.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  no tests
```

Failing as a whole file: `tests/browser/share-link-inflate.test.ts`, with `Error: Failed to import test file tests/browser/share-link-inflate.test.ts`.

- [ ] **Step 3: Write the code.**

````diff apply=source task=1
diff --git a/web/src/share-link.ts b/web/src/share-link.ts
new file mode 100644
index 0000000..5ed3c72
--- /dev/null
+++ b/web/src/share-link.ts
@@ -0,0 +1,199 @@
+import { LEGS } from './legs'
+import type { Leg } from './protocol'
+import { parseWorkspace, type Workspace } from './workspace'
+
+/**
+ * SHARE LINKS — Plan 7 part 6a spec §5.1 and §5.3: the program, its encoding, the workspace and where each leg stands,
+ * carried in the page's fragment, so a link is never sent to a server.
+ *
+ *     #s= base64url, unpadded ( deflate-raw ( UTF-8 ( JSON { version: 1, program, encoding, workspace, positions } ) ) )
+ *
+ * **`workspace` IS `serializeWorkspace`'s STRING, NOT ITS OBJECT**, so a link's workspace reaches `parseWorkspace`
+ * exactly as a stored one does, and is held to the same checks. The object would save 26 to 30 characters a link and
+ * give the reader a second path (spec §5.1).
+ *
+ * **NO TEST MAY PIN AN ENCODER'S BYTES.** `CompressionStream` takes no level, and node's encoders and Chrome's write
+ * different bytes for one payload, so what is pinned is the decoding of a link Chrome wrote (spec §5.1, §8).
+ */
+
+/** What a link's fragment starts with; the payload's base64url follows it. */
+export const LINK_PREFIX = '#s='
+
+/** The payload's version. A link of any other opens the program alone (spec §5.3). */
+export const LINK_VERSION = 1
+
+/**
+ * The most bytes a link's payload may inflate to; a link that inflates past it cannot be read (spec §5.3, §7).
+ *
+ * **THE PAGE PUTS NO BOUND ON A FRAGMENT, SO THIS IS THE ONE.** Chrome kept a 10,000,000-character fragment set by
+ * `history.replaceState` and by assigning `location.hash`, and `hashchange` reported it whole; and deflate inflates
+ * zeros a thousandfold, so a link 695,771 characters long inflates to 512 MiB.
+ *
+ * **8 MiB, WHICH IS CHEAP TO READ AND TO REFUSE.** In Chrome, reading a link that inflates to just under it took 18.6
+ * ms, and refusing the one that inflates to 512 MiB took 38.2 ms. A program is not near it: the seven examples joined
+ * into one make a 777-character fragment of a 1,677-byte payload, about 2.2 bytes a character, so a link of such text
+ * would reach the cap at some 3,900,000 characters. Text that repeats packs tighter, and the examples repeated until
+ * the payload is just under the cap make a link of 55,019 characters, which opens.
+ */
+export const MAX_LINK_BYTES = 8 * 1024 * 1024
+
+/**
+ * **THE INPUT GOES TO THE INFLATE A KILOBYTE AT A TIME**, and only as its output is read. Refusing the link that
+ * inflates to 512 MiB then read 9,216 bytes of its input and took 2.3 to 4.1 ms in Chrome; handed its input as one
+ * blob stream, the same refusal took 15.4 to 135.4 ms.
+ */
+const INFLATE_PIECE = 1024
+
+/** A leg's step, per leg, as a link carries it: only the legs that had frames (spec §5.1). */
+export type Positions = { readonly [L in Leg]?: number }
+
+/** What `encodeLink` writes: the program, its encoding, the workspace as `serializeWorkspace` wrote it, and positions. */
+export type SharePayload = {
+  readonly program: string
+  readonly encoding: string
+  readonly workspace: string
+  readonly positions: Positions
+}
+
+/**
+ * What a link opens (spec §5.3): the whole of it; the program alone, under its encoding where that is one of this
+ * build's (`null` where it is not); or nothing, where no program can be read from it.
+ */
+export type OpenedLink =
+  | {
+      readonly kind: 'whole'
+      readonly program: string
+      readonly encoding: string
+      readonly workspace: Workspace
+      readonly positions: Positions
+    }
+  | { readonly kind: 'program'; readonly program: string; readonly encoding: string | null }
+  | { readonly kind: 'unreadable' }
+
+/** Whether `fragment` — `location.hash` — is a share link rather than any other fragment. */
+export const isLink = (fragment: string): boolean => fragment.startsWith(LINK_PREFIX)
+
+function toBase64url(bytes: Uint8Array): string {
+  let binary = ''
+  // IN PIECES, since a spread of a large array exceeds the engine's argument limit.
+  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
+  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
+}
+
+/** The bytes of unpadded base64url `text`, or `null` for anything else. */
+function fromBase64url(text: string): Uint8Array | null {
+  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
+  let binary: string
+  try {
+    binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
+  } catch {
+    return null
+  }
+  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
+}
+
+async function deflate(text: string): Promise<Uint8Array> {
+  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
+  return new Uint8Array(await new Response(stream).arrayBuffer())
+}
+
+/** `bytes` inflated, or `null` where they are not a whole deflate-raw stream or inflate past `MAX_LINK_BYTES`. */
+async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
+  let at = 0
+  const source = new ReadableStream<Uint8Array<ArrayBuffer>>(
+    {
+      pull(controller) {
+        if (at >= bytes.length) {
+          controller.close()
+          return
+        }
+        controller.enqueue(bytes.slice(at, at + INFLATE_PIECE))
+        at += INFLATE_PIECE
+      },
+    },
+    { highWaterMark: 0 },
+  )
+  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader()
+  const pieces: Uint8Array[] = []
+  let total = 0
+  try {
+    for (;;) {
+      const { done, value } = await reader.read()
+      if (done) break
+      total += value.byteLength
+      if (total > MAX_LINK_BYTES) {
+        reader.cancel().catch(() => {})
+        return null
+      }
+      pieces.push(value)
+    }
+  } catch {
+    // A STREAM THAT IS NOT DEFLATE, OR IS CUT SHORT, OR HAS BYTES AFTER ITS END: the decompressor errors on each.
+    return null
+  }
+  const out = new Uint8Array(total)
+  let into = 0
+  for (const piece of pieces) {
+    out.set(piece, into)
+    into += piece.byteLength
+  }
+  return out
+}
+
+/** The fragment carrying `payload`: `#s=` and the payload, deflated and in base64url. */
+export async function encodeLink(payload: SharePayload): Promise<string> {
+  const json = JSON.stringify({
+    version: LINK_VERSION,
+    program: payload.program,
+    encoding: payload.encoding,
+    workspace: payload.workspace,
+    positions: payload.positions,
+  })
+  return `${LINK_PREFIX}${toBase64url(await deflate(json))}`
+}
+
+/** `v` as positions: an object whose keys are legs and whose values are safe integers of 0 or more, or `null`. */
+function parsePositions(v: unknown): Positions | null {
+  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
+  const out: { [L in Leg]?: number } = {}
+  for (const [key, step] of Object.entries(v)) {
+    const leg = LEGS.find((l) => l === key)
+    if (leg === undefined || !Number.isSafeInteger(step) || (step as number) < 0) return null
+    out[leg] = step as number
+  }
+  return out
+}
+
+/**
+ * What the link `fragment` opens, given this build's `encodings` (spec §5.3).
+ *
+ * **WHOLE ONLY WHEN EVERY FIELD HOLDS**: version 1, a string program, an encoding this build has, a workspace
+ * `parseWorkspace` takes, and positions whose keys are legs and whose values are safe integers of 0 or more. With
+ * anything else and a string program, the program opens alone, under its encoding if this build has it. Without a
+ * string program — base64url that is not, a stream that does not inflate or inflates past `MAX_LINK_BYTES`, bytes that
+ * are not UTF-8 JSON, JSON that is not an object — nothing opens.
+ */
+export async function decodeLink(fragment: string, encodings: readonly string[]): Promise<OpenedLink> {
+  const unreadable: OpenedLink = { kind: 'unreadable' }
+  if (!isLink(fragment)) return unreadable
+  const bytes = fromBase64url(fragment.slice(LINK_PREFIX.length))
+  if (bytes === null) return unreadable
+  const inflated = await inflate(bytes)
+  if (inflated === null) return unreadable
+  let parsed: unknown
+  try {
+    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflated))
+  } catch {
+    return unreadable
+  }
+  if (typeof parsed !== 'object' || parsed === null) return unreadable
+  const e = parsed as Record<string, unknown>
+  if (typeof e.program !== 'string') return unreadable
+  const encoding = typeof e.encoding === 'string' && encodings.includes(e.encoding) ? e.encoding : null
+  const workspace = typeof e.workspace === 'string' ? parseWorkspace(e.workspace) : null
+  const positions = parsePositions(e.positions)
+  if (e.version !== LINK_VERSION || encoding === null || workspace === null || positions === null) {
+    return { kind: 'program', program: e.program, encoding }
+  }
+  return { kind: 'whole', program: e.program, encoding, workspace, positions }
+}
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  61 passed (61)
Tests  950 passed (950)
```

Run: `cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --working-directory="$PWD" pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  138 passed (138)
Tests  943 passed (943)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each.** In the replay, 16 of 16 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | a decoder that ignores `version` — `src/share-link.ts`: `  if (e.version !== LINK_VERSION \|\| encoding === null` → `  if (encoding === null` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > a link that opens the program alone > opens the program alone, under its encoding, for a version other than 1` |
| 2 | an encoding this build does not have, taken — `src/share-link.ts`: `typeof e.encoding === 'string' && encodings.includes(e.encoding) ? e.encoding : null` → `typeof e.encoding === 'string' ? e.encoding : null` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > a link that opens the program alone > opens the program alone, with no encoding, for an encoding this build does not have` |
| 3 | a workspace embedded as an object, taken — `src/share-link.ts`: `typeof e.workspace === 'string' ? parseWorkspace(e.workspace) : null` → `typeof e.workspace === 'string' ? parseWorkspace(e.workspace) : parseWorkspace(JSON.stringify(e.workspace))` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `` tests/node/share-link.test.ts > a link that opens the program alone > opens the program alone for a workspace that is not `serializeWorkspace`'s string, or that it refuses `` |
| 4 | a negative step, taken — `src/share-link.ts`: ` \|\| (step as number) < 0) return null` → `) return null` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > a link that opens the program alone > opens the program alone for positions that are a negative step` |
| 5 | a key that is not a leg, read as λ — `src/share-link.ts`: `const leg = LEGS.find((l) => l === key)` → `const leg = LEGS.find((l) => l === key) ?? 'lambda'` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > a link that opens the program alone > opens the program alone for positions that are a key that is not a leg` |
| 6 | an array of positions, taken — `src/share-link.ts`: `if (typeof v !== 'object' \|\| v === null \|\| Array.isArray(v)) return null` → `if (typeof v !== 'object' \|\| v === null) return null` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > a link that opens the program alone > opens the program alone for positions that are an array, even an empty one` |
| 7 | a step past the safe integers, taken — `src/share-link.ts`: `!Number.isSafeInteger(step)` → `!Number.isInteger(step)` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > a link that opens the program alone > opens the program alone for positions that are a step past the safe integers` |
| 8 | bytes that are not UTF-8, read leniently — `src/share-link.ts`: `new TextDecoder('utf-8', { fatal: true })` → `new TextDecoder()` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > a link nothing can be read from > refuses a payload that is not UTF-8, or not JSON, or JSON that is not an object` |
| 9 | the cap doubled — `src/share-link.ts`: `if (total > MAX_LINK_BYTES) {` → `if (total > 2 * MAX_LINK_BYTES) {` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > a link nothing can be read from > reads a payload of exactly MAX_LINK_BYTES, and refuses one a byte longer` |
| 10 | the cap a byte short — `src/share-link.ts`: `if (total > MAX_LINK_BYTES) {` → `if (total >= MAX_LINK_BYTES) {` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > a link nothing can be read from > reads a payload of exactly MAX_LINK_BYTES, and refuses one a byte longer` |
| 11 | the input handed to the inflate whole — `src/share-link.ts`: `  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader()` → `  const reader = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-link-inflate.test.ts` | `tests/browser/share-link-inflate.test.ts > refuses a link inflating to 64 MiB having handed the inflate under 16 KiB of it` |
| 12 | the padding kept — `src/share-link.ts`: `.replaceAll('/', '_').replace(/=+$/, '')` → `.replaceAll('/', '_')` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 1`, `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 2`, `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 3`, `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 5`, `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 7`, `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 8`, `` tests/node/share-link.test.ts > encodeLink and decodeLink > writes `#s=` and unpadded base64url, and nothing else `` |
| 13 | the positions left out of the payload — `src/share-link.ts`: `    positions: payload.positions, ⏎ ` → `    positions: {}, ⏎ ` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 2`, `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 3`, `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 4`, `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 5`, `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 6`, `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 7`, `tests/node/share-link.test.ts > encodeLink and decodeLink > reads back whole what it wrote, generated from seed 8`, `tests/node/share-link.test.ts > encodeLink and decodeLink > writes version 1, the program, the encoding, the workspace string and the positions` |
| 14 | any fragment holding `s=` taken as a link — `src/share-link.ts`: `fragment.startsWith(LINK_PREFIX)` → `fragment.includes('s=')` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `` tests/node/share-link.test.ts > isLink > is a fragment starting `#s=`, and no other `` |
| 15 | a program that is not a string, opened — `src/share-link.ts`: `  if (typeof e.program !== 'string') return unreadable ⏎ ` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > a link nothing can be read from > refuses a payload that is not UTF-8, or not JSON, or JSON that is not an object`, `tests/node/share-link.test.ts > a link nothing can be read from > refuses a payload whose program is missing or not a string` |
| 16 | a later workspace version that refuses version 2 — `src/workspace.ts`: `export const WORKSPACE_VERSION = 2` → `export const WORKSPACE_VERSION = 3` | `cd web && pnpm exec vitest run --project node tests/node/share-link.test.ts` | `tests/node/share-link.test.ts > the frozen link from version 1 > opens whole, as the program, the encoding, the workspace and the positions it was written with` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
The share link's codec: a link encodes the program, its encoding, the workspace and positions, and decodes whole, as the program alone, or not at all

`share-link.ts` writes `#s=` and the unpadded base64url of the
deflate-raw of a version 1 JSON payload, through the browser's own
`CompressionStream` (spec §5.1). `decodeLink` reads a link whole only
when every field holds, the program alone under its encoding where
anything else fails, and nothing where no string program can be read
(§5.3). The inflate is fed a kilobyte at a time and refused past
`MAX_LINK_BYTES`, 8 MiB, measured in Chrome: the page keeps a fragment
of any length, so the cap is the one bound a crafted link has (§10).
The frozen link from version 1, written by Chrome, must go on opening.
````

---

### Task 2: `share`: the popover, its link and its copy

**Files:**
- Create: `web/src/share-popover.ts`
- Modify: `web/index.html` (the button and its popover after the spacer, before `appearance`), `web/src/link-wiring.ts` (`detachedPanes` on `LinkWiring`), `web/src/main.ts` (the two mount points, `sharePayload`, the popover's `wireMenu`), `web/src/style.css` (`#share` in the header buttons' rule; the popover; `#share-menu` in the gutter block)
- Modify (tests): `web/tests/browser/harness.ts` (`SHELL`), `web/tests/node/harness.test.ts` (the two ids), `web/tests/browser/controls-gate.test.ts`, `web/tests/browser/header-menus-narrow.test.ts`
- Test: `web/tests/browser/share-popover.test.ts`

**Interfaces:**
- Consumes Task 1's `encodeLink` and `SharePayload`.
- Produces `share-popover.ts`'s `LONG_LINK = 2000`; `type ShareDeps = { menu: HTMLElement; payload: () => SharePayload; base: () => string; copies: () => readonly string[]; clipboard: () => Pick<Clipboard, 'writeText'> | undefined; notify: (text: string) => void }` (all `readonly`); `copiesLine(titles: readonly string[]): string | null`; `lengthLine(link: string): string | null`; `createShare(deps: ShareDeps): () => void`, the popover's `onOpen`. `link-wiring.ts`'s `LinkWiring.detachedPanes(): DetachedPanes`. The markup `#share` and `#share-menu`; the field `#share-link`, `button.share-copy`, `#share-length`, `#share-copies`.

**THE POPOVER IS BUILT AGAIN ON EACH OPEN, AND NOTHING KEEPS A LINK CURRENT** (spec §5.2, row 8): `share` sits after the spacer, before `appearance`, a popover wired by `wireMenu` whose `onOpen` is `createShare`'s. The link is `location.origin + location.pathname` and the fragment of `main.ts`'s `sharePayload`: the source editor's text, the picker's encoding, `serializeWorkspace` of the workspace, and each program leg's `hist.currentStep` where it has frames — none while the program session awaits a run (§5.1).

**THE FIELD TAKES THE FOCUS AND ITS TEXT IS SELECTED WHEN THE LINK ARRIVES**: the field is `autofocus`, and the link, made asynchronously, is selected as it is filled (the prototype's finding 5). `copy link` is disabled with its reason as its tooltip until then, removed where the page has no clipboard, and a refused write leaves the field selected (§5.2, §6). The two lines describe the field.

**THE GATE AND THE HEADER TEST TAKE `share` IN**: the controls gate asserts `share` among the header menus it reads off the page and walks its field; the header test counts it among the three rows at 390px and holds its popover to the gutter (§6, the prototype's findings 1 and 7).

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=2
diff --git a/web/tests/browser/controls-gate.test.ts b/web/tests/browser/controls-gate.test.ts
index 9bc1a80..92cb776 100644
--- a/web/tests/browser/controls-gate.test.ts
+++ b/web/tests/browser/controls-gate.test.ts
@@ -232,12 +232,13 @@ describe.each(STATES)('every control in $name', ({ name, picks, tiled }) => {
    * **EVERY HEADER MENU, READ OFF THE PAGE RATHER THAN LISTED** — `viewLeaves`' reason: a list of the menus there were
    * is a list that misses the next one. This was `#workspace`, `#new-view`, `#buffers` and `#settings`, and
    * `examples ▾` joined the header without joining it (Plan 7 part 6a spec §6). Every header menu there is now is
-   * asserted among the ones walked, so the loop cannot pass by walking fewer.
+   * asserted among the ones walked, so the loop cannot pass by walking fewer — `share` since part 6a's second half,
+   * whose field is a form control the walk reads by its label.
    */
   it('with each header menu open', () => {
     const openers = [...document.querySelectorAll<HTMLButtonElement>('header.bar button[aria-controls]')]
     expect(openers.map((b) => b.id)).toEqual(
-      expect.arrayContaining(['workspace', 'new-view', 'buffers', 'examples', 'settings']),
+      expect.arrayContaining(['workspace', 'new-view', 'buffers', 'examples', 'share', 'settings']),
     )
     const walked: string[] = []
     for (const button of openers) {
@@ -248,8 +249,10 @@ describe.each(STATES)('every control in $name', ({ name, picks, tiled }) => {
       walked.push(...check(`${name}: #${button.id}`).map((el) => el.id))
       if (menu?.matches(':popover-open')) menu.hidePopover()
     }
-    // A FORM CONTROL THAT IS NOT A SELECT IS WALKED: the settings menu's checkbox, which `button, select` never reached.
+    // A FORM CONTROL THAT IS NOT A SELECT IS WALKED: the settings menu's checkbox, which `button, select` never reached,
+    // and the share popover's field.
     expect(walked).toContain('format-on-blur')
+    expect(walked).toContain('share-link')
   })
 
   it("with every view's title and ⋯ menu open", () => {
diff --git a/web/tests/browser/harness.ts b/web/tests/browser/harness.ts
index bdeb065..9dc2843 100644
--- a/web/tests/browser/harness.ts
+++ b/web/tests/browser/harness.ts
@@ -44,6 +44,8 @@ export const SHELL = `
       <select id="encoding"></select>
     </label>
     <span class="bar-spacer"></span>
+    <button type="button" id="share" aria-haspopup="menu" aria-controls="share-menu" aria-expanded="false">share</button>
+    <div id="share-menu" class="header-menu share" popover></div>
     <button type="button" id="appearance"></button>
     <button type="button" id="settings" aria-haspopup="menu" aria-controls="settings-menu" aria-expanded="false">settings</button>
     <div id="settings-menu" class="header-menu settings" popover>
diff --git a/web/tests/browser/header-menus-narrow.test.ts b/web/tests/browser/header-menus-narrow.test.ts
index bdc9695..60855da 100644
--- a/web/tests/browser/header-menus-narrow.test.ts
+++ b/web/tests/browser/header-menus-narrow.test.ts
@@ -3,8 +3,9 @@ import { page, userEvent } from 'vitest/browser'
 import { SHELL, until } from './harness'
 
 /**
- * **THE HEADER'S WIDE MENUS ON A PHONE'S SCREEN** — Plan 7 part 6a spec §4.2 and §8's phone-width row, for
- * `examples ▾` and the workspace menu, the two whose minimum width is `20rem`. Each is no wider than the page less a
+ * **THE HEADER'S WIDE MENUS ON A PHONE'S SCREEN** — Plan 7 part 6a spec §4.2, §5.2 and §8's phone-width row, for
+ * `examples ▾` and the workspace menu, the two whose minimum width is `20rem`, and `share`'s popover, whose width is
+ * `32rem` at a desktop's. Each is no wider than the page less a
  * `1rem` gutter each side at a phone's width, and its button sits in a header that wraps, so what is held is where the
  * open menu lies, measured: inside that gutter on both sides of the page. The page under it is held not to scroll
  * sideways too. The desktop cases hold the geometry the phone's must not change. ONE MOUNT FOR THE FILE,
@@ -85,6 +86,35 @@ describe('examples ▾, open', () => {
   })
 })
 
+describe('share, open', () => {
+  /**
+   * **ITS BUTTON SITS NEAR THE HEADER'S RIGHT EDGE, SO THE POPOVER MEETS THAT EDGE.** Without its end margin it lay
+   * flush with it at 480px, and at 390px in Debugger (`style.css`'s gutter block has the figures).
+   */
+  it.each(WIDTHS)(
+    'lies inside its gutter on a page %i px wide, on a page that does not scroll sideways',
+    async (width, height) => {
+      try {
+        expectWithinGutter(await openAt('share', width, height), width)
+      } finally {
+        menuOf('share').hidePopover()
+      }
+    },
+  )
+
+  it('opens leftward under its button at a desktop width, 32rem wide', async () => {
+    try {
+      const rect = await openAt('share', 1280, 800)
+      const anchor = buttonOf('share').getBoundingClientRect()
+      expect(rect.right).toBeCloseTo(anchor.right, 1)
+      expect(rect.top).toBeCloseTo(anchor.bottom, 1)
+      expect(rect.width).toBeCloseTo(32 * rem(), 1)
+    } finally {
+      menuOf('share').hidePopover()
+    }
+  })
+})
+
 describe('the workspace menu, open', () => {
   /** Every control in the menu, and the rows that hold the switches' values. */
   const controls = () => [...menuOf('workspace').querySelectorAll<HTMLButtonElement>('button')]
@@ -161,7 +191,8 @@ describe('the workspace menu, open', () => {
 
 /**
  * **`examples ▾` DOES NOT COST A PHONE'S PAGE A HEADER ROW** — at 390px, in Explorer and Debugger, it pushed the
- * header from three rows to four: 136px to 181px, taken from the views. Rows are counted rather than the height
+ * header from three rows to four: 136px to 181px, taken from the views. **NOR DOES `share`, BEFORE `appearance`**
+ * (Plan 7 part 6a spec §5.2): after `examples ▾` it took Debugger to four rows here. Rows are counted rather than the height
  * measured, one per distinct vertical centre, since the header's `align-items: center` puts every control in a row on
  * one. Held in Instrument, the page's default style, whose faces are bundled; Paper and Terminal draw the header in
  * the machine's own fonts, so their rows depend on the machine, and are measured by hand rather than held here.
@@ -183,15 +214,19 @@ describe('the header at 390px', () => {
     return centres.length
   }
 
-  it.each(['explorer', 'debugger', 'stage'])('keeps to three rows in %s, examples ▾ among them', async (preset) => {
-    await page.viewport(390, 844)
-    try {
-      presetOf(preset)
-      expect(document.documentElement.getAttribute('data-style') ?? 'instrument').toBe('instrument')
-      expect(buttonOf('examples').getBoundingClientRect().width).toBeGreaterThan(0)
-      expect(headerRows()).toBe(3)
-    } finally {
-      presetOf('explorer')
-    }
-  })
+  it.each(['explorer', 'debugger', 'stage'])(
+    'keeps to three rows in %s, examples ▾ and share among them',
+    async (preset) => {
+      await page.viewport(390, 844)
+      try {
+        presetOf(preset)
+        expect(document.documentElement.getAttribute('data-style') ?? 'instrument').toBe('instrument')
+        expect(buttonOf('examples').getBoundingClientRect().width).toBeGreaterThan(0)
+        expect(buttonOf('share').getBoundingClientRect().width).toBeGreaterThan(0)
+        expect(headerRows()).toBe(3)
+      } finally {
+        presetOf('explorer')
+      }
+    },
+  )
 })
diff --git a/web/tests/browser/share-popover.test.ts b/web/tests/browser/share-popover.test.ts
new file mode 100644
index 0000000..707b95d
--- /dev/null
+++ b/web/tests/browser/share-popover.test.ts
@@ -0,0 +1,222 @@
+import type { EditorView } from '@codemirror/view'
+import { computeAccessibleName } from 'dom-accessibility-api'
+import { afterAll, beforeAll, describe, expect, it } from 'vitest'
+import { cdp, page, userEvent } from 'vitest/browser'
+import { LAYOUT_STORAGE_KEY } from '../../src/layout'
+import { decodeLink } from '../../src/share-link'
+import { parseWorkspace } from '../../src/workspace'
+import { SHELL, until } from './harness'
+
+/**
+ * **`share`: THE POPOVER, ITS LINK AND ITS COPY** — Plan 7 part 6a spec §5.1, §5.2 and §6. Driven by real pointer
+ * clicks, because a synthetic `.click()` is not the gesture, but where a case needs what the popover holds before its
+ * link is made, which a click that awaits the browser is too slow to see. The page opens on the program `setup.ts`
+ * stores, `let x = 40; x + 2`, whose legs end at λ 7, asm 5 and TM 2,870 (spec §2.7). ONE MOUNT FOR THE FILE, for
+ * the reason every sibling gives.
+ */
+
+const ENCODINGS = ['unary', 'binary']
+const button = () => document.querySelector<HTMLButtonElement>('#share') as HTMLButtonElement
+const menu = () => document.querySelector<HTMLElement>('#share-menu') as HTMLElement
+const open = () => menu().matches(':popover-open')
+const field = () => menu().querySelector<HTMLInputElement>('#share-link') as HTMLInputElement
+const copyButton = () => menu().querySelector<HTMLButtonElement>('button.share-copy')
+const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
+const fragmentOf = (link: string): string => link.slice(link.indexOf('#'))
+
+let view: EditorView
+
+beforeAll(async () => {
+  await page.viewport(1280, 800)
+  document.body.innerHTML = SHELL
+  view = await (await import('../../src/main')).ready
+  await until(() => idle() && segments().length === 3, 'the first compile')
+})
+
+/**
+ * The browser context this page is in. **A PERMISSION IS GRANTED TO A CONTEXT, NAMED**: sent without one, CDP grants
+ * it to Chrome's default context, not Playwright's, and every write is still refused — as it is here by default.
+ */
+async function context(): Promise<string> {
+  const { targetInfo } = (await cdp().send('Target.getTargetInfo')) as { targetInfo: { browserContextId?: string } }
+  if (targetInfo.browserContextId === undefined) throw new Error('the page is in no browser context')
+  return targetInfo.browserContextId
+}
+
+afterAll(async () => {
+  await cdp().send('Browser.resetPermissions', { browserContextId: await context() })
+})
+
+/** Open the popover with a click, and answer its link once it is made. */
+async function openShare(): Promise<string> {
+  if (open()) menu().hidePopover()
+  await userEvent.click(button())
+  expect(open()).toBe(true)
+  await until(() => field().value !== '', 'the link')
+  return field().value
+}
+
+describe('share', () => {
+  it('sits after the spacer and before appearance, in the chrome of the header’s other buttons', () => {
+    const spacer = document.querySelector('header.bar .bar-spacer') as HTMLElement
+    const appearance = document.querySelector<HTMLButtonElement>('#appearance') as HTMLButtonElement
+    expect(spacer.compareDocumentPosition(button()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
+    expect(button().compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
+    expect(computeAccessibleName(button())).toBe('share')
+    const [x, y] = [appearance, button()].map((el) => getComputedStyle(el))
+    for (const property of [
+      'borderTopStyle',
+      'borderTopWidth',
+      'paddingLeft',
+      'backgroundColor',
+      'fontFamily',
+    ] as const)
+      expect(y?.[property], property).toBe(x?.[property])
+    expect(button().getBoundingClientRect().height).toBe(appearance.getBoundingClientRect().height)
+  })
+
+  it('opens on a click, with the link in its field, focused and selected', async () => {
+    expect(button().getAttribute('aria-expanded')).toBe('false')
+    const link = await openShare()
+    expect(button().getAttribute('aria-expanded')).toBe('true')
+    expect(link.startsWith(`${location.origin}${location.pathname}#s=`)).toBe(true)
+    expect(document.activeElement).toBe(field())
+    expect([field().selectionStart, field().selectionEnd]).toEqual([0, link.length])
+    expect(field().readOnly).toBe(true)
+    // NAMED BY ITS LABEL, `link`, and not by the link it holds.
+    expect(computeAccessibleName(field())).toBe('link')
+    // A SHORT LINK AND NO COPY ON THE PAGE: neither line, and nothing describing the field.
+    expect(menu().querySelector('.share-line')).toBeNull()
+    expect(field().hasAttribute('aria-describedby')).toBe(false)
+  })
+
+  it('links to what is on the page: the program, its encoding, the workspace, and each leg’s step', async () => {
+    const opened = await decodeLink(fragmentOf(await openShare()), ENCODINGS)
+    expect(opened).toEqual({
+      kind: 'whole',
+      program: 'let x = 40; x + 2',
+      encoding: 'unary',
+      workspace: parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY)),
+      positions: { lambda: 7, asm: 5, tm: 2870 },
+    })
+  })
+
+  it('takes a leg’s step where its head is, not where its recording ends', async () => {
+    menu().hidePopover()
+    await userEvent.click(
+      document.querySelector('[data-leaf="lambda-0"] button[aria-label="one step back"]') as HTMLButtonElement,
+    )
+    const opened = await decodeLink(fragmentOf(await openShare()), ENCODINGS)
+    expect(opened.kind === 'whole' && opened.positions).toEqual({ lambda: 6, asm: 5, tm: 2870 })
+  })
+
+  it('carries no positions while the program is compiling', async () => {
+    menu().hidePopover()
+    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let y = 1; y + 2' } })
+    // SYNCHRONOUSLY, SO THE POPOVER IS BUILT WHILE THE COMPILE IS STILL PENDING — a click that awaits the browser
+    // could land after it answers.
+    button().click()
+    await until(() => field().value !== '', 'the link')
+    const opened = await decodeLink(fragmentOf(field().value), ENCODINGS)
+    // `toEqual` ON THE POSITIONS THEMSELVES: `toMatchObject` would take `{}` as a subset every positions object has.
+    expect(opened.kind === 'whole' && opened.program).toBe('let y = 1; y + 2')
+    expect(opened.kind === 'whole' && opened.positions).toEqual({})
+    menu().hidePopover()
+    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
+    await until(() => idle() && (segments()[0] ?? '').startsWith('λ 42'), 'the program’s compile')
+  })
+
+  it('offers copy link disabled, with its reason, until the link is made', async () => {
+    if (open()) menu().hidePopover()
+    button().click()
+    expect(copyButton()?.disabled).toBe(true)
+    expect(copyButton()?.title).toBe('the link is being made')
+    expect(field().value).toBe('')
+    await until(() => copyButton()?.disabled === false, 'the link')
+    expect(copyButton()?.hasAttribute('title')).toBe(false)
+    expect(computeAccessibleName(copyButton() as HTMLButtonElement)).toBe('copy link')
+  })
+
+  it('copies the link on a click, and says so', async () => {
+    await cdp().send('Browser.grantPermissions', {
+      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
+      browserContextId: await context(),
+    })
+    const link = await openShare()
+    await userEvent.click(copyButton() as HTMLButtonElement)
+    await until(() => noticeText() === 'link copied', 'the copy')
+    expect(await navigator.clipboard.readText()).toBe(link)
+  })
+
+  // REFUSED AFTER THE CASE ABOVE GRANTED IT, so the refusal is the permission's and not the context's default.
+  it('says the link is selected in the field when the clipboard refuses it', async () => {
+    await cdp().send('Browser.setPermission', {
+      permission: { name: 'clipboard-write' },
+      setting: 'denied',
+      browserContextId: await context(),
+    })
+    const link = await openShare()
+    await userEvent.click(copyButton() as HTMLButtonElement)
+    await until(() => noticeText() === 'the link could not be copied — it is selected in the field', 'the refusal')
+    expect(document.activeElement).toBe(field())
+    expect([field().selectionStart, field().selectionEnd]).toEqual([0, link.length])
+  })
+
+  it('has no copy link where the page has no clipboard, and the field is still selected', async () => {
+    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
+    try {
+      const link = await openShare()
+      // NO BUTTON AT ALL, not merely none named `copy link`: the field is the whole of the way to copy here.
+      expect(menu().querySelector('button')).toBeNull()
+      expect(document.activeElement).toBe(field())
+      expect([field().selectionStart, field().selectionEnd]).toEqual([0, link.length])
+    } finally {
+      delete (navigator as { clipboard?: Clipboard }).clipboard
+    }
+    expect(navigator.clipboard).toBeDefined()
+  })
+
+  it('closes on Escape, with the focus back on share', async () => {
+    await openShare()
+    await userEvent.keyboard('{Escape}')
+    expect(open()).toBe(false)
+    expect(button().getAttribute('aria-expanded')).toBe('false')
+    expect(document.activeElement).toBe(button())
+  })
+
+  it('says how long a link is past 2,000 characters, and that some apps cut it', async () => {
+    // TEXT THAT DOES NOT COMPRESS: a number per line from a seeded generator, as a comment.
+    let s = 7
+    const noise = Array.from({ length: 400 }, () => {
+      s = (s * 1103515245 + 12345) % 2147483648
+      return `// ${s.toString(36)}`
+    }).join('\n')
+    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: `${noise}\nlet x = 40; x + 2` } })
+    await until(() => idle() && (segments()[0] ?? '').startsWith('λ 42'), 'the long program’s compile')
+    const link = await openShare()
+    expect(link.length).toBeGreaterThan(2000)
+    const line = menu().querySelector('#share-length')
+    expect(line?.textContent).toBe(
+      `this link is ${link.length.toLocaleString('en-US')} characters long — some chat and mail apps cut links past 2,000`,
+    )
+    expect(field().getAttribute('aria-describedby')).toBe('share-length')
+    menu().hidePopover()
+    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
+    await until(() => idle() && (segments()[0] ?? '').startsWith('λ 42'), 'the program’s compile')
+  })
+
+  it('names the views that will open on the program, when a view shows a copy', async () => {
+    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
+    await until(
+      () => (document.querySelector('[data-leaf="lambda-0"] .view-title')?.textContent ?? '').includes('copy'),
+      'the copy',
+    )
+    await openShare()
+    expect(menu().querySelector('#share-copies')?.textContent).toBe(
+      'copies are not included — the λ · copy 1 view will open on the program',
+    )
+    expect(field().getAttribute('aria-describedby')).toBe('share-copies')
+  })
+})
diff --git a/web/tests/node/harness.test.ts b/web/tests/node/harness.test.ts
index 461d0ee..633dfaf 100644
--- a/web/tests/node/harness.test.ts
+++ b/web/tests/node/harness.test.ts
@@ -14,6 +14,8 @@ describe('SHELL', () => {
       '#examples',
       '#examples-menu',
       '#encoding',
+      '#share',
+      '#share-menu',
       '#settings',
       '#style',
       '#palette',
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/harness.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  1 failed | 6 passed (7)
```

Failing: `tests/node/harness.test.ts > SHELL against index.html > is the same markup the real page ships, from <header> to the end of the strip`.

Run: `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts tests/browser/header-menus-narrow.test.ts tests/browser/controls-gate.test.ts`

Expected: exit 1, printing:

```text
Test Files  3 failed (3)
Tests  21 failed | 35 passed (56)
```

Failing: `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with each header menu open`, `tests/browser/header-menus-narrow.test.ts > share, open > lies inside its gutter on a page 320 px wide, on a page that does not scroll sideways`, `tests/browser/header-menus-narrow.test.ts > share, open > lies inside its gutter on a page 360 px wide, on a page that does not scroll sideways`, `tests/browser/header-menus-narrow.test.ts > share, open > lies inside its gutter on a page 390 px wide, on a page that does not scroll sideways`, `tests/browser/header-menus-narrow.test.ts > share, open > lies inside its gutter on a page 480 px wide, on a page that does not scroll sideways`, `tests/browser/header-menus-narrow.test.ts > share, open > opens leftward under its button at a desktop width, 32rem wide`, `tests/browser/share-popover.test.ts > share > carries no positions while the program is compiling`, `tests/browser/share-popover.test.ts > share > closes on Escape, with the focus back on share`, `tests/browser/share-popover.test.ts > share > copies the link on a click, and says so`, `tests/browser/share-popover.test.ts > share > has no copy link where the page has no clipboard, and the field is still selected`, `tests/browser/share-popover.test.ts > share > links to what is on the page: the program, its encoding, the workspace, and each leg’s step`, `tests/browser/share-popover.test.ts > share > names the views that will open on the program, when a view shows a copy`, `tests/browser/share-popover.test.ts > share > offers copy link disabled, with its reason, until the link is made`, `tests/browser/share-popover.test.ts > share > opens on a click, with the link in its field, focused and selected`, `tests/browser/share-popover.test.ts > share > says how long a link is past 2,000 characters, and that some apps cut it`, `tests/browser/share-popover.test.ts > share > says the link is selected in the field when the clipboard refuses it`, `tests/browser/share-popover.test.ts > share > sits after the spacer and before appearance, in the chrome of the header’s other buttons`, `tests/browser/share-popover.test.ts > share > takes a leg’s step where its head is, not where its recording ends`.

- [ ] **Step 3: Write the code.**

````diff apply=source task=2
diff --git a/web/index.html b/web/index.html
index fd5a338..2483912 100644
--- a/web/index.html
+++ b/web/index.html
@@ -54,6 +54,8 @@
         <select id="encoding"></select>
       </label>
       <span class="bar-spacer"></span>
+      <button type="button" id="share" aria-haspopup="menu" aria-controls="share-menu" aria-expanded="false">share</button>
+      <div id="share-menu" class="header-menu share" popover></div>
       <button type="button" id="appearance"></button>
       <button type="button" id="settings" aria-haspopup="menu" aria-controls="settings-menu" aria-expanded="false">settings</button>
       <div id="settings-menu" class="header-menu settings" popover>
diff --git a/web/src/link-wiring.ts b/web/src/link-wiring.ts
index f16773e..86451c0 100644
--- a/web/src/link-wiring.ts
+++ b/web/src/link-wiring.ts
@@ -55,6 +55,11 @@ export type LinkWiring = {
   drawLink(l: Link | null, focusCoincident: boolean, asmCoincident: boolean, lambda: LambdaLinkState): void
   setLinkTo(node: number | null, origin: Pin['origin']): void
   linkAtSourceOffset(byteOffset: number): void
+  /**
+   * Per leg, how many views it has and the title of each one showing a copy — what the status line's detachment clause
+   * reads, and what the share popover's copies line names (Plan 7 part 6a spec §5.2).
+   */
+  detachedPanes(): DetachedPanes
 }
 
 export function createLinkWiring(deps: {
@@ -283,5 +288,6 @@ export function createLinkWiring(deps: {
     drawLink,
     setLinkTo,
     linkAtSourceOffset,
+    detachedPanes,
   }
 }
diff --git a/web/src/main.ts b/web/src/main.ts
index 877b232..1f608f4 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -40,7 +40,7 @@ import { icon } from './icons'
 import { LambdaTrees } from './lambda-trees'
 import { closeLeaf, defaultLayout, LAYOUT_STORAGE_KEY, type LayoutNode, leaves, SOURCE_LEAF } from './layout'
 import { retitleStage } from './layout-view'
-import { LEG_NAME } from './legs'
+import { LEG_NAME, LEGS } from './legs'
 import { createLinkWiring, type LinkWiring } from './link-wiring'
 import { LspClient } from './lsp-client'
 import { lspHover } from './lsp-hover'
@@ -63,6 +63,8 @@ import { createReplies } from './replies'
 import { BufferCapReached, type BufferRecord, MAX_WARM_BUFFERS, ScratchBuffers } from './scratch'
 import { type SessionId, SessionPool } from './session-client'
 import { legControlState, type SessionLegs, SessionRegistry } from './sessions'
+import type { SharePayload } from './share-link'
+import { createShare } from './share-popover'
 import {
   applySkin,
   customPaletteLabel,
@@ -214,6 +216,8 @@ async function main(): Promise<EditorView> {
   const buffersButton = document.querySelector<HTMLButtonElement>('#buffers')
   const examplesButton = document.querySelector<HTMLButtonElement>('#examples')
   const examplesMenu = document.querySelector<HTMLElement>('#examples-menu')
+  const shareButton = document.querySelector<HTMLButtonElement>('#share')
+  const shareMenu = document.querySelector<HTMLElement>('#share-menu')
   const noticeHost = document.querySelector<HTMLElement>('#notice')
   const liveHost = document.querySelector<HTMLElement>('#live')
   // **`#views`, NOT `<main>` — spec §9.** `renderLayout` opens with `root.replaceChildren()`, so the
@@ -243,6 +247,8 @@ async function main(): Promise<EditorView> {
     !buffersButton ||
     !examplesButton ||
     !examplesMenu ||
+    !shareButton ||
+    !shareMenu ||
     !noticeHost ||
     !stepBarHost ||
     !inspectorHost ||
@@ -1677,6 +1683,45 @@ async function main(): Promise<EditorView> {
   // `examples ▾` — spec §4.2: built on each open, as `+ view`'s menu is, from the manifest.
   wireMenu(examplesButton, examplesMenu, () => exampleItems(examplesMenu, EXAMPLES, openExample))
 
+  /**
+   * WHAT A LINK CARRIES NOW — Plan 7 part 6a spec §5.1: the source editor's text, the encoding in the picker, the
+   * workspace as `serializeWorkspace` writes it, and the step of each program leg with frames.
+   *
+   * **A POSITION IS TAKEN ONLY WHILE THE PROGRAM SESSION IS NOT AWAITING A RUN** (`SessionClient.awaitingRun`).
+   * Positions describe the frames on screen, and while the editor's text is compiling those are the last program's, so
+   * a link made then carries none.
+   */
+  const sharePayload = (): SharePayload => {
+    const positions: { [L in Leg]?: number } = {}
+    if (!sessions.entryOf(SOURCE_SESSION).client.awaitingRun) {
+      for (const leg of LEGS) {
+        const { hist } = sessions.legOf({ session: SOURCE_SESSION, leg })
+        if (hist.length > 0) positions[leg] = hist.currentStep
+      }
+    }
+    return {
+      program: view.state.doc.toString(),
+      encoding: picker.value,
+      workspace: serializeWorkspace({ tree, ...ws }),
+      positions,
+    }
+  }
+
+  // `share` — spec §5.2: a popover built again on each open, so nothing keeps a link current (row 8).
+  wireMenu(
+    shareButton,
+    shareMenu,
+    createShare({
+      menu: shareMenu,
+      payload: sharePayload,
+      base: () => `${location.origin}${location.pathname}`,
+      copies: () => LEGS.flatMap((leg) => linkWiring.detachedPanes()[leg].copies),
+      // `undefined` OUTSIDE A SECURE CONTEXT, though the DOM's types say otherwise: the clipboard is exposed only there.
+      clipboard: () => navigator.clipboard as Clipboard | undefined,
+      notify: (text) => notices.notify(text),
+    }),
+  )
+
   /**
    * Undo a delete — spec §10. The copy comes back under its own id and name, COLD, and is warmed; a
    * refusal at the cap leaves it paused, which is still a copy restored. The views the delete moved to
diff --git a/web/src/share-popover.ts b/web/src/share-popover.ts
new file mode 100644
index 0000000..45d9d2c
--- /dev/null
+++ b/web/src/share-popover.ts
@@ -0,0 +1,128 @@
+import { n } from './format'
+import { encodeLink, type SharePayload } from './share-link'
+
+/**
+ * THE SHARE POPOVER — Plan 7 part 6a spec §5.2: `share`'s popover, built again on each open as the workspace menu is,
+ * so nothing keeps a link current (row 8). It holds the link in a read-only field, which takes the focus with its text
+ * selected; `copy link`, where the page can write to the clipboard; and up to two lines under them, each describing
+ * the field: how long the link is, past the length some apps cut, and which views will open on the program because a
+ * copy is not included.
+ */
+
+/** The length past which a link is said to be long: many chat and mail clients cut a link past it (spec row 8). */
+export const LONG_LINK = 2000
+
+/** What the popover asks of the page each time it opens. */
+export type ShareDeps = {
+  /** The popover, `#share-menu`. */
+  readonly menu: HTMLElement
+  /** What the link carries: the program, its encoding, the workspace and positions (spec §5.1). */
+  readonly payload: () => SharePayload
+  /** What the fragment follows: `location.origin + location.pathname`. */
+  readonly base: () => string
+  /** The title of each view showing a copy: the views a link opens on the program instead (spec row 14). */
+  readonly copies: () => readonly string[]
+  /**
+   * The clipboard, or `undefined` where the page is not a secure context and there is none. **ASKED ON EACH OPEN**,
+   * since whether the page is one does not change, and asking late costs nothing.
+   */
+  readonly clipboard: () => Pick<Clipboard, 'writeText'> | undefined
+  readonly notify: (text: string) => void
+}
+
+/** `a`, `a and b`, `a, b and c`. */
+const listed = (names: readonly string[]): string =>
+  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
+
+/** The line naming the views a link opens on the program, or `null` when no view shows a copy (spec §5.2, row 14). */
+export function copiesLine(titles: readonly string[]): string | null {
+  const names = [...new Set(titles)]
+  if (names.length === 0) return null
+  return `copies are not included — the ${listed(names)} ${names.length === 1 ? 'view' : 'views'} will open on the program`
+}
+
+/** The line saying a link is long, or `null` for one no longer than `LONG_LINK` (spec §5.2, row 8). */
+export function lengthLine(link: string): string | null {
+  if (link.length <= LONG_LINK) return null
+  return `this link is ${n(link.length)} characters long — some chat and mail apps cut links past ${n(LONG_LINK)}`
+}
+
+/**
+ * Wire the popover's content, answering what `wireMenu` runs on each open.
+ *
+ * **THE FIELD IS `autofocus`, AND ITS TEXT IS SELECTED WHEN THE LINK ARRIVES.** `wireMenu` autofocuses a button or a
+ * select, and `copy link` is disabled while the link is made, so the field is marked here, and the popover's showing
+ * puts the focus in it. The link is made asynchronously, since `CompressionStream` is, so it always arrives after the
+ * popover has shown: selecting it on `toggle`, where the spec put it, would select an empty field. It is selected as it
+ * is filled instead, while the field still holds the focus.
+ *
+ * **A LINK THAT ARRIVES AFTER THE POPOVER WAS OPENED AGAIN FILLS ITS OWN OPEN'S FIELD**, which that open's rebuild took
+ * off the page, and so changes nothing a user can see.
+ */
+export function createShare(deps: ShareDeps): () => void {
+  const { menu } = deps
+  return () => {
+    const input = document.createElement('input')
+    input.type = 'text'
+    input.readOnly = true
+    input.id = 'share-link'
+    input.autofocus = true
+    input.spellcheck = false
+    const label = document.createElement('label')
+    label.className = 'share-field'
+    label.append('link ', input)
+
+    const clipboard = deps.clipboard()
+    // **REMOVED WHERE IT CAN NEVER APPLY** (umbrella §4 rule 4): outside a secure context there is no clipboard, and
+    // the selected field is the way to copy.
+    const copy = clipboard === undefined ? null : document.createElement('button')
+    if (copy !== null && clipboard !== undefined) {
+      copy.type = 'button'
+      copy.className = 'share-copy'
+      copy.textContent = 'copy link'
+      copy.disabled = true
+      copy.title = 'the link is being made'
+      copy.addEventListener('click', () => {
+        clipboard.writeText(input.value).then(
+          () => deps.notify('link copied'),
+          () => {
+            input.focus()
+            input.select()
+            deps.notify('the link could not be copied — it is selected in the field')
+          },
+        )
+      })
+    }
+
+    const line = (id: string, text: string | null): HTMLElement | null => {
+      if (text === null) return null
+      const p = document.createElement('p')
+      p.className = 'share-line'
+      p.id = id
+      p.textContent = text
+      return p
+    }
+    const copies = line('share-copies', copiesLine(deps.copies()))
+    const describe = (lines: readonly (HTMLElement | null)[]): void => {
+      const ids = lines.flatMap((l) => (l === null ? [] : [l.id]))
+      if (ids.length === 0) input.removeAttribute('aria-describedby')
+      else input.setAttribute('aria-describedby', ids.join(' '))
+    }
+    describe([copies])
+    menu.replaceChildren(label, ...(copy === null ? [] : [copy]), ...(copies === null ? [] : [copies]))
+
+    const payload = deps.payload()
+    const base = deps.base()
+    void encodeLink(payload).then((fragment) => {
+      input.value = `${base}${fragment}`
+      const long = line('share-length', lengthLine(input.value))
+      if (long !== null) (copy ?? label).after(long)
+      describe([long, copies])
+      if (copy !== null) {
+        copy.disabled = false
+        copy.removeAttribute('title')
+      }
+      if (document.activeElement === input) input.select()
+    })
+  }
+}
diff --git a/web/src/style.css b/web/src/style.css
index ce0032c..29ecdaa 100644
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -231,6 +231,7 @@ select option {
 #new-view,
 #buffers,
 #examples,
+#share,
 #appearance,
 #settings {
   display: inline-flex;
@@ -357,18 +358,23 @@ select option {
   min-width: min(20rem, calc(100vw - 2rem));
   max-width: min(36rem, calc(100vw - 2rem));
 }
-/* **AND THE GUTTER ON THE PAGE'S EDGE, FOR THE TWO MENUS WIDE ENOUGH TO REACH IT.** Where the anchored placement
+/* **AND THE GUTTER ON THE PAGE'S EDGE, FOR THE THREE MENUS WIDE ENOUGH TO REACH IT.** Where the anchored placement
    would run past the page's edge, the browser shifts the menu back inside, flush with that edge: both menus were, at
    320, 360 and 390px. A margin on the end side is kept in that shift, so each stops `1rem` short; and where the
    placement flips to open leftward the margin flips with it, so `examples ▾`'s menu stops `1rem` short of the left edge
    at 600 and 700px, where it touched it. Measured, with 1280px unchanged. Not on `.header-menu`: settings opens
    leftward from its button's right edge, and an end margin would move it off that edge at every width.
 
+   `share`'s popover (Plan 7 part 6a spec §5.2) is the third. Without the margin it lay flush with the page's right edge
+   at 480, 600 and 700px, and at 390px in Debugger; with it, `1rem` short of either edge at 320, 360, 390, 480, 600 and
+   700px in each preset. At 1280px it opens leftward from its button's right edge either way, measured.
+
    **ONLY WHERE THE MENU IS ANCHORED.** A browser without `position-area` takes the `@supports not` branch above,
    whose `margin: auto` centres the menu on the page; an id's end margin would beat that class rule and put the menu
    against the right edge instead, `1rem` short. */
 @supports (position-area: block-end) {
   #examples-menu,
+  #share-menu,
   #workspace-menu {
     margin-inline-end: 1rem;
   }
@@ -381,6 +387,45 @@ select option {
   font-size: var(--step--2);
   color: var(--fg-dim);
 }
+/* THE SHARE POPOVER (Plan 7 part 6a spec §5.2): the link in a read-only field, `copy link` under it, and up to two
+   lines under that. As wide as a link's start needs to be told from another's at a desktop width, and no wider than
+   the page less its gutter at a phone's. `:popover-open` for the grid, for `.header-menu.settings`' reason. */
+.header-menu.share {
+  padding: var(--space-2) var(--space-3);
+  width: min(32rem, calc(100vw - 2rem));
+}
+.header-menu.share:popover-open {
+  display: grid;
+  gap: var(--space-2);
+}
+/* THE FIELD WEARS THE HEADER'S SELECTS' CHROME, and its label is dim as theirs is. */
+.share-field {
+  display: flex;
+  align-items: center;
+  gap: var(--space-2);
+  color: var(--fg-dim);
+}
+.share-field input {
+  flex: 1 1 auto;
+  min-width: 0;
+  font: inherit;
+  padding: var(--control-pad-block) 0.6em;
+  border-radius: var(--radius);
+  border: var(--control-border) solid var(--fg-dim);
+  background: transparent;
+  color: var(--fg);
+}
+/* A BUTTON, NOT A MENU ITEM: `.header-menu > button` draws an item a row wide with no border. */
+.header-menu.share > .share-copy {
+  justify-self: start;
+  width: auto;
+  border-color: var(--fg-dim);
+}
+.share-line {
+  margin: 0;
+  font-size: var(--step--1);
+  color: var(--fg-dim);
+}
 
 /* Same treatment as `.controls button` — chrome, not a new visual language.
 
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  61 passed (61)
Tests  950 passed (950)
```

Run: `cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --working-directory="$PWD" pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  139 passed (139)
Tests  960 passed (960)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each.** In the replay, 20 of 20 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | `share` back after `examples ▾`, in `SHELL` — `tests/browser/harness.ts`: `    <div id="examples-menu" class="header-menu" popover></div> ⏎     <label class="encoding"> ⏎       encoding ⏎       <select id="encoding"></select> ⏎     </label> ⏎     <span class="bar-spacer"></span> ⏎     <button type="button" id="share" aria-haspopup="menu" aria-controls="share-menu" aria-expanded="false">share</button> ⏎     <div id="share-menu" class="header-menu share" popover></div> ⏎ ` → `    <div id="examples-menu" class="header-menu" popover></div> ⏎     <button type="button" id="share" aria-haspopup="menu" aria-controls="share-menu" aria-expanded="false">share</button> ⏎     <div id="share-menu" class="header-menu share" popover></div> ⏎     <label class="encoding"> ⏎       encoding ⏎       <select id="encoding"></select> ⏎     </label> ⏎     <span class="bar-spacer"></span> ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/header-menus-narrow.test.ts tests/browser/share-popover.test.ts` | `tests/browser/header-menus-narrow.test.ts > share, open > opens leftward under its button at a desktop width, 32rem wide`, `tests/browser/header-menus-narrow.test.ts > the header at 390px > keeps to three rows in debugger, examples ▾ and share among them`, `tests/browser/share-popover.test.ts > share > sits after the spacer and before appearance, in the chrome of the header’s other buttons` |
| 2 | the share popover out of the gutter block — `src/style.css`: `  #examples-menu, ⏎   #share-menu, ⏎   #workspace-menu {` → `  #examples-menu, ⏎   #workspace-menu {` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/header-menus-narrow.test.ts` | `tests/browser/header-menus-narrow.test.ts > share, open > lies inside its gutter on a page 480 px wide, on a page that does not scroll sideways` |
| 3 | the popover's width left to its content — `src/style.css`: `  padding: var(--space-2) var(--space-3); ⏎   width: min(32rem, calc(100vw - 2rem)); ⏎ ` → `  padding: var(--space-2) var(--space-3); ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/header-menus-narrow.test.ts` | `tests/browser/header-menus-narrow.test.ts > share, open > lies inside its gutter on a page 320 px wide, on a page that does not scroll sideways`, `tests/browser/header-menus-narrow.test.ts > share, open > opens leftward under its button at a desktop width, 32rem wide` |
| 4 | `share` without the header buttons' chrome — `src/style.css`: `#examples, ⏎ #share, ⏎ #appearance,` → `#examples, ⏎ #appearance,` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > sits after the spacer and before appearance, in the chrome of the header’s other buttons` |
| 5 | `index.html` without the popover `SHELL` carries — `index.html`: `      <div id="share-menu" class="header-menu share" popover></div> ⏎ ` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/harness.test.ts` | `tests/node/harness.test.ts > SHELL against index.html > is the same markup the real page ships, from <header> to the end of the strip` |
| 6 | the field not autofocused — `src/share-popover.ts`: `    input.autofocus = true ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > has no copy link where the page has no clipboard, and the field is still selected`, `tests/browser/share-popover.test.ts > share > opens on a click, with the link in its field, focused and selected` |
| 7 | the link not selected as it arrives — `src/share-popover.ts`: `      if (document.activeElement === input) input.select() ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > has no copy link where the page has no clipboard, and the field is still selected`, `tests/browser/share-popover.test.ts > share > opens on a click, with the link in its field, focused and selected` |
| 8 | the link's base keeping the page's query — `src/main.ts`: ``       base: () => `${location.origin}${location.pathname}`, `` → `      base: () => location.href.split('#')[0] ?? '',` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > opens on a click, with the link in its field, focused and selected` |
| 9 | positions taken while a compile is pending — `src/main.ts`: `    if (!sessions.entryOf(SOURCE_SESSION).client.awaitingRun) {` → `    if (true) {` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > carries no positions while the program is compiling` |
| 10 | a leg's step taken where its recording ends — `src/main.ts`: `        if (hist.length > 0) positions[leg] = hist.currentStep` → `        if (hist.length > 0) positions[leg] = hist.newestStep` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > takes a leg’s step where its head is, not where its recording ends` |
| 11 | `copy link` enabled before the link is made — `src/share-popover.ts`: `      copy.disabled = true ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > offers copy link disabled, with its reason, until the link is made` |
| 12 | `copy link` never enabled — `src/share-popover.ts`: `        copy.disabled = false ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > copies the link on a click, and says so`, `tests/browser/share-popover.test.ts > share > offers copy link disabled, with its reason, until the link is made`, `tests/browser/share-popover.test.ts > share > says the link is selected in the field when the clipboard refuses it` |
| 13 | a copy that says nothing — `src/share-popover.ts`: `          () => deps.notify('link copied'),` → `          () => {},` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > copies the link on a click, and says so` |
| 14 | a refused copy that leaves the field unselected — `src/share-popover.ts`: `            input.focus() ⏎             input.select() ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > says the link is selected in the field when the clipboard refuses it` |
| 15 | `copy link` kept where there is no clipboard — `src/share-popover.ts`: `  const copy = clipboard === undefined ? null : document.createElement('button')` → `  const copy = document.createElement('button')` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > has no copy link where the page has no clipboard, and the field is still selected` |
| 16 | no line for a link past 2,000 characters — `src/share-popover.ts`: `  if (link.length <= LONG_LINK) return null ⏎ ` → `  return null ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > says how long a link is past 2,000 characters, and that some apps cut it` |
| 17 | no views named for the copies — `src/main.ts`: `      copies: () => LEGS.flatMap((leg) => linkWiring.detachedPanes()[leg].copies),` → `      copies: () => [],` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > names the views that will open on the program, when a view shows a copy` |
| 18 | the lines not describing the field — `src/share-popover.ts`: `      else input.setAttribute('aria-describedby', ids.join(' '))` → `      else input.removeAttribute('aria-describedby')` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-popover.test.ts` | `tests/browser/share-popover.test.ts > share > names the views that will open on the program, when a view shows a copy`, `tests/browser/share-popover.test.ts > share > says how long a link is past 2,000 characters, and that some apps cut it` |
| 19 | the gate misses `share` — `tests/browser/controls-gate.test.ts`: `header.bar button[aria-controls]')` → `header.bar button[aria-controls]:not(#share)')` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with each header menu open` |
| 20 | the gate's selector back to `button, select` (spec §8's own) — `tests/browser/controls-gate.test.ts`: `'button, select, input, textarea'` → `'button, select'` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts` | `tests/browser/controls-gate.test.ts > every control in 'Debugger' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Explorer' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'Stage' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in 'custom' > with each header menu open`, `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > after a failing scheme's check, with its details open`, `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > open and empty, where neither apply can act`, `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > walks the settings menu's checkbox`, `tests/browser/controls-gate.test.ts > every control in Explorer, in the settings menu and the import dialog > with both halves stored, each remove named by its half, and an adjusted half’s changes` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
share: the link to what is on the page, in a popover with its field selected and a copy button, before appearance

`share` sits after the header's spacer, before `appearance` (spec §5.2),
a popover wired by `wireMenu` and built again on each open. Its field
holds `location.origin + location.pathname` and the link to the
program, its encoding, the workspace and each program leg's step, taken
only while no compile is pending (§5.1); it takes the focus with its
text selected. `copy link` writes it to the clipboard, disabled with
its reason until the link is made and removed where the page is not a
secure context; a refusal leaves the field selected. A line says when
the link runs past 2,000 characters, and another names the views that
will open on the program because they show a copy (row 14), reading
`LinkWiring.detachedPanes`. The popover keeps the 1rem gutter the
examples and workspace menus keep. The controls gate reads `share` off
the header and walks its field, and the header test counts it among
the three rows at 390px.
````

---

### Task 3: Opening a link, at start-up and pasted, with its undo

**Files:**
- Modify: `web/src/main.ts` (the start-up link, both stores' openings, the dropped bindings, the open and its `undo`, `hashchange`), `web/src/pane-host.ts` (`rebuildViews`; `applyLayout`'s `rebuild`)
- Test: `web/tests/browser/share-open.test.ts`, `share-open-alone.test.ts`, `share-open-unreadable.test.ts`, `share-open-hashchange.test.ts`, `share-open-cap.test.ts`

**Interfaces:**
- Consumes Task 1's `decodeLink`, `isLink` and `OpenedLink`; Task 2's `shareButton`, the `undo`'s fallback.
- Produces `pane-host.ts`'s `PaneHost.rebuildViews(id: LeafId): void`, and `applyLayout`'s parameter `rebuild: 'none' | 'copies' | 'every'`; in `main.ts`, `storedProgram`, `startLink`, `storedWorkspace`, `droppedBindings`, `offer: { readonly undo: NoticeAction; notice: Notice } | null`, `withdrawOffer()`, `type Replaced`, `showWorkspace(next: Workspace)`, `undoOpen(before: Replaced)`, `announceOpen(opened: OpenedLink, before: Replaced)` and `openLink(fragment: string)`.

**A LINK TAKES PRECEDENCE OVER BOTH STORES** (spec §5.3): read after `init()` and before the program and the workspace are taken from storage. Whole, it gives the page its program, encoding and workspace, and the stored bindings are dropped and seeded nowhere, so no copy is warmed; alone, its program, under the encoding storage would have opened on where the link's is not this build's; unreadable, nothing. `loaded` stays the program the page opens on, and `restorable`, what a reload would open on, starts from `storedProgram`.

**PASTED INTO AN OPEN PAGE, IT IS A `hashchange`**, and whole it replaces the program and the workspace through `showWorkspace`, which builds every view again on the program (`PaneHost.rebuildViews`, the prototype's finding 8). The fragment is cleared with `window.history.replaceState` either way — `history` in `main.ts` is CodeMirror's.

**THE `undo` IS HELD APART FROM ITS NOTICE** (§5.5): `offer` keeps the action and the notice carrying it, so a later notice about the same open can carry it again (Task 4). It is withdrawn where a pick's is — the source editor's update listener at an edit that changes the program, the picker's `change` — and replaced by another open's. Used, it puts back the program, and where the link opened whole the workspace and each copy's view, warming a copy the open left cold; one the cap refuses stays paused, its views on the program.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=3
diff --git a/web/tests/browser/share-open-alone.test.ts b/web/tests/browser/share-open-alone.test.ts
new file mode 100644
index 0000000..acb595a
--- /dev/null
+++ b/web/tests/browser/share-open-alone.test.ts
@@ -0,0 +1,64 @@
+import type { EditorView } from '@codemirror/view'
+import { beforeAll, describe, expect, it } from 'vitest'
+import { userEvent } from 'vitest/browser'
+import { EXAMPLES } from '../../src/examples'
+import { LAYOUT_STORAGE_KEY } from '../../src/layout'
+import { PROGRAM_STORAGE_KEY, serializeProgram } from '../../src/program-store'
+import { encodeLink } from '../../src/share-link'
+import { defaultWorkspace, PRESETS, serializeWorkspace } from '../../src/workspace'
+import { SHELL, until } from './harness'
+
+/**
+ * **A LINK OPENED AT START-UP, THE PROGRAM ALONE** — Plan 7 part 6a spec §5.3 and §7. The link's encoding is not one
+ * this build has and its workspace is not one `parseWorkspace` takes, so its program opens alone, under the encoding
+ * storage would have opened on — `binary` here, not the default, so it is told apart from one — and the stored
+ * workspace stays. The notice names what was left out, and its `undo` puts back the program alone. ONE MOUNT FOR THE
+ * FILE, for the reason every sibling gives.
+ */
+
+const SUM_TO = EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? ''
+const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
+const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
+const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+const readout = () => [...document.querySelectorAll('#results .segment, #results .row')].length
+
+let view: EditorView
+
+beforeAll(async () => {
+  localStorage.setItem(PROGRAM_STORAGE_KEY, serializeProgram({ text: 'let x = 40; x + 2', encoding: 'binary' }))
+  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace({ ...defaultWorkspace(), switches: PRESETS.debugger }))
+  const fragment = await encodeLink({ program: SUM_TO, encoding: 'ternary', workspace: '{}', positions: {} })
+  history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
+  document.body.innerHTML = SHELL
+  view = await (await import('../../src/main')).ready
+  await until(() => idle() && readout() > 0, 'the first compile')
+})
+
+describe('a link at start-up whose encoding and workspace cannot be taken', () => {
+  it('opens its program alone, under the encoding storage opened on, and clears the fragment', () => {
+    expect(view.state.doc.toString()).toBe(SUM_TO)
+    expect(picker().value).toBe('binary')
+    expect(location.hash).toBe('')
+  })
+
+  it('keeps the stored workspace', () => {
+    expect(document.querySelector('#workspace')?.textContent).toBe('Debugger ▾')
+  })
+
+  it('names what was left out, with an undo', () => {
+    expect(noticeText()).toBe(
+      "opened a shared link's program — its encoding, workspace and step positions were left out",
+    )
+    expect(undoButton()?.textContent).toBe('undo')
+  })
+
+  it('puts back the program alone on undo', async () => {
+    await userEvent.click(undoButton() as HTMLButtonElement)
+    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
+    expect(picker().value).toBe('binary')
+    expect(document.querySelector('#workspace')?.textContent).toBe('Debugger ▾')
+    expect(noticeText()).toBe('put back the program')
+    expect(document.activeElement).toBe(view.contentDOM)
+  })
+})
diff --git a/web/tests/browser/share-open-cap.test.ts b/web/tests/browser/share-open-cap.test.ts
new file mode 100644
index 0000000..52dc362
--- /dev/null
+++ b/web/tests/browser/share-open-cap.test.ts
@@ -0,0 +1,83 @@
+import { beforeAll, describe, expect, it } from 'vitest'
+import { userEvent } from 'vitest/browser'
+import { BUFFERS_STORAGE_KEY, serializeBuffers } from '../../src/buffers-store'
+import { defaultLayout, LAYOUT_STORAGE_KEY, type LayoutNode, setLeafKind, splitLeaf } from '../../src/layout'
+import { MAX_WARM_BUFFERS } from '../../src/scratch'
+import { encodeLink } from '../../src/share-link'
+import { bindingKey } from '../../src/view-header'
+import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
+import { SHELL, until } from './harness'
+
+/**
+ * **AN OPEN'S UNDO, PAST THE COPIES CAP** — Plan 7 part 6a spec §5.5: "a copy the cap refuses stays paused, and its
+ * view stays on the program". A link opened whole at start-up warms no copy (§5.3), so its `undo` warms each copy it
+ * moves a view back onto. The stored workspace here has one more λ view than `MAX_WARM_BUFFERS`, each bound to a copy
+ * of its own: the `undo` warms as many as the cap lets it, and the last stays paused, its view on the program. ONE
+ * MOUNT FOR THE FILE, for the reason every sibling gives.
+ */
+
+/** A tree of `n` λ views beside the source view, split in halves so none goes under the pane floor. */
+function lambdaViews(n: number): { tree: LayoutNode; leaves: string[] } {
+  let tree = setLeafKind(setLeafKind(defaultLayout(), 'asm-0', 'lambda'), 'tm-0', 'lambda')
+  const leaves = ['lambda-0', 'asm-0', 'tm-0']
+  for (let i = 0; leaves.length < n; i++) {
+    const id = `pane-${i + 1}`
+    tree = splitLeaf(tree, leaves[i] as string, i % 2 === 0 ? 'row' : 'column', id, 'lambda')
+    leaves.push(id)
+  }
+  return { tree, leaves }
+}
+
+const { tree, leaves } = lambdaViews(MAX_WARM_BUFFERS + 1)
+const copies = leaves.map((_, i) => `scratch-${i + 1}`)
+const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
+const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+const shows = (leaf: string) =>
+  document.querySelector<HTMLElement>(`[data-leaf="${leaf}"] .view-title`)?.dataset.binding ?? ''
+
+beforeAll(async () => {
+  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace({ ...defaultWorkspace(), tree, focused: 'lambda-0' }))
+  localStorage.setItem(
+    BUFFERS_STORAGE_KEY,
+    serializeBuffers({
+      minted: copies.length,
+      buffers: copies.map((id, i) => ({
+        id,
+        label: `copy ${i + 1}`,
+        text: '(λa. a)',
+        collapsed: false,
+        leg: 'lambda' as const,
+      })),
+      bindings: Object.fromEntries(leaves.map((leaf, i) => [leaf, copies[i] as string])),
+    }),
+  )
+  const fragment = await encodeLink({
+    program: 'let x = 40; x + 2',
+    encoding: 'unary',
+    workspace: serializeWorkspace(defaultWorkspace()),
+    positions: {},
+  })
+  history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
+  document.body.innerHTML = SHELL
+  await (await import('../../src/main')).ready
+  await until(() => idle() && noticeText() === 'opened a shared link', 'the open')
+})
+
+describe("an open's undo past the copies cap", () => {
+  it('opens on the link’s workspace, with every copy still listed', () => {
+    expect(document.querySelectorAll('.pane[data-leaf]').length).toBe(4)
+    expect(document.querySelector('#buffers')?.textContent).toBe(`copies ${copies.length} ▾`)
+  })
+
+  it('moves back every view it can warm a copy for, and says which copy stays paused', async () => {
+    await userEvent.click(undoButton() as HTMLButtonElement)
+    const last = leaves.length - 1
+    expect(noticeText()).toBe(
+      `put back the program and the workspace — λ copy ${last + 1} paused, ${MAX_WARM_BUFFERS} copies are running`,
+    )
+    for (const [i, leaf] of leaves.entries()) {
+      expect(shows(leaf), leaf).toBe(bindingKey('lambda', i === last ? 'source' : (copies[i] as string)))
+    }
+  })
+})
diff --git a/web/tests/browser/share-open-hashchange.test.ts b/web/tests/browser/share-open-hashchange.test.ts
new file mode 100644
index 0000000..4b05d5e
--- /dev/null
+++ b/web/tests/browser/share-open-hashchange.test.ts
@@ -0,0 +1,206 @@
+import type { EditorView } from '@codemirror/view'
+import { beforeAll, describe, expect, it } from 'vitest'
+import { userEvent } from 'vitest/browser'
+import { EXAMPLES } from '../../src/examples'
+import { defaultLayout, splitLeaf } from '../../src/layout'
+import { encodeLink, type SharePayload } from '../../src/share-link'
+import { bindingKey } from '../../src/view-header'
+import { defaultWorkspace, PRESETS, serializeWorkspace } from '../../src/workspace'
+import { SHELL, until } from './harness'
+
+/**
+ * **A LINK PASTED INTO AN OPEN PAGE, AND ITS UNDO** — Plan 7 part 6a spec §5.3 and §5.5, heard as `hashchange`. The
+ * page opens on `let x = 40; x + 2` in Explorer, and a second λ view is put on a copy first, beside the λ view of the
+ * program. A whole link replaces the program and the workspace and builds every view again on the program — the λ
+ * view its tree shares too, so it is drawn as the link says; its `undo` puts back the program, the workspace and the
+ * copy's view, and goes at the next edit or encoding chosen. A link whose workspace cannot be read opens the program
+ * alone; one that cannot be read at all changes nothing; any other fragment is left alone. ONE MOUNT FOR THE FILE, for
+ * the reason every sibling gives.
+ */
+
+const SUM_TO = EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? ''
+const FACT = EXAMPLES.find((e) => e.id === 'fact')?.text ?? ''
+/**
+ * The Debugger preset, with each part of the workspace the opener's differs in: its λ view drawn as an outline where
+ * the opener's is code, so a view kept by the open would show; the inspector shut and the source outline open, the
+ * other way round from the opener's; and a second λ view, `pane-2`, the id the opener's next view would take.
+ */
+const LINK: SharePayload = {
+  program: SUM_TO,
+  encoding: 'binary',
+  workspace: serializeWorkspace({
+    ...defaultWorkspace(),
+    tree: splitLeaf(defaultLayout(), 'lambda-0', 'row', 'pane-2', 'lambda'),
+    switches: PRESETS.debugger,
+    display: { 'lambda-0': { layout: 'outline', vars: 'names', map: 'icicle' } },
+    inspector: false,
+    panels: { source: { outline: true } },
+  }),
+  positions: {},
+}
+
+const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
+const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
+const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+const readout = () => [...document.querySelectorAll('#results .segment, #results .row')].length
+const shows = (leaf: string) =>
+  document.querySelector<HTMLElement>(`[data-leaf="${leaf}"] .view-title`)?.dataset.binding ?? ''
+const lambdaLayout = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term')?.dataset.layout
+/** The views on the page, by leaf. */
+const leaves = () => [...document.querySelectorAll<HTMLElement>('.pane[data-leaf]')].map((p) => p.dataset.leaf ?? '')
+const workspaceName = () => document.querySelector('#workspace')?.textContent
+const panelOpen = (where: string) => document.querySelector<HTMLElement>(`${where} .panel`)?.dataset.open
+
+let view: EditorView
+/** The copy, as its binding reads, and the leaf of the view added to show it. */
+let copy = ''
+let copyLeaf = ''
+
+/** Paste `fragment` into the address bar, as far as the page can tell: a `hashchange`. */
+async function paste(fragment: string, until_: () => boolean, what: string): Promise<void> {
+  location.hash = fragment
+  await until(until_, what)
+}
+
+beforeAll(async () => {
+  document.body.innerHTML = SHELL
+  view = await (await import('../../src/main')).ready
+  await until(() => idle() && readout() === 3, 'the first compile')
+  // A COPY, THEN A VIEW OF IT, THEN THE λ VIEW BACK ON THE PROGRAM: the copy's view is one the link's tree lacks.
+  document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
+  await until(() => shows('lambda-0') !== bindingKey('lambda', 'source'), 'the copy')
+  copy = shows('lambda-0')
+  const before = new Set(leaves())
+  await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
+  await userEvent.click(
+    document.querySelector<HTMLButtonElement>(`#new-view-menu button[data-binding="${copy}"]`) as HTMLButtonElement,
+  )
+  await until(() => leaves().some((l) => !before.has(l)), 'the view of the copy')
+  copyLeaf = leaves().find((l) => !before.has(l)) ?? ''
+  await userEvent.click(
+    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-title') as HTMLButtonElement,
+  )
+  await userEvent.click(
+    document.querySelector<HTMLButtonElement>(
+      `[data-leaf="lambda-0"] [popover] button[data-binding="${bindingKey('lambda', 'source')}"]`,
+    ) as HTMLButtonElement,
+  )
+  await until(() => shows('lambda-0') === bindingKey('lambda', 'source'), 'the λ view back on the program')
+})
+
+describe('a whole link pasted into an open page', () => {
+  it('replaces the program and its encoding, and clears the fragment', async () => {
+    expect(shows(copyLeaf)).toBe(copy)
+    expect(lambdaLayout()).toBe('code')
+    await paste(await encodeLink(LINK), () => noticeText() === 'opened a shared link', 'the open')
+    expect(view.state.doc.toString()).toBe(SUM_TO)
+    expect(picker().value).toBe('binary')
+    expect(location.hash).toBe('')
+    expect(undoButton()?.textContent).toBe('undo')
+  })
+
+  it("replaces the workspace, building every view again on the program in the link's display", () => {
+    expect(workspaceName()).toBe('Debugger ▾')
+    expect(document.querySelector<HTMLElement>('#step-bar')?.hidden).toBe(false)
+    expect(leaves()).toEqual(['source', 'lambda-0', 'pane-2', 'asm-0', 'tm-0'])
+    expect(shows('lambda-0')).toBe(bindingKey('lambda', 'source'))
+    // THE λ VIEW'S LEAF AND KIND SURVIVE THE OPEN, AND IT WAS ON THE PROGRAM: only a rebuild shows the link's display.
+    expect(lambdaLayout()).toBe('outline')
+    expect(panelOpen('#inspector')).toBe('false')
+    expect(panelOpen('[data-leaf="source"]')).toBe('true')
+    expect(document.querySelector('#buffers')?.textContent).toBe('copies 1 ▾')
+  })
+
+  it('puts back the program, the workspace and the copy’s view on undo', async () => {
+    await until(() => idle() && readout() > 0, 'the link’s compile')
+    await userEvent.click(undoButton() as HTMLButtonElement)
+    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
+    expect(picker().value).toBe('unary')
+    expect(workspaceName()).toBe('Explorer ▾')
+    expect(shows(copyLeaf)).toBe(copy)
+    expect(shows('lambda-0')).toBe(bindingKey('lambda', 'source'))
+    expect(lambdaLayout()).toBe('code')
+    expect(panelOpen('#inspector')).toBe('true')
+    expect(panelOpen('[data-leaf="source"]')).toBe('false')
+    expect(noticeText()).toBe('put back the program and the workspace')
+    expect(document.activeElement).toBe(view.contentDOM)
+    await until(() => idle() && readout() === 3, 'the program’s compile')
+  })
+
+  it('withdraws the undo at the next edit that changes the program', async () => {
+    await paste(await encodeLink(LINK), () => undoButton() !== null, 'the open')
+    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n' } })
+    expect(undoButton()).toBeNull()
+  })
+
+  it('withdraws the undo at the next encoding chosen', async () => {
+    await paste(await encodeLink({ ...LINK, program: FACT }), () => undoButton() !== null, 'the open')
+    await userEvent.selectOptions(picker(), 'unary')
+    expect(undoButton()).toBeNull()
+    await until(() => idle() && readout() > 0, 'the compile under unary')
+  })
+
+  // THE LINK'S TREE HOLDS `pane-2`, THE ID THE OPENER'S NEXT VIEW WOULD HAVE TAKEN: the next is minted past it.
+  it("adds a view beside a link's views without taking an id its tree holds", async () => {
+    await paste(await encodeLink(LINK), () => leaves().includes('pane-2'), 'the open')
+    const before = new Set(leaves())
+    await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
+    await userEvent.click(
+      document.querySelector<HTMLButtonElement>(
+        `#new-view-menu button[data-binding="${bindingKey('lambda', 'source')}"]`,
+      ) as HTMLButtonElement,
+    )
+    await until(() => leaves().some((l) => !before.has(l)), 'the view')
+    expect(leaves().filter((l) => l === 'pane-2')).toHaveLength(1)
+  })
+
+  /**
+   * **ANOTHER OPEN TAKES THE UNDO'S PLACE**: its `undo` puts back what that open replaced, which is the earlier link's
+   * program, and not what the earlier one did.
+   */
+  it('offers the later open’s undo when a second link opens', async () => {
+    await paste(await encodeLink(LINK), () => view.state.doc.toString() === SUM_TO, 'the first open')
+    await paste(await encodeLink({ ...LINK, program: FACT }), () => view.state.doc.toString() === FACT, 'the second')
+    await userEvent.click(undoButton() as HTMLButtonElement)
+    expect(view.state.doc.toString()).toBe(SUM_TO)
+    expect(undoButton()).toBeNull()
+  })
+})
+
+describe('any other link pasted into an open page', () => {
+  it('opens the program alone when the workspace cannot be read, and undo puts back the program alone', async () => {
+    await until(() => idle() && readout() > 0, 'the compile')
+    const before = view.state.doc.toString()
+    const workspace = workspaceName()
+    await paste(
+      await encodeLink({ ...LINK, program: FACT, workspace: 'not a workspace' }),
+      () => noticeText().startsWith("opened a shared link's program"),
+      'the open',
+    )
+    expect(noticeText()).toBe("opened a shared link's program — its workspace and step positions were left out")
+    expect(view.state.doc.toString()).toBe(FACT)
+    expect(picker().value).toBe('binary')
+    expect(workspaceName()).toBe(workspace)
+    await userEvent.click(undoButton() as HTMLButtonElement)
+    expect(view.state.doc.toString()).toBe(before)
+    expect(noticeText()).toBe('put back the program')
+  })
+
+  it('changes nothing for a link that cannot be read, and says so', async () => {
+    const before = view.state.doc.toString()
+    await paste('#s=not*a*link', () => noticeText() === 'this link could not be read — nothing was changed', 'it')
+    expect(view.state.doc.toString()).toBe(before)
+    expect(undoButton()).toBeNull()
+    expect(location.hash).toBe('')
+  })
+
+  it('leaves a fragment that is not a link alone', async () => {
+    const said = noticeText()
+    location.hash = '#section'
+    await new Promise<void>((resolve) => addEventListener('hashchange', () => resolve(), { once: true }))
+    expect(location.hash).toBe('#section')
+    expect(noticeText()).toBe(said)
+    history.replaceState(null, '', `${location.pathname}${location.search}`)
+  })
+})
diff --git a/web/tests/browser/share-open-unreadable.test.ts b/web/tests/browser/share-open-unreadable.test.ts
new file mode 100644
index 0000000..81ae542
--- /dev/null
+++ b/web/tests/browser/share-open-unreadable.test.ts
@@ -0,0 +1,38 @@
+import type { EditorView } from '@codemirror/view'
+import { beforeAll, describe, expect, it } from 'vitest'
+import { SHELL, until } from './harness'
+
+/**
+ * **A LINK AT START-UP THAT CANNOT BE READ** — Plan 7 part 6a spec §5.3 and §7: `#s=` and characters base64url does not
+ * have. Nothing changes, the notice says so and offers nothing, and the fragment is cleared anyway, so a reload does not
+ * say it again. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
+ */
+
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
+
+let view: EditorView
+
+beforeAll(async () => {
+  history.replaceState(null, '', `${location.pathname}${location.search}#s=not*a*link`)
+  document.body.innerHTML = SHELL
+  view = await (await import('../../src/main')).ready
+  await until(() => idle() && segments().length === 3, 'the first compile')
+})
+
+describe('a link at start-up that cannot be read', () => {
+  it('changes nothing: the stored program, under its encoding, in the stored workspace', () => {
+    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
+    expect(document.querySelector<HTMLSelectElement>('#encoding')?.value).toBe('unary')
+    expect(document.querySelector('#workspace')?.textContent).toBe('Explorer ▾')
+    expect(segments()[0]).toMatch(/^λ 42/)
+  })
+
+  it('says so, offering nothing, and clears the fragment', () => {
+    expect(document.querySelector('#notice .notice-text')?.textContent).toBe(
+      'this link could not be read — nothing was changed',
+    )
+    expect(document.querySelector('#notice button.notice-action')).toBeNull()
+    expect(location.hash).toBe('')
+  })
+})
diff --git a/web/tests/browser/share-open.test.ts b/web/tests/browser/share-open.test.ts
new file mode 100644
index 0000000..7f10244
--- /dev/null
+++ b/web/tests/browser/share-open.test.ts
@@ -0,0 +1,114 @@
+import type { EditorView } from '@codemirror/view'
+import { beforeAll, describe, expect, it } from 'vitest'
+import { userEvent } from 'vitest/browser'
+import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/buffers-store'
+import { EXAMPLES } from '../../src/examples'
+import { LAYOUT_STORAGE_KEY } from '../../src/layout'
+import { encodeLink } from '../../src/share-link'
+import { bindingKey } from '../../src/view-header'
+import { defaultWorkspace, PRESETS, parseWorkspace, serializeWorkspace } from '../../src/workspace'
+import { SHELL, until } from './harness'
+
+/**
+ * **A LINK OPENED AT START-UP, WHOLE, AND ITS UNDO** — Plan 7 part 6a spec §5.3 and §5.5. The page is a returning
+ * visitor's: `let x = 40; x + 2` under `unary` (`setup.ts`), Explorer, and a λ copy bound to the λ view. The link
+ * carries `sum_to(5)` under `binary` and the Debugger preset's workspace, whose λ view is drawn as an outline. A link
+ * takes precedence over both stores: the page opens on it, drops the copy's binding without warming the copy, keeps the
+ * copy listed, and clears the fragment; its `undo` puts back the stored program, workspace and the copy's view.
+ * ONE MOUNT FOR THE FILE, for the reason every sibling gives.
+ */
+
+const SUM_TO = EXAMPLES.find((e) => e.id === 'sum-to')?.text ?? ''
+const COPY = 'scratch-1'
+const LINK_WORKSPACE = {
+  ...defaultWorkspace(),
+  switches: PRESETS.debugger,
+  display: { 'lambda-0': { layout: 'outline', vars: 'names', map: 'icicle' } },
+} as const
+
+const picker = () => document.querySelector<HTMLSelectElement>('#encoding') as HTMLSelectElement
+const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
+const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
+/** The readout's lines in either mode: the strip's segments, or the inspector's rows, each its label and value. */
+const readout = () =>
+  [...document.querySelectorAll('#results .segment, #results .row')].map((el) =>
+    el.matches('.row')
+      ? `${el.querySelector('.row-label')?.textContent ?? ''} = ${el.querySelector('.row-value')?.textContent ?? ''}`
+      : (el.textContent ?? ''),
+  )
+const lambdaShows = () =>
+  document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .view-title')?.dataset.binding ?? ''
+const lambdaLayout = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term')?.dataset.layout
+const storedBindings = () => parseBuffers(localStorage.getItem(BUFFERS_STORAGE_KEY))?.bindings
+
+let view: EditorView
+
+beforeAll(async () => {
+  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(defaultWorkspace()))
+  localStorage.setItem(
+    BUFFERS_STORAGE_KEY,
+    serializeBuffers({
+      minted: 1,
+      buffers: [{ id: COPY, label: 'copy 1', text: '(λa. a) (λb. b)', collapsed: false, leg: 'lambda' }],
+      bindings: { 'lambda-0': COPY },
+    }),
+  )
+  const fragment = await encodeLink({
+    program: SUM_TO,
+    encoding: 'binary',
+    workspace: serializeWorkspace(LINK_WORKSPACE),
+    positions: {},
+  })
+  history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
+  document.body.innerHTML = SHELL
+  view = await (await import('../../src/main')).ready
+  await until(() => idle() && readout().length > 0, 'the first compile')
+})
+
+describe('a link at start-up', () => {
+  it('clears the fragment', () => {
+    expect(location.hash).toBe('')
+  })
+
+  it("opens the link's program under its encoding", async () => {
+    expect(view.state.doc.toString()).toBe(SUM_TO)
+    expect(picker().value).toBe('binary')
+    expect(readout()).toContain('λ value = 15')
+    expect(readout()).toContain('TM value = 15')
+  })
+
+  it("opens the link's workspace, with every view on the program", () => {
+    expect(document.querySelector('#workspace')?.textContent).toBe('Debugger ▾')
+    expect(document.querySelector<HTMLElement>('#step-bar')?.hidden).toBe(false)
+    expect(lambdaShows()).toBe(bindingKey('lambda', 'source'))
+    expect(lambdaLayout()).toBe('outline')
+    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.switches).toEqual(PRESETS.debugger)
+  })
+
+  it('keeps the copy listed, paused, and drops its binding from storage', () => {
+    expect(document.querySelector('#buffers')?.textContent).toBe('copies 1 ▾')
+    expect(storedBindings()).toEqual({})
+  })
+
+  it('says so, with an undo', () => {
+    expect(noticeText()).toBe('opened a shared link')
+    expect(undoButton()?.textContent).toBe('undo')
+  })
+
+  it('puts back the stored program, its encoding, the workspace and the copy’s view on undo', async () => {
+    await userEvent.click(undoButton() as HTMLButtonElement)
+    expect(view.state.doc.toString()).toBe('let x = 40; x + 2')
+    expect(picker().value).toBe('unary')
+    expect(document.querySelector('#workspace')?.textContent).toBe('Explorer ▾')
+    expect(document.querySelector<HTMLElement>('#step-bar')?.hidden).toBe(true)
+    expect(lambdaShows()).toBe(bindingKey('lambda', COPY))
+    expect(noticeText()).toBe('put back the program and the workspace')
+    expect(document.activeElement).toBe(view.contentDOM)
+    expect(storedBindings()).toEqual({ 'lambda-0': COPY })
+    // THE COPY WAS COLD, AND UNDO WARMED IT: its view draws its term.
+    await until(() => lambdaLayout() === 'code', 'the copy’s term')
+    await until(() => idle() && (segments()[0] ?? '').startsWith('λ 42'), 'the program’s compile')
+  })
+})
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open.test.ts tests/browser/share-open-alone.test.ts tests/browser/share-open-unreadable.test.ts tests/browser/share-open-hashchange.test.ts tests/browser/share-open-cap.test.ts`

Expected: exit 1, printing:

```text
Test Files  5 failed (5)
Tests  19 failed | 3 passed | 2 skipped (24)
```

Failing as a whole file: `tests/browser/share-open-cap.test.ts`, with `Error: timed out after 10000ms waiting for the open`.

Failing: `tests/browser/share-open-alone.test.ts > a link at start-up whose encoding and workspace cannot be taken > names what was left out, with an undo`, `tests/browser/share-open-alone.test.ts > a link at start-up whose encoding and workspace cannot be taken > opens its program alone, under the encoding storage opened on, and clears the fragment`, `tests/browser/share-open-alone.test.ts > a link at start-up whose encoding and workspace cannot be taken > puts back the program alone on undo`, `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > adds a view beside a link's views without taking an id its tree holds`, `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > offers the later open’s undo when a second link opens`, `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > puts back the program, the workspace and the copy’s view on undo`, `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > replaces the program and its encoding, and clears the fragment`, `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > replaces the workspace, building every view again on the program in the link's display`, `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > withdraws the undo at the next edit that changes the program`, `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > withdraws the undo at the next encoding chosen`, `tests/browser/share-open-hashchange.test.ts > any other link pasted into an open page > changes nothing for a link that cannot be read, and says so`, `tests/browser/share-open-hashchange.test.ts > any other link pasted into an open page > opens the program alone when the workspace cannot be read, and undo puts back the program alone`, `tests/browser/share-open-unreadable.test.ts > a link at start-up that cannot be read > says so, offering nothing, and clears the fragment`, `tests/browser/share-open.test.ts > a link at start-up > clears the fragment`, `tests/browser/share-open.test.ts > a link at start-up > keeps the copy listed, paused, and drops its binding from storage`, `tests/browser/share-open.test.ts > a link at start-up > opens the link's program under its encoding`, `tests/browser/share-open.test.ts > a link at start-up > opens the link's workspace, with every view on the program`, `tests/browser/share-open.test.ts > a link at start-up > puts back the stored program, its encoding, the workspace and the copy’s view on undo`, `tests/browser/share-open.test.ts > a link at start-up > says so, with an undo`.

- [ ] **Step 3: Write the code.**

````diff apply=source task=3
diff --git a/web/src/main.ts b/web/src/main.ts
index 1f608f4..e0ddb4e 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -48,7 +48,7 @@ import { navKeymap } from './lsp-nav'
 import type { LanguageId } from './lsp-protocol'
 import { documentUri, LANGUAGE_LABEL } from './lsp-protocol'
 import { applyEdits, revealRange } from './lsp-text'
-import { createNotices, type Notice } from './notice'
+import { createNotices, type Notice, type NoticeAction } from './notice'
 import { createOutlinePanel } from './outline'
 import { paletteDeclarations } from './palettes'
 import type { PaneChoice } from './pane-chrome'
@@ -63,7 +63,7 @@ import { createReplies } from './replies'
 import { BufferCapReached, type BufferRecord, MAX_WARM_BUFFERS, ScratchBuffers } from './scratch'
 import { type SessionId, SessionPool } from './session-client'
 import { legControlState, type SessionLegs, SessionRegistry } from './sessions'
-import type { SharePayload } from './share-link'
+import { decodeLink, isLink, type OpenedLink, type SharePayload } from './share-link'
 import { createShare } from './share-popover'
 import {
   applySkin,
@@ -617,19 +617,32 @@ async function main(): Promise<EditorView> {
     }
   }
   /**
-   * THE PROGRAM THE PAGE OPENS ON — Plan 7 part 6a spec §4.4: the stored one if `parseProgram` takes it, otherwise the
+   * THE PROGRAM STORAGE OPENS ON — Plan 7 part 6a spec §4.4: the stored one if `parseProgram` takes it, otherwise the
    * first-load example under the default encoding. A refusal is silent, since it cannot be told from a first visit
    * (`program-store.ts`'s own doc).
+   */
+  const storedProgram = parseProgram(readProgramStorage(), encodings() as string[]) ?? {
+    text: FIRST_LOAD.text,
+    encoding: EXAMPLE_ENCODING,
+  }
+  /**
+   * A LINK IN THE PAGE'S FRAGMENT — Plan 7 part 6a spec §5.3, read before either store is taken from, since a link
+   * takes precedence over both: what it opens, or `null` on a page with no link.
+   */
+  const startLink = isLink(location.hash) ? await decodeLink(location.hash, encodings() as string[]) : null
+  /**
+   * THE PROGRAM THE PAGE OPENS ON: a link's, whole or alone, under its own encoding or, where the link's is not one this
+   * build has, the one storage opens on (spec §5.3); otherwise `storedProgram`.
    *
    * **CHOSEN HERE, AFTER `init()`, BECAUSE AN ENCODING IS VALID ONLY IF `encodings()` LISTS IT**, and before anything
    * reads it: the editor's document, the language server's first text and the start-up compile are its three uses.
    * The picker is set from it now, since a compile reads `picker.value` when it posts, and the encoding is kept across
    * reloads for the first time.
    */
-  const loaded = parseProgram(readProgramStorage(), encodings() as string[]) ?? {
-    text: FIRST_LOAD.text,
-    encoding: EXAMPLE_ENCODING,
-  }
+  const loaded: StoredProgram =
+    startLink === null || startLink.kind === 'unreadable'
+      ? storedProgram
+      : { text: startLink.program, encoding: startLink.encoding ?? storedProgram.encoding }
   picker.value = loaded.encoding
 
   let view: EditorView
@@ -1148,10 +1161,11 @@ async function main(): Promise<EditorView> {
   }
 
   /**
-   * What a reload would open on: the last program a write stored, or the one the page loaded while none has been — the
-   * stored one, or the first-load example where nothing was stored or `parseProgram` refused what was.
+   * What a reload would open on: the last program a write stored, or the one storage opened on while none has been —
+   * the stored one, or the first-load example where nothing was stored or `parseProgram` refused what was. A link's
+   * program is not it until a write stores it: its fragment is cleared once it opens (spec §5.3).
    */
-  let restorable: StoredProgram = loaded
+  let restorable: StoredProgram = storedProgram
 
   /**
    * Store the program — `compile.ts` calls this as each compile posts, with the text and the encoding it posted (Plan 7
@@ -1177,16 +1191,19 @@ async function main(): Promise<EditorView> {
     }
   }
 
+  /** The workspace storage opens on: the stored one if there is a usable value there, the default otherwise. */
+  const storedWorkspace = parseWorkspace(readLayoutStorage()) ?? defaultWorkspace()
   /**
-   * THE WORKSPACE — restored from `localStorage` if there is a usable value there (a version 1 layout is
-   * migrated: `workspace.ts`'s `parseWorkspace`), the default otherwise.
+   * THE WORKSPACE — a link's where one opens whole (Plan 7 part 6a spec §5.3), otherwise restored from `localStorage`
+   * if there is a usable value there (a version 1 layout is migrated: `workspace.ts`'s `parseWorkspace`), the default
+   * otherwise.
    *
    * **`tree` STAYS ITS OWN `let`, AND `ws` HOLDS THE REST.** `pane-host.ts` reads and writes the tree through
    * `getTree`/`setTree` on every gesture, and its doc argues why the tree has one owner; folding it into `ws`
    * would move that owner without changing anything a reader could see. `persistWorkspace` joins the two at
    * the one moment they are written.
    */
-  const restored = parseWorkspace(readLayoutStorage()) ?? defaultWorkspace()
+  const restored = startLink?.kind === 'whole' ? startLink.workspace : storedWorkspace
   let tree: LayoutNode = restored.tree
   let ws: Omit<Workspace, 'tree'> = {
     switches: restored.switches,
@@ -1372,10 +1389,15 @@ async function main(): Promise<EditorView> {
    * not here beside `seedBinding`, though both read this same list).
    */
   const restoredBindings: [LeafId, SessionId][] = []
+  /**
+   * The restored bindings a link opened whole at start-up dropped (Plan 7 part 6a spec §5.3, row 14): read against the
+   * stored tree they were written with, and seeded nowhere, so no copy is warmed. The open's *undo* moves them back.
+   */
+  const droppedBindings: [LeafId, SessionId][] = []
   if (restoredBuffers !== null) {
     scratchpad.restore(restoredBuffers)
     const legOfLeaf = new Map(
-      leaves(tree).flatMap((l) => {
+      leaves(storedWorkspace.tree).flatMap((l) => {
         const leg = legOfPane(l.pane)
         return leg === null ? [] : [[l.id, leg] as const]
       }),
@@ -1383,6 +1405,10 @@ async function main(): Promise<EditorView> {
     const legOfBuffer = new Map(restoredBuffers.buffers.map((b) => [b.id, b.leg] as const))
     for (const [leaf, session] of Object.entries(restoredBuffers.bindings)) {
       if (legOfLeaf.get(leaf) !== legOfBuffer.get(session)) continue
+      if (startLink?.kind === 'whole') {
+        droppedBindings.push([leaf, session])
+        continue
+      }
       restoredBindings.push([leaf, session])
       paneHost.seedBinding(leaf, session)
     }
@@ -1632,9 +1658,26 @@ async function main(): Promise<EditorView> {
    * the program, and the picker at every encoding chosen in it, which does nothing once it is off the line.
    */
   let pick: Notice | null = null
-  // A CHOICE OF ENCODING IS HALF OF WHAT THE UNDO PUTS BACK, so it goes at one too. A pick and its undo set the picker
-  // by assignment, which fires no `change`, so neither ends its own notice.
-  picker.addEventListener('change', () => pick?.dismiss())
+
+  /**
+   * THE LAST LINK'S OPEN, WHILE ITS `undo` IS OFFERED — Plan 7 part 6a spec §5.5: the action, and the notice carrying it
+   * now. **HELD APART FROM THE NOTICE, WHICH GOES IN `NOTICE_MS`**, because a later notice about the same open — a
+   * clamp, the tenth continue — offers the same `undo` again, however long after the open it comes. It is withdrawn as
+   * a pick's is, at the next edit that changes the program and at the next encoding chosen, since it puts back the
+   * whole document; and it ends when it is used, or when another link opens.
+   */
+  let offer: { readonly undo: NoticeAction; notice: Notice } | null = null
+  const withdrawOffer = (): void => {
+    offer?.notice.dismiss()
+    offer = null
+  }
+
+  // A CHOICE OF ENCODING IS HALF OF WHAT THE UNDO PUTS BACK, so it goes at one too — a pick's and a link's. A pick, a
+  // link and their undos set the picker by assignment, which fires no `change`, so none ends its own notice.
+  picker.addEventListener('change', () => {
+    pick?.dismiss()
+    withdrawOffer()
+  })
 
   /**
    * PICK AN EXAMPLE — Plan 7 part 6a spec §4.5. It replaces the program at once, under the default encoding, since the
@@ -1722,6 +1765,119 @@ async function main(): Promise<EditorView> {
     }),
   )
 
+  /**
+   * What an open replaced, for its *undo* to put back (spec §5.5): the program; and where the link opened whole, the
+   * workspace and each view that showed a copy, by leaf and copy.
+   */
+  type Replaced = {
+    readonly program: StoredProgram
+    readonly workspace: Workspace | null
+    readonly copies: readonly (readonly [LeafId, SessionId])[]
+  }
+
+  /**
+   * Put `next` in force as the workspace: the tree and the rest of it, its switches applied, the inspector and the
+   * source outline open or shut as it says, and every view built again from it on the program (`PaneHost.rebuildViews`,
+   * whose doc has why every view and not only those showing a copy). The copies stay in the copies menu (row 14).
+   */
+  const showWorkspace = (next: Workspace): void => {
+    const { tree: nextTree, ...rest } = next
+    tree = nextTree
+    ws = rest
+    seedLeafCounter(tree)
+    applySwitches()
+    inspectorPanel.setOpen(ws.inspector)
+    sourceOutline.panel.setOpen(ws.panels[SOURCE_LEAF]?.outline ?? false)
+    paneHost.rebuildViews(focusedLeaf())
+    refreshBuffers()
+  }
+
+  /**
+   * Undo an open — spec §5.5: the program's text and encoding, and where it opened whole the tree, the workspace and
+   * each view that showed a copy, moved back onto it as a delete's undo moves them (`PaneHost.moveBack`). A copy the
+   * open left cold, at start-up, is warmed first; one the cap refuses stays paused, and its views on the program.
+   *
+   * **USED, IT IS WITHDRAWN BY THE EDIT IT MAKES**, as any edit that changes the program withdraws it; one that changes
+   * nothing leaves nothing a later notice could offer it again for.
+   *
+   * **UNDO REMOVES THE CONTROL IT WAS ACTIVATED FROM, SO IT OWES THE FOCUS SOMEWHERE**, as a pick's does: the source
+   * editor, where the program came back, or `share` where no view shows the source. And it says so, once the focus
+   * has moved.
+   */
+  const undoOpen = (before: Replaced): void => {
+    replaceProgram(before.program)
+    const paused: string[] = []
+    if (before.workspace !== null) {
+      showWorkspace(before.workspace)
+      for (const session of new Set(before.copies.map(([, s]) => s))) {
+        const name = scratchpad.nameOf(session)
+        // A COPY DELETED SINCE THE OPEN HAS NOTHING TO COME BACK TO.
+        if (name === null) continue
+        try {
+          scratchpad.warm(session)
+        } catch (e) {
+          if (!(e instanceof BufferCapReached)) throw e
+          paused.push(name)
+          continue
+        }
+        const leaves = before.copies.filter(([, s]) => s === session).map(([leaf]) => leaf)
+        paneHost.moveBack(leaves, SOURCE_SESSION, session)
+      }
+      refreshBuffers()
+      draw()
+    }
+    view.focus()
+    if (!view.hasFocus) shareButton.focus()
+    const put = before.workspace === null ? 'put back the program' : 'put back the program and the workspace'
+    notices.notify(
+      paused.length === 0 ? put : `${put} — ${paused.join(', ')} paused, ${MAX_WARM_BUFFERS} copies are running`,
+    )
+  }
+
+  /**
+   * Say what an open did, and clear the fragment — spec §5.3, §7. **THE FRAGMENT IS CLEARED WHATEVER THE LINK HELD**
+   * (row 5), with `history.replaceState`, which fires no `hashchange`: a reload then keeps the edits made since rather
+   * than opening the link again, and a link that could not be read is not read again. A link that opened offers its
+   * `undo` in place of any earlier open's.
+   */
+  const announceOpen = (opened: OpenedLink, before: Replaced): void => {
+    // `window.history`, SINCE `history` HERE IS CODEMIRROR'S: the editor's undo history, imported above.
+    window.history.replaceState(window.history.state, '', `${location.pathname}${location.search}`)
+    if (opened.kind === 'unreadable') {
+      notices.notify('this link could not be read — nothing was changed')
+      return
+    }
+    // ANY EARLIER OPEN'S OFFER GOES WITH IT: this notice replaces its notice, and this offer takes its place.
+    const undo: NoticeAction = { label: 'undo', fallback: () => shareButton, run: () => undoOpen(before) }
+    const text =
+      opened.kind === 'whole'
+        ? 'opened a shared link'
+        : `opened a shared link's program — its ${opened.encoding === null ? 'encoding, ' : ''}workspace and step positions were left out`
+    offer = { undo, notice: notices.notify(text, { action: undo }) }
+  }
+
+  /**
+   * OPEN A LINK ON AN OPEN PAGE — spec §5.3: one pasted into the address bar, heard as `hashchange`. Whole, it replaces
+   * the program and the workspace and builds every view again on the program; alone, the program, under the link's
+   * encoding where this build has it and the picker's otherwise; unreadable, nothing.
+   */
+  const openLink = async (fragment: string): Promise<void> => {
+    const opened = await decodeLink(fragment, encodings() as string[])
+    const program: StoredProgram = { text: view.state.doc.toString(), encoding: picker.value }
+    if (opened.kind === 'whole') {
+      const copies = panes
+        .all()
+        .flatMap((p) => (p.slot.binding.session === SOURCE_SESSION ? [] : [[p.id, p.slot.binding.session] as const]))
+      const before: Replaced = { program, workspace: { tree, ...ws }, copies }
+      replaceProgram({ text: opened.program, encoding: opened.encoding })
+      showWorkspace(opened.workspace)
+      announceOpen(opened, before)
+    } else {
+      if (opened.kind === 'program') replaceProgram({ text: opened.program, encoding: opened.encoding ?? picker.value })
+      announceOpen(opened, { program, workspace: null, copies: [] })
+    }
+  }
+
   /**
    * Undo a delete — spec §10. The copy comes back under its own id and name, COLD, and is warmed; a
    * refusal at the cap leaves it paused, which is still a copy restored. The views the delete moved to
@@ -2288,11 +2444,15 @@ async function main(): Promise<EditorView> {
         EditorView.contentAttributes.of({ 'aria-label': 'source program editor' }),
         EditorView.updateListener.of((u) => {
           if (!u.docChanged) return
-          // A PICK'S UNDO WOULD THROW THIS EDIT AWAY, so it goes now — `openExample`'s own doc. **UNLESS THE EDIT LEFT
+          // A PICK'S UNDO WOULD THROW THIS EDIT AWAY, so it goes now — `openExample`'s own doc, and `offer`'s. **UNLESS THE EDIT LEFT
           // THE DOCUMENT AS IT WAS**: the language server answers a format of text already formatted with one edit
           // replacing the whole document by the same text, so with *format on blur* on, leaving the editor for the
           // undo would otherwise end it on the way there, and nothing that edit did could be lost.
-          if (!u.startState.doc.eq(u.state.doc)) pick?.dismiss()
+          if (!u.startState.doc.eq(u.state.doc)) {
+            pick?.dismiss()
+            // A LINK'S UNDO PUTS BACK THE WHOLE DOCUMENT TOO (spec §5.5), so it goes on the same terms.
+            withdrawOffer()
+          }
           const src = u.state.doc.toString()
           // NO HIGHLIGHTING DISPATCH HERE ANY MORE. `classifySource` used to be called synchronously on
           // this line, in the same frame as the keystroke; the colourer above is a `ViewPlugin` that
@@ -2559,6 +2719,20 @@ async function main(): Promise<EditorView> {
    * "no repair pass" holds because the repair is one ordinary write of the ordinary payload.
    */
   persistBuffers()
+
+  // THE START-UP LINK'S NOTICE, NOW THAT EVERYTHING IT CAN UNDO EXISTS (spec §5.3): what it replaced is what storage
+  // would have opened on — the program, and where it opened whole the workspace and the bindings it dropped.
+  if (startLink !== null) {
+    announceOpen(startLink, {
+      program: storedProgram,
+      workspace: startLink.kind === 'whole' ? storedWorkspace : null,
+      copies: droppedBindings,
+    })
+  }
+  // A LINK PASTED INTO AN OPEN PAGE (spec §5.3). Any other fragment is left alone.
+  addEventListener('hashchange', () => {
+    if (isLink(location.hash)) void openLink(location.hash)
+  })
   return view
 }
 
diff --git a/web/src/pane-host.ts b/web/src/pane-host.ts
index a8dc92c..f57967a 100644
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -97,6 +97,11 @@ export type PaneHost = {
    * it restores the default views. See the implementation.
    */
   resetViews(id: LeafId): void
+  /**
+   * `focusView`, with every view the tree keeps built again, on the program, from the workspace in force — an opened
+   * link's, or the one its *undo* puts back (Plan 7 part 6a spec §5.3, §5.5). See the implementation.
+   */
+  rebuildViews(id: LeafId): void
   /** Pre-seed the source pane's host, which `main.ts` owns the contents of. */
   seedHost(id: LeafId, host: HTMLElement): void
   /** Record the session a leaf should start on — see the implementation for who asks and when. */
@@ -1000,7 +1005,22 @@ export function createPaneHost(deps: {
    */
   const resetViews = (id: LeafId): void => {
     setFocused(id)
-    applyLayout(true)
+    applyLayout('copies')
+    focusPane(id)
+  }
+
+  /**
+   * An opened link's rebuild, and its *undo*'s: `focusView`, with every view the tree keeps dropped and built again on
+   * the program (Plan 7 part 6a spec §5.3, §5.5).
+   *
+   * **`resetViews` DROPS ONLY A VIEW SHOWING A COPY, AND A NEW WORKSPACE NEEDS EVERY ONE DROPPED.** A view reads the
+   * workspace when it is built — its display, and which of its panels are open — and never again, so a view kept under
+   * an id and a kind the new tree shares went on showing the opener's display and panels under the link's workspace:
+   * a λ view left drawn as code where the link's is an outline.
+   */
+  const rebuildViews = (id: LeafId): void => {
+    setFocused(id)
+    applyLayout('every')
     focusPane(id)
   }
 
@@ -1014,8 +1034,8 @@ export function createPaneHost(deps: {
    * predicate compares what the tree says a leaf renders against what the entry in hand renders, so a
    * leaf that is still present but has changed kind is removed exactly like one that left. That is
    * decision 1's whole mechanism: `setLeafKind` (called from `paneEvents`' `rebind`) keeps the leaf's id,
-   * its place and its size, and these two passes then replace the pane inside it. `resetViews` adds a third,
-   * `toProgram`: an entry showing a copy is dropped too, and built again on the program.
+   * its place and its size, and these two passes then replace the pane inside it. `rebuild` adds a third: an entry
+   * showing a copy is dropped too, and built again on the program (`resetViews`), or every entry is (`rebuildViews`).
    *
    * **THE TWO REASONS DIFFER IN EXACTLY ONE WAY, AND IT READS AS A CONTRADICTION UNTIL THE ORDER IS
    * NOTICED.** A close KEEPS the host's DOM — that is `hostFor`'s detach-not-destroy rule, and it is why
@@ -1055,7 +1075,7 @@ export function createPaneHost(deps: {
    *
    * For what this doc used to claim and why it changed, see the history note under `applyLayout`.
    */
-  const applyLayout = (toProgram = false): void => {
+  const applyLayout = (rebuild: 'none' | 'copies' | 'every' = 'none'): void => {
     // WHAT EACH LIVE LEAF RENDERS, NOT MERELY WHICH LEAVES ARE LIVE — a `Map` where this was a `Set`,
     // because there are two reasons to drop an entry now and the second one is about the VALUE.
     // `sourceLayout.update(live.size > 1, ...)` below is unaffected: a map's size is still the leaf count.
@@ -1063,8 +1083,9 @@ export function createPaneHost(deps: {
     // THE COPIES WHOSE EDITOR PASS 1 DESTROYS — mounted again on a view still showing each, after pass 2.
     const unmounted: SessionId[] = []
     for (const p of panes.all()) {
-      // `toProgram` IS `resetViews`' THIRD REASON: an entry kept by the two below is dropped when it shows a copy.
-      const onCopy = toProgram && p.slot.binding.session !== SOURCE_SESSION
+      // `rebuild` IS THE THIRD REASON: an entry kept by the two below is dropped when it shows a copy (`resetViews`), or
+      // whatever it shows (`rebuildViews`).
+      const dropped = rebuild === 'every' || (rebuild === 'copies' && p.slot.binding.session !== SOURCE_SESSION)
       // **TWO REASONS TO DROP AN ENTRY, AND THEY ARE ONE SITUATION FROM HERE.** The leaf left the tree
       // (a close), or the leaf is still there and no longer renders what this entry renders (a leg
       // change through the binding selector — `paneEvents`' `rebind` above). `PaneSlot<K>`'s leg has no
@@ -1072,7 +1093,7 @@ export function createPaneHost(deps: {
       // whole entry — slot, pane class and view — under an unchanged `LeafId`; the pane in hand is
       // about to stop existing either way, which is why the custody handover below covers both without
       // a branch. `live.get` answers `undefined` for a departed leaf, and no `PaneKind` equals that.
-      if (live.get(p.id) === p.kind && !onCopy) continue
+      if (live.get(p.id) === p.kind && !dropped) continue
       // THE CUSTODY HANDOVER, AND IT HAS TO BE ON THIS SIDE OF `panes.remove` — see this function's own
       // doc. `takeEditor()` returns `null` for every pane that was not holding one, which is all of
       // them on an ordinary close, so this costs a method call and a field read on the way out.
@@ -1376,6 +1397,7 @@ export function createPaneHost(deps: {
     focusPane,
     focusView,
     resetViews,
+    rebuildViews,
     seedHost(id: LeafId, host: HTMLElement): void {
       hosts.set(id, host)
     },
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  61 passed (61)
Tests  950 passed (950)
```

Run: `cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --working-directory="$PWD" pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  144 passed (144)
Tests  984 passed (984)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each.** In the replay, 19 of 19 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | the start-up workspace taken from storage over a link's — `src/main.ts`: `  const restored = startLink?.kind === 'whole' ? startLink.workspace : storedWorkspace ⏎ ` → `  const restored = storedWorkspace ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open.test.ts` | `tests/browser/share-open.test.ts > a link at start-up > opens the link's program under its encoding`, `tests/browser/share-open.test.ts > a link at start-up > opens the link's workspace, with every view on the program` |
| 2 | the start-up program taken from storage over a link's — `src/main.ts`: `    startLink === null \|\| startLink.kind === 'unreadable' ⏎       ? storedProgram` → `    true ⏎       ? storedProgram` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open.test.ts tests/browser/share-open-alone.test.ts` | `tests/browser/share-open-alone.test.ts > a link at start-up whose encoding and workspace cannot be taken > opens its program alone, under the encoding storage opened on, and clears the fragment`, `tests/browser/share-open.test.ts > a link at start-up > opens the link's program under its encoding` |
| 3 | a program alone under the default encoding, not the one storage opens on — `src/main.ts`: `encoding: startLink.encoding ?? storedProgram.encoding }` → `encoding: startLink.encoding ?? EXAMPLE_ENCODING }` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open-alone.test.ts` | `tests/browser/share-open-alone.test.ts > a link at start-up whose encoding and workspace cannot be taken > opens its program alone, under the encoding storage opened on, and clears the fragment` |
| 4 | the stored bindings seeded under a link — `src/main.ts`: `      if (startLink?.kind === 'whole') { ⏎         droppedBindings.push([leaf, session]) ⏎         continue ⏎       } ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open.test.ts` | `tests/browser/share-open.test.ts > a link at start-up > keeps the copy listed, paused, and drops its binding from storage`, `tests/browser/share-open.test.ts > a link at start-up > opens the link's program under its encoding`, `tests/browser/share-open.test.ts > a link at start-up > opens the link's workspace, with every view on the program`, `tests/browser/share-open.test.ts > a link at start-up > puts back the stored program, its encoding, the workspace and the copy’s view on undo` |
| 5 | the fragment left in place — `src/main.ts`: ``     window.history.replaceState(window.history.state, '', `${location.pathname}${location.search}`) ⏎  `` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open.test.ts tests/browser/share-open-unreadable.test.ts` | `tests/browser/share-open-unreadable.test.ts > a link at start-up that cannot be read > says so, offering nothing, and clears the fragment`, `tests/browser/share-open.test.ts > a link at start-up > clears the fragment` |
| 6 | the start-up link said nothing of — `src/main.ts`: `  if (startLink !== null) { ⏎     announceOpen(` → `  if (startLink === undefined) { ⏎     announceOpen(` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open.test.ts tests/browser/share-open-unreadable.test.ts` | `tests/browser/share-open-unreadable.test.ts > a link at start-up that cannot be read > says so, offering nothing, and clears the fragment`, `tests/browser/share-open.test.ts > a link at start-up > clears the fragment`, `tests/browser/share-open.test.ts > a link at start-up > puts back the stored program, its encoding, the workspace and the copy’s view on undo`, `tests/browser/share-open.test.ts > a link at start-up > says so, with an undo` |
| 7 | `resetViews` for the rebuild: only views showing a copy built again — `src/main.ts`: `    paneHost.rebuildViews(focusedLeaf()) ⏎ ` → `    paneHost.resetViews(focusedLeaf()) ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open-hashchange.test.ts` | `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > replaces the workspace, building every view again on the program in the link's display` |
| 8 | the inspector left as it was — `src/main.ts`: `    inspectorPanel.setOpen(ws.inspector) ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open-hashchange.test.ts` | `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > replaces the workspace, building every view again on the program in the link's display` |
| 9 | the source outline left as it was — `src/main.ts`: `    sourceOutline.panel.setOpen(ws.panels[SOURCE_LEAF]?.outline ?? false) ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open-hashchange.test.ts` | `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > replaces the workspace, building every view again on the program in the link's display` |
| 10 | the leaf counter not moved past the link's ids — `src/main.ts`: `    ws = rest ⏎     seedLeafCounter(tree) ⏎ ` → `    ws = rest ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open-hashchange.test.ts` | `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > adds a view beside a link's views without taking an id its tree holds` |
| 11 | undo that leaves the workspace — `src/main.ts`: `    if (before.workspace !== null) { ⏎       showWorkspace(before.workspace) ⏎ ` → `    if (before.workspace !== null) { ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open.test.ts tests/browser/share-open-hashchange.test.ts` | `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > puts back the program, the workspace and the copy’s view on undo`, `tests/browser/share-open.test.ts > a link at start-up > puts back the stored program, its encoding, the workspace and the copy’s view on undo` |
| 12 | undo that leaves the copies' views on the program — `src/main.ts`: `        paneHost.moveBack(leaves, SOURCE_SESSION, session) ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open.test.ts tests/browser/share-open-hashchange.test.ts` | `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > puts back the program, the workspace and the copy’s view on undo`, `tests/browser/share-open.test.ts > a link at start-up > puts back the stored program, its encoding, the workspace and the copy’s view on undo` |
| 13 | undo that moves a view onto a copy it did not warm — `src/main.ts`: `          paused.push(name) ⏎           continue ⏎ ` → `          paused.push(name) ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open-cap.test.ts` | `tests/browser/share-open-cap.test.ts > an open's undo past the copies cap > moves back every view it can warm a copy for, and says which copy stays paused` |
| 14 | undo that says nothing of a paused copy — `src/main.ts`: ``       paused.length === 0 ? put : `${put} — ${paused.join(', ')} paused, ${MAX_WARM_BUFFERS} copies are running`, `` → `      put,` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open-cap.test.ts` | `tests/browser/share-open-cap.test.ts > an open's undo past the copies cap > moves back every view it can warm a copy for, and says which copy stays paused` |
| 15 | undo that leaves the focus where it was — `src/main.ts`: `    view.focus() ⏎     if (!view.hasFocus) shareButton.focus() ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open.test.ts tests/browser/share-open-alone.test.ts` | `tests/browser/share-open-alone.test.ts > a link at start-up whose encoding and workspace cannot be taken > puts back the program alone on undo`, `tests/browser/share-open.test.ts > a link at start-up > puts back the stored program, its encoding, the workspace and the copy’s view on undo` |
| 16 | the undo kept past an edit — `src/main.ts`: `            // A LINK'S UNDO PUTS BACK THE WHOLE DOCUMENT TOO (spec §5.5), so it goes on the same terms. ⏎             withdrawOffer() ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open-hashchange.test.ts` | `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > withdraws the undo at the next edit that changes the program` |
| 17 | the undo kept past an encoding chosen — `src/main.ts`: `    pick?.dismiss() ⏎     withdrawOffer() ⏎   })` → `    pick?.dismiss() ⏎   })` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open-hashchange.test.ts` | `tests/browser/share-open-hashchange.test.ts > a whole link pasted into an open page > withdraws the undo at the next encoding chosen` |
| 18 | a program alone that does not name its encoding as left out — `src/main.ts`: `its ${opened.encoding === null ? 'encoding, ' : ''}workspace` → `its workspace` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open-alone.test.ts` | `tests/browser/share-open-alone.test.ts > a link at start-up whose encoding and workspace cannot be taken > names what was left out, with an undo` |
| 19 | every fragment read as a link — `src/main.ts`: `    if (isLink(location.hash)) void openLink(location.hash) ⏎ ` → `    void openLink(location.hash) ⏎ ` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-open-hashchange.test.ts` | `tests/browser/share-open-hashchange.test.ts > any other link pasted into an open page > leaves a fragment that is not a link alone` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
Opening a link: at start-up ahead of both stores and on hashchange, with the fragment cleared and an undo that stays offered until withdrawn

A link in the fragment is read after `init()` and before the program
and the workspace are taken from storage, and takes precedence over
both (spec §5.3); on an open page a `hashchange` takes a pasted link
the same way. Whole, it replaces the program, its encoding and the
workspace, builds every view again on the program and drops the
stored bindings, warming no copy; with anything else invalid, the
program opens alone and the notice names what was left out; unreadable,
nothing changes and the notice says so. The fragment is cleared either
way. The open's `undo` puts back the program, and the workspace and
each copy's view, warming a copy as a delete's undo does; it is
withdrawn at the next edit that changes the program, the next encoding
chosen, or another open (§5.5).

`PaneHost.rebuildViews` rebuilds every view the tree keeps, where
`resetViews` rebuilds only those showing a copy: a view reads its
display and panels only when it is built, so a kept one went on
showing the opener's under the link's workspace.
````

---

### Task 4: A link's positions: applied, continued and clamped

**Files:**
- Create: `web/src/share-positions.ts`
- Modify: `web/src/sessions.ts` (`LegState.pending`; `legControlState`), `web/src/controls.ts` (`LegView.pending`; the step line), `web/src/transport.ts` (a step gesture takes the leg), `web/src/main.ts` (`sayAboutOpen`, `positions`, the reply hook, the hold at an open)
- Modify (tests): `web/tests/node/controls.test.ts`
- Test: `web/tests/node/share-positions.test.ts`, `web/tests/browser/share-positions.test.ts`

**Interfaces:**
- Consumes Task 1's `Positions`; Task 3's `offer` and `announceOpen`.
- Produces `share-positions.ts`'s `MAX_LINK_CONTINUES = 10`; `type ShortOf = 'ended' | 'continues'`; `type PositionsDeps = { legOf: (leg: Leg) => LegState<unknown>; extend: (leg: Leg) => void; awaitingRun: () => boolean; short: (leg: Leg, wanted: number, shown: number, why: ShortOf) => void; draw: () => void }` (all `readonly`); `class LinkPositions { hold(gen: number, positions: Positions): void; onReply(reply: RunReply): void }`. `sessions.ts`'s `LegState.pending?: number`; `controls.ts`'s `LegView.pending: number | null`; in `main.ts`, `sayAboutOpen(text: string)` and `positions`.

**A POSITION IS PENDING ON ITS LEG** (spec §5.4): `LinkPositions.hold` takes a whole link's positions for the generation its open's compile claimed, gives each to its leg as `LegState.pending` once that compile's `compiled` says the leg exists — a declined leg's is dropped silently — and spends it where the frames hold a step past it, or where the recording stopped on it (the prototype's finding 9). The step line says `— going to step N from the link` meanwhile, and a gesture on the leg's step controls deletes it (`transport.ts`'s `taken`).

**CONTINUED AFTER THE `result`, ONE LEG AT A TIME, AT MOST TEN TIMES** (§5.4, row 16): the first leg in order still short of its position with more to record gets an `extend`; a run that ended short leaves the leg on its last step with a notice, and so do ten continues that did not reach it. Each notice is said through `sayAboutOpen`, carrying the open's `undo` while it is offered, however long after the open (§5.5).

**A RECOMPILE ENDS THEM, AND ONE REPLY SAYS SO**: every way a link's positions end but a gesture — a keystroke, an encoding chosen, an example, another link, the undo — replaces the program and so supersedes the link's compile, and the first reply of the next generation drops them all (the prototype's finding 10).

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=4
diff --git a/web/tests/browser/share-positions.test.ts b/web/tests/browser/share-positions.test.ts
new file mode 100644
index 0000000..97e7520
--- /dev/null
+++ b/web/tests/browser/share-positions.test.ts
@@ -0,0 +1,183 @@
+import type { EditorView } from '@codemirror/view'
+import { beforeAll, describe, expect, it } from 'vitest'
+import { userEvent } from 'vitest/browser'
+import { EXAMPLES } from '../../src/examples'
+import { encodeLink, type Positions } from '../../src/share-link'
+import { MAX_LINK_CONTINUES } from '../../src/share-positions'
+import { bindingKey } from '../../src/view-header'
+import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
+import { SHELL, until } from './harness'
+
+/**
+ * **A LINK'S POSITIONS, IN THE APP** — Plan 7 part 6a spec §5.4 and §8's positions row, on the real session worker:
+ * `fact(4)`'s λ at 3,000 reached after two continues; at 1,387, which its continue's ring drops, landing on 1,388;
+ * `sum_to(5)`'s λ at 5,000 clamped to 951; a step gesture taking a leg from its link before its first continue; and
+ * `fact(12)`'s λ at 17,000 stopping at 15,695 after ten continues, with the open's `undo` on the notice that says so.
+ * Each link is pasted into the open page, a `hashchange`.
+ *
+ * **EVERY REQUEST AND EVERY REPLY IS COUNTED**, by wrapping `Worker`'s own `postMessage` and `addEventListener` before
+ * the app mounts: a continue is an `extend` posted, and a reply is counted after the app's listener has taken it in,
+ * so once a `result` is counted, whatever continue it asked for has been posted. **ONE CONTINUE TO A CASE** for
+ * `fact(12)`: each takes up to 555 ms here, and a runner six times slower would put ten in one case past vitest's own
+ * bound. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
+ */
+
+const posted: { readonly kind?: unknown; readonly leg?: unknown }[] = []
+const heard: { readonly kind?: unknown }[] = []
+const post = Worker.prototype.postMessage
+Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]): void {
+  posted.push(message as (typeof posted)[number])
+  ;(post as (...args: unknown[]) => void).apply(this, [message, ...rest])
+}
+const listen = Worker.prototype.addEventListener
+Worker.prototype.addEventListener = function (
+  this: Worker,
+  type: string,
+  listener: EventListenerOrEventListenerObject,
+  options?: boolean | AddEventListenerOptions,
+): void {
+  const counted =
+    type === 'message' && typeof listener === 'function'
+      ? (e: Event) => {
+          listener.call(this, e)
+          heard.push((e as MessageEvent).data)
+        }
+      : listener
+  listen.call(this, type, counted, options)
+}
+
+const text = (id: string) => EXAMPLES.find((e) => e.id === id)?.text ?? ''
+const FACT = text('fact')
+const FACT_12 = text('fact-12')
+const SUM_TO = text('sum-to')
+
+const lambdaExtends = () => posted.filter((m) => m.kind === 'extend' && m.leg === 'lambda').length
+const results = () => heard.filter((m) => m.kind === 'result').length
+const stepOf = (leaf: string) => document.querySelector(`[data-leaf="${leaf}"] .step`)?.textContent ?? ''
+const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
+const undoButton = () => document.querySelector<HTMLButtonElement>('#notice button.notice-action')
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+
+let view: EditorView
+
+/**
+ * Paste a link to `program` under `unary` in Explorer, with `positions`, and wait until the open is said. Answers the
+ * `result`s and λ continues counted before it, so a case counts its own.
+ */
+async function open(program: string, positions: Positions): Promise<{ results: number; extends: number }> {
+  const before = { results: results(), extends: lambdaExtends() }
+  const fragment = await encodeLink({
+    program,
+    encoding: 'unary',
+    workspace: serializeWorkspace(defaultWorkspace()),
+    positions,
+  })
+  location.hash = fragment
+  await until(() => location.hash === '' && noticeText() === 'opened a shared link', 'the open')
+  return before
+}
+
+beforeAll(async () => {
+  document.body.innerHTML = SHELL
+  view = await (await import('../../src/main')).ready
+  await until(() => idle() && results() > 0, 'the first compile')
+})
+
+describe("a link's positions", () => {
+  it("reaches fact(4)'s λ step 3,000 after two continues, saying where it is going meanwhile", async () => {
+    const before = await open(FACT, { lambda: 3000 })
+    await until(() => stepOf('lambda-0').includes('— going to step 3,000 from the link'), 'the pending position')
+    // ONE WAIT A RESULT, so no one wait holds three recordings on a slow runner.
+    await until(() => results() === before.results + 1, 'the run')
+    await until(() => results() === before.results + 2, 'the first continue')
+    await until(() => results() === before.results + 3, 'the second continue')
+    expect(lambdaExtends() - before.extends).toBe(2)
+    expect(stepOf('lambda-0')).toBe('step 3,000 of 4,144 — history is full (oldest kept: step 2,770)')
+  })
+
+  it("lands fact(4)'s λ step 1,387, which its continue's ring drops, on 1,388", async () => {
+    const before = await open(FACT, { lambda: 1387 })
+    await until(() => results() === before.results + 1, 'the run')
+    await until(() => results() === before.results + 2, 'the continue')
+    expect(lambdaExtends() - before.extends).toBe(1)
+    expect(stepOf('lambda-0')).toBe('step 1,388 of 2,768 — history is full (oldest kept: step 1,388)')
+  })
+
+  it("clamps sum_to(5)'s λ step 5,000 to its last, 951, and says so with the open's undo", async () => {
+    const before = await open(SUM_TO, { lambda: 5000 })
+    await until(() => noticeText().startsWith("the link's λ step"), 'the clamp')
+    expect(noticeText()).toBe("the link's λ step 5,000 is past the end of this run — showing step 951")
+    expect(undoButton()?.textContent).toBe('undo')
+    expect(stepOf('lambda-0')).toBe('step 951 of 951')
+    await until(() => results() === before.results + 1, 'the run')
+    expect(lambdaExtends()).toBe(before.extends)
+  })
+
+  it('takes a leg from its link at a step gesture, and continues it no further', async () => {
+    const before = await open(FACT, { lambda: 3000 })
+    await until(
+      () => stepOf('lambda-0').includes('— going to step 3,000 from the link') && !backButton().disabled,
+      'the pending position, with a step to go back to',
+    )
+    await userEvent.click(backButton())
+    expect(stepOf('lambda-0')).not.toContain('going to')
+    await until(() => results() === before.results + 1, 'the run')
+    expect(lambdaExtends()).toBe(before.extends)
+  })
+})
+
+const backButton = () =>
+  document.querySelector<HTMLButtonElement>(
+    '[data-leaf="lambda-0"] button[aria-label="one step back"]',
+  ) as HTMLButtonElement
+
+/**
+ * **`fact(12)`'s λ AT 17,000: TEN CONTINUES, THEN IT STOPS AT 15,695** (spec §5.4, row 16, §A.2), one continue to a
+ * case. Its TM leg is declined under `unary`, and the link's TM position is dropped with nothing said. Part-way, a
+ * notice of another gesture takes the open's notice off the line; the tenth continue's notice offers the open's `undo`
+ * all the same, since nothing has withdrawn it (§5.5).
+ */
+describe("fact(12)'s λ at 17,000", () => {
+  let before: { results: number; extends: number }
+  const continued = (n: number) => until(() => results() === before.results + 1 + n, `continue ${n}`)
+
+  it('opens with λ going to step 17,000, and the declined TM leg’s position dropped', async () => {
+    before = await open(FACT_12, { lambda: 17000, tm: 5 })
+    await until(() => results() === before.results + 1, 'the run')
+    expect(lambdaExtends() - before.extends).toBe(1)
+    expect(stepOf('lambda-0')).toContain('— going to step 17,000 from the link')
+    expect(stepOf('tm-0')).not.toContain('going to')
+    expect(document.querySelector('[data-leaf="tm-0"] .step')?.textContent).not.toMatch(/^step /)
+  })
+
+  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('posts the next continue once continue %i has recorded', async (n) => {
+    await continued(n)
+    expect(lambdaExtends() - before.extends).toBe(n + 1)
+    expect(stepOf('lambda-0')).toContain('— going to step 17,000 from the link')
+    // ANOTHER GESTURE'S NOTICE TAKES THE OPEN'S OFF THE LINE, WITHDRAWING NOTHING.
+    if (n === 3) {
+      await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
+      await userEvent.click(
+        document.querySelector<HTMLButtonElement>(
+          `#new-view-menu button[data-binding="${bindingKey('asm', 'source')}"]`,
+        ) as HTMLButtonElement,
+      )
+      await until(() => noticeText().startsWith('view added'), 'the view')
+      expect(undoButton()).toBeNull()
+    }
+  })
+
+  it(`stops at 15,695 after the tenth, with no eleventh, and says so with the open's undo`, async () => {
+    await continued(MAX_LINK_CONTINUES)
+    expect(lambdaExtends() - before.extends).toBe(MAX_LINK_CONTINUES)
+    expect(noticeText()).toBe("the link's λ step 17,000 is further on than 10 continues went — showing step 15,695")
+    expect(stepOf('lambda-0')).toBe('step 15,695 of 15,695 — history is full (oldest kept: step 14,273)')
+    expect(undoButton()?.textContent).toBe('undo')
+  })
+
+  it('puts back the program the link replaced, on that undo', async () => {
+    await userEvent.click(undoButton() as HTMLButtonElement)
+    expect(view.state.doc.toString()).toBe(FACT)
+    expect(noticeText()).toBe('put back the program and the workspace')
+  })
+})
diff --git a/web/tests/node/controls.test.ts b/web/tests/node/controls.test.ts
index 59b6a00..c05b48a 100644
--- a/web/tests/node/controls.test.ts
+++ b/web/tests/node/controls.test.ts
@@ -13,6 +13,7 @@ const view = (over: Partial<LegView> = {}): LegView => ({
   done: null,
   awaitingRun: false,
   playing: false,
+  pending: null,
   ...over,
 })
 
@@ -148,6 +149,16 @@ describe('controlState', () => {
     expect(controlState({ ...running, awaitingRun: true }).stepText).toBe('step 4 of 11 — recompiling')
   })
 
+  // PLAN 7 PART 6a spec §5.4: a stop the link will continue past is not where the leg rests, so where it is going is
+  // said in its place; a recompile drops the position, and says so first.
+  it("says where a shared link's position is taking the leg, in place of how its recording stopped", () => {
+    const full = view({ done: 'budget', length: 1386, head: 1385, currentStep: 1386, newestStep: 1386, pending: 3000 })
+    expect(controlState(full).stepText).toBe('step 1,386 of 1,386 — going to step 3,000 from the link')
+    const recording = view({ done: null, length: 12, head: 11, currentStep: 11, newestStep: 11, pending: 3000 })
+    expect(controlState(recording).stepText).toBe('step 11 of 11… — going to step 3,000 from the link')
+    expect(controlState({ ...full, awaitingRun: true }).stepText).toBe('step 1,386 of 1,386 — recompiling')
+  })
+
   it('leaves back, play and restart alone while awaiting a run', () => {
     const c = controlState(view({ length: 3, head: 1, done: 'budget', awaitingRun: true }))
     expect(c.canBack).toBe(true)
diff --git a/web/tests/node/share-positions.test.ts b/web/tests/node/share-positions.test.ts
new file mode 100644
index 0000000..5db951e
--- /dev/null
+++ b/web/tests/node/share-positions.test.ts
@@ -0,0 +1,214 @@
+import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
+import { History } from '../../src/history'
+import type { Leg, RecordEnd, RunReply } from '../../src/protocol'
+import type { LegState } from '../../src/sessions'
+import { LinkPositions, MAX_LINK_CONTINUES, type PositionsDeps } from '../../src/share-positions'
+
+/**
+ * A link's positions against the replies a session worker sends (Plan 7 part 6a spec §5.4): held until the link's
+ * compile says which legs exist, applied as the frames reach them, continued after the run's `result` one leg at a
+ * time, and clamped where the run ends or the continues run out. Each leg is a real `History`, a frame a byte against
+ * a budget of `RING` bytes, so a ring holds `RING` steps and drops its oldest past them.
+ */
+
+const RING = 5
+const GEN = 1
+
+let legs: Record<Leg, LegState<number>>
+let extend: Mock<PositionsDeps['extend']>
+let short: Mock<PositionsDeps['short']>
+let draw: Mock<PositionsDeps['draw']>
+let awaiting: boolean
+let positions: LinkPositions
+
+beforeEach(() => {
+  const leg = (): LegState<number> => ({
+    hist: new History<number>(RING),
+    status: { available: true, reason: '' },
+    done: null,
+    playing: false,
+  })
+  legs = { lambda: leg(), asm: leg(), tm: leg() }
+  awaiting = false
+  extend = vi.fn()
+  short = vi.fn()
+  draw = vi.fn()
+  positions = new LinkPositions({ legOf: (l) => legs[l], extend, awaitingRun: () => awaiting, short, draw })
+})
+
+/** The link's compile, with `declined` legs unavailable. */
+const compiled = (declined: readonly Leg[] = [], gen = GEN): RunReply =>
+  ({
+    kind: 'compiled',
+    gen,
+    lambda: { available: !declined.includes('lambda'), reason: '' },
+    asm: { available: !declined.includes('asm'), reason: '' },
+    tm: { available: !declined.includes('tm'), reason: '' },
+  }) as unknown as RunReply
+
+/** Frames for steps `from` to `to` on `leg`, taken in as `replies.ts` takes them, then heard; `done` as the reply says. */
+function record(leg: Leg, from: number, to: number, done: RecordEnd | null, gen = GEN): void {
+  for (let step = from; step <= to; step++) legs[leg].hist.push(step, 1)
+  legs[leg].done = done
+  positions.onReply({ kind: `${leg}-frames`, gen, frames: [], done } as unknown as RunReply)
+}
+
+const result = (gen = GEN): void => positions.onReply({ kind: 'result', gen } as unknown as RunReply)
+
+describe('LinkPositions', () => {
+  it("gives each available leg its position once the link's compile says which exist, a declined leg's dropped", () => {
+    positions.hold(GEN, { lambda: 3, tm: 2 })
+    expect(legs.lambda.pending).toBeUndefined()
+    positions.onReply(compiled(['tm']))
+    expect(legs.lambda.pending).toBe(3)
+    expect(legs.tm.pending).toBeUndefined()
+    expect(legs.asm.pending).toBeUndefined()
+    expect(short).not.toHaveBeenCalled()
+  })
+
+  it('seeks to the position once the frames hold one past it, mid-recording, and later frames leave it there', () => {
+    positions.hold(GEN, { lambda: 3 })
+    positions.onReply(compiled())
+    record('lambda', 0, 1, null)
+    expect(legs.lambda.hist.currentStep).toBe(1)
+    expect(legs.lambda.pending).toBe(3)
+    // THE POSITION IS THE NEWEST FRAME OF A RECORDING STILL GOING: a seek onto it would go on following the frontier.
+    record('lambda', 2, 3, null)
+    expect(legs.lambda.pending).toBe(3)
+    record('lambda', 4, 4, null)
+    expect(legs.lambda.hist.currentStep).toBe(3)
+    expect(legs.lambda.pending).toBeUndefined()
+    expect(draw).toHaveBeenCalledTimes(1)
+    record('lambda', 5, 6, 'ended')
+    expect(legs.lambda.hist.currentStep).toBe(3)
+    expect(short).not.toHaveBeenCalled()
+  })
+
+  it('seeks to a position that is the last frame of a recording that stopped', () => {
+    positions.hold(GEN, { lambda: 4 })
+    positions.onReply(compiled())
+    record('lambda', 0, 4, 'budget')
+    expect(legs.lambda.hist.currentStep).toBe(4)
+    expect(legs.lambda.pending).toBeUndefined()
+    result()
+    expect(extend).not.toHaveBeenCalled()
+  })
+
+  it('lands a position the ring has already dropped on its oldest kept step', () => {
+    positions.hold(GEN, { lambda: 1 })
+    positions.onReply(compiled())
+    record('lambda', 0, 7, 'ended')
+    expect(legs.lambda.hist.oldestStep).toBe(3)
+    expect(legs.lambda.hist.currentStep).toBe(3)
+  })
+
+  it('clamps a position past a run that ended to its last step, and says so', () => {
+    positions.hold(GEN, { lambda: 9 })
+    positions.onReply(compiled())
+    record('lambda', 0, 2, 'ended')
+    expect(legs.lambda.hist.currentStep).toBe(2)
+    expect(legs.lambda.pending).toBeUndefined()
+    expect(short).toHaveBeenCalledWith('lambda', 9, 2, 'ended')
+    result()
+    expect(extend).not.toHaveBeenCalled()
+  })
+
+  it("continues a leg whose history filled, but not before the run's result", () => {
+    positions.hold(GEN, { lambda: 7 })
+    positions.onReply(compiled())
+    record('lambda', 0, 4, 'budget')
+    expect(extend).not.toHaveBeenCalled()
+    result()
+    expect(extend).toHaveBeenCalledTimes(1)
+    expect(extend).toHaveBeenLastCalledWith('lambda')
+    record('lambda', 5, 9, 'budget')
+    expect(legs.lambda.hist.currentStep).toBe(7)
+    result()
+    expect(extend).toHaveBeenCalledTimes(1)
+  })
+
+  it('continues one leg at a time, λ then asm then TM', () => {
+    positions.hold(GEN, { lambda: 7, asm: 7, tm: 7 })
+    positions.onReply(compiled())
+    record('lambda', 0, 4, 'budget')
+    record('asm', 0, 4, 'budget')
+    record('tm', 0, 4, 'capped')
+    result()
+    expect(extend.mock.calls).toEqual([['lambda']])
+    record('lambda', 5, 9, 'budget')
+    result()
+    expect(extend.mock.calls).toEqual([['lambda'], ['asm']])
+    record('asm', 5, 9, 'budget')
+    result()
+    expect(extend.mock.calls).toEqual([['lambda'], ['asm'], ['tm']])
+  })
+
+  it(`stops a leg at its furthest step after ${MAX_LINK_CONTINUES} continues, says so, and asks the next leg`, () => {
+    positions.hold(GEN, { lambda: 1000, tm: 1000 })
+    positions.onReply(compiled())
+    record('lambda', 0, 4, 'budget')
+    record('tm', 0, 4, 'budget')
+    result()
+    for (let n = 1; n <= MAX_LINK_CONTINUES; n++) {
+      expect(extend.mock.calls.length).toBe(n)
+      record('lambda', 5 * n, 5 * n + 4, 'budget')
+      result()
+    }
+    const last = 5 * MAX_LINK_CONTINUES + 4
+    expect(legs.lambda.hist.currentStep).toBe(last)
+    expect(legs.lambda.pending).toBeUndefined()
+    expect(short).toHaveBeenCalledWith('lambda', 1000, last, 'continues')
+    expect(extend.mock.calls.filter(([l]) => l === 'lambda')).toHaveLength(MAX_LINK_CONTINUES)
+    expect(extend).toHaveBeenLastCalledWith('tm')
+  })
+
+  it('continues nothing while the program session awaits a run', () => {
+    positions.hold(GEN, { lambda: 7 })
+    positions.onReply(compiled())
+    record('lambda', 0, 4, 'budget')
+    awaiting = true
+    result()
+    expect(extend).not.toHaveBeenCalled()
+  })
+
+  it('drops every position at a reply of another generation, whether held or pending', () => {
+    positions.hold(GEN, { lambda: 3 })
+    positions.onReply(compiled([], GEN + 1))
+    expect(legs.lambda.pending).toBeUndefined()
+    positions.hold(GEN, { lambda: 3 })
+    positions.onReply(compiled())
+    record('lambda', 0, 1, null, GEN + 1)
+    expect(legs.lambda.pending).toBeUndefined()
+    record('lambda', 2, 4, null)
+    expect(legs.lambda.hist.currentStep).toBe(4)
+  })
+
+  it('drops every position when the compile answers with no run, or the worker fails', () => {
+    for (const kind of ['no-session', 'worker-error'] as const) {
+      positions.hold(GEN, { asm: 3 })
+      positions.onReply(compiled())
+      expect(legs.asm.pending).toBe(3)
+      positions.onReply({ kind, gen: GEN } as unknown as RunReply)
+      expect(legs.asm.pending, kind).toBeUndefined()
+    }
+  })
+
+  it("drops an earlier link's pending positions when a new link's are held", () => {
+    positions.hold(GEN, { lambda: 3, asm: 3 })
+    positions.onReply(compiled())
+    positions.hold(GEN + 1, { tm: 2 })
+    expect([legs.lambda.pending, legs.asm.pending]).toEqual([undefined, undefined])
+    positions.onReply(compiled([], GEN + 1))
+    expect(legs.tm.pending).toBe(2)
+  })
+
+  it('hears nothing with no link held, and nothing from a λ tree', () => {
+    record('lambda', 0, 4, 'budget')
+    result()
+    expect(extend).not.toHaveBeenCalled()
+    positions.hold(GEN, { lambda: 3 })
+    positions.onReply({ kind: 'lambda-tree', gen: GEN + 1 } as unknown as RunReply)
+    positions.onReply(compiled())
+    expect(legs.lambda.pending).toBe(3)
+  })
+})
````

- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts tests/node/controls.test.ts`

Expected: exit 1, printing:

```text
Test Files  2 failed (2)
Tests  1 failed | 25 passed (26)
```

Failing as a whole file: `tests/node/share-positions.test.ts`, with `Error: Cannot find module '../../src/share-positions' imported from tests/node/share-positions.test.ts`.

Failing: `tests/node/controls.test.ts > controlState > says where a shared link's position is taking the leg, in place of how its recording stopped`.

Run: `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-positions.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  no tests
```

Failing as a whole file: `tests/browser/share-positions.test.ts`, with `Error: Failed to import test file tests/browser/share-positions.test.ts`.

- [ ] **Step 3: Write the code.**

````diff apply=source task=4
diff --git a/web/src/controls.ts b/web/src/controls.ts
index 477dc91..37a705b 100644
--- a/web/src/controls.ts
+++ b/web/src/controls.ts
@@ -21,6 +21,8 @@ export type LegView = {
   awaitingRun: boolean
   /** Whether this leg's play button is on — `LegState.playing`. */
   playing: boolean
+  /** The step a shared link's position is taking this leg to, or `null` — `LegState.pending`. */
+  pending: number | null
 }
 
 export type ControlState = {
@@ -126,7 +128,15 @@ export function controlState(v: LegView): ControlState {
   const oldest = v.evicted ? ` (oldest kept: step ${n(v.oldestStep)})` : ''
   // THE READOUT SAYS WHAT THE USER DID; THE FIELD NAMES WHAT IS TRUE OF THE SESSION. They are the
   // same state from the two ends, and this is the existing narration rather than a second channel.
-  const tail = v.awaitingRun ? ' — recompiling' : v.done === null ? '' : doneText(v.done)
+  // **A LINK'S PENDING POSITION SAYS WHERE THE LEG IS GOING IN PLACE OF HOW ITS RECORDING STOPPED** (Plan 7 part 6a
+  // spec §5.4): a stop the link will continue past is not where the leg rests.
+  const tail = v.awaitingRun
+    ? ' — recompiling'
+    : v.pending !== null
+      ? ` — going to step ${n(v.pending)} from the link`
+      : v.done === null
+        ? ''
+        : doneText(v.done)
   const stepText = v.length === 0 ? 'not run' : `step ${n(v.currentStep)} of ${of}${tail}${oldest}`
 
   return {
diff --git a/web/src/main.ts b/web/src/main.ts
index e0ddb4e..3f53dd0 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -34,6 +34,7 @@ import { createEditorCustody } from './editor-custody'
 import { KeymapSetting, keymapSlot } from './editor-keymap'
 import { KEYMAP_LABEL, KEYMAP_MODES, parseKeymapMode, readFormatOnBlur, writeFormatOnBlur } from './editor-prefs'
 import { EXAMPLE_ENCODING, EXAMPLES, type Example, FIRST_LOAD } from './examples'
+import { n } from './format'
 import { declineMark, focusMark, linkMark } from './highlight'
 import { History } from './history'
 import { icon } from './icons'
@@ -65,6 +66,7 @@ import { type SessionId, SessionPool } from './session-client'
 import { legControlState, type SessionLegs, SessionRegistry } from './sessions'
 import { decodeLink, isLink, type OpenedLink, type SharePayload } from './share-link'
 import { createShare } from './share-popover'
+import { LinkPositions, MAX_LINK_CONTINUES } from './share-positions'
 import {
   applySkin,
   customPaletteLabel,
@@ -806,7 +808,11 @@ async function main(): Promise<EditorView> {
     id: SOURCE_SESSION,
     label: 'program',
     detached: false,
-    client: pool.bind(SOURCE_SESSION, (reply: RunReply) => replies.onReply(SOURCE_SESSION, reply)),
+    // A LINK'S POSITIONS HEAR EACH REPLY AFTER THE APP HAS TAKEN IT IN, so a frames reply's frames are in their ring.
+    client: pool.bind(SOURCE_SESSION, (reply: RunReply) => {
+      replies.onReply(SOURCE_SESSION, reply)
+      positions.onReply(reply)
+    }),
     // EVERY LEG, AND THE `satisfies` IS WHAT SAYS SO. `SessionLegs` makes each leg optional because a copy
     // has one (its own doc), so a leg left out of this literal would still typecheck, and the program would
     // have no such leg to record, to bind a view to, or to offer in a selector. `Required` makes a leg with no
@@ -1671,6 +1677,27 @@ async function main(): Promise<EditorView> {
     offer?.notice.dismiss()
     offer = null
   }
+  /** Say `text` about the last open, with its `undo` while that is offered, however long after the open (spec §5.5). */
+  const sayAboutOpen = (text: string): void => {
+    const notice = notices.notify(text, offer === null ? {} : { action: offer.undo })
+    if (offer !== null) offer.notice = notice
+  }
+
+  /**
+   * A LINK'S POSITIONS — `share-positions.ts`'s `LinkPositions`, held from a whole open until the frames reach them
+   * (spec §5.4). **A LEG THAT STOPS SHORT IS SAID ABOUT THE OPEN**, carrying its `undo`: the run ended before the step,
+   * or `MAX_LINK_CONTINUES` continues did not reach it, and the step shown is the leg's last.
+   */
+  const positions = new LinkPositions({
+    legOf: (leg) => sessions.legOf({ session: SOURCE_SESSION, leg }),
+    extend: (leg) => sessions.entryOf(SOURCE_SESSION).client.extend(leg),
+    awaitingRun: () => sessions.entryOf(SOURCE_SESSION).client.awaitingRun,
+    short: (leg, wanted, shown, why) =>
+      sayAboutOpen(
+        `the link's ${LEG_NAME[leg]} step ${n(wanted)} is ${why === 'ended' ? 'past the end of this run' : `further on than ${MAX_LINK_CONTINUES} continues went`} — showing step ${n(shown)}`,
+      ),
+    draw: () => draw(),
+  })
 
   // A CHOICE OF ENCODING IS HALF OF WHAT THE UNDO PUTS BACK, so it goes at one too — a pick's and a link's. A pick, a
   // link and their undos set the picker by assignment, which fires no `change`, so none ends its own notice.
@@ -1847,6 +1874,9 @@ async function main(): Promise<EditorView> {
       notices.notify('this link could not be read — nothing was changed')
       return
     }
+    // A WHOLE LINK'S POSITIONS ARE HELD FOR THE COMPILE ITS OPEN SCHEDULED. An earlier link's go at that compile's first
+    // reply, as they go at any recompile (`LinkPositions.onReply`).
+    if (opened.kind === 'whole') positions.hold(sessions.entryOf(SOURCE_SESSION).client.gen, opened.positions)
     // ANY EARLIER OPEN'S OFFER GOES WITH IT: this notice replaces its notice, and this offer takes its place.
     const undo: NoticeAction = { label: 'undo', fallback: () => shareButton, run: () => undoOpen(before) }
     const text =
diff --git a/web/src/sessions.ts b/web/src/sessions.ts
index 18c28dc..acde4e6 100644
--- a/web/src/sessions.ts
+++ b/web/src/sessions.ts
@@ -40,6 +40,12 @@ export type LegState<T> = {
    * `resetLegs` clears.
    */
   playing: boolean
+  /**
+   * The step a shared link's position is taking this leg to, while the frames have not reached it — Plan 7 part 6a
+   * spec §5.4: set and spent, and dropped at a recompile, by `share-positions.ts`'s `LinkPositions`; read by the step
+   * line; and taken away by a gesture on the leg's step controls. Absent on every leg no link is taking anywhere.
+   */
+  pending?: number
 }
 
 /**
@@ -595,6 +601,7 @@ export function legControlState<K extends Leg>(
     done: leg.done,
     awaitingRun: reg.entryOf(binding.session).client.awaitingRun,
     playing: leg.playing,
+    pending: leg.pending ?? null,
   })
 }
 
diff --git a/web/src/share-positions.ts b/web/src/share-positions.ts
new file mode 100644
index 0000000..d8699f4
--- /dev/null
+++ b/web/src/share-positions.ts
@@ -0,0 +1,176 @@
+import { canRecordFurther } from './controls'
+import { LEGS } from './legs'
+import type { Leg, RunReply } from './protocol'
+import type { LegState } from './sessions'
+import type { Positions } from './share-link'
+
+/**
+ * A LINK'S POSITIONS, HELD UNTIL THE FRAMES REACH THEM — Plan 7 part 6a spec §5.4. A link names a step per program
+ * leg; the opener's run records them, and each is applied as the frames that hold it arrive, or continued towards, or
+ * clamped, as the run allows.
+ *
+ * **A POSITION IS PENDING ON ITS LEG, AS `LegState.pending`**, where the leg's step line reads it and a gesture on the
+ * leg's step controls takes it away (`transport.ts`). This holds the rest: which compile the link's positions belong
+ * to, those not yet given to a leg, and how many times each leg has been continued.
+ *
+ * **EVERY WAY A LINK'S POSITIONS END BUT A GESTURE IS A RECOMPILE, AND ONE REPLY ANSWERS THEM ALL.** A keystroke, an
+ * encoding chosen, an example picked, another link and an open's undo each replace the program, so each supersedes the
+ * link's compile, and the first reply of the next one drops every position (`onReply`).
+ *
+ * **NO DOM, SO IT IS TESTED IN NODE**, against the replies a session worker sends.
+ */
+
+/** How many times a position may continue its leg's recording, per leg and per open (spec row 16). */
+export const MAX_LINK_CONTINUES = 10
+
+/** Why a leg stopped short of its link's step: its run ended there, or `MAX_LINK_CONTINUES` did not reach it. */
+export type ShortOf = 'ended' | 'continues'
+
+export type PositionsDeps = {
+  /** The program session's leg. */
+  readonly legOf: (leg: Leg) => LegState<unknown>
+  /** Post the leg's `extend` — what *continue* posts. */
+  readonly extend: (leg: Leg) => void
+  /** Whether the program session is awaiting a run: nothing can be recorded further while it is. */
+  readonly awaitingRun: () => boolean
+  /** Say that `leg` stopped short of the link's step `wanted`, at `shown`, and why. */
+  readonly short: (leg: Leg, wanted: number, shown: number, why: ShortOf) => void
+  /** Repaint: a seek moves every view of the leg. */
+  readonly draw: () => void
+}
+
+export class LinkPositions {
+  readonly #deps: PositionsDeps
+  /** The generation of the link's compile, or `null` when no link's positions are held. */
+  #gen: number | null = null
+  /** The positions not yet given to a leg: all of them, until the link's compile says which legs exist. */
+  #held: Positions = {}
+  #continues: Record<Leg, number> = { lambda: 0, asm: 0, tm: 0 }
+
+  constructor(deps: PositionsDeps) {
+    this.#deps = deps
+  }
+
+  /**
+   * Hold a link's `positions` for the compile of generation `gen`, the one its open scheduled, in place of any other
+   * link's (spec §5.4).
+   */
+  hold(gen: number, positions: Positions): void {
+    this.#drop()
+    this.#gen = gen
+    this.#held = positions
+  }
+
+  /** Drop every position, held or pending: a recompile's, or a compile that answered with no run. */
+  #drop(): void {
+    this.#gen = null
+    this.#held = {}
+    this.#continues = { lambda: 0, asm: 0, tm: 0 }
+    for (const leg of LEGS) delete this.#deps.legOf(leg).pending
+  }
+
+  /**
+   * Hear a reply of the program session, after the app has taken it in: the frames are in their rings by now.
+   *
+   * **A REPLY OF ANOTHER GENERATION ENDS THE LINK'S POSITIONS**: the program session answers only its current
+   * generation, so it is a recompile's, and a recompile drops them (spec §5.4). Until it answers, the step line says the
+   * leg is recompiling in place of where it was going.
+   */
+  onReply(reply: RunReply): void {
+    if (this.#gen === null || reply.kind === 'lambda-tree') return
+    if (reply.gen !== this.#gen) {
+      this.#drop()
+      return
+    }
+    switch (reply.kind) {
+      case 'compiled':
+        // A POSITION FOR A DECLINED LEG IS DROPPED SILENTLY: the leg's view already says why it is absent.
+        for (const leg of LEGS) {
+          const step = this.#held[leg]
+          if (step !== undefined && reply[leg].available) this.#deps.legOf(leg).pending = step
+        }
+        this.#held = {}
+        return
+      case 'lambda-frames':
+        this.#frames('lambda')
+        return
+      case 'asm-frames':
+        this.#frames('asm')
+        return
+      case 'tm-frames':
+        this.#frames('tm')
+        return
+      case 'result':
+        this.#result()
+        return
+      case 'no-session':
+      case 'worker-error':
+        this.#drop()
+        return
+      default:
+        return
+    }
+  }
+
+  /**
+   * A leg's frames arrived. **ONCE THE RING HOLDS A FRAME PAST THE POSITION, THE HEAD GOES THERE AND IT IS SPENT** —
+   * mid-recording too: a seek short of the newest frame stops following, so the rest of the recording does not move the
+   * view, and a frame the ring drops later moves the head with it. A position the ring has already dropped lands on the
+   * oldest kept step.
+   *
+   * **PAST IT, NOT AT IT, WHILE THE RECORDING GOES ON.** `History.seek` onto the newest frame goes on following the
+   * frontier, so a position that is the last frame of a chunk would be carried off by the next one; it waits for that
+   * chunk instead, or for the recording to stop with it as its last frame, when nothing more arrives to move it.
+   *
+   * **A RECORDING THAT ENDED SHORT OF IT, WITH NOTHING TO CONTINUE, CLAMPS IT**: the leg stays on its last step, and a
+   * notice says so.
+   */
+  #frames(leg: Leg): void {
+    const state = this.#deps.legOf(leg)
+    const wanted = state.pending
+    if (wanted === undefined || state.hist.length === 0) return
+    const newest = state.hist.newestStep
+    if (newest > wanted || (newest === wanted && state.done !== null)) {
+      state.hist.seek(wanted - state.hist.oldestStep)
+      delete state.pending
+      this.#deps.draw()
+      return
+    }
+    if (state.done === null || canRecordFurther(state.done, false)) return
+    this.#stop(leg, wanted, 'ended')
+  }
+
+  /**
+   * A run's or a continue's `result`. **NOT BEFORE IT, AND ONE LEG AT A TIME, λ THEN asm THEN TM**: a continue posted
+   * while the run still records a later leg would interleave the two recordings, and post its `result` before the run's
+   * (spec §5.4). The first leg in order still short of its position continues, up to `MAX_LINK_CONTINUES` times; past
+   * that it stops at its furthest step, and the next leg is asked.
+   */
+  #result(): void {
+    for (const leg of LEGS) {
+      const state = this.#deps.legOf(leg)
+      const wanted = state.pending
+      if (wanted === undefined || !canRecordFurther(state.done, this.#deps.awaitingRun())) continue
+      if (this.#continues[leg] < MAX_LINK_CONTINUES) {
+        this.#continues[leg] += 1
+        this.#deps.extend(leg)
+        return
+      }
+      this.#stop(leg, wanted, 'continues')
+    }
+  }
+
+  /**
+   * Spend `leg`'s position, `wanted`, where it stopped short, and say how far short, at which step.
+   *
+   * **THE HEAD IS ON THE LEG'S LAST STEP ALREADY**, which is where the spec puts it: a ring's head follows its frontier
+   * until something moves it, and what could — this position, reached, or a gesture on the leg's step controls — would
+   * have spent it or taken it away.
+   */
+  #stop(leg: Leg, wanted: number, why: ShortOf): void {
+    const state = this.#deps.legOf(leg)
+    delete state.pending
+    this.#deps.draw()
+    this.#deps.short(leg, wanted, state.hist.currentStep, why)
+  }
+}
diff --git a/web/src/transport.ts b/web/src/transport.ts
index 9de65ab..926c7fd 100644
--- a/web/src/transport.ts
+++ b/web/src/transport.ts
@@ -10,7 +10,7 @@ import { createPlayer } from './player'
 import type { Leg } from './protocol'
 import { BufferCapReached, type ScratchBuffers } from './scratch'
 import type { SessionId } from './session-client'
-import type { Binding, LegState, PaneSlot, SessionRegistry } from './sessions'
+import type { Binding, LegFrame, LegState, PaneSlot, SessionRegistry } from './sessions'
 import { pairLabel } from './view-header'
 import type { Speed } from './workspace'
 
@@ -227,18 +227,29 @@ export function createTransport(deps: {
    * as the leg of the `LegState` beside it, passed separately only because a `LegState` carries no
    * identity (§3.2b); a binding carries both, so passing them apart is a way for them to disagree.
    */
+  /**
+   * The leg a step-control gesture acts on, taken from any shared link's position it was pending towards — Plan 7 part
+   * 6a spec §5.4: a user stepping, playing, restarting or continuing a leg has taken it from the link, and the link
+   * neither moves it nor continues it again.
+   */
+  const taken = <K extends Leg>(slot: PaneSlot<K>): LegState<LegFrame[K]> => {
+    const leg = slot.resolve(sessions)
+    delete leg.pending
+    return leg
+  }
+
   const events = <K extends Leg>(slot: PaneSlot<K>): PaneEvents => ({
     // ONE SPEED FOR THE WORKSPACE, NOT PER VIEW — every view's step controls read and set the same value.
     speed: deps.speed,
     setSpeed: deps.setSpeed,
     back: () => {
-      slot.resolve(sessions).hist.back()
+      taken(slot).hist.back()
       draw()
     },
     forward: () => {
       // At the frontier `▶` means "record one more", which is the same operation as `[continue]`.
       // `canRecordFurther` is `controls.ts`'s call, not re-derived here — see its doc comment.
-      const leg = slot.resolve(sessions)
+      const leg = taken(slot)
       const entry = sessions.entryOf(slot.binding.session)
       if (!leg.hist.forward() && canRecordFurther(leg.done, entry.client.awaitingRun)) {
         entry.client.extend(slot.binding.leg)
@@ -255,12 +266,15 @@ export function createTransport(deps: {
     // playback on rebind would let one pane's selector silently stop the other pane's playback. The
     // player stops at the frontier, so an unwatched run is bounded rather than forever. See
     // `PaneSlot.rebind` for the same decision stated where the rebind happens.
-    play: () => play(slot.resolve(sessions)),
+    play: () => play(taken(slot)),
     restart: () => {
-      slot.resolve(sessions).hist.seek(0)
+      taken(slot).hist.seek(0)
       draw()
     },
-    extend: () => sessions.entryOf(slot.binding.session).client.extend(slot.binding.leg),
+    extend: () => {
+      taken(slot)
+      sessions.entryOf(slot.binding.session).client.extend(slot.binding.leg)
+    },
     // THE SELECTOR'S PICK, ON THE SESSION AXIS. `PaneSlot.rebind` writes the session and nothing else —
     // the leg is fixed by `K` and has no writer anywhere in the app, which is what keeps `Binding<K>`'s
     // type property (see `PaneSlot`'s doc). `draw()` immediately afterwards because a rebind changes
````

- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  62 passed (62)
Tests  964 passed (964)
```

Run: `cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --working-directory="$PWD" pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  145 passed (145)
Tests  1000 passed (1000)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each.** In the replay, 16 of 16 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | positions applied on `compiled` rather than on frames (spec §8) — `src/share-positions.ts`: `          if (step !== undefined && reply[leg].available) this.#deps.legOf(leg).pending = step` → `          if (step !== undefined && reply[leg].available) this.#deps.legOf(leg).hist.seek(step)` | `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts ; flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-positions.test.ts` | `tests/browser/share-positions.test.ts > a link's positions > clamps sum_to(5)'s λ step 5,000 to its last, 951, and says so with the open's undo`, `tests/browser/share-positions.test.ts > a link's positions > lands fact(4)'s λ step 1,387, which its continue's ring drops, on 1,388`, `tests/browser/share-positions.test.ts > a link's positions > reaches fact(4)'s λ step 3,000 after two continues, saying where it is going meanwhile`, `tests/browser/share-positions.test.ts > a link's positions > takes a leg from its link at a step gesture, and continues it no further`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > opens with λ going to step 17,000, and the declined TM leg’s position dropped`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 1 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 2 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 3 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 4 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 5 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 6 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 7 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 8 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 9 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > puts back the program the link replaced, on that undo`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > stops at 15,695 after the tenth, with no eleventh, and says so with the open's undo`, `tests/node/share-positions.test.ts > LinkPositions > clamps a position past a run that ended to its last step, and says so`, `tests/node/share-positions.test.ts > LinkPositions > continues a leg whose history filled, but not before the run's result`, `tests/node/share-positions.test.ts > LinkPositions > continues one leg at a time, λ then asm then TM`, `tests/node/share-positions.test.ts > LinkPositions > drops an earlier link's pending positions when a new link's are held`, `tests/node/share-positions.test.ts > LinkPositions > drops every position when the compile answers with no run, or the worker fails`, `tests/node/share-positions.test.ts > LinkPositions > gives each available leg its position once the link's compile says which exist, a declined leg's dropped`, `tests/node/share-positions.test.ts > LinkPositions > hears nothing with no link held, and nothing from a λ tree`, `tests/node/share-positions.test.ts > LinkPositions > lands a position the ring has already dropped on its oldest kept step`, `tests/node/share-positions.test.ts > LinkPositions > seeks to the position once the frames hold one past it, mid-recording, and later frames leave it there`, `tests/node/share-positions.test.ts > LinkPositions > stops a leg at its furthest step after 10 continues, says so, and asks the next leg` |
| 2 | an automatic continue that never posts (spec §8) — `src/share-positions.ts`: `        this.#deps.extend(leg) ⏎         return ⏎ ` → `        return ⏎ ` | `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts ; flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-positions.test.ts` | `tests/browser/share-positions.test.ts > a link's positions > lands fact(4)'s λ step 1,387, which its continue's ring drops, on 1,388`, `tests/browser/share-positions.test.ts > a link's positions > reaches fact(4)'s λ step 3,000 after two continues, saying where it is going meanwhile`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > opens with λ going to step 17,000, and the declined TM leg’s position dropped`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 1 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 2 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 3 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 4 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 5 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 6 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 7 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 8 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 9 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > puts back the program the link replaced, on that undo`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > stops at 15,695 after the tenth, with no eleventh, and says so with the open's undo`, `tests/node/share-positions.test.ts > LinkPositions > continues a leg whose history filled, but not before the run's result`, `tests/node/share-positions.test.ts > LinkPositions > continues one leg at a time, λ then asm then TM`, `tests/node/share-positions.test.ts > LinkPositions > stops a leg at its furthest step after 10 continues, says so, and asks the next leg` |
| 3 | the continue cap removed (spec §8) — `src/share-positions.ts`: `      if (this.#continues[leg] < MAX_LINK_CONTINUES) {` → `      if (true) {` | `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts ; flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-positions.test.ts` | `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > puts back the program the link replaced, on that undo`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > stops at 15,695 after the tenth, with no eleventh, and says so with the open's undo`, `tests/node/share-positions.test.ts > LinkPositions > stops a leg at its furthest step after 10 continues, says so, and asks the next leg` |
| 4 | a continue posted as soon as a leg's recording stops, before the run's result — `src/share-positions.ts`: `    if (state.done === null \|\| canRecordFurther(state.done, false)) return ⏎ ` → `    if (state.done === null) return ⏎     if (canRecordFurther(state.done, false)) { ⏎       this.#deps.extend(leg) ⏎       return ⏎     } ⏎ ` | `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts` | `tests/node/share-positions.test.ts > LinkPositions > continues a leg whose history filled, but not before the run's result`, `tests/node/share-positions.test.ts > LinkPositions > continues nothing while the program session awaits a run`, `tests/node/share-positions.test.ts > LinkPositions > continues one leg at a time, λ then asm then TM`, `tests/node/share-positions.test.ts > LinkPositions > stops a leg at its furthest step after 10 continues, says so, and asks the next leg` |
| 5 | every leg continued at once — `src/share-positions.ts`: `        this.#deps.extend(leg) ⏎         return ⏎ ` → `        this.#deps.extend(leg) ⏎ ` | `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts` | `tests/node/share-positions.test.ts > LinkPositions > continues a leg whose history filled, but not before the run's result`, `tests/node/share-positions.test.ts > LinkPositions > continues one leg at a time, λ then asm then TM`, `tests/node/share-positions.test.ts > LinkPositions > stops a leg at its furthest step after 10 continues, says so, and asks the next leg` |
| 6 | a position applied as the newest frame of a recording still going — `src/share-positions.ts`: `    if (newest > wanted \|\| (newest === wanted && state.done !== null)) {` → `    if (newest >= wanted) {` | `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts` | `tests/node/share-positions.test.ts > LinkPositions > seeks to the position once the frames hold one past it, mid-recording, and later frames leave it there` |
| 7 | a declined leg's position kept — `src/share-positions.ts`: `if (step !== undefined && reply[leg].available)` → `if (step !== undefined)` | `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts` | `tests/node/share-positions.test.ts > LinkPositions > gives each available leg its position once the link's compile says which exist, a declined leg's dropped` |
| 8 | a position past a run that ended, left pending — `src/share-positions.ts`: `    this.#stop(leg, wanted, 'ended') ⏎ ` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts ; flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-positions.test.ts` | `tests/browser/share-positions.test.ts > a link's positions > clamps sum_to(5)'s λ step 5,000 to its last, 951, and says so with the open's undo`, `tests/node/share-positions.test.ts > LinkPositions > clamps a position past a run that ended to its last step, and says so` |
| 9 | no repaint after a seek — `src/share-positions.ts`: `      delete state.pending ⏎       this.#deps.draw() ⏎       return ⏎ ` → `      delete state.pending ⏎       return ⏎ ` | `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts` | `tests/node/share-positions.test.ts > LinkPositions > seeks to the position once the frames hold one past it, mid-recording, and later frames leave it there` |
| 10 | a continue raised while a run is awaited — `src/share-positions.ts`: `!canRecordFurther(state.done, this.#deps.awaitingRun())` → `!canRecordFurther(state.done, false)` | `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts` | `tests/node/share-positions.test.ts > LinkPositions > continues nothing while the program session awaits a run` |
| 11 | a reply of another generation heard as the link's — `src/share-positions.ts`: `    if (reply.gen !== this.#gen) { ⏎       this.#drop() ⏎       return ⏎     } ⏎ ` → (deleted) | `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts` | `tests/node/share-positions.test.ts > LinkPositions > drops every position at a reply of another generation, whether held or pending` |
| 12 | a new link's hold keeping an earlier link's pending positions — `src/share-positions.ts`: `  hold(gen: number, positions: Positions): void { ⏎     this.#drop() ⏎ ` → `  hold(gen: number, positions: Positions): void { ⏎ ` | `cd web && pnpm exec vitest run --project node tests/node/share-positions.test.ts` | `tests/node/share-positions.test.ts > LinkPositions > drops an earlier link's pending positions when a new link's are held` |
| 13 | positions held for a compile before the open's — `src/main.ts`: `positions.hold(sessions.entryOf(SOURCE_SESSION).client.gen, opened.positions)` → `positions.hold(sessions.entryOf(SOURCE_SESSION).client.gen - 1, opened.positions)` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-positions.test.ts` | `tests/browser/share-positions.test.ts > a link's positions > clamps sum_to(5)'s λ step 5,000 to its last, 951, and says so with the open's undo`, `tests/browser/share-positions.test.ts > a link's positions > lands fact(4)'s λ step 1,387, which its continue's ring drops, on 1,388`, `tests/browser/share-positions.test.ts > a link's positions > reaches fact(4)'s λ step 3,000 after two continues, saying where it is going meanwhile`, `tests/browser/share-positions.test.ts > a link's positions > takes a leg from its link at a step gesture, and continues it no further`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > opens with λ going to step 17,000, and the declined TM leg’s position dropped`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 1 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 2 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 3 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 4 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 5 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 6 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 7 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 8 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 9 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > puts back the program the link replaced, on that undo`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > stops at 15,695 after the tenth, with no eleventh, and says so with the open's undo` |
| 14 | a notice about the open without its undo — `src/main.ts`: `notices.notify(text, offer === null ? {} : { action: offer.undo })` → `notices.notify(text)` | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-positions.test.ts` | `tests/browser/share-positions.test.ts > a link's positions > clamps sum_to(5)'s λ step 5,000 to its last, 951, and says so with the open's undo`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > puts back the program the link replaced, on that undo`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > stops at 15,695 after the tenth, with no eleventh, and says so with the open's undo` |
| 15 | a step gesture that leaves the position pending — `src/transport.ts`: `    delete leg.pending ⏎ ` → (deleted) | `cd web && flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-positions.test.ts` | `tests/browser/share-positions.test.ts > a link's positions > takes a leg from its link at a step gesture, and continues it no further`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > opens with λ going to step 17,000, and the declined TM leg’s position dropped`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 1 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 2 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 3 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 4 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 5 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 6 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 7 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 8 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 9 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > stops at 15,695 after the tenth, with no eleventh, and says so with the open's undo` |
| 16 | a step line that says nothing of where the leg is going — `src/controls.ts`: `    : v.pending !== null` → `    : false` | `cd web && pnpm exec vitest run --project node tests/node/controls.test.ts ; flock "$BROWSER_LOCK" pnpm exec vitest run --project browser tests/browser/share-positions.test.ts` | `tests/browser/share-positions.test.ts > a link's positions > reaches fact(4)'s λ step 3,000 after two continues, saying where it is going meanwhile`, `tests/browser/share-positions.test.ts > a link's positions > takes a leg from its link at a step gesture, and continues it no further`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > opens with λ going to step 17,000, and the declined TM leg’s position dropped`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 1 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 2 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 3 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 4 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 5 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 6 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 7 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 8 has recorded`, `tests/browser/share-positions.test.ts > fact(12)'s λ at 17,000 > posts the next continue once continue 9 has recorded`, `tests/node/controls.test.ts > controlState > says where a shared link's position is taking the leg, in place of how its recording stopped` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
A link's positions: held until the frames reach them, continued up to ten times one leg at a time, and clamped with the open's undo

A whole link's positions are held for the compile its open scheduled,
given to each leg its compile says exists, and applied as the frames
reach them (spec §5.4): the head goes to the step, mid-recording too,
once a frame past it has arrived or the recording has stopped on it.
A leg whose recording fills its history or spends its cap is
continued after the run's `result`, one leg at a time, λ then asm then
TM, at most ten times; one whose run ends short stays on its last step,
and so does one ten continues did not reach, each with a notice that
carries the open's `undo` for as long as it is offered (§5.5, row 16).
While a position is pending the leg's step line says where it is
going. A gesture on the leg's step controls takes the leg from the
link, and a recompile, another link and the undo drop every position.
````

---

### Task 5: Verification, the check by hand, and the roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` — the entry for this PR, appended at the end

**Nothing here changes code.** The web gates, the Docker image, a look at the app, and the entry.

- [ ] **Step 1: Run the gates**, one after another, and record each command and its exit code:
  - `cd web && pnpm exec biome ci --error-on-warnings`
  - `cd web && pnpm run typecheck`
  - `cd web && flock "$BROWSER_LOCK" systemd-run --user --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 --setenv=PATH="$PATH" --setenv=HOME="$HOME" --setenv=CARGO_HOME="$CARGO_HOME" --setenv=RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.local/share/rustup}" --working-directory="$PWD" pnpm run test:coverage` — the whole suite and its floors, statements 95, branches 89, functions 97, lines 97. **If it is OOM-killed** (`Finished with result: oom-kill`), run it again with `--setenv=VITEST_MAX_WORKERS=4` on the `systemd-run` under the same cap (the CLI's `--maxWorkers` limits only the node project), and record both runs, each `Memory peak` line and result.
  - `cd web && pnpm run build:app`
  - from the repository root, for each of `text-bytes citations attributions doc-figures shared-docs lua colours`: `scripts/check-<name>.sh --self-test`, then `scripts/check-<name>.sh`.
  - from the repository root, the Docker image, which no PR job builds: `/usr/sbin/docker build -t redextape-6a-ii .`, then `/usr/sbin/docker run -d -p 8099:80 redextape-6a-ii`; poll `/usr/sbin/docker inspect -f '{{.State.Health.Status}}' <id>` until it reads `healthy`, check `curl -s -o /dev/null -w '%{http_code}' http://localhost:8099/` prints `200`, then `/usr/sbin/docker rm -f <id>`.

  Expected: every one exits 0. **The replay's run of this step**, on its last commit, whose tree is the prototype's head: `biome ci`, `typecheck` and `build:app` exited 0; the seven hygiene scans, each `--self-test` and then alone, fourteen runs, exited 0; `test:coverage` under 16G passed with its default workers — 207 files, 1,964 tests, statements 97.47, branches 91.38, functions 98.27, lines 98.82, `Memory peak: 9.8G`; and the image built, came up `healthy`, answered `GET /` with `200`, and was removed. On the prototype's head the same coverage run passed with 1,964 tests at 97.48, 91.38, 98.34 and 98.84, peak 10.5G.

  **The Rust gates and `check-slow.sh` are not run, and the entry says why**: the branch touches no Rust and no wasm, so `check-all`'s Rust legs, `check-slow.sh` and the llvm-cov floor test the tree `main` already passed.

- [ ] **Step 2: Look at the app, by hand**, from `cd web && pnpm run dev`, in a browser profile with no storage for the dev server's origin: at 1280×800 and at a phone's width (390×844), in each preset (Explorer, Debugger, Stage), light and dark, with `share`'s popover open, and once with a copy on a view. Record: the field focused with its link selected, `copy link` and a copy by pointer and by keys, the copies line, the line past 2,000 characters; the popover inside the page with a `1rem` gutter at 390; a link pasted into the address bar of an open page and one opened in a new tab, each with its notice, its `undo` and the fragment gone from the address bar; `fact(4)` shared at λ step 3,000 and opened, the step line saying where it is going, then at 3,000. A finding goes to the whole-branch review, not into this task. **The prototype's look, before this plan:** at 1280×800 in Explorer, light, with a copy on the λ view, the popover ran from x = 537.4 to x = 1049.4 under `share`, its right edge on the button's, with the field's link selected, `copy link` under it and the copies line under that; at 390×844, dark, from x = 16 to x = 374, with the page's scroll width 390.

- [ ] **Step 3: Write the roadmap entry.** Read the roadmap's last two entries first and match their shape. Append it at the end: a heading `` #### PLAN 7 PART 6a-ii, SHARE LINKS: … (2026-09-30, branch `plan7-part6a-ii-share-links`, `f303fb9..<last code commit>`, N commits, plus this entry) ``, where the range excludes the entry's own commit and N counts every commit in it, the spec's two amendments and this plan's included; `##### ` sections in the entry's own voice — what it built, what the prototype and the replay found (this plan's two lists and its table of what the spec left to it), what the reviews found; `##### WHAT THIS DID NOT CLOSE`; and `##### VERIFICATION`, ending with a table headed **Every count this entry quotes, with what produces it**, one row per figure, each naming the command that produces it, **every one of them run before the entry is committed**. What it did not close includes, at least: `aria-haspopup="menu"` on `share`, a decision the spec did not make; two `hashchange`s whose decodes overlap, which can open out of order; the page scrolling sideways at 320px in Debugger and Stage, outside this lane; the header's fourth row at 390px with a copy in Instrument's Explorer and Debugger and Paper's Debugger, which predates `share`; and the Rust gates and `check-slow.sh`, not run, with the reason above. Write it last, after the final code commit, so no fix makes its range or its figures stale.

- [ ] **Step 4: Commit the entry**, as the last commit before the PR opens:

````text
Roadmap: Plan 7 part 6a-ii — share links
````
