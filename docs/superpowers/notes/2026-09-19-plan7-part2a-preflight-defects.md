# Pre-flight defect log — Plan 7 part 2a (`docs/superpowers/plans/2026-09-19-plan7-part2a-view-chrome.md`)

Worktree: `/home/davey/projects/redextape/.claude/worktrees/agent-a704ac0b2fda5e58f`, branch `preflight-2a`, from `04050bb`.

Setup note (not a plan defect): the worktree was created at `main` (`13db3b7`), not at the plan branch; `git reset --hard 04050bb` put it on the plan commit before any work. `pnpm install` + `build:wasm:dev` succeeded.

## Task 1 — workspace state, `insertBeside`

Commit `c5c2d00`. Tests: node `workspace.test.ts` + `layout.test.ts` 67/67; the six Step 12 browser files 43/43 (after fixes 1.4, 1.5); whole node tier 498/498; whole browser tier (not asked by the plan, run to catch regressions) 55 files / 328 tests pass; `pnpm run typecheck` exit 0.
Sabotages: (1) v1 branch → `PRESETS.stage`: red in `workspace.test.ts` "migrates a version 1 layout…" and `layout-restore.test.ts` "rewrites the migrated layout…" — as predicted. (2) `{}` in the creation pass: red in "opens the TM view with its rules panel closed" (`expected 'true' to be 'false'`) — as predicted, plus "records a panel toggle…" also red. (3) `focused: ws.focused`: red in "drops the panel state of a leaf that has left the tree, and a focus on one" (`expected 'pane-9' to be 'lambda-0'`) — as predicted.

