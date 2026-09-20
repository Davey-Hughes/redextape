# Plan 7, part 2a — View chrome and vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the web app a workspace state that persists, one step-control component with pause and a speed setting, a view header whose title is its selector and whose `⋯` menu holds the view's actions, a new app header with a settings menu, a strip readout that follows the focused view, a copies menu with pause, resume and delete-with-undo, one notice surface and one live region — and rename every user-visible word to the umbrella's §4 vocabulary.

**Architecture:** `workspace.ts` owns the persisted envelope (version 2, migrating version 1) and wraps `layout.ts`'s unchanged tree. `player.ts` replaces the per-leg `setInterval` with one `requestAnimationFrame` loop. `view-header.ts` is one header component both view classes and the source view build; `step-controls.ts` renders `ControlState` inside it. `notice.ts` is the one notice line and the one live region; every refusal that used to be written to `#link-status` goes through it. `readout.ts` builds the strip's rows from the focused view's session. The app stays Explorer-shaped: the three switches are stored and held at Explorer's values; 2b adds the other presets.

**Tech Stack:** TypeScript 7 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vite 8, Vitest 4 (node and browser projects, Playwright Chromium), Biome 2, CodeMirror 6, Rust (two user-visible strings in `redextape-wasm`).

**Spec:** `docs/superpowers/specs/2026-09-19-plan7-part2-workspace-shell-design.md` (§1–§17). Umbrella: `docs/superpowers/specs/2026-09-17-frontend-overhaul-design.md`.

## The pre-flight build, and what it found

**This plan was built once, end to end, in a throwaway worktree before any of it was executed** — part 1's
practice, and the reason its own plan carries "(pre-flight)" notes. The build committed all thirteen tasks
through the pre-commit hook and finished green on `scripts/check-all.sh` and on CI's whole `web` sequence.

