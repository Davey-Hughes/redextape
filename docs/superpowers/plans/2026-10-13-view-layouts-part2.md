# View layouts, part 2 — panel resizing: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The regions inside each of the four views can be resized: a boundary between two of them is dragged by the
header of the panel under it or moved with the arrow keys, each panel has a maximise button, and the workspace
remembers the sizes.

**Architecture:** `web/src/separator.ts` is the layout divider's gesture, shared. `web/src/panel-stack.ts` gives each
open region of a view a share of the view's height through one custom property, `--share`, which `style.css`'s
`flex: var(--share) 1 0` reads; it draws a `role="separator"` under each open region that has an open region below it,
makes the header of the panel under a boundary its handle, and owns the maximise buttons. `web/src/panel.ts` draws a
panel open or closed over what it stores, which is what a maximise is. `Workspace.panelSizes` holds a view's shares
in a field that may be absent. The TM and asm views already shared their height; the λ view and the source view are
made to, which moves the source view's scroll from the view's own box to its editor's.

**Tech Stack:** TypeScript 7.0.2, Vite 8.2.1, Vitest 4.1.10 (node and Playwright 1.62.1 Chromium projects), Biome
2.5.7, CodeMirror 6 (`@codemirror/view` 6.43.8).

**Spec:** `docs/superpowers/specs/2026-10-11-view-layouts-design.md`, its §11 as amended after this part's prototype
(§18 lists what the user decided with it open, which rulings are the design's own, and what the prototype found).
This plan is the design's second pull request. Moving a view (§9) and drag and drop (§10) are the two after it.

**Provenance:** a prototype (`panel-resizing-proto`, last `ca00070`) was built first and tried by the user in a
running page, and what he said changed it twice (the spec's §18.1). It was then replayed task by task onto
`panel-resizing-replay` (`a2ce6cf`..`79cf32c`, one commit a task, on `73d298a`, the spec's
amendment), and the code blocks below are those commits', cut from them by `git`. Each task's failing run, passing
run and sabotages were run on that replay, and the outputs quoted are those runs': 42 sabotages, all of
which fired. The replay's last tree of `web/` is the prototype's, byte for byte (`git diff --quiet ca00070
panel-resizing-replay -- web`; both are tree `e4b0ea6`). All the branches are local, and so are the replay's
logs, in `~/temp/redextape-panel-resizing-record/replay/`.

## Global Constraints

- A region's share is one custom property, `--share`, written by `panel-stack.ts` and read by `style.css`. A region
  that has one is `data-sized`. Nothing else of a view's layout is written from script (§11.4).
- Three regions start at their own height and take a share only at the first drag beside them: a copy's text, the
  term map, and the source outline (§11.1). A reset gives them their own height back.
- A boundary is drawn directly under the upper of its two regions, and takes the place of the gap the lower one kept
  above itself, so no region moves for it (§11.2).
- A panel's header is the handle for the boundary above it. Nothing is drawn for a boundary at rest or under the
  pointer: the cursor is `grab`, and `grabbing` while `data-dragging` is set. A line is drawn for `:focus-visible`
  alone (§11.2, the user's decisions of 2026-10-12).
- A maximise is not stored, and writes no panel's state. A region with no header keeps its floor under one (§11.3).
- `WORKSPACE_VERSION` stays 2. `panelSizes` may be absent, and is written only while a view holds a share (§11.4).
- The new attributes are `data-region`, `data-sized`, `data-resizes`, `data-dragging`, `data-above` and `data-below`.
  None was in use before this plan.
- No colour literal outside `web/src/palettes.ts`; every colour in new CSS is a `var(--…)` token.
- No `file:line` in tracked source; a backticked symbol citation names the file that declares it.
- **Comments are written for the branch's last commit.** A sentence in an early task's comment may describe what a
  later task adds (Task 1's `separator.ts` speaks of panel boundaries; Task 3's `style.css` of the source and λ
  views' regions "below"). Copy them as given: `main` is squash-merged, and the replay's hooks passed them.
- **In `style.css`, the regions' rules for the source and λ views go at the end of the file**, after the rules they
  narrow: Biome's `noDescendingSpecificity` rejects a selector that follows a more specific one for the same element.
- Commits run every pre-commit hook; never `--no-verify`. Stage explicit paths, never `git add -A`.
- Web code style is Biome's: single quotes, no semicolons, 120 columns, `/** */` doc comments.
- No AI attribution anywhere: not in a comment, a commit message, the roadmap or the pull request.

## How to run things

All test commands run from `web/`:

- Node project: `pnpm exec vitest run --project node <files>`
- Browser project: `pnpm exec vitest run --project browser <files>`. One browser run at a time on this machine, and
  no edit to a source file while one runs: a run started as `style.css` was being edited printed nothing for five
  minutes and had to be killed.
- Typecheck: `pnpm exec tsc --noEmit -p .` (the hook runs `pnpm run typecheck`, which rebuilds the bindings first)
- Lint and format: `pnpm exec biome ci --error-on-warnings`; `pnpm exec biome check --write <paths>` applies fixes

**A sabotage is:** save a copy of the file, make the one edit shown, run the named test files, expect the failure
quoted, copy the saved file back, and `cmp` it against the copy. Never restore with `git checkout`, which would wipe a
task's unstaged work. A sabotage that does not fire is a finding: stop and report it, and do not change the test to
suit.

**Work in a worktree, not in the main checkout,** while a dev server is running from it: a sabotage there is served to
whoever has the page open. In a scratch worktree `pkg/`, `pkg-lsp/`, `web/node_modules`, `web/bindings/` and the two
crates' `bindings/` must be real directories, copied from a checkout that has them, not symlinks. They are gitignored,
which is one more reason to stage explicit paths.

**A real drag is the driver's:** `userEvent.dragAndDrop(el, el, { sourcePosition, targetPosition })`, a press, one
move and a release. Give each call its own position objects. Three kinds of case need more than one move, a finger,
or a press that is held, and make their own `PointerEvent`s with `pointerId: 1`; each says so.

**The tests' `localStorage` is `tests/browser/setup.ts`'s own object for each file**, so a spy on a write is
`vi.spyOn(localStorage, 'setItem')` and not one on `Storage.prototype`.

**A timeout under load is not a failure of the task.** The replay's whole-suite run after Task 3 had eight, in seven
files this plan does not touch, with the machine's load average at 80; the seven files passed when run again.

## File map

| File | Task | Responsibility |
|---|---|---|
| `web/src/separator.ts` | 1 | the gesture of a `role="separator"`: `pointerDrag`, `separatorGesture` |
| `web/src/layout-view.ts` | 1 | `divider` calls it |
| `web/src/workspace.ts` | 2 | `PanelSizes`, `Workspace.panelSizes`, `withPanelSizes`, its reading and writing |
| `web/src/main.ts` | 2, 3, 4 | the field kept and dropped with a view; the pane host's two dependencies; the source view's stack |
| `web/src/panel.ts` | 3 | `drawOver`, `onDrawn`, `onGesture`; `isOpen` answers what is drawn |
| `web/src/panel-stack.ts` | 3 | `PanelStack`: shares, boundaries, the header as a handle, maximise |
| `web/src/icons.ts` | 3 | `maximise` |
| `web/src/pane-chrome.ts`, `web/src/copy-editor.ts` | 3 | `PaneEvents.panelSizes`; the text and outline panels handed to a view's stack |
| `web/src/tm-pane.ts`, `web/src/asm-pane.ts` | 3 | each view's regions |
| `web/src/pane-host.ts` | 3, 4 | a view built with its shares; then the λ view's, and `startEditorsAtTop` |
| `web/src/style.css` | 3, 4 | `--share`, the boundary, the handle's cursors, the maximise button; then the λ and source views as columns |
| `web/help.html` | 3 | the boundary's keys |
| `web/src/lambda-pane.ts` | 4 | the λ view's regions |

---
### Task 1: The layout divider's gesture moves to `separator.ts`

`layout-view.ts`'s `divider` holds a gesture the boundaries between a view's panels need whole (spec §11.2): a drag
under pointer capture, a held arrow key as many frames and one commit, a `blur` that commits, and the `blur` a rebuild
fires on a detached divider refused. It moves to `separator.ts` unchanged in what it does, reporting pixels and steps
and leaving what each is worth to its caller. `pointerDrag` is its pointer's half by itself, with a press it can
refuse and a double click, which Task 3 puts on a panel's header.

**No test is new.** The divider's own tests are what hold the gesture, and they pass before this task and after it.

**Files:**

- Modify: `web/src/layout-view.ts`
- Create: `web/src/separator.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces, in `web/src/separator.ts`: `interface SeparatorHandlers { ready?(): boolean; drag(px: number): void;
  step(sign: -1 | 1): void; commit(): void; reset?(): void }`, `type SeparatorAxis = 'x' | 'y'`,
  `pointerDrag(el, axis, handlers, accept?)`, `separatorGesture(el, axis, handlers)`. A held element carries
  `data-dragging`.

- [ ] **Step 1: Write the tests**

None: the tests that hold the divider are the check.

- [ ] **Step 2: Run them, and see them pass before the change**

```bash
pnpm exec vitest run --project browser tests/browser/divider-drag.test.ts tests/browser/divider-drag-focus.test.ts tests/browser/divider-drag-format-on-blur.test.ts tests/browser/layout-view.test.ts tests/browser/default-views-gestures.test.ts
```

They pass on the base, as they do after Step 3.

- [ ] **Step 3: Write the source**

In `web/src/layout-view.ts`:

```diff
--- a/web/src/layout-view.ts
+++ b/web/src/layout-view.ts
@@ -1,6 +1,7 @@
 import type { Dir, LayoutNode } from './layout'
 import { leaves, MIN_PANE_FRACTION } from './layout'
 import type { LeafId } from './panes'
+import { separatorGesture } from './separator'
 
 /**
  * How far one arrow-key press moves a divider, as a fraction of its split.
@@ -240,122 +241,16 @@ function divider(
 
   const extent = () => (dir === 'row' ? box.getBoundingClientRect().width : box.getBoundingClientRect().height)
 
-  let dragging = false
-  let moved = false
-  let last = 0
-
-  el.addEventListener('pointerdown', (e) => {
-    dragging = true
-    moved = false
-    last = dir === 'row' ? e.clientX : e.clientY
-    // BEFORE `setPointerCapture`, NOT AFTER. Capture throws `NotFoundError` for a synthetic
-    // `PointerEvent` whose `pointerId` is anything other than `1` — measured directly (ids `0` and `2`
-    // both throw, `1` never does) — because `1` is the reserved mouse-pointer id and is always active,
-    // even on a page's very first `pointerdown`. Every synthetic pointer event this suite dispatches
-    // uses `pointerId: 1` for exactly that reason, so nothing here throws today — but if a future test
-    // ever used a different id, `preventDefault` is what stops a drag from selecting text across the
-    // panes, so it must not be the thing a throw skips.
-    e.preventDefault()
-    el.setPointerCapture(e.pointerId)
-  })
-
-  el.addEventListener('pointermove', (e) => {
-    if (!dragging) return
-    const now = dir === 'row' ? e.clientX : e.clientY
-    const span = extent()
-    // `now !== last` — A ZERO-DISPLACEMENT MOVE DOES NOT ARM THE COMMIT. Browsers do emit `pointermove`
-    // at an unchanged coordinate, and without this guard such an event would call `handlers.resize` with
-    // delta 0, set `moved`, and make `pointerup` run a full reconcile-and-write for a gesture that
-    // changed nothing — exactly the no-op `stop` below says it avoids.
-    if (span > 0 && now !== last) {
-      // `moved` IS SET BEFORE `handlers.resize` RUNS, NOT AFTER. `handlers.resize` (in practice,
-      // `pane-host.ts`'s frame handler) advances the tree before it calls `syncSizes`, which has throw
-      // paths of its own — so if it throws, setting `moved` only after return would leave the tree
-      // advanced but the gesture uncommittable, and `pointerup` would commit nothing. That is the same
-      // three-way disagreement between tree, DOM and storage that `applyLayout` was fixed to avoid;
-      // arming first keeps this gesture committable even when the frame handler throws.
-      moved = true
-      handlers.resize(path, index, (now - last) / span)
-    }
-    last = now
-  })
-
-  // THE END OF THE GESTURE IS WHERE THE LAYOUT IS COMMITTED — see `ResizeHandlers`. A press and
-  // release that never moved commits nothing rather than firing a full reconcile-and-write for a no-op.
-  const stop = (e: PointerEvent) => {
-    if (!dragging) return
-    dragging = false
-    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
-    if (moved) handlers.commit()
-    moved = false
-  }
-  el.addEventListener('pointerup', stop)
-  el.addEventListener('pointercancel', stop)
-
-  // THE KEYBOARD PATH — design §6.2's first exception. `Home`/`End` are deliberately absent: they
-  // would mean "collapse this pane to its floor", which is a thing the close control already says
-  // better and unambiguously.
-  //
-  // IT IS A GESTURE, EXACTLY LIKE A DRAG. Auto-repeat sends many `keydown`s and one `keyup`, so a held
-  // arrow key is N cheap frames and one storage write rather than N full rebuilds — the same shape the
-  // pointer path takes above, for the same reason.
-  let armedKey: string | null = null
-
-  el.addEventListener('keydown', (e) => {
-    const forward = dir === 'row' ? 'ArrowRight' : 'ArrowDown'
-    const back = dir === 'row' ? 'ArrowLeft' : 'ArrowUp'
-    let delta: number
-    if (e.key === forward) delta = KEY_STEP
-    else if (e.key === back) delta = -KEY_STEP
-    else return
-    // `armedKey` IS SET BEFORE `handlers.resize` RUNS, NOT AFTER — the same ordering `pointermove`
-    // uses above and for the same reason: if the frame handler throws, `keyup`/`blur` must still find
-    // the gesture committable rather than silently discarding a model that already advanced.
-    armedKey = e.key
-    handlers.resize(path, index, delta)
-    e.preventDefault()
-  })
-
-  // `blur` COMMITS TOO, AND IT IS NOT BELT-AND-BRACES. `keyup` never arrives if focus leaves while the
-  // key is down — a click into a pane, a `Tab` chord, the window losing focus — and the frames already
-  // moved the model, so without this the tree on screen and the tree in storage disagree until the next
-  // unrelated `applyLayout` happens to reconcile them.
-  //
-  // `keyup` COMMITS ONLY WHEN THE RELEASED KEY IS THE ONE THAT ARMED THE GESTURE — Important finding,
-  // review of this task. A held arrow key's own `keyup` is not the only `keyup` this divider can see
-  // while it holds focus: the user can press and release an UNRELATED key — a modifier, a stray
-  // keystroke — without ever releasing the arrow. `armedKey` records WHICH key armed the current gesture
-  // rather than merely THAT some key did, so an unrelated key's `keyup` finds no match, calls nothing,
-  // and leaves the gesture armed; auto-repeat then keeps re-arming it with the arrow key itself, and the
-  // arrow's own eventual `keyup` is what actually commits. Without this the unrelated `keyup` mid-hold
-  // consumed the arming and wrote to storage early, and the arrow's later `keyup` — re-armed by
-  // auto-repeat in between — committed a SECOND time: two writes for one continuous gesture, against the
-  // one-write-per-gesture invariant this path exists to establish. `blur` has no released key to compare
-  // against — focus can leave from a click or a `Tab` with no `keyup` involved at all — so it stays
-  // unconditional on anything but arming: any armed gesture commits when focus goes, exactly as before.
-  const commitKeys = (): void => {
-    // A `blur` FIRED BY THE VERY REBUILD WE ARE INSIDE MUST NOT COMMIT. `renderLayout`'s
-    // `root.replaceChildren()` removes a focused divider mid-rebuild, and Chromium fires `blur` on an
-    // element the instant it is removed while focused — so this handler can be reached from INSIDE
-    // `applyLayout`'s own `renderLayout` call, not only from a user releasing focus. Letting that
-    // `blur` reach `handlers.commit()` would re-enter `applyLayout` from inside its own `renderLayout`:
-    // the outer call would go on to append a second tree box, and `syncSizes`'s anchor
-    // (`root.firstElementChild`) would then point at a stale one. `el.isConnected` is what tells the
-    // two cases apart — false exactly when this divider has already been detached by the rebuild we are
-    // inside — so bailing here makes the ordering below safe by design rather than merely by the
-    // set-before-call ordering that happens to prevent re-entrancy today.
-    if (!el.isConnected) {
-      armedKey = null
-      return
-    }
-    if (armedKey === null) return
-    armedKey = null
-    handlers.commit()
-  }
-  el.addEventListener('keyup', (e) => {
-    if (e.key === armedKey) commitKeys()
+  // THE GESTURE IS `separator.ts`'s, shared with the boundaries between a view's panels: a drag under pointer
+  // capture, a held arrow key as frames and one commit, and the `blur` that a rebuild fires on a detached divider
+  // refused. What is this divider's own is what a pixel and a step are worth: a pixel is a fraction of the split
+  // box's extent, measured at each frame (the denominator's note above), and a step is `KEY_STEP`.
+  separatorGesture(el, dir === 'row' ? 'x' : 'y', {
+    ready: () => extent() > 0,
+    drag: (px) => handlers.resize(path, index, px / extent()),
+    step: (sign) => handlers.resize(path, index, sign * KEY_STEP),
+    commit: () => handlers.commit(),
   })
-  el.addEventListener('blur', commitKeys)
 
   return el
 }
```

Create `web/src/separator.ts`:

```ts
/**
 * THE GESTURE OF A `role="separator"` THAT IS DRAGGED OR MOVED BY ARROW KEYS — the layout's dividers
 * (`layout-view.ts`) and the boundaries between a view's panels (`panel-stack.ts`) are both this, in one
 * implementation (the view layouts spec §11.2).
 *
 * IT REPORTS PIXELS AND STEPS, NEVER A FRACTION OR A SHARE. What a pixel is worth is the caller's to say: a layout
 * divider divides by its split's extent, and a panel boundary moves two heights by it.
 *
 * IT IS A GESTURE WITH FRAMES AND ONE END. `drag` and `step` are called at pointer rate and at a held key's repeat
 * rate, and must be cheap; `commit` runs once, where the caller reconciles and stores.
 */
export interface SeparatorHandlers {
  /**
   * Whether a pointer frame can move anything at all. Asked BEFORE the gesture is armed, so a frame that cannot move
   * (a split box with no extent) arms no commit.
   */
  ready?(): boolean
  /** One pointer frame: the pointer moved `px` along the axis since the last frame, never 0. */
  drag(px: number): void
  /** One arrow press, or one repeat of a held one: a step back (`-1`) or forward (`1`). */
  step(sign: -1 | 1): void
  /** The gesture is over, and it moved. */
  commit(): void
  /** A double click, or `Enter` on the focused separator. A separator that takes no reset passes none. */
  reset?(): void
}

/** `'x'` for a separator that parts things left and right, `'y'` for one that parts them up and down. */
export type SeparatorAxis = 'x' | 'y'

/**
 * The pointer's half of the gesture, on any element: a press, frames under capture, and one commit if it moved.
 *
 * `accept` IS ASKED AT THE PRESS, and a press it refuses starts nothing and is left to whatever else hears it: a
 * panel's header is a handle for the boundary above it (`panel-stack.ts`), and a press on one of the header's own
 * buttons is the button's.
 */
export function pointerDrag(
  el: HTMLElement,
  axis: SeparatorAxis,
  handlers: Pick<SeparatorHandlers, 'ready' | 'drag' | 'commit' | 'reset'>,
  accept: (e: MouseEvent) => boolean = () => true,
): void {
  let dragging = false
  let moved = false
  let last = 0

  el.addEventListener('pointerdown', (e) => {
    if (!accept(e)) return
    dragging = true
    // HELD, FOR THE STYLESHEET: a handle that draws a hand draws it closed from the press to the release.
    el.dataset.dragging = 'true'
    moved = false
    last = axis === 'x' ? e.clientX : e.clientY
    // BEFORE `setPointerCapture`, NOT AFTER. Capture throws `NotFoundError` for a synthetic
    // `PointerEvent` whose `pointerId` is anything other than `1` — measured directly (ids `0` and `2`
    // both throw, `1` never does) — because `1` is the reserved mouse-pointer id and is always active,
    // even on a page's very first `pointerdown`. Every synthetic pointer event this suite dispatches
    // uses `pointerId: 1` for exactly that reason, so nothing here throws today — but if a future test
    // ever used a different id, `preventDefault` is what stops a drag from selecting text across the
    // panes, so it must not be the thing a throw skips.
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
  })

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const now = axis === 'x' ? e.clientX : e.clientY
    // `now !== last` — A ZERO-DISPLACEMENT MOVE DOES NOT ARM THE COMMIT. Browsers do emit `pointermove`
    // at an unchanged coordinate, and without this guard such an event would call `handlers.drag` with
    // 0, set `moved`, and make `pointerup` run a full reconcile-and-write for a gesture that
    // changed nothing — exactly the no-op `stop` below says it avoids.
    if (now !== last && (handlers.ready?.() ?? true)) {
      // `moved` IS SET BEFORE `handlers.drag` RUNS, NOT AFTER. The frame handler advances a model before it
      // writes the DOM, which has throw paths of its own — so if it throws, setting `moved` only after return
      // would leave the model advanced but the gesture uncommittable, and `pointerup` would commit nothing.
      // Arming first keeps this gesture committable even when the frame handler throws.
      moved = true
      handlers.drag(now - last)
    }
    last = now
  })

  // THE END OF THE GESTURE IS WHERE IT IS COMMITTED — see `SeparatorHandlers`. A press and
  // release that never moved commits nothing rather than firing a full reconcile-and-write for a no-op.
  const stop = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    delete el.dataset.dragging
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (moved) handlers.commit()
    moved = false
  }
  el.addEventListener('pointerup', stop)
  el.addEventListener('pointercancel', stop)

  if (handlers.reset !== undefined) {
    const reset = handlers.reset
    el.addEventListener('dblclick', (e) => {
      if (accept(e)) reset()
    })
  }
}

export function separatorGesture(el: HTMLElement, axis: SeparatorAxis, handlers: SeparatorHandlers): void {
  pointerDrag(el, axis, handlers)

  // THE KEYBOARD PATH. `Home`/`End` are deliberately absent: they would mean "collapse this to its floor",
  // which a close control already says better and unambiguously.
  //
  // IT IS A GESTURE, EXACTLY LIKE A DRAG. Auto-repeat sends many `keydown`s and one `keyup`, so a held
  // arrow key is N cheap frames and one storage write rather than N full rebuilds — the same shape the
  // pointer path takes above, for the same reason.
  let armedKey: string | null = null

  el.addEventListener('keydown', (e) => {
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    let sign: -1 | 1
    if (e.key === forward) sign = 1
    else if (e.key === back) sign = -1
    else {
      if (e.key === 'Enter' && handlers.reset !== undefined) {
        handlers.reset()
        e.preventDefault()
      }
      return
    }
    // `armedKey` IS SET BEFORE `handlers.step` RUNS, NOT AFTER — the same ordering `pointermove`
    // uses above and for the same reason: if the frame handler throws, `keyup`/`blur` must still find
    // the gesture committable rather than silently discarding a model that already advanced.
    armedKey = e.key
    handlers.step(sign)
    e.preventDefault()
  })

  // `blur` COMMITS TOO, AND IT IS NOT BELT-AND-BRACES. `keyup` never arrives if focus leaves while the
  // key is down — a click into a pane, a `Tab` chord, the window losing focus — and the frames already
  // moved the model, so without this what is on screen and what is stored disagree until the next
  // unrelated write happens to reconcile them.
  //
  // `keyup` COMMITS ONLY WHEN THE RELEASED KEY IS THE ONE THAT ARMED THE GESTURE. A held arrow key's own
  // `keyup` is not the only `keyup` a separator can see while it holds focus: the user can press and release
  // an UNRELATED key — a modifier, a stray keystroke — without ever releasing the arrow. `armedKey` records
  // WHICH key armed the current gesture rather than merely THAT some key did, so an unrelated key's `keyup`
  // finds no match, calls nothing, and leaves the gesture armed; auto-repeat then keeps re-arming it with the
  // arrow key itself, and the arrow's own eventual `keyup` is what actually commits. Without this the unrelated
  // `keyup` mid-hold consumed the arming and wrote to storage early, and the arrow's later `keyup` — re-armed by
  // auto-repeat in between — committed a SECOND time: two writes for one continuous gesture, against the
  // one-write-per-gesture invariant this path exists to establish. `blur` has no released key to compare
  // against — focus can leave from a click or a `Tab` with no `keyup` involved at all — so it stays
  // unconditional on anything but arming: any armed gesture commits when focus goes.
  const commitKeys = (): void => {
    // A `blur` FIRED BY A REBUILD THAT TOOK THE SEPARATOR OFF THE PAGE MUST NOT COMMIT. `renderLayout`'s
    // `root.replaceChildren()` removes a focused divider mid-rebuild, and Chromium fires `blur` on an
    // element the instant it is removed while focused — so this handler can be reached from INSIDE
    // `applyLayout`'s own `renderLayout` call, not only from a user releasing focus. Letting that
    // `blur` reach `handlers.commit()` would re-enter `applyLayout` from inside its own `renderLayout`:
    // the outer call would go on to append a second tree box, and `syncSizes`'s anchor
    // (`root.firstElementChild`) would then point at a stale one. `el.isConnected` is what tells the
    // two cases apart — false exactly when this separator has already been detached by the rebuild we are
    // inside — so bailing here makes the ordering safe by design rather than merely by the
    // set-before-call ordering that happens to prevent re-entrancy today.
    if (!el.isConnected) {
      armedKey = null
      return
    }
    if (armedKey === null) return
    armedKey = null
    handlers.commit()
  }
  el.addEventListener('keyup', (e) => {
    if (e.key === armedKey) commitKeys()
  })
  el.addEventListener('blur', commitKeys)
}
```

- [ ] **Step 4: Run them, and see them pass**

```bash
pnpm exec vitest run --project browser tests/browser/divider-drag.test.ts tests/browser/divider-drag-focus.test.ts tests/browser/divider-drag-format-on-blur.test.ts tests/browser/layout-view.test.ts tests/browser/default-views-gestures.test.ts
```

On the replay (`t1-pass.log`): files: 5 passed (5); tests: 63 passed (63).

- [ ] **Step 5: Break it on purpose, once a sabotage, and put it back**

Each entry is the replay's own record. Its `sab.py` saved the file, made the edit, ran
`pnpm exec vitest run --project <project> <files>` on the files named, copied the saved file back and compared
the two byte for byte.

**S1a** `separator.ts`: a drag that moved no longer commits at the release. Run: `tests/browser/divider-drag.test.ts`, `tests/browser/divider-drag-focus.test.ts`, `tests/browser/layout-view.test.ts` (`sab-S1a.log`): 4 failed | 35 passed (39). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/separator.ts
+++ b/web/src/separator.ts
@@ -88,7 +88,6 @@
     dragging = false
     delete el.dataset.dragging
     if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
-    if (moved) handlers.commit()
     moved = false
   }
   el.addEventListener('pointerup', stop)
```

What failed:

```
a dragged layout across a reload > comes back where it was dragged to
dragging a divider a second time, after the first drag commits and rebuilds it > moves the layout by both drags in full, off a freshly re-queried divider
dragging a divider on a mounted app > tracks the pointer for the whole drag, not one frame of it
dragging a divider on a mounted app > writes storage once for the gesture, not once per frame
```

**S1b** `separator.ts`: any `keyup` commits a key gesture, not only the release of the key that armed it. Run: `tests/browser/divider-drag.test.ts`, `tests/browser/divider-drag-focus.test.ts`, `tests/browser/layout-view.test.ts` (`sab-S1b.log`): 1 failed | 38 passed (39). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/separator.ts
+++ b/web/src/separator.ts
@@ -170,7 +170,7 @@
     handlers.commit()
   }
   el.addEventListener('keyup', (e) => {
-    if (e.key === armedKey) commitKeys()
+    commitKeys()
   })
   el.addEventListener('blur', commitKeys)
 }
```

What failed:

```
resizing a divider from the keyboard > ignores an unrelated keyup mid-hold, so a still-held arrow key commits exactly once — Important finding, review of this task
```

**S1c** `separator.ts`: a pointer move to the coordinate it was at arms the commit. Run: `tests/browser/divider-drag.test.ts`, `tests/browser/divider-drag-focus.test.ts`, `tests/browser/layout-view.test.ts` (`sab-S1c.log`): 1 failed | 38 passed (39). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/separator.ts
+++ b/web/src/separator.ts
@@ -70,7 +70,7 @@
     // at an unchanged coordinate, and without this guard such an event would call `handlers.drag` with
     // 0, set `moved`, and make `pointerup` run a full reconcile-and-write for a gesture that
     // changed nothing — exactly the no-op `stop` below says it avoids.
-    if (now !== last && (handlers.ready?.() ?? true)) {
+    if (handlers.ready?.() ?? true) {
       // `moved` IS SET BEFORE `handlers.drag` RUNS, NOT AFTER. The frame handler advances a model before it
       // writes the DOM, which has throw paths of its own — so if it throws, setting `moved` only after return
       // would leave the model advanced but the gesture uncommittable, and `pointerup` would commit nothing.
```

What failed:

```
dragging a divider on a mounted app > writes nothing for a pointermove that never changes coordinate
```

**S1d** `layout-view.ts`: a divider's arrow key is worth two of `KEY_STEP`. Run: `tests/browser/divider-drag.test.ts`, `tests/browser/divider-drag-focus.test.ts`, `tests/browser/layout-view.test.ts` (`sab-S1d.log`): 4 failed | 35 passed (39). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/layout-view.ts
+++ b/web/src/layout-view.ts
@@ -248,7 +248,7 @@
   separatorGesture(el, dir === 'row' ? 'x' : 'y', {
     ready: () => extent() > 0,
     drag: (px) => handlers.resize(path, index, px / extent()),
-    step: (sign) => handlers.resize(path, index, sign * KEY_STEP),
+    step: (sign) => handlers.resize(path, index, sign * 2 * KEY_STEP),
     commit: () => handlers.commit(),
   })
 
```

What failed:

```
a divider moved with its keys > keeps the focus through each press, and the next press moves it again
renderLayout > reports a resize from the arrow keys, so the layout is not mouse-only
resizing a divider from the keyboard > commits on blur, so a layout is not lost when focus leaves mid-hold
resizing a divider from the keyboard > moves once per keydown and writes once per keyup, not once per keydown
```

- [ ] **Step 6: The whole suite**

`pnpm exec biome ci --error-on-warnings`, `pnpm exec tsc --noEmit -p .`, `pnpm exec vitest run --project node` and
`pnpm exec vitest run --project browser`, all from `web/`. On the replay, after this task:

`biome ci` exit 0, typecheck exit 0. Node (`t1-suite-node.log`): 70 passed (70) files, 1403 passed (1403) tests. Browser (`t1-suite-browser.log`): 204 passed (204) files, 1433 passed (1433) tests, with the machine's load average at 2.11 before the run and 7.29 after it.

- [ ] **Step 7: Commit**

```bash
git add web/src/layout-view.ts \
  web/src/separator.ts
git commit -F - <<'EOF'
The layout divider's gesture is `separator.ts`'s, where `layout-view.ts`'s `divider` held it

A drag under pointer capture, a held arrow key as frames and one commit, and the `blur` a rebuild fires on a detached
divider refused: one implementation, which reports pixels and steps and leaves what each is worth to its caller. The
layout divider divides a pixel by its split's extent and takes `KEY_STEP` a step, as before. `pointerDrag` is the
pointer's half by itself, with a press it can refuse and a double click, for the boundaries between a view's panels
(the view layouts spec §11.2), which the next tasks draw.
EOF
```

### Task 2: The workspace holds a view's shares

`Workspace.panelSizes`: for a view, by leaf id, a share for each of its regions by name (spec §11.4). A field that may
be absent, read by `parsePanels`' rules and written only while a view holds a share. `main.ts` keeps it and drops it
with the panel state it sits beside. Nothing writes one until Task 3.

**Files:**

- Modify: `web/src/main.ts`
- Modify: `web/src/workspace.ts`
- Modify: `web/tests/node/share-link.test.ts`
- Modify: `web/tests/node/workspace.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces, in `web/src/workspace.ts`: `type PanelSizes = Readonly<Record<LeafId, Readonly<Record<string, number>>>>`,
  `Workspace.panelSizes: PanelSizes`, `withPanelSizes(sizes, leaf, own): PanelSizes`, which leaves a view out where
  `own` is empty.

- [ ] **Step 1: Write the tests**

In `web/tests/node/share-link.test.ts`:

```diff
--- a/web/tests/node/share-link.test.ts
+++ b/web/tests/node/share-link.test.ts
@@ -152,6 +152,7 @@ describe('the frozen link from version 1', () => {
         speed: 8,
         focused: 'lambda-0',
         panels: {},
+        panelSizes: {},
         inspector: true,
         display: {},
         tmDisplay: {},
```

In `web/tests/node/workspace.test.ts`:

