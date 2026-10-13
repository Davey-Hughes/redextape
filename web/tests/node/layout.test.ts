import { describe, expect, it } from 'vitest'
import {
  addRefusal,
  closeLeaf,
  defaultArrangement,
  defaultLayout,
  HEADER_ORDER,
  holdsMostLeaves,
  insertBeside,
  KIND_ORDER,
  LAYOUT_VERSION,
  type LayoutNode,
  leafExtents,
  leaves,
  MAX_TREE_LEAVES,
  MIN_PANE_FRACTION,
  MIN_VIEW_PX,
  parseLayout,
  parseTree,
  resize,
  SIZE_EPSILON,
  SOURCE_LEAF,
  serializeLayout,
  setLeafKind,
  splitLeaf,
} from '../../src/layout'
import { DIVIDER_PX } from '../../src/layout-view'
import type { PaneKind } from '../../src/panes'
import { fourViews } from '../browser/harness'

/**
 * THE TREE MODEL, WITH NO DOM ANYWHERE — every invariant design §4.1 states, asserted as a value.
 *
 * The reason this tier exists at all is that a layout bug is invisible in a browser until it is
 * grotesque: a single-child split renders as a pane with slightly wrong padding, and sizes that do
 * not sum to 1 render as a gap. Both are values here.
 */

const leaf = (id: string, pane: PaneKind): LayoutNode => ({ kind: 'leaf', id, pane })

describe('defaultArrangement', () => {
  it('is the leaf for one kind, under its default id', () => {
    expect(defaultArrangement(['tm'], 'wide')).toEqual(leaf('tm-0', 'tm'))
    expect(defaultArrangement(['source'], 'tall')).toEqual(leaf('source', 'source'))
  })

  it('puts a pair side by side in a wide area and one above the other in a tall one', () => {
    const pair = (dir: 'row' | 'column'): LayoutNode => ({
      kind: 'split',
      dir,
      sizes: [0.5, 0.5],
      children: [leaf('source', 'source'), leaf('asm-0', 'asm')],
    })
    expect(defaultArrangement(['source', 'asm'], 'wide')).toEqual(pair('row'))
    expect(defaultArrangement(['source', 'asm'], 'tall')).toEqual(pair('column'))
  })

  it('puts the first of three beside a column of the other two, and over a row of them in a tall area', () => {
    const three = (outer: 'row' | 'column', inner: 'row' | 'column'): LayoutNode => ({
      kind: 'split',
      dir: outer,
      sizes: [0.5, 0.5],
      children: [
        leaf('source', 'source'),
        { kind: 'split', dir: inner, sizes: [0.5, 0.5], children: [leaf('lambda-0', 'lambda'), leaf('tm-0', 'tm')] },
      ],
    })
    expect(defaultArrangement(['source', 'lambda', 'tm'], 'wide')).toEqual(three('row', 'column'))
    expect(defaultArrangement(['source', 'lambda', 'tm'], 'tall')).toEqual(three('column', 'row'))
  })

  it('puts all four in two columns of two in a wide area: source over asm, beside λ over TM', () => {
    expect(defaultArrangement(KIND_ORDER, 'wide')).toEqual({
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [
        {
          kind: 'split',
          dir: 'column',
          sizes: [0.5, 0.5],
          children: [leaf('source', 'source'), leaf('asm-0', 'asm')],
        },
        {
          kind: 'split',
          dir: 'column',
          sizes: [0.5, 0.5],
          children: [leaf('lambda-0', 'lambda'), leaf('tm-0', 'tm')],
        },
      ],
    })
  })

  it('puts all four in two rows of two in a tall area, the tree a fresh page built until the view layouts', () => {
    expect(defaultArrangement(KIND_ORDER, 'tall')).toEqual(fourViews())
    expect(fourViews()).toEqual({
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
        {
          kind: 'split',
          dir: 'row',
          sizes: [0.5, 0.5],
          children: [leaf('asm-0', 'asm'), leaf('tm-0', 'tm')],
        },
      ],
    })
  })

  /**
   * THE USER'S RULE FOR A WIDE AREA, AS A PROPERTY (2026-10-11): no divider and no view runs the whole width. A tree's
   * root is then a row, or a single leaf, for every combination of more than one kind.
   */
  it('makes no tree whose root is a column in a wide area, and none whose root is a row in a tall one', () => {
    for (let mask = 1; mask < 1 << KIND_ORDER.length; mask++) {
      const kinds = KIND_ORDER.filter((_, i) => (mask & (1 << i)) !== 0)
      if (kinds.length === 1) continue
      const wide = defaultArrangement(kinds, 'wide')
      const tall = defaultArrangement(kinds, 'tall')
      expect(wide.kind === 'split' && wide.dir, kinds.join('+')).toBe('row')
      expect(tall.kind === 'split' && tall.dir, kinds.join('+')).toBe('column')
    }
  })

  it('puts the same view in the same corner in both shapes', () => {
    // FOUR CORNERS, READ OFF EACH TREE'S OWN NESTING: [top left, top right, bottom left, bottom right].
    const wide = defaultArrangement(KIND_ORDER, 'wide')
    const tall = defaultArrangement(KIND_ORDER, 'tall')
    const at = (t: LayoutNode, i: number, j: number): string => {
      const outer = t.kind === 'split' ? t.children[i] : undefined
      const inner = outer?.kind === 'split' ? outer.children[j] : undefined
      return inner?.kind === 'leaf' ? inner.id : ''
    }
    expect([at(wide, 0, 0), at(wide, 1, 0), at(wide, 0, 1), at(wide, 1, 1)]).toEqual([
      'source',
      'lambda-0',
      'asm-0',
      'tm-0',
    ])
    expect([at(tall, 0, 0), at(tall, 0, 1), at(tall, 1, 0), at(tall, 1, 1)]).toEqual([
      'source',
      'lambda-0',
      'asm-0',
      'tm-0',
    ])
  })

  it('lays the kinds out from KIND_ORDER whatever order they are handed in', () => {
    expect(defaultArrangement(['tm', 'source'], 'wide')).toEqual(defaultArrangement(['source', 'tm'], 'wide'))
    expect(defaultArrangement(['tm', 'asm', 'lambda', 'source'], 'wide')).toEqual(
      defaultArrangement(KIND_ORDER, 'wide'),
    )
    // A WIDE AREA'S LEAVES COME IN THE HEADER'S ORDER, down each column in turn, and a tall one's in `KIND_ORDER`.
    expect(leaves(defaultArrangement(KIND_ORDER, 'wide')).map((l) => l.pane)).toEqual([...HEADER_ORDER])
    expect(leaves(defaultArrangement(KIND_ORDER, 'tall')).map((l) => l.pane)).toEqual([...KIND_ORDER])
  })

  it('makes a tree parseTree takes, holding the kinds asked, for every combination and both shapes', () => {
    let combinations = 0
    for (let mask = 1; mask < 1 << KIND_ORDER.length; mask++) {
      const kinds = KIND_ORDER.filter((_, i) => (mask & (1 << i)) !== 0)
      combinations++
      for (const shape of ['wide', 'tall'] as const) {
        const tree = defaultArrangement(kinds, shape)
        expect(parseTree(JSON.parse(JSON.stringify(tree)))).toEqual(tree)
        expect(
          leaves(tree)
            .map((l) => l.pane)
            .sort(),
        ).toEqual([...kinds].sort())
      }
    }
    expect(combinations).toBe(15)
  })

  it('refuses no kinds, since a tree has a leaf or more', () => {
    expect(() => defaultArrangement([], 'wide')).toThrow(/a kind or more/)
  })
})