**It found 79 defects in the text below: 10 that block a step as written, 37 that produce a wrong result or
a red gate, 29 that needed a guess, and 3 design problems.** The log is
`docs/superpowers/notes/2026-09-19-plan7-part2a-preflight-defects.md`, one entry per defect, each with the
error it produced and the replacement text. **The tasks below are NOT rewritten against it**: the branch
carries the corrected code (the pre-flight's own commits, adopted), so the plan stands as what was planned
and the log is the record of where planning and building disagreed. A reader following this plan against a
fresh tree should read the log beside it.

The three worth knowing without opening the log:

- **`bindingKey` joined a leg and a session with a NUL** (defect 3.1). CSS replaces U+0000 with U+FFFD when
  it parses a selector, so no `button[data-binding="…"]` lookup could ever match, and every helper the plan
  gives for picking a pair was unusable. The separator is `:`.
- **Play never redrew** (5.1). `player.ts` draws when a step is taken, and a pause takes none — so the
  button went on reading `⏸` after the click that paused it, which is the one thing the control exists to
  show. `transport.ts`'s `play` draws after the toggle.
- **`#add-view` failed the colour gate** (8.1), which reads `#add` as a three-digit hex colour. The id is
  `new-view`.

And the three design problems, each settled in the spec rather than here: the storage warning became the
notice line's resting state (§11); a copy's worker error became a notice naming the copy rather than the
program's result (§13); and the controls gate computes accessible names with `dom-accessibility-api`
instead of reading `textContent`, which is what let the first version pass a button named `◐system` (§14).

## Global Constraints

- Branch `plan7-part2a-view-chrome`, off `main` at `ff7fbd1` (#99, rebased from `13db3b7`); the spec is its first two commits. #99 changed only `tests/browser/tm-reduced-buffer.test.ts`'s spinner tests and a paragraph of `harness.ts`'s doc, so every code fact this plan quotes from `13db3b7` still holds; Task 3 and Task 4 edit that test file's `beforeAll` and split helper, which #99 left alone. Never `--no-verify`. The pre-commit hook runs the text-byte, citation, attribution, doc-figure, shared-doc and colour gates, then `cargo fmt`, `cargo clippy -D warnings`, `biome ci` and `web typecheck` (which runs `cargo` through `build:bindings`) — each scoped to the files a commit touches.
- The wasm package must exist at the repo root's `pkg/` before any browser test, `typecheck` or `build:app` runs: `pnpm run build:wasm:dev` from `web/` if it is missing or older than the last change under `crates/redextape-wasm` or `crates/redextape-core`. Task 11 changes Rust; rebuild after it.
- Run web commands from `web/`. **Scope a test run by passing the path positionally:** `pnpm exec vitest run --project node tests/node/x.test.ts` or `pnpm exec vitest run --project browser tests/browser/x.test.ts`. `pnpm test:node -- x` does NOT scope — it runs every file.
- Browser runs need Chrome on `PATH`: prefix `PATH="/usr/sbin:$PATH"`. Never run two browser-project runs at once; the tier binds a port. Run `test:coverage` under a memory cap: `systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 -- pnpm run test:coverage`.
- TypeScript doc comments are `/** */`; `///` in a `.ts` file is drift. Match the surrounding comment density: this codebase writes a doc comment on every exported symbol, in full sentences, with a bolded upper-case lead where a decision needs arguing.
- No `file:line` citations anywhere in tracked source (`scripts/check-citations.sh`). A symbol citation written `` `file.ts`'s `symbol` `` must name the file that declares the symbol, and must not land in a commit before the commit that creates that symbol (`scripts/check-attributions.sh`). **When a task renames or deletes a symbol, search `web/` for citations of it — including in test-file comments — and update them in the same commit.**
- A colour literal may appear only in `web/src/palettes.ts` and between `/* palette:fallback:begin */` and `/* palette:fallback:end */` in `web/src/style.css` (`scripts/check-colours.sh`). New CSS uses the tokens `--bg`, `--bg-raised`, `--bg-chrome`, `--fg`, `--fg-dim`, `--rule`, `--accent`, `--focus-ring`, `--radius`, `--space-*`, `--step-*`, `--font-ui`, `--font-mono`.
- Web coverage thresholds (`vite.config.ts`): lines 97, functions 97, branches 89, statements 95. Every new module needs tests that keep these.
- **Tests that pin a replaced label or control change in the same commit as the control, to the new control or wording — never loosened, never skipped.** A negative assertion on an old label (`not.toContain('[detached]')`) passes vacuously after a rename; rewrite each to name the new wording, and add a positive check beside it where it stood alone (spec §12).
- `SHELL` in `web/tests/browser/harness.ts` must stay identical in content to `web/index.html`'s markup from `<header` through the end of the strip (Task 5 onward), and `tests/node/harness.test.ts` lists the ids it must carry.
- **Before every commit, run `pnpm exec biome ci --error-on-warnings <every web file the task changed>` from `web/`.** The hook passes `--error-on-warnings`. A formatting-only failure is fixed with `pnpm exec biome format --write <files>`; an import-order one with `pnpm exec biome check --write <files>`.
- Browser waits go through `harness.ts`'s `until`, with no numeric timeout at the call site (`tests/node/browser-timeout-invariants.test.ts`). No test body waits on more than one long recording (the lesson of #99).
- Commit subjects are sentences stating what is now true. No AI attribution anywhere.
- User-visible vocabulary (spec §12, umbrella §4) — the words every task writes:

  | Concept | Word |
  |---|---|
  | a pane | view |
  | a scratch buffer | copy — `λ copy N`, `TM copy N` |
  | the source session | the program — `λ · program`, `TM · program` |
  | fork | ✎ edit a copy |
  | detached | copy · not linked |
  | retire / warm / cool / asleep | delete / resume — restarts at step 0 / pause / paused |
  | orphan, 1 pane, N panes | not shown, 1 view, N views |
  | β-steps, δ-steps | reductions, transitions |
  | reset layout | reset preset |
  | `(same)` | another view of this |

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `web/src/workspace.ts` (new) | the version 2 envelope: switches, speed, focus, panels; parse, migrate, serialise; `presetOf` | 1 |
| `web/src/layout.ts` | `parseTree` split out of `parseLayout`; `insertBeside` | 1 |
| `web/src/player.ts` (new) | one `requestAnimationFrame` loop over every playing leg; `advance` arithmetic | 2 |
| `web/src/sessions.ts`, `web/src/controls.ts` | `LegState.playing` replaces `timer`; `ControlState.playing` | 2 |
| `web/src/view-header.ts` (new) | a view's header: title-selector, status, step slot, `⋯` menu, `✕` | 3, 4 |
| `web/src/icons.ts` | `play`, `pause`, `edit-copy`, `sun`, `moon`, `more`, `close` icons | 3, 4, 5, 8 |
| `web/src/step-controls.ts` (new) | `↺ ◀ ▶ ⏵/⏸`, speed select, step readout, continue | 5 |
| `web/src/notice.ts` (new) | the notice line and the one live region | 6 |
| `web/src/buffer-list.ts` | the copies menu: rows, pause, resume, delete | 7 |
| `web/src/scratch.ts` | `copy` labels; `recordOf`, `reinstate` for undo | 7 |
| `web/src/app-header.ts` (new) | the workspace menu, `+ view`, the settings menu | 8 |
| `web/src/readout.ts` (new) | the strip's rows for the focused view's session | 9 |
| `web/src/pane-chrome.ts` | loses `paneSelect`, `detachedBadge`, `detachButton`, `claimEditorButton`, `layoutControls`, `controlStrip`; keeps `PaneEvents`, `PaneChoice`, `SplitChoices`, `textPanel` | 3, 4, 5 |
| `web/src/lambda-pane.ts`, `web/src/tm-pane.ts` | build their header through `view-header.ts` | 3, 4, 5 |
| `web/src/pane-host.ts`, `web/src/main.ts`, `web/src/transport.ts`, `web/src/replies.ts`, `web/src/compile.ts`, `web/src/draw.ts`, `web/src/link-wiring.ts`, `web/src/link-status.ts`, `web/src/results.ts` | wiring | throughout |
| `web/index.html`, `web/tests/browser/harness.ts` | the header, notice line, live region, strip | 6, 8, 9 |
| `web/src/style.css` | header, view header, menus, notice, strip | 3, 4, 5, 6, 7, 8, 9 |
| `crates/redextape-wasm/src/session.rs` | two refusals' wording | 11 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the entry | 13 |

**Task order and why.** 1 (state) and 2 (player) are foundations with no DOM. 3 builds the view header and moves today's controls into it unchanged; 4 replaces those controls with the `⋯` menu and `✕`; 5 replaces the transport strip with the step-control component in the header's slot. 6 (notices) must precede 7 (copies), whose delete-and-undo is a notice action. 8 (app header) needs 1's `insertBeside`. 9 (strip) needs 1's `focused`. 10 is the layout notices and focus rules over everything before it. 11 sweeps the renames no earlier task touched. 12 is the controls-as-a-class gate. 13 verifies and writes the roadmap entry.

---

### Task 1: The workspace state, and `insertBeside`

Spec §3, §5 (`insertBeside`).

**Files:**
- Create: `web/src/workspace.ts`
- Modify: `web/src/layout.ts` (split `parseTree` out of `parseLayout`; add `insertBeside`; `splitLeaf` delegates to it)
- Modify: `web/src/main.ts` (restore and persist the workspace; `focused` from the source view)
- Modify: `web/src/pane-host.ts` (`persist` replaces `writeLayoutStorage`; `setFocused`; per-view panel state)
- Modify: `web/src/pane-chrome.ts` (`PaneEvents.panel`)
- Modify: `web/src/tm-pane.ts` (the rules panel's initial state and report)
- Test: `web/tests/node/workspace.test.ts` (new), `web/tests/node/layout.test.ts`
- Test: `web/tests/browser/workspace-restore.test.ts` (new)
- Modify tests: `web/tests/browser/divider-drag.test.ts`, `two-lambda-panes.test.ts`, `pane-kind-switch.test.ts`, `layout-app.test.ts`, `layout-restore.test.ts`

**Interfaces:**
- Produces (`workspace.ts`): `type Switches`, `const SPEEDS`, `type Speed`, `const DEFAULT_SPEED: Speed` (8), `type Preset`, `const PRESETS: Record<Preset, Switches>`, `type Panels`, `type Workspace = { tree; switches; speed; focused; panels }`, `const WORKSPACE_VERSION` (2), `presetOf(s): Preset | null`, `defaultFocus(tree): LeafId`, `defaultWorkspace(): Workspace`, `withPanel(panels, leaf, name, open): Panels`, `serializeWorkspace(ws): string`, `parseWorkspace(raw: string | null): Workspace | null`, `isSpeed(v: unknown): v is Speed`.
- Produces (`layout.ts`): `parseTree(tree: unknown): LayoutNode | null`, `insertBeside(root, id, dir, newId, kind): LayoutNode`.
- Produces (`pane-chrome.ts`): `PaneEvents.panel?: (name: string, open: boolean) => void`.
- Produces (`pane-host.ts` deps): `persist(): void` (replaces `writeLayoutStorage`), `setFocused(id: LeafId): void`, `panelOpen(leaf: LeafId, name: string): boolean | undefined`, `setPanel(leaf: LeafId, name: string, open: boolean): void`.
- Produces (`tm-pane.ts`): `new TmPane(host, on, panels?: { readonly rules?: boolean })`.
- Produces (`main.ts`, in scope for later tasks): `let tree: LayoutNode`, `let ws: Omit<Workspace, 'tree'>`, `persistWorkspace(): void`.

- [ ] **Step 1: Write the failing node tests for `workspace.ts`**

Create `web/tests/node/workspace.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { defaultLayout, leaves, serializeLayout, splitLeaf } from '../../src/layout'
import {
  DEFAULT_SPEED,
  defaultFocus,
  defaultWorkspace,
  isSpeed,
  PRESETS,
  parseWorkspace,
  presetOf,
  SPEEDS,
  serializeWorkspace,
  type Switches,
  WORKSPACE_VERSION,
  withPanel,
} from '../../src/workspace'

const SPLIT = splitLeaf(defaultLayout(), 'lambda-0', 'row', 'pane-1', 'tm')

describe('presetOf', () => {
  it('names the three presets and calls the other five combinations custom', () => {
    const all: Switches[] = []
    for (const steps of ['view', 'bar'] as const)
      for (const views of ['tiles', 'stage'] as const)
        for (const readout of ['strip', 'inspector'] as const) all.push({ steps, views, readout })
    const named = all.map(presetOf)
    expect(named.filter((p) => p !== null).sort()).toEqual(['debugger', 'explorer', 'stage'])
    expect(named.filter((p) => p === null)).toHaveLength(5)
    expect(presetOf(PRESETS.explorer)).toBe('explorer')
    expect(presetOf(PRESETS.debugger)).toBe('debugger')
    expect(presetOf(PRESETS.stage)).toBe('stage')
  })
})

describe('the speed ladder', () => {
  it('runs from 1/s to 5,000/s with 8/s the default', () => {
    expect(SPEEDS[0]).toBe(1)
    expect(SPEEDS[SPEEDS.length - 1]).toBe(5000)
    expect(DEFAULT_SPEED).toBe(8)
    expect(isSpeed(8)).toBe(true)
    expect(isSpeed(9)).toBe(false)
    expect(isSpeed('8')).toBe(false)
  })
})

describe('defaultFocus', () => {
  it('is the first λ or TM leaf, and the source leaf only when there is no other', () => {
    expect(defaultFocus(defaultLayout())).toBe('lambda-0')
    expect(defaultFocus({ kind: 'leaf', id: 'source', pane: 'source' })).toBe('source')
  })
})

describe('parseWorkspace', () => {
  it('migrates a version 1 layout: the tree kept, Explorer, speed 8, the first view focused, no panels', () => {
    const ws = parseWorkspace(serializeLayout(SPLIT))
    expect(ws).not.toBeNull()
    expect(ws?.tree).toEqual(SPLIT)
    expect(ws?.switches).toEqual(PRESETS.explorer)
    expect(ws?.speed).toBe(8)
    expect(ws?.focused).toBe('lambda-0')
    expect(ws?.panels).toEqual({})
  })

  it('round-trips version 2', () => {
    const ws = {
      tree: SPLIT,
      switches: PRESETS.stage,
      speed: 250 as const,
      focused: 'pane-1',
      panels: { 'tm-0': { rules: false } },
    }
    const raw = serializeWorkspace(ws)
    expect(JSON.parse(raw).version).toBe(WORKSPACE_VERSION)
    expect(parseWorkspace(raw)).toEqual(ws)
  })

  it.each([
    ['nothing stored', null],
    ['not JSON', '{'],
    ['an unknown version', JSON.stringify({ version: 3, tree: defaultLayout() })],
    ['an invalid tree', JSON.stringify({ version: 1, tree: { kind: 'split', dir: 'row', children: [], sizes: [] } })],
  ])('returns null for %s', (_what, raw) => {
    expect(parseWorkspace(raw)).toBeNull()
  })

  const valid = (): Record<string, unknown> => JSON.parse(serializeWorkspace(defaultWorkspace()))
  it.each([
    ['an unknown switch value', (e: Record<string, unknown>) => ({ ...e, switches: { steps: 'side', views: 'tiles', readout: 'strip' } })],
    ['a missing switch', (e: Record<string, unknown>) => ({ ...e, switches: { steps: 'view', views: 'tiles' } })],
    ['a speed off the ladder', (e: Record<string, unknown>) => ({ ...e, speed: 9 })],
    ['a focus naming no leaf', (e: Record<string, unknown>) => ({ ...e, focused: 'pane-9' })],
    ['a panel map keyed by a leaf not in the tree', (e: Record<string, unknown>) => ({ ...e, panels: { 'pane-9': { rules: true } } })],
    ['a panel state that is not a boolean', (e: Record<string, unknown>) => ({ ...e, panels: { 'tm-0': { rules: 'yes' } } })],
  ])('rejects the whole envelope for %s', (_what, spoil) => {
    expect(parseWorkspace(JSON.stringify(spoil(valid())))).toBeNull()
  })
})

describe('serializeWorkspace', () => {
  it('drops the panel state of a leaf that has left the tree, and a focus on one', () => {
    const ws = { ...defaultWorkspace(), focused: 'pane-9', panels: { 'pane-9': { rules: false }, 'tm-0': { rules: false } } }
    const back = JSON.parse(serializeWorkspace(ws))
    expect(back.panels).toEqual({ 'tm-0': { rules: false } })
    expect(back.focused).toBe('lambda-0')
  })
})

describe('withPanel', () => {
  it('records one panel of one view without touching the others', () => {
    const next = withPanel({ 'tm-0': { rules: false } }, 'pane-1', 'rules', true)
    expect(next).toEqual({ 'tm-0': { rules: false }, 'pane-1': { rules: true } })
  })
})

describe('defaultWorkspace', () => {
  it('is the default tree, Explorer, speed 8, focused on the λ view', () => {
    const ws = defaultWorkspace()
    expect(leaves(ws.tree).map((l) => l.id)).toEqual(['source', 'lambda-0', 'tm-0'])
    expect(ws.switches).toEqual(PRESETS.explorer)
    expect(ws.speed).toBe(8)
    expect(ws.focused).toBe('lambda-0')
  })
})
```

- [ ] **Step 2: Add the failing `insertBeside` tests**

Append to `web/tests/node/layout.test.ts` (add `insertBeside` and `parseTree` to its import from `'../../src/layout'`):

```ts
describe('insertBeside', () => {
  it('accepts the source leaf as its subject, including when it is the only leaf', () => {
    const only = { kind: 'leaf', id: 'source', pane: 'source' } as const
    const next = insertBeside(only, 'source', 'row', 'pane-1', 'lambda')
    expect(leaves(next).map((l) => [l.id, l.pane])).toEqual([
      ['source', 'source'],
      ['pane-1', 'lambda'],
    ])
  })

  it('puts the new leaf after its subject in leaves() order', () => {
    const next = insertBeside(defaultLayout(), 'lambda-0', 'row', 'pane-1', 'tm')
    expect(leaves(next).map((l) => l.id)).toEqual(['source', 'lambda-0', 'pane-1', 'tm-0'])
  })

  it('still refuses a second source leaf and a duplicate id', () => {
    expect(() => insertBeside(defaultLayout(), 'tm-0', 'row', 'source', 'source')).toThrow(/already has a source leaf/)
    expect(() => insertBeside(defaultLayout(), 'tm-0', 'row', 'lambda-0', 'lambda')).toThrow(/already in the tree/)
    expect(() => insertBeside(defaultLayout(), 'pane-9', 'row', 'pane-1', 'lambda')).toThrow(/not in the tree/)
  })
})

describe('splitLeaf', () => {
  it('still refuses the source leaf as its subject', () => {
    expect(() => splitLeaf(defaultLayout(), 'source', 'row', 'pane-1', 'lambda')).toThrow(/source pane cannot be split/)
  })
})

describe('parseTree', () => {
  it('validates a bare tree the way parseLayout validates an envelope', () => {
    expect(parseTree(defaultLayout())).toEqual(defaultLayout())
    expect(parseTree({ kind: 'leaf', id: 'x', pane: 'source' })).toBeNull()
    expect(parseTree('nope')).toBeNull()
  })
})
```

(If `layout.test.ts` already has a `describe('splitLeaf')` block, add the `it` to it rather than a second block.)

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm exec vitest run --project node tests/node/workspace.test.ts tests/node/layout.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/workspace"`, and `insertBeside`/`parseTree` not exported.

- [ ] **Step 4: Split `parseTree` out of `parseLayout`, and add `insertBeside`**

In `web/src/layout.ts`, replace the body of `parseLayout` after the version check, and add `parseTree` above it:

```ts
/**
 * A bare tree, validated — `parseLayout`'s check without the envelope, for `workspace.ts`, whose version 2
 * envelope carries the same tree under different neighbours.
 *
 * THE SAME TWO RULES AND NO THIRD: every node passes `validate`, and at most one leaf is the source leaf.
 * Split out rather than duplicated because the envelope is the only thing the two formats disagree about.
 */
export function parseTree(tree: unknown): LayoutNode | null {
  const ids = new Set<string>()
  if (!validate(tree, ids)) return null
  const sources = leaves(tree).filter((l) => l.pane === 'source').length
  if (sources > 1) return null
  return tree
}
```

and in `parseLayout`, replace everything from `const ids = new Set<string>()` to the end of the function with:

```ts
  return parseTree(envelope.tree)
```

Then add `insertBeside` directly above `splitLeaf`, and make `splitLeaf` delegate to it:

```ts
/**
 * Put a new leaf of `kind` beside the leaf `id`, in a split of direction `dir` — `splitLeaf` without its
 * refusal of the source leaf as the SUBJECT.
 *
 * **`+ view` IS WHY THIS EXISTS** (Plan 7 part 2 spec §5). It adds the pick beside the focused view, and the
 * focused view can be the source view — or the only view, when every other has been closed. `splitLeaf`'s
 * subject refusal is about the `⋯` menu's split items, which duplicate the view they are chosen on, and there
 * is one editor, so the source view offers none; that argument says nothing about putting a DIFFERENT view
 * next to it. The other refusals are the tree's own invariants and stay: at most one source leaf, and no id
 * twice (`splitLeaf`'s own doc has both arguments).
 */
export function insertBeside(root: LayoutNode, id: LeafId, dir: Dir, newId: LeafId, kind: PaneKind): LayoutNode {
  if (findLeaf(root, id) === null) throw new Error(`cannot insert beside a leaf that is not in the tree: ${id}`)
  if (kind === 'source' && hasSource(root)) throw new Error('the tree already has a source leaf')
  if (findLeaf(root, newId) !== null) throw new Error(`cannot split into an id already in the tree: ${newId}`)

  const rewrite = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'leaf') {
      if (node.id !== id) return node
      return {
        kind: 'split',
        dir,
        sizes: [0.5, 0.5],
        children: [node, { kind: 'leaf', id: newId, pane: kind }],
      }
    }
    return { ...node, children: node.children.map(rewrite) }
  }
  return rewrite(root)
}
```

and replace `splitLeaf`'s body with:

```ts
  const target = findLeaf(root, id)
  if (target === null) throw new Error(`cannot split a leaf that is not in the tree: ${id}`)
  if (target.pane === 'source') throw new Error('the source pane cannot be split: there is one editor to duplicate')
  return insertBeside(root, id, dir, newId, kind)
```

Keep `splitLeaf`'s existing doc comment, and add one paragraph to it: "**ITS LAST THREE REFUSALS ARE `insertBeside`'s**, to which it delegates once the subject passes; the table above still describes what a caller of either sees."

- [ ] **Step 5: Write `workspace.ts`**

Create `web/src/workspace.ts`:

```ts
import { defaultLayout, type LayoutNode, leaves, parseTree, SOURCE_LEAF } from './layout'
import type { LeafId } from './panes'

/**
 * THE WORKSPACE — everything persisted about how the page is arranged: the layout tree, the three
 * switches, the playback speed, which view has focus, and each view's panel state (Plan 7 part 2 spec §3).
 *
 * **ONE ENVELOPE UNDER THE KEY THE LAYOUT ALREADY USED.** `redextape.layout` held `{ version: 1, tree }`;
 * it holds `{ version: 2, tree, switches, speed, focused, panels }` now, and `parseWorkspace` still reads
 * version 1 — the tree shape did not change, so a stored layout is migrated rather than reset. Any other
 * version is `null`, and the caller uses `defaultWorkspace()`, as `parseLayout`'s callers always have.
 *
 * **THE PRESET IS NOT STORED.** `presetOf` derives it from the switches, because a stored preset would be
 * a second copy of three values that could disagree with them.
 */

/** Where the step controls live: in each view's header, or once in a bar along the bottom (2b). */
export type StepsSwitch = 'view' | 'bar'
/** How the views are drawn: tiled, or as one tabbed stage (2b). */
export type ViewsSwitch = 'tiles' | 'stage'
/** How value and steps are shown: a one-line strip, or an inspector panel (2b). */
export type ReadoutSwitch = 'strip' | 'inspector'

/** The three independent switches (spec §2 decision 2 of the umbrella). */
export type Switches = { readonly steps: StepsSwitch; readonly views: ViewsSwitch; readonly readout: ReadoutSwitch }

/**
 * The playback speed ladder, in steps a second (spec §8). Up to 60 the player takes at most one step per
 * animation frame; above it, several — `player.ts`'s `advance` is the arithmetic.
 */
export const SPEEDS = [1, 2, 4, 8, 15, 30, 60, 250, 1000, 5000] as const
export type Speed = (typeof SPEEDS)[number]
/** Today's rate: `PLAY_MS = 120` was about 8 steps a second, and a default that changes nothing is the point. */
export const DEFAULT_SPEED: Speed = 8

export function isSpeed(v: unknown): v is Speed {
  return typeof v === 'number' && (SPEEDS as readonly number[]).includes(v)
}

export type Preset = 'explorer' | 'debugger' | 'stage'

/** Each preset is one corner of the switch cube (spec §4). */
export const PRESETS: Readonly<Record<Preset, Switches>> = {
  explorer: { steps: 'view', views: 'tiles', readout: 'strip' },
  debugger: { steps: 'bar', views: 'tiles', readout: 'inspector' },
  stage: { steps: 'bar', views: 'stage', readout: 'inspector' },
}

/** Which preset these switches are, or `null` for *custom*. */
export function presetOf(s: Switches): Preset | null {
  for (const name of Object.keys(PRESETS) as Preset[]) {
    const p = PRESETS[name]
    if (p.steps === s.steps && p.views === s.views && p.readout === s.readout) return name
  }
  return null
}

/** Per view, per panel name, whether the panel is open. Only a view's own panels live here — spec §3. */
export type Panels = Readonly<Record<LeafId, Readonly<Record<string, boolean>>>>

export type Workspace = {
  readonly tree: LayoutNode
  readonly switches: Switches
  readonly speed: Speed
  /** The view the user is in — any leaf, the source view included. It drives the readout (spec §9). */
  readonly focused: LeafId
  readonly panels: Panels
}

export const WORKSPACE_VERSION = 2

/**
 * The view a workspace focuses when nothing says otherwise: the first λ or TM leaf in `leaves()` order, or
 * the source leaf when the tree holds nothing else. On a fresh page that is the λ view.
 */
export function defaultFocus(tree: LayoutNode): LeafId {
  const all = leaves(tree)
  return (all.find((l) => l.pane !== 'source') ?? all[0])?.id ?? SOURCE_LEAF
}

export function defaultWorkspace(): Workspace {
  const tree = defaultLayout()
  return { tree, switches: PRESETS.explorer, speed: DEFAULT_SPEED, focused: defaultFocus(tree), panels: {} }
}

/** `panels` with one panel of one view recorded — a new object, as every operation in `layout.ts` returns. */
export function withPanel(panels: Panels, leaf: LeafId, name: string, open: boolean): Panels {
  return { ...panels, [leaf]: { ...panels[leaf], [name]: open } }
}

/**
 * The stored form.
 *
 * **A VIEW THAT HAS LEFT THE TREE LEAVES NO TRACE.** Its panel state is dropped and a focus on it falls back
 * to `defaultFocus`, here rather than at every close, because the close does not need to know this module
 * exists — and `parseWorkspace` refuses both, so writing them would make the next load fall back to the
 * default workspace entirely.
 */
export function serializeWorkspace(ws: Workspace): string {
  const live = new Set(leaves(ws.tree).map((l) => l.id))
  const panels: Record<LeafId, Record<string, boolean>> = {}
  for (const [leaf, open] of Object.entries(ws.panels)) if (live.has(leaf)) panels[leaf] = { ...open }
  return JSON.stringify({
    version: WORKSPACE_VERSION,
    tree: ws.tree,
    switches: ws.switches,
    speed: ws.speed,
    focused: live.has(ws.focused) ? ws.focused : defaultFocus(ws.tree),
    panels,
  })
}

function parseSwitches(v: unknown): Switches | null {
  if (typeof v !== 'object' || v === null) return null
  const s = v as Record<string, unknown>
  if (s.steps !== 'view' && s.steps !== 'bar') return null
  if (s.views !== 'tiles' && s.views !== 'stage') return null
  if (s.readout !== 'strip' && s.readout !== 'inspector') return null
  return { steps: s.steps, views: s.views, readout: s.readout }
}

function parsePanels(v: unknown, ids: ReadonlySet<string>): Panels | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const out: Record<LeafId, Record<string, boolean>> = {}
  for (const [leaf, states] of Object.entries(v as Record<string, unknown>)) {
    if (!ids.has(leaf)) return null
    if (typeof states !== 'object' || states === null || Array.isArray(states)) return null
    const own: Record<string, boolean> = {}
    for (const [name, open] of Object.entries(states as Record<string, unknown>)) {
      if (typeof open !== 'boolean') return null
      own[name] = open
    }
    out[leaf] = own
  }
  return out
}

/**
 * The stored workspace, or `null` if there is nothing usable there.
 *
 * **EVERY FIELD IS HELD TO `parseLayout`'s STANDARD**: a value a person could plausibly type that would
 * parse and then misbehave — a switch value no renderer knows, a speed off the ladder, a focus or a panel
 * entry naming a view that is not in the tree — makes the whole envelope `null`, and the caller falls back
 * to the default. A layout is a preference, so the failure stays silent (spec §13).
 */
export function parseWorkspace(raw: string | null): Workspace | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const e = parsed as Record<string, unknown>

  if (e.version === 1) {
    const tree = parseTree(e.tree)
    if (tree === null) return null
    return { tree, switches: PRESETS.explorer, speed: DEFAULT_SPEED, focused: defaultFocus(tree), panels: {} }
  }
  if (e.version !== WORKSPACE_VERSION) return null

  const tree = parseTree(e.tree)
  if (tree === null) return null
  const switches = parseSwitches(e.switches)
  if (switches === null) return null
  if (!isSpeed(e.speed)) return null
  const ids = new Set(leaves(tree).map((l) => l.id))
  if (typeof e.focused !== 'string' || !ids.has(e.focused)) return null
  const panels = parsePanels(e.panels, ids)
  if (panels === null) return null
  return { tree, switches, speed: e.speed, focused: e.focused, panels }
}
```

- [ ] **Step 6: Run the node tests to see them pass**

Run: `pnpm exec vitest run --project node tests/node/workspace.test.ts tests/node/layout.test.ts`
Expected: PASS.

- [ ] **Step 7: Give `PaneEvents` a panel report, and let `TmPane` take its rules panel's state**

In `web/src/pane-chrome.ts`, add to `PaneEvents` after `collapse?`:

```ts
  /**
   * One of this view's own panels was opened or closed — Plan 7 part 2 spec §3. `pane-host.ts` records it
   * per view in the workspace. OPTIONAL, BY `collapse`'s TEST: a pane has it when it has a panel to report,
   * and the text panel reports through `collapse` instead, because its state belongs to the copy.
   */
  panel?: (name: string, open: boolean) => void
```

In `web/src/tm-pane.ts`, change the constructor signature to `constructor(host: HTMLElement, on: PaneEvents, panels: { readonly rules?: boolean } = {})` and the rules panel's construction to:

```ts
    this.#rulesPanel = createPanel({
      name: 'rules',
      label: 'rules',
      body: this.#tableHost,
      open: panels.rules ?? true,
      onToggle: (open) => {
        this.#drawTable()
        on.panel?.('rules', open)
      },
    })
```

Add one sentence to the constructor's doc comment: "`panels` is the view's stored panel state (`workspace.ts`'s `Panels`), read once here; the rules panel reports every later toggle through `on.panel`."

- [ ] **Step 8: Wire the workspace through `pane-host.ts`**

In `web/src/pane-host.ts`:

1. Replace the `writeLayoutStorage(raw: string): void` dependency with these four, each with a one-paragraph doc in the style of the others:

```ts
  /** Write the whole workspace — tree, switches, speed, focus, panels — to storage (`main.ts`'s `persistWorkspace`). */
  persist(): void
  /** Record that `id` is the view the user is in. */
  setFocused(id: LeafId): void
  /** A view's stored state for one of its panels, or `undefined` for none. */
  panelOpen(leaf: LeafId, name: string): boolean | undefined
  /** Record a view's panel state; `persist` is the caller's to make. */
  setPanel(leaf: LeafId, name: string, open: boolean): void
```

2. In the destructure, replace `writeLayoutStorage` with `persist, setFocused, panelOpen, setPanel`.
3. In `hostFor`'s `focusin` listener, call `setFocused(id)` after `panes.markActive(id)`.
4. In `paneEvents`, add to the returned object: `panel: (name: string, open: boolean) => { setPanel(id, name, open); persist() },`
5. In `applyLayout`'s creation pass, construct the TM pane with its stored state:

```ts
        const rules = panelOpen(l.id, 'rules')
        const pane = new TmPane(host, paneEvents(l.id, slot), rules === undefined ? {} : { rules })
```

6. In `applyLayout`'s `finally`, replace `writeLayoutStorage(serializeLayout(getTree()))` with `persist()`, and drop the now-unused `serializeLayout` import.
7. Update the module doc's list of what crosses from `main.ts` (`writeLayoutStorage` → `persist`), and `createPaneHost`'s doc paragraph naming `writeLayoutStorage`, to say `persist`.

- [ ] **Step 9: Restore and persist the workspace in `main.ts`**

In `web/src/main.ts`:

1. Import `defaultWorkspace`, `parseWorkspace`, `serializeWorkspace`, `withPanel`, `type Workspace` from `'./workspace'`; drop `parseLayout` and `defaultLayout` from the `./layout` import only if nothing else in the file still uses them (`defaultLayout` is still used by the reset button until Task 8).
2. Replace `let tree: LayoutNode = parseLayout(readLayoutStorage()) ?? defaultLayout()` with:

```ts
  /**
   * THE WORKSPACE — restored from `localStorage` if there is a usable value there (a version 1 layout is
   * migrated: `workspace.ts`'s `parseWorkspace`), the default otherwise.
   *
   * **`tree` STAYS ITS OWN `let`, AND `ws` HOLDS THE REST.** `pane-host.ts` reads and writes the tree through
   * `getTree`/`setTree` on every gesture, and its doc argues why the tree has one owner; folding it into `ws`
   * would move that owner without changing anything a reader could see. `persistWorkspace` joins the two at
   * the one moment they are written.
   */
  const restored = parseWorkspace(readLayoutStorage()) ?? defaultWorkspace()
  let tree: LayoutNode = restored.tree
  let ws: Omit<Workspace, 'tree'> = {
    switches: restored.switches,
    speed: restored.speed,
    focused: restored.focused,
    panels: restored.panels,
  }
  const persistWorkspace = (): void => writeLayoutStorage(serializeWorkspace({ tree, ...ws }))
```

3. In `createPaneHost({...})`, replace `writeLayoutStorage,` with:

```ts
    persist: persistWorkspace,
    setFocused: (id: LeafId) => {
      if (ws.focused === id) return
      ws = { ...ws, focused: id }
      persistWorkspace()
    },
    panelOpen: (leaf: LeafId, name: string) => ws.panels[leaf]?.[name],
    setPanel: (leaf: LeafId, name: string, open: boolean) => {
      ws = { ...ws, panels: withPanel(ws.panels, leaf, name, open) }
    },
```

4. Give the source host a focus listener, right after `sourceHost.append(...)`:

```ts
  // THE SOURCE VIEW CAN HOLD THE FOCUS TOO (spec §3: `focused` is any leaf) — it drives the readout from
  // Task 9 on. Not `markActive`: that one is per leg, and the source view is on neither (`hostFor`'s own
  // comment in `pane-host.ts` has the argument).
  sourceHost.addEventListener('focusin', () => {
    if (ws.focused === SOURCE_LEAF) return
    ws = { ...ws, focused: SOURCE_LEAF }
    persistWorkspace()
  })
```

5. Update the doc comments that name `writeLayoutStorage` as `pane-host.ts`'s dependency (the `createPaneHost` call's doc, and `writeBuffersStorage`'s doc's comparison with it — the latter still describes the guarded writer, which `persistWorkspace` calls, so reword it to "the layout's writer").

- [ ] **Step 10: Point the browser tests that read the stored layout at the new envelope**

The tests that SEED version 1 (`serializeLayout(...)`) keep working through the migration — leave them. The four that READ storage back:

- `web/tests/browser/divider-drag.test.ts`: replace `import { LAYOUT_STORAGE_KEY, parseLayout } from '../../src/layout'` with `import { LAYOUT_STORAGE_KEY } from '../../src/layout'` plus `import { parseWorkspace } from '../../src/workspace'`, and `const tree = parseLayout(raw)` with `const tree = parseWorkspace(raw)?.tree ?? null`.
- `web/tests/browser/two-lambda-panes.test.ts`: `const stored = parseLayout(localStorage.getItem(LAYOUT_STORAGE_KEY))` → `const stored = parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.tree ?? null`, and the imports likewise.
- `web/tests/browser/pane-kind-switch.test.ts`: `const storedTree = (): LayoutNode | null => parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.tree ?? null`, and the imports likewise.
- `web/tests/browser/layout-app.test.ts`: read the test around its `JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}')` and change what it asserts of the parsed object from the version 1 shape to the version 2 one (`version: 2`, the tree under `tree`, plus `switches`/`speed`/`focused`/`panels` present).

In `web/tests/browser/layout-restore.test.ts`, which seeds a version 1 split, add one test after its existing ones:

```ts
  it('rewrites the migrated layout as version 2, the tree intact', () => {
    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}')
    expect(stored.version).toBe(2)
    expect(stored.switches).toEqual({ steps: 'view', views: 'tiles', readout: 'strip' })
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.tree).toEqual(JSON.parse(STORED).tree)
  })
```

- [ ] **Step 11: Write the browser test for a restored version 2 workspace**

Create `web/tests/browser/workspace-restore.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, PRESETS, parseWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A STORED VERSION 2 WORKSPACE, THROUGH THE REAL APP** — Plan 7 part 2 spec §3. Seeded before `main.ts`
 * is imported, because `main()` runs once per page and reads storage once. The version 1 path is
 * `layout-restore.test.ts`'s, which seeds a version 1 layout and checks it comes back as version 2.
 */

beforeAll(async () => {
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...defaultWorkspace(), speed: 250, focused: 'tm-0', panels: { 'tm-0': { rules: false } } }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

const rulesToggle = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>('[data-leaf="tm-0"] [data-panel="rules"] .panel-toggle')

describe('a restored workspace', () => {
  it('opens the TM view with its rules panel closed, as stored', () => {
    expect(rulesToggle()?.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps what it restored when it writes back', () => {
    const ws = parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))
    expect(ws?.speed).toBe(250)
    expect(ws?.switches).toEqual(PRESETS.explorer)
  })

  it('records a panel toggle against the view it happened in', () => {
    rulesToggle()?.click()
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.panels['tm-0']).toEqual({ rules: true })
  })

  it('records which view has focus', () => {
    document.querySelector<HTMLElement>('[data-leaf="lambda-0"] button:not([disabled])')?.focus()
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.focused).toBe('lambda-0')
    document.querySelector<HTMLElement>('[data-leaf="source"] .cm-content')?.focus()
    expect(parseWorkspace(localStorage.getItem(LAYOUT_STORAGE_KEY))?.focused).toBe('source')
  })
})
```

- [ ] **Step 12: Run the changed and new browser tests, then typecheck**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/workspace-restore.test.ts tests/browser/layout-restore.test.ts tests/browser/layout-app.test.ts tests/browser/divider-drag.test.ts tests/browser/pane-kind-switch.test.ts tests/browser/two-lambda-panes.test.ts`
Expected: PASS.
Run: `pnpm run typecheck`
Expected: exit 0.

- [ ] **Step 13: Sabotage, once each, and record the assertion that fired**

1. In `workspace.ts`'s `parseWorkspace`, change the version 1 branch's `switches: PRESETS.explorer` to `PRESETS.stage`. Expect `workspace.test.ts`'s migration test and `layout-restore.test.ts`'s new test red. Revert.
2. In `pane-host.ts`, delete `open: panels.rules ?? true,`'s effect by passing `{}` in the creation pass. Expect `workspace-restore.test.ts`'s "rules panel closed" red. Revert.
3. In `serializeWorkspace`, write `focused: ws.focused` unconditionally. Expect `workspace.test.ts`'s "drops the panel state of a leaf that has left the tree" red. Revert.

- [ ] **Step 14: Commit**

```bash
pnpm exec biome ci --error-on-warnings src/workspace.ts src/layout.ts src/main.ts src/pane-host.ts src/pane-chrome.ts src/tm-pane.ts tests/node/workspace.test.ts tests/node/layout.test.ts tests/browser/workspace-restore.test.ts tests/browser/layout-restore.test.ts tests/browser/layout-app.test.ts tests/browser/divider-drag.test.ts tests/browser/pane-kind-switch.test.ts tests/browser/two-lambda-panes.test.ts
git add -A web/src web/tests
git commit -m "The layout is stored as a version 2 workspace — switches, speed, focus and each view's panels beside the tree — and a version 1 layout migrates rather than resets"
```

---

### Task 2: One player, and `playing` in place of the per-leg timer

Spec §8 (the player; `ControlState.playing`). No DOM changes yet: the play button still reads `⏵` until Task 5.

**Files:**
- Create: `web/src/player.ts`
- Modify: `web/src/sessions.ts` (`LegState.playing`; `resetLegs`; `PaneSlot.render` passes it)
- Modify: `web/src/controls.ts` (`LegView.playing`, `ControlState.playing`)
- Modify: `web/src/transport.ts` (`speed` dependency; `play` through the player; `PLAY_MS` deleted)
- Modify: `web/src/main.ts` (`playing: false` in the source session's legs; `speed: () => ws.speed`)
- Modify: `web/src/scratch.ts` (`#spawn`'s legs)
- Test: `web/tests/node/player.test.ts` (new), `web/tests/node/controls.test.ts`
- Modify tests: every `timer: null` fixture and the two `leg.timer = setInterval(...)` tests — `tests/browser/scratch-fork.test.ts`, `binding-selector.test.ts`, `editor-custody.test.ts`, `tests/node/replies.test.ts`, `sessions.test.ts`, `scratch.test.ts`; the four `createTransport({...})` calls in `tests/node/sessions.test.ts`

**Interfaces:**
- Consumes: `workspace.ts`'s `Speed` (Task 1) — only as a number; `player.ts` takes `speed: () => number`.
- Produces (`player.ts`): `const MAX_FRAME_MS = 100`, `advance(carry: number, speed: number, elapsedMs: number): { steps: number; carry: number }`, `type Playable = { playing: boolean; readonly hist: { forward(): boolean } }`, `type Player = { toggle(leg: Playable): void }`, `createPlayer(deps: { speed(): number; draw(): void; frame?: (cb: (now: number) => void) => void }): Player`.
- Produces (`sessions.ts`): `LegState<T>.playing: boolean` (replaces `timer`).
- Produces (`controls.ts`): `LegView.playing: boolean`, `ControlState.playing: boolean`.
- Produces (`transport.ts` deps): `speed: () => number`.

- [ ] **Step 1: Write the failing player tests**

Create `web/tests/node/player.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { advance, createPlayer, MAX_FRAME_MS, type Playable } from '../../src/player'
import { SPEEDS } from '../../src/workspace'

/** A leg whose history has `frames` steps left to take. */
const leg = (frames: number): Playable & { taken: number } => {
  const l = {
    playing: false,
    taken: 0,
    hist: {
      forward: (): boolean => {
        if (l.taken >= frames) return false
        l.taken += 1
        return true
      },
    },
  }
  return l
}

/** A frame scheduler the test drives by hand: `run(t)` fires every queued callback at time `t`. */
const clock = () => {
  let queued: ((now: number) => void)[] = []
  return {
    frame: (cb: (now: number) => void) => {
      queued.push(cb)
    },
    run(t: number) {
      const now = queued
      queued = []
      for (const cb of now) cb(t)
    },
    get pending() {
      return queued.length
    },
  }
}

describe('advance', () => {
  it('takes at most one step per 60 Hz frame at 60/s and below', () => {
    for (const speed of SPEEDS.filter((s) => s <= 60)) {
      let carry = 0
      for (let i = 0; i < 600; i++) {
        const r = advance(carry, speed, 1000 / 60)
        expect(r.steps).toBeLessThanOrEqual(1)
        carry = r.carry
      }
    }
  })

  it('totals floor(speed × elapsed) over unclamped frames at every ladder value', () => {
    for (const speed of SPEEDS) {
      let carry = 0
      let total = 0
      const frames = [16, 17, 16, 33, 8, 50, 16, 17]
      for (const ms of frames) {
        const r = advance(carry, speed, ms)
        total += r.steps
        carry = r.carry
      }
      const elapsed = frames.reduce((a, b) => a + b, 0)
      // A floating-point carry may land one step short of the exact floor, never over it.
      expect(total).toBeLessThanOrEqual(Math.floor((speed * elapsed) / 1000))
      expect(total).toBeGreaterThanOrEqual(Math.floor((speed * elapsed) / 1000) - 1)
    }
  })

  it('clamps a long frame, so a tab back from the background does not jump', () => {
    expect(advance(0, 5000, 10_000).steps).toBe((5000 * MAX_FRAME_MS) / 1000)
  })
})

describe('createPlayer', () => {
  it('toggles a leg on and off, and draws while it moves', () => {
    const c = clock()
    let draws = 0
    const p = createPlayer({ speed: () => 60, draw: () => draws++, frame: c.frame })
    const l = leg(100)
    p.toggle(l)
    expect(l.playing).toBe(true)
    c.run(0)
    c.run(1000 / 60)
    c.run(2000 / 60)
    expect(l.taken).toBeGreaterThanOrEqual(1)
    expect(draws).toBeGreaterThanOrEqual(1)
    p.toggle(l)
    expect(l.playing).toBe(false)
  })

  it('stops a leg at its recorded frontier, and draws that it stopped', () => {
    const c = clock()
    let draws = 0
    const p = createPlayer({ speed: () => 5000, draw: () => draws++, frame: c.frame })
    const l = leg(3)
    p.toggle(l)
    c.run(0)
    c.run(100)
    expect(l.taken).toBe(3)
    expect(l.playing).toBe(false)
    expect(draws).toBeGreaterThanOrEqual(1)
    expect(c.pending).toBe(0)
  })

  it('lets go of a leg whose flag something else cleared', () => {
    const c = clock()
    const p = createPlayer({ speed: () => 60, draw: () => undefined, frame: c.frame })
    const l = leg(100)
    p.toggle(l)
    c.run(0)
    l.playing = false
    c.run(100)
    expect(l.taken).toBe(0)
    expect(c.pending).toBe(0)
  })

  it('reads the speed on every frame', () => {
    const c = clock()
    let speed = 1
    const p = createPlayer({ speed: () => speed, draw: () => undefined, frame: c.frame })
    const l = leg(10_000)
    p.toggle(l)
    c.run(0)
    c.run(100)
    const slow = l.taken
    speed = 5000
    c.run(200)
    expect(l.taken - slow).toBe(500)
  })
})
```

Add to `web/tests/node/controls.test.ts`: `playing: false,` in the `view` fixture (after `awaitingRun`), and:

```ts
describe('playing', () => {
  it('is what the leg says while the leg is available, and false when it is not', () => {
    expect(controlState(view({ length: 3, playing: true })).playing).toBe(true)
    expect(controlState(view({ length: 3, playing: false })).playing).toBe(false)
    expect(controlState(view({ available: false, playing: true })).playing).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project node tests/node/player.test.ts tests/node/controls.test.ts`
Expected: FAIL — `player.ts` does not exist; `playing` is not a `LegView` field.

- [ ] **Step 3: Write `player.ts`**

Create `web/src/player.ts`:

```ts
/**
 * THE PLAYER — one `requestAnimationFrame` loop over every playing leg, at the workspace's one speed
 * (Plan 7 part 2 spec §8).
 *
 * **IT REPLACES A `setInterval` PER LEG, AND THE REASON IS THE SPEEDS, NOT TIDINESS.** `transport.ts`'s
 * interval stepped once every 120 ms, about 8 steps a second: `fact(3)`'s 18,574 transitions took about 39
 * minutes. An interval cannot step faster than the display paints anyway, so rates above 60/s take several
 * steps per frame and paint once — `advance` is that arithmetic, kept pure so a node test can hold it.
 *
 * **THE FLAG ON THE LEG IS THE TRUTH, AND THE PLAYER ONLY FOLLOWS IT.** `LegState.playing` is what the step
 * control reads to show `⏸`, and `sessions.ts`'s `resetLegs` clears it when a recompile replaces the
 * history. The player therefore checks the flag on every frame and lets go of a leg whose flag something
 * else cleared, rather than keeping a second copy of "is this playing" that could disagree.
 *
 * **SEMANTICS UNCHANGED:** play walks recorded frames, stops at the recorded frontier, and never asks the
 * worker for more — `▶` at the frontier and *continue* do that, so play cannot run away with a cap raise
 * nobody clicked.
 */

/**
 * The longest frame the player honours, in milliseconds. A tab in the background gets no frames, and the
 * first one back can report seconds of elapsed time; without a clamp, 5,000/s would jump thousands of steps
 * in one paint.
 */
export const MAX_FRAME_MS = 100

/**
 * How many steps one frame takes, and the fraction left over for the next.
 *
 * **THE FRACTION IS CARRIED, NOT DROPPED.** At 8/s a 60 Hz frame is worth 0.13 of a step; rounding each frame
 * would take none, ever.
 */
export function advance(carry: number, speed: number, elapsedMs: number): { steps: number; carry: number } {
  const total = carry + (speed * Math.min(elapsedMs, MAX_FRAME_MS)) / 1000
  const steps = Math.floor(total)
  return { steps, carry: total - steps }
}

/** What the player needs of a leg: its flag, and a history it can step forward. `LegState` is one. */
export type Playable = { playing: boolean; readonly hist: { forward(): boolean } }

export type Player = {
  /** Start `leg` playing, or stop it if it is playing — the play button's one gesture. */
  toggle(leg: Playable): void
}

/**
 * Build the player.
 *
 * `frame` IS INJECTABLE SO A NODE TEST CAN DRIVE THE CLOCK BY HAND; the app passes nothing and gets
 * `requestAnimationFrame`. `speed` IS A THUNK, read on every frame, so a speed change takes effect on the
 * next paint without the player being told.
 */
export function createPlayer(deps: {
  speed(): number
  draw(): void
  frame?: (cb: (now: number) => void) => void
}): Player {
  const frame = deps.frame ?? ((cb: (now: number) => void) => void requestAnimationFrame(cb))
  const carries = new Map<Playable, number>()
  let last: number | null = null
  let scheduled = false

  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    frame(tick)
  }

  function tick(now: number): void {
    scheduled = false
    const elapsed = last === null ? 0 : now - last
    last = now
    let changed = false
    for (const [leg, carry] of carries) {
      if (!leg.playing) {
        carries.delete(leg)
        continue
      }
      const { steps, carry: rest } = advance(carry, deps.speed(), elapsed)
      carries.set(leg, rest)
      for (let i = 0; i < steps; i++) {
        if (leg.hist.forward()) {
          changed = true
          continue
        }
        leg.playing = false
        carries.delete(leg)
        changed = true
        break
      }
    }
    if (changed) deps.draw()
    if (carries.size > 0) schedule()
    else last = null
  }

  return {
    toggle(leg: Playable): void {
      if (leg.playing) {
        leg.playing = false
        carries.delete(leg)
        return
      }
      leg.playing = true
      carries.set(leg, 0)
      schedule()
    },
  }
}
```

- [ ] **Step 4: `playing` through the session types and the control state**

In `web/src/sessions.ts`:
- Replace `LegState`'s `timer: ReturnType<typeof setInterval> | null` with `playing: boolean`, and rewrite that field's doc to say: whether the play button is on for this leg — `player.ts`'s flag, which the player follows and `resetLegs` clears.
- In `resetLegs`, replace the two `timer` lines with `leg.playing = false`, and update the comment above them if it names the timer.
- In `PaneSlot.render`'s `controlState({...})` call, add `playing: leg.playing,` after `awaitingRun`.

In `web/src/controls.ts`:
- `LegView` gains, after `awaitingRun`: `/** Whether this leg's play button is on — `LegState.playing`. */ playing: boolean`.
- `ControlState` gains, after `canRestart`: `/** Whether playback is running, so the play button shows ⏸ and is named "pause" (spec §8, umbrella rule 3). */ playing: boolean`.
- In `controlState`, the unavailable branch returns `playing: false`; the available branch returns `playing: v.playing`.

- [ ] **Step 5: Play through the player in `transport.ts`**

In `web/src/transport.ts`:
- Delete `PLAY_MS` and its doc.
- Add to `createTransport`'s deps, after `draw`: `/** The workspace's speed, in steps a second — read by the player on every frame. */ speed: () => number`.
- Replace the body of `play` with `player.toggle(leg)`, after building the player once at the top of the factory: `const player = createPlayer({ speed: deps.speed, draw })`. Keep `play`'s generic signature. Rewrite its doc to say playback is `player.ts`'s loop now; keep the paragraph about `<T>(leg: LegState<T>)` if it still reads true, or cut it to one sentence.
- Update the module doc's first line (`` `play`, THE INTERVAL THAT WALKS RECORDED FRAMES ``) to say "the player".

In `web/src/main.ts`: `timer: null,` → `playing: false,` in both source legs, and add `speed: () => ws.speed,` to `createTransport({...})` — a thunk over Task 1's `ws`, which `main()` declares further down: the player reads it only during playback, long after `main()` has run, the same forward reference `createTransport`'s `onBuffersChanged: () => refreshBuffers()` already makes (its comment says so; add one line saying the same of `speed`). In `web/src/scratch.ts`'s `#spawn`: `timer: null` → `playing: false` twice.

- [ ] **Step 6: Update the fixtures and the two timer tests**

Replace `timer: null` with `playing: false` in: `tests/browser/scratch-fork.test.ts`, `tests/browser/binding-selector.test.ts` (three), `tests/browser/editor-custody.test.ts`, `tests/node/replies.test.ts`, `tests/node/sessions.test.ts`, `tests/node/scratch.test.ts` (two). Command, from `web/`:

```bash
perl -pi -e 's/\btimer: null\b/playing: false/g' tests/browser/scratch-fork.test.ts tests/browser/binding-selector.test.ts tests/browser/editor-custody.test.ts tests/node/replies.test.ts tests/node/sessions.test.ts tests/node/scratch.test.ts
grep -rn 'timer: null' tests src
```

Expected: the `grep` prints nothing.

Then the two tests that park a real interval and expect it cleared: in `tests/node/sessions.test.ts` (the test around `lambdaLeg.timer = setInterval(...)`) and `tests/node/scratch.test.ts` (around `leg.timer = setInterval(...)`), replace the assignment with `lambdaLeg.playing = true` / `leg.playing = true` and the expectation with `expect(lambdaLeg.playing).toBe(false)` / `expect(leg.playing).toBe(false)`. Reword each test's name and comment from "clears its play timer" to "stops its playback".

Add `speed: () => 8,` to each of the four `createTransport({...})` calls in `tests/node/sessions.test.ts`.

Search for comments citing the deleted names and update them in this commit — the attribution gate fails on a citation of a symbol its file no longer declares:

```bash
grep -rn 'LegState.timer\|PLAY_MS\|leg\.timer\|play timer' src tests
```

Expected after the edits: nothing, or only prose that no longer claims the symbol exists.

- [ ] **Step 7: Run the tests**

Run: `pnpm exec vitest run --project node tests/node/player.test.ts tests/node/controls.test.ts tests/node/sessions.test.ts tests/node/scratch.test.ts tests/node/replies.test.ts`
Expected: PASS.
Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/running-focus.test.ts tests/browser/binding-selector.test.ts tests/browser/editor-custody.test.ts tests/browser/scratch-fork.test.ts`
Expected: PASS (`running-focus.test.ts` drives playback through the real app).
Run: `pnpm run typecheck`
Expected: exit 0.

- [ ] **Step 8: Sabotage, once each**

1. In `advance`, drop the carry (`return { steps, carry: 0 }`). Expect `player.test.ts`'s "totals floor(speed × elapsed)" red at low speeds. Revert.
2. In `tick`, skip the `if (!leg.playing)` check. Expect "lets go of a leg whose flag something else cleared" red. Revert.
3. In `resetLegs`, drop `leg.playing = false`. Expect the renamed sessions/scratch tests red. Revert.

- [ ] **Step 9: Commit**

```bash
pnpm exec biome ci --error-on-warnings src/player.ts src/sessions.ts src/controls.ts src/transport.ts src/main.ts src/scratch.ts tests/node/player.test.ts tests/node/controls.test.ts tests/node/sessions.test.ts tests/node/scratch.test.ts tests/node/replies.test.ts tests/browser/scratch-fork.test.ts tests/browser/binding-selector.test.ts tests/browser/editor-custody.test.ts
git add -A web/src web/tests
git commit -m "Playback is one animation-frame loop at the workspace's speed, and a leg says whether it is playing rather than holding an interval"
```

---

### Task 3: The view header — the title is the selector, and the status says "copy · not linked"

Spec §7 (title-selector, status), §12 (`program`, `copy · not linked`, the `h2` titles). Today's transport strip, split, close, fork and claim controls move into the header unchanged; Tasks 4 and 5 replace them.

**Files:**
- Create: `web/src/view-header.ts`
- Modify: `web/src/icons.ts` (no new icon yet; `disclose` is the title's caret)
- Modify: `web/src/pane-chrome.ts` (delete `paneSelect` and `detachedBadge`)
- Modify: `web/src/lambda-pane.ts`, `web/src/tm-pane.ts` (build the header; strip moves into it)
- Modify: `web/src/main.ts` (the source view's header; the program session's label is `program`)
- Modify: `web/src/pane-host.ts` (`focusPane`'s doc: the first control is now the title)
- Modify: `web/src/style.css` (`.view-header`, `.view-title`, `.view-title-menu`, `.view-status`; delete `.pane h2`'s margin rule if it no longer applies, `.detached-badge`, `.pane-binding`, `.pane-binding select`)
- Test: `web/tests/browser/view-header.test.ts` (new)
- Modify tests: every file in the table in Step 7

**Interfaces:**
- Produces (`view-header.ts`):
  - `bindingKey(leg: Leg, session: SessionId): string` — `` `${leg}\x00${session}` ``, the value tests pick by.
  - `pairLabel(o: { readonly leg: Leg; readonly label: string }): string` — `` `λ · ${label}` `` or `` `TM · ${label}` ``.
  - `type ViewHeader = { readonly el: HTMLElement; readonly steps: HTMLElement; readonly actions: HTMLElement; setBindings(options: readonly PaneOption[], current: Binding<Leg>): void; setDetached(detached: boolean): void }`
  - `viewHeader(onPick: (choice: Binding<Leg>) => void): ViewHeader`
  - `sourceViewHeader(): { readonly el: HTMLElement; readonly actions: HTMLElement }`
- DOM contract later tasks and tests rely on: `header.view-header > h2.view-title-heading > (button.view-title[data-binding] | span.view-title)`, `+ span.view-status` (present only while detached); `div.view-title-menu[popover] > button[data-binding]`; `.view-steps`; `.view-actions`.

- [ ] **Step 1: Write the failing unit test**

Create `web/tests/browser/view-header.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import type { Binding, PaneOption } from '../../src/sessions'
import type { Leg } from '../../src/protocol'
import { bindingKey, pairLabel, sourceViewHeader, viewHeader } from '../../src/view-header'

const PROGRAM_λ: PaneOption = { leg: 'lambda', id: 'source', label: 'program' }
const PROGRAM_TM: PaneOption = { leg: 'tm', id: 'source', label: 'program' }
const COPY: PaneOption = { leg: 'lambda', id: 'scratch-1', label: 'copy 1' }

afterEach(() => {
  document.body.replaceChildren()
})

const mount = (onPick: (b: Binding<Leg>) => void = () => undefined) => {
  const h = viewHeader(onPick)
  document.body.append(h.el)
  return h
}

describe('the title-selector', () => {
  it('reads the pair in force, in the header heading, and is a button while there is a choice', () => {
    const h = mount()
    h.setBindings([PROGRAM_λ, PROGRAM_TM], { leg: 'lambda', session: 'source' })
    const title = h.el.querySelector<HTMLButtonElement>('h2 > button.view-title')
    expect(title?.textContent).toBe('λ · program')
    expect(title?.dataset.binding).toBe(bindingKey('lambda', 'source'))
    expect(title?.getAttribute('aria-haspopup')).toBe('menu')
    expect(title?.getAttribute('aria-expanded')).toBe('false')
  })

  it('is plain text, never removed, when there is one pair', () => {
    const h = mount()
    h.setBindings([PROGRAM_λ], { leg: 'lambda', session: 'source' })
    expect(h.el.querySelector('button.view-title')).toBeNull()
    expect(h.el.querySelector('span.view-title')?.textContent).toBe('λ · program')
  })

  it('opens a menu of every pair, the one in force marked, and reports a pick', () => {
    const picks: Binding<Leg>[] = []
    const h = mount((b) => picks.push(b))
    h.setBindings([PROGRAM_λ, PROGRAM_TM, COPY], { leg: 'lambda', session: 'source' })
    h.el.querySelector<HTMLButtonElement>('button.view-title')?.click()
    const items = [...document.querySelectorAll<HTMLButtonElement>('.view-title-menu button')]
    expect(items.map((b) => b.textContent)).toEqual(['λ · program', 'λ · copy 1', 'TM · program'])
    expect(items.map((b) => b.dataset.binding)).toEqual([
      bindingKey('lambda', 'source'),
      bindingKey('lambda', 'scratch-1'),
      bindingKey('tm', 'source'),
    ])
    expect(items[0]?.getAttribute('aria-current')).toBe('true')
    expect(document.activeElement).toBe(items[0])
    items[2]?.click()
    expect(picks).toEqual([{ leg: 'tm', session: 'source' }])
  })

  it('does not rebuild on a repeat update, so an open menu survives a frame', () => {
    const h = mount()
    h.setBindings([PROGRAM_λ, PROGRAM_TM], { leg: 'lambda', session: 'source' })
    const before = h.el.querySelector('button.view-title')
    h.setBindings([PROGRAM_λ, PROGRAM_TM], { leg: 'lambda', session: 'source' })
    expect(h.el.querySelector('button.view-title')).toBe(before)
  })
})

describe('the status', () => {
  it('says "copy · not linked" while detached, with a non-colour carrier, and is removed when not', () => {
    const h = mount()
    h.setBindings([PROGRAM_λ, COPY], { leg: 'lambda', session: 'scratch-1' })
    h.setDetached(true)
    const status = h.el.querySelector<HTMLElement>('h2 .view-status')
    expect(status?.textContent).toBe('copy · not linked')
    h.setDetached(false)
    expect(h.el.querySelector('.view-status')).toBeNull()
    expect(h.el.querySelector('h2')?.textContent).toBe('λ · copy 1')
  })
})

describe('the source view header', () => {
  it('is titled "source", as plain text', () => {
    const s = sourceViewHeader()
    expect(s.el.querySelector('h2 span.view-title')?.textContent).toBe('source')
    expect(s.el.querySelector('button.view-title')).toBeNull()
  })
})

describe('pairLabel', () => {
  it('spells the leg the way the menus do', () => {
    expect(pairLabel(PROGRAM_TM)).toBe('TM · program')
    expect(pairLabel(COPY)).toBe('λ · copy 1')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/view-header.test.ts`
Expected: FAIL — `view-header.ts` does not exist.

- [ ] **Step 3: Write `view-header.ts`**

Create `web/src/view-header.ts`:

```ts
import { icon } from './icons'
import type { Leg } from './protocol'
import type { SessionId } from './session-client'
import type { Binding, PaneOption } from './sessions'

/**
 * A VIEW'S HEADER — Plan 7 part 2 spec §7. Left to right: the title, which is the selector; the status;
 * the step controls; the view's actions (`⋯`, `✕`).
 *
 * **THE TITLE IS THE SELECTOR, AND IT REPLACES THREE THINGS.** A view used to carry an `<h2>` naming its
 * leg (`lambda`, `turing machine`), a `shows` select listing `(leg, session)` pairs under two optgroups,
 * and a `[detached]` badge. The inventory that opened Plan 7 found the select reading as a trivial choice
 * while picking the other leg rebuilt the whole view, with only an optgroup label saying so. Now the title
 * says what the view shows — `λ · program`, `TM · copy 2` — and opening it is how to show something else.
 *
 * **THE `<h2>` STAYS, AS THE TITLE'S CONTAINER.** A view is a section with a heading: the heading is what a
 * screen-reader user jumps between views by, and the status sits inside it as the badge did, so the two
 * facts about a view's identity — what it shows, and that it is a copy no longer linked to the program —
 * read together.
 *
 * **A PICK IS REPORTED, NOT PERFORMED.** `onPick` is `PaneEvents.rebind`, and `pane-host.ts` decides what a
 * pick across legs does (it rebuilds the view in place). This module knows nothing about the tree.
 */

const legLabel = (leg: Leg): string => (leg === 'lambda' ? 'λ' : 'TM')

/** How a pair reads everywhere a menu names one: `λ · program`, `TM · copy 2`. */
export function pairLabel(o: { readonly leg: Leg; readonly label: string }): string {
  return `${legLabel(o.leg)} · ${o.label}`
}

/**
 * The key a pair travels under — the menu items' `data-binding`, and the title's, which is what tests pick
 * and read by.
 *
 * **`\x00` AS AN ESCAPE, NEVER THE BYTE** (`scripts/check-text-bytes.sh`): one NUL makes the whole file
 * binary to every search tool. It cannot occur in a leg or a session id, so the join is exact.
 */
export function bindingKey(leg: Leg, session: SessionId): string {
  return `${leg}\x00${session}`
}

export type ViewHeader = {
  readonly el: HTMLElement
  /** Where the step controls mount — each view's own, while the `steps` switch is `view`. */
  readonly steps: HTMLElement
  /** Where the view's actions mount: `⋯` and `✕`. */
  readonly actions: HTMLElement
  /** The pairs on offer and the one in force. On the per-frame path: a repeat call changes nothing. */
  setBindings(options: readonly PaneOption[], current: Binding<Leg>): void
  /** Whether the view shows a copy, which is not linked to the program. */
  setDetached(detached: boolean): void
}

/**
 * Unique ids for the title menus, so each title's `aria-controls` names exactly one menu — per module, for
 * `pane-chrome.ts`'s old `pickerSeq` reason: every view on the page builds one.
 */
let menuSeq = 0

/** The `<header>`, its heading, and the two slots — shared by `viewHeader` and `sourceViewHeader`. */
function frame(): { el: HTMLElement; heading: HTMLElement; steps: HTMLElement; actions: HTMLElement } {
  const el = document.createElement('header')
  el.className = 'view-header'
  const heading = document.createElement('h2')
  heading.className = 'view-title-heading'
  const steps = document.createElement('div')
  steps.className = 'view-steps'
  const actions = document.createElement('div')
  actions.className = 'view-actions'
  el.append(heading, steps, actions)
  return { el, heading, steps, actions }
}

export function viewHeader(onPick: (choice: Binding<Leg>) => void): ViewHeader {
  const { el, heading, steps, actions } = frame()

  const menu = document.createElement('div')
  menu.className = 'view-title-menu'
  menu.id = `view-title-menu-${menuSeq++}`
  menu.popover = 'auto'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'view-title'
  button.title = 'choose what this view shows'
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-controls', menu.id)
  // STATED FROM CONSTRUCTION, NOT FROM THE FIRST TOGGLE — `splitControl`'s reason: a disclosure with no
  // `aria-expanded` announces as a plain button to the reader who most needs to know it opens something.
  button.setAttribute('aria-expanded', 'false')
  button.popoverTargetElement = menu
  const buttonText = document.createElement('span')
  const caret = icon('disclose')
  caret.classList.add('view-title-caret')
  button.append(buttonText, caret)

  const plain = document.createElement('span')
  plain.className = 'view-title'

  const status = document.createElement('span')
  status.className = 'view-status'
  status.textContent = 'copy · not linked'
  status.title = 'this view shows a copy, which is not linked to the program'

  let options: readonly PaneOption[] = []
  let current: Binding<Leg> | null = null
  let rendered = ''
  let detached = false

  // BUILT ON OPEN, NOT PER FRAME — `splitControl`'s rule, which `pane-chrome.ts` stated for the same
  // per-frame reason: `draw()` repaints every view on every recorded frame during playback, and a menu that
  // is closed has no state to keep fresh. The first item takes `autofocus`, which the popover's own show
  // steps honour after it is visible; `.focus()` here would run while it is still `display: none`.
  menu.addEventListener('beforetoggle', (e) => {
    const open = e.newState === 'open'
    button.setAttribute('aria-expanded', String(open))
    if (!open) return
    const items = options.map((o) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = pairLabel(o)
      b.dataset.binding = bindingKey(o.leg, o.id)
      if (current !== null && o.leg === current.leg && o.id === current.session) b.setAttribute('aria-current', 'true')
      b.addEventListener('click', () => {
        menu.hidePopover()
        onPick({ leg: o.leg, session: o.id })
      })
      return b
    })
    menu.replaceChildren(...items)
    const first = items[0]
    if (first !== undefined) first.autofocus = true
  })

  const paint = (): void => {
    const mine = current === null ? undefined : options.find((o) => o.leg === current?.leg && o.id === current.session)
    const text = mine === undefined ? '' : pairLabel(mine)
    const control = options.length < 2 ? plain : button
    if (control === button) {
      buttonText.textContent = text
      if (current !== null) button.dataset.binding = bindingKey(current.leg, current.session)
      plain.remove()
      menu.remove()
    } else {
      plain.textContent = text
      button.remove()
      menu.remove()
    }
    heading.replaceChildren(control, ...(detached ? [status] : []))
    if (control === button) heading.after(menu)
  }

  return {
    el,
    steps,
    actions,
    setBindings(next: readonly PaneOption[], now: Binding<Leg>): void {
      // THE RENDERED KEY, AS `paneSelect` KEPT ONE: a repeat call on the per-frame path is free, and an
      // open menu is not torn out from under a reader mid-choice.
      const key = `${next.map((o) => `${bindingKey(o.leg, o.id)}\x00${o.label}`).join('\x01')}\x02${bindingKey(now.leg, now.session)}`
      if (key === rendered) return
      rendered = key
      options = next
      current = now
      paint()
    },
    setDetached(next: boolean): void {
      if (next === detached) return
      detached = next
      paint()
    },
  }
}

/** The source view's header: its title, `source`, as plain text — there is one editor and nothing to pick. */
export function sourceViewHeader(): { readonly el: HTMLElement; readonly actions: HTMLElement } {
  const { el, heading, steps, actions } = frame()
  steps.remove()
  const title = document.createElement('span')
  title.className = 'view-title'
  title.textContent = 'source'
  heading.append(title)
  return { el, actions }
}
```

(The `paint` step removes and re-adds the heading's children only when the key or the detached flag changed, so the per-frame path touches nothing.)

- [ ] **Step 4: Build both views' headers through it**

In `web/src/lambda-pane.ts`:
- Replace the `#badge` and `#select` fields with `#header: ViewHeader`.
- In the constructor, replace the `title` `<h2>`, `detachedBadge(title)` and `paneSelect(title, on.rebind)` with `this.#header = viewHeader(on.rebind)`. Keep `this.#strip = controlStrip(on)` and everything appended into `this.#strip.el`; then `this.#header.steps.append(this.#strip.el)`.
- `host.replaceChildren(title, this.#collapse.el, this.#text, this.#strip.el)` → `host.replaceChildren(this.#header.el, this.#collapse.el, this.#text)`.
- `setBindings` → `this.#header.setBindings(options, current)`; in `setDetached`, `this.#badge.update(detached)` → `this.#header.setDetached(detached)`.
- Update the class and constructor docs that describe the `<h2>`, the badge and the selector.

In `web/src/tm-pane.ts`, the same: `#header = viewHeader(on.rebind)`, the strip into `#header.steps`, and `this.#body.append(..., this.#strip.el)` loses the strip; `host.replaceChildren(title, this.#body)` → `host.replaceChildren(this.#header.el, this.#body)`.

In `web/src/pane-chrome.ts`, delete `detachedBadge` and `paneSelect` and their docs, and the `PaneOption` import if unused. Search for citations of both names and update them:

```bash
grep -rn 'detachedBadge\|paneSelect\|pane-binding' src tests
```

Expected after the edits: only `tests/browser/binding-selector.test.ts` and the Step 7 files, which that step rewrites.

In `web/src/main.ts`:
- The program session's entry: `label: 'source'` → `label: 'program'`. Update the comment near it that quotes `scratch 2` as a label example, and any comment quoting `'source'` as the label (the session id stays `'source'`).
- The source host: replace `sourceTitle` (the `<h2>`) with `const sourceHeader = sourceViewHeader()`; `sourceControls` (the `layoutControls` parent) goes into `sourceHeader.actions`; `sourceHost.append(sourceTitle, editorHost, sourceControls)` → `sourceHost.append(sourceHeader.el, editorHost)`.

In `web/src/pane-host.ts`, `focusPane`'s doc says the first enabled control is the binding selector anchored to the `<h2>`; reword it to the title-selector, which is still first in the host.

- [ ] **Step 5: Style it**

In `web/src/style.css`, delete `.detached-badge`, `.pane-binding` and `.pane-binding select` (with their comments), and add, after `.pane h2`:

```css
/* A VIEW'S HEADER — Plan 7 part 2 spec §7: title, status, step controls, actions, on one line that wraps
   rather than overflowing a narrow view. The step controls take the middle and the actions the end. */
.view-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-2);
}
.view-header .view-title-heading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
}
.view-steps {
  flex: 1 1 auto;
}
.view-steps .controls {
  margin-top: 0;
}
.view-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-inline-start: auto;
}
/* THE TITLE IS A BUTTON THAT READS AS A HEADING. It keeps `.pane h2`'s voice — size, case, tracking — and
   gains the chrome border only on hover and focus, so a row of views reads as titled regions rather than as
   a row of controls, while the caret says it opens. */
.view-title {
  font: inherit;
  color: var(--fg);
  letter-spacing: inherit;
  text-transform: inherit;
}
button.view-title {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  padding: 0.05em 0.35em;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  cursor: pointer;
}
button.view-title:hover,
button.view-title[aria-expanded="true"] {
  border-color: var(--fg-dim);
}
.view-title-caret {
  rotate: 90deg;
}
/* `copy · not linked` — the `[detached]` badge's successor, and its rule: NOT COLOUR-ONLY. A border and the
   monospace face carry it; `tests/browser/detached-badge.test.ts` asserts the border computes to a non-zero
   width, so reducing this to `color:` alone fails a test. */
.view-status {
  padding: 0 0.35em;
  border: 1px solid currentColor;
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: var(--step--2);
  letter-spacing: normal;
  text-transform: none;
  color: var(--fg);
}
/* The title's menu, on the split picker's positioning — `.pane-picker`'s comment has the argument for
   every declaration here, including why `margin: 0` needs the `@supports` fallback beside it. */
.view-title-menu {
  position-area: block-end span-inline-end;
  position-try-fallbacks:
    flip-block,
    flip-inline,
    flip-block flip-inline;
  border: 1px solid var(--rule);
  background: var(--bg);
  padding: 0.25rem;
  margin: 0;
  min-width: 12rem;
}
@supports not (position-area: block-end) {
  .view-title-menu {
    margin: auto;
  }
}
.view-title-menu button {
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  font-family: var(--font-mono);
  padding: 0.15em 0.6em;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.view-title-menu button[aria-current="true"] {
  border-color: var(--fg-dim);
}
```

`.pane h2` keeps its size, case and tracking; drop only its `margin` declaration (the header's gap replaces it). Keep `.pane h2`'s selector so the source view's heading matches.

- [ ] **Step 6: Run the unit test**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/view-header.test.ts`
Expected: PASS.

- [ ] **Step 7: Move every test off the select, the `h2` text and the badge**

Each browser file restates its own helpers (the directory's convention); give every file that picked through the select this pair of helpers in place of its `selector`/`optionValue`/`select.value = …` code, adjusted to the leaf it drives:

```ts
/** The title-selector of `leaf`'s view — the pair in force is its `data-binding`. */
const titleOf = (leaf: string) => document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-title`)

/** Pick `key` (`bindingKey(leg, session)`) through `leaf`'s title menu, as a user does. */
function pickBinding(leaf: string, key: string): void {
  const title = titleOf(leaf)
  if (title === null) throw new Error(`no title-selector on [data-leaf="${leaf}"]`)
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const item = menu?.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`)
  if (item == null) {
    const offered = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b) => b.dataset.binding)
    throw new Error(`[data-leaf="${leaf}"] offers no ${JSON.stringify(key)} — offered: ${JSON.stringify(offered)}`)
  }
  item.click()
}

/** Every pair `leaf`'s title menu offers, as keys — opens and closes the menu to read it. */
function offered(leaf: string): string[] {
  const title = titleOf(leaf)
  if (title === null) return []
  title.click()
  const menu = document.getElementById(title.getAttribute('aria-controls') ?? '')
  const keys = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b) => b.dataset.binding ?? '')
  menu?.hidePopover()
  return keys
}
```

and import `bindingKey` from `'../../src/view-header'` in place of each file's local `optionValue` (whose body was the same join). The rewrites, by pattern:

| Old | New |
|---|---|
| `select.value = optionValue(leg, id); select.dispatchEvent(new Event('change'))` (or a literal `'leg\x00id'`) | `pickBinding(<leaf>, bindingKey(leg, id))` |
| reading `select.value` | `titleOf(<leaf>)?.dataset.binding` |
| listing `select.options` / `optgroup[label="λ"] option` | `offered(<leaf>)`, filtered with `.startsWith('lambda\x00')` for the λ group |
| waiting for an option to appear (`[...select.options].some(...)`) | `until(() => offered(<leaf>).includes(key), …)` |
| an option's text `/^λ scratch \d+$/` | the item's text `/^λ · copy \d+$/` — the label is `copy N` from Task 7; until then `/^λ · λ scratch \d+$/`, and Task 7 changes it again (write the Task 3 form now) |
| `h2` text `toBe('lambda')` / `toBe('turing machine')` | `toBe('λ · program')` / `toBe('TM · program')` |
| `h2` text `toContain('[detached]')` | `toContain('copy · not linked')` |
| `h2` text `not.toContain('detached')` or `not.toContain('[detached]')` | `not.toContain('not linked')`, plus `toContain(<the title it should show>)` beside it |
| `select?.closest('label')?.textContent` contains `shows` | delete the assertion; the caption no longer exists — assert instead that `titleOf(<leaf>)?.getAttribute('aria-haspopup')` is `menu` |
| a split-menu item `'λ · source (same)'` / `'TM · source (same)'` | `'λ · program (same)'` / `'TM · program (same)'` (Task 4 changes `(same)`) |

The files, from `grep -rln "pane-binding\|optionValue\|'h2'\|\[detached\]\|· source (same)" tests/browser`: `active-pane`, `binding-selector`, `buffer-cool-warm`, `buffer-restore`, `buffers-quota`, `detached-badge`, `layout-app`, `layout-restore`, `pane-kind-switch`, `pane-layout-controls`, `pane-picker`, `scratch-app`, `scratch-buffers`, `scratch-cap`, `scratch-edit`, `scratch-fork`, `scratch-rebind-editor`, `tm-blank-buffer`, `tm-buffer-restore`, `tm-pane-follows-session`, `tm-reduced-buffer`, `tm-scratch-fork`, `two-lambda-panes`. Also `tests/node/sessions.test.ts` and `tests/node/panes.test.ts` if they assert the program session's label (`grep -n "'source'" tests/node/*.test.ts` and read each hit — the id `'source'` stays; only a `label: 'source'` expectation changes).

`detached-badge.test.ts` becomes the status's test: rename it `tests/browser/view-status.test.ts` (`git mv`), its `title()` helper reads `pane.querySelector('h2')?.textContent`, its badge lookup finds `.view-status`, and its non-colour-carrier test asserts `.view-status`'s border width.

`binding-selector.test.ts` tests `paneSelect` through real panes: keep every behaviour it pins, now through `titleOf`/`pickBinding`/`offered`; rename it `tests/browser/view-title.test.ts` (`git mv`) and its `describe` to "the title-selector".

Then, from `web/`:

```bash
grep -rn "pane-binding\|'\[detached\]'\|shows'\|· source (same)" tests
```

Expected: nothing.

- [ ] **Step 8: Run the browser tier**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser`
Expected: PASS, every file.
Run: `pnpm run typecheck && pnpm exec vitest run --project node`
Expected: exit 0; PASS.

- [ ] **Step 9: Sabotage, once each**

1. In `viewHeader`'s `setBindings`, drop the rendered-key early return. Expect `view-header.test.ts`'s "does not rebuild on a repeat update" red. Revert.
2. In `paint`, leave the status out of the heading. Expect `view-header.test.ts`'s status test and `view-status.test.ts` red. Revert.
3. In the menu's item builder, drop `aria-current`. Expect the "opens a menu of every pair" test red. Revert.

- [ ] **Step 10: Commit**

```bash
pnpm exec biome ci --error-on-warnings src tests
git add -A web/src web/tests
git commit -m "A view's title is its selector — λ · program, TM · copy 2 — and a view showing a copy says copy · not linked in its heading"
```

---

### Task 4: The view's `⋯` menu and `✕`

Spec §7 (`⋯`: split right, split down, ✎ edit a copy, move the editor here; `✕`), §11 (focus stays inside the menu or returns to `⋯`), §12 (`close this view`, `another view of this`). Retires the `⇥`/`⤓` split popovers, `×`, `✎ fork` and the claim button as separate controls.

**Files:**
- Modify: `web/src/view-header.ts` (add `viewMenu`)
- Modify: `web/src/icons.ts` (`more`, `close`, `edit`)
- Modify: `web/src/pane-chrome.ts` (delete `splitControl`, `layoutControls`, `detachButton`, `claimEditorButton`, `button`, `pickerSeq`, `legLabel`; `PaneEvents` unchanged)
- Modify: `web/src/lambda-pane.ts`, `web/src/tm-pane.ts` (build `viewMenu`; availability logic feeds it)
- Modify: `web/src/main.ts` (the source view's `✕` through `viewMenu`)
- Modify: `web/src/pane-host.ts` (`sourceLayout`'s type; docs naming the retired controls)
- Modify: `web/src/style.css` (`.view-more`, `.view-close`, `.view-menu`; delete `.pane-picker` rules and `.layout-control` from the shared chrome selector)
- Test: `web/tests/browser/view-menu.test.ts` (new; replaces `pane-layout-controls.test.ts`, which is deleted, and carries over its placement tests)
- Modify tests: the files in Step 6

**Interfaces:**
- Consumes: `view-header.ts`'s `ViewHeader.actions`, `pairLabel`, `bindingKey` (Task 3); `pane-chrome.ts`'s `PaneChoice`, `SplitChoices`.
- Produces (`view-header.ts`): `type CopyState = null | 'ready' | { readonly reason: string }`, `type ViewMenu = { setLayout(canClose: boolean, canSplit: boolean): void; setCopy(state: CopyState): void; setClaim(available: boolean): void }`, `viewMenu(actions: HTMLElement, opts: ViewMenuOptions): ViewMenu`, where `ViewMenuOptions = { readonly split?: (dir: Dir, choice: PaneChoice) => void; readonly close?: () => void; readonly editCopy?: { readonly run: () => void; readonly what: string }; readonly claim?: () => void; readonly choices?: () => SplitChoices }`.
- DOM contract: `.view-actions > button.view-more[aria-haspopup=menu] + div.view-menu[popover] + button.view-close[aria-label="close this view"]`; inside `.view-menu`: `.view-menu-main > button.view-split[data-dir=row|column], button.detach, button.claim-editor` (each present only while it applies; **the items stay in the DOM while the menu is closed**, so a test or a script can find and click them), and `.view-menu-pairs > button[data-same] | button[data-binding] | button[data-source]` while a split is being chosen.

- [ ] **Step 1: Add the three icons**

In `web/src/icons.ts`, extend `IconName` and `PATHS`:

```ts
export type IconName = 'disclose' | 'move-editor-here' | 'more' | 'close' | 'edit'

const PATHS: Readonly<Record<IconName, string>> = {
  disclose: 'M6 3.5 L10.5 8 L6 12.5',
  'move-editor-here': 'M8 2.5 V10 M4.5 6.5 L8 10 L11.5 6.5 M3 13.5 H13',
  // Three dots: zero-length segments with round caps are dots of the stroke's width.
  more: 'M3.5 8 h0.01 M8 8 h0.01 M12.5 8 h0.01',
  close: 'M4 4 L12 12 M12 4 L4 12',
  edit: 'M10.5 2.5 L13.5 5.5 L6 13 H3 V10 Z',
}
```

Give each new entry a one-line comment naming the glyph it replaces (`⋯`, `✕`, `✎`) and why an icon rather than the character: Hack, Instrument's monospace face, lacks them (part 1's roadmap entry lists `✎`; `⋯` and `✕` get the same treatment so the three read as one set). Stroke width 2 for `more` so the dots read; set it per path if `icon()` needs a parameter — add an optional `strokeWidth` argument defaulting to `'1.5'`.

- [ ] **Step 2: Write the failing unit test**

Create `web/tests/browser/view-menu.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import type { Dir } from '../../src/layout'
import type { PaneChoice, SplitChoices } from '../../src/pane-chrome'
import { bindingKey, viewMenu } from '../../src/view-header'

const CHOICES: SplitChoices = {
  options: [
    { leg: 'lambda', id: 'source', label: 'program' },
    { leg: 'tm', id: 'source', label: 'program' },
    { leg: 'lambda', id: 'scratch-1', label: 'copy 1' },
  ],
  sourceAvailable: true,
  current: { leg: 'lambda', session: 'source' },
}

afterEach(() => {
  document.body.replaceChildren()
})

const build = (over: Partial<Parameters<typeof viewMenu>[1]> = {}) => {
  const actions = document.createElement('div')
  document.body.append(actions)
  const log: string[] = []
  const menu = viewMenu(actions, {
    split: (dir: Dir, c: PaneChoice) => log.push(`split ${dir} ${c.kind === 'source' ? 'source' : bindingKey(c.kind, c.session)}`),
    close: () => log.push('close'),
    editCopy: { run: () => log.push('edit'), what: 'the term at this step' },
    claim: () => log.push('claim'),
    choices: () => CHOICES,
    ...over,
  })
  return { actions, menu, log }
}

const more = (a: HTMLElement) => a.querySelector<HTMLButtonElement>('button.view-more')
const items = (a: HTMLElement) =>
  [...a.querySelectorAll<HTMLButtonElement>('.view-menu-main button')].map((b) => b.querySelector('.view-menu-label')?.textContent)

describe('the view menu', () => {
  it('offers only what applies, and no ⋯ at all when nothing does', () => {
    const { actions, menu } = build()
    menu.setLayout(false, false)
    expect(more(actions)).toBeNull()
    expect(actions.querySelector('button.view-close')).toBeNull()
    menu.setLayout(true, true)
    menu.setCopy('ready')
    expect(items(actions)).toEqual(['split right', 'split down', 'edit a copy'])
    expect(actions.querySelector('button.view-close')?.getAttribute('aria-label')).toBe('close this view')
    menu.setClaim(true)
    menu.setCopy(null)
    expect(items(actions)).toEqual(['split right', 'split down', 'move the editor here'])
  })

  it('names ⋯ and ✕ in words, and states ⋯ opens a menu', () => {
    const { actions, menu } = build()
    menu.setLayout(true, true)
    expect(more(actions)?.getAttribute('aria-label')).toBe('view actions')
    expect(more(actions)?.getAttribute('aria-haspopup')).toBe('menu')
    expect(more(actions)?.getAttribute('aria-expanded')).toBe('false')
  })

  it('asks which view to split into, the view itself first as "another view of this"', () => {
    const { actions, menu, log } = build()
    menu.setLayout(true, true)
    more(actions)?.click()
    actions.querySelector<HTMLButtonElement>('button.view-split[data-dir="row"]')?.click()
    const pairs = [...actions.querySelectorAll<HTMLButtonElement>('.view-menu-pairs button')]
    expect(pairs.map((b) => b.textContent)).toEqual(['another view of this', 'TM · program', 'λ · copy 1', 'source'])
    expect(document.activeElement).toBe(pairs[0])
    pairs[1]?.click()
    expect(log).toEqual([`split row ${bindingKey('tm', 'source')}`])
    expect(actions.querySelector('.view-menu-pairs')?.children.length).toBe(0)
  })

  it('disables edit a copy with its reason, rather than removing it, when the reason is a size', () => {
    const { actions, menu } = build()
    menu.setCopy({ reason: '60,000 rules — too large to open in an editor' })
    const edit = actions.querySelector<HTMLButtonElement>('button.detach')
    expect(edit?.disabled).toBe(true)
    expect(edit?.getAttribute('aria-description')).toBe('60,000 rules — too large to open in an editor')
    menu.setCopy('ready')
    expect(edit?.disabled).toBe(false)
    expect(edit?.querySelector('.view-menu-hint')?.textContent).toBe('the term at this step')
  })

  it('runs each item, closing the menu first', () => {
    const { actions, menu, log } = build()
    menu.setLayout(true, true)
    menu.setCopy('ready')
    menu.setClaim(true)
    more(actions)?.click()
    actions.querySelector<HTMLButtonElement>('button.detach')?.click()
    expect(actions.querySelector('.view-menu')?.matches(':popover-open')).toBe(false)
    actions.querySelector<HTMLButtonElement>('button.claim-editor')?.click()
    actions.querySelector<HTMLButtonElement>('button.view-close')?.click()
    expect(log).toEqual(['edit', 'claim', 'close'])
  })

  it('does not rebuild on a repeat state, so an open menu survives a frame', () => {
    const { actions, menu } = build()
    menu.setLayout(true, true)
    const before = actions.querySelector('button.view-split')
    menu.setLayout(true, true)
    expect(actions.querySelector('button.view-split')).toBe(before)
  })
})
```

Then port `tests/browser/pane-layout-controls.test.ts`'s placement block ("where the split picker opens": beside its own button, one place per control, above the button at the bottom edge) into this file as "where the view menu opens", against `button.view-more` and `.view-menu` — keep its stylesheet loading and `getBoundingClientRect` assertions, changing only the selectors. Delete `pane-layout-controls.test.ts` (`git rm`); every other behaviour it pinned is covered above or by the app-level tests in Step 6.

- [ ] **Step 3: Run it to see it fail**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/view-menu.test.ts`
Expected: FAIL — `viewMenu` is not exported.

- [ ] **Step 4: Write `viewMenu`**

Append to `web/src/view-header.ts` (and import `type Dir` from `'./layout'` and `type PaneChoice, type SplitChoices` from `'./pane-chrome'`):

```ts
/**
 * What `✎ edit a copy` can do right now: not offered (`null`), offered, or offered and disabled with its
 * reason — the one control that is disabled rather than removed, because the refusal is a size and not an
 * absence (`MAX_FORK_RULES`; umbrella §4 rule 4).
 */
export type CopyState = null | 'ready' | { readonly reason: string }

export type ViewMenu = {
  /** Whether `✕` applies (not on the last view) and whether the split items do (not on the source view). */
  setLayout(canClose: boolean, canSplit: boolean): void
  setCopy(state: CopyState): void
  /** Whether `move the editor here` applies: the view shows a copy whose editor is elsewhere. */
  setClaim(available: boolean): void
}

export type ViewMenuOptions = {
  readonly split?: (dir: Dir, choice: PaneChoice) => void
  readonly close?: () => void
  /** `what` is the second line: what is copied — "the term at this step", "the whole machine". */
  readonly editCopy?: { readonly run: () => void; readonly what: string }
  readonly claim?: () => void
  readonly choices?: () => SplitChoices
}

let viewMenuSeq = 0

/** One menu item: an optional icon, its label, and an optional second line. */
function item(className: string, label: string, hint?: string, glyph?: IconName): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = className
  if (glyph !== undefined) b.append(icon(glyph))
  const l = document.createElement('span')
  l.className = 'view-menu-label'
  l.textContent = label
  b.append(l)
  if (hint !== undefined) {
    const h = document.createElement('span')
    h.className = 'view-menu-hint'
    h.textContent = hint
    b.append(h)
  }
  return b
}

