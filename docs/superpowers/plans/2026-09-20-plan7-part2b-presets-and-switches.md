# Plan 7, part 2b — Presets and switches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three switches real — step controls in each view or in one bottom bar, views tiled or on a tabbed Stage, the readout a strip or a right-hand inspector — put the three presets and the three switches in the workspace menu, and give §11's fourth focus rule one implementation every site that removes a control under a state change shares.

**Architecture:** `app-header.ts` builds the workspace menu's contents on open: the three presets as one choice, the three switches as three two-way choices, then *reset preset* — which is removed while the workspace is custom. `main.ts` gains one writer, `setSwitches`, which persists, renames the button and raises a notice; the three switch values are then read by three consumers that did not exist before. `step-bar.ts` mounts one `step-controls.ts` instance below the views and points it at the focused view, or at the last view that could step. `layout-view.ts` gains `renderStage` beside `renderLayout`: the same tree, drawn as a tab strip over one mounted host. `readout.ts` gains row builders beside its segment builders, and `#results`/`#link-status` move between `footer.strip` and the inspector column, keeping their ids. `focus-handoff.ts` is the one answer to "this control is going away and it has the focus".

**Tech Stack:** TypeScript 7 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vite 8, Vitest 4 (node and browser projects, Playwright Chromium), Biome 2, CodeMirror 6.

**Spec:** `docs/superpowers/specs/2026-09-19-plan7-part2-workspace-shell-design.md` — §4 (presets and switches), §5 (Stage), §6 (the workspace menu, the missing `▾`), §8 (the bar and its target), §9 (the inspector), §11 (the fourth focus rule), §14 (tests), §15 (accessibility). Umbrella: `docs/superpowers/specs/2026-09-17-frontend-overhaul-design.md`.

## What 2a already shipped, so no task below re-writes it