### 1.1 — Task 1, Step 5: `workspace.ts`'s `SPEEDS` doc cites `` `player.ts`'s `advance` ``
- **What went wrong** — the commit is refused by the attribution gate: `web/src/workspace.ts:29: cites \`player.ts\`, which is not a tracked file` (`player.ts` is Task 2's). The plan's own Global Constraints forbid a citation landing before its symbol.
- **The fix** — Task 1 writes the sentence without the citation: `Up to 60 the player takes at most one step per animation frame; above it, several per frame.` (Task 2 may add `` — `player.ts`'s `advance` is the arithmetic `` back in the commit that creates `player.ts`.)
- **Severity** — blocks.

### 1.2 — Task 1, Step 10: the new `layout-restore.test.ts` test is appended "after its existing ones"
- **What went wrong** — `AssertionError: expected { kind: 'split', dir: 'column', …(2) } to deeply equal { kind: 'split', dir: 'column', …(2) }`. The file's second test ("splits into a fresh id…") splits `lambda-0`, so by the time the appended test runs the stored tree also holds `pane-2` and is no longer `STORED`'s tree.
- **The fix** — put the test directly after "mounts the stored arrangement…", before the split, with a one-line comment saying why it must precede the split.
- **Severity** — wrong.

### 1.3 — Task 1, Step 11: `workspace-restore.test.ts` "records which view has focus" focuses `[data-leaf="lambda-0"] button:not([disabled])`
- **What went wrong** — `AssertionError: expected 'tm-0' to be 'lambda-0'`. At Task 1 the first enabled button in the λ view is the text panel's toggle, and `textPanel`'s element is `hidden` until an editor mounts, so `.focus()` is a silent no-op and no `focusin` fires. (From Task 3 on the title button comes first and the plan's selector would work — but Task 1 must pass on its own.)
- **The fix** — `document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .controls button:not([disabled])')?.focus()` (`.controls` survives Task 5: `stepControls` keeps the class).
- **Severity** — wrong.

### 1.4 — Task 1, Step 4: the paragraph added to `splitLeaf`'s doc says "**ITS LAST THREE REFUSALS ARE `insertBeside`'s**"
- **What went wrong** — `splitLeaf` keeps two refusals itself (not in the tree; the source leaf as subject) and delegates two (a second source leaf; a duplicate id). "Last three" includes the source-subject refusal, which is exactly the one `insertBeside` lacks.
- **The fix** — "**ITS LAST TWO REFUSALS ARE `insertBeside`'s**, to which it delegates once the subject passes; …"
- **Severity** — wrong (prose).

### 1.5 — Task 1, Step 1 / Step 14: plan code is not Biome-clean
- **What went wrong** — `biome ci --error-on-warnings`: `tests/node/workspace.test.ts:3:1 assist/source/organizeImports` (`type Switches` must sort before `serializeWorkspace`) and `format` (three `it.each` rows and one `const ws = {…}` over the line width). Dropping `parseLayout`/`serializeLayout` from the multi-line imports in `main.ts` and `pane-host.ts` also leaves them short enough that the formatter collapses them to one line.
- **The fix** — `pnpm exec biome check --write` on the three files (the Global Constraints already name this remedy). The plan's import list should read `…, SPEEDS, type Switches, serializeWorkspace, WORKSPACE_VERSION, withPanel`.
- **Severity** — wrong (auto-fixable).

### 1.6 — Task 1, Step 7: "Add one sentence to the constructor's doc comment"
- **What went wrong** — `TmPane`'s constructor has no doc comment.
- **The fix** — created one holding the sentence.
- **Severity** — unclear.

### 1.7 — Task 1, Steps 8–9: stale prose the plan does not list
- `web/src/buffers-store.ts`'s module doc says `applyLayout` ends in `writeLayoutStorage(serializeLayout(getTree()))`; `web/tests/browser/layout-restore.test.ts`'s module doc says `main()` resolves its tree with `parseLayout(readLayoutStorage()) ?? defaultLayout()`. Neither trips a gate (both symbols still exist), both describe code that changed. Fixed both (`persist()`, which writes the workspace; `parseWorkspace(readLayoutStorage()) ?? defaultWorkspace()`). `layout-app.test.ts`'s "NO FALLS BACK ON GARBAGE" comment also names the old `parseLayout(...) ?? defaultLayout()` expression — left, noted.
- Step 8 item 7 names two doc sites ("the module doc's list" and "`createPaneHost`'s doc paragraph") that are the same doc (`createPaneHost`'s); the `PaneHost` doc and the `applyLayout` `finally` comment also name `writeLayoutStorage`, in the past tense, and were left.
- **Severity** — unclear.

## Task 2 — the player

Commit `39810d9`. Tests: the five Step 7 node files 117/117; whole node tier 506/506; the four Step 7 browser files 30/30; whole browser tier 55 files / 328 tests; typecheck exit 0 (after 2.1).
Sabotages, all red as predicted: (1) `carry: 0` → "totals floor(speed × elapsed)…" (`expected 0 to be greater than or equal to 1`); (2) no `if (!leg.playing)` → "lets go of a leg whose flag something else cleared" (`expected 6 to be +0`); (3) `resetLegs` without `leg.playing = false` → sessions' "clears every leg … and stops its playback" and scratch's "stops the retired buffer's playback…" (`expected true to be false`).

### 2.1 — Task 2, Step 6: the fixture list misses two `ControlState` literals
- **What went wrong** — `pnpm run typecheck`: `tests/browser/lambda-pane-editor.test.ts(105,32): error TS2741: Property 'playing' is missing in type '{ canRestart: boolean; … }' but required in type 'ControlState'`, and eight more in `tests/browser/tm-pane-editor.test.ts`. Both files declare `const CONTROLS = { canRestart, canBack, canForward, canPlay, stepText, continueLabel }` and pass it to `pane.render`. The hook's typecheck refuses the commit.
- **The fix** — add `playing: false,` to both `CONTROLS` fixtures. The plan's Files list and Step 6 should name `tests/browser/lambda-pane-editor.test.ts` and `tests/browser/tm-pane-editor.test.ts` (found with `grep -rn "canRestart" tests | grep -v "\.canRestart"`).
- **Severity** — blocks.

### 2.2 — Task 2, Step 6: the citation grep finds three gate failures the plan does not name
- **What went wrong** — `grep -rn 'LegState.timer\|PLAY_MS\|leg\.timer\|play timer' src tests` hits files the plan never lists. Three are attribution-gate failures (confirmed by restoring the old text: `web/src/state-table.ts:127: cites \`transport.ts\` for \`PLAY_MS\``, `web/tests/browser/buffer-affordability.test.ts:84` and `:490: cites \`sessions.ts\` for \`LegState.timer\``); the rest are stale prose: `src/session-client.ts` ("its play timer", "drag `History` and `setInterval`"), `src/scratch.ts` (a buffer's entry "holds … a play timer"; two "a replaced entry strands a running `setInterval`"), `tests/node/sessions.test.ts` ("play timer would be stranded"), `tests/browser/running-focus.test.ts` ("`play()` is a `setInterval`", "`PLAY_MS`'s 120 ms", "its own interval tick"), and `src/sessions.ts`'s `add` and `rebind` docs, which the grep does not catch ("strand a running `setInterval`", "parking its timer", "clears its own timer").
- **The fix** — reworded each to the player (`player.ts`'s `createPlayer`, `LegState.playing`, "its playback"). The plan's instruction ("update them in this commit") is right; the gap is that it names none of these files, and the grep does not catch `sessions.ts`'s own docs.
- **Severity** — unclear (the plan says to do it; the gate enforces three of them).

### 2.3 — Task 2, Step 6: the test names to reword do not exist
- **What went wrong** — the plan says reword the two tests "from 'clears its play timer' to 'stops its playback'". They are already named "clears every leg the session has and stops its playback" and "stops the retired buffer's playback rather than stranding it". What needed rewording was `scratch.test.ts`'s doc ("A RETIRED SESSION'S PLAY TIMER MUST NOT SURVIVE IT … A REAL TIMER, NOT A SPY"), which argues for a real `setInterval` that no longer exists.
- **The fix** — rewrote that doc around the flag the player follows.
- **Severity** — unclear.

### 2.4 — Task 2 (follow-up to 1.1)
- Restored `` — `player.ts`'s `advance` is the arithmetic `` in `workspace.ts`'s `SPEEDS` doc in this commit, now that `player.ts` exists.

## Task 3 — the view header

Commit `b7c4b9d`. Tests: `view-header.test.ts` 7/7; whole browser tier 56 files / 335 tests; whole node tier 506/506; typecheck exit 0. The plan's Step 7 grep prints nothing.
Sabotages: (1) no rendered-key early return — **did NOT go red in `view-header.test.ts` as written** (see 3.3); it went red only in the ported `view-title.test.ts` "does not rebuild when nothing changed, so an open menu survives a frame" (`expected false to be true`). After fix 3.3, red in `view-header.test.ts` too. (2) status left out of the heading — red as predicted: `view-header.test.ts`'s status test and all five `view-status.test.ts` tests. (3) no `aria-current` — red as predicted ("opens a menu of every pair…").

### 3.1 — Task 3, Step 3: `bindingKey` joins with a NUL escape, and every test then selects on it with CSS — DESIGN-LEVEL
- **What went wrong** — `Error: the view offers no "lambda\0lambda-scratch" — offered: ["lambda\0source","lambda\0lambda-scratch"]`. The item is there; the selector cannot match it. CSS replaces U+0000 with U+FFFD when it parses a selector (and `CSS.escape` does the same to a NUL), so `button[data-binding="${key}"]` can never match a key holding a NUL. Every plan helper that finds an item by key breaks: Step 7's `pickBinding`, Task 4's `splitVia`, Task 10's `layout-notices.test.ts`, and any `#menu button[data-binding=…]` lookup. `view-header.test.ts` passes only because it reads `dataset.binding` rather than selecting on it.
- **The fix** — a CSS-safe separator, with the doc rewritten to say why:
  ```ts
  /**
   * The key a pair travels under — the menu items' `data-binding`, and the title's, which is what tests pick
   * and read by.
   *
   * **`:`, NOT THE NUL ESCAPE THE OLD `<option>` VALUES USED, BECAUSE THIS KEY IS MATCHED BY A CSS SELECTOR.**
   * CSS replaces U+0000 with U+FFFD when it parses a selector (and `CSS.escape` does the same), so a
   * `button[data-binding="…"]` naming a NUL can never match the attribute it names. A leg never
   * contains `:` and comes first, so the first `:` splits the key exactly whatever the session id holds.
   */
  export function bindingKey(leg: Leg, session: SessionId): string {
    return `${leg}:${session}`
  }
  ```
  The Step 7 table's "filtered with `.startsWith('lambda` + NUL + `')`" becomes `.startsWith('lambda:')`.
- **Severity** — blocks.

### 3.2 — Task 3, Step 1: "opens a menu of every pair" passes the options in an order `pairs()` never produces
- **What went wrong** — `AssertionError: expected [ 'λ · program', 'TM · program', …(1) ] to deeply equal [ 'λ · program', 'λ · copy 1', …(1) ]`. `setBindings([PROGRAM_λ, PROGRAM_TM, COPY], …)` and then expects the menu λ-grouped; `viewHeader` keeps the order it is given (correctly — `SessionRegistry.pairs()` already groups by leg).
- **The fix** — pass the fixture in `pairs()` order: `h.setBindings([PROGRAM_λ, COPY, PROGRAM_TM], { leg: 'lambda', session: 'source' })` (comment: "In `pairs()` order, which groups by leg"). The expectations are unchanged.
- **Severity** — wrong.

### 3.3 — Task 3, Step 1 / Step 9 sabotage 1: "does not rebuild on a repeat update" cannot fail
- **What went wrong** — the test compares `button.view-title` identity before and after, but `paint` re-inserts the same button object every time, so dropping the rendered-key guard leaves the test green. What a rebuild actually costs is the menu: `paint` calls `menu.remove()`, which closes an open popover.
- **The fix**:
  ```ts
  it('does not rebuild on a repeat update, so an open menu survives a frame', () => {
    const h = mount()
    h.setBindings([PROGRAM_λ, PROGRAM_TM], { leg: 'lambda', session: 'source' })
    const before = h.el.querySelector<HTMLButtonElement>('button.view-title')
    // OPEN, BECAUSE THE BUTTON'S IDENTITY ALONE CANNOT FAIL: `paint` re-inserts the same element. What a
    // rebuild costs is the menu, which `paint` takes out of the DOM — and a popover removed is closed.
    before?.click()
    const menu = document.querySelector('.view-title-menu')
    expect(menu?.matches(':popover-open')).toBe(true)
    h.setBindings([PROGRAM_λ, PROGRAM_TM], { leg: 'lambda', session: 'source' })
    expect(h.el.querySelector('button.view-title')).toBe(before)
    expect(menu?.matches(':popover-open')).toBe(true)
  })
  ```
  With this, sabotage 1 is red in `view-header.test.ts`.
- **Severity** — wrong (a sabotage that does not fire).

### 3.4 — Task 3, Step 5: `.view-steps .controls` is placed before `.controls`
- **What went wrong** — `biome ci --error-on-warnings`: `src/style.css:538:1 lint/style/noDescendingSpecificity … This selector specificity is (0, 1, 0)` for `.controls`, below `.view-steps .controls` (0, 2, 0), which the plan puts right after `.pane h2`.
- **The fix** — take `.view-steps .controls { margin-top: 0; }` out of the Step 5 block and put it after `.controls .step`, with a comment saying why it sits there.
- **Severity** — wrong (red gate; the hook would refuse the commit).

### 3.5 — Task 3, Step 5: the `.view-status` CSS comment names `tests/browser/detached-badge.test.ts`
- **What went wrong** — Step 7 of the same task renames that file to `view-status.test.ts`.
- **The fix** — the comment names `tests/browser/view-status.test.ts`.
- **Severity** — wrong (stale reference, no gate).

### 3.6 — Task 3, Step 1: `view-header.test.ts`'s imports are unsorted
- `import type … from '../../src/sessions'` before `'../../src/protocol'` → `assist/source/organizeImports`. Auto-fixable.
- **Severity** — wrong (auto-fixable).

### 3.7 — Task 3, Step 7: the inventory misses vacuous negatives on the badge's CLASS and a `/detached/i` regex
- **What went wrong** — the plan's grep (`pane-binding\|optionValue\|'h2'\|\[detached\]\|· source (same)`) and its file list miss:
  - `buffer-restore-invalid.test.ts` (not in the plan's list at all): `expect(document.querySelector('[data-leaf="lambda-0"] .detached-badge')).toBeNull()`, which **passes vacuously** after the rename;
  - `buffer-restore.test.ts`: the same on `tm-0`; `tm-buffer-restore.test.ts`: the same on `lambda-0` — both vacuous;
  - `tm-scratch-fork.test.ts` (×2) and `tm-buffer-restore.test.ts`: `toMatch(/detached/i)` on the TM view's text — red (`expected 'TM · TM scratch 1copy · not linked↺◀▶…' to match /detached/i`);
  - `tm-buffer-restore.test.ts`'s `detachedWithNoEditorYet` predicate `/detached/i.test(pane.textContent)`, which silently becomes always-false and weakens that file's `settled()` wait without failing anything.
- **The fix** — `.detached-badge` → `.view-status`, each with a positive `.view-title` text check beside it (`'λ · program'` / `'TM · program'`); `/detached/i` → `/copy · not linked/`. Add `\.detached-badge\|/detached/` to the Step 7 grep.
- **Severity** — wrong.

### 3.8 — Task 3, Step 7: split-menu items without `(same)` also change
- The program's label is `program` now, so every split-menu item naming it changes too, not only the `(same)` ones: `pickSplit(…, 'TM · source')` / `'λ · source'` (in `pane-picker.test.ts` ×4, `tm-pane-follows-session.test.ts` ×3) → `'TM · program'` / `'λ · program'`. `pane-layout-controls.test.ts`'s fixture labels were `'source'` and its expectations `'λ · source (same)'`/`'TM · source'`; the Step 7 grep demands none remain, so the fixture labels became `'program'`.
- **Severity** — unclear.

### 3.9 — Task 3, Step 7: `view-status.test.ts` cannot reach `'λ · program'` as the table says
- The views are built directly and never get `setBindings`, so the heading is empty (`viewHeader` paints only from a setter). Each test needs `pane.setBindings([{ leg, id: 'source', label: 'program' }], { leg, session: 'source' })` before its first read. The helper that counts badges becomes a count of `h2 .view-status` elements.
- **Severity** — unclear.

### 3.10 — Task 3, Step 7: every file has its own helpers, and the patterns table does not cover them
- Beyond the patterns in the table, files carry their own `pick`, `pickBinding(pane, target)`, `rebind`, `bufferOption`, `lambdaOptions`/`lambdaOptionElements`, `boundBufferOptionOf`, `paneBindings`, `bringTmPaneHome` and `select.value = X; select.dispatchEvent(...)` blocks (six in `two-lambda-panes.test.ts`, with three different leaves behind one variable name `sel`). Each needed porting by hand. Two traps: (a) an option's text was the bare label (`λ scratch 1`); a menu item's is `λ · λ scratch 1`, so assertions that reused it as the header list's row name (`scratch-buffers.test.ts`: `${label} — orphan`, `retire ${label}`) need the prefix stripped; (b) a `not.toContain(label)` over item TEXT becomes vacuous for the same reason (`scratch-buffers.test.ts`'s "removes it from every pane's selector") — compare keys instead.
- **Severity** — unclear.

### 3.11 — Task 3, Step 4: the `detachedBadge\|paneSelect` grep expects only test hits; `src` has about twenty
- `pane-chrome.ts` ×9, `lambda-pane.ts` ×4, `style.css` ×4, `sessions.ts` ×3, `main.ts`, `pane-host.ts`, `transport.ts`, and the plan's own `view-header.ts` ("THE RENDERED KEY, AS `paneSelect` KEPT ONE"). One is an attribution-gate failure: `web/src/sessions.ts:495: cites \`pane-chrome.ts\` for \`paneSelect\``. Also stale after the renames: references to `binding-selector.test.ts`/`detached-badge.test.ts` in `main.ts`, `pane-chrome.ts`, `lambda-pane-editor.test.ts`, `layout-app.test.ts`, `scratch-rebind-editor.test.ts`, `editor-custody.test.ts`, `two-lambda-panes.test.ts`, `pane-layout-controls.test.ts`, `tests/node/sessions.test.ts`, `tests/node/link-status.test.ts`.
- Step 4's last bullet says `focusPane`'s doc names the binding selector anchored to the `<h2>`; that sentence is in `paneEvents.rebind`'s comment in `pane-host.ts`, not `focusPane`'s doc.
- **Severity** — unclear.

### 3.12 — Task 3, Step 1: the status test's name claims a carrier it does not check
- "says "copy · not linked" while detached, **with a non-colour carrier**, and is removed when not" asserts only text; the carrier is `view-status.test.ts`'s job. Rename it or drop the clause.
- **Severity** — wrong (minor).

### 3.13 — Carried forward to Task 9
- `scratch-app.test.ts`'s STAGE 5 `expect(statusLine()).not.toContain('detached')` passes vacuously once Task 9 rewords the link sentence to "λ view shows a copy — not linked to the program". Task 9's list should name it.

## Task 4 — the `⋯` menu and `✕`

Commit `6f8b5c2`. Tests: `view-menu.test.ts` 10/10 (6 plan tests, 3 ported placement tests, 1 moved icon test); whole browser tier 56 files / 324 tests; whole node tier green; typecheck exit 0.
Sabotages: (1) `⋯` kept when `wanted` is empty — **did NOT go red as written** (see 4.4); red after the fix. (2) own pair last — red in `view-menu.test.ts`'s "asks which view to split into…" as predicted, **but NOT in `pane-picker.test.ts`** (see 4.5). (3) TM `#refreshDetach` sends `null` — red in `tm-scratch-fork.test.ts`'s over-the-cap test (`expected undefined to be true`) as predicted, but only after fix 4.7; before it that test was already red for another reason.

### 4.1 — Task 4, Step 5: "delete `button`" breaks `controlStrip`, which stays until Task 5
- **What went wrong** — `pane-chrome.ts`'s `controlStrip` builds `↺ ◀ ▶ ⏵` and continue with `button(...)`; deleting `button` in Task 4 leaves `controlStrip` calling an undefined function (TS2304), and the hook's typecheck refuses the commit.
- **The fix** — keep `button` in Task 4; delete it in Task 5 with `controlStrip`. Task 4's Files line and Step 5 list should drop `button`; Task 5's Step 3 should add it.
- **Severity** — blocks.

### 4.2 — Task 4, Step 5: deleting `claimEditorButton` leaves `icon` imported and unused in `pane-chrome.ts`
- `biome ci --error-on-warnings`: `src/pane-chrome.ts:2:8 lint/correctness/noUnusedImports`. Step 5 should say to drop `import { icon } from './icons'`.
- **Severity** — wrong.

### 4.3 — Task 4, Step 2: the placement block cannot be ported "changing only the selectors"
- **What went wrong** — `AssertionError: expected 196.5 to be less than 2`. The split picker was `position-area: block-end span-inline-end` and shared its button's LEADING edge; the plan's `.view-menu` is `span-inline-start` ("opens leftward from `⋯`") and shares the TRAILING edge. The "one place per control" test needs a second view menu (a view has one `⋯`, not two split buttons), and a fixture at `x = 420` sits past the 414px-wide tester page: `expected 447.5 to be less than or equal to 414`.
- **The fix** — assert `Math.abs(menu.right - button.right) < 2` and `menu.right > 100` in the first test and the right edges in the bottom-edge flip test; build two `viewMenu`s at `x = 200` and `x = 330` for "gives each view menu its own place". The block's opening doc should name `span-inline-start` as the reason the edge changed.
- **Severity** — wrong.

### 4.4 — Task 4, Step 2 / Step 9 sabotage 1: "offers only what applies" cannot fail against its sabotage
- **What went wrong** — every `ViewMenu` setter returns early when handed the state it already holds, and the initial state is all-false, so the test's first `menu.setLayout(false, false)` never runs `sync` and `⋯` was never mounted. Keeping `⋯` mounted when `wanted` is empty leaves the test green.
- **The fix** — end the test by going back to nothing:
  ```ts
    // AND BACK TO NOTHING — the first assertion above cannot fail on its own: every setter returns early
    // on the state it already holds, so a menu that has never had an item has never been synced at all.
    menu.setLayout(false, false)
    menu.setClaim(false)
    expect(more(actions)).toBeNull()
    expect(actions.querySelector('button.view-close')).toBeNull()
  ```
  With it, sabotage 1 is red.
- **Severity** — wrong (a sabotage that does not fire).

### 4.5 — Task 4, Step 9 sabotage 2 predicts a red that cannot come
- It predicts `pane-picker.test.ts`'s "duplicate-first test" red. After Step 6 no such test exists: the plan's own `splitVia` picks `button[data-same]` by attribute, so item order is invisible to every app-level test. Only `view-menu.test.ts`'s "asks which view to split into…" pins the order. Drop that half of the prediction, or add an order assertion to `pane-picker.test.ts`.
- **Severity** — wrong.

### 4.6 — Task 4, Step 6: the patterns table misses `.controls .detach` — the fork left the strip
- **What went wrong** — `Error: timed out after … waiting for the fork to mount an editor` (4×), `Error: the λ pane should offer a fork on a settled, attached pane`, `expected exactly one scratch buffer in the λ group, found 0`. 32 sites in 8 files select the fork as `.controls .detach` (every `forkButton()` helper included): `active-pane`, `pane-kind-switch`, `pane-picker`, `scratch-app`, `scratch-cap`, `scratch-fork`, `scratch-rebind-editor`, `two-lambda-panes`. `button.detach` now lives in `.view-menu`, not `.controls`.
- **The fix** — a table row: `.controls .detach` → `button.detach` (or `.view-menu button.detach`). A closed popover's item still takes `.click()`, as the DOM contract says.
- **Severity** — wrong.

### 4.7 — Task 4, Step 6: `tm-scratch-fork.test.ts` reads the refusal from `title`
- **What went wrong** — "disables it with a count on a machine over the cap" asserts `button?.title` matches `/94,?182/`: `AssertionError: expected '' to match /94,?182/`. The old `detachButton` put the reason in `title`; `viewMenu` puts it in `aria-description` and the `.view-menu-hint` line. The file is not in the Step 6 inventory, and sabotage 3 depends on this test.
- **The fix**:
  ```ts
    expect(button?.disabled).toBe(true)
    expect(button?.getAttribute('aria-description')).toMatch(/94,?182/)
    expect(button?.querySelector('.view-menu-hint')?.textContent).toMatch(/94,?182/)
  ```
- **Severity** — wrong.

### 4.8 — Task 4, Step 6: `layout-app.test.ts` parks focus on an item inside a closed popover
- **What went wrong** — "splitting a pane moves focus into the pane it created" focuses `splitRowOn('lambda-0')` first, to prove the rescue ran. That now names `button.view-split` inside the closed `.view-menu`, where `.focus()` is a silent no-op: `AssertionError: expected <button …> to be <button …>`.
- **The fix** — park focus on `[data-leaf="lambda-0"] button.view-more`. `pane-picker.test.ts`'s "puts focus in the source pane…" needs the same (it focused `split top and bottom`).
- **Severity** — wrong.

### 4.9 — Task 4, Step 6: the inventory and the "must print nothing" grep
- The grep's `pane-picker` pattern also matches the file name `pane-picker.test.ts`, which the plan keeps and which seven comments cite (`active-pane`, `layout-app`, `pane-kind-switch`, `tm-reduced-buffer`, `pane-picker` itself, `tests/node/replies.test.ts` ×2), so the grep can never print nothing. Use `\.pane-picker` (the class) instead.
- Files the grep hits that the inventory omits: `buffer-cool-warm.test.ts` — **code**, `clickLambda('✎ fork')`, which fails (`no \`✎ fork\` button in the λ pane`); and comments in `buffer-list.test.ts`, `tm-blank-buffer-cap.test.ts`, `tests/node/replies.test.ts`, `tests/node/sessions.test.ts`. Also missed: `tm-scratch-fork.test.ts` (4.7).
- The helpers to port are per file, as in Task 3: `splitSame(leaf, control)` (active-pane, pane-kind-switch, two-lambda-panes), `pickSplit(leaf, control, item)` (pane-picker, tm-reduced-buffer), `splitRow`/`splitRowOn` (layout-app, layout-restore), `split(id, item)` (tm-pane-follows-session), `labels(leaf, control)` (pane-picker), and hand-rolled split-menu walks (scratch-rebind-editor). Porting them leaves unused `clickLambda` (buffer-cool-warm, scratch-buffers, scratch-edit), `btn` (pane-kind-switch), `splitRowOn` (layout-restore) and an unused `label` parameter (tm-pane-follows-session's `panesOnBuffer`); Biome flags each (`noUnusedVariables`, `noUnusedFunctionParameters`).
- **Severity** — unclear.

### 4.10 — Task 4, Step 5: the deleted controls are cited all over `src`, eleven times at the gate
- The Step 5 grep expects `controlStrip` only. The attribution gate after the deletions: `web/src/buffer-list.ts:102`, `:206`, `:257`, `web/src/sessions.ts:505`, `web/tests/browser/layout-app.test.ts:43`, `web/tests/browser/two-lambda-panes.test.ts:44` cite `pane-chrome.ts` for `splitControl`; `web/src/scratch.ts:454`, `web/src/transport.ts:246`, `web/tests/browser/scratch-cap.test.ts:14`, `web/tests/browser/tm-scratch-fork.test.ts:250` for `detachButton`; `web/src/scratch-editor.ts:88` for `layoutControls` — 11 violations. About twenty more bare mentions in `src` docs (`pane-chrome.ts`, `pane-host.ts`, `sessions.ts`, `editor-custody.ts`, `buffer-list.ts`, `controls.ts`, `transport.ts`, `lambda-pane.ts`, `tm-pane.ts`, `main.ts`). The plan's own `view-header.ts` code (Task 3) cites "`pane-chrome.ts`'s old `pickerSeq` reason" and "`splitControl`'s reason/rule" (three sites) — both symbols deleted here.
- **The fix** — repoint to `` `view-header.ts`'s `viewMenu` `` (the gate passes after that); write the Task 3 `view-header.ts` comments against `viewMenu`/"the split picker" from the start.
- **Severity** — unclear (the plan says to update citations; it underestimates the count by an order of magnitude, and the plan's own code carries three).

### 4.11 — Task 4, Step 7: deleting `.pane-picker`'s comments orphans two pointers
- `.buffer-list`'s comments point at "`.pane-picker`'s `@supports` block above", which "states this in full"; the plan carries the positioning comment to `.view-menu` but deletes the `@supports` block's own comment. `.view-title-menu`'s comment (Task 3) points at `.pane-picker`'s comment too.
- **The fix** — carry the `@supports` comment over to `.view-menu`'s `@supports` block as well, and repoint `.buffer-list` and `.view-title-menu` to `.view-menu`.
- **Severity** — unclear.

### 4.12 — Task 4, Step 1: who passes `strokeWidth`?
- "set it per path if `icon()` needs a parameter — add an optional `strokeWidth` argument defaulting to `'1.5'`" — but `viewMenu` calls `icon('more')` with no second argument, so a default of `'1.5'` never draws `more` at 2. Implemented as a per-name default: `const STROKE: Partial<Record<IconName, string>> = { more: '2' }` and `strokeWidth = STROKE[name] ?? '1.5'`.
- **Severity** — unclear.

## Task 5 — one step-control component

Commit `c54c33a`. Tests: `step-controls.test.ts` 4/4; `running-focus.test.ts` 7/7 (after 5.1); whole browser tier 57 files / 328 tests; whole node tier 506/506; typecheck exit 0. The plan-supplied `step-controls.ts` and its test were Biome-clean as written.
Sabotages, both red as predicted: (1) `paintPlay` always `play` → `step-controls.test.ts` "shows ⏸ and is named pause while playing…" and `running-focus.test.ts`'s new assertion; (2) no `speed.value` write → "offers the speed ladder, shows the one in force…" (`expected '1' to be '8'`).

### 5.1 — Task 5, Step 5 (root cause in Task 2, Step 5): toggling play never draws — DESIGN-LEVEL
- **What went wrong** — the assertion the plan adds right after `clickByName('play')` fails: `AssertionError: expected 'play' to be 'pause'`. `player.ts`'s `tick` draws only when a step was taken, and Task 2's `transport.ts` `play` is just `player.toggle(leg)`. So after a click the button keeps saying `play` until the first step lands (~125 ms at 8/s, a full second at 1/s), and — worse — a **pause** takes no step at all, so after the click that paused, the button goes on showing `⏸`/`pause` until something unrelated draws. That breaks the spec §8 / umbrella rule 3 claim the whole control exists for ("play shows its state").
- **The fix** — `transport.ts`'s `play` draws after the toggle:
  ```ts
  /**
   * …
   * **IT DRAWS, BECAUSE THE PLAYER ONLY DRAWS WHEN A STEP IS TAKEN.** The play button shows `⏸` from
   * `LegState.playing`, and the first step at 8/s is ~125 ms away (a full second at 1/s); a pause takes no
   * step at all, so without this the button would go on saying `pause` after the click that paused it.
   */
  const play = <T>(leg: LegState<T>) => {
    player.toggle(leg)
    draw()
  }
  ```
  Put it in Task 2 Step 5, where `play` is rewritten; the Task 5 assertion then holds it (removing the `draw()` turns it red — observed before the fix). A pause-side assertion (click again, expect `play`) would pin the other half.
- **Severity** — blocks (the plan's own new assertion cannot pass).

### 5.2 — Task 5, Step 4: `grep -rln "back: () =>" tests` finds half the `PaneEvents` literals
- **What went wrong** — `pnpm run typecheck`: `TS2739 … is missing the following properties from type 'PaneEvents': speed, setSpeed` in `tests/browser/lambda-pane-editor.test.ts`, `tm-pane-editor.test.ts`, `tm-pane-follows-session.test.ts` (all `back: vi.fn()`) and `view-status.test.ts` (`back: noop`), besides the four the grep finds (`view-title`, `scratch-fork` ×2, `editor-custody`).
- **The fix** — grep `extend:` instead (it finds every literal), or let the typecheck list them; add `speed: () => 8, setSpeed: …` to each.
- **Severity** — wrong (the hook's typecheck refuses the commit until all eight are fixed).

### 5.3 — Task 5, Step 3: delete `button` and the `ControlState` import with `controlStrip`
- Follows from 4.1: `button` survives Task 4 and goes here; `pane-chrome.ts`'s `import type { ControlState } from './controls'` is unused once `controlStrip` is gone.
- **Severity** — unclear.

### 5.4 — Task 5: prose naming `controlStrip`, and a citation split across a line wrap
- `controls.ts` (`controlStrip` renders the forward button disabled…), `transport.ts` (`controlStrip` wires each `addEventListener` exactly once, in `button()`), `app.test.ts`, `scratch-app.test.ts`. The `transport.ts` one is a possessive split across two lines — "`pane-chrome.ts`'s" at the end of one line, "`controlStrip`" at the start of the next — which the attribution gate cannot see (its own header documents the wrap gap); a mechanical rename to `stepControls` leaves it naming the wrong file. Written as `step-controls.ts`'s `stepControls`.
- **Severity** — unclear.

### 5.5 — late finding on Task 4: "does not rebuild on a repeat state" (view-menu) cannot fail
- It compares `button.view-split` identity across two `setLayout(true, true)` calls, but `viewMenu` builds the split items once, at construction, so the identity holds under any mutation of `sync`. Same shape as 3.3; either open the menu and assert it stays open, or drop the test. No sabotage in the plan targets it.
- **Severity** — wrong (weak test).

### 5.6 — late finding on Task 4: plan code not Biome-formatted
- `viewMenu`'s `const claim = opts.claim === undefined ? null : item(…)` and two lines of `view-menu.test.ts` (`split: (dir, c) => log.push(…)`, `items`) exceed the line width. Auto-fixed with `biome check --write`.
- **Severity** — wrong (auto-fixable).

## Task 6 — notices and the live region

Commit `ecf7586`. Tests: `notice.test.ts` 5/5; whole browser tier 58 files / 333 tests; whole node tier 506/506; typecheck exit 0. The plan's `notice.ts` and `notice.test.ts` were Biome-clean as written.
Sabotages: (1) no `say(text)` — red in `notice.test.ts`'s first test, as predicted. (2) `persist` ignored — red in "keeps a persistent notice…", **but NOT in `buffers-quota.test.ts`** (see 6.6). (3) `detach` without `notify(e.message)` — red in `scratch-cap.test.ts` and in `sessions.test.ts`'s "re-throws a non-cap error out of the fork handler…", as predicted.

### 6.1 — Task 6, Step 5.5: deleting `compile.ts`'s clear leaves its `links` dependency unused
- **What went wrong** — `createCompile` destructures `links: linkWiring` and read it only for `setForkFailed(null)`; once that is gone Biome reports `noUnusedVariables` (an error under `--error-on-warnings`).
- **The fix** — delete the `links: LinkWiring` dependency, its `import type { LinkWiring }`, the doc sentence about `links` being a real value, and `links: linkWiring,` from `main.ts`'s `createCompile({...})` call.
- **Severity** — wrong.

### 6.2 — Task 6, Step 6: `tm-pane-follows-session.test.ts` builds a `createReplies` too
- `TS2741: Property 'notify' is missing` at its `createReplies({...})`. Not in the plan's Files list. Add `notify: () => undefined`.
- **Severity** — wrong.

### 6.3 — Task 6, Step 6: `tests/node/link-status.test.ts` has no `forkFailed` cases
- `grep -n forkFailed tests/node/link-status.test.ts` prints nothing; the "delete the cases that pass `forkFailed`" instruction has nothing to act on. The only `linkStatus({ …, forkFailed })` call is in `scratch-fork.test.ts` (the table's other row).
- **Severity** — unclear.

### 6.4 — Task 6, Steps 5–6: without the success-path clears, `scratch-cap.test.ts` STAGES 4–5 cannot hold until Task 7
- **What went wrong** — STAGE 4 asserts "the refusal is gone the moment its advice is taken" (after a retire) and STAGE 5 "the refusal clears with" a successful fork. Task 6 deletes both clears and adds no notice on either path, so the refusal notice stays up (8 s) and both negatives fail — or, rewritten to "`#notice` hidden", fail the same way. Task 7's delete and "created" notices are what replace it.
- **The fix** — in Task 6, drop the two assertions with a comment that Task 7 restores them; in Task 7, assert `#notice .notice-text` reads `λ copy 1 deleted` after the retire and `λ copy N created — this view shows it` after the fork. The Step 6 table should say so.
- **Severity** — wrong.

### 6.5 — Task 6, Step 6: `buffers-quota.test.ts`'s discriminating stage cannot discriminate on the notice line
- **What went wrong** — the test's second half proves the once-per-load guard by showing that a second failing write does not RESTATE the report. On `#link-status` a successful fork used to clear the field, so a restatement was visible. On the notice line a restatement writes the identical text, and the test's closing `expect(linkStatus()).toBe('λ pane detached — not linked to source')` no longer describes anything.
- **The fix** — read the live region too. `notice.ts`'s `say` changes `#live`'s text on every `notify`, even a repeat of the same words, so an unchanged `#live` is what proves the report was not made twice:
  ```ts
  const liveText = (): string => document.querySelector('#live')?.textContent ?? ''
  // …after the first report:
  const said = liveText()
  // …after the fork's own reply, and again at the end after the second fork:
  expect(linkStatus()).toBe(first)
  expect(liveText()).toBe(said)
  ```
- **Severity** — wrong.

### 6.6 — Task 6, Step 8 sabotage 2 predicts a red that does not come
- Ignoring `persist` does not redden `buffers-quota.test.ts`: the whole test finishes well inside `NOTICE_MS` (8 s), so the non-persistent notice is still up for every assertion. Only `notice.test.ts`'s fake-timer test fires. Drop the second half of the prediction.
- **Severity** — wrong.

### 6.7 — Task 6, Step 3: the `say` comment and the code disagree
- The comment says "A trailing **no-break space** toggled on a repeat"; the code appends `' '` (ASCII space). Either say "space" or append `' '` (the `trimEnd`/`endsWith` test would need the same character).
- **Severity** — unclear.

### 6.8 — Task 6: the persistent storage notice is effectively one gesture long — DESIGN NOTE
- `notice.ts` replaces the current notice on every `notify`, persistent or not (spec §11), and `main.ts`'s `storageFailureReported` stops the report from ever coming back. From Task 7 on, nearly every gesture notifies (copy created, paused, deleted; Task 10: every split, close and switch), so "copies are not being saved" stays on screen only until the user's next gesture and is not said again that page load. It is spec-consistent ("it too goes when another replaces it"), but the combination with once-per-load leaves the one lasting condition the notice system has almost invisible. Worth a spec decision: re-show it after a transient notice expires, or make it the notice line's resting state. **Not redesigned here.**
- **Severity** — design.

### 6.9 — Task 6, Step 5: stale prose, five of them at the gate
- The attribution gate after the reroute: `web/src/lambda-pane.ts:553` and `web/tests/browser/scratch-fork.test.ts:456`, `web/tests/node/replies.test.ts:233` cite `link-status.ts` for `forkFailed`; `web/src/main.ts:1441` cites `link-wiring.ts` for `forkFailed`; `web/src/scratch.ts:455` cites `link-wiring.ts` for `setForkFailed`. Besides those, about fifteen docs in `main.ts`, `link-wiring.ts`, `link-status.ts`, `transport.ts`, `replies.ts` and `scratch.ts` argue for the old clear-on-success and clear-on-keystroke rules. Step 5's "Expected: nothing in `src`" holds only after all of them are reworded; the plan names three (`link-status.ts`'s doc, `main.ts`'s storage doc, the retire handler's block).
- **Severity** — unclear.

## Task 7 — the copies menu, undo, the copy vocabulary

Commit `7910d81`. Tests: `copies-undo.test.ts` 3/3 (pause test added per Step 6); `buffer-list.test.ts` 16/16 (focus test added); node 509/509 (3 new scratch tests); whole browser tier 59 files / 337 tests; typecheck exit 0.
Sabotages, all red as predicted: (1) `undo` without `paneHost.moveBack` → `copies-undo.test.ts` "comes back through undo…" (`timed out … waiting for the view to show the copy again`); (2) `restore` without the rename → `scratch.test.ts` "restores a stored λ scratch 3 as copy 3…"; (3) delete hides the list as before → `buffer-list.test.ts` focus test (and the rewritten "deletes the row that was clicked…").

### 7.1 — Task 7, Step 1: "comes back through undo" waits for a `step 0` readout that never comes
- **What went wrong** — `Error: timed out after 10000ms waiting for step 0`. The view reads `step 7 of 7`: a restored copy runs again from step 0, and recording pushes the play head to the frontier, so the readout settles on the last step. "Restored at step 0" is where the RUN restarts, not where the readout ends.
- **The fix**:
  ```ts
    // "AT STEP 0" IS WHERE THE RUN RESTARTS, NOT WHERE THE READOUT ENDS: recording pushes the play head
    // to the frontier, so the view settles on `step 7 of 7`. What proves a fresh run is that its oldest
    // kept step is 0 — `↺` goes back to the oldest kept step.
    await until(() => /^step [\d,]+ of [\d,]+$/.test(stepText()), 'the copy to run again')
    leaf('lambda-0')?.querySelector<HTMLButtonElement>('[aria-label="back to the oldest kept step"]')?.click()
    expect(stepText()).toMatch(/^step 0 of /)
  ```
  with `const stepText = () => leaf('lambda-0')?.querySelector('.step')?.textContent ?? ''`.
- **Severity** — wrong.

### 7.2 — Task 7, Step 5: the handler sketches do not typecheck as written
- `scratchpad.recordOf(id)` is `BufferRecord | null`, so `panes.ofSession(record.leg, id)` needs a guard; `scratchpad.forkBlank('tm')` / `scratchpad.fork(...)` sit inside `try`, so their ids need `let id: SessionId` declared before it (and `transport.ts` needs `import type { SessionId } from './session-client'`); `nameOf` returns `string | null`, which a template literal would print as `null`. Written with a guard and `?? id`.
- **Severity** — unclear.

### 7.3 — Task 7, Step 6: `buffers-quota.test.ts`'s "report survives further writes" cannot survive the second fork — DESIGN (6.8 manifesting)
- **What went wrong** — `AssertionError: expected 'λ copy 2 created — this view shows it' to be 'buffers are not being saved — this br…'`. The plan says the report "is a persistent notice now; assert `#notice .notice-text` holds it after the further writes — that is the test's point, kept". It holds across the fork's own reply (no notice), but the test's SECOND fork now notifies `λ copy 2 created — this view shows it`, which replaces the persistent notice (spec §11), and the once-per-load guard keeps the storage report from returning.
- **What I did** — rewrote the final stage around what is now true and still discriminating: the line and the live region read the second fork's own notice; without the guard, the second failing write would put the storage phrase back over it.
- **Severity** — design (the test cannot say what the plan says it keeps).

### 7.4 — Task 7, Step 6: `/asleep/i → /paused/` against a whole row matches a running copy
- **What went wrong** — `tm-buffer-restore.test.ts`: `expected 'TM copy 1 · not shown · runningno ter…' not to match /paused/`. A warm row's controls read `pause` then `delete`, and a row's `textContent` runs them together as `pausedelete`, which matches `/paused/`.
- **The fix** — read the name line only: `row.querySelector('.buffer-row-name')?.textContent`, with `.toMatch(/· running$/)` beside the negative. The table row should say "against `.buffer-row-name`".
- **Severity** — wrong.

### 7.5 — Task 7, Step 6: vacuous negatives the table does not map
- `scratch.test.ts`: `.not.toThrow(/scratch 1/)` (→ `/copy 1/`; plus positive `toThrow(/^cannot make a copy — /)`); `scratch-cap.test.ts`: `not.toContain('scratch 1')` and `` not.toContain(`scratch ${MAX_WARM_BUFFERS}`) `` (→ `copy …`), STAGE 0's `not.toContain('fork failed')` (→ `'cannot make a copy'`); `tm-blank-buffer-cap.test.ts`: `not.toContain('fork failed')` (→ `'cannot make a copy'`, plus `toMatch(/^all \d+ copies are running/)`). Each passes vacuously if only the positives are converted. `scratch-cap.test.ts` STAGES 4–5 regain their assertions here (6.4): after the delete `λ copy 1 deleted`, after the fork `` `λ copy ${MAX_WARM_BUFFERS + 1} created — this view shows it` ``.
- **Severity** — wrong.

### 7.6 — Task 7, Step 6: a test whose claim the rename inverts
- `scratch.test.ts`'s "mints from one id space and **puts the leg in the label**" asserted `'λ scratch 1'` / `'TM scratch 2'` exactly, to pin that the leg decides the prefix. The label no longer carries the leg; rewritten as "…says the leg in the name, not the label": labels `copy 1`/`copy 2`, `nameOf` → `λ copy 1`/`TM copy 2`.
- **Severity** — wrong.

### 7.7 — Task 7, Steps 4 and 6: smaller gaps
- `bufferRow`'s `menu` parameter becomes unused once delete stops hiding the list → Biome `noUnusedFunctionParameters`. Drop it and its argument.
- `style.css` has a SECOND `.buffer-retire` selector (the `flex: none` rule beside `.buffer-temperature`), besides the shared chrome one the plan names; both become `.buffer-delete`.
- `tests/node/sessions.test.ts` hand-builds the cap message in the old wording and asserts `'retire or cool one'` against its own fixture — green by construction (its own history comment records exactly this trap). Updated to the real sentence.
- `buffer-restore.test.ts`'s stored fixture labels were `'scratch 1'`/`'scratch 2'` — not the `λ scratch N` shape the restore renames — so the migration was never exercised end-to-end. Changed to `'λ scratch 1'`/`'λ scratch 2'`, and the rows read `λ copy 1 · not shown · paused`, `λ copy 2 · 1 view · running`.
- **Severity** — unclear.


## Task 8 — the app header

Commit `67110df`. Tests: `app-header.test.ts` 6/6; whole browser tier 60 files / 343 tests (before the 8.1 rename; after it, `app-header` + `app` 47/47 and `tests/node/harness.test.ts` 6/6); node 509/509; typecheck exit 0; biome clean.
Sabotages, both red as predicted: (1) `+ view` with `beside` always `SOURCE_LEAF` → "adds a view beside the focused one" (leaf order); (2) reset notice dropped → "resets the preset".

### 8.1 — Task 8, Steps 1, 2 and 5: `#add-view` fails the colour gate
- **What the plan said** — the header's `+ view` button is `id="add-view"`, its menu `id="add-view-menu"`; `main.ts` queries `'#add-view'`, the CSS rule lists `#add-view,`, the test and the harness id list use them.
- **What went wrong** — the pre-commit hook: `no colour literals outside the palette....Failed` with `error: web/src/main.ts:150: … querySelector<HTMLButtonElement>('#add-view')`, `…:151: … ('#add-view-menu')`, `error: web/src/style.css:181:#add-view,`. `#add` is a three-digit hex colour to the gate's pattern, and the gate's own doc says to rename rather than weaken it.
- **The fix** — `new-view` / `new-view-menu` everywhere: `index.html`, the harness `SHELL`, `main.ts`, `style.css`, `app-header.test.ts`, `tests/node/harness.test.ts`'s id list. Replacement text for the plan: every `add-view` id becomes `new-view` (the JS names `addViewButton`/`addViewItems` may stay — only an id with a `#` in front trips the gate). **Task 12's controls list names `#add-view` too.**
- **Severity** — blocks (the commit is refused).

### 8.2 — Task 8, Step 6: the appearance toggle's system-state text is `◐system`, not `system`
- **What the plan said** — "`button.getAttribute('aria-label')` expectations become `button.textContent` expectations (`'system'`, `'light'`, `'dark'`)"; Step 4 keeps `◐` as a text node ("`◐` stays text"), and the new test asserts `#appearance-choice`'s `value` equals the button's `textContent`.
- **What went wrong** — with `◐` a text node beside the word, `textContent` in the system state is `'◐system'` (`☀`/`☾` are SVG and add no text). The app.test expectation `'system'` fails; the header test's `value === textContent` holds only because it clicks once from system to light and never asserts the system state. The accessible name, computed from the content, is `◐system` in that state too.
- **The fix** — app.test expects `'◐system'`, `'light'`, `'dark'` plus `title`. The better fix the plan should carry: wrap the glyph in `<span aria-hidden="true">` and read the word from a `.appearance-word` span, so the name is the word in all three states and the test compares `value` with the word, not the whole text.
- **Severity** — wrong.

### 8.3 — Task 8, Step 5: the shared header-button rule omits `#appearance`
- **What the plan said** — the shared rule lists `#workspace, #add-view, #buffers, #settings`, and "Delete `#appearance`'s old rule's duplicate declarations that the shared rule now carries".
- **What went wrong** — the shared rule does not carry them for `#appearance`, since `#appearance` is not in its selector; deleting them would strip the toggle's border and padding.
- **The fix** — add `#appearance` to the shared selector, keep the plan's own `#appearance { display: inline-flex; … }` rule.
- **Severity** — unclear.

### 8.4 — Task 8, Step 3: the test block's `import { EditorView }` is type-only
- Biome `useImportType` wants `import type { EditorView }` (the same auto-fix hit Task 7's `copies-undo.test.ts`), and one `expect` line runs over the width. Both auto-fixable.
- **Severity** — wrong (auto-fixable).

## Task 9 — the strip

Commit `a453efe`. Tests: `readout.test.ts` 4/4; node 513/513; `strip.test.ts` 3/3 (program readout; link announcement; copy readout, then the program again on source focus); whole browser tier 61 files / 346 tests; typecheck exit 0; biome clean.
Sabotages, both red as predicted: (1) `draw.ts` always shows the program → `strip.test.ts` "reads a copy while its view is focused…" (`timed out after 10000ms waiting for the copy's readout`); (2) `setLinkTo` without the announcement → "announces the link sentence after a link gesture…" (`expected '' to be 'the λ link is only defined at step 0 …'`). The assertion Step 9 asks for is written. The gesture is `Mod-'` at `x + 2`, with the λ view at its frontier, so the sentence it checks is not empty.

### 9.1 — Task 9, Steps 1 and 3: `programSegments` fails its own test on the TM width
- **What the plan said** — the test expects `'TM 42 · 2,870 transitions · width 8'`, which is spec §9's `TM 42 · 18,574 transitions · width 8`. `programSegments` joins `results.ts`'s TM rows in order, dropping only the value and normal-form rows.
- **What went wrong** — `- "TM 42 · 2,870 transitions · width 8"` / `+ "TM 42 · 8 cells · 2,870 transitions"`. `tmRows` lists the width FIRST, as `8 cells`.
- **The fix** — in `leg`, filter `'width'` out with the others and append `width ${n(r.tm.status.width)}` last:
  ```ts
      const rest = own.filter((row) => !['value', 'normal form', 'term so far', 'width'].includes(row.label))
      const width = name === 'TM' && r.tm.status.width !== null ? [`width ${n(r.tm.status.width)}`] : []
      return [value === undefined ? name : `${name} ${value}`, ...rest.map((row) => row.value), ...width].join(' · ')
  ```
- **Severity** — wrong.

### 9.2 — Task 9, Step 3: `readout.ts`'s imports
- `decodedText` is unused, as the plan anticipated. Two separate `./protocol` imports (`RecordEnd`, then `LambdaLeg, TmLeg`) sit out of order, so Biome's `organizeImports` merges them into `import type { LambdaLeg, RecordEnd, TmLeg } from './protocol'`. Two signatures also run past the line width. All of this is auto-fixable. The block should carry the merged import and drop `decodedText`.
- **Severity** — wrong (auto-fixable).

### 9.3 — Task 9, Step 1: the `as never` casts stay
- The plan left the pre-flight to decide. None of the fixtures is a literal of its real type:
  - `LambdaState` needs `spans`, `redex` and `redex_span`.
  - `TmStatus` has no `node`, so it is an excess property.
  - `Diagnostic` needs its message and span.
  - `TmScratchReading.status` lacks `available`, `reason`, `width` and `run`.
- Replace the parenthetical with "the casts stay; each fixture carries only what the readout reads".
- **Severity** — unclear.

### 9.4 — Task 9, Steps 4 and 5: four hand-built factories miss the new dependencies
- **What went wrong** — `TS2741: Property 'setProgram' is missing` at `tests/browser/scratch-fork.test.ts`, `tests/browser/tm-pane-follows-session.test.ts` and `tests/node/replies.test.ts` (twice), and `scratch-fork.test.ts`'s own `createLinkWiring({...})` misses `announce`. The plan's file list names none of them, and the hook's typecheck refuses the commit.
- **The fix** — `setProgram: () => undefined` in each `createReplies({...})`, `announce: () => undefined` in the `createLinkWiring({...})`. Add the three files to "Modify tests".
- **Severity** — blocks.

### 9.5 — Task 9, Step 4.2: "the two `showWorkerError`" include a COPY's worker error — DESIGN
- **What the plan said** — "the two `showWorkerError(results, new Error(reply.message))` → `setProgram({ kind: 'error', … })`".
- **What went wrong** — one of the two is in `onReply`, the program's handler. The other is in `onScratchReply`: a copy's thread that threw. Stored as the PROGRAM's result, it (a) replaces a program result that is still valid with another session's failure, and (b) shows only while the focused view shows the program. While the copy's own view is focused, the strip reads the copy's leg: `λ copy 1 · the scratchpad failed` for λ, only the name for TM. The message then appears nowhere. Before this task the arm also overwrote `#results`'s rows, but that was visible whatever held focus.
- **What I did** — followed the plan literally, which is the conservative path because it keeps the surface the arm already used. The spec needs to decide where a copy's worker error goes: the copy's readout, or a notice naming the copy.
- **Severity** — design.

### 9.6 — Task 9, Step 6: `.strip .link-status` placed before `.link-status` trips Biome
- **What went wrong** — `src/style.css … lint/style/noDescendingSpecificity`, a warning, so it fails `--error-on-warnings`. The block replaces `.results`, far above the base `.link-status` rule, and the more specific `.strip .link-status` then precedes the less specific one.
- **The fix** — put the `.strip .link-status` rule directly after `.link-status { … }` instead of in the block.
- **Severity** — blocks (the hook's `biome ci`).

### 9.7 — Task 9, Step 7: which `resultsText()` reads needed `focusProgram`, and one that would have passed vacuously
- Three files failed, all as the plan warned:
  - `scratch-app.test.ts`: `timed out … waiting for the recompile` (`includes('45')`).
  - `scratch-buffers.test.ts`: `timed out … waiting for the source recompile` (`includes('27')`).
  - `scratch-edit.test.ts`: `expected 'λ copy 1 · 2 reductions' to be 'λ 42 · 7 reductions…'`.
- **Unreported but vacuous**: `scratch-edit.test.ts`'s STAGE 4 wait `idle() && resultsText().includes('2')` is satisfied by the copy's own `λ copy 1 · 2 reductions`. It needs `focusProgram()` before it too.
- The other files in the audit list read `resultsText()` only inside `idle()`: `scratch-fork`, `scratch-rebind-editor`, `buffer-cool-warm`, `tm-blank-buffer`, `tm-buffer-restore` and `buffers-quota`. There `!== ''` is now satisfiable by a copy's readout, but `data-state` carries the wait, so nothing changed.
- The plan should name the four sites: `scratch-app` '45', `scratch-buffers` '27', `scratch-edit` before/after, and `scratch-edit` '2'.
- **Severity** — unclear.

### 9.8 — Task 9, Step 7: the old detachment sentence, and a negative the rename makes vacuous
- `scratch-app.test.ts`'s STAGE 5 `expect(statusLine()).not.toContain('detached')` can no longer fail, because no sentence says "detached". Changed to `not.toContain('shows a copy')`.
- The positives are `scratch-app`'s two `toContain('λ pane detached')` (→ `'λ view shows a copy'`), `active-pane.test.ts`'s `LAMBDA_DETACHED` constant, and `buffers-quota.test.ts`'s doc quote.
- **Severity** — wrong (the vacuous negative).

### 9.9 — Task 9, Step 3 and elsewhere: smaller gaps
- "Keep `resultRows`, `noSessionRows`, `runNote` and `valueLine` exported": `runNote` is not exported today, and nothing here needs it.
- Stale prose the plan does not name:
  - `style.css`'s body-rule comment argues from `#results`' `min-height: 12rem`, which this task deletes.
  - `replies.ts` names `showWorkerError(results, ...)` three times, as a call it no longer makes.
  - `link-wiring.ts`'s `detachedPanes` doc quotes "λ pane detached — not linked to source".
  - All reworded.
- **Severity** — unclear.

## Task 10 — layout notices, and focus that never falls to `<body>`

Commit `87afe79`. Tests: `layout-notices.test.ts` 3/3 and the new step-controls test, all four red first as Step 2 predicts (`expected '' to be 'view added — TM · program'`, and the same for the switch and the close; `expected <body> to be <button …>`); whole browser tier 62 files / 350 tests; node 513/513; typecheck exit 0; biome clean.
Sabotages:
- (1) Dropping the `closed` event turned "says a view closed…" red, as predicted: `expected 'view now shows λ · program' to be 'view closed — λ · program'`.
- (2) Dropping the continue-button focus move turned the new step-controls test red, as predicted, and also the rewritten probe test (10.1).
- (3, added) Dropping the reattach focus move turned the assertion 10.2 adds red: `expected <body> to be <button …>`.

### 10.1 — Task 10, Step 5: `extend-focus-probe.test.ts` asserts the very hazard this task fixes
- **What went wrong** — the whole tier: `extend-focus-probe.test.ts > … > is reachable only by a programmatic dispatch, which no user gesture performs`: `AssertionError: expected <button type="button" …(3)>…(1)</button> to be <body>…(5)</body>`. The test focuses `[continue]`, dispatches a document change, and pinned focus landing on `<body>` as the route "that does strand focus". The new `update` hands the focus to a working neighbour instead. The plan does not name this file.
- **The fix** — the test now asserts the handoff:
  ```ts
    it('hands focus to a working neighbour when a programmatic dispatch withdraws the focused continue button', async () => {
      …
      extend.focus()
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } })
      const now = document.activeElement
      expect(now).not.toBe(document.body)
      expect(now?.closest('[data-leaf="tm-0"] .controls')).not.toBeNull()
      expect(now instanceof HTMLButtonElement && !now.disabled && !now.hidden).toBe(true)
    }, 90_000)
  ```
  Its comment is reworded from "the one route that does strand focus" to "used to, and no longer does". Its two sibling tests stand: they set `hidden` and `disabled` by hand, and the gestures leave focus where the user was. Sabotage (2) turns the rewritten test red. `pane-host.ts`'s `focusPane` doc called the reattach "strands focus on `<body>`" in the present tense; reworded.
- **Severity** — blocks (the tier is red).

### 10.2 — Task 10, Step 4: the reattach focus move has no test
- **What the plan said** — Step 4 changes `tm-pane.ts`'s `#reattach` click. Neither Step 1's tests nor Step 6's sabotages touch it.
- **What went wrong** — `table-reattach` appears in one test file, `app.test.ts`, which reads `document.activeElement` nowhere, and every click there is on an unfocused button. So `had` is false and the new line never runs under test.
- **The fix** — `app.test.ts`'s "reattaches through its own control, which exists only while detached" focuses the button before its click and ends with `expect(document.activeElement).toBe(document.querySelector('[data-leaf="tm-0"] [data-panel="rules"] .panel-toggle'))`. Sabotage (3) turns it red.
- **Severity** — unclear (a gap: the accessibility list's item 1 instance ships unmeasured otherwise).

### 10.3 — Task 10, Step 4: the reattach guard is given twice, and the two versions differ
- The plan gives `if (this.#reattach.hidden && document.activeElement === document.body) …` and then says to focus the toggle "only when the reattach button was the focused element before the click (capture `const had …`)". Written as `if (had && this.#reattach.hidden) this.#rulesPanel.toggle.focus()`. The `activeElement === body` clause is redundant once `had` is captured; Chromium moves focus to `<body>` synchronously when `hidden` is set, as the probe's first test shows. The plan should carry only the `had` form.
- **Severity** — unclear.

### 10.4 — Task 10, Step 3: where `layoutChanged` lives in `main.ts`, and an import
- The source view's close handler (`viewMenu(sourceHeader.actions, …)`) sits above `createPaneHost`, and both must call the same function. So `layoutChanged` is a `const` declared before `sourceMenu` and passed as `layoutChanged` to `createPaneHost`. The snippet also needs `import type { PaneChoice } from './pane-chrome'` (`main.ts` did not import it) and `type LayoutEvent` from `./pane-host`.
- **Severity** — unclear.

### 10.5 — Task 10, Step 1: `import { EditorView }` again
- Biome `useImportType` → `import type { EditorView }`, plus formatting of the long `querySelector` line. The same as 8.4. Auto-fixable.
- **Severity** — wrong (auto-fixable).

## Task 11 — the renames no earlier task reached

Commit `3c4d085`.
- **Rust.** The wasm was rebuilt with `pnpm run build:wasm:dev`. The built `pkg/redextape_wasm_bg.wasm` contains `too large to copy` and `a TM copy builds`, and not `too large to fork`. `cargo nextest run -p redextape-wasm` (memory-capped): 85 tests run, 85 passed, including `a_file_at_the_ceiling_builds_and_one_byte_more_is_refused`. The hook's cargo fmt and clippy passed.
- **Web.** node 513/513; whole browser tier 62 files / 350 tests; typecheck exit 0; biome clean.
- **Step 3.** The old-words list, written to the session scratchpad, is 232 lines. Every one is an internal identifier (`scratchpad`, `warm`, `cool`, `retire(`), a fixture label (`'λ scratchpad'`), a test name or a test's `until` message. None is text a user sees or hears.
- **Step 4.** The grep prints nothing.
- **Sabotages.** The plan names none for this task.

### 11.1 — Task 11, Step 3: the comment sweep is 59 lines, and the plan gives no mapping for the old words
- The second grep returns 59 comment lines. 44 describe today's UI in old words and were reworded, with 51 line edits across 22 files, some of them on the next line of a wrapped sentence. The other 15 are history ("used to read", "the old `[detached]` badge", "a third review round reached this throw in six clicks (`fork`, `close`, `reset layout` …)") and keep their words.
- The mapping had to be worked out from the tree:
  - `reset layout` → `reset preset`
  - `[detached]` badge → `copy · not linked` status
  - `✎ fork` → `edit a copy`
  - `buffers ▾` → `copies ▾`
  - "new TM buffer" → "new TM copy"
- The plan should carry that table.
- The grep also misses present-tense comments in words outside its pattern. For example, `style.css`'s buffer-row comments say "retire control" / "retire button" for what is now `delete`, and several test names still describe today's UI in old words:
  - `scratch-cap.test.ts`: "refuses the fork past the cap with a message on the status line … after a retire". The refusal is a notice since Task 6.
  - `scratch-rebind-editor.test.ts`: "… does not merely drop the [detached] badge".
  - `two-lambda-panes.test.ts`: "… dropped by reset layout …".
  - These were left as they are.
- **Severity** — unclear.

### 11.2 — Task 11, Step 1: no test can tell the three web renames from the old words
- `buffers-quota.test.ts` and `buffers-quota-restored.test.ts` match the substring `'not being saved'`, which both "buffers are…" and "copies are…" satisfy.
- Nothing reads a divider's `aria-label`, and nothing reads the `'the copy failed'` reason.
- The whole tier is green whether or not Step 1 is applied. The Rust strings are pinned by `session.rs`'s own tests.
- The fix the plan should carry: one assertion per web string, for example `toContain('copies are not being saved')` in `buffers-quota.test.ts`, and `aria-label` `'resize views left and right'` in `layout-view.test.ts`.
- **Severity** — unclear (a gap).

## Task 12 — the controls gate

Commit `d7d359d`. Tests: `controls-gate.test.ts` 9/9 (the page, plus eight menus open). Biome clean, typecheck exit 0.
- **Accessible names.** Computed by the plan's approximation. `pnpm why dom-accessibility-api` prints nothing from `web/`, and nothing matching `accessib` is in `node_modules/.pnpm`. `pnpm why vitest` from the same place resolves the tree, so the probe can see installed packages.
- **Step 2.** The gate passed on its first run, with no control changed; "fix what it finds" found nothing.
- **What the gate walks.** A temporary probe (a thrown error per `check`, reverted) listed it:
  - the page: 26 controls
  - `#workspace`: `reset preset — restores the default views`
  - `#new-view`: `λ · program | λ · copy 1 | TM · program`
  - `#buffers`: `new TM copy | pause λ copy 1 | delete λ copy 1`
  - `#settings`: `style | palette | appearance`
  - both title menus: the three pairs
  - `lambda-0`'s `⋯`: `split right | split down`
  - `tm-0`'s `⋯`: `split right | split down | edit a copythe whole machine`

Sabotages, both red as predicted:
- (1) Removing `◀`'s `aria-label` turned all 9 tests red: `#buffers: <button class=""> named "◀" is a bare glyph: expected true to be false`.
- (2) Giving `view-close` the `aria-label` `'dismiss view'` against its `title` `'close this view'` turned all 9 red: `<button class="view-close"> named "dismiss view": a glyph-only control's tooltip must be its name`.

### 12.1 — Task 12, Step 1: the gate's menu list names `#add-view`
- After 8.1 the id is `#new-view`. As written, `expect(button, selector).not.toBeNull()` fails for that row. Changed to `['#new-view']`.
- **Severity** — blocks (a consequence of 8.1; the plan should rename both together).

### 12.2 — Task 12, Step 1: the approximation cannot see two naming problems that are there
- **The appearance toggle.** Its name in the system state is `◐system` (8.2). The name has letters, so it is not a "bare glyph", and name equals `textContent`, so it passes.
- **A menu item with a description span.** Its `textContent` runs the two together with no space: `edit a copythe whole machine`. The gate compares `textContent` with itself, so whatever a screen reader actually makes of the item cannot fail the gate.
- Both are blind spots of `nameOf` falling back to `textContent`, and there is no `computeAccessibleName` to replace it with. The plan's claim that the approximation "covers every naming mechanism this app uses" holds for the attributes, not for how text content is joined.
- **Severity** — unclear.

### 12.3 — Task 12, Step 1: `import { EditorView }` a third time
- Biome `useImportType`, plus the formatter. The same as 8.4 and 10.5. Auto-fixable.
- **Severity** — wrong (auto-fixable).

## Final verification (after Task 12, head `d7d359d`)

- **`scripts/check-all.sh`** was run from the worktree root under the 16G / no-swap cap: **exit 0**, "all configs green — base, LLVM and browser".
  - Workspace nextest: 1766 run, 1766 passed, 33 skipped.
  - `redextape-wasm --features ts`: 95/95.
  - `probe-no-tm-scratch-ceiling`: 84/84.
  - `redextape-native` with LLVM: 104/104.
  - `wasm-pack test --headless --chrome`: 27 passed.
  - **Environment note, not a plan defect:** the first run exited 1 before any leg. `error: tree-sitter at /usr/sbin/tree-sitter reports 0.28.0, not the pinned 0.25.10`. The brief's `PATH="/usr/sbin:$PATH"` puts the system tree-sitter first, and the worktree has no `.tools/`. The rerun passed `TREE_SITTER=/home/davey/projects/redextape/.tools/tree-sitter` (0.25.10), which is the main checkout's pinned build.
- **From `web/`:**
  - `pnpm exec biome ci --error-on-warnings`: exit 0, 167 files. Its one info is the deprecated `recommended` key in `biome.json`, which predates the branch.
  - `pnpm run typecheck`: exit 0.
  - `pnpm run test:coverage` (capped, Chrome on PATH): exit 0, 99 files / 872 tests.
    - All files: statements 96.48, branches 90.58, functions 98.56, lines 98.58.
    - Thresholds: 95 / 89 / 97 / 97.
  - `pnpm run build:app`: exit 0. The wasm bundled is the dev build from Task 11.
- The worktree is clean after all of it (`git status --short` prints nothing).