/**
 * A view's `⋯` menu and its `✕` — Plan 7 part 2 spec §7.
 *
 * **ONE GLYPH, ONE MEANING (umbrella §4 rule 2).** `⋯` only ever opens a view's menu and `✕` only ever closes a
 * view. The two split popovers (`⇥`, `⤓`), `✎ fork` and the claim button were four more controls in a view's
 * strip; they are menu items now, because none of them is a thing a user does every few seconds.
 *
 * **THE ITEMS STAY IN THE DOM WHILE THE MENU IS CLOSED, ADDED AND REMOVED AS THEY APPLY.** That is this file's
 * idiom for a control that cannot apply (removed, not disabled — rule 4), applied inside a popover: the popover
 * hides them, and nothing is built per frame. `⋯` itself is removed when the menu would be empty.
 *
 * **A SPLIT IS TWO CHOICES IN ONE MENU.** Choosing *split right* or *split down* replaces the main items with
 * the pairs a new view could show, the view's own pair first and reading *another view of this*, then the
 * others, then *source* while the tree has none. The pair list is built at that moment from `choices()`,
 * which is a thunk for the old split picker's reason: the list is read when it is needed and never per frame.
 * Closing the menu puts the main items back.
 *
 * **EVERY ITEM CLOSES THE MENU BEFORE IT RUNS**, so no item is left on screen describing a view the action
 * just changed, and focus returns to `⋯` — the popover's own behaviour on a light dismiss or a `hidePopover`
 * while focus is inside it.
 */
