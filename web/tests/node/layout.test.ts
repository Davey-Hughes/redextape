import { describe, expect, it } from 'vitest'
import {
  closeLeaf,
  defaultLayout,
  defaultLayout as dl,
  LAYOUT_VERSION,
  type LayoutNode,
  leaves,
  MIN_PANE_FRACTION,
  parseLayout,
  resize,
  serializeLayout,
  splitLeaf,
} from '../../src/layout'

/**
 * THE TREE MODEL, WITH NO DOM ANYWHERE — every invariant design §4.1 states, asserted as a value.
 *
 * The reason this tier exists at all is that a layout bug is invisible in a browser until it is
 * grotesque: a single-child split renders as a pane with slightly wrong padding, and sizes that do
 * not sum to 1 render as a gap. Both are values here.
 */

const leaf = (id: string, pane: 'source' | 'lambda' | 'tm'): LayoutNode => ({ kind: 'leaf', id, pane })

describe('defaultLayout', () => {
  it('reproduces the arrangement index.html ships', () => {
    expect(defaultLayout()).toEqual({
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [
        {
          kind: 'split',
          dir: 'row',
          sizes: [0.5, 0.5],
          children: [leaf('source', 'source'), leaf('lambda-0', 'lambda')],
        },
        leaf('tm-0', 'tm'),
      ],
    })
  })
})

describe('splitLeaf', () => {
  it('replaces the leaf with a split holding it and a duplicate of its kind', () => {
    const tree = splitLeaf(leaf('lambda-0', 'lambda'), 'lambda-0', 'row', 'lambda-1')
    expect(tree).toEqual({
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leaf('lambda-0', 'lambda'), leaf('lambda-1', 'lambda')],
    })
  })

  it('splits a nested leaf without disturbing its siblings', () => {
    const tree = splitLeaf(defaultLayout(), 'tm-0', 'column', 'tm-1')
    expect(leaves(tree).map((l) => l.id)).toEqual(['source', 'lambda-0', 'tm-0', 'tm-1'])
  })

  it('refuses to split the source leaf, because there is no second editor to duplicate', () => {
    expect(() => splitLeaf(defaultLayout(), 'source', 'row', 'source-1')).toThrow(/source/)
  })

  it('throws on an unknown leaf rather than returning the tree unchanged', () => {
    expect(() => splitLeaf(defaultLayout(), 'nope', 'row', 'x')).toThrow(/nope/)
  })

  it('refuses a newId already in the tree, because the duplicate would be unreachable', () => {
    // findLeaf uses .find(), so a duplicate id would silently hide the second leaf behind the first
    // rather than surface as a tree parseLayout could also reject on load.
    expect(() => splitLeaf(defaultLayout(), 'lambda-0', 'row', 'tm-0')).toThrow(/tm-0/)
  })
})

describe('closeLeaf', () => {
  it('collapses a split left with one child into that child', () => {
    const tree = splitLeaf(leaf('lambda-0', 'lambda'), 'lambda-0', 'row', 'lambda-1')
    expect(closeLeaf(tree, 'lambda-1')).toEqual(leaf('lambda-0', 'lambda'))
  })

  it('collapses recursively so no single-child spine survives', () => {
    // column[ row[source, lambda-0], tm-0 ] -> close source, close lambda-0 -> leaf(tm-0)
    const afterSource = closeLeaf(defaultLayout(), 'source')
    expect(afterSource).toEqual({
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [leaf('lambda-0', 'lambda'), leaf('tm-0', 'tm')],
    })
    expect(closeLeaf(afterSource, 'lambda-0')).toEqual(leaf('tm-0', 'tm'))
  })

  it('refuses to close the last leaf', () => {
    expect(() => closeLeaf(leaf('tm-0', 'tm'), 'tm-0')).toThrow(/last/)
  })

  it('renormalizes the sizes of the split it left', () => {
    const three: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.2, 0.3, 0.5],
      children: [leaf('a', 'lambda'), leaf('b', 'lambda'), leaf('c', 'tm')],
    }
    const after = closeLeaf(three, 'b')
    expect(after.kind).toBe('split')
    if (after.kind !== 'split') throw new Error('unreachable')
    expect(after.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    // The survivors keep their RATIO: 0.2 : 0.5 becomes 0.2/0.7 : 0.5/0.7.
    expect(after.sizes[0]).toBeCloseTo(0.2 / 0.7, 10)
  })
})