Read at `d6b57c2` (#100, part 2a's squash merge). **Check these before starting a task that looks like it needs them.**

- **`workspace.ts` already holds the whole switch cube.** `type Switches`, `StepsSwitch`/`ViewsSwitch`/`ReadoutSwitch`, `PRESETS`, `presetOf`, `SPEEDS`, `DEFAULT_SPEED`, `isSpeed`, `Workspace`, `parseWorkspace` (version 2, migrating version 1), `serializeWorkspace`, `defaultFocus`, `withPanel`. Only `inspector` is added, in Task 4.
- **Spec §14 item 2 is already discharged.** `tests/node/workspace.test.ts`'s `describe('presetOf')` enumerates all eight combinations with a 2×2×2 loop and asserts three presets and five *custom*; `tests/node/layout.test.ts`'s `describe('insertBeside')` covers the source leaf as subject, the source leaf as the only leaf, the refusal of a second source leaf, the refusal of a duplicate id, and the leaves() ordering. **Write nothing new for item 2.** Task 7 records that it was checked, not re-done.
- **`insertBeside` already puts the new leaf after its subject** in `leaves()` order (`layout.ts`, and `layout.test.ts`'s "puts the new leaf after its subject in leaves() order"). Stage's tab order is `leaves(tree)` order, so `+ view` lands the new tab after the focused one with no change to `pane-host.ts`'s `addView`.
- **`app-header.ts` already has `wireMenu(button, menu, onOpen?)` and `presetName(p: Preset | null)`**, which returns `custom` for `null`. `wireMenu`'s `onOpen` runs before it picks the first enabled `button`/`select` for `autofocus`, so a menu rebuilt on open gets its autofocus right.
- **`viewMenu` already takes `setLayout(canClose, canSplit)`** and reconciles its items rather than replacing them. Stage removing the split items is `canSplit === false`; no new method.
- **`step-controls.ts` already renders the whole `ControlState`**, including `playing`, the speed select and the continue button, and already hands the focus off when `continue` goes away. Task 2 generalises that hand-off; Task 3 mounts a second instance of the same component.
- **`panel.ts` already builds a named collapsible region** with `open`, `onToggle`, `actions` and `setOpen`. The inspector is one.

## Global Constraints

- Branch `plan7-part2b-presets-and-switches`, off `main` at `d6b57c2` (#100). Never `--no-verify`. The pre-commit hook runs the text-byte, citation, attribution, doc-figure, shared-doc and colour gates, then `cargo fmt`, `cargo clippy -D warnings`, `biome ci` and `web typecheck` (which runs `cargo` through `build:bindings`) — each scoped to the files a commit touches. **No task below changes Rust**, so no Rust gate should ever have anything to say; if one does, a task touched a file it should not have.
- The wasm package must exist at the repo root's `pkg/` before any browser test, `typecheck` or `build:app` runs: `pnpm run build:wasm:dev` from `web/` if it is missing or older than the last change under `crates/redextape-wasm` or `crates/redextape-core`.
- Run web commands from `web/`. **Scope a test run by passing the path positionally:** `pnpm exec vitest run --project node tests/node/x.test.ts` or `pnpm exec vitest run --project browser tests/browser/x.test.ts`. `pnpm test:node -- x` does NOT scope — it runs every file. `passWithNoTests` is unset, so a positional path that matches nothing is an error, not a pass.
- Browser runs need Chrome on `PATH`: prefix `PATH="/usr/sbin:$PATH"`. **Never run two browser-project runs at once**; the tier binds a port. Run `test:coverage` under a memory cap: `systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 -- pnpm run test:coverage`.
- There is no fail-fast: every file and every test runs and the run reports all failures. A sabotage step therefore sees every red it caused in one run.
- TypeScript doc comments are `/** */`; `///` in a `.ts` file is drift. Match the surrounding comment density: this codebase writes a doc comment on every exported symbol, in full sentences, with a bolded upper-case lead where a decision needs arguing, and it records measurements rather than asserting them.
- No `file:line` citations anywhere in tracked source (`scripts/check-citations.sh`). A symbol citation written `` `file.ts`'s `symbol` `` must name the file that declares the symbol, and must not land in a commit before the commit that creates that symbol (`scripts/check-attributions.sh`). **When a task renames or deletes a symbol, search `web/` for citations of it — including in test-file comments — and update them in the same commit.**
- **A colour literal may appear only in `web/src/palettes.ts` and between `/* palette:fallback:begin */` and `/* palette:fallback:end */` in `web/src/style.css`** (`scripts/check-colours.sh`). New CSS uses the tokens: surfaces `--bg`, `--bg-raised`, `--bg-chrome`; text `--fg`, `--fg-dim`; lines `--rule` (structural separators) and `--fg-dim` (a control's own 1px outline); `--accent`, `--on-accent`, `--focus-ring`; metrics `--radius`, `--space-1|2|3`, `--step--2|--1|0|1`; faces `--font-ui`, `--font-mono`; style hooks `--label-transform`, `--label-tracking`. Derive shades with `color-mix(in oklab, var(--token) N%, transparent)`, the file's established idiom — never a new literal.
- **Biome's `noDescendingSpecificity` orders CSS by source position**: a less specific selector must not follow a more specific one. Every scoped override this plan adds (`.inspector .results .segment`, `.step-bar .controls`) goes AFTER the rule it narrows. `style.css` carries two comments saying so; match them.
- **Do not set `display` on a `[popover]` outside `:popover-open`.** `tests/browser/app-header.test.ts`'s "keeps every closed popover off the page" asserts every closed popover computes to `display: none` and zero height; an author `display` rule beats the UA's `[popover]:not(:popover-open){display:none}` and paints the menu permanently. `.header-menu.settings` splits into two rules for exactly this reason — copy that shape.
- **`.header-menu > button` is a DIRECT-CHILD selector.** Menu items wrapped in a group container do not inherit it. Task 1 adds the group rules rather than flattening the groups.
- Web coverage thresholds (`web/vite.config.ts`): lines 97, functions 97, branches 89, statements 95. Every new module needs tests that keep these.
- **Tests that pin a replaced label or control change in the same commit as the control, to the new control or wording — never loosened, never skipped.** A negative assertion on an old label passes vacuously after a rename; rewrite each to name the new wording, and add a positive check beside it where it stood alone.
- **`SHELL` in `web/tests/browser/harness.ts` must stay identical in content to `web/index.html`'s markup from `<header` through the end of the strip** (only indentation differs), and `web/tests/node/harness.test.ts` lists the ids it must carry. **A markup change is therefore always a three-file edit**: `index.html`, `harness.ts`, `harness.test.ts`.
- **Before every commit, run `pnpm exec biome ci --error-on-warnings <every web file the task changed>` from `web/`.** The hook passes `--error-on-warnings`. A formatting-only failure is fixed with `pnpm exec biome format --write <files>`; an import-order one with `pnpm exec biome check --write <files>`.
- Browser waits go through `harness.ts`'s `until`, with no numeric timeout at the call site (`tests/node/browser-timeout-invariants.test.ts` is a gate over the browser tier's source). No test body waits on more than one long recording.
- **Every new test is sabotaged once**, and the assertion that fired is recorded. Each task below ends with its sabotage step before its commit step. **A sabotage that does not fire is the finding**: record it as such rather than adjusting the sabotage until something goes red.
- Commit subjects are sentences stating what is now true. No AI attribution anywhere.

## The pre-flight build

**This plan is built once, end to end, in a throwaway worktree before any of it is executed** — parts 1 and 2a's practice. 2a's pre-flight found 79 defects in its plan text, 10 of which blocked a step as written.

```bash
cd /home/davey/projects/redextape
git worktree add ~/temp/redextape-preflight-2b -b preflight-2b plan7-part2b-presets-and-switches
export CARGO_TARGET_DIR="$XDG_CACHE_HOME/redextape-preflight-2b-target"
cd ~/temp/redextape-preflight-2b/web && pnpm install && pnpm run build:wasm:dev && pnpm run build:bindings
```

**Neither path is in `/tmp`, and that is measured rather than tidiness.** `/tmp` here is a 31 GiB **tmpfs** — RAM — so a Rust target directory and a `node_modules` tree under it are resident memory and then swap. `~/temp` is on the ext4 root, and `$XDG_CACHE_HOME` is what a build cache is for.

**The worktree needs its own `CARGO_TARGET_DIR` even so.** A scratch worktree building into the main checkout's `target/` links the OTHER checkout's library, and the failure reads as anything but that.

**It needs its own `node_modules` and its own `pkg/` too** — a fresh worktree has neither, and `pnpm install` in it does not disturb the main checkout's. Branch back and forth between the two and the main checkout's dev dependencies get pruned; the symptom is `Failed to fetch dynamically imported module` in whole files, and `pnpm install` is the fix.

**Base the pre-flight branch on `plan7-part2b-presets-and-switches`, not on `main`** — the plan and the corrected §9 are the first commit, and the pre-flight has to build against the spec it is checking.

Apply each task's code in order, run its gates, and log every disagreement between the plan and the build to `docs/superpowers/notes/2026-09-20-plan7-part2b-preflight-defects.md`, one entry per defect, each with the error it produced and the replacement text, classified: **blocks a step as written** / **produces a wrong result or a red gate** / **needed a guess** / **design problem**. Adopt the pre-flight's corrected commits onto the real branch; leave the tasks below as they were planned, so the log is the record of where planning and building disagreed.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `web/src/app-header.ts` | `workspaceItems`: the preset choice, the three switch choices, *reset preset* | 1 |
| `web/index.html`, `web/tests/browser/harness.ts`, `web/tests/node/harness.test.ts` | the `▾` on `#workspace`; `#views`, `#inspector`, `#step-bar` | 1, 3, 4 |
| `web/src/focus-handoff.ts` (new) | one answer to "this control is going away and it has the focus" (§11 rule 4) | 2 |
| `web/src/step-controls.ts` | its bespoke hand-off routed through `focus-handoff.ts` | 2 |
| `web/src/view-header.ts` | `viewMenu.sync` hands off; `ViewHeader.setStepsShown` | 2, 3 |
| `web/src/sessions.ts` | `legControlState` extracted from `PaneSlot.render`; `PaneView.setStepsShown` | 3 |
| `web/src/step-bar.ts` (new) | the one bottom bar, its target, its title prefix, its no-target state | 3 |
| `web/src/lambda-pane.ts`, `web/src/tm-pane.ts` | `setStepsShown` | 3 |
| `web/src/workspace.ts` | the `inspector` field | 4 |
| `web/src/readout.ts` | row builders beside the segment builders; `createReadout` gains a mode | 4 |
| `web/src/layout-view.ts` | `renderStage` beside `renderLayout` | 5 |
| `web/src/pane-host.ts` | `applyLayout` picks the renderer; `draw` skips disconnected hosts | 3, 5 |
| `web/src/draw.ts` | `canSplit` gains the Stage clause; `setStepsShown`; skip disconnected panes | 3, 5 |
| `web/src/main.ts` | `setSwitches`; the bar, the inspector and Stage wired | 1, 3, 4, 5 |
| `web/src/style.css` | menu groups, `.step-bar`, `.inspector`, `.stage` | 1, 3, 4, 5 |
| `web/tests/node/focus-handoff.test.ts` (new), `step-bar.test.ts` (new), `workspace.test.ts`, `readout.test.ts` | node | 2, 3, 4 |
| `web/tests/browser/workspace-switches.test.ts` (new), `step-bar.test.ts` (new), `inspector.test.ts` (new), `stage.test.ts` (new), `app-header.test.ts`, `controls-gate.test.ts`, `menu-focus.test.ts` | browser | 1–6 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the entry | 7 |

**Task order and why.** 1 ships the only writer of the switches — nothing downstream can be driven or tested until a control can move them. 2 is the focus rule, which 3 and 5 each create a new instance of, so it lands as one rule before either. 3, 4 and 5 are the three switches' three consumers, independent of one another and each testable alone. 6 is the controls gate across all four states, which needs all three switches live. 7 verifies the branch and writes the roadmap entry.

---
### Task 1: The focus hand-off, as one rule

Spec §11's fourth bullet: *a control removed by a state change rather than by its own click — `continue` when recording ends, the split items when Stage is chosen — moves focus to the nearest remaining control in the same header or menu.*

**The spec names one instance for 2b. This branch creates three**, and that is the reason this is a module and lands first: the split items when Stage is chosen (Task 5), a view's step controls when the bar takes them over (Task 3), and *reset preset* when a switch makes the workspace custom (Task 2). `step-controls.ts` already has a fourth, written by hand for `continue`. One rule, four call sites.

**The node project has `environment: 'node'` and no DOM**, so this module's test is a browser test — and focus is a browser fact anyway: `document.activeElement` after a removal is exactly what a jsdom stand-in would be guessing at. The fixture mounts a handful of buttons and never loads the app, so it is one of the cheap files in the tier.

**Files:**
- Create: `web/src/focus-handoff.ts`
- Modify: `web/src/step-controls.ts` (its bespoke hand-off routes through the new module, with the same candidate order)
- Test: `web/tests/browser/focus-handoff.test.ts` (new)

**Interfaces:**
- Produces (`focus-handoff.ts`):
  - `handOff(going: Element | readonly Element[], candidates: readonly (Element | null | undefined)[]): boolean` — if the focus is on, or inside, anything in `going`, focus the first usable candidate and return `true`; otherwise change nothing and return `false`.
  - `nearest(within: HTMLElement, going: Element): HTMLElement[]` — every `button`/`select`/`[tabindex]` under `within` except `going` and its descendants, in DOM order from the one after `going` to the end, then from the one before `going` back to the start. The candidate list §11's "nearest remaining control in the same header or menu" means.
- Consumes: nothing.

- [ ] **Step 1: Write the failing browser test**

Create `web/tests/browser/focus-handoff.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { handOff, nearest } from '../../src/focus-handoff'

/**
 * A bar of five buttons, `c` disabled, plus one inside a `[hidden]` box — the shapes `handOff` has to
 * skip. No app mount: this module knows nothing about the app.
 */
function bar(): { box: HTMLElement; get: (name: string) => HTMLButtonElement } {
  document.body.innerHTML = `
    <div id="bar">
      <button id="a">a</button>
      <button id="b">b</button>
      <button id="c" disabled>c</button>
      <button id="d">d</button>
      <div hidden><button id="e">e</button></div>
      <button id="f">f</button>
    </div>
    <button id="outside">outside</button>`
  const box = document.querySelector<HTMLElement>('#bar') as HTMLElement
  return { box, get: (name) => document.querySelector<HTMLButtonElement>(`#${name}`) as HTMLButtonElement }
}

describe('nearest', () => {
  it('reads forward from the departing control, then backward, skipping what cannot take focus', () => {
    const { box, get } = bar()
    expect(nearest(box, get('b')).map((el) => el.id)).toEqual(['d', 'f', 'a'])
  })

  it('reads backward alone when the departing control is last', () => {
    const { box, get } = bar()
    expect(nearest(box, get('f')).map((el) => el.id)).toEqual(['d', 'b', 'a'])
  })

  it('excludes the departing control’s own descendants', () => {
    const { box } = bar()
    const group = document.createElement('div')
    group.innerHTML = '<button id="g">g</button>'
    box.append(group)
    expect(nearest(box, group).map((el) => el.id)).not.toContain('g')
  })
})

describe('handOff', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('moves the focus off a departing control to the first usable candidate', () => {
    const { box, get } = bar()
    get('b').focus()
    expect(handOff(get('b'), nearest(box, get('b')))).toBe(true)
    expect(document.activeElement).toBe(get('d'))
  })

  it('leaves the focus alone when it was not on the departing control', () => {
    const { box, get } = bar()
    get('outside').focus()
    expect(handOff(get('b'), nearest(box, get('b')))).toBe(false)
    expect(document.activeElement).toBe(get('outside'))
  })

  it('counts a focus INSIDE the departing control as being on it', () => {
    const { get } = bar()
    const group = document.createElement('div')
    const inner = document.createElement('button')
    inner.id = 'inner'
    group.append(inner)
    document.body.append(group)
    inner.focus()
    expect(handOff(group, [get('a')])).toBe(true)
    expect(document.activeElement).toBe(get('a'))
  })

  it('takes several departing controls at once', () => {
    const { box, get } = bar()
    get('d').focus()
    expect(handOff([get('b'), get('d')], nearest(box, get('d')))).toBe(true)
    expect(document.activeElement).toBe(get('f'))
  })

  // **THE LAST RESORT IS THAT THE FOCUS DOES NOT MOVE, NOT THAT IT FALLS TO `<body>`.** A caller with
  // nothing to hand to has a state worth reporting; silently blurring would make it indistinguishable
  // from a successful hand-off at every call site.
  it('returns false and changes nothing when no candidate can take the focus', () => {
    const { get } = bar()
    get('b').focus()
    expect(handOff(get('b'), [get('c'), null, undefined])).toBe(false)
    expect(document.activeElement).toBe(get('b'))
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/focus-handoff.test.ts
```

Expected: every case fails to resolve `../../src/focus-handoff`.

- [ ] **Step 3: Write `focus-handoff.ts`**

Create `web/src/focus-handoff.ts`:

```ts
/**
 * WHERE THE FOCUS GOES WHEN A CONTROL IS TAKEN AWAY UNDER IT — Plan 7 part 2 spec §11's fourth rule.
 *
 * **A CONTROL REMOVED BY ITS OWN CLICK IS NOT THIS.** A menu item that closes its menu hands the focus back
 * to the menu's button, which the popover already does; a view closed by its own `✕` hands it to the view
 * that becomes focused. Those are gestures, and the gesture knows where the user is going. This is the
 * other case: a STATE CHANGE removes a control the user happens to be standing on — `continue` when a
 * recording ends, a view's split items when Stage is chosen, a view's step controls when the bar takes them
 * over, *reset preset* when a switch makes the workspace custom. There is no gesture to ask, so the rule
 * is positional: the nearest control that still works, in the same header or menu.
 *
 * **THE CANDIDATE LIST IS THE CALLER'S, AND `nearest` IS ONLY THE DEFAULT WAY TO BUILD ONE.**
 * `step-controls.ts` prefers *forward, play, back, restart*, then the speed select — an order that is
 * about what those controls MEAN, not where they sit, and DOM order would put the speed select first.
 * A single function computing the order for everyone would have had to be wrong for one of them.
 *
 * **NOT MOVING IS A RESULT, AND IT IS REPORTED.** With no usable candidate this leaves the focus where it
 * is and answers `false`. Blurring to `<body>` would be the failure the whole rule exists to prevent,
 * performed by the rule itself.
 */

/** Whether `el` can be focused right now: on the page, enabled, not inside anything `hidden`, in the tab order. */
function usable(el: Element | null | undefined): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.isConnected &&
    !el.matches(':disabled') &&
    el.closest('[hidden]') === null &&
    el.tabIndex >= 0
  )
}

/** Whether the focus is on `el` or on something inside it. */
function holdsFocus(el: Element): boolean {
  const active = document.activeElement
  return active !== null && (active === el || el.contains(active))
}

/**
 * Hand the focus on, if the departing control has it.
 *
 * Answers whether it moved: `false` both for "the focus was somewhere else" and for "there was nowhere to
 * put it", which are the two cases a caller has nothing further to do about.
 */
export function handOff(
  going: Element | readonly Element[],
  candidates: readonly (Element | null | undefined)[],
): boolean {
  const leaving = Array.isArray(going) ? (going as readonly Element[]) : [going as Element]
  if (!leaving.some(holdsFocus)) return false
  const next = candidates.find(usable)
  if (next === undefined) return false
  next.focus()
  return true
}

/**
 * The candidates §11's "nearest remaining control" names: forward from `going` to the end of `within`, then
 * backward from `going` to its start.
 *
 * **FORWARD FIRST, BECAUSE READING ORDER IS WHERE A USER EXPECTS TO LAND.** The control after the one that
 * vanished is the one they would have reached next by `Tab`; falling back to the one before it is what a
 * departing LAST control leaves.
 *
 * **`going`'s OWN DESCENDANTS ARE EXCLUDED.** A departing GROUP — a menu section, a header slot — is removed
 * with everything in it, so a candidate inside it is a control that is also about to go.
 */
export function nearest(within: HTMLElement, going: Element): HTMLElement[] {
  const all = [...within.querySelectorAll<HTMLElement>('button, select, [tabindex]')].filter(
    (el) => el !== going && !going.contains(el),
  )
  const at = [...within.querySelectorAll<HTMLElement>('button, select, [tabindex], *')].indexOf(going as HTMLElement)
  const after = all.filter((el) => (going.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
  const before = all.filter((el) => (going.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0)
  void at
  return [...after.filter(usable), ...before.reverse().filter(usable)]
}
```

**Note for the pre-flight:** the `at`/`void at` pair above is dead and must not survive — `compareDocumentPosition` is the whole ordering mechanism. Delete both lines; they are in the plan text only because the first draft indexed by position and the index is not needed.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd web && PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/focus-handoff.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Route `step-controls.ts`'s existing hand-off through it, with its order unchanged**

In `web/src/step-controls.ts`, add the import beside the others:

```ts
import { handOff } from './focus-handoff'
```

and replace the body of the `continueLabel === null` branch in `update`:

```ts
      if (c.continueLabel === null) {
        // A CONTROL THAT GOES AWAY UNDER THE KEYBOARD MUST NOT TAKE THE FOCUS WITH IT (umbrella rule 5,
        // spec §11). `focus-handoff.ts` is that rule; the CANDIDATE ORDER stays this control's own, and
        // that is why it is written here rather than computed by `nearest`. The nearest control that
        // still works takes it: forward, then play, back, restart.
        //
        // **AND WHEN NONE OF THEM IS LIVE, THE SPEED SELECT IS** — a leg that is not available disables
        // all four at once (`controls.ts`'s unavailable branch returns every `can*` false AND no
        // continue label), which is exactly the state a copy's worker throwing produces while the user
        // is on that view's continue button. The select is never disabled: the workspace's speed is a
        // setting, not a property of this leg. In DOM order the select comes FIRST of the five, so
        // `nearest` would have handed it the focus in every case — which is the reason the list is
        // spelled out.
        handOff(extend, [forward, play, back, restart, speed])
        extend.hidden = true
      } else {
```

**Behaviour is unchanged**, deliberately: the same five controls in the same order, the same "only if `extend` has the focus" condition. `handOff` reads `:disabled` where the old code read `.disabled`, and `usable` additionally requires `isConnected` and no `[hidden]` ancestor — `extend` is still connected at this point because `extend.hidden = true` runs after the call, which is the same ordering the old code had.

- [ ] **Step 6: Run the tests that already pin this behaviour**

```bash
cd web && PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts tests/browser/focus.test.ts tests/browser/menu-focus.test.ts
```

Expected: all pass, unchanged.

- [ ] **Step 7: Sabotage, once each, and record the assertion that fired**

1. In `handOff`, return `true` without calling `next.focus()`. Expect `focus-handoff.test.ts`'s "moves the focus off a departing control" red on `expect(document.activeElement).toBe(get('d'))`. Revert.
2. In `usable`, drop the `!el.matches(':disabled')` clause. Expect "moves the focus off a departing control" red — the disabled `c` is now the first candidate — and "returns false and changes nothing when no candidate can take the focus" red on its `toBe(false)`. Revert.
3. In `nearest`, return `[...after, ...before]` without the `.reverse()`. Expect "reads forward from the departing control, then backward" red on `toEqual(['d', 'f', 'a'])`. Revert.
4. In `step-controls.ts`, pass `[speed, forward, play, back, restart]`. Expect nothing red — **record that**. No existing test drives a `continue` button away while it holds the focus with `forward` live; the case is covered by argument in the comment and by `focus-handoff.test.ts`'s own ordering cases, not by a test of this call site. Revert.

- [ ] **Step 8: Commit**

```bash
cd web && pnpm exec biome ci --error-on-warnings src/focus-handoff.ts src/step-controls.ts tests/browser/focus-handoff.test.ts
cd .. && git add web/src/focus-handoff.ts web/src/step-controls.ts web/tests/browser/focus-handoff.test.ts
git commit -m "A control removed by a state change hands the focus to the nearest one that still works, by one rule every site shares rather than a copy per site"
```

---

### Task 2: The workspace menu — the three presets, the three switches, and the `▾`

Spec §4 (the table, *custom*, *reset preset* removed while custom), §6 (the menu's contents, the missing `▾`).

**This task ships the only writer of the switches.** Nothing in Tasks 3–5 can be driven or tested until it exists: `main.ts`'s `reset preset` handler is today's only writer and it writes the values that were already there. After this task the switches move, persist and rename the button — and change nothing else on screen. That is not an unfinished state; it is the state 2a shipped, with the control that reaches it.

**The `▾` is a five-file change, and `main.ts` is the one that is easy to miss.** `main.ts` sets `workspaceButton.textContent = presetName(...)` wholesale, which destroys an `aria-hidden` span placed in the markup on the first render. The glyph must go back through code, not only through `index.html`.

**Files:**
- Modify: `web/src/app-header.ts` (`SWITCH_ROWS`, `workspaceItems`)
- Modify: `web/src/main.ts` (`setSwitches`; the menu's `onOpen`; the button's name keeps its `▾`)
- Modify: `web/index.html` (the `▾` span)
- Modify: `web/tests/browser/harness.ts` (`SHELL`, identically)
- Modify: `web/src/style.css` (`.menu-group`)
- Test: `web/tests/browser/workspace-switches.test.ts` (new)
- Modify tests: `web/tests/browser/app-header.test.ts` (both assertions on `#workspace`'s text)

**Interfaces:**
- Produces (`app-header.ts`):
  - `type SwitchRow` and `const SWITCH_ROWS: readonly SwitchRow[]` — the three switches, each with the words §4's table gives its two values.
  - `workspaceItems(menu: HTMLElement, state: { switches: Switches; reset: HTMLButtonElement }, on: { preset(p: Preset): void; flip<K extends keyof Switches>(key: K, value: Switches[K]): void }): void` — fills `menu`, restoring the focus onto the equivalent button when it rebuilds under one, and handing it off when the button is gone.
- Produces (`main.ts`, in scope for later tasks): `setSwitches(next: Switches): void`, `applySwitches(): void`.
- Consumes: `focus-handoff.ts`'s `handOff` and `nearest` (Task 1); `workspace.ts`'s `PRESETS`, `presetOf`, `Switches`, `Preset`; `app-header.ts`'s existing `presetName` and `wireMenu`.

- [ ] **Step 1: Write the failing browser test**

Create `web/tests/browser/workspace-switches.test.ts`:

```ts
import { computeAccessibleName } from 'dom-accessibility-api'
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

const open = (): HTMLElement => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  return document.querySelector<HTMLElement>('#workspace-menu') as HTMLElement
}
const shut = (): void => {
  const menu = document.querySelector<HTMLElement>('#workspace-menu')
  if (menu?.matches(':popover-open')) menu.hidePopover()
}
const item = (menu: HTMLElement, sel: string): HTMLButtonElement =>
  menu.querySelector<HTMLButtonElement>(sel) as HTMLButtonElement
const name = (): string => document.querySelector<HTMLElement>('#workspace')?.textContent?.trim() ?? ''
const live = (): string => document.querySelector<HTMLElement>('#live')?.textContent?.trim() ?? ''
const stored = () => JSON.parse(localStorage.getItem('redextape.layout') ?? '{}')

describe('the workspace menu', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  // **THE GLYPH IS NOT IN THE NAME.** `copies 2 ▾` already does this; the workspace button did not, and
  // §6 records that as an inconsistency rather than a decision. A bare `▾` in the accessible name reads
  // as "down-pointing triangle".
  it('carries a ▾ that the accessible name does not', () => {
    const button = document.querySelector<HTMLButtonElement>('#workspace') as HTMLButtonElement
    expect(button.textContent).toContain('▾')
    expect(computeAccessibleName(button)).toBe('Explorer')
  })

  it('offers the three presets and the three switches, with the values in force marked', () => {
    const menu = open()
    expect([...menu.querySelectorAll('[data-preset]')].map((b) => b.textContent)).toEqual([
      'Explorer',
      'Debugger',
      'Stage',
    ])
    expect(item(menu, '[data-preset="explorer"]').getAttribute('aria-current')).toBe('true')
    expect(item(menu, '[data-switch="steps"][data-value="view"]').getAttribute('aria-current')).toBe('true')
    expect(item(menu, '[data-switch="views"][data-value="tiles"]').getAttribute('aria-current')).toBe('true')
    expect(item(menu, '[data-switch="readout"][data-value="strip"]').getAttribute('aria-current')).toBe('true')
    // A switch's name says which switch it is, so "one bar" is not a button named "one bar".
    expect(computeAccessibleName(item(menu, '[data-switch="steps"][data-value="bar"]'))).toBe(
      'step controls — one bar',
    )
    shut()
  })

  it('names itself after the preset a pick makes, persists it, and says so', () => {
    const menu = open()
    item(menu, '[data-preset="debugger"]').click()
    expect(name()).toBe('Debugger ▾')
    expect(stored().switches).toEqual({ steps: 'bar', views: 'tiles', readout: 'inspector' })
    expect(live()).toContain('Debugger')
    shut()
  })

  // §4: any combination matching no row is *custom*, it persists as it is, and the menu names it.
  it('is custom when the switches match no preset, and offers no reset while it is', () => {
    const menu = open()
    item(menu, '[data-preset="explorer"]').click()
    item(menu, '[data-switch="views"][data-value="stage"]').click()
    expect(name()).toBe('custom ▾')
    expect(stored().switches).toEqual({ steps: 'view', views: 'stage', readout: 'strip' })
    expect(menu.querySelector('#reset-preset')).toBeNull()
    // Choosing a preset is the way back, and the item returns with it.
    item(menu, '[data-preset="explorer"]').click()
    expect(menu.querySelector('#reset-preset')).not.toBeNull()
    shut()
  })

  // Spec §11's fourth rule, third instance: the menu rebuilds under the button that was just clicked.
  it('keeps the focus on the switch that was picked, and hands it off when reset preset goes', () => {
    const menu = open()
    item(menu, '[data-preset="explorer"]').click()
    const stage = item(menu, '[data-switch="views"][data-value="stage"]')
    stage.focus()
    stage.click()
    expect(document.activeElement).toBe(item(menu, '[data-switch="views"][data-value="stage"]'))
    // Now stand on reset preset and make the workspace custom from another switch.
    item(menu, '[data-preset="explorer"]').click()
    const reset = item(menu, '#reset-preset')
    reset.focus()
    item(menu, '[data-switch="readout"][data-value="inspector"]').click()
    expect(menu.querySelector('#reset-preset')).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(menu.contains(document.activeElement)).toBe(true)
    item(menu, '[data-preset="explorer"]').click()
    shut()
  })

  it('survives a reload', async () => {
    const menu = open()
    item(menu, '[data-preset="stage"]').click()
    shut()
    expect(stored().switches).toEqual({ steps: 'bar', views: 'stage', readout: 'inspector' })
    expect(stored().version).toBe(2)
    // Back to Explorer so the shared page is where the other files expect it.
    const again = open()
    item(again, '[data-preset="explorer"]').click()
    shut()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/workspace-switches.test.ts
```

Expected: the first case fails on `expect(button.textContent).toContain('▾')`; the rest fail on `[data-preset]` matching nothing.

- [ ] **Step 3: Add the `▾` to the markup, in both files**

In `web/index.html`, replace the `#workspace` button:

```html
      <button type="button" id="workspace" aria-haspopup="menu" aria-controls="workspace-menu" aria-expanded="false">Explorer <span aria-hidden="true">▾</span></button>
```

In `web/tests/browser/harness.ts`, make the same change inside `SHELL` (the line is identical but for indentation):

```
    <button type="button" id="workspace" aria-haspopup="menu" aria-controls="workspace-menu" aria-expanded="false">Explorer <span aria-hidden="true">▾</span></button>
```

`web/tests/node/harness.test.ts` needs no change: it lists ids, and no id is added here.

- [ ] **Step 4: Write `SWITCH_ROWS` and `workspaceItems`**

In `web/src/app-header.ts`, add to the imports:

```ts
import { handOff, nearest } from './focus-handoff'
import { type Preset, PRESETS, presetOf, type Switches } from './workspace'
```

(the file already imports `type Preset` — widen that line rather than adding a second import of the same module), and append:

```ts
/** One switch in the workspace menu: what it is called, and the words its two values go by (spec §4). */
export type SwitchRow = {
  readonly key: keyof Switches
  readonly label: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
}

/**
 * The three switches, in §4's table order, with §4's words.
 *
 * **THE TABLE IS THE ORDER AND THE WORDING, AND IT IS DATA RATHER THAN THREE HAND-BUILT SECTIONS.** A
 * switch is a two-way choice whose values already have names the spec fixed; writing each one out would be
 * three copies of one shape, and the copy is where a fourth switch would be forgotten.
 *
 * **`value` IS `string` AND NOT `Switches[K]`.** A `SwitchRow` is a row of a table, and a table typed
 * per-row needs a discriminated union of three row types to carry three value unions — for a list whose only
 * consumer immediately writes the value back through `flip`, which re-narrows it. The narrowing that
 * matters is at the write, and `setSwitches` below has it.
 */
export const SWITCH_ROWS: readonly SwitchRow[] = [
  {
    key: 'steps',
    label: 'step controls',
    options: [
      { value: 'view', label: 'in each view' },
      { value: 'bar', label: 'one bar' },
    ],
  },
  {
    key: 'views',
    label: 'views',
    options: [
      { value: 'tiles', label: 'tiles' },
      { value: 'stage', label: 'stage' },
    ],
  },
  {
    key: 'readout',
    label: 'readout',
    options: [
      { value: 'strip', label: 'strip' },
      { value: 'inspector', label: 'inspector' },
    ],
  },
]

/**
 * Fill the workspace menu: the three presets as one choice, the three switches as three two-way choices with
 * the value in force marked, then *reset preset* — which is not there while the workspace is custom (spec §4,
 * §6).
 *
 * **IT IS CALLED ON OPEN AND AGAIN ON EVERY PICK, WITH THE MENU STILL OPEN.** A pick changes which value is
 * marked and may add or remove *reset preset*, so the menu has to repaint under the user's hand — which
 * destroys the button they just clicked.
 *
 * **SO THE FOCUS IS PUT BACK BY IDENTITY, NOT BY ELEMENT.** `data-preset` / `data-switch`+`data-value` are a
 * durable name for a button across a rebuild, exactly as `layout-view.ts`'s divider rescue uses
 * `data-path`/`data-index` across `replaceChildren`. When the identity is gone — *reset preset*, on a pick
 * that made the workspace custom — there is no equivalent to restore, and the focus goes to the nearest
 * remaining control in this menu (`focus-handoff.ts`, spec §11's fourth rule).
 *
 * **`reset` IS THE CALLER'S OWN ELEMENT, NOT ONE BUILT HERE**, for `bufferList`'s reason: `main.ts` holds
 * `#reset-preset` from the markup and wired its click handler once. Rebuilding it per open would need the
 * handler rewired per open, and a menu item that is sometimes a different element is a second thing for a
 * test to select.
 */
export function workspaceItems(
  menu: HTMLElement,
  state: { readonly switches: Switches; readonly reset: HTMLButtonElement },
  on: {
    preset(p: Preset): void
    flip(key: keyof Switches, value: string): void
  },
): void {
  const held = document.activeElement
  const identity =
    held instanceof HTMLElement && menu.contains(held)
      ? { preset: held.dataset.preset, key: held.dataset.switch, value: held.dataset.value, id: held.id }
      : null

  const button = (label: string, name: string, mark: boolean, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    // THE NAME SAYS WHICH CHOICE THIS IS, AND THE TOOLTIP CARRIES IT TOO. The controls gate holds a
    // control's accessible name equal to its visible label or its tooltip; `one bar` on its own is a
    // visible label that does not say what it is one bar of, so the name is the longer sentence and the
    // tooltip is what makes the two agree.
    b.title = name
    b.setAttribute('aria-label', name)
    if (mark) b.setAttribute('aria-current', 'true')
    b.addEventListener('click', run)
    return b
  }

  const group = (label: string, items: readonly HTMLElement[]): HTMLElement => {
    const g = document.createElement('div')
    g.className = 'menu-group'
    g.setAttribute('role', 'group')
    g.setAttribute('aria-label', label)
    g.append(...items)
    return g
  }

  const now = presetOf(state.switches)
  const presets = group(
    'preset',
    (Object.keys(PRESETS) as Preset[]).map((p) => {
      const b = button(presetName(p), `preset — ${presetName(p)}`, p === now, () => on.preset(p))
      b.dataset.preset = p
      return b
    }),
  )

  const switches = SWITCH_ROWS.map((row) =>
    group(
      row.label,
      row.options.map((o) => {
        const b = button(o.label, `${row.label} — ${o.label}`, state.switches[row.key] === o.value, () =>
          on.flip(row.key, o.value),
        )
        b.dataset.switch = row.key
        b.dataset.value = o.value
        return b
      }),
    ),
  )

  menu.replaceChildren(presets, ...switches)
  // **REMOVED, NOT DISABLED, WHILE THE WORKSPACE IS CUSTOM** (umbrella §4 rule 4): there is no preset for
  // it to restore, so it can never apply in this state — choosing a preset is the way back.
  if (now !== null) menu.append(state.reset)

  if (identity === null) return
  const back =
    identity.preset !== undefined
      ? menu.querySelector<HTMLElement>(`[data-preset="${identity.preset}"]`)
      : identity.key !== undefined
        ? menu.querySelector<HTMLElement>(`[data-switch="${identity.key}"][data-value="${identity.value}"]`)
        : identity.id === ''
          ? null
          : menu.querySelector<HTMLElement>(`#${identity.id}`)
  if (back !== null) back.focus()
  else handOff(document.body, nearest(menu, menu))
}
```

**Note for the pre-flight:** the final `handOff(document.body, nearest(menu, menu))` call is wrong as written — `nearest(menu, menu)` excludes every descendant of `menu`, so the candidate list is empty, and `document.body` is not the departing control. The departing control is already out of the document by this point, so `holdsFocus` cannot find it. The correct call takes the candidates directly:

```ts
  else {
    const candidates = [...menu.querySelectorAll<HTMLElement>('button')]
    const first = candidates[0]
    if (first !== undefined) first.focus()
  }
```

Use that form, and record the defect.

- [ ] **Step 5: Wire it in `main.ts`**

Replace the workspace-menu block (the three lines from `workspaceButton.textContent = …` through `wireMenu(workspaceButton, workspaceMenu)`) with:

```ts
  /**
   * THE WORKSPACE BUTTON'S NAME, AND ITS `▾`. The glyph is written here as well as in `index.html`, because
   * this line replaces the button's whole content on every preset change — a span placed only in the markup
   * would survive exactly until the first one. `aria-hidden`, so the accessible name is the preset's name
   * alone: a bare `▾` in a spoken sentence reads as "down-pointing triangle" (spec §12).
   */
  const paintWorkspaceButton = (): void => {
    const caret = document.createElement('span')
    caret.setAttribute('aria-hidden', 'true')
    caret.textContent = '▾'
    workspaceButton.replaceChildren(`${presetName(presetOf(ws.switches))} `, caret)
  }
  paintWorkspaceButton()

  /**
   * THE ONE WRITER OF THE SWITCHES (spec §4). It persists, renames the button, repaints the menu under the
   * user's hand if it is open, says what changed, and re-renders the workspace — which is where Tasks 3, 4
   * and 5's three consumers hang.
   */
  const applySwitches = (): void => {
    paintWorkspaceButton()
    if (workspaceMenu.matches(':popover-open')) fillWorkspaceMenu()
  }
  const setSwitches = (next: Switches): void => {
    if (
      next.steps === ws.switches.steps &&
      next.views === ws.switches.views &&
      next.readout === ws.switches.readout
    )
      return
    ws = { ...ws, switches: next }
    persistWorkspace()
    applySwitches()
    notices.notify(`${presetName(presetOf(next))} — step controls ${next.steps === 'bar' ? 'in one bar' : 'in each view'}, ${next.views}, ${next.readout}`)
  }

  const fillWorkspaceMenu = (): void => {
    workspaceItems(
      workspaceMenu,
      { switches: ws.switches, reset: resetPresetButton },
      {
        preset: (p) => setSwitches(PRESETS[p]),
        // THE ONE NARROWING. `SwitchRow.value` is `string` (its own doc); this is where a value becomes a
        // `Switches[K]`, and an unknown one is dropped rather than stored — `parseWorkspace` would refuse
        // the whole envelope on the next load.
        flip: (key, value) => {
          const next = { ...ws.switches, [key]: value }
          const parsed = parseSwitchesValue(next)
          if (parsed !== null) setSwitches(parsed)
        },
      },
    )
  }
  wireMenu(workspaceButton, workspaceMenu, fillWorkspaceMenu)
```

`parseSwitchesValue` is `workspace.ts`'s existing `parseSwitches`, which is private today. **Export it** from `workspace.ts` under its own name and import it here:

```ts
/** The switch triple, validated — exported because `main.ts`'s menu is where a value becomes one. */
export function parseSwitches(v: unknown): Switches | null {
```

(change only the `function` line; the body is unchanged) and in `main.ts` import `parseSwitches` and call it directly in place of `parseSwitchesValue`.

`applySwitches` is deliberately small here and grows in Tasks 3, 4 and 5 — each adds one line to it.

- [ ] **Step 6: Style the groups**

Append to `web/src/style.css`, AFTER the `.header-menu > button` rule (Biome's `noDescendingSpecificity`):

```css
/* A SECTION OF THE WORKSPACE MENU — the preset choice, and one per switch (spec §4, §6). The group is a
   `role="group"` with an `aria-label`, so a reader hears which choice a row of values belongs to; the
   label is drawn from that same attribute rather than a second element holding a second copy of the word. */
.menu-group {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  padding: 0.15em 0.6em;
}
.menu-group::before {
  content: attr(aria-label);
  flex: 0 0 7rem;
  font-size: var(--step--2);
  color: var(--fg-dim);
  text-transform: var(--label-transform);
  letter-spacing: var(--label-tracking);
}
.menu-group button {
  font: inherit;
  padding: 0.05em 0.45em;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
/* The value in force, on the title menu's own idiom — a border, never colour alone (umbrella §4 rule 5,
   the accessibility list's item 7). */
.menu-group button[aria-current="true"] {
  border-color: var(--fg-dim);
}
/* The workspace menu is wider than the others, because a switch row is a label and two values. */
#workspace-menu {
  min-width: 20rem;
}
```

- [ ] **Step 7: Fix the two assertions on `#workspace`'s text**

In `web/tests/browser/app-header.test.ts`, line 19's case becomes:

```ts
  it('names the workspace after its preset', () => {
    const button = document.querySelector<HTMLButtonElement>('#workspace') as HTMLButtonElement
    expect(button.textContent?.trim()).toBe('Explorer ▾')
    // THE POSITIVE HALF: the glyph is in the label and out of the name (spec §6).
    expect(computeAccessibleName(button)).toBe('Explorer')
  })
```

and inside "resets the preset: the default views back, and says so", the assertion at line 53 becomes:

```ts
      expect(document.querySelector('#workspace')?.textContent?.trim()).toBe('Explorer ▾')
```

The comment above it — "THE SWITCH HALF CANNOT FAIL YET, AND IT IS HERE FOR WHEN IT CAN … 2b adds the three switches and this assertion starts discriminating" — **is now stale and must be rewritten in this commit**, not left standing:

```ts
      // THE SWITCHES AND THE FOCUS ARE TWO-THIRDS OF WHAT THE HANDLER DOES, and the leaf order above
      // measures neither: the button's name is the preset its switches make, and the stored focus is what
      // the workspace normalises to when the tree is replaced. **THE SWITCH HALF DISCRIMINATES NOW** —
      // `workspace-switches.test.ts` moves the switches, and a *reset preset* that dropped
      // `switches: PRESETS[preset]` would leave this button reading whatever the last pick made it.
```

Add `import { computeAccessibleName } from 'dom-accessibility-api'` to that file if it is not already there (it is — the appearance cases use it).

- [ ] **Step 8: Run the whole browser tier**

```bash
cd web && PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser
```

Expected: green. `controls-gate.test.ts`'s `['#workspace']` case now walks nine more buttons; each has an `aria-label` that equals its `title`, so the name-versus-label branch passes, and none is a bare glyph.

- [ ] **Step 9: Sabotage, once each, and record the assertion that fired**

1. In `main.ts`'s `paintWorkspaceButton`, drop the `aria-hidden` attribute. Expect `workspace-switches.test.ts`'s "carries a ▾ that the accessible name does not" red on `computeAccessibleName`, and `controls-gate.test.ts`'s `#workspace` case red on `straySymbol`. Revert.
2. In `workspaceItems`, append `state.reset` unconditionally. Expect "is custom when the switches match no preset" red on `expect(menu.querySelector('#reset-preset')).toBeNull()`. Revert.
3. In `workspaceItems`, drop the focus-restoring block after `replaceChildren`. Expect "keeps the focus on the switch that was picked" red on its first `expect(document.activeElement)`. Revert.
4. In `setSwitches`, skip `persistWorkspace()`. Expect "survives a reload" red on the stored switches, and "names itself after the preset a pick makes" red on its `stored().switches`. Revert.

- [ ] **Step 10: Commit**

```bash
cd web && pnpm exec biome ci --error-on-warnings src/app-header.ts src/main.ts src/workspace.ts src/style.css tests/browser/harness.ts tests/browser/workspace-switches.test.ts tests/browser/app-header.test.ts
cd .. && git add -A web/src web/tests web/index.html
git commit -m "The workspace menu holds the three presets and the three switches, names itself custom for the five combinations that are no preset, drops reset preset while it is, and the button that opens it finally carries a ▾ the screen reader does not say"
```

---
### Task 3: The bottom step bar, and its target

Spec §8 (*Where it mounts*, *The bar's target*), §11's fourth rule (a view's step controls go away when the bar takes them over).

**One component, two mount points.** `step-controls.ts` is unchanged: the bar is a second instance of it, with a title in front saying which view it drives. What is new is the target — the focused view when it can step, otherwise the last one that could — and the state where there is no such view at all.

**The disabled state is the spec's own exception to "removed, not disabled".** With no λ or TM view on screen the bar could apply — open one and it works — so it is disabled with its reason on its own readout, rather than removed (umbrella §4 rule 4).

**Files:**
- Modify: `web/src/sessions.ts` (`legControlState` extracted from `PaneSlot.render`; `PaneView.setStepsShown`)
- Modify: `web/src/view-header.ts` (`ViewHeader.setStepsShown`, handing the focus off)
- Modify: `web/src/lambda-pane.ts`, `web/src/tm-pane.ts` (`setStepsShown` delegates)
- Create: `web/src/step-bar.ts`
- Modify: `web/src/draw.ts` (push `setStepsShown`; update the bar once per frame)
- Modify: `web/src/main.ts` (build the bar, resolve its target, add a line to `applySwitches`)
- Modify: `web/index.html`, `web/tests/browser/harness.ts` (`#step-bar`), `web/tests/node/harness.test.ts` (its id)
- Modify: `web/src/style.css` (`.step-bar`)
- Test: `web/tests/node/step-bar.test.ts` (new), `web/tests/browser/step-bar.test.ts` (new)

**Interfaces:**
- Produces (`sessions.ts`): `legControlState<K extends Leg>(reg: SessionRegistry, binding: Binding<K>, leg: LegState<LegFrame[K]>): ControlState`; `PaneView.setStepsShown(shown: boolean): void`.
- Produces (`view-header.ts`): `ViewHeader.setStepsShown(shown: boolean): void`.
- Produces (`step-bar.ts`): `type BarTarget = { readonly id: LeafId; readonly title: string; readonly controls: ControlState }`; `NO_TARGET: ControlState`; `barTarget(focused: LeafId, steppable: readonly LeafId[], last: LeafId | null): LeafId | null`; `createStepBar(deps): { readonly el: HTMLElement; update(): void }`.
- Produces (`draw.ts` deps): `stepsInView: () => boolean`, `stepBar: { update(): void }`.
- Consumes: `focus-handoff.ts`'s `handOff`/`nearest` (Task 1); `main.ts`'s `applySwitches` (Task 2).

- [ ] **Step 1: Write the failing node test for the target rule**

Create `web/tests/node/step-bar.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { barTarget, NO_TARGET } from '../../src/step-bar'

describe('barTarget', () => {
  it('is the focused view when that view can step', () => {
    expect(barTarget('tm-0', ['lambda-0', 'tm-0'], 'lambda-0')).toBe('tm-0')
  })

  // §8: "otherwise the last view that could". A focused SOURCE view is the ordinary way to reach this.
  it('keeps the last view that could step when the focused one cannot', () => {
    expect(barTarget('source', ['lambda-0', 'tm-0'], 'tm-0')).toBe('tm-0')
  })

  // §8: "Closing the target retargets to `focused` if it can step, else the first λ or TM leaf."
  it('falls to the first view that can step when the last one has closed', () => {
    expect(barTarget('source', ['lambda-0', 'tm-0'], 'tm-9')).toBe('lambda-0')
  })

  it('has no target when no view can step', () => {
    expect(barTarget('source', [], 'lambda-0')).toBeNull()
  })

  // **DISABLED WITH ITS REASON, NOT REMOVED** — umbrella §4 rule 4, and the reason is on the readout
  // where a step count would be.
  it('says why it is disabled when there is no target', () => {
    expect(NO_TARGET.stepText).toBe('no view can step')
    expect(NO_TARGET.canBack).toBe(false)
    expect(NO_TARGET.canForward).toBe(false)
    expect(NO_TARGET.canPlay).toBe(false)
    expect(NO_TARGET.canRestart).toBe(false)
    expect(NO_TARGET.continueLabel).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && pnpm exec vitest run --project node tests/node/step-bar.test.ts
```

Expected: cannot resolve `../../src/step-bar`.

- [ ] **Step 3: Extract `legControlState` in `sessions.ts`**

Above `PaneSlot`, add:

```ts
/**
 * One leg's `ControlState` — what a step control shows for it.
 *
 * **EXTRACTED FROM `PaneSlot.render` BECAUSE THERE ARE TWO STEP CONTROLS NOW** (Plan 7 part 2 spec §8): a
 * view's own, and the one bar. The bar drives a leg it reaches through the layout, not through a slot it
 * owns, so it cannot go through `render` — and a second copy of this argument list is the two-places-to-be-
 * wrong failure `LegState`'s own doc refuses one type up. The `awaitingRun` read is per SESSION and not per
 * leg, which is exactly the subtlety a copy would lose.
 */
export function legControlState<K extends Leg>(
  reg: SessionRegistry,
  binding: Binding<K>,
  leg: LegState<LegFrame[K]>,
): ControlState {
  return controlState({
    available: leg.status.available,
    reason: leg.status.reason,
    head: leg.hist.head,
    length: leg.hist.length,
    oldestStep: leg.hist.oldestStep,
    currentStep: leg.hist.currentStep,
    newestStep: leg.hist.newestStep,
    evicted: leg.hist.evicted,
    done: leg.done,
    // PER SESSION, NOT PER LEG — the generation is the client's, and both legs of one session share it.
    awaitingRun: reg.entryOf(binding.session).client.awaitingRun,
    playing: leg.playing,
  })
}
```

and in `PaneSlot.render`, replace the inline `controlState({ … })` argument with `legControlState(reg, b, leg)`. The paragraph in `render`'s doc that explains the `awaitingRun` read moves to `legControlState` above; leave `render`'s doc pointing at it rather than repeating it.

Add `setStepsShown` to `PaneView`:

```ts
  /**
   * Whether this view draws its own step controls — `false` while the `steps` switch is `bar` (spec §8).
   *
   * **REMOVED, NOT HIDDEN** (umbrella §4 rule 4): the bar is the only step control on the page while it is
   * up, so a view's own are a control that cannot apply there. A hidden-but-present copy would also be a
   * second thing `tests/browser/controls-gate.test.ts` walks and a second thing a `Tab` reaches.
   */
  setStepsShown(shown: boolean): void
```

- [ ] **Step 4: Give `ViewHeader` the setter**

In `web/src/view-header.ts`, add `import { handOff, nearest } from './focus-handoff'`, add the member to `ViewHeader`:

```ts
  /** Whether the step slot is in the header at all — spec §8's `steps` switch. */
  setStepsShown(shown: boolean): void
```

and in `viewHeader`, after `const { el, heading, steps, actions } = frame()`, add:

```ts
  let stepsShown = true
```

and in the returned object, beside `setDetached`:

```ts
    setStepsShown(shown: boolean): void {
      if (shown === stepsShown) return
      stepsShown = shown
      if (shown) {
        // BEFORE THE ACTIONS, so the header keeps §7's order: title · status · step controls · ⋯ · ✕.
        el.insertBefore(steps, actions)
        return
      }
      // A CONTROL REMOVED BY A STATE CHANGE MUST NOT TAKE THE FOCUS WITH IT — spec §11's fourth rule,
      // the same rule the continue button already follows, applied to a whole slot rather than one
      // button (`focus-handoff.ts`). The user is standing on `▶` and flips the `steps` switch in the
      // header's menu: without this, focus falls to `<body>`.
      handOff(steps, nearest(el, steps))
      steps.remove()
    },
```

`sourceViewHeader` is untouched: it removes `steps` at construction and returns no `ViewHeader`, so it has no setter to grow.

- [ ] **Step 5: Delegate from both panes**

In `web/src/lambda-pane.ts` and `web/src/tm-pane.ts`, beside each class's `setDetached`:

```ts
  /** Spec §8's `steps` switch, per `PaneView.setStepsShown` — the header owns the slot. */
  setStepsShown(shown: boolean): void {
    this.#header.setStepsShown(shown)
  }
```

- [ ] **Step 6: Write `step-bar.ts`**

Create `web/src/step-bar.ts`:

```ts
import type { ControlState } from './controls'
import type { PaneEvents } from './pane-chrome'
import type { LeafId } from './panes'
import { stepControls } from './step-controls'
import type { Speed } from './workspace'

/**
 * THE ONE STEP BAR — Plan 7 part 2 spec §8, the `steps` switch at `bar`: one set of step controls along the
 * bottom of the workspace, prefixed with the title of the view it drives.
 *
 * **IT IS `step-controls.ts` AGAIN, NOT A SECOND TRANSPORT.** Everything about what is live, what the play
 * button shows and what the readout says is `controls.ts`'s `ControlState`, reached here through
 * `sessions.ts`'s `legControlState` exactly as a view's own controls reach it through `PaneSlot.render`. What
 * this module adds is which leg, and the words saying so.
 *
 * **THE TITLE IS NOT DECORATION.** One bar driving one of several views is ambiguous the moment there are
 * two; `λ · program` in front of it is what makes every button's meaning unambiguous, and it is the same
 * spelling the view's own title-selector uses (`view-header.ts`'s `pairLabel`), so the two name the same
 * view the same way.
 */

/** What the bar is pointed at right now: the view, its title, and its leg's controls. */
export type BarTarget = {
  readonly id: LeafId
  readonly title: string
  readonly controls: ControlState
}

/**
 * The state the bar shows when no view on the page can step (spec §8).
 *
 * **DISABLED WITH ITS REASON, NOT REMOVED** (umbrella §4 rule 4): a bar that vanished when the last λ view
 * closed would leave a user who chose "one bar" with no step controls and nothing saying why. It could
 * apply — opening a view is all it takes — so it says so where the step count goes.
 */
export const NO_TARGET: ControlState = {
  canBack: false,
  canForward: false,
  canPlay: false,
  canRestart: false,
  playing: false,
  continueLabel: null,
  stepText: 'no view can step',
}

/**
 * Which view the bar drives: the focused one when it can step, otherwise the last one that could, otherwise
 * the first that can (spec §8).
 *
 * **PURE, AND SEPARATE FROM THE COMPONENT, BECAUSE THE RULE IS THE PART WORTH PINNING.** "Closing the target
 * retargets" and "a focused source view does not blank the bar" are two sentences about this function and
 * nothing else; a browser test would reach them through a layout gesture and report a DOM state when the
 * question is arithmetic over three ids.
 *
 * `last` IS THE CALLER'S MEMORY, NOT THIS FUNCTION'S. A module-level `let` here would be one memory shared
 * by every caller, which is the shape that makes a second workspace on one page impossible to test.
 */
export function barTarget(focused: LeafId, steppable: readonly LeafId[], last: LeafId | null): LeafId | null {
  if (steppable.includes(focused)) return focused
  if (last !== null && steppable.includes(last)) return last
  return steppable[0] ?? null
}

/**
 * Build the bar.
 *
 * `target` AND `events` ARE BOTH THUNKS, AND BOTH ARE READ AT THE CLICK. `stepControls` wires its listeners
 * once, at construction, so a handler closed over a target would drive whichever view was focused when the
 * page loaded, for the rest of the session.
 */
export function createStepBar(deps: {
  target(): BarTarget | null
  events(id: LeafId): Pick<PaneEvents, 'back' | 'forward' | 'play' | 'restart' | 'extend'> | null
  speed(): Speed
  setSpeed(s: Speed): void
}): { readonly el: HTMLElement; update(): void } {
  const el = document.createElement('div')
  el.className = 'step-bar-inner'

  const title = document.createElement('span')
  title.className = 'step-bar-title'

  const run = (what: (e: Pick<PaneEvents, 'back' | 'forward' | 'play' | 'restart' | 'extend'>) => void): void => {
    const t = deps.target()
    if (t === null) return
    const e = deps.events(t.id)
    if (e !== null) what(e)
  }

  const controls = stepControls({
    speed: deps.speed,
    setSpeed: deps.setSpeed,
    back: () => run((e) => e.back()),
    forward: () => run((e) => e.forward()),
    play: () => run((e) => e.play()),
    restart: () => run((e) => e.restart()),
    extend: () => run((e) => e.extend()),
  })

  el.append(title, controls.el)

  let rendered: string | null = null
  return {
    el,
    update(): void {
      const t = deps.target()
      const text = t === null ? '' : t.title
      // COMPARED BEFORE IT IS WRITTEN, for `createReadout`'s reason: this runs on every recorded frame
      // during playback and the title changes only when the focus moves.
      if (rendered !== text) {
        rendered = text
        title.textContent = text
        title.hidden = text === ''
      }
      controls.update(t === null ? NO_TARGET : t.controls)
    },
  }
}
```

- [ ] **Step 7: Run the node test and watch it pass**

```bash
cd web && pnpm exec vitest run --project node tests/node/step-bar.test.ts
```

Expected: 5 passed.

- [ ] **Step 8: Add `#step-bar` to the markup, in three files**

In `web/index.html`, between `</main>` and `<div id="editor">`:

```html
    <div id="step-bar" class="step-bar" hidden></div>
```

Make the identical change inside `SHELL` in `web/tests/browser/harness.ts`. In `web/tests/node/harness.test.ts`, add `'#step-bar'` to the id list its `describe('SHELL')` asserts — **the list holds `#`-prefixed selectors** and the loop asserts `` SHELL.toContain(`id="${sel.slice(1)}"`) ``, so a bare `'step-bar'` would assert `id="tep-bar"` and pass against nothing.

**The bar is below the views and above the strip**, which is where §8 and §9 put them: the readout is the last line of the workspace.

- [ ] **Step 9: Drive it from `draw.ts`**

Add two deps to `createDraw`'s object, documented beside `leaves`/`sourceAvailable`:

```ts
  /** Whether a view draws its own step controls — spec §8's `steps` switch. A thunk, for `leaves`' reason. */
  stepsInView: () => boolean
  /** The one bottom bar, updated once per frame after every pane has been painted (spec §8). */
  stepBar: { update(): void }
```

destructure them with the rest, add one line inside the per-pane loop, after the `setLayoutControls` call:

```ts
      // WHICH STEP CONTROLS THIS VIEW DRAWS — driven from here for `setLayoutControls`' reason one line
      // up: it is a fact about the workspace rather than about the frame just rendered, so the per-frame
      // pass is the only hook a caller with no render loop of its own has.
      p.pane.setStepsShown(stepsInView())
```

and one line at the very end of the returned closure, after the readout block:

```ts
    // THE BAR (spec §8), AFTER THE READOUT AND AFTER EVERY PANE. It resolves its own target through the
    // thunks `main.ts` gave it — this call is only "a frame has been painted, say what is true now".
    stepBar.update()
```

- [ ] **Step 10: Wire it in `main.ts`**

Near the other host lookups, add:

```ts
  const stepBarHost = document.querySelector<HTMLElement>('#step-bar')
```

and add `!stepBarHost ||` to the guard that throws when the shell is incomplete.

After `paneHost` is constructed and `focusedLeaf` exists, add:

```ts
  /**
   * WHICH VIEW THE BAR DRIVES, AND THE MEMORY BEHIND "the last view that could step" (spec §8).
   *
   * **THE MEMORY IS WRITTEN ONLY WHEN A TARGET RESOLVES**, so a focused source view keeps the bar pointed at
   * the view it was driving rather than blanking it — which is the whole of §8's second sentence.
   */
  let lastSteppable: LeafId | null = null
  const barTargetNow = (): BarTarget | null => {
    // EVERY PANE IS STEPPABLE: the source LEAF has no `PaneEntry` at all (`draw.ts`'s readout block says
    // so from the other side), so this list is already "every λ or TM view on the page".
    const id = barTarget(
      focusedLeaf(),
      panes.all().map((p) => p.id),
      lastSteppable,
    )
    if (id === null) return null
    const entry = panes.get(id)
    if (entry === undefined) return null
    lastSteppable = id
    const b = entry.slot.binding
    const option = sessions.pairs().find((o) => o.leg === b.leg && o.id === b.session)
    return {
      id,
      // THE VIEW'S OWN TITLE, THROUGH THE SAME FUNCTION ITS TITLE-SELECTOR USES — one spelling for one
      // view, so the bar and the header cannot disagree about what it is called.
      title: option === undefined ? '' : pairLabel(option),
      controls: legControlState(sessions, b, entry.slot.resolve(sessions)),
    }
  }

  const stepBar = createStepBar({
    target: barTargetNow,
    events: (id) => {
      const entry = panes.get(id)
      return entry === undefined ? null : transport.events(entry.slot)
    },
    speed: () => ws.speed,
    setSpeed: (s) => {
      ws = { ...ws, speed: s }
      persistWorkspace()
      draw()
    },
  })
  stepBarHost.append(stepBar.el)
```

**`speed`/`setSpeed` are the same pair `transport` was built with** — read `main.ts`'s existing `createTransport` call and pass the identical two expressions rather than inventing a second reader of `ws.speed`. If that call already names them as local consts, use those consts here.

Pass the two new deps at the `createDraw` call:

```ts
    stepsInView: () => ws.switches.steps === 'view',
    stepBar,
```

and add one line to `applySwitches`:

```ts
    stepBarHost.hidden = ws.switches.steps !== 'bar'
```

with a first call to `applySwitches()` placed immediately after the first `paneHost.applyLayout()` so a restored workspace shows the bar it was left with.

Imports to add: `createStepBar`, `barTarget`, `type BarTarget` from `./step-bar`; `legControlState` from `./sessions`. **`pairLabel` is already imported** in `main.ts`, on the line that also brings in `sourceViewHeader` and `viewMenu` — widen nothing, add nothing.

- [ ] **Step 11: Style it**

Append to `web/src/style.css`, AFTER the `.view-steps .controls` rule:

```css
/* THE ONE STEP BAR (spec §8): the `steps` switch at `bar`. It sits below the views and above the readout,
   on the raised surface the strip uses, because the two together are the workspace's bottom edge. */
.step-bar {
  display: flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border-top: 1px solid var(--rule);
  background: var(--bg-raised);
}
.step-bar[hidden] {
  display: none;
}
.step-bar-inner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
/* The view it drives, in the title-selector's own spelling (`step-bar.ts`). */
.step-bar-title {
  font-family: var(--font-mono);
  font-size: var(--step--1);
  color: var(--fg-dim);
}
.step-bar-title[hidden] {
  display: none;
}
/* In the bar the controls are on the title's line, so they lose `.controls`' own top margin — the same
   override `.view-steps .controls` makes, and AFTER `.controls` for Biome's `noDescendingSpecificity`. */
.step-bar .controls {
  margin-top: 0;
}
```

- [ ] **Step 12: Write the failing browser test**

Create `web/tests/browser/step-bar.test.ts`:

```ts
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

const menu = (): HTMLElement => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  return document.querySelector<HTMLElement>('#workspace-menu') as HTMLElement
}
const pick = (sel: string): void => {
  menu().querySelector<HTMLButtonElement>(sel)?.click()
  const m = document.querySelector<HTMLElement>('#workspace-menu')
  if (m?.matches(':popover-open')) m.hidePopover()
}
const bar = (): HTMLElement => document.querySelector<HTMLElement>('#step-bar') as HTMLElement
const barTitle = (): string => bar().querySelector('.step-bar-title')?.textContent?.trim() ?? ''
const barStep = (): string => bar().querySelector('.step-bar-inner .step')?.textContent?.trim() ?? ''
const viewControls = (leaf: string): Element | null =>
  document.querySelector(`[data-leaf="${leaf}"] .view-steps .controls`)

describe('the step bar', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    const view: EditorView = await (await import('../../src/main')).ready
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
    await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  })

  it('is not on the page while the step controls are in each view', () => {
    expect(bar().hidden).toBe(true)
    expect(viewControls('lambda-0')).not.toBeNull()
  })

  it('takes the controls out of every view when the switch moves to one bar, and names what it drives', () => {
    pick('[data-switch="steps"][data-value="bar"]')
    expect(bar().hidden).toBe(false)
    expect(viewControls('lambda-0')).toBeNull()
    expect(viewControls('tm-0')).toBeNull()
    expect(barTitle()).toBe('λ · program')
  })

  it('follows the focused view', () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="tm-0"] button.view-title')?.focus()
    document.querySelector<HTMLElement>('[data-leaf="tm-0"]')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(barTitle()).toBe('TM · program')
  })

  // §8: the focused view is the SOURCE view, which cannot step — the bar keeps the last one that could.
  it('keeps the last view that could step when the source view takes the focus', () => {
    document
      .querySelector<HTMLElement>('[data-leaf="source"]')
      ?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(barTitle()).toBe('TM · program')
    expect(barStep()).not.toBe('no view can step')
  })

  it('steps the view it names', () => {
    const before = barStep()
    bar().querySelector<HTMLButtonElement>('button[aria-label="one step forward"]')?.click()
    expect(barStep()).not.toBe(before)
  })

  // Spec §11's fourth rule, second instance: the slot the focus is in is removed by a switch.
  it('does not strand the focus when the switch takes a view’s controls away', () => {
    pick('[data-switch="steps"][data-value="view"]')
    const forward = document.querySelector<HTMLButtonElement>(
      '[data-leaf="lambda-0"] .view-steps button[aria-label="one step forward"]',
    )
    expect(forward, 'the view has no step controls to stand on').not.toBeNull()
    forward?.focus()
    pick('[data-switch="steps"][data-value="bar"]')
    expect(document.activeElement).not.toBe(document.body)
    expect(document.querySelector('[data-leaf="lambda-0"]')?.contains(document.activeElement)).toBe(true)
    pick('[data-preset="explorer"]')
  })
})
```

**The "no view can step" state is not driven here.** Reaching it means closing every λ and TM view, which leaves the shared page in a state the cases above cannot run from, and the rule itself is `barTarget`'s — pinned by the node test's "has no target when no view can step" and "says why it is disabled". Record that division in the roadmap entry rather than leaving it to be noticed.

- [ ] **Step 13: Run both tiers**

```bash
cd web && pnpm exec vitest run --project node
cd web && PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser
```

Expected: green. `controls-gate.test.ts` still walks the page in Explorer only, where the bar is `hidden` and therefore skipped by its `[hidden]` filter; Task 6 is what walks it in the other presets.

- [ ] **Step 14: Sabotage, once each, and record the assertion that fired**

1. In `barTarget`, return `steppable[0] ?? null` before the `last` clause. Expect `tests/node/step-bar.test.ts`'s "keeps the last view that could step" red, and `tests/browser/step-bar.test.ts`'s "keeps the last view that could step when the source view takes the focus" red on `toBe('TM · program')`. Revert.
2. In `main.ts`'s `barTargetNow`, write `lastSteppable = id` before the `entry === undefined` guard. Expect nothing red — **record that**: no test closes a view while the bar drives it, which is the one gesture that reaches an id with no entry. Revert.
3. In `ViewHeader.setStepsShown`, drop the `handOff` call. Expect the browser file's "does not strand the focus" red on `expect(document.activeElement).not.toBe(document.body)`. Revert.
4. In `draw.ts`, pass `true` to `setStepsShown`. Expect "takes the controls out of every view" red on `expect(viewControls('lambda-0')).toBeNull()`. Revert.
5. In `step-bar.ts`'s `update`, pass `t.controls` even when `t` is null (guard removed). Expect a TypeScript error at `pnpm run typecheck` rather than a red test — record it as a gate, not a test. Revert.

- [ ] **Step 15: Commit**

```bash
cd web && pnpm exec biome ci --error-on-warnings src/step-bar.ts src/sessions.ts src/view-header.ts src/lambda-pane.ts src/tm-pane.ts src/draw.ts src/main.ts src/style.css tests/browser/harness.ts tests/node/harness.test.ts tests/node/step-bar.test.ts tests/browser/step-bar.test.ts
cd .. && git add -A web
git commit -m "The steps switch moves every view's step controls into one bar along the bottom, which names the view it drives, keeps the last view that could step when the focus moves somewhere that cannot, and says so rather than vanishing when nothing can"
```

---

### Task 4: The inspector

Spec §9 (*The inspector*), §3 (where its state lives), §13.

**One decision the spec left open, settled here.** §9 says the inspector's open state is "kept in `panels` under the key `inspector`", but §3 types `panels` as `Record<LeafId, …>` and makes an entry keyed by a leaf not in the tree invalidate the whole envelope. There is one inspector and it is not a view's panel, so it gets **its own field on the workspace**: `inspector: boolean`. A workspace 2a already wrote has no such field, so a MISSING `inspector` defaults to open while a PRESENT non-boolean one invalidates the envelope like every other field — the distinction between "this version did not write it" and "this value is wrong", which §3's strictness is about.

**`#results` and `#link-status` move with the readout and keep their ids.** 24 browser test files wait on `#results[data-state]`, and §9 requires that attribute to be the program's compile state whatever the readout is describing. The readout's hosts are therefore relocated between `footer.strip` and the inspector column rather than duplicated — one element rendering the rows in both modes, so there is no second place for `data-state` to be written or forgotten.

**Files:**
- Modify: `web/src/workspace.ts` (`inspector`)
- Modify: `web/src/readout.ts` (row builders; `createReadout` gains a mode)
- Modify: `web/src/draw.ts` (hand the readout both shapes as thunks)
- Modify: `web/src/main.ts` (the inspector panel; relocate the hosts; a line in `applySwitches`)
- Modify: `web/index.html`, `web/tests/browser/harness.ts`, `web/tests/node/harness.test.ts` (`#views`, `#inspector`)
- Modify: `web/src/style.css` (`main` becomes a row; `.inspector`)
- Test: `web/tests/browser/inspector.test.ts` (new)
- Modify tests: `web/tests/node/workspace.test.ts`, `web/tests/node/readout.test.ts`

**Interfaces:**
- Produces (`workspace.ts`): `Workspace.inspector: boolean`; `defaultWorkspace()` returns `inspector: true`.
- Produces (`readout.ts`): `type Row = { readonly label: string; readonly value: string }`; `programRows(r: ProgramResult | null): Row[]`; `lambdaCopyRows(name, leg): Row[]`; `tmCopyRows(name, reading, leg): Row[]`; `createReadout(host)` gains `setMode(m: ReadoutSwitch): void` and `show(program, lines: { segments(): readonly string[]; rows(): readonly Row[] })`.
- Produces (`main.ts`, in scope for later tasks): `root` is now `#views`.

- [ ] **Step 1: Write the failing node tests**

Append to `web/tests/node/workspace.test.ts`, inside `describe('parseWorkspace')`:

```ts
  // **A FIELD 2a DID NOT WRITE IS NOT AN INVALID FIELD.** Version 2 shipped without `inspector`, so a
  // stored workspace from part 2a has none; refusing it would reset every upgrading user's layout, which
  // is the one thing the version 2 envelope exists to avoid.
  it('defaults a missing inspector to open, and refuses one that is not a boolean', () => {
    const base = {
      version: 2,
      tree: SPLIT,
      switches: PRESETS.explorer,
      speed: 8,
      focused: 'lambda-0',
      panels: {},
    }
    expect(parseWorkspace(JSON.stringify(base))?.inspector).toBe(true)
    expect(parseWorkspace(JSON.stringify({ ...base, inspector: false }))?.inspector).toBe(false)
    expect(parseWorkspace(JSON.stringify({ ...base, inspector: 'yes' }))).toBeNull()
  })

  it('opens the inspector for a migrated version 1 layout', () => {
    expect(parseWorkspace(serializeLayout(SPLIT))?.inspector).toBe(true)
  })
```

and inside `describe('serializeWorkspace')` add an `expect(JSON.parse(raw).inspector).toBe(false)` to a round-trip with `inspector: false`; extend the existing `describe('defaultWorkspace')` case with `expect(defaultWorkspace().inspector).toBe(true)`. **Every existing object literal of type `Workspace` in this file gains `inspector`** — the type is not optional, so `typecheck` names each one.

Append to `web/tests/node/readout.test.ts`:

```ts
describe('programRows', () => {
  // §9: "Every row on its own line, the normal-form text included" — which is exactly what the strip
  // leaves out, and the one difference between the two readouts' content.
  it('keeps the normal-form text the strip drops, one row per fact', () => {
    const rows = programRows({ kind: 'result', lambda: LAMBDA, tm: TM })
    expect(rows.map((r) => r.label)).toContain('normal form')
    expect(rows.every((r) => r.label !== '' && r.value !== '')).toBe(true)
  })

  it('says a program that does not compile, with the error count', () => {
    const rows = programRows({ kind: 'no-session', diagnostics: [] })
    expect(rows.map((r) => r.value).join(' ')).toContain('not compiled')
  })

  it('has no rows for a worker error, which the banner shows instead', () => {
    expect(programRows({ kind: 'error', error: new Error('x') })).toEqual([])
    expect(programRows(null)).toEqual([])
  })
})

describe('lambdaCopyRows and tmCopyRows', () => {
  it('give a copy the same facts its segment gives, one per row', () => {
    const rows = lambdaCopyRows('λ copy 1', { newestStep: 3, done: null, status: { available: true, reason: '' } })
    expect(rows[0]?.label).toBe('λ copy 1')
    expect(rows.map((r) => r.value).join(' ')).toContain('3 reductions')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd web && pnpm exec vitest run --project node tests/node/workspace.test.ts tests/node/readout.test.ts
```

Expected: the workspace cases fail on `?.inspector` being `undefined`; the readout cases fail to import `programRows`.

- [ ] **Step 3: Add `inspector` to `workspace.ts`**

In `type Workspace`, after `panels`:

```ts
  /**
   * Whether the inspector is open — spec §9, and the one field that is NOT a view's panel.
   *
   * **NOT IN `panels`, THOUGH §9's SENTENCE READS THAT WAY.** `panels` is keyed by `LeafId` and
   * `parseWorkspace` refuses an entry naming a leaf the tree does not hold; there is one inspector, it
   * belongs to the workspace rather than to a view, and keying it on the FOCUSED view would collapse and
   * re-open it as the focus moved.
   */
  readonly inspector: boolean
```

In `defaultWorkspace`, add `inspector: true`. In `serializeWorkspace`, add `inspector: ws.inspector` to the object. In `parseWorkspace`, add `inspector: true` to the version 1 branch's return, and in the version 2 arm, above the final return:

```ts
  // **A MISSING `inspector` IS NOT AN INVALID ONE.** Version 2 shipped in part 2a without this field, so
  // every workspace stored before this change has none — refusing them would reset the layout of exactly
  // the users the version 2 envelope was built to carry across. A field that IS there and is not a boolean
  // is held to §3's standard like every other.
  if (e.inspector !== undefined && typeof e.inspector !== 'boolean') return null
  const inspector = e.inspector ?? true
```

and add `inspector` to the returned object.

- [ ] **Step 4: Add the row builders to `readout.ts`**

Append to `web/src/readout.ts`:

```ts
/**
 * One line of the inspector: what it is, and what it says.
 *
 * **A LABEL AND A VALUE, WHERE THE STRIP HAS ONLY A VALUE.** The strip joins facts with `·` on one line,
 * so each has to carry its own noun (`width 8`); the inspector has a line per fact and a column for the
 * noun, which is what makes the normal form — the one fact the strip cannot hold — fit.
 */
export type Row = { readonly label: string; readonly value: string }

/**
 * The program's rows for the inspector (spec §9) — `results.ts`'s own rows, which is the whole point: the
 * inspector is the readout `#results` always wanted to be, and the compression into segments is the strip's
 * special case rather than the other way round.
 */
export function programRows(r: ProgramResult | null): Row[] {
  if (r === null || r.kind === 'error') return []
  if (r.kind === 'no-session') return noSessionRows([...r.diagnostics]).map((row) => ({ label: row.label, value: row.value }))
  return resultRows(r.lambda, r.tm).map((row) => ({ label: `${row.leg} ${row.label}`, value: row.value }))
}

/** A λ copy's rows: its name, then what its segment says, split at the `·` the strip joins them with. */
export function lambdaCopyRows(name: string, leg: Parameters<typeof lambdaCopySegments>[1]): Row[] {
  return splitCopy(name, lambdaCopySegments(name, leg))
}

/** A TM copy's rows, by `lambdaCopyRows`' rule. */
export function tmCopyRows(
  name: string,
  reading: TmScratchReading | null,
  leg: Parameters<typeof tmCopySegments>[2],
): Row[] {
  return splitCopy(name, tmCopySegments(name, reading, leg))
}

/**
 * Turn a copy's one joined segment back into rows.
 *
 * **BUILT FROM THE SEGMENT RATHER THAN BESIDE IT, SO THE TWO READOUTS CANNOT DISAGREE ABOUT A COPY.** The
 * copy builders above already decide what a copy says and in what order; a second pair assembling the same
 * facts into rows would be two places to be wrong about a stop reason or a reduced-file sentence. The copy's
 * NAME is the first row's label and is dropped from the values, which is the only thing the join added.
 */
function splitCopy(name: string, segments: readonly string[]): Row[] {
  const [line] = segments
  if (line === undefined) return []
  const parts = line.split(' · ')
  const rest = parts[0] === name ? parts.slice(1) : parts
  if (rest.length === 0) return [{ label: name, value: parts.join(' · ') }]
  const first = rest[0] as string
  return [{ label: name, value: first }, ...rest.slice(1).map((v) => ({ label: '', value: v }))]
}
```

Add `resultRows`'s siblings to the import from `./results` if they are not already there (`noSessionRows` and `resultRows` both are).

Change `createReadout` to hold a mode and take thunks:

```ts
export function createReadout(host: HTMLElement): {
  setMode(mode: ReadoutSwitch): void
  show(program: ProgramResult | null, lines: { segments(): readonly string[]; rows(): readonly Row[] }): void
} {
  let rendered = ''
  let mode: ReadoutSwitch = 'strip'
  return {
    setMode(next) {
      if (next === mode) return
      mode = next
      // THE RENDERED KEY IS PER MODE, so a switch repaints even when the facts did not change.
      rendered = ''
    },
    show(program, lines) {
      // … the `describes` block and the `error` arm are unchanged …
      const key =
        mode === 'strip'
          ? `s\x02${lines.segments().join('\x01')}`
          : `i\x02${lines.rows().map((r) => `${r.label}\x00${r.value}`).join('\x01')}`
      if (key === rendered) return
      rendered = key
      if (mode === 'strip') {
        host.replaceChildren(/* … today's segment spans, unchanged … */)
        return
      }
      host.replaceChildren(
        ...lines.rows().map((r) => {
          const el = document.createElement('div')
          el.className = 'row'
          const label = document.createElement('span')
          label.className = 'row-label'
          label.textContent = r.label
          const value = document.createElement('span')
          value.className = 'row-value'
          value.textContent = r.value
          el.append(label, value)
          return el
        }),
      )
    },
  }
}
```

**THUNKS, NOT TWO ARRAYS.** `show` runs on every recorded frame during playback and each shape costs a walk of `results.ts`'s builders; handing over both would pay for the one the mode is not showing, on every frame, forever. Say that in the doc comment.

Import `type ReadoutSwitch` from `./workspace`.

- [ ] **Step 5: Hand `draw.ts` both shapes**

In `draw.ts`, change the readout's type in the deps to match, import the row builders, and replace the two `readout.show(...)` calls:

```ts
      readout.show(program(), {
        segments: () => programSegments(program()),
        rows: () => programRows(program()),
      })
```

and for a copy:

```ts
      readout.show(null, {
        segments: () =>
          entry.slot.binding.leg === 'lambda' ? lambdaCopySegments(name, legFacts) : tmCopySegments(name, reading, legFacts),
        rows: () =>
          entry.slot.binding.leg === 'lambda' ? lambdaCopyRows(name, legFacts) : tmCopyRows(name, reading, legFacts),
      })
```

where `legFacts` and `reading` are hoisted out of today's ternary so both thunks read the same values — today's code builds them inline inside one branch.

- [ ] **Step 6: Split `<main>` in three files**

In `web/index.html`, replace `<main></main>` with:

```html
    <main>
      <div id="views"></div>
      <aside id="inspector" class="inspector" hidden></aside>
    </main>
```

Make the identical change inside `SHELL` in `web/tests/browser/harness.ts`. `tests/node/harness.test.ts`'s last line asserts `expect(SHELL).toContain('<main></main>')`, so **that assertion changes too** — to `expect(SHELL).toContain('<div id="views"></div>')` — and `'#views'` and `'#inspector'` join its id list, `#`-prefixed like every row (the loop slices the `#` off).

**`renderLayout` gets its own root, and that is what makes the inspector possible at all.** `renderLayout` opens with `root.replaceChildren()`, so an inspector inside `<main>` beside the layout tree would be destroyed on the first commit. `#views` is the tree's root now and `#inspector` is its sibling.

- [ ] **Step 7: Wire it in `main.ts`**

Change the root lookup:

```ts
  const root = document.querySelector<HTMLElement>('#views')
```

add `const inspectorHost = document.querySelector<HTMLElement>('#inspector')` and `const strip = document.querySelector<HTMLElement>('footer.strip')`, and add both to the shell guard.

After `notices` is built and before `createDraw`, build the panel:

```ts
  /**
   * THE INSPECTOR (spec §9): the readout as a right-hand column, one fact per line.
   *
   * **ITS BODY HOLDS `#results` AND `#link-status` THEMSELVES**, moved out of the strip rather than copied.
   * `#results[data-state]` is the program's compile state and 24 browser test files wait on it; two
   * elements would be two places for that attribute to be written, and the second one is where it would be
   * forgotten.
   */
  const inspectorBody = document.createElement('div')
  inspectorBody.className = 'inspector-body'
  const inspectorPanel = createPanel({
    name: 'inspector',
    label: 'inspector',
    body: inspectorBody,
    open: ws.inspector,
    onToggle: (open) => {
      ws = { ...ws, inspector: open }
      persistWorkspace()
    },
  })
  inspectorHost.append(inspectorPanel.el)
```

and add to `applySwitches`:

```ts
    // THE READOUT'S HOSTS MOVE; THEIR IDS DO NOT (spec §9).
    const intoInspector = ws.switches.readout === 'inspector'
    inspectorHost.hidden = !intoInspector
    strip.hidden = intoInspector
    const home = intoInspector ? inspectorBody : strip
    if (results.parentElement !== home) home.append(results, linkStatusHost)
    readout.setMode(ws.switches.readout)
    draw()
```

**`main.ts` does not import `createPanel` today** — part 1's panels are built inside `tm-pane.ts` and `pane-chrome.ts`, not here. Add `import { createPanel } from './panel'`.

- [ ] **Step 8: Style it**

`main` becomes a row, and `#views` takes the column-ness `main` had. Replace the `main` rule in `web/src/style.css`:

```css
/* `main` IS A ROW NOW: the views on the left, the inspector on the right (spec §9). The column-ness, the
   `align-items: stretch` and the `min-height: 0` that a divider drag depends on move down to `#views`,
   which is the element `renderLayout` owns — see its own note on why the layout tree needed a root of its
   own the moment anything else lived inside `main`. */
main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: row;
  align-items: stretch;
  min-height: 0;
}
#views {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
  min-height: 0;
}
```

and append, after the `.results .segment` rule (Biome's `noDescendingSpecificity`):

```css
/* THE INSPECTOR (spec §9): a fixed-width right-hand column, collapsible to its header, scrolling its own
   rows. `panel.ts` builds the header; this decides the column. */
.inspector {
  display: flex;
  flex-direction: column;
  flex: 0 0 18rem;
  min-height: 0;
  border-inline-start: 1px solid var(--rule);
  background: var(--bg-raised);
}
.inspector[hidden] {
  display: none;
}
.inspector > .panel {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  margin-block-start: 0;
}
/* THE ROWS SCROLL, AND THE COLUMN DOES NOT. `.panel` sets no bounds of its own (its own note), so a long
   normal form has to be given one here or it makes the page scroll. */
.inspector-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--step--1);
}
.inspector-body .row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0 var(--space-2);
  padding-block: var(--space-1);
}
.inspector-body .row-label {
  font-size: var(--step--2);
  color: var(--fg-dim);
  text-transform: var(--label-transform);
  letter-spacing: var(--label-tracking);
}
/* **THE NORMAL FORM WRAPS HERE WHERE THE STRIP CUTS IT** — the strip is one line and ellipsises a segment
   that overruns; the inspector's whole reason for existing is that it does not. AFTER `.results .segment`,
   which it narrows. */
.inspector-body .row-value {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.inspector-body .link-status {
  margin-inline-start: 0;
  padding: var(--space-1) 0 0;
}
```

- [ ] **Step 9: Write the failing browser test**

Create `web/tests/browser/inspector.test.ts` with the `beforeAll` shape the other files use, and these cases:

```ts
  it('is not on the page while the readout is the strip', () => {
    expect(document.querySelector<HTMLElement>('#inspector')?.hidden).toBe(true)
    expect(document.querySelector('footer.strip')?.contains(document.querySelector('#results'))).toBe(true)
  })

  it('takes #results and #link-status with it, ids and compile state intact', () => {
    pick('[data-switch="readout"][data-value="inspector"]')
    const results = document.querySelector<HTMLElement>('#results') as HTMLElement
    expect(document.querySelector('#inspector')?.contains(results)).toBe(true)
    expect(document.querySelector('#inspector')?.contains(document.querySelector('#link-status'))).toBe(true)
    expect(results.dataset.state).toBe('idle')
    expect((document.querySelector('footer.strip') as HTMLElement).hidden).toBe(true)
  })

  it('shows the normal form the strip leaves out, one fact per line', () => {
    const rows = [...document.querySelectorAll('#results .row')]
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.map((r) => r.querySelector('.row-label')?.textContent).join(' ')).toContain('normal form')
  })

  it('collapses to its header, and the state survives a reload', () => {
    const toggle = document.querySelector<HTMLButtonElement>('#inspector .panel-toggle') as HTMLButtonElement
    toggle.click()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(JSON.parse(localStorage.getItem('redextape.layout') ?? '{}').inspector).toBe(false)
    toggle.click()
    pick('[data-preset="explorer"]')
  })
```

with `pick` the helper from `step-bar.test.ts` (copy it — the tier has no shared menu helper, and `harness.ts`'s own doc records that per-file helpers are the idiom).

- [ ] **Step 10: Run everything**

```bash
cd web && pnpm exec vitest run --project node
cd web && PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser
```

Expected: green, including all 24 files that wait on `#results[data-state]` — they run in Explorer, where `#results` has not moved.

- [ ] **Step 11: Sabotage, once each, and record the assertion that fired**

1. In `parseWorkspace`, make a missing `inspector` return `null`. Expect `workspace.test.ts`'s "defaults a missing inspector to open" red, and `layout-restore.test.ts` red where it restores a 2a-shaped envelope. Revert.
2. In `applySwitches`, leave `#results` in the strip. Expect `inspector.test.ts`'s "takes #results and #link-status with it" red on its `contains`. Revert.
3. In `programRows`, drop the `normal form` row by filtering it. Expect `readout.test.ts`'s "keeps the normal-form text the strip drops" red and `inspector.test.ts`'s "shows the normal form" red. Revert.
4. In `createReadout.setMode`, skip the `rendered = ''` reset. Expect `inspector.test.ts`'s "shows the normal form" red — the strip's key survives the switch and the rows are never drawn. Revert.
5. In `style.css`, set `main`'s `flex-direction` back to `column`. Expect nothing red — **record that**: no test measures the inspector's position, only its containment, and a visual check by hand is what covers it (§14 item 8). Revert.

- [ ] **Step 12: Commit**

```bash
cd web && pnpm exec biome ci --error-on-warnings src/workspace.ts src/readout.ts src/draw.ts src/main.ts src/style.css tests/browser/harness.ts tests/node/harness.test.ts tests/node/workspace.test.ts tests/node/readout.test.ts tests/browser/inspector.test.ts
cd .. && git add -A web
git commit -m "The readout switch moves the readout into a right-hand inspector that keeps the normal form the strip cuts, taking #results and its compile state with it rather than leaving a second element to write"
```

---
### Task 5: Stage

Spec §5 in full, and §11's fourth rule at the instance the spec names by hand: *the split items when Stage is chosen*.

**Stage is a way of drawing the tile tree, not a node in it.** The tree, the pane collection, editor custody, focus and panel state are all untouched; only `pane-host.ts`'s choice of renderer changes. Flipping back to `tiles` shows the arrangement the user left, because the arrangement never went anywhere.

**`+ view` needs no change.** `insertBeside` already puts the new leaf immediately after its subject in `leaves()` order, and `leaves()` order is the tab order — `tests/node/layout.test.ts` pins both halves already.

**Files:**
- Modify: `web/src/layout-view.ts` (`renderStage`)
- Modify: `web/src/pane-host.ts` (`applyLayout` picks the renderer)
- Modify: `web/src/draw.ts` (`canSplit` gains the Stage clause; both per-pane loops skip a disconnected host)
- Modify: `web/src/view-header.ts` (`viewMenu.sync` hands the focus off when it removes an item)
- Modify: `web/src/main.ts` (wiring; a line in `applySwitches`)
- Modify: `web/src/style.css` (`.stage`, `.stage-tabs`, `[role="tab"]`)
- Test: `web/tests/browser/stage.test.ts` (new)

**Interfaces:**
- Produces (`layout-view.ts`): `renderStage(root: HTMLElement, tree: LayoutNode, hosts: Map<LeafId, HTMLElement>, opts: { focused: LeafId; title(id: LeafId): string; select(id: LeafId): void }): void`.
- Produces (`pane-host.ts` deps): `stage(): boolean`, `focusedLeaf(): LeafId`, `viewTitle(id: LeafId): string`, `selectView(id: LeafId): void`.
- Produces (`draw.ts` deps): `stage: () => boolean`.
- Consumes: `focus-handoff.ts` (Task 1); `main.ts`'s `applySwitches` (Task 2); `main.ts`'s `pairLabel` title resolution (Task 3 — the bar already builds one; extract it to a shared `viewTitle(id)` in this task and let both use it).

- [ ] **Step 1: Write the failing browser test**

Create `web/tests/browser/stage.test.ts`, with the standard `beforeAll` and the `pick` helper, and these cases:

```ts
  it('draws one tab per leaf, in leaves() order, over the focused view alone', () => {
    pick('[data-switch="views"][data-value="stage"]')
    const tabs = [...document.querySelectorAll<HTMLElement>('#views [role="tab"]')]
    expect(tabs.map((t) => t.dataset.leaf)).toEqual(['source', 'lambda-0', 'tm-0'])
    expect(tabs.map((t) => t.textContent)).toEqual(['source', 'λ · program', 'TM · program'])
    // Exactly one host is on the page; the others are in `pane-host.ts`'s map, off it.
    expect(document.querySelectorAll('#views [data-leaf]').length - tabs.length).toBe(1)
    expect(document.querySelector('#views [data-leaf="lambda-0"]')).not.toBeNull()
  })

  it('names the shown host, and marks exactly one tab selected', () => {
    const selected = document.querySelectorAll('#views [role="tab"][aria-selected="true"]')
    expect(selected.length).toBe(1)
    const controls = (selected[0] as HTMLElement).getAttribute('aria-controls')
    expect(document.getElementById(controls ?? '')?.dataset.leaf).toBe('lambda-0')
  })

  // §5: arrow keys move with a roving tabindex; Enter or Space selects.
  it('moves between tabs with the arrow keys and selects with Enter', () => {
    const tab = (leaf: string) =>
      document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`) as HTMLElement
    expect(tab('lambda-0').tabIndex).toBe(0)
    expect(tab('tm-0').tabIndex).toBe(-1)
    tab('lambda-0').focus()
    tab('lambda-0').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.activeElement).toBe(tab('tm-0'))
    // MOVING IS NOT SELECTING — manual activation, which is what §5's "Enter or Space selects" means.
    expect(tab('lambda-0').getAttribute('aria-selected')).toBe('true')
    ;(document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    )
    expect(document.querySelector('#views [role="tab"][aria-selected="true"]')?.getAttribute('data-leaf')).toBe('tm-0')
    expect(document.querySelector('#views [data-leaf="tm-0"]')).not.toBeNull()
    expect(document.querySelector('#views [data-leaf="lambda-0"]:not([role="tab"])')).toBeNull()
  })

  // §5: "In Stage the ⋯ menu's split items are removed"; §11's fourth rule covers the focus.
  it('removes the split items, and does not strand the focus when it does', () => {
    pick('[data-switch="views"][data-value="tiles"]')
    const more = document.querySelector<HTMLButtonElement>('[data-leaf="tm-0"] button.view-more') as HTMLButtonElement
    more.click()
    const split = document.querySelector<HTMLButtonElement>(
      '[data-leaf="tm-0"] button.view-split[data-dir="row"]',
    ) as HTMLButtonElement
    expect(split).not.toBeNull()
    split.focus()
    pick('[data-switch="views"][data-value="stage"]')
    expect(document.querySelector('[data-leaf="tm-0"] button.view-split')).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    const menu = document.querySelector<HTMLElement>('[data-leaf="tm-0"] .view-menu')
    if (menu?.matches(':popover-open')) menu.hidePopover()
  })

  // §5: "Flipping back to `tiles` shows the arrangement the user left."
  it('gives back the arrangement when the switch goes to tiles', () => {
    pick('[data-switch="views"][data-value="tiles"]')
    expect(document.querySelectorAll('#views [role="tab"]').length).toBe(0)
    for (const leaf of ['source', 'lambda-0', 'tm-0'])
      expect(document.querySelector(`#views [data-leaf="${leaf}"]`), leaf).not.toBeNull()
    expect(document.querySelectorAll('#views .layout-divider').length).toBeGreaterThan(0)
  })

  // §5: "Hidden views cost nothing during playback."
  it('does not paint a hidden view while another plays', async () => {
    pick('[data-switch="views"][data-value="stage"]')
    const hidden = document.querySelector<HTMLElement>('[data-leaf="tm-0"]')
    expect(hidden?.isConnected).toBe(false)
    const before = hidden?.innerHTML
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button[aria-label="play"]')?.click()
    await until(
      () => (document.querySelector('[data-leaf="lambda-0"] .step')?.textContent ?? '').includes('step 1 '),
      'a step to be taken',
    )
    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button[aria-label="pause"]')?.click()
    expect(hidden?.innerHTML).toBe(before)
    pick('[data-preset="explorer"]')
  })
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/stage.test.ts
```

Expected: every case fails — the `views` switch stores a value nothing reads, so `renderLayout` still draws tiles.

- [ ] **Step 3: Write `renderStage`**

Append to `web/src/layout-view.ts`:

```ts
/**
 * THE SAME TREE, DRAWN AS TABS — Plan 7 part 2 spec §5, the `views` switch at `stage`.
 *
 * **STAGE IS A RENDERER, NOT A NODE.** The tree is untouched: the tabs are `leaves(tree)` in depth-first
 * order and the mounted host is the focused leaf's. Every other host stays in the caller's map, off the
 * page, exactly as a host between two commits already is (`renderLayout`'s own note) — which is what makes
 * flipping back to tiles give the arrangement the user left, for free rather than by remembering it.
 *
 * **A TAB HAS NO CLOSE CONTROL** (§5): the view's own header still carries `✕`, and a second closer would
 * be a second glyph meaning "close" in the same place (umbrella §4 rule 2).
 *
 * **MANUAL ACTIVATION.** Arrow keys move the focus with a roving `tabindex`; `Enter` or `Space` selects.
 * Automatic activation — selecting on arrow — would remount a host per keypress, which is a rebuild of a
 * CodeMirror-bearing subtree for a user who is only looking for the tab they want.
 *
 * **IT RESCUES THE FOCUSED TAB ACROSS ITS OWN REBUILD**, for `renderLayout`'s divider reason and by the same
 * mechanism: the element has no identity across `replaceChildren`, so `data-leaf` is the durable name.
 */
export function renderStage(
  root: HTMLElement,
  tree: LayoutNode,
  hosts: Map<LeafId, HTMLElement>,
  opts: { readonly focused: LeafId; title(id: LeafId): string; select(id: LeafId): void },
): void {
  const held = root.contains(document.activeElement) ? document.activeElement : null
  const heldLeaf = held instanceof HTMLElement && held.role === 'tab' ? held.dataset.leaf : undefined

  const all = leaves(tree)
  const shown = all.some((l) => l.id === opts.focused) ? opts.focused : (all[0]?.id ?? opts.focused)
  const host = hosts.get(shown)
  if (host === undefined) throw new Error(`stage names a leaf with no host: ${shown}`)
  // THE HOST NEEDS AN ID BECAUSE A TAB NAMES IT, and `panel.ts` mints one the same way for the same
  // reason: `aria-controls` is an IDREF and a host built by `pane-host.ts` carries only `data-leaf`.
  if (host.id === '') host.id = `view-host-${shown}`

  const strip = document.createElement('div')
  strip.className = 'stage-tabs'
  strip.setAttribute('role', 'tablist')

  const tabs = all.map((l) => {
    const t = document.createElement('button')
    t.type = 'button'
    t.className = 'stage-tab'
    t.dataset.leaf = l.id
    t.setAttribute('role', 'tab')
    t.textContent = opts.title(l.id)
    const selected = l.id === shown
    t.setAttribute('aria-selected', String(selected))
    if (selected) t.setAttribute('aria-controls', host.id)
    t.tabIndex = selected ? 0 : -1
    t.addEventListener('click', () => opts.select(l.id))
    return t
  })

  const move = (from: number, by: number): void => {
    const next = tabs[(from + by + tabs.length) % tabs.length]
    if (next === undefined) return
    next.focus()
  }
  tabs.forEach((t, i) => {
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(i, 1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(i, -1)
      else if (e.key === 'Home') move(0, 0)
      else if (e.key === 'End') move(tabs.length - 1, 0)
      else if (e.key === 'Enter' || e.key === ' ') opts.select(t.dataset.leaf ?? shown)
      else return
      e.preventDefault()
    })
  })

  strip.replaceChildren(...tabs)

  host.style.flex = '1 1 0'
  host.style.minWidth = '0'
  host.style.minHeight = '0'

  const box = document.createElement('div')
  box.className = 'stage'
  box.append(strip, host)
  root.replaceChildren(box)

  if (heldLeaf !== undefined) tabs.find((t) => t.dataset.leaf === heldLeaf)?.focus()
}
```

- [ ] **Step 4: Branch the renderer in `pane-host.ts`**

Add four deps to `createPaneHost`'s object, beside `getTree`/`setTree`:

```ts
  /** Whether the workspace draws its views as a tabbed stage — spec §5's `views` switch. */
  stage(): boolean
  /** The focused leaf, which in Stage is the one view on the page. */
  focusedLeaf(): LeafId
  /** A view's title, in the title-selector's spelling — a tab's label. */
  viewTitle(id: LeafId): string