export function viewMenu(actions: HTMLElement, opts: ViewMenuOptions): ViewMenu {
  const n = viewMenuSeq++
  const menu = document.createElement('div')
  menu.className = 'view-menu'
  menu.id = `view-menu-${n}`
  menu.popover = 'auto'
  const main = document.createElement('div')
  main.className = 'view-menu-main'
  const pairs = document.createElement('div')
  pairs.className = 'view-menu-pairs'
  menu.append(main, pairs)

  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'view-more'
  more.append(icon('more'))
  more.title = 'view actions'
  more.setAttribute('aria-label', 'view actions')
  more.setAttribute('aria-haspopup', 'menu')
  more.setAttribute('aria-controls', menu.id)
  more.setAttribute('aria-expanded', 'false')
  more.popoverTargetElement = menu

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'view-close'
  close.append(icon('close'))
  close.title = 'close this view'
  close.setAttribute('aria-label', 'close this view')
  if (opts.close !== undefined) {
    const onClose = opts.close
    close.addEventListener('click', onClose)
  }

  const shut = (): void => {
    if (menu.matches(':popover-open')) menu.hidePopover()
  }

  const splitItems: HTMLButtonElement[] = []
  if (opts.split !== undefined && opts.choices !== undefined) {
    const split = opts.split
    const choices = opts.choices
    for (const [dir, label] of [
      ['row', 'split right'],
      ['column', 'split down'],
    ] as const) {
      const b = item('view-split', label)
      b.dataset.dir = dir
      b.addEventListener('click', () => {
        const { options, sourceAvailable, current } = choices()
        const built: HTMLButtonElement[] = []
        const add = (text: string, choice: PaneChoice, mark: (el: HTMLButtonElement) => void) => {
          const p = document.createElement('button')
          p.type = 'button'
          p.textContent = text
          mark(p)
          p.addEventListener('click', () => {
            shut()
            split(dir, choice)
          })
          built.push(p)
        }
        const mine = options.find((o) => o.leg === current?.leg && o.id === current?.session)
        if (mine !== undefined)
          add('another view of this', { kind: mine.leg, session: mine.id }, (p) => {
            p.dataset.same = ''
            p.dataset.binding = bindingKey(mine.leg, mine.id)
          })
        for (const o of options) {
          if (o === mine) continue
          add(pairLabel(o), { kind: o.leg, session: o.id }, (p) => {
            p.dataset.binding = bindingKey(o.leg, o.id)
          })
        }
        if (sourceAvailable)
          add('source', { kind: 'source' }, (p) => {
            p.dataset.source = ''
          })
        main.hidden = true
        pairs.replaceChildren(...built)
        built[0]?.focus()
      })
      splitItems.push(b)
    }
  }

  const edit = opts.editCopy === undefined ? null : item('detach', 'edit a copy', opts.editCopy.what, 'edit')
  if (edit !== null && opts.editCopy !== undefined) {
    const run = opts.editCopy.run
    edit.addEventListener('click', () => {
      shut()
      run()
    })
  }
  const claim = opts.claim === undefined ? null : item('claim-editor', 'move the editor here', undefined, 'move-editor-here')
  if (claim !== null && opts.claim !== undefined) {
    const run = opts.claim
    claim.addEventListener('click', () => {
      shut()
      run()
    })
  }

  menu.addEventListener('beforetoggle', (e) => {
    const open = e.newState === 'open'
    more.setAttribute('aria-expanded', String(open))
    if (open) {
      const first = main.querySelector<HTMLButtonElement>('button:not([disabled])')
      if (first !== null) first.autofocus = true
      return
    }
    pairs.replaceChildren()
    main.hidden = false
  })

  let canClose = false
  let canSplit = false
  let copy: CopyState = null
  let claimable = false
  const what = opts.editCopy?.what ?? ''

  const sync = (): void => {
    const wanted: HTMLButtonElement[] = []
    if (canSplit) wanted.push(...splitItems)
    if (edit !== null && copy !== null) {
      if (copy === 'ready') {
        edit.disabled = false
        edit.removeAttribute('aria-description')
        const hint = edit.querySelector('.view-menu-hint')
        if (hint !== null) hint.textContent = what
      } else {
        edit.disabled = true
        edit.setAttribute('aria-description', copy.reason)
        const hint = edit.querySelector('.view-menu-hint')
        if (hint !== null) hint.textContent = copy.reason
      }
      wanted.push(edit)
    }
    if (claim !== null && claimable) wanted.push(claim)
    const same = wanted.length === main.children.length && wanted.every((b, i) => main.children[i] === b)
    if (!same) main.replaceChildren(...wanted)
    const showMore = wanted.length > 0
    if (showMore && more.parentNode === null) actions.prepend(more, menu)
    if (!showMore && more.parentNode !== null) {
      shut()
      more.remove()
      menu.remove()
    }
    if (canClose && close.parentNode === null && opts.close !== undefined) actions.append(close)
    if (!canClose && close.parentNode !== null) close.remove()
  }

  return {
    setLayout(nextClose: boolean, nextSplit: boolean): void {
      if (nextClose === canClose && nextSplit === canSplit) return
      canClose = nextClose
      canSplit = nextSplit
      sync()
    },
    setCopy(next: CopyState): void {
      const key = (s: CopyState) => (s === null ? 'none' : s === 'ready' ? 'ready' : `reason:${s.reason}`)
      if (key(next) === key(copy)) return
      copy = next
      sync()
    },
    setClaim(next: boolean): void {
      if (next === claimable) return
      claimable = next
      sync()
    },
  }
}
```

(Import `type IconName` alongside `icon`.)

- [ ] **Step 5: Build the menu in both views and the source view**

In `web/src/lambda-pane.ts`:
- Replace `#layout`, `#detach`, `#claim` with `#menu: ViewMenu`. Keep `#strip` (the transport strip, in `#header.steps` since Task 3).
- In the constructor, after the header:

```ts
    const detach = on.detach
    this.#menu = viewMenu(this.#header.actions, {
      ...(on.splitRow !== undefined && on.splitColumn !== undefined
        ? { split: (dir: Dir, c: PaneChoice) => (dir === 'row' ? on.splitRow?.(c) : on.splitColumn?.(c)) }
        : {}),
      ...(on.close !== undefined ? { close: on.close } : {}),
      ...(detach !== undefined ? { editCopy: { run: () => detach(this.#frame?.step ?? 0), what: 'the term at this step' } } : {}),
      ...(on.showEditor !== undefined ? { claim: on.showEditor } : {}),
      choices: () => this.#choices,
    })
```