describe('defaultLayout', () => {
  it('is the source beside the TM view, and one above the other in a tall area', () => {
    expect(defaultLayout('wide')).toEqual({
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leaf('source', 'source'), leaf('tm-0', 'tm')],
    })
    expect(defaultLayout('tall')).toEqual(defaultArrangement(['source', 'tm'], 'tall'))
  })
})

describe('splitLeaf', () => {
  it('replaces the leaf with a split holding it and a duplicate of its kind', () => {
    const tree = splitLeaf(leaf('lambda-0', 'lambda'), 'lambda-0', 'row', 'lambda-1', 'lambda')
    expect(tree).toEqual({
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leaf('lambda-0', 'lambda'), leaf('lambda-1', 'lambda')],
    })
  })

  it('splits a nested leaf without disturbing its siblings', () => {
    const tree = splitLeaf(fourViews(), 'tm-0', 'column', 'tm-1', 'tm')
    expect(leaves(tree).map((l) => l.id)).toEqual(['source', 'lambda-0', 'asm-0', 'tm-0', 'tm-1'])
  })

  it('refuses to split the source leaf, because there is no second editor to duplicate', () => {
    expect(() => splitLeaf(fourViews(), 'source', 'row', 'source-1', 'lambda')).toThrow(/source/)
  })

  it('throws on an unknown leaf rather than returning the tree unchanged', () => {
    expect(() => splitLeaf(fourViews(), 'nope', 'row', 'x', 'lambda')).toThrow(/nope/)
  })

  it('refuses a newId already in the tree, because the duplicate would be unreachable', () => {
    // findLeaf uses .find(), so a duplicate id would silently hide the second leaf behind the first
    // rather than surface as a tree parseLayout could also reject on load.
    expect(() => splitLeaf(fourViews(), 'lambda-0', 'row', 'tm-0', 'lambda')).toThrow(/tm-0/)
  })

  it('still refuses the source leaf as its subject', () => {
    expect(() => splitLeaf(fourViews(), 'source', 'row', 'pane-1', 'lambda')).toThrow(/source pane cannot be split/)
  })
})

