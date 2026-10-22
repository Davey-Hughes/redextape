import type { Dir, LayoutNode } from './layout'
import { leaves, MIN_PANE_FRACTION } from './layout'
import type { LeafId } from './panes'
import { separatorGesture } from './separator'

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
 * The width a divider takes along its split's axis, in CSS pixels: `style.css`'s `.layout-divider`, a 4 px line with a
 * 4 px transparent border on each side.
 *
 * **WRITTEN DOWN, BECAUSE THE ARITHMETIC IS WORKED BEFORE ANYTHING IS DRAWN.** `pane-host.ts`'s `admit` works an add
 * out in tiles on the tree's fractions (`layout.ts`'s `leafExtents`), for a tree that is not on the page yet, and a
 * constant keeps that a value a node test can hold. `tests/browser/add-view-floor.test.ts` measures every divider of
 * the tiled default against this number, so the stylesheet and it cannot part.
 */
export const DIVIDER_PX = 12

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
  // IS REBUILT FROM SCRATCH EVERY CALL. A RESIZE FRAME REBUILDS NOTHING — `syncSizes` writes the new
  // fractions onto the elements that are already there, precisely so the FRAMES of a gesture do not
  // destroy the control performing them. WHAT REBUILDS IS EVERY GESTURE'S COMMIT, AND THAT INCLUDES AN
  // ORDINARY RESIZE, NOT ONLY A STRUCTURAL CHANGE. `handlers.commit` (`pane-host.ts`'s `applyLayout`)
  // calls `renderLayout` from its `finally` block on every call it makes while the views are tiled (a
  // stage, which has no dividers, takes `renderStage` there) — a drag's `pointerup`, a keyboard
  // gesture's `keyup`/`blur`, a split, a close, `reset preset`, a restore all reach it the same way —
  // so a resize rebuilds the whole tree once per GESTURE, at the moment it ends.
  // This rescue is what keeps a keyboard user's place across every one of those rebuilds, resize's own
  // commit included: on a `keyup` COMMIT the divider the user was holding down is destroyed and rebuilt
  // exactly like a structural change would destroy it, and without this rescue focus would drop to
  // `<body>` and the next press would do nothing. A divider that answers exactly one keystroke defeats
  // design §6.2's keyboard-operability requirement as thoroughly as never wiring the handler, so this is
  // not polish: it is what makes the keyboard path keep working past its first gesture. `path`/`index`
  // (stamped onto every divider as `data-` attributes in `divider()` below) are what "the same divider"
  // means across a rebuild, since the element itself never is.
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
 * implicitly the moment the captured element leaves the document.
 *
 * `aria-valuenow` IS WRITTEN HERE AND THAT IS NOT A COURTESY. `divider()` sets it once, from the size
 * it is handed at build time, and a gesture's frames do not rebuild the tree. A cheap path that moved
 * `flex` and not `aria-valuenow` would leave every divider reporting the fraction it was born with — a
 * silent regression in the one part of this subsystem deliberately exempted from Plan 5's deferred
 * accessibility pass.
 *
 * IT THROWS ON A SHAPE MISMATCH RATHER THAN REPAIRING ONE. A model whose splits do not match the
 * rendered boxes means the caller took this path when it owed a `renderLayout`, which is a programming
 * error. `LambdaPane.receiveEditor` makes the same call for the same reason: a silent repair would absorb
 * a caller's defect as normal operation.
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
 * along its own axis, read at each frame rather than cached, because a window resize between renders
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
  el.setAttribute('aria-label', dir === 'row' ? 'resize views left and right' : 'resize views up and down')
  el.tabIndex = 0

  const extent = () => (dir === 'row' ? box.getBoundingClientRect().width : box.getBoundingClientRect().height)

  // THE GESTURE IS `separator.ts`'s, shared with the boundaries between a view's panels: a drag under pointer
  // capture, a held arrow key as frames and one commit, and the `blur` that a rebuild fires on a detached divider
  // refused. What is this divider's own is what a pixel and a step are worth: a pixel is a fraction of the split
  // box's extent, measured at each frame (the denominator's note above), and a step is `KEY_STEP`.
  separatorGesture(el, dir === 'row' ? 'x' : 'y', {
    ready: () => extent() > 0,
    drag: (px) => handlers.resize(path, index, px / extent()),
    step: (sign) => handlers.resize(path, index, sign * KEY_STEP),
    commit: () => handlers.commit(),
  })

  return el
}