```diff
--- a/web/tests/node/workspace.test.ts
+++ b/web/tests/node/workspace.test.ts
@@ -22,6 +22,7 @@ import {
   WORKSPACE_VERSION,
   withDisplay,
   withPanel,
+  withPanelSizes,
   withTmDisplay,
 } from '../../src/workspace'
 import { fourViews, fourViewWorkspace } from '../browser/harness'
@@ -89,6 +90,7 @@ describe('parseWorkspace', () => {
       speed: 250 as const,
       focused: 'pane-1',
       panels: { 'tm-0': { rules: false } },
+      panelSizes: { 'tm-0': { rules: 2.5, diagram: 0.5 } },
       inspector: false,
       display: { 'pane-1': { layout: 'outline' as const, vars: 'debruijn' as const, map: 'minimap' as const } },
       tmDisplay: { 'tm-0': { level: 'local' as const, edges: 'chips' as const } },
@@ -210,6 +212,36 @@ describe('parseWorkspace', () => {
     }
   })
 
+  // **AND FOR A VIEW'S SHARES** (the view layouts spec §11.4): absent in every workspace stored before a boundary
+  // could be dragged, and held to `parsePanels`' rules where present. A share is a finite number above 0.
+  it('defaults missing panel sizes to none stored, and refuses a malformed one', () => {
+    const base = { version: 2, tree: SPLIT, switches: PRESETS.explorer, speed: 8, focused: 'lambda-0', panels: {} }
+    expect(parseWorkspace(JSON.stringify(base))?.panelSizes).toEqual({})
+    const good = { 'lambda-0': { term: 1.25, map: 0.75 }, 'pane-1': {} }
+    expect(parseWorkspace(JSON.stringify({ ...base, panelSizes: good }))?.panelSizes).toEqual(good)
+    for (const bad of [
+      { 'lambda-0': { term: 0 } },
+      { 'lambda-0': { term: -1 } },
+      { 'lambda-0': { term: '1' } },
+      { 'lambda-0': { term: null } },
+      { 'lambda-0': { term: true } },
+      { 'nowhere-9': { term: 1 } },
+      { 'lambda-0': null },
+      { 'lambda-0': [1, 2] },
+      [],
+      null,
+      1,
+    ]) {
+      expect(parseWorkspace(JSON.stringify({ ...base, panelSizes: bad })), JSON.stringify(bad)).toBeNull()
+    }
+    // NOT FINITE: JSON has no way to write one but a number too large to hold, which reads as `Infinity`.
+    const raw = JSON.stringify({ ...base, panelSizes: { 'lambda-0': { term: 1 } } }).replace('"term":1', '"term":1e999')
+    expect(JSON.parse(raw).panelSizes['lambda-0'].term, 'precondition: the share reads as Infinity').toBe(
+      Number.POSITIVE_INFINITY,
+    )
+    expect(parseWorkspace(raw), 'a share that is not finite').toBeNull()
+  })
+
   it('opens the inspector for a migrated version 1 layout', () => {
     expect(parseWorkspace(serializeLayout(SPLIT))?.inspector).toBe(true)
   })
@@ -229,6 +261,13 @@ describe('serializeWorkspace', () => {
       },
     }
     const back = JSON.parse(serializeWorkspace(ws))
+    expect(back.panelSizes, 'no field while no view holds a share').toBeUndefined()
+    const sized = { ...ws, panelSizes: { 'pane-9': { rules: 3 }, 'tm-0': { rules: 2.5, diagram: 0.5 } } }
+    expect(JSON.parse(serializeWorkspace(sized)).panelSizes).toEqual({ 'tm-0': { rules: 2.5, diagram: 0.5 } })
+    expect(
+      JSON.parse(serializeWorkspace({ ...ws, panelSizes: { 'pane-9': { rules: 3 } } })).panelSizes,
+      'no field where the one view that held a share has left the tree',
+    ).toBeUndefined()
     expect(back.panels).toEqual({ 'tm-0': { rules: false } })
     expect(back.display).toEqual({ 'lambda-0': outline })
     expect(back.tmDisplay).toEqual({ 'tm-0': { level: 'program', edges: 'chips' } })
@@ -261,6 +300,16 @@ describe('withPanel', () => {
   })
 })
 
+describe('withPanelSizes', () => {
+  it('records one view’s shares without touching the others, and leaves out a view that holds none', () => {
+    const next = withPanelSizes({ 'tm-0': { rules: 2.5 } }, 'pane-1', { term: 1.5, map: 0.5 })
+    expect(next).toEqual({ 'tm-0': { rules: 2.5 }, 'pane-1': { term: 1.5, map: 0.5 } })
+    expect(withPanelSizes(next, 'pane-1', { term: 2 })).toEqual({ 'tm-0': { rules: 2.5 }, 'pane-1': { term: 2 } })
+    expect(withPanelSizes(next, 'tm-0', {})).toEqual({ 'pane-1': { term: 1.5, map: 0.5 } })
+    expect(withPanelSizes({}, 'tm-0', {})).toEqual({})
+  })
+})
+
 describe('defaultWorkspace', () => {
   it('is the source beside the TM view, Explorer, speed 8, focused on the TM view, nothing remembered', () => {
     const ws = defaultWorkspace('wide')
@@ -345,16 +394,20 @@ describe('the remembered arrangements', () => {
       focused: 'tm-0',
       arrangements: { [treeKey(FOUR)]: FOUR },
       panels: { 'lambda-0': { map: false } },
+      panelSizes: { 'lambda-0': { term: 1.5, map: 0.5 } },
       display: { 'lambda-0': { layout: 'outline', vars: 'names', map: 'icicle' } },
       tmDisplay: { 'tm-0': { level: 'local', edges: 'chips' } },
     }
     const ws = parseWorkspace(JSON.stringify(stored))
     expect(ws?.panels).toEqual(stored.panels)
+    expect(ws?.panelSizes).toEqual(stored.panelSizes)
     expect(ws?.display).toEqual(stored.display)
     if (ws === null || ws === undefined) throw new Error('unreachable')
     expect(JSON.parse(serializeWorkspace(ws)).panels).toEqual(stored.panels)
+    expect(JSON.parse(serializeWorkspace(ws)).panelSizes).toEqual(stored.panelSizes)
     expect(JSON.parse(serializeWorkspace(ws)).display).toEqual(stored.display)
     expect(parseWorkspace(JSON.stringify({ ...stored, panels: { 'pane-9': { map: false } } }))).toBeNull()
+    expect(parseWorkspace(JSON.stringify({ ...stored, panelSizes: { 'pane-9': { map: 1 } } }))).toBeNull()
   })
 
   /**
```

- [ ] **Step 2: Run them, and see them fail**

```bash
pnpm exec vitest run --project node tests/node/workspace.test.ts tests/node/share-link.test.ts
```

On the replay, with this task's tests written and its source not: `t2-fail.log`: files: 2 failed (2); tests: 6 failed | 81 passed (87).

```
tests/node/share-link.test.ts > the frozen link from version 1 > opens whole, as the program, the encoding, the workspace and the positions it was written with
tests/node/workspace.test.ts > parseWorkspace > defaults missing panel sizes to none stored, and refuses a malformed one
tests/node/workspace.test.ts > parseWorkspace > round-trips version 2
tests/node/workspace.test.ts > serializeWorkspace > drops the panel state and the display of a leaf that has left the tree, and a focus on one
tests/node/workspace.test.ts > the remembered arrangements > keeps the panel state and the display of a view only a remembered tree holds, and refuses one no tree holds
tests/node/workspace.test.ts > withPanelSizes > records one view’s shares without touching the others, and leaves out a view that holds none
```

- [ ] **Step 3: Write the source**

In `web/src/main.ts`:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1360,6 +1360,7 @@ async function main(): Promise<EditorView> {
     speed: restored.speed,
     focused: restored.focused,
     panels: restored.panels,
+    panelSizes: restored.panelSizes,
     inspector: restored.inspector,
     display: restored.display,
     tmDisplay: restored.tmDisplay,
@@ -1398,7 +1399,13 @@ async function main(): Promise<EditorView> {
       if (closed.size > 0) {
         const without = <T>(by: Readonly<Record<LeafId, T>>): Record<LeafId, T> =>
           Object.fromEntries(Object.entries(by).filter(([leaf]) => !closed.has(leaf)))
-        ws = { ...ws, panels: without(ws.panels), display: without(ws.display), tmDisplay: without(ws.tmDisplay) }
+        ws = {
+          ...ws,
+          panels: without(ws.panels),
+          panelSizes: without(ws.panelSizes),
+          display: without(ws.display),
+          tmDisplay: without(ws.tmDisplay),
+        }
       }
     }
     tree = entered.tree
@@ -1433,7 +1440,8 @@ async function main(): Promise<EditorView> {
     const panels = Object.fromEntries(Object.entries(ws.panels).filter(([leaf]) => live.has(leaf)))
     const display = Object.fromEntries(Object.entries(ws.display).filter(([leaf]) => live.has(leaf)))
     const tmDisplay = Object.fromEntries(Object.entries(ws.tmDisplay).filter(([leaf]) => live.has(leaf)))
-    ws = { ...ws, focused: focusedLeaf(), panels, display, tmDisplay }
+    const panelSizes = Object.fromEntries(Object.entries(ws.panelSizes).filter(([leaf]) => live.has(leaf)))
+    ws = { ...ws, focused: focusedLeaf(), panels, panelSizes, display, tmDisplay }
   }
 
   const persistWorkspace = (): void => {
```

In `web/src/workspace.ts`:

```diff
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -85,6 +85,12 @@ export const DEFAULT_TM_DISPLAY: TmDisplay = { level: 'program', edges: 'arcs' }
 /** Each TM view's display settings, by leaf — a view with none stored draws with `DEFAULT_TM_DISPLAY`. */
 export type TmDisplays = Readonly<Record<LeafId, TmDisplay>>
 
+/**
+ * Per view, per region name, the share of the view's height the region takes (the view layouts spec §11.4). A region
+ * with no entry has the share it is built with, and a view with none looks as it did before a boundary could move.
+ */
+export type PanelSizes = Readonly<Record<LeafId, Readonly<Record<string, number>>>>
+
 export type Workspace = {
   readonly tree: LayoutNode
   readonly switches: Switches
@@ -92,6 +98,8 @@ export type Workspace = {
   /** The view the user is in — any leaf, the source view included. It drives the readout (spec §9). */
   readonly focused: LeafId
   readonly panels: Panels
+  /** Beside `panels`, and kept and dropped with it: a parked view keeps its sizes, a closed view's are dropped. */
+  readonly panelSizes: PanelSizes
   /**
    * Whether the inspector is open — spec §9, and the one field that is NOT a view's panel.
    *
@@ -140,6 +148,7 @@ export function defaultWorkspace(shape: Shape): Workspace {
     speed: DEFAULT_SPEED,
     focused: defaultFocus(tree),
     panels: {},
+    panelSizes: {},
     inspector: true,
     display: {},
     tmDisplay: {},
@@ -157,6 +166,12 @@ export function withTmDisplay(tmDisplay: TmDisplays, leaf: LeafId, d: TmDisplay)
   return { ...tmDisplay, [leaf]: d }
 }
 
+/** `panelSizes` with one view's shares recorded, or with the view left out where it holds none. */
+export function withPanelSizes(sizes: PanelSizes, leaf: LeafId, own: Readonly<Record<string, number>>): PanelSizes {
+  const { [leaf]: _, ...rest } = sizes
+  return Object.keys(own).length === 0 ? rest : { ...rest, [leaf]: own }
+}
+
 /** `panels` with one panel of one view recorded — a new object, as every operation in `layout.ts` returns. */
 export function withPanel(panels: Panels, leaf: LeafId, name: string, open: boolean): Panels {
   return { ...panels, [leaf]: { ...panels[leaf], [name]: open } }
@@ -185,6 +200,8 @@ export function serializeWorkspace(ws: Workspace): string {
   const onScreen = new Set(leaves(ws.tree).map((l) => l.id))
   const panels: Record<LeafId, Record<string, boolean>> = {}
   for (const [leaf, open] of Object.entries(ws.panels)) if (live.has(leaf)) panels[leaf] = { ...open }
+  const panelSizes: Record<LeafId, Record<string, number>> = {}
+  for (const [leaf, sizes] of Object.entries(ws.panelSizes)) if (live.has(leaf)) panelSizes[leaf] = { ...sizes }
   const display: Record<LeafId, LambdaDisplay> = {}
   for (const [leaf, d] of Object.entries(ws.display)) if (live.has(leaf)) display[leaf] = d
   const tmDisplay: Record<LeafId, TmDisplay> = {}
@@ -199,6 +216,7 @@ export function serializeWorkspace(ws: Workspace): string {
     inspector: ws.inspector,
     display,
     tmDisplay,
+    ...(Object.keys(panelSizes).length === 0 ? {} : { panelSizes }),
     ...(Object.keys(ws.arrangements).length === 0 ? {} : { arrangements: ws.arrangements }),
   })
 }
@@ -290,6 +308,23 @@ function parsePanels(v: unknown, ids: ReadonlySet<string>): Panels | null {
   return out
 }
 
+/** `parsePanels`' rules, for shares: an entry names a live view, and a share is a finite number above 0. */
+function parsePanelSizes(v: unknown, ids: ReadonlySet<string>): PanelSizes | null {
+  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
+  const out: Record<LeafId, Record<string, number>> = {}
+  for (const [leaf, sizes] of Object.entries(v as Record<string, unknown>)) {
+    if (!ids.has(leaf)) return null
+    if (typeof sizes !== 'object' || sizes === null || Array.isArray(sizes)) return null
+    const own: Record<string, number> = {}
+    for (const [name, share] of Object.entries(sizes as Record<string, unknown>)) {
+      if (typeof share !== 'number' || !Number.isFinite(share) || share <= 0) return null
+      own[name] = share
+    }
+    out[leaf] = own
+  }
+  return out
+}
+
 /**
  * The stored workspace, or `null` if there is nothing usable there.
  *
@@ -318,6 +353,7 @@ export function parseWorkspace(raw: string | null): Workspace | null {
       speed: DEFAULT_SPEED,
       focused: defaultFocus(tree),
       panels: {},
+      panelSizes: {},
       inspector: true,
       display: {},
       tmDisplay: {},
@@ -340,6 +376,9 @@ export function parseWorkspace(raw: string | null): Workspace | null {
   const ids = new Set(liveLeaves(tree, arrangements).keys())
   const panels = parsePanels(e.panels, ids)
   if (panels === null) return null
+  // A MISSING `panelSizes` IS NOT AN INVALID ONE, for `inspector`'s reason below.
+  const panelSizes = e.panelSizes === undefined ? {} : parsePanelSizes(e.panelSizes, ids)
+  if (panelSizes === null) return null
   // **A MISSING `inspector` IS NOT AN INVALID ONE.** Version 2 shipped in part 2a without this field, so
   // every workspace stored before part 2b has none — refusing them would reset the layout of exactly the
   // users the version 2 envelope was built to carry across. A field that IS there and is not a boolean is
@@ -355,6 +394,7 @@ export function parseWorkspace(raw: string | null): Workspace | null {
     speed: e.speed,
     focused: e.focused,
     panels,
+    panelSizes,
     inspector: e.inspector ?? true,
     display,
     tmDisplay,
```

- [ ] **Step 4: Run them, and see them pass**

```bash
pnpm exec vitest run --project node tests/node/workspace.test.ts tests/node/share-link.test.ts
```

On the replay (`t2-pass.log`): files: 70 passed (70); tests: 1405 passed (1405).

- [ ] **Step 5: Break it on purpose, once a sabotage, and put it back**

Each entry is the replay's own record. Its `sab.py` saved the file, made the edit, ran
`pnpm exec vitest run --project <project> <files>` on the files named, copied the saved file back and compared
the two byte for byte.

**S2a** `workspace.ts`: `panelSizes` is written even where no view holds a share. Run: `tests/node/workspace.test.ts` (`sab-S2a.log`): 1 failed | 45 passed (46). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -216,7 +216,7 @@
     inspector: ws.inspector,
     display,
     tmDisplay,
-    ...(Object.keys(panelSizes).length === 0 ? {} : { panelSizes }),
+    panelSizes,
     ...(Object.keys(ws.arrangements).length === 0 ? {} : { arrangements: ws.arrangements }),
   })
 }
```

What failed:

```
serializeWorkspace > drops the panel state and the display of a leaf that has left the tree, and a focus on one
```

**S2b** `workspace.ts`: a share of 0 is read. Run: `tests/node/workspace.test.ts` (`sab-S2b.log`): 1 failed | 45 passed (46). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -317,7 +317,7 @@
     if (typeof sizes !== 'object' || sizes === null || Array.isArray(sizes)) return null
     const own: Record<string, number> = {}
     for (const [name, share] of Object.entries(sizes as Record<string, unknown>)) {
-      if (typeof share !== 'number' || !Number.isFinite(share) || share <= 0) return null
+      if (typeof share !== 'number' || !Number.isFinite(share) || share < 0) return null
       own[name] = share
     }
     out[leaf] = own
```

What failed:

```
parseWorkspace > defaults missing panel sizes to none stored, and refuses a malformed one
```

**S2c** `workspace.ts`: a share that is not finite is read. Run: `tests/node/workspace.test.ts` (`sab-S2c.log`): 1 failed | 45 passed (46). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -317,7 +317,7 @@
     if (typeof sizes !== 'object' || sizes === null || Array.isArray(sizes)) return null
     const own: Record<string, number> = {}
     for (const [name, share] of Object.entries(sizes as Record<string, unknown>)) {
-      if (typeof share !== 'number' || !Number.isFinite(share) || share <= 0) return null
+      if (typeof share !== 'number' || share <= 0) return null
       own[name] = share
     }
     out[leaf] = own
```

What failed:

```
parseWorkspace > defaults missing panel sizes to none stored, and refuses a malformed one
```

**S2d** `workspace.ts`: an entry for a view no tree holds is read. Run: `tests/node/workspace.test.ts` (`sab-S2d.log`): 2 failed | 44 passed (46). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -313,7 +313,7 @@
   if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
   const out: Record<LeafId, Record<string, number>> = {}
   for (const [leaf, sizes] of Object.entries(v as Record<string, unknown>)) {
-    if (!ids.has(leaf)) return null
+    if (ids.size < 0) return null
     if (typeof sizes !== 'object' || sizes === null || Array.isArray(sizes)) return null
     const own: Record<string, number> = {}
     for (const [name, share] of Object.entries(sizes as Record<string, unknown>)) {
```

What failed:

```
parseWorkspace > defaults missing panel sizes to none stored, and refuses a malformed one
the remembered arrangements > keeps the panel state and the display of a view only a remembered tree holds, and refuses one no tree holds
```

**S2e** `workspace.ts`: the shares of a view that has left every tree are written. Run: `tests/node/workspace.test.ts` (`sab-S2e.log`): 1 failed | 45 passed (46). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -201,7 +201,7 @@
   const panels: Record<LeafId, Record<string, boolean>> = {}
   for (const [leaf, open] of Object.entries(ws.panels)) if (live.has(leaf)) panels[leaf] = { ...open }
   const panelSizes: Record<LeafId, Record<string, number>> = {}
-  for (const [leaf, sizes] of Object.entries(ws.panelSizes)) if (live.has(leaf)) panelSizes[leaf] = { ...sizes }
+  for (const [leaf, sizes] of Object.entries(ws.panelSizes)) panelSizes[leaf] = { ...sizes }
   const display: Record<LeafId, LambdaDisplay> = {}
   for (const [leaf, d] of Object.entries(ws.display)) if (live.has(leaf)) display[leaf] = d
   const tmDisplay: Record<LeafId, TmDisplay> = {}
```

What failed:

```
serializeWorkspace > drops the panel state and the display of a leaf that has left the tree, and a focus on one
```

**S2f** `workspace.ts`: `withPanelSizes` keeps an entry for a view that holds no share. Run: `tests/node/workspace.test.ts` (`sab-S2f.log`): 1 failed | 45 passed (46). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -169,7 +169,7 @@
 /** `panelSizes` with one view's shares recorded, or with the view left out where it holds none. */
 export function withPanelSizes(sizes: PanelSizes, leaf: LeafId, own: Readonly<Record<string, number>>): PanelSizes {
   const { [leaf]: _, ...rest } = sizes
-  return Object.keys(own).length === 0 ? rest : { ...rest, [leaf]: own }
+  return { ...rest, [leaf]: own }
 }
 
 /** `panels` with one panel of one view recorded — a new object, as every operation in `layout.ts` returns. */
```

What failed:

```
withPanelSizes > records one view’s shares without touching the others, and leaves out a view that holds none
```

- [ ] **Step 6: The whole suite**

`pnpm exec biome ci --error-on-warnings`, `pnpm exec tsc --noEmit -p .`, `pnpm exec vitest run --project node` and
`pnpm exec vitest run --project browser`, all from `web/`. On the replay, after this task:

`biome ci` exit 0, typecheck exit 0. Node (`t2-suite-node.log`): 70 passed (70) files, 1405 passed (1405) tests. Browser (`t2-suite-browser.log`): 204 passed (204) files, 1433 passed (1433) tests, with the machine's load average at 6.94 before the run and 9.84 after it.

- [ ] **Step 7: Commit**

```bash
git add web/src/main.ts \
  web/src/workspace.ts \
  web/tests/node/share-link.test.ts \
  web/tests/node/workspace.test.ts
git commit -F - <<'EOF'
The workspace holds a view's shares for its regions: `panelSizes`, a field that may be absent

For a view, by leaf id, a share for each of its regions by name (the view layouts spec §11.4). It is read by
`parsePanels`' rules, an entry naming a live view and a share being a finite number above 0, and written only while a
view holds one, so a workspace that holds none is the string it was. It follows the panel state it sits beside:
kept for a view a remembered arrangement holds, dropped with a view a `✕` closes (`main.ts`'s `enterTree`) and with
one *reset preset* or a link does without (`normaliseWorkspace`). Nothing writes one yet.
EOF
```

### Task 3: Boundaries between the regions of the TM and asm views, a header that is the handle for one, and a maximise button on each panel

The stack of regions (spec §11.1 to §11.4), in the two views that already share their height. `panel-stack.ts` is
whole from this task; the λ view and the source view are given theirs in Task 4, so four test files are in a form
they do not keep: `panel-maximise.test.ts` without its λ case, `panel-regions.test.ts` with a copy's text alone,
`panel-sizes-stored.test.ts` with the TM view's cases, and `panel-sizes-restore.test.ts` without the source view's.

**`tm-view-narrow.test.ts`'s case at 1280 px is re-pinned**, and nothing else in that file: each header's actions are
32.78 px further left for the maximise button, and no panel, header, toggle, name or body moved.

**Files:**

- Modify: `web/help.html`
- Modify: `web/src/asm-pane.ts`
- Modify: `web/src/copy-editor.ts`
- Modify: `web/src/icons.ts`
- Modify: `web/src/main.ts`
- Modify: `web/src/pane-chrome.ts`
- Modify: `web/src/pane-host.ts`
- Create: `web/src/panel-stack.ts`
- Modify: `web/src/panel.ts`
- Modify: `web/src/style.css`
- Modify: `web/src/tm-pane.ts`
- Create: `web/tests/browser/panel-boundaries.test.ts`
- Create: `web/tests/browser/panel-maximise.test.ts`
- Create: `web/tests/browser/panel-regions.test.ts`
- Create: `web/tests/browser/panel-sizes-restore.test.ts`
- Create: `web/tests/browser/panel-sizes-stored.test.ts`
- Modify: `web/tests/browser/tm-view-narrow.test.ts`

**Interfaces:**

- Consumes: Task 1's `pointerDrag` and `separatorGesture`; Task 2's `PanelSizes` and `withPanelSizes`.
- Produces, in `web/src/panel.ts`: `PanelOptions.onDrawn?: () => void`, `Panel.drawOver(over: boolean | null)`,
  `Panel.onGesture(heard)`; `Panel.isOpen()` answers what is drawn.
- Produces, in `web/src/panel-stack.ts`: `type StackRegion = { name; label; el; share: number | null; panels;
  bodies }`, `type Shares = Readonly<Record<string, number>>`, `BOUNDARY_KEY_STEP`, and
  `new PanelStack(regions, sizes, onSizes)` with `setSizes(sizes)`, `sync()` and `maximised`.
- Produces, in `web/src/pane-chrome.ts`: `PaneEvents.panelSizes?: (sizes: Shares) => void`, and `textPanel`'s
  `panel`.
- Produces, in `web/src/copy-editor.ts`: `CopyEditor.text` and `CopyEditor.outlinePanel`.
- Produces, in `web/src/pane-host.ts`: two new dependencies of `createPaneHost`, `panelSizesOf(leaf)` and
  `setPanelSizes(leaf, sizes)`; `TmPane` and `AsmPane` take a view's shares as their last argument.
- Produces, in the markup: `.panel-boundary[data-above][data-below]`, `.panel-maximise`, `[data-region]`,
  `[data-sized]`, `.panel-header[data-resizes]`.

- [ ] **Step 1: Write the tests**

Create `web/tests/browser/panel-boundaries.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { AsmPanels } from '../../src/asm-pane'
import { AsmPane } from '../../src/asm-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import { BOUNDARY_KEY_STEP, type Shares } from '../../src/panel-stack'
import { FACT3, frameOf } from '../node/asm-fixtures'

/**
 * THE BOUNDARIES BETWEEN A VIEW'S REGIONS, AND THE HEADER THAT IS A HANDLE FOR ONE — the view layouts spec §11.2,
 * `panel-stack.ts`. Held on an asm view built directly, as `asm-pane.test.ts` builds one: it has three regions on a
 * view of the program, the listing, the row of registers and call stack, and the heap, so a drag has a region that
 * must NOT move. `panel-maximise.test.ts` has the maximise button and `panel-sizes-stored.test.ts` the workspace.
 *
 * **EVERY DRAG IS THE DRIVER'S OWN WHERE ONE MOVE IS ENOUGH** (`userEvent.dragAndDrop`: a press, a move, a release).
 * Three cases need more than the driver gives and make their own pointer events, and each says so: a pointer that
 * overshoots a floor and comes back, a finger, and a press that is held.
 */

const CONTROLS = {
  canRestart: true,
  canBack: true,
  canForward: true,
  canToNewest: true,
  canPlay: true,
  playing: false,
  stepText: 'step 3 of 55',
  continueLabel: null,
}

function events(over: Partial<PaneEvents> = {}): PaneEvents {
  return {
    back: vi.fn(),
    forward: vi.fn(),
    toNewest: vi.fn(),
    play: vi.fn(),
    restart: vi.fn(),
    extend: vi.fn(),
    speed: () => 8,
    setSpeed: vi.fn(),
    rebind: vi.fn(),
    ...over,
  }
}

/** A view of `FACT3` in a host `height` by `width`, on the page, with a frame drawn. */
function mount(
  o: { height?: number; width?: number; panels?: AsmPanels; sizes?: Shares; on?: Partial<PaneEvents> } = {},
) {
  const sizes = vi.fn<(s: Shares) => void>()
  const panel = vi.fn<(name: string, open: boolean) => void>()
  const host = document.createElement('section')
  host.className = 'pane'
  host.dataset.kind = 'asm'
  host.style.height = `${o.height ?? 900}px`
  host.style.width = `${o.width ?? 1000}px`
  document.body.append(host)
  const pane = new AsmPane(host, events({ panelSizes: sizes, panel, ...o.on }), o.panels ?? {}, o.sizes ?? {})
  pane.setProgram(FACT3)
  pane.render(frameOf({ pc: 3, next: 3 }), CONTROLS)
  return { host, pane, sizes, panel }
}

const region = (host: HTMLElement, name: string) => host.querySelector(`[data-region="${name}"]`) as HTMLElement
const height = (host: HTMLElement, name: string) => region(host, name).getBoundingClientRect().height
const heights = (host: HTMLElement) => ({
  listing: height(host, 'listing'),
  machine: height(host, 'machine'),
  heap: height(host, 'heap'),
})
const boundaries = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.panel-boundary')]
const boundary = (host: HTMLElement, above: string, below: string) =>
  host.querySelector(`.panel-boundary[data-above="${above}"][data-below="${below}"]`) as HTMLElement
const panelOf = (host: HTMLElement, name: string) => host.querySelector(`[data-panel="${name}"]`) as HTMLElement
const header = (host: HTMLElement, name: string) => panelOf(host, name).querySelector('.panel-header') as HTMLElement
const toggle = (host: HTMLElement, name: string) => panelOf(host, name).querySelector('.panel-toggle') as HTMLElement
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))
/** The last shares a gesture reported. */
const last = (sizes: ReturnType<typeof vi.fn>): Shares => sizes.mock.calls.at(-1)?.[0] as Shares

/**
 * A real drag: a press at the middle of `handle`'s empty part and a release `dy` pixels down from it (up, for a
 * negative `dy`), measured against the host so the driver has one element to aim both ends at.
 */
async function drag(host: HTMLElement, handle: HTMLElement, dy: number): Promise<void> {
  const [h, area] = [handle.getBoundingClientRect(), host.getBoundingClientRect()]
  const x = h.left - area.left + h.width / 2
  const y = h.top - area.top + h.height / 2
  await userEvent.dragAndDrop(host, host, { sourcePosition: { x, y }, targetPosition: { x, y: y + dy } })
  await frame()
}

/** A pointer event of this file's own making on `el`, at `y`, for what the driver's one-move drag cannot do. */
const fire = (el: HTMLElement, type: string, y: number, pointerType = 'mouse'): void => {
  const box = el.getBoundingClientRect()
  el.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      bubbles: true,
      cancelable: true,
      clientX: box.left + box.width / 2,
      clientY: y,
      isPrimary: true,
      button: 0,
      pointerType,
    }),
  )
}
const middle = (el: HTMLElement): number => el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2

// A VIEWPORT AS WIDE AND AS TALL AS A VIEW: a real press aimed past the page's edge lands on nothing.
beforeAll(async () => {
  await page.viewport(1280, 1000)
  // THE PAGE'S FONTS FIRST, ASKED FOR BY NAME, since nothing on the page has used them yet: a line's height is the
  // font's, and a floor of five lines and a header's height settle as the fonts arrive.
  await Promise.all([document.fonts.load('12px "Hack"'), document.fonts.load('12px "Inter"')])
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the boundaries of a view', () => {
  it('are drawn under each open region that has an open region below it, and named for the two', () => {
    const { host } = mount()
    expect(boundaries(host).map((b) => b.getAttribute('aria-label'))).toEqual([
      'resize listing and registers and call stack',
      'resize registers and call stack and heap',
    ])
    for (const b of boundaries(host)) {
      expect(b.getAttribute('role')).toBe('separator')
      expect(b.getAttribute('aria-orientation')).toBe('horizontal')
      expect(b.tabIndex).toBe(0)
      expect(b.getAttribute('aria-valuemin')).toBe('0')
      expect(b.getAttribute('aria-valuemax')).toBe('100')
    }
    // DIRECTLY UNDER THE UPPER REGION, and as tall as the gap the lower one kept above itself, which it takes.
    expect(boundary(host, 'listing', 'machine').previousElementSibling).toBe(region(host, 'listing'))
    expect(boundary(host, 'machine', 'heap').previousElementSibling).toBe(region(host, 'machine'))
    expect(boundary(host, 'listing', 'machine').getBoundingClientRect().height).toBe(8)
    expect(
      region(host, 'machine').getBoundingClientRect().top - region(host, 'listing').getBoundingClientRect().bottom,
      'the boundary is the whole of what parts the two regions',
    ).toBe(8)
    // THE UPPER REGION'S PART OF THE TWO, from the shares they are built with: the listing's two of three, and an
    // even half for the row and the heap.
    expect(boundary(host, 'listing', 'machine').getAttribute('aria-valuenow')).toBe('67')
    expect(boundary(host, 'machine', 'heap').getAttribute('aria-valuenow')).toBe('50')
  })

  it('share the view as the stylesheet fixed it before one could be dragged: two, one and one', () => {
    const { host } = mount()
    const h = heights(host)
    expect(h.listing / h.machine, 'the listing is twice the row').toBeCloseTo(2, 1)
    expect(h.machine, 'the row and the heap are even').toBeCloseTo(h.heap, 0)
    expect(host.scrollHeight, 'precondition: the view does not scroll').toBe(host.clientHeight)
  })

  it('skip a closed region, and are drawn beside it again once it is open', async () => {
    const { host } = mount()
    await userEvent.click(toggle(host, 'registers'))
    expect(boundaries(host), 'one of the row’s two panels is still open').toHaveLength(2)
    await userEvent.click(toggle(host, 'stack'))
    await frame()
    expect(boundaries(host).map((b) => b.getAttribute('aria-label'))).toEqual(['resize listing and heap'])
    expect(boundary(host, 'listing', 'heap').previousElementSibling, 'under the upper of the two').toBe(
      region(host, 'listing'),
    )
    await userEvent.click(toggle(host, 'heap'))
    await frame()
    expect(boundaries(host), 'one open region has nothing to be parted from').toHaveLength(0)
    await userEvent.click(toggle(host, 'heap'))
    await userEvent.click(toggle(host, 'stack'))
    await frame()
    expect(boundaries(host)).toHaveLength(2)
  })

  it('draw nothing at rest or under the pointer, and a line for the keyboard’s focus', async () => {
    const { host } = mount()
    const b = boundary(host, 'listing', 'machine')
    expect(getComputedStyle(b, '::before').content, 'at rest').toBe('none')
    await userEvent.hover(b)
    expect(getComputedStyle(b, '::before').content, 'under the pointer').toBe('none')
    expect(getComputedStyle(b).cursor, 'the pointer is what says it can be held').toBe('grab')
    toggle(host, 'listing').focus()
    // `Tab` FROM THE LISTING'S LAST CONTROL: its maximise button, the last thing in its header.
    ;(panelOf(host, 'listing').querySelector('.panel-maximise') as HTMLElement).focus()
    await userEvent.keyboard('{Tab}')
    // THE LISTING'S GRID IS THE NEXT STOP, THEN THE BOUNDARY.
    if (document.activeElement !== b) await userEvent.keyboard('{Tab}')
    expect(document.activeElement, 'precondition: Tab reaches the boundary').toBe(b)
    expect(b.matches(':focus-visible'), 'precondition: a key’s focus').toBe(true)
    expect(getComputedStyle(b, '::before').content, 'under the keyboard’s focus').not.toBe('none')
    expect(getComputedStyle(b, '::before').height).toBe('2px')
  })
})

describe('a drag of a boundary', () => {
  it('moves the two regions it parts and no other, and the view does not grow', async () => {
    const { host, sizes } = mount()
    const before = heights(host)
    await drag(host, boundary(host, 'machine', 'heap'), -60)
    const after = heights(host)
    expect(after.machine, 'the row above gave 60 px').toBeCloseTo(before.machine - 60, 0)
    expect(after.heap, 'the heap below took them').toBeCloseTo(before.heap + 60, 0)
    expect(after.listing, 'the listing, which the boundary does not part, moved').toBeCloseTo(before.listing, 1)
    expect(host.scrollHeight, 'the view grew').toBe(host.clientHeight)
    // ONE REPORT A GESTURE, with a share for every open region, adding up to what they did: two, one and one.
    expect(sizes).toHaveBeenCalledTimes(1)
    const s = last(sizes)
    expect(Object.keys(s).sort()).toEqual(['heap', 'listing', 'machine'])
    expect((s.listing as number) + (s.machine as number) + (s.heap as number)).toBeCloseTo(4, 2)
    expect((s.heap as number) / (s.machine as number)).toBeCloseTo(after.heap / after.machine, 2)
    expect(s.listing as number, 'the share of the region that did not move').toBeCloseTo(2, 2)
  })

  it('stops where a neighbour would go under its floor of five rows', async () => {
    const { host } = mount()
    const body = panelOf(host, 'heap').querySelector('.asm-heap') as HTMLElement
    const floor = Number.parseFloat(getComputedStyle(body).minHeight)
    expect(floor, 'precondition: the heap’s body has a floor').toBeGreaterThan(50)
    expect(body.getBoundingClientRect().height, 'precondition: and is over it').toBeGreaterThan(floor + 50)
    const before = heights(host)
    await drag(host, boundary(host, 'machine', 'heap'), 600)
    expect(body.getBoundingClientRect().height, 'the heap’s body is not at its floor').toBeCloseTo(floor, 0)
    const after = heights(host)
    expect(after.machine + after.heap, 'the two regions’ heights do not add up to what they did').toBeCloseTo(
      before.machine + before.heap,
      0,
    )
    expect(after.listing, 'a drag past the floor took from a region it does not part').toBeCloseTo(before.listing, 1)
    expect(host.scrollHeight, 'the view grew').toBe(host.clientHeight)
  })

  /**
   * **A POINTER THAT OVERSHOOTS A FLOOR HAS TO COME ALL THE WAY BACK BEFORE THE BOUNDARY FOLLOWS IT.** Held with this
   * file's own pointer events, since the driver's drag is one move. With the two kept as one number, the boundary
   * left the floor the moment the pointer turned, 2,000 px away from it.
   */
  it('follows a pointer that overshot a floor only once it is back', async () => {
    const { host } = mount()
    const b = boundary(host, 'machine', 'heap')
    const before = heights(host)
    const y = middle(b)
    fire(b, 'pointerdown', y)
    fire(b, 'pointermove', y - 2000)
    await frame()
    const atFloor = heights(host)
    expect(atFloor.machine, 'precondition: the row above reached its floor').toBeLessThan(before.machine - 20)
    fire(b, 'pointermove', y - 1000)
    await frame()
    expect(heights(host).machine, 'the boundary left the floor with the pointer still past it').toBeCloseTo(
      atFloor.machine,
      1,
    )
    fire(b, 'pointermove', y - 10)
    await frame()
    expect(heights(host).machine, 'the boundary is not 10 px from where the press was').toBeCloseTo(
      before.machine - 10,
      0,
    )
    fire(b, 'pointerup', y - 10)
  })
})