describe('closeLeaf', () => {
  it('collapses a split left with one child into that child', () => {
    const tree = splitLeaf(leaf('lambda-0', 'lambda'), 'lambda-0', 'row', 'lambda-1', 'lambda')
    expect(closeLeaf(tree, 'lambda-1')).toEqual(leaf('lambda-0', 'lambda'))
  })

  it('collapses recursively so no single-child spine survives', () => {
    // column[ row[source, lambda-0], row[asm-0, tm-0] ] -> close source, close lambda-0 -> row[asm-0, tm-0]
    const lower: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leaf('asm-0', 'asm'), leaf('tm-0', 'tm')],
    }
    const afterSource = closeLeaf(fourViews(), 'source')
    expect(afterSource).toEqual({
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [leaf('lambda-0', 'lambda'), lower],
    })
    expect(closeLeaf(afterSource, 'lambda-0')).toEqual(lower)
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

  /**
   * **TWO NEIGHBOURS THAT CANNOT BOTH HOLD THE FLOOR ARE LEFT AS THEY ARE.** In a row of 21 equal views each has a
   * share of 1/21, under `MIN_PANE_FRACTION`, and the clamp's bounds cross: the least it may move is more than the
   * most. It took the first to the floor and the second below nothing, a tree `parseTree` refuses, so one arrow key on
   * such a divider stored a workspace the next load threw away (measured in the browser on a stored row of 21,
   * 2026-10-12: shares 0.1 and −0.0048).
   *
   * **THE BOUNDS CROSS FROM A ROW OF 11, WHERE TWO SHARES TOGETHER ARE FIRST UNDER TWO FLOORS.** There the clamp took
   * the first to the floor whichever way it was asked to move, shares of 0.1 and 0.0818, a tree the loader takes, and
   * moved neither again. A guard that began at a row of 20, where the loader first refuses, would not stop that.
   */
  it.each([11, 21])(
    'leaves two neighbours alone where both cannot hold the minimum, in either direction: a row of %i',
    (views) => {
      const crowd: LayoutNode = {
        kind: 'split',
        dir: 'row',
        sizes: Array.from({ length: views }, () => 1 / views),
        children: [
          leaf('source', 'source'),
          ...Array.from({ length: views - 1 }, (_, i) => leaf(`pane-${i + 1}`, 'lambda')),
        ],
      }
      expect(parseTree(crowd), `precondition: the row of ${views} is a tree the loader takes`).not.toBeNull()
      expect(1 / views + 1 / views, 'precondition: the two together are under two floors').toBeLessThan(
        2 * MIN_PANE_FRACTION,
      )
      for (const delta of [0.1, -0.1, 0.001]) {
        const after = resize(crowd, [], 0, delta)
        if (after.kind !== 'split') throw new Error('unreachable')
        expect(after.sizes, `moved by ${delta}`).toEqual(crowd.sizes)
        expect(parseTree(after), `moved by ${delta}: the loader takes the tree`).not.toBeNull()
      }
    },
  )

  it('still brings a neighbour under the minimum up to it where the two together can hold it', () => {
    const lopsided: LayoutNode = { ...pair, sizes: [0.05, 0.95] }
    const after = resize(lopsided, [], 0, -0.5)
    if (after.kind !== 'split') throw new Error('unreachable')
    expect(after.sizes[0]).toBeCloseTo(MIN_PANE_FRACTION, 10)
    expect(after.sizes[1]).toBeCloseTo(1 - MIN_PANE_FRACTION, 10)
  })

  it('resizes a nested split addressed by path', () => {
    const after = resize(fourViews(), [0], 0, 0.1)
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
    // fourViews()'s [0] is a split, but [0, 0] is the source leaf — [0, 0, 0] tries to step
    // past it.
    expect(() => resize(fourViews(), [0, 0, 0], 0, 0.1)).toThrow(/layout path leaves the tree at index 0/)
  })

  it('throws when a path index has no child there', () => {
    expect(() => resize(fourViews(), [5], 0, 0.1)).toThrow(/layout path leaves the tree at index 5/)
  })

  it('throws when the path addresses a leaf directly', () => {
    // [0, 0] resolves to the source leaf itself, not a split to resize.
    expect(() => resize(fourViews(), [0, 0], 0, 0.1)).toThrow(/resize addressed a leaf/)
  })

  it('throws when there is no divider at the given index', () => {
    expect(() => resize(pair, [], 5, 0.1)).toThrow(/no divider at index 5/)
  })
})

