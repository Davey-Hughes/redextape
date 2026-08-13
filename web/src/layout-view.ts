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
export function renderLayout(
  root: HTMLElement,
  tree: LayoutNode,
  hosts: Map<LeafId, HTMLElement>,
  onResize: (path: number[], index: number, delta: number) => void,
): void {
  // THE DIVIDER A KEYBOARD USER IS FOCUSED ON DOES NOT SURVIVE `replaceChildren()` — UNLIKE A HOST, IT
  // IS REBUILT FROM SCRATCH EVERY CALL. `onResize`'s caller re-renders after every resize, which is the
  // natural way to reflect one, so without this rescue the FIRST arrow-key press would move the
  // divider, destroy the element focus is sitting on, and drop focus to `<body>` — the second press
  // would then do nothing at all. A divider that answers exactly one keystroke defeats design §6.2's
  // keyboard-operability requirement as thoroughly as never wiring the handler, so this is not
  // polish: it is what makes the keyboard path keep working past its first use. `path`/`index` (stamped
  // onto every divider as `data-` attributes in `divider()` below) are what "the same divider" means
  // across a rebuild, since the element itself never is.
  const focused = root.contains(document.activeElement) ? document.activeElement : null
  const identity =
    focused instanceof HTMLElement && focused.classList.contains('layout-divider')
      ? { path: focused.dataset.path, index: focused.dataset.index }
      : null

  // Detach children without destroying them — `replaceChildren()` with no arguments removes every
  // child, and the hosts we are about to re-append are held by the caller's map, so nothing is lost.
  root.replaceChildren()
  root.append(build(tree, [], hosts, onResize))

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
  onResize: (path: number[], index: number, delta: number) => void,
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
    const el = build(child, [...path, i], hosts, onResize)
    el.style.flex = `${node.sizes[i] ?? 1 / node.children.length} 1 0`
    box.append(el)
    if (i < node.children.length - 1) {
      box.append(divider(box, node.dir, path, i, node.sizes[i] ?? 0, onResize))
    }
  })

  return box
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
  onResize: (path: number[], index: number, delta: number) => void,
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
  let last = 0

  el.addEventListener('pointerdown', (e) => {
    dragging = true
    last = dir === 'row' ? e.clientX : e.clientY
    el.setPointerCapture(e.pointerId)
    e.preventDefault()
  })

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const now = dir === 'row' ? e.clientX : e.clientY
    const span = extent()
    if (span > 0) onResize(path, index, (now - last) / span)
    last = now
  })

  const stop = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  }
  el.addEventListener('pointerup', stop)
  el.addEventListener('pointercancel', stop)

  // THE KEYBOARD PATH — design §6.2's first exception. `Home`/`End` are deliberately absent: they
  // would mean "collapse this pane to its floor", which is a thing the close control already says
  // better and unambiguously.
  el.addEventListener('keydown', (e) => {
    const forward = dir === 'row' ? 'ArrowRight' : 'ArrowDown'
    const back = dir === 'row' ? 'ArrowLeft' : 'ArrowUp'
    if (e.key === forward) onResize(path, index, KEY_STEP)
    else if (e.key === back) onResize(path, index, -KEY_STEP)
    else return
    e.preventDefault()
  })

  return el
}