describe('resize', () => {
  const pair: LayoutNode = {
    kind: 'split',
    dir: 'row',
    sizes: [0.5, 0.5],
    children: [leaf('a', 'lambda'), leaf('b', 'tm')],
  }

  it('moves the boundary between two children and keeps the sum at 1', () => {
    const after = resize(pair, [], 0, 0.1)
    if (after.kind !== 'split') throw new Error('unreachable')
    expect(after.sizes).toEqual([0.6, 0.4])
  })

  it('clamps rather than shrinking a pane below the minimum', () => {
    const after = resize(pair, [], 0, 0.9)
    if (after.kind !== 'split') throw new Error('unreachable')
    expect(after.sizes[1]).toBeCloseTo(MIN_PANE_FRACTION, 10)
    expect(after.sizes[0]).toBeCloseTo(1 - MIN_PANE_FRACTION, 10)
  })

  it('clamps in the other direction too', () => {
    const after = resize(pair, [], 0, -0.9)
    if (after.kind !== 'split') throw new Error('unreachable')
    expect(after.sizes[0]).toBeCloseTo(MIN_PANE_FRACTION, 10)
  })

  it('resizes a nested split addressed by path', () => {
    const after = resize(defaultLayout(), [0], 0, 0.1)
    if (after.kind !== 'split') throw new Error('unreachable')
    const inner = after.children[0]
    if (inner?.kind !== 'split') throw new Error('unreachable')
    expect(inner.sizes).toEqual([0.6, 0.4])
  })

  /**
   * FOUR OF THE SIX THROW PATHS `at()` AND `resize()` CAN TAKE — the other two live inside
   * `resize`'s `rewrite` closure and are not reachable from here. `rewrite` re-walks the same
   * `path` over the same, unmutated `root` that `at()` already walked to completion two lines
   * above it in `resize`'s body. Every node `at()` stepped through on the way to the target was
   * already proven `kind === 'split'` (or `at()` itself would have thrown), and the target node
   * itself is proven `kind === 'split'` by the check immediately after `at()` returns — so by the
   * time `rewrite` runs, both of its own `kind !== 'split'` guards are checking something already
   * established. There is no path array that gets a caller past `at()` and the post-`at()` check
   * but still trips either guard inside `rewrite`.
   */
  it('throws when the path runs through a leaf on the way down', () => {
    // defaultLayout()'s [0] is a split, but [0, 0] is the source leaf — [0, 0, 0] tries to step
    // past it.
    expect(() => resize(defaultLayout(), [0, 0, 0], 0, 0.1)).toThrow(/layout path leaves the tree at index 0/)
  })

  it('throws when a path index has no child there', () => {
    expect(() => resize(defaultLayout(), [5], 0, 0.1)).toThrow(/layout path leaves the tree at index 5/)
  })

  it('throws when the path addresses a leaf directly', () => {
    // [0, 0] resolves to the source leaf itself, not a split to resize.
    expect(() => resize(defaultLayout(), [0, 0], 0, 0.1)).toThrow(/resize addressed a leaf/)
  })

  it('throws when there is no divider at the given index', () => {
    expect(() => resize(pair, [], 5, 0.1)).toThrow(/no divider at index 5/)
  })
})

describe('immutability', () => {
  it('never mutates the tree it was given', () => {
    const before = defaultLayout()
    const snapshot = structuredClone(before)
    splitLeaf(before, 'tm-0', 'row', 'tm-1')
    closeLeaf(before, 'source')
    resize(before, [], 0, 0.2)
    expect(before).toEqual(snapshot)
  })
})