describe('immutability', () => {
  it('never mutates the tree it was given', () => {
    const before = fourViews()
    const snapshot = structuredClone(before)
    splitLeaf(before, 'tm-0', 'row', 'tm-1', 'tm')
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
    expect(parseLayout(serializeLayout(fourViews()))).toEqual(fourViews())
  })

  it('returns null for absent storage', () => {
    expect(parseLayout(null)).toBeNull()
  })

  it('returns null for text that is not JSON', () => {
    expect(parseLayout('{oh no')).toBeNull()
  })

  it('returns null for a wrong version', () => {
    expect(parseLayout(JSON.stringify({ version: 99, tree: fourViews() }))).toBeNull()
  })

  it('returns null for a missing version', () => {
    expect(parseLayout(JSON.stringify({ tree: fourViews() }))).toBeNull()
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

  /**
   * THE COMPANION TO THE CASE ABOVE, AND THE ONE THAT COSTS SOMETHING REAL WHEN IT IS MISSING. "At
   * most one source leaf" was enforced; "the source leaf is `SOURCE_LEAF`" was not, and the two are
   * not the same claim. `SOURCE_LEAF`'s own doc says a source leaf under a fresh id "would be a
   * different leaf as far as every one of those is concerned — an empty pane beside a detached
   * editor": `pane-host.ts`'s creation pass skips the source kind (the editor's host is seeded before
   * any layout exists), so `hostFor('foo', 'source')` mints an EMPTY `<section>` and the real editor
   * is left mounted in a host the tree no longer names.
   *
   * ONE SOURCE LEAF UNDER THE WRONG ID, NOT TWO — a tree with `{id:'foo', pane:'source'}` and nothing
   * else of that kind passes the `sources > 1` count, which is exactly why counting was not enough.
   */
  it('returns null for a source leaf under an id that is not SOURCE_LEAF', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'row',
          children: [
            { kind: 'leaf', id: 'foo', pane: 'source' },
            { kind: 'leaf', id: 'b', pane: 'lambda' },
          ],
          sizes: [0.5, 0.5],
        }),
      ),
    ).toBeNull()
  })

  /** The same tree with the id spelled right, so the case above is failing on the ID and not the shape. */
  it('accepts that same tree once the source leaf carries SOURCE_LEAF', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'row',
          children: [
            { kind: 'leaf', id: SOURCE_LEAF, pane: 'source' },
            { kind: 'leaf', id: 'b', pane: 'lambda' },
          ],
          sizes: [0.5, 0.5],
        }),
      ),
    ).not.toBeNull()
  })

  /**
   * A STORED ASM VIEW SURVIVES A RELOAD. A kind `validate` does not know fails the whole layout, and a layout that
   * fails is replaced by the default without a word, so an asm view would be lost on every reload with nothing red.
   * Written out by hand rather than read off `defaultLayout()`, so a later default without an asm view keeps the case.
   */
  it('accepts an asm view in a stored tree', () => {
    const tree = {
      kind: 'split',
      dir: 'row',
      children: [
        { kind: 'leaf', id: SOURCE_LEAF, pane: 'source' },
        { kind: 'leaf', id: 'asm-3', pane: 'asm' },
      ],
      sizes: [0.5, 0.5],
    }
    expect(parseLayout(wrap(tree))).toEqual(tree)
  })

  /**
   * AND THE CONVERSE: `SOURCE_LEAF` IS RESERVED FOR THE SOURCE KIND. The id and the kind have to agree
   * in BOTH directions, because `pane-host.ts` keys the editor's pre-seeded host on this id — a
   * `{id: SOURCE_LEAF, pane: 'lambda'}` entry would have the creation pass build a `LambdaPane` into
   * the host the editor is already mounted in.
   */
  it('returns null for a non-source leaf carrying SOURCE_LEAF', () => {
    expect(
      parseLayout(
        wrap({
          kind: 'split',
          dir: 'row',
          children: [
            { kind: 'leaf', id: SOURCE_LEAF, pane: 'lambda' },
            { kind: 'leaf', id: 'b', pane: 'tm' },
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

describe('setLeafKind', () => {
  const tree = (): LayoutNode => ({
    kind: 'split',
    dir: 'row',
    sizes: [0.3, 0.7],
    children: [leaf('source', 'source'), leaf('a', 'lambda')],
  })

  it('changes the kind and touches nothing else', () => {
    const next = setLeafKind(tree(), 'a', 'tm')
    expect(leaves(next).map((l) => [l.id, l.pane])).toEqual([
      ['source', 'source'],
      ['a', 'tm'],
    ])
    // Decision 1 is that the pane keeps its place: same shape, same sizes.
    expect(next).toMatchObject({ kind: 'split', dir: 'row', sizes: [0.3, 0.7] })
  })

  it('refuses source as a target even when the tree has no source leaf', () => {
    // The condition that lets the PICKER create a source pane is exactly the condition a reader
    // expects to unlock this. Decision 4 is why it does not: a pane never becomes the source pane.
    const noSource: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leaf('a', 'lambda'), leaf('b', 'tm')],
    }
    expect(() => setLeafKind(noSource, 'a', 'source')).toThrow(/source/)
  })

  it('refuses to change the source leaf', () => {
    expect(() => setLeafKind(tree(), 'source', 'lambda')).toThrow(/source/)
  })

  it('refuses an id that is not in the tree', () => {
    expect(() => setLeafKind(tree(), 'nope', 'tm')).toThrow(/not in the tree/)
  })
})

describe('splitLeaf with an explicit kind', () => {
  const twoLeaves = (): LayoutNode => ({
    kind: 'split',
    dir: 'row',
    sizes: [0.5, 0.5],
    children: [leaf('source', 'source'), leaf('a', 'lambda')],
  })

  it('creates a leaf of the requested kind, not the split leaf’s', () => {
    const next = splitLeaf(twoLeaves(), 'a', 'row', 'b', 'tm')
    expect(leaves(next).find((l) => l.id === 'b')?.pane).toBe('tm')
  })

  it('still refuses to split the source leaf, whatever kind is requested', () => {
    expect(() => splitLeaf(twoLeaves(), 'source', 'row', 'b', 'lambda')).toThrow(/source/)
  })

  it('refuses to create a second source leaf', () => {
    expect(() => splitLeaf(twoLeaves(), 'a', 'row', 'b', 'source')).toThrow(/source/)
  })

  it('creates a source leaf when the tree has none', () => {
    const noSource: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leaf('a', 'lambda'), leaf('b', 'tm')],
    }
    const next = splitLeaf(noSource, 'a', 'row', 'c', 'source')
    expect(leaves(next).find((l) => l.id === 'c')?.pane).toBe('source')
  })
})

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
    const next = insertBeside(fourViews(), 'lambda-0', 'row', 'pane-1', 'tm')
    expect(leaves(next).map((l) => l.id)).toEqual(['source', 'lambda-0', 'pane-1', 'asm-0', 'tm-0'])
  })

  it('still refuses a second source leaf and a duplicate id', () => {
    expect(() => insertBeside(fourViews(), 'tm-0', 'row', 'source', 'source')).toThrow(/already has a source leaf/)
    expect(() => insertBeside(fourViews(), 'tm-0', 'row', 'lambda-0', 'lambda')).toThrow(/already in the tree/)
    expect(() => insertBeside(fourViews(), 'pane-9', 'row', 'pane-1', 'lambda')).toThrow(/not in the tree/)
  })
})