- `setLayoutControls(canClose, canSplit, choices)` → store `#choices`, then `this.#menu.setLayout(canClose, canSplit)`.
- `#refreshDetach` → `this.#menu.setCopy(!this.#detached && this.#link === null && this.#frame !== null ? 'ready' : null)`.
- `#refreshClaim` → `this.#menu.setClaim(this.#detached && this.#editor === null && this.#editorAvailable)`.

In `web/src/tm-pane.ts`, the same shape, with `editCopy: { run: detachMachine, what: 'the whole machine' }` and `#refreshDetach` becoming:

```ts
  #refreshDetach(): void {
    if (this.#detached || (this.#tmText === null && this.#rules === 0)) {
      this.#menu.setCopy(null)
      return
    }
    this.#menu.setCopy(
      this.#tmText === null ? { reason: `${n(this.#rules)} rules — too large to open in an editor` } : 'ready',
    )
  }
```

(TM views get no `claim`: `PaneEvents.showEditor` is λ-only, as its doc says.)

In `web/src/main.ts`, the source view: replace `layoutControls(sourceControls, { close })` with `const sourceMenu = viewMenu(sourceHeader.actions, { close: () => { ... the same three statements ... } })`, and pass `sourceLayout: { update: (canClose: boolean, canSplit: boolean) => sourceMenu.setLayout(canClose, canSplit) }` to `createPaneHost` — `pane-host.ts`'s dependency type is unchanged. Delete `sourceControls`.

In `web/src/pane-chrome.ts`, delete `button`, `detachButton`, `claimEditorButton`, `legLabel`, `pickerSeq`, `splitControl`, `layoutControls` and their docs. Update the docs of `PaneEvents.splitRow`/`splitColumn`/`close`/`detach`/`showEditor` that name `layoutControls`, `splitControl`, `detachButton` or `claimEditorButton` to name `view-header.ts`'s `viewMenu`. Then:

```bash
grep -rn 'layoutControls\|splitControl\|detachButton\|claimEditorButton\|controlStrip\b' src tests
```

Expected: `controlStrip` only (Task 5 retires it) and nothing else in `src`; the test hits are Step 6's.

- [ ] **Step 6: Move the tests onto the menu**

Every file that split through the old popovers gets this helper in place of its `pickSplit`/`splitSame`/`splitRow`/`btn(leaf, 'split …')` code:

```ts
/**
 * Split `leaf` through its `⋯` menu, as a user does: `pick` is `'same'` (another view of this), `'source'`,
 * or a `bindingKey(leg, session)`.
 */
function splitVia(leaf: string, dir: 'row' | 'column', pick: string): void {
  const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
  if (more === null) throw new Error(`no view menu on [data-leaf="${leaf}"]`)
  more.click()
  const menu = document.getElementById(more.getAttribute('aria-controls') ?? '')
  menu?.querySelector<HTMLButtonElement>(`button.view-split[data-dir="${dir}"]`)?.click()
  const selector = pick === 'same' ? 'button[data-same]' : pick === 'source' ? 'button[data-source]' : `button[data-binding="${pick}"]`
  const item = menu?.querySelector<HTMLButtonElement>(`.view-menu-pairs ${selector}`)
  if (item == null) {
    const offered = [...(menu?.querySelectorAll<HTMLButtonElement>('.view-menu-pairs button') ?? [])].map((b) => b.textContent)
    throw new Error(`[data-leaf="${leaf}"] offers no ${pick} to split into — offered: ${offered.join(' | ')}`)
  }
  item.click()
}
```

The rewrites, by pattern:

| Old | New |
|---|---|
| `button[aria-label="split left and right"]` then a menu item | `splitVia(leaf, 'row', …)` |
| `button[aria-label="split top and bottom"]` then a menu item | `splitVia(leaf, 'column', …)` |
| an item text ending `(same)` | `'same'` |
| an item text `'TM · TM scratch 1 (same)'` on a TM copy's view | `'same'` |
| an item text `'source'` | `'source'` |
| an item text `'TM · program'` etc. | `bindingKey('tm', 'source')` etc. |
| `button[aria-label="close this pane"]`, `'close this pane'` | `button[aria-label="close this view"]`, `'close this view'` |
| `clickLambda('✎ fork')` | `document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()` |
| `[aria-label="bring the term editor to this pane"]`, `btn(leaf, 'bring the term editor to this pane')` | `button.claim-editor` |
| asserting a split control's presence or absence | asserting `button.view-split` inside `[data-leaf="…"] .view-menu` |
| `.pane-picker` | `.view-menu` |

Run, from `web/`, to find every site:

```bash
grep -rln "split left and right\|split top and bottom\|(same)\|close this pane\|✎ fork\|bring the term editor to this pane\|pane-picker\|layout-control" tests
```

The inventory at `13db3b7` found these files: `active-pane`, `editor-custody`, `layout-app`, `layout-restore`, `pane-chrome-text-panel`, `pane-kind-switch`, `pane-picker`, `scratch-app`, `scratch-buffers`, `scratch-cap`, `scratch-edit`, `scratch-fork`, `scratch-rebind-editor`, `tm-pane-follows-session`, `tm-reduced-buffer`, `two-lambda-panes`. `pane-picker.test.ts` keeps its name and behaviours (the split menu offers source only while the tree has none; a picked session is where the new view starts; focus lands in what the split created) through `splitVia`. `pane-chrome-text-panel.test.ts`'s "carries the move-editor-here icon" test moves to `view-menu.test.ts` as "move the editor here carries its own icon", asserting `button.claim-editor svg` exists and `button.claim-editor .view-menu-label` reads `move the editor here`.

After the rewrites the grep above must print nothing. `tm-reduced-buffer.test.ts`'s own `pickSplit(…, 'TM · TM scratch 1 (same)')` becomes `splitVia('tm-0', 'row', 'same')`.

- [ ] **Step 7: Style it**

In `web/src/style.css`: delete the `.pane-picker` rule, its `@supports` block, `.pane-picker button`, and their comment (the positioning argument moves to `.view-menu`, below — carry it over, rewording `splitControl` to `viewMenu` and `split →`/`split ↓` to `⋯` on neighbouring views). Replace `.layout-control` in the shared chrome selector with `.view-more, .view-close`, and add:

```css
.view-more,
.view-close {
  display: inline-flex;
  align-items: center;
  padding: 0.2em 0.35em;
}
.view-menu {
  position-area: block-end span-inline-start;
  position-try-fallbacks:
    flip-block,
    flip-inline,
    flip-block flip-inline;
  border: 1px solid var(--rule);
  background: var(--bg);
  padding: 0.25rem;
  margin: 0;
  min-width: 14rem;
}
@supports not (position-area: block-end) {
  .view-menu {
    margin: auto;
  }
}
.view-menu button {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 0.5em;
  align-items: center;
  width: 100%;
  text-align: left;
  font: inherit;
  padding: 0.25em 0.6em;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.view-menu button:disabled {
  opacity: 0.55;
  cursor: default;
}
.view-menu .view-menu-label {
  grid-column: 2;
}
.view-menu .view-menu-hint {
  grid-column: 2;
  font-size: var(--step--2);
  color: var(--fg-dim);
}
```

(`span-inline-start`: the menu opens leftward from `⋯`, which sits at a view's right edge.)

- [ ] **Step 8: Run the browser tier and typecheck**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser`
Expected: PASS.
Run: `pnpm run typecheck`
Expected: exit 0.

- [ ] **Step 9: Sabotage, once each**

1. In `sync`, keep `⋯` mounted when `wanted` is empty. Expect "offers only what applies" red. Revert.
2. In the split item's handler, put the view's own pair last. Expect "asks which view to split into" red, and `pane-picker.test.ts`'s duplicate-first test red. Revert.
3. In `tm-pane.ts`'s `#refreshDetach`, send `null` instead of the reason. Expect `tm-scratch-fork.test.ts`'s over-the-cap test red. Revert.

- [ ] **Step 10: Commit**

```bash
pnpm exec biome ci --error-on-warnings src tests
git add -A web/src web/tests
git commit -m "A view's actions are one ⋯ menu — split right, split down, edit a copy, move the editor here — and ✕ closes it"
```

---

### Task 5: One step-control component, with pause and a speed

Spec §8. Replaces `controlStrip`. Keeps the `.controls`, `.step` and `.extend` classes and the `↺ ◀ ▶` text (Hack draws them), so tests that press those by text keep working.

**Files:**
- Create: `web/src/step-controls.ts`
- Modify: `web/src/icons.ts` (`play`, `pause`)
- Modify: `web/src/pane-chrome.ts` (delete `controlStrip`; `PaneEvents` gains `speed` and `setSpeed`)
- Modify: `web/src/lambda-pane.ts`, `web/src/tm-pane.ts` (`#strip` → `#steps`, mounted in `#header.steps`)
- Modify: `web/src/transport.ts` (`events` supplies `speed`/`setSpeed`; deps gain `setSpeed`)
- Modify: `web/src/main.ts` (`setSpeed` writes the workspace and draws)
- Modify: `web/src/style.css` (`.controls .play`, `.controls .speed`)
- Test: `web/tests/browser/step-controls.test.ts` (new)
- Modify tests: `running-focus.test.ts` (`click('⏵')`), and every test that builds a `PaneEvents` by hand (`grep -rln "back: () =>" tests`)

**Interfaces:**
- Consumes: `ControlState.playing` (Task 2); `workspace.ts`'s `SPEEDS`, `Speed`, `isSpeed` (Task 1).
- Produces (`step-controls.ts`): `stepControls(on: Pick<PaneEvents, 'back' | 'forward' | 'play' | 'restart' | 'extend' | 'speed' | 'setSpeed'>): { readonly el: HTMLElement; update(c: ControlState): void }`.
- Produces (`pane-chrome.ts`): `PaneEvents.speed(): Speed` and `PaneEvents.setSpeed(s: Speed): void` (required).
- Produces (`transport.ts` deps): `setSpeed: (s: Speed) => void`; `speed` narrows to `() => Speed`.

- [ ] **Step 1: Write the failing test**

Create `web/tests/browser/step-controls.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import type { ControlState } from '../../src/controls'
import { stepControls } from '../../src/step-controls'
import type { Speed } from '../../src/workspace'

const STATE: ControlState = {
  canBack: true,
  canForward: true,
  canPlay: true,
  canRestart: true,
  playing: false,
  continueLabel: null,
  stepText: 'step 3 of 12',
}

afterEach(() => {
  document.body.replaceChildren()
})

const build = () => {
  const log: string[] = []
  let speed: Speed = 8
  const s = stepControls({
    back: () => log.push('back'),
    forward: () => log.push('forward'),
    play: () => log.push('play'),
    restart: () => log.push('restart'),
    extend: () => log.push('extend'),
    speed: () => speed,
    setSpeed: (v) => {
      speed = v
      log.push(`speed ${v}`)
    },
  })
  document.body.append(s.el)
  return { s, log }
}

const byName = (el: HTMLElement, name: string) => el.querySelector<HTMLElement>(`[aria-label="${name}"]`)

describe('the step controls', () => {
  it('names every button in words, and shows the step', () => {
    const { s } = build()
    s.update(STATE)
    for (const name of ['back to the oldest kept step', 'one step back', 'one step forward', 'play', 'playback speed'])
      expect(byName(s.el, name)).not.toBeNull()
    expect(s.el.querySelector('.step')?.textContent).toBe('step 3 of 12')
  })

  it('shows ⏸ and is named pause while playing, and ⏵ and play when not', () => {
    const { s } = build()
    s.update({ ...STATE, playing: true })
    const play = s.el.querySelector<HTMLButtonElement>('button.play')
    expect(play?.getAttribute('aria-label')).toBe('pause')
    expect(play?.title).toBe('pause')
    expect(play?.querySelector('svg')?.dataset.icon).toBe('pause')
    s.update({ ...STATE, playing: false })
    expect(play?.getAttribute('aria-label')).toBe('play')
    expect(play?.querySelector('svg')?.dataset.icon).toBe('play')
  })

  it('offers the speed ladder, shows the one in force, and reports a change', () => {
    const { s, log } = build()
    s.update(STATE)
    const select = s.el.querySelector<HTMLSelectElement>('select.speed')
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual([
      '1/s',
      '2/s',
      '4/s',
      '8/s',
      '15/s',
      '30/s',
      '60/s',
      '250/s',
      '1,000/s',
      '5,000/s',
    ])
    expect(select?.value).toBe('8')
    if (select === null) throw new Error('no speed select')
    select.value = '5000'
    select.dispatchEvent(new Event('change'))
    expect(log).toEqual(['speed 5000'])
  })

  it('shows the continue button only while there is more to record, never disabled', () => {
    const { s } = build()
    s.update(STATE)
    expect(s.el.querySelector<HTMLButtonElement>('button.extend')?.hidden).toBe(true)
    s.update({ ...STATE, continueLabel: 'keep recording' })
    expect(s.el.querySelector<HTMLButtonElement>('button.extend')?.hidden).toBe(false)
    expect(s.el.querySelector('button.extend')?.textContent).toBe('keep recording')
  })
})
```

`icon()` must stamp `data-icon` with the icon's name for the third test; add `svg.dataset.icon = name` to `icons.ts`'s `icon`.

- [ ] **Step 2: Run it to see it fail**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/step-controls.test.ts`
Expected: FAIL — `step-controls.ts` does not exist.

- [ ] **Step 3: Icons, `PaneEvents`, and the component**

In `web/src/icons.ts`, add `'play' | 'pause'` to `IconName`, their paths (`play: 'M5 3.5 L12.5 8 L5 12.5 Z'`, `pause: 'M5.5 3.5 V12.5 M10.5 3.5 V12.5'`), a comment that Hack lacks `⏵` (part 1's roadmap entry) and `⏸` joins it so the toggle's two faces match, and `svg.dataset.icon = name` in `icon()`.

In `web/src/pane-chrome.ts`, add to `PaneEvents` after `extend`:

```ts
  /**
   * The workspace's one playback speed, in steps a second — Plan 7 part 2 spec §8. REQUIRED, like `rebind`:
   * every view that steps shows it, and one global setting has no view that could lack it.
   */
  speed(): Speed
  /** Set the one speed; every step control on the page shows the change on the next draw. */
  setSpeed(s: Speed): void
```

Delete `controlStrip` and its doc from `pane-chrome.ts`.

Create `web/src/step-controls.ts`:

```ts
import type { ControlState } from './controls'
import { n } from './format'
import { icon } from './icons'
import type { PaneEvents } from './pane-chrome'
import { isSpeed, SPEEDS } from './workspace'

/**
 * THE STEP CONTROLS — Plan 7 part 2 spec §8: `↺ ◀ ▶ ⏵ 8/s ▾ step 212 of 1,319 [continue]`. One component;
 * `controls.ts` decides what is live and this only reflects it, as `controlStrip` did.
 *
 * **EVERY BUTTON IS NAMED IN WORDS (umbrella §4 rule 1).** `↺ ◀ ▶` stay as text — Hack draws them, and a
 * glyph a user has seen on every transport is its own best label — with their tooltips as their accessible
 * names; `controlStrip` left the glyph as the name, so a screen reader said "black right-pointing
 * triangle".
 *
 * **PLAY SHOWS ITS STATE (rule 3).** While a leg plays, the button is `⏸` and named *pause*; a second click
 * pauses. The old button never changed, and playback looked like nothing had happened.
 *
 * **ONE SPEED FOR THE WHOLE WORKSPACE**, shown here and set here, in steps a second. The select's options are
 * `workspace.ts`'s `SPEEDS`; `on.setSpeed` writes the workspace, and the next draw shows every step control
 * the new value.
 *
 * **THE CONTINUE BUTTON IS ADDED AND REMOVED, NEVER DISABLED** — `controlStrip`'s rule, kept: a
 * `depth-refused` leg has no honest continue, and a greyed-out button still says the operation exists.
 */
export function stepControls(
  on: Pick<PaneEvents, 'back' | 'forward' | 'play' | 'restart' | 'extend' | 'speed' | 'setSpeed'>,
): { readonly el: HTMLElement; update(c: ControlState): void } {
  const el = document.createElement('div')
  el.className = 'controls'

  const named = (text: string, name: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    b.title = name
    b.setAttribute('aria-label', name)
    b.addEventListener('click', run)
    return b
  }
  // `restart` IS `hist.seek(0)`, WHICH CLAMPS TO THE OLDEST RETAINED FRAME — the name says what it does
  // rather than promising a step 0 an evicted history no longer holds (`controlStrip`'s own comment).
  const restart = named('↺', 'back to the oldest kept step', on.restart)
  const back = named('◀', 'one step back', on.back)
  const forward = named('▶', 'one step forward', on.forward)

  const play = document.createElement('button')
  play.type = 'button'
  play.className = 'play'
  play.addEventListener('click', on.play)
  let shownPlaying: boolean | null = null
  const paintPlay = (playing: boolean): void => {
    if (playing === shownPlaying) return
    shownPlaying = playing
    const name = playing ? 'pause' : 'play'
    play.replaceChildren(icon(playing ? 'pause' : 'play'))
    play.title = name
    play.setAttribute('aria-label', name)
  }

  const speed = document.createElement('select')
  speed.className = 'speed'
  speed.title = 'playback speed'
  speed.setAttribute('aria-label', 'playback speed')
  for (const s of SPEEDS) speed.append(new Option(`${n(s)}/s`, String(s)))
  // `change`, NOT `input` — the binding selector's old reason: a keyboard user arrowing the list would
  // otherwise set every speed they pass on the way.
  speed.addEventListener('change', () => {
    const v = Number(speed.value)
    if (isSpeed(v)) on.setSpeed(v)
  })

  const step = document.createElement('span')
  step.className = 'step'
  const extend = named('', 'record further', on.extend)
  extend.className = 'extend'
  extend.removeAttribute('aria-label')

  el.append(restart, back, forward, play, speed, step, extend)

  return {
    el,
    update(c: ControlState): void {
      restart.disabled = !c.canRestart
      back.disabled = !c.canBack
      forward.disabled = !c.canForward
      play.disabled = !c.canPlay
      paintPlay(c.playing)
      const want = String(on.speed())
      if (speed.value !== want) speed.value = want
      step.textContent = c.stepText
      if (c.continueLabel === null) {
        extend.hidden = true
      } else {
        extend.hidden = false
        extend.textContent = c.continueLabel
      }
    },
  }
}
```

(The continue button's accessible name is its visible label, which is words — `aria-label` is removed so the two cannot disagree.)

- [ ] **Step 4: Mount it, and plumb the speed**

In `lambda-pane.ts` and `tm-pane.ts`: `#strip = controlStrip(on)` → `#steps = stepControls(on)`; `this.#header.steps.append(this.#steps.el)`; `this.#strip.update(controls)` → `this.#steps.update(controls)`.

In `transport.ts`: deps gain `setSpeed: (s: Speed) => void` and `speed` becomes `() => Speed`; `events` returns `speed: deps.speed, setSpeed: deps.setSpeed` among its members.

In `main.ts`, pass to `createTransport`:

```ts
    speed: () => ws.speed,
    setSpeed: (s: Speed) => {
      ws = { ...ws, speed: s }
      persistWorkspace()
      draw()
    },
```

In the four `createTransport` calls in `tests/node/sessions.test.ts`, add `setSpeed: () => undefined,`. In every test that builds a `PaneEvents` literal by hand (`grep -rln "back: () =>" tests`), add `speed: () => 8, setSpeed: () => undefined,`.

- [ ] **Step 5: Move `running-focus.test.ts` off the play glyph**

Its `click('⏵')` finds a button by its text, which is now an icon. Give the file a `clickByName = (name: string) => document.querySelector<HTMLButtonElement>(`[data-leaf="lambda-0"] .controls [aria-label="${name}"]`)?.click()` and call `clickByName('play')` there; add, right after it, `expect(document.querySelector('[data-leaf="lambda-0"] button.play')?.getAttribute('aria-label')).toBe('pause')` while it plays, before whatever the test already waits for. Search for any other test pressing play by glyph:

```bash
grep -rn "'⏵'\|\"⏵\"" tests
```

Expected: nothing after the edit.

- [ ] **Step 6: Style it**

In `web/src/style.css`, after `.controls .step`:

```css
.controls .play {
  display: inline-flex;
  align-items: center;
}
.controls .speed {
  font: inherit;
  font-family: var(--font-mono);
  font-size: var(--step--2);
  padding: 0.1em 0.3em;
  border-radius: var(--radius);
  border: 1px solid var(--fg-dim);
  background: transparent;
  color: var(--fg);
}
```

- [ ] **Step 7: Run the browser tier and typecheck**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser`
Expected: PASS.
Run: `pnpm run typecheck && pnpm exec vitest run --project node`
Expected: exit 0; PASS.

- [ ] **Step 8: Sabotage, once each**

1. In `paintPlay`, always name the button `play`. Expect the "⏸ while playing" test and `running-focus.test.ts`'s new assertion red. Revert.
2. In `update`, skip setting `speed.value`. Expect "shows the one in force" red. Revert.

- [ ] **Step 9: Commit**

```bash
pnpm exec biome ci --error-on-warnings src tests
git add -A web/src web/tests
git commit -m "Each view's step controls sit in its header: play shows ⏸ and pause while it plays, every button is named in words, and one speed from 1/s to 5,000/s drives them all"
```

---

### Task 6: One notice line and one live region; every refusal goes through them

Spec §11. `#link-status` stops carrying refusals: `link-wiring.ts`'s `forkFailed` and `link-status.ts`'s `forkFailed` field are deleted, and every writer notifies instead. The wording of the refusals is Task 7's; this task moves them.

**Files:**
- Create: `web/src/notice.ts`
- Modify: `web/index.html`, `web/tests/browser/harness.ts` (`#notice` after the header; `#live`), `web/tests/node/harness.test.ts`
- Modify: `web/src/link-wiring.ts`, `web/src/link-status.ts` (drop `forkFailed`)
- Modify: `web/src/transport.ts`, `web/src/replies.ts` (deps gain `notify`; `setForkFailed(msg)` → `notify(msg)`; `setForkFailed(null)` deleted)
- Modify: `web/src/compile.ts` (drop its `setForkFailed(null)`)
- Modify: `web/src/main.ts` (build `notices`; the storage failure persists; the four handlers notify)
- Modify: `web/src/style.css` (`.notice`, `.visually-hidden`)
- Test: `web/tests/browser/notice.test.ts` (new)
- Modify tests: `tests/node/link-status.test.ts`, `tests/node/replies.test.ts`, `tests/node/sessions.test.ts`, `tests/browser/scratch-fork.test.ts`, `scratch-cap.test.ts`, `tm-blank-buffer-cap.test.ts`, `buffers-quota.test.ts`, `buffers-quota-restored.test.ts`

**Interfaces:**
- Produces (`notice.ts`): `const NOTICE_MS = 8000`, `type NoticeAction = { readonly label: string; readonly run: () => void }`, `type Notices = { notify(text: string, opts?: { readonly action?: NoticeAction; readonly persist?: boolean }): void; announce(text: string): void; dismiss(): void }`, `createNotices(line: HTMLElement, live: HTMLElement): Notices`.
- Produces (`transport.ts`, `replies.ts` deps): `notify: (text: string) => void`.
- DOM contract: `#notice.notice` (hidden while empty) holding `.notice-text` and, with an action, `button.notice-action`; `#live.visually-hidden[role=status]`.

- [ ] **Step 1: Write the failing test**

Create `web/tests/browser/notice.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNotices, NOTICE_MS } from '../../src/notice'

let line: HTMLElement
let live: HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  line = document.createElement('div')
  live = document.createElement('div')
  document.body.append(line, live)
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('notices', () => {
  it('shows one notice, says it in the live region, and clears it after NOTICE_MS', () => {
    const n = createNotices(line, live)
    n.notify('λ copy 1 paused · 1 view now shows the program')
    expect(line.hidden).toBe(false)
    expect(line.querySelector('.notice-text')?.textContent).toBe('λ copy 1 paused · 1 view now shows the program')
    expect(live.getAttribute('role')).toBe('status')
    expect(live.textContent).toContain('λ copy 1 paused')
    vi.advanceTimersByTime(NOTICE_MS)
    expect(line.hidden).toBe(true)
  })

  it('replaces the notice before it, action and all', () => {
    const n = createNotices(line, live)
    const run = vi.fn()
    n.notify('λ copy 1 deleted', { action: { label: 'undo', run } })
    n.notify('TM copy 2 created')
    expect(line.querySelector('.notice-text')?.textContent).toBe('TM copy 2 created')
    expect(line.querySelector('button.notice-action')).toBeNull()
    vi.advanceTimersByTime(NOTICE_MS - 1)
    expect(line.hidden).toBe(false)
  })

  it('runs its action once and clears', () => {
    const n = createNotices(line, live)
    const run = vi.fn()
    n.notify('λ copy 1 deleted', { action: { label: 'undo', run } })
    const undo = line.querySelector<HTMLButtonElement>('button.notice-action')
    expect(undo?.textContent).toBe('undo')
    undo?.click()
    expect(run).toHaveBeenCalledTimes(1)
    expect(line.hidden).toBe(true)
  })

  it('keeps a persistent notice until another replaces it', () => {
    const n = createNotices(line, live)
    n.notify('copies are not being saved', { persist: true })
    vi.advanceTimersByTime(NOTICE_MS * 10)
    expect(line.hidden).toBe(false)
    n.notify('TM copy 2 created')
    expect(line.querySelector('.notice-text')?.textContent).toBe('TM copy 2 created')
  })

  it('announces without showing, and re-announces a repeat', () => {
    const n = createNotices(line, live)
    n.announce('the machine is here right now')
    expect(line.hidden).toBe(true)
    const first = live.textContent
    n.announce('the machine is here right now')
    expect(live.textContent).not.toBe(first)
    expect(live.textContent?.trim()).toBe('the machine is here right now')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/notice.test.ts`
Expected: FAIL — `notice.ts` does not exist.

- [ ] **Step 3: Write `notice.ts`**

```ts
/**
 * THE NOTICE LINE AND THE LIVE REGION — Plan 7 part 2 spec §11.
 *
 * **ONE VISIBLE NOTICE AT A TIME, AND ONE POLITE LIVE REGION FOR THE WHOLE APP.** Every refusal, every copy
 * change and every layout change is said here, once, in words: shown on a line under the header, and written
 * to a visually hidden `role="status"` element so a screen reader hears it. Before this, refusals were a
 * clause on `#link-status`, which announced nothing (the accessibility list's items 6, 9, 10, 13 and 14 are
 * that silence, one control at a time).
 *
 * **A NEW NOTICE REPLACES THE OLD ONE, ACTION AND ALL.** A notice lasts `NOTICE_MS`, or until the next one;
 * an undo offered by a notice that has been replaced is gone with it (spec §10). One notice has no timeout —
 * *copies are not being saved* describes a condition that lasts — and it too goes when another replaces it.
 *
 * **`announce` IS THE LIVE REGION ALONE**, for a sentence already on screen elsewhere: the readout's link
 * sentence, said when a link gesture changes it.
 */

