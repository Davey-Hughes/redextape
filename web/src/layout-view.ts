import type { Dir, LayoutNode } from './layout'
import { MIN_PANE_FRACTION } from './layout'
import type { LeafId } from './panes'

/**
 * How far one arrow-key press moves a divider, as a fraction of its split.
 *
 * EXPORTED, because it is part of what a keyboard resize means, not an implementation detail — a test
 * asserting the keyboard path's delta has to know the number to assert it against, and hard-coding
 * `0.02` a second time in the test would let the two drift apart silently the next time this one
 * changes.
 */
export const KEY_STEP = 0.02

/**
 * THE TREE, AS DOM — nested flex containers with a divider between every pair of siblings.
 *
 * FLEX RATHER THAN GRID, and the reason is the divider. A grid would need its track list rewritten on
 * every resize and the dividers placed in tracks of their own, so a two-pane split would be a
 * three-track grid whose middle track is not a pane. Flex lets a divider be a sibling with a fixed
 * basis and each pane a `flex-grow` equal to its fraction, which is one number per pane and no
 * bookkeeping about which track is which.
 *
 * HOSTS ARE MOVED, NEVER REBUILT. `renderLayout` appends the caller's existing elements, so a re-render
 * relocates a live pane — CodeMirror instance, scroll position and all — rather than replacing it.
 * That is what makes design §4.3's detach-not-destroy rule hold for free at this layer: nothing here
 * ever calls `remove()` on a host or creates one.
 *
 * DIVIDERS ARE KEYBOARD-OPERABLE, WHICH IS A DELIBERATE EXCEPTION TO PLAN 5's DEFERRED ACCESSIBILITY
 * PASS (design §6.2). A drag-only divider does not merely fail to announce itself — it makes the
 * entire layout unreachable without a pointer, which is a different class of gap from the
 * colour-carried states on that list.
 */

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

export function renderLayout(
  root: HTMLElement,
  tree: LayoutNode,
  hosts: Map<LeafId, HTMLElement>,
  handlers: ResizeHandlers,
): void {
  // THE DIVIDER A KEYBOARD USER IS FOCUSED ON DOES NOT SURVIVE `replaceChildren()` — UNLIKE A HOST, IT
  // IS REBUILT FROM SCRATCH EVERY CALL. A RESIZE FRAME NO LONGER REBUILDS ANYTHING — `syncSizes` writes
  // the new fractions onto the elements that are already there, precisely so the FRAMES of a gesture do
  // not destroy the control performing them. WHAT STILL REBUILDS IS EVERY GESTURE'S COMMIT, AND THAT
  // INCLUDES AN ORDINARY RESIZE, NOT ONLY A STRUCTURAL CHANGE. `handlers.commit` (`pane-host.ts`'s
  // `applyLayout`) calls `renderLayout` unconditionally from its `finally` block on every call it makes —
  // a drag's `pointerup`, a keyboard gesture's `keyup`/`blur`, a split, a close, `reset layout`, a
  // restore all reach it the same way — so a resize still rebuilds the whole tree once, at the moment the
  // gesture ends; it merely does so once per GESTURE now instead of once per FRAME. This rescue is what
  // keeps a keyboard user's place across every one of those rebuilds, resize's own commit included, and
  // it used to be what kept the arrow keys working at all — without it the FIRST arrow-key press moved
  // the divider, destroyed the element focus was sitting on, and dropped focus to `<body>`, so the second
  // press did nothing. A single FRAME no longer has that failure mode, but the `keyup` COMMIT still does:
  // the divider the user was holding down is destroyed and rebuilt exactly like a structural change would
  // destroy it, and this rescue is what a `keyup` finds waiting to restore focus onto its replacement. A
  // divider that answers exactly one keystroke defeats design §6.2's keyboard-operability requirement as
  // thoroughly as never wiring the handler, so this is not polish: it is what makes the keyboard path keep
  // working past its first gesture. `path`/`index` (stamped onto every divider as `data-` attributes in
  // `divider()` below) are what "the same divider" means across a rebuild, since the element itself never
  // is.
  const focused = root.contains(document.activeElement) ? document.activeElement : null
  const identity =
    focused instanceof HTMLElement && focused.classList.contains('layout-divider')
      ? { path: focused.dataset.path, index: focused.dataset.index }
      : null

  // Detach children without destroying them — `replaceChildren()` with no arguments removes every
  // child, and the hosts we are about to re-append are held by the caller's map, so nothing is lost.
  root.replaceChildren()
  root.append(build(tree, [], hosts, handlers))

  if (identity !== null) {
    const restored = [...root.querySelectorAll<HTMLElement>('.layout-divider')].find(
      (d) => d.dataset.path === identity.path && d.dataset.index === identity.index,
    )
    restored?.focus()
  }
}

