import { beforeEach, describe, expect, it } from 'vitest'
import { defaultLayout, type LayoutNode } from '../../src/layout'
import { KEY_STEP, renderLayout } from '../../src/layout-view'

/**
 * THE TREE AS DOM — geometry, dividers, and the keyboard path design §6.2 refuses to defer.
 *
 * A drag-only divider makes the whole layout mouse-only, which is a different class of gap from an
 * unannounced state change, so the arrow-key path is asserted here rather than added to the standing
 * accessibility list.
 */

let root: HTMLElement
const hosts = new Map<string, HTMLElement>()

function host(id: string): HTMLElement {
  const el = document.createElement('section')
  el.dataset.leaf = id
  hosts.set(id, el)
  return el
}

beforeEach(() => {
  document.body.innerHTML = ''
  hosts.clear()
  root = document.createElement('main')
  root.style.width = '800px'
  root.style.height = '600px'
  document.body.append(root)
  for (const id of ['source', 'lambda-0', 'tm-0']) host(id)
})

describe('renderLayout', () => {
  it('mounts every leaf host in tree order', () => {
    renderLayout(root, defaultLayout(), hosts, () => {})
    const mounted = [...root.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf)
    expect(mounted).toEqual(['source', 'lambda-0', 'tm-0'])
  })

  it('mounts the same host element rather than a copy, so pane state survives a re-render', () => {
    renderLayout(root, defaultLayout(), hosts, () => {})
    const first = root.querySelector('[data-leaf="lambda-0"]')
    renderLayout(root, defaultLayout(), hosts, () => {})
    expect(root.querySelector('[data-leaf="lambda-0"]')).toBe(first)
  })

  it('puts one divider between each pair of siblings', () => {
    renderLayout(root, defaultLayout(), hosts, () => {})
    // column[ row[source, lambda], tm ] -> one divider inside the row, one in the column.
    expect(root.querySelectorAll('[role="separator"]').length).toBe(2)
  })

  it('gives every divider the separator semantics a keyboard user needs', () => {
    renderLayout(root, defaultLayout(), hosts, () => {})
    for (const d of root.querySelectorAll('[role="separator"]')) {
      expect(d.getAttribute('aria-orientation')).toMatch(/^(horizontal|vertical)$/)
      expect(d.getAttribute('aria-valuenow')).not.toBeNull()
      expect(d.getAttribute('aria-valuemin')).not.toBeNull()
      expect(d.getAttribute('aria-valuemax')).not.toBeNull()
      expect((d as HTMLElement).tabIndex).toBe(0)
    }
  })

  it('reports a resize when a divider is dragged, as a FRACTION of the split — not raw pixels', () => {
    const calls: { path: number[]; index: number; delta: number }[] = []
    renderLayout(root, defaultLayout(), hosts, (path, index, delta) => calls.push({ path, index, delta }))
    const divider = root.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement

    divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 300, pointerId: 1 }))
    divider.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 480, clientY: 300, pointerId: 1 }))
    divider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 480, clientY: 300, pointerId: 1 }))

    // The divider's split box spans the full 800px root (source/lambda's row fills the column split
    // above it), so an 80px drag is a fraction of 80/800 = 0.1 — not merely "positive". Asserting only
    // the sign would pass just as well on the raw pixel count (80), which is the bug this pins down:
    // `toBeGreaterThan(0)` cannot tell a delta from a fraction.
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[calls.length - 1]?.delta).toBeCloseTo(0.1, 2)
  })

  it('reports a resize from the arrow keys, so the layout is not mouse-only', () => {
    const calls: { path: number[]; index: number; delta: number }[] = []
    renderLayout(root, defaultLayout(), hosts, (path, index, delta) => calls.push({ path, index, delta }))
    const divider = root.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement

    // Exact equality against `KEY_STEP`, not merely the sign — a keyboard step that reported the wrong
    // MAGNITUDE (too large, too small, or accidentally pixels) would still satisfy `toBeGreaterThan(0)`.
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(calls.at(-1)?.delta).toBe(KEY_STEP)

    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(calls.at(-1)?.delta).toBe(-KEY_STEP)
  })

  it('addresses a nested divider by its path', () => {
    const calls: { path: number[]; index: number }[] = []
    renderLayout(root, defaultLayout(), hosts, (path, index) => calls.push({ path, index }))
    // The vertical divider is inside children[0]; the horizontal one is at the root.
    const vertical = root.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement
    const horizontal = root.querySelector('[role="separator"][aria-orientation="horizontal"]') as HTMLElement

    vertical.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(calls.at(-1)?.path).toEqual([0])

    horizontal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(calls.at(-1)?.path).toEqual([])
  })

  it('renders a single leaf with no divider at all', () => {
    const solo: LayoutNode = { kind: 'leaf', id: 'tm-0', pane: 'tm' }
    renderLayout(root, solo, hosts, () => {})
    expect(root.querySelectorAll('[role="separator"]').length).toBe(0)
    expect(root.querySelector('[data-leaf="tm-0"]')).not.toBeNull()
  })

  it('keeps focus on the same divider across a re-render, so a second arrow-key press still works', () => {
    renderLayout(root, defaultLayout(), hosts, () => {})
    const before = root.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement
    const path = before.dataset.path
    const index = before.dataset.index

    before.focus()
    expect(document.activeElement).toBe(before)

    // The real caller re-renders after every `onResize` to reflect it — that is the natural way to
    // show a resize, and it is exactly what destroys `before` and rebuilds it as a new node with the
    // same path/index. Firing the key first (even against a no-op `onResize`, as here) exercises the
    // same sequence a real drag or arrow-key press produces before that re-render lands.
    before.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    renderLayout(root, defaultLayout(), hosts, () => {})

    const after = document.activeElement
    expect(after).not.toBe(document.body)
    expect(after).toBeInstanceOf(HTMLElement)
    const restored = after as HTMLElement
    expect(restored.classList.contains('layout-divider')).toBe(true)
    expect(restored.dataset.path).toBe(path)
    expect(restored.dataset.index).toBe(index)
    // And it really is a fresh node, not the one that started focused — this is a rescue, not a case
    // where nothing happened.
    expect(restored).not.toBe(before)
  })
})
