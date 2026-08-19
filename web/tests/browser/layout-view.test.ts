import { beforeEach, describe, expect, it } from 'vitest'
import { defaultLayout, type LayoutNode, resize } from '../../src/layout'
import { KEY_STEP, type ResizeHandlers, renderLayout, syncSizes } from '../../src/layout-view'

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

/** Handlers that record nothing — for the tests that assert geometry rather than reporting. */
const inert = (): ResizeHandlers => ({ resize: () => {}, commit: () => {} })

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
    renderLayout(root, defaultLayout(), hosts, inert())
    const mounted = [...root.querySelectorAll('[data-leaf]')].map((e) => (e as HTMLElement).dataset.leaf)
    expect(mounted).toEqual(['source', 'lambda-0', 'tm-0'])
  })

  it('mounts the same host element rather than a copy, so pane state survives a re-render', () => {
    renderLayout(root, defaultLayout(), hosts, inert())
    const first = root.querySelector('[data-leaf="lambda-0"]')
    renderLayout(root, defaultLayout(), hosts, inert())
    expect(root.querySelector('[data-leaf="lambda-0"]')).toBe(first)
  })

  it('puts one divider between each pair of siblings', () => {
    renderLayout(root, defaultLayout(), hosts, inert())
    // column[ row[source, lambda], tm ] -> one divider inside the row, one in the column.
    expect(root.querySelectorAll('[role="separator"]').length).toBe(2)
  })

  it('gives every divider the separator semantics a keyboard user needs', () => {
    renderLayout(root, defaultLayout(), hosts, inert())
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
    renderLayout(root, defaultLayout(), hosts, {
      resize: (path, index, delta) => calls.push({ path, index, delta }),
      commit: () => {},
    })
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
    renderLayout(root, defaultLayout(), hosts, {
      resize: (path, index, delta) => calls.push({ path, index, delta }),
      commit: () => {},
    })
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
    renderLayout(root, defaultLayout(), hosts, {
      resize: (path, index) => calls.push({ path, index }),
      commit: () => {},
    })
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
    renderLayout(root, solo, hosts, inert())
    expect(root.querySelectorAll('[role="separator"]').length).toBe(0)
    expect(root.querySelector('[data-leaf="tm-0"]')).not.toBeNull()
  })

  it('keeps focus on the same divider across a re-render, so a second arrow-key press still works', () => {
    renderLayout(root, defaultLayout(), hosts, inert())
    const before = root.querySelector('[role="separator"][aria-orientation="vertical"]') as HTMLElement
    const path = before.dataset.path
    const index = before.dataset.index

    before.focus()
    expect(document.activeElement).toBe(before)

    // The real caller re-renders once per gesture's COMMIT, not once per FRAME — a drag's `pointerup`, a
    // keyboard gesture's `keyup`/`blur`, and every structural change (split, close, reset layout) all end
    // in `pane-host.ts`'s `applyLayout`, which calls `renderLayout` unconditionally from its `finally`
    // block on every call. That is what destroys `before` and rebuilds it as a new node with the same
    // path/index. A resize no longer re-renders on each FRAME (`syncSizes` moves the elements already
    // there, cheaply), but its own commit still rebuilds the tree exactly like a structural change does —
    // so the key press below, with no matching `commit`, is standing in for that commit-time rebuild
    // rather than for something only a structural change causes. The rescue this test pins is unchanged;
    // what changed is how often a resize reaches it — once per gesture instead of once per frame — not
    // whether it does.
    before.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    renderLayout(root, defaultLayout(), hosts, inert())

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

describe('syncSizes', () => {
  it('moves flex on both neighbours of the addressed divider and leaves the rest alone', () => {
    renderLayout(root, defaultLayout(), hosts, inert())
    const moved = resize(defaultLayout(), [0], 0, 0.2)

    syncSizes(root, moved)

    // `defaultLayout()`'s inner row split is source | lambda-0 at 0.5/0.5; +0.2 makes it 0.7/0.3.
    const source = root.querySelector<HTMLElement>('[data-leaf="source"]')
    const lambda = root.querySelector<HTMLElement>('[data-leaf="lambda-0"]')
    const tm = root.querySelector<HTMLElement>('[data-leaf="tm-0"]')
    // Chromium normalizes the shorthand's flex-basis `0` to `0px` on readback, so the exact string this
    // assertion pins down is `'0.7 1 0px'`, not the `'0.7 1 0'` `syncNode` writes — still an exact-string
    // comparison that fails just as hard if the NUMBER were wrong, only the basis unit differs.
    expect(source?.style.flex).toBe('0.7 1 0px')
    expect(lambda?.style.flex).toBe('0.3 1 0px')
    // The outer column split was not addressed, so tm-0 keeps the half it had.
    expect(tm?.style.flex).toBe('0.5 1 0px')
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

  it('throws when nothing has been rendered under root yet', () => {
    // No `renderLayout` call precedes this one — `root` is the bare `<main>` `beforeEach` creates, so
    // `root.firstElementChild` is `null` and `syncSizes` has nothing to walk. This is a distinct throw
    // arm from the DOM/model mismatch above: that one fires inside `syncNode`, once there is at least a
    // rendered tree to compare against; this one fires in `syncSizes` itself, before `syncNode` is ever
    // called.
    expect(() => syncSizes(root, defaultLayout())).toThrow(/nothing is rendered under root/)
  })

  it('throws when the position after a child holds no divider', () => {
    renderLayout(root, defaultLayout(), hosts, inert())
    const divider = root.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]')
    if (divider === null) throw new Error('no vertical divider')
    // Strip the class that marks this element as a divider WITHOUT touching child count, so the
    // "no element for child i" check earlier in `syncNode` still passes and this is the one throw arm
    // that fires — the sibling-count mismatch test above exercises the other arm instead.
    divider.classList.remove('layout-divider')

    expect(() => syncSizes(root, defaultLayout())).toThrow(/no divider after child/)
  })

  it('accepts a single-leaf tree, which has no split to walk', () => {
    const solo: LayoutNode = { kind: 'leaf', id: 'tm-0', pane: 'tm' }
    renderLayout(root, solo, hosts, inert())
    expect(() => syncSizes(root, solo)).not.toThrow()
  })
})
