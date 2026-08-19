# The Divider Drag Is A Gesture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make a divider drag track the pointer for its whole length instead of dying on its first
frame, and make a resize gesture write `localStorage` once instead of once per frame.

**Architecture:** a resize gesture gets a cheap per-frame path — `setTree(resize(...))` →
`syncSizes(root, tree)` → `draw()` — and exactly one commit (`applyLayout()`) when the gesture ends.
`syncSizes` is a new `layout-view.ts` export that writes `flex` and `aria-valuenow` onto the already-
rendered box tree without creating or destroying an element, which is what stops the drag from
destroying the divider it is being performed with. `renderLayout`'s fourth parameter becomes a
`{ resize, commit }` pair.

**Tech Stack:** TypeScript, Vite, Vitest (browser tier on Playwright/Chromium + node tier), Biome,
CodeMirror 6. No new dependencies.

**Design:** [`../specs/2026-08-18-divider-drag-gesture-design.md`](../specs/2026-08-18-divider-drag-gesture-design.md)

## Global Constraints

- **Doc comments are `/** */` in TypeScript**, never `///`. That spelling is inert in TS.
- **`pre-commit run --all-files` gates every commit** — control bytes, file:line citations in source,
  `cargo fmt`, `cargo clippy -D warnings`, `biome ci`, `web typecheck`. Never `--no-verify`. If a task's
  commit split turns out to be infeasible under the gate, collapse the commits and say so in the report.
- **No `file:line` citations in `web/src/`.** Cite a symbol name instead (`layout.ts`'s
  `MIN_PANE_FRACTION`), which is what the citation gate enforces and what survives an edit above it.
- **Coverage gate is enforced** at `{lines: 97, functions: 97, branches: 89, statements: 95}` and the
  convention floor is the branch's running baseline (95.57 / 89.88 / 98.51 / 98.08 as of plan5d-iv).
  Check with `pnpm run test:coverage` before the final commit, not after.
- **Run web commands from `web/`.** `pnpm test` is the whole suite; `pnpm vitest run --project browser
  tests/browser/<file>` scopes to one file. A bare `-- <name>` filter does NOT scope files.