/** The sizes of the split holding the leaf `id`, and the ids of that split's children. */
const rowOf = (root: LayoutNode, id: string): { sizes: number[]; ids: string[]; dir: string } | null => {
  if (root.kind === 'leaf') return null
  if (root.children.some((c) => c.kind === 'leaf' && c.id === id))
    return { sizes: root.sizes, ids: root.children.map((c) => (c.kind === 'leaf' ? c.id : '(split)')), dir: root.dir }
  for (const c of root.children) {
    const found = rowOf(c, id)
    if (found !== null) return found
  }
  return null
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/**
 * **`+ VIEW` TAKES AN EQUAL SHARE OF THE FOCUSED VIEW'S ROW** (the user's decision, 2026-10-04): the new view joins
 * the row right after the view it is added beside, at `1/(n+1)`, and each of the `n` views already there keeps its
 * proportion at `n/(n+1)` of its size. Where that view's parent is not a row, or it is the root, it is wrapped in a new
 * row at `[0.5, 0.5]`.
 */
describe('insertBeside, `+ view`’s equal share', () => {
  it('joins the row at an equal share, right after the view it is added beside', () => {
    const next = insertBeside(fourViews(), 'lambda-0', 'row', 'pane-1', 'tm')
    expect(rowOf(next, 'pane-1')).toEqual({
      sizes: [1 / 3, 1 / 3, 1 / 3],
      ids: ['source', 'lambda-0', 'pane-1'],
      dir: 'row',
    })
    expect(leaves(next).map((l) => l.id)).toEqual(['source', 'lambda-0', 'pane-1', 'asm-0', 'tm-0'])
  })

  it('keeps the proportions of the views already in the row', () => {
    const three: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.2, 0.3, 0.5],
      children: [leaf('a', 'lambda'), leaf('b', 'lambda'), leaf('c', 'tm')],
    }
    const next = insertBeside(three, 'b', 'row', 'd', 'asm')
    const row = rowOf(next, 'd')
    expect(row?.ids).toEqual(['a', 'b', 'd', 'c'])
    const [a, b, d, c] = row?.sizes ?? []
    expect(a).toBeCloseTo(0.2 * 0.75, 12)
    expect(b).toBeCloseTo(0.3 * 0.75, 12)
    expect(d).toBeCloseTo(0.25, 12)
    expect(c).toBeCloseTo(0.5 * 0.75, 12)
    expect(Math.abs(sum(row?.sizes ?? []) - 1)).toBeLessThanOrEqual(SIZE_EPSILON)
  })

  it('pressed five times in a row gives one row of seven equal views, still summing to 1', () => {
    let tree = fourViews()
    let focused = 'lambda-0'
    for (let k = 1; k <= 5; k++) {
      tree = insertBeside(tree, focused, 'row', `pane-${k}`, 'lambda')
      focused = `pane-${k}`
    }
    const row = rowOf(tree, 'pane-5')
    expect(row?.ids).toEqual(['source', 'lambda-0', 'pane-1', 'pane-2', 'pane-3', 'pane-4', 'pane-5'])
    for (const s of row?.sizes ?? []) expect(s).toBeCloseTo(1 / 7, 12)
    expect(Math.abs(sum(row?.sizes ?? []) - 1)).toBeLessThanOrEqual(SIZE_EPSILON)
    expect(parseTree(tree)).toEqual(tree)
  })

  it('wraps a view whose parent is a column in a new row at [0.5, 0.5]', () => {
    const column = splitLeaf(fourViews(), 'tm-0', 'column', 'pane-1', 'tm')
    const next = insertBeside(column, 'tm-0', 'row', 'pane-2', 'lambda')
    expect(rowOf(next, 'pane-2')).toEqual({ sizes: [0.5, 0.5], ids: ['tm-0', 'pane-2'], dir: 'row' })
    expect(rowOf(next, 'pane-1')).toEqual({ sizes: [0.5, 0.5], ids: ['(split)', 'pane-1'], dir: 'column' })
  })

  it('wraps a view that is the whole tree in a new row at [0.5, 0.5]', () => {
    expect(insertBeside(leaf('a', 'lambda'), 'a', 'row', 'b', 'tm')).toEqual({
      kind: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [leaf('a', 'lambda'), leaf('b', 'tm')],
    })
  })
})

/**
 * **NO ADD MAKES A VIEW SMALLER THAN `MIN_VIEW_PX`, AND NONE MAKES A TREE THE LOADER REFUSES.** Worked out from the
 * tree's fractions and the tiled area, so it needs no element: 1280×725.5 is `#views` at 1280×800 with no notice up,
 * where each default view is 634×356.75.
 */