/** How long a notice stays, in milliseconds (spec §10's "8 s"). */
export const NOTICE_MS = 8000

export type NoticeAction = { readonly label: string; readonly run: () => void }

export type Notices = {
  notify(text: string, opts?: { readonly action?: NoticeAction; readonly persist?: boolean }): void
  announce(text: string): void
  dismiss(): void
}

export function createNotices(line: HTMLElement, live: HTMLElement): Notices {
  line.hidden = true
  live.setAttribute('role', 'status')
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastSaid = ''

  // A LIVE REGION ANNOUNCES A CHANGE, SO A REPEAT OF THE SAME WORDS WOULD BE SILENT. A trailing no-break
  // space toggled on a repeat makes it a change without changing what is read.
  const say = (text: string): void => {
    const next = text === lastSaid.trimEnd() && !lastSaid.endsWith(' ') ? `${text} ` : text
    lastSaid = next
    live.textContent = next
  }

  const dismiss = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    line.replaceChildren()
    line.hidden = true
  }

  return {
    notify(text, opts = {}) {
      dismiss()
      const t = document.createElement('span')
      t.className = 'notice-text'
      t.textContent = text
      line.append(t)
      const action = opts.action
      if (action !== undefined) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'notice-action'
        b.textContent = action.label
        b.addEventListener('click', () => {
          dismiss()
          action.run()
        })
        line.append(b)
      }
      line.hidden = false
      say(text)
      if (opts.persist !== true) timer = setTimeout(dismiss, NOTICE_MS)
    },
    announce: say,
    dismiss,
  }
}
```

- [ ] **Step 4: The markup**

In `web/index.html`, directly after `</header>`:

```html
    <div id="notice" class="notice" hidden></div>
    <div id="live" class="visually-hidden" role="status"></div>