function build(
  node: LayoutNode,
  path: number[],
  hosts: Map<LeafId, HTMLElement>,
  handlers: ResizeHandlers,
): HTMLElement {
  if (node.kind === 'leaf') {
    const host = hosts.get(node.id)
    if (host === undefined) throw new Error(`layout names a leaf with no host: ${node.id}`)
    host.style.flex = '1 1 0'
    host.style.minWidth = '0'
    host.style.minHeight = '0'
    return host
  }

  const box = document.createElement('div')
  box.className = 'layout-split'
  box.dataset.dir = node.dir
  box.style.display = 'flex'
  box.style.flexDirection = node.dir === 'row' ? 'row' : 'column'
  box.style.flex = '1 1 0'
  box.style.minWidth = '0'
  box.style.minHeight = '0'

  node.children.forEach((child, i) => {
    const el = build(child, [...path, i], hosts, handlers)
    el.style.flex = `${node.sizes[i] ?? 1 / node.children.length} 1 0`
    box.append(el)
    if (i < node.children.length - 1) {
      box.append(divider(box, node.dir, path, i, node.sizes[i] ?? 0, handlers))
    }
  })

  return box
}

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
      const dividerEl = el.children[i * CHILD_STRIDE + 1]
      if (!(dividerEl instanceof HTMLElement) || !dividerEl.classList.contains('layout-divider')) {
        throw new Error(`syncSizes: no divider after child ${i} of a ${count}-way split`)
      }
      dividerEl.setAttribute('aria-valuenow', String(Math.round((node.sizes[i] ?? 0) * 100)))
    }

    syncNode(child, childEl)
  })
}

/**
 * One divider: a real focusable `separator` that reports a FRACTION, never pixels.
 *
 * THE PIXEL-TO-FRACTION CONVERSION IS THE ONLY PIXEL IN THE LAYOUT, and it lives here rather than in
 * `layout.ts` so that model stays node-testable. The denominator is the split box's measured extent
 * along its own axis, read at pointerdown rather than cached, because a window resize between renders
 * would otherwise scale every drag by a stale number.
 */