- **Baseline going in:** `pnpm test` → **655 passed in 68 files**, measured on this branch at `6432ef8`.
  (plan5d-iv's closing entry says 653; it is wrong at its own commit. Do not carry that number.)

---

### Task 1: `renderLayout` takes a handler pair

**Files:**
- Modify: `web/src/layout-view.ts` (`renderLayout`, `build`, `divider` — parameter threading only)
- Modify: `web/src/pane-host.ts` (the `renderLayout` call inside `applyLayout`'s `finally`)
- Test: `web/tests/browser/layout-view.test.ts` (11 call sites, mechanical)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export interface ResizeHandlers { resize(path: number[], index: number, delta: number):
  void; commit(): void }` and `renderLayout(root, tree, hosts, handlers: ResizeHandlers)`. Every later
  task depends on this shape.

**Behaviour does not change in this task.** `resize` does exactly what the old `onResize` argument did
— `setTree(resize(...))` followed by `applyLayout()` — and `commit` is wired but never called, because
nothing calls it until Task 3. This task exists on its own so the signature churn across 11 test call
sites gets its own review gate, separate from the behaviour change that needs it. The suite must be
green at the end of it, with the drag still broken.

- [ ] **Step 1: Change `renderLayout`'s signature to a handler pair**

In `web/src/layout-view.ts`, above `renderLayout`:

```ts
/**
 * The two things a resize gesture reports: its frames, and its end.
 *
 * A PAIR RATHER THAN ONE CALLBACK WITH A PHASE ARGUMENT. `divider()` needs both regardless, and the
 * alternative — `resize(path, index, delta, phase)` — is a trailing flag every call site has to decode
 * at the point where it is least readable.
 *
 * THE SPLIT IS WHAT MAKES THE CHEAP PATH POSSIBLE. `resize` is called at pointer rate and must not
 * rebuild anything; `commit` runs once, at the end, and is where reconciliation and persistence belong.
 */
export interface ResizeHandlers {
  /** One frame of a gesture: the model should change by `delta`, and the DOM should reflect it cheaply. */
  resize(path: number[], index: number, delta: number): void
  /** The gesture is over: reconcile the panes and persist the tree, once. */
  commit(): void
}
```

Change `renderLayout`'s fourth parameter and thread it through `build` and `divider`:

```ts
export function renderLayout(
  root: HTMLElement,
  tree: LayoutNode,
  hosts: Map<LeafId, HTMLElement>,
  handlers: ResizeHandlers,
): void {
```

Replace every internal `onResize: (path: number[], index: number, delta: number) => void` parameter on
`build` and `divider` with `handlers: ResizeHandlers`, and every `onResize` argument passed down with
`handlers`.

In `web/src/pane-host.ts`, replace the `renderLayout` call inside `applyLayout`'s `finally`. **The body
of `resize` is exactly what the old callback did — this task changes the shape and nothing else:**

```ts
      renderLayout(root, getTree(), hosts, {
        resize: (path, index, delta) => {
          setTree(resize(getTree(), path, index, delta))
          applyLayout()
        },
        commit: () => applyLayout(),
      })
```

`commit` is wired and unreachable: nothing calls it until Task 3 gives `divider()` a gesture end. That
is the intended state — the drag is still broken at the end of this task, in exactly the way Task 3
Step 1 reproduces.

`resize` is already imported into `pane-host.ts` from `./layout` (it is what the old callback called);
confirm with `grep -n "from './layout'" src/pane-host.ts` and add it to the import list if not.


- [ ] **Step 2: Update the 11 call sites in `layout-view.test.ts`**

Add a helper at the top of the file, beside `host`, so the no-op case does not repeat itself:

```ts
/** Handlers that record nothing — for the tests that assert geometry rather than reporting. */
const inert = (): ResizeHandlers => ({ resize: () => {}, commit: () => {} })
```

Import the type: `import { KEY_STEP, renderLayout, type ResizeHandlers } from '../../src/layout-view'`.

The six calls passing `() => {}` become `inert()`. The three that record become
`{ resize: (path, index, delta) => calls.push({ path, index, delta }), commit: () => {} }`, and the one
recording only `path`/`index` keeps its own shape with `commit: () => {}` added. The call inside the
focus-rescue test takes `inert()` at both of its two `renderLayout` calls.

- [ ] **Step 3: Run the suite to verify nothing changed**

Run: `cd web && pnpm test`

Expected: PASS, **655 in 68 files** — the baseline, unchanged. This task adds no tests and fixes nothing.

- [ ] **Step 4: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/layout-view.ts web/src/pane-host.ts web/tests/browser/layout-view.test.ts
git commit -m "layout-view: renderLayout reports a resize gesture's frames and its end separately"
```

---

### Task 2: `syncSizes` — write sizes onto the tree that is already rendered

**Files:**
- Modify: `web/src/layout-view.ts` (add `syncSizes` + `CHILD_STRIDE`, directly below `build`)
- Test: `web/tests/browser/layout-view.test.ts`

**Interfaces:**
- Consumes: `LayoutNode` from `./layout` (already imported by `layout-view.ts`).
- Produces: `export function syncSizes(root: HTMLElement, tree: LayoutNode): void` — Task 3 is what
  calls it. Also `const CHILD_STRIDE = 2`, module-private.

Nothing calls `syncSizes` at the end of this task. It ships green and unused, and Task 3 wires it up.
That is deliberate: it means the DOM-walking logic gets its own review gate separate from the gesture
rewiring, and a reviewer can reject one while approving the other. The drag is still broken here.

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/browser/layout-view.test.ts`, inside the existing `describe('renderLayout', ...)`
block's closing brace — i.e. as a new sibling `describe` at the end of the file:

```ts
describe('syncSizes', () => {
  it('moves flex on both neighbours of the addressed divider and leaves the rest alone', () => {
    renderLayout(root, defaultLayout(), hosts, inert())
    const moved = resize(defaultLayout(), [0], 0, 0.2)

    syncSizes(root, moved)

    // `defaultLayout()`'s inner row split is source | lambda-0 at 0.5/0.5; +0.2 makes it 0.7/0.3.
    const source = root.querySelector<HTMLElement>('[data-leaf="source"]')
    const lambda = root.querySelector<HTMLElement>('[data-leaf="lambda-0"]')
    const tm = root.querySelector<HTMLElement>('[data-leaf="tm-0"]')
    expect(source?.style.flex).toBe('0.7 1 0')
    expect(lambda?.style.flex).toBe('0.3 1 0')
    // The outer column split was not addressed, so tm-0 keeps the half it had.
    expect(tm?.style.flex).toBe('0.5 1 0')
  })

  it('updates aria-valuenow on the divider, which would otherwise freeze at its build-time value', () => {
    renderLayout(root, defaultLayout(), hosts, inert())
    const divider = root.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]')
    expect(divider?.getAttribute('aria-valuenow')).toBe('50')

    syncSizes(root, resize(defaultLayout(), [0], 0, 0.2))

    expect(divider?.getAttribute('aria-valuenow')).toBe('70')
  })

  it('does not replace a single element — the identity a drag depends on survives', () => {
    renderLayout(root, defaultLayout(), hosts, inert())
    const divider = root.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]')
    const source = root.querySelector<HTMLElement>('[data-leaf="source"]')

    syncSizes(root, resize(defaultLayout(), [0], 0, 0.2))

    // Object identity, not equality. This is the whole point of `syncSizes` existing: `renderLayout`
    // would have built a NEW divider with the same path/index, and the drag's own closure would have
    // died with the old one.
    expect(root.querySelector('[role="separator"][aria-orientation="vertical"]')).toBe(divider)
    expect(root.querySelector('[data-leaf="source"]')).toBe(source)
  })

  it('throws rather than repairing when the DOM does not match the model', () => {
    renderLayout(root, defaultLayout(), hosts, inert())
    // A three-way split against a DOM built for a two-way one: the caller took the cheap path when a
    // rebuild was required, which is a programming error and not a state to paper over.
    const wider: LayoutNode = {
      kind: 'split',
      dir: 'column',
      sizes: [0.3, 0.3, 0.4],
      children: [
        { kind: 'leaf', id: 'source', pane: 'source' },
        { kind: 'leaf', id: 'lambda-0', pane: 'lambda' },
        { kind: 'leaf', id: 'tm-0', pane: 'tm' },
      ],
    }
    expect(() => syncSizes(root, wider)).toThrow(/syncSizes/)
  })

  it('accepts a single-leaf tree, which has no split to walk', () => {
    const solo: LayoutNode = { kind: 'leaf', id: 'tm-0', pane: 'tm' }
    renderLayout(root, solo, hosts, inert())
    expect(() => syncSizes(root, solo)).not.toThrow()
  })
})
```

Extend the file's imports — `resize` from `./layout`, `syncSizes` from `./layout-view`:

```ts
import { defaultLayout, type LayoutNode, resize } from '../../src/layout'
import { KEY_STEP, renderLayout, type ResizeHandlers, syncSizes } from '../../src/layout-view'
```

The existing `renderLayout` call sites in this file already take the handler pair — Task 1 converted
them. The new tests above use `inert()`, the helper Task 1 added.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm vitest run --project browser tests/browser/layout-view.test.ts`

Expected: FAIL. `syncSizes` is not exported yet, so the file fails to resolve the import — the error
names `syncSizes`, not an assertion.

- [ ] **Step 3: Add `syncSizes` to `layout-view.ts`**

Insert directly below the `build` function (so the two sit adjacent and cannot drift on how the DOM
interleaves panes and dividers):

```ts
/**
 * How many DOM children `build` emits per model child: the child itself, then a divider after every
 * one but the last.
 *
 * DEFINED HERE, BESIDE `build`, BECAUSE `syncSizes` BELOW IS THE ONLY OTHER THING THAT KNOWS THE
 * INTERLEAVING. `build` expresses it by appending in order and never indexing; `syncSizes` has to index
 * into a tree it did not create. That is one fact in two places, and this constant plus this comment is
 * what keeps them from drifting the day a divider gains a sibling.
 */
const CHILD_STRIDE = 2

/**
 * Write the model's sizes onto the tree `renderLayout` already built — WITHOUT creating or destroying
 * a single element.
 *
 * THIS EXISTS BECAUSE A DRAG CANNOT SURVIVE ITS OWN RE-RENDER. `renderLayout` opens with
 * `root.replaceChildren()`, so calling it from a `pointermove` handler destroys the divider the drag is
 * being performed with, on the drag's own first frame: the replacement element carries a fresh closure
 * whose `dragging` is `false`, every later frame returns immediately, and pointer capture is released
 * implicitly the moment the captured element leaves the document. Measured before this function
 * existed: a drag moved exactly one `pointermove`'s worth and then stopped. Design §1 carries the
 * transcript.
 *
 * `aria-valuenow` IS WRITTEN HERE AND THAT IS NOT A COURTESY. `divider()` sets it once, from the size
 * it is handed at build time, and it stays truthful today only because the whole tree is rebuilt after
 * every resize. A cheap path that moved `flex` and not `aria-valuenow` would leave every divider
 * reporting the fraction it was born with — a silent regression in the one part of this subsystem
 * deliberately exempted from Plan 5's deferred accessibility pass.
 *
 * IT THROWS ON A SHAPE MISMATCH RATHER THAN REPAIRING ONE. A model whose splits do not match the
 * rendered boxes means the caller took this path when it owed a `renderLayout`, which is a programming
 * error. `LambdaPane.receiveEditor` made the same call for the same reason: a silent repair absorbs the
 * finding as normal operation.
 */
export function syncSizes(root: HTMLElement, tree: LayoutNode): void {
  const rendered = root.firstElementChild
  if (!(rendered instanceof HTMLElement)) throw new Error('syncSizes: nothing is rendered under root')
  syncNode(tree, rendered)
}

function syncNode(node: LayoutNode, el: HTMLElement): void {
  if (node.kind === 'leaf') return

  const count = node.children.length
  node.children.forEach((child, i) => {
    const childEl = el.children[i * CHILD_STRIDE]
    if (!(childEl instanceof HTMLElement)) {
      throw new Error(`syncSizes: no element for child ${i} of a ${count}-way split`)
    }
    childEl.style.flex = `${node.sizes[i] ?? 1 / count} 1 0`

    if (i < count - 1) {
      const divider = el.children[i * CHILD_STRIDE + 1]
      if (!(divider instanceof HTMLElement) || !divider.classList.contains('layout-divider')) {
        throw new Error(`syncSizes: no divider after child ${i} of a ${count}-way split`)
      }
      divider.setAttribute('aria-valuenow', String(Math.round((node.sizes[i] ?? 0) * 100)))
    }

    syncNode(child, childEl)
  })
}
```

`syncSizes` is exported and nothing calls it. That is the intended end state of this task: the DOM-
walking logic gets its own review gate, and Task 3 is where it starts running.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && pnpm vitest run --project browser tests/browser/layout-view.test.ts`

Expected: PASS, all five new tests plus the file's existing ones.

- [ ] **Step 5: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/layout-view.ts web/tests/browser/layout-view.test.ts
git commit -m "layout-view: syncSizes writes sizes onto the rendered tree without replacing an element"
```

---

### Task 3: The gesture — reproduce the dead drag, then make it track

**Files:**
- Create: `web/tests/browser/divider-drag.test.ts`
- Modify: `web/src/layout-view.ts` (the `divider` function's pointer listeners)
- Modify: `web/src/pane-host.ts` (the `resize` handler inside `applyLayout`'s `finally`)

**Interfaces:**
- Consumes: `ResizeHandlers` from Task 1, `syncSizes` from Task 2.
- Produces: `mountApp()`, `freshMain()`, `rootEl()`, `verticalDivider()`, `storedRowSizes()` and
  `pointer(type, x)` in `divider-drag.test.ts`. Tasks 4 and 5 reuse all six unchanged.

- [ ] **Step 1: Write the failing regression test**

Create `web/tests/browser/divider-drag.test.ts`:

```ts
import type { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LAYOUT_STORAGE_KEY, parseLayout } from '../../src/layout'

/**
 * A DIVIDER DRAG, THROUGH `main()` — the test 5d-ii-a said did not exist, and the reason a broken drag
 * survived every slice since.
 *
 * That entry filed the gap in as many words: "no test drags a divider on a tree `main()` mounted and
 * then reads back what was stored." `layout-view.test.ts` drags one, but against a stub `onResize` that
 * never re-renders — so the divider it grabs stays alive for the whole test, which is precisely the
 * condition the real app does not provide.
 *
 * THE DEFECT THIS FILE PINS. `pointermove` reached `applyLayout` -> `renderLayout` ->
 * `replaceChildren()`, destroying the divider holding the drag on its own first frame. A drag moved one
 * frame's worth and then stopped dead. Test 1 below is the direct guard: the grabbed node is still in
 * the document after every move.
 */

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

/**
 * A genuinely fresh module instance of `main.ts` per mount, by cache-busting query string.
 *
 * `main.ts` computes `ready` once at import evaluation and does not export `main`, so a second bare
 * import returns the same cached module and mounts nothing. Vite's dev server keys its module graph on
 * the full specifier including the query, so `?remount=N` is a distinct module realm. This is
 * `tm-buffer-restore.test.ts`'s mechanism verbatim; that file's own doc carries the long form.
 */
let remountSeq = 0
async function freshMain(): Promise<{ ready: Promise<EditorView> }> {
  const spec = remountSeq === 0 ? '../../src/main' : `../../src/main?remount=${remountSeq}`
  remountSeq += 1
  return import(/* @vite-ignore */ spec)
}

async function mountApp(): Promise<void> {
  localStorage.clear()
  document.body.innerHTML = SHELL
  await (await freshMain()).ready
}

const rootEl = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('main')
  if (el === null) throw new Error('no main element')
  return el
}

/** The vertical divider — the one inside the source|λ row split, addressed as path [0] index 0. */
const verticalDivider = (): HTMLElement => {
  const el = rootEl().querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]')
  if (el === null) throw new Error('no vertical divider')
  return el
}

/** The stored inner-row sizes — what a drag on the vertical divider moves. */
const storedRowSizes = (): number[] => {
  const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
  if (raw === null) throw new Error('nothing stored')
  const tree = parseLayout(raw)
  if (tree === null || tree.kind !== 'split') throw new Error('stored tree is not a split')
  const inner = tree.children[0]
  if (inner === undefined || inner.kind !== 'split') throw new Error('stored inner node is not a split')
  return inner.sizes
}

const pointer = (type: string, x: number): PointerEvent =>
  new PointerEvent(type, { bubbles: true, clientX: x, clientY: 300, pointerId: 1 })

describe('dragging a divider on a mounted app', () => {
  beforeEach(async () => {
    await mountApp()
  })

  it('does not destroy the divider being dragged', () => {
    const divider = verticalDivider()
    divider.dispatchEvent(pointer('pointerdown', 400))

    for (const x of [420, 440, 460]) {
      divider.dispatchEvent(pointer('pointermove', x))
      // The whole defect, in one assertion. Before the fix this is `false` after the FIRST move.
      expect(rootEl().contains(divider)).toBe(true)
    }

    divider.dispatchEvent(pointer('pointerup', 460))
  })

  it('tracks the pointer for the whole drag, not one frame of it', () => {
    const divider = verticalDivider()
    const span = divider.parentElement?.getBoundingClientRect().width ?? 0
    expect(span).toBeGreaterThan(0)

    divider.dispatchEvent(pointer('pointerdown', 400))
    for (const x of [420, 440, 460]) divider.dispatchEvent(pointer('pointermove', x))
    divider.dispatchEvent(pointer('pointerup', 460))

    // 60px of travel against the measured split extent. Before the fix only the first 20px landed.
    const [first] = storedRowSizes()
    expect(first).toBeCloseTo(0.5 + 60 / span, 3)
  })

  it('writes storage once for the gesture, not once per frame', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const divider = verticalDivider()

    divider.dispatchEvent(pointer('pointerdown', 400))
    for (const x of [420, 440, 460]) divider.dispatchEvent(pointer('pointermove', x))
    const midDrag = setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length
    divider.dispatchEvent(pointer('pointerup', 460))
    const total = setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length

    expect(midDrag).toBe(0)
    expect(total).toBe(1)
    setItem.mockRestore()
  })

  it('keeps aria-valuenow truthful during the drag, not only after it', () => {
    const divider = verticalDivider()
    expect(divider.getAttribute('aria-valuenow')).toBe('50')

    divider.dispatchEvent(pointer('pointerdown', 400))
    divider.dispatchEvent(pointer('pointermove', 480))

    // Mid-gesture, before any commit. `syncSizes` is the only thing that could have written this.
    expect(Number(divider.getAttribute('aria-valuenow'))).toBeGreaterThan(50)
    divider.dispatchEvent(pointer('pointerup', 480))
  })

  it('writes nothing for a press and release that never moved', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const divider = verticalDivider()

    divider.dispatchEvent(pointer('pointerdown', 400))
    divider.dispatchEvent(pointer('pointerup', 400))

    expect(setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length).toBe(0)
    setItem.mockRestore()
  })
})
```

- [ ] **Step 2: Run it and CAPTURE the failure — do not paraphrase it**

Run: `cd web && pnpm vitest run --project browser tests/browser/divider-drag.test.ts`

Expected: FAIL, at minimum tests 1, 2 and 3. Test 1 fails on `expected false to be true` at the first
loop iteration.

**Paste the verbatim failure output into the task report.** This repo's convention is that a defect is
reproduced against the unfixed source rather than reasoned about; the closing entry quotes this
transcript.

- [ ] **Step 3: Verify the reproduction is the mechanism the design names, not a coincidence**

Run the same command with the assertion in test 1 temporarily inverted to `toBe(false)`. Expected: it
PASSES — confirming the divider is genuinely gone after move 1 rather than the test being wrong about
what it grabbed. Restore the assertion to `toBe(true)` before moving on.

- [ ] **Step 4: Wire the cheap per-frame path in `pane-host.ts`**

Add `syncSizes` to the existing `layout-view` import:

```ts
import { renderLayout, syncSizes } from './layout-view'
```

and replace the `resize` handler Task 1 left in `applyLayout`'s `finally`:

```ts
      renderLayout(root, getTree(), hosts, {
        // THE CHEAP PATH — NO `renderLayout`, NO PERSIST. Nothing structural changes during a resize:
        // `resize` touches `sizes` on exactly one split node, so no pane is created, destroyed or
        // rebound as a consequence, and rebuilding would destroy the divider performing the gesture.
        // `draw()` STAYS, and it is the one thing here whose output genuinely depends on pane size —
        // the TM pane's δ-table is virtualized against a measured `clientHeight`, so dropping it would
        // show blank space below the last row for the length of the drag.
        resize: (path, index, delta) => {
          setTree(resize(getTree(), path, index, delta))
          syncSizes(root, getTree())
          draw()
        },
        // ONE FULL RECONCILE PER GESTURE, WHICH IS WHERE THE STORAGE WRITE LIVES NOW.
        commit: () => applyLayout(),
      })
```

- [ ] **Step 5: Give `divider()` the gesture, not just the frames**

Replace `divider`'s pointer block. The `moved` flag is what makes a bare click commit nothing:

```ts
  let dragging = false
  let moved = false
  let last = 0

  el.addEventListener('pointerdown', (e) => {
    dragging = true
    moved = false
    last = dir === 'row' ? e.clientX : e.clientY
    // BEFORE `setPointerCapture`, NOT AFTER. Capture throws `NotFoundError` for a synthetic
    // `PointerEvent` with no active pointer — which is exactly what every test in this suite
    // dispatches — and a throw here would skip whatever followed it. `preventDefault` is what stops a
    // drag from selecting text across the panes, so it must not be the thing that gets skipped.
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
  })

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const now = dir === 'row' ? e.clientX : e.clientY
    const span = extent()
    if (span > 0) {
      handlers.resize(path, index, (now - last) / span)
      moved = true
    }
    last = now
  })

  // THE END OF THE GESTURE IS WHERE THE LAYOUT IS COMMITTED — see `ResizeHandlers`. A press and
  // release that never moved commits nothing rather than firing a full reconcile-and-write for a no-op.
  const stop = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (moved) handlers.commit()
    moved = false
  }
  el.addEventListener('pointerup', stop)
  el.addEventListener('pointercancel', stop)
```

- [ ] **Step 6: Run the regression test to verify it passes**

Run: `cd web && pnpm vitest run --project browser tests/browser/divider-drag.test.ts`

Expected: PASS, all five.

- [ ] **Step 7: Run the whole suite**

Run: `cd web && pnpm test`

Expected: PASS. Baseline was 655 in 68 files; Task 2 added 5 to an existing file and this task adds 5
in a new one, so expect **665 in 69 files**. If `pane-kind-switch.test.ts` or `layout-app.test.ts` fail,
read the failure before changing anything — they assert append order and persistence, both of which this
touches.

- [ ] **Step 8: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/layout-view.ts web/src/pane-host.ts web/tests/browser/divider-drag.test.ts
git commit -m "divider drag: a gesture has frames and an end, and the frames stop destroying the divider"
```

---

### Task 4: The keyboard path takes the identical shape

**Files:**
- Modify: `web/src/layout-view.ts` (`divider`'s `keydown`, plus new `keyup` and `blur`)
- Modify: `web/src/layout-view.ts` (`renderLayout`'s focus-rescue doc comment — see Step 4)
- Modify: `web/tests/browser/layout-view.test.ts` (one doc comment — see Step 4)
- Test: `web/tests/browser/divider-drag.test.ts`

**Interfaces:**
- Consumes: `ResizeHandlers` and `syncSizes` from Tasks 2 and 3. Adds nothing new.

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/browser/divider-drag.test.ts`, as a new `describe` at the end:

```ts
describe('resizing a divider from the keyboard', () => {
  beforeEach(async () => {
    await mountApp()
  })

  const key = (type: string, k: string): KeyboardEvent => new KeyboardEvent(type, { key: k, bubbles: true })

  it('moves once per keydown and writes once per keyup, not once per keydown', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const divider = verticalDivider()
    divider.focus()

    // Auto-repeat: a held arrow key sends many keydowns and exactly one keyup.
    for (let i = 0; i < 3; i += 1) divider.dispatchEvent(key('keydown', 'ArrowRight'))
    const held = setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length
    divider.dispatchEvent(key('keyup', 'ArrowRight'))
    const released = setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length

    expect(held).toBe(0)
    expect(released).toBe(1)
    expect(storedRowSizes()[0]).toBeCloseTo(0.5 + 3 * KEY_STEP, 5)
    setItem.mockRestore()
  })

  it('commits on blur, so a layout is not lost when focus leaves mid-hold', () => {
    const divider = verticalDivider()
    divider.focus()
    divider.dispatchEvent(key('keydown', 'ArrowRight'))
    divider.dispatchEvent(new FocusEvent('blur', { bubbles: false }))

    expect(storedRowSizes()[0]).toBeCloseTo(0.5 + KEY_STEP, 5)
  })

  it('writes nothing when a key that is not an arrow is pressed and released', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    const divider = verticalDivider()
    divider.focus()

    divider.dispatchEvent(key('keydown', 'Enter'))
    divider.dispatchEvent(key('keyup', 'Enter'))

    expect(setItem.mock.calls.filter((c) => c[0] === LAYOUT_STORAGE_KEY).length).toBe(0)
    setItem.mockRestore()
  })

  it('keeps the focused divider focusable across a whole held press', () => {
    const divider = verticalDivider()
    divider.focus()
    for (let i = 0; i < 3; i += 1) {
      divider.dispatchEvent(key('keydown', 'ArrowRight'))
      // Before this slice each keydown rebuilt the tree and `renderLayout`'s rescue re-focused a NEW
      // node. Now the node itself survives, which is a stronger statement than "something has focus".
      expect(document.activeElement).toBe(divider)
    }
    divider.dispatchEvent(key('keyup', 'ArrowRight'))
  })
})
```

Add `KEY_STEP` to the file's imports:

```ts
import { KEY_STEP } from '../../src/layout-view'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm vitest run --project browser tests/browser/divider-drag.test.ts`

Expected: FAIL. The first test fails on `expected 3 to be 0` — every keydown currently persists,
because `keydown` still routes through the committing path.

- [ ] **Step 3: Give the keyboard the same gesture shape**

Replace `divider`'s `keydown` listener and add two more:

```ts
  // THE KEYBOARD PATH — design §6.2's first exception. `Home`/`End` are deliberately absent: they
  // would mean "collapse this pane to its floor", which is a thing the close control already says
  // better and unambiguously.
  //
  // IT IS A GESTURE, EXACTLY LIKE A DRAG. Auto-repeat sends many `keydown`s and one `keyup`, so a held
  // arrow key is N cheap frames and one storage write rather than N full rebuilds — the same shape the
  // pointer path takes above, for the same reason.
  let keyMoved = false

  el.addEventListener('keydown', (e) => {
    const forward = dir === 'row' ? 'ArrowRight' : 'ArrowDown'
    const back = dir === 'row' ? 'ArrowLeft' : 'ArrowUp'
    if (e.key === forward) handlers.resize(path, index, KEY_STEP)
    else if (e.key === back) handlers.resize(path, index, -KEY_STEP)
    else return
    keyMoved = true
    e.preventDefault()
  })

  // `blur` COMMITS TOO, AND IT IS NOT BELT-AND-BRACES. `keyup` never arrives if focus leaves while the
  // key is down — a click into a pane, a `Tab` chord, the window losing focus — and the frames already
  // moved the model, so without this the tree on screen and the tree in storage disagree until the next
  // unrelated `applyLayout` happens to reconcile them.
  const commitKeys = (): void => {
    if (!keyMoved) return
    keyMoved = false
    handlers.commit()
  }
  el.addEventListener('keyup', commitKeys)
  el.addEventListener('blur', commitKeys)
```

- [ ] **Step 4: Repair the two doc comments this task makes false**

In `web/src/layout-view.ts`, `renderLayout`'s focus-rescue comment currently reads:

> `onResize`'s caller re-renders after every resize, which is the natural way to reflect one, so
> without this rescue the FIRST arrow-key press would move the divider, destroy the element focus is
> sitting on, and drop focus to `<body>` — the second press would then do nothing at all.

Replace that sentence with:

```
 * A RESIZE NO LONGER REBUILDS ANYTHING — `syncSizes` writes the new fractions onto the elements that
 * are already there, precisely so a gesture does not destroy the control performing it. What still
 * rebuilds is every STRUCTURAL change: `split`, `close`, `reset layout`, a restore. This rescue is what
 * keeps a keyboard user's place across those, and it used to be what kept the arrow keys working at
 * all — without it the FIRST arrow-key press moved the divider, destroyed the element focus was sitting
 * on, and dropped focus to `<body>`, so the second press did nothing. That is no longer the arrow keys'
 * failure mode, and the rescue is no longer the only thing standing between them and it.
```

In `web/tests/browser/layout-view.test.ts`, the test named *"keeps focus on the same divider across a
re-render"* carries a comment beginning *"The real caller re-renders after every `onResize` to reflect
it"*. Replace that comment with:

```ts
    // The real caller re-renders on every STRUCTURAL change — split, close, reset layout — which is what
    // destroys `before` and rebuilds it as a new node with the same path/index. It no longer re-renders
    // on a resize (`syncSizes` does that in place), so the key press below is standing in for a
    // structural rebuild rather than reproducing one. The rescue this test pins is unchanged; what
    // changed is which gestures reach it.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && pnpm vitest run --project browser tests/browser/divider-drag.test.ts tests/browser/layout-view.test.ts`

Expected: PASS. `layout-view.test.ts`'s existing *"reports a resize from the arrow keys"* test asserts
`resize` is called with `±KEY_STEP` and is unaffected — the frames still fire, only the commit moved.

- [ ] **Step 6: Commit**

```bash
cd /home/davey/projects/redextape
git add web/src/layout-view.ts web/tests/browser/divider-drag.test.ts web/tests/browser/layout-view.test.ts
git commit -m "divider keyboard resize: a held arrow key is one gesture, and two doc comments it makes false"
```

---

### Task 5: The reload round-trip — a carried-forward claim, discharged

**Files:**
- Modify: `web/tests/browser/divider-drag.test.ts`

**Interfaces:**
- Consumes: `freshMain` and `storedRowSizes` from Task 3's file. Adds a `remountApp` helper.

5d-ii-a filed *"reload, divider drag on the real page, and `MIN_PANE_FRACTION`"* as things it could not
establish, and 5d-ii-b, -c and -d each carried the sentence forward untouched. A drag that works is what
makes the reload half checkable.

- [ ] **Step 1: Write the failing test**

Add the helper beside `mountApp` in `web/tests/browser/divider-drag.test.ts`:

```ts
/** Simulate a reload: the same `localStorage`, a fresh page and a fresh module realm. */
async function remountApp(): Promise<void> {
  document.body.innerHTML = SHELL
  await (await freshMain()).ready
}
```

And append a new `describe`:

```ts
describe('a dragged layout across a reload', () => {
  it('comes back where it was dragged to', async () => {
    await mountApp()
    const divider = verticalDivider()
    const span = divider.parentElement?.getBoundingClientRect().width ?? 0
    expect(span).toBeGreaterThan(0)

    divider.dispatchEvent(pointer('pointerdown', 400))
    for (const x of [420, 440, 460]) divider.dispatchEvent(pointer('pointermove', x))
    divider.dispatchEvent(pointer('pointerup', 460))

    const dragged = storedRowSizes()[0]
    expect(dragged).toBeCloseTo(0.5 + 60 / span, 3)

    await remountApp()

    // The claim is about the PAGE, not about storage: storage was already asserted above. What this
    // adds is that the restored tree puts the fraction back on screen.
    expect(storedRowSizes()[0]).toBeCloseTo(dragged, 5)
    expect(verticalDivider().getAttribute('aria-valuenow')).toBe(String(Math.round(dragged * 100)))
  })
})
```

Note this `describe` calls `mountApp()` itself rather than relying on the `beforeEach` in the other
blocks — `remountApp` must not be preceded by a `localStorage.clear()`, which is the whole point.

- [ ] **Step 2: Run it**

Run: `cd web && pnpm vitest run --project browser tests/browser/divider-drag.test.ts`

Expected: PASS on the first run is the likely outcome, and that is fine — this test discharges a claim
nobody had checked rather than fixing a defect. **If it passes immediately, say so plainly in the task
report and do not manufacture a failure.** If it fails, that is a genuine finding: stop and report it
before changing anything, because it would mean restore and drag disagree.

- [ ] **Step 3: Commit**

```bash
cd /home/davey/projects/redextape
git add web/tests/browser/divider-drag.test.ts
git commit -m "divider drag: a dragged layout survives a reload — 5d-ii-a's carried claim, checked"
```

---

### Task 6: Measure `MIN_PANE_FRACTION`, and move the number only if the reading says so

**Files:**
- Create: `web/tests/browser/pane-floor.test.ts` (a probe, excluded from the default run)
- Modify: `web/vite.config.ts` (add the new file to `PROBE_FILES`)
- Modify: `web/package.json` (add a `test:probe:floor` script)
- Possibly modify: `web/src/layout.ts` (`MIN_PANE_FRACTION`'s value and doc, only if the reading says so)

**Interfaces:**
- Consumes: the working drag from Task 2. Produces a reading, and possibly a new value for
  `MIN_PANE_FRACTION`. Nothing imports anything new.

`layout.ts`'s `MIN_PANE_FRACTION` doc says the floor is a guess in as many words: *"0.1 IS A CHOICE, NOT
A MEASUREMENT ... Nothing was measured to pick it; if a pane turns out to be unusable at the floor, the
number moves."* Nobody could check it, because driving a pane to the floor requires a drag that works.

**The boundary, from design §9:** this task may change the floor's VALUE. It does not change its KIND.
A pixel floor puts pixels into `layout.ts`, and that module's node tier rests on having none — its own
doc: *"A FRACTION RATHER THAN A PIXEL COUNT, so this module needs no element measurements and stays
node-testable."* If the reading argues for a pixel floor, that is a finding to file with the numbers
behind it, not a change to make here.

- [ ] **Step 1: Write the probe**

Create `web/tests/browser/pane-floor.test.ts`. It mounts the app at three imposed widths, drags each
divider to the floor, and records what each pane kind actually shows there:

```ts
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { MIN_PANE_FRACTION } from '../../src/layout'

/**
 * WHAT A PANE LOOKS LIKE AT THE FLOOR — the measurement `MIN_PANE_FRACTION`'s own doc asks for and no
 * slice could take, because taking it requires a divider drag that survives past its first frame.
 *
 * A PROBE, NOT A TEST: it asserts almost nothing and prints numbers. `vite.config.ts` excludes it from
 * the default browser run for the reason every probe here is excluded — it is a measurement whose
 * output is a reading, and a reading that fails a suite is a reading nobody will take twice.
 *
 * THE WIDTHS ARE IMPOSED, AND THAT IS THE POINT RATHER THAN THE FLAW. 5d-ii-a's headline finding was
 * that a test container given a size the real page never gets is measuring a fiction — true of a test
 * asserting behaviour, and inapplicable here, where window width is the INDEPENDENT VARIABLE. A
 * fraction floor yields a different pixel floor at every width; that relationship is what is being
 * measured.
 */

const SHELL = `
  <header class="bar"><span class="wordmark">redextape</span>
    <button type="button" id="appearance"></button>
    <button type="button" id="restore-layout" aria-label="restore the default pane layout">reset layout</button>
    <button type="button" id="buffers">buffers</button>
    <label class="encoding">encoding <select id="encoding"></select></label>
  </header>
  <main></main>
  <div id="editor"></div>
  <div id="link-status" class="link-status"></div>
  <section id="results" class="pane results"></section>`

let remountSeq = 0
async function freshMain(): Promise<{ ready: Promise<EditorView> }> {
  const spec = remountSeq === 0 ? '../../src/main' : `../../src/main?remount=${remountSeq}`
  remountSeq += 1
  return import(/* @vite-ignore */ spec)
}

const WIDTHS = [900, 1200, 1920]

describe('a pane at the floor', () => {
  it('reports what each pane kind shows when driven to MIN_PANE_FRACTION', async () => {
    const rows: string[] = []

    for (const width of WIDTHS) {
      localStorage.clear()
      document.body.innerHTML = SHELL
      document.body.style.width = `${width}px`
      const root = document.querySelector<HTMLElement>('main')
      if (root === null) throw new Error('no main')
      root.style.width = `${width}px`
      const view = await (await freshMain()).ready
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })

      const divider = root.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]')
      if (divider === null) throw new Error('no vertical divider')
      const span = divider.parentElement?.getBoundingClientRect().width ?? 0

      // Drag hard left, far past the floor: `resize` clamps, so this lands the source pane exactly on it.
      divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 300, pointerId: 1 }))
      divider.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: -2000, clientY: 300, pointerId: 1 }))
      divider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: -2000, clientY: 300, pointerId: 1 }))

      const source = root.querySelector<HTMLElement>('[data-leaf="source"]')
      const lambda = root.querySelector<HTMLElement>('[data-leaf="lambda-0"]')
      const tm = root.querySelector<HTMLElement>('[data-leaf="tm-0"]')
      const px = (el: HTMLElement | null) => Math.round(el?.getBoundingClientRect().width ?? 0)
      const clipped = (el: HTMLElement | null) => (el === null ? 'n/a' : `${el.scrollWidth > el.clientWidth}`)

      rows.push(
        [
          `window ${width}px`,
          `split extent ${Math.round(span)}px`,
          `floor ${MIN_PANE_FRACTION} = ${Math.round(span * MIN_PANE_FRACTION)}px`,
          `source ${px(source)}px clipped=${clipped(source)}`,
          `lambda ${px(lambda)}px clipped=${clipped(lambda)}`,
          `tm ${px(tm)}px clipped=${clipped(tm)}`,
        ].join(' | '),
      )
    }

    // The probe's only assertion: it ran at every width. The reading is the deliverable.
    expect(rows.length).toBe(WIDTHS.length)
    throw new Error(`PANE FLOOR READING\n${rows.join('\n')}`)
  })
})
```

The trailing `throw` is how the reading reaches the terminal — the same reason `tm-fork-cost.test.ts`'s
own fix round surfaced its fourth measured cost. Remove it once the numbers are recorded, leaving the
`expect`.

- [ ] **Step 2: Register it as a probe**

In `web/vite.config.ts`, add the file to `PROBE_FILES`:

```ts
const PROBE_FILES = [
  'tests/browser/buffer-affordability.test.ts',
  'tests/browser/tm-fork-cost.test.ts',
  'tests/browser/pane-floor.test.ts',
]
```

In `web/package.json`'s `scripts`, beside the two existing probe scripts:

```json
    "test:probe:floor": "REDEXTAPE_PROBE=1 vitest run --project browser tests/browser/pane-floor.test.ts",
```

- [ ] **Step 3: Take the reading**

Run: `cd web && pnpm run test:probe:floor`

Expected: the `PANE FLOOR READING` block, three rows. **Paste it verbatim into the task report.**

- [ ] **Step 4: Confirm the probe is excluded from the default run**

Run: `cd web && pnpm test 2>&1 | grep -c pane-floor`

Expected: `0`. If the probe runs in the default suite it will fail it, which is exactly what
`PROBE_FILES` exists to prevent.

- [ ] **Step 5: Decide, and write the decision down either way**

Three outcomes, all legitimate:

1. **0.1 stands.** Every pane kind is usable at the floor at all three widths. Change nothing in
   `layout.ts` except its doc, which gains the reading and stops saying nothing was measured.
2. **0.1 is wrong and a fraction can still express the right answer.** Move the constant, update the
   doc with the reading, and check that `layout.test.ts`'s node tests and the `aria-valuemin` assertion
   in `layout-view.test.ts` still hold — both derive from `MIN_PANE_FRACTION` rather than hard-coding
   `0.1`, so they should, but confirm rather than assume.
3. **No single fraction is right across the three widths.** Do NOT convert to a pixel floor. Record the
   reading, pick the value that is least bad, and file the shape question for the roadmap entry with
   the numbers attached.

Whichever it is, `MIN_PANE_FRACTION`'s doc must stop containing the sentence *"Nothing was measured to
pick it"*, because after this task something was.

- [ ] **Step 6: Run the full suite and commit**

Run: `cd web && pnpm test`

Expected: PASS.

```bash
cd /home/davey/projects/redextape
git add web/tests/browser/pane-floor.test.ts web/vite.config.ts web/package.json web/src/layout.ts
git commit -m "pane floor: MIN_PANE_FRACTION stops being an unmeasured choice"
```

---

### Task 7: Verification, coverage, and the roadmap closing entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (append a closing entry)

**Interfaces:** none.

- [ ] **Step 1: Re-derive every figure at this branch's own commit**

Do not carry a number forward from an earlier task's report. This repo has shipped stale closing counts
twice and corrected them twice. Run all of these and record the actual output:

```bash
cd /home/davey/projects/redextape
cargo nextest run --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd web && pnpm test
cd web && pnpm run test:coverage
cd /home/davey/projects/redextape && pre-commit run --all-files
scripts/check-citations.sh --self-test
scripts/check-citations.sh
```

Expected: green throughout. The coverage figures must clear the enforced gate
(`{lines: 97, functions: 97, branches: 89, statements: 95}`) and should be at or above the convention
floor (95.57 / 89.88 / 98.51 / 98.08). If branches dropped, the likely cause is `syncSizes`'s two throw
arms — add the missing case to `layout-view.test.ts` rather than lowering anything.

- [ ] **Step 2: Write the closing entry**

Append to the end of `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, following the `####
<SLICE> CLOSES — <headline>` convention every other entry uses. It must contain:

- **The headline**, which is that the filed item was a performance concern and the measurement found a
  drag that moves one frame and dies.
- **The probe transcript from Task 3 Step 2, verbatim.** The defect was reproduced against unfixed
  source; the entry shows it rather than describing it.
- **The correction, made forward.** 5d-ii-d's entry called this a per-frame layout write and proposed
  *"a commit-on-`pointerup` or a debounce"*. The `pointerup` half was right; the debounce half would
  have fixed nothing, because `renderLayout` destroys the divider at whatever rate it is called.
  **5d-ii-d's entry is not edited** — the web-doc-history convention holds that correcting a dated entry
  to agree with today teaches the next reader nothing about how the belief changed.
- **Why the suite could not see it**: `layout-view.test.ts`'s stub `onResize` never re-renders, so the
  divider it grabs stays alive. 5d-ii-a filed the gap in words and four slices carried it forward.
- **What this slice discharges from the carried-forward list**: divider drag on the real page (Task 2),
  reload's interaction with it (Task 4), and `MIN_PANE_FRACTION` (Task 5, with the reading).
- **What it does not close**: there is still no `ResizeObserver` anywhere in the app, so a plain window
  resize leaves the TM pane's virtual window stale until something else redraws. Filed, with the reason
  it is a different slice: it changes when every pane redraws, not when a gesture commits.
- **A Verification block** with the Step 1 figures.

- [ ] **Step 3: Commit and open the PR**

```bash
cd /home/davey/projects/redextape
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "roadmap: the divider drag closes — the filed per-frame write sat next to a drag that never worked"
git push -u origin divider-drag-gesture
```

Then open the PR against `main`. Do not merge it — Davey merges PRs himself, and holds branches to fix
review findings rather than landing and following up.

---

## Self-review

**Spec coverage.** §1 → Task 3 Steps 1–3. §2 → Task 3 Step 4. §3 → Tasks 2 and 3. §4 → Task
2. §5 → Task 1. §6 → Task 3 Step 4's `draw()` comment, and the `ResizeObserver`
filing in Task 7 Step 2. §7 → Task 3 Step 5's `moved` flag, tested by the fifth test in Task 3 Step 1. §8 →
Task 4. §9 → Task 6. §10 → Task 5. §11 → the spec's nine listed tests are distributed across Tasks 2–5
in the order it lists them. §12 → Task 4 Step 4 (both code doc repairs) and Task 7 Step 2 (the roadmap
correction, made forward). §13 → Task 7 Step 2 records the rejected debounce; the DOM-leads alternative
is recorded in the spec and needs no task.

**Ordering.** Strictly sequential, 1 through 7, with no forward references. Task 1 is the signature
change alone and must come first, because `web typecheck` is a pre-commit hook and the test file cannot
compile against one shape while the source has the other. Tasks 1 and 2 both end green with the drag
still broken; Task 3 is where it starts working.

**Type consistency.** `ResizeHandlers` is `{ resize, commit }` in Task 2 and referenced by that exact
name in Tasks 2 and 4. `syncSizes(root, tree)` has one signature throughout. `KEY_STEP` is imported from
`layout-view.ts` in both test files. `storedRowSizes()`, `verticalDivider()`, `pointer()`, `mountApp()`
and `freshMain()` are defined in Task 3's file and reused unchanged in Tasks 4 and 5.