```

Make the same change to `SHELL` in `web/tests/browser/harness.ts`, and add `'#notice'` and `'#live'` to the list in `tests/node/harness.test.ts` (rename its test to "carries the elements the app mounts into" — the count is gone rather than updated).

In `web/src/style.css`:

```css
/* THE NOTICE LINE (spec §11): one line under the header, the latest notice and at most one action. */
.notice {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-3);
  border-bottom: 1px solid var(--rule);
  background: var(--bg-raised);
  font-size: var(--step--1);
}
.notice[hidden] {
  display: none;
}
.notice-action {
  font: inherit;
  padding: 0 0.5em;
  border: 1px solid var(--fg-dim);
  border-radius: var(--radius);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
/* Present to a screen reader, absent from the page — the standard clip pattern. */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 5: Reroute every refusal**

1. `link-status.ts`: delete `LinkStatus.forkFailed` and the line that pushes it; rewrite the doc paragraph that describes the status line as the surface for refusals — it carries the link sentence only now, and refusals are notices (`notice.ts`).
2. `link-wiring.ts`: delete `setForkFailed`, the `forkFailed` getter, the `let forkFailed`, and `failed` in `drawLink`; update the type's doc.
3. `transport.ts`: deps gain `/** Say a refusal — `notice.ts`'s `notify`. */ notify: (text: string) => void`. In `detach` and `detachMachine`, `wiring.setForkFailed(e.message)` / `linkWiring().setForkFailed(e.message)` → `notify(e.message)`; delete both `setForkFailed(null)` lines (a newer notice replaces an older one; Task 7 adds the success notice).
4. `replies.ts`: deps gain `notify`; the `no-session` arm's `linkWiring.setForkFailed(\`fork failed — …\`)` → `notify(\`fork failed — …\`)` (Task 7 rewords it).
5. `compile.ts`: delete `linkWiring.setForkFailed(null)` and the doc paragraph arguing for it; a notice times out on its own.
6. `main.ts`: after the mount-point queries, add `#notice` and `#live` to the list (`const noticeHost = …`, `const liveHost = …`, and to the missing-mount guard), then `const notices = createNotices(noticeHost, liveHost)` — before `init()`, since it touches nothing but the DOM. Pass `notify: (text: string) => notices.notify(text)` to `createTransport` and `createReplies`. In `reportStorageFailure`, `linkWiring.setForkFailed('buffers are not being saved — …')` + `draw()` → `notices.notify('buffers are not being saved — this browser’s storage for this site is full', { persist: true })` (no `draw()` needed — rewrite the long doc's "`#link-status` RATHER THAN A BANNER" paragraph to "A PERSISTENT NOTICE RATHER THAN A BANNER", and delete finding 10b's two numbered wipe paths, which described the old surface: a keystroke no longer clears it, and the start-up warming loop's refusal is a notice that replaces it, which the paragraph should say instead). In the retire, temperature and new-TM handlers and the warming loop: `linkWiring.setForkFailed(e.message)` → `notices.notify(e.message)`; delete every `linkWiring.setForkFailed(null)`, and the doc paragraphs that argue for clearing (the retire handler's "A RETIRE ANSWERS THE CAP REFUSAL" block becomes one sentence: Task 7's delete notice replaces any refusal on screen).

Then:

```bash
grep -rn 'setForkFailed\|forkFailed' src tests
```

Expected: nothing in `src`. The test hits are Step 6's.

- [ ] **Step 6: Move the tests to the notice**

| Old | New |
|---|---|
| node fakes `setForkFailed: (r) => { forkFailed = r }` on a `LinkWiring` | a `notify: (t) => { notified.push(t) }` dependency on `createTransport`/`createReplies`; `let notified: string[] = []` |
| `expect(forkFailed).toBeNull()` | `expect(notified).toEqual([])` |
| `expect(forkFailed).toContain(x)` | `expect(notified.join(' ')).toContain(x)` |
| `linkStatus({ …, forkFailed: m })` (`scratch-fork.test.ts`) | delete: the status line no longer carries it; assert the reply's `notify` received `m` |
| `links.forkFailed` (`scratch-fork.test.ts`) | the `notify` the test passes to `createReplies` |
| browser: `#link-status` text containing a refusal (`fork failed`, `scratch buffers are live`, `not being saved`) | `document.querySelector('#notice .notice-text')?.textContent` containing it |
| browser: `#link-status` not containing a refusal | `#notice` hidden, or its text not containing it — **and** a positive check of what should be there instead |

In `tests/node/link-status.test.ts`, delete the cases that pass `forkFailed` (they test a field that no longer exists) and keep every other case.

`buffers-quota.test.ts`'s "reports once, and the report survives further writes": the report is a persistent notice now; assert `#notice .notice-text` holds it after the further writes — that is the test's point, kept.

- [ ] **Step 7: Run and typecheck**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser`
Expected: PASS.
Run: `pnpm run typecheck && pnpm exec vitest run --project node`
Expected: exit 0; PASS.

- [ ] **Step 8: Sabotage, once each**

1. In `notify`, skip `say(text)`. Expect `notice.test.ts`'s first test red. Revert.
2. In `notify`, ignore `persist`. Expect "keeps a persistent notice" and `buffers-quota.test.ts` red. Revert.
3. In `transport.ts`'s `detach`, drop `notify(e.message)`. Expect `scratch-cap.test.ts` and the `sessions.test.ts` cap test red. Revert.

- [ ] **Step 9: Commit**

```bash
pnpm exec biome ci --error-on-warnings index.html src tests
git add -A web/index.html web/src web/tests
git commit -m "Refusals are notices — one line under the header, said in one live region — and the link status line carries only the link"
```

---

### Task 7: The copies menu — pause, resume, delete with undo — and the copy vocabulary

Spec §10, §12 (`copy N`, `copies ▾`, `new TM copy`, `not shown`, `N views`, `running`/`paused`, the cap sentence).

**Files:**
- Modify: `web/src/scratch.ts` (`copy N` labels; the restore rewrite; `recordOf`, `reinstate`, `nameOf`; the cap sentence)
- Modify: `web/src/buffer-list.ts` (rows, actions, the button's readout; `BufferRow.leg`)
- Modify: `web/src/pane-host.ts` (`PaneHost.moveBack`)
- Modify: `web/src/main.ts` (the pause, resume, delete, undo and new handlers notify; delete focus)
- Modify: `web/src/transport.ts` (a successful edit-a-copy notifies what it made)
- Modify: `web/src/replies.ts` (the no-session sentence)
- Modify: `web/src/style.css` (`.buffer-row-name` wording needs nothing; `.buffer-delete` joins the shared chrome selector in place of `.buffer-retire`)
- Test: `web/tests/browser/copies-undo.test.ts` (new)
- Modify tests: every file in Step 6's grep, and `tests/node/scratch.test.ts`, `tests/node/sessions.test.ts`, `tests/node/buffers-store.test.ts` if it asserts labels

**Interfaces:**
- Produces (`scratch.ts`): `type BufferRecord = { readonly id: SessionId; readonly label: string; readonly leg: Leg; readonly text: string; readonly collapsed: boolean }`; `recordOf(id): BufferRecord | null`; `reinstate(record: BufferRecord): void` (adds the copy cold; throws if the id is held); `nameOf(id): string | null` (`λ copy 1`, `TM copy 2`); labels minted `copy ${n}`.
- Produces (`buffer-list.ts`): `BufferRow.leg: Leg`; the callbacks keep their shape (`onRetire`, `onTemperature`, `onNewTm`).
- Produces (`pane-host.ts`): `PaneHost.moveBack(leaves: readonly LeafId[], from: SessionId, to: SessionId): LeafId[]` — rebinds each leaf still on `from` to `to`, reseeding a TM view first as `reseedingSlots` does; returns the leaves it moved.
- Consumes: `notice.ts`'s `Notices` (Task 6).

- [ ] **Step 1: Write the failing browser test for undo**

Create `web/tests/browser/copies-undo.test.ts`:

```ts
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * **DELETE AND UNDO, THROUGH THE REAL APP** — Plan 7 part 2 spec §10. One copy, deleted from the copies menu
 * while a view shows it; the notice's undo brings it back under its name, at step 0, on the view it left.
 */

const leaf = (id: string) => document.querySelector<HTMLElement>(`[data-leaf="${id}"]`)
const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const titleText = (id: string) => leaf(id)?.querySelector('.view-title')?.textContent ?? ''

beforeAll(async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  leaf('lambda-0')?.querySelector<HTMLButtonElement>('button.detach')?.click()
  await until(() => titleText('lambda-0') === 'λ · copy 1', 'the λ view to show its copy')
})

describe('deleting a copy', () => {
  it('moves its view to the program and offers undo', async () => {
    document.querySelector<HTMLButtonElement>('#buffers')?.click()
    document.querySelector<HTMLButtonElement>('.buffer-list button[aria-label="delete λ copy 1"]')?.click()
    await until(() => titleText('lambda-0') === 'λ · program', 'the view to move to the program')
    expect(noticeText()).toBe('λ copy 1 deleted')
    expect(document.querySelector('#notice button.notice-action')?.textContent).toBe('undo')
    expect(document.querySelector('#buffers')?.textContent).toBe('copies ▾')
  })

  it('comes back through undo, under its name, on the view it left, and says so', async () => {
    document.querySelector<HTMLButtonElement>('#notice button.notice-action')?.click()
    await until(() => titleText('lambda-0') === 'λ · copy 1', 'the view to show the copy again')
    expect(noticeText()).toBe('λ copy 1 restored at step 0')
    expect(document.querySelector('#buffers')?.textContent).toBe('copies 1 ▾')
    await until(() => (leaf('lambda-0')?.querySelector('.step')?.textContent ?? '').startsWith('step 0'), 'step 0')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/copies-undo.test.ts`
Expected: FAIL — the copy's title reads `λ · λ scratch 1`, and no delete control is named `delete λ copy 1`.

- [ ] **Step 3: `scratch.ts` — names, the cap sentence, and the undo pair**

1. In `#mint`: `const label = \`copy ${this.#minted}\`` (the leg is said wherever the label is shown). Update `ScratchBuffers`' and `#mint`'s docs that quote `λ scratch N`.
2. Add `nameOf`:

```ts
  /**
   * A copy's name as the copies menu and every notice say it — `λ copy 1`, `TM copy 2` — or `null` for an id
   * this holds no copy under. The label is `copy N`; the leg is said in front of it, because a title already
   * says the leg its own way (`λ · copy 1`) and a label carrying it would say it twice there.
   */
  nameOf(id: SessionId): string | null {
    const b = this.#buffers.get(id)
    return b === undefined ? null : `${b.leg === 'lambda' ? 'λ' : 'TM'} ${b.label}`
  }
```

3. `#refuseAtCap`'s sentence: `` `${prefix}all ${MAX_WARM_BUFFERS} copies are running; pause or delete one from copies ▾ to make room` ``, and `fork`'s prefix `'fork failed — '` → `'cannot make a copy — '`. Update the doc quoting the old sentence.
4. The restore rewrite, in `restore`, for each stored buffer:

```ts
      // A COPY STORED BEFORE PLAN 7 PART 2 IS NAMED `λ scratch N` OR `TM scratch N`; SAY IT THE NEW WAY
      // (spec §12). Only a label that is exactly that shape is touched, once; the next write stores it.
      const label = /^(?:λ|TM) scratch (\d+)$/.exec(b.label)?.[1]
      ...
        label: label === undefined ? b.label : `copy ${label}`,
```

5. Add `recordOf` and `reinstate`:

```ts
  /** What undoing a delete needs to put a copy back: its id, name, leg, text and collapse flag. */
  recordOf(id: SessionId): BufferRecord | null {
    const b = this.#buffers.get(id)
    return b === undefined ? null : { id: b.id, label: b.label, leg: b.leg, text: b.text, collapsed: b.collapsed }
  }

  /**
   * Put a deleted copy back, COLD, under its own id and name — spec §10's undo. The caller warms it, and a
   * refusal at the cap leaves it paused, which is still a copy restored.
   *
   * **THE ID CANNOT HAVE BEEN REUSED:** `#mint` only counts up, so a deleted `scratch-3` is never minted again,
   * and an id this still holds is a wiring bug — thrown, as `SessionRegistry.add` throws.
   */
  reinstate(record: BufferRecord): void {
    if (this.#buffers.has(record.id)) throw new Error(`a copy is already held under ${record.id}`)
    this.#buffers.set(record.id, { ...record, warm: false })
  }
```

and export `type BufferRecord` beside `BufferInfo`.

- [ ] **Step 4: `buffer-list.ts` — the copies menu**

1. `BufferRow` gains `/** The copy's leg, which its name is said with. */ readonly leg: Leg`.
2. `paneReadout` → `viewReadout`: `0 → 'not shown'`, `1 → '1 view'`, else `` `${n} views` ``. Its doc keeps the argument (a word for the zero case; the singular spelled out) in the new words.
3. `bufferRow`: the name line is `` `${name} · ${viewReadout(row.paneCount)} · ${row.warm ? 'running' : 'paused'}` `` where `name` is `` `${row.leg === 'lambda' ? 'λ' : 'TM'} ${row.label}` ``; the term line still shows only while running. The delete button: class `buffer-delete`, text `delete`, `title`/`aria-label` `` `delete ${name}` ``. The temperature button: text `pause` while running, `resume — restarts at step 0` while paused; `title`/`aria-label` `` `pause ${name}` `` / `` `resume ${name} — restarts at step 0` ``.
4. **Delete keeps the menu open and moves focus to the next row** (spec §11): rewrite the delete click as the temperature click already works — call `onRetire(row.id)`, rebuild the rows in place, then focus the delete control of the row now at the same index, else the one before it; with no rows left, hide the menu and focus the button. Rewrite `bufferRow`'s "IT HIDES THE LIST BEFORE IT FIRES" paragraph to say why that changed: the list is rebuilt, not left stale, so a row naming a deleted copy is never on screen; and keeping the menu open is what lets focus land on the next row rather than on `<body>`.
5. The new item: `new TM copy`. The button's readout: `count === 0 ? 'copies ▾' : \`copies ${count} ▾\``.

- [ ] **Step 5: The handlers**

In `web/src/pane-host.ts`, add to `PaneHost` and its return:

```ts
  /**
   * Move each of `leaves` that still shows `from` onto `to`, reseeding a TM view first as `reseedingSlots`
   * does — undo's half of a delete (spec §10), which moves back the views the delete moved, if they still
   * exist and still show the program. Returns the leaves it moved.
   */
  moveBack(leaves: readonly LeafId[], from: SessionId, to: SessionId): LeafId[]
```

```ts
    moveBack(leaves: readonly LeafId[], from: SessionId, to: SessionId): LeafId[] {
      const moved: LeafId[] = []
      for (const id of leaves) {
        const p = panes.get(id)
        if (p === undefined || p.slot.binding.session !== from) continue
        if (p.kind === 'tm') seedTmPane(p.pane as unknown as TmPane, to)
        p.slot.rebind(to)
        moved.push(id)
      }
      return moved
    },
```

In `web/src/main.ts`, the three `bufferList` callbacks and the rows thunk:

- The rows thunk adds `leg: b.leg`.
- **Pause** (the temperature handler, `warm === false`): before `scratchpad.cool(...)`, `const shown = panes.ofSession(leg, id).length` (read `leg` from `scratchpad.list()`), then after the existing reconcile/refresh/draw, `notices.notify(\`${name} paused${shown === 0 ? '' : \` · ${shown === 1 ? '1 view now shows' : \`${shown} views now show\`} the program\`}\`)`.
- **Resume** (`warm === true`): on success, `notices.notify(\`${name} resumed at step 0\`)`; the cap refusal notifies as Task 6 made it.
- **Delete** (the retire handler): before `scratchpad.retire(...)`, capture `const record = scratchpad.recordOf(id)`, `const name = scratchpad.nameOf(id)` and `const shown = panes.ofSession(record.leg, id).map((p) => p.id)`; after the existing reconcile/refresh/draw, `notices.notify(\`${name} deleted\`, { action: { label: 'undo', run: () => undo(record, shown) } })`.
- **Undo**, a `const undo = (record: BufferRecord, shown: readonly LeafId[]): void => { … }` declared beside the handlers:

```ts
    scratchpad.reinstate(record)
    const name = scratchpad.nameOf(record.id) ?? record.label
    try {
      scratchpad.warm(record.id)
    } catch (e) {
      if (!(e instanceof BufferCapReached)) throw e
      notices.notify(`${name} restored, paused — ${MAX_WARM_BUFFERS} copies are running`)
      refreshBuffers()
      draw()
      return
    }
    const moved = paneHost.moveBack(shown, SOURCE_SESSION, record.id)
    const home = moved[0]
    if (home !== undefined) custody.claim(record.id, home)
    notices.notify(`${name} restored at step 0`)
    refreshBuffers()
    draw()
```

  (The claim before the build lands is what lets `replies.ts`'s `scratch-compiled` arm mount the editor on that view — `editorHome` resolves through the claim, as a fork's does.)
- **New TM copy**: after `const id = scratchpad.forkBlank('tm')`, `notices.notify(\`${scratchpad.nameOf(id)} created\`)`.

In `web/src/transport.ts`, a successful `detach`/`detachMachine` notifies what it made: `const id = scratchpad.fork(...)` then `notify(\`${scratchpad.nameOf(id)} created — this view shows it\`)`.

In `web/src/replies.ts`, the no-session sentence: `` `the copy did not build — ${…}` ``.

- [ ] **Step 6: Move the tests to the copy vocabulary**

| Old | New |
|---|---|
| a label `λ scratch N` / `TM scratch N` | the label `copy N`; said as `λ copy N` / `TM copy N` in the copies menu and notices, `λ · copy N` in titles and menus |
| `buffers ▾`, `` `buffers ${n} ▾` `` | `copies ▾`, `` `copies ${n} ▾` `` |
| `new TM buffer` | `new TM copy` |
| a row `X — 2 panes`, `— 1 pane`, `— orphan`, `— asleep` | `λ copy 1 · 2 views · running`, `· 1 view ·`, `· not shown ·`, `· paused` |
| `retire X` (label and `aria-label`), `.buffer-retire` | `delete X`, `.buffer-delete` |
| `cool X`, `warm X` | `pause X`, `resume X — restarts at step 0` |
| `/orphan/i`, `/asleep/i` | `/not shown/`, `/paused/` |
| the cap sentence (`scratch buffers are live`, `retire or cool one`) | `copies are running`, `pause or delete one` |
| `fork failed — ` (a cap refusal) | `cannot make a copy — ` |
| `fork failed — ` (a copy that did not build) | `the copy did not build — ` |
| a test that expects the copies menu to close on retire | it stays open and focus is on the next row's delete control (or the button, when it was the last) |

Find every site, from `web/`:

```bash
grep -rln "scratch [0-9N]\|scratch \${\|buffers ▾\|buffers \${\|new TM buffer\|orphan\|asleep\|retire \|\"retire\|'retire\|cool \|warm \|buffer-retire\|scratch buffers are live\|retire or cool\|fork failed" tests
```

Each hit is a label in the old vocabulary or a test name or comment; change test names and comments too where they describe what a user sees. Test-supplied fixture labels (`binding-selector.test.ts`'s `λ scratchpad`, `buffer-list.test.ts`'s `scratch N`) may stay — they are data the test chose, not the app's words — but the `copy N` spelling is preferred where it costs nothing.

Add two tests where the behaviour is new:

- `web/tests/browser/copies-undo.test.ts` gains, before its delete test, **"pausing a copy moves its view to the program and says how many"**: open `#buffers`, click `button[aria-label="pause λ copy 1"]`, wait for `λ · program` in `lambda-0`'s title, then expect `#notice .notice-text` to read `λ copy 1 paused · 1 view now shows the program`, and resume it again (`resume λ copy 1 — restarts at step 0`) and wait for `λ copy 1 resumed at step 0` before the delete test runs (put the view back on the copy with the title menu if the delete test needs it there).
- `web/tests/browser/buffer-list.test.ts` gains **"moves focus to the next row's delete control, and to the button after the last"**: with its fixture's three rows, click the first row's delete; expect `document.activeElement` to be the delete control of the row now first, and the menu still open; delete the remaining two; expect the menu closed and `document.activeElement` to be the button.

`tests/node/scratch.test.ts`'s label tests expect `copy 1`, `copy 2`, and its snapshot round-trip; add one test: a restored `λ scratch 3` comes back as `copy 3`, and `other name` is untouched. Add `recordOf`/`reinstate` tests: a deleted copy reinstated is cold, under its id and label, and `reinstate` throws for an id still held.

- [ ] **Step 7: Run and typecheck**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser`
Expected: PASS, including `copies-undo.test.ts`.
Run: `pnpm run typecheck && pnpm exec vitest run --project node`
Expected: exit 0; PASS.

- [ ] **Step 8: Sabotage, once each**

1. In `undo`, skip `paneHost.moveBack`. Expect `copies-undo.test.ts`'s second test red on its wait for `λ · copy 1`. Revert.
2. In `restore`, drop the label rewrite. Expect the new `scratch.test.ts` test red. Revert.
3. In `buffer-list.ts`'s delete, hide the menu as before. Expect `buffer-list.test.ts`'s focus-after-delete test red. Revert.

- [ ] **Step 9: Commit**

```bash
pnpm exec biome ci --error-on-warnings src tests
git add -A web/src web/tests
git commit -m "Copies are copies: the copies menu pauses, resumes and deletes them, a delete can be undone for eight seconds, and every change says so"
```

---

### Task 8: The app header — workspace menu, `+ view`, settings, and a labelled appearance toggle

Spec §6. The header becomes `redextape · Explorer ▾ · + view · copies N ▾ · encoding ▾ ··· ◐ system · settings`.

**Files:**
- Create: `web/src/app-header.ts`
- Modify: `web/index.html`, `web/tests/browser/harness.ts`, `web/tests/node/harness.test.ts`
- Modify: `web/src/icons.ts` (`sun`, `moon`, `settings`)
- Modify: `web/src/appearance.ts` (`APPEARANCE_LABEL` gains the word shown beside the glyph)
- Modify: `web/src/main.ts` (wire the three menus; reset preset; `+ view`; the appearance toggle's label; the settings menu's appearance select)
- Modify: `web/src/pane-host.ts` (`PaneHost.addView`)
- Modify: `web/src/style.css` (`.bar` layout, `.bar-spacer`, `.header-menu`, `#settings-menu` fields)
- Test: `web/tests/browser/app-header.test.ts` (new)
- Modify tests: `#restore-layout` → `#reset-preset` (`pane-kind-switch`, `two-lambda-panes`, `pane-picker`, `active-pane`); `app.test.ts`'s appearance test

**Interfaces:**
- Consumes: `insertBeside` (Task 1), `PRESETS`, `presetOf`, `defaultFocus` (Task 1), `Notices` (Task 6), `pairLabel`, `bindingKey` (Task 3).
- Produces (`app-header.ts`): `wireMenu(button: HTMLButtonElement, menu: HTMLElement, onOpen?: () => void): void` (the `aria-*` and popover wiring every header menu shares), `presetName(p: Preset | null): string` (`'Explorer'`, `'Debugger'`, `'Stage'`, `'custom'`), `addViewItems(menu: HTMLElement, choices: SplitChoices, pick: (c: PaneChoice) => void): void`.
- Produces (`pane-host.ts`): `PaneHost.addView(choice: PaneChoice, beside: LeafId): LeafId` — inserts beside `beside` (`insertBeside`, `row`), applies the layout, focuses what it created, and returns its id.
- DOM contract: `#workspace` (button, the preset's name), `#workspace-menu[popover] > #reset-preset`; `#add-view` + `#add-view-menu[popover]` (items as the split menu's: `button[data-binding]`, `button[data-source]`); `#buffers` (copies, unchanged id); `#encoding`; `#appearance` (glyph + word); `#settings` + `#settings-menu[popover]` holding `#style`, `#palette`, `#appearance-choice`.

- [ ] **Step 1: The markup**

Replace `web/index.html`'s `<header>` with:

```html
    <header class="bar">
      <span class="wordmark">redextape</span>
      <button type="button" id="workspace" aria-haspopup="menu" aria-controls="workspace-menu" aria-expanded="false"></button>
      <div id="workspace-menu" class="header-menu" popover>
        <button type="button" id="reset-preset">reset preset — restores the default views</button>
      </div>
      <button type="button" id="add-view" aria-haspopup="menu" aria-controls="add-view-menu" aria-expanded="false">+ view</button>
      <div id="add-view-menu" class="header-menu" popover></div>
      <button type="button" id="buffers">copies ▾</button>
      <label class="encoding">
        encoding
        <select id="encoding"></select>
      </label>
      <span class="bar-spacer"></span>
      <button type="button" id="appearance"></button>
      <button type="button" id="settings" aria-haspopup="menu" aria-controls="settings-menu" aria-expanded="false">settings</button>
      <div id="settings-menu" class="header-menu settings" popover>
        <label class="skin">style <select id="style"></select></label>
        <label class="skin">palette <select id="palette"></select></label>
        <label class="skin">appearance <select id="appearance-choice"></select></label>
      </div>
    </header>
```

The same in `SHELL`. `tests/node/harness.test.ts`'s list: `'#appearance', '#workspace', '#reset-preset', '#add-view', '#buffers', '#encoding', '#settings', '#style', '#palette', '#notice', '#live', '#results'`.

- [ ] **Step 2: Write the failing test**

Create `web/tests/browser/app-header.test.ts`:

```ts
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

const leafIds = () => [...document.querySelectorAll<HTMLElement>('main [data-leaf]')].map((el) => el.dataset.leaf ?? '')

beforeAll(async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('the app header', () => {
  it('names the workspace after its preset', () => {
    expect(document.querySelector('#workspace')?.textContent).toBe('Explorer')
  })

  it('adds a view beside the focused one, focuses it, and says so', async () => {
    document.querySelector<HTMLElement>('[data-leaf="lambda-0"] button.view-title')?.focus()
    document.querySelector<HTMLButtonElement>('#add-view')?.click()
    const items = [...document.querySelectorAll<HTMLButtonElement>('#add-view-menu button')]
    expect(items.map((b) => b.textContent)).toEqual(['λ · program', 'TM · program'])
    items[1]?.click()
    await until(() => leafIds().length === 4, 'a fourth view')
    expect(leafIds()).toEqual(['source', 'lambda-0', 'pane-1', 'tm-0'])
    expect(document.querySelector('[data-leaf="pane-1"]')?.contains(document.activeElement)).toBe(true)
    expect(document.querySelector('#notice .notice-text')?.textContent).toBe('view added — TM · program')
  })

  it('resets the preset: the default views back, and says so', async () => {
    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
    await until(() => leafIds().length === 3, 'the default views')
    expect(leafIds()).toEqual(['source', 'lambda-0', 'tm-0'])
    expect(document.querySelector('#notice .notice-text')?.textContent).toBe('Explorer reset — the default views are back')
  })

  it('offers source to + view only while no view shows it', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="source"] button.view-close')?.click()
    await until(() => !leafIds().includes('source'), 'the source view to close')
    document.querySelector<HTMLButtonElement>('#add-view')?.click()
    expect([...document.querySelectorAll('#add-view-menu button')].map((b) => b.textContent)).toContain('source')
    document.querySelector<HTMLElement>('#add-view-menu')?.hidePopover()
  })

  it('labels the appearance toggle with its state, in words, and cycles it', () => {
    const b = document.querySelector<HTMLButtonElement>('#appearance')
    const before = b?.textContent
    b?.click()
    expect(b?.textContent).not.toBe(before)
    expect(['system', 'light', 'dark']).toContain(b?.textContent)
    expect(b?.getAttribute('aria-label')).toBeNull()
    expect(document.querySelector<HTMLSelectElement>('#appearance-choice')?.value).toBe(b?.textContent)
  })

  it('keeps style and palette in the settings menu', () => {
    const menu = document.querySelector('#settings-menu')
    expect(menu?.querySelector('#style')).not.toBeNull()
    expect(menu?.querySelector('#palette')).not.toBeNull()
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/app-header.test.ts`
Expected: FAIL — `#workspace` is empty; `#add-view` does nothing.

- [ ] **Step 4: `app-header.ts`, `addView`, and the wiring**

Create `web/src/app-header.ts`:

```ts
import type { PaneChoice, SplitChoices } from './pane-chrome'
import { bindingKey, pairLabel } from './view-header'
import type { Preset } from './workspace'

/**
 * THE APP HEADER'S MENUS — Plan 7 part 2 spec §6: the workspace menu, `+ view` and settings. Each is a native
 * popover beside the button that opens it, declared in `index.html` so the pre-paint script and the skin
 * selects need no change; this module wires what markup cannot.
 */

/**
 * The popover wiring every header menu shares: the invoker relationship, `aria-expanded` kept true to the
 * popover's state, and an optional rebuild on open — `splitControl`'s pattern, which the view menus kept.
 */
export function wireMenu(button: HTMLButtonElement, menu: HTMLElement, onOpen?: () => void): void {
  button.popoverTargetElement = menu
  menu.addEventListener('beforetoggle', (e) => {
    const open = e.newState === 'open'
    button.setAttribute('aria-expanded', String(open))
    if (!open) return
    onOpen?.()
    const first = menu.querySelector<HTMLElement>('button:not([disabled]), select')
    if (first !== null) first.autofocus = true
  })
}

/** The workspace menu's name for a preset — and `custom` when the switches match none (spec §4). */
export function presetName(p: Preset | null): string {
  if (p === null) return 'custom'
  return { explorer: 'Explorer', debugger: 'Debugger', stage: 'Stage' }[p]
}

/**
 * Fill `+ view`'s menu: every pair, then `source` while no view shows it — the split menu's list without its
 * first entry, because `+ view` has no "this view" to offer another view of.
 */
export function addViewItems(menu: HTMLElement, choices: SplitChoices, pick: (c: PaneChoice) => void): void {
  const items = choices.options.map((o) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = pairLabel(o)
    b.dataset.binding = bindingKey(o.leg, o.id)
    b.addEventListener('click', () => {
      menu.hidePopover()
      pick({ kind: o.leg, session: o.id })
    })
    return b
  })
  if (choices.sourceAvailable) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = 'source'
    b.dataset.source = ''
    b.addEventListener('click', () => {
      menu.hidePopover()
      pick({ kind: 'source' })
    })
    items.push(b)
  }
  menu.replaceChildren(...items)
}
```

In `web/src/pane-host.ts`, add to `PaneHost` and its return:

```ts
  /**
   * Add a view showing `choice` beside `beside` — `+ view` (spec §5, §6). `insertBeside`, not `splitLeaf`: the
   * view beside which it lands may be the source view. Records what the new leaf starts on, as `split` does,
   * applies the layout, focuses what it created, and returns its id.
   */
  addView(choice: PaneChoice, beside: LeafId): LeafId
```

```ts
    addView(choice: PaneChoice, beside: LeafId): LeafId {
      const created = choice.kind === 'source' ? SOURCE_LEAF : nextLeafId()
      if (choice.kind !== 'source') pendingBinding.set(created, choice.session)
      setTree(insertBeside(getTree(), beside, 'row', created, choice.kind === 'source' ? 'source' : choice.kind))
      applyLayout()
      focusPane(created)
      return created
    },
```

In `web/src/appearance.ts`, `APPEARANCE_LABEL`'s entries become `{ glyph, word, label }` with `word` `system`/`light`/`dark`; keep `label` (its tests read it) and say in its doc that the toggle now shows `word` beside the glyph and takes its name from it.

In `web/src/icons.ts`, add `sun`, `moon`, `settings` (paths: `sun: 'M8 5 A3 3 0 1 0 8 11 A3 3 0 1 0 8 5 M8 1.5 V3 M8 13 V14.5 M1.5 8 H3 M13 8 H14.5 M3.4 3.4 L4.5 4.5 M11.5 11.5 L12.6 12.6 M3.4 12.6 L4.5 11.5 M11.5 4.5 L12.6 3.4'`, `moon: 'M11.5 2.5 A5.5 5.5 0 1 0 13.5 10.5 A4.5 4.5 0 0 1 11.5 2.5 Z'`, `settings: 'M8 5.75 A2.25 2.25 0 1 0 8 10.25 A2.25 2.25 0 1 0 8 5.75 M8 1.5 V3.5 M8 12.5 V14.5 M1.5 8 H3.5 M12.5 8 H14.5 M3.4 3.4 L4.8 4.8 M11.2 11.2 L12.6 12.6 M3.4 12.6 L4.8 11.2 M11.2 4.8 L12.6 3.4'`), with a comment that Hack lacks `☀` and `☾` (part 1's roadmap entry) and `⚙` is drawn to match. `◐` stays text: Hack draws it.

In `web/src/main.ts`:
1. Query `#workspace`, `#workspace-menu`, `#reset-preset`, `#add-view`, `#add-view-menu`, `#settings`, `#settings-menu`, `#appearance-choice` beside the others; add them to the missing-mount guard; drop `#restore-layout`.
2. The appearance toggle: `relabelAppearance` writes `appearanceButton.replaceChildren(glyphFor(appearance), document.createTextNode(APPEARANCE_LABEL[appearance].word))`, where `glyphFor` is `icon('sun')` for light, `icon('moon')` for dark and a `◐` text node for system; sets `title` to `APPEARANCE_LABEL[appearance].label` and removes `aria-label` (the visible word is the name — spec §6). Fill `#appearance-choice` with the three options once; its `change` sets `appearance` exactly as the toggle's click does; `relabelAppearance` also sets its value, so the two never disagree. Settings is wired before `init()` with the toggle, for the toggle's own reason (it touches nothing but storage and `<html>`): `wireMenu(settingsButton, settingsMenu)`, and `settingsButton.replaceChildren(icon('settings'), document.createTextNode('settings'))`.
3. The workspace menu, after `paneHost` exists: `workspaceButton.textContent = presetName(presetOf(ws.switches))`, `wireMenu(workspaceButton, workspaceMenu)`, and `#reset-preset`'s click (replacing `restoreLayoutButton`'s):

```ts
  resetPresetButton.addEventListener('click', () => {
    workspaceMenu.hidePopover()
    const preset = presetOf(ws.switches) ?? 'explorer'
    tree = defaultLayout()
    ws = { ...ws, switches: PRESETS[preset], focused: defaultFocus(tree) }
    paneHost.applyLayout()
    notices.notify(`${presetName(preset)} reset — the default views are back`)
  })
```

   (`presetOf(…) ?? 'explorer'` because 2a's switches are always Explorer's; 2b removes the item while custom, spec §4.)
4. `+ view`:

```ts
  wireMenu(addViewButton, addViewMenu, () =>
    addViewItems(
      addViewMenu,
      { options: sessions.pairs(), sourceAvailable: !leaves(tree).some((l) => l.pane === 'source'), current: null },
      (choice) => {
        const beside = leaves(tree).some((l) => l.id === ws.focused) ? ws.focused : defaultFocus(tree)
        paneHost.addView(choice, beside)
        notices.notify(`view added — ${choice.kind === 'source' ? 'source' : pairLabel({ leg: choice.kind, label: sessions.entryOf(choice.session).label })}`)
      },
    ),
  )
```

- [ ] **Step 5: Style it**

In `web/src/style.css`: `.bar` loses `justify-content: space-between` (the spacer does that job now) and gains `flex-wrap: wrap`; add:

```css
.bar-spacer {
  flex: 1 1 auto;
}
/* THE HEADER'S BUTTONS: `#appearance`'s chrome, shared, so the header reads as one row of controls — and not
   the browser's default dark button, which part 1's roadmap entry recorded the header wearing. */
#workspace,
#add-view,
#buffers,
#settings {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  font: inherit;
  padding: 0.15em 0.6em;
  border-radius: var(--radius);
  border: 1px solid var(--fg-dim);
  background: transparent;
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
}
#appearance {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  white-space: nowrap;
}
/* The header's menus, on the view menu's positioning — its comment has the argument. */
.header-menu {
  position-area: block-end span-inline-end;
  position-try-fallbacks:
    flip-block,
    flip-inline,
    flip-block flip-inline;
  border: 1px solid var(--rule);
  background: var(--bg);
  color: var(--fg);
  padding: 0.25rem;
  margin: 0;
  min-width: 12rem;
}
@supports not (position-area: block-end) {
  .header-menu {
    margin: auto;
  }
}
.header-menu > button {
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  padding: 0.25em 0.6em;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.header-menu.settings {
  position-area: block-end span-inline-start;
  display: grid;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}
```

Delete `#appearance`'s old rule's duplicate declarations that the shared rule now carries, keeping `font-family: var(--font-mono)` off the shared rule (the header's words read in the UI face).

- [ ] **Step 6: Move the tests**

- `#restore-layout` → `#reset-preset` in `pane-kind-switch`, `two-lambda-panes` (four), `pane-picker`, `active-pane`. The item sits in a closed popover; `.click()` on it still runs its handler.
- `app.test.ts`'s appearance test: the toggle's name is its visible word now — `button.getAttribute('aria-label')` expectations become `button.textContent` expectations (`'system'`, `'light'`, `'dark'`), and its `title` keeps the full `appearance: …` label.
- Any test that finds `#style` or `#palette` by walking the header's direct children (`grep -rn "header.bar\|\.bar >" tests`) finds them in `#settings-menu` instead.

- [ ] **Step 7: Run and typecheck**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser`
Expected: PASS.
Run: `pnpm run typecheck && pnpm exec vitest run --project node`
Expected: exit 0; PASS.

- [ ] **Step 8: Sabotage, once each**

1. In `main.ts`'s `+ view` handler, pass `SOURCE_LEAF` as `beside` always. Expect "adds a view beside the focused one" red on the leaf order (`pane-1` lands after `source`). Revert.
2. Drop the reset notice. Expect "resets the preset" red. Revert.

- [ ] **Step 9: Commit**

```bash
pnpm exec biome ci --error-on-warnings index.html src tests
git add -A web/index.html web/src web/tests
git commit -m "The header names its preset and holds + view, copies, encoding, a worded appearance toggle and a settings menu; reset preset brings the default views back and says so"
```

---

### Task 9: The strip — the readout follows the focused view

Spec §9. `#results` and `#link-status` become the strip's two halves in a `footer.strip`; `#results[data-state]` stays the program's compile state. The readout is the focused view's session: the program, a λ copy, a TM copy, or no session.

**Files:**
- Create: `web/src/readout.ts`
- Modify: `web/index.html`, `web/tests/browser/harness.ts` (the footer)
- Modify: `web/src/results.ts` (`reductions`, `transitions`; one-line segments beside the rows)
- Modify: `web/src/replies.ts` (store the program's result instead of rendering it; `showWorkerError` into the program result)
- Modify: `web/src/draw.ts` (render the readout for the focused session each frame, guarded)
- Modify: `web/src/link-status.ts` (the link sentence's words: views, copies, the program)
- Modify: `web/src/link-wiring.ts` (announce the sentence after a link gesture)
- Modify: `web/src/main.ts` (build the readout; hand `focused` to `draw`)
- Modify: `web/src/style.css` (`.strip`; `.results` becomes one line; `.row` rules deleted)
- Test: `web/tests/node/readout.test.ts` (new), `web/tests/browser/strip.test.ts` (new)
- Modify tests: `tests/node/results.test.ts`, `tests/node/link-status.test.ts`, and every browser test reading `#results`'s text (Step 7)

**Interfaces:**
- Produces (`readout.ts`): `type ProgramResult = { readonly kind: 'result'; readonly lambda: LambdaLeg; readonly tm: TmLeg } | { readonly kind: 'no-session'; readonly diagnostics: readonly Diagnostic[] } | { readonly kind: 'error'; readonly error: unknown }`; `programSegments(r: ProgramResult | null): string[]`; `lambdaCopySegments(name: string, leg: { readonly newestStep: number; readonly done: RecordEnd | null; readonly status: { readonly available: boolean; readonly reason: string } }): string[]`; `tmCopySegments(name: string, reading: TmScratchReading | null): string[]`; `createReadout(host: HTMLElement): { show(r: ProgramResult | null, segments: readonly string[]): void }`.
- Produces (`draw.ts` deps): `focused: () => LeafId`, `sourceSession: SessionId`, `readout: { show(program: ProgramResult | null, segments: readonly string[]): void }`, `program: () => ProgramResult | null`, `nameOf: (session: SessionId) => string | null`.
- Produces (`replies.ts` deps): `setProgram(r: ProgramResult): void` in place of writing `results`' children.
- Produces (`link-wiring.ts` deps): `announce: (text: string) => void`.

- [ ] **Step 1: Write the failing node test**

Create `web/tests/node/readout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { lambdaCopySegments, programSegments, tmCopySegments } from '../../src/readout'

const LAMBDA = {
  status: { available: true, reason: '', run: 'Ended' as const, node: null },
  state: { text: '42', step: 7, cut: null, owner: 'None' as const },
  value: { Value: { text: '42' } },
}
const TM = { status: { available: true, reason: '', width: 8, total_steps: 2870, run: 'Halted' as const, node: null }, value: { Value: { text: '42' } } }

describe('programSegments', () => {
  it('reads value and counts per leg, in the new vocabulary, with no normal-form text', () => {
    const s = programSegments({ kind: 'result', lambda: LAMBDA, tm: TM } as never)
    expect(s).toEqual(['λ 42 · 7 reductions', 'TM 42 · 2,870 transitions · width 8'])
  })

  it('says a program that does not compile, and how many errors', () => {
    const s = programSegments({ kind: 'no-session', diagnostics: [{ severity: 'Error' }, { severity: 'Warning' }] } as never)
    expect(s).toEqual(['not compiled — 1 error'])
  })
})

describe('lambdaCopySegments', () => {
  it('names the copy and says how far it has run and why it stopped', () => {
    expect(lambdaCopySegments('λ copy 1', { newestStep: 12, done: 'ended', status: { available: true, reason: '' } })).toEqual([
      'λ copy 1 · 12 reductions',
    ])
    expect(lambdaCopySegments('λ copy 1', { newestStep: 5000, done: 'capped', status: { available: true, reason: '' } })).toEqual([
      'λ copy 1 · 5,000 reductions · spent its step budget',
    ])
    expect(lambdaCopySegments('λ copy 1', { newestStep: 0, done: null, status: { available: false, reason: 'building…' } })).toEqual([
      'λ copy 1 · building…',
    ])
  })
})

describe('tmCopySegments', () => {
  it('names the copy and carries its reduced-file sentence and value line', () => {
    const reading = {
      status: { header: true, width: 4, reduction: { stages: ['single-tape'], steps: 241666 } },
      value: { run: { run: 'Ended', steps: 241666, cap: 1000000000 }, value: { Value: { text: '2' } } },
    }
    expect(tmCopySegments('TM copy 1', reading as never)).toEqual([
      'TM copy 1 · value: 2 · reduced: single-tape · 241,666 steps',
    ])
  })
})
```

(The fixtures cast through `never` because the wire types carry fields the readout never reads; read `protocol.ts`'s `LambdaLeg`, `TmLeg` and `types.ts`'s `TmScratchStatus` and replace each cast with a literal of the real type if the compiler accepts it without one — the pre-flight build decides which.)

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project node tests/node/readout.test.ts`
Expected: FAIL — `readout.ts` does not exist.

- [ ] **Step 3: The vocabulary in `results.ts`, and `readout.ts`**

In `web/src/results.ts`: `` `${n(l.state.step)} β-steps` `` → `` `${n(l.state.step)} reductions` ``; `` `${n(t.status.total_steps)} δ-steps` `` → `` `… transitions` ``; `stopped after … δ-steps at a cap` → `stopped after … transitions at a cap`. Keep `resultRows`, `noSessionRows`, `runNote` and `valueLine` exported — `readout.ts` builds on them and the inspector (2b) will render rows.

Create `web/src/readout.ts`:

```ts
import { showWorkerError } from './banner'
import type { RecordEnd } from './protocol'
import { n } from './format'
import type { LambdaLeg, TmLeg } from './protocol'
import { noSessionRows, resultRows, valueLine } from './results'
import type { TmScratchReading } from './sessions'
import type { Diagnostic } from './types'
import { decodedText } from './types'

/**
 * THE READOUT — Plan 7 part 2 spec §9: value and steps for the focused view's session, as one line (the
 * strip). The inspector (2b) will show the same facts one per line.
 *
 * **THE PROGRAM'S RESULT IS STORED, NOT RENDERED ON ARRIVAL.** `replies.ts` used to write the rows into
 * `#results` when a `result` reply landed; the strip now shows whichever session the focused view shows, so a
 * focus change has to be able to put the program back without a recompile. `replies.ts` hands the result
 * here and `draw()` renders it.
 *
 * **`#results[data-state]` IS STILL THE PROGRAM'S COMPILE STATE** — `running` while a compile is in flight,
 * `idle` after — whatever the strip is describing; the browser tests wait on it.
 *
 * **NO NORMAL-FORM TEXT.** A normal form can be 64 KiB; the λ view shows it, and the inspector will.
 */

export type ProgramResult =
  | { readonly kind: 'result'; readonly lambda: LambdaLeg; readonly tm: TmLeg }
  | { readonly kind: 'no-session'; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: 'error'; readonly error: unknown }

/** One segment per leg: its value, its count and why it stopped, from `results.ts`'s own rows. */
export function programSegments(r: ProgramResult | null): string[] {
  if (r === null) return []
  if (r.kind === 'error') return []
  if (r.kind === 'no-session') return noSessionRows([...r.diagnostics]).map((row) => row.value)
  const rows = resultRows(r.lambda, r.tm)
  const leg = (name: string): string => {
    const own = rows.filter((row) => row.leg === name)
    const declined = own.find((row) => row.label === 'declined')
    if (declined !== undefined) return `${name} declined — ${declined.value}`
    const value = own.find((row) => row.label === 'value')?.value
    const rest = own.filter((row) => row.label !== 'value' && row.label !== 'normal form' && row.label !== 'term so far')
    return [value === undefined ? name : `${name} ${value}`, ...rest.map((row) => row.value)].join(' · ')
  }
  return [leg('λ'), leg('TM')]
}

const STOPPED: Readonly<Record<RecordEnd, string>> = {
  ended: '',
  capped: 'spent its step budget',
  'depth-refused': 'the term is deeper than the reducer allows',
  budget: 'history is full',
}

export function lambdaCopySegments(
  name: string,
  leg: { readonly newestStep: number; readonly done: RecordEnd | null; readonly status: { readonly available: boolean; readonly reason: string } },
): string[] {
  if (!leg.status.available) return [`${name} · ${leg.status.reason}`]
  const why = leg.done === null ? '' : STOPPED[leg.done]
  return [[name, `${n(leg.newestStep)} reductions`, ...(why === '' ? [] : [why])].join(' · ')]
}

export function tmCopySegments(name: string, reading: TmScratchReading | null): string[] {
  const parts = [name]
  const value = valueLine(reading?.value ?? null)
  if (value !== null) parts.push(value)
  const reduction = reading?.status.reduction ?? null
  if (reduction !== null) parts.push(`reduced: ${reduction.stages.join(', ')} · ${n(reduction.steps)} steps`)
  return [parts.join(' · ')]
}

/**
 * The strip's readout half. `show` rewrites the element only when what it would show changed — it runs on
 * every frame during playback.
 */
export function createReadout(host: HTMLElement): { show(program: ProgramResult | null, segments: readonly string[]): void } {
  let rendered = ''
  return {
    show(program, segments) {
      if (program?.kind === 'error') {
        if (rendered === '\x00error') return
        rendered = '\x00error'
        showWorkerError(host, program.error)
        return
      }
      const key = segments.join('\x01')
      if (key === rendered) return
      rendered = key
      host.replaceChildren(
        ...segments.map((s) => {
          const el = document.createElement('span')
          el.className = 'segment'
          el.textContent = s
          return el
        }),
      )
      host.title = segments.join(' — ')
    },
  }
}
```

(`decodedText` is imported for parity with `results.ts`'s value formatting if a segment needs it; drop the import if Biome reports it unused.)

- [ ] **Step 4: Store the program's result, and render the readout in `draw()`**

1. `web/index.html` and `SHELL`: replace `<div id="link-status" class="link-status"></div>` and `<section id="results" class="pane results"></section>` with:

```html
    <footer class="strip">
      <section id="results" class="results"></section>
      <div id="link-status" class="link-status"></div>
    </footer>
```

2. `replies.ts`: deps gain `setProgram(r: ProgramResult): void`. In the `no-session` arm, `renderRows(results, noSessionRows(...))` → `setProgram({ kind: 'no-session', diagnostics: reply.diagnostics })`; in `result`, `renderRows(results, resultRows(reply.lambda, reply.tm))` → `setProgram({ kind: 'result', lambda: reply.lambda, tm: reply.tm })`; the two `showWorkerError(results, new Error(reply.message))` → `setProgram({ kind: 'error', error: new Error(reply.message) })`. Each is followed by the `draw()` its arm already makes (add one where the arm has none). `results.dataset.state = …` lines stay. Delete `renderRows`.
3. `main.ts`: `let program: ProgramResult | null = null`; `const readout = createReadout(results)`; pass `setProgram: (r) => { program = r }` to `createReplies`, and to `createDraw`: `focused: () => ws.focused`, `readout`, `program: () => program`, `nameOf: (s) => scratchpad.nameOf(s)`.
4. `draw.ts`: at the end of the returned function:

```ts
    const leaf = focused()
    const entry = panes.get(leaf)
    if (entry === undefined || entry.slot.binding.session === SOURCE_SESSION_ID) {
      readout.show(program(), programSegments(program()))
    } else {
      const session = entry.slot.binding.session
      const name = nameOf(session) ?? session
      const segments =
        entry.slot.binding.leg === 'lambda'
          ? lambdaCopySegments(name, entry.slot.resolve(sessions) as never)
          : tmCopySegments(name, sessions.entryOf(session).tmScratch)
      readout.show(null, segments)
    }
```

   where `SOURCE_SESSION_ID` is the program session's id, passed in as a dependency (`sourceSession: SessionId`) rather than re-spelled here — `main.ts`'s `SOURCE_SESSION`. A focused source view (`panes.get('source')` is `undefined`) shows the program, which is the table's first row. Replace the `as never` with the `LegState` it is: `lambdaCopySegments` takes a structural type `LegState` satisfies (`hist.newestStep` is the history's; pass `{ newestStep: leg.hist.newestStep, done: leg.done, status: leg.status }`).
5. The focus listeners (`pane-host.ts`'s `hostFor`, `main.ts`'s source host) already call `draw()` or should: add `draw()` after `setFocused` in the source host's listener.

- [ ] **Step 5: The link sentence's words, and announcing it**

In `link-status.ts`: `detachedText` → `'λ and TM views show copies — not linked to the program'`, `'λ view shows a copy — not linked to the program'`, `'TM view shows a copy — not linked to the program'`; `LAMBDA_TEXT['not-step-0']` → `'the λ link is only defined at step 0 — restart the λ view to see it'`. Update the docs that quote the old sentences.

In `link-wiring.ts`, deps gain `announce: (text: string) => void`; in `setLinkTo`, after `draw()`, `announce(linkStatusHost.textContent ?? '')` when it differs from the last text announced (keep a `let lastAnnounced = ''`). Only `setLinkTo` announces — spec §11: a link gesture, never a keystroke. `main.ts` passes `announce: (t) => notices.announce(t)`.

- [ ] **Step 6: Style it**

In `web/src/style.css`, replace `.results`, `.results[data-state="running"]`, `.row`, `.row .leg`, `.row .label`, `.row .value` and `.note` with:

```css
/* THE STRIP (spec §9): the readout and the link sentence on one line along the bottom of the workspace. */
.strip {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-1) var(--space-3);
  border-top: 1px solid var(--rule);
  background: var(--bg-raised);
  font-family: var(--font-mono);
  font-size: var(--step--1);
}
.results {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  min-width: 0;
}
.results[data-state="running"] {
  opacity: 0.55;
}
.results .segment {
  white-space: nowrap;
}
.strip .link-status {
  margin-inline-start: auto;
  padding: 0;
}
```

- [ ] **Step 7: Move the tests**

- Text: `β-steps` → `reductions`, `δ-steps` → `transitions` across `tests/browser/app.test.ts`, `running-focus.test.ts`, `tests/node/results.test.ts`; `resultsText()` expectations that read the normal form's text from `#results` read it from the λ view's `.term` instead.
- **Focus.** `#results` shows the FOCUSED view's session. Tests that read the program's value or counts after a copy's view took focus — a title-menu or `⋯`-menu pick focuses the view it opens in, and `focusPane` focuses what a split creates — must first put the focus on the program: add to each such file `const focusProgram = () => document.querySelector<HTMLElement>('[data-leaf="source"] .cm-content')?.focus()` and call it before the read. Audit every `resultsText()` read in the files that make copies: `scratch-edit`, `scratch-fork`, `scratch-app`, `scratch-buffers`, `scratch-rebind-editor`, `buffer-cool-warm`, `tm-blank-buffer`, `tm-buffer-restore`, `buffers-quota`. `scratch-edit.test.ts`'s "leave the source result untouched" check keeps its point by focusing the program before both reads it compares.
- `#link-status` expectations with the old detachment sentences take the new ones; `tests/node/link-status.test.ts` likewise.

Create `web/tests/browser/strip.test.ts` driving the real app: after the first compile the strip reads `λ 42 · 7 reductions` and `TM 42 · … transitions` (from `let x = 40; x + 2`); editing a copy (`button.detach` on the λ view, then focusing that view's title) makes it read `λ copy 1 · …`; focusing the source view's `.cm-content` puts the program back; `#results`'s `data-state` stays `idle` throughout. One wait per test body.

- [ ] **Step 8: Run and typecheck**

Run: `pnpm exec vitest run --project node`
Expected: PASS.
Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser`
Expected: PASS.
Run: `pnpm run typecheck`
Expected: exit 0.

- [ ] **Step 9: Sabotage, once each**

1. In `draw.ts`, always show the program. Expect `strip.test.ts`'s copy test red. Revert.
2. In `setLinkTo`, drop the announcement. Expect a new assertion in `strip.test.ts` — after clicking the source (link gesture through `Mod-'` or a click at a construct), `#live`'s text equals `#link-status`'s — red. Write that assertion. Revert.

- [ ] **Step 10: Commit**

```bash
pnpm exec biome ci --error-on-warnings index.html src tests
git add -A web/index.html web/src web/tests
git commit -m "The strip reads the focused view's session in one line — the program's value and counts, or a copy's — and a link gesture is announced"
```

---

### Task 10: Layout notices, and focus that never falls to `<body>`

Spec §11 (layout notices; the focus rules), §15 (items 1 and 9).

**Files:**
- Modify: `web/src/pane-host.ts` (dependency `layoutChanged`; split, close, rebind and `addView` report)
- Modify: `web/src/main.ts` (word the reports as notices; `+ view`'s own notice moves here)
- Modify: `web/src/step-controls.ts` (focus leaves a disappearing continue button for a neighbour)
- Modify: `web/src/tm-pane.ts` (focus leaves the disappearing `follow current rule` for the rules toggle)
- Test: `web/tests/browser/layout-notices.test.ts` (new), `web/tests/browser/step-controls.test.ts`

**Interfaces:**
- Produces (`pane-host.ts` deps): `layoutChanged(e: LayoutEvent): void`, with `type LayoutEvent = { readonly kind: 'added' | 'switched'; readonly leaf: LeafId; readonly shows: PaneChoice } | { readonly kind: 'closed'; readonly leaf: LeafId; readonly showed: PaneChoice }` exported from `pane-host.ts`.
- Consumes: `Notices` (Task 6), `pairLabel` (Task 3).

- [ ] **Step 1: Write the failing tests**

Create `web/tests/browser/layout-notices.test.ts`:

```ts
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { bindingKey } from '../../src/view-header'
import { SHELL, until } from './harness'

const noticeText = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
const leafIds = () => [...document.querySelectorAll<HTMLElement>('main [data-leaf]')].map((el) => el.dataset.leaf ?? '')

/** `view-menu`'s `splitVia`, restated for the reason every browser file restates its helpers. */
function splitVia(leaf: string, dir: 'row' | 'column', pick: string): void {
  const more = document.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button.view-more`)
  more?.click()
  const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
  menu?.querySelector<HTMLButtonElement>(`button.view-split[data-dir="${dir}"]`)?.click()
  const selector = pick === 'same' ? 'button[data-same]' : `button[data-binding="${pick}"]`
  menu?.querySelector<HTMLButtonElement>(`.view-menu-pairs ${selector}`)?.click()
}

beforeAll(async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

describe('layout notices', () => {
  it('says a view was added', async () => {
    splitVia('lambda-0', 'row', bindingKey('tm', 'source'))
    await until(() => leafIds().length === 4, 'the split')
    expect(noticeText()).toBe('view added — TM · program')
  })

  it('says a view now shows something else', async () => {
    const title = document.querySelector<HTMLButtonElement>('[data-leaf="pane-1"] button.view-title')
    title?.click()
    document.querySelector<HTMLButtonElement>(`#${title?.getAttribute('aria-controls')} button[data-binding="${bindingKey('lambda', 'source')}"]`)?.click()
    await until(() => document.querySelector('[data-leaf="pane-1"]')?.getAttribute('data-kind') === 'lambda', 'the switch')
    expect(noticeText()).toBe('view now shows λ · program')
  })

  it('says a view closed, and puts focus on the title of the view that grew', async () => {
    document.querySelector<HTMLButtonElement>('[data-leaf="pane-1"] button.view-close')?.click()
    await until(() => leafIds().length === 3, 'the close')
    expect(noticeText()).toBe('view closed — λ · program')
    expect(document.activeElement?.matches('[data-leaf="lambda-0"] .view-title')).toBe(true)
  })
})
```

Add to `web/tests/browser/step-controls.test.ts`:

```ts
  it('moves focus to a neighbour when the continue button it sits on goes away', () => {
    const { s } = build()
    s.update({ ...STATE, continueLabel: 'keep recording' })
    s.el.querySelector<HTMLButtonElement>('button.extend')?.focus()
    s.update({ ...STATE, continueLabel: null })
    expect(document.activeElement).toBe(s.el.querySelector('[aria-label="one step forward"]'))
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/layout-notices.test.ts tests/browser/step-controls.test.ts`
Expected: FAIL — no notice for a split, a switch or a close; focus stays on the hidden continue button.

- [ ] **Step 3: Report layout changes from `pane-host.ts`, and word them in `main.ts`**

In `pane-host.ts`: export `LayoutEvent`; deps gain `/** A view was added, closed, or switched to show something else — `main.ts` says it as a notice (spec §11). */ layoutChanged(e: LayoutEvent): void`.
- `split`: after `focusPane(created)`, `layoutChanged({ kind: 'added', leaf: created, shows: choice })`.
- `close`: before `setTree(closeLeaf(...))`, `const showed: PaneChoice = { kind: slot.binding.leg, session: slot.binding.session }`; after `focusPane(grew)`, `layoutChanged({ kind: 'closed', leaf: id, showed })`.
- `rebind`, both arms, at their end: `layoutChanged({ kind: 'switched', leaf: id, shows: { kind: choice.leg, session: choice.session } })` — only when the pair actually changed (`choice.session !== leaving || choice.leg !== slot's leg before`).
- `addView`: after `focusPane(created)`, the `added` event.

`main.ts`'s source view close (the `viewMenu` close handler) reports `{ kind: 'closed', leaf: SOURCE_LEAF, showed: { kind: 'source' } }` through the same function.

In `main.ts`, pass:

```ts
    layoutChanged: (e: LayoutEvent) => {
      const say = (c: PaneChoice): string =>
        c.kind === 'source' ? 'source' : pairLabel({ leg: c.kind, label: sessions.has(c.session) ? sessions.entryOf(c.session).label : c.session })
      if (e.kind === 'added') notices.notify(`view added — ${say(e.shows)}`)
      else if (e.kind === 'closed') notices.notify(`view closed — ${say(e.showed)}`)
      else notices.notify(`view now shows ${say(e.shows)}`)
    },
```

and delete `+ view`'s own `notices.notify(...)` from Task 8 (the `added` event says it now; `app-header.test.ts`'s expectation is unchanged).

- [ ] **Step 4: The two self-hiding controls**

In `step-controls.ts`'s `update`, before hiding `extend`:

```ts
      if (c.continueLabel === null) {
        // A CONTROL THAT GOES AWAY UNDER THE KEYBOARD MUST NOT TAKE THE FOCUS WITH IT (umbrella rule 5,
        // spec §11). The nearest control that still works takes it: forward, then play, back, restart.
        if (document.activeElement === extend) {
          const next = [forward, play, back, restart].find((b) => !b.disabled)
          next?.focus()
        }
        extend.hidden = true
      }
```

(Compute the `disabled` flags before this block, as `update` already does.)

In `tm-pane.ts`, `#reattach`'s click: after `this.#follow.attach(); this.#drawTable()`, when the button has just hidden itself and had focus, focus the rules panel's toggle: `if (this.#reattach.hidden && document.activeElement === document.body) this.#rulesPanel.toggle.focus()` — read `#drawTable` to confirm it is what sets `#reattach.hidden`, and focus the toggle only when the reattach button was the focused element before the click (capture `const had = document.activeElement === this.#reattach` at the top of the handler). This is the accessibility list's item 1 measured instance.

- [ ] **Step 5: Run the browser tier**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser`
Expected: PASS.

- [ ] **Step 6: Sabotage, once each**

1. Drop the `closed` event. Expect "says a view closed" red. Revert.
2. Drop the continue-button focus move. Expect the new step-controls test red. Revert.

- [ ] **Step 7: Commit**

```bash
pnpm exec biome ci --error-on-warnings src tests
git add -A web/src web/tests
git commit -m "Adding, closing and switching a view each say so, and a control that hides itself hands focus to its neighbour"
```

---

### Task 11: The renames no earlier task reached, and the search for every old word

Spec §12.

**Files:**
- Modify: `web/src/layout-view.ts` (the dividers' names), `web/src/replies.ts` (`the copy failed`), `web/src/main.ts` (`copies are not being saved`)
- Modify: `crates/redextape-wasm/src/session.rs` (two refusals and their test)
- Modify tests: whatever each rename reaches (`grep` below)

- [ ] **Step 1: The web strings**

- `layout-view.ts`: `'resize panes left and right'` → `'resize views left and right'`, `'resize panes up and down'` → `'resize views up and down'`.
- `replies.ts`: `'the scratchpad failed'` → `'the copy failed'`.
- `main.ts`: `'buffers are not being saved — this browser’s storage for this site is full'` → `'copies are not being saved — this browser’s storage for this site is full'`.

- [ ] **Step 2: The Rust strings**

In `crates/redextape-wasm/src/session.rs`: `"the term at this step is too large to fork — scrub to an earlier step"` → `"the term at this step is too large to copy — scrub to an earlier step"`; both `"this file is {} bytes; a TM buffer builds files up to {} bytes — …"` → `"this file is {} bytes; a TM copy builds files up to {} bytes — …"`; the test asserting `contains("too large to fork")` → `contains("too large to copy")`. Then rebuild the wasm package (`pnpm run build:wasm:dev` from `web/`) before any browser run.

Run: `cargo nextest run -p redextape-wasm`
Expected: PASS.

- [ ] **Step 3: Search for every old word**

From the repo root:

```bash
grep -rnE "β-steps|δ-steps|\bpanes? (left|up)|close this pane|\[detached\]|✎ fork|fork failed|\bretire\b|\bwarm\b|\bcool\b|asleep|orphan|scratch buffers|scratchpad|new TM buffer|buffers ▾|reset layout|restore the default pane layout|bring the term editor|\(same\)|'shows'|too large to fork|TM buffer builds" web/src web/index.html web/tests crates/redextape-wasm/src | grep -vE "^\S+:\s*(\*|//|/\*)" > /tmp/claude-1000/-home-davey-projects-redextape/c2612020-d970-412d-bda4-797b7ed7886a/scratchpad/old-words.txt; wc -l < /tmp/claude-1000/-home-davey-projects-redextape/c2612020-d970-412d-bda4-797b7ed7886a/scratchpad/old-words.txt
```

(Write the list to the session scratchpad — use the scratchpad path the executing session names if it differs.) Read every line. Each must be one of: an internal identifier (`retire(`, `warm(`, `cool(`, `scratchpad` as a variable, `ScratchBuffers`), a test-supplied fixture label, or a test name describing internal behaviour. Anything a user sees or hears is fixed in this task. Then search the comments for claims about what the user sees:

```bash
grep -rnE "\[detached\]|✎ fork|reset layout|buffers ▾|shows select|the .shows. select" web/src web/tests | grep -E "^\S+:\s*(\*|//|/\*)"
```

and reword each comment that describes today's UI in the old words (history paragraphs that say "this used to read …" may keep the old words — they are describing the past).

- [ ] **Step 4: The vacuous negatives**

The inventory at `13db3b7` found 23 negative assertions on old labels. Confirm each was rewritten by the task that renamed its label:

```bash
grep -rnE "not\.toContain\('(\[detached\]|detached|fork failed|scratch buffers|asleep|orphan|β-steps|δ-steps)" web/tests
```

Expected: nothing. Every negative assertion that remains names a new word and stands beside a positive check.

- [ ] **Step 5: Run everything**

Run: `pnpm run typecheck && pnpm exec vitest run --project node && PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser`
Expected: exit 0; PASS; PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec biome ci --error-on-warnings src tests
git add -A web/src web/tests crates/redextape-wasm/src/session.rs
git commit -m "The last old words go: views are resized and copies fail, copies are not saved, and the wasm session's refusals say copy"
```

---

### Task 12: Controls, as a class — the gate

Spec §14 item 5 (umbrella §8.1). One browser test walks every button and select on the page, opens every menu, and holds each control to rules 1 and 5.

**Files:**
- Test: `web/tests/browser/controls-gate.test.ts` (new)

- [ ] **Step 1: Write the gate**

First establish what computes an accessible name here: `pnpm why dom-accessibility-api` from `web/`. If it resolves (Vitest's browser matchers depend on it), import `computeAccessibleName` from it; otherwise use the approximation below, which covers every naming mechanism this app uses (`aria-label`, a wrapping `<label>`, text content, `title`). Record which in the task's report.

```ts
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * **EVERY CONTROL, AS A CLASS** — umbrella §8.1, Plan 7 part 2 spec §14. Rather than one test per control,
 * this walks every button and select the page holds, with every menu opened in turn, and asserts three things
 * of each: it has an accessible name that is not a bare glyph (rule 1), the name matches its visible label or
 * its tooltip (rule 1), and it is reachable by keyboard (rule 5). A control added later that breaks a rule
 * fails here without anyone having to remember to test it.
 */

/** The accessible name, by the mechanisms this app uses. Replace with `computeAccessibleName` if available. */
function nameOf(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label')
  if (aria !== null) return aria.trim()
  const label = el.closest('label')
  if (label !== null && el.tagName === 'SELECT') return (label.firstChild?.textContent ?? label.textContent ?? '').trim()
  const text = el.textContent?.trim() ?? ''
  if (text !== '') return text
  return el.title.trim()
}

/** A name with no letter or digit in it is a glyph, whatever it looks like. */
const isGlyph = (s: string) => !/[\p{L}\p{N}]/u.test(s)

function controls(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('button, select')].filter((el) => {
    if ((el as HTMLButtonElement).hidden) return false
    const popover = el.closest<HTMLElement>('[popover]')
    return popover === null || popover.matches(':popover-open')
  })
}

function check(where: string): void {
  for (const el of controls()) {
    const name = nameOf(el)
    const id = `${where}: <${el.tagName.toLowerCase()} class="${el.className}"> named ${JSON.stringify(name)}`
    expect(name, id).not.toBe('')
    expect(isGlyph(name), `${id} is a bare glyph`).toBe(false)
    const visible = el.tagName === 'SELECT' ? name : (el.textContent?.trim() ?? '')
    if (visible !== '' && !isGlyph(visible)) expect([visible, el.title.trim()], `${id}: name ≠ label or tooltip`).toContain(name)
    else expect(el.title.trim(), `${id}: a glyph-only control's tooltip must be its name`).toBe(name)
    expect(el.tabIndex, `${id} is out of the tab order`).toBeGreaterThanOrEqual(0)
  }
}

beforeAll(async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  // A copy, so the copies menu has rows and a view shows a copy's controls.
  document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')?.click()
  await until(() => (document.querySelector('[data-leaf="lambda-0"] .view-title')?.textContent ?? '').includes('copy'), 'the copy')
})

describe('every control in Explorer', () => {
  it('on the page as it stands', () => check('page'))

  it.each([
    ['#workspace'],
    ['#add-view'],
    ['#buffers'],
    ['#settings'],
    ['[data-leaf="lambda-0"] button.view-title'],
    ['[data-leaf="lambda-0"] button.view-more'],
    ['[data-leaf="tm-0"] button.view-title'],
    ['[data-leaf="tm-0"] button.view-more'],
  ])('with %s open', (selector) => {
    const button = document.querySelector<HTMLButtonElement>(selector)
    expect(button, selector).not.toBeNull()
    button?.click()
    check(selector)
    const menu = document.getElementById(button?.getAttribute('aria-controls') ?? '')
    if (menu?.matches(':popover-open')) menu.hidePopover()
  })
})
```

- [ ] **Step 2: Run it, and fix what it finds**

Run: `PATH="/usr/sbin:$PATH" pnpm exec vitest run --project browser tests/browser/controls-gate.test.ts`
Expected: PASS. If a control fails, fix the CONTROL (its name, label or tooltip) in `src`, not the gate — each failure is an instance of the class this task exists to close. Record every fix in the task's report.

- [ ] **Step 3: Sabotage, once each**

1. Remove `step-controls.ts`'s `aria-label` on `◀`. Expect the gate red naming `◀` a bare glyph. Revert.
2. Give `view-close` an `aria-label` that differs from its `title`. Expect the gate red. Revert.

- [ ] **Step 4: Commit**

```bash
pnpm exec biome ci --error-on-warnings tests/browser/controls-gate.test.ts
git add web/tests/browser/controls-gate.test.ts web/src
git commit -m "Every button and select on the page, with every menu open, has a name in words that matches its label or tooltip and a place in the tab order"
```

---

### Task 13: Verify the whole branch, and write the roadmap entry

- [ ] **Step 1: What CI runs, locally, under a memory cap**

From the repo root, in a detached unit so a harness kill cannot take it down:

```bash
systemd-run --user --unit=part2a-verify -p MemoryMax=16G -p MemorySwapMax=0 \
  --setenv=PATH="/usr/sbin:$PATH" --setenv=CARGO_HOME="$CARGO_HOME" --setenv=RUSTUP_HOME="$RUSTUP_HOME" --setenv=HOME="$HOME" \
  --working-directory="$PWD" bash -c '
    set -x
    scripts/check-all.sh
    cargo llvm-cov nextest --workspace --fail-under-lines 90
    scripts/check-slow.sh
    for s in text-bytes citations attributions doc-figures shared-docs lua colours; do scripts/check-$s.sh --self-test && scripts/check-$s.sh; done
    cd web && pnpm run build:wasm && pnpm exec biome ci --error-on-warnings && pnpm run typecheck && pnpm run test:coverage && pnpm run build:app
  ' > "$SCRATCH/part2a-verify.log" 2>&1
```

(`$SCRATCH` is the executing session's scratchpad directory. `check-colours.sh` joined the hygiene scans in part 1; confirm the list against `.forgejo/workflows/ci.yml`'s `linear-history` job before running.) Wait for the unit to finish; every step exits 0.

- [ ] **Step 2: The visual check by hand**

`pnpm run dev` from `web/`; at 1440×900 and at 800×600, in light and in dark, under Instrument, Paper and Terminal: the header on one line at 1440 and wrapping cleanly at 800; each view's header (title, status, step controls, `⋯`, `✕`); the `⋯` menu, the title menu, the copies menu, the settings menu opening beside their buttons; a delete's undo notice; the strip on one line. Save screenshots to the scratchpad (not the tree). Record what was checked in the roadmap entry (spec §14 item 8).

- [ ] **Step 3: The roadmap entry**

Append to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, in the shape of the entries above it: `#### TITLE (2026-MM-DD, branch \`plan7-part2a-view-chrome\`, \`13db3b7..SHA\`, N commits, plus this entry)` — the range covers every commit before the entry's own. Sections: what 2a built; what the pre-flight build of this plan found; what the reviews found; deviations from the spec and why; **the accessibility list** — items 1, 6, 9, 10, 13 and 14 closed, and item 7's part 2 half, each with the test that holds it; what this did not close (2b's presets, switches, bar, inspector and Stage; the TM rules panel's viewport-relative height, part 4); VERIFICATION, ending with "Every count this entry quotes, with what produces it" — one row per figure, each command re-run before the entry is committed. Write it LAST, after the final code commit, and anchor its range then.

- [ ] **Step 4: Commit the entry**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Roadmap: Plan 7 part 2a, view chrome and vocabulary"
```

