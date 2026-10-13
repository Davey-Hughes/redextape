# View layouts, part 1 — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The header chooses which views are on screen, each combination of views keeps its own arrangement, a prefix
chord drives both from the keyboard, and a fresh page opens on the source beside the TM view.

**Architecture:** `web/src/arrangements.ts` holds the model as values: a combination is the set of kinds a tree shows,
`enter` is the one function a gesture's write of the tree goes through, and `liveLeaves` is every view the tree on
screen or a remembered tree holds. `workspace.ts` stores the remembered trees in a field that may be absent.
`pane-host.ts` parks a view a switch takes off the screen, its entry kept in the `PaneCollection` off the page as a
Stage tab's is, and still closes a view a `✕` removes; `main.ts` wires the header's toggles and `view-keys.ts`'s one
listener to one `switchTo`. Two defects the work exposed are fixed first, each as its own task: a rebuild reset every
scroll position, and a view off the page kept the editor of a copy it no longer showed.

**Tech Stack:** TypeScript 7.0.2, Vite 8.2.1, Vitest 4.1.10 (node and Playwright 1.62.1 Chromium projects), Biome
2.5.7, CodeMirror 6 (`@codemirror/view` 6.43.8, `@replit/codemirror-vim` 6.4.0).

**Spec:** `docs/superpowers/specs/2026-10-11-view-layouts-design.md`, as amended 2026-10-12 (§ numbers below are its
sections). This plan is its first pull request, §4 to §8. Panel resizing (§11), moving (§9) and drag and drop (§10)
are the three after it, each with a plan of its own.

**Provenance:** a prototype (`view-layouts-proto`, last `57c619b`) was built first, tried by the user in a running
page, and changed four times by what he said (the spec's §16.1). It was then replayed task by task onto
`view-layouts-replay` (`5b009af`..`bd431aa`, one commit a task, every commit through every hook at the first attempt),
and the code blocks below are those commits', cut from them by `git`. Each task's failing run, passing run and
sabotages were run on that replay, and the outputs quoted are those runs': 28 sabotages, all of which fired. The
replay's last tree is the prototype's, byte for byte (`git diff --quiet view-layouts-proto view-layouts-replay`; both
are tree `0a08ce1`). On it `biome ci` and `tsc` passed, the node project passed 69 files and 1,327 tests, the browser
project 178 files and 1,231 tests, and `pnpm run test:coverage` met its thresholds (lines 98.88%, branches 91.8%).
All three branches are local, and so is the replay's ledger, `~/temp/redextape-view-layouts-record/replay/ledger.md`.

## Global Constraints

- `KIND_ORDER` is source, λ, asm, TM: a combination's key spells its kinds in it and a default arrangement places
  them by it. `HEADER_ORDER` is source, asm, λ, TM: the toggles, the toggle keys `1` to `4`, the cycle and the live
  region's sentence follow it (§4.1).
- A switch (a toggle or a cycle key) parks the views it takes off the screen. A `✕` closes its view, as it always
  has (§5.1).
- In a wide window a combination's default is columns side by side, so no divider and no view runs the whole width;
  a tall window gets the same trees on their side. Default ids are `source`, `lambda-0`, `asm-0`, `tm-0` (§4.4).
- A fresh page opens on the source beside the TM view, with the focus on the TM view (§8).
- `WORKSPACE_VERSION` stays 2. `arrangements` may be absent, and is written only while it holds an entry (§4.2).
- `MAX_TREE_LEAVES`, 64, bounds the live views, not the tree on screen alone (§5.6).
- The prefix is `Ctrl+.`; the cycle keys are `]` and `[`; a key after the prefix is answered with `Ctrl` held or not;
  one action a prefix (§7).
- The toggles are hidden in a window 40rem wide or narrower, by a `hidden` attribute (§6.1). The spec marks this
  **OPEN**; the plan builds what the prototype has.
- A toggle's attribute is `data-shows`. Never `data-kind`: that is a view host's, and tests count λ views by it.
- No colour literal outside `web/src/palettes.ts`; every colour in new CSS is a `var(--…)` token.
- No `file:line` in tracked source; a backticked symbol citation names the file that declares it.
- **Comments are written for the branch's last commit.** A sentence in an early task's comment may describe what a
  later task adds (Tasks 1 and 2 mention toggles and parked views; Task 3 mentions view keys and the two-view
  default). Copy them as given: `main` is squash-merged, and the replay's hooks passed them.
- Commits run every pre-commit hook; never `--no-verify`. Stage explicit paths, never `git add -A`.
- Web code style is Biome's: single quotes, no semicolons, 120 columns, `/** */` doc comments.
- No AI attribution anywhere: not in a comment, a commit message, the roadmap or the pull request.

## How to run things

All test commands run from `web/`:

- Node project: `pnpm exec vitest run --project node <files>`
- Browser project: `pnpm exec vitest run --project browser <files>`. One browser run at a time on this machine.
- Typecheck: `pnpm exec tsc --noEmit -p .` (the hook runs `pnpm run typecheck`, which rebuilds the bindings first)
- Lint and format: `pnpm exec biome ci --error-on-warnings`; `pnpm exec biome check --write <paths>` applies fixes

The shell is zsh with `noclobber`: write a log with `>|`. A `>` onto a log that exists keeps the old log without a
word, and the old result is what gets read.

**A sabotage is:** save a copy of the file, make the one edit shown, run the named test files, expect the failure
quoted, copy the saved file back, and `cmp` it against the copy. Never restore with `git checkout`, which would wipe a
task's unstaged work. A sabotage that does not fire is a finding: stop and report it, and do not change the test to
suit.

**`userEvent.keyboard('[')` throws** (`[` opens a key code, as in `[KeyA]`); a literal `[` is `'[['`.

**Work in a worktree, not in the main checkout,** while a dev server is running from it: a sabotage there is served to
whoever has the page open. In a scratch worktree `pkg/`, `pkg-lsp/`, `web/node_modules` and `web/bindings/` must be
real directories, copied from a checkout that has them, not symlinks; `scripts/build-web-bindings.sh` rebuilds the
last. They are gitignored, which is one more reason to stage explicit paths.

The browser project runs 7 fewer files than `ls web/tests/browser/*.test.ts` counts: `vite.config.ts` leaves the
probe files out unless `REDEXTAPE_PROBE` is set.

## File map

| File | Task | Responsibility |
|---|---|---|
| `web/src/pane-host.ts` | 1, 2, 3, 4 | scroll positions held across a rebuild; the off-page editor teardown; parking, `switchViews`, the bound on live views |
| `web/src/arrangements.ts` | 3 | combinations and keys, `enter`, `toggled`, the cycle, `liveLeaves`, `shapeOf` |
| `web/src/layout.ts` | 3, 4 | `KIND_ORDER`, `HEADER_ORDER`, `KIND_WORD`, `defaultArrangement`; then `defaultLayout(shape)` |
| `web/src/workspace.ts` | 3, 4 | `Workspace.arrangements` and its parsing; then `defaultWorkspace(shape)` |
| `web/src/app-header.ts` | 3 | `viewToggles`, `shownSentence` |
| `web/src/main.ts` | 3, 4, 5 | `enterTree`, `arranged`, `switchTo`, the toggles' wiring; the first load and the reset; the view keys' wiring |
| `web/src/draw.ts`, `web/src/link-wiring.ts` | 3 | the running focuses and the copies count read the tree on screen |
| `web/index.html`, `web/tests/browser/harness.ts` | 3, 4, 5 | `#views-shown` and `#view-keys`, in both copies; the four-view fixtures and `resetToFourViews` |
| `web/src/style.css` | 3, 5 | the toggles; the keys' hint |
| `web/src/view-keys.ts` | 5 | the machine, `step`, and the one listener, `wireViewKeys` |
| `web/help.html` | 5 | the views buttons, and the table of view keys |
| `web/src/editor-custody.ts` | 4 | two comments that described the four-view default |
| `web/tests/browser/setup.ts` | 4 | every file starts on a stored four-view workspace |

---
### Task 1: A rebuild of the layout keeps every view's scroll positions

`layout-view.ts`'s `renderLayout` and `renderStage` detach every view's host and append the ones the tree names, and an
element that leaves the document comes back scrolled to its start. So closing one view resets the scroll of every
other, and so do a split, `+ view` and a preset (spec §2.12). `pane-host.ts` records every scrolled element of every
view on the page before a rebuild and puts each back after it (§5.2). This is a defect `main` has; it comes first
because a switch rebuilds on every press.

**Files:**
- Modify: `web/src/pane-host.ts`
- Create: `web/tests/browser/scroll-kept.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing another task calls. `keepScroll()` and `giveScrollBack()` are closures inside `createPaneHost`.
  Task 3 puts its `applied()` call between `giveScrollBack()` and `persist()`.

- [ ] **Step 1: Write the tests**

Create `web/tests/browser/scroll-kept.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * A REBUILD OF THE LAYOUT KEEPS WHERE EVERY VIEW WAS SCROLLED TO — the view layouts spec §5.2.
 *
 * `layout-view.ts`'s `renderLayout` detaches every view's host and appends the ones the tree names, and an element
 * that leaves the document comes back scrolled to its start. So closing ONE view reset the scroll of every other, and
 * so did a split, `+ view` and a preset. `pane-host.ts` records each scrolled element before a rebuild and puts it back
 * after.
 *
 * **THE VIEW THAT IS SCROLLED IS NEVER THE ONE THE GESTURE IS MADE ON**: the defect is about a view that stays where
 * it is. `view-toggles.test.ts` has the same hold for a view that leaves the page and comes back.
 */

const host = (leaf: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${leaf}"]:not([role="tab"])`)
const table = (): HTMLElement => host('tm-0')?.querySelector('.state-table') as HTMLElement

describe('a view’s scroll position, across a rebuild made by another view', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
    expect(table().scrollHeight - table().clientHeight, 'precondition: the rule table scrolls').toBeGreaterThan(200)
    table().scrollTop = 120
    table().dispatchEvent(new Event('scroll'))
    await until(() => table().scrollTop === 120, 'the table to hold its scroll')
  })

  it('is kept when another view is closed', async () => {
    await userEvent.click(host('asm-0')?.querySelector('button.view-close') as HTMLElement)
    expect(host('asm-0'), 'the asm view is still on the page').toBeNull()
    expect(table().scrollTop, 'closing the asm view reset the TM view’s rule table').toBe(120)
  })

  it('is kept when a view is added', async () => {
    const before = document.querySelectorAll('#views [data-leaf]').length
    await userEvent.click(document.querySelector('#new-view') as HTMLElement)
    await userEvent.click(document.querySelector('#new-view-menu button') as HTMLElement)
    expect(document.querySelectorAll('#views [data-leaf]').length, '+ view added nothing').toBe(before + 1)
    expect(table().scrollTop, 'adding a view reset the TM view’s rule table').toBe(120)
  })

  it('is kept when the preset changes how the views are drawn, and when it changes back', async () => {
    const pick = async (sel: string): Promise<void> => {
      await userEvent.click(document.querySelector('#workspace') as HTMLElement)
      await userEvent.click(document.querySelector(`#workspace-menu ${sel}`) as HTMLElement)
      const menu = document.querySelector<HTMLElement>('#workspace-menu')
      if (menu?.matches(':popover-open')) menu.hidePopover()
    }
    await pick('[data-preset="debugger"]')
    expect(table().scrollTop, 'the Debugger preset reset the TM view’s rule table').toBe(120)
    await pick('[data-preset="explorer"]')
    expect(table().scrollTop, 'the Explorer preset reset the TM view’s rule table').toBe(120)
  })
})
```

- [ ] **Step 2: Run them, and see them fail**

`pnpm exec vitest run --project browser tests/browser/scroll-kept.test.ts` (`t1-failing.log`): 1 file failed, 3 tests
failed of 3.

```
AssertionError: closing the asm view reset the TM view’s rule table: expected +0 to be 120 // Object.is equality
AssertionError: adding a view reset the TM view’s rule table: expected +0 to be 120 // Object.is equality
AssertionError: the Debugger preset reset the TM view’s rule table: expected +0 to be 120 // Object.is equality
```

- [ ] **Step 3: Write the source**

In `web/src/pane-host.ts`:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1139,6 +1139,47 @@ export function createPaneHost(deps: {
    *
    * For what this doc used to claim and why it changed, see the history note under `applyLayout`.
    */
+  /**
+   * WHERE EACH VIEW WAS SCROLLED TO, ACROSS A REBUILD — the view layouts spec §5.2.
+   *
+   * **A REBUILD RESETS EVERY SCROLLER IN EVERY VIEW, ON THE PAGE OR OFF IT.** `renderLayout` and `renderStage` detach
+   * every host and append the ones the tree names, and an element that leaves the document comes back scrolled to its
+   * start. Measured before this existed, at 1280 × 896 on `let x = 40; x + 2`: the TM view's rule table at 120 px was
+   * at 0 after ANOTHER view's toggle was pressed, and so was its program level. A split, a close and a preset did the
+   * same; a switch does it on every press, which is what made it worth holding.
+   *
+   * `keepScroll` is called before the hosts are detached and records, for each host on the page, every element
+   * inside it that is scrolled; `giveScrollBack` is called once they are appended and puts back each one whose host
+   * is on the page again. A host that is not keeps its record until it is, so a view a switch takes off the screen
+   * comes back where it was.
+   *
+   * **KEYED BY THE HOST AND HELD WEAKLY**, so a host nothing else holds takes its record with it. **ONLY ELEMENTS
+   * STILL IN THE HOST ARE WRITTEN**: a view built again under the same host has none of the old ones, and starts at
+   * the top as a new view does.
+   */
+  const scrolled = new WeakMap<HTMLElement, [el: HTMLElement, top: number, left: number][]>()
+  const keepScroll = (): void => {
+    for (const host of hosts.values()) {
+      if (!host.isConnected) continue
+      const held: [HTMLElement, number, number][] = []
+      for (const el of host.querySelectorAll<HTMLElement>('*'))
+        if (el.scrollTop !== 0 || el.scrollLeft !== 0) held.push([el, el.scrollTop, el.scrollLeft])
+      scrolled.set(host, held)
+    }
+  }
+  const giveScrollBack = (): void => {
+    for (const host of hosts.values()) {
+      const held = scrolled.get(host)
+      if (held === undefined || !host.isConnected) continue
+      scrolled.delete(host)
+      for (const [el, top, left] of held) {
+        if (!host.contains(el)) continue
+        el.scrollTop = top
+        el.scrollLeft = left
+      }
+    }
+  }
+
   const applyLayout = (rebuild: 'none' | 'copies' | 'every' = 'none'): void => {
     // WHAT EACH LIVE LEAF RENDERS, NOT MERELY WHICH LEAVES ARE LIVE — a `Map` where this was a `Set`,
     // because there are two reasons to drop an entry now and the second one is about the VALUE.
@@ -1415,6 +1456,7 @@ export function createPaneHost(deps: {
       custody.reconcile()
     } finally {
       for (const l of leaves(getTree())) hostFor(l.id, l.pane)
+      keepScroll()
       // **IF/ELSE, NOT AN EARLY `return` — AND THAT IS NOT A LINT, IT IS THIS `finally`'s WHOLE PURPOSE.**
       // A `return` inside a `finally` DISCARDS an exception propagating out of the `try`, which is
       // exactly the exception the paragraph above says must still leave this function and reach
@@ -1451,6 +1493,7 @@ export function createPaneHost(deps: {
           commit: () => applyLayout(),
         })
       }
+      giveScrollBack()
       persist()
       draw()
     }
```

- [ ] **Step 4: Run them, and see them pass**

The same command (`t1-passing.log`): 1 file passed, 3 tests passed.

- [ ] **Step 5: Break it on purpose, once a sabotage, and put it back**

Each entry is the replay's own record. Its `sab.sh` saved the file, made the edit, ran
`pnpm exec vitest run --project <project> <file>` for each file named, copied the saved file back and ran `cmp`.

**S1** `src/pane-host.ts`: the `giveScrollBack()` call deleted from `applyLayout`'s `finally`.
`sab.sh S1 browser:tests/browser/scroll-kept.test.ts` (`sab-S1-browser.log`): 3 failed of 3, as expected.

```
AssertionError: closing the asm view reset the TM view’s rule table: expected +0 to be 120 // Object.is equality
AssertionError: adding a view reset the TM view’s rule table: expected +0 to be 120 // Object.is equality
AssertionError: the Debugger preset reset the TM view’s rule table: expected +0 to be 120 // Object.is equality
```

Restored `src/pane-host.ts`, cmp equal.

The edit:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1493,7 +1493,6 @@
           commit: () => applyLayout(),
         })
       }
-      giveScrollBack()
       persist()
       draw()
     }
```

- [ ] **Step 6: The whole suite**

`pnpm exec biome ci --error-on-warnings`, `pnpm exec tsc --noEmit -p .`, `pnpm exec vitest run --project node` and
`pnpm exec vitest run --project browser`, all from `web/`. On the replay, after this task:

| Check | Result |
|---|---|
| `biome ci --error-on-warnings` | exit 0, checked 362 files, 1 info |
| `tsc --noEmit -p .` | exit 0 |
| node | 67 files, 1248 tests, all passed |
| browser | 168 files, 1189 tests, all passed |

- [ ] **Step 7: Commit**

```bash
git add web/src/pane-host.ts \
  web/tests/browser/scroll-kept.test.ts
git commit -F - <<'EOF'
A rebuild of the layout keeps where every view was scrolled to: a close, a + view and a preset detach every view's host, which sent each scroller back to its start, and pane-host.ts now records them before the rebuild and puts them back after it
EOF
```

### Task 2: A view off the page that is moved onto the program has its copy's editor taken down

A view that stops showing a copy has the copy's editor taken down by the `draw()` that follows, and `draw()` passes
over a view that is not on the page. So a Stage tab that was not selected went on holding the editor of a deleted
copy, and the copy's *undo* then gave it a second editor and threw `a λ pane was handed a second editor while still
holding one` (spec §5.5). This is a defect `main` has, reached with gestures `main` has; Task 3's parked views would
reach it in tiles.

**Files:**
- Modify: `web/src/pane-host.ts`
- Create: `web/tests/browser/stage-copy-editor.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing another task calls.

- [ ] **Step 1: Write the tests**

Create `web/tests/browser/stage-copy-editor.test.ts`:

```ts
import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * A COPY DELETED AND RESTORED WHILE THE VIEW HOLDING ITS EDITOR IS A STAGE TAB THAT IS NOT SELECTED — the view layouts
 * spec §5.5.
 *
 * A view that stops showing a copy has the copy's editor taken down by the next `draw()`, and `draw()` passes over a
 * view that is not on the page. So a hidden tab went on holding the editor of a copy it no longer showed, and a
 * delete followed by its *undo* gave the copy a second editor on the first view moved back: the next sweep handed that
 * view the stale one and threw `a λ pane was handed a second editor while still holding one`.
 *
 * **EVERY GESTURE HERE IS ONE THE APP HAD BEFORE THE VIEW LAYOUTS**: the Stage, a second view of a copy, *move the
 * editor here*, delete and undo. `pane-host.ts`'s `reseedingSlots` takes the editor down as it moves a view off the
 * page onto the program. `parked-copy-editor.test.ts` drives the same thing for a view a switch parked.
 */

const errors: string[] = []
const onError = (e: ErrorEvent): void => {
  errors.push(e.message)
}

const leaf = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${id}"]:not([role="tab"])`)
const titleText = (id: string): string => leaf(id)?.querySelector('.view-title')?.textContent ?? ''
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const tabs = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [role="tab"]')].map((t) => t.dataset.leaf as string)
const tab = (id: string): void => document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${id}"]`)?.click()
const pick = (sel: string): void => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  const m = document.querySelector<HTMLElement>('#workspace-menu')
  if (m?.matches(':popover-open')) m.hidePopover()
}
const editors = (id: string): number => leaf(id)?.querySelectorAll('.term-editor .cm-editor').length ?? 0

beforeAll(async () => {
  window.addEventListener('error', onError)
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})
afterAll(() => window.removeEventListener('error', onError))

describe('a copy deleted and restored while the view holding its editor is a hidden Stage tab', () => {
  it('gives the copy one editor, and no handler throws', async () => {
    pick('[data-preset="stage"]')
    tab('lambda-0')
    leaf('lambda-0')?.querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => titleText('lambda-0') === 'λ · copy 1' && editors('lambda-0') === 1, 'the copy and its editor')
    const session = leaf('lambda-0')?.querySelector<HTMLElement>('button.view-title')?.dataset.binding ?? ''
    expect(session, 'precondition: the view’s title names its copy').not.toBe('')

    // A SECOND VIEW OF THE COPY, WHICH THE STAGE SHOWS, AND THE EDITOR MOVED ONTO IT.
    const before = new Set(tabs())
    document.querySelector<HTMLButtonElement>('#new-view')?.click()
    document.querySelector<HTMLButtonElement>(`#new-view-menu button[data-binding="${session}"]`)?.click()
    const second = tabs().find((id) => !before.has(id))
    if (second === undefined) throw new Error('+ view added no second view of the copy')
    await until(() => leaf(second) !== null && titleText(second) === 'λ · copy 1', 'the second view, shown')
    leaf(second)?.querySelector<HTMLButtonElement>('button.claim-editor')?.click()
    await until(() => editors(second) === 1, 'the editor to move to the second view')

    // THE FIRST VIEW'S TAB: the second, holding the editor, is now a tab that is not selected.
    tab('lambda-0')
    expect(mounted(), 'precondition: the holder is off the page').toEqual(['lambda-0'])
    expect(editors('lambda-0'), 'precondition: the view on the page holds no editor').toBe(0)

    document.querySelector<HTMLButtonElement>('#buffers')?.click()
    document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label="delete λ copy 1"]')?.click()
    await until(() => titleText('lambda-0') === 'λ · program', 'the shown view to move to the program')
    document.querySelector<HTMLElement>('.buffer-list')?.hidePopover()
    document.querySelector<HTMLButtonElement>('#notice button.notice-action')?.click()
    await until(
      () => titleText('lambda-0') === 'λ · copy 1' && editors('lambda-0') === 1,
      'the copy and an editor back',
    )

    tab(second)
    expect(mounted()).toEqual([second])
    expect(errors, 'a handler threw').toEqual([])
    expect(editors(second), 'the view that was hidden still holds the editor of the copy it left').toBe(0)
    tab('lambda-0')
    expect(editors('lambda-0')).toBe(1)
  })
})
```

- [ ] **Step 2: Run them, and see them fail**

`pnpm exec vitest run --project browser tests/browser/stage-copy-editor.test.ts` (`t2-failing.log`): 1 file failed, 1
test failed of 1.

```
[vite] (client) [Unhandled error] Error: a λ pane was handed a second editor while still holding one
AssertionError: a handler threw: expected [ Array(1) ] to deeply equal []
+   "Uncaught Error: a λ pane was handed a second editor while still holding one",
```

- [ ] **Step 3: Write the source**

In `web/src/pane-host.ts`:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1573,6 +1573,14 @@ export function createPaneHost(deps: {
               unhandled(p.kind)
           }
           p.slot.rebind(session)
+          // **A VIEW OFF THE PAGE, MOVED ONTO THE PROGRAM, HAS ITS COPY'S EDITOR TAKEN DOWN HERE** — the view layouts
+          // spec §5.5. The teardown is `setDetached(false)`, which `draw.ts` drives through `PaneSlot.render` for
+          // every view on the page and for no other. So a Stage tab that was not selected, and a view a switch
+          // parked, went on holding the editor of a copy they no longer showed; a delete and its *undo* then mounted
+          // a second on the first view moved back, and the next sweep handed that view the stale one and threw
+          // `handed a second editor while still holding one` (`tests/browser/stage-copy-editor.test.ts` has the throw).
+          // A view on the page is left to the `draw()` that follows, as it always was.
+          if (session === SOURCE_SESSION && !p.host.isConnected) p.pane.setDetached(false)
         },
       }))
     },
```

- [ ] **Step 4: Run them, and see them pass**

The same command (`t2-passing.log`): 1 file passed, 1 test passed.

- [ ] **Step 5: Break it on purpose, once a sabotage, and put it back**

Each entry is the replay's own record. Its `sab.sh` saved the file, made the edit, ran
`pnpm exec vitest run --project <project> <file>` for each file named, copied the saved file back and ran `cmp`.

**S2** `src/pane-host.ts`, `reseedingSlots`: the line
`if (session === SOURCE_SESSION && !p.host.isConnected) p.pane.setDetached(false)` deleted.
`sab.sh S2 browser:tests/browser/stage-copy-editor.test.ts` (`sab-S2-browser.log`): 1 failed of 1, as expected.

```
[vite] (client) [Unhandled error] Error: a λ pane was handed a second editor while still holding one
AssertionError: a handler threw: expected [ Array(1) ] to deeply equal []
+   "Uncaught Error: a λ pane was handed a second editor while still holding one",
```

Restored `src/pane-host.ts`, cmp equal.

The edit:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1580,7 +1580,6 @@
           // a second on the first view moved back, and the next sweep handed that view the stale one and threw
           // `handed a second editor while still holding one` (`tests/browser/stage-copy-editor.test.ts` has the throw).
           // A view on the page is left to the `draw()` that follows, as it always was.
-          if (session === SOURCE_SESSION && !p.host.isConnected) p.pane.setDetached(false)
         },
       }))
     },
```

- [ ] **Step 6: The whole suite**

`pnpm exec biome ci --error-on-warnings`, `pnpm exec tsc --noEmit -p .`, `pnpm exec vitest run --project node` and
`pnpm exec vitest run --project browser`, all from `web/`. On the replay, after this task:

| Check | Result |
|---|---|
| `biome ci --error-on-warnings` | exit 0, checked 363 files, 1 info |
| `tsc --noEmit -p .` | exit 0 |
| node | 67 files, 1248 tests, all passed |
| browser | 169 files, 1190 tests, all passed |

- [ ] **Step 7: Commit**

```bash
git add web/src/pane-host.ts \
  web/tests/browser/stage-copy-editor.test.ts
git commit -F - <<'EOF'
A view off the page that is moved onto the program has its copy's editor taken down: a Stage tab that was not selected went on holding the editor of a deleted copy, and the copy's undo then threw `a λ pane was handed a second editor while still holding one`
EOF
```

### Task 3: Each combination of views remembers its own arrangement, and the header's toggles choose which views show

The model (spec §4), the parked views (§5) and the toggles (§6). **The default layout is still all four views in this
task**; Task 4 changes it. So three files are in a form they do not keep:

- `web/src/layout.ts` gains `defaultArrangement` and leaves `defaultLayout()` as it is.
- `web/src/workspace.ts` gains `arrangements` and leaves `defaultWorkspace()` without its `shape` parameter.
- `web/tests/node/layout.test.ts` and `web/tests/node/workspace.test.ts` say `defaultLayout()` where Task 4 says
  `fourViews()`, and `web/tests/browser/view-toggles.test.ts` is without its last case, which is about the reset.

The harness gains the three four-view fixtures here, though Task 4 is what needs them everywhere: two of this task's
tests seed a stored workspace with `fourViewWorkspace()`.

**Files:**
- Modify: `web/index.html`
- Modify: `web/src/app-header.ts`
- Create: `web/src/arrangements.ts`
- Modify: `web/src/draw.ts`
- Modify: `web/src/layout.ts`
- Modify: `web/src/link-wiring.ts`
- Modify: `web/src/main.ts`
- Modify: `web/src/pane-host.ts`
- Modify: `web/src/style.css`
- Modify: `web/src/workspace.ts`
- Modify: `web/tests/browser/controls-gate.test.ts`
- Modify: `web/tests/browser/harness.ts`
- Create: `web/tests/browser/live-views-bound-switch.test.ts`
- Create: `web/tests/browser/live-views-bound.test.ts`
- Create: `web/tests/browser/parked-copy-editor-mount.test.ts`
- Create: `web/tests/browser/parked-copy-editor.test.ts`
- Create: `web/tests/browser/parked-view-surfaces.test.ts`
- Modify: `web/tests/browser/scratch-fork.test.ts`
- Create: `web/tests/browser/view-toggles.test.ts`
- Create: `web/tests/node/arrangements.test.ts`
- Modify: `web/tests/node/layout.test.ts`
- Modify: `web/tests/node/share-link.test.ts`
- Modify: `web/tests/node/workspace.test.ts`

**Interfaces:**
- Consumes: Task 1's `giveScrollBack()` call site in `applyLayout`.
- Produces, in `web/src/layout.ts`: `KIND_ORDER: readonly PaneKind[]`, `HEADER_ORDER: readonly PaneKind[]`,
  `KIND_WORD: Readonly<Record<PaneKind, string>>`, `type Shape = 'wide' | 'tall'`,
  `defaultArrangement(kinds: readonly PaneKind[], shape: Shape): LayoutNode`.
- Produces, in `web/src/arrangements.ts`: `type Combination = readonly PaneKind[]`,
  `type Arrangements = Readonly<Record<string, LayoutNode>>`, `combinationOf(tree)`, `keyOf(kinds)`, `treeKey(tree)`,
  `parseKey(key): Combination | null`, `toggled(kinds, kind): PaneKind[]`,
  `enter(now: { tree, arrangements }, next: LayoutNode): { tree, arrangements }`, `CYCLE`,
  `cycleFrom(kinds, step: 1 | -1): Combination`, `liveLeaves(tree, arrangements): Map<LeafId, PaneKind>`,
  `shapeOf(area: Extent): Shape`.
- Produces, in `web/src/workspace.ts`: `Workspace.arrangements: Arrangements`.
- Produces, in `web/src/pane-host.ts`: `PaneHost.switchViews(id: LeafId): void`, and two new dependencies of
  `createPaneHost`: `liveLeaves(): ReadonlyMap<LeafId, PaneKind>` and `applied(): void`.
- Produces, in `web/src/app-header.ts`: `viewToggles(group, pick): { sync(shown) }`, `shownSentence(shown): string`.
- Produces, in `web/src/main.ts`: `viewsShape()`, `arranged(id)`, `enterTree(next, switching = false)`,
  `switchTo(target: Combination)`. Task 5's keys call `switchTo`.
- Produces, in `web/src/draw.ts` and `web/src/link-wiring.ts`: a required dependency `arranged: (id: LeafId) => boolean`.
- Produces, in the markup: `#views-shown`, holding `button[data-shows]` with `aria-pressed`.
- Produces, in `web/tests/browser/harness.ts`: `fourViews()`, `fourViewWorkspace()`, `storeFourViews()`.

- [ ] **Step 1: Write the tests**

In `web/tests/browser/controls-gate.test.ts`:

```diff
--- a/web/tests/browser/controls-gate.test.ts
+++ b/web/tests/browser/controls-gate.test.ts
@@ -1,6 +1,7 @@
 import type { EditorView } from '@codemirror/view'
 import { computeAccessibleName } from 'dom-accessibility-api'
 import { afterAll, beforeAll, describe, expect, it } from 'vitest'
+import { page } from 'vitest/browser'
 import { DAY, EMBER, legacyLayout } from '../node/base16-fixtures'
 import { SHELL, until } from './harness'
 
@@ -457,6 +458,38 @@ describe('every control in Explorer, in the settings menu and the import dialog'
  * after it. A closed dialog's controls need no case of their own: the import dialog is on the page, closed, for every
  * walk above but its own.
  */
+/**
+ * THE `views` TOGGLES, WHICH THE WALKS ABOVE NEVER MEET (the view layouts spec §6): this file runs in the runner's
+ * 414 px window, and `main.ts` hides the toggles in a window 40rem wide or narrower. So the window is widened for
+ * this one group, and **THE TOGGLES ARE ASSERTED TO BE AMONG WHAT WAS WALKED**, since a walk that skipped them would
+ * pass as the ones above do.
+ */
+describe('every control in Explorer, in a window wide enough for the views toggles', () => {
+  const toggles = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('#views-shown button')]
+  beforeAll(async () => {
+    await page.viewport(1280, 896)
+  })
+  afterAll(async () => {
+    for (const b of toggles()) if (b.getAttribute('aria-pressed') === 'false') b.click()
+    await page.viewport(414, 896)
+  })
+
+  it('walks the four toggles, each named by its own word', () => {
+    const walked = check('wide: page')
+    expect(toggles()).toHaveLength(4)
+    for (const b of toggles()) expect(walked, `the walk skipped the ${b.textContent} toggle`).toContain(b)
+    expect(toggles().map(nameOf)).toEqual(['source', 'asm', 'λ', 'TM'])
+  })
+
+  it('walks them with one view left, where the last toggle is disabled and still named', () => {
+    for (const b of toggles().slice(1)) b.click()
+    expect(toggles().map((b) => b.disabled)).toEqual([true, false, false, false])
+    const walked = check('wide: one view')
+    expect(walked).toContain(toggles()[0])
+    expect(nameOf(toggles()[0] as HTMLButtonElement)).toBe('source')
+  })
+})
+
 describe('the walk itself', () => {
   it('skips a hidden input', () => {
     const hidden = document.createElement('input')
```

In `web/tests/browser/harness.ts`:

```diff
--- a/web/tests/browser/harness.ts
+++ b/web/tests/browser/harness.ts
@@ -1,5 +1,7 @@
 import html from '../../index.html?raw'
+import { LAYOUT_STORAGE_KEY, type LayoutNode } from '../../src/layout'
 import { PREPAINT } from '../../src/prepaint'
+import { defaultWorkspace, serializeWorkspace, type Workspace } from '../../src/workspace'
 
 /**
  * Shared browser-tier fixtures: the app shell every test file mounts into, and the poll helper every
@@ -35,6 +37,7 @@ export const SHELL = `
     <div id="workspace-menu" class="header-menu" popover>
       <button type="button" id="reset-preset">reset preset — restores the default views</button>
     </div>
+    <div id="views-shown" class="views-shown" role="group" aria-label="views"></div>
     <button type="button" id="new-view" aria-haspopup="menu" aria-controls="new-view-menu" aria-expanded="false">+ view</button>
     <div id="new-view-menu" class="header-menu" popover></div>
     <button type="button" id="buffers">copies <span aria-hidden="true">▾</span></button>
@@ -295,3 +298,49 @@ export const choosePalette = (value: string): Promise<void> => chooseSetting('#p
 
 /** Pick a style from the settings menu, as `chooseSetting` does. */
 export const chooseStyle = (value: string): Promise<void> => chooseSetting('#style', value)
+
+/**
+ * All four views in two rows of two: source and λ over asm and TM. A fresh page built this tree until the view
+ * layouts, and most files here were written against it; `layout.ts`'s `defaultLayout()` is the source beside the TM
+ * view now. A file that wants four views says so with this, where it used to say `defaultLayout()`.
+ *
+ * **SPELLED OUT, NOT TAKEN FROM `defaultArrangement`**: all four views' default there is two COLUMNS of two now, with
+ * the same views in the same corners, and what these files measure is this tree — its row dividers, its paths, and
+ * the order its leaves come in.
+ */
+export const fourViews = (): LayoutNode => ({
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
+    {
+      kind: 'split',
+      dir: 'row',
+      sizes: [0.5, 0.5],
+      children: [
+        { kind: 'leaf', id: 'asm-0', pane: 'asm' },
+        { kind: 'leaf', id: 'tm-0', pane: 'tm' },
+      ],
+    },
+  ],
+})
+
+/**
+ * The workspace a four-view page stored: `fourViews()`, Explorer, the focus on the λ view, nothing remembered. It is
+ * what `defaultWorkspace()` answered until the view layouts, and what `setup.ts` stores for every file.
+ */
+export const fourViewWorkspace = (): Workspace => ({ ...defaultWorkspace(), tree: fourViews(), focused: 'lambda-0' })
+
+/** Store `fourViewWorkspace()` — for a file that clears storage before its mount and was written against four views. */
+export const storeFourViews = (): void => {
+  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(fourViewWorkspace()))
+}
```

Create `web/tests/browser/live-views-bound-switch.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode, MAX_TREE_LEAVES } from '../../src/layout'
import { serializeWorkspace } from '../../src/workspace'
import { fourViewWorkspace, SHELL, until } from './harness'

/**
 * **A SWITCH IS REFUSED WHERE ITS VIEWS WOULD TAKE THE LIVE ONES PAST 64** — the view layouts spec §4.5 and §5.6. A
 * combination's first visit shows its default arrangement, whose leaves are the default ids, and the arrangement left
 * is remembered, so its views stay live. Where the workspace does not hold those ids already, the switch adds views:
 * it is held to the bound as `+ view` is, with the same notice, and changes nothing.
 *
 * The page opens on a stored tree of 64 λ views, `pane-1` to `pane-64`, with no source view and nothing remembered.
 * Pressing the source toggle asks for the source beside a λ view, whose default needs `source` and `lambda-0`: two
 * ids the workspace does not hold, which would make 66 live views. `main.ts`'s `switchTo` refuses it.
 *
 * `live-views-bound.test.ts` holds the bound for `+ view`. Storage is read once, at the mount, so each stores its
 * own workspace before it and each is a file.
 */

/** `MAX_TREE_LEAVES` λ views in one row, and no other view. */
const SIXTY_FOUR: LayoutNode = {
  kind: 'split',
  dir: 'row',
  sizes: Array.from({ length: MAX_TREE_LEAVES }, () => 1 / MAX_TREE_LEAVES),
  children: Array.from(
    { length: MAX_TREE_LEAVES },
    (_, i) => ({ kind: 'leaf', id: `pane-${i + 1}`, pane: 'lambda' }) as const,
  ),
}
const IDS = Array.from({ length: MAX_TREE_LEAVES }, (_, i) => `pane-${i + 1}`)
const FULL = 'the workspace holds 64 views, the most it can keep — close one to add another'

const toggle = (kind: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`) as HTMLButtonElement
const pressed = (): string[] =>
  [...document.querySelectorAll<HTMLButtonElement>('#views-shown button[aria-pressed="true"]')].map(
    (b) => b.dataset.shows as string,
  )
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const stored = (): string | null => localStorage.getItem(LAYOUT_STORAGE_KEY)
const noticeText = (): string => document.querySelector('#notice .notice-text')?.textContent ?? ''

beforeAll(async () => {
  await page.viewport(1280, 896)
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...fourViewWorkspace(), tree: SIXTY_FOUR, focused: 'pane-1' }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('the source toggle, with 64 λ views on screen and no source view', () => {
  /**
   * **THE NOTICE AND WHAT IS LEFT AS IT WAS ARE EACH ASSERTED SOFT**, so a switch that went through is reported in
   * each: by the line, by the views and the toggles it left, and by the workspace it stored. The stored workspace is
   * compared whole and reported as a yes or a no, since two workspaces of 64 views are not a diff anyone reads.
   */
  it('is refused in the full workspace’s words, and changes nothing', async () => {
    // A STORED WORKSPACE THE LOADER REFUSED WOULD HAVE OPENED ON THE DEFAULT, the source beside the TM view.
    expect(mounted(), 'precondition: the page opened on the stored 64 views').toEqual(IDS)
    expect(pressed(), 'precondition: the λ toggle alone is pressed').toEqual(['lambda'])
    expect(JSON.parse(stored() ?? '{}').arrangements, 'precondition: nothing is remembered').toBeUndefined()
    expect(toggle('source').disabled, 'precondition: the source toggle can be pressed').toBe(false)

    const before = { mounted: mounted(), pressed: pressed(), stored: stored() }
    expect(before.stored, 'precondition: a workspace is stored').not.toBeNull()
    await userEvent.click(toggle('source'))

    expect.soft(noticeText(), 'the switch was not refused as a full workspace is').toBe(FULL)
    expect.soft(pressed(), 'the refused switch moved the toggles').toEqual(before.pressed)
    expect.soft(mounted(), 'the refused switch changed the views on the page').toEqual(before.mounted)
    expect.soft(stored() === before.stored, 'the refused switch stored another workspace').toBe(true)
  })
})
```

Create `web/tests/browser/live-views-bound.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY, type LayoutNode, leaves, MAX_TREE_LEAVES, MIN_VIEW_PX } from '../../src/layout'
import { DIVIDER_PX } from '../../src/layout-view'
import { parseWorkspace, serializeWorkspace } from '../../src/workspace'
import { fourViewWorkspace, SHELL, until } from './harness'

/**
 * **THE 64-VIEW BOUND IS ON EVERY LIVE VIEW, AND `+ VIEW` IS HELD TO IT** — the view layouts spec §5.6. A view a
 * remembered arrangement holds is live: it is kept off the page, or after a reload built when its arrangement is
 * entered. `parseWorkspace` refuses a stored workspace whose tree and remembered arrangements name more than 64 ids
 * between them. So an add is refused at 64 live views, however few of them the tree on screen holds, in the words an
 * add to a full tree gets: the app never stores a workspace its own loader refuses.
 *
 * The page opens on a stored workspace of exactly 64: the four views on screen, and 60 λ views in the arrangement
 * remembered for the λ view alone. Storage is read once, at the mount, so the workspace is stored before it, as
 * `add-view-floor.test.ts` stores its own. A third view in the λ view's row would leave each over the 160 px floor,
 * which the case asserts, so room is not what refuses the add: `pane-host.ts`'s `admit` asks the bound of the live
 * views before it asks about room.
 *
 * `live-views-bound-switch.test.ts` holds the bound for a switch, which needs another stored workspace and so
 * another mount.
 */

/** 60 λ views in one row: the arrangement the stored workspace remembers for the λ view alone. */
const SIXTY: LayoutNode = {
  kind: 'split',
  dir: 'row',
  sizes: Array.from({ length: 60 }, () => 1 / 60),
  children: Array.from({ length: 60 }, (_, i) => ({ kind: 'leaf', id: `pane-${i + 1}`, pane: 'lambda' }) as const),
}

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']
const FULL = 'the workspace holds 64 views, the most it can keep — close one to add another'

const views = (): HTMLElement => document.querySelector<HTMLElement>('#views') as HTMLElement
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const stored = (): string | null => localStorage.getItem(LAYOUT_STORAGE_KEY)
const noticeText = (): string => document.querySelector('#notice .notice-text')?.textContent ?? ''

beforeAll(async () => {
  await page.viewport(1280, 896)
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...fourViewWorkspace(), arrangements: { lambda: SIXTY } }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('+ view, with four views on screen and 60 more remembered', () => {
  /**
   * **THE NOTICE AND WHAT IS LEFT AS IT WAS ARE EACH ASSERTED SOFT**, so an add that went through is reported in
   * each: by the words on the line, by the view it made, and by the workspace it stored. The stored workspace is
   * compared whole and reported as a yes or a no, since two workspaces of 64 views are not a diff anyone reads.
   */
  it('is refused in the full workspace’s words, and changes nothing', async () => {
    // A STORED WORKSPACE THE LOADER REFUSED WOULD HAVE OPENED ON THE DEFAULT, the source beside the TM view.
    expect(mounted(), 'precondition: the page opened on the stored workspace').toEqual(FOUR)
    const opened = parseWorkspace(stored())
    if (opened === null) throw new Error('the stored workspace does not parse')
    expect(Object.keys(opened.arrangements), 'precondition: one arrangement is remembered').toEqual(['lambda'])
    const live = new Set(
      [opened.tree, ...Object.values(opened.arrangements)].flatMap((t) => leaves(t)).map((l) => l.id),
    )
    expect(live.size, 'precondition: the live views are exactly the bound').toBe(MAX_TREE_LEAVES)
    expect(opened.focused, 'precondition: + view adds beside the λ view').toBe('lambda-0')
    // ROOM IS NOT WHAT REFUSES IT: a third view in the λ view's row leaves each an equal share over the floor.
    const share = (views().getBoundingClientRect().width - 2 * DIVIDER_PX) / 3
    expect(share, 'precondition: a third view in the row keeps the floor').toBeGreaterThanOrEqual(MIN_VIEW_PX)

    const before = { mounted: mounted(), stored: stored() }
    expect(before.stored, 'precondition: a workspace is stored').not.toBeNull()
    await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
    const item = (): HTMLButtonElement | undefined =>
      [...document.querySelectorAll<HTMLButtonElement>('#new-view-menu button')].find(
        (b) => b.textContent === 'λ · program',
      )
    await until(() => item() !== undefined, '+ view’s λ · program')
    await userEvent.click(item() as HTMLButtonElement)

    expect.soft(noticeText(), 'the add was not refused as a full workspace is').toBe(FULL)
    expect.soft(mounted(), 'the refused add changed the views on the page').toEqual(before.mounted)
    expect.soft(stored() === before.stored, 'the refused add stored another workspace').toBe(true)
  })
})
```

Create `web/tests/browser/parked-copy-editor-mount.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * A PARKED VIEW THAT COMES BACK SHOWING A COPY NO VIEW HOLDS AN EDITOR FOR — the view layouts spec §5.5.
 *
 * A machine copy's editor lives in one view. When that view closes the editor is destroyed, and `pane-host.ts`'s
 * `mountOnViewOf` mounts a fresh one on a view of the copy in the tree on screen. A view a switch parked is not in
 * that tree. So with the copy's second view parked and its first view closed, the copy had no editor anywhere, and
 * the parked view came back showing it with none and with no *move the editor here* in its menu (measured with the
 * mount taken out, 2026-10-12): a view offers that only while an editor exists. `applyLayout` mounts one on a view
 * that returns from a remembered arrangement showing such a copy, as its creation pass does for a view it builds.
 *
 * **A TM COPY, NOT A λ ONE**: a λ copy's editor waits in custody when its view closes, and the view that returns
 * offers to bring it over.
 *
 * **A FILE OF ITS OWN**, beside `parked-copy-editor.test.ts`, which holds §5.5's other defect and leaves its page on
 * two views of a λ copy: this scenario starts from all four views on the program, with nothing remembered.
 *
 * The toggles, `+ view` and `✕` are pressed with `userEvent`, as a user presses them; *edit a copy* is `.click()`,
 * since its item is in a menu the case does not open.
 */

const errors: string[] = []
const onError = (e: ErrorEvent): void => {
  errors.push(e.message)
}

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']

const leaf = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${id}"]:not([role="tab"])`)
const titleText = (id: string): string => leaf(id)?.querySelector('.view-title')?.textContent ?? ''
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const press = (kind: string): Promise<void> =>
  userEvent.click(document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`) as HTMLElement)
const editors = (id: string): number => leaf(id)?.querySelectorAll('.term-editor .cm-editor').length ?? 0
/** Every copy's editor on the page, in whichever view: the source editor is not in a `.term-editor`. */
const copyEditors = (): number => document.querySelectorAll('#views .term-editor .cm-editor').length
/** A view's *move the editor here*, which its menu holds only while it is offered. */
const claim = (id: string): HTMLButtonElement | null =>
  leaf(id)?.querySelector<HTMLButtonElement>('button.claim-editor') ?? null
/** The views on the page whose title is `title`. */
const showing = (title: string): string[] => mounted().filter((id) => titleText(id) === title)

beforeAll(async () => {
  window.addEventListener('error', onError)
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})
afterAll(() => window.removeEventListener('error', onError))

describe('a parked view of a TM copy whose other view, holding the editor, was closed', () => {
  it('has an editor when it comes back', async () => {
    expect(mounted(), 'precondition: all four views').toEqual(FOUR)
    leaf('tm-0')?.querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => titleText('tm-0') === 'TM · copy 1' && editors('tm-0') === 1, 'the copy and its editor')
    const copy = leaf('tm-0')?.querySelector<HTMLElement>('button.view-title')?.dataset.binding ?? ''
    expect(copy, 'precondition: the view’s title names its copy').toMatch(/^tm:scratch-\d+$/)

    // THE SOURCE BESIDE TM, WHERE THE SECOND VIEW OF THE COPY IS ADDED: that arrangement alone holds it.
    await press('lambda')
    await press('asm')
    expect(mounted(), 'precondition: the source beside the TM view').toEqual(['source', 'tm-0'])
    leaf('tm-0')?.querySelector<HTMLElement>('button.view-title')?.focus()
    await userEvent.click(document.querySelector<HTMLButtonElement>('#new-view') as HTMLButtonElement)
    const item = (): HTMLButtonElement | null =>
      document.querySelector<HTMLButtonElement>(`#new-view-menu button[data-binding="${copy}"]`)
    await until(() => item() !== null, '+ view’s item for the copy')
    await userEvent.click(item() as HTMLButtonElement)
    const second = mounted().find((id) => id !== 'source' && id !== 'tm-0')
    if (second === undefined) throw new Error('+ view added no second view of the copy')
    await until(() => titleText(second) === 'TM · copy 1', 'the second view of the copy')
    expect(editors('tm-0'), 'precondition: the editor stays in the first view').toBe(1)
    expect(editors(second), 'precondition: the second view holds no editor').toBe(0)
    expect(claim(second), 'precondition: the second view offers to take the editor').not.toBeNull()

    // ALL FOUR AGAIN, BY TWO SWITCHES: neither arrangement names the second view, so it is parked.
    await press('asm')
    await press('lambda')
    expect(mounted(), 'precondition: the second view is off the page').toEqual(FOUR)
    expect(titleText('tm-0'), 'precondition: the view on the page shows the copy').toBe('TM · copy 1')
    expect(editors('tm-0'), 'precondition: the view on the page holds the editor').toBe(1)

    // THE HOLDER IS CLOSED, WHICH DESTROYS THE EDITOR, and no view in the tree shows the copy to take a fresh one.
    await userEvent.click(leaf('tm-0')?.querySelector<HTMLButtonElement>('button.view-close') as HTMLButtonElement)
    expect(mounted(), 'precondition: the holder is closed').toEqual(['source', 'lambda-0', 'asm-0'])
    expect(copyEditors(), 'precondition: the copy’s editor went with its view').toBe(0)

    // THE TM TOGGLE SHOWS THE TREE BEFORE THE ✕, WITH A NEW VIEW ON THE PROGRAM WHERE THE CLOSED ONE WAS.
    await press('tm')
    expect(mounted(), 'precondition: all four views again').toEqual(FOUR)
    expect(titleText('tm-0'), 'precondition: the view built where the closed one was shows the program').toBe(
      'TM · program',
    )

    // BACK TO THE ARRANGEMENT THAT HOLDS THE PARKED VIEW.
    await press('lambda')
    await press('asm')
    expect(mounted()).toEqual(['source', 'tm-0', second])
    expect(errors, 'a handler threw').toEqual([])
    expect(titleText(second)).toBe('TM · copy 1')
    expect(showing('TM · copy 1'), 'precondition: the returned view alone shows the copy').toEqual([second])
    expect(editors(second), 'the view came back showing a copy with no editor').toBe(1)
  })
})
```

Create `web/tests/browser/parked-copy-editor.test.ts`:

```ts
import type { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

/**
 * A COPY DELETED AND RESTORED WHILE THE VIEW HOLDING ITS EDITOR IS OFF THE PAGE — the view layouts spec §5.5.
 *
 * A view that stops showing a copy has the copy's editor taken down by the next `draw()`, and `draw()` passes over a
 * view that is not on the page. So a view off the page went on holding the editor of a copy it no longer showed, and
 * a delete followed by its *undo* then gave the copy a second editor on the first view moved back: the next sweep
 * handed the first view the stale one and threw `handed a second editor while still holding one`.
 *
 * **TWO WAYS A VIEW IS OFF THE PAGE**: a view a switch parked, which the view layouts made and this file drives, and a
 * Stage tab that is not selected, which is older and is `stage-copy-editor.test.ts`'s. `pane-host.ts`'s
 * `reseedingSlots` takes the editor down as it moves a view off the page onto the program, for both.
 */

const errors: string[] = []
const onError = (e: ErrorEvent): void => {
  errors.push(e.message)
}

const leaf = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${id}"]:not([role="tab"])`)
const titleText = (id: string): string => leaf(id)?.querySelector('.view-title')?.textContent ?? ''
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const toggle = (kind: string): void =>
  document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`)?.click()
const editors = (id: string): number => leaf(id)?.querySelectorAll('.term-editor .cm-editor').length ?? 0
const COPY = bindingKey('lambda', 'scratch-1')

/** Fork the λ view, add a second view of the copy beside it, and move the copy's editor onto the second. */
async function twoViewsOfACopy(): Promise<string> {
  leaf('lambda-0')?.querySelector<HTMLButtonElement>('button.detach')?.click()
  await until(() => titleText('lambda-0') === 'λ · copy 1' && editors('lambda-0') === 1, 'the copy and its editor')
  leaf('lambda-0')?.querySelector<HTMLElement>('button.view-title')?.focus()
  const before = new Set([...document.querySelectorAll<HTMLElement>('#views [data-leaf]')].map((el) => el.dataset.leaf))
  document.querySelector<HTMLButtonElement>('#new-view')?.click()
  document.querySelector<HTMLButtonElement>(`#new-view-menu button[data-binding="${COPY}"]`)?.click()
  const second = [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .map((el) => el.dataset.leaf as string)
    .find((id) => !before.has(id))
  if (second === undefined) throw new Error('+ view added no second view of the copy')
  await until(() => leaf(second) !== null && titleText(second) === 'λ · copy 1', 'the second view of the copy')
  leaf(second)?.querySelector<HTMLButtonElement>('button.claim-editor')?.click()
  await until(() => editors(second) === 1 && editors('lambda-0') === 0, 'the editor to move to the second view')
  return second
}

async function deleteAndUndo(): Promise<void> {
  document.querySelector<HTMLButtonElement>('#buffers')?.click()
  document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label="delete λ copy 1"]')?.click()
  await until(() => titleText('lambda-0') === 'λ · program', 'the view on the page to move to the program')
  document.querySelector<HTMLElement>('.buffer-list')?.hidePopover()
  document.querySelector<HTMLButtonElement>('#notice button.notice-action')?.click()
  await until(() => titleText('lambda-0') === 'λ · copy 1' && editors('lambda-0') === 1, 'the copy and an editor back')
}

beforeAll(async () => {
  window.addEventListener('error', onError)
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})
afterAll(() => window.removeEventListener('error', onError))

describe('a copy deleted and restored while the view holding its editor is off the page', () => {
  it('gives the copy one editor when the holder was parked by a switch', async () => {
    // THE SOURCE BESIDE λ, WHERE THE SECOND VIEW IS ADDED: that arrangement alone holds it.
    toggle('asm')
    toggle('tm')
    expect(mounted()).toEqual(['source', 'lambda-0'])
    const second = await twoViewsOfACopy()
    // ALL FOUR AGAIN, BY TWO SWITCHES: neither arrangement names the second view, so it is parked, editor and all.
    toggle('asm')
    toggle('tm')
    expect(mounted(), 'precondition: the second view is off the page').toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
    expect(titleText('lambda-0'), 'precondition: the view on the page shows the copy').toBe('λ · copy 1')
    expect(editors('lambda-0'), 'precondition: the editor is not on the page').toBe(0)

    await deleteAndUndo()
    // BACK TO THE ARRANGEMENT THAT HOLDS THE PARKED VIEW.
    toggle('tm')
    toggle('asm')
    expect(mounted()).toEqual(['source', 'lambda-0', second])
    expect(errors, 'a handler threw').toEqual([])
    expect(titleText(second)).toBe('λ · copy 1')
    expect(editors('lambda-0') + editors(second), 'the copy has two editors, or none').toBe(1)
  })
})
```

Create `web/tests/browser/parked-view-surfaces.test.ts`:

```ts
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * THE SURFACES THE VIEWS SHARE DO NOT READ A PARKED VIEW — the view layouts spec §5.3.
 *
 * A view a switch takes off the screen keeps its entry in the pane collection, so what keeps a view true still reaches
 * it: a reply about its session, a copy deleted under it. Four surfaces describe the views to the user instead, and
 * each reads the views of the tree on screen alone: the step bar's target, the running focuses, the link status line,
 * and the share popover's line about copies. A parked view has no tab and no place on the page, so a surface that
 * read one would drive, mark or count a view no one can see.
 *
 * Each case parks the λ view with its toggle and reads one of them. Three filters hold the four: `main.ts`'s
 * `barTargetNow` for the bar; `draw.ts`'s `watched` for the running focuses, of which the case reads the λ leg's, in
 * the source editor; and `link-wiring.ts`'s `detachedPanes` for the status line and the popover, which both read it.
 * With its own filter taken out a case fails, and the other two pass (run 2026-10-12).
 *
 * **THE CASES SHARE ONE PAGE, AND EACH PUTS IT BACK BEFORE IT STARTS** (`start`): Explorer and all four views, which
 * it then asserts, with the λ view on the program. The last case leaves the λ view on a copy, which is why it is last.
 *
 * **THE GESTURES UNDER TEST ARE `userEvent`'S**: the toggle, pressed as `view-toggles.test.ts` presses it, since a
 * synthetic click reaches a handler a real pointer cannot; the bar's step button; and `share`. What only sets a case
 * up is `.click()` and `.focus()`.
 */

const FOUR = ['source', 'lambda-0', 'asm-0', 'tm-0']
/** `link-status.ts`'s `detachedText` for the one λ view on a copy, verbatim. */
const SHOWS_A_COPY = 'λ view shows a copy — not linked to the program'
/** `share-popover.ts`'s `copiesLine` for that view, verbatim. */
const NOT_INCLUDED = 'copies are not included — the λ · copy 1 view will open on the program'

let view: EditorView

const toggle = (kind: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`) as HTMLButtonElement
const press = (kind: string): Promise<void> => userEvent.click(toggle(kind))
const host = (leaf: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${leaf}"]:not([role="tab"])`)
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const titleText = (leaf: string): string => host(leaf)?.querySelector('.view-title')?.textContent ?? ''
const preset = (): string => document.querySelector('#workspace')?.textContent?.replace('▾', '').trim() ?? ''
const pick = (sel: string): void => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  const menu = document.querySelector<HTMLElement>('#workspace-menu')
  if (menu?.matches(':popover-open')) menu.hidePopover()
}
const bar = (): HTMLElement => document.querySelector<HTMLElement>('#step-bar') as HTMLElement
/** The title of the view the bar drives, which `step-bar.ts` writes in front of its controls; `''` for none. */
const barTitle = (): string => bar().querySelector('.step-bar-title')?.textContent?.trim() ?? ''
const barStep = (): string => bar().querySelector('.step-bar-inner .step')?.textContent?.trim() ?? ''
const barButton = (name: string): HTMLButtonElement =>
  bar().querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) as HTMLButtonElement
/** A step control of the λ view's own, by its accessible name. */
const lambdaButton = (name: string): HTMLButtonElement =>
  host('lambda-0')?.querySelector<HTMLButtonElement>(`.controls button[aria-label="${name}"]`) as HTMLButtonElement
/** Put the keyboard focus in the λ view, on its title, which makes it the focused view. */
const focusLambda = (): void => host('lambda-0')?.querySelector<HTMLElement>('button.view-title')?.focus()
const lambdaStep = (): string => host('lambda-0')?.querySelector('.step')?.textContent ?? ''
/**
 * The source editor's running focus as `<claim>:<text>`, or `''` for none: the mark `highlight.ts`'s `focusMark`
 * paints, read as `running-focus.test.ts` reads it. Asked of the source view alone, since a copy's editor is a
 * `.cm-editor` too.
 */
const sourceFocus = (): string => {
  const mark = host('source')?.querySelector('.is-focus-exact, .is-focus-within, .is-focus-coincident')
  return mark == null ? '' : `${mark.className.replace('is-focus-', '')}:${mark.textContent ?? ''}`
}
const status = (): string => document.querySelector('#link-status')?.textContent ?? ''
const editors = (leaf: string): number => host(leaf)?.querySelectorAll('.term-editor .cm-editor').length ?? 0

/** Open the share popover with the pointer, read its line about copies, `null` where it has none, and shut it. */
async function sharedCopies(): Promise<string | null> {
  const menu = document.querySelector<HTMLElement>('#share-menu') as HTMLElement
  await userEvent.click(document.querySelector<HTMLButtonElement>('#share') as HTMLButtonElement)
  expect(menu.matches(':popover-open'), 'the share popover did not open').toBe(true)
  const line = menu.querySelector('#share-copies')?.textContent ?? null
  menu.hidePopover()
  return line
}

/** Each case's start: Explorer and all four views, put back and then asserted, with the λ view on the program. */
function start(): void {
  if (preset() !== 'Explorer') pick('[data-preset="explorer"]')
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views-shown button[aria-pressed="false"]')) b.click()
  expect(preset(), 'precondition: Explorer').toBe('Explorer')
  expect(mounted(), 'precondition: all four views').toEqual(FOUR)
  expect(titleText('lambda-0'), 'precondition: the λ view shows the program').toBe('λ · program')
}

describe('the surfaces the views share, with the λ view parked', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  /**
   * **THE BAR KEEPS "THE LAST VIEW THAT COULD STEP" WHILE THE FOCUSED VIEW CANNOT** (Plan 7 part 2 spec §8), and the
   * source view cannot. So with the caret in the source editor the bar still drives the λ view, and parking the λ view
   * then is the case where the bar's memory names a view that has left the screen.
   *
   * **WHAT THE BAR NAMES AND WHAT ITS BUTTON MOVES ARE EACH ASSERTED SOFT**, so a bar still pointed at the parked view
   * is reported in both: by its title, and by the λ leg's step, read off the bar once the view is back and focused.
   */
  it('points the step bar at a view on the page, and steps that one, once the λ view it drove is parked', async () => {
    start()
    pick('[data-preset="debugger"]')
    expect(preset(), 'precondition: Debugger').toBe('Debugger')
    expect(bar().hidden, 'precondition: the step controls are the one bar').toBe(false)
    focusLambda()
    expect(barTitle(), 'precondition: the bar drives the focused λ view').toBe('λ · program')
    barButton('back to the oldest kept step').click()
    barButton('one step forward').click()
    const left = barStep()
    expect(left, 'precondition: the λ leg is at step 1').toMatch(/^step 1 of /)
    view.focus()
    await until(() => view.hasFocus, 'the source editor to take the focus')
    expect(barTitle(), 'precondition: with the caret in the source editor the bar keeps the λ view').toBe('λ · program')

    await press('lambda')
    expect(host('lambda-0'), 'precondition: the λ view is parked').toBeNull()
    const onPage = mounted().map(titleText)
    expect.soft(onPage, 'the bar names a view that is not on the page').toContain(barTitle())

    const named = barStep()
    await userEvent.click(barButton('one step forward'))
    expect(barStep(), 'precondition: the press stepped the view the bar names').not.toBe(named)
    await press('lambda')
    focusLambda()
    expect(barTitle(), 'precondition: the bar reads the λ view again').toBe('λ · program')
    expect.soft(barStep(), 'the bar’s step button moved the λ leg while its view was parked').toBe(left)
  })

  /**
   * The mark is the λ leg's: `let x = 40; x + 2` at step 1 contracts the `let`, which `running-focus.test.ts` measured
   * and holds. The leg does not move while its view is parked, so the mark that comes back with the view is the one
   * that left.
   */
  it('takes the λ leg’s running focus off the source editor while the λ view is parked', async () => {
    start()
    lambdaButton('back to the oldest kept step').click()
    lambdaButton('one step forward').click()
    expect(lambdaStep(), 'precondition: the λ leg is at step 1').toContain('step 1 of ')
    expect(sourceFocus(), 'precondition: the source editor marks the construct the λ leg is at').toBe(
      'exact:let x = 40;',
    )

    await press('lambda')
    expect(host('lambda-0'), 'precondition: the λ view is parked').toBeNull()
    expect(sourceFocus(), 'the source editor carries the running focus of a term no view shows').toBe('')

    await press('lambda')
    expect(lambdaStep(), 'the λ leg moved while its view was parked').toContain('step 1 of ')
    expect(sourceFocus(), 'the mark did not come back with the view').toBe('exact:let x = 40;')
  })

  /**
   * **BOTH SURFACES READ ONE COUNT**, `link-wiring.ts`'s `detachedPanes`: the status line names each view showing a
   * copy, and the share popover names the views a link will open on the program instead. A link carries the tree on
   * screen alone (spec §4.7), so a parked view is not one of them.
   *
   * **SOFT WHERE THE VIEW IS PARKED**, so a parked view that is counted is reported in each place it shows.
   */
  it('leaves a parked view of a copy out of the link status line and the share popover', async () => {
    start()
    host('lambda-0')?.querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => titleText('lambda-0') === 'λ · copy 1' && editors('lambda-0') === 1, 'the copy and its editor')
    expect(status(), 'precondition: the status line names the view showing a copy').toBe(SHOWS_A_COPY)
    expect(await sharedCopies(), 'precondition: the share popover names the view showing a copy').toBe(NOT_INCLUDED)

    await press('lambda')
    expect(host('lambda-0'), 'precondition: the λ view is parked').toBeNull()
    expect.soft(status(), 'the status line counts a parked view of a copy').toBe('')
    expect.soft(await sharedCopies(), 'the share popover lists a parked view of a copy').toBeNull()

    await press('lambda')
    expect(titleText('lambda-0'), 'the view did not come back showing its copy').toBe('λ · copy 1')
    expect(status()).toBe(SHOWS_A_COPY)
    expect(await sharedCopies()).toBe(NOT_INCLUDED)
  })
})
```

In `web/tests/browser/scratch-fork.test.ts`:

```diff
--- a/web/tests/browser/scratch-fork.test.ts
+++ b/web/tests/browser/scratch-fork.test.ts
@@ -633,6 +633,7 @@ describe('the no-session report for a failed fork', () => {
           drawn += 1
         },
         viewTitle: () => '',
+        arranged: () => true,
       })
       const notified: string[] = []
       const replies = createReplies({
```

Create `web/tests/browser/view-toggles.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { SHELL, until } from './harness'

/**
 * THE HEADER'S `views` TOGGLES — the view layouts spec §4 to §6: a press shows another combination of views, each
 * combination remembers its own arrangement, and a view off the page is kept alive.
 *
 * The page starts on all four views (`setup.ts` stores that workspace for every file), so every toggle starts
 * pressed. **THE CASES RUN IN ORDER ON ONE PAGE**, each from the state the one before left, and each begins by
 * asserting that state, so a case that is run alone fails on its precondition rather than on a wrong page.
 *
 * **PRESSES ARE `userEvent.click`, NOT `.click()`**: a synthetic click reaches a handler a real pointer cannot, and
 * what these cases assert includes where the focus is after a real press.
 */

const toggle = (kind: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`) as HTMLButtonElement
const pressed = (): string[] =>
  [...document.querySelectorAll<HTMLButtonElement>('#views-shown button[aria-pressed="true"]')].map(
    (b) => b.dataset.shows as string,
  )
const host = (leaf: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#views [data-leaf="${leaf}"]:not([role="tab"])`)
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const tabs = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [role="tab"]')].map((t) => t.dataset.leaf as string)
const live = (): string => (document.querySelector('#live')?.textContent ?? '').trim()
type Stored = { tree: unknown; focused: string; arrangements?: Record<string, unknown> }
const stored = (): Stored => JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null')
const press = (kind: string): Promise<void> => userEvent.click(toggle(kind))
const pick = async (sel: string): Promise<void> => {
  await userEvent.click(document.querySelector('#workspace') as HTMLElement)
  await userEvent.click(document.querySelector(`#workspace-menu ${sel}`) as HTMLElement)
  const menu = document.querySelector<HTMLElement>('#workspace-menu')
  if (menu?.matches(':popover-open')) menu.hidePopover()
}
const ALL = 'source+lambda+asm+tm'

describe('the views toggles', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  it('starts with all four views on the page and all four toggles pressed', () => {
    expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
    expect(pressed()).toEqual(['source', 'asm', 'lambda', 'tm'])
    expect(stored().arrangements, 'the stored workspace already remembers an arrangement').toBeUndefined()
  })

  it('hides a kind on a press: the view leaves the page, the toggle says so, and the focus stays on it', async () => {
    const four = stored().tree
    await press('asm')
    expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
    expect(host('asm-0'), 'the asm view is still on the page').toBeNull()
    expect(pressed()).toEqual(['source', 'lambda', 'tm'])
    expect(toggle('asm').title).toBe('show the asm view')
    expect(live()).toBe('showing source, λ and TM')
    expect(document.activeElement, 'the press cost the toggle its focus').toBe(toggle('asm'))
    // THE ARRANGEMENT LEFT IS REMEMBERED UNDER ITS OWN KEY, AND THE ONE ON SCREEN UNDER NONE.
    expect(stored().arrangements).toEqual({ [ALL]: four })
  })

  /**
   * THE USER'S RULE FOR A WIDE WINDOW (2026-10-11): columns side by side, each with its own stack, so no view and no
   * divider runs the whole width. Three views are the first beside a column of the other two.
   */
  it('shows a combination’s default on its first visit: source beside a column of λ over TM', () => {
    const area = (document.querySelector('#views') as HTMLElement).getBoundingClientRect()
    const source = (host('source') as HTMLElement).getBoundingClientRect()
    const lambda = (host('lambda-0') as HTMLElement).getBoundingClientRect()
    const tm = (host('tm-0') as HTMLElement).getBoundingClientRect()
    expect(Math.abs(source.height - area.height), 'the source view is not the full height').toBeLessThan(1)
    expect(source.right).toBeLessThanOrEqual(lambda.left)
    expect(Math.abs(source.top - lambda.top)).toBeLessThan(1)
    expect(tm.top, 'the TM view is not under the λ view').toBeGreaterThanOrEqual(lambda.bottom)
    expect(Math.abs(tm.left - lambda.left), 'the TM view is not in the λ view’s column').toBeLessThan(1)
    for (const view of [source, lambda, tm])
      expect(view.width, 'a view runs the whole width').toBeLessThan(area.width * 0.6)
  })

  it('shows it again on a second press, in the arrangement that was left', async () => {
    const three = stored().tree
    const four = stored().arrangements?.[ALL]
    await press('asm')
    expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
    expect(stored().tree, 'the four views did not come back as they were left').toEqual(four)
    expect(stored().arrangements).toEqual({ 'source+lambda+tm': three })
    expect(live()).toBe('showing source, asm, λ and TM')
    expect(toggle('asm').title).toBe('hide the asm view')
  })

  /**
   * THE VIEW IS KEPT ALIVE, NOT BUILT AGAIN (spec §5.2): its pane is the one that left. The λ view's display is
   * asked of the element, which a view built again from the workspace would have replaced.
   */
  it('keeps a view alive off the page: the element that comes back is the one that left', async () => {
    const before = host('tm-0')
    const inner = before?.firstElementChild
    expect(inner, 'the TM view has nothing in it to recognise').not.toBeNull()
    await press('tm')
    expect(host('tm-0')).toBeNull()
    expect(before?.isConnected).toBe(false)
    await press('tm')
    expect(host('tm-0'), 'another host came back').toBe(before)
    expect(host('tm-0')?.firstElementChild, 'the view was built again while it was off the page').toBe(inner)
  })

  /**
   * A REBUILD DETACHES EVERY HOST, AND A DETACHED ELEMENT COMES BACK SCROLLED TO ITS START (spec §5.2). Measured
   * before `pane-host.ts` held the positions: this table, at 120 px, was at 0 after the ASM toggle was pressed. So the
   * first half of this case is about a view that never leaves the page, and fails without the hold as the second does.
   */
  it('keeps where a view was scrolled to, through another view’s toggle and through its own', async () => {
    const table = (): HTMLElement => host('tm-0')?.querySelector('.state-table') as HTMLElement
    expect(table().scrollHeight - table().clientHeight, 'precondition: the rule table scrolls').toBeGreaterThan(200)
    table().scrollTop = 120
    table().dispatchEvent(new Event('scroll'))
    await until(() => table().scrollTop === 120, 'the table to hold its scroll')
    await press('asm')
    expect(table().scrollTop, 'another view’s toggle reset the table').toBe(120)
    await press('asm')
    expect(table().scrollTop, 'another view’s toggle reset the table on the way back').toBe(120)
    await press('tm')
    expect(host('tm-0')).toBeNull()
    await press('tm')
    expect(table().scrollTop, 'the table came back at its start').toBe(120)
    table().scrollTop = 0
    table().dispatchEvent(new Event('scroll'))
  })

  it('shows a pair side by side the first time it is visited', async () => {
    await press('lambda')
    await press('asm')
    expect(mounted()).toEqual(['source', 'tm-0'])
    const source = (host('source') as HTMLElement).getBoundingClientRect()
    const tm = (host('tm-0') as HTMLElement).getBoundingClientRect()
    expect(Math.abs(source.top - tm.top)).toBeLessThan(1)
    expect(source.right).toBeLessThanOrEqual(tm.left)
    expect(Math.abs(source.width - tm.width)).toBeLessThan(1)
    expect(live()).toBe('showing source and TM')
  })

  it('disables the last toggle pressed, with its reason, and enables it when another view is shown', async () => {
    expect(pressed(), 'precondition: the source and TM views').toEqual(['source', 'tm'])
    await press('source')
    expect(pressed()).toEqual(['tm'])
    expect(mounted()).toEqual(['tm-0'])
    const last = toggle('tm')
    expect(last.disabled).toBe(true)
    expect(last.getAttribute('aria-pressed'), 'the one view shown reads as not shown').toBe('true')
    expect(last.title).toBe('the TM view is the only one shown — one view stays')
    expect(last.getAttribute('aria-description')).toBe(last.title)
    expect([toggle('source'), toggle('lambda'), toggle('asm')].every((b) => !b.disabled)).toBe(true)
    await press('source')
    expect(toggle('tm').disabled).toBe(false)
    expect(toggle('tm').title).toBe('hide the TM view')
    expect(toggle('tm').hasAttribute('aria-description')).toBe(false)
  })

  /** Spec §4.3's second property, through the page: the tree before a `✕` is what the closed kind's toggle shows. */
  it('shows the tree before a ✕ when the closed kind’s toggle is pressed', async () => {
    await press('lambda')
    expect(mounted(), 'precondition: source, λ and TM').toEqual(['source', 'lambda-0', 'tm-0'])
    const three = stored().tree
    const pairBefore = stored().arrangements?.['source+tm']
    expect(pairBefore, 'precondition: the pair is remembered').toBeDefined()
    await userEvent.click(document.querySelector('[data-leaf="lambda-0"] button.view-close') as HTMLElement)
    expect(mounted()).toEqual(['source', 'tm-0'])
    expect(pressed(), 'a ✕ on a kind’s last view did not unpress its toggle').toEqual(['source', 'tm'])
    expect(stored().arrangements?.['source+lambda+tm']).toEqual(three)
    expect(stored().arrangements?.['source+tm'], 'the pair on screen is still remembered beside itself').toBeUndefined()
    expect(document.activeElement, 'the ✕ stranded the focus').not.toBe(document.body)
    await press('lambda')
    expect(stored().tree).toEqual(three)
  })

  /**
   * Spec §4.7: a link carries the arrangement on screen and no other. **THE PAYLOAD IS READ RAW**, not through
   * `decodeLink`, whose `parseWorkspace` answers `arrangements: {}` for a link that carried some as for one that
   * carried none.
   */
  it('makes a link that carries the arrangement on screen and none of the ones it remembers', async () => {
    expect(Object.keys(stored().arrangements ?? {}).length, 'precondition: something is remembered').toBeGreaterThan(0)
    await userEvent.click(document.querySelector('#share') as HTMLElement)
    const field = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('#share-menu #share-link')
    await until(() => (field()?.value ?? '') !== '', 'the link')
    const fragment = (field()?.value ?? '').split('#s=')[1] ?? ''
    const bytes = Uint8Array.from(atob(fragment.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))
    const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const payload = JSON.parse(await new Response(inflated).text()) as { workspace: string }
    const carried = JSON.parse(payload.workspace) as Stored
    expect(carried.tree).toEqual(stored().tree)
    expect('arrangements' in carried, 'the link carries remembered arrangements').toBe(false)
    await userEvent.keyboard('{Escape}')
    const menu = document.querySelector<HTMLElement>('#share-menu')
    if (menu?.matches(':popover-open')) menu.hidePopover()
  })

  it('chooses the tabs in Stage, and keeps the choice when tiles come back', async () => {
    await pick('[data-preset="stage"]')
    expect(tabs()).toEqual(['source', 'lambda-0', 'tm-0'])
    await press('lambda')
    expect(tabs()).toEqual(['source', 'tm-0'])
    expect(mounted().length, 'the stage mounts more than one view').toBe(1)
    expect(document.activeElement).toBe(toggle('lambda'))
    await pick('[data-preset="explorer"]')
    expect(mounted()).toEqual(['source', 'tm-0'])
  })
})
```

Create `web/tests/node/arrangements.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  type Arrangements,
  CYCLE,
  combinationOf,
  cycleFrom,
  enter,
  keyOf,
  liveLeaves,
  parseKey,
  shapeOf,
  toggled,
  treeKey,
} from '../../src/arrangements'
import {
  closeLeaf,
  defaultArrangement,
  HEADER_ORDER,
  insertBeside,
  KIND_ORDER,
  type LayoutNode,
  resize,
  setLeafKind,
} from '../../src/layout'
import type { PaneKind } from '../../src/panes'

/**
 * WHICH VIEWS ARE ON SCREEN AND WHAT EACH COMBINATION REMEMBERS, AS VALUES — the view layouts spec §4.
 *
 * `enter` is the one function every write of the tree goes through, so its two properties are what a user's
 * "switching is reversible" rests on; both are asserted over generated sequences as well as by hand.
 */

const of = (...kinds: PaneKind[]): LayoutNode => defaultArrangement(kinds, 'wide')
const FOUR = of(...KIND_ORDER)

/** Every combination: the 15 sets of kinds that are not empty, each in `KIND_ORDER`. */
const COMBINATIONS: PaneKind[][] = []
for (let mask = 1; mask < 1 << KIND_ORDER.length; mask++)
  COMBINATIONS.push(KIND_ORDER.filter((_, i) => (mask & (1 << i)) !== 0))

describe('a combination and its key', () => {
  it('reads a tree’s kinds in the header order, each once', () => {
    expect(combinationOf(FOUR)).toEqual(['source', 'lambda', 'asm', 'tm'])
    expect(combinationOf(of('tm', 'source'))).toEqual(['source', 'tm'])
    const twoLambdas = insertBeside(of('source', 'lambda'), 'lambda-0', 'row', 'pane-1', 'lambda')
    expect(combinationOf(twoLambdas)).toEqual(['source', 'lambda'])
  })

  it('spells a key as the kinds joined by +', () => {
    expect(keyOf(['source', 'tm'])).toBe('source+tm')
    expect(treeKey(FOUR)).toBe('source+lambda+asm+tm')
    expect(treeKey(of('asm'))).toBe('asm')
  })

  it('has 15 combinations, each with a key of its own that parses back to it', () => {
    expect(COMBINATIONS).toHaveLength(15)
    expect(new Set(COMBINATIONS.map(keyOf)).size).toBe(15)
    for (const kinds of COMBINATIONS) expect(parseKey(keyOf(kinds))).toEqual(kinds)
  })

  it.each([
    ['nothing', ''],
    ['an unknown kind', 'source+lisp'],
    ['a kind twice', 'source+source'],
    ['kinds out of the header order', 'tm+source'],
    ['a trailing +', 'source+'],
    ['another separator', 'source,tm'],
  ])('reads %s as no key', (_what, key) => {
    expect(parseKey(key)).toBeNull()
  })
})

describe('toggled', () => {
  it('adds a kind that is missing, in the header order, and removes one that is there', () => {
    expect(toggled(['source', 'tm'], 'lambda')).toEqual(['source', 'lambda', 'tm'])
    expect(toggled(['source', 'lambda', 'tm'], 'lambda')).toEqual(['source', 'tm'])
  })

  it('is empty when the only kind is toggled, which the caller refuses', () => {
    expect(toggled(['tm'], 'tm')).toEqual([])
  })
})

describe('enter', () => {
  const start = { tree: of('source', 'tm'), arrangements: {} as Arrangements }

  it('remembers the tree left under its key when the combination changes', () => {
    const next = enter(start, FOUR)
    expect(next.tree).toEqual(FOUR)
    expect(next.arrangements).toEqual({ 'source+tm': start.tree })
  })

  it('remembers nothing for an edit that keeps the combination', () => {
    const dragged = resize(start.tree, [], 0, 0.2)
    const next = enter(start, dragged)
    expect(next.tree).toEqual(dragged)
    expect(next.arrangements).toBe(start.arrangements)
    const second = insertBeside(start.tree, 'tm-0', 'row', 'pane-1', 'tm')
    expect(enter(start, second).arrangements).toBe(start.arrangements)
  })

  it('never keeps an entry under the key of the tree on screen', () => {
    const away = enter(start, FOUR)
    const back = enter(away, away.arrangements['source+tm'] as LayoutNode)
    expect(Object.keys(back.arrangements)).toEqual([treeKey(FOUR)])
    expect(back.arrangements[treeKey(back.tree)]).toBeUndefined()
  })

  it('shows the tree that was left after a switch away and back', () => {
    const stacked = resize(of('source', 'tm'), [], 0, 0.2)
    const left = { tree: stacked, arrangements: {} as Arrangements }
    const away = enter(left, FOUR)
    const back = enter(away, away.arrangements[treeKey(stacked)] as LayoutNode)
    expect(back.tree).toEqual(stacked)
  })

  it('shows the tree before a ✕ when the closed kind is toggled back', () => {
    const three = resize(of('source', 'lambda', 'tm'), [], 0, 0.2)
    const closed = enter({ tree: three, arrangements: {} }, closeLeaf(three, 'lambda-0'))
    expect(treeKey(closed.tree)).toBe('source+tm')
    expect(closed.arrangements['source+lambda+tm']).toEqual(three)
  })

  it('replaces what a combination remembered when an edit lands in it', () => {
    const remembered = resize(of('source', 'tm'), [], 0, 0.3)
    const three = of('source', 'lambda', 'tm')
    const closed = enter({ tree: three, arrangements: { 'source+tm': remembered } }, closeLeaf(three, 'lambda-0'))
    expect(closed.arrangements).toEqual({ 'source+lambda+tm': three })
    expect(closed.tree).toEqual(closeLeaf(three, 'lambda-0'))
  })

  it('treats a title pick that changes the combination as any other edit that does', () => {
    const picked = setLeafKind(start.tree, 'tm-0', 'asm')
    const next = enter(start, picked)
    expect(treeKey(next.tree)).toBe('source+asm')
    expect(next.arrangements).toEqual({ 'source+tm': start.tree })
  })

  it('holds both properties over every order of visiting three combinations and back', () => {
    const stops = [of('source', 'tm'), of('source', 'lambda'), FOUR].map((t, i) => resize(t, [], 0, 0.05 * (i + 1)))
    for (const order of [
      [0, 1, 2, 0, 1, 2],
      [0, 2, 1, 2, 0, 1],
      [2, 0, 2, 1, 0, 2],
      [1, 2, 0, 0, 1, 1],
    ]) {
      let now = { tree: stops[order[0] as number] as LayoutNode, arrangements: {} as Arrangements }
      const visited = new Set([treeKey(now.tree)])
      for (const at of order.slice(1)) {
        const target = stops[at] as LayoutNode
        const key = treeKey(target)
        if (key !== treeKey(now.tree)) {
          // A COMBINATION VISITED BEFORE IS REMEMBERED, NOT REBUILT: read here, so a fallback cannot stand in for it.
          if (visited.has(key)) expect(now.arrangements[key], `order ${order.join('')} at ${at}`).toEqual(target)
          now = enter(now, now.arrangements[key] ?? target)
        }
        visited.add(key)
        expect(now.tree, `order ${order.join('')} at ${at}`).toEqual(target)
        expect(now.arrangements[treeKey(now.tree)]).toBeUndefined()
        expect(Object.keys(now.arrangements).length).toBe(visited.size - 1)
      }
    }
  })
})

describe('the cycle', () => {
  it('has four stops: the source beside asm, λ and TM in turn, as the header has them, then all four', () => {
    expect(CYCLE.map(keyOf)).toEqual(['source+asm', 'source+lambda', 'source+tm', 'source+lambda+asm+tm'])
    for (const stop of CYCLE) expect(parseKey(keyOf(stop)), keyOf(stop)).toEqual(stop)
  })

  it('steps to the next and the previous stop, wrapping', () => {
    expect(cycleFrom(['source', 'asm'], 1)).toEqual(['source', 'lambda'])
    expect(cycleFrom(['source', 'lambda'], 1)).toEqual(['source', 'tm'])
    expect(cycleFrom(['source', 'tm'], 1)).toEqual(KIND_ORDER)
    expect(cycleFrom(KIND_ORDER, 1)).toEqual(['source', 'asm'])
    expect(cycleFrom(['source', 'asm'], -1)).toEqual(KIND_ORDER)
    expect(cycleFrom(['source', 'tm'], -1)).toEqual(['source', 'lambda'])
  })

  it('goes to the first stop forward and the last stop back from a combination that is not a stop', () => {
    expect(cycleFrom(['tm'], 1)).toEqual(['source', 'asm'])
    expect(cycleFrom(['tm'], -1)).toEqual(KIND_ORDER)
    expect(cycleFrom(['source', 'lambda', 'tm'], 1)).toEqual(['source', 'asm'])
  })
})

describe('the header’s order', () => {
  it('is source, asm, λ, TM: every kind of KIND_ORDER, each once', () => {
    expect(HEADER_ORDER).toEqual(['source', 'asm', 'lambda', 'tm'])
    expect([...HEADER_ORDER].sort()).toEqual([...KIND_ORDER].sort())
    expect(new Set(HEADER_ORDER).size).toBe(KIND_ORDER.length)
  })
})

describe('liveLeaves', () => {
  it('is the leaves of the tree on screen and of every remembered tree, each id once', () => {
    const live = liveLeaves(of('source', 'tm'), { [treeKey(FOUR)]: FOUR, lambda: of('lambda') })
    expect([...live.keys()].sort()).toEqual(['asm-0', 'lambda-0', 'source', 'tm-0'])
    expect(live.get('asm-0')).toBe('asm')
  })

  it('takes the kind the tree on screen gives an id two trees hold', () => {
    const onScreen = setLeafKind(of('source', 'tm'), 'tm-0', 'asm')
    const live = liveLeaves(onScreen, { 'source+tm': of('source', 'tm') })
    expect(live.get('tm-0')).toBe('asm')
    expect(live.size).toBe(2)
  })
})

describe('shapeOf', () => {
  it('is tall for an area taller than it is wide, and wide otherwise', () => {
    expect(shapeOf({ width: 320, height: 568 })).toBe('tall')
    expect(shapeOf({ width: 1280, height: 725 })).toBe('wide')
    expect(shapeOf({ width: 500, height: 500 })).toBe('wide')
    expect(shapeOf({ width: 0, height: 0 })).toBe('wide')
  })
})
```

In `web/tests/node/layout.test.ts`:

```diff
--- a/web/tests/node/layout.test.ts
+++ b/web/tests/node/layout.test.ts
@@ -2,10 +2,13 @@ import { describe, expect, it } from 'vitest'
 import {
   addRefusal,
   closeLeaf,
+  defaultArrangement,
   defaultLayout,
   defaultLayout as dl,
+  HEADER_ORDER,
   holdsMostLeaves,
   insertBeside,
+  KIND_ORDER,
   LAYOUT_VERSION,
   type LayoutNode,
   leafExtents,
@@ -35,6 +38,153 @@ import type { PaneKind } from '../../src/panes'
 
 const leaf = (id: string, pane: PaneKind): LayoutNode => ({ kind: 'leaf', id, pane })
 
+describe('defaultArrangement', () => {
+  it('is the leaf for one kind, under its default id', () => {
+    expect(defaultArrangement(['tm'], 'wide')).toEqual(leaf('tm-0', 'tm'))
+    expect(defaultArrangement(['source'], 'tall')).toEqual(leaf('source', 'source'))
+  })
+
+  it('puts a pair side by side in a wide area and one above the other in a tall one', () => {
+    const pair = (dir: 'row' | 'column'): LayoutNode => ({
+      kind: 'split',
+      dir,
+      sizes: [0.5, 0.5],
+      children: [leaf('source', 'source'), leaf('asm-0', 'asm')],
+    })
+    expect(defaultArrangement(['source', 'asm'], 'wide')).toEqual(pair('row'))
+    expect(defaultArrangement(['source', 'asm'], 'tall')).toEqual(pair('column'))
+  })
+
+  it('puts the first of three beside a column of the other two, and over a row of them in a tall area', () => {
+    const three = (outer: 'row' | 'column', inner: 'row' | 'column'): LayoutNode => ({
+      kind: 'split',
+      dir: outer,
+      sizes: [0.5, 0.5],
+      children: [
+        leaf('source', 'source'),
+        { kind: 'split', dir: inner, sizes: [0.5, 0.5], children: [leaf('lambda-0', 'lambda'), leaf('tm-0', 'tm')] },
+      ],
+    })
+    expect(defaultArrangement(['source', 'lambda', 'tm'], 'wide')).toEqual(three('row', 'column'))
+    expect(defaultArrangement(['source', 'lambda', 'tm'], 'tall')).toEqual(three('column', 'row'))
+  })
+
+  it('puts all four in two columns of two in a wide area: source over asm, beside λ over TM', () => {
+    expect(defaultArrangement(KIND_ORDER, 'wide')).toEqual({
+      kind: 'split',
+      dir: 'row',
+      sizes: [0.5, 0.5],
+      children: [
+        {
+          kind: 'split',
+          dir: 'column',
+          sizes: [0.5, 0.5],
+          children: [leaf('source', 'source'), leaf('asm-0', 'asm')],
+        },
+        {
+          kind: 'split',
+          dir: 'column',
+          sizes: [0.5, 0.5],
+          children: [leaf('lambda-0', 'lambda'), leaf('tm-0', 'tm')],
+        },
+      ],
+    })
+  })
+
+  it('puts all four in two rows of two in a tall area, the tree a fresh page built until the view layouts', () => {
+    expect(defaultArrangement(KIND_ORDER, 'tall')).toEqual(defaultLayout())
+    expect(defaultLayout()).toEqual({
+      kind: 'split',
+      dir: 'column',
+      sizes: [0.5, 0.5],
+      children: [
+        {
+          kind: 'split',
+          dir: 'row',
+          sizes: [0.5, 0.5],
+          children: [leaf('source', 'source'), leaf('lambda-0', 'lambda')],
+        },
+        {
+          kind: 'split',
+          dir: 'row',
+          sizes: [0.5, 0.5],
+          children: [leaf('asm-0', 'asm'), leaf('tm-0', 'tm')],
+        },
+      ],
+    })
+  })
+
+  /**
+   * THE USER'S RULE FOR A WIDE AREA, AS A PROPERTY (2026-10-11): no divider and no view runs the whole width. A tree's
+   * root is then a row, or a single leaf, for every combination of more than one kind.
+   */
+  it('makes no tree whose root is a column in a wide area, and none whose root is a row in a tall one', () => {
+    for (let mask = 1; mask < 1 << KIND_ORDER.length; mask++) {
+      const kinds = KIND_ORDER.filter((_, i) => (mask & (1 << i)) !== 0)
+      if (kinds.length === 1) continue
+      const wide = defaultArrangement(kinds, 'wide')
+      const tall = defaultArrangement(kinds, 'tall')
+      expect(wide.kind === 'split' && wide.dir, kinds.join('+')).toBe('row')
+      expect(tall.kind === 'split' && tall.dir, kinds.join('+')).toBe('column')
+    }
+  })
+
+  it('puts the same view in the same corner in both shapes', () => {
+    // FOUR CORNERS, READ OFF EACH TREE'S OWN NESTING: [top left, top right, bottom left, bottom right].
+    const wide = defaultArrangement(KIND_ORDER, 'wide')
+    const tall = defaultArrangement(KIND_ORDER, 'tall')
+    const at = (t: LayoutNode, i: number, j: number): string => {
+      const outer = t.kind === 'split' ? t.children[i] : undefined
+      const inner = outer?.kind === 'split' ? outer.children[j] : undefined
+      return inner?.kind === 'leaf' ? inner.id : ''
+    }
+    expect([at(wide, 0, 0), at(wide, 1, 0), at(wide, 0, 1), at(wide, 1, 1)]).toEqual([
+      'source',
+      'lambda-0',
+      'asm-0',
+      'tm-0',
+    ])
+    expect([at(tall, 0, 0), at(tall, 0, 1), at(tall, 1, 0), at(tall, 1, 1)]).toEqual([
+      'source',
+      'lambda-0',
+      'asm-0',
+      'tm-0',
+    ])
+  })
+
+  it('lays the kinds out from KIND_ORDER whatever order they are handed in', () => {
+    expect(defaultArrangement(['tm', 'source'], 'wide')).toEqual(defaultArrangement(['source', 'tm'], 'wide'))
+    expect(defaultArrangement(['tm', 'asm', 'lambda', 'source'], 'wide')).toEqual(
+      defaultArrangement(KIND_ORDER, 'wide'),
+    )
+    // A WIDE AREA'S LEAVES COME IN THE HEADER'S ORDER, down each column in turn, and a tall one's in `KIND_ORDER`.
+    expect(leaves(defaultArrangement(KIND_ORDER, 'wide')).map((l) => l.pane)).toEqual([...HEADER_ORDER])
+    expect(leaves(defaultArrangement(KIND_ORDER, 'tall')).map((l) => l.pane)).toEqual([...KIND_ORDER])
+  })
+
+  it('makes a tree parseTree takes, holding the kinds asked, for every combination and both shapes', () => {
+    let combinations = 0
+    for (let mask = 1; mask < 1 << KIND_ORDER.length; mask++) {
+      const kinds = KIND_ORDER.filter((_, i) => (mask & (1 << i)) !== 0)
+      combinations++
+      for (const shape of ['wide', 'tall'] as const) {
+        const tree = defaultArrangement(kinds, shape)
+        expect(parseTree(JSON.parse(JSON.stringify(tree)))).toEqual(tree)
+        expect(
+          leaves(tree)
+            .map((l) => l.pane)
+            .sort(),
+        ).toEqual([...kinds].sort())
+      }
+    }
+    expect(combinations).toBe(15)
+  })
+
+  it('refuses no kinds, since a tree has a leaf or more', () => {
+    expect(() => defaultArrangement([], 'wide')).toThrow(/a kind or more/)
+  })
+})
+
 describe('defaultLayout', () => {
   it('puts source and λ above asm and TM, two rows of two', () => {
     expect(defaultLayout()).toEqual({
```

In `web/tests/node/share-link.test.ts`:

```diff
--- a/web/tests/node/share-link.test.ts
+++ b/web/tests/node/share-link.test.ts
@@ -150,6 +150,9 @@ describe('the frozen link from version 1', () => {
         inspector: true,
         display: {},
         tmDisplay: {},
+        // WRITTEN BEFORE THE VIEW LAYOUTS, SO IT CARRIES NONE, AND READS AS REMEMBERING NOTHING: its four views are
+        // the arrangement on screen, as they were.
+        arrangements: {},
       },
       positions: { lambda: 500, asm: 40, tm: 9000 },
     })
```

In `web/tests/node/workspace.test.ts`:

```diff
--- a/web/tests/node/workspace.test.ts
+++ b/web/tests/node/workspace.test.ts
@@ -1,5 +1,13 @@
 import { describe, expect, it } from 'vitest'
-import { defaultLayout, leaves, serializeLayout, splitLeaf } from '../../src/layout'
+import { treeKey } from '../../src/arrangements'
+import {
+  defaultArrangement,
+  defaultLayout,
+  type LayoutNode,
+  leaves,
+  serializeLayout,
+  splitLeaf,
+} from '../../src/layout'
 import {
   DEFAULT_SPEED,
   defaultFocus,
@@ -73,6 +81,7 @@ describe('parseWorkspace', () => {
       inspector: false,
       display: { 'pane-1': { layout: 'outline' as const, vars: 'debruijn' as const, map: 'minimap' as const } },
       tmDisplay: { 'tm-0': { level: 'local' as const, edges: 'chips' as const } },
+      arrangements: { 'source+tm': defaultArrangement(['source', 'tm'], 'tall') },
     }
     const raw = serializeWorkspace(ws)
     expect(JSON.parse(raw).version).toBe(WORKSPACE_VERSION)
@@ -251,3 +260,91 @@ describe('defaultWorkspace', () => {
     expect(ws.inspector).toBe(true)
   })
 })
+
+describe('the remembered arrangements', () => {
+  const FOUR = defaultLayout()
+  const PAIR = defaultArrangement(['source', 'tm'], 'wide')
+  const base = (): Record<string, unknown> => ({
+    version: 2,
+    tree: FOUR,
+    switches: PRESETS.explorer,
+    speed: 8,
+    focused: 'lambda-0',
+    panels: {},
+  })
+  const parsed = (arrangements: unknown) => parseWorkspace(JSON.stringify({ ...base(), arrangements }))
+
+  it('reads a workspace stored before them as remembering nothing', () => {
+    expect(parseWorkspace(JSON.stringify(base()))?.arrangements).toEqual({})
+    expect(parseWorkspace(serializeLayout(SPLIT))?.arrangements).toEqual({})
+  })
+
+  it('writes no field while nothing is remembered, and the trees by key once something is', () => {
+    const empty = { ...defaultWorkspace(), tree: FOUR, focused: 'lambda-0' }
+    expect('arrangements' in JSON.parse(serializeWorkspace(empty))).toBe(false)
+    const held = { ...empty, arrangements: { 'source+tm': PAIR } }
+    expect(JSON.parse(serializeWorkspace(held)).arrangements).toEqual({ 'source+tm': PAIR })
+    expect(parseWorkspace(serializeWorkspace(held))).toEqual(held)
+  })
+
+  it('takes a tree under its own combination’s key', () => {
+    expect(parsed({ 'source+tm': PAIR })?.arrangements).toEqual({ 'source+tm': PAIR })
+    expect(parsed({})?.arrangements).toEqual({})
+  })
+
+  const one = (id: string): LayoutNode => ({ kind: 'leaf', id, pane: 'lambda' })
+  it.each([
+    ['a list', [PAIR]],
+    ['a string', 'source+tm'],
+    ['null', null],
+    ['a key that is no combination', { 'source+lisp': PAIR }],
+    ['a key out of the header order', { 'tm+source': PAIR }],
+    ['a tree under another combination’s key', { 'source+lambda': PAIR }],
+    ['an entry under the key of the tree on screen', { [treeKey(FOUR)]: FOUR }],
+    ['a tree parseTree refuses', { 'source+tm': { kind: 'split', dir: 'row', children: [PAIR], sizes: [1] } }],
+    ['a value that is no tree', { 'source+tm': 'row' }],
+  ])('refuses %s', (_what, arrangements) => {
+    expect(parsed(arrangements)).toBeNull()
+  })
+
+  it('bounds the views of every tree together at 64, where each tree alone may hold 64', () => {
+    const numbered = (count: number): string[] => Array.from({ length: count }, (_, i) => `pane-${i + 1}`)
+    const row = (ids: string[]): LayoutNode => ({
+      kind: 'split',
+      dir: 'row',
+      sizes: ids.map(() => 1 / ids.length),
+      children: ids.map(one),
+    })
+    // 4 on screen and 60 remembered is 64; 61 remembered is 65, in a tree `parseTree` takes alone.
+    expect(parsed({ lambda: row(numbered(60)) })).not.toBeNull()
+    expect(parsed({ lambda: row(numbered(61)) })).toBeNull()
+    // AN ID TWO TREES HOLD IS ONE VIEW: 61 remembered leaves, one of them the λ view on screen, is 64 views.
+    expect(parsed({ lambda: row(['lambda-0', ...numbered(60)]) })).not.toBeNull()
+  })
+
+  it('keeps the panel state and the display of a view only a remembered tree holds, and refuses one no tree holds', () => {
+    const stored = {
+      ...base(),
+      tree: PAIR,
+      focused: 'tm-0',
+      arrangements: { [treeKey(FOUR)]: FOUR },
+      panels: { 'lambda-0': { map: false } },
+      display: { 'lambda-0': { layout: 'outline', vars: 'names', map: 'icicle' } },
+      tmDisplay: { 'tm-0': { level: 'local', edges: 'chips' } },
+    }
+    const ws = parseWorkspace(JSON.stringify(stored))
+    expect(ws?.panels).toEqual(stored.panels)
+    expect(ws?.display).toEqual(stored.display)
+    if (ws === null || ws === undefined) throw new Error('unreachable')
+    expect(JSON.parse(serializeWorkspace(ws)).panels).toEqual(stored.panels)
+    expect(JSON.parse(serializeWorkspace(ws)).display).toEqual(stored.display)
+    expect(parseWorkspace(JSON.stringify({ ...stored, panels: { 'pane-9': { map: false } } }))).toBeNull()
+  })
+
+  it('holds the focus to the tree on screen: a view only a remembered tree holds is refused, and not written', () => {
+    const stored = { ...base(), tree: PAIR, focused: 'lambda-0', arrangements: { [treeKey(FOUR)]: FOUR } }
+    expect(parseWorkspace(JSON.stringify(stored))).toBeNull()
+    const ws = { ...defaultWorkspace(), tree: PAIR, focused: 'lambda-0', arrangements: { [treeKey(FOUR)]: FOUR } }
+    expect(JSON.parse(serializeWorkspace(ws)).focused).toBe('tm-0')
+  })
+})
```

- [ ] **Step 2: Run them, and see them fail**

`pnpm exec vitest run --project node tests/node/arrangements.test.ts tests/node/share-link.test.ts tests/node/layout.test.ts tests/node/workspace.test.ts`
(`t3-failing-node.log`): 4 files failed; 11 tests failed, 124 passed, of 135. (Run with `workspace.test.ts` as point 2
above first had it; the file did not load either way.)

```
 FAIL  |node| tests/node/arrangements.test.ts [ tests/node/arrangements.test.ts ]
Error: Cannot find module '../../src/arrangements' imported from /home/davey/temp/redextape-view-layouts-work/web/tests/node/arrangements.test.ts
 FAIL  |node| tests/node/workspace.test.ts [ tests/node/workspace.test.ts ]
Error: Cannot find module '../../src/arrangements' imported from /home/davey/temp/redextape-view-layouts-work/web/tests/node/workspace.test.ts
 FAIL  |node| tests/node/layout.test.ts > defaultArrangement > is the leaf for one kind, under its default id
TypeError: defaultArrangement is not a function
 FAIL  |node| tests/node/share-link.test.ts > the frozen link from version 1 > opens whole, as the program, the encoding, the workspace and the positions it was written with
AssertionError: expected { kind: 'whole', …(4) } to deeply equal { kind: 'whole', …(4) }
```

`layout.test.ts`: all 10 cases of `describe('defaultArrangement')` failed, 85 passed.

`pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts tests/browser/scratch-fork.test.ts tests/browser/parked-copy-editor.test.ts tests/browser/parked-view-surfaces.test.ts tests/browser/parked-copy-editor-mount.test.ts tests/browser/live-views-bound.test.ts tests/browser/live-views-bound-switch.test.ts tests/browser/view-toggles.test.ts`
(`t3-failing-browser.log`): 7 files failed, 1 passed; 20 tests failed, 29 passed, of 49. (Run with `view-toggles.test.ts`
still holding the `notice` line of point 3, which no case reads.)

```
 FAIL  |browser (chromium)| tests/browser/controls-gate.test.ts > every control in Explorer, in a window wide enough for the views toggles > walks the four toggles, each named by its own word
AssertionError: expected [] to have a length of 4 but got +0
 FAIL  |browser (chromium)| tests/browser/live-views-bound-switch.test.ts > the source toggle, with 64 λ views on screen and no source view > is refused in the full workspace’s words, and changes nothing
AssertionError: precondition: the λ toggle alone is pressed: expected [] to deeply equal [ 'lambda' ]
 FAIL  |browser (chromium)| tests/browser/live-views-bound.test.ts > + view, with four views on screen and 60 more remembered > is refused in the full workspace’s words, and changes nothing
TypeError: Cannot convert undefined or null to object
 FAIL  |browser (chromium)| tests/browser/parked-copy-editor-mount.test.ts > a parked view of a TM copy whose other view, holding the editor, was closed > has an editor when it comes back
TypeError: Cannot read properties of null (reading 'click')
 FAIL  |browser (chromium)| tests/browser/parked-copy-editor.test.ts > a copy deleted and restored while the view holding its editor is off the page > gives the copy one editor when the holder was parked by a switch
AssertionError: expected [ 'source', 'lambda-0', 'asm-0', …(1) ] to deeply equal [ 'source', 'lambda-0' ]
 FAIL  |browser (chromium)| tests/browser/parked-view-surfaces.test.ts > the surfaces the views share, with the λ view parked > points the step bar at a view on the page, and steps that one, once the λ view it drove is parked
TypeError: Cannot read properties of null (reading 'click')
 FAIL  |browser (chromium)| tests/browser/view-toggles.test.ts > the views toggles > starts with all four views on the page and all four toggles pressed
AssertionError: expected [] to deeply equal [ 'source', 'asm', 'lambda', 'tm' ]
```

Per file: `controls-gate` 2 failed of 25 (the two new cases); `live-views-bound-switch` 1 of 1; `live-views-bound` 1 of
1; `parked-copy-editor-mount` 1 of 1; `parked-copy-editor` 1 of 1; `parked-view-surfaces` 3 of 3; `view-toggles` 11 of
11.

**`scratch-fork.test.ts` passed before the source change**: it is the 1 file that passed, with the 6 tests the other
seven files' 43 leave of 49. Its one changed line hands `createLinkWiring` an
`arranged` the base does not read; what it holds is the typecheck, where `arranged` is a required dep after the change.

- [ ] **Step 3: Write the source**

In `web/index.html`:

```diff
--- a/web/index.html
+++ b/web/index.html
@@ -23,6 +23,7 @@
       <div id="workspace-menu" class="header-menu" popover>
         <button type="button" id="reset-preset">reset preset — restores the default views</button>
       </div>
+      <div id="views-shown" class="views-shown" role="group" aria-label="views"></div>
       <button type="button" id="new-view" aria-haspopup="menu" aria-controls="new-view-menu" aria-expanded="false">+ view</button>
       <div id="new-view-menu" class="header-menu" popover></div>
       <button type="button" id="buffers">copies <span aria-hidden="true">▾</span></button>
```

In `web/src/app-header.ts`:

```diff
--- a/web/src/app-header.ts
+++ b/web/src/app-header.ts
@@ -1,5 +1,7 @@
 import type { Example } from './examples'
+import { HEADER_ORDER, KIND_WORD } from './layout'
 import type { PaneChoice, SplitChoices } from './pane-chrome'
+import type { PaneKind } from './panes'
 import { bindingKey, pairLabel } from './view-header'
 import { PRESETS, type Preset, presetOf, type Switches } from './workspace'
 
@@ -7,6 +9,7 @@ import { PRESETS, type Preset, presetOf, type Switches } from './workspace'
  * THE APP HEADER'S MENUS — Plan 7 part 2 spec §6: the workspace menu, `+ view` and settings, `examples ▾` since
  * part 6a, and `about ▾` since the about pages. Each is a native popover beside the button that opens it, declared in
  * `index.html` so the pre-paint script and the skin selects need no change; this module wires what markup cannot.
+ * The `views` toggles (the view layouts spec §6) are the header's one group that is not a menu.
  */
 
 /**
@@ -244,3 +247,63 @@ export function workspaceItems(
   if (back !== null) back.focus()
   else menu.querySelector<HTMLElement>('button:not([disabled])')?.focus()
 }
+
+/**
+ * The header's `views` toggles — the view layouts spec §6: one button a kind, in `HEADER_ORDER`, pressed where the tree
+ * on screen holds a view of that kind. `pick` is handed the kind a press asks to add or remove; `sync` is called with
+ * the kinds on screen whenever they may have changed.
+ *
+ * **THE NAME IS THE LABEL, AND THE TOOLTIP SAYS WHAT A PRESS DOES** (umbrella §4 rule 1). `source`, `λ`, `asm` and
+ * `TM` are words a reader says, so each button is named by its own text, in a group named `views`, and `aria-pressed`
+ * carries its state. The tooltip is the sentence: *hide the TM view*, *show the TM view*.
+ *
+ * **THE LAST PRESSED BUTTON IS DISABLED, AND ITS TOOLTIP IS THE REASON** (rule 4): it could apply and cannot now,
+ * since one view stays. `aria-description` says the same to a reader who does not hover, as *edit a copy* says its
+ * own reason.
+ *
+ * **BUILT ONCE AND UPDATED IN PLACE**: a press must not cost the button its focus, and a rebuild would.
+ */
+export function viewToggles(
+  group: HTMLElement,
+  pick: (kind: PaneKind) => void,
+): { sync(shown: readonly PaneKind[]): void } {
+  const buttons = HEADER_ORDER.map((kind) => {
+    const b = document.createElement('button')
+    b.type = 'button'
+    b.className = 'view-toggle'
+    // `data-shows`, NOT `data-kind`: that one is a view host's (`pane-host.ts`), and `[data-kind="lambda"]` is how the
+    // page's λ views are counted.
+    b.dataset.shows = kind
+    b.textContent = KIND_WORD[kind]
+    b.addEventListener('click', () => pick(kind))
+    return b
+  })
+  group.replaceChildren(...buttons)
+  return {
+    sync(shown: readonly PaneKind[]): void {
+      for (const b of buttons) {
+        const kind = b.dataset.shows as PaneKind
+        const pressed = shown.includes(kind)
+        const only = pressed && shown.length === 1
+        b.setAttribute('aria-pressed', String(pressed))
+        b.disabled = only
+        const says = only
+          ? `the ${KIND_WORD[kind]} view is the only one shown — one view stays`
+          : `${pressed ? 'hide' : 'show'} the ${KIND_WORD[kind]} view`
+        if (b.title !== says) b.title = says
+        if (only) b.setAttribute('aria-description', says)
+        else b.removeAttribute('aria-description')
+      }
+    },
+  }
+}
+
+/**
+ * The kinds on screen as a sentence for the live region, in the header's order whatever order they are handed in:
+ * `showing source and TM`, `showing source, asm, λ and TM`.
+ */
+export function shownSentence(shown: readonly PaneKind[]): string {
+  const words = HEADER_ORDER.filter((k) => shown.includes(k)).map((k) => KIND_WORD[k])
+  const last = words.pop()
+  return words.length === 0 ? `showing ${last}` : `showing ${words.join(', ')} and ${last}`
+}
```

Create `web/src/arrangements.ts`:

```ts
import { type Extent, HEADER_ORDER, KIND_ORDER, type LayoutNode, leaves, type Shape } from './layout'
import type { LeafId, PaneKind } from './panes'

/**
 * WHICH VIEWS ARE ON SCREEN, AND THE ARRANGEMENT EACH COMBINATION OF THEM REMEMBERS — the view layouts spec §4.
 *
 * A **combination** is the set of kinds a tree's leaves have, written as those kinds in `KIND_ORDER`; its **key** is
 * that list joined by `+`. `Arrangements` holds the tree last seen for every combination visited except the one on
 * screen, whose tree stays where `main.ts` has always kept it.
 *
 * **THE COMBINATION ON SCREEN IS READ FROM THE TREE AND STORED NOWHERE**, for the reason `workspace.ts` gives for the
 * preset: a stored copy could disagree with what it copies. Every function here is a value in and a value out, so the
 * node tier tests all of it.
 */

/** A set of kinds that is not empty, in `KIND_ORDER`, each once. */
export type Combination = readonly PaneKind[]

/** The remembered tree of each combination visited, by key — never one under the key of the tree on screen. */
export type Arrangements = Readonly<Record<string, LayoutNode>>

/** The kinds `tree`'s leaves have, in `KIND_ORDER`. */
export function combinationOf(tree: LayoutNode): Combination {
  const held = new Set(leaves(tree).map((l) => l.pane))
  return KIND_ORDER.filter((k) => held.has(k))
}

/** A combination's key: its kinds joined by `+`, as `source+tm`. */
export function keyOf(kinds: Combination): string {
  return kinds.join('+')
}

/** The key of the combination `tree` shows. */
export function treeKey(tree: LayoutNode): string {
  return keyOf(combinationOf(tree))
}

/**
 * The combination a key spells, or `null` for a string that is not a key: an unknown kind, a kind twice, kinds out of
 * `KIND_ORDER`, or none. **ONLY THE SPELLING `keyOf` WRITES IS A KEY**, so two entries of a stored record cannot name
 * one combination.
 */
export function parseKey(key: string): Combination | null {
  const parts = key.split('+')
  const kinds = KIND_ORDER.filter((k) => parts.includes(k))
  return kinds.length > 0 && keyOf(kinds) === key ? kinds : null
}

/**
 * `kinds` with `kind` added where it is missing and removed where it is there — what pressing a kind's toggle asks
 * for. The result is empty when `kind` was the only one; the caller refuses that, since one view stays.
 */
export function toggled(kinds: Combination, kind: PaneKind): PaneKind[] {
  const next = new Set(kinds)
  if (!next.delete(kind)) next.add(kind)
  return KIND_ORDER.filter((k) => next.has(k))
}

/**
 * Put `next` in force as the tree on screen — the one function every write of the tree goes through (spec §4.3).
 *
 * Where `next` shows another combination than the tree it replaces, the tree left is remembered under its own key
 * and the entry under `next`'s key is dropped: `next` is that combination's arrangement now. Where the combination
 * is the same, an edit in place, nothing is remembered and nothing is dropped.
 *
 * **SO A SWITCH AWAY AND BACK SHOWS THE TREE THAT WAS LEFT**, and so does `✕` on a kind's last view followed by that
 * kind's toggle: the tree before the `✕` went under the key the toggle returns to.
 */
export function enter(
  now: { readonly tree: LayoutNode; readonly arrangements: Arrangements },
  next: LayoutNode,
): { readonly tree: LayoutNode; readonly arrangements: Arrangements } {
  const before = treeKey(now.tree)
  const after = treeKey(next)
  if (before === after) return { tree: next, arrangements: now.arrangements }
  const kept = Object.fromEntries(Object.entries(now.arrangements).filter(([key]) => key !== after))
  return { tree: next, arrangements: { ...kept, [before]: now.tree } }
}

/**
 * The stops the cycle keys walk, in order: the source beside each other kind in turn, in the header's order, then all
 * four (spec §7.4). Each stop is a combination, so its kinds are in `KIND_ORDER`, where the source comes first too.
 */
export const CYCLE: readonly Combination[] = [
  ...HEADER_ORDER.filter((k) => k !== 'source').map((k): Combination => ['source', k]),
  KIND_ORDER,
]

/**
 * The stop `step` on from `kinds`, wrapping. From a combination that is not a stop, forward is the first stop and
 * back is the last.
 */
export function cycleFrom(kinds: Combination, step: 1 | -1): Combination {
  const at = CYCLE.findIndex((stop) => keyOf(stop) === keyOf(kinds))
  const from = at === -1 ? (step === 1 ? -1 : 0) : at
  return CYCLE[(from + step + CYCLE.length) % CYCLE.length] as Combination
}

/**
 * Every live view and what it shows: the leaves of the tree on screen and of every remembered arrangement (spec
 * §5.1).
 *
 * **THE TREE ON SCREEN WINS AN ID TWO TREES HOLD UNDER TWO KINDS** (§5.4). A pick in a view's title changes its kind
 * and keeps its id, so an arrangement off the screen can remember the id as what it used to show; the view is what
 * the screen says until that arrangement is entered.
 */
export function liveLeaves(tree: LayoutNode, arrangements: Arrangements): Map<LeafId, PaneKind> {
  const live = new Map<LeafId, PaneKind>()
  for (const l of leaves(tree)) live.set(l.id, l.pane)
  for (const remembered of Object.values(arrangements))
    for (const l of leaves(remembered)) if (!live.has(l.id)) live.set(l.id, l.pane)
  return live
}

/** The shape of an area: `tall` where it is taller than it is wide, `wide` otherwise — a box of no size included. */
export function shapeOf(area: Extent): Shape {
  return area.height > area.width ? 'tall' : 'wide'
}
```

In `web/src/draw.ts`:

```diff
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -80,6 +80,11 @@ export function createDraw(deps: {
   unseen: WeakSet<TmPane | AsmPane>
   leaves: () => number
   sourceAvailable: () => boolean
+  /**
+   * Whether the tree on screen holds this view — false for a view kept alive in an arrangement the workspace
+   * remembers (the view layouts spec §5). A hidden Stage tab is in the tree, so it answers true as it always has.
+   */
+  arranged: (id: LeafId) => boolean
   hasEditor: (session: SessionId) => boolean
   /** The view the user is in — the readout describes its session (spec §9). */
   focused: () => LeafId
@@ -110,6 +115,7 @@ export function createDraw(deps: {
     unseen,
     leaves,
     sourceAvailable,
+    arranged,
     hasEditor,
     focused,
     sourceSession,
@@ -154,10 +160,18 @@ export function createDraw(deps: {
     // keeps the step bar on "the last view that could" step, so a hidden view's leg can still move. The λ link
     // clause at the end of this function asks `shown` instead, because it reads a view's own pin and tree, which
     // only a view on the page has fresh (`PaneCollection.shown`'s doc).
+    //
+    // **AND NEVER A VIEW THE TREE ON SCREEN DOES NOT HOLD** (the view layouts spec §5): a view kept alive in a
+    // remembered arrangement is no one's to watch, where a hidden Stage tab has a tab that names it. With the λ view
+    // toggled off, the source editor carries no running focus of a term no view shows.
     const onProgram = (e: { readonly slot: { readonly binding: { readonly session: SessionId } } }): boolean =>
       !sessions.entryOf(e.slot.binding.session).detached
-    const lam = panes.active('lambda', onProgram)?.slot.resolve(sessions)
-    const tm = panes.active('tm', onProgram)?.slot.resolve(sessions)
+    const watched = (e: {
+      readonly id: LeafId
+      readonly slot: { readonly binding: { readonly session: SessionId } }
+    }): boolean => arranged(e.id) && onProgram(e)
+    const lam = panes.active('lambda', watched)?.slot.resolve(sessions)
+    const tm = panes.active('tm', watched)?.slot.resolve(sessions)
     // THE TM LEG'S OWN RUNNING FOCUS — `TmState.source_node`, NOT `lam.hist.current?.owner` below.
     // Design table (`2026-08-10-plan5c-dual-focus-design.md` §4.2): "TM: TmState.source_node,
     // resolved through SourceMap::tm_owner ... none; shipped 2026-07-30." Each pane reports what ITS
@@ -186,7 +200,7 @@ export function createDraw(deps: {
     // of the instruction about to run, read off the asm view of the program the user focused most recently, and
     // nothing when no asm view of the program is asking. It marks the program's asm views' rows and feeds the status
     // line's coincidence; the source editor's focus mark stays λ's, as Plan 5c's dual-focus design settled.
-    const asm = panes.active('asm', onProgram)?.slot.resolve(sessions)
+    const asm = panes.active('asm', watched)?.slot.resolve(sessions)
     const asmFocus =
       linkWiring.linkable && linkWiring.index !== null && asm !== undefined
         ? runningFocus(linkWiring.index, sourceNodeOwner(asm.hist.current?.source_node ?? null))
```

In `web/src/layout.ts`:

```diff
--- a/web/src/layout.ts
+++ b/web/src/layout.ts
@@ -106,6 +106,93 @@ export const MIN_PANE_FRACTION = 0.1
  */
 export const SOURCE_LEAF: LeafId = 'source'
 
+/**
+ * The four kinds, in the order a combination's key spells them and a default arrangement places them: source, λ, asm,
+ * TM (the view layouts spec §4.1) — the order all four views have had on the page since the asm view joined them.
+ *
+ * **KEYED BY `PaneKind` AND THEN LISTED**, as `PANE_KINDS` below was before it read this: a kind left out is a type
+ * error here, and the keys are the list.
+ *
+ * **NOT THE HEADER'S ORDER**, which is `HEADER_ORDER` below: where a view sits in the default grid and where its
+ * toggle sits in the header are two decisions, and the user made the second one differently.
+ */
+export const KIND_ORDER: readonly PaneKind[] = Object.keys({
+  source: 0,
+  lambda: 0,
+  asm: 0,
+  tm: 0,
+} satisfies Record<PaneKind, 0>) as PaneKind[]
+
+/**
+ * The four kinds in the order the header's `views` toggles have them: source, asm, λ, TM (the user's decision,
+ * 2026-10-11). The toggle keys `1` to `4`, the cycle and the sentence the live region reads follow it, so what is said
+ * and pressed runs left to right across the header.
+ *
+ * **A SECOND LIST, SO IT IS HELD TO THE FIRST**: `tests/node/arrangements.test.ts` asserts it is `KIND_ORDER`'s kinds,
+ * each once. A kind added to `PaneKind` is a type error in `KIND_ORDER`, and that test is what then asks for it here.
+ */
+export const HEADER_ORDER: readonly PaneKind[] = ['source', 'asm', 'lambda', 'tm']
+
+/**
+ * A kind's word where the app says it to a reader: on its `views` toggle, in the view keys' hint, and in the sentence
+ * the live region reads after a switch. One table, so the three cannot spell a kind two ways.
+ */
+export const KIND_WORD: Readonly<Record<PaneKind, string>> = { source: 'source', lambda: 'λ', asm: 'asm', tm: 'TM' }
+
+/** Whether the views area is wider than it is tall (`wide`) or taller than it is wide (`tall`) — spec §4.4. */
+export type Shape = 'wide' | 'tall'
+
+/** The id a kind's view has in a default arrangement — the four `defaultLayout()` has always minted as literals. */
+const DEFAULT_LEAF: Readonly<Record<PaneKind, LeafId>> = {
+  source: SOURCE_LEAF,
+  lambda: 'lambda-0',
+  asm: 'asm-0',
+  tm: 'tm-0',
+}
+
+/**
+ * The tree a combination of kinds shows the first time it is visited — the view layouts spec §4.4. Its leaves are
+ * `kinds` in `KIND_ORDER`, whatever order they are handed in, under the default ids.
+ *
+ * | kinds | `wide` | `tall` |
+ * | --- | --- | --- |
+ * | 1 | the leaf | the leaf |
+ * | 2 | a row of the two | a column of the two |
+ * | 3 | a row: the first, beside a column of the other two | a column: the first, over a row of the other two |
+ * | 4 | a row of two columns: source over asm, beside λ over TM | a column of two rows: source and λ, over asm and TM |
+ *
+ * **IN A WIDE AREA NO DIVIDER AND NO VIEW RUNS THE WHOLE WIDTH** (the user's decision, 2026-10-11): the views are
+ * columns side by side, each with its own stack, so the one divider that spans the area is the vertical one and each
+ * side's views are resized on their own. It was a column of rows, whose one horizontal divider moved both sides
+ * together, and whose third view lay across the whole width. A tall area gets the same trees turned on their side,
+ * since there a view across the width is the only view wide enough to read.
+ *
+ * **ALL FOUR SIT IN THE SAME CORNERS IN BOTH**: source top left, λ top right, asm bottom left, TM bottom right — where
+ * they have been since the asm view joined them. What differs is which pairs share a divider.
+ *
+ * **IT THROWS FOR NO KINDS**: a tree has a leaf or more, and every caller holds a combination, which is not empty.
+ */
+export function defaultArrangement(kinds: readonly PaneKind[], shape: Shape): LayoutNode {
+  const pair = (dir: Dir, a: LayoutNode, b: LayoutNode): LayoutNode => ({
+    kind: 'split',
+    dir,
+    sizes: [0.5, 0.5],
+    children: [a, b],
+  })
+  const [a, b, c, d] = KIND_ORDER.filter((k) => kinds.includes(k)).map(
+    (k): LayoutNode => ({ kind: 'leaf', id: DEFAULT_LEAF[k], pane: k }),
+  )
+  // ACROSS THE AREA'S LONG SIDE FIRST, THEN ALONG ITS SHORT ONE.
+  const [outer, inner]: [Dir, Dir] = shape === 'tall' ? ['column', 'row'] : ['row', 'column']
+  if (a === undefined) throw new Error('a default arrangement needs a kind or more')
+  if (b === undefined) return a
+  if (c === undefined) return pair(outer, a, b)
+  if (d === undefined) return pair(outer, a, pair(inner, b, c))
+  return shape === 'tall'
+    ? pair('column', pair('row', a, b), pair('row', c, d))
+    : pair('row', pair('column', a, c), pair('column', b, d))
+}
+
 /**
  * The arrangement a first load and `reset preset` build, as a tree — design §4.1.
  *
@@ -601,9 +688,10 @@ export function serializeLayout(root: LayoutNode): string {
  * kind is an entry. A kind left out here would fail `validate` for every stored layout that shows one, and a
  * layout that fails is replaced by the default without a word (`parseLayout`'s own doc), so a view of the new
  * kind would be lost on every reload with `tsc` green. The `satisfies` makes a missing kind a type error, and
- * the keys are the list (`legs.ts` has the class of bug).
+ * the keys are the list (`legs.ts` has the class of bug). **THE LIST IS `KIND_ORDER`'s**, which is where the
+ * `satisfies` is written now: one keyed record, read here as strings and there as kinds.
  */
-const PANE_KINDS: readonly string[] = Object.keys({ source: 0, lambda: 0, asm: 0, tm: 0 } satisfies Record<PaneKind, 0>)
+const PANE_KINDS: readonly string[] = KIND_ORDER
 
 /**
  * Validate one node and collect its leaf ids, returning `false` on the first violation.
```

In `web/src/link-wiring.ts`:

```diff
--- a/web/src/link-wiring.ts
+++ b/web/src/link-wiring.ts
@@ -82,8 +82,10 @@ export function createLinkWiring(deps: {
   announce: (text: string) => void
   /** A view's title as its header reads it — how the detachment clause names a view showing a copy. */
   viewTitle: (id: LeafId) => string
+  /** Whether the tree on screen holds this view — `draw.ts`'s dep of the same name has what it excludes. */
+  arranged: (id: LeafId) => boolean
 }): LinkWiring {
-  const { view, sessions, panes, draw, announce, viewTitle } = deps
+  const { view, sessions, panes, draw, announce, viewTitle, arranged } = deps
   const linkStatusHost = deps.statusHost
 
   /**
@@ -100,6 +102,9 @@ export function createLinkWiring(deps: {
    * more recently, and a leg's views could not be told apart in the sentence. `linkStatus` names each view showing a
    * copy, by its title where its leg has more than one view, and suppresses a leg's own clauses only when every view
    * of it shows a copy. A view OFF the page, in Stage, is counted too: it is still a view, and its tab names it.
+   * **A VIEW THE TREE ON SCREEN DOES NOT HOLD IS NOT COUNTED** (the view layouts spec §5): it is kept alive in an
+   * arrangement the workspace remembers, nothing on the page names it, and a share link, whose popover reads this
+   * too, does not carry it.
    *
    * A LEG WITH NO VIEW HAS NOTHING TO SAY, WHICH IS THE HONEST ANSWER RATHER THAN A CONVENIENT ONE.
    * Detachment is a property of the SESSION a view is BOUND to, so with no view there is no binding to
@@ -109,7 +114,7 @@ export function createLinkWiring(deps: {
    */
   const detachedPanes = (): DetachedPanes =>
     perLeg((leg) => {
-      const views = panes.of(leg)
+      const views = panes.of(leg).filter((p) => arranged(p.id))
       return {
         views: views.length,
         copies: views.filter((p) => sessions.entryOf(p.slot.binding.session).detached).map((p) => viewTitle(p.id)),
```

In `web/src/main.ts`:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -3,7 +3,15 @@ import { lintGutter, setDiagnostics as setCmDiagnostics } from '@codemirror/lint
 import { EditorState } from '@codemirror/state'
 import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
 import init, { captureClasses, encodings, tokenClasses } from '../../pkg/redextape_wasm.js'
-import { addViewItems, exampleItems, presetName, wireMenu, workspaceItems } from './app-header'
+import {
+  addViewItems,
+  exampleItems,
+  presetName,
+  shownSentence,
+  viewToggles,
+  wireMenu,
+  workspaceItems,
+} from './app-header'
 import {
   APPEARANCE_LABEL,
   type Appearance,
@@ -12,6 +20,7 @@ import {
   readStored,
   STORAGE_KEY,
 } from './appearance'
+import { type Combination, combinationOf, enter, keyOf, liveLeaves, shapeOf, toggled } from './arrangements'
 import type { AsmPane } from './asm-pane'
 import { showBanner } from './banner'
 import { schemeName } from './base16'
@@ -41,6 +50,7 @@ import { icon } from './icons'
 import { LambdaTrees } from './lambda-trees'
 import {
   closeLeaf,
+  defaultArrangement,
   defaultLayout,
   LAYOUT_STORAGE_KEY,
   type LayoutNode,
@@ -133,10 +143,13 @@ import {
 let leafCounter = 1
 
 /**
- * Advance `leafCounter` past every numeric suffix in `tree` — called on the tree `main()` starts with, whether that
- * came from storage or from `defaultLayout()`, and on the tree of each workspace an opened link puts in force
+ * Advance `leafCounter` past every numeric suffix in `ids` — called on the views `main()` starts with, whether they
+ * came from storage or from `defaultLayout()`, and on those of each workspace an opened link puts in force
  * (`showWorkspace`).
  *
+ * **EVERY LIVE VIEW'S ID, NOT THE TREE ON SCREEN'S ALONE** (the view layouts spec §5.1): `arrangements.ts`'s
+ * `liveLeaves`, so an id minted in one arrangement cannot be one a remembered arrangement holds for another view.
+ *
  * FIX THE CALLER, NOT THE GUARD. `splitLeaf`'s refusal of an id already in the tree is deliberate and
  * correct (its own doc: a duplicate id would not error, it would silently make the second leaf
  * unreachable) — the bug was minting a colliding id, not detecting one.
@@ -152,9 +165,9 @@ let leafCounter = 1
  * read through the same `leafNumber` (Plan 7 part 6a spec §5.3, amended 2026-10-01). From 2^53 on, `+ 1` no longer
  * moves the counter, so after a link carrying `pane-1e300` the second view added would mint a duplicate.
  */
-function seedLeafCounter(tree: LayoutNode): void {
-  for (const leaf of leaves(tree)) {
-    const n = leafNumber(leaf.id)
+function seedLeafCounter(ids: Iterable<LeafId>): void {
+  for (const id of ids) {
+    const n = leafNumber(id)
     if (n !== null && n >= leafCounter) leafCounter = n + 1
   }
 }
@@ -238,6 +251,7 @@ async function main(): Promise<EditorView> {
   const aboutBuild = document.querySelector<HTMLElement>('#about-build')
   const noticeHost = document.querySelector<HTMLElement>('#notice')
   const liveHost = document.querySelector<HTMLElement>('#live')
+  const viewsShown = document.querySelector<HTMLElement>('#views-shown')
   // **`#views`, NOT `<main>` — spec §9.** `renderLayout` opens with `root.replaceChildren()`, so the
   // layout tree needed a root of its own the moment the inspector column came to live in `<main>` beside
   // it: an inspector directly under `<main>` would be destroyed on the first layout commit.
@@ -276,6 +290,7 @@ async function main(): Promise<EditorView> {
     !inspectorHost ||
     !strip ||
     !liveHost ||
+    !viewsShown ||
     !root
   ) {
     throw new Error('the page is missing a mount point')
@@ -1042,7 +1057,7 @@ async function main(): Promise<EditorView> {
     },
     close: () => {
       const grew = neighbourOf(tree, SOURCE_LEAF)
-      tree = closeLeaf(tree, SOURCE_LEAF)
+      enterTree(closeLeaf(tree, SOURCE_LEAF))
       // `focusView`, NOT `applyLayout` THEN `focusPane` — its own doc has why the order matters on the
       // stage. Safe here by arithmetic too (`source` is always `leaves()[0]`, so the neighbour that grows
       // and the view that becomes focused are the same leaf), and that is exactly the kind of accident
@@ -1246,6 +1261,11 @@ async function main(): Promise<EditorView> {
   }
 
   /** The workspace storage opens on: the stored one if there is a usable value there, the default otherwise. */
+  /**
+   * The views area's shape, which decides how a combination's first two views sit (`layout.ts`'s `defaultArrangement`):
+   * measured each time a default is built and never stored, since the tree it gave is.
+   */
+  const viewsShape = () => shapeOf(root.getBoundingClientRect())
   const storedWorkspace = parseWorkspace(readLayoutStorage()) ?? defaultWorkspace()
   /**
    * THE WORKSPACE — a link's where one opens whole (Plan 7 part 6a spec §5.3), otherwise restored from `localStorage`
@@ -1267,6 +1287,45 @@ async function main(): Promise<EditorView> {
     inspector: restored.inspector,
     display: restored.display,
     tmDisplay: restored.tmDisplay,
+    arrangements: restored.arrangements,
+  }
+  /**
+   * Whether the tree on screen holds the view `id` — false for a view kept alive in an arrangement the workspace
+   * remembers. The surfaces the views share ask it: the step bar, the link status line and the running focuses each
+   * describe what is arranged on screen, in tiles or as Stage's tabs, and never a view no one can reach.
+   */
+  const arranged = (id: LeafId): boolean => leaves(tree).some((l) => l.id === id)
+  /**
+   * PUT `next` ON SCREEN — the one place a gesture writes the tree (the view layouts spec §4.3): `arrangements.ts`'s
+   * `enter`, which remembers the tree left under its own combination where `next` shows another. A divider, a
+   * split, `+ view`, a title pick and `✕` reach it through `pane-host.ts`'s `setTree`; the source view's own `✕` and
+   * a switch call it here.
+   *
+   * **NOT *RESET PRESET* AND NOT AN OPENED LINK**: each replaces the workspace whole, what it remembers included, and
+   * writes `tree` and `ws` together.
+   *
+   * **A VIEW AN EDIT TAKES OUT OF THE TREE IS CLOSED, AND ITS PANEL STATE AND DISPLAY GO WITH IT** — unless the write
+   * is a switch's (`switching`), whose views are only off the screen. The tree a `✕` left is remembered, so the
+   * closed view's id is still a live one by `liveLeaves`' test and `normaliseWorkspace` would keep its state for the
+   * view built there next; `tests/browser/workspace-restore.test.ts` has that view inheriting a closed panel.
+   */
+  const enterTree = (next: LayoutNode, switching = false): void => {
+    const entered = enter({ tree, arrangements: ws.arrangements }, next)
+    if (!switching) {
+      const kept = new Set(leaves(next).map((l) => l.id))
+      const closed = new Set(
+        leaves(tree)
+          .map((l) => l.id)
+          .filter((id) => !kept.has(id)),
+      )
+      if (closed.size > 0) {
+        const without = <T>(by: Readonly<Record<LeafId, T>>): Record<LeafId, T> =>
+          Object.fromEntries(Object.entries(by).filter(([leaf]) => !closed.has(leaf)))
+        ws = { ...ws, panels: without(ws.panels), display: without(ws.display), tmDisplay: without(ws.tmDisplay) }
+      }
+    }
+    tree = entered.tree
+    if (entered.arrangements !== ws.arrangements) ws = { ...ws, arrangements: entered.arrangements }
   }
   /**
    * The focused view, repaired against the tree it names a leaf of.
@@ -1280,8 +1339,9 @@ async function main(): Promise<EditorView> {
   const focusedLeaf = (): LeafId => (leaves(tree).some((l) => l.id === ws.focused) ? ws.focused : defaultFocus(tree))
 
   /**
-   * Drop what the tree no longer holds — the panel state and the display of a closed view, and a focus
-   * on one.
+   * Drop what no arrangement holds any longer — the panel state and the display of a closed view — and a focus on a
+   * view that is not on screen. A view a remembered arrangement holds is live and keeps both (the view layouts spec
+   * §5.1).
    *
    * **`defaultLayout()` RE-MINTS `source`, `lambda-0`, `asm-0` AND `tm-0` AS LITERALS**, so a leaf id genuinely
    * comes back: close the TM view with its rules panel shut, then *reset preset*, and the new `tm-0`
@@ -1292,7 +1352,7 @@ async function main(): Promise<EditorView> {
    * the same way, in `applyLayout`'s creation pass.
    */
   const normaliseWorkspace = (): void => {
-    const live = new Set(leaves(tree).map((l) => l.id))
+    const live = liveLeaves(tree, ws.arrangements)
     const panels = Object.fromEntries(Object.entries(ws.panels).filter(([leaf]) => live.has(leaf)))
     const display = Object.fromEntries(Object.entries(ws.display).filter(([leaf]) => live.has(leaf)))
     const tmDisplay = Object.fromEntries(Object.entries(ws.tmDisplay).filter(([leaf]) => live.has(leaf)))
@@ -1309,7 +1369,7 @@ async function main(): Promise<EditorView> {
   // workspace, which seeds the counter as it writes the tree. (Re-seeding on every layout would be harmless — the
   // function only ever advances — but it would also be a third place to read as though the invariant needed
   // maintaining.)
-  seedLeafCounter(tree)
+  seedLeafCounter(liveLeaves(tree, ws.arrangements).keys())
 
   /**
    * THE PANE LIFECYCLE — `pane-host.ts`'s own doc has the argument for why `hosts` and `pendingBinding`,
@@ -1344,9 +1404,9 @@ async function main(): Promise<EditorView> {
     nextLeafId,
     neighbourOf,
     getTree: () => tree,
-    setTree: (next) => {
-      tree = next
-    },
+    setTree: enterTree,
+    liveLeaves: () => liveLeaves(tree, ws.arrangements),
+    applied: () => viewsToggles.sync(combinationOf(tree)),
     stage: () => ws.switches.views === 'stage',
     focusedLeaf,
     // A THUNK WRAPPER, NOT THE REFERENCE — `viewTitle` is declared below this call (it needs the pane
@@ -1567,6 +1627,44 @@ async function main(): Promise<EditorView> {
 
   wireMenu(workspaceButton, workspaceMenu, fillWorkspaceMenu)
 
+  /**
+   * A SWITCH TO ANOTHER COMBINATION OF VIEWS — the view layouts spec §4.5. A `views` toggle and a view key both end
+   * here: the combination's remembered arrangement, or its default the first time it is visited.
+   *
+   * **REFUSED WHERE ITS VIEWS WOULD TAKE THE LIVE ONES PAST THE BOUND** (§5.6), with the notice an add over it gets:
+   * a default arrangement's views are new ones where the workspace has closed its own.
+   *
+   * **NOT HELD TO THE 160 PX FLOOR**: it shows a remembered tree, and a stored tree is not held to it either.
+   *
+   * **`switchViews`, NOT `focusView`**: the keyboard focus stays on the toggle that was pressed, or in the editor a
+   * view key was pressed from, unless its view left the page (`pane-host.ts` has the argument).
+   */
+  const switchTo = (target: Combination): void => {
+    const key = keyOf(target)
+    if (target.length === 0 || key === keyOf(combinationOf(tree))) return
+    const next = ws.arrangements[key] ?? defaultArrangement(target, viewsShape())
+    const entered = enter({ tree, arrangements: ws.arrangements }, next)
+    if (liveLeaves(entered.tree, entered.arrangements).size > MAX_TREE_LEAVES) {
+      refused({ leaf: focusedLeaf(), gesture: 'view', why: 'full' })
+      return
+    }
+    enterTree(next, true)
+    paneHost.switchViews(focusedLeaf())
+    notices.announce(shownSentence(combinationOf(tree)))
+  }
+
+  // THE `views` TOGGLES — spec §6. `pane-host.ts`'s `applied` brings them up to the tree each time one is rendered,
+  // so a `✕`, a `+ view` and an opened link move them as a press does.
+  const viewsToggles = viewToggles(viewsShown, (kind) => switchTo(toggled(combinationOf(tree), kind)))
+  // **HIDDEN IN A WINDOW 40rem WIDE OR NARROWER** (`style.css` has what they cost the header there). A view key, a
+  // view's `✕` and `+ view` still choose the views; what a narrow window goes without is the header's one press.
+  const narrowWindow = matchMedia('(max-width: 40rem)')
+  const placeToggles = (): void => {
+    viewsShown.hidden = narrowWindow.matches
+  }
+  narrowWindow.addEventListener('change', placeToggles)
+  placeToggles()
+
   /**
    * A view's title, in the title-selector's own spelling — the bar's prefix (spec §8) and, from part 2b's
    * Stage task, a tab's label (§5).
@@ -1596,9 +1694,15 @@ async function main(): Promise<EditorView> {
     // so from the other side), so this list is already "every λ or TM view in the layout" — in Stage,
     // views off the page too. That is spec §8's rule, not an oversight: with the focused view unable to
     // step, the bar keeps "the last view that could", and in Stage the source tab is that case.
+    //
+    // **OF THE TREE ON SCREEN** (the view layouts spec §5): a view kept alive in a remembered arrangement has no tab
+    // and no place on the page, so the bar never drives one. A Stage tab off the page is in the tree, and still can.
     const id = barTarget(
       focusedLeaf(),
-      panes.all().map((p) => p.id),
+      panes
+        .all()
+        .filter((p) => arranged(p.id))
+        .map((p) => p.id),
       lastSteppable,
     )
     if (id === null) return null
@@ -1657,8 +1761,10 @@ async function main(): Promise<EditorView> {
     // only preset that can reach this line is a real one — the `??` is what holds if a caller ever gets
     // here another way, which is the same standing `layout.ts`'s refusals take against their own UI.
     const preset = presetOf(ws.switches) ?? 'explorer'
+    // **EVERY REMEMBERED ARRANGEMENT GOES WITH IT** (the view layouts spec §4.6): the default views are back, and a
+    // toggle pressed next shows that combination's default, not what it was left as.
     tree = defaultLayout()
-    ws = { ...ws, switches: PRESETS[preset] }
+    ws = { ...ws, switches: PRESETS[preset], arrangements: {} }
     // **THE FOCUS GOES INTO THE NEW ARRANGEMENT — whole-branch review follow-up, the sibling search
     // C1's fix asked for.** `hidePopover()` above hands focus back to whatever held it before the menu
     // opened, which for a user reaching this item is a control inside one of the views. Rebuilding the
@@ -1828,7 +1934,10 @@ async function main(): Promise<EditorView> {
     return {
       program: view.state.doc.toString(),
       encoding: picker.value,
-      workspace: serializeWorkspace({ tree, ...ws }),
+      // **THE ARRANGEMENT ON SCREEN AND NO OTHER** (the view layouts spec §4.7): a reader needs what the sender saw, and
+      // a link has a size to keep down. Emptied here, `serializeWorkspace` writes no `arrangements` and no state of a
+      // view only a remembered arrangement held.
+      workspace: serializeWorkspace({ tree, ...ws, arrangements: {} }),
       positions: steps,
     }
   }
@@ -1867,7 +1976,7 @@ async function main(): Promise<EditorView> {
     const { tree: nextTree, ...rest } = next
     tree = nextTree
     ws = rest
-    seedLeafCounter(tree)
+    seedLeafCounter(liveLeaves(tree, ws.arrangements).keys())
     applySwitches()
     inspectorPanel.setOpen(ws.inspector)
     sourceOutline.panel.setOpen(ws.panels[SOURCE_LEAF]?.outline ?? false)
@@ -2348,6 +2457,7 @@ async function main(): Promise<EditorView> {
     draw: () => draw(),
     announce: (t: string) => notices.announce(t),
     viewTitle,
+    arranged,
   })
 
   // ASSIGNED HERE, NOT DECLARED HERE — see the `let draw` comment above for why the split is forced
@@ -2376,6 +2486,7 @@ async function main(): Promise<EditorView> {
     unseen,
     leaves: () => leaves(tree).length,
     sourceAvailable: () => !leaves(tree).some((l) => l.pane === 'source'),
+    arranged,
     // WRAPPED RATHER THAN PASSED AS `custody.hasEditor`, the same shape `editorHome` below uses for
     // `custody.homeFor`: the methods read `panes`, `sessions` and the two custody maps through the
     // closure `createEditorCustody` returns, and handing the reference over bare would work today only
```

In `web/src/pane-host.ts`:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -11,6 +11,7 @@ import {
   insertBeside,
   type LayoutNode,
   leaves,
+  MAX_TREE_LEAVES,
   resize,
   SOURCE_LEAF,
   setLeafKind,
@@ -95,6 +96,11 @@ export type PaneHost = {
    * steps a tree-changing gesture owes, in the one order that works on the stage. See the implementation.
    */
   focusView(id: LeafId | null): void
+  /**
+   * Record `id` as the focused view and rebuild the layout around it, leaving the keyboard focus where it was unless
+   * the view that held it left the page — a switch to another combination of views. See the implementation.
+   */
+  switchViews(id: LeafId): void
   /**
    * `focusView`, with every view the tree keeps that shows a copy rebuilt on the program — *reset preset*, which says
    * it restores the default views. See the implementation.
@@ -244,6 +250,16 @@ export function createPaneHost(deps: {
   neighbourOf(tree: LayoutNode, id: LeafId): LeafId | null
   getTree(): LayoutNode
   setTree(next: LayoutNode): void
+  /**
+   * Every live view and what it shows: the leaves of the tree on screen and of every arrangement the workspace
+   * remembers (`arrangements.ts`'s `liveLeaves`; the view layouts spec §5.1).
+   */
+  liveLeaves(): ReadonlyMap<LeafId, PaneKind>
+  /**
+   * Told each time a tree has been put on the page, after its views are rendered and before it is stored — where the
+   * header's `views` toggles are brought up to the tree, since this is the one place every change to it arrives.
+   */
+  applied(): void
   /** Whether the workspace draws its views as a tabbed stage — spec §5's `views` switch. */
   stage(): boolean
   /** The focused leaf, repaired against the tree — in Stage it is the one view on the page. */
@@ -335,6 +351,8 @@ export function createPaneHost(deps: {
     neighbourOf,
     getTree,
     setTree,
+    liveLeaves,
+    applied,
     stage,
     focusedLeaf,
     viewTitle,
@@ -622,7 +640,10 @@ export function createPaneHost(deps: {
    */
   const admit = (leaf: LeafId, gesture: AddRefused['gesture'], build: (newId: LeafId) => LayoutNode): boolean => {
     let why: AddRefusal | null
-    if (stage()) why = holdsMostLeaves(getTree()) ? 'full' : null
+    // **THE BOUND IS ON EVERY LIVE VIEW** (the view layouts spec §5.6): a view a remembered arrangement holds is kept
+    // alive off the page, and a stored workspace is refused past the bound on all of them together.
+    if (liveLeaves().size >= MAX_TREE_LEAVES) why = 'full'
+    else if (stage()) why = holdsMostLeaves(getTree()) ? 'full' : null
     else {
       const area = root.getBoundingClientRect()
       const divides = gesture === 'column' ? 'height' : 'width'
@@ -1057,6 +1078,28 @@ export function createPaneHost(deps: {
     focusPane(id)
   }
 
+  /**
+   * A switch to another combination of views (the view layouts spec §4.5): record the focused view, rebuild, and
+   * leave the keyboard focus where it was.
+   *
+   * **`focusView` MOVES THE FOCUS INTO THE VIEW, AND A SWITCH MUST NOT.** A toggle pressed in the header keeps the
+   * focus, so a second toggle is one more press; and a view key pressed from an editor must leave the caret in it.
+   *
+   * **THE REBUILD TAKES THE FOCUS FROM ANYTHING INSIDE `root`, WHETHER OR NOT ITS VIEW STAYS**: `renderLayout` and
+   * `renderStage` detach every host and append the ones the tree names, and an element that leaves the document
+   * loses the focus though it comes straight back. So the element is remembered and focused again where its view is
+   * still on the page, and the focused view takes the focus, as after a close, where it is not.
+   */
+  const switchViews = (id: LeafId): void => {
+    const held = document.activeElement
+    const within = held instanceof HTMLElement && root.contains(held) ? held : null
+    setFocused(id)
+    applyLayout('none', true)
+    if (within === null) return
+    if (root.contains(within)) within.focus()
+    else focusPane(id)
+  }
+
   /**
    * *Reset preset*'s rebuild: `focusView`, with every view that shows a copy rebuilt on the program.
    *
@@ -1180,11 +1223,20 @@ export function createPaneHost(deps: {
     }
   }
 
-  const applyLayout = (rebuild: 'none' | 'copies' | 'every' = 'none'): void => {
+  /**
+   * The leaves of the tree `applyLayout` last put on the page — what tells a view that has come back from a remembered
+   * arrangement from one that was on screen all along.
+   */
+  let arranged: ReadonlySet<LeafId> = new Set()
+  const applyLayout = (rebuild: 'none' | 'copies' | 'every' = 'none', switching = false): void => {
     // WHAT EACH LIVE LEAF RENDERS, NOT MERELY WHICH LEAVES ARE LIVE — a `Map` where this was a `Set`,
     // because there are two reasons to drop an entry now and the second one is about the VALUE.
     // `sourceLayout.update(live.size > 1, ...)` below is unaffected: a map's size is still the leaf count.
     const live = new Map(leaves(getTree()).map((l) => [l.id, l.pane]))
+    // EVERY LIVE VIEW, THE ONES OFF THE SCREEN INCLUDED — the view layouts spec §5.1. A view a SWITCH took off the
+    // screen keeps its entry while a remembered arrangement holds its leaf, as a Stage tab that is not selected
+    // keeps its own: its pane, with what it has open, is what a switch back shows.
+    const remembered = liveLeaves()
     // THE COPIES WHOSE EDITOR PASS 1 DESTROYS — mounted again on a view still showing each, after pass 2.
     const unmounted: SessionId[] = []
     for (const p of panes.all()) {
@@ -1199,6 +1251,16 @@ export function createPaneHost(deps: {
       // about to stop existing either way, which is why the custody handover below covers both without
       // a branch. `live.get` answers `undefined` for a departed leaf, and no `PaneKind` equals that.
       if (live.get(p.id) === p.kind && !dropped) continue
+      // **OFF THE SCREEN AND STILL LIVE: KEPT, WHATEVER KIND THE ARRANGEMENT THAT HOLDS IT REMEMBERS** (§5.4). The
+      // tree on screen wins an id two trees hold under two kinds, and it does not name this one, so the pane stays
+      // what it is; entering the other arrangement compares kinds on the line above, as a title pick is compared.
+      //
+      // **ONLY A SWITCH PARKS A VIEW. A `✕` CLOSES ONE, AS IT ALWAYS HAS.** The tree a `✕` left is remembered too, so
+      // its leaf is "live" by the same test — but the user closed that view, and a closed view hands its copy's
+      // editor on, stops counting as a view of its copy, and is gone. So an entry leaving the tree in THIS call is
+      // kept only when the call is a switch's; one already off the screen (`arranged` does not hold it) stays kept
+      // through every other gesture. A view built later where a closed one was is a new view on the program.
+      if (!live.has(p.id) && remembered.has(p.id) && !dropped && (switching || !arranged.has(p.id))) continue
       // THE CUSTODY HANDOVER, AND IT HAS TO BE ON THIS SIDE OF `panes.remove` — see this function's own
       // doc. `takeEditor()` returns `null` for every pane that was not holding one, which is all of
       // them on an ordinary close, so this costs a method call and a field read on the way out.
@@ -1253,6 +1315,20 @@ export function createPaneHost(deps: {
     // no other reason to know this pane exists.
     sourceLayout.update(live.size > 1, false)
 
+    // **A VIEW BACK FROM A REMEMBERED ARRANGEMENT, SHOWING A COPY NO VIEW HOLDS AN EDITOR FOR, MOUNTS ONE** — the
+    // creation pass's last line, for a view that was kept and so is not created (the view layouts spec §5.5). While
+    // it was off the screen the view that held its copy's editor may have been closed: pass 1 destroys a machine
+    // copy's editor then and `mountOnViewOf` looks for a view of the copy in the tree, where this one was not. It
+    // came back showing the copy with no editor on the page and nothing offering one. `mountScratchEditor` builds none
+    // while one is mounted or held anywhere, so a view that kept its own editor, and a view whose copy's editor
+    // another view holds, are left as they are.
+    for (const l of leaves(getTree())) {
+      const kept = panes.get(l.id)
+      if (kept === undefined || arranged.has(l.id) || kept.slot.binding.session === SOURCE_SESSION) continue
+      mountScratchEditor(l.id, kept.pane as unknown as EditablePane, kept.slot.binding.session)
+    }
+    arranged = new Set(live.keys())
+
     for (const l of leaves(getTree())) {
       if (panes.get(l.id) !== undefined) continue
       if (l.pane === 'source') continue // the source pane is chrome inside its host, not a PaneView
@@ -1494,6 +1570,7 @@ export function createPaneHost(deps: {
         })
       }
       giveScrollBack()
+      applied()
       persist()
       draw()
     }
@@ -1503,6 +1580,7 @@ export function createPaneHost(deps: {
     applyLayout: () => applyLayout(),
     focusPane,
     focusView,
+    switchViews,
     resetViews,
     rebuildViews,
     seedHost(id: LeafId, host: HTMLElement): void {
```

In `web/src/style.css`:

```diff
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -234,7 +234,8 @@ select option {
 #share,
 #appearance,
 #settings,
-#about {
+#about,
+.view-toggle {
   display: inline-flex;
   align-items: center;
   gap: 0.35em;
@@ -247,6 +248,52 @@ select option {
   cursor: pointer;
   white-space: nowrap;
 }
+/* THE `views` TOGGLES (the view layouts spec §6): four of the header's buttons, joined, one a kind of view.
+
+   **A PRESSED TOGGLE IS RAISED AND UNDERLINED, AND ONE THAT IS NOT IS DIM AND DASHED** — a fill, a rule under it and
+   the border's own line, never colour alone (umbrella §4 rule 5), so the two states differ in every palette and
+   without colour at all. The rule under it is an inset shadow, so pressing a toggle does not move its neighbours.
+
+   **THE LAST ONE PRESSED IS DISABLED AND KEEPS ITS PRESSED LOOK**: it is shown, and it cannot be hidden. Only the
+   cursor says it cannot be pressed, as the view menu's disabled items say it; its tooltip has the reason. */
+.views-shown {
+  display: inline-flex;
+  align-items: center;
+}
+.view-toggle {
+  padding-inline: 0.3em;
+  border-radius: 0;
+  margin-inline-start: calc(-1 * var(--control-border));
+  border-style: dashed;
+  color: var(--fg-dim);
+}
+.view-toggle:first-child {
+  margin-inline-start: 0;
+  border-start-start-radius: var(--radius);
+  border-end-start-radius: var(--radius);
+}
+.view-toggle:last-child {
+  border-start-end-radius: var(--radius);
+  border-end-end-radius: var(--radius);
+}
+.view-toggle[aria-pressed="true"] {
+  position: relative;
+  border-style: solid;
+  background: var(--bg-raised);
+  color: var(--fg);
+  box-shadow: inset 0 -2px 0 var(--fg);
+}
+.view-toggle:disabled {
+  cursor: default;
+}
+/* **IN A WINDOW 40rem WIDE OR NARROWER THE TOGGLES ARE HIDDEN**, by the `hidden` attribute `main.ts` sets from that
+   media query, which this rule honours where `display: inline-flex` above would not. They are 148 to 154px wide, and
+   at 390px they cost the header a row, 136px to 181px in Paper and Instrument: the row `examples ▾` was squeezed back
+   into above, and at 320 × 568 the page no longer fits its window. At 481px they cost it one too. The attribute and
+   not a `display` in a media rule, so that a control no one can reach is one `controls-gate.test.ts` does not walk. */
+.views-shown[hidden] {
+  display: none;
+}
 /* The header's menus, on the view menu's positioning — its comment has the argument. */
 .header-menu {
   position-area: block-end span-inline-end;
```

In `web/src/workspace.ts`:

```diff
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -1,4 +1,5 @@
-import { defaultLayout, type LayoutNode, leaves, parseTree, SOURCE_LEAF } from './layout'
+import { type Arrangements, liveLeaves, parseKey, treeKey } from './arrangements'
+import { defaultLayout, type LayoutNode, leaves, MAX_TREE_LEAVES, parseTree, SOURCE_LEAF } from './layout'
 import type { LeafId } from './panes'
 
 /**
@@ -10,6 +11,9 @@ import type { LeafId } from './panes'
  * version 1 — the tree shape did not change, so a stored layout is migrated rather than reset. Any other
  * version is `null`, and the caller uses `defaultWorkspace()`, as `parseLayout`'s callers always have.
  *
+ * **`arrangements` CAME LATER STILL, AS A FIELD THAT MAY BE ABSENT** (the view layouts spec §4.2): the tree each
+ * combination of views was last seen in, except the one on screen, which is `tree`. The version stays 2.
+ *
  * **THE PRESET IS NOT STORED.** `presetOf` derives it from the switches, because a stored preset would be
  * a second copy of three values that could disagree with them.
  */
@@ -104,6 +108,12 @@ export type Workspace = {
    * own rather than a second shape in `display`, so neither leg's parser has to tell the other's entries apart.
    */
   readonly tmDisplay: TmDisplays
+  /**
+   * The arrangement each combination of views remembers, by `arrangements.ts`'s key — every combination visited but
+   * the one `tree` shows (the view layouts spec §4.2). Absent in a workspace stored before it, and not written
+   * while it is empty, so a workspace that has remembered nothing is stored as it always was.
+   */
+  readonly arrangements: Arrangements
 }
 
 export const WORKSPACE_VERSION = 2
@@ -128,6 +138,7 @@ export function defaultWorkspace(): Workspace {
     inspector: true,
     display: {},
     tmDisplay: {},
+    arrangements: {},
   }
 }
 
@@ -149,13 +160,20 @@ export function withPanel(panels: Panels, leaf: LeafId, name: string, open: bool
 /**
  * The stored form.
  *
- * **A VIEW THAT HAS LEFT THE TREE LEAVES NO TRACE.** Its panel state and its display are dropped and a focus
- * on it falls back to `defaultFocus`, here rather than at every close, because the close does not need to
- * know this module exists — and `parseWorkspace` refuses all three, so writing them would make the next
- * load fall back to the default workspace entirely.
+ * **A VIEW NO ARRANGEMENT HOLDS LEAVES NO TRACE.** Its panel state and its display are dropped, here rather than at
+ * every close, because the close does not need to know this module exists — and `parseWorkspace` refuses both, so
+ * writing them would make the next load fall back to the default workspace entirely. A view a remembered
+ * arrangement holds is live (`arrangements.ts`'s `liveLeaves`) and keeps both, so it comes back as it was left.
+ *
+ * **THE FOCUS IS HELD TO THE TREE ON SCREEN ALONE**: a focus on a view off the page falls back to `defaultFocus`.
+ *
+ * **`arrangements` IS WRITTEN ONLY WHILE IT HOLDS ONE**, last, so a workspace that remembers nothing is the string it
+ * was before the field existed. A share link is written from a workspace whose `arrangements` the caller has emptied
+ * (spec §4.7), and so carries none.
  */
 export function serializeWorkspace(ws: Workspace): string {
-  const live = new Set(leaves(ws.tree).map((l) => l.id))
+  const live = liveLeaves(ws.tree, ws.arrangements)
+  const onScreen = new Set(leaves(ws.tree).map((l) => l.id))
   const panels: Record<LeafId, Record<string, boolean>> = {}
   for (const [leaf, open] of Object.entries(ws.panels)) if (live.has(leaf)) panels[leaf] = { ...open }
   const display: Record<LeafId, LambdaDisplay> = {}
@@ -167,11 +185,12 @@ export function serializeWorkspace(ws: Workspace): string {
     tree: ws.tree,
     switches: ws.switches,
     speed: ws.speed,
-    focused: live.has(ws.focused) ? ws.focused : defaultFocus(ws.tree),
+    focused: onScreen.has(ws.focused) ? ws.focused : defaultFocus(ws.tree),
     panels,
     inspector: ws.inspector,
     display,
     tmDisplay,
+    ...(Object.keys(ws.arrangements).length === 0 ? {} : { arrangements: ws.arrangements }),
   })
 }
 
@@ -224,6 +243,28 @@ function parseTmDisplay(v: unknown, ids: ReadonlySet<string>): TmDisplays | null
   return out
 }
 
+/**
+ * A stored `arrangements`, or `null` for a malformed one — the view layouts spec §4.2, each rule something a person
+ * could type: a key `arrangements.ts`'s `keyOf` would not write, a tree `parseTree` refuses, a tree filed under
+ * another combination's key, an entry under the key of the tree on screen, and more ids between them all than one
+ * tree may hold.
+ *
+ * **THE BOUND IS ON EVERY LIVE VIEW** (§5.6): `MAX_TREE_LEAVES` bounded what a link or a stored layout could make the
+ * app build, and a view a remembered arrangement holds is built when it is entered.
+ */
+function parseArrangements(v: unknown, tree: LayoutNode): Arrangements | null {
+  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
+  const onScreen = treeKey(tree)
+  const out: Record<string, LayoutNode> = {}
+  for (const [key, stored] of Object.entries(v as Record<string, unknown>)) {
+    if (parseKey(key) === null || key === onScreen) return null
+    const remembered = parseTree(stored)
+    if (remembered === null || treeKey(remembered) !== key) return null
+    out[key] = remembered
+  }
+  return liveLeaves(tree, out).size > MAX_TREE_LEAVES ? null : out
+}
+
 function parsePanels(v: unknown, ids: ReadonlySet<string>): Panels | null {
   if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
   const out: Record<LeafId, Record<string, boolean>> = {}
@@ -271,6 +312,7 @@ export function parseWorkspace(raw: string | null): Workspace | null {
       inspector: true,
       display: {},
       tmDisplay: {},
+      arrangements: {},
     }
   }
   if (e.version !== WORKSPACE_VERSION) return null
@@ -280,8 +322,13 @@ export function parseWorkspace(raw: string | null): Workspace | null {
   const switches = parseSwitches(e.switches)
   if (switches === null) return null
   if (!isSpeed(e.speed)) return null
-  const ids = new Set(leaves(tree).map((l) => l.id))
-  if (typeof e.focused !== 'string' || !ids.has(e.focused)) return null
+  // **A MISSING `arrangements` IS NOT AN INVALID ONE**, for `inspector`'s reason below: every workspace stored before
+  // the view layouts has none. It is read before the per-view fields, which may name any live view (spec §4.2).
+  const arrangements = e.arrangements === undefined ? {} : parseArrangements(e.arrangements, tree)
+  if (arrangements === null) return null
+  const onScreen = new Set(leaves(tree).map((l) => l.id))
+  if (typeof e.focused !== 'string' || !onScreen.has(e.focused)) return null
+  const ids = new Set(liveLeaves(tree, arrangements).keys())
   const panels = parsePanels(e.panels, ids)
   if (panels === null) return null
   // **A MISSING `inspector` IS NOT AN INVALID ONE.** Version 2 shipped in part 2a without this field, so
@@ -302,5 +349,6 @@ export function parseWorkspace(raw: string | null): Workspace | null {
     inspector: e.inspector ?? true,
     display,
     tmDisplay,
+    arrangements,
   }
 }
```

- [ ] **Step 4: Run them, and see them pass**

The same node command (`t3-passing-node.log`): 4 files passed, 202 tests passed.
The same browser command (`t3-passing-browser.log`): 8 files passed, 49 tests passed.

- [ ] **Step 5: Break it on purpose, once a sabotage, and put it back**

Each entry is the replay's own record. Its `sab.sh` saved the file, made the edit, ran
`pnpm exec vitest run --project <project> <file>` for each file named, copied the saved file back and ran `cmp`.

Each line below `sab.sh <id> …` ran; the edit is in `sab-<id>.diff`, the run in `sab-<id>-<project>.log`. Every one
fired, and every file was restored with cmp equal.

**S3a** `src/arrangements.ts`, `enter`: its last line
`return { tree: next, arrangements: { ...kept, [before]: now.tree } }` becomes
`return { tree: next, arrangements: now.arrangements }`.
`sab.sh S3a node:tests/node/arrangements.test.ts browser:tests/browser/view-toggles.test.ts`.
Node: 7 failed, 19 passed, of 26 (all seven are `enter >` cases; the first):

```
 FAIL  |node| tests/node/arrangements.test.ts > enter > remembers the tree left under its key when the combination changes
AssertionError: expected {} to deeply equal { Object (source+tm) }
```

Browser: 6 failed, 5 passed, of 11:

```
 … > hides a kind on a press: the view leaves the page, the toggle says so, and the focus stays on it
AssertionError: expected undefined to deeply equal { 'source+lambda+asm+tm': { …(4) } }
 … > shows it again on a second press, in the arrangement that was left
AssertionError: expected [ 'source', 'asm-0', 'lambda-0', …(1) ] to deeply equal [ 'source', 'lambda-0', 'asm-0', …(1) ]
 … > keeps a view alive off the page: the element that comes back is the one that left
AssertionError: the view was built again while it was off the page: expected <header class="view-header">…(4)</header> to be <header class="view-header">…(4)</header> // Object.is equality
 … > keeps where a view was scrolled to, through another view’s toggle and through its own
AssertionError: the table came back at its start: expected +0 to be 120 // Object.is equality
 … > shows the tree before a ✕ when the closed kind’s toggle is pressed
AssertionError: precondition: the pair is remembered: expected undefined to be defined
 … > makes a link that carries the arrangement on screen and none of the ones it remembers
AssertionError: precondition: something is remembered: expected 0 to be greater than 0
```

Restored `src/arrangements.ts`, cmp equal.

The edit:

```diff
--- a/web/src/arrangements.ts
+++ b/web/src/arrangements.ts
@@ -74,7 +74,7 @@
   const after = treeKey(next)
   if (before === after) return { tree: next, arrangements: now.arrangements }
   const kept = Object.fromEntries(Object.entries(now.arrangements).filter(([key]) => key !== after))
-  return { tree: next, arrangements: { ...kept, [before]: now.tree } }
+  return { tree: next, arrangements: now.arrangements }
 }
 
 /**
```

**S3b** `src/pane-host.ts`, `applyLayout` pass 1: the line
`if (!live.has(p.id) && remembered.has(p.id) && !dropped && (switching || !arranged.has(p.id))) continue` deleted.
`sab.sh S3b browser:tests/browser/view-toggles.test.ts`: 2 failed, 9 passed, of 11. The expected case, and one more:

```
 … > keeps a view alive off the page: the element that comes back is the one that left
AssertionError: the view was built again while it was off the page: expected <header class="view-header">…(4)</header> to be <header class="view-header">…(4)</header> // Object.is equality
 … > keeps where a view was scrolled to, through another view’s toggle and through its own
AssertionError: the table came back at its start: expected +0 to be 120 // Object.is equality
```

Restored `src/pane-host.ts`, cmp equal.

The edit:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1260,7 +1260,6 @@
       // editor on, stops counting as a view of its copy, and is gone. So an entry leaving the tree in THIS call is
       // kept only when the call is a switch's; one already off the screen (`arranged` does not hold it) stays kept
       // through every other gesture. A view built later where a closed one was is a new view on the program.
-      if (!live.has(p.id) && remembered.has(p.id) && !dropped && (switching || !arranged.has(p.id))) continue
       // THE CUSTODY HANDOVER, AND IT HAS TO BE ON THIS SIDE OF `panes.remove` — see this function's own
       // doc. `takeEditor()` returns `null` for every pane that was not holding one, which is all of
       // them on an ordinary close, so this costs a method call and a field read on the way out.
```

**S3c** the same line, `(switching || !arranged.has(p.id))` replaced by `true`.
`sab.sh S3c browser:tests/browser/scratch-buffers.test.ts`: 1 failed, 1 passed, of 2, as expected.

```
 FAIL  |browser (chromium)| tests/browser/scratch-buffers.test.ts > the header buffer list > lists a copy no view is showing as not shown, and deleting it ends the copy and its editor
AssertionError: expected [ 'λ copy 1 · 1 view' ] to deeply equal [ 'λ copy 1 · not shown' ]
```

Restored `src/pane-host.ts`, cmp equal.

The edit:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1260,7 +1260,7 @@
       // editor on, stops counting as a view of its copy, and is gone. So an entry leaving the tree in THIS call is
       // kept only when the call is a switch's; one already off the screen (`arranged` does not hold it) stays kept
       // through every other gesture. A view built later where a closed one was is a new view on the program.
-      if (!live.has(p.id) && remembered.has(p.id) && !dropped && (switching || !arranged.has(p.id))) continue
+      if (!live.has(p.id) && remembered.has(p.id) && !dropped && true) continue
       // THE CUSTODY HANDOVER, AND IT HAS TO BE ON THIS SIDE OF `panes.remove` — see this function's own
       // doc. `takeEditor()` returns `null` for every pane that was not holding one, which is all of
       // them on an ordinary close, so this costs a method call and a field read on the way out.
```

**S3d** `src/main.ts`, `enterTree`: the whole `if (!switching) { … }` block deleted (13 lines).
`sab.sh S3d browser:tests/browser/workspace-restore.test.ts`: 1 failed, 7 passed, of 8, as expected. (The file is the
base's here; Task 4 rewrites this case's tail.)

```
 FAIL  |browser (chromium)| tests/browser/workspace-restore.test.ts > a restored workspace > does not give a re-minted view the panel state of the one that closed
AssertionError: the re-minted view inherited a closed panel: expected 'false' to be 'true' // Object.is equality
```

Restored `src/main.ts`, cmp equal.

The edit:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1311,19 +1311,6 @@
    */
   const enterTree = (next: LayoutNode, switching = false): void => {
     const entered = enter({ tree, arrangements: ws.arrangements }, next)
-    if (!switching) {
-      const kept = new Set(leaves(next).map((l) => l.id))
-      const closed = new Set(
-        leaves(tree)
-          .map((l) => l.id)
-          .filter((id) => !kept.has(id)),
-      )
-      if (closed.size > 0) {
-        const without = <T>(by: Readonly<Record<LeafId, T>>): Record<LeafId, T> =>
-          Object.fromEntries(Object.entries(by).filter(([leaf]) => !closed.has(leaf)))
-        ws = { ...ws, panels: without(ws.panels), display: without(ws.display), tmDisplay: without(ws.tmDisplay) }
-      }
-    }
     tree = entered.tree
     if (entered.arrangements !== ws.arrangements) ws = { ...ws, arrangements: entered.arrangements }
   }
```

**S3e** `src/app-header.ts`, `viewToggles`: `b.disabled = only` becomes `b.disabled = false`.
`sab.sh S3e browser:tests/browser/view-toggles.test.ts`: 3 failed, 8 passed, of 11. The expected case, and two that
start from the state it leaves:

```
 … > disables the last toggle pressed, with its reason, and enables it when another view is shown
AssertionError: expected false to be true // Object.is equality
 … > shows the tree before a ✕ when the closed kind’s toggle is pressed
AssertionError: precondition: source, λ and TM: expected [ 'lambda-0', 'tm-0' ] to deeply equal [ 'source', 'lambda-0', 'tm-0' ]
 … > chooses the tabs in Stage, and keeps the choice when tiles come back
AssertionError: expected [ 'lambda-0', 'tm-0' ] to deeply equal [ 'source', 'lambda-0', 'tm-0' ]
```

Restored `src/app-header.ts`, cmp equal.

The edit:

```diff
--- a/web/src/app-header.ts
+++ b/web/src/app-header.ts
@@ -286,7 +286,7 @@
         const pressed = shown.includes(kind)
         const only = pressed && shown.length === 1
         b.setAttribute('aria-pressed', String(pressed))
-        b.disabled = only
+        b.disabled = false
         const says = only
           ? `the ${KIND_WORD[kind]} view is the only one shown — one view stays`
           : `${pressed ? 'hide' : 'show'} the ${KIND_WORD[kind]} view`
```

**S3f** `src/workspace.ts`, `parseArrangements`: `if (parseKey(key) === null || key === onScreen) return null` becomes
`if (parseKey(key) === null) return null`.
`sab.sh S3f node:tests/node/workspace.test.ts`: 1 failed, 40 passed, of 41.

```
 FAIL  |node| tests/node/workspace.test.ts > the remembered arrangements > refuses an entry under the key of the tree on screen
AssertionError: expected { tree: { kind: 'split', …(3) }, …(8) } to be null
```

Restored `src/workspace.ts`, cmp equal.

The edit:

```diff
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -257,7 +257,7 @@
   const onScreen = treeKey(tree)
   const out: Record<string, LayoutNode> = {}
   for (const [key, stored] of Object.entries(v as Record<string, unknown>)) {
-    if (parseKey(key) === null || key === onScreen) return null
+    if (parseKey(key) === null) return null
     const remembered = parseTree(stored)
     if (remembered === null || treeKey(remembered) !== key) return null
     out[key] = remembered
```

**S3g** `src/workspace.ts`, `parseArrangements`: its last line
`return liveLeaves(tree, out).size > MAX_TREE_LEAVES ? null : out` becomes `return out`.
`sab.sh S3g node:tests/node/workspace.test.ts`: 1 failed, 40 passed, of 41, as expected.

```
 FAIL  |node| tests/node/workspace.test.ts > the remembered arrangements > bounds the views of every tree together at 64, where each tree alone may hold 64
AssertionError: expected { tree: { kind: 'split', …(3) }, …(8) } to be null
```

Restored `src/workspace.ts`, cmp equal.

The edit:

```diff
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -262,7 +262,7 @@
     if (remembered === null || treeKey(remembered) !== key) return null
     out[key] = remembered
   }
-  return liveLeaves(tree, out).size > MAX_TREE_LEAVES ? null : out
+  return out
 }
 
 function parsePanels(v: unknown, ids: ReadonlySet<string>): Panels | null {
```

**S3h** `src/main.ts`, `sharePayload`: `workspace: serializeWorkspace({ tree, ...ws, arrangements: {} }),` becomes
`workspace: serializeWorkspace({ tree, ...ws }),`.
`sab.sh S3h browser:tests/browser/view-toggles.test.ts`: 1 failed, 10 passed, of 11, as expected.

```
 FAIL  |browser (chromium)| tests/browser/view-toggles.test.ts > the views toggles > makes a link that carries the arrangement on screen and none of the ones it remembers
AssertionError: the link carries remembered arrangements: expected true to be false // Object.is equality
```

Restored `src/main.ts`, cmp equal.

The edit:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1937,7 +1937,7 @@
       // **THE ARRANGEMENT ON SCREEN AND NO OTHER** (the view layouts spec §4.7): a reader needs what the sender saw, and
       // a link has a size to keep down. Emptied here, `serializeWorkspace` writes no `arrangements` and no state of a
       // view only a remembered arrangement held.
-      workspace: serializeWorkspace({ tree, ...ws, arrangements: {} }),
+      workspace: serializeWorkspace({ tree, ...ws }),
       positions: steps,
     }
   }
```

**S3i** `src/layout.ts`, `defaultArrangement`: `shape === 'tall' ? ['column', 'row'] : ['row', 'column']` becomes
`shape === 'tall' ? ['row', 'column'] : ['column', 'row']`.
`sab.sh S3i node:tests/node/layout.test.ts browser:tests/browser/view-toggles.test.ts`.
Node: 3 failed, 92 passed, of 95:

```
 … > defaultArrangement > puts a pair side by side in a wide area and one above the other in a tall one
AssertionError: expected { kind: 'split', dir: 'column', …(2) } to deeply equal { kind: 'split', dir: 'row', …(2) }
 … > defaultArrangement > puts the first of three beside a column of the other two, and over a row of them in a tall area
AssertionError: expected { kind: 'split', dir: 'column', …(2) } to deeply equal { kind: 'split', dir: 'row', …(2) }
 … > defaultArrangement > makes no tree whose root is a column in a wide area, and none whose root is a row in a tall one
AssertionError: source+lambda: expected 'column' to be 'row' // Object.is equality
```

Browser: 2 failed, 9 passed, of 11:

```
 … > shows a combination’s default on its first visit: source beside a column of λ over TM
AssertionError: the source view is not the full height: expected 416.75 to be less than 1
 … > shows a pair side by side the first time it is visited
AssertionError: expected 416.75 to be less than 1
```

Restored `src/layout.ts`, cmp equal.

The edit:

```diff
--- a/web/src/layout.ts
+++ b/web/src/layout.ts
@@ -183,7 +183,7 @@
     (k): LayoutNode => ({ kind: 'leaf', id: DEFAULT_LEAF[k], pane: k }),
   )
   // ACROSS THE AREA'S LONG SIDE FIRST, THEN ALONG ITS SHORT ONE.
-  const [outer, inner]: [Dir, Dir] = shape === 'tall' ? ['column', 'row'] : ['row', 'column']
+  const [outer, inner]: [Dir, Dir] = shape === 'tall' ? ['row', 'column'] : ['column', 'row']
   if (a === undefined) throw new Error('a default arrangement needs a kind or more')
   if (b === undefined) return a
   if (c === undefined) return pair(outer, a, b)
```

**S3j** (the earlier agent's A1) `src/main.ts`, the step bar's target: the line `.filter((p) => arranged(p.id))`
deleted. `sab.sh S3j browser:tests/browser/parked-view-surfaces.test.ts`: 1 failed, 2 passed, of 3.

```
 FAIL  |browser (chromium)| tests/browser/parked-view-surfaces.test.ts > the surfaces the views share, with the λ view parked > points the step bar at a view on the page, and steps that one, once the λ view it drove is parked
AssertionError: the bar names a view that is not on the page: expected [ 'source', 'asm · program', …(1) ] to include 'λ · program'
AssertionError: the bar’s step button moved the λ leg while its view was parked: expected 'step 2 of 7' to be 'step 1 of 7' // Object.is equality
```

Restored `src/main.ts`, cmp equal.

The edit:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1701,7 +1701,6 @@
       focusedLeaf(),
       panes
         .all()
-        .filter((p) => arranged(p.id))
         .map((p) => p.id),
       lastSteppable,
     )
```

**S3k** (A2) `src/link-wiring.ts`, `detachedPanes`: `const views = panes.of(leg).filter((p) => arranged(p.id))` becomes
`const views = panes.of(leg)`. `sab.sh S3k browser:tests/browser/parked-view-surfaces.test.ts`: 1 failed, 2 passed, of 3.

```
 FAIL  |browser (chromium)| tests/browser/parked-view-surfaces.test.ts > the surfaces the views share, with the λ view parked > leaves a parked view of a copy out of the link status line and the share popover
AssertionError: the status line counts a parked view of a copy: expected 'λ view shows a copy — not linked to t…' to be '' // Object.is equality
AssertionError: the share popover lists a parked view of a copy: expected 'copies are not included — the λ · cop…' to be null
```

Restored `src/link-wiring.ts`, cmp equal.

The edit:

```diff
--- a/web/src/link-wiring.ts
+++ b/web/src/link-wiring.ts
@@ -114,7 +114,7 @@
    */
   const detachedPanes = (): DetachedPanes =>
     perLeg((leg) => {
-      const views = panes.of(leg).filter((p) => arranged(p.id))
+      const views = panes.of(leg)
       return {
         views: views.length,
         copies: views.filter((p) => sessions.entryOf(p.slot.binding.session).detached).map((p) => viewTitle(p.id)),
```

**S3l** (A3) `src/draw.ts`, `watched`: `}): boolean => arranged(e.id) && onProgram(e)` becomes
`}): boolean => onProgram(e)`. `sab.sh S3l browser:tests/browser/parked-view-surfaces.test.ts`: 1 failed, 2 passed, of 3.

```
 FAIL  |browser (chromium)| tests/browser/parked-view-surfaces.test.ts > the surfaces the views share, with the λ view parked > takes the λ leg’s running focus off the source editor while the λ view is parked
AssertionError: the source editor carries the running focus of a term no view shows: expected 'exact:let x = 40;' to be '' // Object.is equality
```

Restored `src/draw.ts`, cmp equal.

The edit:

```diff
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -169,7 +169,7 @@
     const watched = (e: {
       readonly id: LeafId
       readonly slot: { readonly binding: { readonly session: SessionId } }
-    }): boolean => arranged(e.id) && onProgram(e)
+    }): boolean => onProgram(e)
     const lam = panes.active('lambda', watched)?.slot.resolve(sessions)
     const tm = panes.active('tm', watched)?.slot.resolve(sessions)
     // THE TM LEG'S OWN RUNNING FOCUS — `TmState.source_node`, NOT `lam.hist.current?.owner` below.
```

**S3m** (B) `src/pane-host.ts`, `applyLayout`: the five-line loop that mounts an editor on a kept view
(`for (const l of leaves(getTree())) { const kept = panes.get(l.id) … mountScratchEditor(…) }`) deleted, the
`arranged = new Set(live.keys())` after it kept.
`sab.sh S3m browser:tests/browser/parked-copy-editor-mount.test.ts`: 1 failed of 1.

```
 FAIL  |browser (chromium)| tests/browser/parked-copy-editor-mount.test.ts > a parked view of a TM copy whose other view, holding the editor, was closed > has an editor when it comes back
AssertionError: the view came back showing a copy with no editor: expected +0 to be 1 // Object.is equality
```

Restored `src/pane-host.ts`, cmp equal.

The edit:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1322,11 +1322,6 @@
     // came back showing the copy with no editor on the page and nothing offering one. `mountScratchEditor` builds none
     // while one is mounted or held anywhere, so a view that kept its own editor, and a view whose copy's editor
     // another view holds, are left as they are.
-    for (const l of leaves(getTree())) {
-      const kept = panes.get(l.id)
-      if (kept === undefined || arranged.has(l.id) || kept.slot.binding.session === SOURCE_SESSION) continue
-      mountScratchEditor(l.id, kept.pane as unknown as EditablePane, kept.slot.binding.session)
-    }
     arranged = new Set(live.keys())
 
     for (const l of leaves(getTree())) {
```

**S3n** (C1) `src/pane-host.ts`, `admit`: `if (liveLeaves().size >= MAX_TREE_LEAVES) why = 'full'` deleted and the
`else if (stage())` after it made `if (stage())`.
`sab.sh S3n browser:tests/browser/live-views-bound.test.ts`: 1 failed of 1.

```
 FAIL  |browser (chromium)| tests/browser/live-views-bound.test.ts > + view, with four views on screen and 60 more remembered > is refused in the full workspace’s words, and changes nothing
AssertionError: the add was not refused as a full workspace is: expected 'view added — λ · program' to be 'the workspace holds 64 views, the mos…' // Object.is equality
AssertionError: the refused add changed the views on the page: expected [ 'source', 'lambda-0', …(3) ] to deeply equal [ 'source', 'lambda-0', 'asm-0', …(1) ]
AssertionError: the refused add stored another workspace: expected false to be true // Object.is equality
```

Restored `src/pane-host.ts`, cmp equal.

The edit:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -642,8 +642,7 @@
     let why: AddRefusal | null
     // **THE BOUND IS ON EVERY LIVE VIEW** (the view layouts spec §5.6): a view a remembered arrangement holds is kept
     // alive off the page, and a stored workspace is refused past the bound on all of them together.
-    if (liveLeaves().size >= MAX_TREE_LEAVES) why = 'full'
-    else if (stage()) why = holdsMostLeaves(getTree()) ? 'full' : null
+    if (stage()) why = holdsMostLeaves(getTree()) ? 'full' : null
     else {
       const area = root.getBoundingClientRect()
       const divides = gesture === 'column' ? 'height' : 'width'
```

**S3o** (C2) `src/main.ts`, `switchTo`: the four-line refusal
(`if (liveLeaves(entered.tree, entered.arrangements).size > MAX_TREE_LEAVES) { refused(…); return }`) deleted.
`sab.sh S3o browser:tests/browser/live-views-bound-switch.test.ts`: 1 failed of 1.

```
 FAIL  |browser (chromium)| tests/browser/live-views-bound-switch.test.ts > the source toggle, with 64 λ views on screen and no source view > is refused in the full workspace’s words, and changes nothing
AssertionError: the switch was not refused as a full workspace is: expected '' to be 'the workspace holds 64 views, the mos…' // Object.is equality
AssertionError: the refused switch moved the toggles: expected [ 'source', 'lambda' ] to deeply equal [ 'lambda' ]
AssertionError: the refused switch changed the views on the page: expected [ 'source', 'lambda-0' ] to deeply equal [ 'pane-1', 'pane-2', 'pane-3', …(61) ]
AssertionError: the refused switch stored another workspace: expected false to be true // Object.is equality
```

Restored `src/main.ts`, cmp equal.

S3j to S3o give the assertion lines the earlier agent's `final-sabotage-{A1,A2,A3,B,C1,C2}.log` give, word for word.

The edit:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1644,10 +1644,6 @@
     if (target.length === 0 || key === keyOf(combinationOf(tree))) return
     const next = ws.arrangements[key] ?? defaultArrangement(target, viewsShape())
     const entered = enter({ tree, arrangements: ws.arrangements }, next)
-    if (liveLeaves(entered.tree, entered.arrangements).size > MAX_TREE_LEAVES) {
-      refused({ leaf: focusedLeaf(), gesture: 'view', why: 'full' })
-      return
-    }
     enterTree(next, true)
     paneHost.switchViews(focusedLeaf())
     notices.announce(shownSentence(combinationOf(tree)))
```

- [ ] **Step 6: The whole suite**

`pnpm exec biome ci --error-on-warnings`, `pnpm exec tsc --noEmit -p .`, `pnpm exec vitest run --project node` and
`pnpm exec vitest run --project browser`, all from `web/`. On the replay, after this task:

| Check | Result |
|---|---|
| `biome ci --error-on-warnings` | exit 0, checked 371 files, 1 info |
| `tsc --noEmit -p .` | exit 0 |
| node | 68 files, 1300 tests, all passed |
| browser | 175 files, 1210 tests, all passed |

`suite.sh t3-suite-first`, run before the sabotages, gave the same counts.

- [ ] **Step 7: Commit**

```bash
git add web/index.html \
  web/src/app-header.ts \
  web/src/arrangements.ts \
  web/src/draw.ts \
  web/src/layout.ts \
  web/src/link-wiring.ts \
  web/src/main.ts \
  web/src/pane-host.ts \
  web/src/style.css \
  web/src/workspace.ts \
  web/tests/browser/controls-gate.test.ts \
  web/tests/browser/harness.ts \
  web/tests/browser/live-views-bound-switch.test.ts \
  web/tests/browser/live-views-bound.test.ts \
  web/tests/browser/parked-copy-editor-mount.test.ts \
  web/tests/browser/parked-copy-editor.test.ts \
  web/tests/browser/parked-view-surfaces.test.ts \
  web/tests/browser/scratch-fork.test.ts \
  web/tests/browser/view-toggles.test.ts \
  web/tests/node/arrangements.test.ts \
  web/tests/node/layout.test.ts \
  web/tests/node/share-link.test.ts \
  web/tests/node/workspace.test.ts
git commit -F - <<'EOF'
Each combination of views remembers its own arrangement, and four toggles in the header choose which views show: a switch parks the views it takes off the screen, alive and with what they had open, a ✕ still closes one, a link carries the arrangement on screen alone, and the bound of 64 views is on every live one
EOF
```

### Task 4: A fresh page opens on the source beside the TM view

`defaultLayout()` becomes the default arrangement of the source and TM (spec §8), `defaultWorkspace` and the reset
take the views area's shape, and the tests move onto fixtures that say which tree they want. `setup.ts` stores a
four-view workspace for every file, as it stores the old start-up program, so the 80 files written against four views
keep starting on them; the files that reset between cases call `resetToFourViews()`. What is rewritten, and not merely
moved, is every assertion about the default itself.

**The seed is what holds the suite.** With its line commented out, 60 of the browser project's files fail (sabotage
S4d). That is also why a file kept green by it says nothing about the page a visitor gets: `first-load-views.test.ts`,
`first-load-views-tall.test.ts` and `first-load.test.ts` remove the stored workspace before they mount.

**Files:**
- Modify: `web/src/editor-custody.ts`
- Modify: `web/src/layout.ts`
- Modify: `web/src/main.ts`
- Modify: `web/src/pane-host.ts`
- Modify: `web/src/workspace.ts`
- Modify: `web/tests/browser/active-pane.test.ts`
- Modify: `web/tests/browser/add-view-floor.test.ts`
- Modify: `web/tests/browser/app-header.test.ts`
- Modify: `web/tests/browser/asm-copy-restore.test.ts`
- Modify: `web/tests/browser/buffer-restore-invalid.test.ts`
- Modify: `web/tests/browser/buffer-restore.test.ts`
- Modify: `web/tests/browser/divider-drag.test.ts`
- Create: `web/tests/browser/first-load-views-tall.test.ts`
- Create: `web/tests/browser/first-load-views.test.ts`
- Modify: `web/tests/browser/first-load.test.ts`
- Modify: `web/tests/browser/harness.ts`
- Modify: `web/tests/browser/lambda-display-restore.test.ts`
- Modify: `web/tests/browser/layout-restore.test.ts`
- Modify: `web/tests/browser/menu-focus.test.ts`
- Modify: `web/tests/browser/pane-kind-switch.test.ts`
- Modify: `web/tests/browser/pane-picker.test.ts`
- Modify: `web/tests/browser/program-blocked.test.ts`
- Modify: `web/tests/browser/readout-history-held.test.ts`
- Modify: `web/tests/browser/reset-preset-copies.test.ts`
- Modify: `web/tests/browser/scratch-buffers.test.ts`
- Modify: `web/tests/browser/setup.ts`
- Modify: `web/tests/browser/share-open-cap.test.ts`
- Modify: `web/tests/browser/share-open-editor.test.ts`
- Modify: `web/tests/browser/share-open-hashchange.test.ts`
- Modify: `web/tests/browser/share-open-start-clamp.test.ts`
- Modify: `web/tests/browser/share-open.test.ts`
- Modify: `web/tests/browser/share-positions.test.ts`
- Modify: `web/tests/browser/share-through-open.test.ts`
- Modify: `web/tests/browser/storage-blocked.test.ts`
- Modify: `web/tests/browser/tm-buffer-restore.test.ts`
- Modify: `web/tests/browser/tm-display-restore.test.ts`
- Modify: `web/tests/browser/tm-view-narrow.test.ts`
- Modify: `web/tests/browser/two-lambda-panes.test.ts`
- Modify: `web/tests/browser/view-toggles.test.ts`
- Modify: `web/tests/browser/workspace-bound.test.ts`
- Modify: `web/tests/browser/workspace-restore.test.ts`
- Modify: `web/tests/node/layout.test.ts`
- Modify: `web/tests/node/workspace.test.ts`

**Interfaces:**
- Consumes: Task 3's `defaultArrangement`, `viewsShape`, the toggles (the fixture presses them), and its fixtures.
- Produces, in `web/src/layout.ts`: `defaultLayout(shape: Shape = 'wide'): LayoutNode`.
- Produces, in `web/src/workspace.ts`: `defaultWorkspace(shape: Shape = 'wide'): Workspace`.
- Produces, in `web/tests/browser/harness.ts`: `resetToFourViews(): Promise<void>`, `showFourViews(): Promise<void>`.
  Both are async: they press the toggles in a window taller than it is wide, where all four views' default is two
  rows of two, and put the window back.

- [ ] **Step 1: Write the tests**

In `web/tests/browser/active-pane.test.ts`:

```diff
--- a/web/tests/browser/active-pane.test.ts
+++ b/web/tests/browser/active-pane.test.ts
@@ -3,7 +3,7 @@ import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
 import { page, userEvent } from 'vitest/browser'
 import { LAYOUT_STORAGE_KEY } from '../../src/layout'
 import { bindingKey } from '../../src/view-header'
-import { SHELL, until } from './harness'
+import { resetToFourViews, SHELL, until } from './harness'
 
 /**
  * **THE SHARED SURFACES AND THE λ LEG'S TWO VIEWS** — what the ONE status line and the ONE source editor decoration
@@ -152,7 +152,7 @@ beforeAll(async () => {
 
 beforeEach(async () => {
   localStorage.removeItem(LAYOUT_STORAGE_KEY)
-  document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
+  await resetToFourViews()
   view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
   await until(
     () =>
```

In `web/tests/browser/add-view-floor.test.ts`:

```diff
--- a/web/tests/browser/add-view-floor.test.ts
+++ b/web/tests/browser/add-view-floor.test.ts
@@ -2,8 +2,8 @@ import { beforeAll, describe, expect, it } from 'vitest'
 import { page, userEvent } from 'vitest/browser'
 import { LAYOUT_STORAGE_KEY, type LayoutNode, MIN_VIEW_PX } from '../../src/layout'
 import { DIVIDER_PX } from '../../src/layout-view'
-import { defaultWorkspace, parseWorkspace, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { parseWorkspace, serializeWorkspace } from '../../src/workspace'
+import { fourViewWorkspace, SHELL, showFourViews, until } from './harness'
 
 /**
  * **`+ VIEW` TAKES AN EQUAL SHARE OF THE FOCUSED VIEW'S ROW, AND NO ADD MAKES A VIEW NARROWER THAN 160 PX** — the
@@ -122,6 +122,8 @@ async function resetPreset(p: 'explorer' | 'stage' = 'explorer'): Promise<void>
   await openWorkspace()
   await userEvent.click(document.querySelector('#reset-preset') as HTMLElement)
   await until(() => noticeText().endsWith('reset — the default views are back'), 'the reset')
+  // ALL FOUR VIEWS, WHICH THE RESET GAVE WHEN THESE CASES WERE WRITTEN: it leaves the source beside the TM view now.
+  await showFourViews()
   expect(tabs().length > 0 ? tabs() : ids()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
   expect(focused()).toBe('lambda-0')
 }
@@ -175,7 +177,7 @@ beforeAll(async () => {
   await page.viewport(1280, 800)
   localStorage.setItem(
     LAYOUT_STORAGE_KEY,
-    serializeWorkspace({ ...defaultWorkspace(), tree: SIXTY_FOUR, focused: 'lambda-0' }),
+    serializeWorkspace({ ...fourViewWorkspace(), tree: SIXTY_FOUR, focused: 'lambda-0' }),
   )
   document.body.innerHTML = SHELL
   await (await import('../../src/main')).ready
```

In `web/tests/browser/app-header.test.ts`:

```diff
--- a/web/tests/browser/app-header.test.ts
+++ b/web/tests/browser/app-header.test.ts
@@ -4,7 +4,7 @@ import { beforeAll, describe, expect, it } from 'vitest'
 import { page } from 'vitest/browser'
 import { LAYOUT_STORAGE_KEY } from '../../src/layout'
 import { parseWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { SHELL, showFourViews, until } from './harness'
 
 const leafIds = () => [...document.querySelectorAll<HTMLElement>('main [data-leaf]')].map((el) => el.dataset.leaf ?? '')
 
@@ -46,9 +46,11 @@ describe('the app header', () => {
   })
 
   it('resets the preset: the default views back, and says so', async () => {
+    // THE PRECONDITION, SINCE THE DEFAULT IS A SUBSET OF WHAT IS HERE: more views than the default's two.
+    expect(leafIds().length).toBeGreaterThan(2)
     document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
-    await until(() => leafIds().length === 4, 'the default views')
-    expect(leafIds()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
+    await until(() => leafIds().length === 2, 'the default views')
+    expect(leafIds()).toEqual(['source', 'tm-0'])
     expect(document.querySelector('#notice .notice-text')?.textContent).toBe(
       'Explorer reset — the default views are back',
     )
@@ -61,7 +63,10 @@ describe('the app header', () => {
     // workspace menu moves them, `workspace-switches.test.ts` drives that, and a *reset preset* that
     // dropped the assignment would leave this button reading whatever the last pick made it.
     expect(document.querySelector('#workspace')?.textContent?.trim()).toBe('Explorer ▾')
-    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.focused).toBe('lambda-0')
+    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.focused).toBe('tm-0')
+    // THE FOUR VIEWS THE CASES BELOW WERE WRITTEN AGAINST, which this reset gave until the view layouts.
+    await showFourViews()
+    await until(() => leafIds().length === 4, 'all four views')
   })
 
   it('offers source to + view only while no view shows it', async () => {
```

In `web/tests/browser/asm-copy-restore.test.ts`:

```diff
--- a/web/tests/browser/asm-copy-restore.test.ts
+++ b/web/tests/browser/asm-copy-restore.test.ts
@@ -1,7 +1,7 @@
 import { EditorView } from '@codemirror/view'
 import { describe, expect, it } from 'vitest'
 import { BUFFERS_STORAGE_KEY, BUFFERS_VERSION, parseBuffers, serializeBuffers } from '../../src/buffers-store'
-import { SHELL, until } from './harness'
+import { SHELL, storeFourViews, until } from './harness'
 
 /**
  * An asm copy survives a reload (Plan 7 part 5 spec §7, amendment 23): stored at `BUFFERS_VERSION` 2 with its leg,
@@ -30,6 +30,8 @@ const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.stat
 describe('restoring an asm copy', () => {
   it('stores it on its leg at version 2, and brings it back in its view with its text', async () => {
     localStorage.clear()
+    // ALL FOUR VIEWS, WHICH AN EMPTY STORE OPENED ON WHEN THIS WAS WRITTEN: it opens on the source and TM now.
+    storeFourViews()
     const view = await mount()
     view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
     await until(() => !idle(), 'the compile to start')
@@ -61,6 +63,8 @@ describe('restoring an asm copy', () => {
    */
   it('brings back a copy that does not build in its editor, with the label that names nothing marked', async () => {
     localStorage.clear()
+    // ALL FOUR VIEWS, WHICH AN EMPTY STORE OPENED ON WHEN THIS WAS WRITTEN: it opens on the source and TM now.
+    storeFourViews()
     const text = 'result Nat\n\n    jmp\tnowhere\n'
     localStorage.setItem(
       BUFFERS_STORAGE_KEY,
```

In `web/tests/browser/buffer-restore-invalid.test.ts`:

```diff
--- a/web/tests/browser/buffer-restore-invalid.test.ts
+++ b/web/tests/browser/buffer-restore-invalid.test.ts
@@ -1,7 +1,7 @@
 import { beforeAll, describe, expect, it } from 'vitest'
 import { BUFFERS_STORAGE_KEY, BUFFERS_VERSION, parseBuffers } from '../../src/buffers-store'
-import { defaultLayout, LAYOUT_STORAGE_KEY, serializeLayout } from '../../src/layout'
-import { SHELL } from './harness'
+import { LAYOUT_STORAGE_KEY, serializeLayout } from '../../src/layout'
+import { fourViews, SHELL } from './harness'
 
 /**
  * **A CORRUPT `redextape.buffers` DEGRADES TO A FRESH PAGE** — design §4.1's whole argument for
@@ -28,7 +28,7 @@ import { SHELL } from './harness'
  */
 
 beforeAll(async () => {
-  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(defaultLayout()))
+  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(fourViews()))
   localStorage.setItem(BUFFERS_STORAGE_KEY, `{"version":${BUFFERS_VERSION},"minted":"lots"}`)
   document.body.innerHTML = SHELL
   await (await import('../../src/main')).ready
```

In `web/tests/browser/buffer-restore.test.ts`:

```diff
--- a/web/tests/browser/buffer-restore.test.ts
+++ b/web/tests/browser/buffer-restore.test.ts
@@ -1,9 +1,9 @@
 import { EditorView } from '@codemirror/view'
 import { beforeAll, describe, expect, it } from 'vitest'
 import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/buffers-store'
-import { defaultLayout, LAYOUT_STORAGE_KEY, serializeLayout } from '../../src/layout'
+import { LAYOUT_STORAGE_KEY, serializeLayout } from '../../src/layout'
 import { bindingKey } from '../../src/view-header'
-import { SHELL, until } from './harness'
+import { fourViews, SHELL, until } from './harness'
 
 /**
  * **BUFFERS SURVIVING A RELOAD, THROUGH `main()`** — design §4.9, and the only exercise of that path.
@@ -39,7 +39,7 @@ import { SHELL, until } from './harness'
  * something about the app rather than about this file's spelling of an envelope.
  *
  * **THE THIRD BINDING IS A BINDING THE TREE MUST REFUSE, AND IT IS HERE BECAUSE IT KILLED THE PAGE.**
- * `tm-0` is a TM leaf in `defaultLayout()`, and a scratch buffer has exactly one leg — `lambda`. Seeded
+ * `tm-0` is a TM leaf in `fourViews()`, and a scratch buffer has exactly one leg — `lambda`. Seeded
  * without `main.ts`'s leaf-kind guard, `applyLayout` built a `PaneSlot('tm', 'scratch-1')` and the first
  * `draw()` threw `session scratch-1 has no tm leg` out of `main()` itself: every test in this file
  * reported as a SKIP under one failed suite, which is what a whole page dying looks like from here.
@@ -89,7 +89,7 @@ function pickBinding(leaf: string, key: string): void {
 }
 
 beforeAll(async () => {
-  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(defaultLayout()))
+  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(fourViews()))
   localStorage.setItem(BUFFERS_STORAGE_KEY, SEEDED)
   document.body.innerHTML = SHELL
   await (await import('../../src/main')).ready
```

In `web/tests/browser/divider-drag.test.ts`:

```diff
--- a/web/tests/browser/divider-drag.test.ts
+++ b/web/tests/browser/divider-drag.test.ts
@@ -3,7 +3,7 @@ import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
 import { LAYOUT_STORAGE_KEY } from '../../src/layout'
 import { KEY_STEP } from '../../src/layout-view'
 import { parseWorkspace } from '../../src/workspace'
-import { SHELL } from './harness'
+import { SHELL, storeFourViews } from './harness'
 
 /**
  * A DIVIDER DRAG, THROUGH `main()` — the test 5d-ii-a said did not exist, and the reason a broken drag
@@ -37,6 +37,8 @@ async function freshMain(): Promise<{ ready: Promise<EditorView> }> {
 
 async function mountApp(): Promise<void> {
   localStorage.clear()
+  // ALL FOUR VIEWS, WHICH AN EMPTY STORE OPENED ON WHEN THIS WAS WRITTEN: it opens on the source and TM now.
+  storeFourViews()
   document.body.innerHTML = SHELL
   await (await freshMain()).ready
 }
```

Create `web/tests/browser/first-load-views-tall.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { SHELL, until } from './harness'

/**
 * A FIRST VISIT IN A WINDOW TALLER THAN IT IS WIDE — the view layouts spec §4.4: the source above the TM view, where
 * a wide window has them side by side (`first-load-views.test.ts`). Its own file because `main()` measures the views
 * area once, as it builds the first workspace, and a file mounts the app once.
 */

localStorage.removeItem(LAYOUT_STORAGE_KEY)

const box = (leaf: string): DOMRect =>
  (document.querySelector(`#views [data-leaf="${leaf}"]`) as HTMLElement).getBoundingClientRect()

describe('a first load, in a window taller than it is wide', () => {
  beforeAll(async () => {
    await page.viewport(414, 896)
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  it('measured a views area taller than it is wide: the precondition', () => {
    const area = (document.querySelector('#views') as HTMLElement).getBoundingClientRect()
    expect(area.height).toBeGreaterThan(area.width)
  })

  it('puts the source above the TM view, each the full width', () => {
    const source = box('source')
    const tm = box('tm-0')
    expect(Math.abs(source.left - tm.left), 'the two views do not share a left edge').toBeLessThan(1)
    expect(source.bottom, 'the TM view does not start where the source view ends').toBeLessThanOrEqual(tm.top)
    expect(Math.abs(source.width - tm.width)).toBeLessThan(1)
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null').tree.dir).toBe('column')
  })
})
```

Create `web/tests/browser/first-load-views.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { SHELL, until } from './harness'

/**
 * WHAT A FIRST VISIT SHOWS — the view layouts spec §8: the source beside the TM view, the focus on the TM view, and
 * the two `views` toggles pressed.
 *
 * `setup.ts` stores a four-view workspace for every file, as a returning visitor's would be, so that the files written
 * against four views keep starting on them. That makes this file the only one that mounts the page a visitor gets,
 * and it removes the stored workspace before its mount for that reason.
 */

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const box = (leaf: string): DOMRect =>
  (document.querySelector(`#views [data-leaf="${leaf}"]`) as HTMLElement).getBoundingClientRect()
const pressed = (): string[] =>
  [...document.querySelectorAll<HTMLButtonElement>('#views-shown button[aria-pressed="true"]')].map(
    (b) => b.dataset.shows as string,
  )
const stored = (): Record<string, unknown> => JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null')

describe('a first load, in a window wider than it is tall', () => {
  beforeAll(async () => {
    // WIDER THAN TALL, SO THE PAIR IS A ROW: at the runner's default 414 × 896 the views area is taller than it is
    // wide and the same first load is a column (`first-load-views-tall.test.ts`).
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  it('starts from nothing stored: the precondition every case below rests on', () => {
    // WRITTEN BY THE MOUNT, NOT FOUND BY IT: the app stores the workspace it opened on.
    expect(stored().tree, 'the stored tree is not the first-load tree').toEqual({
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'source', pane: 'source' },
        { kind: 'leaf', id: 'tm-0', pane: 'tm' },
      ],
    })
  })

  it('shows the source and the TM view and no other', () => {
    expect(mounted()).toEqual(['source', 'tm-0'])
    expect(document.querySelector('[data-leaf="lambda-0"]'), 'a λ view is on the page').toBeNull()
    expect(document.querySelector('[data-leaf="asm-0"]'), 'an asm view is on the page').toBeNull()
  })

  it('puts them side by side, a half each', () => {
    const source = box('source')
    const tm = box('tm-0')
    expect(source.width, 'the source view has no width').toBeGreaterThan(160)
    expect(Math.abs(source.top - tm.top), 'the two views do not share a top edge').toBeLessThan(1)
    expect(source.right, 'the TM view does not start where the source view ends').toBeLessThanOrEqual(tm.left)
    expect(Math.abs(source.width - tm.width), 'the two views are not a half each').toBeLessThan(1)
    expect(Math.abs(source.height - tm.height)).toBeLessThan(1)
  })

  it('presses the source and TM toggles and leaves λ and asm unpressed', () => {
    expect(pressed()).toEqual(['source', 'tm'])
    const all = [...document.querySelectorAll<HTMLButtonElement>('#views-shown button')]
    expect(all.map((b) => b.textContent)).toEqual(['source', 'asm', 'λ', 'TM'])
    expect(all.map((b) => b.title)).toEqual([
      'hide the source view',
      'show the asm view',
      'show the λ view',
      'hide the TM view',
    ])
    expect(all.every((b) => !b.disabled)).toBe(true)
  })

  it('focuses the TM view, and remembers no other arrangement', () => {
    expect(stored().focused).toBe('tm-0')
    expect('arrangements' in stored(), 'a fresh page stored an arrangements field').toBe(false)
  })
})
```

In `web/tests/browser/first-load.test.ts`:

```diff
--- a/web/tests/browser/first-load.test.ts
+++ b/web/tests/browser/first-load.test.ts
@@ -10,9 +10,13 @@ import { SHELL, until } from './harness'
  * row 3, where every load before opened on `let x = 40; x + 2`. `setup.ts` stores that program for every file, so this
  * one removes it at module scope, before `main()` runs: nothing stored is what a first visit has. ONE MOUNT FOR THE
  * FILE, for the reason every sibling gives.
+ *
+ * **AND ON THE SOURCE AND THE TM VIEW** (the view layouts spec §8). `setup.ts` stores a four-view workspace for every
+ * file too, so that goes with the program; `first-load-views.test.ts` has what the two views look like.
  */
 
 localStorage.removeItem(PROGRAM_STORAGE_KEY)
+localStorage.removeItem(LAYOUT_STORAGE_KEY)
 
 const segments = () => [...document.querySelectorAll('#results .segment')].map((s) => s.textContent ?? '')
 const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
@@ -33,8 +37,6 @@ describe('a first visit', () => {
     expect(document.querySelector('#workspace')?.textContent?.trim()).toBe('Explorer ▾')
     expect([...document.querySelectorAll<HTMLElement>('main [data-leaf]')].map((el) => el.dataset.leaf)).toEqual([
       'source',
-      'lambda-0',
-      'asm-0',
       'tm-0',
     ])
   })
```

In `web/tests/browser/harness.ts`:

```diff
--- a/web/tests/browser/harness.ts
+++ b/web/tests/browser/harness.ts
@@ -344,3 +344,52 @@ export const fourViewWorkspace = (): Workspace => ({ ...defaultWorkspace(), tree
 export const storeFourViews = (): void => {
   localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(fourViewWorkspace()))
 }
+
+/**
+ * Put a mounted page back on all four views, each on the program, as `fourViews()` arranges them: *reset preset*,
+ * which leaves the source beside the TM view and forgets every other arrangement, then `showFourViews`.
+ *
+ * **A FIXTURE, NOT A GESTURE UNDER TEST**: files that reset between cases did it with *reset preset* alone while that
+ * restored four views. `.click()` and no `userEvent`, as those files' own reset was.
+ */
+export async function resetToFourViews(): Promise<void> {
+  document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
+  await showFourViews()
+}
+
+/**
+ * `resetToFourViews`' second half, for a file that performs the reset itself: the λ and the asm toggle pressed where
+ * they are not, and the focus in the λ view.
+ *
+ * **THE TOGGLES ARE PRESSED IN A WINDOW TALLER THAN IT IS WIDE, WHICH IS THEN PUT BACK.** A combination's first visit
+ * shows its default, and the default of all four in a wide window is two COLUMNS of two (`layout.ts`'s
+ * `defaultArrangement`, the user's decision of 2026-10-11); in a tall one it is two rows of two, which is
+ * `fourViews()`, the tree these files measure. The arrangement is remembered once it is on screen, so the window's
+ * size afterwards does not change it. The toggles are hidden in a window this narrow and `.click()` reaches them
+ * all the same.
+ *
+ * **THE FOCUS ENDS IN THE λ VIEW**, on its first control, where *reset preset* put it while λ was the first view of
+ * the default: several files' cases start from "the λ view is the focused view", and `+ view` adds beside it.
+ */
+export async function showFourViews(): Promise<void> {
+  const { page } = await import('vitest/browser')
+  const [width, height] = [window.innerWidth, window.innerHeight]
+  // 320 × 1400, NOT THE RUNNER'S 414 × 896: with the inspector stacked under the views, as Debugger and Stage have
+  // it in a narrow window, the views area there is about as wide as it is tall, and the default built was a wide one.
+  await page.viewport(320, 1400)
+  const area = (document.querySelector('#views') as HTMLElement).getBoundingClientRect()
+  if (area.height <= area.width)
+    throw new Error(`the views area is not taller than wide: ${area.width} × ${area.height}`)
+  for (const kind of ['lambda', 'asm'])
+    document
+      .querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"][aria-pressed="false"]`)
+      ?.click()
+  await page.viewport(width, height)
+  // IN STAGE THE λ VIEW IS A TAB UNTIL IT IS SELECTED, and only a view on the page can take the focus.
+  document.querySelector<HTMLElement>('#views [role="tab"][data-leaf="lambda-0"]')?.click()
+  document
+    .querySelector<HTMLElement>(
+      '#views [data-leaf="lambda-0"] button:not([disabled]):not([hidden]), #views [data-leaf="lambda-0"] select, #views [data-leaf="lambda-0"] [tabindex]',
+    )
+    ?.focus()
+}
```

In `web/tests/browser/lambda-display-restore.test.ts`:

```diff
--- a/web/tests/browser/lambda-display-restore.test.ts
+++ b/web/tests/browser/lambda-display-restore.test.ts
@@ -1,7 +1,7 @@
 import { beforeAll, describe, expect, it } from 'vitest'
 import { LAYOUT_STORAGE_KEY } from '../../src/layout'
-import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { serializeWorkspace } from '../../src/workspace'
+import { fourViewWorkspace, resetToFourViews, SHELL, until } from './harness'
 
 /**
  * **A λ VIEW IS BUILT WITH THE DISPLAY ITS WORKSPACE STORED** (Plan 7 part 4a, spec §5.1). Seeded before
@@ -19,7 +19,7 @@ beforeAll(async () => {
   localStorage.setItem(
     LAYOUT_STORAGE_KEY,
     serializeWorkspace({
-      ...defaultWorkspace(),
+      ...fourViewWorkspace(),
       display: { 'lambda-0': STORED },
       // ITS TERM MAP LEFT OPEN: a λ view's panel state comes back as a TM view's does.
       panels: { 'lambda-0': { map: true } },
@@ -68,15 +68,15 @@ describe('a λ view restored from a stored workspace', () => {
 
   /**
    * **A LEAF ID COMES BACK, AND ITS OLD DISPLAY MUST NOT COME WITH IT** — `workspace-restore.test.ts`'s rule
-   * for panel state, held for the display. `defaultLayout()` re-mints `lambda-0`, so *reset preset* after
-   * closing the λ view hands its id to a new view. The write already dropped the closed view's display; the
+   * for panel state, held for the display. A default arrangement re-mints `lambda-0`, so *reset preset* and the λ
+   * toggle after closing the λ view hand its id to a new view. The write already dropped the closed view's display; the
    * workspace in memory has to drop it too, or the new view is built from it and a reload would draw it
    * differently from the same clicks.
    */
   it('does not give a re-minted view the display of the one that closed', async () => {
     document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-close')?.click()
     await until(() => document.querySelector('[data-leaf="lambda-0"]') === null, 'the λ view to close')
-    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
+    await resetToFourViews()
     await until(() => rows() > 0 && term()?.dataset.stale === undefined, 'the re-minted view’s tree')
     expect(term()?.dataset.layout).toBe('code')
     expect(checked('code')).toBe('true')
```

In `web/tests/browser/layout-restore.test.ts`:

```diff
--- a/web/tests/browser/layout-restore.test.ts
+++ b/web/tests/browser/layout-restore.test.ts
@@ -33,7 +33,7 @@ import { SHELL } from './harness'
  * The tree `defaultLayout()` returned before the asm view joined it (Plan 7 part 5 spec §3, row 4): source and
  * λ side by side above TM.
  *
- * **SPELLED OUT RATHER THAN TAKEN FROM `defaultLayout()`, BECAUSE THE ENTRY IT STANDS IN FOR IS OLDER THAN THE
+ * **SPELLED OUT RATHER THAN TAKEN FROM A DEFAULT, BECAUSE THE ENTRY IT STANDS IN FOR IS OLDER THAN THE
  * ASM VIEW.** `STORED` below is a version 1 layout, which only a build from before the version 2 workspace could
  * have written, and no such build had an asm leaf to write. Built from today's default, the fixture would be a
  * stored tree no real page ever held. Spelled this way it also carries the spec's own claim about stored
```

In `web/tests/browser/menu-focus.test.ts`:

```diff
--- a/web/tests/browser/menu-focus.test.ts
+++ b/web/tests/browser/menu-focus.test.ts
@@ -1,7 +1,7 @@
 import type { EditorView } from '@codemirror/view'
 import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
 import { page } from 'vitest/browser'
-import { SHELL, until } from './harness'
+import { resetToFourViews, SHELL, until } from './harness'
 
 /**
  * **A MENU ITEM NEVER LEAVES THE FOCUS ON `<body>`** — spec §11's categorical rule, accessibility item 1,
@@ -89,7 +89,7 @@ beforeAll(async () => {
 
 // Back to the default four views before each gesture, since several of these change the tree.
 beforeEach(async () => {
-  document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
+  await resetToFourViews()
   view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
   await until(
     () =>
```

In `web/tests/browser/pane-kind-switch.test.ts`:

```diff
--- a/web/tests/browser/pane-kind-switch.test.ts
+++ b/web/tests/browser/pane-kind-switch.test.ts
@@ -4,7 +4,7 @@ import { page } from 'vitest/browser'
 import { LAYOUT_STORAGE_KEY, type LayoutNode, setLeafKind } from '../../src/layout'
 import { bindingKey } from '../../src/view-header'
 import { parseWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { resetToFourViews, SHELL, until } from './harness'
 
 /**
  * **A PANE CHANGES WHAT IT SHOWS, IN PLACE** — decision 1's headline capability, driven entirely
@@ -132,7 +132,7 @@ beforeAll(async () => {
 
 beforeEach(async () => {
   localStorage.removeItem(LAYOUT_STORAGE_KEY)
-  document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
+  await resetToFourViews()
   view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
   await until(
     () =>
```

In `web/tests/browser/pane-picker.test.ts`:

```diff
--- a/web/tests/browser/pane-picker.test.ts
+++ b/web/tests/browser/pane-picker.test.ts
@@ -3,7 +3,7 @@ import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
 import { page } from 'vitest/browser'
 import { LAYOUT_STORAGE_KEY } from '../../src/layout'
 import { bindingKey } from '../../src/view-header'
-import { SHELL, until } from './harness'
+import { resetToFourViews, SHELL, until } from './harness'
 
 /**
  * **THE PICKER, ACTING** — a split creates what it was asked to create, and the closed source pane has a
@@ -101,7 +101,7 @@ beforeAll(async () => {
 
 beforeEach(async () => {
   localStorage.removeItem(LAYOUT_STORAGE_KEY)
-  document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
+  await resetToFourViews()
   view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
   await until(
     () =>
```

In `web/tests/browser/program-blocked.test.ts`:

```diff
--- a/web/tests/browser/program-blocked.test.ts
+++ b/web/tests/browser/program-blocked.test.ts
@@ -1,7 +1,7 @@
 import type { EditorView } from '@codemirror/view'
 import { describe, expect, it } from 'vitest'
 import { PROGRAM_STORAGE_KEY } from '../../src/program-store'
-import { SHELL, until } from './harness'
+import { SHELL, showFourViews, until } from './harness'
 
 /**
  * **BLOCKED STORAGE IS NOT FULL STORAGE** — Plan 7 part 6a spec §4.3 and §7. Where this browser blocks site data,
@@ -63,6 +63,8 @@ describe('a program write refused because storage is blocked', () => {
       () => idle() && (document.querySelector('#results')?.textContent ?? '').includes('λ 2 · '),
       'the edited program to compile',
     )
+    // WITH NOTHING READABLE IN STORAGE THE PAGE OPENED ON THE SOURCE AND THE TM VIEW, so the λ view is asked for.
+    await showFourViews()
     document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
     await until(() => document.querySelector('[data-leaf="lambda-0"] .term-editor') !== null, 'the copy')
     // SAID AT ONCE, UNDER THE COPY'S OWN NOTICE: the live region is where the new sentence is heard.
```

In `web/tests/browser/readout-history-held.test.ts`:

```diff
--- a/web/tests/browser/readout-history-held.test.ts
+++ b/web/tests/browser/readout-history-held.test.ts
@@ -3,8 +3,8 @@ import { afterAll, beforeAll, describe, expect, it } from 'vitest'
 import { page, userEvent } from 'vitest/browser'
 import { EXAMPLES } from '../../src/examples'
 import { encodeLink } from '../../src/share-link'
-import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { serializeWorkspace } from '../../src/workspace'
+import { fourViewWorkspace, SHELL, until } from './harness'
 
 /**
  * **THE READOUT'S FULL HISTORY AT THE MOMENTS A POLL CANNOT PLACE, PLACED BY HOLDING A REPLY BACK.** The strip draws
@@ -220,7 +220,7 @@ describe('a link taking the asm leg past where its history fills, its continue h
     location.hash = await encodeLink({
       program: SUM_TO_10000,
       encoding: 'unary',
-      workspace: serializeWorkspace(defaultWorkspace()),
+      workspace: serializeWorkspace(fourViewWorkspace()),
       positions: { asm: 40_000 },
     })
     await until(() => location.hash === '' && noticeText() === 'opened a shared link', 'the open')
```

In `web/tests/browser/reset-preset-copies.test.ts`:

```diff
--- a/web/tests/browser/reset-preset-copies.test.ts
+++ b/web/tests/browser/reset-preset-copies.test.ts
@@ -7,11 +7,15 @@ import { SHELL, until } from './harness'
  * *RESET PRESET* RESTORES THE DEFAULT VIEWS, AND A DEFAULT VIEW SHOWS THE PROGRAM (Plan 7 part 2 spec §4, §6).
  *
  * The check by hand's finding 5: with views on copies of all three legs, *reset preset* said "Explorer reset — the
- * default views are back" while every view stayed on its copy. `defaultLayout()` re-mints `lambda-0`, `asm-0` and
+ * default views are back" while every view stayed on its copy. The default tree re-minted `lambda-0`, `asm-0` and
  * `tm-0`, and `applyLayout` kept a pane whose id and kind survived, binding and all. `pane-host.ts`'s `resetViews` now
  * rebuilds each such view on the program, as a fresh preset's are, and the copies stay: in the copies menu, and with
  * their editors when a view shows them again.
  *
+ * **THE DEFAULT IS THE SOURCE BESIDE THE TM VIEW NOW** (the view layouts spec §8), so the reset keeps one of the three
+ * views, `tm-0`, and that is the one a kept binding would show. The λ and asm views leave the page with the reset and
+ * every remembered arrangement is forgotten, so the views their toggles bring back are new ones.
+ *
  * Every gesture is a `userEvent` one. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
  */
 
@@ -61,6 +65,17 @@ describe('reset preset', () => {
     await userEvent.click(document.querySelector<HTMLButtonElement>('#reset-preset') as HTMLButtonElement)
 
     expect(notice()).toBe('Explorer reset — the default views are back')
+    expect([...document.querySelectorAll<HTMLElement>('.pane[data-leaf]')].map((el) => el.dataset.leaf)).toEqual([
+      'source',
+      'tm-0',
+    ])
+    expect(title('tm-0'), 'the view the reset kept is still on its copy').toBe('TM · program')
+    expect(document.querySelectorAll('.pane .view-status')).toHaveLength(0)
+    expect(status()).not.toContain('copy')
+
+    // AND THE TWO VIEWS THE RESET TOOK OFF THE PAGE COME BACK ON THE PROGRAM, as new views: nothing remembers them.
+    for (const kind of ['lambda', 'asm'])
+      await userEvent.click(document.querySelector(`#views-shown button[data-shows="${kind}"]`) as HTMLElement)
     expect(LEAVES.map(title)).toEqual(['λ · program', 'asm · program', 'TM · program'])
     expect(document.querySelectorAll('.pane .view-status')).toHaveLength(0)
     expect(status()).not.toContain('copy')
```

In `web/tests/browser/scratch-buffers.test.ts`:

```diff
--- a/web/tests/browser/scratch-buffers.test.ts
+++ b/web/tests/browser/scratch-buffers.test.ts
@@ -140,7 +140,7 @@ function typeIntoBufferEditor(text: string): void {
  *
  * TWO MEASURED INCIDENTS ARE WORTH KEEPING ON RECORD, BOTH FOUND THROUGH THIS FILE. First: the retire
  * test below closes `lambda-0`, so this was the first file in the tier to persist a layout tree with one
- * of `defaultLayout()`'s own leaves MISSING — it left `link-truncated.test.ts`'s `↺` lookup answering
+ * of `fourViews()`'s own leaves MISSING — it left `link-truncated.test.ts`'s `↺` lookup answering
  * `undefined` (a silent no-op `?.click()`), which then waited out its whole timeout for a step readout
  * nothing was ever going to change. Second: `redextape.buffers` survives a reload, so a page that forks —
  * this file does — leaves the next file's `main()` RESTORING those buffers; it broke
```

In `web/tests/browser/setup.ts`:

```diff
--- a/web/tests/browser/setup.ts
+++ b/web/tests/browser/setup.ts
@@ -17,7 +17,10 @@
  * and this is a test-harness gap, not an application one.
  */
 import '../../src/style.css'
+import { LAYOUT_STORAGE_KEY } from '../../src/layout'
 import { PROGRAM_STORAGE_KEY, serializeProgram } from '../../src/program-store'
+import { serializeWorkspace } from '../../src/workspace'
+import { fourViewWorkspace } from './harness'
 
 /**
  * Browser-tier setup, before the test file's own module body: collect the page the previous test file left
@@ -114,3 +117,19 @@ Object.defineProperty(window, 'localStorage', { value: shim, configurable: true
  * removes it or clears storage starts on the example under the default.
  */
 shim.setItem(PROGRAM_STORAGE_KEY, serializeProgram({ text: 'let x = 40; x + 2', encoding: 'unary' }))
+
+/**
+ * Browser-tier setup, part four: every file starts on all four views, the arrangement it was written against.
+ *
+ * **A FIRST VISIT OPENS ON THE SOURCE BESIDE THE TM VIEW NOW** (the view layouts spec §8), and every file's storage
+ * above starts empty, so every file that mounts the app would start on two views: 80 of these files name `lambda-0` or
+ * `asm-0`, which that page does not hold. The workspace a four-view page stored is stored here instead, as a returning
+ * visitor's would be: all four views in two rows, Explorer, the focus on the λ view, which is what a fresh page was
+ * until the view layouts. `first-load-views.test.ts` removes it before it mounts, and a file that clears storage
+ * before its mount starts on the two views too.
+ *
+ * **THIS IS PART THREE'S MOVE, AND IT HAS PART THREE'S COST**: a file kept green by a stored start says nothing about
+ * the start a visitor gets. The files that assert on the default itself — what *reset preset* restores, what a
+ * fresh workspace holds — were read and rewritten against the new default when this was added.
+ */
+shim.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(fourViewWorkspace()))
```

In `web/tests/browser/share-open-cap.test.ts`:

```diff
--- a/web/tests/browser/share-open-cap.test.ts
+++ b/web/tests/browser/share-open-cap.test.ts
@@ -1,12 +1,12 @@
 import { beforeAll, describe, expect, it } from 'vitest'
 import { userEvent } from 'vitest/browser'
 import { BUFFERS_STORAGE_KEY, serializeBuffers } from '../../src/buffers-store'
-import { defaultLayout, LAYOUT_STORAGE_KEY, type LayoutNode, setLeafKind, splitLeaf } from '../../src/layout'
+import { LAYOUT_STORAGE_KEY, type LayoutNode, setLeafKind, splitLeaf } from '../../src/layout'
 import { MAX_WARM_BUFFERS } from '../../src/scratch'
 import { encodeLink } from '../../src/share-link'
 import { bindingKey } from '../../src/view-header'
-import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { serializeWorkspace } from '../../src/workspace'
+import { fourViews, fourViewWorkspace, SHELL, until } from './harness'
 
 /**
  * **AN OPEN'S UNDO, PAST THE COPIES CAP** — Plan 7 part 6a spec §5.5: "a copy the cap refuses stays paused, and its
@@ -18,7 +18,7 @@ import { SHELL, until } from './harness'
 
 /** A tree of `n` λ views beside the source view, split in halves so none goes under the pane floor. */
 function lambdaViews(n: number): { tree: LayoutNode; leaves: string[] } {
-  let tree = setLeafKind(setLeafKind(defaultLayout(), 'asm-0', 'lambda'), 'tm-0', 'lambda')
+  let tree = setLeafKind(setLeafKind(fourViews(), 'asm-0', 'lambda'), 'tm-0', 'lambda')
   const leaves = ['lambda-0', 'asm-0', 'tm-0']
   for (let i = 0; leaves.length < n; i++) {
     const id = `pane-${i + 1}`
@@ -37,7 +37,7 @@ const shows = (leaf: string) =>
   document.querySelector<HTMLElement>(`[data-leaf="${leaf}"] .view-title`)?.dataset.binding ?? ''
 
 beforeAll(async () => {
-  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace({ ...defaultWorkspace(), tree, focused: 'lambda-0' }))
+  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace({ ...fourViewWorkspace(), tree, focused: 'lambda-0' }))
   localStorage.setItem(
     BUFFERS_STORAGE_KEY,
     serializeBuffers({
@@ -55,7 +55,7 @@ beforeAll(async () => {
   const fragment = await encodeLink({
     program: 'let x = 40; x + 2',
     encoding: 'unary',
-    workspace: serializeWorkspace(defaultWorkspace()),
+    workspace: serializeWorkspace(fourViewWorkspace()),
     positions: {},
   })
   history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
```

In `web/tests/browser/share-open-editor.test.ts`:

```diff
--- a/web/tests/browser/share-open-editor.test.ts
+++ b/web/tests/browser/share-open-editor.test.ts
@@ -4,8 +4,8 @@ import { userEvent } from 'vitest/browser'
 import { EXAMPLES } from '../../src/examples'
 import { encodeLink } from '../../src/share-link'
 import { bindingKey } from '../../src/view-header'
-import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { serializeWorkspace } from '../../src/workspace'
+import { fourViewWorkspace, SHELL, until } from './harness'
 
 /**
  * **A PASTED LINK'S UNDO, AND THE λ COPY'S EDITOR** — Plan 7 part 6a spec §5.5: the `undo` puts back each copy's view,
@@ -84,7 +84,7 @@ describe('a whole link pasted over a λ view holding its copy’s editor', () =>
     location.hash = await encodeLink({
       program: SUM_TO,
       encoding: 'binary',
-      workspace: serializeWorkspace(defaultWorkspace()),
+      workspace: serializeWorkspace(fourViewWorkspace()),
       positions: {},
     })
     // ONLY THE OPEN PUTS `sum_to(5)` IN THE EDITOR, which was on `let x = 40; x + 2`.
```

In `web/tests/browser/share-open-hashchange.test.ts`:

```diff
--- a/web/tests/browser/share-open-hashchange.test.ts
+++ b/web/tests/browser/share-open-hashchange.test.ts
@@ -3,11 +3,11 @@ import { beforeAll, describe, expect, it } from 'vitest'
 import { page, userEvent } from 'vitest/browser'
 import { BUFFERS_STORAGE_KEY, parseBuffers } from '../../src/buffers-store'
 import { EXAMPLE_ENCODING } from '../../src/examples'
-import { defaultLayout, splitLeaf } from '../../src/layout'
+import { splitLeaf } from '../../src/layout'
 import { encodeLink, type SharePayload } from '../../src/share-link'
 import { bindingKey } from '../../src/view-header'
-import { defaultWorkspace, PRESETS, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { PRESETS, serializeWorkspace } from '../../src/workspace'
+import { fourViews, fourViewWorkspace, SHELL, until } from './harness'
 
 /**
  * **A LINK PASTED INTO AN OPEN PAGE, AND ITS UNDO** — Plan 7 part 6a spec §5.3 and §5.5, heard as `hashchange`. The
@@ -33,8 +33,8 @@ const LINK: SharePayload = {
   program: LINKED,
   encoding: 'binary',
   workspace: serializeWorkspace({
-    ...defaultWorkspace(),
-    tree: splitLeaf(defaultLayout(), 'lambda-0', 'row', 'pane-2', 'lambda'),
+    ...fourViewWorkspace(),
+    tree: splitLeaf(fourViews(), 'lambda-0', 'row', 'pane-2', 'lambda'),
     switches: PRESETS.debugger,
     display: { 'lambda-0': { layout: 'outline', vars: 'names', map: 'icicle' } },
     inspector: false,
```

In `web/tests/browser/share-open-start-clamp.test.ts`:

```diff
--- a/web/tests/browser/share-open-start-clamp.test.ts
+++ b/web/tests/browser/share-open-start-clamp.test.ts
@@ -2,8 +2,8 @@ import type { EditorView } from '@codemirror/view'
 import { beforeAll, describe, expect, it } from 'vitest'
 import { userEvent } from 'vitest/browser'
 import { encodeLink } from '../../src/share-link'
-import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { serializeWorkspace } from '../../src/workspace'
+import { fourViewWorkspace, SHELL, until } from './harness'
 
 /**
  * **A LINK WITH POSITIONS, OPENED AT START-UP** — Plan 7 part 6a spec §5.3, §5.4 and §5.5, through `main()`'s own path,
@@ -27,7 +27,7 @@ beforeAll(async () => {
   const fragment = await encodeLink({
     program: LINKED,
     encoding: 'unary',
-    workspace: serializeWorkspace(defaultWorkspace()),
+    workspace: serializeWorkspace(fourViewWorkspace()),
     positions: { lambda: 100 },
   })
   history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
```

In `web/tests/browser/share-open.test.ts`:

```diff
--- a/web/tests/browser/share-open.test.ts
+++ b/web/tests/browser/share-open.test.ts
@@ -5,8 +5,8 @@ import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/b
 import { LAYOUT_STORAGE_KEY } from '../../src/layout'
 import { encodeLink } from '../../src/share-link'
 import { bindingKey } from '../../src/view-header'
-import { defaultWorkspace, PRESETS, parseWorkspace, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { PRESETS, parseWorkspace, serializeWorkspace } from '../../src/workspace'
+import { fourViewWorkspace, SHELL, until } from './harness'
 
 /**
  * **A LINK OPENED AT START-UP, WHOLE, AND ITS UNDO** — Plan 7 part 6a spec §5.3 and §5.5. The page is a returning
@@ -28,7 +28,7 @@ import { SHELL, until } from './harness'
 const LINKED = 'let y = 10; y + 5'
 const COPY = 'scratch-1'
 const LINK_WORKSPACE = {
-  ...defaultWorkspace(),
+  ...fourViewWorkspace(),
   switches: PRESETS.debugger,
   display: { 'lambda-0': { layout: 'outline', vars: 'names', map: 'icicle' } },
 } as const
@@ -53,7 +53,7 @@ const storedBindings = () => parseBuffers(localStorage.getItem(BUFFERS_STORAGE_K
 let view: EditorView
 
 beforeAll(async () => {
-  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(defaultWorkspace()))
+  localStorage.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(fourViewWorkspace()))
   localStorage.setItem(
     BUFFERS_STORAGE_KEY,
     serializeBuffers({
```

In `web/tests/browser/share-positions.test.ts`:

```diff
--- a/web/tests/browser/share-positions.test.ts
+++ b/web/tests/browser/share-positions.test.ts
@@ -5,8 +5,8 @@ import { EXAMPLES } from '../../src/examples'
 import { encodeLink, type Positions } from '../../src/share-link'
 import { MAX_LINK_CONTINUES } from '../../src/share-positions'
 import { bindingKey } from '../../src/view-header'
-import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { serializeWorkspace } from '../../src/workspace'
+import { fourViewWorkspace, SHELL, until } from './harness'
 
 /**
  * **A LINK'S POSITIONS, IN THE APP** — Plan 7 part 6a spec §5.4 and §8's positions row, on the real session worker:
@@ -97,7 +97,7 @@ async function open(
   const fragment = await encodeLink({
     program,
     encoding,
-    workspace: serializeWorkspace(defaultWorkspace()),
+    workspace: serializeWorkspace(fourViewWorkspace()),
     positions,
   })
   location.hash = fragment
```

In `web/tests/browser/share-through-open.test.ts`:

```diff
--- a/web/tests/browser/share-through-open.test.ts
+++ b/web/tests/browser/share-through-open.test.ts
@@ -3,8 +3,8 @@ import { beforeAll, describe, expect, it } from 'vitest'
 import { userEvent } from 'vitest/browser'
 import { EXAMPLES } from '../../src/examples'
 import { decodeLink, encodeLink, type Positions } from '../../src/share-link'
-import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { serializeWorkspace } from '../../src/workspace'
+import { fourViewWorkspace, SHELL, until } from './harness'
 
 /**
  * **`share` THROUGH AN OPEN** — Plan 7 part 6a spec §5.1's note of 2026-10-01, §5.2 and §5.3. `share`'s popover closes
@@ -49,7 +49,7 @@ const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.stat
 
 /** A link to `program` under `encoding`, in the default workspace, with `positions`. */
 const link = (program: string, positions: Positions, encoding = 'unary'): Promise<string> =>
-  encodeLink({ program, encoding, workspace: serializeWorkspace(defaultWorkspace()), positions })
+  encodeLink({ program, encoding, workspace: serializeWorkspace(fourViewWorkspace()), positions })
 
 /** Open `share` with a click, and answer once its link is made. */
 async function openShare(): Promise<void> {
```

In `web/tests/browser/storage-blocked.test.ts`:

```diff
--- a/web/tests/browser/storage-blocked.test.ts
+++ b/web/tests/browser/storage-blocked.test.ts
@@ -2,7 +2,7 @@ import type { EditorView } from '@codemirror/view'
 import { afterEach, beforeAll, describe, expect, it } from 'vitest'
 import { userEvent } from 'vitest/browser'
 import { FIRST_LOAD } from '../../src/examples'
-import { SHELL, until } from './harness'
+import { SHELL, showFourViews, until } from './harness'
 
 /**
  * **THE APP WHERE THIS SITE'S DATA IS BLOCKED** — Chrome with site data blocked, and the privacy modes that
@@ -190,6 +190,8 @@ describe('with site data blocked', () => {
     await until(() => said.includes(PROGRAM_LINE), 'the program’s own refusal')
     await until(() => idle() && resultsText().includes('λ 6 · '), 'the formatted program to compile')
     await closeSettings()
+    // WITH NOTHING READABLE IN STORAGE THE PAGE OPENED ON THE SOURCE AND THE TM VIEW, so the λ view is asked for.
+    await showFourViews()
     const more = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.view-more')
     const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
     if (more === null || menu === null) throw new Error('no view menu on the λ view')
```

In `web/tests/browser/tm-buffer-restore.test.ts`:

```diff
--- a/web/tests/browser/tm-buffer-restore.test.ts
+++ b/web/tests/browser/tm-buffer-restore.test.ts
@@ -12,7 +12,7 @@ import { BUFFERS_STORAGE_KEY, parseBuffers, serializeBuffers } from '../../src/b
 import type { Leg } from '../../src/protocol'
 import type { SessionId } from '../../src/session-client'
 import { bindingKey } from '../../src/view-header'
-import { SHELL, until } from './harness'
+import { SHELL, storeFourViews, until } from './harness'
 
 /**
  * **BOTH LEGS SURVIVE A RELOAD, END TO END — 5d-iv Task 11, the composition check.** Task 6 pinned the
@@ -248,6 +248,8 @@ async function freshMain(): Promise<{ ready: Promise<EditorView> }> {
 /** Mount a fresh app on a fresh page with an empty store, and load `src` into its one source editor. */
 async function mountApp(src: string): Promise<App> {
   localStorage.clear()
+  // ALL FOUR VIEWS, WHICH AN EMPTY STORE OPENED ON WHEN THIS WAS WRITTEN: it opens on the source and TM now.
+  storeFourViews()
   document.body.innerHTML = SHELL
   const view = await (await freshMain()).ready
   view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
```

In `web/tests/browser/tm-display-restore.test.ts`:

```diff
--- a/web/tests/browser/tm-display-restore.test.ts
+++ b/web/tests/browser/tm-display-restore.test.ts
@@ -1,8 +1,8 @@
 import { beforeAll, describe, expect, it } from 'vitest'
 import { page } from 'vitest/browser'
 import { LAYOUT_STORAGE_KEY } from '../../src/layout'
-import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { serializeWorkspace } from '../../src/workspace'
+import { fourViewWorkspace, SHELL, until } from './harness'
 
 /**
  * **A TM VIEW IS BUILT WITH THE DISPLAY ITS WORKSPACE STORED** (Plan 7 part 4, spec §8 and §11). Seeded before
@@ -18,7 +18,7 @@ beforeAll(async () => {
   await page.viewport(1280, 2400)
   localStorage.setItem(
     LAYOUT_STORAGE_KEY,
-    serializeWorkspace({ ...defaultWorkspace(), tmDisplay: { 'tm-0': { level: 'local', edges: 'chips' } } }),
+    serializeWorkspace({ ...fourViewWorkspace(), tmDisplay: { 'tm-0': { level: 'local', edges: 'chips' } } }),
   )
   document.body.innerHTML = SHELL
   await (await import('../../src/main')).ready
```

In `web/tests/browser/tm-view-narrow.test.ts`:

```diff
--- a/web/tests/browser/tm-view-narrow.test.ts
+++ b/web/tests/browser/tm-view-narrow.test.ts
@@ -2,7 +2,7 @@ import type { EditorView } from '@codemirror/view'
 import { beforeAll, describe, expect, it } from 'vitest'
 import { page, userEvent } from 'vitest/browser'
 import { EXAMPLES } from '../../src/examples'
-import { SHELL, until } from './harness'
+import { resetToFourViews, SHELL, until } from './harness'
 
 /**
  * **THE TM VIEW ON A PHONE'S SCREEN** — Explorer at 320px and 390px, on `sum_to(5)`, the example a first visit opens,
@@ -243,9 +243,10 @@ const presetOf = (preset: string): void => {
 }
 const explorer = (): void => presetOf('explorer')
 /** The workspace menu's *reset preset*: the preset's default views, one TM view among them. */
-const resetPreset = (): void => {
+const resetPreset = async (): Promise<void> => {
   buttonOf('workspace').click()
-  buttonOf('reset-preset').click()
+  // ALL FOUR VIEWS, AS *RESET PRESET* GAVE WHEN THIS WAS WRITTEN: it leaves the source beside the TM view now.
+  await resetToFourViews()
   if (menuOf('workspace').matches(':popover-open')) menuOf('workspace').hidePopover()
 }
 /** Split the TM view right into a second view of the same kind, by its `⋯` menu, with the pointer. */
@@ -659,7 +660,7 @@ describe('the TM view, on sum_to(5)', () => {
       presetOf(layout.preset)
       await page.viewport(layout.width, layout.height)
       if (layout.split) {
-        resetPreset()
+        await resetPreset()
         await frame()
         await splitTm()
       }
@@ -711,7 +712,7 @@ describe('the TM view, on sum_to(5)', () => {
       }
     } finally {
       if (layout.split) {
-        resetPreset()
+        await resetPreset()
         await until(() => tmViews().length === 1, 'one TM view again')
       }
       home()
@@ -1081,7 +1082,7 @@ describe.each(COUNTED)('the program level’s counts, on $title', ({ id, marks,
         presetOf(layout.preset)
         await page.viewport(layout.width, layout.height)
         if (layout.split) {
-          resetPreset()
+          await resetPreset()
           await frame()
           await splitTm()
         }
@@ -1235,7 +1236,7 @@ describe.each(COUNTED)('the program level’s counts, on $title', ({ id, marks,
         await until(() => choice('arcs').getAttribute('aria-checked') === 'true', 'the diagram drawn as arcs again')
         if (shown(diagramReattach())) diagramReattach().click()
         if (layout.split) {
-          resetPreset()
+          await resetPreset()
           await until(() => tmViews().length === 1, 'one TM view again')
         }
         home()
```

In `web/tests/browser/two-lambda-panes.test.ts`:

```diff
--- a/web/tests/browser/two-lambda-panes.test.ts
+++ b/web/tests/browser/two-lambda-panes.test.ts
@@ -1,10 +1,10 @@
 import { EditorView } from '@codemirror/view'
 import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
 import { page } from 'vitest/browser'
-import { defaultLayout, LAYOUT_STORAGE_KEY, leaves } from '../../src/layout'
+import { LAYOUT_STORAGE_KEY, leaves } from '../../src/layout'
 import { bindingKey } from '../../src/view-header'
 import { parseWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { fourViews, resetToFourViews, SHELL, until } from './harness'
 import { lambdaSettled } from './lambda-text'
 
 /**
@@ -306,7 +306,7 @@ beforeAll(async () => {
  */
 beforeEach(async () => {
   localStorage.removeItem(LAYOUT_STORAGE_KEY)
-  document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
+  await resetToFourViews()
   for (const leaf of lambdaLeaves()) {
     const sel = selectOf(leaf)
     if (sel === null || sel.value === bindingKey('lambda', 'source')) continue
@@ -753,7 +753,7 @@ describe('two λ panes on two λ sessions', () => {
   })
 
   /**
-   * MINOR FINDING, SAME RE-REVIEW — `reset preset` RE-MINTS `defaultLayout()`'s LITERAL IDS, so a closed
+   * MINOR FINDING, SAME RE-REVIEW — `reset preset` RE-MINTS A DEFAULT ARRANGEMENT'S LITERAL IDS, so a closed
    * `lambda-0` does come back, and `editorOwner` still named it.
    *
    * The two docs that justified keying custody by session argued from "the closed leaf's id is never
@@ -776,7 +776,7 @@ describe('two λ panes on two λ sessions', () => {
     await until(() => lambdaLeaves().length === 0)
 
     // `reset preset` mints a FRESH `lambda-0`, the same literal id the custody entry's owner names.
-    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
+    await resetToFourViews()
     await until(() => lambdaLeaves().length === 1)
     expect(lambdaLeaves()).toEqual(['lambda-0'])
 
@@ -900,7 +900,7 @@ describe('two λ panes on two λ sessions', () => {
       // `toContain`, NOT `toEqual(['source', forked])`: decision 2 keeps every earlier test's buffer
       // alive on this one page, so the group is as long as this file's fork count. What this step needs
       // is that THIS buffer is in it, which is what naming it says.
-      document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
+      await resetToFourViews()
       await until(() => lambdaLeaves().length === 1)
       expect(lambdaOptionsOf('lambda-0')).toContain(labelA)
 
@@ -945,7 +945,7 @@ describe('two λ panes on two λ sessions', () => {
       const stored = parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.tree ?? null
       expect(stored).not.toBeNull()
       expect(
-        leaves(stored ?? defaultLayout())
+        leaves(stored ?? fourViews())
           .map((l) => l.id)
           .sort(),
       ).toEqual([...leafIds()].sort())
@@ -996,7 +996,7 @@ describe('two λ panes on two λ sessions', () => {
     btn('source', 'close this view')?.click()
     await until(() => !leafIds().includes('source'))
 
-    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
+    await resetToFourViews()
     await until(() => leafIds().includes('source'))
 
     expect(document.querySelector('[data-leaf="source"] .cm-content')?.textContent).toBe(before)
```

In `web/tests/browser/view-toggles.test.ts`:

```diff
--- a/web/tests/browser/view-toggles.test.ts
+++ b/web/tests/browser/view-toggles.test.ts
@@ -30,6 +30,7 @@ const mounted = (): string[] =>
 const tabs = (): string[] =>
   [...document.querySelectorAll<HTMLElement>('#views [role="tab"]')].map((t) => t.dataset.leaf as string)
 const live = (): string => (document.querySelector('#live')?.textContent ?? '').trim()
+const notice = (): string => (document.querySelector('#notice')?.textContent ?? '').trim()
 type Stored = { tree: unknown; focused: string; arrangements?: Record<string, unknown> }
 const stored = (): Stored => JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null')
 const press = (kind: string): Promise<void> => userEvent.click(toggle(kind))
@@ -214,4 +215,30 @@ describe('the views toggles', () => {
     await pick('[data-preset="explorer"]')
     expect(mounted()).toEqual(['source', 'tm-0'])
   })
+
+  it('forgets every arrangement on reset preset, and is back on the source beside the TM view', async () => {
+    expect(Object.keys(stored().arrangements ?? {}).length, 'precondition: something is remembered').toBeGreaterThan(0)
+    await pick('#reset-preset')
+    expect(mounted()).toEqual(['source', 'tm-0'])
+    expect(pressed()).toEqual(['source', 'tm'])
+    expect(stored().arrangements).toBeUndefined()
+    expect(notice()).toContain('the default views are back')
+    // AND A TOGGLE PRESSED NEXT SHOWS THAT COMBINATION'S DEFAULT: the four views in two rows of two.
+    await press('lambda')
+    await press('asm')
+    const area = (document.querySelector('#views') as HTMLElement).getBoundingClientRect()
+    const sourceBox = (host('source') as HTMLElement).getBoundingClientRect()
+    const asm = (host('asm-0') as HTMLElement).getBoundingClientRect()
+    const lambda = (host('lambda-0') as HTMLElement).getBoundingClientRect()
+    const tm = (host('tm-0') as HTMLElement).getBoundingClientRect()
+    // TWO COLUMNS OF TWO: source over asm, beside λ over TM, so the document has them a column at a time.
+    expect(mounted()).toEqual(['source', 'asm-0', 'lambda-0', 'tm-0'])
+    expect(asm.top, 'the asm view is not under the source view').toBeGreaterThanOrEqual(sourceBox.bottom)
+    expect(Math.abs(asm.left - sourceBox.left)).toBeLessThan(1)
+    expect(tm.top, 'the TM view is not under the λ view').toBeGreaterThanOrEqual(lambda.bottom)
+    expect(Math.abs(tm.left - lambda.left)).toBeLessThan(1)
+    expect(sourceBox.right).toBeLessThanOrEqual(lambda.left)
+    for (const view of [sourceBox, asm, lambda, tm])
+      expect(view.width, 'a view runs the whole width').toBeLessThan(area.width * 0.6)
+  })
 })
```

In `web/tests/browser/workspace-bound.test.ts`:

```diff
--- a/web/tests/browser/workspace-bound.test.ts
+++ b/web/tests/browser/workspace-bound.test.ts
@@ -1,7 +1,7 @@
 import { beforeAll, describe, expect, it } from 'vitest'
-import { defaultLayout, insertBeside, LAYOUT_STORAGE_KEY, type LayoutNode } from '../../src/layout'
-import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { insertBeside, LAYOUT_STORAGE_KEY, type LayoutNode } from '../../src/layout'
+import { serializeWorkspace } from '../../src/workspace'
+import { fourViews, fourViewWorkspace, SHELL, until } from './harness'
 
 /**
  * **A STORED LAYOUT PAST THE BOUND ON A TREE LOADS AS THE DEFAULT** — Plan 7 part 6a spec §5.3, amended 2026-10-01: at
@@ -17,7 +17,7 @@ import { SHELL, until } from './harness'
  */
 
 function pressed(presses: number): LayoutNode {
-  let tree = defaultLayout()
+  let tree = fourViews()
   let focused = 'lambda-0'
   for (let k = 1; k <= presses; k++) {
     tree = insertBeside(tree, focused, 'row', `pane-${k}`, 'lambda')
@@ -31,7 +31,7 @@ const leafIds = () => [...document.querySelectorAll<HTMLElement>('main [data-lea
 beforeAll(async () => {
   localStorage.setItem(
     LAYOUT_STORAGE_KEY,
-    serializeWorkspace({ ...defaultWorkspace(), tree: pressed(61), focused: 'pane-61' }),
+    serializeWorkspace({ ...fourViewWorkspace(), tree: pressed(61), focused: 'pane-61' }),
   )
   document.body.innerHTML = SHELL
   await (await import('../../src/main')).ready
@@ -40,6 +40,6 @@ beforeAll(async () => {
 
 describe('a stored layout with 65 leaves', () => {
   it('loads the default views instead', () => {
-    expect(leafIds()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
+    expect(leafIds()).toEqual(['source', 'tm-0'])
   })
 })
```

In `web/tests/browser/workspace-restore.test.ts`:

```diff
--- a/web/tests/browser/workspace-restore.test.ts
+++ b/web/tests/browser/workspace-restore.test.ts
@@ -1,7 +1,7 @@
 import { beforeAll, describe, expect, it } from 'vitest'
 import { LAYOUT_STORAGE_KEY } from '../../src/layout'
-import { defaultWorkspace, PRESETS, parseWorkspace, serializeWorkspace } from '../../src/workspace'
-import { SHELL, until } from './harness'
+import { PRESETS, parseWorkspace, serializeWorkspace } from '../../src/workspace'
+import { fourViewWorkspace, SHELL, showFourViews, until } from './harness'
 
 /**
  * **A STORED VERSION 2 WORKSPACE, THROUGH THE REAL APP** — Plan 7 part 2 spec §3. Seeded before `main.ts`
@@ -13,7 +13,7 @@ beforeAll(async () => {
   localStorage.setItem(
     LAYOUT_STORAGE_KEY,
     serializeWorkspace({
-      ...defaultWorkspace(),
+      ...fourViewWorkspace(),
       speed: 250,
       focused: 'tm-0',
       panels: { 'tm-0': { rules: false }, 'asm-0': { heap: false } },
@@ -96,7 +96,7 @@ describe('a restored workspace', () => {
   })
 
   /**
-   * **A LEAF ID COMES BACK, AND ITS OLD PANEL STATE MUST NOT COME WITH IT.** `defaultLayout()` re-mints
+   * **A LEAF ID COMES BACK, AND ITS OLD PANEL STATE MUST NOT COME WITH IT.** A default arrangement re-mints
    * `source`, `lambda-0`, `asm-0` and `tm-0` as literals, so *reset preset* after closing the TM view hands the
    * id to a new view. Until `main.ts` normalised the workspace against the live tree, the write dropped
    * the closed view's panel state and MEMORY kept it — so this same sequence opened the rules panel
@@ -123,10 +123,14 @@ describe('a restored workspace', () => {
     document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
     await until(() => document.querySelector('[data-leaf="tm-0"]') !== null, 'the TM view to come back')
     expect(rulesToggle()?.getAttribute('aria-expanded'), 'the re-minted view inherited a closed panel').toBe('true')
-    // The asm view never closed, so the reset kept it, and its stored heap panel with it — in storage and on the page
-    // alike, which is the agreement this case is about.
-    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.panels).toEqual({ 'asm-0': { heap: false } })
-    expect(asmToggle('heap')?.getAttribute('aria-expanded'), "the asm view's heap panel is still closed").toBe('false')
+    // THE ASM VIEW LEFT WITH THE RESET, WHICH PUTS THE SOURCE BESIDE THE TM VIEW (the view layouts spec §4.6), and its
+    // stored heap panel went with it — from storage and from memory alike, which is the agreement this case is about:
+    // the view its toggle brings back is a new one, with its heap panel open as a new view's is.
+    expect(document.querySelector('[data-leaf="asm-0"]'), 'the reset kept the asm view').toBeNull()
+    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.panels).toEqual({})
+    await showFourViews()
+    await until(() => document.querySelector('[data-leaf="asm-0"]') !== null, 'the asm view to come back')
+    expect(asmToggle('heap')?.getAttribute('aria-expanded'), 'the new asm view inherited a closed panel').toBe('true')
   })
 
   it('records which view has focus', () => {
```

In `web/tests/node/layout.test.ts`:

```diff
--- a/web/tests/node/layout.test.ts
+++ b/web/tests/node/layout.test.ts
@@ -4,7 +4,6 @@ import {
   closeLeaf,
   defaultArrangement,
   defaultLayout,
-  defaultLayout as dl,
   HEADER_ORDER,
   holdsMostLeaves,
   insertBeside,
@@ -27,6 +26,7 @@ import {
 } from '../../src/layout'
 import { DIVIDER_PX } from '../../src/layout-view'
 import type { PaneKind } from '../../src/panes'
+import { fourViews } from '../browser/harness'
 
 /**
  * THE TREE MODEL, WITH NO DOM ANYWHERE — every invariant design §4.1 states, asserted as a value.
@@ -92,8 +92,8 @@ describe('defaultArrangement', () => {
   })
 
   it('puts all four in two rows of two in a tall area, the tree a fresh page built until the view layouts', () => {
-    expect(defaultArrangement(KIND_ORDER, 'tall')).toEqual(defaultLayout())
-    expect(defaultLayout()).toEqual({
+    expect(defaultArrangement(KIND_ORDER, 'tall')).toEqual(fourViews())
+    expect(fourViews()).toEqual({
       kind: 'split',
       dir: 'column',
       sizes: [0.5, 0.5],
@@ -186,26 +186,15 @@ describe('defaultArrangement', () => {
 })
 
 describe('defaultLayout', () => {
-  it('puts source and λ above asm and TM, two rows of two', () => {
+  it('is the source beside the TM view, and one above the other in a tall area', () => {
     expect(defaultLayout()).toEqual({
       kind: 'split',
-      dir: 'column',
+      dir: 'row',
       sizes: [0.5, 0.5],
-      children: [
-        {
-          kind: 'split',
-          dir: 'row',
-          sizes: [0.5, 0.5],
-          children: [leaf('source', 'source'), leaf('lambda-0', 'lambda')],
-        },
-        {
-          kind: 'split',
-          dir: 'row',
-          sizes: [0.5, 0.5],
-          children: [leaf('asm-0', 'asm'), leaf('tm-0', 'tm')],
-        },
-      ],
+      children: [leaf('source', 'source'), leaf('tm-0', 'tm')],
     })
+    expect(defaultLayout('tall')).toEqual(defaultArrangement(['source', 'tm'], 'tall'))
+    expect(defaultLayout('wide')).toEqual(defaultLayout())
   })
 })
 
@@ -221,26 +210,26 @@ describe('splitLeaf', () => {
   })
 
   it('splits a nested leaf without disturbing its siblings', () => {
-    const tree = splitLeaf(defaultLayout(), 'tm-0', 'column', 'tm-1', 'tm')
+    const tree = splitLeaf(fourViews(), 'tm-0', 'column', 'tm-1', 'tm')
     expect(leaves(tree).map((l) => l.id)).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0', 'tm-1'])
   })
 
   it('refuses to split the source leaf, because there is no second editor to duplicate', () => {
-    expect(() => splitLeaf(defaultLayout(), 'source', 'row', 'source-1', 'lambda')).toThrow(/source/)
+    expect(() => splitLeaf(fourViews(), 'source', 'row', 'source-1', 'lambda')).toThrow(/source/)
   })
 
   it('throws on an unknown leaf rather than returning the tree unchanged', () => {
-    expect(() => splitLeaf(defaultLayout(), 'nope', 'row', 'x', 'lambda')).toThrow(/nope/)
+    expect(() => splitLeaf(fourViews(), 'nope', 'row', 'x', 'lambda')).toThrow(/nope/)
   })
 
   it('refuses a newId already in the tree, because the duplicate would be unreachable', () => {
     // findLeaf uses .find(), so a duplicate id would silently hide the second leaf behind the first
     // rather than surface as a tree parseLayout could also reject on load.
-    expect(() => splitLeaf(defaultLayout(), 'lambda-0', 'row', 'tm-0', 'lambda')).toThrow(/tm-0/)
+    expect(() => splitLeaf(fourViews(), 'lambda-0', 'row', 'tm-0', 'lambda')).toThrow(/tm-0/)
   })
 
   it('still refuses the source leaf as its subject', () => {
-    expect(() => splitLeaf(defaultLayout(), 'source', 'row', 'pane-1', 'lambda')).toThrow(/source pane cannot be split/)
+    expect(() => splitLeaf(fourViews(), 'source', 'row', 'pane-1', 'lambda')).toThrow(/source pane cannot be split/)
   })
 })
 
@@ -258,7 +247,7 @@ describe('closeLeaf', () => {
       sizes: [0.5, 0.5],
       children: [leaf('asm-0', 'asm'), leaf('tm-0', 'tm')],
     }
-    const afterSource = closeLeaf(defaultLayout(), 'source')
+    const afterSource = closeLeaf(fourViews(), 'source')
     expect(afterSource).toEqual({
       kind: 'split',
       dir: 'column',
@@ -316,7 +305,7 @@ describe('resize', () => {
   })
 
   it('resizes a nested split addressed by path', () => {
-    const after = resize(defaultLayout(), [0], 0, 0.1)
+    const after = resize(fourViews(), [0], 0, 0.1)
     if (after.kind !== 'split') throw new Error('unreachable')
     const inner = after.children[0]
     if (inner?.kind !== 'split') throw new Error('unreachable')
@@ -335,18 +324,18 @@ describe('resize', () => {
    * but still trips either guard inside `rewrite`.
    */
   it('throws when the path runs through a leaf on the way down', () => {
-    // defaultLayout()'s [0] is a split, but [0, 0] is the source leaf — [0, 0, 0] tries to step
+    // fourViews()'s [0] is a split, but [0, 0] is the source leaf — [0, 0, 0] tries to step
     // past it.
-    expect(() => resize(defaultLayout(), [0, 0, 0], 0, 0.1)).toThrow(/layout path leaves the tree at index 0/)
+    expect(() => resize(fourViews(), [0, 0, 0], 0, 0.1)).toThrow(/layout path leaves the tree at index 0/)
   })
 
   it('throws when a path index has no child there', () => {
-    expect(() => resize(defaultLayout(), [5], 0, 0.1)).toThrow(/layout path leaves the tree at index 5/)
+    expect(() => resize(fourViews(), [5], 0, 0.1)).toThrow(/layout path leaves the tree at index 5/)
   })
 
   it('throws when the path addresses a leaf directly', () => {
     // [0, 0] resolves to the source leaf itself, not a split to resize.
-    expect(() => resize(defaultLayout(), [0, 0], 0, 0.1)).toThrow(/resize addressed a leaf/)
+    expect(() => resize(fourViews(), [0, 0], 0, 0.1)).toThrow(/resize addressed a leaf/)
   })
 
   it('throws when there is no divider at the given index', () => {
@@ -356,7 +345,7 @@ describe('resize', () => {
 
 describe('immutability', () => {
   it('never mutates the tree it was given', () => {
-    const before = defaultLayout()
+    const before = fourViews()
     const snapshot = structuredClone(before)
     splitLeaf(before, 'tm-0', 'row', 'tm-1', 'tm')
     closeLeaf(before, 'source')
@@ -377,7 +366,7 @@ describe('parseLayout', () => {
   const wrap = (tree: unknown) => JSON.stringify({ version: LAYOUT_VERSION, tree })
 
   it('round-trips a tree it serialized', () => {
-    expect(parseLayout(serializeLayout(dl()))).toEqual(dl())
+    expect(parseLayout(serializeLayout(fourViews()))).toEqual(fourViews())
   })
 
   it('returns null for absent storage', () => {
@@ -389,11 +378,11 @@ describe('parseLayout', () => {
   })
 
   it('returns null for a wrong version', () => {
-    expect(parseLayout(JSON.stringify({ version: 99, tree: dl() }))).toBeNull()
+    expect(parseLayout(JSON.stringify({ version: 99, tree: fourViews() }))).toBeNull()
   })
 
   it('returns null for a missing version', () => {
-    expect(parseLayout(JSON.stringify({ tree: dl() }))).toBeNull()
+    expect(parseLayout(JSON.stringify({ tree: fourViews() }))).toBeNull()
   })
 
   it('returns null for an unknown pane kind', () => {
@@ -672,14 +661,14 @@ describe('insertBeside', () => {
   })
 
   it('puts the new leaf after its subject in leaves() order', () => {
-    const next = insertBeside(defaultLayout(), 'lambda-0', 'row', 'pane-1', 'tm')
+    const next = insertBeside(fourViews(), 'lambda-0', 'row', 'pane-1', 'tm')
     expect(leaves(next).map((l) => l.id)).toEqual(['source', 'lambda-0', 'pane-1', 'asm-0', 'tm-0'])
   })
 
   it('still refuses a second source leaf and a duplicate id', () => {
-    expect(() => insertBeside(defaultLayout(), 'tm-0', 'row', 'source', 'source')).toThrow(/already has a source leaf/)
-    expect(() => insertBeside(defaultLayout(), 'tm-0', 'row', 'lambda-0', 'lambda')).toThrow(/already in the tree/)
-    expect(() => insertBeside(defaultLayout(), 'pane-9', 'row', 'pane-1', 'lambda')).toThrow(/not in the tree/)
+    expect(() => insertBeside(fourViews(), 'tm-0', 'row', 'source', 'source')).toThrow(/already has a source leaf/)
+    expect(() => insertBeside(fourViews(), 'tm-0', 'row', 'lambda-0', 'lambda')).toThrow(/already in the tree/)
+    expect(() => insertBeside(fourViews(), 'pane-9', 'row', 'pane-1', 'lambda')).toThrow(/not in the tree/)
   })
 })
 
@@ -704,7 +693,7 @@ const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  */
 describe('insertBeside, `+ view`’s equal share', () => {
   it('joins the row at an equal share, right after the view it is added beside', () => {
-    const next = insertBeside(defaultLayout(), 'lambda-0', 'row', 'pane-1', 'tm')
+    const next = insertBeside(fourViews(), 'lambda-0', 'row', 'pane-1', 'tm')
     expect(rowOf(next, 'pane-1')).toEqual({
       sizes: [1 / 3, 1 / 3, 1 / 3],
       ids: ['source', 'lambda-0', 'pane-1'],
@@ -732,7 +721,7 @@ describe('insertBeside, `+ view`’s equal share', () => {
   })
 
   it('pressed five times in a row gives one row of seven equal views, still summing to 1', () => {
-    let tree = defaultLayout()
+    let tree = fourViews()
     let focused = 'lambda-0'
     for (let k = 1; k <= 5; k++) {
       tree = insertBeside(tree, focused, 'row', `pane-${k}`, 'lambda')
@@ -746,7 +735,7 @@ describe('insertBeside, `+ view`’s equal share', () => {
   })
 
   it('wraps a view whose parent is a column in a new row at [0.5, 0.5]', () => {
-    const column = splitLeaf(defaultLayout(), 'tm-0', 'column', 'pane-1', 'tm')
+    const column = splitLeaf(fourViews(), 'tm-0', 'column', 'pane-1', 'tm')
     const next = insertBeside(column, 'tm-0', 'row', 'pane-2', 'lambda')
     expect(rowOf(next, 'pane-2')).toEqual({ sizes: [0.5, 0.5], ids: ['tm-0', 'pane-2'], dir: 'row' })
     expect(rowOf(next, 'pane-1')).toEqual({ sizes: [0.5, 0.5], ids: ['(split)', 'pane-1'], dir: 'column' })
@@ -774,13 +763,13 @@ describe('the floor on an add', () => {
     splitLeaf(root, at, dir, id, 'lambda')
 
   it('draws each view the size the stylesheet does', () => {
-    const sizes = leafExtents(defaultLayout(), AREA, DIVIDER_PX)
+    const sizes = leafExtents(fourViews(), AREA, DIVIDER_PX)
     for (const id of ['source', 'lambda-0', 'asm-0', 'tm-0'])
       expect(sizes.get(id)).toEqual({ width: 634, height: 356.75 })
   })
 
   it('lets + view add five views beside λ and refuses the sixth', () => {
-    let tree = defaultLayout()
+    let tree = fourViews()
     let focused = 'lambda-0'
     for (let k = 1; k <= 5; k++) {
       expect(addRefusal(tree, view(tree, focused), 'width', AREA, DIVIDER_PX), `press ${k}`).toBeNull()
@@ -793,7 +782,7 @@ describe('the floor on an add', () => {
 
   it('refuses split right on a view under 332 px wide, and allows it at 332', () => {
     const narrow = insertBeside(
-      insertBeside(defaultLayout(), 'lambda-0', 'row', 'p1', 'lambda'),
+      insertBeside(fourViews(), 'lambda-0', 'row', 'p1', 'lambda'),
       'p1',
       'row',
       'p2',
@@ -828,7 +817,7 @@ describe('the floor on an add', () => {
    * which passes the height floor, and 152.16 wide, which does not.
    */
   it('refuses a split down of a view already narrower than the floor', () => {
-    const tree = resize(defaultLayout(), [0], 0, 0.38)
+    const tree = resize(fourViews(), [0], 0, 0.38)
     expect(leafExtents(tree, AREA, DIVIDER_PX).get('lambda-0')?.width).toBeCloseTo(152.16, 9)
     const down = split(tree, 'lambda-0', 'column')
     expect(leafExtents(down('added'), AREA, DIVIDER_PX).get('added')).toEqual({ width: 152.16, height: 172.375 })
@@ -902,7 +891,7 @@ describe('the floor on an add', () => {
   })
 
   it('changes nothing it was given', () => {
-    const before = defaultLayout()
+    const before = fourViews()
     const snapshot = structuredClone(before)
     addRefusal(before, view(before, 'lambda-0'), 'width', AREA, DIVIDER_PX)
     insertBeside(before, 'lambda-0', 'row', 'pane-1', 'lambda')
@@ -912,7 +901,7 @@ describe('the floor on an add', () => {
 
 describe('parseTree', () => {
   it('validates a bare tree the way parseLayout validates an envelope', () => {
-    expect(parseTree(defaultLayout())).toEqual(defaultLayout())
+    expect(parseTree(fourViews())).toEqual(fourViews())
     expect(parseTree({ kind: 'leaf', id: 'x', pane: 'source' })).toBeNull()
     expect(parseTree('nope')).toBeNull()
   })
@@ -958,7 +947,7 @@ describe('the bound on a tree', () => {
   }
   /** `+ view` pressed `presses` times in a row: each adds a λ view beside the view the last one added and focused. */
   const pressed = (presses: number): LayoutNode => {
-    let tree = defaultLayout()
+    let tree = fourViews()
     let focused = 'lambda-0'
     for (let k = 1; k <= presses; k++) {
       tree = insertBeside(tree, focused, 'row', `pane-${k}`, 'lambda')
```

In `web/tests/node/workspace.test.ts`:

```diff
--- a/web/tests/node/workspace.test.ts
+++ b/web/tests/node/workspace.test.ts
@@ -1,13 +1,6 @@
 import { describe, expect, it } from 'vitest'
 import { treeKey } from '../../src/arrangements'
-import {
-  defaultArrangement,
-  defaultLayout,
-  type LayoutNode,
-  leaves,
-  serializeLayout,
-  splitLeaf,
-} from '../../src/layout'
+import { defaultLayout, type LayoutNode, leaves, serializeLayout, splitLeaf } from '../../src/layout'
 import {
   DEFAULT_SPEED,
   defaultFocus,
@@ -24,8 +17,11 @@ import {
   withPanel,
   withTmDisplay,
 } from '../../src/workspace'
+import { fourViews } from '../browser/harness'
 
-const SPLIT = splitLeaf(defaultLayout(), 'lambda-0', 'row', 'pane-1', 'tm')
+/** All four views, two rows of two — the tree these cases were written against; `defaultLayout()` is two views now. */
+const FOUR = fourViews()
+const SPLIT = splitLeaf(FOUR, 'lambda-0', 'row', 'pane-1', 'tm')
 
 describe('presetOf', () => {
   it('names the three presets and calls the other five combinations custom', () => {
@@ -55,7 +51,8 @@ describe('the speed ladder', () => {
 
 describe('defaultFocus', () => {
   it('is the first λ or TM leaf, and the source leaf only when there is no other', () => {
-    expect(defaultFocus(defaultLayout())).toBe('lambda-0')
+    expect(defaultFocus(FOUR)).toBe('lambda-0')
+    expect(defaultFocus(defaultLayout())).toBe('tm-0')
     expect(defaultFocus({ kind: 'leaf', id: 'source', pane: 'source' })).toBe('source')
   })
 })
@@ -81,7 +78,7 @@ describe('parseWorkspace', () => {
       inspector: false,
       display: { 'pane-1': { layout: 'outline' as const, vars: 'debruijn' as const, map: 'minimap' as const } },
       tmDisplay: { 'tm-0': { level: 'local' as const, edges: 'chips' as const } },
-      arrangements: { 'source+tm': defaultArrangement(['source', 'tm'], 'tall') },
+      arrangements: { 'source+tm': defaultLayout('tall') },
     }
     const raw = serializeWorkspace(ws)
     expect(JSON.parse(raw).version).toBe(WORKSPACE_VERSION)
@@ -209,6 +206,7 @@ describe('serializeWorkspace', () => {
     const outline = { layout: 'outline' as const, vars: 'names' as const, map: 'icicle' as const }
     const ws = {
       ...defaultWorkspace(),
+      tree: FOUR,
       focused: 'pane-9',
       panels: { 'pane-9': { rules: false }, 'tm-0': { rules: false } },
       display: { 'pane-9': outline, 'lambda-0': outline },
@@ -251,19 +249,25 @@ describe('withPanel', () => {
 })
 
 describe('defaultWorkspace', () => {
-  it('is the default tree, Explorer, speed 8, focused on the λ view', () => {
+  it('is the source beside the TM view, Explorer, speed 8, focused on the TM view, nothing remembered', () => {
     const ws = defaultWorkspace()
-    expect(leaves(ws.tree).map((l) => l.id)).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
+    expect(ws.tree).toEqual(defaultLayout())
+    expect(leaves(ws.tree).map((l) => l.id)).toEqual(['source', 'tm-0'])
     expect(ws.switches).toEqual(PRESETS.explorer)
     expect(ws.speed).toBe(8)
-    expect(ws.focused).toBe('lambda-0')
+    expect(ws.focused).toBe('tm-0')
     expect(ws.inspector).toBe(true)
+    expect(ws.arrangements).toEqual({})
+  })
+
+  it('puts the two views one above the other for a tall area', () => {
+    expect(defaultWorkspace('tall').tree).toEqual(defaultLayout('tall'))
+    expect(defaultWorkspace('wide').tree).toEqual(defaultWorkspace().tree)
   })
 })
 
 describe('the remembered arrangements', () => {
-  const FOUR = defaultLayout()
-  const PAIR = defaultArrangement(['source', 'tm'], 'wide')
+  const PAIR = defaultLayout()
   const base = (): Record<string, unknown> => ({
     version: 2,
     tree: FOUR,
@@ -344,7 +348,7 @@ describe('the remembered arrangements', () => {
   it('holds the focus to the tree on screen: a view only a remembered tree holds is refused, and not written', () => {
     const stored = { ...base(), tree: PAIR, focused: 'lambda-0', arrangements: { [treeKey(FOUR)]: FOUR } }
     expect(parseWorkspace(JSON.stringify(stored))).toBeNull()
-    const ws = { ...defaultWorkspace(), tree: PAIR, focused: 'lambda-0', arrangements: { [treeKey(FOUR)]: FOUR } }
+    const ws = { ...defaultWorkspace(), focused: 'lambda-0', arrangements: { [treeKey(FOUR)]: FOUR } }
     expect(JSON.parse(serializeWorkspace(ws)).focused).toBe('tm-0')
   })
 })
```

- [ ] **Step 2: Run them, and see them fail**

`pnpm exec vitest run --project node tests/node/layout.test.ts tests/node/workspace.test.ts` (`t4-failing-node.log`): 2
files failed; 8 tests failed, 129 passed, of 137.

```
 FAIL  |node| tests/node/layout.test.ts > defaultLayout > is the source beside the TM view, and one above the other in a tall area
AssertionError: expected { kind: 'split', dir: 'column', …(2) } to deeply equal { kind: 'split', dir: 'row', …(2) }
 FAIL  |node| tests/node/workspace.test.ts > defaultFocus > is the first λ or TM leaf, and the source leaf only when there is no other
AssertionError: expected 'lambda-0' to be 'tm-0' // Object.is equality
 FAIL  |node| tests/node/workspace.test.ts > parseWorkspace > round-trips version 2
AssertionError: expected null to deeply equal { tree: { kind: 'split', …(3) }, …(8) }
 FAIL  |node| tests/node/workspace.test.ts > defaultWorkspace > is the source beside the TM view, Explorer, speed 8, focused on the TM view, nothing remembered
AssertionError: expected [ 'source', 'lambda-0', 'asm-0', …(1) ] to deeply equal [ 'source', 'tm-0' ]
 FAIL  |node| tests/node/workspace.test.ts > the remembered arrangements > writes no field while nothing is remembered, and the trees by key once something is
AssertionError: expected null to deeply equal { tree: { kind: 'split', …(3) }, …(8) }
 FAIL  |node| tests/node/workspace.test.ts > the remembered arrangements > takes a tree under its own combination’s key
AssertionError: expected undefined to deeply equal { Object (source+tm) }
 FAIL  |node| tests/node/workspace.test.ts > the remembered arrangements > keeps the panel state and the display of a view only a remembered tree holds, and refuses one no tree holds
AssertionError: expected undefined to deeply equal { 'lambda-0': { map: false } }
 FAIL  |node| tests/node/workspace.test.ts > the remembered arrangements > holds the focus to the tree on screen: a view only a remembered tree holds is refused, and not written
AssertionError: expected 'lambda-0' to be 'tm-0' // Object.is equality
```

**`defaultWorkspace > puts the two views one above the other for a tall area` passed before the source change.** It
asserts `defaultWorkspace('tall').tree` equals `defaultLayout('tall')`, and with the argument ignored both are the same
four views.

The whole browser suite, `pnpm exec vitest run --project browser` (`t4-failing-browser.log`): 8 files failed, 169 passed,
of 177; 12 tests failed, 1206 passed, of 1218. Every failing file is one this task changed or added.

```
 FAIL  |browser (chromium)| tests/browser/app-header.test.ts > the app header > resets the preset: the default views back, and says so
Error: timed out after 10000ms waiting for the default views
 FAIL  |browser (chromium)| tests/browser/first-load-views-tall.test.ts > a first load, in a window taller than it is wide > puts the source above the TM view, each the full width
AssertionError: the two views do not share a left edge: expected 213 to be less than 1
 FAIL  |browser (chromium)| tests/browser/first-load-views.test.ts > a first load, in a window wider than it is tall > starts from nothing stored: the precondition every case below rests on
AssertionError: the stored tree is not the first-load tree: expected { kind: 'split', dir: 'column', …(2) } to deeply equal { kind: 'split', dir: 'row', …(2) }
 FAIL  |browser (chromium)| tests/browser/first-load.test.ts > a first visit > opens on sum_to(5) under binary, in Explorer
AssertionError: expected [ 'source', 'lambda-0', 'asm-0', …(1) ] to deeply equal [ 'source', 'tm-0' ]
 FAIL  |browser (chromium)| tests/browser/reset-preset-copies.test.ts > reset preset > puts every view back on the program, and says so truly
AssertionError: expected [ 'source', 'lambda-0', 'asm-0', …(1) ] to deeply equal [ 'source', 'tm-0' ]
 FAIL  |browser (chromium)| tests/browser/view-toggles.test.ts > the views toggles > forgets every arrangement on reset preset, and is back on the source beside the TM view
AssertionError: expected [ 'source', 'lambda-0', 'asm-0', …(1) ] to deeply equal [ 'source', 'tm-0' ]
 FAIL  |browser (chromium)| tests/browser/workspace-bound.test.ts > a stored layout with 65 leaves > loads the default views instead
AssertionError: expected [ 'source', 'lambda-0', 'asm-0', …(1) ] to deeply equal [ 'source', 'tm-0' ]
 FAIL  |browser (chromium)| tests/browser/workspace-restore.test.ts > a restored workspace > does not give a re-minted view the panel state of the one that closed
AssertionError: the reset kept the asm view: expected <section class="pane" …(3)>…(2)</section> to be null
```

Per file: `app-header` 1 failed of 8; `first-load-views-tall` 1 of 2; `first-load-views` 5 of 5; `first-load` 1 of 4;
`reset-preset-copies` 1 of 2; `view-toggles` 1 of 12; `workspace-bound` 1 of 1; `workspace-restore` 1 of 8.

**The other 26 browser test files this task changes passed before the source change.** Read in
`git diff 43d9a16 6c49ef5`, every line they add either names one of the harness's fixtures (`fourViews()`,
`fourViewWorkspace()`, `storeFourViews()`, `resetToFourViews()`, `showFourViews()`), is an import or an `await` that
goes with one, or is a comment. While the default is still four views those fixtures spell the page the file had.

- [ ] **Step 3: Write the source**

In `web/src/editor-custody.ts`:

```diff
--- a/web/src/editor-custody.ts
+++ b/web/src/editor-custody.ts
@@ -170,9 +170,9 @@ export function createEditorCustody(deps: {
    * session. Keying by the closed leaf would be keying by something no claim ever mentions.
    *
    * **A LEAF ID IS A WEAKER KEY THAN A SESSION, NOT MERELY A DIFFERENTLY-SHAPED ONE.** `nextLeafId`
-   * only counts up, but it is not the only source of ids: `defaultLayout()` writes `source`, `lambda-0`,
-   * `asm-0` and `tm-0` down as literals and `reset preset` re-mints all four, so a closed `lambda-0` comes
-   * back — and `parseLayout` can restore any id a stored tree holds. A leaf id can therefore be
+   * only counts up, but it is not the only source of ids: `layout.ts`'s `defaultArrangement` writes `source`,
+   * `lambda-0`, `asm-0` and `tm-0` down as literals, and `reset preset` and a combination's first visit mint
+   * them again, so a closed `lambda-0` comes back — and `parseLayout` can restore any id a stored tree holds. A leaf id can therefore be
    * inherited by a pane that has nothing to do with the one that claimed the editor. `applyLayout`'s
    * pane-creation loop drops exactly that inheritance for `editorOwner` (which IS keyed by leaf) where
    * it happens.
@@ -271,8 +271,8 @@ export function createEditorCustody(deps: {
    * about an editor with nowhere to be, so it iterates `heldEditors`. A single loop over
    * `editorOwner.keys()` would make this function's opening sentence — a claim about EVERY editor —
    * false of any held editor whose session holds no claim, and that is not a hypothetical state:
-   * `applyLayout`'s pane-creation loop DROPS the claim recorded against an arriving leaf id, and `reset
-   * preset` re-mints `defaultLayout()`'s literal ids, so dropping it is exactly what `reset preset` does
+   * `applyLayout`'s pane-creation loop DROPS the claim recorded against an arriving leaf id, and a default
+   * arrangement re-mints its literal ids, so dropping it is exactly what `reset preset` and a views toggle do
    * after a close. `tests/browser/two-lambda-panes.test.ts` is the test that reaches that state, and it
    * has to concatenate two sequences because neither reaches it alone.
    *
```

In `web/src/layout.ts`:

```diff
--- a/web/src/layout.ts
+++ b/web/src/layout.ts
@@ -99,7 +99,7 @@ export const MIN_PANE_FRACTION = 0.1
  * gesture through. A source leaf that came back under a fresh id would be a different leaf as far as
  * every one of those is concerned — an empty pane beside a detached editor.
  *
- * EXPORTED NOW THAT A SECOND MODULE MINTS ONE. It was a literal in `defaultLayout()` below and three
+ * EXPORTED NOW THAT A SECOND MODULE MINTS ONE. It was a literal in the default tree below and three
  * more in `main.ts` while the only source leaf was the one a fresh page shipped; `pane-host.ts`'s split
  * handler creating one through the picker is what made "the id is the same id" a claim two files have to
  * agree on rather than a spelling.
@@ -194,43 +194,18 @@ export function defaultArrangement(kinds: readonly PaneKind[], shape: Shape): La
 }
 
 /**
- * The arrangement a first load and `reset preset` build, as a tree — design §4.1.
+ * The arrangement a first load and `reset preset` build: the source beside the TM view (the user's decision,
+ * 2026-10-11; the view layouts spec §8). It is `defaultArrangement` of those two kinds, so the two cannot disagree.
  *
- * **SOURCE AND λ ABOVE, ASM AND TM BELOW** (Plan 7 part 5 spec §3, row 4, and amendment 12): two rows of two, the
- * program's two lowerings side by side under the program and its λ term. It was source and λ above TM alone until the
- * asm view existed. The shape comes entirely from this tree's nesting and its `sizes`, which `layout-view.ts` turns into
- * each host's `flex-grow`; nothing in `style.css` names it.
+ * **IT WAS ALL FOUR VIEWS** — source and λ above, asm and TM below — until the header's `views` toggles could show any
+ * combination; all four are `defaultArrangement(KIND_ORDER, …)` now, in the same corners.
  *
- * **λ STAYS THE FIRST VIEW LEAF**, so a first load still focuses it: `workspace.ts`'s `defaultFocus` takes the first
- * leaf that is not the source. **A STORED LAYOUT IS NOT MIGRATED** — it is still valid, keeps its arrangement, and
- * reaches the asm view through `+ view`, a split or a view's title (spec §3), so `LAYOUT_VERSION` does not move.
+ * **THE TM VIEW IS THE FIRST VIEW LEAF**, so a first load focuses it: `workspace.ts`'s `defaultFocus` takes the first
+ * leaf that is not the source. **A STORED LAYOUT IS NOT MIGRATED** — it is still valid and keeps its arrangement, so
+ * `LAYOUT_VERSION` does not move.
  */
-export function defaultLayout(): LayoutNode {
-  return {
-    kind: 'split',
-    dir: 'column',
-    sizes: [0.5, 0.5],
-    children: [
-      {
-        kind: 'split',
-        dir: 'row',
-        sizes: [0.5, 0.5],
-        children: [
-          { kind: 'leaf', id: SOURCE_LEAF, pane: 'source' },
-          { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
-        ],
-      },
-      {
-        kind: 'split',
-        dir: 'row',
-        sizes: [0.5, 0.5],
-        children: [
-          { kind: 'leaf', id: 'asm-0', pane: 'asm' },
-          { kind: 'leaf', id: 'tm-0', pane: 'tm' },
-        ],
-      },
-    ],
-  }
+export function defaultLayout(shape: Shape = 'wide'): LayoutNode {
+  return defaultArrangement(['source', 'tm'], shape)
 }
 
 /** Every leaf, left to right, depth first — the order panes are created and tab order follows. */
@@ -504,8 +479,8 @@ export const LAYOUT_VERSION = 1
 export const SIZE_EPSILON = 1e-6
 
 /**
- * The most splits a tree may have on any path from its root to a leaf; `defaultLayout()` has 2 (Plan 7 part 6a spec
- * §5.3, amended 2026-10-01).
+ * The most splits a tree may have on any path from its root to a leaf; all four views' default arrangement has 2
+ * (Plan 7 part 6a spec §5.3, amended 2026-10-01).
  *
  * **WHAT IT BOUNDS IS THE READING, NOT WHICH TREES PARSE.** A split has two children or more, so a tree 64 splits deep
  * has at least 65 leaves and `MAX_TREE_LEAVES` refuses it anyway. But `validate` reads a split's first child whole
@@ -519,7 +494,7 @@ export const SIZE_EPSILON = 1e-6
 const MAX_TREE_DEPTH = 64
 
 /**
- * The most leaves a tree may have; `defaultLayout()` has 4 (spec §5.3, amended 2026-10-01).
+ * The most leaves a tree may have; all four views' default arrangement has 4 (spec §5.3, amended 2026-10-01).
  *
  * **A LINK BROUGHT TREES THE STORE NEVER HAD.** A link of 2,034 characters held 400 λ views, which took 4.4 s to open
  * and were stored, so every later load built them again.
```

In `web/src/main.ts`:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -130,8 +130,8 @@ import {
  * The counter behind every `LeafId` a split mints, shared across every leg — module-level rather than
  * per call to `main()`, though `main()` only ever runs once (`ready` below is computed on import).
  *
- * STARTS AT 1 ONLY FOR THE TREE A FRESH PAGE SHIPS, whose leaves are already `lambda-0`, `asm-0` and `tm-0`.
- * **REASONING ONLY ABOUT `defaultLayout()` COSTS THE FIRST SPLIT AFTER EVERY RELOAD**: `main()` restores a
+ * STARTS AT 1 ONLY FOR THE TREES A DEFAULT ARRANGEMENT BUILDS, whose leaves are `lambda-0`, `asm-0` and `tm-0`.
+ * **REASONING ONLY ABOUT THOSE COSTS THE FIRST SPLIT AFTER EVERY RELOAD**: `main()` restores a
  * tree from `localStorage` when there is one, that tree can already contain `pane-1` from a split in an
  * earlier page load, and `splitLeaf`'s collision guard then refuses the id `nextLeafId` mints — an uncaught
  * throw out of the click handler, no new pane, and nothing on screen to say why. `seedLeafCounter` below is
@@ -181,8 +181,8 @@ function seedLeafCounter(ids: Iterable<LeafId>): void {
  * `LeafId` already declares the id opaque ("a leaf's stable identity"), so the prefix was a convenience rather
  * than a fact, and a pane that can change leg is what falsifies it.
  *
- * `defaultLayout()`'s LITERAL `lambda-0` / `asm-0` / `tm-0` ARE LEFT ALONE, for three reasons and none of them
- * is inertia: browser tests select on them, `reset preset`'s re-minting of exactly those ids is what
+ * `layout.ts`'s `defaultArrangement`'s LITERAL `lambda-0` / `asm-0` / `tm-0` ARE LEFT ALONE, for three reasons and
+ * none of them is inertia: browser tests select on them, a default's re-minting of exactly those ids is what
  * `applyLayout`'s claim-dropping line reasons about, and `seedLeafCounter` reads the digits after the
  * last `-` and does not care which word precedes them. `dataset.kind` is the truthful statement of
  * what a leaf renders.
@@ -1266,7 +1266,7 @@ async function main(): Promise<EditorView> {
    * measured each time a default is built and never stored, since the tree it gave is.
    */
   const viewsShape = () => shapeOf(root.getBoundingClientRect())
-  const storedWorkspace = parseWorkspace(readLayoutStorage()) ?? defaultWorkspace()
+  const storedWorkspace = parseWorkspace(readLayoutStorage()) ?? defaultWorkspace(viewsShape())
   /**
    * THE WORKSPACE — a link's where one opens whole (Plan 7 part 6a spec §5.3), otherwise restored from `localStorage`
    * if there is a usable value there (a version 1 layout is migrated: `workspace.ts`'s `parseWorkspace`), the default
@@ -1343,7 +1343,7 @@ async function main(): Promise<EditorView> {
    * view that is not on screen. A view a remembered arrangement holds is live and keeps both (the view layouts spec
    * §5.1).
    *
-   * **`defaultLayout()` RE-MINTS `source`, `lambda-0`, `asm-0` AND `tm-0` AS LITERALS**, so a leaf id genuinely
+   * **A DEFAULT ARRANGEMENT RE-MINTS `source`, `lambda-0`, `asm-0` AND `tm-0` AS LITERALS**, so a leaf id genuinely
    * comes back: close the TM view with its rules panel shut, then *reset preset*, and the new `tm-0`
    * would inherit the closed view's panel state — from memory, since the write had already dropped it.
    * The same clicks then behaved differently depending on whether the page had been reloaded in
@@ -1763,7 +1763,7 @@ async function main(): Promise<EditorView> {
     const preset = presetOf(ws.switches) ?? 'explorer'
     // **EVERY REMEMBERED ARRANGEMENT GOES WITH IT** (the view layouts spec §4.6): the default views are back, and a
     // toggle pressed next shows that combination's default, not what it was left as.
-    tree = defaultLayout()
+    tree = defaultLayout(viewsShape())
     ws = { ...ws, switches: PRESETS[preset], arrangements: {} }
     // **THE FOCUS GOES INTO THE NEW ARRANGEMENT — whole-branch review follow-up, the sibling search
     // C1's fix asked for.** `hidePopover()` above hands focus back to whatever held it before the menu
@@ -1785,7 +1785,7 @@ async function main(): Promise<EditorView> {
     // `defaultFocus` rather than `focusedLeaf()` because the leaf the user was in may not exist in
     // `defaultLayout()`'s tree at all.
     //
-    // **`resetViews`, WHICH IS `focusView` IN THAT ORDER, AND MORE — THE NOTICE IS WHY.** `defaultLayout()` re-mints the
+    // **`resetViews`, WHICH IS `focusView` IN THAT ORDER, AND MORE — THE NOTICE IS WHY.** `defaultLayout()` re-mints
     // leaf ids a view on a copy may already hold, and `applyLayout` keeps a pane whose id and kind survive — so views
     // stayed on their copies while the notice said the default views were back. `resetViews` rebuilds each of them on
     // the program, as a fresh preset's views are; the copies themselves stay in the copies menu.
@@ -2839,7 +2839,7 @@ async function main(): Promise<EditorView> {
   }
 
   // THE FIRST RECONCILE, REPLACING THE BARE `draw()` THIS USED TO BE. `applyLayout()` builds the
-  // lambda-0/asm-0/tm-0 panes the default tree names, attaches every host (including `sourceHost`, built
+  // panes the tree in force names, attaches every host (including `sourceHost`, built
   // above) into `<main>`, persists the tree, and calls `draw()` itself at its own end — so this is
   // still "one call, at the very end of `main()`, after everything else is wired" (`view` included:
   // `linkWiring`/`draw`/`compile`/`replies` all close over it as a thunk; `draw()`'s own body reads
```

In `web/src/pane-host.ts`:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -713,8 +713,8 @@ export function createPaneHost(deps: {
      * seeded into `hosts` under `'source'` before `applyLayout` ever ran (`seedHost`). A
      * `pane-${n}` leaf would therefore have come back as an EMPTY pane while the user's program sat in a
      * detached host nothing could reach again — `hostFor`'s detach-not-destroy rule kept for a key nobody
-     * would ask for. The id is a constant everywhere else for the same reason (`defaultLayout()`'s
-     * literal, `main.ts`'s close handler, `seedHost`'s key), so this is that constant being honoured
+     * would ask for. The id is a constant everywhere else for the same reason (a default arrangement's
+     * leaf, `main.ts`'s close handler, `seedHost`'s key), so this is that constant being honoured
      * rather than a new one invented here. `splitLeaf` refuses a `newId` already in the tree, and
      * `sourceAvailable` — the condition the menu offers this choice under — is exactly "no source leaf in
      * the tree", so the two agree by construction.
@@ -1166,8 +1166,8 @@ export function createPaneHost(deps: {
    *
    * A NEW LEAF'S SESSION COMES FROM `pendingBinding`, NOT ALWAYS `SOURCE_SESSION` — see that map's own
    * doc. Consulted and cleared in the same pass. The clearing is belt-and-braces, and what makes a stale
-   * entry unreachable is timing rather than uniqueness: `reset preset` re-mints `defaultLayout()`'s four
-   * literal ids, so an id genuinely can arrive here having been used before (`heldEditors` has the
+   * entry unreachable is timing rather than uniqueness: `reset preset` and a views toggle re-mint a default
+   * arrangement's literal ids, so an id genuinely can arrive here having been used before (`heldEditors` has the
    * correction in full), and all three writers (`splitRow`, `splitColumn`, and `rebind`'s cross-leg arm)
    * write the entry and call `applyLayout` in the next statement, so every entry is consumed by the pass
    * that follows the write. The clearing is what keeps that a local fact instead of an invariant a
@@ -1334,8 +1334,8 @@ export function createPaneHost(deps: {
       if (l.pane === 'source') continue // the source pane is chrome inside its host, not a PaneView
       // A LEAF ID ARRIVING FRESH DROPS ANY EDITOR CLAIM RECORDED AGAINST IT — Minor finding, re-review
       // of the whole-branch review's own custody fix, and the behaviour half of the correction
-      // `heldEditors`' doc carries above. `reset preset` re-mints `defaultLayout()`'s four LITERAL ids,
-      // so a closed `lambda-0` genuinely does come back, and `editorOwner` was still naming it: the
+      // `heldEditors`' doc carries above. A default arrangement re-mints its LITERAL ids at `reset preset` and at a
+      // views toggle, so a closed `lambda-0` genuinely does come back, and `editorOwner` was still naming it: the
       // moment the user pointed the NEW `lambda-0` at the scratch, `editorHomeFor` resolved it as the
       // editor's home and the next layout gesture delivered the held editor onto a pane that never asked
       // for it — while the "move the editor here" control withdrew itself as it arrived.
```

In `web/src/workspace.ts`:

```diff
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -1,5 +1,5 @@
 import { type Arrangements, liveLeaves, parseKey, treeKey } from './arrangements'
-import { defaultLayout, type LayoutNode, leaves, MAX_TREE_LEAVES, parseTree, SOURCE_LEAF } from './layout'
+import { defaultLayout, type LayoutNode, leaves, MAX_TREE_LEAVES, parseTree, type Shape, SOURCE_LEAF } from './layout'
 import type { LeafId } from './panes'
 
 /**
@@ -127,8 +127,13 @@ export function defaultFocus(tree: LayoutNode): LeafId {
   return (all.find((l) => l.pane !== 'source') ?? all[0])?.id ?? SOURCE_LEAF
 }
 
-export function defaultWorkspace(): Workspace {
-  const tree = defaultLayout()
+/**
+ * The workspace a fresh page opens on. `shape` is the views area's, which decides whether the first load's two views
+ * sit side by side or one above the other (`layout.ts`'s `defaultArrangement`); a caller with no area to measure
+ * leaves it `wide`.
+ */
+export function defaultWorkspace(shape: Shape = 'wide'): Workspace {
+  const tree = defaultLayout(shape)
   return {
     tree,
     switches: PRESETS.explorer,
```

- [ ] **Step 4: Run them, and see them pass**

The same node command (`t4-passing-node.log`): 2 files passed, 137 tests passed.
`pnpm exec vitest run --project browser` on the 34 browser test files this task changes or adds
(`t4-passing-browser.log`, the files in `t4-browser-files.txt`): 34 files passed, 208 tests passed.

- [ ] **Step 5: Break it on purpose, once a sabotage, and put it back**

Each entry is the replay's own record. Its `sab.sh` saved the file, made the edit, ran
`pnpm exec vitest run --project <project> <file>` for each file named, copied the saved file back and ran `cmp`.

Every one fired, and every file was restored with cmp equal.

**S4a** `src/layout.ts`, `defaultLayout`: `return defaultArrangement(['source', 'tm'], shape)` becomes
`return defaultArrangement(KIND_ORDER, shape)`.
`sab.sh S4a node:tests/node/layout.test.ts browser:tests/browser/first-load-views.test.ts`.
Node: 1 failed, 94 passed, of 95:

```
 FAIL  |node| tests/node/layout.test.ts > defaultLayout > is the source beside the TM view, and one above the other in a tall area
AssertionError: expected { kind: 'split', dir: 'row', …(2) } to deeply equal { kind: 'split', dir: 'row', …(2) }
```

Browser: 5 failed of 5:

```
 … > starts from nothing stored: the precondition every case below rests on
AssertionError: the stored tree is not the first-load tree: expected { kind: 'split', dir: 'row', …(2) } to deeply equal { kind: 'split', dir: 'row', …(2) }
 … > shows the source and the TM view and no other
AssertionError: expected [ 'source', 'asm-0', 'lambda-0', …(1) ] to deeply equal [ 'source', 'tm-0' ]
 … > puts them side by side, a half each
AssertionError: the two views do not share a top edge: expected 416.75 to be less than 1
 … > presses the source and TM toggles and leaves λ and asm unpressed
AssertionError: expected [ 'source', 'asm', 'lambda', 'tm' ] to deeply equal [ 'source', 'tm' ]
 … > focuses the TM view, and remembers no other arrangement
AssertionError: expected 'asm-0' to be 'tm-0' // Object.is equality
```

Restored `src/layout.ts`, cmp equal.

The edit:

```diff
--- a/web/src/layout.ts
+++ b/web/src/layout.ts
@@ -205,7 +205,7 @@
  * `LAYOUT_VERSION` does not move.
  */
 export function defaultLayout(shape: Shape = 'wide'): LayoutNode {
-  return defaultArrangement(['source', 'tm'], shape)
+  return defaultArrangement(KIND_ORDER, shape)
 }
 
 /** Every leaf, left to right, depth first — the order panes are created and tab order follows. */
```

**S4b** `src/main.ts`: `defaultWorkspace(viewsShape())` becomes `defaultWorkspace()`.
`sab.sh S4b browser:tests/browser/first-load-views-tall.test.ts`: 1 failed, 1 passed, of 2.

```
 FAIL  |browser (chromium)| tests/browser/first-load-views-tall.test.ts > a first load, in a window taller than it is wide > puts the source above the TM view, each the full width
AssertionError: the two views do not share a left edge: expected 213 to be less than 1
```

Restored `src/main.ts`, cmp equal.

The edit:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1266,7 +1266,7 @@
    * measured each time a default is built and never stored, since the tree it gave is.
    */
   const viewsShape = () => shapeOf(root.getBoundingClientRect())
-  const storedWorkspace = parseWorkspace(readLayoutStorage()) ?? defaultWorkspace(viewsShape())
+  const storedWorkspace = parseWorkspace(readLayoutStorage()) ?? defaultWorkspace()
   /**
    * THE WORKSPACE — a link's where one opens whole (Plan 7 part 6a spec §5.3), otherwise restored from `localStorage`
    * if there is a usable value there (a version 1 layout is migrated: `workspace.ts`'s `parseWorkspace`), the default
```

**S4c** `src/main.ts`, the reset-preset handler: `ws = { ...ws, switches: PRESETS[preset], arrangements: {} }` becomes
`ws = { ...ws, switches: PRESETS[preset] }`.
`sab.sh S4c browser:tests/browser/view-toggles.test.ts`: 1 failed, 11 passed, of 12: the last case, as expected.

```
 FAIL  |browser (chromium)| tests/browser/view-toggles.test.ts > the views toggles > forgets every arrangement on reset preset, and is back on the source beside the TM view
AssertionError: expected { 'source+lambda+asm': { …(4) }, …(4) } to be undefined
```

Restored `src/main.ts`, cmp equal.

The edit:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1764,7 +1764,7 @@
     // **EVERY REMEMBERED ARRANGEMENT GOES WITH IT** (the view layouts spec §4.6): the default views are back, and a
     // toggle pressed next shows that combination's default, not what it was left as.
     tree = defaultLayout(viewsShape())
-    ws = { ...ws, switches: PRESETS[preset], arrangements: {} }
+    ws = { ...ws, switches: PRESETS[preset] }
     // **THE FOCUS GOES INTO THE NEW ARRANGEMENT — whole-branch review follow-up, the sibling search
     // C1's fix asked for.** `hidePopover()` above hands focus back to whatever held it before the menu
     // opened, which for a user reaching this item is a control inside one of the views. Rebuilding the
```

**S4d** `tests/browser/setup.ts`: the line `shim.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(fourViewWorkspace()))`
commented out. `sab.sh S4d browser:ALL`, the whole browser suite once (`sab-S4d-browser.log`, 230.83 s):

| | failed | passed | skipped | of |
|---|---|---|---|---|
| files | 60 | 117 | | 177 |
| tests | 193 | 863 | 162 | 1218 |

Restored `tests/browser/setup.ts`, cmp equal, and `diff` against the target's `setup.ts` is empty.

The edit:

```diff
--- a/web/tests/browser/setup.ts
+++ b/web/tests/browser/setup.ts
@@ -132,4 +132,4 @@
  * the start a visitor gets. The files that assert on the default itself — what *reset preset* restores, what a
  * fresh workspace holds — were read and rewritten against the new default when this was added.
  */
-shim.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(fourViewWorkspace()))
+// shim.setItem(LAYOUT_STORAGE_KEY, serializeWorkspace(fourViewWorkspace()))
```

- [ ] **Step 6: The whole suite**

`pnpm exec biome ci --error-on-warnings`, `pnpm exec tsc --noEmit -p .`, `pnpm exec vitest run --project node` and
`pnpm exec vitest run --project browser`, all from `web/`. On the replay, after this task:

| Check | Result |
|---|---|
| `biome ci --error-on-warnings` | exit 0, checked 373 files, 1 info |
| `tsc --noEmit -p .` | exit 0 |
| node | 68 files, 1301 tests, all passed |
| browser | 177 files, 1218 tests, all passed |

- [ ] **Step 7: Commit**

```bash
git add web/src/editor-custody.ts \
  web/src/layout.ts \
  web/src/main.ts \
  web/src/pane-host.ts \
  web/src/workspace.ts \
  web/tests/browser/active-pane.test.ts \
  web/tests/browser/add-view-floor.test.ts \
  web/tests/browser/app-header.test.ts \
  web/tests/browser/asm-copy-restore.test.ts \
  web/tests/browser/buffer-restore-invalid.test.ts \
  web/tests/browser/buffer-restore.test.ts \
  web/tests/browser/divider-drag.test.ts \
  web/tests/browser/first-load-views-tall.test.ts \
  web/tests/browser/first-load-views.test.ts \
  web/tests/browser/first-load.test.ts \
  web/tests/browser/harness.ts \
  web/tests/browser/lambda-display-restore.test.ts \
  web/tests/browser/layout-restore.test.ts \
  web/tests/browser/menu-focus.test.ts \
  web/tests/browser/pane-kind-switch.test.ts \
  web/tests/browser/pane-picker.test.ts \
  web/tests/browser/program-blocked.test.ts \
  web/tests/browser/readout-history-held.test.ts \
  web/tests/browser/reset-preset-copies.test.ts \
  web/tests/browser/scratch-buffers.test.ts \
  web/tests/browser/setup.ts \
  web/tests/browser/share-open-cap.test.ts \
  web/tests/browser/share-open-editor.test.ts \
  web/tests/browser/share-open-hashchange.test.ts \
  web/tests/browser/share-open-start-clamp.test.ts \
  web/tests/browser/share-open.test.ts \
  web/tests/browser/share-positions.test.ts \
  web/tests/browser/share-through-open.test.ts \
  web/tests/browser/storage-blocked.test.ts \
  web/tests/browser/tm-buffer-restore.test.ts \
  web/tests/browser/tm-display-restore.test.ts \
  web/tests/browser/tm-view-narrow.test.ts \
  web/tests/browser/two-lambda-panes.test.ts \
  web/tests/browser/view-toggles.test.ts \
  web/tests/browser/workspace-bound.test.ts \
  web/tests/browser/workspace-restore.test.ts \
  web/tests/node/layout.test.ts \
  web/tests/node/workspace.test.ts
git commit -F - <<'EOF'
A fresh page opens on the source beside the TM view, with the focus on the TM view: side by side in a wide window and the source above in a tall one, and reset preset goes back to it; the browser tests keep starting on all four views, from a workspace setup.ts stores for every file
EOF
```

### Task 5: View keys

`Ctrl+.` and then one key, from anywhere on the page (spec §7): `]` and `[` step through the cycle, `1` to `4` toggle
a kind, `Escape` leaves. `view-keys.ts` holds the machine as a value and the one listener that feeds it, in the capture
phase on `window`, so it runs ahead of an editor's keymap and of the vim extension. The help page lists the keys, and a
test holds its table to the machine's.

**Files:**
- Modify: `web/help.html`
- Modify: `web/index.html`
- Modify: `web/src/main.ts`
- Modify: `web/src/style.css`
- Create: `web/src/view-keys.ts`
- Modify: `web/tests/browser/harness.ts`
- Create: `web/tests/browser/view-keys.test.ts`
- Modify: `web/tests/node/pages.test.ts`
- Create: `web/tests/node/view-keys.test.ts`

**Interfaces:**
- Consumes: Task 3's `switchTo`, `toggled`, `cycleFrom`, `combinationOf`, `KIND_WORD`, `HEADER_ORDER`, and
  `PaneHost.switchViews`, which is what leaves the caret in the editor a key was pressed from.
- Produces, in `web/src/view-keys.ts`: `type KeyPress`, `type ViewKeyAction`, `PREFIX`, `PREFIX_LABEL`, `VIEW_KEYS`,
  `step(armed: boolean, press: KeyPress): Step`, `wireViewKeys(target, { act, armed, blocked })`. The third pull
  request adds the move keys to `VIEW_KEYS` and `ViewKeyAction`.
- Produces, in the markup: `#view-keys`, the hint.

- [ ] **Step 1: Write the tests**

In `web/tests/browser/harness.ts`:

```diff
--- a/web/tests/browser/harness.ts
+++ b/web/tests/browser/harness.ts
@@ -73,6 +73,7 @@ export const SHELL = `
   </header>
   <div id="notice" class="notice" hidden></div>
   <div id="live" class="visually-hidden" role="status"></div>
+  <div id="view-keys" class="view-keys" hidden></div>
   <main>
     <div id="views"></div>
     <aside id="inspector" class="inspector" hidden></aside>
```

Create `web/tests/browser/view-keys.test.ts`:

```ts
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * VIEW KEYS, THROUGH THE PAGE — the view layouts spec §7: the prefix chord arms a mode from wherever the focus is, the
 * next key acts and the mode is over, and a key the mode does not know is the editor's as it always was.
 * `tests/node/view-keys.test.ts` holds the machine's table; this file holds the one listener that feeds it, which is
 * where an editor's keymap and the vim extension could take a key first.
 *
 * **KEYS ARRIVE THROUGH `userEvent`**, for `vim-keymap.test.ts`'s reason: half of what is asserted is that a key DID
 * or DID NOT type a character, and a synthetic `keydown` types nothing whatever the page does with it.
 *
 * **EVERY CASE STARTS FROM ALL FOUR VIEWS WITH THE CARET IN THE SOURCE EDITOR**, which `start` puts back and asserts,
 * so a case run alone fails on its precondition and not on another case's leavings.
 */

const PREFIX = '{Control>}.{/Control}'
/** `[`, as `userEvent.keyboard` spells it: a single `[` opens a key code, as in `[KeyA]`. */
const PREVIOUS = '[['
const SOURCE = 'let x = 40;\nx + 2'

let view: EditorView

const hint = (): HTMLElement => document.querySelector('#view-keys') as HTMLElement
const armed = (): boolean => !hint().hidden
const live = (): string => (document.querySelector('#live')?.textContent ?? '').trim()
const notice = (): string => (document.querySelector('#notice .notice-text')?.textContent ?? '').trim()
const mounted = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('#views [data-leaf]')]
    .filter((el) => el.getAttribute('role') !== 'tab')
    .map((el) => el.dataset.leaf as string)
const host = (leaf: string): HTMLElement => document.querySelector(`#views [data-leaf="${leaf}"]`) as HTMLElement
const idle = (): boolean => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

/** All four views, the program as this file wrote it, and the caret at the start of the source editor. */
async function start(): Promise<void> {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views-shown button[aria-pressed="false"]')) b.click()
  if (view.state.doc.toString() !== SOURCE) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SOURCE } })
    await until(idle, 'the program to compile again')
  }
  view.focus()
  view.dispatch({ selection: { anchor: 0 } })
  await until(() => view.hasFocus, 'the source editor to take the focus')
  expect(mounted(), 'precondition: all four views').toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
  expect(armed(), 'precondition: the mode is not armed').toBe(false)
}

const setKeymap = (mode: 'default' | 'vim'): void => {
  const choice = document.querySelector<HTMLSelectElement>('#keymap') as HTMLSelectElement
  choice.value = mode
  choice.dispatchEvent(new Event('change'))
}

describe('view keys', () => {
  beforeAll(async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: SOURCE } })
    await until(() => idle() && (document.querySelector('#results')?.textContent ?? '').includes('λ 42'), 'the compile')
  })

  it('arms on the prefix from the source editor, shows the keys, and leaves on Escape without a mark', async () => {
    await start()
    await userEvent.keyboard(PREFIX)
    expect(armed(), 'the prefix did not arm the mode').toBe(true)
    expect(live()).toBe('view keys')
    expect([...hint().querySelectorAll('kbd')].map((k) => k.textContent)).toEqual([']', '[', '1', '2', '3', '4', 'Esc'])
    await userEvent.keyboard('{Escape}')
    expect(armed()).toBe(false)
    expect(view.state.doc.toString(), 'the prefix or Escape typed something').toBe(SOURCE)
    expect(view.hasFocus, 'the editor lost the focus').toBe(true)
    expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
  })

  it('goes to the next layout on ] and the previous on [, with the caret still in the editor', async () => {
    await start()
    await userEvent.keyboard(PREFIX)
    await userEvent.keyboard(']')
    // ALL FOUR IS THE CYCLE'S LAST STOP, SO THE NEXT IS ITS FIRST: the source beside asm, the header's second toggle.
    expect(mounted()).toEqual(['source', 'asm-0'])
    expect(armed(), 'the mode stayed armed after its one action').toBe(false)
    expect(live()).toBe('showing source and asm')
    expect(view.state.doc.toString(), 'the ] was typed').toBe(SOURCE)
    expect(view.hasFocus, 'the switch took the focus out of the editor').toBe(true)
    await userEvent.keyboard(PREFIX)
    await userEvent.keyboard(']')
    expect(mounted()).toEqual(['source', 'lambda-0'])
    await userEvent.keyboard(PREFIX)
    await userEvent.keyboard(PREVIOUS)
    await userEvent.keyboard(PREFIX)
    await userEvent.keyboard(PREVIOUS)
    expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
    expect(view.hasFocus).toBe(true)
  })

  /**
   * THE NATURAL MOTION, AND THE ONE THAT FOUND THE DEFECT (the user's report, 2026-10-11): `Ctrl` held down through
   * both keys. With `n` for the next layout that was `Ctrl+N`, which the browser keeps and opens a window on.
   */
  it('answers the second key with Ctrl still held', async () => {
    await start()
    await userEvent.keyboard('{Control>}.]{/Control}')
    expect(mounted(), 'Ctrl held through ] did not go to the next layout').toEqual(['source', 'asm-0'])
    expect(armed()).toBe(false)
    await userEvent.keyboard('{Control>}.4{/Control}')
    expect(mounted(), 'Ctrl held through 4 did not show the TM view').toEqual(['source', 'asm-0', 'tm-0'])
    expect(view.state.doc.toString(), 'a key was typed').toBe(SOURCE)
  })

  it('toggles the four kinds on 1 to 4, in the header’s order', async () => {
    await start()
    for (const [key, without] of [
      ['2', ['source', 'lambda-0', 'tm-0']],
      ['3', ['source', 'asm-0', 'tm-0']],
      ['4', ['source', 'lambda-0', 'asm-0']],
    ] as const) {
      await userEvent.keyboard(PREFIX)
      await userEvent.keyboard(key)
      expect(mounted(), `after ${key}`).toEqual(without)
      await userEvent.keyboard(PREFIX)
      await userEvent.keyboard(key)
      expect(mounted(), `after ${key} again`).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
    }
    expect(view.state.doc.toString(), 'a digit was typed').toBe(SOURCE)
  })

  it('hands the focus to the focused view when the key hides the view that held it', async () => {
    await start()
    await userEvent.keyboard(PREFIX)
    await userEvent.keyboard('1')
    expect(mounted()).toEqual(['lambda-0', 'asm-0', 'tm-0'])
    expect(document.activeElement, 'the focus fell to <body>').not.toBe(document.body)
    expect(
      document.querySelector('#views')?.contains(document.activeElement),
      'the focus is not in a view on the page',
    ).toBe(true)
    await userEvent.keyboard(PREFIX)
    await userEvent.keyboard('1')
    expect(mounted()).toContain('source')
    expect(view.state.doc.toString(), 'the source editor lost its text while it was off the page').toBe(SOURCE)
  })

  it('ends on a key it does not know, which types as it always did', async () => {
    await start()
    await userEvent.keyboard(PREFIX)
    await userEvent.keyboard('x')
    expect(armed()).toBe(false)
    expect(view.state.doc.toString(), 'the key after the prefix did not reach the editor').toBe(`x${SOURCE}`)
    expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0'])
  })

  it('is over after one action: the next 3 is the editor’s', async () => {
    await start()
    await userEvent.keyboard(PREFIX)
    await userEvent.keyboard('4')
    await userEvent.keyboard('3')
    expect(view.state.doc.toString(), 'a second key was taken as an action').toBe(`3${SOURCE}`)
    expect(mounted()).toEqual(['source', 'lambda-0', 'asm-0'])
  })

  it('says why on the notice line when the key is for the only view shown', async () => {
    await start()
    for (const key of ['2', '3', '4']) {
      await userEvent.keyboard(PREFIX)
      await userEvent.keyboard(key)
    }
    expect(mounted()).toEqual(['source'])
    await userEvent.keyboard(PREFIX)
    await userEvent.keyboard('1')
    expect(mounted(), 'the last view was hidden').toEqual(['source'])
    expect(notice()).toBe('the source view is the only one shown — one view stays')
  })

  it('ends on a pointer press', async () => {
    await start()
    await userEvent.keyboard(PREFIX)
    expect(armed()).toBe(true)
    await userEvent.click(document.querySelector('.wordmark') as HTMLElement)
    expect(armed(), 'a pointer press left the mode armed').toBe(false)
  })

  it('is not armed while a modal dialog is open', async () => {
    await start()
    await userEvent.click(document.querySelector('#settings') as HTMLElement)
    await userEvent.click(document.querySelector('#import-base16') as HTMLElement)
    await until(() => document.querySelector('dialog:modal') !== null, 'the import dialog')
    await userEvent.keyboard(PREFIX)
    expect(armed(), 'the prefix armed the mode under a modal dialog').toBe(false)
    await userEvent.keyboard('{Escape}')
    await until(() => document.querySelector('dialog:modal') === null, 'the dialog to close')
  })

  /**
   * THE VIM EXTENSION'S `keydown` HANDLER RUNS AHEAD OF EVERY KEYMAP (`editor-keymap.ts`), and in normal mode a digit
   * is a count for the command after it: `2x` deletes two characters. So `2` after the prefix, then `x`, deleting ONE
   * character says the mode took the `2` and vim never saw it, and that `x`, which the mode does not know when it
   * follows a prefix, still reached vim.
   */
  it('runs ahead of vim: 2 after the prefix is the mode’s and no count of vim’s, and x after a prefix is vim’s', async () => {
    await start()
    setKeymap('vim')
    try {
      await until(() => view.scrollDOM.classList.contains('cm-vimMode'), 'vim’s normal mode')
      view.focus()
      await until(() => view.hasFocus, 'the source editor to take the focus')
      await userEvent.keyboard(PREFIX)
      expect(armed(), 'the prefix did not arm the mode under vim').toBe(true)
      await userEvent.keyboard('2')
      expect(mounted(), '2 did not hide the asm view').toEqual(['source', 'lambda-0', 'tm-0'])
      await userEvent.keyboard('x')
      expect(view.state.doc.toString(), 'vim took the 2 as a count, or did not get the x').toBe(SOURCE.slice(1))
      await userEvent.keyboard(PREFIX)
      await userEvent.keyboard('x')
      expect(view.state.doc.toString(), 'x after the prefix did not reach vim').toBe(SOURCE.slice(2))
    } finally {
      setKeymap('default')
    }
  })

  /** Spec §7.2's other two editors: a copy's own, on each kind of leg that has one of its own class. */
  it.each([
    ['a λ copy', 'lambda-0', '.term-editor'],
    ['a machine copy', 'tm-0', '.cm-editor'],
  ])('arms from the editor of %s', async (_what, leaf, editor) => {
    await start()
    const more = host(leaf).querySelector('button.view-more') as HTMLElement
    await userEvent.click(more)
    const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement
    await until(() => menu.matches(':popover-open'), 'the view’s menu')
    await userEvent.click(menu.querySelector('button.detach') as HTMLElement)
    await until(() => host(leaf).querySelector(editor) !== null, 'the copy’s editor')
    const copy = EditorView.findFromDOM(host(leaf).querySelector(editor) as HTMLElement) as EditorView
    copy.focus()
    await until(() => copy.hasFocus, 'the copy’s editor to take the focus')
    const text = copy.state.doc.toString()
    await userEvent.keyboard(PREFIX)
    expect(armed(), 'the prefix did not arm the mode from the copy’s editor').toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(armed()).toBe(false)
    expect(copy.state.doc.toString(), 'the prefix or Escape changed the copy').toBe(text)
    expect(copy.hasFocus).toBe(true)
  })
})
```

In `web/tests/node/pages.test.ts`:

```diff
--- a/web/tests/node/pages.test.ts
+++ b/web/tests/node/pages.test.ts
@@ -4,6 +4,7 @@ import { fileURLToPath } from 'node:url'
 import { describe, expect, it } from 'vitest'
 import { LINK_KEY } from '../../src/link-wiring'
 import { navKeymap } from '../../src/lsp-nav'
+import { PREFIX, PREFIX_LABEL, VIEW_KEYS } from '../../src/view-keys'
 
 const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
 
@@ -65,6 +66,26 @@ describe('the help page', () => {
   })
 })
 
+describe('the help page’s view keys', () => {
+  /**
+   * **THE TABLE IS `view-keys.ts`'s OWN**: every key an armed machine answers, with the words the page's hint gives
+   * it, in the hint's order. A key added to the machine without a row, a row left behind, or a row whose words have
+   * drifted from the hint's, fails here.
+   */
+  it('lists exactly the keys the machine answers, each with the hint’s words', () => {
+    const table = /<table id="view-keys">([\s\S]*?)<\/table>/.exec(html('help'))?.[1] ?? ''
+    const rows = [...table.matchAll(/<tr data-key="([^"]+)"><td><kbd>([^<]+)<\/kbd><\/td><td>([^<]+)<\/td><\/tr>/g)]
+    expect(rows.map(([, key, shown, does]) => [key, shown, does])).toEqual(VIEW_KEYS.map((r) => [r.key, r.key, r.does]))
+  })
+
+  it('names the prefix as the machine has it', () => {
+    const says = /<p id="view-keys-prefix">([\s\S]*?)<\/p>/.exec(html('help'))?.[1] ?? ''
+    const shown = [...(says.split(' and then')[0] ?? '').matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]).join('+')
+    expect(shown).toBe(PREFIX_LABEL)
+    expect(PREFIX_LABEL).toBe(`${PREFIX.ctrl ? 'Ctrl+' : ''}${PREFIX.key}`)
+  })
+})
+
 describe('the privacy page', () => {
   /**
    * Every `.ts` file under `src/`, read from disk so a file not yet added to git is read too, with its comments
```

Create `web/tests/node/view-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HEADER_ORDER } from '../../src/layout'
import { type KeyPress, PREFIX, step, VIEW_KEYS } from '../../src/view-keys'

/**
 * THE VIEW KEYS' MACHINE, AS A VALUE — the view layouts spec §7.3: every row of `step`'s table. The listener that
 * feeds it is `tests/browser/view-keys.test.ts`'s.
 */

const key = (k: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  key: k,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...mods,
})

describe('idle', () => {
  it('is armed by the prefix, which it consumes', () => {
    expect(step(false, PREFIX)).toEqual({ armed: true, consume: true, action: null })
  })

  it.each([
    ['the prefix’s key with no modifier', key('.')],
    ['the prefix with Shift too', key('.', { ctrl: true, shift: true })],
    ['the prefix with Alt too', key('.', { ctrl: true, alt: true })],
    ['a key the armed table names', key(']')],
    ['Escape', key('Escape')],
    ['Control alone', key('Control', { ctrl: true })],
  ])('leaves %s alone', (_what, press) => {
    expect(step(false, press)).toEqual({ armed: false, consume: false, action: null })
  })
})

describe('armed', () => {
  it('answers every key of its table with that key’s action, consumed, and is idle after', () => {
    for (const row of VIEW_KEYS)
      expect(step(true, key(row.key)), row.key).toEqual({ armed: false, consume: true, action: row.action })
  })

  it('cycles on ] and [, and toggles the four kinds on 1 to 4 in the header order', () => {
    expect(step(true, key(']')).action).toEqual({ kind: 'cycle', step: 1 })
    expect(step(true, key('[')).action).toEqual({ kind: 'cycle', step: -1 })
    expect(['1', '2', '3', '4'].map((k) => step(true, key(k)).action)).toEqual(
      HEADER_ORDER.map((pane) => ({ kind: 'toggle', pane })),
    )
    expect(step(true, key('2')).action).toEqual({ kind: 'toggle', pane: 'asm' })
  })

  /**
   * THE PREFIX'S OWN MODIFIER MAY STILL BE DOWN (the user's report, 2026-10-11): holding `Ctrl` through the second
   * key is the natural motion, so a table key answers with it held as without.
   */
  it('answers every key of its table with Ctrl still held, as without', () => {
    for (const row of VIEW_KEYS)
      expect(step(true, key(row.key, { ctrl: true })), row.key).toEqual({
        armed: false,
        consume: true,
        action: row.action,
      })
  })

  it('leaves on Escape and on the prefix again, consuming both and doing nothing', () => {
    expect(step(true, key('Escape'))).toEqual({ armed: false, consume: true, action: null })
    expect(step(true, PREFIX)).toEqual({ armed: false, consume: true, action: null })
  })

  it.each([
    ['a key the table does not name', key('x')],
    ['a move key, which the second pull request adds', key('j')],
    ['a table key with Alt down', key('1', { alt: true })],
    ['a table key with Meta down', key(']', { meta: true })],
    ['n, which was a cycle key until Ctrl+N opened a window', key('n')],
    ['Ctrl+N itself, which the browser keeps', key('n', { ctrl: true })],
    ['Enter', key('Enter')],
  ])('ends on %s and leaves the press for whatever is under the focus', (_what, press) => {
    expect(step(true, press)).toEqual({ armed: false, consume: false, action: null })
  })

  it.each(['Control', 'Shift', 'Alt', 'Meta'])('stays armed through %s pressed alone', (modifier) => {
    expect(step(true, key(modifier))).toEqual({ armed: true, consume: false, action: null })
  })
})

describe('the table', () => {
  it('names each key once', () => {
    expect(new Set(VIEW_KEYS.map((r) => r.key)).size).toBe(VIEW_KEYS.length)
    expect(VIEW_KEYS.map((r) => r.key)).toEqual([']', '[', '1', '2', '3', '4'])
  })
})
```

- [ ] **Step 2: Run them, and see them fail**

`pnpm exec vitest run --project node tests/node/view-keys.test.ts tests/node/pages.test.ts` (`t5-failing-node.log`): 2
files failed, neither loaded, no tests ran.

```
 FAIL  |node| tests/node/pages.test.ts [ tests/node/pages.test.ts ]
Error: Cannot find module '../../src/view-keys' imported from /home/davey/temp/redextape-view-layouts-work/web/tests/node/pages.test.ts
 FAIL  |node| tests/node/view-keys.test.ts [ tests/node/view-keys.test.ts ]
Error: Cannot find module '../../src/view-keys' imported from /home/davey/temp/redextape-view-layouts-work/web/tests/node/view-keys.test.ts
```

`pnpm exec vitest run --project browser tests/browser/view-keys.test.ts` (`t5-failing-browser.log`): 1 file failed; 11
tests failed, 2 passed, of 13. The first:

```
 FAIL  |browser (chromium)| tests/browser/view-keys.test.ts > view keys > arms on the prefix from the source editor, shows the keys, and leaves on Escape without a mark
AssertionError: the prefix did not arm the mode: expected false to be true // Object.is equality
```

**Two cases passed before the source change**, the two the log does not mark failed: `ends on a key it does not know,
which types as it always did` and `is not armed while a modal dialog is open`. What each asserts is that the mode is not
armed, and the first that the `x` reached the editor and the four views are still there; with no listener all of that
holds.

- [ ] **Step 3: Write the source**

In `web/help.html`:

```diff
--- a/web/help.html
+++ b/web/help.html
@@ -36,6 +36,12 @@
           Click a token in the source, a λ token, an assembly instruction or a machine rule, and the other views show
           the same point of the program.
         </li>
+        <li>
+          The <strong>views</strong> buttons in the header choose which views are shown: <strong>source</strong>,
+          <strong>asm</strong>, <strong>λ</strong> and <strong>TM</strong>. Each combination of them keeps its own
+          arrangement, so views come back where they were left. A window 40rem wide or narrower has no room for the
+          buttons; a view's <strong>✕</strong>, <strong>+ view</strong> and the view keys below do the same there.
+        </li>
         <li>
           A view's <strong>⋯</strong> menu has <strong>edit a copy</strong>: the term, the machine or the assembly as
           text you can change and run on its own. <strong>copies ▾</strong> lists them.
@@ -64,6 +70,30 @@
         is the editor's default keymap, or vim's when <strong>settings</strong> sets the keymap to vim.
       </p>
 
+      <h2>View keys</h2>
+      <p id="view-keys-prefix">
+        Press <kbd>Ctrl</kbd>+<kbd>.</kbd> and then one of these keys, from anywhere on the page, an editor included.
+        <kbd>Ctrl</kbd> may stay held for the second key or not. The key after the prefix acts once; any other key is
+        typed as usual, and <kbd>Esc</kbd> leaves without doing anything.
+      </p>
+      <table id="view-keys">
+        <thead>
+          <tr><th scope="col">Key</th><th scope="col">Does</th></tr>
+        </thead>
+        <tbody>
+          <tr data-key="]"><td><kbd>]</kbd></td><td>the next layout</td></tr>
+          <tr data-key="["><td><kbd>[</kbd></td><td>the previous layout</td></tr>
+          <tr data-key="1"><td><kbd>1</kbd></td><td>show or hide source</td></tr>
+          <tr data-key="2"><td><kbd>2</kbd></td><td>show or hide asm</td></tr>
+          <tr data-key="3"><td><kbd>3</kbd></td><td>show or hide λ</td></tr>
+          <tr data-key="4"><td><kbd>4</kbd></td><td>show or hide TM</td></tr>
+        </tbody>
+      </table>
+      <p>
+        The layouts <kbd>]</kbd> and <kbd>[</kbd> step through are the source beside asm, the source beside λ, the
+        source beside TM, and all four.
+      </p>
+
       <h2>Keys in the views</h2>
       <table>
         <thead>
```

In `web/index.html`:

```diff
--- a/web/index.html
+++ b/web/index.html
@@ -59,6 +59,7 @@
     </header>
     <div id="notice" class="notice" hidden></div>
     <div id="live" class="visually-hidden" role="status"></div>
+    <div id="view-keys" class="view-keys" hidden></div>
     <main>
       <div id="views"></div>
       <aside id="inspector" class="inspector" hidden></aside>
```

In `web/src/main.ts`:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -20,7 +20,7 @@ import {
   readStored,
   STORAGE_KEY,
 } from './appearance'
-import { type Combination, combinationOf, enter, keyOf, liveLeaves, shapeOf, toggled } from './arrangements'
+import { type Combination, combinationOf, cycleFrom, enter, keyOf, liveLeaves, shapeOf, toggled } from './arrangements'
 import type { AsmPane } from './asm-pane'
 import { showBanner } from './banner'
 import { schemeName } from './base16'
@@ -52,6 +52,7 @@ import {
   closeLeaf,
   defaultArrangement,
   defaultLayout,
+  KIND_WORD,
   LAYOUT_STORAGE_KEY,
   type LayoutNode,
   leafNumber,
@@ -108,6 +109,7 @@ import type { AsmState, LambdaState, TmState } from './types'
 import { assertTokenClasses } from './types'
 import { createUnsaved, type Refusal, refusalOf } from './unsaved'
 import { pairLabel, sourceViewHeader, viewMenu } from './view-header'
+import { PREFIX_LABEL, VIEW_KEYS, type ViewKeyAction, wireViewKeys } from './view-keys'
 import {
   defaultFocus,
   defaultWorkspace,
@@ -252,6 +254,7 @@ async function main(): Promise<EditorView> {
   const noticeHost = document.querySelector<HTMLElement>('#notice')
   const liveHost = document.querySelector<HTMLElement>('#live')
   const viewsShown = document.querySelector<HTMLElement>('#views-shown')
+  const viewKeysHint = document.querySelector<HTMLElement>('#view-keys')
   // **`#views`, NOT `<main>` — spec §9.** `renderLayout` opens with `root.replaceChildren()`, so the
   // layout tree needed a root of its own the moment the inspector column came to live in `<main>` beside
   // it: an inspector directly under `<main>` would be destroyed on the first layout commit.
@@ -291,6 +294,7 @@ async function main(): Promise<EditorView> {
     !strip ||
     !liveHost ||
     !viewsShown ||
+    !viewKeysHint ||
     !root
   ) {
     throw new Error('the page is missing a mount point')
@@ -1665,6 +1669,47 @@ async function main(): Promise<EditorView> {
   narrowWindow.addEventListener('change', placeToggles)
   placeToggles()
 
+  /**
+   * VIEW KEYS — spec §7: the prefix, then one key. The hint is built once from `view-keys.ts`'s own table, so what it
+   * lists is what the machine answers.
+   *
+   * **A TOGGLE KEY FOR THE ONLY VIEW SHOWN SAYS WHY NOTHING HAPPENED**, on the notice line, where the header's button
+   * for it is disabled with the same words in its tooltip.
+   */
+  const hintTitle = document.createElement('span')
+  hintTitle.className = 'view-keys-title'
+  hintTitle.textContent = 'view keys'
+  const hintRow = (key: string, does: string): HTMLElement => {
+    const row = document.createElement('span')
+    const kbd = document.createElement('kbd')
+    kbd.textContent = key
+    row.append(kbd, ` ${does}`)
+    return row
+  }
+  viewKeysHint.replaceChildren(
+    hintTitle,
+    ...VIEW_KEYS.map((row) => hintRow(row.key, row.does)),
+    hintRow('Esc', `or ${PREFIX_LABEL} leave`),
+  )
+  const actOnViewKey = (action: ViewKeyAction): void => {
+    const shown = combinationOf(tree)
+    if (action.kind === 'cycle') {
+      switchTo(cycleFrom(shown, action.step))
+      return
+    }
+    const next = toggled(shown, action.pane)
+    if (next.length === 0) notices.notify(`the ${KIND_WORD[action.pane]} view is the only one shown — one view stays`)
+    else switchTo(next)
+  }
+  wireViewKeys(window, {
+    act: actOnViewKey,
+    armed: (now) => {
+      viewKeysHint.hidden = !now
+      if (now) notices.announce('view keys')
+    },
+    blocked: () => document.querySelector('dialog:modal') !== null,
+  })
+
   /**
    * A view's title, in the title-selector's own spelling — the bar's prefix (spec §8) and, from part 2b's
    * Stage task, a tab's label (§5).
```

In `web/src/style.css`:

```diff
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -1851,6 +1851,42 @@ main {
   color: inherit;
   cursor: pointer;
 }
+/* THE VIEW KEYS' HINT (the view layouts spec §7.3): what the next key does, shown while the prefix has armed the
+   mode and at no other time. It floats over the foot of the page and takes no room in it, so arming the mode moves
+   nothing a reader is looking at; and it takes no pointer, since a pointer press ends the mode. */
+.view-keys {
+  position: fixed;
+  inset-block-end: var(--space-3);
+  inset-inline: 0;
+  margin-inline: auto;
+  width: fit-content;
+  max-width: calc(100vw - 2rem);
+  display: flex;
+  flex-wrap: wrap;
+  gap: var(--space-1) var(--space-3);
+  padding: var(--space-2) var(--space-3);
+  border: 1px solid var(--fg-dim);
+  border-radius: var(--radius);
+  background: var(--bg-raised);
+  color: var(--fg);
+  font-size: var(--step--1);
+  pointer-events: none;
+  z-index: 10;
+}
+.view-keys[hidden] {
+  display: none;
+}
+.view-keys-title {
+  font-weight: 600;
+}
+.view-keys kbd {
+  font: inherit;
+  font-family: var(--font-mono);
+  padding: 0 0.35em;
+  border: 1px solid var(--fg-dim);
+  border-radius: var(--radius);
+}
+
 /* Present to a screen reader, absent from the page — the standard clip pattern. */
 .visually-hidden {
   position: absolute;
```

Create `web/src/view-keys.ts`:

```ts
import { HEADER_ORDER, KIND_WORD } from './layout'
import type { PaneKind } from './panes'

/**
 * VIEW KEYS — the view layouts spec §7: a prefix chord, then one key, and the app's first keys that are not an
 * editor's or a focused control's.
 *
 * **ONE ACTION A PREFIX, AND THE REASON.** A mode that stayed armed would take the next `]` or `j` meant for the editor
 * under the focus, and under the vim keymap those are the keys a user presses next. So the key after the prefix acts
 * and the machine is idle again; a key it does not know ends the mode and is handled as if it had never been armed.
 *
 * **THE KEY AFTER THE PREFIX ACTS WHETHER OR NOT `Ctrl` IS STILL DOWN, AND NONE OF THEM IS A KEY THE BROWSER KEEPS
 * UNDER `Ctrl`** (the user's report, 2026-10-11). Holding the prefix's modifier through the second key is the natural
 * motion, and the cycle keys were `n` and `p`: `Ctrl+N` opened a new window, which no page can stop, and `Ctrl+P`
 * printed. They are `]` and `[` now.
 *
 * `step` is the machine and has no DOM in it. `wireViewKeys` is the one listener that feeds it.
 */

/** A key press as the machine reads it: `KeyboardEvent.key`, and which modifiers are down. */
export type KeyPress = {
  readonly key: string
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
}

/** What an armed key asks the app to do. */
export type ViewKeyAction =
  | { readonly kind: 'cycle'; readonly step: 1 | -1 }
  | { readonly kind: 'toggle'; readonly pane: PaneKind }

/** The prefix chord: `Ctrl` and `.` alone (spec §7.2). */
export const PREFIX: KeyPress = { key: '.', ctrl: true, alt: false, shift: false, meta: false }

/** How the prefix is written for a reader: in the hint, and in the help page's table. */
export const PREFIX_LABEL = 'Ctrl+.'

/**
 * The keys an armed machine answers, in the order the hint and the help page list them: the key, what it does, and
 * the words for it. `Escape` and the prefix pressed again leave and do nothing; they are `step`'s, not rows here.
 *
 * **THE TOGGLE KEYS ARE `HEADER_ORDER`'s POSITIONS**, `1` to `4`, so the keys and the header's buttons cannot be in
 * two orders.
 */
export const VIEW_KEYS: readonly { readonly key: string; readonly action: ViewKeyAction; readonly does: string }[] = [
  { key: ']', action: { kind: 'cycle', step: 1 }, does: 'the next layout' },
  { key: '[', action: { kind: 'cycle', step: -1 }, does: 'the previous layout' },
  ...HEADER_ORDER.map((pane, i) => ({
    key: String(i + 1),
    action: { kind: 'toggle', pane } as const,
    does: `show or hide ${KIND_WORD[pane]}`,
  })),
]

/** The keys a modifier makes on its own; one pressed while the machine is armed is not the key it waits for. */
const MODIFIERS: ReadonlySet<string> = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])

/** A press an armed machine may answer: no `Alt` and no `Meta`. `Ctrl`, the prefix's own modifier, may still be down. */
const bare = (p: KeyPress): boolean => !p.alt && !p.meta
const isPrefix = (p: KeyPress): boolean =>
  p.key === PREFIX.key &&
  p.ctrl === PREFIX.ctrl &&
  p.alt === PREFIX.alt &&
  p.shift === PREFIX.shift &&
  p.meta === PREFIX.meta

/** What a key press does to the machine: whether it is armed after, whether the press is the machine's, and the action. */
export type Step = { readonly armed: boolean; readonly consume: boolean; readonly action: ViewKeyAction | null }

/**
 * Feed one key press to the machine.
 *
 * | state | press | after | consumed | action |
 * | --- | --- | --- | --- | --- |
 * | idle | the prefix | armed | yes | none |
 * | idle | anything else | idle | no | none |
 * | armed | a modifier alone | armed | no | none |
 * | armed | a key of `VIEW_KEYS`, no `Alt` or `Meta` down, `Ctrl` held or not | idle | yes | its action |
 * | armed | `Escape`, or the prefix again | idle | yes | none |
 * | armed | anything else | idle | no | none |
 *
 * **A PRESS THAT IS NOT CONSUMED IS NOT TOUCHED**: the listener lets it go on to the editor or control under the
 * focus, so a key the machine does not know types what it always typed.
 */
export function step(armed: boolean, press: KeyPress): Step {
  if (!armed) return { armed: isPrefix(press), consume: isPrefix(press), action: null }
  if (MODIFIERS.has(press.key)) return { armed: true, consume: false, action: null }
  if (isPrefix(press) || (press.key === 'Escape' && bare(press))) return { armed: false, consume: true, action: null }
  const row = bare(press) ? VIEW_KEYS.find((r) => r.key === press.key) : undefined
  if (row === undefined) return { armed: false, consume: false, action: null }
  return { armed: false, consume: true, action: row.action }
}

/**
 * Listen for view keys on `target`, in the capture phase: before an editor's keymap, and before the vim extension's
 * own `keydown` handler, which `editor-keymap.ts` records as running ahead of every keymap.
 *
 * - `act` is handed each action; `armed` is told each time the mode is entered or left, for the hint and the live
 *   region.
 * - `blocked` is asked before the prefix is taken: while it answers true (a modal dialog is open) the machine stays
 *   idle and the press is not touched.
 * - A press that is part of a composition is not a key press to the machine.
 * - A pointer press, or the window losing the focus, ends an armed mode. Nothing ends it on a timer.
 */
export function wireViewKeys(
  target: Window,
  on: { act(action: ViewKeyAction): void; armed(now: boolean): void; blocked(): boolean },
): void {
  let armed = false
  const set = (next: boolean): void => {
    if (next === armed) return
    armed = next
    on.armed(armed)
  }
  target.addEventListener(
    'keydown',
    (e) => {
      if (e.isComposing) return
      if (!armed && on.blocked()) return
      const next = step(armed, { key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey })
      if (next.consume) {
        e.preventDefault()
        e.stopPropagation()
      }
      set(next.armed)
      if (next.action !== null) on.act(next.action)
    },
    { capture: true },
  )
  target.addEventListener('pointerdown', () => set(false), { capture: true })
  target.addEventListener('blur', () => set(false))
}
```

- [ ] **Step 4: Run them, and see them pass**

The same node command (`t5-passing-node.log`): 2 files passed, 37 tests passed.
The same browser command (`t5-passing-browser.log`): 1 file passed, 13 tests passed.

- [ ] **Step 5: Break it on purpose, once a sabotage, and put it back**

Each entry is the replay's own record. Its `sab.sh` saved the file, made the edit, ran
`pnpm exec vitest run --project <project> <file>` for each file named, copied the saved file back and ran `cmp`.

Every one made its named case fail, and every file was restored with cmp equal. **S5b's named case failed on a
precondition and not on its own assertion**; see it below.

**S5a** `src/view-keys.ts`, `wireViewKeys`: the keydown listener's `{ capture: true }` becomes `{ capture: false }`.
`sab.sh S5a browser:tests/browser/view-keys.test.ts`: 4 failed, 9 passed, of 13.

```
 … > answers the second key with Ctrl still held
AssertionError: a key was typed: expected '  let x = 40;\nx + 2' to be 'let x = 40;\nx + 2' // Object.is equality
 … > runs ahead of vim: 2 after the prefix is the mode’s and no count of vim’s, and x after a prefix is vim’s
AssertionError: 2 did not hide the asm view: expected [ 'source', 'lambda-0', 'asm-0', …(1) ] to deeply equal [ 'source', 'lambda-0', 'tm-0' ]
 … > arms from the editor of a λ copy
 … > arms from the editor of a machine copy
AssertionError: precondition: the mode is not armed: expected true to be false // Object.is equality
```

Restored `src/view-keys.ts`, cmp equal.

The edit:

```diff
--- a/web/src/view-keys.ts
+++ b/web/src/view-keys.ts
@@ -127,7 +127,7 @@
       set(next.armed)
       if (next.action !== null) on.act(next.action)
     },
-    { capture: true },
+    { capture: false },
   )
   target.addEventListener('pointerdown', () => set(false), { capture: true })
   target.addEventListener('blur', () => set(false))
```

**S5b** `src/view-keys.ts`, `step`: its last line `return { armed: false, consume: true, action: row.action }` becomes
`return { armed: true, consume: true, action: row.action }`.
`sab.sh S5b node:tests/node/view-keys.test.ts browser:tests/browser/view-keys.test.ts`.
Node: 2 failed, 21 passed, of 23:

```
 FAIL  |node| tests/node/view-keys.test.ts > armed > answers every key of its table with that key’s action, consumed, and is idle after
AssertionError: ]: expected { armed: true, consume: true, …(1) } to deeply equal { armed: false, consume: true, …(1) }
 FAIL  |node| tests/node/view-keys.test.ts > armed > answers every key of its table with Ctrl still held, as without
AssertionError: ]: expected { armed: true, consume: true, …(1) } to deeply equal { armed: false, consume: true, …(1) }
```

Browser: 12 failed, 1 passed, of 13. The second case in the file failed on an assertion of its own, and each of the
eleven after it, `is over after one action` among them, failed on `precondition: the mode is not armed`:

```
 FAIL  |browser (chromium)| tests/browser/view-keys.test.ts > view keys > goes to the next layout on ] and the previous on [, with the caret still in the editor
AssertionError: the mode stayed armed after its one action: expected true to be false // Object.is equality
 FAIL  |browser (chromium)| tests/browser/view-keys.test.ts > view keys > is over after one action: the next 3 is the editor’s
AssertionError: precondition: the mode is not armed: expected true to be false // Object.is equality
```

So in the file's own run the expected case fails, but its own assertion is not what fails. One more run, outside the
brief, to see that assertion: the same edit, and
`pnpm exec vitest run --project browser tests/browser/view-keys.test.ts -t "is over after one action"`
(`sab-S5b-alone-browser.log`): 1 failed, 12 skipped, of 13.

```
 FAIL  |browser (chromium)| tests/browser/view-keys.test.ts > view keys > is over after one action: the next 3 is the editor’s
AssertionError: a second key was taken as an action: expected 'let x = 40;\nx + 2' to be '3let x = 40;\nx + 2' // Object.is equality
```

Restored `src/view-keys.ts`, cmp equal, after each of the two.

The edit:

```diff
--- a/web/src/view-keys.ts
+++ b/web/src/view-keys.ts
@@ -90,7 +90,7 @@
   if (isPrefix(press) || (press.key === 'Escape' && bare(press))) return { armed: false, consume: true, action: null }
   const row = bare(press) ? VIEW_KEYS.find((r) => r.key === press.key) : undefined
   if (row === undefined) return { armed: false, consume: false, action: null }
-  return { armed: false, consume: true, action: row.action }
+  return { armed: true, consume: true, action: row.action }
 }
 
 /**
```

**S5c** `src/view-keys.ts`: `const bare = (p: KeyPress): boolean => !p.alt && !p.meta` becomes
`const bare = (p: KeyPress): boolean => !p.ctrl && !p.alt && !p.meta`.
`sab.sh S5c node:tests/node/view-keys.test.ts browser:tests/browser/view-keys.test.ts`.
Node: 1 failed, 22 passed, of 23:

```
 FAIL  |node| tests/node/view-keys.test.ts > armed > answers every key of its table with Ctrl still held, as without
AssertionError: ]: expected { armed: false, consume: false, …(1) } to deeply equal { armed: false, consume: true, …(1) }
```

Browser: 1 failed, 12 passed, of 13, as expected:

```
 FAIL  |browser (chromium)| tests/browser/view-keys.test.ts > view keys > answers the second key with Ctrl still held
AssertionError: Ctrl held through ] did not go to the next layout: expected [ 'source', 'lambda-0', 'asm-0', …(1) ] to deeply equal [ 'source', 'asm-0' ]
```

Restored `src/view-keys.ts`, cmp equal.

The edit:

```diff
--- a/web/src/view-keys.ts
+++ b/web/src/view-keys.ts
@@ -58,7 +58,7 @@
 const MODIFIERS: ReadonlySet<string> = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])
 
 /** A press an armed machine may answer: no `Alt` and no `Meta`. `Ctrl`, the prefix's own modifier, may still be down. */
-const bare = (p: KeyPress): boolean => !p.alt && !p.meta
+const bare = (p: KeyPress): boolean => !p.ctrl && !p.alt && !p.meta
 const isPrefix = (p: KeyPress): boolean =>
   p.key === PREFIX.key &&
   p.ctrl === PREFIX.ctrl &&
```

**S5d** `src/main.ts`: `blocked: () => document.querySelector('dialog:modal') !== null,` becomes `blocked: () => false,`.
`sab.sh S5d browser:tests/browser/view-keys.test.ts`: 4 failed, 9 passed, of 13. The expected case, and the three after
it, each timing out after 10 s `waiting for the source editor to take the focus`:

```
 FAIL  |browser (chromium)| tests/browser/view-keys.test.ts > view keys > is not armed while a modal dialog is open
AssertionError: the prefix armed the mode under a modal dialog: expected true to be false // Object.is equality
 … > runs ahead of vim: 2 after the prefix is the mode’s and no count of vim’s, and x after a prefix is vim’s
Error: timed out after 10000ms waiting for the source editor to take the focus
 … > arms from the editor of a λ copy
 … > arms from the editor of a machine copy
Error: timed out after 10000ms waiting for the source editor to take the focus
```

Restored `src/main.ts`, cmp equal.

The edit:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1707,7 +1707,7 @@
       viewKeysHint.hidden = !now
       if (now) notices.announce('view keys')
     },
-    blocked: () => document.querySelector('dialog:modal') !== null,
+    blocked: () => false,
   })
 
   /**
```

**S5e** `src/view-keys.ts`: the line `target.addEventListener('pointerdown', () => set(false), { capture: true })`
deleted. `sab.sh S5e browser:tests/browser/view-keys.test.ts`: 5 failed, 8 passed, of 13. The expected case, and the
four after it on their precondition:

```
 FAIL  |browser (chromium)| tests/browser/view-keys.test.ts > view keys > ends on a pointer press
AssertionError: a pointer press left the mode armed: expected true to be false // Object.is equality
 … > is not armed while a modal dialog is open
AssertionError: precondition: the mode is not armed: expected true to be false // Object.is equality
```

Restored `src/view-keys.ts`, cmp equal.

The edit:

```diff
--- a/web/src/view-keys.ts
+++ b/web/src/view-keys.ts
@@ -129,6 +129,5 @@
     },
     { capture: true },
   )
-  target.addEventListener('pointerdown', () => set(false), { capture: true })
   target.addEventListener('blur', () => set(false))
 }
```

**S5f** `src/pane-host.ts`, `switchViews`: its last two lines, `if (root.contains(within)) within.focus()` and
`else focusPane(id)`, become `if (!root.contains(within)) focusPane(id)`.
`sab.sh S5f browser:tests/browser/view-keys.test.ts`: 3 failed, 10 passed, of 13. The expected case, on the editor's
focus, and two more:

```
 FAIL  |browser (chromium)| tests/browser/view-keys.test.ts > view keys > goes to the next layout on ] and the previous on [, with the caret still in the editor
AssertionError: the switch took the focus out of the editor: expected false to be true // Object.is equality
 … > is over after one action: the next 3 is the editor’s
AssertionError: a second key was taken as an action: expected 'let x = 40;\nx + 2' to be '3let x = 40;\nx + 2' // Object.is equality
 … > runs ahead of vim: 2 after the prefix is the mode’s and no count of vim’s, and x after a prefix is vim’s
AssertionError: vim took the 2 as a count, or did not get the x: expected 'let x = 40;\nx + 2' to be 'et x = 40;\nx + 2' // Object.is equality
```

Restored `src/pane-host.ts`, cmp equal.

The edit:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1096,8 +1096,7 @@
     setFocused(id)
     applyLayout('none', true)
     if (within === null) return
-    if (root.contains(within)) within.focus()
-    else focusPane(id)
+    if (!root.contains(within)) focusPane(id)
   }
 
   /**
```

**S5g** `help.html`: the `data-key="2"` and `data-key="3"` rows of `#view-keys` swapped.
`sab.sh S5g node:tests/node/pages.test.ts`: 1 failed, 13 passed, of 14.

```
 FAIL  |node| tests/node/pages.test.ts > the help page’s view keys > lists exactly the keys the machine answers, each with the hint’s words
AssertionError: expected [ …(6) ] to deeply equal [ …(6) ]
```

Restored `help.html`, cmp equal.

The edit:

```diff
--- a/web/help.html
+++ b/web/help.html
@@ -84,8 +84,8 @@
           <tr data-key="]"><td><kbd>]</kbd></td><td>the next layout</td></tr>
           <tr data-key="["><td><kbd>[</kbd></td><td>the previous layout</td></tr>
           <tr data-key="1"><td><kbd>1</kbd></td><td>show or hide source</td></tr>
-          <tr data-key="2"><td><kbd>2</kbd></td><td>show or hide asm</td></tr>
           <tr data-key="3"><td><kbd>3</kbd></td><td>show or hide λ</td></tr>
+          <tr data-key="2"><td><kbd>2</kbd></td><td>show or hide asm</td></tr>
           <tr data-key="4"><td><kbd>4</kbd></td><td>show or hide TM</td></tr>
         </tbody>
       </table>
```

- [ ] **Step 6: The whole suite**

`pnpm exec biome ci --error-on-warnings`, `pnpm exec tsc --noEmit -p .`, `pnpm exec vitest run --project node` and
`pnpm exec vitest run --project browser`, all from `web/`. On the replay, after this task:

| Check | Result |
|---|---|
| `biome ci --error-on-warnings` | exit 0, checked 376 files, 1 info |
| `tsc --noEmit -p .` | exit 0 |
| node | 69 files, 1327 tests, all passed |
| browser | 178 files, 1231 tests, all passed |

- [ ] **Step 7: Commit**

```bash
git add web/help.html \
  web/index.html \
  web/src/main.ts \
  web/src/style.css \
  web/src/view-keys.ts \
  web/tests/browser/harness.ts \
  web/tests/browser/view-keys.test.ts \
  web/tests/node/pages.test.ts \
  web/tests/node/view-keys.test.ts
git commit -F - <<'EOF'
View keys: Ctrl+. and then one key, from anywhere on the page, an editor included: ] and [ step through the source beside asm, λ and TM and then all four, and 1 to 4 show or hide source, asm, λ and TM, with Ctrl still held or not; a hint lists the keys while the mode is armed, and the help page's table is held to the machine's
EOF
```

### Task 6: Verify the branch, measure, build the image, write the roadmap entry

No source changes. Every figure this task writes down names the command that produced it, and is taken on the branch
as it stands after Task 5, not copied from this plan.

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Every gate CI runs for these paths**

From `web/`: `pnpm exec biome ci --error-on-warnings`, `pnpm run typecheck`, `pnpm run test:coverage` (both projects
and the coverage floor), `pnpm run build:app`. From the root: each of `scripts/check-text-bytes.sh`,
`check-citations.sh`, `check-attributions.sh`, `check-doc-figures.sh`, `check-shared-docs.sh`, `check-colours.sh`,
`check-grammar-wasm.sh`, `check-lua.sh` and `check-licences.sh`, with `--self-test` and then alone. Every one passes.
A failure in a file this branch did not touch is checked against `main` before it is called a flake.

On the replay's last tree `pnpm run test:coverage` exited 0 in 55 s: 247 files and 2,558 tests, statements 97.52%,
branches 91.8%, functions 98.53%, lines 98.88%.

- [ ] **Step 2: Measure a switch**

Create `web/tests/browser/zz-probe-switch.test.ts`. It is a probe: run it, write its figures down, and delete it. It
is not committed.

```ts
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * PROBE, NOT KEPT: how long a switch between the source with TM and all four takes, on `map-fold`, the costliest
 * example the app ships — the view layouts spec §14's measurement for the roadmap entry. The time the two `keydown`s
 * take to handle, ten times each way, with two animation frames between one switch and the next.
 */
describe('probe: a switch between the source with TM and all four', () => {
  it('measures', async () => {
    await page.viewport(1280, 896)
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    const idle = (): boolean => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
    const results = (): string => document.querySelector('#results')?.textContent ?? ''
    await until(idle, 'the first compile')
    document.querySelector<HTMLButtonElement>('#examples')?.click()
    document.querySelector<HTMLButtonElement>('#examples-menu [data-example="map-fold"]')?.click()
    await until(() => idle() && results().includes('λ 9 · '), 'map-fold to run', 240_000)
    const mounted = (): number =>
      [...document.querySelectorAll('#views [data-leaf]')].filter((el) => el.getAttribute('role') !== 'tab').length
    const toggle = (kind: string): void =>
      document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`)?.click()
    const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))
    const key = (k: string, ctrlKey = false): void => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey, bubbles: true, cancelable: true }))
    }
    // THE SWITCH IS SYNCHRONOUS: the listener enters the tree, rebuilds the layout and draws before `dispatchEvent`
    // returns. So the time across the two dispatches is the switch, where a wait for a frame measures the frame.
    const timed = async (k: string, expected: number): Promise<number> => {
      const t = performance.now()
      key('.', true)
      key(k)
      const took = performance.now() - t
      expect(mounted(), `precondition: ${k} showed ${expected} views`).toBe(expected)
      await frame()
      await frame()
      return took
    }
    // THE SOURCE BESIDE TM FIRST, so both arrangements are remembered before anything is timed.
    toggle('asm')
    toggle('lambda')
    expect(mounted(), 'precondition: the source beside the TM view').toBe(2)
    const toFour: number[] = []
    const toTwo: number[] = []
    for (let i = 0; i < 10; i++) {
      toFour.push(await timed(']', 4))
      toTwo.push(await timed('[', 2))
    }
    const line = (name: string, ms: number[]): string => {
      const s = [...ms].sort((a, b) => a - b)
      return `PROBE ${name}: min ${s[0]?.toFixed(1)} median ${(((s[4] ?? 0) + (s[5] ?? 0)) / 2).toFixed(1)} max ${s[9]?.toFixed(1)} ms; first ${ms[0]?.toFixed(1)}`
    }
    console.error(line('to all four', toFour))
    console.error(line('to source+TM', toTwo))
    console.error(`PROBE results: ${results().slice(0, 120)}`)
  })
})
```

It prints on `console.error` because `console.log` does not reach the vitest log. Run it at full speed and at a
quarter of a core, from `web/`, with nothing else running a browser:

```bash
pnpm exec vitest run --project browser tests/browser/zz-probe-switch.test.ts 2>&1 | grep PROBE
systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 -p CPUQuota=25% \
  pnpm exec vitest run --project browser tests/browser/zz-probe-switch.test.ts 2>&1 | grep PROBE
rm tests/browser/zz-probe-switch.test.ts
```

On the replay's last tree, one run each on 2026-10-12, with `map-fold`'s TM history full at 69,008 steps:

| | to all four | to the source and TM |
|---|---|---|
| full speed | 8.4 to 11.8 ms, median 9.5 | 6.3 to 7.9 ms, median 7.5 |
| a quarter of a core | 8.7 to 298.4 ms, median 36.8 | 6.9 to 88.3 ms, median 66.6 |

Expect figures of that size, and write down the ones this run gives. **Do not time it to a frame**: a first version
of this probe waited two animation frames before it read the clock, and every figure it gave was 33.3 ms, two frames.

- [ ] **Step 3: Measure the header**

Create `web/tests/browser/zz-probe-header.test.ts`, run it, write its figures down, and delete it.

```ts
import { describe, it } from 'vitest'
import { page } from 'vitest/browser'
import { chooseStyle, SHELL, until } from './harness'

/** PROBE, NOT KEPT: what the header needs at 1280 px with the views toggles, in each style and preset (spec §6.1). */
describe('probe: the header with the views toggles', () => {
  it('measures', async () => {
    await page.viewport(1280, 800)
    document.body.innerHTML = SHELL
    await (await import('../../src/main')).ready
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
    const styles = [...(document.querySelector('#style') as HTMLSelectElement).options].map((o) => o.value)
    const pick = (sel: string): void => {
      document.querySelector<HTMLButtonElement>('#workspace')?.click()
      document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
      const m = document.querySelector<HTMLElement>('#workspace-menu')
      if (m?.matches(':popover-open')) m.hidePopover()
    }
    for (const style of styles) {
      await chooseStyle(style)
      for (const [name, sel] of [
        ['explorer', '[data-preset="explorer"]'],
        ['debugger', '[data-preset="debugger"]'],
        ['stage', '[data-preset="stage"]'],
        ['custom', '[data-switch="steps"][data-value="view"]'],
      ] as const) {
        pick(sel)
        await new Promise((r) => setTimeout(r, 30))
        const bar = document.querySelector('header.bar') as HTMLElement
        const kids = [...bar.children].filter(
          (c) => (c as HTMLElement).offsetWidth > 0 && !c.classList.contains('bar-spacer'),
        ) as HTMLElement[]
        const used = kids.reduce((a, k) => a + k.getBoundingClientRect().width, 0)
        const cs = getComputedStyle(bar)
        const need =
          used +
          kids.length * Number.parseFloat(cs.columnGap) +
          Number.parseFloat(cs.paddingLeft) +
          Number.parseFloat(cs.paddingRight)
        const toggles = (bar.querySelector('#views-shown') as HTMLElement).getBoundingClientRect().width
        console.error(
          `PROBE style=${style} preset=${name} bar.height=${bar.offsetHeight} needs=${need.toFixed(1)} of ${bar.clientWidth} toggles=${toggles.toFixed(1)}`,
        )
      }
    }
  })
})
```

```bash
pnpm exec vitest run --project browser tests/browser/zz-probe-header.test.ts 2>&1 | grep PROBE
rm tests/browser/zz-probe-header.test.ts
```

On the replay's last tree, on 2026-10-12, it printed:

| Style | Explorer | Debugger | Stage | custom | Header | Toggles |
|---|---|---|---|---|---|---|
| Paper | 1,246.1 | 1,258.1 | 1,226.9 | 1,239.3 | one row, 46 px | 147.5 px |
| Terminal | 1,342.1 | 1,342.1 | 1,315.1 | 1,324.1 | two rows, 91 px | 149.1 px |
| Instrument | 1,263.0 | 1,274.0 | 1,244.0 | 1,256.0 | one row, 46 px | 154.0 px |

Each figure is what the header needs, in px, of the 1,280 it has. `needs` counts a gap after every drawn child, so it
is the least width that keeps the row whole.

- [ ] **Step 4: Build and run the image, and look at it**

```bash
docker build --build-arg COMMIT_HASH="$(git rev-parse HEAD)" -t redextape-view-layouts .
docker run -d --rm --name redextape-view-layouts -p 55099:80 redextape-view-layouts
for p in / /help.html; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:55099$p")" "$p"
done
curl -s http://127.0.0.1:55099/ | grep -c 'id="views-shown"'
curl -s http://127.0.0.1:55099/ | grep -c 'id="view-keys"'
curl -s http://127.0.0.1:55099/help.html | grep -c '<table id="view-keys">'
```

Expected: `200` twice, then `1`, `1`, `1`. Then, before stopping it, open `http://127.0.0.1:55099/` in a browser
profile that has never opened the site, 1280 px wide or more, and check by eye, in each of the three styles, light and
dark:

1. The page opens on the source beside the TM view, and the header's `source` and `TM` toggles are pressed.
2. Each toggle shows and hides its view, and a pressed toggle and one that is not differ without colour.
3. `Ctrl+.` shows the hint over the foot of the page; `]` four times goes round the cycle and back; the caret stays
   in the source editor throughout.
4. With all four views shown, the one divider that spans the views area is the vertical one.

```bash
docker stop redextape-view-layouts
```

- [ ] **Step 5: The roadmap entry**

Add an entry to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, at its end, in the shape the entries above
it have:

- The heading: what the branch makes true, then `(YYYY-MM-DD, branch \`view-layouts\`, \`<base>..<last code commit>\`,
  N commits, plus this entry)`. The range leaves out the entry's own commit.
- Its sections, in the entry's own voice: what a combination and an arrangement are; what a switch parks and what a
  `✕` closes; the two defects fixed on the way, each with how it was reached (Tasks 1 and 2); the first load and how
  the tests keep their start; the view keys, and why the cycle keys are `]` and `[`.
- `##### WHAT THIS DID NOT CLOSE`, holding at least:
  - The spec's three **OPEN** points (§16.3): the toggles hidden at 40rem and narrower; whether `Ctrl+1` to `Ctrl+4`
    reach the page in the user's Chrome and Firefox; `+ view` halving the focused view in a layout of columns.
  - Firefox and WebKit, unmeasured.
  - After a reload, and after an opened link's undo, a parked view that showed a copy comes back on the program.
  - Terminal's header is two rows at 1280 px.
  - `draw.ts`'s `watched` gates the asm and TM running focuses too, and `parked-view-surfaces.test.ts` asserts the λ
    leg's alone.
  - One id under two kinds (§5.4) is held by `liveLeaves`' node test alone: no browser test changes a view's kind
    with a title pick and then enters an arrangement that remembers its old one.
  - Panel resizing, moving a view, and drag and drop: the spec's §11, §9 and §10, the next three pull requests.
- `##### VERIFICATION`, ending with a block headed **Every count this entry quotes, with what produces it**, one row a
  figure: the value, what it is, and the command. Steps 1 to 4's figures go here, as this run gave them. **Run every
  command in the block before committing the entry.** A figure about the branch names a SHA, never "the head".

Write it last, after the final code commit, so the range it names is closed.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Roadmap: each combination of views keeps its own arrangement, the header's toggles and the view keys choose it, and a fresh page opens on the source beside the TM view"
```

---

## Appendix: the census of readers (spec §5.3)

The spec asks the first plan to carry a census of every reader of the `PaneCollection` and of the tree's leaves, each
recorded as wanting the views on the page, the views of the tree on screen, or every entry. One was run on `ba4514b`
by reading `web/src`, before the prototype was built, and the prototype's changes are its answers. It is an
enumeration of the readers, grouped here by what each wants; a reader this branch adds is held to the same question
in review.

**Changed to read the views of the tree on screen** (a parked view is passed over; a Stage tab that is not selected
is not):

| Reader | What it drives |
|---|---|
| `main.ts`'s `barTargetNow` | the step bar's target, and the view its buttons step |
| `link-wiring.ts`'s `detachedPanes` | the link status line's count and names; the share popover's line about copies |
| `draw.ts`'s `watched`, handed to `PaneCollection.active` for each leg | the running focuses: the source editor's mark, and each machine view's |

**Changed to read every live view** (the tree on screen and every remembered tree):

| Reader | What it does |
|---|---|
| `main.ts`'s `normaliseWorkspace`; `workspace.ts`'s `serializeWorkspace` and `parseWorkspace` | keep panel state and display for a parked view |
| `main.ts`'s `seedLeafCounter` | steps past every live id |
| `pane-host.ts`'s `admit`; `main.ts`'s `switchTo` | hold an add and a switch to `MAX_TREE_LEAVES` |
| `pane-host.ts`'s `applyLayout`, pass 1 | keeps the entry of a view a switch parked |

**Left reading every entry, a parked one included, on purpose** (each keeps a view true, whether or not it is drawn):

| Reader | What it does |
|---|---|
| `pane-host.ts`'s `reseedingSlots` and `moveBack` | move a view off a deleted or paused copy, and back on its undo |
| `editor-custody.ts`'s `homeFor`, `hasEditor`, `flush` and `reconcile` | where a copy's editor is, and the sweep that moves it |
| `replies.ts`'s value and status lines; its `editorHome` mounts | a reply about a session reaches every view of it |
| `link-wiring.ts`'s `setLinkTo`; `main.ts`'s source editor listener | clear or set a link on every TM and asm view |
| `main.ts`'s `persistBuffers` | stores each view's copy; a parked view's is not read back after a reload (§5.2) |
| `main.ts`'s copies menu rows and its delete and pause handlers | count a parked view as a view of its copy, as a Stage tab is counted |
| `main.ts`'s `openLink` | records each view's copy for the open's undo |

**Already read the page alone, and unchanged:** `draw.ts`'s per-view loop and its λ build loop, which pass over a host
that is not connected; its link clause, through `PaneCollection.shown`; `replies.ts`'s `storeAndSetProgram` and
`setAsmProgram`, which leave a view off the page to be seeded when it is next drawn; `layout-view.ts`'s
`retitleStage`.

**Read the tree on screen, as before, and rightly:** `main.ts`'s `focusedLeaf` and `neighbourOf`; `+ view`'s and the
split picker's `sourceAvailable`; the count that decides whether `✕` is offered; `layout-view.ts`'s `renderLayout` and
`renderStage`; `pane-host.ts`'s `mountOnViewOf`, whose gap for a parked view the mount on its return closes (Task 3);
and `main.ts`'s restore of bindings, which is why a parked view's copy does not survive a reload.

**The writes of the tree** the census found, eleven: the restore at start-up; the source view's `✕`; `pane-host.ts`'s
`setTree`, reached by a split choosing `source`, a split choosing a pair, a title pick naming another leg, a view's
`✕`, each frame of a divider's drag, and `+ view`; *reset preset*; and `showWorkspace`, for an opened link and its
undo. Every one that is a gesture's goes through `enterTree` now; the restore, the reset and `showWorkspace` write the
workspace whole (spec §4.3).