function divider(
  box: HTMLElement,
  dir: Dir,
  path: number[],
  index: number,
  size: number,
  handlers: ResizeHandlers,
): HTMLElement {
  const el = document.createElement('div')
  el.className = 'layout-divider'
  // The identity `renderLayout` reads back after a rebuild to decide which fresh divider (if any) is
  // "the same" one that had focus before. A DOM node has no identity of its own across a
  // `replaceChildren()`, so `path`/`index` — the one thing that already addresses this divider inside
  // `resize` — are stamped here as the only durable name for it.
  el.dataset.path = JSON.stringify(path)
  el.dataset.index = String(index)
  el.setAttribute('role', 'separator')
  // A `row` split stacks its children horizontally, so the divider between them is a VERTICAL line —
  // and `aria-orientation` on a separator names the separator's own orientation, not the flow's.
  el.setAttribute('aria-orientation', dir === 'row' ? 'vertical' : 'horizontal')
  el.setAttribute('aria-valuenow', String(Math.round(size * 100)))
  el.setAttribute('aria-valuemin', String(Math.round(MIN_PANE_FRACTION * 100)))
  el.setAttribute('aria-valuemax', String(Math.round((1 - MIN_PANE_FRACTION) * 100)))
  el.setAttribute('aria-label', dir === 'row' ? 'resize panes left and right' : 'resize panes up and down')
  el.tabIndex = 0

  const extent = () => (dir === 'row' ? box.getBoundingClientRect().width : box.getBoundingClientRect().height)

  let dragging = false
  let moved = false
  let last = 0

  el.addEventListener('pointerdown', (e) => {
    dragging = true
    moved = false
    last = dir === 'row' ? e.clientX : e.clientY
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
    const now = dir === 'row' ? e.clientX : e.clientY
    const span = extent()
    // `now !== last` — A ZERO-DISPLACEMENT MOVE DOES NOT ARM THE COMMIT. Browsers do emit `pointermove`
    // at an unchanged coordinate, and without this guard such an event would call `handlers.resize` with
    // delta 0, set `moved`, and make `pointerup` run a full reconcile-and-write for a gesture that
    // changed nothing — exactly the no-op `stop` below says it avoids.
    if (span > 0 && now !== last) {
      // `moved` IS SET BEFORE `handlers.resize` RUNS, NOT AFTER. `handlers.resize` (in practice,
      // `pane-host.ts`'s frame handler) advances the tree before it calls `syncSizes`, which has throw
      // paths of its own — so if it throws, setting `moved` only after return would leave the tree
      // advanced but the gesture uncommittable, and `pointerup` would commit nothing. That is the same
      // three-way disagreement between tree, DOM and storage that `applyLayout` was fixed to avoid;
      // arming first keeps this gesture committable even when the frame handler throws.
      moved = true
      handlers.resize(path, index, (now - last) / span)
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

  // THE KEYBOARD PATH — design §6.2's first exception. `Home`/`End` are deliberately absent: they
  // would mean "collapse this pane to its floor", which is a thing the close control already says
  // better and unambiguously.
  //
  // IT IS A GESTURE, EXACTLY LIKE A DRAG. Auto-repeat sends many `keydown`s and one `keyup`, so a held
  // arrow key is N cheap frames and one storage write rather than N full rebuilds — the same shape the
  // pointer path takes above, for the same reason.
  let armedKey: string | null = null

  el.addEventListener('keydown', (e) => {
    const forward = dir === 'row' ? 'ArrowRight' : 'ArrowDown'
    const back = dir === 'row' ? 'ArrowLeft' : 'ArrowUp'
    let delta: number
    if (e.key === forward) delta = KEY_STEP
    else if (e.key === back) delta = -KEY_STEP
    else return
    // `armedKey` IS SET BEFORE `handlers.resize` RUNS, NOT AFTER — the same ordering `pointermove`
    // uses above and for the same reason: if the frame handler throws, `keyup`/`blur` must still find
    // the gesture committable rather than silently discarding a model that already advanced.
    armedKey = e.key
    handlers.resize(path, index, delta)
    e.preventDefault()
  })

  // `blur` COMMITS TOO, AND IT IS NOT BELT-AND-BRACES. `keyup` never arrives if focus leaves while the
  // key is down — a click into a pane, a `Tab` chord, the window losing focus — and the frames already
  // moved the model, so without this the tree on screen and the tree in storage disagree until the next
  // unrelated `applyLayout` happens to reconcile them.
  //
  // `keyup` COMMITS ONLY WHEN THE RELEASED KEY IS THE ONE THAT ARMED THE GESTURE — Important finding,
  // review of this task. A held arrow key's own `keyup` is not the only `keyup` this divider can see
  // while it holds focus: the user can press and release an UNRELATED key — a modifier, a stray
  // keystroke — without ever releasing the arrow. `armedKey` records WHICH key armed the current gesture
  // rather than merely THAT some key did, so an unrelated key's `keyup` finds no match, calls nothing,
  // and leaves the gesture armed; auto-repeat then keeps re-arming it with the arrow key itself, and the
  // arrow's own eventual `keyup` is what actually commits. Without this the unrelated `keyup` mid-hold
  // consumed the arming and wrote to storage early, and the arrow's later `keyup` — re-armed by
  // auto-repeat in between — committed a SECOND time: two writes for one continuous gesture, against the
  // one-write-per-gesture invariant this path exists to establish. `blur` has no released key to compare
  // against — focus can leave from a click or a `Tab` with no `keyup` involved at all — so it stays
  // unconditional on anything but arming: any armed gesture commits when focus goes, exactly as before.
  const commitKeys = (): void => {
    // A `blur` FIRED BY THE VERY REBUILD WE ARE INSIDE MUST NOT COMMIT. `renderLayout`'s
    // `root.replaceChildren()` removes a focused divider mid-rebuild, and Chromium fires `blur` on an
    // element the instant it is removed while focused — so this handler can be reached from INSIDE
    // `applyLayout`'s own `renderLayout` call, not only from a user releasing focus. Letting that
    // `blur` reach `handlers.commit()` would re-enter `applyLayout` from inside its own `renderLayout`:
    // the outer call would go on to append a second tree box, and `syncSizes`'s anchor
    // (`root.firstElementChild`) would then point at a stale one. `el.isConnected` is what tells the
    // two cases apart — false exactly when this divider has already been detached by the rebuild we are
    // inside — so bailing here makes the ordering below safe by design rather than merely by the
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

  return el
}