describe('the floor on an add', () => {
  const AREA = { width: 1280, height: 725.5 }
  const view = (root: LayoutNode, beside: string) => (id: string) => insertBeside(root, beside, 'row', id, 'lambda')
  const split = (root: LayoutNode, at: string, dir: 'row' | 'column') => (id: string) =>
    splitLeaf(root, at, dir, id, 'lambda')

  it('draws each view the size the stylesheet does', () => {
    const sizes = leafExtents(fourViews(), AREA, DIVIDER_PX)
    for (const id of ['source', 'lambda-0', 'asm-0', 'tm-0'])
      expect(sizes.get(id)).toEqual({ width: 634, height: 356.75 })
  })

  it('lets + view add five views beside λ and refuses the sixth', () => {
    let tree = fourViews()
    let focused = 'lambda-0'
    for (let k = 1; k <= 5; k++) {
      expect(addRefusal(tree, view(tree, focused), 'width', AREA, DIVIDER_PX), `press ${k}`).toBeNull()
      tree = insertBeside(tree, focused, 'row', `pane-${k}`, 'lambda')
      focused = `pane-${k}`
    }
    expect(leafExtents(tree, AREA, DIVIDER_PX).get('pane-5')?.width).toBeCloseTo((1280 - 6 * 12) / 7, 9)
    expect(addRefusal(tree, view(tree, focused), 'width', AREA, DIVIDER_PX)).toBe('narrow')
  })

  it('refuses split right on a view under 332 px wide, and allows it at 332', () => {
    const narrow = insertBeside(
      insertBeside(fourViews(), 'lambda-0', 'row', 'p1', 'lambda'),
      'p1',
      'row',
      'p2',
      'lambda',
    )
    expect(leafExtents(narrow, AREA, DIVIDER_PX).get('p2')?.width).toBe(311)
    expect(addRefusal(narrow, split(narrow, 'p2', 'row'), 'width', AREA, DIVIDER_PX)).toBe('narrow')
    const exact = { kind: 'leaf', id: 'a', pane: 'lambda' } as const
    expect(addRefusal(exact, split(exact, 'a', 'row'), 'width', { width: 332, height: 100 }, DIVIDER_PX)).toBeNull()
    expect(addRefusal(exact, split(exact, 'a', 'row'), 'width', { width: 331.9, height: 100 }, DIVIDER_PX)).toBe(
      'narrow',
    )
  })

  /**
   * THE AXIS A SPLIT DIVIDES, ON TOP OF WIDTH: a view 200 px wide and 700 tall splits down and not right, and one 700
   * wide and 200 tall splits right and not down.
   */
  it('holds split down to height as well as width, and split right to width', () => {
    const one = { kind: 'leaf', id: 'a', pane: 'lambda' } as const
    const tallNarrow = { width: 200, height: 700 }
    const wideShort = { width: 700, height: 200 }
    expect(addRefusal(one, split(one, 'a', 'column'), 'height', tallNarrow, DIVIDER_PX)).toBeNull()
    expect(addRefusal(one, split(one, 'a', 'column'), 'height', wideShort, DIVIDER_PX)).toBe('short')
    expect(addRefusal(one, split(one, 'a', 'row'), 'width', wideShort, DIVIDER_PX)).toBeNull()
    expect(addRefusal(one, split(one, 'a', 'row'), 'width', tallNarrow, DIVIDER_PX)).toBe('narrow')
  })

  /**
   * **A SPLIT DOWN IS HELD TO WIDTH TOO** (the user's decision 2, the re-review's finding): it makes a view as narrow
   * as the one it halves. λ dragged to 0.12 of its row is 152.16 px wide; split down, its halves are 172.375 px tall,
   * which passes the height floor, and 152.16 wide, which does not.
   */
  it('refuses a split down of a view already narrower than the floor', () => {
    const tree = resize(fourViews(), [0], 0, 0.38)
    expect(leafExtents(tree, AREA, DIVIDER_PX).get('lambda-0')?.width).toBeCloseTo(152.16, 9)
    const down = split(tree, 'lambda-0', 'column')
    expect(leafExtents(down('added'), AREA, DIVIDER_PX).get('added')).toEqual({ width: 152.16, height: 172.375 })
    expect(addRefusal(tree, down, 'height', AREA, DIVIDER_PX)).toBe('narrow')
  })

  /**
   * **A VIEW THE ADD SHRINKS COUNTS, NOT ONLY THE ONE IT MAKES** (the user's decision 2): in a row at `[0.85, 0.15]`,
   * `+ view` beside the narrow view takes it from 190.2 px to 125.6 while the new view gets 418.67.
   */
  it('refuses an add whose new view has room when a view it shrinks would not', () => {
    const row: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.85, 0.15],
      children: [leaf('a', 'lambda'), leaf('b', 'lambda')],
    }
    expect(leafExtents(row, AREA, DIVIDER_PX).get('b')?.width).toBeCloseTo(190.2, 9)
    const after = leafExtents(insertBeside(row, 'b', 'row', 'c', 'lambda'), AREA, DIVIDER_PX)
    expect(after.get('b')?.width).toBeCloseTo(125.6, 9)
    expect(after.get('c')?.width).toBeCloseTo((1280 - 2 * 12) / 3, 9)
    expect(addRefusal(row, view(row, 'b'), 'width', AREA, DIVIDER_PX)).toBe('narrow')
  })

  /**
   * **ANY VIEW IN THE ROW, NOT ONLY THE ONE BESIDE IT**: in a row at `[0.15, 0.85]`, `+ view` beside the wide view
   * takes its narrow sibling from 190.2 px to 125.6, while the view it is beside keeps 711.73 and the new one gets
   * 418.67.
   */
  it('refuses an add that would take another view in the row under the floor', () => {
    const row: LayoutNode = {
      kind: 'split',
      dir: 'row',
      sizes: [0.15, 0.85],
      children: [leaf('a', 'lambda'), leaf('b', 'lambda')],
    }
    const after = leafExtents(insertBeside(row, 'b', 'row', 'c', 'lambda'), AREA, DIVIDER_PX)
    expect(after.get('a')?.width).toBeCloseTo(125.6, 9)
    expect(after.get('b')?.width).toBeGreaterThanOrEqual(MIN_VIEW_PX)
    expect(after.get('c')?.width).toBeGreaterThanOrEqual(MIN_VIEW_PX)
    expect(addRefusal(row, view(row, 'b'), 'width', AREA, DIVIDER_PX)).toBe('narrow')
  })

  it('does not count a view the add leaves alone, however narrow', () => {
    const squeezed: LayoutNode = {
      kind: 'split',
      dir: 'column',
      sizes: [0.5, 0.5],
      children: [
        leaf('a', 'lambda'),
        { kind: 'split', dir: 'row', sizes: [0.9, 0.1], children: [leaf('b', 'tm'), leaf('c', 'tm')] },
      ],
    }
    expect(leafExtents(squeezed, AREA, DIVIDER_PX).get('c')?.width).toBeLessThan(MIN_VIEW_PX)
    expect(addRefusal(squeezed, view(squeezed, 'a'), 'width', AREA, DIVIDER_PX)).toBeNull()
  })

  it('refuses a 65th leaf as full, before room, and allows a 64th', () => {
    const flat = (n: number): LayoutNode => ({
      kind: 'split',
      dir: 'row',
      sizes: Array.from({ length: n }, () => 1 / n),
      children: Array.from({ length: n }, (_, i) => leaf(`pane-${i + 1}`, 'lambda')),
    })
    const wide = { width: 64 * 200, height: 800 }
    expect(MAX_TREE_LEAVES).toBe(64)
    expect([holdsMostLeaves(flat(63)), holdsMostLeaves(flat(64))]).toEqual([false, true])
    expect(addRefusal(flat(63), view(flat(63), 'pane-1'), 'width', wide, DIVIDER_PX)).toBeNull()
    expect(addRefusal(flat(64), view(flat(64), 'pane-1'), 'width', wide, DIVIDER_PX)).toBe('full')
    expect(addRefusal(flat(64), view(flat(64), 'pane-1'), 'width', AREA, DIVIDER_PX)).toBe('full')
  })

  it('changes nothing it was given', () => {
    const before = fourViews()
    const snapshot = structuredClone(before)
    addRefusal(before, view(before, 'lambda-0'), 'width', AREA, DIVIDER_PX)
    insertBeside(before, 'lambda-0', 'row', 'pane-1', 'lambda')
    expect(before).toEqual(snapshot)
  })
})