describe('a panel’s header, as the handle for the boundary above it', () => {
  it('says so with the pointer where a boundary lies above it, and nowhere else', async () => {
    const { host } = mount()
    expect(header(host, 'listing').dataset.resizes, 'the first region has no boundary above').toBeUndefined()
    expect(getComputedStyle(header(host, 'listing')).cursor).not.toBe('grab')
    for (const name of ['registers', 'stack', 'heap']) {
      expect(header(host, name).dataset.resizes, name).toBe('true')
      expect(getComputedStyle(header(host, name)).cursor, name).toBe('grab')
      // EACH CONTROL ON THE BAR KEEPS ITS OWN POINTER.
      expect(getComputedStyle(toggle(host, name)).cursor, `${name}’s disclosure`).toBe('pointer')
    }
    // CLOSED, THE HEAP TAKES NO SHARE AND HAS NO BOUNDARY ABOVE IT.
    await userEvent.click(toggle(host, 'heap'))
    await frame()
    expect(header(host, 'heap').dataset.resizes, 'a closed region’s header').toBeUndefined()
  })

  it('drags that boundary by a real press on the bar’s empty part', async () => {
    const { host, sizes } = mount()
    const before = heights(host)
    await drag(host, header(host, 'heap'), -60)
    const after = heights(host)
    expect(after.heap, 'the heap did not take 60 px').toBeCloseTo(before.heap + 60, 0)
    expect(after.machine).toBeCloseTo(before.machine - 60, 0)
    expect(after.listing).toBeCloseTo(before.listing, 1)
    expect(sizes).toHaveBeenCalledTimes(1)
  })

  it('leaves a press on one of its controls to the control', async () => {
    const { host, sizes, panel } = mount()
    const before = heights(host)
    // A REAL CLICK ON THE DISCLOSURE: the panel closes, and nothing was dragged.
    await userEvent.click(toggle(host, 'heap'))
    expect(panel).toHaveBeenCalledExactlyOnceWith('heap', false)
    await userEvent.click(toggle(host, 'heap'))
    await frame()
    expect(heights(host), 'a click on the disclosure moved a boundary').toEqual(before)
    // AND A REAL DRAG THAT STARTS ON IT moves nothing: the press was the button's.
    const [t, area] = [toggle(host, 'heap').getBoundingClientRect(), host.getBoundingClientRect()]
    const at = { x: t.left - area.left + t.width / 2, y: t.top - area.top + t.height / 2 }
    await userEvent.dragAndDrop(host, host, { sourcePosition: { ...at }, targetPosition: { x: at.x, y: at.y - 60 } })
    await frame()
    expect(heights(host), 'a drag begun on the disclosure moved a boundary').toEqual(before)
    expect(sizes).not.toHaveBeenCalled()
  })

  /** A finger's press on a bar is left alone: a header is most of what a narrow view offers to scroll by. */
  it('leaves a finger’s press alone, which the boundary itself takes', async () => {
    const { host, sizes } = mount()
    const before = heights(host)
    const bar = header(host, 'heap')
    const y = middle(bar)
    fire(bar, 'pointerdown', y, 'touch')
    fire(bar, 'pointermove', y - 60, 'touch')
    await frame()
    fire(bar, 'pointerup', y - 60, 'touch')
    expect(heights(host), 'a finger on the bar dragged').toEqual(before)
    expect(bar.dataset.dragging, 'the bar is drawn held').toBeUndefined()
    expect(sizes).not.toHaveBeenCalled()
    const b = boundary(host, 'machine', 'heap')
    expect(getComputedStyle(b).touchAction, 'the boundary leaves a finger’s drag to the gesture').toBe('none')
    fire(b, 'pointerdown', middle(b), 'touch')
    fire(b, 'pointermove', middle(b) - 60, 'touch')
    await frame()
    expect(heights(host).heap, 'a finger on the boundary did not drag').toBeCloseTo(before.heap + 60, 0)
    fire(b, 'pointerup', middle(b), 'touch')
  })

  /** An open hand over a handle, and a closed one from the press to the release: `data-dragging`. */
  it('draws an open hand at rest and a closed one while it is held', async () => {
    const { host } = mount()
    for (const el of [header(host, 'heap'), boundary(host, 'machine', 'heap')]) {
      expect(getComputedStyle(el).cursor, 'at rest').toBe('grab')
      const y = middle(el)
      fire(el, 'pointerdown', y)
      expect(el.dataset.dragging, 'from the press').toBe('true')
      expect(getComputedStyle(el).cursor, 'held').toBe('grabbing')
      fire(el, 'pointerup', y)
      expect(el.dataset.dragging, 'after the release').toBeUndefined()
      expect(getComputedStyle(el).cursor, 'released').toBe('grab')
    }
  })

  it('puts the two regions back to the shares they are built with at a double click on the bar', async () => {
    const { host, sizes } = mount()
    const before = heights(host)
    await drag(host, header(host, 'heap'), -60)
    expect(heights(host).heap, 'precondition: the drag moved the boundary').toBeGreaterThan(before.heap + 50)
    await userEvent.dblClick(header(host, 'heap'))
    await frame()
    expect(heights(host).heap).toBeCloseTo(before.heap, 0)
    expect(heights(host).machine).toBeCloseTo(before.machine, 0)
    // THE TWO HOLD NO SHARE OF THEIR OWN AGAIN; the listing keeps the one the drag's commit gave it.
    expect(Object.keys(last(sizes))).toEqual(['listing'])
  })

  /**
   * IN A NARROW VIEW THE CALL STACK WRAPS UNDER THE REGISTERS, and its header is then in the middle of the row's
   * region, not along the boundary above it.
   */
  it('is not a handle on a panel that has wrapped under the one beside it', async () => {
    const { host } = mount({ width: 420, height: 1100 })
    await frame()
    const [r, s] = [panelOf(host, 'registers'), panelOf(host, 'stack')]
    expect(s.getBoundingClientRect().top, 'precondition: the call stack is under the registers').toBeGreaterThan(
      r.getBoundingClientRect().bottom - 1,
    )
    expect(header(host, 'registers').dataset.resizes).toBe('true')
    expect(header(host, 'stack').dataset.resizes, 'the wrapped panel’s header').toBeUndefined()
    const before = heights(host)
    await drag(host, header(host, 'stack'), -40)
    expect(heights(host), 'a drag of the wrapped panel’s header moved a boundary').toEqual(before)
  })
})

describe('a boundary moved with the keys', () => {
  it('moves by a step a press, and reports once for a key held down', async () => {
    const { host, sizes } = mount()
    const b = boundary(host, 'machine', 'heap')
    const before = heights(host)
    const shared = before.listing + before.machine + before.heap
    b.focus()
    await userEvent.keyboard('{ArrowUp}')
    await frame()
    expect(heights(host).heap, 'one press is not one step').toBeCloseTo(before.heap + BOUNDARY_KEY_STEP * shared, 0)
    expect(sizes, 'a press and its release are one gesture').toHaveBeenCalledTimes(1)
    // HELD: three repeats and one release.
    await userEvent.keyboard('{ArrowDown>3/}')
    await frame()
    expect(heights(host).heap).toBeCloseTo(before.heap - 2 * BOUNDARY_KEY_STEP * shared, 0)
    expect(sizes, 'a held key reported at each repeat').toHaveBeenCalledTimes(2)
    expect(document.activeElement, 'the boundary lost the focus').toBe(b)
    expect(b.getAttribute('aria-valuenow'), 'the value did not follow the keys').not.toBe('50')
  })

  it('goes back to the shares the two regions are built with at Enter', async () => {
    const { host, sizes } = mount()
    const b = boundary(host, 'machine', 'heap')
    const before = heights(host)
    b.focus()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    await frame()
    expect(heights(host).heap, 'precondition: the keys moved the boundary').toBeGreaterThan(before.heap + 20)
    await userEvent.keyboard('{Enter}')
    await frame()
    expect(heights(host).heap).toBeCloseTo(before.heap, 0)
    expect(Object.keys(last(sizes))).toEqual(['listing'])
    expect(b.getAttribute('aria-valuenow')).toBe('50')
    expect(document.activeElement, 'the reset took the focus from the boundary').toBe(b)
  })

  it('and at a double click on the boundary itself', async () => {
    const { host } = mount()
    const b = boundary(host, 'machine', 'heap')
    const before = heights(host)
    await drag(host, b, -60)
    expect(heights(host).heap, 'precondition: the drag moved the boundary').toBeGreaterThan(before.heap + 50)
    await userEvent.dblClick(boundary(host, 'machine', 'heap'))
    await frame()
    expect(heights(host).heap).toBeCloseTo(before.heap, 0)
  })
})

describe('a view built with shares', () => {
  it('draws each region at the share the workspace holds for it, and the others as they are built', () => {
    const { host } = mount({ sizes: { listing: 1, machine: 2 } })
    const h = heights(host)
    expect(h.machine / h.listing, 'the row is not twice the listing').toBeCloseTo(2, 1)
    expect(h.heap, 'the heap, with no share stored, is not the one it is built with').toBeCloseTo(h.listing, 0)
    expect(boundary(host, 'listing', 'machine').getAttribute('aria-valuenow')).toBe('33')
  })
})
```

Create `web/tests/browser/panel-maximise.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { AsmPanels } from '../../src/asm-pane'
import { AsmPane } from '../../src/asm-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { Shares } from '../../src/panel-stack'
import { FACT3, frameOf } from '../node/asm-fixtures'

/**
 * THE MAXIMISE BUTTON ON EACH PANEL — the view layouts spec §11.3, `panel-stack.ts` and `panel.ts`'s `drawOver`.
 *
 * Pressed, its panel takes all of the view's spare height and every other panel of the view is DRAWN closed, its
 * header alone; what each one stores is not changed, which is held here by the view's `panel` event, the one thing
 * that writes a panel's state to the workspace. Held on an asm view built directly, which has four panels in three
 * regions, and on a λ view for the region that has no header to be drawn closed as.
 */

const CONTROLS = {
  canRestart: true,
  canBack: true,
  canForward: true,
  canToNewest: true,
  canPlay: true,
  playing: false,
  stepText: 'step 3 of 55',
  continueLabel: null,
}

function events(over: Partial<PaneEvents> = {}): PaneEvents {
  return {
    back: vi.fn(),
    forward: vi.fn(),
    toNewest: vi.fn(),
    play: vi.fn(),
    restart: vi.fn(),
    extend: vi.fn(),
    speed: () => 8,
    setSpeed: vi.fn(),
    rebind: vi.fn(),
    ...over,
  }
}

function mount(panels: AsmPanels = {}) {
  const sizes = vi.fn<(s: Shares) => void>()
  const panel = vi.fn<(name: string, open: boolean) => void>()
  const host = document.createElement('section')
  host.className = 'pane'
  host.dataset.kind = 'asm'
  host.style.height = '900px'
  host.style.width = '1000px'
  document.body.append(host)
  const pane = new AsmPane(host, events({ panelSizes: sizes, panel }), panels)
  pane.setProgram(FACT3)
  pane.render(frameOf({ pc: 3, next: 3 }), CONTROLS)
  return { host, pane, sizes, panel }
}

const NAMES = ['listing', 'registers', 'stack', 'heap'] as const
const panelOf = (host: HTMLElement, name: string) => host.querySelector(`[data-panel="${name}"]`) as HTMLElement
const toggle = (host: HTMLElement, name: string) => panelOf(host, name).querySelector('.panel-toggle') as HTMLElement
const maximise = (host: HTMLElement, name: string) =>
  panelOf(host, name).querySelector('.panel-maximise') as HTMLButtonElement
const body = (host: HTMLElement, name: string) =>
  panelOf(host, name).querySelector(':scope > :not(.panel-header)') as HTMLElement
/** Each panel as it is drawn: open or closed, by its disclosure's `aria-expanded` and its body's `hidden`. */
const drawn = (host: HTMLElement): Record<string, boolean> =>
  Object.fromEntries(
    NAMES.map((n) => {
      const open = toggle(host, n).getAttribute('aria-expanded') === 'true'
      if (body(host, n).hidden === open) throw new Error(`${n}: aria-expanded and hidden disagree`)
      return [n, open]
    }),
  )
const pressed = (host: HTMLElement): string[] =>
  NAMES.filter((n) => maximise(host, n).getAttribute('aria-pressed') === 'true')
const heightOf = (el: Element) => el.getBoundingClientRect().height
const boundaries = (host: HTMLElement) => host.querySelectorAll('.panel-boundary').length
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

beforeAll(async () => {
  await page.viewport(1280, 1000)
  // THE PAGE'S FONTS FIRST, ASKED FOR BY NAME, since nothing on the page has used them yet: a line's height is the
  // font's, and a floor of five lines and a header's height settle as the fonts arrive.
  await Promise.all([document.fonts.load('12px "Hack"'), document.fonts.load('12px "Inter"')])
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('a panel’s maximise button', () => {
  it('is in each panel’s header after its other actions, named for its panel, and not pressed', () => {
    const { host } = mount()
    expect(NAMES.map((n) => maximise(host, n).getAttribute('aria-label'))).toEqual([
      'maximise listing',
      'maximise registers',
      'maximise call stack',
      'maximise heap',
    ])
    for (const n of NAMES) {
      const b = maximise(host, n)
      expect(b.getAttribute('aria-pressed'), n).toBe('false')
      expect(b.title, `${n}’s tooltip`).toBe(b.getAttribute('aria-label'))
      expect(b.parentElement?.lastElementChild, `${n}’s is not the last of its actions`).toBe(b)
      expect(b.type).toBe('button')
    }
  })

  it('gives its panel the view’s spare height and draws every other panel closed, storing nothing', async () => {
    const { host, panel, sizes } = mount()
    const before = { ...drawn(host) }
    expect(before, 'precondition: all four are open').toEqual({
      listing: true,
      registers: true,
      stack: true,
      heap: true,
    })
    const was = heightOf(panelOf(host, 'heap'))
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    expect(pressed(host)).toEqual(['heap'])
    expect(drawn(host)).toEqual({ listing: false, registers: false, stack: false, heap: true })
    expect(boundaries(host), 'a boundary is drawn beside a maximised panel').toBe(0)
    // ALL OF WHAT THE VIEW HAS SPARE: the heap's panel ends at the view's bottom, and the view does not scroll.
    expect(heightOf(panelOf(host, 'heap')), 'the heap did not grow').toBeGreaterThan(was + 300)
    expect(panelOf(host, 'heap').getBoundingClientRect().bottom).toBeCloseTo(host.getBoundingClientRect().bottom, 0)
    expect(host.scrollHeight).toBe(host.clientHeight)
    for (const n of ['listing', 'registers', 'stack'])
      expect(heightOf(panelOf(host, n)), `${n} is more than its header`).toBeCloseTo(
        heightOf(panelOf(host, n).querySelector('.panel-header') as HTMLElement),
        0,
      )
    expect(panel, 'a maximise wrote a panel’s state to the workspace').not.toHaveBeenCalled()
    expect(sizes, 'a maximise wrote a share').not.toHaveBeenCalled()

    // PRESSED AGAIN, the regions are drawn as they are stored.
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    expect(pressed(host)).toEqual([])
    expect(drawn(host)).toEqual(before)
    expect(heightOf(panelOf(host, 'heap'))).toBeCloseTo(was, 0)
    expect(boundaries(host)).toBe(2)
    expect(panel).not.toHaveBeenCalled()
  })

  it('draws the listing again when a maximise that hid it ends, and does not draw into it while it is hidden', async () => {
    const { host, pane } = mount()
    const rows = () => host.querySelectorAll('.asm-listing .asm-row').length
    expect(rows(), 'precondition: the listing is drawn').toBeGreaterThan(3)
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    pane.render(frameOf({ pc: 13, next: 13 }), CONTROLS)
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    const next = host.querySelector('.asm-listing .asm-row.is-next')
    expect(next?.textContent, 'the listing was not drawn at the step the view is on').toContain('pc13')
  })

  it('moves to another panel when that one’s is pressed', async () => {
    const { host, panel } = mount()
    await userEvent.click(maximise(host, 'heap'))
    await userEvent.click(maximise(host, 'listing'))
    await frame()
    expect(pressed(host)).toEqual(['listing'])
    expect(drawn(host)).toEqual({ listing: true, registers: false, stack: false, heap: false })
    expect(panel).not.toHaveBeenCalled()
  })

  /** The registers and the call stack are one region, side by side, and each is a panel with a button of its own. */
  it('draws the call stack closed when the registers are maximised, in the row the two share', async () => {
    const { host } = mount()
    await userEvent.click(maximise(host, 'registers'))
    await frame()
    expect(drawn(host)).toEqual({ listing: false, registers: true, stack: false, heap: false })
    const row = host.querySelector('.asm-machine') as HTMLElement
    expect(heightOf(row), 'the row did not take the spare height').toBeGreaterThan(600)
    expect(heightOf(panelOf(host, 'registers')), 'the registers did not take the row’s').toBeCloseTo(heightOf(row), 0)
  })

  it('ends when another panel is opened by its own disclosure, which that panel stores', async () => {
    const { host, panel } = mount({ stack: false })
    expect(drawn(host).stack, 'precondition: the call stack is stored closed').toBe(false)
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    // THE LISTING IS STORED OPEN AND DRAWN CLOSED: a press on its disclosure opens what is drawn.
    await userEvent.click(toggle(host, 'listing'))
    await frame()
    expect(pressed(host), 'the maximise did not end').toEqual([])
    expect(panel).toHaveBeenCalledExactlyOnceWith('listing', true)
    // EVERY REGION AS IT IS STORED: the call stack, stored closed before the maximise, is closed after it.
    expect(drawn(host)).toEqual({ listing: true, registers: true, stack: false, heap: true })
    expect(boundaries(host)).toBe(2)
  })

  it('opens a panel that was stored closed when its disclosure is pressed under a maximise', async () => {
    const { host, panel } = mount({ stack: false })
    await userEvent.click(maximise(host, 'heap'))
    await userEvent.click(toggle(host, 'stack'))
    await frame()
    expect(panel).toHaveBeenCalledExactlyOnceWith('stack', true)
    expect(drawn(host)).toEqual({ listing: true, registers: true, stack: true, heap: true })
    expect(pressed(host)).toEqual([])
  })

  it('ends when the maximised panel is closed by its own disclosure', async () => {
    const { host, panel } = mount()
    await userEvent.click(maximise(host, 'heap'))
    await userEvent.click(toggle(host, 'heap'))
    await frame()
    expect(panel).toHaveBeenCalledExactlyOnceWith('heap', false)
    expect(pressed(host)).toEqual([])
    expect(drawn(host)).toEqual({ listing: true, registers: true, stack: true, heap: false })
  })

  it('opens a closed panel for as long as it is maximised, and closes it again after', async () => {
    const { host, panel } = mount({ heap: false })
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    expect(drawn(host)).toEqual({ listing: false, registers: false, stack: false, heap: true })
    await userEvent.click(maximise(host, 'heap'))
    await frame()
    expect(drawn(host)).toEqual({ listing: true, registers: true, stack: true, heap: false })
    expect(panel, 'the panel’s stored state was written').not.toHaveBeenCalled()
  })

  it('keeps the keyboard’s focus on the button through a press, drawn pressed without relying on colour', async () => {
    const { host } = mount()
    maximise(host, 'heap').focus()
    await userEvent.keyboard('{Enter}')
    await frame()
    expect(pressed(host)).toEqual(['heap'])
    expect(document.activeElement).toBe(maximise(host, 'heap'))
    expect(getComputedStyle(maximise(host, 'heap')).boxShadow, 'pressed draws no bar').not.toBe('none')
    expect(getComputedStyle(maximise(host, 'listing')).boxShadow, 'not pressed draws one').toBe('none')
    await userEvent.keyboard(' ')
    await frame()
    expect(pressed(host)).toEqual([])
  })
})
```

Create `web/tests/browser/panel-regions.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { PaneEvents } from '../../src/pane-chrome'
import type { Shares } from '../../src/panel-stack'
import { TmPane } from '../../src/tm-pane'
import type { TmProgram, TmState } from '../../src/types'

/**
 * THE REGIONS THAT DO NOT START WITH A SHARE, AND THE ONE THAT TAKES THE REST — the view layouts spec §11.1.
 *
 * Three regions kept their own height before a boundary could be dragged and still do until one beside them is: a
 * copy's text, as tall as what it holds up to eight lines; the λ view's term map, 120 px; and the source view's
 * outline, which `panel-sizes-stored.test.ts` has, since only the app builds that view. From the first drag each
 * has a share (`data-sized`). And the λ term, which was capped at six tenths of the WINDOW whatever its view's
 * height, takes what its view has spare.
 */

const CONTROLS = {
  canRestart: true,
  canBack: false,
  canForward: true,
  canToNewest: true,
  canPlay: true,
  playing: false,
  stepText: '0',
  continueLabel: null,
}

const events = (over: Partial<PaneEvents> = {}): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  toNewest: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
  editSink: () => vi.fn(),
  collapse: vi.fn(),
  ...over,
})

const hostOf = (kind: string, height: number, width = 640): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane'
  el.dataset.kind = kind
  el.style.height = `${height}px`
  el.style.width = `${width}px`
  document.body.append(el)
  return el
}
const heightOf = (el: Element): number => el.getBoundingClientRect().height
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))
const region = (host: HTMLElement, name: string) => host.querySelector(`[data-region="${name}"]`) as HTMLElement
const boundary = (host: HTMLElement, above: string, below: string) =>
  host.querySelector(`.panel-boundary[data-above="${above}"][data-below="${below}"]`) as HTMLElement

/** A real drag of `handle` by `dy` pixels, both ends aimed inside `host`. */
async function drag(host: HTMLElement, handle: HTMLElement, dy: number): Promise<void> {
  const [h, area] = [handle.getBoundingClientRect(), host.getBoundingClientRect()]
  const x = h.left - area.left + h.width / 2
  const y = h.top - area.top + h.height / 2
  await userEvent.dragAndDrop(host, host, { sourcePosition: { x, y }, targetPosition: { x, y: y + dy } })
  await frame()
}

beforeAll(async () => {
  await page.viewport(1280, 1000)
  // THE PAGE'S FONTS FIRST, ASKED FOR BY NAME, since nothing on the page has used them yet: a line's height is the
  // font's, and a floor of five lines and a header's height settle as the fonts arrive.
  await Promise.all([document.fonts.load('12px "Hack"'), document.fonts.load('12px "Inter"')])
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('a copy’s text, in a TM view', () => {
  const STATES = 200
  /** A chain of states, each with one rule to the next: a table far taller than the view. */
  const PROGRAM: TmProgram = {
    states: Array.from({ length: STATES }, (_, i) => ({
      name: `q${i}`,
      accept: i === STATES - 1,
      rules: i === STATES - 1 ? [] : [{ read: [null], write: [null], moves: ['S' as const], next: i + 1 }],
      instr: null,
    })),
    alphabet: ['_'],
    tapes: 1,
    width: 4,
    start: 0,
    listing: [],
    labels: [],
  }
  const FRAME: TmState = {
    state: 0,
    step: 0,
    heads: [0],
    window_start: [0],
    window: ['_'],
    source_node: null,
    rule: 0,
  }
  /** Three lines: shorter than the eight a text panel shows before it scrolls. */
  const TEXT = 'tapes 1\nstart q0\naccept q1\n'

  const mount = () => {
    const sizes = vi.fn<(s: Shares) => void>()
    const host = hostOf('tm', 900)
    const pane = new TmPane(host, events({ panelSizes: sizes }))
    pane.setProgram(PROGRAM, ['t'])
    pane.render(FRAME, CONTROLS)
    pane.setEditor(TEXT)
    return { host, pane, sizes }
  }

  it('keeps its own height, with a boundary under it, above the tapes', async () => {
    const { host } = mount()
    await frame()
    const text = region(host, 'text')
    expect(text.hidden, 'precondition: the text panel is shown').toBe(false)
    expect(text.dataset.sized, 'a text nobody dragged has a share').toBeUndefined()
    const lines = host.querySelectorAll('.term-editor .cm-line').length
    expect(lines, 'precondition: the editor holds the text’s lines').toBeGreaterThanOrEqual(3)
    expect(heightOf(text), 'the text panel is not as tall as its three lines and its header').toBeLessThan(140)
    const b = boundary(host, 'text', 'rules')
    expect(b.getAttribute('aria-label')).toBe('resize text and rules')
    // UNDER THE UPPER REGION: the status line and the tapes lie between it and the rules, and keep their own height.
    expect(b.previousElementSibling).toBe(text)
    expect(b.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      (host.querySelector('.tapes') as HTMLElement).getBoundingClientRect().top + 0.5,
    )
    // NOT YET A SHARE TO SAY: the value is the middle until a drag measures the two.
    expect(b.getAttribute('aria-valuenow')).toBe('50')
  })

  it('takes a share at the first drag, and the tapes move with the boundary at the height they had', async () => {
    const { host, sizes } = mount()
    await frame()
    const tapes = host.querySelector('.tapes') as HTMLElement
    const [text, rules, diagram] = [region(host, 'text'), region(host, 'rules'), region(host, 'diagram')]
    const was = { text: heightOf(text), rules: heightOf(rules), diagram: heightOf(diagram), tapes: heightOf(tapes) }
    const tapesTop = tapes.getBoundingClientRect().top
    await drag(host, boundary(host, 'text', 'rules'), 80)
    expect(text.dataset.sized).toBe('true')
    expect(heightOf(text), 'the text did not take 80 px').toBeCloseTo(was.text + 80, 0)
    expect(heightOf(rules), 'the rules did not give them').toBeCloseTo(was.rules - 80, 0)
    expect(heightOf(diagram), 'the diagram, which the boundary does not part, moved').toBeCloseTo(was.diagram, 1)
    expect(heightOf(tapes), 'the tapes did not keep their height').toBe(was.tapes)
    expect(tapes.getBoundingClientRect().top, 'the tapes did not move down with the boundary').toBeCloseTo(
      tapesTop + 80,
      0,
    )
    expect(host.scrollHeight, 'the view grew').toBe(host.clientHeight)
    // THE EDITOR FILLS THE SHARE ITS PANEL HAS, and scrolls inside it where its text is longer.
    const editor = host.querySelector('.term-editor') as HTMLElement
    expect(editor.getBoundingClientRect().bottom).toBeCloseTo(text.getBoundingClientRect().bottom, 0)
    // EVERY OPEN REGION HAS A SHARE FROM THE DRAG, and the two that had shares before keep their sum, three.
    const s = sizes.mock.calls.at(-1)?.[0] as Shares
    expect(Object.keys(s).sort()).toEqual(['diagram', 'rules', 'text'])
    expect(s.diagram as number).toBeCloseTo(1, 1)
    expect((s.rules as number) / (s.diagram as number)).toBeCloseTo(heightOf(rules) / heightOf(diagram), 2)
    expect((s.text as number) / (s.diagram as number)).toBeCloseTo(heightOf(text) / heightOf(diagram), 2)
  })

  it('goes back to its own height at Enter on its boundary', async () => {
    const { host, sizes } = mount()
    await frame()
    const text = region(host, 'text')
    const was = heightOf(text)
    await drag(host, boundary(host, 'text', 'rules'), 80)
    expect(heightOf(text), 'precondition: the drag moved the boundary').toBeGreaterThan(was + 70)
    boundary(host, 'text', 'rules').focus()
    await userEvent.keyboard('{Enter}')
    await frame()
    expect(text.dataset.sized).toBeUndefined()
    expect(heightOf(text)).toBeCloseTo(was, 0)
    expect(Object.keys(sizes.mock.calls.at(-1)?.[0] as Shares)).toEqual(['diagram'])
  })
})
```

Create `web/tests/browser/panel-sizes-restore.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { drawn, host, SHELL, until } from './harness'

/**
 * **STORED SHARES, THROUGH THE REAL APP'S LOAD** — the view layouts spec §11.4. Seeded before `main.ts` is imported,
 * as `workspace-restore.test.ts` seeds its panels, because `main()` reads storage once. The TM view is built by
 * `pane-host.ts` with the shares its leaf holds, and the source view, which nothing builds, by `main.ts` with its own.
 *
 * Each view is given the reverse of what it is built with, so a load that read nothing fails: the state diagram two
 * shares to the rules' one, and the source outline, which has its own height until a boundary is dragged, a share
 * even with the editor's.
 */

const SIZES = { 'tm-0': { rules: 1, diagram: 2 }, source: { outline: 1, editor: 1 } }

const heightOf = (el: Element): number => el.getBoundingClientRect().height
const region = (leaf: string, name: string): HTMLElement =>
  (host(leaf) as HTMLElement).querySelector(`[data-region="${name}"]`) as HTMLElement

beforeAll(async () => {
  await page.viewport(1280, 896)
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...defaultWorkspace('wide'), panels: { source: { outline: true } }, panelSizes: SIZES }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  await until(() => host('tm-0')?.querySelector('.state-table .state-row') != null, 'the rule table to draw')
  expect(drawn(), 'precondition: the page opened on the stored tree').toBe('row[50](source tm-0)')
  // THE PAGE'S FONTS FIRST: a line's height is the font's, and a floor of five lines, a header and the view's own
  // height each settle as the fonts arrive (`panel-sizes-restore-lambda.test.ts` has the figures).
  await document.fonts.ready
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
})

describe('a workspace stored with shares', () => {
  it('opens the TM view with its state diagram twice its rules, as stored', () => {
    const [rules, diagram] = [heightOf(region('tm-0', 'rules')), heightOf(region('tm-0', 'diagram'))]
    expect(rules, 'precondition: the rules are over their floor, so the shares are what sized them').toBeGreaterThan(
      160,
    )
    expect(diagram / rules).toBeCloseTo(2, 1)
    expect(
      (host('tm-0') as HTMLElement).querySelector('.panel-boundary')?.getAttribute('aria-valuenow'),
      'the boundary does not say the rules’ part of the two',
    ).toBe('33')
  })

  it('keeps them through the writes the load itself makes', () => {
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null').panelSizes).toEqual(SIZES)
  })
})
```

Create `web/tests/browser/panel-sizes-stored.test.ts`:

```ts
import type { EditorView } from '@codemirror/view'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { drawn, host, resetToFirstLoad, SHELL, until } from './harness'

/**
 * THE SHARES A DRAG LEAVES, IN THE WORKSPACE — the view layouts spec §11.4 — and the source view's two regions,
 * which only the app builds (§11.1). Through the real app, on the views a first load shows: the source beside the TM
 * view, each as tall as the window allows, so the TM view's rules and state diagram have room over their floors.
 *
 * `panel-boundaries.test.ts` has the gesture and `workspace.test.ts` what is read and written; this file has what
 * joins them: the write a gesture makes, and what a switch, a `✕`, a reload's worth of storage and a link do to it.
 * `panel-sizes-restore.test.ts` is the load.
 */

// BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
localStorage.removeItem(LAYOUT_STORAGE_KEY)

/** A program whose machine has more rows at the state diagram's program level than its panel shows. */
const SUM =
  'fn sum_to(n) {\n    let mut acc = 0;\n    while n > 0 {\n        acc = acc + n;\n        n = n - 1;\n    }\n    acc\n}\nsum_to(5)\n'
let view: EditorView

type Stored = { panelSizes?: Record<string, Record<string, number>>; arrangements?: Record<string, unknown> }
const stored = (): Stored => JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null')
const tm = (): HTMLElement => host('tm-0') as HTMLElement
const region = (view: HTMLElement, name: string) => view.querySelector(`[data-region="${name}"]`) as HTMLElement
const heightOf = (el: Element): number => el.getBoundingClientRect().height
const toggle = (kind: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`#views-shown button[data-shows="${kind}"]`) as HTMLButtonElement
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))
const idle = (): boolean => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
const program = async (text: string): Promise<void> => {
  if (view.state.doc.toString() === text) return
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  await until(idle, 'the compile')
}

/** A real drag of `handle` by `dy` pixels, both ends aimed inside `view`. */
async function drag(view: HTMLElement, handle: HTMLElement, dy: number): Promise<void> {
  const [h, area] = [handle.getBoundingClientRect(), view.getBoundingClientRect()]
  const x = h.left - area.left + h.width / 2
  const y = h.top - area.top + h.height / 2
  await userEvent.dragAndDrop(view, view, { sourcePosition: { x, y }, targetPosition: { x, y: y + dy } })
  await frame()
}
const diagramBar = (): HTMLElement => tm().querySelector('[data-panel="diagram"] > .panel-header') as HTMLElement

beforeAll(async () => {
  await page.viewport(1280, 896)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await until(idle, 'the first compile')
  await until(() => tm()?.querySelector('.state-table .state-row') != null, 'the rule table to draw')
  // THE PAGE'S FONTS FIRST: a line's height is the font's, and a floor of five lines, a header and the view's own
  // height each settle as the fonts arrive (`panel-sizes-restore-lambda.test.ts` has the figures).
  await document.fonts.ready
})