```

and in `applyLayout`'s `finally`, replace the single `renderLayout(...)` call with:

```ts
      if (stage()) {
        // **NO `ResizeHandlers`: A STAGE HAS NO DIVIDERS.** The tree still has splits and sizes, and they
        // are still what `tiles` draws — nothing here writes to them, which is why flipping back gives
        // the arrangement the user left rather than a renormalised one.
        renderStage(root, getTree(), hosts, {
          focused: focusedLeaf(),
          title: viewTitle,
          // SELECTING A TAB IS A FOCUS CHANGE PLUS A RE-RENDER, and it ends in `applyLayout`'s own
          // `draw()` — spec §5's "selecting a tab calls `draw()` once so the shown view is current".
          select: (id) => {
            setFocused(id)
            applyLayout()
          },
        })
      } else {
        renderLayout(root, getTree(), hosts, {
          // … today's `resize` and `commit`, unchanged …
        })
      }
```

Import `renderStage` beside `renderLayout`.

- [ ] **Step 5: Teach `draw.ts` about hidden views and the split items**

Add the dep:

```ts
  /** Whether the views are drawn as a stage — spec §5. A thunk, for `leaves`' reason. */
  stage: () => boolean
```

Guard the per-pane loop:

```ts
    for (const p of panes.all()) {
      // **A VIEW THAT IS NOT ON THE PAGE IS NOT PAINTED** (spec §5). In Stage every host but one is in
      // `pane-host.ts`'s map and out of the document, and a `render` into a detached subtree is work whose
      // only observer is the next `innerHTML` read. Selecting a tab re-attaches the host and ends in a
      // `draw()`, so nothing comes back stale.
      if (!p.host.isConnected) continue
      const leg = p.slot.resolve(sessions)
      // … unchanged …
      p.pane.setLayoutControls(leaves() > 1, p.kind !== 'source' && !stage(), {
```

with the argument's note widened:

```ts
      // `p.kind !== 'source' && !stage()` IS THE SPLIT REFUSAL, AND IT HAS TWO HALVES NOW. One editor,
      // nothing to duplicate into (`splitLeaf`'s own doc); and in Stage a split can never apply, because
      // the stage draws one view over a tab strip and a split of it would be invisible — umbrella §4
      // rule 4's "removed where it can never apply in that view". `+ view` is what adds a view there
      // (spec §5), and it is in the header rather than in this menu.
```

and guard the λ-only loop the same way:

```ts
    for (const p of panes.of('lambda')) {
      if (!p.host.isConnected) continue
```

- [ ] **Step 6: Hand the focus off when `viewMenu` removes an item**

In `web/src/view-header.ts`'s `viewMenu`, inside `sync`, the reconcile block removes items with `child.remove()`. Capture what is going and hand the focus on:

```ts
    const same = wanted.length === main.children.length && wanted.every((b, i) => main.children[i] === b)
    if (!same) {
      const going = [...main.children].filter((child) => !wanted.includes(child as HTMLButtonElement))
      // A CONTROL REMOVED BY A STATE CHANGE MUST NOT TAKE THE FOCUS WITH IT — spec §11's fourth rule,
      // at the instance the spec names by hand: the split items when Stage is chosen. It is reached with
      // the menu OPEN, which is the only way a user can be standing on one of these when the state
      // changes. `focus-handoff.ts` is the rule; `main` is "the same menu".
      handOff(going, nearest(main, going[0] ?? main))
      for (const child of going) child.remove()
      // … the insert loop, unchanged …
    }
```

**Note for the pre-flight:** `nearest(main, going[0] ?? main)` computes its candidates against the menu as it stands BEFORE the removal, so a candidate may itself be in `going`. `handOff` runs before the removals, so those candidates are still connected and would be chosen. Filter them: `nearest(main, going[0] ?? main).filter((el) => !going.includes(el))`. Record the defect.

- [ ] **Step 7: Wire it in `main.ts`**

Extract the title resolution Task 3 built inside `barTargetNow` into one function both use:

```ts
  /**
   * A view's title, in the title-selector's own spelling — the bar's prefix (spec §8) and a Stage tab's
   * label (§5).
   *
   * **ONE FUNCTION, BECAUSE A VIEW HAS ONE NAME.** The header, the bar and the tab strip all say what a
   * view shows, and three spellings of `λ · program` would be three places for the vocabulary sweep to
   * have missed one.
   */
  const viewTitle = (id: LeafId): string => {
    const entry = panes.get(id)
    // THE SOURCE VIEW HAS NO PANE ENTRY AND ITS TITLE IS NOT A PAIR (spec §7): it is `source`, always.
    if (entry === undefined) return 'source'
    const b = entry.slot.binding
    const option = sessions.pairs().find((o) => o.leg === b.leg && o.id === b.session)
    return option === undefined ? '' : pairLabel(option)
  }
```

and have `barTargetNow` call `viewTitle(id)`.

Pass the three new deps at the `createPaneHost` call:

```ts
    stage: () => ws.switches.views === 'stage',
    focusedLeaf,
    viewTitle,
```

and `stage: () => ws.switches.views === 'stage'` at the `createDraw` call. Add one line to `applySwitches`, above its `draw()`:

```ts
    paneHost.applyLayout()
```

**`applyLayout` ends in `persist()` and `draw()`**, so `applySwitches`' own trailing `draw()` is now redundant on every path that reaches this line — leave it, because the readout's mode change (Task 4) has no other repaint, and say so in a comment rather than letting the next reader wonder.

- [ ] **Step 8: Style it**

Append to `web/src/style.css`, after `.layout-divider:focus-visible`:

```css
/* THE STAGE (spec §5): a tab strip over one view. The strip is chrome, on the chrome surface, exactly as
   `.panel-header` is — a stage tab and a panel disclosure are the same kind of thing at two scales. */
.stage {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}
.stage-tabs {
  display: flex;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  background: var(--bg-chrome);
  border-block-end: 1px solid var(--rule);
}
.stage-tab {
  font: inherit;
  font-family: var(--font-mono);
  font-size: var(--step--1);
  padding: var(--space-1) var(--space-2);
  border: 0;
  border-block-end: 2px solid transparent;
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
}
/* THE SELECTED TAB CARRIES A SHAPE, NOT ONLY A COLOUR (umbrella §4 rule 5, the accessibility list's
   item 7): a 2px edge along its bottom, which is what a tab is. */
.stage-tab[aria-selected="true"] {
  color: var(--fg);
  border-block-end-color: var(--accent);
}
.stage-tab:focus-visible {
  outline-offset: -2px;
}
```

- [ ] **Step 9: Run everything**

```bash
cd web && pnpm run typecheck
cd web && pnpm exec vitest run --project node
cd web && PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser
```

Expected: green.

- [ ] **Step 10: Sabotage, once each, and record the assertion that fired**

1. In `renderStage`, append every host rather than the focused one. Expect `stage.test.ts`'s "draws one tab per leaf … over the focused view alone" red on the host count, and "does not paint a hidden view" red on `expect(hidden?.isConnected).toBe(false)`. Revert.
2. In `renderStage`'s `keydown`, call `opts.select` on an arrow key as well. Expect "moves between tabs with the arrow keys and selects with Enter" red on `expect(tab('lambda-0').getAttribute('aria-selected')).toBe('true')`. Revert.
3. In `draw.ts`, drop the `!p.host.isConnected` guard from the per-pane loop. Expect "does not paint a hidden view while another plays" red on `expect(hidden?.innerHTML).toBe(before)`. Revert.
4. In `draw.ts`, pass `p.kind !== 'source'` without the `!stage()` clause. Expect "removes the split items" red on `expect(document.querySelector('[data-leaf="tm-0"] button.view-split')).toBeNull()`. Revert.
5. In `viewMenu`'s `sync`, drop the `handOff` call. Expect "removes the split items, and does not strand the focus when it does" red on `expect(document.activeElement).not.toBe(document.body)`. Revert.
6. In `renderStage`, drop the `heldLeaf` rescue. Expect nothing red — **record that**: the arrow-key case focuses a tab and the rebuild only happens on `select`, which the case reaches through `Enter` and then asserts the new selection rather than the focus. Either add an assertion that the focus survives a select, or record the hole. Prefer the assertion: append `expect(document.activeElement).toBe(tab('tm-0'))` to that case and re-run the sabotage to confirm it now fires.

- [ ] **Step 11: Commit**

```bash
cd web && pnpm exec biome ci --error-on-warnings src/layout-view.ts src/pane-host.ts src/draw.ts src/view-header.ts src/main.ts src/style.css tests/browser/stage.test.ts
cd .. && git add -A web
git commit -m "The views switch draws the same tile tree as a tab strip over one view, keeps every other view's host off the page so playback does not paint it, removes the split items that can never apply there without stranding the focus, and gives the arrangement back on the way out"
```

---

### Task 6: Every control, in every preset and in custom

Spec §14 item 5: *2a runs it in Explorer; 2b in every preset and in* custom.

**The gate itself needs no change — only the states it is run in.** `check()` enumerates whatever the page holds and computes each accessible name with `dom-accessibility-api`; what is preset-specific is which selectors exist. In Stage there is one view on the page and no split submenu, so the per-view cases are driven from the focused view rather than from `lambda-0` and `tm-0` by name.

**The file mounts the app once and has no teardown**, so the four states are reached by driving the workspace menu on the live page — which is the only way they can be reached, and is also what makes the walk honest: it is the same app a user switches, not four fresh ones.

**Files:**
- Modify: `web/tests/browser/controls-gate.test.ts`

- [ ] **Step 1: Restructure the file around the four states**

Add above the existing `describe`:

```ts
/**
 * The four workspace states §14 item 5 names: the three presets, and one *custom* combination.
 *
 * `views` IS WHAT CHANGES THE SELECTORS, not `steps` or `readout`: in Stage one view is on the page, so the
 * per-view cases are driven from whichever view the stage is showing rather than from two named leaves.
 * The `custom` row is Explorer with one switch moved, which is the shortest path to a combination
 * `presetOf` answers `null` for — and it is deliberately the switch that changes the page most.
 */
const STATES = [
  { name: 'Explorer', picks: ['[data-preset="explorer"]'], tiled: true },
  { name: 'Debugger', picks: ['[data-preset="debugger"]'], tiled: true },
  { name: 'Stage', picks: ['[data-preset="stage"]'], tiled: false },
  { name: 'custom', picks: ['[data-preset="explorer"]', '[data-switch="views"][data-value="stage"]'], tiled: false },
] as const

function enter(picks: readonly string[]): void {
  for (const sel of picks) {
    document.querySelector<HTMLButtonElement>('#workspace')?.click()
    document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  }
  const menu = document.querySelector<HTMLElement>('#workspace-menu')
  if (menu?.matches(':popover-open')) menu.hidePopover()
}

/** The leaves a per-view case can be driven from in this state. */
function viewLeaves(tiled: boolean): string[] {
  if (tiled) return ['lambda-0', 'tm-0']
  const shown = document.querySelector<HTMLElement>('#views [role="tab"][aria-selected="true"]')
  return shown?.dataset.leaf === undefined ? [] : [shown.dataset.leaf]
}
```

- [ ] **Step 2: Wrap the walk in a `describe.each`**

Rename the existing `describe('every control in Explorer', …)` to:

```ts
describe.each(STATES)('every control in $name', ({ name, picks, tiled }) => {
  beforeAll(() => enter(picks))
```

Inside it:
- the `'on the page as it stands'` case is unchanged.
- the header-menu `it.each` table keeps `['#workspace'], ['#new-view'], ['#buffers'], ['#settings']` — every one exists in every state, and `#workspace`'s menu is the one whose contents differ (no `#reset-preset` in *custom*), which is exactly the case worth walking four times.
- the per-view `it.each` becomes a loop over `viewLeaves(tiled)`, built inside the case rather than in the table, because the table is evaluated at collection time and the state is not entered until `beforeAll`:

```ts
  it('with every view’s title and ⋯ menu open', () => {
    for (const leaf of viewLeaves(tiled)) {
      for (const sel of [`[data-leaf="${leaf}"] button.view-title`, `[data-leaf="${leaf}"] button.view-more`]) {
        const button = document.querySelector<HTMLButtonElement>(sel)
        // A VIEW WITH ONE PAIR HAS A PLAIN-TEXT TITLE AND NO BUTTON (spec §7), and a view whose menu
        // would be empty has no `⋯` (`viewMenu`'s own rule) — both are absences the rule ALLOWS, so a
        // missing control is skipped rather than failed.
        if (button === null) continue
        button.click()
        check(`${name}: ${sel}`)
        const menu = document.getElementById(button.getAttribute('aria-controls') ?? '')
        if (menu?.matches(':popover-open')) menu.hidePopover()
      }
    }
  })
```

- the split-submenu case runs only `if (tiled)`, because §5 removes the split items in Stage. Guard it with an assertion rather than silence:

```ts
  it('with a split submenu open, where splits apply', () => {
    for (const leaf of viewLeaves(tiled)) {
      const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
      more?.click()
      const split = document.querySelector<HTMLButtonElement>(
        `[data-leaf="${leaf}"] button.view-split[data-dir="row"]`,
      )
      // **THE ABSENCE IS ASSERTED, NOT ASSUMED** — a negative that passes vacuously is the failure mode
      // spec §12 names for renames, and it is the same failure here: without this, a Stage state in
      // which the split items were STILL THERE would pass by never finding them.
      if (!tiled) {
        expect(split, `${name}: Stage must offer no split`).toBeNull()
        continue
      }
      expect(split, `${name}: ${leaf} offers no split`).not.toBeNull()
      split?.click()
      expect(document.querySelectorAll(`[data-leaf="${leaf}"] .view-menu-pairs button`).length).toBeGreaterThan(0)
      check(`${name}: ${leaf}'s split submenu`)
      const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
      if (menu?.matches(':popover-open')) menu.hidePopover()
    }
  })
```

- the two copy cases — the undo notice and the paused copy — **stay in Explorer alone**, moved into their own `describe('every control in Explorer, with the copies menu in each of its states')` outside the `describe.each`, placed AFTER it. They mutate the shared page (delete then undo, pause then resume) and what they exercise is the copies menu, which is identical in all four states; running them four times would be four rounds of state churn for one signal. **Say that in a comment where they now sit**, so the division reads as a decision.
- `beforeAll` at the end of the `describe.each` body is not enough on its own: add an `afterAll(() => enter(['[data-preset="explorer"]']))` so the file leaves the page where the rest of the tier expects it.

- [ ] **Step 3: Run it**

```bash
cd web && PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts
```

Expected: green, with four times the cases. **If it goes red, that is the task's actual output** — a control that is unnamed, wrongly named or unreachable in a preset 2a never ran. Fix the control, not the gate.

- [ ] **Step 4: Sabotage, once each, and record the assertion that fired**

1. In `step-bar.ts`, remove the speed select's `aria-label`. Expect the gate red in Debugger, Stage and custom (where the bar is on the page), naming the select, and **green in Explorer** — which is the whole point of the task. Revert.
2. In `layout-view.ts`'s `renderStage`, set a tab's text to `''`. Expect the gate red in Stage and custom on `expect(name, id).not.toBe('')`. Revert.
3. In `app-header.ts`'s `workspaceItems`, drop the `title` from each switch button. Expect the gate red in every state on "name ≠ label or tooltip" — the `aria-label` is the longer sentence and the visible label is the short one. Revert.
4. In `workspaceItems`, append `state.reset` unconditionally. Expect nothing red in the gate — **record that**: the gate walks names and reachability, not whether a control should be there. That absence is `workspace-switches.test.ts`'s to hold (Task 2), and this is the division between the two files. Revert.

- [ ] **Step 5: Commit**

```bash
cd web && pnpm exec biome ci --error-on-warnings tests/browser/controls-gate.test.ts
cd .. && git add web/tests/browser/controls-gate.test.ts
git commit -m "The controls gate walks the page in all three presets and in custom, asserting the absence of the split items in Stage rather than passing by never finding them"
```

---

### Task 7: Verify the whole branch, and write the roadmap entry

**The roadmap entry is written BEFORE the PR is opened, not after it merges.** A substantive PR needs its entry in the branch.

- [ ] **Step 1: Run every gate CI runs, in CI's order**

From `web/`:

```bash
pnpm run build:wasm:dev
pnpm run build:bindings
pnpm exec biome ci --error-on-warnings
pnpm run typecheck
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 -- env PATH="/usr/sbin:$PATH" pnpm run test:coverage
pnpm run build:app
```

From the repo root:

```bash
./scripts/check-all.sh
./scripts/check-slow.sh
./scripts/check-text-bytes.sh
./scripts/check-citations.sh
./scripts/check-attributions.sh
./scripts/check-colours.sh
./scripts/check-doc-figures.sh
./scripts/check-shared-docs.sh
```

**`check-all.sh` is not all of CI**: the coverage floor, `check-slow.sh` and the hygiene scans are separate, which is why each is listed. Record each command's result; a figure quoted in the entry names the command that produced it.

- [ ] **Step 2: The visual check by hand (§14 item 8)**

In a dev server (`pnpm run dev` from `web/`, Chrome from `/usr/sbin`), in **light and dark**, look at: Explorer, Debugger, Stage, and one custom combination. Check by eye, and write down what you saw:

1. the inspector's column width and its rows wrapping rather than being cut;
2. the step bar's alignment against the strip below it, and the bar's title;
3. the selected Stage tab's bottom edge in both themes, and a focused unselected tab's ring;
4. the workspace menu's three switch rows — the group labels, and the marked value's border;
5. that no control is a bare glyph anywhere in the four states.

- [ ] **Step 3: Whole-branch review**

Run a review over the whole branch diff, not per task. **Clean per-task reviews are its precondition, not a reason to skip it**, and a falling severity trend across tasks is not a stopping signal. Fix every finding on the branch before opening the PR.

**Ask for the sibling search on every fix**, and for its output: a finding fixed at one call site is a class until the search says otherwise. This branch has three that are obviously class-shaped:
- every site that removes a control under a state change (Task 1's whole reason) — the search is over `.remove()` and `replaceChildren` in `src/`;
- every place a view's title is spelled (`viewTitle`, the tab strip, the bar, the header) — one function now, so the search is for a second spelling;
- every place `#results` is assumed to be inside `footer.strip`.

- [ ] **Step 4: Write the roadmap entry**

Append a `#### PLAN 7 PART 2B …` section to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, in the shape part 2a's entry takes. It must carry:

- **WHAT PART 2B BUILT** — the three switches and their three consumers, the workspace menu, the focus rule.
- **THE PRE-FLIGHT AND WHAT IT FOUND** — the defect count by class, and the two or three worth knowing without opening the log.
- **WHAT THE WHOLE-BRANCH REVIEW FOUND**, and for each, the sibling search and its output.
- **SABOTAGES** — every row, and **explicitly, the ones that did not fire**: Task 1's step-controls candidate order, Task 3's `lastSteppable` ordering, Task 4's `main` flex-direction, Task 5's tab focus rescue (and whether the added assertion made it fire), Task 6's unconditional reset item. *A sabotage that does not fire is the finding* — record what each one showed about the test it was aimed at, not only that it was quiet.
- **WHAT THIS DID NOT CLOSE** — the bar's "no view can step" state is held by a node test and not by a browser gesture; `tests/node/player.test.ts` still never covers a leg toggled on while another is already playing (carried over from 2a); part 2's accessibility items are all closed by 2a's mechanisms, so **2b closes none of §15's list and should say so** rather than claiming a share of them.
- **VERIFICATION** — a table of every figure with the command that produced it, run before the commit that quotes it. At minimum: commits on the branch (`git log --oneline d6b57c2..HEAD | wc -l`), files changed (`git diff --stat d6b57c2..HEAD | tail -1`), new browser test files and their case counts (the vitest run's own output), coverage percentages (the `test:coverage` run's summary), and the four states the controls gate walks.
- **Anchor the entry to a SHA and state properties, not relationships.** Write the number, never "the only" or "the largest"; anchor LAST, after the final code commit, or every fix round re-stales it.

- [ ] **Step 5: Commit the entry, then open the PR**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md docs/superpowers/notes/2026-09-20-plan7-part2b-preflight-defects.md
git commit -m "Plan 7 part 2b's roadmap entry: what the three switches build, what the pre-flight and the whole-branch review found, and which sabotages stayed quiet"
```

Then open the PR against `main`. **Fact-check the PR body against the branch before opening it**, and write each paragraph as one long line — Forgejo renders bodies with GFM `breaks: true`, so a hard-wrapped paragraph comes out with a line break per source line.

**Expect CI to need watching rather than a rerun:** a push or a PR-body edit CANCELS the live run, and a cancelled job reads as `failure`. Poll for a POSITIVE terminal status on the head SHA; there is no working API rerun, so a genuine rerun goes through the web UI button.

---

## Self-review

**Spec coverage.** §4's three presets and *custom* → Task 2. §4's *reset preset* removed while custom → Task 2. §5's Stage in full — the tab strip, the roving tabindex, `+ view` needing no change, the split items removed → Task 5. §6's workspace menu contents and the missing `▾` → Task 2. §8's bar, its mount, its target and its no-target state → Task 3. §9's inspector, its state and `#results` → Task 4. §11's fourth focus rule → Task 1, applied in Tasks 2, 3 and 5. §14 item 2 → **already discharged by 2a; Task 7 records that it was checked.** §14 items 3 and 4 → 2a's, unchanged. §14 item 5 → Task 6. §14 item 6's 2b bullet — the bar drives and names the focused view (Task 3), Stage's tabs work by keyboard and flipping back restores the arrangement (Task 5), hidden views are not painted during playback (Task 5). §14 item 7 → a sabotage step in every task. §14 item 8 → Task 7 Step 2. §15 → **2b closes no item on that list**, and Task 7 says so rather than claiming a share.

**One gap, stated rather than left to be found.** §9's inspector sentence — "its open state kept in `panels` under the key `inspector`" — is not implemented as written; Task 4 gives the reason and the replacement, and the spec's sentence should be corrected in the same branch if the spec is being touched at all. If it is not, the roadmap entry records the divergence.

**Types.** `Switches`, `Preset`, `Speed`, `LeafId`, `ControlState`, `ProgramResult` and `Row` are used with the same spellings throughout. `SwitchRow.value` is `string` and is narrowed exactly once, at `main.ts`'s `flip`, through `workspace.ts`'s now-exported `parseSwitches` — the one place a menu value becomes a stored one. `legControlState` has one definition and two callers. `viewTitle` has one definition and two callers.

**Three notes for the pre-flight are already in the text**, at Task 1 Step 3 (`nearest`'s dead index), Task 2 Step 4 (`workspaceItems`' hand-off call) and Task 5 Step 6 (`nearest`'s candidates overlapping `going`). They are known-wrong lines kept visible rather than silently corrected, so the build confirms each.