describe('parseTree', () => {
  it('validates a bare tree the way parseLayout validates an envelope', () => {
    expect(parseTree(fourViews())).toEqual(fourViews())
    expect(parseTree({ kind: 'leaf', id: 'x', pane: 'source' })).toBeNull()
    expect(parseTree('nope')).toBeNull()
  })
})

/**
 * **A TREE IS AT MOST 64 SPLITS DEEP AND HAS AT MOST 64 LEAVES** (Plan 7 part 6a spec §5.3, amended 2026-10-01), so a
 * link's tree and a stored one are held alike. Before, a link of a few kilobytes could carry a tree that threw out of
 * `validate`'s recursion, or one that took many seconds to open and was then stored.
 */
describe('the bound on a tree', () => {
  /** One split of `n` λ leaves, `pane-1` to `pane-n`: one split deep, so only the leaf bound is in play. */
  const flat = (n: number): LayoutNode => ({
    kind: 'split',
    dir: 'row',
    sizes: Array.from({ length: n }, () => 1 / n),
    children: Array.from({ length: n }, (_, i) => leaf(`pane-${i + 1}`, 'lambda')),
  })
  /**
   * A tree `depth` splits deep down each split's FIRST child, whose second child is a leaf. `validate` reads every
   * split before any leaf, so the leaf bound cannot stop the reading and only the depth bound can.
   */
  const spine = (depth: number): LayoutNode => {
    let node: LayoutNode = leaf('pane-0', 'lambda')
    for (let i = 1; i <= depth; i++)
      node = { kind: 'split', dir: 'row', sizes: [0.5, 0.5], children: [node, leaf(`pane-${i}`, 'lambda')] }
    return node
  }
  /**
   * A tree `depth` splits deep down each split's SECOND child, as `+ view` nested the views it added until 2026-10-04.
   */
  const trailing = (depth: number): LayoutNode => {
    let node: LayoutNode = leaf(`pane-${depth}`, 'lambda')
    for (let i = depth - 1; i >= 0; i--)
      node = { kind: 'split', dir: 'row', sizes: [0.5, 0.5], children: [leaf(`pane-${i}`, 'lambda'), node] }
    return node
  }
  /** Splits on the longest root-to-leaf path, and leaves. */
  const shape = (node: LayoutNode): { depth: number; leaves: number } => {
    if (node.kind === 'leaf') return { depth: 0, leaves: 1 }
    const kids = node.children.map(shape)
    return { depth: 1 + Math.max(...kids.map((k) => k.depth)), leaves: kids.reduce((n, k) => n + k.leaves, 0) }
  }
  /** `+ view` pressed `presses` times in a row: each adds a λ view beside the view the last one added and focused. */
  const pressed = (presses: number): LayoutNode => {
    let tree = fourViews()
    let focused = 'lambda-0'
    for (let k = 1; k <= presses; k++) {
      tree = insertBeside(tree, focused, 'row', `pane-${k}`, 'lambda')
      focused = `pane-${k}`
    }
    return tree
  }

  it('accepts 64 leaves and refuses 65', () => {
    expect(parseTree(flat(64))).toEqual(flat(64))
    expect(parseTree(flat(65))).toBeNull()
  })

  /** A split has two children or more, so a tree 64 splits deep has at least 65 leaves, and is over the leaf bound. */
  it('accepts the deepest tree 64 leaves make, 63 splits deep, and refuses one 64 or 65 deep', () => {
    expect(shape(spine(63))).toEqual({ depth: 63, leaves: 64 })
    expect(parseTree(spine(63))).toEqual(spine(63))
    expect(parseTree(spine(64))).toBeNull()
    expect(parseTree(spine(65))).toBeNull()
  })

  it.each([
    ['first', spine],
    ['second', trailing],
  ])('refuses a tree 10,000 and 40,000 splits deep down its %s children, without throwing', (_, deep) => {
    expect(parseTree(deep(10_000))).toBeNull()
    expect(parseTree(deep(40_000))).toBeNull()
  })

  /**
   * **IT STOPS READING AT THE 65TH SPLIT**, so a hostile tree costs what 65 splits cost however deep it goes. Each split
   * notes its depth when its `kind` is read.
   */
  it('reads a tree 10,000 splits deep no further than its 65th split', () => {
    let deepest = 0
    let node: unknown = leaf('pane-0', 'lambda')
    for (let i = 10_000; i >= 1; i--) {
      const split = { dir: 'row', sizes: [0.5, 0.5], children: [node, leaf(`pane-${i}`, 'lambda')] }
      Object.defineProperty(split, 'kind', {
        enumerable: true,
        get: () => {
          deepest = Math.max(deepest, i)
          return 'split'
        },
      })
      node = split
    }
    expect(parseTree(node)).toBeNull()
    expect(deepest).toBe(65)
  })

  /**
   * **`+ view` PUTS EACH VIEW IT ADDS IN THE ROW, WHERE IT NESTED EACH ONE SPLIT DEEPER** (2026-10-04). Pressed seven
   * times in a row in the app on 2026-10-01, it stored a tree 9 deep with 11 leaves; the same presses make one row now,
   * 2 deep. The leaf bound is still the one it meets: 60 presses parse, the 61st would make 65 leaves, and `addRefusal`
   * refuses it, however wide the window.
   */
  it('accepts a tree built as `+ view` builds one, and refuses the press that would make its 65th leaf', () => {
    expect(shape(pressed(7))).toEqual({ depth: 2, leaves: 11 })
    expect(parseTree(pressed(7))).toEqual(pressed(7))
    expect(shape(pressed(60))).toEqual({ depth: 2, leaves: 64 })
    expect(parseTree(pressed(60))).toEqual(pressed(60))
    expect(parseTree(pressed(61))).toBeNull()
    const sixtieth = pressed(60)
    const huge = { width: 1_000_000, height: 1_000 }
    const next = (id: string) => insertBeside(sixtieth, 'pane-60', 'row', id, 'lambda')
    expect(addRefusal(sixtieth, next, 'width', huge, DIVIDER_PX)).toBe('full')
  })

  /**
   * **A LEAF ID'S NUMBER IS ONE THE LEAF COUNTER CAN STEP PAST.** `main.ts`'s `seedLeafCounter` sets the counter one past
   * the largest number in the tree, as `leafNumber` reads it, and from 2^53 on adding one no longer moves it: the second
   * view added after such a tree would mint a duplicate id. Every form the app has minted parses: `source`; a default
   * arrangement's `lambda-0`, `asm-0` and `tm-0`; `${leg}-${n}`, minted by 5d-ii-a's `nextLeafId` until 5d-ii-b; and
   * `pane-${n}` since. An id with no number cannot move the counter, and parses as before.
   */
  const beside = (id: string): LayoutNode => ({
    kind: 'split',
    dir: 'row',
    sizes: [0.5, 0.5],
    children: [leaf('source', 'source'), leaf(id, 'lambda')],
  })

  it.each(['lambda-0', 'asm-0', 'tm-0', 'lambda-3', 'tm-3', 'pane-1', 'pane-1000000000', 'a', 'lambda-x'])(
    'accepts the leaf id %s',
    (id) => {
      expect(parseTree(beside(id))).toEqual(beside(id))
    },
  )

  it.each(['pane-1000000001', 'pane-9007199254740991', 'pane-1e300', 'pane-0x1fffffffffffff', '1e300'])(
    'refuses the leaf id %s',
    (id) => {
      expect(parseTree(beside(id))).toBeNull()
    },
  )
})