describe('a view’s shares, in the stored workspace', () => {
  // *RESET PRESET* KEEPS A TM VIEW THAT SHOWS THE PROGRAM, WITH THE SHARES IT HOLDS, as it keeps the panels it has
  // open (`pane-host.ts`'s pass 1). So what a case before dragged is put back here, by `Enter` on the boundary.
  beforeEach(async () => {
    await page.viewport(1280, 896)
    await resetToFirstLoad()
    await until(() => tm()?.querySelector('.state-table .state-row') != null, 'the rule table to draw')
    if (stored().panelSizes !== undefined) {
      ;(tm().querySelector('.panel-boundary') as HTMLElement).focus()
      await userEvent.keyboard('{Enter}')
      await frame()
    }
    expect(stored().panelSizes, 'precondition: the TM view holds no share').toBeUndefined()
    const [rules, diagram] = [heightOf(region(tm(), 'rules')), heightOf(region(tm(), 'diagram'))]
    expect(rules / diagram, 'precondition: the rules have two shares to the diagram’s one').toBeCloseTo(2, 1)
    expect(rules, 'precondition: the rules have 60 px to give over their floor of 148').toBeGreaterThan(300)
  })

  it('are written once at the end of a drag, for the view that was dragged in', async () => {
    // `localStorage` HERE IS `setup.ts`'s OWN OBJECT FOR THIS FILE, so the spy is on it and not on `Storage`'s prototype.
    const writes = vi.spyOn(localStorage, 'setItem')
    try {
      const before = heightOf(region(tm(), 'diagram'))
      await drag(tm(), diagramBar(), -60)
      expect(heightOf(region(tm(), 'diagram')), 'precondition: the drag moved the boundary').toBeCloseTo(before + 60, 0)
      expect(
        writes.mock.calls.filter(([key]) => key === LAYOUT_STORAGE_KEY),
        'a drag did not write the workspace exactly once',
      ).toHaveLength(1)
    } finally {
      writes.mockRestore()
    }
    const sizes = stored().panelSizes
    expect(Object.keys(sizes ?? {}), 'a share was written for another view').toEqual(['tm-0'])
    const own = sizes?.['tm-0'] ?? {}
    expect(Object.keys(own).sort()).toEqual(['diagram', 'rules'])
    expect((own.rules as number) + (own.diagram as number), 'the two shares add up to what they did').toBeCloseTo(3, 2)
    expect((own.rules as number) / (own.diagram as number)).toBeCloseTo(
      heightOf(region(tm(), 'rules')) / heightOf(region(tm(), 'diagram')),
      2,
    )
  })

  it('are kept for a view its toggle takes off the page, which comes back with them', async () => {
    await drag(tm(), diagramBar(), -60)
    const [rules, diagram] = [heightOf(region(tm(), 'rules')), heightOf(region(tm(), 'diagram'))]
    const sizes = stored().panelSizes
    await userEvent.click(toggle('tm'))
    expect(drawn(), 'precondition: the TM view is off the page').toBe('source')
    expect(stored().panelSizes, 'a view off the page lost its shares').toEqual(sizes)
    await userEvent.click(toggle('tm'))
    await frame()
    expect(drawn()).toBe('row[50](source tm-0)')
    expect(heightOf(region(tm(), 'rules'))).toBeCloseTo(rules, 0)
    expect(heightOf(region(tm(), 'diagram'))).toBeCloseTo(diagram, 0)
    expect(stored().panelSizes).toEqual(sizes)
  })

  it('are dropped with a view closed by its ✕, and the view built next under its id has none', async () => {
    await drag(tm(), diagramBar(), -60)
    expect(stored().panelSizes?.['tm-0'], 'precondition: the drag stored shares').toBeDefined()
    await userEvent.click(tm().querySelector('button.view-close') as HTMLElement)
    expect(drawn()).toBe('source')
    expect(stored().panelSizes, 'a closed view’s shares are still stored').toBeUndefined()
    await userEvent.click(toggle('tm'))
    await until(() => tm()?.querySelector('.state-table .state-row') != null, 'the new TM view to draw')
    await frame()
    expect(stored().panelSizes, 'the new view was given the closed one’s shares').toBeUndefined()
    expect(heightOf(region(tm(), 'rules')) / heightOf(region(tm(), 'diagram'))).toBeCloseTo(2, 1)
  })

  it('are put back to none by Enter on the boundary, which leaves no entry for the view', async () => {
    await drag(tm(), diagramBar(), -60)
    const boundary = tm().querySelector('.panel-boundary') as HTMLElement
    boundary.focus()
    await userEvent.keyboard('{Enter}')
    await frame()
    expect(stored().panelSizes, 'a view that holds no share still has an entry').toBeUndefined()
    expect(heightOf(region(tm(), 'rules')) / heightOf(region(tm(), 'diagram'))).toBeCloseTo(2, 1)
  })

  /**
   * **A PANEL A MAXIMISE DRAWS CLOSED WITHDRAWS WHAT IT OFFERED FOR A BODY NOBODY CAN SEE** (`panel.ts`'s `onDrawn`).
   * The state diagram's *follow current state* is offered while its rows do not follow, and only the TM view writes
   * its `hidden`; a grid draws itself again when its box changes size, which is why the rule table needs no telling.
   */
  it('withdraw a hidden panel’s offer to follow again under a maximise, and bring it back with the panel', async () => {
    const again = (): HTMLElement => tm().querySelector('.diagram-reattach') as HTMLElement
    const rows = (): HTMLElement => tm().querySelector('.program-scroll') as HTMLElement
    const button = (): HTMLElement => tm().querySelector('[data-panel="rules"] .panel-maximise') as HTMLElement
    await program(SUM)
    await until(() => tm().querySelectorAll('.program-row').length > 6, 'the diagram to draw the program’s rows')
    if (!again().hidden) again().click()
    await frame()
    expect(again().hidden, 'precondition: the diagram follows the run').toBe(true)
    expect(rows().scrollHeight - rows().clientHeight, 'precondition: the diagram’s rows scroll').toBeGreaterThan(60)
    rows().scrollTop = 60
    rows().dispatchEvent(new Event('scroll'))
    await until(() => !again().hidden, 'the diagram to stop following')
    await userEvent.click(button())
    await frame()
    expect(
      tm().querySelector('[data-panel="diagram"] .panel-toggle')?.getAttribute('aria-expanded'),
      'precondition: the maximise drew the diagram closed',
    ).toBe('false')
    expect(again().hidden, 'a diagram drawn closed still offers to follow').toBe(true)
    await userEvent.click(button())
    await frame()
    expect(again().hidden, 'the offer did not come back with the diagram').toBe(false)
    again().click()
  })

  it('are not written by a maximise, which a load does not bring back', async () => {
    // `localStorage` HERE IS `setup.ts`'s OWN OBJECT FOR THIS FILE, so the spy is on it and not on `Storage`'s prototype.
    const writes = vi.spyOn(localStorage, 'setItem')
    try {
      await userEvent.click(tm().querySelector('[data-panel="diagram"] .panel-maximise') as HTMLElement)
      await frame()
      expect(
        tm().querySelector('[data-panel="rules"] .panel-toggle')?.getAttribute('aria-expanded'),
        'precondition: the maximise drew the rules closed',
      ).toBe('false')
      expect(writes.mock.calls.filter(([key]) => key === LAYOUT_STORAGE_KEY)).toHaveLength(0)
    } finally {
      writes.mockRestore()
    }
    await userEvent.click(tm().querySelector('[data-panel="diagram"] .panel-maximise') as HTMLElement)
  })
})
```

In `web/tests/browser/tm-view-narrow.test.ts`:

```diff
--- a/web/tests/browser/tm-view-narrow.test.ts
+++ b/web/tests/browser/tm-view-narrow.test.ts
@@ -517,8 +517,14 @@ describe('the TM view, on sum_to(5)', () => {
    * level, its grid, its runtime column and each of the column's boxes — at its left, top, width and height against the
    * view's top-left corner, to 0.5px, as a throwaway probe measured them on `53ecbfa` (2026-10-05). The view is
    * 634px wide at x = 646. The figures are the web fonts', which the browser tier loads.
+   *
+   * **BUT FOR THE MAXIMISE BUTTON EACH HEADER GAINED** (the view layouts spec §11.3), 24.78px wide at the right end of
+   * its actions with the 8px gap before it: the diagram's actions and the radio groups in them are 32.78px further
+   * left than `53ecbfa` drew them and the box of the actions that much wider, and the rules' header has a box of
+   * actions where it had none (measured on the panel-resizing prototype, 2026-10-12). No panel, header, toggle, name
+   * or body moved: the boundary between the two panels is as tall as the gap it took the place of.
    */
-  it('at 1280 px, the TM view’s panels are where 53ecbfa drew them', async () => {
+  it('at 1280 px, the TM view’s panels are where 53ecbfa drew them, but for each header’s maximise button', async () => {
     await at(1280, 800, false)
     expect(tm().scrollTop, 'precondition: the TM view is not scrolled').toBe(0)
     const origin = tm().getBoundingClientRect()
@@ -531,18 +537,21 @@ describe('the TM view, on sum_to(5)', () => {
       ['its header', rules.querySelector('.panel-header'), [0, 226, 634, 28]],
       ['its toggle', rules.querySelector('.panel-toggle'), [8, 227, 57.41, 26]],
       ['its name', rules.querySelector('.panel-name'), [24, 231, 41.41, 18]],
+      ['the rules’ actions', rules.querySelector('.panel-actions'), [601.22, 228.8, 24.78, 22.39]],
+      ['the rules’ maximise', rules.querySelector('.panel-maximise'), [601.22, 228.8, 24.78, 22.39]],
       ['the rule table', table(), [0, 254, 634, 120]],
       ['the diagram panel', d, [0, 382, 634, 148]],
       ['its header', d.querySelector('.panel-header'), [0, 382, 634, 28]],
       ['its toggle', d.querySelector('.panel-toggle'), [8, 383, 118.25, 26]],
       ['its name', d.querySelector('.panel-name'), [24, 387, 102.25, 18]],
-      ['its actions', d.querySelector('.panel-actions'), [419.88, 384.81, 206.13, 22.38]],
-      ['program | local', d.querySelector('[role="radiogroup"][aria-label="level"]'), [419.88, 384.81, 109.56, 22.38]],
-      ['program', choice('program'), [419.88, 384.81, 61.78, 22.38]],
-      ['local', choice('local'), [481.66, 384.81, 47.78, 22.38]],
-      ['arcs | chips', d.querySelector('[role="radiogroup"][aria-label="edges"]'), [537.44, 384.81, 88.56, 22.38]],
-      ['arcs', choice('arcs'), [537.44, 384.81, 40.78, 22.38]],
-      ['chips', choice('chips'), [578.22, 384.81, 47.78, 22.38]],
+      ['its actions', d.querySelector('.panel-actions'), [387.09, 384.81, 238.91, 22.38]],
+      ['program | local', d.querySelector('[role="radiogroup"][aria-label="level"]'), [387.09, 384.81, 109.56, 22.38]],
+      ['program', choice('program'), [387.09, 384.81, 61.78, 22.38]],
+      ['local', choice('local'), [448.88, 384.81, 47.78, 22.38]],
+      ['arcs | chips', d.querySelector('[role="radiogroup"][aria-label="edges"]'), [504.66, 384.81, 88.56, 22.38]],
+      ['arcs', choice('arcs'), [504.66, 384.81, 40.78, 22.38]],
+      ['chips', choice('chips'), [545.44, 384.81, 47.78, 22.38]],
+      ['the diagram’s maximise', d.querySelector('.panel-maximise'), [601.22, 384.8, 24.78, 22.39]],
       ['the diagram', d.querySelector('.state-diagram'), [0, 410, 634, 120]],
       ['the program level', d.querySelector('.program-level'), [0, 410, 634, 120]],
       ['its grid', programScroll(), [0, 410, 458, 120]],
```

- [ ] **Step 2: Run them, and see them fail**

```bash
pnpm exec vitest run --project browser tests/browser/panel-boundaries.test.ts tests/browser/panel-maximise.test.ts tests/browser/panel-regions.test.ts tests/browser/panel-sizes-stored.test.ts tests/browser/panel-sizes-restore.test.ts tests/browser/tm-view-narrow.test.ts
```

On the replay, with this task's tests written and its source not: `t3-fail.log`: files: 6 failed (6); tests: 20 failed | 1 passed | 23 skipped (44).

```
tests/browser/panel-boundaries.test.ts [ tests/browser/panel-boundaries.test.ts ]
tests/browser/panel-maximise.test.ts > a panel’s maximise button > draws the call stack closed when the registers are maximised, in the row the two share
tests/browser/panel-maximise.test.ts > a panel’s maximise button > draws the listing again when a maximise that hid it ends, and does not draw into it while it is hidden
tests/browser/panel-maximise.test.ts > a panel’s maximise button > ends when another panel is opened by its own disclosure, which that panel stores
tests/browser/panel-maximise.test.ts > a panel’s maximise button > ends when the maximised panel is closed by its own disclosure
tests/browser/panel-maximise.test.ts > a panel’s maximise button > gives its panel the view’s spare height and draws every other panel closed, storing nothing
tests/browser/panel-maximise.test.ts > a panel’s maximise button > is in each panel’s header after its other actions, named for its panel, and not pressed
tests/browser/panel-maximise.test.ts > a panel’s maximise button > keeps the keyboard’s focus on the button through a press, drawn pressed without relying on colour
tests/browser/panel-maximise.test.ts > a panel’s maximise button > moves to another panel when that one’s is pressed
tests/browser/panel-maximise.test.ts > a panel’s maximise button > opens a closed panel for as long as it is maximised, and closes it again after
tests/browser/panel-maximise.test.ts > a panel’s maximise button > opens a panel that was stored closed when its disclosure is pressed under a maximise
tests/browser/panel-regions.test.ts > a copy’s text, in a TM view > goes back to its own height at Enter on its boundary
… and 10 more
```

- [ ] **Step 3: Write the source**

In `web/help.html`:

```diff
--- a/web/help.html
+++ b/web/help.html
@@ -134,6 +134,13 @@
             <td>the divider between two views</td>
             <td><kbd>←</kbd> <kbd>→</kbd>, or <kbd>↑</kbd> <kbd>↓</kbd> when the views are stacked, resize them</td>
           </tr>
+          <tr>
+            <td>the boundary between two panels of a view</td>
+            <td>
+              <kbd>↑</kbd> <kbd>↓</kbd> resize them; <kbd>Enter</kbd> puts both back to the size they start with. With
+              a pointer, drag the lower panel's header, and double-click it to put them back
+            </td>
+          </tr>
           <tr>
             <td>the Stage layout's tabs</td>
             <td>
```

In `web/src/asm-pane.ts`:

```diff
--- a/web/src/asm-pane.ts
+++ b/web/src/asm-pane.ts
@@ -19,6 +19,7 @@ import { n } from './format'
 import type { Dir } from './layout'
 import type { PaneChoice, PaneEvents, SplitChoices } from './pane-chrome'
 import { createPanel, type Panel } from './panel'
+import { PanelStack, type Shares } from './panel-stack'
 import type { Leg } from './protocol'
 import { endedLine } from './results'
 import type { ScratchEditor } from './scratch-editor'
@@ -108,7 +109,7 @@ export class AsmPane implements EditablePane {
    * `panels` is the view's stored panel state, read once here; each panel reports every later toggle through
    * `on.panel`. Every panel opens by default.
    */
-  constructor(host: HTMLElement, on: PaneEvents, panels: AsmPanels = {}) {
+  constructor(host: HTMLElement, on: PaneEvents, panels: AsmPanels = {}, sizes: Shares = {}) {
     this.#header = viewHeader(on.rebind)
     this.#steps = stepControls(on)
     this.#value = document.createElement('div')
@@ -172,6 +173,7 @@ export class AsmPane implements EditablePane {
         this.#grid.draw()
         on.panel?.('listing', open)
       },
+      onDrawn: () => this.#grid.draw(),
     })
     this.#listingPanel.actions.append(this.#reattach)
 
@@ -231,6 +233,56 @@ export class AsmPane implements EditablePane {
     )
     this.#header.steps.append(this.#steps.el)
     host.replaceChildren(this.#header.el, this.#body)
+    // THE REGIONS THAT SHARE THE VIEW'S HEIGHT (the view layouts spec §11.1), top to bottom, with the shares
+    // `style.css` fixed before a boundary could be dragged. The registers and the call stack are one region, the row
+    // they share: no boundary parts the two (they wrap one under the other in a narrow view).
+    // IT KEEPS ITSELF: its listeners are on the regions and their headers, and nothing here reads it again.
+    new PanelStack(
+      [
+        {
+          name: 'text',
+          label: 'text',
+          el: this.#copy.text.el,
+          share: null,
+          panels: [this.#copy.text],
+          bodies: () => [this.#copy.text.body],
+        },
+        {
+          name: 'listing',
+          label: 'listing',
+          el: this.#listingPanel.el,
+          share: 2,
+          panels: [this.#listingPanel],
+          bodies: () => [this.#listingPanel.body],
+        },
+        {
+          name: 'machine',
+          label: 'registers and call stack',
+          el: machine,
+          share: 1,
+          panels: [this.#registersPanel, this.#stackPanel],
+          bodies: () => [this.#registersPanel, this.#stackPanel].filter((p) => p.isOpen()).map((p) => p.body),
+        },
+        {
+          name: 'heap',
+          label: 'heap',
+          el: this.#heapPanel.el,
+          share: 1,
+          panels: [this.#heapPanel],
+          bodies: () => [this.#heapPanel.body],
+        },
+        {
+          name: 'outline',
+          label: 'outline',
+          el: this.#copy.outlinePanel.el,
+          share: 1,
+          panels: [this.#copy.outlinePanel],
+          bodies: () => [this.#copy.outlinePanel.body],
+        },
+      ],
+      sizes,
+      (next) => on.panelSizes?.(next),
+    )
   }
 
   /**
```

In `web/src/copy-editor.ts`:

```diff
--- a/web/src/copy-editor.ts
+++ b/web/src/copy-editor.ts
@@ -3,6 +3,7 @@ import { EDITOR_DEBOUNCE_MS } from './editor-debounce'
 import { n } from './format'
 import { createOutlinePanel } from './outline'
 import { type PaneEvents, textPanel } from './pane-chrome'
+import type { Panel } from './panel'
 import type { ScratchEditorConfig } from './scratch-editor'
 import { ScratchEditor } from './scratch-editor'
 import type { ViewMenu } from './view-header'
@@ -46,6 +47,9 @@ export class CopyEditor implements EditablePane {
   readonly textPanel: HTMLElement
   /** The outline panel — last in the view's body, and shown only while an editor is mounted. */
   readonly outline: HTMLElement
+  /** The two panels themselves, for the view's stack of regions (`panel-stack.ts`). */
+  readonly text: Panel
+  readonly outlinePanel: Panel
   /**
    * The upper half of design §4.2's split body, ported to the machine views — a stable parent that outlives any
    * editor mounted or unmounted inside it, so `setEditor` can do both without touching the view's own child order.
@@ -132,6 +136,7 @@ export class CopyEditor implements EditablePane {
     // gesture, for the copy's record.
     this.#collapse = textPanel(this.#editorHost, (collapsed) => on.collapse?.(collapsed))
     this.textPanel = this.#collapse.el
+    this.text = this.#collapse.panel
     // THE OUTLINE IS WHAT THE SERVER LISTS FOR THE COPY'S DOCUMENT — a TM copy's states, an asm copy's labels; each
     // view's constructor says why its own starts closed.
     this.#outline = createOutlinePanel({
@@ -144,6 +149,7 @@ export class CopyEditor implements EditablePane {
       reveal: (range) => this.#editor?.reveal(range),
     })
     this.outline = this.#outline.panel.el
+    this.outlinePanel = this.#outline.panel
     // The view starts on the program, with no editor — so the controls that need one start withdrawn rather than
     // waiting for the first assignment to withdraw them.
     this.#syncEditorControls()
```

In `web/src/icons.ts`:

```diff
--- a/web/src/icons.ts
+++ b/web/src/icons.ts
@@ -25,6 +25,7 @@ export type IconName =
   | 'moon'
   | 'settings'
   | 'format'
+  | 'maximise'
 
 /** Stroke paths on a 16×16 grid. Drawn for this app; no icon set is vendored. */
 const PATHS: Readonly<Record<IconName, string>> = {
@@ -54,6 +55,8 @@ const PATHS: Readonly<Record<IconName, string>> = {
   // is what the action does. Deliberately NOT a wand or a brush: the operation is deterministic
   // (`print ∘ parse`) and a magic glyph would suggest otherwise.
   format: 'M3 4.5 H13 M3 8 H10 M3 11.5 H12',
+  // Four corners pulled apart: the panel takes the room. Its pressed state is the button's, not a second glyph.
+  maximise: 'M3 6.5 V3 H6.5 M9.5 3 H13 V6.5 M13 9.5 V13 H9.5 M6.5 13 H3 V9.5',
   settings:
     'M8 5.75 A2.25 2.25 0 1 0 8 10.25 A2.25 2.25 0 1 0 8 5.75 M8 1.5 V3.5 M8 12.5 V14.5 M1.5 8 H3.5 M12.5 8 H14.5 M3.4 3.4 L4.8 4.8 M11.2 11.2 L12.6 12.6 M3.4 12.6 L4.8 11.2 M11.2 4.8 L12.6 3.4',
 }
```

In `web/src/main.ts`:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -87,6 +87,7 @@ import { paletteDeclarations } from './palettes'
 import type { PaneChoice } from './pane-chrome'
 import { type AddRefused, createPaneHost, type LayoutEvent } from './pane-host'
 import { createPanel } from './panel'
+import type { Shares } from './panel-stack'
 import { type LeafId, legOfPane, PaneCollection, type PaneKind } from './panes'
 import { PROGRAM_STORAGE_KEY, parseProgram, type StoredProgram, serializeProgram } from './program-store'
 import type { Leg, RunReply } from './protocol'
@@ -137,6 +138,7 @@ import {
   type Workspace,
   withDisplay,
   withPanel,
+  withPanelSizes,
   withTmDisplay,
 } from './workspace'
 
@@ -1525,6 +1527,10 @@ async function main(): Promise<EditorView> {
     setPanel: (leaf: LeafId, name: string, open: boolean) => {
       ws = { ...ws, panels: withPanel(ws.panels, leaf, name, open) }
     },
+    panelSizesOf: (leaf: LeafId) => ws.panelSizes[leaf],
+    setPanelSizes: (leaf: LeafId, sizes: Shares) => {
+      ws = { ...ws, panelSizes: withPanelSizes(ws.panelSizes, leaf, sizes) }
+    },
     displayOf: (leaf: LeafId) => ws.display[leaf],
     setDisplay: (leaf: LeafId, d: LambdaDisplay) => {
       ws = { ...ws, display: withDisplay(ws.display, leaf, d) }
```

In `web/src/pane-chrome.ts`:

```diff
--- a/web/src/pane-chrome.ts
+++ b/web/src/pane-chrome.ts
@@ -1,4 +1,5 @@
-import { createPanel } from './panel'
+import { createPanel, type Panel } from './panel'
+import type { Shares } from './panel-stack'
 import type { Leg } from './protocol'
 import type { ScratchEditorConfig } from './scratch-editor'
 import type { SessionId } from './session-client'
@@ -182,6 +183,8 @@ export type PaneEvents = {
    * and the text panel reports through `collapse` instead, because its state belongs to the copy.
    */
   panel?: (name: string, open: boolean) => void
+  /** A boundary between this view's regions was moved, or put back: every share the view now holds (spec §11.4). */
+  panelSizes?: (sizes: Shares) => void
   /** A λ view's display settings changed — recorded per view, as `panel` is (Plan 7 part 4a). */
   display?: (d: LambdaDisplay) => void
   /** A TM view's display settings changed — `display`'s twin (Plan 7 part 4b). */
@@ -269,12 +272,13 @@ export type PaneEvents = {
 export function textPanel(
   body: HTMLElement,
   onToggle: (collapsed: boolean) => void,
-): { readonly el: HTMLElement; update(available: boolean, initial?: boolean): void } {
+): { readonly el: HTMLElement; readonly panel: Panel; update(available: boolean, initial?: boolean): void } {
   const panel = createPanel({ name: 'text', label: 'text', body, onToggle: (open) => onToggle(!open) })
   panel.el.hidden = true
   let on = false
   return {
     el: panel.el,
+    panel,
     update(available: boolean, initial = false) {
       if (available === on) return
       on = available
```

In `web/src/pane-host.ts`:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -20,6 +20,7 @@ import {
 import { DIVIDER_PX, renderLayout, renderStage, syncSizes } from './layout-view'
 import { unhandled } from './legs'
 import type { PaneChoice, PaneEvents } from './pane-chrome'
+import type { Shares } from './panel-stack'
 import type { LeafId, PaneCollection, PaneKind } from './panes'
 import type { Leg } from './protocol'
 import type { Detachable } from './scratch'
@@ -293,6 +294,10 @@ export function createPaneHost(deps: {
   panelOpen(leaf: LeafId, name: string): boolean | undefined
   /** Record a view's panel state; `persist` is the caller's to make. */
   setPanel(leaf: LeafId, name: string, open: boolean): void
+  /** A view's stored shares for its regions, or `undefined` for none (the view layouts spec §11.4). */
+  panelSizesOf(leaf: LeafId): Shares | undefined
+  /** Record a view's shares; `persist` is the caller's to make. */
+  setPanelSizes(leaf: LeafId, sizes: Shares): void
   /** A λ view's stored display settings, or `undefined` for none (Plan 7 part 4a). */
   displayOf(leaf: LeafId): LambdaDisplay | undefined
   /** Record a λ view's display settings; `persist` is the caller's to make. */
@@ -378,6 +383,8 @@ export function createPaneHost(deps: {
     setFocused,
     panelOpen,
     setPanel,
+    panelSizesOf,
+    setPanelSizes,
     displayOf,
     setDisplay,
     tmDisplayOf,
@@ -1035,6 +1042,10 @@ export function createPaneHost(deps: {
         setPanel(id, name, open)
         persist()
       },
+      panelSizes: (sizes: Shares) => {
+        setPanelSizes(id, sizes)
+        persist()
+      },
       display: (d: LambdaDisplay) => {
         setDisplay(id, d)
         persist()
@@ -1665,6 +1676,7 @@ export function createPaneHost(deps: {
               ...(outline === undefined ? {} : { outline }),
             },
             tmDisplayOf(l.id) ?? DEFAULT_TM_DISPLAY,
+            panelSizesOf(l.id) ?? {},
           )
           // **A NEW TM PANE IS SEEDED FROM ITS SESSION, BECAUSE THE REPLY THAT WOULD HAVE TOLD IT HAS
           // ALREADY BEEN AND GONE.** `TmPane.setProgram` was called from `replies.ts` and from nowhere
@@ -1728,13 +1740,18 @@ export function createPaneHost(deps: {
           const stack = panelOpen(l.id, 'stack')
           const heap = panelOpen(l.id, 'heap')
           const outline = panelOpen(l.id, 'outline')
-          const pane = new AsmPane(host, paneEvents(l.id, slot), {
-            ...(listing === undefined ? {} : { listing }),
-            ...(registers === undefined ? {} : { registers }),
-            ...(stack === undefined ? {} : { stack }),
-            ...(heap === undefined ? {} : { heap }),
-            ...(outline === undefined ? {} : { outline }),
-          })
+          const pane = new AsmPane(
+            host,
+            paneEvents(l.id, slot),
+            {
+              ...(listing === undefined ? {} : { listing }),
+              ...(registers === undefined ? {} : { registers }),
+              ...(stack === undefined ? {} : { stack }),
+              ...(heap === undefined ? {} : { heap }),
+              ...(outline === undefined ? {} : { outline }),
+            },
+            panelSizesOf(l.id) ?? {},
+          )
           // SEEDED FROM ITS SESSION, for the TM arm's reason just above: the `compiled` reply that told the other
           // asm views has already been and gone for a view built by a split, a pick or a views toggle.
           seedAsmPane(pane, session)
```

Create `web/src/panel-stack.ts`:

```ts
import { icon } from './icons'
import type { Panel } from './panel'
import { pointerDrag, separatorGesture } from './separator'

/**
 * THE REGIONS OF A VIEW THAT SHARE ITS HEIGHT, the boundaries between them, and the maximise button on each panel
 * (the view layouts spec §11).
 *
 * A REGION IS A FLEX ITEM OF THE VIEW'S COLUMN WITH A SHARE. `style.css` gives an open region
 * `flex: var(--share) 1 0`, so the open regions divide what the view's fixed parts leave in proportion to their
 * shares, each down to its body's floor. This module writes `--share` and nothing else of the layout: the default a
 * region is built with, or the share the workspace stores for it.
 *
 * A BOUNDARY IS DRAWN BETWEEN TWO OPEN REGIONS WITH NO OPEN REGION BETWEEN THEM, directly under the upper one. A
 * closed region's header, or a part of the view that keeps its own height, can lie between the two, and moves with
 * the boundary.
 *
 * A PANEL'S HEADER IS A HANDLE FOR THE BOUNDARY ABOVE IT, where its region has one: the bar is what a pointer finds,
 * and it shows the resize cursor wherever a press would drag (`data-resizes`, which `style.css` reads). A press on
 * one of the header's own controls is that control's. A finger's press is left alone too: a header is most of what a
 * narrow view offers to scroll by, and the boundary itself takes a finger. The boundary stays the keyboard's, and the
 * one handle above a region that has no header, the λ term and the source editor.
 *
 * A DRAG MOVES TWO HEIGHTS AND NO OTHER. A share is a ratio, and changing two ratios alone would move every region
 * wherever one of them sat on its floor. So a gesture's first frame measures every open region and makes its height
 * in pixels its share, which draws exactly what was drawn; each frame then moves pixels from one of the two to the
 * other, held where either would go under its floor; and the commit scales the pixels back so that the open
 * regions' shares add up to what they did, which keeps a closed region's stored share in proportion.
 */
export type StackRegion = {
  /** The share's name in the workspace. */
  readonly name: string
  /** What the boundary beside it calls it: "rules". */
  readonly label: string
  /** The element that takes the share. */
  readonly el: HTMLElement
  /**
   * The share it has with nothing stored, or `null` for a region that keeps its own height until a boundary beside
   * it is dragged: a copy's text, as tall as what it holds up to a cap, and the term map's canvas. Such a region is
   * not `data-sized`, and `style.css` gives it a share only where it is.
   */
  readonly share: number | null
  /** The panels drawn in it: one, the asm view's two side by side, or none where the region has no header. */
  readonly panels: readonly Panel[]
  /** The elements whose `min-height` is the region's floor. Asked at each gesture, since a view can swap one. */
  readonly bodies: () => readonly HTMLElement[]
}

/** A view's stored shares, by region name. */
export type Shares = Readonly<Record<string, number>>

/** How far one arrow press moves a boundary, as a fraction of the height the open regions share. */
export const BOUNDARY_KEY_STEP = 0.02

type Live = {
  readonly open: readonly StackRegion[]
  /** Each open region's height when the gesture began, and its floor. */
  readonly start: readonly number[]
  readonly floor: readonly number[]
  /** What one pixel is worth in shares. */
  readonly scale: number
  readonly upper: number
  /**
   * How far the pointer has gone from where the gesture began, in pixels, and how far the boundary has: the first
   * held to what the floors allow. A pointer that overshoots a floor has to come all the way back before the boundary
   * follows it, so the two are kept apart; an arrow key has no position to come back from, and steps from the second.
   */
  pointer: number
  offset: number
}

export class PanelStack {
  readonly #regions: readonly StackRegion[]
  readonly #onSizes: (sizes: Shares) => void
  #sizes: Shares
  #max: Panel | null = null
  readonly #boundaries = new Map<string, HTMLElement>()
  readonly #buttons = new Map<Panel, HTMLButtonElement>()
  #live: Live | null = null

  constructor(regions: readonly StackRegion[], sizes: Shares, onSizes: (sizes: Shares) => void) {
    this.#regions = regions
    this.#sizes = sizes
    this.#onSizes = onSizes
    const watch = new MutationObserver(() => this.sync())
    for (const r of regions) {
      r.el.dataset.region = r.name
      watch.observe(r.el, { attributes: true, attributeFilter: ['hidden', 'data-open'] })
      // TWO PANELS SIDE BY SIDE WRAP ONE UNDER THE OTHER IN A NARROW VIEW, and only a header along the region's top
      // edge is at its boundary: which ones are is read again whenever the region's box changes.
      if (r.panels.length > 1) new ResizeObserver(() => this.sync()).observe(r.el)
      for (const p of r.panels) {
        if (p.el !== r.el) watch.observe(p.el, { attributes: true, attributeFilter: ['hidden', 'data-open'] })
        this.#handle(r, p)
        this.#buttons.set(p, this.#maximise(p))
        // A GESTURE ON ANY DISCLOSURE ENDS A MAXIMISE (spec §11.3): opening another region does, and so does closing
        // the maximised one. The panel has already stored what the press drew.
        p.onGesture(() => this.#setMax(null))
      }
    }
    this.sync()
  }

  /** The shares the workspace holds now: a link opened, or its undo. */
  setSizes(sizes: Shares): void {
    this.#sizes = sizes
    this.sync()
  }

  /** The panel that is maximised, by its `data-panel` name. */
  get maximised(): string | null {
    return this.#max?.el.dataset.panel ?? null
  }

  #isOpen(r: StackRegion): boolean {
    if (r.el.hidden) return false
    return r.panels.length === 0 || r.panels.some((p) => !p.el.hidden && p.isOpen())
  }

  #share(r: StackRegion): number | null {
    return this.#sizes[r.name] ?? r.share
  }

  /** Write every region's share, and draw the boundaries the open regions call for. */
  sync(): void {
    if (this.#live !== null) return
    const open = this.#regions.filter((r) => this.#isOpen(r))
    for (const r of this.#regions) {
      // UNDER A MAXIMISE A REGION WITH NO HEADER KEEPS ITS FLOOR AND NO MORE: it has nothing to be drawn closed as.
      // AND THE MAXIMISED PANEL'S REGION TAKES A SHARE EVEN WHERE IT KEPT ITS OWN HEIGHT, or it would take no more.
      const max = this.#max
      const share =
        max === null
          ? this.#share(r)
          : r.panels.length === 0
            ? 0
            : r.panels.includes(max)
              ? (this.#share(r) ?? 1)
              : this.#share(r)
      this.#write(r, share)
    }
    const want = new Map<string, [StackRegion, StackRegion]>()
    if (this.#max === null) {
      for (let i = 0; i + 1 < open.length; i++) {
        const a = open[i] as StackRegion
        const b = open[i + 1] as StackRegion
        want.set(`${a.name}|${b.name}`, [a, b])
      }
    }
    for (const [key, el] of this.#boundaries) {
      if (want.has(key)) continue
      el.remove()
      this.#boundaries.delete(key)
    }
    for (const [key, [a, b]] of want) {
      let el = this.#boundaries.get(key)
      if (el === undefined) {
        el = this.#boundary(a, b)
        this.#boundaries.set(key, el)
      }
      if (a.el.nextElementSibling !== el) a.el.after(el)
      const sa = this.#share(a)
      const sb = this.#share(b)
      // A REGION THAT KEEPS ITS OWN HEIGHT HAS NO SHARE TO SAY: the value is the middle until a drag measures it.
      const now = sa === null || sb === null ? 50 : Math.round((sa / (sa + sb)) * 100)
      el.setAttribute('aria-valuenow', String(now))
    }
    for (const [p, button] of this.#buttons) button.setAttribute('aria-pressed', String(p === this.#max))
    for (const r of this.#regions) {
      const above = this.#above(r)
      for (const p of r.panels) {
        const header = p.el.querySelector<HTMLElement>(':scope > .panel-header')
        if (header === null) continue
        if (above !== null && this.#atTop(r, p)) header.dataset.resizes = 'true'
        else delete header.dataset.resizes
      }
    }
  }

  /** The region the boundary above `r` parts it from, or `null` where no boundary is drawn above it. */
  #above(r: StackRegion): StackRegion | null {
    for (const a of this.#regions) if (this.#boundaries.has(`${a.name}|${r.name}`)) return a
    return null
  }

  /** Whether `p`'s header lies along the top edge of its region, which a wrapped second panel's does not. */
  #atTop(r: StackRegion, p: Panel): boolean {
    if (r.panels.length < 2) return true
    return p.el.getBoundingClientRect().top - r.el.getBoundingClientRect().top < 4
  }

  /** Make `p`'s header a handle for the boundary above its region `r`. */
  #handle(r: StackRegion, p: Panel): void {
    const header = p.el.querySelector<HTMLElement>(':scope > .panel-header')
    if (header === null) return
    let pair: [StackRegion, StackRegion] | null = null
    pointerDrag(
      header,
      'y',
      {
        drag: (px) => {
          if (pair === null) return
          const live = this.#begin(pair[0], pair[1])
          if (live === null) return
          live.pointer += px
          this.#moveTo(pair[0], pair[1], live, live.pointer)
        },
        commit: () => this.#commit(),
        reset: () => {
          if (pair !== null) this.#reset(pair[0], pair[1])
        },
      },
      (e) => {
        if (e.button !== 0 || (e instanceof PointerEvent && e.pointerType === 'touch')) return false
        if (e.target instanceof Element && e.target.closest('button, select, input, a') !== null) return false
        const above = header.dataset.resizes === 'true' ? this.#above(r) : null
        if (above === null) return false
        pair = [above, r]
        return true
      },
    )
  }

  #write(r: StackRegion, share: number | null): void {
    if (share === null) {
      r.el.style.removeProperty('--share')
      delete r.el.dataset.sized
      return
    }
    r.el.style.setProperty('--share', String(share))
    r.el.dataset.sized = 'true'
  }

  #boundary(a: StackRegion, b: StackRegion): HTMLElement {
    const el = document.createElement('div')
    el.className = 'panel-boundary'
    el.dataset.above = a.name
    el.dataset.below = b.name
    el.setAttribute('role', 'separator')
    el.setAttribute('aria-orientation', 'horizontal')
    el.setAttribute('aria-valuemin', '0')
    el.setAttribute('aria-valuemax', '100')
    el.setAttribute('aria-label', `resize ${a.label} and ${b.label}`)
    el.tabIndex = 0
    separatorGesture(el, 'y', {
      drag: (px) => {
        const live = this.#begin(a, b)
        if (live === null) return
        live.pointer += px
        this.#moveTo(a, b, live, live.pointer)
      },
      step: (sign) => {
        const live = this.#begin(a, b)
        if (live === null) return
        const span = live.start.reduce((sum, h) => sum + h, 0)
        this.#moveTo(a, b, live, live.offset + sign * BOUNDARY_KEY_STEP * span)
        live.pointer = live.offset
      },
      commit: () => this.#commit(),
      reset: () => this.#reset(a, b),
    })
    return el
  }

  /** Put both regions back to the shares they are built with. */
  #reset(a: StackRegion, b: StackRegion): void {
    this.#live = null
    const { [a.name]: _a, [b.name]: _b, ...rest } = this.#sizes
    this.#sizes = rest
    this.#onSizes(rest)
    this.sync()
  }

  /** The gesture's measurements, taken once, at its first frame. */
  #begin(a: StackRegion, b: StackRegion): Live | null {
    if (this.#live !== null) return this.#live
    const open = this.#regions.filter((r) => this.#isOpen(r))
    const upper = open.indexOf(a)
    if (upper < 0 || open[upper + 1] !== b) return null
    // EVERY OPEN REGION TAKES ITS OWN HEIGHT AS ITS SHARE, one that kept its own height among them: measured first,
    // written second, and the floors read third, since a region's floor is its body's `min-height` as a sized one.
    const start = open.map((r) => r.el.getBoundingClientRect().height)
    const px = start.reduce((sum, h) => sum + h, 0)
    if (!(px > 0)) return null
    // WHAT A PIXEL IS WORTH IS WHAT THE REGIONS THAT HAD SHARES SAY: their shares over their pixels. With none, the
    // open regions' shares will add up to their number.
    let shares = 0
    let shared = 0
    open.forEach((r, i) => {
      const s = this.#share(r)
      if (s === null) return
      shares += s
      shared += start[i] as number
    })
    const scale = shared > 0 && shares > 0 ? shares / shared : open.length / px
    open.forEach((r, i) => {
      this.#write(r, start[i] as number)
    })
    const floor = open.map((r, i) => {
      // A REGION'S FLOOR IS ITS HEIGHT LESS WHAT ITS BODY HAS OVER ITS OWN `min-height`. Two bodies side by side
      // reach their floors together; the one with less to give is the one that stops the drag.
      let slack = Number.POSITIVE_INFINITY
      for (const body of r.bodies()) {
        if (body.hidden) continue
        const min = Number.parseFloat(getComputedStyle(body).minHeight)
        slack = Math.min(slack, body.getBoundingClientRect().height - (Number.isFinite(min) ? min : 0))
      }
      const h = start[i] as number
      return Number.isFinite(slack) ? h - Math.max(0, slack) : h
    })
    this.#live = { open, start, floor, scale, upper, pointer: 0, offset: 0 }
    return this.#live
  }

  /** Put the boundary `to` pixels from where the gesture began, or as near as the two floors allow. */
  #moveTo(a: StackRegion, b: StackRegion, live: Live, to: number): void {
    const i = live.upper
    const up = (live.start[i] as number) - (live.floor[i] as number)
    const down = (live.start[i + 1] as number) - (live.floor[i + 1] as number)
    live.offset = Math.min(Math.max(to, -Math.max(0, up)), Math.max(0, down))
    const ha = (live.start[i] as number) + live.offset
    const hb = (live.start[i + 1] as number) - live.offset
    this.#write(a, ha)
    this.#write(b, hb)
    this.#boundaries
      .get(`${a.name}|${b.name}`)
      ?.setAttribute('aria-valuenow', String(Math.round((ha / (ha + hb)) * 100)))
  }

  #commit(): void {
    const live = this.#live
    if (live === null) return
    this.#live = null
    const sizes: Record<string, number> = { ...this.#sizes }
    live.open.forEach((r, i) => {
      const h = (live.start[i] as number) + (i === live.upper ? live.offset : i === live.upper + 1 ? -live.offset : 0)
      sizes[r.name] = Math.round(h * live.scale * 10000) / 10000
    })
    this.#sizes = sizes
    this.#onSizes(sizes)
    this.sync()
  }

  #maximise(p: Panel): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'panel-maximise'
    const name = `maximise ${p.toggle.textContent ?? ''}`.trim()
    button.setAttribute('aria-label', name)
    button.title = name
    button.setAttribute('aria-pressed', 'false')
    button.append(icon('maximise'))
    button.addEventListener('click', () => this.#setMax(this.#max === p ? null : p))
    p.actions.append(button)
    return button
  }

  #setMax(p: Panel | null): void {
    if (p === this.#max) return
    this.#max = p
    for (const r of this.#regions) for (const q of r.panels) q.drawOver(p === null ? null : q === p)
    this.sync()
  }
}
```

In `web/src/panel.ts`:

```diff
--- a/web/src/panel.ts
+++ b/web/src/panel.ts
@@ -13,6 +13,12 @@ import { icon } from './icons'
  *
  * `onToggle` FIRES FOR A GESTURE ONLY. `setOpen` is how a view restores or resets a panel, and a view
  * must not hear its own write back as a user's choice.
+ *
+ * WHAT IS DRAWN IS NOT ALWAYS WHAT IS STORED (the view layouts spec §11.3). A maximised panel's stack draws every
+ * other panel closed and leaves what each one stores alone: `drawOver` says what to draw, `isOpen` answers what is
+ * drawn, since every reader of it is deciding whether to draw into the body, and `onDrawn` tells the view its body
+ * was shown or hidden with no gesture on its own disclosure. A press on the disclosure flips what is DRAWN, and
+ * stores that: a panel drawn closed under a maximise opens, whatever it stored.
  */
 export type PanelOptions = {
   /** Stable, for style rules and tests: `data-panel` on the panel. */
@@ -22,6 +28,8 @@ export type PanelOptions = {
   readonly body: HTMLElement
   readonly open?: boolean
   readonly onToggle?: (open: boolean) => void
+  /** The body was shown or hidden by `drawOver`, not by a gesture: draw into it, or stop. */
+  readonly onDrawn?: () => void
 }
 
 export type Panel = {
@@ -30,8 +38,13 @@ export type Panel = {
   /** Header actions sit here, after the disclosure — `follow current rule` on the rules panel. */
   readonly actions: HTMLElement
   readonly body: HTMLElement
+  /** Whether the body is drawn: what the panel stores, or what `drawOver` draws over it. */
   isOpen(): boolean
   setOpen(open: boolean): void
+  /** Draw the panel open or closed whatever it stores, or, with `null`, as it stores. */
+  drawOver(over: boolean | null): void
+  /** Hear every gesture on the disclosure, after the view's own `onToggle` has: what the panel now stores. */
+  onGesture(heard: (open: boolean) => void): void
 }
 
 let minted = 0
@@ -69,16 +82,21 @@ export function createPanel(opts: PanelOptions): Panel {
   el.append(header, body)
 
   let open = opts.open ?? true
+  let over: boolean | null = null
+  const drawn = (): boolean => over ?? open
   const apply = (): void => {
-    toggle.setAttribute('aria-expanded', String(open))
-    el.dataset.open = String(open)
-    body.hidden = !open
+    toggle.setAttribute('aria-expanded', String(drawn()))
+    el.dataset.open = String(drawn())
+    body.hidden = !drawn()
   }
   apply()
+  const hearers: ((open: boolean) => void)[] = []
   toggle.addEventListener('click', () => {
-    open = !open
+    open = !drawn()
+    over = null
     apply()
     opts.onToggle?.(open)
+    for (const heard of hearers) heard(open)
   })
 
   return {
@@ -86,11 +104,21 @@ export function createPanel(opts: PanelOptions): Panel {
     toggle,
     actions,
     body,
-    isOpen: () => open,
+    isOpen: drawn,
     setOpen(next: boolean) {
       if (next === open) return
       open = next
       apply()
     },
+    drawOver(next: boolean | null) {
+      const was = drawn()
+      over = next
+      if (drawn() === was) return
+      apply()
+      opts.onDrawn?.()
+    },
+    onGesture(heard: (open: boolean) => void) {
+      hearers.push(heard)
+    },
   }
 }
```

In `web/src/style.css`:

```diff
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -1509,6 +1509,51 @@ button.view-title[aria-expanded="true"] {
   margin-inline-start: auto;
   font-size: var(--step--2);
 }
+/* THE BOUNDARY BETWEEN TWO REGIONS OF A VIEW (`panel-stack.ts`, the view layouts spec §11.2): a strip as tall as the
+   gap a panel keeps above itself, which it takes the place of. IT DRAWS NOTHING AT REST AND NOTHING UNDER THE POINTER:
+   the pointer is what says a thing here can be held, an open hand over it and a closed one from the press to the
+   release (`data-dragging`, `separator.ts`'s). A line across the view is drawn for the keyboard's focus alone, which
+   has no pointer to say it. `touch-action` leaves a finger's drag to the gesture. */
+.panel-boundary {
+  position: relative;
+  flex: none;
+  height: var(--space-2);
+  cursor: grab;
+  touch-action: none;
+}
+.panel-boundary:focus-visible::before {
+  content: "";
+  position: absolute;
+  inset-inline: 0;
+  top: calc(50% - 1px);
+  height: 2px;
+  background: var(--accent);
+}
+.panel-boundary:focus-visible {
+  outline-offset: -2px;
+}
+/* A HEADER THAT IS A HANDLE FOR THE BOUNDARY ABOVE IT SAYS SO WITH THE POINTER (`panel-stack.ts`): the boundary's
+   two hands over the bar, and each control on it keeps its own pointer. */
+.panel-header[data-resizes] {
+  cursor: grab;
+}
+.panel-boundary[data-dragging],
+.panel-header[data-resizes][data-dragging] {
+  cursor: grabbing;
+}
+/* MAXIMISE (spec §11.3): a toggle, drawn pressed as a checked choice is, without relying on colour. */
+/* AS TALL AS A BUTTON WITH A WORD ON IT, which a button holding only an icon is not: a line, the shared control
+   rule's padding and its border. Alone in a header it was 16px beside the 22px it has next to a radio group. */
+.panel-maximise {
+  display: inline-flex;
+  align-items: center;
+  box-sizing: border-box;
+  min-height: calc(1lh + 0.2em + 2px);
+}
+.panel-maximise[aria-pressed="true"] {
+  border-color: var(--accent);
+  box-shadow: inset 0 -2px 0 var(--accent);
+}
 /* A PANEL WITH NO ACTIONS DRAWS NO ACTIONS BOX: an empty one still took a place in the wrapping header, so a header
    narrower than its name and the gap after it put the empty box on a second row, 4px lower. */
 .panel-actions:empty {
@@ -2552,12 +2597,31 @@ main {
   display: flex;
   flex-direction: column;
 }
-.tm-pane > .panel[data-panel="rules"][data-open="true"] {
-  flex: 2 1 0;
-}
+/* THE SHARE IS `panel-stack.ts`'s TO WRITE (the view layouts spec §11): the one a region is built with, the rules
+   two and the others one each, or the one a dragged boundary left. */
+.tm-pane > .panel[data-panel="rules"][data-open="true"],
 .tm-pane > .panel[data-panel="diagram"][data-open="true"],
 .tm-pane > .panel[data-panel="outline"][data-open="true"] {
+  flex: var(--share, 1) 1 0;
+}
+/* THE BOUNDARY UNDER A COPY'S TEXT TAKES THE PLACE OF THE GAP ITS EDITOR KEPT UNDER ITSELF, as a boundary over a panel
+   takes the gap that panel kept above: with both, what lies under the text sat 8px lower than it did before a boundary
+   could be drawn there. */
+.panel[data-panel="text"]:has(+ .panel-boundary) > .term-editor {
+  margin-bottom: 0;
+}
+/* A COPY'S TEXT KEEPS ITS OWN HEIGHT UNTIL A BOUNDARY BESIDE IT IS DRAGGED, and is `data-sized` from then on: a
+   region of the stack like the others, its editor scrolling inside the share it has. */
+.tm-pane > .panel[data-panel="text"][data-open="true"][data-sized]:not([hidden]),
+.asm-pane > .panel[data-panel="text"][data-open="true"][data-sized]:not([hidden]) {
+  display: flex;
+  flex-direction: column;
+  flex: var(--share, 1) 1 0;
+}
+.panel[data-panel="text"][data-open="true"][data-sized] > .term-editor {
   flex: 1 1 0;
+  max-height: none;
+  min-height: 2lh;
 }
 /* THE FLOORS ARE THE BODIES', so a panel's own minimum is its header and a floor, whatever the header's height.
    Five rows each: the table's are `ROW_HEIGHT`, the outline's a line of its own. */
@@ -2610,13 +2674,13 @@ main {
   display: flex;
   flex-direction: column;
 }
-.asm-pane > .panel[data-panel="listing"][data-open="true"] {
-  flex: 2 1 0;
-}
+/* THE SHARES ARE `panel-stack.ts`'s TO WRITE, as the TM view's are: the listing's two and the others' one each, or
+   what a dragged boundary left. */
+.asm-pane > .panel[data-panel="listing"][data-open="true"],
 .asm-pane > .panel[data-panel="heap"][data-open="true"],
 .asm-pane > .panel[data-panel="outline"][data-open="true"],
 .asm-pane > .asm-machine:has(> .panel[data-open="true"]) {
-  flex: 1 1 0;
+  flex: var(--share, 1) 1 0;
 }
 .asm-pane > .panel[data-open="true"] > .outline {
   flex: 1 1 0;
@@ -2736,3 +2800,11 @@ main {
 .asm-refs {
   color: var(--fg-dim);
 }
+
+/* THE BOUNDARY TAKES THE PLACE OF THE GAP THE REGION UNDER IT KEEPS ABOVE ITSELF. Here, after the rules that set
+   those gaps, with the source and λ views' regions below: Biome's `noDescendingSpecificity` rejects a selector that
+   follows a more specific one for the same element, and each of these narrows a rule far above it. */
+.panel-boundary + .panel,
+.panel-boundary + .asm-machine {
+  margin-block-start: 0;
+}
```

In `web/src/tm-pane.ts`:

```diff
--- a/web/src/tm-pane.ts
+++ b/web/src/tm-pane.ts
@@ -5,6 +5,7 @@ import { n } from './format'
 import type { Dir } from './layout'
 import type { PaneChoice, PaneEvents, SplitChoices } from './pane-chrome'
 import { createPanel, type Panel } from './panel'
+import { PanelStack, type Shares } from './panel-stack'
 import type { Leg } from './protocol'
 import { valueLine } from './results'
 import type { ScratchEditor } from './scratch-editor'
@@ -173,6 +174,7 @@ export class TmPane implements EditablePane {
     on: PaneEvents,
     panels: { readonly rules?: boolean; readonly diagram?: boolean; readonly outline?: boolean } = {},
     display: TmDisplay = DEFAULT_TM_DISPLAY,
+    sizes: Shares = {},
   ) {
     this.#display = display
     this.#onDisplay = on.tmDisplay
@@ -281,6 +283,7 @@ export class TmPane implements EditablePane {
         this.#drawTable()
         on.panel?.('rules', open)
       },
+      onDrawn: () => this.#drawTable(),
     })
     this.#rulesPanel.actions.append(this.#reattach)
 
@@ -351,6 +354,10 @@ export class TmPane implements EditablePane {
         this.#syncDiagramReattach()
         on.panel?.('diagram', open)
       },
+      onDrawn: () => {
+        this.#diagram.redraw()
+        this.#syncDiagramReattach()
+      },
     })
     this.#diagramPanel.actions.append(this.#diagramReattach, this.#levelChoice.el, this.#edgesChoice.el)
 
@@ -371,6 +378,48 @@ export class TmPane implements EditablePane {
     )
     this.#header.steps.append(this.#steps.el)
     host.replaceChildren(this.#header.el, this.#body)
+    // THE REGIONS THAT SHARE THE VIEW'S HEIGHT (the view layouts spec §11.1), top to bottom. The rules take two
+    // shares and the diagram and the outline one each, as `style.css` fixed them before a boundary could be dragged;
+    // a copy's text keeps its own height until one is.
+    // IT KEEPS ITSELF: its listeners are on the regions and their headers, and nothing here reads it again.
+    new PanelStack(
+      [
+        {
+          name: 'text',
+          label: 'text',
+          el: this.#copy.text.el,
+          share: null,
+          panels: [this.#copy.text],
+          bodies: () => [this.#copy.text.body],
+        },
+        {
+          name: 'rules',
+          label: 'rules',
+          el: this.#rulesPanel.el,
+          share: 2,
+          panels: [this.#rulesPanel],
+          bodies: () => [this.#rulesPanel.body],
+        },
+        {
+          name: 'diagram',
+          label: 'state diagram',
+          el: this.#diagramPanel.el,
+          share: 1,
+          panels: [this.#diagramPanel],
+          bodies: () => [this.#diagramPanel.body],
+        },
+        {
+          name: 'outline',
+          label: 'outline',
+          el: this.#copy.outlinePanel.el,
+          share: 1,
+          panels: [this.#copy.outlinePanel],
+          bodies: () => [this.#copy.outlinePanel.body],
+        },
+      ],
+      sizes,
+      (next) => on.panelSizes?.(next),
+    )
   }
 
   /**
```

- [ ] **Step 4: Run them, and see them pass**

```bash
pnpm exec vitest run --project browser tests/browser/panel-boundaries.test.ts tests/browser/panel-maximise.test.ts tests/browser/panel-regions.test.ts tests/browser/panel-sizes-stored.test.ts tests/browser/panel-sizes-restore.test.ts tests/browser/tm-view-narrow.test.ts
```

On the replay (`t3-pass.log`): files: 6 passed (6); tests: 62 passed (62).

- [ ] **Step 5: Break it on purpose, once a sabotage, and put it back**

Each entry is the replay's own record. Its `sab.py` saved the file, made the edit, ran
`pnpm exec vitest run --project <project> <files>` on the files named, copied the saved file back and compared
the two byte for byte.

**S3a** `panel-stack.ts`: a boundary is not held to its neighbours' floors. Run: `tests/browser/panel-boundaries.test.ts` (`sab-S3a.log`): 1 failed | 17 passed (18). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -317,7 +317,7 @@
     const i = live.upper
     const up = (live.start[i] as number) - (live.floor[i] as number)
     const down = (live.start[i + 1] as number) - (live.floor[i + 1] as number)
-    live.offset = Math.min(Math.max(to, -Math.max(0, up)), Math.max(0, down))
+    live.offset = to
     const ha = (live.start[i] as number) + live.offset
     const hb = (live.start[i + 1] as number) - live.offset
     this.#write(a, ha)
```

What failed:

```
a drag of a boundary > stops where a neighbour would go under its floor of five rows
```

**S3b** `panel-stack.ts`: the pointer's travel and the boundary's are one number, held to the floors. Run: `tests/browser/panel-boundaries.test.ts` (`sab-S3b.log`): 1 failed | 17 passed (18). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -246,8 +246,7 @@
       drag: (px) => {
         const live = this.#begin(a, b)
         if (live === null) return
-        live.pointer += px
-        this.#moveTo(a, b, live, live.pointer)
+        this.#moveTo(a, b, live, live.offset + px)
       },
       step: (sign) => {
         const live = this.#begin(a, b)
```

What failed:

```
a drag of a boundary > follows a pointer that overshot a floor only once it is back
```

**S3c** `panel-stack.ts`: a press on a control in a header starts a drag. Run: `tests/browser/panel-boundaries.test.ts` (`sab-S3c.log`): 3 failed | 15 passed (18). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -212,7 +212,6 @@
       },
       (e) => {
         if (e.button !== 0 || (e instanceof PointerEvent && e.pointerType === 'touch')) return false
-        if (e.target instanceof Element && e.target.closest('button, select, input, a') !== null) return false
         const above = header.dataset.resizes === 'true' ? this.#above(r) : null
         if (above === null) return false
         pair = [above, r]
```

What failed:

```
a panel’s header, as the handle for the boundary above it > leaves a press on one of its controls to the control
a panel’s header, as the handle for the boundary above it > says so with the pointer where a boundary lies above it, and nowhere else
the boundaries of a view > skip a closed region, and are drawn beside it again once it is open
```

**S3d** `panel-stack.ts`: a finger's press on a header starts a drag. Run: `tests/browser/panel-boundaries.test.ts` (`sab-S3d.log`): 1 failed | 17 passed (18). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -211,7 +211,7 @@
         },
       },
       (e) => {
-        if (e.button !== 0 || (e instanceof PointerEvent && e.pointerType === 'touch')) return false
+        if (e.button !== 0) return false
         if (e.target instanceof Element && e.target.closest('button, select, input, a') !== null) return false
         const above = header.dataset.resizes === 'true' ? this.#above(r) : null
         if (above === null) return false
```

What failed:

```
a panel’s header, as the handle for the boundary above it > leaves a finger’s press alone, which the boundary itself takes
```

**S3e** `panel-stack.ts`: a panel that has wrapped under the one beside it is still a handle. Run: `tests/browser/panel-boundaries.test.ts` (`sab-S3e.log`): 1 failed | 17 passed (18). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -185,8 +185,7 @@
 
   /** Whether `p`'s header lies along the top edge of its region, which a wrapped second panel's does not. */
   #atTop(r: StackRegion, p: Panel): boolean {
-    if (r.panels.length < 2) return true
-    return p.el.getBoundingClientRect().top - r.el.getBoundingClientRect().top < 4
+    return true
   }
 
   /** Make `p`'s header a handle for the boundary above its region `r`. */
```

What failed:

```
a panel’s header, as the handle for the boundary above it > is not a handle on a panel that has wrapped under the one beside it
```

**S3f** `panel-stack.ts`: a gesture gives only the two regions it parts their measured heights as shares. Run: `tests/browser/panel-boundaries.test.ts` (`sab-S3f.log`): 3 failed | 15 passed (18). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -294,7 +294,7 @@
     })
     const scale = shared > 0 && shares > 0 ? shares / shared : open.length / px
     open.forEach((r, i) => {
-      this.#write(r, start[i] as number)
+      if (r === a || r === b) this.#write(r, start[i] as number)
     })
     const floor = open.map((r, i) => {
       // A REGION'S FLOOR IS ITS HEIGHT LESS WHAT ITS BODY HAS OVER ITS OWN `min-height`. Two bodies side by side
```

What failed:

```
a drag of a boundary > follows a pointer that overshot a floor only once it is back
a drag of a boundary > stops where a neighbour would go under its floor of five rows
a panel’s header, as the handle for the boundary above it > leaves a finger’s press alone, which the boundary itself takes
```

**S3g** `panel-stack.ts`: a gesture stores pixels, not shares scaled to what they added up to. Run: `tests/browser/panel-boundaries.test.ts`, `tests/browser/panel-sizes-stored.test.ts` (`sab-S3g.log`): 5 failed | 19 passed (24). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -334,7 +334,7 @@
     const sizes: Record<string, number> = { ...this.#sizes }
     live.open.forEach((r, i) => {
       const h = (live.start[i] as number) + (i === live.upper ? live.offset : i === live.upper + 1 ? -live.offset : 0)
-      sizes[r.name] = Math.round(h * live.scale * 10000) / 10000
+      sizes[r.name] = Math.round(h * 10000) / 10000
     })
     this.#sizes = sizes
     this.#onSizes(sizes)
```

What failed:

```
a boundary moved with the keys > and at a double click on the boundary itself
a boundary moved with the keys > goes back to the shares the two regions are built with at Enter
a drag of a boundary > moves the two regions it parts and no other, and the view does not grow
a panel’s header, as the handle for the boundary above it > puts the two regions back to the shares they are built with at a double click on the bar
a view’s shares, in the stored workspace > are written once at the end of a drag, for the view that was dragged in
```

**S3i** `panel.ts`: a panel drawn open or closed by a maximise does not tell its view. Run: `tests/browser/panel-sizes-stored.test.ts` (`sab-S3i.log`): 2 failed | 4 passed (6). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel.ts
+++ b/web/src/panel.ts
@@ -115,7 +115,6 @@
       over = next
       if (drawn() === was) return
       apply()
-      opts.onDrawn?.()
     },
     onGesture(heard: (open: boolean) => void) {
       hearers.push(heard)
```

What failed:

```
a view’s shares, in the stored workspace > are not written by a maximise, which a load does not bring back
a view’s shares, in the stored workspace > withdraw a hidden panel’s offer to follow again under a maximise, and bring it back with the panel
```

**S3j** `panel.ts`: a press on a disclosure flips what the panel stores, not what is drawn. Run: `tests/browser/panel-maximise.test.ts` (`sab-S3j.log`): 1 failed | 9 passed (10). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel.ts
+++ b/web/src/panel.ts
@@ -92,7 +92,7 @@
   apply()
   const hearers: ((open: boolean) => void)[] = []
   toggle.addEventListener('click', () => {
-    open = !drawn()
+    open = !open
     over = null
     apply()
     opts.onToggle?.(open)
```

What failed:

```
a panel’s maximise button > ends when another panel is opened by its own disclosure, which that panel stores
```

**S3k** `panel-stack.ts`: a gesture on a disclosure does not end a maximise. Run: `tests/browser/panel-maximise.test.ts` (`sab-S3k.log`): 3 failed | 7 passed (10). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -95,7 +95,7 @@
         this.#buttons.set(p, this.#maximise(p))
         // A GESTURE ON ANY DISCLOSURE ENDS A MAXIMISE (spec §11.3): opening another region does, and so does closing
         // the maximised one. The panel has already stored what the press drew.
-        p.onGesture(() => this.#setMax(null))
+        p.onGesture(() => {})
       }
     }
     this.sync()
```

What failed:

```
a panel’s maximise button > ends when another panel is opened by its own disclosure, which that panel stores
a panel’s maximise button > ends when the maximised panel is closed by its own disclosure
a panel’s maximise button > opens a panel that was stored closed when its disclosure is pressed under a maximise
```

**S3l** `separator.ts`: a held handle is not marked `data-dragging`. Run: `tests/browser/panel-boundaries.test.ts` (`sab-S3l.log`): 1 failed | 17 passed (18). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/separator.ts
+++ b/web/src/separator.ts
@@ -49,7 +49,6 @@
     if (!accept(e)) return
     dragging = true
     // HELD, FOR THE STYLESHEET: a handle that draws a hand draws it closed from the press to the release.
-    el.dataset.dragging = 'true'
     moved = false
     last = axis === 'x' ? e.clientX : e.clientY
     // BEFORE `setPointerCapture`, NOT AFTER. Capture throws `NotFoundError` for a synthetic
```

What failed:

```
a panel’s header, as the handle for the boundary above it > draws an open hand at rest and a closed one while it is held
```

**S3m** `style.css`: the boundary's line is drawn at rest, not for a key's focus alone. Run: `tests/browser/panel-boundaries.test.ts` (`sab-S3m.log`): 1 failed | 17 passed (18). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -1521,7 +1521,7 @@
   cursor: grab;
   touch-action: none;
 }
-.panel-boundary:focus-visible::before {
+.panel-boundary::before {
   content: "";
   position: absolute;
   inset-inline: 0;
```

What failed:

```
the boundaries of a view > draw nothing at rest or under the pointer, and a line for the keyboard’s focus
```

**S3n** `style.css`: a header that is a handle shows the resize cursor, not an open hand. Run: `tests/browser/panel-boundaries.test.ts` (`sab-S3n.log`): 2 failed | 16 passed (18). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -1535,7 +1535,7 @@
 /* A HEADER THAT IS A HANDLE FOR THE BOUNDARY ABOVE IT SAYS SO WITH THE POINTER (`panel-stack.ts`): the boundary's
    two hands over the bar, and each control on it keeps its own pointer. */
 .panel-header[data-resizes] {
-  cursor: grab;
+  cursor: row-resize;
 }
 .panel-boundary[data-dragging],
 .panel-header[data-resizes][data-dragging] {
```

What failed:

```
a panel’s header, as the handle for the boundary above it > draws an open hand at rest and a closed one while it is held
a panel’s header, as the handle for the boundary above it > says so with the pointer where a boundary lies above it, and nowhere else
```

**S3o** `main.ts`: a view closed by its `✕` keeps its shares in memory. Run: `tests/browser/panel-sizes-stored.test.ts` (`sab-S3o.log`): 1 failed | 5 passed (6). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1404,7 +1404,6 @@
         ws = {
           ...ws,
           panels: without(ws.panels),
-          panelSizes: without(ws.panelSizes),
           display: without(ws.display),
           tmDisplay: without(ws.tmDisplay),
         }
```

What failed:

```
a view’s shares, in the stored workspace > are dropped with a view closed by its ✕, and the view built next under its id has none
```

**S3p** `pane-host.ts`: a TM view is built without the shares its leaf holds. Run: `tests/browser/panel-sizes-restore.test.ts` (`sab-S3p.log`): 1 failed | 1 passed (2). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1676,7 +1676,7 @@
               ...(outline === undefined ? {} : { outline }),
             },
             tmDisplayOf(l.id) ?? DEFAULT_TM_DISPLAY,
-            panelSizesOf(l.id) ?? {},
+            {},
           )
           // **A NEW TM PANE IS SEEDED FROM ITS SESSION, BECAUSE THE REPLY THAT WOULD HAVE TOLD IT HAS
           // ALREADY BEEN AND GONE.** `TmPane.setProgram` was called from `replies.ts` and from nowhere
```

What failed:

```
a workspace stored with shares > opens the TM view with its state diagram twice its rules, as stored
```

**S3q** `style.css`: a copy's editor keeps the gap under itself beside the boundary's. Run: `tests/browser/panel-regions.test.ts` (`sab-S3q.log`): 1 failed | 2 passed (3). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -2608,7 +2608,7 @@
    takes the gap that panel kept above: with both, what lies under the text sat 8px lower than it did before a boundary
    could be drawn there. */
 .panel[data-panel="text"]:has(+ .panel-boundary) > .term-editor {
-  margin-bottom: 0;
+  margin-bottom: 0.5rem;
 }
 /* A COPY'S TEXT KEEPS ITS OWN HEIGHT UNTIL A BOUNDARY BESIDE IT IS DRAGGED, and is `data-sized` from then on: a
    region of the stack like the others, its editor scrolling inside the share it has. */
```

What failed:

```
a copy’s text, in a TM view > takes a share at the first drag, and the tapes move with the boundary at the height they had
```

**S3r** `panel-stack.ts`: a header along its region's top is a handle with no boundary above it. Run: `tests/browser/panel-boundaries.test.ts` (`sab-S3r.log`): 2 failed | 16 passed (18). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -171,7 +171,7 @@
       for (const p of r.panels) {
         const header = p.el.querySelector<HTMLElement>(':scope > .panel-header')
         if (header === null) continue
-        if (above !== null && this.#atTop(r, p)) header.dataset.resizes = 'true'
+        if (above !== null || this.#atTop(r, p)) header.dataset.resizes = 'true'
         else delete header.dataset.resizes
       }
     }
```

What failed:

```
a panel’s header, as the handle for the boundary above it > is not a handle on a panel that has wrapped under the one beside it
a panel’s header, as the handle for the boundary above it > says so with the pointer where a boundary lies above it, and nowhere else
```

**S3s** `panel-stack.ts`: a reset leaves the two regions the shares they have. Run: `tests/browser/panel-boundaries.test.ts`, `tests/browser/panel-regions.test.ts`, `tests/browser/panel-sizes-stored.test.ts` (`sab-S3s.log`): 9 failed | 18 passed (27). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -265,7 +265,7 @@
   /** Put both regions back to the shares they are built with. */
   #reset(a: StackRegion, b: StackRegion): void {
     this.#live = null
-    const { [a.name]: _a, [b.name]: _b, ...rest } = this.#sizes
+    const rest = this.#sizes
     this.#sizes = rest
     this.#onSizes(rest)
     this.sync()
```

What failed:

```
a boundary moved with the keys > and at a double click on the boundary itself
a boundary moved with the keys > goes back to the shares the two regions are built with at Enter
a copy’s text, in a TM view > goes back to its own height at Enter on its boundary
a panel’s header, as the handle for the boundary above it > puts the two regions back to the shares they are built with at a double click on the bar
a view’s shares, in the stored workspace > are dropped with a view closed by its ✕, and the view built next under its id has none
a view’s shares, in the stored workspace > are kept for a view its toggle takes off the page, which comes back with them
a view’s shares, in the stored workspace > are not written by a maximise, which a load does not bring back
a view’s shares, in the stored workspace > are put back to none by Enter on the boundary, which leaves no entry for the view
a view’s shares, in the stored workspace > withdraw a hidden panel’s offer to follow again under a maximise, and bring it back with the panel
```

**S3t** `panel-stack.ts`: a boundary is put directly over the lower region, not under the upper. Run: `tests/browser/panel-boundaries.test.ts`, `tests/browser/panel-regions.test.ts` (`sab-S3t.log`): 3 failed | 18 passed (21). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -158,7 +158,7 @@
         el = this.#boundary(a, b)
         this.#boundaries.set(key, el)
       }
-      if (a.el.nextElementSibling !== el) a.el.after(el)
+      if (b.el.previousElementSibling !== el) b.el.before(el)
       const sa = this.#share(a)
       const sb = this.#share(b)
       // A REGION THAT KEEPS ITS OWN HEIGHT HAS NO SHARE TO SAY: the value is the middle until a drag measures it.
```

What failed:

```
a copy’s text, in a TM view > keeps its own height, with a boundary under it, above the tapes
a copy’s text, in a TM view > takes a share at the first drag, and the tapes move with the boundary at the height they had
the boundaries of a view > skip a closed region, and are drawn beside it again once it is open
```

**S3u** `panel-stack.ts`: the maximise button is the first of a header's actions. Run: `tests/browser/panel-maximise.test.ts` (`sab-S3u.log`): 1 failed | 9 passed (10). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -351,7 +351,7 @@
     button.setAttribute('aria-pressed', 'false')
     button.append(icon('maximise'))
     button.addEventListener('click', () => this.#setMax(this.#max === p ? null : p))
-    p.actions.append(button)
+    p.actions.prepend(button)
     return button
   }
 
```

What failed:

```
a panel’s maximise button > is in each panel’s header after its other actions, named for its panel, and not pressed
```

**S3v** `panel-stack.ts`: an arrow key is worth two steps. Run: `tests/browser/panel-boundaries.test.ts` (`sab-S3v.log`): 1 failed | 17 passed (18). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -253,7 +253,7 @@
         const live = this.#begin(a, b)
         if (live === null) return
         const span = live.start.reduce((sum, h) => sum + h, 0)
-        this.#moveTo(a, b, live, live.offset + sign * BOUNDARY_KEY_STEP * span)
+        this.#moveTo(a, b, live, live.offset + sign * 2 * BOUNDARY_KEY_STEP * span)
         live.pointer = live.offset
       },
       commit: () => this.#commit(),
```

What failed:

```
a boundary moved with the keys > moves by a step a press, and reports once for a key held down
```

- [ ] **Step 6: The whole suite**

`pnpm exec biome ci --error-on-warnings`, `pnpm exec tsc --noEmit -p .`, `pnpm exec vitest run --project node` and
`pnpm exec vitest run --project browser`, all from `web/`. On the replay, after this task:

`biome ci` exit 0, typecheck exit 0. Node (`t3-suite-node.log`): 70 passed (70) files, 1406 passed (1406) tests. Browser (`t3-suite-browser.log`): 209 passed (209) files, 1472 passed (1472) tests, with the machine's load average at 7.89 before the run and 10.15 after it.

- [ ] **Step 7: Commit**

```bash
git add web/help.html \
  web/src/asm-pane.ts \
  web/src/copy-editor.ts \
  web/src/icons.ts \
  web/src/main.ts \
  web/src/pane-chrome.ts \
  web/src/pane-host.ts \
  web/src/panel-stack.ts \
  web/src/panel.ts \
  web/src/style.css \
  web/src/tm-pane.ts \
  web/tests/browser/panel-boundaries.test.ts \
  web/tests/browser/panel-maximise.test.ts \
  web/tests/browser/panel-regions.test.ts \
  web/tests/browser/panel-sizes-restore.test.ts \
  web/tests/browser/panel-sizes-stored.test.ts \
  web/tests/browser/tm-view-narrow.test.ts
git commit -F - <<'EOF'
The regions of a TM or an asm view can be resized: a boundary between two is dragged by the header of the panel under it or moved with the arrow keys, each panel has a maximise button, and the workspace keeps the sizes

`panel-stack.ts` gives each open region of a view a share of its height, written as `--share` and read by the
stylesheet's `flex`, where the stylesheet fixed two, one and one. It draws a `role="separator"` under each open
region that has an open region below it, named for the two; makes the header of the panel under a boundary its
handle, an open hand over the bar and a closed one while it is held, with each control on the bar keeping its own
press; and stops a drag where either neighbour would go under its floor. A drag gives every open region its measured
height as its share, moves two of them, and scales the shares back when it ends, so no other region moves.
Nothing is drawn for a boundary at rest or under the pointer; a line is, for a key's focus.

Each panel's header gains a maximise button. Pressed, its panel takes the view's spare height and every other panel
is drawn closed (`panel.ts`'s `drawOver`), with what each stores left alone; a press on any disclosure ends it.

A copy's text joins its view's regions, at its own height until the boundary under it is dragged. The shares are
`Workspace.panelSizes`, written once a gesture, and a view is built with its own.
EOF
```

### Task 4: The λ view and the source view share their height, and are given the same boundaries

The two views that did not share their height (spec §11.1). The λ term loses its cap of `60vh` and takes its view's
spare height; the source editor takes its view's and scrolls inside it, under a header that stays put; and each view
gets a `PanelStack`. The four test files Task 3 left short are finished here.

**The source view's own box no longer scrolls a long program, and 22 cases in three files said it did**
(`focus-scroll.test.ts`, `scroll-kept.test.ts`, `divider-drag-focus.test.ts`). They are re-aimed at the editor's own
box. Two change what they hold and not only where: a key's focus on the source view's first control is in sight
already, so it moves nothing, and the half of that rule that moves a view is held by a new case on a TM view in a
window 420 px tall.

**`startEditorsAtTop` is a fix the move exposed.** CodeMirror puts its own scroll position back when it is focused at
0, and a link's *undo* builds every view again and focuses the source editor in the same task.

**Files:**

- Modify: `web/src/lambda-pane.ts`
- Modify: `web/src/main.ts`
- Modify: `web/src/pane-host.ts`
- Modify: `web/src/style.css`
- Modify: `web/tests/browser/divider-drag-focus.test.ts`
- Modify: `web/tests/browser/focus-scroll.test.ts`
- Modify: `web/tests/browser/panel-maximise.test.ts`
- Modify: `web/tests/browser/panel-regions.test.ts`
- Create: `web/tests/browser/panel-sizes-restore-lambda.test.ts`
- Modify: `web/tests/browser/panel-sizes-restore.test.ts`
- Modify: `web/tests/browser/panel-sizes-stored.test.ts`
- Modify: `web/tests/browser/scroll-kept.test.ts`

**Interfaces:**

- Consumes: Task 3's `PanelStack`, `Shares` and `Panel.onDrawn`; Task 2's `withPanelSizes`.
- Produces, in `web/src/lambda-pane.ts`: `LambdaPane`'s options take `sizes?: Shares`.
- Produces, in `web/src/pane-host.ts`: `startEditorsAtTop(fresh)`, a closure inside `createPaneHost`.
- Produces: nothing another task calls.

- [ ] **Step 1: Write the tests**

In `web/tests/browser/divider-drag-focus.test.ts`:

```diff
--- a/web/tests/browser/divider-drag-focus.test.ts
+++ b/web/tests/browser/divider-drag-focus.test.ts
@@ -18,7 +18,7 @@ import { focusInPage, host, resetToFirstLoad, SHELL, showWideDefault, until } fr
  *
  * **A POINTER'S GESTURE SCROLLS NOTHING** (`pane-host.ts`'s `moveFocus`), and a drag is always a pointer's where it
  * has a focus to give back: the second case has the caret out of sight, where a give-back that brought it into
- * sight moved the view from 500 px to 80.
+ * sight moved the view from 500 px to 80, while the source view's own box was what scrolled a long program.
  *
  * **A DIVIDER MOVED WITH ITS OWN KEYS HAS THE FOCUS ITSELF**, and is built again at the end of each press: the render
  * focuses the new one (`layout-view.ts`'s `renderLayout`), which is held here beside the rest.
@@ -27,13 +27,15 @@ import { focusInPage, host, resetToFirstLoad, SHELL, showWideDefault, until } fr
 // BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
 localStorage.removeItem(LAYOUT_STORAGE_KEY)
 
-/** 61 lines, so the source view scrolls, and no line long enough to wrap when the view is made narrower. */
+/** 61 lines, so the source editor scrolls, and no line long enough to wrap when the view is made narrower. */
 const PROGRAM = `let x = 40;${'\n'.repeat(60)}x + 2`
 
 let view: EditorView
 
 const frames = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
 const source = (): HTMLElement => host('source') as HTMLElement
+/** The box that scrolls a long program: the source editor's own, in the share of its view it has (spec §11.1). */
+const editor = (): HTMLElement => source().querySelector('.cm-scroller') as HTMLElement
 const dividerAt = (path: string): HTMLElement =>
   document.querySelector<HTMLElement>(`#views .layout-divider[data-path="${path}"]`) as HTMLElement
 const share = (path: string): number => Number(dividerAt(path).getAttribute('aria-valuenow'))
@@ -85,11 +87,13 @@ beforeEach(async () => {
 describe('a divider dragged with the pointer, on the source beside the TM view', () => {
   beforeEach(async () => {
     await resetToFirstLoad()
-    expect(source().scrollHeight - source().clientHeight, 'precondition: the source view scrolls').toBeGreaterThan(500)
+    expect(editor().scrollHeight - editor().clientHeight, 'precondition: the source editor scrolls').toBeGreaterThan(
+      500,
+    )
   })
 
   it('leaves the caret in the editor it was in, and a key typed next lands at it', async () => {
-    source().scrollTop = 120
+    editor().scrollTop = 120
     // A CLICK OF THE DRIVER'S IN A LINE THAT IS IN SIGHT, which is how the caret comes to be mid-document.
     const line = [...source().querySelectorAll<HTMLElement>('.cm-line')].find(
       (l) => l.getBoundingClientRect().top > source().getBoundingClientRect().top + 200,
@@ -99,14 +103,14 @@ describe('a divider dragged with the pointer, on the source beside the TM view',
     expect(view.hasFocus, 'precondition: the click put the focus in the editor').toBe(true)
     expect(caret, 'precondition: the caret is past the first line').toBeGreaterThan(PROGRAM.indexOf('\n'))
     expect(caret, 'precondition: and short of the last').toBeLessThan(PROGRAM.lastIndexOf('\n'))
-    const scrolled = source().scrollTop
+    const scrolled = editor().scrollTop
     expect(scrolled, 'precondition: the source view is scrolled').toBeGreaterThan(0)
 
     await drag('[]')
     await holdsFocus(view.contentDOM, 'the drag took the focus out of the editor')
     expect(view.hasFocus).toBe(true)
     expect(view.state.selection.main.head, 'the drag moved the caret').toBe(caret)
-    expect(source().scrollTop, 'the drag scrolled the view').toBe(scrolled)
+    expect(editor().scrollTop, 'the drag scrolled the view').toBe(scrolled)
 
     await userEvent.keyboard('Z')
     expect(view.state.doc.toString(), 'the key typed after the drag did not land at the caret').toBe(
@@ -145,13 +149,13 @@ describe('a divider dragged with the pointer, on the source beside the TM view',
 
   it('does not scroll the view to a caret that is out of sight', async () => {
     await caretOn(2)
-    source().scrollTop = 500
+    editor().scrollTop = 500
     await frames()
-    expect(source().scrollTop, 'precondition: the view is scrolled past the caret').toBe(500)
+    expect(editor().scrollTop, 'precondition: the view is scrolled past the caret').toBe(500)
 
     await drag('[]')
     await holdsFocus(view.contentDOM, 'the drag took the focus out of the editor')
-    expect(source().scrollTop, 'the focus given back after a pointer’s drag scrolled the view').toBe(500)
+    expect(editor().scrollTop, 'the focus given back after a pointer’s drag scrolled the view').toBe(500)
   })
 
   it('leaves the focus on what had it in the other view', async () => {
```

In `web/tests/browser/focus-scroll.test.ts`:

```diff
--- a/web/tests/browser/focus-scroll.test.ts
+++ b/web/tests/browser/focus-scroll.test.ts
@@ -11,15 +11,20 @@ import { drawn, resetToFirstLoad, SHELL, showWideDefault, until } from './harnes
  * `pane-host.ts`'s `moveFocus`: a focus the app moves as the consequence of a gesture scrolls nothing where the
  * gesture was a pointer's, and brings what it focused into sight where it was a key's.
  *
- * **A VIEW'S FIRST CONTROL IS IN ITS HEADER, WHICH SCROLLS WITH THE VIEW.** So the two halves cannot both keep a
- * scrolled view where it was: a pointer press leaves it there with its first control out of sight and no ring drawn
- * on it, and a key press brings the control into sight, which for a control in the header is the view at its top.
- * Each case says which half it is.
+ * **A VIEW'S FIRST CONTROL IS IN ITS HEADER, WHICH SCROLLS WITH THE VIEW WHERE THE VIEW'S OWN BOX SCROLLS.** There the
+ * two halves cannot both keep a scrolled view where it was: a pointer press leaves it there with its first control
+ * out of sight and no ring drawn on it, and a key press brings the control into sight, which for a control in the
+ * header is the view at its top. Each case says which half it is.
+ *
+ * **THE SOURCE VIEW'S OWN BOX DOES NOT SCROLL A LONG PROGRAM ANY LONGER** (the view layouts spec §11.1): its editor
+ * takes a share of the view and scrolls inside it, under a header that stays put. So a focus given to the source
+ * view's first control is in sight wherever the editor is scrolled to, and both halves leave the editor where it
+ * was; the key's half is held to moving a view by the TM view, in a window short enough that its own box scrolls.
  *
  * **ON THE VIEWS A VISITOR GETS, NOT THE FOUR `setup.ts` STORES**: the source beside the TM view, and all four as two
- * columns. In both the source view is the neighbour a `✕` gives the focus to, and it is the one view whose own box is
- * what scrolls a long program. On the stored four, in two rows, the view `scroll-kept.test.ts` closes has the λ view
- * for its neighbour, and that file passed while a `✕` beside the source view put the source view at 0.
+ * columns. In both the source view is the neighbour a `✕` gives the focus to. On the stored four, in two rows, the
+ * view `scroll-kept.test.ts` closes has the λ view for its neighbour, and that file passed while a `✕` beside the
+ * source view put the source view at 0.
  *
  * `scroll-kept.test.ts` holds a scroll position across a rebuild made from ANOTHER view; this file holds it for the
  * view the rebuild's focus lands in.
@@ -44,6 +49,10 @@ const mounted = (): string[] =>
 const toggle = (kind: string): HTMLButtonElement =>
   document.querySelector(`#views-shown button[data-shows="${kind}"]`) as HTMLButtonElement
 const source = (): HTMLElement => host('source')
+/** The box that scrolls a long program: the source editor's own, inside the share of the view it has. */
+const editor = (): HTMLElement => source().querySelector('.cm-scroller') as HTMLElement
+/** What scrolls `leaf`'s content: the editor's box in the source view, and the view's own box in any other. */
+const scroller = (leaf: string): HTMLElement => (leaf === 'source' ? editor() : host(leaf))
 const notice = (): string => (document.querySelector('#notice .notice-text')?.textContent ?? '').trim()
 const idle = (): boolean => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
 /** How far `el` can scroll down: a box that cannot is at 0 whatever it was given. */
@@ -73,11 +82,17 @@ async function focusedOn(leaf: string, what: string): Promise<HTMLElement> {
   return first(leaf)
 }
 
-/** Scroll `leaf`'s own box to `top`, and assert it is there. */
+/** Scroll `leaf`'s scroller to `top`, and assert it is there. */
 async function scrolled(leaf: string, top: number): Promise<void> {
-  expect(range(host(leaf)), `precondition: the ${leaf} view’s own box scrolls past ${top}`).toBeGreaterThan(top)
-  host(leaf).scrollTop = top
-  await until(() => host(leaf).scrollTop === top, `the ${leaf} view to hold its scroll`)
+  expect(range(scroller(leaf)), `precondition: the ${leaf} view scrolls past ${top}`).toBeGreaterThan(top)
+  scroller(leaf).scrollTop = top
+  await until(() => scroller(leaf).scrollTop === top, `the ${leaf} view to hold its scroll`)
+}
+
+/** Whether all of `inner` shows in the source editor's box. */
+const inEditor = (inner: { top: number; bottom: number }): boolean => {
+  const box = editor().getBoundingClientRect()
+  return inner.top >= box.top - 0.5 && inner.bottom <= box.top + editor().clientHeight + 0.5
 }
 
 /** The prefix, then `key`. */
@@ -123,7 +138,7 @@ describe('the scroll of the view a gesture gives the focus to', () => {
       expect(mounted()).toEqual(['source'])
       const focused = await focusedOn('source', 'after the ✕')
       expect(focused.matches(':focus-visible'), 'a pointer press drew a focus ring').toBe(false)
-      expect(source().scrollTop, 'the ✕ on the TM view reset the source view’s own scroll box').toBe(120)
+      expect(editor().scrollTop, 'the ✕ on the TM view reset the source editor').toBe(120)
     })
 
     /** The same, with the view's `⋯` menu open when the `✕` is pressed: the press closes the menu and lands. */
@@ -137,17 +152,17 @@ describe('the scroll of the view a gesture gives the focus to', () => {
       expect(mounted()).toEqual(['source'])
       const focused = await focusedOn('source', 'after the ✕')
       expect(focused.matches(':focus-visible')).toBe(false)
-      expect(source().scrollTop).toBe(120)
+      expect(editor().scrollTop).toBe(120)
     })
 
     /**
      * THE KEY'S HALF, BY THE ROAD A KEYBOARD USER TAKES TO A `✕`: `Tab` from the view's `⋯`, then `Enter`. The focus
-     * is on the source view's `⋯` with its ring drawn, and it has to be in sight.
+     * is on the source view's first control with its ring drawn, and it has to be in sight.
      *
-     * **THE SOURCE VIEW IS AT ITS TOP AFTERWARDS, AND THAT IS THE RULE, NOT A LOSS IT MISSED**: its `⋯` is the first
-     * thing in its header, flush with the view's top, so there is one scroll position that shows it.
+     * **THE EDITOR STAYS WHERE IT WAS, SINCE THE CONTROL IS IN SIGHT ALREADY**: the source view's header does not
+     * scroll with its editor. The view at its top was the rule's outcome while the header did.
      */
-    it('gives way to the focused control when the ✕ is pressed with Enter', async () => {
+    it('shows the focused control and keeps the editor when the ✕ is pressed with Enter', async () => {
       await resetToFirstLoad()
       await scrolled('source', 120)
       ;(host('tm-0').querySelector('button.view-more') as HTMLElement).focus()
@@ -160,11 +175,38 @@ describe('the scroll of the view a gesture gives the focus to', () => {
       const focused = await focusedOn('source', 'after Enter on the ✕')
       expect(focused.matches(':focus-visible'), 'a key press drew no focus ring').toBe(true)
       expect(inSight(focused.getBoundingClientRect(), 'source'), 'the focused control is out of sight').toBe(true)
-      expect(source().scrollTop, 'the source view is not at its top, where its first control is').toBe(0)
+      expect(editor().scrollTop, 'a focus that was in sight already moved the source editor').toBe(120)
+    })
+
+    /**
+     * THE KEY'S HALF WHERE IT HAS TO MOVE A VIEW: in a window 420 px tall the TM view is taller than its tile, its
+     * own box scrolls, and its header scrolls with it. `Enter` on the source view's `✕` gives the TM view the focus,
+     * on its first control, which is in its header.
+     *
+     * **THE TM VIEW IS NEAR ITS TOP AFTERWARDS, AND THAT IS THE RULE, NOT A LOSS IT MISSED**: the control is in the
+     * view's header, 3 px under the view's top, so the view is scrolled by that and no more (measured 2026-10-12).
+     * What is held is that the control is in sight where it was not, and that the view moved up for it.
+     */
+    it('gives way to the focused control when the ✕ beside a view whose own box scrolls is pressed with Enter', async () => {
+      await resetToFirstLoad()
+      await page.viewport(1280, 420)
+      await until(() => range(host('tm-0')) > 60, 'a TM view taller than its tile')
+      await scrolled('tm-0', 60)
+      expect(
+        inSight(first('tm-0').getBoundingClientRect(), 'tm-0'),
+        'precondition: the TM view’s first control is out of sight at 60 px',
+      ).toBe(false)
+      ;(host('source').querySelector('button.view-close') as HTMLElement).focus()
+      await userEvent.keyboard('{Enter}')
+      expect(mounted()).toEqual(['tm-0'])
+      const focused = await focusedOn('tm-0', 'after Enter on the source view’s ✕')
+      expect(focused.matches(':focus-visible'), 'a key press drew no focus ring').toBe(true)
+      expect(inSight(focused.getBoundingClientRect(), 'tm-0'), 'the focused control is out of sight').toBe(true)
+      expect(host('tm-0').scrollTop, 'the TM view did not move up to its first control').toBeLessThan(10)
     })
 
     /** The key's half again, for a view key: `4` hides the TM view, which has the focus, and the source view takes it. */
-    it('gives way to the focused control when a view key hides the view that had the focus', async () => {
+    it('shows the focused control and keeps the editor when a view key hides the view that had the focus', async () => {
       await resetToFirstLoad()
       await userEvent.click(host('tm-0').querySelector('.state-table') as HTMLElement)
       expect(document.activeElement?.closest('[data-leaf]'), 'precondition: the focus is in the TM view').toBe(
@@ -176,7 +218,7 @@ describe('the scroll of the view a gesture gives the focus to', () => {
       const focused = await focusedOn('source', 'after the view key')
       expect(focused.matches(':focus-visible')).toBe(true)
       expect(inSight(focused.getBoundingClientRect(), 'source'), 'the focused control is out of sight').toBe(true)
-      expect(source().scrollTop).toBe(0)
+      expect(editor().scrollTop, 'a focus that was in sight already moved the source editor').toBe(120)
     })
 
     /**
@@ -189,39 +231,39 @@ describe('the scroll of the view a gesture gives the focus to', () => {
       await userEvent.click(toggle('tm'))
       expect(mounted()).toEqual(['source'])
       expect(document.activeElement, 'the toggle lost the focus when it hid the TM view').toBe(toggle('tm'))
-      expect(source().scrollTop, 'hiding the TM view reset the source view').toBe(120)
+      expect(editor().scrollTop, 'hiding the TM view reset the source view').toBe(120)
       await userEvent.click(toggle('tm'))
       expect(mounted()).toEqual(['source', 'tm-0'])
       expect(document.activeElement).toBe(toggle('tm'))
-      expect(source().scrollTop, 'showing the TM view reset the source view').toBe(120)
+      expect(editor().scrollTop, 'showing the TM view reset the source view').toBe(120)
     })
 
     /**
-     * **A VIEW KEY PRESSED FROM AN EDITOR GIVES THE FOCUS BACK TO IT, AND THE VIEW STAYS WHERE IT WAS WHILE THE CARET
-     * SHOWS.** The editor is taller than its view, so it is asked for its caret and not for its box: at 120 px a bare
-     * `focus()` put the view at 0, and at 0 `scrollIntoView` on the editor's box put it at 59, the editor's top
-     * brought to the view's.
+     * **A VIEW KEY PRESSED FROM AN EDITOR GIVES THE FOCUS BACK TO IT, AND THE EDITOR STAYS WHERE IT WAS WHILE THE CARET
+     * SHOWS.** It is asked for its caret and not for its box. While the source view's own box was what scrolled, the
+     * editor was taller than its view: at 120 px a bare `focus()` put the view at 0, and at 0 `scrollIntoView` on
+     * the editor's box put it at 59, the editor's top brought to the view's.
      */
     it('is kept when a view key is pressed from the source editor, at 120 px and at the top', async () => {
       await resetToFirstLoad()
       await scrolled('source', 120)
       await caretAt(300)
-      expect(source().scrollTop, 'precondition: the click in the editor left the view at 120').toBe(120)
+      expect(editor().scrollTop, 'precondition: the click in the editor left the view at 120').toBe(120)
       await viewKey('3')
       expect(mounted()).toEqual(['source', 'lambda-0', 'tm-0'])
       await frames()
       expect(view.hasFocus, 'the source editor lost the focus').toBe(true)
-      expect(source().scrollTop, 'a view key reset the view its editor was pressed in').toBe(120)
-      expect(inSight(caret(), 'source'), 'the caret is out of sight').toBe(true)
+      expect(editor().scrollTop, 'a view key reset the editor it was pressed in').toBe(120)
+      expect(inEditor(caret()), 'the caret is out of sight').toBe(true)
 
       await scrolled('source', 0)
       await caretAt(60)
-      expect(source().scrollTop, 'precondition: the click in the editor left the view at its top').toBe(0)
+      expect(editor().scrollTop, 'precondition: the click in the editor left the view at its top').toBe(0)
       await viewKey('3')
       expect(mounted()).toEqual(['source', 'tm-0'])
       await frames()
       expect(view.hasFocus).toBe(true)
-      expect(source().scrollTop, 'a view key moved a view at its top').toBe(0)
+      expect(editor().scrollTop, 'a view key moved a view at its top').toBe(0)
     })
 
     /**
@@ -241,7 +283,7 @@ describe('the scroll of the view a gesture gives the focus to', () => {
       const focused = await focusedOn('tm-0', 'after reset preset')
       expect(focused.matches(':focus-visible')).toBe(false)
       expect(host('tm-0').scrollTop, 'reset preset reset the TM view it gave the focus to').toBe(60)
-      expect(source().scrollTop, 'reset preset reset the source view').toBe(120)
+      expect(editor().scrollTop, 'reset preset reset the source view').toBe(120)
     })
 
     /**
@@ -263,8 +305,8 @@ describe('the scroll of the view a gesture gives the focus to', () => {
       await userEvent.click(document.querySelector('#notice button.notice-action') as HTMLElement)
       await until(() => notice() === 'put back the program and the workspace', 'the undo')
       expect(view.state.doc.toString()).toBe(PROGRAM)
-      expect(range(source()), 'precondition: the program put back could be scrolled as far').toBeGreaterThan(120)
-      expect(source().scrollTop, 'the program put back opened where the link’s was scrolled to').toBe(0)
+      expect(range(editor()), 'precondition: the program put back could be scrolled as far').toBeGreaterThan(120)
+      expect(editor().scrollTop, 'the program put back opened where the link’s was scrolled to').toBe(0)
       await frames()
       expect(view.hasFocus, 'the undo did not leave the focus in the source editor').toBe(true)
       await until(idle, 'the program put back to compile')
@@ -280,7 +322,7 @@ describe('the scroll of the view a gesture gives the focus to', () => {
       expect(drawn()).toBe('row[50](source column[50](lambda-0 tm-0))')
       const focused = await focusedOn('source', 'after the ✕')
       expect(focused.matches(':focus-visible')).toBe(false)
-      expect(source().scrollTop, 'the ✕ on the asm view reset the source view over it').toBe(120)
+      expect(editor().scrollTop, 'the ✕ on the asm view reset the source view over it').toBe(120)
     })
 
     /**
@@ -295,15 +337,15 @@ describe('the scroll of the view a gesture gives the focus to', () => {
       const tall = source().clientHeight
       await caretAt(tall - 80)
       const down = caret().top - source().getBoundingClientRect().top
-      const before = source().scrollTop
+      const before = editor().scrollTop
       await viewKey('2')
       expect(drawn()).toBe('row[50](column[50](source asm-0) column[50](lambda-0 tm-0))')
       await frames()
       expect(source().clientHeight, 'precondition: the source view was made shorter').toBeLessThan(tall - 100)
       expect(down, 'precondition: the caret was lower than the view is now tall').toBeGreaterThan(source().clientHeight)
       expect(view.hasFocus, 'the source editor lost the focus').toBe(true)
-      expect(inSight(caret(), 'source'), 'the caret is out of sight in the view the key made shorter').toBe(true)
-      expect(source().scrollTop, 'the view did not move').toBeGreaterThan(before)
+      expect(inEditor(caret()), 'the caret is out of sight in the view the key made shorter').toBe(true)
+      expect(editor().scrollTop, 'the view did not move').toBeGreaterThan(before)
     })
   })
 })
```

In `web/tests/browser/panel-maximise.test.ts`:

```diff
--- a/web/tests/browser/panel-maximise.test.ts
+++ b/web/tests/browser/panel-maximise.test.ts
@@ -2,9 +2,12 @@ import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
 import { page, userEvent } from 'vitest/browser'
 import type { AsmPanels } from '../../src/asm-pane'
 import { AsmPane } from '../../src/asm-pane'
+import { LambdaPane } from '../../src/lambda-pane'
 import type { PaneEvents } from '../../src/pane-chrome'
 import type { Shares } from '../../src/panel-stack'
+import type { LambdaState } from '../../src/types'
 import { FACT3, frameOf } from '../node/asm-fixtures'
+import { wireOf } from '../node/tree-fixture'
 
 /**
  * THE MAXIMISE BUTTON ON EACH PANEL — the view layouts spec §11.3, `panel-stack.ts` and `panel.ts`'s `drawOver`.
@@ -238,3 +241,105 @@ describe('a panel’s maximise button', () => {
     expect(pressed(host)).toEqual([])
   })
 })
+
+describe('a maximise in a view with a region that has no header', () => {
+  const frameState: LambdaState = {
+    text: 'x',
+    spans: new Uint8Array(),
+    cut: null,
+    step: 0,
+    redex_span: null,
+    owner: 'None',
+  }
+  const WIDE = `g ${Array.from({ length: 300 }, (_, i) => `(a${i} b${i})`).join(' ')}`
+
+  /**
+   * THE λ TERM HAS NOTHING TO BE DRAWN CLOSED AS, so it keeps its floor under a maximised term map and is not hidden:
+   * a view of a term that showed none of it would be a view of its map alone.
+   */
+  it('leaves the term its floor and gives the map the rest', async () => {
+    const host = document.createElement('section')
+    host.className = 'pane'
+    host.dataset.kind = 'lambda'
+    host.style.height = '700px'
+    host.style.width = '640px'
+    document.body.append(host)
+    const pane = new LambdaPane(host, events(), { map: true })
+    pane.render(frameState, CONTROLS)
+    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
+    await frame()
+    const term = host.querySelector('.term') as HTMLElement
+    const map = host.querySelector('.term-map') as HTMLCanvasElement
+    const floor = Number.parseFloat(getComputedStyle(term).minHeight)
+    expect(floor, 'precondition: the term has a floor').toBeGreaterThan(60)
+    expect(heightOf(term), 'precondition: the term is well over its floor').toBeGreaterThan(floor + 200)
+    expect(map.clientHeight, 'precondition: the map is the 120 px it is built at').toBe(120)
+
+    await userEvent.click(host.querySelector('[data-panel="map"] .panel-maximise') as HTMLElement)
+    await frame()
+    await frame()
+    expect(term.hidden, 'the term was hidden').toBe(false)
+    expect(heightOf(term), 'the term is not at its floor').toBeCloseTo(floor, 0)
+    expect(term.querySelectorAll('.term-rows > *').length, 'the term draws no rows').toBeGreaterThan(0)
+    expect(map.clientHeight, 'the map did not take the rest').toBeGreaterThan(400)
+    expect(map.height, 'the map was not drawn at the height it has').toBe(
+      Math.round(map.clientHeight * devicePixelRatio),
+    )
+    expect(host.scrollHeight).toBe(host.clientHeight)
+
+    await userEvent.click(host.querySelector('[data-panel="map"] .panel-maximise') as HTMLElement)
+    await frame()
+    await frame()
+    expect(map.clientHeight, 'the map is not back at the height it is built at').toBe(120)
+    expect(map.height).toBe(Math.round(120 * devicePixelRatio))
+  })
+
+  /**
+   * **A MAP A MAXIMISE HID IS DRAWN AGAIN WHEN IT IS SHOWN, WHATEVER ELSE MOVED**: the λ view watches the canvas's
+   * own box. The map draws nothing while its panel is drawn closed, and what usually draws it again is the term's
+   * change of size. In a view too short for its floors the term is at its floor before the maximise, under it and
+   * after it, and says nothing: held here on a view of a copy 260 px tall, whose text is what is maximised.
+   */
+  it('draws the map at the step the view is on when a maximise that hid it ends, with the term’s size unchanged', async () => {
+    const host = document.createElement('section')
+    host.className = 'pane'
+    host.dataset.kind = 'lambda'
+    host.style.height = '260px'
+    host.style.width = '640px'
+    document.body.append(host)
+    const pane = new LambdaPane(host, events({ editSink: () => vi.fn(), collapse: vi.fn() }), { map: true })
+    pane.render(frameState, CONTROLS)
+    const first = wireOf(WIDE)
+    pane.renderTree({ kind: 'tree', tree: first })
+    pane.setEditor('g a b')
+    await frame()
+    await frame()
+    const term = host.querySelector('.term') as HTMLElement
+    const map = host.querySelector('.term-map') as HTMLCanvasElement
+    const label = (n: number): string => `term map: ${n} nodes by depth`
+    expect(map.getAttribute('aria-label')).toBe(label(first.kind.length))
+    const floor = Number.parseFloat(getComputedStyle(term).minHeight)
+    expect(heightOf(term), 'precondition: the term is at its floor').toBeCloseTo(floor, 0)
+
+    const text = host.querySelector('[data-panel="text"] .panel-maximise') as HTMLElement
+    await userEvent.click(text)
+    await frame()
+    await frame()
+    expect(
+      host.querySelector('[data-panel="map"] .panel-toggle')?.getAttribute('aria-expanded'),
+      'precondition: the maximise drew the map closed',
+    ).toBe('false')
+    expect(heightOf(term), 'precondition: the term is at its floor under the maximise').toBeCloseTo(floor, 0)
+    const second = wireOf('g (a b) (c d)')
+    pane.renderTree({ kind: 'tree', tree: second })
+    expect(map.getAttribute('aria-label'), 'precondition: a hidden map is not drawn').toBe(label(first.kind.length))
+
+    await userEvent.click(text)
+    await frame()
+    await frame()
+    expect(heightOf(term), 'precondition: the term is at its floor after it').toBeCloseTo(floor, 0)
+    expect(map.getAttribute('aria-label'), 'the map shows the tree of a step the view has left').toBe(
+      label(second.kind.length),
+    )
+  })
+})
```

In `web/tests/browser/panel-regions.test.ts`:

```diff
--- a/web/tests/browser/panel-regions.test.ts
+++ b/web/tests/browser/panel-regions.test.ts
@@ -1,9 +1,13 @@
 import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
 import { page, userEvent } from 'vitest/browser'
+import { LambdaPane } from '../../src/lambda-pane'
 import type { PaneEvents } from '../../src/pane-chrome'
 import type { Shares } from '../../src/panel-stack'
+import { LAMBDA_TREE_NODES } from '../../src/protocol'
 import { TmPane } from '../../src/tm-pane'
-import type { TmProgram, TmState } from '../../src/types'
+import type { LambdaState, TmProgram, TmState } from '../../src/types'
+import { DEFAULT_DISPLAY } from '../../src/workspace'
+import { wireOf } from '../node/tree-fixture'
 
 /**
  * THE REGIONS THAT DO NOT START WITH A SHARE, AND THE ONE THAT TAKES THE REST — the view layouts spec §11.1.
@@ -179,3 +183,126 @@ describe('a copy’s text, in a TM view', () => {
     expect(Object.keys(sizes.mock.calls.at(-1)?.[0] as Shares)).toEqual(['diagram'])
   })
 })
+
+describe('the λ view’s term and its map', () => {
+  const STATE: LambdaState = { text: 'x', spans: new Uint8Array(), cut: null, step: 0, redex_span: null, owner: 'None' }
+  /** 4,999 arguments of three nodes, each joined by an application: one argument a line, under the cap by three. */
+  const BIG = `g ${Array.from({ length: 4_999 }, () => '(a b)').join(' ')}`
+
+  const mount = (height: number, mode: 'icicle' | 'minimap' = 'icicle') => {
+    const sizes = vi.fn<(s: Shares) => void>()
+    const host = hostOf('lambda', height)
+    const pane = new LambdaPane(host, events({ panelSizes: sizes }), {
+      display: { ...DEFAULT_DISPLAY, map: mode },
+      map: true,
+    })
+    pane.render(STATE, CONTROLS)
+    const wire = wireOf(BIG)
+    pane.renderTree({ kind: 'tree', tree: wire })
+    return { host, pane, sizes, nodes: wire.kind.length }
+  }
+  const term = (host: HTMLElement) => host.querySelector('.term') as HTMLElement
+  const canvas = (host: HTMLElement) => host.querySelector('.term-map') as HTMLCanvasElement
+
+  it('gives the term what the view has spare, past six tenths of the window', async () => {
+    const { host } = mount(950)
+    await frame()
+    expect(innerHeight, 'precondition: the window is 1,000 px tall').toBe(1000)
+    expect(heightOf(term(host)), 'the term is capped at six tenths of the window').toBeGreaterThan(
+      0.6 * innerHeight + 50,
+    )
+    // FROM UNDER THE VIEW'S HEADER TO THE BOUNDARY OVER ITS MAP, and the view does not scroll.
+    expect(term(host).getBoundingClientRect().bottom).toBeCloseTo(
+      boundary(host, 'term', 'map').getBoundingClientRect().top,
+      0,
+    )
+    expect(region(host, 'map').getBoundingClientRect().bottom).toBeCloseTo(host.getBoundingClientRect().bottom, 0)
+    expect(host.scrollHeight).toBe(host.clientHeight)
+  })
+
+  it('keeps the map at 120 px until its bar is dragged, and draws it at the height it has after', async () => {
+    const { host, sizes } = mount(700)
+    await frame()
+    const map = region(host, 'map')
+    expect(map.dataset.sized, 'a map nobody dragged has a share').toBeUndefined()
+    expect(canvas(host).clientHeight).toBe(120)
+    const was = { term: heightOf(term(host)), map: heightOf(map) }
+    await drag(host, map.querySelector('.panel-header') as HTMLElement, -100)
+    await frame()
+    expect(map.dataset.sized).toBe('true')
+    expect(heightOf(map), 'the map did not take 100 px').toBeCloseTo(was.map + 100, 0)
+    expect(heightOf(term(host)), 'the term did not give them').toBeCloseTo(was.term - 100, 0)
+    expect(canvas(host).clientHeight, 'the canvas does not fill the share its panel has').toBe(220)
+    expect(canvas(host).height, 'the map was not drawn again at the height it has').toBe(
+      Math.round(220 * devicePixelRatio),
+    )
+    expect(Object.keys(sizes.mock.calls.at(-1)?.[0] as Shares).sort()).toEqual(['map', 'term'])
+  })
+
+  /**
+   * **THE TERM'S ROWS ARE THE ONES IN ITS BOX, AT EVERY FRAME OF A DRAG** (spec §11.5's first point). The term draws
+   * the lines in view and a few past each edge, and a boundary dragged down gives it a taller box with nothing else
+   * to say so: `LambdaBody`'s own resize observer draws again before the frame is shown. On the largest term a view
+   * lays out, scrolled to its middle so there are rows to need past both edges, with this file's own pointer events:
+   * the driver's drag is one move, and the frames between a press and a release are what is held.
+   */
+  for (const mode of ['icicle', 'minimap'] as const) {
+    it(`keeps the term’s rows over its whole box at every frame of a drag, and the map drawn at its height (${mode})`, async () => {
+      const { host, nodes } = mount(700, mode)
+      expect(nodes, 'precondition: the term is three nodes under the most a view lays out').toBe(LAMBDA_TREE_NODES - 3)
+      await frame()
+      const box = term(host)
+      expect(box.scrollHeight, 'precondition: the term is far taller than its box').toBeGreaterThan(50_000)
+      box.scrollTop = 40_000
+      await frame()
+      await frame()
+      const b = boundary(host, 'term', 'map')
+      const at = b.getBoundingClientRect()
+      const [x, y0] = [at.left + at.width / 2, at.top + at.height / 2]
+      const fire = (type: string, y: number) =>
+        b.dispatchEvent(
+          new PointerEvent(type, { pointerId: 1, bubbles: true, clientX: x, clientY: y, isPrimary: true, button: 0 }),
+        )
+      /** How far the drawn rows fall short of the term's box, top and bottom: 0 where they cover it. */
+      const gap = (): { top: number; bottom: number } => {
+        const tb = box.getBoundingClientRect()
+        let [top, bottom] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
+        for (const r of box.querySelectorAll<HTMLElement>('.term-rows > *')) {
+          const rb = r.getBoundingClientRect()
+          top = Math.min(top, rb.top)
+          bottom = Math.max(bottom, rb.bottom)
+        }
+        return { top: Math.max(0, top - tb.top), bottom: Math.max(0, tb.bottom - bottom) }
+      }
+      expect(gap(), 'precondition: the rows cover the box before the drag').toEqual({ top: 0, bottom: 0 })
+
+      const heights = new Set<number>()
+      const worst = { top: 0, bottom: 0 }
+      let undrawn = 0
+      fire('pointerdown', y0)
+      // UP, SO THE TERM SHRINKS, THEN DOWN PAST WHERE IT BEGAN: growing is what needs rows the last frame lacked.
+      const path = [
+        ...Array.from({ length: 30 }, (_, i) => y0 - (i + 1) * 10),
+        ...Array.from({ length: 45 }, (_, i) => y0 - 300 + (i + 1) * 10),
+      ]
+      for (const y of path) {
+        fire('pointermove', y)
+        await frame()
+        await frame()
+        const g = gap()
+        worst.top = Math.max(worst.top, g.top)
+        worst.bottom = Math.max(worst.bottom, g.bottom)
+        heights.add(box.clientHeight)
+        const map = canvas(host)
+        if (map.height !== Math.round(map.clientHeight * devicePixelRatio)) undrawn += 1
+      }
+      fire('pointerup', path.at(-1) as number)
+      expect(heights.size, 'precondition: the drag gave the term many heights').toBeGreaterThan(30)
+      expect(Math.max(...heights) - Math.min(...heights), 'precondition: and they differ by hundreds').toBeGreaterThan(
+        300,
+      )
+      expect(worst, 'a frame showed the term’s box with rows missing').toEqual({ top: 0, bottom: 0 })
+      expect(undrawn, 'frames at which the map was not drawn at the height it had').toBe(0)
+    })
+  }
+})
```

Create `web/tests/browser/panel-sizes-restore-lambda.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defaultArrangement, LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { host, SHELL, until } from './harness'

/**
 * **A λ VIEW IS BUILT WITH THE SHARES ITS LEAF HOLDS** — the view layouts spec §11.4, `pane-host.ts`'s λ arm.
 * `panel-sizes-restore.test.ts` has the TM view and the source view; a λ view takes its shares through its options
 * and not as an argument of its own, and with that line gone nothing failed. Seeded before `main.ts` is imported:
 * the source beside a λ view, its map open, and the map given a share even with the term's where it is built 120 px
 * tall.
 *
 * **THE VIEW'S OWN HEIGHT SETTLES AS THE PAGE'S FONTS ARRIVE**: measured on this page (2026-10-13), 824 px at the
 * mount, 828 once they had loaded and 822 a frame later, the term and the map's panel moving together each time. The
 * map is drawn again at each, by a resize observer, which the browser delivers at its next frame. A reading taken
 * between a change and that frame found the canvas 360 px tall holding a drawing 363 tall, in one whole-suite run and
 * not in the file alone. So the case waits two frames before it reads the two.
 */

const heightOf = (el: Element): number => el.getBoundingClientRect().height
const lambda = (): HTMLElement => host('lambda-0') as HTMLElement

beforeAll(async () => {
  await page.viewport(1280, 896)
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({
      ...defaultWorkspace('wide'),
      tree: defaultArrangement(['source', 'lambda'], 'wide'),
      focused: 'lambda-0',
      panels: { 'lambda-0': { map: true } },
      panelSizes: { 'lambda-0': { term: 1, map: 1 } },
    }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
  await until(() => host('lambda-0')?.querySelector('.term-rows > *') != null, 'the λ view to draw')
})

const frames = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

describe('a workspace stored with a λ view’s shares', () => {
  it('opens the view with its map as tall as its term, as stored, and the map drawn at that height', async () => {
    await document.fonts.ready
    await frames()
    const term = lambda().querySelector('[data-region="term"]') as HTMLElement
    const map = lambda().querySelector('[data-region="map"]') as HTMLElement
    const canvas = lambda().querySelector('.term-map') as HTMLCanvasElement
    expect(map.dataset.sized, 'the map has its own height, as one nobody dragged').toBe('true')
    expect(heightOf(map)).toBeCloseTo(heightOf(term), 0)
    expect(
      canvas.clientHeight,
      'precondition: an even share is far more than the 120 px a map is built at',
    ).toBeGreaterThan(250)
    expect(canvas.height, 'the map was not drawn at the height it has').toBe(
      Math.round(canvas.clientHeight * devicePixelRatio),
    )
  })

  it('keeps them through the writes the load itself makes', () => {
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null').panelSizes).toEqual({
      'lambda-0': { term: 1, map: 1 },
    })
  })
})
```

In `web/tests/browser/panel-sizes-restore.test.ts`:

```diff
--- a/web/tests/browser/panel-sizes-restore.test.ts
+++ b/web/tests/browser/panel-sizes-restore.test.ts
@@ -50,6 +50,13 @@ describe('a workspace stored with shares', () => {
     ).toBe('33')
   })
 
+  it('opens the source view with its outline sharing the view evenly with the editor, as stored', () => {
+    const outline = region('source', 'outline')
+    expect(outline.dataset.sized, 'the outline has its own height, as one nobody dragged').toBe('true')
+    expect(heightOf(outline)).toBeCloseTo(heightOf(region('source', 'editor')), 0)
+    expect(heightOf(outline), 'precondition: an even share is far more than the outline lists').toBeGreaterThan(300)
+  })
+
   it('keeps them through the writes the load itself makes', () => {
     expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null').panelSizes).toEqual(SIZES)
   })
```

In `web/tests/browser/panel-sizes-stored.test.ts`:

```diff
--- a/web/tests/browser/panel-sizes-stored.test.ts
+++ b/web/tests/browser/panel-sizes-stored.test.ts
@@ -17,14 +17,20 @@ import { drawn, host, resetToFirstLoad, SHELL, until } from './harness'
 // BEFORE THE MOUNT, AT MODULE SCOPE: `main()` reads storage once, when it is imported below.
 localStorage.removeItem(LAYOUT_STORAGE_KEY)
 
+/** A program with a function to list for each of sixty lines, so the outline has more to list than a view shows. */
+const MANY = `${Array.from({ length: 60 }, (_, i) => `fn f${i}(n) { n }`).join('\n')}\nf0(1)\n`
 /** A program whose machine has more rows at the state diagram's program level than its panel shows. */
 const SUM =
   'fn sum_to(n) {\n    let mut acc = 0;\n    while n > 0 {\n        acc = acc + n;\n        n = n - 1;\n    }\n    acc\n}\nsum_to(5)\n'
+/** And one with a single function and sixty blank lines, so the editor scrolls and the outline is two rows. */
+const LONG = `fn only(n) { n }${'\n'.repeat(60)}only(1)\n`
+
 let view: EditorView
 
 type Stored = { panelSizes?: Record<string, Record<string, number>>; arrangements?: Record<string, unknown> }
 const stored = (): Stored => JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null')
 const tm = (): HTMLElement => host('tm-0') as HTMLElement
+const source = (): HTMLElement => host('source') as HTMLElement
 const region = (view: HTMLElement, name: string) => view.querySelector(`[data-region="${name}"]`) as HTMLElement
 const heightOf = (el: Element): number => el.getBoundingClientRect().height
 const toggle = (kind: string): HTMLButtonElement =>
@@ -139,6 +145,93 @@ describe('a view’s shares, in the stored workspace', () => {
     expect(heightOf(region(tm(), 'rules')) / heightOf(region(tm(), 'diagram'))).toBeCloseTo(2, 1)
   })
 
+  /**
+   * *RESET PRESET* REPLACES THE WORKSPACE WHOLE and does not go through `enterTree`, which is what drops a view's
+   * state at a `✕`: what it closes is dropped by `main.ts`'s `normaliseWorkspace`, at the write. Held on a λ view,
+   * which the default does without, with its map opened and its boundary dragged.
+   */
+  it('are dropped with a view reset preset closes, and the view its toggle builds next has none', async () => {
+    const lambda = (): HTMLElement => host('lambda-0') as HTMLElement
+    const openMap = async (): Promise<void> => {
+      await userEvent.click(lambda().querySelector('[data-panel="map"] .panel-toggle') as HTMLElement)
+      await frame()
+    }
+    await userEvent.click(toggle('lambda'))
+    await until(() => host('lambda-0')?.querySelector('.term-rows > *') != null, 'the λ view to draw')
+    await openMap()
+    const term = lambda().querySelector('.term') as HTMLElement
+    expect(heightOf(term), 'precondition: the term has 60 px to give over its floor').toBeGreaterThan(
+      Number.parseFloat(getComputedStyle(term).minHeight) + 80,
+    )
+    await drag(lambda(), lambda().querySelector('[data-panel="map"] > .panel-header') as HTMLElement, -60)
+    expect(Object.keys(stored().panelSizes?.['lambda-0'] ?? {}).sort(), 'precondition: the drag stored shares').toEqual(
+      ['map', 'term'],
+    )
+    await resetToFirstLoad()
+    expect(host('lambda-0'), 'precondition: the reset closed the λ view').toBeNull()
+    expect(stored().panelSizes, 'the shares of a view the reset closed are still stored').toBeUndefined()
+    await userEvent.click(toggle('lambda'))
+    await until(() => host('lambda-0')?.querySelector('.term-rows > *') != null, 'the new λ view to draw')
+    await openMap()
+    expect(region(lambda(), 'map').dataset.sized, 'the new view was given the closed one’s shares').toBeUndefined()
+    expect((lambda().querySelector('.term-map') as HTMLElement).clientHeight).toBe(120)
+  })
+
+  /**
+   * THE KEYS, IN THE THREE VIEWS THE APP BUILDS HERE (`panel-boundaries.test.ts` has them in an asm view): an arrow
+   * moves the focused boundary a fiftieth of what the open regions share, the two it parts and no more, and `Enter`
+   * puts both back.
+   */
+  it('follow a boundary moved with the keys in the TM, the λ and the source view, and Enter puts it back', async () => {
+    /** One leg: `key` on the boundary between `above` and `below`, which moves it up for `ArrowUp` and down otherwise. */
+    const leg = async (leaf: string, above: string, below: string, key: 'ArrowUp' | 'ArrowDown'): Promise<void> => {
+      const view = host(leaf) as HTMLElement
+      const boundary = view.querySelector(
+        `.panel-boundary[data-above="${above}"][data-below="${below}"]`,
+      ) as HTMLElement
+      expect(boundary, `precondition: ${leaf} draws a boundary between ${above} and ${below}`).not.toBeNull()
+      const was = { above: heightOf(region(view, above)), below: heightOf(region(view, below)) }
+      const step = (key === 'ArrowUp' ? -1 : 1) * 0.02 * (was.above + was.below)
+      boundary.focus()
+      await userEvent.keyboard(`{${key}}`)
+      await frame()
+      expect(
+        heightOf(region(view, above)) - was.above,
+        `${leaf}: an arrow did not move the boundary a step`,
+      ).toBeCloseTo(step, 0)
+      expect(
+        heightOf(region(view, below)) - was.below,
+        `${leaf}: the region below did not answer the one above`,
+      ).toBeCloseTo(-step, 0)
+      expect(Object.keys(stored().panelSizes?.[leaf] ?? {}).sort(), `${leaf}: the shares stored`).toEqual(
+        [above, below].sort(),
+      )
+      expect(document.activeElement, `${leaf}: the boundary lost the focus`).toBe(boundary)
+      await userEvent.keyboard('{Enter}')
+      await frame()
+      expect(heightOf(region(view, above)), `${leaf}: Enter did not put the upper region back`).toBeCloseTo(
+        was.above,
+        0,
+      )
+      expect(stored().panelSizes?.[leaf], `${leaf}: a view that holds no share has an entry`).toBeUndefined()
+    }
+    // THE TM VIEW WHILE IT IS AS TALL AS THE WINDOW ALLOWS: beside a λ view over it, its regions are at their floors.
+    await leg('tm-0', 'rules', 'diagram', 'ArrowUp')
+    await userEvent.click(toggle('lambda'))
+    await until(() => host('lambda-0')?.querySelector('.term-rows > *') != null, 'the λ view to draw')
+    await userEvent.click(
+      (host('lambda-0') as HTMLElement).querySelector('[data-panel="map"] .panel-toggle') as HTMLElement,
+    )
+    await frame()
+    await leg('lambda-0', 'term', 'map', 'ArrowUp')
+    // DOWN, IN THE SOURCE VIEW: its outline is as tall as the two rows it lists, a step over its floor of two lines.
+    const outlineToggle = source().querySelector('[data-panel="outline"] .panel-toggle') as HTMLElement
+    if (outlineToggle.getAttribute('aria-expanded') !== 'true') await userEvent.click(outlineToggle)
+    await frame()
+    await leg('source', 'outline', 'editor', 'ArrowDown')
+    await userEvent.click(outlineToggle)
+  })
+
   /**
    * **A PANEL A MAXIMISE DRAWS CLOSED WITHDRAWS WHAT IT OFFERED FOR A BODY NOBODY CAN SEE** (`panel.ts`'s `onDrawn`).
    * The state diagram's *follow current state* is offered while its rows do not follow, and only the TM view writes
@@ -187,3 +280,100 @@ describe('a view’s shares, in the stored workspace', () => {
     await userEvent.click(tm().querySelector('[data-panel="diagram"] .panel-maximise') as HTMLElement)
   })
 })
+
+describe('the source view’s two regions', () => {
+  const editorHost = (): HTMLElement => source().querySelector('#editor') as HTMLElement
+  const scroller = (): HTMLElement => source().querySelector('.cm-scroller') as HTMLElement
+  const outline = (): HTMLElement => source().querySelector('[data-panel="outline"]') as HTMLElement
+  const outlineToggle = (): HTMLElement => outline().querySelector('.panel-toggle') as HTMLElement
+  const rows = (): number => outline().querySelectorAll('.outline-row').length
+  const title = (): HTMLElement => source().querySelector('h2') as HTMLElement
+  const setOutline = async (open: boolean): Promise<void> => {
+    if ((outlineToggle().getAttribute('aria-expanded') === 'true') !== open) await userEvent.click(outlineToggle())
+    await frame()
+  }
+
+  beforeEach(async () => {
+    await page.viewport(1280, 896)
+    await resetToFirstLoad()
+    await setOutline(false)
+    // WHATEVER A CASE BEFORE DRAGGED: `Enter` on the boundary, where one is drawn, puts both regions back.
+    await setOutline(true)
+    const boundary = source().querySelector<HTMLElement>('.panel-boundary')
+    if (outline().dataset.sized !== undefined && boundary !== null) {
+      boundary.focus()
+      await userEvent.keyboard('{Enter}')
+    }
+    await setOutline(false)
+  })
+
+  it('scrolls a long program inside the editor’s own box, under a header that stays put', async () => {
+    await program(LONG)
+    expect(source().scrollHeight, 'the view’s own box scrolls').toBe(source().clientHeight)
+    expect(scroller().scrollHeight - scroller().clientHeight, 'precondition: the editor’s box scrolls').toBeGreaterThan(
+      300,
+    )
+    // THE EDITOR'S REGION RUNS FROM THE HEADER TO THE VIEW'S BOTTOM, and the editor fills it.
+    expect(editorHost().getBoundingClientRect().bottom).toBeCloseTo(source().getBoundingClientRect().bottom, 0)
+    expect(heightOf(scroller())).toBeCloseTo(heightOf(editorHost()), 0)
+    const top = title().getBoundingClientRect().top
+    scroller().scrollTop = 300
+    await until(() => scroller().scrollTop === 300, 'the editor to scroll')
+    expect(title().getBoundingClientRect().top, 'the view’s header scrolled with its program').toBe(top)
+    expect(source().scrollTop).toBe(0)
+  })
+
+  it('gives the outline its own height, up to four tenths of the view, until the boundary is dragged', async () => {
+    await program(LONG)
+    await setOutline(true)
+    await until(() => rows() > 0, 'the outline to list the program')
+    const few = heightOf(outline())
+    expect(outline().dataset.sized, 'an outline nobody dragged has a share').toBeUndefined()
+    expect(few, 'a short outline is as tall as what it lists').toBeLessThan(120)
+    expect(source().querySelector('.panel-boundary')?.getAttribute('aria-label')).toBe('resize outline and editor')
+
+    await program(MANY)
+    await until(() => rows() >= 60, 'the outline to list sixty functions')
+    await frame()
+    const cap = 0.4 * source().clientHeight
+    expect(heightOf(outline()), 'a long outline is not capped at four tenths of the view').toBeCloseTo(cap, 0)
+    const list = outline().querySelector('.outline') as HTMLElement
+    expect(list.scrollHeight, 'the outline’s list does not scroll inside the cap').toBeGreaterThan(list.clientHeight)
+    expect(source().scrollHeight, 'the view scrolls').toBe(source().clientHeight)
+  })
+
+  it('gives the outline a share at a drag of the boundary, which is the one handle over a region with no header', async () => {
+    await program(LONG)
+    await setOutline(true)
+    await until(() => rows() > 0, 'the outline to list the program')
+    const [was, editorWas] = [heightOf(outline()), heightOf(editorHost())]
+    const boundary = source().querySelector('.panel-boundary') as HTMLElement
+    expect(getComputedStyle(boundary).cursor).toBe('grab')
+    await drag(source(), boundary, 100)
+    expect(heightOf(outline()), 'the outline did not take 100 px').toBeCloseTo(was + 100, 0)
+    expect(heightOf(editorHost()), 'the editor did not give them').toBeCloseTo(editorWas - 100, 0)
+    expect(outline().dataset.sized).toBe('true')
+    expect(Object.keys(stored().panelSizes?.source ?? {}).sort()).toEqual(['editor', 'outline'])
+    expect(source().scrollHeight).toBe(source().clientHeight)
+  })
+
+  it('leaves the editor its floor under a maximised outline, and puts both back after', async () => {
+    await program(LONG)
+    await setOutline(true)
+    await until(() => rows() > 0, 'the outline to list the program')
+    const [was, editorWas] = [heightOf(outline()), heightOf(editorHost())]
+    const floor = Number.parseFloat(getComputedStyle(editorHost()).minHeight)
+    expect(floor, 'precondition: the editor has a floor').toBeGreaterThan(60)
+    const button = outline().querySelector('.panel-maximise') as HTMLElement
+    await userEvent.click(button)
+    await frame()
+    expect(editorHost().hidden).toBe(false)
+    expect(heightOf(editorHost()), 'the editor is not at its floor').toBeCloseTo(floor, 0)
+    expect(heightOf(outline()), 'the outline did not take the rest').toBeGreaterThan(was + 300)
+    expect(source().querySelector('.panel-boundary'), 'a boundary is drawn under a maximised panel').toBeNull()
+    await userEvent.click(button)
+    await frame()
+    expect(heightOf(outline())).toBeCloseTo(was, 0)
+    expect(heightOf(editorHost())).toBeCloseTo(editorWas, 0)
+  })
+})
```

In `web/tests/browser/scroll-kept.test.ts`:

```diff
--- a/web/tests/browser/scroll-kept.test.ts
+++ b/web/tests/browser/scroll-kept.test.ts
@@ -15,10 +15,13 @@ import { focusInPage, resetToFourViews, SHELL, until } from './harness'
  * rebuild and puts it back after.
  *
  * **THREE SCROLLERS ARE HELD TO IT, EACH ONE OF A KIND**: the TM view's rule table, a box inside a view, with the
- * active row its keys move; the source view's host, which is the view's own scroll box and the only thing that
- * scrolls a long program; and the source editor sideways, the one position here that is a `scrollLeft`. The program
- * is `let x = 40; x + 2` with blank lines to make it longer than its view and trailing spaces to make it wider, so
- * every leg is what it is without them.
+ * active row its keys move; the TM view's host, which is the view's own scroll box, scrolled where the view's tile
+ * is shorter than the floors of what it shows; and the source editor, down and sideways, the one box here that holds
+ * a `scrollLeft`. The program is `let x = 40; x + 2` with blank lines to make it longer than its view and trailing
+ * spaces to make it wider, so every leg is what it is without them.
+ *
+ * **THE SOURCE VIEW'S HOST WAS THE SECOND OF THEM** until its editor took a share of the view and scrolled inside it
+ * (the view layouts spec §11.1): a long program no longer scrolls the view, and its header stays where it is.
  *
  * **EVERY CASE PUTS THE THREE WHERE IT STARTS FROM, AND ASSERTS THEY ARE THERE** (`arm`): a case that inherited them
  * from the one before would pass on a page where nothing had been scrolled at all.
@@ -40,7 +43,7 @@ const LINKED = `let y = 10;${'\n'.repeat(60)}y + 5${' '.repeat(400)}`
 const host = (leaf: string): HTMLElement | null =>
   document.querySelector<HTMLElement>(`#views [data-leaf="${leaf}"]:not([role="tab"])`)
 const table = (): HTMLElement => host('tm-0')?.querySelector('.state-table') as HTMLElement
-const source = (): HTMLElement => host('source') as HTMLElement
+const tm = (): HTMLElement => host('tm-0') as HTMLElement
 const editor = (): HTMLElement => host('source')?.querySelector('.cm-scroller') as HTMLElement
 const tab = (leaf: string): HTMLElement =>
   document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`) as HTMLElement
@@ -86,27 +89,45 @@ const armTable = async (): Promise<void> => {
   expect(table().scrollTop, 'precondition: the keys did not scroll the table').toBe(120)
 }
 const armSource = async (): Promise<void> => {
-  source().scrollTop = 120
+  editor().scrollTop = 120
   editor().scrollLeft = 300
-  await until(() => source().scrollTop === 120 && editor().scrollLeft === 300, 'the source view to hold its scroll')
+  await until(() => editor().scrollTop === 120 && editor().scrollLeft === 300, 'the source editor to hold its scroll')
+}
+/** The TM view's own box, where its tile is shorter than the view: a case in tiles alone, since a Stage's is not. */
+const armHost = async (): Promise<void> => {
+  expect(range(tm()), 'precondition: the TM view’s own box scrolls').toBeGreaterThan(40)
+  tm().scrollTop = 40
+  await until(() => tm().scrollTop === 40, 'the TM view to hold its scroll')
 }
-/** Put the three scrollers where a case starts from. */
+/** Put the table and the editor where a case starts from. */
 const arm = async (): Promise<void> => {
   await armTable()
   await armSource()
 }
+/** And the TM view's own box before them, for a case that stays in tiles. */
+const armTiles = async (): Promise<void> => {
+  await armHost()
+  await arm()
+}
 const heldTable = (gesture: string): void => {
   expect(table().scrollTop, `${gesture} reset the TM view’s rule table`).toBe(120)
   expect(activeRow(), `${gesture} moved the rule table’s active row`).toBe(7)
 }
+const heldHost = (gesture: string): void => {
+  expect(tm().scrollTop, `${gesture} reset the TM view’s own scroll box`).toBe(40)
+}
 const heldSource = (gesture: string): void => {
-  expect(source().scrollTop, `${gesture} reset the source view’s own scroll box`).toBe(120)
+  expect(editor().scrollTop, `${gesture} reset the source editor`).toBe(120)
   expect(editor().scrollLeft, `${gesture} reset the source editor sideways`).toBe(300)
 }
 const held = (gesture: string): void => {
   heldTable(gesture)
   heldSource(gesture)
 }
+const heldTiles = (gesture: string): void => {
+  heldHost(gesture)
+  held(gesture)
+}
 
 describe('a view’s scroll position, across a rebuild made by another view', () => {
   let view: EditorView
@@ -132,28 +153,30 @@ describe('a view’s scroll position, across a rebuild made by another view', ()
     await resetToFourViews()
     await until(() => host('tm-0')?.querySelector('.state-table .state-row') != null, 'the rule table to draw')
     expect(range(table()), 'precondition: the rule table scrolls').toBeGreaterThan(200)
-    expect(range(source()), 'precondition: the source view’s own box scrolls').toBeGreaterThan(200)
+    expect(range(editor()), 'precondition: the source editor scrolls').toBeGreaterThan(200)
     expect(editor().scrollWidth - editor().clientWidth, 'precondition: the editor scrolls sideways').toBeGreaterThan(
       400,
     )
   })
 
   it('is kept when another view is closed', async () => {
-    await arm()
+    await armTiles()
     await userEvent.click(host('asm-0')?.querySelector('button.view-close') as HTMLElement)
     expect(host('asm-0'), 'the asm view is still on the page').toBeNull()
-    held('closing the asm view')
+    heldTiles('closing the asm view')
   })
 
   it('is kept when a view is added', async () => {
-    await arm()
+    await armTiles()
     const before = document.querySelectorAll('#views [data-leaf]').length
     await userEvent.click(document.querySelector('#new-view') as HTMLElement)
     await userEvent.click(document.querySelector('#new-view-menu button') as HTMLElement)
     expect(document.querySelectorAll('#views [data-leaf]').length, '+ view added nothing').toBe(before + 1)
-    held('adding a view')
+    heldTiles('adding a view')
   })
 
+  // THE TABLE AND THE EDITOR ALONE: the Debugger preset draws the views narrower and shorter, and the TM view's own
+  // box then has 34 px to scroll where it had more than 40, so a position it held would be clamped, not kept.
   it('is kept when the preset changes how the views are drawn, and when it changes back', async () => {
     await arm()
     await pick('[data-preset="debugger"]')
@@ -254,11 +277,11 @@ describe('a view’s scroll position, across a rebuild made by another view', ()
         () => document.querySelector('#notice .notice-text')?.textContent === 'opened a shared link',
         'the link to open',
       )
-      expect(range(source()), 'precondition: the link’s program could be scrolled as far').toBeGreaterThan(200)
+      expect(range(editor()), 'precondition: the link’s program could be scrolled as far').toBeGreaterThan(200)
       expect(editor().scrollWidth - editor().clientWidth, 'precondition: and as far sideways').toBeGreaterThan(400)
       // ONE ASSERTION ON BOTH, so a failure shows each and neither hides behind the other.
       expect(
-        { down: source().scrollTop, sideways: editor().scrollLeft },
+        { down: editor().scrollTop, sideways: editor().scrollLeft },
         'the link’s program opened where the one before it was scrolled to',
       ).toEqual({ down: 0, sideways: 0 })
     })
```

- [ ] **Step 2: Run them, and see them fail**

```bash
pnpm exec vitest run --project browser tests/browser/panel-boundaries.test.ts tests/browser/panel-maximise.test.ts tests/browser/panel-regions.test.ts tests/browser/panel-sizes-stored.test.ts tests/browser/panel-sizes-restore.test.ts tests/browser/panel-sizes-restore-lambda.test.ts tests/browser/focus-scroll.test.ts tests/browser/scroll-kept.test.ts tests/browser/divider-drag-focus.test.ts
```

On the replay, with this task's tests written and its source not: `t4-fail.log`: files: 8 failed | 1 passed (9); tests: 36 failed | 45 passed (81).

```
tests/browser/divider-drag-focus.test.ts > a divider dragged with the pointer, on the source beside the TM view > does not scroll the view to a caret that is out of sight
tests/browser/divider-drag-focus.test.ts > a divider dragged with the pointer, on the source beside the TM view > leaves the caret in the editor it was in, and a key typed next lands at it
tests/browser/divider-drag-focus.test.ts > a divider dragged with the pointer, on the source beside the TM view > leaves the caret where it was when the focus is given back in a slow frame
tests/browser/divider-drag-focus.test.ts > a divider dragged with the pointer, on the source beside the TM view > leaves the focus on a divider dragged while it has it
tests/browser/divider-drag-focus.test.ts > a divider dragged with the pointer, on the source beside the TM view > leaves the focus on what had it in the other view
tests/browser/focus-scroll.test.ts > the scroll of the view a gesture gives the focus to > on all four views, in the wide default > follows the caret when a view key halves the view its editor is in
tests/browser/focus-scroll.test.ts > the scroll of the view a gesture gives the focus to > on all four views, in the wide default > is kept by the source view when the asm view under it is closed with the pointer
tests/browser/focus-scroll.test.ts > the scroll of the view a gesture gives the focus to > on the first load’s two views > is kept by the TM view when reset preset is pressed with the pointer
tests/browser/focus-scroll.test.ts > the scroll of the view a gesture gives the focus to > on the first load’s two views > is kept when a toggle is pressed with the pointer, which keeps the focus
tests/browser/focus-scroll.test.ts > the scroll of the view a gesture gives the focus to > on the first load’s two views > is kept when a view key is pressed from the source editor, at 120 px and at the top
tests/browser/focus-scroll.test.ts > the scroll of the view a gesture gives the focus to > on the first load’s two views > is kept when the TM view’s ✕ is pressed with the pointer, and no ring is drawn
tests/browser/focus-scroll.test.ts > the scroll of the view a gesture gives the focus to > on the first load’s two views > is kept when the ✕ is pressed with the view’s ⋯ menu open
… and 24 more
```

- [ ] **Step 3: Write the source**

In `web/src/lambda-pane.ts`:

```diff
--- a/web/src/lambda-pane.ts
+++ b/web/src/lambda-pane.ts
@@ -10,6 +10,7 @@ import type { Dir } from './layout'
 import type { LambdaLinkState } from './link-status'
 import { type PaneChoice, type PaneEvents, type SplitChoices, textPanel } from './pane-chrome'
 import { createPanel, type Panel } from './panel'
+import { PanelStack, type Shares } from './panel-stack'
 import type { LambdaTreeWire, Leg } from './protocol'
 import type { ScratchEditorConfig } from './scratch-editor'
 import { ScratchEditor } from './scratch-editor'
@@ -193,7 +194,7 @@ export class LambdaPane implements EditablePane {
   constructor(
     host: HTMLElement,
     on: PaneEvents,
-    opts: { readonly display?: LambdaDisplay; readonly map?: boolean } = {},
+    opts: { readonly display?: LambdaDisplay; readonly map?: boolean; readonly sizes?: Shares } = {},
   ) {
     this.#display = opts.display ?? DEFAULT_DISPLAY
     this.#onDisplay = on.display
@@ -220,6 +221,18 @@ export class LambdaPane implements EditablePane {
         this.#drawMap()
       },
     })
+    // THE MAP IS DRAWN FOR THE HEIGHT ITS CANVAS HAS, AND THAT HEIGHT IS NO LONGER THE STYLESHEET'S 120px ALONE (the
+    // view layouts spec §11.1): the map has a share of its view once its boundary is dragged, and takes the view's
+    // spare height while it is maximised. The term's own change of size draws it again (`scrolled`, above), which
+    // covers a drag and a view that changes height. It does not cover a canvas that changes with the term as it was:
+    // a maximise of another panel hides the canvas and shows it again, and in a view too short for its floors the
+    // term is at its floor before, under and after. So the canvas's own box is watched. A draw that changes nothing
+    // is skipped by `term-map.ts`'s `TermMap.draw`, so the frame of a drag that the term also reports costs one draw.
+    // **NOT FOR A CANVAS WITH NO HEIGHT**, which is one that has left the page or been hidden: there is nothing to
+    // draw it for, and `lambda-body.ts`'s own observer holds the same line for the term.
+    new ResizeObserver(() => {
+      if (this.#map.el.clientHeight > 0) this.#drawMap()
+    }).observe(this.#map.el)
     this.#mapMode = radioGroup(
       {
         label: 'map mode',
@@ -319,6 +332,33 @@ export class LambdaPane implements EditablePane {
     this.#collapse = textPanel(this.#editorHost, (collapsed) => on.collapse?.(collapsed))
     this.#header.steps.append(this.#steps.el)
     host.replaceChildren(this.#header.el, this.#collapse.el, this.#body.el, this.#mapPanel.el)
+    // THE REGIONS THAT SHARE THE VIEW'S HEIGHT (the view layouts spec §11.1), top to bottom. The term takes what the
+    // view has spare; a copy's text and the term map keep their own heights until a boundary beside one is dragged.
+    // The term has no header: it is a region no maximise draws closed, and it keeps its floor under one.
+    // IT KEEPS ITSELF: its listeners are on the regions and their headers, and nothing here reads it again.
+    new PanelStack(
+      [
+        {
+          name: 'text',
+          label: 'text',
+          el: this.#collapse.el,
+          share: null,
+          panels: [this.#collapse.panel],
+          bodies: () => [this.#collapse.panel.body],
+        },
+        { name: 'term', label: 'term', el: this.#body.el, share: 1, panels: [], bodies: () => [this.#body.el] },
+        {
+          name: 'map',
+          label: 'term map',
+          el: this.#mapPanel.el,
+          share: null,
+          panels: [this.#mapPanel],
+          bodies: () => [mapHost],
+        },
+      ],
+      opts.sizes ?? {},
+      (next) => on.panelSizes?.(next),
+    )
 
     // λ -> SOURCE, the third direction: a click on any token links from the construct its node belongs to
     // (`LambdaBody`'s `link` event, `#linkFrom`), at whatever step is on screen (Plan 7 part 4a).
```

In `web/src/main.ts`:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -87,7 +87,7 @@ import { paletteDeclarations } from './palettes'
 import type { PaneChoice } from './pane-chrome'
 import { type AddRefused, createPaneHost, type LayoutEvent } from './pane-host'
 import { createPanel } from './panel'
-import type { Shares } from './panel-stack'
+import { PanelStack, type Shares } from './panel-stack'
 import { type LeafId, legOfPane, PaneCollection, type PaneKind } from './panes'
 import { PROGRAM_STORAGE_KEY, parseProgram, type StoredProgram, serializeProgram } from './program-store'
 import type { Leg, RunReply } from './protocol'
@@ -2205,6 +2205,7 @@ async function main(): Promise<EditorView> {
     applySwitches()
     inspectorPanel.setOpen(ws.inspector)
     sourceOutline.panel.setOpen(ws.panels[SOURCE_LEAF]?.outline ?? false)
+    sourceRegions.setSizes(ws.panelSizes[SOURCE_LEAF] ?? {})
     paneHost.rebuildViews(focusedLeaf())
     refreshBuffers()
   }
@@ -2977,6 +2978,27 @@ async function main(): Promise<EditorView> {
   // it is built here — after `ws`, `persistWorkspace` and `view` all exist — rather than where
   // the rest of the source view is assembled.
   sourceHost.insertBefore(sourceOutline.panel.el, editorHost)
+  // THE SOURCE VIEW'S TWO REGIONS (the view layouts spec §11.1): the outline over the editor. The editor takes what
+  // the view has spare and scrolls inside it; the outline keeps its own height, what it lists up to a cap, until the
+  // boundary between the two is dragged. The editor has no header, so a maximised outline leaves it its floor.
+  const sourceRegions = new PanelStack(
+    [
+      {
+        name: 'outline',
+        label: 'outline',
+        el: sourceOutline.panel.el,
+        share: null,
+        panels: [sourceOutline.panel],
+        bodies: () => [sourceOutline.panel.body],
+      },
+      { name: 'editor', label: 'editor', el: editorHost, share: 1, panels: [], bodies: () => [editorHost] },
+    ],
+    ws.panelSizes[SOURCE_LEAF] ?? {},
+    (sizes) => {
+      ws = { ...ws, panelSizes: withPanelSizes(ws.panelSizes, SOURCE_LEAF, sizes) }
+      persistWorkspace()
+    },
+  )
 
   // **BUILT AFTER `view`, AND THE FACTORY IS WHERE THE FAILURE POLICY LIVES** — the reason
   // `SessionPool` takes one too: a notice needs the app's DOM, and this module is the one that
```

In `web/src/pane-host.ts`:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1377,6 +1377,29 @@ export function createPaneHost(deps: {
       }
     }
   }
+  /**
+   * Tell the editors of the views built in this rebuild that they are at their start.
+   *
+   * **AN EDITOR REMEMBERS WHERE IT WAS SCROLLED TO, AND PUTS ITSELF BACK THERE WHEN IT IS FOCUSED AT 0**
+   * (`@codemirror/view` 6.43.8, `observers.focus`: "When focusing reset the scroll position, move it back to where it
+   * was"). It learns its position from the `scroll` events of its own scroll box. For a view that is kept that is
+   * harmless, since `giveScrollBack` writes the position it remembers. For one that starts at its top it is not,
+   * where a focus reaches the editor before any event has told it of its new position: the source editor is one
+   * editor for the page's life, it scrolls a long program inside its own box since it took a share of its view (the
+   * view layouts spec §11.1), and a link's *undo* builds every view again and focuses it in the same task.
+   *
+   * Measured before this existed (2026-10-12), with a program of 61 lines under an opened link and the editor at
+   * 120 px: the *undo* left it at 120, under a program that had never been scrolled, its `focus` having found it at 0
+   * with 120 remembered. With this, 0. An opened link was not seen to do the same: the editor remembered 0 by the time
+   * the link's notice was up, and a press in it then moved nothing. `tests/browser/focus-scroll.test.ts` has the
+   * undo. The event is what the editor listens for, so it is the one way to tell it that needs none of its internals.
+   */
+  const startEditorsAtTop = (fresh: ReadonlySet<HTMLElement>): void => {
+    for (const host of fresh) {
+      if (!host.isConnected) continue
+      for (const box of host.querySelectorAll('.cm-scroller')) box.dispatchEvent(new Event('scroll'))
+    }
+  }
 
   /**
    * The leaves of the tree `applyLayout` last put on the page — what tells a view that has come back from a remembered
@@ -1638,6 +1661,7 @@ export function createPaneHost(deps: {
           const pane = new LambdaPane(host, paneEvents(l.id, slot), {
             display: displayOf(l.id) ?? DEFAULT_DISPLAY,
             ...(map === undefined ? {} : { map }),
+            sizes: panelSizesOf(l.id) ?? {},
           })
           // **A NEW λ PANE IS SEEDED FROM ITS SESSION FOR THE IDENTICAL REASON THE TM ARM BELOW IS**,
           // and this line is the λ half of a repair that shipped with only its TM half. `scratch-compiled`
@@ -1823,6 +1847,7 @@ export function createPaneHost(deps: {
         })
       }
       giveScrollBack()
+      startEditorsAtTop(fresh)
       applied()
       persist()
       // **WHICH VIEW SHOWS WHICH COPY IS STORED WITH THE TREE IT IS TRUE OF.** The stored bindings are read off `panes`
```

In `web/src/style.css`:

```diff
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -2808,3 +2808,81 @@ main {
 .panel-boundary + .asm-machine {
   margin-block-start: 0;
 }
+
+/* THE SOURCE VIEW IS A COLUMN OF TWO REGIONS (the view layouts spec §11.1): the outline over the editor. The editor
+   takes what the view has spare and scrolls inside it, where the view scrolled it and its header away; the outline
+   keeps its own height, what it lists up to four tenths of the view, until the boundary between the two is dragged,
+   and has the share `panel-stack.ts` writes from then on. Each keeps a floor of five lines, and under both the view
+   scrolls. */
+.pane[data-kind="source"] {
+  display: flex;
+  flex-direction: column;
+}
+.pane[data-kind="source"] > * {
+  flex: none;
+}
+.pane[data-kind="source"] > #editor {
+  display: flex;
+  flex-direction: column;
+  flex: var(--share, 1) 1 0;
+  min-height: 5lh;
+}
+.pane[data-kind="source"] > #editor > .cm-editor {
+  flex: 1 1 0;
+  min-height: 0;
+}
+.pane[data-kind="source"] > .panel[data-panel="outline"][data-open="true"] {
+  display: flex;
+  flex-direction: column;
+  flex: 0 1 auto;
+  max-height: 40%;
+}
+.pane[data-kind="source"] > .panel[data-panel="outline"][data-open="true"][data-sized] {
+  flex: var(--share, 1) 1 0;
+  max-height: none;
+}
+.pane[data-kind="source"] > .panel[data-panel="outline"][data-open="true"] > .outline {
+  flex: 1 1 auto;
+  min-height: 0;
+  max-height: none;
+}
+/* TWO LINES, NOT FIVE: the floor is met the moment a drag gives the outline a share, and an outline of two rows
+   that jumped to five as its boundary was pressed would move the boundary out from under the pointer. */
+.pane[data-kind="source"] > .panel[data-panel="outline"][data-open="true"][data-sized] > .outline {
+  flex: 1 1 0;
+  min-height: 2lh;
+}
+
+/* IN A λ VIEW THE TERM TAKES WHAT THE VIEW HAS SPARE (the view layouts spec §11.1), where it was capped at `60vh` of
+   the window whatever the view's own height. The view is a flex column, as the TM and asm views are, and everything
+   in it but the regions `panel-stack.ts` gives a share keeps its own height. Below the floors the view scrolls. */
+.pane[data-kind="lambda"] {
+  display: flex;
+  flex-direction: column;
+}
+.pane[data-kind="lambda"] > * {
+  flex: none;
+}
+.pane[data-kind="lambda"] > .term {
+  flex: var(--share, 1) 1 0;
+  max-height: none;
+}
+.pane[data-kind="lambda"] > .panel[data-panel="text"][data-open="true"][data-sized]:not([hidden]),
+.pane[data-kind="lambda"] > .panel[data-panel="map"][data-open="true"][data-sized] {
+  display: flex;
+  flex-direction: column;
+  flex: var(--share, 1) 1 0;
+}
+/* THE TERM MAP KEEPS ITS 120px UNTIL ITS BOUNDARY IS DRAGGED, and from then on its canvas fills the share its panel
+   has, down to half of that. `term-map.ts` reads the canvas's height when it draws. */
+.panel[data-panel="map"][data-sized] > .term-map-host {
+  display: flex;
+  flex-direction: column;
+  flex: 1 1 0;
+  min-height: 60px;
+}
+.panel[data-panel="map"][data-sized] > .term-map-host > .term-map {
+  flex: 1 1 0;
+  min-height: 0;
+  height: auto;
+}
```

- [ ] **Step 4: Run them, and see them pass**

```bash
pnpm exec vitest run --project browser tests/browser/panel-boundaries.test.ts tests/browser/panel-maximise.test.ts tests/browser/panel-regions.test.ts tests/browser/panel-sizes-stored.test.ts tests/browser/panel-sizes-restore.test.ts tests/browser/panel-sizes-restore-lambda.test.ts tests/browser/focus-scroll.test.ts tests/browser/scroll-kept.test.ts tests/browser/divider-drag-focus.test.ts
```

On the replay (`t4-pass.log`): files: 9 passed (9); tests: 81 passed (81).

- [ ] **Step 5: Break it on purpose, once a sabotage, and put it back**

Each entry is the replay's own record. Its `sab.py` saved the file, made the edit, ran
`pnpm exec vitest run --project <project> <files>` on the files named, copied the saved file back and compared
the two byte for byte.

**S4a** `main.ts`: `normaliseWorkspace` keeps the shares of a view no tree holds. Run: `tests/browser/panel-sizes-stored.test.ts` (`sab-S4a.log`): 2 failed | 10 passed (12). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1442,7 +1442,7 @@
     const panels = Object.fromEntries(Object.entries(ws.panels).filter(([leaf]) => live.has(leaf)))
     const display = Object.fromEntries(Object.entries(ws.display).filter(([leaf]) => live.has(leaf)))
     const tmDisplay = Object.fromEntries(Object.entries(ws.tmDisplay).filter(([leaf]) => live.has(leaf)))
-    const panelSizes = Object.fromEntries(Object.entries(ws.panelSizes).filter(([leaf]) => live.has(leaf)))
+    const panelSizes = ws.panelSizes
     ws = { ...ws, focused: focusedLeaf(), panels, panelSizes, display, tmDisplay }
   }
 
```

What failed:

```
a view’s shares, in the stored workspace > are dropped with a view reset preset closes, and the view its toggle builds next has none
a view’s shares, in the stored workspace > follow a boundary moved with the keys in the TM, the λ and the source view, and Enter puts it back
```

**S4b** `main.ts`: the source view is built without the shares its leaf holds. Run: `tests/browser/panel-sizes-restore.test.ts` (`sab-S4b.log`): 1 failed | 2 passed (3). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -2993,7 +2993,7 @@
       },
       { name: 'editor', label: 'editor', el: editorHost, share: 1, panels: [], bodies: () => [editorHost] },
     ],
-    ws.panelSizes[SOURCE_LEAF] ?? {},
+    {},
     (sizes) => {
       ws = { ...ws, panelSizes: withPanelSizes(ws.panelSizes, SOURCE_LEAF, sizes) }
       persistWorkspace()
```

What failed:

```
a workspace stored with shares > opens the source view with its outline sharing the view evenly with the editor, as stored
```

**S4c** `pane-host.ts`: the editors of a view built again are not told they are at their start. Run: `tests/browser/focus-scroll.test.ts` (`sab-S4c.log`): 1 failed | 10 passed (11). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1847,7 +1847,6 @@
         })
       }
       giveScrollBack()
-      startEditorsAtTop(fresh)
       applied()
       persist()
       // **WHICH VIEW SHOWS WHICH COPY IS STORED WITH THE TREE IT IS TRUE OF.** The stored bindings are read off `panes`
```

What failed:

```
the scroll of the view a gesture gives the focus to > on the first load’s two views > is not kept by an opened link’s undo, which builds every view again
```

**S4d** `style.css`: the source outline has no cap of four tenths of its view. Run: `tests/browser/panel-sizes-stored.test.ts` (`sab-S4d.log`): 1 failed | 11 passed (12). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -2835,7 +2835,6 @@
   display: flex;
   flex-direction: column;
   flex: 0 1 auto;
-  max-height: 40%;
 }
 .pane[data-kind="source"] > .panel[data-panel="outline"][data-open="true"][data-sized] {
   flex: var(--share, 1) 1 0;
```

What failed:

```
the source view’s two regions > gives the outline its own height, up to four tenths of the view, until the boundary is dragged
```

**S4e** `style.css`: the λ term keeps its cap of `60vh`. Run: `tests/browser/panel-regions.test.ts` (`sab-S4e.log`): 1 failed | 6 passed (7). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -2865,7 +2865,6 @@
 }
 .pane[data-kind="lambda"] > .term {
   flex: var(--share, 1) 1 0;
-  max-height: none;
 }
 .pane[data-kind="lambda"] > .panel[data-panel="text"][data-open="true"][data-sized]:not([hidden]),
 .pane[data-kind="lambda"] > .panel[data-panel="map"][data-open="true"][data-sized] {
```

What failed:

```
the λ view’s term and its map > gives the term what the view has spare, past six tenths of the window
```

**S4f** `panel-stack.ts`: a region with no header keeps its share under a maximise. Run: `tests/browser/panel-maximise.test.ts`, `tests/browser/panel-sizes-stored.test.ts` (`sab-S4f.log`): 2 failed | 22 passed (24). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -133,7 +133,7 @@
         max === null
           ? this.#share(r)
           : r.panels.length === 0
-            ? 0
+            ? this.#share(r)
             : r.panels.includes(max)
               ? (this.#share(r) ?? 1)
               : this.#share(r)
```

What failed:

```
a maximise in a view with a region that has no header > leaves the term its floor and gives the map the rest
the source view’s two regions > leaves the editor its floor under a maximised outline, and puts both back after
```

**S4g** `panel-stack.ts`: a maximised panel that kept its own height takes no share. Run: `tests/browser/panel-maximise.test.ts` (`sab-S4g.log`): 1 failed | 11 passed (12). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -135,7 +135,7 @@
           : r.panels.length === 0
             ? 0
             : r.panels.includes(max)
-              ? (this.#share(r) ?? 1)
+              ? this.#share(r)
               : this.#share(r)
       this.#write(r, share)
     }
```

What failed:

```
a maximise in a view with a region that has no header > leaves the term its floor and gives the map the rest
```

**S4h** `style.css`: the source editor is as tall as its text, not as its share. Run: `tests/browser/panel-sizes-stored.test.ts` (`sab-S4h.log`): 3 failed | 9 passed (12). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -2828,8 +2828,7 @@
   min-height: 5lh;
 }
 .pane[data-kind="source"] > #editor > .cm-editor {
-  flex: 1 1 0;
-  min-height: 0;
+  flex: none;
 }
 .pane[data-kind="source"] > .panel[data-panel="outline"][data-open="true"] {
   display: flex;
```

What failed:

```
the source view’s two regions > gives the outline a share at a drag of the boundary, which is the one handle over a region with no header
the source view’s two regions > gives the outline its own height, up to four tenths of the view, until the boundary is dragged
the source view’s two regions > scrolls a long program inside the editor’s own box, under a header that stays put
```

**S4i** `pane-host.ts`: a λ view is built without the shares its leaf holds. Run: `tests/browser/panel-sizes-restore-lambda.test.ts` (`sab-S4i.log`): 1 failed | 1 passed (2). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1661,7 +1661,6 @@
           const pane = new LambdaPane(host, paneEvents(l.id, slot), {
             display: displayOf(l.id) ?? DEFAULT_DISPLAY,
             ...(map === undefined ? {} : { map }),
-            sizes: panelSizesOf(l.id) ?? {},
           })
           // **A NEW λ PANE IS SEEDED FROM ITS SESSION FOR THE IDENTICAL REASON THE TM ARM BELOW IS**,
           // and this line is the λ half of a repair that shipped with only its TM half. `scratch-compiled`
```

What failed:

```
a workspace stored with a λ view’s shares > opens the view with its map as tall as its term, as stored, and the map drawn at that height
```

**S4j** `lambda-pane.ts`: the term map does not watch its own canvas. Run: `tests/browser/panel-maximise.test.ts`, `tests/browser/panel-sizes-restore-lambda.test.ts` (`sab-S4j.log`): 1 failed | 13 passed (14). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/lambda-pane.ts
+++ b/web/src/lambda-pane.ts
@@ -230,9 +230,6 @@
     // is skipped by `term-map.ts`'s `TermMap.draw`, so the frame of a drag that the term also reports costs one draw.
     // **NOT FOR A CANVAS WITH NO HEIGHT**, which is one that has left the page or been hidden: there is nothing to
     // draw it for, and `lambda-body.ts`'s own observer holds the same line for the term.
-    new ResizeObserver(() => {
-      if (this.#map.el.clientHeight > 0) this.#drawMap()
-    }).observe(this.#map.el)
     this.#mapMode = radioGroup(
       {
         label: 'map mode',
```

What failed:

```
a maximise in a view with a region that has no header > draws the map at the step the view is on when a maximise that hid it ends, with the term’s size unchanged
```

**S4k** `panel-stack.ts`: boundaries are drawn while a panel is maximised. Run: `tests/browser/panel-sizes-stored.test.ts` (`sab-S4k.log`): 1 failed | 11 passed (12). Restored, `cmp` equal.

The edit:

```diff
--- a/web/src/panel-stack.ts
+++ b/web/src/panel-stack.ts
@@ -140,7 +140,7 @@
       this.#write(r, share)
     }
     const want = new Map<string, [StackRegion, StackRegion]>()
-    if (this.#max === null) {
+    if (this.#max === null || true) {
       for (let i = 0; i + 1 < open.length; i++) {
         const a = open[i] as StackRegion
         const b = open[i + 1] as StackRegion
```

What failed:

```
the source view’s two regions > leaves the editor its floor under a maximised outline, and puts both back after
```

- [ ] **Step 6: The whole suite**

`pnpm exec biome ci --error-on-warnings`, `pnpm exec tsc --noEmit -p .`, `pnpm exec vitest run --project node` and
`pnpm exec vitest run --project browser`, all from `web/`. On the replay, after this task:

`biome ci` exit 0, typecheck exit 0. Node (`t4-suite-node.log`): 70 passed (70) files, 1406 passed (1406) tests. Browser (`t4-suite-browser.log`): 210 passed (210) files, 1488 passed (1488) tests, with the machine's load average at 4.50 before the run and 7.53 after it.

- [ ] **Step 7: Commit**

```bash
git add web/src/lambda-pane.ts \
  web/src/main.ts \
  web/src/pane-host.ts \
  web/src/style.css \
  web/tests/browser/divider-drag-focus.test.ts \
  web/tests/browser/focus-scroll.test.ts \
  web/tests/browser/panel-maximise.test.ts \
  web/tests/browser/panel-regions.test.ts \
  web/tests/browser/panel-sizes-restore-lambda.test.ts \
  web/tests/browser/panel-sizes-restore.test.ts \
  web/tests/browser/panel-sizes-stored.test.ts \
  web/tests/browser/scroll-kept.test.ts
git commit -F - <<'EOF'
The λ view and the source view share their height as the TM and asm views do, and their regions can be resized: the term takes its view's spare height, and the source editor scrolls inside its own under a header that stays put

The λ term was capped at six tenths of the window whatever its view's height, and takes what its view has spare. The
term map keeps its 120 px until the boundary over it is dragged, and has a share from then on; its canvas is drawn
again when the term changes size and when its own box does.

The source view is a column of two regions, the outline over the editor. The editor takes the view's spare height
and scrolls a long program inside its own box, where the view's box scrolled it and the view's header away. The
outline keeps its own height, up to four tenths of the view where the cap was `40vh`, until its boundary is dragged.
Neither the term nor the editor has a header, so the boundary itself is the handle over each, and under a maximised
panel each keeps its floor.

Twenty-two cases in three files held the source view's own box to its scroll, and hold the editor's now. A key's
focus on the source view's first control is in sight wherever the editor is scrolled to and moves nothing; the half
of that rule that moves a view is held by a TM view in a window 420 px tall.

CodeMirror puts its own scroll position back when it is focused at 0, and a link's undo builds every view again and
focuses the source editor in the same task: the editor at 120 px under the link's program stayed at 120 under the one
put back. `pane-host.ts` tells the editors of a view built again that they are at their start.
EOF
```

### Task 5: Verify the branch, measure a drag, build the image, write the roadmap entry

No source changes. Every figure this task writes down names the command that produced it, and is taken on the branch
as it stands after Task 4, not copied from this plan.

**Files:**

- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Every gate CI runs for these paths**

From `web/`: `pnpm exec biome ci --error-on-warnings`, `pnpm run typecheck`, `pnpm run test:coverage` (both projects
and the coverage floor), `pnpm run build:app`. From the root: each of `scripts/check-text-bytes.sh`,
`check-citations.sh`, `check-attributions.sh`, `check-doc-figures.sh`, `check-shared-docs.sh`, `check-colours.sh`,
`check-grammar-wasm.sh`, `check-lua.sh` and `check-licences.sh`, with `--self-test` and then alone. Every one passes.
A failure in a file this branch did not touch is checked against `main`, and against the machine's load, before it is
called a flake.

- [ ] **Step 2: Measure a drag**

Create `web/tests/browser/zz-probe-panel-drag.test.ts`. It is a probe: run it, write its figures down, and delete it.
It is not committed. It is `panel-regions.test.ts`'s last two cases with a clock: a λ view 640 × 700 on a term of
19,997 nodes, the term at 40,000 px, the boundary between the term and its map moved 10 px a frame, 30 frames up and
45 down, in each map mode.

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import { TermMap } from '../../src/term-map'
import type { LambdaState } from '../../src/types'
import { DEFAULT_DISPLAY } from '../../src/workspace'
import { wireOf } from '../node/tree-fixture'

/**
 * PROBE, NOT A TEST TO KEEP AS IT IS (the view layouts spec §11.5): what a drag of the boundary between the λ term
 * and its map does to the term's rows and what each frame of it costs, on a term just under `LAMBDA_TREE_NODES`.
 */
const host = (): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane probe-fixture'
  el.dataset.kind = 'lambda'
  el.style.width = '640px'
  el.style.height = '700px'
  document.body.append(el)
  return el
}

const events = (over: Partial<PaneEvents> = {}): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  toNewest: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
  ...over,
})

const frame: LambdaState = { text: 'x', spans: new Uint8Array(), cut: null, step: 0, redex_span: null, owner: 'None' }
const CONTROLS = {
  canRestart: true,
  canBack: false,
  canForward: true,
  canToNewest: true,
  canPlay: true,
  playing: false,
  stepText: '0',
  continueLabel: null,
}

/** 4,999 arguments of three nodes, each joined by an application: 19,997 nodes, one argument a line. */
const BIG = `g ${Array.from({ length: 4_999 }, () => '(a b)').join(' ')}`

/** One frame's work on the main thread: from its animation callbacks to the first task after it is drawn. */
const frameWork = (): Promise<number> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      const started = performance.now()
      const ch = new MessageChannel()
      ch.port1.onmessage = () => resolve(performance.now() - started)
      ch.port2.postMessage(null)
    })
  })

const stats = (xs: number[]): string => {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => (s[Math.min(s.length - 1, Math.floor(q * s.length))] as number).toFixed(2)
  return `n=${s.length} min=${at(0)} median=${at(0.5)} p90=${at(0.9)} max=${at(1)}`
}

afterEach(() => {
  for (const el of document.querySelectorAll('.probe-fixture')) el.remove()
})

describe('PROBE: a drag of the term | term map boundary on a 19,997-node term', () => {
  for (const mode of ['icicle', 'minimap'] as const) {
    it(`keeps the term's rows over its whole box at every frame, and costs what it prints (${mode})`, async () => {
      const el = host()
      const sizes = vi.fn()
      const pane = new LambdaPane(el, events({ panelSizes: sizes }), {
        display: { ...DEFAULT_DISPLAY, map: mode },
        map: true,
      })
      pane.render(frame, CONTROLS)
      const wire = wireOf(BIG)
      pane.renderTree({ kind: 'tree', tree: wire })
      const term = el.querySelector<HTMLElement>('.term') as HTMLElement
      const canvas = el.querySelector<HTMLCanvasElement>('.term-map') as HTMLCanvasElement
      await frameWork()
      console.error(`[probe ${mode}] label: ${canvas.getAttribute('aria-label')}; term ${term.clientHeight}px of ${term.scrollHeight}; map ${canvas.clientHeight}px`)
      expect(term.scrollHeight, 'precondition: the term is far taller than its box').toBeGreaterThan(50_000)
      // MID-TERM, so there are rows to draw past both edges.
      term.scrollTop = 40_000
      await frameWork()
      await frameWork()

      const boundary = el.querySelector<HTMLElement>('.panel-boundary') as HTMLElement
      expect(boundary, 'precondition: a boundary between the term and its map').not.toBeNull()
      expect(boundary.getAttribute('aria-label')).toBe('resize term and term map')
      const box = boundary.getBoundingClientRect()
      const x = box.left + box.width / 2
      const y0 = box.top + box.height / 2
      const fire = (type: string, y: number) =>
        boundary.dispatchEvent(
          new PointerEvent(type, { pointerId: 1, bubbles: true, clientX: x, clientY: y, isPrimary: true, button: 0 }),
        )

      /** How far the drawn rows fall short of the term's box, top and bottom, in pixels: 0 when they cover it. */
      const gap = (): { top: number; bottom: number; rows: number } => {
        const tb = term.getBoundingClientRect()
        const rows = [...term.querySelectorAll<HTMLElement>('.term-rows > *')]
        let top = Number.POSITIVE_INFINITY
        let bottom = Number.NEGATIVE_INFINITY
        for (const r of rows) {
          const b = r.getBoundingClientRect()
          top = Math.min(top, b.top)
          bottom = Math.max(bottom, b.bottom)
        }
        return { top: Math.max(0, top - tb.top), bottom: Math.max(0, tb.bottom - bottom), rows: rows.length }
      }
      expect(gap(), 'precondition: the rows cover the box before the drag').toMatchObject({ top: 0, bottom: 0 })

      const draw = vi.spyOn(TermMap.prototype, 'draw')
      const drawMs: number[] = []
      const original = draw.getMockImplementation()
      void original
      draw.mockRestore()
      const real = TermMap.prototype.draw
      let clears = 0
      let skipped = 0
      const clear = CanvasRenderingContext2D.prototype.clearRect
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        clears += 1
        return clear.apply(this, args)
      }
      const timed = vi.spyOn(TermMap.prototype, 'draw').mockImplementation(function (this: TermMap, state) {
        const before = clears
        const t = performance.now()
        real.call(this, state)
        const took = performance.now() - t
        // A DRAW THAT CHANGES NOTHING RETURNS BEFORE IT CLEARS THE CANVAS, and is not a draw to time.
        if (clears > before) drawMs.push(took)
        else skipped += 1
      })

      try {
        const work: number[] = []
        const worst = { top: 0, bottom: 0 }
        const heights = new Set<number>()
        fire('pointerdown', y0)
        // UP FIRST: the term shrinks and the map grows. Then down past where it began: the term grows, which is the
        // direction that needs rows the last frame did not draw.
        const path = [
          ...Array.from({ length: 30 }, (_, i) => y0 - (i + 1) * 10),
          ...Array.from({ length: 45 }, (_, i) => y0 - 300 + (i + 1) * 10),
        ]
        for (const y of path) {
          fire('pointermove', y)
          work.push(await frameWork())
          const g = gap()
          worst.top = Math.max(worst.top, g.top)
          worst.bottom = Math.max(worst.bottom, g.bottom)
          heights.add(term.clientHeight)
        }
        fire('pointerup', path.at(-1) as number)
        await frameWork()
        console.error(`[probe ${mode}] frames: ${path.length}; distinct term heights: ${heights.size} (${Math.min(...heights)}..${Math.max(...heights)}px)`)
        console.error(`[probe ${mode}] frame work ms: ${stats(work)}`)
        console.error(`[probe ${mode}] map draws: ${drawMs.length}, and ${skipped} calls that drew nothing; draw ms: ${drawMs.length > 0 ? stats(drawMs) : 'none'}`)
        console.error(`[probe ${mode}] frames that moved the term: ${work.filter((_, i) => i >= 0).length} timed, ${heights.size} distinct heights`)
        console.error(`[probe ${mode}] worst gap px: top ${worst.top} bottom ${worst.bottom}; canvas now ${canvas.clientHeight}px css, ${canvas.height} bitmap`)
        console.error(`[probe ${mode}] stored: ${JSON.stringify(sizes.mock.calls.at(-1)?.[0])}`)
        expect(heights.size, 'precondition: the drag changed the height of the term at many frames').toBeGreaterThan(30)
        expect(worst, 'the rows cover the box at every frame').toEqual({ top: 0, bottom: 0 })
        expect(canvas.height, 'the canvas was drawn at the height it has').toBe(
          Math.round(canvas.clientHeight * devicePixelRatio),
        )
      } finally {
        CanvasRenderingContext2D.prototype.clearRect = clear
        timed.mockRestore()
      }
    })
  }
})
```

It prints on `console.error` because `console.log` does not reach the vitest log. Run it at full speed and at a
quarter of a core, from `web/`, with nothing else running a browser:

```bash
pnpm exec vitest run --project browser tests/browser/zz-probe-panel-drag.test.ts 2>&1 | grep probe
systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 -p CPUQuota=25% \
  pnpm exec vitest run --project browser tests/browser/zz-probe-panel-drag.test.ts 2>&1 | grep probe
rm tests/browser/zz-probe-panel-drag.test.ts
```

On the replay's last tree, one run each on 2026-10-13, with the machine's load average at 3. The term had 37
different heights in the 75 frames, from 207 to 567 px, and sat on a floor for the rest; the map was drawn at 66 of
them, and 68 more calls of its `draw` found nothing changed and drew nothing. The term's rows covered its box at
every frame of all four runs.

| | the icicle map's draw | a frame's work, icicle | the minimap's draw | a frame's work, minimap |
|---|---|---|---|---|
| full speed | 2.2 to 4.0 ms, median 2.7 | up to 11.3 ms, median 7.8 | 0.4 to 1.4 ms, median 0.7 | up to 4.2 ms, median 2.3 |
| a quarter of a core | 2.3 to 88.8 ms, median 2.8 | up to 176.7 ms, median 8.5 | 0.4 to 88.9 ms, median 0.7 | up to 91.7 ms, median 2.2 |

Expect figures of that size, and write down the ones this run gives. **A frame that sat on a floor does no work**,
and reads as 0, so a frame's least is not a figure. **Time a draw only where it drew**: `TermMap.draw` is called
twice a frame, by the term's change of size and by the canvas's own, and the second returns before it clears the
canvas; the probe counts a call as a draw where `clearRect` ran.

- [ ] **Step 3: Build the image and look at it**

From the root, `docker build --build-arg COMMIT_HASH="$(git rev-parse HEAD)" -t redextape-panel-resizing .`, run it
on a spare port, and wait for it to be healthy. Then, in a browser and not by `curl`, in each of the three presets,
light and dark:

- Drag the header of *state diagram* in the TM view, of *heap* in the asm view and of *term map* in the λ view, and the
  strip between the source view's outline and its editor. The pointer is an open hand over each and a closed one
  while it is held, and nothing is drawn for a boundary.
- `Tab` to a boundary: a line is drawn across the view. `↑` and `↓` move it, `Enter` puts it back.
- Press a panel's maximise button, and press it again; press it and open another panel.
- Reload: the dragged sizes are back, and no panel is maximised.

`docker` never runs on a pull request, so this is the one time the image is seen before the merge.

- [ ] **Step 4: Write the roadmap entry**

Append to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, in the shape of the entry before it: the heading
with the date, the branch, the range of commits and their count; what changed; the decisions, the user's in his words
and the design's own named as such (the spec's §18.1 and §18.2); the tests, with the sabotage counts; what this did not
close; and VERIFICATION, ending with the block **"Every count this entry quotes, with what produces it"**. Run every
one of that block's commands before committing the entry. Close the range: no placeholder for a SHA or a date.

What this did not close, to carry into the entry as found on the branch:

- WebKit is unmeasured, as before. A finger's drag of a boundary was made with the tests' own pointer events and on no
  phone.
- Above the λ term and the source editor there is no header, so the 8 px strip is the one handle and the pointer's
  shape the one sign of it.
- The row of registers and call stack takes the lesser of its two bodies' room as its own, so wrapped one under the
  other its drag stops short of its floor.
- Closing the source view drops its stored panel state and shares and leaves its page's own (the outline open, the
  boundary where it was dragged) for the view its toggle brings back. It did so for the outline's open state before.
- The TM view rebuilds every tape row at each step (`tm-pane.ts`'s `render`), so a tape's sideways scroll goes back to
  0 and its scroll bar is drawn again: the user's note of 2026-10-12, measured on this branch and not changed by it.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit
```

The message's subject is the entry's heading, without its parenthesis.