/**
 * VALIDATION IS THE WORK HERE, NOT PARSING — design §4.4.
 *
 * `localStorage` is user-editable, so a value that passes a shallow shape check but violates §4.1
 * crashes inside the renderer on load, which is strictly worse than falling back. Every case below is
 * a hand-written malformed value rather than a mutation of a good one, because a hand-edited entry is
 * the hazard being defended against.
 */
describe('parseLayout', () => {
  const wrap = (tree: unknown) => JSON.stringify({ version: LAYOUT_VERSION, tree })

  it('round-trips a tree it serialized', () => {
    expect(parseLayout(serializeLayout(dl()))).toEqual(dl())
  })

  it('returns null for absent storage', () => {
    expect(parseLayout(null)).toBeNull()
  })

  it('returns null for text that is not JSON', () => {
    expect(parseLayout('{oh no')).toBeNull()
  })

  it('returns null for a wrong version', () => {
    expect(parseLayout(JSON.stringify({ version: 99, tree: dl() }))).toBeNull()
  })

  it('returns null for a missing version', () => {
    expect(parseLayout(JSON.stringify({ tree: dl() }))).toBeNull()
  })

  it('returns null for an unknown pane kind', () => {
    expect(parseLayout(wrap({ kind: 'leaf', id: 'a', pane: 'quantum' }))).toBeNull()
  })

  it('returns null for non-array children', () => {
    expect(parseLayout(wrap({ kind: 'split', dir: 'row', children: 'nope', sizes: [1] }))).toBeNull()
  })

  it('returns null for a split with fewer than two children', () => {
    expect(
      parseLayout(wrap({ kind: 'split', dir: 'row', children: [{ kind: 'leaf', id: 'a', pane: 'tm' }], sizes: [1] })),
    ).toBeNull()
  })

  it('returns null when sizes and children disagree in length', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'row',
          children: [
            { kind: 'leaf', id: 'a', pane: 'tm' },
            { kind: 'leaf', id: 'b', pane: 'tm' },
          ],
          sizes: [0.5],
        }),
      ),
    ).toBeNull()
  })

  it('returns null when sizes do not sum to 1', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'row',
          children: [
            { kind: 'leaf', id: 'a', pane: 'tm' },
            { kind: 'leaf', id: 'b', pane: 'tm' },
          ],
          sizes: [0.5, 0.9],
        }),
      ),
    ).toBeNull()
  })

  it('returns null for duplicate leaf ids', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'row',
          children: [
            { kind: 'leaf', id: 'a', pane: 'tm' },
            { kind: 'leaf', id: 'a', pane: 'lambda' },
          ],
          sizes: [0.5, 0.5],
        }),
      ),
    ).toBeNull()
  })

  it('returns null for more than one source leaf', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'row',
          children: [
            { kind: 'leaf', id: 'a', pane: 'source' },
            { kind: 'leaf', id: 'b', pane: 'source' },
          ],
          sizes: [0.5, 0.5],
        }),
      ),
    ).toBeNull()
  })

  it('returns null for an unknown split direction', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'diagonal',
          children: [
            { kind: 'leaf', id: 'a', pane: 'tm' },
            { kind: 'leaf', id: 'b', pane: 'tm' },
          ],
          sizes: [0.5, 0.5],
        }),
      ),
    ).toBeNull()
  })

  it('accepts a tree with no source leaf, because closing it is legal', () => {
    const noSource = wrap({
      kind: 'split',
      dir: 'row',
      children: [
        { kind: 'leaf', id: 'a', pane: 'lambda' },
        { kind: 'leaf', id: 'b', pane: 'tm' },
      ],
      sizes: [0.5, 0.5],
    })
    expect(parseLayout(noSource)).not.toBeNull()
  })
})