/**
 * THE SAME TREE, DRAWN AS TABS — Plan 7 part 2 spec §5, the `views` switch at `stage`.
 *
 * **STAGE IS A RENDERER, NOT A NODE.** The tree is untouched: the tabs are `leaves(tree)` in depth-first
 * order and the mounted host is the focused leaf's. Every other host stays in the caller's map, off the
 * page, exactly as a host between two commits already is (`renderLayout`'s own note) — which is what makes
 * flipping back to tiles give the arrangement the user left, for free rather than by remembering it.
 *
 * **NO `ResizeHandlers`, BECAUSE A STAGE HAS NO DIVIDERS.** The tree still has splits and sizes and they
 * are still what `tiles` draws; nothing here writes to them.
 *
 * **A TAB HAS NO CLOSE CONTROL** (§5): the view's own header still carries `✕`, and a second closer would
 * be a second glyph meaning "close" in the same place (umbrella §4 rule 2).
 *
 * **MANUAL ACTIVATION.** Arrow keys move the focus with a roving `tabindex`; `Enter` or `Space` selects.
 * Automatic activation — selecting on arrow — would remount a CodeMirror-bearing subtree per keypress for
 * a user who is only looking for the tab they want.
 *
 * **IT RESCUES THE FOCUSED TAB ACROSS ITS OWN REBUILD**, for `renderLayout`'s divider reason and by the
 * same mechanism: an element has no identity across `replaceChildren`, so `data-leaf` is the durable name.
 */
export function renderStage(
  root: HTMLElement,
  tree: LayoutNode,
  hosts: Map<LeafId, HTMLElement>,
  opts: { readonly focused: LeafId; title(id: LeafId): string; select(id: LeafId): void },
): void {
  const held = root.contains(document.activeElement) ? document.activeElement : null
  const heldLeaf = held instanceof HTMLElement && held.getAttribute('role') === 'tab' ? held.dataset.leaf : undefined

  const all = leaves(tree)
  const shown = all.some((l) => l.id === opts.focused) ? opts.focused : (all[0]?.id ?? opts.focused)
  const host = hosts.get(shown)
  if (host === undefined) throw new Error(`stage names a leaf with no host: ${shown}`)
  // THE HOST NEEDS AN ID BECAUSE A TAB NAMES IT, minted the way `panel.ts` mints a panel body's:
  // `aria-controls` is an IDREF, and a host built by `pane-host.ts` carries only `data-leaf`.
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

  /**
   * Move the focus to tab `i`, wrapping — and move the TAB STOP with it.
   *
   * **A ROVING `tabindex` HAS TO ROVE.** The tabs are built with `tabIndex = selected ? 0 : -1`; left there,
   * arrowing to a tab would leave the strip's single tab stop on the tab that is still SELECTED, and `Tab`
   * out and `Shift+Tab` back would return to a different tab than the one the user had arrowed to — exactly
   * the condition the pattern exists to prevent. Selection is manual here (§5), so the tab stop follows the
   * FOCUS and not the selection; they part company the moment a user arrows without pressing Enter, which
   * is the whole point of manual activation.
   */
  const focusAt = (i: number): void => {
    const next = tabs[(i + tabs.length) % tabs.length]
    if (next === undefined) return
    for (const t of tabs) t.tabIndex = t === next ? 0 : -1
    next.focus()
  }
  tabs.forEach((t, i) => {
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') focusAt(i + 1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') focusAt(i - 1)
      else if (e.key === 'Home') focusAt(0)
      else if (e.key === 'End') focusAt(tabs.length - 1)
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

/**
 * Bring each tab of a stage drawn under `root` up to its view's title — once per frame, from `draw()`.
 *
 * **A TAB IS BUILT WITH ITS VIEW'S TITLE, AND A VIEW'S TITLE CHANGES WITHOUT A REBUILD.** *Edit a copy*, a pick in
 * the title's menu and a move back to the program each rebind a view in place: its header repaints on the frame the
 * rebind draws, but `renderStage` runs only when the layout is applied, so without this the tab would go on naming
 * what the view showed before until another tab was selected. In Stage the tab names a view as its title does, so
 * the two are kept saying the same thing.
 *
 * **ONLY WHAT CHANGED IS WRITTEN**: this runs on every recorded frame during playback, and the element keeps its
 * identity, so a tab holding the focus keeps it.
 */
export function retitleStage(root: HTMLElement, title: (id: LeafId) => string): void {
  for (const tab of root.querySelectorAll<HTMLElement>('.stage-tab')) {
    const id = tab.dataset.leaf
    if (id === undefined) continue
    const next = title(id)
    if (tab.textContent !== next) tab.textContent = next
  }
}
